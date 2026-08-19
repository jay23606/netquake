/**
 * File: gl_rsurf.ts
 * Source: Quake II original / ref_gl/gl_rsurf.c
 * Purpose: Port surface-related GL refresh routines for brush polygons, texture animation and lightmap staging.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Replaces GL globals with an explicit runtime object.
 * - Stores lightmap atlas data in typed arrays instead of raw C buffers.
 * - Leaves GPU upload and lightmap rebuild side-effects behind hooks until later renderer stages are ported.
 *
 * Notes:
 * - This file is the principal attachment point for `ref_gl/gl_rsurf.c`.
 * - The first tranche focuses on texture animation, lightmap block bookkeeping and
 *   `GL_BuildPolygonFromSurface`, which is the source-of-truth UV builder for BSP brush surfaces.
 */

import {
  CONTENTS_SOLID,
  PLANE_X,
  PLANE_Y,
  PLANE_Z,
  SURF_FLOWING,
  SURF_SKY,
  SURF_TRANS33,
  SURF_TRANS66,
  SURF_WARP
} from "../../formats/src/index.js";
import { AngleVectors, DotProduct, MAX_LIGHTSTYLES, RF_TRANSLUCENT, VectorAdd, VectorSubtract, type vec3_t } from "../../qcommon/src/index.js";
import { RDF_NOWORLDMODEL } from "../../qcommon/src/index.js";
import { Mod_ClusterPVS } from "./gl_model.js";
import {
  createGlPoly,
  SURF_DRAWSKY,
  SURF_DRAWTURB,
  SURF_PLANEBACK,
  VERTEXSIZE,
  type glpoly_t,
  type image_t,
  type mleaf_t,
  type mnode_child_t,
  type mnode_t,
  type model_t,
  type msurface_t,
  type mtexinfo_t
} from "./gl_model.js";
import type { GlRmainRuntime } from "./gl_rmain.js";

/**
 * Original name: DYNAMIC_LIGHT_WIDTH
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 */
export const DYNAMIC_LIGHT_WIDTH = 128;
/**
 * Original name: DYNAMIC_LIGHT_HEIGHT
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 */
export const DYNAMIC_LIGHT_HEIGHT = 128;
/**
 * Original name: LIGHTMAP_BYTES
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 */
export const LIGHTMAP_BYTES = 4;
/**
 * Original name: BLOCK_WIDTH
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 */
export const BLOCK_WIDTH = 128;
/**
 * Original name: BLOCK_HEIGHT
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 */
export const BLOCK_HEIGHT = 128;
/**
 * Original name: MAX_LIGHTMAPS
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 */
export const MAX_LIGHTMAPS = 128;
/**
 * Original name: GL_LIGHTMAP_FORMAT
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 */
export const GL_LIGHTMAP_FORMAT = "GL_RGBA";
/**
 * Original name: N/A
 * Source: N/A (local GL enum adapter)
 * Category: New
 */
const GL_LIGHTMAP_FORMAT_SOLID = 1;
/**
 * Original name: N/A
 * Source: N/A (local GL enum adapter)
 * Category: New
 */
const GL_LIGHTMAP_FORMAT_ALPHA = 2;
/**
 * Original name: N/A
 * Source: N/A (local GL enum adapter)
 * Category: New
 */
const GL_LIGHTMAP_FORMAT_INTENSITY8 = 3;
/**
 * Original name: N/A
 * Source: N/A (local GL enum adapter)
 * Category: New
 */
const GL_LIGHTMAP_FORMAT_LUMINANCE8 = 4;
/**
 * Original name: BACKFACE_EPSILON
 * Source: ref_gl/gl_local.h
 * Category: Adapter
 */
const BACKFACE_EPSILON = 0.01;

/**
 * Original name: N/A
 * Source: N/A (renderer-three backend hooks)
 * Category: New
 */
export interface GlRsurfHooks {
  setCacheState?: (surface: msurface_t) => void;
  buildLightMap?: (surface: msurface_t, dest: Uint8Array, stride: number) => void;
  uploadLightmapBlock?: (dynamic: boolean, textureIndex: number, buffer: Uint8Array) => void;
  initializeDynamicLightmap?: (
    textureIndex: number,
    width: number,
    height: number,
    internalFormat: number,
    buffer: Uint8Array
  ) => void;
  beginLightmapBuild?: () => void;
  endLightmapBuild?: () => void;
  uploadSurfaceLightmap?: (
    surface: msurface_t,
    textureIndex: number,
    smax: number,
    tmax: number,
    buffer: Uint8Array
  ) => void;
  renderBrushPoly?: (surface: msurface_t, image: image_t | null) => void;
  renderFlowingPoly?: (surface: msurface_t, image: image_t | null, scroll: number) => void;
  renderWaterPoly?: (surface: msurface_t, image: image_t | null) => void;
  renderAlphaSurface?: (surface: msurface_t, image: image_t | null, alpha: number) => void;
  renderLightmappedPoly?: (surface: msurface_t, image: image_t | null) => void;
  renderLightmappedPolyChain?: (surface: msurface_t, image: image_t | null, lightmapTextureIndex: number, scroll: number) => void;
  renderLightmapChainSurface?: (surface: msurface_t, lightmapTextureIndex: number, sOffset: number, tOffset: number) => void;
  renderTriangleOutline?: (
    surface: msurface_t,
    poly: glpoly_t,
    firstVertexIndex: number,
    secondVertexIndex: number,
    thirdVertexIndex: number
  ) => void;
  resetTextureBindings?: () => void;
  beginWorldMultitexture?: (lightmapOnly: boolean) => void;
  endWorldMultitexture?: () => void;
  beginBrushModelMultitexture?: () => void;
  endBrushModelMultitexture?: () => void;
  suspendMultitexture?: () => void;
  resumeMultitexture?: () => void;
  beginAlphaSurfaces?: () => void;
  endAlphaSurfaces?: () => void;
  resetDrawColor?: () => void;
  markBrushModelLights?: (model: model_t) => void;
  cullBox?: (mins: readonly number[], maxs: readonly number[]) => boolean;
  addSkySurface?: (surface: msurface_t) => void;
  clearSkyBox?: () => void;
  blendLightmaps?: () => void;
  drawSkyBox?: () => void;
  beginBrushModelDraw?: (entity: GlRsurfEntityRef, model: model_t, rotated: boolean) => void;
  endBrushModelDraw?: (entity: GlRsurfEntityRef, model: model_t) => void;
}

/**
 * Original name: gllightmapstate_t
 * Source: Quake-2-master/ref_gl/gl_rsurf.c
 * Category: Ported
 */
export interface GlLightmapState {
  internal_format: number;
  current_lightmap_texture: number;
  lightmap_surfaces: Array<msurface_t | null>;
  allocated: Int32Array;
  lightmap_buffer: Uint8Array;
}

/**
 * Original name: N/A
 * Source: N/A (renderer entity adapter)
 * Category: New
 */
export interface GlRsurfEntityRef {
  frame: number;
  flags?: number;
  origin?: vec3_t;
  angles?: vec3_t;
}

/**
 * Original name: lightstyle_t.white
 * Source: Quake-2-master/ref_gl/gl_rsurf.c
 * Category: Adapter
 */
export interface GlRsurfLightstyle {
  white: number;
}

/**
 * Original name: N/A
 * Source: N/A (renderer-three runtime state)
 * Category: New
 */
