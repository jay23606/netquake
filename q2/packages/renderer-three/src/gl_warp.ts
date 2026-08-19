/**
 * File: gl_warp.ts
 * Source: Quake II original / ref_gl/gl_warp.c
 * Purpose: Port the sky and water polygon helpers used by the original GL renderer.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Replaces renderer globals with an explicit runtime.
 * - Returns structured geometry/UV payloads instead of issuing immediate-mode GL commands directly.
 * - Keeps `ref_gl/warpsin.h` immutable and stores the `gl_rmain.c` bootstrap scale in runtime state.
 *
 * Notes:
 * - This file is the principal attachment point for `ref_gl/gl_warp.c`.
 * - The current tranche focuses on polygon subdivision, water turbulence, sky bounds collection and sky texture selection.
 */

import { SURF_FLOWING } from "../../formats/src/index.js";
import {
  DotProduct,
  ERR_DROP,
  MAX_QPATH,
  type cvar_t,
  type qboolean,
  type vec3_t
} from "../../qcommon/src/index.js";
import {
  SIDE_BACK,
  SIDE_FRONT,
  SIDE_ON,
  VERTEXSIZE,
  createGlPoly,
  type glpoly_t,
  type glpoly_vertex_t,
  type image_t,
  type model_t,
  type msurface_t
} from "./gl_model.js";
import { r_turbsin } from "./warpsin.js";

/**
 * Original name: SUBDIVIDE_SIZE
 * Source: ref_gl/gl_warp.c
 * Category: Ported
 */
export const SUBDIVIDE_SIZE = 64;

/**
 * Original name: TURBSCALE
 * Source: ref_gl/gl_warp.c
 * Category: Ported
 */
export const TURBSCALE = 256.0 / (2 * Math.PI);

/**
 * Original name: ON_EPSILON
 * Source: ref_gl/gl_warp.c
 * Category: Ported
 */
export const ON_EPSILON = 0.1;

/**
 * Original name: MAX_CLIP_VERTS
 * Source: ref_gl/gl_warp.c
 * Category: Ported
 */
export const MAX_CLIP_VERTS = 64;

/**
 * Original name: skytexorder
 * Source: ref_gl/gl_warp.c
 * Category: Ported
 */
export const SKY_TEX_ORDER = [0, 2, 1, 3, 4, 5] as const;

/**
 * Original name: suf
 * Source: ref_gl/gl_warp.c
 * Category: Ported
 */
export const SKY_SUFFIXES = ["rt", "bk", "lf", "ft", "up", "dn"] as const;

/**
 * Original name: st_to_vec
 * Source: ref_gl/gl_warp.c
 * Category: Ported
 */
export const ST_TO_VEC = [
  [3, -1, 2],
  [-3, 1, 2],
  [1, 3, 2],
  [-1, -3, 2],
  [-2, -1, 3],
  [2, -1, -3]
] as const;

/**
 * Original name: vec_to_st
 * Source: ref_gl/gl_warp.c
 * Category: Ported
 */
export const VEC_TO_ST = [
  [-2, 3, 1],
  [2, 3, -1],
  [1, 3, 2],
  [-1, 3, -2],
  [-2, -1, 3],
  [-2, 1, -3]
] as const;

/**
 * Original name: skyclip
 * Source: ref_gl/gl_warp.c
 * Category: Ported
 */
export const SKY_CLIP = [
  [1, 1, 0],
  [1, -1, 0],
  [0, -1, 1],
  [0, 1, 1],
  [1, 0, 1],
  [-1, 0, 1]
] as const satisfies readonly vec3_t[];

/**
 * Original name: N/A
 * Source: N/A (sky adapter clamp helper)
 * Category: New
 * Purpose: Expose the original static/rotating sky clamp bounds to Three.js sky fallback code.
 */
export function getSkyTexClampBounds(rotate: number): { skyMin: number; skyMax: number } {
  if (rotate !== 0) {
    return {
      skyMin: 1.0 / 256,
      skyMax: 255.0 / 256
    };
  }

  return {
    skyMin: 1.0 / 512,
    skyMax: 511.0 / 512
  };
}

