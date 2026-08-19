/**
 * File: m_boss3.ts
 * Source: Quake II original / game/m_boss3.c
 * Purpose: Port of the dormant boss3 stand-in entity used before the Makron teleport sequence.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses the explicit gameplay runtime event queue instead of direct `gi.Write*` / `gi.multicast` calls.
 *
 * Notes:
 * - Frame constants are imported from the `m_boss32.c` principal port because the C source includes `m_boss32.h`.
 */

import { multicast_t, temp_event_t } from "../../qcommon/src/index.js";
import { FRAMETIME, MOVETYPE_STEP, SOLID_BBOX } from "./g_local.js";
import { G_FreeEdict } from "./g_utils.js";
import {
  emitGameTempEntity,
  linkGameEntity,
  registerGameModel,
  registerGameSound,
  type GameEntity,
  type GameRuntime
} from "./runtime.js";
import { FRAME_stand201, FRAME_stand260 } from "./m_boss32.js";

/**
 * Original name: N/A
 * Source: N/A (asset path constant)
 * Category: New
 * Purpose: Name the boss3 stand-in rider model path assigned by `SP_monster_boss3_stand`.
 */
const MODEL_BOSS3_RIDER = "models/monsters/boss3/rider/tris.md2";
/**
 * Original name: N/A
 * Source: N/A (asset path constant)
 * Category: New
 * Purpose: Name the boss3 teleport sound path precached by `SP_monster_boss3_stand`.
 */
const SOUND_BIG_TELEPORT = "misc/bigtele.wav";

/**
 * Original name: Use_Boss3
 * Source: game/m_boss3.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the boss teleport temp entity at the stand-in origin and frees the edict.
 */
export function Use_Boss3(
  ent: GameEntity,
  _other: GameEntity | null,
  _activator: GameEntity | null,
  runtime: GameRuntime
): void {
  emitGameTempEntity(runtime, temp_event_t.TE_BOSSTPORT, ent.s.origin, multicast_t.MULTICAST_PVS);
  G_FreeEdict(runtime, ent);
}

/**
 * Original name: Think_Boss3Stand
 * Source: game/m_boss3.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Cycles frames `FRAME_stand201..FRAME_stand260` and schedules the next frame tick.
 */
export function Think_Boss3Stand(ent: GameEntity, runtime: GameRuntime): void {
  if (ent.s.frame === FRAME_stand260) {
    ent.s.frame = FRAME_stand201;
  } else {
    ent.s.frame += 1;
  }
  ent.nextthink = runtime.time + FRAMETIME;
}

/**
 * Original name: SP_monster_boss3_stand
 * Source: game/m_boss3.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns the static boss3 rider stand-in, precaches its teleport sound and starts the idle frame loop.
 */
export function SP_monster_boss3_stand(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  self.movetype = MOVETYPE_STEP;
  self.solid = SOLID_BBOX;
  self.model = MODEL_BOSS3_RIDER;
  self.s.modelindex = registerGameModel(runtime, self.model);
  self.s.frame = FRAME_stand201;

  registerGameSound(runtime, SOUND_BIG_TELEPORT);

  setVec3(self.mins, -32, -32, 0);
  setVec3(self.maxs, 32, 32, 90);

  self.use = Use_Boss3;
  self.think = Think_Boss3Stand;
  self.nextthink = runtime.time + FRAMETIME;
  linkGameEntity(runtime, self);
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Local `VectorSet` equivalent for mutable entity bounds.
 */
function setVec3(vector: [number, number, number], x: number, y: number, z: number): void {
  vector[0] = x;
  vector[1] = y;
  vector[2] = z;
}
