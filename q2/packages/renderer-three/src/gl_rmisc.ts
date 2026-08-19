/**
 * File: gl_rmisc.ts
 * Source: Quake II original / ref_gl/gl_rmisc.c
 * Purpose: Port the miscellaneous GL refresh helpers that initialize fallback textures, default state and screenshots.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Replaces direct filesystem and GL side effects with explicit hooks.
 * - Returns structured screenshot payloads instead of writing files directly.
 *
 * Notes:
 * - This file is the principal attachment point for `ref_gl/gl_rmisc.c`.
 * - `R_InitParticleTexture`, `GL_ScreenShot_f`, `GL_Strings_f`, `GL_SetDefaultState` and `GL_UpdateSwapInterval` are ported here.
 */

import { PRINT_ALL, type cvar_t } from "../../qcommon/src/index.js";
import type { GlRmainRuntime } from "./gl_rmain.js";
import {
  GL_COLOR_INDEX,
  GL_REPLACE,
  GL_SetTexturePalette,
  GL_TextureAlphaMode,
  GL_TextureMode,
  GL_TextureSolidMode,
  GL_TexEnv,
  GL_UNSIGNED_BYTE,
  type GlImage,
  type GlImageRuntime,
  imagetype_t
} from "./gl_image.js";
import { createGlState, type glconfig_t, type glstate_t, type viddef_t } from "./gl_local.js";
import { GL_SHARED_TEXTURE_PALETTE_EXT } from "./qgl.js";

/**
 * Original name: N/A
 * Source: N/A (OpenGL/WebGL numeric constants)
 * Category: New
 * Purpose: Provide the GL enum values used by the `gl_rmisc.c` backend hooks.
 */
export const GL_ALPHA_TEST = 0x0bc0;
export const GL_BLEND = 0x0be2;
export const GL_CULL_FACE = 0x0b44;
export const GL_DEPTH_TEST = 0x0b71;
export const GL_FILL = 0x1b02;
export const GL_FLAT = 0x1d00;
export const GL_FRONT = 0x0404;
export const GL_FRONT_AND_BACK = 0x0408;
export const GL_GREATER = 0x0204;
export const GL_ONE_MINUS_SRC_ALPHA = 0x0303;
export const GL_POINT_SIZE_MAX_EXT = 0x8127;
export const GL_POINT_SIZE_MIN_EXT = 0x8126;
export const GL_POINT_SMOOTH = 0x0b10;
export const GL_REPEAT = 0x2901;
export const GL_RGB = 0x1907;
export const GL_SRC_ALPHA = 0x0302;
export const GL_TEXTURE_2D = 0x0de1;
export const GL_TEXTURE_MAG_FILTER = 0x2800;
export const GL_TEXTURE_MIN_FILTER = 0x2801;
export const GL_TEXTURE_WRAP_S = 0x2802;
export const GL_TEXTURE_WRAP_T = 0x2803;
export const GL_DISTANCE_ATTENUATION_EXT = 0x8129;

/**
 * Original name: dottexture
 * Source: ref_gl/gl_rmisc.c
 * Category: Ported
 * Fidelity level: Strict
 */
const DOT_TEXTURE: readonly number[][] = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 1, 1, 0, 0, 0, 0],
  [0, 1, 1, 1, 1, 0, 0, 0],
  [0, 1, 1, 1, 1, 0, 0, 0],
  [0, 0, 1, 1, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0]
] as const;

/**
 * Original name: R_InitParticleTexture particle texture loop
 * Source: ref_gl/gl_rmisc.c
 * Category: Adapter
 * Fidelity level: Strict
 *
 * Behavior:
 * - Builds the canonical 8x8 white particle texture with alpha from `dottexture`.
 */
export function buildParticleTextureRgba(): Uint8Array {
  const particleData = new Uint8Array(8 * 8 * 4);
  for (let x = 0; x < 8; x += 1) {
    for (let y = 0; y < 8; y += 1) {
      const offset = (y * 8 + x) * 4;
      particleData[offset] = 255;
      particleData[offset + 1] = 255;
      particleData[offset + 2] = 255;
      particleData[offset + 3] = (DOT_TEXTURE[x]?.[y] ?? 0) * 255;
    }
  }
  return particleData;
}

/**
 * Original name: R_InitParticleTexture r_notexture loop
 * Source: ref_gl/gl_rmisc.c
 * Category: Adapter
 * Fidelity level: Strict
 *
 * Behavior:
 * - Builds the canonical 8x8 red opaque fallback texture used for missing textures.
 */
