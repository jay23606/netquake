/**
 * File: gl_rmain.ts
 * Source: Quake II original / ref_gl/gl_rmain.c
 * Purpose: Port the main GL refresh frame orchestration helpers and shared view-state routines.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Replaces direct GL state mutation with explicit runtime state and hooks.
 * - Leaves renderer-backend submission behind callbacks while preserving the original call order.
 * - Keeps the original disabled stereo-pattern call disabled; the static helpers are ported for traceability.
 * - Exposes the original `r_turbsin *= 0.5` bootstrap mutation through an optional hook because the table itself is immutable in this port.
 *
 * Notes:
 * - This file is the principal attachment point for `ref_gl/gl_rmain.c`.
 * - Backend-specific GL, QGL, GLimp and Draw/Mod/Image side effects are explicit hooks.
 */

import { CONTENTS_SOLID, type dsprite_t } from "../../formats/src/index.js";
import {
  AngleVectors,
  BoxOnPlaneSide,
  CVAR_ARCHIVE,
  CVAR_USERINFO,
  DotProduct,
  ERR_DROP,
  M_PI,
  PerpendicularVector,
  PRINT_ALL,
  RDF_NOWORLDMODEL,
  RF_BEAM,
  RF_FULLBRIGHT,
  RF_TRANSLUCENT,
  RotatePointAroundVector,
  VectorAdd,
  VectorCopy,
  VectorMA,
  VectorNormalize,
  VectorScale,
  type cplane_t,
  type vec3_t
} from "../../qcommon/src/index.js";
import type { cvar_t } from "../../qcommon/src/cvar.js";
import { API_VERSION, type dlight_t, type entity_t, type particle_t, type refdef_t, type refexport_t, type refimport_t } from "../../client/src/ref.js";
import type { image_t, model_t, msurface_t } from "./gl_model.js";
import { modtype_t } from "./gl_model.js";
import { rserr_t, type GlimpSetModeResult } from "./gl_local.js";
import {
  GL_RENDERER_3DLABS,
  GL_RENDERER_DYPIC,
  GL_RENDERER_GLINT_MX,
  GL_RENDERER_INTERGRAPH,
  GL_RENDERER_MCD,
  GL_RENDERER_OTHER,
  GL_RENDERER_PCX2,
  GL_RENDERER_PERMEDIA2,
  GL_RENDERER_POWERVR,
  GL_RENDERER_REALIZM,
  GL_RENDERER_RENDITION,
  GL_RENDERER_SGI,
  GL_RENDERER_VOODOO,
  GL_RENDERER_VOODOO_RUSH,
  REF_VERSION
} from "./gl_local.js";

/**
 * Original name: NUM_BEAM_SEGS
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Strict
 */
const NUM_BEAM_SEGS = 6;

/**
 * Original name: N/A
 * Source: N/A (OpenGL draw-buffer constant shim)
 * Category: New
 * Purpose: Name the OpenGL back-left draw buffer used by the stereo pattern adapter.
 */
export const GL_BACK_LEFT = 0x0402;

/**
 * Original name: N/A
 * Source: N/A (renderer adapter DTO)
 * Category: New
 * Purpose: Describe viewport payloads emitted by the ported GL setup path.
 */
export interface GlRmainViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Original name: N/A
 * Source: N/A (renderer adapter DTO)
 * Category: New
 * Purpose: Describe beam segments emitted by the ported beam draw path.
 */
export interface GlRmainBeamSegment {
  start: vec3_t;
  end: vec3_t;
}

/**
 * Original name: N/A
 * Source: N/A (renderer adapter DTO)
 * Category: New
 * Purpose: Describe sprite vertices emitted by the ported sprite draw path.
 */
export interface GlRmainSpriteVertex {
  position: vec3_t;
  uv: [number, number];
}

/**
 * Original name: N/A
 * Source: N/A (renderer adapter DTO)
 * Category: New
 * Purpose: Describe triangle-particle payloads emitted by the ported particle fallback.
 */
export interface GlRmainParticleTriangle {
  color: [number, number, number, number];
  vertices: Array<{
    position: vec3_t;
    uv: [number, number];
  }>;
}

/**
 * Original name: N/A
 * Source: N/A (renderer adapter DTO)
 * Category: New
 * Purpose: Describe one line in the optional stereo calibration pattern.
 */
export interface GlRmainStereoLine {
  color: [number, number, number];
  start: [number, number];
  end: [number, number];
}

/**
 * Original name: N/A
 * Source: N/A (renderer adapter DTO)
 * Category: New
 * Purpose: Describe the optional stereo calibration pattern retained from `gl_rmain.c`.
 */
export interface GlRmainStereoPattern {
  drawBuffer: typeof GL_BACK_LEFT;
  frames: GlRmainStereoLine[][];
}

/**
 * Original name: N/A
 * Source: N/A (renderer adapter DTO)
 * Category: New
 * Purpose: Describe projection bounds emitted by `MYgluPerspective`.
 */
export interface GlRmainProjection {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  zNear: number;
  zFar: number;
}

/**
 * Original name: N/A
 * Source: N/A (renderer runtime state)
 * Category: New
 * Purpose: Hold mutable GL state formerly stored as renderer globals.
 */
export interface GlRmainGlState {
  camera_separation: number;
  stereo_enabled: boolean;
  current_draw_buffer: "GL_FRONT" | "GL_BACK" | null;
  prev_mode: number;
}

/**
 * Original name: N/A
 * Source: N/A (renderer hook adapter)
 * Category: New
 * Purpose: Expose backend and subsystem effects required by the ported `gl_rmain.c` routines.
 */
export interface GlRmainHooks {
  pointInLeaf?: (point: vec3_t, worldmodel: model_t) => { cluster: number; contents: number } | null;
  onNoworldModelClear?: (viewport: GlRmainViewport) => void;
  onViewportSetup?: (viewport: GlRmainViewport) => void;
  onProjectionSetup?: (projection: GlRmainProjection) => void;
  onModelViewSetup?: (matrix: Float32Array) => void;
  onSetGL2D?: (viewport: GlRmainViewport) => void;
  onClear?: (options: { clearColor: boolean; clearDepth: boolean; gldepthmin: number; gldepthmax: number; depthFunc: "LEQUAL" | "GEQUAL" }) => void;
  onSetTexturePalette?: (palette: Uint32Array) => void;
  onSetDrawBuffer?: (buffer: "GL_FRONT" | "GL_BACK") => void;
  onDrawBeam?: (entity: entity_t, color: [number, number, number], segments: GlRmainBeamSegment[]) => void;
  onDrawSpriteModel?: (entity: entity_t, texture: image_t | null, alpha: number, vertices: GlRmainSpriteVertex[]) => void;
  onDrawNullModel?: (entity: entity_t, shadelight: vec3_t, topFan: vec3_t[], bottomFan: vec3_t[]) => void;
  onDrawParticles?: (texture: image_t | null, triangles: GlRmainParticleTriangle[]) => void;
  onDrawPointParticles?: (particles: Array<{ position: vec3_t; color: [number, number, number, number]; size: number }>) => void;
  onDrawPointParticleBatch?: (
    particles: readonly particle_t[],
    count: number,
    colortable: Uint32Array,
    pointSize: number
  ) => void;
  onDrawStereoPattern?: (pattern: GlRmainStereoPattern) => void;
  onDepthMaskChange?: (enabled: boolean) => void;
  drawAliasModel?: (entity: entity_t) => void;
  drawBrushModel?: (entity: entity_t) => void;
  drawSpriteModel?: (entity: entity_t) => void;
  drawNullModel?: (entity: entity_t, shadelight: vec3_t) => void;
  lightPoint?: (origin: vec3_t) => vec3_t;
  pushDlights?: () => void;
  markLeaves?: () => void;
  drawWorld?: () => void;
  renderDlights?: () => void;
  drawParticles?: () => void;
  drawAlphaSurfaces?: () => void;
  polyBlend?: (blend: [number, number, number, number]) => void;
  print?: (printLevel: number, message: string) => void;
  finish?: () => void;
  enableLogging?: (enabled: boolean) => void;
  logNewFrame?: () => void;
  updateSwapInterval?: () => void;
  textureMode?: (mode: string) => void;
  textureAlphaMode?: (mode: string) => void;
  textureSolidMode?: (mode: string) => void;
  sysError?: (level: number, message: string) => never;
  qglInit?: (driver: string) => boolean;
  qglShutdown?: () => void;
  glimpInit?: (hinstance: unknown, hWnd: unknown) => boolean;
  glimpShutdown?: () => void;
  glimpBeginFrame?: (camera_separation: number) => void;
  glimpEndFrame?: () => void;
  glimpAppActivate?: (activate: boolean) => void;
  drawGetPalette?: () => void;
  scaleTurbulence?: (scale: number) => void;
  getGlStrings?: () => { vendor: string; renderer: string; version: string; extensions: string } | null;
  getGlError?: () => number | null;
  glSetDefaultState?: () => void;
  glInitImages?: () => void;
  modInit?: () => void;
  rInitParticleTexture?: () => void;
  drawInitLocal?: () => void;
  glimpSetMode?: (width: number, height: number, mode: number, fullscreen: boolean) => GlimpSetModeResult;
  glShutdownImages?: () => void;
  modFreeAll?: () => void;
  resolveBackendProc?: (name: string) => unknown;
}

/**
 * Original name: N/A
 * Source: N/A (renderer refexport adapter)
 * Category: New
 * Purpose: Provide host callbacks used to assemble the `GetRefAPI` export table.
 */
