/**
 * File: g_combat.ts
 * Source: Quake II original / game/g_combat.c
 * Purpose: Port of Quake II gameplay combat helpers and damage resolution.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - `SpawnDamage` still emits through the explicit temp-entity hook path used by the current runtime.
 * - Monster death-use dispatch is registered by `g_monster.ts` and can still be overridden through hooks.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

import { AngleVectors, MASK_SOLID, temp_event_t, type trace_t, type vec3_t } from "../../qcommon/src/index.js";
import { FoundTarget, visible } from "./g_ai.js";
import { OnSameTeam } from "./g_cmds.js";
import { AI_DUCKED, AI_GOOD_GUY, AI_SOUND_TARGET, FL_FLY, FL_SWIM } from "./g_local.js";
import {
  DAMAGE_BULLET,
  DAMAGE_ENERGY,
  DAMAGE_NO_ARMOR,
  DAMAGE_NO_KNOCKBACK,
  DAMAGE_NO_PROTECTION,
  DAMAGE_RADIUS,
  DEAD_DEAD,
  DF_MODELTEAMS,
  DF_NO_FRIENDLY_FIRE,
  DF_SKINTEAMS,
  FL_GODMODE,
  FL_NO_KNOCKBACK,
  MOD_FRIENDLY_FIRE,
  MOVETYPE_BOUNCE,
  MOVETYPE_NONE,
  MOVETYPE_PUSH,
  MOVETYPE_STOP,
  POWER_ARMOR_NONE,
  POWER_ARMOR_SCREEN,
  POWER_ARMOR_SHIELD,
  type GameEntity,
  type GameRuntime,
  SVF_MONSTER,
  emitGameSound
} from "./runtime.js";
import { findradius } from "./g_utils.js";
import { ArmorIndex, FindItem, GetArmorInfoByItem, GetItemByIndex, PowerArmorType } from "./g_items.js";

/**
 * Original name: N/A
 * Source declaree: N/A (runtime hook contract)
 * Category: New
 * Purpose: Keep the not-yet-ported damage core explicit while porting the autonomous combat helpers around it.
 *
 * Constraints:
 * - Must not invent a second damage model beside `T_Damage`.
 */
export interface GameCombatHooks {
  emitTempEntity?: (event: temp_event_t, payload: Record<string, unknown>, runtime: GameRuntime) => void;
  CheckArmor?: (
    ent: GameEntity,
    point: vec3_t,
    normal: vec3_t,
    damage: number,
    teSparks: temp_event_t,
    dflags: number,
    runtime: GameRuntime
  ) => number;
  CheckPowerArmor?: (
    ent: GameEntity,
    point: vec3_t,
    normal: vec3_t,
    damage: number,
    dflags: number,
    runtime: GameRuntime
  ) => number;
  CheckTeamDamage?: (targ: GameEntity, attacker: GameEntity, runtime: GameRuntime) => boolean;
  Killed?: (
    targ: GameEntity,
    inflictor: GameEntity,
    attacker: GameEntity,
    damage: number,
    point: vec3_t,
    runtime: GameRuntime
  ) => void;
  M_ReactToDamage?: (targ: GameEntity, attacker: GameEntity, runtime: GameRuntime) => void;
  monsterDeathUse?: (targ: GameEntity, runtime: GameRuntime) => void;
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
}

/**
 * Original name: N/A
 * Source declaree: N/A (local adapter type)
 * Category: New
 * Purpose: Describe the registered callback used to dispatch the ported `monster_death_use` without importing `g_monster.ts`.
 */
type MonsterDeathUseDispatcher = (targ: GameEntity, runtime: GameRuntime) => void;

/**
 * Original name: N/A
 * Source declaree: N/A (local adapter state)
 * Category: New
 * Purpose: Store the runtime callback registered by `g_monster.ts` for `Killed` monster death-use dispatch.
 */
var defaultMonsterDeathUse: MonsterDeathUseDispatcher | undefined;

/**
 * Original name: N/A
 * Source declaree: N/A (local adapter registration)
 * Category: Adapter
 * Purpose: Let `g_monster.ts` provide the original `monster_death_use` callback without a hard import cycle.
 */
