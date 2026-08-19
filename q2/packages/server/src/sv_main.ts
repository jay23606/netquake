/**
 * File: sv_main.ts
 * Source: Quake II original / server/sv_main.c
 * Purpose: Port of core server-client lifecycle and userinfo routines.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses an explicit context object instead of file-static globals.
 * - Download buffer disposal is routed through an optional callback.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

import { createSizeBuffer, type sizebuf_t } from "../../memory/src/index.js";
import {
  Cvar_Get,
  CVAR_ARCHIVE,
  CVAR_LATCH,
  CVAR_NOSET,
  CVAR_SERVERINFO,
  Cmd_Argc,
  Cmd_Argv,
  DF_INSTANT_ITEMS,
  Info_SetValueForKey,
  Cmd_TokenizeString,
  MAX_MSGLEN,
  NET_AdrToString,
  NET_CompareBaseAdr,
  NET_GetPacket,
  NET_IsLocalAddress,
  NET_Sleep,
  Netchan_OutOfBandPrint,
  Netchan_Process,
  Netchan_Setup,
  PROTOCOL_VERSION,
  STAT_FRAGS,
  Info_ValueForKey,
  MAX_INFO_STRING,
  MSG_BeginReading,
  MSG_ReadLong,
  MSG_ReadShort,
  MSG_ReadStringLine,
  MSG_WriteByte,
  MSG_WriteString,
  Netchan_Transmit,
  PRINT_HIGH,
  svc_ops_e,
  VERSION,
  type CommandRuntime,
  type CvarRuntime,
  type QcommonNetRuntime,
  type cvar_t,
  netsrc_t,
  type netadr_t
} from "../../qcommon/src/index.js";
import type { game_export_t } from "../../game/src/index.js";
import {
  EDICT_NUM,
  MAX_CHALLENGES,
  client_state_t,
  createServerClient,
  type ServerMainProcedures,
  type client_t,
  type server_static_t,
  type server_t
} from "./server.js";

/**
 * Original name: N/A
 * Source: N/A (local final-message buffer size)
 * Category: New
 */
const SV_FINAL_MESSAGE_BUFFER = 1400;

/**
 * Original name: N/A
 * Source: N/A (local status buffer guard)
 * Category: New
 */
const SV_STATUS_BUFFER_MAX = MAX_MSGLEN - 16;
const HEARTBEAT_SECONDS = 300;

/**
 * Original name: HEARTBEAT_SECONDS
 * Source: server/sv_main.c
 * Category: Adapter
 */
const HEARTBEAT_MSEC = HEARTBEAT_SECONDS * 1000;
const CLIENT_NAME_LENGTH = 32;

/**
 * Original name: N/A
 * Source: N/A (server main context object)
 * Category: New
 * Purpose: Hold the explicit runtime dependencies required by the `sv_main.c` partial port.
 *
 * Constraints:
 * - Must provide `svs`, `ge`, `qnet`, and `maxclients` for lifecycle and messaging paths.
 */
export interface ServerMainContext {
  sv: server_t;
  svs: server_static_t;
  ge: game_export_t;
  cmd: CommandRuntime;
  cvar?: CvarRuntime;
  qnet: QcommonNetRuntime;
  maxclients: cvar_t | null;
  hostname: cvar_t | null;
  rcon_password: cvar_t | null;
  timeout: cvar_t | null;
  zombietime: cvar_t | null;
  sv_paused: cvar_t | null;
  sv_timedemo: cvar_t | null;
  sv_enforcetime?: cvar_t | null;
  sv_showclamp: cvar_t | null;
  sv_noreload?: cvar_t | null;
  sv_airaccelerate?: cvar_t | null;
  allow_download?: cvar_t | null;
  allow_download_players?: cvar_t | null;
  allow_download_models?: cvar_t | null;
  allow_download_sounds?: cvar_t | null;
  allow_download_maps?: cvar_t | null;
  host_speeds?: cvar_t | null;
  sv_reconnect_limit: cvar_t | null;
  dedicated: cvar_t | null;
  public_server: cvar_t | null;
  master_adr: netadr_t[];
  SV_InitOperatorCommands?: () => void;
  SV_ExecuteClientMessage?: (client: client_t) => void;
  SV_BroadcastPrintf?: (level: number, fmt: string, ...args: unknown[]) => void;
  SV_SendClientMessages?: () => void;
  SV_RecordDemoMessage?: () => void;
  getServerInfo?: () => string;
  onFreeDownload?: (download: Uint8Array) => void;
  onPrintf?: (message: string) => void;
  onDPrintf?: (message: string) => void;
  executeRconCommand?: (command: string) => string | void;
  challengeTimeMs?: () => number;
  randomInt?: () => number;
  nowMs?: () => number;
  setTimeBeforeGame?: (milliseconds: number) => void;
  setTimeAfterGame?: (milliseconds: number) => void;
  closeDemoFile?: (demofile: unknown) => void;
  setServerState?: (state: number) => void;
  SV_ShutdownGameProgs?: () => void;
  SV_Error?: (error: string, ...args: unknown[]) => never;
}

