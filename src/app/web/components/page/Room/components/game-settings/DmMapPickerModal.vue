<template lang="pug">
Teleport(to="body")
  .map-picker-overlay(v-if="isOpen" @click.self="close")
    .map-picker-panel
      .mpp-head
        .mpp-title Select Map
        button.mpp-close(@click="close") ✕

      .mpp-body
        .map-grid
          .map-card(
            v-for="map in idMaps"
            :key="map.name"
            :class="{ active: selectedName === map.name }"
            @click="select(map)"
          )
            .mc-thumb(:class="{ 'thumb-loading': thumbStates[map.name] !== 'loaded' && thumbStates[map.name] !== 'error' }")
              .mc-thumb-bg
              img.mc-thumb-img(
                :src="getMapImageUrl(map.name)"
                :class="{ loaded: thumbStates[map.name] === 'loaded' || thumbStates[map.name] === 'error' }"
                loading="lazy"
                @load="thumbStates[map.name] = 'loaded'"
                @error="onThumbError($event, map.name)"
              )
              .mc-thumb-vignette
            .mc-body
              .mc-name {{ map.title }}
              .mc-sub {{ map.name }}{{ map.author ? ' · ' + map.author : '' }}
              .mc-tags
                span.mc-tag {{ map.size }}
                span.mc-tag.tag-popular(v-if="map.played === 'regularly'") Popular
            .mc-overlay

          .mpp-divider
            span Custom Maps

          .map-card(
            v-for="map in customDmMaps"
            :key="map.name"
            :class="{ active: selectedName === map.name }"
            @click="select(map)"
          )
            .mc-thumb(:class="{ 'thumb-loading': thumbStates[map.name] !== 'loaded' && thumbStates[map.name] !== 'error' }")
              .mc-thumb-bg
              img.mc-thumb-img(
                :src="getMapImageUrl(map.name)"
                :class="{ loaded: thumbStates[map.name] === 'loaded' || thumbStates[map.name] === 'error' }"
                loading="lazy"
                @load="thumbStates[map.name] = 'loaded'"
                @error="onThumbError($event, map.name)"
              )
              .mc-thumb-vignette
            .mc-body
              .mc-name {{ map.title }}
              .mc-sub {{ map.name }}{{ map.author ? ' · ' + map.author : '' }}
              .mc-tags
                span.mc-tag {{ map.size }}
                span.mc-tag.tag-popular(v-if="map.played === 'regularly'") Popular
            .mc-overlay
</template>

<script lang="ts" setup>
import { ref, reactive } from 'vue'
import { idMaps, customDmMaps } from '../../../../../helpers/maps/multiplayer'
import { getMapImageUrl, genericImageUrl } from '../../../../../helpers/map'
import type { MultiplayerMap } from '../../../../../helpers/games'

const emits = defineEmits<{
  (e: 'select', mapName: string): void
  (e: 'close'): void
}>()

const isOpen = ref(false)
const selectedName = ref('')
const thumbStates = reactive<Record<string, 'loading' | 'loaded' | 'error'>>({})

const onThumbError = (e: Event, name: string) => {
  thumbStates[name] = 'error'
  const img = e.target as HTMLImageElement
  if (img.src !== genericImageUrl) img.src = genericImageUrl
}

const open = (currentMapName?: string) => {
  selectedName.value = currentMapName || ''
  isOpen.value = true
}

const close = () => {
  isOpen.value = false
  emits('close')
}

const select = (map: MultiplayerMap) => {
  emits('select', map.name)
  close()
}

defineExpose({ open, close })
</script>

<style lang="scss" scoped>
@import '../../../../../scss/tokens';

.map-picker-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.map-picker-panel {
  background: $palette-surface;
  border: $border-subtle;
  width: 100%;
  max-width: 720px;
  max-height: 76vh;
  display: flex;
  flex-direction: column;
  animation: fadeUp 0.18s ease;
}

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes shimmer {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

.mpp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  border-bottom: $border-subtle;
  flex-shrink: 0;
}

.mpp-title {
  font-size: $font-sm;
  font-weight: $fw-black;
  color: $palette-bright;
}

.mpp-close {
  background: none;
  border: none;
  color: $palette-muted;
  font-size: 18px;
  cursor: pointer;
  line-height: 1;
  transition: $transition-color;
  &:hover { color: $palette-bright; }
}

.mpp-body {
  flex: 1;
  overflow-y: auto;
}

.map-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1px;
  background: $palette-border;
}

.mpp-divider {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px 8px;
  background: $palette-body;

  span {
    font-size: $font-2xs;
    font-weight: $fw-bold;
    text-transform: uppercase;
    letter-spacing: $tracking-labels;
    color: $palette-muted;
    white-space: nowrap;
  }

  &::after {
    content: '';
    flex: 1;
    height: 1px;
    background: $palette-border;
  }
}

.map-card {
  background: $palette-surface;
  cursor: pointer;
  transition: background 0.15s;
  position: relative;
  overflow: hidden;

  &:hover { background: #2e2e2e; }
  &.active::after {
    content: '';
    position: absolute;
    inset: 0;
    border: 2px solid $palette-red;
    pointer-events: none;
    z-index: 10;
  }
  &:hover .mc-overlay { opacity: 1; }
}

.mc-thumb {
  width: 100%;
  aspect-ratio: 4 / 3;
  position: relative;
  overflow: hidden;
}

.mc-thumb-bg {
  position: absolute;
  inset: 0;
  background: $palette-body;
  overflow: hidden;

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.05) 50%, transparent 100%);
    animation: shimmer 1.4s ease-in-out infinite;
  }

  .mc-thumb:not(.thumb-loading) & { display: none; }
}

.mc-thumb-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.25s ease;

  &.loaded { opacity: 1; }
}

.mc-thumb-vignette {
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.5) 100%);
}

.mc-body {
  padding: 8px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.mc-name {
  font-size: $font-xs;
  font-weight: $fw-extrabold;
  color: $palette-bright;
  line-height: 1.2;
}

.mc-sub {
  font-size: 10px;
  color: $palette-muted;
  font-family: 'JetBrains Mono', monospace;
}

.mc-tags {
  display: flex;
  gap: 4px;
  margin-top: 2px;
  flex-wrap: wrap;
}

.mc-tag {
  font-size: 9px;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: $palette-muted;
  border: 1px solid $palette-border;
  padding: 1px 5px;

  &.tag-popular { color: $palette-yellow; border-color: rgba($palette-yellow, 0.4); }
}

.mc-overlay {
  position: absolute;
  inset: 0;
  background: rgba(224, 48, 32, 0.12);
  opacity: 0;
  transition: opacity 0.15s;
  pointer-events: none;
}
</style>
