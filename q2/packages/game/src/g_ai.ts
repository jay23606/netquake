/**
 * File: g_ai.ts
 * Source: Quake II original / game/g_ai.c
 * Purpose: Port of shared monster AI visibility, targeting and pursuit routines.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses the explicit gameplay runtime and collision world instead of `gi.*`.
 * - `inPHS` and area-connection checks are computed from the collision world directly, using linked entity areas when available and a leaf fallback otherwise.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

import {
  AngleVectors,
  CM_AreasConnected,
  CM_ClusterPHS,
  CM_LeafArea,
  CM_LeafCluster,
  CM_PointLeafnum,
  MASK_OPAQUE,
  MASK_PLAYERSOLID,
  YAW,
  anglemod,
  type vec3_t
} from "../../qcommon/src/index.js";
import {
  CONTENTS_LAVA,
  CONTENTS_MONSTER,
  CONTENTS_SLIME,
  CONTENTS_SOLID,
  CONTENTS_WINDOW
} from "../../qcommon/src/q_shared.js";
import {
  AI_BRUTAL,
  AI_COMBAT_POINT,
  AI_GOOD_GUY,
  AI_LOST_SIGHT,
  AI_MEDIC,
  AI_PURSUE_NEXT,
  AI_PURSUE_TEMP,
  AI_PURSUIT_LAST_SEEN,
  AI_SOUND_TARGET,
  AI_STAND_GROUND,
  AI_TEMP_STAND_GROUND,
  AS_MELEE,
  AS_MISSILE,
  AS_SLIDING,
  AS_STRAIGHT,
  FL_FLY,
  FL_NOTARGET,
  MELEE_DISTANCE,
  RANGE_FAR,
  RANGE_MELEE,
  RANGE_MID,
  RANGE_NEAR,
  SVF_MONSTER,
  random
} from "./g_local.js";
import { AttackFinished } from "./g_monster.js";
import { G_FreeEdict, G_PickTarget, G_ProjectSource, G_Spawn, vectoyaw, vtos } from "./g_utils.js";
import { M_ChangeYaw, M_MoveToGoal, M_walkmove } from "./m_move.js";
import { PlayerTrail_PickFirst, PlayerTrail_PickNext } from "./p_trail.js";
import type { GameEntity, GameRuntime } from "./runtime.js";

/**
 * Original name: enemy_vis
 * Source: Quake-2-master/game/g_ai.c
 * Category: Ported
 * Fidelity level: Strict
 */
let enemy_vis = false;

/**
 * Original name: enemy_infront
 * Source: Quake-2-master/game/g_ai.c
 * Category: Ported
 * Fidelity level: Strict
 */
let enemy_infront = false;

/**
 * Original name: enemy_range
 * Source: Quake-2-master/game/g_ai.c
 * Category: Ported
 * Fidelity level: Strict
 */
let enemy_range = RANGE_FAR;

/**
 * Original name: enemy_yaw
 * Source: Quake-2-master/game/g_ai.c
 * Category: Ported
 * Fidelity level: Strict
 */
let enemy_yaw = 0;

/**
 * Original name: N/A
 * Source declaree: N/A (local trace mask)
 * Category: New
 *
 * Purpose:
 * - Names the inline `M_CheckAttack` trace contents mask from the C source.
 */
const ATTACK_TRACE_MASK =
  CONTENTS_SOLID |
  CONTENTS_MONSTER |
  CONTENTS_SLIME |
  CONTENTS_LAVA |
  CONTENTS_WINDOW;

/**
 * Original name: AI_SetSightClient
 * Source: Quake-2-master/game/g_ai.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Picks the next live, targetable client to test in `FindTarget`.
 */
export function AI_SetSightClient(runtime: GameRuntime): void {
  let start = 1;

  if (runtime.sight_client) {
    start = runtime.sight_client.index;
  }

  let check = start;
  while (true) {
    check += 1;
    if (check > runtime.maxclients) {
      check = 1;
    }

    const ent = runtime.entities[check] ?? null;
    if (
      ent &&
      ent.inuse &&
      ent.health > 0 &&
      (ent.flags & FL_NOTARGET) === 0
    ) {
      runtime.sight_client = ent;
      return;
    }

    if (check === start) {
      runtime.sight_client = null;
      return;
    }
  }
}

/**
 * Original name: ai_move
 * Source: Quake-2-master/game/g_ai.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Moves the monster by `dist` along its current facing.
 */
