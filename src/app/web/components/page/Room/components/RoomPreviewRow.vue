<template lang="pug">
.room-card(:class="{disabled: !hasRegistered}")
  MapImage.card-thumb(:mapName="room.startMap" :fullMapPath="thumbUrl")
  .card-content
    .card-main
      .card-name(v-html="quakeTextToHtml(room.name)")
      .card-meta
        span.game-type {{gameType}}
        span.sep ·
        font-awesome-icon.icon(icon="fa-solid fa-crown" size="xs")
        span(v-html="quakeTextToHtml(hostPlayerName)")
    .card-footer
      div
        .card-players(
          :class="{'has-players': room.players.length > 0}"
          v-tippy="{allowHTML: true}"
          :content="playerTooltipHtml"
        ) {{formatPlayerCount}} players
        .card-status(:class="room.status") {{room.status === 'in-game' ? 'In Game' : 'In Lobby'}}
      button.card-join(
        v-if="hasRegistered"
        @click="router.push('/room/' + room.id)"
      ) Join
      .join-locked(
        v-else
        v-tippy
        content="Load pak1.pak to join game rooms"
      )
        font-awesome-icon(icon="fa-solid fa-lock" size="xs")
</template>

<script lang="ts" setup>
import MapImage from '../../../MapImage.vue'
import type { Room } from '../../../../types/Room'
import { computed, reactive, watch } from 'vue'
import { createWriter } from '../../../../helpers/charmap'
import { useRouter } from 'vue-router'
import { escapeHtml } from '../../../../helpers/string'
import { quakeTextToHtml } from '../../../../util/quakeText'
import { useMapsStore } from '../../../../stores/maps'
import { getQuaddictedImageUrl } from '../../../../helpers/map'

const router = useRouter()
const mapsStore = useMapsStore()

const thumbUrl = computed(() => {
  const sourceId = props.room.sourceId
  if (!sourceId?.startsWith('quaddicted:')) return undefined
  const mapId = sourceId.split(':')[1]
  const map = mapsStore.getMapFromId(mapId)
  return map ? getQuaddictedImageUrl(mapId, map.fileName) : undefined
})

const model = reactive<{
  renderedNames: Record<string, string>
}>({
  renderedNames: {}
})

const props = defineProps<{
  hasRegistered: boolean
  room: Room
}>()

const hostPlayerName = computed(() => {
  const host = props.room.players.find(p => p.id === props.room.hostPlayerId)
  return host ? host.name : 'Host Left'
})

const formatPlayerCount = computed(() => `${props.room.players.length}/${props.room.maxPlayers}`)

const gameType = computed(() => {
  switch (props.room.gameType) {
    case 'dm':   return 'Deathmatch'
    case 'coop': return 'Cooperative'
    case 'ctf':  return 'Capture The Flag'
  }
})

const playerTooltipHtml = computed(() => {
  const nameHtml = props.room.players.map(player =>
    model.renderedNames[player.name]
      ? `<img src=${model.renderedNames[player.name]} />`
      : escapeHtml(player.name)
  )
  return `<div style="display:flex;flex-direction:column;">${
    nameHtml.map(n => `<div>${n}</div>`).join('')
  }</div>`
})

watch(props, () => {
  createWriter().then(writer => {
    model.renderedNames = props.room.players.reduce((acc, player) => {
      if (!acc[player.name]) {
        acc[player.name] = writer.write(12, btoa(player.name))
      }
      return acc
    }, {} as Record<string, string>)
  })
}, { immediate: true })
</script>

<style lang="scss" scoped>
@import '../../../../scss/tokens';

.room-card {
  background: $palette-surface;
  border: 1px solid $palette-border;
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
}

.card-meta {
  font-size: $font-sm;
  color: $palette-muted;
  margin-top: $gap-1;
  display: flex;
  align-items: center;
  gap: 6px;

  .game-type { color: $palette-yellow; font-weight: $fw-semibold; }
  .sep { color: $palette-border; }
  .icon { font-size: 10px; }
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

.card-status {
  font-size: $font-xs;
  color: $palette-muted;
  margin-top: 2px;
  text-transform: uppercase;
  letter-spacing: $tracking-links;
  font-weight: $fw-semibold;

  &.in-game { color: $palette-yellow; }
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

.join-locked { color: $palette-muted; }
</style>
