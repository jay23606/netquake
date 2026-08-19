<template lang="pug">
.packages-section
  .pkg-header-row
    span.section-label Installed packages
    .pkg-header-actions
      button.btn-ghost-sm(@click="showAddPackageDialog") + New Package

  .drop-zone(
    :class="{ active: model.dragOver }"
    @drop.prevent="handleDrop"
    @dragover.prevent="model.dragOver = true"
    @dragenter.prevent="model.dragOver = true"
    @dragleave.prevent="model.dragOver = false"
    @click="fileInput?.click()"
  )
    input.hidden-file-input(
      ref="fileInput"
      type="file"
      multiple
      accept=".zip,.pak,.bsp,.mdl,.spr,.wav,.cfg,.txt,.dat,.lit,.lmp,.tga,.map"
      @change="handleFileSelect"
    )
    template(v-if="model.importing")
      .drop-zone-progress
        span.import-label Importing…
        .import-track
          .import-fill.indeterminate
    template(v-else)
      span.drop-zone-text Drop a folder, zip, or files here to create a new package
      span.drop-zone-hint Or click to browse

  .pkg-list(ref="pkgListEl")
    Package(
      v-for="pkg in gameStore.packages"
      :key="pkg.packageId"
      :package="pkg"
      @remove="removePackage"
    )
    .pkg-empty(v-if="!model.loading && gameStore.packages.length === 0")
      | No custom packages yet.

  NewPackageDialog(
    v-if="model.showCreateDialog"
    @cancel="closeDialog"
    @create="createPackage($event)"
  )
</template>

<script lang="ts" setup>
import { reactive, ref, nextTick, onMounted } from 'vue'
import Package from './Package.vue'
import * as indexedDb from '../../../../../../../shared/indexeddb'
import type { PackageMetaSeed } from '../../../../../../../shared/types/Store'
import { useGameStore } from '../../../../../stores/game'
import { useMapsStore } from '../../../../../stores/maps'
import NewPackageDialog from './NewPackageDialog.vue'
import type { SourceId } from '../../../../../../../shared/types/Source'
import { useToast } from 'vue-toastification'

const gameStore = useGameStore()
const mapsStore = useMapsStore()
const toast = useToast()
const pkgListEl = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement>()

const model = reactive<{
  loading: boolean
  showCreateDialog: boolean
  importing: boolean
  dragOver: boolean
}>({
  loading: false,
  showCreateDialog: false,
  importing: false,
  dragOver: false,
})

const loadPackages = async () => {
  model.loading = true
  await gameStore.loadPackages()
  model.loading = false
}

const scrollToLast = () => nextTick(() => {
  const last = pkgListEl.value?.lastElementChild as HTMLElement | null
  last?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
})

const showAddPackageDialog = () => { model.showCreateDialog = true }
const closeDialog = () => { model.showCreateDialog = false }

const generateCustomSourceId = (): SourceId => `custom:${Math.random().toString(36).substring(2, 15)}`

const createPackage = async (newPackage: { name: string; gameDir: string }) => {
  if (!newPackage.name.trim()) return
  try {
    model.loading = true
    const seed: PackageMetaSeed = {
      sourceId: generateCustomSourceId(),
      name: newPackage.name.trim(),
      gameDir: newPackage.gameDir.trim() || 'id1',
      depends: null,
    }
    await indexedDb.savePackage(seed)
    closeDialog()
    await loadPackages()
    scrollToLast()
  } catch (err: any) {
    alert(`Failed to create package: ${err.message}`)
  } finally {
    model.loading = false
  }
}

const removePackage = async (packageId: number) => {
  await gameStore.removePackage(packageId)
}