export interface GlRmainRefApiHooks {
  imagelistCommand?: () => void;
  screenshotCommand?: () => void;
  modellistCommand?: () => void;
  glStringsCommand?: () => void;
  beginRegistration?: (map: string) => void;
  registerModel?: (name: string) => model_t | null;
  registerSkin?: (name: string) => image_t | null;
  registerPic?: (name: string) => image_t | null;
  setSky?: (name: string, rotate: number, axis: vec3_t) => void;
  endRegistration?: () => void;
  drawGetPicSize?: (name: string) => { width: number; height: number };
  drawPic?: (x: number, y: number, name: string) => void;
  drawStretchPic?: (x: number, y: number, w: number, h: number, name: string) => void;
  drawChar?: (x: number, y: number, c: number) => void;
  drawTileClear?: (x: number, y: number, w: number, h: number, name: string) => void;
  drawFill?: (x: number, y: number, w: number, h: number, c: number) => void;
  drawFadeScreen?: () => void;
  drawStretchRaw?: (x: number, y: number, w: number, h: number, cols: number, rows: number, data: Uint8Array) => void;
  endFrame?: () => void;
  appActivate?: (activate: boolean) => void;
  swapInit?: () => void;
}

/**
 * Original name: N/A
 * Source: N/A (renderer runtime state)
 * Category: New
 * Purpose: Store the explicit state replacing the mutable globals owned by `ref_gl/gl_rmain.c`.
 */
export interface GlRmainRuntime {
  vid: { width: number; height: number };
  gl_state: GlRmainGlState;
  r_worldmodel: model_t | null;
  currententity: entity_t | null;
  currentmodel: model_t | null;
  frustum: [cplane_t, cplane_t, cplane_t, cplane_t];
  r_visframecount: number;
  r_framecount: number;
  c_brush_polys: number;
  c_alias_polys: number;
  c_visible_lightmaps: number;
  c_visible_textures: number;
  v_blend: [number, number, number, number];
  vup: vec3_t;
  vpn: vec3_t;
  vright: vec3_t;
  r_origin: vec3_t;
  r_world_matrix: Float32Array;
  r_newrefdef: refdef_t | null;
  r_viewcluster: number;
  r_viewcluster2: number;
  r_oldviewcluster: number;
  r_oldviewcluster2: number;
  gldepthmin: number;
  gldepthmax: number;
  trickframe: number;
  rawpalette: Uint32Array;
  d_8to24table: Uint32Array;
  r_particletexture: image_t | null;
  r_norefresh: cvar_t | null;
  r_drawentities: cvar_t | null;
  r_speeds: cvar_t | null;
  r_nocull: cvar_t | null;
  gl_finish: cvar_t | null;
  gl_clear: cvar_t | null;
  gl_ztrick: cvar_t | null;
  gl_polyblend: cvar_t | null;
  gl_log: cvar_t | null;
  gl_drawbuffer: cvar_t | null;
  gl_texturemode: cvar_t | null;
  gl_texturealphamode: cvar_t | null;
  gl_texturesolidmode: cvar_t | null;
  gl_swapinterval: cvar_t | null;
  gl_mode: cvar_t | null;
  gl_ext_pointparameters: cvar_t | null;
  gl_particle_size: cvar_t | null;
  vid_fullscreen: cvar_t | null;
  vid_gamma: cvar_t | null;
  vid_ref: cvar_t | null;
  r_lightlevel: cvar_t | null;
  ri: refimport_t | null;
  r_drawworld: cvar_t | null;
  r_fullbright: cvar_t | null;
  r_novis: cvar_t | null;
  r_lerpmodels: cvar_t | null;
  r_lefthand: cvar_t | null;
  gl_nosubimage: cvar_t | null;
  gl_allow_software: cvar_t | null;
  gl_vertex_arrays: cvar_t | null;
  gl_particle_min_size: cvar_t | null;
  gl_particle_max_size: cvar_t | null;
  gl_particle_att_a: cvar_t | null;
  gl_particle_att_b: cvar_t | null;
  gl_particle_att_c: cvar_t | null;
  gl_ext_swapinterval: cvar_t | null;
  gl_ext_palettedtexture: cvar_t | null;
  gl_ext_multitexture: cvar_t | null;
  gl_ext_compiled_vertex_array: cvar_t | null;
  gl_bitdepth: cvar_t | null;
  gl_driver: cvar_t | null;
  gl_lightmap: cvar_t | null;
  gl_shadows: cvar_t | null;
  gl_dynamic: cvar_t | null;
  gl_monolightmap: cvar_t | null;
  gl_modulate: cvar_t | null;
  gl_nobind: cvar_t | null;
  gl_round_down: cvar_t | null;
  gl_picmip: cvar_t | null;
  gl_skymip: cvar_t | null;
  gl_showtris: cvar_t | null;
  gl_cull: cvar_t | null;
  gl_flashblend: cvar_t | null;
  gl_playermip: cvar_t | null;
  gl_saturatelighting: cvar_t | null;
  gl_lockpvs: cvar_t | null;
  gl_3dlabs_broken: cvar_t | null;
  gl_allow_cds: boolean;
  gl_renderer: number;
  gl_vendor_string: string;
  gl_renderer_string: string;
  gl_version_string: string;
  gl_extensions_string: string;
  qglLockArraysEXT: boolean;
  qglUnlockArraysEXT: boolean;
  qwglSwapIntervalEXT: boolean;
  qglPointParameterfEXT: boolean;
  qglPointParameterfvEXT: boolean;
  qglColorTableEXT: boolean;
  qglMTexCoord2fSGIS: boolean;
  qglSelectTextureSGIS: boolean;
  hooks: GlRmainHooks;
}

/**
 * Original name: N/A
 * Source: N/A (renderer runtime factory)
 * Category: New
 * Purpose: Create the explicit runtime replacing the mutable `gl_rmain.c` globals used by the current port tranche.
 */
export function createGlRmainRuntime(hooks: GlRmainHooks = {}): GlRmainRuntime {
  return {
    vid: { width: 0, height: 0 },
    gl_state: {
      camera_separation: 0,
      stereo_enabled: false,
      current_draw_buffer: null,
      prev_mode: 3
    },
    r_worldmodel: null,
    currententity: null,
    currentmodel: null,
    frustum: [createPlane(), createPlane(), createPlane(), createPlane()],
    r_visframecount: 0,
    r_framecount: 0,
    c_brush_polys: 0,
    c_alias_polys: 0,
    c_visible_lightmaps: 0,
    c_visible_textures: 0,
    v_blend: [0, 0, 0, 0],
    vup: [0, 0, 0],
    vpn: [0, 0, 0],
    vright: [0, 0, 0],
    r_origin: [0, 0, 0],
    r_world_matrix: new Float32Array(16),
    r_newrefdef: null,
    r_viewcluster: -1,
    r_viewcluster2: -1,
    r_oldviewcluster: -1,
    r_oldviewcluster2: -1,
    gldepthmin: 0,
    gldepthmax: 1,
    trickframe: 0,
    rawpalette: new Uint32Array(256),
    d_8to24table: new Uint32Array(256),
    r_particletexture: null,
    r_norefresh: null,
    r_drawentities: null,
    r_speeds: null,
    r_nocull: null,
    gl_finish: null,
    gl_clear: null,
    gl_ztrick: null,
    gl_polyblend: null,
    gl_log: null,
    gl_drawbuffer: null,
    gl_texturemode: null,
    gl_texturealphamode: null,
    gl_texturesolidmode: null,
    gl_swapinterval: null,
    gl_mode: null,
    gl_ext_pointparameters: null,
    gl_particle_size: null,
    vid_fullscreen: null,
    vid_gamma: null,
    vid_ref: null,
    r_lightlevel: null,
    ri: null,
    r_drawworld: null,
    r_fullbright: null,
    r_novis: null,
    r_lerpmodels: null,
    r_lefthand: null,
    gl_nosubimage: null,
    gl_allow_software: null,
    gl_vertex_arrays: null,
    gl_particle_min_size: null,
    gl_particle_max_size: null,
    gl_particle_att_a: null,
    gl_particle_att_b: null,
    gl_particle_att_c: null,
    gl_ext_swapinterval: null,
    gl_ext_palettedtexture: null,
    gl_ext_multitexture: null,
    gl_ext_compiled_vertex_array: null,
    gl_bitdepth: null,
    gl_driver: null,
    gl_lightmap: null,
    gl_shadows: null,
    gl_dynamic: null,
    gl_monolightmap: null,
    gl_modulate: null,
    gl_nobind: null,
    gl_round_down: null,
    gl_picmip: null,
    gl_skymip: null,
    gl_showtris: null,
    gl_cull: null,
    gl_flashblend: null,
    gl_playermip: null,
    gl_saturatelighting: null,
    gl_lockpvs: null,
    gl_3dlabs_broken: null,
    gl_allow_cds: true,
    gl_renderer: 0,
    gl_vendor_string: "",
    gl_renderer_string: "",
    gl_version_string: "",
    gl_extensions_string: "",
    qglLockArraysEXT: false,
    qglUnlockArraysEXT: false,
    qwglSwapIntervalEXT: false,
    qglPointParameterfEXT: false,
    qglPointParameterfvEXT: false,
    qglColorTableEXT: false,
    qglMTexCoord2fSGIS: false,
    qglSelectTextureSGIS: false,
    hooks
  };
}

/**
 * Original name: V_AddBlend
 * Source: ref_gl/gl_local.h
 * Category: Adapter
 * Fidelity level: Strict
 *
 * Porting notes:
 * - The original tree declares `V_AddBlend` for `ref_gl` but does not provide a `gl_rmain.c` definition; keep this helper separate from covered owner status.
 */
export function V_AddBlend(r: number, g: number, b: number, a: number, v_blend: [number, number, number, number]): void {
  if (a <= 0) {
    return;
  }

  const a2 = v_blend[3] + (1 - v_blend[3]) * a;
  const a3 = v_blend[3] / a2;

  v_blend[0] = v_blend[0] * a3 + r * (1 - a3);
  v_blend[1] = v_blend[1] * a3 + g * (1 - a3);
  v_blend[2] = v_blend[2] * a3 + b * (1 - a3);
  v_blend[3] = a2;
}

