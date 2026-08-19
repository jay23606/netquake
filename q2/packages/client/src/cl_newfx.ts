/**
 * File: cl_newfx.ts
 * Source: Quake II original / client/cl_newfx.c
 * Purpose: Port the extended client-side particle, trail and sustain effect routines.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Supports both metadata-oriented and runtime particle-allocation call sites where the current client pipeline still needs both.
 *
 * Notes:
 * - This file is the principal port target for `client/cl_newfx.c`.
 */

import { AngleVectors, VIDREF_GL, VIDREF_SOFT, crand, frand, type vec3_t } from "../../qcommon/src/index.js";
import { INSTANT_PARTICLE, type ClientRuntime, type centity_t, type cparticle_t, type client_sustain_t } from "./client.js";
import { MakeNormalVectors, type ClientActionEffect } from "./cl_fx.js";

/**
 * Original name: PARTICLE_GRAVITY
 * Source: client/client.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Mirrors the shared particle gravity macro for Rogue `cl_newfx.c` effects.
 */
const PARTICLE_GRAVITY = 40;

/**
 * Original name: CL_ParticleSteamEffect
 * Source: client/cl_newfx.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits steam puffs along a direction with right/up spread, half gravity and randomized fade.
 *
 * Porting notes:
 * - Also exposes a metadata form for packet effect descriptions; the runtime overload mutates the particle pool.
 */
export function CL_ParticleSteamEffect(
  org: vec3_t,
  dir: vec3_t,
  color: number,
  count: number,
  magnitude: number
): ClientActionEffect[];
export function CL_ParticleSteamEffect(
  runtime: ClientRuntime,
  org: vec3_t,
  dir: vec3_t,
  color: number,
  count: number,
  magnitude: number
): void;
export function CL_ParticleSteamEffect(
  runtimeOrOrg: ClientRuntime | vec3_t,
  orgOrDir: vec3_t,
  dirOrColor: vec3_t | number,
  colorOrCount: number,
  countOrMagnitude?: number,
  magnitudeMaybe?: number
): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrOrg)) {
    const org = runtimeOrOrg;
    const dir = orgOrDir;
    const color = dirOrColor as number;
    const count = colorOrCount;
    const magnitude = countOrMagnitude as number;

    return [{
      category: "particle",
      kind: "particle-steam-effect",
      position: [...org],
      direction: [...dir],
      color,
      count,
      magnitude
    }];
  }

  const runtime = runtimeOrOrg;
  const org = orgOrDir;
  const dir = dirOrColor as vec3_t;
  const color = colorOrCount;
  const count = countOrMagnitude as number;
  const magnitude = magnitudeMaybe as number;
  const { right, up } = MakeNormalVectors([...dir] as vec3_t);

  for (let index = 0; index < count; index += 1) {
    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.time = runtime.cl.time;
    particle.color = color + (Math.floor(Math.random() * 0x7fffffff) & 7);

    for (let component = 0; component < 3; component += 1) {
      particle.org[component] = org[component] + magnitude * 0.1 * crand();
    }

    particle.vel = [dir[0] * magnitude, dir[1] * magnitude, dir[2] * magnitude];
    let d = crand() * magnitude / 3;
    particle.vel = addScaledVector(particle.vel, right, d);
    d = crand() * magnitude / 3;
    particle.vel = addScaledVector(particle.vel, up, d);

    particle.accel[0] = 0;
    particle.accel[1] = 0;
    particle.accel[2] = -PARTICLE_GRAVITY / 2;
    particle.alpha = 1.0;
    particle.alphavel = -1.0 / (0.5 + frand() * 0.3);
  }
}

/**
 * Original name: CL_ParticleSteamEffect2
 * Source: client/cl_newfx.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Runs the steam sustain thinker from one sustain slot and advances `nextthink` by `thinkinterval`.
 *
 * Porting notes:
 * - Mirrors `CL_ParticleSteamEffect` using sustain fields from `cl_sustain_t`.
 */
export function CL_ParticleSteamEffect2(self: client_sustain_t): ClientActionEffect[];
export function CL_ParticleSteamEffect2(runtime: ClientRuntime, self: client_sustain_t): void;
export function CL_ParticleSteamEffect2(
  runtimeOrSelf: ClientRuntime | client_sustain_t,
  maybeSelf?: client_sustain_t
): ClientActionEffect[] | void {
  if (maybeSelf === undefined) {
    const self = runtimeOrSelf as client_sustain_t;
    return CL_ParticleSteamEffect(self.org, self.dir, self.color, self.count, self.magnitude);
  }

  const runtime = runtimeOrSelf as ClientRuntime;
  const self = maybeSelf;
  const dir = [...self.dir] as vec3_t;
  const { right, up } = MakeNormalVectors(dir);

  for (let index = 0; index < self.count; index += 1) {
    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.time = runtime.cl.time;
    particle.color = self.color + (Math.floor(Math.random() * 0x7fffffff) & 7);

    for (let component = 0; component < 3; component += 1) {
      particle.org[component] = self.org[component] + self.magnitude * 0.1 * crand();
    }

    particle.vel = [dir[0] * self.magnitude, dir[1] * self.magnitude, dir[2] * self.magnitude];
    let d = crand() * self.magnitude / 3;
    particle.vel = addScaledVector(particle.vel, right, d);
    d = crand() * self.magnitude / 3;
    particle.vel = addScaledVector(particle.vel, up, d);

    particle.accel[0] = 0;
    particle.accel[1] = 0;
    particle.accel[2] = -PARTICLE_GRAVITY / 2;
    particle.alpha = 1.0;
    particle.alphavel = -1.0 / (0.5 + frand() * 0.3);
  }

  self.nextthink += self.thinkinterval;
}

