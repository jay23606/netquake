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

// The Supabase counterpart to the old RoomGameLauncher. It deliberately does
// not join anything: the lobby already joined the room and connected the
// signaling broker, and Game.vue hands that broker to the engine via InitArgs.

const router = useRouter()
const store = useSupabaseRoomStore()
const needsPak = ref(false)
const model = reactive({ isQuitting: false })

// Quitting returns to the room rather than leaving it, so a group can play
// another round. The host also puts the room back in the lobby state, which is
// what releases everyone else from the in-game watcher.
const gameQuit = async () => {
  model.isQuitting = true
  try {
    if (store.isHost) await store.reopen()
  } finally {
    router.push('/mp')
  }
}

onBeforeRouteLeave((to, from, next) => {
  if (model.isQuitting) return next()
  if (window.confirm('Leave the game?')) {
    model.isQuitting = true
    if (store.isHost) void store.reopen()
    next()
  } else {
    next(false)
  }
})
</script>

<style lang="scss" scoped>
.game-container { position: absolute; inset: 0; }
</style>
