<template lang="pug">
.quaddicted-section
  .load-error(v-if="!model.loading && !available") The map service is currently unavailable.
  .load-error(v-if="model.loadMapError") Failed to load map: {{model.loadMapError}}

  .search-row
    input.search-input(
      type="search"
      placeholder="Search maps..."
      v-model="model.search"
      :disabled="model.loading || isMapLoading"
    )

  .loading-state(v-if="model.loading")
    .loading.loading-lg

  template(v-else)
    .table-wrap
      .custom-table-head
        .th.sortable(:class="{sorted: model.sortBy === 'title'}" @click="changeSort('title')") Map {{sortIcon('title')}}
        .th.sortable(:class="{sorted: model.sortBy === 'date'}" @click="changeSort('date')") Released {{sortIcon('date')}}
        .th.sortable(:class="{sorted: model.sortBy === 'rating'}" @click="changeSort('rating')") Rating {{sortIcon('rating')}}
        .th.sortable(:class="{sorted: model.sortBy === 'size'}" @click="changeSort('size')") Size {{sortIcon('size')}}

      .table-scroll(ref="scrollEl")
        template(v-for="map in displayedMaps" :key="map.id")
          .custom-row(
            :class="{expanded: model.selectedMapId === map.id, disabled: isMapLoading}"
            @click="!isMapLoading && toggleMap(map.id)"
          )
            div
              .map-title {{map.title}}
              .map-author {{map.author}}
              .map-requires(v-if="map.requirements?.length") Requires: {{resolveRequirement(map.requirements[0])}}
            .map-date {{formatDate(map.date)}}
            Rating(:rating="parseFloat(String(map.rating))")
            .map-size {{formatFileSize(map.size)}}

          .expand-panel(v-if="model.selectedMapId === map.id")
            MapImage.panel-thumb(:fullMapPath="getImageUrl(map)")
            .panel-body
              .panel-title {{map.title}}
              .panel-author by {{map.author}} · {{formatDate(map.date)}}
              .panel-meta
                div
                  .panel-meta-label Rating
                  .panel-meta-val {{map.rating ?? '?'}} / 5
                div
                  .panel-meta-label Released
                  .panel-meta-val {{formatDate(map.date)}}
                div
                  .panel-meta-label Size
                  .panel-meta-val {{formatFileSize(map.size)}}
                div
                  .panel-meta-label Maps
                  .panel-meta-val {{map.mapList.length}}
                div(v-if="map.requirements?.length")
                  .panel-meta-label Requires
                  .panel-meta-val {{resolveRequirement(map.requirements[0])}}
              .panel-actions
                MapLoadProgress(v-if="isMapLoading" :map="map")
                template(v-else)
                  span(v-tippy :content="!gameStore.hasRegistered ? playTooltip : undefined")
                    button.btn-play(
                      :disabled="!gameStore.hasRegistered"
                      @click.stop="playMap(map)"
                    ) ▶ Play Now
                  button.panel-close(@click.stop="toggleMap(model.selectedMapId)") Close
                a.panel-link(:href="map.detailLink" target="_blank" rel="noopener noreferrer" @click.stop) View on Quaddicted ↗
        .table-sentinel(v-if="hasMore" ref="sentinelEl")

  .attribution
    a(href="https://www.quaddicted.com" target="_blank") Data provided with permission from Quaddicted.com
</template>

<script lang="ts" setup>
import { reactive, computed, ref, watch, onMounted, onBeforeUnmount, nextTick, inject, type Ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useMapsStore } from '../../../../stores/maps'
import { useGameStore } from '../../../../stores/game'
import type { QuaddictedMap } from '../../../../types/QuaddictedMap'
import { formatFileSize } from '../../../../helpers/number'
import { guessStartMap } from '../../../../helpers/map'
import Rating from './Rating.vue'
import MapLoadProgress from './MapLoadProgress.vue'
import MapImage from '../../../MapImage.vue'

const router = useRouter()
const route = useRoute()
const mapStore = useMapsStore()
const gameStore = useGameStore()

const activeKey = inject<Ref<string>>('spActiveKey')!

type SortKey = 'title' | 'date' | 'rating' | 'size'

// Seed sort from the ?sort=/&order= params here rather than in restoreFromQuery:
// initial values don't trigger the watch that resets pagination
const querySort = route.query.sort
const queryOrder = route.query.order

