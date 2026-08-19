/**
 * File: gl_light.ts
 * Source: Quake II original / ref_gl/gl_light.c
 * Purpose: Port the GL refresh dynamic-light marking, point sampling and lightmap building routines.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Replaces file-static globals with an explicit runtime object.
 * - Routes immediate-mode flashblend rendering through hooks instead of direct GL calls.
 * - Stores the temporary `s_blocklights` buffer in a `Float32Array`.
 *
 * Notes:
 * - This file is the principal attachment point for `ref_gl/gl_light.c`.
 * - The current tranche focuses first on the CPU-side source-of-truth routines already consumed by `gl_rsurf.c`:
 *   `R_MarkLights`, `R_PushDlights`, `R_LightPoint`, `R_AddDynamicLights`, `R_SetCacheState` and `R_BuildLightMap`.
 */

import { MAXLIGHTMAPS, PLANE_X, PLANE_Y, PLANE_Z, SURF_SKY, SURF_TRANS33, SURF_TRANS66, SURF_WARP } from "../../formats/src/index.js";
import {
  DotProduct,
  M_PI,
  VectorCopy,
  VectorLength,
  VectorMA,
  VectorScale,
  VectorSubtract,
  vec3_origin,
  type cplane_t,
  type vec3_t
} from "../../qcommon/src/index.js";
import type { dlight_t, entity_t, refdef_t } from "../../client/src/ref.js";
import { SURF_DRAWSKY, SURF_DRAWTURB, type mnode_child_t, type mnode_t, type model_t, type msurface_t } from "./gl_model.js";

/**
 * Original name: DLIGHT_CUTOFF
 * Source: ref_gl/gl_light.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Preserves the original dynamic-light cutoff threshold used by marking and lightmap accumulation.
 */
export const DLIGHT_CUTOFF = 64;

/**
 * Original name: N/A
 * Source: N/A (typed blocklight buffer sizing helper)
 * Category: New
 * Purpose: Express the original `s_blocklights[34*34*3]` storage size for the typed runtime buffer.
 */
const BLOCKLIGHT_BYTES = 34 * 34 * 3;

/**
 * Original name: N/A
 * Source: N/A (typed blocklight bounds helper)
 * Category: New
 * Purpose: Mirror the original `sizeof(s_blocklights)>>4` lightmap surface-size guard for typed arrays.
 */
const MAX_BLOCKLIGHT_SURFACE_SIZE = BLOCKLIGHT_BYTES >> 2;

/**
 * Original name: N/A
 * Source: N/A (renderer hook adapter)
 * Category: New
 * Purpose: Decouple the ported `gl_light.c` CPU path from concrete Three.js/immediate-mode rendering calls.
 */
export interface GlLightHooks {
  beginFlashblendDlights?: () => void;
  renderDlight?: (light: dlight_t, center: vec3_t, ring: vec3_t[], radius: number) => void;
  endFlashblendDlights?: () => void;
}

/**
 * Original name: N/A
 * Source: N/A (explicit renderer light runtime)
 * Category: New
 * Purpose: Replace `gl_light.c` file globals and imported renderer globals with explicit mutable state.
 */
export interface GlLightRuntime {
  r_dlightframecount: number;
  r_framecount: number;
  r_origin: vec3_t;
  vpn: vec3_t;
  vright: vec3_t;
  vup: vec3_t;
  r_newrefdef: refdef_t | null;
  r_worldmodel: model_t | null;
  currententity: entity_t | null;
  gl_flashblend: boolean;
  gl_modulate: number;
  gl_monolightmap: string;
  pointcolor: vec3_t;
  lightspot: vec3_t;
  lightplane: cplane_t | null;
  s_blocklights: Float32Array;
  hooks: GlLightHooks;
}

/**
 * Original name: N/A
 * Source: N/A (explicit renderer light runtime)
 * Category: New
 * Purpose: Create the explicit runtime replacing `gl_light.c` globals and file-statics.
 */
