/**
 * File: cl_fx.ts
 * Source: Quake II original / client/cl_fx.c
 * Purpose: Port the main client-side effect, muzzle flash, dlight, lightstyle and particle routines into runtime-side structured outputs.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Emits structured effect descriptions instead of spawning lights, particles or sounds directly.
 * - The routines sourced from `client/cl_newfx.c` now live in `newfx.ts` so this file can remain the principal port target for `cl_fx.c`.
 *
 * Notes:
 * - This file is intended to stay conceptually close to the original client effect pipeline.
 */

import {
  AngleVectors,
  ATTN_IDLE,
  BYTE_DIRS,
  CS_LIGHTS,
  crand,
  DirFromByte,
  EF_BFG,
  EF_FLIES,
  EF_GIB,
  EF_GREENGIB,
  EF_ROCKET,
  MZ_BFG,
  MZ_BLASTER,
  MZ_BLASTER2,
  MZ_BLUEHYPERBLASTER,
  MZ_CHAINGUN1,
  MZ_CHAINGUN2,
  MZ_CHAINGUN3,
  MZ_ETF_RIFLE,
  MZ_GRENADE,
  MZ_HEATBEAM,
  MZ_HYPERBLASTER,
  MZ_IONRIPPER,
  MZ_ITEMRESPAWN,
  MZ_LOGIN,
  MZ_LOGOUT,
  MZ_MACHINEGUN,
  MZ_NUKE1,
  MZ_NUKE2,
  MZ_NUKE4,
  MZ_NUKE8,
  MZ_PHALANX,
  MZ_RAILGUN,
  MZ_RESPAWN,
  MZ_ROCKET,
  MZ_SHOTGUN,
  MZ_SHOTGUN2,
  MZ_SILENCED,
  MZ_SSHOTGUN,
  MZ_TRACKER,
  MZ_UNUSED,
  MAX_EDICTS,
  MAX_LIGHTSTYLES,
  MAX_QPATH,
  MSG_ReadByte,
  MSG_ReadShort,
  NUMVERTEXNORMALS,
  ATTN_NONE,
  ATTN_NORM,
  ATTN_STATIC,
  CHAN_AUTO,
  CHAN_BODY,
  CHAN_WEAPON,
  EF_ANIM_ALLFAST,
  EF_BLASTER,
  EF_FLAG1,
  EF_FLAG2,
  EF_GRENADE,
  EF_HYPERBLASTER,
  EF_IONRIPPER,
  EF_PLASMA,
  EF_TAGTRAIL,
  EF_TELEPORTER,
  EF_TRAP,
  EF_TRACKER,
  EF_TRACKERTRAIL,
  frand,
  type entity_state_t,
  entity_event_t,
  temp_event_t,
  type vec3_t
} from "../../qcommon/src/index.js";
import type { ClientEntityEvent } from "./cl_ents.js";
import type {
  ClientParseHooks,
  ClientMuzzleFlash2Packet,
  ClientMuzzleFlashPacket,
  ClientParticleEffectPacket,
  ClientTempEntityPacket
} from "./cl_parse.js";
import { getMonsterFlashOffset } from "./monster-flash.js";
import {
  CL_BlasterParticles2,
  CL_BlasterTrail2,
  CL_BubbleTrail2,
  CL_ColorExplosionParticles,
  CL_ColorFlash,
  CL_DebugTrail,
  CL_Flashlight,
  CL_ForceWall,
  CL_ParticleSmokeEffect,
  CL_ParticleSteamEffect,
  CL_TagTrail,
  CL_TrackerTrail,
  CL_Tracker_Shell,
  CL_WidowSplash
} from "./cl_newfx.js";
import { INSTANT_PARTICLE, MAX_DLIGHTS, type ClientRuntime, type centity_t, type cparticle_t } from "./client.js";
import type { ClientDynamicLight, ClientRenderParticle } from "./refresh.js";

/**
 * Original name: PARTICLE_GRAVITY
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Strict
 */
const PARTICLE_GRAVITY = 40;

/**
 * Original name: BEAMLENGTH
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Strict
 */
const FLY_BEAM_LENGTH = 16;

/**
 * Original name: avelocities
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Strict
 */
const flyAvelocities: vec3_t[] = [];

/**
 * Original name: N/A
 * Source: N/A (runtime descriptor)
 * Category: New
 * Purpose: Describe one renderer-facing lightstyle value emitted by the `cl_fx.c` lightstyle port.
 *
 * Constraints:
 * - Must preserve the Quake II style index and current RGB triplet.
 */
export interface ClientLightStyle {
  style: number;
  rgb: [number, number, number];
}

/**
 * Original name: N/A
 * Source: N/A (runtime descriptor)
 * Category: New
 * Purpose: Describe one normalized client action effect event ready for renderer/audio adapters.
 *
 * Constraints:
 * - Must preserve the originating packet family and enough metadata to reproduce later side effects.
 */
export interface ClientActionEffect {
  category: "muzzleflash" | "muzzleflash2" | "temp-entity" | "particle" | "entity-event";
  kind: string;
  entity?: number;
  entity2?: number;
  sound?: {
    name: string;
    channel: number;
    attenuation: number;
    volume?: number;
    delayMs?: number;
  };
  light?: {
    radius: number;
    color: [number, number, number];
    durationMs: number;
    minlight?: number;
  };
  position?: vec3_t;
  position2?: vec3_t;
  direction?: vec3_t;
  offset?: vec3_t;
  color?: number;
  count?: number;
  magnitude?: number;
  spacing?: number;
  durationMs?: number;
  packet?: ClientMuzzleFlashPacket | ClientMuzzleFlash2Packet | ClientTempEntityPacket;
}

/**
 * Original name: N/A
 * Source: N/A (runtime descriptor)
 * Category: New
 * Purpose: Describe the packet-entity fields consumed by client-side effect trail integration.
 */
export interface ClientPacketEntityEffectSource {
  number: number;
  effects: number;
  origin: vec3_t;
  modelindex?: number;
  viewerEntity?: boolean;
}

/**
 * Original name: CL_ParticleEffect
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Allocates the original wall-impact particle puffs into the active particle list.
 *
 * Porting notes:
 * - Preserves exact `color + (rand()&7)`, `d = rand()&31` and gravity semantics.
 */
export function CL_ParticleEffect(runtime: ClientRuntime, org: vec3_t, dir: vec3_t, color: number, count: number): void {
  for (let index = 0; index < count; index += 1) {
    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.time = runtime.cl.time;
    particle.color = color + (Math.floor(Math.random() * 0x7fffffff) & 7);

    const d = Math.floor(Math.random() * 0x7fffffff) & 31;
    for (let component = 0; component < 3; component += 1) {
      particle.org[component] = org[component] + ((Math.floor(Math.random() * 0x7fffffff) & 7) - 4) + (d * dir[component]);
      particle.vel[component] = crand() * 20;
    }

    particle.accel[0] = 0;
    particle.accel[1] = 0;
    particle.accel[2] = -PARTICLE_GRAVITY;
    particle.alpha = 1.0;
    particle.alphavel = -1.0 / (0.5 + frand() * 0.3);
  }
}

/**
 * Original name: CL_ParticleEffect2
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Allocates the original fixed-color particle variant into the active particle list.
 *
 * Porting notes:
 * - Preserves exact `d = rand()&7` and gravity semantics.
 */
export function CL_ParticleEffect2(runtime: ClientRuntime, org: vec3_t, dir: vec3_t, color: number, count: number): void {
  for (let index = 0; index < count; index += 1) {
    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.time = runtime.cl.time;
    particle.color = color;

    const d = Math.floor(Math.random() * 0x7fffffff) & 7;
    for (let component = 0; component < 3; component += 1) {
      particle.org[component] = org[component] + ((Math.floor(Math.random() * 0x7fffffff) & 7) - 4) + (d * dir[component]);
      particle.vel[component] = crand() * 20;
    }

    particle.accel[0] = 0;
    particle.accel[1] = 0;
    particle.accel[2] = -PARTICLE_GRAVITY;
    particle.alpha = 1.0;
    particle.alphavel = -1.0 / (0.5 + frand() * 0.3);
  }
}

/**
 * Original name: CL_ParticleEffect3
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Allocates the original tunnel-sparks upward particle variant into the active particle list.
 *
 * Porting notes:
 * - Preserves exact `d = rand()&7` and positive gravity semantics.
 */
export function CL_ParticleEffect3(runtime: ClientRuntime, org: vec3_t, dir: vec3_t, color: number, count: number): void {
  for (let index = 0; index < count; index += 1) {
    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.time = runtime.cl.time;
    particle.color = color;

    const d = Math.floor(Math.random() * 0x7fffffff) & 7;
    for (let component = 0; component < 3; component += 1) {
      particle.org[component] = org[component] + ((Math.floor(Math.random() * 0x7fffffff) & 7) - 4) + (d * dir[component]);
      particle.vel[component] = crand() * 20;
    }

    particle.accel[0] = 0;
    particle.accel[1] = 0;
    particle.accel[2] = PARTICLE_GRAVITY;
    particle.alpha = 1.0;
    particle.alphavel = -1.0 / (0.5 + frand() * 0.3);
  }
}

/**
 * Original name: CL_BlueBlasterParticles
 * Source: client/cl_tent.c
 * Category: Adapter
 * Fidelity level: Adapter
 *
 * Behavior:
 * - Reuses the `CL_BlasterParticles` port for `TE_BLUEHYPERBLASTER` in this source tree.
 *
 * Porting notes:
 * - `client/cl_tent.c` declares this symbol but the shipped switch calls `CL_BlasterParticles` directly.
 */
export function CL_BlueBlasterParticles(org: vec3_t, dir: vec3_t): ClientActionEffect[];
export function CL_BlueBlasterParticles(runtime: ClientRuntime, org: vec3_t, dir: vec3_t): void;
export function CL_BlueBlasterParticles(
  runtimeOrOrg: ClientRuntime | vec3_t,
  orgOrDir: vec3_t,
  maybeDir?: vec3_t
): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrOrg)) {
    return CL_BlasterParticles(runtimeOrOrg, orgOrDir);
  }

  return CL_BlasterParticles(runtimeOrOrg, orgOrDir, maybeDir as vec3_t);
}

/**
 * Original name: N/A
 * Source: N/A (runtime effect builder)
 * Category: New
 * Purpose: Convert one parsed player muzzle flash packet into normalized effect events.
 *
 * Constraints:
 * - Must preserve silenced state and weapon family.
 */
export function CL_BuildMuzzleFlashEffects(
  packet: ClientMuzzleFlashPacket,
  runtime?: ClientRuntime
): ClientActionEffect[] {
  const weaponId = packet.weapon & ~MZ_SILENCED;
  const volume = packet.silenced ? 0.2 : 1;
  const definition = getMuzzleFlashDefinition(weaponId, volume);

  return buildMuzzleFlashEffects(packet, definition, runtime);
}

/**
 * Original name: CL_ClearLightStyles
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Clears all client lightstyle slots and resets the cached time offset.
 *
 * Porting notes:
 * - Reinitializes the structured TS lightstyle array in place.
 */
export function CL_ClearLightStyles(runtime: ClientRuntime): void {
  runtime.cl.lightstyles = Array.from({ length: MAX_LIGHTSTYLES }, () => ({
    length: 0,
    value: [0, 0, 0] as [number, number, number],
    map: []
  }));
  runtime.cl.last_lightstyle_ofs = -1;
}

/**
 * Original name: CL_RunLightStyles
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Advances all animated lightstyle values according to the current client time.
 *
 * Porting notes:
 * - Preserves the `cl.time / 100` stepping and the default white fallback.
 */
export function CL_RunLightStyles(runtime: ClientRuntime): void {
  const ofs = Math.floor(runtime.cl.time / 100);
  if (ofs === runtime.cl.last_lightstyle_ofs) {
    return;
  }

  runtime.cl.last_lightstyle_ofs = ofs;

  for (const lightstyle of runtime.cl.lightstyles) {
    if (lightstyle.length === 0) {
      lightstyle.value = [1, 1, 1];
      continue;
    }

    const sample = lightstyle.length === 1
      ? lightstyle.map[0]
      : lightstyle.map[ofs % lightstyle.length];
    lightstyle.value = [sample, sample, sample];
  }
}

/**
 * Original name: CL_SetLightstyle
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Parses one `CS_LIGHTS` configstring into the indexed client lightstyle slot.
 *
 * Porting notes:
 * - Throws on overlong configstrings like the original `Com_Error` path.
 */
export function CL_SetLightstyle(runtime: ClientRuntime, style: number): void {
  if (style < 0 || style >= MAX_LIGHTSTYLES) {
    throw new Error(`CL_SetLightstyle: bad style ${style}`);
  }

  const source = runtime.cl.configstrings[CS_LIGHTS + style] ?? "";
  if (source.length >= MAX_QPATH) {
    throw new Error(`svc_lightstyle length=${source.length}`);
  }

  const lightstyle = runtime.cl.lightstyles[style];
  lightstyle.length = source.length;
  lightstyle.map = new Array<number>(source.length).fill(0);

  for (let index = 0; index < source.length; index += 1) {
    lightstyle.map[index] = (source.charCodeAt(index) - "a".charCodeAt(0)) / ("m".charCodeAt(0) - "a".charCodeAt(0));
  }
}

/**
 * Original name: CL_AddLightStyles
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the current animated lightstyle values in renderer-facing form.
 *
 * Porting notes:
 * - Returns structured data instead of calling `V_AddLightStyle`.
 */
export function CL_AddLightStyles(runtime: ClientRuntime): ClientLightStyle[] {
  return runtime.cl.lightstyles.map((lightstyle, style) => ({
    style,
    rgb: [...lightstyle.value]
  }));
}

/**
 * Original name: CL_ClearDlights
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Clears all client dynamic-light slots.
 *
 * Porting notes:
 * - Reinitializes the structured TS slot array in place.
 */
export function CL_ClearDlights(runtime: ClientRuntime): void {
  runtime.cl.dlights = Array.from({ length: MAX_DLIGHTS }, () => ({
    key: 0,
    color: [0, 0, 0] as vec3_t,
    origin: [0, 0, 0] as vec3_t,
    radius: 0,
    die: 0,
    decay: 0,
    minlight: 0
  }));
}

/**
 * Original name: CL_AllocDlight
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Allocates one dynamic-light slot, first by exact key and then by expired entry.
 *
 * Porting notes:
 * - Preserves the original slot reuse order and zeroing semantics.
 */
export function CL_AllocDlight(runtime: ClientRuntime, key: number): ClientRuntime["cl"]["dlights"][number] {
  if (key !== 0) {
    for (const dlight of runtime.cl.dlights) {
      if (dlight.key === key) {
        resetDlight(dlight, key);
        return dlight;
      }
    }
  }

  for (const dlight of runtime.cl.dlights) {
    if (dlight.die < runtime.cl.time) {
      resetDlight(dlight, key);
      return dlight;
    }
  }

  const dlight = runtime.cl.dlights[0];
  resetDlight(dlight, key);
  return dlight;
}

/**
 * Original name: CL_NewDlight
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Allocates and initializes one transient client dynamic light.
 */
export function CL_NewDlight(
  runtime: ClientRuntime,
  key: number,
  x: number,
  y: number,
  z: number,
  radius: number,
  time: number
): void {
  const dlight = CL_AllocDlight(runtime, key);
  dlight.origin[0] = x;
  dlight.origin[1] = y;
  dlight.origin[2] = z;
  dlight.radius = radius;
  dlight.die = runtime.cl.time + time;
}

/**
 * Original name: CL_RunDLights
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Advances dynamic-light decay and expires dead entries.
 *
 * Porting notes:
 * - Preserves the original `return` behavior when the first dead slot is encountered.
 */
export function CL_RunDLights(runtime: ClientRuntime): void {
  for (const dlight of runtime.cl.dlights) {
    if (dlight.radius === 0) {
      continue;
    }

    if (dlight.die < runtime.cl.time) {
      dlight.radius = 0;
      return;
    }

    dlight.radius -= runtime.cls.frametime * dlight.decay;
    if (dlight.radius < 0) {
      dlight.radius = 0;
    }
  }
}

