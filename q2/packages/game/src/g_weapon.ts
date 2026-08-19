/**
 * File: g_weapon.ts
 * Source: Quake II original / game/g_weapon.c
 * Purpose: Port the first world-weapon projectile spawn routines.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Keeps explicit hook overrides for touch/think, damage and temp-entity emission so adapters can stay decoupled.
 * - One-shot world sounds are queued through the gameplay runtime sound bridge pending full backend audio wiring.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

import {
  AngleVectors,
  MASK_WATER,
  temp_event_t,
  type cplane_t,
  type csurface_t,
  type trace_t,
  EF_ANIM_ALLFAST,
  EF_BFG,
  EF_BLASTER,
  EF_GRENADE,
  EF_HYPERBLASTER,
  EF_ROCKET,
  MASK_SHOT,
  type vec3_t
} from "../../qcommon/src/q_shared.js";
import {
  CONTENTS_DEADMONSTER,
  CONTENTS_LAVA,
  CONTENTS_MONSTER,
  CONTENTS_SOLID,
  CONTENTS_SLIME,
  SURF_FLOWING,
  SURF_SKY,
  SURF_TRANS33,
  SURF_TRANS66,
  SURF_WARP
} from "../../qcommon/src/q_shared.js";
import {
  freeGameEntity,
  DAMAGE_BULLET,
  DAMAGE_ENERGY,
  DAMAGE_NO_KNOCKBACK,
  DAMAGE_RADIUS,
  FL_IMMUNE_LASER,
  FRAMETIME,
  MOD_ROCKET,
  MOD_R_SPLASH,
  MOD_BLASTER,
  MOD_BFG_BLAST,
  MOD_BFG_EFFECT,
  MOD_BFG_LASER,
  MOD_G_SPLASH,
  MOD_GRENADE,
  MOD_HANDGRENADE,
  MOD_HELD_GRENADE,
  MOD_HG_SPLASH,
  MOD_HYPERBLASTER,
  MOD_HIT,
  MOD_RAILGUN,
  SPLASH_BLUE_WATER,
  SPLASH_BROWN_WATER,
  SPLASH_LAVA,
  SPLASH_SLIME,
  SPLASH_UNKNOWN,
  MOVETYPE_BOUNCE,
  MOVETYPE_FLYMISSILE,
  SOLID_NOT,
  SOLID_BBOX,
  SVF_DEADMONSTER,
  SVF_MONSTER,
  linkGameEntity,
  emitGameSound,
  refreshEntitySpatialState,
  registerGameModel,
  registerGameSound,
  spawnGameEntity,
  type GameEntity,
  type GameRuntime
} from "./runtime.js";
import { infront } from "./g_ai.js";
import { CanDamage, T_Damage, T_RadiusDamage } from "./g_combat.js";
import { findradius, vectoangles } from "./g_utils.js";
import { ThrowDebris } from "./g_misc.js";
import { PNOISE_IMPACT, crandom, random } from "./g_local.js";
import { PlayerNoise } from "./p_weapon.js";

/**
 * Original name: N/A
 * Source declaree: N/A (local hook contract)
 * Category: New
 * Purpose: Keep the unresolved world-weapon dependencies explicit while `g_combat.c` and full impact logic are not ported.
 *
 * Constraints:
 * - Must preserve the original function boundaries rather than folding combat logic into spawn helpers.
 */
export interface GameWeaponWorldHooks {
  T_Damage?: (
    targ: GameEntity,
    inflictor: GameEntity,
    attacker: GameEntity,
    dir: vec3_t,
    point: vec3_t,
    normal: vec3_t,
    damage: number,
    knockback: number,
    dflags: number,
    mod: number,
    runtime: GameRuntime
  ) => void;
  G_FreeEdict?: (ent: GameEntity, runtime: GameRuntime) => void;
  Grenade_Explode?: (ent: GameEntity, runtime: GameRuntime) => void;
  Grenade_Touch?: (self: GameEntity, other: GameEntity, runtime: GameRuntime) => void;
  bfg_think?: (ent: GameEntity, runtime: GameRuntime) => void;
  bfg_touch?: (
    self: GameEntity,
    other: GameEntity,
    runtime: GameRuntime,
    plane?: cplane_t | null,
    surf?: csurface_t | null
  ) => void;
  blaster_touch?: (
    self: GameEntity,
    other: GameEntity,
    runtime: GameRuntime,
    plane?: cplane_t | null,
    surf?: csurface_t | null
  ) => void;
  check_dodge?: (self: GameEntity, start: vec3_t, dir: vec3_t, speed: number, runtime: GameRuntime) => void;
  emitTempEntity?: (event: temp_event_t, payload: Record<string, unknown>, runtime: GameRuntime) => void;
  findRadiusEntities?: (origin: vec3_t, radius: number, runtime: GameRuntime) => GameEntity[];
  isDamageable?: (ent: GameEntity) => boolean;
  canDamage?: (target: GameEntity, inflictor: GameEntity, runtime: GameRuntime) => boolean;
  isLaserImmune?: (ent: GameEntity) => boolean;
  playEntitySound?: (ent: GameEntity, soundPath: string, runtime: GameRuntime) => void;
  T_RadiusDamage?: (
    inflictor: GameEntity,
    attacker: GameEntity,
    damage: number,
    ignore: GameEntity | null,
    radius: number,
    mod: number,
    runtime: GameRuntime
  ) => void;
  rocket_touch?: (
    self: GameEntity,
    other: GameEntity,
    runtime: GameRuntime,
    plane?: cplane_t | null,
    surf?: csurface_t | null
  ) => void;
}

/**
 * Original name: fire_hit
 * Source: game/g_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Resolves one melee hit test, damage application and special knockback push on the current enemy.
 *
 * Porting notes:
 * - Damage application remains delegated through `T_Damage`.
 */
