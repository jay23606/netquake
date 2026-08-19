<template lang="pug">
.room-hub
  //- Room cards are now shown in the featured grid above (ServerList)
  .create-row
    QButton(
      @click="model.createState = 'modal-open'"
      :disabled="!hasRegistered"
      :tooltipPlacement="TooltipPlacement.Bottom"
      :tooltip="createTooltipText"
    ) + Create a Game Room
  NewRoomModal(
    :playerName="playerStore.playerName"
    v-show="model.createState === 'modal-open'"
    @ok="startCreate"
    @cancel="() => model.createState = 'not-creating'"
  )
</template>

<script setup lang="ts">
import NewRoomModal from './NewRoomModal.vue'
import { useRoomHubStore } from '../../../stores/room-hub'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { computed, reactive } from 'vue'
import { useToast } from 'vue-toastification'
import QButton, { TooltipPlacement } from '../../input/QButton.vue'
import { usePlayerStore } from '../../../stores/player'

export type CreationParams = {
  roomName: string
  playerName: string
  visibility: 'single' | 'private' | 'public'
}

const playerStore = usePlayerStore()
const route = useRoute()
const router = useRouter()
const toast = useToast()

type CreationState = 'not-creating' | 'modal-open' | 'creating'
type Model = { createState: CreationState }

const roomHubStore = useRoomHubStore()

const emit = defineEmits<{
  (e: 'error', message: string): void
}>()

const model: Model = reactive({ createState: 'not-creating' })

const props = defineProps<{ hasRegistered: boolean }>()

const createTooltipText = computed(() => !props.hasRegistered
  ? "You must load your pak1.pak before\nplaying modified games.\nSee FAQ for details."
  : "Create your own game room\ninvite others, or play by yourself."
)

const startCreate = async (creationParams: CreationParams) => {
  model.createState = 'creating'
  try {
    const roomId = await roomHubStore.createRoom(creationParams)
    router.push(`/room/${roomId}`)
  } catch (error) {
    emit('error', error.message)
  }
  model.createState = 'not-creating'
}

if (route.query.error) {
  toast.warning(atob(route.query.error as string))
}

roomHubStore.autoRefresh = true
roomHubStore.refreshLoop()
onBeforeRouteLeave((to, from, next) => {
  roomHubStore.autoRefresh = false
  return next()
})
</script>

<style lang="scss" scoped>
@import '../../../scss/tokens';

.create-row {
  margin-top: 8px;
}
</style>
