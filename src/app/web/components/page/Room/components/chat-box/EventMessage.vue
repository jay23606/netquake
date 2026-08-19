<template lang="pug">
.msg-system(:class="eventClass")
  | ↳
  span(v-if="player" v-html="quakeTextToHtml(player.name)")
  |  {{ eventText }}
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import type { ChatMessage, ChatMessages, PlayerId } from '../../../../../types/Room'
import { quakeTextToHtml } from '../../../../../util/quakeText'

type Props = {
  type: Extract<ChatMessage['content'], { tag: 'event' }>['type']
  reason?: Extract<ChatMessage['content'], { tag: 'event' }>['reason']
  player: ChatMessages['players'][PlayerId]
}
const props = defineProps<Props>()

const eventClass = computed(() => {
  switch (props.type) {
    case 'joined': return 'join'
    case 'left':
    case 'kicked':
    case 'banned':
    case 'connection-lost':
    case 'timed-out': return 'leave'
    default: return 'info'
  }
})

const eventText = computed(() => {
  switch (props.type) {
    case 'joined':          return 'joined'
    case 'left':            return 'left'
    case 'kicked':          return 'was kicked'
    case 'banned':          return 'was banned'
    case 'timed-out':       return 'timed out'
    case 'connection-lost': return 'lost connection'
    case 'changed-name':    return props.reason ?? 'changed their name'
    default:                return ''
  }
})
</script>

<style lang="scss" scoped>
@import '../../../../../scss/tokens';

.msg-system {
  font-size: $font-2xs;
  font-style: italic;
  font-family: 'JetBrains Mono', monospace;
  padding: 2px 0;
  &.join  { color: #4a9e4a; }
  &.leave { color: $palette-red; }
  &.info  { color: $palette-yellow; }

}
</style>
