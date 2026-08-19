/**
 * File: server.ts
 * Source: Quake II original / server/server.h
 * Purpose: Port of the core Quake II server runtime declarations shared across the server module.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - `FILE *` fields are represented as `unknown | null`.
 * - Pointer arithmetic macros are replaced with explicit edict-array helpers.
 * - Server procedure declarations are grouped as TypeScript signature interfaces until the `sv_*.c` files are ported.
 *
 * Notes:
 * - This file intentionally targets `server.h` declarations only.
 */

import { createSizeBuffer, type sizebuf_t } from "../../memory/src/index.js";
import {
  MAX_CONFIGSTRINGS,
  MAX_EDICTS,
  MAX_MAP_AREAS,
  MAX_MODELS,
  MAX_MSGLEN,
  MAX_QPATH,
  MAX_TOKEN_CHARS,
  UPDATE_BACKUP,
  type cvar_t,
  type entity_state_t,
  type multicast_t,
  type netadr_t,
  type netchan_t,
  type player_state_t,
  type qboolean,
  type trace_t,
  type usercmd_t,
  type vec3_t,
  createEntityState,
  createNetAdr,
  createNetchan,
  createPlayerState,
  MAX_INFO_STRING
} from "../../qcommon/src/index.js";
import type { edict_t, game_export_t } from "../../game/src/index.js";

/**
 * Original name: N/A
 * Source: N/A (opaque local type)
 * Category: New
 * Purpose: Represent the opaque collision-model pointer array stored by `server_t`.
 *
 * Constraints:
 * - Must remain renderer/collision-backend agnostic until `cmodel.c` exposes a dedicated public type.
 */
export type cmodel_s = unknown;

/**
 * Original name: MAX_MASTERS
 * Source: server/server.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines the maximum number of master-server addresses stored by the server.
 */
export const MAX_MASTERS = 8;

/**
 * Original name: LATENCY_COUNTS
 * Source: server/server.h
 * Category: Ported
 * Fidelity level: Strict
 */
export const LATENCY_COUNTS = 16;

/**
 * Original name: RATE_MESSAGES
 * Source: server/server.h
 * Category: Ported
 * Fidelity level: Strict
 */
export const RATE_MESSAGES = 10;

/**
 * Original name: MAX_CHALLENGES
 * Source: server/server.h
 * Category: Ported
 * Fidelity level: Strict
 */
export const MAX_CHALLENGES = 1024;

/**
 * Original name: SV_OUTPUTBUF_LENGTH
 * Source: server/server.h
 * Category: Ported
 * Fidelity level: Strict
 */
export const SV_OUTPUTBUF_LENGTH = MAX_MSGLEN - 16;

/**
 * Original name: N/A
 * Source: N/A (derived server ring size constant)
 * Category: New
 * Purpose: Surface the packet-entity budget implicitly used by `server.h` for client-entity ring sizing.
 *
 * Constraints:
 * - Must stay aligned with Quake II's `UPDATE_BACKUP * MAX_PACKET_ENTITIES == 1024` parsing budget.
 */
export const MAX_PACKET_ENTITIES = 64;

/**
 * Original name: server_state_t
 * Source: server/server.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Preserves the server lifecycle states used across the Quake II server.
 */
export enum server_state_t {
  ss_dead,
  ss_loading,
  ss_game,
  ss_cinematic,
  ss_demo,
  ss_pic
}

/**
 * Original name: server_t
 * Source: server/server.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Stores map-scoped Quake II server state cleared on map changes.
 */
export interface server_t {
  state: server_state_t;
  attractloop: qboolean;
  loadgame: qboolean;
  time: number;
  framenum: number;
  name: string;
  models: Array<cmodel_s | null>;
  configstrings: string[];
  baselines: entity_state_t[];
  multicast: sizebuf_t;
  multicast_buf: Uint8Array;
  demofile: unknown | null;
  timedemo: qboolean;
}

/**
 * Original name: client_state_t
 * Source: server/server.h
 * Category: Ported
 * Fidelity level: Strict
 */
export enum client_state_t {
  cs_free,
  cs_zombie,
  cs_connected,
  cs_spawned
}

/**
 * Original name: client_frame_t
 * Source: server/server.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Stores one per-client frame history entry used for delta compression and ping tracking.
 */
export interface client_frame_t {
  areabytes: number;
  areabits: Uint8Array;
  ps: player_state_t;
  num_entities: number;
  first_entity: number;
  senttime: number;
}

/**
 * Original name: client_s
 * Source: server/server.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Stores one connected server client slot and its network-facing state.
 */
