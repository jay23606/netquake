<template lang="pug">
.my-packages
  p.section-label
    | My Packages
    span.label-note  — stored locally on this device

  .upkg-empty(v-if="!packages.length")
    span No custom packages installed.&nbsp;
    router-link.upkg-empty-link(to="/setup?tab=packages") Add packages in Setup →

  .upkg-list(v-else)
    template(v-for="(pkg, i) in packages" :key="pkg.sourceId")
      .upkg-row(
        :class="{ active: activePkg === pkg.sourceId, disabled: isMapLoading }"
        @click="!isMapLoading && selectPkg(pkg.sourceId)"
      )
        .upkg-info
          .upkg-name {{ pkg.name }}
          .upkg-meta(v-if="pkgMeta(pkg).fileCount !== null") {{ pkgMeta(pkg).fileCount }} files
        .upkg-count(v-if="pkgMeta(pkg).mapList.length")
          | {{ pkgMeta(pkg).mapList.length }} map{{ pkgMeta(pkg).mapList.length !== 1 ? 's' : '' }}
      .upkg-accordion(:ref="(el) => setAccordionRef(el, i)" @click.stop)
        .upkg-accordion-inner(:ref="(el) => setInnerRef(el, i)")
          select.upkg-select(v-model="selectedMaps[pkg.sourceId]")
            option(v-for="m in pkgMeta(pkg).mapList" :key="m" :value="m") {{ m }}
          button.btn-play(:disabled="isMapLoading" @click="play(pkg)") ▶ Play
</template>

<script lang="ts" setup>
import { reactive, computed, watch, onMounted, nextTick, inject, type Ref } from 'vue'
import { useRouter } from 'vue-router'
import { useGameStore } from '../../../stores/game'
import { useMapsStore } from '../../../stores/maps'
import { getMapGameQueryParams } from '../../../helpers/map'
import * as indexedDb from '../../../../../shared/indexeddb'
import type { PackageMeta } from '../../../../../shared/types/Store'

const router = useRouter()
const gameStore = useGameStore()
const mapsStore = useMapsStore()
const isMapLoading = computed(() => mapsStore.mapLoadState === 'loading')

const packages = computed(() =>
  gameStore.packages.filter(p => p.sourceId.startsWith('custom:'))
)

const activeKey = inject<Ref<string>>('spActiveKey')!
const activePkg = computed(() =>
  activeKey.value.startsWith('mypkg:') ? activeKey.value.slice('mypkg:'.length) : null
)
const selectedMaps = reactive<Record<string, string>>({})

type PkgMeta = { mapList: string[], fileCount: number | null }
const loadedMeta = reactive<Record<string, PkgMeta>>({})

const pkgMeta = (pkg: PackageMeta): PkgMeta =>
  loadedMeta[pkg.sourceId] ?? { mapList: [], fileCount: null }

const priorityMapOrder = ['start', 'intro']
const sortMapList = (maps: string[]) => [...maps].sort((a, b) => {
  const ai = priorityMapOrder.indexOf(a.toLowerCase())
  const bi = priorityMapOrder.indexOf(b.toLowerCase())
  if (ai !== -1 && bi !== -1) return ai - bi
  if (ai !== -1) return -1
  if (bi !== -1) return 1
  return a.localeCompare(b)
})

const loadMeta = async (pkg: PackageMeta) => {
  const [mapList, assets] = await Promise.all([
    mapsStore.getMapListForPackage(pkg.packageId),
    indexedDb.getAllMetaPerPackageId(pkg.packageId),
  ])
  loadedMeta[pkg.sourceId] = { mapList: sortMapList(mapList), fileCount: assets.length }
}

const selectPkg = (sourceId: string) => {
  activeKey.value = 'mypkg:' + sourceId
  const maps = pkgMeta(packages.value.find(p => p.sourceId === sourceId)!).mapList
  if (maps.length && !selectedMaps[sourceId]) selectedMaps[sourceId] = maps[0]
}

