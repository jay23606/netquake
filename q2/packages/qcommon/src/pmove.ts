/**
 * File: pmove.ts
 * Source: Quake II original / qcommon/pmove.c
 * Purpose: Port the early player movement helpers shared by client prediction and authoritative simulation.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Exposes the original file-scope globals through an explicit context object.
 * - Keeps a small options surface for harnesses and staged integrations, while preserving original behavior by default.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 * - The default `Pmove` execution path mirrors the original `qcommon/pmove.c` flow.
 */

import {
  AngleVectors,
  CONTENTS_LADDER,
  CONTENTS_CURRENT_0,
  CONTENTS_CURRENT_90,
  CONTENTS_CURRENT_180,
  CONTENTS_CURRENT_270,
  CONTENTS_CURRENT_DOWN,
  CONTENTS_CURRENT_UP,
  CONTENTS_SLIME,
  CONTENTS_SOLID,
  CONTENTS_WATER,
  MASK_CURRENT,
  MASK_WATER,
  MAXTOUCH,
  PMF_DUCKED,
  PMF_JUMP_HELD,
  PMF_ON_GROUND,
  PMF_TIME_LAND,
  PMF_TIME_TELEPORT,
  PMF_TIME_WATERJUMP,
  PITCH,
  ROLL,
  SHORT2ANGLE,
  SURF_SLICK,
  YAW,
  type cplane_t,
  type csurface_t,
  type pmove_t,
  pmtype_t,
  type qboolean,
  type vec3_t
} from "./q_shared.js";
import {
  CrossProduct,
  DotProduct,
  VectorClear,
  VectorCopy,
  VectorLength,
  VectorMA,
  VectorNormalize,
  VectorScale,
  vec3_origin
} from "../../math/src/q_shared.js";

export const STEPSIZE = 18;
export const STOP_EPSILON = 0.1;
export const MIN_STEP_NORMAL = 0.7;
export const MAX_CLIP_PLANES = 5;

/**
 * Original name: pml_t
 * Source: qcommon/pmove.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Holds the mutable locals that `pmove.c` stores in the original `pml_t` file-scope struct.
 *
 * Porting notes:
 * - Preserves the original mix of float local state and packed-origin fallback data across one pmove execution.
 */
export interface pml_t {
  origin: vec3_t;
  velocity: vec3_t;
  forward: vec3_t;
  right: vec3_t;
  up: vec3_t;
  frametime: number;
  groundsurface: csurface_t | null;
  groundplane: cplane_t;
  groundcontents: number;
  previous_origin: vec3_t;
  ladder: qboolean;
}

/**
 * Original name: N/A
 * Source: N/A (TypeScript ownership wrapper for qcommon/pmove.c file-scope globals)
 * Category: New
 * Purpose: Gather the original file-scope pmove globals and tunables into an explicit runtime object.
 *
 * Constraints:
 * - Default tunables must match the original Quake II movement constants.
 */
export interface PmoveContext {
  pm: pmove_t;
  pml: pml_t;
  pm_stopspeed: number;
  pm_maxspeed: number;
  pm_duckspeed: number;
  pm_accelerate: number;
  pm_airaccelerate: number;
  pm_wateraccelerate: number;
  pm_friction: number;
  pm_waterfriction: number;
  pm_waterspeed: number;
}

/**
 * Original name: N/A
 * Source: N/A (TypeScript pmove orchestration options)
 * Category: New
 * Purpose: Expose harness-only gates around the default `Pmove` orchestration without changing original behavior.
 *
 * Constraints:
 * - Omitted flags must follow Quake II's original `Pmove` path.
 */
export interface PmoveOptions {
  allowWaterMove?: boolean;
  allowSpectatorMove?: boolean;
  spectatorDoClip?: boolean;
  allowSnapPosition?: boolean;
  allowInitialSnapPosition?: boolean;
  allowSpecialMovement?: boolean;
}

/**
 * Original name: N/A
 * Source: N/A (TypeScript cplane factory)
 * Category: New
 * Purpose: Create a zero-initialized cplane_t compatible with Quake II trace defaults.
 */
export function createCplane(): cplane_t {
  return {
    normal: [0, 0, 0],
    dist: 0,
    type: 0,
    signbits: 0,
    pad: [0, 0]
  };
}

/**
 * Original name: N/A
 * Source: N/A (TypeScript pml_t factory)
 * Category: New
 * Purpose: Create the local `pml_t` state used during a single pmove execution.
 */
export function createPmlState(): pml_t {
  return {
    origin: [0, 0, 0],
    velocity: [0, 0, 0],
    forward: [0, 0, 0],
    right: [0, 0, 0],
    up: [0, 0, 0],
    frametime: 0,
    groundsurface: null,
    groundplane: createCplane(),
    groundcontents: 0,
    previous_origin: [0, 0, 0],
    ladder: false
  };
}

/**
 * Original name: N/A
 * Source: N/A (TypeScript pmove context wrapper)
 * Category: New
 * Purpose: Build a pmove context with original Quake II movement tuning defaults.
 *
 * Constraints:
 * - Must allow the caller to pass an already-initialized `pmove_t`.
 */
export function createPmoveContext(pm: pmove_t): PmoveContext {
  return {
    pm,
    pml: createPmlState(),
    pm_stopspeed: 100,
    pm_maxspeed: 300,
    pm_duckspeed: 100,
    pm_accelerate: 10,
    pm_airaccelerate: 0,
    pm_wateraccelerate: 10,
    pm_friction: 6,
    pm_waterfriction: 1,
    pm_waterspeed: 400
  };
}

