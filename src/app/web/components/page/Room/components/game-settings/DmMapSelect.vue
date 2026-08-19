<template lang="pug">
.map-select
  select.setting-select(@change="$emit('update:modelValue', $event.target.value)")
    option(
      v-for="map in props.mapList"
      :selected="map.name === props.modelValue" 
      :value="map.name"
    ) {{getMapDisplay(map)}}
</template>

<script lang="ts" setup>
import type { MapName, MultiplayerMap } from '../../../../../helpers/games';

const emits = defineEmits<{
  (e: 'update:modelValue', modelValue: MapName): void
}>()

const props = withDefaults(
  defineProps<{
    mapList: MultiplayerMap[]
    modelValue: MapName
  }>(),
  {
    modelValue: ''
  })

const getMapDisplay = (map: MultiplayerMap) => {
  return `${map.title} (${map.name})`
}
</script>

<style lang="scss" scoped>
@import '../../../../../scss/tokens';

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