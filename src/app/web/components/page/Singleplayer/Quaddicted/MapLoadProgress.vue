<template lang="pug">
.map-load-progress
  .progress-header
    span.progress-label {{ isUnzipping ? 'Unzipping' : 'Downloading' }}
    span.progress-size(v-if="total") {{ isUnzipping ? unzipLabel : sizeLabel }}
  .progress-track
    .progress-fill(
      :class="{indeterminate: !total}"
      :style="total ? { width: percent + '%' } : {}"
    )
  button.cancel-btn(@click="mapsStore.cancelLoad()") Cancel
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useMapsStore } from '../../../../stores/maps'
import type { QuaddictedMap } from '../../../../types/QuaddictedMap'

const mapsStore = useMapsStore()
defineProps<{ map: QuaddictedMap }>()

const total   = computed(() => mapsStore.getMapLoadProgress.total)
const loaded  = computed(() => mapsStore.getMapLoadProgress.loaded)
const percent = computed(() => !total.value ? 0 : Math.min(100, Math.floor((loaded.value / total.value) * 100)))
const isUnzipping = computed(() => mapsStore.getMapLoadProgress.phase === 'unzip')

const toMb    = (b: number) => (b / 1048576).toFixed(1)
// While downloading, loaded/total are bytes; while unzipping they are files
// (fractional while a file is mid-decompress).
const sizeLabel  = computed(() => `${toMb(loaded.value)} / ${toMb(total.value)} MB`)
const unzipLabel = computed(() => `${Math.floor(loaded.value)} / ${total.value} files (${percent.value}%)`)
</script>

<style scoped lang="scss">
@import '../../../../scss/tokens';

.map-load-progress {
  width: 100%;
}

.progress-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 8px;
}

.progress-label {
  font-size: $font-2xs;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: $tracking-caps;
  color: $palette-muted;
}

.progress-size {
  font-size: $font-2xs;
  color: $palette-muted;
}

.progress-track {
  width: 100%;
  height: 2px;
  background: $palette-border;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: $palette-red;
  transition: width 0.2s ease;

  &.indeterminate {
    width: 40%;
    animation: slide 1.2s ease-in-out infinite;
  }
}

@keyframes slide {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
}

.cancel-btn {
  margin-top: 8px;
  font-size: $font-2xs;
  font-weight: $fw-semibold;
  text-transform: uppercase;
  letter-spacing: $tracking-links;
  color: $palette-muted;
  background: none;
  border: none;
  cursor: pointer;
  font-family: inherit;
  padding: 0;
  transition: $transition-color;
  &:hover { color: $palette-bright; }
}
</style>
