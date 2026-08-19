/**
 * File: cl_ents.ts
 * Source: Quake II original / client/cl_ents.c
 * Purpose: Port the first entity-frame event and interpolation helpers that sit between parsed server frames and renderer adapters.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Produces structured snapshots instead of pushing directly into the software/OpenGL refresh list.
 * - Leaves particles, lights and renderer resource resolution to later adapter layers.
 *
 * Notes:
 * - This file is intended to stay conceptually close to the original C source.
 */

import {
  anglemod,
  EF_ANIM01,
  EF_ANIM23,
  EF_ANIM_ALL,
  EF_ANIM_ALLFAST,
  EF_BFG,
  EF_COLOR_SHELL,
  EF_DOUBLE,
  EF_HALF_DAMAGE,
  EF_PENT,
  EF_PLASMA,
  EF_QUAD,
  EF_ROTATE,
  EF_SPHERETRANS,
  EF_SPINNINGLIGHTS,
  EF_TELEPORTER,
  EF_TRACKERTRAIL,
  LerpAngle,
  MAX_EDICTS,
  MAX_STATS,
  MSG_ReadAngle,
  MSG_ReadAngle16,
  MSG_ReadByte,
  MSG_ReadChar,
  MSG_ReadCoord,
  MSG_ReadData,
  MSG_ReadLong,
  MSG_ReadPos,
  MSG_ReadShort,
  PS_BLEND,
  PS_FOV,
  PS_KICKANGLES,
  PS_M_DELTA_ANGLES,
  PS_M_FLAGS,
  PS_M_GRAVITY,
  PS_M_ORIGIN,
  PS_M_TIME,
  PS_M_TYPE,
  PS_M_VELOCITY,
  PS_RDFLAGS,
  PS_VIEWANGLES,
  PS_VIEWOFFSET,
  PS_WEAPONFRAME,
  PS_WEAPONINDEX,
  RF_BEAM,
  RF_FRAMELERP,
  RF_SHELL_BLUE,
  RF_SHELL_DOUBLE,
  RF_SHELL_HALF_DAM,
  RF_SHELL_RED,
  RF_TRANSLUCENT,
  RF_VIEWERMODEL,
  U_ANGLE1,
  U_ANGLE2,
  U_ANGLE3,
  U_EFFECTS8,
  U_EFFECTS16,
  U_EVENT,
  U_FRAME8,
  U_FRAME16,
  U_MODEL,
  U_MODEL2,
  U_MODEL3,
  U_MODEL4,
  U_MOREBITS1,
  U_MOREBITS2,
  U_MOREBITS3,
  U_NUMBER16,
  U_OLDORIGIN,
  U_ORIGIN1,
  U_ORIGIN2,
  U_ORIGIN3,
  U_REMOVE,
  U_RENDERFX8,
  U_RENDERFX16,
  U_SKIN8,
  U_SKIN16,
  U_SOLID,
  U_SOUND,
  UPDATE_MASK,
  createEntityState,
  svc_ops_e,
  pmtype_t,
  type entity_state_t,
  entity_event_t,
  type vec3_t
} from "../../qcommon/src/index.js";
import { MAX_PARSE_ENTITIES, connstate_t, createFrame, type ClientRuntime, type frame_t } from "./client.js";
import { CL_BuildEntityEventEffects, type ClientActionEffect } from "./cl_fx.js";
import { CL_CheckPredictionError } from "./cl_pred.js";
import type { ClientParseHooks } from "./cl_parse.js";

/**
 * Original name: N/A
 * Source: N/A (client event snapshot)
 * Category: New
 * Purpose: Describe one entity event extracted from the parsed packet entity stream.
 *
 * Constraints:
 * - Must preserve the original event id and source entity state.
 */
export interface ClientEntityEvent {
  number: number;
  event: number;
  effects: number;
  state: entity_state_t;
}

/**
 * Original name: N/A
 * Source: N/A (client render snapshot)
 * Category: New
 * Purpose: Describe one interpolated entity snapshot ready for later renderer adapters.
 *
 * Constraints:
 * - Must preserve Quake II interpolation, animation frame and effect-derived flags.
 */
export interface ClientInterpolatedEntity {
  number: number;
  state: entity_state_t;
  previous: entity_state_t;
  origin: vec3_t;
  oldorigin: vec3_t;
  angles: vec3_t;
  frame: number;
  oldframe: number;
  backlerp: number;
  effects: number;
  renderfx: number;
  flags: number;
  alpha: number;
  skinnum: number;
  modelindex: number;
  modelindex2: number;
  modelindex3: number;
  modelindex4: number;
  viewerEntity: boolean;
  customPlayerSkin: boolean;
  customWeaponModel: boolean;
}

