/**
 * File: sv_ccmds.ts
 * Source: Quake II original / server/sv_ccmds.c
 * Purpose: Port of operator-console server commands.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Savegame and server-demo file paths are wired through explicit callbacks instead of direct filesystem `fopen/fwrite/remove` calls.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

import type { edict_t, game_export_t } from "../../game/src/index.js";
import { SZ_Init, createSizeBuffer } from "../../memory/src/index.js";
import {
  CM_ReadPortalState,
  CM_WritePortalState,
  CVAR_LATCH,
  CS_NAME,
  Cmd_AddCommand,
  Cmd_Argc,
  Cmd_Args,
  Cmd_Argv,
  Cvar_ForceSet,
  Cvar_Serverinfo,
  Cvar_Set,
  Cvar_VariableString,
  Cvar_VariableValue,
  MAX_CONFIGSTRINGS,
  MAX_OSPATH,
  MAX_QPATH,
  MAX_TOKEN_CHARS,
  MSG_WriteByte,
  MSG_WriteLong,
  MSG_WriteShort,
  MSG_WriteString,
  Info_Print,
  NET_AdrToString,
  NET_Config,
  NET_StringToAdr,
  Netchan_OutOfBandPrint,
  PORT_MASTER,
  PRINT_CHAT,
  PRINT_HIGH,
  PROTOCOL_VERSION,
  STAT_FRAGS,
  STAT_HEALTH,
  netsrc_t,
  svc_ops_e,
  type CommandRuntime,
  type CollisionWorld,
  type CvarRuntime,
  type QcommonNetRuntime,
  type cvar_t,
  type netadr_t
} from "../../qcommon/src/index.js";
import {
  MAX_MASTERS,
  client_state_t,
  server_state_t,
  type ServerConsoleProcedures,
  type client_t,
  type server_static_t,
  type server_t
} from "./server.js";

/**
 * Original name: N/A
 * Source: N/A (server console context)
 * Category: New
 * Purpose: Hold the explicit runtime dependencies required by the `sv_ccmds.c` partial port.
 *
 * Constraints:
 * - Must provide explicit server state, command runtime and operator-facing callbacks.
 */
export interface ServerConsoleContext {
  sv: server_t;
  svs: server_static_t;
  ge: game_export_t | null;
  collisionWorld?: CollisionWorld;
  cmd: CommandRuntime;
  cvar: CvarRuntime;
  qnet: QcommonNetRuntime;
  maxclients: cvar_t | null;
  dedicated: cvar_t | null;
  master_adr: netadr_t[];
  SV_Map?: (attractloop: boolean, levelstring: string, loadgame: boolean) => void;
  SV_BroadcastPrintf?: (level: number, fmt: string, ...args: unknown[]) => void;
  SV_ClientPrintf?: (client: client_t, level: number, fmt: string, ...args: unknown[]) => void;
  SV_DropClient?: (client: client_t) => void;
  SV_Shutdown?: (finalmsg: string, reconnect: boolean) => void;
  loadMapFile?: (name: string) => Uint8Array | undefined;
  savegameExists?: (path: string) => boolean;
  SV_WipeSavegame?: (savename: string) => void;
  SV_CopySaveGame?: (src: string, dst: string) => void;
  SV_WriteLevelFile?: () => void;
  SV_ReadLevelFile?: () => void;
  SV_WriteServerFile?: (autosave: boolean) => void;
  SV_ReadServerFile?: () => void;
  SV_InitGame?: () => void;
  FS_Gamedir?: () => string;
  createPath?: (path: string) => void;
  readBinaryFile?: (path: string) => Uint8Array | null;
  writeBinaryFile?: (path: string, data: Uint8Array) => boolean;
  removeFile?: (path: string) => void;
  listFiles?: (pattern: string) => string[];
  openDemoFile?: (path: string) => unknown | null;
  closeDemoFile?: (demofile: unknown) => void;
  writeDemoMessage?: (demofile: unknown, payload: Uint8Array) => void;
  onPrintf?: (message: string) => void;
  onDPrintf?: (message: string) => void;
}

/**
 * Original name: N/A
 * Source: N/A (server console factory)
 * Category: New
 * Purpose: Build the `sv_ccmds.c` procedure table bound to one explicit console-command context.
 *
 * Constraints:
 * - Must preserve call order and side effects from the original C implementation for the implemented subset.
 */