/**
 * Original name: N/A
 * Source: N/A (server main procedure factory)
 * Category: New
 * Purpose: Build the `sv_main.c` procedure table bound to one explicit server-main context.
 *
 * Constraints:
 * - Must preserve call order and side effects from the original C implementation for the implemented subset.
 */
export function createServerMainProcedures(context: ServerMainContext): ServerMainProcedures {
  function SV_Error(error: string, ...args: unknown[]): never {
    if (context.SV_Error) {
      return context.SV_Error(error, ...args);
    }

    throw new Error(formatPrintf(error, args));
  }

  /**
   * Original name: SV_DropClient
   * Source: server/sv_main.c
   * Category: Ported
   * Fidelity level: Strict
   *
   * Behavior:
   * - Disconnects one client slot and transitions it to zombie state.
   */
  function SV_DropClient(drop: client_t): void {
    MSG_WriteByte(drop.netchan.message, svc_ops_e.svc_disconnect);

    if (drop.state === client_state_t.cs_spawned && drop.edict) {
      context.ge.ClientDisconnect(drop.edict);
    }

    if (drop.download) {
      context.onFreeDownload?.(drop.download);
      drop.download = null;
    }

    drop.state = client_state_t.cs_zombie;
    drop.name = "";
  }

  /**
   * Original name: SV_UserinfoChanged
   * Source: server/sv_main.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Pulls `name`, `rate` and `msg` from one userinfo string into server-friendly client fields.
   *
   * Porting notes:
   * - Mirrors C `strncpy(cl->name, ..., sizeof(cl->name)-1)` and `atoi` fallback behavior.
   */
  function SV_UserinfoChanged(cl: client_t): void {
    if (cl.edict) {
      context.ge.ClientUserinfoChanged(cl.edict, cl.userinfo);
    }

    const rawName = Info_ValueForKey(cl.userinfo, "name");
    cl.name = stripHighBits(rawName);

    const rateValue = Info_ValueForKey(cl.userinfo, "rate");
    if (rateValue.length > 0) {
      cl.rate = cAtoi(rateValue);
      if (cl.rate < 100) {
        cl.rate = 100;
      }
      if (cl.rate > 15000) {
        cl.rate = 15000;
      }
    } else {
      cl.rate = 5000;
    }

    const messageValue = Info_ValueForKey(cl.userinfo, "msg");
    if (messageValue.length > 0) {
      cl.messagelevel = cAtoi(messageValue);
    }
  }

  /**
   * Original name: SV_FinalMessage
   * Source: server/sv_main.c
   * Category: Ported
   * Fidelity level: Strict
   *
   * Behavior:
   * - Sends one final print+disconnect/reconnect packet twice to all connected clients.
   */
  function SV_FinalMessage(message: string, reconnect: boolean): void {
    const net_message = createSizeBuffer(SV_FINAL_MESSAGE_BUFFER);

    MSG_WriteByte(net_message, svc_ops_e.svc_print);
    MSG_WriteByte(net_message, PRINT_HIGH);
    MSG_WriteString(net_message, message);
    MSG_WriteByte(net_message, reconnect ? svc_ops_e.svc_reconnect : svc_ops_e.svc_disconnect);

    const maxClients = Math.trunc(context.maxclients?.value ?? 0);
    for (let pass = 0; pass < 2; pass += 1) {
      for (let i = 0; i < maxClients; i += 1) {
        const cl = context.svs.clients[i];
        if (!cl) {
          continue;
        }
        if (cl.state >= client_state_t.cs_connected) {
          Netchan_Transmit(context.qnet, cl.netchan, net_message.cursize, net_message.data);
        }
      }
    }
  }

  return {
    SV_Init,
    SV_Shutdown,
    SV_FinalMessage,
    SV_DropClient,
    SVC_Status,
    SVC_Ping,
    SV_ConnectionlessPacket,
    SV_ReadPackets,
    SV_CheckTimeouts,
    SV_CalcPings,
    SV_GiveMsec,
    SV_PrepWorldFrame,
    SV_RunGameFrame,
    SV_Frame,
    SV_UserinfoChanged,
    Master_Heartbeat
  };

  /**
   * Original name: SVC_Ack
   * Source: server/sv_main.c
   * Category: Ported
   * Fidelity level: Strict
   *
   * Behavior:
   * - Logs one ping acknowledgement received from a remote host.
   */
  function SVC_Ack(): void {
    context.onPrintf?.(`Ping acknowledge from ${NET_AdrToString(context.qnet.net_from)}\n`);
  }

  /**
   * Original name: Master_Heartbeat
   * Source: server/sv_main.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Sends a periodic heartbeat packet with status text to all configured masters.
   */
  function Master_Heartbeat(): void {
    if ((context.dedicated?.value ?? 0) === 0) {
      return;
    }
    if ((context.public_server?.value ?? 0) === 0) {
      return;
    }

    if (context.svs.last_heartbeat > context.svs.realtime) {
      context.svs.last_heartbeat = context.svs.realtime;
    }

    if (context.svs.realtime - context.svs.last_heartbeat < HEARTBEAT_MSEC) {
      return;
    }

    context.svs.last_heartbeat = context.svs.realtime;
    const status = SV_StatusString();

    for (let i = 0; i < context.master_adr.length; i += 1) {
      const adr = context.master_adr[i];
      if (!adr || adr.port === 0) {
        continue;
      }

      context.onPrintf?.(`Sending heartbeat to ${NET_AdrToString(adr)}\n`);
      Netchan_OutOfBandPrint(context.qnet, netsrc_t.NS_SERVER, adr, `heartbeat\n${status}`);
    }
  }

  /**
   * Original name: SV_Init
   * Source: server/sv_main.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Registers the classic server cvars/commands and resets the shared net_message buffer once at startup.
   *
   * Porting notes:
   * - Cvar registration mutates the shared explicit cvar runtime instead of file-static globals.
   */
  function SV_Init(): void {
    context.SV_InitOperatorCommands?.();

    if (context.cvar) {
      context.rcon_password = bindCvar(context.rcon_password, "rcon_password", "", 0);
      Cvar_Get(context.cvar, "skill", "1", 0);
      Cvar_Get(context.cvar, "deathmatch", "0", CVAR_LATCH);
      Cvar_Get(context.cvar, "coop", "0", CVAR_LATCH);
      Cvar_Get(context.cvar, "dmflags", `${DF_INSTANT_ITEMS}`, CVAR_SERVERINFO);
      Cvar_Get(context.cvar, "fraglimit", "0", CVAR_SERVERINFO);
      Cvar_Get(context.cvar, "timelimit", "0", CVAR_SERVERINFO);
      Cvar_Get(context.cvar, "cheats", "0", CVAR_SERVERINFO | CVAR_LATCH);
      Cvar_Get(context.cvar, "protocol", `${PROTOCOL_VERSION}`, CVAR_SERVERINFO | CVAR_NOSET);
      context.maxclients = bindCvar(context.maxclients, "maxclients", "1", CVAR_SERVERINFO | CVAR_LATCH);
      context.hostname = bindCvar(context.hostname, "hostname", "noname", CVAR_SERVERINFO | CVAR_ARCHIVE);
      context.timeout = bindCvar(context.timeout, "timeout", "125", 0);
      context.zombietime = bindCvar(context.zombietime, "zombietime", "2", 0);
      context.sv_showclamp = bindCvar(context.sv_showclamp, "showclamp", "0", 0);
      context.sv_paused = bindCvar(context.sv_paused, "paused", "0", 0);
      context.sv_timedemo = bindCvar(context.sv_timedemo, "timedemo", "0", 0);
      context.sv_enforcetime = bindCvar(context.sv_enforcetime ?? null, "sv_enforcetime", "0", 0);
      context.allow_download = bindCvar(context.allow_download ?? null, "allow_download", "0", CVAR_ARCHIVE);
      context.allow_download_players = bindCvar(
        context.allow_download_players ?? null,
        "allow_download_players",
        "0",
        CVAR_ARCHIVE
      );
      context.allow_download_models = bindCvar(
        context.allow_download_models ?? null,
        "allow_download_models",
        "1",
        CVAR_ARCHIVE
      );
      context.allow_download_sounds = bindCvar(
        context.allow_download_sounds ?? null,
        "allow_download_sounds",
        "1",
        CVAR_ARCHIVE
      );
      context.allow_download_maps = bindCvar(context.allow_download_maps ?? null, "allow_download_maps", "1", CVAR_ARCHIVE);
      context.sv_noreload = bindCvar(context.sv_noreload ?? null, "sv_noreload", "0", 0);
      context.sv_airaccelerate = bindCvar(context.sv_airaccelerate ?? null, "sv_airaccelerate", "0", CVAR_LATCH);
      context.public_server = bindCvar(context.public_server, "public", "0", 0);
      context.sv_reconnect_limit = bindCvar(context.sv_reconnect_limit, "sv_reconnect_limit", "3", CVAR_ARCHIVE);
    }

    context.qnet.net_message.allowoverflow = false;
    context.qnet.net_message.overflowed = false;
    context.qnet.net_message.cursize = 0;
    context.qnet.net_message.readcount = 0;
  }

  function bindCvar(current: cvar_t | null, name: string, value: string, flags: number): cvar_t | null {
    const registered = context.cvar ? Cvar_Get(context.cvar, name, value, flags) : null;
    return current ?? registered;
  }

  /**
   * Original name: Master_Shutdown
   * Source: server/sv_main.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Sends one `shutdown` out-of-band packet to all configured masters when this dedicated public server stops.
   */
  function Master_Shutdown(): void {
    if ((context.dedicated?.value ?? 0) === 0) {
      return;
    }
    if ((context.public_server?.value ?? 0) === 0) {
      return;
    }

    for (let i = 0; i < context.master_adr.length; i += 1) {
      const adr = context.master_adr[i];
      if (!adr || adr.port === 0) {
        continue;
      }

      if (i > 0) {
        context.onPrintf?.(`Sending heartbeat to ${NET_AdrToString(adr)}\n`);
      }
      Netchan_OutOfBandPrint(context.qnet, netsrc_t.NS_SERVER, adr, "shutdown");
    }
  }

  /**
   * Original name: SVC_Status
   * Source: server/sv_main.c
   * Category: Ported
   * Fidelity level: Strict
   *
   * Behavior:
   * - Sends the full status string back as one out-of-band `print` packet.
   */
  function SVC_Status(): void {
    Netchan_OutOfBandPrint(context.qnet, netsrc_t.NS_SERVER, context.qnet.net_from, `print\n${SV_StatusString()}`);
  }

  /**
   * Original name: SVC_Ping
   * Source: server/sv_main.c
   * Category: Ported
   * Fidelity level: Strict
   *
   * Behavior:
   * - Sends one out-of-band `ack` reply to a ping request.
   */
  function SVC_Ping(): void {
    Netchan_OutOfBandPrint(context.qnet, netsrc_t.NS_SERVER, context.qnet.net_from, "ack");
  }

  /**
   * Original name: SVC_Info
   * Source: server/sv_main.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Responds to broadcast `info` probes with one short server summary string.
   */
  function SVC_Info(): void {
    if (Math.trunc(context.maxclients?.value ?? 0) === 1) {
      return;
    }

    const version = Number.parseInt(Cmd_Argv(context.cmd, 1), 10) || 0;
    let text = "";

    if (version !== PROTOCOL_VERSION) {
      text = `${context.hostname?.string ?? ""}: wrong version\n`;
    } else {
      let count = 0;
      const maxClients = Math.trunc(context.maxclients?.value ?? 0);
      for (let i = 0; i < maxClients; i += 1) {
        if ((context.svs.clients[i]?.state ?? client_state_t.cs_free) >= client_state_t.cs_connected) {
          count += 1;
        }
      }

      text = `${(context.hostname?.string ?? "").padStart(16, " ")} ${context.sv.name.padStart(8, " ")} ${String(count).padStart(2, " ")}/${String(maxClients).padStart(2, " ")}\n`;
    }

    Netchan_OutOfBandPrint(context.qnet, netsrc_t.NS_SERVER, context.qnet.net_from, `info\n${text}`);
  }

  /**
   * Original name: SVC_GetChallenge
   * Source: server/sv_main.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Returns or allocates one challenge number for the request address.
   */
  function SVC_GetChallenge(): void {
    let oldest = 0;
    let oldestTime = 0x7fffffff;
    let index = MAX_CHALLENGES;

    for (let i = 0; i < MAX_CHALLENGES; i += 1) {
      if (NET_CompareBaseAdr(context.qnet.net_from, context.svs.challenges[i]!.adr)) {
        index = i;
        break;
      }
      if ((context.svs.challenges[i]!.time ?? 0) < oldestTime) {
        oldestTime = context.svs.challenges[i]!.time;
        oldest = i;
      }
    }

    if (index === MAX_CHALLENGES) {
      const challenge = (context.randomInt?.() ?? Math.trunc(Math.random() * 0x8000)) & 0x7fff;
      context.svs.challenges[oldest]!.challenge = challenge;
      copyNetAdr(context.svs.challenges[oldest]!.adr, context.qnet.net_from);
      context.svs.challenges[oldest]!.time = context.challengeTimeMs?.() ?? context.svs.realtime;
      index = oldest;
    }

    Netchan_OutOfBandPrint(
      context.qnet,
      netsrc_t.NS_SERVER,
      context.qnet.net_from,
      `challenge ${context.svs.challenges[index]!.challenge}`
    );
  }

  /**
   * Original name: SVC_DirectConnect
   * Source: server/sv_main.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Validates one remote connect request, allocates/reuses a client slot and starts the sequenced netchan.
   */
  function SVC_DirectConnect(): void {
    const adr = cloneNetAdr(context.qnet.net_from);
    context.onDPrintf?.("SVC_DirectConnect ()\n");

    const version = Number.parseInt(Cmd_Argv(context.cmd, 1), 10) || 0;
    if (version !== PROTOCOL_VERSION) {
      Netchan_OutOfBandPrint(context.qnet, netsrc_t.NS_SERVER, adr, `print\nServer is version ${VERSION}.\n`);
      context.onDPrintf?.(`    rejected connect from version ${version}\n`);
      return;
    }

    const qport = Number.parseInt(Cmd_Argv(context.cmd, 2), 10) || 0;
    const challenge = Number.parseInt(Cmd_Argv(context.cmd, 3), 10) || 0;

    let userinfo = Cmd_Argv(context.cmd, 4).slice(0, MAX_INFO_STRING - 1);
    userinfo = Info_SetValueForKey(userinfo, "ip", NET_AdrToString(context.qnet.net_from));

    if (context.sv.attractloop && !NET_IsLocalAddress(adr)) {
      context.onPrintf?.("Remote connect in attract loop.  Ignored.\n");
      Netchan_OutOfBandPrint(context.qnet, netsrc_t.NS_SERVER, adr, "print\nConnection refused.\n");
      return;
    }

    if (!NET_IsLocalAddress(adr)) {
      let matched = false;
      for (let i = 0; i < MAX_CHALLENGES; i += 1) {
        const slot = context.svs.challenges[i]!;
        if (NET_CompareBaseAdr(context.qnet.net_from, slot.adr)) {
          matched = true;
          if (challenge === slot.challenge) {
            break;
          }
          Netchan_OutOfBandPrint(context.qnet, netsrc_t.NS_SERVER, adr, "print\nBad challenge.\n");
          return;
        }
        if (i === MAX_CHALLENGES - 1 && !matched) {
          Netchan_OutOfBandPrint(context.qnet, netsrc_t.NS_SERVER, adr, "print\nNo challenge for address.\n");
          return;
        }
      }
    }

    let newcl: client_t | null = createServerClient();
    const temp = createServerClient();
    let foundExisting = false;
    const maxClients = Math.trunc(context.maxclients?.value ?? 0);

    for (let i = 0; i < maxClients; i += 1) {
      const cl = context.svs.clients[i];
      if (!cl || cl.state === client_state_t.cs_free) {
        continue;
      }
      if (
        NET_CompareBaseAdr(adr, cl.netchan.remote_address) &&
        (cl.netchan.qport === qport || adr.port === cl.netchan.remote_address.port)
      ) {
        if (
          !NET_IsLocalAddress(adr) &&
          context.svs.realtime - cl.lastconnect < Math.trunc((context.sv_reconnect_limit?.value ?? 3) * 1000)
        ) {
          context.onDPrintf?.(`${NET_AdrToString(adr)}:reconnect rejected : too soon\n`);
          return;
        }
        context.onPrintf?.(`${NET_AdrToString(adr)}:reconnect\n`);
        newcl = cl;
        foundExisting = true;
        break;
      }
    }

    if (!foundExisting) {
      newcl = null;
      for (let i = 0; i < maxClients; i += 1) {
        const cl = context.svs.clients[i];
        if (cl && cl.state === client_state_t.cs_free) {
          newcl = cl;
          break;
        }
      }
    }

    if (!newcl) {
      Netchan_OutOfBandPrint(context.qnet, netsrc_t.NS_SERVER, adr, "print\nServer is full.\n");
      context.onDPrintf?.("Rejected a connection.\n");
      return;
    }

    Object.assign(newcl, temp);

    const edictnum = context.svs.clients.indexOf(newcl) + 1;
    const ent = EDICT_NUM(context.ge, edictnum);
    if (!ent) {
      SV_Error("SVC_DirectConnect: missing edict %i", edictnum);
    }

    newcl.edict = ent;
    newcl.challenge = challenge;

    if (!context.ge.ClientConnect(ent, userinfo)) {
      const exportedRejmsg = context.ge.ClientConnectRejectMessage?.() ?? "";
      const rejmsg = exportedRejmsg.length > 0 ? exportedRejmsg : Info_ValueForKey(userinfo, "rejmsg");
      if (rejmsg.length > 0) {
        Netchan_OutOfBandPrint(context.qnet, netsrc_t.NS_SERVER, adr, `print\n${rejmsg}\nConnection refused.\n`);
      } else {
        Netchan_OutOfBandPrint(context.qnet, netsrc_t.NS_SERVER, adr, "print\nConnection refused.\n");
      }
      context.onDPrintf?.("Game rejected a connection.\n");
      return;
    }

    newcl.userinfo = userinfo;
    SV_UserinfoChanged(newcl);

    Netchan_OutOfBandPrint(context.qnet, netsrc_t.NS_SERVER, adr, "client_connect");
    Netchan_Setup(context.qnet, netsrc_t.NS_SERVER, newcl.netchan, adr, qport);

    newcl.state = client_state_t.cs_connected;
    newcl.datagram.allowoverflow = true;
    newcl.lastmessage = context.svs.realtime;
    newcl.lastconnect = context.svs.realtime;
  }

  /**
   * Original name: SVC_RemoteCommand
   * Source: server/sv_main.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Validates one rcon request, logs it, executes the remaining command text and replies as an OOB print packet.
   *
   * Porting notes:
   * - Redirect buffering is modeled through the `executeRconCommand` callback result instead of global `Com_BeginRedirect`.
   */
  function SVC_RemoteCommand(): void {
    const payload = decodePacketString(context.qnet.net_message.data.subarray(4, context.qnet.net_message.cursize));
    const valid = Rcon_Validate();

    if (!valid) {
      context.onPrintf?.(`Bad rcon from ${NET_AdrToString(context.qnet.net_from)}:\n${payload}\n`);
    } else {
      context.onPrintf?.(`Rcon from ${NET_AdrToString(context.qnet.net_from)}:\n${payload}\n`);
    }

    if (!valid) {
      Netchan_OutOfBandPrint(context.qnet, netsrc_t.NS_SERVER, context.qnet.net_from, "print\nBad rcon_password.\n");
      return;
    }

    let remaining = "";
    for (let i = 2; i < Cmd_Argc(context.cmd); i += 1) {
      remaining += `${Cmd_Argv(context.cmd, i)} `;
    }

    const output = context.executeRconCommand?.(remaining) ?? "";
    Netchan_OutOfBandPrint(context.qnet, netsrc_t.NS_SERVER, context.qnet.net_from, `print\n${output}`);
  }

  /**
   * Original name: SV_ConnectionlessPacket
   * Source: server/sv_main.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Parses one out-of-band packet line and dispatches to the matching connectionless command.
   *
   * Porting notes:
   * - Preserves the original dispatch order.
   * - Uses the explicit command and qcommon network runtimes instead of file-static globals.
   */
  function SV_ConnectionlessPacket(): string {
    MSG_BeginReading(context.qnet.net_message);
    MSG_ReadLong(context.qnet.net_message);

    const s = MSG_ReadStringLine(context.qnet.net_message);
    Cmd_TokenizeString(context.cmd, s, false);

    const c = Cmd_Argv(context.cmd, 0);
    context.onDPrintf?.(`Packet ${NET_AdrToString(context.qnet.net_from)} : ${c}\n`);

    if (c === "ping") {
      SVC_Ping();
    } else if (c === "ack") {
      SVC_Ack();
    } else if (c === "status") {
      SVC_Status();
    } else if (c === "info") {
      SVC_Info();
    } else if (c === "getchallenge") {
      SVC_GetChallenge();
    } else if (c === "connect") {
      SVC_DirectConnect();
    } else if (c === "rcon") {
      SVC_RemoteCommand();
    } else {
      context.onPrintf?.(`bad connectionless packet from ${NET_AdrToString(context.qnet.net_from)}:\n${s}\n`);
    }

    return c;
  }

  /**
   * Original name: SV_ReadPackets
   * Source: server/sv_main.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Pulls pending server packets, dispatches connectionless messages and routes sequenced packets to clients.
   *
   * Porting notes:
   * - Uses the explicit qcommon network runtime instead of file-static globals.
   */
  function SV_ReadPackets(): number {
    let processed = 0;
    const maxClients = Math.trunc(context.maxclients?.value ?? 0);

    while (NET_GetPacket(context.qnet, netsrc_t.NS_SERVER, context.qnet.net_from, context.qnet.net_message)) {
      processed += 1;

      if (
        context.qnet.net_message.cursize >= 4 &&
        new DataView(
          context.qnet.net_message.data.buffer,
          context.qnet.net_message.data.byteOffset,
          4
        ).getInt32(0, true) === -1
      ) {
        SV_ConnectionlessPacket();
        continue;
      }

      MSG_BeginReading(context.qnet.net_message);
      MSG_ReadLong(context.qnet.net_message);
      MSG_ReadLong(context.qnet.net_message);
      const qport = MSG_ReadShort(context.qnet.net_message) & 0xffff;

      let matched = false;
      for (let i = 0; i < maxClients; i += 1) {
        const cl = context.svs.clients[i];
        if (!cl || cl.state === client_state_t.cs_free) {
          continue;
        }
        if (!NET_CompareBaseAdr(context.qnet.net_from, cl.netchan.remote_address)) {
          continue;
        }
        if (cl.netchan.qport !== qport) {
          continue;
        }
        if (cl.netchan.remote_address.port !== context.qnet.net_from.port) {
          context.onPrintf?.("SV_ReadPackets: fixing up a translated port\n");
          cl.netchan.remote_address.port = context.qnet.net_from.port;
        }

        if (Netchan_Process(context.qnet, cl.netchan, context.qnet.net_message)) {
          if (cl.state !== client_state_t.cs_zombie) {
            cl.lastmessage = context.svs.realtime;
            context.SV_ExecuteClientMessage?.(cl);
          }
        }

        matched = true;
        break;
      }

      if (matched) {
        continue;
      }
    }

    return processed;
  }

  /**
   * Original name: SV_CheckTimeouts
   * Source: server/sv_main.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Frees expired zombie slots and drops connected/spawned clients that timed out.
   */
  function SV_CheckTimeouts(): void {
    const droppoint = context.svs.realtime - 1000 * (context.timeout?.value ?? 125);
    const zombiepoint = context.svs.realtime - 1000 * (context.zombietime?.value ?? 2);
    const maxClients = Math.trunc(context.maxclients?.value ?? 0);

    for (let i = 0; i < maxClients; i += 1) {
      const cl = context.svs.clients[i];
      if (!cl) {
        continue;
      }

      if (cl.lastmessage > context.svs.realtime) {
        cl.lastmessage = context.svs.realtime;
      }

      if (cl.state === client_state_t.cs_zombie && cl.lastmessage < zombiepoint) {
        cl.state = client_state_t.cs_free;
        continue;
      }

      if (
        (cl.state === client_state_t.cs_connected || cl.state === client_state_t.cs_spawned) &&
        cl.lastmessage < droppoint
      ) {
        context.SV_BroadcastPrintf?.(PRINT_HIGH, "%s timed out\n", cl.name);
        SV_DropClient(cl);
        cl.state = client_state_t.cs_free;
      }
    }
  }

  /**
   * Original name: SV_CalcPings
   * Source: server/sv_main.c
   * Category: Ported
   * Fidelity level: Strict
   *
   * Behavior:
   * - Recomputes per-client ping from stored frame latencies and mirrors it into the game client state.
   */
  function SV_CalcPings(): void {
    const maxClients = Math.trunc(context.maxclients?.value ?? 0);

    for (let i = 0; i < maxClients; i += 1) {
      const cl = context.svs.clients[i];
      if (!cl || cl.state !== client_state_t.cs_spawned) {
        continue;
      }

      let total = 0;
      let count = 0;
      for (let j = 0; j < cl.frame_latency.length; j += 1) {
        if (cl.frame_latency[j]! > 0) {
          count += 1;
          total += cl.frame_latency[j]!;
        }
      }

      cl.ping = count === 0 ? 0 : Math.trunc(total / count);
      if (cl.edict?.client) {
        cl.edict.client.ping = cl.ping;
      }
    }
  }

  /**
   * Original name: SV_GiveMsec
   * Source: server/sv_main.c
   * Category: Ported
   * Fidelity level: Strict
   *
   * Behavior:
   * - Refills the command-msec budget for active clients every 16 frames.
   */
  function SV_GiveMsec(): void {
    if ((context.sv.framenum & 15) !== 0) {
      return;
    }

    const maxClients = Math.trunc(context.maxclients?.value ?? 0);
    for (let i = 0; i < maxClients; i += 1) {
      const cl = context.svs.clients[i];
      if (!cl || cl.state === client_state_t.cs_free) {
        continue;
      }
      cl.commandMsec = 1800;
    }
  }

  /**
   * Original name: SV_PrepWorldFrame
   * Source: server/sv_main.c
   * Category: Ported
   * Fidelity level: Strict
   *
   * Behavior:
   * - Clears one-frame entity events before the next world/frame processing pass.
   */
  function SV_PrepWorldFrame(): void {
    for (let i = 0; i < context.ge.num_edicts; i += 1) {
      const ent = EDICT_NUM(context.ge, i);
      if (!ent) {
        continue;
      }
      ent.s.event = 0;
    }
  }

  /**
   * Original name: SV_RunGameFrame
   * Source: server/sv_main.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Advances the server frame clock and runs the game VM frame when not paused.
   */
  function SV_RunGameFrame(): void {
    if ((context.host_speeds?.value ?? 0) !== 0) {
      context.setTimeBeforeGame?.(context.nowMs?.() ?? Date.now());
    }

    context.sv.framenum += 1;
    context.sv.time = context.sv.framenum * 100;

    if ((context.sv_paused?.value ?? 0) === 0 || (context.maxclients?.value ?? 0) > 1) {
      context.ge.RunFrame();

      if (context.sv.time < context.svs.realtime) {
        if ((context.sv_showclamp?.value ?? 0) !== 0) {
          context.onPrintf?.("sv highclamp\n");
        }
        context.svs.realtime = context.sv.time;
      }
    }

    if ((context.host_speeds?.value ?? 0) !== 0) {
      context.setTimeAfterGame?.(context.nowMs?.() ?? Date.now());
    }
  }

  /**
   * Original name: SV_Frame
   * Source: server/sv_main.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Advances one full server frame: timeouts, packets, world frame, client sends and heartbeats.
   */
  function SV_Frame(msec: number): void {
    context.setTimeBeforeGame?.(0);
    context.setTimeAfterGame?.(0);

    if (!context.svs.initialized) {
      return;
    }

    context.svs.realtime += msec;
    context.randomInt?.();

    SV_CheckTimeouts();
    SV_ReadPackets();

    if ((context.sv_timedemo?.value ?? 0) === 0 && context.svs.realtime < context.sv.time) {
      if (context.sv.time - context.svs.realtime > 100) {
        if ((context.sv_showclamp?.value ?? 0) !== 0) {
          context.onPrintf?.("sv lowclamp\n");
        }
        context.svs.realtime = context.sv.time - 100;
      }
      NET_Sleep(context.qnet, context.sv.time - context.svs.realtime);
      return;
    }

    SV_CalcPings();
    SV_GiveMsec();
    SV_RunGameFrame();
    context.SV_SendClientMessages?.();
    context.SV_RecordDemoMessage?.();
    Master_Heartbeat();
    SV_PrepWorldFrame();
  }

  /**
   * Original name: SV_Shutdown
   * Source: server/sv_main.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Sends the final client message, notifies masters, shuts down game progs and clears server runtime state.
   *
   * Porting notes:
   * - Keeps JS-owned arrays/objects alive while resetting their contents instead of freeing heap allocations.
   */
  function SV_Shutdown(finalmsg: string, reconnect: boolean): void {
    if (context.svs.clients.length > 0) {
      SV_FinalMessage(finalmsg, reconnect);
    }

    Master_Shutdown();
    context.SV_ShutdownGameProgs?.();

    if (context.sv.demofile) {
      context.closeDemoFile?.(context.sv.demofile);
      context.sv.demofile = null;
    }

    context.sv.state = 0;
    context.sv.attractloop = false;
    context.sv.loadgame = false;
    context.sv.time = 0;
    context.sv.framenum = 0;
    context.sv.name = "";
    context.sv.models.fill(null);
    context.sv.configstrings.fill("");
    for (const baseline of context.sv.baselines) {
      baseline.number = 0;
      baseline.event = 0;
      baseline.modelindex = 0;
      baseline.modelindex2 = 0;
      baseline.modelindex3 = 0;
      baseline.modelindex4 = 0;
      baseline.frame = 0;
      baseline.skinnum = 0;
      baseline.effects = 0;
      baseline.renderfx = 0;
      baseline.solid = 0;
      baseline.sound = 0;
      baseline.origin = [0, 0, 0];
      baseline.angles = [0, 0, 0];
      baseline.old_origin = [0, 0, 0];
    }
    context.sv.timedemo = false;
    context.setServerState?.(context.sv.state);

    for (const client of context.svs.clients) {
      if (!client) {
        continue;
      }
      if (client.download) {
        context.onFreeDownload?.(client.download);
      }
      client.state = client_state_t.cs_free;
      client.name = "";
      client.edict = null;
      client.download = null;
      client.downloadcount = 0;
      client.downloadsize = 0;
    }

    if (context.svs.demofile) {
      context.closeDemoFile?.(context.svs.demofile);
      context.svs.demofile = null;
    }

    context.svs.initialized = false;
    context.svs.realtime = 0;
    context.svs.mapcmd = "";
    context.svs.spawncount = 0;
    context.svs.num_client_entities = 0;
    context.svs.next_client_entities = 0;
    context.svs.client_entities = [];
    context.svs.last_heartbeat = 0;
    for (const challenge of context.svs.challenges) {
      challenge.challenge = 0;
      challenge.time = 0;
      challenge.adr.type = 0;
      challenge.adr.ip.fill(0);
      challenge.adr.ipx.fill(0);
      challenge.adr.port = 0;
    }
  }

  function SV_StatusString(): string {
    let status = `${context.getServerInfo?.() ?? ""}\n`;

    const maxClients = Math.trunc(context.maxclients?.value ?? 0);
    for (let i = 0; i < maxClients; i += 1) {
      const cl = context.svs.clients[i];
      if (!cl) {
        continue;
      }

      if (cl.state === client_state_t.cs_connected || cl.state === client_state_t.cs_spawned) {
        const frags = cl.edict?.client?.ps.stats[STAT_FRAGS] ?? 0;
        const player = `${frags} ${cl.ping} "${cl.name}"\n`;
        if (status.length + player.length >= SV_STATUS_BUFFER_MAX) {
          break;
        }
        status += player;
      }
    }

    return status;
  }

  /**
   * Original name: Rcon_Validate
   * Source: server/sv_main.c
   * Category: Ported
   * Fidelity level: Strict
   *
   * Behavior:
   * - Accepts rcon only when a password is configured and the first rcon argument matches it.
   */
  function Rcon_Validate(): boolean {
    const password = context.rcon_password?.string ?? "";
    if (!password.length) {
      return false;
    }

    return Cmd_Argv(context.cmd, 1) === password;
  }
}

