<template lang="pug">
.player-list
  .player-row(v-for="player in sortedPlayers" :key="player.id")
    div
      .player-name
        span(v-html="quakeTextToHtml(player.name)")
        | &nbsp;
        span.icon-host(v-if="player.isHost" title="Host") ★
      .player-status {{ playerStatusText(player.status) }}
      .player-download(v-if="player.downloadProgress")
        .player-download-bar(:style="{ width: downloadPct(player) + '%' }")
        .player-download-text {{ downloadPct(player) }}%
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import type { Player } from '../../../../../types/Room'
import { quakeTextToHtml } from '../../../../../util/quakeText'

const props = defineProps<{ players: Player[] }>()

const sortedPlayers = computed(() =>
  props.players.slice().sort((a, b) => {
    if (a.isHost && !b.isHost) return -1
    if (!a.isHost && b.isHost) return 1
    return a.name.localeCompare(b.name)
  })
)

const downloadPct = (player: Player) => {
  if (!player.downloadProgress || player.downloadProgress.total === 0) return 0
  return Math.round((player.downloadProgress.loaded / player.downloadProgress.total) * 100)
}

const playerStatusText = (status: Player['status']) => {
  switch (status) {
    case 'in-game':   return 'In game'
    case 'away':      return 'Away'
    default:          return 'In lobby'
  }
}
</script>

<style lang="scss" scoped>
@import '../../../../../scss/tokens';

.player-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: $border-subtle;
  &:last-child { border-bottom: none; }
}

.player-name {
  font-size: $font-sm;
  font-weight: $fw-bold;
  color: $palette-bright;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.icon-host {
  font-size: $font-xs;
  color: $palette-yellow;
}

.player-status {
  font-size: 10px;
  color: $palette-muted;
  margin-top: 1px;
  text-transform: uppercase;
  letter-spacing: $tracking-links;
}

.player-download {
  margin-top: 4px;
  position: relative;
  height: 3px;
  background: $palette-border;
  border-radius: 2px;
  overflow: hidden;
}

.player-download-bar {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  background: $palette-yellow;
  transition: width 0.3s;
}

.player-download-text {
  font-size: 9px;
  color: $palette-muted;
  margin-top: 2px;
  letter-spacing: $tracking-links;
}
</style>
