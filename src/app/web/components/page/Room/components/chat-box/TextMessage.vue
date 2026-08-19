<template lang="pug">
.msg
  span.msg-name(v-if="player" v-html="quakeTextToHtml(player.name)")
  span.host-star(v-if="player?.isHost") ★
  span.msg-sep :&nbsp;
  span.msg-text {{ message }}
</template>

<script lang="ts" setup>
import type { ChatMessage, ChatMessages, PlayerId } from '../../../../../types/Room'
import { quakeTextToHtml } from '../../../../../util/quakeText'

type Props = {
  message: Extract<ChatMessage['content'], { tag: 'text' }>['message']
  player: ChatMessages['players'][PlayerId]
}
defineProps<Props>()
</script>

<style lang="scss" scoped>
@import '../../../../../scss/tokens';

.msg {
  line-height: 1.5;
}

.msg-name {
  font-size: $font-2xs;
  font-weight: $fw-bold;
  color: $palette-bright;
}

.msg-sep {
  font-size: $font-2xs;
  color: $palette-muted;
}

.host-star {
  color: $palette-yellow;
  margin-left: 2px;
  margin-right: 1px;
  font-size: 10px;
}

.msg-text {
  font-size: $font-sm;
  color: $palette-text;
}
</style>
