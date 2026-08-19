<template lang="pug">
.page
  .page-header
    h1.page-title Singleplayer
    p.page-sub Play the original campaign or explore community maps

  p.section-label Official campaigns
  .pkg-list
    template(v-for="(pack, i) in officialGameDefinitions" :key="pack.sourceId")
      .pkg-row(
        :class="{ active: activePack === pack.sourceId, locked: isLocked(pack), 'is-last': i === officialGameDefinitions.length - 1, disabled: isMapLoading }"
        @click="!isLocked(pack) && !isMapLoading && togglePack(pack.sourceId)"
      )
        .pkg-thumb
          MapImage.pkg-thumb-img(:mapName="selectedMaps[pack.sourceId]" :gameDir="pack.game" :fullMapPath="pack.artwork")
          .pkg-thumb-vignette
        .pkg-body
          .pkg-type(:class="{ expansion: pack.game !== 'original' }") {{ pack.label }}
          .pkg-name {{ pack.shortName }}
          .pkg-author {{ pack.author }}
          template(v-if="!isLocked(pack)")
            .pkg-desc {{ descriptions[pack.sourceId] }}
          template(v-else)
            .pkg-lock-notice
              font-awesome-icon(icon="fa-solid fa-lock" size="xs")
              |  Requires full game registration
      .pkg-accordion(:ref="(el) => setAccordionRef(el, i)" @click.stop)
        .pkg-accordion-inner(:ref="(el) => setInnerRef(el, i)")
          select.pkg-select(v-model="selectedMaps[pack.sourceId]")
            option(v-for="m in availableMaps(pack)" :key="m.name" :value="m.name") {{ m.name }} — {{ m.title }}
          button.btn-play(:disabled="isMapLoading" @click="playPack(pack)") ▶ Play

  .section-gap

  MyPackages

  .section-gap

  p.section-label
    | Custom maps
    span.label-note  — from Quaddicted archive
  Quaddicted
</template>

<script lang="ts" setup>
import { ref, reactive, computed, watch, onMounted, nextTick, provide } from 'vue'
import { useGameStore } from '../../../stores/game'
import { useMapsStore } from '../../../stores/maps'
import { useRouter } from 'vue-router'
import MapImage from '../../MapImage.vue'
import Quaddicted from './Quaddicted/Quaddicted.vue'
import MyPackages from './MyPackages.vue'
import { officialGameDefinitions, type GameDefinition } from '../../../helpers/games'

const router = useRouter()
const gameStore = useGameStore()
const mapsStore = useMapsStore()
const isMapLoading = computed(() => mapsStore.mapLoadState === 'loading')

const descriptions: Record<string, string> = {
  'official:original': 'The original campaign. Four episodes across runic fortresses, medieval keeps, and hellish dimensions. Defeat Shub-Niggurath to stop the Quake entity.',
  'official:hipnotic': 'Three episodes adding new enemies, weapons, and traps. Culminates in a battle against Armagon, the first general of Quake.',
  'official:rogue': 'Eight maps featuring rune magic, new multi-rocket weapons, and monsters drawn from Greek and Egyptian mythology. Ends in an alternate dimension.',
  'official:mg1': 'Eleven levels reached through a central hub, built by MachineGames for Quake\'s 25th anniversary. Five short episodes fuel The Machine before a last stand against Chthon; the pack also ships four deathmatch arenas and seven Horde maps.',
  'official:mg3': 'Nineteen maps through a dimension of illusion where time folds back on itself, built by MachineGames for Quake\'s 30th anniversary. Adds a laser cannon and a lightning-charged axe, six secret levels, two boss maps, and a deathmatch arena.',
}

const isLocked = (pack: GameDefinition) => !!pack.requiresRegistration && !gameStore.hasRegistered

const availableMaps = (pack: GameDefinition) => {
  if (pack.game === 'original' && !gameStore.hasRegistered) {
    return pack.mapList.filter(m => m.collection === 'Episode 1' || m.name === 'start')
  }
  return pack.mapList.filter(m => m.sp !== false)
}

const activeKey = ref<string>('campaign:' + officialGameDefinitions[0].sourceId)
provide('spActiveKey', activeKey)

const activePack = computed(() =>
  activeKey.value.startsWith('campaign:') ? activeKey.value.slice('campaign:'.length) : ''
)

const selectedMaps = reactive<Record<string, string>>(
  Object.fromEntries(officialGameDefinitions.map(p => [p.sourceId, 'start']))
)

const accordionEls: HTMLElement[] = []
const innerEls: HTMLElement[] = []

const setAccordionRef = (el: unknown, i: number) => { if (el) accordionEls[i] = el as HTMLElement }
const setInnerRef = (el: unknown, i: number) => { if (el) innerEls[i] = el as HTMLElement }