export function ai_move(self: GameEntity, dist: number, runtime: GameRuntime): void {
  M_walkmove(self, self.s.angles[YAW], dist, runtime);
}

/**
 * Original name: ai_stand
 * Source: Quake-2-master/game/g_ai.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Keeps a monster standing, idling and scanning for targets.
 */
export function ai_stand(self: GameEntity, dist: number, runtime: GameRuntime): void {
  if (dist !== 0) {
    M_walkmove(self, self.s.angles[YAW], dist, runtime);
  }

  if ((self.monsterinfo.aiflags & AI_STAND_GROUND) !== 0) {
    if (self.enemy) {
      const v = subtractVec3(self.enemy.s.origin, self.s.origin);
      self.ideal_yaw = vectoyaw(v);
      if (
        self.s.angles[YAW] !== self.ideal_yaw &&
        (self.monsterinfo.aiflags & AI_TEMP_STAND_GROUND) !== 0
      ) {
        self.monsterinfo.aiflags &= ~(AI_STAND_GROUND | AI_TEMP_STAND_GROUND);
        self.monsterinfo.run?.(self, runtime);
      }
      M_ChangeYaw(self);
      ai_checkattack(self, 0, runtime);
    } else {
      FindTarget(self, runtime);
    }
    return;
  }

  if (FindTarget(self, runtime)) {
    return;
  }

  if (runtime.time > self.monsterinfo.pausetime) {
    self.monsterinfo.walk?.(self, runtime);
    return;
  }

  if ((self.spawnflags & 1) === 0 && self.monsterinfo.idle && runtime.time > self.monsterinfo.idle_time) {
    if (self.monsterinfo.idle_time !== 0) {
      self.monsterinfo.idle(self, runtime);
      self.monsterinfo.idle_time = runtime.time + 15 + (random() * 15);
    } else {
      self.monsterinfo.idle_time = runtime.time + (random() * 15);
    }
  }
}

/**
 * Original name: ai_walk
 * Source: Quake-2-master/game/g_ai.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Walks a patrol route while periodically scanning for players.
 */
export function ai_walk(self: GameEntity, dist: number, runtime: GameRuntime): void {
  M_MoveToGoal(self, dist, runtime);

  if (FindTarget(self, runtime)) {
    return;
  }

  if (self.monsterinfo.search && runtime.time > self.monsterinfo.idle_time) {
    if (self.monsterinfo.idle_time !== 0) {
      self.monsterinfo.search(self, runtime);
      self.monsterinfo.idle_time = runtime.time + 15 + (random() * 15);
    } else {
      self.monsterinfo.idle_time = runtime.time + (random() * 15);
    }
  }
}

/**
 * Original name: ai_charge
 * Source: Quake-2-master/game/g_ai.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Turns toward the current enemy and optionally advances.
 *
 * Porting notes:
 * - The C original assumes `self->enemy` is non-null; TypeScript returns early when
 *   no enemy is attached so attack-frame callbacks cannot throw on partial entities.
 */
export function ai_charge(self: GameEntity, dist: number, runtime: GameRuntime): void {
  if (!self.enemy) {
    return;
  }

  const v = subtractVec3(self.enemy.s.origin, self.s.origin);
  self.ideal_yaw = vectoyaw(v);
  M_ChangeYaw(self);

  if (dist !== 0) {
    M_walkmove(self, self.s.angles[YAW], dist, runtime);
  }
}

/**
 * Original name: ai_turn
 * Source: Quake-2-master/game/g_ai.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Turns toward `ideal_yaw` without making forward progress.
 */
export function ai_turn(self: GameEntity, dist: number, runtime: GameRuntime): void {
  if (dist !== 0) {
    M_walkmove(self, self.s.angles[YAW], dist, runtime);
  }

  if (FindTarget(self, runtime)) {
    return;
  }

  M_ChangeYaw(self);
}

/**
 * Original name: range
 * Source: Quake-2-master/game/g_ai.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Categorizes one entity's distance from another into the original AI range bands.
 */
export function range(self: GameEntity, other: GameEntity): number {
  const v = subtractVec3(self.s.origin, other.s.origin);
  const len = vectorLength(v);

  if (len < MELEE_DISTANCE) {
    return RANGE_MELEE;
  }
  if (len < 500) {
    return RANGE_NEAR;
  }
  if (len < 1000) {
    return RANGE_MID;
  }
  return RANGE_FAR;
}