/**
 * Original name: N/A
 * Source: N/A (water geometry payload)
 * Category: New
 */
export interface GlWarpWaterVertex {
  position: vec3_t;
  uv: [number, number];
}

/**
 * Original name: N/A
 * Source: N/A (water geometry payload)
 * Category: New
 */
export interface GlWarpWaterPoly {
  vertices: GlWarpWaterVertex[];
}

/**
 * Original name: N/A
 * Source: N/A (sky geometry payload)
 * Category: New
 */
export interface GlWarpSkyFace {
  axis: number;
  mins: [number, number];
  maxs: [number, number];
  image: image_t | null;
  vertices: Array<{
    position: vec3_t;
    uv: [number, number];
  }>;
}

/**
 * Original name: ref_gl/gl_warp.c renderer globals
 * Source: ref_gl/gl_warp.c
 * Category: Adapter
 * Purpose: Carry the original warp and sky globals explicitly for the Three.js renderer instance.
 */
export interface GlWarpRuntime {
  loadmodel: model_t | null;
  warpface: msurface_t | null;
  r_origin: vec3_t;
  r_newrefdef_time: number;
  skyname: string;
  skyrotate: number;
  skyaxis: vec3_t;
  sky_images: Array<image_t | null>;
  skymins: [number[], number[]];
  skymaxs: [number[], number[]];
  sky_min: number;
  sky_max: number;
  c_sky: number;
  gl_skymip: cvar_t | null;
  gl_picmip: cvar_t | null;
  gl_ext_palettedtexture: cvar_t | null;
  qglColorTableEXT: qboolean;
  turbulence_scale: number;
  r_notexture: image_t | null;
  hooks: {
    findImage?: (path: string, type: "sky") => image_t | null;
    sysError?: (level: number, message: string) => never;
  };
}

/**
 * Original name: N/A
 * Source: N/A (warp runtime factory)
 * Category: New
 * Purpose: Allocate a fresh explicit runtime for the state that C stores in renderer globals.
 */
export function createGlWarpRuntime(): GlWarpRuntime {
  return {
    loadmodel: null,
    warpface: null,
    r_origin: [0, 0, 0],
    r_newrefdef_time: 0,
    skyname: "",
    skyrotate: 0,
    skyaxis: [0, 0, 0],
    sky_images: Array.from({ length: 6 }, () => null),
    skymins: [Array.from({ length: 6 }, () => 9999), Array.from({ length: 6 }, () => 9999)],
    skymaxs: [Array.from({ length: 6 }, () => -9999), Array.from({ length: 6 }, () => -9999)],
    sky_min: 1 / 512,
    sky_max: 511 / 512,
    c_sky: 0,
    gl_skymip: null,
    gl_picmip: null,
    gl_ext_palettedtexture: null,
    qglColorTableEXT: false,
    turbulence_scale: 0.5,
    r_notexture: null,
    hooks: {}
  };
}

/**
 * Original name: N/A
 * Source: N/A (warp runtime setter)
 * Category: New
 */
export function setWarpModel(runtime: GlWarpRuntime, model: model_t | null): void {
  runtime.loadmodel = model;
}

/**
 * Original name: N/A
 * Source: N/A (warp runtime setter)
 * Category: New
 */
export function setWarpRefdefTime(runtime: GlWarpRuntime, time: number): void {
  runtime.r_newrefdef_time = time;
}

/**
 * Original name: N/A
 * Source: N/A (warp runtime setter)
 * Category: New
 */
export function setWarpViewOrigin(runtime: GlWarpRuntime, origin: vec3_t): void {
  runtime.r_origin = [...origin];
}

/**
 * Original name: N/A
 * Source: N/A (warp runtime setter)
 * Category: New
 */
export function setWarpSkyCvars(runtime: GlWarpRuntime, cvars: Partial<Pick<GlWarpRuntime,
  "gl_skymip" | "gl_picmip" | "gl_ext_palettedtexture"
>>): void {
  Object.assign(runtime, cvars);
}

/**
 * Original name: N/A
 * Source: N/A (warp runtime setter)
 * Category: New
 */
