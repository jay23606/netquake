
<template lang="pug">
.game-container
  .launcher-loading(v-if="model.loading")
    .spinner
  template(v-else-if="needsPak")
    PakLoader(@done="needsPak = false")
  template(v-else-if="needsMapDownload")
    MapLoader(:sourceId="sourceId" @done="model.mapLoaded = true")
  template(v-else)
    Game(@quit="gameQuit" :quitRequest="model.isQuitting")
</template>

<script lang="ts">
import { defineComponent } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { joinRoom } from './roomJoin';
import type { RoomId } from '../../../types/Room';
import { useRoomStore } from '../../../stores/room';

interface IInstance extends ComponentPublicInstance {
  quitToPath: string
}
export default defineComponent({
  beforeRouteEnter(to, from, next) {
    next((vm) => {
      const instance = vm as IInstance
      instance.quitToPath = from.path
    })
  }
})
</script>
<script lang="ts" setup>
import Game from '../../page/Game/Game.vue'
import MapLoader from '../../page/Game/MapLoader.vue'
import PakLoader from '../../page/Game/PakLoader.vue'
import {reactive, onMounted, computed, ref} from 'vue'
import { useGameStore } from '../../../stores/game';
import { useMapsStore } from '../../../stores/maps';
import { useRoute, onBeforeRouteLeave, useRouter } from 'vue-router';

const router = useRouter()
const route = useRoute()
const roomId = route.params.roomId as RoomId
const gameStore = useGameStore()
const mapsStore = useMapsStore()
const quitToPath = ref(`/room/${roomId}`)

const model = reactive<{
  loading: boolean,
  mapLoaded: boolean,
  isQuitting: boolean,
}>({
  loading: true,
  mapLoaded: false,
  isQuitting: false,
})

const roomStore = useRoomStore()
const game = computed(() => route.query && route.query['-game'] as string)
const sourceId = computed(() => route.query && route.query['sourceId'] as string)
// Custom room maps require the full game even when already installed; see
// GameLauncher for why the engine's own hook can't be relied on.
const needsPak = ref(false)
const needsMapDownload = computed(() =>
  !model.mapLoaded &&
  !!sourceId.value &&
  !sourceId.value.startsWith('official:') &&
  !gameStore.hasGame(game.value)
)

const gameQuit = (reason?: string) => {
  model.isQuitting = true
  const query = reason ? '?message=' + btoa(reason) : ''
  router.push(quitToPath.value + query)

  // This used to be here to "reload" the entire app, forcing cleanup
  // when webgl didn't cleanup correctly. Not sure it's necessary anymore
  // Downside is we lose router history and the ability to "go back"
  // window.location.href = quitToPath.value
}

onMounted(async () => {
  await joinRoom(route.params.roomId as RoomId, router, roomStore)
  if (sourceId.value && !sourceId.value.startsWith('official:')) {
    await gameStore.loadAssets()
    needsPak.value = !gameStore.hasRegistered
  }
  model.loading = false
})

onBeforeRouteLeave((to, from, next) => {
  if (model.isQuitting) {
    return next()
  }

  const answer = window.confirm('Do you really want to leave?')
  if (answer) {
    model.isQuitting = true
  } else {
    next(false)
  }
})

defineExpose({
  quitToPath
})
</script>

<style lang="scss" scoped>
@import '../../../scss/tokens';

.launcher-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid $palette-border;
  border-top-color: $palette-red;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }
</style>
