/**
 * File: qgl.ts
 * Source: Quake II original / ref_gl/qgl.h
 * Purpose: Port the QGL symbol header used by the original OpenGL renderer.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Replaces global C function pointers with an explicit runtime object.
 * - Uses browser-friendly symbol providers instead of platform GL DLL loading.
 * - Keeps Win32 `qwgl*` bindings as inventory only because native WGL bootstrap is out of scope here.
 *
 * Notes:
 * - This file is the principal attachment point for `ref_gl/qgl.h`.
 * - This tranche preserves the full `qgl.h` procedure inventory so later
 *   renderer ports can bind against the original symbol names directly.
 * - Per-procedure C signatures stay verified against the original header by
 *   `scripts/verify/quake2-qgl-header.ts`; the runtime dispatch type remains
 *   intentionally generic because browser/WebGL providers are adapter calls.
 */

import type { GlRmainHooks } from "./gl_rmain.js";

export type qboolean = boolean;

export type QglProcedure = (...args: unknown[]) => unknown;
export type QwglProcedure = (...args: unknown[]) => unknown;

export const QGL_PROCEDURES = [
  "qglAccum",
  "qglAlphaFunc",
  "qglAreTexturesResident",
  "qglArrayElement",
  "qglBegin",
  "qglBindTexture",
  "qglBitmap",
  "qglBlendFunc",
  "qglCallList",
  "qglCallLists",
  "qglClear",
  "qglClearAccum",
  "qglClearColor",
  "qglClearDepth",
  "qglClearIndex",
  "qglClearStencil",
  "qglClipPlane",
  "qglColor3b",
  "qglColor3bv",
  "qglColor3d",
  "qglColor3dv",
  "qglColor3f",
  "qglColor3fv",
  "qglColor3i",
  "qglColor3iv",
  "qglColor3s",
  "qglColor3sv",
  "qglColor3ub",
  "qglColor3ubv",
  "qglColor3ui",
  "qglColor3uiv",
  "qglColor3us",
  "qglColor3usv",
  "qglColor4b",
  "qglColor4bv",
  "qglColor4d",
  "qglColor4dv",
  "qglColor4f",
  "qglColor4fv",
  "qglColor4i",
  "qglColor4iv",
  "qglColor4s",
  "qglColor4sv",
  "qglColor4ub",
  "qglColor4ubv",
  "qglColor4ui",
  "qglColor4uiv",
  "qglColor4us",
  "qglColor4usv",
  "qglColorMask",
  "qglColorMaterial",
  "qglColorPointer",
  "qglCopyPixels",
  "qglCopyTexImage1D",
  "qglCopyTexImage2D",
  "qglCopyTexSubImage1D",
  "qglCopyTexSubImage2D",
  "qglCullFace",
  "qglDeleteLists",
  "qglDeleteTextures",
  "qglDepthFunc",
  "qglDepthMask",
  "qglDepthRange",
  "qglDisable",
  "qglDisableClientState",
  "qglDrawArrays",
  "qglDrawBuffer",
  "qglDrawElements",
  "qglDrawPixels",
  "qglEdgeFlag",
  "qglEdgeFlagPointer",
  "qglEdgeFlagv",
  "qglEnable",
  "qglEnableClientState",
  "qglEnd",
  "qglEndList",
  "qglEvalCoord1d",
  "qglEvalCoord1dv",
  "qglEvalCoord1f",
  "qglEvalCoord1fv",
  "qglEvalCoord2d",
  "qglEvalCoord2dv",
  "qglEvalCoord2f",
  "qglEvalCoord2fv",
  "qglEvalMesh1",
  "qglEvalMesh2",
  "qglEvalPoint1",
  "qglEvalPoint2",
  "qglFeedbackBuffer",
  "qglFinish",
  "qglFlush",
  "qglFogf",
  "qglFogfv",
  "qglFogi",
  "qglFogiv",
  "qglFrontFace",
  "qglFrustum",
  "qglGenLists",
  "qglGenTextures",
  "qglGetBooleanv",
  "qglGetClipPlane",
  "qglGetDoublev",
  "qglGetError",
  "qglGetFloatv",
  "qglGetIntegerv",
  "qglGetLightfv",
  "qglGetLightiv",
  "qglGetMapdv",
  "qglGetMapfv",
  "qglGetMapiv",
  "qglGetMaterialfv",
  "qglGetMaterialiv",
  "qglGetPixelMapfv",
  "qglGetPixelMapuiv",
  "qglGetPixelMapusv",
  "qglGetPointerv",
  "qglGetPolygonStipple",
  "qglGetString",
  "qglGetTexEnvfv",
  "qglGetTexEnviv",
  "qglGetTexGendv",
  "qglGetTexGenfv",
  "qglGetTexGeniv",
  "qglGetTexImage",
  "qglGetTexLevelParameterfv",
  "qglGetTexLevelParameteriv",
  "qglGetTexParameterfv",
  "qglGetTexParameteriv",
  "qglHint",
  "qglIndexMask",
  "qglIndexPointer",
  "qglIndexd",
  "qglIndexdv",
  "qglIndexf",
  "qglIndexfv",
  "qglIndexi",
  "qglIndexiv",
  "qglIndexs",
  "qglIndexsv",
  "qglIndexub",
  "qglIndexubv",
  "qglInitNames",
  "qglInterleavedArrays",
  "qglIsEnabled",
  "qglIsList",
  "qglIsTexture",
  "qglLightModelf",
  "qglLightModelfv",
  "qglLightModeli",
  "qglLightModeliv",
  "qglLightf",
  "qglLightfv",
  "qglLighti",
  "qglLightiv",
  "qglLineStipple",
  "qglLineWidth",
  "qglListBase",
  "qglLoadIdentity",
  "qglLoadMatrixd",
  "qglLoadMatrixf",
  "qglLoadName",
  "qglLogicOp",
  "qglMap1d",
  "qglMap1f",
  "qglMap2d",
  "qglMap2f",
  "qglMapGrid1d",
  "qglMapGrid1f",
  "qglMapGrid2d",
  "qglMapGrid2f",
  "qglMaterialf",
  "qglMaterialfv",
  "qglMateriali",
  "qglMaterialiv",
  "qglMatrixMode",
  "qglMultMatrixd",
  "qglMultMatrixf",
  "qglNewList",
  "qglNormal3b",
  "qglNormal3bv",
  "qglNormal3d",
  "qglNormal3dv",
  "qglNormal3f",
  "qglNormal3fv",
  "qglNormal3i",
  "qglNormal3iv",
  "qglNormal3s",
  "qglNormal3sv",
  "qglNormalPointer",
  "qglOrtho",
  "qglPassThrough",
  "qglPixelMapfv",
  "qglPixelMapuiv",
  "qglPixelMapusv",
  "qglPixelStoref",
  "qglPixelStorei",
  "qglPixelTransferf",
  "qglPixelTransferi",
  "qglPixelZoom",
  "qglPointSize",
  "qglPolygonMode",
  "qglPolygonOffset",
  "qglPolygonStipple",
  "qglPopAttrib",
  "qglPopClientAttrib",
  "qglPopMatrix",
  "qglPopName",
  "qglPrioritizeTextures",
  "qglPushAttrib",
  "qglPushClientAttrib",
  "qglPushMatrix",
  "qglPushName",
  "qglRasterPos2d",
  "qglRasterPos2dv",
  "qglRasterPos2f",
  "qglRasterPos2fv",
  "qglRasterPos2i",
  "qglRasterPos2iv",
  "qglRasterPos2s",
  "qglRasterPos2sv",
  "qglRasterPos3d",
  "qglRasterPos3dv",
  "qglRasterPos3f",
  "qglRasterPos3fv",
  "qglRasterPos3i",
  "qglRasterPos3iv",
  "qglRasterPos3s",
  "qglRasterPos3sv",
  "qglRasterPos4d",
  "qglRasterPos4dv",
  "qglRasterPos4f",
  "qglRasterPos4fv",
  "qglRasterPos4i",
  "qglRasterPos4iv",
  "qglRasterPos4s",
  "qglRasterPos4sv",
  "qglReadBuffer",
  "qglReadPixels",
  "qglRectd",
  "qglRectdv",
  "qglRectf",
  "qglRectfv",
  "qglRecti",
  "qglRectiv",
  "qglRects",
  "qglRectsv",
  "qglRenderMode",
  "qglRotated",
  "qglRotatef",
  "qglScaled",
  "qglScalef",
  "qglScissor",
  "qglSelectBuffer",
  "qglShadeModel",
  "qglStencilFunc",
  "qglStencilMask",
  "qglStencilOp",
  "qglTexCoord1d",
  "qglTexCoord1dv",
  "qglTexCoord1f",
  "qglTexCoord1fv",
  "qglTexCoord1i",
  "qglTexCoord1iv",
  "qglTexCoord1s",
  "qglTexCoord1sv",
  "qglTexCoord2d",
  "qglTexCoord2dv",
  "qglTexCoord2f",
  "qglTexCoord2fv",
  "qglTexCoord2i",
  "qglTexCoord2iv",
  "qglTexCoord2s",
  "qglTexCoord2sv",
  "qglTexCoord3d",
  "qglTexCoord3dv",
  "qglTexCoord3f",
  "qglTexCoord3fv",
  "qglTexCoord3i",
  "qglTexCoord3iv",
  "qglTexCoord3s",
  "qglTexCoord3sv",
  "qglTexCoord4d",
  "qglTexCoord4dv",
  "qglTexCoord4f",
  "qglTexCoord4fv",
  "qglTexCoord4i",
  "qglTexCoord4iv",
  "qglTexCoord4s",
  "qglTexCoord4sv",
  "qglTexCoordPointer",
  "qglTexEnvf",
  "qglTexEnvfv",
  "qglTexEnvi",
  "qglTexEnviv",
  "qglTexGend",
  "qglTexGendv",
  "qglTexGenf",
  "qglTexGenfv",
  "qglTexGeni",
  "qglTexGeniv",
  "qglTexImage1D",
  "qglTexImage2D",
  "qglTexParameterf",
  "qglTexParameterfv",
  "qglTexParameteri",
  "qglTexParameteriv",
  "qglTexSubImage1D",
  "qglTexSubImage2D",
  "qglTranslated",
  "qglTranslatef",
  "qglVertex2d",
  "qglVertex2dv",
  "qglVertex2f",
  "qglVertex2fv",
  "qglVertex2i",
  "qglVertex2iv",
  "qglVertex2s",
  "qglVertex2sv",
  "qglVertex3d",
  "qglVertex3dv",
  "qglVertex3f",
  "qglVertex3fv",
  "qglVertex3i",
  "qglVertex3iv",
  "qglVertex3s",
  "qglVertex3sv",
  "qglVertex4d",
  "qglVertex4dv",
  "qglVertex4f",
  "qglVertex4fv",
  "qglVertex4i",
  "qglVertex4iv",
  "qglVertex4s",
  "qglVertex4sv",
  "qglVertexPointer",
  "qglViewport",
  "qglPointParameterfEXT",
  "qglPointParameterfvEXT",
  "qglColorTableEXT",
  "qglLockArraysEXT",
  "qglUnlockArraysEXT",
  "qglMTexCoord2fSGIS",
  "qglSelectTextureSGIS"
] as const;

