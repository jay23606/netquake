/**
 * File: gl_local.ts
 * Source: Quake II original / ref_gl/gl_local.h
 * Purpose: Port the shared GL renderer declarations, constants and global state exposed by the original refresh header.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Replaces mutable C globals with an explicit context object.
 * - Reuses already-ported declarations from `client/ref.h`, `client/vid.h`, `gl_image.c`, `gl_model.h` and `gl_rsurf.c`.
 * - Leaves concrete function implementations in their dedicated source-attachment modules instead of duplicating stubs here.
 *
 * Notes:
 * - This file is the principal attachment point for `ref_gl/gl_local.h`.
 * - It gathers the header-visible renderer state that is shared across `gl_image.c`, `gl_draw.c`,
 *   `gl_rsurf.c`, `gl_light.c`, `gl_rmain.c` and the platform-specific `GLimp_*` layer.
 */

import type { cvar_t } from "../../qcommon/src/cvar.js";
import { MAX_QPATH } from "../../qcommon/src/index.js";
import type { cplane_t, qboolean, vec3_t } from "../../qcommon/src/index.js";
import type { dlight_t, entity_t, particle_t, refdef_t, refimport_t } from "../../client/src/ref.js";
import type { GlImage } from "./gl_image.js";
import type { glpoly_t, model_t, msurface_t, mnode_t } from "./gl_model.js";

export {
  MAX_GLTEXTURES,
  TEXNUM_IMAGES,
  TEXNUM_LIGHTMAPS,
  TEXNUM_SCRAPS,
  imagetype_t
} from "./gl_image.js";

/**
 * Original name: REF_VERSION
 * Source: ref_gl/gl_local.h
 * Category: Ported
 * Fidelity level: Strict
 */
export const REF_VERSION = "GL 0.01";

/**
 * Original name: PITCH / YAW / ROLL
 * Source: ref_gl/gl_local.h
 * Category: Ported
 * Fidelity level: Strict
 */
export const PITCH = 0;
export const YAW = 1;
export const ROLL = 2;

/**
 * Original name: MAX_LBM_HEIGHT / BACKFACE_EPSILON
 * Source: ref_gl/gl_local.h
 * Category: Ported
 * Fidelity level: Strict
 */
export const MAX_LBM_HEIGHT = 480;
export const BACKFACE_EPSILON = 0.01;

/**
 * Original name: GL_RENDERER_*
 * Source: ref_gl/gl_local.h
 * Category: Ported
 * Fidelity level: Strict
 */
export const GL_RENDERER_VOODOO = 0x00000001;
export const GL_RENDERER_VOODOO2 = 0x00000002;
export const GL_RENDERER_VOODOO_RUSH = 0x00000004;
export const GL_RENDERER_BANSHEE = 0x00000008;
export const GL_RENDERER_3DFX = 0x0000000f;

export const GL_RENDERER_PCX1 = 0x00000010;
export const GL_RENDERER_PCX2 = 0x00000020;
export const GL_RENDERER_PMX = 0x00000040;
export const GL_RENDERER_POWERVR = 0x00000070;

export const GL_RENDERER_PERMEDIA2 = 0x00000100;
export const GL_RENDERER_GLINT_MX = 0x00000200;
export const GL_RENDERER_GLINT_TX = 0x00000400;
export const GL_RENDERER_3DLABS_MISC = 0x00000800;
export const GL_RENDERER_3DLABS = 0x00000f00;

export const GL_RENDERER_REALIZM = 0x00001000;
export const GL_RENDERER_REALIZM2 = 0x00002000;
export const GL_RENDERER_INTERGRAPH = 0x00003000;

export const GL_RENDERER_3DPRO = 0x00004000;
export const GL_RENDERER_REAL3D = 0x00008000;
export const GL_RENDERER_RIVA128 = 0x00010000;
export const GL_RENDERER_DYPIC = 0x00020000;

export const GL_RENDERER_V1000 = 0x00040000;
export const GL_RENDERER_V2100 = 0x00080000;
export const GL_RENDERER_V2200 = 0x00100000;
export const GL_RENDERER_RENDITION = 0x001c0000;

export const GL_RENDERER_O2 = 0x00100000;
export const GL_RENDERER_IMPACT = 0x00200000;
export const GL_RENDERER_RE = 0x00400000;
export const GL_RENDERER_IR = 0x00800000;
export const GL_RENDERER_SGI = 0x00f00000;

