import { getSupabase } from './client'
import type { GameId } from './rooms'

// Match results and the leaderboard built from them.
//
// Only the host reports a match. It is the server, so its scoreboard is the
// authoritative one; every client reporting its own view would multiply each
// match by the number of players. See supabase/006_stats.sql.

export type MatchPlayer = {
	playerId: string | null
	name: string
	frags: number
}

export type MatchResult = {
	roomId: string | null
	game: GameId
	map: string
	players: MatchPlayer[]
}

export type LeaderboardRow = {
	player_id: string
	player_name: string
	game: GameId
	matches: number
	total_frags: number
	best_frags: number
	wins: number
	avg_frags: number
	last_played: string
}

// Ranked highest frags first. Ties share the better rank, so two players on
// nine frags are both second and nobody is third -- which is what a scoreboard
// showing a draw should say.
const rank = (players: MatchPlayer[]): Map<MatchPlayer, number> => {
	const sorted = [...players].sort((a, b) => b.frags - a.frags)
	const ranks = new Map<MatchPlayer, number>()
	sorted.forEach((p, i) => {
		const previous = sorted[i - 1]
		ranks.set(p, previous && previous.frags === p.frags
			? ranks.get(previous)!
			: i + 1)
	})
	return ranks
}

export const recordMatch = async (result: MatchResult): Promise<void> => {
	// A match nobody could win is not worth recording: single-player, or a
	// scoreboard that never registered anyone.
	const scored = result.players.filter(p => p.name.trim().length > 0)
	if (scored.length < 2) return

	const ranks = rank(scored)
	const rows = scored.map(p => ({
		room_id: result.roomId,
		game: result.game,
		map: result.map,
		player_id: p.playerId,
		player_name: p.name,
		frags: p.frags,
		rank: ranks.get(p) ?? 0,
		players: scored.length,
	}))

	const { error } = await getSupabase().from('nq_match_results').insert(rows)
	// Stats are a side effect of playing, never a reason to interrupt it.
	if (error) console.warn('[stats] could not record match:', error.message)
}

export const fetchLeaderboard = async (
	game: GameId,
	limit = 25
): Promise<LeaderboardRow[]> => {
	const { data, error } = await getSupabase()
		.from('nq_leaderboard')
		.select('*')
		.eq('game', game)
		.order('total_frags', { ascending: false })
		.limit(limit)
	if (error) {
		console.warn('[stats] could not load leaderboard:', error.message)
		return []
	}
	return (data ?? []) as LeaderboardRow[]
}

export type RecentMatch = {
	map: string
	ended_at: string
	player_name: string
	frags: number
	rank: number
	players: number
}

export const fetchRecentMatches = async (
	game: GameId,
	limit = 20
): Promise<RecentMatch[]> => {
	const { data, error } = await getSupabase()
		.from('nq_match_results')
		.select('map, ended_at, player_name, frags, rank, players')
		.eq('game', game)
		.eq('rank', 1)
		.order('ended_at', { ascending: false })
		.limit(limit)
	if (error) {
		console.warn('[stats] could not load recent matches:', error.message)
		return []
	}
	return (data ?? []) as RecentMatch[]
}