/**
 * Original name: CL_ParticleSmokeEffect
 * Source: client/cl_newfx.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits steam-like smoke puffs along a direction, preserving zero gravity.
 *
 * Porting notes:
 * - Also exposes a metadata form for packet effect descriptions; the runtime overload mutates the particle pool.
 */
export function CL_ParticleSmokeEffect(
  org: vec3_t,
  dir: vec3_t,
  color: number,
  count: number,
  magnitude: number
): ClientActionEffect[];
export function CL_ParticleSmokeEffect(
  runtime: ClientRuntime,
  org: vec3_t,
  dir: vec3_t,
  color: number,
  count: number,
  magnitude: number
): void;
export function CL_ParticleSmokeEffect(
  runtimeOrOrg: ClientRuntime | vec3_t,
  orgOrDir: vec3_t,
  dirOrColor: vec3_t | number,
  colorOrCount: number,
  magnitudeMaybe?: number,
  maybeMagnitude?: number
): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrOrg)) {
    const org = runtimeOrOrg;
    const dir = orgOrDir;
    const color = dirOrColor as number;
    const count = colorOrCount;
    const magnitude = magnitudeMaybe as number;

    return [{
      category: "particle",
      kind: "particle-smoke-effect",
      position: [...org],
      direction: [...dir],
      color,
      count,
      magnitude
    }];
  }

  const runtime = runtimeOrOrg;
  const org = orgOrDir;
  const dir = dirOrColor as vec3_t;
  const color = colorOrCount;
  const count = magnitudeMaybe as number;
  const magnitude = maybeMagnitude as number;
  const { right, up } = MakeNormalVectors([...dir] as vec3_t);

  for (let index = 0; index < count; index += 1) {
    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.time = runtime.cl.time;
    particle.color = color + (Math.floor(Math.random() * 0x7fffffff) & 7);

    for (let component = 0; component < 3; component += 1) {
      particle.org[component] = org[component] + magnitude * 0.1 * crand();
    }

    particle.vel = [dir[0] * magnitude, dir[1] * magnitude, dir[2] * magnitude];
    let d = crand() * magnitude / 3;
    particle.vel = addScaledVector(particle.vel, right, d);
    d = crand() * magnitude / 3;
    particle.vel = addScaledVector(particle.vel, up, d);

    particle.accel[0] = 0;
    particle.accel[1] = 0;
    particle.accel[2] = 0;
    particle.alpha = 1.0;
    particle.alphavel = -1.0 / (0.5 + frand() * 0.3);
  }
}

/**
 * Original name: CL_BlasterParticles2
 * Source: client/cl_newfx.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits the Rogue green/flechette wall impact puff with directional velocity and full gravity.
 *
 * Porting notes:
 * - Color is caller supplied, matching the original shared helper for `TE_BLASTER2` and `TE_FLECHETTE`.
 */
export function CL_BlasterParticles2(org: vec3_t, dir: vec3_t, color: number): ClientActionEffect[];
export function CL_BlasterParticles2(runtime: ClientRuntime, org: vec3_t, dir: vec3_t, color: number): void;
export function CL_BlasterParticles2(
  runtimeOrOrg: ClientRuntime | vec3_t,
  orgOrDir: vec3_t,
  dirOrColor: vec3_t | number,
  colorMaybe?: number
): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrOrg)) {
    return [{
      category: "particle",
      kind: "blaster-particles2",
      position: [...runtimeOrOrg],
      direction: [...orgOrDir],
      color: dirOrColor as number,
      count: 40
    }];
  }

  const runtime = runtimeOrOrg;
  const org = orgOrDir;
  const dir = dirOrColor as vec3_t;
  const color = colorMaybe as number;

  for (let index = 0; index < 40; index += 1) {
    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.time = runtime.cl.time;
    particle.color = color + (Math.floor(Math.random() * 0x7fffffff) & 7);

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
 * Original name: CL_DebugTrail
 * Source: client/cl_newfx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the debug trail particles along a segment with the original 3-unit spacing.
 *
 * Porting notes:
 * - Supports a metadata form for transitional temp-entity adapters and a runtime form that mutates the particle pool.
 */
export function CL_DebugTrail(start: vec3_t, end: vec3_t): ClientActionEffect[];
export function CL_DebugTrail(runtime: ClientRuntime, start: vec3_t, end: vec3_t): void;
export function CL_DebugTrail(
  runtimeOrStart: ClientRuntime | vec3_t,
  startOrEnd: vec3_t,
  maybeEnd?: vec3_t
): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrStart)) {
    return [createTrailEffect("debug-trail", runtimeOrStart, startOrEnd, 0x74, 3)];
  }

  const runtime = runtimeOrStart;
  const start = startOrEnd;
  const end = maybeEnd as vec3_t;
  const move = [...start] as vec3_t;
  const vec = subtractVec3(end, start);
  let len = normalizeVectorCopy(vec);
  const dec = 3;

  vec[0] *= dec;
  vec[1] *= dec;
  vec[2] *= dec;

  while (len > 0) {
    len -= dec;

    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.time = runtime.cl.time;
    particle.accel = [0, 0, 0];
    particle.vel = [0, 0, 0];
    particle.alpha = 1.0;
    particle.alphavel = -0.1;
    particle.color = 0x74 + (Math.floor(Math.random() * 0x7fffffff) & 7);
    particle.org = [...move];

    move[0] += vec[0];
    move[1] += vec[1];
    move[2] += vec[2];
  }
}