/**
 * Original name: CL_AddDLights
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits every active client dynamic light in refresh-facing form.
 *
 * Porting notes:
 * - Preserves signed Quake II colors for the GL-style renderer path instead of mutating software negative lights.
 * - Returns structured data instead of calling `V_AddLight`.
 */
export function CL_AddDLights(runtime: ClientRuntime): ClientDynamicLight[] {
  return runtime.cl.dlights
    .filter((dlight) => dlight.radius !== 0)
    .map((dlight) => ({
      origin: [...dlight.origin],
      intensity: dlight.radius,
      color: [dlight.color[0], dlight.color[1], dlight.color[2]],
      minlight: dlight.minlight,
      sourceEntity: dlight.key,
      kind: "dlight"
    }));
}

/**
 * Original name: CL_ClearParticles
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Rebuilds the free particle list and clears the active list head.
 *
 * Porting notes:
 * - Preserves the original `particles[]`, `active_particles`, `free_particles` startup layout.
 */
export function CL_ClearParticles(runtime: ClientRuntime): void {
  const count = runtime.cl.cl_numparticles;
  runtime.cl.active_particles = -1;
  runtime.cl.free_particles = count > 0 ? 0 : -1;

  for (let index = 0; index < count; index += 1) {
    const particle = runtime.cl.particles[index];
    resetParticle(particle);
    particle.next = index + 1 < count ? index + 1 : -1;
  }
}

/**
 * Original name: CL_ClearEffects
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Resets the client particle pool, dynamic lights and light styles together.
 *
 * Porting notes:
 * - Preserves the original call ordering exactly.
 */
export function CL_ClearEffects(runtime: ClientRuntime): void {
  CL_ClearParticles(runtime);
  CL_ClearDlights(runtime);
  CL_ClearLightStyles(runtime);
}

/**
 * Original name: N/A
 * Source: N/A (runtime effect builder)
 * Category: New
 * Purpose: Convert one parsed monster muzzle flash packet into normalized effect events.
 *
 * Constraints:
 * - Must preserve the source entity and flash id for later lookup specializations.
 */
export function CL_BuildMuzzleFlash2Effects(
  packet: ClientMuzzleFlash2Packet,
  runtime?: ClientRuntime
): ClientActionEffect[] {
  const definition = getMuzzleFlash2Definition(packet.flashNumber);
  const position = runtime ? buildMonsterMuzzleFlashOrigin(runtime, packet.entity, packet.flashNumber) : undefined;
  const effect: ClientActionEffect = {
    category: "muzzleflash2",
    kind: definition.kind,
    entity: packet.entity,
    light: {
      radius: definition.longLight ? 300 + (Math.floor(Math.random() * 0x7fffffff) & 100) : 200 + (Math.floor(Math.random() * 0x7fffffff) & 31),
      color: definition.color,
      durationMs: definition.longLight ? 200 : 0,
      minlight: 32
    },
    packet
  };
  if (position) {
    effect.position = position;
  }

  const effects: ClientActionEffect[] = [effect];
  appendMuzzleFlash2Particles(effects, packet, definition, position);
  appendMuzzleFlash2Sounds(effects, packet, definition);
  return effects;
}

/**
 * Original name: N/A
 * Source: N/A (runtime effect builder)
 * Category: New
 * Purpose: Convert one parsed temporary entity packet into normalized effect events.
 *
 * Constraints:
 * - Must preserve packet-specific geometry and effect classification.
 */
export function CL_BuildTempEntityEffects(packet: ClientTempEntityPacket): ClientActionEffect[] {
  if (packet.type === temp_event_t.TE_STEAM && packet.id === -1) {
    const effect: ClientActionEffect = {
      category: "particle",
      kind: "particle-steam-effect",
      packet
    };
    if (packet.position) {
      effect.position = [...packet.position];
    }
    if (packet.directionByte !== undefined) {
      effect.direction = DirFromByte(packet.directionByte);
    }
    if (packet.color !== undefined) {
      effect.color = packet.color;
    }
    if (packet.count !== undefined) {
      effect.count = packet.count;
    }
    if (packet.magnitude !== undefined) {
      effect.magnitude = packet.magnitude;
    }
    return [effect];
  }

  const effect: ClientActionEffect = {
    category: "temp-entity",
    kind: getTempEntityKind(packet),
    packet
  };
  const effects: ClientActionEffect[] = [effect];

  if (packet.entity !== undefined) {
    effect.entity = packet.entity;
  }
  if (packet.entity2 !== undefined) {
    effect.entity2 = packet.entity2;
  }
  if (packet.position !== undefined) {
    effect.position = packet.position;
  }
  if (packet.position2 !== undefined) {
    effect.position2 = packet.position2;
  }
  if (packet.offset !== undefined) {
    effect.offset = packet.offset;
  }
  if (packet.color !== undefined) {
    effect.color = packet.color;
  }
  if (packet.count !== undefined) {
    effect.count = packet.count;
  }
  if (packet.magnitude !== undefined) {
    effect.magnitude = packet.magnitude;
  }
  if (packet.durationMs !== undefined) {
    effect.durationMs = packet.durationMs;
  }
  if (packet.direction !== undefined) {
    effect.direction = [...packet.direction];
  }

  switch (packet.type) {
    case temp_event_t.TE_BLOOD:
      effect.category = "particle";
      effect.color = 0xe8;
      effect.count = 60;
      break;
    case temp_event_t.TE_GUNSHOT:
      effect.category = "particle";
      effect.color = 0;
      effect.count = 40;
      if (packet.position) {
        effects.push(createTempEntityMarker("smoke-and-flash", packet.position, packet));
      }
      appendTempEntitySound(effects, randomRicochetSound(), ATTN_NORM, packet.position, packet);
      break;
    case temp_event_t.TE_SPARKS:
    case temp_event_t.TE_BULLET_SPARKS:
      effect.category = "particle";
      effect.color = 0xe0;
      effect.count = 6;
      if (packet.type === temp_event_t.TE_BULLET_SPARKS) {
        if (packet.position) {
          effects.push(createTempEntityMarker("smoke-and-flash", packet.position, packet));
        }
        appendTempEntitySound(effects, randomRicochetSound(), ATTN_NORM, packet.position, packet);
      }
      break;
    case temp_event_t.TE_SCREEN_SPARKS:
      effect.category = "particle";
      effect.color = 0xd0;
      effect.count = 40;
      if (packet.position) {
        effect.position = [...packet.position];
      }
      effect.sound = {
        name: "weapons/lashit.wav",
        channel: CHAN_AUTO,
        attenuation: ATTN_NORM
      };
      break;
    case temp_event_t.TE_SHIELD_SPARKS:
      effect.category = "particle";
      effect.color = 0xb0;
      effect.count = 40;
      if (packet.position) {
        effect.position = [...packet.position];
      }
      effect.sound = {
        name: "weapons/lashit.wav",
        channel: CHAN_AUTO,
        attenuation: ATTN_NORM
      };
      break;
    case temp_event_t.TE_SHOTGUN:
      effect.category = "particle";
      effect.color = 0;
      effect.count = 20;
      if (packet.position) {
        effects.push(createTempEntityMarker("smoke-and-flash", packet.position, packet));
      }
      break;
    case temp_event_t.TE_SPLASH:
      effect.category = "particle";
      if (packet.position) {
        effect.position = [...packet.position];
      }
      effect.color = mapSplashColor(packet.color ?? 0);
      if ((packet.color ?? 0) === 1) {
        effect.sound = {
          name: randomSplashSparkSound(),
          channel: CHAN_AUTO,
          attenuation: ATTN_STATIC
        };
      }
      break;
    case temp_event_t.TE_LASER_SPARKS:
      effect.category = "particle";
      effect.kind = "particle-effect2";
      break;
    case temp_event_t.TE_BLASTER:
      effect.category = "particle";
      if (packet.position) {
        effect.position = [...packet.position];
      }
      if (packet.position && packet.directionByte !== undefined) {
        effects.push(...CL_BlasterParticles(packet.position, DirFromByte(packet.directionByte)));
      }
      effect.sound = {
        name: "weapons/lashit.wav",
        channel: CHAN_AUTO,
        attenuation: ATTN_NORM
      };
      effect.light = {
        radius: 150,
        color: [1, 1, 0],
        durationMs: 100
      };
      break;
    case temp_event_t.TE_BLASTER2:
      effect.category = "particle";
      if (packet.position) {
        effect.position = [...packet.position];
      }
      if (packet.position && packet.directionByte !== undefined) {
        effects.push(...CL_BlasterParticles2(packet.position, DirFromByte(packet.directionByte), 0xd0).map((entry) => ({
          ...entry,
          packet
        })));
      }
      effect.sound = {
        name: "weapons/lashit.wav",
        channel: CHAN_AUTO,
        attenuation: ATTN_NORM
      };
      effect.light = {
        radius: 150,
        color: [0, 1, 0],
        durationMs: 100
      };
      break;
    case temp_event_t.TE_BLUEHYPERBLASTER:
      effect.category = "particle";
      if (packet.position && packet.direction) {
        effects.push(...CL_BlueBlasterParticles(packet.position, packet.direction).map((entry) => ({
          ...entry,
          packet
        })));
      }
      break;
    case temp_event_t.TE_FLECHETTE:
      effect.category = "particle";
      if (packet.position) {
        effect.position = [...packet.position];
      }
      if (packet.position && packet.directionByte !== undefined) {
        effects.push(...CL_BlasterParticles2(packet.position, DirFromByte(packet.directionByte), 0x6f).map((entry) => ({
          ...entry,
          packet
        })));
      }
      effect.sound = {
        name: "weapons/lashit.wav",
        channel: CHAN_AUTO,
        attenuation: ATTN_NORM
      };
      effect.light = {
        radius: 150,
        color: [0.19, 0.41, 0.75],
        durationMs: 100
      };
      break;
    case temp_event_t.TE_RAILTRAIL:
      effect.category = "particle";
      if (packet.position2) {
        effect.position = [...packet.position2];
      }
      if (packet.position && packet.position2) {
        effects.push(...CL_RailTrail(packet.position, packet.position2));
      }
      effect.sound = {
        name: "weapons/railgf1a.wav",
        channel: CHAN_AUTO,
        attenuation: ATTN_NORM
      };
      break;
    case temp_event_t.TE_EXPLOSION1:
    case temp_event_t.TE_EXPLOSION1_BIG:
    case temp_event_t.TE_EXPLOSION1_NP:
    case temp_event_t.TE_ROCKET_EXPLOSION:
    case temp_event_t.TE_ROCKET_EXPLOSION_WATER:
    case temp_event_t.TE_GRENADE_EXPLOSION:
    case temp_event_t.TE_GRENADE_EXPLOSION_WATER:
    case temp_event_t.TE_EXPLOSION2:
    case temp_event_t.TE_PLAIN_EXPLOSION:
    case temp_event_t.TE_PLASMA_EXPLOSION:
      effect.category = "particle";
      if (packet.position) {
        effect.position = [...packet.position];
      }
      effect.sound = {
        name:
          packet.type === temp_event_t.TE_GRENADE_EXPLOSION_WATER || packet.type === temp_event_t.TE_ROCKET_EXPLOSION_WATER
            ? "weapons/xpld_wat.wav"
            : packet.type === temp_event_t.TE_GRENADE_EXPLOSION || packet.type === temp_event_t.TE_EXPLOSION2
              ? "weapons/grenlx1a.wav"
              : "weapons/rocklx1a.wav",
        channel: CHAN_AUTO,
        attenuation: ATTN_NORM
      };
      effect.light = {
        radius: 350,
        color: [1, 0.5, 0.5],
        durationMs: 100
      };
      if (
        packet.position &&
        packet.type !== temp_event_t.TE_EXPLOSION1_BIG &&
        packet.type !== temp_event_t.TE_EXPLOSION1_NP &&
        packet.type !== temp_event_t.TE_PLAIN_EXPLOSION
      ) {
        effects.push(...CL_ExplosionParticles(packet.position));
      }
      break;
    case temp_event_t.TE_BFG_EXPLOSION:
      effect.category = "particle";
      effect.light = {
        radius: 350,
        color: [0, 1, 0],
        durationMs: 100
      };
      break;
    case temp_event_t.TE_BFG_BIGEXPLOSION:
      effect.category = "particle";
      if (packet.position) {
        effects.push(...CL_BFGExplosionParticles(packet.position));
      }
      break;
    case temp_event_t.TE_BUBBLETRAIL:
      effect.category = "particle";
      if (packet.position && packet.position2) {
        effects.push(...CL_BubbleTrail(packet.position, packet.position2));
      }
      break;
    case temp_event_t.TE_LIGHTNING:
      if (packet.entity !== undefined) {
        effect.entity = packet.entity;
      }
      effect.sound = {
        name: "weapons/tesla.wav",
        channel: CHAN_WEAPON,
        attenuation: ATTN_NORM
      };
      break;
    case temp_event_t.TE_BOSSTPORT:
      effect.category = "particle";
      if (packet.position) {
        effect.position = [...packet.position];
      }
      if (packet.position) {
        effects.push(...CL_BigTeleportParticles(packet.position));
      }
      effect.sound = {
        name: "misc/bigtele.wav",
        channel: CHAN_AUTO,
        attenuation: ATTN_NONE
      };
      break;
    case temp_event_t.TE_WELDING_SPARKS:
      effect.category = "particle";
      effect.kind = "particle-effect2";
      break;
    case temp_event_t.TE_GREENBLOOD:
      effect.category = "particle";
      effect.kind = "particle-effect2";
      effect.color = 0xdf;
      effect.count = 30;
      break;
    case temp_event_t.TE_TUNNEL_SPARKS:
      effect.category = "particle";
      effect.kind = "particle-effect3";
      break;
    case temp_event_t.TE_DEBUGTRAIL:
      effect.category = "particle";
      if (packet.position && packet.position2) {
        effects.push(...CL_DebugTrail(packet.position, packet.position2).map((entry) => ({
          ...entry,
          packet
        })));
      }
      break;
    case temp_event_t.TE_ELECTRIC_SPARKS:
      if (packet.position) {
        effect.position = [...packet.position];
      }
      effect.sound = {
        name: "weapons/lashit.wav",
        channel: CHAN_AUTO,
        attenuation: ATTN_NORM
      };
      if (packet.type === temp_event_t.TE_ELECTRIC_SPARKS) {
        effect.category = "particle";
        effect.color = 0x75;
        effect.count = 40;
      }
      break;
    case temp_event_t.TE_HEATBEAM_SPARKS:
      effect.category = "particle";
      if (packet.position) {
        effect.position = [...packet.position];
      }
      if (packet.position && packet.directionByte !== undefined) {
        effects.push(...CL_ParticleSteamEffect(packet.position, DirFromByte(packet.directionByte), 8, 50, 60).map((entry) => ({
          ...entry,
          packet
        })));
      }
      effect.sound = {
        name: "weapons/lashit.wav",
        channel: CHAN_AUTO,
        attenuation: ATTN_NORM
      };
      break;
    case temp_event_t.TE_HEATBEAM_STEAM:
      effect.category = "particle";
      if (packet.position) {
        effect.position = [...packet.position];
      }
      if (packet.position && packet.directionByte !== undefined) {
        effects.push(...CL_ParticleSteamEffect(packet.position, DirFromByte(packet.directionByte), 0xe0, 20, 60).map((entry) => ({
          ...entry,
          packet
        })));
      }
      effect.sound = {
        name: "weapons/lashit.wav",
        channel: CHAN_AUTO,
        attenuation: ATTN_NORM
      };
      break;
    case temp_event_t.TE_BUBBLETRAIL2:
      effect.category = "particle";
      if (packet.position) {
        effect.position = [...packet.position];
      }
      if (packet.position && packet.position2) {
        effects.push(...CL_BubbleTrail2(packet.position, packet.position2, 8).map((entry) => ({
          ...entry,
          packet
        })));
      }
      effect.sound = {
        name: "weapons/lashit.wav",
        channel: CHAN_AUTO,
        attenuation: ATTN_NORM
      };
      break;
    case temp_event_t.TE_MOREBLOOD:
      effect.category = "particle";
      effect.color = 0xe8;
      effect.count = 250;
      break;
    case temp_event_t.TE_CHAINFIST_SMOKE:
      effect.category = "particle";
      if (packet.position) {
        effects.push(...CL_ParticleSmokeEffect(packet.position, [0, 0, 1], 0, 20, 20).map((entry) => ({
          ...entry,
          packet
        })));
      }
      break;
    case temp_event_t.TE_FLASHLIGHT:
      effect.category = "temp-entity";
      if (packet.position) {
        effects.push(...CL_Flashlight(packet.position, packet.entity ?? 0).map((entry) => ({
          ...entry,
          packet
        })));
      }
      break;
    case temp_event_t.TE_FORCEWALL:
      effect.category = "particle";
      if (packet.position && packet.position2) {
        effects.push(...CL_ForceWall(packet.position, packet.position2, packet.color ?? 0).map((entry) => ({
          ...entry,
          packet
        })));
      }
      break;
    case temp_event_t.TE_TRACKER_EXPLOSION:
      effect.category = "particle";
      if (packet.position) {
        effect.position = [...packet.position];
      }
      if (packet.position) {
        effects.push(...CL_ColorFlash(packet.position, 0, 150, -1, -1, -1).map((entry) => ({
          ...entry,
          packet
        })));
        effects.push(...CL_ColorExplosionParticles(packet.position, 0, 1).map((entry) => ({
          ...entry,
          packet
        })));
      }
      effect.sound = {
        name: "weapons/disrupthit.wav",
        channel: CHAN_AUTO,
        attenuation: ATTN_NORM
      };
      effect.light = {
        radius: 150,
        color: [-1, -1, -1],
        durationMs: 100
      };
      break;
    case temp_event_t.TE_TELEPORT_EFFECT:
    case temp_event_t.TE_DBALL_GOAL:
      effect.category = "particle";
      if (packet.position) {
        effects.push(...CL_TeleportParticles(packet.position));
      }
      break;
    case temp_event_t.TE_WIDOWSPLASH:
      effect.category = "particle";
      if (packet.position) {
        effects.push(...CL_WidowSplash(packet.position).map((entry) => ({
          ...entry,
          packet
        })));
      }
      break;
    default:
      break;
  }

  return effects;
}

