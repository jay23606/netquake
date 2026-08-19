/**
 * File: gl_draw.ts
 * Source: Quake II original / ref_gl/gl_draw.c
 * Purpose: Port the 2D GL refresh drawing helpers used for pics, console glyphs, fades and cinematics.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Replaces renderer globals with an explicit runtime object.
 * - Routes GL state changes, texture uploads and quad emission through hooks.
 * - Represents `image_t` with a structured local view layered on top of the renderer-owned opaque handle.
 *
 * Notes:
 * - This file is the principal attachment point for `ref_gl/gl_draw.c`.
 * - The current tranche preserves the original naming rules, draw routing, palette conversion
 *   and raw cinematic upload path while deferring actual GPU work to backend hooks.
 */

import { ERR_FATAL, MAX_QPATH, PRINT_ALL } from "../../qcommon/src/index.js";
import type { image_t } from "./gl_model.js";

/**
 * Original name: GL_RENDERER_RENDITION
 * Source: ref_gl/gl_local.h
 * Category: Adapter
 * Purpose: Local renderer flag copy used by the `gl_draw.c` alpha-test workaround.
 */
export const GL_RENDERER_RENDITION = 0x001c0000;

/**
 * Original name: GL_RENDERER_MCD
 * Source: ref_gl/gl_local.h
 * Category: Adapter
 * Purpose: Local renderer flag copy used by the `gl_draw.c` alpha-test workaround.
 */
export const GL_RENDERER_MCD = 0x01000000;

/**
 * Original name: N/A
 * Source: N/A (OpenGL/WebGL numeric constants)
 * Category: New
 * Purpose: Preserve the texture upload format used by the draw raw backend hook.
 */
export const GL_COLOR_INDEX = 0x1900;

/**
 * Original name: N/A
 * Source: N/A (OpenGL/WebGL numeric constants)
 * Category: New
 * Purpose: Preserve the texture upload format used by the draw raw backend hook.
 */
export const GL_RGBA = 0x1908;

/**
 * Original name: N/A
 * Source: N/A (OpenGL/WebGL numeric constants)
 * Category: New
 * Purpose: Preserve the texture upload type used by the draw raw backend hook.
 */
export const GL_UNSIGNED_BYTE = 0x1401;

/**
 * Original name: N/A
 * Source: N/A (OpenGL/WebGL numeric constants)
 * Category: New
 * Purpose: Preserve the paletted texture upload format used by the draw raw backend hook.
 */
export const GL_COLOR_INDEX8_EXT = 0x80e5;

/**
 * Original name: N/A
 * Source: N/A (renderer hook contract)
 * Category: New
 * Purpose: Name the texture filter modes accepted by the draw backend hooks.
 */
export type GlFilterMode = "nearest" | "linear";

/**
 * Original name: image_t
 * Source: ref_gl/gl_local.h
 * Category: Adapter
 * Purpose: Local view of the `image_t` fields consumed by `gl_draw.c`.
 */
export interface GlDrawImage {
  name: string;
  width: number;
  height: number;
  texnum: number;
  sl: number;
  tl: number;
  sh: number;
  th: number;
  has_alpha: boolean;
}

/**
 * Original name: N/A
 * Source: N/A (renderer hook contract)
 * Category: New
 * Purpose: Describe one textured quad emitted by the draw backend adapter.
 */
export interface GlDrawQuad {
  x: number;
  y: number;
  width: number;
  height: number;
  sl: number;
  tl: number;
  sh: number;
  th: number;
}

/**
 * Original name: N/A
 * Source: N/A (renderer hook contract)
 * Category: New
 * Purpose: Describe one raw cinematic texture upload emitted by `Draw_StretchRaw`.
 */
export interface GlDrawRawUpload {
  width: number;
  height: number;
  internalFormat: number;
  format: number;
  type: number;
  data: Uint8Array | Uint32Array;
}

/**
 * Original name: N/A
 * Source: N/A (renderer hook contract)
 * Category: New
 * Purpose: Collect renderer callbacks replacing direct qgl/ri calls from `gl_draw.c`.
 */