export const QGL_OPTIONAL_PROCEDURES = [
  "qglPointParameterfEXT",
  "qglPointParameterfvEXT",
  "qglColorTableEXT",
  "qglLockArraysEXT",
  "qglUnlockArraysEXT",
  "qglMTexCoord2fSGIS",
  "qglSelectTextureSGIS"
] as const;

export const QWGL_WIN32_PROCEDURES = [
  "qwglChoosePixelFormat",
  "qwglDescribePixelFormat",
  "qwglGetPixelFormat",
  "qwglSetPixelFormat",
  "qwglSwapBuffers",
  "qwglCopyContext",
  "qwglCreateContext",
  "qwglCreateLayerContext",
  "qwglDeleteContext",
  "qwglGetCurrentContext",
  "qwglGetCurrentDC",
  "qwglGetProcAddress",
  "qwglMakeCurrent",
  "qwglShareLists",
  "qwglUseFontBitmaps",
  "qwglUseFontOutlines",
  "qwglDescribeLayerPlane",
  "qwglSetLayerPaletteEntries",
  "qwglGetLayerPaletteEntries",
  "qwglRealizeLayerPalette",
  "qwglSwapLayerBuffers",
  "qwglSwapIntervalEXT",
  "qwglGetDeviceGammaRampEXT",
  "qwglSetDeviceGammaRampEXT"
] as const;

