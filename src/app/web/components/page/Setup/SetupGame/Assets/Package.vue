<template lang="pug">
.pkg-row(
  :class="{ expanded: model.expanded, dragging: model.dragActive }"
  @drop.prevent.stop="source === 'custom' ? handleFileDrop($event) : undefined"
  @dragover.prevent.stop="source === 'custom' ? (model.dragActive = true) : undefined"
  @dragenter.prevent.stop="source === 'custom' ? (model.dragActive = true) : undefined"
  @dragleave.prevent.stop="model.dragActive = false"
)
  .pkg-row-head(@click="toggleExpand")
    font-awesome-icon.pkg-chevron(icon="fa-solid fa-chevron-right")
    InlineEdit.pkg-name(
      v-if="source === 'custom'"
      :modelValue="props.package.name"
      @update:modelValue="onRename"
      @click.stop
    )
    span.pkg-name(v-else) {{ props.package.name }}
    span.pkg-type(:class="source") {{ sourceLabel }}
    span.pkg-count(v-if="model.totalSize !== null") {{ formatFileSize(model.totalSize) }}
    .pkg-actions(@click.stop)
      input.hidden-file-input(
        v-if="source === 'custom'"
        ref="fileInput"
        type="file"
        multiple
        accept=".pak,.mdl,.bsp,.txt,.cfg,.dat,.spr,.lit,.map,.wav,.tga,.lmp"
        @change="handleFileSelect"
      )
      button.pkg-icon-btn.add(
        v-if="source === 'custom'"
        @click="onAddFile"
        title="Add file"
      ) + Add
      button.pkg-icon-btn.danger(@click="onRemovePackage" title="Delete")
        font-awesome-icon(icon="fa-solid fa-xmark")

  .pkg-files(v-if="model.expanded")
    PackageFile(
      v-for="asset in model.metaList"
      :key="asset.assetId"
      :source="source"
      :asset="asset"
      @remove="onRemoveAsset(asset)"
      @edit="onEditAsset(asset, $event)"
    )
</template>

<script lang="ts" setup>
import PackageFile from './PackageFile.vue'
import InlineEdit from '../../../../../components/input/InlineEdit.vue'
import { reactive, computed, watch, ref, onMounted } from 'vue'
import { formatFileSize } from '../../../../../helpers/number'
import { useGameStore } from '../../../../../stores/game'
import type { AssetMeta, PackageMeta } from '../../../../../../../shared/types/Store'
import * as indexedDb from '../../../../../../../shared/indexeddb'
import { useToast } from 'vue-toastification'

const props = defineProps<{ package: PackageMeta }>()
const emit = defineEmits<{ (e: 'remove', packageId: number): void }>()

const gameStore = useGameStore()
const toast = useToast()
const fileInput = ref<HTMLInputElement>()

const model = reactive<{
  expanded: boolean
  metaList: AssetMeta[]
  dragActive: boolean
  totalSize: number | null
}>({
  expanded: false,
  metaList: [],
  dragActive: false,
  totalSize: null,
})

const source = computed(() => props.package.sourceId.split(':')[0])

const sourceLabel = computed(() => {
  switch (source.value) {
    case 'quaddicted': return 'Quaddicted'
    case 'slipseer':   return 'Slipseer'
    case 'official':   return 'Official'
    default:           return 'Custom'
  }
})

const toggleExpand = () => { model.expanded = !model.expanded }

onMounted(async () => {
  const meta = await indexedDb.getAllMetaPerPackageId(props.package.packageId)
  model.totalSize = meta.reduce((sum, a) => sum + (a.fileSize ?? 0), 0)
})

watch(() => model.expanded, async (expanded) => {
  if (expanded) await loadAssetList()
})

const loadAssetList = async () => {
  model.metaList = await indexedDb.getAllMetaPerPackageId(props.package.packageId)
  model.totalSize = model.metaList.reduce((sum, a) => sum + (a.fileSize ?? 0), 0)
}

const onRemovePackage = async () => {
  if (!confirm(`Delete package "${props.package.name}"?`)) return
  emit('remove', props.package.packageId)
}

const onRemoveAsset = async (asset: AssetMeta) => {
  if (!confirm(`Remove "${asset.fileName}"?`)) return
  try {
    await indexedDb.removeAsset(asset.assetId.toString())
    await loadAssetList()
    await gameStore.loadAssets()
  } catch (err: any) {
    toast.warning(`Failed to delete ${asset.fileName}`)
  }
}

