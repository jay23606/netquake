/**
 * File: g_utils.ts
 * Source: Quake II original / game/g_utils.c
 * Purpose: Port the first gameplay utility routines required by Quake II door and trigger target resolution.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Searches by field name instead of C struct field offsets.
 * - Uses an explicit runtime object for entity storage, time and logging.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

import { AngleVectors, ATTN_NORM, CHAN_AUTO, MASK_PLAYERSOLID, Q_stricmp, VectorCompare, vec3_origin, type trace_t, type vec3_t } from "../../qcommon/src/index.js";
import {
  DEAD_DEAD,
  SVF_MONSTER,
  Think_Delay,
  emitGameCenterprint,
  emitRegisteredGameSound,
  freeGameEntity,
  getRuntimeEntityLabel,
  unlinkGameEntity,
  registerGameSound,
  spawnGameEntity
} from "./runtime.js";
import type {
  GameEntity,
  GameEntityFieldName,
  GameRuntime
} from "./runtime.js";

const TV_POOL_SIZE = 8;
const tvPool: vec3_t[] = Array.from({ length: TV_POOL_SIZE }, () => [0, 0, 0]);
let tvIndex = 0;

const VTOS_POOL_SIZE = 8;
const vtosPool: string[] = new Array<string>(VTOS_POOL_SIZE).fill("(0 0 0)");
let vtosIndex = 0;

// Local mirrors of g_local.h macros avoid an ESM cycle through g_local -> runtime -> g_utils.
const BODY_QUEUE_SIZE = 8;
const TAG_LEVEL = 766;
const MOD_TELEFRAG = 21;
const MAXCHOICES = 8;
const VEC_UP: vec3_t = [0, -1, 0];
const MOVEDIR_UP: vec3_t = [0, 0, 1];
const VEC_DOWN: vec3_t = [0, -2, 0];
const MOVEDIR_DOWN: vec3_t = [0, 0, -1];

/**
 * Original name: G_ProjectSource
 * Source: game/g_utils.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Projects a local weapon/effect offset onto world space using forward/right basis vectors.
 *
 * Porting notes:
 * - Returns the projected vector instead of mutating the C `result` output parameter.
 */
export function G_ProjectSource(point: vec3_t, distance: vec3_t, forward: vec3_t, right: vec3_t): vec3_t {
  return [
    point[0] + forward[0] * distance[0] + right[0] * distance[1],
    point[1] + forward[1] * distance[0] + right[1] * distance[1],
    point[2] + forward[2] * distance[0] + right[2] * distance[1] + distance[2]
  ];
}

/**
 * Original name: G_Find
 * Source: game/g_utils.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Searches active entities beginning just after `from` for the next matching string field.
 *
 * Porting notes:
 * - Uses named fields instead of `FOFS(...)` byte offsets.
 */
export function G_Find(
  runtime: GameRuntime,
  from: GameEntity | null,
  field: GameEntityFieldName,
  match: string
): GameEntity | null {
  let index = from ? from.index + 1 : 0;

  for (; index < runtime.entities.length; index += 1) {
    const candidate = runtime.entities[index];
    if (!candidate) {
      continue;
    }
    if (!candidate.inuse) {
      continue;
    }

    const value = candidate[field];
    if (typeof value !== "string") {
      continue;
    }

    if (equalsIgnoreCase(value, match)) {
      return candidate;
    }
  }

  return null;
}

/**
 * Original name: G_PickTarget
 * Source: game/g_utils.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Chooses one matching target entity by `targetname`, limited to the original maximum choice buffer size.
 *
 * Porting notes:
 * - `MAXCHOICES` preserves the C fixed-size local choice buffer.
 * - Uses a bounded JS random index for C `rand() % num_choices`; this is an integer
 *   RNG use, not the `g_local.h` floating `random()`/`crandom()` macros.
 */
