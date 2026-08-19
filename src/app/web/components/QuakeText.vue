<template lang="pug">
.name-label
  img(:src="model.valueImg")
</template>

<script lang="ts" setup>
import {reactive, watch} from 'vue'
import { createWriter } from "../helpers/charmap"

const props = withDefaults(defineProps<{
  size: number,
  value: string
}>(), {
  size: 12,
  value: ''
})
const model = reactive<{valueImg: string}>({valueImg: ''})

const generateImage = () => {
  return createWriter() 
    .then(writer => writer.write(props.size, btoa(props.value)))
    .then(nameImg => {
      model.valueImg = nameImg
    })
}
watch(props, () => {
  generateImage()
}, {immediate: true})


</script>

<style>

</style>