/**
 * Original name: SignbitsForPlane
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function SignbitsForPlane(out: cplane_t): number {
  let bits = 0;
  for (let index = 0; index < 3; index += 1) {
    if (out.normal[index] < 0) {
      bits |= 1 << index;
    }
  }
  return bits;
}

/**
 * Original name: R_CullBox
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function R_CullBox(runtime: GlRmainRuntime, mins: vec3_t, maxs: vec3_t): boolean {
  if (runtime.r_nocull?.value) {
    return false;
  }

  for (let index = 0; index < 4; index += 1) {
    if (BoxOnPlaneSide(mins, maxs, runtime.frustum[index]) === 2) {
      return true;
    }
  }
  return false;
}

/**
 * Original name: R_RotateForEntity
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Exposes the original translation/rotation order used for brush and null-model draws.
 */
export function R_RotateForEntity(entity: entity_t): {
  translate: vec3_t;
  rotate: Array<{ angle: number; axis: vec3_t }>;
} {
  return {
    translate: [entity.origin[0], entity.origin[1], entity.origin[2]],
    rotate: [
      { angle: entity.angles[1], axis: [0, 0, 1] },
      { angle: -entity.angles[0], axis: [0, 1, 0] },
      { angle: -entity.angles[2], axis: [1, 0, 0] }
    ]
  };
}

/**
 * Original name: R_SetFrustum
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function R_SetFrustum(runtime: GlRmainRuntime): void {
  const refdef = runtime.r_newrefdef;
  if (!refdef) {
    throw new Error("R_SetFrustum: r_newrefdef is null");
  }

  RotatePointAroundVector(runtime.frustum[0].normal, runtime.vup, runtime.vpn, -(90 - refdef.fov_x / 2));
  RotatePointAroundVector(runtime.frustum[1].normal, runtime.vup, runtime.vpn, 90 - refdef.fov_x / 2);
  RotatePointAroundVector(runtime.frustum[2].normal, runtime.vright, runtime.vpn, 90 - refdef.fov_y / 2);
  RotatePointAroundVector(runtime.frustum[3].normal, runtime.vright, runtime.vpn, -(90 - refdef.fov_y / 2));

  for (let index = 0; index < 4; index += 1) {
    const plane = runtime.frustum[index];
    plane.type = 5;
    plane.dist = DotProduct(runtime.r_origin, plane.normal);
    plane.signbits = SignbitsForPlane(plane);
  }
}

/**
 * Original name: R_SetupFrame
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Porting notes:
 * - Uses a point-in-leaf hook to preserve the original view-cluster behavior without coupling this file to one loader implementation.
 */
export function R_SetupFrame(runtime: GlRmainRuntime): void {
  const refdef = runtime.r_newrefdef;
  if (!refdef) {
    throw new Error("R_SetupFrame: r_newrefdef is null");
  }

  runtime.r_framecount += 1;
  VectorCopy(refdef.vieworg, runtime.r_origin);

  const vectors = AngleVectors(refdef.viewangles);
  VectorCopy(vectors.forward, runtime.vpn);
  VectorCopy(vectors.right, runtime.vright);
  VectorCopy(vectors.up, runtime.vup);

  if ((refdef.rdflags & RDF_NOWORLDMODEL) === 0) {
    const worldmodel = runtime.r_worldmodel;
    if (!worldmodel) {
      throw new Error("R_SetupFrame: r_worldmodel is null");
    }

    runtime.r_oldviewcluster = runtime.r_viewcluster;
    runtime.r_oldviewcluster2 = runtime.r_viewcluster2;

    const leaf = runtime.hooks.pointInLeaf?.(runtime.r_origin, worldmodel) ?? null;
    if (!leaf) {
      throw new Error("R_SetupFrame: pointInLeaf hook is required when drawing a worldmodel");
    }

    runtime.r_viewcluster = leaf.cluster;
    runtime.r_viewcluster2 = leaf.cluster;

    const temp: vec3_t = [runtime.r_origin[0], runtime.r_origin[1], runtime.r_origin[2]];
    if (!leaf.contents) {
      temp[2] -= 16;
    } else {
      temp[2] += 16;
    }

    const probeLeaf = runtime.hooks.pointInLeaf?.(temp, worldmodel) ?? null;
    if (probeLeaf && (probeLeaf.contents & CONTENTS_SOLID) === 0 && probeLeaf.cluster !== runtime.r_viewcluster2) {
      runtime.r_viewcluster2 = probeLeaf.cluster;
    }
  }

  for (let index = 0; index < 4; index += 1) {
    runtime.v_blend[index] = refdef.blend[index];
  }

  runtime.c_brush_polys = 0;
  runtime.c_alias_polys = 0;

  if ((refdef.rdflags & RDF_NOWORLDMODEL) !== 0) {
    runtime.hooks.onNoworldModelClear?.({
      x: refdef.x,
      y: refdef.y,
      width: refdef.width,
      height: refdef.height
    });
  }
}

/**
 * Original name: MYgluPerspective
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function MYgluPerspective(
  gl_state: GlRmainGlState,
  fovy: number,
  aspect: number,
  zNear: number,
  zFar: number
): GlRmainProjection {
  let ymax = zNear * Math.tan((fovy * M_PI) / 360.0);
  let ymin = -ymax;
  let xmin = ymin * aspect;
  let xmax = ymax * aspect;

  xmin += -(2 * gl_state.camera_separation) / zNear;
  xmax += -(2 * gl_state.camera_separation) / zNear;

  return { xmin, xmax, ymin, ymax, zNear, zFar };
}

/**
 * Original name: R_SetupGL
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Porting notes:
 * - Builds the logical viewport, projection and modelview matrix payloads and publishes them through hooks.
 */
export function R_SetupGL(runtime: GlRmainRuntime): void {
  const refdef = runtime.r_newrefdef;
  if (!refdef) {
    throw new Error("R_SetupGL: r_newrefdef is null");
  }

  const x = Math.floor(refdef.x * runtime.vid.width / runtime.vid.width);
  const x2 = Math.ceil((refdef.x + refdef.width) * runtime.vid.width / runtime.vid.width);
  const y = Math.floor(runtime.vid.height - refdef.y * runtime.vid.height / runtime.vid.height);
  const y2 = Math.ceil(runtime.vid.height - (refdef.y + refdef.height) * runtime.vid.height / runtime.vid.height);

  const viewport: GlRmainViewport = {
    x,
    y: y2,
    width: x2 - x,
    height: y - y2
  };
  runtime.hooks.onViewportSetup?.(viewport);

  const screenaspect = refdef.width / refdef.height;
  const projection = MYgluPerspective(runtime.gl_state, refdef.fov_y, screenaspect, 4, 4096);
  runtime.hooks.onProjectionSetup?.(projection);

  const worldMatrix = buildWorldMatrix(refdef.vieworg, refdef.viewangles);
  runtime.r_world_matrix.set(worldMatrix);
  runtime.hooks.onModelViewSetup?.(runtime.r_world_matrix);
}

/**
 * Original name: R_Clear
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function R_Clear(runtime: GlRmainRuntime): void {
  if (runtime.gl_ztrick?.value) {
    runtime.trickframe += 1;
    if (runtime.trickframe & 1) {
      runtime.gldepthmin = 0;
      runtime.gldepthmax = 0.49999;
      runtime.hooks.onClear?.({
        clearColor: Boolean(runtime.gl_clear?.value),
        clearDepth: false,
        gldepthmin: runtime.gldepthmin,
        gldepthmax: runtime.gldepthmax,
        depthFunc: "LEQUAL"
      });
    } else {
      runtime.gldepthmin = 1;
      runtime.gldepthmax = 0.5;
      runtime.hooks.onClear?.({
        clearColor: Boolean(runtime.gl_clear?.value),
        clearDepth: false,
        gldepthmin: runtime.gldepthmin,
        gldepthmax: runtime.gldepthmax,
        depthFunc: "GEQUAL"
      });
    }
    return;
  }

  runtime.gldepthmin = 0;
  runtime.gldepthmax = 1;
  runtime.hooks.onClear?.({
    clearColor: Boolean(runtime.gl_clear?.value),
    clearDepth: true,
    gldepthmin: runtime.gldepthmin,
    gldepthmax: runtime.gldepthmax,
    depthFunc: "LEQUAL"
  });
}

/**
 * Original name: R_SetGL2D
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Close
 */
export function R_SetGL2D(runtime: GlRmainRuntime): void {
  runtime.hooks.onSetGL2D?.({
    x: 0,
    y: 0,
    width: runtime.vid.width,
    height: runtime.vid.height
  });
}

/**
 * Original name: GL_DrawColoredStereoLinePair
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Builds the colored stereo calibration line and following black line emitted by the original immediate-mode helper.
 */
export function GL_DrawColoredStereoLinePair(
  runtime: GlRmainRuntime,
  r: number,
  g: number,
  b: number,
  y: number
): GlRmainStereoLine[] {
  return [
    {
      color: [r, g, b],
      start: [0, y],
      end: [runtime.vid.width, y]
    },
    {
      color: [0, 0, 0],
      start: [0, y + 1],
      end: [runtime.vid.width, y + 1]
    }
  ];
}

/**
 * Original name: GL_DrawStereoPattern
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the Intergraph stereo calibration pattern only when stereo rendering is enabled.
 *
 * Porting notes:
 * - The original `R_Init` call is compiled out by `#if 0`; this helper remains callable for traceability and tests.
 */
