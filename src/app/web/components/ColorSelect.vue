<template lang="pug">
.color-select(@click="model.show = !model.show" v-on-click-outside="() => model.show = false")
  .selection-container
    .color-current.color-value(:style=`{
      'background-color': playerColors[props.modelValue]
    }`)
      .color-dropdown
        ul(:class="model.show ? 'show' : ''")
          li(v-for="(color, idx) in playerColors"
            @click.stop="select(idx)")
            .color-option(
              :class=" props.modelValue === idx ? 'selected' : ''"
              :style=`{
                'background-color': color
              }`)
    //i.icon(:class="model.show ? 'icon-arrow-down' : 'icon-arrow-up'")
</template>

<script lang="ts" setup>
import {reactive} from 'vue'
import {playerColors} from '../helpers/playerColors'
import { vOnClickOutside } from '@vueuse/components'

const props = withDefaults(defineProps<{
  modelValue: number
}>(), {modelValue: 0})
const emit = defineEmits<{
  (e: 'update:modelValue', value: number): void
}>()
const model = reactive<{
  show: boolean
}>({show: false})
const select = (colorValue: number) => {
  emit('update:modelValue', colorValue)
  model.show = false
}
</script>

<style lang="scss">
@import '../scss/tokens';

.color-select { position: relative; display: inline-block; }

.selection-container {
  display: flex;
  align-items: center;
  background: $palette-body;
  border: $border-subtle;
  padding: 4px;
  cursor: pointer;
  transition: border-color 0.15s;
  &:hover { border-color: $palette-muted; }
}

.color-current { position: relative; }

.color-value {
  width: 80px;
  height: 22px;
  display: block;
}

.color-dropdown {
  ul {
    display: none;
    position: absolute;
    z-index: 20;
    top: calc(100% + 4px);
    left: 0;
    background: $palette-surface;
    border: $border-subtle;
    padding: 6px;
    columns: 4;
    &.show { display: block; }
    li { margin: 0; display: block; }
  }

  .color-option {
    width: 24px;
    height: 24px;
    margin-bottom: 4px;
    cursor: pointer;
    transition: outline 0.1s;
    &.selected { outline: 2px solid $palette-bright; }
    &:hover { outline: 2px solid $palette-muted; }
  }
}
</style>
