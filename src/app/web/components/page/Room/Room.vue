<template lang="pug">
.room-page
  //- Loading
  .loading-state(v-if="roomStore.connectionStatus !== 'connected'")
    .loading.loading-lg

  template(v-else)
    //- Download overlay (peers downloading map before game starts)
    .download-overlay(v-if="model.downloadingMap")
      .download-inner
        .download-title {{ isUnzipping ? 'Unzipping package…' : 'Downloading map…' }}
        .download-progress-track
          .download-progress-fill(:style="{ width: downloadPercent + '%' }")
        .download-progress-meta
          span.download-message {{ mapsStore.mapLoadProgress.message }}
          span.download-kb(v-if="downloadKb") {{ downloadKb }}
        .download-error(v-if="model.mapDownloadError") {{ model.mapDownloadError }}

    //- Lobby header
    .lobby-header
      .lobby-meta
        .lobby-title {{ roomStore.roomState.room?.name }}{{ startMap ? ' — ' + startMap : '' }}
        .lobby-sub
          | Hosted by&nbsp;
          em(v-html="quakeTextToHtml(hostName)")
          | &nbsp;·&nbsp;{{ gameTypeLabel }}&nbsp;·&nbsp;
          em {{ roomStore.roomState.players.length }}
          | /{{ roomStore.roomState.room?.maxPlayers ?? '?' }} players
          template(v-if="roomStore.roomState.status === 'lobby' && countdownLabel")
            | &nbsp;·&nbsp;Lobby closes in&nbsp;
            span.lobby-timeout(:class="{ urgent: countdownUrgent }") {{ countdownLabel }}
      .lobby-actions
        button.btn-launch(
          v-if="roomStore.isHost && !model.downloadingMap"
          @click="launchGame"
        ) ▶ Launch Game
        button.btn-join(
          v-else-if="roomStore.roomState.status === 'in-game' && !model.downloadingMap"
          @click="startLaunchFlow"
        ) ▶ Join Game
        button.btn-leave(@click="leaveRoom()") Leave

    //- Main 3-column grid
    .lobby-grid
      //- Players column
      .col.players-col
        .col-head
          | Players&nbsp;
          strong {{ roomStore.roomState.players.length }}
          span /{{ roomStore.roomState.room?.maxPlayers ?? '?' }}
        .players-list
          PlayerList(:players="roomStore.roomState.players")

      //- Chat column
      .col.chat-col
        .col-head Chat
        ChatBox(:chat="roomStore.roomState.chat || {}" @send="roomStore.sendMessage")

      //- Settings column
      .col.settings-col
        .col-head Game Settings
        .settings-body
          EditGameSettings(
            v-if="roomStore.isHost && roomStore.roomState.gameSettings"
            :modelValue="roomStore.roomState.gameSettings"
            :isHost="true"
            @update:modelValue="roomStore.sendGameSettingChange"
          )
          ViewGameSettings(
            v-else-if="roomStore.roomState.gameSettings"
            :setting="roomStore.roomState.gameSettings"
          )
        .status-bar
          .status-live
            .status-dot
            | {{ roomStore.roomState.status === 'in-game' ? 'In game' : 'Lobby open' }}
          span.status-text {{ statusText }}
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoomStore } from '../../../stores/room'
import { useMapsStore } from '../../../stores/maps'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { joinRoom } from './roomJoin'
import { useToast } from 'vue-toastification'
import { getMapGameQueryParams } from '../../../helpers/map'
import { quakeTextToHtml } from '../../../util/quakeText'
import ChatBox from './components/chat-box/ChatBox.vue'
import PlayerList from './components/player-list/PlayerList.vue'
import EditGameSettings from './components/game-settings/EditGameSettings.vue'
import ViewGameSettings from './components/game-settings/ViewGameSettings.vue'

const router = useRouter()
const route = useRoute()
const roomStore = useRoomStore()
const mapsStore = useMapsStore()
const toast = useToast()

const model = reactive({
  roomId: route.params.id as string,
  message: route.query.message as string || '',
  clickToLeave: false,
  downloadingMap: false,
  mapDownloadError: null as string | null,
})

if (model.message) {
  toast.info(atob(model.message))
  router.replace({ query: {} })
}

const roomStatus = ref<'unknown' | 'lobby' | 'in-game'>(roomStore.roomState.status)
roomStore.$subscribe((mutation, state) => {
  if (state.connectionStatus === 'not-connected') {
    if (!model.clickToLeave) leaveRoom('You left the room.')
  } else if (roomStatus.value !== 'in-game' && state.roomState.status === 'in-game') {
    startLaunchFlow()
  }
  roomStatus.value = state.roomState.status
})

const addCommas = (x: number) => x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const isUnzipping = computed(() => mapsStore.mapLoadProgress.phase === 'unzip')

