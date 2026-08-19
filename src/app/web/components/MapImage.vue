
<template lang="pug">
.map-image(:class="{ 'is-loading': state === 'loading' }")
  .map-image-shimmer
  img.map-image-img(
    v-if="mapUrl"
    :src="mapUrl"
    :class="{ loaded: state === 'loaded' || state === 'error' }"
    @load="state = 'loaded'"
    @error="onError"
  )
  slot
</template>

<script lang="ts" setup>
import { ref, computed, watch } from 'vue'
import { getMapImageUrl, genericImageUrl } from '../helpers/map'

const props = defineProps<{ mapName?: string, fullMapPath?: string, gameDir?: string }>()

const mapUrl = computed(() => props.fullMapPath || getMapImageUrl(props.mapName, props.gameDir))

const state = ref<'loading' | 'loaded' | 'error'>('loading')

watch(mapUrl, () => { state.value = 'loading' })

const fallbackUrl = computed(() => {
  if (props.fullMapPath || !props.gameDir) return null
  return getMapImageUrl(props.mapName)
})

const onError = (e: Event) => {
  const img = e.target as HTMLImageElement
  if (fallbackUrl.value && img.src !== fallbackUrl.value) {
    img.src = fallbackUrl.value
  } else if (img.src !== genericImageUrl) {
    state.value = 'error'
    img.src = genericImageUrl
  } else {
    state.value = 'error'
  }
}
</script>

<style lang="scss" scoped>
.map-image {
  position: relative;
  overflow: hidden;
  background: transparent;
}

.map-image-shimmer {
  position: absolute;
  inset: 0;
  background: #141414;
  overflow: hidden;

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.05) 50%, transparent 100%);
    animation: mi-shimmer 1.4s ease-in-out infinite;
  }

  .map-image:not(.is-loading) & { display: none; }
}

.map-image-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.25s ease;

  &.loaded { opacity: 1; }
}

@keyframes mi-shimmer {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
</style>