/**
 * Original name: N/A
 * Source: N/A (TypeScript pml_t initialization helper)
 * Category: New
 * Purpose: Seed the local pmove state from the current packed `pmove_t` values.
 *
 * Constraints:
 * - Must keep Quake II's fixed-point `0.125` scale for origin and velocity conversion.
 */
export function PM_InitLocalState(context: PmoveContext, frametime: number): void {
  context.pml.frametime = frametime;

  for (let index = 0; index < 3; index += 1) {
    context.pml.origin[index] = context.pm.s.origin[index] * 0.125;
    context.pml.velocity[index] = context.pm.s.velocity[index] * 0.125;
    context.pml.previous_origin[index] = context.pm.s.origin[index];
  }
}

/**
 * Original name: N/A
 * Source: N/A (TypeScript pmove state sync helper)
 * Category: New
 * Purpose: Write the local float-precision movement state back into the packed `pmove_t`.
 *
 * Constraints:
 * - Must preserve Quake II's truncation semantics when converting back to packed integers.
 */
export function PM_SyncToState(context: PmoveContext): void {
  for (let index = 0; index < 3; index += 1) {
    context.pm.s.origin[index] = Math.trunc(context.pml.origin[index] * 8);
    context.pm.s.velocity[index] = Math.trunc(context.pml.velocity[index] * 8);
  }
}

/**
 * Original name: N/A
 * Source: N/A (TypeScript pmove result reset helper)
 * Category: New
 * Purpose: Clear the result fields that Quake II resets at the start of each `Pmove` call.
 *
 * Constraints:
 * - Must leave command and packed player state untouched.
 */
export function PM_ClearResults(context: PmoveContext): void {
  context.pm.numtouch = 0;
  context.pm.viewangles[0] = 0;
  context.pm.viewangles[1] = 0;
  context.pm.viewangles[2] = 0;
  context.pm.viewheight = 0;
  context.pm.groundentity = null;
  context.pm.watertype = 0;
  context.pm.waterlevel = 0;
}

/**
 * Original name: PM_ClipVelocity
 * Source: qcommon/pmove.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Slides a velocity vector along an impact plane while removing near-zero jitter.
 */
export function PM_ClipVelocity(inVector: vec3_t, normal: vec3_t, outVector: vec3_t, overbounce: number): void {
  const backoff = DotProduct(inVector, normal) * overbounce;

  for (let index = 0; index < 3; index += 1) {
    const change = normal[index] * backoff;
    outVector[index] = inVector[index] - change;
    if (outVector[index] > -STOP_EPSILON && outVector[index] < STOP_EPSILON) {
      outVector[index] = 0;
    }
  }
}

/**
 * Original name: PM_StepSlideMove_
 * Source: qcommon/pmove.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Performs collision sliding across up to four bumps while accumulating touch entities.
 *
 * Porting notes:
 * - Requires `pm.trace` to be available exactly like the original movement core.
 */
export function PM_StepSlideMove_(context: PmoveContext): void {
  if (!context.pm.trace) {
    throw new Error("PM_StepSlideMove_ requires pm.trace");
  }

  const numbumps = 4;
  const planes: vec3_t[] = [];
  const primal_velocity: vec3_t = [0, 0, 0];
  const end: vec3_t = [0, 0, 0];
  const dir: vec3_t = [0, 0, 0];

  VectorCopy(context.pml.velocity, primal_velocity);
  let numplanes = 0;
  let time_left = context.pml.frametime;

  for (let bumpcount = 0; bumpcount < numbumps; bumpcount += 1) {
    for (let index = 0; index < 3; index += 1) {
      end[index] = context.pml.origin[index] + time_left * context.pml.velocity[index];
    }

    const trace = context.pm.trace(context.pml.origin, context.pm.mins, context.pm.maxs, end);

    if (trace.allsolid) {
      context.pml.velocity[2] = 0;
      return;
    }

    if (trace.fraction > 0) {
      VectorCopy(trace.endpos, context.pml.origin);
      numplanes = 0;
      planes.length = 0;
    }

    if (trace.fraction === 1) {
      break;
    }

    if (context.pm.numtouch < MAXTOUCH && trace.ent) {
      context.pm.touchents[context.pm.numtouch] = trace.ent;
      context.pm.numtouch += 1;
    }

    time_left -= time_left * trace.fraction;

    if (numplanes >= MAX_CLIP_PLANES) {
      VectorCopy(vec3_origin, context.pml.velocity);
      break;
    }

    planes[numplanes] = [trace.plane.normal[0], trace.plane.normal[1], trace.plane.normal[2]];
    numplanes += 1;

    let planeIndex = 0;
    for (; planeIndex < numplanes; planeIndex += 1) {
      PM_ClipVelocity(context.pml.velocity, planes[planeIndex], context.pml.velocity, 1.01);

      let compareIndex = 0;
      for (; compareIndex < numplanes; compareIndex += 1) {
        if (compareIndex === planeIndex) {
          continue;
        }

        if (DotProduct(context.pml.velocity, planes[compareIndex]) < 0) {
          break;
        }
      }

      if (compareIndex === numplanes) {
        break;
      }
    }

    if (planeIndex === numplanes) {
      if (numplanes !== 2) {
        VectorCopy(vec3_origin, context.pml.velocity);
        break;
      }

      CrossProduct(planes[0], planes[1], dir);
      const distance = DotProduct(dir, context.pml.velocity);
      VectorScale(dir, distance, context.pml.velocity);
    }

    if (DotProduct(context.pml.velocity, primal_velocity) <= 0) {
      VectorCopy(vec3_origin, context.pml.velocity);
      break;
    }
  }

  if (context.pm.s.pm_time) {
    VectorCopy(primal_velocity, context.pml.velocity);
  }
}