export type QglProcedureName = (typeof QGL_PROCEDURES)[number];
export type QglOptionalProcedure = (typeof QGL_OPTIONAL_PROCEDURES)[number];
export type QglRequiredProcedure = Exclude<QglProcedureName, QglOptionalProcedure>;
export type QglInventoryProcedure = QglProcedureName;
export type QwglProcedureName = (typeof QWGL_WIN32_PROCEDURES)[number];
export type QwglInventoryProcedure = QwglProcedureName;

const QGL_OPTIONAL_PROCEDURE_SET = new Set<QglOptionalProcedure>(QGL_OPTIONAL_PROCEDURES);

export const QGL_REQUIRED_PROCEDURES = QGL_PROCEDURES.filter(
  (name): name is QglRequiredProcedure => !QGL_OPTIONAL_PROCEDURE_SET.has(name as QglOptionalProcedure)
);

export type QglDispatchTable = {
  [K in QglRequiredProcedure]: QglProcedure;
} & {
  [K in QglOptionalProcedure]: QglProcedure | null;
};

export type QwglDispatchTable = {
  [K in QwglProcedureName]: QwglProcedure;
};

export interface QglSymbolProvider {
  resolve(name: string): unknown;
  shutdown?(): void;
}

export interface QglRuntime {
  initialized: boolean;
  provider: QglSymbolProvider | null;
  availableProcedures: Set<QglInventoryProcedure>;
  missingRequiredProcedures: QglRequiredProcedure[];
  symbols: QglDispatchTable;
}