/**
 * Original name: CL_ParseTEnt
 * Source: client/cl_tent.c and client/cl_newfx.c
 * Category: Ported integration
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies the immediate runtime-side particle and dlight effects implied by one parsed temp-entity packet.
 *
 * Porting notes:
 * - Leaves persistent temp-entity families to `CL_AddTEntPacket`.
 * - Focuses on the immediate `cl_fx.c` / `cl_newfx.c` side effects that mutate the client particle and dlight pools.
 */
export function CL_ExecuteTempEntityEffects(runtime: ClientRuntime, packet: ClientTempEntityPacket): void {
  switch (packet.type) {
    case temp_event_t.TE_BLOOD:
      if (packet.position && packet.directionByte !== undefined) {
        CL_ParticleEffect(runtime, packet.position, DirFromByte(packet.directionByte), 0xe8, 60);
      }
      break;
    case temp_event_t.TE_GUNSHOT:
      if (packet.position && packet.directionByte !== undefined) {
        CL_ParticleEffect(runtime, packet.position, DirFromByte(packet.directionByte), 0, 40);
      }
      break;
    case temp_event_t.TE_SPARKS:
    case temp_event_t.TE_BULLET_SPARKS:
      if (packet.position && packet.directionByte !== undefined) {
        CL_ParticleEffect(runtime, packet.position, DirFromByte(packet.directionByte), 0xe0, 6);
      }
      break;
    case temp_event_t.TE_SCREEN_SPARKS:
      if (packet.position && packet.directionByte !== undefined) {
        CL_ParticleEffect(runtime, packet.position, DirFromByte(packet.directionByte), 0xd0, 40);
      }
      break;
    case temp_event_t.TE_SHIELD_SPARKS:
      if (packet.position && packet.directionByte !== undefined) {
        CL_ParticleEffect(runtime, packet.position, DirFromByte(packet.directionByte), 0xb0, 40);
      }
      break;
    case temp_event_t.TE_SHOTGUN:
      if (packet.position && packet.directionByte !== undefined) {
        CL_ParticleEffect(runtime, packet.position, DirFromByte(packet.directionByte), 0, 20);
      }
      break;
    case temp_event_t.TE_SPLASH:
      if (packet.position && packet.directionByte !== undefined) {
        CL_ParticleEffect(runtime, packet.position, DirFromByte(packet.directionByte), mapSplashColor(packet.color ?? 0), packet.count ?? 0);
      }
      break;
    case temp_event_t.TE_LASER_SPARKS:
    case temp_event_t.TE_WELDING_SPARKS:
      if (packet.position && packet.directionByte !== undefined) {
        CL_ParticleEffect2(runtime, packet.position, DirFromByte(packet.directionByte), packet.color ?? 0, packet.count ?? 0);
      }
      break;
    case temp_event_t.TE_GREENBLOOD:
      if (packet.position && packet.directionByte !== undefined) {
        CL_ParticleEffect2(runtime, packet.position, DirFromByte(packet.directionByte), 0xdf, 30);
      }
      break;
    case temp_event_t.TE_TUNNEL_SPARKS:
      if (packet.position && packet.directionByte !== undefined) {
        CL_ParticleEffect3(runtime, packet.position, DirFromByte(packet.directionByte), packet.color ?? 0, packet.count ?? 0);
      }
      break;
    case temp_event_t.TE_ELECTRIC_SPARKS:
      if (packet.position && packet.directionByte !== undefined) {
        CL_ParticleEffect(runtime, packet.position, DirFromByte(packet.directionByte), 0x75, 40);
      }
      break;
    case temp_event_t.TE_MOREBLOOD:
      if (packet.position && packet.directionByte !== undefined) {
        CL_ParticleEffect(runtime, packet.position, DirFromByte(packet.directionByte), 0xe8, 250);
      }
      break;
    case temp_event_t.TE_BLASTER:
      if (packet.position && packet.directionByte !== undefined) {
        CL_BlasterParticles(runtime, packet.position, DirFromByte(packet.directionByte));
        const dlight = CL_AllocDlight(runtime, 0);
        dlight.origin = [...packet.position];
        dlight.radius = 150;
        dlight.minlight = 0;
        dlight.die = runtime.cl.time + 100;
        dlight.color = [1, 1, 0];
      }
      break;
    case temp_event_t.TE_BLASTER2:
      if (packet.position && packet.directionByte !== undefined) {
        CL_BlasterParticles2(runtime, packet.position, DirFromByte(packet.directionByte), 0xd0);
      }
      break;
    case temp_event_t.TE_BLUEHYPERBLASTER:
      if (packet.position && packet.direction) {
        CL_BlueBlasterParticles(runtime, packet.position, packet.direction);
      }
      break;
    case temp_event_t.TE_FLECHETTE:
      if (packet.position && packet.directionByte !== undefined) {
        CL_BlasterParticles2(runtime, packet.position, DirFromByte(packet.directionByte), 0x6f);
      }
      break;
    case temp_event_t.TE_DEBUGTRAIL:
      if (packet.position && packet.position2) {
        CL_DebugTrail(runtime, packet.position, packet.position2);
      }
      break;
    case temp_event_t.TE_RAILTRAIL:
      if (packet.position && packet.position2) {
        CL_RailTrail(runtime, packet.position, packet.position2);
      }
      break;
    case temp_event_t.TE_HEATBEAM_SPARKS:
      if (packet.position && packet.directionByte !== undefined) {
        CL_ParticleSteamEffect(runtime, packet.position, DirFromByte(packet.directionByte), 8, 50, 60);
      }
      break;
    case temp_event_t.TE_HEATBEAM_STEAM:
      if (packet.position && packet.directionByte !== undefined) {
        CL_ParticleSteamEffect(runtime, packet.position, DirFromByte(packet.directionByte), 0xe0, 20, 60);
      }
      break;
    case temp_event_t.TE_STEAM:
      if (packet.id === -1 && packet.position && packet.directionByte !== undefined) {
        CL_ParticleSteamEffect(
          runtime,
          packet.position,
          DirFromByte(packet.directionByte),
          packet.color ?? 0,
          packet.count ?? 0,
          packet.magnitude ?? 0
        );
      }
      break;
    case temp_event_t.TE_BUBBLETRAIL2:
      if (packet.position && packet.position2) {
        CL_BubbleTrail2(runtime, packet.position, packet.position2, 8);
      }
      break;
    case temp_event_t.TE_BUBBLETRAIL:
      if (packet.position && packet.position2) {
        CL_BubbleTrail(runtime, packet.position, packet.position2);
      }
      break;
    case temp_event_t.TE_CHAINFIST_SMOKE:
      if (packet.position) {
        CL_ParticleSmokeEffect(runtime, packet.position, [0, 0, 1], 0, 20, 20);
      }
      break;
    case temp_event_t.TE_FLASHLIGHT:
      if (packet.position) {
        CL_Flashlight(runtime, packet.position, packet.entity ?? 0);
      }
      break;
    case temp_event_t.TE_FORCEWALL:
      if (packet.position && packet.position2) {
        CL_ForceWall(runtime, packet.position, packet.position2, packet.color ?? 0);
      }
      break;
    case temp_event_t.TE_TRACKER_EXPLOSION:
      if (packet.position) {
        CL_ColorFlash(runtime, packet.position, 0, 150, -1, -1, -1);
        CL_ColorExplosionParticles(runtime, packet.position, 0, 1);
      }
      break;
    case temp_event_t.TE_EXPLOSION1:
    case temp_event_t.TE_ROCKET_EXPLOSION:
    case temp_event_t.TE_ROCKET_EXPLOSION_WATER:
    case temp_event_t.TE_EXPLOSION2:
    case temp_event_t.TE_GRENADE_EXPLOSION:
    case temp_event_t.TE_GRENADE_EXPLOSION_WATER:
    case temp_event_t.TE_PLASMA_EXPLOSION:
      if (packet.position) {
        CL_ExplosionParticles(runtime, packet.position);
      }
      break;
    case temp_event_t.TE_BFG_BIGEXPLOSION:
      if (packet.position) {
        CL_BFGExplosionParticles(runtime, packet.position);
      }
      break;
    case temp_event_t.TE_TELEPORT_EFFECT:
    case temp_event_t.TE_DBALL_GOAL:
      if (packet.position) {
        CL_TeleportParticles(runtime, packet.position);
      }
      break;
    case temp_event_t.TE_BOSSTPORT:
      if (packet.position) {
        CL_BigTeleportParticles(runtime, packet.position);
      }
      break;
    case temp_event_t.TE_WIDOWSPLASH:
      if (packet.position) {
        CL_WidowSplash(runtime, packet.position);
      }
      break;
    default:
      break;
  }
}

/**
 * Original name: CL_AddPacketEntities
 * Source: client/cl_ents.c
 * Category: Ported integration
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies projectile/entity trails as particles while packet entities are composed for refresh.
 */
export function CL_ExecutePacketEntityEffects(
  runtime: ClientRuntime,
  entities: readonly ClientPacketEntityEffectSource[]
): void {
  for (const entity of entities) {
    const effects = entity.effects;
    if ((effects & ~0x00000001) === 0) {
      continue;
    }

    const centity = runtime.cl_entities[entity.number];
    if (!centity) {
      continue;
    }

    if ((effects & EF_ROCKET) !== 0) {
      CL_RocketTrail(runtime, centity.lerp_origin, entity.origin, centity);
    } else if ((effects & EF_BLASTER) !== 0) {
      if ((effects & EF_TRACKER) !== 0) {
        CL_BlasterTrail2(runtime, centity.lerp_origin, entity.origin);
      } else {
        CL_BlasterTrail(runtime, centity.lerp_origin, entity.origin);
      }
    } else if ((effects & EF_GIB) !== 0) {
      CL_DiminishingTrail(runtime, centity.lerp_origin, entity.origin, centity, effects);
    } else if ((effects & EF_GRENADE) !== 0) {
      CL_DiminishingTrail(runtime, centity.lerp_origin, entity.origin, centity, effects);
    } else if ((effects & EF_GREENGIB) !== 0) {
      CL_DiminishingTrail(runtime, centity.lerp_origin, entity.origin, centity, effects);
    } else if ((effects & EF_IONRIPPER) !== 0) {
      CL_IonripperTrail(runtime, centity.lerp_origin, entity.origin);
    } else if ((effects & EF_FLIES) !== 0) {
      CL_FlyEffectRuntime(runtime, centity, entity.origin);
    } else if ((effects & EF_BFG) !== 0 && (effects & EF_ANIM_ALLFAST) !== 0) {
      CL_BfgParticles(runtime, entity.origin);
    } else if ((effects & EF_TRAP) !== 0) {
      CL_TrapParticles(runtime, [entity.origin[0], entity.origin[1], entity.origin[2] + 32]);
    } else if ((effects & EF_PLASMA) !== 0 && (effects & EF_ANIM_ALLFAST) !== 0) {
      CL_BlasterTrail(runtime, centity.lerp_origin, entity.origin);
    } else if (!entity.viewerEntity && (entity.modelindex ?? 0) !== 0 && (effects & EF_FLAG1) !== 0) {
      CL_FlagTrail(runtime, centity.lerp_origin, entity.origin, 242);
    } else if (!entity.viewerEntity && (entity.modelindex ?? 0) !== 0 && (effects & EF_FLAG2) !== 0) {
      CL_FlagTrail(runtime, centity.lerp_origin, entity.origin, 115);
    } else if (!entity.viewerEntity && (entity.modelindex ?? 0) !== 0 && (effects & EF_TAGTRAIL) !== 0) {
      CL_TagTrail(runtime, centity.lerp_origin, entity.origin, 220);
    } else if (!entity.viewerEntity && (entity.modelindex ?? 0) !== 0 && (effects & EF_TRACKERTRAIL) !== 0) {
      if ((effects & EF_TRACKER) === 0) {
        CL_Tracker_Shell(runtime, centity.lerp_origin);
      }
    } else if (!entity.viewerEntity && (entity.modelindex ?? 0) !== 0 && (effects & EF_TRACKER) !== 0) {
      CL_TrackerTrail(runtime, centity.lerp_origin, entity.origin, 0);
    }
  }
}

/**
 * Original name: N/A
 * Source: N/A (runtime effect builder)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Behavior:
 * - Converts one parsed auxiliary particle-effect packet into normalized effect metadata.
 *
 * Porting notes:
 * - `CL_ParseParticles` is owned by `cl_tent.ts`; this helper only exposes the parsed packet as action-effect data.
 */
export function CL_BuildParticleEffects(packet: ClientParticleEffectPacket): ClientActionEffect[] {
  return [{
    category: "particle",
    kind: packet.kind,
    position: [...packet.position],
    direction: DirFromByte(packet.directionByte),
    color: packet.color,
    count: packet.count
  }];
}

/**
 * Original name: CL_TeleporterParticles
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the short upward teleporter puff attached to one entity state origin.
 */
export function CL_TeleporterParticles(ent: entity_state_t): ClientActionEffect[];
export function CL_TeleporterParticles(runtime: ClientRuntime, ent: entity_state_t | vec3_t): void;
export function CL_TeleporterParticles(
  runtimeOrEnt: ClientRuntime | entity_state_t,
  maybeEnt?: entity_state_t | vec3_t
): ClientActionEffect[] | void {
  if ("origin" in runtimeOrEnt) {
    return [{
      category: "particle",
      kind: "teleporter-particles",
      position: [...runtimeOrEnt.origin],
      color: 0xdb,
      count: 8,
      magnitude: 16,
      durationMs: 200
    }];
  }

  const runtime = runtimeOrEnt;
  const ent = maybeEnt as entity_state_t;
  const origin = Array.isArray(maybeEnt) ? maybeEnt : ent.origin;
  for (let index = 0; index < 8; index += 1) {
    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.time = runtime.cl.time;
    particle.color = 0xdb;
    particle.org[0] = origin[0] - 16 + (Math.floor(Math.random() * 32));
    particle.org[1] = origin[1] - 16 + (Math.floor(Math.random() * 32));
    particle.org[2] = origin[2] - 8 + (Math.floor(Math.random() * 8));
    particle.vel[0] = crand() * 14;
    particle.vel[1] = crand() * 14;
    particle.vel[2] = 80 + (Math.floor(Math.random() * 8));
    particle.accel[0] = 0;
    particle.accel[1] = 0;
    particle.accel[2] = -PARTICLE_GRAVITY;
    particle.alpha = 1.0;
    particle.alphavel = -0.5;
  }
}