/**
 * Original name: visible
 * Source: Quake-2-master/game/g_ai.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns whether `other` is visible to `self` by tracing between their eye positions.
 *
 * Porting notes:
 * - The original always calls `gi.trace`; this adapter returns `false` when no collision
 *   backend is installed.
 */
export function visible(self: GameEntity, other: GameEntity, runtime: GameRuntime): boolean {
  if (!runtime.collision) {
    return false;
  }

  const spot1: vec3_t = [...self.s.origin];
  spot1[2] += self.viewheight;

  const spot2: vec3_t = [...other.s.origin];
  spot2[2] += other.viewheight;

  const trace = runtime.collision.trace(spot1, [0, 0, 0], [0, 0, 0], spot2, self, MASK_OPAQUE);
  return trace.fraction === 1.0;
}

/**
 * Original name: infront
 * Source: Quake-2-master/game/g_ai.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns whether `other` lies broadly in front of `self`.
 */
export function infront(self: GameEntity, other: GameEntity): boolean {
  const { forward } = AngleVectors(self.s.angles);
  const vec = normalizeVec3(subtractVec3(other.s.origin, self.s.origin));
  const dot = dotProduct(vec, forward);
  return dot > 0.3;
}

/**
 * Original name: HuntTarget
 * Source: Quake-2-master/game/g_ai.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Switches the monster into active pursuit of its current enemy.
 *
 * Porting notes:
 * - The C original assumes `self->enemy` is non-null; TypeScript returns early when
 *   no enemy is attached so partial test/runtime entities cannot throw.
 */
export function HuntTarget(self: GameEntity, runtime: GameRuntime): void {
  if (!self.enemy) {
    return;
  }

  self.goalentity = self.enemy;
  if ((self.monsterinfo.aiflags & AI_STAND_GROUND) !== 0) {
    self.monsterinfo.stand?.(self, runtime);
  } else {
    self.monsterinfo.run?.(self, runtime);
  }

  const vec = subtractVec3(self.enemy.s.origin, self.s.origin);
  self.ideal_yaw = vectoyaw(vec);

  if ((self.monsterinfo.aiflags & AI_STAND_GROUND) === 0) {
    AttackFinished(self, 1, runtime);
  }
}

/**
 * Original name: FoundTarget
 * Source: Quake-2-master/game/g_ai.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Records target acquisition state and starts pursuit or combat-point movement.
 *
 * Porting notes:
 * - The C original assumes `self->enemy` is non-null; TypeScript returns early when
 *   no enemy is attached so partial test/runtime entities cannot throw.
 */
export function FoundTarget(self: GameEntity, runtime: GameRuntime): void {
  if (!self.enemy) {
    return;
  }

  if (self.enemy.client) {
    runtime.sight_entity = self;
    runtime.sight_entity_framenum = runtime.framenum;
    runtime.sight_entity.light_level = 128;
  }

  self.show_hostile = runtime.time + 1;
  self.monsterinfo.last_sighting = [...self.enemy.s.origin];
  self.monsterinfo.trail_time = runtime.time;

  if (!self.combattarget) {
    HuntTarget(self, runtime);
    return;
  }

  self.goalentity = G_PickTarget(runtime, self.combattarget);
  self.movetarget = self.goalentity;
  if (!self.movetarget) {
    self.goalentity = self.enemy;
    self.movetarget = self.enemy;
    HuntTarget(self, runtime);
    runtime.log({
      kind: "warning",
      message: `${self.classname} at ${vtos(self.s.origin)}, combattarget ${self.combattarget} not found`,
      entityIndex: self.index,
      entityClassname: self.classname
    });
    return;
  }

  self.combattarget = undefined;
  self.monsterinfo.aiflags |= AI_COMBAT_POINT;
  self.movetarget.targetname = undefined;
  self.monsterinfo.pausetime = 0;
  self.monsterinfo.run?.(self, runtime);
}

/**
 * Original name: FindTarget
 * Source: Quake-2-master/game/g_ai.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Searches for one suitable enemy based on sight or recent sound events.
 *
 * Porting notes:
 * - Uses explicit `GameRuntime` fields for `level.sight_*` and `level.sound_*`.
 * - Keeps the original single-client-per-frame selection, visibility/range gates and
 *   sound-target wake-up rules; area/PHS checks are routed through the collision adapter.
 */
