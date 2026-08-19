<template lang="pug">
Teleport(to="body")
  .map-picker-overlay(v-if="isOpen" @click.self="close")
    .map-picker-panel
      .mpp-head
        .mpp-title Select Map Pack
        button.mpp-close(@click="close") ✕

      .mpp-search-row
        input.mpp-search(
          v-model="search"
          type="text"
          placeholder="Search custom maps, authors…"
        )
      .mpp-filter-row
        button.mpp-filter(:class="{ active: filterRating === 'all' }" @click="filterRating = 'all'") All
        button.mpp-filter(:class="{ active: filterRating === '5' }" @click="filterRating = '5'") ★★★★★
        button.mpp-filter(:class="{ active: filterRating === '4' }" @click="filterRating = '4'") ★★★★+
        button.mpp-filter(:class="{ active: filterRating === '3' }" @click="filterRating = '3'") ★★★+
        button.mpp-filter(:class="{ active: filterRating === '2' }" @click="filterRating = '2'") ★★+
        button.mpp-filter(:class="{ active: filterRating === '1' }" @click="filterRating = '1'") ★+

      .mpp-body
        .mpp-loading(v-if="mapsStore.mapLoadState === 'loading' && !mapsStore.mapListing.length")
          | Loading map listing…
        .mpp-empty(v-else-if="search && !filteredCustomMaps.length")
          | No maps found
        .map-grid
          template(v-if="!search")
            .map-card(
              v-for="pack in officialPacks"
              :key="pack.sourceId"
              :class="{ active: selectedId === pack.sourceId }"
              @click="selectOfficialPack(pack)"
            )
              .mc-thumb(:class="{ 'thumb-loading': thumbStates[pack.sourceId] !== 'loaded' && thumbStates[pack.sourceId] !== 'error' }")
                .mc-thumb-bg
                img.mc-thumb-img(
                  :src="packThumbUrl(pack)"
                  :class="{ loaded: thumbStates[pack.sourceId] === 'loaded' || thumbStates[pack.sourceId] === 'error' }"
                  loading="lazy"
                  @load="onThumbLoad(pack.sourceId)"
                  @error="onThumbError($event, pack.sourceId)"
                )
                .mc-thumb-vignette
              .mc-body
                .mc-name {{ pack.shortName }}
                .mc-author {{ pack.author }}
              .mc-overlay
          .mpp-divider(v-if="filteredCustomMaps.length")
            span Custom Maps

          .map-card(
            v-for="map in displayedCustomMaps"
            :key="map.id"
            :class="{ active: selectedId === 'quaddicted:' + map.id }"
            @click="selectCustomMap(map)"
          )
            .mc-thumb(:class="{ 'thumb-loading': thumbStates[map.id] !== 'loaded' && thumbStates[map.id] !== 'error' }")
              .mc-thumb-bg
              img.mc-thumb-img(
                :src="getQuaddictedImageUrl(map)"
                :class="{ loaded: thumbStates[map.id] === 'loaded' || thumbStates[map.id] === 'error' }"
                loading="lazy"
                @load="onThumbLoad(map.id)"
                @error="onThumbError($event, map.id)"
              )
              .mc-thumb-vignette
            .mc-body
              .mc-name {{ map.title }}
              .mc-author {{ map.author }} · {{ formatMapDate(map.date) }}
              .mc-meta-row
                .mc-stars
                  span.mc-star(
                    v-for="i in 5"
                    :key="i"
                    :class="{ on: i <= Math.round(map.rating) }"
                  ) ★
                .mc-size {{ formatFileSize(map.size) }}
            .mc-overlay
        .mpp-sentinel(v-if="hasMore" ref="sentinel")
</template>

<script lang="ts" setup>
import { ref, computed, reactive, watch, onUnmounted } from 'vue'
import { useMapsStore } from '../../../../../stores/maps'
import { officialGameDefinitions, type GameDefinition } from '../../../../../helpers/games'
import type { QuaddictedMap } from '../../../../../types/QuaddictedMap'
import type { SourceId } from '../../../../../../../shared/types/Source'
import { getMapImageUrl, genericImageUrl, getQuaddictedImageUrl as _getQuaddictedImageUrl } from '../../../../../helpers/map'
import { formatFileSize } from '../../../../../helpers/number'