export interface GlRsurfRuntime {
  r_worldmodel: model_t | null;
  currentmodel: model_t | null;
  currententity: GlRsurfEntityRef | null;
  r_alpha_surfaces: msurface_t | null;
  c_visible_lightmaps: number;
  c_visible_textures: number;
  r_framecount: number;
  gl_dynamic: boolean;
  lightstyles: GlRsurfLightstyle[];
  r_visframecount: number;
  r_viewcluster: number;
  r_viewcluster2: number;
  r_oldviewcluster: number;
  r_oldviewcluster2: number;
  r_novis: boolean;
  gl_lockpvs: boolean;
  r_drawworld: boolean;
  areabits: Uint8Array | null;
  modelorg: vec3_t;
  vieworg: vec3_t;
  rdflags: number;
  currentTime: number;
  multitextureEnabled: boolean;
  monolightmapMode: string;
  currentEntityAlpha: number | null;
  showTriangleOutlines: boolean;
  lightmapOnly: boolean;
  fullbrightEnabled: boolean;
  flashblendEnabled: boolean;
  gl_lms: GlLightmapState;
  hooks: GlRsurfHooks;
}

/**
 * Original name: N/A
 * Source: N/A (renderer-three runtime factory)
 * Category: New
 * Purpose: Create the explicit runtime replacing the mutable `gl_rsurf.c` globals.
 */
export function createGlRsurfRuntime(hooks: GlRsurfHooks = {}): GlRsurfRuntime {
  return {
    r_worldmodel: null,
    currentmodel: null,
    currententity: null,
    r_alpha_surfaces: null,
    c_visible_lightmaps: 0,
    c_visible_textures: 0,
    r_framecount: 0,
    gl_dynamic: false,
    lightstyles: [],
    r_visframecount: 0,
    r_viewcluster: -1,
    r_viewcluster2: -1,
    r_oldviewcluster: -1,
    r_oldviewcluster2: -1,
    r_novis: false,
    gl_lockpvs: false,
    r_drawworld: true,
    areabits: null,
    modelorg: [0, 0, 0],
    vieworg: [0, 0, 0],
    rdflags: 0,
    currentTime: 0,
    multitextureEnabled: false,
    monolightmapMode: "0",
    currentEntityAlpha: null,
    showTriangleOutlines: false,
    lightmapOnly: false,
    fullbrightEnabled: false,
    flashblendEnabled: false,
    gl_lms: {
      internal_format: 0,
      current_lightmap_texture: 1,
      lightmap_surfaces: Array.from({ length: MAX_LIGHTMAPS }, () => null),
      allocated: new Int32Array(BLOCK_WIDTH),
      lightmap_buffer: new Uint8Array(LIGHTMAP_BYTES * BLOCK_WIDTH * BLOCK_HEIGHT)
    },
    hooks
  };
}

/**
 * Original name: R_TextureAnimation
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the animated texture frame selected from one base texinfo chain.
 */
export function R_TextureAnimation(runtime: GlRsurfRuntime, tex: mtexinfo_t): image_t | null {
  if (!tex.next) {
    return tex.image;
  }

  let c = (runtime.currententity?.frame ?? 0) % tex.numframes;
  let animated = tex;
  while (c > 0 && animated.next) {
    animated = animated.next;
    c -= 1;
  }

  return animated.image;
}

/**
 * Original name: LM_InitBlock
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Resets the current lightmap packing skyline.
 */
export function LM_InitBlock(runtime: GlRsurfRuntime): void {
  runtime.gl_lms.allocated.fill(0);
}

/**
 * Original name: LM_AllocBlock
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Packs one rectangular lightmap allocation into the current atlas block.
 */
export function LM_AllocBlock(runtime: GlRsurfRuntime, w: number, h: number): { x: number; y: number } | null {
  let best = BLOCK_HEIGHT;
  let bestX = -1;
  let bestY = -1;

  for (let index = 0; index < BLOCK_WIDTH - w; index += 1) {
    let best2 = 0;
    let offset = 0;
    for (; offset < w; offset += 1) {
      const height = runtime.gl_lms.allocated[index + offset];
      if (height >= best) {
        break;
      }
      if (height > best2) {
        best2 = height;
      }
    }

    if (offset === w) {
      best = best2;
      bestX = index;
      bestY = best2;
    }
  }

  if (bestX < 0 || bestY < 0 || bestY + h > BLOCK_HEIGHT) {
    return null;
  }

  for (let offset = 0; offset < w; offset += 1) {
    runtime.gl_lms.allocated[bestX + offset] = bestY + h;
  }

  return { x: bestX, y: bestY };
}

/**
 * Original name: LM_UploadBlock
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Publishes the currently packed lightmap block through an adapter hook.
 *
 * Porting notes:
 * - GPU upload is deferred to a hook until the backend GL texture path is ported.
 */
export function LM_UploadBlock(runtime: GlRsurfRuntime, dynamic: boolean): void {
  const textureIndex = dynamic ? 0 : runtime.gl_lms.current_lightmap_texture;
  runtime.hooks.uploadLightmapBlock?.(
    dynamic,
    textureIndex,
    runtime.gl_lms.lightmap_buffer
  );

  if (!dynamic) {
    runtime.gl_lms.current_lightmap_texture += 1;
    if (runtime.gl_lms.current_lightmap_texture === MAX_LIGHTMAPS) {
      throw new Error("LM_UploadBlock: MAX_LIGHTMAPS exceeded");
    }
  }
}

/**
 * Original name: GL_CreateSurfaceLightmap
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Allocates one surface rectangle inside the current lightmap atlas and asks the light builder to populate it.
 */
export function GL_CreateSurfaceLightmap(runtime: GlRsurfRuntime, surf: msurface_t): void {
  if ((surf.flags & (SURF_DRAWSKY | SURF_DRAWTURB)) !== 0) {
    return;
  }

  const smax = (surf.extents[0] >> 4) + 1;
  const tmax = (surf.extents[1] >> 4) + 1;

  let allocation = LM_AllocBlock(runtime, smax, tmax);
  if (!allocation) {
    LM_UploadBlock(runtime, false);
    LM_InitBlock(runtime);
    allocation = LM_AllocBlock(runtime, smax, tmax);
    if (!allocation) {
      throw new Error(`Consecutive calls to LM_AllocBlock(${smax},${tmax}) failed`);
    }
  }

  surf.light_s = allocation.x;
  surf.light_t = allocation.y;
  surf.lightmaptexturenum = runtime.gl_lms.current_lightmap_texture;

  const byteOffset = (surf.light_t * BLOCK_WIDTH + surf.light_s) * LIGHTMAP_BYTES;
  const base = runtime.gl_lms.lightmap_buffer.subarray(byteOffset);

  runtime.hooks.setCacheState?.(surf);
  runtime.hooks.buildLightMap?.(surf, base, BLOCK_WIDTH * LIGHTMAP_BYTES);
}

/**
 * Original name: GL_BeginBuildingLightmaps
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Resets the atlas allocator and prepares one new lightmap build pass.
 *
 * Porting notes:
 * - The original GL texture initialization remains deferred until the backend upload path is ported.
 */
export function GL_BeginBuildingLightmaps(runtime: GlRsurfRuntime, _model: model_t): void {
  runtime.r_framecount = 1;
  runtime.gl_lms.current_lightmap_texture = 1;
  runtime.gl_lms.lightmap_surfaces.fill(null);
  runtime.gl_lms.lightmap_buffer.fill(0);
  runtime.lightstyles = Array.from({ length: MAX_LIGHTSTYLES }, () => ({ white: 3 }));
  runtime.gl_lms.internal_format = resolveLightmapInternalFormat(runtime.monolightmapMode);
  LM_InitBlock(runtime);
  runtime.hooks.beginLightmapBuild?.();
  runtime.hooks.initializeDynamicLightmap?.(
    0,
    BLOCK_WIDTH,
    BLOCK_HEIGHT,
    runtime.gl_lms.internal_format,
    runtime.gl_lms.lightmap_buffer
  );
}