export function fire_hit(
  self: GameEntity,
  aim: vec3_t,
  damage: number,
  kick: number,
  runtime: GameRuntime,
  hooks: GameWeaponWorldHooks = {}
): boolean {
  if (!runtime.collision || !self.enemy) {
    return false;
  }

  const enemy = self.enemy;
  const enemyOffset = subtractVec3(enemy.s.origin, self.s.origin);
  let range = vec3Length(enemyOffset);
  if (range > aim[0]) {
    return false;
  }

  let adjustedAimY = aim[1];
  if (adjustedAimY > self.mins[0] && adjustedAimY < self.maxs[0]) {
    range -= enemy.maxs[0];
  } else {
    if (adjustedAimY < 0) {
      adjustedAimY = enemy.mins[0];
    } else {
      adjustedAimY = enemy.maxs[0];
    }
    aim[1] = adjustedAimY;
  }

  let point = addVec3(self.s.origin, scaleVec3(enemyOffset, range));
  const trace = runtime.collision.trace(self.s.origin, [0, 0, 0], [0, 0, 0], point, self, MASK_SHOT);
  const traceEntity = trace.ent as GameEntity | null;
  let damageTarget = traceEntity;
  if (trace.fraction < 1) {
    if (!damageTarget || !isDamageable(damageTarget, hooks)) {
      return false;
    }
    if (((damageTarget.svflags & SVF_MONSTER) !== 0) || damageTarget.client !== null) {
      damageTarget = enemy;
    }
  }

  const vectors = AngleVectors(self.s.angles);
  point = addVec3(self.s.origin, scaleVec3(vectors.forward, range));
  point = addVec3(point, scaleVec3(vectors.right, adjustedAimY));
  point = addVec3(point, scaleVec3(vectors.up, aim[2]));
  const dir = subtractVec3(point, enemy.s.origin);

  if (!damageTarget) {
    return false;
  }

  directDamage(
    damageTarget,
    self,
    self,
    dir,
    point,
    [0, 0, 0],
    damage,
    Math.trunc(kick / 2),
    DAMAGE_NO_KNOCKBACK,
    MOD_HIT,
    runtime,
    hooks
  );

  if ((damageTarget.svflags & SVF_MONSTER) === 0 && !damageTarget.client) {
    return false;
  }

  let pushDir = addVec3(enemy.absmin, scaleVec3(enemy.size, 0.5));
  pushDir = subtractVec3(pushDir, point);
  pushDir = normalizeVec3(pushDir);
  enemy.velocity = addVec3(enemy.velocity, scaleVec3(pushDir, kick));
  if (enemy.velocity[2] > 0) {
    enemy.groundentity = null;
  }
  return true;
}

/**
 * Original name: fire_blaster
 * Source: game/g_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns one blaster or hyperblaster bolt entity with original model, sound and movement state.
 *
 * Porting notes:
 * - Touch and free callbacks are delegated through hooks until the full impact path is ported.
 */
export function fire_blaster(
  self: GameEntity,
  start: vec3_t,
  dir: vec3_t,
  damage: number,
  speed: number,
  effect: number,
  hyper: boolean,
  runtime: GameRuntime,
  hooks: GameWeaponWorldHooks = {}
): GameEntity {
  const bolt = spawnGameEntity(runtime);
  const normalizedDir = normalizeVec3(dir);

  bolt.svflags = SVF_DEADMONSTER;
  bolt.origin = [...start];
  bolt.s.origin = [...start];
  bolt.s.old_origin = [...start];
  bolt.angles = vectoangles(normalizedDir);
  bolt.s.angles = [...bolt.angles];
  bolt.velocity = scaleVec3(normalizedDir, speed);
  bolt.movetype = MOVETYPE_FLYMISSILE;
  bolt.clipmask = MASK_SHOT;
  bolt.solid = SOLID_BBOX;
  bolt.s.effects |= effect;
  bolt.mins = [0, 0, 0];
  bolt.maxs = [0, 0, 0];
  bolt.s.modelindex = registerGameModel(runtime, "models/objects/laser/tris.md2");
  bolt.s.sound = registerGameSound(runtime, "misc/lasfly.wav");
  bolt.owner = self;
  bolt.touch = hooks.blaster_touch ?? (
    (touchSelf, other, localRuntime, plane, surf) => blaster_touch(touchSelf, other, localRuntime, hooks, plane ?? null, surf ?? null)
  );
  bolt.nextthink = runtime.time + 2;
  bolt.think = (thinkSelf, localRuntime) => freeEdict(thinkSelf, localRuntime, hooks);
  bolt.dmg = damage;
  bolt.classname = "bolt";
  if (hyper) {
    bolt.spawnflags = 1;
  }

  refreshEntitySpatialState(bolt);
  linkGameEntity(runtime, bolt);
  if (self.client) {
    (hooks.check_dodge ?? check_dodge)(self, bolt.s.origin, normalizedDir, speed, runtime);
  }

  if (runtime.collision) {
    const trace = runtime.collision.trace(self.s.origin, [0, 0, 0], [0, 0, 0], bolt.s.origin, bolt, MASK_SHOT);
    if (trace.fraction < 1.0 && bolt.touch && trace.ent) {
      bolt.s.origin = addVec3(bolt.s.origin, scaleVec3(normalizedDir, -10));
      bolt.origin = [...bolt.s.origin];
      bolt.touch(bolt, trace.ent as GameEntity, runtime);
    }
  }
  return bolt;
}

/**
 * Original name: fire_grenade
 * Source: game/g_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns one launched grenade projectile with original throw jitter and timer state.
 *
 * Porting notes:
 * - Explosion and touch behavior are delegated through hooks until the full combat path is ported.
 */