/**
 * Original name: CL_LogoutEffect
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the login/logout/respawn particle burst with the original palette family.
 */
export function CL_LogoutEffect(org: vec3_t, type: number): ClientActionEffect[];
export function CL_LogoutEffect(runtime: ClientRuntime, org: vec3_t, type: number): void;
export function CL_LogoutEffect(
  runtimeOrOrg: ClientRuntime | vec3_t,
  orgOrType: vec3_t | number,
  maybeType?: number
): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrOrg)) {
    let color = 0xe0;
    if (orgOrType === MZ_LOGIN) {
      color = 0xd0;
    } else if (orgOrType === MZ_LOGOUT) {
      color = 0x40;
    }

    return [{
      category: "particle",
      kind: "logout-effect",
      position: [...runtimeOrOrg],
      color,
      count: 500,
      magnitude: 20,
      durationMs: 1000
    }];
  }

  const runtime = runtimeOrOrg;
  const org = orgOrType as vec3_t;
  const type = maybeType as number;
  for (let index = 0; index < 500; index += 1) {
    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.time = runtime.cl.time;
    if (type === MZ_LOGIN) {
      particle.color = 0xd0 + (Math.floor(Math.random() * 0x7fffffff) & 7);
    } else if (type === MZ_LOGOUT) {
      particle.color = 0x40 + (Math.floor(Math.random() * 0x7fffffff) & 7);
    } else {
      particle.color = 0xe0 + (Math.floor(Math.random() * 0x7fffffff) & 7);
    }

    particle.org[0] = org[0] - 16 + frand() * 32;
    particle.org[1] = org[1] - 16 + frand() * 32;
    particle.org[2] = org[2] - 24 + frand() * 56;
    particle.vel[0] = crand() * 20;
    particle.vel[1] = crand() * 20;
    particle.vel[2] = crand() * 20;
    particle.accel[0] = 0;
    particle.accel[1] = 0;
    particle.accel[2] = -PARTICLE_GRAVITY;
    particle.alpha = 1.0;
    particle.alphavel = -1.0 / (1.0 + frand() * 0.3);
  }
}

/**
 * Original name: CL_ItemRespawnParticles
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the logical item-respawn particle burst metadata.
 *
 * Porting notes:
 * - Preserves the original color family, count and gravity profile as structured data.
 */
export function CL_ItemRespawnParticles(org: vec3_t): ClientActionEffect[];
export function CL_ItemRespawnParticles(runtime: ClientRuntime, org: vec3_t): void;
export function CL_ItemRespawnParticles(runtimeOrOrg: ClientRuntime | vec3_t, maybeOrg?: vec3_t): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrOrg)) {
    return [createParticleBurst("item-respawn-particles", runtimeOrOrg, 0xd4, 64, 8, 8, 0.2)];
  }

  const runtime = runtimeOrOrg;
  const org = maybeOrg as vec3_t;
  for (let index = 0; index < 64; index += 1) {
    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.time = runtime.cl.time;
    particle.color = 0xd4 + (Math.floor(Math.random() * 0x7fffffff) & 3);
    particle.org = [org[0] + crand() * 8, org[1] + crand() * 8, org[2] + crand() * 8];
    particle.vel = [crand() * 8, crand() * 8, crand() * 8];
    particle.accel[0] = 0;
    particle.accel[1] = 0;
    particle.accel[2] = -PARTICLE_GRAVITY * 0.2;
    particle.alpha = 1.0;
    particle.alphavel = -1.0 / (1.0 + frand() * 0.3);
  }
}

/**
 * Original name: CL_ExplosionParticles
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the logical explosion particle burst metadata.
 */
export function CL_ExplosionParticles(org: vec3_t): ClientActionEffect[];
export function CL_ExplosionParticles(runtime: ClientRuntime, org: vec3_t): void;
export function CL_ExplosionParticles(runtimeOrOrg: ClientRuntime | vec3_t, maybeOrg?: vec3_t): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrOrg)) {
    return [createParticleBurst("explosion-particles", runtimeOrOrg, 0xe0, 256, 16, 192, 1)];
  }

  const runtime = runtimeOrOrg;
  const org = maybeOrg as vec3_t;
  for (let index = 0; index < 256; index += 1) {
    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.time = runtime.cl.time;
    particle.color = 0xe0 + (Math.floor(Math.random() * 0x7fffffff) & 7);
    for (let component = 0; component < 3; component += 1) {
      particle.org[component] = org[component] + (Math.floor(Math.random() * 32) - 16);
      particle.vel[component] = Math.floor(Math.random() * 384) - 192;
    }
    particle.accel[0] = 0;
    particle.accel[1] = 0;
    particle.accel[2] = -PARTICLE_GRAVITY;
    particle.alpha = 1.0;
    particle.alphavel = -0.8 / (0.5 + frand() * 0.3);
  }
}

/**
 * Original name: CL_BigTeleportParticles
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the original big-teleport spiral cloud metadata.
 */
export function CL_BigTeleportParticles(org: vec3_t): ClientActionEffect[];
export function CL_BigTeleportParticles(runtime: ClientRuntime, org: vec3_t): void;
export function CL_BigTeleportParticles(runtimeOrOrg: ClientRuntime | vec3_t, maybeOrg?: vec3_t): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrOrg)) {
    return [{
      category: "particle",
      kind: "big-teleport-particles",
      position: [...runtimeOrOrg],
      count: 4096
    }];
  }

  const runtime = runtimeOrOrg;
  const org = maybeOrg as vec3_t;
  const colortable = [2 * 8, 13 * 8, 21 * 8, 18 * 8];
  for (let index = 0; index < 4096; index += 1) {
    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.time = runtime.cl.time;
    particle.color = colortable[Math.floor(Math.random() * 0x7fffffff) & 3];

    const angle = Math.PI * 2 * ((Math.floor(Math.random() * 0x7fffffff) & 1023) / 1023.0);
    const dist = Math.floor(Math.random() * 0x7fffffff) & 31;
    const cosAngle = Math.cos(angle);
    const sinAngle = Math.sin(angle);

    particle.org[0] = org[0] + cosAngle * dist;
    particle.vel[0] = cosAngle * (70 + (Math.floor(Math.random() * 0x7fffffff) & 63));
    particle.accel[0] = -cosAngle * 100;
    particle.org[1] = org[1] + sinAngle * dist;
    particle.vel[1] = sinAngle * (70 + (Math.floor(Math.random() * 0x7fffffff) & 63));
    particle.accel[1] = -sinAngle * 100;
    particle.org[2] = org[2] + 8 + (Math.floor(Math.random() * 90));
    particle.vel[2] = -100 + (Math.floor(Math.random() * 0x7fffffff) & 31);
    particle.accel[2] = PARTICLE_GRAVITY * 4;
    particle.alpha = 1.0;
    particle.alphavel = -0.3 / (0.5 + frand() * 0.3);
  }
}

/**
 * Original name: CL_BlasterParticles
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the wall-impact blaster puff metadata.
 */
export function CL_BlasterParticles(org: vec3_t, dir: vec3_t): ClientActionEffect[];
export function CL_BlasterParticles(runtime: ClientRuntime, org: vec3_t, dir: vec3_t): void;
export function CL_BlasterParticles(
  runtimeOrOrg: ClientRuntime | vec3_t,
  orgOrDir: vec3_t,
  maybeDir?: vec3_t
): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrOrg)) {
    return [{
      category: "particle",
      kind: "blaster-particles",
      position: [...runtimeOrOrg],
      direction: [...orgOrDir],
      color: 0xe0,
      count: 40
    }];
  }

  const runtime = runtimeOrOrg;
  const org = orgOrDir;
  const dir = maybeDir as vec3_t;
  for (let index = 0; index < 40; index += 1) {
    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.time = runtime.cl.time;
    particle.color = 0xe0 + (Math.floor(Math.random() * 0x7fffffff) & 7);
    const d = Math.floor(Math.random() * 0x7fffffff) & 15;
    for (let component = 0; component < 3; component += 1) {
      particle.org[component] = org[component] + ((Math.floor(Math.random() * 0x7fffffff) & 7) - 4) + (d * dir[component]);
      particle.vel[component] = (dir[component] * 30) + (crand() * 40);
    }
    particle.accel[0] = 0;
    particle.accel[1] = 0;
    particle.accel[2] = -PARTICLE_GRAVITY;
    particle.alpha = 1.0;
    particle.alphavel = -1.0 / (0.5 + frand() * 0.3);
  }
}

/**
 * Original name: CL_BlasterTrail
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the original yellow blaster trail particles between two points.
 *
 * Porting notes:
 * - The no-runtime overload only exposes structured metadata for browser adapters.
 */
export function CL_BlasterTrail(start: vec3_t, end: vec3_t): ClientActionEffect[];
export function CL_BlasterTrail(runtime: ClientRuntime, start: vec3_t, end: vec3_t): void;
export function CL_BlasterTrail(
  runtimeOrStart: ClientRuntime | vec3_t,
  startOrEnd: vec3_t,
  maybeEnd?: vec3_t
): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrStart)) {
    return [createTrailEffect("blaster-trail", runtimeOrStart, startOrEnd, 0xe0, 5)];
  }

  spawnSimpleTrailParticles(runtimeOrStart, startOrEnd, maybeEnd as vec3_t, {
    spacing: 5,
    colorBase: 0xe0,
    colorMask: 0,
    alphaVelocityBase: 0.3,
    alphaVelocityRandom: 0.2,
    originJitter: 1,
    velocityJitter: 5,
    gravity: false
  });
}

/**
 * Original name: CL_QuadTrail
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the original quad trail particles between two points.
 *
 * Porting notes:
 * - The no-runtime overload only exposes structured metadata for browser adapters.
 */
export function CL_QuadTrail(start: vec3_t, end: vec3_t): ClientActionEffect[];
export function CL_QuadTrail(runtime: ClientRuntime, start: vec3_t, end: vec3_t): void;
export function CL_QuadTrail(
  runtimeOrStart: ClientRuntime | vec3_t,
  startOrEnd: vec3_t,
  maybeEnd?: vec3_t
): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrStart)) {
    return [createTrailEffect("quad-trail", runtimeOrStart, startOrEnd, 115, 5)];
  }

  spawnSimpleTrailParticles(runtimeOrStart, startOrEnd, maybeEnd as vec3_t, {
    spacing: 5,
    colorBase: 115,
    colorMask: 0,
    alphaVelocityBase: 0.8,
    alphaVelocityRandom: 0.2,
    originJitter: 16,
    velocityJitter: 5,
    gravity: false
  });
}

/**
 * Original name: CL_FlagTrail
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the original CTF flag trail particles between two points.
 *
 * Porting notes:
 * - The no-runtime overload only exposes structured metadata for browser adapters.
 */
export function CL_FlagTrail(start: vec3_t, end: vec3_t, color: number): ClientActionEffect[];
export function CL_FlagTrail(runtime: ClientRuntime, start: vec3_t, end: vec3_t, color: number): void;
export function CL_FlagTrail(
  runtimeOrStart: ClientRuntime | vec3_t,
  startOrEnd: vec3_t,
  endOrColor: vec3_t | number,
  maybeColor?: number
): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrStart)) {
    return [createTrailEffect("flag-trail", runtimeOrStart, startOrEnd, endOrColor as number, 5)];
  }

  spawnSimpleTrailParticles(runtimeOrStart, startOrEnd, endOrColor as vec3_t, {
    spacing: 5,
    colorBase: maybeColor as number,
    colorMask: 0,
    alphaVelocityBase: 0.8,
    alphaVelocityRandom: 0.2,
    originJitter: 16,
    velocityJitter: 5,
    gravity: false
  });
}

/**
 * Original name: CL_DiminishingTrail
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the logical diminishing trail metadata using the original flag families and trailcount state.
 *
 * Porting notes:
 * - Keeps the original `trailcount` decay mutation on the passed `centity_t`.
 */
export function CL_DiminishingTrail(start: vec3_t, end: vec3_t, old: centity_t, flags: number): ClientActionEffect[];
export function CL_DiminishingTrail(runtime: ClientRuntime, start: vec3_t, end: vec3_t, old: centity_t, flags: number): void;
export function CL_DiminishingTrail(
  runtimeOrStart: ClientRuntime | vec3_t,
  startOrEnd: vec3_t,
  endOrOld: vec3_t | centity_t,
  oldOrFlags: centity_t | number,
  maybeFlags?: number
): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrStart)) {
    const start = runtimeOrStart;
    const end = startOrEnd;
    const old = endOrOld as centity_t;
    const flags = oldOrFlags as number;
    const effects: ClientActionEffect[] = [];
    const kind = (flags & EF_GIB) !== 0
      ? "diminishing-trail-gib"
      : (flags & EF_GREENGIB) !== 0
        ? "diminishing-trail-greengib"
        : "diminishing-trail";
    const color = (flags & EF_GIB) !== 0 ? 0xe8 : (flags & EF_GREENGIB) !== 0 ? 0xdb : 4;
    effects.push(createTrailEffect(kind, start, end, color, 0.5));
    let len = normalizeVectorCopy(subtractVec3(end, start));
    while (len > 0) {
      len -= 0.5;
      old.trailcount = Math.max(100, old.trailcount - 5);
    }
    return effects;
  }

  spawnDiminishingTrailParticles(
    runtimeOrStart,
    startOrEnd,
    endOrOld as vec3_t,
    oldOrFlags as centity_t,
    maybeFlags ?? 0
  );
}

/**
 * Original name: MakeNormalVectors
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Builds orthogonal right/up vectors from one normalized forward vector.
 *
 * Porting notes:
 * - The C local `d` is the dot product used to remove the forward projection from `right`.
 */
export function MakeNormalVectors(forward: vec3_t): { right: vec3_t; up: vec3_t } {
  const right: vec3_t = [forward[2], -forward[0], forward[1]];
  const dot = (right[0] * forward[0]) + (right[1] * forward[1]) + (right[2] * forward[2]);
  right[0] -= dot * forward[0];
  right[1] -= dot * forward[1];
  right[2] -= dot * forward[2];
  normalizeVector(right);
  const up = crossProduct(right, forward);
  return { right, up };
}

/**
 * Original name: CL_RocketTrail
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the original combined smoke and fire rocket trail metadata.
 */
export function CL_RocketTrail(start: vec3_t, end: vec3_t, old: centity_t): ClientActionEffect[];
export function CL_RocketTrail(runtime: ClientRuntime, start: vec3_t, end: vec3_t, old: centity_t): void;
export function CL_RocketTrail(
  runtimeOrStart: ClientRuntime | vec3_t,
  startOrEnd: vec3_t,
  endOrOld: vec3_t | centity_t,
  maybeOld?: centity_t
): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrStart)) {
    const start = runtimeOrStart;
    const end = startOrEnd;
    const old = endOrOld as centity_t;
    return [
      ...CL_DiminishingTrail(start, end, old, EF_ROCKET),
      createTrailEffect("rocket-fire-trail", start, end, 0xdc, 1)
    ];
  }

  const runtime = runtimeOrStart;
  const start = startOrEnd;
  const end = endOrOld as vec3_t;
  CL_DiminishingTrail(runtime, start, end, maybeOld as centity_t, EF_ROCKET);
  spawnSimpleTrailParticles(runtime, start, end, {
    spacing: 1,
    colorBase: 0xdc,
    colorMask: 3,
    alphaVelocityBase: 1,
    alphaVelocityRandom: 0.2,
    originJitter: 5,
    velocityJitter: 20,
    gravity: true,
    randomChanceMask: 7
  });
}