/**
 * Original name: GL_EndBuildingLightmaps
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Flushes the final static lightmap atlas block.
 */
export function GL_EndBuildingLightmaps(runtime: GlRsurfRuntime): void {
  LM_UploadBlock(runtime, false);
  runtime.hooks.endLightmapBuild?.();
}

/**
 * Original name: GL_RenderLightmappedPoly
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Renders one brush surface with both base texture and lightmap, rebuilding the lightmap upload when needed.
 *
 * Porting notes:
 * - The immediate-mode GL draw is deferred to hooks, but the original dynamic/static lightmap routing is preserved.
 */
export function GL_RenderLightmappedPoly(runtime: GlRsurfRuntime, surf: msurface_t): image_t | null {
  if (!surf.texinfo) {
    throw new Error("GL_RenderLightmappedPoly: surface missing texinfo");
  }

  const image = R_TextureAnimation(runtime, surf.texinfo);
  let lmtex = surf.lightmaptexturenum;
  const dynamicState = evaluateDynamicLightmapState(runtime, surf);

  if (dynamicState.isDynamic) {
    const smax = (surf.extents[0] >> 4) + 1;
    const tmax = (surf.extents[1] >> 4) + 1;
    const temp = new Uint8Array(smax * tmax * LIGHTMAP_BYTES);

    runtime.hooks.buildLightMap?.(surf, temp, smax * LIGHTMAP_BYTES);

    if (dynamicState.canUseSurfaceLightmapTexture) {
      runtime.hooks.setCacheState?.(surf);
      lmtex = surf.lightmaptexturenum;
    } else {
      lmtex = 0;
    }

    runtime.hooks.uploadSurfaceLightmap?.(surf, lmtex, smax, tmax, temp);
  }

  const scroll = (surf.texinfo.flags & SURF_FLOWING) !== 0 ? computeFlowingScroll(runtime.currentTime) : 0;
  runtime.hooks.renderLightmappedPolyChain?.(surf, image, lmtex, scroll);
  return image;
}

/**
 * Original name: DrawGLWaterPoly
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits a warped water polygon through the renderer backend.
 *
 * Porting notes:
 * - `gl_warp.c` owns the vertex warp update; this routine keeps the original surface dispatch point.
 */
export function DrawGLWaterPoly(runtime: GlRsurfRuntime, surface: msurface_t, image: image_t | null = null): image_t | null {
  runtime.hooks.renderWaterPoly?.(surface, image);
  return image;
}

/**
 * Original name: DrawGLWaterPolyLightmap
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 * Fidelity level: Adapter
 *
 * Behavior:
 * - Dispatches the lightmap coordinate pass for a water polygon.
 *
 * Porting notes:
 * - The stock Quake II GL path keeps this helper behind a disabled compile-time block; the TS adapter exposes
 *   it for parity and routes it through the same lightmap-chain hook used by `DrawGLPolyChain`.
 */
export function DrawGLWaterPolyLightmap(
  runtime: GlRsurfRuntime,
  surface: msurface_t,
  lightmapTextureIndex: number = surface.lightmaptexturenum
): void {
  DrawGLPolyChain(runtime, surface, lightmapTextureIndex, 0, 0);
}

/**
 * Original name: DrawGLPoly
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits one non-flowing brush polygon with base texture coordinates.
 *
 * Porting notes:
 * - Immediate-mode vertex emission is represented by a surface-level hook because polygon buffers live in
 *   `gl-world-scene-adapter`.
 */
export function DrawGLPoly(runtime: GlRsurfRuntime, surface: msurface_t, image: image_t | null = null): image_t | null {
  runtime.hooks.renderBrushPoly?.(surface, image);
  return image;
}

/**
 * Original name: DrawGLFlowingPoly
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits one brush polygon with the original scrolling texture offset.
 */
export function DrawGLFlowingPoly(runtime: GlRsurfRuntime, surface: msurface_t, image: image_t | null = null): image_t | null {
  runtime.hooks.renderFlowingPoly?.(surface, image, computeFlowingScroll(runtime.currentTime));
  return image;
}

/**
 * Original name: R_RenderBrushPoly
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Renders or queues one brush surface according to its material/lightmap path.
 *
 * Porting notes:
 * - Dynamic lightmap regeneration stays deferred; this tranche preserves the static routing and chain wiring.
 */
export function R_RenderBrushPoly(runtime: GlRsurfRuntime, fa: msurface_t): image_t | null {
  if (!fa.texinfo) {
    throw new Error("R_RenderBrushPoly: surface missing texinfo");
  }

  const image = R_TextureAnimation(runtime, fa.texinfo);

  if ((fa.flags & SURF_DRAWTURB) !== 0) {
    DrawGLWaterPoly(runtime, fa, image);
    return image;
  }

  if ((fa.texinfo.flags & SURF_FLOWING) !== 0) {
    DrawGLFlowingPoly(runtime, fa, image);
  } else {
    DrawGLPoly(runtime, fa, image);
  }

  const dynamicState = evaluateDynamicLightmapState(runtime, fa);
  if (dynamicState.isDynamic) {
    if (dynamicState.canUseSurfaceLightmapTexture) {
      const smax = (fa.extents[0] >> 4) + 1;
      const tmax = (fa.extents[1] >> 4) + 1;
      const temp = new Uint8Array(smax * tmax * LIGHTMAP_BYTES);
      runtime.hooks.buildLightMap?.(fa, temp, smax * LIGHTMAP_BYTES);
      runtime.hooks.setCacheState?.(fa);
      runtime.hooks.uploadSurfaceLightmap?.(fa, fa.lightmaptexturenum, smax, tmax, temp);
      queueSurfaceLightmap(runtime, fa, fa.lightmaptexturenum);
    } else {
      queueSurfaceLightmap(runtime, fa, 0);
    }
  } else {
    queueSurfaceLightmap(runtime, fa, fa.lightmaptexturenum);
  }
  return image;
}

/**
 * Original name: R_DrawAlphaSurfaces
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Walks the queued translucent surface chain back-to-front and dispatches them through hooks.
 */
export function R_DrawAlphaSurfaces(runtime: GlRsurfRuntime): void {
  if (!runtime.r_alpha_surfaces) {
    return;
  }

  runtime.hooks.beginAlphaSurfaces?.();
  for (let surface: msurface_t | null = runtime.r_alpha_surfaces; surface; surface = surface.texturechain) {
    const image = surface.texinfo ? R_TextureAnimation(runtime, surface.texinfo) : null;
    runtime.hooks.renderAlphaSurface?.(surface, image, resolveSurfaceAlpha(surface));
  }

  runtime.hooks.endAlphaSurfaces?.();
  runtime.hooks.resetDrawColor?.();
  runtime.r_alpha_surfaces = null;
}

/**
 * Original name: R_DrawTriangleOutlines
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Walks queued lightmap surfaces and emits triangle-outline callbacks for debug visualization.
 */
export function R_DrawTriangleOutlines(runtime: GlRsurfRuntime): void {
  if (!runtime.showTriangleOutlines) {
    return;
  }

  for (let textureIndex = 0; textureIndex < MAX_LIGHTMAPS; textureIndex += 1) {
    for (let surface = runtime.gl_lms.lightmap_surfaces[textureIndex]; surface; surface = surface.lightmapchain) {
      for (let poly = surface.polys; poly; poly = poly.chain) {
        for (let vertexIndex = 2; vertexIndex < poly.numverts; vertexIndex += 1) {
          runtime.hooks.renderTriangleOutline?.(surface, poly, 0, vertexIndex - 1, vertexIndex);
        }
      }
    }
  }
}

