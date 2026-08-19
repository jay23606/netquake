/**
 * File: g_monster.ts
 * Source: Quake II original / game/g_monster.c
 * Purpose: Port of shared monster weapon helpers, world effects and startup routines.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Engine-side muzzleflash emission is delegated through an explicit hook.
 * - AI entry points can still be overridden through hooks, but default to the local `g_ai.ts` port.
 * - The `st.item` spawn-temp lookup falls back to `self.properties.item`.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

import {
  ATTN_NORM,
  CHAN_BODY,
  EF_COLOR_SHELL,
  EF_FLIES,
  EF_POWERSCREEN,
  MASK_MONSTERSOLID,
  MASK_WATER,
  RF_FRAMELERP,
  RF_SHELL_GREEN,
  RF_SHELL_RED,
  RF_SHELL_BLUE,
  YAW,
  type vec3_t
} from "../../qcommon/src/q_shared.js";
import {
  CONTENTS_LAVA,
  CONTENTS_SLIME,
  CONTENTS_WATER
} from "../../qcommon/src/q_shared.js";
import {
  POWER_ARMOR_SCREEN,
  POWER_ARMOR_SHIELD,
  SOLID_BBOX,
  SOLID_NOT,
  SVF_DEADMONSTER,
  SVF_MONSTER,
  SVF_NOCLIENT,
  emitMonsterMuzzleFlash,
  emitGameSound,
  linkGameEntity,
  MOVETYPE_NONE,
  MOVETYPE_STEP,
  registerGameSound,
  type GameEntity,
  type GameRuntime
} from "./runtime.js";
import {
  AI_GOOD_GUY,
  AI_HOLD_FRAME,
  AI_RESURRECTING,
  DEAD_NO,
  FL_FLY,
  FRAMETIME,
  DAMAGE_NO_ARMOR,
  FL_IMMUNE_LAVA,
  FL_IMMUNE_SLIME,
  FL_INWATER,
  FL_NOTARGET,
  FL_SWIM,
  MOD_LAVA,
  MOD_SLIME,
  MOD_UNKNOWN,
  MOD_WATER,
  random,
  damage_t
} from "./g_local.js";
import { FoundTarget, M_CheckAttack } from "./g_ai.js";
import { T_Damage, setDefaultMonsterDeathUse } from "./g_combat.js";
import { Drop_Item, FindItemByClassname, type GameItemDefinition } from "./g_items.js";
import { G_Find, G_FreeEdict, G_PickTarget, G_UseTargets, KillBox, vectoyaw, vtos } from "./g_utils.js";
import { M_walkmove } from "./m_move.js";
import {
  fire_bfg,
  fire_blaster,
  fire_bullet,
  fire_grenade,
  fire_rail,
  fire_rocket,
  fire_shotgun,
  type GameWeaponWorldHooks
} from "./g_weapon.js";

/**
 * Original name: N/A
 * Source declaree: N/A (local constant)
 * Category: New
 * Purpose: Provide a local zero vector for `vec3_origin` call sites without mutating shared state.
 */
const NULL_VEC3: vec3_t = [0, 0, 0];

/**
 * Original name: N/A
 * Source declaree: N/A (local constant)
 * Category: New
 * Purpose: Name the original `monster_start_go` indefinite pause literal.
 */
const MONSTER_PAUSE_FOREVER = 100000000;

/**
 * Original name: N/A
 * Source declaree: N/A (local hook interface)
 * Category: New
 * Purpose: Keep the still-external `g_monster.c` dependencies explicit until the remaining monster AI/runtime imports are ported.
 *
 * Constraints:
 * - Must preserve the original function split rather than folding missing AI/services into this file.
 */
export interface GameMonsterHooks extends GameWeaponWorldHooks {
  emitMonsterMuzzleFlash?: (self: GameEntity, start: vec3_t, flashtype: number, runtime: GameRuntime) => void;
  FoundTarget?: (self: GameEntity, runtime: GameRuntime) => void;
  M_CheckAttack?: (self: GameEntity, runtime: GameRuntime) => boolean;
  Drop_Item?: (self: GameEntity, item: GameItemDefinition, runtime: GameRuntime) => GameEntity | null;
}

/**
 * Original name: monster_fire_bullet
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Fires one monster bullet round and emits the matching monster muzzleflash.
 */
