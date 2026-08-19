/**
 * File: sv_init.ts
 * Source: Quake II original / server/sv_init.c
 * Purpose: Port of Quake II server initialization, map switching and resource-index routines.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses an explicit context object instead of file-static globals.
 * - Savegame probing and host side effects are routed through optional callbacks.
 * - Per-level `sv` reset mutates the shared runtime object from a fresh zeroed state.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

import { SZ_Clear, SZ_Init } from "../../memory/src/index.js";
import type { game_export_t } from "../../game/src/index.js";
import {
  CM_EntityString,
  CM_InlineModel,
  CM_LoadMap,
  CM_NumInlineModels,
  CS_AIRACCEL,
  CS_IMAGES,
  CS_MAPCHECKSUM,
  CS_MODELS,
  CS_NAME,
  CS_SOUNDS,
  CVAR_LATCH,
  CVAR_NOSET,
  CVAR_SERVERINFO,
  Cvar_FullSet,
  Cvar_GetLatchedVars,
  Cvar_Set,
  Cvar_VariableValue,
  MAX_CLIENTS,
  MAX_IMAGES,
  MAX_MODELS,
  MAX_OSPATH,
  MAX_QPATH,
  MAX_SOUNDS,
  MSG_WriteChar,
  MSG_WriteShort,
  MSG_WriteString,
  NET_Config,
  NET_StringToAdr,
  PORT_MASTER,
  createEntityState,
  svc_ops_e,
  type CollisionMapLoader,
  type CollisionModelRuntime,
  type CommandRuntime,
  type CvarRuntime,
  type QcommonNetRuntime,
  type cvar_t,
  type entity_state_t,
  type netadr_t,
  type qboolean,
  type vec3_t,
  multicast_t,
  vec3_origin
} from "../../qcommon/src/index.js";
import {
  EDICT_NUM,
  client_state_t,
  computeServerClientEntityCapacity,
  createServerClient,
  createServerState,
  server_state_t,
  type ServerInitProcedures,
  type client_t,
  type server_static_t,
  type server_t
} from "./server.js";

/**
 * Original name: N/A
 * Source: N/A (named savegame restore loop count)
 * Category: New
 * Purpose: Name the fixed number of settling frames pumped after restoring a savegame.
 */
const SAVEGAME_FRAME_COUNT = 100;

/**
 * Original name: N/A
 * Source: N/A (server init dependency context)
 * Category: New
 * Purpose: Hold the explicit runtime dependencies required by the `sv_init.c` port.
 *
 * Constraints:
 * - Keeps the original `sv`, `svs`, cvars and host side effects explicit.
 */
export interface ServerInitContext {
  sv: server_t;
  svs: server_static_t;
  ge: game_export_t;
  cmd: CommandRuntime;
  cvar: CvarRuntime;
  qnet: QcommonNetRuntime;
  collisionModelRuntime: CollisionModelRuntime;
  loadMapFile?: CollisionMapLoader;
  maxclients: cvar_t | null;
  dedicated: cvar_t | null;
  sv_noreload: cvar_t | null;
  sv_airaccelerate: cvar_t | null;
  master_adr: netadr_t[];
  SV_Multicast: (origin: vec3_t | null, to: multicast_t) => void;
  SV_ClearWorld: () => void;
  SV_BroadcastCommand?: (fmt: string, ...args: unknown[]) => void;
  SV_SendClientMessages?: () => void;
  SV_InitGameProgs?: () => void;
  SV_ReadLevelFile?: () => void;
  SV_Shutdown?: (finalmsg: string, reconnect: qboolean) => void;
  CL_Drop?: () => void;
  SCR_BeginLoadingPlaque?: () => void;
  Cbuf_CopyToDefer?: () => void;
  FS_Gamedir?: () => string;
  savegameExists?: (path: string) => boolean;
  closeDemoFile?: (demofile: unknown) => void;
  setServerState?: (state: server_state_t) => void;
  setPmAiraccelerate?: (value: number) => void;
  randomInt?: () => number;
  onPrintf?: (message: string) => void;
  onDPrintf?: (message: string) => void;
  SV_Error?: (error: string, ...args: unknown[]) => never;
}

/**
 * Original name: N/A
 * Source: N/A (server init procedure factory)
 * Category: New
 * Purpose: Build the `sv_init.c` procedure table bound to one explicit server-init context.
 *
 * Constraints:
 * - Must preserve call order and side effects from the original file for the implemented subset.
 */
