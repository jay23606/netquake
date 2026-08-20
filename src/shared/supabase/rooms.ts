import { getSupabase } from './client'
import { SupabaseBroker } from '../../engine/webrtc/SupabaseBroker'

// Lobby operations against the nq_* tables. Deliberately framework-free so the
// Vue shell can be replaced without touching this.


// Match rules the host sets in the lobby and every peer sees over Realtime.
// Stored in nq_rooms.game_settings (jsonb) so adding a rule needs no migration.
export type GameSettings = {
	gameType: 'deathmatch' | 'coop'
	fragLimit: number
	timeLimit: number   // minutes; 0 = no limit
	skill: number       // 0-3, only meaningful for coop
}

export const defaultGameSettings = (): GameSettings => ({
	gameType: 'deathmatch',
	fragLimit: 0,
	timeLimit: 0,
	skill: 1,
})

export type RoomStatus = 'lobby' | 'in-game'

// Which engine a room belongs to; one lobby serves both.
export type GameId = 'q1' | 'q2'
export type Room = {
	// Populated by listRooms via an aggregate join; absent on single-row reads.
	nq_room_players?: { count: number }[]
	// Host profile, embedded via the host_id FK (named explicitly because
	// nq_rooms reaches nq_profiles two ways -- directly and through players).
	nq_profiles?: { name: string } | null
	id: string
	code: string
	name: string
	host_id: string
	map: string
	max_players: number
	is_open: boolean
	status: RoomStatus
	game: GameId
	game_settings: GameSettings
	created_at: string
}

export type RoomPlayer = {
	room_id: string
	player_id: string
	is_host: boolean
	joined_at: string
	color: number
	asset_progress: number
	// Embedded display name; absent unless the query asked for it.
	nq_profiles?: { name: string } | null
}

// Unambiguous alphabet: no O/0, I/1, so codes survive being read aloud.
// Captured at sign-in so the unload handler has a token without awaiting.
let cachedAccessToken: string | null = null

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

const makeCode = (len = 5): string => {
	const bytes = new Uint8Array(len)
	crypto.getRandomValues(bytes)
	let out = ''
	for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
	return out
}

// Signs in anonymously if needed and makes sure an nq_profiles row exists.
// Every RLS policy keys off auth.uid(), so nothing else here works until this
// has run.
export const ensurePlayer = async (name: string): Promise<{ id: string, name: string }> => {
	const supabase = getSupabase()

	let { data: { user } } = await supabase.auth.getUser()
	if (!user) {
		const { data, error } = await supabase.auth.signInAnonymously()
		if (error) {
			throw new Error(
				`Anonymous sign-in failed: ${error.message}. ` +
				'Enable it under Authentication -> Providers in the Supabase dashboard.')
		}
		user = data.user
	}
	if (!user) throw new Error('No authenticated user after sign-in')

	const trimmed = (name || 'player').slice(0, 15)
	const { error: upsertError } = await supabase
		.from('nq_profiles')
		.upsert({ id: user.id, name: trimmed }, { onConflict: 'id' })
	if (upsertError) throw new Error(`Could not save profile: ${upsertError.message}`)

	const { data: { session } } = await supabase.auth.getSession()
	cachedAccessToken = session?.access_token ?? null

	return { id: user.id, name: trimmed }
}

export const playerCount = (room: Room): number =>
	room.nq_room_players?.[0]?.count ?? 0

export const hostName = (room: Room): string => room.nq_profiles?.name ?? "unknown"

// Rooms are only closed when the host explicitly leaves, so a host who closed
// their tab can strand one. Hiding old rooms keeps those out of the list even
// when the unload cleanup did not get through.
const MAX_ROOM_AGE_MINUTES = 60

export const listRooms = async (): Promise<Room[]> => {
	const { data, error } = await getSupabase()
		.from("nq_rooms")
		.select("*, nq_profiles!nq_rooms_host_id_fkey(name), nq_room_players(count)")
		.eq("is_open", true)
		.gt("created_at", new Date(Date.now() - MAX_ROOM_AGE_MINUTES * 60_000).toISOString())
		.order("created_at", { ascending: false })
		.limit(50)
	if (error) throw new Error(`Could not list rooms: ${error.message}`)
	return (data ?? []) as Room[]
}