export function monster_fire_bullet(
  self: GameEntity,
  start: vec3_t,
  dir: vec3_t,
  damage: number,
  kick: number,
  hspread: number,
  vspread: number,
  flashtype: number,
  runtime: GameRuntime,
  hooks: GameMonsterHooks = {}
): void {
  fire_bullet(self, start, dir, damage, kick, hspread, vspread, MOD_UNKNOWN, runtime, hooks);
  queueMonsterMuzzleFlash(self, start, flashtype, runtime, hooks);
}

/**
 * Original name: monster_fire_shotgun
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Fires one monster shotgun burst and emits the matching monster muzzleflash.
 */
export function monster_fire_shotgun(
  self: GameEntity,
  start: vec3_t,
  aimdir: vec3_t,
  damage: number,
  kick: number,
  hspread: number,
  vspread: number,
  count: number,
  flashtype: number,
  runtime: GameRuntime,
  hooks: GameMonsterHooks = {}
): void {
  fire_shotgun(self, start, aimdir, damage, kick, hspread, vspread, count, MOD_UNKNOWN, runtime, hooks);
  queueMonsterMuzzleFlash(self, start, flashtype, runtime, hooks);
}

/**
 * Original name: monster_fire_blaster
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Fires one monster blaster projectile and emits the matching monster muzzleflash.
 */
export function monster_fire_blaster(
  self: GameEntity,
  start: vec3_t,
  dir: vec3_t,
  damage: number,
  speed: number,
  flashtype: number,
  effect: number,
  runtime: GameRuntime,
  hooks: GameMonsterHooks = {}
): void {
  fire_blaster(self, start, dir, damage, speed, effect, false, runtime, hooks);
  queueMonsterMuzzleFlash(self, start, flashtype, runtime, hooks);
}

/**
 * Original name: monster_fire_grenade
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Fires one monster grenade projectile and emits the matching monster muzzleflash.
 */
export function monster_fire_grenade(
  self: GameEntity,
  start: vec3_t,
  aimdir: vec3_t,
  damage: number,
  speed: number,
  flashtype: number,
  runtime: GameRuntime,
  hooks: GameMonsterHooks = {}
): void {
  fire_grenade(self, start, aimdir, damage, speed, 2.5, damage + 40, runtime, hooks);
  queueMonsterMuzzleFlash(self, start, flashtype, runtime, hooks);
}

/**
 * Original name: monster_fire_rocket
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Fires one monster rocket projectile and emits the matching monster muzzleflash.
 */
export function monster_fire_rocket(
  self: GameEntity,
  start: vec3_t,
  dir: vec3_t,
  damage: number,
  speed: number,
  flashtype: number,
  runtime: GameRuntime,
  hooks: GameMonsterHooks = {}
): void {
  fire_rocket(self, start, dir, damage, speed, damage + 20, damage, runtime, hooks);
  queueMonsterMuzzleFlash(self, start, flashtype, runtime, hooks);
}

/**
 * Original name: monster_fire_railgun
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Fires one monster railgun shot and emits the matching monster muzzleflash.
 */
export function monster_fire_railgun(
  self: GameEntity,
  start: vec3_t,
  aimdir: vec3_t,
  damage: number,
  kick: number,
  flashtype: number,
  runtime: GameRuntime,
  hooks: GameMonsterHooks = {}
): void {
  fire_rail(self, start, aimdir, damage, kick, runtime, hooks);
  queueMonsterMuzzleFlash(self, start, flashtype, runtime, hooks);
}

/**
 * Original name: monster_fire_bfg
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Fires one monster BFG projectile and emits the matching monster muzzleflash.
 */
export function monster_fire_bfg(
  self: GameEntity,
  start: vec3_t,
  aimdir: vec3_t,
  damage: number,
  speed: number,
  _kick: number,
  damage_radius: number,
  flashtype: number,
  runtime: GameRuntime,
  hooks: GameMonsterHooks = {}
): void {
  fire_bfg(self, start, aimdir, damage, speed, damage_radius, runtime, hooks);
  queueMonsterMuzzleFlash(self, start, flashtype, runtime, hooks);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local hook helper)
 * Category: New
 * Purpose: Route monster muzzleflash emission through an optional test/runtime hook before using the default game event bridge.
 */
function queueMonsterMuzzleFlash(
  self: GameEntity,
  start: vec3_t,
  flashtype: number,
  runtime: GameRuntime,
  hooks: GameMonsterHooks
): void {
  if (hooks.emitMonsterMuzzleFlash) {
    hooks.emitMonsterMuzzleFlash(self, start, flashtype, runtime);
    return;
  }

  emitMonsterMuzzleFlash(runtime, self, start, flashtype);
}

