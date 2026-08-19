/**
 * File: gl_image.ts
 * Source: Quake II original / ref_gl/gl_image.c
 * Purpose: Port the GL image manager used by the original refresh module.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Replaces renderer globals with an explicit runtime object.
 * - Uses existing Quake file parsers for PCX/TGA/WAL decoding instead of duplicating byte readers.
 * - Defers GPU upload work to backend hooks while preserving image registration, scrap packing and filter logic.
 *
 * Notes:
 * - This file is the principal attachment point for `ref_gl/gl_image.c`.
 * - This tranche focuses on image registration, scrap allocation, palette/gamma state and binding/filter behavior.
 */

import { parsePcx, parseTga, parseWal } from "../../formats/src/index.js";
import { ERR_DROP, ERR_FATAL, MAX_QPATH, PRINT_ALL, PRINT_DEVELOPER } from "../../qcommon/src/index.js";
import type { image_t } from "./gl_model.js";
import { GL_SHARED_TEXTURE_PALETTE_EXT, GL_TEXTURE0_SGIS, GL_TEXTURE1_SGIS } from "./qgl.js";

/**
 * Original name: TEXNUM_LIGHTMAPS / TEXNUM_SCRAPS / TEXNUM_IMAGES / MAX_GLTEXTURES
 * Source: ref_gl/gl_local.h
 * Category: Ported
 * Fidelity level: Strict
 */
export const TEXNUM_LIGHTMAPS = 1024;
export const TEXNUM_SCRAPS = 1152;
export const TEXNUM_IMAGES = 1153;
export const MAX_GLTEXTURES = 1024;

/**
 * Original name: MAX_SCRAPS / BLOCK_WIDTH / BLOCK_HEIGHT
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Strict
 */
export const MAX_SCRAPS = 1;
export const BLOCK_WIDTH = 256;
export const BLOCK_HEIGHT = 256;

/**
 * Original name: N/A
 * Source: N/A (OpenGL/WebGL numeric constants)
 * Category: New
 * Purpose: Provide the GL enum values used by the image manager backend hooks.
 */
export const GL_TEXTURE_ENV = 0x2300;
export const GL_TEXTURE_ENV_MODE = 0x2200;
export const GL_REPLACE = 0x1e01;
export const GL_TEXTURE_2D = 0x0de1;
export const GL_RGB = 0x1907;
export const GL_RGBA = 0x1908;
export const GL_RGB8 = 0x8051;
export const GL_RGB5 = 0x8050;
export const GL_RGB4 = 0x804f;
export const GL_R3_G3_B2 = 0x2a10;
export const GL_RGBA8 = 0x8058;
export const GL_RGB5_A1 = 0x8057;
export const GL_RGBA4 = 0x8056;
export const GL_RGBA2 = 0x8055;
export const GL_LINEAR = 0x2601;
export const GL_NEAREST = 0x2600;
export const GL_NEAREST_MIPMAP_NEAREST = 0x2700;
export const GL_LINEAR_MIPMAP_NEAREST = 0x2701;
export const GL_NEAREST_MIPMAP_LINEAR = 0x2702;
export const GL_LINEAR_MIPMAP_LINEAR = 0x2703;
export const GL_COLOR_INDEX = 0x1900;
export const GL_COLOR_INDEX8_EXT = 0x80e5;
export const GL_UNSIGNED_BYTE = 0x1401;

/**
 * Original name: GL_RENDERER_VOODOO / GL_RENDERER_VOODOO2
 * Source: ref_gl/gl_local.h
 * Category: Ported
 * Fidelity level: Strict
 */
export const GL_RENDERER_VOODOO = 0x00000001;
export const GL_RENDERER_VOODOO2 = 0x00000002;

/**
 * Original name: imagetype_t
 * Source: ref_gl/gl_local.h
 * Category: Ported
 * Fidelity level: Strict
 */
export enum imagetype_t {
  it_skin,
  it_sprite,
  it_wall,
  it_pic,
  it_sky
}

/**
 * Original name: image_s / image_t
 * Source: ref_gl/gl_local.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Porting notes:
 * - Owns the concrete image fields; gl_local.ts re-exports this shape as image_t.
 */
export interface GlImage {
  name: string;
  type: imagetype_t;
  width: number;
  height: number;
  upload_width: number;
  upload_height: number;
  registration_sequence: number;
  texturechain: unknown;
  texnum: number;
  sl: number;
  tl: number;
  sh: number;
  th: number;
  scrap: boolean;
  has_alpha: boolean;
  paletted: boolean;
}

/**
 * Original name: N/A
 * Source: N/A (texture upload adapter)
 * Category: New
 * Purpose: Describe pixels passed from the image manager to backend upload hooks.
 */
export interface GlImageUploadSource {
  bits: 8 | 32;
  pixels: Uint8Array | Uint32Array;
  width: number;
  height: number;
  mipmap: boolean;
  is_sky: boolean;
}

/**
 * Original name: N/A
 * Source: N/A (texture upload adapter)
 * Category: New
 * Purpose: Return backend upload dimensions and alpha/palette state to the image manager.
 */
export interface GlImageUploadResult {
  upload_width: number;
  upload_height: number;
  has_alpha: boolean;
  paletted: boolean;
}

/**
 * Original name: N/A
 * Source: N/A (renderer backend adapter)
 * Category: New
 * Purpose: Inject platform, file and GPU operations that were direct `ri`/`qgl` calls in C.
 */
export interface GlImageHooks {
  loadFile?: (path: string) => Uint8Array | null;
  bindTexture?: (texnum: number, tmu: number) => void;
  selectTexture?: (texture: number) => void;
  setTexture2DEnabled?: (tmu: number, enabled: boolean) => void;
  texEnv?: (tmu: number, mode: number) => void;
  setTextureFilter?: (texnum: number, minFilter: number, magFilter: number) => void;
  deleteTexture?: (texnum: number) => void;
  uploadScrapTexture?: (texnum: number, width: number, height: number, data: Uint8Array) => void;
  uploadImage?: (image: GlImage, source: GlImageUploadSource) => GlImageUploadResult | null;
  uploadTextureData?: (upload: {
    level: number;
    internalFormat: number;
    width: number;
    height: number;
    format: number;
    type: number;
    data: Uint8Array | Uint32Array;
  }) => void;
  setSharedTexturePalette?: (paletteRgb: Uint8Array) => void;
  Con_Printf?: (printLevel: number, message: string) => void;
  Sys_Error?: (errLevel: number, message: string) => never;
}

/**
 * Original name: N/A
 * Source: N/A (explicit runtime container for ref_gl/gl_image.c globals)
 * Category: New
 * Purpose: Hold the image manager globals per renderer instance instead of module globals.
 */
export interface GlImageRuntime {
  gltextures: GlImage[];
  numgltextures: number;
  registration_sequence: number;
  gl_filter_min: number;
  gl_filter_max: number;
  gl_solid_format: number;
  gl_alpha_format: number;
  gl_tex_solid_format: number;
  gl_tex_alpha_format: number;
  intensity_value: number;
  vid_gamma_value: number;
  qglColorTableEXT: boolean;
  gl_ext_palettedtexture_value: boolean;
  gl_round_down_value: boolean;
  gl_picmip_value: number;
  gl_nobind_value: boolean;
  currenttextures: [number, number];
  currenttmu: number;
  texEnvModes: [number, number];
  inverse_intensity: number;
  d_16to8table: Uint8Array | null;
  d_8to24table: Uint32Array;
  intensitytable: Uint8Array;
  gammatable: Uint8Array;
  scrap_allocated: Int32Array[];
  scrap_texels: Uint8Array[];
  scrap_dirty: boolean;
  scrap_uploads: number;
  draw_chars: GlImage | null;
  r_notexture: GlImage | null;
  r_particletexture: GlImage | null;
  renderer_flags: number;
  upload_width: number;
  upload_height: number;
  uploaded_paletted: boolean;
  hooks: GlImageHooks;
}

