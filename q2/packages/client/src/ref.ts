/**
 * File: ref.ts
 * Source: Quake II original / client/ref.h
 * Purpose: Port the public renderer interface declarations shared between the client and refresh module.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses explicit TypeScript interfaces and structured return values for some callback-style API surfaces.
 * - Represents renderer-owned opaque pointers as `unknown`.
 *
 * Notes:
 * - This file is the principal attachment point for `client/ref.h`.
 */

import type { byte, cvar_t, qboolean, vec3_t } from "../../qcommon/src/index.js";
import { MAX_LIGHTSTYLES } from "../../qcommon/src/index.js";

export { MAX_LIGHTSTYLES };

/**
 * Original name: model_s
 * Source: Quake-2-master/client/ref.h
 * Category: Adapter
 * Purpose: Represent the renderer-owned opaque `struct model_s` handle exposed through `entity_t` and `refexport_t`.
 */
export type model_s = unknown;

/**
 * Original name: image_s
 * Source: Quake-2-master/client/ref.h
 * Category: Adapter
 * Purpose: Represent the renderer-owned opaque `struct image_s` handle exposed through `entity_t` and `refexport_t`.
 */
export type image_s = unknown;

/**
 * Original name: MAX_DLIGHTS, MAX_ENTITIES, MAX_PARTICLES
 * Source: Quake-2-master/client/ref.h
 * Category: Ported
 * Fidelity level: Strict
 */
export const MAX_DLIGHTS = 32;
export const MAX_ENTITIES = 128;
export const MAX_PARTICLES = 4096;

/**
 * Original name: POWERSUIT_SCALE
 * Source: Quake-2-master/client/ref.h
 * Category: Ported
 * Fidelity level: Strict
 */
export const POWERSUIT_SCALE = 4.0;

/**
 * Original name: SHELL_*_COLOR
 * Source: Quake-2-master/client/ref.h
 * Category: Ported
 * Fidelity level: Strict
 */
export const SHELL_RED_COLOR = 0xF2;
export const SHELL_GREEN_COLOR = 0xD0;
export const SHELL_BLUE_COLOR = 0xF3;
export const SHELL_RG_COLOR = 0xDC;
export const SHELL_RB_COLOR = 0x68;
export const SHELL_BG_COLOR = 0x78;
export const SHELL_DOUBLE_COLOR = 0xDF;
export const SHELL_HALF_DAM_COLOR = 0x90;
export const SHELL_CYAN_COLOR = 0x72;
export const SHELL_WHITE_COLOR = 0xD7;

/**
 * Original name: ENTITY_FLAGS
 * Source: Quake-2-master/client/ref.h
 * Category: Ported
 * Fidelity level: Strict
 */
export const ENTITY_FLAGS = 68;

/**
 * Original name: API_VERSION
 * Source: Quake-2-master/client/ref.h
 * Category: Ported
 * Fidelity level: Strict
 */
export const API_VERSION = 3;

/**
 * Original name: entity_t
 * Source: Quake-2-master/client/ref.h
 * Category: Ported
 * Fidelity level: Close
 */
export interface entity_t {
  model: model_s | null;
  angles: vec3_t;
  origin: vec3_t;
  frame: number;
  oldorigin: vec3_t;
  oldframe: number;
  backlerp: number;
  skinnum: number;
  lightstyle: number;
  alpha: number;
  skin: image_s | null;
  flags: number;
}

/**
 * Original name: dlight_t
 * Source: Quake-2-master/client/ref.h
 * Category: Ported
 * Fidelity level: Strict
 */
export interface dlight_t {
  origin: vec3_t;
  color: vec3_t;
  intensity: number;
}

/**
 * Original name: particle_t
 * Source: Quake-2-master/client/ref.h
 * Category: Ported
 * Fidelity level: Strict
 */
export interface particle_t {
  origin: vec3_t;
  color: number;
  alpha: number;
}

/**
 * Original name: lightstyle_t
 * Source: Quake-2-master/client/ref.h
 * Category: Ported
 * Fidelity level: Strict
 */
export interface lightstyle_t {
  rgb: [number, number, number];
  white: number;
}

/**
 * Original name: refdef_t
 * Source: Quake-2-master/client/ref.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Stores one renderer-facing frame definition for the Quake II refresh module.
 *
 * Porting notes:
 * - Uses arrays and `Uint8Array | null` instead of pointer/count pairs while preserving explicit `num_*` counters.
 */