export interface QwglRuntime {
  initialized: boolean;
  provider: QglSymbolProvider | null;
  availableProcedures: Set<QwglInventoryProcedure>;
  missingRequiredProcedures: QwglProcedureName[];
  symbols: QwglDispatchTable;
}

/**
 * Original name: N/A
 * Source: N/A (QGL init options)
 * Category: New
 * Purpose: Configure TS-only requirements layered on top of the ported QGL procedure inventory.
 */
export interface QglInitOptions {
  extraRequiredProcedures?: readonly string[];
}

/**
 * Original name: N/A
 * Source: N/A (renderer bootstrap options)
 * Category: New
 * Purpose: Connect explicit QGL/QWGL runtimes to the renderer initialization hooks.
 */
export interface QglBootstrapOptions {
  qglRuntime: QglRuntime;
  qwglRuntime?: QwglRuntime;
  createQglProvider: (driver: string) => QglSymbolProvider | null;
  createQwglProvider?: () => QglSymbolProvider | null;
}

export const GL_POINT_SIZE_MIN_EXT = 0x8126;
export const GL_POINT_SIZE_MAX_EXT = 0x8127;
export const GL_POINT_FADE_THRESHOLD_SIZE_EXT = 0x8128;
export const GL_DISTANCE_ATTENUATION_EXT = 0x8129;
export const GL_SHARED_TEXTURE_PALETTE_EXT = 0x81fb;
export const GL_TEXTURE0_SGIS = 0x835e;
export const GL_TEXTURE1_SGIS = 0x835f;
const GL_VENDOR = 0x1f00;
const GL_RENDERER = 0x1f01;
const GL_VERSION = 0x1f02;
const GL_EXTENSIONS = 0x1f03;

/**
 * Original name: N/A
 * Source: N/A (QGL runtime factory)
 * Category: New
 * Purpose: Create the explicit runtime replacing the global symbol pointers declared in `qgl.h`.
 */