export function setWarpPaletteExtensionState(runtime: GlWarpRuntime, enabled: qboolean): void {
  runtime.qglColorTableEXT = enabled;
}

/**
 * Original name: r_turbsin bootstrap scale in R_Init
 * Source: ref_gl/gl_rmain.c + ref_gl/gl_warp.c
 * Category: Adapter
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies the post-`R_Init` turbulence amplitude used by water warping without mutating the canonical table.
 */
export function setWarpTurbulenceScale(runtime: GlWarpRuntime, scale: number): void {
  runtime.turbulence_scale = scale;
}

/**
 * Original name: N/A
 * Source: N/A (warp runtime setter)
 * Category: New
 */
export function setWarpFallbackTexture(runtime: GlWarpRuntime, image: image_t | null): void {
  runtime.r_notexture = image;
}

/**
 * Original name: N/A
 * Source: N/A (warp runtime setter)
 * Category: New
 */
export function setWarpHooks(runtime: GlWarpRuntime, hooks: GlWarpRuntime["hooks"]): void {
  runtime.hooks = hooks;
}

/**
 * Original name: BoundPoly
 * Source: ref_gl/gl_warp.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Computes axis-aligned bounds for one flat or vector polygon vertex list.
 */
export function BoundPoly(numverts: number, verts: readonly number[] | readonly vec3_t[], mins: vec3_t, maxs: vec3_t): void {
  mins[0] = mins[1] = mins[2] = 9999;
  maxs[0] = maxs[1] = maxs[2] = -9999;

  if (typeof verts[0] === "number") {
    const flat = verts as readonly number[];
    for (let index = 0; index < numverts; index += 1) {
      const offset = index * 3;
      for (let axis = 0; axis < 3; axis += 1) {
        const value = flat[offset + axis] ?? 0;
        if (value < mins[axis]) {
          mins[axis] = value;
        }
        if (value > maxs[axis]) {
          maxs[axis] = value;
        }
      }
    }
    return;
  }

  const vectors = verts as readonly vec3_t[];
  for (let index = 0; index < numverts; index += 1) {
    const vector = vectors[index];
    if (!vector) {
      continue;
    }
    for (let axis = 0; axis < 3; axis += 1) {
      const value = vector[axis];
      if (value < mins[axis]) {
        mins[axis] = value;
      }
      if (value > maxs[axis]) {
        maxs[axis] = value;
      }
    }
  }
}

/**
 * Original name: SubdividePolygon
 * Source: ref_gl/gl_warp.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Recursively splits warp polygons along 64-unit axial boundaries, then inserts the center and closing vertices.
 *
 * Porting notes:
 * - Allocates `glpoly_t` objects on the JS heap and returns the created chain entries for tests/adapters.
 */
