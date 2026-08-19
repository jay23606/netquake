<template lang="pug">
.chat-box
  .chat-messages(ref="chatMessagesRef" @scroll="handleScroll")
    .chat-row(v-for="(message, index) in props.chat.messages" :key="index")
      span.chat-time {{ shouldShowTime(index) ? formatTime(message.timestamp) : '' }}
      EventMessage(
        v-if="message.content.tag === 'event'"
        :type="message.content.type"
        :player="chat.players[message.playerId]"
      )
      TextMessage(
        v-if="message.content.tag === 'text'"
        :message="message.content.message"
        :player="chat.players[message.playerId]"
      )

  .chat-input-wrap
    input.chat-input(
      type="text"
      v-model="model.newMessage"
      placeholder="Say something…"
      @keydown.enter="onSend"
    )
    button.chat-send(type="button" @click="onSend") Send
</template>

<script lang="ts" setup>
import EventMessage from './EventMessage.vue'
import TextMessage from './TextMessage.vue'
import { nextTick, onMounted, reactive, ref, watch } from 'vue'
import type { ChatMessages } from '../../../../../types/Room'

const props = defineProps<{ chat: ChatMessages }>()
const emit = defineEmits<{ (event: 'send', content: string): void }>()

const DEDUP_MS = 2 * 60 * 1000 // 2 minutes

const shouldShowTime = (index: number): boolean => {
  if (index === 0) return true
  const msg = props.chat.messages[index]
  const prev = props.chat.messages[index - 1]
  // Different player or different message type → show
  if (prev.playerId !== msg.playerId) return true
  if (prev.content.tag !== msg.content.tag) return true
  // Same player, same type, but >2 min gap → show
  return (msg.timestamp - prev.timestamp) > DEDUP_MS
}

const formatTime = (ts: number) => {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const model = reactive({ newMessage: '', isScrolledAtBottom: true, autoScrolling: false })
const chatMessagesRef = ref<HTMLElement | null>(null)

watch(
  () => props.chat?.messages?.length,
  () => {
    if (model.isScrolledAtBottom) {
      model.autoScrolling = true
      nextTick(() => {
        const el = chatMessagesRef.value
        if (el) {
          el.scrollTop = el.scrollHeight
        }
        model.autoScrolling = false
      })
    }
  }
)

const handleScroll = () => {
  if (model.autoScrolling) return
  const el = chatMessagesRef.value
  if (el) model.isScrolledAtBottom = el.scrollTop + el.offsetHeight >= el.scrollHeight - 4
}

const onSend = () => {
  if (!model.newMessage.trim()) return
  emit('send', model.newMessage)
  model.newMessage = ''
}

onMounted(() => {
  chatMessagesRef.value?.scrollTo({ top: chatMessagesRef.value.scrollHeight })
})
</script>

<style lang="scss" scoped>
@import '../../../../../scss/tokens';

.chat-box {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  border: $border-subtle;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.chat-row {
  display: flex;
  align-items: baseline;
}

.chat-time {
  flex-shrink: 0;
  width: 56px;
  text-align: right;
  margin-right: 5px;
  font-size: 10px;
  color: $palette-muted;
}

.chat-input-wrap {
  display: flex;
  flex-shrink: 0;
  border-top: $border-subtle;
}

.chat-input {
  flex: 1;
  background: $palette-surface;
  border: none;
  color: $palette-text;
  font-family: inherit;
  font-size: $font-sm;
  padding: 11px 14px;
  outline: none;
  &::placeholder { color: $palette-muted; }
}

.chat-send {
  font-family: inherit;
  font-size: $font-xs;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: $tracking-links;
  padding: 0 16px;
  background: $palette-surface;
  border: none;
  border-left: $border-subtle;
  color: $palette-muted;
  cursor: pointer;
  transition: $transition-color;
  &:hover { color: $palette-red; }
}
</style>