export function createGlLightRuntime(hooks: GlLightHooks = {}): GlLightRuntime {
  return {
    r_dlightframecount: 0,
    r_framecount: 0,
    r_origin: [0, 0, 0],
    vpn: [0, 0, 0],
    vright: [0, 0, 0],
    vup: [0, 0, 0],
    r_newrefdef: null,
    r_worldmodel: null,
    currententity: null,
    gl_flashblend: false,
    gl_modulate: 1,
    gl_monolightmap: "0",
    pointcolor: [0, 0, 0],
    lightspot: [0, 0, 0],
    lightplane: null,
    s_blocklights: new Float32Array(BLOCKLIGHT_BYTES),
    hooks
  };
}

/**
 * Original name: R_RenderDlight
 * Source: ref_gl/gl_light.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Builds the triangle-fan geometry used by the original flashblend dynamic-light renderer.
 *
 * Porting notes:
 * - Immediate-mode GL submission is deferred to a hook.
 */
export function R_RenderDlight(runtime: GlLightRuntime, light: dlight_t): void {
  const rad = light.intensity * 0.35;
  const center: vec3_t = [
    light.origin[0] - runtime.vpn[0] * rad,
    light.origin[1] - runtime.vpn[1] * rad,
    light.origin[2] - runtime.vpn[2] * rad
  ];
  const ring: vec3_t[] = [];

  for (let index = 16; index >= 0; index -= 1) {
    const angle = (index / 16.0) * M_PI * 2;
    ring.push([
      light.origin[0] + runtime.vright[0] * Math.cos(angle) * rad + runtime.vup[0] * Math.sin(angle) * rad,
      light.origin[1] + runtime.vright[1] * Math.cos(angle) * rad + runtime.vup[1] * Math.sin(angle) * rad,
      light.origin[2] + runtime.vright[2] * Math.cos(angle) * rad + runtime.vup[2] * Math.sin(angle) * rad
    ]);
  }

  runtime.hooks.renderDlight?.(light, center, ring, rad);
}

/**
 * Original name: R_RenderDlights
 * Source: ref_gl/gl_light.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Walks the current refdef dynamic lights through the flashblend renderer path.
 */
export function R_RenderDlights(runtime: GlLightRuntime): void {
  const refdef = runtime.r_newrefdef;
  if (!runtime.gl_flashblend || !refdef) {
    return;
  }

  runtime.r_dlightframecount = runtime.r_framecount + 1;
  runtime.hooks.beginFlashblendDlights?.();
  for (let index = 0; index < refdef.num_dlights; index += 1) {
    const light = refdef.dlights[index];
    if (light) {
      R_RenderDlight(runtime, light);
    }
  }
  runtime.hooks.endFlashblendDlights?.();
}

/**
 * Original name: R_MarkLights
 * Source: ref_gl/gl_light.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Marks one BSP node and its intersected surfaces with the current dynamic-light bit.
 */
export function R_MarkLights(runtime: GlLightRuntime, light: dlight_t, bit: number, node: mnode_child_t | null): void {
  if (!node || !isMNode(node)) {
    return;
  }

  const splitplane = node.plane;
  if (!splitplane) {
    throw new Error("R_MarkLights: node missing plane");
  }

  const dist = DotProduct(light.origin, splitplane.normal) - splitplane.dist;
  if (dist > light.intensity - DLIGHT_CUTOFF) {
    R_MarkLights(runtime, light, bit, node.children[0]);
    return;
  }
  if (dist < -light.intensity + DLIGHT_CUTOFF) {
    R_MarkLights(runtime, light, bit, node.children[1]);
    return;
  }

  const worldmodel = runtime.r_worldmodel;
  if (!worldmodel) {
    throw new Error("R_MarkLights: r_worldmodel is null");
  }

  for (let index = 0; index < node.numsurfaces; index += 1) {
    const surf = worldmodel.surfaces[node.firstsurface + index];
    if (!surf) {
      continue;
    }

    if (surf.dlightframe !== runtime.r_dlightframecount) {
      surf.dlightbits = 0;
      surf.dlightframe = runtime.r_dlightframecount;
    }
    surf.dlightbits |= bit;
  }

  R_MarkLights(runtime, light, bit, node.children[0]);
  R_MarkLights(runtime, light, bit, node.children[1]);
}

