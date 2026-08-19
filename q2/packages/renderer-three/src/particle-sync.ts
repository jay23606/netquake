/**
 * File: particle-sync.ts
 * Purpose: Synchronize Quake II client refresh particles into WebGPU-capable Three.js instanced point sprites.
 *
 * This file is not a direct source port.
 * It is an adapter layer between the client refresh frame and the Three.js backend.
 *
 * Dependencies:
 * - packages/client
 * - packages/filesystem
 * - packages/formats
 * - packages/qcommon
 * - packages/renderer-three/src/gl_rmain.ts
 * - three
 */

import { readMountedFile, type VirtualFilesystem } from "../../filesystem/src/index.js";
import { parsePcx } from "../../formats/src/index.js";
import { createRefDef, MAX_PARTICLES } from "../../client/src/ref.js";
import type { ClientRefreshFrame } from "../../client/src/refresh.js";
import { AngleVectors } from "../../qcommon/src/index.js";
import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  Group,
  Points,
  PointsMaterial
} from "three";
import {
  createGlRmainRuntime,
  R_DrawParticles,
  setRmainPaletteTable,
  setRmainParticleTexture
} from "./gl_rmain.js";

/**
 * Original name: N/A
 * Source: N/A (Three.js particle sync contract)
 * Category: New
 * Purpose: Public handle for the Three.js particle scene node and refresh-frame sync hook.
 */
export interface ThreeParticleSync {
  root: Group;
  apply: (refreshFrame: ClientRefreshFrame | null) => number;
}

/**
 * Original name: N/A
 * Source: N/A (Three.js particle sync options)
 * Category: New
 * Purpose: Browser renderer tuning knobs for the particle sync adapter.
 */
export interface ThreeParticleSyncOptions {
  particleSize?: number;
  particleMinSize?: number;
  particleMaxSize?: number;
  particleAttenuation?: [number, number, number];
  getViewportSize?: () => { width: number; height: number };
}

/**
 * Original name: N/A
 * Source: N/A (Three.js particle sync adapter)
 * Category: New
 * Purpose: Build one Three.js adapter that renders client refresh particles through Three.js point primitives.
 *
 * Constraints:
 * - Must reuse `R_DrawParticles` instead of inventing a parallel particle layout.
 * - Must tolerate missing palette assets by falling back to a grayscale table.
 */
export function createThreeParticleSync(filesystem: VirtualFilesystem, options: ThreeParticleSyncOptions = {}): ThreeParticleSync {
  const root = new Group();
  root.name = "refresh-particles";
  const particleSize = options.particleSize ?? 40;
  const particleMinSize = options.particleMinSize ?? 2;
  const particleMaxSize = options.particleMaxSize ?? Math.max(40, particleSize);
  const particleAttenuation = options.particleAttenuation ?? [0.01, 0, 0.01];

  const positionAttribute = new BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
  const colorAttribute = new BufferAttribute(new Float32Array(MAX_PARTICLES * 4), 4);
  positionAttribute.setUsage(DynamicDrawUsage);
  colorAttribute.setUsage(DynamicDrawUsage);

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("color", colorAttribute);
  geometry.setDrawRange(0, 0);
  geometry.boundingSphere = null;

  const material = new PointsMaterial({
    size: particleSize,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: false
  });
  material.toneMapped = false;

  const particlePoints = new Points(geometry, material);
  particlePoints.name = "refresh-particles:gl-points";
  particlePoints.visible = false;
  particlePoints.frustumCulled = false;
  particlePoints.renderOrder = 20;
  setParticleObjectCount(particlePoints, 0);
  root.add(particlePoints);

  const runtime = createGlRmainRuntime();
  const paletteTable = loadPaletteTable(filesystem);
  setRmainPaletteTable(runtime, paletteTable);
  setRmainParticleTexture(runtime, { name: "***particle***" } as never);
  runtime.gl_ext_pointparameters = createRuntimeCvar("gl_ext_pointparameters", 1);
  runtime.gl_particle_size = createRuntimeCvar("gl_particle_size", particleSize);
  runtime.gl_particle_min_size = createRuntimeCvar("gl_particle_min_size", particleMinSize);
  runtime.gl_particle_max_size = createRuntimeCvar("gl_particle_max_size", particleMaxSize);
  runtime.gl_particle_att_a = createRuntimeCvar("gl_particle_att_a", particleAttenuation[0]);
  runtime.gl_particle_att_b = createRuntimeCvar("gl_particle_att_b", particleAttenuation[1]);
  runtime.gl_particle_att_c = createRuntimeCvar("gl_particle_att_c", particleAttenuation[2]);
  runtime.qglPointParameterfEXT = true;

  let capturedCount = 0;

  runtime.hooks.onDrawPointParticleBatch = (particles, count, colortable, pointSize) => {
    const positions = positionAttribute.array as Float32Array;
    const colors = colorAttribute.array as Float32Array;

    capturedCount = Math.min(count, particles.length, MAX_PARTICLES);
    for (let index = 0; index < capturedCount; index += 1) {
      const particle = particles[index];
      if (!particle) {
        continue;
      }

      let distance =
        (particle.origin[0] - runtime.r_origin[0]) * runtime.vpn[0] +
        (particle.origin[1] - runtime.r_origin[1]) * runtime.vpn[1] +
        (particle.origin[2] - runtime.r_origin[2]) * runtime.vpn[2];
      distance = Math.max(1, distance);

      const positionOffset = index * 3;
      positions[positionOffset] = particle.origin[0];
      positions[positionOffset + 1] = particle.origin[1];
      positions[positionOffset + 2] = particle.origin[2];

      void computePointParameterSize(runtime, pointSize, distance);

      const packed = colortable[particle.color] ?? 0;
      const colorOffset = index * 4;
      colors[colorOffset] = (packed & 0xff) / 255.0;
      colors[colorOffset + 1] = ((packed >> 8) & 0xff) / 255.0;
      colors[colorOffset + 2] = ((packed >> 16) & 0xff) / 255.0;
      colors[colorOffset + 3] = clamp01(particle.alpha);
    }

    setParticleObjectCount(particlePoints, capturedCount);
    geometry.setDrawRange(0, capturedCount);
    geometry.computeBoundingSphere();
    particlePoints.visible = capturedCount > 0;
    positionAttribute.needsUpdate = true;
    colorAttribute.needsUpdate = true;
  };

  return {
    root,
    apply: (refreshFrame) => {
      if (!refreshFrame || refreshFrame.particles.length === 0) {
        setParticleObjectCount(particlePoints, 0);
        geometry.setDrawRange(0, 0);
        particlePoints.visible = false;
        return 0;
      }

      const vectors = AngleVectors(refreshFrame.view.viewangles);
      runtime.r_origin = [...refreshFrame.view.vieworg];
      runtime.vpn = [...vectors.forward];
      runtime.vup = [...vectors.up];
      runtime.vright = [...vectors.right];
      capturedCount = 0;

      const refdef = createRefDef();
      refdef.fov_x = refreshFrame.view.fov_x;
      refdef.num_particles = refreshFrame.particles.length;
      refdef.particles = refreshFrame.particles;
      runtime.r_newrefdef = refdef;

      R_DrawParticles(runtime);

      return capturedCount;
    }
  };
}