export interface client_t {
  state: client_state_t;
  userinfo: string;
  lastframe: number;
  lastcmd: usercmd_t;
  commandMsec: number;
  frame_latency: Int32Array;
  ping: number;
  message_size: Int32Array;
  rate: number;
  surpressCount: number;
  edict: edict_t | null;
  name: string;
  messagelevel: number;
  datagram: sizebuf_t;
  datagram_buf: Uint8Array;
  frames: client_frame_t[];
  download: Uint8Array | null;
  downloadsize: number;
  downloadcount: number;
  lastmessage: number;
  lastconnect: number;
  challenge: number;
  netchan: netchan_t;
}

/**
 * Original name: challenge_t
 * Source: server/server.h
 * Category: Ported
 * Fidelity level: Strict
 */
export interface challenge_t {
  adr: netadr_t;
  challenge: number;
  time: number;
}

/**
 * Original name: server_static_t
 * Source: server/server.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Stores server-global state that persists across map loads.
 */
export interface server_static_t {
  initialized: qboolean;
  realtime: number;
  mapcmd: string;
  spawncount: number;
  clients: client_t[];
  num_client_entities: number;
  next_client_entities: number;
  client_entities: entity_state_t[];
  last_heartbeat: number;
  challenges: challenge_t[];
  demofile: unknown | null;
  demo_multicast: sizebuf_t;
  demo_multicast_buf: Uint8Array;
}

/**
 * Original name: redirect_t
 * Source: server/server.h
 * Category: Ported
 * Fidelity level: Strict
 */
export enum redirect_t {
  RD_NONE,
  RD_CLIENT,
  RD_PACKET
}

/**
 * Original name: N/A
 * Source: N/A (server header state bundle)
 * Category: New
 * Purpose: Group the server-global extern variables declared by `server.h`.
 *
 * Constraints:
 * - Must keep the original split between `sv`, `svs`, current-client pointers and global cvar references explicit.
 */
export interface ServerHeaderState {
  net_from: netadr_t;
  net_message: sizebuf_t;
  master_adr: netadr_t[];
  svs: server_static_t;
  sv: server_t;
  sv_paused: cvar_t | null;
  maxclients: cvar_t | null;
  sv_noreload: cvar_t | null;
  sv_airaccelerate: cvar_t | null;
  sv_enforcetime: cvar_t | null;
  sv_client: client_t | null;
  sv_player: edict_t | null;
  ge: game_export_t | null;
  sv_outputbuf: string;
}

/**
 * Original name: N/A
 * Source: N/A (server procedure interface bundle)
 * Category: New
 * Purpose: Declare the `sv_main.c` entry points exposed by `server.h`.
 */
export interface ServerMainProcedures {
  SV_Init: () => void;
  SV_Shutdown: (finalmsg: string, reconnect: qboolean) => void;
  SV_FinalMessage: (message: string, reconnect: qboolean) => void;
  SV_DropClient: (drop: client_t) => void;
  SV_WriteClientdataToMessage?: (client: client_t, msg: sizebuf_t) => void;
  SV_SendServerinfo?: (client: client_t) => void;
  SVC_Status: () => void;
  SVC_Ping: () => void;
  SV_ConnectionlessPacket: () => string;
  SV_ReadPackets: () => number;
  SV_CheckTimeouts: () => void;
  SV_CalcPings: () => void;
  SV_GiveMsec: () => void;
  SV_PrepWorldFrame: () => void;
  SV_RunGameFrame: () => void;
  SV_Frame: (msec: number) => void;
  SV_UserinfoChanged: (client: client_t) => void;
  Master_Heartbeat: () => void;
  Master_Packet?: () => void;
}

/**
 * Original name: N/A
 * Source: N/A (server procedure interface bundle)
 * Category: New
 * Purpose: Declare the `sv_init.c` entry points exposed by `server.h`.
 */
export interface ServerInitProcedures {
  SV_FindIndex: (name: string, start: number, max: number, create: qboolean) => number;
  SV_ModelIndex: (name: string) => number;
  SV_SoundIndex: (name: string) => number;
  SV_ImageIndex: (name: string) => number;
  SV_CreateBaseline: () => void;
  SV_CheckForSavegame: () => void;
  SV_SpawnServer: (
    server: string,
    spawnpoint: string,
    serverstate: server_state_t,
    attractloop: qboolean,
    loadgame: qboolean
  ) => void;
  SV_InitGame: () => void;
  SV_Map: (attractloop: qboolean, levelstring: string, loadgame: qboolean) => void;
}

/**
 * Original name: N/A
 * Source: N/A (server procedure interface bundle)
 * Category: New
 * Purpose: Preserve the legacy `server.h` physics-procedure grouping; `SV_PrepWorldFrame` implementation stays in `sv_main.ts`.
 */
export interface ServerPhysicsProcedures {
  SV_PrepWorldFrame: () => void;
}

/**
 * Original name: N/A
 * Source: N/A (server procedure interface bundle)
 * Category: New
 * Purpose: Declare the `sv_send.c` entry points exposed by `server.h`.
 */