/**
 * Original name: R_PushDlights
 * Source: ref_gl/gl_light.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Projects the current refdef dynamic lights onto the visible world BSP surfaces.
 */
export function R_PushDlights(runtime: GlLightRuntime): void {
  const refdef = runtime.r_newrefdef;
  const worldmodel = runtime.r_worldmodel;
  if (!refdef || !worldmodel || runtime.gl_flashblend) {
    return;
  }

  runtime.r_dlightframecount = runtime.r_framecount + 1;
  const rootNode = worldmodel.nodes[0] ?? null;
  for (let index = 0; index < refdef.num_dlights; index += 1) {
    const light = refdef.dlights[index];
    if (light) {
      R_MarkLights(runtime, light, 1 << index, rootNode);
    }
  }
}

/**
 * Original name: N/A
 * Source: ref_gl/gl_rsurf.c + ref_gl/gl_light.c
 * Category: Adapter
 * Fidelity level: Close
 *
 * Behavior:
 * - Marks dynamic lights against the current inline brush model using the same `R_MarkLights` routine as the world model.
 *
 * Porting notes:
 * - This keeps the `gl_light.c` behavior attached to the light runtime while exposing the hook shape consumed by `gl_rsurf.c`.
 */
export function R_MarkModelLights(runtime: GlLightRuntime, model: model_t): void {
  const refdef = runtime.r_newrefdef;
  if (!refdef || runtime.gl_flashblend) {
    return;
  }

  const previousWorldModel = runtime.r_worldmodel;
  runtime.r_worldmodel = model;
  try {
    const rootNode = model.nodes[model.firstnode] ?? model.nodes[0] ?? null;
    for (let index = 0; index < refdef.num_dlights; index += 1) {
      const light = refdef.dlights[index];
      if (light) {
        R_MarkLights(runtime, light, 1 << index, rootNode);
      }
    }
  } finally {
    runtime.r_worldmodel = previousWorldModel;
  }
}

/**
 * Original name: RecursiveLightPoint
 * Source: ref_gl/gl_light.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Traces downward through the BSP to sample the baked lightmap contribution at one point.
 */