export function SubdividePolygon(runtime: GlWarpRuntime, numverts: number, verts: readonly vec3_t[]): glpoly_t[] {
  if (numverts > 60) {
    failSysError(runtime, ERR_DROP, `numverts = ${numverts}`);
  }

  const mins: vec3_t = [0, 0, 0];
  const maxs: vec3_t = [0, 0, 0];
  BoundPoly(numverts, verts, mins, maxs);

  for (let axis = 0; axis < 3; axis += 1) {
    let m = (mins[axis] + maxs[axis]) * 0.5;
    m = SUBDIVIDE_SIZE * Math.floor(m / SUBDIVIDE_SIZE + 0.5);
    if (maxs[axis] - m < 8 || m - mins[axis] < 8) {
      continue;
    }

    const dist = new Array<number>(numverts + 1).fill(0);
    for (let index = 0; index < numverts; index += 1) {
      dist[index] = (verts[index]?.[axis] ?? 0) - m;
    }
    dist[numverts] = dist[0];

    const wrapped = [...verts.map((vertex) => [...vertex] as vec3_t), [...(verts[0] ?? [0, 0, 0])] as vec3_t];
    const front: vec3_t[] = [];
    const back: vec3_t[] = [];

    for (let index = 0; index < numverts; index += 1) {
      const current = wrapped[index];
      const next = wrapped[index + 1];
      const currentDist = dist[index];
      const nextDist = dist[index + 1];

      if (currentDist >= 0) {
        front.push([...current] as vec3_t);
      }
      if (currentDist <= 0) {
        back.push([...current] as vec3_t);
      }
      if (currentDist === 0 || nextDist === 0) {
        continue;
      }
      if ((currentDist > 0) !== (nextDist > 0)) {
        const frac = currentDist / (currentDist - nextDist);
        const clip: vec3_t = [
          current[0] + frac * (next[0] - current[0]),
          current[1] + frac * (next[1] - current[1]),
          current[2] + frac * (next[2] - current[2])
        ];
        front.push([...clip] as vec3_t);
        back.push([...clip] as vec3_t);
      }
    }

    return [
      ...SubdividePolygon(runtime, front.length, front),
      ...SubdividePolygon(runtime, back.length, back)
    ];
  }

  const warpface = runtime.warpface;
  if (!warpface?.texinfo) {
    throw new Error("SubdividePolygon: warpface or texinfo is null");
  }

  const poly = createGlPoly();
  poly.next = warpface.polys;
  poly.numverts = numverts + 2;
  poly.verts = Array.from({ length: poly.numverts }, () => [0, 0, 0, 0, 0, 0, 0]);

  const total: vec3_t = [0, 0, 0];
  let total_s = 0;
  let total_t = 0;

  for (let index = 0; index < numverts; index += 1) {
    const vertex = verts[index];
    const sAxis: vec3_t = [warpface.texinfo.vecs[0][0], warpface.texinfo.vecs[0][1], warpface.texinfo.vecs[0][2]];
    const tAxis: vec3_t = [warpface.texinfo.vecs[1][0], warpface.texinfo.vecs[1][1], warpface.texinfo.vecs[1][2]];
    const s = DotProduct(vertex, sAxis);
    const t = DotProduct(vertex, tAxis);
    poly.verts[index + 1] = [vertex[0], vertex[1], vertex[2], s, t, 0, 0];
    total[0] += vertex[0];
    total[1] += vertex[1];
    total[2] += vertex[2];
    total_s += s;
    total_t += t;
  }

  poly.verts[0] = [total[0] / numverts, total[1] / numverts, total[2] / numverts, total_s / numverts, total_t / numverts, 0, 0];
  poly.verts[numverts + 1] = [...poly.verts[1]] as glpoly_vertex_t;
  warpface.polys = poly;
  return [poly];
}

/**
 * Original name: GL_SubdivideSurface
 * Source: ref_gl/gl_warp.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Rebuilds one BSP surface polygon from surfedges and subdivides it for turbulent or sky rendering.
 */
export function GL_SubdivideSurface(runtime: GlWarpRuntime, fa: msurface_t): glpoly_t[] {
  const model = runtime.loadmodel;
  if (!model) {
    throw new Error("GL_SubdivideSurface: loadmodel is null");
  }

  runtime.warpface = fa;
  const verts: vec3_t[] = [];

  for (let index = 0; index < fa.numedges; index += 1) {
    const lindex = model.surfedges[fa.firstedge + index] ?? 0;
    let vec: vec3_t | undefined;
    if (lindex > 0) {
      vec = model.vertexes[model.edges[lindex].v[0]]?.position;
    } else {
      vec = model.vertexes[model.edges[-lindex].v[1]]?.position;
    }
    if (!vec) {
      throw new Error("GL_SubdivideSurface: missing source vertex");
    }
    verts.push([...vec] as vec3_t);
  }

  return SubdividePolygon(runtime, verts.length, verts);
}

/**
 * Original name: EmitWaterPolys
 * Source: ref_gl/gl_warp.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies the original turbulence sine lookup and flowing scroll to each fragmented water polygon.
 *
 * Porting notes:
 * - Returns geometry/UV payloads for Three.js instead of issuing immediate-mode GL calls.
 */