/**
 * Original name: DrawGLPolyChain
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Dispatches one lightmap-only surface chain with optional dynamic atlas offsets.
 *
 * Porting notes:
 * - The original immediate-mode polygon emission becomes one surface-level hook call because
 *   the Three.js bridge already owns the polygon buffers.
 */
export function DrawGLPolyChain(
  runtime: GlRsurfRuntime,
  surface: msurface_t,
  lightmapTextureIndex: number,
  sOffset: number,
  tOffset: number
): void {
  if (!surface.polys) {
    return;
  }

  runtime.hooks.renderLightmapChainSurface?.(surface, lightmapTextureIndex, sOffset, tOffset);
}

/**
 * Original name: R_BlendLightmaps
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Flushes the queued static and dynamic lightmap surface chains in the original order.
 *
 * Porting notes:
 * - GL blend state is left behind the backend hook; this port focuses on queue walking,
 *   atlas updates and chain dispatch.
 */
export function R_BlendLightmaps(runtime: GlRsurfRuntime): void {
  if (runtime.fullbrightEnabled) {
    return;
  }

  const worldmodel = runtime.r_worldmodel;
  if (!worldmodel?.lightdata) {
    return;
  }

  if (runtime.currentmodel === worldmodel) {
    runtime.c_visible_lightmaps = 0;
  }

  for (let textureIndex = 1; textureIndex < MAX_LIGHTMAPS; textureIndex += 1) {
    const chain = runtime.gl_lms.lightmap_surfaces[textureIndex];
    if (!chain) {
      continue;
    }

    if (runtime.currentmodel === worldmodel) {
      runtime.c_visible_lightmaps += 1;
    }
    for (let surface: msurface_t | null = chain; surface; surface = surface.lightmapchain) {
      DrawGLPolyChain(runtime, surface, textureIndex, 0, 0);
    }
  }

  if (runtime.gl_dynamic) {
    LM_InitBlock(runtime);

    if (runtime.currentmodel === worldmodel && runtime.gl_lms.lightmap_surfaces[0]) {
      runtime.c_visible_lightmaps += 1;
    }

    let newdrawsurf = runtime.gl_lms.lightmap_surfaces[0];

    for (let surface = runtime.gl_lms.lightmap_surfaces[0]; surface; surface = surface.lightmapchain) {
      const smax = (surface.extents[0] >> 4) + 1;
      const tmax = (surface.extents[1] >> 4) + 1;

      let allocation = LM_AllocBlock(runtime, smax, tmax);
      if (!allocation) {
        LM_UploadBlock(runtime, true);

        for (let drawsurf: msurface_t | null = newdrawsurf; drawsurf && drawsurf !== surface; drawsurf = drawsurf.lightmapchain) {
          if (!drawsurf.polys) {
            continue;
          }

          DrawGLPolyChain(
            runtime,
            drawsurf,
            0,
            (drawsurf.light_s - drawsurf.dlight_s) * (1.0 / 128.0),
            (drawsurf.light_t - drawsurf.dlight_t) * (1.0 / 128.0)
          );
        }

        newdrawsurf = surface;
        LM_InitBlock(runtime);
        allocation = LM_AllocBlock(runtime, smax, tmax);
        if (!allocation) {
          throw new Error(`Consecutive calls to LM_AllocBlock(${smax},${tmax}) failed (dynamic)`);
        }
      }

      surface.dlight_s = allocation.x;
      surface.dlight_t = allocation.y;

      const baseOffset = (surface.dlight_t * BLOCK_WIDTH + surface.dlight_s) * LIGHTMAP_BYTES;
      const base = runtime.gl_lms.lightmap_buffer.subarray(baseOffset);
      runtime.hooks.buildLightMap?.(surface, base, BLOCK_WIDTH * LIGHTMAP_BYTES);
    }

    if (newdrawsurf) {
      LM_UploadBlock(runtime, true);
    }

    for (let surface: msurface_t | null = newdrawsurf; surface; surface = surface.lightmapchain) {
      if (!surface.polys) {
        continue;
      }

      DrawGLPolyChain(
        runtime,
        surface,
        0,
        (surface.light_s - surface.dlight_s) * (1.0 / 128.0),
        (surface.light_t - surface.dlight_t) * (1.0 / 128.0)
      );
    }
  }

  runtime.hooks.blendLightmaps?.();
}

/**
 * Original name: R_DrawInlineBModel
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Draws the currently bound inline brush model using the same surface routing as the original renderer.
 *
 * Porting notes:
 * - Dynamic-light marking and GL state changes remain deferred until the surrounding renderer path is ported.
 */
export function R_DrawInlineBModel(runtime: GlRsurfRuntime): void {
  const currentmodel = runtime.currentmodel;
  const currententity = runtime.currententity;
  if (!currentmodel || !currententity) {
    throw new Error("R_DrawInlineBModel: current model/entity not bound");
  }

  if (!runtime.flashblendEnabled) {
    runtime.hooks.markBrushModelLights?.(currentmodel);
  }

  const firstSurface = currentmodel.firstmodelsurface;
  const lastSurface = firstSurface + currentmodel.nummodelsurfaces;
  const translucentEntity = (currententity.flags ?? 0) & RF_TRANSLUCENT;
  runtime.currentEntityAlpha = translucentEntity ? 0.25 : null;

  for (let index = firstSurface; index < lastSurface && index < currentmodel.surfaces.length; index += 1) {
    const surface = currentmodel.surfaces[index];
    const plane = surface.plane;
    if (!plane || !surface.texinfo) {
      continue;
    }

    const dot = DotProduct(runtime.modelorg, plane.normal) - plane.dist;
    const facing =
      (((surface.flags & SURF_PLANEBACK) !== 0) && (dot < -BACKFACE_EPSILON))
      || (((surface.flags & SURF_PLANEBACK) === 0) && (dot > BACKFACE_EPSILON));
    if (!facing) {
      continue;
    }

    if ((surface.texinfo.flags & (SURF_TRANS33 | SURF_TRANS66)) !== 0) {
      queueAlphaSurface(runtime, surface);
      continue;
    }

    if (runtime.multitextureEnabled && (surface.flags & SURF_DRAWTURB) === 0) {
      GL_RenderLightmappedPoly(runtime, surface);
    } else {
      if (runtime.multitextureEnabled) {
        runtime.hooks.suspendMultitexture?.();
      }
      R_RenderBrushPoly(runtime, surface);
      if (runtime.multitextureEnabled) {
        runtime.hooks.resumeMultitexture?.();
      }
    }
  }

  if (!translucentEntity && !runtime.multitextureEnabled) {
    R_BlendLightmaps(runtime);
  }

  runtime.currentEntityAlpha = null;
}

/**
 * Original name: R_DrawBrushModel
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Prepares one brush entity draw, computes the entity-local view vector and dispatches inline surface rendering.
 *
 * Porting notes:
 * - Matrix stack, GL texenv setup and lighting side-effects remain behind hooks until the backend path is ported.
 */