export function buildNoTextureRgba(): Uint8Array {
  const noTextureData = new Uint8Array(8 * 8 * 4);
  for (let x = 0; x < 8; x += 1) {
    for (let y = 0; y < 8; y += 1) {
      const offset = (y * 8 + x) * 4;
      noTextureData[offset] = (DOT_TEXTURE[x & 3]?.[y & 3] ?? 0) * 255;
      noTextureData[offset + 1] = 0;
      noTextureData[offset + 2] = 0;
      noTextureData[offset + 3] = 255;
    }
  }
  return noTextureData;
}

/**
 * Original name: N/A
 * Source: N/A (renderer backend hook contract)
 * Category: New
 * Purpose: Declare the side-effect hooks that replace direct GL, filesystem and console calls.
 */
export interface GlRmiscHooks {
  loadPic?: (
    name: string,
    pic: Uint8Array,
    width: number,
    height: number,
    type: imagetype_t,
    bits: 8 | 32
  ) => GlImage | null;
  setProtectedImages?: (notexture: GlImage | null, particletexture: GlImage | null) => void;
  print?: (printLevel: number, message: string) => void;
  readPixels?: (x: number, y: number, width: number, height: number, format: number, type: number) => Uint8Array;
  listFiles?: (directory: string) => readonly string[];
  writeFile?: (path: string, bytes: Uint8Array) => void;
  ensureDirectory?: (directory: string) => void;
  clearColor?: (red: number, green: number, blue: number, alpha: number) => void;
  cullFace?: (mode: number) => void;
  enable?: (cap: number) => void;
  disable?: (cap: number) => void;
  alphaFunc?: (func: number, ref: number) => void;
  color4f?: (red: number, green: number, blue: number, alpha: number) => void;
  polygonMode?: (face: number, mode: number) => void;
  shadeModel?: (mode: number) => void;
  texParameterf?: (target: number, pname: number, value: number) => void;
  blendFunc?: (sfactor: number, dfactor: number) => void;
  pointParameterfEXT?: (pname: number, value: number) => void;
  pointParameterfvEXT?: (pname: number, values: readonly number[]) => void;
  updateSwapInterval?: (value: number) => void;
}

/**
 * Original name: N/A
 * Source: N/A (explicit runtime container for ref_gl/gl_rmisc.c globals)
 * Category: New
 * Purpose: Hold the renderer state consumed by the miscellaneous GL refresh helpers.
 */
export interface GlRmiscRuntime {
  vid: viddef_t;
  gl_config: glconfig_t;
  gl_state: glstate_t;
  imageRuntime: GlImageRuntime | null;
  gl_texturemode: cvar_t | null;
  gl_texturealphamode: cvar_t | null;
  gl_texturesolidmode: cvar_t | null;
  gl_particle_att_a: cvar_t | null;
  gl_particle_att_b: cvar_t | null;
  gl_particle_att_c: cvar_t | null;
  gl_particle_min_size: cvar_t | null;
  gl_particle_max_size: cvar_t | null;
  gl_ext_palettedtexture: cvar_t | null;
  gl_swapinterval: cvar_t | null;
  qglPointParameterfEXT: boolean;
  qglColorTableEXT: boolean;
  hooks: GlRmiscHooks;
}

/**
 * Original name: _TargaHeader / TargaHeader
 * Source: ref_gl/gl_rmisc.c
 * Category: Ported
 * Fidelity level: Strict
 */
export interface TargaHeader {
  id_length: number;
  colormap_type: number;
  image_type: number;
  colormap_index: number;
  colormap_length: number;
  colormap_size: number;
  x_origin: number;
  y_origin: number;
  width: number;
  height: number;
  pixel_size: number;
  attributes: number;
}

/**
 * Original name: N/A
 * Source: N/A (renderer runtime adapter)
 * Category: New
 * Purpose: Create the explicit runtime object that replaces the original `gl_rmisc.c` globals.
 */
export function createGlRmiscRuntime(hooks: GlRmiscHooks = {}): GlRmiscRuntime {
  return {
    vid: { width: 0, height: 0 },
    gl_config: {
      renderer: 0,
      renderer_string: "",
      vendor_string: "",
      version_string: "",
      extensions_string: "",
      allow_cds: false
    },
    gl_state: createGlState(),
    imageRuntime: null,
    gl_texturemode: null,
    gl_texturealphamode: null,
    gl_texturesolidmode: null,
    gl_particle_att_a: null,
    gl_particle_att_b: null,
    gl_particle_att_c: null,
    gl_particle_min_size: null,
    gl_particle_max_size: null,
    gl_ext_palettedtexture: null,
    gl_swapinterval: null,
    qglPointParameterfEXT: false,
    qglColorTableEXT: false,
    hooks
  };
}

