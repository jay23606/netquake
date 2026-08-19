<template lang="pug">
.quake-text-input(v-on-click-outside="commitAndClose" @click="edit" )
  QuakeText(:value="displayValue" :size="14")
  .edit-box(v-if="model.editing")
    NameMakerVue(
      :maxLength="props.maxLength"
      :value="model.draft"
      @done="commitAndClose"
      @input="onInput")
</template>

<script setup lang="ts">
import { vOnClickOutside } from '@vueuse/components'
import QuakeText from '../QuakeText.vue';
import NameMakerVue from './NameMaker.vue';
import {reactive, computed} from 'vue'

const props = withDefaults(defineProps<{
  modelValue: string,
  maxLength: number
}>(), {modelValue: '', maxLength: 0})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const model = reactive({
  editing: false,
  draft: ''
})

const onInput = (newName: string) => {
  model.draft = newName
}

const displayValue = computed(() => model.editing ? model.draft : props.modelValue)

const edit = () => {
  if (model.editing) return
  model.draft = props.modelValue
  model.editing = true
}

const commitAndClose = () => {
  if (!model.editing) return
  model.editing = false
  emit('update:modelValue', model.draft)
}
</script>
<style lang="scss">
@import '../../scss/tokens';

.quake-text-input {
  position: relative;
  display: flex;
  cursor: pointer;
  background: $palette-body;
  border: $border-subtle;
  padding: 6px 8px;
  min-height: 34px;
  align-items: center;
  transition: border-color 0.15s;
  &:hover { border-color: $palette-muted; }
}

.edit-box {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  z-index: 100;
  background: $palette-surface;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
}
</style>