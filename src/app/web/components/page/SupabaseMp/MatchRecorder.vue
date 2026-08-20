<script lang="ts" setup>
import { onBeforeUnmount, onMounted } from 'vue'
import * as cl from '../../../../../engine/cl'
import { useSupabaseRoomStore } from '../../../stores/supabaseRoom'
import { recordMatch, type MatchPlayer } from '../../../../../shared/supabase/stats'

// Renderless. Watches for the end of a match and files the scoreboard.
//
// Only the host records. The host is the server, so its scoreboard is the
// authoritative one; every client filing its own copy would multiply each
// match by the player count.
//
// The engine signals the end by setting clState.intermission non-zero, which
// is polled rather than hooked: reaching it would mean threading a callback
// through the engine's message handler for something that happens once a
// match. A second of latency costs nothing here.

const store = useSupabaseRoomStore()

const POLL_MS = 1000
let timer: ReturnType<typeof setInterval> | null = null
let filed = false

// The lobby name is passed to the engine with spaces collapsed to underscores
// (a space would split into another command-line argument), so matching the
// scoreboard back to a player has to apply the same transform.
const engineName = (name: string) => name.trim().replace(/\s+/g, '_')

const playerIdsByName = (): Map<string, string> => {
	const byName = new Map<string, string>()
	store.players.forEach(p => {
		const name = p.nq_profiles?.name
		if (name) byName.set(engineName(name), p.player_id)
	})
	return byName
}

const check = (): void => {
	const state = cl.clState
	if (!state) return

	// Back in play: arm for the next match.
	if (state.intermission === 0) {
		filed = false
		return
	}
	if (filed || !store.isHost) return
	filed = true

	const ids = playerIdsByName()
	const players: MatchPlayer[] = state.scores
		.filter(s => s.name.trim().length > 0 && !s.isBot)
		.map(s => ({
			playerId: ids.get(engineName(s.name)) ?? null,
			name: s.name,
			frags: s.frags,
		}))

	void recordMatch({
		roomId: store.room?.id ?? null,
		game: store.room?.game ?? 'q1',
		map: store.room?.map ?? '',
		players,
	})
}

onMounted(() => { timer = setInterval(check, POLL_MS) })
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>

<template><span style="display: none" /></template>
