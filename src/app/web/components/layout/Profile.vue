<template lang="pug">
div.profile
  button.profile-btn(
    @click="editProfileOpen = true"
    v-tippy="{allowHTML: true}"
    :content="nameTooltip"
    aria-label="Edit profile"
  )
    font-awesome-icon(icon="fa-solid fa-user")
  EditProfie(
    v-if="editProfileOpen"
    @cancel="editProfileOpen = false")
</template>

<script lang="ts" setup>
import { ref, watch } from 'vue'
import { usePlayerStore } from '../../stores/player'
import EditProfie from '../EditProfile.vue'
import { createWriter } from '../../helpers/charmap'

const playerStore = usePlayerStore()
const editProfileOpen = ref(false)
const nameTooltip = ref('')

watch(() => playerStore.playerName, (name) => {
  createWriter()
    .then(writer => writer.write(14, btoa(name)))
    .then(img => { nameTooltip.value = `<img src="${img}" style="display:block;">` })
}, { immediate: true })
</script>

<style scoped lang="scss">
@import '../../scss/tokens';

.profile-btn {
  background: none;
  border: none;
  cursor: pointer;
  color: $palette-muted;
  font-size: 15px;
  padding: 4px 6px;
  line-height: 1;
  transition: $transition-color;

  &:hover { color: $palette-bright; }
}
</style>