export type MapPickerSelection = {
  sourceId: SourceId
  gameDir?: string
  startMap: string
  mapList: { name: string; title?: string }[]
  thumbUrl?: string
  requiredPackages?: SourceId[]
  title: string
  author?: string
  rating?: number
}

const emits = defineEmits<{
  (e: 'select', v: MapPickerSelection): void
  (e: 'close'): void
}>()

const mapsStore = useMapsStore()

const isOpen = ref(false)
const selectedId = ref<string>('')
const search = ref('')
const filterRating = ref<'all' | '5' | '4' | '3' | '2' | '1'>('all')

const officialPacks = officialGameDefinitions

// Quaddicted-only for now: this tab builds `quaddicted:` sourceIds and its
// thumbnails/detail links are quaddicted-shaped. Slipseer rows in the merged
// listing get their own picker treatment later (phase 3).
const quaddictedMaps = computed(() =>
  mapsStore.mapListing.filter(m => !m.sourceId || m.sourceId.startsWith('quaddicted:')))

const filteredCustomMaps = computed(() => {
  const q = search.value.toLowerCase()
  return quaddictedMaps.value.filter(m => {
    const matchesSearch = !q ||
      m.title.toLowerCase().includes(q) ||
      m.author.toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q)
    const minRating = filterRating.value === 'all' ? 0 : parseInt(filterRating.value)
    return matchesSearch && m.rating >= minRating
  })
})

const BATCH_SIZE = 40
const displayCount = ref(BATCH_SIZE)
const displayedCustomMaps = computed(() => filteredCustomMaps.value.slice(0, displayCount.value))
const hasMore = computed(() => displayCount.value < filteredCustomMaps.value.length)

watch([search, filterRating], () => { displayCount.value = BATCH_SIZE })

const sentinel = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

watch(sentinel, el => {
  observer?.disconnect()
  observer = null
  if (el) {
    observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore.value) {
        displayCount.value += BATCH_SIZE
      }
    }, { threshold: 0.1 })
    observer.observe(el)
  }
}, { flush: 'post' })

onUnmounted(() => observer?.disconnect())

const open = (currentSourceId?: string) => {
  selectedId.value = currentSourceId || ''
  isOpen.value = true
  mapsStore.loadMapListing()
}

const close = () => {
  isOpen.value = false
  emits('close')
}

const selectOfficialPack = (pack: GameDefinition) => {
  selectedId.value = pack.sourceId
  emits('select', {
    sourceId: pack.sourceId,
    gameDir: pack.game,
    startMap: pack.defaultMap,
    mapList: pack.mapList.map(m => ({ name: m.name, title: m.title })),
    title: pack.shortName,
    author: pack.author,
  })
  close()
}

const selectCustomMap = (map: QuaddictedMap) => {
  const sourceId: SourceId = `quaddicted:${map.id}`
  selectedId.value = sourceId
  const requiredPackages: SourceId[] = map.depends
    ? [`quaddicted:${map.depends}`, sourceId]
    : [sourceId]
  const startMap = map.mapList?.[0] || 'start'
  emits('select', {
    sourceId,
    gameDir: map.gameDir || 'id1',
    startMap,
    mapList: map.mapList.map(name => ({ name })),
    thumbUrl: getQuaddictedImageUrl(map),
    requiredPackages,
    title: map.title,
    author: map.author,
    rating: map.rating,
  })
  close()
}

const formatMapDate = (date: Date | string) =>
  new Date(date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

const packCoverMap = (pack: GameDefinition) =>
  pack.mapList.find(m => m.name === 'start')?.name ?? pack.mapList[0].name

const packThumbUrl = (pack: GameDefinition) =>
  pack.artwork ?? getMapImageUrl(packCoverMap(pack), pack.game)

const thumbStates = reactive<Record<string, 'loading' | 'loaded' | 'error'>>({})
const onThumbLoad = (id: string) => { thumbStates[id] = 'loaded' }
const onThumbError = (e: Event, id: string) => {
  thumbStates[id] = 'error'
  const img = e.target as HTMLImageElement
  if (img.src !== genericImageUrl) img.src = genericImageUrl
}

const getQuaddictedImageUrl = (map: QuaddictedMap) => _getQuaddictedImageUrl(map.id, map.fileName)


defineExpose({ open, close })
</script>

<style lang="scss" scoped>
@import '../../../../../scss/tokens';

.map-picker-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.map-picker-panel {
  background: $palette-surface;
  border: $border-subtle;
  width: 100%;
  max-width: 860px;
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  animation: fadeUp 0.18s ease;
}

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes shimmer {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

.mpp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: $border-subtle;
  flex-shrink: 0;
}

.mpp-title {
  font-size: $font-sm;
  font-weight: $fw-black;
  color: $palette-bright;
}

.mpp-close {
  background: none;
  border: none;
  color: $palette-muted;
  font-size: 18px;
  cursor: pointer;
  line-height: 1;
  transition: $transition-color;
  &:hover { color: $palette-bright; }
}

.mpp-search-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: $border-subtle;
  background: $palette-body;
  flex-shrink: 0;
}

