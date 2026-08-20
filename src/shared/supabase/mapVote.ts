import { getSupabase } from './client'

// The end-of-match map vote. See supabase/007_map_vote.sql.
//
// A round is scoped by the room plus the map just played. That is also the seed
// clients use to derive the candidate list, so the ballot and the tally always
// refer to the same match without anyone publishing either.

export type Vote = { player_id: string, map: string }

export const castVote = async (
	roomId: string,
	playerId: string,
	round: string,
	map: string
): Promise<void> => {
	const { error } = await getSupabase()
		.from('nq_map_votes')
		.upsert(
			{ room_id: roomId, player_id: playerId, round, map },
			{ onConflict: 'room_id,player_id,round' }
		)
	if (error) console.warn('[vote] could not cast:', error.message)
}

export const fetchVotes = async (roomId: string, round: string): Promise<Vote[]> => {
	const { data, error } = await getSupabase()
		.from('nq_map_votes')
		.select('player_id, map')
		.eq('room_id', roomId)
		.eq('round', round)
	if (error) {
		console.warn('[vote] could not read tally:', error.message)
		return []
	}
	return (data ?? []) as Vote[]
}

// Realtime cannot filter on two columns, so it filters on the room and the
// round is checked here. Rounds are short-lived and rooms are small, so the
// traffic this lets through is a handful of rows.
export const subscribeVotes = (
	roomId: string,
	onChange: () => void
): (() => void) => {
	const supabase = getSupabase()
	const channel = supabase
		.channel(`netquake:votes:${roomId}`)
		.on(
			'postgres_changes',
			{ event: '*', schema: 'public', table: 'nq_map_votes', filter: `room_id=eq.${roomId}` },
			() => onChange()
		)
		.subscribe()
	return () => { void supabase.removeChannel(channel) }
}

/**
 * The winner is the map with the most votes, ties broken by the order the
 * candidates were offered in. That order is itself derived from the round seed,
 * so every client resolves a tie the same way and the host is not making a
 * private decision.
 */
export const winnerOf = (votes: Vote[], candidates: readonly string[]): string | null => {
	if (candidates.length === 0) return null
	const counts = new Map<string, number>()
	votes.forEach(v => {
		if (candidates.includes(v.map)) counts.set(v.map, (counts.get(v.map) ?? 0) + 1)
	})
	if (counts.size === 0) return null

	let best = candidates[0]
	let bestCount = -1
	for (const map of candidates) {
		const count = counts.get(map) ?? 0
		if (count > bestCount) { best = map; bestCount = count }
	}
	return bestCount > 0 ? best : null
}

export const tallyOf = (votes: Vote[]): Map<string, number> => {
	const counts = new Map<string, number>()
	votes.forEach(v => counts.set(v.map, (counts.get(v.map) ?? 0) + 1))
	return counts
}
