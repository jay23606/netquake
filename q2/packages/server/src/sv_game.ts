/**
 * File: sv_game.ts
 * Source: Quake II original / server/sv_game.c
 * Purpose: Port of the server-side bridge between the engine and the gameplay module.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses an explicit context object instead of file-static globals.
 * - Loads the TypeScript gameplay export factory directly instead of a native DLL.
 * - `Sys_UnloadGame` is modeled as an in-memory shutdown/reset step.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

import { SZ_Clear, SZ_Write } from "../../memory/src/index.js";
import {
  GetGameApiFunction,
  GAME_API_VERSION,
  type GetGameApi,
  type edict_t,
  type game_export_t,
  type game_import_t
} from "../../game/src/index.js";
import {
  Cbuf_AddText,
  CM_AreasConnected,
  CM_ClusterPHS,
  CM_ClusterPVS,
  CM_InlineModel,
  CM_LeafArea,
  CM_LeafCluster,
  CM_PointLeafnum,
  CM_SetAreaPortalState,
  Cvar_ForceSet,
  Cvar_Get,
  Cvar_Set,
  MSG_WriteAngle,
  MSG_WriteByte,
  MSG_WriteChar,
  MSG_WriteDir,
  MSG_WriteFloat,
  MSG_WriteLong,
  MSG_WritePos,
  MSG_WriteShort,
  MSG_WriteString,
  Pmove,
  createEntityState,
  createPmoveContext,
  multicast_t,
  svc_ops_e,
  type CollisionWorld,
  type CommandRuntime,
  type CvarRuntime,
  type cmodel_t,
  type cvar_t,
  type pmove_t,
  type qboolean,
  type trace_t,
  type vec3_t
} from "../../qcommon/src/index.js";
import {
  EDICT_NUM,
  NUM_FOR_EDICT,
  server_state_t,
  type ServerGameProcedures,
  type client_t,
  type server_static_t,
  type server_t
} from "./server.js";

/**
 * Original name: N/A
 * Source: N/A (server game context)
 * Category: New
 * Purpose: Hold the explicit runtime dependencies required by the `sv_game.c` port.
 *
 * Constraints:
 * - Keeps the engine/game bridge callbacks explicit and shared across `sv_init`, `sv_world` and `sv_send`.
 */
export interface ServerGameContext {
  sv: server_t;
  svs: server_static_t;
  ge: game_export_t;
  cmd: CommandRuntime;
  cvar: CvarRuntime;
  collisionWorld: CollisionWorld;
  maxclients: cvar_t | null;
  SV_Multicast: (origin: vec3_t | null, to: multicast_t) => void;
  SV_ClientPrintf: (client: client_t, level: number, fmt: string, ...args: unknown[]) => void;
  SV_BroadcastPrintf: (level: number, fmt: string, ...args: unknown[]) => void;
  SV_StartSound: (
    origin: vec3_t | null,
    entity: edict_t | null,
    channel: number,
    soundindex: number,
    volume: number,
    attenuation: number,
    timeofs: number
  ) => void;
  SV_LinkEdict: (ent: edict_t) => void;
  SV_UnlinkEdict: (ent: edict_t) => void;
  SV_AreaEdicts: (mins: vec3_t, maxs: vec3_t, list: Array<edict_t | null>, maxcount: number, areatype: number) => number;
  SV_Trace: (
    start: vec3_t,
    mins: vec3_t,
    maxs: vec3_t,
    end: vec3_t,
    passedict: edict_t | null,
    contentmask: number
  ) => trace_t;
  SV_PointContents: (point: vec3_t) => number;
  SV_ModelIndex: (name: string) => number;
  SV_SoundIndex: (name: string) => number;
  SV_ImageIndex: (name: string) => number;
  setGameExport?: (ge: game_export_t) => void;
  getGameApi?: GetGameApi;
  debugGraph?: (value: number, color: number) => void;
  onPrintf?: (message: string) => void;
  onDPrintf?: (message: string) => void;
  SV_Error?: (error: string, ...args: unknown[]) => never;
}

