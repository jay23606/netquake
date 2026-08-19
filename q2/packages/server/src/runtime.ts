/**
 * File: runtime.ts
 * Purpose: Assemble the currently ported server subsystems into one explicit runtime facade.
 *
 * This file is not a direct source port.
 * It is an integration layer that wires together the ported `sv_*.c` modules.
 *
 * Dependencies:
 * - packages/server/src/server.ts
 * - packages/server/src/sv_game.ts
 * - packages/server/src/sv_main.ts
 * - packages/server/src/sv_user.ts
 * - packages/server/src/sv_send.ts
 * - packages/server/src/sv_ents.ts
 * - packages/server/src/sv_world.ts
 */

import type { GetGameApi, game_export_t } from "../../game/src/index.js";
import type {
  CollisionModelRuntime,
  CollisionWorld,
  CommandRuntime,
  CvarRuntime,
  QcommonNetRuntime,
  cvar_t,
  netadr_t
} from "../../qcommon/src/index.js";
import type {
  ServerConsoleProcedures,
  ServerEntityProcedures,
  ServerGameProcedures,
  ServerInitProcedures,
  ServerMainProcedures,
  ServerSendProcedures,
  ServerUserProcedures,
  ServerWorldProcedures,
  server_static_t,
  server_t
} from "./server.js";
import { createServerEntityProcedures } from "./sv_ents.js";
import { createServerGameProcedures } from "./sv_game.js";
import { createServerInitProcedures } from "./sv_init.js";
import { createServerMainProcedures } from "./sv_main.js";
import { createServerConsoleProcedures } from "./sv_ccmds.js";
import { createServerSendProcedures } from "./sv_send.js";
import { createServerUserProcedures } from "./sv_user.js";
import { createServerWorldProcedures } from "./sv_world.js";

/**
 * Original name: N/A
 * Source: N/A (server runtime facade)
 * Category: New
 * Purpose: Describe the explicit dependencies required to assemble the currently ported server modules.
 *
 * Constraints:
 * - Keeps all global-style server state explicit and shared across the wired procedures.
 */
export interface ServerRuntimeFacadeContext {
  sv: server_t;
  svs: server_static_t;
  ge: game_export_t;
  collisionWorld: CollisionWorld;
  collisionModelRuntime?: CollisionModelRuntime;
  qnet: QcommonNetRuntime;
  cmd: CommandRuntime;
  cvar: CvarRuntime;
  maxclients: cvar_t | null;
  hostname: cvar_t | null;
  rcon_password: cvar_t | null;
  timeout: cvar_t | null;
  zombietime: cvar_t | null;
  sv_paused: cvar_t | null;
  sv_timedemo: cvar_t | null;
  sv_showclamp: cvar_t | null;
  sv_enforcetime: cvar_t | null;
  sv_noreload?: cvar_t | null;
  sv_airaccelerate?: cvar_t | null;
  allow_download?: cvar_t | null;
  allow_download_players?: cvar_t | null;
  allow_download_models?: cvar_t | null;
  allow_download_sounds?: cvar_t | null;
  allow_download_maps?: cvar_t | null;
  sv_reconnect_limit: cvar_t | null;
  dedicated: cvar_t | null;
  public_server: cvar_t | null;
  host_speeds?: cvar_t | null;
  master_adr: netadr_t[];
  onFreeDownload?: (download: Uint8Array) => void;
  onPrintf?: (message: string) => void;
  onDPrintf?: (message: string) => void;
  executeRconCommand?: (command: string) => string | void;
  challengeTimeMs?: () => number;
  randomInt?: () => number;
  nowMs?: () => number;
  setTimeBeforeGame?: (milliseconds: number) => void;
  setTimeAfterGame?: (milliseconds: number) => void;
  writeDemoMessage?: (demofile: unknown, payload: Uint8Array) => void;
  readDemoMessage?: (demofile: unknown) => Uint8Array | null;
  closeDemoFile?: (demofile: unknown) => void;
  openDemoFile?: (path: string) => unknown | null;
  loadDownloadFile?: (path: string) => { data: Uint8Array; fromPak?: boolean } | null;
  fileFromPak?: () => boolean;
  loadMapFile?: (name: string) => Uint8Array | undefined;
  SV_ReadLevelFile?: () => void;
  SV_Shutdown?: (finalmsg: string, reconnect: boolean) => void;
  CL_Drop?: () => void;
  SCR_BeginLoadingPlaque?: () => void;
  Cbuf_CopyToDefer?: () => void;
  FS_Gamedir?: () => string;
  savegameExists?: (path: string) => boolean;
  SV_WipeSavegame?: (savename: string) => void;
  SV_CopySaveGame?: (src: string, dst: string) => void;
  SV_WriteLevelFile?: () => void;
  SV_WriteServerFile?: (autosave: boolean) => void;
  SV_ReadServerFile?: () => void;
  readBinaryFile?: (path: string) => Uint8Array | null;
  writeBinaryFile?: (path: string, data: Uint8Array) => boolean;
  removeFile?: (path: string) => void;
  listFiles?: (pattern: string) => string[];
  createPath?: (path: string) => void;
  setServerState?: (state: number) => void;
  setPmAiraccelerate?: (value: number) => void;
  debugGraph?: (value: number, color: number) => void;
  getGameApi?: GetGameApi;
  SV_Error?: (error: string, ...args: unknown[]) => never;
}