// Monotonic 0-100 spanning download and unzip.
const downloadPercent = computed(() => mapsStore.getOverallLoadPercent ?? 0)
// Units follow the phase: bytes while downloading, files while unzipping.
const downloadKb = computed(() => {
  const { phase, loaded, total } = mapsStore.mapLoadProgress
  if (!total) return ''
  if (phase === 'unzip') return `${Math.floor(loaded)} / ${total} files`
  return `${addCommas(Math.floor(loaded / 1024))} / ${addCommas(Math.floor(total / 1024))} KB`
})

const hostName = computed(() => roomStore.roomState.players.find(p => p.isHost)?.name ?? '')

const now = ref(Date.now())
let tickTimer: ReturnType<typeof setInterval> | null = null

const secondsRemaining = computed(() => {
  const exp = roomStore.roomState.lobbyExpiresAt
  if (!exp || roomStore.roomState.status === 'in-game') return null
  return Math.max(0, Math.floor((exp - now.value) / 1000))
})
const countdownLabel = computed(() => {
  const s = secondsRemaining.value
  if (s === null || s > 300) return null
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
})
const countdownUrgent = computed(() => secondsRemaining.value !== null && secondsRemaining.value < 120)
const startMap = computed(() => roomStore.roomState.gameSettings?.startMap ?? '')
const gameTypeLabel = computed(() => {
  switch (roomStore.roomState.gameSettings?.gameType) {
    case 'dm':   return 'Deathmatch'
    case 'coop': return 'Cooperative'
    default:     return ''
  }
})
const statusText = computed(() => {
  if (roomStore.isHost) return 'You are the host'
  if (roomStore.roomState.status === 'in-game') return 'Game in progress — you can join'
  return 'Waiting for host to launch'
})

const navigateToGame = () => {
  let query = getMapGameQueryParams({
    sourceId: roomStore.roomState.gameSettings.sourceId,
    gameDir: roomStore.roomState.gameSettings.gameDir,
    map: roomStore.roomState.gameSettings.startMap,
  })
  if (roomStore.isHost) {
    switch (roomStore.roomState.gameSettings.gameType) {
      case 'coop':
        query = { ...query, '-coop': '1', '-skill': roomStore.roomState.gameSettings.skill.toString() }
        break
      case 'dm':
        query = {
          ...query,
          '-timelimit': roomStore.roomState.gameSettings.timeLimit.toString(),
          '-fraglimit': roomStore.roomState.gameSettings.fragLimit.toString(),
        }
        break
    }
    query = { ...query, '-listen': '16' }
  } else {
    query = { ...query, '-connect': 'rtc://netquake.io/room' }
  }
  router.push({ name: 'room-game', params: { roomId: model.roomId }, query })
}

let launchFlowCancelled = false

const startLaunchFlow = async () => {
  launchFlowCancelled = false
  const sourceId = roomStore.roomState.gameSettings?.sourceId
  if (!sourceId || sourceId.startsWith('official:')) {
    navigateToGame()
    return
  }
  // Check if already downloaded
  const existing = await mapsStore.loadPackageMeta(sourceId)
  if (launchFlowCancelled) return
  if (existing) {
    navigateToGame()
    return
  }
  // Download map (and dependency) before joining the game
  model.downloadingMap = true
  model.mapDownloadError = null
  // Forward a unit-free monotonic percent; only fires when the value changes.
  const progressWatcher = watch(() => mapsStore.getOverallLoadPercent, (pct) => {
    if (pct !== null) roomStore.sendAssetProgress(pct, 100)
  })
  try {
    await mapsStore.loadMap(sourceId)
    if (!launchFlowCancelled) navigateToGame()
  } catch (e: any) {
    // A deliberate cancel (ours or another view's, via the shared deduped
    // load) is not a failure.
    if (!launchFlowCancelled && e?.name !== 'AbortError') model.mapDownloadError = e?.message || 'Download failed'
  } finally {
    progressWatcher()
    model.downloadingMap = false
    roomStore.sendAssetProgress(0, 0)
  }
}

const leaveRoom = (reason?: string) => {
  const base64Message = reason ? btoa(reason) : undefined
  model.clickToLeave = true
  router.replace('/multiplayer' + (base64Message ? `?message=${base64Message}` : ''))
}

// Called when the host clicks the Launch button.
// Sends the launch signal to the room server which broadcasts 'in-game' to everyone
// including the host. The host's own subscriber then calls startLaunchFlow() like any peer.
const launchGame = () => {
  roomStore.serverConnection?.send(JSON.stringify({ tag: 'launch' }))
}

watch(secondsRemaining, (v) => {
  if (v === 0 && roomStore.roomState.status === 'lobby') {
    toast.info('The lobby closed due to inactivity.')
    leaveRoom()
  }
})

onMounted(() => {
  joinRoom(model.roomId, router, roomStore)
  tickTimer = setInterval(() => { now.value = Date.now() }, 1000)
})

onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer)
})

onBeforeRouteLeave((to, from, next) => {
  if (to.name === 'room-game' || roomStore.connectionStatus === 'not-connected') return next()
  const answer = model.clickToLeave || roomStore.connectionStatus === 'connecting' || window.confirm('Do you want to leave this room?')
  if (answer) { launchFlowCancelled = true; roomStore.leaveRoom(); next() } else { next(false) }
})
</script>