export function RecursiveLightPoint(runtime: GlLightRuntime, node: mnode_child_t | null, start: vec3_t, end: vec3_t): number {
  if (!node || !isMNode(node)) {
    return -1;
  }

  const plane = node.plane;
  const worldmodel = runtime.r_worldmodel;
  const refdef = runtime.r_newrefdef;
  if (!plane || !worldmodel || !refdef) {
    throw new Error("RecursiveLightPoint: missing required renderer state");
  }

  const front = dotPlaneDistance(start, plane);
  const back = dotPlaneDistance(end, plane);
  const side = front < 0 ? 1 : 0;

  if ((back < 0) === (front < 0)) {
    return RecursiveLightPoint(runtime, node.children[side], start, end);
  }

  const frac = front / (front - back);
  const mid: vec3_t = [
    start[0] + (end[0] - start[0]) * frac,
    start[1] + (end[1] - start[1]) * frac,
    start[2] + (end[2] - start[2]) * frac
  ];

  let result = RecursiveLightPoint(runtime, node.children[side], start, mid);
  if (result >= 0) {
    return result;
  }

  if ((back < 0) === (front < 0)) {
    return -1;
  }

  VectorCopy(mid, runtime.lightspot);
  runtime.lightplane = plane;

  for (let index = 0; index < node.numsurfaces; index += 1) {
    const surf = worldmodel.surfaces[node.firstsurface + index];
    if (!surf?.texinfo) {
      continue;
    }
    if ((surf.flags & (SURF_DRAWTURB | SURF_DRAWSKY)) !== 0) {
      continue;
    }

    const tex = surf.texinfo;
    const s = dotTexAxis(mid, tex.vecs[0]);
    const t = dotTexAxis(mid, tex.vecs[1]);

    if (s < surf.texturemins[0] || t < surf.texturemins[1]) {
      continue;
    }

    const ds = s - surf.texturemins[0];
    const dt = t - surf.texturemins[1];
    if (ds > surf.extents[0] || dt > surf.extents[1]) {
      continue;
    }

    if (!surf.samples) {
      return 0;
    }

    const sampleS = ds >> 4;
    const sampleT = dt >> 4;
    const sampleStride = (surf.extents[0] >> 4) + 1;
    let lightmapOffset = 3 * (sampleT * sampleStride + sampleS);

    VectorCopy(vec3_origin, runtime.pointcolor);
    for (let maps = 0; maps < MAXLIGHTMAPS && surf.styles[maps] !== 255; maps += 1) {
      const styleIndex = surf.styles[maps];
      const style = refdef.lightstyles[styleIndex];
      const scale = style
        ? [
            runtime.gl_modulate * style.rgb[0],
            runtime.gl_modulate * style.rgb[1],
            runtime.gl_modulate * style.rgb[2]
          ] as vec3_t
        : [0, 0, 0];

      runtime.pointcolor[0] += (surf.samples[lightmapOffset] ?? 0) * scale[0] * (1.0 / 255);
      runtime.pointcolor[1] += (surf.samples[lightmapOffset + 1] ?? 0) * scale[1] * (1.0 / 255);
      runtime.pointcolor[2] += (surf.samples[lightmapOffset + 2] ?? 0) * scale[2] * (1.0 / 255);
      lightmapOffset += 3 * sampleStride * (((surf.extents[1] >> 4) + 1));
    }

    return 1;
  }

  result = RecursiveLightPoint(runtime, node.children[side === 0 ? 1 : 0], mid, end);
  return result;
}

/**
 * Original name: R_LightPoint
 * Source: ref_gl/gl_light.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Samples static and dynamic lighting for one entity point.
 */
export function R_LightPoint(runtime: GlLightRuntime, p: vec3_t, color: vec3_t): void {
  const worldmodel = runtime.r_worldmodel;
  const refdef = runtime.r_newrefdef;
  if (!worldmodel) {
    throw new Error("R_LightPoint: r_worldmodel is null");
  }
  if (!refdef) {
    throw new Error("R_LightPoint: r_newrefdef is null");
  }

  if (!worldmodel.lightdata) {
    color[0] = 1.0;
    color[1] = 1.0;
    color[2] = 1.0;
    return;
  }

  const end: vec3_t = [p[0], p[1], p[2] - 2048];
  const result = RecursiveLightPoint(runtime, worldmodel.nodes[0] ?? null, p, end);

  if (result === -1) {
    VectorCopy(vec3_origin, color);
  } else {
    VectorCopy(runtime.pointcolor, color);
  }

  const dynamicSource = runtime.currententity?.origin ?? p;
  for (let index = 0; index < refdef.num_dlights; index += 1) {
    const dl = refdef.dlights[index];
    if (!dl) {
      continue;
    }

    const dist: vec3_t = [0, 0, 0];
    VectorSubtract(dynamicSource, dl.origin, dist);
    let add = dl.intensity - VectorLength(dist);
    add *= 1.0 / 256;
    if (add > 0) {
      VectorMA(color, add, dl.color, color);
    }
  }

  VectorScale(color, runtime.gl_modulate, color);
}

/**
 * Original name: R_AddDynamicLights
 * Source: ref_gl/gl_light.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Accumulates dynamic-light contributions into the temporary `s_blocklights` buffer for one surface.
 */