export function createServerConsoleProcedures(context: ServerConsoleContext): ServerConsoleProcedures {
  let sv_client: client_t | null = null;
  let sv_player: edict_t | null = null;

  function getGamedir(): string {
    return context.FS_Gamedir?.() ?? "baseq2";
  }

  function buildSavePath(save: string, file: string): string {
    return `${getGamedir()}/save/${save}/${file}`;
  }

  function basename(path: string): string {
    const normalized = path.replace(/\\/g, "/");
    const index = normalized.lastIndexOf("/");
    return index >= 0 ? normalized.slice(index + 1) : normalized;
  }

  function concatBytes(chunks: Uint8Array[]): Uint8Array {
    let total = 0;
    for (const chunk of chunks) {
      total += chunk.length;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  function writeFixedString(target: Uint8Array, offset: number, max: number, value: string): void {
    const length = Math.min(value.length, max - 1);
    for (let i = 0; i < length; i += 1) {
      target[offset + i] = value.charCodeAt(i) & 0xff;
    }
  }

  function readFixedString(source: Uint8Array, offset: number, max: number): string {
    let out = "";
    for (let i = 0; i < max; i += 1) {
      const c = source[offset + i] ?? 0;
      if (c === 0) {
        break;
      }
      out += String.fromCharCode(c);
    }
    return out;
  }

  function encodeConfigStrings(configstrings: string[]): Uint8Array {
    const bytes = new Uint8Array(MAX_CONFIGSTRINGS * MAX_QPATH);
    for (let i = 0; i < MAX_CONFIGSTRINGS; i += 1) {
      writeFixedString(bytes, i * MAX_QPATH, MAX_QPATH, configstrings[i] ?? "");
    }
    return bytes;
  }

  function decodeConfigStrings(payload: Uint8Array): void {
    const expected = MAX_CONFIGSTRINGS * MAX_QPATH;
    if (payload.length < expected) {
      return;
    }

    for (let i = 0; i < MAX_CONFIGSTRINGS; i += 1) {
      context.sv.configstrings[i] = readFixedString(payload, i * MAX_QPATH, MAX_QPATH);
    }
  }

  /**
   * Original name: CopyFile
   * Source: server/sv_ccmds.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Copies one savegame/server-demo support file when the source exists.
   *
   * Porting notes:
   * - Uses explicit binary I/O callbacks instead of direct `FILE *` handles.
   */
  function CopyFile(src: string, dst: string): void {
    const bytes = context.readBinaryFile?.(src) ?? null;
    if (!bytes) {
      return;
    }
    context.createPath?.(dst);
    context.writeBinaryFile?.(dst, bytes);
  }

  /**
   * Original name: SV_SetPlayer
   * Source: server/sv_ccmds.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Resolves a client slot from `Cmd_Argv(1)` by slot index or player name.
   */
  function SV_SetPlayer(): boolean {
    if (Cmd_Argc(context.cmd) < 2) {
      return false;
    }

    const s = Cmd_Argv(context.cmd, 1);
    if (s.length === 0) {
      return false;
    }

    if (s[0] >= "0" && s[0] <= "9") {
      const idnum = Number.parseInt(s, 10) || 0;
      const maxClients = Math.trunc(context.maxclients?.value ?? 0);
      if (idnum < 0 || idnum >= maxClients) {
        context.onPrintf?.(`Bad client slot: ${idnum}\n`);
        return false;
      }

      sv_client = context.svs.clients[idnum] ?? null;
      sv_player = sv_client?.edict ?? null;
      if (!sv_client || sv_client.state === client_state_t.cs_free) {
        context.onPrintf?.(`Client ${idnum} is not active\n`);
        return false;
      }

      return true;
    }

    const maxClients = Math.trunc(context.maxclients?.value ?? 0);
    for (let i = 0; i < maxClients; i += 1) {
      const cl = context.svs.clients[i];
      if (!cl || cl.state === client_state_t.cs_free) {
        continue;
      }

      if (cl.name === s) {
        sv_client = cl;
        sv_player = cl.edict ?? null;
        return true;
      }
    }

    context.onPrintf?.(`Userid ${s} is not on the server\n`);
    return false;
  }

  /**
   * Original name: SV_SetMaster_f
   * Source: server/sv_ccmds.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Sets master-server addresses, pings them and forces the `public` cvar.
   */
  function SV_SetMaster_f(): void {
    if ((context.dedicated?.value ?? 0) === 0) {
      context.onPrintf?.("Only dedicated servers use masters.\n");
      return;
    }

    Cvar_Set(context.cvar, "public", "1");

    for (let i = 1; i < MAX_MASTERS; i += 1) {
      const adr = context.master_adr[i];
      if (!adr) {
        continue;
      }
      adr.type = 0;
      adr.port = 0;
      adr.ip.fill(0);
      adr.ipx.fill(0);
    }

    let slot = 1;
    for (let i = 1; i < Cmd_Argc(context.cmd); i += 1) {
      if (slot === MAX_MASTERS) {
        break;
      }

      const value = Cmd_Argv(context.cmd, i);
      const adr = context.master_adr[slot];
      if (!adr || !NET_StringToAdr(value, adr)) {
        context.onPrintf?.(`Bad address: ${value}\n`);
        continue;
      }

      if (adr.port === 0) {
        adr.port = PORT_MASTER;
      }

      context.onPrintf?.(`Master server at ${NET_AdrToString(adr)}\n`);
      context.onPrintf?.("Sending a ping.\n");
      Netchan_OutOfBandPrint(context.qnet, netsrc_t.NS_SERVER, adr, "ping");
      slot += 1;
    }

    context.svs.last_heartbeat = -9999999;
  }

  function SV_NotPortedCommand_f(name: string): void {
    context.onPrintf?.(`${name} is not ported yet in sv_ccmds.ts\n`);
  }

  /**
   * Original name: SV_WipeSavegame
   * Source: server/sv_ccmds.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Deletes the fixed savegame files and per-level `.sav`/`.sv2` files for one save slot.
   *
   * Porting notes:
   * - Directory scanning/removal is delegated to callbacks so browser and test hosts can provide storage.
   */
  function SV_WipeSavegame(savename: string): void {
    if (context.SV_WipeSavegame) {
      context.SV_WipeSavegame(savename);
      return;
    }

    context.removeFile?.(buildSavePath(savename, "server.ssv"));
    context.removeFile?.(buildSavePath(savename, "game.ssv"));

    for (const found of context.listFiles?.(buildSavePath(savename, "*.sav")) ?? []) {
      context.removeFile?.(found);
    }
    for (const found of context.listFiles?.(buildSavePath(savename, "*.sv2")) ?? []) {
      context.removeFile?.(found);
    }
  }

  /**
   * Original name: SV_CopySaveGame
   * Source: server/sv_ccmds.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Replaces the destination save slot and copies server/game plus per-map save files.
   *
   * Porting notes:
   * - Preserves the original `.sav` to `.sv2` paired-copy behavior through callback-backed paths.
   */
  function SV_CopySaveGame(src: string, dst: string): void {
    if (context.SV_CopySaveGame) {
      context.SV_CopySaveGame(src, dst);
      return;
    }

    SV_WipeSavegame(dst);

    CopyFile(buildSavePath(src, "server.ssv"), buildSavePath(dst, "server.ssv"));
    CopyFile(buildSavePath(src, "game.ssv"), buildSavePath(dst, "game.ssv"));

    for (const found of context.listFiles?.(buildSavePath(src, "*.sav")) ?? []) {
      const file = basename(found);
      CopyFile(found, buildSavePath(dst, file));

      if (file.toLowerCase().endsWith(".sav")) {
        const sv2 = `${file.slice(0, -4)}.sv2`;
        CopyFile(buildSavePath(src, sv2), buildSavePath(dst, sv2));
      }
    }
  }

  /**
   * Original name: SV_WriteLevelFile
   * Source: server/sv_ccmds.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Archives configstrings, portal state and game level state for the current map.
   *
   * Porting notes:
   * - Serializes fixed-size configstring blocks explicitly and delegates game save I/O to `ge`.
   */
  function SV_WriteLevelFile(): void {
    if (context.SV_WriteLevelFile) {
      context.SV_WriteLevelFile();
      return;
    }

    const path = buildSavePath("current", `${context.sv.name}.sv2`);
    context.onDPrintf?.("SV_WriteLevelFile()\n");

    const chunks: Uint8Array[] = [encodeConfigStrings(context.sv.configstrings)];
    if (context.collisionWorld) {
      chunks.push(CM_WritePortalState(context.collisionWorld));
    }

    context.createPath?.(path);
    if (context.writeBinaryFile?.(path, concatBytes(chunks)) !== true) {
      context.onPrintf?.(`Failed to open ${path}\n`);
      return;
    }

    context.ge?.WriteLevel(buildSavePath("current", `${context.sv.name}.sav`));
  }

  /**
   * Original name: SV_WriteServerFile
   * Source: server/sv_ccmds.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Writes the save comment, map command and latched cvars before delegating game state save.
   *
   * Porting notes:
   * - Uses callback-backed binary output and JavaScript time formatting for the human-readable comment.
   */
  function SV_WriteServerFile(autosave: boolean): void {
    if (context.SV_WriteServerFile) {
      context.SV_WriteServerFile(autosave);
      return;
    }

    context.onDPrintf?.(`SV_WriteServerFile(${autosave ? "true" : "false"})\n`);
    const path = buildSavePath("current", "server.ssv");

    const comment = new Uint8Array(32);
    if (autosave) {
      writeFixedString(comment, 0, comment.length, `ENTERING ${context.sv.configstrings[CS_NAME] ?? ""}`);
    } else {
      const now = new Date();
      const stamp = `${`${now.getHours()}`.padStart(2, " ")}:${Math.floor(now.getMinutes() / 10)}${now.getMinutes() % 10} ${now.getMonth() + 1}/${now.getDate()}  `;
      writeFixedString(comment, 0, comment.length, `${stamp}${context.sv.configstrings[CS_NAME] ?? ""}`);
    }

    const mapcmd = new Uint8Array(MAX_TOKEN_CHARS);
    writeFixedString(mapcmd, 0, mapcmd.length, context.svs.mapcmd ?? "");

    const cvarChunks: Uint8Array[] = [];
    for (const variable of context.cvar.cvar_vars) {
      if ((variable.flags & CVAR_LATCH) === 0) {
        continue;
      }

      if (variable.name.length >= MAX_OSPATH - 1 || variable.string.length >= 128 - 1) {
        context.onPrintf?.(`Cvar too long: ${variable.name} = ${variable.string}\n`);
        continue;
      }

      const nameChunk = new Uint8Array(MAX_OSPATH);
      const stringChunk = new Uint8Array(128);
      writeFixedString(nameChunk, 0, nameChunk.length, variable.name);
      writeFixedString(stringChunk, 0, stringChunk.length, variable.string);
      cvarChunks.push(nameChunk, stringChunk);
    }

    context.createPath?.(path);
    if (context.writeBinaryFile?.(path, concatBytes([comment, mapcmd, ...cvarChunks])) !== true) {
      context.onPrintf?.(`Couldn't write ${path}\n`);
      return;
    }

    context.ge?.WriteGame(buildSavePath("current", "game.ssv"), autosave);
  }

  /**
   * Original name: SV_ReadServerFile
   * Source: server/sv_ccmds.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Restores the saved map command and latched cvars, starts a fresh game, then reads game state.
   */
  function SV_ReadServerFile(): void {
    if (context.SV_ReadServerFile) {
      context.SV_ReadServerFile();
      return;
    }

    context.onDPrintf?.("SV_ReadServerFile()\n");

    const path = buildSavePath("current", "server.ssv");
    const bytes = context.readBinaryFile?.(path) ?? null;
    if (!bytes) {
      context.onPrintf?.(`Couldn't read ${path}\n`);
      return;
    }

    const baseSize = 32 + MAX_TOKEN_CHARS;
    if (bytes.length < baseSize) {
      context.onPrintf?.(`Couldn't read ${path}\n`);
      return;
    }

    const mapcmd = readFixedString(bytes, 32, MAX_TOKEN_CHARS);

    const cvarEntrySize = MAX_OSPATH + 128;
    for (let offset = baseSize; offset + cvarEntrySize <= bytes.length; offset += cvarEntrySize) {
      const name = readFixedString(bytes, offset, MAX_OSPATH);
      const value = readFixedString(bytes, offset + MAX_OSPATH, 128);
      if (!name.length) {
        continue;
      }
      context.onDPrintf?.(`Set ${name} = ${value}\n`);
      Cvar_ForceSet(context.cvar, name, value);
    }

    context.SV_InitGame?.();
    context.svs.mapcmd = mapcmd;
    context.ge?.ReadGame(buildSavePath("current", "game.ssv"));
  }

  /**
   * Original name: SV_DemoMap_f
   * Source: server/sv_ccmds.c
   * Category: Ported
   * Fidelity level: Strict
   */
  function SV_DemoMap_f(): void {
    context.SV_Map?.(true, Cmd_Argv(context.cmd, 1), false);
  }

  /**
   * Original name: SV_GameMap_f
   * Source: server/sv_ccmds.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Saves transitional state and switches to the next map/unit target.
   */
  function SV_GameMap_f(): void {
    if (Cmd_Argc(context.cmd) !== 2) {
      context.onPrintf?.("USAGE: gamemap <map>\n");
      return;
    }

    const map = Cmd_Argv(context.cmd, 1);
    context.onDPrintf?.(`SV_GameMap(${map})\n`);
    context.createPath?.(buildSavePath("current", ""));

    if (map.startsWith("*")) {
      SV_WipeSavegame("current");
    } else if (context.sv.state === server_state_t.ss_game) {
      const maxClients = Math.trunc(context.maxclients?.value ?? 0);
      const savedInuse = new Array<boolean>(maxClients);
      for (let i = 0; i < maxClients; i += 1) {
        const cl = context.svs.clients[i];
        const edict = cl?.edict;
        savedInuse[i] = edict?.inuse ?? false;
        if (edict) {
          edict.inuse = false;
        }
      }

      SV_WriteLevelFile();

      for (let i = 0; i < maxClients; i += 1) {
        const edict = context.svs.clients[i]?.edict;
        if (edict) {
          edict.inuse = savedInuse[i] ?? false;
        }
      }
    }

    context.SV_Map?.(false, map, false);
    context.svs.mapcmd = map;

    if ((context.dedicated?.value ?? 0) === 0) {
      SV_WriteServerFile(true);
      SV_CopySaveGame("current", "save0");
    }
  }

  /**
   * Original name: SV_Map_f
   * Source: server/sv_ccmds.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Performs a development-focused direct map switch.
   */
  function SV_Map_f(): void {
    const map = Cmd_Argv(context.cmd, 1);
    if (!map.includes(".")) {
      const expanded = `maps/${map}.bsp`;
      if (context.loadMapFile && context.loadMapFile(expanded) === undefined) {
        context.onPrintf?.(`Can't find ${expanded}\n`);
        return;
      }
    }

    context.sv.state = server_state_t.ss_dead;
    SV_WipeSavegame("current");
    SV_GameMap_f();
  }

  /**
   * Original name: SV_Loadgame_f
   * Source: server/sv_ccmds.c
   * Category: Ported
   * Fidelity level: Close
   */
  function SV_Loadgame_f(): void {
    if (Cmd_Argc(context.cmd) !== 2) {
      context.onPrintf?.("USAGE: loadgame <directory>\n");
      return;
    }

    context.onPrintf?.("Loading game...\n");
    const dir = Cmd_Argv(context.cmd, 1);
    if (dir.includes("..") || dir.includes("/") || dir.includes("\\")) {
      context.onPrintf?.("Bad savedir.\n");
    }

    const savePath = buildSavePath(dir, "server.ssv");
    if (context.savegameExists && !context.savegameExists(savePath)) {
      context.onPrintf?.(`No such savegame: ${savePath}\n`);
      return;
    }

    SV_CopySaveGame(dir, "current");
    SV_ReadServerFile();

    context.sv.state = server_state_t.ss_dead;
    context.SV_Map?.(false, context.svs.mapcmd, true);
  }

  /**
   * Original name: SV_Savegame_f
   * Source: server/sv_ccmds.c
   * Category: Ported
   * Fidelity level: Close
   */
  function SV_Savegame_f(): void {
    if (context.sv.state !== server_state_t.ss_game) {
      context.onPrintf?.("You must be in a game to save.\n");
      return;
    }

    if (Cmd_Argc(context.cmd) !== 2) {
      context.onPrintf?.("USAGE: savegame <directory>\n");
      return;
    }

    if (Cvar_VariableValue(context.cvar, "deathmatch") !== 0) {
      context.onPrintf?.("Can't savegame in a deathmatch\n");
      return;
    }

    const dir = Cmd_Argv(context.cmd, 1);
    if (dir === "current") {
      context.onPrintf?.("Can't save to 'current'\n");
      return;
    }

    if (
      Math.trunc(context.maxclients?.value ?? 0) === 1 &&
      (context.svs.clients[0]?.edict?.client?.ps.stats[STAT_HEALTH] ?? 1) <= 0
    ) {
      context.onPrintf?.("\nCan't savegame while dead!\n");
      return;
    }

    if (dir.includes("..") || dir.includes("/") || dir.includes("\\")) {
      context.onPrintf?.("Bad savedir.\n");
    }

    context.onPrintf?.("Saving game...\n");
    SV_WriteLevelFile();
    SV_WriteServerFile(false);
    SV_CopySaveGame("current", dir);
    context.onPrintf?.("Done.\n");
  }

  /**
   * Original name: SV_Kick_f
   * Source: server/sv_ccmds.c
   * Category: Ported
   * Fidelity level: Strict
   *
   * Behavior:
   * - Drops one selected client from the server.
   */
  function SV_Kick_f(): void {
    if (!context.svs.initialized) {
      context.onPrintf?.("No server running.\n");
      return;
    }

    if (Cmd_Argc(context.cmd) !== 2) {
      context.onPrintf?.("Usage: kick <userid>\n");
      return;
    }

    if (!SV_SetPlayer()) {
      return;
    }

    if (!sv_client) {
      return;
    }

    context.SV_BroadcastPrintf?.(PRINT_HIGH, "%s was kicked\n", sv_client.name);
    context.SV_ClientPrintf?.(sv_client, PRINT_HIGH, "You were kicked from the game\n");
    context.SV_DropClient?.(sv_client);
    sv_client.lastmessage = context.svs.realtime;
  }

  /**
   * Original name: SV_Status_f
   * Source: server/sv_ccmds.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Prints one operator-oriented client status table.
   */
  function SV_Status_f(): void {
    if (!context.svs.clients) {
      context.onPrintf?.("No server running.\n");
      return;
    }

    context.onPrintf?.(`map              : ${context.sv.name}\n`);
    context.onPrintf?.("num score ping name            lastmsg address               qport \n");
    context.onPrintf?.("--- ----- ---- --------------- ------- --------------------- ------\n");

    const maxClients = Math.trunc(context.maxclients?.value ?? 0);
    for (let i = 0; i < maxClients; i += 1) {
      const cl = context.svs.clients[i];
      if (!cl || cl.state === client_state_t.cs_free) {
        continue;
      }

      const score = cl.edict?.client?.ps.stats[STAT_FRAGS] ?? 0;
      let ping = "";
      if (cl.state === client_state_t.cs_connected) {
        ping = "CNCT";
      } else if (cl.state === client_state_t.cs_zombie) {
        ping = "ZMBI";
      } else {
        ping = `${Math.min(cl.ping, 9999)}`.padStart(4, " ");
      }

      const name = cl.name.slice(0, 15).padEnd(15, " ");
      const lastmsg = `${context.svs.realtime - cl.lastmessage}`.padStart(7, " ");
      const address = NET_AdrToString(cl.netchan.remote_address).slice(0, 21).padEnd(21, " ");
      const qport = `${cl.netchan.qport}`.padStart(5, " ");
      const line = `${`${i}`.padStart(3, " ")} ${`${score}`.padStart(5, " ")} ${ping} ${name} ${lastmsg} ${address} ${qport}\n`;
      context.onPrintf?.(line);
    }

    context.onPrintf?.("\n");
  }

  /**
   * Original name: SV_ConSay_f
   * Source: server/sv_ccmds.c
   * Category: Ported
   * Fidelity level: Strict
   *
   * Behavior:
   * - Broadcasts one operator console chat message to all spawned clients.
   */
  function SV_ConSay_f(): void {
    if (Cmd_Argc(context.cmd) < 2) {
      return;
    }

    let p = Cmd_Args(context.cmd);
    if (p.startsWith("\"") && p.endsWith("\"") && p.length >= 2) {
      p = p.slice(1, -1);
    }

    const text = `console: ${p}`;
    const maxClients = Math.trunc(context.maxclients?.value ?? 0);
    for (let i = 0; i < maxClients; i += 1) {
      const client = context.svs.clients[i];
      if (!client || client.state !== client_state_t.cs_spawned) {
        continue;
      }
      context.SV_ClientPrintf?.(client, PRINT_CHAT, "%s\n", text);
    }
  }

  /**
   * Original name: SV_Heartbeat_f
   * Source: server/sv_ccmds.c
   * Category: Ported
   * Fidelity level: Strict
   */
  function SV_Heartbeat_f(): void {
    context.svs.last_heartbeat = -9999999;
  }

  /**
   * Original name: SV_Serverinfo_f
   * Source: server/sv_ccmds.c
   * Category: Ported
   * Fidelity level: Strict
   */
  function SV_Serverinfo_f(): void {
    context.onPrintf?.("Server info settings:\n");
    const lines = Info_Print(Cvar_Serverinfo(context.cvar));
    for (const line of lines) {
      context.onPrintf?.(`${line}\n`);
    }
  }

  /**
   * Original name: SV_DumpUser_f
   * Source: server/sv_ccmds.c
   * Category: Ported
   * Fidelity level: Strict
   */
  function SV_DumpUser_f(): void {
    if (Cmd_Argc(context.cmd) !== 2) {
      context.onPrintf?.("Usage: info <userid>\n");
      return;
    }

    if (!SV_SetPlayer() || !sv_client) {
      return;
    }

    context.onPrintf?.("userinfo\n");
    context.onPrintf?.("--------\n");
    const lines = Info_Print(sv_client.userinfo);
    for (const line of lines) {
      context.onPrintf?.(`${line}\n`);
    }
  }

  /**
   * Original name: SV_KillServer_f
   * Source: server/sv_ccmds.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Stops the running server and closes network sockets.
   */
  function SV_KillServer_f(): void {
    if (!context.svs.initialized) {
      return;
    }

    context.SV_Shutdown?.("Server was killed.\n", false);
    NET_Config(context.qnet, false);
  }

  /**
   * Original name: SV_ServerCommand_f
   * Source: server/sv_ccmds.c
   * Category: Ported
   * Fidelity level: Strict
   */
  function SV_ServerCommand_f(): void {
    if (!context.ge) {
      context.onPrintf?.("No game loaded.\n");
      return;
    }

    context.ge.ServerCommand();
  }

  /**
   * Original name: SV_ServerRecord_f
   * Source: server/sv_ccmds.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Starts one server demo recording and emits the startup signon packet.
   */
  function SV_ServerRecord_f(): void {
    if (Cmd_Argc(context.cmd) !== 2) {
      context.onPrintf?.("serverrecord <demoname>\n");
      return;
    }

    if (context.svs.demofile) {
      context.onPrintf?.("Already recording.\n");
      return;
    }

    if (context.sv.state !== server_state_t.ss_game) {
      context.onPrintf?.("You must be in a level to record.\n");
      return;
    }

    const name = `demos/${Cmd_Argv(context.cmd, 1)}.dm2`;
    context.onPrintf?.(`recording to ${name}.\n`);
    context.createPath?.(name);

    const demofile = context.openDemoFile?.(name) ?? null;
    if (!demofile) {
      context.onPrintf?.("ERROR: couldn't open.\n");
      return;
    }

    context.svs.demofile = demofile;
    SZ_Init(context.svs.demo_multicast, context.svs.demo_multicast_buf);

    const buf = createSizeBuffer(32768);
    MSG_WriteByte(buf, svc_ops_e.svc_serverdata);
    MSG_WriteLong(buf, PROTOCOL_VERSION);
    MSG_WriteLong(buf, context.svs.spawncount);
    MSG_WriteByte(buf, 2);
    MSG_WriteString(buf, Cvar_VariableString(context.cvar, "gamedir"));
    MSG_WriteShort(buf, -1);
    MSG_WriteString(buf, context.sv.configstrings[CS_NAME] ?? "");

    for (let i = 0; i < MAX_CONFIGSTRINGS; i += 1) {
      const config = context.sv.configstrings[i] ?? "";
      if (config.length === 0) {
        continue;
      }

      MSG_WriteByte(buf, svc_ops_e.svc_configstring);
      MSG_WriteShort(buf, i);
      MSG_WriteString(buf, config);
    }

    context.onDPrintf?.(`signon message length: ${buf.cursize}\n`);

    if (!context.writeDemoMessage) {
      context.onPrintf?.("SV_ServerRecord_f: writeDemoMessage callback is missing\n");
      context.closeDemoFile?.(demofile);
      context.svs.demofile = null;
      return;
    }

    const payload = new Uint8Array(4 + buf.cursize);
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    view.setInt32(0, buf.cursize, true);
    payload.set(buf.data.subarray(0, buf.cursize), 4);
    context.writeDemoMessage(demofile, payload);
  }

  /**
   * Original name: SV_ServerStop_f
   * Source: server/sv_ccmds.c
   * Category: Ported
   * Fidelity level: Strict
   */
  function SV_ServerStop_f(): void {
    if (!context.svs.demofile) {
      context.onPrintf?.("Not doing a serverrecord.\n");
      return;
    }

    context.closeDemoFile?.(context.svs.demofile);
    context.svs.demofile = null;
    context.onPrintf?.("Recording completed.\n");
  }

  /**
   * Original name: SV_ReadLevelFile
   * Source: server/sv_ccmds.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Restores configstrings, portal state and game level state for the current map.
   */
  function SV_ReadLevelFile(): void {
    if (context.SV_ReadLevelFile) {
      context.SV_ReadLevelFile();
      return;
    }
    context.onDPrintf?.("SV_ReadLevelFile()\n");

    const path = buildSavePath("current", `${context.sv.name}.sv2`);
    const bytes = context.readBinaryFile?.(path) ?? null;
    if (!bytes) {
      context.onPrintf?.(`Failed to open ${path}\n`);
      return;
    }

    const configSize = MAX_CONFIGSTRINGS * MAX_QPATH;
    decodeConfigStrings(bytes.subarray(0, configSize));

    if (context.collisionWorld && bytes.length > configSize) {
      const portal = bytes.subarray(configSize);
      if (portal.length > 0) {
        CM_ReadPortalState(context.collisionWorld, portal);
      }
    }

    context.ge?.ReadLevel(buildSavePath("current", `${context.sv.name}.sav`));
  }

  /**
   * Original name: SV_InitOperatorCommands
   * Source: server/sv_ccmds.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Registers operator-console commands in the command system.
   */
  function SV_InitOperatorCommands(): void {
    Cmd_AddCommand(context.cmd, "heartbeat", SV_Heartbeat_f);
    Cmd_AddCommand(context.cmd, "kick", SV_Kick_f);
    Cmd_AddCommand(context.cmd, "status", SV_Status_f);
    Cmd_AddCommand(context.cmd, "serverinfo", SV_Serverinfo_f);
    Cmd_AddCommand(context.cmd, "dumpuser", SV_DumpUser_f);

    Cmd_AddCommand(context.cmd, "map", SV_Map_f);
    Cmd_AddCommand(context.cmd, "demomap", SV_DemoMap_f);
    Cmd_AddCommand(context.cmd, "gamemap", SV_GameMap_f);
    Cmd_AddCommand(context.cmd, "setmaster", SV_SetMaster_f);

    if ((context.dedicated?.value ?? 0) !== 0) {
      Cmd_AddCommand(context.cmd, "say", SV_ConSay_f);
    }

    Cmd_AddCommand(context.cmd, "serverrecord", SV_ServerRecord_f);
    Cmd_AddCommand(context.cmd, "serverstop", SV_ServerStop_f);
    Cmd_AddCommand(context.cmd, "save", SV_Savegame_f);
    Cmd_AddCommand(context.cmd, "load", SV_Loadgame_f);
    Cmd_AddCommand(context.cmd, "killserver", SV_KillServer_f);
    Cmd_AddCommand(context.cmd, "sv", SV_ServerCommand_f);
  }

  return {
    SV_ReadLevelFile,
    SV_Status_f,
    SV_InitOperatorCommands
  };
}