/**
 * Original name: glmode_t
 * Source: ref_gl/gl_image.c
 * Category: Adapter
 * Purpose: TypeScript row shape for the validated `modes` texture filter table.
 */
interface TextureModeRecord {
  name: string;
  minimize: number;
  maximize: number;
}

/**
 * Original name: gltmode_t
 * Source: ref_gl/gl_image.c
 * Category: Adapter
 * Purpose: TypeScript row shape for the validated alpha/solid format tables.
 */
interface TextureFormatModeRecord {
  name: string;
  mode: number;
}

/**
 * Original name: modes
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Strict
 */
const modes: TextureModeRecord[] = [
  { name: "GL_NEAREST", minimize: GL_NEAREST, maximize: GL_NEAREST },
  { name: "GL_LINEAR", minimize: GL_LINEAR, maximize: GL_LINEAR },
  { name: "GL_NEAREST_MIPMAP_NEAREST", minimize: GL_NEAREST_MIPMAP_NEAREST, maximize: GL_NEAREST },
  { name: "GL_LINEAR_MIPMAP_NEAREST", minimize: GL_LINEAR_MIPMAP_NEAREST, maximize: GL_LINEAR },
  { name: "GL_NEAREST_MIPMAP_LINEAR", minimize: GL_NEAREST_MIPMAP_LINEAR, maximize: GL_NEAREST },
  { name: "GL_LINEAR_MIPMAP_LINEAR", minimize: GL_LINEAR_MIPMAP_LINEAR, maximize: GL_LINEAR }
];

/**
 * Original name: gl_alpha_modes
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Strict
 */
const gl_alpha_modes: TextureFormatModeRecord[] = [
  { name: "default", mode: 4 },
  { name: "GL_RGBA", mode: GL_RGBA },
  { name: "GL_RGBA8", mode: GL_RGBA8 },
  { name: "GL_RGB5_A1", mode: GL_RGB5_A1 },
  { name: "GL_RGBA4", mode: GL_RGBA4 },
  { name: "GL_RGBA2", mode: GL_RGBA2 }
];

/**
 * Original name: gl_solid_modes
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Strict
 */
const gl_solid_modes: TextureFormatModeRecord[] = [
  { name: "default", mode: 3 },
  { name: "GL_RGB", mode: GL_RGB },
  { name: "GL_RGB8", mode: GL_RGB8 },
  { name: "GL_RGB5", mode: GL_RGB5 },
  { name: "GL_RGB4", mode: GL_RGB4 },
  { name: "GL_R3_G3_B2", mode: GL_R3_G3_B2 }
];

/**
 * Original name: N/A
 * Source: N/A (explicit runtime container for ref_gl/gl_image.c globals)
 * Category: New
 * Purpose: Create the explicit runtime replacing the mutable `gl_image.c` globals.
 *
 * Porting notes:
 * - Keeps the original global state fields grouped per renderer instance.
 */
export function createGlImageRuntime(hooks: GlImageHooks = {}): GlImageRuntime {
  return {
    gltextures: Array.from({ length: MAX_GLTEXTURES }, () => createGlImage()),
    numgltextures: 0,
    registration_sequence: 0,
    gl_filter_min: GL_LINEAR_MIPMAP_NEAREST,
    gl_filter_max: GL_LINEAR,
    gl_solid_format: 3,
    gl_alpha_format: 4,
    gl_tex_solid_format: 3,
    gl_tex_alpha_format: 4,
    intensity_value: 2,
    vid_gamma_value: 1,
    qglColorTableEXT: false,
    gl_ext_palettedtexture_value: false,
    gl_round_down_value: false,
    gl_picmip_value: 0,
    gl_nobind_value: false,
    currenttextures: [0, 0],
    currenttmu: 0,
    texEnvModes: [-1, -1],
    inverse_intensity: 0.5,
    d_16to8table: null,
    d_8to24table: new Uint32Array(256),
    intensitytable: new Uint8Array(256),
    gammatable: new Uint8Array(256),
    scrap_allocated: Array.from({ length: MAX_SCRAPS }, () => new Int32Array(BLOCK_WIDTH)),
    scrap_texels: Array.from({ length: MAX_SCRAPS }, () => new Uint8Array(BLOCK_WIDTH * BLOCK_HEIGHT)),
    scrap_dirty: false,
    scrap_uploads: 0,
    draw_chars: null,
    r_notexture: null,
    r_particletexture: null,
    renderer_flags: 0,
    upload_width: 0,
    upload_height: 0,
    uploaded_paletted: false,
    hooks
  };
}

/**
 * Original name: N/A
 * Source: N/A (image slot factory for ref_gl/gl_image.c runtime state)
 * Category: New
 * Purpose: Create one empty image slot matching the `image_t` fields consumed by the renderer.
 *
 * Porting notes:
 * - Initializes the fields that `gl_image.c` clears before reusing a texture slot.
 */
export function createGlImage(overrides: Partial<GlImage> = {}): GlImage {
  return {
    name: "",
    type: imagetype_t.it_pic,
    width: 0,
    height: 0,
    upload_width: 0,
    upload_height: 0,
    registration_sequence: 0,
    texturechain: null,
    texnum: 0,
    sl: 0,
    tl: 0,
    sh: 1,
    th: 1,
    scrap: false,
    has_alpha: false,
    paletted: false,
    ...overrides
  };
}

/**
 * Original name: N/A
 * Source: N/A (renderer image adapter)
 * Category: New
 * Purpose: Connect the draw character image loaded outside this module to the no-bind path.
 */
export function setDrawCharsImage(runtime: GlImageRuntime, image: GlImage | null): void {
  runtime.draw_chars = image;
}

/**
 * Original name: N/A
 * Source: N/A (renderer config adapter)
 * Category: New
 * Purpose: Mirror detected renderer flags into the image runtime.
 */
export function setRendererFlags(runtime: GlImageRuntime, flags: number): void {
  runtime.renderer_flags = flags;
}

/**
 * Original name: N/A
 * Source: N/A (renderer config adapter)
 * Category: New
 * Purpose: Toggle the image manager no-bind debug behavior.
 */
export function setNoBindEnabled(runtime: GlImageRuntime, enabled: boolean): void {
  runtime.gl_nobind_value = enabled;
}

/**
 * Original name: N/A
 * Source: N/A (renderer extension adapter)
 * Category: New
 * Purpose: Mirror shared-palette extension state into the image runtime.
 */
export function setPaletteExtensionState(runtime: GlImageRuntime, enabled: boolean, palettedTextureEnabled: boolean): void {
  runtime.qglColorTableEXT = enabled;
  runtime.gl_ext_palettedtexture_value = palettedTextureEnabled;
}

/**
 * Original name: N/A
 * Source: N/A (renderer cvar adapter)
 * Category: New
 * Purpose: Mirror the round-down texture cvar into the image runtime.
 */
export function setRoundDownEnabled(runtime: GlImageRuntime, enabled: boolean): void {
  runtime.gl_round_down_value = enabled;
}

