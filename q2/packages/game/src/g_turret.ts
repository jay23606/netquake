/**
 * File: g_turret.ts
 * Source: Quake II original / game/g_turret.c
 * Purpose: Port of turret brush entities, breach aiming and infantry-driver control.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Spawn-temp fields are read from parsed entity properties instead of the original global `st`.
 * - `turret_breach_fire` queues a positioned gameplay sound event instead of calling `gi.positioned_sound` directly.
 * - `turret_driver_die` keeps the turret-specific unlink semantics explicit before calling the ported infantry death handler.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

import {
  AngleVectors,
  ATTN_NORM,
  CHAN_WEAPON,
  MASK_MONSTERSOLID,
  M_PI,
  PITCH,
  RF_FRAMELERP,
  YAW,
  type vec3_t
} from "../../qcommon/src/index.js";
import {
  AI_DUCKED,
  AI_LOST_SIGHT,
  AI_STAND_GROUND,
  FL_NO_KNOCKBACK,
  FL_TEAMSLAVE,
  FRAMETIME,
  MOD_CRUSH,
  SVF_MONSTER,
  damage_t,
  random
} from "./g_local.js";
import { FindTarget, visible } from "./g_ai.js";
import { T_Damage } from "./g_combat.js";
import { FindItemByClassname } from "./g_items.js";
import { monster_use } from "./g_monster.js";
import { G_FreeEdict, G_PickTarget, vectoangles, vtos } from "./g_utils.js";
import { fire_rocket } from "./g_weapon.js";
import { infantry_die, infantry_stand } from "./m_infantry.js";
import {
  MOVETYPE_PUSH,
  SOLID_BBOX,
  SOLID_BSP,
  emitGameSound,
  emitRegisteredGameSound,
  linkGameEntity,
  registerGameSound,
  refreshEntitySpatialState,
  registerGameModel,
  setGameEntityModel,
  type GameEntity,
  type GameRuntime
} from "./runtime.js";

/**
 * Original name: N/A
 * Source: N/A (named local magic spawnflag)
 * Category: New
 * Purpose: Names the original `65536` fire-request bit used by the turret driver/breach handshake.
 */
const TURRET_BREACH_FIRE = 65536;

/**
 * Original name: N/A
 * Source: N/A (local helper constant)
 * Category: New
 * Purpose: Shared zero vector for turret damage calls that used `vec3_origin` in C.
 */
const ZERO_VEC3: vec3_t = [0, 0, 0];

/**
 * Original name: AnglesNormalize
 * Source: game/g_turret.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Wraps pitch and yaw into the original `[0, 360]` interval used by turret angle clamping.
 */
export function AnglesNormalize(vec: vec3_t): void {
  while (vec[0] > 360) {
    vec[0] -= 360;
  }
  while (vec[0] < 0) {
    vec[0] += 360;
  }
  while (vec[1] > 360) {
    vec[1] -= 360;
  }
  while (vec[1] < 0) {
    vec[1] += 360;
  }
}

/**
 * Original name: SnapToEights
 * Source: game/g_turret.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Rounds one coordinate to the nearest eighth with the original sign-sensitive bias.
 */
export function SnapToEights(x: number): number {
  let value = x * 8.0;
  if (value > 0.0) {
    value += 0.5;
  } else {
    value -= 0.5;
  }
  return 0.125 * Math.trunc(value);
}

/**
 * Original name: turret_blocked
 * Source: game/g_turret.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Crush-damages the blocking entity using the turret owner when present.
 */
export function turret_blocked(self: GameEntity, other: GameEntity, runtime: GameRuntime): void {
  if (!other.takedamage) {
    return;
  }

  const teammaster = self.teammaster ?? self;
  const attacker = teammaster.owner ?? teammaster;
  T_Damage(
    other,
    self,
    attacker,
    ZERO_VEC3,
    other.s.origin,
    ZERO_VEC3,
    teammaster.dmg,
    10,
    0,
    MOD_CRUSH,
    runtime
  );
}