export interface GlDrawHooks {
  findImage?: (name: string, type: "pic") => image_t | null;
  uploadScrap?: () => void;
  bindTexture?: (texnum: number) => void;
  setTextureFilter?: (texnum: number, minFilter: GlFilterMode, magFilter: GlFilterMode) => void;
  setAlphaTestEnabled?: (enabled: boolean) => void;
  setTextureEnabled?: (enabled: boolean) => void;
  setBlendEnabled?: (enabled: boolean) => void;
  setDrawColor?: (red: number, green: number, blue: number, alpha: number) => void;
  drawTexturedQuad?: (quad: GlDrawQuad) => void;
  drawSolidQuad?: (x: number, y: number, width: number, height: number) => void;
  uploadRawTexture?: (upload: GlDrawRawUpload) => void;
  Con_Printf?: (printLevel: number, message: string) => void;
  Sys_Error?: (errLevel: number, message: string) => never;
}

/**
 * Original name: N/A
 * Source: N/A (renderer runtime adapter)
 * Category: New
 * Purpose: Hold the explicit draw runtime state replacing the `gl_draw.c` globals.
 */
export interface GlDrawRuntime {
  draw_chars: image_t | null;
  scrap_dirty: boolean;
  gl_config_renderer: number;
  gl_tex_solid_format: number;
  vid_width: number;
  vid_height: number;
  d_8to24table: Uint32Array;
  r_rawpalette: Uint32Array;
  qglColorTableEXT: boolean;
  hooks: GlDrawHooks;
}

/**
 * Original name: N/A
 * Source: N/A (renderer runtime adapter)
 * Category: New
 * Purpose: Create one explicit runtime replacing the `gl_draw.c` globals.
 */
export function createGlDrawRuntime(hooks: GlDrawHooks = {}): GlDrawRuntime {
  return {
    draw_chars: null,
    scrap_dirty: false,
    gl_config_renderer: 0,
    gl_tex_solid_format: 3,
    vid_width: 0,
    vid_height: 0,
    d_8to24table: new Uint32Array(256),
    r_rawpalette: new Uint32Array(256),
    qglColorTableEXT: false,
    hooks
  };
}

/**
 * Original name: N/A
 * Source: N/A (renderer image adapter)
 * Category: New
 * Purpose: Create one image handle shaped like the `image_t` fields consumed by `gl_draw.c`.
 */
export function createGlDrawImage(overrides: Partial<GlDrawImage> = {}): GlDrawImage {
  return {
    name: "",
    width: 0,
    height: 0,
    texnum: 0,
    sl: 0,
    tl: 0,
    sh: 1,
    th: 1,
    has_alpha: true,
    ...overrides
  };
}

/**
 * Original name: N/A
 * Source: N/A (renderer runtime adapter)
 * Category: New
 * Purpose: Bind the current renderer identification flags consumed by the alpha-test workaround.
 */
export function setRendererFlags(runtime: GlDrawRuntime, renderer: number): void {
  runtime.gl_config_renderer = renderer;
}

/**
 * Original name: N/A
 * Source: N/A (renderer runtime adapter)
 * Category: New
 * Purpose: Bind the current `vid.width` / `vid.height` pair used by `Draw_FadeScreen`.
 */
export function setVidState(runtime: GlDrawRuntime, width: number, height: number): void {
  runtime.vid_width = width;
  runtime.vid_height = height;
}

/**
 * Original name: N/A
 * Source: N/A (renderer runtime adapter)
 * Category: New
 * Purpose: Bind the current 8-bit to RGBA lookup table consumed by `Draw_Fill`.
 */
export function setPalette8to24(runtime: GlDrawRuntime, table: Uint32Array | readonly number[]): void {
  runtime.d_8to24table = coercePaletteTable(table);
}

/**
 * Original name: N/A
 * Source: N/A (renderer runtime adapter)
 * Category: New
 * Purpose: Bind the current raw cinematic palette used by `Draw_StretchRaw`.
 */
export function setRawPalette(runtime: GlDrawRuntime, palette: Uint32Array | readonly number[]): void {
  runtime.r_rawpalette = coercePaletteTable(palette);
}