export function setDefaultMonsterDeathUse(dispatcher: MonsterDeathUseDispatcher): void {
  defaultMonsterDeathUse = dispatcher;
}

/**
 * Original name: CheckPowerArmor
 * Source: Quake-2-master/game/g_combat.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Consumes active power armor exactly like the original client/monster split, including the screen frontal test and per-cell absorption rules.
 */
export function CheckPowerArmor(
  ent: GameEntity,
  point: vec3_t,
  normal: vec3_t,
  damage: number,
  dflags: number,
  runtime: GameRuntime,
  hooks: GameCombatHooks = {}
): number {
  if (!damage) {
    return 0;
  }

  if ((dflags & DAMAGE_NO_ARMOR) !== 0) {
    return 0;
  }

  let powerArmorType = POWER_ARMOR_NONE;
  let power = 0;
  let index = 0;

  const client = ent.client;
  if (client) {
    powerArmorType = PowerArmorType(ent);
    if (powerArmorType !== POWER_ARMOR_NONE) {
      const cells = FindItem("Cells");
      if (!cells) {
        return 0;
      }

      index = cells.index;
      power = client.pers.inventory[index];
    }
  } else if ((ent.svflags & SVF_MONSTER) !== 0) {
    powerArmorType = ent.monsterinfo.power_armor_type;
    power = ent.monsterinfo.power_armor_power;
  } else {
    return 0;
  }

  if (powerArmorType === POWER_ARMOR_NONE || !power) {
    return 0;
  }

  let damagePerCell: number;
  let paTeType: temp_event_t;
  let adjustedDamage: number;

  if (powerArmorType === POWER_ARMOR_SCREEN) {
    const forward = AngleVectors(ent.s.angles).forward;
    const vec = normalizeVec3(subtractVec3(point, ent.s.origin));
    const dot = dotProduct(vec, forward);
    if (dot <= 0.3) {
      return 0;
    }

    damagePerCell = 1;
    paTeType = temp_event_t.TE_SCREEN_SPARKS;
    adjustedDamage = Math.trunc(damage / 3);
  } else {
    damagePerCell = 2;
    paTeType = temp_event_t.TE_SHIELD_SPARKS;
    adjustedDamage = Math.trunc((2 * damage) / 3);
  }

  let save = power * damagePerCell;
  if (!save) {
    return 0;
  }
  if (save > adjustedDamage) {
    save = adjustedDamage;
  }

  SpawnDamage(paTeType, point, normal, save, runtime, hooks);
  ent.powerarmor_time = runtime.time + 0.2;

  const powerUsed = Math.trunc(save / damagePerCell);
  if (client) {
    client.pers.inventory[index] -= powerUsed;
  } else {
    ent.monsterinfo.power_armor_power -= powerUsed;
  }

  return save;
}

/**
 * Original name: CheckArmor
 * Source: Quake-2-master/game/g_combat.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Consumes standard armor from the client inventory according to the original normal vs energy protection rules.
 */
export function CheckArmor(
  ent: GameEntity,
  point: vec3_t,
  normal: vec3_t,
  damage: number,
  teSparks: temp_event_t,
  dflags: number,
  runtime: GameRuntime,
  hooks: GameCombatHooks = {}
): number {
  if (!damage) {
    return 0;
  }

  const client = ent.client;
  if (!client) {
    return 0;
  }

  if ((dflags & DAMAGE_NO_ARMOR) !== 0) {
    return 0;
  }

  const index = ArmorIndex(ent);
  if (!index) {
    return 0;
  }

  const armor = GetItemByIndex(index);
  const armorInfo = GetArmorInfoByItem(armor);
  if (!armorInfo) {
    return 0;
  }

  let save = (dflags & DAMAGE_ENERGY) !== 0
    ? Math.ceil(armorInfo.energy_protection * damage)
    : Math.ceil(armorInfo.normal_protection * damage);

  if (save >= client.pers.inventory[index]) {
    save = client.pers.inventory[index];
  }

  if (!save) {
    return 0;
  }

  client.pers.inventory[index] -= save;
  SpawnDamage(teSparks, point, normal, save, runtime, hooks);
  return save;
}

/**
 * Original name: CanDamage
 * Source: Quake-2-master/game/g_combat.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns whether the inflictor can directly damage the target, matching the original trace-point sequence.
 *
 * Porting notes:
 * - Keeps the bmodel special case and the four offset probes from the original code.
 */
