<template lang="pug">
.config
  label.form-label Quake config.cfg File
  p Various binds and variables from the game are stored here. The game will overwrite this file anytime you quit.
  button.btn(@click="gameStore.loadRecommendedConfig") Load Recommended
  .config-editor
    textarea.form-input(placeholder="Textarea" rows="20" cols="80" :value="gameStore.configFile" @input="gameStore.saveConfig($event.target.value)")
</template>

<script lang="ts" setup>
import { useGameStore } from '../../../stores/game';

const gameStore = useGameStore()


</script>

<style>
</style>
