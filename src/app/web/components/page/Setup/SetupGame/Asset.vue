<template lang="pug">
.asset {{props.label}}
  template(v-if="props.assetMeta !== null")
    .asset-loaded.grid.grid-cols-12.gap-2
      .col-span-5.asset-loaded {{props.assetMeta.fileName}}
      .col-span-5.asset-fileCount {{props.assetMeta.fileCount}} Files
      .col-span-2.asset-remove
        button.btn.btn-action.btn-sm(@click="remove" style="color: red")
          font-awesome-icon(icon="fa-solid fa-xmark")</template>

<script lang="ts" setup>
import {reactive} from 'vue'
import type { AssetMeta } from '../../../../../../shared/types/Store';
import { useGameStore } from '../../../../stores/game';

const props = withDefaults(
  defineProps<{
    label: string,
    game: string,
    assetMeta: AssetMeta,
  }>()
  , {
    label: ''
  })
const model = reactive<{
  loadError: string,
  loading: boolean
}>({
  loadError: '',
  loading: false
})

const gameStore = useGameStore()
const remove = () => gameStore.removeAsset(props.assetMeta.assetId)
</script>
<style>
.asset {
  width: 10rem;
}
.asset-remove i {
  cursor: pointer;
}
.asset-fileCount {
}
.loader-file-input {
  display:none;
}
.asset-loader label {
  cursor: pointer;
}
</style>