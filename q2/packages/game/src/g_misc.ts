/**
 * File: g_misc.ts
 * Source: Quake II original / game/g_misc.c
 * Purpose: Port of `game/g_misc.c` world helpers, decorative entities and specialty gameplay spawns.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Temp-entity multicast/configstring side effects are queued through runtime state instead of a live server import table.
 * - Movement-driven specialty spawns (`misc_viper`, `misc_strogg_ship`) delegate train setup/use to the `g_func` port.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

import {
  AngleVectors,
  ATTN_NORM,
  CHAN_BODY,
  CHAN_VOICE,
  CM_SetAreaPortalState,
  CS_LIGHTS,
  EF_ANIM_ALL,
  EF_ANIM_ALLFAST,
  EF_FLIES,
  EF_GIB,
  EF_ROCKET,
  EF_TELEPORTER,
  MASK_MONSTERSOLID,
  PMF_TIME_TELEPORT,
  RF_FRAMELERP,
  RF_TRANSLUCENT,
  entity_event_t,
  multicast_t,
  temp_event_t,
  type cplane_t,
  type vec3_t
} from "../../qcommon/src/index.js";
import {
  AI_COMBAT_POINT,
  AI_GOOD_GUY,
  AI_NOSTEP,
  AI_STAND_GROUND,
  DEAD_DEAD,
  FL_FLY,
  FL_GODMODE,
  FL_NO_KNOCKBACK,
  FL_SWIM,
  GIB_ORGANIC,
  MOD_BARREL,
  MOD_BOMB,
  MOD_CRUSH,
  MOD_EXPLOSIVE,
  MOVETYPE_BOUNCE,
  MOVETYPE_STEP,
  SOLID_BBOX,
  SVF_DEADMONSTER,
  crandom,
  damage_t,
  random
} from "./g_local.js";
import {
  FRAMETIME,
  MOVETYPE_NONE,
  MOVETYPE_PUSH,
  MOVETYPE_TOSS,
  SOLID_BSP,
  SOLID_NOT,
  SOLID_TRIGGER,
  SVF_NOCLIENT,
  SVF_MONSTER,
  useGameEntity,
  linkGameEntity,
  refreshEntitySpatialState,
  registerGameModel,
  registerGameSound,
  setGameEntityModel,
  spawnGameEntity,
  emitGameTempEntity,
  emitRegisteredGameSound,
  setGameConfigstring,
  unlinkGameEntity,
  type GameEntity,
  type GameRuntime
} from "./runtime.js";
import { T_Damage, T_RadiusDamage } from "./g_combat.js";
import { func_train_find, train_use } from "./g_func.js";
import { M_droptofloor } from "./g_monster.js";
import { M_walkmove } from "./m_move.js";
import { G_Find, G_FreeEdict, G_PickTarget, G_Spawn, G_UseTargets, KillBox, vectoyaw, vectoangles, vtos } from "./g_utils.js";

const START_OFF = 1;
const CLOCK_MESSAGE_SIZE = 16;

/**
 * Original name: N/A
 * Source declaree: N/A (local think adapter)
 * Category: New
 *
 * Purpose:
 * - Adapts `G_FreeEdict` to the runtime think-callback signature used by local entity cleanup.
 */
function freeEdictThink(self: GameEntity, runtime: GameRuntime): void {
  G_FreeEdict(runtime, self);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local numeric helper)
 * Category: New
 *
 * Purpose:
 * - Keeps local clamp call sites compact while preserving their source branch bounds.
 */
function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local immutable vector helper)
 * Category: New
 *
 * Purpose:
 * - Returns the sum of two vectors for local call sites that would mutate an out parameter in C.
 */
function addVec3(left: vec3_t, right: vec3_t): [number, number, number] {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local immutable vector helper)
 * Category: New
 *
 * Purpose:
 * - Returns the difference of two vectors for local call sites that would mutate an out parameter in C.
 */
function subVec3(left: vec3_t, right: vec3_t): [number, number, number] {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local immutable vector helper)
 * Category: New
 *
 * Purpose:
 * - Returns a scaled vector for local call sites that would use `VectorScale` with an out parameter in C.
 *
 * Constraints:
 * - The owning `VectorScale` port remains `packages/math/src/q_shared.ts`.
 */
function scaleVec3(vector: vec3_t, scalar: number): [number, number, number] {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local immutable vector helper)
 * Category: New
 *
 * Purpose:
 * - Computes a local vector length without mutating the input vector.
 */
function vecLength(vector: vec3_t): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local immutable vector helper)
 * Category: New
 *
 * Purpose:
 * - Returns a normalized vector for local call sites that need a copied result.
 */
function normalizeVec3(vector: vec3_t): [number, number, number] {
  const length = vecLength(vector);
  if (length === 0) {
    return [0, 0, 0];
  }

  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local entity helper)
 * Category: New
 *
 * Purpose:
 * - Keeps gameplay origin and network origin fields synchronized after local position changes.
 */
function setEntityOrigin(self: GameEntity, origin: vec3_t): void {
  self.origin = [...origin];
  self.s.origin = [...origin];
}

/**
 * Original name: VelocityForDamage
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Builds the randomized gib launch velocity and scales it by the source damage threshold.
 *
 * Porting notes:
 * - The C output vector is returned so callers can compose it without mutating an argument.
 */
function VelocityForDamage(damage: number): [number, number, number] {
  const v: [number, number, number] = [
    100.0 * crandom(),
    100.0 * crandom(),
    200.0 + 100.0 * random()
  ];

  const scale = damage < 50 ? 0.7 : 1.2;
  return scaleVec3(v, scale);
}

/**
 * Original name: ClipGibVelocity
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Clamps gib horizontal velocity to +/-300 and vertical velocity to the original 200..500 range.
 */
function ClipGibVelocity(ent: GameEntity): void {
  ent.velocity[0] = clamp(ent.velocity[0], -300, 300);
  ent.velocity[1] = clamp(ent.velocity[1], -300, 300);
  ent.velocity[2] = clamp(ent.velocity[2], 200, 500);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local entity lookup helper)
 * Category: New
 *
 * Purpose:
 * - Finds the first active entity with one classname for source flows that search by class.
 */
function findFirstByClassname(runtime: GameRuntime, classname: string): GameEntity | null {
  return runtime.entities.find((entity) => entity.inuse && entity.classname === classname) ?? null;
}

/**
 * Original name: Use_Areaportal
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Toggles the areaportal state and applies it to the collision area's portal table.
 *
 * Porting notes:
 * - The original `gi.SetAreaPortalState` call is mapped to `CM_SetAreaPortalState` through the runtime collision world.
 * - Harness runtimes without collision keep only the entity count/log side effects.
 */
export function Use_Areaportal(
  ent: GameEntity,
  _other: GameEntity | null,
  _activator: GameEntity | null,
  runtime: GameRuntime
): void {
  ent.count ^= 1;
  if (runtime.collision) {
    CM_SetAreaPortalState(runtime.collision.world, ent.style, ent.count !== 0);
  }
  runtime.log({
    kind: "use",
    message: `${ent.classname} style=${ent.style} portal=${ent.count}`,
    entityIndex: ent.index,
    entityClassname: ent.classname
  });
}

/**
 * Original name: SP_func_areaportal
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Installs the areaportal use callback and always starts the portal closed.
 *
 * Porting notes:
 * - `Use_Areaportal` updates the qcommon collision portal state when a collision world is attached.
 */
export function SP_func_areaportal(ent: GameEntity, _runtime: GameRuntime): void {
  ent.use = Use_Areaportal;
  ent.count = 0;
}

/**
 * Original name: gib_think
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Advances gib animation frames every server frame, then schedules entity cleanup after
 *   frame 10 using the original randomized delay.
 */
export function gib_think(self: GameEntity, runtime: GameRuntime): void {
  self.s.frame += 1;
  self.nextthink = runtime.time + FRAMETIME;
  if (self.s.frame === 10) {
    self.think = freeEdictThink;
    self.nextthink = runtime.time + 8 + (random() * 10);
  } else {
    self.think = gib_think;
  }
}

/**
 * Original name: gib_die
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Frees one gib entity when it is damaged after becoming damageable.
 */
export function gib_die(
  self: GameEntity,
  _inflictor: GameEntity | null,
  _attacker: GameEntity | null,
  _damage: number,
  runtime: GameRuntime
): void {
  G_FreeEdict(runtime, self);
}

/**
 * Original name: ThrowGib
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Spawns one gib inside the source entity bounds, assigns model/effects/damage callbacks,
 *   chooses organic toss vs metallic bounce behavior, then links it into the runtime.
 */