export interface refdef_t {
  x: number;
  y: number;
  width: number;
  height: number;
  fov_x: number;
  fov_y: number;
  vieworg: vec3_t;
  viewangles: vec3_t;
  blend: [number, number, number, number];
  time: number;
  rdflags: number;
  areabits: Uint8Array | null;
  lightstyles: lightstyle_t[];
  num_entities: number;
  entities: entity_t[];
  num_dlights: number;
  dlights: dlight_t[];
  num_particles: number;
  particles: particle_t[];
}

/**
 * Original name: N/A
 * Source: N/A (structured refexport result)
 * Category: New
 * Purpose: Replace `DrawGetPicSize` output pointers with a structured result.
 *
 * Constraints:
 * - Must preserve the original width/height payload.
 */
export interface RefPictureSize {
  width: number;
  height: number;
}

/**
 * Original name: refexport_t
 * Source: Quake-2-master/client/ref.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Describes the renderer API exported to the client.
 *
 * Porting notes:
 * - Uses structured TypeScript callback signatures instead of C function pointers and out-parameters.
 */
export interface refexport_t {
  api_version: number;
  Init: (hinstance: unknown, wndproc: unknown) => qboolean;
  Shutdown: () => void;
  BeginRegistration: (map: string) => void;
  RegisterModel: (name: string) => model_s | null;
  RegisterSkin: (name: string) => image_s | null;
  RegisterPic: (name: string) => image_s | null;
  SetSky: (name: string, rotate: number, axis: vec3_t) => void;
  EndRegistration: () => void;
  RenderFrame: (fd: refdef_t) => void;
  DrawGetPicSize: (name: string) => RefPictureSize;
  DrawPic: (x: number, y: number, name: string) => void;
  DrawStretchPic: (x: number, y: number, w: number, h: number, name: string) => void;
  DrawChar: (x: number, y: number, c: number) => void;
  DrawTileClear: (x: number, y: number, w: number, h: number, name: string) => void;
  DrawFill: (x: number, y: number, w: number, h: number, c: number) => void;
  DrawFadeScreen: () => void;
  DrawStretchRaw: (x: number, y: number, w: number, h: number, cols: number, rows: number, data: Uint8Array) => void;
  CinematicSetPalette: (palette: Uint8Array | null) => void;
  BeginFrame: (camera_separation: number) => void;
  EndFrame: () => void;
  AppActivate: (activate: qboolean) => void;
}

/**
 * Original name: N/A
 * Source: N/A (structured refimport result)
 * Category: New
 * Purpose: Replace `Vid_GetModeInfo` output pointers with a structured result.
 *
 * Constraints:
 * - Must preserve the width/height pair semantics of the original callback.
 */
export interface VidModeInfo {
  width: number;
  height: number;
}

/**
 * Original name: refimport_t
 * Source: Quake-2-master/client/ref.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Describes the client/runtime services imported by the renderer module.
 *
 * Porting notes:
 * - Uses explicit return values instead of C out-pointer patterns for filesystem and mode-info helpers.
 */
export interface refimport_t {
  Sys_Error: (err_level: number, str: string, ...args: unknown[]) => void;
  Cmd_AddCommand: (name: string, cmd: () => void) => void;
  Cmd_RemoveCommand: (name: string) => void;
  Cmd_Argc: () => number;
  Cmd_Argv: (i: number) => string;
  Cmd_ExecuteText: (exec_when: number, text: string) => void;
  Con_Printf: (print_level: number, str: string, ...args: unknown[]) => void;
  FS_LoadFile: (name: string) => Uint8Array | null;
  FS_FreeFile: (buf: Uint8Array) => void;
  FS_Gamedir: () => string;
  Cvar_Get: (name: string, value: string, flags: number) => cvar_t | null;
  Cvar_Set: (name: string, value: string) => cvar_t | null;
  Cvar_SetValue: (name: string, value: number) => void;
  Vid_GetModeInfo: (mode: number) => VidModeInfo | null;
  Vid_MenuInit: () => void;
  Vid_NewWindow: (width: number, height: number) => void;
}

/**
 * Original name: GetRefAPI_t
 * Source: Quake-2-master/client/ref.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Represents the single linker-level renderer entry point that accepts the import table and returns the export table.
 *
 * Porting notes:
 * - TypeScript modules expose this as a callable type; the concrete `GetRefAPI` implementation lives in the renderer adapter.
 */
export type GetRefAPI_t = (imports: refimport_t) => refexport_t;

/**
 * Original name: N/A
 * Source: N/A (renderer-facing default factory)
 * Category: New
 * Purpose: Create the zero-initialized `entity_t` state used by renderer-facing client code.
 *
 * Constraints:
 * - Must preserve every `client/ref.h` `entity_t` field with C zero/null startup values.
 */
