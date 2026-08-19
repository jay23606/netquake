/**
 * File: m_move.ts
 * Source: Quake II original / game/m_move.c
 * Purpose: Port of the shared monster movement helpers used by gameplay AI.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses the explicit gameplay collision runtime instead of `gi.trace` and `gi.pointcontents`.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

import { MASK_MONSTERSOLID, MASK_WATER, anglemod, type trace_t, type vec3_t } from "../../qcommon/src/index.js";
import { CONTENTS_SOLID } from "../../qcommon/src/q_shared.js";
import { AI_NOSTEP, FL_FLY, FL_PARTIALGROUND, FL_SWIM } from "./g_local.js";
import { linkGameEntity } from "./runtime.js";
import type { GameEntity, GameRuntime } from "./runtime.js";
import { touchTriggerEntities } from "./touch.js";

/**
 * Original name: STEPSIZE
 * Source: game/m_move.c
 * Category: Ported
 */
export const STEPSIZE = 18;

/**
 * Original name: DI_NODIR
 * Source: game/m_move.c
 * Category: Ported
 */
export const DI_NODIR = -1;

/**
 * Original name: c_yes
 * Source: game/m_move.c
 * Category: Ported
 */
export let c_yes = 0;

/**
 * Original name: c_no
 * Source: game/m_move.c
 * Category: Ported
 */
export let c_no = 0;

/**
 * Original name: M_CheckBottom
 * Source: game/m_move.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns whether the monster bottom is safely supported rather than dangling off an edge.
 */
export function M_CheckBottom(ent: GameEntity, runtime: GameRuntime): boolean {
  ensureCollision(runtime);

  const mins: vec3_t = [
    ent.s.origin[0] + ent.mins[0],
    ent.s.origin[1] + ent.mins[1],
    ent.s.origin[2] + ent.mins[2]
  ];
  const maxs: vec3_t = [
    ent.s.origin[0] + ent.maxs[0],
    ent.s.origin[1] + ent.maxs[1],
    ent.s.origin[2] + ent.maxs[2]
  ];
  const start: vec3_t = [0, 0, mins[2] - 1];
  const stop: vec3_t = [0, 0, 0];

  for (let x = 0; x <= 1; x += 1) {
    for (let y = 0; y <= 1; y += 1) {
      start[0] = x ? maxs[0] : mins[0];
      start[1] = y ? maxs[1] : mins[1];
      if (runtime.collision!.pointcontents(start, ent) !== CONTENTS_SOLID) {
        return M_CheckBottomReal(ent, runtime, mins, maxs, start, stop);
      }
    }
  }

  c_yes += 1;
  return true;
}

/**
 * Original name: SV_movestep
 * Source: game/m_move.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Attempts one monster move step with slope, stair, water and flying/swimming constraints.
 */