/**
 * Original name: CL_FireEntityEvents
 * Source: client/cl_ents.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Extracts per-frame entity events from the parsed packet entity stream.
 *
 * Porting notes:
 * - Returns structured events and optionally forwards them through a callback instead of invoking effect systems directly.
 */
export function CL_FireEntityEvents(
  runtime: ClientRuntime,
  frame: frame_t,
  onEntityEvent?: (event: ClientEntityEvent) => void
): ClientEntityEvent[] {
  const events: ClientEntityEvent[] = [];

  for (let pnum = 0; pnum < frame.num_entities; pnum += 1) {
    const index = (frame.parse_entities + pnum) & (MAX_PARSE_ENTITIES - 1);
    const state = runtime.cl_parse_entities[index];

    if (state.event !== 0) {
      const event: ClientEntityEvent = {
        number: state.number,
        event: state.event,
        effects: state.effects,
        state: cloneEntityState(state)
      };
      events.push(event);
      onEntityEvent?.(event);
    }

    if ((state.effects & EF_TELEPORTER) !== 0) {
      const event: ClientEntityEvent = {
        number: state.number,
        event: 0,
        effects: state.effects,
        state: cloneEntityState(state)
      };
      events.push(event);
      onEntityEvent?.(event);
    }
  }

  return events;
}

/**
 * Original name: N/A
 * Source: N/A (client event-effect adapter)
 * Category: New
 *
 * Purpose:
 * - Compose the ported `CL_FireEntityEvents` extractor with the ported `CL_EntityEvent` effect builder.
 *
 * Constraints:
 * - Must not claim ownership of either C source entity; those remain covered by their dedicated ports.
 */
export function CL_BuildFrameEntityEventEffects(
  runtime: ClientRuntime,
  frame: frame_t = runtime.cl.frame,
  options: {
    clFootsteps?: boolean;
  } = {}
): ClientActionEffect[] {
  const events = CL_FireEntityEvents(runtime, frame);
  const effects: ClientActionEffect[] = [];

  for (const event of events) {
    effects.push(...CL_BuildEntityEventEffects(event, {
      clFootsteps: options.clFootsteps ?? runtime.cl.cl_footsteps
    }));
  }

  return effects;
}

/**
 * Original name: N/A
 * Source: N/A (client frame snapshot helper)
 * Category: New
 * Purpose: Collect the entity states referenced by one parsed frame in network order.
 *
 * Constraints:
 * - Must preserve frame parse order and return value copies.
 */
export function CL_GetFrameEntityStates(runtime: ClientRuntime, frame: frame_t = runtime.cl.frame): entity_state_t[] {
  const entities: entity_state_t[] = [];

  for (let pnum = 0; pnum < frame.num_entities; pnum += 1) {
    const index = (frame.parse_entities + pnum) & (MAX_PARSE_ENTITIES - 1);
    entities.push(cloneEntityState(runtime.cl_parse_entities[index]));
  }

  return entities;
}

/**
 * Original name: CL_AddPacketEntities
 * Source: client/cl_ents.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Builds the first renderer-facing packet entity snapshots from the current client frame.
 *
 * Porting notes:
 * - Must preserve Quake II interpolation and effect-derived animation rules.
 * - Leaves linked lights, particle trails and refresh registration to later phases.
 */