export interface ServerSendProcedures {
  SV_FlushRedirect: (sv_redirected: number, outputbuf: string) => void;
  SV_DemoCompleted: () => void;
  SV_SendClientMessages: () => void;
  SV_Multicast: (origin: vec3_t | null, to: multicast_t) => void;
  SV_StartSound: (
    origin: vec3_t | null,
    entity: edict_t | null,
    channel: number,
    soundindex: number,
    volume: number,
    attenuation: number,
    timeofs: number
  ) => void;
  SV_ClientPrintf: (client: client_t, level: number, fmt: string, ...args: unknown[]) => void;
  SV_BroadcastPrintf: (level: number, fmt: string, ...args: unknown[]) => void;
  SV_BroadcastCommand: (fmt: string, ...args: unknown[]) => void;
}

/**
 * Original name: N/A
 * Source: N/A (server procedure interface bundle)
 * Category: New
 * Purpose: Declare the `sv_user.c` entry points exposed by `server.h`.
 */
export interface ServerUserProcedures {
  SV_New_f: () => void;
  SV_Configstrings_f: () => void;
  SV_Baselines_f: () => void;
  SV_Begin_f: () => void;
  SV_NextDownload_f: () => void;
  SV_BeginDownload_f: () => void;
  SV_Disconnect_f: () => void;
  SV_ShowServerinfo_f: () => string[];
  SV_Nextserver: () => void;
  SV_ExecuteUserCommand: (command: string) => void;
  SV_ClientThink: (client: client_t, cmd: usercmd_t) => void;
  SV_ExecuteClientMessage: (client: client_t) => void;
}

/**
 * Original name: N/A
 * Source: N/A (server procedure interface bundle)
 * Category: New
 * Purpose: Declare the `sv_ccmds.c` entry points exposed by `server.h`.
 */
export interface ServerConsoleProcedures {
  SV_ReadLevelFile: () => void;
  SV_Status_f: () => void;
  SV_InitOperatorCommands: () => void;
}

/**
 * Original name: N/A
 * Source: N/A (server procedure interface bundle)
 * Category: New
 * Purpose: Declare the `sv_ents.c` entry points exposed by `server.h`.
 */
export interface ServerEntityProcedures {
  SV_WriteFrameToClient: (client: client_t, msg: sizebuf_t) => void;
  SV_RecordDemoMessage: () => void;
  SV_BuildClientFrame: (client: client_t) => void;
  SV_Error: (error: string, ...args: unknown[]) => void;
}

/**
 * Original name: N/A
 * Source: N/A (server procedure interface bundle)
 * Category: New
 * Purpose: Declare the `sv_game.c` entry points exposed by `server.h`.
 */
export interface ServerGameProcedures {
  SV_InitGameProgs: () => void;
  SV_ShutdownGameProgs: () => void;
  SV_InitEdict: (edict: edict_t) => void;
}

/**
 * Original name: N/A
 * Source: N/A (server procedure interface bundle)
 * Category: New
 * Purpose: Declare the `sv_world.c` entry points exposed by `server.h`.
 */
export interface ServerWorldProcedures {
  SV_ClearWorld: () => void;
  SV_UnlinkEdict: (ent: edict_t) => void;
  SV_LinkEdict: (ent: edict_t) => void;
  SV_AreaEdicts: (mins: vec3_t, maxs: vec3_t, list: Array<edict_t | null>, maxcount: number, areatype: number) => number;
  SV_PointContents: (point: vec3_t) => number;
  SV_Trace: (
    start: vec3_t,
    mins: vec3_t,
    maxs: vec3_t,
    end: vec3_t,
    passedict: edict_t | null,
    contentmask: number
  ) => trace_t;
}

/**
 * Original name: N/A
 * Source: N/A (server struct factory)
 * Category: New
 * Purpose: Create one zero-initialized `client_frame_t`.
 *
 * Constraints:
 * - Must preserve Quake-style zero defaults.
 */
