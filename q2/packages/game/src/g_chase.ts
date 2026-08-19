/**
 * File: g_chase.ts
 * Source: Quake II original / game/g_chase.c
 * Purpose: Port of spectator chase-camera selection and update helpers.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses the explicit gameplay runtime and local collision bridge instead of `gi.*`.
 * - Re-links spectators through the runtime entity linker rather than the engine import table.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

import {
  ANGLE2SHORT,
  AngleVectors,
  MASK_SOLID,
  PITCH,
  PMF_NO_PREDICTION,
  ROLL,
  VectorCopy,
  VectorMA,
  VectorNormalize,
  YAW,
  pmtype_t,
  vec3_origin,
  type vec3_t
} from "../../qcommon/src/index.js";
import { linkGameEntity } from "./runtime.js";
import type { GameEntity, GameRuntime } from "./runtime.js";

/**
 * Original name: UpdateChaseCam
 * Source: Quake-2-master/game/g_chase.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Repositions one spectator onto the active chase camera behind their target.
 */
export function UpdateChaseCam(ent: GameEntity, runtime: GameRuntime): void {
  if (!ent.client || !ent.client.chase_target) {
    return;
  }

  const chaseTarget = ent.client.chase_target;
  if (
    !chaseTarget.inuse ||
    !chaseTarget.client ||
    chaseTarget.client.resp.spectator
  ) {
    const old = chaseTarget;
    ChaseNext(ent, runtime);
    if (ent.client.chase_target === old) {
      ent.client.chase_target = null;
      ent.client.ps.pmove.pm_flags &= ~PMF_NO_PREDICTION;
      return;
    }
  }

  const targ = ent.client.chase_target;
  if (!targ?.client || !runtime.collision) {
    return;
  }

  const o: vec3_t = [0, 0, 0];
  const ownerv: vec3_t = [0, 0, 0];
  const goal: vec3_t = [0, 0, 0];
  const oldgoal: vec3_t = [0, 0, 0];
  const angles: vec3_t = [0, 0, 0];

  VectorCopy(targ.s.origin, ownerv);
  VectorCopy(ent.s.origin, oldgoal);

  ownerv[2] += targ.viewheight;

  VectorCopy(targ.client.v_angle, angles);
  if (angles[PITCH] > 56) {
    angles[PITCH] = 56;
  }

  const { forward } = AngleVectors(angles);
  VectorNormalize(forward);
  VectorMA(ownerv, -30, forward, o);

  if (o[2] < targ.s.origin[2] + 20) {
    o[2] = targ.s.origin[2] + 20;
  }

  if (!targ.groundentity) {
    o[2] += 16;
  }

  let trace = runtime.collision.trace(ownerv, vec3_origin, vec3_origin, o, targ, MASK_SOLID);

  VectorCopy(trace.endpos, goal);
  VectorMA(goal, 2, forward, goal);

  VectorCopy(goal, o);
  o[2] += 6;
  trace = runtime.collision.trace(goal, vec3_origin, vec3_origin, o, targ, MASK_SOLID);
  if (trace.fraction < 1) {
    VectorCopy(trace.endpos, goal);
    goal[2] -= 6;
  }

  VectorCopy(goal, o);
  o[2] -= 6;
  trace = runtime.collision.trace(goal, vec3_origin, vec3_origin, o, targ, MASK_SOLID);
  if (trace.fraction < 1) {
    VectorCopy(trace.endpos, goal);
    goal[2] += 6;
  }

  if (targ.deadflag) {
    ent.client.ps.pmove.pm_type = pmtype_t.PM_DEAD;
  } else {
    ent.client.ps.pmove.pm_type = pmtype_t.PM_FREEZE;
  }

  VectorCopy(goal, ent.origin);
  VectorCopy(goal, ent.s.origin);

  for (let i = 0; i < 3; i += 1) {
    ent.client.ps.pmove.delta_angles[i] = ANGLE2SHORT(targ.client.v_angle[i] - ent.client.resp.cmd_angles[i]);
  }

  if (targ.deadflag) {
    ent.client.ps.viewangles[ROLL] = 40;
    ent.client.ps.viewangles[PITCH] = -15;
    ent.client.ps.viewangles[YAW] = targ.client.killer_yaw;
  } else {
    VectorCopy(targ.client.v_angle, ent.client.ps.viewangles);
    VectorCopy(targ.client.v_angle, ent.client.v_angle);
  }

  ent.viewheight = 0;
  ent.client.ps.pmove.pm_flags |= PMF_NO_PREDICTION;
  linkGameEntity(runtime, ent);
}

/**
 * Original name: ChaseNext
 * Source: Quake-2-master/game/g_chase.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Advances one spectator chase target to the next active non-spectator client.
 */
export function ChaseNext(ent: GameEntity, runtime: GameRuntime): void {
  if (!ent.client?.chase_target) {
    return;
  }

  let i = ent.client.chase_target.index;
  let e: GameEntity | null = null;

  do {
    i += 1;
    if (i > runtime.maxclients) {
      i = 1;
    }

    e = runtime.entities[i] ?? null;
    if (!e?.inuse) {
      continue;
    }
    if (!e.client?.resp.spectator) {
      break;
    }
  } while (e !== ent.client.chase_target);

  if (!e) {
    return;
  }

  ent.client.chase_target = e;
  ent.client.update_chase = true;
}

/**
 * Original name: ChasePrev
 * Source: Quake-2-master/game/g_chase.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Moves one spectator chase target to the previous active non-spectator client.
 */
export function ChasePrev(ent: GameEntity, runtime: GameRuntime): void {
  if (!ent.client?.chase_target) {
    return;
  }

  let i = ent.client.chase_target.index;
  let e: GameEntity | null = null;

  do {
    i -= 1;
    if (i < 1) {
      i = runtime.maxclients;
    }

    e = runtime.entities[i] ?? null;
    if (!e?.inuse) {
      continue;
    }
    if (!e.client?.resp.spectator) {
      break;
    }
  } while (e !== ent.client.chase_target);

  if (!e) {
    return;
  }

  ent.client.chase_target = e;
  ent.client.update_chase = true;
}

/**
 * Original name: GetChaseTarget
 * Source: Quake-2-master/game/g_chase.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Finds the first chaseable player for one spectator and snaps the chase camera to them.
 */
export function GetChaseTarget(ent: GameEntity, runtime: GameRuntime): void {
  if (!ent.client) {
    return;
  }

  for (let i = 1; i <= runtime.maxclients; i += 1) {
    const other = runtime.entities[i] ?? null;
    if (other?.inuse && !other.client?.resp.spectator) {
      ent.client.chase_target = other;
      ent.client.update_chase = true;
      UpdateChaseCam(ent, runtime);
      return;
    }
  }

  runtime.log({
    kind: "message",
    message: `#${ent.index} No other players to chase.`,
    entityIndex: ent.index,
    entityClassname: ent.classname
  });
}