export function CanDamage(targ: GameEntity, inflictor: GameEntity, runtime: GameRuntime): boolean {
  if (!runtime.collision) {
    return true;
  }

  if (targ.movetype === MOVETYPE_PUSH) {
    const dest = scaleVec3(addVec3(targ.absmin, targ.absmax), 0.5);
    const trace = runtime.collision.trace(inflictor.s.origin, [0, 0, 0], [0, 0, 0], dest, inflictor, MASK_SOLID);
    if (trace.fraction === 1.0) {
      return true;
    }
    if (trace.ent === targ) {
      return true;
    }
    return false;
  }

  if (traceCanDamage(inflictor.s.origin, targ.s.origin, inflictor, runtime)) {
    return true;
  }

  const dest1: vec3_t = [targ.s.origin[0] + 15.0, targ.s.origin[1] + 15.0, targ.s.origin[2]];
  if (traceCanDamage(inflictor.s.origin, dest1, inflictor, runtime)) {
    return true;
  }

  const dest2: vec3_t = [targ.s.origin[0] + 15.0, targ.s.origin[1] - 15.0, targ.s.origin[2]];
  if (traceCanDamage(inflictor.s.origin, dest2, inflictor, runtime)) {
    return true;
  }

  const dest3: vec3_t = [targ.s.origin[0] - 15.0, targ.s.origin[1] + 15.0, targ.s.origin[2]];
  if (traceCanDamage(inflictor.s.origin, dest3, inflictor, runtime)) {
    return true;
  }

  const dest4: vec3_t = [targ.s.origin[0] - 15.0, targ.s.origin[1] - 15.0, targ.s.origin[2]];
  return traceCanDamage(inflictor.s.origin, dest4, inflictor, runtime);
}

/**
 * Original name: T_RadiusDamage
 * Source: Quake-2-master/game/g_combat.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Iterates entities found by `findradius`, applies the original distance falloff and forwards each valid hit into `T_Damage`.
 *
 * Porting notes:
 * - Allows focused tests to intercept `T_Damage`, but otherwise dispatches into the ported damage core.
 */
export function T_RadiusDamage(
  inflictor: GameEntity,
  attacker: GameEntity,
  damage: number,
  ignore: GameEntity | null,
  radius: number,
  mod: number,
  runtime: GameRuntime,
  hooks: GameCombatHooks = {}
): void {
  let ent: GameEntity | null = null;

  while ((ent = findradius(runtime, ent, inflictor.s.origin, radius)) !== null) {
    if (ent === ignore) {
      continue;
    }
    if (ent.takedamage === 0) {
      continue;
    }

    const center = addVec3(ent.s.origin, scaleVec3(addVec3(ent.mins, ent.maxs), 0.5));
    const offset = subtractVec3(inflictor.s.origin, center);
    let points = damage - 0.5 * vectorLength(offset);

    if (ent === attacker) {
      points *= 0.5;
    }

    if (points <= 0) {
      continue;
    }
    if (!CanDamage(ent, inflictor, runtime)) {
      continue;
    }

    const dir = subtractVec3(ent.s.origin, inflictor.s.origin);
    if (hooks.T_Damage) {
      hooks.T_Damage(
        ent,
        inflictor,
        attacker,
        dir,
        inflictor.s.origin,
        [0, 0, 0],
        Math.trunc(points),
        Math.trunc(points),
        DAMAGE_RADIUS,
        mod,
        runtime
      );
    } else {
      T_Damage(
        ent,
        inflictor,
        attacker,
        dir,
        inflictor.s.origin,
        [0, 0, 0],
        Math.trunc(points),
        Math.trunc(points),
        DAMAGE_RADIUS,
        mod,
        runtime,
        hooks
      );
    }
  }
}

/**
 * Original name: SpawnDamage
 * Source: Quake-2-master/game/g_combat.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits one damage temp-entity event at the requested origin and normal.
 *
 * Porting notes:
 * - Preserves the original damage cap side effect even though the C `gi.WriteByte(damage)` line is commented out.
 * - Uses the current explicit temp-entity hook path instead of direct `gi.Write*` calls.
 */