export function FindTarget(self: GameEntity, runtime: GameRuntime): boolean {
  if ((self.monsterinfo.aiflags & AI_GOOD_GUY) !== 0) {
    if (self.goalentity && self.goalentity.inuse && self.goalentity.classname === "target_actor") {
      return false;
    }
    return false;
  }

  if ((self.monsterinfo.aiflags & AI_COMBAT_POINT) !== 0) {
    return false;
  }

  let client: GameEntity | null;
  let heardit = false;

  if (runtime.sight_entity_framenum >= (runtime.framenum - 1) && (self.spawnflags & 1) === 0) {
    client = runtime.sight_entity;
    if (client?.enemy === self.enemy) {
      return false;
    }
  } else if (runtime.sound_entity_framenum >= (runtime.framenum - 1)) {
    client = runtime.sound_entity;
    heardit = true;
  } else if (!self.enemy && runtime.sound2_entity_framenum >= (runtime.framenum - 1) && (self.spawnflags & 1) === 0) {
    client = runtime.sound2_entity;
    heardit = true;
  } else {
    client = runtime.sight_client;
    if (!client) {
      return false;
    }
  }

  if (!client || !client.inuse) {
    return false;
  }

  if (client === self.enemy) {
    return true;
  }

  if (client.client) {
    if ((client.flags & FL_NOTARGET) !== 0) {
      return false;
    }
  } else if ((client.svflags & SVF_MONSTER) !== 0) {
    if (!client.enemy) {
      return false;
    }
    if ((client.enemy.flags & FL_NOTARGET) !== 0) {
      return false;
    }
  } else if (heardit) {
    if ((client.owner?.flags ?? 0) & FL_NOTARGET) {
      return false;
    }
  } else {
    return false;
  }

  if (!heardit) {
    const r = range(self, client);
    if (r === RANGE_FAR) {
      return false;
    }

    if (client.light_level <= 5) {
      return false;
    }

    if (!visible(self, client, runtime)) {
      return false;
    }

    if (r === RANGE_NEAR) {
      if (client.show_hostile < runtime.time && !infront(self, client)) {
        return false;
      }
    } else if (r === RANGE_MID) {
      if (!infront(self, client)) {
        return false;
      }
    }

    self.enemy = client;

    if (self.enemy.classname !== "player_noise") {
      self.monsterinfo.aiflags &= ~AI_SOUND_TARGET;

      if (!self.enemy.client) {
        self.enemy = self.enemy.enemy;
        if (!self.enemy?.client) {
          self.enemy = null;
          return false;
        }
      }
    }
  } else {
    if ((self.spawnflags & 1) !== 0) {
      if (!visible(self, client, runtime)) {
        return false;
      }
    } else if (!inPHS(self.s.origin, client.s.origin, runtime)) {
      return false;
    }

    const temp = subtractVec3(client.s.origin, self.s.origin);
    if (vectorLength(temp) > 1000) {
      return false;
    }

    const selfArea = getEntityArea(self, runtime);
    const clientArea = getEntityArea(client, runtime);
    if (
      selfArea !== 0 &&
      clientArea !== 0 &&
      clientArea !== selfArea &&
      !areasConnected(selfArea, clientArea, runtime)
    ) {
      return false;
    }

    self.ideal_yaw = vectoyaw(temp);
    M_ChangeYaw(self);
    self.monsterinfo.aiflags |= AI_SOUND_TARGET;
    self.enemy = client;
  }

  FoundTarget(self, runtime);

  if ((self.monsterinfo.aiflags & AI_SOUND_TARGET) === 0) {
    self.monsterinfo.sight?.(self, self.enemy, runtime);
  }

  return true;
}

/**
 * Original name: FacingIdeal
 * Source: Quake-2-master/game/g_ai.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns whether the current yaw lies within the original 45-degree ideal-facing window.
 */
export function FacingIdeal(self: GameEntity): boolean {
  const delta = anglemod(self.s.angles[YAW] - self.ideal_yaw);
  return !(delta > 45 && delta < 315);
}

/**
 * Original name: M_CheckAttack
 * Source: Quake-2-master/game/g_ai.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Decides whether the monster should begin a melee or missile attack.
 *
 * Porting notes:
 * - Uses the explicit runtime collision adapter instead of `gi.trace`.
 * - Returns `false` when no collision adapter or enemy is installed; normal monster
 *   runtime paths provide both before this callback is reached.
 */