/**
 * Original name: N/A
 * Source: N/A (server runtime facade)
 * Category: New
 * Purpose: Expose the composed server subsystem procedures plus a flattened facade view.
 *
 * Constraints:
 * - Preserves direct access to each source-file procedure table while also surfacing one combined facade.
 */
export interface ServerRuntimeFacade {
  console: ServerConsoleProcedures;
  world: ServerWorldProcedures;
  ents: ServerEntityProcedures;
  user: ServerUserProcedures;
  main: ServerMainProcedures;
  send: ServerSendProcedures;
  game: ServerGameProcedures;
  init: ServerInitProcedures;
  procedures: ServerConsoleProcedures &
    ServerWorldProcedures &
    ServerEntityProcedures &
    ServerUserProcedures &
    ServerMainProcedures &
    ServerSendProcedures &
    ServerGameProcedures &
    ServerInitProcedures;
}

/**
 * Original name: N/A
 * Source: N/A (server runtime facade)
 * Category: New
 * Purpose: Assemble the currently ported server procedure tables into one shared runtime facade.
 *
 * Constraints:
 * - Must share the same explicit state objects across all composed subsystems.
 * - Must wire cross-file callbacks so `sv_main`, `sv_user`, `sv_send` and `sv_ents` cooperate end-to-end.
 */