export function ThrowGib(self: GameEntity, gibname: string, damage: number, type: number, runtime: GameRuntime): void {
  const gib = G_Spawn(runtime);
  const halfSize = scaleVec3(self.size, 0.5);
  const origin = addVec3(self.absmin, halfSize);
  setEntityOrigin(gib, [
    origin[0] + crandom() * halfSize[0],
    origin[1] + crandom() * halfSize[1],
    origin[2] + crandom() * halfSize[2]
  ]);

  gib.model = gibname;
  gib.s.modelindex = registerGameModel(runtime, gibname);
  gib.solid = SOLID_NOT;
  gib.s.effects |= EF_GIB;
  gib.flags |= FL_NO_KNOCKBACK;
  gib.takedamage = damage_t.DAMAGE_YES;
  gib.die = gib_die;
  gib.movetype = type === GIB_ORGANIC ? MOVETYPE_TOSS : MOVETYPE_BOUNCE;
  gib.touch = type === GIB_ORGANIC ? gib_touch : undefined;

  const vscale = type === GIB_ORGANIC ? 0.5 : 1.0;
  const vd = VelocityForDamage(damage);
  gib.velocity = addVec3(self.velocity, scaleVec3(vd, vscale));
  gib.avelocity = [random() * 600, random() * 600, random() * 600];
  ClipGibVelocity(gib);
  gib.think = freeEdictThink;
  gib.nextthink = runtime.time + 10 + (random() * 10);
  refreshEntitySpatialState(gib);
  linkGameEntity(runtime, gib);
}

/**
 * Original name: gib_touch
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - When an organic gib lands on a traced plane, plays the flesh-hit sound, aligns the gib
 *   to the plane-derived right vector, and advances the small-meat animation.
 */
export function gib_touch(
  self: GameEntity,
  _other: GameEntity,
  runtime: GameRuntime,
  plane?: cplane_t | null
): void {
  if (!self.groundentity) {
    return;
  }

  self.touch = undefined;
  if (!plane) {
    return;
  }

  emitRegisteredGameSound(runtime, self, registerGameSound(runtime, "misc/fhit3.wav"), "misc/fhit3.wav", {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_NORM
  });

  const normalAngles = vectoangles(plane.normal);
  const { right } = AngleVectors(normalAngles);
  self.s.angles = vectoangles(right);

  const smMeatIndex = runtime.sm_meat_index || runtime.assets.modelIndexByPath.get("models/objects/gibs/sm_meat/tris.md2") || 0;
  if (self.s.modelindex === smMeatIndex || runtime.assets.modelPaths[self.s.modelindex - 1] === "models/objects/gibs/sm_meat/tris.md2") {
    self.s.frame += 1;
    self.think = gib_think;
    self.nextthink = runtime.time + FRAMETIME;
  }
}

/**
 * Original name: ThrowHead
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Converts the source entity itself into a flying gib head, clears monster/render state
 *   that should no longer survive death, applies organic/metallic movement and links it.
 */
export function ThrowHead(self: GameEntity, gibname: string, damage: number, type: number, runtime: GameRuntime): void {
  self.s.skinnum = 0;
  self.s.frame = 0;
  self.mins = [0, 0, 0];
  self.maxs = [0, 0, 0];
  self.s.modelindex2 = 0;
  self.model = gibname;
  self.s.modelindex = registerGameModel(runtime, gibname);
  self.solid = SOLID_NOT;
  self.s.effects |= EF_GIB;
  self.s.effects &= ~EF_FLIES;
  self.s.sound = 0;
  self.flags |= FL_NO_KNOCKBACK;
  self.svflags &= ~SVF_MONSTER;
  self.takedamage = damage_t.DAMAGE_YES;
  self.die = gib_die;
  self.movetype = type === GIB_ORGANIC ? MOVETYPE_TOSS : MOVETYPE_BOUNCE;
  self.touch = type === GIB_ORGANIC ? gib_touch : undefined;

  const vscale = type === GIB_ORGANIC ? 0.5 : 1.0;
  self.velocity = addVec3(self.velocity, scaleVec3(VelocityForDamage(damage), vscale));
  self.avelocity[1] = crandom() * 600;
  ClipGibVelocity(self);
  self.think = freeEdictThink;
  self.nextthink = runtime.time + 10 + (random() * 10);
  refreshEntitySpatialState(self);
  linkGameEntity(runtime, self);
}

/**
 * Original name: misc_deadsoldier_die
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Gibs a dead soldier body once health reaches the source gib threshold.
 *
 * Porting notes:
 * - Sound, gib and head side effects use the runtime adapters instead of `gi.sound` and direct edict allocation.
 */
export function misc_deadsoldier_die(
  self: GameEntity,
  _inflictor: GameEntity | null,
  _attacker: GameEntity | null,
  damage: number,
  runtime: GameRuntime
): void {
  if (self.health > -80) {
    return;
  }

  emitRegisteredGameSound(runtime, self, registerGameSound(runtime, "misc/udeath.wav"), "misc/udeath.wav", {
    channel: CHAN_BODY,
    volume: 1,
    attenuation: ATTN_NORM
  });
  for (let index = 0; index < 4; index += 1) {
    ThrowGib(self, "models/objects/gibs/sm_meat/tris.md2", damage, GIB_ORGANIC, runtime);
  }
  ThrowHead(self, "models/objects/gibs/head2/tris.md2", damage, GIB_ORGANIC, runtime);
}

/**
 * Original name: path_corner_touch
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Advances a monster to the next path corner, optionally firing pathtargets, teleporting through TELEPORT corners and pausing.
 *
 * Porting notes:
 * - Local C variables `v`, `next` and `savetarget` are represented as scoped TS values with the same side effects.
 */
export function path_corner_touch(self: GameEntity, other: GameEntity, runtime: GameRuntime): void {
  if (other.movetarget !== self || other.enemy) {
    return;
  }

  if (self.pathtarget) {
    const saveTarget = self.target;
    self.target = self.pathtarget;
    G_UseTargets(runtime, self, other);
    self.target = saveTarget;
  }

  let next = self.target ? G_PickTarget(runtime, self.target) : null;
  if (next && (next.spawnflags & 1) !== 0) {
    const teleportOrigin = [...next.s.origin] as vec3_t;
    teleportOrigin[2] += next.mins[2];
    teleportOrigin[2] -= other.mins[2];
    setEntityOrigin(other, teleportOrigin);
    next = next.target ? G_PickTarget(runtime, next.target) : null;
    other.s.event = entity_event_t.EV_OTHER_TELEPORT;
  }

  other.goalentity = next;
  other.movetarget = next;

  if (self.wait) {
    other.monsterinfo.pausetime = runtime.time + self.wait;
    other.monsterinfo.stand?.(other, runtime);
    return;
  }

  if (!other.movetarget) {
    other.monsterinfo.pausetime = runtime.time + 100000000;
    other.monsterinfo.stand?.(other, runtime);
    return;
  }

  other.ideal_yaw = vectoyaw(subVec3(other.goalentity!.s.origin, other.s.origin));
}

/**
 * Original name: SP_path_corner
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Spawns one no-client path trigger, or frees path corners missing the required targetname.
 *
 * Porting notes:
 * - Preserves the original warning side effect through the runtime log.
 */
export function SP_path_corner(self: GameEntity, runtime: GameRuntime): void {
  if (!self.targetname) {
    runtime.log({
      kind: "warning",
      message: `path_corner with no targetname at ${vtos(self.s.origin)}`,
      entityIndex: self.index,
      entityClassname: self.classname
    });
    G_FreeEdict(runtime, self);
    return;
  }

  self.solid = SOLID_TRIGGER;
  self.touch = path_corner_touch;
  self.mins = [-8, -8, -8];
  self.maxs = [8, 8, 8];
  self.svflags |= SVF_NOCLIENT;
  refreshEntitySpatialState(self);
  linkGameEntity(runtime, self);
}

/**
 * Original name: point_combat_touch
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Handles monster arrival at a combat point, including chained targets, hold points and pathtarget activation.
 *
 * Porting notes:
 * - Uses the runtime entity references in place of raw edict pointers while preserving branch order.
 */
export function point_combat_touch(self: GameEntity, other: GameEntity, runtime: GameRuntime): void {
  if (other.movetarget !== self) {
    return;
  }

  if (self.target) {
    other.target = self.target;
    other.goalentity = other.movetarget = G_PickTarget(runtime, other.target);
    if (!other.goalentity) {
      other.movetarget = self;
    }
    self.target = undefined;
  } else if ((self.spawnflags & 1) !== 0 && (other.flags & (FL_SWIM | FL_FLY)) === 0) {
    other.monsterinfo.pausetime = runtime.time + 100000000;
    other.monsterinfo.aiflags |= AI_STAND_GROUND;
    other.monsterinfo.stand?.(other, runtime);
  }

  if (other.movetarget === self) {
    other.target = undefined;
    other.movetarget = null;
    other.goalentity = other.enemy;
    other.monsterinfo.aiflags &= ~AI_COMBAT_POINT;
  }

  if (!self.pathtarget) {
    return;
  }

  const saveTarget = self.target;
  self.target = self.pathtarget;
  const activator = other.enemy?.client ? other.enemy : other.oldenemy?.client ? other.oldenemy : other.activator?.client ? other.activator : other;
  G_UseTargets(runtime, self, activator);
  self.target = saveTarget;
}

/**
 * Original name: SP_point_combat
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Spawns a non-client combat-point trigger or removes it from deathmatch games.
 *
 * Porting notes:
 * - Uses the runtime deathmatch flag and link adapter in place of `deathmatch->value` and `gi.linkentity`.
 */