/**
 * Original name: M_FliesOff
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Clears the flies effect and looping sound from one monster corpse.
 */
export function M_FliesOff(self: GameEntity): void {
  self.s.effects &= ~EF_FLIES;
  self.s.sound = 0;
}

/**
 * Original name: M_FliesOn
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Starts the corpse flies effect and schedules the delayed shutdown.
 */
export function M_FliesOn(self: GameEntity, runtime: GameRuntime): void {
  if (self.waterlevel) {
    return;
  }

  self.s.effects |= EF_FLIES;
  self.s.sound = registerGameSound(runtime, "infantry/inflies1.wav");
  self.think = M_FliesOff;
  self.nextthink = runtime.time + 60;
}

/**
 * Original name: M_FlyCheck
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Randomly schedules corpse flies when the monster is not underwater.
 */
export function M_FlyCheck(self: GameEntity, runtime: GameRuntime): void {
  if (self.waterlevel) {
    return;
  }

  if (random() > 0.5) {
    return;
  }

  self.think = M_FliesOn;
  self.nextthink = runtime.time + 5 + (10 * random());
}

/**
 * Original name: AttackFinished
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Delays the next possible attack window for one monster.
 */
export function AttackFinished(self: GameEntity, time: number, runtime: GameRuntime): void {
  self.monsterinfo.attack_finished = runtime.time + time;
}

/**
 * Original name: M_CheckGround
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Updates one monster's groundentity by tracing slightly below its feet.
 */
export function M_CheckGround(ent: GameEntity, runtime: GameRuntime): void {
  if (!runtime.collision) {
    throw new Error("M_CheckGround requires runtime collision bridge");
  }

  if ((ent.flags & (FL_SWIM | FL_FLY)) !== 0) {
    return;
  }

  if (ent.velocity[2] > 100) {
    ent.groundentity = null;
    return;
  }

  const point: vec3_t = [...ent.s.origin];
  point[2] -= 0.25;

  const trace = runtime.collision.trace(ent.s.origin, ent.mins, ent.maxs, point, ent, MASK_MONSTERSOLID);
  if (trace.plane.normal[2] < 0.7 && !trace.startsolid) {
    ent.groundentity = null;
    return;
  }

  if (!trace.startsolid && !trace.allsolid) {
    setEntityOrigin(ent, trace.endpos);
    ent.groundentity = asGameEntity(trace.ent);
    ent.groundentity_linkcount = ent.groundentity?.linkcount ?? 0;
    ent.velocity[2] = 0;
  }
}

/**
 * Original name: M_CatagorizePosition
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Computes the entity water type and waterlevel from successive point-content probes.
 */
export function M_CatagorizePosition(ent: GameEntity, runtime: GameRuntime): void {
  if (!runtime.collision) {
    throw new Error("M_CatagorizePosition requires runtime collision bridge");
  }

  const point: vec3_t = [...ent.s.origin];
  point[2] = ent.s.origin[2] + ent.mins[2] + 1;

  let cont = runtime.collision.pointcontents(point, ent);
  if ((cont & MASK_WATER) === 0) {
    ent.waterlevel = 0;
    ent.watertype = 0;
    return;
  }

  ent.watertype = cont;
  ent.waterlevel = 1;

  point[2] += 26;
  cont = runtime.collision.pointcontents(point, ent);
  if ((cont & MASK_WATER) === 0) {
    return;
  }

  ent.waterlevel = 2;
  point[2] += 22;
  cont = runtime.collision.pointcontents(point, ent);
  if ((cont & MASK_WATER) !== 0) {
    ent.waterlevel = 3;
  }
}

/**
 * Original name: M_WorldEffects
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies drowning, suffocation, lava/slime damage and water entry/exit sounds to one monster.
 *
 * Porting notes:
 * - `gi.sound` is represented by runtime sound events so browser/server adapters can consume it.
 */