/**
 * Original name: CL_BubbleTrail2
 * Source: client/cl_newfx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns distance-controlled bubble particles between two temp-entity endpoints.
 *
 * Porting notes:
 * - The runtime overload preserves the active/free particle list side effects.
 */
export function CL_BubbleTrail2(start: vec3_t, end: vec3_t, dist: number): ClientActionEffect[];
export function CL_BubbleTrail2(runtime: ClientRuntime, start: vec3_t, end: vec3_t, dist: number): void;
export function CL_BubbleTrail2(
  runtimeOrStart: ClientRuntime | vec3_t,
  startOrEnd: vec3_t,
  endOrDist: vec3_t | number,
  distMaybe?: number
): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrStart)) {
    return [createTrailEffect("bubble-trail2", runtimeOrStart, startOrEnd, 4, endOrDist as number)];
  }

  const runtime = runtimeOrStart;
  const start = startOrEnd;
  const end = endOrDist as vec3_t;
  const dist = distMaybe as number;
  const move = [...start] as vec3_t;
  const vec = subtractVec3(end, start);
  const len = normalizeVectorCopy(vec);
  const dec = dist;

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
    particle.alphavel = -1.0 / (1 + frand() * 0.1);
    particle.color = 4 + (Math.floor(Math.random() * 0x7fffffff) & 7);

    for (let component = 0; component < 3; component += 1) {
      particle.org[component] = move[component] + (crand() * 2);
      particle.vel[component] = crand() * 10;
    }
    particle.org[2] -= 4;
    particle.vel[2] += 20;

    move[0] += vec[0];
    move[1] += vec[1];
    move[2] += vec[2];
  }
}

/**
 * Original name: CL_ColorFlash
 * Source: client/cl_newfx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Allocates one keyed dynamic light at the supplied position, including the software-renderer negative-color inversion.
 *
 * Porting notes:
 * - Uses `runtime.cl.vidref_val` for the original global `vidref_val`; browser full-game defaults to the GL path.
 */
export function CL_ColorFlash(
  pos: vec3_t,
  ent: number,
  intensity: number,
  r: number,
  g: number,
  b: number
): ClientActionEffect[];
export function CL_ColorFlash(
  runtime: ClientRuntime,
  pos: vec3_t,
  ent: number,
  intensity: number,
  r: number,
  g: number,
  b: number
): void;
export function CL_ColorFlash(
  runtimeOrPos: ClientRuntime | vec3_t,
  posOrEnt: vec3_t | number,
  entOrIntensity: number,
  intensityOrR: number,
  rOrG: number,
  gOrB: number,
  maybeB?: number
): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrPos)) {
    return [{
      category: "temp-entity",
      kind: "color-flash",
      entity: posOrEnt as number,
      position: [...runtimeOrPos],
      light: {
        radius: entOrIntensity,
        color: [intensityOrR, rOrG, gOrB],
        durationMs: 100,
        minlight: 250
      }
    }];
  }

  const runtime = runtimeOrPos;
  const pos = posOrEnt as vec3_t;
  const ent = entOrIntensity;
  let intensity = intensityOrR;
  let r = rOrG;
  let g = gOrB;
  let b = maybeB as number;
  if (runtime.cl.vidref_val === VIDREF_SOFT && (r < 0 || g < 0 || b < 0)) {
    intensity = -intensity;
    r = -r;
    g = -g;
    b = -b;
  }
  const dlight = allocDlight(runtime, ent);
  dlight.origin = [...pos];
  dlight.radius = intensity;
  dlight.minlight = 250;
  dlight.die = runtime.cl.time + 100;
  dlight.color = [r, g, b];
}

/**
 * Original name: CL_Flashlight
 * Source: client/cl_newfx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the original short-lived white flashlight dynamic light for one entity key.
 *
 * Porting notes:
 * - Keeps the TypeScript overload order `(pos, ent)` for metadata callers; runtime call sites use explicit `runtime, pos, ent`.
 */
export function CL_Flashlight(pos: vec3_t, ent: number): ClientActionEffect[];
export function CL_Flashlight(runtime: ClientRuntime, pos: vec3_t, ent: number): void;
export function CL_Flashlight(
  runtimeOrPos: ClientRuntime | vec3_t,
  posOrEnt: vec3_t | number,
  maybeEnt?: number
): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrPos)) {
    return [{
      category: "temp-entity",
      kind: "flashlight",
      entity: posOrEnt as number,
      position: [...runtimeOrPos],
      light: {
        radius: 400,
        color: [1, 1, 1],
        durationMs: 100,
        minlight: 250
      }
    }];
  }

  CL_ColorFlash(runtimeOrPos, posOrEnt as vec3_t, maybeEnt as number, 400, 1, 1, 1);
}