/**
 * Original name: N/A
 * Source: N/A (renderer runtime adapter)
 * Category: New
 * Purpose: Mirror the current video dimensions into the `gl_rmisc.c` runtime state.
 */
export function setRmiscVid(runtime: GlRmiscRuntime, width: number, height: number): void {
  runtime.vid.width = width;
  runtime.vid.height = height;
}

/**
 * Original name: N/A
 * Source: N/A (renderer runtime adapter)
 * Category: New
 * Purpose: Mirror GL configuration strings and flags into the `gl_rmisc.c` runtime state.
 */
export function setRmiscGlConfig(runtime: GlRmiscRuntime, config: Partial<glconfig_t>): void {
  Object.assign(runtime.gl_config, config);
}

/**
 * Original name: N/A
 * Source: N/A (renderer runtime adapter)
 * Category: New
 * Purpose: Mirror GL state flags needed by `GL_UpdateSwapInterval`.
 */
export function setRmiscGlState(runtime: GlRmiscRuntime, state: Partial<glstate_t>): void {
  Object.assign(runtime.gl_state, state);
}

/**
 * Original name: N/A
 * Source: N/A (renderer image adapter)
 * Category: New
 * Purpose: Attach the image subsystem runtime used by texture state helpers.
 */
export function setRmiscImageRuntime(runtime: GlRmiscRuntime, imageRuntime: GlImageRuntime | null): void {
  runtime.imageRuntime = imageRuntime;
}

/**
 * Original name: N/A
 * Source: N/A (renderer extension adapter)
 * Category: New
 * Purpose: Record which optional GL extension hooks are available to `GL_SetDefaultState`.
 */
export function setRmiscExtensionState(runtime: GlRmiscRuntime, options: { pointParameters: boolean; colorTable: boolean }): void {
  runtime.qglPointParameterfEXT = options.pointParameters;
  runtime.qglColorTableEXT = options.colorTable;
}

/**
 * Original name: N/A
 * Source: N/A (renderer extension adapter)
 * Category: New
 * Purpose: Mirror the backend extension procedures resolved by `R_Init` into the `gl_rmisc.c` runtime.
 *
 * Constraints:
 * - Must keep `GL_SetDefaultState` aligned with the procedures actually available on the backend.
 */
export function syncRmiscExtensionStateFromRmain(
  runtime: GlRmiscRuntime,
  rmain: Pick<GlRmainRuntime, "qglPointParameterfEXT" | "qglPointParameterfvEXT" | "qglColorTableEXT">
): void {
  runtime.qglPointParameterfEXT = rmain.qglPointParameterfEXT && rmain.qglPointParameterfvEXT;
  runtime.qglColorTableEXT = rmain.qglColorTableEXT;
}

/**
 * Original name: N/A
 * Source: N/A (renderer cvar adapter)
 * Category: New
 * Purpose: Attach the cvars consumed by texture setup, particle attenuation and swap interval code.
 */
export function setRmiscCvars(runtime: GlRmiscRuntime, cvars: Partial<Pick<GlRmiscRuntime,
  "gl_texturemode" | "gl_texturealphamode" | "gl_texturesolidmode" | "gl_particle_att_a" | "gl_particle_att_b" | "gl_particle_att_c" | "gl_particle_min_size" | "gl_particle_max_size" | "gl_ext_palettedtexture" | "gl_swapinterval"
>>): void {
  Object.assign(runtime, cvars);
}

/**
 * Original name: R_InitParticleTexture
 * Source: ref_gl/gl_rmisc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Loads the protected particle and missing-texture images using the original names, dimensions and image types.
 *
 * Porting notes:
 * - Direct writes to `r_particletexture` and `r_notexture` are surfaced through `setProtectedImages`.
 */
export function R_InitParticleTexture(runtime: GlRmiscRuntime): { particletexture: GlImage | null; notexture: GlImage | null } {
  const particleData = buildParticleTextureRgba();
  const noTextureData = buildNoTextureRgba();
  const particletexture = runtime.hooks.loadPic?.("***particle***", particleData, 8, 8, imagetype_t.it_sprite, 32) ?? null;
  const notexture = runtime.hooks.loadPic?.("***r_notexture***", noTextureData, 8, 8, imagetype_t.it_wall, 32) ?? null;

  runtime.hooks.setProtectedImages?.(notexture, particletexture);
  return { particletexture, notexture };
}

