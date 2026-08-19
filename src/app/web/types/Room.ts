import { SourceId } from "../../../shared/types/Source"
import { GameDir, MapName } from "../helpers/games"

export type PlayerId = string
export type PlayerToken = string
export type RoomId = string
export type Timestamp = number

export type GameTypes = 'dm' | 'ctf' | 'coop'

export type Map = {
    source: 'direct' | 'quaddicted' | 'slipseer'
}

export type Player = {
    id: PlayerId
    isHost: boolean
    name: string
    joinTime: Timestamp
    status: 'away' | 'available' | 'in-game'
    downloadProgress?: { loaded: number, total: number }
}

export type Room = {
    id: RoomId
    name: string
    hostPlayerId: PlayerId
    visibility: 'single' | 'private' | 'public'
    status: 'lobby' | 'in-game'
    players: Player[]
    maxPlayers: number,
    startMap: string,
    sourceId?: SourceId,
    gameDir?: string,
    createdAt: Timestamp
    gameType: GameTypes
    skill?: number
}

export type GenericSetting = {
    name: string
    command: string
    value: string
}

export type GameSettings = {
    sourceId: SourceId
    gameDir?: GameDir
    startMap: MapName
    gameType: GameTypes
    fragLimit: number
    timeLimit: number
    skill: number
    requiredPackages?: SourceId[]
}

export type ChatMessageContent = {
    tag: 'text',
    message: string
} | {
    tag: 'event',
    type: 'joined' | 'left' | 'kicked' | 'banned' | 'changed-name' | 'timed-out' | 'connection-lost',
    reason?: string
}

export type ChatMessage = {
    playerId: PlayerId
    timestamp: Timestamp
    content: ChatMessageContent
}

export type ChatMessages ={
    messages: ChatMessage[]
    players: Record<PlayerId, Pick<Player, 'name' | 'isHost'>>
}

export type ClientChatMessage = {
    tag: 'chat',
    message: string
}

export type RoomStatusChange = {
    tag: 'room-state',
    state: RoomState
}

export type GameSettingsChange = {
    tag: 'game-settings',
    gameSettings: GameSettings
}

export type RoomState = {
    room: Room | null,
    status: 'unknown' | 'lobby' | 'in-game',
    players: Player[],
    chat: ChatMessages,
    gameSettings: GameSettings,
    currentVote: {
        playerId: PlayerId,
        timestamp: number
    },
    lobbyExpiresAt?: number
}