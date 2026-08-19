<template lang="pug">
.modal-overlay(@click.self="emit('cancel')")
  .modal-container
    .modal-header
      span.modal-title Create Game Room
      button.modal-close(@click="emit('cancel')" aria-label="Close")
        font-awesome-icon(icon="fa-solid fa-xmark")

    form(@submit.prevent="okClick")
      .modal-body
        .field
          label.field-label Room Name
          input.field-input(
            v-model="model.roomName"
            maxlength="20"
            minlength="1"
            required
            autofocus
            placeholder="My Quake Room"
          )

        .field
          label.field-label Visibility
          select.field-select(v-model="model.visibility")
            option(value="public") Public — anyone can join
            option(value="private") Invite Only

      .modal-footer
        button.btn-ghost-sm(type="button" @click="emit('cancel')") Cancel
        button.btn-save(type="submit" :disabled="!model.roomName.trim()") Create Room
</template>

<script lang="ts">
export type CreationParams = {
  roomName: string
  visibility: 'single' | 'private' | 'public'
}
</script>

<script setup lang="ts">
import { reactive, onMounted } from 'vue'
import { quakeTextToPlain } from '../../../util/quakeText'

const props = defineProps<{ playerName: string }>()
const emit = defineEmits<{
  (e: 'ok', params: CreationParams): void
  (e: 'cancel'): void
}>()

const model = reactive<CreationParams>({
  roomName: quakeTextToPlain(props.playerName) + "'s Room",
  visibility: 'public',
})

const okClick = () => {
  if (!model.roomName.trim()) return
  emit('ok', model)
}

onMounted(() => {
  const handler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') emit('cancel')
  }
  document.addEventListener('keydown', handler)
})
</script>

<style lang="scss" scoped>
@import '../../../scss/tokens';

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

.field {
  margin-bottom: 16px;
  &:last-child { margin-bottom: 0; }
}

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
  font-family: inherit;
  font-size: $font-sm;
  padding: 8px 12px;
  outline: none;
  &:focus { border-color: $palette-muted; }
  &::placeholder { color: $palette-muted; }
}

.field-select {
  width: 100%;
  background: $palette-body;
  border: $border-subtle;
  color: $palette-text;
  font-family: inherit;
  font-size: $font-sm;
  padding: 8px 12px;
  outline: none;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23666' d='M6 8L0 0h12z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 32px;
  &:focus { border-color: $palette-muted; }
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