export function M_CheckAttack(self: GameEntity, runtime: GameRuntime): boolean {
  if (!runtime.collision || !self.enemy) {
    return false;
  }

  if (self.enemy.health > 0) {
    const spot1: vec3_t = [...self.s.origin];
    spot1[2] += self.viewheight;
    const spot2: vec3_t = [...self.enemy.s.origin];
    spot2[2] += self.enemy.viewheight;

    const tr = runtime.collision.trace(spot1, [0, 0, 0], [0, 0, 0], spot2, self, ATTACK_TRACE_MASK);
    if (tr.ent !== self.enemy) {
      return false;
    }
  }

  if (enemy_range === RANGE_MELEE) {
    if (runtime.skill === 0 && (randomInt() & 3) !== 0) {
      return false;
    }
    if (self.monsterinfo.melee) {
      self.monsterinfo.attack_state = AS_MELEE;
    } else {
      self.monsterinfo.attack_state = AS_MISSILE;
    }
    return true;
  }

  if (!self.monsterinfo.attack) {
    return false;
  }

  if (runtime.time < self.monsterinfo.attack_finished) {
    return false;
  }

  if (enemy_range === RANGE_FAR) {
    return false;
  }

  let chance: number;
  if ((self.monsterinfo.aiflags & AI_STAND_GROUND) !== 0) {
    chance = 0.4;
  } else if (enemy_range === RANGE_MELEE) {
    chance = 0.2;
  } else if (enemy_range === RANGE_NEAR) {
    chance = 0.1;
  } else if (enemy_range === RANGE_MID) {
    chance = 0.02;
  } else {
    return false;
  }

  if (runtime.skill === 0) {
    chance *= 0.5;
  } else if (runtime.skill >= 2) {
    chance *= 2;
  }

  if (random() < chance) {
    self.monsterinfo.attack_state = AS_MISSILE;
    self.monsterinfo.attack_finished = runtime.time + (2 * random());
    return true;
  }

  if ((self.flags & FL_FLY) !== 0) {
    self.monsterinfo.attack_state = random() < 0.3 ? AS_SLIDING : AS_STRAIGHT;
  }

  return false;
}

/**
 * Original name: ai_run_melee
 * Source: Quake-2-master/game/g_ai.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Turns toward the enemy until aligned enough to fire the monster melee callback.
 *
 * Porting notes:
 * - Passes the explicit runtime to the callback; the optional callback guard is defensive,
 *   while normal attack-state selection only enters AS_MELEE when a melee callback exists.
 */
export function ai_run_melee(self: GameEntity, runtime: GameRuntime): void {
  self.ideal_yaw = enemy_yaw;
  M_ChangeYaw(self);

  if (FacingIdeal(self)) {
    self.monsterinfo.melee?.(self, runtime);
    self.monsterinfo.attack_state = AS_STRAIGHT;
  }
}

/**
 * Original name: ai_run_missile
 * Source: Quake-2-master/game/g_ai.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Turns toward the enemy until aligned enough to fire the missile attack callback.
 *
 * Porting notes:
 * - Passes the explicit runtime to the callback; the optional callback guard is defensive,
 *   while normal monster attack states install the expected callback before firing.
 */
export function ai_run_missile(self: GameEntity, runtime: GameRuntime): void {
  self.ideal_yaw = enemy_yaw;
  M_ChangeYaw(self);

  if (FacingIdeal(self)) {
    self.monsterinfo.attack?.(self, runtime);
    self.monsterinfo.attack_state = AS_STRAIGHT;
  }
}

/**
 * Original name: ai_run_slide
 * Source: Quake-2-master/game/g_ai.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Strafes around the enemy while keeping roughly the same range.
 */
export function ai_run_slide(self: GameEntity, distance: number, runtime: GameRuntime): void {
  self.ideal_yaw = enemy_yaw;
  M_ChangeYaw(self);

  const ofs = self.monsterinfo.lefty ? 90 : -90;
  if (M_walkmove(self, self.ideal_yaw + ofs, distance, runtime)) {
    return;
  }

  self.monsterinfo.lefty = 1 - self.monsterinfo.lefty;
  M_walkmove(self, self.ideal_yaw - ofs, distance, runtime);
}

/**
 * Original name: ai_checkattack
 * Source: Quake-2-master/game/g_ai.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Resolves dead-enemy handling, visibility state and attack selection for the current enemy.
 *
 * Porting notes:
 * - Uses the explicit runtime for level time and collision-backed visibility.
 * - Keeps defensive callback and enemy guards where the C path relies on valid monster setup.
 */