/**
 * Original name: CL_SmokeTrail
 * Source: client/cl_newfx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns smoky trail particles with caller-controlled palette range and spacing.
 *
 * Porting notes:
 * - Runtime form preserves particle allocation, alpha decay and upward velocity.
 */
export function CL_SmokeTrail(
  start: vec3_t,
  end: vec3_t,
  colorStart: number,
  colorRun: number,
  spacing: number
): ClientActionEffect[];
export function CL_SmokeTrail(
  runtime: ClientRuntime,
  start: vec3_t,
  end: vec3_t,
  colorStart: number,
  colorRun: number,
  spacing: number
): void;
export function CL_SmokeTrail(
  runtimeOrStart: ClientRuntime | vec3_t,
  startOrEnd: vec3_t,
  endOrColorStart: vec3_t | number,
  colorStartOrRun: number,
  colorRunOrSpacing?: number,
  spacingMaybe?: number
): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrStart)) {
    return [{
      ...createTrailEffect("smoke-trail", runtimeOrStart, startOrEnd, colorStartOrRun, colorRunOrSpacing as number),
      magnitude: endOrColorStart as number
    }];
  }

  const runtime = runtimeOrStart;
  const start = startOrEnd;
  const end = endOrColorStart as vec3_t;
  const colorStart = colorStartOrRun;
  const colorRun = colorRunOrSpacing as number;
  const spacing = spacingMaybe as number;
  const move = [...start] as vec3_t;
  const vec = subtractVec3(end, start);
  let len = normalizeVectorCopy(vec);

  vec[0] *= spacing;
  vec[1] *= spacing;
  vec[2] *= spacing;

  while (len > 0) {
    len -= spacing;

    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.accel = [0, 0, 0];
    particle.time = runtime.cl.time;
    particle.alpha = 1.0;
    particle.alphavel = -1.0 / (1 + frand() * 0.5);
    particle.color = colorStart + (Math.floor(Math.random() * colorRun));
    particle.vel = [0, 0, 20 + (crand() * 5)];

    for (let component = 0; component < 3; component += 1) {
      particle.org[component] = move[component] + (crand() * 3);
    }

    move[0] += vec[0];
    move[1] += vec[1];
    move[2] += vec[2];
  }
}

/**
 * Original name: CL_ForceWall
 * Source: client/cl_newfx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns force-wall particles along a segment with the original random skip and downward velocity.
 *
 * Porting notes:
 * - Metadata output is consumed by temp-entity/web adapters; runtime output feeds the particle pool.
 */
export function CL_ForceWall(start: vec3_t, end: vec3_t, color: number): ClientActionEffect[];
export function CL_ForceWall(runtime: ClientRuntime, start: vec3_t, end: vec3_t, color: number): void;
export function CL_ForceWall(
  runtimeOrStart: ClientRuntime | vec3_t,
  startOrEnd: vec3_t,
  endOrColor: vec3_t | number,
  colorMaybe?: number
): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrStart)) {
    return [createTrailEffect("force-wall", runtimeOrStart, startOrEnd, endOrColor as number, 4)];
  }

  const runtime = runtimeOrStart;
  const start = startOrEnd;
  const end = endOrColor as vec3_t;
  const color = colorMaybe as number;
  const move = [...start] as vec3_t;
  const vec = subtractVec3(end, start);
  let len = normalizeVectorCopy(vec);

  vec[0] *= 4;
  vec[1] *= 4;
  vec[2] *= 4;

  while (len > 0) {
    len -= 4;

    if (frand() <= 0.3) {
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
    particle.alphavel = -1.0 / (3.0 + frand() * 0.5);
    particle.color = color;
    particle.vel = [0, 0, -40 - (crand() * 10)];

    for (let component = 0; component < 3; component += 1) {
      particle.org[component] = move[component] + (crand() * 3);
    }

    move[0] += vec[0];
    move[1] += vec[1];
    move[2] += vec[2];
  }
}

/**
 * Original name: CL_FlameEffects
 * Source: client/cl_newfx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns the original two random flame/smoke particle groups around an entity origin.
 *
 * Porting notes:
 * - The unused C `centity_t *ent` remains accepted in the runtime overload for signature ownership.
 */
export function CL_FlameEffects(origin: vec3_t): ClientActionEffect[];
export function CL_FlameEffects(runtime: ClientRuntime, ent: centity_t | null, origin: vec3_t): void;
export function CL_FlameEffects(
  runtimeOrOrigin: ClientRuntime | vec3_t,
  entOrOrigin?: centity_t | vec3_t | null,
  maybeOrigin?: vec3_t
): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrOrigin)) {
    return [{
      category: "particle",
      kind: "flame-effects",
      position: [...runtimeOrOrigin]
    }];
  }

  const runtime = runtimeOrOrigin;
  const origin = maybeOrigin as vec3_t;
  void entOrOrigin;

  let count = Math.floor(Math.random() * 0x7fffffff) & 0xF;
  for (let index = 0; index < count; index += 1) {
    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.accel = [0, 0, -PARTICLE_GRAVITY];
    particle.time = runtime.cl.time;
    particle.alpha = 1.0;
    particle.alphavel = -1.0 / (1 + frand() * 0.2);
    particle.color = 226 + (Math.floor(Math.random() * 4));

    for (let component = 0; component < 3; component += 1) {
      particle.org[component] = origin[component] + (crand() * 5);
      particle.vel[component] = crand() * 5;
    }
    particle.vel[2] = crand() * -10;
  }

  count = Math.floor(Math.random() * 0x7fffffff) & 0x7;
  for (let index = 0; index < count; index += 1) {
    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.accel = [0, 0, 0];
    particle.time = runtime.cl.time;
    particle.alpha = 1.0;
    particle.alphavel = -1.0 / (1 + frand() * 0.5);
    particle.color = Math.floor(Math.random() * 4);
    particle.vel = [0, 0, 20 + (crand() * 5)];

    for (let component = 0; component < 3; component += 1) {
      particle.org[component] = origin[component] + (crand() * 3);
    }
  }
}

