/**
 * File: sv_user.ts
 * Source: Quake II original / server/sv_user.c
 * Purpose: Port of server-side client bootstrap, user string command dispatch and usercmd message execution.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses an explicit context object instead of file-static globals.
 * - Demo/file-system access is routed through optional callbacks.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

import { SZ_Write } from "../../memory/src/index.js";
import type { edict_t, game_export_t } from "../../game/src/index.js";
import {
  Cbuf_AddText,
  Cbuf_InsertFromDefer,
  COM_BlockSequenceCRCByte,
  CS_NAME,
  Cmd_Argc,
  Cmd_Argv,
  Cmd_TokenizeString,
  Cvar_Serverinfo,
  Cvar_Set,
  Cvar_VariableString,
  Cvar_VariableValue,
  Info_Print,
  MAX_CONFIGSTRINGS,
  MAX_EDICTS,
  MAX_INFO_STRING,
  MAX_MSGLEN,
  MAX_OSPATH,
  MSG_ReadByte,
  MSG_ReadDeltaUsercmd,
  MSG_ReadLong,
  MSG_ReadString,
  MSG_WriteByte,
  MSG_WriteDeltaEntity,
  MSG_WriteLong,
  MSG_WriteShort,
  MSG_WriteString,
  PROTOCOL_VERSION,
  UPDATE_MASK,
  clc_ops_e,
  svc_ops_e,
  type CommandRuntime,
  type CvarRuntime,
  type QcommonNetRuntime
} from "../../qcommon/src/index.js";
import { createEntityState, type usercmd_t } from "../../qcommon/src/index.js";
import {
  EDICT_NUM,
  LATENCY_COUNTS,
  client_state_t,
  server_state_t,
  type ServerUserProcedures,
  type client_t,
  type server_static_t,
  type server_t
} from "./server.js";

/**
 * Original name: N/A
 * Source: N/A (local download chunk constant)
 * Category: New
 * Purpose: Name the 1024-byte transfer chunk used by `SV_NextDownload_f`.
 */
const DOWNLOAD_CHUNK_SIZE = 1024;

/**
 * Original name: MAX_STRINGCMDS
 * Source: server/sv_user.c
 * Category: Ported
 * Fidelity level: Strict
 */
const MAX_STRINGCMDS = 8;

type ucmd_t = {
  name: string | null;
  func: (() => void) | null;
};

/**
 * Original name: N/A
 * Source: N/A (server user dependency context)
 * Category: New
 * Purpose: Hold the explicit runtime dependencies required by the `sv_user.c` port.
 *
 * Constraints:
 * - Must provide command/cvar runtimes plus server/game state for client bootstrap and packet execution.
 */
export interface ServerUserContext {
  sv: server_t;
  svs: server_static_t;
  ge: game_export_t;
  cmd: CommandRuntime;
  cvar: CvarRuntime;
  qnet: QcommonNetRuntime;
  sv_paused: { value: number } | null;
  sv_enforcetime: { value: number } | null;
  allow_download: { value: number } | null;
  allow_download_players: { value: number } | null;
  allow_download_models: { value: number } | null;
  allow_download_sounds: { value: number } | null;
  allow_download_maps: { value: number } | null;
  file_from_pak?: () => boolean;
  openDemoFile?: (path: string) => unknown | null;
  loadDownloadFile?: (path: string) => { data: Uint8Array; fromPak?: boolean } | null;
  freeDownload?: (data: Uint8Array) => void;
  SV_DropClient: (client: client_t) => void;
  SV_UserinfoChanged: (client: client_t) => void;
  onPrintf?: (message: string) => void;
  onDPrintf?: (message: string) => void;
}

/**
 * Original name: N/A
 * Source: N/A (server user procedure factory)
 * Category: New
 * Purpose: Build the `sv_user.c` procedure table bound to one explicit server-user context.
 *
 * Constraints:
 * - Must preserve call order and side effects from the original C implementation.
 */
