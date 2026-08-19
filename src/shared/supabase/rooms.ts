import { getSupabase } from './client'
import { SupabaseBroker } from '../../engine/webrtc/SupabaseBroker'

// Lobby operations against the nq_* tables. Deliberately framework-free so the
// Vue shell can be replaced without touching this.

export type Room = {
	id: string
	code: string
	name: string
	host_id: string
	map: string
	max_players: number
	is_open: boolean
	created_at: string
}

export type RoomPlayer = {
	room_id: string
	player_id: string
	is_host: boolean
	joined_at: string
}

// Unambiguous alphabet: no O/0, I/1, so codes survive being read aloud.
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

	return { id: user.id, name: trimmed }
}

export const listRooms = async (): Promise<Room[]> => {
	const { data, error } = await getSupabase()
		.from('nq_rooms')
		.select('*')
		.eq('is_open', true)
		.order('created_at', { ascending: false })
		.limit(50)
	if (error) throw new Error(`Could not list rooms: ${error.message}`)
	return (data ?? []) as Room[]
}

export const createRoom = async (
	opts: { name: string, map?: string, maxPlayers?: number, hostId: string },
): Promise<Room> => {
	const supabase = getSupabase()
	const room = {
		code: makeCode(),
		name: opts.name,
		host_id: opts.hostId,
		map: opts.map ?? 'e1m1',
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
		.select('*')
		.eq('room_id', roomId)
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