export function R_DrawBrushModel(runtime: GlRsurfRuntime, entity: GlRsurfEntityRef): void {
  const currentmodel = runtime.currentmodel;
  if (!currentmodel) {
    throw new Error("R_DrawBrushModel: currentmodel is null");
  }

  if (currentmodel.nummodelsurfaces === 0) {
    return;
  }

  runtime.currententity = entity;
  runtime.hooks.resetTextureBindings?.();
  runtime.hooks.resetDrawColor?.();

  const entityOrigin = entity.origin ?? [0, 0, 0];
  const entityAngles = entity.angles ?? [0, 0, 0];
  const rotated = entityAngles[0] !== 0 || entityAngles[1] !== 0 || entityAngles[2] !== 0;

  const mins: vec3_t = [0, 0, 0];
  const maxs: vec3_t = [0, 0, 0];
  if (rotated) {
    for (let index = 0; index < 3; index += 1) {
      mins[index] = entityOrigin[index] - currentmodel.radius;
      maxs[index] = entityOrigin[index] + currentmodel.radius;
    }
  } else {
    VectorAdd(entityOrigin, currentmodel.mins, mins);
    VectorAdd(entityOrigin, currentmodel.maxs, maxs);
  }

  if (runtime.hooks.cullBox?.(mins, maxs) ?? false) {
    return;
  }

  runtime.gl_lms.lightmap_surfaces.fill(null);
  VectorSubtract(runtime.vieworg, entityOrigin, runtime.modelorg);

  if (rotated) {
    const temp: vec3_t = [...runtime.modelorg];
    const { forward, right, up } = AngleVectors(entityAngles);
    runtime.modelorg[0] = DotProduct(temp, forward);
    runtime.modelorg[1] = -DotProduct(temp, right);
    runtime.modelorg[2] = DotProduct(temp, up);
  }

  runtime.hooks.beginBrushModelDraw?.(entity, currentmodel, rotated);
  if (runtime.multitextureEnabled) {
    runtime.hooks.beginBrushModelMultitexture?.();
    R_DrawInlineBModel(runtime);
    runtime.hooks.endBrushModelMultitexture?.();
  } else {
    R_DrawInlineBModel(runtime);
  }
  runtime.hooks.endBrushModelDraw?.(entity, currentmodel);
}

/**
 * Original name: DrawTextureChains
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Walks all registered texture chains and renders brush polys in the original two-pass order.
 *
 * Porting notes:
 * - The multitexture branch dispatches to `renderLightmappedPoly` when available, otherwise it falls back to `R_RenderBrushPoly`.
 */
export function DrawTextureChains(runtime: GlRsurfRuntime, images: image_t[]): void {
  runtime.c_visible_textures = 0;

  if (!runtime.multitextureEnabled) {
    for (const image of images) {
      if (!getImageRegistrationSequence(image)) {
        continue;
      }

      const chain = getImageTextureChain(image);
      if (!chain) {
        continue;
      }

      runtime.c_visible_textures += 1;
      for (let surface: msurface_t | null = chain; surface; surface = surface.texturechain) {
        R_RenderBrushPoly(runtime, surface);
      }

      setImageTextureChain(image, null);
    }

    return;
  }

  for (const image of images) {
    if (!getImageRegistrationSequence(image)) {
      continue;
    }

    const chain = getImageTextureChain(image);
    if (!chain) {
      continue;
    }

    runtime.c_visible_textures += 1;
    for (let surface: msurface_t | null = chain; surface; surface = surface.texturechain) {
      if ((surface.flags & SURF_DRAWTURB) === 0) {
        if (runtime.hooks.renderLightmappedPolyChain && surface.texinfo) {
          GL_RenderLightmappedPoly(runtime, surface);
          queueSurfaceLightmap(runtime, surface, surface.lightmaptexturenum);
        } else {
          R_RenderBrushPoly(runtime, surface);
        }
      }
    }
  }

  runtime.hooks.suspendMultitexture?.();
  for (const image of images) {
    if (!getImageRegistrationSequence(image)) {
      continue;
    }

    const chain = getImageTextureChain(image);
    if (!chain) {
      continue;
    }

    for (let surface: msurface_t | null = chain; surface; surface = surface.texturechain) {
      if ((surface.flags & SURF_DRAWTURB) !== 0) {
        R_RenderBrushPoly(runtime, surface);
      }
    }

    setImageTextureChain(image, null);
  }
  runtime.hooks.resumeMultitexture?.();
}

/**
 * Original name: R_RecursiveWorldNode
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Traverses the visible BSP tree front-to-back and routes visible surfaces into the proper renderer chains.
 */
export function R_RecursiveWorldNode(runtime: GlRsurfRuntime, node: mnode_child_t | null): void {
  if (!node) {
    return;
  }

  if (node.contents === CONTENTS_SOLID) {
    return;
  }

  if (node.visframe !== runtime.r_visframecount) {
    return;
  }

  if (runtime.hooks.cullBox?.(node.minmaxs.slice(0, 3), node.minmaxs.slice(3, 6)) ?? false) {
    return;
  }

  if (!isMNode(node)) {
    const leaf = node;

    if (runtime.areabits) {
      if ((runtime.areabits[leaf.area >> 3] & (1 << (leaf.area & 7))) === 0) {
        return;
      }
    }

    for (const markedSurface of leaf.firstmarksurface) {
      markedSurface.visframe = runtime.r_framecount;
    }

    return;
  }

  const plane = node.plane;
  if (!plane) {
    throw new Error("R_RecursiveWorldNode: node missing plane");
  }

  let dot: number;
  switch (plane.type) {
    case PLANE_X:
      dot = runtime.modelorg[0] - plane.dist;
      break;
    case PLANE_Y:
      dot = runtime.modelorg[1] - plane.dist;
      break;
    case PLANE_Z:
      dot = runtime.modelorg[2] - plane.dist;
      break;
    default:
      dot = DotProduct(runtime.modelorg, plane.normal) - plane.dist;
      break;
  }

  const side = dot >= 0 ? 0 : 1;
  const sidebit = dot >= 0 ? 0 : SURF_PLANEBACK;

  R_RecursiveWorldNode(runtime, node.children[side]);

  const worldmodel = runtime.r_worldmodel;
  if (!worldmodel) {
    throw new Error("R_RecursiveWorldNode: r_worldmodel is null");
  }

  for (let index = 0; index < node.numsurfaces; index += 1) {
    const surface = worldmodel.surfaces[node.firstsurface + index];
    if (!surface || !surface.texinfo) {
      continue;
    }

    if (surface.visframe !== runtime.r_framecount) {
      continue;
    }

    if ((surface.flags & SURF_PLANEBACK) !== sidebit) {
      continue;
    }

    if ((surface.texinfo.flags & SURF_SKY) !== 0) {
      runtime.hooks.addSkySurface?.(surface);
    } else if ((surface.texinfo.flags & (SURF_TRANS33 | SURF_TRANS66)) !== 0) {
      queueAlphaSurface(runtime, surface);
    } else {
      if (runtime.multitextureEnabled && (surface.flags & SURF_DRAWTURB) === 0) {
        GL_RenderLightmappedPoly(runtime, surface);
      } else {
        chainSurfaceByImage(R_TextureAnimation(runtime, surface.texinfo), surface);
      }
    }
  }

  R_RecursiveWorldNode(runtime, node.children[side === 0 ? 1 : 0]);
}

/**
 * Original name: R_DrawWorld
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Prepares the world-model draw state, traverses the BSP and flushes texture/lightmap chains.
 */
export function R_DrawWorld(runtime: GlRsurfRuntime, images: image_t[]): void {
  const worldmodel = runtime.r_worldmodel;
  if (!runtime.r_drawworld || !worldmodel) {
    return;
  }

  if ((runtime.rdflags & RDF_NOWORLDMODEL) !== 0) {
    return;
  }

  runtime.currentmodel = worldmodel;
  runtime.modelorg = [...runtime.vieworg];

  runtime.currententity = {
    frame: Math.trunc(runtime.currentTime * 2)
  };

  runtime.hooks.resetTextureBindings?.();
  runtime.hooks.resetDrawColor?.();
  runtime.gl_lms.lightmap_surfaces.fill(null);
  runtime.r_alpha_surfaces = null;
  runtime.hooks.clearSkyBox?.();

  if (runtime.multitextureEnabled) {
    runtime.hooks.beginWorldMultitexture?.(runtime.lightmapOnly);
    R_RecursiveWorldNode(runtime, worldmodel.nodes[0] ?? null);
    runtime.hooks.endWorldMultitexture?.();
  } else {
    R_RecursiveWorldNode(runtime, worldmodel.nodes[0] ?? null);
  }

  DrawTextureChains(runtime, images);
  R_BlendLightmaps(runtime);
  runtime.hooks.drawSkyBox?.();
  R_DrawTriangleOutlines(runtime);
}