/**
 * Original name: N/A
 * Source: N/A (renderer runtime adapter)
 * Category: New
 * Purpose: Preserve the original `scrap_dirty` flag controlling deferred scrap uploads.
 */
export function setScrapDirty(runtime: GlDrawRuntime, dirty: boolean): void {
  runtime.scrap_dirty = dirty;
}

/**
 * Original name: N/A
 * Source: N/A (renderer runtime adapter)
 * Category: New
 * Purpose: Preserve the current `qglColorTableEXT` availability used by `Draw_StretchRaw`.
 */
export function setColorTableExtensionEnabled(runtime: GlDrawRuntime, enabled: boolean): void {
  runtime.qglColorTableEXT = enabled;
}

/**
 * Original name: N/A
 * Source: N/A (renderer runtime adapter)
 * Category: New
 * Purpose: Bind the current solid texture internal format selected by `gl_image.c`.
 */
export function setGlTexSolidFormat(runtime: GlDrawRuntime, format: number): void {
  runtime.gl_tex_solid_format = format;
}

/**
 * Original name: Draw_InitLocal
 * Source: ref_gl/gl_draw.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Loads the shared `conchars` atlas and forces nearest-neighbor filtering for glyph rendering.
 */
export function Draw_InitLocal(runtime: GlDrawRuntime): void {
  const drawChars = runtime.hooks.findImage?.("pics/conchars.pcx", "pic") ?? null;
  if (!drawChars) {
    throw new Error("Draw_InitLocal: pics/conchars.pcx not found");
  }

  runtime.draw_chars = drawChars;
  const image = getGlDrawImage(drawChars, "Draw_InitLocal");
  runtime.hooks.bindTexture?.(image.texnum);
  runtime.hooks.setTextureFilter?.(image.texnum, "nearest", "nearest");
}

/**
 * Original name: Draw_Char
 * Source: ref_gl/gl_draw.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Draws one 8x8 cell from the shared console character atlas.
 */
export function Draw_Char(runtime: GlDrawRuntime, x: number, y: number, num: number): void {
  const drawChars = runtime.draw_chars;
  if (!drawChars) {
    throw new Error("Draw_Char: draw_chars not initialized");
  }

  num &= 255;

  if ((num & 127) === 32) {
    return;
  }

  if (y <= -8) {
    return;
  }

  const row = num >> 4;
  const col = num & 15;
  const frow = row * 0.0625;
  const fcol = col * 0.0625;
  const size = 0.0625;

  const image = getGlDrawImage(drawChars, "Draw_Char");
  runtime.hooks.bindTexture?.(image.texnum);
  runtime.hooks.drawTexturedQuad?.({
    x,
    y,
    width: 8,
    height: 8,
    sl: fcol,
    tl: frow,
    sh: fcol + size,
    th: frow + size
  });
}

/**
 * Original name: Draw_FindPic
 * Source: ref_gl/gl_draw.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Resolves one Quake II pic name using the original `pics/<name>.pcx` fallback rule.
 */
export function Draw_FindPic(runtime: GlDrawRuntime, name: string): image_t | null {
  const resolvedName = resolvePicName(name);
  return runtime.hooks.findImage?.(resolvedName, "pic") ?? null;
}

/**
 * Original name: Draw_GetPicSize
 * Source: ref_gl/gl_draw.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns the width and height of one picture, or `-1/-1` when unavailable.
 */
export function Draw_GetPicSize(runtime: GlDrawRuntime, pic: string): { width: number; height: number } {
  const image = Draw_FindPic(runtime, pic);
  if (!image) {
    return { width: -1, height: -1 };
  }

  const view = getGlDrawImage(image, "Draw_GetPicSize");
  return { width: view.width, height: view.height };
}

/**
 * Original name: Draw_StretchPic
 * Source: ref_gl/gl_draw.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Draws one HUD picture stretched to the requested pixel rectangle.
 */
export function Draw_StretchPic(runtime: GlDrawRuntime, x: number, y: number, w: number, h: number, pic: string): void {
  const image = Draw_FindPic(runtime, pic);
  if (!image) {
    runtime.hooks.Con_Printf?.(PRINT_ALL, `Can't find pic: ${pic}\n`);
    return;
  }

  uploadScrapIfDirty(runtime);
  drawPictureQuad(runtime, getGlDrawImage(image, "Draw_StretchPic"), x, y, w, h);
}

