<template lang="pug">
.game-container
  template(v-if="model.showRequiresPak")
    PakLoader(@done="pakUploaded")
  template(v-else)
    h4#progress Starting Quake...
    canvas#mainwindow
    #loading(style="display: none; position: fixed;")
      img(alt="Loading")
      .loading-message(style="color: burlywood; font-family: monospace; font-weight:bold;background: RGBA(0,0,0,.2); padding: 3px 10px; margin-left: -7px;")
    TouchControls(v-if="isTouchDevice && model.gameSys" :gameSys="model.gameSys")
    button.fullscreen-btn(v-if="isTouchDevice && showFullscreenBtn" @click="enterFullscreen") {{ fullscreenLabel }}

</template>

<script lang="ts" setup>
import {reactive, ref, onMounted, onBeforeUnmount, computed, watch} from 'vue'
import GameInit from '../../../../game'
import * as save from '../../../../../engine/save'
import PakLoader from './PakLoader.vue'
import TouchControls from './TouchControls.vue'

const isTouchDevice = navigator.maxTouchPoints > 0 && window.matchMedia('(pointer: coarse)').matches
import { useGameStore } from '../../../stores/game';
import { useRoute } from 'vue-router';
import { usePlayerStore } from '../../../stores/player';
import { useRoomStore } from '../../../stores/room';

const player = usePlayerStore()
const room = useRoomStore()
const route = useRoute()
const gameStore = useGameStore()
const emit = defineEmits<{
  (e: 'quit', reason?: string): void}
>()

const props = withDefaults(defineProps<{
  quitRequest: boolean
}>(), {quitRequest: false})

const model = reactive<{
  gameSys: any,
  showRequiresPak: boolean,
  uploadResolve: (value: unknown) => void
}>({
  gameSys: null,
  showRequiresPak: false,
  uploadResolve: () => null
})

const args = computed(() => {
  const params = route.query
  return Object.keys(params)
    .map(param => (!!params[param] ? param + ' ' + params[param] : param))
    .join(' ')
})

const pakUploaded = () => {
  model.showRequiresPak = false
  model.uploadResolve(undefined)
}

const showFullscreenBtn = ref(true)
const fullscreenLabel = ref('⛶ Fullscreen')

async function enterFullscreen() {
  const el = document.documentElement as any
  const rfs = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen
  if (!rfs) {
    fullscreenLabel.value = '✗ Not supported'
    return
  }
  try {
    await rfs.call(el)
    showFullscreenBtn.value = false
  } catch (e: any) {
    fullscreenLabel.value = `✗ ${e?.message ?? 'Failed'}`
  }
}

const onFullscreenChange = () => {
  showFullscreenBtn.value = !document.fullscreenElement
}

onMounted(async () => {
  console.log('init game')
  // DEV ONLY (import.meta.hot is undefined in production builds): engine files have no HMR accept
  // handlers, so any engine edit makes Vite fall back to a FULL page reload — which trips the game's
  // window.onbeforeunload quit guard (sys.ts) and pops Chrome's "Leave site?" dialog on every edit.
  // Detach the guard just before Vite's programmatic reload; real navigation keeps the prompt.
  if (import.meta.hot) {
    import.meta.hot.on('vite:beforeFullReload', () => { window.onbeforeunload = null })
  }
  // Background savegame serialization (Ironwail Host_BackgroundSave design): only wired up
  // here in the browser bundle -- src/engine and src/app/game compile under the dedicated
  // server's CommonJS tsconfig, which forbids `new Worker(new URL(..., import.meta.url))`.
  save.state.createSaveWorker = () => new Worker(new URL('../../../../../engine/saveWorker.ts', import.meta.url), { type: 'module' })
  model.gameSys = await GameInit(args.value, {
    // hooks
    quit: (reason?: string) => {
      emit('quit', reason)
    },
    startRequestPak: resolve => {
      model.showRequiresPak = true;
      model.uploadResolve = resolve
    },
    nameChanged: (name: string) => {
      if (gameStore.getAutoexecValue('name') !== name) {
        gameStore.setAutoexecValue({ name: 'name', value: name })
      }
    }
  }, {
    playerId: player.playerId,
    isHost: !!room.isHost,
    socket: room.serverConnection
  })

  if (isTouchDevice) {
    document.addEventListener('fullscreenchange', onFullscreenChange)
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  if (document.fullscreenElement) {
    document.exitFullscreen()
  }
})

watch(props, () => {
  if (props.quitRequest && model.gameSys) {
    model.gameSys.quit()
  }
})
</script>

<style lang="scss">
.game-container {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  overflow: hidden;
}

#progress {
  position: absolute;
  top: 2rem;
  left: 0;
  right: 0;
  text-align: center;
  pointer-events: none;
  z-index: 1;
}

.fullscreen-btn {
  position: absolute;
  top: 14px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  background: rgba(0, 0, 0, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 8px;
  color: rgba(255, 255, 255, 0.9);
  font-size: 14px;
  padding: 0 12px;
  height: 44px;
  white-space: nowrap;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
</style>