export function SV_movestep(ent: GameEntity, move: vec3_t, relink: boolean, runtime: GameRuntime): boolean {
  ensureCollision(runtime);

  const oldorg: vec3_t = [...ent.s.origin];
  let neworg: vec3_t = [
    ent.s.origin[0] + move[0],
    ent.s.origin[1] + move[1],
    ent.s.origin[2] + move[2]
  ];

  if ((ent.flags & (FL_SWIM | FL_FLY)) !== 0) {
    for (let i = 0; i < 2; i += 1) {
      neworg = [
        ent.s.origin[0] + move[0],
        ent.s.origin[1] + move[1],
        ent.s.origin[2] + move[2]
      ];

      if (i === 0 && ent.enemy) {
        if (!ent.goalentity) {
          ent.goalentity = ent.enemy;
        }

        const goal = ent.goalentity;
        if (goal) {
          const dz = ent.s.origin[2] - goal.s.origin[2];
          if (goal.client) {
            if (dz > 40) {
              neworg[2] -= 8;
            }
            if (((ent.flags & FL_SWIM) === 0 || ent.waterlevel >= 2) && dz < 30) {
              neworg[2] += 8;
            }
          } else {
            if (dz > 8) {
              neworg[2] -= 8;
            } else if (dz > 0) {
              neworg[2] -= dz;
            } else if (dz < -8) {
              neworg[2] += 8;
            } else {
              neworg[2] += dz;
            }
          }
        }
      }

      const trace = runtime.collision!.trace(ent.s.origin, ent.mins, ent.maxs, neworg, ent, MASK_MONSTERSOLID);

      if ((ent.flags & FL_FLY) !== 0 && ent.waterlevel === 0) {
        const test: vec3_t = [
          trace.endpos[0],
          trace.endpos[1],
          trace.endpos[2] + ent.mins[2] + 1
        ];
        const contents = runtime.collision!.pointcontents(test, ent);
        if ((contents & MASK_WATER) !== 0) {
          return false;
        }
      }

      if ((ent.flags & FL_SWIM) !== 0 && ent.waterlevel < 2) {
        const test: vec3_t = [
          trace.endpos[0],
          trace.endpos[1],
          trace.endpos[2] + ent.mins[2] + 1
        ];
        const contents = runtime.collision!.pointcontents(test, ent);
        if ((contents & MASK_WATER) === 0) {
          return false;
        }
      }

      if (trace.fraction === 1) {
        setEntityOrigin(ent, trace.endpos);
        if (relink) {
          relinkMonster(ent, runtime);
        }
        return true;
      }

      if (!ent.enemy) {
        break;
      }
    }

    return false;
  }

  const stepsize = (ent.monsterinfo.aiflags & AI_NOSTEP) === 0 ? STEPSIZE : 1;
  neworg[2] += stepsize;
  const end: vec3_t = [...neworg];
  end[2] -= stepsize * 2;

  let trace = runtime.collision!.trace(neworg, ent.mins, ent.maxs, end, ent, MASK_MONSTERSOLID);

  if (trace.allsolid) {
    return false;
  }

  if (trace.startsolid) {
    neworg[2] -= stepsize;
    trace = runtime.collision!.trace(neworg, ent.mins, ent.maxs, end, ent, MASK_MONSTERSOLID);
    if (trace.allsolid || trace.startsolid) {
      return false;
    }
  }

  if (ent.waterlevel === 0) {
    const test: vec3_t = [
      trace.endpos[0],
      trace.endpos[1],
      trace.endpos[2] + ent.mins[2] + 1
    ];
    const contents = runtime.collision!.pointcontents(test, ent);
    if ((contents & MASK_WATER) !== 0) {
      return false;
    }
  }

  if (trace.fraction === 1) {
    if ((ent.flags & FL_PARTIALGROUND) !== 0) {
      setEntityOrigin(ent, addVec3(ent.s.origin, move));
      if (relink) {
        relinkMonster(ent, runtime);
      }
      ent.groundentity = null;
      return true;
    }

    return false;
  }

  setEntityOrigin(ent, trace.endpos);

  if (!M_CheckBottom(ent, runtime)) {
    if ((ent.flags & FL_PARTIALGROUND) !== 0) {
      if (relink) {
        relinkMonster(ent, runtime);
      }
      return true;
    }

    setEntityOrigin(ent, oldorg);
    return false;
  }

  if ((ent.flags & FL_PARTIALGROUND) !== 0) {
    ent.flags &= ~FL_PARTIALGROUND;
  }

  ent.groundentity = asGameEntity(trace.ent);
  ent.groundentity_linkcount = ent.groundentity?.linkcount ?? 0;

  if (relink) {
    relinkMonster(ent, runtime);
  }

  return true;
}

/**
 * Original name: M_ChangeYaw
 * Source: game/m_move.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Turns one monster toward `ideal_yaw` while clamping by `yaw_speed`.
 */
export function M_ChangeYaw(ent: GameEntity): void {
  const current = anglemod(ent.s.angles[1]);
  const ideal = ent.ideal_yaw;

  if (current === ideal) {
    return;
  }

  let move = ideal - current;
  const speed = ent.yaw_speed;

  if (ideal > current) {
    if (move >= 180) {
      move -= 360;
    }
  } else if (move <= -180) {
    move += 360;
  }

  if (move > 0) {
    if (move > speed) {
      move = speed;
    }
  } else if (move < -speed) {
    move = -speed;
  }

  ent.s.angles[1] = anglemod(current + move);
  ent.angles[1] = ent.s.angles[1];
}

/**
 * Original name: SV_StepDirection
 * Source: game/m_move.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Tries to turn toward one yaw and take one movement step in that direction.
 */
export function SV_StepDirection(ent: GameEntity, yaw: number, dist: number, runtime: GameRuntime): boolean {
  ent.ideal_yaw = yaw;
  M_ChangeYaw(ent);

  const yawRadians = yaw * Math.PI * 2 / 360;
  const move: vec3_t = [Math.cos(yawRadians) * dist, Math.sin(yawRadians) * dist, 0];
  const oldorigin: vec3_t = [...ent.s.origin];

  if (SV_movestep(ent, move, false, runtime)) {
    const delta = ent.s.angles[1] - ent.ideal_yaw;
    if (delta > 45 && delta < 315) {
      setEntityOrigin(ent, oldorigin);
    }
    relinkMonster(ent, runtime);
    return true;
  }

  relinkMonster(ent, runtime);
  return false;
}