export function CL_BuildPacketEntitySnapshots(
  runtime: ClientRuntime,
  frame: frame_t = runtime.cl.frame,
  lerpfrac = runtime.cl.lerpfrac
): ClientInterpolatedEntity[] {
  const snapshots: ClientInterpolatedEntity[] = [];
  const autorotate = anglemod(runtime.cl.time / 10);
  const autoanim = Math.trunc((2 * runtime.cl.time) / 1000);

  for (let pnum = 0; pnum < frame.num_entities; pnum += 1) {
    const state = runtime.cl_parse_entities[(frame.parse_entities + pnum) & (MAX_PARSE_ENTITIES - 1)];
    const cent = runtime.cl_entities[state.number];

    let effects = state.effects;
    let renderfx = state.renderfx;
    let frameNumber = state.frame;

    if ((effects & EF_ANIM01) !== 0) {
      frameNumber = autoanim & 1;
    } else if ((effects & EF_ANIM23) !== 0) {
      frameNumber = 2 + (autoanim & 1);
    } else if ((effects & EF_ANIM_ALL) !== 0) {
      frameNumber = autoanim;
    } else if ((effects & EF_ANIM_ALLFAST) !== 0) {
      frameNumber = Math.trunc(runtime.cl.time / 100);
    }

    if ((effects & EF_PENT) !== 0) {
      effects &= ~EF_PENT;
      effects |= EF_COLOR_SHELL;
      renderfx |= RF_SHELL_RED;
    }

    if ((effects & EF_QUAD) !== 0) {
      effects &= ~EF_QUAD;
      effects |= EF_COLOR_SHELL;
      renderfx |= RF_SHELL_BLUE;
    }

    if ((effects & EF_DOUBLE) !== 0) {
      effects &= ~EF_DOUBLE;
      effects |= EF_COLOR_SHELL;
      renderfx |= RF_SHELL_DOUBLE;
    }

    if ((effects & EF_HALF_DAMAGE) !== 0) {
      effects &= ~EF_HALF_DAMAGE;
      effects |= EF_COLOR_SHELL;
      renderfx |= RF_SHELL_HALF_DAM;
    }

    const origin: vec3_t = [0, 0, 0];
    const oldorigin: vec3_t = [0, 0, 0];
    if ((renderfx & (RF_FRAMELERP | RF_BEAM)) !== 0) {
      origin[0] = cent.current.origin[0];
      origin[1] = cent.current.origin[1];
      origin[2] = cent.current.origin[2];
      oldorigin[0] = cent.current.old_origin[0];
      oldorigin[1] = cent.current.old_origin[1];
      oldorigin[2] = cent.current.old_origin[2];
    } else {
      for (let index = 0; index < 3; index += 1) {
        const lerped = cent.prev.origin[index] + lerpfrac * (cent.current.origin[index] - cent.prev.origin[index]);
        origin[index] = lerped;
        oldorigin[index] = lerped;
      }
    }

    const angles: vec3_t = [0, 0, 0];
    if ((effects & EF_ROTATE) !== 0) {
      angles[0] = 0;
      angles[1] = autorotate;
      angles[2] = 0;
    } else if ((effects & EF_SPINNINGLIGHTS) !== 0) {
      angles[0] = 0;
      angles[1] = anglemod(runtime.cl.time / 2) + state.angles[1];
      angles[2] = 180;
    } else {
      for (let index = 0; index < 3; index += 1) {
        angles[index] = LerpAngle(cent.prev.angles[index], cent.current.angles[index], lerpfrac);
      }
    }

    let flags = (effects & EF_COLOR_SHELL) !== 0 ? 0 : renderfx;
    let alpha = 1;
    let skinnum = state.skinnum;

    if (renderfx === RF_TRANSLUCENT) {
      alpha = 0.7;
    }
    if ((effects & EF_BFG) !== 0) {
      flags |= RF_TRANSLUCENT;
      alpha = 0.3;
    }
    if ((effects & EF_PLASMA) !== 0) {
      flags |= RF_TRANSLUCENT;
      alpha = 0.6;
    }
    if ((effects & EF_SPHERETRANS) !== 0) {
      flags |= RF_TRANSLUCENT;
      alpha = (effects & EF_TRACKERTRAIL) !== 0 ? 0.6 : 0.3;
    }
    if ((renderfx & RF_BEAM) !== 0) {
      alpha = 0.3;
      skinnum = (state.skinnum >>> ((Math.trunc(runtime.cl.time / 100) & 3) * 8)) & 0xff;
    }
    if (state.number === runtime.cl.playernum + 1) {
      flags |= RF_VIEWERMODEL;
    }

    snapshots.push({
      number: state.number,
      state: cloneEntityState(state),
      previous: cloneEntityState(cent.prev),
      origin,
      oldorigin,
      angles,
      frame: frameNumber,
      oldframe: cent.prev.frame,
      backlerp: 1 - lerpfrac,
      effects,
      renderfx,
      flags,
      alpha,
      skinnum,
      modelindex: state.modelindex,
      modelindex2: state.modelindex2,
      modelindex3: state.modelindex3,
      modelindex4: state.modelindex4,
      viewerEntity: state.number === runtime.cl.playernum + 1,
      customPlayerSkin: state.modelindex === 255,
      customWeaponModel: state.modelindex2 === 255
    });
  }

  return snapshots;
}

/**
 * Original name: N/A
 * Source: N/A (entity state copy helper)
 * Category: New
 * Purpose: Clone one entity state so exported snapshots keep value semantics.
 */
