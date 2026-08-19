<template lang="pug">
.page
  .page-header
    h1.page-title Active Servers
  .refresh-error(v-if="multiplayerStore.refreshError")
    font-awesome-icon.icon(icon="fa-solid fa-circle-exclamation" size="xs")
    |  Error refreshing server list
  ServerList(
    @join="testPrejoin"
    @join-room="joinRoom"
    :loading="model.refreshing"
    :servers="multiplayerStore.getServerStatuses"
    :rooms="roomHubStore.roomList")
    .create-room-row
      QButton(
        @click="model.createState = 'modal-open'"
        :disabled="!gameStore.hasRegistered"
        :tooltipPlacement="TooltipPlacement.Bottom"
        :tooltip="createRoomTooltip"
      ) + Create a Game Room
      a.discord-link(href="https://discord.gg/5c28SZNtff" target="_blank")
        | Looking for players? Join the Discord
  NewRoomModal(
    :playerName="playerStore.playerName"
    v-show="model.createState === 'modal-open'"
    @ok="startCreateRoom"
    @cancel="() => model.createState = 'not-creating'"
  )
Prejoin(
  v-if="model.customizeState.endpoints"
  :showCancel="true"
  okText="Join"
  @cancel="model.customizeState = 'none'"
  @ok="executePrejoin")
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { useMultiplayerStore as _useMultiplayerStore } from '../../../stores/multiplayer'

type CustomizeState = 'none' | ServerStatus | 'customize'
type CreateState = 'not-creating' | 'modal-open' | 'creating'
type Model = {
  refreshing: boolean,
  customizeState: CustomizeState,
  createState: CreateState,
  playersImg: any[]
  message?: string
}
const PREJOIN_KEY = 'Quake.multiplayer.prejoin'
interface IInstance extends ComponentPublicInstance {
  model: Model
}
export default defineComponent({
  beforeRouteEnter(to, from, next) {
    return next(vm => {
      const multiplayerStore = _useMultiplayerStore()
      const instance = vm as IInstance
      instance.model.refreshing = true
      multiplayerStore.refresh().then(() => {
        instance.model.refreshing = false
        multiplayerStore.setAutoRefreshOn()
      })
    })
  }
})
</script>

<script lang="ts" setup>
import { reactive, computed } from 'vue'
import ServerList from './ServerList.vue'
import Prejoin from './Prejoin.vue'
import NewRoomModal from '../Room/NewRoomModal.vue'
import type { CreationParams } from '../Room/NewRoomModal.vue'
import QButton, { TooltipPlacement } from '../../input/QButton.vue'
import { useMultiplayerStore } from '../../../stores/multiplayer'
import { useGameStore } from '../../../stores/game'
import { useRoomHubStore } from '../../../stores/room-hub'
import { usePlayerStore } from '../../../stores/player'
import { getConnectUrl, type ServerStatus } from '../../../stores/multiplayer'
import type { Room } from '../../../types/Room'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { useToast } from 'vue-toastification'

const router = useRouter()
const route = useRoute()
const multiplayerStore = useMultiplayerStore()
const gameStore = useGameStore()
const roomHubStore = useRoomHubStore()
const playerStore = usePlayerStore()
const toast = useToast()

const model = reactive<Model>({
  refreshing: false,
  customizeState: 'none',
  createState: 'not-creating',
  playersImg: [],
  message: route.query.message as string || ''
})

if (model.message) {
  toast.info(atob(model.message))
  router.replace({ query: {} })
}

const serverCount = computed(() => Object.keys(multiplayerStore.getServerStatuses).length)

const testPrejoin = (server: ServerStatus) => {
  if (!localStorage[PREJOIN_KEY]) {
    model.customizeState = server
  } else {
    join(server)
  }
}
const executePrejoin = () => {
  const server = model.customizeState as ServerStatus
  model.customizeState = 'none'
  localStorage[PREJOIN_KEY] = 'done'
  join(server)
}
const join = (server: ServerStatus) => {
  const connectUrl = getConnectUrl(server)
  if (!connectUrl) return
  const query: Record<string, string> = {
    "-connect": connectUrl,
  }
  if (server.game && server.game !== 'id1') {
    query["-game"] = server.game
  }
  router.push({ name: 'quake', query })
}
const joinRoom = (room: Room) => {
  router.push('/room/' + room.id)
}

const createRoomTooltip = computed(() => !gameStore.hasRegistered
  ? "You must load your pak1.pak before\nplaying modified games.\nSee FAQ for details."
  : "Create your own game room\ninvite others, or play by yourself."
)

const startCreateRoom = async (params: CreationParams) => {
  model.createState = 'creating'
  try {
    const roomId = await roomHubStore.createRoom(params)
    router.push(`/room/${roomId}`)
  } catch (error: any) {
    toast.info(error.message, { timeout: 5000 })
  }
  model.createState = 'not-creating'
}

defineExpose({ model })

roomHubStore.autoRefresh = true
roomHubStore.refreshLoop()

if (route.query.error) {
  toast.warning(atob(route.query.error as string))
}

onBeforeRouteLeave((to, from, next) => {
  multiplayerStore.setAutoRefreshOff()
  roomHubStore.autoRefresh = false
  return next()
})
</script>

<style lang="scss" scoped>
@import '../../../scss/tokens';

.page {
  max-width: 1100px;
  margin: 0 auto;
  padding: 48px 48px;

  @media (max-width: 600px) { padding: 24px 12px; }
}

.page-header {
  margin-bottom: $gap-8;
}

.page-title {
  font-size: 28px;
  font-weight: $fw-black;
  color: $palette-bright;
  letter-spacing: -0.02em;
}

.page-count {
  font-size: $font-sm;
  color: $palette-muted;
  margin-top: $gap-1;

  em {
    color: $palette-red;
    font-style: normal;
    font-weight: 700;
  }
}

.refresh-error {
  font-size: $font-sm;
  font-weight: $fw-semibold;
  color: $palette-red;
  margin-bottom: $gap-4;

  .icon { margin-right: 6px; }
}

.create-room-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 16px;
  margin-bottom: 40px;
}

.discord-link {
  font-size: $font-xs;
  font-weight: $fw-semibold;
  color: $palette-muted;
  text-decoration: none;
  transition: $transition-color;
  &:hover { color: $palette-yellow; }
}
</style>

<style lang="scss">
.players-tooltip {
  padding: .1rem;
  text-align: left;
  font-size: .7rem;
}
</style>