export function M_WorldEffects(ent: GameEntity, runtime: GameRuntime): void {
  const world = runtime.entities[0] ?? ent;
  let dmg: number;

  if (ent.health > 0) {
    if ((ent.flags & FL_SWIM) === 0) {
      if (ent.waterlevel < 3) {
        ent.air_finished = runtime.time + 12;
      } else if (ent.air_finished < runtime.time) {
        if (ent.pain_debounce_time < runtime.time) {
          dmg = 2 + (2 * Math.floor(runtime.time - ent.air_finished));
          if (dmg > 15) {
            dmg = 15;
          }
          T_Damage(ent, world, world, NULL_VEC3, ent.s.origin, NULL_VEC3, dmg, 0, DAMAGE_NO_ARMOR, MOD_WATER, runtime);
          ent.pain_debounce_time = runtime.time + 1;
        }
      }
    } else {
      if (ent.waterlevel > 0) {
        ent.air_finished = runtime.time + 9;
      } else if (ent.air_finished < runtime.time) {
        if (ent.pain_debounce_time < runtime.time) {
          dmg = 2 + (2 * Math.floor(runtime.time - ent.air_finished));
          if (dmg > 15) {
            dmg = 15;
          }
          T_Damage(ent, world, world, NULL_VEC3, ent.s.origin, NULL_VEC3, dmg, 0, DAMAGE_NO_ARMOR, MOD_WATER, runtime);
          ent.pain_debounce_time = runtime.time + 1;
        }
      }
    }
  }

  if (ent.waterlevel === 0) {
    if ((ent.flags & FL_INWATER) !== 0) {
      emitGameSound(runtime, ent, "player/watr_out.wav");
      ent.flags &= ~FL_INWATER;
    }
    return;
  }

  if ((ent.watertype & CONTENTS_LAVA) !== 0 && (ent.flags & FL_IMMUNE_LAVA) === 0) {
    if (ent.damage_debounce_time < runtime.time) {
      ent.damage_debounce_time = runtime.time + 0.2;
      T_Damage(ent, world, world, NULL_VEC3, ent.s.origin, NULL_VEC3, 10 * ent.waterlevel, 0, 0, MOD_LAVA, runtime);
    }
  }

  if ((ent.watertype & CONTENTS_SLIME) !== 0 && (ent.flags & FL_IMMUNE_SLIME) === 0) {
    if (ent.damage_debounce_time < runtime.time) {
      ent.damage_debounce_time = runtime.time + 1;
      T_Damage(ent, world, world, NULL_VEC3, ent.s.origin, NULL_VEC3, 4 * ent.waterlevel, 0, 0, MOD_SLIME, runtime);
    }
  }

  if ((ent.flags & FL_INWATER) === 0) {
    if ((ent.svflags & SVF_DEADMONSTER) === 0) {
      if ((ent.watertype & CONTENTS_LAVA) !== 0) {
        emitGameSound(runtime, ent, random() <= 0.5 ? "player/lava1.wav" : "player/lava2.wav");
      } else if ((ent.watertype & CONTENTS_SLIME) !== 0) {
        emitGameSound(runtime, ent, "player/watr_in.wav");
      } else if ((ent.watertype & CONTENTS_WATER) !== 0) {
        emitGameSound(runtime, ent, "player/watr_in.wav");
      }
    }

    ent.flags |= FL_INWATER;
    ent.damage_debounce_time = 0;
  }

  void CHAN_BODY;
  void ATTN_NORM;
}

/**
 * Original name: M_droptofloor
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Drops one monster vertically to the floor, links it, then refreshes ground and water state.
 *
 * Porting notes:
 * - Keeps `origin` mirrored with `s.origin` around the drop because TS collision and refresh adapters read both forms.
 */
export function M_droptofloor(ent: GameEntity, runtime: GameRuntime): void {
  if (!runtime.collision) {
    throw new Error("M_droptofloor requires runtime collision bridge");
  }

  ent.s.origin[2] += 1;
  ent.origin[2] = ent.s.origin[2];

  const end: vec3_t = [...ent.s.origin];
  end[2] -= 256;

  const trace = runtime.collision.trace(ent.s.origin, ent.mins, ent.maxs, end, ent, MASK_MONSTERSOLID);
  if (trace.fraction === 1 || trace.allsolid) {
    return;
  }

  setEntityOrigin(ent, trace.endpos);
  linkGameEntity(runtime, ent);
  M_CheckGround(ent, runtime);
  M_CatagorizePosition(ent, runtime);
}

/**
 * Original name: M_SetEffects
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Recomputes the monster shell and powerscreen render effects from current AI and power armor state.
 */