function cloneEntityState(state: entity_state_t): entity_state_t {
  return {
    number: state.number,
    origin: [...state.origin],
    angles: [...state.angles],
    old_origin: [...state.old_origin],
    modelindex: state.modelindex,
    modelindex2: state.modelindex2,
    modelindex3: state.modelindex3,
    modelindex4: state.modelindex4,
    frame: state.frame,
    skinnum: state.skinnum,
    effects: state.effects,
    renderfx: state.renderfx,
    solid: state.solid,
    sound: state.sound,
    event: state.event
  };
}

/**
 * Original name: CL_ParseEntityBits
 * Source: client/cl_ents.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Reads one entity update header and returns the entity number and bitfield.
 *
 * Porting notes:
 * - Returns both values as an object instead of using an out pointer.
 */
export function CL_ParseEntityBits(runtime: ClientRuntime): { bits: number; number: number } {
  let total = MSG_ReadByte(runtime.net_message);

  if (total & U_MOREBITS1) {
    total |= MSG_ReadByte(runtime.net_message) << 8;
  }
  if (total & U_MOREBITS2) {
    total |= MSG_ReadByte(runtime.net_message) << 16;
  }
  if (total & U_MOREBITS3) {
    total |= MSG_ReadByte(runtime.net_message) << 24;
  }

  const number = (total & U_NUMBER16) !== 0
    ? MSG_ReadShort(runtime.net_message)
    : MSG_ReadByte(runtime.net_message);

  return { bits: total, number };
}

/**
 * Original name: CL_ParseDelta
 * Source: client/cl_ents.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Applies one entity delta against a previous or baseline state.
 *
 * Porting notes:
 * - Mutates the destination entity state passed by reference, matching the original porting shape.
 */
export function CL_ParseDelta(runtime: ClientRuntime, from: ReturnType<typeof createEntityState>, to: ReturnType<typeof createEntityState>, number: number, bits: number): void {
  copyEntityState(from, to);
  to.old_origin = [...from.origin];
  to.number = number;

  if (bits & U_MODEL) {
    to.modelindex = MSG_ReadByte(runtime.net_message);
  }
  if (bits & U_MODEL2) {
    to.modelindex2 = MSG_ReadByte(runtime.net_message);
  }
  if (bits & U_MODEL3) {
    to.modelindex3 = MSG_ReadByte(runtime.net_message);
  }
  if (bits & U_MODEL4) {
    to.modelindex4 = MSG_ReadByte(runtime.net_message);
  }
  if (bits & U_FRAME8) {
    to.frame = MSG_ReadByte(runtime.net_message);
  }
  if (bits & U_FRAME16) {
    to.frame = MSG_ReadShort(runtime.net_message);
  }

  if ((bits & U_SKIN8) !== 0 && (bits & U_SKIN16) !== 0) {
    to.skinnum = MSG_ReadLong(runtime.net_message);
  } else if (bits & U_SKIN8) {
    to.skinnum = MSG_ReadByte(runtime.net_message);
  } else if (bits & U_SKIN16) {
    to.skinnum = MSG_ReadShort(runtime.net_message);
  }

  if ((bits & (U_EFFECTS8 | U_EFFECTS16)) === (U_EFFECTS8 | U_EFFECTS16)) {
    to.effects = MSG_ReadLong(runtime.net_message);
  } else if (bits & U_EFFECTS8) {
    to.effects = MSG_ReadByte(runtime.net_message);
  } else if (bits & U_EFFECTS16) {
    to.effects = MSG_ReadShort(runtime.net_message);
  }

  if ((bits & (U_RENDERFX8 | U_RENDERFX16)) === (U_RENDERFX8 | U_RENDERFX16)) {
    to.renderfx = MSG_ReadLong(runtime.net_message);
  } else if (bits & U_RENDERFX8) {
    to.renderfx = MSG_ReadByte(runtime.net_message);
  } else if (bits & U_RENDERFX16) {
    to.renderfx = MSG_ReadShort(runtime.net_message);
  }

  if (bits & U_ORIGIN1) {
    to.origin[0] = MSG_ReadCoord(runtime.net_message);
  }
  if (bits & U_ORIGIN2) {
    to.origin[1] = MSG_ReadCoord(runtime.net_message);
  }
  if (bits & U_ORIGIN3) {
    to.origin[2] = MSG_ReadCoord(runtime.net_message);
  }
  if (bits & U_ANGLE1) {
    to.angles[0] = MSG_ReadAngle(runtime.net_message);
  }
  if (bits & U_ANGLE2) {
    to.angles[1] = MSG_ReadAngle(runtime.net_message);
  }
  if (bits & U_ANGLE3) {
    to.angles[2] = MSG_ReadAngle(runtime.net_message);
  }
  if (bits & U_OLDORIGIN) {
    to.old_origin = MSG_ReadPos(runtime.net_message);
  }
  if (bits & U_SOUND) {
    to.sound = MSG_ReadByte(runtime.net_message);
  }
  to.event = (bits & U_EVENT) !== 0 ? MSG_ReadByte(runtime.net_message) : 0;
  if (bits & U_SOLID) {
    to.solid = MSG_ReadShort(runtime.net_message);
  }
}