export function createClientFrame(): client_frame_t {
  return {
    areabytes: 0,
    areabits: new Uint8Array(MAX_MAP_AREAS / 8),
    ps: createPlayerState(),
    num_entities: 0,
    first_entity: 0,
    senttime: 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (server struct factory)
 * Category: New
 * Purpose: Create one zero-initialized `client_t`.
 *
 * Constraints:
 * - Must allocate the fixed-size latency, message-size and frame-history storage declared in `server.h`.
 */
export function createServerClient(): client_t {
  return {
    state: client_state_t.cs_free,
    userinfo: "",
    lastframe: 0,
    lastcmd: {
      msec: 0,
      buttons: 0,
      angles: [0, 0, 0],
      forwardmove: 0,
      sidemove: 0,
      upmove: 0,
      impulse: 0,
      lightlevel: 0
    },
    commandMsec: 0,
    frame_latency: new Int32Array(LATENCY_COUNTS),
    ping: 0,
    message_size: new Int32Array(RATE_MESSAGES),
    rate: 0,
    surpressCount: 0,
    edict: null,
    name: "",
    messagelevel: 0,
    datagram: createSizeBuffer(MAX_MSGLEN, true),
    datagram_buf: new Uint8Array(MAX_MSGLEN),
    frames: Array.from({ length: UPDATE_BACKUP }, () => createClientFrame()),
    download: null,
    downloadsize: 0,
    downloadcount: 0,
    lastmessage: 0,
    lastconnect: 0,
    challenge: 0,
    netchan: createNetchan()
  };
}

/**
 * Original name: N/A
 * Source: N/A (server struct factory)
 * Category: New
 * Purpose: Create one zero-initialized `challenge_t`.
 *
 * Constraints:
 * - Must preserve the original empty challenge-slot defaults.
 */
export function createChallenge(): challenge_t {
  return {
    adr: createNetAdr(),
    challenge: 0,
    time: 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (server struct factory)
 * Category: New
 * Purpose: Create one zero-initialized `server_t`.
 *
 * Constraints:
 * - Must allocate the fixed arrays declared in `server.h`.
 */
export function createServerState(): server_t {
  return {
    state: server_state_t.ss_dead,
    attractloop: false,
    loadgame: false,
    time: 0,
    framenum: 0,
    name: "",
    models: new Array<cmodel_s | null>(MAX_MODELS).fill(null),
    configstrings: new Array<string>(MAX_CONFIGSTRINGS).fill(""),
    baselines: Array.from({ length: MAX_EDICTS }, () => createEntityState()),
    multicast: createSizeBuffer(MAX_MSGLEN, true),
    multicast_buf: new Uint8Array(MAX_MSGLEN),
    demofile: null,
    timedemo: false
  };
}

/**
 * Original name: N/A
 * Source: N/A (server struct factory)
 * Category: New
 * Purpose: Create one zero-initialized `server_static_t`.
 *
 * Constraints:
 * - Must preserve the original challenge table and demo multicast buffers.
 */
export function createServerStatic(): server_static_t {
  return {
    initialized: false,
    realtime: 0,
    mapcmd: "",
    spawncount: 0,
    clients: [],
    num_client_entities: 0,
    next_client_entities: 0,
    client_entities: [],
    last_heartbeat: 0,
    challenges: Array.from({ length: MAX_CHALLENGES }, () => createChallenge()),
    demofile: null,
    demo_multicast: createSizeBuffer(MAX_MSGLEN, true),
    demo_multicast_buf: new Uint8Array(MAX_MSGLEN)
  };
}

/**
 * Original name: N/A
 * Source: N/A (server header state factory)
 * Category: New
 * Purpose: Create the server-global extern bundle declared by `server.h`.
 *
 * Constraints:
 * - Must preserve explicit ownership of `sv`, `svs` and the mutable current-client pointers.
 */
export function createServerHeaderState(): ServerHeaderState {
  return {
    net_from: createNetAdr(),
    net_message: createSizeBuffer(MAX_MSGLEN, true),
    master_adr: Array.from({ length: MAX_MASTERS }, () => createNetAdr()),
    svs: createServerStatic(),
    sv: createServerState(),
    sv_paused: null,
    maxclients: null,
    sv_noreload: null,
    sv_airaccelerate: null,
    sv_enforcetime: null,
    sv_client: null,
    sv_player: null,
    ge: null,
    sv_outputbuf: ""
  };
}

/**
 * Original name: EDICT_NUM
 * Source: server/server.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns the edict stored at the given game-export index.
 *
 * Porting notes:
 * - Replaces pointer arithmetic over `ge->edicts` with explicit array indexing.
 */
export function EDICT_NUM(game: game_export_t, index: number): edict_t | null {
  return game.edicts[index] ?? null;
}

/**
 * Original name: NUM_FOR_EDICT
 * Source: server/server.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns the numeric index of one edict inside `game.edicts`.
 *
 * Porting notes:
 * - Replaces pointer subtraction with `Array#indexOf`.
 */
export function NUM_FOR_EDICT(game: game_export_t, edict: edict_t): number {
  return game.edicts.indexOf(edict);
}

/**
 * Original name: N/A
 * Source: N/A (derived server ring size helper)
 * Category: New
 * Purpose: Compute the standard server-side client-entity ring allocation count derived from `maxclients`.
 *
 * Constraints:
 * - Must preserve the original `maxclients * UPDATE_BACKUP * MAX_PACKET_ENTITIES` formula from `server.h`.
 */
export function computeServerClientEntityCapacity(maxclients: number): number {
  return maxclients * UPDATE_BACKUP * MAX_PACKET_ENTITIES;
}