export function G_PickTarget(runtime: GameRuntime, targetname: string | undefined | null): GameEntity | null {
  if (targetname === undefined || targetname === null) {
    runtime.log({
      kind: "warning",
      message: "G_PickTarget called with NULL targetname"
    });
    return null;
  }

  const choices: GameEntity[] = [];
  let ent: GameEntity | null = null;

  while ((ent = G_Find(runtime, ent, "targetname", targetname)) !== null) {
    choices.push(ent);
    if (choices.length === MAXCHOICES) {
      break;
    }
  }

  if (choices.length === 0) {
    runtime.log({
      kind: "warning",
      message: `G_PickTarget: target ${targetname} not found`
    });
    return null;
  }

  return choices[Math.floor(Math.random() * choices.length)] ?? null;
}

/**
 * Original name: G_UseTargets
 * Source: game/g_utils.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Fires `message`, `killtarget` and `target` chains from one activating entity.
 *
 * Porting notes:
 * - Uses runtime adapters for `gi.centerprintf`, `gi.sound` and `gi.soundindex`.
 * - Keeps delayed use through a temporary entity matching the original `DelayedUse` shape.
 */
export function G_UseTargets(runtime: GameRuntime, ent: GameEntity, activator: GameEntity | null): void {
  runtime.log({
    kind: "use-targets",
    message: `${getRuntimeEntityLabel(ent)} G_UseTargets activator=${getRuntimeEntityLabel(activator)}`,
    entityIndex: ent.index,
    entityClassname: ent.classname,
    otherIndex: activator?.index,
    otherClassname: activator?.classname
  });

  if (ent.delay) {
    const delayed = spawnGameEntity(runtime);
    delayed.classname = "DelayedUse";
    delayed.nextthink = runtime.time + ent.delay;
    delayed.think = Think_Delay;
    delayed.activator = activator;
    delayed.message = ent.message;
    delayed.target = ent.target;
    delayed.killtarget = ent.killtarget;

    if (!activator) {
      runtime.log({
        kind: "warning",
        message: "Think_Delay with no activator",
        entityIndex: ent.index,
        entityClassname: ent.classname
      });
    }

    runtime.log({
      kind: "delay-scheduled",
      message: `${getRuntimeEntityLabel(ent)} scheduled delayed use at ${delayed.nextthink.toFixed(3)}`,
      entityIndex: ent.index,
      entityClassname: ent.classname
    });
    return;
  }

  if (ent.message && activator && (activator.svflags & SVF_MONSTER) === 0) {
    runtime.log({
      kind: "message",
      message: `${getRuntimeEntityLabel(ent)} message -> ${getRuntimeEntityLabel(activator)} :: ${ent.message}`,
      entityIndex: ent.index,
      entityClassname: ent.classname,
      otherIndex: activator.index,
      otherClassname: activator.classname
    });
    emitGameCenterprint(runtime, activator, ent.message);
    const soundIndex = ent.noise_index || registerGameSound(runtime, "misc/talk1.wav");
    const soundPath = runtime.assets.soundPaths[soundIndex - 1] ?? "misc/talk1.wav";
    emitRegisteredGameSound(runtime, activator, soundIndex, soundPath, {
      channel: CHAN_AUTO,
      volume: 1,
      attenuation: ATTN_NORM,
      timeofs: 0
    });
  }

  if (ent.killtarget) {
    let target: GameEntity | null = null;

    while ((target = G_Find(runtime, target, "targetname", ent.killtarget)) !== null) {
      runtime.log({
        kind: "killtarget",
        message: `${getRuntimeEntityLabel(ent)} killtarget -> ${getRuntimeEntityLabel(target)}`,
        entityIndex: ent.index,
        entityClassname: ent.classname,
        otherIndex: target.index,
        otherClassname: target.classname
      });
      freeGameEntity(runtime, target);

      if (!ent.inuse) {
        runtime.log({
          kind: "warning",
          message: "entity was removed while using killtargets",
          entityIndex: ent.index,
          entityClassname: ent.classname
        });
        return;
      }
    }
  }

  if (!ent.target) {
    return;
  }

  let target: GameEntity | null = null;
  while ((target = G_Find(runtime, target, "targetname", ent.target)) !== null) {
    if (
      equalsIgnoreCase(target.classname, "func_areaportal") &&
      (equalsIgnoreCase(ent.classname, "func_door") || equalsIgnoreCase(ent.classname, "func_door_rotating"))
    ) {
      continue;
    }

    runtime.log({
      kind: "fire-target",
      message: `${getRuntimeEntityLabel(ent)} target -> ${getRuntimeEntityLabel(target)}`,
      entityIndex: ent.index,
      entityClassname: ent.classname,
      otherIndex: target.index,
      otherClassname: target.classname
    });

    if (target === ent) {
      runtime.log({
        kind: "warning",
        message: "WARNING: Entity used itself.",
        entityIndex: ent.index,
        entityClassname: ent.classname
      });
    } else if (target.use) {
      target.use(target, ent, activator, runtime);
    }

    if (!ent.inuse) {
      runtime.log({
        kind: "warning",
        message: "entity was removed while using targets",
        entityIndex: ent.index,
        entityClassname: ent.classname
      });
      return;
    }
  }
}

