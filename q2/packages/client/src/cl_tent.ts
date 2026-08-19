/**
 * File: cl_tent.ts
 * Source: Quake II original / client/cl_tent.c and client/client.h
 * Purpose: Port the persistent temporary-entity state used by client beams, explosions, lasers and sustains.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Stores model references as asset-path strings instead of renderer handles.
 * - Emits structured refresh-facing beam and explosion data instead of calling renderer entry points directly.
 * - Reads temp-entity packet bytes here, then applies them to persistent temp-entity state through structured packets.
 *
 * Notes:
 * - This file is intended to stay conceptually close to the original temp-entity pipeline.
 * - `cl_tent.ts` is the principal port target for `client/cl_tent.c`.
 * - `cl_newfx.ts` provides the helpers ported from `client/cl_newfx.c` reused by the temp-entity pipeline.
 * - `cl_fx.ts` stays focused on the routines ported from `client/cl_fx.c` and shared effect execution.
 * - `refresh.ts` only consumes the structured refresh output built here.
 */

import {
  AngleVectors,
  DirFromByte,
  MSG_ReadByte,
  MSG_ReadLong,
  MSG_ReadPos,
  MSG_ReadShort,
  RF_BEAM,
  RF_FULLBRIGHT,
  RF_TRANSLUCENT,
  UPDATE_MASK,
  temp_event_t,
  type vec3_t
} from "../../qcommon/src/index.js";
import type { ClientParseHooks, ClientParticleEffectPacket, ClientTempEntityPacket } from "./cl_parse.js";
import type { ClientDynamicLight } from "./refresh.js";
import type { ClientViewValues } from "./cl_view.js";
import { CL_ExecuteTempEntityEffects, CL_ParticleEffect } from "./cl_fx.js";
import { CL_Flashlight, CL_Heatbeam, CL_MonsterPlasma_Shell, CL_Nukeblast, CL_ParticleSteamEffect2, CL_Widowbeamout } from "./cl_newfx.js";
import {
  createClientBeam,
  createClientExplosion,
  createClientForceWall,
  createClientLaser,
  createClientSustain,
  createClientTempLight,
  type ClientRuntime,
  type client_beam_t,
  type client_explosion_t
} from "./client.js";

/**
 * Original name: N/A
 * Source: N/A (local asset aliases)
 * Category: New
 * Purpose: Keep temp-entity model and picture identifiers explicit while the renderer handles asset resolution.
 */
const MODEL_PARASITE_SEGMENT = "models/monsters/parasite/segment/tris.md2";
const MODEL_GRAPPLE_CABLE = "models/ctf/segment/tris.md2";
const MODEL_LIGHTNING = "models/proj/lightning/tris.md2";
const MODEL_HEATBEAM = "models/proj/beam/tris.md2";
const MODEL_MONSTER_HEATBEAM = "models/proj/widowbeam/tris.md2";
const MODEL_EXPLODE = "models/objects/explode/tris.md2";
const MODEL_SMOKE = "models/objects/smoke/tris.md2";
const MODEL_FLASH = "models/objects/flash/tris.md2";
const MODEL_EXPLO4 = "models/objects/r_explode/tris.md2";
const MODEL_EXPLO4_BIG = "models/objects/r_explode2/tris.md2";
const MODEL_BFG_EXPLO = "sprites/s_bfg2.sp2";
const MODEL_PARASITE_TIP = "models/monsters/parasite/tip/tris.md2";
const MODEL_POWERSCREEN = "models/items/armor/effect/tris.md2";
const MODEL_LASER = "models/objects/laser/tris.md2";
const MODEL_GRENADE2 = "models/objects/grenade2/tris.md2";
const MODEL_V_MACHN = "models/weapons/v_machn/tris.md2";
const MODEL_V_HANDGR = "models/weapons/v_handgr/tris.md2";
const MODEL_V_SHOTG2 = "models/weapons/v_shotg2/tris.md2";
const MODEL_GIB_BONE = "models/objects/gibs/bone/tris.md2";
const MODEL_GIB_SM_MEAT = "models/objects/gibs/sm_meat/tris.md2";
const MODEL_GIB_BONE2 = "models/objects/gibs/bone2/tris.md2";
const PIC_W_MACHINEGUN = "w_machinegun";
const PIC_A_BULLETS = "a_bullets";
const PIC_I_HEALTH = "i_health";
const PIC_A_GRENADES = "a_grenades";

/**
 * Original name: N/A
 * Source: N/A (refresh adapter contract)
 * Category: New
 * Purpose: Describe one refresh-facing persistent beam reconstructed from temp-entity state.
 *
 * Constraints:
 * - Must preserve beam endpoints, timeout family and model identity.
 */
export interface ClientBeamRender {
  kind: "beam" | "player-beam" | "laser";
  model: string | null;
  start: vec3_t;
  end: vec3_t;
  origin: vec3_t;
  angles: vec3_t;
  offset: vec3_t;
  endtime: number;
  entity: number;
  entity2: number;
  flags: number;
  alpha: number;
  skinnum: number;
  frame: number;
  segmentLength: number;
  pathLength: number;
  roll: number;
  specialLightningShort: boolean;
}

/**
 * Original name: N/A
 * Source: N/A (refresh adapter contract)
 * Category: New
 * Purpose: Describe one refresh-facing force-wall segment emitted from `TE_FORCEWALL`.
 *
 * Constraints:
 * - Must preserve endpoints and original color index.
 */
export interface ClientForceWallRender {
  start: vec3_t;
  end: vec3_t;
  color: number;
  endtime: number;
}

/**
 * Original name: N/A
 * Source: N/A (refresh adapter contract)
 * Category: New
 * Purpose: Describe one refresh-facing sustain effect emitted from `CL_ProcessSustain`.
 *
 * Constraints:
 * - Must preserve sustain family, timing and the main spatial parameters needed by later renderer adapters.
 */
export interface ClientSustainRender {
  kind: "steam" | "widow" | "nuke";
  origin: vec3_t;
  direction: vec3_t;
  color: number;
  count: number;
  magnitude: number;
  endtime: number;
  nextthink: number;
  radius: number;
  intensity: number;
}

/**
 * Original name: N/A
 * Source: N/A (refresh adapter contract)
 * Category: New
 * Purpose: Describe one refresh-facing persistent explosion reconstructed from temp-entity state.
 *
 * Constraints:
 * - Must preserve the current animation frame, model and alpha.
 */
export interface ClientExplosionRender {
  model: string;
  origin: vec3_t;
  angles: vec3_t;
  frame: number;
  oldframe: number;
  backlerp: number;
  alpha: number;
  flags: number;
  skinnum: number;
}

/**
 * Original name: N/A
 * Source: N/A (refresh adapter contract)
 * Category: New
 * Purpose: Group the refresh-facing temp-entity output ported from `CL_AddTEnts`.
 *
 * Constraints:
 * - Must keep beams, explosions and temp lights explicit for later renderer adapters.
 */
export interface ClientTEntRefresh {
  beams: ClientBeamRender[];
  explosions: ClientExplosionRender[];
  lights: ClientDynamicLight[];
  forceWalls: ClientForceWallRender[];
  sustains: ClientSustainRender[];
}

/**
 * Original name: CL_ClearTEnts
 * Source: client/cl_tent.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Clears all persistent temp-entity slot arrays.
 *
 * Porting notes:
 * - Reinitializes the per-family arrays in place using the local TS slot builders.
 */
export function CL_ClearTEnts(runtime: ClientRuntime): void {
  runtime.cl.tents.beams = Array.from({ length: runtime.cl.tents.beams.length }, () => createClientBeam());
  runtime.cl.tents.playerbeams = Array.from({ length: runtime.cl.tents.playerbeams.length }, () => createClientBeam());
  runtime.cl.tents.explosions = Array.from({ length: runtime.cl.tents.explosions.length }, () => createClientExplosion());
  runtime.cl.tents.lasers = Array.from({ length: runtime.cl.tents.lasers.length }, () => createClientLaser());
  runtime.cl.tents.sustains = Array.from({ length: runtime.cl.tents.sustains.length }, () => createClientSustain());
  runtime.cl.tents.tempLights = Array.from({ length: runtime.cl.tents.tempLights.length }, () => createClientTempLight());
  runtime.cl.tents.forceWalls = Array.from({ length: runtime.cl.tents.forceWalls.length }, () => createClientForceWall());
  runtime.cl.tents.registeredModels = [];
  runtime.cl.tents.registeredPics = [];
  runtime.cl.tents.registeredSounds = [];
}