export function GL_DrawStereoPattern(runtime: GlRmainRuntime): GlRmainStereoPattern | null {
  if ((runtime.gl_renderer & GL_RENDERER_INTERGRAPH) === 0) {
    return null;
  }

  if (!runtime.gl_state.stereo_enabled) {
    return null;
  }

  R_SetGL2D(runtime);

  const frameLines: GlRmainStereoLine[] = [
    ...GL_DrawColoredStereoLinePair(runtime, 1, 0, 0, 0),
    ...GL_DrawColoredStereoLinePair(runtime, 1, 0, 0, 2),
    ...GL_DrawColoredStereoLinePair(runtime, 1, 0, 0, 4),
    ...GL_DrawColoredStereoLinePair(runtime, 1, 0, 0, 6),
    ...GL_DrawColoredStereoLinePair(runtime, 0, 1, 0, 8),
    ...GL_DrawColoredStereoLinePair(runtime, 1, 1, 0, 10),
    ...GL_DrawColoredStereoLinePair(runtime, 1, 1, 0, 12),
    ...GL_DrawColoredStereoLinePair(runtime, 0, 1, 0, 14)
  ];
  const pattern: GlRmainStereoPattern = {
    drawBuffer: GL_BACK_LEFT,
    frames: Array.from({ length: 20 }, () => frameLines.map((line) => ({
      color: [...line.color] as [number, number, number],
      start: [...line.start] as [number, number],
      end: [...line.end] as [number, number]
    })))
  };

  runtime.hooks.onDrawStereoPattern?.(pattern);
  return pattern;
}

/**
 * Original name: R_PolyBlend
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Close
 */
export function R_PolyBlend(runtime: GlRmainRuntime): void {
  if (!runtime.gl_polyblend?.value || runtime.v_blend[3] === 0) {
    return;
  }

  runtime.hooks.polyBlend?.(runtime.v_blend);
}

/**
 * Original name: R_Flash
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Close
 */
export function R_Flash(runtime: GlRmainRuntime): void {
  R_PolyBlend(runtime);
}

/**
 * Original name: R_DrawBeam
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Reconstructs the original beam ring geometry and emits it through a hook.
 */
export function R_DrawBeam(runtime: GlRmainRuntime, e: entity_t): void {
  const oldorigin: vec3_t = [e.oldorigin[0], e.oldorigin[1], e.oldorigin[2]];
  const origin: vec3_t = [e.origin[0], e.origin[1], e.origin[2]];
  const direction: vec3_t = [
    oldorigin[0] - origin[0],
    oldorigin[1] - origin[1],
    oldorigin[2] - origin[2]
  ];
  const normalized_direction: vec3_t = [direction[0], direction[1], direction[2]];

  if (VectorNormalize(normalized_direction) === 0) {
    return;
  }

  const perpvec: vec3_t = [0, 0, 0];
  PerpendicularVector(perpvec, normalized_direction);
  VectorScale(perpvec, e.frame / 2, perpvec);

  const start_points: vec3_t[] = [];
  const end_points: vec3_t[] = [];
  for (let index = 0; index < NUM_BEAM_SEGS; index += 1) {
    const start: vec3_t = [0, 0, 0];
    RotatePointAroundVector(start, normalized_direction, perpvec, (360.0 / NUM_BEAM_SEGS) * index);
    VectorAdd(start, origin, start);
    const end: vec3_t = [0, 0, 0];
    VectorAdd(start, direction, end);
    start_points.push(start);
    end_points.push(end);
  }

  const packed = runtime.d_8to24table[e.skinnum & 0xff] ?? 0;
  const color: [number, number, number] = [
    (packed & 0xff) / 255.0,
    ((packed >> 8) & 0xff) / 255.0,
    ((packed >> 16) & 0xff) / 255.0
  ];
  const segments: GlRmainBeamSegment[] = start_points.map((start, index) => ({
    start,
    end: end_points[index]
  }));

  runtime.hooks.onDrawBeam?.(e, color, segments);
}

/**
 * Original name: R_SetPalette
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function R_SetPalette(runtime: GlRmainRuntime, palette: Uint8Array | null): void {
  for (let index = 0; index < 256; index += 1) {
    if (palette) {
      runtime.rawpalette[index] =
        ((0xff << 24) >>> 0) |
        ((palette[index * 3 + 2] ?? 0) << 16) |
        ((palette[index * 3 + 1] ?? 0) << 8) |
        (palette[index * 3] ?? 0);
    } else {
      const color = runtime.d_8to24table[index] ?? 0;
      runtime.rawpalette[index] =
        ((0xff << 24) >>> 0) |
        ((color >> 16) & 0xff) << 16 |
        ((color >> 8) & 0xff) << 8 |
        (color & 0xff);
    }
  }

  runtime.hooks.onSetTexturePalette?.(runtime.rawpalette);
}

/**
 * Original name: R_DrawSpriteModel
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Porting notes:
 * - Preserves sprite frame selection and billboard vertex construction while delegating final submission to hooks.
 */
export function R_DrawSpriteModel(runtime: GlRmainRuntime, e: entity_t): void {
  const currentmodel = runtime.currentmodel;
  if (!currentmodel) {
    throw new Error("R_DrawSpriteModel: currentmodel is null");
  }

  const sprite = currentmodel.extradata as dsprite_t | null;
  if (!sprite || sprite.numframes <= 0) {
    throw new Error("R_DrawSpriteModel: currentmodel missing sprite payload");
  }

  const frameIndex = e.frame % sprite.numframes;
  const frame = sprite.frames[frameIndex];
  if (!frame) {
    throw new Error("R_DrawSpriteModel: missing sprite frame");
  }

  const up = runtime.vup;
  const right = runtime.vright;
  const alpha = (e.flags & RF_TRANSLUCENT) !== 0 ? e.alpha : 1.0;
  const point: vec3_t = [0, 0, 0];
  const vertices: GlRmainSpriteVertex[] = [];

  VectorMA(e.origin, -frame.origin_y, up, point);
  VectorMA(point, -frame.origin_x, right, point);
  vertices.push({ position: [...point], uv: [0, 1] });

  VectorMA(e.origin, frame.height - frame.origin_y, up, point);
  VectorMA(point, -frame.origin_x, right, point);
  vertices.push({ position: [...point], uv: [0, 0] });

  VectorMA(e.origin, frame.height - frame.origin_y, up, point);
  VectorMA(point, frame.width - frame.origin_x, right, point);
  vertices.push({ position: [...point], uv: [1, 0] });

  VectorMA(e.origin, -frame.origin_y, up, point);
  VectorMA(point, frame.width - frame.origin_x, right, point);
  vertices.push({ position: [...point], uv: [1, 1] });

  runtime.hooks.onDrawSpriteModel?.(e, currentmodel.skins[frameIndex] ?? null, alpha, vertices);
  runtime.hooks.drawSpriteModel?.(e);
}

/**
 * Original name: R_DrawNullModel
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Close
 */
export function R_DrawNullModel(runtime: GlRmainRuntime, entity: entity_t): void {
  const shadelight = (entity.flags & RF_FULLBRIGHT) !== 0
    ? ([1, 1, 1] as vec3_t)
    : runtime.hooks.lightPoint?.(entity.origin) ?? ([0, 0, 0] as vec3_t);

  const topFan: vec3_t[] = [[0, 0, -16]];
  for (let index = 0; index <= 4; index += 1) {
    topFan.push([16 * Math.cos(index * M_PI / 2), 16 * Math.sin(index * M_PI / 2), 0]);
  }

  const bottomFan: vec3_t[] = [[0, 0, 16]];
  for (let index = 4; index >= 0; index -= 1) {
    bottomFan.push([16 * Math.cos(index * M_PI / 2), 16 * Math.sin(index * M_PI / 2), 0]);
  }

  runtime.hooks.onDrawNullModel?.(entity, [...shadelight] as vec3_t, topFan, bottomFan);
  runtime.hooks.drawNullModel?.(entity, [...shadelight] as vec3_t);
}

/**
 * Original name: GL_DrawParticles
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Close
 */
export function GL_DrawParticles(
  runtime: GlRmainRuntime,
  num_particles: number,
  particles: readonly particle_t[],
  colortable: Uint32Array | readonly number[]
): void {
  const table = colortable instanceof Uint32Array ? colortable : Uint32Array.from(colortable);
  const up: vec3_t = [0, 0, 0];
  const right: vec3_t = [0, 0, 0];
  VectorScale(runtime.vup, 1.5, up);
  VectorScale(runtime.vright, 1.5, right);

  const triangles: GlRmainParticleTriangle[] = [];
  for (let index = 0; index < num_particles; index += 1) {
    const particle = particles[index];
    if (!particle) {
      continue;
    }

    let scale =
      (particle.origin[0] - runtime.r_origin[0]) * runtime.vpn[0] +
      (particle.origin[1] - runtime.r_origin[1]) * runtime.vpn[1] +
      (particle.origin[2] - runtime.r_origin[2]) * runtime.vpn[2];
    scale = scale < 20 ? 1 : 1 + scale * 0.004;

    const packed = table[particle.color] ?? 0;
    const color: [number, number, number, number] = [
      (packed & 0xff) / 255.0,
      ((packed >> 8) & 0xff) / 255.0,
      ((packed >> 16) & 0xff) / 255.0,
      particle.alpha
    ];

    triangles.push({
      color,
      vertices: [
        { position: [...particle.origin], uv: [0.0625, 0.0625] },
        {
          position: [
            particle.origin[0] + up[0] * scale,
            particle.origin[1] + up[1] * scale,
            particle.origin[2] + up[2] * scale
          ],
          uv: [1.0625, 0.0625]
        },
        {
          position: [
            particle.origin[0] + right[0] * scale,
            particle.origin[1] + right[1] * scale,
            particle.origin[2] + right[2] * scale
          ],
          uv: [0.0625, 1.0625]
        }
      ]
    });
  }

  runtime.hooks.onDrawParticles?.(runtime.r_particletexture, triangles);
}

/**
 * Original name: R_DrawParticles
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Close
 */