function setParticleObjectCount(points: Points<BufferGeometry, PointsMaterial>, count: number): void {
  (points as unknown as { count: number }).count = count;
}

/**
 * Original name: N/A
 * Source: N/A (Three.js particle attenuation helper)
 * Category: New
 * Purpose: Mirror the configured point-parameter attenuation when sizing synced particles.
 */
function computePointParameterSize(
  runtime: ReturnType<typeof createGlRmainRuntime>,
  baseSize: number,
  distance: number
): number {
  const attA = runtime.gl_particle_att_a?.value ?? 0.01;
  const attB = runtime.gl_particle_att_b?.value ?? 0;
  const attC = runtime.gl_particle_att_c?.value ?? 0.01;
  const minSize = runtime.gl_particle_min_size?.value ?? 2;
  const maxSize = runtime.gl_particle_max_size?.value ?? 40;
  const attenuation = attA + attB * distance + attC * distance * distance;
  const attenuatedSize = attenuation > 0 ? baseSize / Math.sqrt(attenuation) : baseSize;

  return Math.max(minSize, Math.min(maxSize, attenuatedSize));
}

/**
 * Original name: N/A
 * Source: N/A (particle alpha clamp helper)
 * Category: New
 * Purpose: Keep refresh particle alpha in the range accepted by Three.js vertex colors.
 */
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Original name: N/A
 * Source: N/A (renderer cvar shim)
 * Category: New
 * Purpose: Provide the small cvar shape required by the ported `R_DrawParticles` runtime.
 */
function createRuntimeCvar(name: string, value: number) {
  return {
    name,
    string: String(value),
    latched_string: null,
    flags: 0,
    modified: false,
    value
  };
}

/**
 * Original name: N/A
 * Source: N/A (renderer palette adapter)
 * Category: New
 * Purpose: Load Quake's palette for particle colors, with a grayscale fallback for minimal VFS tests.
 */
function loadPaletteTable(filesystem: VirtualFilesystem): Uint32Array {
  const paletteFile = readMountedFile(filesystem, "pics/colormap.pcx");
  if (!paletteFile) {
    return Uint32Array.from({ length: 256 }, (_, index) => (((255 << 24) >>> 0) | (index << 16) | (index << 8) | index) >>> 0);
  }

  try {
    const palette = parsePcx(paletteFile.bytes, paletteFile.path).paletteRgb;
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      const r = palette[index * 3] ?? 0;
      const g = palette[index * 3 + 1] ?? 0;
      const b = palette[index * 3 + 2] ?? 0;
      table[index] = (((255 << 24) >>> 0) | (b << 16) | (g << 8) | r) >>> 0;
    }
    table[255] &= 0x00ffffff;
    return table;
  } catch {
    return Uint32Array.from({ length: 256 }, (_, index) => (((255 << 24) >>> 0) | (index << 16) | (index << 8) | index) >>> 0);
  }
}