/**
 * Original name: R_MarkLeaves
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Marks visible BSP leaves and their parent nodes according to the current cluster PVS.
 */
export function R_MarkLeaves(runtime: GlRsurfRuntime): void {
  const worldmodel = runtime.r_worldmodel;
  if (!worldmodel) {
    throw new Error("R_MarkLeaves: r_worldmodel is null");
  }

  if (
    runtime.r_oldviewcluster === runtime.r_viewcluster &&
    runtime.r_oldviewcluster2 === runtime.r_viewcluster2 &&
    !runtime.r_novis &&
    runtime.r_viewcluster !== -1
  ) {
    return;
  }

  if (runtime.gl_lockpvs) {
    return;
  }

  runtime.r_visframecount += 1;
  runtime.r_oldviewcluster = runtime.r_viewcluster;
  runtime.r_oldviewcluster2 = runtime.r_viewcluster2;

  if (runtime.r_novis || runtime.r_viewcluster === -1 || !worldmodel.vis) {
    for (const leaf of worldmodel.leafs) {
      leaf.visframe = runtime.r_visframecount;
    }
    for (const node of worldmodel.nodes) {
      node.visframe = runtime.r_visframecount;
    }
    return;
  }

  let vis = Mod_ClusterPVS({ mod_novis: new Uint8Array(0) } as never, runtime.r_viewcluster, worldmodel);
  let fatvis: Uint8Array | null = null;

  if (runtime.r_viewcluster2 !== runtime.r_viewcluster) {
    fatvis = new Uint8Array((worldmodel.numleafs + 7) >> 3);
    fatvis.set(vis.subarray(0, fatvis.length));
    const vis2 = Mod_ClusterPVS({ mod_novis: new Uint8Array(0) } as never, runtime.r_viewcluster2, worldmodel);
    for (let index = 0; index < fatvis.length && index < vis2.length; index += 1) {
      fatvis[index] |= vis2[index];
    }
    vis = fatvis;
  }

  for (const leaf of worldmodel.leafs) {
    const cluster = leaf.cluster;
    if (cluster === -1) {
      continue;
    }

    if ((vis[cluster >> 3] & (1 << (cluster & 7))) !== 0) {
      let node: mnode_t | null = leaf.parent;
      leaf.visframe = runtime.r_visframecount;
      while (node) {
        if (node.visframe === runtime.r_visframecount) {
          break;
        }
        node.visframe = runtime.r_visframecount;
        node = node.parent;
      }
    }
  }
}

/**
 * Original name: GL_BuildPolygonFromSurface
 * Source: ref_gl/gl_rsurf.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Reconstructs one brush surface polygon and computes both base-texture and lightmap UVs.
 */
export function GL_BuildPolygonFromSurface(runtime: GlRsurfRuntime, fa: msurface_t): glpoly_t {
  const currentmodel = runtime.currentmodel;
  if (!currentmodel) {
    throw new Error("GL_BuildPolygonFromSurface: currentmodel is null");
  }
  if (!fa.texinfo) {
    throw new Error("GL_BuildPolygonFromSurface: surface missing texinfo");
  }

  const imageSize = getImageSize(fa.texinfo.image);
  const lnumverts = fa.numedges;
  const poly = createGlPoly();
  poly.next = fa.polys;
  poly.flags = fa.flags;
  poly.numverts = lnumverts;

  for (let index = 0; index < lnumverts; index += 1) {
    const lindex = currentmodel.surfedges[fa.firstedge + index];
    if (lindex === undefined) {
      throw new Error("GL_BuildPolygonFromSurface: bad surfedge");
    }

    const edge = currentmodel.edges[Math.abs(lindex)];
    if (!edge) {
      throw new Error("GL_BuildPolygonFromSurface: missing edge");
    }

    const vertexIndex = lindex > 0 ? edge.v[0] : edge.v[1];
    const vertex = currentmodel.vertexes[vertexIndex];
    if (!vertex) {
      throw new Error("GL_BuildPolygonFromSurface: missing vertex");
    }

    const vec = vertex.position;
    let s = dotTexAxis(vec, fa.texinfo.vecs[0]);
    s /= imageSize.width;

    let t = dotTexAxis(vec, fa.texinfo.vecs[1]);
    t /= imageSize.height;

    const glVertex: [number, number, number, number, number, number, number] = [vec[0], vec[1], vec[2], s, t, 0, 0];

    s = dotTexAxis(vec, fa.texinfo.vecs[0]);
    s -= fa.texturemins[0];
    s += fa.light_s * 16;
    s += 8;
    s /= BLOCK_WIDTH * 16;

    t = dotTexAxis(vec, fa.texinfo.vecs[1]);
    t -= fa.texturemins[1];
    t += fa.light_t * 16;
    t += 8;
    t /= BLOCK_HEIGHT * 16;

    glVertex[5] = s;
    glVertex[6] = t;
    poly.verts.push(glVertex);
  }

  if (poly.verts.some((vertex) => vertex.length !== VERTEXSIZE)) {
    throw new Error("GL_BuildPolygonFromSurface: invalid polygon vertex payload");
  }

  fa.polys = poly;
  return poly;
}

/**
 * Original name: N/A
 * Source: N/A (renderer-three state setter)
 * Category: New
 * Purpose: Bind the current brush model used by `gl_rsurf.c`-style surface builders.
 */
export function setCurrentModel(runtime: GlRsurfRuntime, model: model_t | null): void {
  runtime.currentmodel = model;
}

/**
 * Original name: N/A
 * Source: N/A (renderer-three state setter)
 * Category: New
 * Purpose: Bind the world brush model consumed by the world-traversal half of `gl_rsurf.c`.
 */
export function setWorldModel(runtime: GlRsurfRuntime, model: model_t | null): void {
  runtime.r_worldmodel = model;
}

/**
 * Original name: N/A
 * Source: N/A (renderer-three state setter)
 * Category: New
 * Purpose: Bind the current entity used by animated texture selection.
 */
export function setCurrentEntity(runtime: GlRsurfRuntime, entity: GlRsurfEntityRef | null): void {
  runtime.currententity = entity;
}

/**
 * Original name: N/A
 * Source: N/A (renderer-three state setter)
 * Category: New
 * Purpose: Bind the current frame counter used by dynamic light bookkeeping.
 */
export function setFrameCount(runtime: GlRsurfRuntime, frameCount: number): void {
  runtime.r_framecount = frameCount;
}

/**
 * Original name: N/A
 * Source: N/A (renderer-three state setter)
 * Category: New
 * Purpose: Bind the current renderer lightstyles consumed by lightmap cache validation.
 */
export function setLightstyles(runtime: GlRsurfRuntime, lightstyles: GlRsurfLightstyle[]): void {
  runtime.lightstyles = lightstyles;
}

/**
 * Original name: N/A
 * Source: N/A (renderer-three state setter)
 * Category: New
 * Purpose: Toggle the original `gl_dynamic` path for dynamic lightmap rebuilds.
 */
