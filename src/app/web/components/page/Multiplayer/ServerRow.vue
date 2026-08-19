<template lang="pug">
.server-row(:class="{disabled: props.disabled}")
  MapImage.map-thumb(:mapName="props.server.map")
  .server-info
    .s-name(:class="{muted: props.disabled}") {{props.server.name}}
    .s-sub
      font-awesome-icon.icon(icon="fa-solid fa-location-dot" size="xs")
      |  {{props.server.location}}
      template(v-if="props.shareware")
        |  · #[span.shareware-tag shareware]
  .s-map {{props.server.map}}
  .s-players(:class="{'has-players': humanCount > 0}")
    | {{formatPlayerCount}}
    span.bot-count(v-if="botCount > 0")
      | +{{botCount}}
      font-awesome-icon.bot-icon(icon="fa-solid fa-robot")
  .s-ping(:class="pingClass")
    template(v-if="isNumericPing")
      | {{props.server.ping}}
      span.ms ms
    template(v-else) —
  button.join-btn(
    v-if="!props.disabled"
    @click="emit('join', props.server)"
  ) Join
  .join-locked(
    v-else
    v-tippy
    :content="joinTooltipText"
  )
    font-awesome-icon(icon="fa-solid fa-lock" size="xs")
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import { humanPlayerCount, type ServerStatus } from '../../../stores/multiplayer'
import MapImage from '../../MapImage.vue'

const emit = defineEmits<{
  (e: 'join', server: ServerStatus): void
}>()

const props = defineProps<{
  server: ServerStatus
  disabled: boolean
  shareware: boolean
}>()

const humanCount = computed(() => humanPlayerCount(props.server))
const botCount = computed(() => props.server.players.length - humanCount.value)
const formatPlayerCount = computed(() => `${humanCount.value}/${props.server.maxPlayers}`)
const joinTooltipText = computed(() => props.disabled
  ? "You must load your pak1.pak before\nplaying modified games.\nSee FAQ for details."
  : "Join this server"
)

const numericPing = computed(() => {
  const n = parseInt(props.server.ping)
  return isNaN(n) ? -1 : n
})
const isNumericPing = computed(() => numericPing.value >= 0)
const pingClass = computed(() => {
  if (!isNumericPing.value) return 'ping-unknown'
  if (numericPing.value <= 100) return 'ping-good'
  if (numericPing.value <= 200) return 'ping-ok'
  return 'ping-bad'
})


</script>

<style lang="scss" scoped>
@import '../../../scss/tokens';

.server-row {
  display: grid;
  grid-template-columns: 1fr 52px 56px;
  align-items: center;
  gap: $gap-3;
  padding: 10px 16px;
  border-bottom: $border-subtle;
  transition: background 0.1s;

  .join-btn:hover { color: $palette-red; }
  .map-thumb { display: none; }
  .s-map { display: none; }
  .s-players { display: none; }
  .s-ping { grid-column: 2; }
  .join-btn, .join-locked { grid-column: 3; }

  @media (min-width: 480px) {
    grid-template-columns: 56px 1fr 52px 56px;

    .map-thumb { display: block; }
    .s-ping { grid-column: 3; }
    .join-btn, .join-locked { grid-column: 4; }
  }

  @media (min-width: 600px) {
    grid-template-columns: 56px 1fr 60px 52px 56px;

    .s-players {
      display: flex;
      align-items: center;
      grid-column: 3;
    }
    .s-ping { grid-column: 4; }
    .join-btn, .join-locked { grid-column: 5; }
  }

  @media (min-width: 800px) {
    grid-template-columns: 56px 1fr 90px 60px 52px 56px;

    .s-map {
      display: block;
      grid-column: 3;
    }
    .s-players { grid-column: 4; }
    .s-ping { grid-column: 5; }
    .join-btn, .join-locked { grid-column: 6; }
  }

  @media (min-width: 900px) {
    grid-template-columns: 80px 1fr 120px 72px 72px 72px;
  }
}

.map-thumb {
  height: 52px;
  border: $border-subtle;
  background-position: center;
}

.server-info { overflow: hidden; }

.s-name {
  font-size: $font-base;
  font-weight: $fw-bold;
  color: $palette-bright;
  word-break: break-word;

  @media (min-width: 900px) {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &.muted { color: $palette-muted; }
}

.s-sub {
  font-size: $font-xs;
  color: $palette-muted;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  .icon { font-size: 10px; margin-right: 3px; }
  .shareware-tag { color: $palette-yellow; }
}

.s-map {
  font-size: 14px;
  font-weight: $fw-semibold;
  color: $palette-text;
}

.s-players {
  font-size: $font-base;
  font-weight: $fw-bold;
  color: $palette-muted;
  cursor: default;

  &.has-players { color: $palette-text; }

  .bot-count {
    font-size: $font-xs;
    font-weight: $fw-semibold;
    color: $palette-muted;
    margin-left: 3px;
  }

  .bot-icon { margin-left: 2px; }
}

.s-ping {
  font-size: $font-base;
  font-weight: $fw-bold;

  .ms { font-size: $font-2xs; font-weight: 400; color: $palette-muted; margin-left: 1px; }

  &.ping-good    { color: $palette-text; }
  &.ping-ok      { color: #e08030; }
  &.ping-bad     { color: $palette-red; }
  &.ping-unknown { color: $palette-muted; }
}

.join-btn {
  font-size: $font-sm;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: $tracking-links;
  color: $palette-text;
  background: none;
  border: none;
  cursor: pointer;
  transition: $transition-color;
  text-align: right;
  padding: 0;
}

.join-locked {
  color: $palette-muted;
  text-align: right;
}
</style>