/**
 * Original name: CL_RegisterTEntSounds
 * Source: client/cl_tent.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Registers the shared temporary-entity sound set used by impacts, footsteps and explosions.
 *
 * Porting notes:
 * - Stores normalized sound-path strings instead of backend sound handles.
 */
export function CL_RegisterTEntSounds(runtime: ClientRuntime): string[] {
  const registeredSounds = [
    "world/ric1.wav",
    "world/ric2.wav",
    "world/ric3.wav",
    "weapons/lashit.wav",
    "world/spark5.wav",
    "world/spark6.wav",
    "world/spark7.wav",
    "weapons/railgf1a.wav",
    "weapons/rocklx1a.wav",
    "weapons/grenlx1a.wav",
    "weapons/xpld_wat.wav",
    "player/land1.wav",
    "player/fall2.wav",
    "player/fall1.wav",
    "player/step1.wav",
    "player/step2.wav",
    "player/step3.wav",
    "player/step4.wav",
    "weapons/tesla.wav",
    "weapons/disrupthit.wav"
  ];

  runtime.cl.tents.registeredSounds = [...registeredSounds];
  return registeredSounds;
}

/**
 * Original name: CL_RegisterTEntModels
 * Source: client/cl_tent.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Registers the shared temporary-entity models and pictures used by impacts, explosions and weapon effects.
 *
 * Porting notes:
 * - Stores normalized asset-path strings and pic names instead of renderer handles.
 * - Preserves the original registration set and ordering from `cl_tent.c`.
 */
export function CL_RegisterTEntModels(runtime: ClientRuntime): { models: string[]; pics: string[] } {
  const registeredModels = [
    MODEL_EXPLODE,
    MODEL_SMOKE,
    MODEL_FLASH,
    MODEL_PARASITE_SEGMENT,
    MODEL_GRAPPLE_CABLE,
    MODEL_PARASITE_TIP,
    MODEL_EXPLO4,
    MODEL_BFG_EXPLO,
    MODEL_POWERSCREEN,
    MODEL_LASER,
    MODEL_GRENADE2,
    MODEL_V_MACHN,
    MODEL_V_HANDGR,
    MODEL_V_SHOTG2,
    MODEL_GIB_BONE,
    MODEL_GIB_SM_MEAT,
    MODEL_GIB_BONE2,
    MODEL_EXPLO4_BIG,
    MODEL_LIGHTNING,
    MODEL_HEATBEAM,
    MODEL_MONSTER_HEATBEAM
  ];
  const registeredPics = [
    PIC_W_MACHINEGUN,
    PIC_A_BULLETS,
    PIC_I_HEALTH,
    PIC_A_GRENADES
  ];

  runtime.cl.tents.registeredModels = [...registeredModels];
  runtime.cl.tents.registeredPics = [...registeredPics];
  return {
    models: registeredModels,
    pics: registeredPics
  };
}

/**
 * Original name: CL_ParseTEnt
 * Source: client/cl_tent.c
 * Category: Adapter
 * Fidelity level: Adapter
 *
 * Behavior:
 * - Applies one parsed temp-entity packet to the persistent client temp-entity state.
 *
 * Porting notes:
 * - Reuses the parsed packet representation produced by `CL_ParseTEnt`.
 * - Covers the persistent state families first: beams, player beams, lasers, explosions and sustains.
 * - `CL_ParseTEnt` now lives in this file; this adapter only applies parsed packet payloads to cl_tent state.
 */
export function CL_AddTEntPacket(runtime: ClientRuntime, packet: ClientTempEntityPacket): void {
  switch (packet.type) {
    case temp_event_t.TE_FLASHLIGHT:
      CL_Flashlight(runtime, packet.position ?? [0, 0, 0], packet.entity ?? 0);
      break;
    case temp_event_t.TE_GUNSHOT:
    case temp_event_t.TE_BULLET_SPARKS:
    case temp_event_t.TE_SHOTGUN:
      CL_SmokeAndFlash(runtime, packet.position ?? [0, 0, 0]);
      break;
    case temp_event_t.TE_PARASITE_ATTACK:
    case temp_event_t.TE_MEDIC_CABLE_ATTACK:
      assignBeam(runtime, runtime.cl.tents.beams, packet, MODEL_PARASITE_SEGMENT, runtime.cl.time + 200);
      break;
    case temp_event_t.TE_GRAPPLE_CABLE:
      assignBeam(runtime, runtime.cl.tents.beams, packet, MODEL_GRAPPLE_CABLE, runtime.cl.time + 200);
      break;
    case temp_event_t.TE_LIGHTNING:
      assignBeam(runtime, runtime.cl.tents.beams, packet, MODEL_LIGHTNING, runtime.cl.time + 200, true);
      break;
    case temp_event_t.TE_HEATBEAM:
      assignPlayerBeam(runtime, packet, MODEL_HEATBEAM, [2, 7, -3]);
      break;
    case temp_event_t.TE_MONSTER_HEATBEAM:
      assignPlayerBeam(runtime, packet, MODEL_HEATBEAM, [0, 0, 0]);
      break;
    case temp_event_t.TE_BFG_LASER:
      assignLaser(runtime, packet, 0xd0d1d2d3);
      break;
    case temp_event_t.TE_FORCEWALL:
      assignForceWall(runtime, packet);
      break;
    case temp_event_t.TE_BLASTER:
      allocateExplosion(runtime, createImpactExplosion(packet, [1, 1, 0], 0));
      break;
    case temp_event_t.TE_BLASTER2:
      allocateExplosion(runtime, createImpactExplosion(packet, [0, 1, 0], 1));
      break;
    case temp_event_t.TE_FLECHETTE:
      allocateExplosion(runtime, createImpactExplosion(packet, [0.19, 0.41, 0.75], 2));
      break;
    case temp_event_t.TE_EXPLOSION1:
    case temp_event_t.TE_ROCKET_EXPLOSION:
    case temp_event_t.TE_ROCKET_EXPLOSION_WATER:
    case temp_event_t.TE_EXPLOSION2:
    case temp_event_t.TE_GRENADE_EXPLOSION:
    case temp_event_t.TE_GRENADE_EXPLOSION_WATER:
    case temp_event_t.TE_PLASMA_EXPLOSION:
    case temp_event_t.TE_EXPLOSION1_BIG:
    case temp_event_t.TE_EXPLOSION1_NP:
    case temp_event_t.TE_PLAIN_EXPLOSION:
      allocateExplosion(runtime, {
        type: "poly",
        ent: {
          model: packet.type === temp_event_t.TE_EXPLOSION1_BIG ? MODEL_EXPLO4_BIG : MODEL_EXPLO4,
          origin: [...(packet.position ?? [0, 0, 0])],
          oldorigin: [0, 0, 0],
          angles: [0, randomAngleDegrees(), 0],
          frame: 0,
          oldframe: 0,
          backlerp: 0,
          flags: RF_FULLBRIGHT,
          alpha: 1,
          skinnum: 0
        },
        frames:
          packet.type === temp_event_t.TE_EXPLOSION2 ||
          packet.type === temp_event_t.TE_GRENADE_EXPLOSION ||
          packet.type === temp_event_t.TE_GRENADE_EXPLOSION_WATER
            ? 19
            : 15,
        light: 350,
        lightcolor: [1, 0.5, 0.5],
        start: runtime.cl.frame.servertime - 100,
        baseframe:
          packet.type === temp_event_t.TE_EXPLOSION2 ||
          packet.type === temp_event_t.TE_GRENADE_EXPLOSION ||
          packet.type === temp_event_t.TE_GRENADE_EXPLOSION_WATER
            ? 30
            : randomExplosionBaseframe(packet.type),
      });
      break;
    case temp_event_t.TE_BFG_EXPLOSION:
      allocateExplosion(runtime, {
        type: "poly",
        ent: {
          model: MODEL_BFG_EXPLO,
          origin: [...(packet.position ?? [0, 0, 0])],
          oldorigin: [0, 0, 0],
          angles: [0, 0, 0],
          frame: 0,
          oldframe: 0,
          backlerp: 0,
          flags: RF_FULLBRIGHT | RF_TRANSLUCENT,
          alpha: 0.3,
          skinnum: 0
        },
        frames: 4,
        light: 350,
        lightcolor: [0, 1, 0],
        start: runtime.cl.frame.servertime - 100,
        baseframe: 0
      });
      break;
    case temp_event_t.TE_WELDING_SPARKS:
      allocateExplosion(runtime, {
        type: "flash",
        ent: {
          model: MODEL_FLASH,
          origin: [...(packet.position ?? [0, 0, 0])],
          oldorigin: [0, 0, 0],
          angles: [0, 0, 0],
          frame: 0,
          oldframe: 0,
          backlerp: 0,
          flags: RF_BEAM,
          alpha: 1,
          skinnum: 0
        },
        frames: 2,
        light: 100 + Math.floor(Math.random() * 75),
        lightcolor: [1, 1, 0.3],
        start: runtime.cl.frame.servertime,
        baseframe: 0
      });
      break;
    case temp_event_t.TE_STEAM:
      assignSteamSustain(runtime, packet);
      break;
    case temp_event_t.TE_WIDOWBEAMOUT:
      assignTimedSustain(runtime, packet, "widow", packet.id ?? 0, 2100, 1);
      break;
    case temp_event_t.TE_NUKEBLAST:
      assignTimedSustain(runtime, packet, "nuke", 21000, 1000, 1);
      break;
    default:
      break;
  }
}