/**
 * Original name: N/A
 * Source: N/A (renderer cvar adapter)
 * Category: New
 * Purpose: Mirror and sanitize the picmip cvar for texture upload scaling.
 */
export function setPicmipValue(runtime: GlImageRuntime, value: number): void {
  runtime.gl_picmip_value = Math.max(0, Math.trunc(value));
}

/**
 * Original name: N/A
 * Source: N/A (renderer cvar adapter)
 * Category: New
 * Purpose: Mirror the vid_gamma cvar for image initialization.
 */
export function setVidGammaValue(runtime: GlImageRuntime, value: number): void {
  runtime.vid_gamma_value = value;
}

/**
 * Original name: N/A
 * Source: N/A (renderer cvar adapter)
 * Category: New
 * Purpose: Mirror the intensity cvar for image initialization and upload scaling.
 */
export function setIntensityValue(runtime: GlImageRuntime, value: number): void {
  runtime.intensity_value = value;
}

/**
 * Original name: N/A
 * Source: N/A (renderer image adapter)
 * Category: New
 * Purpose: Protect persistent notexture and particle images during unused-image cleanup.
 */
export function setProtectedImages(runtime: GlImageRuntime, notexture: GlImage | null, particletexture: GlImage | null): void {
  runtime.r_notexture = notexture;
  runtime.r_particletexture = particletexture;
}

/**
 * Original name: GL_SetTexturePalette
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Builds the 768-byte RGB palette table and forwards it to the backend palette hook.
 *
 * Porting notes:
 * - The OpenGL extension guard is represented by the presence of the backend hook.
 */
export function GL_SetTexturePalette(runtime: GlImageRuntime, palette: Uint32Array | readonly number[]): void {
  const values = palette instanceof Uint32Array ? palette : Uint32Array.from(palette);
  const temptable = new Uint8Array(768);

  for (let i = 0; i < 256; i += 1) {
    const color = values[i] ?? 0;
    temptable[i * 3] = color & 0xff;
    temptable[i * 3 + 1] = (color >> 8) & 0xff;
    temptable[i * 3 + 2] = (color >> 16) & 0xff;
  }

  runtime.hooks.setSharedTexturePalette?.(temptable);
}

/**
 * Original name: GL_EnableMultitexture
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Switches to TMU 1, toggles 2D texturing, restores replace mode, then returns to TMU 0.
 *
 * Porting notes:
 * - Direct qgl calls are backend hooks, preserving state changes and call order.
 */
export function GL_EnableMultitexture(runtime: GlImageRuntime, enable: boolean): void {
  if (!hasSelectTextureHook(runtime)) {
    return;
  }

  if (enable) {
    GL_SelectTexture(runtime, GL_TEXTURE1_SGIS);
    runtime.hooks.setTexture2DEnabled?.(runtime.currenttmu, true);
    GL_TexEnv(runtime, GL_REPLACE);
  } else {
    GL_SelectTexture(runtime, GL_TEXTURE1_SGIS);
    runtime.hooks.setTexture2DEnabled?.(runtime.currenttmu, false);
    GL_TexEnv(runtime, GL_REPLACE);
  }

  GL_SelectTexture(runtime, GL_TEXTURE0_SGIS);
  GL_TexEnv(runtime, GL_REPLACE);
}

/**
 * Original name: GL_SelectTexture
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Updates the active TMU only when the target differs from the cached state.
 *
 * Porting notes:
 * - Missing multitexture support is represented by an absent selectTexture hook.
 */
export function GL_SelectTexture(runtime: GlImageRuntime, texture: number): void {
  if (!hasSelectTextureHook(runtime)) {
    return;
  }

  const tmu = texture === GL_TEXTURE0_SGIS ? 0 : 1;
  if (tmu === runtime.currenttmu) {
    return;
  }

  runtime.currenttmu = tmu;
  runtime.hooks.selectTexture?.(texture);
}

/**
 * Original name: GL_TexEnv
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Caches texture environment modes per TMU and skips duplicate backend calls.
 *
 * Porting notes:
 * - Mirrors the original static `lastmodes[2]` with runtime-owned `texEnvModes`.
 */
export function GL_TexEnv(runtime: GlImageRuntime, mode: number): void {
  if (runtime.texEnvModes[runtime.currenttmu] === mode) {
    return;
  }

  runtime.texEnvModes[runtime.currenttmu] = mode;
  runtime.hooks.texEnv?.(runtime.currenttmu, mode);
}

/**
 * Original name: GL_Bind
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies the no-bind draw character override, updates the current texture cache and binds when changed.
 *
 * Porting notes:
 * - Direct `qglBindTexture` is represented by the backend bindTexture hook.
 */
export function GL_Bind(runtime: GlImageRuntime, texnum: number): void {
  if (runtime.gl_nobind_value && runtime.draw_chars) {
    texnum = runtime.draw_chars.texnum;
  }

  if (runtime.currenttextures[runtime.currenttmu] === texnum) {
    return;
  }

  runtime.currenttextures[runtime.currenttmu] = texnum;
  runtime.hooks.bindTexture?.(texnum, runtime.currenttmu);
}

/**
 * Original name: GL_MBind
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Selects the requested TMU and binds only when that TMU is not already using the texture.
 *
 * Porting notes:
 * - Uses the ported GL_SelectTexture and GL_Bind paths to share cache behavior.
 */
export function GL_MBind(runtime: GlImageRuntime, target: number, texnum: number): void {
  GL_SelectTexture(runtime, target);
  const tmu = target === GL_TEXTURE0_SGIS ? 0 : 1;
  if (runtime.currenttextures[tmu] === texnum) {
    return;
  }

  GL_Bind(runtime, texnum);
}

/**
 * Original name: GL_TextureMode
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Resolves a filter mode by name, updates min/mag globals and reapplies filters to existing mipmapped images.
 *
 * Porting notes:
 * - qgl texture parameter calls are routed through setTextureFilter.
 */
export function GL_TextureMode(runtime: GlImageRuntime, string: string): void {
  const mode = modes.find((entry) => entry.name === string);
  if (!mode) {
    runtime.hooks.Con_Printf?.(PRINT_ALL, "bad filter name\n");
    return;
  }

  runtime.gl_filter_min = mode.minimize;
  runtime.gl_filter_max = mode.maximize;

  for (let i = 0; i < runtime.numgltextures; i += 1) {
    const image = runtime.gltextures[i];
    if (image.type === imagetype_t.it_pic || image.type === imagetype_t.it_sky || image.texnum <= 0) {
      continue;
    }

    GL_Bind(runtime, image.texnum);
    runtime.hooks.setTextureFilter?.(image.texnum, runtime.gl_filter_min, runtime.gl_filter_max);
  }
}

/**
 * Original name: GL_TextureAlphaMode
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Resolves the named alpha internal format and stores it for later uploads.
 */
export function GL_TextureAlphaMode(runtime: GlImageRuntime, string: string): void {
  const mode = gl_alpha_modes.find((entry) => entry.name === string);
  if (!mode) {
    runtime.hooks.Con_Printf?.(PRINT_ALL, "bad alpha texture mode name\n");
    return;
  }

  runtime.gl_tex_alpha_format = mode.mode;
}

/**
 * Original name: GL_TextureSolidMode
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Resolves the named solid internal format and stores it for later uploads.
 */