/**
 * Original name: N/A
 * Source: N/A (local net address clone helper)
 * Category: New
 */
function cloneNetAdr(address: netadr_t): netadr_t {
  return {
    type: address.type,
    ip: new Uint8Array(address.ip),
    ipx: new Uint8Array(address.ipx),
    port: address.port
  };
}

/**
 * Original name: N/A
 * Source: N/A (local net address copy helper)
 * Category: New
 */
function copyNetAdr(target: netadr_t, source: netadr_t): void {
  target.type = source.type;
  target.ip.set(source.ip);
  target.ipx.set(source.ipx);
  target.port = source.port;
}

/**
 * Original name: N/A
 * Source: N/A (local packet string decoder)
 * Category: New
 */
function decodePacketString(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 1) {
    const c = bytes[i]!;
    if (c === 0) {
      break;
    }
    text += String.fromCharCode(c);
  }
  return text;
}

/**
 * Original name: N/A
 * Source: N/A (local printf formatter)
 * Category: New
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

/**
 * Original name: N/A
 * Source: N/A (local userinfo string helper)
 * Category: New
 */
function stripHighBits(text: string): string {
  let out = "";
  const limit = Math.min(text.length, CLIENT_NAME_LENGTH - 1);
  for (let i = 0; i < limit; i += 1) {
    out += String.fromCharCode(text.charCodeAt(i) & 127);
  }
  return out;
}

function cAtoi(text: string): number {
  const match = text.match(/^\s*([+-]?\d+)/);
  return match ? Math.trunc(Number.parseInt(match[1]!, 10)) : 0;
}