export function createQglRuntime(): QglRuntime {
  return {
    initialized: false,
    provider: null,
    availableProcedures: new Set<QglInventoryProcedure>(),
    missingRequiredProcedures: [],
    symbols: createEmptyDispatchTable()
  };
}

/**
 * Original name: N/A
 * Source: N/A (Win32 QGL runtime factory)
 * Category: New
 * Purpose: Create the explicit runtime replacing the Win32 `qwgl*` procedure pointers declared in `qgl.h`.
 */
export function createQwglRuntime(): QwglRuntime {
  return {
    initialized: false,
    provider: null,
    availableProcedures: new Set<QwglInventoryProcedure>(),
    missingRequiredProcedures: [],
    symbols: createEmptyQwglDispatchTable()
  };
}

/**
 * Original name: N/A
 * Source: N/A (object symbol provider)
 * Category: New
 * Purpose: Build a symbol provider from a plain object containing procedure bindings.
 */
export function createObjectQglProvider(bindings: Record<string, unknown>): QglSymbolProvider {
  return {
    resolve(name: string): unknown {
      return bindings[name];
    }
  };
}

/**
 * Original name: QGL_Init
 * Source: ref_gl/qgl.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Resolves the QGL procedures needed by the renderer and reports whether startup succeeded.
 *
 * Porting notes:
 * - The original DLL loading is replaced by an injected symbol provider.
 * - Optional extension entries stay nullable, matching the original `if (qglFooEXT)` usage pattern.
 */
export function QGL_Init(runtime: QglRuntime, provider: QglSymbolProvider, options: QglInitOptions = {}): qboolean {
  QGL_Shutdown(runtime);

  const missingRequiredProcedures: QglRequiredProcedure[] = [];
  const availableProcedures = new Set<QglInventoryProcedure>();
  const symbols = createEmptyDispatchTable();

  for (const name of QGL_REQUIRED_PROCEDURES) {
    const resolved = provider.resolve(name);
    if (!isQglProcedure(resolved)) {
      missingRequiredProcedures.push(name);
      continue;
    }

    symbols[name] = resolved;
    availableProcedures.add(name);
  }

  for (const name of QGL_OPTIONAL_PROCEDURES) {
    const resolved = provider.resolve(name);
    if (isQglProcedure(resolved)) {
      symbols[name] = resolved;
      availableProcedures.add(name);
    } else {
      symbols[name] = null;
    }
  }

  const extraRequiredProcedures = options.extraRequiredProcedures ?? [];
  for (const name of extraRequiredProcedures) {
    const resolved = provider.resolve(name);
    if (!isQglProcedure(resolved)) {
      runtime.provider = provider;
      runtime.availableProcedures = availableProcedures;
      runtime.missingRequiredProcedures = missingRequiredProcedures;
      runtime.symbols = symbols;
      provider.shutdown?.();
      runtime.provider = null;
      return false;
    }
  }

  runtime.provider = provider;
  runtime.availableProcedures = availableProcedures;
  runtime.missingRequiredProcedures = missingRequiredProcedures;
  runtime.symbols = symbols;
  runtime.initialized = missingRequiredProcedures.length === 0;

  if (!runtime.initialized) {
    provider.shutdown?.();
    runtime.provider = null;
    return false;
  }

  return true;
}

/**
 * Original name: QGL_Shutdown
 * Source: ref_gl/qgl.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Releases the active provider and clears all resolved symbol pointers.
 */
export function QGL_Shutdown(runtime: QglRuntime): void {
  runtime.provider?.shutdown?.();
  runtime.initialized = false;
  runtime.provider = null;
  runtime.availableProcedures.clear();
  runtime.missingRequiredProcedures = [];
  runtime.symbols = createEmptyDispatchTable();
}

/**
 * Original name: N/A
 * Category: Adapter
 * Source: ref_gl/qgl.h
 *
 * Purpose:
 * - Resolve the Win32 `qwgl*` procedure-pointer inventory declared by `qgl.h`.
 *
 * Fidelity level: Close
 *
 * Behavior:
 * - Resolves the Win32 `qwgl*` procedure inventory and reports whether startup succeeded.
 *
 * Porting notes:
 * - This preserves the original Win32 symbol table as a runtime contract only.
 * - No native WGL bootstrap is attempted in the browser-facing architecture.
 */