export function GL_TextureSolidMode(runtime: GlImageRuntime, string: string): void {
  const mode = gl_solid_modes.find((entry) => entry.name === string);
  if (!mode) {
    runtime.hooks.Con_Printf?.(PRINT_ALL, "bad solid texture mode name\n");
    return;
  }

  runtime.gl_tex_solid_format = mode.mode;
}

/**
 * Original name: GL_ImageList_f
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Prints the registered image list with type prefix, dimensions, palette mode and texel total.
 */
export function GL_ImageList_f(runtime: GlImageRuntime): void {
  const palstrings = ["RGB", "PAL"] as const;
  let texels = 0;

  runtime.hooks.Con_Printf?.(PRINT_ALL, "------------------\n");
  for (let i = 0; i < runtime.numgltextures; i += 1) {
    const image = runtime.gltextures[i];
    if (image.texnum <= 0) {
      continue;
    }

    texels += image.upload_width * image.upload_height;
    runtime.hooks.Con_Printf?.(
      PRINT_ALL,
      `${imageTypePrefix(image.type)} ${image.upload_width.toString().padStart(3, " ")} ${image.upload_height.toString().padStart(3, " ")} ${palstrings[image.paletted ? 1 : 0]}: ${image.name}\n`
    );
  }

  runtime.hooks.Con_Printf?.(PRINT_ALL, `Total texel count (not counting mipmaps): ${texels}\n`);
}

/**
 * Original name: Scrap_AllocBlock
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Finds and reserves a rectangle in the scrap atlas using the original column-height algorithm.
 */
export function Scrap_AllocBlock(runtime: GlImageRuntime, w: number, h: number): { texnum: number; x: number; y: number } | null {
  for (let texnum = 0; texnum < MAX_SCRAPS; texnum += 1) {
    let best = BLOCK_HEIGHT;
    let bestX = 0;
    let bestY = 0;

    for (let i = 0; i < BLOCK_WIDTH - w; i += 1) {
      let best2 = 0;
      let j = 0;
      for (; j < w; j += 1) {
        if (runtime.scrap_allocated[texnum][i + j] >= best) {
          break;
        }
        if (runtime.scrap_allocated[texnum][i + j] > best2) {
          best2 = runtime.scrap_allocated[texnum][i + j];
        }
      }

      if (j === w) {
        bestX = i;
        bestY = best = best2;
      }
    }

    if (best + h > BLOCK_HEIGHT) {
      continue;
    }

    for (let i = 0; i < w; i += 1) {
      runtime.scrap_allocated[texnum][bestX + i] = best + h;
    }

    return { texnum, x: bestX, y: bestY };
  }

  return null;
}

/**
 * Original name: Scrap_Upload
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Increments the upload counter, binds the scrap texture, uploads atlas texels and clears the dirty flag.
 *
 * Porting notes:
 * - A backend scrap upload hook is preferred; otherwise the ported GL_Upload8 path is used.
 */
export function Scrap_Upload(runtime: GlImageRuntime): void {
  runtime.scrap_uploads += 1;
  GL_Bind(runtime, TEXNUM_SCRAPS);
  if (runtime.hooks.uploadScrapTexture) {
    runtime.hooks.uploadScrapTexture(TEXNUM_SCRAPS, BLOCK_WIDTH, BLOCK_HEIGHT, runtime.scrap_texels[0]);
  } else {
    GL_Upload8(runtime, runtime.scrap_texels[0], BLOCK_WIDTH, BLOCK_HEIGHT, false, false);
  }
  runtime.scrap_dirty = false;
}

/**
 * Original name: LoadPCX
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Loads a PCX through the renderer filesystem hook and returns decoded palette indices, palette bytes and dimensions.
 *
 * Porting notes:
 * - Delegates byte parsing to `parsePcx`, the shared Quake PCX parser, instead of duplicating the C out-parameter loader.
 */
export function LoadPCX(runtime: GlImageRuntime, filename: string): { pic: Uint8Array; palette: Uint8Array; width: number; height: number } | null {
  const bytes = runtime.hooks.loadFile?.(filename) ?? null;
  if (!bytes) {
    runtime.hooks.Con_Printf?.(PRINT_DEVELOPER, `Bad pcx file ${filename}\n`);
    return null;
  }

  try {
    const image = parsePcx(bytes, filename);
    return {
      pic: image.indices,
      palette: image.paletteRgb,
      width: image.width,
      height: image.height
    };
  } catch {
    runtime.hooks.Con_Printf?.(PRINT_ALL, `Bad pcx file ${filename}\n`);
    return null;
  }
}

/**
 * Original name: LoadTGA
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Loads uncompressed or RLE 24/32-bit TGA pixels and exposes RGBA data for the GL image upload path.
 *
 * Porting notes:
 * - Delegates byte parsing to `parseTga`; unsupported TGA variants still route through the renderer fatal error hook.
 */
export function LoadTGA(runtime: GlImageRuntime, name: string): { pic: Uint8Array; width: number; height: number } | null {
  const bytes = runtime.hooks.loadFile?.(name) ?? null;
  if (!bytes) {
    runtime.hooks.Con_Printf?.(PRINT_DEVELOPER, `Bad tga file ${name}\n`);
    return null;
  }

  try {
    const image = parseTga(bytes, name);
    return {
      pic: image.rgba,
      width: image.width,
      height: image.height
    };
  } catch (error) {
    failSysError(runtime, ERR_DROP, error instanceof Error ? error.message : `LoadTGA failed for ${name}`);
  }
}

/**
 * Original name: R_FloodFillSkin
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Flood-fills the top-left skin background color so mipmapped skins do not bleed transparent halos.
 *
 * Porting notes:
 * - Keeps the original FIFO size, mask and neighbor update order while using typed arrays for the queue.
 */
export function R_FloodFillSkin(runtime: GlImageRuntime, skin: Uint8Array, skinwidth: number, skinheight: number): void {
  const fillcolor = skin[0] ?? 0;
  const fifoSize = 0x1000;
  const fifoMask = fifoSize - 1;
  const fifoX = new Int16Array(fifoSize);
  const fifoY = new Int16Array(fifoSize);
  let inpt = 0;
  let outpt = 0;

  let filledcolor = 0;
  for (let i = 0; i < 256; i += 1) {
    if ((runtime.d_8to24table[i] ?? 0) === 255) {
      filledcolor = i;
      break;
    }
  }

  if (fillcolor === filledcolor || fillcolor === 255) {
    return;
  }

  fifoX[inpt] = 0;
  fifoY[inpt] = 0;
  inpt = (inpt + 1) & fifoMask;

  while (outpt !== inpt) {
    const x = fifoX[outpt];
    const y = fifoY[outpt];
    outpt = (outpt + 1) & fifoMask;

    let fdc = filledcolor;
    const center = x + skinwidth * y;

    const step = (offset: number, dx: number, dy: number): void => {
      const value = skin[center + offset] ?? 0;
      if (value === fillcolor) {
        skin[center + offset] = 255;
        fifoX[inpt] = x + dx;
        fifoY[inpt] = y + dy;
        inpt = (inpt + 1) & fifoMask;
      } else if (value !== 255) {
        fdc = value;
      }
    };

    if (x > 0) {
      step(-1, -1, 0);
    }
    if (x < skinwidth - 1) {
      step(1, 1, 0);
    }
    if (y > 0) {
      step(-skinwidth, 0, -1);
    }
    if (y < skinheight - 1) {
      step(skinwidth, 0, 1);
    }

    skin[center] = fdc;
  }
}

/**
 * Original name: GL_ResampleTexture
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Resamples RGBA texels with the same four-tap sampling pattern used before upload.
 */