export function M_SetEffects(ent: GameEntity, runtime: GameRuntime): void {
  ent.s.effects &= ~(EF_COLOR_SHELL | EF_POWERSCREEN);
  ent.s.renderfx &= ~(RF_SHELL_RED | RF_SHELL_GREEN | RF_SHELL_BLUE);

  if ((ent.monsterinfo.aiflags & AI_RESURRECTING) !== 0) {
    ent.s.effects |= EF_COLOR_SHELL;
    ent.s.renderfx |= RF_SHELL_RED;
  }

  if (ent.health <= 0) {
    return;
  }

  if (ent.powerarmor_time > runtime.time) {
    if (ent.monsterinfo.power_armor_type === POWER_ARMOR_SCREEN) {
      ent.s.effects |= EF_POWERSCREEN;
    } else if (ent.monsterinfo.power_armor_type === POWER_ARMOR_SHIELD) {
      ent.s.effects |= EF_COLOR_SHELL;
      ent.s.renderfx |= RF_SHELL_GREEN;
    }
  }
}

/**
 * Original name: M_MoveFrame
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Advances one monster `mmove_t` frame range, calling frame AI and think functions in the original order.
 *
 * Porting notes:
 * - Frame callbacks receive the explicit runtime adapter instead of using C globals.
 */
export function M_MoveFrame(self: GameEntity, runtime: GameRuntime): void {
  let move = self.monsterinfo.currentmove;
  if (!move) {
    throw new Error(`M_MoveFrame: ${self.classname} has no currentmove`);
  }

  self.nextthink = runtime.time + FRAMETIME;

  if (
    self.monsterinfo.nextframe &&
    self.monsterinfo.nextframe >= move.firstframe &&
    self.monsterinfo.nextframe <= move.lastframe
  ) {
    self.s.frame = self.monsterinfo.nextframe;
    self.monsterinfo.nextframe = 0;
  } else {
    if (self.s.frame === move.lastframe) {
      if (move.endfunc) {
        move.endfunc(self, runtime);
        move = self.monsterinfo.currentmove;
        if (!move) {
          throw new Error(`M_MoveFrame: ${self.classname} lost currentmove after endfunc`);
        }
        if ((self.svflags & SVF_DEADMONSTER) !== 0) {
          return;
        }
      }
    }

    if (self.s.frame < move.firstframe || self.s.frame > move.lastframe) {
      self.monsterinfo.aiflags &= ~AI_HOLD_FRAME;
      self.s.frame = move.firstframe;
    } else if ((self.monsterinfo.aiflags & AI_HOLD_FRAME) === 0) {
      self.s.frame += 1;
      if (self.s.frame > move.lastframe) {
        self.s.frame = move.firstframe;
      }
    }
  }

  const index = self.s.frame - move.firstframe;
  const frame = move.frame[index];

  if (frame?.aifunc) {
    if ((self.monsterinfo.aiflags & AI_HOLD_FRAME) === 0) {
      frame.aifunc(self, frame.dist * self.monsterinfo.scale, runtime);
    } else {
      frame.aifunc(self, 0, runtime);
    }
  }

  frame?.thinkfunc?.(self, runtime);
}

/**
 * Original name: monster_think
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Advances one shared monster think frame, refreshing movement, grounding, water and visual effects.
 *
 * Porting notes:
 * - Takes the explicit runtime bridge required by the TypeScript port; otherwise preserves the C call order.
 */
export function monster_think(self: GameEntity, runtime: GameRuntime): void {
  M_MoveFrame(self, runtime);
  if (self.linkcount !== self.monsterinfo.linkcount) {
    self.monsterinfo.linkcount = self.linkcount;
    M_CheckGround(self, runtime);
  }
  M_CatagorizePosition(self, runtime);
  M_WorldEffects(self, runtime);
  M_SetEffects(self, runtime);
}

/**
 * Original name: monster_use
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Makes one idle monster angry at the activating entity when the original filters allow it.
 *
 * Porting notes:
 * - Accepts a nullable activator to match the shared TypeScript `use` callback shape; C callers pass an edict.
 */
export function monster_use(
  self: GameEntity,
  _other: GameEntity | null,
  activator: GameEntity | null,
  runtime: GameRuntime,
  hooks: GameMonsterHooks = {}
): void {
  if (self.enemy) {
    return;
  }
  if (self.health <= 0) {
    return;
  }
  if (!activator) {
    return;
  }
  if ((activator.flags & FL_NOTARGET) !== 0) {
    return;
  }
  if (!activator.client && (activator.monsterinfo.aiflags & AI_GOOD_GUY) === 0) {
    return;
  }

  self.enemy = activator;
  if (hooks.FoundTarget) {
    hooks.FoundTarget(self, runtime);
  } else {
    FoundTarget(self, runtime);
  }
}

