<template lang="pug">
.input-field
  label.label {{label}}
  input(:value="value_internal" @change="onchange")
</template>

<script lang="ts" setup>
import {reactive} from 'vue'

const emit = defineEmits<{
  (e: 'input', files: File[]): void}
>()

const props = withDefaults(defineProps<{label: string, value: string}>(), {value: ''})
const model = reactive<{value_internal: string}>({value_internal: props.value})
</script>

<style>

</style>