export function fire_grenade(
  self: GameEntity,
  start: vec3_t,
  aimdir: vec3_t,
  damage: number,
  speed: number,
  timer: number,
  damageRadius: number,
  runtime: GameRuntime,
  hooks: GameWeaponWorldHooks = {}
): GameEntity {
  const grenade = spawnGameEntity(runtime);
  const vectors = angleVectorsFromDir(aimdir);

  grenade.origin = [...start];
  grenade.s.origin = [...start];
  grenade.velocity = addVec3(
    scaleVec3(aimdir, speed),
    addVec3(
      scaleVec3(vectors.up, 200 + crandom() * 10.0),
      scaleVec3(vectors.right, crandom() * 10.0)
    )
  );
  grenade.avelocity = [300, 300, 300];
  grenade.movetype = MOVETYPE_BOUNCE;
  grenade.clipmask = MASK_SHOT;
  grenade.solid = SOLID_BBOX;
  grenade.s.effects |= EF_GRENADE;
  grenade.mins = [0, 0, 0];
  grenade.maxs = [0, 0, 0];
  grenade.s.modelindex = registerGameModel(runtime, "models/objects/grenade/tris.md2");
  grenade.owner = self;
  grenade.touch = hooks.Grenade_Touch ?? ((touchSelf, other, localRuntime) => Grenade_Touch(touchSelf, other, localRuntime, hooks));
  grenade.nextthink = runtime.time + timer;
  grenade.think = hooks.Grenade_Explode ?? ((thinkSelf, localRuntime) => Grenade_Explode(thinkSelf, localRuntime, hooks));
  grenade.dmg = damage;
  grenade.dmg_radius = damageRadius;
  grenade.classname = "grenade";

  refreshEntitySpatialState(grenade);
  linkGameEntity(runtime, grenade);
  return grenade;
}

/**
 * Original name: fire_grenade2
 * Source: game/g_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns one hand grenade projectile with the alternate model, sound and held flag semantics.
 *
 * Porting notes:
 * - Immediate explode-on-zero-timer follows the original local explode path.
 */
export function fire_grenade2(
  self: GameEntity,
  start: vec3_t,
  aimdir: vec3_t,
  damage: number,
  speed: number,
  timer: number,
  damageRadius: number,
  held: boolean,
  runtime: GameRuntime,
  hooks: GameWeaponWorldHooks = {}
): GameEntity {
  const grenade = spawnGameEntity(runtime);
  const vectors = angleVectorsFromDir(aimdir);

  grenade.origin = [...start];
  grenade.s.origin = [...start];
  grenade.velocity = addVec3(
    scaleVec3(aimdir, speed),
    addVec3(
      scaleVec3(vectors.up, 200 + crandom() * 10.0),
      scaleVec3(vectors.right, crandom() * 10.0)
    )
  );
  grenade.avelocity = [300, 300, 300];
  grenade.movetype = MOVETYPE_BOUNCE;
  grenade.clipmask = MASK_SHOT;
  grenade.solid = SOLID_BBOX;
  grenade.s.effects |= EF_GRENADE;
  grenade.mins = [0, 0, 0];
  grenade.maxs = [0, 0, 0];
  grenade.s.modelindex = registerGameModel(runtime, "models/objects/grenade2/tris.md2");
  grenade.owner = self;
  grenade.touch = hooks.Grenade_Touch ?? ((touchSelf, other, localRuntime) => Grenade_Touch(touchSelf, other, localRuntime, hooks));
  grenade.nextthink = runtime.time + timer;
  grenade.think = hooks.Grenade_Explode ?? ((thinkSelf, localRuntime) => Grenade_Explode(thinkSelf, localRuntime, hooks));
  grenade.dmg = damage;
  grenade.dmg_radius = damageRadius;
  grenade.classname = "hgrenade";
  grenade.spawnflags = held ? 3 : 1;
  grenade.s.sound = registerGameSound(runtime, "weapons/hgrenc1b.wav");

  if (timer <= 0) {
    Grenade_Explode(grenade, runtime, hooks);
    return grenade;
  }

  playEntitySound(self, "weapons/hgrent1a.wav", runtime, hooks);
  refreshEntitySpatialState(grenade);
  linkGameEntity(runtime, grenade);
  return grenade;
}

/**
 * Original name: fire_rocket
 * Source: game/g_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns one rocket projectile with original movement, sound and splash metadata.
 *
 * Porting notes:
 * - Touch and free callbacks are delegated through hooks while preserving the original projectile entity contract.
 */
export function fire_rocket(
  self: GameEntity,
  start: vec3_t,
  dir: vec3_t,
  damage: number,
  speed: number,
  damageRadius: number,
  radiusDamage: number,
  runtime: GameRuntime,
  hooks: GameWeaponWorldHooks = {}
): GameEntity {
  const rocket = spawnGameEntity(runtime);

  rocket.origin = [...start];
  rocket.s.origin = [...start];
  rocket.movedir = [...dir];
  rocket.angles = vectoangles(dir);
  rocket.s.angles = [...rocket.angles];
  rocket.velocity = scaleVec3(dir, speed);
  rocket.movetype = MOVETYPE_FLYMISSILE;
  rocket.clipmask = MASK_SHOT;
  rocket.solid = SOLID_BBOX;
  rocket.s.effects |= EF_ROCKET;
  rocket.mins = [0, 0, 0];
  rocket.maxs = [0, 0, 0];
  rocket.s.modelindex = registerGameModel(runtime, "models/objects/rocket/tris.md2");
  rocket.owner = self;
  rocket.touch = hooks.rocket_touch ?? (
    (touchSelf, other, localRuntime, plane, surf) => rocket_touch(touchSelf, other, localRuntime, hooks, plane ?? null, surf ?? null)
  );
  rocket.nextthink = runtime.time + (8000 / speed);
  rocket.think = (thinkSelf, localRuntime) => freeEdict(thinkSelf, localRuntime, hooks);
  rocket.dmg = damage;
  rocket.radius_dmg = radiusDamage;
  rocket.dmg_radius = damageRadius;
  rocket.s.sound = registerGameSound(runtime, "weapons/rockfly.wav");
  rocket.classname = "rocket";

  refreshEntitySpatialState(rocket);
  if (self.client) {
    (hooks.check_dodge ?? check_dodge)(self, rocket.s.origin, dir, speed, runtime);
  }
  linkGameEntity(runtime, rocket);
  return rocket;
}

/**
 * Original name: fire_bfg
 * Source: game/g_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns one BFG projectile with original model, sound and thinker chain.
 *
 * Porting notes:
 * - Touch/think behavior remains explicit through hooks for runtime adapter boundaries.
 * - Preserves the original raw `dir` vector for `movedir`, angles, velocity and `check_dodge`.
 */
