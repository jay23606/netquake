<template lang="pug">
.card
  .card-header
    h6 Selected: {{map.title}}
    a(:href="props.map?.detailLink" target="_blank") Detail Page on Quaddicted
  .card-body(v-if="!!props && !!props.map")
    .content
      .details 
        .detail-grid
          div Start Map
          template(v-if="props.map.mapList.length == 1")
            .map-name {{props.map.mapList[0]}}
          template(v-else)
            .map-names
              select.select-sm.form-select(v-model="model.startMap")
                option(v-for="m in props.map.mapList" :value="m") {{m}}


          .map-label Average Rating
          .map-data
            Rating(:rating="parseFloat(props.map.rating)")


          .map-label Size
          .map-data {{addCommas(props.map.size)}}


          .map-label(v-if="props.map.requirements.length > 0") Base
          .map-data(v-if="props.map.requirements.length > 0") {{addCommas(props.map.requirements[0])}}

          div
          div
            MapLoadProgress(:map="props.map" v-if="isMapLoading")
            .start(v-else)
              QButton(
                @click="play"
                :disabled="isDisabled" 
                :tooltip="tooltipText"
                :size="ButtonSize.Medium"
                :tooltipPlacement="TooltipPlacement.right") Play!
      .image
        a(:href="props.map.detailLink" target="_blank")
          MapImage(:fullMapPath="mapImage.src")
            .map-text {{mapImage.alt}}
           

</template>

<script lang="ts" setup>
import {reactive, onMounted, computed, watch} from 'vue'
import MapLoadProgress from './MapLoadProgress.vue'
import { useMapsStore } from '../../../../stores/maps';
import { useGameStore } from '../../../../stores/game';
import type { QuaddictedMap } from '../../../../types/QuaddictedMap';
import QButton, {TooltipPlacement, ButtonSize} from '../../../input/QButton.vue'
import Rating from './Rating.vue'
import { addCommas } from '../../../../helpers/number';
import MapImage from '../../../MapImage.vue'

const emit = defineEmits<{
  (e: 'play', startMap: string): void}
>()

const mapsStore = useMapsStore()
const gameStore = useGameStore()
const guessStartMap = (startMaps: string[]) => {
  if (startMaps.includes('start')) {
    return 'start'
  }
  if (startMaps.includes('intro')) {
    return 'intro'
  }
  return startMaps[0] || ''
}
const props = defineProps<{
  map: QuaddictedMap
}>()
const model = reactive<{
  startMap: string,
  mapLaunching: boolean
}>({startMap: guessStartMap(props.map?.mapList), mapLaunching: false})

const isDisabled = computed(() => !gameStore.hasRegistered)
const mapImage = computed(() => {
  const filename = props.map.fileName
  const id = props.map.id
  const mapName = filename.substring(0, filename.lastIndexOf('.'))
  return {
    alt: mapName,
    src: `https://www.quaddicted.com/files/quaddicted-images/by-sha256/${id.slice(0,2)}/${id}/${mapName}.jpg`
  }
})

const isMapLoading = computed(() => mapsStore.mapLoadState === 'loading')
const startMap = computed(() => guessStartMap(props.map?.mapList))
const tooltipText = computed(() => {
  switch(true){
    case !gameStore.hasRegistered:
      return `You must load your pak1.pak before\nplaying modified games.\nSee FAQ for details.`
    // case props.map && props.map.requirements.length > 0: 
    //   return 'This requires loading additional resources \nwhich isn\'t supported yet:\n' + props.map?.requirements.join('\n')
    default:
      return 'Download and play this map'
  }
})

const play = () => emit('play', startMap.value)
</script>

<style scoped lang="scss">
.tooltip {
  opacity: 1; 
}
.content {
  display: grid;
  grid-template-columns: auto 300px;

  .detail-grid {
    display: grid;
    grid-template-columns: .5fr 1fr;
  }
  .map-image {
    display: block;
    grid-area: map;
    background-position: right;
    position: relative;
    height: 230px;
    background-repeat: no-repeat;
    background-size: cover;

    .map-text {
      text-shadow: 2px 2px rgb(0,0,0);
      //background-color: rgba(0,0,0,.4);
      position: absolute;
      bottom: 2px;
      left: 2px;
    }
  }
}
</style>