/**
 * Original name: SV_FixCheckBottom
 * Source: game/m_move.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Marks one monster as having partial ground support.
 */
export function SV_FixCheckBottom(ent: GameEntity): void {
  ent.flags |= FL_PARTIALGROUND;
}

/**
 * Original name: SV_NewChaseDir
 * Source: game/m_move.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Chooses a new chase direction toward the enemy or goal, falling back through the original search order.
 */
export function SV_NewChaseDir(actor: GameEntity, enemy: GameEntity | null, dist: number, runtime: GameRuntime): void {
  if (!enemy) {
    return;
  }

  const d: [number, number, number] = [0, DI_NODIR, DI_NODIR];
  const olddir = anglemod(Math.trunc(actor.ideal_yaw / 45) * 45);
  const turnaround = anglemod(olddir - 180);
  const deltax = enemy.s.origin[0] - actor.s.origin[0];
  const deltay = enemy.s.origin[1] - actor.s.origin[1];

  if (deltax > 10) {
    d[1] = 0;
  } else if (deltax < -10) {
    d[1] = 180;
  }

  if (deltay < -10) {
    d[2] = 270;
  } else if (deltay > 10) {
    d[2] = 90;
  }

  if (d[1] !== DI_NODIR && d[2] !== DI_NODIR) {
    const tdir = d[1] === 0
      ? (d[2] === 90 ? 45 : 315)
      : (d[2] === 90 ? 135 : 215);

    if (tdir !== turnaround && SV_StepDirection(actor, tdir, dist, runtime)) {
      return;
    }
  }

  if (((randomInt() & 3) & 1) !== 0 || Math.abs(deltay) > Math.abs(deltax)) {
    const tdir = d[1];
    d[1] = d[2];
    d[2] = tdir;
  }

  if (d[1] !== DI_NODIR && d[1] !== turnaround && SV_StepDirection(actor, d[1], dist, runtime)) {
    return;
  }

  if (d[2] !== DI_NODIR && d[2] !== turnaround && SV_StepDirection(actor, d[2], dist, runtime)) {
    return;
  }

  if (olddir !== DI_NODIR && SV_StepDirection(actor, olddir, dist, runtime)) {
    return;
  }

  if ((randomInt() & 1) !== 0) {
    for (let tdir = 0; tdir <= 315; tdir += 45) {
      if (tdir !== turnaround && SV_StepDirection(actor, tdir, dist, runtime)) {
        return;
      }
    }
  } else {
    for (let tdir = 315; tdir >= 0; tdir -= 45) {
      if (tdir !== turnaround && SV_StepDirection(actor, tdir, dist, runtime)) {
        return;
      }
    }
  }

  if (turnaround !== DI_NODIR && SV_StepDirection(actor, turnaround, dist, runtime)) {
    return;
  }

  actor.ideal_yaw = olddir;

  if (!M_CheckBottom(actor, runtime)) {
    SV_FixCheckBottom(actor);
  }
}

/**
 * Original name: SV_CloseEnough
 * Source: game/m_move.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns whether one entity bounding box lies within `dist` of the goal bounds on every axis.
 */
export function SV_CloseEnough(ent: GameEntity, goal: GameEntity, dist: number): boolean {
  for (let i = 0; i < 3; i += 1) {
    if (goal.absmin[i] > ent.absmax[i] + dist) {
      return false;
    }
    if (goal.absmax[i] < ent.absmin[i] - dist) {
      return false;
    }
  }
  return true;
}

/**
 * Original name: M_MoveToGoal
 * Source: game/m_move.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Moves one monster toward its goal entity using the original chase-direction fallbacks.
 */
export function M_MoveToGoal(ent: GameEntity, dist: number, runtime: GameRuntime): void {
  const goal = ent.goalentity;

  if (!ent.groundentity && (ent.flags & (FL_FLY | FL_SWIM)) === 0) {
    return;
  }

  if (ent.enemy && SV_CloseEnough(ent, ent.enemy, dist)) {
    return;
  }

  if ((randomInt() & 3) === 1 || !SV_StepDirection(ent, ent.ideal_yaw, dist, runtime)) {
    if (ent.inuse) {
      SV_NewChaseDir(ent, goal, dist, runtime);
    }
  }
}