export function fire_bfg(
  self: GameEntity,
  start: vec3_t,
  dir: vec3_t,
  damage: number,
  speed: number,
  damageRadius: number,
  runtime: GameRuntime,
  hooks: GameWeaponWorldHooks = {}
): GameEntity {
  const bfg = spawnGameEntity(runtime);

  bfg.origin = [...start];
  bfg.s.origin = [...start];
  bfg.movedir = [...dir];
  bfg.angles = vectoangles(dir);
  bfg.s.angles = [...bfg.angles];
  bfg.velocity = scaleVec3(dir, speed);
  bfg.movetype = MOVETYPE_FLYMISSILE;
  bfg.clipmask = MASK_SHOT;
  bfg.solid = SOLID_BBOX;
  bfg.s.effects |= EF_BFG | EF_ANIM_ALLFAST;
  bfg.mins = [0, 0, 0];
  bfg.maxs = [0, 0, 0];
  bfg.s.modelindex = registerGameModel(runtime, "sprites/s_bfg1.sp2");
  bfg.owner = self;
  bfg.touch = hooks.bfg_touch ?? (
    (touchSelf, other, localRuntime, plane, surf) => bfg_touch(touchSelf, other, localRuntime, hooks, plane ?? null, surf ?? null)
  );
  bfg.nextthink = runtime.time + 0.1;
  bfg.think = hooks.bfg_think ?? ((thinkSelf, localRuntime) => bfg_think(thinkSelf, localRuntime, hooks));
  bfg.radius_dmg = damage;
  bfg.dmg_radius = damageRadius;
  bfg.classname = "bfg blast";
  bfg.s.sound = registerGameSound(runtime, "weapons/bfg__l1a.wav");
  bfg.teammaster = bfg;
  bfg.teamchain = null;

  refreshEntitySpatialState(bfg);
  if (self.client) {
    (hooks.check_dodge ?? check_dodge)(self, bfg.s.origin, dir, speed, runtime);
  }
  linkGameEntity(runtime, bfg);
  return bfg;
}

/**
 * Original name: fire_bullet
 * Source: game/g_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Fires one bullet round using the shared lead-weapon trace path.
 */
export function fire_bullet(
  self: GameEntity,
  start: vec3_t,
  aimdir: vec3_t,
  damage: number,
  kick: number,
  hspread: number,
  vspread: number,
  mod: number,
  runtime: GameRuntime,
  hooks: GameWeaponWorldHooks = {}
): void {
  fire_lead(self, start, aimdir, damage, kick, temp_event_t.TE_GUNSHOT, hspread, vspread, mod, runtime, hooks);
}

/**
 * Original name: fire_shotgun
 * Source: game/g_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Fires `count` pellets through the shared lead-weapon trace path.
 */
export function fire_shotgun(
  self: GameEntity,
  start: vec3_t,
  aimdir: vec3_t,
  damage: number,
  kick: number,
  hspread: number,
  vspread: number,
  count: number,
  mod: number,
  runtime: GameRuntime,
  hooks: GameWeaponWorldHooks = {}
): void {
  for (let i = 0; i < count; i += 1) {
    fire_lead(self, start, aimdir, damage, kick, temp_event_t.TE_SHOTGUN, hspread, vspread, mod, runtime, hooks);
  }
}

/**
 * Original name: fire_rail
 * Source: game/g_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Resolves the railgun pierce trace and emits the canonical rail trail events.
 *
 * Porting notes:
 * - Damage application remains delegated through `T_Damage`.
 */
export function fire_rail(
  self: GameEntity,
  start: vec3_t,
  aimdir: vec3_t,
  damage: number,
  kick: number,
  runtime: GameRuntime,
  hooks: GameWeaponWorldHooks = {}
): void {
  if (!runtime.collision) {
    return;
  }

  const end = addVec3(start, scaleVec3(aimdir, 8192));
  let from: vec3_t = [...start];
  let ignore: GameEntity | null = self;
  let water = false;
  let lastTrace: trace_t | null = null;
  let mask = MASK_SHOT | CONTENTS_SLIME | CONTENTS_LAVA;

  while (ignore) {
    const trace = runtime.collision.trace(from, [0, 0, 0], [0, 0, 0], end, ignore, mask);
    lastTrace = trace;

    if ((trace.contents & (CONTENTS_SLIME | CONTENTS_LAVA)) !== 0) {
      mask &= ~(CONTENTS_SLIME | CONTENTS_LAVA);
      water = true;
    } else {
      const hit = trace.ent as GameEntity | null;
      if (hit && (((hit.svflags & SVF_MONSTER) !== 0) || hit.client !== null)) {
        ignore = hit;
      } else {
        ignore = null;
      }

      if (hit && hit !== self && isDamageable(hit, hooks)) {
        directDamage(hit, self, self, aimdir, trace.endpos, trace.plane.normal, damage, kick, 0, MOD_RAILGUN, runtime, hooks);
      }
    }

    from = [...trace.endpos];
  }

  if (!lastTrace) {
    return;
  }

  hooks.emitTempEntity?.(temp_event_t.TE_RAILTRAIL, { start, end: lastTrace.endpos }, runtime);
  if (water) {
    hooks.emitTempEntity?.(temp_event_t.TE_RAILTRAIL, { start, end: lastTrace.endpos }, runtime);
  }

  if (self.client) {
    PlayerNoise(self, lastTrace.endpos, PNOISE_IMPACT, runtime);
  }
}

/**
 * Original name: blaster_touch
 * Source: game/g_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Resolves one blaster / hyperblaster impact against damageable targets or world geometry.
 *
 * Porting notes:
 * - Damage, temp-entity emission and free-edict behavior remain delegated through hooks.
 */