const model = reactive<{
  search: string
  selectedMapId: string
  sortBy: SortKey
  sortOrder: 'asc' | 'desc'
  loading: boolean
  loadMapError: string
}>({
  search: '',
  selectedMapId: '',
  sortBy: querySort === 'title' || querySort === 'date' || querySort === 'rating' || querySort === 'size' ? querySort : 'date',
  sortOrder: queryOrder === 'asc' || queryOrder === 'desc' ? queryOrder : 'desc',
  loading: false,
  loadMapError: '',
})

const available = computed(() => mapStore.getMapListing.length > 0)
const isMapLoading = computed(() => mapStore.mapLoadState === 'loading')

const playTooltip = computed(() =>
  !gameStore.hasRegistered
    ? "You must load your pak1.pak\nbefore playing custom maps.\nSee FAQ for details."
    : "Download and play this map"
)

// This panel is Quaddicted-only: the /api/maps listing also carries other
// sources (slipseer), which get their own browsing UI later. Rows without a
// sourceId predate multi-source payloads and are quaddicted by definition.
const quaddictedMaps = computed(() =>
  mapStore.getMapListing.filter(m => !m.sourceId || m.sourceId.startsWith('quaddicted:')))

const filteredMaps = computed(() => {
  const term = model.search.trim().toLowerCase()
  if (!term) return quaddictedMaps.value
  return quaddictedMaps.value.filter(m =>
    m.title.toLowerCase().includes(term) ||
    m.author.toLowerCase().includes(term) ||
    m.fileName.toLowerCase().includes(term)
  )
})

const getSortValue = (map: QuaddictedMap, key: SortKey): string | number => {
  switch (key) {
    case 'title':  return map.title.toLowerCase()
    case 'date': {
      const t = new Date(map.date).getTime()
      return Number.isNaN(t) ? 0 : t
    }
    case 'rating': {
      // unrated maps parse to NaN, which compares false with everything and
      // leaves them scattered through the sort — pin them below rated maps
      const r = parseFloat(String(map.rating))
      return Number.isNaN(r) ? -1 : r
    }
    case 'size':   return map.size
  }
}

const sortedMaps = computed(() =>
  filteredMaps.value.slice().sort((a, b) => {
    const dir = model.sortOrder === 'asc' ? 1 : -1
    const va = getSortValue(a, model.sortBy)
    const vb = getSortValue(b, model.sortBy)
    if (va !== vb) return va > vb ? dir : -dir
    if (model.sortBy === 'rating') {
      // tiebreak equal ratings by release date, newest first
      const da = getSortValue(a, 'date')
      const db = getSortValue(b, 'date')
      return da > db ? -1 : da < db ? 1 : 0
    }
    return 0
  })
)

const CHUNK = 50
const visibleCount = ref(CHUNK)
const displayedMaps = computed(() => sortedMaps.value.slice(0, visibleCount.value))
const hasMore = computed(() => visibleCount.value < sortedMaps.value.length)

watch([() => model.search, () => model.sortBy, () => model.sortOrder], () => {
  visibleCount.value = CHUNK
})

const scrollEl = ref<HTMLElement | null>(null)
const sentinelEl = ref<HTMLElement | null>(null)
let observer: IntersectionObserver | null = null

const setupObserver = () => {
  observer?.disconnect()
  if (!sentinelEl.value) return
  observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && hasMore.value) {
      visibleCount.value += CHUNK
    }
  }, { root: scrollEl.value, threshold: 0 })
  observer.observe(sentinelEl.value)
}

watch(sentinelEl, setupObserver)
onBeforeUnmount(() => observer?.disconnect())

const changeSort = (col: SortKey) => {
  if (model.sortBy === col) {
    model.sortOrder = model.sortOrder === 'asc' ? 'desc' : 'asc'
  } else {
    model.sortBy = col
    model.sortOrder = 'desc'
  }
  router.replace({ query: { ...route.query, sort: model.sortBy, order: model.sortOrder } })
}

const sortIcon = (col: SortKey) =>
  model.sortBy === col ? (model.sortOrder === 'asc' ? '↑' : '↓') : ''