export function SP_point_combat(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  self.solid = SOLID_TRIGGER;
  self.touch = point_combat_touch;
  self.mins = [-8, -8, -16];
  self.maxs = [8, 8, 16];
  self.svflags = SVF_NOCLIENT;
  refreshEntitySpatialState(self);
  linkGameEntity(runtime, self);
}

/**
 * Original name: TH_viewthing
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Advances the debug `viewthing` banner animation frame and schedules the next tick.
 */
export function TH_viewthing(ent: GameEntity, runtime: GameRuntime): void {
  ent.s.frame = (ent.s.frame + 1) % 7;
  ent.think = TH_viewthing;
  ent.nextthink = runtime.time + FRAMETIME;
}

/**
 * Original name: SP_viewthing
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Spawns the debug `viewthing` banner model with frame interpolation and the `TH_viewthing` think loop.
 *
 * Porting notes:
 * - Preserves the original `gi.dprintf` diagnostic through the runtime log.
 */
export function SP_viewthing(ent: GameEntity, runtime: GameRuntime): void {
  runtime.log({
    kind: "message",
    message: "viewthing spawned",
    entityIndex: ent.index,
    entityClassname: ent.classname
  });
  ent.movetype = MOVETYPE_NONE;
  ent.solid = SOLID_BBOX;
  ent.s.renderfx = RF_FRAMELERP;
  ent.mins = [-16, -16, -24];
  ent.maxs = [16, 16, 32];
  ent.s.modelindex = registerGameModel(runtime, "models/objects/banner/tris.md2");
  ent.nextthink = runtime.time + 0.5;
  ent.think = TH_viewthing;
  refreshEntitySpatialState(ent);
  linkGameEntity(runtime, ent);
}

/**
 * Original name: SP_info_null
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Frees a map-only positional marker after other entities have resolved its spawn data.
 */
export function SP_info_null(self: GameEntity, runtime: GameRuntime): void {
  G_FreeEdict(runtime, self);
}

/**
 * Original name: SP_info_notnull
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Keeps a non-solid positional marker by collapsing its absolute bounds to its origin.
 */
export function SP_info_notnull(self: GameEntity, _runtime: GameRuntime): void {
  self.absmin = [...self.s.origin];
  self.absmax = [...self.s.origin];
}

/**
 * Original name: light_use
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Toggles targeted lightstyles between off (`a`) and normal brightness (`m`).
 * - Mirrors the original `START_OFF` spawnflag state change around each configstring write.
 *
 * Porting notes:
 * - Engine `gi.configstring` writes are queued through the explicit gameplay runtime bridge.
 */
export function light_use(
  self: GameEntity,
  _other: GameEntity | null,
  _activator: GameEntity | null,
  runtime: GameRuntime
): void {
  const on = (self.spawnflags & START_OFF) !== 0;
  self.spawnflags = on ? (self.spawnflags & ~START_OFF) : (self.spawnflags | START_OFF);
  setGameConfigstring(runtime, CS_LIGHTS + self.style, on ? "m" : "a");
  runtime.log({
    kind: "use",
    message: `${self.classname} lightstyle ${CS_LIGHTS + self.style}=${on ? "m" : "a"}`,
    entityIndex: self.index,
    entityClassname: self.classname
  });
}

/**
 * Original name: SP_light
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Frees untargeted or deathmatch lights, matching the source global-message guard.
 * - Installs `light_use` for targeted custom lightstyles and initializes the current style.
 *
 * Porting notes:
 * - `START_OFF` remains a local port of the source macro value `1`.
 */