export function EmitWaterPolys(runtime: GlWarpRuntime, fa: msurface_t): GlWarpWaterPoly[] {
  const out: GlWarpWaterPoly[] = [];
  const rdt = runtime.r_newrefdef_time;
  const scroll = fa.texinfo && (fa.texinfo.flags & SURF_FLOWING) !== 0
    ? -64 * (rdt * 0.5 - Math.trunc(rdt * 0.5))
    : 0;

  for (let bp = fa.polys; bp; bp = bp.next) {
    const vertices: GlWarpWaterVertex[] = [];
    for (let index = 0; index < bp.numverts; index += 1) {
      const v = bp.verts[index];
      const os = v[3];
      const ot = v[4];
      let s = os + r_turbsin[Math.trunc((ot * 0.125 + runtime.r_newrefdef_time) * TURBSCALE) & 255] * runtime.turbulence_scale;
      s += scroll;
      s *= 1.0 / 64;
      let t = ot + r_turbsin[Math.trunc((os * 0.125 + rdt) * TURBSCALE) & 255] * runtime.turbulence_scale;
      t *= 1.0 / 64;
      vertices.push({
        position: [v[0], v[1], v[2]],
        uv: [s, t]
      });
    }
    out.push({ vertices });
  }

  return out;
}

/**
 * Original name: DrawSkyPolygon
 * Source: ref_gl/gl_warp.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Chooses the dominant skybox face for one clipped polygon and expands that face's texture bounds.
 */
export function DrawSkyPolygon(runtime: GlWarpRuntime, nump: number, vecs: readonly vec3_t[]): number {
  runtime.c_sky += 1;
  const v: vec3_t = [0, 0, 0];
  for (let index = 0; index < nump; index += 1) {
    const point = vecs[index];
    v[0] += point[0];
    v[1] += point[1];
    v[2] += point[2];
  }

  const av: vec3_t = [Math.abs(v[0]), Math.abs(v[1]), Math.abs(v[2])];
  let axis = 4;
  if (av[0] > av[1] && av[0] > av[2]) {
    axis = v[0] < 0 ? 1 : 0;
  } else if (av[1] > av[2] && av[1] > av[0]) {
    axis = v[1] < 0 ? 3 : 2;
  } else {
    axis = v[2] < 0 ? 5 : 4;
  }

  for (let index = 0; index < nump; index += 1) {
    const point = vecs[index];
    const dvIndex = VEC_TO_ST[axis][2];
    const dv = dvIndex > 0 ? point[dvIndex - 1] : -point[-dvIndex - 1];
    if (dv < 0.001) {
      continue;
    }

    const sIndex = VEC_TO_ST[axis][0];
    const s = sIndex < 0 ? -point[-sIndex - 1] / dv : point[sIndex - 1] / dv;
    const tIndex = VEC_TO_ST[axis][1];
    const t = tIndex < 0 ? -point[-tIndex - 1] / dv : point[tIndex - 1] / dv;

    if (s < runtime.skymins[0][axis]) {
      runtime.skymins[0][axis] = s;
    }
    if (t < runtime.skymins[1][axis]) {
      runtime.skymins[1][axis] = t;
    }
    if (s > runtime.skymaxs[0][axis]) {
      runtime.skymaxs[0][axis] = s;
    }
    if (t > runtime.skymaxs[1][axis]) {
      runtime.skymaxs[1][axis] = t;
    }
  }

  return axis;
}

/**
 * Original name: ClipSkyPolygon
 * Source: ref_gl/gl_warp.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Clips one sky polygon through the six original sky planes before accumulating skybox bounds.
 */