/**
 * Original name: CL_RailTrail
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the spiral rail core and the secondary spark trail metadata.
 */
export function CL_RailTrail(start: vec3_t, end: vec3_t): ClientActionEffect[];
export function CL_RailTrail(runtime: ClientRuntime, start: vec3_t, end: vec3_t): void;
export function CL_RailTrail(
  runtimeOrStart: ClientRuntime | vec3_t,
  startOrEnd: vec3_t,
  maybeEnd?: vec3_t
): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrStart)) {
    return [
      createTrailEffect("rail-core-trail", runtimeOrStart, startOrEnd, 0x74, 1),
      createTrailEffect("rail-spark-trail", runtimeOrStart, startOrEnd, 0x0, 0.75)
    ];
  }

  spawnRailTrailParticles(runtimeOrStart, startOrEnd, maybeEnd as vec3_t);
}

/**
 * Original name: CL_IonripperTrail
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the alternating ion ripper trail particles or metadata.
 *
 * Porting notes:
 * - Runtime mode preserves the original `left` alternation and fixed 5-unit step; metadata mode is an adapter for browser effect descriptions.
 */
export function CL_IonripperTrail(start: vec3_t, end: vec3_t): ClientActionEffect[];
export function CL_IonripperTrail(runtime: ClientRuntime, start: vec3_t, end: vec3_t): void;
export function CL_IonripperTrail(
  runtimeOrStart: ClientRuntime | vec3_t,
  startOrEnd: vec3_t,
  maybeEnd?: vec3_t
): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrStart)) {
    return [createTrailEffect("ionripper-trail", runtimeOrStart, startOrEnd, 0xe4, 5)];
  }

  spawnIonripperTrailParticles(runtimeOrStart, startOrEnd, maybeEnd as vec3_t);
}

/**
 * Original name: CL_BubbleTrail
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits underwater bubble trail particles between two parsed temp-entity positions.
 *
 * Porting notes:
 * - Preserves the C loop step `dec = 32`, palette base `4`, origin jitter `crand() * 2`,
 *   velocity jitter `crand() * 5`, and upward velocity boost `vel[2] += 6`.
 * - Descriptor overload is used by web/audio adapters; runtime overload mutates the client particle pool.
 */
export function CL_BubbleTrail(start: vec3_t, end: vec3_t): ClientActionEffect[];
export function CL_BubbleTrail(runtime: ClientRuntime, start: vec3_t, end: vec3_t): void;
export function CL_BubbleTrail(
  runtimeOrStart: ClientRuntime | vec3_t,
  startOrEnd: vec3_t,
  maybeEnd?: vec3_t
): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrStart)) {
    return [createTrailEffect("bubble-trail", runtimeOrStart, startOrEnd, 4, 32)];
  }

  const runtime = runtimeOrStart;
  const start = startOrEnd;
  const end = maybeEnd as vec3_t;
  const move = [...start] as vec3_t;
  const vec = subtractVec3(end, start);
  const len = normalizeVectorCopy(vec);
  const dec = 32;

  vec[0] *= dec;
  vec[1] *= dec;
  vec[2] *= dec;

  for (let index = 0; index < len; index += dec) {
    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.accel = [0, 0, 0];
    particle.time = runtime.cl.time;
    particle.alpha = 1.0;
    particle.alphavel = -1.0 / (1 + frand() * 0.2);
    particle.color = 4 + (Math.floor(Math.random() * 0x7fffffff) & 7);
    for (let component = 0; component < 3; component += 1) {
      particle.org[component] = move[component] + crand() * 2;
      particle.vel[component] = crand() * 5;
    }
    particle.vel[2] += 6;

    move[0] += vec[0];
    move[1] += vec[1];
    move[2] += vec[2];
  }
}

/**
 * Original name: CL_FlyParticles
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the orbiting fly particle cloud metadata for a given count.
 */
export function CL_FlyParticles(origin: vec3_t, count: number): ClientActionEffect[];
export function CL_FlyParticles(runtime: ClientRuntime, origin: vec3_t, count: number): void;
export function CL_FlyParticles(runtimeOrOrigin: ClientRuntime | vec3_t, maybeOriginOrCount: vec3_t | number, maybeCount?: number): ClientActionEffect[] | void {
  if (isClientRuntime(runtimeOrOrigin)) {
    spawnFlyParticles(runtimeOrOrigin, maybeOriginOrCount as vec3_t, maybeCount ?? 0);
    return;
  }

  const origin = runtimeOrOrigin;
  const count = maybeOriginOrCount as number;
  return [{
    category: "particle",
    kind: "fly-particles",
    position: [...origin],
    count
  }];
}

/**
 * Original name: CL_FlyEffect
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Computes the original ramp-up / ramp-down fly particle count and emits the matching cloud.
 */
export function CL_FlyEffect(ent: centity_t, origin: vec3_t, time: number): ClientActionEffect[] {
  let starttime: number;
  if (ent.fly_stoptime < time) {
    starttime = time;
    ent.fly_stoptime = time + 60000;
  } else {
    starttime = ent.fly_stoptime - 60000;
  }

  let n = time - starttime;
  let count: number;
  if (n < 20000) {
    count = Math.floor((n * 162) / 20000.0);
  } else {
    n = ent.fly_stoptime - time;
    count = n < 20000 ? Math.floor((n * 162) / 20000.0) : 162;
  }

  return CL_FlyParticles(origin, count);
}

/**
 * Original name: CL_FlyEffect
 * Source: client/cl_fx.c
 * Category: Adapter
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies packet-entity fly particles directly into the active client particle pool.
 */
function CL_FlyEffectRuntime(runtime: ClientRuntime, ent: centity_t, origin: vec3_t): void {
  const effects = CL_FlyEffect(ent, origin, runtime.cl.time);
  CL_FlyParticles(runtime, origin, effects[0]?.count ?? 0);
}

/**
 * Original name: CL_BfgParticles
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the orbiting BFG particle cloud metadata or spawns the runtime particle cloud.
 *
 * Porting notes:
 * - Runtime mode preserves the shared `avelocities`, `bytedirs`, `BEAMLENGTH`, distance-derived
 *   color/alpha and `alphavel = -100` behavior from the original `entity_t *ent` path.
 */
export function CL_BfgParticles(origin: vec3_t): ClientActionEffect[];
export function CL_BfgParticles(runtime: ClientRuntime, origin: vec3_t): void;
export function CL_BfgParticles(runtimeOrOrigin: ClientRuntime | vec3_t, maybeOrigin?: vec3_t): ClientActionEffect[] | void {
  if (isClientRuntime(runtimeOrOrigin)) {
    spawnBfgParticles(runtimeOrOrigin, maybeOrigin ?? [0, 0, 0]);
    return;
  }

  const origin = runtimeOrOrigin;
  return [{
    category: "particle",
    kind: "bfg-particles",
    position: [...origin],
    count: 162
  }];
}

/**
 * Original name: CL_TrapParticles
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the original trap beam and burst particle metadata, or spawns the runtime particles.
 *
 * Porting notes:
 * - Runtime callers pass the `entity_t.origin` after the `CL_AddPacketEntities` `+32` Z adjustment,
 *   matching the C call site before `CL_TrapParticles` applies its internal `-14`/`+14` offsets.
 */
export function CL_TrapParticles(origin: vec3_t): ClientActionEffect[];
export function CL_TrapParticles(runtime: ClientRuntime, origin: vec3_t): void;
export function CL_TrapParticles(runtimeOrOrigin: ClientRuntime | vec3_t, maybeOrigin?: vec3_t): ClientActionEffect[] | void {
  if (isClientRuntime(runtimeOrOrigin)) {
    spawnTrapParticles(runtimeOrOrigin, maybeOrigin ?? [0, 0, 0]);
    return;
  }

  const origin = runtimeOrOrigin;
  return [
    createTrailEffect("trap-column-trail", [origin[0], origin[1], origin[2] - 14], [origin[0], origin[1], origin[2] + 50], 0xe0, 5),
    {
      category: "particle",
      kind: "trap-burst-particles",
      position: [...origin],
      color: 0xe0,
      count: 8
    }
  ];
}

/**
 * Original name: CL_BFGExplosionParticles
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the BFG explosion particle burst metadata.
 */
export function CL_BFGExplosionParticles(org: vec3_t): ClientActionEffect[];
export function CL_BFGExplosionParticles(runtime: ClientRuntime, org: vec3_t): void;
export function CL_BFGExplosionParticles(runtimeOrOrg: ClientRuntime | vec3_t, maybeOrg?: vec3_t): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrOrg)) {
    return [createParticleBurst("bfg-explosion-particles", runtimeOrOrg, 0xd0, 256, 16, 192, 1)];
  }

  const runtime = runtimeOrOrg;
  const org = maybeOrg as vec3_t;
  for (let index = 0; index < 256; index += 1) {
    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.time = runtime.cl.time;
    particle.color = 0xd0 + (Math.floor(Math.random() * 0x7fffffff) & 7);
    for (let component = 0; component < 3; component += 1) {
      particle.org[component] = org[component] + (Math.floor(Math.random() * 32) - 16);
      particle.vel[component] = Math.floor(Math.random() * 384) - 192;
    }
    particle.accel[0] = 0;
    particle.accel[1] = 0;
    particle.accel[2] = -PARTICLE_GRAVITY;
    particle.alpha = 1.0;
    particle.alphavel = -0.8 / (0.5 + frand() * 0.3);
  }
}

/**
 * Original name: CL_TeleportParticles
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the teleport particle lattice metadata or spawns the original runtime lattice.
 * - Preserves the local `vel` scalar and normalized `dir` vector used for radial velocity.
 */
export function CL_TeleportParticles(org: vec3_t): ClientActionEffect[];
export function CL_TeleportParticles(runtime: ClientRuntime, org: vec3_t): void;
export function CL_TeleportParticles(runtimeOrOrg: ClientRuntime | vec3_t, maybeOrg?: vec3_t): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrOrg)) {
    return [{
      category: "particle",
      kind: "teleport-particles",
      position: [...runtimeOrOrg],
      color: 7,
      count: 1053
    }];
  }

  const runtime = runtimeOrOrg;
  const org = maybeOrg as vec3_t;
  for (let i = -16; i <= 16; i += 4) {
    for (let j = -16; j <= 16; j += 4) {
      for (let k = -16; k <= 32; k += 4) {
        const particle = allocParticle(runtime);
        if (!particle) {
          return;
        }

        particle.time = runtime.cl.time;
        particle.color = 7 + (Math.floor(Math.random() * 0x7fffffff) & 7);
        particle.alpha = 1.0;
        particle.alphavel = -1.0 / (0.3 + (Math.floor(Math.random() * 0x7fffffff) & 7) * 0.02);
        particle.org[0] = org[0] + i + (Math.floor(Math.random() * 0x7fffffff) & 3);
        particle.org[1] = org[1] + j + (Math.floor(Math.random() * 0x7fffffff) & 3);
        particle.org[2] = org[2] + k + (Math.floor(Math.random() * 0x7fffffff) & 3);

        const dir: vec3_t = [j * 8, i * 8, k * 8];
        normalizeVector(dir);
        const vel = 50 + (Math.floor(Math.random() * 0x7fffffff) & 63);
        particle.vel = [dir[0] * vel, dir[1] * vel, dir[2] * vel];
        particle.accel[0] = 0;
        particle.accel[1] = 0;
        particle.accel[2] = -PARTICLE_GRAVITY;
      }
    }
  }
}

/**
 * Original name: CL_AddParticles
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Advances active client particles and emits the current render-facing sprite list.
 *
 * Porting notes:
 * - Preserves the linked-list walk, alpha expiry and `INSTANT_PARTICLE` reset semantics from the original client.
 */
export function CL_AddParticles(runtime: ClientRuntime): ClientRenderParticle[] {
  const particles: ClientRenderParticle[] = [];
  let active = -1;
  let tail = -1;
  let current = runtime.cl.active_particles;

  while (current !== -1) {
    const particle = runtime.cl.particles[current];
    const next = particle.next;
    let alpha: number;
    let time = 0;

    if (particle.alphavel !== INSTANT_PARTICLE) {
      time = (runtime.cl.time - particle.time) * 0.001;
      alpha = particle.alpha + (time * particle.alphavel);
      if (alpha <= 0) {
        particle.next = runtime.cl.free_particles;
        runtime.cl.free_particles = current;
        current = next;
        continue;
      }
    } else {
      alpha = particle.alpha;
    }

    particle.next = -1;
    if (tail === -1) {
      active = current;
      tail = current;
    } else {
      runtime.cl.particles[tail].next = current;
      tail = current;
    }

    if (alpha > 1.0) {
      alpha = 1.0;
    }

    const time2 = time * time;
    particles.push({
      origin: [
        particle.org[0] + (particle.vel[0] * time) + (particle.accel[0] * time2),
        particle.org[1] + (particle.vel[1] * time) + (particle.accel[1] * time2),
        particle.org[2] + (particle.vel[2] * time) + (particle.accel[2] * time2)
      ],
      color: particle.color,
      alpha
    });

    if (particle.alphavel === INSTANT_PARTICLE) {
      particle.alphavel = 0.0;
      particle.alpha = 0.0;
    }

    current = next;
  }

  runtime.cl.active_particles = active;
  return particles;
}

/**
 * Original name: CL_EntityEvent
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Converts one parsed entity event into the original client-side sound and particle side effects.
 *
 * Porting notes:
 * - Preserves Quake II event routing while emitting structured effects instead of playing audio directly.
 */
export function CL_BuildEntityEventEffects(
  event: ClientEntityEvent,
  options: {
    clFootsteps?: boolean;
  } = {}
): ClientActionEffect[] {
  const effects: ClientActionEffect[] = [];
  const footstepsEnabled = options.clFootsteps ?? true;

  if (event.event === 0 && (event.effects & EF_TELEPORTER) !== 0) {
    effects.push(...CL_TeleporterParticles(event.state).map(promoteToEntityEvent));
    return effects;
  }

  switch (event.event) {
    case entity_event_t.EV_ITEM_RESPAWN:
      effects.push(createEntityEventSound(event, "items/respawn1.wav", CHAN_WEAPON, ATTN_IDLE));
      effects.push(...CL_ItemRespawnParticles(event.state.origin).map(promoteToEntityEvent));
      break;
    case entity_event_t.EV_PLAYER_TELEPORT:
      effects.push(createEntityEventSound(event, "misc/tele1.wav", CHAN_WEAPON, ATTN_IDLE));
      effects.push(...CL_TeleportParticles(event.state.origin).map(promoteToEntityEvent));
      break;
    case entity_event_t.EV_FOOTSTEP:
      if (footstepsEnabled) {
        effects.push(
          createEntityEventSound(
            event,
            `player/step${(Math.floor(Math.random() * 0x7fffffff) & 3) + 1}.wav`,
            CHAN_BODY,
            ATTN_NORM
          )
        );
      }
      break;
    case entity_event_t.EV_FALLSHORT:
      effects.push(createEntityEventSound(event, "player/land1.wav", CHAN_AUTO, ATTN_NORM));
      break;
    case entity_event_t.EV_FALL:
      effects.push(createEntityEventSound(event, "*fall2.wav", CHAN_AUTO, ATTN_NORM));
      break;
    case entity_event_t.EV_FALLFAR:
      effects.push(createEntityEventSound(event, "*fall1.wav", CHAN_AUTO, ATTN_NORM));
      break;
    default:
      break;
  }

  return effects;
}

/**
 * Original name: N/A
 * Source: N/A (runtime action dispatcher)
 * Category: New
 * Purpose: Convert any parsed client action packet into normalized effect events.
 *
 * Constraints:
 * - Must dispatch by packet shape without mutating the source packet.
 */
export function CL_BuildActionEffects(
  packet: ClientMuzzleFlashPacket | ClientMuzzleFlash2Packet | ClientTempEntityPacket | ClientParticleEffectPacket,
  runtime?: ClientRuntime
): ClientActionEffect[] {
  if ("kind" in packet && packet.kind === "particle-effect") {
    return CL_BuildParticleEffects(packet);
  }
  if ("weapon" in packet) {
    return CL_BuildMuzzleFlashEffects(packet, runtime);
  }
  if ("flashNumber" in packet) {
    return CL_BuildMuzzleFlash2Effects(packet, runtime);
  }
  return CL_BuildTempEntityEffects(packet as ClientTempEntityPacket);
}