export function ai_checkattack(self: GameEntity, _dist: number, runtime: GameRuntime): boolean {
  if (self.goalentity) {
    if ((self.monsterinfo.aiflags & AI_COMBAT_POINT) !== 0) {
      return false;
    }

    if ((self.monsterinfo.aiflags & AI_SOUND_TARGET) !== 0 && self.enemy) {
      if ((runtime.time - self.enemy.teleport_time) > 5.0) {
        if (self.goalentity === self.enemy) {
          if (self.movetarget) {
            self.goalentity = self.movetarget;
          } else {
            self.goalentity = null;
          }
        }
        self.monsterinfo.aiflags &= ~AI_SOUND_TARGET;
        if ((self.monsterinfo.aiflags & AI_TEMP_STAND_GROUND) !== 0) {
          self.monsterinfo.aiflags &= ~(AI_STAND_GROUND | AI_TEMP_STAND_GROUND);
        }
      } else {
        self.show_hostile = runtime.time + 1;
        return false;
      }
    }
  }

  enemy_vis = false;

  let hesDeadJim = false;
  if (!self.enemy || !self.enemy.inuse) {
    hesDeadJim = true;
  } else if ((self.monsterinfo.aiflags & AI_MEDIC) !== 0) {
    if (self.enemy.health > 0) {
      hesDeadJim = true;
      self.monsterinfo.aiflags &= ~AI_MEDIC;
    }
  } else if ((self.monsterinfo.aiflags & AI_BRUTAL) !== 0) {
    if (self.enemy.health <= -80) {
      hesDeadJim = true;
    }
  } else if (self.enemy.health <= 0) {
    hesDeadJim = true;
  }

  if (hesDeadJim) {
    self.enemy = null;
    if (self.oldenemy && self.oldenemy.health > 0) {
      self.enemy = self.oldenemy;
      self.oldenemy = null;
      HuntTarget(self, runtime);
    } else {
      if (self.movetarget) {
        self.goalentity = self.movetarget;
        self.monsterinfo.walk?.(self, runtime);
      } else {
        self.monsterinfo.pausetime = runtime.time + 100000000;
        self.monsterinfo.stand?.(self, runtime);
      }
      return true;
    }
  }

  self.show_hostile = runtime.time + 1;

  if (!self.enemy) {
    return false;
  }

  enemy_vis = visible(self, self.enemy, runtime);
  if (enemy_vis) {
    self.monsterinfo.search_time = runtime.time + 5;
    self.monsterinfo.last_sighting = [...self.enemy.s.origin];
  }

  enemy_infront = infront(self, self.enemy);
  enemy_range = range(self, self.enemy);
  const temp = subtractVec3(self.enemy.s.origin, self.s.origin);
  enemy_yaw = vectoyaw(temp);

  if (self.monsterinfo.attack_state === AS_MISSILE) {
    ai_run_missile(self, runtime);
    return true;
  }
  if (self.monsterinfo.attack_state === AS_MELEE) {
    ai_run_melee(self, runtime);
    return true;
  }

  if (!enemy_vis) {
    return false;
  }

  return self.monsterinfo.checkattack?.(self, runtime) ?? false;
}

/**
 * Original name: ai_run
 * Source: Quake-2-master/game/g_ai.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Pursues the current enemy, handling sound targets, lost-sight pursuit and player-trail reacquisition.
 *
 * Porting notes:
 * - Uses the explicit runtime for level time, target search and collision-backed movement.
 * - Keeps defensive enemy and callback guards where the C path relies on valid monster setup.
 */