/**
 * Original name: findradius
 * Source: game/g_utils.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns successive active solid entities whose origins lie within the requested spherical radius.
 *
 * Porting notes:
 * - Preserves the original `from` restart semantics instead of returning a prebuilt list.
 */
export function findradius(
  runtime: GameRuntime,
  from: GameEntity | null,
  origin: [number, number, number],
  radius: number
): GameEntity | null {
  let index = from ? from.index + 1 : 0;

  for (; index < runtime.entities.length; index += 1) {
    const entity = runtime.entities[index];
    if (!entity) {
      continue;
    }
    if (!entity.inuse) {
      continue;
    }
    if (entity.solid === 0) {
      continue;
    }

    const eorg: [number, number, number] = [
      origin[0] - (entity.s.origin[0] + (entity.mins[0] + entity.maxs[0]) * 0.5),
      origin[1] - (entity.s.origin[1] + (entity.mins[1] + entity.maxs[1]) * 0.5),
      origin[2] - (entity.s.origin[2] + (entity.mins[2] + entity.maxs[2]) * 0.5)
    ];
    if (vectorLength(eorg) > radius) {
      continue;
    }

    return entity;
  }

  return null;
}

/**
 * Original name: tv
 * Source: game/g_utils.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns one temporary vector from the original rotating static pool.
 *
 * Porting notes:
 * - `tvIndex` models the original function-local static `index`; vector objects are reused after 8 calls.
 */
export function tv(x: number, y: number, z: number): vec3_t {
  const value = tvPool[tvIndex];
  tvIndex = (tvIndex + 1) & (TV_POOL_SIZE - 1);
  value[0] = x;
  value[1] = y;
  value[2] = z;
  return value;
}

/**
 * Original name: vtos
 * Source: game/g_utils.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns one temporary formatted string from the original rotating static pool.
 *
 * Porting notes:
 * - `vtosIndex` models the original function-local static `index`; `value` is the TS equivalent of local `s`.
 */
export function vtos(v: vec3_t): string {
  const value = `(${Math.trunc(v[0])} ${Math.trunc(v[1])} ${Math.trunc(v[2])})`;
  vtosPool[vtosIndex] = value;
  const result = vtosPool[vtosIndex];
  vtosIndex = (vtosIndex + 1) & (VTOS_POOL_SIZE - 1);
  return result;
}

/**
 * Original name: G_SetMovedir
 * Source: game/g_utils.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Converts editor move-angle sentinels into one normalized movement direction and clears the source angles.
 */