/**
 * Original name: GL_ScreenShot_f TargaHeader population
 * Source: ref_gl/gl_rmisc.c
 * Category: Adapter
 * Fidelity level: Strict
 *
 * Behavior:
 * - Builds the 18-byte uncompressed 24-bit TGA header used by screenshots.
 */
export function buildTgaHeader(width: number, height: number): Uint8Array {
  const header = new Uint8Array(18);
  header[2] = 2;
  header[12] = width & 0xff;
  header[13] = (width >> 8) & 0xff;
  header[14] = height & 0xff;
  header[15] = (height >> 8) & 0xff;
  header[16] = 24;
  return header;
}

/**
 * Original name: GL_ScreenShot_f filename loop
 * Source: ref_gl/gl_rmisc.c
 * Category: Adapter
 * Fidelity level: Strict
 *
 * Behavior:
 * - Finds the first `quake00.tga` through `quake99.tga` slot that is not already present.
 */
export function findScreenshotName(existingPaths: readonly string[]): string | null {
  const normalized = new Set(existingPaths.map((path) => path.replace(/\\/g, "/").toLowerCase()));
  for (let index = 0; index <= 99; index += 1) {
    const picname = `quake${Math.trunc(index / 10)}${index % 10}.tga`;
    if (!normalized.has(`scrnshot/${picname}`) && !normalized.has(picname.toLowerCase())) {
      return picname;
    }
  }
  return null;
}

/**
 * Original name: GL_ScreenShot_f RGB/BGR swap loop
 * Source: ref_gl/gl_rmisc.c
 * Category: Adapter
 * Fidelity level: Strict
 *
 * Behavior:
 * - Swaps each screenshot pixel from RGB to BGR before TGA output.
 */
export function swapRgbToBgr(rgb: Uint8Array): Uint8Array {
  const out = Uint8Array.from(rgb);
  for (let index = 0; index + 2 < out.length; index += 3) {
    const temp = out[index];
    out[index] = out[index + 2];
    out[index + 2] = temp;
  }
  return out;
}

/**
 * Original name: GL_ScreenShot_f
 * Source: ref_gl/gl_rmisc.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Creates the `scrnshot` directory, finds the first free Quake II screenshot name, reads RGB pixels and writes a 24-bit TGA.
 *
 * Porting notes:
 * - Filesystem and GL readback are explicit hooks.
 * - The TGA payload is returned to make browser and verification integrations deterministic.
 */
export function GL_ScreenShot_f(runtime: GlRmiscRuntime, gameDir: string): { path: string; bytes: Uint8Array } | null {
  const directory = `${gameDir.replace(/[\\/]+$/u, "")}/scrnshot`;
  runtime.hooks.ensureDirectory?.(directory);

  const picname = findScreenshotName(runtime.hooks.listFiles?.(directory) ?? []);
  if (!picname) {
    runtime.hooks.print?.(PRINT_ALL, "SCR_ScreenShot_f: Couldn't create a file\n");
    return null;
  }

  const rgbPixels = runtime.hooks.readPixels?.(0, 0, runtime.vid.width, runtime.vid.height, GL_RGB, GL_UNSIGNED_BYTE)
    ?? new Uint8Array(runtime.vid.width * runtime.vid.height * 3);
  const header = buildTgaHeader(runtime.vid.width, runtime.vid.height);
  const pixels = swapRgbToBgr(rgbPixels);
  const bytes = new Uint8Array(header.length + pixels.length);
  bytes.set(header, 0);
  bytes.set(pixels, header.length);

  const path = `${directory}/${picname}`;
  runtime.hooks.writeFile?.(path, bytes);
  runtime.hooks.print?.(PRINT_ALL, `Wrote ${picname}\n`);
  return { path, bytes };
}

/**
 * Original name: GL_Strings_f
 * Source: ref_gl/gl_rmisc.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Prints the GL vendor, renderer, version and extension strings.
 */