/**
 * Original name: PM_StepSlideMove
 * Source: qcommon/pmove.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Attempts a standard slide move, then retries by stepping up and comparing travel distance.
 */
export function PM_StepSlideMove(context: PmoveContext): void {
  if (!context.pm.trace) {
    throw new Error("PM_StepSlideMove requires pm.trace");
  }

  const start_o: vec3_t = [0, 0, 0];
  const start_v: vec3_t = [0, 0, 0];
  const down_o: vec3_t = [0, 0, 0];
  const down_v: vec3_t = [0, 0, 0];
  const up: vec3_t = [0, 0, 0];
  const down: vec3_t = [0, 0, 0];

  VectorCopy(context.pml.origin, start_o);
  VectorCopy(context.pml.velocity, start_v);

  PM_StepSlideMove_(context);

  VectorCopy(context.pml.origin, down_o);
  VectorCopy(context.pml.velocity, down_v);

  VectorCopy(start_o, up);
  up[2] += STEPSIZE;

  const initialTrace = context.pm.trace(up, context.pm.mins, context.pm.maxs, up);
  if (initialTrace.allsolid) {
    return;
  }

  VectorCopy(up, context.pml.origin);
  VectorCopy(start_v, context.pml.velocity);

  PM_StepSlideMove_(context);

  VectorCopy(context.pml.origin, down);
  down[2] -= STEPSIZE;
  const trace = context.pm.trace(context.pml.origin, context.pm.mins, context.pm.maxs, down);
  if (!trace.allsolid) {
    VectorCopy(trace.endpos, context.pml.origin);
  }

  VectorCopy(context.pml.origin, up);
  const down_dist =
    (down_o[0] - start_o[0]) * (down_o[0] - start_o[0]) +
    (down_o[1] - start_o[1]) * (down_o[1] - start_o[1]);
  const up_dist =
    (up[0] - start_o[0]) * (up[0] - start_o[0]) +
    (up[1] - start_o[1]) * (up[1] - start_o[1]);

  if (down_dist > up_dist || trace.plane.normal[2] < MIN_STEP_NORMAL) {
    VectorCopy(down_o, context.pml.origin);
    VectorCopy(down_v, context.pml.velocity);
    return;
  }

  context.pml.velocity[2] = down_v[2];
}

/**
 * Original name: PM_Friction
 * Source: qcommon/pmove.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Applies ground and water friction to the current local velocity.
 */
export function PM_Friction(context: PmoveContext): void {
  const vel = context.pml.velocity;
  const speed = Math.sqrt(vel[0] * vel[0] + vel[1] * vel[1] + vel[2] * vel[2]);

  if (speed < 1) {
    vel[0] = 0;
    vel[1] = 0;
    return;
  }

  let drop = 0;

  if (
    ((context.pm.groundentity && context.pml.groundsurface && (context.pml.groundsurface.flags & SURF_SLICK) === 0) ||
      context.pml.ladder)
  ) {
    const friction = context.pm_friction;
    const control = speed < context.pm_stopspeed ? context.pm_stopspeed : speed;
    drop += control * friction * context.pml.frametime;
  }

  if (context.pm.waterlevel && !context.pml.ladder) {
    drop += speed * context.pm_waterfriction * context.pm.waterlevel * context.pml.frametime;
  }

  let newspeed = speed - drop;
  if (newspeed < 0) {
    newspeed = 0;
  }

  newspeed /= speed;
  vel[0] *= newspeed;
  vel[1] *= newspeed;
  vel[2] *= newspeed;
}

/**
 * Original name: PM_Accelerate
 * Source: qcommon/pmove.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Accelerates local velocity toward the intended movement direction and speed.
 */
export function PM_Accelerate(context: PmoveContext, wishdir: vec3_t, wishspeed: number, accel: number): void {
  const currentspeed = DotProduct(context.pml.velocity, wishdir);
  const addspeed = wishspeed - currentspeed;
  if (addspeed <= 0) {
    return;
  }

  let accelspeed = accel * context.pml.frametime * wishspeed;
  if (accelspeed > addspeed) {
    accelspeed = addspeed;
  }

  for (let index = 0; index < 3; index += 1) {
    context.pml.velocity[index] += accelspeed * wishdir[index];
  }
}

/**
 * Original name: PM_AirAccelerate
 * Source: qcommon/pmove.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Applies the air-control variant of Quake II acceleration with a capped wish speed.
 */
export function PM_AirAccelerate(context: PmoveContext, wishdir: vec3_t, wishspeed: number, accel: number): void {
  let wishspd = wishspeed;
  if (wishspd > 30) {
    wishspd = 30;
  }

  const currentspeed = DotProduct(context.pml.velocity, wishdir);
  const addspeed = wishspd - currentspeed;
  if (addspeed <= 0) {
    return;
  }

  let accelspeed = accel * wishspeed * context.pml.frametime;
  if (accelspeed > addspeed) {
    accelspeed = addspeed;
  }

  for (let index = 0; index < 3; index += 1) {
    context.pml.velocity[index] += accelspeed * wishdir[index];
  }
}

/**
 * Original name: PM_AddCurrents
 * Source: qcommon/pmove.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Applies ladder, water current and conveyor influences to a desired movement vector.
 */