export const createRoom = async (
	opts: { name: string, map?: string, maxPlayers?: number, hostId: string, game?: GameId },
): Promise<Room> => {
	const supabase = getSupabase()
	const room = {
		code: makeCode(),
		name: opts.name,
		host_id: opts.hostId,
		game: opts.game ?? 'q1',
		map: opts.map ?? (opts.game === 'q2' ? 'demo1' : 'e1m1'),
		max_players: opts.maxPlayers ?? 8,
	}

	const { data, error } = await supabase.from('nq_rooms').insert(room).select().single()
	if (error) throw new Error(`Could not create room: ${error.message}`)

	// The host is a player in their own room; the schema trigger closes the room
	// when this row is deleted.
	const { error: joinError } = await supabase
		.from('nq_room_players')
		.insert({ room_id: data.id, player_id: opts.hostId, is_host: true })
	if (joinError) throw new Error(`Could not join own room: ${joinError.message}`)

	return data as Room
}

export const findRoomByCode = async (code: string): Promise<Room | null> => {
	const { data, error } = await getSupabase()
		.from('nq_rooms')
		.select('*')
		.eq('code', code.trim().toUpperCase())
		.eq('is_open', true)
		.maybeSingle()
	if (error) throw new Error(`Could not look up room: ${error.message}`)
	return (data as Room) ?? null
}

export const joinRoom = async (roomId: string, playerId: string): Promise<void> => {
	const { error } = await getSupabase()
		.from('nq_room_players')
		.upsert({ room_id: roomId, player_id: playerId, is_host: false },
			// DO NOTHING rather than DO UPDATE: an upsert that updates would also
			// need an UPDATE policy, and re-joining should not rewrite is_host.
			{ onConflict: "room_id,player_id", ignoreDuplicates: true })
	if (error) throw new Error(`Could not join room: ${error.message}`)
}

export const leaveRoom = async (roomId: string, playerId: string): Promise<void> => {
	const { error } = await getSupabase()
		.from('nq_room_players')
		.delete()
		.eq('room_id', roomId)
		.eq('player_id', playerId)
	if (error) throw new Error(`Could not leave room: ${error.message}`)
}

export const listRoomPlayers = async (roomId: string): Promise<RoomPlayer[]> => {
	const { data, error } = await getSupabase()
		.from('nq_room_players')
		.select('*, nq_profiles(name)')
		.eq('room_id', roomId)
		.order('joined_at', { ascending: true })
	if (error) throw new Error(`Could not list players: ${error.message}`)
	return (data ?? []) as RoomPlayer[]
}

// Builds the signaling broker and waits for the channel to be live. The engine
// is synchronous, so this must be awaited before the game is launched and the
// result handed over in InitArgs.
export const connectBroker = async (
	roomId: string, playerId: string, isHost: boolean,
): Promise<SupabaseBroker> => {
	const broker = new SupabaseBroker(roomId, playerId, isHost)
	await broker.connect()
	return broker
}

// Live room list. nq_rooms and nq_room_players are both in the supabase_realtime
// publication, so room creation/closure and players coming and going all arrive
// here. The callback re-reads the list rather than patching it locally, which
// keeps the aggregate player counts honest. Returns an unsubscribe function.
export const subscribeRooms = (onChange: () => void): (() => void) => {
	const channel = getSupabase()
		.channel('netquake:lobby')
		.on('postgres_changes',
			{ event: '*', schema: 'public', table: 'nq_rooms' }, () => onChange())
		.on('postgres_changes',
			{ event: '*', schema: 'public', table: 'nq_room_players' }, () => onChange())
		.subscribe()

	return () => { void channel.unsubscribe() }
}

// Best-effort room cleanup when the tab closes. Promises do not get to finish
// during unload, so this goes straight at PostgREST with keepalive, which the
// browser is permitted to complete after the page is gone. Deleting the host's
// row fires the schema trigger that closes the room.
export const leaveRoomOnUnload = (roomId: string, playerId: string): void => {
	if (!cachedAccessToken) return
	const base = import.meta.env.VITE_SUPABASE_URL
	const key = import.meta.env.VITE_SUPABASE_ANON_KEY
	void fetch(
		`${base}/rest/v1/nq_room_players?room_id=eq.${roomId}&player_id=eq.${playerId}`,
		{
			method: 'DELETE',
			keepalive: true,
			headers: { apikey: key, Authorization: `Bearer ${cachedAccessToken}` },
		},
	).catch(() => { /* unload cleanup is best effort */ })
}

// ---------------------------------------------------------------- lobby ops

// Flipping this to 'in-game' is the launch signal: every peer is subscribed to
// the room row and enters together, rather than each pressing Start themselves.
export const setRoomStatus = async (roomId: string, status: RoomStatus): Promise<void> => {
	const { error } = await getSupabase()
		.from('nq_rooms')
		.update({ status, updated_at: new Date().toISOString() })
		.eq('id', roomId)
	if (error) throw new Error(`Could not set room status: ${error.message}`)
}