export function G_SetMovedir(angles: vec3_t, movedir: vec3_t): void {
  if (VectorCompare(angles, VEC_UP)) {
    movedir[0] = MOVEDIR_UP[0];
    movedir[1] = MOVEDIR_UP[1];
    movedir[2] = MOVEDIR_UP[2];
  } else if (VectorCompare(angles, VEC_DOWN)) {
    movedir[0] = MOVEDIR_DOWN[0];
    movedir[1] = MOVEDIR_DOWN[1];
    movedir[2] = MOVEDIR_DOWN[2];
  } else {
    const vectors = AngleVectors(angles);
    movedir[0] = vectors.forward[0];
    movedir[1] = vectors.forward[1];
    movedir[2] = vectors.forward[2];
  }

  angles[0] = 0;
  angles[1] = 0;
  angles[2] = 0;
}

/**
 * Original name: vectoyaw
 * Source: game/g_utils.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Converts one direction vector into the original Quake II yaw-only angle.
 *
 * Porting notes:
 * - The C local `yaw` is represented by the local `yaw` variable below.
 * - Uses `Math.trunc` to match the original C cast to `int` before returning.
 */
export function vectoyaw(vec: vec3_t): number {
  let yaw: number;

  if (vec[0] === 0) {
    yaw = 0;
    if (vec[1] > 0) {
      yaw = 90;
    } else if (vec[1] < 0) {
      yaw = -90;
    }
  } else {
    yaw = Math.trunc(Math.atan2(vec[1], vec[0]) * 180 / Math.PI);
    if (yaw < 0) {
      yaw += 360;
    }
  }

  return yaw;
}

/**
 * Original name: vectoangles
 * Source: game/g_utils.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Converts one direction vector into Quake II pitch/yaw/roll angles.
 *
 * Porting notes:
 * - The C locals `forward`, `pitch`, and `yaw` are represented by the local
 *   variables below.
 * - Uses `Math.trunc` to match the original C casts to `int` before wrapping.
 */
export function vectoangles(value1: vec3_t): vec3_t {
  let forward: number;
  let yaw: number;
  let pitch: number;

  if (value1[1] === 0 && value1[0] === 0) {
    yaw = 0;
    pitch = value1[2] > 0 ? 90 : 270;
  } else {
    if (value1[0] !== 0) {
      yaw = Math.trunc(Math.atan2(value1[1], value1[0]) * 180 / Math.PI);
    } else if (value1[1] > 0) {
      yaw = 90;
    } else {
      yaw = -90;
    }
    if (yaw < 0) {
      yaw += 360;
    }

    forward = Math.sqrt(value1[0] * value1[0] + value1[1] * value1[1]);
    pitch = Math.trunc(Math.atan2(value1[2], forward) * 180 / Math.PI);
    if (pitch < 0) {
      pitch += 360;
    }
  }

  return [-pitch, yaw, 0];
}

/**
 * Original name: G_CopyString
 * Source: game/g_utils.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Allocates and returns one level-tagged copy of the provided string.
 *
 * Porting notes:
 * - Strings are immutable in JS, so the copy is modeled as a new equivalent string value.
 * - The C local `out` is represented by the returned string expression; `TAG_LEVEL`
 *   is kept referenced to document the original allocation tag.
 */
export function G_CopyString(inValue: string): string {
  void TAG_LEVEL;
  return (` ${inValue}`).slice(1);
}

/**
 * Original name: G_InitEdict
 * Source: game/g_utils.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Reinitializes one edict slot to the gameplay defaults expected by later allocation paths.
 *
 * Porting notes:
 * - Matches the original narrow mutation set; full slot clearing is handled by
 *   `freeGameEntity`/allocation before this initializer is called.
 */
export function G_InitEdict(entity: GameEntity): void {
  entity.inuse = true;
  entity.classname = "noclass";
  entity.gravity = 1.0;
  entity.s.number = entity.index;
}

/**
 * Original name: G_Spawn
 * Source: game/g_utils.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Reuses one eligible freed edict when possible, otherwise allocates a new runtime entity.
 *
 * Porting notes:
 * - `runtime.entities.length` is the ported `globals.num_edicts`; new slots are appended through
 *   `spawnGameEntity` only after the C reuse scan fails.
 */
