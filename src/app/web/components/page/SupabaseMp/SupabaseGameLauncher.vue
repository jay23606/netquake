<template>
  <div class="game-container">
    <PakLoader v-if="needsPak" @done="needsPak = false" />
    <Game v-else :quitRequest="model.isQuitting" @quit="gameQuit" />
  </div>
</template>

<script lang="ts" setup>
import { reactive, ref } from 'vue'
import { useRouter, onBeforeRouteLeave } from 'vue-router'
import Game from '../Game/Game.vue'
import PakLoader from '../Game/PakLoader.vue'
import { useSupabaseRoomStore } from '../../../stores/supabaseRoom'

// The Supabase equivalent of RoomGameLauncher. It deliberately does NOT call
// the legacy roomJoin helper: the room was already joined and the signaling
// broker already connected by the lobby, and Game.vue hands that broker to the
// engine through InitArgs.

const router = useRouter()
const store = useSupabaseRoomStore()
const needsPak = ref(false)
const model = reactive({ isQuitting: false })

const gameQuit = () => {
  model.isQuitting = true
  router.push('/mp')
}

onBeforeRouteLeave((to, from, next) => {
  if (model.isQuitting) return next()
  if (window.confirm('Do you really want to leave?')) {
    model.isQuitting = true
    void store.leave()
    next()
  } else {
    next(false)
  }
})
</script>

<style lang="scss" scoped>
.game-container { position: absolute; inset: 0; }
</style>
