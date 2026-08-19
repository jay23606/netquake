import { defineStore } from "pinia"
import { GameSettings, Player, PlayerId, RoomId, RoomState } from "../types/Room"
import { usePlayerStore } from "./player"

export type RoomConnectionStatus = 'not-connected' | 'connecting' | 'connected'
interface State {
  roomId: RoomId | null,
  roomState: RoomState,
  serverConnection: WebSocket | null
  connectionStatus: RoomConnectionStatus
}

const emptyRoomState = (): RoomState => {
  return {
    room: null,
    status: 'unknown',
    players: [],
    chat: { messages: [], players: {} },
    gameSettings: {
      startMap: '',
      gameType: 'dm',
      sourceId: 'official:original',
      fragLimit: 0,
      timeLimit: 0,
      skill: 1
    },
    currentVote: { playerId: '', timestamp: 0 },
  }
}

export const useRoomStore = defineStore('room', {
    state (): State {
      return {
        roomId: null,
        roomState: emptyRoomState(),
        serverConnection: null,
        connectionStatus: 'not-connected',
      }
    },
    getters: {
      isHost: state => {
        const playerStore = usePlayerStore()

        const roomPlayer = state.roomState?.players.find(player => player.id === playerStore.playerId)
        return roomPlayer?.isHost
      }
    },
    actions: {
      async joinRoom (roomId: RoomId) {
        const playerStore = usePlayerStore()
        const roomStore = useRoomStore()
        await playerStore.ensurePlayer()
        if (!playerStore.playerId || !playerStore.playerToken) {
          console.error('Player ID is not set. Cannot join room.')
          return
        }
        this.connectionStatus = 'connecting'
        this.serverConnection = new WebSocket(
          `${import.meta.env.VITE_ROOM_SERVER_SOCKET_URL}/room/${roomId}/${playerStore.playerId}/join`,
          [playerStore.playerToken!]
        )
        
        this.serverConnection.onclose = (e: CloseEvent) => {
          this.serverConnection = null
          this.roomId = null
          this.roomState = emptyRoomState()
          this.connectionStatus = 'not-connected'
        }

        this.serverConnection.onmessage = (event: MessageEvent) => {
          const roomStore = useRoomStore()
          const data = JSON.parse(event.data)
          if (data.tag === 'room-state') {
            roomStore.roomState = data.state
          }
        }
        this.roomId = roomId
        return new Promise((resolve, reject) => {
          // first message should be success/fail.
          const firstMessageHandler = (event: MessageEvent) => {
            const data = JSON.parse(event.data)
            if (data.success) {
              this.connectionStatus = 'connected'
              resolve(data)
            } else {
              reject(data.error)
            }
          }
          this.serverConnection.addEventListener('message', firstMessageHandler, { once: true })
        })
      },
      leaveRoom () {
        this.serverConnection?.close()
        this.roomId = null
        this.roomState = emptyRoomState()
        this.connectionStatus = 'not-connected'
      },
      sendMessage (content: string) {
        const chatMessage = {
          tag: 'chat',
          message: content
        }
        this.serverConnection?.send(JSON.stringify(chatMessage))
        // return new Promise(resolve => setTimeout(() => {
        //   const chatMessage: ChatMessage = {
        //     playerId: this.playerId,
        //     timestamp: new Date().getTime(),
        //     content
        //   }
        //   stubResponse.chatMessages.push(chatMessage)
        // }, 1000))
      },
      sendGameSettingChange (gameSettings: GameSettings) {
        const gameSettingsChange = {
          tag: 'game-settings',
          gameSettings: gameSettings
        }
        this.serverConnection?.send(JSON.stringify(gameSettingsChange))
      },
      sendAssetProgress (loaded: number, total: number) {
        this.serverConnection?.send(JSON.stringify({ tag: 'asset-progress', loaded, total }))
      },
      // refresh () {
      //   // simulate server call.
      //   this.status = 'loading'
      //   return new Promise((resolve) => setTimeout(resolve, 500))
      //     .then(_ => {
      //       const response = stubResponse
            
      //       this.playerId = response.playerId
      //       this.chatMessages = response.chatMessages
      //       this.gameSettings = response.gameSettings
      //       this.playerList = response.playerList
      //       this.status = 'idle'
      //     })
      // },
      // refreshLoop () {
      //   const work = this.refresh()
      //   return work
      //     .then(() => {
      //       setTimeout(() => {
      //         this.refreshLoop()
      //       }, refreshTime)
      //     })
      // }
    }
  })
  