export function G_Spawn(runtime: GameRuntime): GameEntity {
  const startIndex = runtime.maxclients + 1;

  for (let index = startIndex; index < runtime.entities.length; index += 1) {
    const entity = runtime.entities[index];
    if (!entity) {
      continue;
    }
    if (entity.inuse) {
      continue;
    }
    if (!(entity.freetime < 2 || (runtime.time - entity.freetime) > 0.5)) {
      continue;
    }

    G_InitEdict(entity);
    return entity;
  }

  if (runtime.entities.length >= runtime.maxentities) {
    throw new Error("ED_Alloc: no free edicts");
  }

  const entity = spawnGameEntity(runtime);
  G_InitEdict(entity);
  return entity;
}

/**
 * Original name: G_FreeEdict
 * Source: game/g_utils.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Frees one gameplay edict unless it is part of the protected special-edict prefix.
 * - Always unlinks the edict from the runtime world before applying the protected-slot guard.
 */
export function G_FreeEdict(runtime: GameRuntime, entity: GameEntity): void {
  unlinkGameEntity(runtime, entity);

  if (entity.index <= (runtime.maxclients + BODY_QUEUE_SIZE)) {
    return;
  }

  freeGameEntity(runtime, entity);
}

/**
 * Original name: KillBox
 * Source: game/g_utils.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Repeatedly telefrags blocking entities at the proposed destination until the space is clear or one blocker survives.
 * - Traces from `ent.s.origin` to itself with the entity bounds, no pass entity, and `MASK_PLAYERSOLID`.
 *
 * Porting notes:
 * - Applies the telefrag damage path locally to avoid a runtime import cycle with `g_combat.ts`.
 * - The local damage adapter preserves the `KillBox` contract used by callers: killed blockers clear `solid`; surviving blockers fail the placement.
 */
export function KillBox(runtime: GameRuntime, ent: GameEntity): boolean {
  if (!runtime.collision) {
    return true;
  }

  const touched = new Set<GameEntity>();
  while (true) {
    const tr: trace_t = runtime.collision.trace(ent.s.origin, ent.mins, ent.maxs, ent.s.origin, null, MASK_PLAYERSOLID);
    if (!tr.ent) {
      break;
    }

    const blocker = tr.ent as GameEntity;
    if (touched.has(blocker)) {
      return blocker.solid === 0;
    }

    touched.add(blocker);
    applyTelefragDamage(blocker, ent, runtime);

    if (blocker.solid) {
      return false;
    }
  }

  return true;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Compare two game strings through the original Quake II case-insensitive comparator.
 */
function equalsIgnoreCase(left: string, right: string): boolean {
  return Q_stricmp(left, right) === 0;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Compute one vector length for the strict `findradius` port.
 */
function vectorLength(vector: [number, number, number]): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Apply the local telefrag damage effect used by the `KillBox` port without pulling in the full combat module at runtime.
 *
 * Constraints:
 * - Must preserve the practical `KillBox` contract: blockers that survive keep `solid`, blockers that die clear it.
 * - Mirrors the original call shape `T_Damage(blocker, ent, ent, vec3_origin, ent.s.origin, vec3_origin, 100000, 0, DAMAGE_NO_PROTECTION, MOD_TELEFRAG)` at the level required by `KillBox`.
 */
function applyTelefragDamage(target: GameEntity, attacker: GameEntity, runtime: GameRuntime): void {
  target.pain?.(target, attacker, 0, 100000, runtime);

  if (target.health > 0) {
    target.health -= 100000;
  }

  if (target.health <= 0) {
    target.solid = 0;
    target.deadflag = DEAD_DEAD;
    target.die?.(target, attacker, attacker, 100000, runtime);
    return;
  }

  void vec3_origin;
  void MOD_TELEFRAG;
}
