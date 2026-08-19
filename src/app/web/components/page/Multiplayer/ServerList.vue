<template lang="pug">
.server-list
  template(v-if="props.loading")
    .loading.loading-lg
  template(v-else)
    template(v-if="featuredItems.length")
      p.section-label Playing now
      .featured-grid
        GameCard(
          v-for="item in featuredItems"
          :key="item.key"
          :server="item.server"
          :room="item.room"
          :disabled="item.disabled"
          :shareware="item.shareware"
          @join-server="emit('join', $event)"
          @join-room="emit('join-room', $event)"
        )

    slot
    p.section-label All servers
    .table-head
      .th-thumb
      .th-name Server
      .th.th-map Map
      .th.th-players Players
      .th.th-ping Ping
      .th-join
    ServerRow(
      v-for="server in sortedList"
      :key="server.key"
      :server="server"
      :disabled="isDisabled(server)"
      :shareware="isShareware(server)"
      @join="emit('join', server)"
    )
</template>

<script lang="ts" setup>
import { computed } from 'vue'
import ServerRow from './ServerRow.vue'
import GameCard from './GameCard.vue'
import { useGameStore } from '../../../stores/game'
import { humanPlayerCount, type ServerStatus } from '../../../stores/multiplayer'
import type { Room } from '../../../types/Room'
import { sharewareMaps } from '../../../helpers/map'

const gameStore = useGameStore()
const isShareware = (server: ServerStatus) => !!sharewareMaps.find(m => m === server.map)
const isDisabled = (server: ServerStatus) => !gameStore.hasRegistered && !isShareware(server)

const props = defineProps<{
  loading: boolean
  servers: Record<string, ServerStatus>
  rooms: Room[]
}>()

const emit = defineEmits<{
  (e: 'join', server: ServerStatus): void
  (e: 'join-room', room: Room): void
}>()

type FeaturedItem = {
  key: string
  playerCount: number
  server?: ServerStatus
  room?: Room
  disabled: boolean
  shareware: boolean
}

const featuredItems = computed<FeaturedItem[]>(() => {
  const serverItems: FeaturedItem[] = Object.values(props.servers)
    .filter(s => humanPlayerCount(s) > 0)
    .sort((a, b) => humanPlayerCount(b) - humanPlayerCount(a))
    .slice(0, 3)
    .map(s => ({
      key: 'server-' + s.key,
      playerCount: humanPlayerCount(s),
      server: s,
      disabled: isDisabled(s),
      shareware: isShareware(s),
    }))

  const roomItems: FeaturedItem[] = props.rooms
    .map(r => ({
      key: 'room-' + r.id,
      playerCount: r.players.length,
      room: r,
      disabled: !gameStore.hasRegistered,
      shareware: false,
    }))

  return [...serverItems, ...roomItems]
    .sort((a, b) => b.playerCount - a.playerCount)
})

const featuredServerKeys = computed(() => new Set(
  featuredItems.value
    .filter(i => i.server)
    .map(i => i.server!.key)
))

const sortedList = computed(() =>
  Object.values(props.servers)
    .filter(s => !featuredServerKeys.value.has(s.key))
    .sort((s1, s2) => {
      const s1Disabled = isDisabled(s1)
      const s2Disabled = isDisabled(s2)
      if (s1Disabled === s2Disabled) return 0
      return s1Disabled ? 1 : -1
    })
)
</script>

<style lang="scss" scoped>
@import '../../../scss/tokens';

.loading { height: 200px; }

.section-label {
  font-size: $font-2xs;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: $tracking-caps;
  color: $palette-muted;
  margin-bottom: $gap-4;
}

/* ── Featured cards ── */
.featured-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: $gap-4;
  margin-bottom: 40px;

  @media (min-width: 480px) { grid-template-columns: 1fr 1fr; }
  @media (min-width: 840px) { grid-template-columns: repeat(3, 1fr); }
}

/* ── Table header ── */
.table-head {
  display: grid;
  grid-template-columns: 1fr 52px 56px;
  padding: 0 16px 10px;
  border-bottom: $border-subtle;
  gap: $gap-3;

  .th-thumb { display: none; }
  .th-map { display: none; }
  .th-players { display: none; }
  .th-ping { grid-column: 2; }
  .th-join { grid-column: 3; }

  @media (min-width: 480px) {
    grid-template-columns: 56px 1fr 52px 56px;
    .th-thumb { display: block; }
    .th-ping { grid-column: 3; }
    .th-join { grid-column: 4; }
  }

  @media (min-width: 600px) {
    grid-template-columns: 56px 1fr 60px 52px 56px;
    .th-players { display: block; grid-column: 3; }
    .th-ping { grid-column: 4; }
    .th-join { grid-column: 5; }
  }

  @media (min-width: 800px) {
    grid-template-columns: 56px 1fr 90px 60px 52px 56px;
    .th-map { display: block; grid-column: 3; }
    .th-players { grid-column: 4; }
    .th-ping { grid-column: 5; }
    .th-join { grid-column: 6; }
  }

  @media (min-width: 900px) {
    grid-template-columns: 80px 1fr 120px 72px 72px 72px;
  }
}

.th {
  font-size: $font-2xs;
  font-weight: $fw-bold;
  text-transform: uppercase;
  letter-spacing: $tracking-labels;
  color: $palette-muted;
}
</style>