export function ai_run(self: GameEntity, dist: number, runtime: GameRuntime): void {
  if ((self.monsterinfo.aiflags & AI_COMBAT_POINT) !== 0) {
    M_MoveToGoal(self, dist, runtime);
    return;
  }

  if ((self.monsterinfo.aiflags & AI_SOUND_TARGET) !== 0 && self.enemy) {
    const v = subtractVec3(self.s.origin, self.enemy.s.origin);
    if (vectorLength(v) < 64) {
      self.monsterinfo.aiflags |= AI_STAND_GROUND | AI_TEMP_STAND_GROUND;
      self.monsterinfo.stand?.(self, runtime);
      return;
    }

    M_MoveToGoal(self, dist, runtime);
    if (!FindTarget(self, runtime)) {
      return;
    }
  }

  if (ai_checkattack(self, dist, runtime)) {
    return;
  }

  if (self.monsterinfo.attack_state === AS_SLIDING) {
    ai_run_slide(self, dist, runtime);
    return;
  }

  if (enemy_vis) {
    M_MoveToGoal(self, dist, runtime);
    self.monsterinfo.aiflags &= ~AI_LOST_SIGHT;
    self.monsterinfo.last_sighting = [...self.enemy!.s.origin];
    self.monsterinfo.trail_time = runtime.time;
    return;
  }

  if (runtime.coop && FindTarget(self, runtime)) {
    return;
  }

  if (self.monsterinfo.search_time !== 0 && runtime.time > (self.monsterinfo.search_time + 20)) {
    M_MoveToGoal(self, dist, runtime);
    self.monsterinfo.search_time = 0;
    return;
  }

  const save = self.goalentity;
  const tempgoal = G_Spawn(runtime);
  self.goalentity = tempgoal;

  let isNew = false;

  if ((self.monsterinfo.aiflags & AI_LOST_SIGHT) === 0) {
    self.monsterinfo.aiflags |= AI_LOST_SIGHT | AI_PURSUIT_LAST_SEEN;
    self.monsterinfo.aiflags &= ~(AI_PURSUE_NEXT | AI_PURSUE_TEMP);
    isNew = true;
  }

  if ((self.monsterinfo.aiflags & AI_PURSUE_NEXT) !== 0) {
    self.monsterinfo.aiflags &= ~AI_PURSUE_NEXT;
    self.monsterinfo.search_time = runtime.time + 5;

    let marker: GameEntity | null = null;
    if ((self.monsterinfo.aiflags & AI_PURSUE_TEMP) !== 0) {
      self.monsterinfo.aiflags &= ~AI_PURSUE_TEMP;
      self.monsterinfo.last_sighting = [...self.monsterinfo.saved_goal];
      isNew = true;
    } else if ((self.monsterinfo.aiflags & AI_PURSUIT_LAST_SEEN) !== 0) {
      self.monsterinfo.aiflags &= ~AI_PURSUIT_LAST_SEEN;
      marker = PlayerTrail_PickFirst(self, runtime);
    } else {
      marker = PlayerTrail_PickNext(self, runtime);
    }

    if (marker) {
      self.monsterinfo.last_sighting = [...marker.s.origin];
      self.monsterinfo.trail_time = marker.timestamp;
      self.s.angles[YAW] = marker.s.angles[YAW];
      self.angles[YAW] = marker.s.angles[YAW];
      self.ideal_yaw = marker.s.angles[YAW];
      isNew = true;
    }
  }

  let v = subtractVec3(self.s.origin, self.monsterinfo.last_sighting);
  let d1 = vectorLength(v);
  if (d1 <= dist) {
    self.monsterinfo.aiflags |= AI_PURSUE_NEXT;
    dist = d1;
  }

  setEntityOrigin(self.goalentity, self.monsterinfo.last_sighting);

  if (isNew && runtime.collision) {
    let tr = runtime.collision.trace(
      self.s.origin,
      self.mins,
      self.maxs,
      self.monsterinfo.last_sighting,
      self,
      MASK_PLAYERSOLID
    );

    if (tr.fraction < 1) {
      v = subtractVec3(self.goalentity.s.origin, self.s.origin);
      d1 = vectorLength(v);
      let center = tr.fraction;
      const d2 = d1 * ((center + 1) / 2);
      self.s.angles[YAW] = vectoyaw(v);
      self.angles[YAW] = self.s.angles[YAW];
      self.ideal_yaw = self.s.angles[YAW];

      const { forward: v_forward, right: v_right } = AngleVectors(self.s.angles);

      let left_target = G_ProjectSource(self.s.origin, [d2, -16, 0], v_forward, v_right);
      tr = runtime.collision.trace(self.s.origin, self.mins, self.maxs, left_target, self, MASK_PLAYERSOLID);
      const left = tr.fraction;

      let right_target = G_ProjectSource(self.s.origin, [d2, 16, 0], v_forward, v_right);
      tr = runtime.collision.trace(self.s.origin, self.mins, self.maxs, right_target, self, MASK_PLAYERSOLID);
      const right = tr.fraction;

      center = (d1 * center) / d2;
      if (left >= center && left > right) {
        if (left < 1) {
          left_target = G_ProjectSource(self.s.origin, [d2 * left * 0.5, -16, 0], v_forward, v_right);
        }
        self.monsterinfo.saved_goal = [...self.monsterinfo.last_sighting];
        self.monsterinfo.aiflags |= AI_PURSUE_TEMP;
        setEntityOrigin(self.goalentity, left_target);
        self.monsterinfo.last_sighting = [...left_target];
        v = subtractVec3(self.goalentity.s.origin, self.s.origin);
        self.s.angles[YAW] = vectoyaw(v);
        self.angles[YAW] = self.s.angles[YAW];
        self.ideal_yaw = self.s.angles[YAW];
      } else if (right >= center && right > left) {
        if (right < 1) {
          right_target = G_ProjectSource(self.s.origin, [d2 * right * 0.5, 16, 0], v_forward, v_right);
        }
        self.monsterinfo.saved_goal = [...self.monsterinfo.last_sighting];
        self.monsterinfo.aiflags |= AI_PURSUE_TEMP;
        setEntityOrigin(self.goalentity, right_target);
        self.monsterinfo.last_sighting = [...right_target];
        v = subtractVec3(self.goalentity.s.origin, self.s.origin);
        self.s.angles[YAW] = vectoyaw(v);
        self.angles[YAW] = self.s.angles[YAW];
        self.ideal_yaw = self.s.angles[YAW];
      }
    }
  }

  M_MoveToGoal(self, dist, runtime);
  G_FreeEdict(runtime, tempgoal);

  if (self.inuse) {
    self.goalentity = save;
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (local vector helper)
 * Category: New
 *
 * Purpose:
 * - Provides a local copy-returning vector subtraction helper for AI expressions.
 */
function subtractVec3(left: vec3_t, right: vec3_t): vec3_t {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local vector helper)
 * Category: New
 *
 * Purpose:
 * - Provides a local vector length helper for AI distance checks.
 */
function vectorLength(vector: vec3_t): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local vector helper)
 * Category: New
 *
 * Purpose:
 * - Provides a local copy-returning normalizer for AI facing checks.
 */
function normalizeVec3(vector: vec3_t): vec3_t {
  const length = vectorLength(vector);
  if (length === 0) {
    return [0, 0, 0];
  }

  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local vector helper)
 * Category: New
 *
 * Purpose:
 * - Provides a local dot product helper for AI facing checks.
 */
function dotProduct(left: vec3_t, right: vec3_t): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local entity-origin helper)
 * Category: New
 *
 * Purpose:
 * - Mirrors `VectorCopy(..., ent->s.origin)` updates while keeping TS entity aliases in sync.
 */