export function SP_light(self: GameEntity, runtime: GameRuntime): void {
  if (!self.targetname || runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  if (self.style >= 32) {
    self.use = light_use;
    setGameConfigstring(runtime, CS_LIGHTS + self.style, (self.spawnflags & START_OFF) !== 0 ? "a" : "m");
  }
}

/**
 * Original name: func_wall_use
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Toggles a trigger-spawned brush wall between `SOLID_BSP`/visible and `SOLID_NOT`/`SVF_NOCLIENT`.
 * - Calls `KillBox` when the wall appears, relinks the entity, and clears one-shot uses when `TOGGLE` is not set.
 */
export function func_wall_use(
  self: GameEntity,
  _other: GameEntity | null,
  _activator: GameEntity | null,
  runtime: GameRuntime
): void {
  if (self.solid === SOLID_NOT) {
    self.solid = SOLID_BSP;
    self.svflags &= ~SVF_NOCLIENT;
    KillBox(runtime, self);
  } else {
    self.solid = SOLID_NOT;
    self.svflags |= SVF_NOCLIENT;
  }

  refreshEntitySpatialState(self);
  linkGameEntity(runtime, self);
  if ((self.spawnflags & 2) === 0) {
    self.use = undefined;
  }
}

/**
 * Original name: SP_func_wall
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Spawns inline BSP wall brushes, preserving animation flags and trigger-spawn start/toggle semantics.
 * - Links ordinary walls immediately and hides inactive trigger-spawn walls from client-visible snapshots.
 *
 * Porting notes:
 * - `setGameEntityModel` is the runtime adapter for the original `gi.setmodel` import.
 */
export function SP_func_wall(self: GameEntity, runtime: GameRuntime): void {
  self.movetype = MOVETYPE_PUSH;
  if (self.model) {
    setGameEntityModel(runtime, self, self.model);
  }

  if ((self.spawnflags & 8) !== 0) {
    self.s.effects |= EF_ANIM_ALL;
  }
  if ((self.spawnflags & 16) !== 0) {
    self.s.effects |= EF_ANIM_ALLFAST;
  }

  if ((self.spawnflags & 7) === 0) {
    self.solid = SOLID_BSP;
    refreshEntitySpatialState(self);
    linkGameEntity(runtime, self);
    return;
  }

  if ((self.spawnflags & 1) === 0) {
    self.spawnflags |= 1;
  }
  if ((self.spawnflags & 4) !== 0 && (self.spawnflags & 2) === 0) {
    self.spawnflags |= 2;
  }

  self.use = func_wall_use;
  if ((self.spawnflags & 4) !== 0) {
    self.solid = SOLID_BSP;
  } else {
    self.solid = SOLID_NOT;
    self.svflags |= SVF_NOCLIENT;
  }

  refreshEntitySpatialState(self);
  linkGameEntity(runtime, self);
}

/**
 * Original name: func_object_touch
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior:
 * - Crushes only damageable entities directly underneath a falling func_object.
 * Porting notes:
 * - The runtime touch adapter passes the original collision plane when physics produced one.
 */
export function func_object_touch(self: GameEntity, other: GameEntity, runtime: GameRuntime, plane?: cplane_t | null): void {
  if (!plane || plane.normal[2] < 1.0) {
    return;
  }

  if (other.takedamage === damage_t.DAMAGE_NO) {
    return;
  }

  T_Damage(other, self, self, [0, 0, 0], self.s.origin, [0, 0, 0], self.dmg, 1, 0, MOD_CRUSH, runtime);
}

/**
 * Original name: func_object_release
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior:
 * - Releases the brush object into toss physics and arms the crush touch callback.
 */
export function func_object_release(self: GameEntity, _runtime: GameRuntime): void {
  self.movetype = MOVETYPE_TOSS;
  self.touch = func_object_touch;
}

/**
 * Original name: func_object_use
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior:
 * - Reveals a trigger-spawned func_object, clears one-shot use, killboxes occupants and releases it.
 * Porting notes:
 * - Refresh and link calls keep the TypeScript runtime spatial adapter synchronized after visibility changes.
 */
export function func_object_use(
  self: GameEntity,
  _other: GameEntity | null,
  _activator: GameEntity | null,
  runtime: GameRuntime
): void {
  self.solid = SOLID_BSP;
  self.svflags &= ~SVF_NOCLIENT;
  self.use = undefined;
  KillBox(runtime, self);
  func_object_release(self, runtime);
  refreshEntitySpatialState(self);
  linkGameEntity(runtime, self);
}

/**
 * Original name: SP_func_object
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior:
 * - Spawns a falling inline BSP object, shrinking its bounds, setting default crush damage, animation flags and release/use state.
 * Porting notes:
 * - `setGameEntityModel` and `linkGameEntity` adapt the original `gi.setmodel` / `gi.linkentity` imports.
 */
export function SP_func_object(self: GameEntity, runtime: GameRuntime): void {
  if (self.model) {
    setGameEntityModel(runtime, self, self.model);
  }

  self.mins = [self.mins[0] + 1, self.mins[1] + 1, self.mins[2] + 1];
  self.maxs = [self.maxs[0] - 1, self.maxs[1] - 1, self.maxs[2] - 1];

  if (!self.dmg) {
    self.dmg = 100;
  }

  if (self.spawnflags === 0) {
    self.solid = SOLID_BSP;
    self.movetype = MOVETYPE_PUSH;
    self.think = func_object_release;
    self.nextthink = runtime.time + (2 * FRAMETIME);
  } else {
    self.solid = SOLID_NOT;
    self.movetype = MOVETYPE_PUSH;
    self.use = func_object_use;
    self.svflags |= SVF_NOCLIENT;
  }

  if ((self.spawnflags & 2) !== 0) {
    self.s.effects |= EF_ANIM_ALL;
  }
  if ((self.spawnflags & 4) !== 0) {
    self.s.effects |= EF_ANIM_ALLFAST;
  }

  self.clipmask = MASK_MONSTERSOLID;
  refreshEntitySpatialState(self);
  linkGameEntity(runtime, self);
}

/**
 * Original name: BecomeExplosion1
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits a `TE_EXPLOSION1` temp entity at the entity origin, multicasts it to the PVS, then frees the edict.
 *
 * Porting notes:
 * - The original `gi.Write*`/`gi.multicast` side effect is queued through runtime temp-entity events.
 */
export function BecomeExplosion1(self: GameEntity, runtime: GameRuntime): void {
  emitGameTempEntity(runtime, temp_event_t.TE_EXPLOSION1, self.s.origin, multicast_t.MULTICAST_PVS);
  G_FreeEdict(runtime, self);
}

/**
 * Original name: BecomeExplosion2
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits a `TE_EXPLOSION2` temp entity at the entity origin, multicasts it to the PVS, then frees the edict.
 *
 * Porting notes:
 * - The original `gi.Write*`/`gi.multicast` side effect is queued through runtime temp-entity events.
 */
export function BecomeExplosion2(self: GameEntity, runtime: GameRuntime): void {
  emitGameTempEntity(runtime, temp_event_t.TE_EXPLOSION2, self.s.origin, multicast_t.MULTICAST_PVS);
  G_FreeEdict(runtime, self);
}

/**
 * Original name: debris_die
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Frees one damageable debris chunk when it is killed.
 */
export function debris_die(
  self: GameEntity,
  _inflictor: GameEntity | null,
  _attacker: GameEntity | null,
  _damage: number,
  runtime: GameRuntime
): void {
  G_FreeEdict(runtime, self);
}

/**
 * Original name: ThrowDebris
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Spawns one bouncing visible debris chunk at the requested origin.
 * - Applies the source entity velocity plus a random throw vector scaled by `speed`.
 * - Makes the chunk damageable and schedules automatic cleanup after 5 + random()*5 seconds.
 */
export function ThrowDebris(self: GameEntity, modelname: string, speed: number, origin: vec3_t, runtime: GameRuntime): void {
  const chunk = G_Spawn(runtime);
  setEntityOrigin(chunk, origin);
  chunk.model = modelname;
  chunk.s.modelindex = registerGameModel(runtime, modelname);
  const randomVelocity: vec3_t = [100 * crandom(), 100 * crandom(), 100 + (100 * crandom())];
  chunk.velocity = addVec3(self.velocity, scaleVec3(randomVelocity, speed));
  chunk.movetype = MOVETYPE_BOUNCE;
  chunk.solid = SOLID_NOT;
  chunk.avelocity = [random() * 600, random() * 600, random() * 600];
  chunk.think = freeEdictThink;
  chunk.nextthink = runtime.time + 5 + (random() * 5);
  chunk.flags = 0;
  chunk.classname = "debris";
  chunk.takedamage = damage_t.DAMAGE_YES;
  chunk.die = debris_die;
  refreshEntitySpatialState(chunk);
  linkGameEntity(runtime, chunk);
}

/**
 * Original name: func_explosive_explode
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Breaks a shootable/triggered brush model into debris, fires targets and optionally emits an explosion temp entity.
 */
export function func_explosive_explode(
  self: GameEntity,
  inflictor: GameEntity | null,
  attacker: GameEntity | null,
  _damage: number,
  runtime: GameRuntime
): void {
  const size = scaleVec3(self.size, 0.5);
  const origin = addVec3(self.absmin, size);
  setEntityOrigin(self, origin);

  self.takedamage = damage_t.DAMAGE_NO;

  if (self.dmg) {
    T_RadiusDamage(self, attacker ?? self, self.dmg, null, self.dmg + 40, MOD_EXPLOSIVE, runtime);
  }

  const sourceOrigin = inflictor?.s.origin ?? self.s.origin;
  self.velocity = scaleVec3(normalizeVec3(subVec3(self.s.origin, sourceOrigin)), 150);

  const chunkRange = scaleVec3(size, 0.5);
  const mass = self.mass || 75;

  let count = mass >= 100 ? Math.min(Math.trunc(mass / 100), 8) : 0;
  while (count > 0) {
    count -= 1;
    ThrowDebris(self, "models/objects/debris1/tris.md2", 1, [
      origin[0] + crandom() * chunkRange[0],
      origin[1] + crandom() * chunkRange[1],
      origin[2] + crandom() * chunkRange[2]
    ], runtime);
  }

  count = Math.min(Math.trunc(mass / 25), 16);
  while (count > 0) {
    count -= 1;
    ThrowDebris(self, "models/objects/debris2/tris.md2", 2, [
      origin[0] + crandom() * chunkRange[0],
      origin[1] + crandom() * chunkRange[1],
      origin[2] + crandom() * chunkRange[2]
    ], runtime);
  }

  G_UseTargets(runtime, self, attacker);

  if (self.dmg) {
    BecomeExplosion1(self, runtime);
  } else {
    G_FreeEdict(runtime, self);
  }
}

/**
 * Original name: func_explosive_use
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Uses the triggering entity as the explosion attacker and immediately breaks the brush.
 */
export function func_explosive_use(
  self: GameEntity,
  other: GameEntity | null,
  _activator: GameEntity | null,
  runtime: GameRuntime
): void {
  func_explosive_explode(self, self, other, self.health, runtime);
}

/**
 * Original name: func_explosive_spawn
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Reveals a trigger-spawned explosive brush, clears its one-shot use callback and relinks it solid.
 */
export function func_explosive_spawn(
  self: GameEntity,
  _other: GameEntity | null,
  _activator: GameEntity | null,
  runtime: GameRuntime
): void {
  self.solid = SOLID_BSP;
  self.svflags &= ~SVF_NOCLIENT;
  self.use = undefined;
  KillBox(runtime, self);
  refreshEntitySpatialState(self);
  linkGameEntity(runtime, self);
}

/**
 * Original name: SP_func_explosive
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns an explosive brush model with trigger-spawn, shootable and animated variants.
 * - Deathmatch removes these brush entities during spawn like the original game DLL.
 */
export function SP_func_explosive(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  self.movetype = MOVETYPE_PUSH;
  registerGameModel(runtime, "models/objects/debris1/tris.md2");
  registerGameModel(runtime, "models/objects/debris2/tris.md2");
  if (self.model) {
    setGameEntityModel(runtime, self, self.model);
  }

  if ((self.spawnflags & 1) !== 0) {
    self.svflags |= SVF_NOCLIENT;
    self.solid = SOLID_NOT;
    self.use = func_explosive_spawn;
  } else {
    self.solid = SOLID_BSP;
    if (self.targetname) {
      self.use = func_explosive_use;
    }
  }

  if ((self.spawnflags & 2) !== 0) {
    self.s.effects |= EF_ANIM_ALL;
  }
  if ((self.spawnflags & 4) !== 0) {
    self.s.effects |= EF_ANIM_ALLFAST;
  }

  if (self.use !== func_explosive_use) {
    if (!self.health) {
      self.health = 100;
    }
    self.die = func_explosive_explode;
    self.takedamage = damage_t.DAMAGE_YES;
  }

  refreshEntitySpatialState(self);
  linkGameEntity(runtime, self);
}

/**
 * Original name: barrel_touch
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Lets grounded actors push an explosive barrel sideways.
 */
export function barrel_touch(self: GameEntity, other: GameEntity, runtime: GameRuntime): void {
  if (!other.groundentity || other.groundentity === self || self.mass === 0) {
    return;
  }

  const ratio = other.mass / self.mass;
  const v = subVec3(self.s.origin, other.s.origin);
  M_walkmove(self, vectoyaw(v), 20 * ratio * FRAMETIME, runtime);
}

/**
 * Original name: barrel_explode
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies barrel radius damage, throws debris chunks and turns the entity into a temporary explosion.
 */
export function barrel_explode(self: GameEntity, runtime: GameRuntime): void {
  T_RadiusDamage(self, self.activator ?? self, self.dmg, null, self.dmg + 40, MOD_BARREL, runtime);

  const save: vec3_t = [...self.s.origin];
  const center: vec3_t = [
    self.absmin[0] + 0.5 * self.size[0],
    self.absmin[1] + 0.5 * self.size[1],
    self.absmin[2] + 0.5 * self.size[2]
  ];
  setEntityOrigin(self, center);

  const throwRandomDebris = (modelname: string, speed: number): void => {
    ThrowDebris(self, modelname, speed, [
      self.s.origin[0] + crandom() * self.size[0],
      self.s.origin[1] + crandom() * self.size[1],
      self.s.origin[2] + crandom() * self.size[2]
    ], runtime);
  };

  let spd = 1.5 * self.dmg / 200.0;
  throwRandomDebris("models/objects/debris1/tris.md2", spd);
  throwRandomDebris("models/objects/debris1/tris.md2", spd);

  spd = 1.75 * self.dmg / 200.0;
  ThrowDebris(self, "models/objects/debris3/tris.md2", spd, [...self.absmin], runtime);
  ThrowDebris(self, "models/objects/debris3/tris.md2", spd, [self.absmin[0] + self.size[0], self.absmin[1], self.absmin[2]], runtime);
  ThrowDebris(self, "models/objects/debris3/tris.md2", spd, [self.absmin[0], self.absmin[1] + self.size[1], self.absmin[2]], runtime);
  ThrowDebris(self, "models/objects/debris3/tris.md2", spd, [self.absmin[0] + self.size[0], self.absmin[1] + self.size[1], self.absmin[2]], runtime);

  spd = 2 * self.dmg / 200.0;
  for (let index = 0; index < 8; index += 1) {
    throwRandomDebris("models/objects/debris2/tris.md2", spd);
  }

  setEntityOrigin(self, save);
  if (self.groundentity) {
    BecomeExplosion2(self, runtime);
  } else {
    BecomeExplosion1(self, runtime);
  }
}

/**
 * Original name: barrel_delay
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Delays barrel explosion by two server frames after lethal damage.
 */
export function barrel_delay(
  self: GameEntity,
  _inflictor: GameEntity | null,
  attacker: GameEntity | null,
  _damage: number,
  runtime: GameRuntime
): void {
  self.takedamage = damage_t.DAMAGE_NO;
  self.nextthink = runtime.time + 2 * FRAMETIME;
  self.think = barrel_explode;
  self.activator = attacker;
}

/**
 * Original name: SP_misc_explobox
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns the large exploding barrel/box model with shootable damage state.
 *
 * Porting notes:
 * - Uses the local gameplay asset registry in place of `gi.modelindex`.
 */
export function SP_misc_explobox(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  registerGameModel(runtime, "models/objects/debris1/tris.md2");
  registerGameModel(runtime, "models/objects/debris2/tris.md2");
  registerGameModel(runtime, "models/objects/debris3/tris.md2");

  self.solid = SOLID_BBOX;
  self.movetype = MOVETYPE_STEP;
  self.model = "models/objects/barrels/tris.md2";
  self.s.modelindex = registerGameModel(runtime, self.model);
  self.mins = [-16, -16, 0];
  self.maxs = [16, 16, 40];

  if (!self.mass) {
    self.mass = 400;
  }
  if (!self.health) {
    self.health = 10;
  }
  if (!self.dmg) {
    self.dmg = 150;
  }

  self.die = barrel_delay;
  self.takedamage = damage_t.DAMAGE_YES;
  self.monsterinfo.aiflags = AI_NOSTEP;
  self.touch = barrel_touch;
  self.think = M_droptofloor;
  self.nextthink = runtime.time + 2 * FRAMETIME;
  refreshEntitySpatialState(self);
  linkGameEntity(runtime, self);
}

/**
 * Original name: misc_banner_think
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Advances the banner animation by one MD2 frame every server frame.
 */
export function misc_banner_think(ent: GameEntity, runtime: GameRuntime): void {
  ent.s.frame = (ent.s.frame + 1) % 16;
  ent.think = misc_banner_think;
  ent.nextthink = runtime.time + FRAMETIME;
}

/**
 * Original name: SP_misc_banner
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns the animated hanging banner decorative entity.
 *
 * Porting notes:
 * - Uses the local gameplay asset registry in place of `gi.modelindex`.
 */
export function SP_misc_banner(ent: GameEntity, runtime: GameRuntime): void {
  ent.movetype = MOVETYPE_NONE;
  ent.solid = SOLID_NOT;
  ent.s.modelindex = registerGameModel(runtime, "models/objects/banner/tris.md2");
  ent.s.frame = Math.trunc(Math.random() * 16) % 16;
  ent.think = misc_banner_think;
  ent.nextthink = runtime.time + FRAMETIME;
  refreshEntitySpatialState(ent);
  linkGameEntity(runtime, ent);
}

/**
 * Original name: misc_satellite_dish_think
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Runs the dish animation until frame 37 inclusive.
 */
export function misc_satellite_dish_think(self: GameEntity, runtime: GameRuntime): void {
  self.s.frame += 1;
  if (self.s.frame < 38) {
    self.think = misc_satellite_dish_think;
    self.nextthink = runtime.time + FRAMETIME;
  }
}

/**
 * Original name: misc_satellite_dish_use
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Restarts the dish animation from frame zero.
 */
export function misc_satellite_dish_use(
  self: GameEntity,
  _other: GameEntity | null,
  _activator: GameEntity | null,
  runtime: GameRuntime
): void {
  self.s.frame = 0;
  self.think = misc_satellite_dish_think;
  self.nextthink = runtime.time + FRAMETIME;
}

/**
 * Original name: SP_misc_satellite_dish
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Spawns the static dish entity that can later animate when used.
 */
export function SP_misc_satellite_dish(ent: GameEntity, runtime: GameRuntime): void {
  ent.movetype = MOVETYPE_NONE;
  ent.solid = SOLID_BBOX;
  ent.mins = [-64, -64, 0];
  ent.maxs = [64, 64, 128];
  ent.s.modelindex = registerGameModel(runtime, "models/objects/satellite/tris.md2");
  ent.use = misc_satellite_dish_use;
  refreshEntitySpatialState(ent);
  linkGameEntity(runtime, ent);
}

/**
 * Original name: SP_light_mine1
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Spawns the first decorative mine light model.
 */
export function SP_light_mine1(ent: GameEntity, runtime: GameRuntime): void {
  ent.movetype = MOVETYPE_NONE;
  ent.solid = SOLID_BBOX;
  ent.s.modelindex = registerGameModel(runtime, "models/objects/minelite/light1/tris.md2");
  refreshEntitySpatialState(ent);
  linkGameEntity(runtime, ent);
}

/**
 * Original name: SP_light_mine2
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Spawns the second decorative mine light model.
 */
export function SP_light_mine2(ent: GameEntity, runtime: GameRuntime): void {
  ent.movetype = MOVETYPE_NONE;
  ent.solid = SOLID_BBOX;
  ent.s.modelindex = registerGameModel(runtime, "models/objects/minelite/light2/tris.md2");
  refreshEntitySpatialState(ent);
  linkGameEntity(runtime, ent);
}

/**
 * Original name: SP_misc_bigviper
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Spawns the large stationary viper ship decorative model.
 */
export function SP_misc_bigviper(ent: GameEntity, runtime: GameRuntime): void {
  ent.movetype = MOVETYPE_NONE;
  ent.solid = SOLID_BBOX;
  ent.mins = [-176, -120, -24];
  ent.maxs = [176, 120, 72];
  ent.s.modelindex = registerGameModel(runtime, "models/ships/bigviper/tris.md2");
  refreshEntitySpatialState(ent);
  linkGameEntity(runtime, ent);
}

/**
 * Original name: misc_blackhole_use
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Removes the black hole entity when activated.
 *
 * Porting notes:
 * - The temporary entity effect commented out in the original source stays omitted here too.
 */
export function misc_blackhole_use(
  ent: GameEntity,
  _other: GameEntity | null,
  _activator: GameEntity | null,
  runtime: GameRuntime
): void {
  G_FreeEdict(runtime, ent);
}

/**
 * Original name: misc_blackhole_think
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Loops the black hole animation over frames 0..18.
 */
export function misc_blackhole_think(self: GameEntity, runtime: GameRuntime): void {
  if (++self.s.frame < 19) {
    self.think = misc_blackhole_think;
    self.nextthink = runtime.time + FRAMETIME;
    return;
  }

  self.s.frame = 0;
  self.think = misc_blackhole_think;
  self.nextthink = runtime.time + FRAMETIME;
}

/**
 * Original name: SP_misc_blackhole
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Spawns the translucent animated black hole decorative entity.
 */
export function SP_misc_blackhole(ent: GameEntity, runtime: GameRuntime): void {
  ent.movetype = MOVETYPE_NONE;
  ent.solid = SOLID_NOT;
  ent.mins = [-64, -64, 0];
  ent.maxs = [64, 64, 8];
  ent.s.modelindex = registerGameModel(runtime, "models/objects/black/tris.md2");
  ent.s.renderfx = RF_TRANSLUCENT;
  ent.use = misc_blackhole_use;
  ent.think = misc_blackhole_think;
  ent.nextthink = runtime.time + 2 * FRAMETIME;
  refreshEntitySpatialState(ent);
  linkGameEntity(runtime, ent);
}

/**
 * Original name: misc_eastertank_think
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Advances the tank easter animation over frames 254..292.
 */
export function misc_eastertank_think(self: GameEntity, runtime: GameRuntime): void {
  if (++self.s.frame < 293) {
    self.think = misc_eastertank_think;
    self.nextthink = runtime.time + FRAMETIME;
    return;
  }

  self.s.frame = 254;
  self.think = misc_eastertank_think;
  self.nextthink = runtime.time + FRAMETIME;
}

/**
 * Original name: SP_misc_eastertank
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Spawns the animated easter tank decorative monster model.
 */
export function SP_misc_eastertank(ent: GameEntity, runtime: GameRuntime): void {
  ent.movetype = MOVETYPE_NONE;
  ent.solid = SOLID_BBOX;
  ent.mins = [-32, -32, -16];
  ent.maxs = [32, 32, 32];
  ent.s.modelindex = registerGameModel(runtime, "models/monsters/tank/tris.md2");
  ent.s.frame = 254;
  ent.think = misc_eastertank_think;
  ent.nextthink = runtime.time + 2 * FRAMETIME;
  refreshEntitySpatialState(ent);
  linkGameEntity(runtime, ent);
}

/**
 * Original name: misc_easterchick_think
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Advances the first easter chick animation over frames 208..246.
 */
export function misc_easterchick_think(self: GameEntity, runtime: GameRuntime): void {
  if (++self.s.frame < 247) {
    self.think = misc_easterchick_think;
    self.nextthink = runtime.time + FRAMETIME;
    return;
  }

  self.s.frame = 208;
  self.think = misc_easterchick_think;
  self.nextthink = runtime.time + FRAMETIME;
}

/**
 * Original name: SP_misc_easterchick
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Spawns the first animated easter chick decorative monster model.
 */
export function SP_misc_easterchick(ent: GameEntity, runtime: GameRuntime): void {
  ent.movetype = MOVETYPE_NONE;
  ent.solid = SOLID_BBOX;
  ent.mins = [-32, -32, 0];
  ent.maxs = [32, 32, 32];
  ent.s.modelindex = registerGameModel(runtime, "models/monsters/bitch/tris.md2");
  ent.s.frame = 208;
  ent.think = misc_easterchick_think;
  ent.nextthink = runtime.time + 2 * FRAMETIME;
  refreshEntitySpatialState(ent);
  linkGameEntity(runtime, ent);
}

/**
 * Original name: misc_easterchick2_think
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Advances the second easter chick animation over frames 248..286.
 */
export function misc_easterchick2_think(self: GameEntity, runtime: GameRuntime): void {
  if (++self.s.frame < 287) {
    self.think = misc_easterchick2_think;
    self.nextthink = runtime.time + FRAMETIME;
    return;
  }

  self.s.frame = 248;
  self.think = misc_easterchick2_think;
  self.nextthink = runtime.time + FRAMETIME;
}

/**
 * Original name: SP_misc_easterchick2
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Spawns the second animated easter chick decorative monster model.
 */
export function SP_misc_easterchick2(ent: GameEntity, runtime: GameRuntime): void {
  ent.movetype = MOVETYPE_NONE;
  ent.solid = SOLID_BBOX;
  ent.mins = [-32, -32, 0];
  ent.maxs = [32, 32, 32];
  ent.s.modelindex = registerGameModel(runtime, "models/monsters/bitch/tris.md2");
  ent.s.frame = 248;
  ent.think = misc_easterchick2_think;
  ent.nextthink = runtime.time + 2 * FRAMETIME;
  refreshEntitySpatialState(ent);
  linkGameEntity(runtime, ent);
}

/**
 * Original name: commander_body_think
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Plays the commander's decapitated body animation until frame 23.
 *
 * Porting notes:
 * - Sound playback is queued through the local gameplay sound-event bridge.
 */
export function commander_body_think(self: GameEntity, runtime: GameRuntime): void {
  if (self.s.frame === 21) {
    emitRegisteredGameSound(runtime, self, registerGameSound(runtime, "tank/thud.wav"), "tank/thud.wav", {
      channel: CHAN_BODY,
      volume: 1,
      attenuation: ATTN_NORM
    });
  }
  if (++self.s.frame < 24) {
    self.think = commander_body_think;
    self.nextthink = runtime.time + FRAMETIME;
    return;
  }

  self.nextthink = 0;
  self.think = undefined;
}

/**
 * Original name: commander_body_use
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Starts the commander's body animation when used.
 */
export function commander_body_use(
  self: GameEntity,
  _other: GameEntity | null,
  _activator: GameEntity | null,
  runtime: GameRuntime
): void {
  self.think = commander_body_think;
  self.nextthink = runtime.time + FRAMETIME;
  emitRegisteredGameSound(runtime, self, registerGameSound(runtime, "tank/pain.wav"), "tank/pain.wav", {
    channel: CHAN_BODY,
    volume: 1,
    attenuation: ATTN_NORM
  });
}

/**
 * Original name: commander_body_drop
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Converts the commander body into a toss entity and nudges it upward.
 *
 * Porting notes:
 * - Full toss physics are already provided by the shared runtime, so this only updates the movetype and origin.
 */
export function commander_body_drop(self: GameEntity, runtime: GameRuntime): void {
  self.movetype = MOVETYPE_TOSS;
  self.origin[2] += 2;
  self.s.origin = [...self.origin];
  refreshEntitySpatialState(self);
  linkGameEntity(runtime, self);
}

/**
 * Original name: SP_monster_commander_body
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns the commander's body decorative alias model with frame lerp enabled.
 */
export function SP_monster_commander_body(self: GameEntity, runtime: GameRuntime): void {
  self.movetype = MOVETYPE_NONE;
  self.solid = SOLID_BBOX;
  self.model = "models/monsters/commandr/tris.md2";
  self.s.modelindex = registerGameModel(runtime, self.model);
  self.mins = [-32, -32, 0];
  self.maxs = [32, 32, 48];
  self.use = commander_body_use;
  self.takedamage = damage_t.DAMAGE_YES;
  self.flags = FL_GODMODE;
  self.s.renderfx |= RF_FRAMELERP;
  registerGameSound(runtime, "tank/thud.wav");
  registerGameSound(runtime, "tank/pain.wav");
  self.think = commander_body_drop;
  self.nextthink = runtime.time + 5 * FRAMETIME;
  refreshEntitySpatialState(self);
  linkGameEntity(runtime, self);
}

/**
 * Original name: misc_viper_use
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Makes the viper visible when triggered, installs the generic train use callback, then activates train movement.
 */
export function misc_viper_use(
  self: GameEntity,
  other: GameEntity | null,
  activator: GameEntity | null,
  runtime: GameRuntime
): void {
  self.svflags &= ~SVF_NOCLIENT;
  self.use = train_use;
  train_use(self, other, activator, runtime);
  refreshEntitySpatialState(self);
  linkGameEntity(runtime, self);
}

/**
 * Original name: SP_misc_viper
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Spawns the trigger-activated flyby viper entity, or frees it with the source warning when no target path is set.
 */
export function SP_misc_viper(ent: GameEntity, runtime: GameRuntime): void {
  if (!ent.target) {
    runtime.log({ kind: "warning", message: `misc_viper without a target at ${vtos(ent.absmin)}`, entityIndex: ent.index, entityClassname: ent.classname });
    G_FreeEdict(runtime, ent);
    return;
  }

  if (!ent.speed) {
    ent.speed = 300;
  }

  ent.movetype = MOVETYPE_PUSH;
  ent.solid = SOLID_NOT;
  ent.s.modelindex = registerGameModel(runtime, "models/ships/viper/tris.md2");
  ent.mins = [-16, -16, 0];
  ent.maxs = [16, 16, 32];
  ent.think = func_train_find;
  ent.nextthink = runtime.time + FRAMETIME;
  ent.use = misc_viper_use;
  ent.svflags |= SVF_NOCLIENT;
  ent.moveinfo.accel = ent.speed;
  ent.moveinfo.decel = ent.speed;
  ent.moveinfo.speed = ent.speed;
  refreshEntitySpatialState(ent);
  linkGameEntity(runtime, ent);
}

/**
 * Original name: misc_strogg_ship_use
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Makes the Strogg ship visible when triggered, replaces its use callback with the train callback, and immediately starts/resumes train movement.
 */
export function misc_strogg_ship_use(
  self: GameEntity,
  other: GameEntity | null,
  activator: GameEntity | null,
  runtime: GameRuntime
): void {
  self.svflags &= ~SVF_NOCLIENT;
  self.use = train_use;
  train_use(self, other, activator, runtime);
  refreshEntitySpatialState(self);
  linkGameEntity(runtime, self);
}

/**
 * Original name: misc_viper_bomb_touch
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Fires the bomb targets with the stored activator, snaps the explosion origin to the floor contact, applies bomb radius damage and becomes `TE_EXPLOSION2`.
 */
export function misc_viper_bomb_touch(self: GameEntity, _other: GameEntity, runtime: GameRuntime): void {
  G_UseTargets(runtime, self, self.activator);
  self.s.origin[2] = self.absmin[2] + 1;
  self.origin[2] = self.s.origin[2];
  T_RadiusDamage(self, self, self.dmg, null, self.dmg + 40, MOD_BOMB, runtime);
  BecomeExplosion2(self, runtime);
}

/**
 * Original name: misc_viper_bomb_prethink
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Keeps the launched viper bomb airborne, pitches it from the launch direction and time delta, clamps late falloff at -1, and rolls it by 10 degrees each frame.
 */
export function misc_viper_bomb_prethink(self: GameEntity, runtime: GameRuntime): void {
  self.groundentity = null;
  let diff = self.timestamp - runtime.time;
  if (diff < -1.0) {
    diff = -1.0;
  }

  const v = scaleVec3(self.moveinfo.dir, 1.0 + diff);
  v[2] = diff;
  const roll = self.s.angles[2];
  self.s.angles = vectoangles(v);
  self.s.angles[2] = roll + 10;
}

/**
 * Original name: misc_viper_bomb_use
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Reveals the hidden viper bomb, turns on rocket effects, switches to toss physics, installs flight/touch callbacks, stores the activator and copies launch velocity/direction from the first active `misc_viper`.
 *
 * Porting notes:
 * - The original dereferences the `misc_viper` search result; this port keeps the normal mapped flow identical when present and leaves the bomb inert rather than crashing if a malformed map lacks the viper.
 */
export function misc_viper_bomb_use(
  self: GameEntity,
  _other: GameEntity | null,
  activator: GameEntity | null,
  runtime: GameRuntime
): void {
  self.solid = SOLID_BBOX;
  self.svflags &= ~SVF_NOCLIENT;
  self.s.effects |= EF_ROCKET;
  self.use = undefined;
  self.movetype = MOVETYPE_TOSS;
  self.prethink = misc_viper_bomb_prethink;
  self.touch = misc_viper_bomb_touch;
  self.activator = activator;

  const viper = findFirstByClassname(runtime, "misc_viper");
  if (viper) {
    self.velocity = scaleVec3(viper.moveinfo.dir, viper.moveinfo.speed);
    self.moveinfo.dir = [...viper.moveinfo.dir];
  }

  self.timestamp = runtime.time;
  refreshEntitySpatialState(self);
  linkGameEntity(runtime, self);
}

/**
 * Original name: teleporter_touch
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Moves a touching client to the targeted teleporter destination, applies the teleport hold state, emits player teleport events and relinks the player after `KillBox`.
 */
export function teleporter_touch(self: GameEntity, other: GameEntity, runtime: GameRuntime): void {
  if (!other.client) {
    return;
  }

  const dest = self.target ? G_Find(runtime, null, "targetname", self.target) : null;
  if (!dest) {
    runtime.log({
      kind: "warning",
      message: "Couldn't find destination",
      entityIndex: self.index,
      entityClassname: self.classname
    });
    return;
  }

  unlinkGameEntity(runtime, other);
  setEntityOrigin(other, dest.s.origin);
  other.s.old_origin = [...dest.s.origin];
  other.origin[2] += 10;
  other.s.origin[2] += 10;
  other.velocity = [0, 0, 0];
  other.client.ps.pmove.pm_time = 160 >> 3;
  other.client.ps.pmove.pm_flags |= PMF_TIME_TELEPORT;
  if (self.owner) {
    self.owner.s.event = entity_event_t.EV_PLAYER_TELEPORT;
  }
  other.s.event = entity_event_t.EV_PLAYER_TELEPORT;

  for (let index = 0; index < 3; index += 1) {
    const delta = dest.s.angles[index] - other.client.resp.cmd_angles[index];
    other.client.ps.pmove.delta_angles[index] = Math.trunc((delta * 65536) / 360) & 0xffff;
  }

  other.s.angles = [0, 0, 0];
  other.client.ps.viewangles = [0, 0, 0];
  other.client.v_angle = [0, 0, 0];
  KillBox(runtime, other);
  refreshEntitySpatialState(other);
  linkGameEntity(runtime, other);
  other.s.old_origin = [...dest.s.origin];
}

/**
 * Original name: SP_misc_strogg_ship
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Spawns the trigger-activated Strogg ship flyby entity, including source warnings/freeing when no path target is configured.
 */
export function SP_misc_strogg_ship(ent: GameEntity, runtime: GameRuntime): void {
  if (!ent.target) {
    runtime.log({
      kind: "warning",
      message: `${ent.classname} without a target at ${vtos(ent.absmin)}`,
      entityIndex: ent.index,
      entityClassname: ent.classname
    });
    G_FreeEdict(runtime, ent);
    return;
  }

  if (!ent.speed) {
    ent.speed = 300;
  }

  ent.movetype = MOVETYPE_PUSH;
  ent.solid = SOLID_NOT;
  ent.s.modelindex = registerGameModel(runtime, "models/ships/strogg1/tris.md2");
  ent.mins = [-16, -16, 0];
  ent.maxs = [16, 16, 32];
  ent.think = func_train_find;
  ent.nextthink = runtime.time + FRAMETIME;
  ent.use = misc_strogg_ship_use;
  ent.svflags |= SVF_NOCLIENT;
  ent.moveinfo.accel = ent.speed;
  ent.moveinfo.decel = ent.speed;
  ent.moveinfo.speed = ent.speed;
  refreshEntitySpatialState(ent);
  linkGameEntity(runtime, ent);
}

/**
 * Original name: SP_misc_teleporter
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Spawns the teleporter pad and its local trigger helper volume, or frees malformed pads without a target after the source warning.
 */
export function SP_misc_teleporter(ent: GameEntity, runtime: GameRuntime): void {
  if (!ent.target) {
    runtime.log({
      kind: "warning",
      message: "teleporter without a target.",
      entityIndex: ent.index,
      entityClassname: ent.classname
    });
    G_FreeEdict(runtime, ent);
    return;
  }

  ent.model = "models/objects/dmspot/tris.md2";
  ent.s.modelindex = registerGameModel(runtime, ent.model);
  ent.s.skinnum = 1;
  ent.s.effects = EF_TELEPORTER;
  ent.s.sound = registerGameSound(runtime, "world/amb10.wav");
  ent.solid = SOLID_BBOX;
  ent.mins = [-32, -32, -24];
  ent.maxs = [32, 32, -16];
  refreshEntitySpatialState(ent);
  linkGameEntity(runtime, ent);

  const trig = spawnGameEntity(runtime);
  trig.classname = "teleporter_trigger";
  trig.touch = teleporter_touch;
  trig.solid = SOLID_TRIGGER;
  trig.target = ent.target;
  trig.owner = ent;
  trig.origin = [...ent.origin];
  trig.mins = [-8, -8, 8];
  trig.maxs = [8, 8, 24];
  refreshEntitySpatialState(trig);
  linkGameEntity(runtime, trig);
}

/**
 * Original name: SP_misc_teleporter_dest
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Spawns the destination pad model for teleporters.
 */
export function SP_misc_teleporter_dest(ent: GameEntity, runtime: GameRuntime): void {
  ent.model = "models/objects/dmspot/tris.md2";
  ent.s.modelindex = registerGameModel(runtime, ent.model);
  ent.s.skinnum = 0;
  ent.solid = SOLID_BBOX;
  ent.mins = [-32, -32, -24];
  ent.maxs = [32, 32, -16];
  refreshEntitySpatialState(ent);
  linkGameEntity(runtime, ent);
}

/**
 * Original name: SP_misc_deadsoldier
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns one dead marine body pose selected from the spawnflags.
 *
 * Porting notes:
 * - Gib and sound side effects are routed through the local gameplay runtime.
 */
export function SP_misc_deadsoldier(ent: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, ent);
    return;
  }

  ent.movetype = MOVETYPE_NONE;
  ent.solid = SOLID_BBOX;
  ent.s.modelindex = registerGameModel(runtime, "models/deadbods/dude/tris.md2");

  if ((ent.spawnflags & 2) !== 0) {
    ent.s.frame = 1;
  } else if ((ent.spawnflags & 4) !== 0) {
    ent.s.frame = 2;
  } else if ((ent.spawnflags & 8) !== 0) {
    ent.s.frame = 3;
  } else if ((ent.spawnflags & 16) !== 0) {
    ent.s.frame = 4;
  } else if ((ent.spawnflags & 32) !== 0) {
    ent.s.frame = 5;
  } else {
    ent.s.frame = 0;
  }

  ent.mins = [-16, -16, 0];
  ent.maxs = [16, 16, 16];
  ent.deadflag = DEAD_DEAD;
  ent.takedamage = damage_t.DAMAGE_YES;
  ent.svflags |= SVF_MONSTER | SVF_DEADMONSTER;
  ent.die = misc_deadsoldier_die;
  ent.monsterinfo.aiflags |= AI_GOOD_GUY;
  refreshEntitySpatialState(ent);
  linkGameEntity(runtime, ent);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local gib spawn helper)
 * Category: New
 *
 * Purpose: Apply the shared gib spawn baseline used by the `misc_gib_*` ports.
 *
 * Constraints:
 * - Must preserve the original MD2 model, toss movetype and random angular velocity setup.
 */