export function R_DrawParticles(runtime: GlRmainRuntime): void {
  const refdef = runtime.r_newrefdef;
  if (!refdef) {
    return;
  }

  if (runtime.gl_ext_pointparameters?.value && runtime.qglPointParameterfEXT) {
    if (runtime.hooks.onDrawPointParticleBatch) {
      runtime.hooks.onDrawPointParticleBatch(
        refdef.particles,
        refdef.num_particles,
        runtime.d_8to24table,
        runtime.gl_particle_size?.value ?? 1
      );
      runtime.hooks.drawParticles?.();
      return;
    }

    const points = refdef.particles.slice(0, refdef.num_particles).map((particle) => {
      const packed = runtime.d_8to24table[particle.color] ?? 0;
      return {
        position: [...particle.origin] as vec3_t,
        color: [
          (packed & 0xff) / 255.0,
          ((packed >> 8) & 0xff) / 255.0,
          ((packed >> 16) & 0xff) / 255.0,
          particle.alpha
        ] as [number, number, number, number],
        size: runtime.gl_particle_size?.value ?? 1
      };
    });
    runtime.hooks.onDrawPointParticles?.(points);
    runtime.hooks.drawParticles?.();
    return;
  }

  GL_DrawParticles(runtime, refdef.num_particles, refdef.particles, runtime.d_8to24table);
  runtime.hooks.drawParticles?.();
}

/**
 * Original name: R_DrawEntitiesOnList
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Porting notes:
 * - Keeps the original draw order and model-type dispatch while delegating the concrete rendering branches through hooks.
 */
export function R_DrawEntitiesOnList(runtime: GlRmainRuntime): void {
  const refdef = runtime.r_newrefdef;
  if (!refdef || runtime.r_drawentities?.value === 0) {
    return;
  }

  for (let pass = 0; pass < 2; pass += 1) {
    const translucentPass = pass === 1;
    if (translucentPass) {
      runtime.hooks.onDepthMaskChange?.(false);
    }

    for (let index = 0; index < refdef.num_entities; index += 1) {
      const entity = refdef.entities[index];
      const isTranslucent = (entity.flags & RF_TRANSLUCENT) !== 0;
      if (isTranslucent !== translucentPass) {
        continue;
      }

      runtime.currententity = entity;
      if ((entity.flags & RF_BEAM) !== 0) {
        R_DrawBeam(runtime, entity);
        continue;
      }

      runtime.currentmodel = entity.model as model_t | null;
      if (!runtime.currentmodel) {
        R_DrawNullModel(runtime, entity);
        continue;
      }

      switch (runtime.currentmodel.type) {
        case modtype_t.mod_alias:
          runtime.hooks.drawAliasModel?.(entity);
          break;
        case modtype_t.mod_brush:
          runtime.hooks.drawBrushModel?.(entity);
          break;
        case modtype_t.mod_sprite:
          R_DrawSpriteModel(runtime, entity);
          break;
        default:
          failSysError(runtime, ERR_DROP, "Bad modeltype");
      }
    }

    if (translucentPass) {
      runtime.hooks.onDepthMaskChange?.(true);
    }
  }
}

/**
 * Original name: R_RenderView
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Porting notes:
 * - Preserves the original high-level call order while delegating already-portioned sub-branches through hooks.
 */
export function R_RenderView(runtime: GlRmainRuntime, fd: refdef_t): void {
  if (runtime.r_norefresh?.value) {
    return;
  }

  runtime.r_newrefdef = cloneRefdef(fd);
  if (!runtime.r_worldmodel && (fd.rdflags & RDF_NOWORLDMODEL) === 0) {
    failSysError(runtime, ERR_DROP, "R_RenderView: NULL worldmodel");
  }

  if (runtime.r_speeds?.value) {
    runtime.c_brush_polys = 0;
    runtime.c_alias_polys = 0;
  }

  runtime.hooks.pushDlights?.();
  if (runtime.gl_finish?.value) {
    runtime.hooks.finish?.();
  }

  R_SetupFrame(runtime);
  R_SetFrustum(runtime);
  R_SetupGL(runtime);

  runtime.hooks.markLeaves?.();
  runtime.hooks.drawWorld?.();
  R_DrawEntitiesOnList(runtime);
  runtime.hooks.renderDlights?.();
  R_DrawParticles(runtime);
  runtime.hooks.drawAlphaSurfaces?.();
  R_Flash(runtime);

  if (runtime.r_speeds?.value) {
    runtime.hooks.print?.(
      PRINT_ALL,
      `${runtime.c_brush_polys.toString().padStart(4, " ")} wpoly ${runtime.c_alias_polys.toString().padStart(4, " ")} epoly ${runtime.c_visible_textures} tex ${runtime.c_visible_lightmaps} lmaps\n`
    );
  }
}

/**
 * Original name: R_RenderFrame
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Close
 */
export function R_RenderFrame(runtime: GlRmainRuntime, fd: refdef_t): void {
  R_RenderView(runtime, fd);
  R_SetLightLevel(runtime);
  R_SetGL2D(runtime);
}

/**
 * Original name: R_BeginFrame
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Porting notes:
 * - Preserves the cvar-driven frame prelude and delegates backend side-effects through hooks.
 */
export function R_BeginFrame(runtime: GlRmainRuntime, camera_separation: number): void {
  runtime.gl_state.camera_separation = camera_separation;

  if (runtime.gl_mode?.modified || runtime.vid_fullscreen?.modified) {
    if (runtime.vid_ref) {
      runtime.vid_ref.modified = true;
    }
  }

  if (runtime.gl_log?.modified) {
    runtime.hooks.enableLogging?.(Boolean(runtime.gl_log.value));
    runtime.gl_log.modified = false;
  }

  if (runtime.gl_log?.value) {
    runtime.hooks.logNewFrame?.();
  }

  if (runtime.vid_gamma?.modified) {
    runtime.vid_gamma.modified = false;
  }

  runtime.hooks.glimpBeginFrame?.(camera_separation);
  R_SetGL2D(runtime);

  if (runtime.gl_drawbuffer?.modified) {
    runtime.gl_drawbuffer.modified = false;
    if (runtime.gl_state.camera_separation === 0 || !runtime.gl_state.stereo_enabled) {
      const drawBuffer = runtime.gl_drawbuffer.string.toUpperCase() === "GL_FRONT" ? "GL_FRONT" : "GL_BACK";
      runtime.gl_state.current_draw_buffer = drawBuffer;
      runtime.hooks.onSetDrawBuffer?.(drawBuffer);
    }
  }

  if (runtime.gl_texturemode?.modified) {
    runtime.hooks.textureMode?.(runtime.gl_texturemode.string);
    runtime.gl_texturemode.modified = false;
  }

  if (runtime.gl_texturealphamode?.modified) {
    runtime.hooks.textureAlphaMode?.(runtime.gl_texturealphamode.string);
    runtime.gl_texturealphamode.modified = false;
  }

  if (runtime.gl_texturesolidmode?.modified) {
    runtime.hooks.textureSolidMode?.(runtime.gl_texturesolidmode.string);
    runtime.gl_texturesolidmode.modified = false;
  }

  runtime.hooks.updateSwapInterval?.();
  R_Clear(runtime);
}

/**
 * Original name: N/A
 * Source: N/A (renderer runtime binder)
 * Category: New
 * Purpose: Bind the current world model used by the frame setup and view render path.
 */
export function setRmainWorldModel(runtime: GlRmainRuntime, model: model_t | null): void {
  runtime.r_worldmodel = model;
}

/**
 * Original name: N/A
 * Source: N/A (renderer palette binder)
 * Category: New
 * Purpose: Bind the current renderer-owned 8-to-24 palette table used by beam and raw palette code.
 */
export function setRmainPaletteTable(runtime: GlRmainRuntime, table: Uint32Array | readonly number[]): void {
  runtime.d_8to24table = table instanceof Uint32Array ? Uint32Array.from(table) : Uint32Array.from(table);
}

/**
 * Original name: N/A
 * Source: N/A (renderer texture binder)
 * Category: New
 * Purpose: Bind the current particle texture used by the triangle-particle fallback path.
 */
export function setRmainParticleTexture(runtime: GlRmainRuntime, image: image_t | null): void {
  runtime.r_particletexture = image;
}

/**
 * Original name: N/A
 * Source: N/A (renderer video-state binder)
 * Category: New
 * Purpose: Bind the current video dimensions used by viewport setup.
 */
export function setRmainVid(runtime: GlRmainRuntime, width: number, height: number): void {
  runtime.vid.width = width;
  runtime.vid.height = height;
}

/**
 * Original name: N/A
 * Source: N/A (renderer cvar binder)
 * Category: New
 * Purpose: Bind the cvars currently consumed by the ported `gl_rmain.c` tranche.
 */
export function setRmainCvars(runtime: GlRmainRuntime, cvars: Partial<Pick<GlRmainRuntime,
  "r_norefresh" | "r_drawentities" | "r_speeds" | "r_nocull" | "gl_finish" | "gl_clear" | "gl_ztrick" | "gl_polyblend" | "gl_log" | "gl_drawbuffer" | "gl_texturemode" | "gl_texturealphamode" | "gl_texturesolidmode" | "gl_swapinterval" | "gl_mode" | "gl_ext_pointparameters" | "gl_particle_size" | "vid_fullscreen" | "vid_gamma" | "vid_ref" | "r_lightlevel"
>>): void {
  Object.assign(runtime, cvars);
}

/**
 * Original name: R_SetLightLevel
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Samples view-origin light and stores a scalar light level for client-side hacks.
 */
export function R_SetLightLevel(runtime: GlRmainRuntime): void {
  const refdef = runtime.r_newrefdef;
  if (!refdef) {
    return;
  }

  if ((refdef.rdflags & RDF_NOWORLDMODEL) !== 0) {
    return;
  }

  const shadelight = runtime.hooks.lightPoint?.(refdef.vieworg) ?? ([0, 0, 0] as vec3_t);
  const maxComponent = Math.max(shadelight[0], shadelight[1], shadelight[2]);
  if (runtime.r_lightlevel) {
    runtime.r_lightlevel.value = 150 * maxComponent;
  }
}

/**
 * Original name: R_Register
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Registers the renderer-owned cvars and console commands through the imported engine services.
 */