export function QWGL_Init(runtime: QwglRuntime, provider: QglSymbolProvider): qboolean {
  QWGL_Shutdown(runtime);

  const missingRequiredProcedures: QwglProcedureName[] = [];
  const availableProcedures = new Set<QwglInventoryProcedure>();
  const symbols = createEmptyQwglDispatchTable();

  for (const name of QWGL_WIN32_PROCEDURES) {
    const resolved = provider.resolve(name);
    if (!isQwglProcedure(resolved)) {
      missingRequiredProcedures.push(name);
      continue;
    }

    symbols[name] = resolved;
    availableProcedures.add(name);
  }

  runtime.provider = provider;
  runtime.availableProcedures = availableProcedures;
  runtime.missingRequiredProcedures = missingRequiredProcedures;
  runtime.symbols = symbols;
  runtime.initialized = missingRequiredProcedures.length === 0;

  if (!runtime.initialized) {
    provider.shutdown?.();
    runtime.provider = null;
    return false;
  }

  return true;
}

/**
 * Original name: N/A
 * Category: Adapter
 * Source: ref_gl/qgl.h
 *
 * Purpose:
 * - Clear the Win32 `qwgl*` procedure-pointer inventory declared by `qgl.h`.
 *
 * Fidelity level: Close
 *
 * Behavior:
 * - Releases the active Win32 symbol provider and clears all resolved `qwgl*` pointers.
 */
export function QWGL_Shutdown(runtime: QwglRuntime): void {
  runtime.provider?.shutdown?.();
  runtime.initialized = false;
  runtime.provider = null;
  runtime.availableProcedures.clear();
  runtime.missingRequiredProcedures = [];
  runtime.symbols = createEmptyQwglDispatchTable();
}

/**
 * Original name: N/A
 * Source: N/A (QGL runtime query)
 * Category: New
 * Purpose: Test whether one QGL symbol is currently available in the runtime.
 */
export function hasQglProcedure(runtime: QglRuntime, name: QglInventoryProcedure): boolean {
  return runtime.availableProcedures.has(name);
}

/**
 * Original name: N/A
 * Source: N/A (Win32 QGL runtime query)
 * Category: New
 * Purpose: Test whether one Win32 `qwgl*` symbol is currently available in the runtime.
 */
export function hasQwglProcedure(runtime: QwglRuntime, name: QwglInventoryProcedure): boolean {
  return runtime.availableProcedures.has(name);
}

/**
 * Original name: N/A
 * Source: N/A (renderer bootstrap adapter)
 * Category: New
 * Purpose: Bridge the ported `QGL` / `QWGL` runtimes into the bootstrap hooks consumed by `R_Init`.
 *
 * Constraints:
 * - Must preserve the original split between required core GL procedures and backend-resolved extension procedures.
 * - Must keep Win32 `qwgl*` bootstrap optional for the browser-facing architecture.
 */
export function createQglBootstrapHooks(options: QglBootstrapOptions): Pick<GlRmainHooks, "qglInit" | "qglShutdown" | "resolveBackendProc" | "getGlStrings" | "getGlError"> {
  const { qglRuntime, qwglRuntime, createQglProvider, createQwglProvider } = options;

  return {
    qglInit: (driver: string): boolean => {
      const qglProvider = createQglProvider(driver);
      if (!qglProvider || !QGL_Init(qglRuntime, qglProvider)) {
        return false;
      }

      if (qwglRuntime && createQwglProvider) {
        const qwglProvider = createQwglProvider();
        if (qwglProvider && !QWGL_Init(qwglRuntime, qwglProvider)) {
          QGL_Shutdown(qglRuntime);
          return false;
        }
      }

      return true;
    },
    qglShutdown: (): void => {
      if (qwglRuntime) {
        QWGL_Shutdown(qwglRuntime);
      }
      QGL_Shutdown(qglRuntime);
    },
    resolveBackendProc: (name: string): unknown => {
      const direct = resolveKnownBootstrapProcedure(qglRuntime, qwglRuntime, name);
      if (direct) {
        return direct;
      }

      if (qwglRuntime && hasQwglProcedure(qwglRuntime, "qwglGetProcAddress")) {
        return qwglRuntime.symbols.qwglGetProcAddress(name);
      }

      return null;
    },
    getGlStrings: () => {
      if (!qglRuntime.initialized) {
        return null;
      }

      return {
        vendor: readGlString(qglRuntime, GL_VENDOR),
        renderer: readGlString(qglRuntime, GL_RENDERER),
        version: readGlString(qglRuntime, GL_VERSION),
        extensions: readGlString(qglRuntime, GL_EXTENSIONS)
      };
    },
    getGlError: () => {
      if (!qglRuntime.initialized) {
        return null;
      }

      return Number(qglRuntime.symbols.qglGetError());
    }
  };
}

