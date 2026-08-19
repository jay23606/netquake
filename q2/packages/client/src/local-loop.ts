/**
 * File: local-loop.ts
 * Purpose: Hold the standalone local-client prediction and view helpers that should not live inside a browser adapter.
 *
 * This file is not a direct source port.
 * It is a runtime-side helper layer for the current standalone client loop.
 *
 * Dependencies:
 * - packages/client/src/cl_view.ts
 * - packages/qcommon
 */

import {
  PMF_DUCKED,
  Pmove,
  createPmoveContext,
  pmtype_t,
  type pmove_t,
  type trace_t,
  type vec3_t
} from "../../qcommon/src/index.js";
import {
  CL_CalcViewValues,
  CL_UpdateLerpFraction,
  type ClientViewValues
} from "./cl_view.js";
import { createFrame, type ClientRuntime } from "./client.js";

/**
 * Original name: N/A
 * Source: N/A (standalone local-client helper)
 * Category: New
 * Purpose: Describe the collision callbacks needed by the standalone local prediction bootstrap.
 *
 * Constraints:
 * - Must stay aligned with the shared qcommon `pmove` contracts.
 */
export interface LocalClientCollisionAdapter {
  trace: (start: vec3_t, mins: vec3_t, maxs: vec3_t, end: vec3_t) => trace_t;
  pointcontents: (point: vec3_t) => number;
}

/**
 * Original name: N/A
 * Source: N/A (standalone local-client helper)
 * Category: New
 * Purpose: Apply the standalone movement mode to both the authoritative frame and predicted pmove state.
 *
 * Constraints:
 * - Must switch cleanly between `PM_NORMAL` and `PM_SPECTATOR`.
 */
export function applyLocalMovementMode(runtime: ClientRuntime, ghostMode: boolean): void {
  const pmType = ghostMode ? pmtype_t.PM_SPECTATOR : pmtype_t.PM_NORMAL;
  runtime.cl.frame.playerstate.pmove.pm_type = pmType;
  runtime.cl.predicted_pmove.pm_type = pmType;
}

/**
 * Original name: N/A
 * Source: N/A (standalone local-client helper)
 * Category: New
 * Purpose: Snap the initial local player state onto a valid BSP position before the interactive loop starts.
 *
 * Constraints:
 * - Must use the same `pmove` collision callbacks as runtime prediction.
 */
export function initializeLocalSpawnPrediction(
  runtime: ClientRuntime,
  collision: LocalClientCollisionAdapter,
  spawnOrigin: vec3_t
): void {
  const pm: pmove_t = {
    s: {
      ...runtime.cl.frame.playerstate.pmove,
      origin: [
        Math.trunc(spawnOrigin[0] * 8),
        Math.trunc(spawnOrigin[1] * 8),
        Math.trunc(spawnOrigin[2] * 8)
      ],
      velocity: [0, 0, 0],
      delta_angles: [...runtime.cl.frame.playerstate.pmove.delta_angles]
    },
    cmd: {
      msec: 16,
      buttons: 0,
      angles: [0, 0, 0],
      forwardmove: 0,
      sidemove: 0,
      upmove: 0,
      impulse: 0,
      lightlevel: 0
    },
    snapinitial: true,
    numtouch: 0,
    touchents: [],
    viewangles: [0, 0, 0],
    viewheight: 0,
    mins: [0, 0, 0],
    maxs: [0, 0, 0],
    groundentity: null,
    watertype: 0,
    waterlevel: 0,
    trace: collision.trace,
    pointcontents: collision.pointcontents
  };

  const context = createPmoveContext(pm);
  Pmove(context);

  runtime.cl.frame.playerstate.pmove = {
    pm_type: context.pm.s.pm_type,
    origin: [...context.pm.s.origin],
    velocity: [...context.pm.s.velocity],
    pm_flags: context.pm.s.pm_flags,
    pm_time: context.pm.s.pm_time,
    gravity: context.pm.s.gravity,
    delta_angles: [...context.pm.s.delta_angles]
  };
  runtime.cl.frame.playerstate.viewoffset = [0, 0, context.pm.viewheight];
  runtime.cl.predicted_pmove = {
    ...runtime.cl.frame.playerstate.pmove,
    origin: [...runtime.cl.frame.playerstate.pmove.origin],
    velocity: [...runtime.cl.frame.playerstate.pmove.velocity],
    delta_angles: [...runtime.cl.frame.playerstate.pmove.delta_angles]
  };
  runtime.cl.predicted_viewheight = context.pm.viewheight;
  runtime.cl.predicted_origin = [
    runtime.cl.frame.playerstate.pmove.origin[0] * 0.125,
    runtime.cl.frame.playerstate.pmove.origin[1] * 0.125,
    runtime.cl.frame.playerstate.pmove.origin[2] * 0.125
  ];
}

