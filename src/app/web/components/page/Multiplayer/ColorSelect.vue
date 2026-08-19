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
import {playerColors} from '../../../helpers/playerColors'
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
@import '../../../scss/colors.scss';
.selection-container {
  padding: .15rem;
  display: flex;
  align-items: center;
  background-color: lighten($body-bg, 1%);
  box-shadow: 0px 8px 15px rgba(0, 0, 0, 0.1);
  padding:4px;
  cursor: pointer;
  :active {
    box-shadow: 0 0 0 0.1rem rgb(87 85 217 / 20%);;
  }
  .color-current {
    position: relative;
  }
  i {
    margin-left: .25rem;
    font-size: .5rem;
    color:$border-color;
  }
}
.color-dropdown {
  .color-option {
    &.selected {
      border: 2px solid $border-color;
    }
    margin-bottom: .5rem;
    box-shadow: 0px 8px 15px rgba(0, 0, 0, 0.1);
    width: 25px;
    height: 25px;
  }
  ul {
    background-color: $body-bg;
    display: none;
    columns: 4;
    padding: 0px;
    padding: .5rem;
    position: absolute;
    z-index: 9;
    top: 0px;
    &.show {
      display: block;
    }
    li{
      margin: 0;  
      display: block;
    }
  }
}
.color-value {
  width: 75px;
  height: 20px;
}
</style>
