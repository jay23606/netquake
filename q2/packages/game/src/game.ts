/**
 * File: game.ts
 * Source: Quake II original / game/game.h
 * Purpose: Port of the server-visible gameplay API shared between the engine and the game module.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - `gclient_t` and `edict_t` are represented through the fuller runtime shapes from `runtime.ts`.
 * - Pointer-based C arrays and out-parameters are modeled with TypeScript arrays and callbacks.
 *
 * Notes:
 * - This file intentionally covers `game.h` only; wider gameplay declarations remain in `g_local.h` ports.
 */

import type {
  cvar_t,
  entity_state_t,
  multicast_t,
  player_state_t,
  pmove_t,
  qboolean,
  trace_t,
  usercmd_t,
  vec3_t
} from "../../qcommon/src/index.js";
import {
  SOLID_BBOX as RUNTIME_SOLID_BBOX,
  SOLID_BSP as RUNTIME_SOLID_BSP,
  SOLID_NOT as RUNTIME_SOLID_NOT,
  SOLID_TRIGGER as RUNTIME_SOLID_TRIGGER,
  SVF_DEADMONSTER,
  SVF_MONSTER,
  SVF_NOCLIENT
} from "./runtime.js";
import type { GameAreaLink, GameClient, GameEntity } from "./runtime.js";

/**
 * Original name: GAME_API_VERSION
 * Source: Quake-2-master/game/game.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Exposes the Quake II gameplay DLL API version expected by the server.
 */
export const GAME_API_VERSION = 3;

/**
 * Original name: MAX_ENT_CLUSTERS
 * Source: Quake-2-master/game/game.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines the fixed inline cluster storage size embedded in `edict_t`.
 */
export const MAX_ENT_CLUSTERS = 16;

/**
 * Original name: solid_t
 * Source: Quake-2-master/game/game.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Preserves the canonical `edict->solid` enum values shared with the server.
 */
export enum solid_t {
  SOLID_NOT = RUNTIME_SOLID_NOT,
  SOLID_TRIGGER = RUNTIME_SOLID_TRIGGER,
  SOLID_BBOX = RUNTIME_SOLID_BBOX,
  SOLID_BSP = RUNTIME_SOLID_BSP
}

/**
 * Original name: link_s
 * Source: Quake-2-master/game/game.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Represents the `struct link_s` doubly linked area-link node embedded in server-visible edicts.
 */
export type link_s = GameAreaLink;

/**
 * Original name: link_t
 * Source: Quake-2-master/game/game.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Preserves the `typedef struct link_s link_t` alias used by `edict_t.area`.
 */
export type link_t = link_s;

/**
 * Original name: gclient_s
 * Source: Quake-2-master/game/game.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Represents the server-visible `struct gclient_s` prefix, whose leading `ps` and `ping` fields match `game.h`.
 */
export type gclient_s = GameClient;

/**
 * Original name: gclient_t
 * Source: Quake-2-master/game/game.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Preserves the `typedef struct gclient_s gclient_t` alias used by `edict_t.client`.
 */
export type gclient_t = gclient_s;

/**
 * Original name: edict_s
 * Source: Quake-2-master/game/game.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Represents the server-visible `struct edict_s` prefix while reusing the fuller gameplay runtime entity shape.
 */
export type edict_s = GameEntity;

/**
 * Original name: edict_t
 * Source: Quake-2-master/game/game.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Preserves the `typedef struct edict_s edict_t` alias used by the game/server API.
 */
export type edict_t = edict_s;

/**
 * Original name: N/A
 * Source: N/A (engine callback helper type)
 * Category: New
 * Purpose: Model one `printf`-style callback imported from the engine.
 *
 * Constraints:
 * - Must preserve the leading `fmt` argument and variadic trailing payload.
 */
export type GamePrintf = (fmt: string, ...args: unknown[]) => void;

/**
 * Original name: game_import_t
 * Source: Quake-2-master/game/game.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Declares the engine callbacks made available to the gameplay module.
 */
