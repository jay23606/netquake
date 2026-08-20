import { defineStore } from 'pinia'
import * as rooms from '../../../shared/supabase/rooms'
import { supabaseConfigured } from '../../../shared/supabase/client'
import type { SupabaseBroker } from "../../../engine/webrtc/SupabaseBroker"

// The broker owns a live Realtime channel and RTCPeerConnections. Vue would
// deep-proxy it if it lived in store state, so it is held outside reactivity
// and reached through getBroker().
let activeBroker: SupabaseBroker | null = null
export const getBroker = (): SupabaseBroker | null => activeBroker

// Room-scoped Realtime subscription, also kept out of reactive state.
let roomUnsub: (() => void) | null = null

// Supabase-backed lobby. Replaces the legacy room-server store (stores/room.ts)
// for peer-to-peer games; the two can coexist while the old path is retired.

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
    async signIn(name: string) {
      const player = await rooms.ensurePlayer(name)
      this.playerId = player.id
      this.playerName = player.name
      return player
    },

    async list() {
      return rooms.listRooms()
    },

    async host(name: string, map = 'e1m1', game: rooms.GameId = 'q1') {
      this.status = 'connecting'
      this.error = null
      try {
        if (!this.playerId) throw new Error('Not signed in')
        this.room = await rooms.createRoom({ name, map, game, hostId: this.playerId })
        // Connect signaling before anyone can join, so no peer is missed.
        activeBroker = await rooms.connectBroker(this.room.id, this.playerId, true)
        this.players = await rooms.listRoomPlayers(this.room.id)
        this.status = 'in-room'
        this.watchRoom()
        void this.refreshChat()
        void rooms.postEvent(this.room.id, this.playerId, 'created the room')
        return this.room
      } catch (e) {
        this.status = 'error'
        this.error = e instanceof Error ? e.message : String(e)
        throw e
      }
    },

    // Join a room already in hand from the lobby list -- no code lookup needed.
    async joinRoom(room: rooms.Room) {
      this.status = "connecting"
      this.error = null
      try {
        if (!this.playerId) throw new Error("Not signed in")
        // Two windows of the same browser share one auth session, so the second
        // is the same player. Signaling then discards the other window's
        // messages as its own echo and no connection is ever made -- a failure
        // with no visible cause, so it is refused up front instead.
        if (room.host_id === this.playerId) {
          throw new Error(
            'You are already the host of this room. A second player needs a '
            + 'separate browser session: open a private/incognito window, or a '
            + 'different browser.')
        }
        await rooms.joinRoom(room.id, this.playerId)
        this.room = room
        activeBroker = await rooms.connectBroker(room.id, this.playerId, false)
        this.players = await rooms.listRoomPlayers(room.id)
        this.status = "in-room"
        this.watchRoom()
        void this.refreshChat()
        void rooms.postEvent(room.id, this.playerId, 'joined')
        return room
      } catch (e) {
        this.status = "error"
        this.error = e instanceof Error ? e.message : String(e)
        throw e
      }
    },

    async join(code: string) {
      this.status = 'connecting'
      this.error = null
      try {
        if (!this.playerId) throw new Error('Not signed in')
        const room = await rooms.findRoomByCode(code)
        if (!room) throw new Error(`No open room with code ${code.toUpperCase()}`)
        await rooms.joinRoom(room.id, this.playerId)
        this.room = room
        activeBroker = await rooms.connectBroker(room.id, this.playerId, false)
        this.players = await rooms.listRoomPlayers(room.id)
        this.status = 'in-room'
        this.watchRoom()
        void this.refreshChat()
        void rooms.postEvent(room.id, this.playerId, 'joined')
        return room
      } catch (e) {
        this.status = 'error'
        this.error = e instanceof Error ? e.message : String(e)
        throw e
      }
    },

    async leave() {
      const room = this.room, playerId = this.playerId
      try {
        if (room && playerId) await rooms.postEvent(room.id, playerId, 'left')
        activeBroker?.close()
        if (room && playerId) await rooms.leaveRoom(room.id, playerId)
      } finally {
        roomUnsub?.()
        roomUnsub = null
        activeBroker = null
        this.room = null
        this.players = []
        this.chat = []
        this.status = 'idle'
      }
    },

    // One subscription per room, covering its row, its players and its chat.
    watchRoom() {
      const room = this.room
      if (!room || roomUnsub) return
      roomUnsub = rooms.subscribeRoom(room.id, {
        room: () => void this.refreshRoom(),
        players: () => void this.refreshPlayers(),
        chat: () => void this.refreshChat(),
      })
    },

    async refreshRoom() {
      if (!this.room) return
      const fresh = await rooms.findRoomById(this.room.id)
      // Null means the host closed the room out from under everyone.
      if (!fresh) {
        this.error = 'The host closed the room.'
        await this.leave()
        return
      }
      this.room = fresh
    },

    async refreshPlayers() {
      if (!this.room) return
      this.players = await rooms.listRoomPlayers(this.room.id)
      // Losing your own row means you were kicked.
      if (this.playerId && !this.players.some((p: rooms.RoomPlayer) => p.player_id === this.playerId)) {
        this.error = 'You were removed from the room.'
        await this.leave()
      }
    },

    async refreshChat() {
      if (!this.room) return
      this.chat = await rooms.listChat(this.room.id)
    },

    // The launch signal. Peers are watching the room row and enter together.
    async launch() {
      if (!this.room) return
      await rooms.setRoomStatus(this.room.id, 'in-game')
    },

    // Host reopening the lobby after a match, so the room can be reused.
    async reopen() {
      if (!this.room) return
      await rooms.setRoomStatus(this.room.id, 'lobby')
    },

    async saveSettings(settings: rooms.GameSettings, map?: string) {
      if (!this.room) return
      await rooms.updateRoom(this.room.id, { game_settings: settings, ...(map ? { map } : {}) })
    },

    async setColor(color: number) {
      if (!this.room || !this.playerId) return
      await rooms.setPlayerColor(this.room.id, this.playerId, color)
    },

    async reportProgress(percent: number) {
      if (!this.room || !this.playerId) return
      await rooms.setAssetProgress(this.room.id, this.playerId, percent)
    },

    async kick(playerId: string) {
      if (!this.room) return
      await rooms.kickPlayer(this.room.id, playerId)
    },

    async ban(playerId: string) {
      if (!this.room) return
      await rooms.banPlayer(this.room.id, playerId)
    },

    async say(body: string) {
      if (!this.room || !this.playerId) return
      await rooms.sendChat(this.room.id, this.playerId, body)
    },
  },
})
