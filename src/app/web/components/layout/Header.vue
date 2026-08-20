<template lang="pug">
header.flex.items-center.justify-between(class="px-6 md:px-12 h-12 xs:h-14")
  router-link.site-logo(to='/')
    | NETQUAKE
    em= "."
    | IO
  nav.site-links(class="hidden md:flex gap-8")
    router-link(:to="{name: 'singleplayer'}") Quake 1
    a(:href="q2Url") Quake 2
    router-link(:to="{name: 'sb-multiplayer'}") Multiplayer
    router-link(:to="{name: 'setup'}") Q1 Setup
  .flex.items-center.gap-1
    font-awesome-icon.pak1-icon.pak1-loaded(
      v-if="hasPak1"
      icon="fa-solid fa-circle-check"
      v-tippy
      content="Quake 1: full game loaded"
    )
    button.pak1-icon.pak1-upload(
      v-else
      @click="gameStore.openPak1Modal()"
      v-tippy
      content="Quake 1: upload pak1.pak to unlock all four episodes. Quake 2 data is added on the Quake 2 page."
    )
      font-awesome-icon(icon="fa-solid fa-upload")
    router-link.faq-icon(:to="{name: 'faq'}" v-tippy content="FAQ")
      font-awesome-icon(icon="fa-solid fa-question")
    Profile
    button.hamburger(class="flex md:hidden" @click="menuOpen = !menuOpen" aria-label="Menu") ☰

div.mobile-menu.site-links(:class="{ open: menuOpen }")
  router-link(:to="{name: 'singleplayer'}" @click="menuOpen = false") Quake 1
  a(:href="q2Url" @click="menuOpen = false") Quake 2
  router-link(:to="{name: 'sb-multiplayer'}" @click="menuOpen = false") Multiplayer
  router-link(:to="{name: 'setup'}" @click="menuOpen = false") Q1 Setup
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue'
import Profile from './Profile.vue'
import { useGameStore } from '../../stores/game'

const menuOpen = ref(false)
const gameStore = useGameStore()
// Quake 2 is a separate application mounted alongside this one, so it is a
// plain link rather than a route, resolved against the deploy's base path.
const q2Url = computed(() => `${import.meta.env.BASE_URL}q2/`)

const hasPak1 = computed(() =>
  gameStore.assetMetas.some(a => a.game === 'id1' && a.fileName.toLowerCase() === 'pak1.pak')
)
</script>

<style lang="scss" scoped>
@import '../../scss/tokens';

.pak1-icon {
  font-size: 15px;
  padding: 4px 6px;
  line-height: 1;

  &.pak1-loaded {
    color: #4a9e4a;
    cursor: default;
  }

  &.pak1-upload {
    background: none;
    border: none;
    color: #e07820;
    cursor: pointer;
    display: flex;
    align-items: center;
    transition: $transition-color;
    &:hover { color: lighten(#e07820, 12%); }
  }
}

.faq-icon {
  display: flex;
  align-items: center;
  font-size: 15px;
  color: $palette-muted;
  padding: 4px 6px;
  line-height: 1;
  transition: color 0.15s;
  &:hover, &.router-link-active { color: $palette-bright; }
}

header {
  border-bottom: 1px solid $palette-border;
}

.hamburger {
  background: none;
  border: none;
  color: $palette-text;
  font-size: 20px;
  cursor: pointer;
  padding: 4px 8px;
}

.mobile-menu {
  display: none;
  flex-direction: column;
  background: $palette-surface;
  border-bottom: 1px solid $palette-border;

  a {
    padding: 14px 24px;
    border-bottom: 1px solid $palette-border;
  }

  &.open { display: flex; }
}
</style>