export function SpawnDamage(
  type: temp_event_t,
  origin: vec3_t,
  normal: vec3_t,
  damage: number,
  runtime: GameRuntime,
  hooks: GameCombatHooks = {}
): void {
  const cappedDamage = damage > 255 ? 255 : damage;
  void cappedDamage;
  emitCombatTempEntity(type, {
    origin,
    dir: normal
  }, runtime, hooks);
}

/**
 * Original name: Killed
 * Source: Quake-2-master/game/g_combat.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Finalizes one entity death transition, clamps health, stores the attacker as enemy and dispatches `die`.
 *
 * Porting notes:
 * - Monster-specific bookkeeping and `monster_death_use` remain explicit through the registered monster callback.
 */
export function Killed(
  targ: GameEntity,
  inflictor: GameEntity,
  attacker: GameEntity,
  damage: number,
  point: vec3_t,
  runtime: GameRuntime,
  hooks: GameCombatHooks = {}
): void {
  if (targ.health < -999) {
    targ.health = -999;
  }

  targ.enemy = attacker;

  if ((targ.svflags & SVF_MONSTER) !== 0 && targ.deadflag !== DEAD_DEAD) {
    if ((targ.monsterinfo.aiflags & AI_GOOD_GUY) === 0) {
      incrementKilledMonsters(runtime);
      if (runtime.coop && attacker.client) {
        attacker.client.resp.score += 1;
      }
      if (attacker.classname === "monster_medic") {
        targ.owner = attacker;
      }
    }
  }

  if ((targ.movetype === MOVETYPE_PUSH) || (targ.movetype === MOVETYPE_STOP) || (targ.movetype === MOVETYPE_NONE)) {
    targ.die?.(targ, inflictor, attacker, damage, runtime, point);
    return;
  }

  if ((targ.svflags & SVF_MONSTER) !== 0 && targ.deadflag !== DEAD_DEAD) {
    targ.touch = undefined;
    (hooks.monsterDeathUse ?? defaultMonsterDeathUse)?.(targ, runtime);
  }

  targ.die?.(targ, inflictor, attacker, damage, runtime, point);
}

/**
 * Original name: M_ReactToDamage
 * Source: Quake-2-master/game/g_combat.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Updates one monster's enemy selection in response to incoming damage, preserving the original good-guy, buddy-help and pursuit rules.
 */
export function M_ReactToDamage(targ: GameEntity, attacker: GameEntity, runtime: GameRuntime): void {
  if (!attacker.client && (attacker.svflags & SVF_MONSTER) === 0) {
    return;
  }

  if (attacker === targ || attacker === targ.enemy) {
    return;
  }

  if ((targ.monsterinfo.aiflags & AI_GOOD_GUY) !== 0) {
    if (attacker.client || (attacker.monsterinfo.aiflags & AI_GOOD_GUY) !== 0) {
      return;
    }
  }

  if (attacker.client) {
    targ.monsterinfo.aiflags &= ~AI_SOUND_TARGET;

    if (targ.enemy?.client) {
      if (visible(targ, targ.enemy, runtime)) {
        targ.oldenemy = attacker;
        return;
      }
      targ.oldenemy = targ.enemy;
    }

    targ.enemy = attacker;
    if ((targ.monsterinfo.aiflags & AI_DUCKED) === 0) {
      FoundTarget(targ, runtime);
    }
    return;
  }

  if (
    (targ.flags & (FL_FLY | FL_SWIM)) === (attacker.flags & (FL_FLY | FL_SWIM)) &&
    targ.classname !== attacker.classname &&
    attacker.classname !== "monster_tank" &&
    attacker.classname !== "monster_supertank" &&
    attacker.classname !== "monster_makron" &&
    attacker.classname !== "monster_jorg"
  ) {
    if (targ.enemy?.client) {
      targ.oldenemy = targ.enemy;
    }
    targ.enemy = attacker;
    if ((targ.monsterinfo.aiflags & AI_DUCKED) === 0) {
      FoundTarget(targ, runtime);
    }
  } else if (attacker.enemy === targ) {
    if (targ.enemy?.client) {
      targ.oldenemy = targ.enemy;
    }
    targ.enemy = attacker;
    if ((targ.monsterinfo.aiflags & AI_DUCKED) === 0) {
      FoundTarget(targ, runtime);
    }
  } else if (attacker.enemy && attacker.enemy !== targ) {
    if (targ.enemy?.client) {
      targ.oldenemy = targ.enemy;
    }
    targ.enemy = attacker.enemy;
    if ((targ.monsterinfo.aiflags & AI_DUCKED) === 0) {
      FoundTarget(targ, runtime);
    }
  }
}