export function createServerRuntimeFacade(context: ServerRuntimeFacadeContext): ServerRuntimeFacade {
  const world = createServerWorldProcedures({
    sv: context.sv,
    ge: context.ge,
    collisionWorld: context.collisionWorld,
    ...(context.onPrintf ? { onPrintf: context.onPrintf } : {}),
    ...(context.onDPrintf ? { onDPrintf: context.onDPrintf } : {})
  });

  const ents = createServerEntityProcedures({
    sv: context.sv,
    svs: context.svs,
    ge: context.ge,
    collisionWorld: context.collisionWorld,
    maxclients: context.maxclients,
    ...(context.SV_Error ? { SV_Error: context.SV_Error } : {}),
    ...(context.writeDemoMessage ? { writeDemoMessage: context.writeDemoMessage } : {})
  });

  let nextserverRef: (() => void) | null = null;
  let user!: ServerUserProcedures;
  let send!: ServerSendProcedures;

  const main = createServerMainProcedures({
    sv: context.sv,
    svs: context.svs,
    ge: context.ge,
    cmd: context.cmd,
    cvar: context.cvar,
    qnet: context.qnet,
    maxclients: context.maxclients,
    hostname: context.hostname,
    rcon_password: context.rcon_password,
    timeout: context.timeout,
    zombietime: context.zombietime,
    sv_paused: context.sv_paused,
    sv_timedemo: context.sv_timedemo,
    sv_showclamp: context.sv_showclamp,
    sv_reconnect_limit: context.sv_reconnect_limit,
    dedicated: context.dedicated,
    public_server: context.public_server,
    master_adr: context.master_adr,
    SV_ExecuteClientMessage: (client) => user.SV_ExecuteClientMessage(client),
    SV_BroadcastPrintf: (level, fmt, ...args) => send.SV_BroadcastPrintf(level, fmt, ...args),
    SV_SendClientMessages: () => send.SV_SendClientMessages(),
    SV_RecordDemoMessage: () => ents.SV_RecordDemoMessage(),
    getServerInfo: () => context.hostname?.string ? `\\hostname\\${context.hostname.string}` : "",
    ...(context.host_speeds !== undefined ? { host_speeds: context.host_speeds } : {}),
    ...(context.onFreeDownload ? { onFreeDownload: context.onFreeDownload } : {}),
    ...(context.onPrintf ? { onPrintf: context.onPrintf } : {}),
    ...(context.onDPrintf ? { onDPrintf: context.onDPrintf } : {}),
    ...(context.executeRconCommand ? { executeRconCommand: context.executeRconCommand } : {}),
    ...(context.challengeTimeMs ? { challengeTimeMs: context.challengeTimeMs } : {}),
    ...(context.randomInt ? { randomInt: context.randomInt } : {}),
    ...(context.nowMs ? { nowMs: context.nowMs } : {}),
    ...(context.setTimeBeforeGame ? { setTimeBeforeGame: context.setTimeBeforeGame } : {}),
    ...(context.setTimeAfterGame ? { setTimeAfterGame: context.setTimeAfterGame } : {}),
    ...(context.closeDemoFile ? { closeDemoFile: context.closeDemoFile } : {}),
    ...(context.setServerState ? { setServerState: context.setServerState } : {}),
    SV_ShutdownGameProgs: () => game.SV_ShutdownGameProgs(),
    ...(context.SV_Error ? { SV_Error: context.SV_Error } : {})
  });

  user = createServerUserProcedures({
    sv: context.sv,
    svs: context.svs,
    ge: context.ge,
    cmd: context.cmd,
    cvar: context.cvar,
    qnet: context.qnet,
    sv_paused: context.sv_paused,
    sv_enforcetime: context.sv_enforcetime,
    allow_download: context.allow_download ?? null,
    allow_download_players: context.allow_download_players ?? null,
    allow_download_models: context.allow_download_models ?? null,
    allow_download_sounds: context.allow_download_sounds ?? null,
    allow_download_maps: context.allow_download_maps ?? null,
    SV_DropClient: main.SV_DropClient,
    SV_UserinfoChanged: main.SV_UserinfoChanged,
    ...(context.openDemoFile ? { openDemoFile: context.openDemoFile } : {}),
    ...(context.loadDownloadFile ? { loadDownloadFile: context.loadDownloadFile } : {}),
    ...(context.fileFromPak ? { file_from_pak: context.fileFromPak } : {}),
    ...(context.onFreeDownload ? { freeDownload: context.onFreeDownload } : {}),
    ...(context.onPrintf ? { onPrintf: context.onPrintf } : {}),
    ...(context.onDPrintf ? { onDPrintf: context.onDPrintf } : {})
  });

  send = createServerSendProcedures({
    sv: context.sv,
    svs: context.svs,
    ge: context.ge,
    collisionWorld: context.collisionWorld,
    qnet: context.qnet,
    maxclients: context.maxclients,
    dedicated: context.dedicated,
    sv_paused: context.sv_paused,
    sv_client: null,
    net_from: context.qnet.net_from,
    SV_BuildClientFrame: (client) => ents.SV_BuildClientFrame(client),
    SV_WriteFrameToClient: (client, msg) => ents.SV_WriteFrameToClient(client, msg),
    SV_DropClient: (client) => main.SV_DropClient(client),
    SV_Nextserver: () => {
      nextserverRef?.();
    },
    ...(context.SV_Error ? { SV_Error: context.SV_Error } : {}),
    ...(context.onPrintf ? { onPrintf: context.onPrintf } : {}),
    ...(context.nowMs ? { nowMs: context.nowMs } : {}),
    ...(context.readDemoMessage ? { readDemoMessage: context.readDemoMessage } : {}),
    ...(context.closeDemoFile ? { closeDemoFile: context.closeDemoFile } : {})
  });

  const game = createServerGameProcedures({
    sv: context.sv,
    svs: context.svs,
    ge: context.ge,
    cmd: context.cmd,
    cvar: context.cvar,
    collisionWorld: context.collisionModelRuntime?.world ?? context.collisionWorld,
    maxclients: context.maxclients,
    SV_Multicast: (origin, to) => send.SV_Multicast(origin, to),
    SV_ClientPrintf: (client, level, fmt, ...args) => send.SV_ClientPrintf(client, level, fmt, ...args),
    SV_BroadcastPrintf: (level, fmt, ...args) => send.SV_BroadcastPrintf(level, fmt, ...args),
    SV_StartSound: (origin, entity, channel, soundindex, volume, attenuation, timeofs) =>
      send.SV_StartSound(origin, entity, channel, soundindex, volume, attenuation, timeofs),
    SV_LinkEdict: (ent) => world.SV_LinkEdict(ent),
    SV_UnlinkEdict: (ent) => world.SV_UnlinkEdict(ent),
    SV_AreaEdicts: (mins, maxs, list, maxcount, areatype) => world.SV_AreaEdicts(mins, maxs, list, maxcount, areatype),
    SV_Trace: (start, mins, maxs, end, passedict, contentmask) => world.SV_Trace(start, mins, maxs, end, passedict, contentmask),
    SV_PointContents: (point) => world.SV_PointContents(point),
    SV_ModelIndex: (name) => init.SV_ModelIndex(name),
    SV_SoundIndex: (name) => init.SV_SoundIndex(name),
    SV_ImageIndex: (name) => init.SV_ImageIndex(name),
    ...(context.debugGraph ? { debugGraph: context.debugGraph } : {}),
    ...(context.getGameApi ? { getGameApi: context.getGameApi } : {}),
    ...(context.onPrintf ? { onPrintf: context.onPrintf } : {}),
    ...(context.onDPrintf ? { onDPrintf: context.onDPrintf } : {}),
    ...(context.SV_Error ? { SV_Error: context.SV_Error } : {})
  });

  const init = createServerInitProcedures({
    sv: context.sv,
    svs: context.svs,
    ge: context.ge,
    cmd: context.cmd,
    cvar: context.cvar,
    qnet: context.qnet,
    collisionModelRuntime: context.collisionModelRuntime ?? ({
      map_name: "",
      map_noareas: false,
      flushmap: false,
      last_checksum: 0,
      world: context.collisionWorld
    } as CollisionModelRuntime),
    maxclients: context.maxclients,
    dedicated: context.dedicated,
    sv_noreload: context.sv_noreload ?? null,
    sv_airaccelerate: context.sv_airaccelerate ?? null,
    master_adr: context.master_adr,
    SV_Multicast: (origin, to) => send.SV_Multicast(origin, to),
    SV_ClearWorld: () => world.SV_ClearWorld(),
    SV_BroadcastCommand: (fmt, ...args) => send.SV_BroadcastCommand(fmt, ...args),
    SV_SendClientMessages: () => send.SV_SendClientMessages(),
    ...(context.SV_ReadLevelFile ? { SV_ReadLevelFile: context.SV_ReadLevelFile } : {}),
    SV_InitGameProgs: () => game.SV_InitGameProgs(),
    ...(context.SV_Shutdown ? { SV_Shutdown: context.SV_Shutdown } : {}),
    ...(context.CL_Drop ? { CL_Drop: context.CL_Drop } : {}),
    ...(context.SCR_BeginLoadingPlaque ? { SCR_BeginLoadingPlaque: context.SCR_BeginLoadingPlaque } : {}),
    ...(context.Cbuf_CopyToDefer ? { Cbuf_CopyToDefer: context.Cbuf_CopyToDefer } : {}),
    ...(context.FS_Gamedir ? { FS_Gamedir: context.FS_Gamedir } : {}),
    ...(context.savegameExists ? { savegameExists: context.savegameExists } : {}),
    ...(context.closeDemoFile ? { closeDemoFile: context.closeDemoFile } : {}),
    ...(context.loadMapFile ? { loadMapFile: context.loadMapFile } : {}),
    ...(context.setServerState ? { setServerState: (state: number) => context.setServerState?.(state) } : {}),
    ...(context.setPmAiraccelerate ? { setPmAiraccelerate: context.setPmAiraccelerate } : {}),
    ...(context.randomInt ? { randomInt: context.randomInt } : {}),
    ...(context.onPrintf ? { onPrintf: context.onPrintf } : {}),
    ...(context.onDPrintf ? { onDPrintf: context.onDPrintf } : {}),
    ...(context.SV_Error ? { SV_Error: context.SV_Error } : {})
  });

  const console = createServerConsoleProcedures({
    sv: context.sv,
    svs: context.svs,
    ge: context.ge,
    collisionWorld: context.collisionWorld,
    cmd: context.cmd,
    cvar: context.cvar,
    qnet: context.qnet,
    maxclients: context.maxclients,
    dedicated: context.dedicated,
    master_adr: context.master_adr,
    SV_Map: (attractloop, levelstring, loadgame) => init.SV_Map(attractloop, levelstring, loadgame),
    SV_BroadcastPrintf: (level, fmt, ...args) => send.SV_BroadcastPrintf(level, fmt, ...args),
    SV_ClientPrintf: (client, level, fmt, ...args) => send.SV_ClientPrintf(client, level, fmt, ...args),
    SV_DropClient: (client) => main.SV_DropClient(client),
    ...(context.SV_Shutdown ? { SV_Shutdown: context.SV_Shutdown } : {}),
    ...(context.loadMapFile ? { loadMapFile: context.loadMapFile } : {}),
    ...(context.savegameExists ? { savegameExists: context.savegameExists } : {}),
    ...(context.SV_WipeSavegame ? { SV_WipeSavegame: context.SV_WipeSavegame } : {}),
    ...(context.SV_CopySaveGame ? { SV_CopySaveGame: context.SV_CopySaveGame } : {}),
    ...(context.SV_WriteLevelFile ? { SV_WriteLevelFile: context.SV_WriteLevelFile } : {}),
    ...(context.SV_WriteServerFile ? { SV_WriteServerFile: context.SV_WriteServerFile } : {}),
    ...(context.SV_ReadServerFile ? { SV_ReadServerFile: context.SV_ReadServerFile } : {}),
    SV_InitGame: () => init.SV_InitGame(),
    ...(context.FS_Gamedir ? { FS_Gamedir: context.FS_Gamedir } : {}),
    ...(context.readBinaryFile ? { readBinaryFile: context.readBinaryFile } : {}),
    ...(context.writeBinaryFile ? { writeBinaryFile: context.writeBinaryFile } : {}),
    ...(context.removeFile ? { removeFile: context.removeFile } : {}),
    ...(context.listFiles ? { listFiles: context.listFiles } : {}),
    ...(context.createPath ? { createPath: context.createPath } : {}),
    ...(context.openDemoFile ? { openDemoFile: context.openDemoFile } : {}),
    ...(context.closeDemoFile ? { closeDemoFile: context.closeDemoFile } : {}),
    ...(context.writeDemoMessage ? { writeDemoMessage: context.writeDemoMessage } : {}),
    ...(context.onPrintf ? { onPrintf: context.onPrintf } : {}),
    ...(context.onDPrintf ? { onDPrintf: context.onDPrintf } : {})
  });

  nextserverRef = () => user.SV_Nextserver();

  const procedures = {
    ...console,
    ...world,
    ...ents,
    ...user,
    ...main,
    ...send,
    ...game,
    ...init
  };

  return {
    console,
    world,
    ents,
    user,
    main,
    send,
    game,
    init,
    procedures
  };
}
