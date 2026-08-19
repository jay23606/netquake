<template lang="pug">
.modal-overlay(@click.self="emit('cancel')")
  .modal-container
    .modal-header
      span.modal-title Customize Player
      button.modal-close(@click="emit('cancel')" aria-label="Close")
        font-awesome-icon(icon="fa-solid fa-xmark")

    .modal-body
      .field
        label.field-label Player Name
        QuakeTextInput(:maxLength="15" :modelValue="playerName" @update:modelValue="setPlayerName($event)")

      .field
        label.field-label Colors
        .color-row
          .color-half
            .sublabel Shirt
            .swatches
              .swatch(
                v-for="(color, idx) in playerColors"
                :key="idx"
                :style="{ background: color }"
                :class="{ active: shirtValue === idx }"
                @click="setShirtColor(idx)"
              )
          .color-half
            .sublabel Pants
            .swatches
              .swatch(
                v-for="(color, idx) in playerColors"
                :key="idx"
                :style="{ background: color }"
                :class="{ active: pantValue === idx }"
                @click="setPantColor(idx)"
              )

      .field
        label.field-label Control Layout
        .layout-options
          button.layout-card(
            type="button"
            :class="{ active: controlStyle === 'modern' }"
            @click="gameStore.loadModernConfig"
          )
            ModernControlImg.layout-svg
            span.layout-name Mouse + Keyboard
          button.layout-card(
            type="button"
            :class="{ active: controlStyle === 'classic' }"
            @click="gameStore.loadClassicConfig"
          )
            ClassicControlImg.layout-svg
            span.layout-name Keyboard Only

    .modal-footer
      button.btn-ghost-sm(v-if="props.showCancel" type="button" @click="emit('cancel')") Cancel
      button.btn-save(type="button" @click="emit('ok')") {{ props.okText }}
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useGameStore } from '../../../stores/game'
import { playerColors } from '../../../helpers/playerColors'
import QuakeTextInput from '../../input/QuakeTextInput.vue'
import ModernControlImg from '../../../assets/modern-controls.svg'
import ClassicControlImg from '../../../assets/classic-controls.svg'

const gameStore = useGameStore()

const props = withDefaults(defineProps<{
  showCancel: boolean
  okText: string
}>(), { showCancel: false, okText: 'OK' })

const emit = defineEmits<{
  (e: 'ok'): void
  (e: 'cancel'): void
}>()

const getVal = (name: string, fallback: string) =>
  gameStore.getAutoexecValue(name) ?? gameStore.getConfigValue(name) ?? fallback

const controlStyle = computed(() => gameStore.getCurrentConfigType)
const playerName = computed(() => getVal('name', 'player'))
const setPlayerName = (name: string) => gameStore.setAutoexecValue({ name: 'name', value: name })

const colorValue = computed(() => parseInt(getVal('_cl_color', '0')))
const shirtValue = computed(() => colorValue.value >> 4)
const pantValue = computed(() => colorValue.value & 15)
const setShirtColor = (v: number) => setColors((v << 4) + pantValue.value)
const setPantColor = (v: number) => setColors((shirtValue.value << 4) + v)
const setColors = (v: number) => gameStore.setAutoexecValue({ name: '_cl_color', value: v.toFixed(0) })

const cancelOnEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') emit('cancel') }
onMounted(() => document.addEventListener('keydown', cancelOnEsc))
onUnmounted(() => document.removeEventListener('keydown', cancelOnEsc))
</script>

<style lang="scss" scoped>
@import '../../../scss/tokens';

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  padding: 24px;
}

.modal-container {
  background: $palette-surface;
  border: $border-subtle;
  width: 100%;
  max-width: 560px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: $border-subtle;
  flex-shrink: 0;
}

.modal-title {
  font-size: $font-base;
  font-weight: $fw-black;
  color: $palette-bright;
  letter-spacing: -0.01em;
}

.modal-close {
  background: none;
  border: none;
  cursor: pointer;
  color: $palette-muted;
  font-size: $font-base;
  padding: 2px 4px;
  line-height: 1;
  transition: $transition-color;
  &:hover { color: $palette-bright; }
}

.modal-body {
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.modal-footer {
  padding: 14px 24px;
  border-top: $border-subtle;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex-shrink: 0;
}

.field { display: flex; flex-direction: column; gap: 7px; }

.field-label {
  font-size: $font-2xs;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: $tracking-labels;
  color: $palette-muted;
}

.color-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

.sublabel {
  font-size: $font-2xs;
  font-weight: $fw-semibold;
  color: $palette-muted;
  margin-bottom: 6px;
}

.swatches { display: flex; flex-wrap: wrap; gap: 5px; }

.swatch {
  width: 24px;
  height: 24px;
  border: 2px solid transparent;
  cursor: pointer;
  flex-shrink: 0;
  transition: transform 0.1s, border-color 0.1s;
  &:hover { transform: scale(1.15); }
  &.active { border-color: $palette-bright; }
}

.layout-options { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

.layout-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 12px 10px;
  background: $palette-body;
  border: $border-subtle;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  font-family: inherit;

  &:hover { border-color: $palette-text; }
  &.active { border-color: $palette-red; background: rgba($palette-red, 0.05); }
}

.layout-svg { width: 100%; height: 56px; }

.layout-name {
  font-size: $font-2xs;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: $palette-muted;
  text-align: center;

  .active & { color: $palette-bright; }
}

.btn-ghost-sm {
  font-family: inherit;
  font-size: $font-xs;
  font-weight: $fw-bold;
  letter-spacing: $tracking-links;
  text-transform: uppercase;
  padding: 9px 22px;
  background: transparent;
  border: $border-subtle;
  color: $palette-muted;
  cursor: pointer;
  transition: all 0.15s;
  &:hover { color: $palette-bright; border-color: $palette-text; }
}

.btn-save {
  font-family: inherit;
  font-size: $font-xs;
  font-weight: $fw-bold;
  letter-spacing: $tracking-links;
  text-transform: uppercase;
  padding: 9px 22px;
  background: $palette-red;
  color: $palette-bright;
  border: none;
  cursor: pointer;
  transition: $transition-bg;
  &:hover { background: lighten($palette-red, 6%); }
}
</style>
