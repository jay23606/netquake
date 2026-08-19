<template lang="pug">
section.hero
  p.hero-tag Quake 1 — Now in Your Browser
  h1.hero-title
    | Classic Quake.
    br
    em No install.
  p.hero-desc The original arena shooter, running in your browser. No downloads. Jump in free or unlock the full game with your copy of Quake.
  .hero-actions
    button.btn.btn-lg(@click="start()") ▶ Play Now
    button.btn.btn-ghost.btn-lg(@click="multiplayer()") Multiplayer
  template(v-if="!packOne")
    .hero-pak-cta(@click="gameStore.openPak1Modal()")
      span.hero-pak-prompt Own Quake?
      span.hero-pak-link Upload pak1.pak to unlock all 4 episodes →
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { useGameStore } from '../../stores/game'
import { useRouter } from 'vue-router'

const router = useRouter()
const gameStore = useGameStore()
const assetMetas = computed(() => gameStore.assetMetas.filter(a => a.game === 'id1'))
const packOne = computed(() => assetMetas.value.find(a => a.fileName.toLowerCase() === 'pak1.pak'))

const start = () => router.push({ name: 'quake' })
const multiplayer = () => router.push({ name: 'multiplayer' })
</script>

<style lang="scss" scoped>
.hero {
  max-width: 900px;
  margin: 0 auto;
  padding: 96px 48px 80px;

  @media (max-width: 768px) { padding: 56px 24px 48px; }
  @media (max-width: 480px) { padding: 40px 20px 36px; }
}

.hero-tag {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #e03020;
  margin-bottom: 20px;
}

.hero-title {
  font-size: 52px;
  font-weight: 900;
  line-height: 1.0;
  letter-spacing: -0.02em;
  color: #ffffff;
  margin-bottom: 20px;

  em {
    color: #e03020;
    font-style: normal;
  }

  @media (max-width: 768px) { font-size: 38px; }
  @media (max-width: 480px) { font-size: 32px; }
}

.hero-desc {
  font-size: 15px;
  color: #888;
  line-height: 1.7;
  margin-bottom: 36px;
  max-width: 340px;
}

.hero-actions {
  display: flex;
  flex-direction: row;
  gap: 12px;
  margin-bottom: 20px;

  @media (max-width: 600px) {
    flex-direction: column;
    max-width: 100%;
  }
}

.hero-pak-cta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 20px;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}

.hero-pak-prompt {
  font-size: 13px;
  color: #666;
}

.hero-pak-link {
  font-size: 13px;
  font-weight: 700;
  color: #f0b800;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}


</style>
