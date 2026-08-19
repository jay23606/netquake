<template lang="pug">
.server-card(:class="{disabled: props.disabled}")
  MapImage.card-thumb(:mapName="props.server.map")
  .card-content
    .card-main
      .card-name(:class="{muted: props.disabled}") {{props.server.name}}
      .card-meta
      | {{props.server.map}} · {{props.server.location}}
      span.shareware-tag(v-if="props.shareware") shareware
    .card-footer
      div
        .card-players(
          :class="{'has-players': props.server.players.length > 0}"
          v-tippy="{allowHTML: true}"
          :content="model.playerTooltipHtml || formatPlayerCount"
        ) {{formatPlayerCount}} players
        .card-ping {{formattedPing}}
      button.card-join(
        v-if="!props.disabled"
        @click="emit('join', props.server)"
      ) Join
      .card-locked(v-else)
        font-awesome-icon(icon="fa-solid fa-lock" size="xs")
</template>

<script lang="ts" setup>
import { computed, reactive, watch } from 'vue'
import MapImage from '../../MapImage.vue'
import type { ServerStatus } from '../../../stores/multiplayer'
import { createWriter } from '../../../helpers/charmap'
import { icon } from '@fortawesome/fontawesome-svg-core'
import { faRobot } from '@fortawesome/free-solid-svg-icons'

const robotSvg = icon(faRobot, { styles: { color: '#888', 'margin-left': '6px' } }).html[0]

const props = defineProps<{
  server: ServerStatus
  disabled: boolean
  shareware: boolean
}>()

const emit = defineEmits<{
  (e: 'join', server: ServerStatus): void
}>()

const model = reactive<{ playerTooltipHtml: string }>({ playerTooltipHtml: '' })
const formatPlayerCount = computed(() => `${props.server.players.length}/${props.server.maxPlayers}`)

const formattedPing = computed(() => {
  const n = parseInt(props.server.ping)
  return isNaN(n) ? props.server.ping : `${props.server.ping}ms`
})

watch(props, () => {
  createWriter().then(writer => {
    const body = [...props.server.players]
      .sort((a, b) => b.frags - a.frags)
      .map(player => `<tr style="line-height: 1;">
        <td style="text-align:right;">
          <img src="${writer.writeScore(14, player.frags, (player.colors & 0xf0) >> 4, player.colors & 0xf)}" style="display:inline;">
        </td>
        <td style="width:20px; text-align:center;">${player.isBot ? robotSvg : ''}</td>
        <td style="padding-left: .5rem; text-align: left;">
          <img src="${writer.write(12, player.nameBase64)}" style="display:inline;">
        </td>
      </tr>`)
      .join('')
    model.playerTooltipHtml = `<table><tbody>${body}</tbody></table>`
  })
}, { immediate: true })
</script>

<style lang="scss" scoped>
@import '../../../scss/tokens';

.server-card {
  background: $palette-surface;
  border: 1px solid $palette-border;
  transition: $transition-bg;
  display: flex;
  flex-direction: column;
  overflow: hidden;

  &.disabled { opacity: 0.55; }
  .card-join:hover { color: $palette-red; }
}

.card-thumb {
  width: 100%;
  aspect-ratio: 4 / 3;
  background-position: center;
  background-size: cover;
}

.card-content {
  padding: 16px 20px 20px;
  display: flex;
  flex-direction: column;
  flex: 1;
}

.card-main { flex: 0; }

.card-name {
  font-size: $font-md;
  font-weight: $fw-extrabold;
  color: $palette-bright;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  &.muted { color: $palette-muted; }
}

.card-meta {
  font-size: $font-sm;
  color: $palette-muted;
  margin-top: $gap-1;
}

.shareware-tag {
  color: $palette-yellow;
  margin-left: 6px;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 14px;
  border-top: $border-subtle;
  margin-top: $gap-4;
}

.card-players {
  font-size: $font-base;
  font-weight: $fw-extrabold;
  color: $palette-muted;
  cursor: default;
  &.has-players { color: $palette-bright; }
}

.card-ping {
  font-size: $font-sm;
  color: $palette-muted;
  margin-top: 2px;
}

.card-join {
  font-size: $font-sm;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: $tracking-links;
  color: $palette-text;
  background: none;
  border: none;
  cursor: pointer;
  transition: $transition-color;
}

.card-locked { color: $palette-muted; }
</style>