const toggleMap = (id: string) => {
  if (model.selectedMapId === id) {
    model.selectedMapId = ''
    activeKey.value = ''
    router.replace({ query: { ...route.query, map: undefined } })
  } else {
    model.selectedMapId = id
    activeKey.value = 'quaddicted:' + id
    router.replace({ query: { ...route.query, map: id } })
  }
  model.loadMapError = ''
}

watch(activeKey, (key) => {
  if (!key.startsWith('quaddicted:') && model.selectedMapId) {
    model.selectedMapId = ''
    router.replace({ query: { ...route.query, map: undefined } })
  }
})

const modNames: Record<string, string> = {
  ad:          'Arcane Dimensions',
  quoth:       'Quoth',
  copper:      'Copper',
  alkaline:    'Alkaline',
  warpspasm:   'Warp Spasm',
  honey:       'Honey',
  progs_dump:  'Progs Dump',
  dopa:        'Dimensions of the Past',
  hipnotic:    'Scourge of Armagon',
  rogue:       'Dissolution of Eternity',
  mjolnir:     'Mjolnir',
  rubicon2:    'Rubicon 2',
  arcanum:     'Arcanum',
  ne_sp:       'Ne_SP',
  soa:         'Scourge of Armagon',
  doe:         'Dissolution of Eternity',
}

const resolveRequirement = (req: string) => {
  const id = req.replace(/[^a-z0-9_]/gi, ' ').trim().split(/\s+/)[0].toLowerCase()
  return mapStore.getMapFromId(id)?.title ?? modNames[id] ?? id
}

const formatDate = (date: Date | string) =>
  new Date(date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

const getImageUrl = (map: QuaddictedMap) => {
  const mapName = map.fileName.substring(0, map.fileName.lastIndexOf('.'))
  return `https://www.quaddicted.com/files/quaddicted-images/by-sha256/${map.id.slice(0, 2)}/${map.id}/${mapName}.jpg`
}

const playMap = async (map: QuaddictedMap) => {
  model.loadMapError = ''
  const sourceId = `quaddicted:${map.id}` as const
  try {
    const pkgMeta = await mapStore.loadMap(sourceId)
    router.push({
      name: 'quake',
      query: {
        '+map': guessStartMap(map.mapList) || 'start',
        sourceId,
        ...(pkgMeta.gameDir !== 'id1' ? { '-game': pkgMeta.gameDir } : {})
      }
    })
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      model.loadMapError = err.message
    }
  }
}

// Re-open the map named by the ?map= query param (set by toggleMap) and bring
// it into view — restores the panel after quitting a game or a page reload
const restoreFromQuery = () => {
  const id = route.query.map
  if (typeof id !== 'string' || !id) return
  const idx = sortedMaps.value.findIndex(m => m.id === id)
  if (idx === -1) return
  if (idx >= visibleCount.value) {
    visibleCount.value = Math.ceil((idx + 1) / CHUNK) * CHUNK
  }
  model.selectedMapId = id
  activeKey.value = 'quaddicted:' + id
  nextTick(() => {
    scrollEl.value?.querySelector('.custom-row.expanded')?.scrollIntoView({ block: 'center' })
  })
}

onMounted(() => {
  if (!available.value) {
    model.loading = true
    mapStore.loadMapListing()
      .then(() => { model.loading = false; restoreFromQuery() })
      .catch(() => { model.loading = false })
  } else {
    restoreFromQuery()
  }
})

onBeforeUnmount(() => {
  if (isMapLoading.value) {
    mapStore.cancelLoad()
  }
})
</script>

<style lang="scss" scoped>
@import '../../../../scss/tokens';

.load-error {
  font-size: $font-sm;
  color: $palette-red;
  margin-bottom: $gap-4;
}

.search-row { margin-bottom: $gap-4; }

.attribution {
  margin-top: 16px;
  a {
    font-size: $font-xs;
    color: $palette-muted;
    text-decoration: none;
    transition: $transition-color;
    &:hover { color: $palette-text; }
  }
}

.search-input {
  width: 100%;
  max-width: 360px;
  background: $palette-surface;
  border: 1px solid $palette-border;
  color: $palette-text;
  padding: 8px 12px;
  font-size: $font-sm;
  outline: none;
  &:focus { border-color: $palette-muted; }
  &::placeholder { color: $palette-muted; }
}

.loading-state { padding: 48px 0; }

/* ── Table wrap + scroll ── */
.table-wrap {
  border: $border-subtle;
}