export const updateRoom = async (
	roomId: string, patch: { map?: string, game_settings?: GameSettings, max_players?: number },
): Promise<void> => {
	const { error } = await getSupabase()
		.from('nq_rooms')
		.update({ ...patch, updated_at: new Date().toISOString() })
		.eq('id', roomId)
	if (error) throw new Error(`Could not update room: ${error.message}`)
}

export const setPlayerColor = async (
	roomId: string, playerId: string, color: number,
): Promise<void> => {
	const { error } = await getSupabase()
		.from('nq_room_players')
		.update({ color })
		.eq('room_id', roomId).eq('player_id', playerId)
	if (error) throw new Error(`Could not set colour: ${error.message}`)
}

// Peers report how far through fetching assets they are so the host can see
// who is still downloading before starting.
export const setAssetProgress = async (
	roomId: string, playerId: string, percent: number,
): Promise<void> => {
	const { error } = await getSupabase()
		.from('nq_room_players')
		.update({ asset_progress: Math.max(0, Math.min(100, Math.round(percent))) })
		.eq('room_id', roomId).eq('player_id', playerId)
	if (error) throw new Error(`Could not report progress: ${error.message}`)
}

// Host only, enforced by RLS on both tables.
export const kickPlayer = async (roomId: string, playerId: string): Promise<void> => {
	const { error } = await getSupabase()
		.from('nq_room_players')
		.delete().eq('room_id', roomId).eq('player_id', playerId)
	if (error) throw new Error(`Could not remove player: ${error.message}`)
}

export const banPlayer = async (roomId: string, playerId: string): Promise<void> => {
	const { error } = await getSupabase()
		.from('nq_room_bans')
		.upsert({ room_id: roomId, player_id: playerId },
			{ onConflict: 'room_id,player_id', ignoreDuplicates: true })
	if (error) throw new Error(`Could not ban player: ${error.message}`)
	await kickPlayer(roomId, playerId)
}

// ------------------------------------------------------------------- chat

export type ChatMessage = {
	id: number
	room_id: string
	player_id: string | null
	kind: 'text' | 'event'
	body: string
	created_at: string
	nq_profiles?: { name: string } | null
}

export const listChat = async (roomId: string): Promise<ChatMessage[]> => {
	const { data, error } = await getSupabase()
		.from('nq_chat')
		.select('*, nq_profiles(name)')
		.eq('room_id', roomId)
		.order('created_at', { ascending: true })
		.limit(200)
	if (error) throw new Error(`Could not load chat: ${error.message}`)
	return (data ?? []) as ChatMessage[]
}

export const sendChat = async (
	roomId: string, playerId: string, body: string,
): Promise<void> => {
	const trimmed = body.trim().slice(0, 500)
	if (!trimmed) return
	const { error } = await getSupabase()
		.from('nq_chat')
		.insert({ room_id: roomId, player_id: playerId, kind: 'text', body: trimmed })
	if (error) throw new Error(`Could not send message: ${error.message}`)
}

// Join/leave notices. Best effort: a missed notice must never break the lobby,
// so this swallows its own errors rather than surfacing them.
export const postEvent = async (
	roomId: string, playerId: string, body: string,
): Promise<void> => {
	try {
		await getSupabase()
			.from('nq_chat')
			.insert({ room_id: roomId, player_id: playerId, kind: 'event', body })
	} catch {
		// A missed join/leave notice must never break the lobby.
	}
}

// Everything that changes inside one room: its status and settings, who is in
// it, and the chat. One channel rather than three.
export const subscribeRoom = (
	roomId: string,
	on: { room?: () => void, players?: () => void, chat?: () => void },
): (() => void) => {
	const filter = `room_id=eq.${roomId}`
	const channel = getSupabase()
		.channel(`netquake:room-state:${roomId}`)
		.on('postgres_changes',
			{ event: '*', schema: 'public', table: 'nq_rooms', filter: `id=eq.${roomId}` },
			() => on.room?.())
		.on('postgres_changes',
			{ event: '*', schema: 'public', table: 'nq_room_players', filter },
			() => on.players?.())
		.on('postgres_changes',
			{ event: '*', schema: 'public', table: 'nq_chat', filter },
			() => on.chat?.())
		.subscribe()

	return () => { void channel.unsubscribe() }
}

// Re-read one room. Returns null once the host has closed it, which is how
// peers learn the room is gone.
export const findRoomById = async (roomId: string): Promise<Room | null> => {
	const { data, error } = await getSupabase()
		.from('nq_rooms')
		.select('*, nq_profiles!nq_rooms_host_id_fkey(name), nq_room_players(count)')
		.eq('id', roomId)
		.maybeSingle()
	if (error) throw new Error(`Could not read room: ${error.message}`)
	return (data as Room) ?? null
}