/**
 * Original name: CL_ParsePlayerstate
 * Source: client/cl_ents.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Reads one delta-compressed player state into the target frame.
 *
 * Porting notes:
 * - Preserves the original field-by-field update order.
 */
export function CL_ParsePlayerstate(runtime: ClientRuntime, oldframe: frame_t | null, newframe: frame_t): void {
  const state = newframe.playerstate;
  const source = oldframe ? oldframe.playerstate : createFrame().playerstate;
  copyPlayerState(source, state);

  const flags = MSG_ReadShort(runtime.net_message);

  if (flags & PS_M_TYPE) {
    state.pmove.pm_type = MSG_ReadByte(runtime.net_message) as pmtype_t;
  }
  if (flags & PS_M_ORIGIN) {
    state.pmove.origin[0] = MSG_ReadShort(runtime.net_message);
    state.pmove.origin[1] = MSG_ReadShort(runtime.net_message);
    state.pmove.origin[2] = MSG_ReadShort(runtime.net_message);
  }
  if (flags & PS_M_VELOCITY) {
    state.pmove.velocity[0] = MSG_ReadShort(runtime.net_message);
    state.pmove.velocity[1] = MSG_ReadShort(runtime.net_message);
    state.pmove.velocity[2] = MSG_ReadShort(runtime.net_message);
  }
  if (flags & PS_M_TIME) {
    state.pmove.pm_time = MSG_ReadByte(runtime.net_message);
  }
  if (flags & PS_M_FLAGS) {
    state.pmove.pm_flags = MSG_ReadByte(runtime.net_message);
  }
  if (flags & PS_M_GRAVITY) {
    state.pmove.gravity = MSG_ReadShort(runtime.net_message);
  }
  if (flags & PS_M_DELTA_ANGLES) {
    state.pmove.delta_angles[0] = MSG_ReadShort(runtime.net_message);
    state.pmove.delta_angles[1] = MSG_ReadShort(runtime.net_message);
    state.pmove.delta_angles[2] = MSG_ReadShort(runtime.net_message);
  }

  if (runtime.cl.attractloop) {
    state.pmove.pm_type = pmtype_t.PM_FREEZE;
  }

  if (flags & PS_VIEWOFFSET) {
    state.viewoffset[0] = MSG_ReadChar(runtime.net_message) * 0.25;
    state.viewoffset[1] = MSG_ReadChar(runtime.net_message) * 0.25;
    state.viewoffset[2] = MSG_ReadChar(runtime.net_message) * 0.25;
  }
  if (flags & PS_VIEWANGLES) {
    state.viewangles[0] = MSG_ReadAngle16(runtime.net_message);
    state.viewangles[1] = MSG_ReadAngle16(runtime.net_message);
    state.viewangles[2] = MSG_ReadAngle16(runtime.net_message);
  }
  if (flags & PS_KICKANGLES) {
    state.kick_angles[0] = MSG_ReadChar(runtime.net_message) * 0.25;
    state.kick_angles[1] = MSG_ReadChar(runtime.net_message) * 0.25;
    state.kick_angles[2] = MSG_ReadChar(runtime.net_message) * 0.25;
  }
  if (flags & PS_WEAPONINDEX) {
    state.gunindex = MSG_ReadByte(runtime.net_message);
  }
  if (flags & PS_WEAPONFRAME) {
    state.gunframe = MSG_ReadByte(runtime.net_message);
    state.gunoffset[0] = MSG_ReadChar(runtime.net_message) * 0.25;
    state.gunoffset[1] = MSG_ReadChar(runtime.net_message) * 0.25;
    state.gunoffset[2] = MSG_ReadChar(runtime.net_message) * 0.25;
    state.gunangles[0] = MSG_ReadChar(runtime.net_message) * 0.25;
    state.gunangles[1] = MSG_ReadChar(runtime.net_message) * 0.25;
    state.gunangles[2] = MSG_ReadChar(runtime.net_message) * 0.25;
  }
  if (flags & PS_BLEND) {
    state.blend[0] = MSG_ReadByte(runtime.net_message) / 255;
    state.blend[1] = MSG_ReadByte(runtime.net_message) / 255;
    state.blend[2] = MSG_ReadByte(runtime.net_message) / 255;
    state.blend[3] = MSG_ReadByte(runtime.net_message) / 255;
  }
  if (flags & PS_FOV) {
    state.fov = MSG_ReadByte(runtime.net_message);
  }
  if (flags & PS_RDFLAGS) {
    state.rdflags = MSG_ReadByte(runtime.net_message);
  }

  const statbits = MSG_ReadLong(runtime.net_message);
  for (let index = 0; index < MAX_STATS && index < state.stats.length; index += 1) {
    if ((statbits & (1 << index)) !== 0) {
      state.stats[index] = MSG_ReadShort(runtime.net_message);
    }
  }
}