export function R_AddDynamicLights(runtime: GlLightRuntime, surf: msurface_t): void {
  const refdef = runtime.r_newrefdef;
  if (!refdef || !surf.texinfo || !surf.plane) {
    return;
  }

  const smax = (surf.extents[0] >> 4) + 1;
  const tmax = (surf.extents[1] >> 4) + 1;
  const tex = surf.texinfo;

  for (let lnum = 0; lnum < refdef.num_dlights; lnum += 1) {
    if ((surf.dlightbits & (1 << lnum)) === 0) {
      continue;
    }

    const dl = refdef.dlights[lnum];
    if (!dl) {
      continue;
    }

    let frad = dl.intensity;
    const fdist = DotProduct(dl.origin, surf.plane.normal) - surf.plane.dist;
    frad -= Math.abs(fdist);

    let fminlight = DLIGHT_CUTOFF;
    if (frad < fminlight) {
      continue;
    }
    fminlight = frad - fminlight;

    const impact: vec3_t = [
      dl.origin[0] - surf.plane.normal[0] * fdist,
      dl.origin[1] - surf.plane.normal[1] * fdist,
      dl.origin[2] - surf.plane.normal[2] * fdist
    ];

    const local0 = dotTexAxis(impact, tex.vecs[0]) - surf.texturemins[0];
    const local1 = dotTexAxis(impact, tex.vecs[1]) - surf.texturemins[1];

    let blocklightIndex = 0;
    let ftacc = 0;
    for (let t = 0; t < tmax; t += 1, ftacc += 16) {
      let td = Math.trunc(local1 - ftacc);
      if (td < 0) {
        td = -td;
      }

      let fsacc = 0;
      for (let s = 0; s < smax; s += 1, fsacc += 16, blocklightIndex += 3) {
        let sd = Math.trunc(local0 - fsacc);
        if (sd < 0) {
          sd = -sd;
        }

        const sampleDistance = sd > td ? sd + (td >> 1) : td + (sd >> 1);
        if (sampleDistance < fminlight) {
          runtime.s_blocklights[blocklightIndex] += (frad - sampleDistance) * dl.color[0];
          runtime.s_blocklights[blocklightIndex + 1] += (frad - sampleDistance) * dl.color[1];
          runtime.s_blocklights[blocklightIndex + 2] += (frad - sampleDistance) * dl.color[2];
        }
      }
    }
  }
}

/**
 * Original name: R_SetCacheState
 * Source: ref_gl/gl_light.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Copies the current lightstyle white values into the surface cache stamp.
 */
export function R_SetCacheState(runtime: GlLightRuntime, surf: msurface_t): void {
  const refdef = runtime.r_newrefdef;
  if (!refdef) {
    throw new Error("R_SetCacheState: r_newrefdef is null");
  }

  for (let maps = 0; maps < MAXLIGHTMAPS && surf.styles[maps] !== 255; maps += 1) {
    const style = refdef.lightstyles[surf.styles[maps]];
    surf.cached_light[maps] = style?.white ?? 0;
  }
}

/**
 * Original name: R_BuildLightMap
 * Source: ref_gl/gl_light.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Builds one RGBA lightmap block from the baked styles and active dynamic lights for a surface.
 */