export function blaster_touch(
  self: GameEntity,
  other: GameEntity,
  runtime: GameRuntime,
  hooks: GameWeaponWorldHooks = {},
  plane: cplane_t | null = null,
  surf: csurface_t | null = null
): void {
  if (other === self.owner) {
    return;
  }

  if (surf && (surf.flags & SURF_SKY) !== 0) {
    freeEdict(self, runtime, hooks);
    return;
  }

  if (self.owner?.client) {
    PlayerNoise(self.owner, self.s.origin, PNOISE_IMPACT, runtime);
  }

  if (isDamageable(other, hooks)) {
    const mod = (self.spawnflags & 1) !== 0 ? MOD_HYPERBLASTER : MOD_BLASTER;
    directDamage(other, self, self.owner ?? self, self.velocity, self.s.origin, plane?.normal ?? [0, 0, 0], self.dmg, 1, DAMAGE_ENERGY, mod, runtime, hooks);
  } else {
    hooks.emitTempEntity?.(temp_event_t.TE_BLASTER, {
      origin: self.s.origin,
      dir: plane?.normal ?? [0, 0, 0]
    }, runtime);
  }

  freeEdict(self, runtime, hooks);
}

/**
 * Original name: Grenade_Touch
 * Source: game/g_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Resolves grenade bounce vs. sky, bounce sound, or armed impact on a damageable target.
 *
 * Porting notes:
 * - Final explosion logic remains delegated to `Grenade_Explode`.
 */
export function Grenade_Touch(
  ent: GameEntity,
  other: GameEntity,
  runtime: GameRuntime,
  hooks: GameWeaponWorldHooks = {},
  _plane: cplane_t | null = null,
  surf: csurface_t | null = null
): void {
  if (other === ent.owner) {
    return;
  }

  if (surf && (surf.flags & SURF_SKY) !== 0) {
    freeEdict(ent, runtime, hooks);
    return;
  }

  if (!isDamageable(other, hooks)) {
    if ((ent.spawnflags & 1) !== 0) {
      playEntitySound(ent, random() > 0.5 ? "weapons/hgrenb1a.wav" : "weapons/hgrenb2a.wav", runtime, hooks);
    } else {
      playEntitySound(ent, "weapons/grenlb1b.wav", runtime, hooks);
    }
    return;
  }

  ent.enemy = other;
  Grenade_Explode(ent, runtime, hooks);
}

/**
 * Original name: rocket_touch
 * Source: game/g_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Resolves one rocket impact, direct damage, splash damage and explosion temp entity.
 *
 * Porting notes:
 * - Debris throwing uses the ported `ThrowDebris` helper from `g_misc.c`.
 */
export function rocket_touch(
  ent: GameEntity,
  other: GameEntity,
  runtime: GameRuntime,
  hooks: GameWeaponWorldHooks = {},
  plane: cplane_t | null = null,
  surf: csurface_t | null = null
): void {
  if (other === ent.owner) {
    return;
  }

  if (surf && (surf.flags & SURF_SKY) !== 0) {
    freeEdict(ent, runtime, hooks);
    return;
  }

  if (ent.owner?.client) {
    PlayerNoise(ent.owner, ent.s.origin, PNOISE_IMPACT, runtime);
  }

  const origin = addVec3(ent.s.origin, scaleVec3(ent.velocity, -0.02));

  if (isDamageable(other, hooks)) {
    directDamage(other, ent, ent.owner ?? ent, ent.velocity, ent.s.origin, plane?.normal ?? [0, 0, 0], ent.dmg, 0, 0, MOD_ROCKET, runtime, hooks);
  } else if (!runtime.deathmatch && !runtime.coop && surf && (surf.flags & (SURF_WARP | SURF_TRANS33 | SURF_TRANS66 | SURF_FLOWING)) === 0) {
    let n = randomInt(5);
    while (n > 0) {
      ThrowDebris(ent, "models/objects/debris2/tris.md2", 2, ent.s.origin, runtime);
      n -= 1;
    }
  }

  radiusDamage(ent, ent.owner ?? ent, ent.radius_dmg, other, ent.dmg_radius, MOD_R_SPLASH, runtime, hooks);
  hooks.emitTempEntity?.(
    ent.waterlevel > 0 ? temp_event_t.TE_ROCKET_EXPLOSION_WATER : temp_event_t.TE_ROCKET_EXPLOSION,
    { origin },
    runtime
  );
  freeEdict(ent, runtime, hooks);
}

/**
 * Original name: Grenade_Explode
 * Source: game/g_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Resolves direct grenade impact damage, radial splash damage and the original explosion temp-entity selection.
 *
 * Porting notes:
 * - Radius-damage and free-edict behavior remain delegated through explicit hooks.
 */
export function Grenade_Explode(
  ent: GameEntity,
  runtime: GameRuntime,
  hooks: GameWeaponWorldHooks = {}
): void {
  if (ent.owner?.client) {
    PlayerNoise(ent.owner, ent.s.origin, PNOISE_IMPACT, runtime);
  }

  if (ent.enemy) {
    const center = addVec3(ent.enemy.s.origin, scaleVec3(addVec3(ent.enemy.mins, ent.enemy.maxs), 0.5));
    const offset = subtractVec3(ent.s.origin, center);
    const points = ent.dmg - 0.5 * vec3Length(offset);
    const dir = subtractVec3(ent.enemy.s.origin, ent.s.origin);
    const mod = (ent.spawnflags & 1) !== 0 ? MOD_HANDGRENADE : MOD_GRENADE;
    directDamage(ent.enemy, ent, ent.owner ?? ent, dir, ent.s.origin, [0, 0, 0], Math.trunc(points), Math.trunc(points), DAMAGE_RADIUS, mod, runtime, hooks);
  }

  let splashMod: number;
  if ((ent.spawnflags & 2) !== 0) {
    splashMod = MOD_HELD_GRENADE;
  } else if ((ent.spawnflags & 1) !== 0) {
    splashMod = MOD_HG_SPLASH;
  } else {
    splashMod = MOD_G_SPLASH;
  }

  radiusDamage(ent, ent.owner ?? ent, ent.dmg, ent.enemy, ent.dmg_radius, splashMod, runtime, hooks);

  const origin = addVec3(ent.s.origin, scaleVec3(ent.velocity, -0.02));
  if (ent.waterlevel > 0) {
    hooks.emitTempEntity?.(
      ent.groundentity ? temp_event_t.TE_GRENADE_EXPLOSION_WATER : temp_event_t.TE_ROCKET_EXPLOSION_WATER,
      { origin },
      runtime
    );
  } else {
    hooks.emitTempEntity?.(
      ent.groundentity ? temp_event_t.TE_GRENADE_EXPLOSION : temp_event_t.TE_ROCKET_EXPLOSION,
      { origin },
      runtime
    );
  }

  freeEdict(ent, runtime, hooks);
}