const runImport = async (fn: () => Promise<unknown>) => {
  model.importing = true
  model.dragOver = false
  try {
    await fn()
    await loadPackages()
    scrollToLast()
  } catch (err: any) {
    toast.warning(`Import failed: ${err.message}`)
  } finally {
    model.importing = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

// ── Folder reading ────────────────────────────────────────────────────────────

type FileEntry = { path: string; file: File }

const readAllEntries = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> =>
  new Promise((res, rej) => reader.readEntries(async entries => {
    if (!entries.length) { res([]); return }
    const rest = await readAllEntries(reader)
    res([...entries, ...rest])
  }, rej))

const readEntry = async (entry: FileSystemEntry, prefix = ''): Promise<FileEntry[]> => {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name
  if (entry.isFile) {
    const file = await new Promise<File>(res => (entry as FileSystemFileEntry).file(res))
    return [{ path, file }]
  }
  const children = await readAllEntries((entry as FileSystemDirectoryEntry).createReader())
  return (await Promise.all(children.map(c => readEntry(c, path)))).flat()
}

const readFolderContents = async (dir: FileSystemDirectoryEntry): Promise<FileEntry[]> => {
  const children = await readAllEntries(dir.createReader())
  return (await Promise.all(children.map(c => readEntry(c)))).flat()
}

// ── Drop / file select handlers ───────────────────────────────────────────────

const handleDrop = async (e: DragEvent) => {
  model.dragOver = false

  // Capture synchronously before any await (DataTransfer is nulled after event)
  const items = Array.from(e.dataTransfer?.items ?? [])
  const rawFiles = Array.from(e.dataTransfer?.files ?? [])
  const entries = items.map(i => i.webkitGetAsEntry()).filter(Boolean) as FileSystemEntry[]

  // Single folder
  const folderEntry = entries.find(en => en.isDirectory) as FileSystemDirectoryEntry | undefined
  if (folderEntry) {
    const files = await readFolderContents(folderEntry)
    if (files.length) runImport(() => mapsStore.importFiles(folderEntry.name, files, folderEntry.name))
    return
  }

  // Single zip
  if (rawFiles.length === 1 && rawFiles[0].name.toLowerCase().endsWith('.zip')) {
    runImport(() => mapsStore.importZipFile(rawFiles[0]))
    return
  }

  // Loose files
  const fileEntries = entries.filter(en => en.isFile) as FileSystemFileEntry[]
  if (!fileEntries.length) return
  const files = await Promise.all(
    fileEntries.map(en => new Promise<FileEntry>(res => en.file(f => res({ path: en.name, file: f }))))
  )
  const name = files[0].file.name.replace(/\.[^.]+$/, '') || 'Imported Files'
  runImport(() => mapsStore.importFiles(name, files))
}

const handleFileSelect = async (e: Event) => {
  const selected = Array.from((e.target as HTMLInputElement).files ?? [])
  if (!selected.length) return

  if (selected.length === 1 && selected[0].name.toLowerCase().endsWith('.zip')) {
    runImport(() => mapsStore.importZipFile(selected[0]))
    return
  }

  const files: FileEntry[] = selected.map(f => ({ path: f.name, file: f }))
  const name = files[0].file.name.replace(/\.[^.]+$/, '') || 'Imported Files'
  runImport(() => mapsStore.importFiles(name, files))
}

onMounted(loadPackages)
</script>

<style lang="scss" scoped>
@import '../../../../../scss/tokens';

.section-label {
  font-size: $font-2xs;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: $tracking-caps;
  color: $palette-muted;
}

.pkg-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.pkg-header-actions { display: flex; gap: 8px; }

.hidden-file-input { display: none; }

/* ── Drop zone ── */
.drop-zone {
  border: 1px dashed $palette-border;
  padding: 18px 20px;
  margin-bottom: 16px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;

  &:hover, &.active {
    border-color: $palette-muted;
    background: rgba(255, 255, 255, 0.02);
  }

  &.active { border-color: $palette-red; }
}

.drop-zone-text {
  font-size: $font-sm;
  color: $palette-muted;
}

.drop-zone-hint {
  font-size: $font-2xs;
  color: $palette-border;
}

.drop-zone-progress {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
}

.import-label {
  font-size: $font-2xs;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: $tracking-caps;
  color: $palette-muted;
  white-space: nowrap;
}

.import-track {
  flex: 1;
  height: 2px;
  background: $palette-border;
  overflow: hidden;
}

.import-fill {
  height: 100%;
  background: $palette-red;
  &.indeterminate {
    width: 40%;
    animation: import-slide 1.2s ease-in-out infinite;
  }
}

@keyframes import-slide {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
}

.btn-ghost-sm {
  font-family: inherit;
  font-size: $font-xs;
  font-weight: $fw-bold;
  letter-spacing: $tracking-links;
  text-transform: uppercase;
  padding: 7px 16px;
  background: transparent;
  border: $border-subtle;
  color: $palette-muted;
  cursor: pointer;
  transition: all 0.15s;
  &:hover { color: $palette-bright; border-color: $palette-text; }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
}

.pkg-list { margin-bottom: 24px; }

.pkg-empty {
  font-size: $font-sm;
  color: $palette-muted;
  padding: 16px 0;
}
</style>