export function R_BuildLightMap(runtime: GlLightRuntime, surf: msurface_t, dest: Uint8Array, stride: number): void {
  const refdef = runtime.r_newrefdef;
  if (!refdef || !surf.texinfo) {
    throw new Error("R_BuildLightMap: missing renderer state");
  }

  if ((surf.texinfo.flags & (SURF_SKY | SURF_TRANS33 | SURF_TRANS66 | SURF_WARP)) !== 0) {
    throw new Error("R_BuildLightMap called for non-lit surface");
  }

  const smax = (surf.extents[0] >> 4) + 1;
  const tmax = (surf.extents[1] >> 4) + 1;
  const size = smax * tmax;
  if (size > MAX_BLOCKLIGHT_SURFACE_SIZE) {
    throw new Error("Bad s_blocklights size");
  }

  if (!surf.samples) {
    runtime.s_blocklights.fill(255, 0, size * 3);
  } else {
    let nummaps = 0;
    while (nummaps < MAXLIGHTMAPS && surf.styles[nummaps] !== 255) {
      nummaps += 1;
    }

    let lightmapOffset = 0;
    if (nummaps === 1) {
      for (let maps = 0; maps < MAXLIGHTMAPS && surf.styles[maps] !== 255; maps += 1) {
        const style = refdef.lightstyles[surf.styles[maps]];
        const scale: vec3_t = style
          ? [
              runtime.gl_modulate * style.rgb[0],
              runtime.gl_modulate * style.rgb[1],
              runtime.gl_modulate * style.rgb[2]
            ]
          : [0, 0, 0];

        let blocklightIndex = 0;
        if (scale[0] === 1.0 && scale[1] === 1.0 && scale[2] === 1.0) {
          for (let index = 0; index < size; index += 1, blocklightIndex += 3) {
            runtime.s_blocklights[blocklightIndex] = surf.samples[lightmapOffset + index * 3] ?? 0;
            runtime.s_blocklights[blocklightIndex + 1] = surf.samples[lightmapOffset + index * 3 + 1] ?? 0;
            runtime.s_blocklights[blocklightIndex + 2] = surf.samples[lightmapOffset + index * 3 + 2] ?? 0;
          }
        } else {
          for (let index = 0; index < size; index += 1, blocklightIndex += 3) {
            runtime.s_blocklights[blocklightIndex] = (surf.samples[lightmapOffset + index * 3] ?? 0) * scale[0];
            runtime.s_blocklights[blocklightIndex + 1] = (surf.samples[lightmapOffset + index * 3 + 1] ?? 0) * scale[1];
            runtime.s_blocklights[blocklightIndex + 2] = (surf.samples[lightmapOffset + index * 3 + 2] ?? 0) * scale[2];
          }
        }
        lightmapOffset += size * 3;
      }
    } else {
      runtime.s_blocklights.fill(0, 0, size * 3);
      for (let maps = 0; maps < MAXLIGHTMAPS && surf.styles[maps] !== 255; maps += 1) {
        const style = refdef.lightstyles[surf.styles[maps]];
        const scale: vec3_t = style
          ? [
              runtime.gl_modulate * style.rgb[0],
              runtime.gl_modulate * style.rgb[1],
              runtime.gl_modulate * style.rgb[2]
            ]
          : [0, 0, 0];

        let blocklightIndex = 0;
        if (scale[0] === 1.0 && scale[1] === 1.0 && scale[2] === 1.0) {
          for (let index = 0; index < size; index += 1, blocklightIndex += 3) {
            runtime.s_blocklights[blocklightIndex] += surf.samples[lightmapOffset + index * 3] ?? 0;
            runtime.s_blocklights[blocklightIndex + 1] += surf.samples[lightmapOffset + index * 3 + 1] ?? 0;
            runtime.s_blocklights[blocklightIndex + 2] += surf.samples[lightmapOffset + index * 3 + 2] ?? 0;
          }
        } else {
          for (let index = 0; index < size; index += 1, blocklightIndex += 3) {
            runtime.s_blocklights[blocklightIndex] += (surf.samples[lightmapOffset + index * 3] ?? 0) * scale[0];
            runtime.s_blocklights[blocklightIndex + 1] += (surf.samples[lightmapOffset + index * 3 + 1] ?? 0) * scale[1];
            runtime.s_blocklights[blocklightIndex + 2] += (surf.samples[lightmapOffset + index * 3 + 2] ?? 0) * scale[2];
          }
        }
        lightmapOffset += size * 3;
      }
    }
  }

  if (surf.dlightframe === runtime.r_framecount) {
    R_AddDynamicLights(runtime, surf);
  }

  const rowAdvance = stride - (smax << 2);
  let blocklightIndex = 0;
  let destOffset = 0;
  const monolightmap = (runtime.gl_monolightmap[0] ?? "0").toUpperCase();

  for (let i = 0; i < tmax; i += 1) {
    for (let j = 0; j < smax; j += 1) {
      let r = Math.trunc(runtime.s_blocklights[blocklightIndex]);
      let g = Math.trunc(runtime.s_blocklights[blocklightIndex + 1]);
      let b = Math.trunc(runtime.s_blocklights[blocklightIndex + 2]);

      if (r < 0) {
        r = 0;
      }
      if (g < 0) {
        g = 0;
      }
      if (b < 0) {
        b = 0;
      }

      let max = r > g ? r : g;
      if (b > max) {
        max = b;
      }

      let a = max;
      if (max > 255) {
        const scale = 255.0 / max;
        r = Math.trunc(r * scale);
        g = Math.trunc(g * scale);
        b = Math.trunc(b * scale);
        a = Math.trunc(a * scale);
      }

      if (monolightmap !== "0") {
        switch (monolightmap) {
          case "L":
          case "I":
            r = a;
            g = 0;
            b = 0;
            break;
          case "C":
            a = 255 - Math.trunc((r + g + b) / 3);
            r = Math.trunc(r * (a / 255.0));
            g = Math.trunc(g * (a / 255.0));
            b = Math.trunc(b * (a / 255.0));
            break;
          case "A":
          default:
            r = 0;
            g = 0;
            b = 0;
            a = 255 - a;
            break;
        }
      }

      dest[destOffset] = r;
      dest[destOffset + 1] = g;
      dest[destOffset + 2] = b;
      dest[destOffset + 3] = a;

      blocklightIndex += 3;
      destOffset += 4;
    }
    destOffset += rowAdvance;
  }
}