const play = (pkg: PackageMeta) => {
  const map = selectedMaps[pkg.sourceId]
  if (!map) return
  router.push({ name: 'quake', query: getMapGameQueryParams({ map, sourceId: pkg.sourceId, gameDir: pkg.gameDir }) })
}

// JS-measured accordion heights
const accordionEls: HTMLElement[] = []
const innerEls: HTMLElement[] = []
const setAccordionRef = (el: unknown, i: number) => { if (el) accordionEls[i] = el as HTMLElement }
const setInnerRef = (el: unknown, i: number) => { if (el) innerEls[i] = el as HTMLElement }

const updateHeights = () => {
  packages.value.forEach((pkg, i) => {
    const el = accordionEls[i]
    if (!el) return
    el.style.maxHeight = activePkg.value === pkg.sourceId
      ? `${innerEls[i]?.scrollHeight ?? 60}px`
      : '0px'
  })
}

watch(activePkg, updateHeights)

watch(packages, (pkgs) => {
  pkgs.forEach(pkg => { if (!loadedMeta[pkg.sourceId]) loadMeta(pkg) })
}, { immediate: true })

onMounted(() => nextTick(() => {
  accordionEls.forEach(el => { if (el) el.style.transition = 'none' })
  updateHeights()
  requestAnimationFrame(() => requestAnimationFrame(() => {
    accordionEls.forEach(el => { if (el) el.style.transition = '' })
  }))
}))
</script>

<style lang="scss" scoped>
@import '../../../scss/tokens';

.section-label {
  font-size: $font-2xs;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: $tracking-caps;
  color: $palette-muted;
  margin-bottom: $gap-4;
}

.label-note {
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
}

.upkg-empty {
  padding: 20px 24px;
  border: $border-subtle;
  font-size: $font-sm;
  color: $palette-muted;
}

.upkg-empty-link {
  color: $palette-red;
  font-weight: $fw-semibold;
  text-decoration: none;
  &:hover { text-decoration: underline; }
}

.upkg-list {
  display: flex;
  flex-direction: column;
  border: $border-subtle;
}

.upkg-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 16px;
  padding: 14px 20px;
  border-bottom: $border-subtle;
  cursor: pointer;
  transition: background 0.15s;

  &:last-of-type { border-bottom: none; }
  &:hover { background: #272727; }
  &.active { background: #272727; box-shadow: inset 3px 0 0 $palette-red; }
  &.disabled { pointer-events: none; opacity: 0.5; }
}

.upkg-info { min-width: 0; }

.upkg-name {
  font-size: 14px;
  font-weight: $fw-extrabold;
  color: $palette-bright;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.upkg-meta {
  font-size: $font-2xs;
  color: $palette-muted;
  margin-top: 2px;
}

.upkg-count {
  font-size: $font-2xs;
  color: $palette-muted;
  white-space: nowrap;
}

.upkg-accordion {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.25s ease;
  background: $palette-body;
}

.upkg-accordion-inner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  border-bottom: $border-subtle;
}

.upkg-select {
  flex: 1;
  background: $palette-surface;
  border: $border-subtle;
  color: $palette-bright;
  font-family: inherit;
  font-size: $font-sm;
  font-weight: $fw-semibold;
  padding: 9px 28px 9px 10px;
  outline: none;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23666'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  cursor: pointer;
  transition: border-color 0.15s;
  &:focus { border-color: $palette-text; }
}

.btn-play {
  font-family: inherit;
  font-size: $font-sm;
  font-weight: $fw-extrabold;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  padding: 10px 28px;
  background: $palette-red;
  color: #fff;
  border: none;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
  flex-shrink: 0;
  &:hover:not(:disabled) { background: lighten($palette-red, 5%); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }

  @media (max-width: 480px) { padding: 9px 16px; font-size: 12px; }
}
</style>