export function ClipSkyPolygon(runtime: GlWarpRuntime, nump: number, vecs: readonly vec3_t[], stage: number): void {
  if (nump > MAX_CLIP_VERTS - 2) {
    failSysError(runtime, ERR_DROP, "ClipSkyPolygon: MAX_CLIP_VERTS");
  }
  if (stage === 6) {
    DrawSkyPolygon(runtime, nump, vecs);
    return;
  }

  const norm = SKY_CLIP[stage];
  const dists = new Array<number>(nump + 1).fill(0);
  const sides = new Array<number>(nump + 1).fill(SIDE_ON);
  let front = false;
  let back = false;

  for (let index = 0; index < nump; index += 1) {
    const d = DotProduct(vecs[index], norm);
    dists[index] = d;
    if (d > ON_EPSILON) {
      front = true;
      sides[index] = SIDE_FRONT;
    } else if (d < -ON_EPSILON) {
      back = true;
      sides[index] = SIDE_BACK;
    }
  }

  if (!front || !back) {
    ClipSkyPolygon(runtime, nump, vecs, stage + 1);
    return;
  }

  sides[nump] = sides[0];
  dists[nump] = dists[0];
  const wrapped = [...vecs.map((vector) => [...vector] as vec3_t), [...vecs[0]] as vec3_t];
  const newv: [vec3_t[], vec3_t[]] = [[], []];

  for (let index = 0; index < nump; index += 1) {
    const v = wrapped[index];
    switch (sides[index]) {
      case SIDE_FRONT:
        newv[0].push([...v] as vec3_t);
        break;
      case SIDE_BACK:
        newv[1].push([...v] as vec3_t);
        break;
      default:
        newv[0].push([...v] as vec3_t);
        newv[1].push([...v] as vec3_t);
        break;
    }

    if (sides[index] === SIDE_ON || sides[index + 1] === SIDE_ON || sides[index + 1] === sides[index]) {
      continue;
    }

    const d = dists[index] / (dists[index] - dists[index + 1]);
    const next = wrapped[index + 1];
    const clip: vec3_t = [
      v[0] + d * (next[0] - v[0]),
      v[1] + d * (next[1] - v[1]),
      v[2] + d * (next[2] - v[2])
    ];
    newv[0].push([...clip] as vec3_t);
    newv[1].push([...clip] as vec3_t);
  }

  ClipSkyPolygon(runtime, newv[0].length, newv[0], stage + 1);
  ClipSkyPolygon(runtime, newv[1].length, newv[1], stage + 1);
}

/**
 * Original name: R_AddSkySurface
 * Source: ref_gl/gl_warp.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Converts visible sky surface vertices into view-relative vectors and feeds the sky clipping pipeline.
 */
export function R_AddSkySurface(runtime: GlWarpRuntime, fa: msurface_t): void {
  for (let poly = fa.polys; poly; poly = poly.next) {
    const verts = poly.verts.slice(0, poly.numverts).map((vertex) => ([
      vertex[0] - runtime.r_origin[0],
      vertex[1] - runtime.r_origin[1],
      vertex[2] - runtime.r_origin[2]
    ] as vec3_t));
    ClipSkyPolygon(runtime, poly.numverts, verts, 0);
  }
}

/**
 * Original name: R_ClearSkyBox
 * Source: ref_gl/gl_warp.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Resets all six skybox face bounds to the original sentinel values.
 */
export function R_ClearSkyBox(runtime: GlWarpRuntime): void {
  for (let index = 0; index < 6; index += 1) {
    runtime.skymins[0][index] = 9999;
    runtime.skymins[1][index] = 9999;
    runtime.skymaxs[0][index] = -9999;
    runtime.skymaxs[1][index] = -9999;
  }
}

/**
 * Original name: MakeSkyVec
 * Source: ref_gl/gl_warp.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Converts one skybox `s/t/axis` tuple into the original 2300-unit position and clamped UV.
 */
export function MakeSkyVec(runtime: GlWarpRuntime, s: number, t: number, axis: number): {
  position: vec3_t;
  uv: [number, number];
} {
  const b: vec3_t = [s * 2300, t * 2300, 2300];
  const v: vec3_t = [0, 0, 0];

  for (let index = 0; index < 3; index += 1) {
    const mapping = ST_TO_VEC[axis][index];
    v[index] = mapping < 0 ? -b[-mapping - 1] : b[mapping - 1];
  }

  let skyS = (s + 1) * 0.5;
  let skyT = (t + 1) * 0.5;

  if (skyS < runtime.sky_min) {
    skyS = runtime.sky_min;
  } else if (skyS > runtime.sky_max) {
    skyS = runtime.sky_max;
  }
  if (skyT < runtime.sky_min) {
    skyT = runtime.sky_min;
  } else if (skyT > runtime.sky_max) {
    skyT = runtime.sky_max;
  }

  return {
    position: v,
    uv: [skyS, 1.0 - skyT]
  };
}