/**
 * Original name: CL_GenericParticleEffect
 * Source: client/cl_newfx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns a caller-sized burst with palette variation, directional spread, gravity and alpha decay.
 *
 * Porting notes:
 * - Metadata output preserves the effect payload for adapters that do not mutate particles immediately.
 */
export function CL_GenericParticleEffect(
  org: vec3_t,
  dir: vec3_t,
  color: number,
  count: number,
  numcolors: number,
  dirspread: number,
  alphavel: number
): ClientActionEffect[];
export function CL_GenericParticleEffect(
  runtime: ClientRuntime,
  org: vec3_t,
  dir: vec3_t,
  color: number,
  count: number,
  numcolors: number,
  dirspread: number,
  alphavel: number
): void;
export function CL_GenericParticleEffect(
  runtimeOrOrg: ClientRuntime | vec3_t,
  orgOrDir: vec3_t,
  dirOrColor: vec3_t | number,
  colorOrCount: number,
  countOrNumcolors: number,
  numcolorsOrDirspread?: number,
  dirspreadOrAlphavel?: number,
  alphavelMaybe?: number
): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrOrg)) {
    const effect: ClientActionEffect = {
      category: "particle",
      kind: "generic-particle-effect",
      position: [...runtimeOrOrg],
      direction: [...orgOrDir],
      color: dirOrColor as number,
      count: colorOrCount,
      magnitude: countOrNumcolors
    };
    if (numcolorsOrDirspread !== undefined) {
      effect.spacing = numcolorsOrDirspread;
    }
    return [effect];
  }

  const runtime = runtimeOrOrg;
  const org = orgOrDir;
  const dir = dirOrColor as vec3_t;
  const color = colorOrCount;
  const count = countOrNumcolors;
  const numcolors = numcolorsOrDirspread as number;
  const dirspread = dirspreadOrAlphavel as number;
  const alphavel = alphavelMaybe as number;

  for (let index = 0; index < count; index += 1) {
    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.time = runtime.cl.time;
    particle.color = numcolors > 1 ? color + ((Math.floor(Math.random() * 0x7fffffff)) & numcolors) : color;

    const d = (Math.floor(Math.random() * 0x7fffffff)) & dirspread;
    for (let component = 0; component < 3; component += 1) {
      particle.org[component] = org[component] + ((Math.floor(Math.random() * 0x7fffffff) & 7) - 4) + (d * dir[component]);
      particle.vel[component] = crand() * 20;
    }

    particle.accel[0] = 0;
    particle.accel[1] = 0;
    particle.accel[2] = -PARTICLE_GRAVITY;
    particle.alpha = 1.0;
    particle.alphavel = -1.0 / (0.5 + frand() * alphavel);
  }
}

/**
 * Original name: CL_TrackerTrail
 * Source: client/cl_newfx.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits tracker trail particles every 3 units using the original cosine/up offset.
 *
 * Porting notes:
 * - Also exposes a metadata form for render-source effect descriptions.
 */
export function CL_TrackerTrail(start: vec3_t, end: vec3_t, particleColor: number): ClientActionEffect[];
export function CL_TrackerTrail(runtime: ClientRuntime, start: vec3_t, end: vec3_t, particleColor: number): void;
export function CL_TrackerTrail(
  runtimeOrStart: ClientRuntime | vec3_t,
  startOrEnd: vec3_t,
  endOrColor: vec3_t | number,
  colorMaybe?: number
): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrStart)) {
    return [createTrailEffect("tracker-trail", runtimeOrStart, startOrEnd, endOrColor as number, 3)];
  }

  const runtime = runtimeOrStart;
  const start = startOrEnd;
  const end = endOrColor as vec3_t;
  const particleColor = colorMaybe as number;
  const move = [...start] as vec3_t;
  const vec = subtractVec3(end, start);
  let len = normalizeVectorCopy(vec);
  const forward = [...vec] as vec3_t;
  const angleDir = vectoangles2(forward);
  const { forward: pathForward, up } = AngleVectors(angleDir);
  const dec = 3;

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
    particle.alphavel = -2.0;
    particle.color = particleColor;
    particle.org = addScaledVector(move, up, 8 * Math.cos(dotProduct(move, pathForward)));
    particle.vel = [0, 0, 5];

    move[0] += vec[0];
    move[1] += vec[1];
    move[2] += vec[2];
  }
}

/**
 * Original name: CL_Tracker_Shell
 * Source: client/cl_newfx.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits the instant tracker shell as 300 particles on a radius-40 random sphere.
 */
