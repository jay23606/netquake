import { defineStore } from 'pinia'
import * as rooms from '../../../shared/supabase/rooms'
import { supabaseConfigured } from '../../../shared/supabase/client'
import type { SupabaseBroker } from "../../../engine/webrtc/SupabaseBroker"

// The broker owns a live Realtime channel and RTCPeerConnections. Vue would
// deep-proxy it if it lived in store state, so it is held outside reactivity
// and reached through getBroker().
let activeBroker: SupabaseBroker | null = null
export const getBroker = (): SupabaseBroker | null => activeBroker

// Supabase-backed lobby. Replaces the legacy room-server store (stores/room.ts)
// for peer-to-peer games; the two can coexist while the old path is retired.

type State = {
  playerId: string | null
  playerName: string
  room: rooms.Room | null
  players: rooms.RoomPlayer[]
  status: 'idle' | 'connecting' | 'in-room' | 'error'
  error: string | null
}

export const useSupabaseRoomStore = defineStore('supabaseRoom', {
  state: (): State => ({
    playerId: null,
    playerName: '',
    room: null,
    players: [],
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

    async host(name: string, map = 'e1m1') {
      this.status = 'connecting'
      this.error = null
      try {
        if (!this.playerId) throw new Error('Not signed in')
        this.room = await rooms.createRoom({ name, map, hostId: this.playerId })
        // Connect signaling before anyone can join, so no peer is missed.
        activeBroker = await rooms.connectBroker(this.room.id, this.playerId, true)
        this.players = await rooms.listRoomPlayers(this.room.id)
        this.status = 'in-room'
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
        await rooms.joinRoom(room.id, this.playerId)
        this.room = room
        activeBroker = await rooms.connectBroker(room.id, this.playerId, false)
        this.players = await rooms.listRoomPlayers(room.id)
        this.status = "in-room"
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
        return room
      } catch (e) {
        this.status = 'error'
        this.error = e instanceof Error ? e.message : String(e)
        throw e
      }
    },

    async leave() {
      try {
        activeBroker?.close()
        if (this.room && this.playerId) await rooms.leaveRoom(this.room.id, this.playerId)
      } finally {
        activeBroker = null
        this.room = null
        this.players = []
        this.status = 'idle'
      }
    },
  },
})