function initialize_misc_gib(ent: GameEntity, runtime: GameRuntime, modelPath: string): void {
  ent.model = modelPath;
  ent.s.modelindex = registerGameModel(runtime, modelPath);
  ent.solid = SOLID_NOT;
  ent.s.effects |= EF_GIB;
  ent.takedamage = damage_t.DAMAGE_YES;
  ent.die = gib_die;
  ent.movetype = MOVETYPE_TOSS;
  ent.svflags |= SVF_MONSTER;
  ent.deadflag = DEAD_DEAD;
  ent.avelocity = [random() * 200, random() * 200, random() * 200];
  ent.think = freeEdictThink;
  ent.nextthink = runtime.time + 30;
  refreshEntitySpatialState(ent);
  linkGameEntity(runtime, ent);
}

/**
 * Original name: SP_misc_gib_arm
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns the flying arm gib decorative entity.
 *
 * Porting notes:
 * - Shared gib initialization is factored into a local helper to preserve the three identical source spawns.
 */
export function SP_misc_gib_arm(ent: GameEntity, runtime: GameRuntime): void {
  initialize_misc_gib(ent, runtime, "models/objects/gibs/arm/tris.md2");
}

/**
 * Original name: SP_misc_gib_leg
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns the flying leg gib decorative entity.
 *
 * Porting notes:
 * - Shared gib initialization is factored into a local helper to preserve the three identical source spawns.
 */