/**
 * Original name: monster_triggered_spawn
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Materializes a trigger-spawn monster, links it and enters the regular startup path.
 */
export function monster_triggered_spawn(self: GameEntity, runtime: GameRuntime, hooks: GameMonsterHooks = {}): void {
  self.s.origin[2] += 1;
  self.origin[2] = self.s.origin[2];

  KillBox(runtime, self);

  self.solid = SOLID_BBOX;
  self.movetype = MOVETYPE_STEP;
  self.svflags &= ~SVF_NOCLIENT;
  self.air_finished = runtime.time + 12;
  linkGameEntity(runtime, self);

  monster_start_go(self, runtime, hooks);

  if (self.enemy && (self.spawnflags & 1) === 0 && (self.enemy.flags & FL_NOTARGET) === 0) {
    if (hooks.FoundTarget) {
      hooks.FoundTarget(self, runtime);
    } else {
      FoundTarget(self, runtime);
    }
  } else {
    self.enemy = null;
  }
}

/**
 * Original name: monster_triggered_spawn_use
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Arms one trigger-spawn monster for its delayed one-frame materialization.
 *
 * Porting notes:
 * - Accepts a nullable activator for the shared TypeScript callback shape, while only client activators become the delayed enemy.
 * - Uses wrappers so the delayed spawn and later `monster_use` callback keep the same hook adapter.
 */
export function monster_triggered_spawn_use(
  self: GameEntity,
  _other: GameEntity | null,
  activator: GameEntity | null,
  runtime: GameRuntime,
  hooks: GameMonsterHooks = {}
): void {
  self.think = (thinkSelf, localRuntime) => monster_triggered_spawn(thinkSelf, localRuntime, hooks);
  self.nextthink = runtime.time + FRAMETIME;
  if (activator?.client) {
    self.enemy = activator;
  }
  self.use = (useSelf, useOther, useActivator, localRuntime) => monster_use(useSelf, useOther, useActivator, localRuntime, hooks);
}

/**
 * Original name: monster_triggered_start
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Hides one trigger-spawn monster until its `use` callback is fired.
 */
export function monster_triggered_start(self: GameEntity, runtime: GameRuntime, hooks: GameMonsterHooks = {}): void {
  self.solid = SOLID_NOT;
  self.movetype = MOVETYPE_NONE;
  self.svflags |= SVF_NOCLIENT;
  self.nextthink = 0;
  self.use = (useSelf, other, activator, localRuntime) => monster_triggered_spawn_use(useSelf, other, activator, localRuntime, hooks);

  void runtime;
}

/**
 * Original name: monster_death_use
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Drops the configured item and fires the monster's death targets using its current enemy as activator.
 */
export function monster_death_use(self: GameEntity, runtime: GameRuntime, hooks: GameMonsterHooks = {}): void {
  self.flags &= ~(FL_FLY | FL_SWIM);
  self.monsterinfo.aiflags &= AI_GOOD_GUY;

  if (self.item) {
    (hooks.Drop_Item ?? Drop_Item)(self, self.item, runtime);
    self.item = null;
  }

  if (self.deathtarget) {
    self.target = self.deathtarget;
  }

  if (!self.target) {
    return;
  }

  G_UseTargets(runtime, self, self.enemy);
}

setDefaultMonsterDeathUse(monster_death_use);

/**
 * Original name: monster_start
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Performs the common monster startup initialization used by walk, fly and swim monsters.
 *
 * Porting notes:
 * - Defaults `monsterinfo.scale` to 1 because the TS runtime initializes numeric fields to 0,
 *   while the original spawn paths rely on the C game defaults before `M_MoveFrame`.
 */