/**
 * Original name: N/A
 * Source: N/A (standalone local-client helper)
 * Category: New
 * Purpose: Copy the newest predicted state back into the local frame so a standalone client loop can chain prediction frame-to-frame.
 *
 * Constraints:
 * - Must keep the frame authoritative enough for the next local prediction step.
 */
export function promoteLocalPredictedState(runtime: ClientRuntime, realtimeMs: number): void {
  runtime.cl.frame.valid = true;
  runtime.cl.frame.serverframe += 1;
  runtime.cl.frame.servertime = realtimeMs;
  runtime.cl.frame.playerstate.pmove = {
    pm_type: runtime.cl.predicted_pmove.pm_type,
    origin: [...runtime.cl.predicted_pmove.origin],
    velocity: [...runtime.cl.predicted_pmove.velocity],
    pm_flags: runtime.cl.predicted_pmove.pm_flags,
    pm_time: runtime.cl.predicted_pmove.pm_time,
    gravity: runtime.cl.predicted_pmove.gravity,
    delta_angles: [...runtime.cl.predicted_pmove.delta_angles]
  };
  runtime.cl.frame.playerstate.viewangles = [...runtime.cl.predicted_angles];
  runtime.cl.frame.playerstate.viewoffset = [0, 0, getPredictedViewheight(runtime)];
  storeLocalClientFrame(runtime);
}

/**
 * Original name: N/A
 * Source: N/A (standalone local-client helper)
 * Category: New
 * Purpose: Build the current interpolated predicted view state that a renderer adapter can apply to its own camera abstraction.
 *
 * Constraints:
 * - Must reuse the already ported `CL_UpdateLerpFraction` and `CL_CalcViewValues` logic.
 */
export function buildLocalPredictedViewState(runtime: ClientRuntime): ClientViewValues {
  CL_UpdateLerpFraction(runtime, { timedemo: false });
  return CL_CalcViewValues(runtime, { predictMovement: true });
}

/**
 * Original name: N/A
 * Source: N/A (standalone local-client helper)
 * Category: New
 * Purpose: Clone one command before storing it in the circular client command buffer.
 *
 * Constraints:
 * - Must preserve value semantics for angle tuples.
 */
export function cloneLocalUsercmd(cmd: ClientRuntime["cl"]["cmd"]): ClientRuntime["cl"]["cmd"] {
  return {
    msec: cmd.msec,
    buttons: cmd.buttons,
    angles: [...cmd.angles],
    forwardmove: cmd.forwardmove,
    sidemove: cmd.sidemove,
    upmove: cmd.upmove,
    impulse: cmd.impulse,
    lightlevel: cmd.lightlevel
  };
}

/**
 * Original name: N/A
 * Source: N/A (standalone local-client helper)
 * Category: New
 * Purpose: Derive the predicted eye height from the current packed pmove state.
 *
 * Constraints:
 * - Must preserve the standing and ducked viewheight values already used by the standalone loop.
 */
export function getPredictedViewheight(runtime: ClientRuntime): number {
  return runtime.cl.predicted_viewheight;
}

/**
 * Original name: N/A
 * Source: N/A (standalone local-client helper)
 * Category: New
 * Purpose: Store the current local client frame into the Quake II frame history ring so interpolation can reuse a real previous frame.
 *
 * Constraints:
 * - Must preserve the `frame_t` value semantics expected by the client refresh code.
 */
function storeLocalClientFrame(runtime: ClientRuntime): void {
  const frameIndex = runtime.cl.frame.serverframe & (runtime.cl.frames.length - 1);
  const stored = createFrame();

  stored.valid = runtime.cl.frame.valid;
  stored.serverframe = runtime.cl.frame.serverframe;
  stored.servertime = runtime.cl.frame.servertime;
  stored.deltaframe = runtime.cl.frame.deltaframe;
  stored.areabits = new Uint8Array(runtime.cl.frame.areabits);
  stored.playerstate = {
    ...runtime.cl.frame.playerstate,
    pmove: {
      ...runtime.cl.frame.playerstate.pmove,
      origin: [...runtime.cl.frame.playerstate.pmove.origin],
      velocity: [...runtime.cl.frame.playerstate.pmove.velocity],
      delta_angles: [...runtime.cl.frame.playerstate.pmove.delta_angles]
    },
    viewangles: [...runtime.cl.frame.playerstate.viewangles],
    viewoffset: [...runtime.cl.frame.playerstate.viewoffset],
    kick_angles: [...runtime.cl.frame.playerstate.kick_angles],
    gunangles: [...runtime.cl.frame.playerstate.gunangles],
    gunoffset: [...runtime.cl.frame.playerstate.gunoffset],
    blend: [...runtime.cl.frame.playerstate.blend],
    stats: [...runtime.cl.frame.playerstate.stats]
  };
  stored.num_entities = runtime.cl.frame.num_entities;
  stored.parse_entities = runtime.cl.frame.parse_entities;

  runtime.cl.frames[frameIndex] = stored;
}