.table-scroll {
  max-height: 520px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: $palette-border transparent;
  &::-webkit-scrollbar { width: 6px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: $palette-border; }
}

/* ── Table head ── */
.custom-table-head {
  display: grid;
  grid-template-columns: 1fr 120px 100px 80px;
  padding: 10px 16px;
  border-bottom: $border-subtle;
  gap: $gap-4;
  position: sticky;
  top: 0;
  background: $palette-surface;
  z-index: 1;
  @media (max-width: 768px) { display: none; }
}

.th {
  font-size: $font-2xs;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: $tracking-labels;
  color: $palette-muted;
  &.sortable { cursor: pointer; transition: $transition-color; &:hover { color: $palette-text; } }
  &.sorted { color: $palette-bright; }
}

/* ── Table rows ── */
.custom-row {
  display: grid;
  grid-template-columns: 1fr 120px 100px 80px;
  padding: 14px 16px;
  gap: $gap-4;
  align-items: center;
  border-bottom: $border-subtle;
  cursor: pointer;
  transition: background 0.1s;
  &:hover { background: $palette-surface; }
  &.expanded { background: $palette-surface; box-shadow: inset 3px 0 0 $palette-red; }
  &.disabled:not(.expanded) { pointer-events: none; opacity: 0.5; }

  @media (max-width: 768px) {
    grid-template-columns: 1fr auto;
    .map-date, .map-size { display: none; }
  }
}

.map-title {
  font-size: $font-base;
  font-weight: $fw-bold;
  color: $palette-bright;
}

.map-author {
  font-size: $font-xs;
  color: $palette-muted;
  margin-top: 2px;
}

.map-requires {
  font-size: $font-2xs;
  color: $palette-yellow;
  margin-top: 3px;
  font-style: italic;
}

.map-date {
  font-size: $font-sm;
  color: $palette-text;
}

.map-size {
  font-size: $font-sm;
  color: $palette-muted;
}

/* ── Expand panel ── */
.expand-panel {
  display: grid;
  grid-template-columns: 320px 1fr;
  background: $palette-surface;
  border-bottom: $border-subtle;
  overflow: hidden;
  @media (max-width: 768px) { grid-template-columns: 1fr; }
}

.panel-thumb {
  width: 320px;
  aspect-ratio: 4 / 3;
  border-right: $border-subtle;
  background-position: center;
  background-size: cover;
  @media (max-width: 768px) {
    width: 100%;
    aspect-ratio: 4 / 3;
    border-right: none;
    border-bottom: $border-subtle;
  }
}

.panel-body { padding: 18px 22px; }

.panel-title {
  font-size: 20px;
  font-weight: $fw-black;
  color: $palette-bright;
  letter-spacing: -0.01em;
  margin-bottom: 4px;
}

.panel-author {
  font-size: $font-sm;
  color: $palette-muted;
  margin-bottom: $gap-3;
}

.panel-meta {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  margin-bottom: $gap-3;
  padding-bottom: $gap-3;
  border-bottom: $border-subtle;
}

.panel-meta-label {
  font-size: 10px;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: $palette-muted;
  margin-bottom: 3px;
}

.panel-meta-val {
  font-size: $font-sm;
  font-weight: $fw-semibold;
  color: $palette-bright;
}

.panel-actions {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.btn-play {
  font-size: $font-sm;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: $tracking-links;
  background: $palette-red;
  color: $palette-bright;
  border: none;
  padding: 9px 22px;
  cursor: pointer;
  transition: $transition-bg;
  &:hover:not(:disabled) { background: lighten($palette-red, 6%); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}

.table-sentinel {
  height: 1px;
}

.panel-link {
  font-size: $font-xs;
  font-weight: $fw-semibold;
  color: $palette-muted;
  text-decoration: none;
  margin-left: auto;
  transition: $transition-color;
  &:hover { color: $palette-text; }
  @media (max-width: 768px) {
    flex-basis: 100%;
    margin-left: 0;
    padding-top: 4px;
  }
}

.panel-close {
  font-size: $font-xs;
  color: $palette-muted;
  background: none;
  border: none;
  cursor: pointer;
  font-family: inherit;
  font-weight: $fw-semibold;
  transition: $transition-color;
  &:hover { color: $palette-text; }
}
</style>