function createEmptyDispatchTable(): QglDispatchTable {
  const unbound = createUnboundRequiredProcedure();
  const table = {} as Partial<Record<QglProcedureName, QglProcedure | null>>;

  for (const name of QGL_REQUIRED_PROCEDURES) {
    table[name] = unbound;
  }

  for (const name of QGL_OPTIONAL_PROCEDURES) {
    table[name] = null;
  }

  return table as QglDispatchTable;
}

function createEmptyQwglDispatchTable(): QwglDispatchTable {
  const unbound = createUnboundQwglProcedure();
  const table = {} as Partial<Record<QwglProcedureName, QwglProcedure>>;

  for (const name of QWGL_WIN32_PROCEDURES) {
    table[name] = unbound;
  }

  return table as QwglDispatchTable;
}

function createUnboundRequiredProcedure(): QglProcedure {
  return () => {
    throw new Error("QGL procedure called before successful QGL_Init");
  };
}

function createUnboundQwglProcedure(): QwglProcedure {
  return () => {
    throw new Error("QWGL procedure called before successful QWGL_Init");
  };
}

function isQglProcedure(value: unknown): value is QglProcedure {
  return typeof value === "function";
}

function isQwglProcedure(value: unknown): value is QwglProcedure {
  return typeof value === "function";
}

function resolveKnownBootstrapProcedure(
  qglRuntime: QglRuntime,
  qwglRuntime: QwglRuntime | undefined,
  name: string
): QglProcedure | QwglProcedure | null {
  const qglName = mapBackendProcToQglName(name);
  if (qglName && hasQglProcedure(qglRuntime, qglName)) {
    return qglRuntime.symbols[qglName];
  }

  const qwglName = mapBackendProcToQwglName(name);
  if (qwglRuntime && qwglName && hasQwglProcedure(qwglRuntime, qwglName)) {
    return qwglRuntime.symbols[qwglName];
  }

  return null;
}

function mapBackendProcToQglName(name: string): QglOptionalProcedure | null {
  switch (name) {
    case "glPointParameterfEXT":
      return "qglPointParameterfEXT";
    case "glPointParameterfvEXT":
      return "qglPointParameterfvEXT";
    case "glColorTableEXT":
      return "qglColorTableEXT";
    case "glLockArraysEXT":
      return "qglLockArraysEXT";
    case "glUnlockArraysEXT":
      return "qglUnlockArraysEXT";
    case "glMTexCoord2fSGIS":
      return "qglMTexCoord2fSGIS";
    case "glSelectTextureSGIS":
      return "qglSelectTextureSGIS";
    default:
      return null;
  }
}

function mapBackendProcToQwglName(name: string): QwglProcedureName | null {
  switch (name) {
    case "wglSwapIntervalEXT":
      return "qwglSwapIntervalEXT";
    default:
      return null;
  }
}

function readGlString(runtime: QglRuntime, name: number): string {
  const raw = runtime.symbols.qglGetString(name);
  if (typeof raw === "string") {
    return raw;
  }
  if (raw instanceof Uint8Array) {
    return new TextDecoder().decode(raw);
  }
  return "";
}