export const GL_RENDERER_MCD = 0x01000000;
export const GL_RENDERER_OTHER = 0x80000000;

/**
 * Original name: viddef_t
 * Source: ref_gl/gl_local.h
 * Category: Ported
 * Fidelity level: Strict
 */
export interface viddef_t {
  width: number;
  height: number;
}

/**
 * Original name: glvert_t
 * Source: ref_gl/gl_local.h
 * Category: Ported
 * Fidelity level: Strict
 */
export interface glvert_t {
  x: number;
  y: number;
  z: number;
  s: number;
  t: number;
  r: number;
  g: number;
  b: number;
}

/**
 * Original name: rserr_t
 * Source: ref_gl/gl_local.h
 * Category: Ported
 * Fidelity level: Strict
 */
export enum rserr_t {
  rserr_ok,
  rserr_invalid_fullscreen,
  rserr_invalid_mode,
  rserr_unknown
}

/**
 * Original name: glconfig_t
 * Source: ref_gl/gl_local.h
 * Category: Ported
 * Fidelity level: Strict
 */
export interface glconfig_t {
  renderer: number;
  renderer_string: string;
  vendor_string: string;
  version_string: string;
  extensions_string: string;
  allow_cds: qboolean;
}

/**
 * Original name: glstate_t
 * Source: ref_gl/gl_local.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Porting notes:
 * - Uses `Uint8Array` for gamma tables and the optional 16-to-8 lookup table.
 */
export interface glstate_t {
  inverse_intensity: number;
  fullscreen: qboolean;
  prev_mode: number;
  d_16to8table: Uint8Array | null;
  lightmap_textures: number;
  currenttextures: [number, number];
  currenttmu: number;
  camera_separation: number;
  stereo_enabled: qboolean;
  originalRedGammaTable: Uint8Array;
  originalGreenGammaTable: Uint8Array;
  originalBlueGammaTable: Uint8Array;
}

/**
 * Original name: N/A
 * Source: N/A (renderer context object)
 * Category: New
 * Purpose: Group the header-visible `gl_local.h` globals behind one explicit renderer context.
 *
 * Constraints:
 * - Must keep the original global naming recognizable.
 * - Must not absorb the implementation details that belong to dedicated source ports.
 */