/**
 * Original name: N/A
 * Source: N/A (server game procedure factory)
 * Category: New
 * Purpose: Build the `sv_game.c` procedure table bound to one explicit server-game context.
 *
 * Constraints:
 * - Must preserve the original engine/game import wiring and side effects for the implemented subset.
 */
export function createServerGameProcedures(context: ServerGameContext): ServerGameProcedures {
  let gameInitialized = false;
  const zoneAllocations = new Map<Uint8Array, { tag: number; size: number }>();

  function SV_Error(error: string, ...args: unknown[]): never {
    if (context.SV_Error) {
      return context.SV_Error(error, ...args);
    }

    throw new Error(formatPrintf(error, args));
  }

  /**
   * Original name: PF_Unicast
   * Source: server/sv_game.c
   * Category: Ported
   * Fidelity level: Strict
   */
  function PF_Unicast(ent: edict_t | null, reliable: qboolean): void {
    if (!ent) {
      return;
    }

    const p = NUM_FOR_EDICT(context.ge, ent);
    const maxClients = Math.trunc(context.maxclients?.value ?? 0);
    if (p < 1 || p > maxClients) {
      return;
    }

    const client = context.svs.clients[p - 1];
    if (!client) {
      return;
    }

    if (reliable) {
      SZ_Write(client.netchan.message, context.sv.multicast.data.subarray(0, context.sv.multicast.cursize));
    } else {
      SZ_Write(client.datagram, context.sv.multicast.data.subarray(0, context.sv.multicast.cursize));
    }

    SZ_Clear(context.sv.multicast);
  }

  /**
   * Original name: PF_dprintf
   * Source: server/sv_game.c
   * Category: Ported
   * Fidelity level: Close
   */
  function PF_dprintf(fmt: string, ...args: unknown[]): void {
    context.onPrintf?.(formatPrintf(fmt, args));
  }

  /**
   * Original name: PF_cprintf
   * Source: server/sv_game.c
   * Category: Ported
   * Fidelity level: Close
   */
  function PF_cprintf(ent: edict_t | null, level: number, fmt: string, ...args: unknown[]): void {
    if (ent) {
      const n = NUM_FOR_EDICT(context.ge, ent);
      const maxClients = Math.trunc(context.maxclients?.value ?? 0);
      if (n < 1 || n > maxClients) {
        SV_Error("cprintf to a non-client");
      }

      context.SV_ClientPrintf(context.svs.clients[n - 1]!, level, "%s", formatPrintf(fmt, args));
      return;
    }

    context.onPrintf?.(formatPrintf(fmt, args));
  }

  /**
   * Original name: PF_centerprintf
   * Source: server/sv_game.c
   * Category: Ported
   * Fidelity level: Strict
   */
  function PF_centerprintf(ent: edict_t | null, fmt: string, ...args: unknown[]): void {
    if (!ent) {
      return;
    }

    const n = NUM_FOR_EDICT(context.ge, ent);
    const maxClients = Math.trunc(context.maxclients?.value ?? 0);
    if (n < 1 || n > maxClients) {
      return;
    }

    MSG_WriteByte(context.sv.multicast, svc_ops_e.svc_centerprint);
    MSG_WriteString(context.sv.multicast, formatPrintf(fmt, args));
    PF_Unicast(ent, true);
  }

  /**
   * Original name: PF_error
   * Source: server/sv_game.c
   * Category: Ported
   * Fidelity level: Strict
   */
  function PF_error(fmt: string, ...args: unknown[]): never {
    SV_Error(`Game Error: ${formatPrintf(fmt, args)}`);
  }

  /**
   * Original name: PF_setmodel
   * Source: server/sv_game.c
   * Category: Ported
   * Fidelity level: Close
   */
  function PF_setmodel(ent: edict_t, name: string): void {
    if (!name) {
      SV_Error("PF_setmodel: NULL");
    }

    const i = context.SV_ModelIndex(name);
    ent.s.modelindex = i;

    if (name[0] === "*") {
      const mod = CM_InlineModel(context.collisionWorld, name);
      if (!mod) {
        SV_Error("PF_setmodel: bad inline model %s", name);
      }

      ent.mins[0] = mod.mins[0];
      ent.mins[1] = mod.mins[1];
      ent.mins[2] = mod.mins[2];
      ent.maxs[0] = mod.maxs[0];
      ent.maxs[1] = mod.maxs[1];
      ent.maxs[2] = mod.maxs[2];
      context.SV_LinkEdict(ent);
    }
  }

  /**
   * Original name: PF_Configstring
   * Source: server/sv_game.c
   * Category: Ported
   * Fidelity level: Strict
   */
  function PF_Configstring(index: number, val: string): void {
    if (index < 0 || index >= context.sv.configstrings.length) {
      SV_Error("configstring: bad index %i\n", index);
    }

    const resolved = val ?? "";
    context.sv.configstrings[index] = resolved;

    if (context.sv.state !== server_state_t.ss_loading) {
      SZ_Clear(context.sv.multicast);
      MSG_WriteChar(context.sv.multicast, svc_ops_e.svc_configstring);
      MSG_WriteShort(context.sv.multicast, index);
      MSG_WriteString(context.sv.multicast, resolved);
      context.SV_Multicast([0, 0, 0], multicast_t.MULTICAST_ALL_R);
    }
  }

  /**
   * Original name: PF_WriteChar
   * Source: server/sv_game.c
   * Category: Ported
   * Fidelity level: Strict
   */
  function PF_WriteChar(c: number): void { MSG_WriteChar(context.sv.multicast, c); }

  /**
   * Original name: PF_WriteByte
   * Source: server/sv_game.c
   * Category: Ported
   * Fidelity level: Strict
   */
  function PF_WriteByte(c: number): void { MSG_WriteByte(context.sv.multicast, c); }

  /**
   * Original name: PF_WriteShort
   * Source: server/sv_game.c
   * Category: Ported
   * Fidelity level: Strict
   */
  function PF_WriteShort(c: number): void { MSG_WriteShort(context.sv.multicast, c); }

  /**
   * Original name: PF_WriteLong
   * Source: server/sv_game.c
   * Category: Ported
   * Fidelity level: Strict
   */
  function PF_WriteLong(c: number): void { MSG_WriteLong(context.sv.multicast, c); }

  /**
   * Original name: PF_WriteFloat
   * Source: server/sv_game.c
   * Category: Ported
   * Fidelity level: Strict
   */
  function PF_WriteFloat(f: number): void { MSG_WriteFloat(context.sv.multicast, f); }

  /**
   * Original name: PF_WriteString
   * Source: server/sv_game.c
   * Category: Ported
   * Fidelity level: Strict
   */
  function PF_WriteString(s: string): void { MSG_WriteString(context.sv.multicast, s); }

  /**
   * Original name: PF_WritePos
   * Source: server/sv_game.c
   * Category: Ported
   * Fidelity level: Strict
   */
  function PF_WritePos(pos: vec3_t): void { MSG_WritePos(context.sv.multicast, pos); }

  /**
   * Original name: PF_WriteDir
   * Source: server/sv_game.c
   * Category: Ported
   * Fidelity level: Strict
   */
  function PF_WriteDir(dir: vec3_t): void { MSG_WriteDir(context.sv.multicast, dir); }

  /**
   * Original name: PF_WriteAngle
   * Source: server/sv_game.c
   * Category: Ported
   * Fidelity level: Strict
   */
  function PF_WriteAngle(f: number): void { MSG_WriteAngle(context.sv.multicast, f); }

  /**
   * Original name: PF_inPVS
   * Source: server/sv_game.c
   * Category: Ported
   * Fidelity level: Strict
   */
  function PF_inPVS(p1: vec3_t, p2: vec3_t): qboolean {
    const leaf1 = CM_PointLeafnum(context.collisionWorld, p1);
    const cluster1 = CM_LeafCluster(context.collisionWorld, leaf1);
    const area1 = CM_LeafArea(context.collisionWorld, leaf1);
    const mask = CM_ClusterPVS(context.collisionWorld, cluster1);

    const leaf2 = CM_PointLeafnum(context.collisionWorld, p2);
    const cluster2 = CM_LeafCluster(context.collisionWorld, leaf2);
    const area2 = CM_LeafArea(context.collisionWorld, leaf2);

    if (mask.length !== 0 && (mask[cluster2 >> 3] & (1 << (cluster2 & 7))) === 0) {
      return false;
    }
    if (!CM_AreasConnected(context.collisionWorld, area1, area2)) {
      return false;
    }
    return true;
  }

  /**
   * Original name: PF_inPHS
   * Source: server/sv_game.c
   * Category: Ported
   * Fidelity level: Strict
   */
  function PF_inPHS(p1: vec3_t, p2: vec3_t): qboolean {
    const leaf1 = CM_PointLeafnum(context.collisionWorld, p1);
    const cluster1 = CM_LeafCluster(context.collisionWorld, leaf1);
    const area1 = CM_LeafArea(context.collisionWorld, leaf1);
    const mask = CM_ClusterPHS(context.collisionWorld, cluster1);

    const leaf2 = CM_PointLeafnum(context.collisionWorld, p2);
    const cluster2 = CM_LeafCluster(context.collisionWorld, leaf2);
    const area2 = CM_LeafArea(context.collisionWorld, leaf2);

    if (mask.length !== 0 && (mask[cluster2 >> 3] & (1 << (cluster2 & 7))) === 0) {
      return false;
    }
    if (!CM_AreasConnected(context.collisionWorld, area1, area2)) {
      return false;
    }
    return true;
  }

  /**
   * Original name: PF_StartSound
   * Source: server/sv_game.c
   * Category: Ported
   * Fidelity level: Strict
   */
  function PF_StartSound(
    entity: edict_t | null,
    channel: number,
    sound_num: number,
    volume: number,
    attenuation: number,
    timeofs: number
  ): void {
    if (!entity) {
      return;
    }

    context.SV_StartSound(null, entity, channel, sound_num, volume, attenuation, timeofs);
  }

  /**
   * Original name: SV_ShutdownGameProgs
   * Source: server/sv_game.c
   * Category: Ported
   * Fidelity level: Close
   */
  function SV_ShutdownGameProgs(): void {
    if (!gameInitialized) {
      return;
    }

    context.ge.Shutdown();
    gameInitialized = false;
  }

  /**
   * Original name: SV_InitGameProgs
   * Source: server/sv_game.c
   * Category: Ported
   * Fidelity level: Close
   */
  function SV_InitGameProgs(): void {
    if (gameInitialized) {
      SV_ShutdownGameProgs();
    }

    const imports: game_import_t = {
      multicast: (origin, to) => context.SV_Multicast(origin, to),
      unicast: PF_Unicast,
      bprintf: (printlevel, fmt, ...args) => context.SV_BroadcastPrintf(printlevel, fmt, ...args),
      dprintf: PF_dprintf,
      cprintf: PF_cprintf,
      centerprintf: PF_centerprintf,
      error: PF_error,
      linkentity: (ent) => context.SV_LinkEdict(ent),
      unlinkentity: (ent) => context.SV_UnlinkEdict(ent),
      BoxEdicts: (mins, maxs, list, maxcount, areatype) => context.SV_AreaEdicts(mins, maxs, list, maxcount, areatype),
      trace: (start, mins, maxs, end, passent, contentmask) => context.SV_Trace(start, mins, maxs, end, passent, contentmask),
      pointcontents: (point) => context.SV_PointContents(point),
      setmodel: PF_setmodel,
      inPVS: PF_inPVS,
      inPHS: PF_inPHS,
      Pmove: (pmove: pmove_t) => {
        Pmove(createPmoveContext(pmove));
      },
      modelindex: context.SV_ModelIndex,
      soundindex: context.SV_SoundIndex,
      imageindex: context.SV_ImageIndex,
      configstring: PF_Configstring,
      sound: PF_StartSound,
      positioned_sound: (origin, ent, channel, soundindex, volume, attenuation, timeofs) => {
        context.SV_StartSound(origin, ent, channel, soundindex, volume, attenuation, timeofs);
      },
      WriteChar: PF_WriteChar,
      WriteByte: PF_WriteByte,
      WriteShort: PF_WriteShort,
      WriteLong: PF_WriteLong,
      WriteFloat: PF_WriteFloat,
      WriteString: PF_WriteString,
      WritePosition: PF_WritePos,
      WriteDir: PF_WriteDir,
      WriteAngle: PF_WriteAngle,
      TagMalloc: (size, tag) => {
        const allocation = new Uint8Array(Math.max(0, size | 0));
        zoneAllocations.set(allocation, { tag, size: allocation.length });
        return allocation;
      },
      TagFree: (block) => {
        if (block instanceof Uint8Array) {
          zoneAllocations.delete(block);
        }
      },
      FreeTags: (tag) => {
        for (const [allocation, metadata] of zoneAllocations) {
          if (metadata.tag === tag) {
            zoneAllocations.delete(allocation);
          }
        }
      },
      cvar: (var_name, value, flags) => Cvar_Get(context.cvar, var_name, value, flags),
      cvar_set: (var_name, value) => Cvar_Set(context.cvar, var_name, value),
      cvar_forceset: (var_name, value) => Cvar_ForceSet(context.cvar, var_name, value),
      argc: () => context.cmd.cmd_argc,
      argv: (n) => context.cmd.cmd_argv[n] ?? "",
      args: () => context.cmd.cmd_args,
      AddCommandString: (text) => Cbuf_AddText(context.cmd, text),
      DebugGraph: (value, color) => {
        context.debugGraph?.(value, color);
      },
      SetAreaPortalState: (portalnum, open) => {
        CM_SetAreaPortalState(context.collisionWorld, portalnum, open);
      },
      AreasConnected: (area1, area2) => CM_AreasConnected(context.collisionWorld, area1, area2)
    };

    const nextGe = (context.getGameApi ?? GetGameApiFunction)(imports);
    if (nextGe.apiversion !== GAME_API_VERSION) {
      SV_Error("game is version %i, not %i", nextGe.apiversion, GAME_API_VERSION);
    }

    assignGameExports(context.ge, nextGe);
    context.setGameExport?.(context.ge);
    context.ge.Init();
    gameInitialized = true;
  }

  /**
   * Original name: SV_InitEdict
   * Source: server/server.h
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Resets the server-visible `edict_t` prefix fields to Quake-style zero defaults.
   */
  function SV_InitEdict(edict: edict_t): void {
    edict.inuse = false;
    edict.linkcount = 0;
    edict.num_clusters = 0;
    edict.headnode = 0;
    edict.areanum = 0;
    edict.areanum2 = 0;
    edict.svflags = 0;
    edict.s = createEntityState();
  }

  return {
    SV_InitGameProgs,
    SV_ShutdownGameProgs,
    SV_InitEdict
  };
}