/**
 * Original name: M_walkmove
 * Source: game/m_move.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Walks one grounded or flying/swimming monster by yaw and distance.
 */
export function M_walkmove(ent: GameEntity, yaw: number, dist: number, runtime: GameRuntime): boolean {
  if (!ent.groundentity && (ent.flags & (FL_FLY | FL_SWIM)) === 0) {
    return false;
  }

  const yawRadians = yaw * Math.PI * 2 / 360;
  const move: vec3_t = [Math.cos(yawRadians) * dist, Math.sin(yawRadians) * dist, 0];
  return SV_movestep(ent, move, true, runtime);
}

/**
 * Original name: N/A
 * Source: Quake-2-master/game/m_move.c (M_CheckBottom realcheck block)
 * Category: Adapter
 * Fidelity level: Close
 *
 * Purpose:
 * - Keeps the original `M_CheckBottom` realcheck branch separate without claiming a second C owner.
 */
function M_CheckBottomReal(
  ent: GameEntity,
  runtime: GameRuntime,
  mins: vec3_t,
  maxs: vec3_t,
  start: vec3_t,
  stop: vec3_t
): boolean {
  c_no += 1;

  start[2] = mins[2];
  start[0] = stop[0] = (mins[0] + maxs[0]) * 0.5;
  start[1] = stop[1] = (mins[1] + maxs[1]) * 0.5;
  stop[2] = start[2] - 2 * STEPSIZE;

  let trace = runtime.collision!.trace(start, [0, 0, 0], [0, 0, 0], stop, ent, MASK_MONSTERSOLID);
  if (trace.fraction === 1.0) {
    return false;
  }

  const mid = trace.endpos[2];
  let bottom = trace.endpos[2];

  for (let x = 0; x <= 1; x += 1) {
    for (let y = 0; y <= 1; y += 1) {
      start[0] = stop[0] = x ? maxs[0] : mins[0];
      start[1] = stop[1] = y ? maxs[1] : mins[1];

      trace = runtime.collision!.trace(start, [0, 0, 0], [0, 0, 0], stop, ent, MASK_MONSTERSOLID);

      if (trace.fraction !== 1.0 && trace.endpos[2] > bottom) {
        bottom = trace.endpos[2];
      }
      if (trace.fraction === 1.0 || mid - trace.endpos[2] > STEPSIZE) {
        return false;
      }
    }
  }

  c_yes += 1;
  return true;
}

/**
 * Original name: N/A
 * Source: N/A (local relink helper)
 * Category: New
 * Fidelity level: New
 *
 * Purpose:
 * - Centralizes the original relink plus trigger-touch side effects used after monster movement.
 */
function relinkMonster(ent: GameEntity, runtime: GameRuntime): void {
  linkGameEntity(runtime, ent);
  touchTriggerEntities(runtime, ent);
}

/**
 * Original name: N/A
 * Source: N/A (local origin sync helper)
 * Category: New
 * Fidelity level: New
 *
 * Purpose:
 * - Keeps legacy `origin` and networked `s.origin` fields synchronized after movement.
 */
function setEntityOrigin(ent: GameEntity, origin: vec3_t): void {
  ent.s.origin = [...origin];
  ent.origin = [...origin];
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Fidelity level: New
 *
 * Purpose:
 * - Provides a local immutable vector addition for movement calculations.
 */
function addVec3(left: vec3_t, right: vec3_t): vec3_t {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

/**
 * Original name: N/A
 * Source: N/A (runtime guard helper)
 * Category: New
 * Fidelity level: New
 *
 * Purpose:
 * - Fails early when monster movement is used without the collision bridge that replaces `gi.trace`.
 */
function ensureCollision(runtime: GameRuntime): void {
  if (!runtime.collision) {
    throw new Error("m_move requires runtime collision bridge");
  }
}

/**
 * Original name: N/A
 * Source: N/A (trace entity adapter helper)
 * Category: New
 * Fidelity level: New
 *
 * Purpose:
 * - Narrows trace entity payloads back to game entities for ground ownership bookkeeping.
 */
function asGameEntity(value: trace_t["ent"]): GameEntity | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  return value as GameEntity;
}

/**
 * Original name: N/A
 * Source: N/A (local random helper)
 * Category: New
 * Fidelity level: New
 *
 * Purpose:
 * - Mirrors the integer shape expected by the original `rand()` branches in this movement file.
 */
function randomInt(): number {
  return (Math.random() * 0x7fffffff) | 0;
}
