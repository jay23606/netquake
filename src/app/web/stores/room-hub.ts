import { defineStore } from "pinia"
import { Room, RoomId } from "../types/Room"
import { usePlayerStore } from "./player"

interface State {
  status: 'idle' | 'loading' | 'error'
  roomList: Room[]
  currentRoom: null | RoomId // If this user is currently hosting a room.
  autoRefresh: boolean
  loopRunning: boolean
}

const refreshTime = 5000

// const roomApi = '/api/room'

const roomApi = `${import.meta.env.VITE_ROOM_SERVER_URL}/room`

export const useRoomHubStore = defineStore('room-hub', {
    state: (): State => ({
      status: 'loading',
      roomList: [],
      currentRoom: null,
      autoRefresh: false,
      loopRunning: false
    }),
    actions: {
      async createRoom ({roomName, visibility}: {
        roomName: string,
        visibility: 'public' | 'private' | 'single',
      }) {
        const playerStore = usePlayerStore()
        await playerStore.ensurePlayer()
        const roomCreateResponse = await fetch(roomApi, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-player-token': playerStore.playerToken!
          },
          body: JSON.stringify({
            name: roomName,
            visibility,
            hostPlayerId: playerStore.playerId,
          })
        })
        const roomData = await roomCreateResponse.json()
        if (roomCreateResponse.status !== 201) {
          throw new Error(roomData.error || 'Failed to create room')
        }
        return roomData.id
      },
      refresh () {
        this.status = 'loading'
        return fetch(roomApi, {})
          .then(response => {
            if (response.status !== 200) {
              throw new Error('Failed to fetch room list')
            }
            return response.json()
          })
          .then(data => {
            this.roomList = data
            this.status = 'idle'
          })
          .catch(err => {
            console.error('Error fetching room list:', err)
            this.status = 'error'
          })
      },
      refreshLoop () {
        if (this.loopRunning) return
        this.loopRunning = true
        const tick = () => {
          if (!this.autoRefresh) {
            this.loopRunning = false
            return
          }
          this.refresh().then(() => {
            setTimeout(tick, refreshTime)
          })
        }
        tick()
      }
    }
  })
  