/**
 * Original name: N/A
 * Source: N/A (gl_rsurf light hook adapter)
 * Category: New
 * Purpose: Expose `gl_light.c` hooks in the shape expected by the existing `gl_rsurf.c` port.
 */
export function createGlLightRsurfHooks(runtime: GlLightRuntime) {
  return {
    setCacheState: (surface: msurface_t) => {
      R_SetCacheState(runtime, surface);
    },
    buildLightMap: (surface: msurface_t, dest: Uint8Array, stride: number) => {
      R_BuildLightMap(runtime, surface, dest, stride);
    },
    markBrushModelLights: (model: model_t) => {
      R_MarkModelLights(runtime, model);
    }
  };
}

/**
 * Original name: N/A
 * Source: N/A (gl_rmain light hook adapter)
 * Category: New
 * Purpose: Expose `gl_light.c` hooks in the shape consumed by the `gl_rmain.c` port.
 *
 * Constraints:
 * - Must delegate directly to the source-port routines (`R_PushDlights`, `R_RenderDlights`, `R_LightPoint`).
 * - Must return a fresh color vector for `lightPoint` without mutating caller-owned input vectors.
 */
export function createGlLightRmainHooks(runtime: GlLightRuntime) {
  return {
    pushDlights: (): void => {
      R_PushDlights(runtime);
    },
    renderDlights: (): void => {
      R_RenderDlights(runtime);
    },
    lightPoint: (origin: vec3_t): vec3_t => {
      const color: vec3_t = [0, 0, 0];
      R_LightPoint(runtime, [origin[0], origin[1], origin[2]], color);
      return color;
    }
  };
}

/**
 * Original name: N/A
 * Source: N/A (renderer light state setter)
 * Category: New
 * Purpose: Bind the world model consumed by the light BSP traversal routines.
 */
export function setGlLightWorldModel(runtime: GlLightRuntime, model: model_t | null): void {
  runtime.r_worldmodel = model;
}

