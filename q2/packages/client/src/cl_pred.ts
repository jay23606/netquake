/**
 * File: cl_pred.ts
 * Source: Quake II original / client/cl_pred.c
 * Purpose: Port the client-side prediction movement and collision helpers.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Accepts explicit prediction/runtime callbacks instead of reading host globals.
 * - Returns updated values through the explicit client runtime object.
 *
 * Notes:
 * - This file is the principal TypeScript attachment point for `client/cl_pred.c`.
 */

import {
  CM_BoxTrace,
  CM_HeadnodeForBox,
  CM_PointContents,
  CM_TransformedBoxTrace,
  CM_TransformedPointContents,
  CS_AIRACCEL,
  MASK_PLAYERSOLID,
  PMF_NO_PREDICTION,
  PMF_ON_GROUND,
  Pmove,
  SHORT2ANGLE,
  createPmoveContext,
  vec3_origin,
  type CollisionWorld,
  type cmodel_t,
  type cplane_t,
  type csurface_t,
  type entity_state_t,
  type PmoveContext,
  type pmove_t,
  type pmove_state_t,
  type trace_t,
  type usercmd_t,
  type vec3_t
} from "../../qcommon/src/index.js";
import { CMD_BACKUP, type ClientRuntime, connstate_t } from "./client.js";

/**
 * Original name: N/A
 * Source: N/A (prediction options contract)
 * Category: New
 * Purpose: Describe the runtime knobs needed by the `client/cl_pred.c` movement helpers.
 *
 * Constraints:
 * - Defaults should mirror the common Quake II enabled path.
 */
export interface ClientPredictionOptions {
  predictMovement?: boolean;
  paused?: boolean;
  showmiss?: boolean;
  onPredictionMessage?: (message: string) => void;
  incomingAcknowledged?: number;
  outgoingSequence?: number;
  predictionCollision?: ClientPredictionCollisionSource;
  trace?: (start: vec3_t, mins: vec3_t, maxs: vec3_t, end: vec3_t) => trace_t;
  pointcontents?: (point: vec3_t) => number;
}

/**
 * Original name: N/A
 * Source: N/A (prediction collision contract)
 * Category: New
 * Purpose: Gather the collision inputs that `cl_pred.c` uses to build `CL_PMTrace` and `CL_PMpointcontents`.
 *
 * Constraints:
 * - Must preserve the same packet entity ordering as the parsed frame.
 */
export interface ClientPredictionCollisionSource {
  world: CollisionWorld;
  entities: entity_state_t[];
  modelClip: Array<cmodel_t | null>;
  playernum: number;
}

/**
 * Original name: CL_CheckPredictionError
 * Source: client/cl_pred.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Compares the predicted origin with the last server-acknowledged player origin and stores a smoothed error term.
 *
 * Porting notes:
 * - Reads the acknowledged frame index from options instead of `cls.netchan`.
 */
export function CL_CheckPredictionError(runtime: ClientRuntime, options: ClientPredictionOptions = {}): void {
  if (!options.predictMovement || (runtime.cl.frame.playerstate.pmove.pm_flags & PMF_NO_PREDICTION) !== 0) {
    return;
  }

  const frame = (options.incomingAcknowledged ?? 0) & (runtime.cl.predicted_origins.length - 1);
  const predicted = runtime.cl.predicted_origins[frame];
  const actual = runtime.cl.frame.playerstate.pmove.origin;
  const delta: vec3_t = [
    actual[0] - predicted[0],
    actual[1] - predicted[1],
    actual[2] - predicted[2]
  ];

  const len = Math.abs(delta[0]) + Math.abs(delta[1]) + Math.abs(delta[2]);
  if (len > 640) {
    runtime.cl.prediction_error = [0, 0, 0];
    return;
  }

  if (options.showmiss && (delta[0] !== 0 || delta[1] !== 0 || delta[2] !== 0)) {
    options.onPredictionMessage?.(`prediction miss on ${runtime.cl.frame.serverframe}: ${delta[0] + delta[1] + delta[2]}`);
  }

  runtime.cl.predicted_origins[frame] = [...actual];
  runtime.cl.prediction_error = [
    delta[0] * 0.125,
    delta[1] * 0.125,
    delta[2] * 0.125
  ];
}