export interface GlLocalContext {
  vid: viddef_t;
  gltextures: GlImage[];
  numgltextures: number;
  r_notexture: GlImage | null;
  r_particletexture: GlImage | null;
  currententity: entity_t | null;
  currentmodel: model_t | null;
  r_visframecount: number;
  r_framecount: number;
  frustum: [cplane_t, cplane_t, cplane_t, cplane_t];
  c_brush_polys: number;
  c_alias_polys: number;
  gl_filter_min: number;
  gl_filter_max: number;
  vup: vec3_t;
  vpn: vec3_t;
  vright: vec3_t;
  r_origin: vec3_t;
  r_newrefdef: refdef_t | null;
  r_viewcluster: number;
  r_viewcluster2: number;
  r_oldviewcluster: number;
  r_oldviewcluster2: number;
  r_norefresh: cvar_t | null;
  r_lefthand: cvar_t | null;
  r_drawentities: cvar_t | null;
  r_drawworld: cvar_t | null;
  r_speeds: cvar_t | null;
  r_fullbright: cvar_t | null;
  r_novis: cvar_t | null;
  r_nocull: cvar_t | null;
  r_lerpmodels: cvar_t | null;
  r_lightlevel: cvar_t | null;
  gl_vertex_arrays: cvar_t | null;
  gl_ext_swapinterval: cvar_t | null;
  gl_ext_palettedtexture: cvar_t | null;
  gl_ext_multitexture: cvar_t | null;
  gl_ext_pointparameters: cvar_t | null;
  gl_ext_compiled_vertex_array: cvar_t | null;
  gl_particle_min_size: cvar_t | null;
  gl_particle_max_size: cvar_t | null;
  gl_particle_size: cvar_t | null;
  gl_particle_att_a: cvar_t | null;
  gl_particle_att_b: cvar_t | null;
  gl_particle_att_c: cvar_t | null;
  gl_nosubimage: cvar_t | null;
  gl_bitdepth: cvar_t | null;
  gl_mode: cvar_t | null;
  gl_log: cvar_t | null;
  gl_lightmap: cvar_t | null;
  gl_shadows: cvar_t | null;
  gl_dynamic: cvar_t | null;
  gl_monolightmap: cvar_t | null;
  gl_nobind: cvar_t | null;
  gl_round_down: cvar_t | null;
  gl_picmip: cvar_t | null;
  gl_skymip: cvar_t | null;
  gl_showtris: cvar_t | null;
  gl_finish: cvar_t | null;
  gl_ztrick: cvar_t | null;
  gl_clear: cvar_t | null;
  gl_cull: cvar_t | null;
  gl_poly: cvar_t | null;
  gl_texsort: cvar_t | null;
  gl_polyblend: cvar_t | null;
  gl_flashblend: cvar_t | null;
  gl_lightmaptype: cvar_t | null;
  gl_modulate: cvar_t | null;
  gl_playermip: cvar_t | null;
  gl_drawbuffer: cvar_t | null;
  gl_3dlabs_broken: cvar_t | null;
  gl_driver: cvar_t | null;
  gl_swapinterval: cvar_t | null;
  gl_texturemode: cvar_t | null;
  gl_texturealphamode: cvar_t | null;
  gl_texturesolidmode: cvar_t | null;
  gl_saturatelighting: cvar_t | null;
  gl_lockpvs: cvar_t | null;
  vid_fullscreen: cvar_t | null;
  vid_gamma: cvar_t | null;
  intensity: cvar_t | null;
  gl_lightmap_format: number;
  gl_solid_format: number;
  gl_alpha_format: number;
  gl_tex_solid_format: number;
  gl_tex_alpha_format: number;
  c_visible_lightmaps: number;
  c_visible_textures: number;
  r_world_matrix: Float32Array;
  r_worldmodel: model_t | null;
  d_8to24table: Uint32Array;
  registration_sequence: number;
  gldepthmin: number;
  gldepthmax: number;
  gl_config: glconfig_t;
  gl_state: glstate_t;
  ri: refimport_t | null;
}

/**
 * Original name: GLimp_SetMode pointer writes
 * Source: ref_gl/gl_local.h
 * Category: Adapter
 * Purpose: Represent the pointer-mutating result of `GLimp_SetMode`.
 *
 * Constraints:
 * - `err` preserves the original `rserr_t` return value.
 * - `width` and `height` preserve the dimensions written back through `int *pwidth` / `int *pheight`.
 */
export interface GlimpSetModeResult {
  err: rserr_t | number;
  width: number;
  height: number;
}

/**
 * Original name: GL_BeginRendering pointer writes
 * Source: ref_gl/gl_local.h
 * Category: Adapter
 * Purpose: Represent the viewport pointer writes performed by `GL_BeginRendering`.
 *
 * Constraints:
 * - Keeps the original `int *x`, `int *y`, `int *width`, `int *height` result shape explicit.
 */