export function R_Register(runtime: GlRmainRuntime, ri: refimport_t, commands: {
  imagelist?: () => void;
  screenshot?: () => void;
  modellist?: () => void;
  gl_strings?: () => void;
} = {}): void {
  runtime.ri = ri;

  runtime.r_lefthand = ri.Cvar_Get("hand", "0", CVAR_USERINFO | CVAR_ARCHIVE);
  runtime.r_norefresh = ri.Cvar_Get("r_norefresh", "0", 0);
  runtime.r_fullbright = ri.Cvar_Get("r_fullbright", "0", 0);
  runtime.r_drawentities = ri.Cvar_Get("r_drawentities", "1", 0);
  runtime.r_drawworld = ri.Cvar_Get("r_drawworld", "1", 0);
  runtime.r_novis = ri.Cvar_Get("r_novis", "0", 0);
  runtime.r_nocull = ri.Cvar_Get("r_nocull", "0", 0);
  runtime.r_lerpmodels = ri.Cvar_Get("r_lerpmodels", "1", 0);
  runtime.r_speeds = ri.Cvar_Get("r_speeds", "0", 0);
  runtime.r_lightlevel = ri.Cvar_Get("r_lightlevel", "0", 0);

  runtime.gl_nosubimage = ri.Cvar_Get("gl_nosubimage", "0", 0);
  runtime.gl_allow_software = ri.Cvar_Get("gl_allow_software", "0", 0);
  runtime.gl_vertex_arrays = ri.Cvar_Get("gl_vertex_arrays", "0", CVAR_ARCHIVE);

  runtime.gl_particle_min_size = ri.Cvar_Get("gl_particle_min_size", "2", CVAR_ARCHIVE);
  runtime.gl_particle_max_size = ri.Cvar_Get("gl_particle_max_size", "40", CVAR_ARCHIVE);
  runtime.gl_particle_size = ri.Cvar_Get("gl_particle_size", "40", CVAR_ARCHIVE);
  runtime.gl_particle_att_a = ri.Cvar_Get("gl_particle_att_a", "0.01", CVAR_ARCHIVE);
  runtime.gl_particle_att_b = ri.Cvar_Get("gl_particle_att_b", "0.0", CVAR_ARCHIVE);
  runtime.gl_particle_att_c = ri.Cvar_Get("gl_particle_att_c", "0.01", CVAR_ARCHIVE);

  runtime.gl_modulate = ri.Cvar_Get("gl_modulate", "1", CVAR_ARCHIVE);
  runtime.gl_log = ri.Cvar_Get("gl_log", "0", 0);
  runtime.gl_bitdepth = ri.Cvar_Get("gl_bitdepth", "0", 0);
  runtime.gl_mode = ri.Cvar_Get("gl_mode", "3", CVAR_ARCHIVE);
  runtime.gl_lightmap = ri.Cvar_Get("gl_lightmap", "0", 0);
  runtime.gl_shadows = ri.Cvar_Get("gl_shadows", "0", CVAR_ARCHIVE);
  runtime.gl_dynamic = ri.Cvar_Get("gl_dynamic", "1", 0);
  runtime.gl_nobind = ri.Cvar_Get("gl_nobind", "0", 0);
  runtime.gl_round_down = ri.Cvar_Get("gl_round_down", "1", 0);
  runtime.gl_picmip = ri.Cvar_Get("gl_picmip", "0", 0);
  runtime.gl_skymip = ri.Cvar_Get("gl_skymip", "0", 0);
  runtime.gl_showtris = ri.Cvar_Get("gl_showtris", "0", 0);
  runtime.gl_ztrick = ri.Cvar_Get("gl_ztrick", "0", 0);
  runtime.gl_finish = ri.Cvar_Get("gl_finish", "0", CVAR_ARCHIVE);
  runtime.gl_clear = ri.Cvar_Get("gl_clear", "0", 0);
  runtime.gl_cull = ri.Cvar_Get("gl_cull", "1", 0);
  runtime.gl_polyblend = ri.Cvar_Get("gl_polyblend", "1", 0);
  runtime.gl_flashblend = ri.Cvar_Get("gl_flashblend", "0", 0);
  runtime.gl_playermip = ri.Cvar_Get("gl_playermip", "0", 0);
  runtime.gl_monolightmap = ri.Cvar_Get("gl_monolightmap", "0", 0);
  runtime.gl_driver = ri.Cvar_Get("gl_driver", "opengl32", CVAR_ARCHIVE);
  runtime.gl_texturemode = ri.Cvar_Get("gl_texturemode", "GL_LINEAR_MIPMAP_NEAREST", CVAR_ARCHIVE);
  runtime.gl_texturealphamode = ri.Cvar_Get("gl_texturealphamode", "default", CVAR_ARCHIVE);
  runtime.gl_texturesolidmode = ri.Cvar_Get("gl_texturesolidmode", "default", CVAR_ARCHIVE);
  runtime.gl_lockpvs = ri.Cvar_Get("gl_lockpvs", "0", 0);
  runtime.gl_ext_swapinterval = ri.Cvar_Get("gl_ext_swapinterval", "1", CVAR_ARCHIVE);
  runtime.gl_ext_palettedtexture = ri.Cvar_Get("gl_ext_palettedtexture", "1", CVAR_ARCHIVE);
  runtime.gl_ext_multitexture = ri.Cvar_Get("gl_ext_multitexture", "1", CVAR_ARCHIVE);
  runtime.gl_ext_pointparameters = ri.Cvar_Get("gl_ext_pointparameters", "1", CVAR_ARCHIVE);
  runtime.gl_ext_compiled_vertex_array = ri.Cvar_Get("gl_ext_compiled_vertex_array", "1", CVAR_ARCHIVE);
  runtime.gl_drawbuffer = ri.Cvar_Get("gl_drawbuffer", "GL_BACK", 0);
  runtime.gl_swapinterval = ri.Cvar_Get("gl_swapinterval", "1", CVAR_ARCHIVE);
  runtime.gl_saturatelighting = ri.Cvar_Get("gl_saturatelighting", "0", 0);
  runtime.gl_3dlabs_broken = ri.Cvar_Get("gl_3dlabs_broken", "1", CVAR_ARCHIVE);
  runtime.vid_fullscreen = ri.Cvar_Get("vid_fullscreen", "0", CVAR_ARCHIVE);
  runtime.vid_gamma = ri.Cvar_Get("vid_gamma", "1.0", CVAR_ARCHIVE);
  runtime.vid_ref = ri.Cvar_Get("vid_ref", "soft", CVAR_ARCHIVE);

  ri.Cmd_AddCommand("imagelist", commands.imagelist ?? (() => {}));
  ri.Cmd_AddCommand("screenshot", commands.screenshot ?? (() => {}));
  ri.Cmd_AddCommand("modellist", commands.modellist ?? (() => {}));
  ri.Cmd_AddCommand("gl_strings", commands.gl_strings ?? (() => {}));
}

/**
 * Original name: R_Init
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Registers cvars/commands, initializes platform GL bindings and executes the renderer bootstrap sequence.
 */
export function R_Init(
  runtime: GlRmainRuntime,
  ri: refimport_t,
  hinstance: unknown,
  hWnd: unknown,
  commands: Parameters<typeof R_Register>[2] = {}
): number {
  runtime.hooks.scaleTurbulence?.(0.5);
  ri.Con_Printf(PRINT_ALL, `ref_gl version: ${REF_VERSION}\n`);
  runtime.hooks.drawGetPalette?.();
  resetBootstrapRuntimeState(runtime);

  R_Register(runtime, ri, commands);

  const driver = runtime.gl_driver?.string ?? "opengl32";
  if (runtime.hooks.qglInit && !runtime.hooks.qglInit(driver)) {
    runtime.hooks.qglShutdown?.();
    ri.Con_Printf(PRINT_ALL, `ref_gl::R_Init() - could not load "${driver}"\n`);
    return -1;
  }

  if (runtime.hooks.glimpInit && !runtime.hooks.glimpInit(hinstance, hWnd)) {
    runtime.hooks.qglShutdown?.();
    return -1;
  }

  runtime.gl_state.prev_mode = 3;
  if (!R_SetMode(runtime, ri)) {
    runtime.hooks.qglShutdown?.();
    ri.Con_Printf(PRINT_ALL, "ref_gl::R_Init() - could not R_SetMode()\n");
    return -1;
  }

  ri.Vid_MenuInit();
  const strings = runtime.hooks.getGlStrings?.() ?? null;
  runtime.gl_vendor_string = strings?.vendor ?? "";
  runtime.gl_renderer_string = strings?.renderer ?? "";
  runtime.gl_version_string = strings?.version ?? "";
  runtime.gl_extensions_string = strings?.extensions ?? "";
  ri.Con_Printf(PRINT_ALL, `GL_VENDOR: ${runtime.gl_vendor_string}\n`);
  ri.Con_Printf(PRINT_ALL, `GL_RENDERER: ${runtime.gl_renderer_string}\n`);
  ri.Con_Printf(PRINT_ALL, `GL_VERSION: ${runtime.gl_version_string}\n`);
  ri.Con_Printf(PRINT_ALL, `GL_EXTENSIONS: ${runtime.gl_extensions_string}\n`);

  runtime.gl_renderer = detectRendererFlags(runtime.gl_renderer_string, runtime.gl_vendor_string);
  applyRendererSpecificDefaults(runtime, ri);
  if ((runtime.gl_renderer & GL_RENDERER_3DLABS) !== 0) {
    runtime.gl_allow_cds = (runtime.gl_3dlabs_broken?.value ?? 0) === 0;
  } else {
    runtime.gl_allow_cds = true;
  }

  ri.Con_Printf(PRINT_ALL, runtime.gl_allow_cds ? "...allowing CDS\n" : "...disabling CDS\n");
  detectBackendExtensions(runtime, ri);
  runtime.hooks.glSetDefaultState?.();
  runtime.hooks.glInitImages?.();
  runtime.hooks.modInit?.();
  runtime.hooks.rInitParticleTexture?.();
  runtime.hooks.drawInitLocal?.();
  reportBootstrapGlError(runtime, ri);
  return 0;
}

/**
 * Original name: R_SetMode
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Resolves fullscreen/mode changes through the platform `GLimp_SetMode` hook and preserves fallback logic.
 */