/**
 * Original name: R_DrawSkyBox
 * Source: ref_gl/gl_warp.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits visible skybox face payloads using original bounds, rotating-sky full-face behavior and face order.
 *
 * Porting notes:
 * - Returns face payloads for the Three.js sky adapter instead of binding textures and drawing quads directly.
 */
export function R_DrawSkyBox(runtime: GlWarpRuntime): GlWarpSkyFace[] {
  const faces: GlWarpSkyFace[] = [];

  if (runtime.skyrotate) {
    let foundVisibleFace = false;
    for (let index = 0; index < 6; index += 1) {
      if (runtime.skymins[0][index] < runtime.skymaxs[0][index] && runtime.skymins[1][index] < runtime.skymaxs[1][index]) {
        foundVisibleFace = true;
        break;
      }
    }
    if (!foundVisibleFace) {
      return faces;
    }
  }

  for (let index = 0; index < 6; index += 1) {
    if (runtime.skyrotate) {
      runtime.skymins[0][index] = -1;
      runtime.skymins[1][index] = -1;
      runtime.skymaxs[0][index] = 1;
      runtime.skymaxs[1][index] = 1;
    }

    if (runtime.skymins[0][index] >= runtime.skymaxs[0][index] || runtime.skymins[1][index] >= runtime.skymaxs[1][index]) {
      continue;
    }

    faces.push({
      axis: index,
      mins: [runtime.skymins[0][index], runtime.skymins[1][index]],
      maxs: [runtime.skymaxs[0][index], runtime.skymaxs[1][index]],
      image: runtime.sky_images[SKY_TEX_ORDER[index]] ?? null,
      vertices: [
        MakeSkyVec(runtime, runtime.skymins[0][index], runtime.skymins[1][index], index),
        MakeSkyVec(runtime, runtime.skymins[0][index], runtime.skymaxs[1][index], index),
        MakeSkyVec(runtime, runtime.skymaxs[0][index], runtime.skymaxs[1][index], index),
        MakeSkyVec(runtime, runtime.skymaxs[0][index], runtime.skymins[1][index], index)
      ]
    });
  }

  return faces;
}

/**
 * Original name: R_SetSky
 * Source: ref_gl/gl_warp.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Stores the active sky name, rotation and axis, resolves six face images, and sets sky UV clamp bounds.
 */
export function R_SetSky(runtime: GlWarpRuntime, name: string, rotate: number, axis: vec3_t): void {
  runtime.skyname = name.slice(0, MAX_QPATH - 1);
  runtime.skyrotate = rotate;
  runtime.skyaxis = [...axis];

  for (let index = 0; index < 6; index += 1) {
    const reduceMemory = Boolean(runtime.gl_skymip?.value || runtime.skyrotate);
    if (reduceMemory && runtime.gl_picmip) {
      runtime.gl_picmip.value += 1;
    }

    const pathname = runtime.qglColorTableEXT && runtime.gl_ext_palettedtexture?.value
      ? `env/${runtime.skyname}${SKY_SUFFIXES[index]}.pcx`
      : `env/${runtime.skyname}${SKY_SUFFIXES[index]}.tga`;
    runtime.sky_images[index] = runtime.hooks.findImage?.(pathname, "sky") ?? runtime.r_notexture;

    if (reduceMemory && runtime.gl_picmip) {
      runtime.gl_picmip.value -= 1;
    }

    if (reduceMemory) {
      runtime.sky_min = 1.0 / 256;
      runtime.sky_max = 255.0 / 256;
    } else {
      runtime.sky_min = 1.0 / 512;
      runtime.sky_max = 511.0 / 512;
    }
  }
}

/**
 * Original name: N/A
 * Source: N/A (warp runtime error adapter)
 * Category: New
 */
function failSysError(runtime: GlWarpRuntime, level: number, message: string): never {
  if (runtime.hooks.sysError) {
    return runtime.hooks.sysError(level, message);
  }
  throw new Error(message);
}
