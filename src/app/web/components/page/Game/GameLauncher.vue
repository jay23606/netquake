
<template lang="pug">
.game-container
  .launcher-loading(v-if="model.loading")
    .spinner
  template(v-else-if="model.needsPak")
    PakLoader(@done="pakReady")
  template(v-else-if="needsMapDownload && !model.mapLoaded")
    MapLoader(:sourceId="sourceId" @done="mapDone")
  template(v-else)
    Game(@quit="gameQuit" :quitRequest="model.isQuitting")
</template>

<script lang="ts" setup>
import type { SourceId } from '../../../../../shared/types/Source';
import Game from './Game.vue'
import MapLoader from './MapLoader.vue'
import PakLoader from './PakLoader.vue'
import {reactive, onMounted, computed, ref} from 'vue'
import GameInit from '../../../../game'
import { useGameStore } from '../../../stores/game';
import { useMapsStore } from '../../../stores/maps';
import { guessStartMap } from '../../../helpers/map';
import { useRoute, onBeforeRouteLeave, useRouter } from 'vue-router';
import { mapState } from 'pinia';

const router = useRouter()
const route = useRoute()
const gameStore = useGameStore()
const mapsStore = useMapsStore()

const model = reactive<{
  loading: boolean,
  mapLoaded: boolean,
  isQuitting: boolean,
  needsPak: boolean,
  onQuit: (() => void) | null,
}>({
  loading: true,
  mapLoaded: false,
  isQuitting: false,
  needsPak: false,
  onQuit: null,
})

const sourceId = computed(() => route.query && route.query['sourceId'] as SourceId)
const needsMapDownload = ref(false)

// Bare launch URLs (/quake?sourceId=...) carry no engine args: fill in
// -game from the installed package and +map from its map list, so external
// links only need the sourceId. Explicit query params always win.
const ensureLaunchArgs = async (pkg: { packageId: number, gameDir: string }) => {
  const query = { ...route.query }
  const patch: Record<string, string> = {}
  if (!query['+map']) {
    const maps = await mapsStore.getMapListForPackage(pkg.packageId)
    const start = guessStartMap(maps)
    if (start) patch['+map'] = start
  }
  if (!query['-game'] && pkg.gameDir && pkg.gameDir !== 'id1') {
    patch['-game'] = pkg.gameDir
  }
  if (Object.keys(patch).length) {
    await router.replace({ query: { ...query, ...patch } })
  }
}

const mapDone = async () => {
  if (sourceId.value) {
    const pkg = await mapsStore.loadPackageMeta(sourceId.value)
    if (pkg) await ensureLaunchArgs(pkg)
  }
  model.mapLoaded = true
}

const gameQuit = (reason?: string) => {
  model.isQuitting = true
  // vue-router records the previous route's fullPath in history state; it
  // survives page reloads, so quit returns to the launching page without this
  // component having to know where games launch from
  const back = router.options.history.state.back
  const quitToPath = typeof back === 'string' ? back : '/'
  const query = reason ? (quitToPath.includes('?') ? '&' : '?') + 'message=' + btoa(reason) : ''
  router.push(quitToPath + query)

  // This used to be here to "reload" the entire app, forcing cleanup
  // when webgl didn't cleanup correctly. Not sure it's necessary anymore
  // Downside is we lose router history and the ability to "go back"
  // window.location.href = quitToPath
}

// Custom maps require the full game regardless of whether the package is
// already installed — an id1-gameDir map on shareware assets boots without
// ever tripping the engine's own late-registration hook, so the policy gate
// has to live here, ahead of both the install and the launch.
onMounted(async () => {
  if (!sourceId.value) {
    model.loading = false
    return
  }

  await gameStore.loadAssets()
  if (!gameStore.hasRegistered) {
    model.needsPak = true
    model.loading = false
    return
  }
  continueInit()
})

const pakReady = () => {
  model.needsPak = false
  model.loading = true
  continueInit()
}

const continueInit = () => {
  if (!sourceId.value) return
  mapsStore.loadPackageMeta(sourceId.value)
    .then(async (pkg) => {
      needsMapDownload.value = !pkg
      if (pkg) await ensureLaunchArgs(pkg)
      model.loading = false
    })
    .catch(() => {
      model.loading = false
    })
}

onBeforeRouteLeave((to, from, next) => {
  if (model.isQuitting) {
    return next()
  }

  const answer = window.confirm('Do you really want to leave?')
  if (answer) {
    model.onQuit = next
    model.isQuitting = true
  } else {
    next(false)
  }
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