export function GL_ResampleTexture(
  input: Uint32Array,
  inwidth: number,
  inheight: number,
  output: Uint32Array,
  outwidth: number,
  outheight: number
): void {
  const p1 = new Uint32Array(outwidth);
  const p2 = new Uint32Array(outwidth);

  const fracstep = Math.trunc((inwidth * 0x10000) / outwidth);
  let frac = fracstep >> 2;
  for (let i = 0; i < outwidth; i += 1) {
    p1[i] = frac >> 16;
    frac += fracstep;
  }

  frac = 3 * (fracstep >> 2);
  for (let i = 0; i < outwidth; i += 1) {
    p2[i] = frac >> 16;
    frac += fracstep;
  }

  for (let i = 0; i < outheight; i += 1) {
    const inrow = inwidth * Math.trunc(((i + 0.25) * inheight) / outheight);
    const inrow2 = inwidth * Math.trunc(((i + 0.75) * inheight) / outheight);
    const outrow = i * outwidth;

    for (let j = 0; j < outwidth; j += 1) {
      const c1 = input[inrow + p1[j]] ?? 0;
      const c2 = input[inrow + p2[j]] ?? 0;
      const c3 = input[inrow2 + p1[j]] ?? 0;
      const c4 = input[inrow2 + p2[j]] ?? 0;

      output[outrow + j] = packRgba(
        (redOf(c1) + redOf(c2) + redOf(c3) + redOf(c4)) >> 2,
        (greenOf(c1) + greenOf(c2) + greenOf(c3) + greenOf(c4)) >> 2,
        (blueOf(c1) + blueOf(c2) + blueOf(c3) + blueOf(c4)) >> 2,
        (alphaOf(c1) + alphaOf(c2) + alphaOf(c3) + alphaOf(c4)) >> 2
      );
    }
  }
}

/**
 * Original name: GL_LightScaleTexture
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function GL_LightScaleTexture(
  runtime: GlImageRuntime,
  texture: Uint32Array,
  inwidth: number,
  inheight: number,
  only_gamma: boolean
): void {
  const count = inwidth * inheight;
  for (let i = 0; i < count; i += 1) {
    const value = texture[i] ?? 0;
    const r = redOf(value);
    const g = greenOf(value);
    const b = blueOf(value);
    const a = alphaOf(value);

    const nr = only_gamma ? runtime.gammatable[r] : runtime.gammatable[runtime.intensitytable[r] ?? 0];
    const ng = only_gamma ? runtime.gammatable[g] : runtime.gammatable[runtime.intensitytable[g] ?? 0];
    const nb = only_gamma ? runtime.gammatable[b] : runtime.gammatable[runtime.intensitytable[b] ?? 0];

    texture[i] = packRgba(nr ?? 0, ng ?? 0, nb ?? 0, a);
  }
}

/**
 * Original name: GL_MipMap
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Operates in place, averaging 2x2 RGBA texels into the next mip level.
 *
 * Porting notes:
 * - Handles one-pixel edges explicitly so the browser-side typed array path remains bounded.
 */
export function GL_MipMap(texture: Uint32Array, width: number, height: number): void {
  const src = texture.slice(0, width * height);
  const outWidth = Math.max(1, width >> 1);
  const outHeight = Math.max(1, height >> 1);

  for (let y = 0; y < outHeight; y += 1) {
    const y0 = Math.min(height - 1, y * 2);
    const y1 = Math.min(height - 1, y0 + 1);
    for (let x = 0; x < outWidth; x += 1) {
      const x0 = Math.min(width - 1, x * 2);
      const x1 = Math.min(width - 1, x0 + 1);

      const c1 = src[y0 * width + x0] ?? 0;
      const c2 = src[y0 * width + x1] ?? 0;
      const c3 = src[y1 * width + x0] ?? 0;
      const c4 = src[y1 * width + x1] ?? 0;

      texture[y * outWidth + x] = packRgba(
        (redOf(c1) + redOf(c2) + redOf(c3) + redOf(c4)) >> 2,
        (greenOf(c1) + greenOf(c2) + greenOf(c3) + greenOf(c4)) >> 2,
        (blueOf(c1) + blueOf(c2) + blueOf(c3) + blueOf(c4)) >> 2,
        (alphaOf(c1) + alphaOf(c2) + alphaOf(c3) + alphaOf(c4)) >> 2
      );
    }
  }
}

/**
 * Original name: GL_BuildPalettedTexture
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function GL_BuildPalettedTexture(
  runtime: GlImageRuntime,
  paletted_texture: Uint8Array,
  scaled: Uint32Array,
  scaled_width: number,
  scaled_height: number
): void {
  const table = runtime.d_16to8table;
  for (let i = 0; i < scaled_width * scaled_height; i += 1) {
    const pixel = scaled[i] ?? 0;
    const r = (redOf(pixel) >> 3) & 31;
    const g = (greenOf(pixel) >> 2) & 63;
    const b = (blueOf(pixel) >> 3) & 31;
    const c = r | (g << 5) | (b << 11);
    paletted_texture[i] = table ? (table[c] ?? 0) : 0;
  }
}

/**
 * Original name: GL_Upload32
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Computes power-of-two upload dimensions, alpha format, optional paletted data, light scaling, mip levels and filters.
 *
 * Porting notes:
 * - GPU calls are emitted through hooks so the Three.js adapter can consume the same upload decisions.
 */