/**
 * Original name: Draw_Pic
 * Source: ref_gl/gl_draw.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Draws one picture at its natural dimensions.
 */
export function Draw_Pic(runtime: GlDrawRuntime, x: number, y: number, pic: string): void {
  const image = Draw_FindPic(runtime, pic);
  if (!image) {
    runtime.hooks.Con_Printf?.(PRINT_ALL, `Can't find pic: ${pic}\n`);
    return;
  }

  uploadScrapIfDirty(runtime);
  const view = getGlDrawImage(image, "Draw_Pic");
  drawPictureQuad(runtime, view, x, y, view.width, view.height);
}

/**
 * Original name: Draw_TileClear
 * Source: ref_gl/gl_draw.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Tiles one 64x64 picture across the requested screen rectangle.
 */
export function Draw_TileClear(runtime: GlDrawRuntime, x: number, y: number, w: number, h: number, pic: string): void {
  const image = Draw_FindPic(runtime, pic);
  if (!image) {
    runtime.hooks.Con_Printf?.(PRINT_ALL, `Can't find pic: ${pic}\n`);
    return;
  }

  const view = getGlDrawImage(image, "Draw_TileClear");
  withAlphaTestWorkaround(runtime, view, () => {
    runtime.hooks.bindTexture?.(view.texnum);
    runtime.hooks.drawTexturedQuad?.({
      x,
      y,
      width: w,
      height: h,
      sl: x / 64.0,
      tl: y / 64.0,
      sh: (x + w) / 64.0,
      th: (y + h) / 64.0
    });
  });
}

/**
 * Original name: Draw_Fill
 * Source: ref_gl/gl_draw.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Fills one rectangle with one indexed Quake II palette color.
 */
export function Draw_Fill(runtime: GlDrawRuntime, x: number, y: number, w: number, h: number, c: number): void {
  if (c < 0 || c > 255) {
    failSysError(runtime, ERR_FATAL, "Draw_Fill: bad color");
  }

  const color = runtime.d_8to24table[c] ?? 0;
  runtime.hooks.setTextureEnabled?.(false);
  runtime.hooks.setDrawColor?.(
    (color & 0xff) / 255.0,
    ((color >> 8) & 0xff) / 255.0,
    ((color >> 16) & 0xff) / 255.0,
    1
  );
  runtime.hooks.drawSolidQuad?.(x, y, w, h);
  runtime.hooks.setDrawColor?.(1, 1, 1, 1);
  runtime.hooks.setTextureEnabled?.(true);
}

/**
 * Original name: Draw_FadeScreen
 * Source: ref_gl/gl_draw.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Draws the translucent full-screen black fade used by menus and cinematic overlays.
 */
export function Draw_FadeScreen(runtime: GlDrawRuntime): void {
  runtime.hooks.setBlendEnabled?.(true);
  runtime.hooks.setTextureEnabled?.(false);
  runtime.hooks.setDrawColor?.(0, 0, 0, 0.8);
  runtime.hooks.drawSolidQuad?.(0, 0, runtime.vid_width, runtime.vid_height);
  runtime.hooks.setDrawColor?.(1, 1, 1, 1);
  runtime.hooks.setTextureEnabled?.(true);
  runtime.hooks.setBlendEnabled?.(false);
}

/**
 * Original name: Draw_StretchRaw
 * Source: ref_gl/gl_draw.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Uploads and draws one paletted cinematic frame resampled to a 256x256 working texture.
 *
 * Porting notes:
 * - Texture upload is deferred to a backend hook but the original CPU-side resampling and
 *   palette expansion path are preserved byte-for-byte in spirit.
 */