export interface GL_BeginRenderingResult {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Original name: N/A
 * Source: N/A (renderer platform hook surface)
 * Category: New
 * Purpose: Describe the host hooks standing in for the platform-specific `GLimp_*` procedures.
 *
 * Constraints:
 * - Must preserve the split between renderer core and platform/windowing backend.
 */
export interface GlimpHooks {
  beginFrame?: (camera_separation: number) => void;
  endFrame?: () => void;
  init?: (hinstance: unknown, hWnd: unknown) => number;
  shutdown?: () => void;
  setMode?: (width: number, height: number, mode: number, fullscreen: qboolean) => GlimpSetModeResult;
  appActivate?: (active: qboolean) => void;
  enableLogging?: (enable: qboolean) => void;
  logNewFrame?: () => void;
}

/**
 * Original name: GL_BeginRendering
 * Source: ref_gl/gl_local.h
 * Category: Adapter
 * Purpose: Preserve the original `GL_BeginRendering` header signature shape.
 */
export type GL_BeginRendering_t = () => GL_BeginRenderingResult;

/**
 * Original name: GL_EndRendering
 * Source: ref_gl/gl_local.h
 * Category: Adapter
 * Purpose: Preserve the original `GL_EndRendering` header signature shape.
 */
export type GL_EndRendering_t = () => void;

/**
 * Original name: R_SwapBuffers
 * Source: ref_gl/gl_local.h
 * Category: Adapter
 * Purpose: Preserve the original `R_SwapBuffers` header signature shape.
 */
export type R_SwapBuffers_t = (v: number) => void;

/**
 * Original name: R_TranslatePlayerSkin
 * Source: ref_gl/gl_local.h
 * Category: Adapter
 * Purpose: Preserve the original `R_TranslatePlayerSkin` header signature shape.
 */
export type R_TranslatePlayerSkin_t = (playernum: number) => void;

/**
 * Original name: N/A
 * Source: N/A (renderer struct factory)
 * Category: New
 * Purpose: Create one zero-initialized `viddef_t`.
 */
export function createRendererVidDef(): viddef_t {
  return {
    width: 0,
    height: 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (renderer struct factory)
 * Category: New
 * Purpose: Create one zero-initialized `glvert_t`.
 */
export function createGlVert(): glvert_t {
  return {
    x: 0,
    y: 0,
    z: 0,
    s: 0,
    t: 0,
    r: 0,
    g: 0,
    b: 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (renderer struct factory)
 * Category: New
 * Purpose: Create one default `glconfig_t`.
 */
export function createGlConfig(): glconfig_t {
  return {
    renderer: 0,
    renderer_string: "",
    vendor_string: "",
    version_string: "",
    extensions_string: "",
    allow_cds: false
  };
}

/**
 * Original name: N/A
 * Source: N/A (renderer struct factory)
 * Category: New
 * Purpose: Create one default `glstate_t` preserving the original fixed gamma-table widths.
 */
export function createGlState(): glstate_t {
  return {
    inverse_intensity: 1,
    fullscreen: false,
    prev_mode: 0,
    d_16to8table: null,
    lightmap_textures: 0,
    currenttextures: [0, 0],
    currenttmu: 0,
    camera_separation: 0,
    stereo_enabled: false,
    originalRedGammaTable: new Uint8Array(256),
    originalGreenGammaTable: new Uint8Array(256),
    originalBlueGammaTable: new Uint8Array(256)
  };
}

/**
 * Original name: N/A
 * Source: N/A (renderer context factory)
 * Category: New
 * Purpose: Create one explicit `gl_local.h` context with zero-initialized shared renderer globals.
 */
export function createGlLocalContext(): GlLocalContext {
  return {
    vid: createRendererVidDef(),
    gltextures: [],
    numgltextures: 0,
    r_notexture: null,
    r_particletexture: null,
    currententity: null,
    currentmodel: null,
    r_visframecount: 0,
    r_framecount: 0,
    frustum: [createEmptyPlane(), createEmptyPlane(), createEmptyPlane(), createEmptyPlane()],
    c_brush_polys: 0,
    c_alias_polys: 0,
    gl_filter_min: 0,
    gl_filter_max: 0,
    vup: [0, 0, 0],
    vpn: [0, 0, 0],
    vright: [0, 0, 0],
    r_origin: [0, 0, 0],
    r_newrefdef: null,
    r_viewcluster: 0,
    r_viewcluster2: 0,
    r_oldviewcluster: 0,
    r_oldviewcluster2: 0,
    r_norefresh: null,
    r_lefthand: null,
    r_drawentities: null,
    r_drawworld: null,
    r_speeds: null,
    r_fullbright: null,
    r_novis: null,
    r_nocull: null,
    r_lerpmodels: null,
    r_lightlevel: null,
    gl_vertex_arrays: null,
    gl_ext_swapinterval: null,
    gl_ext_palettedtexture: null,
    gl_ext_multitexture: null,
    gl_ext_pointparameters: null,
    gl_ext_compiled_vertex_array: null,
    gl_particle_min_size: null,
    gl_particle_max_size: null,
    gl_particle_size: null,
    gl_particle_att_a: null,
    gl_particle_att_b: null,
    gl_particle_att_c: null,
    gl_nosubimage: null,
    gl_bitdepth: null,
    gl_mode: null,
    gl_log: null,
    gl_lightmap: null,
    gl_shadows: null,
    gl_dynamic: null,
    gl_monolightmap: null,
    gl_nobind: null,
    gl_round_down: null,
    gl_picmip: null,
    gl_skymip: null,
    gl_showtris: null,
    gl_finish: null,
    gl_ztrick: null,
    gl_clear: null,
    gl_cull: null,
    gl_poly: null,
    gl_texsort: null,
    gl_polyblend: null,
    gl_flashblend: null,
    gl_lightmaptype: null,
    gl_modulate: null,
    gl_playermip: null,
    gl_drawbuffer: null,
    gl_3dlabs_broken: null,
    gl_driver: null,
    gl_swapinterval: null,
    gl_texturemode: null,
    gl_texturealphamode: null,
    gl_texturesolidmode: null,
    gl_saturatelighting: null,
    gl_lockpvs: null,
    vid_fullscreen: null,
    vid_gamma: null,
    intensity: null,
    gl_lightmap_format: 0,
    gl_solid_format: 0,
    gl_alpha_format: 0,
    gl_tex_solid_format: 0,
    gl_tex_alpha_format: 0,
    c_visible_lightmaps: 0,
    c_visible_textures: 0,
    r_world_matrix: new Float32Array(16),
    r_worldmodel: null,
    d_8to24table: new Uint32Array(256),
    registration_sequence: 0,
    gldepthmin: 0,
    gldepthmax: 1,
    gl_config: createGlConfig(),
    gl_state: createGlState(),
    ri: null
  };
}

/**
 * Original name: N/A
 * Source: N/A (renderer validation helper)
 * Category: New
 * Purpose: Check whether one image name fits the original `name[MAX_QPATH]` budget from `image_t`.
 */
export function isGlImageNameWithinQPath(name: string): boolean {
  return name.length < MAX_QPATH;
}

/**
 * Original name: N/A
 * Source: N/A (renderer validation helper)
 * Category: New
 * Purpose: Check whether the shared frustum keeps the canonical four-plane shape from `gl_local.h`.
 */
export function hasValidFrustum(context: GlLocalContext): boolean {
  return context.frustum.length === 4;
}

/**
 * Original name: N/A
 * Source: N/A (renderer validation helper)
 * Category: New
 * Purpose: Check whether one world matrix preserves the original 4x4 float payload width.
 */
export function hasValidWorldMatrix(context: GlLocalContext): boolean {
  return context.r_world_matrix.length === 16;
}

/**
 * Original name: image_s / image_t
 * Source: ref_gl/gl_local.h
 * Category: Adapter
 * Purpose: Project original `image_s` / `image_t` handles to the concrete image manager port.
 *
 * Porting notes:
 * - `imagetype_t`, `TEXNUM_*` and `MAX_GLTEXTURES` are re-exported from `gl-image.ts` above.
 * - The owning implementation remains attached to `ref_gl/gl_image.c`; this header keeps the declaration surface traceable.
 */
export type image_t = GlImage;

/**
 * Original name: WaterWarpPolyVerts
 * Source: ref_gl/gl_local.h
 * Category: Adapter
 * Purpose: Preserve the original `WaterWarpPolyVerts` header signature shape for upcoming ports.
 */
export type WaterWarpPolyVerts_t = (p: glpoly_t) => glpoly_t | null;

/**
 * Original name: R_MarkLights
 * Source: ref_gl/gl_local.h
 * Category: Adapter
 * Purpose: Preserve the original `R_MarkLights` header signature shape for upcoming ports.
 */
export type R_MarkLights_t = (light: dlight_t, bit: number, node: mnode_t) => void;

/**
 * Original name: GL_DrawParticles
 * Source: ref_gl/gl_local.h
 * Category: Adapter
 * Purpose: Preserve the original `GL_DrawParticles` header signature shape for upcoming ports.
 */
export type GL_DrawParticles_t = (n: number, particles: readonly particle_t[], colortable: readonly number[]) => void;

/**
 * Original name: EmitWaterPolys / R_AddSkySurface
 * Source: ref_gl/gl_local.h
 * Category: Adapter
 * Purpose: Preserve the original `EmitWaterPolys` and `R_AddSkySurface` header signature shapes for upcoming ports.
 */
export type SurfaceVoidCallback = (surface: msurface_t) => void;

/**
 * Original name: N/A
 * Source: N/A (renderer struct factory)
 * Category: New
 * Purpose: Create one zero-initialized `cplane_t` for the explicit renderer context.
 */
function createEmptyPlane(): cplane_t {
  return {
    normal: [0, 0, 0],
    dist: 0,
    type: 0,
    signbits: 0,
    pad: [0, 0]
  };
}