function setEntityOrigin(ent: GameEntity | null, origin: vec3_t): void {
  if (!ent) {
    return;
  }

  ent.s.origin = [...origin];
  ent.origin = [...origin];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local collision adapter)
 * Category: New
 *
 * Purpose:
 * - Provides the local `gi.inPHS` check used by `FindTarget` sound acquisition.
 */
function inPHS(p1: vec3_t, p2: vec3_t, runtime: GameRuntime): boolean {
  const world = runtime.collision?.world;
  if (!world) {
    return false;
  }

  const leaf1 = CM_PointLeafnum(world, p1);
  const leaf2 = CM_PointLeafnum(world, p2);
  const cluster1 = CM_LeafCluster(world, leaf1);
  const cluster2 = CM_LeafCluster(world, leaf2);

  if (cluster1 === -1 || cluster2 === -1) {
    return false;
  }

  const phs = CM_ClusterPHS(world, cluster1);
  return (phs[cluster2 >> 3] & (1 << (cluster2 & 7))) !== 0;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local collision adapter)
 * Category: New
 *
 * Purpose:
 * - Resolves a point to a collision area for `FindTarget` sound-portal checks.
 */
function pointArea(point: vec3_t, runtime: GameRuntime): number {
  const world = runtime.collision?.world;
  if (!world) {
    return 0;
  }

  const leaf = CM_PointLeafnum(world, point);
  return CM_LeafArea(world, leaf);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local collision adapter)
 * Category: New
 *
 * Purpose:
 * - Reads an entity's linked area when available, with a point-area fallback for partial runtimes.
 */
function getEntityArea(entity: GameEntity, runtime: GameRuntime): number {
  if (entity.areanum !== 0) {
    return entity.areanum;
  }

  return pointArea(entity.s.origin, runtime);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local collision adapter)
 * Category: New
 *
 * Purpose:
 * - Delegates the local `FindTarget` sound-portal gate to the collision area's connectivity.
 */
function areasConnected(area1: number, area2: number, runtime: GameRuntime): boolean {
  const world = runtime.collision?.world;
  if (!world) {
    return false;
  }

  return CM_AreasConnected(world, area1, area2);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local integer RNG helper)
 * Category: New
 *
 * Purpose:
 * - Represents the C `rand()` integer branch used by the easy-skill melee gate.
 */
function randomInt(): number {
  return (Math.random() * 0x7fffffff) | 0;
}

void enemy_infront;