export function R_SetMode(runtime: GlRmainRuntime, ri: refimport_t): boolean {
  const vidFullscreen = runtime.vid_fullscreen;
  const glMode = runtime.gl_mode;
  if (!vidFullscreen || !glMode) {
    throw new Error("R_SetMode: required cvars are not registered");
  }

  if (vidFullscreen.modified && !runtime.gl_allow_cds) {
    ri.Con_Printf(PRINT_ALL, "R_SetMode() - CDS not allowed with this driver\n");
    ri.Cvar_SetValue("vid_fullscreen", vidFullscreen.value ? 0 : 1);
    vidFullscreen.modified = false;
  }

  const fullscreen = Boolean(vidFullscreen.value);
  vidFullscreen.modified = false;
  glMode.modified = false;

  const setMode = runtime.hooks.glimpSetMode;
  if (!setMode) {
    return true;
  }

  let result = setMode(runtime.vid.width, runtime.vid.height, glMode.value, fullscreen);
  if ((result.err as number) === rserr_t.rserr_ok) {
    runtime.vid.width = result.width;
    runtime.vid.height = result.height;
    runtime.gl_state.prev_mode = glMode.value;
    return true;
  }

  if ((result.err as number) === rserr_t.rserr_invalid_fullscreen) {
    ri.Cvar_SetValue("vid_fullscreen", 0);
    vidFullscreen.modified = false;
    ri.Con_Printf(PRINT_ALL, "ref_gl::R_SetMode() - fullscreen unavailable in this mode\n");
    result = setMode(runtime.vid.width, runtime.vid.height, glMode.value, false);
    if ((result.err as number) === rserr_t.rserr_ok) {
      runtime.vid.width = result.width;
      runtime.vid.height = result.height;
      return true;
    }
  } else if ((result.err as number) === rserr_t.rserr_invalid_mode) {
    ri.Cvar_SetValue("gl_mode", runtime.gl_state.prev_mode);
    glMode.modified = false;
    ri.Con_Printf(PRINT_ALL, "ref_gl::R_SetMode() - invalid mode\n");
  }

  result = setMode(runtime.vid.width, runtime.vid.height, runtime.gl_state.prev_mode, false);
  if ((result.err as number) !== rserr_t.rserr_ok) {
    ri.Con_Printf(PRINT_ALL, "ref_gl::R_SetMode() - could not revert to safe mode\n");
    return false;
  }

  runtime.vid.width = result.width;
  runtime.vid.height = result.height;
  return true;
}

/**
 * Original name: R_Shutdown
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Unregisters renderer console commands and forwards shutdown to dependent subsystems through hooks.
 */
export function R_Shutdown(runtime: GlRmainRuntime, ri: refimport_t): void {
  ri.Cmd_RemoveCommand("modellist");
  ri.Cmd_RemoveCommand("screenshot");
  ri.Cmd_RemoveCommand("imagelist");
  ri.Cmd_RemoveCommand("gl_strings");
  runtime.hooks.modFreeAll?.();
  runtime.hooks.glShutdownImages?.();
  runtime.hooks.glimpShutdown?.();
  runtime.hooks.qglShutdown?.();
  resetBootstrapRuntimeState(runtime);
  runtime.ri = null;
  runtime.currententity = null;
  runtime.currentmodel = null;
  runtime.r_newrefdef = null;
}

/**
 * Original name: GetRefAPI
 * Source: ref_gl/gl_rmain.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Exposes the refresh export table consumed by the client runtime.
 */
export function GetRefAPI(runtime: GlRmainRuntime, rimp: refimport_t, hooks: GlRmainRefApiHooks): refexport_t {
  runtime.ri = rimp;
  hooks.swapInit?.();
  const commandHooks = {
    ...(hooks.imagelistCommand ? { imagelist: hooks.imagelistCommand } : {}),
    ...(hooks.screenshotCommand ? { screenshot: hooks.screenshotCommand } : {}),
    ...(hooks.modellistCommand ? { modellist: hooks.modellistCommand } : {}),
    ...(hooks.glStringsCommand ? { gl_strings: hooks.glStringsCommand } : {})
  };
  return {
    api_version: API_VERSION,
    Init: (hinstance: unknown, wndproc: unknown) => R_Init(runtime, rimp, hinstance, wndproc, commandHooks) >= 0,
    Shutdown: () => R_Shutdown(runtime, rimp),
    BeginRegistration: (map: string) => hooks.beginRegistration?.(map),
    RegisterModel: (name: string) => hooks.registerModel?.(name) ?? null,
    RegisterSkin: (name: string) => hooks.registerSkin?.(name) ?? null,
    RegisterPic: (name: string) => hooks.registerPic?.(name) ?? null,
    SetSky: (name: string, rotate: number, axis: vec3_t) => hooks.setSky?.(name, rotate, axis),
    EndRegistration: () => hooks.endRegistration?.(),
    RenderFrame: (fd: refdef_t) => R_RenderFrame(runtime, fd),
    DrawGetPicSize: (name: string) => hooks.drawGetPicSize?.(name) ?? { width: 0, height: 0 },
    DrawPic: (x: number, y: number, name: string) => hooks.drawPic?.(x, y, name),
    DrawStretchPic: (x: number, y: number, w: number, h: number, name: string) => hooks.drawStretchPic?.(x, y, w, h, name),
    DrawChar: (x: number, y: number, c: number) => hooks.drawChar?.(x, y, c),
    DrawTileClear: (x: number, y: number, w: number, h: number, name: string) => hooks.drawTileClear?.(x, y, w, h, name),
    DrawFill: (x: number, y: number, w: number, h: number, c: number) => hooks.drawFill?.(x, y, w, h, c),
    DrawFadeScreen: () => hooks.drawFadeScreen?.(),
    DrawStretchRaw: (x: number, y: number, w: number, h: number, cols: number, rows: number, data: Uint8Array) =>
      hooks.drawStretchRaw?.(x, y, w, h, cols, rows, data),
    CinematicSetPalette: (palette: Uint8Array | null) => R_SetPalette(runtime, palette),
    BeginFrame: (camera_separation: number) => R_BeginFrame(runtime, camera_separation),
    EndFrame: () => {
      runtime.hooks.glimpEndFrame?.();
      hooks.endFrame?.();
    },
    AppActivate: (activate: boolean) => {
      runtime.hooks.glimpAppActivate?.(activate);
      hooks.appActivate?.(activate);
    }
  };
}

/**
 * Original name: R_Init renderer detection block
 * Source: ref_gl/gl_rmain.c
 * Category: Adapter
 * Purpose: Extract the renderer/vendor string classification used during GL bootstrap.
 */
function detectRendererFlags(rendererString: string, vendorString: string): number {
  const renderer = rendererString.toLowerCase();
  const vendor = vendorString.toLowerCase();

  if (renderer.includes("voodoo")) {
    return renderer.includes("rush") ? GL_RENDERER_VOODOO_RUSH : GL_RENDERER_VOODOO;
  }
  if (vendor.includes("sgi")) {
    return GL_RENDERER_SGI;
  }
  if (renderer.includes("permedia")) {
    return GL_RENDERER_PERMEDIA2;
  }
  if (renderer.includes("glint")) {
    return GL_RENDERER_GLINT_MX;
  }
  if (renderer.includes("glzicd")) {
    return GL_RENDERER_REALIZM;
  }
  if (renderer.includes("gdi")) {
    return GL_RENDERER_MCD;
  }
  if (renderer.includes("pcx2")) {
    return GL_RENDERER_PCX2;
  }
  if (renderer.includes("verite")) {
    return GL_RENDERER_RENDITION;
  }
  if (renderer.includes("dypic")) {
    return GL_RENDERER_DYPIC;
  }
  if (renderer.includes("intergraph")) {
    return GL_RENDERER_INTERGRAPH;
  }
  if (renderer.includes("powervr")) {
    return GL_RENDERER_POWERVR;
  }

  return GL_RENDERER_OTHER;
}

/**
 * Original name: R_Init renderer default block
 * Source: ref_gl/gl_rmain.c
 * Category: Adapter
 * Purpose: Apply the cvar defaults that the original bootstrap chooses from the detected renderer.
 */
function applyRendererSpecificDefaults(runtime: GlRmainRuntime, ri: refimport_t): void {
  const monolightmapMode = runtime.gl_monolightmap?.string[1]?.toUpperCase() ?? "\0";
  if (monolightmapMode !== "F") {
    if (runtime.gl_renderer === GL_RENDERER_PERMEDIA2) {
      ri.Cvar_Set("gl_monolightmap", "A");
      ri.Con_Printf(PRINT_ALL, "...using gl_monolightmap 'a'\n");
    } else {
      ri.Cvar_Set("gl_monolightmap", "0");
    }
  }

  if ((runtime.gl_renderer & GL_RENDERER_POWERVR) !== 0) {
    ri.Cvar_Set("scr_drawall", "1");
  } else {
    ri.Cvar_Set("scr_drawall", "0");
  }

  if (runtime.gl_renderer === GL_RENDERER_MCD) {
    ri.Cvar_SetValue("gl_finish", 1);
    if (runtime.gl_finish) {
      runtime.gl_finish.value = 1;
      runtime.gl_finish.string = "1";
    }
  }
}

/**
 * Original name: R_Init extension detection block
 * Source: ref_gl/gl_rmain.c
 * Category: Adapter
 * Purpose: Extract extension probing and backend proc resolution from the original GL bootstrap.
 */
