<template lang="pug">
.button-wrapper
  button.btn(
    :class="buttonClasses"
    @click="emit('click')"
    :disabled="props.disabled"
    v-tippy="props.tooltip ? { content: props.tooltip, placement: tippyPlacement } : false")
    slot
</template>

<script lang="ts">
export enum ButtonSize {
  Normal,
  Small,
  Large,
  Medium = Normal,
}
export enum ButtonType {
  Normal,
  Primary,
  Link
}
export enum TooltipPlacement {
  Left,
  Top,
  Right,
  Bottom
}
</script>

<script setup lang="ts">
import {computed} from 'vue'

const emit = defineEmits<{
  (e: 'click'): void
}>()

const props = withDefaults(defineProps<{
  disabled?: boolean,
  tooltip?: string,
  type?: ButtonType,
  loading?: boolean,
  size?: ButtonSize,
  tooltipPlacement?: TooltipPlacement
}>(), {
  disabled: false,
  tooltip: '',
  type: ButtonType.Normal,
  loading: false,
  size: ButtonSize.Normal,
  tooltipPlacement: TooltipPlacement.Left
})

const buttonClasses = computed(() => {
  const cl: string[] = []
  if (props.loading) {
    cl.push('loading')
  }
  if (props.type === ButtonType.Link) {
    cl.push('btn-link')
  } else if (props.type === ButtonType.Primary) {
    cl.push('btn-primary')
  }
  if (props.size === ButtonSize.Small) {
    cl.push('btn-sm')
  } else if (props.size === ButtonSize.Large) {
    cl.push('btn-lg')
  }
  return cl
})

const tippyPlacement = computed(() => {
  switch(props.tooltipPlacement) {
    case TooltipPlacement.Bottom: return 'bottom'
    case TooltipPlacement.Right:  return 'right'
    case TooltipPlacement.Top:    return 'top'
    default:                      return 'left'
  }
})
</script>