/**
 * Original name: CL_ParseFrame
 * Source: client/cl_ents.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Parses one frame message including areabits, player state and packet entities.
 *
 * Porting notes:
 * - Preserves validity checks and frame ring-buffer storage.
 */
export function CL_ParseFrame(runtime: ClientRuntime, hooks: ClientParseHooks = {}): void {
  runtime.cl.frame = createFrame();

  runtime.cl.frame.serverframe = MSG_ReadLong(runtime.net_message);
  runtime.cl.frame.deltaframe = MSG_ReadLong(runtime.net_message);
  runtime.cl.frame.servertime = runtime.cl.frame.serverframe * 100;

  if (runtime.cls.serverProtocol !== 26) {
    runtime.cl.surpressCount = MSG_ReadByte(runtime.net_message);
  }

  let old: frame_t | null = null;
  if (runtime.cl.frame.deltaframe <= 0) {
    runtime.cl.frame.valid = true;
    runtime.cls.demowaiting = false;
  } else {
    old = runtime.cl.frames[runtime.cl.frame.deltaframe & UPDATE_MASK];
    if (
      old.valid &&
      old.serverframe === runtime.cl.frame.deltaframe &&
      runtime.cl.parse_entities - old.parse_entities <= MAX_PARSE_ENTITIES - 128
    ) {
      runtime.cl.frame.valid = true;
    }
  }

  if (runtime.cl.time > runtime.cl.frame.servertime) {
    runtime.cl.time = runtime.cl.frame.servertime;
  } else if (runtime.cl.time < runtime.cl.frame.servertime - 100) {
    runtime.cl.time = runtime.cl.frame.servertime - 100;
  }

  const areaBitLength = MSG_ReadByte(runtime.net_message);
  runtime.cl.frame.areabits.fill(0);
  runtime.cl.frame.areabits.set(MSG_ReadData(runtime.net_message, areaBitLength));

  const playerInfoCommand = MSG_ReadByte(runtime.net_message);
  if (playerInfoCommand !== svc_ops_e.svc_playerinfo) {
    throw new Error("CL_ParseFrame: not playerinfo");
  }
  CL_ParsePlayerstate(runtime, old, runtime.cl.frame);

  const packetEntitiesCommand = MSG_ReadByte(runtime.net_message);
  if (packetEntitiesCommand !== svc_ops_e.svc_packetentities) {
    throw new Error("CL_ParseFrame: not packetentities");
  }
  CL_ParsePacketEntities(runtime, old, runtime.cl.frame);

  runtime.cl.frames[runtime.cl.frame.serverframe & UPDATE_MASK] = cloneFrame(runtime.cl.frame);

  if (runtime.cl.frame.valid) {
    if (runtime.cls.state !== connstate_t.ca_active) {
      runtime.cls.state = connstate_t.ca_active;
      runtime.cl.force_refdef = true;
      runtime.cl.predicted_origin[0] = runtime.cl.frame.playerstate.pmove.origin[0] * 0.125;
      runtime.cl.predicted_origin[1] = runtime.cl.frame.playerstate.pmove.origin[1] * 0.125;
      runtime.cl.predicted_origin[2] = runtime.cl.frame.playerstate.pmove.origin[2] * 0.125;
      runtime.cl.predicted_angles = [...runtime.cl.frame.playerstate.viewangles];
      if (runtime.cls.disable_servercount !== runtime.cl.servercount && runtime.cl.refresh_prepped) {
        hooks.onEndLoadingPlaque?.();
      }
    }

    runtime.cl.sound_prepped = true;
    CL_FireEntityEvents(runtime, runtime.cl.frame, hooks.onEntityEvent);
    CL_CheckPredictionError(runtime, {
      incomingAcknowledged: runtime.cls.netchan.incoming_acknowledged,
      predictMovement: true
    });
  }

  hooks.onFrameParsed?.(cloneFrame(runtime.cl.frame));
}


