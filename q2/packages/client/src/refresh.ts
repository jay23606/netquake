/**
 * File: refresh.ts
 * Source: Quake II original / client/cl_ents.c
 * Purpose: Port the first refresh-facing client composition helpers that transform parsed frames into structured render entities and dynamic lights.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Emits structured refresh data instead of calling renderer entry points directly.
 * - Emits temp entities, particles and backend-agnostic refresh data for later adapter layers.
 *
 * Notes:
 * - This file is intended to stay conceptually close to the original C source.
 */

import {
  CL_AddDLights,
  CL_AddLightStyles,
  CL_AddParticles,
  CL_ExecutePacketEntityEffects,
  CL_RunDLights,
  CL_RunLightStyles,
  type ClientLightStyle
} from "./cl_fx.js";
import {
  AngleVectors,
  EF_ANIM_ALLFAST,
  EF_BFG,
  EF_BLASTER,
  EF_BLUEHYPERBLASTER,
  EF_COLOR_SHELL,
  EF_FLAG1,
  EF_FLAG2,
  EF_HYPERBLASTER,
  EF_IONRIPPER,
  EF_POWERSCREEN,
  EF_PLASMA,
  EF_ROCKET,
  EF_SPINNINGLIGHTS,
  EF_TAGTRAIL,
  EF_TRACKER,
  EF_TRACKERTRAIL,
  EF_TRAP,
  LerpAngle,
  RF_DEPTHHACK,
  RF_MINLIGHT,
  RF_SHELL_GREEN,
  RF_TRANSLUCENT,
  RF_WEAPONMODEL,
  type vec3_t
} from "../../qcommon/src/index.js";
import { CL_BuildPacketEntitySnapshots, type ClientInterpolatedEntity } from "./cl_ents.js";
import { CL_BuildTEntRefresh, type ClientBeamRender, type ClientExplosionRender, type ClientForceWallRender } from "./cl_tent.js";
import type { ClientSustainRender } from "./cl_tent.js";
import { CL_CalcViewValues, CL_UpdateLerpFraction, type ClientViewOptions, type ClientViewValues } from "./cl_view.js";
import { connstate_t, type ClientRuntime } from "./client.js";

/**
 * Original name: N/A
 * Source: N/A (refresh frame payload)
 * Category: New
 * Purpose: Describe one render-facing entity emitted by the first client refresh bridge.
 *
 * Constraints:
 * - Must preserve enough source metadata to resolve models, skins and linked entities later in renderer adapters.
 */
export interface ClientRenderEntity {
  entityNumber: number;
  modelindex: number;
  resolvedModelPath?: string | null;
  frame: number;
  oldframe: number;
  backlerp: number;
  origin: vec3_t;
  oldorigin: vec3_t;
  angles: vec3_t;
  skinnum: number;
  alpha: number;
  flags: number;
  effects: number;
  customPlayerSkin: boolean;
  customWeaponModel: boolean;
  linkedModelSlot: 0 | 1 | 2 | 3 | 4 | 5;
}

/**
 * Original name: N/A
 * Source: N/A (refresh frame payload)
 * Category: New
 * Purpose: Describe one dynamic light emitted by the first client refresh bridge.
 *
 * Constraints:
 * - Must preserve Quake-style signed color values for later backend-specific handling.
 */
export interface ClientDynamicLight {
  origin: vec3_t;
  intensity: number;
  color: [number, number, number];
  minlight?: number;
  sourceEntity: number;
  kind: string;
}

/**
 * Original name: N/A
 * Source: N/A (refresh frame payload)
 * Category: New
 * Purpose: Describe one renderer-facing particle emitted by the client particle integration pass.
 *
 * Constraints:
 * - Must preserve the same payload shape as the original `V_AddParticle` call site.
 */
export interface ClientRenderParticle {
  origin: vec3_t;
  color: number;
  alpha: number;
}

/**
 * Original name: N/A
 * Source: N/A (refresh frame payload)
 * Category: New
 * Purpose: Describe one structured refresh frame that mirrors the usable output of `CL_AddEntities`.
 *
 * Constraints:
 * - Must carry the logical view plus entity/light lists without mutating renderer backends.
 */