export function monster_start(self: GameEntity, runtime: GameRuntime, hooks: GameMonsterHooks = {}): boolean {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return false;
  }

  if ((self.spawnflags & 4) !== 0 && (self.monsterinfo.aiflags & AI_GOOD_GUY) === 0) {
    self.spawnflags &= ~4;
    self.spawnflags |= 1;
  }

  if ((self.monsterinfo.aiflags & AI_GOOD_GUY) === 0) {
    runtime.total_monsters += 1;
  }

  self.nextthink = runtime.time + FRAMETIME;
  self.svflags |= SVF_MONSTER;
  self.s.renderfx |= RF_FRAMELERP;
  self.takedamage = damage_t.DAMAGE_AIM;
  self.air_finished = runtime.time + 12;
  self.use = (useSelf, other, activator, localRuntime) => monster_use(useSelf, other, activator, localRuntime, hooks);
  self.max_health = self.health;
  self.clipmask = MASK_MONSTERSOLID;

  self.s.skinnum = 0;
  self.deadflag = DEAD_NO;
  self.svflags &= ~SVF_DEADMONSTER;

  if (!self.monsterinfo.checkattack) {
    self.monsterinfo.checkattack = hooks.M_CheckAttack ?? M_CheckAttack;
  }

  self.s.old_origin = [...self.s.origin];

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

  if (self.monsterinfo.currentmove) {
    const firstframe = self.monsterinfo.currentmove.firstframe;
    const lastframe = self.monsterinfo.currentmove.lastframe;
    const span = lastframe - firstframe + 1;
    self.s.frame = firstframe + Math.trunc(Math.random() * span);
  }

  if (!self.monsterinfo.scale) {
    self.monsterinfo.scale = 1;
  }

  return true;
}

/**
 * Original name: monster_start_go
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Resolves initial targets/combattargets, picks the opening movement state and arms the regular think callback.
 *
 * Porting notes:
 * - Uses `GameRuntime` lookup/logging helpers in place of the original `gi` callbacks and `level.time`.
 */
export function monster_start_go(self: GameEntity, runtime: GameRuntime, hooks: GameMonsterHooks = {}): void {
  if (self.health <= 0) {
    return;
  }

  if (self.target) {
    let target: GameEntity | null = null;
    let notcombat = false;
    let fixup = false;

    while ((target = G_Find(runtime, target, "targetname", self.target)) !== null) {
      if (target.classname === "point_combat") {
        self.combattarget = self.target;
        fixup = true;
      } else {
        notcombat = true;
      }
    }

    if (notcombat && self.combattarget) {
      runtime.log({
        kind: "warning",
        message: `${self.classname} at ${vtos(self.s.origin)} has target with mixed types`,
        entityIndex: self.index,
        entityClassname: self.classname
      });
    }

    if (fixup) {
      self.target = undefined;
    }
  }

  if (self.combattarget) {
    let target: GameEntity | null = null;
    while ((target = G_Find(runtime, target, "targetname", self.combattarget)) !== null) {
      if (target.classname !== "point_combat") {
        runtime.log({
          kind: "warning",
          message: `${self.classname} at (${Math.trunc(self.s.origin[0])} ${Math.trunc(self.s.origin[1])} ${Math.trunc(self.s.origin[2])}) has a bad combattarget ${self.combattarget} : ${target.classname} at (${Math.trunc(target.s.origin[0])} ${Math.trunc(target.s.origin[1])} ${Math.trunc(target.s.origin[2])})`,
          entityIndex: self.index,
          entityClassname: self.classname,
          otherIndex: target.index,
          otherClassname: target.classname
        });
      }
    }
  }

  if (self.target) {
    self.goalentity = G_PickTarget(runtime, self.target);
    self.movetarget = self.goalentity;

    if (!self.movetarget) {
      runtime.log({
        kind: "warning",
        message: `${self.classname} can't find target ${self.target} at ${vtos(self.s.origin)}`,
        entityIndex: self.index,
        entityClassname: self.classname
      });
      self.target = undefined;
      self.monsterinfo.pausetime = MONSTER_PAUSE_FOREVER;
      self.monsterinfo.stand?.(self, runtime);
    } else if (self.movetarget.classname === "path_corner") {
      const v = subtractVec3(self.movetarget.s.origin, self.s.origin);
      const yaw = vectoyaw(v);
      self.ideal_yaw = yaw;
      self.s.angles[YAW] = yaw;
      self.angles[YAW] = yaw;
      self.monsterinfo.walk?.(self, runtime);
      self.target = undefined;
    } else {
      self.goalentity = null;
      self.movetarget = null;
      self.monsterinfo.pausetime = MONSTER_PAUSE_FOREVER;
      self.monsterinfo.stand?.(self, runtime);
    }
  } else {
    self.monsterinfo.pausetime = MONSTER_PAUSE_FOREVER;
    self.monsterinfo.stand?.(self, runtime);
  }

  self.think = monster_think;
  self.nextthink = runtime.time + FRAMETIME;

  void hooks;
}

