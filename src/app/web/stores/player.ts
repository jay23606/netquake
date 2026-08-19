import { defineStore } from "pinia"
import { useGameStore } from "./game"
import { PlayerId, PlayerToken } from "../types/Room"
import { computed, ref, watch } from "vue"
import { getValueInConfig } from "../helpers/config"

const localDataKey = 'Quake.player.state'
const playerApi = `${import.meta.env.VITE_ROOM_SERVER_URL}/player`

type PlayerState = {
  prejoinSetup: boolean,
} | {
  id: PlayerId,
  token: PlayerToken,
  prejoinSetup: boolean,
}

export const usePlayerStore = defineStore('player', () => {

  let localPlayerState = {prejoinSetup: false}
  try {
    localPlayerState = JSON.parse(window.localStorage[localDataKey])
  } catch (e) { }

  const playerState = ref<PlayerState>(localPlayerState)
  const playerId = computed(() => 'id' in playerState.value ? playerState.value.id : null)
  const playerToken = computed(() => 'token' in playerState.value ? playerState.value.token : null)
  const prejoinSetup = computed(() => playerState.value.prejoinSetup)
  const playerName = computed(() => useGameStore().getAutoexecValue('name') || 'player')
  
  const ensurePlayer = async (): Promise<PlayerId> => {
    if (!playerId.value) {
      return createPlayer(playerName.value)
    }
    await changeName(playerName.value).catch(e =>
      console.warn('[player] name sync failed, continuing with server-side name:', e))
    return playerId.value
  }

  const createPlayer = async (playerName: string) => {
    const playerResponse = await fetch(playerApi, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: playerName
      })
    })

    if (playerResponse.status !== 201) {
      throw new Error('Failed to create player')
    }

    const playerData = await playerResponse.json()
    playerState.value = {
      id: playerData.id,
      token: playerData.token,
      prejoinSetup: playerState.value.prejoinSetup,
    }

    window.localStorage[localDataKey] = JSON.stringify(playerState.value)

    return playerState.value.id
  }
  const changeName = async (playerName: string) => {
    if (playerId.value && playerToken.value) {
      const updateResponse = await fetch(`${playerApi}/${playerId.value}`, {
        method: 'PUT',
        headers: {
          'x-player-token': playerToken.value!,
          'Accept': 'application/json',
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: playerName
        })
      })
      if (updateResponse.status !== 200) {
        throw new Error('Failed to update player')
      }
    }
  }

  const gameStore = useGameStore()

  watch(
    () => gameStore.autoexecFile,
    (newAutoexec, oldAutoexec) => {
      const nameMatch = getValueInConfig(newAutoexec, 'name')?.value
      const oldNameMatch = getValueInConfig(oldAutoexec, 'name')?.value

      if (nameMatch && nameMatch !== oldNameMatch) {
        changeName(nameMatch).catch(e =>
          console.warn('[player] live name sync failed (will reconcile on next join):', e))
      }
    }
  )

  return {
    playerId,
    playerToken,
    prejoinSetup,
    playerName,
    ensurePlayer
  }
})
