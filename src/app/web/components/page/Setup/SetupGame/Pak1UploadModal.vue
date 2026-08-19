<template lang="pug">
Teleport(to="body")
  .modal-backdrop(v-if="open" @click.self="close")
    .upmodal
      .upmodal-header
        .upmodal-title Unlock the Full Game
        button.upmodal-close(@click="close") ✕
      .upmodal-body
        .step
          .step-num 1
          .step-content
            .step-title Find your Quake folder
            .step-platforms
              .step-platform
                span.plat-label Steam
                span.plat-desc Right-click Quake in your library → Manage → Browse local files
              .step-platform
                span.plat-label GOG
                span.plat-desc Open GOG Galaxy → Quake → More → Manage installation → Show folder
              .step-platform
                span.plat-label Other
                span.plat-desc Navigate to wherever you installed Quake

        .step
          .step-num 2
          .step-content
            .step-title Open the&nbsp;
              code id1
              |  folder
            .step-desc You'll find&nbsp;
              code pak0.pak
              |  and&nbsp;
              code pak1.pak
              |  inside.

        .step
          .step-num 3
          .step-content
            .step-title Drop&nbsp;
              code pak1.pak
              |  below
            .step-desc Your file stays in your browser — it is never uploaded to any server.

        .drop-zone(
          :class="{ 'drop-zone--active': dragging, 'drop-zone--loading': loading }"
          @drop.prevent="onDrop"
          @dragover.prevent="dragging = true"
          @dragenter.prevent="dragging = true"
          @dragleave.prevent="dragging = false"
        )
          input.file-input(ref="fileInput" type="file" accept=".pak" @change="onFileSelect")
          template(v-if="!loading")
            .drop-icon ↑
            .drop-text
              | Drop&nbsp;
              code pak1.pak
              |  here, or&nbsp;
              span.browse-link(@click="fileInput?.click()") browse files
          template(v-else)
            .drop-loading Processing…

        .upmodal-error(v-if="errorMsg") {{ errorMsg }}
</template>

<script lang="ts" setup>
import { ref } from 'vue'
import { useGameStore } from '../../../../stores/game'
import { isId1Pak1, readPackFile } from '../../../../helpers/assetChecker'
import { useToast } from 'vue-toastification'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const gameStore = useGameStore()
const toast = useToast()
const fileInput = ref<HTMLInputElement>()
const dragging = ref(false)
const loading = ref(false)
const errorMsg = ref('')

const close = () => emit('close')

const readFile = (file: File): Promise<{ fileName: string; data: ArrayBuffer }> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = e => resolve({ fileName: file.name, data: e.target!.result as ArrayBuffer })
    // Error, not the raw ProgressEvent (which reports as {"isTrusted":true}); reader.error has the cause.
    reader.onerror = () => reject(new Error(`failed to read ${file.name}: ${reader.error?.message || 'FileReader error'}`))
    reader.readAsArrayBuffer(file)
  })

const processFile = async (file: File) => {
  errorMsg.value = ''
  if (file.name.toLowerCase() !== 'pak1.pak') {
    errorMsg.value = 'Please select pak1.pak (not ' + file.name + ')'
    return
  }
  loading.value = true
  try {
    const { fileName, data } = await readFile(file)
    const packFiles = readPackFile(data)
    if (packFiles.length === 0) throw new Error('Not a valid Quake pak file')
    if (!isId1Pak1(packFiles, data)) throw new Error('This is not the original registered Quake pak1.pak')
    await gameStore.saveAsset({ game: 'id1', fileName, fileCount: packFiles.length, data })
    toast.success('pak1.pak loaded — all episodes unlocked!')
    close()
  } catch (err: any) {
    errorMsg.value = err.message
  } finally {
    loading.value = false
    dragging.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

const onDrop = (e: DragEvent) => {
  dragging.value = false
  const file = Array.from(e.dataTransfer?.files ?? []).find(f => f.name.toLowerCase().endsWith('.pak'))
  if (file) processFile(file)
  else errorMsg.value = 'No .pak file detected in drop'
}

const onFileSelect = (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (file) processFile(file)
}
</script>

<style lang="scss" scoped>
@import '../../../../scss/tokens';

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.upmodal {
  background: $palette-surface;
  border: $border-subtle;
  width: 100%;
  max-width: 560px;
  max-height: 90vh;
  overflow-y: auto;
}

.upmodal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: $border-subtle;
}

.upmodal-title {
  font-size: 16px;
  font-weight: $fw-extrabold;
  color: $palette-bright;
  letter-spacing: -0.01em;
}

.upmodal-close {
  background: none;
  border: none;
  color: $palette-muted;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 2px 6px;
  transition: $transition-color;
  &:hover { color: $palette-bright; }
}

.upmodal-body {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.step {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.step-num {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: $palette-red;
  color: #fff;
  font-size: 12px;
  font-weight: $fw-extrabold;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 1px;
}

.step-content {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.step-title {
  font-size: $font-sm;
  font-weight: $fw-semibold;
  color: $palette-bright;
  code { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: $palette-bright; }
}

.step-desc {
  font-size: $font-sm;
  color: $palette-muted;
  line-height: 1.5;
  code { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: $palette-text; }
}

.step-platforms {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.step-platform {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: $font-sm;
}

.plat-label {
  font-size: $font-2xs;
  font-weight: $fw-extrabold;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: $palette-yellow;
  flex-shrink: 0;
  width: 40px;
}

.plat-desc {
  color: $palette-muted;
  line-height: 1.4;
}

.drop-zone {
  border: 1px dashed $palette-border;
  padding: 32px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
  transition: border-color 0.15s, background 0.15s;
  cursor: default;

  &--active {
    border-color: $palette-red;
    background: rgba($palette-red, 0.04);
  }

  &--loading {
    opacity: 0.6;
    pointer-events: none;
  }
}

.file-input { display: none; }

.drop-icon {
  font-size: 28px;
  color: $palette-muted;
  line-height: 1;
}

.drop-text {
  font-size: $font-sm;
  color: $palette-muted;
  code { color: $palette-bright; font-family: 'JetBrains Mono', monospace; font-size: 12px; }
}

.browse-link {
  color: $palette-yellow;
  cursor: pointer;
  font-weight: $fw-semibold;
  text-decoration: underline;
  text-underline-offset: 2px;
  &:hover { color: lighten($palette-yellow, 10%); }
}

.drop-loading {
  font-size: $font-sm;
  color: $palette-muted;
}

.upmodal-error {
  font-size: $font-xs;
  color: $palette-red;
  padding: 10px 14px;
  background: rgba($palette-red, 0.08);
  border: 1px solid rgba($palette-red, 0.25);
}
</style>