/**
 * Original name: N/A
 * Source: N/A (muzzleflash metadata helper)
 * Category: New
 * Purpose: Map one player muzzle flash weapon id to a first normalized definition.
 */
function getMuzzleFlashDefinition(weaponId: number, volume: number): {
  kind: string;
  sounds: Array<{ name: string; channel: number; attenuation: number; volume?: number; delayMs?: number }>;
  light: { radius: number | null; color: [number, number, number]; durationMs: number };
} {
  switch (weaponId) {
    case MZ_BLASTER:
      return createMuzzleDefinition("blaster", ["weapons/blastf1a.wav"], [1, 1, 0], 200, volume);
    case MZ_BLUEHYPERBLASTER:
      return createMuzzleDefinition("bluehyperblaster", ["weapons/hyprbf1a.wav"], [0, 0, 1], 200, volume);
    case MZ_HYPERBLASTER:
      return createMuzzleDefinition("hyperblaster", ["weapons/hyprbf1a.wav"], [1, 1, 0], 200, volume);
    case MZ_MACHINEGUN:
      return createMuzzleDefinition("machinegun", [randomMachinegunSound()], [1, 1, 0], 200, volume);
    case MZ_SHOTGUN:
      return createMuzzleDefinition(
        "shotgun",
        [
          { name: "weapons/shotgf1b.wav", channel: CHAN_WEAPON, attenuation: ATTN_NORM, volume },
          { name: "weapons/shotgr1b.wav", channel: CHAN_AUTO, attenuation: ATTN_NORM, volume, delayMs: 100 }
        ],
        [1, 1, 0],
        200,
        volume
      );
    case MZ_SSHOTGUN:
      return createMuzzleDefinition("supershotgun", ["weapons/sshotf1b.wav"], [1, 1, 0], 200, volume);
    case MZ_CHAINGUN1:
      return createMuzzleDefinition("chaingun1", [randomMachinegunSound()], [1, 0.25, 0], 200, volume);
    case MZ_CHAINGUN2:
      return createMuzzleDefinition(
        "chaingun2",
        [
          randomMachinegunSound(volume),
          { ...randomMachinegunSound(volume), delayMs: 50 }
        ],
        [1, 0.5, 0],
        225,
        volume,
        100
      );
    case MZ_CHAINGUN3:
      return createMuzzleDefinition(
        "chaingun3",
        [
          randomMachinegunSound(volume),
          { ...randomMachinegunSound(volume), delayMs: 33 },
          { ...randomMachinegunSound(volume), delayMs: 66 }
        ],
        [1, 1, 0],
        250,
        volume,
        100
      );
    case MZ_RAILGUN:
      return createMuzzleDefinition("railgun", ["weapons/railgf1a.wav"], [0.5, 0.5, 1], 200, volume);
    case MZ_ROCKET:
      return createMuzzleDefinition(
        "rocket",
        [
          { name: "weapons/rocklf1a.wav", channel: CHAN_WEAPON, attenuation: ATTN_NORM, volume },
          { name: "weapons/rocklr1b.wav", channel: CHAN_AUTO, attenuation: ATTN_NORM, volume, delayMs: 100 }
        ],
        [1, 0.5, 0.2],
        200,
        volume
      );
    case MZ_GRENADE:
      return createMuzzleDefinition(
        "grenade",
        [
          { name: "weapons/grenlf1a.wav", channel: CHAN_WEAPON, attenuation: ATTN_NORM, volume },
          { name: "weapons/grenlr1b.wav", channel: CHAN_AUTO, attenuation: ATTN_NORM, volume, delayMs: 100 }
        ],
        [1, 0.5, 0],
        200,
        volume
      );
    case MZ_BFG:
      return createMuzzleDefinition("bfg", ["weapons/bfg__f1y.wav"], [0, 1, 0], 200, volume);
    case MZ_LOGIN:
      return createMuzzleDefinition("login", ["weapons/grenlf1a.wav"], [0, 1, 0], 200, 1, 1000);
    case MZ_LOGOUT:
      return createMuzzleDefinition("logout", ["weapons/grenlf1a.wav"], [1, 0, 0], 200, 1, 1000);
    case MZ_RESPAWN:
      return createMuzzleDefinition("respawn", ["weapons/grenlf1a.wav"], [1, 1, 0], 200, 1, 1000);
    case MZ_PHALANX:
      return createMuzzleDefinition("phalanx", ["weapons/plasshot.wav"], [1, 0.5, 0.5], 200, volume);
    case MZ_IONRIPPER:
      return createMuzzleDefinition("ionripper", ["weapons/rippfire.wav"], [1, 0.5, 0.5], 200, volume);
    case MZ_ETF_RIFLE:
      return createMuzzleDefinition("etf-rifle", ["weapons/nail1.wav"], [0.9, 0.7, 0], 200, volume);
    case MZ_SHOTGUN2:
      return createMuzzleDefinition("shotgun2", ["weapons/shotg2.wav"], [1, 1, 0], 200, volume);
    case MZ_HEATBEAM:
      return createMuzzleDefinition("heatbeam", [], [1, 1, 0], 200, volume, 100000);
    case MZ_BLASTER2:
      return createMuzzleDefinition("blaster2", ["weapons/blastf1a.wav"], [0, 1, 0], 200, volume);
    case MZ_TRACKER:
      return createMuzzleDefinition("tracker", ["weapons/disint2.wav"], [-1, -1, -1], 200, volume);
    case MZ_NUKE1:
      return createMuzzleDefinition("nuke1", [], [1, 0, 0], 200, volume, 100000);
    case MZ_NUKE2:
      return createMuzzleDefinition("nuke2", [], [1, 1, 0], 200, volume, 100000);
    case MZ_NUKE4:
      return createMuzzleDefinition("nuke4", [], [0, 0, 1], 200, volume, 100000);
    case MZ_NUKE8:
      return createMuzzleDefinition("nuke8", [], [0, 1, 1], 200, volume, 100000);
    default:
      return createMuzzleDefinition("unknown", ["weapons/blastf1a.wav"], [1, 1, 0], 200, volume);
  }
}

/**
 * Original name: N/A
 * Source: N/A (temp-entity metadata helper)
 * Category: New
 * Purpose: Convert one temp entity packet into a stable readable kind string.
 */
function getTempEntityKind(packet: ClientTempEntityPacket): string {
  if (packet.beamKind) {
    return packet.beamKind;
  }
  return temp_event_t[packet.type]?.toLowerCase() ?? `temp-${packet.type}`;
}

/**
 * Original name: N/A
 * Source: N/A (muzzleflash metadata helper)
 * Category: New
 * Purpose: Build one reusable muzzle flash definition object.
 */
function createMuzzleDefinition(
  kind: string,
  soundNames: Array<string | { name: string; channel: number; attenuation: number; volume?: number; delayMs?: number }>,
  color: [number, number, number],
  radius: number | null,
  volume: number,
  durationMs = 0
): {
  kind: string;
  sounds: Array<{ name: string; channel: number; attenuation: number; volume?: number; delayMs?: number }>;
  light: { radius: number | null; color: [number, number, number]; durationMs: number };
} {
  return {
    kind,
    sounds: soundNames.map((sound) =>
      typeof sound === "string"
        ? { name: sound, channel: CHAN_WEAPON, attenuation: ATTN_NORM, volume }
        : sound
    ),
    light: {
      radius,
      color,
      durationMs
    }
  };
}

/**
 * Original name: N/A
 * Source: N/A (particle metadata helper)
 * Category: New
 * Purpose: Build one reusable particle-burst descriptor close to one original `cl_fx.c` family.
 */
function createParticleBurst(
  kind: string,
  org: vec3_t,
  color: number,
  count: number,
  magnitude: number,
  spacing: number,
  gravityScale: number
): ClientActionEffect {
  return {
    category: "particle",
    kind,
    position: [...org],
    color,
    count,
    magnitude,
    spacing,
    durationMs: Math.round(gravityScale * 1000)
  };
}

/**
 * Original name: N/A
 * Source: N/A (temp-entity metadata helper)
 * Category: New
 * Purpose: Build one lightweight temp-entity marker effect at a given position.
 */
function createTempEntityMarker(
  kind: string,
  position: vec3_t,
  packet: ClientTempEntityPacket,
  extras: Partial<Pick<ClientActionEffect, "color" | "count" | "magnitude">> = {}
): ClientActionEffect {
  const effect: ClientActionEffect = {
    category: "particle",
    kind,
    position: [...position],
    packet
  };
  if (extras.color !== undefined) {
    effect.color = extras.color;
  }
  if (extras.count !== undefined) {
    effect.count = extras.count;
  }
  if (extras.magnitude !== undefined) {
    effect.magnitude = extras.magnitude;
  }
  return effect;
}

/**
 * Original name: N/A
 * Source: N/A (temp-entity sound metadata helper)
 * Category: New
 * Purpose: Append one positioned temp-entity sound effect when a source position exists.
 */
function appendTempEntitySound(
  effects: ClientActionEffect[],
  name: string | null,
  attenuation: number,
  position: vec3_t | undefined,
  packet: ClientTempEntityPacket
): void {
  if (!position || !name) {
    return;
  }
  effects.push({
    category: "temp-entity",
    kind: "temp-entity-sound",
    position: [...position],
    sound: {
      name,
      channel: CHAN_AUTO,
      attenuation
    },
    packet
  });
}

/**
 * Original name: N/A
 * Source: N/A (entity-event sound metadata helper)
 * Category: New
 * Purpose: Build one structured entity-event sound effect payload.
 */
function createEntityEventSound(
  event: ClientEntityEvent,
  name: string,
  channel: number,
  attenuation: number
): ClientActionEffect {
  return {
    category: "entity-event",
    kind: "entity-event-sound",
    entity: event.number,
    position: [...event.state.origin],
    sound: {
      name,
      channel,
      attenuation,
      volume: 1
    }
  };
}

/**
 * Original name: N/A
 * Source: N/A (entity-event metadata helper)
 * Category: New
 * Purpose: Re-tag one existing particle effect as originating from `CL_EntityEvent`.
 */
function promoteToEntityEvent(effect: ClientActionEffect): ClientActionEffect {
  return {
    ...effect,
    category: "entity-event"
  };
}

/**
 * Original name: N/A
 * Source: N/A (shared trail particle helper)
 * Category: New
 * Purpose: Share the common stepped particle loop used by simple trail ports.
 */
function spawnSimpleTrailParticles(
  runtime: ClientRuntime,
  start: vec3_t,
  end: vec3_t,
  options: {
    spacing: number;
    colorBase: number;
    colorMask: number;
    alphaVelocityBase: number;
    alphaVelocityRandom: number;
    originJitter: number;
    velocityJitter: number;
    gravity: boolean;
    randomChanceMask?: number;
  }
): void {
  const move = [...start] as vec3_t;
  const vec = subtractVec3(end, start);
  let len = normalizeVectorCopy(vec);
  const dec = options.spacing;
  vec[0] *= dec;
  vec[1] *= dec;
  vec[2] *= dec;

  while (len > 0) {
    len -= dec;

    if (options.randomChanceMask !== undefined && (Math.floor(Math.random() * 0x7fffffff) & options.randomChanceMask) !== 0) {
      move[0] += vec[0];
      move[1] += vec[1];
      move[2] += vec[2];
      continue;
    }

    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.accel = [0, 0, 0];
    particle.time = runtime.cl.time;
    particle.alpha = 1.0;
    particle.alphavel = -1.0 / (options.alphaVelocityBase + frand() * options.alphaVelocityRandom);
    particle.color = options.colorBase + (Math.floor(Math.random() * 0x7fffffff) & options.colorMask);

    for (let component = 0; component < 3; component += 1) {
      particle.org[component] = move[component] + (crand() * options.originJitter);
      particle.vel[component] = crand() * options.velocityJitter;
    }
    if (options.gravity) {
      particle.accel[2] = -PARTICLE_GRAVITY;
    }

    move[0] += vec[0];
    move[1] += vec[1];
    move[2] += vec[2];
  }
}

/**
 * Original name: N/A
 * Source: N/A (diminishing trail particle helper)
 * Category: New
 * Purpose: Share the runtime particle loop and `trailcount` decay used by `CL_DiminishingTrail`.
 */
function spawnDiminishingTrailParticles(
  runtime: ClientRuntime,
  start: vec3_t,
  end: vec3_t,
  old: centity_t,
  flags: number
): void {
  const move = [...start] as vec3_t;
  const vec = subtractVec3(end, start);
  let len = normalizeVectorCopy(vec);
  const dec = 0.5;
  vec[0] *= dec;
  vec[1] *= dec;
  vec[2] *= dec;

  const orgscale = old.trailcount > 900 ? 4 : old.trailcount > 800 ? 2 : 1;
  const velscale = old.trailcount > 900 ? 15 : old.trailcount > 800 ? 10 : 5;

  while (len > 0) {
    len -= dec;

    if ((Math.floor(Math.random() * 0x7fffffff) & 1023) < old.trailcount) {
      const particle = allocParticle(runtime);
      if (!particle) {
        return;
      }

      particle.accel = [0, 0, 0];
      particle.time = runtime.cl.time;
      particle.alpha = 1.0;
      if ((flags & EF_GIB) !== 0 || (flags & EF_GREENGIB) !== 0) {
        particle.alphavel = -1.0 / (1 + frand() * 0.4);
        particle.color = ((flags & EF_GIB) !== 0 ? 0xe8 : 0xdb) + (Math.floor(Math.random() * 0x7fffffff) & 7);
        for (let component = 0; component < 3; component += 1) {
          particle.org[component] = move[component] + (crand() * orgscale);
          particle.vel[component] = crand() * velscale;
        }
        particle.vel[2] -= PARTICLE_GRAVITY;
      } else {
        particle.alphavel = -1.0 / (1 + frand() * 0.2);
        particle.color = 4 + (Math.floor(Math.random() * 0x7fffffff) & 7);
        for (let component = 0; component < 3; component += 1) {
          particle.org[component] = move[component] + (crand() * orgscale);
          particle.vel[component] = crand() * velscale;
        }
        particle.accel[2] = 20;
      }
    }

    old.trailcount = Math.max(100, old.trailcount - 5);
    move[0] += vec[0];
    move[1] += vec[1];
    move[2] += vec[2];
  }
}

/**
 * Original name: N/A
 * Source: N/A (rail trail particle helper)
 * Category: New
 * Purpose: Share the runtime particle loop used by `CL_RailTrail`.
 */
function spawnRailTrailParticles(runtime: ClientRuntime, start: vec3_t, end: vec3_t): void {
  const move = [...start] as vec3_t;
  const vec = subtractVec3(end, start);
  let len = normalizeVectorCopy(vec);
  const { right, up } = MakeNormalVectors(vec);

  for (let i = 0; i < len; i += 1) {
    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    const d = i * 0.1;
    const c = Math.cos(d);
    const s = Math.sin(d);
    const dir: vec3_t = [
      (right[0] * c) + (up[0] * s),
      (right[1] * c) + (up[1] * s),
      (right[2] * c) + (up[2] * s)
    ];

    particle.time = runtime.cl.time;
    particle.accel = [0, 0, 0];
    particle.alpha = 1.0;
    particle.alphavel = -1.0 / (1 + frand() * 0.2);
    particle.color = 0x74 + (Math.floor(Math.random() * 0x7fffffff) & 7);
    for (let component = 0; component < 3; component += 1) {
      particle.org[component] = move[component] + (dir[component] * 3);
      particle.vel[component] = dir[component] * 6;
      move[component] += vec[component];
    }
  }

  const sparkMove = [...start] as vec3_t;
  const sparkStep: vec3_t = [vec[0] * 0.75, vec[1] * 0.75, vec[2] * 0.75];
  while (len > 0) {
    len -= 0.75;
    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.time = runtime.cl.time;
    particle.accel = [0, 0, 0];
    particle.alpha = 1.0;
    particle.alphavel = -1.0 / (0.6 + frand() * 0.2);
    particle.color = Math.floor(Math.random() * 0x7fffffff) & 15;
    for (let component = 0; component < 3; component += 1) {
      particle.org[component] = sparkMove[component] + (crand() * 3);
      particle.vel[component] = crand() * 3;
      sparkMove[component] += sparkStep[component];
    }
  }
}