/**
 * Original name: CL_PredictMovement
 * Source: client/cl_pred.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Runs the acknowledged-to-current client prediction loop and updates predicted origin, angles and step smoothing state.
 *
 * Porting notes:
 * - Accepts explicit callbacks/options in place of the original globals while preserving the source branch order.
 */
export function CL_PredictMovement(runtime: ClientRuntime, options: ClientPredictionOptions = {}): void {
  if (runtime.cls.state !== connstate_t.ca_active) {
    return;
  }

  if (options.paused) {
    return;
  }

  if (!options.predictMovement || (runtime.cl.frame.playerstate.pmove.pm_flags & PMF_NO_PREDICTION) !== 0) {
    for (let index = 0; index < 3; index += 1) {
      runtime.cl.predicted_angles[index] =
        runtime.cl.viewangles[index] + SHORT2ANGLE(runtime.cl.frame.playerstate.pmove.delta_angles[index]);
    }
    runtime.cl.predicted_viewheight = runtime.cl.frame.playerstate.viewoffset[2];
    return;
  }

  const ack = options.incomingAcknowledged ?? 0;
  const current = options.outgoingSequence ?? ack;

  if (current - ack >= CMD_BACKUP) {
    if (options.showmiss) {
      options.onPredictionMessage?.("exceeded CMD_BACKUP");
    }
    return;
  }

  const context = createPredictedPmove(runtime, options);
  let runningAck = ack;
  let frame = 0;

  while (++runningAck < current) {
    frame = runningAck & (CMD_BACKUP - 1);
    context.pm.cmd = cloneUsercmd(runtime.cl.cmds[frame]);
    Pmove(context);
    runtime.cl.predicted_origins[frame] = [...context.pm.s.origin];
  }

  const oldframe = (runningAck - 2) & (CMD_BACKUP - 1);
  const oldz = runtime.cl.predicted_origins[oldframe][2];
  const step = context.pm.s.origin[2] - oldz;
  if (step > 63 && step < 160 && (context.pm.s.pm_flags & PMF_ON_GROUND) !== 0) {
    runtime.cl.predicted_step = step * 0.125;
    runtime.cl.predicted_step_time = runtime.cls.realtime - runtime.cls.frametime * 500;
  }

  runtime.cl.predicted_origin[0] = context.pm.s.origin[0] * 0.125;
  runtime.cl.predicted_origin[1] = context.pm.s.origin[1] * 0.125;
  runtime.cl.predicted_origin[2] = context.pm.s.origin[2] * 0.125;
  runtime.cl.predicted_pmove = clonePmoveState(context.pm.s);
  runtime.cl.predicted_viewheight = context.pm.viewheight;
  runtime.cl.predicted_angles = [...context.pm.viewangles];
}

/**
 * Original name: CL_ClipMoveToEntities
 * Source: client/cl_pred.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Clips one predicted move against packet entities that contribute solid bmodels or encoded bbox solids.
 */