export function setDynamicLightmapsEnabled(runtime: GlRsurfRuntime, enabled: boolean): void {
  runtime.gl_dynamic = enabled;
}

/**
 * Original name: N/A
 * Source: N/A (renderer-three state setter)
 * Category: New
 * Purpose: Bind the current refdef time used by flowing-surface UV offsets.
 */
export function setCurrentTime(runtime: GlRsurfRuntime, timeSeconds: number): void {
  runtime.currentTime = timeSeconds;
}

/**
 * Original name: N/A
 * Source: N/A (renderer-three state setter)
 * Category: New
 * Purpose: Bind the current world-view origin used by BSP side tests.
 */
export function setViewOrigin(runtime: GlRsurfRuntime, vieworg: vec3_t): void {
  runtime.vieworg = [...vieworg];
}

/**
 * Original name: N/A
 * Source: N/A (renderer-three state setter)
 * Category: New
 * Purpose: Bind the current visible clusters used by PVS marking.
 */
export function setViewClusters(runtime: GlRsurfRuntime, cluster: number, cluster2: number): void {
  runtime.r_viewcluster = cluster;
  runtime.r_viewcluster2 = cluster2;
}

/**
 * Original name: N/A
 * Source: N/A (renderer-three state setter)
 * Category: New
 * Purpose: Bind the current area bits and renderer flags coming from the refdef.
 */
export function setRefdefState(runtime: GlRsurfRuntime, areabits: Uint8Array | null, rdflags: number): void {
  runtime.areabits = areabits;
  runtime.rdflags = rdflags;
}

/**
 * Original name: N/A
 * Source: N/A (renderer-three state setter)
 * Category: New
 * Purpose: Toggle the original `r_novis`, `gl_lockpvs` and `r_drawworld` control flags.
 */
export function setWorldDrawFlags(runtime: GlRsurfRuntime, options: { novis?: boolean; lockpvs?: boolean; drawworld?: boolean }): void {
  if (typeof options.novis === "boolean") {
    runtime.r_novis = options.novis;
  }
  if (typeof options.lockpvs === "boolean") {
    runtime.gl_lockpvs = options.lockpvs;
  }
  if (typeof options.drawworld === "boolean") {
    runtime.r_drawworld = options.drawworld;
  }
}

/**
 * Original name: N/A
 * Source: N/A (renderer-three state setter)
 * Category: New
 * Purpose: Control whether `DrawTextureChains` uses the original multitexture split path.
 */
export function setMultitextureEnabled(runtime: GlRsurfRuntime, enabled: boolean): void {
  runtime.multitextureEnabled = enabled;
}

/**
 * Original name: N/A
 * Source: N/A (renderer-three rmain bridge)
 * Category: New
 * Purpose: Mirror the multitexture availability resolved during `R_Init` into the `gl_rsurf.c` runtime.
 *
 * Constraints:
 * - Must only enable the multitexture split path when both SGIS procedures were resolved and the cvar allows it.
 */
export function syncRsurfMultitextureFromRmain(
  runtime: GlRsurfRuntime,
  rmain: Pick<GlRmainRuntime, "gl_ext_multitexture" | "qglMTexCoord2fSGIS" | "qglSelectTextureSGIS">
): void {
  runtime.multitextureEnabled = Boolean(
    rmain.gl_ext_multitexture?.value
    && rmain.qglMTexCoord2fSGIS
    && rmain.qglSelectTextureSGIS
  );
}

/**
 * Original name: N/A
 * Source: N/A (renderer-three state setter)
 * Category: New
 * Purpose: Toggle the original `gl_showtris` debug visualization path.
 */
export function setShowTriangleOutlines(runtime: GlRsurfRuntime, enabled: boolean): void {
  runtime.showTriangleOutlines = enabled;
}

/**
 * Original name: N/A
 * Source: N/A (renderer-three state setter)
 * Category: New
 * Purpose: Toggle the original `gl_lightmap` debug path that prefers lightmap-only world modulation.
 */
export function setLightmapOnly(runtime: GlRsurfRuntime, enabled: boolean): void {
  runtime.lightmapOnly = enabled;
}

/**
 * Original name: N/A
 * Source: N/A (renderer-three state setter)
 * Category: New
 * Purpose: Toggle the original `r_fullbright` short-circuit for the lightmap blend pass.
 */
export function setFullbrightEnabled(runtime: GlRsurfRuntime, enabled: boolean): void {
  runtime.fullbrightEnabled = enabled;
}

/**
 * Original name: N/A
 * Source: N/A (renderer-three state setter)
 * Category: New
 * Purpose: Toggle the original `gl_flashblend` path that bypasses brush-model light marking.
 */
export function setFlashblendEnabled(runtime: GlRsurfRuntime, enabled: boolean): void {
  runtime.flashblendEnabled = enabled;
}

/**
 * Original name: N/A
 * Source: N/A (renderer-three state setter)
 * Category: New
 * Purpose: Preserve the original `gl_monolightmap` switch consumed while initializing lightmap storage.
 */
export function setMonolightmapMode(runtime: GlRsurfRuntime, mode: string): void {
  runtime.monolightmapMode = mode;
}

/**
 * Original name: N/A
 * Source: N/A (texture chain helper)
 * Category: New
 * Purpose: Queue one surface on the owning texture image chain following the original front-to-back linking convention.
 */
export function chainSurfaceByImage(image: image_t | null, surface: msurface_t): void {
  if (!image || typeof image !== "object") {
    return;
  }

  surface.texturechain = getImageTextureChain(image);
  setImageTextureChain(image, surface);
}

/**
 * Original name: N/A
 * Source: N/A (alpha surface queue helper)
 * Category: New
 * Purpose: Queue one translucent surface onto the alpha list consumed by `R_DrawAlphaSurfaces`.
 */
export function queueAlphaSurface(runtime: GlRsurfRuntime, surface: msurface_t): void {
  surface.texturechain = runtime.r_alpha_surfaces;
  runtime.r_alpha_surfaces = surface;
}

/**
 * Original name: N/A
 * Source: N/A (texture chain helper)
 * Category: New
 * Purpose: Clear all texture chain heads on one image table.
 */
export function clearImageTextureChains(images: image_t[]): void {
  for (const image of images) {
    setImageTextureChain(image, null);
  }
}

/**
 * Original name: N/A
 * Source: N/A (model loader bridge)
 * Category: New
 * Purpose: Expose hook functions compatible with the earlier `gl_model.c` loading pipeline.
 */
export function createGlRsurfModelHooks(runtime: GlRsurfRuntime) {
  return {
    beginBuildingLightmaps: (model: model_t) => {
      setCurrentModel(runtime, model);
      GL_BeginBuildingLightmaps(runtime, model);
    },
    endBuildingLightmaps: () => GL_EndBuildingLightmaps(runtime),
    createSurfaceLightmap: (surface: msurface_t) => GL_CreateSurfaceLightmap(runtime, surface),
    buildPolygonFromSurface: (surface: msurface_t) => GL_BuildPolygonFromSurface(runtime, surface),
    subdivideSurface: (surface: msurface_t) => GL_BuildPolygonFromSurface(runtime, surface)
  };
}

/**
 * Original name: N/A
 * Source: N/A (texture dimension helper)
 * Category: New
 * Purpose: Resolve image dimensions across the renderer-three texture adapters before building surface UVs.
 */
function getImageSize(image: image_t | null): { width: number; height: number } {
  if (image && typeof image === "object") {
    const width = readNumericProperty(image, "width") ?? readNestedQuakeDimension(image, "width");
    const height = readNumericProperty(image, "height") ?? readNestedQuakeDimension(image, "height");
    if (width && height) {
      return { width, height };
    }
  }

  return { width: 1, height: 1 };
}