export function GL_Upload32(runtime: GlImageRuntime, data: Uint32Array, width: number, height: number, mipmap: boolean): boolean {
  const maxPixels = 256 * 256;
  const scaled = new Uint32Array(maxPixels);
  const paletted_texture = new Uint8Array(maxPixels);

  runtime.uploaded_paletted = false;

  let scaled_width = nextPowerOfTwo(width);
  let scaled_height = nextPowerOfTwo(height);

  if (runtime.gl_round_down_value && scaled_width > width && mipmap) {
    scaled_width >>= 1;
  }
  if (runtime.gl_round_down_value && scaled_height > height && mipmap) {
    scaled_height >>= 1;
  }

  if (mipmap) {
    scaled_width >>= runtime.gl_picmip_value;
    scaled_height >>= runtime.gl_picmip_value;
  }

  if (scaled_width > 256) {
    scaled_width = 256;
  }
  if (scaled_height > 256) {
    scaled_height = 256;
  }
  if (scaled_width < 1) {
    scaled_width = 1;
  }
  if (scaled_height < 1) {
    scaled_height = 1;
  }

  runtime.upload_width = scaled_width;
  runtime.upload_height = scaled_height;

  if (scaled_width * scaled_height > maxPixels) {
    failSysError(runtime, ERR_DROP, "GL_Upload32: too big");
  }

  let samples = runtime.gl_solid_format;
  for (let i = 0; i < width * height; i += 1) {
    if (alphaOf(data[i] ?? 0) !== 255) {
      samples = runtime.gl_alpha_format;
      break;
    }
  }

  let comp = samples;
  if (samples === runtime.gl_solid_format) {
    comp = runtime.gl_tex_solid_format;
  } else if (samples === runtime.gl_alpha_format) {
    comp = runtime.gl_tex_alpha_format;
  } else {
    runtime.hooks.Con_Printf?.(PRINT_ALL, `Unknown number of texture components ${samples}\n`);
  }

  if (scaled_width === width && scaled_height === height) {
    if (!mipmap) {
      if (runtime.qglColorTableEXT && runtime.gl_ext_palettedtexture_value && samples === runtime.gl_solid_format && runtime.d_16to8table) {
        runtime.uploaded_paletted = true;
        GL_BuildPalettedTexture(runtime, paletted_texture, data, scaled_width, scaled_height);
        runtime.hooks.uploadTextureData?.({
          level: 0,
          internalFormat: GL_COLOR_INDEX8_EXT,
          width: scaled_width,
          height: scaled_height,
          format: GL_COLOR_INDEX,
          type: GL_UNSIGNED_BYTE,
          data: paletted_texture.subarray(0, scaled_width * scaled_height)
        });
      } else {
        runtime.hooks.uploadTextureData?.({
          level: 0,
          internalFormat: comp,
          width: scaled_width,
          height: scaled_height,
          format: GL_RGBA,
          type: GL_UNSIGNED_BYTE,
          data: data.subarray(0, width * height)
        });
      }

      runtime.hooks.setTextureFilter?.(runtime.currenttextures[runtime.currenttmu], runtime.gl_filter_max, runtime.gl_filter_max);
      return samples === runtime.gl_alpha_format;
    }

    scaled.set(data.subarray(0, width * height), 0);
  } else {
    GL_ResampleTexture(data, width, height, scaled, scaled_width, scaled_height);
  }

  GL_LightScaleTexture(runtime, scaled, scaled_width, scaled_height, !mipmap);

  if (runtime.qglColorTableEXT && runtime.gl_ext_palettedtexture_value && samples === runtime.gl_solid_format && runtime.d_16to8table) {
    runtime.uploaded_paletted = true;
    GL_BuildPalettedTexture(runtime, paletted_texture, scaled, scaled_width, scaled_height);
    runtime.hooks.uploadTextureData?.({
      level: 0,
      internalFormat: GL_COLOR_INDEX8_EXT,
      width: scaled_width,
      height: scaled_height,
      format: GL_COLOR_INDEX,
      type: GL_UNSIGNED_BYTE,
      data: paletted_texture.subarray(0, scaled_width * scaled_height)
    });
  } else {
    runtime.hooks.uploadTextureData?.({
      level: 0,
      internalFormat: comp,
      width: scaled_width,
      height: scaled_height,
      format: GL_RGBA,
      type: GL_UNSIGNED_BYTE,
      data: scaled.subarray(0, scaled_width * scaled_height)
    });
  }

  if (mipmap) {
    let miplevel = 0;
    let mipWidth = scaled_width;
    let mipHeight = scaled_height;

    while (mipWidth > 1 || mipHeight > 1) {
      GL_MipMap(scaled, mipWidth, mipHeight);
      mipWidth >>= 1;
      mipHeight >>= 1;
      if (mipWidth < 1) {
        mipWidth = 1;
      }
      if (mipHeight < 1) {
        mipHeight = 1;
      }
      miplevel += 1;

      if (runtime.qglColorTableEXT && runtime.gl_ext_palettedtexture_value && samples === runtime.gl_solid_format && runtime.d_16to8table) {
        runtime.uploaded_paletted = true;
        GL_BuildPalettedTexture(runtime, paletted_texture, scaled, mipWidth, mipHeight);
        runtime.hooks.uploadTextureData?.({
          level: miplevel,
          internalFormat: GL_COLOR_INDEX8_EXT,
          width: mipWidth,
          height: mipHeight,
          format: GL_COLOR_INDEX,
          type: GL_UNSIGNED_BYTE,
          data: paletted_texture.subarray(0, mipWidth * mipHeight)
        });
      } else {
        runtime.hooks.uploadTextureData?.({
          level: miplevel,
          internalFormat: comp,
          width: mipWidth,
          height: mipHeight,
          format: GL_RGBA,
          type: GL_UNSIGNED_BYTE,
          data: scaled.subarray(0, mipWidth * mipHeight)
        });
      }
    }
  }

  if (mipmap) {
    runtime.hooks.setTextureFilter?.(runtime.currenttextures[runtime.currenttmu], runtime.gl_filter_min, runtime.gl_filter_max);
  } else {
    runtime.hooks.setTextureFilter?.(runtime.currenttextures[runtime.currenttmu], runtime.gl_filter_max, runtime.gl_filter_max);
  }

  return samples === runtime.gl_alpha_format;
}

/**
 * Original name: GL_Upload8
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Converts indexed pixels through `d_8to24table`, fixes transparent fringe colors and delegates RGBA upload.
 *
 * Porting notes:
 * - Preserves the original paletted sky fast path when the color-table extension is enabled.
 */
export function GL_Upload8(
  runtime: GlImageRuntime,
  data: Uint8Array,
  width: number,
  height: number,
  mipmap: boolean,
  is_sky: boolean
): boolean {
  const s = width * height;
  const trans = new Uint32Array(512 * 256);

  if (s > trans.length) {
    failSysError(runtime, ERR_DROP, "GL_Upload8: too large");
  }

  if (runtime.qglColorTableEXT && runtime.gl_ext_palettedtexture_value && is_sky) {
    runtime.upload_width = width;
    runtime.upload_height = height;
    runtime.uploaded_paletted = true;

    runtime.hooks.uploadTextureData?.({
      level: 0,
      internalFormat: GL_COLOR_INDEX8_EXT,
      width,
      height,
      format: GL_COLOR_INDEX,
      type: GL_UNSIGNED_BYTE,
      data: data.subarray(0, s)
    });

    runtime.hooks.setTextureFilter?.(runtime.currenttextures[runtime.currenttmu], runtime.gl_filter_max, runtime.gl_filter_max);
    return false;
  }

  for (let i = 0; i < s; i += 1) {
    let p = data[i] ?? 0;
    trans[i] = runtime.d_8to24table[p] ?? 0;

    if (p === 255) {
      if (i > width && (data[i - width] ?? 255) !== 255) {
        p = data[i - width] ?? 0;
      } else if (i < s - width && (data[i + width] ?? 255) !== 255) {
        p = data[i + width] ?? 0;
      } else if (i > 0 && (data[i - 1] ?? 255) !== 255) {
        p = data[i - 1] ?? 0;
      } else if (i < s - 1 && (data[i + 1] ?? 255) !== 255) {
        p = data[i + 1] ?? 0;
      } else {
        p = 0;
      }

      const fallback = runtime.d_8to24table[p] ?? 0;
      trans[i] = packRgba(redOf(fallback), greenOf(fallback), blueOf(fallback), alphaOf(trans[i]));
    }
  }

  return GL_Upload32(runtime, trans.subarray(0, s), width, height, mipmap);
}

/**
 * Original name: GL_LoadPic
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Close
 */
