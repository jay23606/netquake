/**
 * Original name: N/A
 * Source: N/A (demo-data asset substitution)
 * Category: New
 * Purpose: Draw other players when only the Quake II demo data is mounted.
 *
 * The demo pak ships no `players/` entries at all, so an opponent's model
 * cannot be loaded and the entity is silently skipped. We substitute a monster
 * model the demo pak does contain. That alone makes opponents visible, but the
 * server still sends frame numbers from the *player* animation table, and those
 * indices mean something entirely different in a monster model -- a dead player
 * lands on whatever the soldier happens to keep at frame 178 (a mid-stride walk
 * pose), so corpses stand around looking alive.
 *
 * This module maps player animation ranges onto the substitute's equivalents.
 * Frame tables below were read out of the shipped demo pak0.pak MD2 headers,
 * not guessed: names live at `ofs_frames + i * framesize + 24`, 16 bytes each.
 */

/** Substitute drawn in place of a player model the mounted data lacks. */
export const PLAYER_MODEL_FALLBACK = "models/monsters/soldier/tris.md2";

interface AnimationMap {
  /** Inclusive player frame range, from `m_player.ts` FRAME_* constants. */
  readonly player: readonly [number, number];
  /** Inclusive substitute frame range. */
  readonly substitute: readonly [number, number];
}

/**
 * models/monsters/soldier/tris.md2 (475 frames):
 *   attak1[0-11] attak2[12-29] attak3[30-38] attak4[39-44] duck[45-49]
 *   pain1[50-54] pain2[55-61] pain3[62-79] pain4[80-96] run[97-108]
 *   runs[109-126] runt[127-145] stand1[146-175] stand3[176-214]
 *   walk1[215-247] walk2[248-271] death1[272-307] death2[308-342]
 *   death3[343-387] death4[388-440] death5[441-464] death6[465-474]
 *
 * The player model has 198 frames; anything at or past that is clamped to a
 * standing pose rather than left to index past the end of the table.
 */
const SOLDIER_FRAME_MAP: readonly AnimationMap[] = [
  { player: [0, 39], substitute: [146, 175] }, // stand
  { player: [40, 45], substitute: [97, 108] }, // run
  { player: [46, 53], substitute: [0, 11] }, // attack
  { player: [54, 57], substitute: [50, 54] }, // pain1
  { player: [58, 61], substitute: [55, 61] }, // pain2
  { player: [62, 65], substitute: [62, 79] }, // pain3
  { player: [66, 71], substitute: [97, 108] }, // jump -- no equivalent, run reads best
  { player: [72, 134], substitute: [146, 175] }, // flip/salute/taunt/wave/point
  { player: [135, 153], substitute: [45, 49] }, // crstnd
  { player: [154, 159], substitute: [45, 49] }, // crwalk
  { player: [160, 168], substitute: [0, 11] }, // crattak
  { player: [169, 172], substitute: [50, 54] }, // crpain
  { player: [173, 177], substitute: [272, 307] }, // crdeath
  { player: [178, 183], substitute: [272, 307] }, // death1
  { player: [184, 189], substitute: [308, 342] }, // death2
  { player: [190, 197], substitute: [343, 387] } // death3
];

const SUBSTITUTE_FRAME_MAPS: ReadonlyMap<string, readonly AnimationMap[]> = new Map([
  [PLAYER_MODEL_FALLBACK, SOLDIER_FRAME_MAP]
]);

const DEFAULT_SUBSTITUTE_FRAME = 146; // soldier stand1, first frame

/**
 * Scales a frame proportionally from the player range onto the substitute's.
 * Proportional rather than clamped so that the *last* player frame always
 * lands on the *last* substitute frame: death animations hold their final
 * frame indefinitely, so that endpoint is the pose a corpse keeps.
 */
export function remapPlayerFrameToSubstitute(substitutePath: string, frame: number): number {
  const map = SUBSTITUTE_FRAME_MAPS.get(substitutePath.toLowerCase());
  if (!map) return frame;

  for (const entry of map) {
    const [playerStart, playerEnd] = entry.player;
    if (frame < playerStart || frame > playerEnd) continue;
    const [start, end] = entry.substitute;
    const span = playerEnd - playerStart;
    if (span <= 0) return start;
    const progress = (frame - playerStart) / span;
    return start + Math.round(progress * (end - start));
  }

  return DEFAULT_SUBSTITUTE_FRAME;
}