export function PM_AddCurrents(context: PmoveContext, wishvel: vec3_t): void {
  const v: vec3_t = [0, 0, 0];

  if (context.pml.ladder && Math.abs(context.pml.velocity[2]) <= 200) {
    if (context.pm.viewangles[PITCH] <= -15 && context.pm.cmd.forwardmove > 0) {
      wishvel[2] = 200;
    } else if (context.pm.viewangles[PITCH] >= 15 && context.pm.cmd.forwardmove > 0) {
      wishvel[2] = -200;
    } else if (context.pm.cmd.upmove > 0) {
      wishvel[2] = 200;
    } else if (context.pm.cmd.upmove < 0) {
      wishvel[2] = -200;
    } else {
      wishvel[2] = 0;
    }

    if (wishvel[0] < -25) {
      wishvel[0] = -25;
    } else if (wishvel[0] > 25) {
      wishvel[0] = 25;
    }

    if (wishvel[1] < -25) {
      wishvel[1] = -25;
    } else if (wishvel[1] > 25) {
      wishvel[1] = 25;
    }
  }

  if ((context.pm.watertype & MASK_CURRENT) !== 0) {
    VectorClear(v);

    if ((context.pm.watertype & CONTENTS_CURRENT_0) !== 0) {
      v[0] += 1;
    }
    if ((context.pm.watertype & CONTENTS_CURRENT_90) !== 0) {
      v[1] += 1;
    }
    if ((context.pm.watertype & CONTENTS_CURRENT_180) !== 0) {
      v[0] -= 1;
    }
    if ((context.pm.watertype & CONTENTS_CURRENT_270) !== 0) {
      v[1] -= 1;
    }
    if ((context.pm.watertype & CONTENTS_CURRENT_UP) !== 0) {
      v[2] += 1;
    }
    if ((context.pm.watertype & CONTENTS_CURRENT_DOWN) !== 0) {
      v[2] -= 1;
    }

    let speed = context.pm_waterspeed;
    if (context.pm.waterlevel === 1 && context.pm.groundentity) {
      speed /= 2;
    }

    VectorMA(wishvel, speed, v, wishvel);
  }

  if (context.pm.groundentity) {
    VectorClear(v);

    if ((context.pml.groundcontents & CONTENTS_CURRENT_0) !== 0) {
      v[0] += 1;
    }
    if ((context.pml.groundcontents & CONTENTS_CURRENT_90) !== 0) {
      v[1] += 1;
    }
    if ((context.pml.groundcontents & CONTENTS_CURRENT_180) !== 0) {
      v[0] -= 1;
    }
    if ((context.pml.groundcontents & CONTENTS_CURRENT_270) !== 0) {
      v[1] -= 1;
    }
    if ((context.pml.groundcontents & CONTENTS_CURRENT_UP) !== 0) {
      v[2] += 1;
    }
    if ((context.pml.groundcontents & CONTENTS_CURRENT_DOWN) !== 0) {
      v[2] -= 1;
    }

    VectorMA(wishvel, 100, v, wishvel);
  }
}

/**
 * Original name: PM_CheckDuck
 * Source: qcommon/pmove.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Updates the movement bounds and viewheight according to duck/gib/dead state.
 *
 * Porting notes:
 * - Requires `pm.trace` for the stand-up clearance test, mirroring the original path.
 */
export function PM_CheckDuck(context: PmoveContext): void {
  if (!context.pm.trace) {
    throw new Error("PM_CheckDuck requires pm.trace");
  }

  context.pm.mins[0] = -16;
  context.pm.mins[1] = -16;
  context.pm.maxs[0] = 16;
  context.pm.maxs[1] = 16;

  if (context.pm.s.pm_type === pmtype_t.PM_GIB) {
    context.pm.mins[2] = 0;
    context.pm.maxs[2] = 16;
    context.pm.viewheight = 8;
    return;
  }

  context.pm.mins[2] = -24;

  if (context.pm.s.pm_type === pmtype_t.PM_DEAD) {
    context.pm.s.pm_flags |= PMF_DUCKED;
  } else if (context.pm.cmd.upmove < 0 && (context.pm.s.pm_flags & PMF_ON_GROUND) !== 0) {
    context.pm.s.pm_flags |= PMF_DUCKED;
  } else if ((context.pm.s.pm_flags & PMF_DUCKED) !== 0) {
    context.pm.maxs[2] = 32;
    const trace = context.pm.trace(context.pml.origin, context.pm.mins, context.pm.maxs, context.pml.origin);
    if (!trace.allsolid) {
      context.pm.s.pm_flags &= ~PMF_DUCKED;
    }
  }

  if ((context.pm.s.pm_flags & PMF_DUCKED) !== 0) {
    context.pm.maxs[2] = 4;
    context.pm.viewheight = -2;
  } else {
    context.pm.maxs[2] = 32;
    context.pm.viewheight = 22;
  }
}

/**
 * Original name: PM_ClampAngles
 * Source: qcommon/pmove.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Combines command angles with server delta angles, clamps pitch and rebuilds the movement basis vectors.
 */
export function PM_ClampAngles(context: PmoveContext): void {
  if ((context.pm.s.pm_flags & PMF_TIME_TELEPORT) !== 0) {
    context.pm.viewangles[YAW] = SHORT2ANGLE(context.pm.cmd.angles[YAW] + context.pm.s.delta_angles[YAW]);
    context.pm.viewangles[PITCH] = 0;
    context.pm.viewangles[ROLL] = 0;
  } else {
    for (let index = 0; index < 3; index += 1) {
      const temp = context.pm.cmd.angles[index] + context.pm.s.delta_angles[index];
      context.pm.viewangles[index] = SHORT2ANGLE(temp);
    }

    if (context.pm.viewangles[PITCH] > 89 && context.pm.viewangles[PITCH] < 180) {
      context.pm.viewangles[PITCH] = 89;
    } else if (context.pm.viewangles[PITCH] < 271 && context.pm.viewangles[PITCH] >= 180) {
      context.pm.viewangles[PITCH] = 271;
    }
  }

  const vectors = AngleVectors(context.pm.viewangles);
  VectorCopy(vectors.forward, context.pml.forward);
  VectorCopy(vectors.right, context.pml.right);
  VectorCopy(vectors.up, context.pml.up);
}