/**
 * Original name: bfg_explode
 * Source: game/g_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies the staged BFG area effect over successive frames and frees the projectile on frame 5.
 *
 * Porting notes:
 * - Damage application remains delegated through `T_Damage`, while `findradius` and `CanDamage` now use their source-faithful ports.
 */
export function bfg_explode(
  self: GameEntity,
  runtime: GameRuntime,
  hooks: GameWeaponWorldHooks = {}
): void {
  if (self.s.frame === 0) {
    let ent: GameEntity | null = null;
    while ((ent = findradius(runtime, ent, self.s.origin, self.dmg_radius)) !== null) {
      if (!isDamageable(ent, hooks)) {
        continue;
      }
      if (ent === self.owner) {
        continue;
      }
      if (!hooks.canDamage && !CanDamage(ent, self, runtime)) {
        continue;
      }
      if (hooks.canDamage && !hooks.canDamage(ent, self, runtime)) {
        continue;
      }
      if (self.owner && !hooks.canDamage && !CanDamage(ent, self.owner, runtime)) {
        continue;
      }
      if (self.owner && hooks.canDamage && !hooks.canDamage(ent, self.owner, runtime)) {
        continue;
      }

      const center = addVec3(ent.s.origin, scaleVec3(addVec3(ent.mins, ent.maxs), 0.5));
      const offset = subtractVec3(self.s.origin, center);
      const dist = vec3Length(offset);
      let points = self.radius_dmg * (1.0 - Math.sqrt(dist / self.dmg_radius));
      if (ent === self.owner) {
        points *= 0.5;
      }

      hooks.emitTempEntity?.(temp_event_t.TE_BFG_EXPLOSION, { origin: ent.s.origin }, runtime);
      directDamage(ent, self, self.owner ?? self, self.velocity, ent.s.origin, [0, 0, 0], Math.trunc(points), 0, DAMAGE_ENERGY, MOD_BFG_EFFECT, runtime, hooks);
    }
  }

  self.nextthink = runtime.time + FRAMETIME;
  self.s.frame += 1;
  if (self.s.frame === 5) {
    self.think = (thinkSelf, localRuntime) => freeEdict(thinkSelf, localRuntime, hooks);
  }
}

/**
 * Original name: bfg_touch
 * Source: game/g_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Resolves the initial BFG impact, direct/core splash damage and transition into the staged BFG explosion thinker.
 *
 * Porting notes:
 * - Sound emission falls back to queued gameplay sound events until the audio bridge is fully ported.
 */
export function bfg_touch(
  self: GameEntity,
  other: GameEntity,
  runtime: GameRuntime,
  hooks: GameWeaponWorldHooks = {},
  plane: cplane_t | null = null,
  surf: csurface_t | null = null
): void {
  if (other === self.owner) {
    return;
  }

  if (surf && (surf.flags & SURF_SKY) !== 0) {
    freeEdict(self, runtime, hooks);
    return;
  }

  if (self.owner?.client) {
    PlayerNoise(self.owner, self.s.origin, PNOISE_IMPACT, runtime);
  }

  if (isDamageable(other, hooks)) {
    directDamage(other, self, self.owner ?? self, self.velocity, self.s.origin, plane?.normal ?? [0, 0, 0], 200, 0, 0, MOD_BFG_BLAST, runtime, hooks);
  }

  radiusDamage(self, self.owner ?? self, 200, other, 100, MOD_BFG_BLAST, runtime, hooks);
  playEntitySound(self, "weapons/bfg__x1b.wav", runtime, hooks);

  self.solid = SOLID_NOT;
  self.touch = undefined;
  self.s.origin = addVec3(self.s.origin, scaleVec3(self.velocity, -FRAMETIME));
  self.origin = [...self.s.origin];
  self.velocity = [0, 0, 0];
  self.s.modelindex = registerGameModel(runtime, "sprites/s_bfg3.sp2");
  self.s.frame = 0;
  self.s.sound = 0;
  self.s.effects &= ~EF_ANIM_ALLFAST;
  self.think = (thinkSelf, localRuntime) => bfg_explode(thinkSelf, localRuntime, hooks);
  self.nextthink = runtime.time + FRAMETIME;
  self.enemy = other;
  refreshEntitySpatialState(self);
  linkGameEntity(runtime, self);

  hooks.emitTempEntity?.(temp_event_t.TE_BFG_BIGEXPLOSION, { origin: self.s.origin }, runtime);
}

/**
 * Original name: bfg_think
 * Source: game/g_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the per-frame BFG laser sweeps and applies laser damage along each traced beam.
 *
 * Porting notes:
 * - Beam damage remains delegated through `T_Damage`, while radius enumeration now follows the original `findradius` iteration shape.
 */
