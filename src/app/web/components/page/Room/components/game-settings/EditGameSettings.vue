<template lang="pug">
.edit-settings
  .setting-group
    .setting-label Mode
    select.setting-select(:value="model.gameType" @change="onGameTypeChange")
      option(value="dm") Deathmatch
      option(value="coop") Cooperative

  .setting-group
    .setting-label Map

    template(v-if="model.gameType === 'coop'")
      .map-preview-wrap(
        :class="{ 'picker-open': pickerOpen }"
        @click="isHost && openPicker()"
        :style="{ cursor: isHost ? 'pointer' : 'default' }"
      )
        MapImage.map-preview(:mapName="thumbMapName" :fullMapPath="thumbFullPath" :gameDir="model.gameDir")
        .map-preview-hint(v-if="isHost") Change map
      .map-name-row
        .map-current-name {{ selectedMapTitle }}
        .map-current-meta(v-if="!isCustomMap") Official
      .map-current-author(v-if="isCustomMap && selectedMapAuthor") by {{ selectedMapAuthor }}
      .map-current-size(v-if="isCustomMap && selectedMapSize") {{ selectedMapSize }}
      .map-current-stars(v-if="isCustomMap && selectedMapRating")
        span.mcs(v-for="i in 5" :key="i" :class="{ on: i <= Math.round(selectedMapRating) }") ★

      .setting-group(v-if="availableMapList.length > 1")
        .setting-label Starting Map
        select.setting-select(v-model="model.startMap")
          option(v-for="m in availableMapList" :key="m.name" :value="m.name") {{ m.title ? m.name + ' — ' + m.title : m.name }}

      MapPickerModal(ref="pickerModal" @select="onMapSelected" @close="pickerOpen = false")

      .setting-group
        .setting-label Skill
        select.setting-select(v-model.number="model.skill" :disabled="!isHost")
          option(:value="0") Easy
          option(:value="1") Normal
          option(:value="2") Hard
          option(:value="3") Nightmare

    template(v-if="model.gameType === 'dm'")
      .map-preview-wrap(
        :class="{ 'picker-open': dmPickerOpen }"
        @click="isHost && openDmPicker()"
        :style="{ cursor: isHost ? 'pointer' : 'default' }"
      )
        MapImage.map-preview(:mapName="model.startMap")
        .map-preview-hint(v-if="isHost") Change map
      .map-name-row
        .map-current-name {{ dmMapTitle }}
      DmMapPickerModal(ref="dmPickerModal" @select="onDmMapSelected" @close="dmPickerOpen = false")

  template(v-if="model.gameType === 'dm'")
    hr.setting-divider
    .setting-group
      .setting-label Frag Limit
      input.setting-number(type="number" min="0" max="999" v-model.number="model.fragLimit")
    .setting-group
      .setting-label
        | Time Limit&nbsp;
        span.setting-label-hint (minutes, 0 = off)
      input.setting-number(type="number" min="0" max="60" v-model.number="model.timeLimit")
</template>

<script lang="ts" setup>
import { computed, reactive, ref, watch } from 'vue'
import { idMaps, customDmMaps } from '../../../../../helpers/maps/multiplayer'
import type { GameSettings, GameTypes } from '../../../../../types/Room'
import MapImage from '../../../../MapImage.vue'
import MapPickerModal, { type MapPickerSelection } from './MapPickerModal.vue'
import DmMapPickerModal from './DmMapPickerModal.vue'
import { officialGameDefinitions, type MapName } from '../../../../../helpers/games'
import { useMapsStore } from '../../../../../stores/maps'
import { useGameStore } from '../../../../../stores/game'
import { getQuaddictedImageUrl } from '../../../../../helpers/map'

const props = defineProps<{
  modelValue: GameSettings
  isHost?: boolean
}>()
const emits = defineEmits<{ (e: 'update:modelValue', v: GameSettings): void }>()

const defaultMaps: Record<GameTypes, Pick<GameSettings, 'startMap' | 'gameDir' | 'sourceId' | 'skill'>> = {
  dm:   { startMap: 'aerowalk', gameDir: 'original', sourceId: 'official:original', skill: 1 },
  coop: { startMap: 'start', gameDir: 'original', sourceId: 'official:original', skill: 1 },
  ctf:  { startMap: 'e4m3', gameDir: 'original', sourceId: 'official:original', skill: 1 },
}

const model = reactive<GameSettings>({ ...props.modelValue })

const pickerModal = ref<InstanceType<typeof MapPickerModal> | null>(null)
const pickerOpen = ref(false)

const dmPickerModal = ref<InstanceType<typeof DmMapPickerModal> | null>(null)
const dmPickerOpen = ref(false)

const dmMapTitle = computed(() =>
  idMaps.concat(customDmMaps).find(m => m.name === model.startMap)?.title ?? model.startMap
)

const openDmPicker = () => {
  dmPickerOpen.value = true
  dmPickerModal.value?.open(model.startMap)
}

const onDmMapSelected = (mapName: MapName) => {
  dmPickerOpen.value = false
  setDmMapSelection(mapName)
}

const mapsStore = useMapsStore()
const gameStore = useGameStore()

// Display info for the selected pack (local state — not stored in GameSettings)
const customMapTitle = ref<string | null>(null)
const customMapAuthor = ref<string | null>(null)
const customMapRating = ref<number | null>(null)
const availableMapList = ref<{ name: string; title?: string }[]>([])
const customThumbUrl = ref<string | null>(null)