/**
 * Original name: PM_AirMove
 * Source: qcommon/pmove.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Builds the desired movement vector from forward/side input, applies acceleration and gravity, then resolves motion.
 */
export function PM_AirMove(context: PmoveContext): void {
  const wishvel: vec3_t = [0, 0, 0];
  const wishdir: vec3_t = [0, 0, 0];
  const fmove = context.pm.cmd.forwardmove;
  const smove = context.pm.cmd.sidemove;

  for (let index = 0; index < 2; index += 1) {
    wishvel[index] = context.pml.forward[index] * fmove + context.pml.right[index] * smove;
  }
  wishvel[2] = 0;

  PM_AddCurrents(context, wishvel);

  VectorCopy(wishvel, wishdir);
  let wishspeed = VectorNormalize(wishdir);

  const maxspeed = (context.pm.s.pm_flags & PMF_DUCKED) !== 0 ? context.pm_duckspeed : context.pm_maxspeed;
  if (wishspeed > maxspeed) {
    VectorScale(wishvel, maxspeed / wishspeed, wishvel);
    wishspeed = maxspeed;
  }

  if (context.pml.ladder) {
    PM_Accelerate(context, wishdir, wishspeed, context.pm_accelerate);
    if (wishvel[2] === 0) {
      if (context.pml.velocity[2] > 0) {
        context.pml.velocity[2] -= context.pm.s.gravity * context.pml.frametime;
        if (context.pml.velocity[2] < 0) {
          context.pml.velocity[2] = 0;
        }
      } else {
        context.pml.velocity[2] += context.pm.s.gravity * context.pml.frametime;
        if (context.pml.velocity[2] > 0) {
          context.pml.velocity[2] = 0;
        }
      }
    }

    PM_StepSlideMove(context);
    return;
  }

  if (context.pm.groundentity) {
    context.pml.velocity[2] = 0;
    PM_Accelerate(context, wishdir, wishspeed, context.pm_accelerate);

    if (context.pm.s.gravity > 0) {
      context.pml.velocity[2] = 0;
    } else {
      context.pml.velocity[2] -= context.pm.s.gravity * context.pml.frametime;
    }

    if (context.pml.velocity[0] === 0 && context.pml.velocity[1] === 0) {
      return;
    }

    PM_StepSlideMove(context);
    return;
  }

  if (context.pm_airaccelerate !== 0) {
    PM_AirAccelerate(context, wishdir, wishspeed, context.pm_accelerate);
  } else {
    PM_Accelerate(context, wishdir, wishspeed, 1);
  }

  context.pml.velocity[2] -= context.pm.s.gravity * context.pml.frametime;
  PM_StepSlideMove(context);
}

/**
 * Original name: PM_CatagorizePosition
 * Source: qcommon/pmove.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Detects ground contact plus water type and water level at the current player position.
 *
 * Porting notes:
 * - Requires both `pm.trace` and `pm.pointcontents`, just like the original movement core.
 */
export function PM_CatagorizePosition(context: PmoveContext): void {
  if (!context.pm.trace) {
    throw new Error("PM_CatagorizePosition requires pm.trace");
  }
  if (!context.pm.pointcontents) {
    throw new Error("PM_CatagorizePosition requires pm.pointcontents");
  }

  const point: vec3_t = [context.pml.origin[0], context.pml.origin[1], context.pml.origin[2] - 0.25];

  if (context.pml.velocity[2] > 180) {
    context.pm.s.pm_flags &= ~PMF_ON_GROUND;
    context.pm.groundentity = null;
  } else {
    const trace = context.pm.trace(context.pml.origin, context.pm.mins, context.pm.maxs, point);
    context.pml.groundplane = {
      normal: [trace.plane.normal[0], trace.plane.normal[1], trace.plane.normal[2]],
      dist: trace.plane.dist,
      type: trace.plane.type,
      signbits: trace.plane.signbits,
      pad: [trace.plane.pad[0], trace.plane.pad[1]]
    };
    context.pml.groundsurface = trace.surface;
    context.pml.groundcontents = trace.contents;

    if (!trace.ent || (trace.plane.normal[2] < 0.7 && !trace.startsolid)) {
      context.pm.groundentity = null;
      context.pm.s.pm_flags &= ~PMF_ON_GROUND;
    } else {
      context.pm.groundentity = trace.ent;

      if ((context.pm.s.pm_flags & PMF_TIME_WATERJUMP) !== 0) {
        context.pm.s.pm_flags &= ~(PMF_TIME_WATERJUMP | PMF_TIME_LAND | PMF_TIME_TELEPORT);
        context.pm.s.pm_time = 0;
      }

      if ((context.pm.s.pm_flags & PMF_ON_GROUND) === 0) {
        context.pm.s.pm_flags |= PMF_ON_GROUND;
        if (context.pml.velocity[2] < -200) {
          context.pm.s.pm_flags |= PMF_TIME_LAND;
          context.pm.s.pm_time = context.pml.velocity[2] < -400 ? 25 : 18;
        }
      }
    }

    if (context.pm.numtouch < MAXTOUCH && trace.ent) {
      context.pm.touchents[context.pm.numtouch] = trace.ent;
      context.pm.numtouch += 1;
    }
  }

  context.pm.waterlevel = 0;
  context.pm.watertype = 0;

  const sample2 = context.pm.viewheight - context.pm.mins[2];
  const sample1 = sample2 / 2;

  point[2] = context.pml.origin[2] + context.pm.mins[2] + 1;
  let cont = context.pm.pointcontents(point);
  if ((cont & MASK_WATER) !== 0) {
    context.pm.watertype = cont;
    context.pm.waterlevel = 1;

    point[2] = context.pml.origin[2] + context.pm.mins[2] + sample1;
    cont = context.pm.pointcontents(point);
    if ((cont & MASK_WATER) !== 0) {
      context.pm.waterlevel = 2;

      point[2] = context.pml.origin[2] + context.pm.mins[2] + sample2;
      cont = context.pm.pointcontents(point);
      if ((cont & MASK_WATER) !== 0) {
        context.pm.waterlevel = 3;
      }
    }
  }
}