function spawnIonripperTrailParticles(runtime: ClientRuntime, start: vec3_t, end: vec3_t): void {
  const move = [...start] as vec3_t;
  const vec = subtractVec3(end, start);
  let len = normalizeVectorCopy(vec);
  const dec = 5;
  let left = 0;

  vec[0] *= dec;
  vec[1] *= dec;
  vec[2] *= dec;

  while (len > 0) {
    len -= dec;

    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.accel = [0, 0, 0];
    particle.time = runtime.cl.time;
    particle.alpha = 0.5;
    particle.alphavel = -1.0 / (0.3 + frand() * 0.2);
    particle.color = 0xe4 + (Math.floor(Math.random() * 0x7fffffff) & 3);
    particle.org = [...move] as vec3_t;
    particle.vel = left ? [10, 0, 0] : [-10, 0, 0];
    left = left ? 0 : 1;

    move[0] += vec[0];
    move[1] += vec[1];
    move[2] += vec[2];
  }
}

/**
 * Original name: N/A
 * Source: N/A (trail metadata helper)
 * Category: New
 * Purpose: Build one reusable trail descriptor between two positions.
 */
function createTrailEffect(
  kind: string,
  start: vec3_t,
  end: vec3_t,
  color: number,
  spacing: number
): ClientActionEffect {
  return {
    category: "particle",
    kind,
    position: [...start],
    position2: [...end],
    color,
    spacing
  };
}

/**
 * Original name: N/A
 * Source: N/A (muzzleflash effect helper)
 * Category: New
 * Purpose: Expand one muzzle-flash definition into one light event plus the original ordered sound side effects.
 */
