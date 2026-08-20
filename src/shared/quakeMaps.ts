// The map lists, shared by the lobby's picker and the end-of-match vote.
//
// Kept out of any component because two places now need to agree on exactly
// which maps exist, and a vote whose candidates differ between players would
// be worse than no vote at all.

// Every shareware Quake 1 map carries deathmatch spawn points, including the
// start hub, which is small enough to play well with two.
export const Q1_SHAREWARE_MAPS = [
	'e1m1', 'e1m2', 'e1m3', 'e1m4', 'e1m5', 'e1m6', 'e1m7', 'e1m8', 'start',
] as const

// dm1-dm3 ship in pak1, the registered data, so offering them unconditionally
// created rooms a shareware player could never load. They appear only once this
// browser has a copy of pak1 uploaded.
export const Q1_RETAIL_MAPS = ['dm1', 'dm2', 'dm3'] as const

// LibreQuake's own levels, under the BSD licence, shipped as loose .bsp files
// rather than a second game dir -- Quake embeds a map's textures in the BSP, so
// each one is self-contained. They are deathmatch-only: they place hell
// knights, whose model lives in pak1, and Quake removes monsters before
// precaching only when deathmatch is set. Under coop they would fail to load.
export const Q1_LIBREQUAKE_MAPS = [
	'lq_e0m1', 'lq_e0m2', 'lq_e0m3', 'lq_e0m4',
	'lq_e0m5', 'lq_e0m6', 'lq_e0m7', 'lq_e0m8',
] as const

// LibreQuartz, a second libre Quake project, also BSD-3-Clause. Same loose-BSP
// treatment and the same deathmatch-only rule: `box` places monsters whose
// models ship in pak1. The rest are clean, but they share the one gate so
// there is a single rule covering every added map.
export const Q1_LIBREQUARTZ_MAPS = [
	'am1', 'box', 'bunkers', 'house', 'nsa', 'office',
	'void1', 'void2', 'void3', 'void4', 'void5', 'void6',
] as const

export const Q2_MAPS = ['demo1', 'demo2', 'demo3'] as const

// The pool the end-of-match vote draws from.
//
// Deliberately excludes the retail maps. Whether a browser has pak1 is a local
// fact -- one player may have uploaded it and another not -- so including them
// would give players different candidate lists, and a vote where people are
// choosing from different ballots is not a vote. Everything here is either
// shareware or served from this site, so every player has all of it.
export const Q1_VOTABLE_MAPS: readonly string[] = [
	...Q1_SHAREWARE_MAPS,
	...Q1_LIBREQUAKE_MAPS,
	...Q1_LIBREQUARTZ_MAPS,
]

// A small, stable shortlist. Voting over twenty-nine options is not a choice,
// it is a menu; four is a decision.
//
// Derived from the room and the map just played rather than drawn at random,
// so every player computes the same ballot without anyone having to publish it.
// The seed changes when the map does, so the next vote offers a different four.
export const shortlistFor = (
	seed: string,
	exclude: string,
	count = 4
): string[] => {
	const pool = Q1_VOTABLE_MAPS.filter(m => m !== exclude)

	// A small deterministic hash; only needs to scatter, not to be secure.
	let h = 2166136261
	for (let i = 0; i < seed.length; i += 1) {
		h ^= seed.charCodeAt(i)
		h = Math.imul(h, 16777619) >>> 0
	}

	const picked: string[] = []
	const taken = new Set<number>()
	while (picked.length < Math.min(count, pool.length)) {
		h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0
		const index = h % pool.length
		if (taken.has(index)) {
			// Probe forward rather than re-rolling, so a collision cannot loop.
			let next = (index + 1) % pool.length
			while (taken.has(next)) next = (next + 1) % pool.length
			taken.add(next)
			picked.push(pool[next])
			continue
		}
		taken.add(index)
		picked.push(pool[index])
	}
	return picked
}