/**
 * Original name: CL_DeltaEntity
 * Source: client/cl_ents.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Parses one entity delta and appends it into the current frame parse ring.
 *
 * Porting notes:
 * - Preserves the original no-lerp conditions and entity ring behavior.
 */
function CL_DeltaEntity(runtime: ClientRuntime, frame: frame_t, newnum: number, oldState: ReturnType<typeof createEntityState>, bits: number): void {
  const entity = runtime.cl_entities[newnum];
  const state = runtime.cl_parse_entities[runtime.cl.parse_entities & (MAX_PARSE_ENTITIES - 1)];
  runtime.cl.parse_entities += 1;
  frame.num_entities += 1;

  CL_ParseDelta(runtime, oldState, state, newnum, bits);

  if (
    state.modelindex !== entity.current.modelindex ||
    state.modelindex2 !== entity.current.modelindex2 ||
    state.modelindex3 !== entity.current.modelindex3 ||
    state.modelindex4 !== entity.current.modelindex4 ||
    Math.abs(state.origin[0] - entity.current.origin[0]) > 512 ||
    Math.abs(state.origin[1] - entity.current.origin[1]) > 512 ||
    Math.abs(state.origin[2] - entity.current.origin[2]) > 512 ||
    state.event === entity_event_t.EV_PLAYER_TELEPORT ||
    state.event === entity_event_t.EV_OTHER_TELEPORT
  ) {
    entity.serverframe = -99;
  }

  if (entity.serverframe !== runtime.cl.frame.serverframe - 1) {
    entity.trailcount = 1024;
    copyEntityState(state, entity.prev);
    if (state.event === entity_event_t.EV_OTHER_TELEPORT) {
      entity.prev.origin = [...state.origin];
      entity.lerp_origin = [...state.origin];
    } else {
      entity.prev.origin = [...state.old_origin];
      entity.lerp_origin = [...state.old_origin];
    }
  } else {
    copyEntityState(entity.current, entity.prev);
  }

  entity.serverframe = runtime.cl.frame.serverframe;
  copyEntityState(state, entity.current);
}

/**
 * Original name: CL_ParsePacketEntities
 * Source: client/cl_ents.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Parses the packet entity stream for one frame.
 *
 * Porting notes:
 * - Preserves the original merge of old frame entities, removals and baselines.
 */
function CL_ParsePacketEntities(runtime: ClientRuntime, oldframe: frame_t | null, newframe: frame_t): void {
  newframe.parse_entities = runtime.cl.parse_entities;
  newframe.num_entities = 0;

  let oldindex = 0;
  let oldnum = 99999;
  let oldstate: ReturnType<typeof createEntityState> | null = null;

  if (oldframe && oldframe.num_entities > 0) {
    oldstate = runtime.cl_parse_entities[(oldframe.parse_entities + oldindex) & (MAX_PARSE_ENTITIES - 1)];
    oldnum = oldstate.number;
  }

  while (true) {
    const { bits, number: newnum } = CL_ParseEntityBits(runtime);
    if (newnum >= MAX_EDICTS) {
      throw new Error(`CL_ParsePacketEntities: bad number:${newnum}`);
    }
    if (runtime.net_message.readcount > runtime.net_message.cursize) {
      throw new Error("CL_ParsePacketEntities: end of message");
    }
    if (newnum === 0) {
      break;
    }

    while (oldnum < newnum && oldframe && oldstate) {
      CL_DeltaEntity(runtime, newframe, oldnum, oldstate, 0);
      oldindex += 1;
      if (oldindex >= oldframe.num_entities) {
        oldnum = 99999;
        oldstate = null;
      } else {
        oldstate = runtime.cl_parse_entities[(oldframe.parse_entities + oldindex) & (MAX_PARSE_ENTITIES - 1)];
        oldnum = oldstate.number;
      }
    }

    if ((bits & U_REMOVE) !== 0) {
      oldindex += 1;
      if (!oldframe || oldindex >= oldframe.num_entities) {
        oldnum = 99999;
        oldstate = null;
      } else {
        oldstate = runtime.cl_parse_entities[(oldframe.parse_entities + oldindex) & (MAX_PARSE_ENTITIES - 1)];
        oldnum = oldstate.number;
      }
      continue;
    }

    if (oldnum === newnum && oldstate) {
      CL_DeltaEntity(runtime, newframe, newnum, oldstate, bits);
      oldindex += 1;
      if (!oldframe || oldindex >= oldframe.num_entities) {
        oldnum = 99999;
        oldstate = null;
      } else {
        oldstate = runtime.cl_parse_entities[(oldframe.parse_entities + oldindex) & (MAX_PARSE_ENTITIES - 1)];
        oldnum = oldstate.number;
      }
      continue;
    }

    if (oldnum > newnum) {
      CL_DeltaEntity(runtime, newframe, newnum, runtime.cl_entities[newnum].baseline, bits);
      continue;
    }
  }

  while (oldnum !== 99999 && oldstate) {
    CL_DeltaEntity(runtime, newframe, oldnum, oldstate, 0);
    oldindex += 1;
    if (!oldframe || oldindex >= oldframe.num_entities) {
      oldnum = 99999;
      oldstate = null;
    } else {
      oldstate = runtime.cl_parse_entities[(oldframe.parse_entities + oldindex) & (MAX_PARSE_ENTITIES - 1)];
      oldnum = oldstate.number;
    }
  }
}


