<template lang="pug">
.name-maker
  input.nm-input-hidden(ref="input" :value="value" @input="emit('input', $event.target.value)" @keydown="inputKeyDown")
  .nm-toolbar
    .nm-toolbar-left
      button.nm-btn(@click.stop="space") Space
      button.nm-btn(@click.stop="backspace") ← Backspace
    button.nm-btn.nm-btn-done(@click.stop="done") Done
  canvas.nm-canvas(ref="canvas" :height="model.charsetSize" :width="model.charsetSize" @mousemove="canvashover" @click.stop="canvasclick")
</template>

<script lang="ts" setup>
import {reactive, ref, nextTick, watch, onMounted} from 'vue'

const emit = defineEmits<{
  (e: 'input', newName: string): void,
  (e: 'done'): void 
}>()

const blockedChars = [0, 9, 10, 12, 13, 173]

const canvas = ref<HTMLCanvasElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const props = withDefaults(defineProps<{
  maxLength: number,
  value: string
}>(), {
  value: '',
  maxLength: 0
})
const model = reactive<{
  image: CanvasImageSource | null,
  charsetSize: number,
  hoverPosition: {x: number, y: number} 
}>({
  image: null,
  charsetSize: 400,
  hoverPosition: {x: -1, y: -1}
})

const insertCharacter = (char: string) => {
  if (!input.value) return
  const selectionStart = input.value.selectionStart!
  const selectionEnd = input.value.selectionEnd!
  const newName = props.value.slice(0, selectionStart) + char + props.value.slice(selectionEnd);
  
  if (newName.length <= props.maxLength) {
    change(newName)
    nextTick(() => {
      input.value!.focus()
      input.value!.selectionEnd = selectionStart + char.length
    })
  }
}

const change = (newName: string) => {
  if (props.value.length <= props.maxLength) {
    emit('input', newName)
  }
}

const space = () => {
  if (props.value.length <= props.maxLength) {
    insertCharacter(' ')
  }
}
const backspace = () => {
  if (!input.value) return
  if (props.value.length && input.value) {
    const selectionStart = input.value.selectionStart!
    const selectionEnd = input.value.selectionEnd!
    const newName = props.value.slice(0, selectionStart - 1) + props.value.slice(selectionEnd);
    
    change(newName)
    nextTick(() => {
      input.value!.focus()
      input.value!.selectionEnd = selectionStart - 1
    })
  }
}

const done = () => {
  if (!props.value) {
    emit('input', 'player')
  }
  // hack because for some reason the above doesn't trigger change if done is executed the same time.
  nextTick(() => emit('done'))
}

const inputKeyDown = (e: KeyboardEvent) => {
  const key = e.key
  if (key === "Escape") {
    emit('done')
    return
  }
  if (key === "Backspace" || key === "Delete" || key==="ArrowLeft" || key==="ArrowRight") {
    return
  }
  if (props.value.length > props.maxLength) {
    e.preventDefault()
    return false
  }
}

const getCharCode = (width: number, offsetX: number, offsetY: number) => {
  const blockSize = width / 16
  const x = Math.floor(offsetX / blockSize),
        y = Math.floor(offsetY / blockSize)
  return x + (y * 16)
}
const canvasclick = (e: MouseEvent) => {
  const canvas = e.target as HTMLCanvasElement
  const charCode = getCharCode(canvas.clientWidth, e.offsetX, e.offsetY)
  
  if (!blockedChars.includes(charCode)) {

    const char = String.fromCharCode(charCode);
    return insertCharacter(char)
  }
}
const canvashover = (e: MouseEvent) => {
  const canvas = e.target as HTMLCanvasElement
  model.hoverPosition = {x: e.offsetX, y: e.offsetY}
  if (canvas.getContext && model.image) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return

    const ratio = model.charsetSize / canvas.clientWidth
    const size = model.charsetSize / 16;
    const x = Math.floor((model.hoverPosition.x * ratio) / size) * size
    const y = Math.floor((model.hoverPosition.y * ratio) / size) * size
    const charCode = getCharCode(canvas.clientWidth, e.offsetX, e.offsetY)

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(model.image, 0, 0, model.charsetSize, model.charsetSize);
    
    canvas.style.cursor='default'
    if (!blockedChars.includes(charCode)) {
      canvas.style.cursor='pointer'
      ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
      ctx.fillRect(x, y, size, size); 
    }
  }
}

onMounted(() => {
  input.value?.focus()
  if (!canvas.value) return
  if (canvas.value.getContext) {
      const ctx = canvas.value.getContext('2d');

      //Loading of the home test image - img1
      var charset = new Image();

      //drawing of the test image - img1
      charset.onload = () => {
        if (!ctx) return
        //draw background image
        model.image = charset
        ctx.drawImage(model.image, 0, 0, model.charsetSize, model.charsetSize);
        //draw a box over the top
        // ctx.fillStyle = "rgba(200, 0, 0, 0.5)";
        // ctx.fillRect(0, 0, 500, 500);

      };

      charset.src = `${import.meta.env.BASE_URL}img/charset-6.png`;
  }
  
})
</script>

<style lang="scss" scoped>
@import '../../scss/tokens';

.name-maker {
  display: flex;
  flex-direction: column;
  width: 240px;
}

.nm-input-hidden {
  position: absolute;
  opacity: 0;
  pointer-events: none;
  width: 0;
  height: 0;
}

.nm-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border: $border-subtle;
  border-bottom: none;
  background: $palette-surface;
}

.nm-toolbar-left {
  display: flex;
}

.nm-btn {
  font-family: inherit;
  font-size: $font-2xs;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: $tracking-links;
  padding: 6px 10px;
  background: transparent;
  border: none;
  border-right: $border-subtle;
  color: $palette-muted;
  cursor: pointer;
  transition: $transition-color;
  &:hover { color: $palette-bright; }
}

.nm-btn-done {
  border-right: none;
  border-left: $border-subtle;
  color: $palette-text;
  &:hover { color: $palette-bright; }
}

.nm-canvas {
  width: 100%;
  height: auto;
  display: block;
  border: $border-subtle;
}
</style>