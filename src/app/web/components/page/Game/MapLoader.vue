<template lang="pug">
PakLoader(v-if="model.needsPak" @done="pakReady")
.map-loader(v-else)
  .loader-inner(v-if="model.loading")
    .spinner
    p.loader-label Fetching map list…

  .loader-inner(v-else-if="model.error")
    font-awesome-icon.error-icon(icon="fa-solid fa-circle-exclamation")
    p.error-title Failed to load map
    p.error-msg {{ model.error }}

  .loader-inner(v-else)
    .loader-header
      p.loader-source {{ sourceLabel }}
      h2.loader-title {{ model.map?.title }}
    .progress-wrap
      .progress-track
        .progress-fill(:style="{ width: progressPercent + '%' }")
    .loader-meta
      span.loader-message {{ mapsStore.getMapLoadProgress.message }}
      span.loader-kb(v-if="loadedKb") {{ loadedKb }}
</template>

<script lang="ts" setup>
import { reactive, onMounted, computed, watch } from 'vue'
import PakLoader from './PakLoader.vue'
import { useMapsStore } from '../../../stores/maps'
import { useGameStore } from '../../../stores/game'
import { useRoomStore } from '../../../stores/room'
import type { QuaddictedMap } from '../../../types/QuaddictedMap'
import type { SourceId } from '../../../../../shared/types/Source'

const mapsStore = useMapsStore()
const gameStore = useGameStore()
const roomStore = useRoomStore()

// Report install progress to the room server so other players can see it.
// getOverallLoadPercent is a monotonic integer spanning download and unzip,
// so peers get a unit-free ratio and this only sends when the value changes.
watch(() => mapsStore.getOverallLoadPercent, (pct, oldPct) => {
  if (!roomStore.serverConnection) return
  if (pct === null) {
    if (oldPct !== null) roomStore.sendAssetProgress(0, 0) // clear progress
  } else {
    roomStore.sendAssetProgress(pct, 100)
  }
})

const emit = defineEmits<{ (e: 'done'): void }>()

const props = defineProps<{ sourceId: SourceId }>()

const sourceLabels: Record<string, string> = {
  quaddicted: 'Quaddicted',
  slipseer: 'Slipseer',
  custom: 'Custom'
}
const sourceLabel = computed(() => sourceLabels[props.sourceId.split(':')[0]] ?? '')

const model = reactive<{
  map: QuaddictedMap | null
  error: string
  loading: boolean
  needsPak: boolean
}>({
  map: null,
  error: '',
  loading: true,
  needsPak: false,
})

const addCommas = (x: number) => x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')

// Units follow the phase: bytes while downloading, files while unzipping.
const loadedKb = computed(() => {
  const { phase, loaded, total } = mapsStore.getMapLoadProgress
  if (!total) return ''
  if (phase === 'unzip') return `${Math.floor(loaded)} / ${total} files`
  return `${addCommas(Math.floor(loaded / 1024))} / ${addCommas(Math.floor(total / 1024))} KB`
})

const progressPercent = computed(() => mapsStore.getOverallLoadPercent ?? 0)

// Custom maps assume the full game's assets; without pak1 the engine falls
// over mid-load, and by then a multi-hundred-MB download has already run.
// Gate before downloading anything: loadAssets first, because on a direct
// link load App.vue's own loadAssets may not have finished yet and
// hasRegistered would read false for a registered user.
onMounted(async () => {
  await gameStore.loadAssets()
  if (!gameStore.hasRegistered) {
    model.needsPak = true
    return
  }
  startLoad()
})

const pakReady = () => {
  model.needsPak = false
  startLoad()
}

const startLoad = () => {
  const [_quaddicted, mapId] = props.sourceId.split(':')
  mapsStore.loadMapListing()
    .catch(e => {
      model.loading = false
      model.error = 'Error loading map list: ' + e.message
      return Promise.reject(e)
    })
    .then(async () => {
      model.map = mapsStore.getMapFromId(mapId)
      if (!model.map) {
        // A slipseer release newer than the daily index: the detail endpoint
        // inspects on demand, so ask it directly before giving up. This can
        // take a while (server mirrors the zip on first sight) — the
        // "Fetching map list" spinner stays up meanwhile.
        model.map = await mapsStore.downloadSourceMetadata(props.sourceId).catch((): null => null)
      }
      model.loading = false
      if (model.map) {
        return mapsStore.loadMap(props.sourceId)
          .then(() => {
            roomStore.sendAssetProgress(0, 0) // clear progress
            emit('done')
          })
          .catch(e => {
            // A deliberate cancel (possibly from another view sharing this
            // deduped load) is not an error.
            if (e?.name === 'AbortError') return
            model.error = 'Error loading map: ' + e.message
          })
      } else {
        model.error = 'Map not recognised'
      }
    })
}
</script>

<style lang="scss" scoped>
@import '../../../scss/tokens';

.map-loader {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 320px;
  padding: 48px 24px;
}

.loader-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  width: 100%;
  max-width: 480px;
  text-align: center;
}

// Loading state
.spinner {
  width: 36px;
  height: 36px;
  border: 3px solid $palette-border;
  border-top-color: $palette-red;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

.loader-label {
  font-size: $font-sm;
  color: $palette-muted;
}

// Error state
.error-icon {
  font-size: 32px;
  color: $palette-red;
}

.error-title {
  font-size: $font-base;
  font-weight: $fw-bold;
  color: $palette-bright;
}

.error-msg {
  font-size: $font-sm;
  color: $palette-muted;
  line-height: 1.6;
}

// Progress state
.loader-header { margin-bottom: 8px; }

.loader-source {
  font-size: $font-2xs;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: $tracking-labels;
  color: $palette-red;
  margin-bottom: 6px;
}

.loader-title {
  font-size: $font-md;
  font-weight: $fw-black;
  color: $palette-bright;
  letter-spacing: -0.01em;
}

.progress-wrap {
  width: 100%;
  margin: 4px 0;
}

.progress-track {
  width: 100%;
  height: 3px;
  background: $palette-border;
}

.progress-fill {
  height: 100%;
  background: $palette-red;
  transition: width 0.3s ease;
  min-width: 2px;
}

.loader-meta {
  display: flex;
  justify-content: space-between;
  width: 100%;
  gap: 16px;
}

.loader-message {
  font-size: $font-xs;
  color: $palette-muted;
  text-align: left;
}

.loader-kb {
  font-size: $font-xs;
  font-weight: $fw-semibold;
  color: $palette-text;
  font-family: 'JetBrains Mono', monospace;
  white-space: nowrap;
  flex-shrink: 0;
}
</style>