/**
 * Original name: N/A
 * Source: N/A (renderer light state setter)
 * Category: New
 * Purpose: Bind the current refdef consumed by dynamic-light, style and point-light sampling.
 */
export function setGlLightRefdef(runtime: GlLightRuntime, refdef: refdef_t | null): void {
  runtime.r_newrefdef = refdef;
}

/**
 * Original name: N/A
 * Source: N/A (renderer light state setter)
 * Category: New
 * Purpose: Bind the current entity used by `R_LightPoint` dynamic-light accumulation.
 */
export function setGlLightCurrentEntity(runtime: GlLightRuntime, entity: entity_t | null): void {
  runtime.currententity = entity;
}

/**
 * Original name: N/A
 * Source: N/A (renderer light state setter)
 * Category: New
 * Purpose: Bind the current view vectors used by the flashblend dlight renderer.
 */
export function setGlLightViewVectors(runtime: GlLightRuntime, options: {
  origin?: vec3_t;
  vpn?: vec3_t;
  vright?: vec3_t;
  vup?: vec3_t;
}): void {
  if (options.origin) {
    runtime.r_origin = [...options.origin];
  }
  if (options.vpn) {
    runtime.vpn = [...options.vpn];
  }
  if (options.vright) {
    runtime.vright = [...options.vright];
  }
  if (options.vup) {
    runtime.vup = [...options.vup];
  }
}

/**
 * Original name: N/A
 * Source: N/A (renderer light state setter)
 * Category: New
 * Purpose: Bind the current frame index used by dlight marking and lightmap rebuild checks.
 */
export function setGlLightFrameCount(runtime: GlLightRuntime, frameCount: number): void {
  runtime.r_framecount = frameCount;
}

/**
 * Original name: N/A
 * Source: N/A (renderer light cvar adapter)
 * Category: New
 * Purpose: Toggle the original `gl_flashblend` behavior.
 */
export function setGlFlashblendEnabled(runtime: GlLightRuntime, enabled: boolean): void {
  runtime.gl_flashblend = enabled;
}

/**
 * Original name: N/A
 * Source: N/A (renderer light cvar adapter)
 * Category: New
 * Purpose: Preserve the current `gl_modulate` scalar used across static and dynamic lighting.
 */
export function setGlModulate(runtime: GlLightRuntime, value: number): void {
  runtime.gl_modulate = value;
}

/**
 * Original name: N/A
 * Source: N/A (renderer light cvar adapter)
 * Category: New
 * Purpose: Preserve the current `gl_monolightmap` mode consumed by `R_BuildLightMap`.
 */
export function setGlMonolightmapMode(runtime: GlLightRuntime, mode: string): void {
  runtime.gl_monolightmap = mode;
}

/**
 * Original name: N/A
 * Source: N/A (BSP child type guard)
 * Category: New
 * Purpose: Distinguish Quake BSP nodes from leaves in the typed renderer model graph.
 */
function isMNode(node: mnode_child_t): node is mnode_t {
  return node.contents === -1;
}

/**
 * Original name: N/A
 * Source: N/A (texture-axis dot helper)
 * Category: New
 * Purpose: Share the lightmap texture-axis projection used by the ported lighting routines.
 */
function dotTexAxis(point: vec3_t, axis: [number, number, number, number]): number {
  return DotProduct(point, [axis[0], axis[1], axis[2]]) + axis[3];
}

/**
 * Original name: N/A
 * Source: N/A (plane-distance helper)
 * Category: New
 * Purpose: Preserve axial-plane fast paths for BSP light-point tracing in typed code.
 */
function dotPlaneDistance(point: vec3_t, plane: cplane_t): number {
  switch (plane.type) {
    case PLANE_X:
      return point[0] - plane.dist;
    case PLANE_Y:
      return point[1] - plane.dist;
    case PLANE_Z:
      return point[2] - plane.dist;
    default:
      return DotProduct(point, plane.normal) - plane.dist;
  }
}