export function CL_ClipMoveToEntities(
  start: vec3_t,
  mins: vec3_t,
  maxs: vec3_t,
  end: vec3_t,
  tr: trace_t,
  source: ClientPredictionCollisionSource
): trace_t {
  let bestTrace = tr;
  const bboxMins: vec3_t = [0, 0, 0];
  const bboxMaxs: vec3_t = [0, 0, 0];

  for (const ent of source.entities) {
    if (!ent.solid) {
      continue;
    }

    if (ent.number === source.playernum + 1) {
      continue;
    }

    let headnode = 0;
    let angles: vec3_t = vec3_origin;

    if (ent.solid === 31) {
      const cmodel = source.modelClip[ent.modelindex];
      if (!cmodel) {
        continue;
      }

      headnode = cmodel.headnode;
      angles = ent.angles;
    } else {
      const x = 8 * (ent.solid & 31);
      const zd = 8 * ((ent.solid >> 5) & 31);
      const zu = 8 * ((ent.solid >> 10) & 63) - 32;

      bboxMins[0] = -x;
      bboxMins[1] = -x;
      bboxMins[2] = -zd;
      bboxMaxs[0] = x;
      bboxMaxs[1] = x;
      bboxMaxs[2] = zu;

      headnode = CM_HeadnodeForBox(source.world, bboxMins, bboxMaxs);
      angles = vec3_origin;
    }

    if (bestTrace.allsolid) {
      return bestTrace;
    }

    const trace = CM_TransformedBoxTrace(
      source.world,
      start,
      end,
      mins,
      maxs,
      headnode,
      MASK_PLAYERSOLID,
      ent.origin,
      angles
    );

    if (trace.allsolid || trace.startsolid || trace.fraction < bestTrace.fraction) {
      trace.ent = ent;
      if (bestTrace.startsolid) {
        bestTrace = trace;
        bestTrace.startsolid = true;
      } else {
        bestTrace = trace;
      }
    } else if (trace.startsolid) {
      bestTrace.startsolid = true;
    }
  }

  return bestTrace;
}

/**
 * Original name: CL_PMTrace
 * Source: client/cl_pred.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Traces prediction movement against the world first, then packet-entity solids.
 */
export function CL_PMTrace(
  start: vec3_t,
  mins: vec3_t,
  maxs: vec3_t,
  end: vec3_t,
  source: ClientPredictionCollisionSource
): trace_t {
  const trace = CM_BoxTrace(source.world, start, end, mins, maxs, 0, MASK_PLAYERSOLID);
  if (trace.fraction < 1.0) {
    trace.ent = source.world;
  }

  return CL_ClipMoveToEntities(start, mins, maxs, end, trace, source);
}

/**
 * Original name: CL_PMpointcontents
 * Source: client/cl_pred.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Combines world contents with transformed packet-entity bmodel contents for prediction queries.
 */
export function CL_PMpointcontents(point: vec3_t, source: ClientPredictionCollisionSource): number {
  let contents = CM_PointContents(source.world, point, 0);

  for (const ent of source.entities) {
    if (ent.solid !== 31) {
      continue;
    }

    const cmodel = source.modelClip[ent.modelindex];
    if (!cmodel) {
      continue;
    }

    contents |= CM_TransformedPointContents(source.world, point, cmodel.headnode, ent.origin, ent.angles);
  }

  return contents;
}

/**
 * Original name: N/A
 * Source: N/A (prediction collision factory)
 * Category: New
 * Purpose: Build the current `cl_pred.c` collision inputs from the parsed client frame and loaded clip models.
 *
 * Constraints:
 * - Must preserve packet-entity ring ordering and the player-number exclusion used by prediction.
 */
export function createClientPredictionCollisionSource(runtime: ClientRuntime, world: CollisionWorld): ClientPredictionCollisionSource {
  return {
    world,
    entities: collectPredictionEntities(runtime),
    modelClip: runtime.cl.model_clip as Array<cmodel_t | null>,
    playernum: runtime.cl.playernum
  };
}

/**
 * Original name: N/A
 * Source: N/A (predicted pmove factory)
 * Category: New
 * Purpose: Build the temporary `pmove_t` bundle used by the first client-side `Pmove` prediction integration.
 *
 * Constraints:
 * - Must clone mutable state away from the parsed authoritative frame before local prediction mutates it.
 */