export function CL_Tracker_Shell(runtime: ClientRuntime, origin: vec3_t): void {
  for (let index = 0; index < 300; index += 1) {
    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.accel = [0, 0, 0];
    particle.time = runtime.cl.time;
    particle.alpha = 1.0;
    particle.alphavel = INSTANT_PARTICLE;
    particle.color = 0;
    particle.org = addScaledVector(origin, normalizeRandomDirection(), 40);
    particle.vel = [0, 0, 0];
  }
}

/**
 * Original name: CL_Tracker_Explode
 * Source: client/cl_newfx.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits the tracker explosion as 300 particles moving back toward the origin.
 */
export function CL_Tracker_Explode(runtime: ClientRuntime, origin: vec3_t): void {
  for (let index = 0; index < 300; index += 1) {
    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.accel = [0, 0, 0];
    particle.time = runtime.cl.time;
    particle.alpha = 1.0;
    particle.alphavel = -1.0;
    particle.color = 0;

    const dir = normalizeRandomDirection();
    particle.org = addScaledVector(origin, dir, 64);
    particle.vel = [-64 * dir[0], -64 * dir[1], -64 * dir[2]];
  }
}

/**
 * Original name: CL_TagTrail
 * Source: client/cl_newfx.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits color-tag trail particles every 5 units with random origin and velocity spread.
 *
 * Porting notes:
 * - Also exposes a metadata form for render-source effect descriptions.
 */
export function CL_TagTrail(start: vec3_t, end: vec3_t, color: number): ClientActionEffect[];
export function CL_TagTrail(runtime: ClientRuntime, start: vec3_t, end: vec3_t, color: number): void;
export function CL_TagTrail(
  runtimeOrStart: ClientRuntime | vec3_t,
  startOrEnd: vec3_t,
  endOrColor: vec3_t | number,
  colorMaybe?: number
): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrStart)) {
    return [createTrailEffect("tag-trail", runtimeOrStart, startOrEnd, endOrColor as number, 5)];
  }

  const runtime = runtimeOrStart;
  const start = startOrEnd;
  const end = endOrColor as vec3_t;
  const color = colorMaybe as number;
  const move = [...start] as vec3_t;
  const vec = subtractVec3(end, start);
  let len = normalizeVectorCopy(vec);
  const dec = 5;

  vec[0] *= dec;
  vec[1] *= dec;
  vec[2] *= dec;

  while (len >= 0) {
    len -= dec;

    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.accel = [0, 0, 0];
    particle.time = runtime.cl.time;
    particle.alpha = 1.0;
    particle.alphavel = -1.0 / (0.8 + frand() * 0.2);
    particle.color = color;

    for (let component = 0; component < 3; component += 1) {
      particle.org[component] = move[component] + (crand() * 16);
      particle.vel[component] = crand() * 5;
    }

    move[0] += vec[0];
    move[1] += vec[1];
    move[2] += vec[2];
  }
}

/**
 * Original name: CL_BlasterTrail2
 * Source: client/cl_newfx.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits the green blaster/tracker projectile trail every 5 units with color `0xd0`.
 *
 * Porting notes:
 * - Also exposes a metadata form for render-source effect descriptions.
 */
export function CL_BlasterTrail2(start: vec3_t, end: vec3_t): ClientActionEffect[];
export function CL_BlasterTrail2(runtime: ClientRuntime, start: vec3_t, end: vec3_t): void;
export function CL_BlasterTrail2(
  runtimeOrStart: ClientRuntime | vec3_t,
  startOrEnd: vec3_t,
  maybeEnd?: vec3_t
): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrStart)) {
    return [createTrailEffect("blaster-trail2", runtimeOrStart, startOrEnd, 0xd0, 5)];
  }

  const runtime = runtimeOrStart;
  const start = startOrEnd;
  const end = maybeEnd as vec3_t;
  const move = [...start] as vec3_t;
  const vec = subtractVec3(end, start);
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
    particle.color = 0xd0;

    for (let component = 0; component < 3; component += 1) {
      particle.org[component] = move[component] + crand();
      particle.vel[component] = crand() * 5;
    }

    move[0] += vec[0];
    move[1] += vec[1];
    move[2] += vec[2];
  }
}

/**
 * Original name: CL_WidowSplash
 * Source: client/cl_newfx.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits 256 widow splash particles using the original four-color table and radial velocity.
 *
 * Porting notes:
 * - Also exposes a metadata form for packet effect descriptions.
 */
export function CL_WidowSplash(org: vec3_t): ClientActionEffect[];
export function CL_WidowSplash(runtime: ClientRuntime, org: vec3_t): void;
export function CL_WidowSplash(
  runtimeOrOrg: ClientRuntime | vec3_t,
  maybeOrg?: vec3_t
): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrOrg)) {
    return [{
      category: "particle",
      kind: "widow-splash",
      position: [...runtimeOrOrg],
      count: 256,
      magnitude: 45
    }];
  }

  const runtime = runtimeOrOrg;
  const org = maybeOrg as vec3_t;
  const colortable = [2 * 8, 13 * 8, 21 * 8, 18 * 8];

  for (let index = 0; index < 256; index += 1) {
    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.time = runtime.cl.time;
    particle.color = colortable[Math.floor(Math.random() * 0x7fffffff) & 3];

    const dir = normalizeRandomDirection();
    particle.org = addScaledVector(org, dir, 45.0);
    particle.vel = [40.0 * dir[0], 40.0 * dir[1], 40.0 * dir[2]];
    particle.accel[0] = 0;
    particle.accel[1] = 0;
    particle.accel[2] = 0;
    particle.alpha = 1.0;
    particle.alphavel = -0.8 / (0.5 + frand() * 0.3);
  }
}