/**
 * Original name: walkmonster_start_go
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Finalizes one walking monster spawn by dropping it to the floor and then entering shared monster startup.
 */
export function walkmonster_start_go(self: GameEntity, runtime: GameRuntime, hooks: GameMonsterHooks = {}): void {
  if ((self.spawnflags & 2) === 0 && runtime.time < 1) {
    M_droptofloor(self, runtime);

    if (self.groundentity) {
      if (!M_walkmove(self, 0, 0, runtime)) {
        runtime.log({
          kind: "warning",
          message: `${self.classname} in solid at ${vtos(self.s.origin)}`,
          entityIndex: self.index,
          entityClassname: self.classname
        });
      }
    }
  }

  if (!self.yaw_speed) {
    self.yaw_speed = 20;
  }
  self.viewheight = 25;

  monster_start_go(self, runtime, hooks);

  if ((self.spawnflags & 2) !== 0) {
    monster_triggered_start(self, runtime, hooks);
  }
}

/**
 * Original name: walkmonster_start
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Arms the walking-monster delayed startup think and runs the shared common initialization.
 */
export function walkmonster_start(self: GameEntity, runtime: GameRuntime, hooks: GameMonsterHooks = {}): void {
  self.think = (thinkSelf, localRuntime) => walkmonster_start_go(thinkSelf, localRuntime, hooks);
  monster_start(self, runtime, hooks);
}

/**
 * Original name: flymonster_start_go
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Finalizes one flying monster spawn and enters shared monster startup.
 */
export function flymonster_start_go(self: GameEntity, runtime: GameRuntime, hooks: GameMonsterHooks = {}): void {
  if (!M_walkmove(self, 0, 0, runtime)) {
    runtime.log({
      kind: "warning",
      message: `${self.classname} in solid at ${vtos(self.s.origin)}`,
      entityIndex: self.index,
      entityClassname: self.classname
    });
  }

  if (!self.yaw_speed) {
    self.yaw_speed = 10;
  }
  self.viewheight = 25;

  monster_start_go(self, runtime, hooks);

  if ((self.spawnflags & 2) !== 0) {
    monster_triggered_start(self, runtime, hooks);
  }
}

/**
 * Original name: flymonster_start
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Marks one monster as flying, arms its startup think and runs shared common initialization.
 */
export function flymonster_start(self: GameEntity, runtime: GameRuntime, hooks: GameMonsterHooks = {}): void {
  self.flags |= FL_FLY;
  self.think = (thinkSelf, localRuntime) => flymonster_start_go(thinkSelf, localRuntime, hooks);
  monster_start(self, runtime, hooks);
}

/**
 * Original name: swimmonster_start_go
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Finalizes one swimming monster spawn and enters shared monster startup.
 */
export function swimmonster_start_go(self: GameEntity, runtime: GameRuntime, hooks: GameMonsterHooks = {}): void {
  if (!self.yaw_speed) {
    self.yaw_speed = 10;
  }
  self.viewheight = 10;

  monster_start_go(self, runtime, hooks);

  if ((self.spawnflags & 2) !== 0) {
    monster_triggered_start(self, runtime, hooks);
  }
}

/**
 * Original name: swimmonster_start
 * Source: game/g_monster.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Marks one monster as swimming, arms its startup think and runs shared common initialization.
 */
export function swimmonster_start(self: GameEntity, runtime: GameRuntime, hooks: GameMonsterHooks = {}): void {
  self.flags |= FL_SWIM;
  self.think = (thinkSelf, localRuntime) => swimmonster_start_go(thinkSelf, localRuntime, hooks);
  monster_start(self, runtime, hooks);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local entity helper)
 * Category: New
 * Purpose: Narrow one trace entity payload back to the gameplay entity shape when available.
 */
function asGameEntity(value: unknown): GameEntity | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (!("inuse" in value) || !("classname" in value)) {
    return null;
  }

  return value as GameEntity;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local entity helper)
 * Category: New
 * Purpose: Keep `origin` and `s.origin` synchronized after position updates in the monster helpers.
 */
function setEntityOrigin(ent: GameEntity, origin: vec3_t): void {
  ent.origin = [...origin];
  ent.s.origin = [...origin];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Subtract two vectors without mutating either input.
 */
function subtractVec3(left: vec3_t, right: vec3_t): vec3_t {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}