export function SP_misc_gib_leg(ent: GameEntity, runtime: GameRuntime): void {
  initialize_misc_gib(ent, runtime, "models/objects/gibs/leg/tris.md2");
}

/**
 * Original name: SP_misc_gib_head
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns the flying head gib decorative entity.
 *
 * Porting notes:
 * - Shared gib initialization is factored into a local helper to preserve the three identical source spawns.
 */
export function SP_misc_gib_head(ent: GameEntity, runtime: GameRuntime): void {
  initialize_misc_gib(ent, runtime, "models/objects/gibs/head/tris.md2");
}

/**
 * Original name: SP_target_character
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Spawns one brush digit cell used by `target_string`, defaulting its displayed frame to blank.
 *
 * Porting notes:
 * - `setGameEntityModel` adapts the original `gi.setmodel` import for inline BSP display brushes.
 */
export function SP_target_character(self: GameEntity, runtime: GameRuntime): void {
  self.movetype = MOVETYPE_PUSH;
  if (self.model) {
    setGameEntityModel(runtime, self, self.model);
  }
  self.solid = SOLID_BSP;
  self.s.frame = 12;
  refreshEntitySpatialState(self);
  linkGameEntity(runtime, self);
}

/**
 * Original name: target_string_use
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Updates every teamed `target_character` frame from the current message, mapping digits, `-`, `:` and blanks.
 */