export interface game_import_t {
  bprintf: (printlevel: number, fmt: string, ...args: unknown[]) => void;
  dprintf: GamePrintf;
  cprintf: (ent: edict_t | null, printlevel: number, fmt: string, ...args: unknown[]) => void;
  centerprintf: (ent: edict_t | null, fmt: string, ...args: unknown[]) => void;
  sound: (
    ent: edict_t | null,
    channel: number,
    soundindex: number,
    volume: number,
    attenuation: number,
    timeofs: number
  ) => void;
  positioned_sound: (
    origin: vec3_t,
    ent: edict_t | null,
    channel: number,
    soundindex: number,
    volume: number,
    attenuation: number,
    timeofs: number
  ) => void;
  configstring: (num: number, string: string) => void;
  error: GamePrintf;
  modelindex: (name: string) => number;
  soundindex: (name: string) => number;
  imageindex: (name: string) => number;
  setmodel: (ent: edict_t, name: string) => void;
  trace: (
    start: vec3_t,
    mins: vec3_t,
    maxs: vec3_t,
    end: vec3_t,
    passent: edict_t | null,
    contentmask: number
  ) => trace_t;
  pointcontents: (point: vec3_t) => number;
  inPVS: (p1: vec3_t, p2: vec3_t) => qboolean;
  inPHS: (p1: vec3_t, p2: vec3_t) => qboolean;
  SetAreaPortalState: (portalnum: number, open: qboolean) => void;
  AreasConnected: (area1: number, area2: number) => qboolean;
  linkentity: (ent: edict_t) => void;
  unlinkentity: (ent: edict_t) => void;
  BoxEdicts: (
    mins: vec3_t,
    maxs: vec3_t,
    list: Array<edict_t | null>,
    maxcount: number,
    areatype: number
  ) => number;
  Pmove: (pmove: pmove_t) => void;
  multicast: (origin: vec3_t, to: multicast_t) => void;
  unicast: (ent: edict_t, reliable: qboolean) => void;
  WriteChar: (c: number) => void;
  WriteByte: (c: number) => void;
  WriteShort: (c: number) => void;
  WriteLong: (c: number) => void;
  WriteFloat: (f: number) => void;
  WriteString: (s: string) => void;
  WritePosition: (pos: vec3_t) => void;
  WriteDir: (pos: vec3_t) => void;
  WriteAngle: (f: number) => void;
  TagMalloc: (size: number, tag: number) => unknown;
  TagFree: (block: unknown) => void;
  FreeTags: (tag: number) => void;
  cvar: (var_name: string, value: string, flags: number) => cvar_t | null;
  cvar_set: (var_name: string, value: string) => cvar_t | null;
  cvar_forceset: (var_name: string, value: string) => cvar_t | null;
  argc: () => number;
  argv: (n: number) => string;
  args: () => string;
  AddCommandString: (text: string) => void;
  DebugGraph: (value: number, color: number) => void;
}

/**
 * Original name: game_export_t
 * Source: Quake-2-master/game/game.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Declares the gameplay entry points and shared globals exported back to the server.
 */
export interface game_export_t {
  apiversion: number;
  Init: () => void;
  Shutdown: () => void;
  SpawnEntities: (mapname: string, entstring: string, spawnpoint: string) => void;
  WriteGame: (filename: string, autosave: qboolean) => void;
  ReadGame: (filename: string) => void;
  WriteLevel: (filename: string) => void;
  ReadLevel: (filename: string) => void;
  ClientConnect: (ent: edict_t, userinfo: string) => qboolean;
  /**
   * Category: Adapter
   * Purpose: Expose the rejection text that the original C `ClientConnect` wrote into mutable `userinfo` as `rejmsg`.
   */
  ClientConnectRejectMessage?: () => string;
  ClientBegin: (ent: edict_t) => void;
  ClientUserinfoChanged: (ent: edict_t, userinfo: string) => void;
  ClientDisconnect: (ent: edict_t) => void;
  ClientCommand: (ent: edict_t) => void;
  ClientThink: (ent: edict_t, cmd: usercmd_t) => void;
  RunFrame: () => void;
  ServerCommand: () => void;
  edicts: edict_t[];
  edict_size: number;
  num_edicts: number;
  max_edicts: number;
}

/**
 * Original name: GetGameApi
 * Source: Quake-2-master/game/game.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Names the gameplay factory function expected by the Quake II server.
 *
 * Porting notes:
 * - `game.h` declares this server-visible contract; the owning implementation is the `g_main.c` port in `g_main.ts`.
 */
export type GetGameApi = (imports: game_import_t) => game_export_t;

/**
 * Original name: N/A
 * Source: N/A (server-visible gclient_t prefix contract)
 * Category: New
 * Purpose: Expose the server-visible `gclient_t` prefix shared by `game.h`.
 *
 * Constraints:
 * - Must preserve the leading field order expected by the original server/game contract.
 */
export interface GameClientServerFields {
  ps: player_state_t;
  ping: number;
}

/**
 * Original name: N/A
 * Source: N/A (server-visible edict_t prefix contract)
 * Category: New
 * Purpose: Expose the server-visible `edict_t` prefix shared by `game.h`.
 *
 * Constraints:
 * - Must stay aligned with the fields embedded before the gameplay-private extension in `g_local.h`.
 */
export interface GameEdictServerFields {
  s: entity_state_t;
  client: gclient_t | null;
  inuse: qboolean;
  linkcount: number;
  area: link_t;
  num_clusters: number;
  clusternums: Int32Array;
  headnode: number;
  areanum: number;
  areanum2: number;
  svflags: number;
  mins: vec3_t;
  maxs: vec3_t;
  absmin: vec3_t;
  absmax: vec3_t;
  size: vec3_t;
  solid: solid_t;
  clipmask: number;
  owner: edict_t | null;
}

/**
 * Original name: SVF_NOCLIENT / SVF_DEADMONSTER / SVF_MONSTER
 * Source: Quake-2-master/game/game.h
 * Category: Adapter
 * Purpose: Re-export the server-visible flag constants from their runtime owner for the public game API surface.
 */
export {
  SVF_DEADMONSTER,
  SVF_MONSTER,
  SVF_NOCLIENT
};
