<template>
  <div v-if="open" class="vote">
    <h2>Next map</h2>
    <ul>
      <li v-for="m in candidates" :key="m">
        <button
          type="button"
          :class="{ chosen: myVote === m }"
          @click="choose(m)"
        >
          <span class="name">{{ m }}</span>
          <span class="count">{{ tally.get(m) ?? 0 }}</span>
        </button>
      </li>
    </ul>
    <p class="foot">
      <span v-if="applied">Loading {{ applied }}...</span>
      <span v-else-if="seconds > 0">{{ seconds }}s</span>
      <span v-else-if="!store.isHost">waiting for the host</span>
      <span v-else>no votes</span>
    </p>
  </div>
</template>

<script lang="ts" setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import * as cl from '../../../../../engine/cl'
import * as cmd from '../../../../../engine/cmd'
import { useSupabaseRoomStore } from '../../../stores/supabaseRoom'
import { shortlistFor } from '../../../../../shared/quakeMaps'
import {
  castVote,
  fetchVotes,
  subscribeVotes,
  tallyOf,
  winnerOf,
} from '../../../../../shared/supabase/mapVote'

// The end-of-match map vote.
//
// Quake's own intermission already advances the level when a player presses
// fire, so this is racing the engine. The host therefore re-checks that the
// match is still at intermission immediately before applying the winner --
// otherwise a changelevel issued a moment too late would jump a second time,
// out of a map nobody voted for.

const store = useSupabaseRoomStore()

const POLL_MS = 500
const VOTE_SECONDS = 12

const open = ref(false)
const candidates = ref<string[]>([])
const tally = ref(new Map<string, number>())
const myVote = ref<string | null>(null)
const seconds = ref(VOTE_SECONDS)
const applied = ref<string | null>(null)

let poll: ReturnType<typeof setInterval> | null = null
let countdown: ReturnType<typeof setInterval> | null = null
let unsubscribe: (() => void) | null = null
let round = ''

// Only deathmatch, and only Quake 1. The added maps are deathmatch-only, and
// co-op has a campaign order that a vote has no business overriding.
const eligible = computed(() =>
  store.room?.game === 'q1' && store.room?.game_settings?.gameType !== 'coop')

const refreshTally = async (): Promise<void> => {
  if (!store.room) return
  const votes = await fetchVotes(store.room.id, round)
  tally.value = tallyOf(votes)
}

const choose = (map: string): void => {
  const roomId = store.room?.id
  const playerId = store.playerId
  if (!roomId || !playerId || applied.value) return
  myVote.value = map
  void castVote(roomId, playerId, round, map).then(refreshTally)
}

const finish = async (): Promise<void> => {
  if (countdown) { clearInterval(countdown); countdown = null }
  if (!store.isHost || applied.value || !store.room) return

  const votes = await fetchVotes(store.room.id, round)
  const winner = winnerOf(votes, candidates.value)
  if (!winner) return

  // The engine may already have moved on: a player pressing fire at the
  // scoreboard ends intermission by itself. Applying now would skip a map.
  if (cl.clState?.intermission === 0) return

  applied.value = winner
  cmd.executeString(`changelevel ${winner}`, cmd.CMD_SOURCE.src_command)
}

const begin = (): void => {
  const room = store.room
  if (!room) return
  const current = room.map
  round = `${room.id}:${current}`
  candidates.value = shortlistFor(round, current)
  tally.value = new Map()
  myVote.value = null
  applied.value = null
  seconds.value = VOTE_SECONDS
  open.value = true

  void refreshTally()
  unsubscribe = subscribeVotes(room.id, () => { void refreshTally() })

  countdown = setInterval(() => {
    seconds.value -= 1
    if (seconds.value <= 0) void finish()
  }, 1000)
}

const end = (): void => {
  open.value = false
  if (countdown) { clearInterval(countdown); countdown = null }
  if (unsubscribe) { unsubscribe(); unsubscribe = null }
}

const check = (): void => {
  const state = cl.clState
  if (!state) return
  const atIntermission = state.intermission !== 0
  if (atIntermission && !open.value && eligible.value) begin()
  else if (!atIntermission && open.value) end()
}

onMounted(() => { poll = setInterval(check, POLL_MS) })
onBeforeUnmount(() => {
  if (poll) clearInterval(poll)
  end()
})
</script>

<style lang="scss" scoped>
.vote {
  position: absolute;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  z-index: 30;
  min-width: 280px;
  padding: 12px 14px;
  color: rgba(235, 235, 235, 0.92);
  background: rgba(0, 0, 0, 0.72);
  border: 1px solid rgba(128, 128, 128, 0.45);
  border-radius: 3px;
  font-size: 0.8rem;
}
.vote h2 {
  margin: 0 0 8px;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.75;
}
.vote ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; }
.vote button {
  width: 100%;
  display: flex; justify-content: space-between; gap: 12px;
  padding: 6px 9px;
  font: inherit;
  color: inherit;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid transparent;
  border-radius: 2px;
  cursor: pointer;
}
.vote button:hover { background: rgba(255, 255, 255, 0.12); }
.vote button.chosen { border-color: rgba(122, 209, 122, 0.7); color: #7ad17a; }
.vote .count { font-variant-numeric: tabular-nums; opacity: 0.8; }
.foot { margin: 8px 0 0; text-align: right; opacity: 0.65; font-size: 0.72rem; }
</style>