export function target_string_use(
  self: GameEntity,
  _other: GameEntity | null,
  _activator: GameEntity | null,
  _runtime: GameRuntime
): void {
  const text = self.message ?? "";
  for (let entity: GameEntity | null = self.teammaster; entity; entity = entity.teamchain) {
    if (!entity.count) {
      continue;
    }

    const n = entity.count - 1;
    const c = n < text.length ? text[n] : undefined;
    if (c === undefined) {
      entity.s.frame = 12;
    } else if (c >= "0" && c <= "9") {
      entity.s.frame = c.charCodeAt(0) - 48;
    } else if (c === "-") {
      entity.s.frame = 10;
    } else if (c === ":") {
      entity.s.frame = 11;
    } else {
      entity.s.frame = 12;
    }
  }
}

/**
 * Original name: SP_target_string
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Installs the `target_string_use` callback and defaults missing messages to an empty string.
 */
export function SP_target_string(self: GameEntity, _runtime: GameRuntime): void {
  self.message ??= "";
  self.use = target_string_use;
}

/**
 * Original name: func_clock_reset
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Clears the current activator and initializes `health`/`wait` for count-up or count-down clocks.
 */
export function func_clock_reset(self: GameEntity): void {
  self.activator = null;
  if ((self.spawnflags & 1) !== 0) {
    self.health = 0;
    self.wait = self.count;
  } else if ((self.spawnflags & 2) !== 0) {
    self.health = self.count;
    self.wait = 0;
  }
}

