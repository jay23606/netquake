import { defineStore } from 'pinia'
import type { Message, Room as FoyerRoom, RoomPlayer as FoyerPlayer } from '@jay23606/foyer'
import * as rooms from '../../../shared/supabase/rooms'
import { supabaseConfigured } from '../../../shared/supabase/client'
import { foyer, type NetquakeRoom, type PlayerState, type RoomMeta } from '../../../shared/supabase/foyer'
import type { SupabaseBroker } from '../../../engine/webrtc/SupabaseBroker'

// Supabase-backed lobby, now built on foyer.
//
// What foyer replaced: rooms, players, chat, moderation and identity. What it
// did not is the game signalling broker below. foyer's PeerNet owns its own
// peer connections, while this engine owns them through IWebRTCBroker and wants
// only the offers and candidates -- so adopting PeerNet would mean rewriting
// engine netcode for no gain a player could see.
//
// The store's shape is deliberately unchanged. The lobby component reads
// netquake-shaped rows, so foyer's records are mapped back at this boundary
// rather than rippling a rename through 500 lines of template.

// Both own live channels or RTCPeerConnections, which Vue would deep-proxy if
// they lived in state.
let activeBroker: SupabaseBroker | null = null
export const getBroker = (): SupabaseBroker | null => activeBroker
let handle: NetquakeRoom | null = null
let detach: (() => void)[] = []

const toRoom = (r: FoyerRoom<RoomMeta>): rooms.Room => ({
  id: r.id,
  code: r.code,
  name: r.name,
  host_id: r.hostId,
  map: r.metadata?.map ?? 'e1m1',
  max_players: r.maxPlayers,
  game: r.metadata?.game ?? 'q1',
  game_settings: r.metadata?.settings ?? rooms.defaultGameSettings(),
  status: (r.status === 'in-game' ? 'in-game' : 'lobby') as rooms.RoomStatus,
  is_open: r.isOpen,
  created_at: r.createdAt,
  nq_room_players: [{ count: r.playerCount }],
  nq_profiles: { name: r.hostName },
})

const fromHandle = (h: NetquakeRoom, previous: rooms.Room | null): rooms.Room => ({
  ...(previous ?? ({} as rooms.Room)),
  id: h.id,
  code: h.code,
  name: h.name,
  host_id: h.hostId,
  max_players: h.maxPlayers,
  is_open: h.isOpen,
  created_at: h.createdAt,
  map: h.metadata?.map ?? previous?.map ?? 'e1m1',
  game: h.metadata?.game ?? previous?.game ?? 'q1',
  game_settings: h.metadata?.settings ?? previous?.game_settings ?? rooms.defaultGameSettings(),
  status: (h.status === 'in-game' ? 'in-game' : 'lobby') as rooms.RoomStatus,
  nq_room_players: [{ count: h.players.length }],
})

const toPlayer = (roomId: string, p: FoyerPlayer<PlayerState>): rooms.RoomPlayer => ({
  room_id: roomId,
  player_id: p.id,
  is_host: p.isHost,
  joined_at: p.joinedAt,
  color: p.state?.color ?? 0,
  asset_progress: p.state?.assetProgress ?? 0,
  nq_profiles: { name: p.name },
})

const toChat = (roomId: string, m: Message): rooms.ChatMessage => ({
  id: m.id,
  room_id: roomId,
  player_id: m.playerId,
  kind: m.system ? 'event' : 'text',
  body: m.body,
  created_at: m.createdAt,
  nq_profiles: { name: m.playerName },
})

type State = {
  playerId: string | null
  playerName: string
  room: rooms.Room | null
  players: rooms.RoomPlayer[]
  chat: rooms.ChatMessage[]
  status: 'idle' | 'connecting' | 'in-room' | 'error'
  error: string | null
}

