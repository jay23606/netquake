<template lang="pug">
#lateregistered
  .pak-required
    .pak-required-title Full game required
    .pak-required-body
      template(v-if="mod")
        | The mod&nbsp;
        code {{ mod }}
        | &nbsp;is built on the full version of Quake, but the full game assets (
        code pak1.pak
        | ) are not loaded yet.
      template(v-else)
        | This game requires the full version of Quake, but the full game assets (
        code pak1.pak
        | ) are not loaded yet.
    .pak-required-body Upload your&nbsp;
      code pak1.pak
      | &nbsp;once and the game will continue automatically.
    .pak-required-actions
      button.btn-upload(@click="gameStore.openPak1Modal()") Upload pak1.pak
      a.back-link(href="/") Nevermind, take me back
</template>

<script lang="ts" setup>
import { computed, watch, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useGameStore } from '../../../stores/game'

const route = useRoute()
const gameStore = useGameStore()
const emit = defineEmits<{
  (e: 'done'): void}
>()

const mod = computed(() => (route.query['-game'] as string) || '')

watch(() => gameStore.hasRegistered, registered => {
  if (registered) {
    gameStore.closePak1Modal()
    emit('done')
  }
}, { immediate: true })

onMounted(() => {
  if (!gameStore.hasRegistered) {
    gameStore.openPak1Modal()
  }
})
</script>

<style lang="scss" scoped>
@import '../../../scss/tokens';

#lateregistered {
  margin-top: 4rem;
  display: flex;
  justify-content: center;
  padding: 0 24px;
}

.pak-required {
  max-width: 480px;
  background: $palette-surface;
  border: $border-subtle;
  padding: 32px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.pak-required-title {
  font-size: 16px;
  font-weight: $fw-extrabold;
  color: $palette-bright;
  letter-spacing: -0.01em;
}

.pak-required-body {
  font-size: $font-sm;
  color: $palette-muted;
  line-height: 1.6;
  code { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: $palette-bright; }
}

.pak-required-actions {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-top: 8px;
}

.btn-upload {
  font-family: inherit;
  font-size: $font-xs;
  font-weight: $fw-bold;
  letter-spacing: $tracking-links;
  text-transform: uppercase;
  padding: 10px 20px;
  background: $palette-red;
  border: none;
  color: #fff;
  cursor: pointer;
  transition: background 0.15s;
  &:hover { background: lighten($palette-red, 6%); }
}

.back-link {
  font-size: $font-xs;
  color: $palette-muted;
  text-decoration: underline;
  text-underline-offset: 2px;
  &:hover { color: $palette-bright; }
}
</style>