export function createServerInitProcedures(context: ServerInitContext): ServerInitProcedures {
  function SV_Error(error: string, ...args: unknown[]): never {
    if (context.SV_Error) {
      return context.SV_Error(error, ...args);
    }

    throw new Error(formatPrintf(error, args));
  }

  /**
   * Original name: SV_FindIndex
   * Source: server/sv_init.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Finds or allocates one configstring resource index and multicasts live updates outside `ss_loading`.
   *
   * Porting notes:
   * - Uses the explicit `ServerInitContext.sv` object instead of the file-global `sv`.
   */
  function SV_FindIndex(name: string, start: number, max: number, create: qboolean): number {
    if (!name.length) {
      return 0;
    }

    let i = 1;
    for (; i < max && (context.sv.configstrings[start + i] ?? "").length !== 0; i += 1) {
      if ((context.sv.configstrings[start + i] ?? "") === name) {
        return i;
      }
    }

    if (!create) {
      return 0;
    }

    if (i === max) {
      SV_Error("*Index: overflow");
    }

    context.sv.configstrings[start + i] = name.slice(0, MAX_QPATH - 1);

    if (context.sv.state !== server_state_t.ss_loading) {
      SZ_Clear(context.sv.multicast);
      MSG_WriteChar(context.sv.multicast, svc_ops_e.svc_configstring);
      MSG_WriteShort(context.sv.multicast, start + i);
      MSG_WriteString(context.sv.multicast, name);
      context.SV_Multicast(vec3_origin, multicast_t.MULTICAST_ALL_R);
    }

    return i;
  }

  /**
   * Original name: SV_ModelIndex
   * Source: server/sv_init.c
   * Category: Ported
   * Fidelity level: Strict
   *
   * Behavior:
   * - Allocates model configstrings in the original `CS_MODELS` range.
   */
  function SV_ModelIndex(name: string): number {
    return SV_FindIndex(name, CS_MODELS, MAX_MODELS, true);
  }

  /**
   * Original name: SV_SoundIndex
   * Source: server/sv_init.c
   * Category: Ported
   * Fidelity level: Strict
   *
   * Behavior:
   * - Allocates sound configstrings in the original `CS_SOUNDS` range.
   */
  function SV_SoundIndex(name: string): number {
    return SV_FindIndex(name, CS_SOUNDS, MAX_SOUNDS, true);
  }

  /**
   * Original name: SV_ImageIndex
   * Source: server/sv_init.c
   * Category: Ported
   * Fidelity level: Strict
   *
   * Behavior:
   * - Allocates image configstrings in the original `CS_IMAGES` range.
   */
  function SV_ImageIndex(name: string): number {
    return SV_FindIndex(name, CS_IMAGES, MAX_IMAGES, true);
  }

  /**
   * Original name: SV_CreateBaseline
   * Source: server/sv_init.c
   * Category: Ported
   * Fidelity level: Strict
   *
   * Behavior:
   * - Snapshots active entities with model, sound or effect state into `sv.baselines`.
   *
   * Porting notes:
   * - Replaces pointer access through `EDICT_NUM` with the shared TypeScript edict-array helper.
   */
  function SV_CreateBaseline(): void {
    for (let entnum = 1; entnum < context.ge.num_edicts; entnum += 1) {
      const svent = EDICT_NUM(context.ge, entnum);
      if (!svent?.inuse) {
        continue;
      }
      if (!svent.s.modelindex && !svent.s.sound && !svent.s.effects) {
        continue;
      }

      svent.s.number = entnum;
      svent.s.old_origin[0] = svent.s.origin[0];
      svent.s.old_origin[1] = svent.s.origin[1];
      svent.s.old_origin[2] = svent.s.origin[2];
      context.sv.baselines[entnum] = cloneEntityState(svent.s);
    }
  }

  /**
   * Original name: SV_CheckForSavegame
   * Source: server/sv_init.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Restores current-level save data when available and pumps 100 frames for non-loadgame returns.
   *
   * Porting notes:
   * - File probing and level-file IO are delegated to host callbacks so browser storage can provide the same flow.
   */
  function SV_CheckForSavegame(): void {
    if ((context.sv_noreload?.value ?? 0) !== 0) {
      return;
    }

    if (Cvar_VariableValue(context.cvar, "deathmatch") !== 0) {
      return;
    }

    const gamedir = context.FS_Gamedir?.() ?? "baseq2";
    const savePath = `${gamedir}/save/current/${context.sv.name}.sav`.slice(0, MAX_OSPATH - 1);
    if (!context.savegameExists?.(savePath)) {
      return;
    }

    context.SV_ClearWorld();
    context.SV_ReadLevelFile?.();

    if (!context.sv.loadgame) {
      const previousState = context.sv.state;
      setServerState(server_state_t.ss_loading);
      for (let i = 0; i < SAVEGAME_FRAME_COUNT; i += 1) {
        context.ge.RunFrame();
      }
      setServerState(previousState);
    }
  }

  /**
   * Original name: SV_SpawnServer
   * Source: server/sv_init.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Clears per-level server state, loads the map or media placeholder state, spawns entities and builds baselines.
   *
   * Porting notes:
   * - Mutates the shared `sv` object from a fresh `createServerState()` result to preserve references held by other subsystems.
   */
  function SV_SpawnServer(
    server: string,
    spawnpoint: string,
    serverstate: server_state_t,
    attractloop: qboolean,
    loadgame: qboolean
  ): void {
    if (attractloop) {
      Cvar_Set(context.cvar, "paused", "0");
    }

    context.onPrintf?.("------- Server Initialization -------\n");
    context.onDPrintf?.(`SpawnServer: ${server}\n`);

    if (context.sv.demofile) {
      context.closeDemoFile?.(context.sv.demofile);
    }

    context.svs.spawncount += 1;
    setServerState(server_state_t.ss_dead);

    Object.assign(context.sv, createServerState());
    context.svs.realtime = 0;
    context.sv.loadgame = loadgame;
    context.sv.attractloop = attractloop;
    context.sv.configstrings[CS_NAME] = server;

    if (Cvar_VariableValue(context.cvar, "deathmatch") !== 0) {
      const airaccelerate = context.sv_airaccelerate?.value ?? 0;
      context.sv.configstrings[CS_AIRACCEL] = `${airaccelerate}`;
      context.setPmAiraccelerate?.(airaccelerate);
    } else {
      context.sv.configstrings[CS_AIRACCEL] = "0";
      context.setPmAiraccelerate?.(0);
    }

    SZ_Init(context.sv.multicast, context.sv.multicast_buf);
    context.sv.name = server;

    const maxClients = Math.trunc(context.maxclients?.value ?? 0);
    for (let i = 0; i < maxClients; i += 1) {
      const client = context.svs.clients[i];
      if (!client) {
        continue;
      }

      if (client.state > client_state_t.cs_connected) {
        client.state = client_state_t.cs_connected;
      }
      client.lastframe = -1;
    }

    context.sv.time = 1000;
    context.sv.name = server;
    context.sv.configstrings[CS_NAME] = server;

    let checksum = 0;
    if (serverstate !== server_state_t.ss_game) {
      const load = CM_LoadMap(context.collisionModelRuntime, "", false, context.loadMapFile ?? missingMapLoader);
      context.sv.models[1] = load.cmodel;
      checksum = load.checksum;
    } else {
      const mapPath = `maps/${server}.bsp`;
      context.sv.configstrings[CS_MODELS + 1] = mapPath.slice(0, MAX_QPATH - 1);
      const load = CM_LoadMap(context.collisionModelRuntime, mapPath, false, context.loadMapFile ?? missingMapLoader);
      context.sv.models[1] = load.cmodel;
      checksum = load.checksum;
    }

    context.sv.configstrings[CS_MAPCHECKSUM] = `${checksum}`;
    context.SV_ClearWorld();

    const world = context.collisionModelRuntime.world;
    if (world) {
      for (let i = 1; i < CM_NumInlineModels(world); i += 1) {
        const inlineName = `*${i}`;
        context.sv.configstrings[CS_MODELS + 1 + i] = inlineName;
        context.sv.models[i + 1] = CM_InlineModel(world, inlineName);
      }
    }

    setServerState(server_state_t.ss_loading);
    context.ge.SpawnEntities(context.sv.name, world ? CM_EntityString(world) : "", spawnpoint);
    context.ge.RunFrame();
    context.ge.RunFrame();

    setServerState(serverstate);
    SV_CreateBaseline();
    SV_CheckForSavegame();
    Cvar_FullSet(context.cvar, "mapname", context.sv.name, CVAR_SERVERINFO | CVAR_NOSET);
    context.onPrintf?.("-------------------------------------\n");
  }

  /**
   * Original name: SV_InitGame
   * Source: server/sv_init.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Starts a fresh game, applies maxclient rules, allocates client rings and initializes the game DLL facade.
   *
   * Porting notes:
   * - Uses arrays and factory helpers in place of `Z_Malloc` while preserving sizes and zero defaults.
   */
  function SV_InitGame(): void {
    if (context.svs.initialized) {
      context.SV_Shutdown?.("Server restarted\n", true);
    } else {
      context.CL_Drop?.();
      context.SCR_BeginLoadingPlaque?.();
    }

    Cvar_GetLatchedVars(context.cvar);
    context.svs.initialized = true;

    if (Cvar_VariableValue(context.cvar, "coop") !== 0 && Cvar_VariableValue(context.cvar, "deathmatch") !== 0) {
      context.onPrintf?.("Deathmatch and Coop both set, disabling Coop\n");
      Cvar_FullSet(context.cvar, "coop", "0", CVAR_SERVERINFO | CVAR_LATCH);
    }

    if ((context.dedicated?.value ?? 0) !== 0 && Cvar_VariableValue(context.cvar, "coop") === 0) {
      Cvar_FullSet(context.cvar, "deathmatch", "1", CVAR_SERVERINFO | CVAR_LATCH);
    }

    if (Cvar_VariableValue(context.cvar, "deathmatch") !== 0) {
      if ((context.maxclients?.value ?? 0) <= 1) {
        context.maxclients = Cvar_FullSet(context.cvar, "maxclients", "8", CVAR_SERVERINFO | CVAR_LATCH);
      } else if ((context.maxclients?.value ?? 0) > MAX_CLIENTS) {
        context.maxclients = Cvar_FullSet(context.cvar, "maxclients", `${MAX_CLIENTS}`, CVAR_SERVERINFO | CVAR_LATCH);
      }
    } else if (Cvar_VariableValue(context.cvar, "coop") !== 0) {
      if ((context.maxclients?.value ?? 0) <= 1 || (context.maxclients?.value ?? 0) > 4) {
        context.maxclients = Cvar_FullSet(context.cvar, "maxclients", "4", CVAR_SERVERINFO | CVAR_LATCH);
      }
    } else {
      context.maxclients = Cvar_FullSet(context.cvar, "maxclients", "1", CVAR_SERVERINFO | CVAR_LATCH);
    }

    const maxClients = Math.trunc(context.maxclients?.value ?? 0);
    context.svs.spawncount = Math.trunc(context.randomInt?.() ?? Math.random() * 0x7fffffff);
    context.svs.clients = Array.from({ length: maxClients }, () => createServerClient());
    context.svs.num_client_entities = computeServerClientEntityCapacity(maxClients);
    context.svs.client_entities = Array.from({ length: context.svs.num_client_entities }, () => createEntityState());

    NET_Config(context.qnet, maxClients > 1);
    context.svs.last_heartbeat = -99999;
    if (context.master_adr[0]) {
      NET_StringToAdr(`192.246.40.37:${PORT_MASTER}`, context.master_adr[0]);
    }

    context.SV_InitGameProgs?.();

    for (let i = 0; i < maxClients; i += 1) {
      const ent = EDICT_NUM(context.ge, i + 1);
      if (!ent) {
        continue;
      }

      ent.s.number = i + 1;
      context.svs.clients[i]!.edict = ent;
      zeroClientCommand(context.svs.clients[i]!);
    }
  }

  /**
   * Original name: SV_Map
   * Source: server/sv_init.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Parses Quake II map strings, selects cinematic/demo/pic/game state, then broadcasts reconnect.
   *
   * Porting notes:
   * - Host-only UI side effects such as the loading plaque remain callback-driven.
   */
  function SV_Map(attractloop: qboolean, levelstring: string, loadgame: qboolean): void {
    let level = levelstring.slice(0, MAX_QPATH - 1);
    let spawnpoint = "";

    context.sv.loadgame = loadgame;
    context.sv.attractloop = attractloop;

    if (context.sv.state === server_state_t.ss_dead && !context.sv.loadgame) {
      SV_InitGame();
    }

    const nextIndex = level.indexOf("+");
    if (nextIndex !== -1) {
      const nextserver = level.slice(nextIndex + 1);
      level = level.slice(0, nextIndex);
      Cvar_Set(context.cvar, "nextserver", `gamemap "${nextserver}"`);
    } else {
      Cvar_Set(context.cvar, "nextserver", "");
    }

    if (Cvar_VariableValue(context.cvar, "coop") !== 0 && level.toLowerCase() === "victory.pcx") {
      Cvar_Set(context.cvar, "nextserver", "gamemap \"*base1\"");
    }

    const spawnIndex = level.indexOf("$");
    if (spawnIndex !== -1) {
      spawnpoint = level.slice(spawnIndex + 1, spawnIndex + 1 + MAX_QPATH - 1);
      level = level.slice(0, spawnIndex);
    }

    if (level.startsWith("*")) {
      level = level.slice(1);
    }

    context.SCR_BeginLoadingPlaque?.();
    context.SV_BroadcastCommand?.("changing\n");

    if (endsWithInsensitive(level, ".cin")) {
      SV_SpawnServer(level, spawnpoint, server_state_t.ss_cinematic, attractloop, loadgame);
    } else if (endsWithInsensitive(level, ".dm2")) {
      SV_SpawnServer(level, spawnpoint, server_state_t.ss_demo, attractloop, loadgame);
    } else if (endsWithInsensitive(level, ".pcx")) {
      SV_SpawnServer(level, spawnpoint, server_state_t.ss_pic, attractloop, loadgame);
    } else {
      context.SV_SendClientMessages?.();
      SV_SpawnServer(level, spawnpoint, server_state_t.ss_game, attractloop, loadgame);
      context.Cbuf_CopyToDefer?.();
    }

    context.SV_BroadcastCommand?.("reconnect\n");
  }
  function setServerState(state: server_state_t): void {
    context.sv.state = state;
    context.setServerState?.(state);
  }

  function missingMapLoader(_name: string): Uint8Array | undefined {
    SV_Error("SV_SpawnServer: no map loader configured");
  }

  return {
    SV_FindIndex,
    SV_ModelIndex,
    SV_SoundIndex,
    SV_ImageIndex,
    SV_CreateBaseline,
    SV_CheckForSavegame,
    SV_SpawnServer,
    SV_InitGame,
    SV_Map
  };
}