export function Draw_StretchRaw(
  runtime: GlDrawRuntime,
  x: number,
  y: number,
  w: number,
  h: number,
  cols: number,
  rows: number,
  data: Uint8Array
): void {
  const image32 = new Uint32Array(256 * 256);
  const image8 = new Uint8Array(256 * 256);
  let trows: number;
  let hscale: number;

  runtime.hooks.bindTexture?.(0);

  if (rows <= 256) {
    hscale = 1;
    trows = rows;
  } else {
    hscale = rows / 256.0;
    trows = 256;
  }

  const t = (rows * hscale) / 256;

  if (!runtime.qglColorTableEXT) {
    for (let i = 0; i < trows; i += 1) {
      const row = Math.trunc(i * hscale);
      if (row > rows) {
        break;
      }

      const sourceOffset = cols * row;
      let fracstep = Math.trunc((cols * 0x10000) / 256);
      let frac = fracstep >> 1;
      const destOffset = i * 256;

      for (let j = 0; j < 256; j += 1) {
        image32[destOffset + j] = runtime.r_rawpalette[data[sourceOffset + (frac >> 16)] ?? 0] ?? 0;
        frac += fracstep;
      }
    }

    runtime.hooks.uploadRawTexture?.({
      width: 256,
      height: 256,
      internalFormat: runtime.gl_tex_solid_format,
      format: GL_RGBA,
      type: GL_UNSIGNED_BYTE,
      data: image32
    });
  } else {
    for (let i = 0; i < trows; i += 1) {
      const row = Math.trunc(i * hscale);
      if (row > rows) {
        break;
      }

      const sourceOffset = cols * row;
      let fracstep = Math.trunc((cols * 0x10000) / 256);
      let frac = fracstep >> 1;
      const destOffset = i * 256;

      for (let j = 0; j < 256; j += 1) {
        image8[destOffset + j] = data[sourceOffset + (frac >> 16)] ?? 0;
        frac += fracstep;
      }
    }

    runtime.hooks.uploadRawTexture?.({
      width: 256,
      height: 256,
      internalFormat: GL_COLOR_INDEX8_EXT,
      format: GL_COLOR_INDEX,
      type: GL_UNSIGNED_BYTE,
      data: image8
    });
  }

  runtime.hooks.setTextureFilter?.(0, "linear", "linear");

  const shouldToggleAlpha = usesAlphaTestWorkaround(runtime, null);
  if (shouldToggleAlpha) {
    runtime.hooks.setAlphaTestEnabled?.(false);
  }

  runtime.hooks.drawTexturedQuad?.({
    x,
    y,
    width: w,
    height: h,
    sl: 0,
    tl: 0,
    sh: 1,
    th: t
  });

  if (shouldToggleAlpha) {
    runtime.hooks.setAlphaTestEnabled?.(true);
  }
}

/**
 * Original name: scrap_dirty / Scrap_Upload
 * Source: ref_gl/gl_draw.c
 * Category: Adapter
 * Purpose: Factor the repeated deferred scrap upload gate shared by `Draw_StretchPic` and `Draw_Pic`.
 */
function uploadScrapIfDirty(runtime: GlDrawRuntime): void {
  if (!runtime.scrap_dirty) {
    return;
  }

  runtime.hooks.uploadScrap?.();
  runtime.scrap_dirty = false;
}

/**
 * Original name: N/A
 * Source: N/A (renderer draw adapter)
 * Category: New
 * Purpose: Emit the common textured quad shape used by picture draw calls.
 */
function drawPictureQuad(runtime: GlDrawRuntime, image: GlDrawImage, x: number, y: number, width: number, height: number): void {
  withAlphaTestWorkaround(runtime, image, () => {
    runtime.hooks.bindTexture?.(image.texnum);
    runtime.hooks.drawTexturedQuad?.({
      x,
      y,
      width,
      height,
      sl: image.sl,
      tl: image.tl,
      sh: image.sh,
      th: image.th
    });
  });
}

/**
 * Original name: N/A
 * Source: N/A (renderer draw adapter)
 * Category: New
 * Purpose: Scope the Rendition/MCD alpha-test workaround around one draw operation.
 */
function withAlphaTestWorkaround(runtime: GlDrawRuntime, image: GlDrawImage | null, draw: () => void): void {
  const shouldToggleAlpha = usesAlphaTestWorkaround(runtime, image);
  if (shouldToggleAlpha) {
    runtime.hooks.setAlphaTestEnabled?.(false);
  }

  draw();

  if (shouldToggleAlpha) {
    runtime.hooks.setAlphaTestEnabled?.(true);
  }
}