export interface ClientRefreshFrame {
  view: ClientViewValues;
  areabits: Uint8Array;
  entities: ClientRenderEntity[];
  lights: ClientDynamicLight[];
  particles: ClientRenderParticle[];
  lightStyles: ClientLightStyle[];
  beams: ClientBeamRender[];
  explosions: ClientExplosionRender[];
  forceWalls: ClientForceWallRender[];
  sustains: ClientSustainRender[];
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Build the inert refresh payload returned while the client is not active.
 */
function createEmptyRefreshFrame(runtime: ClientRuntime): ClientRefreshFrame {
  return {
    view: {
      vieworg: [0, 0, 0],
      viewangles: [...runtime.cl.viewangles],
      forward: [0, 0, 1],
      right: [1, 0, 0],
      up: [0, 1, 0],
      fov_x: runtime.cl.frame.playerstate.fov,
      blend: [...runtime.cl.frame.playerstate.blend] as [number, number, number, number]
    },
    areabits: new Uint8Array(runtime.cl.frame.areabits),
    entities: [],
    lights: [],
    particles: [],
    lightStyles: [],
    beams: [],
    explosions: [],
    forceWalls: [],
    sustains: []
  };
}

/**
 * Original name: CL_AddEntities
 * Source: client/cl_ents.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Computes the current lerp fraction, logical view and refresh-facing packet entity list.
 *
 * Porting notes:
 * - Emits structured entities and lights instead of calling `V_AddEntity` / `V_AddLight`.
 * - Returns an empty structured frame when the original C would return before emitting.
 */
export function CL_BuildRefreshFrame(
  runtime: ClientRuntime,
  options: ClientViewOptions = {}
): ClientRefreshFrame {
  if (runtime.cls.state !== connstate_t.ca_active) {
    return createEmptyRefreshFrame(runtime);
  }

  CL_UpdateLerpFraction(runtime, options);

  const view = CL_CalcViewValues(runtime, options);
  CL_RunDLights(runtime);
  CL_RunLightStyles(runtime);
  const packetEntities = CL_BuildPacketEntitySnapshots(runtime);
  CL_ExecutePacketEntityEffects(runtime, packetEntities);
  const tempRefresh = CL_BuildTEntRefresh(runtime);
  const entities: ClientRenderEntity[] = [];
  const lights: ClientDynamicLight[] = [...CL_AddDLights(runtime), ...tempRefresh.lights];
  const particles = CL_AddParticles(runtime);
  const lightStyles = CL_AddLightStyles(runtime);

  appendViewWeapon(runtime, view, entities, options);

  for (const snapshot of packetEntities) {
    if (snapshot.viewerEntity) {
      appendViewerLights(snapshot, lights);
      updateEntityLerpOrigin(runtime, snapshot);
      continue;
    }

    if (snapshot.modelindex !== 0) {
      entities.push(createRenderEntity(snapshot, snapshot.modelindex, 0));

      if ((snapshot.effects & EF_COLOR_SHELL) !== 0) {
        entities.push({
          ...createRenderEntity(snapshot, snapshot.modelindex, 1),
          alpha: 0.3,
          flags: snapshot.renderfx | RF_TRANSLUCENT
        });
      }

      if ((snapshot.effects & EF_POWERSCREEN) !== 0) {
        entities.push({
          ...createRenderEntity(snapshot, 0, 5),
          alpha: 0.3,
          flags: RF_TRANSLUCENT | RF_SHELL_GREEN
        });
      }

      appendLinkedModels(snapshot, entities);
    }

    appendEntityLights(snapshot, lights, runtime.cl.time);
    updateEntityLerpOrigin(runtime, snapshot);
  }

  appendTempExplosions(tempRefresh.explosions, entities);

  return {
    view,
    areabits: new Uint8Array(runtime.cl.frame.areabits),
    entities,
    lights,
    particles,
    lightStyles,
    beams: tempRefresh.beams,
    explosions: tempRefresh.explosions,
    forceWalls: tempRefresh.forceWalls,
    sustains: tempRefresh.sustains
  };
}

/**
 * Original name: N/A
 * Source: N/A (refresh adapter for CL_AddExplosions output)
 * Category: Adapter
 * Fidelity level: Adapter
 *
 * Behavior:
 * - Converts persistent temp explosions, including `TE_BLASTER` impact flashes,
 *   into regular refresh entities so renderer adapters draw their MD2/SP2 models.
 *
 * Porting notes:
 * - The owner of `CL_AddExplosions` remains `packages/client/src/cl_tent.ts`;
 *   this helper only adapts its structured output into the refresh entity list.
 */
function appendTempExplosions(
  explosions: readonly ClientExplosionRender[],
  entities: ClientRenderEntity[]
): void {
  for (let index = 0; index < explosions.length; index += 1) {
    const explosion = explosions[index];
    entities.push({
      entityNumber: -1000 - index,
      modelindex: 0,
      resolvedModelPath: explosion.model,
      frame: explosion.frame,
      oldframe: explosion.oldframe,
      backlerp: explosion.backlerp,
      origin: [...explosion.origin],
      oldorigin: [...explosion.origin],
      angles: [...explosion.angles],
      skinnum: explosion.skinnum,
      alpha: explosion.alpha,
      flags: explosion.flags,
      effects: 0,
      customPlayerSkin: false,
      customWeaponModel: false,
      linkedModelSlot: 0
    });
  }
}

/**
 * Original name: CL_GetEntitySoundOrigin
 * Source: client/cl_ents.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the spatialized sound origin for one entity from the current lerped client state.
 *
 * Porting notes:
 * - Returns a cloned vector instead of mutating an output pointer.
 */
export function CL_GetEntitySoundOrigin(runtime: ClientRuntime, ent: number): vec3_t {
  if (ent < 0 || ent >= runtime.cl_entities.length) {
    throw new Error("CL_GetEntitySoundOrigin: bad ent");
  }

  return [...runtime.cl_entities[ent].lerp_origin];
}

/**
 * Original name: CL_AddViewWeapon
 * Source: client/cl_ents.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Builds the first-person weapon model entity from the current and previous player states.
 *
 * Porting notes:
 * - Emits a structured entity when the current game state would draw the weapon.
 */
function appendViewWeapon(
  runtime: ClientRuntime,
  view: ClientViewValues,
  entities: ClientRenderEntity[],
  options: ClientViewOptions = {}
): void {
  const ps = runtime.cl.frame.playerstate;
  let oldframe = runtime.cl.frames[(runtime.cl.frame.serverframe - 1) & (runtime.cl.frames.length - 1)];
  if (oldframe.serverframe !== runtime.cl.frame.serverframe - 1 || !oldframe.valid) {
    oldframe = runtime.cl.frame;
  }

  const ops = oldframe.playerstate;
  if (options.drawGun === false || ps.fov > 90) {
    return;
  }

  if (ps.gunindex === 0 && !options.gunModelOverride) {
    return;
  }

  const origin: vec3_t = [0, 0, 0];
  const angles: vec3_t = [0, 0, 0];

  for (let index = 0; index < 3; index += 1) {
    origin[index] =
      view.vieworg[index] +
      ops.gunoffset[index] +
      runtime.cl.lerpfrac * (ps.gunoffset[index] - ops.gunoffset[index]);
    angles[index] =
      view.viewangles[index] +
      LerpAngle(ops.gunangles[index], ps.gunangles[index], runtime.cl.lerpfrac);
  }

  entities.push({
    entityNumber: runtime.cl.playernum + 1,
    modelindex: ps.gunindex,
    resolvedModelPath: options.gunModelOverride ?? null,
    frame:
      options.gunFrameOverride && options.gunFrameOverride !== 0
        ? options.gunFrameOverride
        : ps.gunframe,
    oldframe:
      options.gunFrameOverride && options.gunFrameOverride !== 0
        ? options.gunFrameOverride
        : ps.gunframe === 0
          ? 0
          : ops.gunframe,
    backlerp: 1 - runtime.cl.lerpfrac,
    origin,
    oldorigin: [...origin],
    angles,
    skinnum: 0,
    alpha: 1,
    flags: RF_MINLIGHT | RF_DEPTHHACK | RF_WEAPONMODEL,
    effects: 0,
    customPlayerSkin: false,
    customWeaponModel: false,
    linkedModelSlot: 0
  });
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Convert one interpolated packet entity snapshot into a renderer-facing entity record.
 */
function createRenderEntity(
  snapshot: ClientInterpolatedEntity,
  modelindex: number,
  linkedModelSlot: ClientRenderEntity["linkedModelSlot"]
): ClientRenderEntity {
  return {
    entityNumber: snapshot.number,
    modelindex,
    frame: snapshot.frame,
    oldframe: snapshot.oldframe,
    backlerp: snapshot.backlerp,
    origin: [...snapshot.origin],
    oldorigin: [...snapshot.oldorigin],
    angles: [...snapshot.angles],
    skinnum: snapshot.skinnum,
    alpha: snapshot.alpha,
    flags: snapshot.flags,
    effects: snapshot.effects,
    customPlayerSkin: snapshot.customPlayerSkin && linkedModelSlot === 0,
    customWeaponModel: snapshot.customWeaponModel && linkedModelSlot === 2,
    linkedModelSlot
  };
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Emit the linked auxiliary models attached to one packet entity snapshot.
 */
function appendLinkedModels(snapshot: ClientInterpolatedEntity, entities: ClientRenderEntity[]): void {
  if (snapshot.modelindex2 !== 0) {
    if (snapshot.modelindex2 === 255) {
      entities.push(createLinkedRenderEntity(snapshot, snapshot.modelindex2, 2));
    } else {
      const isTranslucentLinkedModel = (snapshot.modelindex2 & 0x80) !== 0;
      entities.push({
        ...createLinkedRenderEntity(snapshot, isTranslucentLinkedModel ? snapshot.modelindex2 & 0x7f : snapshot.modelindex2, 2),
        alpha: isTranslucentLinkedModel ? 0.32 : 1,
        flags: isTranslucentLinkedModel ? RF_TRANSLUCENT : 0
      });
    }
  }

  if (snapshot.modelindex3 !== 0) {
    entities.push(createLinkedRenderEntity(snapshot, snapshot.modelindex3, 3));
  }

  if (snapshot.modelindex4 !== 0) {
    entities.push(createLinkedRenderEntity(snapshot, snapshot.modelindex4, 4));
  }
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Emit linked models after the C `ent.skin`/`skinnum`/`flags`/`alpha` reset in `CL_AddPacketEntities`.
 */
function createLinkedRenderEntity(
  snapshot: ClientInterpolatedEntity,
  modelindex: number,
  linkedModelSlot: 2 | 3 | 4
): ClientRenderEntity {
  return {
    ...createRenderEntity(snapshot, modelindex, linkedModelSlot),
    skinnum: 0,
    alpha: 1,
    flags: 0,
    customPlayerSkin: false
  };
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Emit the player-owned flag/tracker lights that the original client handles before skipping the viewer model.
 */
function appendViewerLights(snapshot: ClientInterpolatedEntity, lights: ClientDynamicLight[]): void {
  if ((snapshot.effects & EF_FLAG1) !== 0) {
    lights.push(createLight(snapshot.origin, 225, [1, 0.1, 0.1], snapshot.number, "flag1"));
  } else if ((snapshot.effects & EF_FLAG2) !== 0) {
    lights.push(createLight(snapshot.origin, 225, [0.1, 0.1, 1], snapshot.number, "flag2"));
  } else if ((snapshot.effects & EF_TAGTRAIL) !== 0) {
    lights.push(createLight(snapshot.origin, 225, [1, 1, 0], snapshot.number, "tagtrail"));
  } else if ((snapshot.effects & EF_TRACKERTRAIL) !== 0) {
    lights.push(createLight(snapshot.origin, 225, [-1, -1, -1], snapshot.number, "trackertrail"));
  }
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Emit the first packet-entity-derived dynamic lights mirrored from `CL_AddPacketEntities`.
 */
function appendEntityLights(snapshot: ClientInterpolatedEntity, lights: ClientDynamicLight[], clientTime: number): void {
  if ((snapshot.effects & EF_SPINNINGLIGHTS) !== 0) {
    const { forward } = AngleVectors(snapshot.angles);
    lights.push(createLight(
      vectorMA(snapshot.origin, 64, forward),
      100,
      [1, 0, 0],
      snapshot.number,
      "spinninglights"
    ));
  }

  if ((snapshot.effects & EF_ROCKET) !== 0) {
    lights.push(createLight(snapshot.origin, 200, [1, 1, 0], snapshot.number, "rocket"));
  } else if ((snapshot.effects & EF_BLASTER) !== 0) {
    lights.push(createLight(
      snapshot.origin,
      200,
      (snapshot.effects & EF_TRACKER) !== 0 ? [0, 1, 0] : [1, 1, 0],
      snapshot.number,
      (snapshot.effects & EF_TRACKER) !== 0 ? "blaster2" : "blaster"
    ));
  } else if ((snapshot.effects & EF_HYPERBLASTER) !== 0) {
    lights.push(createLight(
      snapshot.origin,
      200,
      (snapshot.effects & EF_TRACKER) !== 0 ? [0, 1, 0] : [1, 1, 0],
      snapshot.number,
      (snapshot.effects & EF_TRACKER) !== 0 ? "hyperblaster2" : "hyperblaster"
    ));
  } else if ((snapshot.effects & EF_BLUEHYPERBLASTER) !== 0) {
    lights.push(createLight(snapshot.origin, 200, [0, 0, 1], snapshot.number, "bluehyperblaster"));
  }

  if ((snapshot.effects & EF_BFG) !== 0) {
    const ramp = [300, 400, 600, 300, 150, 75];
    const intensity = (snapshot.effects & EF_ANIM_ALLFAST) !== 0
      ? 200
      : snapshot.frame >= 0 && snapshot.frame < ramp.length ? ramp[snapshot.frame] : 200;
    lights.push(createLight(snapshot.origin, intensity, [0, 1, 0], snapshot.number, "bfg"));
  }

  if ((snapshot.effects & EF_PLASMA) !== 0) {
    lights.push(createLight(snapshot.origin, 130, [1, 0.5, 0.5], snapshot.number, "plasma"));
  }

  if ((snapshot.effects & EF_TRAP) !== 0) {
    lights.push(createLight(
      [snapshot.origin[0], snapshot.origin[1], snapshot.origin[2] + 32],
      (Math.floor(Math.random() * 100) + 100),
      [1, 0.8, 0.1],
      snapshot.number,
      "trap"
    ));
  }

  if ((snapshot.effects & EF_FLAG1) !== 0) {
    lights.push(createLight(snapshot.origin, 225, [1, 0.1, 0.1], snapshot.number, "flag1"));
  }

  if ((snapshot.effects & EF_FLAG2) !== 0) {
    lights.push(createLight(snapshot.origin, 225, [0.1, 0.1, 1], snapshot.number, "flag2"));
  }

  if ((snapshot.effects & EF_TAGTRAIL) !== 0) {
    lights.push(createLight(snapshot.origin, 225, [1, 1, 0], snapshot.number, "tagtrail"));
  }

  if ((snapshot.effects & EF_TRACKERTRAIL) !== 0) {
    if ((snapshot.effects & EF_TRACKER) !== 0) {
      lights.push(createLight(
        snapshot.origin,
        trackerPulseIntensity(clientTime),
        [-1, -1, -1],
        snapshot.number,
        "trackertrail"
      ));
    } else {
      lights.push(createLight(snapshot.origin, 155, [-1, -1, -1], snapshot.number, "tracker-shell"));
    }
  }

  if ((snapshot.effects & EF_TRACKER) !== 0 && (snapshot.effects & EF_TRACKERTRAIL) === 0) {
    lights.push(createLight(snapshot.origin, 200, [-1, -1, -1], snapshot.number, "tracker"));
  }

  if ((snapshot.effects & EF_IONRIPPER) !== 0) {
    lights.push(createLight(snapshot.origin, 100, [1, 0.5, 0.5], snapshot.number, "ionripper"));
  }
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Keep each client entity `lerp_origin` aligned with the latest refresh-facing interpolated origin.
 */
function updateEntityLerpOrigin(runtime: ClientRuntime, snapshot: ClientInterpolatedEntity): void {
  runtime.cl_entities[snapshot.number].lerp_origin = [...snapshot.origin];
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Build one dynamic light value with cloned vector/color semantics.
 */
function createLight(
  origin: vec3_t,
  intensity: number,
  color: [number, number, number],
  sourceEntity: number,
  kind: string
): ClientDynamicLight {
  return {
    origin: [...origin],
    intensity,
    color: [...color],
    sourceEntity,
    kind
  };
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Mirror the Rogue tracker trail pulse from `CL_AddPacketEntities`.
 */
function trackerPulseIntensity(clientTime: number): number {
  return 50 + (500 * (Math.sin(clientTime / 500.0) + 1));
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Compute `origin + scale * direction` for light offsets.
 */
function vectorMA(origin: vec3_t, scale: number, direction: vec3_t): vec3_t {
  return [
    origin[0] + scale * direction[0],
    origin[1] + scale * direction[1],
    origin[2] + scale * direction[2]
  ];
}