/**
 * Original name: CL_AddTEnts
 * Source: client/cl_tent.c
 * Category: Adapter
 * Fidelity level: Adapter
 *
 * Behavior:
 * - Builds refresh-facing temp-entity output from persistent temp state.
 *
 * Porting notes:
 * - Emits structured beams, explosions and dynamic lights instead of renderer calls.
 * - Executes sustain thinkers before returning renderer-facing sustain descriptors.
 * - The public original-name wrapper is `CL_AddTEnts`; this helper exposes the structured refresh contract.
 */
export function CL_BuildTEntRefresh(runtime: ClientRuntime): ClientTEntRefresh {
  const beams = [
    ...CL_AddBeams(runtime),
    ...CL_AddPlayerBeams(runtime),
    ...CL_AddLasers(runtime)
  ];
  const { explosions, lights } = CL_AddExplosions(runtime);
  const tempLights = buildTempLights(runtime);
  const forceWalls = buildForceWalls(runtime);
  const sustains = CL_ProcessSustain(runtime);

  return {
    beams,
    explosions,
    lights: [...lights, ...tempLights],
    forceWalls,
    sustains
  };
}

/**
 * Original name: CL_AddTEnts
 * Source: client/cl_tent.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Rebuilds the current refresh-facing temp-entity output from persistent temp state.
 */
export function CL_AddTEnts(runtime: ClientRuntime): ClientTEntRefresh {
  return CL_BuildTEntRefresh(runtime);
}

/**
 * Original name: N/A
 * Source: N/A (local refresh helper)
 * Category: New
 * Purpose: Convert one active beam-family slot array into refresh-facing beam records.
 */
function buildBeams(
  runtime: ClientRuntime,
  slots: client_beam_t[],
  now: number,
  kind: "beam" | "player-beam"
): ClientBeamRender[] {
  return slots
    .filter((slot) => slot.model !== null && slot.endtime >= now)
    .map((slot) => createBeamRender(runtime, slot, kind));
}

/**
 * Original name: CL_AddBeams
 * Source: client/cl_tent.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Rebuilds active beam slots into refresh-facing beam render records.
 */
export function CL_AddBeams(runtime: ClientRuntime): ClientBeamRender[] {
  return buildBeams(runtime, runtime.cl.tents.beams, runtime.cl.time, "beam");
}

/**
 * Original name: N/A
 * Source: N/A (local refresh helper)
 * Category: New
 * Fidelity level: Close
 *
 * Behavior:
 * - Rebuilds player-linked beams, especially heatbeam, using the current logical view and gun offsets.
 *
 * Porting notes:
 * - Captures the locked beam origin/orientation and segment sizing for later renderer adapters.
 * - Uses the original `hand->value` multiplier semantics exposed in the client runtime.
 */
function buildPlayerBeams(runtime: ClientRuntime): ClientBeamRender[] {
  const results: ClientBeamRender[] = [];
  const view = buildCurrentView(runtime);
  const handMultiplier = getHandMultiplier(runtime);

  for (const slot of runtime.cl.tents.playerbeams) {
    if (slot.model === null || slot.endtime < runtime.cl.time) {
      continue;
    }

    if (slot.model === MODEL_HEATBEAM) {
      results.push(createHeatbeamRender(runtime, slot, view, handMultiplier));
      continue;
    }

    results.push(createBeamRender(runtime, slot, "player-beam"));
  }

  return results;
}

/**
 * Original name: CL_AddPlayerBeams
 * Source: client/cl_tent.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Rebuilds player-linked beams, including heatbeam-specific particle side effects.
 */
export function CL_AddPlayerBeams(runtime: ClientRuntime): ClientBeamRender[] {
  return buildPlayerBeams(runtime);
}

/**
 * Original name: N/A
 * Source: N/A (local refresh helper)
 * Category: New
 * Purpose: Convert active laser slots into refresh-facing beam records.
 */
function buildLasers(runtime: ClientRuntime): ClientBeamRender[] {
  return runtime.cl.tents.lasers
    .filter((slot) => slot.endtime >= runtime.cl.time)
    .map((slot) => ({
      kind: "laser",
      model: null,
      start: [...slot.start],
      end: [...slot.end],
      origin: [...slot.start],
      angles: calculateBeamAngles(subtractVec3(slot.end, slot.start), false),
      offset: [0, 0, 0],
      endtime: slot.endtime,
      entity: 0,
      entity2: 0,
      flags: slot.flags,
      alpha: slot.alpha,
      skinnum: slot.skinnum,
      frame: slot.frame,
      segmentLength: 30,
      pathLength: vectorLength(subtractVec3(slot.end, slot.start)),
      roll: 0,
      specialLightningShort: false
    }));
}

/**
 * Original name: CL_AddLasers
 * Source: client/cl_tent.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Rebuilds active transient laser slots into refresh-facing beam records.
 */
export function CL_AddLasers(runtime: ClientRuntime): ClientBeamRender[] {
  return buildLasers(runtime);
}

/**
 * Original name: N/A
 * Source: N/A (local refresh helper)
 * Category: New
 * Fidelity level: Close
 *
 * Behavior:
 * - Advances active explosion slots and emits their current render frame plus dynamic light.
 */
function buildExplosions(runtime: ClientRuntime): { explosions: ClientExplosionRender[]; lights: ClientDynamicLight[] } {
  const explosions: ClientExplosionRender[] = [];
  const lights: ClientDynamicLight[] = [];

  for (const slot of runtime.cl.tents.explosions) {
    if (slot.type === "free" || slot.ent.model === null) {
      continue;
    }

    const frac = (runtime.cl.time - slot.start) / 100;
    let frameIndex = Math.floor(frac);
    let alpha = slot.ent.alpha;
    let flags = slot.ent.flags;
    let skinnum = slot.ent.skinnum;

    if (!updateExplosionForFrame(slot, frameIndex)) {
      resetExplosion(slot);
      continue;
    }

    switch (slot.type) {
      case "mflash":
        break;
      case "misc":
        alpha = 1 - frac / Math.max(1, slot.frames - 1);
        break;
      case "flash":
        alpha = 1;
        break;
      case "poly":
        alpha = (16 - frameIndex) / 16;
        if (frameIndex < 10) {
          skinnum = Math.max(0, frameIndex >> 1);
        } else {
          flags |= RF_TRANSLUCENT;
          skinnum = frameIndex < 13 ? 5 : 6;
        }
        break;
      case "poly2":
        alpha = (5 - frameIndex) / 5;
        flags |= RF_TRANSLUCENT;
        skinnum = 0;
        break;
      default:
        break;
    }

    if (slot.light !== 0) {
      lights.push({
        origin: [...slot.ent.origin],
        intensity: slot.light * alpha,
        color: [...slot.lightcolor],
        sourceEntity: 0,
        kind: "temp-explosion"
      });
    }

    if (frameIndex < 0) {
      frameIndex = 0;
    }

    explosions.push({
      model: slot.ent.model,
      origin: [...slot.ent.origin],
      angles: [...slot.ent.angles],
      frame: slot.baseframe + frameIndex + 1,
      oldframe: slot.baseframe + frameIndex,
      backlerp: 1 - runtime.cl.lerpfrac,
      alpha,
      flags,
      skinnum
    });
  }

  return { explosions, lights };
}

/**
 * Original name: CL_AddExplosions
 * Source: client/cl_tent.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Advances active explosion slots and rebuilds their current render/light output.
 */