export function bfg_think(
  self: GameEntity,
  runtime: GameRuntime,
  hooks: GameWeaponWorldHooks = {}
): void {
  if (!runtime.collision) {
    self.nextthink = runtime.time + FRAMETIME;
    return;
  }

  const dmg = runtime.deathmatch ? 5 : 10;
  let ent: GameEntity | null = null;
  while ((ent = findradius(runtime, ent, self.s.origin, 256)) !== null) {
    if (ent === self || ent === self.owner) {
      continue;
    }
    if (!isDamageable(ent, hooks)) {
      continue;
    }
    if ((ent.svflags & SVF_MONSTER) === 0 && !ent.client && ent.classname !== "misc_explobox") {
      continue;
    }

    const point = addVec3(ent.absmin, scaleVec3(ent.size, 0.5));
    const dir = normalizeVec3(subtractVec3(point, self.s.origin));

    let ignore: GameEntity | null = self;
    let start: vec3_t = [...self.s.origin];
    const end = addVec3(start, scaleVec3(dir, 2048));
    let lastTrace: trace_t | null = null;

    while (true) {
      const tr = runtime.collision.trace(
        start,
        [0, 0, 0],
        [0, 0, 0],
        end,
        ignore,
        CONTENTS_SOLID | CONTENTS_MONSTER | CONTENTS_DEADMONSTER
      );
      lastTrace = tr;

      if (!tr.ent) {
        break;
      }

      const hit = tr.ent as GameEntity;
      if (isDamageable(hit, hooks) && !isLaserImmune(hit, hooks) && hit !== self.owner) {
        directDamage(hit, self, self.owner ?? self, dir, tr.endpos, [0, 0, 0], dmg, 1, DAMAGE_ENERGY, MOD_BFG_LASER, runtime, hooks);
      }

      if ((hit.svflags & SVF_MONSTER) === 0 && !hit.client) {
        hooks.emitTempEntity?.(temp_event_t.TE_LASER_SPARKS, {
          count: 4,
          origin: tr.endpos,
          dir: tr.plane.normal,
          color: self.s.skinnum
        }, runtime);
        break;
      }

      ignore = hit;
      start = [...tr.endpos];
    }

    hooks.emitTempEntity?.(temp_event_t.TE_BFG_LASER, {
      start: self.s.origin,
      end: lastTrace?.endpos ?? end
    }, runtime);
  }

  self.nextthink = runtime.time + FRAMETIME;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Normalize one vector while preserving the zero-vector case safely for early projectile setup.
 */
function normalizeVec3(vector: vec3_t): vec3_t {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length === 0) {
    return [0, 0, 0];
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

/**
 * Original name: check_dodge
 * Source: game/g_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Traces ahead of one non-instant shot and triggers a monster dodge callback when conditions match.
 *
 * Porting notes:
 * - Uses runtime skill/collision state and reuses the existing `infront` gameplay helper.
 */
function check_dodge(
  self: GameEntity,
  start: vec3_t,
  dir: vec3_t,
  speed: number,
  runtime: GameRuntime
): void {
  if (!runtime.collision) {
    return;
  }

  if (runtime.skill === 0 && random() > 0.25) {
    return;
  }

  const end = addVec3(start, scaleVec3(dir, 8192));
  const trace = runtime.collision.trace(start, [0, 0, 0], [0, 0, 0], end, self, MASK_SHOT);
  const hit = trace.ent as GameEntity | null;
  if (!hit) {
    return;
  }

  if (
    (hit.svflags & SVF_MONSTER) !== 0 &&
    hit.health > 0 &&
    hit.monsterinfo.dodge &&
    infront(hit, self)
  ) {
    const v = subtractVec3(trace.endpos, start);
    const eta = (vec3Length(v) - hit.maxs[0]) / speed;
    hit.monsterinfo.dodge(hit, self, eta, runtime);
  }
}

/**
 * Original name: fire_lead
 * Source: game/g_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Resolves one bullet/pellet trace with spread, optional water interaction and impact effects.
 *
 * Porting notes:
 * - Water-course correction and temp-entity emission stay close to the original flow.
 * - Damage application remains delegated through `T_Damage`.
 */
function fire_lead(
  self: GameEntity,
  start: vec3_t,
  aimdir: vec3_t,
  damage: number,
  kick: number,
  teImpact: temp_event_t,
  hspread: number,
  vspread: number,
  mod: number,
  runtime: GameRuntime,
  hooks: GameWeaponWorldHooks
): void {
  if (!runtime.collision) {
    return;
  }

  let water = false;
  let contentMask = MASK_SHOT | MASK_WATER;
  const startTrace = runtime.collision.trace(self.s.origin, [0, 0, 0], [0, 0, 0], start, self, MASK_SHOT);
  if (startTrace.fraction < 1.0) {
    return;
  }

  let dirAngles = vectoangles(aimdir);
  let vectors = AngleVectors(dirAngles);
  let r = crandom() * hspread;
  let u = crandom() * vspread;
  let end = addVec3(addVec3(addVec3(start, scaleVec3(vectors.forward, 8192)), scaleVec3(vectors.right, r)), scaleVec3(vectors.up, u));
  let waterStart: vec3_t = [...start];

  if ((runtime.collision.pointcontents(start, self) & MASK_WATER) !== 0) {
    water = true;
    waterStart = [...start];
    contentMask &= ~MASK_WATER;
  }

  let trace = runtime.collision.trace(start, [0, 0, 0], [0, 0, 0], end, self, contentMask);

  if ((trace.contents & MASK_WATER) !== 0) {
    water = true;
    waterStart = [...trace.endpos];

    if (!vec3Equal(start, trace.endpos)) {
      const color = getSplashColor(trace);
      if (color !== SPLASH_UNKNOWN) {
        hooks.emitTempEntity?.(temp_event_t.TE_SPLASH, {
          count: 8,
          origin: trace.endpos,
          dir: trace.plane.normal,
          color
        }, runtime);
      }

      const redirectedDir = subtractVec3(end, start);
      dirAngles = vectoangles(redirectedDir);
      vectors = AngleVectors(dirAngles);
      r = crandom() * hspread * 2;
      u = crandom() * vspread * 2;
      end = addVec3(addVec3(addVec3(waterStart, scaleVec3(vectors.forward, 8192)), scaleVec3(vectors.right, r)), scaleVec3(vectors.up, u));
    }

    trace = runtime.collision.trace(waterStart, [0, 0, 0], [0, 0, 0], end, self, MASK_SHOT);
  }

  if (!(trace.surface && (trace.surface.flags & SURF_SKY) !== 0) && trace.fraction < 1.0) {
    const hit = trace.ent as GameEntity | null;
    if (hit && isDamageable(hit, hooks)) {
      directDamage(hit, self, self, aimdir, trace.endpos, trace.plane.normal, damage, kick, DAMAGE_BULLET, mod, runtime, hooks);
    } else if (!(trace.surface?.name.startsWith("sky") ?? false)) {
      hooks.emitTempEntity?.(teImpact, { origin: trace.endpos, dir: trace.plane.normal }, runtime);
      if (self.client) {
        PlayerNoise(self, trace.endpos, PNOISE_IMPACT, runtime);
      }
    }
  }

  if (water) {
    const dir = normalizeVec3(subtractVec3(trace.endpos, waterStart));
    const pos = addVec3(trace.endpos, scaleVec3(dir, -2));
    let bubbleEnd = trace.endpos;
    if ((runtime.collision.pointcontents(pos, trace.ent as GameEntity | null) & MASK_WATER) !== 0) {
      bubbleEnd = [...pos];
    } else {
      bubbleEnd = runtime.collision.trace(pos, [0, 0, 0], [0, 0, 0], waterStart, trace.ent as GameEntity | null, MASK_WATER).endpos;
    }

    const mid = scaleVec3(addVec3(waterStart, bubbleEnd), 0.5);
    hooks.emitTempEntity?.(temp_event_t.TE_BUBBLETRAIL, { start: waterStart, end: bubbleEnd, origin: mid }, runtime);
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Reconstruct forward/right/up vectors from one aim direction by mirroring the original `vectoangles` then `AngleVectors` flow.
 */
function angleVectorsFromDir(direction: vec3_t): { forward: vec3_t; right: vec3_t; up: vec3_t } {
  return AngleVectors(vectoangles(direction));
}

/**
 * Original name: N/A
 * Source declaree: N/A (local random helper)
 * Category: New
 * Purpose: Mirror Quake II `rand() % maxExclusive` for small projectile/debris counts.
 */
function randomInt(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local splash helper)
 * Category: New
 * Purpose: Resolve the original Quake II splash color from one water-impact trace.
 */
function getSplashColor(trace: trace_t): number {
  if ((trace.contents & MASK_WATER) === 0) {
    return SPLASH_UNKNOWN;
  }
  if ((trace.contents & CONTENTS_SLIME) !== 0) {
    return SPLASH_SLIME;
  }
  if ((trace.contents & CONTENTS_LAVA) !== 0) {
    return SPLASH_LAVA;
  }
  if (trace.surface?.name === "*brwater") {
    return SPLASH_BROWN_WATER;
  }
  return SPLASH_BLUE_WATER;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local combat bridge)
 * Category: New
 * Purpose: Test damageability through the explicit hook first, with a conservative health-based fallback.
 */
function isDamageable(entity: GameEntity, hooks: GameWeaponWorldHooks): boolean {
  if (hooks.isDamageable) {
    return hooks.isDamageable(entity);
  }
  return entity.takedamage !== 0 || entity.health > 0;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local runtime bridge)
 * Category: New
 * Purpose: Preserve the original `G_FreeEdict` dependency with a direct runtime fallback.
 */
function freeEdict(entity: GameEntity, runtime: GameRuntime, hooks: GameWeaponWorldHooks): void {
  if (hooks.G_FreeEdict) {
    hooks.G_FreeEdict(entity, runtime);
    return;
  }
  freeGameEntity(runtime, entity);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local audio bridge)
 * Category: New
 * Purpose: Preserve immediate weapon sound call sites while falling back to simple registration until the audio gameplay bridge is fully ported.
 */
function playEntitySound(entity: GameEntity, soundPath: string, runtime: GameRuntime, hooks: GameWeaponWorldHooks): void {
  if (hooks.playEntitySound) {
    hooks.playEntitySound(entity, soundPath, runtime);
    return;
  }
  emitGameSound(runtime, entity, soundPath);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local combat bridge)
 * Category: New
 * Purpose: Preserve the original `T_RadiusDamage` call sites while falling back to the strict partial combat port.
 */
function radiusDamage(
  inflictor: GameEntity,
  attacker: GameEntity,
  damage: number,
  ignore: GameEntity | null,
  radius: number,
  mod: number,
  runtime: GameRuntime,
  hooks: GameWeaponWorldHooks
): void {
  if (hooks.T_RadiusDamage) {
    hooks.T_RadiusDamage(inflictor, attacker, damage, ignore, radius, mod, runtime);
    return;
  }

  const combatHooks = hooks.T_Damage ? { T_Damage: hooks.T_Damage } : {};
  T_RadiusDamage(inflictor, attacker, damage, ignore, radius, mod, runtime, combatHooks);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local combat bridge)
 * Category: New
 * Purpose: Preserve the original `T_Damage` call sites while falling back to the partial combat port already available.
 */
function directDamage(
  targ: GameEntity,
  inflictor: GameEntity,
  attacker: GameEntity,
  dir: vec3_t,
  point: vec3_t,
  normal: vec3_t,
  damage: number,
  knockback: number,
  dflags: number,
  mod: number,
  runtime: GameRuntime,
  hooks: GameWeaponWorldHooks
): void {
  if (hooks.T_Damage) {
    hooks.T_Damage(targ, inflictor, attacker, dir, point, normal, damage, knockback, dflags, mod, runtime);
    return;
  }

  const combatHooks = hooks.emitTempEntity ? { emitTempEntity: hooks.emitTempEntity } : {};
  T_Damage(targ, inflictor, attacker, dir, point, normal, damage, knockback, dflags, mod, runtime, combatHooks);
}


/**
 * Original name: N/A
 * Source declaree: N/A (local combat bridge)
 * Category: New
 * Purpose: Preserve the original `FL_IMMUNE_LASER` test while keeping the hook override explicit.
 */
function isLaserImmune(entity: GameEntity, hooks: GameWeaponWorldHooks): boolean {
  if (hooks.isLaserImmune) {
    return hooks.isLaserImmune(entity);
  }
  return (entity.flags & FL_IMMUNE_LASER) !== 0;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Compare two vectors exactly for the Quake-style zero-delta checks used in the projectile helpers.
 */
function vec3Equal(left: vec3_t, right: vec3_t): boolean {
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Add two 3D vectors without mutating either input.
 */
function addVec3(left: vec3_t, right: vec3_t): vec3_t {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Subtract two 3D vectors without mutating either input.
 */
function subtractVec3(left: vec3_t, right: vec3_t): vec3_t {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Scale one 3D vector without mutating the input.
 */
function scaleVec3(vector: vec3_t, scalar: number): vec3_t {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Compute one vector length for the direct arithmetic mirrors kept close to the original C flow.
 */
function vec3Length(vector: vec3_t): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}