/**
 * Original name: SV_InitGameProgs game export assignment adapter
 * Source: Quake-2-master/server/sv_game.c
 * Category: Adapter
 * Fidelity level: Adapter
 *
 * Purpose:
 * - Preserve descriptors from the TypeScript `GetGameApi` result while updating the existing server-owned `ge` object.
 */
function assignGameExports(target: game_export_t, source: game_export_t): void {
  const descriptors = Object.getOwnPropertyDescriptors(source);
  for (const key of Reflect.ownKeys(descriptors)) {
    Object.defineProperty(target, key, descriptors[key as keyof typeof descriptors]!);
  }
}

/**
 * Original name: N/A
 * Source: N/A (local printf formatter)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose:
 * - Provide the minimal `%s`/numeric formatting needed by the variadic `sv_game.c` callback ports.
 */
function formatPrintf(fmt: string, args: unknown[]): string {
  if (args.length === 0) {
    return fmt;
  }

  let argIndex = 0;
  return fmt.replace(/%(%|s|d|i|f)/g, (_, spec: string) => {
    if (spec === "%") {
      return "%";
    }

    const value = args[argIndex];
    argIndex += 1;
    if (spec === "f") {
      return Number(value ?? 0).toString();
    }
    if (spec === "d" || spec === "i") {
      return Math.trunc(Number(value ?? 0)).toString();
    }

    return String(value ?? "");
  });
}