/**
 * Original name: turret_breach_fire
 * Source: game/g_turret.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Fires one rocket from the breach muzzle target offset using the owning driver as attacker.
 * - Preserves the original integer damage/speed truncation and positioned fire sound.
 */
export function turret_breach_fire(self: GameEntity, runtime: GameRuntime): void {
  const teammaster = self.teammaster ?? self;
  const attacker = teammaster.owner;
  if (!attacker) {
    return;
  }

  const { forward, right, up } = AngleVectors(self.s.angles);
  let start: vec3_t = [...self.s.origin];
  start = vectorMA(start, self.move_origin[0], forward);
  start = vectorMA(start, self.move_origin[1], right);
  start = vectorMA(start, self.move_origin[2], up);

  const damage = Math.trunc(100 + (random() * 50));
  const speed = Math.trunc(550 + 50 * runtime.skill);
  fire_rocket(attacker, start, forward, damage, speed, 150, damage, runtime);
  emitRegisteredGameSound(runtime, self, registerGameSound(runtime, "weapons/rocklf1a.wav"), "weapons/rocklf1a.wav", {
    origin: start,
    channel: CHAN_WEAPON,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
}

/**
 * Original name: turret_breach_think
 * Source: game/g_turret.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Clamps requested turret angles, rotates toward them and keeps all team parts plus optional driver in sync.
 *
 * Porting notes:
 * - C locals `ent`, `angle`, `target_z` and `diff` are preserved as block-scoped TypeScript locals.
 */
export function turret_breach_think(self: GameEntity, runtime: GameRuntime): void {
  const current_angles: vec3_t = [...self.s.angles];
  AnglesNormalize(current_angles);

  AnglesNormalize(self.move_angles);
  if (self.move_angles[PITCH] > 180) {
    self.move_angles[PITCH] -= 360;
  }

  if (self.move_angles[PITCH] > self.pos1[PITCH]) {
    self.move_angles[PITCH] = self.pos1[PITCH];
  } else if (self.move_angles[PITCH] < self.pos2[PITCH]) {
    self.move_angles[PITCH] = self.pos2[PITCH];
  }

  if (self.move_angles[YAW] < self.pos1[YAW] || self.move_angles[YAW] > self.pos2[YAW]) {
    let dmin = Math.abs(self.pos1[YAW] - self.move_angles[YAW]);
    if (dmin < -180) {
      dmin += 360;
    } else if (dmin > 180) {
      dmin -= 360;
    }

    let dmax = Math.abs(self.pos2[YAW] - self.move_angles[YAW]);
    if (dmax < -180) {
      dmax += 360;
    } else if (dmax > 180) {
      dmax -= 360;
    }

    if (Math.abs(dmin) < Math.abs(dmax)) {
      self.move_angles[YAW] = self.pos1[YAW];
    } else {
      self.move_angles[YAW] = self.pos2[YAW];
    }
  }

  const delta = subtractVec3(self.move_angles, current_angles);
  delta[0] = wrapAngleDelta(delta[0]);
  delta[1] = wrapAngleDelta(delta[1]);
  delta[2] = 0;

  const maxFrameDelta = self.speed * FRAMETIME;
  delta[0] = clamp(delta[0], -maxFrameDelta, maxFrameDelta);
  delta[1] = clamp(delta[1], -maxFrameDelta, maxFrameDelta);

  self.avelocity = scaleVec3(delta, 1.0 / FRAMETIME);
  self.nextthink = runtime.time + FRAMETIME;

  for (let ent: GameEntity | null = self.teammaster ?? self; ent; ent = ent.teamchain) {
    ent.avelocity[1] = self.avelocity[1];
  }

  if (self.owner) {
    self.owner.avelocity[0] = self.avelocity[0];
    self.owner.avelocity[1] = self.avelocity[1];

    let angle = self.s.angles[1] + self.owner.move_origin[1];
    angle *= (M_PI * 2 / 360);

    const target: vec3_t = [
      SnapToEights(self.s.origin[0] + Math.cos(angle) * self.owner.move_origin[0]),
      SnapToEights(self.s.origin[1] + Math.sin(angle) * self.owner.move_origin[0]),
      self.owner.s.origin[2]
    ];

    const dir = subtractVec3(target, self.owner.s.origin);
    self.owner.velocity[0] = dir[0] * 1.0 / FRAMETIME;
    self.owner.velocity[1] = dir[1] * 1.0 / FRAMETIME;

    angle = self.s.angles[PITCH] * (M_PI * 2 / 360);
    const target_z = SnapToEights(self.s.origin[2] + self.owner.move_origin[0] * Math.tan(angle) + self.owner.move_origin[2]);
    const diff = target_z - self.owner.s.origin[2];
    self.owner.velocity[2] = diff * 1.0 / FRAMETIME;

    if ((self.spawnflags & TURRET_BREACH_FIRE) !== 0) {
      turret_breach_fire(self, runtime);
      self.spawnflags &= ~TURRET_BREACH_FIRE;
    }
  }
}

/**
 * Original name: turret_breach_finish_init
 * Source: game/g_turret.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Resolves the muzzle target offset, copies damage to the turret team master and arms the regular think loop.
 */
export function turret_breach_finish_init(self: GameEntity, runtime: GameRuntime): void {
  if (!self.target) {
    runtime.log({
      kind: "warning",
      message: `${self.classname} at ${vtos(self.s.origin)} needs a target`,
      entityIndex: self.index,
      entityClassname: self.classname
    });
  } else {
    self.target_ent = G_PickTarget(runtime, self.target);
    if (self.target_ent) {
      self.move_origin = subtractVec3(self.target_ent.s.origin, self.s.origin);
      G_FreeEdict(runtime, self.target_ent);
      self.target_ent = null;
    }
  }

  (self.teammaster ?? self).dmg = self.dmg;
  self.think = turret_breach_think;
  self.think(self, runtime);
}

/**
 * Original name: SP_turret_breach
 * Source: game/g_turret.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes the pitch/yaw turret breach, default clamps and deferred muzzle-target setup.
 */
export function SP_turret_breach(self: GameEntity, runtime: GameRuntime): void {
  self.solid = SOLID_BSP;
  self.movetype = MOVETYPE_PUSH;
  if (self.model) {
    setGameEntityModel(runtime, self, self.model);
  }

  if (!self.speed) {
    self.speed = 50;
  }
  if (!self.dmg) {
    self.dmg = 10;
  }

  const minpitch = parseEntityFloat(self, "minpitch", -30);
  const maxpitch = parseEntityFloat(self, "maxpitch", 30);
  const minyaw = parseEntityFloat(self, "minyaw", 0);
  const maxyaw = parseEntityFloat(self, "maxyaw", 360);

  self.pos1[PITCH] = -1 * minpitch;
  self.pos1[YAW] = minyaw;
  self.pos2[PITCH] = -1 * maxpitch;
  self.pos2[YAW] = maxyaw;

  self.ideal_yaw = self.s.angles[YAW];
  self.move_angles[YAW] = self.ideal_yaw;
  self.blocked = turret_blocked;
  self.think = turret_breach_finish_init;
  self.nextthink = runtime.time + FRAMETIME;

  refreshEntitySpatialState(self);
  linkGameEntity(runtime, self);
}

/**
 * Original name: SP_turret_base
 * Source: game/g_turret.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes the yaw-only turret base brush entity.
 */
export function SP_turret_base(self: GameEntity, runtime: GameRuntime): void {
  self.solid = SOLID_BSP;
  self.movetype = MOVETYPE_PUSH;
  if (self.model) {
    setGameEntityModel(runtime, self, self.model);
  }
  self.blocked = turret_blocked;

  refreshEntitySpatialState(self);
  linkGameEntity(runtime, self);
}

/**
 * Original name: turret_driver_die
 * Source: game/g_turret.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Levels the turret, removes the driver from the turret team chain and applies infantry-style death cleanup.
 */
export function turret_driver_die(
  self: GameEntity,
  inflictor: GameEntity | null,
  attacker: GameEntity | null,
  damage: number,
  runtime: GameRuntime
): void {
  const target = self.target_ent;
  if (target) {
    target.move_angles[0] = 0;

    let ent: GameEntity | null = target.teammaster ?? target;
    while (ent) {
      if (ent.teamchain === self) {
        ent.teamchain = null;
        break;
      }

      ent = ent.teamchain;
    }

    target.owner = null;
    (target.teammaster ?? target).owner = null;
  }

  self.teammaster = null;
  self.flags &= ~FL_TEAMSLAVE;
  infantry_die(self, inflictor, attacker, damage, runtime);
}

/**
 * Original name: turret_driver_think
 * Source: game/g_turret.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Acquires enemies, steers the breach toward them and arms the deferred firing flag after the original reaction time.
 *
 * Porting notes:
 * - The C local `reaction_time` is kept as a local constant derived from `skill->value`.
 */
export function turret_driver_think(self: GameEntity, runtime: GameRuntime): void {
  self.nextthink = runtime.time + FRAMETIME;

  if (self.enemy && (!self.enemy.inuse || self.enemy.health <= 0)) {
    self.enemy = null;
  }

  if (!self.enemy) {
    if (!FindTarget(self, runtime)) {
      return;
    }
    self.monsterinfo.trail_time = runtime.time;
    self.monsterinfo.aiflags &= ~AI_LOST_SIGHT;
  } else if (visible(self, self.enemy, runtime)) {
    if ((self.monsterinfo.aiflags & AI_LOST_SIGHT) !== 0) {
      self.monsterinfo.trail_time = runtime.time;
      self.monsterinfo.aiflags &= ~AI_LOST_SIGHT;
    }
  } else {
    self.monsterinfo.aiflags |= AI_LOST_SIGHT;
    return;
  }

  if (!self.target_ent || !self.enemy) {
    return;
  }

  const target: vec3_t = [...self.enemy.s.origin];
  target[2] += self.enemy.viewheight;
  const dir = subtractVec3(target, self.target_ent.s.origin);
  self.target_ent.move_angles = vectoangles(dir);

  if (runtime.time < self.monsterinfo.attack_finished) {
    return;
  }

  const reaction_time = (3 - runtime.skill) * 1.0;
  if ((runtime.time - self.monsterinfo.trail_time) < reaction_time) {
    return;
  }

  self.monsterinfo.attack_finished = runtime.time + reaction_time + 1.0;
  self.target_ent.spawnflags |= TURRET_BREACH_FIRE;
}

/**
 * Original name: turret_driver_link
 * Source: game/g_turret.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Links the infantry driver to its turret breach, computes its local mount offset and appends it to the turret team chain.
 *
 * Porting notes:
 * - The C local `ent` is kept as a local cursor over the turret team chain.
 */
export function turret_driver_link(self: GameEntity, runtime: GameRuntime): void {
  self.think = turret_driver_think;
  self.nextthink = runtime.time + FRAMETIME;

  self.target_ent = G_PickTarget(runtime, self.target);
  if (!self.target_ent) {
    runtime.log({
      kind: "warning",
      message: `${self.classname} at ${vtos(self.s.origin)} could not find turret target ${self.target ?? ""}`,
      entityIndex: self.index,
      entityClassname: self.classname
    });
    return;
  }

  self.target_ent.owner = self;
  (self.target_ent.teammaster ?? self.target_ent).owner = self;
  self.s.angles = [...self.target_ent.s.angles];
  self.angles = [...self.target_ent.s.angles];

  const vec: vec3_t = [
    self.target_ent.s.origin[0] - self.s.origin[0],
    self.target_ent.s.origin[1] - self.s.origin[1],
    0
  ];
  self.move_origin[0] = vectorLength(vec);

  const relative = subtractVec3(self.s.origin, self.target_ent.s.origin);
  const angles = vectoangles(relative);
  AnglesNormalize(angles);
  self.move_origin[1] = angles[1];
  self.move_origin[2] = self.s.origin[2] - self.target_ent.s.origin[2];

  let ent = self.target_ent.teammaster ?? self.target_ent;
  while (ent.teamchain) {
    ent = ent.teamchain;
  }
  ent.teamchain = self;
  self.teammaster = self.target_ent.teammaster ?? self.target_ent;
  self.flags |= FL_TEAMSLAVE;
}

/**
 * Original name: SP_turret_driver
 * Source: game/g_turret.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes the infantry driver entity that targets and fires the turret breach.
 *
 * Porting notes:
 * - Reads the original spawn-temp `st.item` value from parsed entity `properties.item`.
 */
export function SP_turret_driver(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  self.movetype = MOVETYPE_PUSH;
  self.solid = SOLID_BBOX;
  self.model = "models/monsters/infantry/tris.md2";
  self.s.modelindex = registerGameModel(runtime, self.model);
  self.mins = [-16, -16, -24];
  self.maxs = [16, 16, 32];

  self.health = 100;
  self.gib_health = 0;
  self.mass = 200;
  self.viewheight = 24;

  self.die = turret_driver_die;
  self.monsterinfo.stand = infantry_stand;
  self.flags |= FL_NO_KNOCKBACK;

  runtime.total_monsters += 1;
  self.svflags |= SVF_MONSTER;
  self.s.renderfx |= RF_FRAMELERP;
  self.takedamage = damage_t.DAMAGE_AIM;
  self.use = (useSelf, other, activator, localRuntime) => monster_use(useSelf, other, activator, localRuntime);
  self.clipmask = MASK_MONSTERSOLID;
  self.s.old_origin = [...self.s.origin];
  self.monsterinfo.aiflags |= AI_STAND_GROUND | AI_DUCKED;

  const itemClassname = self.properties.item;
  if (itemClassname) {
    self.item = FindItemByClassname(itemClassname);
    if (!self.item) {
      runtime.log({
        kind: "warning",
        message: `${self.classname} at ${vtos(self.s.origin)} has bad item: ${itemClassname}`,
        entityIndex: self.index,
        entityClassname: self.classname
      });
    }
  }

  self.think = turret_driver_link;
  self.nextthink = runtime.time + FRAMETIME;

  refreshEntitySpatialState(self);
  linkGameEntity(runtime, self);
}

/**
 * Original name: N/A
 * Source: N/A (spawn property adapter)
 * Category: New
 * Purpose: Reads spawn-temp style turret fields from parsed entity properties.
 */
function parseEntityFloat(entity: GameEntity, key: string, fallback: number): number {
  const raw = entity.properties[key];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Applies the local `[-180, 180]` wrap used by turret angular deltas.
 */
function wrapAngleDelta(value: number): number {
  if (value < -180) {
    return value + 360;
  }
  if (value > 180) {
    return value - 360;
  }
  return value;
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Local immutable equivalent of the C `VectorMA` macro for turret muzzle offsets.
 */
function vectorMA(start: vec3_t, scale: number, direction: vec3_t): vec3_t {
  return [
    start[0] + direction[0] * scale,
    start[1] + direction[1] * scale,
    start[2] + direction[2] * scale
  ];
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Local immutable vector subtraction helper for turret calculations.
 */
function subtractVec3(left: vec3_t, right: vec3_t): vec3_t {
  return [
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2]
  ];
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Local immutable vector scale helper for turret angular velocity.
 */
function scaleVec3(vector: vec3_t, scale: number): vec3_t {
  return [
    vector[0] * scale,
    vector[1] * scale,
    vector[2] * scale
  ];
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Local vector length helper for turret driver mount distance.
 */
function vectorLength(vector: vec3_t): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Clamps turret frame deltas to the configured angular speed.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