const updateHeights = () => {
  officialGameDefinitions.forEach((pack, i) => {
    const el = accordionEls[i]
    if (!el) return
    el.style.maxHeight = activePack.value === pack.sourceId
      ? `${innerEls[i]?.scrollHeight ?? 72}px`
      : '0px'
  })
}

watch(activePack, updateHeights)

onMounted(() => nextTick(() => {
  accordionEls.forEach(el => { if (el) el.style.transition = 'none' })
  updateHeights()
  requestAnimationFrame(() => requestAnimationFrame(() => {
    accordionEls.forEach(el => { if (el) el.style.transition = '' })
  }))
}))

const togglePack = (sourceId: string) => {
  activeKey.value = 'campaign:' + sourceId
}

const playPack = (pack: GameDefinition) => {
  const mapName = selectedMaps[pack.sourceId]
  router.push({
    name: 'quake',
    query: {
      '+map': mapName,
      ...(pack.game !== 'original' ? { '-game': pack.game } : {})
    }
  })
}
</script>

<style lang="scss" scoped>
@import '../../../scss/tokens';

.page {
  max-width: 1000px;
  margin: 0 auto;
  padding: 48px;
  @media (max-width: 768px) { padding: 32px 24px; }
  @media (max-width: 480px) { padding: 24px 16px; }
}

.page-header { margin-bottom: 40px; }

.page-title {
  font-size: 28px;
  font-weight: $fw-black;
  color: $palette-bright;
  letter-spacing: -0.02em;
}

.page-sub {
  font-size: $font-sm;
  color: $palette-muted;
  margin-top: $gap-1;
}

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

.section-gap { margin-bottom: 64px; }

/* ── Package list ── */
.pkg-list {
  display: flex;
  flex-direction: column;
  border: 1px solid $palette-border;
}

.pkg-row {
  display: grid;
  grid-template-columns: 260px 1fr;
  cursor: pointer;
  transition: background 0.15s;
  border-bottom: 1px solid $palette-border;

  &.is-last { border-bottom: none; }
  &:hover:not(.locked) { background: #272727; }
  &.active {
    background: #272727;
    position: relative;
    &::before {
      content: '';
      position: absolute;
      left: 0; top: 0; bottom: 0;
      width: 3px;
      background: $palette-red;
      z-index: 1;
    }
  }
  &.locked { opacity: 0.5; cursor: not-allowed; }
  &.disabled { pointer-events: none; opacity: 0.5; }

  @media (max-width: 768px) { grid-template-columns: 160px 1fr; }
  @media (max-width: 480px) { grid-template-columns: 100px 1fr; }
}

.pkg-thumb {
  position: relative;
  overflow: hidden;
  min-height: 130px;

  @media (max-width: 768px) { min-height: 100px; }
}

.pkg-thumb-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.pkg-thumb-vignette {
  position: absolute;
  inset: 0;
  background: linear-gradient(to right, transparent 40%, rgba(0, 0, 0, 0.5) 100%);
  pointer-events: none;

  .pkg-row.active & {
    background: linear-gradient(to right, rgba(224, 48, 32, 0.08) 0%, rgba(0, 0, 0, 0.4) 100%);
  }
}

.pkg-body {
  padding: 20px 28px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  border-left: 1px solid $palette-border;

  @media (max-width: 768px) { padding: 16px 20px; }
  @media (max-width: 480px) { padding: 14px 16px; }
}

.pkg-type {
  font-size: 10px;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: $palette-muted;

  &.expansion { color: $palette-yellow; }
}

.pkg-name {
  font-size: 20px;
  font-weight: $fw-black;
  color: $palette-bright;
  line-height: 1.1;
  letter-spacing: -0.02em;

  @media (max-width: 768px) { font-size: 16px; }
  @media (max-width: 480px) { font-size: 14px; }
}

.pkg-author {
  font-size: 12px;
  color: $palette-muted;

  @media (max-width: 480px) { font-size: 11px; }
}

.pkg-desc {
  font-size: $font-sm;
  color: $palette-text;
  line-height: 1.6;
  max-width: 540px;
  margin-top: 4px;

  @media (max-width: 768px) { font-size: $font-xs; }
  @media (max-width: 480px) { display: none; }
}

.pkg-lock-notice {
  font-size: 12px;
  color: $palette-muted;
  margin-top: 2px;
  display: flex;
  align-items: center;
  gap: 6px;
}

/* ── Accordion — triggered by adjacent sibling selector ── */
.pkg-accordion {
  max-height: 0;
  overflow: hidden;
  transition: max-height 0.25s ease;
  background: $palette-body;
}

.pkg-row.active + .pkg-accordion {
  // max-height set by JS to exact content height
}

.pkg-accordion-inner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 24px;
  border-bottom: 1px solid $palette-border;

  @media (max-width: 480px) { padding: 12px 16px; }
}

.pkg-select {
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