export function createServerUserProcedures(context: ServerUserContext): ServerUserProcedures {
  let sv_client: client_t | null = null;
  let sv_player: edict_t | null = null;

  function currentClient(): client_t {
    if (!sv_client) {
      throw new Error("sv_user.ts: sv_client is null");
    }
    return sv_client;
  }

  function currentPlayer(): edict_t {
    if (!sv_player) {
      throw new Error("sv_user.ts: sv_player is null");
    }
    return sv_player;
  }

  function clientIndex(cl: client_t): number {
    return context.svs.clients.indexOf(cl);
  }

  /**
   * Original name: SV_BeginDemoserver
   * Source: server/sv_user.c
   * Category: Ported
   * Fidelity level: Close
   */
  function SV_BeginDemoserver(): void {
    const name = truncateOsPath(`demos/${context.sv.name}`);
    context.sv.demofile = context.openDemoFile?.(name) ?? null;
    if (!context.sv.demofile) {
      throw new Error(`Couldn't open ${name}\n`);
    }
  }

  /**
   * Original name: SV_New_f
   * Source: server/sv_user.c
   * Category: Ported
   * Fidelity level: Close
   */
  function SV_New_f(): void {
    const client = currentClient();
    context.onDPrintf?.(`New() from ${client.name}\n`);

    if (client.state !== client_state_t.cs_connected) {
      context.onPrintf?.("New not valid -- already spawned\n");
      return;
    }

    if (context.sv.state === server_state_t.ss_demo) {
      SV_BeginDemoserver();
      return;
    }

    const gamedir = Cvar_VariableString(context.cvar, "gamedir");

    MSG_WriteByte(client.netchan.message, svc_ops_e.svc_serverdata);
    MSG_WriteLong(client.netchan.message, PROTOCOL_VERSION);
    MSG_WriteLong(client.netchan.message, context.svs.spawncount);
    MSG_WriteByte(client.netchan.message, context.sv.attractloop ? 1 : 0);
    MSG_WriteString(client.netchan.message, gamedir);

    let playernum = -1;
    if (context.sv.state !== server_state_t.ss_cinematic && context.sv.state !== server_state_t.ss_pic) {
      playernum = clientIndex(client);
    }
    MSG_WriteShort(client.netchan.message, playernum);
    MSG_WriteString(client.netchan.message, context.sv.configstrings[CS_NAME] ?? "");

    if (context.sv.state === server_state_t.ss_game && playernum >= 0) {
      const ent = EDICT_NUM(context.ge, playernum + 1);
      if (!ent) {
        throw new Error(`SV_New_f: missing edict ${playernum + 1}`);
      }

      ent.s.number = playernum + 1;
      client.edict = ent;
      client.lastcmd = createNullUsercmd();

      MSG_WriteByte(client.netchan.message, svc_ops_e.svc_stufftext);
      MSG_WriteString(client.netchan.message, `cmd configstrings ${context.svs.spawncount} 0\n`);
    }
  }

  /**
   * Original name: SV_Configstrings_f
   * Source: server/sv_user.c
   * Category: Ported
   * Fidelity level: Close
   */
  function SV_Configstrings_f(): void {
    const client = currentClient();
    context.onDPrintf?.(`Configstrings() from ${client.name}\n`);

    if (client.state !== client_state_t.cs_connected) {
      context.onPrintf?.("configstrings not valid -- already spawned\n");
      return;
    }

    if ((Number.parseInt(Cmd_Argv(context.cmd, 1), 10) || 0) !== context.svs.spawncount) {
      context.onPrintf?.("SV_Configstrings_f from different level\n");
      SV_New_f();
      return;
    }

    let start = Number.parseInt(Cmd_Argv(context.cmd, 2), 10) || 0;

    while (client.netchan.message.cursize < MAX_MSGLEN / 2 && start < MAX_CONFIGSTRINGS) {
      const config = context.sv.configstrings[start] ?? "";
      if (config.length > 0) {
        MSG_WriteByte(client.netchan.message, svc_ops_e.svc_configstring);
        MSG_WriteShort(client.netchan.message, start);
        MSG_WriteString(client.netchan.message, config);
      }
      start += 1;
    }

    MSG_WriteByte(client.netchan.message, svc_ops_e.svc_stufftext);
    if (start === MAX_CONFIGSTRINGS) {
      MSG_WriteString(client.netchan.message, `cmd baselines ${context.svs.spawncount} 0\n`);
    } else {
      MSG_WriteString(client.netchan.message, `cmd configstrings ${context.svs.spawncount} ${start}\n`);
    }
  }

  /**
   * Original name: SV_Baselines_f
   * Source: server/sv_user.c
   * Category: Ported
   * Fidelity level: Close
   */
  function SV_Baselines_f(): void {
    const client = currentClient();
    context.onDPrintf?.(`Baselines() from ${client.name}\n`);

    if (client.state !== client_state_t.cs_connected) {
      context.onPrintf?.("baselines not valid -- already spawned\n");
      return;
    }

    if ((Number.parseInt(Cmd_Argv(context.cmd, 1), 10) || 0) !== context.svs.spawncount) {
      context.onPrintf?.("SV_Baselines_f from different level\n");
      SV_New_f();
      return;
    }

    let start = Number.parseInt(Cmd_Argv(context.cmd, 2), 10) || 0;
    const nullstate = createEntityState();

    while (client.netchan.message.cursize < MAX_MSGLEN / 2 && start < MAX_EDICTS) {
      const base = context.sv.baselines[start]!;
      if (base.modelindex || base.sound || base.effects) {
        MSG_WriteByte(client.netchan.message, svc_ops_e.svc_spawnbaseline);
        MSG_WriteDeltaEntity(nullstate, base, client.netchan.message, true, true);
      }
      start += 1;
    }

    MSG_WriteByte(client.netchan.message, svc_ops_e.svc_stufftext);
    if (start === MAX_EDICTS) {
      MSG_WriteString(client.netchan.message, `precache ${context.svs.spawncount}\n`);
    } else {
      MSG_WriteString(client.netchan.message, `cmd baselines ${context.svs.spawncount} ${start}\n`);
    }
  }

  /**
   * Original name: SV_Begin_f
   * Source: server/sv_user.c
   * Category: Ported
   * Fidelity level: Close
   */
  function SV_Begin_f(): void {
    const client = currentClient();
    context.onDPrintf?.(`Begin() from ${client.name}\n`);

    if ((Number.parseInt(Cmd_Argv(context.cmd, 1), 10) || 0) !== context.svs.spawncount) {
      context.onPrintf?.("SV_Begin_f from different level\n");
      SV_New_f();
      return;
    }

    client.state = client_state_t.cs_spawned;
    context.ge.ClientBegin(currentPlayer());
    Cbuf_InsertFromDefer(context.cmd);
  }

  /**
   * Original name: SV_NextDownload_f
   * Source: server/sv_user.c
   * Category: Ported
   * Fidelity level: Close
   */
  function SV_NextDownload_f(): void {
    const client = currentClient();
    if (!client.download) {
      return;
    }

    let r = client.downloadsize - client.downloadcount;
    if (r > DOWNLOAD_CHUNK_SIZE) {
      r = DOWNLOAD_CHUNK_SIZE;
    }

    MSG_WriteByte(client.netchan.message, svc_ops_e.svc_download);
    MSG_WriteShort(client.netchan.message, r);

    client.downloadcount += r;
    let size = client.downloadsize;
    if (!size) {
      size = 1;
    }
    const percent = Math.trunc((client.downloadcount * 100) / size);
    MSG_WriteByte(client.netchan.message, percent);
    SZ_Write(client.netchan.message, client.download.subarray(client.downloadcount - r, client.downloadcount));

    if (client.downloadcount !== client.downloadsize) {
      return;
    }

    context.freeDownload?.(client.download);
    client.download = null;
  }

  /**
   * Original name: SV_BeginDownload_f
   * Source: server/sv_user.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Porting notes:
   * - Filesystem access is delegated to `loadDownloadFile`.
   * - Negative download offsets are clamped to zero instead of reproducing invalid pointer arithmetic.
   */
  function SV_BeginDownload_f(): void {
    const client = currentClient();
    const name = Cmd_Argv(context.cmd, 1);
    let offset = 0;

    if (Cmd_Argc(context.cmd) > 2) {
      offset = Number.parseInt(Cmd_Argv(context.cmd, 2), 10) || 0;
    }
    if (offset < 0) {
      offset = 0;
    }

    const disallowed =
      name.includes("..") ||
      (context.allow_download?.value ?? 0) === 0 ||
      name.startsWith(".") ||
      name.startsWith("/") ||
      (name.startsWith("players/") && (context.allow_download_players?.value ?? 0) === 0) ||
      (name.startsWith("models/") && (context.allow_download_models?.value ?? 0) === 0) ||
      (name.startsWith("sound/") && (context.allow_download_sounds?.value ?? 0) === 0) ||
      (name.startsWith("maps/") && (context.allow_download_maps?.value ?? 0) === 0) ||
      !name.includes("/");

    if (disallowed) {
      writeDownloadRefusal(client);
      return;
    }

    if (client.download) {
      context.freeDownload?.(client.download);
    }

    const loaded = context.loadDownloadFile?.(name) ?? null;
    client.download = loaded?.data ?? null;
    client.downloadsize = loaded?.data.length ?? 0;
    client.downloadcount = offset;

    if (offset > client.downloadsize) {
      client.downloadcount = client.downloadsize;
    }

    if (!client.download || (name.startsWith("maps/") && (loaded?.fromPak ?? context.file_from_pak?.() ?? false))) {
      context.onDPrintf?.(`Couldn't download ${name} to ${client.name}\n`);
      if (client.download) {
        context.freeDownload?.(client.download);
        client.download = null;
      }
      writeDownloadRefusal(client);
      return;
    }

    SV_NextDownload_f();
    context.onDPrintf?.(`Downloading ${name} to ${client.name}\n`);
  }

  /**
   * Original name: SV_Disconnect_f
   * Source: server/sv_user.c
   * Category: Ported
   * Fidelity level: Strict
   */
  function SV_Disconnect_f(): void {
    context.SV_DropClient(currentClient());
  }

  /**
   * Original name: SV_ShowServerinfo_f
   * Source: server/sv_user.c
   * Category: Ported
   * Fidelity level: Close
   */
  function SV_ShowServerinfo_f(): string[] {
    const lines = Info_Print(Cvar_Serverinfo(context.cvar));
    for (const line of lines) {
      context.onPrintf?.(`${line}\n`);
    }
    return lines;
  }

  /**
   * Original name: SV_Nextserver
   * Source: server/sv_user.c
   * Category: Ported
   * Fidelity level: Close
   */
  function SV_Nextserver(): void {
    if (
      context.sv.state === server_state_t.ss_game ||
      (context.sv.state === server_state_t.ss_pic && Cvar_VariableValue(context.cvar, "coop") === 0)
    ) {
      return;
    }

    context.svs.spawncount += 1;
    const v = Cvar_VariableString(context.cvar, "nextserver");
    if (!v.length) {
      Cbuf_AddText(context.cmd, "killserver\n");
    } else {
      Cbuf_AddText(context.cmd, v);
      Cbuf_AddText(context.cmd, "\n");
    }
    Cvar_Set(context.cvar, "nextserver", "");
  }

  /**
   * Original name: SV_Nextserver_f
   * Source: server/sv_user.c
   * Category: Ported
   * Fidelity level: Close
   */
  function SV_Nextserver_f(): void {
    const client = currentClient();
    if ((Number.parseInt(Cmd_Argv(context.cmd, 1), 10) || 0) !== context.svs.spawncount) {
      context.onDPrintf?.(`Nextserver() from wrong level, from ${client.name}\n`);
      return;
    }

    context.onDPrintf?.(`Nextserver() from ${client.name}\n`);
    SV_Nextserver();
  }

  /**
   * Original name: SV_ExecuteUserCommand
   * Source: server/sv_user.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Tokenizes one client string command, dispatches known `ucmds` entries and forwards unknown game commands in ss_game.
   */
  function SV_ExecuteUserCommand(s: string): void {
    Cmd_TokenizeString(context.cmd, s, true);
    sv_player = currentClient().edict;

    const name = Cmd_Argv(context.cmd, 0);
    let command: ucmd_t | null = null;

    for (const u of ucmds) {
      if (!u.name) {
        break;
      }
      if (name === u.name) {
        command = u;
        break;
      }
    }

    if (command?.func) {
      command.func();
      return;
    }

    if (context.sv.state === server_state_t.ss_game && sv_player) {
      context.ge.ClientCommand(sv_player);
    }
  }

  /**
   * Original name: SV_ClientThink
   * Source: server/sv_user.c
   * Category: Ported
   * Fidelity level: Strict
   */
  function SV_ClientThink(cl: client_t, cmd: usercmd_t): void {
    cl.commandMsec -= cmd.msec;

    if (cl.commandMsec < 0 && (context.sv_enforcetime?.value ?? 0) !== 0) {
      context.onDPrintf?.(`commandMsec underflow from ${cl.name}\n`);
      return;
    }

    if (!cl.edict) {
      throw new Error("SV_ClientThink: client edict is null");
    }

    context.ge.ClientThink(cl.edict, cmd);
  }

  const ucmds: ucmd_t[] = [
    { name: "new", func: SV_New_f },
    { name: "configstrings", func: SV_Configstrings_f },
    { name: "baselines", func: SV_Baselines_f },
    { name: "begin", func: SV_Begin_f },
    { name: "nextserver", func: SV_Nextserver_f },
    { name: "disconnect", func: SV_Disconnect_f },
    { name: "info", func: SV_ShowServerinfo_f },
    { name: "download", func: SV_BeginDownload_f },
    { name: "nextdl", func: SV_NextDownload_f },
    { name: null, func: null }
  ];

  /**
   * Original name: SV_ExecuteClientMessage
   * Source: server/sv_user.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Parses the current client packet, accepts userinfo, one movement command and at most seven string commands.
   * - Replays dropped movement commands through `SV_ClientThink`, verifies checksums and stores `lastcmd`.
   *
   * Porting notes:
   * - Reads from `context.qnet.net_message`'s current read position left by `Netchan_Process`.
   */
  function SV_ExecuteClientMessage(cl: client_t): void {
    sv_client = cl;
    sv_player = cl.edict;

    let move_issued = false;
    let stringCmdCount = 0;
    const message = context.qnet.net_message;

    while (true) {
      if (message.readcount > message.cursize) {
        context.onPrintf?.("SV_ReadClientMessage: badread\n");
        context.SV_DropClient(cl);
        return;
      }

      const c = MSG_ReadByte(message);
      if (c === -1) {
        break;
      }

      switch (c) {
        default:
          context.onPrintf?.("SV_ReadClientMessage: unknown command char\n");
          context.SV_DropClient(cl);
          return;

        case clc_ops_e.clc_nop:
          break;

        case clc_ops_e.clc_userinfo:
          cl.userinfo = MSG_ReadString(message).slice(0, MAX_INFO_STRING - 1);
          context.SV_UserinfoChanged(cl);
          break;

        case clc_ops_e.clc_move: {
          if (move_issued) {
            return;
          }

          move_issued = true;
          const checksumIndex = message.readcount;
          const checksum = MSG_ReadByte(message);
          const lastframe = MSG_ReadLong(message);
          if (lastframe !== cl.lastframe) {
            cl.lastframe = lastframe;
            if (cl.lastframe > 0) {
              cl.frame_latency[cl.lastframe & (LATENCY_COUNTS - 1)] =
                context.svs.realtime - cl.frames[cl.lastframe & UPDATE_MASK].senttime;
            }
          }

          const nullcmd = createNullUsercmd();
          const oldest = MSG_ReadDeltaUsercmd(message, nullcmd);
          const oldcmd = MSG_ReadDeltaUsercmd(message, oldest);
          const newcmd = MSG_ReadDeltaUsercmd(message, oldcmd);

          if (cl.state !== client_state_t.cs_spawned) {
            cl.lastframe = -1;
            break;
          }

          const calculatedChecksum = COM_BlockSequenceCRCByte(
            message.data.subarray(checksumIndex + 1, message.readcount),
            message.readcount - checksumIndex - 1,
            cl.netchan.incoming_sequence
          );

          if (calculatedChecksum !== checksum) {
            context.onDPrintf?.(
              `Failed command checksum for ${cl.name} (${calculatedChecksum} != ${checksum})/${cl.netchan.incoming_sequence}\n`
            );
            return;
          }

          if ((context.sv_paused?.value ?? 0) === 0) {
            let net_drop = cl.netchan.dropped;
            if (net_drop < 20) {
              while (net_drop > 2) {
                SV_ClientThink(cl, cl.lastcmd);
                net_drop -= 1;
              }
              if (net_drop > 1) {
                SV_ClientThink(cl, oldest);
              }
              if (net_drop > 0) {
                SV_ClientThink(cl, oldcmd);
              }
            }
            SV_ClientThink(cl, newcmd);
          }

          cl.lastcmd = newcmd;
          break;
        }

        case clc_ops_e.clc_stringcmd: {
          const s = MSG_ReadString(message);
          if (++stringCmdCount < MAX_STRINGCMDS) {
            SV_ExecuteUserCommand(s);
          }
          if (cl.state === client_state_t.cs_zombie) {
            return;
          }
          break;
        }
      }
    }
  }

  return {
    SV_New_f,
    SV_Configstrings_f,
    SV_Baselines_f,
    SV_Begin_f,
    SV_NextDownload_f,
    SV_BeginDownload_f,
    SV_Disconnect_f,
    SV_ShowServerinfo_f,
    SV_Nextserver,
    SV_ExecuteUserCommand,
    SV_ClientThink,
    SV_ExecuteClientMessage
  };
}

/**
 * Original name: N/A
 * Source: N/A (local usercmd factory)
 * Category: New
 * Purpose: Create the zero-initialized user command used where the C port clears `usercmd_t` storage.
 */
function createNullUsercmd(): usercmd_t {
  return {
    msec: 0,
    buttons: 0,
    angles: [0, 0, 0],
    forwardmove: 0,
    sidemove: 0,
    upmove: 0,
    impulse: 0,
    lightlevel: 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (local download refusal helper)
 * Category: New
 * Purpose: Emit the repeated `svc_download` refusal payload used by the download command handlers.
 */
function writeDownloadRefusal(client: client_t): void {
  MSG_WriteByte(client.netchan.message, svc_ops_e.svc_download);
  MSG_WriteShort(client.netchan.message, -1);
  MSG_WriteByte(client.netchan.message, 0);
}

/**
 * Original name: N/A
 * Source: N/A (local path truncation helper)
 * Category: New
 * Purpose: Preserve the bounded `MAX_OSPATH` path behavior used by demo-server bootstrap.
 */
function truncateOsPath(value: string): string {
  return value.length >= MAX_OSPATH ? value.slice(0, MAX_OSPATH - 1) : value;
}