export const useSupabaseRoomStore = defineStore('supabaseRoom', {
  state: (): State => ({
    playerId: null,
    playerName: '',
    room: null,
    players: [],
    chat: [],
    status: 'idle',
    error: null,
  }),

  getters: {
    available: () => supabaseConfigured(),
    isHost: (s) => !!s.room && s.room.host_id === s.playerId,
  },

  actions: {
    // Ends the session so this browser can become a different player. Auto
    // sign-in otherwise leaves no way to change who you are.
    async signOut() {
      try {
        if (this.room) await this.leave()
      } finally {
        await foyer().signOut()
        this.playerId = null
        this.playerName = ''
        this.players = []
        this.chat = []
        this.error = null
        this.status = 'idle'
      }
    },

    async signIn(name: string) {
      const player = await foyer().signIn(name)
      this.playerId = player.id
      this.playerName = player.name
      return player
    },

    async list() {
      const open = await foyer().listRooms<RoomMeta>()
      return open.map(toRoom)
    },

    async host(name: string, map = 'e1m1', game: rooms.GameId = 'q1') {
      this.status = 'connecting'
      this.error = null
      try {
        if (!this.playerId) throw new Error('Not signed in')
        handle = await foyer().createRoom<RoomMeta>({
          name,
          metadata: { map, game, settings: rooms.defaultGameSettings() },
          maxPlayers: 8,
        })
        this.room = fromHandle(handle, null)
        // Signalling comes up before anyone can join, so no peer is missed.
        activeBroker = await rooms.connectBroker(handle.id, this.playerId, true)
        this.watchRoom()
        await handle.say('created the room', true)
        this.status = 'in-room'
        return this.room
      } catch (e) {
        this.status = 'error'
        this.error = e instanceof Error ? e.message : String(e)
        throw e
      }
    },

    // Join a room already in hand from the lobby list.
    async joinRoom(room: rooms.Room) {
      // Two windows of the same browser share one auth session, so the second
      // is the same player. Signalling then discards the other window's
      // messages as its own echo and no connection is ever made -- a failure
      // with no visible cause, so it is refused up front.
      if (room.host_id === this.playerId) {
        throw new Error(
          'You are already the host of this room. A second player needs a '
          + 'separate browser session: open a private/incognito window, or a '
          + 'different browser.')
      }
      return this.enter(room.id)
    },

    async join(code: string) {
      return this.enter(code.toUpperCase())
    },

    // Shared by both entry points; foyer resolves an id or a room code.
    async enter(idOrCode: string) {
      this.status = 'connecting'
      this.error = null
      try {
        if (!this.playerId) throw new Error('Not signed in')
        handle = await foyer().join<RoomMeta>(idOrCode)
        // The same guard as joinRoom, for the by-code path where the caller
        // had no row to check first.
        if (handle.hostId === this.playerId) {
          await handle.leave()
          handle = null
          throw new Error(
            'You are already the host of this room. A second player needs a '
            + 'separate browser session: open a private/incognito window, or a '
            + 'different browser.')
        }
        this.room = fromHandle(handle, null)
        activeBroker = await rooms.connectBroker(handle.id, this.playerId, false)
        this.watchRoom()
        this.status = 'in-room'
        return this.room
      } catch (e) {
        this.status = 'error'
        this.error = e instanceof Error ? e.message : String(e)
        throw e
      }
    },

    async leave() {
      try {
        activeBroker?.close()
        await handle?.leave()
      } finally {
        detach.forEach(fn => fn())
        detach = []
        handle = null
        activeBroker = null
        this.room = null
        this.players = []
        this.chat = []
        this.status = 'idle'
      }
    },

    // foyer pushes rooms, players and chat; nothing here polls.
    watchRoom() {
      const h = handle
      if (!h || detach.length) return

      detach.push(h.on('players', players => {
        // Mapped once into a local: reading back through this.players inside
        // the closure loses its element type to Pinia's `this` inference.
        const mapped = players.map(p => toPlayer(h.id, p as FoyerPlayer<PlayerState>))
        this.players = mapped
        this.room = fromHandle(h, this.room)
        // Losing your own row means you were kicked.
        if (this.playerId && !mapped.some(p => p.player_id === this.playerId)) {
          this.error = 'You were removed from the room.'
          void this.leave()
        }
      }))

      detach.push(h.on('metadata', () => { this.room = fromHandle(h, this.room) }))
      detach.push(h.on('status', () => { this.room = fromHandle(h, this.room) }))
      detach.push(h.on('message', m => {
        // History and the realtime insert both carry a message the moment it
        // is posted, so the same row arrived twice and appeared twice.
        // Typed locally: reading this.chat inside the closure loses its
        // element type to Pinia's `this` inference.
        const existing: rooms.ChatMessage[] = this.chat
        if (existing.some(c => c.id === m.id)) return
        this.chat = [...existing, toChat(h.id, m)]
      }))
      detach.push(h.on('closed', () => {
        this.error = 'The host closed the room.'
        void this.leave()
      }))

      this.players = h.players.map(p => toPlayer(h.id, p as FoyerPlayer<PlayerState>))
      void this.refreshChat()
    },

    // Kept for callers that still ask; foyer already pushes all three.
    async refreshRoom() {
      if (handle) this.room = fromHandle(handle, this.room)
    },

    async refreshPlayers() {
      const h = handle
      if (h) this.players = h.players.map(p => toPlayer(h.id, p as FoyerPlayer<PlayerState>))
    },

    async refreshChat() {
      const h = handle
      if (!h) return
      const history = await h.history()
      this.chat = history.map(m => toChat(h.id, m))
    },

    // The launch signal. Peers watch the room's status and enter together.
    async launch() { await handle?.update({ status: 'in-game' }) },

    // Host reopening the lobby after a match, so the room can be reused.
    async reopen() { await handle?.update({ status: 'lobby' }) },

    async saveSettings(settings: rooms.GameSettings, map?: string) {
      const h = handle
      if (!h) return
      await h.update({
        metadata: {
          map: map ?? h.metadata?.map ?? 'e1m1',
          game: h.metadata?.game ?? 'q1',
          settings,
        },
      })
    },

    async setColor(color: number) {
      const h = handle
      if (!h) return
      const state = h.players.find(p => p.id === this.playerId)?.state ?? {}
      await h.setPlayerState({ ...state, color })
    },

    async reportProgress(percent: number) {
      const h = handle
      if (!h) return
      const state = h.players.find(p => p.id === this.playerId)?.state ?? {}
      await h.setPlayerState({ ...state, assetProgress: percent })
    },

    async kick(playerId: string) { await handle?.kick(playerId) },
    async ban(playerId: string) { await handle?.ban(playerId) },
    async say(body: string) { await handle?.say(body) },
  },
})