export function CL_AddExplosions(runtime: ClientRuntime): {
  explosions: ClientExplosionRender[];
  lights: ClientDynamicLight[];
} {
  return buildExplosions(runtime);
}

/**
 * Original name: N/A
 * Source: N/A (local refresh helper)
 * Category: New
 * Purpose: Convert active transient temp lights into refresh-facing dynamic lights.
 */
function buildTempLights(runtime: ClientRuntime): ClientDynamicLight[] {
  return runtime.cl.tents.tempLights
    .filter((slot) => slot.endtime >= runtime.cl.time)
    .map((slot) => ({
      origin: [...slot.origin],
      intensity: slot.intensity,
      color: [...slot.color],
      sourceEntity: slot.entity,
      kind: slot.kind
    }));
}

/**
 * Original name: N/A
 * Source: N/A (local refresh helper)
 * Category: New
 * Purpose: Convert active force-wall slots into refresh-facing segment records.
 */
function buildForceWalls(runtime: ClientRuntime): ClientForceWallRender[] {
  return runtime.cl.tents.forceWalls
    .filter((slot) => slot.endtime >= runtime.cl.time)
    .map((slot) => ({
      start: [...slot.start],
      end: [...slot.end],
      color: slot.color,
      endtime: slot.endtime
    }));
}

/**
 * Original name: N/A
 * Source: N/A (local refresh helper)
 * Category: New
 * Purpose: Build a generic beam render record from one active beam slot.
 */
function createBeamRender(runtime: ClientRuntime, slot: client_beam_t, kind: "beam" | "player-beam"): ClientBeamRender {
  const start = [...slot.start] as vec3_t;
  if (kind === "beam" && slot.entity === runtime.cl.playernum + 1) {
    const view = buildCurrentView(runtime);
    start[0] = view.vieworg[0];
    start[1] = view.vieworg[1];
    start[2] = view.vieworg[2] - 22;
  }

  const origin = addVec3(start, slot.offset);
  const dist = subtractVec3(slot.end, origin);
  let pathLength = vectorLength(dist);
  let angles = calculateBeamAngles(dist, slot.model === MODEL_LIGHTNING);
  let specialLightningShort = false;

  if (slot.model === MODEL_LIGHTNING) {
    pathLength -= 20;
    if (pathLength <= 35) {
      specialLightningShort = true;
      angles = calculateBeamAngles(dist, false);
    }
  }

  return {
    kind,
    model: slot.model,
    start,
    end: [...slot.end],
    origin,
    angles,
    offset: [...slot.offset],
    endtime: slot.endtime,
    entity: slot.entity,
    entity2: slot.dest_entity,
    flags:
      slot.model === MODEL_LIGHTNING
        ? RF_FULLBRIGHT
        : kind === "player-beam" && slot.model === MODEL_HEATBEAM
          ? RF_FULLBRIGHT
          : 0,
    alpha: 1,
    skinnum: 0,
    frame: 0,
    segmentLength: slot.model === MODEL_LIGHTNING ? 35 : 30,
    pathLength,
    roll: randomAngleDegrees(),
    specialLightningShort
  };
}

/**
 * Original name: N/A
 * Source: N/A (local refresh helper)
 * Category: New
 * Purpose: Rebuild one heatbeam render record using the current logical view and gun-offset path.
 */
function createHeatbeamRender(
  runtime: ClientRuntime,
  slot: client_beam_t,
  view: ClientViewValues,
  handMultiplier: number
): ClientBeamRender {
  let start = [...slot.start] as vec3_t;
  let origin = [...slot.start] as vec3_t;
  let direction = subtractVec3(slot.end, origin);
  let framenum = 1;

  if (slot.entity === runtime.cl.playernum + 1) {
    start = computePlayerBeamGunStart(runtime, view);
    origin = addScaledVec3(start, view.right, handMultiplier * slot.offset[0]);
    origin = addScaledVec3(origin, view.forward, slot.offset[1]);
    origin = addScaledVec3(origin, view.up, slot.offset[2]);
    if (runtime.cl.hand === 2) {
      origin = addScaledVec3(origin, view.up, -1);
    }

    const dist = subtractVec3(slot.end, origin);
    const length = vectorLength(dist);
    direction = scaleVec3(view.forward, length);
    direction = addScaledVec3(direction, view.right, handMultiplier * slot.offset[0]);
    direction = addScaledVec3(direction, view.forward, slot.offset[1]);
    direction = addScaledVec3(direction, view.up, slot.offset[2]);
    if (runtime.cl.hand === 2) {
      origin = addScaledVec3(origin, view.up, -1);
    }

    CL_Heatbeam(runtime, origin, direction, view.right, view.up);
  } else {
    framenum = 2;
    const baseAngles = calculateBeamAngles(direction, true);
    const vectors = AngleVectors([baseAngles[0], baseAngles[1], 0]);

    if (!isZeroVec3(slot.offset)) {
      origin = addScaledVec3(origin, vectors.right, -slot.offset[0] + 1);
      origin = addScaledVec3(origin, vectors.forward, -slot.offset[1]);
      origin = addScaledVec3(origin, vectors.up, -slot.offset[2] - 10);
    } else {
      CL_MonsterPlasma_Shell(runtime, slot.start);
    }
  }

  const pathLength = vectorLength(direction);

  return {
    kind: "player-beam",
    model: slot.model,
    start,
    end: [...slot.end],
    origin,
    angles: calculateBeamAngles(direction, true),
    offset: [...slot.offset],
    endtime: slot.endtime,
    entity: slot.entity,
    entity2: slot.dest_entity,
    flags: RF_FULLBRIGHT,
    alpha: 1,
    skinnum: 0,
    frame: framenum,
    segmentLength: 32,
    pathLength,
    roll: slot.entity === runtime.cl.playernum + 1 ? runtime.cl.time % 360 : 0,
    specialLightningShort: false
  };
}

/**
 * Original name: N/A
 * Source: N/A (local refresh helper)
 * Category: New
 * Purpose: Build the current logical view values needed by player-beam reconstruction.
 */
function buildCurrentView(runtime: ClientRuntime): ClientViewValues {
  const ps = runtime.cl.frame.playerstate;
  let oldframe = runtime.cl.frames[(runtime.cl.frame.serverframe - 1) & UPDATE_MASK];
  if (oldframe.serverframe !== runtime.cl.frame.serverframe - 1 || !oldframe.valid) {
    oldframe = runtime.cl.frame;
  }

  const ops = oldframe.playerstate;
  const vieworg: vec3_t = [0, 0, 0];
  for (let index = 0; index < 3; index += 1) {
    vieworg[index] =
      runtime.cl.predicted_origin[index] +
      ops.viewoffset[index] +
      runtime.cl.lerpfrac * (ps.viewoffset[index] - ops.viewoffset[index]);
  }

  const viewangles = [...runtime.cl.predicted_angles] as vec3_t;
  const vectors = AngleVectors(viewangles);

  return {
    vieworg,
    viewangles,
    forward: vectors.forward,
    right: vectors.right,
    up: vectors.up,
    fov_x: ops.fov + runtime.cl.lerpfrac * (ps.fov - ops.fov),
    blend: [...ps.blend]
  };
}

/**
 * Original name: N/A
 * Source: N/A (local refresh helper)
 * Category: New
 * Purpose: Rebuild the player beam gun start from the current and previous player gun offsets.
 */
function computePlayerBeamGunStart(runtime: ClientRuntime, view: ClientViewValues): vec3_t {
  const ps = runtime.cl.frame.playerstate;
  let oldframe = runtime.cl.frames[(runtime.cl.frame.serverframe - 1) & UPDATE_MASK];
  if (oldframe.serverframe !== runtime.cl.frame.serverframe - 1 || !oldframe.valid) {
    oldframe = runtime.cl.frame;
  }

  const ops = oldframe.playerstate;
  const gunStart: vec3_t = [0, 0, 0];
  for (let index = 0; index < 3; index += 1) {
    gunStart[index] =
      view.vieworg[index] +
      ops.gunoffset[index] +
      runtime.cl.lerpfrac * (ps.gunoffset[index] - ops.gunoffset[index]);
  }

  return gunStart;
}

/**
 * Original name: N/A
 * Source: N/A (local refresh helper)
 * Category: New
 * Purpose: Convert the `hand` cvar value into the original beam-side multiplier.
 */
function getHandMultiplier(runtime: ClientRuntime): number {
  if (runtime.cl.hand === 2) {
    return 0;
  }
  if (runtime.cl.hand === 1) {
    return -1;
  }
  return 1;
}