/**
 * Original name: PM_CheckJump
 * Source: qcommon/pmove.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Applies jump and swim-up behavior while respecting Quake II landing and held-jump timing rules.
 */
export function PM_CheckJump(context: PmoveContext): void {
  if ((context.pm.s.pm_flags & PMF_TIME_LAND) !== 0) {
    return;
  }

  if (context.pm.cmd.upmove < 10) {
    context.pm.s.pm_flags &= ~PMF_JUMP_HELD;
    return;
  }

  if ((context.pm.s.pm_flags & PMF_JUMP_HELD) !== 0) {
    return;
  }

  if (context.pm.s.pm_type === pmtype_t.PM_DEAD) {
    return;
  }

  if (context.pm.waterlevel >= 2) {
    context.pm.groundentity = null;

    if (context.pml.velocity[2] <= -300) {
      return;
    }

    if (context.pm.watertype === CONTENTS_WATER) {
      context.pml.velocity[2] = 100;
    } else if (context.pm.watertype === CONTENTS_SLIME) {
      context.pml.velocity[2] = 80;
    } else {
      context.pml.velocity[2] = 50;
    }
    return;
  }

  if (!context.pm.groundentity) {
    return;
  }

  context.pm.s.pm_flags |= PMF_JUMP_HELD;
  context.pm.groundentity = null;
  context.pml.velocity[2] += 270;
  if (context.pml.velocity[2] < 270) {
    context.pml.velocity[2] = 270;
  }
}

/**
 * Original name: PM_CheckSpecialMovement
 * Source: qcommon/pmove.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Detects ladders and water-jump transitions from the current position and movement basis.
 *
 * Porting notes:
 * - Requires both `pm.trace` and `pm.pointcontents`, matching the original movement core contract.
 */
export function PM_CheckSpecialMovement(context: PmoveContext): void {
  if (!context.pm.trace) {
    throw new Error("PM_CheckSpecialMovement requires pm.trace");
  }
  if (!context.pm.pointcontents) {
    throw new Error("PM_CheckSpecialMovement requires pm.pointcontents");
  }

  if (context.pm.s.pm_time) {
    return;
  }

  context.pml.ladder = false;

  const flatforward: vec3_t = [context.pml.forward[0], context.pml.forward[1], 0];
  VectorNormalize(flatforward);

  const spot: vec3_t = [0, 0, 0];
  VectorMA(context.pml.origin, 1, flatforward, spot);
  const trace = context.pm.trace(context.pml.origin, context.pm.mins, context.pm.maxs, spot);
  if (trace.fraction < 1 && (trace.contents & CONTENTS_LADDER) !== 0) {
    context.pml.ladder = true;
  }

  if (context.pm.waterlevel !== 2) {
    return;
  }

  VectorMA(context.pml.origin, 30, flatforward, spot);
  spot[2] += 4;
  let cont = context.pm.pointcontents(spot);
  if ((cont & CONTENTS_SOLID) === 0) {
    return;
  }

  spot[2] += 16;
  cont = context.pm.pointcontents(spot);
  if (cont !== 0) {
    return;
  }

  VectorScale(flatforward, 50, context.pml.velocity);
  context.pml.velocity[2] = 350;

  context.pm.s.pm_flags |= PMF_TIME_WATERJUMP;
  context.pm.s.pm_time = 255;
}

/**
 * Original name: PM_WaterMove
 * Source: qcommon/pmove.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Builds underwater movement intent, applies water acceleration and resolves motion by step-slide.
 */
export function PM_WaterMove(context: PmoveContext): void {
  const wishvel: vec3_t = [0, 0, 0];
  const wishdir: vec3_t = [0, 0, 0];

  for (let index = 0; index < 3; index += 1) {
    wishvel[index] =
      context.pml.forward[index] * context.pm.cmd.forwardmove +
      context.pml.right[index] * context.pm.cmd.sidemove;
  }

  if (!context.pm.cmd.forwardmove && !context.pm.cmd.sidemove && !context.pm.cmd.upmove) {
    wishvel[2] -= 60;
  } else {
    wishvel[2] += context.pm.cmd.upmove;
  }

  PM_AddCurrents(context, wishvel);

  VectorCopy(wishvel, wishdir);
  let wishspeed = VectorNormalize(wishdir);

  if (wishspeed > context.pm_maxspeed) {
    VectorScale(wishvel, context.pm_maxspeed / wishspeed, wishvel);
    wishspeed = context.pm_maxspeed;
  }
  wishspeed *= 0.5;

  PM_Accelerate(context, wishdir, wishspeed, context.pm_wateraccelerate);
  PM_StepSlideMove(context);
}

/**
 * Original name: PM_FlyMove
 * Source: qcommon/pmove.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Applies spectator-style friction and acceleration, then either clips or freely integrates the move.
 */