/**
 * Original name: N/A
 * Source: N/A (texture dimension helper)
 * Category: New
 * Purpose: Read flat numeric dimensions from image-like adapter objects.
 */
function readNumericProperty(value: object, key: "width" | "height"): number | null {
  const record = value as Record<string, unknown>;
  return typeof record[key] === "number" && Number.isFinite(record[key]) && record[key] > 0
    ? record[key] as number
    : null;
}

/**
 * Original name: N/A
 * Source: N/A (texture dimension helper)
 * Category: New
 * Purpose: Read dimensions stored under the renderer adapter's `userData.quake` payload.
 */
function readNestedQuakeDimension(value: object, key: "width" | "height"): number | null {
  const record = value as Record<string, unknown>;
  const userData = record.userData;
  if (!userData || typeof userData !== "object") {
    return null;
  }

  const quake = (userData as Record<string, unknown>).quake;
  if (!quake || typeof quake !== "object") {
    return null;
  }

  const dimension = (quake as Record<string, unknown>)[key];
  return typeof dimension === "number" && Number.isFinite(dimension) && dimension > 0 ? dimension : null;
}

/**
 * Original name: GL_BuildPolygonFromSurface texture-axis dot expression
 * Source: ref_gl/gl_rsurf.c
 * Category: Adapter
 * Purpose: Share the original `DotProduct(vec, tex->vecs[i]) + tex->vecs[i][3]` calculation between UV paths.
 */
function dotTexAxis(point: vec3_t, axis: [number, number, number, number]): number {
  return DotProduct(point, [axis[0], axis[1], axis[2]]) + axis[3];
}

/**
 * Original name: N/A
 * Source: N/A (BSP node type guard)
 * Category: New
 * Purpose: Narrow BSP child unions while preserving the `contents == -1` node test used by `R_RecursiveWorldNode`.
 */
function isMNode(node: mnode_child_t): node is mnode_t {
  return node.contents === -1;
}

/**
 * Original name: R_RenderBrushPoly/GL_RenderLightmappedPoly lightmapchain assignment
 * Source: ref_gl/gl_rsurf.c
 * Category: Adapter
 * Purpose: Centralize the original surface-to-lightmap chain link update.
 */
function queueSurfaceLightmap(runtime: GlRsurfRuntime, surface: msurface_t, textureIndex: number): void {
  surface.lightmapchain = runtime.gl_lms.lightmap_surfaces[textureIndex];
  runtime.gl_lms.lightmap_surfaces[textureIndex] = surface;
}

/**
 * Original name: R_RenderBrushPoly/GL_RenderLightmappedPoly dynamic-lightmap test
 * Source: ref_gl/gl_rsurf.c
 * Category: Adapter
 * Purpose: Reuse the original style-cache and dlight-frame checks in both TS lightmap rendering paths.
 */
function evaluateDynamicLightmapState(
  runtime: GlRsurfRuntime,
  surf: msurface_t
): { isDynamic: boolean; canUseSurfaceLightmapTexture: boolean } {
  let map = 0;
  for (; map < surf.styles.length && surf.styles[map] !== 255; map += 1) {
    const styleIndex = surf.styles[map];
    const lightstyleWhite = runtime.lightstyles[styleIndex]?.white ?? 0;
    if (lightstyleWhite !== surf.cached_light[map]) {
      break;
    }
  }

  let isDynamic = false;
  if (map < surf.styles.length && runtime.gl_dynamic) {
    const flags = surf.texinfo?.flags ?? 0;
    if ((flags & (SURF_SKY | SURF_TRANS33 | SURF_TRANS66 | SURF_WARP)) === 0) {
      isDynamic = true;
    }
  }

  if (surf.dlightframe === runtime.r_framecount && runtime.gl_dynamic) {
    const flags = surf.texinfo?.flags ?? 0;
    if ((flags & (SURF_SKY | SURF_TRANS33 | SURF_TRANS66 | SURF_WARP)) === 0) {
      isDynamic = true;
    }
  }

  const style = map < surf.styles.length ? surf.styles[map] : 255;
  const canUseSurfaceLightmapTexture = (style >= 32 || style === 0) && surf.dlightframe !== runtime.r_framecount;
  return { isDynamic, canUseSurfaceLightmapTexture };
}

/**
 * Original name: DrawGLFlowingPoly scroll expression
 * Source: ref_gl/gl_rsurf.c
 * Category: Adapter
 * Purpose: Preserve the original flowing-surface texture offset formula for hook-based rendering.
 */
function computeFlowingScroll(timeSeconds: number): number {
  const scroll = -64 * (timeSeconds / 40.0 - Math.trunc(timeSeconds / 40.0));
  return scroll === 0 ? -64 : scroll;
}

/**
 * Original name: GL_BeginBuildingLightmaps gl_monolightmap switch
 * Source: ref_gl/gl_rsurf.c
 * Category: Adapter
 * Purpose: Map the original `gl_monolightmap` mode letters to local lightmap format constants.
 */
function resolveLightmapInternalFormat(mode: string): number {
  switch ((mode[0] ?? "0").toUpperCase()) {
    case "A":
      return GL_LIGHTMAP_FORMAT_ALPHA;
    case "C":
      return GL_LIGHTMAP_FORMAT_ALPHA;
    case "I":
      return GL_LIGHTMAP_FORMAT_INTENSITY8;
    case "L":
      return GL_LIGHTMAP_FORMAT_LUMINANCE8;
    default:
      return GL_LIGHTMAP_FORMAT_SOLID;
  }
}

/**
 * Original name: R_DrawAlphaSurfaces alpha selection
 * Source: ref_gl/gl_rsurf.c
 * Category: Adapter
 * Purpose: Preserve the original `SURF_TRANS33` and `SURF_TRANS66` alpha choices for renderer hooks.
 */
function resolveSurfaceAlpha(surface: msurface_t): number {
  const flags = surface.texinfo?.flags ?? 0;
  if ((flags & SURF_TRANS33) !== 0) {
    return 0.33;
  }
  if ((flags & SURF_TRANS66) !== 0) {
    return 0.66;
  }

  return 1;
}

/**
 * Original name: image_t.registration_sequence access
 * Source: ref_gl/gl_rsurf.c
 * Category: Adapter
 * Purpose: Read the original image registration flag across C-style and TS-style adapter field names.
 */
function getImageRegistrationSequence(image: image_t): number {
  if (!image || typeof image !== "object") {
    return 0;
  }

  const record = image as Record<string, unknown>;
  if (typeof record.registration_sequence === "number") {
    return record.registration_sequence;
  }
  if (typeof record.registrationSequence === "number") {
    return record.registrationSequence;
  }

  return 0;
}

/**
 * Original name: image_t.texturechain access
 * Source: ref_gl/gl_rsurf.c
 * Category: Adapter
 * Purpose: Read the texture chain head stored on image adapters for `DrawTextureChains`.
 */
function getImageTextureChain(image: image_t): msurface_t | null {
  if (!image || typeof image !== "object") {
    return null;
  }

  const record = image as Record<string, unknown>;
  const texturechain = record.texturechain;
  return texturechain && typeof texturechain === "object" ? texturechain as msurface_t : null;
}

/**
 * Original name: image_t.texturechain assignment
 * Source: ref_gl/gl_rsurf.c
 * Category: Adapter
 * Purpose: Write the texture chain head stored on image adapters for world and brush surface queues.
 */
function setImageTextureChain(image: image_t, surface: msurface_t | null): void {
  if (!image || typeof image !== "object") {
    return;
  }

  (image as Record<string, unknown>).texturechain = surface;
}