export function createEntity(): entity_t {
  return {
    model: null,
    angles: [0, 0, 0],
    origin: [0, 0, 0],
    frame: 0,
    oldorigin: [0, 0, 0],
    oldframe: 0,
    backlerp: 0,
    skinnum: 0,
    lightstyle: 0,
    alpha: 0,
    skin: null,
    flags: 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (renderer-facing default factory)
 * Category: New
 * Purpose: Create the zero-initialized `dlight_t` state used by renderer-facing client code.
 *
 * Constraints:
 * - Must preserve every `client/ref.h` `dlight_t` field with C zero startup values.
 */
export function createDlight(): dlight_t {
  return {
    origin: [0, 0, 0],
    color: [0, 0, 0],
    intensity: 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (renderer-facing default factory)
 * Category: New
 * Purpose: Create the zero-initialized `particle_t` state used by renderer-facing client code.
 *
 * Constraints:
 * - Must preserve every `client/ref.h` `particle_t` field with C zero startup values.
 */
export function createParticle(): particle_t {
  return {
    origin: [0, 0, 0],
    color: 0,
    alpha: 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (renderer-facing default factory)
 * Category: New
 * Purpose: Create the zero-initialized `lightstyle_t` state used by renderer-facing client code.
 *
 * Constraints:
 * - Must preserve every `client/ref.h` `lightstyle_t` field with C zero startup values.
 */
export function createLightstyle(): lightstyle_t {
  return {
    rgb: [0, 0, 0],
    white: 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (renderer-facing default factory)
 * Category: New
 * Purpose: Create the zero-initialized `refdef_t` frame definition used by refresh/render adapters.
 *
 * Constraints:
 * - Must preserve every `client/ref.h` `refdef_t` field with C zero/null startup values.
 * - Must allocate the fixed `MAX_LIGHTSTYLES` lightstyle table expected by renderer paths.
 */
export function createRefDef(): refdef_t {
  return {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    fov_x: 0,
    fov_y: 0,
    vieworg: [0, 0, 0],
    viewangles: [0, 0, 0],
    blend: [0, 0, 0, 0],
    time: 0,
    rdflags: 0,
    areabits: null,
    lightstyles: Array.from({ length: MAX_LIGHTSTYLES }, () => createLightstyle()),
    num_entities: 0,
    entities: [],
    num_dlights: 0,
    dlights: [],
    num_particles: 0,
    particles: []
  };
}

/**
 * Original name: N/A
 * Source: N/A (renderer-facing no-op export factory)
 * Category: New
 * Purpose: Create a no-op renderer export table for tests, menus and hosts before a concrete refresh backend is attached.
 *
 * Constraints:
 * - Must preserve the complete `client/ref.h` `refexport_t` surface and expose `API_VERSION` through `api_version`.
 */
export function createRefExport(): refexport_t {
  return {
    api_version: API_VERSION,
    Init: () => false,
    Shutdown: () => {},
    BeginRegistration: () => {},
    RegisterModel: () => null,
    RegisterSkin: () => null,
    RegisterPic: () => null,
    SetSky: () => {},
    EndRegistration: () => {},
    RenderFrame: () => {},
    DrawGetPicSize: () => ({ width: 0, height: 0 }),
    DrawPic: () => {},
    DrawStretchPic: () => {},
    DrawChar: () => {},
    DrawTileClear: () => {},
    DrawFill: () => {},
    DrawFadeScreen: () => {},
    DrawStretchRaw: () => {},
    CinematicSetPalette: () => {},
    BeginFrame: () => {},
    EndFrame: () => {},
    AppActivate: () => {}
  };
}

/**
 * Original name: N/A
 * Source: N/A (renderer-facing no-op import factory)
 * Category: New
 * Purpose: Create a no-op renderer import table that concrete renderer hosts can partially override.
 *
 * Constraints:
 * - Must preserve the complete `client/ref.h` `refimport_t` surface with inert default callbacks.
 */
export function createRefImport(): refimport_t {
  return {
    Sys_Error: () => {},
    Cmd_AddCommand: () => {},
    Cmd_RemoveCommand: () => {},
    Cmd_Argc: () => 0,
    Cmd_Argv: () => "",
    Cmd_ExecuteText: () => {},
    Con_Printf: () => {},
    FS_LoadFile: () => null,
    FS_FreeFile: () => {},
    FS_Gamedir: () => "",
    Cvar_Get: () => null,
    Cvar_Set: () => null,
    Cvar_SetValue: () => {},
    Vid_GetModeInfo: () => null,
    Vid_MenuInit: () => {},
    Vid_NewWindow: () => {}
  };
}