/**
 * Original name: CheckTeamDamage
 * Source: Quake-2-master/game/g_combat.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Mirrors the original stubbed team-damage helper, which currently never blocks damage.
 */
export function CheckTeamDamage(targ: GameEntity, attacker: GameEntity, runtime: GameRuntime): boolean {
  void targ;
  void attacker;
  void runtime;
  return false;
}

/**
 * Original name: T_Damage
 * Source: Quake-2-master/game/g_combat.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies one direct damage event, including knockback, godmode/invulnerability checks, damage markers and client damage accumulation.
 *
 * Porting notes:
 * - Focused tests can override armor, team, kill, temp-entity and monster-reaction callbacks through hooks; the default path uses the ported helpers.
 */
export function T_Damage(
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
  hooks: GameCombatHooks = {}
): void {
  if (targ.takedamage === 0) {
    return;
  }

  if (
    targ !== attacker &&
    ((runtime.deathmatch && (runtime.dmflags & (DF_MODELTEAMS | DF_SKINTEAMS)) !== 0) || runtime.coop)
  ) {
    if (OnSameTeam(targ, attacker, runtime)) {
      if ((runtime.dmflags & DF_NO_FRIENDLY_FIRE) !== 0) {
        damage = 0;
      } else {
        mod |= MOD_FRIENDLY_FIRE;
      }
    }
  }
  runtime.meansOfDeath = mod;

  if (runtime.skill === 0 && !runtime.deathmatch && targ.client) {
    damage *= 0.5;
    if (!damage) {
      damage = 1;
    }
  }

  const client = targ.client;
  const teSparks = (dflags & DAMAGE_BULLET) !== 0 ? temp_event_t.TE_BULLET_SPARKS : temp_event_t.TE_SPARKS;
  const normalizedDir = normalizeVec3(dir);

  if ((dflags & DAMAGE_RADIUS) === 0 && (targ.svflags & SVF_MONSTER) !== 0 && attacker.client && !targ.enemy && targ.health > 0) {
    damage *= 2;
  }

  if ((targ.flags & FL_NO_KNOCKBACK) !== 0) {
    knockback = 0;
  }

  if ((dflags & DAMAGE_NO_KNOCKBACK) === 0) {
    if (
      knockback &&
      targ.movetype !== MOVETYPE_NONE &&
      targ.movetype !== MOVETYPE_BOUNCE &&
      targ.movetype !== MOVETYPE_PUSH &&
      targ.movetype !== MOVETYPE_STOP
    ) {
      const mass = targ.mass < 50 ? 50 : targ.mass;
      const scale = targ.client && attacker === targ ? 1600.0 * knockback / mass : 500.0 * knockback / mass;
      targ.velocity = addVec3(targ.velocity, scaleVec3(normalizedDir, scale));
    }
  }

  let take = damage;
  let save = 0;

  if ((targ.flags & FL_GODMODE) !== 0 && (dflags & DAMAGE_NO_PROTECTION) === 0) {
    take = 0;
    save = damage;
    SpawnDamage(teSparks, point, normal, save, runtime, hooks);
  }

  if (client && client.invincible_framenum > runtime.framenum && (dflags & DAMAGE_NO_PROTECTION) === 0) {
    if (targ.pain_debounce_time < runtime.time) {
      emitGameSound(runtime, targ, "items/protect4.wav");
      targ.pain_debounce_time = runtime.time + 2;
    }
    take = 0;
    save = damage;
  }

  const psave = hooks.CheckPowerArmor?.(targ, point, normal, take, dflags, runtime) ?? CheckPowerArmor(targ, point, normal, take, dflags, runtime, hooks);
  take -= psave;

  let asave = hooks.CheckArmor?.(targ, point, normal, take, teSparks, dflags, runtime) ?? CheckArmor(targ, point, normal, take, teSparks, dflags, runtime, hooks);
  take -= asave;
  asave += save;

  if ((dflags & DAMAGE_NO_PROTECTION) === 0 && (hooks.CheckTeamDamage?.(targ, attacker, runtime) ?? CheckTeamDamage(targ, attacker, runtime))) {
    return;
  }

  if (take) {
    SpawnDamage((targ.svflags & SVF_MONSTER) !== 0 || client ? temp_event_t.TE_BLOOD : teSparks, point, normal, take, runtime, hooks);
    targ.health -= take;

    if (targ.health <= 0) {
      if ((targ.svflags & SVF_MONSTER) !== 0 || client) {
        targ.flags |= FL_NO_KNOCKBACK;
      }
      runtime.meansOfDeath = mod;
      if (hooks.Killed) {
        hooks.Killed(targ, inflictor, attacker, take, point, runtime);
      } else {
        Killed(targ, inflictor, attacker, take, point, runtime, hooks);
      }
      return;
    }
  }

  if ((targ.svflags & SVF_MONSTER) !== 0) {
    (hooks.M_ReactToDamage ?? M_ReactToDamage)(targ, attacker, runtime);
    if ((targ.monsterinfo.aiflags & AI_DUCKED) === 0 && take) {
      targ.pain?.(targ, attacker, knockback, take, runtime);
      if (runtime.skill === 3) {
        targ.pain_debounce_time = runtime.time + 5;
      }
    }
  } else if (client) {
    if ((targ.flags & FL_GODMODE) === 0 && take) {
      targ.pain?.(targ, attacker, knockback, take, runtime);
    }
  } else if (take) {
    targ.pain?.(targ, attacker, knockback, take, runtime);
  }

  if (client) {
    client.damage_parmor += psave;
    client.damage_armor += asave;
    client.damage_blood += take;
    client.damage_knockback += knockback;
    client.damage_from = [...point];
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Compute one vec3 dot product for the strict `CheckPowerArmor` screen-facing test.
 */
function dotProduct(left: vec3_t, right: vec3_t): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local trace helper)
 * Category: New
 * Purpose: Run one `MASK_SOLID` trace step used by the strict `CanDamage` port.
 */
function traceCanDamage(
  start: vec3_t,
  end: vec3_t,
  inflictor: GameEntity,
  runtime: GameRuntime
): boolean {
  const trace: trace_t = runtime.collision!.trace(start, [0, 0, 0], [0, 0, 0], end, inflictor, MASK_SOLID);
  return trace.fraction === 1.0;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local temp-entity adapter)
 * Category: New
 * Purpose: Emit one combat temp-entity through the same structured effect path already used elsewhere in the port.
 */
function emitCombatTempEntity(
  event: temp_event_t,
  payload: Record<string, unknown>,
  runtime: GameRuntime,
  hooks: GameCombatHooks
): void {
  hooks.emitTempEntity?.(event, payload, runtime);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local immutable vector wrapper)
 * Category: New
 * Purpose: Add two vectors without mutating either input.
 */
function addVec3(left: vec3_t, right: vec3_t): vec3_t {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local immutable vector wrapper)
 * Category: New
 * Purpose: Subtract two vectors without mutating either input.
 */
function subtractVec3(left: vec3_t, right: vec3_t): vec3_t {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local immutable vector wrapper)
 * Category: New
 * Purpose: Scale one vector without mutating the input.
 */
function scaleVec3(vector: vec3_t, scalar: number): vec3_t {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local immutable vector wrapper)
 * Category: New
 * Purpose: Compute one vector length for the strict combat helper ports.
 */
function vectorLength(vector: vec3_t): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local immutable vector wrapper)
 * Category: New
 * Purpose: Normalize one vector while preserving the zero-vector case safely for damage knockback.
 */
function normalizeVec3(vector: vec3_t): vec3_t {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length === 0) {
    return [0, 0, 0];
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local runtime bookkeeping helper)
 * Category: New
 * Purpose: Centralize the `level.killed_monsters++` runtime-state update used by the ported `Killed` flow.
 */
function incrementKilledMonsters(runtime: GameRuntime): void {
  runtime.killed_monsters += 1;
}