function detectBackendExtensions(runtime: GlRmainRuntime, ri: refimport_t): void {
  const extensions = runtime.gl_extensions_string;
  runtime.qglLockArraysEXT = false;
  runtime.qglUnlockArraysEXT = false;
  runtime.qwglSwapIntervalEXT = false;
  runtime.qglPointParameterfEXT = false;
  runtime.qglPointParameterfvEXT = false;
  runtime.qglColorTableEXT = false;
  runtime.qglMTexCoord2fSGIS = false;
  runtime.qglSelectTextureSGIS = false;

  if (hasExtension(extensions, "GL_EXT_compiled_vertex_array") || hasExtension(extensions, "GL_SGI_compiled_vertex_array")) {
    ri.Con_Printf(PRINT_ALL, "...enabling GL_EXT_compiled_vertex_array\n");
    runtime.qglLockArraysEXT = isBackendProcResolved(runtime, "glLockArraysEXT");
    runtime.qglUnlockArraysEXT = isBackendProcResolved(runtime, "glUnlockArraysEXT");
  } else {
    ri.Con_Printf(PRINT_ALL, "...GL_EXT_compiled_vertex_array not found\n");
  }

  if (hasExtension(extensions, "WGL_EXT_swap_control")) {
    runtime.qwglSwapIntervalEXT = isBackendProcResolved(runtime, "wglSwapIntervalEXT");
    ri.Con_Printf(PRINT_ALL, "...enabling WGL_EXT_swap_control\n");
  } else {
    ri.Con_Printf(PRINT_ALL, "...WGL_EXT_swap_control not found\n");
  }

  if (hasExtension(extensions, "GL_EXT_point_parameters")) {
    if (runtime.gl_ext_pointparameters?.value) {
      runtime.qglPointParameterfEXT = isBackendProcResolved(runtime, "glPointParameterfEXT");
      runtime.qglPointParameterfvEXT = isBackendProcResolved(runtime, "glPointParameterfvEXT");
      ri.Con_Printf(PRINT_ALL, "...using GL_EXT_point_parameters\n");
    } else {
      ri.Con_Printf(PRINT_ALL, "...ignoring GL_EXT_point_parameters\n");
    }
  } else {
    ri.Con_Printf(PRINT_ALL, "...GL_EXT_point_parameters not found\n");
  }

  if (hasExtension(extensions, "GL_EXT_paletted_texture") && hasExtension(extensions, "GL_EXT_shared_texture_palette")) {
    if (runtime.gl_ext_palettedtexture?.value) {
      runtime.qglColorTableEXT = isBackendProcResolved(runtime, "glColorTableEXT");
      ri.Con_Printf(PRINT_ALL, "...using GL_EXT_shared_texture_palette\n");
    } else {
      ri.Con_Printf(PRINT_ALL, "...ignoring GL_EXT_shared_texture_palette\n");
    }
  } else {
    ri.Con_Printf(PRINT_ALL, "...GL_EXT_shared_texture_palette not found\n");
  }

  if (hasExtension(extensions, "GL_SGIS_multitexture")) {
    if (runtime.gl_ext_multitexture?.value) {
      runtime.qglMTexCoord2fSGIS = isBackendProcResolved(runtime, "glMTexCoord2fSGIS");
      runtime.qglSelectTextureSGIS = isBackendProcResolved(runtime, "glSelectTextureSGIS");
      ri.Con_Printf(PRINT_ALL, "...using GL_SGIS_multitexture\n");
    } else {
      ri.Con_Printf(PRINT_ALL, "...ignoring GL_SGIS_multitexture\n");
    }
  } else {
    ri.Con_Printf(PRINT_ALL, "...GL_SGIS_multitexture not found\n");
  }
}

/**
 * Original name: R_Init extension strstr checks
 * Source: ref_gl/gl_rmain.c
 * Category: Adapter
 * Purpose: Keep the original extension substring checks explicit in TS.
 */
function hasExtension(extensions: string, extension: string): boolean {
  return extensions.includes(extension);
}

/**
 * Original name: N/A
 * Source: N/A (renderer backend hook adapter)
 * Category: New
 * Purpose: Convert optional WebGL/backend proc resolution into boolean runtime flags.
 */
function isBackendProcResolved(runtime: GlRmainRuntime, name: string): boolean {
  return typeof runtime.hooks.resolveBackendProc?.(name) === "function";
}

/**
 * Original name: N/A
 * Source: N/A (renderer bootstrap state reset)
 * Category: New
 * Purpose: Reset TS runtime bootstrap fields that are global variables/function pointers in the C renderer.
 */
function resetBootstrapRuntimeState(runtime: GlRmainRuntime): void {
  runtime.gl_state.camera_separation = 0;
  runtime.gl_state.stereo_enabled = false;
  runtime.gl_state.current_draw_buffer = null;
  runtime.qglLockArraysEXT = false;
  runtime.qglUnlockArraysEXT = false;
  runtime.qwglSwapIntervalEXT = false;
  runtime.qglPointParameterfEXT = false;
  runtime.qglPointParameterfvEXT = false;
  runtime.qglColorTableEXT = false;
  runtime.qglMTexCoord2fSGIS = false;
  runtime.qglSelectTextureSGIS = false;
}

/**
 * Original name: R_Init qglGetError block
 * Source: ref_gl/gl_rmain.c
 * Category: Adapter
 * Purpose: Preserve the original bootstrap GL error report through renderer hooks.
 */
function reportBootstrapGlError(runtime: GlRmainRuntime, ri: refimport_t): void {
  const glError = runtime.hooks.getGlError?.();
  if (glError == null || glError === 0) {
    return;
  }

  ri.Con_Printf(PRINT_ALL, `glGetError() = 0x${glError.toString(16)}\n`);
}

/**
 * Original name: R_SetupGL modelview matrix block
 * Source: ref_gl/gl_rmain.c
 * Category: Adapter
 * Purpose: Build the modelview matrix that the C renderer produced through GL matrix calls.
 */
function buildWorldMatrix(vieworg: vec3_t, viewangles: vec3_t): Float32Array {
  const radians = {
    pitch: (-viewangles[0] * Math.PI) / 180,
    yaw: (-viewangles[1] * Math.PI) / 180,
    roll: (-viewangles[2] * Math.PI) / 180
  };

  const sx = Math.sin(radians.roll);
  const cx = Math.cos(radians.roll);
  const sy = Math.sin(radians.pitch);
  const cy = Math.cos(radians.pitch);
  const sz = Math.sin(radians.yaw);
  const cz = Math.cos(radians.yaw);

  const rx = new Float32Array([
    1, 0, 0, 0,
    0, cx, -sx, 0,
    0, sx, cx, 0,
    0, 0, 0, 1
  ]);
  const ry = new Float32Array([
    cy, 0, sy, 0,
    0, 1, 0, 0,
    -sy, 0, cy, 0,
    0, 0, 0, 1
  ]);
  const rz = new Float32Array([
    cz, -sz, 0, 0,
    sz, cz, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ]);

  const base = multiplyMat4(multiplyMat4(rz, ry), rx);
  const orientX = rotationMat4((90 * Math.PI) / 180, [1, 0, 0]);
  const orientZ = rotationMat4((90 * Math.PI) / 180, [0, 0, 1]);
  const translated = translationMat4([-vieworg[0], -vieworg[1], -vieworg[2]]);
  return multiplyMat4(multiplyMat4(multiplyMat4(orientX, orientZ), base), translated);
}

/**
 * Original name: N/A
 * Source: N/A (renderer matrix helper)
 * Category: New
 * Purpose: Create a 4x4 rotation matrix for the TS-side modelview adapter.
 */
function rotationMat4(angle: number, axis: vec3_t): Float32Array {
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;

  return new Float32Array([
    t * x * x + c, t * x * y - s * z, t * x * z + s * y, 0,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x, 0,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c, 0,
    0, 0, 0, 1
  ]);
}

/**
 * Original name: N/A
 * Source: N/A (renderer matrix helper)
 * Category: New
 * Purpose: Create a 4x4 translation matrix for the TS-side modelview adapter.
 */
function translationMat4(offset: vec3_t): Float32Array {
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    offset[0], offset[1], offset[2], 1
  ]);
}

/**
 * Original name: N/A
 * Source: N/A (renderer matrix helper)
 * Category: New
 * Purpose: Multiply 4x4 matrices used by the TS-side modelview adapter.
 */
function multiplyMat4(left: Float32Array, right: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      out[row * 4 + column] =
        left[row * 4] * right[column] +
        left[row * 4 + 1] * right[column + 4] +
        left[row * 4 + 2] * right[column + 8] +
        left[row * 4 + 3] * right[column + 12];
    }
  }
  return out;
}

/**
 * Original name: N/A
 * Source: N/A (renderer frame snapshot helper)
 * Category: New
 * Purpose: Snapshot refdef input so the renderer runtime owns stable per-frame data.
 */
function cloneRefdef(fd: refdef_t): refdef_t {
  return {
    ...fd,
    vieworg: [...fd.vieworg],
    viewangles: [...fd.viewangles],
    blend: [...fd.blend] as [number, number, number, number],
    areabits: fd.areabits ? fd.areabits.slice() : null,
    lightstyles: fd.lightstyles.map((style) => ({ rgb: [...style.rgb] as [number, number, number], white: style.white })),
    entities: fd.entities.map((entity) => ({
      ...entity,
      angles: [...entity.angles],
      origin: [...entity.origin],
      oldorigin: [...entity.oldorigin]
    })),
    dlights: fd.dlights.map((light) => ({
      origin: [...light.origin],
      color: [...light.color],
      intensity: light.intensity
    })),
    particles: fd.particles.map((particle) => ({
      origin: [...particle.origin],
      color: particle.color,
      alpha: particle.alpha
    }))
  };
}

/**
 * Original name: N/A
 * Source: N/A (renderer runtime factory helper)
 * Category: New
 * Purpose: Initialize a TS frustum plane object for runtime state construction.
 */
function createPlane(): cplane_t {
  return {
    normal: [0, 0, 0],
    dist: 0,
    type: 0,
    signbits: 0,
    pad: [0, 0]
  };
}

/**
 * Original name: ri.Sys_Error call sites
 * Source: ref_gl/gl_rmain.c
 * Category: Adapter
 * Purpose: Route fatal renderer errors through the injected host hook or throw in standalone tests.
 */
function failSysError(runtime: GlRmainRuntime, level: number, message: string): never {
  if (runtime.hooks.sysError) {
    return runtime.hooks.sysError(level, message);
  }
  throw new Error(message);
}