export function GL_Strings_f(runtime: GlRmiscRuntime): void {
  runtime.hooks.print?.(PRINT_ALL, `GL_VENDOR: ${runtime.gl_config.vendor_string}\n`);
  runtime.hooks.print?.(PRINT_ALL, `GL_RENDERER: ${runtime.gl_config.renderer_string}\n`);
  runtime.hooks.print?.(PRINT_ALL, `GL_VERSION: ${runtime.gl_config.version_string}\n`);
  runtime.hooks.print?.(PRINT_ALL, `GL_EXTENSIONS: ${runtime.gl_config.extensions_string}\n`);
}

/**
 * Original name: GL_SetDefaultState
 * Source: ref_gl/gl_rmisc.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Restores the renderer's default GL state, texture modes, particle parameters, palette extension state and swap interval.
 *
 * Porting notes:
 * - Immediate GL calls are represented by backend hooks while preserving call order.
 */
export function GL_SetDefaultState(runtime: GlRmiscRuntime): void {
  runtime.hooks.clearColor?.(1, 0, 0.5, 0.5);
  runtime.hooks.cullFace?.(GL_FRONT);
  runtime.hooks.enable?.(GL_TEXTURE_2D);

  runtime.hooks.enable?.(GL_ALPHA_TEST);
  runtime.hooks.alphaFunc?.(GL_GREATER, 0.666);

  runtime.hooks.disable?.(GL_DEPTH_TEST);
  runtime.hooks.disable?.(GL_CULL_FACE);
  runtime.hooks.disable?.(GL_BLEND);

  runtime.hooks.color4f?.(1, 1, 1, 1);
  runtime.hooks.polygonMode?.(GL_FRONT_AND_BACK, GL_FILL);
  runtime.hooks.shadeModel?.(GL_FLAT);

  if (runtime.imageRuntime) {
    if (runtime.gl_texturemode) {
      GL_TextureMode(runtime.imageRuntime, runtime.gl_texturemode.string);
    }
    if (runtime.gl_texturealphamode) {
      GL_TextureAlphaMode(runtime.imageRuntime, runtime.gl_texturealphamode.string);
    }
    if (runtime.gl_texturesolidmode) {
      GL_TextureSolidMode(runtime.imageRuntime, runtime.gl_texturesolidmode.string);
    }

    runtime.hooks.texParameterf?.(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, runtime.imageRuntime.gl_filter_min);
    runtime.hooks.texParameterf?.(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, runtime.imageRuntime.gl_filter_max);
  }

  runtime.hooks.texParameterf?.(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_REPEAT);
  runtime.hooks.texParameterf?.(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_REPEAT);
  runtime.hooks.blendFunc?.(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);

  if (runtime.imageRuntime) {
    GL_TexEnv(runtime.imageRuntime, GL_REPLACE);
  }

  if (runtime.qglPointParameterfEXT) {
    const attenuations = [
      runtime.gl_particle_att_a?.value ?? 0,
      runtime.gl_particle_att_b?.value ?? 0,
      runtime.gl_particle_att_c?.value ?? 0
    ] as const;
    runtime.hooks.enable?.(GL_POINT_SMOOTH);
    runtime.hooks.pointParameterfEXT?.(GL_POINT_SIZE_MIN_EXT, runtime.gl_particle_min_size?.value ?? 0);
    runtime.hooks.pointParameterfEXT?.(GL_POINT_SIZE_MAX_EXT, runtime.gl_particle_max_size?.value ?? 0);
    runtime.hooks.pointParameterfvEXT?.(GL_DISTANCE_ATTENUATION_EXT, attenuations);
  }

  if (runtime.imageRuntime && runtime.qglColorTableEXT && runtime.gl_ext_palettedtexture?.value) {
    runtime.hooks.enable?.(GL_SHARED_TEXTURE_PALETTE_EXT);
    GL_SetTexturePalette(runtime.imageRuntime, runtime.imageRuntime.d_8to24table);
  }

  GL_UpdateSwapInterval(runtime);
}

/**
 * Original name: GL_UpdateSwapInterval
 * Source: ref_gl/gl_rmisc.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies `gl_swapinterval` when modified and stereo rendering is disabled.
 *
 * Porting notes:
 * - The original Win32 `qwglSwapIntervalEXT` call is exposed as a backend hook.
 */
export function GL_UpdateSwapInterval(runtime: GlRmiscRuntime): void {
  if (!runtime.gl_swapinterval?.modified) {
    return;
  }

  runtime.gl_swapinterval.modified = false;
  if (!runtime.gl_state.stereo_enabled) {
    runtime.hooks.updateSwapInterval?.(runtime.gl_swapinterval.value);
  }
}