/**
 * Original name: N/A
 * Source: N/A (renderer draw adapter)
 * Category: New
 * Purpose: Centralize the alpha-test workaround predicate from the original draw paths.
 */
function usesAlphaTestWorkaround(runtime: GlDrawRuntime, image: GlDrawImage | null): boolean {
  if (image && image.has_alpha) {
    return false;
  }

  return runtime.gl_config_renderer === GL_RENDERER_MCD || (runtime.gl_config_renderer & GL_RENDERER_RENDITION) !== 0;
}

/**
 * Original name: Draw_FindPic name normalization
 * Source: ref_gl/gl_draw.c
 * Category: Adapter
 * Purpose: Isolate the original `pics/<name>.pcx` lookup rule for hooks that need it.
 */
function resolvePicName(name: string): string {
  if (name[0] !== "/" && name[0] !== "\\") {
    return truncateQPath(`pics/${name}.pcx`);
  }

  return name.slice(1);
}

/**
 * Original name: image_t field access
 * Source: ref_gl/gl_local.h
 * Category: Adapter
 * Purpose: Read the `image_t` fields consumed by `gl_draw.c` from the renderer image handle.
 */
function getGlDrawImage(image: image_t, functionName: string): GlDrawImage {
  if (!image || typeof image !== "object") {
    throw new Error(`${functionName}: invalid image handle`);
  }

  const record = image as Record<string, unknown>;
  const width = readRequiredNumber(record, "width", functionName);
  const height = readRequiredNumber(record, "height", functionName);
  const texnum = readRequiredNumber(record, "texnum", functionName);

  return {
    name: typeof record.name === "string" ? record.name : "",
    width,
    height,
    texnum,
    sl: readOptionalNumber(record, "sl", 0),
    tl: readOptionalNumber(record, "tl", 0),
    sh: readOptionalNumber(record, "sh", 1),
    th: readOptionalNumber(record, "th", 1),
    has_alpha: typeof record.has_alpha === "boolean"
      ? record.has_alpha
      : typeof record.hasAlpha === "boolean"
        ? record.hasAlpha
        : true
  };
}

/**
 * Original name: N/A
 * Source: N/A (renderer image adapter)
 * Category: New
 * Purpose: Validate required numeric fields on opaque renderer image handles.
 */
function readRequiredNumber(record: Record<string, unknown>, key: string, functionName: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${functionName}: image missing numeric ${key}`);
  }

  return value;
}

/**
 * Original name: N/A
 * Source: N/A (renderer image adapter)
 * Category: New
 * Purpose: Read optional numeric texture coordinate fields from opaque image handles.
 */
function readOptionalNumber(record: Record<string, unknown>, key: string, fallback: number): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Original name: ri.Sys_Error call site
 * Source: ref_gl/gl_draw.c
 * Category: Adapter
 * Purpose: Preserve fatal error dispatch while allowing the backend hook to own the platform exit path.
 */
function failSysError(runtime: GlDrawRuntime, errLevel: number, message: string): never {
  if (runtime.hooks.Sys_Error) {
    return runtime.hooks.Sys_Error(errLevel, message);
  }

  throw new Error(message);
}

/**
 * Original name: N/A
 * Source: N/A (renderer runtime adapter)
 * Category: New
 * Purpose: Normalize palette inputs to the fixed 256-entry tables expected by draw routines.
 */
function coercePaletteTable(table: Uint32Array | readonly number[]): Uint32Array {
  const out = new Uint32Array(256);
  const count = Math.min(256, table.length);
  for (let index = 0; index < count; index += 1) {
    out[index] = table[index] ?? 0;
  }
  return out;
}

/**
 * Original name: Com_sprintf MAX_QPATH truncation
 * Source: ref_gl/gl_draw.c
 * Category: Adapter
 * Purpose: Keep picture lookup names within the original fixed qpath limit.
 */
function truncateQPath(path: string): string {
  if (path.length < MAX_QPATH) {
    return path;
  }

  return path.slice(0, MAX_QPATH - 1);
}
