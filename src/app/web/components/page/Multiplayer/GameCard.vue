<template lang="pug">
.game-card(:class="{disabled}")
  MapImage.card-thumb(:mapName="mapName" :fullMapPath="thumbUrl" :gameDir="server?.game || room?.gameDir")
  .card-content
    .card-main
      .card-name(:class="{muted: disabled}") {{title}}
      .card-meta
        template(v-if="server")
          span {{server.map}} · {{server.location}}
          span.shareware-tag(v-if="shareware") shareware
        template(v-if="room")
          span {{room.startMap}} ·
          font-awesome-icon.host-icon(icon="fa-solid fa-crown" size="xs")
          span {{hostName}}
          template(v-if="room.gameType === 'coop' && room.skill != null")
            span  · {{skillLabel}}
    .card-footer
      div
        .card-players(
          :class="{'has-players': playerCount > 0}"
          v-tippy="{allowHTML: true}"
          :content="tooltipHtml || playerCountLabel"
        ) {{playerCountLabel}} players
        .card-ping(v-if="server") {{formattedPing}}
        .card-status(v-if="room" :class="room.status")
          font-awesome-icon.game-type-icon(
            :icon="gameTypeIcon"
            size="xs"
            v-tippy
            :content="gameTypeLabel"
          )
          | {{statusLabel}}
      button.card-join(
        v-if="!disabled"
        @click="onJoin"
      ) Join
      .card-locked(v-else)
        font-awesome-icon(icon="fa-solid fa-lock" size="xs")
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import MapImage from '../../MapImage.vue'
import type { ServerStatus } from '../../../stores/multiplayer'
import type { Room } from '../../../types/Room'
import { createWriter } from '../../../helpers/charmap'
import { useMapsStore } from '../../../stores/maps'
import { getQuaddictedImageUrl } from '../../../helpers/map'
import { escapeHtml } from '../../../helpers/string'
import { icon } from '@fortawesome/fontawesome-svg-core'
import { faRobot } from '@fortawesome/free-solid-svg-icons'

const robotSvg = icon(faRobot, { styles: { color: '#888', 'margin-left': '6px' } }).html[0]

const props = defineProps<{
  server?: ServerStatus
  room?: Room
  disabled: boolean
  shareware?: boolean
}>()

const emit = defineEmits<{
  (e: 'join-server', server: ServerStatus): void
  (e: 'join-room', room: Room): void
}>()

const mapsStore = useMapsStore()

const mapName = computed(() => props.server?.map || props.room?.startMap)

const thumbUrl = computed(() => {
  const sourceId = props.room?.sourceId
  if (!sourceId?.startsWith('quaddicted:')) return undefined
  const mapId = sourceId.split(':')[1]
  const map = mapsStore.getMapFromId(mapId)
  return map ? getQuaddictedImageUrl(mapId, map.fileName) : undefined
})

const title = computed(() => props.server?.name || props.room?.name || '')

const gameTypeLabel = computed(() => {
  switch (props.room?.gameType) {
    case 'dm':   return 'Deathmatch'
    case 'coop': return 'Cooperative'
    case 'ctf':  return 'Capture The Flag'
    default:     return ''
  }
})

const gameTypeIcon = computed(() => {
  switch (props.room?.gameType) {
    case 'dm':   return 'fa-solid fa-crosshairs'
    case 'coop': return 'fa-solid fa-users'
    case 'ctf':  return 'fa-solid fa-flag'
    default:     return 'fa-solid fa-crosshairs'
  }
})

const skillLabels = ['Easy', 'Normal', 'Hard', 'Nightmare']

const hostName = computed(() => {
  if (!props.room) return ''
  const host = props.room.players.find(p => p.id === props.room!.hostPlayerId)
  return host ? host.name : 'Host Left'
})

const skillLabel = computed(() =>
  props.room?.skill != null ? skillLabels[props.room.skill] ?? '' : ''
)

const playerCount = computed(() =>
  props.server?.players.length ?? props.room?.players.length ?? 0
)

const playerCountLabel = computed(() => {
  if (props.server) return `${props.server.players.length}/${props.server.maxPlayers}`
  if (props.room) return `${props.room.players.length}/${props.room.maxPlayers}`
  return '0'
})

const formattedPing = computed(() => {
  if (!props.server) return ''
  const n = parseInt(props.server.ping)
  return isNaN(n) ? props.server.ping : `${props.server.ping}ms`
})

const statusLabel = computed(() =>
  props.room?.status === 'in-game' ? 'In Game' : 'In Lobby'
)

const tooltipHtml = ref('')

watch(props, () => {
  if (props.server) {
    createWriter().then(writer => {
      const body = [...props.server!.players]
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
      tooltipHtml.value = `<table><tbody>${body}</tbody></table>`
    })
  } else if (props.room) {
    createWriter().then(writer => {
      const nameHtml = props.room!.players.map(player => {
        const img = writer.write(12, btoa(player.name))
        return img ? `<img src="${img}" />` : escapeHtml(player.name)
      })
      tooltipHtml.value = `<div style="display:flex;flex-direction:column;">${
        nameHtml.map(n => `<div>${n}</div>`).join('')
      }</div>`
    })
  }
}, { immediate: true })

const onJoin = () => {
  if (props.server) emit('join-server', props.server)
  if (props.room) emit('join-room', props.room)
}
</script>

<style lang="scss" scoped>
@import '../../../scss/tokens';

.game-card {
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
  display: flex;
  align-items: center;
  gap: 6px;

  .host-icon { font-size: 10px; }
  .shareware-tag { color: $palette-yellow; }
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

.card-status {
  font-size: $font-xs;
  color: $palette-muted;
  margin-top: 2px;
  text-transform: uppercase;
  letter-spacing: $tracking-links;
  font-weight: $fw-semibold;

  &.in-game { color: $palette-yellow; }

  .game-type-icon { margin-right: 5px; }
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