/**
 * Original name: func_clock_format_countdown
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Formats timer values in the source clock widths: `xx`, `xx:xx`, or `xx:xx:xx`.
 */
export function func_clock_format_countdown(self: GameEntity): void {
  if (self.style === 0) {
    self.message = `${self.health}`.padStart(2, " ");
    return;
  }

  if (self.style === 1) {
    self.message = `${Math.trunc(self.health / 60)}`.padStart(2, " ") + ":" + `${self.health % 60}`.padStart(2, "0");
    return;
  }

  if (self.style === 2) {
    const hours = Math.trunc(self.health / 3600);
    const minutes = Math.trunc((self.health - (hours * 3600)) / 60);
    const seconds = self.health % 60;
    self.message = `${hours}`.padStart(2, " ") + ":" + `${minutes}`.padStart(2, "0") + ":" + `${seconds}`.padStart(2, "0");
  }
}

/**
 * Original name: func_clock_think
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Finds the target string display, formats count-up/count-down/local-time messages, fires the display use callback, and handles completion/reset targets.
 *
 * Porting notes:
 * - JavaScript `Date` supplies the local-time fields used by the original `time`/`localtime` branch.
 */
export function func_clock_think(self: GameEntity, runtime: GameRuntime): void {
  if (!self.enemy) {
    self.enemy = self.target ? G_Find(runtime, null, "targetname", self.target) : null;
    if (!self.enemy) {
      return;
    }
  }

  if ((self.spawnflags & 1) !== 0) {
    func_clock_format_countdown(self);
    self.health += 1;
  } else if ((self.spawnflags & 2) !== 0) {
    func_clock_format_countdown(self);
    self.health -= 1;
  } else {
    const now = new Date();
    const hh = `${now.getHours()}`.padStart(2, " ");
    const mm = `${now.getMinutes()}`.padStart(2, "0");
    const ss = `${now.getSeconds()}`.padStart(2, "0");
    self.message = `${hh}:${mm}:${ss}`;
  }

  self.enemy.message = self.message;
  useGameEntity(runtime, self.enemy, self, self);

  if (
    (((self.spawnflags & 1) !== 0) && self.health > self.wait) ||
    (((self.spawnflags & 2) !== 0) && self.health < self.wait)
  ) {
    if (self.pathtarget) {
      const saveTarget = self.target;
      const saveMessage = self.message;
      self.target = self.pathtarget;
      self.message = undefined;
      G_UseTargets(runtime, self, self.activator);
      self.target = saveTarget;
      self.message = saveMessage;
    }

    if ((self.spawnflags & 8) === 0) {
      return;
    }

    func_clock_reset(self);
    if ((self.spawnflags & 4) !== 0) {
      return;
    }
  }

  self.think = func_clock_think;
  self.nextthink = runtime.time + 1;
}

/**
 * Original name: func_clock_use
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Starts a START_OFF clock once, optionally clears one-shot use, records the activator, and immediately runs the first clock tick.
 */
export function func_clock_use(
  self: GameEntity,
  _other: GameEntity | null,
  activator: GameEntity | null,
  runtime: GameRuntime
): void {
  if ((self.spawnflags & 8) === 0) {
    self.use = undefined;
  }
  if (self.activator) {
    return;
  }

  self.activator = activator;
  func_clock_think(self, runtime);
}

/**
 * Original name: SP_func_clock
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Validates and initializes a map clock, allocates its fixed-size message buffer, resets countdown state and schedules either immediate thinking or start-off use activation.
 */
export function SP_func_clock(self: GameEntity, runtime: GameRuntime): void {
  if (!self.target) {
    runtime.log({
      kind: "warning",
      message: `${self.classname} with no target at ${vtos(self.s.origin)}`,
      entityIndex: self.index,
      entityClassname: self.classname
    });
    G_FreeEdict(runtime, self);
    return;
  }
  if ((self.spawnflags & 2) !== 0 && !self.count) {
    runtime.log({
      kind: "warning",
      message: `${self.classname} with no count at ${vtos(self.s.origin)}`,
      entityIndex: self.index,
      entityClassname: self.classname
    });
    G_FreeEdict(runtime, self);
    return;
  }
  if ((self.spawnflags & 1) !== 0 && !self.count) {
    self.count = 60 * 60;
  }

  func_clock_reset(self);
  self.message = "".padEnd(CLOCK_MESSAGE_SIZE, "\0");
  self.think = func_clock_think;
  if ((self.spawnflags & 4) !== 0) {
    self.use = func_clock_use;
  } else {
    self.nextthink = runtime.time + 1;
  }
}

/**
 * Original name: SP_misc_viper_bomb
 * Source: game/g_misc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Spawns the hidden viper bomb entity with its world model, default damage, use callback and linked nonsolid bbox.
 */
export function SP_misc_viper_bomb(self: GameEntity, runtime: GameRuntime): void {
  self.movetype = MOVETYPE_NONE;
  self.solid = SOLID_NOT;
  self.mins = [-8, -8, -8];
  self.maxs = [8, 8, 8];
  self.s.modelindex = registerGameModel(runtime, "models/objects/bomb/tris.md2");
  if (self.dmg === 0) {
    self.dmg = 1000;
  }
  self.use = misc_viper_bomb_use;
  self.svflags |= SVF_NOCLIENT;
  refreshEntitySpatialState(self);
  linkGameEntity(runtime, self);
}