export function GL_LoadPic(
  runtime: GlImageRuntime,
  name: string,
  pic: Uint8Array,
  width: number,
  height: number,
  type: imagetype_t,
  bits: 8 | 32
): GlImage {
  const image = allocateImageSlot(runtime);

  if (name.length >= MAX_QPATH) {
    failSysError(runtime, ERR_DROP, `Draw_LoadPic: "${name}" is too long`);
  }

  resetImage(image);
  image.name = name;
  image.registration_sequence = runtime.registration_sequence;
  image.width = width;
  image.height = height;
  image.type = type;

  if (type === imagetype_t.it_skin && bits === 8) {
    R_FloodFillSkin(runtime, pic, width, height);
  }

  if (image.type === imagetype_t.it_pic && bits === 8 && image.width < 64 && image.height < 64) {
    const allocation = Scrap_AllocBlock(runtime, image.width, image.height);
    if (allocation) {
      runtime.scrap_dirty = true;

      let k = 0;
      for (let i = 0; i < image.height; i += 1) {
        for (let j = 0; j < image.width; j += 1, k += 1) {
          runtime.scrap_texels[allocation.texnum][(allocation.y + i) * BLOCK_WIDTH + allocation.x + j] = pic[k];
        }
      }

      image.texnum = TEXNUM_SCRAPS + allocation.texnum;
      image.scrap = true;
      image.has_alpha = true;
      image.sl = (allocation.x + 0.01) / BLOCK_WIDTH;
      image.sh = (allocation.x + image.width - 0.01) / BLOCK_WIDTH;
      image.tl = (allocation.y + 0.01) / BLOCK_WIDTH;
      image.th = (allocation.y + image.height - 0.01) / BLOCK_WIDTH;
      image.upload_width = image.width;
      image.upload_height = image.height;
      image.paletted = false;
      return image;
    }
  }

  image.scrap = false;
  image.texnum = TEXNUM_IMAGES + runtime.gltextures.indexOf(image);
  GL_Bind(runtime, image.texnum);

  const uploadSource: GlImageUploadSource = {
    bits,
    pixels: bits === 8 ? pic : toUint32Pixels(pic),
    width,
    height,
    mipmap: image.type !== imagetype_t.it_pic && image.type !== imagetype_t.it_sky,
    is_sky: image.type === imagetype_t.it_sky
  };
  if (runtime.hooks.uploadImage) {
    const upload = runtime.hooks.uploadImage(image, uploadSource) ?? defaultUploadImage(runtime, uploadSource);
    runtime.upload_width = upload.upload_width;
    runtime.upload_height = upload.upload_height;
    runtime.uploaded_paletted = upload.paletted;
    image.has_alpha = upload.has_alpha;
  } else if (bits === 8) {
    image.has_alpha = GL_Upload8(runtime, pic, width, height, uploadSource.mipmap, uploadSource.is_sky);
  } else {
    image.has_alpha = GL_Upload32(runtime, uploadSource.pixels as Uint32Array, width, height, uploadSource.mipmap);
  }

  image.upload_width = runtime.upload_width;
  image.upload_height = runtime.upload_height;
  image.paletted = runtime.uploaded_paletted;
  image.sl = 0;
  image.sh = 1;
  image.tl = 0;
  image.th = 1;

  return image;
}

/**
 * Original name: GL_LoadWal
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Close
 */
export function GL_LoadWal(runtime: GlImageRuntime, name: string): GlImage | null {
  const bytes = runtime.hooks.loadFile?.(name) ?? null;
  if (!bytes) {
    runtime.hooks.Con_Printf?.(PRINT_ALL, `GL_FindImage: can't load ${name}\n`);
    return runtime.r_notexture;
  }

  const wal = parseWal(bytes, name);
  return GL_LoadPic(runtime, name, wal.mipmaps[0], wal.header.width, wal.header.height, imagetype_t.it_wall, 8);
}

/**
 * Original name: GL_FindImage
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Close
 */
export function GL_FindImage(runtime: GlImageRuntime, name: string | null, type: imagetype_t): GlImage | null {
  if (!name) {
    return null;
  }

  if (name.length < 5) {
    return null;
  }

  for (let i = 0; i < runtime.numgltextures; i += 1) {
    const image = runtime.gltextures[i];
    if (image.name === name) {
      image.registration_sequence = runtime.registration_sequence;
      return image;
    }
  }

  if (name.endsWith(".pcx")) {
    const loaded = LoadPCX(runtime, name);
    if (!loaded) {
      return null;
    }
    return GL_LoadPic(runtime, name, loaded.pic, loaded.width, loaded.height, type, 8);
  }

  if (name.endsWith(".wal")) {
    return GL_LoadWal(runtime, name);
  }

  if (name.endsWith(".tga")) {
    const loaded = LoadTGA(runtime, name);
    if (!loaded) {
      return null;
    }
    return GL_LoadPic(runtime, name, loaded.pic, loaded.width, loaded.height, type, 32);
  }

  return null;
}

/**
 * Original name: R_RegisterSkin
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function R_RegisterSkin(runtime: GlImageRuntime, name: string): GlImage | null {
  return GL_FindImage(runtime, name, imagetype_t.it_skin);
}

/**
 * Original name: GL_FreeUnusedImages
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Deletes registered non-pic textures that were not touched by the current registration sequence.
 */
export function GL_FreeUnusedImages(runtime: GlImageRuntime): void {
  if (runtime.r_notexture) {
    runtime.r_notexture.registration_sequence = runtime.registration_sequence;
  }
  if (runtime.r_particletexture) {
    runtime.r_particletexture.registration_sequence = runtime.registration_sequence;
  }

  for (let i = 0; i < runtime.numgltextures; i += 1) {
    const image = runtime.gltextures[i];
    if (image.registration_sequence === runtime.registration_sequence) {
      continue;
    }
    if (!image.registration_sequence) {
      continue;
    }
    if (image.type === imagetype_t.it_pic) {
      continue;
    }

    if (image.texnum > 0) {
      runtime.hooks.deleteTexture?.(image.texnum);
    }
    resetImage(image);
  }
}

/**
 * Original name: Draw_GetPalette
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Loads `pics/colormap.pcx`, builds `d_8to24table` and clears alpha for palette index 255.
 */
export function Draw_GetPalette(runtime: GlImageRuntime): number {
  const loaded = LoadPCX(runtime, "pics/colormap.pcx");
  if (!loaded?.palette) {
    failSysError(runtime, ERR_FATAL, "Couldn't load pics/colormap.pcx");
  }

  for (let i = 0; i < 256; i += 1) {
    const r = loaded.palette[i * 3] ?? 0;
    const g = loaded.palette[i * 3 + 1] ?? 0;
    const b = loaded.palette[i * 3 + 2] ?? 0;
    runtime.d_8to24table[i] = (((255 << 24) >>> 0) + (r << 0) + (g << 8) + (b << 16)) >>> 0;
  }

  runtime.d_8to24table[255] &= 0x00ffffff;
  return 0;
}

/**
 * Original name: GL_InitImages
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes registration state, palette, optional 16-to-8 table, gamma table and intensity table.
 */
export function GL_InitImages(runtime: GlImageRuntime): void {
  runtime.registration_sequence = 1;

  if (runtime.intensity_value <= 1) {
    runtime.intensity_value = 1;
  }

  runtime.inverse_intensity = 1 / runtime.intensity_value;
  Draw_GetPalette(runtime);
  GL_SetTexturePalette(runtime, runtime.d_8to24table);

  if (runtime.qglColorTableEXT) {
    runtime.d_16to8table = runtime.hooks.loadFile?.("pics/16to8.dat") ?? null;
    if (!runtime.d_16to8table) {
      failSysError(runtime, ERR_FATAL, "Couldn't load pics/16to8.pcx");
    }
  }

  let g = runtime.vid_gamma_value;
  if ((runtime.renderer_flags & (GL_RENDERER_VOODOO | GL_RENDERER_VOODOO2)) !== 0) {
    g = 1.0;
  }

  for (let i = 0; i < 256; i += 1) {
    if (g === 1) {
      runtime.gammatable[i] = i;
    } else {
      let inf = 255 * Math.pow((i + 0.5) / 255.5, g) + 0.5;
      if (inf < 0) {
        inf = 0;
      }
      if (inf > 255) {
        inf = 255;
      }
      runtime.gammatable[i] = inf;
    }
  }

  for (let i = 0; i < 256; i += 1) {
    let j = Math.trunc(i * runtime.intensity_value);
    if (j > 255) {
      j = 255;
    }
    runtime.intensitytable[i] = j;
  }
}

