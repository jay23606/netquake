<template lang="pug">
.pak-upload
  .upload-zone(
    :class="{ active: model.active, border: showBorder }"
    @drop.prevent="handleFileDrop" 
    @dragover.prevent="model.active = true"
    @dragenter.prevent="model.active = true" 
    @dragleave.prevent="model.active = false")
    input.loader-file-input(:id="props.inputId" type="file" multiple name="files[]" accept=".pak" @change="handleFileSelect")
    slot
      .text Drop pak files here&nbsp;
        label.browse(:for="props.inputId")
          | or browse
          font-awesome-icon(icon="fa-solid fa-upload")
</template>

<script lang="ts" setup>
import {reactive} from 'vue'

const emit = defineEmits<{
  (e: 'uploadFiles', files: File[]): void}
>()
const props = withDefaults(defineProps<{
  inputId?: string
  showBorder?: boolean
}>(), {
  inputId: 'pak-file-browse',
  showBorder: true
})
const model = reactive<{loading: boolean, active: boolean}>({loading: false, active: false})

const handleFileDrop = (e: DragEvent) => {
  e.stopPropagation();

  if (e.dataTransfer && e.dataTransfer.items) {
    var files = Array.from(e.dataTransfer.items)
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter(file => !!file)
      
    if (!files.length) {
      return
    }
    emit('uploadFiles', files as File[])
  } else {
    if (!e.dataTransfer || e.dataTransfer.files.length) {
      return
    }
    emit('uploadFiles', Array.from(e.dataTransfer.files))
  }
}

const handleFileSelect = (e: Event) => {
  const target = e.target as HTMLInputElement
  if (!target?.files?.length) {
    return
  }
  emit('uploadFiles', Array.from(target.files))
}
</script>

<style lang="scss" scoped>
.loader-file-input { display: none; }

.upload-zone {
  &.border {
    padding: 2rem;
    border:  2px grey dashed;
    &.active {
      border:  2px lighten(grey, 10%) dashed;
    }
  }
  .text {
    font-size: 1.5rem;
    display:flex;
    justify-content: center;
  }
  .browse {
    cursor: pointer;
    color: #8f4e28;
  }
}
</style>