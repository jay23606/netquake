import { createFoyer, type Foyer, type RoomHandle } from '@jay23606/foyer'
import { getSupabase } from './client'
import type { GameId, GameSettings } from './rooms'

// The foyer client for netquake's lobby.
//
// foyer's tables live under the nqf_ prefix rather than nq_, because the
// original nq_rooms and nq_room_players have a different shape -- named columns
// for map, game and settings where foyer keeps one metadata blob. Adding
// alongside instead of migrating costs a duplicate profiles table and buys a
// cutover with nothing to move: rooms here are ephemeral, closing when the last
// player leaves and swept by the reaper, so there is no history to carry over.
//
// nq_match_results and nq_map_votes keep pointing at nq_profiles. Both tables
// key on the auth user id, which is the same id foyer stores, so a player is
// one person across both regardless of which profile row is read.

/** What netquake keeps in a room's metadata blob. */
export type RoomMeta = {
	map: string
	game: GameId
	settings: GameSettings
}

/** What netquake keeps in a player's state blob. */
export type PlayerState = {
	color?: number
	assetProgress?: number
}

export type NetquakeRoom = RoomHandle<RoomMeta>

let client: Foyer | null = null

export const foyer = (): Foyer => {
	client ??= createFoyer({
		supabase: getSupabase(),
		prefix: 'nqf_',
		// Supplied rather than left to foyer's fallback, which reads
		// undocumented fields off the supabase client.
		url: import.meta.env.VITE_SUPABASE_URL as string,
		anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
	})
	return client
}