export function PM_FlyMove(context: PmoveContext, doclip: qboolean): void {
  if (!context.pm.trace && doclip) {
    throw new Error("PM_FlyMove requires pm.trace when doclip is enabled");
  }

  context.pm.viewheight = 22;

  const speed = VectorLength(context.pml.velocity);
  if (speed < 1) {
    VectorCopy(vec3_origin, context.pml.velocity);
  } else {
    let drop = 0;
    const friction = context.pm_friction * 1.5;
    const control = speed < context.pm_stopspeed ? context.pm_stopspeed : speed;
    drop += control * friction * context.pml.frametime;

    let newspeed = speed - drop;
    if (newspeed < 0) {
      newspeed = 0;
    }
    newspeed /= speed;

    VectorScale(context.pml.velocity, newspeed, context.pml.velocity);
  }

  const fmove = context.pm.cmd.forwardmove;
  const smove = context.pm.cmd.sidemove;

  VectorNormalize(context.pml.forward);
  VectorNormalize(context.pml.right);

  const wishvel: vec3_t = [0, 0, 0];
  for (let index = 0; index < 3; index += 1) {
    wishvel[index] = context.pml.forward[index] * fmove + context.pml.right[index] * smove;
  }
  wishvel[2] += context.pm.cmd.upmove;

  const wishdir: vec3_t = [0, 0, 0];
  VectorCopy(wishvel, wishdir);
  let wishspeed = VectorNormalize(wishdir);

  if (wishspeed > context.pm_maxspeed) {
    VectorScale(wishvel, context.pm_maxspeed / wishspeed, wishvel);
    wishspeed = context.pm_maxspeed;
  }

  const currentspeed = DotProduct(context.pml.velocity, wishdir);
  const addspeed = wishspeed - currentspeed;
  if (addspeed <= 0) {
    return;
  }

  let accelspeed = context.pm_accelerate * context.pml.frametime * wishspeed;
  if (accelspeed > addspeed) {
    accelspeed = addspeed;
  }

  for (let index = 0; index < 3; index += 1) {
    context.pml.velocity[index] += accelspeed * wishdir[index];
  }

  if (doclip) {
    const end: vec3_t = [0, 0, 0];
    for (let index = 0; index < 3; index += 1) {
      end[index] = context.pml.origin[index] + context.pml.frametime * context.pml.velocity[index];
    }

    const trace = context.pm.trace!(context.pml.origin, context.pm.mins, context.pm.maxs, end);
    VectorCopy(trace.endpos, context.pml.origin);
    return;
  }

  VectorMA(context.pml.origin, context.pml.frametime, context.pml.velocity, context.pml.origin);
}

/**
 * Original name: PM_DeadMove
 * Source: qcommon/pmove.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Applies extra friction to a dead player sliding on the ground.
 */
export function PM_DeadMove(context: PmoveContext): void {
  if (!context.pm.groundentity) {
    return;
  }

  let forward = VectorLength(context.pml.velocity);
  forward -= 20;
  if (forward <= 0) {
    VectorClear(context.pml.velocity);
    return;
  }

  VectorNormalize(context.pml.velocity);
  VectorScale(context.pml.velocity, forward, context.pml.velocity);
}

/**
 * Original name: PM_GoodPosition
 * Source: qcommon/pmove.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Checks whether the current packed origin resolves to a non-solid position for the current movement bounds.
 */
export function PM_GoodPosition(context: PmoveContext): qboolean {
  if (!context.pm.trace) {
    throw new Error("PM_GoodPosition requires pm.trace");
  }

  if (context.pm.s.pm_type === pmtype_t.PM_SPECTATOR) {
    return true;
  }

  const origin: vec3_t = [0, 0, 0];
  const end: vec3_t = [0, 0, 0];
  for (let index = 0; index < 3; index += 1) {
    origin[index] = context.pm.s.origin[index] * 0.125;
    end[index] = origin[index];
  }

  const trace = context.pm.trace(origin, context.pm.mins, context.pm.maxs, end);
  return !trace.allsolid;
}

const PM_SNAP_JITTER_BITS = [0, 4, 1, 2, 3, 5, 6, 7] as const;
const PM_INITIAL_SNAP_OFFSET = [0, -1, 1] as const;

/**
 * Original name: PM_SnapPosition
 * Source: qcommon/pmove.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Quantizes velocity/origin to network eighths and jitters the packed origin until a valid position is found.
 */
export function PM_SnapPosition(context: PmoveContext): void {
  const sign: [number, number, number] = [0, 0, 0];
  const base: [number, number, number] = [0, 0, 0];

  for (let index = 0; index < 3; index += 1) {
    context.pm.s.velocity[index] = Math.trunc(context.pml.velocity[index] * 8);
  }

  for (let index = 0; index < 3; index += 1) {
    sign[index] = context.pml.origin[index] >= 0 ? 1 : -1;
    context.pm.s.origin[index] = Math.trunc(context.pml.origin[index] * 8);
    if (context.pm.s.origin[index] * 0.125 === context.pml.origin[index]) {
      sign[index] = 0;
    }
  }

  VectorCopy(context.pm.s.origin, base);

  for (let jitterIndex = 0; jitterIndex < PM_SNAP_JITTER_BITS.length; jitterIndex += 1) {
    const bits = PM_SNAP_JITTER_BITS[jitterIndex];
    VectorCopy(base, context.pm.s.origin);

    for (let axis = 0; axis < 3; axis += 1) {
      if ((bits & (1 << axis)) !== 0) {
        context.pm.s.origin[axis] += sign[axis];
      }
    }

    if (PM_GoodPosition(context)) {
      return;
    }
  }

  VectorCopy(context.pml.previous_origin, context.pm.s.origin);
}

