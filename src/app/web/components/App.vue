<template lang="pug">
router-view
Pak1UploadModal(:open="gameStore.pak1ModalOpen" @close="gameStore.closePak1Modal()")
</template>
<script lang="ts" setup>
import { onMounted } from 'vue';
import {useMultiplayerStore} from '../stores/multiplayer'
import {useGameStore} from '../stores/game'
import {useMapsStore} from '../stores/maps'
import { useRoomHubStore } from '../stores/room-hub';
import * as indexedDb from '../../../shared/indexeddb'
import { useToast } from 'vue-toastification'
import Pak1UploadModal from './page/Setup/SetupGame/Pak1UploadModal.vue'

const multiplayerStore = useMultiplayerStore()
const gameStore = useGameStore()
const mapsStore = useMapsStore()
const toast = useToast()

onMounted(async () => {
  gameStore.loadConfig()
  if (!gameStore.configFile) {
    gameStore.loadRecommendedConfig()
  }
  gameStore.loadAutoexec()
  if (!gameStore.autoexecFile) {
    gameStore.loadRecommendedAutoexec()
  }

  mapsStore.loadMapListing()
  await gameStore.loadAssets()
  if (indexedDb.wasReset) {
    toast.warning('Your game file storage was reset due to a database error. Please re-upload your pak files.')
  }
  gameStore.loadPackages()
  multiplayerStore.refreshLoop()
  useRoomHubStore().refreshLoop()
})
</script>