const initFromSourceId = (sourceId: string) => {
  const def = officialGameDefinitions.find(d => d.sourceId === sourceId)
  if (def) {
    availableMapList.value = def.mapList.map(m => ({ name: m.name, title: m.title }))
    if (model.gameType !== 'dm' && !availableMapList.value.find(m => m.name === model.startMap))
      model.startMap = availableMapList.value[0].name
  }
  customMapTitle.value = null
  customMapAuthor.value = null
  customMapRating.value = null
  customThumbUrl.value = null
}
initFromSourceId(model.sourceId)

const isCustomMap = computed(() => !model.sourceId.startsWith('official:'))

const quaddictedMap = computed(() => {
  if (!isCustomMap.value) return null
  const id = model.sourceId.split(':')[1]
  return mapsStore.getMapFromId(id) ?? null
})

const thumbMapName = computed(() => isCustomMap.value ? undefined : model.startMap)
const thumbFullPath = computed(() => {
  if (!isCustomMap.value) return undefined
  return customThumbUrl.value ?? (quaddictedMap.value ? getQuaddictedImageUrl(quaddictedMap.value.id, quaddictedMap.value.fileName) : undefined)
})

const selectedMapTitle = computed(() => {
  if (isCustomMap.value) return customMapTitle.value ?? quaddictedMap.value?.title ?? model.startMap
  return officialGameDefinitions.find(d => d.sourceId === model.sourceId)?.shortName ?? model.startMap
})

const selectedMapAuthor = computed(() => isCustomMap.value ? (customMapAuthor.value ?? quaddictedMap.value?.author ?? null) : null)
const selectedMapRating = computed(() => isCustomMap.value ? (customMapRating.value ?? quaddictedMap.value?.rating ?? null) : null)

const selectedMapSize = computed(() => {
  if (!isCustomMap.value) return null
  if (gameStore.packages.some(p => p.sourceId === model.sourceId)) return 'Loaded'
  const id = model.sourceId.split(':')[1]
  const m = mapsStore.getMapFromId(id)
  const b = m?.byteLength || m?.size
  if (!b) return null
  return b >= 1024 * 1024
    ? `${(b / (1024 * 1024)).toFixed(1)} MB`
    : `${(b / 1024).toFixed(0)} KB`
})

const openPicker = () => {
  pickerOpen.value = true
  pickerModal.value?.open(model.sourceId)
}

const onGameTypeChange = (e: Event) => {
  setGameType((e.target as HTMLSelectElement).value as GameTypes)
}

const setGameType = (gameType: GameTypes) => {
  model.gameType = gameType
  const d = defaultMaps[gameType]
  model.sourceId = d.sourceId
  model.gameDir = d.gameDir
  model.startMap = d.startMap
  model.skill = d.skill
  model.requiredPackages = undefined
  customMapTitle.value = null
  customMapAuthor.value = null
  customMapRating.value = null
  initFromSourceId(d.sourceId)
}

const setDmMapSelection = (val: MapName) => {
  model.sourceId = 'official:quake'
  delete model.gameDir
  model.startMap = val
  model.requiredPackages = undefined
}

const onMapSelected = (selection: MapPickerSelection) => {
  pickerOpen.value = false
  model.sourceId = selection.sourceId
  model.gameDir = selection.gameDir
  model.startMap = selection.startMap
  model.requiredPackages = selection.requiredPackages
  customMapTitle.value = selection.title
  customMapAuthor.value = selection.author || null
  customMapRating.value = selection.rating ?? null
  availableMapList.value = selection.mapList
  customThumbUrl.value = selection.thumbUrl || null
}

watch(model, () => { emits('update:modelValue', { ...model }) })
</script>

<style lang="scss" scoped>
@import '../../../../../scss/tokens';

.setting-group { display: flex; flex-direction: column; gap: 8px; }
.setting-group + .setting-group { margin-top: 8px; }

.setting-label {
  font-size: $font-2xs;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: $palette-muted;
}

.setting-label-hint {
  font-size: 10px;
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  color: $palette-muted;
}

.map-preview-wrap {
  position: relative;
  transition: border-color 0.15s;
  &:not([style*="default"]):hover .map-preview { border-color: $palette-text; }
  &.picker-open .map-preview { border-color: $palette-red; }
}

.map-preview {
  width: 100%;
  aspect-ratio: 4 / 3;
  border: $border-subtle;
  transition: border-color 0.15s;
}

.map-preview-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: $font-2xs;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0);
  transition: color 0.15s;
  pointer-events: none;

  .map-preview-wrap:hover & { color: rgba(255, 255, 255, 0.7); }
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

.setting-select {
  width: 100%;
  background: $palette-body;
  border: $border-subtle;
  color: $palette-bright;
  font-family: inherit;
  font-size: $font-sm;
  font-weight: $fw-semibold;
  padding: 8px 28px 8px 10px;
  outline: none;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23666'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  transition: border-color 0.15s;
  &:focus { border-color: $palette-text; }
  &:disabled { opacity: 0.5; cursor: default; }
}

.setting-number {
  width: 100%;
  background: $palette-body;
  border: $border-subtle;
  color: $palette-bright;
  font-family: inherit;
  font-size: $font-sm;
  font-weight: $fw-semibold;
  padding: 8px 10px;
  outline: none;
  transition: border-color 0.15s;
  &:focus { border-color: $palette-text; }
}

.setting-divider {
  border: none;
  border-top: $border-subtle;
  margin: 4px 0;
}
</style>
