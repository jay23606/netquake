<template lang="pug">
.view-settings
  .setting-group
    .setting-label Mode
    .setting-static {{ gameTypeDisplay(setting.gameType) }}

  .setting-group
    .setting-label Map
    MapImage.map-preview(:mapName="thumbMapName" :fullMapPath="thumbUrl")
    .map-name-row
      .map-current-name {{ mapTitle }}
      .map-current-meta(v-if="!isCustomMap") Official
    .map-current-author(v-if="isCustomMap && mapAuthor") by {{ mapAuthor }}
    .map-current-size(v-if="isCustomMap && mapSize") {{ mapSize }}
    .map-current-stars(v-if="isCustomMap && mapRating")
      span.mcs(v-for="i in 5" :key="i" :class="{ on: i <= Math.round(mapRating) }") ★

  template(v-if="setting.gameType === 'dm'")
    hr.setting-divider
    .setting-group
      .setting-label Frag Limit
      .setting-static {{ setting.fragLimit }}
    .setting-group
      .setting-label Time Limit (minutes)
      .setting-static {{ setting.timeLimit === 0 ? 'Off' : setting.timeLimit }}
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import type { GameSettings } from '../../../../../types/Room'
import { officialGameDefinitions } from '../../../../../helpers/games'
import { useMapsStore } from '../../../../../stores/maps'
import { useGameStore } from '../../../../../stores/game'
import { getQuaddictedImageUrl } from '../../../../../helpers/map'
import MapImage from '../../../../MapImage.vue'

const props = defineProps<{ setting: GameSettings }>()
const mapsStore = useMapsStore()
const gameStore = useGameStore()

const isCustomMap = computed(() => !props.setting.sourceId.startsWith('official:'))

const quaddictedMap = computed(() => {
  if (!isCustomMap.value) return null
  const id = props.setting.sourceId.split(':')[1]
  return mapsStore.getMapFromId(id) ?? null
})

const thumbMapName = computed(() => isCustomMap.value ? undefined : props.setting.startMap)
const thumbUrl = computed(() => quaddictedMap.value ? getQuaddictedImageUrl(quaddictedMap.value.id, quaddictedMap.value.fileName) : undefined)

const mapTitle = computed(() => {
  if (isCustomMap.value) return quaddictedMap.value?.title ?? props.setting.startMap
  return officialGameDefinitions.find(d => d.sourceId === props.setting.sourceId)?.shortName ?? props.setting.startMap
})

const mapAuthor = computed(() => quaddictedMap.value?.author ?? null)
const mapRating = computed(() => quaddictedMap.value?.rating ?? null)
const mapSize = computed(() => {
  if (!isCustomMap.value) return null
  if (gameStore.packages.some(p => p.sourceId === props.setting.sourceId)) return 'Loaded'
  const m = quaddictedMap.value
  const b = m?.byteLength || m?.size
  if (!b) return null
  return b >= 1024 * 1024
    ? `${(b / (1024 * 1024)).toFixed(1)} MB`
    : `${(b / 1024).toFixed(0)} KB`
})

const gameTypeDisplay = (t: string) => {
  switch (t) {
    case 'dm':   return 'Deathmatch'
    case 'coop': return 'Cooperative'
    case 'ctf':  return 'Capture the Flag'
    default:     return t
  }
}
</script>

<style lang="scss" scoped>
@import '../../../../../scss/tokens';

.view-settings { display: flex; flex-direction: column; gap: 16px; }

.setting-group { display: flex; flex-direction: column; gap: 8px; }

.setting-label {
  font-size: $font-2xs;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: $palette-muted;
}

.map-preview {
  width: 100%;
  aspect-ratio: 4 / 3;
  border: $border-subtle;
}

.setting-static {
  font-size: $font-sm;
  color: $palette-text;
  font-weight: $fw-semibold;
  padding: 8px 10px;
  border: $border-subtle;
  background: transparent;
}

.map-name-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-top: 4px;
}

.map-current-name {
  font-size: $font-sm;
  font-weight: $fw-extrabold;
  color: $palette-bright;
}

.map-current-meta {
  font-size: $font-2xs;
  color: $palette-muted;
}

.map-current-author {
  font-size: $font-2xs;
  color: $palette-muted;
}

.map-current-size {
  font-size: $font-2xs;
  color: $palette-muted;
}

.map-current-stars {
  display: flex;
  gap: 1px;
  margin-top: 3px;

  .mcs {
    font-size: $font-2xs;
    color: $palette-border;
    &.on { color: $palette-yellow; }
  }
}

.setting-divider {
  border: none;
  border-top: $border-subtle;
  margin: 4px 0;
}
</style>