/**
 * Original name: CL_ColorExplosionParticles
 * Source: client/cl_newfx.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits 128 colored explosion particles with random origin/velocity spread and full gravity.
 *
 * Porting notes:
 * - Also exposes a metadata form for packet effect descriptions.
 */
export function CL_ColorExplosionParticles(org: vec3_t, color: number, run: number): ClientActionEffect[];
export function CL_ColorExplosionParticles(runtime: ClientRuntime, org: vec3_t, color: number, run: number): void;
export function CL_ColorExplosionParticles(
  runtimeOrOrg: ClientRuntime | vec3_t,
  orgOrColor: vec3_t | number,
  colorOrRun: number,
  runMaybe?: number
): ClientActionEffect[] | void {
  if (Array.isArray(runtimeOrOrg)) {
    return [{
      category: "particle",
      kind: "color-explosion-particles",
      position: [...runtimeOrOrg],
      color: orgOrColor as number,
      count: 128,
      magnitude: colorOrRun,
      spacing: 16,
      durationMs: 400
    }];
  }

  const runtime = runtimeOrOrg;
  const org = orgOrColor as vec3_t;
  const color = colorOrRun;
  const run = runMaybe as number;

  for (let index = 0; index < 128; index += 1) {
    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.time = runtime.cl.time;
    particle.color = color + Math.floor(Math.random() * run);

    for (let component = 0; component < 3; component += 1) {
      particle.org[component] = org[component] + (Math.floor(Math.random() * 32) - 16);
      particle.vel[component] = Math.floor(Math.random() * 256) - 128;
    }

    particle.accel[0] = 0;
    particle.accel[1] = 0;
    particle.accel[2] = -PARTICLE_GRAVITY;
    particle.alpha = 1.0;
    particle.alphavel = -0.4 / (0.6 + frand() * 0.2);
  }
}

/**
 * Original name: CL_Heatbeam
 * Source: client/cl_newfx.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits the active `RINGS` heatbeam particle helix using the current view right/up vectors.
 *
 * Porting notes:
 * - The inactive CORKSCREW/SPRAY preprocessor variants are not runtime-active in the original source.
 * - Uses `runtime.cl.vidref_val` for the original `vidref_val` GL-only start offset branch.
 */
export function CL_Heatbeam(runtime: ClientRuntime, start: vec3_t, forward: vec3_t, right: vec3_t, up: vec3_t): void {
  const move = [...start] as vec3_t;
  const end = addScaledVector(start, forward, 4096);
  const vec = subtractVec3(end, start);
  const len = normalizeVectorCopy(vec);

  if (runtime.cl.vidref_val === VIDREF_GL) {
    move[0] -= right[0] * 0.5;
    move[1] -= right[1] * 0.5;
    move[2] -= right[2] * 0.5;
    move[0] -= up[0] * 0.5;
    move[1] -= up[1] * 0.5;
    move[2] -= up[2] * 0.5;
  }

  const ltime = runtime.cl.time / 1000.0;
  const step = 32.0;
  const startPt = floatMod(ltime * 96.0, step);
  move[0] += vec[0] * startPt;
  move[1] += vec[1] * startPt;
  move[2] += vec[2] * startPt;

  vec[0] *= step;
  vec[1] *= step;
  vec[2] *= step;

  const rstep = Math.PI / 10.0;
  for (let distance = startPt; distance < len; distance += step) {
    if (distance > step * 5) {
      break;
    }

    for (let rot = 0; rot < Math.PI * 2; rot += rstep) {
      const particle = allocParticle(runtime);
      if (!particle) {
        return;
      }

      particle.time = runtime.cl.time;
      particle.accel = [0, 0, 0];

      const variance = 0.5;
      const c = Math.cos(rot) * variance;
      const s = Math.sin(rot) * variance;
      let dir: vec3_t = [right[0] * c, right[1] * c, right[2] * c];
      dir = addScaledVector(dir, up, s);

      if (distance < 10) {
        const factor = distance / 10.0;
        dir = [dir[0] * factor, dir[1] * factor, dir[2] * factor];
      }

      particle.alpha = 0.5;
      particle.alphavel = -1000.0;
      particle.color = 223 - (Math.floor(Math.random() * 0x7fffffff) & 7);
      particle.org = [move[0] + dir[0] * 3, move[1] + dir[1] * 3, move[2] + dir[2] * 3];
      particle.vel = [0, 0, 0];
    }

    move[0] += vec[0];
    move[1] += vec[1];
    move[2] += vec[2];
  }
}

/**
 * Original name: CL_MonsterPlasma_Shell
 * Source: client/cl_newfx.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits the monster heatbeam plasma shell as 40 instant particles on a radius-10 random sphere.
 */
