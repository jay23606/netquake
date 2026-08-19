<template lang="pug">
.game-select

  select.setting-select(v-if="props.isRegistered" @change="onChangeGame($event.target.value)")
    option(v-for="source in allSources" :value="source.sourceId") {{source.name}}
  select.setting-select(@change="onChangeMap($event.target.value)")
    option(v-for="map in sortedMapList" :value="map.name") {{mapDisplayName(map)}}
</template>

<script lang="ts" setup>
import {computed, onMounted, reactive, watch} from 'vue'
import { OfficialSource, type Source, type SourceId } from '../../../../shared/types/Source';
import { useGameStore } from '../../stores/game';
import { useMapsStore } from '../../stores/maps';
import { officialGameDefinitions, parseSourceId } from '../../helpers/games'
import type {GameDir, GameMap, MapName} from '../../helpers/games'
import * as indexedDb from '../../../../shared/indexeddb'
import { isMap, sharewareMaps } from '../../helpers/map';
import { getMapFilenames } from '../../helpers/assetChecker';

export type MapGameSelection = {
  sourceId: SourceId,
  gameDir: GameDir,
  map: MapName
}

type GameSelection = {
  source: Source,
  sourceId: SourceId,
  packageId?: number,
  name: MapName,
  gameDir: GameDir
}

const emit = defineEmits<{
  (e: 'update:modelValue', modelValue: MapGameSelection): void
}>()

const props = defineProps<{
  modelValue: MapGameSelection,
  isRegistered: boolean,
  allowedSources?: Source[]
}>()

const gameStore = useGameStore()
const mapStore = useMapsStore()

const sourceAllowed = (sourceType: Source) => {
  if (!props.allowedSources) return true
  return props.allowedSources.includes(sourceType)
}

const officialSources: GameSelection[] = !sourceAllowed(OfficialSource)
  ? [] 
  : officialGameDefinitions
    .map(gameDef => ({
      source: OfficialSource,
      sourceId: `${OfficialSource}:${gameDef.game}`,
      name: gameDef.name,
      gameDir: gameDef.game
    }))


const packageSources = computed<GameSelection[]>(() => gameStore.packages
  .map(pkg => ({
    source: parseSourceId(pkg.sourceId),
    pkg
  }))
  .filter(({source}) => !props.allowedSources || props.allowedSources.includes(source.type))
  .map(({pkg, source}) => ({
    source: source.type,
    sourceId: pkg.sourceId,
    packageId: pkg.packageId, 
    name: pkg.name,
    gameDir: pkg.gameDir,
  })))

const allSources = computed(() => [
  ...officialSources,
  ...packageSources.value
])

const model = reactive<{
  mapList: GameMap[],
  mapLoading: boolean
}>({
  mapList: [],
  mapLoading: false
})

const mapDisplayName = (map: GameMap) => {
  if (map.title) {
    return `${map.collection ? `${map.collection} - ` : ''}${map.title}`
  }
  return map.name
}

const sortedMapList = computed(() => {
  // sort the map list - keeping the maps "intro", "start", "end" at the start if they exist
  const startMapNames = ['intro', 'start']
  const endMapNames = ['finale', 'end']
  return [
    ...model.mapList.filter(m => startMapNames.includes(m.name)), 
    ...model.mapList.filter(m => !startMapNames.includes(m.name) && !endMapNames.includes(m.name)).sort(),
    ...model.mapList.filter(m => endMapNames.includes(m.name))
  ]
})

onMounted(async () => {
  // Initial load
  await onChangeGame(props.modelValue.sourceId)
})

const onChangeGame = async (sourceId: SourceId) => {
  const selectedSource = allSources.value.find(source => source.sourceId === sourceId)
  if (!selectedSource) { // Shouldn't be possible.
    return
  }
  const source = parseSourceId(sourceId)
  switch(source.type) {
    case 'quaddicted':
    case 'custom':
      const pkg = packageSources.value.find(pkg => pkg.sourceId === selectedSource.sourceId)
      model.mapLoading = true
      const customMapList = await mapStore.getMapListForPackage(pkg?.packageId!)
      model.mapList = customMapList.map(m => ({name: m, title: '', collection: 'custom'}))
      model.mapLoading = false
      break;
    case 'official':
      model.mapList = (officialGameDefinitions
      .find(g => g.game === selectedSource.gameDir)?.mapList || [])
        .filter(m => props.isRegistered || sharewareMaps.includes(m.name))
      break;
  }
  emit('update:modelValue', selectedSource
    ? { ...selectedSource, sourceId, map: sortedMapList.value[0]?.name || 'start' }
    : props.modelValue)
}

const onChangeMap = (map: string) => {
  emit('update:modelValue', { ...props.modelValue, map })
}
// -- Multiplayer
//    - must have quaddicted sourceId
//        - TODO - Allow custom via peer data transfer
//    - selectable row with map select

// -- Singleplayer
//    - allow all - allow map select
</script>

<style lang="scss" scoped>
@import '../../scss/tokens';

.game-select { display: flex; flex-direction: column; gap: 8px; }

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
}
</style>