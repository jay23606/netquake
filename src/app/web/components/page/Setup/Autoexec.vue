<template lang="pug">
.config
  label.form-label Quake autoexec.cfg File
  p Store extra variables and commands in here. This will not be modified by the game.
  button.btn(@click="gameStore.loadRecommendedAutoexec") Load Recommended
  .config-editor
    textarea.form-input(placeholder="Textarea" rows="20" cols="80" :value="gameStore.autoexecFile" @blur="gameStore.saveAutoexec($event.target.value)")
</template>

<script lang="ts" setup>
import { useGameStore } from '../../../stores/game';

const gameStore = useGameStore()
</script>

<style>
</style>