export function CL_MonsterPlasma_Shell(runtime: ClientRuntime, origin: vec3_t): void {
  for (let index = 0; index < 40; index += 1) {
    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.accel = [0, 0, 0];
    particle.time = runtime.cl.time;
    particle.alpha = 1.0;
    particle.alphavel = INSTANT_PARTICLE;
    particle.color = 0xe0;
    particle.org = addScaledVector(origin, normalizeRandomDirection(), 10);
    particle.vel = [0, 0, 0];
  }
}

/**
 * Original name: CL_Widowbeamout
 * Source: client/cl_newfx.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits the widow beam-out sustain burst using the original time ratio and four-color table.
 *
 * Porting notes:
 * - Does not advance `nextthink`; the original C thinker leaves that field unchanged.
 */
export function CL_Widowbeamout(runtime: ClientRuntime, self: client_sustain_t): void {
  const colortable = [2 * 8, 13 * 8, 21 * 8, 18 * 8];
  const ratio = 1.0 - ((self.endtime - runtime.cl.time) / 2100.0);

  for (let index = 0; index < 300; index += 1) {
    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.accel = [0, 0, 0];
    particle.time = runtime.cl.time;
    particle.alpha = 1.0;
    particle.alphavel = INSTANT_PARTICLE;
    particle.color = colortable[Math.floor(Math.random() * 0x7fffffff) & 3];
    particle.org = addScaledVector(self.org, normalizeRandomDirection(), 45.0 * ratio);
    particle.vel = [0, 0, 0];
  }

}

/**
 * Original name: CL_Nukeblast
 * Source: client/cl_newfx.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits the nuke sustain burst using the original time ratio and four-color table.
 *
 * Porting notes:
 * - Does not advance `nextthink`; the original C thinker leaves that field unchanged.
 */
export function CL_Nukeblast(runtime: ClientRuntime, self: client_sustain_t): void {
  const colortable = [110, 112, 114, 116];
  const ratio = 1.0 - ((self.endtime - runtime.cl.time) / 1000.0);

  for (let index = 0; index < 700; index += 1) {
    const particle = allocParticle(runtime);
    if (!particle) {
      return;
    }

    particle.accel = [0, 0, 0];
    particle.time = runtime.cl.time;
    particle.alpha = 1.0;
    particle.alphavel = INSTANT_PARTICLE;
    particle.color = colortable[Math.floor(Math.random() * 0x7fffffff) & 3];
    particle.org = addScaledVector(self.org, normalizeRandomDirection(), 200.0 * ratio);
    particle.vel = [0, 0, 0];
  }

}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Build one reusable trail descriptor between two positions.
 */
function createTrailEffect(kind: string, start: vec3_t, end: vec3_t, color: number, spacing: number): ClientActionEffect {
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
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Compute a private dot product for local particle placement math.
 */
function dotProduct(a: vec3_t, b: vec3_t): number {
  return (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);
}

/**
 * Original name: vectoangles2
 * Source: client/cl_newfx.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Converts a direction vector into Quake pitch/yaw/roll angles, preserving the PMM pitch fix.
 */
function vectoangles2(value1: vec3_t): vec3_t {
  let yaw: number;
  let pitch: number;

  if (value1[1] === 0 && value1[0] === 0) {
    yaw = 0;
    pitch = value1[2] > 0 ? 90 : 270;
  } else {
    if (value1[0] !== 0) {
      yaw = Math.atan2(value1[1], value1[0]) * 180 / Math.PI;
    } else if (value1[1] > 0) {
      yaw = 90;
    } else {
      yaw = 270;
    }
    if (yaw < 0) {
      yaw += 360;
    }

    const forward = Math.sqrt((value1[0] * value1[0]) + (value1[1] * value1[1]));
    pitch = Math.atan2(value1[2], forward) * 180 / Math.PI;
    if (pitch < 0) {
      pitch += 360;
    }
  }

  return [-pitch, yaw, 0];
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Allocate one particle from the client runtime free list for local runtime-effect paths.
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
 * Purpose: Allocate or recycle one dynamic light for local runtime-effect paths.
 */
function allocDlight(runtime: ClientRuntime, key: number): ClientRuntime["cl"]["dlights"][number] {
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
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Clear a dynamic-light slot before local runtime-effect reuse.
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
 * Purpose: Return `base + direction * scalar` for local particle math.
 */
function addScaledVector(base: vec3_t, direction: vec3_t, scalar: number): vec3_t {
  return [
    base[0] + direction[0] * scalar,
    base[1] + direction[1] * scalar,
    base[2] + direction[2] * scalar
  ];
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Return `a - b` for local trail vector math.
 */
function subtractVec3(a: vec3_t, b: vec3_t): vec3_t {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Normalize one local vector in place and return its original length.
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
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Preserve positive floating-point modulo behavior for heatbeam stepping.
 */
function floatMod(value: number, divisor: number): number {
  return value - (Math.floor(value / divisor) * divisor);
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Build one normalized random direction for local particle scatter.
 */
function normalizeRandomDirection(): vec3_t {
  const dir: vec3_t = [crand(), crand(), crand()];
  const length = Math.sqrt((dir[0] * dir[0]) + (dir[1] * dir[1]) + (dir[2] * dir[2]));
  if (length === 0) {
    return [0, 0, 1];
  }
  dir[0] /= length;
  dir[1] /= length;
  dir[2] /= length;
  return dir;
}