const onEditAsset = async (asset: AssetMeta, fileName: string) => {
  const exists = model.metaList.find(a =>
    a.assetId !== asset.assetId && a.fileName.toLowerCase() === fileName.toLowerCase()
  )
  if (exists) {
    toast.warning(`"${fileName}" already exists in this package`)
    return
  }
  try {
    await indexedDb.updateAssetFileName(asset.assetId, fileName)
    await loadAssetList()
    await gameStore.loadAssets()
  } catch (err: any) {
    toast.warning(`Failed to rename ${asset.fileName}`)
  }
}

const onRename = async (name: string) => {
  try {
    await indexedDb.updatePackageName(props.package.packageId, name)
    await gameStore.loadPackages()
  } catch (err: any) {
    toast.warning(`Failed to rename package: ${err.message}`)
  }
}

const onAddFile = () => { fileInput.value?.click() }

const handleFileSelect = (e: Event) => {
  const target = e.target as HTMLInputElement
  if (target.files?.length) uploadFiles(Array.from(target.files))
}

const handleFileDrop = (e: DragEvent) => {
  e.stopPropagation()
  model.dragActive = false
  const items = e.dataTransfer?.items
  const files: File[] = items
    ? Array.from(items).filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean) as File[]
    : Array.from(e.dataTransfer?.files || [])
  if (files.length) uploadFiles(files)
}

const fixFileName = (fileName: string): string => {
  const ext = fileName.toLowerCase().split('.').pop()
  switch (ext) {
    case 'mdl': case 'spr': return `progs/${fileName}`
    case 'bsp': case 'map': case 'lit': return `maps/${fileName}`
    case 'wav': return `sound/${fileName}`
    case 'tga': case 'lmp': return `gfx/${fileName}`
    default: return fileName
  }
}

const uploadFiles = async (files: File[]) => {
  try {
    for (const file of files) {
      const buf = await file.arrayBuffer()
      const name = fixFileName(file.name)
      await indexedDb.saveAsset(props.package.gameDir, name, file.size, buf, props.package.packageId)
    }
    await loadAssetList()
    await gameStore.loadAssets()
  } catch (err: any) {
    toast.warning(`Failed to add files: ${err.message}`)
  }
}
</script>

<style lang="scss" scoped>
@import '../../../../../scss/tokens';

.pkg-row {
  border: $border-subtle;
  border-bottom: none;
  &:last-child { border-bottom: $border-subtle; }
  &.dragging { outline: 2px dashed $palette-border; background: rgba(255, 255, 255, 0.02); }
}

.pkg-row-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 16px;
  cursor: pointer;
  transition: $transition-bg;
  user-select: none;
  &:hover { background: $palette-surface; }
}

.expanded .pkg-row-head {
  background: $palette-surface;
  border-bottom: $border-subtle;
}

.pkg-chevron {
  font-size: 10px;
  color: $palette-muted;
  flex-shrink: 0;
  width: 14px;
  transition: transform 0.2s;
}

.expanded .pkg-chevron { transform: rotate(90deg); }

.pkg-name {
  font-size: 14px;
  font-weight: $fw-bold;
  color: $palette-bright;
  flex: 1;
  font-family: 'JetBrains Mono', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.pkg-type {
  font-size: $font-2xs;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: $tracking-links;
  padding: 2px 8px;
  flex-shrink: 0;
  &.quaddicted { background: rgba(96, 160, 224, 0.12); color: #60a0e0; }
  &.slipseer   { background: rgba(92, 200, 138, 0.12); color: #5cc88a; }
  &.official   { background: rgba(160, 130, 224, 0.12); color: #a082e0; }
  &.custom      { background: rgba(240, 184, 0, 0.12);  color: $palette-yellow; }
}

.pkg-count {
  font-size: $font-xs;
  color: $palette-muted;
  font-family: 'JetBrains Mono', monospace;
  flex-shrink: 0;
  min-width: 56px;
  text-align: right;
}

.pkg-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

.pkg-icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: $font-sm;
  color: $palette-muted;
  padding: 4px 6px;
  transition: $transition-color;
  line-height: 1;
  font-family: inherit;
  font-weight: $fw-bold;
  letter-spacing: $tracking-links;
  &:hover        { color: $palette-bright; }
  &.danger:hover { color: $palette-red; }
  &.add:hover    { color: $palette-yellow; }
}

.hidden-file-input { display: none; }

.pkg-files { background: $palette-body; }
</style>