/**
 * Original name: N/A
 * Source: N/A (entity state copy helper)
 * Category: New
 * Purpose: Copy the entity-state fields used by server baselines without sharing mutable vectors.
 */
function cloneEntityState(state: entity_state_t): entity_state_t {
  const copy = createEntityState();
  copy.number = state.number;
  copy.origin[0] = state.origin[0];
  copy.origin[1] = state.origin[1];
  copy.origin[2] = state.origin[2];
  copy.angles[0] = state.angles[0];
  copy.angles[1] = state.angles[1];
  copy.angles[2] = state.angles[2];
  copy.old_origin[0] = state.old_origin[0];
  copy.old_origin[1] = state.old_origin[1];
  copy.old_origin[2] = state.old_origin[2];
  copy.modelindex = state.modelindex;
  copy.modelindex2 = state.modelindex2;
  copy.modelindex3 = state.modelindex3;
  copy.modelindex4 = state.modelindex4;
  copy.frame = state.frame;
  copy.skinnum = state.skinnum;
  copy.effects = state.effects;
  copy.renderfx = state.renderfx;
  copy.solid = state.solid;
  copy.sound = state.sound;
  copy.event = state.event;
  return copy;
}

/**
 * Original name: N/A
 * Source: N/A (client command reset helper)
 * Category: New
 * Purpose: Reset the last user command for a newly attached server client.
 */
function zeroClientCommand(client: client_t): void {
  client.lastcmd.msec = 0;
  client.lastcmd.buttons = 0;
  client.lastcmd.angles[0] = 0;
  client.lastcmd.angles[1] = 0;
  client.lastcmd.angles[2] = 0;
  client.lastcmd.forwardmove = 0;
  client.lastcmd.sidemove = 0;
  client.lastcmd.upmove = 0;
  client.lastcmd.impulse = 0;
  client.lastcmd.lightlevel = 0;
}

/**
 * Original name: N/A
 * Source: N/A (case-insensitive suffix helper)
 * Category: New
 * Purpose: Match Quake II map suffixes without depending on platform string casing.
 */
function endsWithInsensitive(text: string, suffix: string): boolean {
  return text.toLowerCase().endsWith(suffix.toLowerCase());
}

/**
 * Original name: N/A
 * Source: N/A (local printf formatter)
 * Category: New
 * Purpose: Format the small printf subset needed by server init error callbacks.
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
