<template lang="pug">
.modal-overlay(@click.self="emit('cancel')")
  .modal-container
    .modal-header
      span.modal-title Create Package
      button.modal-close(@click="emit('cancel')")
        font-awesome-icon(icon="fa-solid fa-xmark")
    .modal-body
      .field
        label.field-label Package Name
        input.field-input(
          v-model="model.name"
          placeholder="e.g. my_maps"
          @keyup.enter="model.name.trim() && emit('create', { ...model })"
          autofocus
        )
      .field
        label.field-label Game Directory
        input.field-input(v-model="model.gameDir" placeholder="id1")
        p.field-hint Assets will be mounted under this directory
    .modal-footer
      button.btn-ghost-sm(@click="emit('cancel')") Cancel
      button.btn-save(:disabled="!model.name.trim()" @click="emit('create', { ...model })") Create Package
</template>

<script lang="ts" setup>
import { reactive } from 'vue'

const randomGameDir = () => 'pkg' + Math.random().toString(36).substring(2, 9)
const model = reactive<{ name: string; gameDir: string }>({ name: '', gameDir: randomGameDir() })
const emit = defineEmits<{
  (e: 'cancel'): void
  (e: 'create', pkg: { name: string; gameDir: string }): void
}>()
</script>

<style lang="scss" scoped>
@import '../../../../../scss/tokens';

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}

.modal-container {
  background: $palette-surface;
  border: $border-subtle;
  width: 100%;
  max-width: 400px;
  margin: 0 16px;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: $border-subtle;
}

.modal-title {
  font-size: $font-base;
  font-weight: $fw-bold;
  color: $palette-bright;
}

.modal-close {
  background: none;
  border: none;
  cursor: pointer;
  color: $palette-muted;
  font-size: $font-base;
  padding: 4px;
  transition: $transition-color;
  &:hover { color: $palette-bright; }
}

.modal-body { padding: 20px; }

.field { margin-bottom: 16px; &:last-child { margin-bottom: 0; } }

.field-label {
  display: block;
  font-size: $font-xs;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: $tracking-labels;
  color: $palette-muted;
  margin-bottom: 6px;
}

.field-input {
  width: 100%;
  background: $palette-body;
  border: $border-subtle;
  color: $palette-text;
  font-family: 'JetBrains Mono', monospace;
  font-size: $font-sm;
  padding: 8px 12px;
  outline: none;
  &:focus { border-color: $palette-muted; }
}

.field-hint {
  font-size: $font-2xs;
  color: $palette-muted;
  margin-top: 6px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 16px 20px;
  border-top: $border-subtle;
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
}

.btn-save {
  font-family: inherit;
  font-size: $font-xs;
  font-weight: $fw-bold;
  letter-spacing: $tracking-links;
  text-transform: uppercase;
  padding: 7px 16px;
  background: $palette-red;
  color: $palette-bright;
  border: none;
  cursor: pointer;
  transition: $transition-bg;
  &:hover:not(:disabled) { background: lighten($palette-red, 6%); }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
}
</style>
