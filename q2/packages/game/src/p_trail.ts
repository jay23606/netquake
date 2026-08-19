/**
 * File: p_trail.ts
 * Source: Quake II original / game/p_trail.c
 * Purpose: Port of the player pursuit trail used by monsters to reacquire the player path.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - The original global trail storage lives on the explicit gameplay runtime instead of process globals.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

import type { vec3_t } from "../../qcommon/src/index.js";
import { visible } from "./g_ai.js";
import { vectoyaw } from "./g_utils.js";
import { spawnGameEntity } from "./runtime.js";
import type { GameEntity, GameRuntime } from "./runtime.js";

/**
 * Original name: TRAIL_LENGTH
 * Source: game/p_trail.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Size of the circular player trail marker list.
 */
export const TRAIL_LENGTH = 8;

/**
 * Original name: NEXT
 * Source: game/p_trail.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Advances an index in the power-of-two trail ring.
 */
function NEXT(n: number): number {
  return (n + 1) & (TRAIL_LENGTH - 1);
}

/**
 * Original name: PREV
 * Source: game/p_trail.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Moves an index backward in the power-of-two trail ring.
 */
function PREV(n: number): number {
  return (n - 1) & (TRAIL_LENGTH - 1);
}

/**
 * Original name: PlayerTrail_Init
 * Source: game/p_trail.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes the circular list of player-trail markers unless deathmatch is active.
 *
 * Porting notes:
 * - Stores the trail state on `runtime.playerTrail`.
 */
export function PlayerTrail_Init(runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    return;
  }

  runtime.playerTrail.trail = [];

  for (let n = 0; n < TRAIL_LENGTH; n += 1) {
    const marker = spawnGameEntity(runtime);
    marker.classname = "player_trail";
    runtime.playerTrail.trail.push(marker);
  }

  runtime.playerTrail.trail_head = 0;
  runtime.playerTrail.trail_active = true;
}

/**
 * Original name: PlayerTrail_Add
 * Source: game/p_trail.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Stores one new player trail point at the current trail head and advances the circular list.
 */
export function PlayerTrail_Add(runtime: GameRuntime, spot: vec3_t): void {
  if (!runtime.playerTrail.trail_active) {
    return;
  }

  const marker = runtime.playerTrail.trail[runtime.playerTrail.trail_head];
  const previousMarker = runtime.playerTrail.trail[PREV(runtime.playerTrail.trail_head)];
  if (!marker || !previousMarker) {
    return;
  }

  marker.s.origin = [...spot];
  marker.origin = [...spot];
  marker.timestamp = runtime.time;

  const temp: vec3_t = [
    spot[0] - previousMarker.s.origin[0],
    spot[1] - previousMarker.s.origin[1],
    spot[2] - previousMarker.s.origin[2]
  ];
  marker.s.angles[1] = vectoyaw(temp);
  marker.angles[1] = marker.s.angles[1];

  runtime.playerTrail.trail_head = NEXT(runtime.playerTrail.trail_head);
}

/**
 * Original name: PlayerTrail_New
 * Source: game/p_trail.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Reinitializes the player trail and seeds it with one first spot.
 */
export function PlayerTrail_New(runtime: GameRuntime, spot: vec3_t): void {
  if (!runtime.playerTrail.trail_active) {
    return;
  }

  PlayerTrail_Init(runtime);
  PlayerTrail_Add(runtime, spot);
}

/**
 * Original name: PlayerTrail_PickFirst
 * Source: game/p_trail.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns the first suitable player-trail marker newer than `self->monsterinfo.trail_time`.
 *
 */
export function PlayerTrail_PickFirst(self: GameEntity, runtime: GameRuntime): GameEntity | null {
  if (!runtime.playerTrail.trail_active) {
    return null;
  }

  let marker = runtime.playerTrail.trail_head;

  for (let n = TRAIL_LENGTH; n > 0; n -= 1) {
    const trailMarker = runtime.playerTrail.trail[marker];
    if (trailMarker && trailMarker.timestamp <= self.monsterinfo.trail_time) {
      marker = NEXT(marker);
    } else {
      break;
    }
  }

  const currentMarker = runtime.playerTrail.trail[marker];
  if (!currentMarker) {
    return null;
  }

  if (visible(self, currentMarker, runtime)) {
    return currentMarker;
  }

  const previousMarker = runtime.playerTrail.trail[PREV(marker)];
  if (previousMarker && visible(self, previousMarker, runtime)) {
    return previousMarker;
  }

  return currentMarker;
}

/**
 * Original name: PlayerTrail_PickNext
 * Source: game/p_trail.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns the next trail marker newer than `self->monsterinfo.trail_time`.
 */
export function PlayerTrail_PickNext(self: GameEntity, runtime: GameRuntime): GameEntity | null {
  if (!runtime.playerTrail.trail_active) {
    return null;
  }

  let marker = runtime.playerTrail.trail_head;

  for (let n = TRAIL_LENGTH; n > 0; n -= 1) {
    const trailMarker = runtime.playerTrail.trail[marker];
    if (trailMarker && trailMarker.timestamp <= self.monsterinfo.trail_time) {
      marker = NEXT(marker);
    } else {
      break;
    }
  }

  return runtime.playerTrail.trail[marker] ?? null;
}

/**
 * Original name: PlayerTrail_LastSpot
 * Source: game/p_trail.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns the most recently written player-trail marker.
 */
export function PlayerTrail_LastSpot(runtime: GameRuntime): GameEntity | null {
  return runtime.playerTrail.trail[PREV(runtime.playerTrail.trail_head)] ?? null;
}