/**
 * Original name: N/A
 * Source: N/A (local copy helper)
 * Category: New
 * Purpose: Copy one entity state into another while preserving tuple fields by value.
 *
 * Constraints:
 * - Must avoid sharing mutable vector arrays between states.
 */
function copyEntityState(source: ReturnType<typeof createEntityState>, target: ReturnType<typeof createEntityState>): void {
  target.number = source.number;
  target.origin = [...source.origin];
  target.angles = [...source.angles];
  target.old_origin = [...source.old_origin];
  target.modelindex = source.modelindex;
  target.modelindex2 = source.modelindex2;
  target.modelindex3 = source.modelindex3;
  target.modelindex4 = source.modelindex4;
  target.frame = source.frame;
  target.skinnum = source.skinnum;
  target.effects = source.effects;
  target.renderfx = source.renderfx;
  target.solid = source.solid;
  target.sound = source.sound;
  target.event = source.event;
}

/**
 * Original name: N/A
 * Source: N/A (local copy helper)
 * Category: New
 * Purpose: Copy one player state into another while preserving nested arrays by value.
 *
 * Constraints:
 * - Must avoid sharing mutable arrays across frames.
 */
function copyPlayerState(source: frame_t["playerstate"], target: frame_t["playerstate"]): void {
  target.pmove.pm_type = source.pmove.pm_type;
  target.pmove.origin = [...source.pmove.origin];
  target.pmove.velocity = [...source.pmove.velocity];
  target.pmove.pm_flags = source.pmove.pm_flags;
  target.pmove.pm_time = source.pmove.pm_time;
  target.pmove.gravity = source.pmove.gravity;
  target.pmove.delta_angles = [...source.pmove.delta_angles];
  target.viewangles = [...source.viewangles];
  target.viewoffset = [...source.viewoffset];
  target.kick_angles = [...source.kick_angles];
  target.gunangles = [...source.gunangles];
  target.gunoffset = [...source.gunoffset];
  target.gunindex = source.gunindex;
  target.gunframe = source.gunframe;
  target.blend = [...source.blend];
  target.fov = source.fov;
  target.rdflags = source.rdflags;
  target.stats = [...source.stats];
}

/**
 * Original name: N/A
 * Source: N/A (local frame clone helper)
 * Category: New
 * Purpose: Clone one parsed frame so frame ring-buffer storage keeps value semantics.
 *
 * Constraints:
 * - Must deep-copy mutable arrays and nested player state.
 */
function cloneFrame(frame: frame_t): frame_t {
  const clone = createFrame();
  clone.valid = frame.valid;
  clone.serverframe = frame.serverframe;
  clone.servertime = frame.servertime;
  clone.deltaframe = frame.deltaframe;
  clone.areabits = new Uint8Array(frame.areabits);
  copyPlayerState(frame.playerstate, clone.playerstate);
  clone.num_entities = frame.num_entities;
  clone.parse_entities = frame.parse_entities;
  return clone;
}