function buildMuzzleFlashEffects(
  packet: ClientMuzzleFlashPacket,
  definition: ReturnType<typeof getMuzzleFlashDefinition>,
  runtime?: ClientRuntime
): ClientActionEffect[] {
  const weaponId = packet.weapon & ~MZ_SILENCED;
  const position = runtime ? buildPlayerMuzzleFlashOrigin(runtime, packet.entity) : undefined;
  const baseEffect: ClientActionEffect = {
    category: "muzzleflash",
    kind: definition.kind,
    entity: packet.entity,
    light: {
      radius: getMuzzleFlashRadius(weaponId, packet.silenced, definition.light.radius),
      color: definition.light.color,
      durationMs: definition.light.durationMs,
      minlight: 32
    },
    packet
  };
  if (position) {
    baseEffect.position = position;
  }

  const effects: ClientActionEffect[] = [baseEffect];
  appendLogoutEffect(effects, packet, weaponId, position, runtime);

  for (const sound of definition.sounds) {
    effects.push({
      category: "muzzleflash",
      kind: definition.kind,
      entity: packet.entity,
      sound,
      packet
    });
  }

  return effects;
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Normalize one vector in place when its length is non-zero.
 */
function normalizeVector(vector: vec3_t): void {
  const length = Math.sqrt((vector[0] * vector[0]) + (vector[1] * vector[1]) + (vector[2] * vector[2]));
  if (length === 0) {
    return;
  }
  vector[0] /= length;
  vector[1] /= length;
  vector[2] /= length;
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Compute the cross product of two vectors.
 */
function crossProduct(a: vec3_t, b: vec3_t): vec3_t {
  return [
    (a[1] * b[2]) - (a[2] * b[1]),
    (a[2] * b[0]) - (a[0] * b[2]),
    (a[0] * b[1]) - (a[1] * b[0])
  ];
}

/**
 * Original name: CL_LogoutEffect
 * Source: Quake-2-master/client/cl_fx.c
 * Category: Adapter
 * Fidelity level: Adapter
 *
 * Behavior:
 * - Appends the logical `CL_LogoutEffect` particle burst metadata for login/logout/respawn muzzle-flash specials.
 *
 * Porting notes:
 * - Adapter for the `CL_ParseMuzzleFlash` cases that call the separately ported `CL_LogoutEffect`.
 * - Preserves the original trigger conditions and palette bases without hard-coding any renderer behavior here.
 */
function appendLogoutEffect(
  effects: ClientActionEffect[],
  packet: ClientMuzzleFlashPacket,
  weaponId: number,
  position: vec3_t | undefined,
  runtime?: ClientRuntime
): void {
  if (weaponId !== MZ_LOGIN && weaponId !== MZ_LOGOUT && weaponId !== MZ_RESPAWN) {
    return;
  }

  const effectPosition = position ?? (runtime ? [...runtime.cl_entities[packet.entity].current.origin] as vec3_t : undefined);
  if (!effectPosition) {
    return;
  }

  effects.push(...CL_LogoutEffect(effectPosition, weaponId).map((effect) => ({
    ...effect,
    category: "muzzleflash" as const,
    entity: packet.entity,
    packet
  })));
}

/**
 * Original name: CL_ParseMuzzleFlash
 * Source: Quake-2-master/client/cl_fx.c
 * Category: Adapter
 * Fidelity level: Adapter
 *
 * Behavior:
 * - Rebuilds the exact player muzzle-flash light origin from entity origin plus `forward` and `right` offsets.
 *
 * Porting notes:
 * - Reads the current client entity state exactly like `cl_fx.c` before spawning the dlight.
 */
function buildPlayerMuzzleFlashOrigin(runtime: ClientRuntime, entity: number): vec3_t {
  if (entity < 0 || entity >= runtime.cl_entities.length) {
    return [0, 0, 0];
  }

  const player = runtime.cl_entities[entity];
  const origin: vec3_t = [...player.current.origin];
  const vectors = AngleVectors(player.current.angles);

  origin[0] += (18 * vectors.forward[0]) + (16 * vectors.right[0]);
  origin[1] += (18 * vectors.forward[1]) + (16 * vectors.right[1]);
  origin[2] += (18 * vectors.forward[2]) + (16 * vectors.right[2]);

  return origin;
}

/**
 * Original name: CL_ParseMuzzleFlash2
 * Source: Quake-2-master/client/cl_fx.c
 * Category: Adapter
 * Fidelity level: Adapter
 *
 * Behavior:
 * - Rebuilds the exact monster muzzle-flash origin from `monster_flash_offset`, `forward` and `right`.
 *
 * Porting notes:
 * - Reads the current client entity angles exactly like the original client code.
 */
function buildMonsterMuzzleFlashOrigin(runtime: ClientRuntime, entity: number, flashNumber: number): vec3_t {
  if (entity < 0 || entity >= runtime.cl_entities.length) {
    return [0, 0, 0];
  }

  const monster = runtime.cl_entities[entity];
  const vectors = AngleVectors(monster.current.angles);
  const offset = getMonsterFlashOffset(flashNumber);
  return [
    monster.current.origin[0] + (vectors.forward[0] * offset[0]) + (vectors.right[0] * offset[1]),
    monster.current.origin[1] + (vectors.forward[1] * offset[0]) + (vectors.right[1] * offset[1]),
    monster.current.origin[2] + (vectors.forward[2] * offset[0]) + (vectors.right[2] * offset[1]) + offset[2]
  ];
}

/**
 * Original name: CL_ParseMuzzleFlash
 * Source: Quake-2-master/client/cl_fx.c
 * Category: Adapter
 * Fidelity level: Adapter
 *
 * Behavior:
 * - Reproduces the original randomized dlight radius rules for player muzzle flashes.
 *
 * Porting notes:
 * - Preserves the silenced base radius and the special chaingun overrides.
 */
function getMuzzleFlashRadius(weaponId: number, silenced: boolean, fallbackRadius: number | null): number {
  switch (weaponId) {
    case MZ_CHAINGUN1:
      return 200 + (Math.floor(Math.random() * 0x7fffffff) & 31);
    case MZ_CHAINGUN2:
      return 225 + (Math.floor(Math.random() * 0x7fffffff) & 31);
    case MZ_CHAINGUN3:
      return 250 + (Math.floor(Math.random() * 0x7fffffff) & 31);
    default:
      if (silenced) {
        return 100 + (Math.floor(Math.random() * 0x7fffffff) & 31);
      }
      return (fallbackRadius ?? 200) + (Math.floor(Math.random() * 0x7fffffff) & 31);
  }
}

/**
 * Original name: CL_ParseMuzzleFlash2
 * Source: Quake-2-master/client/cl_fx.c
 * Category: Adapter
 * Fidelity level: Adapter
 *
 * Behavior:
 * - Maps one monster muzzle-flash id to the original color, sound and side-effect family.
 *
 * Porting notes:
 * - Keeps the original switch grouping while emitting structured metadata.
 */
function getMuzzleFlash2Definition(flashNumber: number): {
  kind: string;
  color: [number, number, number];
  soundName?: string;
  attenuation: number;
  particleEffect: boolean;
  smokeAndFlash: boolean;
  longLight: boolean;
  randomTankSound: boolean;
} {
  if (isBetween(flashNumber, 26, 38)) {
    return createMuzzleFlash2Definition("infantry-machinegun", [1, 1, 0], "infantry/infatck1.wav", ATTN_NORM, true, true);
  }
  if (matchesAny(flashNumber, [43, 44, 85, 88, 91, 94, 97, 100])) {
    return createMuzzleFlash2Definition("soldier-machinegun", [1, 1, 0], "soldier/solatck3.wav", ATTN_NORM, true, true);
  }
  if (matchesAny(flashNumber, [45, 46, 47, 48, 49, 50, 51, 52])) {
    return createMuzzleFlash2Definition("gunner-machinegun", [1, 1, 0], "gunner/gunatck2.wav", ATTN_NORM, true, true);
  }
  if (matchesAny(flashNumber, [63, 64, 65, 66, 67, 68, 69, 141])) {
    return createMuzzleFlash2Definition("supertank-machinegun", [1, 1, 0], "infantry/infatck1.wav", ATTN_NORM, true, true);
  }
  if (matchesAny(flashNumber, [73, 74, 75, 76, 77, 138, 152])) {
    return createMuzzleFlash2Definition("boss2-machinegun-left", [1, 1, 0], "infantry/infatck1.wav", ATTN_NONE, true, true);
  }
  if (matchesAny(flashNumber, [39, 40, 83, 86, 89, 92, 95, 98, 143])) {
    return createMuzzleFlash2Definition("soldier-blaster", [1, 1, 0], "soldier/solatck2.wav", ATTN_NORM);
  }
  if (matchesAny(flashNumber, [58, 59])) {
    return createMuzzleFlash2Definition("flyer-blaster", [1, 1, 0], "flyer/flyatck3.wav", ATTN_NORM);
  }
  if (flashNumber === 60) {
    return createMuzzleFlash2Definition("medic-blaster", [1, 1, 0], "medic/medatck1.wav", ATTN_NORM);
  }
  if (flashNumber === 62) {
    return createMuzzleFlash2Definition("hover-blaster", [1, 1, 0], "hover/hovatck1.wav", ATTN_NORM);
  }
  if (flashNumber === 82) {
    return createMuzzleFlash2Definition("float-blaster", [1, 1, 0], "floater/fltatck1.wav", ATTN_NORM);
  }
  if (matchesAny(flashNumber, [41, 42, 84, 87, 90, 93, 96, 99])) {
    return createMuzzleFlash2Definition("soldier-shotgun", [1, 1, 0], "soldier/solatck1.wav", ATTN_NORM, false, true);
  }
  if (matchesAny(flashNumber, [1, 2, 3])) {
    return createMuzzleFlash2Definition("tank-blaster", [1, 1, 0], "tank/tnkatck3.wav", ATTN_NORM);
  }
  if (isBetween(flashNumber, 4, 22)) {
    return createMuzzleFlash2Definition("tank-machinegun", [1, 1, 0], undefined, ATTN_NORM, true, true, false, true);
  }
  if (matchesAny(flashNumber, [57, 142])) {
    return createMuzzleFlash2Definition("chick-rocket", [1, 0.5, 0.2], "chick/chkatck2.wav", ATTN_NORM);
  }
  if (matchesAny(flashNumber, [23, 24, 25])) {
    return createMuzzleFlash2Definition("tank-rocket", [1, 0.5, 0.2], "tank/tnkatck1.wav", ATTN_NORM);
  }
  if (matchesAny(flashNumber, [70, 71, 72, 78, 79, 80, 81, 191])) {
    return createMuzzleFlash2Definition("boss-rocket", [1, 0.5, 0.2], "tank/rocket.wav", ATTN_NORM);
  }
  if (matchesAny(flashNumber, [53, 54, 55, 56])) {
    return createMuzzleFlash2Definition("gunner-grenade", [1, 0.5, 0], "gunner/gunatck3.wav", ATTN_NORM);
  }
  if (matchesAny(flashNumber, [61, 147, 150])) {
    return createMuzzleFlash2Definition("railgun", [0.5, 0.5, 1.0], undefined, ATTN_NORM);
  }
  if (flashNumber === 101) {
    return createMuzzleFlash2Definition("makron-bfg", [0.5, 1, 0.5], undefined, ATTN_NORM);
  }
  if (isBetween(flashNumber, 102, 118)) {
    return createMuzzleFlash2Definition("makron-blaster", [1, 1, 0], "makron/blaster.wav", ATTN_NORM);
  }
  if (isBetween(flashNumber, 120, 125)) {
    return createMuzzleFlash2Definition("jorg-machinegun-left", [1, 1, 0], "boss3/xfire.wav", ATTN_NORM, true, true);
  }
  if (isBetween(flashNumber, 126, 131)) {
    return createMuzzleFlash2Definition("jorg-machinegun-right", [1, 1, 0], undefined, ATTN_NORM, true, true);
  }
  if (flashNumber === 132) {
    return createMuzzleFlash2Definition("jorg-bfg", [0.5, 1, 0.5], undefined, ATTN_NORM);
  }
  if (matchesAny(flashNumber, [133, 134, 135, 136, 137, 139, 153])) {
    return createMuzzleFlash2Definition("boss2-machinegun-right", [1, 1, 0], undefined, ATTN_NORM, true, true);
  }
  if (matchesAny(flashNumber, [144, 145, 146, 149, 156, 157, 158, 159, 160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 175, 176, 177, 178, 179, 180, 181, 182, 183, 184, 185, 186, 187, 188, 189, 190])) {
    return createMuzzleFlash2Definition("widow-blaster", [0, 1, 0], "tank/tnkatck3.wav", ATTN_NORM);
  }
  if (flashNumber === 148) {
    return createMuzzleFlash2Definition("widow-disruptor", [-1, -1, -1], "weapons/disint2.wav", ATTN_NORM);
  }
  if (matchesAny(flashNumber, [151, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210])) {
    return createMuzzleFlash2Definition("widow2-beam", [1, 1, 0], undefined, ATTN_NORM, false, false, true);
  }

  return createMuzzleFlash2Definition("monster-muzzleflash", [1, 1, 0], undefined, ATTN_NORM);
}

/**
 * Original name: N/A
 * Source: N/A (muzzleflash2 metadata helper)
 * Category: New
 * Purpose: Build one normalized monster muzzle-flash definition object.
 */
function createMuzzleFlash2Definition(
  kind: string,
  color: [number, number, number],
  soundName?: string,
  attenuation = ATTN_NORM,
  particleEffect = false,
  smokeAndFlash = false,
  longLight = false,
  randomTankSound = false
): {
  kind: string;
  color: [number, number, number];
  soundName?: string;
  attenuation: number;
  particleEffect: boolean;
  smokeAndFlash: boolean;
  longLight: boolean;
  randomTankSound: boolean;
} {
  const definition: {
    kind: string;
    color: [number, number, number];
    soundName?: string;
    attenuation: number;
    particleEffect: boolean;
    smokeAndFlash: boolean;
    longLight: boolean;
    randomTankSound: boolean;
  } = {
    kind,
    color,
    attenuation,
    particleEffect,
    smokeAndFlash,
    longLight,
    randomTankSound
  };
  if (soundName !== undefined) {
    definition.soundName = soundName;
  }
  return definition;
}

/**
 * Original name: CL_ParseMuzzleFlash2
 * Source: client/cl_fx.c
 * Category: Adapter
 * Fidelity level: Adapter
 *
 * Behavior:
 * - Emits the original secondary muzzle-flash particle and smoke markers for later backend handling.
 *
 * Porting notes:
 * - Preserves the original trigger matrix and payload constants without spawning particles directly.
 */
function appendMuzzleFlash2Particles(
  effects: ClientActionEffect[],
  packet: ClientMuzzleFlash2Packet,
  definition: ReturnType<typeof getMuzzleFlash2Definition>,
  position: vec3_t | undefined
): void {
  if (!position) {
    return;
  }

  if (definition.particleEffect) {
    effects.push({
      category: "muzzleflash2",
      kind: "particle-effect",
      entity: packet.entity,
      position,
      color: 0,
      count: 40,
      packet
    });
  }

  if (definition.smokeAndFlash) {
    effects.push({
      category: "muzzleflash2",
      kind: "smoke-and-flash",
      entity: packet.entity,
      position,
      packet
    });
  }
}

/**
 * Original name: CL_ParseMuzzleFlash2
 * Source: client/cl_fx.c
 * Category: Adapter
 * Fidelity level: Adapter
 *
 * Behavior:
 * - Emits the original monster muzzle-flash sound side effect when one exists.
 *
 * Porting notes:
 * - Preserves the tank random sample family and the original attenuation values.
 */
function appendMuzzleFlash2Sounds(
  effects: ClientActionEffect[],
  packet: ClientMuzzleFlash2Packet,
  definition: ReturnType<typeof getMuzzleFlash2Definition>
): void {
  const soundName = definition.randomTankSound
    ? `tank/tnkatk2${String.fromCharCode("a".charCodeAt(0) + (Math.floor(Math.random() * 0x7fffffff) % 5))}.wav`
    : definition.soundName;
  if (!soundName) {
    return;
  }

  effects.push({
    category: "muzzleflash2",
    kind: definition.kind,
    entity: packet.entity,
    sound: {
      name: soundName,
      channel: CHAN_WEAPON,
      attenuation: definition.attenuation,
      volume: 1
    },
    packet
  });
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Test whether one flash number belongs to an inclusive original C range.
 */
function isBetween(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Test whether one flash number belongs to an explicit original C case list.
 */
function matchesAny(value: number, candidates: readonly number[]): boolean {
  return candidates.includes(value);
}

/**
 * Original name: N/A
 * Source: N/A (muzzleflash metadata helper)
 * Category: New
 * Purpose: Reproduce the randomized machinegun sound selection used by `CL_ParseMuzzleFlash`.
 */
function randomMachinegunSound(volume = 1): { name: string; channel: number; attenuation: number; volume: number } {
  return {
    name: `weapons/machgf${Math.floor(Math.random() * 5) + 1}b.wav`,
    channel: CHAN_WEAPON,
    attenuation: ATTN_NORM,
    volume
  };
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Reset one client dynamic-light slot back to its zeroed allocation state.
 */
function resetDlight(dlight: ClientRuntime["cl"]["dlights"][number], key: number): void {
  dlight.key = key;
  dlight.color = [0, 0, 0];
  dlight.origin = [0, 0, 0];
  dlight.radius = 0;
  dlight.die = 0;
  dlight.decay = 0;
  dlight.minlight = 0;
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Allocate one particle slot from the free list and prepend it to the active list.
 *
 * Constraints:
 * - Must preserve the original pointer-list semantics using array indices.
 */
function allocParticle(runtime: ClientRuntime): cparticle_t | null {
  if (runtime.cl.free_particles < 0) {
    return null;
  }

  const freeIndex = runtime.cl.free_particles;
  const particle = runtime.cl.particles[freeIndex];
  runtime.cl.free_particles = particle.next;
  particle.next = runtime.cl.active_particles;
  runtime.cl.active_particles = freeIndex;
  return particle;
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Distinguish the runtime overload of particle helpers from pure descriptor mode.
 */
function isClientRuntime(value: ClientRuntime | vec3_t): value is ClientRuntime {
  return typeof value === "object" && value !== null && "cl" in value && "cls" in value;
}

/**
 * Original name: CL_FlyParticles
 * Source: client/cl_fx.c
 * Category: Adapter
 * Fidelity level: Strict
 *
 * Behavior:
 * - Spawns the original black orbiting fly particles around one entity origin.
 *
 * Porting notes:
 * - Private runtime helper for the public `CL_FlyParticles` overload; preserves the C `BEAMLENGTH`,
 *   `avelocities`, `bytedirs`, `i += 2`, zero velocity/acceleration and `alphavel = -100` behavior.
 */
function spawnFlyParticles(runtime: ClientRuntime, origin: vec3_t, count: number): void {
  const cappedCount = Math.min(count, NUMVERTEXNORMALS);

  ensureFlyAvelocities();

  const ltime = runtime.cl.time / 1000.0;
  for (let index = 0; index < cappedCount; index += 2) {
    const avelocity = flyAvelocities[index] ?? [0, 0, 0];
    let angle = ltime * avelocity[0];
    const sy = Math.sin(angle);
    const cy = Math.cos(angle);
    angle = ltime * avelocity[1];
    const sp = Math.sin(angle);
    const cp = Math.cos(angle);

    const forward: vec3_t = [cp * cy, cp * sy, -sp];
    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.time = runtime.cl.time;
    const dist = Math.sin(ltime + index) * 64;
    const bytedir = BYTE_DIRS[index] ?? [0, 0, 0];
    particle.org = [
      origin[0] + bytedir[0] * dist + forward[0] * FLY_BEAM_LENGTH,
      origin[1] + bytedir[1] * dist + forward[1] * FLY_BEAM_LENGTH,
      origin[2] + bytedir[2] * dist + forward[2] * FLY_BEAM_LENGTH
    ];
    particle.vel = [0, 0, 0];
    particle.accel = [0, 0, 0];
    particle.color = 0;
    particle.alpha = 1;
    particle.alphavel = -100;
  }
}

/**
 * Category: Adapter
 * Purpose: Lazily initialize the shared `avelocities[NUMVERTEXNORMALS]` table used by fly/BFG particles.
 */
function ensureFlyAvelocities(): void {
  if (flyAvelocities[0]) {
    return;
  }

  for (let index = 0; index < NUMVERTEXNORMALS; index += 1) {
    flyAvelocities[index] = [
      (Math.floor(Math.random() * 0x7fffffff) & 255) * 0.01,
      (Math.floor(Math.random() * 0x7fffffff) & 255) * 0.01,
      (Math.floor(Math.random() * 0x7fffffff) & 255) * 0.01
    ];
  }
}

/**
 * Original name: CL_BfgParticles
 * Source: client/cl_fx.c
 * Category: Adapter
 * Fidelity level: Strict
 *
 * Behavior:
 * - Spawns the original orbiting BFG particles around one entity origin.
 */
function spawnBfgParticles(runtime: ClientRuntime, origin: vec3_t): void {
  ensureFlyAvelocities();

  const ltime = runtime.cl.time / 1000.0;
  for (let index = 0; index < NUMVERTEXNORMALS; index += 1) {
    const avelocity = flyAvelocities[index] ?? [0, 0, 0];
    let angle = ltime * avelocity[0];
    const sy = Math.sin(angle);
    const cy = Math.cos(angle);
    angle = ltime * avelocity[1];
    const sp = Math.sin(angle);
    const cp = Math.cos(angle);

    const forward: vec3_t = [cp * cy, cp * sy, -sp];
    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.time = runtime.cl.time;
    const orbitDist = Math.sin(ltime + index) * 64;
    const bytedir = BYTE_DIRS[index] ?? [0, 0, 0];
    particle.org = [
      origin[0] + bytedir[0] * orbitDist + forward[0] * FLY_BEAM_LENGTH,
      origin[1] + bytedir[1] * orbitDist + forward[1] * FLY_BEAM_LENGTH,
      origin[2] + bytedir[2] * orbitDist + forward[2] * FLY_BEAM_LENGTH
    ];
    particle.vel = [0, 0, 0];
    particle.accel = [0, 0, 0];

    const fromOrigin: vec3_t = [
      particle.org[0] - origin[0],
      particle.org[1] - origin[1],
      particle.org[2] - origin[2]
    ];
    const colorDist = Math.sqrt(
      (fromOrigin[0] * fromOrigin[0]) +
      (fromOrigin[1] * fromOrigin[1]) +
      (fromOrigin[2] * fromOrigin[2])
    ) / 90.0;
    particle.color = Math.floor(0xd0 + colorDist * 7);
    particle.colorvel = 0;
    particle.alpha = 1.0 - colorDist;
    particle.alphavel = -100;
  }
}

/**
 * Original name: CL_TrapParticles
 * Source: client/cl_fx.c
 * Category: Adapter
 * Fidelity level: Strict
 *
 * Behavior:
 * - Spawns the original trap column particles followed by the small trap burst lattice.
 *
 * Porting notes:
 * - Private runtime helper for the public `CL_TrapParticles` overload; preserves the local
 *   `move`, `vec`, `len`, `j`, `dec`, `vel`, `dir` and `org` calculations from the C body.
 */
function spawnTrapParticles(runtime: ClientRuntime, adjustedOrigin: vec3_t): void {
  const entityOrigin: vec3_t = [...adjustedOrigin];
  entityOrigin[2] -= 14;

  const start: vec3_t = [...entityOrigin];
  const end: vec3_t = [entityOrigin[0], entityOrigin[1], entityOrigin[2] + 64];
  const move: vec3_t = [...start];
  const vec: vec3_t = [
    end[0] - start[0],
    end[1] - start[1],
    end[2] - start[2]
  ];
  let len = normalizeVectorCopy(vec);
  const dec = 5;
  vec[0] *= dec;
  vec[1] *= dec;
  vec[2] *= dec;

  while (len > 0) {
    len -= dec;

    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.accel = [0, 0, 0];
    particle.time = runtime.cl.time;
    particle.alpha = 1.0;
    particle.alphavel = -1.0 / (0.3 + frand() * 0.2);
    particle.color = 0xe0;
    for (let component = 0; component < 3; component += 1) {
      particle.org[component] = move[component] + crand();
      particle.vel[component] = crand() * 15;
      particle.accel[component] = 0;
    }
    particle.accel[2] = PARTICLE_GRAVITY;

    move[0] += vec[0];
    move[1] += vec[1];
    move[2] += vec[2];
  }

  entityOrigin[2] += 14;
  const org: vec3_t = [...entityOrigin];
  for (let i = -2; i <= 2; i += 4) {
    for (let j = -2; j <= 2; j += 4) {
      for (let k = -2; k <= 4; k += 4) {
        const particle = allocParticle(runtime);
        if (!particle) {
          return;
        }

        particle.time = runtime.cl.time;
        particle.color = 0xe0 + (Math.floor(Math.random() * 0x7fffffff) & 3);
        particle.alpha = 1.0;
        particle.alphavel = -1.0 / (0.3 + (Math.floor(Math.random() * 0x7fffffff) & 7) * 0.02);
        particle.org[0] = org[0] + i + ((Math.floor(Math.random() * 0x7fffffff) & 23) * crand());
        particle.org[1] = org[1] + j + ((Math.floor(Math.random() * 0x7fffffff) & 23) * crand());
        particle.org[2] = org[2] + k + ((Math.floor(Math.random() * 0x7fffffff) & 23) * crand());

        const dir: vec3_t = [j * 8, i * 8, k * 8];
        normalizeVector(dir);
        const vel = 50 + (Math.floor(Math.random() * 0x7fffffff) & 63);
        particle.vel = [dir[0] * vel, dir[1] * vel, dir[2] * vel];
        particle.accel[0] = 0;
        particle.accel[1] = 0;
        particle.accel[2] = -PARTICLE_GRAVITY;
      }
    }
  }
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Subtract two vectors by value.
 */
function subtractVec3(a: vec3_t, b: vec3_t): vec3_t {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Return a normalized copy of the given vector and its original length.
 */
function normalizeVectorCopy(vector: vec3_t): number {
  const length = Math.sqrt((vector[0] * vector[0]) + (vector[1] * vector[1]) + (vector[2] * vector[2]));
  if (length === 0) {
    return 0;
  }

  vector[0] /= length;
  vector[1] /= length;
  vector[2] /= length;
  return length;
}

/**
 * Original name: N/A
 * Source: N/A (temp-entity metadata helper)
 * Category: New
 * Purpose: Map the original `TE_SPLASH` splash type byte to the particle color used by `cl_tent.c`.
 */
function mapSplashColor(splashType: number): number {
  const splashColors = [0x00, 0xe0, 0xb0, 0x50, 0xd0, 0xe0, 0xe8];
  if (splashType < 0 || splashType > 6) {
    return 0x00;
  }
  return splashColors[splashType];
}

/**
 * Original name: N/A
 * Source: N/A (temp-entity sound metadata helper)
 * Category: New
 * Purpose: Reproduce the random `spark5/6/7` selection used by `TE_SPLASH`.
 */
function randomSplashSparkSound(): string {
  const sample = Math.floor(Math.random() * 0x7fffffff) & 3;
  if (sample === 0) {
    return "world/spark5.wav";
  }
  if (sample === 1) {
    return "world/spark6.wav";
  }
  return "world/spark7.wav";
}

/**
 * Original name: N/A
 * Source: N/A (temp-entity sound metadata helper)
 * Category: New
 * Purpose: Reproduce the `ric1/ric2/ric3` random impact sound selection.
 */
function randomRicochetSound(): string | null {
  const sample = Math.floor(Math.random() * 0x7fffffff) & 15;
  if (sample === 1) {
    return "world/ric1.wav";
  }
  if (sample === 2) {
    return "world/ric2.wav";
  }
  if (sample === 3) {
    return "world/ric3.wav";
  }
  return null;
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Reset one client particle slot back to its zeroed allocation state.
 */
function resetParticle(particle: cparticle_t): void {
  particle.time = 0;
  particle.org = [0, 0, 0];
  particle.vel = [0, 0, 0];
  particle.accel = [0, 0, 0];
  particle.color = 0;
  particle.colorvel = 0;
  particle.alpha = 0;
  particle.alphavel = 0;
  particle.next = -1;
}

/**
 * Original name: CL_ParseMuzzleFlash
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Parses one player weapon muzzle flash event.
 *
 * Porting notes:
 * - Returns a structured packet and defers light, sound and particle side effects to hooks.
 */
export function CL_ParseMuzzleFlash(runtime: ClientRuntime, hooks: ClientParseHooks = {}): ClientMuzzleFlashPacket {
  const entity = MSG_ReadShort(runtime.net_message);
  if (entity < 1 || entity >= MAX_EDICTS) {
    throw new Error(`CL_ParseMuzzleFlash: bad entity ${entity}`);
  }

  const weapon = MSG_ReadByte(runtime.net_message);
  const packet: ClientMuzzleFlashPacket = {
    entity,
    weapon,
    silenced: (weapon & 128) !== 0
  };
  hooks.onMuzzleFlash?.(packet);
  return packet;
}

/**
 * Original name: CL_ParseMuzzleFlash2
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Parses one monster muzzle flash event.
 *
 * Porting notes:
 * - Returns a structured packet and defers all effect spawning to hooks.
 */
export function CL_ParseMuzzleFlash2(runtime: ClientRuntime, hooks: ClientParseHooks = {}): ClientMuzzleFlash2Packet {
  const entity = MSG_ReadShort(runtime.net_message);
  if (entity < 1 || entity >= MAX_EDICTS) {
    throw new Error(`CL_ParseMuzzleFlash2: bad entity ${entity}`);
  }

  const flashNumber = MSG_ReadByte(runtime.net_message);
  const packet: ClientMuzzleFlash2Packet = {
    entity,
    flashNumber
  };
  hooks.onMuzzleFlash2?.(packet);
  return packet;
}
