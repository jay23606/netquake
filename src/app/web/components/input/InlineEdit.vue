<template lang="pug">
.inline-edit(:class="{ editing: model.editing }")
  template(v-if="model.editing")
    input.inline-input(
      ref="inputEl"
      v-model="model.draft"
      @keyup.enter="commit"
      @keyup.escape="cancel"
      @blur="commit"
    )
    button.inline-btn.cancel(type="button" @mousedown.prevent @click="cancel")
      font-awesome-icon(icon="fa-solid fa-xmark")
  template(v-else)
    span.inline-text(@click="start") {{ modelValue }}
    button.inline-btn.edit(type="button" @click="start" tabindex="-1")
      font-awesome-icon(icon="fa-solid fa-pen")
</template>

<script lang="ts" setup>
import { reactive, ref, nextTick } from 'vue'

const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>()

const inputEl = ref<HTMLInputElement>()
const model = reactive({ editing: false, draft: '' })

const start = () => {
  model.draft = props.modelValue
  model.editing = true
  nextTick(() => { inputEl.value?.select() })
}

const commit = () => {
  if (!model.editing) return
  model.editing = false
  const trimmed = model.draft.trim()
  if (trimmed && trimmed !== props.modelValue) emit('update:modelValue', trimmed)
}

const cancel = () => {
  model.editing = false
}
</script>

<style lang="scss" scoped>
@import '../../scss/tokens';

.inline-edit {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.inline-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: text;
  min-width: 0;
}

.inline-btn {
  background: none;
  border: none;
  padding: 2px 4px;
  cursor: pointer;
  line-height: 1;
  flex-shrink: 0;
  font-size: 11px;
  transition: $transition-color;

  &.edit {
    color: $palette-muted;
    opacity: 0;
    .inline-edit:hover & { opacity: 1; }
  }

  &.cancel {
    color: $palette-muted;
    &:hover { color: $palette-bright; }
  }
}

.inline-input {
  flex: 1;
  min-width: 0;
  background: $palette-body;
  border: 1px solid $palette-muted;
  color: inherit;
  font: inherit;
  padding: 1px 6px;
  outline: none;
}
</style>