/**
 * Original name: N/A
 * Source: N/A (local refresh helper)
 * Category: New
 * Purpose: Convert one beam direction vector into Quake-style beam angles.
 */
function calculateBeamAngles(dist: vec3_t, lightningStyle: boolean): vec3_t {
  if (dist[1] === 0 && dist[0] === 0) {
    return dist[2] > 0 ? [lightningStyle ? -90 : 90, lightningStyle ? 180 : 0, 0] : [lightningStyle ? -270 : 270, lightningStyle ? 180 : 0, 0];
  }

  let yaw: number;
  if (dist[0] !== 0) {
    yaw = Math.atan2(dist[1], dist[0]) * 180 / Math.PI;
  } else if (dist[1] > 0) {
    yaw = 90;
  } else {
    yaw = 270;
  }
  if (yaw < 0) {
    yaw += 360;
  }

  const forward = Math.sqrt(dist[0] * dist[0] + dist[1] * dist[1]);
  let pitch = Math.atan2(dist[2], forward) * -180 / Math.PI;
  if (pitch < 0) {
    pitch += 360;
  }

  if (lightningStyle) {
    return [-pitch, yaw + 180, 0];
  }

  return [pitch, yaw, 0];
}

/**
 * Original name: N/A
 * Source: N/A (local refresh helper)
 * Category: New
 * Purpose: Subtract one vector from another by value.
 */
