<template lang="pug">
.modal-overlay(@click.self="emit('cancel')")
  .modal-container
    .modal-header
      span.modal-title Player Settings
      button.modal-close(@click="emit('cancel')" aria-label="Close")
        font-awesome-icon(icon="fa-solid fa-xmark")

    .modal-body
      .modal-top-row
        //- Left: name + colors
        .col-left
          .field
            label.field-label Player Name
            QuakeTextInput(:maxLength="15" :modelValue="playerName" @update:modelValue="setPlayerName")

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

        //- Right: audio + display
        .col-right
          .field
            label.field-label Audio
            .setting-stack
              .subsetting
                .sublabel Master Volume
                .slider-row
                  input.field-range(
                    type="range" min="0" max="100"
                    :value="volumeDisplay"
                    @input="setVolume"
                  )
                  .slider-val {{ volumeDisplay }}
              .subsetting
                .sublabel Music Volume
                .slider-row
                  input.field-range(
                    type="range" min="0" max="100"
                    :value="musicDisplay"
                    @input="setMusic"
                  )
                  .slider-val {{ musicDisplay }}

          .field
            label.field-label Display
            .setting-stack
              .subsetting
                .sublabel Field of View
                .slider-row
                  input.field-range(
                    type="range" min="60" max="130"
                    :value="fovDisplay"
                    @input="setFov"
                  )
                  .slider-val {{ fovDisplay }}

      //- Full-width: control layout
      .col-full
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
      button.btn-close(type="button" @click="emit('cancel')") Close
</template>

<script lang="ts">
export default {}
</script>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useGameStore } from '../stores/game'
import { usePlayerStore } from '../stores/player'
import { playerColors } from '../helpers/playerColors'
import QuakeTextInput from './input/QuakeTextInput.vue'
import ModernControlImg from '../assets/modern-controls.svg'
import ClassicControlImg from '../assets/classic-controls.svg'

const gameStore = useGameStore()
const playerStore = usePlayerStore()

const playerName = computed(() => playerStore.playerName)

const emit = defineEmits<{
  (e: 'cancel'): void
}>()

// Read from autoexec first, fall back to config for defaults
const getVal = (name: string, fallback: string) =>
  gameStore.getAutoexecValue(name) ?? gameStore.getConfigValue(name) ?? fallback

// Player colors
const colorValue  = computed(() => parseInt(getVal('_cl_color', '0')))
const shirtValue  = computed(() => colorValue.value >> 4)
const pantValue   = computed(() => colorValue.value & 15)
const setShirtColor = (v: number) => setColors((v << 4) + pantValue.value)
const setPantColor  = (v: number) => setColors((shirtValue.value << 4) + v)
const setColors = (v: number) => gameStore.setAutoexecValue({ name: '_cl_color', value: v.toFixed(0) })

// Volume (0.0–1.0, UI: 0–100)
const volumeDisplay = computed(() => Math.round(parseFloat(getVal('volume', '0.7')) * 100))
const setVolume = (e: Event) => {
  const v = parseInt((e.target as HTMLInputElement).value) / 100
  gameStore.setAutoexecValue({ name: 'volume', value: v.toFixed(2) })
}

// Music volume (bgmvolume: 0.0–1.0, UI: 0–100)
const musicDisplay = computed(() => Math.round(parseFloat(getVal('bgmvolume', '1')) * 100))
const setMusic = (e: Event) => {
  const v = parseInt((e.target as HTMLInputElement).value) / 100
  gameStore.setAutoexecValue({ name: 'bgmvolume', value: v.toFixed(2) })
}

// FOV (degrees, 60–130)
const fovDisplay = computed(() => parseInt(getVal('fov', '90')))
const setFov = (e: Event) => {
  gameStore.setAutoexecValue({ name: 'fov', value: (e.target as HTMLInputElement).value })
}

// Control layout
const controlStyle = computed(() => gameStore.getCurrentConfigType)

const setPlayerName = (v: string) => {
  gameStore.setAutoexecValue({ name: 'name', value: v })
}

const cancelOnEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') emit('cancel') }
onMounted(() => document.addEventListener('keydown', cancelOnEsc))
onUnmounted(() => document.removeEventListener('keydown', cancelOnEsc))
</script>

<style lang="scss" scoped>
@import '../scss/tokens';

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  padding: 24px;

  @media (max-width: 560px) {
    padding: 0;
    align-items: stretch;
  }
}

.modal-container {
  background: $palette-surface;
  border: $border-subtle;
  width: 100%;
  max-width: 680px;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  @media (max-width: 560px) {
    max-width: 100%;
    height: 100%;
    border: none;
  }
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
  gap: 0;
  overflow-y: auto;
  flex: 1;
}

// Two-column top section
.modal-top-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 24px;
  margin-bottom: 18px;
}

.col-left {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding-right: 24px;
  border-right: $border-subtle;
}

.col-right {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.col-full {
  padding-top: 18px;
  border-top: $border-subtle;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.modal-footer {
  padding: 14px 24px;
  border-top: $border-subtle;
  display: flex;
  justify-content: center;
  flex-shrink: 0;
}

// Fields
.field { display: flex; flex-direction: column; gap: 7px; }

.field-label {
  font-size: $font-2xs;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: $tracking-labels;
  color: $palette-muted;
}

// Color swatches
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

// Audio / display sub-sections
.setting-stack { display: flex; flex-direction: column; gap: 12px; }
.subsetting { display: flex; flex-direction: column; gap: 4px; }

.slider-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  align-items: center;
}

.slider-val {
  font-size: $font-xs;
  font-weight: $fw-bold;
  color: $palette-bright;
  font-family: 'JetBrains Mono', monospace;
  min-width: 32px;
  text-align: right;
}

.field-range {
  appearance: none;
  width: 100%;
  height: 3px;
  background: $palette-border;
  outline: none;
  cursor: pointer;

  &::-webkit-slider-thumb {
    appearance: none;
    width: 13px;
    height: 13px;
    background: $palette-bright;
    border-radius: 50%;
    cursor: pointer;
    transition: background 0.15s;
    &:hover { background: $palette-red; }
  }
  &::-moz-range-thumb {
    width: 13px;
    height: 13px;
    background: $palette-bright;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }
}


// Layout cards
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

// Buttons
.btn-close {
  font-family: inherit;
  font-size: $font-xs;
  font-weight: $fw-bold;
  letter-spacing: $tracking-links;
  text-transform: uppercase;
  padding: 9px 32px;
  background: $palette-red;
  color: $palette-bright;
  border: none;
  cursor: pointer;
  transition: $transition-bg;
  &:hover { background: lighten($palette-red, 6%); }
}

// Responsive
@media (max-width: 560px) {
  .modal-top-row { grid-template-columns: 1fr; }
  .col-left { border-right: none; padding-right: 0; border-bottom: $border-subtle; padding-bottom: 18px; }
  .modal-footer { padding: 12px 16px; }
  .modal-header { padding: 14px 16px; }
  .modal-body { padding: 16px; }
}
</style>
