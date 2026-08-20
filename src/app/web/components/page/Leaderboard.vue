<template>
  <div class="board">
    <h1>Leaderboard</h1>
    <p class="sub">Results from finished multiplayer matches.</p>

    <div class="panel">
      <h2>
        Standings
        <span class="radios inline">
          <label><input type="radio" value="q1" v-model="game" /> Quake 1</label>
          <label><input type="radio" value="q2" v-model="game" /> Quake 2</label>
        </span>
      </h2>

      <p v-if="loading" class="empty">Loading...</p>
      <p v-else-if="rows.length === 0" class="empty">
        No matches recorded yet. Play a multiplayer match through to the frag or
        time limit and it will show up here.
      </p>
      <table v-else class="grid">
        <thead>
          <tr>
            <th class="num">#</th>
            <th>Player</th>
            <th class="num">Frags</th>
            <th class="num">Wins</th>
            <th class="num">Matches</th>
            <th class="num">Best</th>
            <th class="num">Avg</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in rows" :key="row.player_id">
            <td class="num">{{ i + 1 }}</td>
            <td>{{ row.player_name }}</td>
            <td class="num strong">{{ row.total_frags }}</td>
            <td class="num">{{ row.wins }}</td>
            <td class="num">{{ row.matches }}</td>
            <td class="num">{{ row.best_frags }}</td>
            <td class="num">{{ row.avg_frags }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="panel secondary">
      <h2>Recent wins</h2>
      <p v-if="recent.length === 0" class="empty">Nothing yet.</p>
      <ul v-else class="recent">
        <li v-for="(m, i) in recent" :key="i">
          <span class="who">{{ m.player_name }}</span>
          <span class="what">{{ m.frags }} frags on {{ m.map }}</span>
          <span class="when">{{ when(m.ended_at) }}</span>
        </li>
      </ul>
    </div>

    <router-link class="back" to="/mp">Back to multiplayer</router-link>
  </div>
</template>

<script lang="ts" setup>
import { ref, watch } from 'vue'
import {
  fetchLeaderboard,
  fetchRecentMatches,
  type LeaderboardRow,
  type RecentMatch,
} from '../../../../shared/supabase/stats'
import type { GameId } from '../../../../shared/supabase/rooms'

const game = ref<GameId>('q1')
const rows = ref<LeaderboardRow[]>([])
const recent = ref<RecentMatch[]>([])
const loading = ref(true)

const when = (iso: string): string => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

const load = async (): Promise<void> => {
  loading.value = true
  const [board, matches] = await Promise.all([
    fetchLeaderboard(game.value),
    fetchRecentMatches(game.value),
  ])
  rows.value = board
  recent.value = matches
  loading.value = false
}

watch(game, () => { void load() }, { immediate: true })
</script>

<style lang="scss" scoped>
.board { max-width: 900px; margin: 0 auto; padding: 32px 24px; }
.sub { opacity: 0.75; margin-bottom: 24px; }
.panel { border: 1px solid rgba(128,128,128,0.35); padding: 16px; margin-bottom: 16px; }
.panel.secondary { border-style: dashed; opacity: 0.85; }
.panel h2 {
  margin: 0 0 12px; font-size: 1rem; text-transform: uppercase;
  display: flex; gap: 16px; align-items: center; flex-wrap: wrap;
}
.radios.inline { display: flex; gap: 12px; font-size: 0.8rem; text-transform: none; }
.radios label { display: flex; align-items: center; gap: 5px; }

.grid { width: 100%; border-collapse: collapse; }
.grid th, .grid td { padding: 7px 8px; border-bottom: 1px solid rgba(128,128,128,0.2); }
.grid th { font-size: 0.7rem; text-transform: uppercase; opacity: 0.7; text-align: left; }
.grid tr:last-child td { border-bottom: none; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.strong { font-weight: 600; }

.recent { list-style: none; padding: 0; margin: 0; }
.recent li {
  display: flex; gap: 12px; align-items: baseline;
  padding: 6px 0; border-bottom: 1px solid rgba(128,128,128,0.2);
}
.recent li:last-child { border-bottom: none; }
.recent .who { font-weight: 600; }
.recent .what { flex: 1; opacity: 0.85; }
.recent .when { opacity: 0.6; font-size: 0.8rem; white-space: nowrap; }

.empty { opacity: 0.7; margin: 0; }
.back { display: inline-block; margin-top: 8px; }

@media (max-width: 640px) {
  .board { padding: 20px 14px; }
  .grid th, .grid td { padding: 6px 5px; font-size: 0.85rem; }
  .recent li { flex-wrap: wrap; gap: 6px; }
}
</style>