/**
 * Original name: GL_ShutdownImages
 * Source: ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Deletes every registered image texture and clears each image slot.
 */
export function GL_ShutdownImages(runtime: GlImageRuntime): void {
  for (let i = 0; i < runtime.numgltextures; i += 1) {
    const image = runtime.gltextures[i];
    if (!image.registration_sequence) {
      continue;
    }
    if (image.texnum > 0) {
      runtime.hooks.deleteTexture?.(image.texnum);
    }
    resetImage(image);
  }
}

/**
 * Original name: N/A
 * Source: N/A (image slot helper)
 * Category: New
 * Purpose: Find or reserve the next local `GlImage` slot for the ported image loader.
 */
function allocateImageSlot(runtime: GlImageRuntime): GlImage {
  for (let i = 0; i < runtime.numgltextures; i += 1) {
    const image = runtime.gltextures[i];
    if (!image.texnum) {
      return image;
    }
  }

  if (runtime.numgltextures === MAX_GLTEXTURES) {
    failSysError(runtime, ERR_DROP, "MAX_GLTEXTURES");
  }

  const image = runtime.gltextures[runtime.numgltextures];
  runtime.numgltextures += 1;
  return image;
}

/**
 * Original name: N/A
 * Source: N/A (image slot helper)
 * Category: New
 * Purpose: Clear a reusable `GlImage` slot after free or shutdown.
 */
function resetImage(image: GlImage): void {
  image.name = "";
  image.type = imagetype_t.it_pic;
  image.width = 0;
  image.height = 0;
  image.upload_width = 0;
  image.upload_height = 0;
  image.registration_sequence = 0;
  image.texturechain = null;
  image.texnum = 0;
  image.sl = 0;
  image.tl = 0;
  image.sh = 1;
  image.th = 1;
  image.scrap = false;
  image.has_alpha = false;
  image.paletted = false;
}

/**
 * Original name: N/A
 * Source: N/A (image list formatting helper)
 * Category: New
 * Purpose: Format image type prefixes for the ported `GL_ImageList_f` output.
 */
function imageTypePrefix(type: imagetype_t): string {
  switch (type) {
    case imagetype_t.it_skin:
      return "M";
    case imagetype_t.it_sprite:
      return "S";
    case imagetype_t.it_wall:
      return "W";
    case imagetype_t.it_pic:
      return "P";
    default:
      return " ";
  }
}

/**
 * Original name: N/A
 * Source: N/A (renderer upload adapter)
 * Category: New
 * Purpose: Provide upload metadata when no backend-specific upload hook is installed.
 */
function defaultUploadImage(runtime: GlImageRuntime, source: GlImageUploadSource): GlImageUploadResult {
  const uploadSize = calculateUploadSize(runtime, source.width, source.height, source.mipmap);
  let has_alpha = false;

  if (source.bits === 8) {
    const pixels = source.pixels as Uint8Array;
    has_alpha = pixels.includes(255);
  } else {
    const pixels = source.pixels as Uint32Array;
    has_alpha = pixels.some((value) => ((value >>> 24) & 0xff) !== 255);
  }

  const paletted = runtime.qglColorTableEXT && runtime.gl_ext_palettedtexture_value && source.is_sky;
  return {
    upload_width: uploadSize.width,
    upload_height: uploadSize.height,
    has_alpha,
    paletted
  };
}

/**
 * Original name: N/A
 * Source: N/A (renderer upload adapter)
 * Category: New
 * Purpose: Mirror the ported upload dimension decisions for backend upload hooks.
 */
function calculateUploadSize(runtime: GlImageRuntime, width: number, height: number, mipmap: boolean): { width: number; height: number } {
  let scaled_width = nextPowerOfTwo(width);
  let scaled_height = nextPowerOfTwo(height);

  if (runtime.gl_round_down_value && scaled_width > width && mipmap) {
    scaled_width >>= 1;
  }
  if (runtime.gl_round_down_value && scaled_height > height && mipmap) {
    scaled_height >>= 1;
  }

  if (mipmap) {
    scaled_width >>= runtime.gl_picmip_value;
    scaled_height >>= runtime.gl_picmip_value;
  }

  if (scaled_width > 256) {
    scaled_width = 256;
  }
  if (scaled_height > 256) {
    scaled_height = 256;
  }

  return {
    width: Math.max(1, scaled_width),
    height: Math.max(1, scaled_height)
  };
}

/**
 * Original name: N/A
 * Source: N/A (texture upload helper)
 * Category: New
 * Purpose: Compute the next power-of-two texture size used by the upload path.
 */
function nextPowerOfTwo(value: number): number {
  let size = 1;
  while (size < value) {
    size <<= 1;
  }
  return size;
}

/**
 * Original name: N/A
 * Source: N/A (renderer backend adapter)
 * Category: New
 * Purpose: Narrow the optional multitexture selection hook before invoking it.
 */
function hasSelectTextureHook(runtime: GlImageRuntime): boolean {
  return typeof runtime.hooks.selectTexture === "function";
}

/**
 * Original name: N/A
 * Source: N/A (texture upload helper)
 * Category: New
 * Purpose: Reinterpret packed RGBA bytes as 32-bit pixels for the ported upload path.
 */
function toUint32Pixels(pixels: Uint8Array): Uint32Array {
  const source = pixels.byteOffset === 0 && pixels.byteLength % 4 === 0
    ? pixels
    : pixels.slice();
  return new Uint32Array(source.buffer, source.byteOffset, source.byteLength >> 2);
}

/**
 * Original name: N/A
 * Source: N/A (RGBA packing helper)
 * Category: New
 * Purpose: Extract the red byte from Quake-style packed RGBA pixels.
 */
function redOf(value: number): number {
  return value & 0xff;
}

/**
 * Original name: N/A
 * Source: N/A (RGBA packing helper)
 * Category: New
 * Purpose: Extract the green byte from Quake-style packed RGBA pixels.
 */
function greenOf(value: number): number {
  return (value >> 8) & 0xff;
}

/**
 * Original name: N/A
 * Source: N/A (RGBA packing helper)
 * Category: New
 * Purpose: Extract the blue byte from Quake-style packed RGBA pixels.
 */
function blueOf(value: number): number {
  return (value >> 16) & 0xff;
}

/**
 * Original name: N/A
 * Source: N/A (RGBA packing helper)
 * Category: New
 * Purpose: Extract the alpha byte from Quake-style packed RGBA pixels.
 */
function alphaOf(value: number): number {
  return (value >>> 24) & 0xff;
}

/**
 * Original name: N/A
 * Source: N/A (RGBA packing helper)
 * Category: New
 * Purpose: Pack RGBA bytes into the numeric pixel representation used by upload code.
 */
function packRgba(r: number, g: number, b: number, a: number): number {
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/**
 * Original name: N/A
 * Source: N/A (renderer error adapter)
 * Category: New
 * Purpose: Route fatal renderer errors through the host hook when available.
 */
function failSysError(runtime: GlImageRuntime, errLevel: number, message: string): never {
  if (runtime.hooks.Sys_Error) {
    return runtime.hooks.Sys_Error(errLevel, message);
  }

  throw new Error(message);
}