<style lang="scss" scoped>
@import '../../../scss/tokens';

.room-page {
  max-width: 1100px;
  margin: 0 auto;
  padding: 32px 48px 48px;
  @media (max-width: 768px) { padding: 24px; }
}

.loading-state {
  display: flex;
  justify-content: center;
  padding: 80px 0;
}

.download-overlay {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 0;
  margin-bottom: 16px;
  background: $palette-surface;
  border: $border-subtle;
}

.download-inner {
  width: 100%;
  max-width: 480px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 24px;
}

.download-title {
  font-size: $font-sm;
  font-weight: $fw-bold;
  color: $palette-bright;
  text-transform: uppercase;
  letter-spacing: $tracking-links;
}

.download-progress-track {
  width: 100%;
  height: 3px;
  background: $palette-border;
}

.download-progress-fill {
  height: 100%;
  background: $palette-red;
  transition: width 0.3s ease;
  min-width: 2px;
}

.download-progress-meta {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.download-message {
  font-size: $font-xs;
  color: $palette-muted;
}

.download-kb {
  font-size: $font-xs;
  font-weight: $fw-semibold;
  color: $palette-text;
  font-family: 'JetBrains Mono', monospace;
  white-space: nowrap;
  flex-shrink: 0;
}

.download-error {
  font-size: $font-xs;
  color: $palette-red;
}

/* ── Lobby header ── */
.lobby-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
  gap: 16px;
  @media (max-width: 560px) { flex-direction: column; align-items: flex-start; }
}

.lobby-title {
  font-size: 22px;
  font-weight: $fw-black;
  color: $palette-bright;
  letter-spacing: -0.02em;
}

.lobby-sub {
  font-size: $font-sm;
  color: $palette-muted;
  margin-top: 3px;
  em { color: $palette-text; font-style: normal; }
}

.lobby-actions { display: flex; gap: 10px; }

.btn-launch {
  font-family: inherit;
  font-size: 14px;
  font-weight: $fw-extrabold;
  letter-spacing: $tracking-links;
  text-transform: uppercase;
  padding: 12px 32px;
  background: $palette-red;
  color: $palette-bright;
  border: none;
  cursor: pointer;
  transition: $transition-bg;
  &:hover { background: lighten($palette-red, 6%); }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
}

.btn-join {
  font-family: inherit;
  font-size: 14px;
  font-weight: $fw-extrabold;
  letter-spacing: $tracking-links;
  text-transform: uppercase;
  padding: 12px 32px;
  background: $palette-yellow;
  color: #111;
  border: none;
  cursor: pointer;
  transition: $transition-bg;
  &:hover { background: lighten($palette-yellow, 6%); }
}

.btn-leave {
  font-family: inherit;
  font-size: $font-sm;
  font-weight: $fw-bold;
  letter-spacing: $tracking-links;
  text-transform: uppercase;
  padding: 12px 20px;
  background: transparent;
  border: $border-subtle;
  color: $palette-muted;
  cursor: pointer;
  transition: all 0.15s;
  &:hover { border-color: $palette-red; color: $palette-red; }
}

/* ── Main grid ── */
.lobby-grid {
  display: grid;
  grid-template-columns: 220px 1fr 260px;
  gap: 16px;
  height: 560px;

  @media (max-width: 900px) {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto auto;
    height: auto;
    .players-col  { grid-column: 1; grid-row: 1; }
    .settings-col { grid-column: 2; grid-row: 1; }
    .chat-col     { grid-column: 1 / 3; grid-row: 2; min-height: 320px; }
  }
  @media (max-width: 560px) {
    grid-template-columns: 1fr;
    .players-col, .chat-col, .settings-col { grid-column: 1; grid-row: auto; }
  }
}

.col {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.col-head {
  font-size: $font-2xs;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: $tracking-labels;
  color: $palette-muted;
  padding: 10px 14px;
  border: $border-subtle;
  border-bottom: none;
  background: $palette-body;
  flex-shrink: 0;

  strong { color: $palette-bright; font-weight: $fw-extrabold; }
  span   { color: $palette-muted; }
}

/* ── Players column ── */
.players-list {
  border: $border-subtle;
  flex: 1;
  overflow-y: auto;
}

/* ── Settings column ── */
.settings-body {
  border: $border-subtle;
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.status-bar {
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: $palette-surface;
  border: $border-subtle;
  border-top: none;
  font-size: $font-xs;
}

.status-live {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: $fw-semibold;
  color: #4a9e4a;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #4a9e4a;
  animation: pulse 1.8s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.3; }
}

.status-text { color: $palette-muted; }

.lobby-timeout {
  font-family: 'JetBrains Mono', monospace;
  color: $palette-muted;
  transition: color 0.3s;
  &.urgent { color: $palette-red; }
}
</style>