function createPredictedPmove(runtime: ClientRuntime, options: ClientPredictionOptions): PmoveContext {
  const defaultTrace =
    options.trace ??
    (options.predictionCollision
      ? ((start, mins, maxs, end) => CL_PMTrace(start, mins, maxs, end, options.predictionCollision!))
      : ((start, _mins, _maxs, end) => createPassThroughTrace(end)));
  const defaultPointcontents =
    options.pointcontents ??
    (options.predictionCollision
      ? ((point) => CL_PMpointcontents(point, options.predictionCollision!))
      : (() => 0));
  const airaccelerateText = runtime.cl.configstrings[CS_AIRACCEL];
  const airaccelerate = airaccelerateText.length > 0 ? Number.parseFloat(airaccelerateText) : 0;

  const pm: pmove_t = {
    s: clonePmoveState(runtime.cl.frame.playerstate.pmove),
    cmd: cloneUsercmd(runtime.cl.cmd),
    snapinitial: false,
    numtouch: 0,
    touchents: [],
    viewangles: [0, 0, 0],
    viewheight: 0,
    mins: [0, 0, 0],
    maxs: [0, 0, 0],
    groundentity: null,
    watertype: 0,
    waterlevel: 0,
    trace: defaultTrace,
    pointcontents: defaultPointcontents
  };

  const context = createPmoveContext(pm);
  context.pm_airaccelerate = Number.isFinite(airaccelerate) ? airaccelerate : 0;
  return context;
}

/**
 * Original name: N/A
 * Source: N/A (pmove clone helper)
 * Category: New
 * Purpose: Clone one packed `pmove_state_t` before local prediction mutates it.
 */
function clonePmoveState(state: pmove_state_t): pmove_state_t {
  return {
    pm_type: state.pm_type,
    origin: [...state.origin],
    velocity: [...state.velocity],
    pm_flags: state.pm_flags,
    pm_time: state.pm_time,
    gravity: state.gravity,
    delta_angles: [...state.delta_angles]
  };
}

/**
 * Original name: N/A
 * Source: N/A (usercmd clone helper)
 * Category: New
 * Purpose: Clone one `usercmd_t` so client prediction can mutate command state without touching the runtime source buffer.
 */
function cloneUsercmd(cmd: usercmd_t): usercmd_t {
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
 * Source: N/A (fallback trace helper)
 * Category: New
 * Purpose: Create a default trace result for prediction modes that do not yet provide collision callbacks.
 */
function createPassThroughTrace(end: vec3_t): trace_t {
  return {
    allsolid: false,
    startsolid: false,
    fraction: 1,
    endpos: [...end],
    plane: createDefaultPlane(),
    surface: createDefaultSurface(),
    contents: 0,
    ent: null
  };
}

/**
 * Original name: N/A
 * Source: N/A (fallback trace helper)
 * Category: New
 * Purpose: Create a neutral plane used by fallback trace results.
 */
function createDefaultPlane(): cplane_t {
  return {
    normal: [0, 0, 1],
    dist: 0,
    type: 0,
    signbits: 0,
    pad: [0, 0]
  };
}

/**
 * Original name: N/A
 * Source: N/A (fallback trace helper)
 * Category: New
 * Purpose: Create a neutral surface used by fallback trace results.
 */
function createDefaultSurface(): csurface_t {
  return {
    name: "",
    flags: 0,
    value: 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (prediction entity collector)
 * Category: New
 * Purpose: Materialize the current frame packet entities in source order for prediction collision helpers.
 */
function collectPredictionEntities(runtime: ClientRuntime): entity_state_t[] {
  const entities: entity_state_t[] = [];
  const parseMask = runtime.cl_parse_entities.length - 1;

  for (let index = 0; index < runtime.cl.frame.num_entities; index += 1) {
    const parseIndex = (runtime.cl.frame.parse_entities + index) & parseMask;
    entities.push(runtime.cl_parse_entities[parseIndex]);
  }

  return entities;
}