/**
 * Original name: PM_InitialSnapPosition
 * Source: qcommon/pmove.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Searches the nearby packed-origin neighborhood for a valid initial position after teleports or level start.
 */
export function PM_InitialSnapPosition(context: PmoveContext): void {
  const base: [number, number, number] = [0, 0, 0];
  VectorCopy(context.pm.s.origin, base);

  for (let z = 0; z < PM_INITIAL_SNAP_OFFSET.length; z += 1) {
    context.pm.s.origin[2] = base[2] + PM_INITIAL_SNAP_OFFSET[z];
    for (let y = 0; y < PM_INITIAL_SNAP_OFFSET.length; y += 1) {
      context.pm.s.origin[1] = base[1] + PM_INITIAL_SNAP_OFFSET[y];
      for (let x = 0; x < PM_INITIAL_SNAP_OFFSET.length; x += 1) {
        context.pm.s.origin[0] = base[0] + PM_INITIAL_SNAP_OFFSET[x];
        if (PM_GoodPosition(context)) {
          context.pml.origin[0] = context.pm.s.origin[0] * 0.125;
          context.pml.origin[1] = context.pm.s.origin[1] * 0.125;
          context.pml.origin[2] = context.pm.s.origin[2] * 0.125;
          VectorCopy(context.pm.s.origin, context.pml.previous_origin);
          return;
        }
      }
    }
  }
}

/**
 * Original name: timer drop block inside `Pmove`
 * Source: qcommon/pmove.c
 * Category: Adapter
 * Fidelity level: Strict
 *
 * Behavior:
 * - Decrements the packed pmove timing counter in the same eighth-msec quanta as the original.
 */
export function PM_DropTimers(context: PmoveContext): void {
  if (!context.pm.s.pm_time) {
    return;
  }

  let msec = context.pm.cmd.msec >> 3;
  if (!msec) {
    msec = 1;
  }

  if (msec >= context.pm.s.pm_time) {
    context.pm.s.pm_flags &= ~(PMF_TIME_WATERJUMP | PMF_TIME_LAND | PMF_TIME_TELEPORT);
    context.pm.s.pm_time = 0;
    return;
  }

  context.pm.s.pm_time -= msec;
}

/**
 * Original name: Pmove
 * Source: qcommon/pmove.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Executes the shared Quake II player-move routine used by both prediction and authoritative simulation.
 *
 * Porting notes:
 * - Default behavior follows the original source path; optional gates exist only for staged integration and verification harnesses.
 */
export function Pmove(context: PmoveContext, options: PmoveOptions = {}): void {
  PM_ClearResults(context);
  context.pml = createPmlState();
  PM_InitLocalState(context, context.pm.cmd.msec * 0.001);
  PM_ClampAngles(context);

  if (context.pm.s.pm_type === pmtype_t.PM_SPECTATOR) {
    if (options.allowSpectatorMove === false) {
      PM_SyncToState(context);
      return;
    }

    PM_FlyMove(context, options.spectatorDoClip ?? false);
    if (options.allowSnapPosition === false) {
      PM_SyncToState(context);
    } else {
      PM_SnapPosition(context);
    }
    return;
  }

  if (context.pm.s.pm_type >= pmtype_t.PM_DEAD) {
    context.pm.cmd.forwardmove = 0;
    context.pm.cmd.sidemove = 0;
    context.pm.cmd.upmove = 0;
  }

  if (context.pm.s.pm_type === pmtype_t.PM_FREEZE) {
    PM_SyncToState(context);
    return;
  }

  PM_CheckDuck(context);

  if (context.pm.snapinitial && options.allowInitialSnapPosition !== false) {
    PM_InitialSnapPosition(context);
  }

  PM_CatagorizePosition(context);

  if (context.pm.s.pm_type === pmtype_t.PM_DEAD) {
    PM_DeadMove(context);
  }

  if (options.allowSpecialMovement !== false) {
    PM_CheckSpecialMovement(context);
  }
  PM_DropTimers(context);

  if ((context.pm.s.pm_flags & PMF_TIME_TELEPORT) !== 0) {
    // Teleport pause stays exactly in place, but the original still
    // runs the final categorization and snap logic below.
  } else if ((context.pm.s.pm_flags & PMF_TIME_WATERJUMP) !== 0) {
    context.pml.velocity[2] -= context.pm.s.gravity * context.pml.frametime;
    if (context.pml.velocity[2] < 0) {
      context.pm.s.pm_flags &= ~(PMF_TIME_WATERJUMP | PMF_TIME_LAND | PMF_TIME_TELEPORT);
      context.pm.s.pm_time = 0;
    }

    PM_StepSlideMove(context);
  } else {
    PM_CheckJump(context);
    PM_Friction(context);

    if (context.pm.waterlevel >= 2 && options.allowWaterMove !== false) {
      PM_WaterMove(context);
    } else {
      const angles: vec3_t = [context.pm.viewangles[0], context.pm.viewangles[1], context.pm.viewangles[2]];
      if (angles[PITCH] > 180) {
        angles[PITCH] -= 360;
      }
      angles[PITCH] /= 3;

      const vectors = AngleVectors(angles);
      VectorCopy(vectors.forward, context.pml.forward);
      VectorCopy(vectors.right, context.pml.right);
      VectorCopy(vectors.up, context.pml.up);

      PM_AirMove(context);
    }
  }

  PM_CatagorizePosition(context);
  if (options.allowSnapPosition === false) {
    PM_SyncToState(context);
  } else {
    PM_SnapPosition(context);
  }
}