.mpp-search {
  flex: 1;
  background: none;
  border: none;
  color: $palette-bright;
  font-family: inherit;
  font-size: $font-base;
  outline: none;
  &::placeholder { color: $palette-muted; }
}

.mpp-filter-row {
  display: flex;
  gap: 6px;
  padding: 10px 16px;
  border-bottom: $border-subtle;
  background: $palette-body;
  flex-shrink: 0;
}

.mpp-filter {
  font-family: inherit;
  font-size: $font-2xs;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: $tracking-links;
  padding: 5px 12px;
  background: none;
  border: $border-subtle;
  color: $palette-muted;
  cursor: pointer;
  transition: all 0.15s;

  &:hover { color: $palette-text; }
  &.active { color: $palette-bright; border-color: $palette-text; background: $palette-body; }
}

.mpp-body {
  flex: 1;
  overflow-y: auto;
}

.mpp-sentinel {
  height: 40px;
  flex-shrink: 0;
}

.mpp-loading,
.mpp-empty {
  padding: 32px;
  text-align: center;
  color: $palette-muted;
  font-size: $font-sm;
}

.map-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1px;
  background: $palette-border;
}

.mpp-divider {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px 8px;
  background: $palette-body;

  span {
    font-size: $font-2xs;
    font-weight: $fw-bold;
    text-transform: uppercase;
    letter-spacing: $tracking-labels;
    color: $palette-muted;
    white-space: nowrap;
  }

  &::after {
    content: '';
    flex: 1;
    height: 1px;
    background: $palette-border;
  }
}

.map-card {
  background: $palette-surface;
  cursor: pointer;
  transition: background 0.15s;
  position: relative;
  overflow: hidden;

  &:hover { background: #2e2e2e; }
  &.active::after {
    content: '';
    position: absolute;
    inset: 0;
    border: 2px solid $palette-red;
    pointer-events: none;
    z-index: 10;
  }
  &:hover .mc-overlay { opacity: 1; }
}

.mc-thumb {
  width: 100%;
  aspect-ratio: 4 / 3;
  position: relative;
  overflow: hidden;

  &.thumb-loading { cursor: wait; }
}

.mc-thumb-bg {
  position: absolute;
  inset: 0;
  background: $palette-body;
  overflow: hidden;

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.05) 50%, transparent 100%);
    animation: shimmer 1.4s ease-in-out infinite;
  }

  .mc-thumb:not(.thumb-loading) & { display: none; }
}

.mc-thumb-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.25s ease;

  &.loaded { opacity: 1; }
}

.mc-thumb-vignette {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.5) 100%);
}

.mc-body {
  padding: 8px 10px 10px;
}

.mc-name {
  font-size: $font-xs;
  font-weight: $fw-extrabold;
  color: $palette-bright;
  line-height: 1.2;
}

.mc-author {
  font-size: 10px;
  color: $palette-muted;
  margin-top: 2px;
}

.mc-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 4px;
}

.mc-stars {
  display: flex;
  gap: 1px;
}

.mc-star {
  font-size: 9px;
  color: $palette-border;
  &.on { color: $palette-yellow; }
}

.mc-size {
  font-size: 9px;
  color: $palette-muted;
  font-family: 'JetBrains Mono', monospace;
}

.mc-overlay {
  position: absolute;
  inset: 0;
  background: rgba(224, 48, 32, 0.12);
  opacity: 0;
  transition: opacity 0.15s;
  pointer-events: none;
}
</style>
