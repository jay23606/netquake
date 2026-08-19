<template lang="pug">
.file-row
  InlineEdit.file-name-wrap(
    v-if="source === 'custom'"
    :modelValue="asset.fileName"
    @update:modelValue="emit('edit', $event)"
  )
  span.file-name(v-else) {{ asset.fileName }}
  span.file-size {{ formatFileSize(asset.fileSize ?? 0) }}
  .file-actions
    button.file-icon-btn(@click="onDownload" title="Download")
      font-awesome-icon(icon="fa-solid fa-download")
    button.file-icon-btn.danger(
      v-if="source === 'custom'"
      @click="emit('remove')"
      title="Remove"
    )
      font-awesome-icon(icon="fa-solid fa-xmark")
</template>

<script lang="ts" setup>
import InlineEdit from '../../../../../components/input/InlineEdit.vue'
import type { AssetMeta } from '../../../../../../../shared/types/Store'
import * as indexedDb from '../../../../../../../shared/indexeddb'
import { formatFileSize } from '../../../../../helpers/number'
import type { Source } from '../../../../../../../shared/types/Source'

const props = defineProps<{ source: Source; asset: AssetMeta }>()
const emit = defineEmits<{
  (e: 'edit', fileName: string): void
  (e: 'remove'): void
}>()

const onDownload = async () => {
  try {
    const assetData = await indexedDb.getAsset(props.asset.game, props.asset.fileName)
    if (assetData?.data) {
      const blob = new Blob([assetData.data])
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = props.asset.fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }
  } catch (err: any) {
    alert(`Failed to download ${props.asset.fileName}`)
  }
}
</script>

<style lang="scss" scoped>
@import '../../../../../scss/tokens';

.file-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 9px 16px 9px 46px;
  border-bottom: $border-subtle;
  font-family: 'JetBrains Mono', monospace;
  &:last-child { border-bottom: none; }
  &:hover { background: rgba(255, 255, 255, 0.02); }
}

.file-name-wrap {
  flex: 1;
  min-width: 0;

  :deep(.inline-text) {
    font-size: $font-xs;
    color: $palette-text;
    font-family: 'JetBrains Mono', monospace;
  }

  :deep(.inline-input) {
    font-size: $font-xs;
    font-family: 'JetBrains Mono', monospace;
  }
}

.file-name {
  font-size: $font-xs;
  color: $palette-text;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
  flex: 1;
  min-width: 0;
}

.file-size {
  font-size: $font-2xs;
  color: $palette-muted;
  flex-shrink: 0;
  min-width: 64px;
  text-align: right;
}

.file-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.file-icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: $font-xs;
  color: $palette-muted;
  padding: 3px 5px;
  transition: $transition-color;
  line-height: 1;
  &:hover        { color: $palette-bright; }
  &.danger:hover { color: $palette-red; }
}
</style>