function subtractVec3(a: vec3_t, b: vec3_t): vec3_t {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/**
 * Original name: N/A
 * Source: N/A (local refresh helper)
 * Category: New
 * Purpose: Add two vectors by value.
 */
function addVec3(a: vec3_t, b: vec3_t): vec3_t {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/**
 * Original name: N/A
 * Source: N/A (local refresh helper)
 * Category: New
 * Purpose: Test whether a vector matches the zero vector exactly.
 */
function isZeroVec3(vector: vec3_t): boolean {
  return vector[0] === 0 && vector[1] === 0 && vector[2] === 0;
}

/**
 * Original name: N/A
 * Source: N/A (local refresh helper)
 * Category: New
 * Purpose: Scale one vector by a scalar by value.
 */
function scaleVec3(vector: vec3_t, scalar: number): vec3_t {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar];
}

/**
 * Original name: N/A
 * Source: N/A (local refresh helper)
 * Category: New
 * Purpose: Add one scaled direction vector to a base vector by value.
 */
function addScaledVec3(base: vec3_t, direction: vec3_t, scalar: number): vec3_t {
  return [
    base[0] + direction[0] * scalar,
    base[1] + direction[1] * scalar,
    base[2] + direction[2] * scalar
  ];
}

/**
 * Original name: N/A
 * Source: N/A (local refresh helper)
 * Category: New
 * Purpose: Compute the Euclidean length of one vector.
 */
function vectorLength(vector: vec3_t): number {
  return Math.sqrt(vector[0] * vector[0] + vector[1] * vector[1] + vector[2] * vector[2]);
}

/**
 * Original name: N/A
 * Source: N/A (local sustain helper)
 * Category: New
 * Fidelity level: Close
 *
 * Behavior:
 * - Advances active sustain timers and emits refresh-facing sustain descriptors when their thinker would run.
 *
 * Porting notes:
 * - Produces structured sustain records instead of particles.
 * - Preserves expiry and `nextthink` stepping semantics from the original loop.
 */
function buildSustains(runtime: ClientRuntime): ClientSustainRender[] {
  const results: ClientSustainRender[] = [];

  for (const sustain of runtime.cl.tents.sustains) {
    if (sustain.id === 0) {
      continue;
    }

    if (sustain.endtime < runtime.cl.time) {
      resetSustain(sustain);
      continue;
    }

    if (runtime.cl.time < sustain.nextthink) {
      continue;
    }

    const render = runSustainThinker(runtime, sustain);
    if (render) {
      results.push(render);
    }
  }

  return results;
}

/**
 * Original name: CL_ProcessSustain
 * Source: client/cl_tent.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Advances active sustain timers and returns the renderer-facing sustains produced this frame.
 */
export function CL_ProcessSustain(runtime: ClientRuntime): ClientSustainRender[] {
  return buildSustains(runtime);
}

/**
 * Original name: N/A
 * Source: N/A (local sustain helper)
 * Category: New
 * Purpose: Execute the renderer-side equivalent of the active sustain thinker for the current frame.
 *
 * Constraints:
 * - Must preserve the original `nextthink` mutation rules per thinker.
 */
function runSustainThinker(
  runtime: ClientRuntime,
  sustain: ClientRuntime["cl"]["tents"]["sustains"][number]
): ClientSustainRender | null {
  switch (sustain.thinker) {
    case "CL_ParticleSteamEffect2":
      CL_ParticleSteamEffect2(runtime, sustain);
      return buildSustainRender(runtime, sustain);
    case "CL_Widowbeamout":
      CL_Widowbeamout(runtime, sustain);
      return buildSustainRender(runtime, sustain);
    case "CL_Nukeblast":
      CL_Nukeblast(runtime, sustain);
      return buildSustainRender(runtime, sustain);
    default:
      return null;
  }
}

/**
 * Original name: N/A
 * Source: N/A (local sustain helper)
 * Category: New
 * Purpose: Convert one active sustain slot into a renderer-facing descriptor after thinker execution.
 */
function buildSustainRender(runtime: ClientRuntime, sustain: ClientRuntime["cl"]["tents"]["sustains"][number]): ClientSustainRender | null {
  switch (sustain.type) {
    case "steam":
      return {
        kind: "steam",
        origin: [...sustain.org],
        direction: [...sustain.dir],
        color: sustain.color,
        count: sustain.count,
        magnitude: sustain.magnitude,
        endtime: sustain.endtime,
        nextthink: sustain.nextthink,
        radius: Math.max(8, sustain.magnitude * 0.35),
        intensity: Math.max(40, sustain.count * 6)
      };
    case "widow": {
      const ratio = 1 - ((sustain.endtime - runtime.cl.time) / 2100);
      return {
        kind: "widow",
        origin: [...sustain.org],
        direction: [0, 0, 1],
        color: 16,
        count: 300,
        magnitude: 45 * Math.max(0, ratio),
        endtime: sustain.endtime,
        nextthink: sustain.nextthink,
        radius: 45 * Math.max(0, ratio),
        intensity: 160
      };
    }
    case "nuke": {
      const ratio = 1 - ((sustain.endtime - runtime.cl.time) / 1000);
      return {
        kind: "nuke",
        origin: [...sustain.org],
        direction: [0, 0, 1],
        color: 110,
        count: 700,
        magnitude: 200 * Math.max(0, ratio),
        endtime: sustain.endtime,
        nextthink: sustain.nextthink,
        radius: 200 * Math.max(0, ratio),
        intensity: 300
      };
    }
    default:
      return null;
  }
}

/**
 * Original name: N/A
 * Source: N/A (local temp-entity helper)
 * Category: New
 * Purpose: Recreate the common `TE_BLASTER*` explosion payloads.
 */
function createImpactExplosion(
  packet: ClientTempEntityPacket,
  lightcolor: [number, number, number],
  skinnum: number
): client_explosion_t {
  return {
    type: "misc",
    ent: {
      model: MODEL_EXPLODE,
      origin: [...(packet.position ?? [0, 0, 0])],
      oldorigin: [0, 0, 0],
      angles: directionByteToImpactAngles(packet.directionByte),
      frame: 0,
      oldframe: 0,
      backlerp: 0,
      flags: RF_FULLBRIGHT | RF_TRANSLUCENT,
      alpha: 1,
      skinnum
    },
    frames: 4,
    light: 150,
    lightcolor,
    start: 0,
    baseframe: 0
  };
}

/**
 * Original name: CL_SmokeAndFlash
 * Source: client/cl_tent.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns the paired smoke and flash temp explosions used by bullet impact temp entities.
 *
 * Porting notes:
 * - Reuses the persistent explosion slot pool instead of immediate renderer entities.
 */
export function CL_SmokeAndFlash(runtime: ClientRuntime, origin: vec3_t): void {
  allocateExplosion(runtime, {
    type: "misc",
    ent: {
      model: MODEL_SMOKE,
      origin: [...origin],
      oldorigin: [0, 0, 0],
      angles: [0, 0, 0],
      frame: 0,
      oldframe: 0,
      backlerp: 0,
      flags: RF_TRANSLUCENT,
      alpha: 0,
      skinnum: 0
    },
    frames: 4,
    light: 0,
    lightcolor: [0, 0, 0],
    start: runtime.cl.frame.servertime - 100,
    baseframe: 0
  });

  allocateExplosion(runtime, {
    type: "flash",
    ent: {
      model: MODEL_FLASH,
      origin: [...origin],
      oldorigin: [0, 0, 0],
      angles: [0, 0, 0],
      frame: 0,
      oldframe: 0,
      backlerp: 0,
      flags: RF_FULLBRIGHT,
      alpha: 0,
      skinnum: 0
    },
    frames: 2,
    light: 0,
    lightcolor: [0, 0, 0],
    start: runtime.cl.frame.servertime - 100,
    baseframe: 0
  });
}

/**
 * Original name: N/A
 * Source: N/A (local temp-entity helper)
 * Category: New
 * Purpose: Assign one parsed beam packet into the chosen fixed-size slot array.
 */
function assignBeam(
  runtime: ClientRuntime,
  slots: client_beam_t[],
  packet: ClientTempEntityPacket,
  model: string,
  endtime: number,
  matchByDestination = false
): void {
  const entity = packet.entity ?? 0;
  const entity2 = packet.entity2 ?? 0;

  let slot = slots.find((candidate) =>
    matchByDestination
      ? candidate.entity === entity && candidate.dest_entity === entity2
      : candidate.entity === entity
  );
  if (!slot) {
    slot = slots.find((candidate) => candidate.model === null || candidate.endtime < runtime.cl.time);
  }

  if (!slot) {
    return;
  }

  slot.entity = entity;
  slot.dest_entity = entity2;
  slot.model = model;
  slot.endtime = endtime;
  slot.start = [...(packet.position ?? [0, 0, 0])];
  slot.end = [...(packet.position2 ?? [0, 0, 0])];
  slot.offset = [...(packet.offset ?? [0, 0, 0])];
}

/**
 * Original name: N/A
 * Source: N/A (local temp-entity helper)
 * Category: New
 * Purpose: Assign one parsed player beam packet into the dedicated player-beam array.
 */
function assignPlayerBeam(
  runtime: ClientRuntime,
  packet: ClientTempEntityPacket,
  model: string,
  defaultOffset: vec3_t
): void {
  const entity = packet.entity ?? 0;
  const existing = runtime.cl.tents.playerbeams.find((candidate) => candidate.entity === entity);
  if (!existing && !runtime.cl.tents.playerbeams.some((candidate) => candidate.model === null || candidate.endtime < runtime.cl.time)) {
    return;
  }

  assignBeam(
    runtime,
    runtime.cl.tents.playerbeams,
    {
      ...packet,
      offset: packet.offset ?? defaultOffset
    },
    model,
    existing ? runtime.cl.time + 200 : runtime.cl.time + 100
  );
}

/**
 * Original name: N/A
 * Source: N/A (local temp-entity helper)
 * Category: New
 * Purpose: Assign one parsed laser packet into the fixed-size laser array.
 */
function assignLaser(runtime: ClientRuntime, packet: ClientTempEntityPacket, colors: number): void {
  const slot = runtime.cl.tents.lasers.find((candidate) => candidate.endtime < runtime.cl.time);
  if (!slot) {
    return;
  }

  slot.start = [...(packet.position ?? [0, 0, 0])];
  slot.end = [...(packet.position2 ?? [0, 0, 0])];
  slot.endtime = runtime.cl.time + 100;
  slot.flags = RF_TRANSLUCENT | RF_BEAM;
  slot.alpha = 0.3;
  slot.skinnum = (colors >> ((Math.floor(Math.random() * 0x7fffffff) % 4) * 8)) & 0xff;
  slot.frame = 4;
}

/**
 * Original name: N/A
 * Source: N/A (local temp-entity helper)
 * Category: New
 * Purpose: Recreate `CL_ForceWall` as a transient segment effect.
 */
function assignForceWall(runtime: ClientRuntime, packet: ClientTempEntityPacket): void {
  const slot =
    runtime.cl.tents.forceWalls.find((candidate) => candidate.endtime < runtime.cl.time) ??
    runtime.cl.tents.forceWalls[0];

  slot.start = [...(packet.position ?? [0, 0, 0])];
  slot.end = [...(packet.position2 ?? [0, 0, 0])];
  slot.color = packet.color ?? 0;
  slot.endtime = runtime.cl.time + 1000;
}

/**
 * Original name: N/A
 * Source: N/A (local temp-entity helper)
 * Category: New
 * Purpose: Assign one parsed steam sustain packet when it represents a persistent sustain.
 */
function assignSteamSustain(runtime: ClientRuntime, packet: ClientTempEntityPacket): void {
  if (packet.id === undefined || packet.id === -1) {
    return;
  }

  const slot = runtime.cl.tents.sustains.find((candidate) => candidate.id === 0);
  if (!slot) {
    return;
  }
  slot.id = packet.id;
  slot.type = "steam";
  slot.thinker = "CL_ParticleSteamEffect2";
  slot.endtime = runtime.cl.time + (packet.durationMs ?? 0);
  slot.nextthink = runtime.cl.time;
  slot.thinkinterval = 100;
  slot.org = [...(packet.position ?? [0, 0, 0])];
  slot.dir = directionByteToVector(packet.directionByte);
  slot.color = packet.color ?? 0;
  slot.count = packet.count ?? 0;
  slot.magnitude = packet.magnitude ?? 0;
}

/**
 * Original name: N/A
 * Source: N/A (local temp-entity helper)
 * Category: New
 * Purpose: Assign one parsed timed sustain packet such as widow beam out or nuke blast.
 */
function assignTimedSustain(
  runtime: ClientRuntime,
  packet: ClientTempEntityPacket,
  type: "widow" | "nuke",
  id: number,
  durationMs: number,
  thinkinterval: number
): void {
  const slot = runtime.cl.tents.sustains.find((candidate) => candidate.id === 0);
  if (!slot) {
    return;
  }
  slot.id = id;
  slot.type = type;
  slot.thinker = type === "widow" ? "CL_Widowbeamout" : "CL_Nukeblast";
  slot.endtime = runtime.cl.time + durationMs;
  slot.nextthink = runtime.cl.time;
  slot.thinkinterval = thinkinterval;
  slot.org = [...(packet.position ?? [0, 0, 0])];
}

/**
 * Original name: N/A
 * Source: N/A (local temp-entity helper)
 * Category: New
 * Purpose: Allocate or recycle one explosion slot and fill it with normalized explosion data.
 */
function allocateExplosion(runtime: ClientRuntime, value: client_explosion_t): void {
  const slot = CL_AllocExplosion(runtime);

  slot.type = value.type;
  slot.ent.model = value.ent.model;
  slot.ent.origin = [...value.ent.origin];
  slot.ent.oldorigin = [...value.ent.oldorigin];
  slot.ent.angles = [...value.ent.angles];
  slot.ent.frame = value.ent.frame;
  slot.ent.oldframe = value.ent.oldframe;
  slot.ent.backlerp = value.ent.backlerp;
  slot.ent.flags = value.ent.flags;
  slot.ent.alpha = value.ent.alpha;
  slot.ent.skinnum = value.ent.skinnum;
  slot.frames = value.frames;
  slot.light = value.light;
  slot.lightcolor = [...value.lightcolor];
  slot.start = value.start;
  slot.baseframe = value.baseframe;
}

/**
 * Original name: CL_AllocExplosion
 * Source: client/cl_tent.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns a free explosion slot or recycles the oldest one by `start`.
 *
 * Porting notes:
 * - Preserves the original two-pass search and zero-reset semantics.
 */
function CL_AllocExplosion(runtime: ClientRuntime): client_explosion_t {
  for (const explosion of runtime.cl.tents.explosions) {
    if (explosion.type === "free") {
      resetExplosion(explosion);
      return explosion;
    }
  }

  let time = runtime.cl.time;
  let oldest = runtime.cl.tents.explosions[0];
  for (const explosion of runtime.cl.tents.explosions) {
    if (explosion.start < time) {
      time = explosion.start;
      oldest = explosion;
    }
  }

  resetExplosion(oldest);
  return oldest;
}

/**
 * Original name: N/A
 * Source: N/A (local explosion helper)
 * Category: New
 * Purpose: Decide whether one explosion slot stays active for the current frame.
 */
function updateExplosionForFrame(slot: client_explosion_t, frameIndex: number): boolean {
  switch (slot.type) {
    case "mflash":
      return frameIndex < slot.frames - 1;
    case "flash":
      return frameIndex < 1;
    case "misc":
    case "poly":
    case "poly2":
      return frameIndex < slot.frames - 1;
    default:
      return frameIndex < slot.frames - 1;
  }
}

/**
 * Original name: N/A
 * Source: N/A (local explosion helper)
 * Category: New
 * Purpose: Reset one explosion slot back to the free state.
 */
function resetExplosion(slot: client_explosion_t): void {
  slot.type = "free";
  slot.ent.model = null;
  slot.ent.origin = [0, 0, 0];
  slot.ent.oldorigin = [0, 0, 0];
  slot.ent.angles = [0, 0, 0];
  slot.ent.frame = 0;
  slot.ent.oldframe = 0;
  slot.ent.backlerp = 0;
  slot.ent.flags = 0;
  slot.ent.alpha = 0;
  slot.ent.skinnum = 0;
  slot.frames = 0;
  slot.light = 0;
  slot.lightcolor = [0, 0, 0];
  slot.start = 0;
  slot.baseframe = 0;
}

/**
 * Original name: N/A
 * Source: N/A (local sustain helper)
 * Category: New
 * Purpose: Reset one sustain slot back to its free state after expiration.
 */
function resetSustain(slot: ClientRuntime["cl"]["tents"]["sustains"][number]): void {
  slot.id = 0;
  slot.type = "none";
  slot.thinker = "none";
  slot.endtime = 0;
  slot.nextthink = 0;
  slot.thinkinterval = 0;
  slot.org = [0, 0, 0];
  slot.dir = [0, 0, 0];
  slot.color = 0;
  slot.count = 0;
  slot.magnitude = 0;
}

/**
 * Original name: N/A
 * Source: N/A (local temp-entity helper)
 * Category: New
 * Purpose: Resolve one networked Quake direction byte through the original `anorms.h` lookup table.
 */
function directionByteToVector(directionByte: number | undefined): vec3_t {
  return DirFromByte(directionByte);
}

/**
 * Original name: N/A
 * Source: N/A (local temp-entity helper)
 * Category: New
 * Purpose: Derive coarse impact angles from the parsed direction byte.
 */
function directionByteToImpactAngles(directionByte: number | undefined): vec3_t {
  const dir = directionByteToVector(directionByte);
  const pitch = Math.acos(Math.max(-1, Math.min(1, dir[2]))) * 180 / Math.PI;
  const yaw = Math.atan2(dir[1], dir[0]) * 180 / Math.PI;
  return [pitch, yaw < 0 ? yaw + 360 : yaw, 0];
}

/**
 * Original name: N/A
 * Source: N/A (local temp-entity helper)
 * Category: New
 * Purpose: Reproduce the original random yaw seeding used by several temp explosion entities.
 */
function randomAngleDegrees(): number {
  return Math.floor(Math.random() * 360);
}

/**
 * Original name: N/A
 * Source: N/A (local temp-entity helper)
 * Category: New
 * Purpose: Reproduce the `frand() < 0.5 ? 15 : 0` baseframe choice used by the original explosion variants.
 */
function randomExplosionBaseframe(type: number): number {
  if (
    type === temp_event_t.TE_EXPLOSION1_BIG ||
    type === temp_event_t.TE_EXPLOSION1_NP ||
    type === temp_event_t.TE_PLAIN_EXPLOSION ||
    type === temp_event_t.TE_ROCKET_EXPLOSION ||
    type === temp_event_t.TE_ROCKET_EXPLOSION_WATER ||
    type === temp_event_t.TE_EXPLOSION1
  ) {
    return Math.random() < 0.5 ? 15 : 0;
  }

  return 0;
}

/**
 * Original name: CL_ParseParticles
 * Source: client/cl_tent.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Parses the auxiliary wall-puff particle packet and forwards its exact payload.
 *
 * Porting notes:
 * - Keeps the original `pos`, `dir`, `color`, `count` read order.
 */
export function CL_ParseParticles(runtime: ClientRuntime, hooks: ClientParseHooks = {}): ClientParticleEffectPacket {
  const packet: ClientParticleEffectPacket = {
    kind: "particle-effect",
    position: MSG_ReadPos(runtime.net_message),
    directionByte: MSG_ReadByte(runtime.net_message),
    color: MSG_ReadByte(runtime.net_message),
    count: MSG_ReadByte(runtime.net_message)
  };

  CL_ParticleEffect(runtime, packet.position, DirFromByte(packet.directionByte), packet.color, packet.count);
  hooks.onParticleEffect?.(packet);
  return packet;
}

/**
 * Original name: CL_ParseTEnt
 * Source: client/cl_tent.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Parses one temporary entity event payload from the server message stream.
 *
 * Porting notes:
 * - Currently covers the most common packet layouts and returns a structured packet instead of spawning effects directly.
 * - More specialized temp entities remain to be ported incrementally as `cl_tent.c` advances.
 */
export function CL_ParseTEnt(runtime: ClientRuntime, hooks: ClientParseHooks = {}): ClientTempEntityPacket {
  const type = MSG_ReadByte(runtime.net_message);
  const packet: ClientTempEntityPacket = { type };

  switch (type) {
    case temp_event_t.TE_BLOOD:
    case temp_event_t.TE_GUNSHOT:
    case temp_event_t.TE_SPARKS:
    case temp_event_t.TE_SHOTGUN:
    case temp_event_t.TE_SCREEN_SPARKS:
    case temp_event_t.TE_SHIELD_SPARKS:
    case temp_event_t.TE_BULLET_SPARKS:
    case temp_event_t.TE_GREENBLOOD:
    case temp_event_t.TE_HEATBEAM_SPARKS:
    case temp_event_t.TE_HEATBEAM_STEAM:
    case temp_event_t.TE_ELECTRIC_SPARKS: {
      packet.position = MSG_ReadPos(runtime.net_message);
      packet.directionByte = MSG_ReadByte(runtime.net_message);
      break;
    }
    case temp_event_t.TE_RAILTRAIL: {
      packet.position = MSG_ReadPos(runtime.net_message);
      packet.position2 = MSG_ReadPos(runtime.net_message);
      break;
    }
    case temp_event_t.TE_BLUEHYPERBLASTER: {
      packet.position = MSG_ReadPos(runtime.net_message);
      packet.direction = MSG_ReadPos(runtime.net_message);
      break;
    }
    case temp_event_t.TE_GRENADE_EXPLOSION:
    case temp_event_t.TE_EXPLOSION1:
    case temp_event_t.TE_EXPLOSION1_BIG:
    case temp_event_t.TE_EXPLOSION2:
    case temp_event_t.TE_ROCKET_EXPLOSION:
    case temp_event_t.TE_ROCKET_EXPLOSION_WATER:
    case temp_event_t.TE_GRENADE_EXPLOSION_WATER:
    case temp_event_t.TE_BFG_EXPLOSION:
    case temp_event_t.TE_BFG_BIGEXPLOSION:
    case temp_event_t.TE_BOSSTPORT:
    case temp_event_t.TE_PLASMA_EXPLOSION:
    case temp_event_t.TE_PLAIN_EXPLOSION:
    case temp_event_t.TE_MOREBLOOD:
    case temp_event_t.TE_CHAINFIST_SMOKE:
    case temp_event_t.TE_TRACKER_EXPLOSION:
    case temp_event_t.TE_TELEPORT_EFFECT:
    case temp_event_t.TE_DBALL_GOAL:
    case temp_event_t.TE_WIDOWSPLASH:
    case temp_event_t.TE_EXPLOSION1_NP: {
      packet.position = MSG_ReadPos(runtime.net_message);
      break;
    }
    case temp_event_t.TE_LASER_SPARKS:
    case temp_event_t.TE_SPLASH:
    case temp_event_t.TE_WELDING_SPARKS:
    case temp_event_t.TE_TUNNEL_SPARKS: {
      packet.count = MSG_ReadByte(runtime.net_message);
      packet.position = MSG_ReadPos(runtime.net_message);
      packet.directionByte = MSG_ReadByte(runtime.net_message);
      packet.color = MSG_ReadByte(runtime.net_message);
      break;
    }
    case temp_event_t.TE_BLASTER:
    case temp_event_t.TE_BLASTER2:
    case temp_event_t.TE_FLECHETTE: {
      packet.position = MSG_ReadPos(runtime.net_message);
      packet.directionByte = MSG_ReadByte(runtime.net_message);
      break;
    }
    case temp_event_t.TE_PARASITE_ATTACK:
    case temp_event_t.TE_MEDIC_CABLE_ATTACK: {
      assignBeamPacket(packet, "beam", CL_ParseBeam(runtime));
      break;
    }
    case temp_event_t.TE_FLASHLIGHT: {
      packet.position = MSG_ReadPos(runtime.net_message);
      packet.entity = MSG_ReadShort(runtime.net_message);
      break;
    }
    case temp_event_t.TE_BFG_LASER: {
      assignBeamPacket(packet, "laser", CL_ParseLaser(runtime));
      break;
    }
    case temp_event_t.TE_BUBBLETRAIL: {
      packet.position = MSG_ReadPos(runtime.net_message);
      packet.position2 = MSG_ReadPos(runtime.net_message);
      break;
    }
    case temp_event_t.TE_GRAPPLE_CABLE: {
      assignBeamPacket(packet, "beam2", CL_ParseBeam2(runtime));
      break;
    }
    case temp_event_t.TE_HEATBEAM:
    case temp_event_t.TE_MONSTER_HEATBEAM: {
      assignBeamPacket(packet, "player-beam", CL_ParsePlayerBeam(runtime, type));
      break;
    }
    case temp_event_t.TE_STEAM: {
      assignBeamPacket(packet, "steam", CL_ParseSteam(runtime));
      break;
    }
    case temp_event_t.TE_FORCEWALL:
    case temp_event_t.TE_DEBUGTRAIL:
    case temp_event_t.TE_BUBBLETRAIL2: {
      packet.position = MSG_ReadPos(runtime.net_message);
      packet.position2 = MSG_ReadPos(runtime.net_message);
      if (type === temp_event_t.TE_FORCEWALL) {
        packet.color = MSG_ReadByte(runtime.net_message);
      }
      break;
    }
    case temp_event_t.TE_LIGHTNING: {
      assignBeamPacket(packet, "lightning", CL_ParseLightning(runtime));
      break;
    }
    case temp_event_t.TE_WIDOWBEAMOUT: {
      assignBeamPacket(packet, "widow", CL_ParseWidow(runtime));
      break;
    }
    case temp_event_t.TE_NUKEBLAST: {
      assignBeamPacket(packet, "nuke", CL_ParseNuke(runtime));
      break;
    }
    default:
      throw new Error(`CL_ParseTEnt: unsupported type ${type}`);
  }

  CL_AddTEntPacket(runtime, packet);
  CL_ExecuteTempEntityEffects(runtime, packet);
  hooks.onTempEntity?.(packet);
  return packet;
}

/**
 * Original name: N/A
 * Source: N/A (local temp-entity packet helper)
 * Category: New
 * Purpose: Merge a specialized temp-entity payload into the currently allocated packet object.
 *
 * Constraints:
 * - Must preserve the original outer `type` field while copying parsed fields by value.
 */
function assignBeamPacket(
  target: ClientTempEntityPacket,
  beamKind: NonNullable<ClientTempEntityPacket["beamKind"]>,
  source: Partial<ClientTempEntityPacket>
): void {
  target.beamKind = beamKind;
  if (source.count !== undefined) {
    target.count = source.count;
  }
  if (source.color !== undefined) {
    target.color = source.color;
  }
  if (source.entity !== undefined) {
    target.entity = source.entity;
  }
  if (source.entity2 !== undefined) {
    target.entity2 = source.entity2;
  }
  if (source.id !== undefined) {
    target.id = source.id;
  }
  if (source.magnitude !== undefined) {
    target.magnitude = source.magnitude;
  }
  if (source.position !== undefined) {
    target.position = source.position;
  }
  if (source.position2 !== undefined) {
    target.position2 = source.position2;
  }
  if (source.offset !== undefined) {
    target.offset = source.offset;
  }
  if (source.directionByte !== undefined) {
    target.directionByte = source.directionByte;
  }
  if (source.durationMs !== undefined) {
    target.durationMs = source.durationMs;
  }
}


/**
 * Original name: CL_ParseBeam
 * Source: client/cl_tent.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Parses the parasite/medic-style beam payload and returns the exact packet fields it carries.
 */
export function CL_ParseBeam(runtime: ClientRuntime): Partial<ClientTempEntityPacket> {
  return {
    entity: MSG_ReadShort(runtime.net_message),
    position: MSG_ReadPos(runtime.net_message),
    position2: MSG_ReadPos(runtime.net_message),
    offset: [0, 0, 0]
  };
}

/**
 * Original name: CL_ParseBeam2
 * Source: client/cl_tent.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Parses the grapple-style beam payload, including its explicit offset.
 */
export function CL_ParseBeam2(runtime: ClientRuntime): Partial<ClientTempEntityPacket> {
  return {
    entity: MSG_ReadShort(runtime.net_message),
    position: MSG_ReadPos(runtime.net_message),
    position2: MSG_ReadPos(runtime.net_message),
    offset: MSG_ReadPos(runtime.net_message)
  };
}

/**
 * Original name: CL_ParsePlayerBeam
 * Source: client/cl_tent.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Parses the player-linked beam payload used by heatbeam-style temp entities.
 */
export function CL_ParsePlayerBeam(runtime: ClientRuntime, type: number): Partial<ClientTempEntityPacket> {
  const entity = MSG_ReadShort(runtime.net_message);
  const position = MSG_ReadPos(runtime.net_message);
  const position2 = MSG_ReadPos(runtime.net_message);

  let offset: [number, number, number];
  if (type === temp_event_t.TE_HEATBEAM) {
    offset = [2, 7, -3];
  } else {
    offset = [0, 0, 0];
  }

  return {
    entity,
    position,
    position2,
    offset
  };
}

/**
 * Original name: CL_ParseLightning
 * Source: client/cl_tent.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Parses the dual-entity lightning beam payload.
 */
export function CL_ParseLightning(runtime: ClientRuntime): Partial<ClientTempEntityPacket> {
  return {
    entity: MSG_ReadShort(runtime.net_message),
    entity2: MSG_ReadShort(runtime.net_message),
    position: MSG_ReadPos(runtime.net_message),
    position2: MSG_ReadPos(runtime.net_message),
    offset: [0, 0, 0]
  };
}

/**
 * Original name: CL_ParseLaser
 * Source: client/cl_tent.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Parses the laser temp entity payload and preserves only its endpoints.
 */
export function CL_ParseLaser(runtime: ClientRuntime): Partial<ClientTempEntityPacket> {
  return {
    position: MSG_ReadPos(runtime.net_message),
    position2: MSG_ReadPos(runtime.net_message)
  };
}

/**
 * Original name: CL_ParseSteam
 * Source: client/cl_tent.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Parses the rogue steam payload in both instant and sustain forms.
 */
export function CL_ParseSteam(runtime: ClientRuntime): Partial<ClientTempEntityPacket> {
  const id = MSG_ReadShort(runtime.net_message);
  if (id === -1) {
    return {
      id,
      count: MSG_ReadByte(runtime.net_message),
      position: MSG_ReadPos(runtime.net_message),
      directionByte: MSG_ReadByte(runtime.net_message),
      color: MSG_ReadByte(runtime.net_message) & 0xff,
      magnitude: MSG_ReadShort(runtime.net_message)
    };
  }

  return {
    id,
    count: MSG_ReadByte(runtime.net_message),
    position: MSG_ReadPos(runtime.net_message),
    directionByte: MSG_ReadByte(runtime.net_message),
    color: MSG_ReadByte(runtime.net_message) & 0xff,
    magnitude: MSG_ReadShort(runtime.net_message),
    durationMs: MSG_ReadLong(runtime.net_message)
  };
}

/**
 * Original name: CL_ParseWidow
 * Source: client/cl_tent.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Parses the widow sustain-effect payload.
 */
export function CL_ParseWidow(runtime: ClientRuntime): Partial<ClientTempEntityPacket> {
  return {
    id: MSG_ReadShort(runtime.net_message),
    position: MSG_ReadPos(runtime.net_message),
    durationMs: 2100
  };
}

/**
 * Original name: CL_ParseNuke
 * Source: client/cl_tent.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Parses the nuke sustain-effect payload.
 */
export function CL_ParseNuke(runtime: ClientRuntime): Partial<ClientTempEntityPacket> {
  return {
    id: 21000,
    position: MSG_ReadPos(runtime.net_message),
    durationMs: 1000
  };
}
