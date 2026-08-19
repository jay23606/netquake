/**
 * File: cl_main.ts
 * Source: Quake II original / client/cl_main.c
 * Purpose: Port the first client bootstrap, cvar initialization and console command bindings needed by the Quake II client runtime.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Defers networking, renderer, demo and audio shutdown side effects to hooks.
 * - Uses explicit runtime/context objects instead of file-static globals.
 *
 * Notes:
 * - This file is intended to stay conceptually close to the original C source.
 */

import {
  Cbuf_AddText,
  Cbuf_Execute,
  NET_Config,
  NET_CompareAdr,
  NET_GetPacket,
  NET_SendPacket,
  NET_StringToAdr,
  NET_AdrToString,
  NET_IsLocalAddress,
  Netchan_Init,
  Netchan_OutOfBandPrint,
  Netchan_Process,
  Netchan_Setup,
  Netchan_Transmit,
  PORT_SERVER,
  Cmd_AddCommand,
  Cmd_Argc,
  Cmd_Args,
  Cmd_Argv,
  Cmd_Exists,
  Cmd_TokenizeString,
  Cvar_Get,
  Cvar_Set,
  Cvar_WriteVariables,
  Cvar_Userinfo,
  Cvar_VariableString,
  Cvar_VariableValue,
  Cvar_SetValue,
  CVAR_NOSET,
  CVAR_ARCHIVE,
  CVAR_USERINFO,
  Info_Print,
  LittleLong,
  PROTOCOL_VERSION,
  clc_ops_e,
  MSG_BeginReading,
  MSG_ReadLong,
  MSG_ReadString,
  MSG_ReadStringLine,
  MSG_WriteByte,
  MSG_WriteDeltaEntity,
  MSG_WriteLong,
  MSG_WriteShort,
  MSG_WriteString,
  createNetAdr,
  createEntityState,
  netadrtype_t,
  netsrc_t,
  type CommandRuntime,
  type CvarRuntime,
  type QcommonNetRuntime,
  type cvar_t,
  svc_ops_e,
  CS_MAXCLIENTS,
  CS_NAME,
  CS_PLAYERSKINS,
  MAX_CONFIGSTRINGS,
  MAX_CLIENTS
} from "../../qcommon/src/index.js";
import { createSizeBuffer, setLittleLong } from "../../memory/src/index.js";
import { CL_Download_f, type ClientDownloadHooks } from "./download.js";
import { Key_WriteBindings, type ClientKeyContext } from "./keys.js";
import { CL_Precache_f, type ClientPrecacheHooks } from "./precache.js";
import { type ClientParseHooks, CL_ClearState, CL_ParseClientinfo, CL_ParseServerMessage, CL_WriteStringCmd } from "./cl_parse.js";
import { CL_RegisterSounds, type ClientSoundRegistrationHooks } from "./sound-registration.js";
import { createClientPrecacheState, type ClientRuntime, connstate_t } from "./client.js";

/**
 * Original name: N/A
 * Source: N/A (client runtime context)
 * Category: New
 * Purpose: Group the client runtime with the command and cvar runtimes it depends on for `cl_main.c` style initialization.
 *
 * Constraints:
 * - Must keep the three runtimes explicit to preserve incremental port traceability.
 */
export interface ClientMainContext {
  client: ClientRuntime;
  cmd: CommandRuntime;
  cvar: CvarRuntime;
  shutdown_in_progress: boolean;
  frame_extratime: number;
  frame_lasttimecalled: number;
  demo_file: unknown | null;
  cheatvars: Array<{ name: string; value: string; var: cvar_t | null }>;
  adr: Array<cvar_t | null>;
  cl_stereo_separation: cvar_t | null;
  cl_stereo: cvar_t | null;
  cl_add_particles: cvar_t | null;
  cl_add_lights: cvar_t | null;
  cl_add_entities: cvar_t | null;
  cl_add_blend: cvar_t | null;
  cl_noskins: cvar_t | null;
  cl_autoskins: cvar_t | null;
  cl_timeout: cvar_t | null;
  cl_predict: cvar_t | null;
  cl_maxfps: cvar_t | null;
  cl_gun: cvar_t | null;
  cl_shownet: cvar_t | null;
  cl_showmiss: cvar_t | null;
  cl_showclamp: cvar_t | null;
  cl_footsteps: cvar_t | null;
  freelook: cvar_t | null;
  lookspring: cvar_t | null;
  lookstrafe: cvar_t | null;
  sensitivity: cvar_t | null;
  m_pitch: cvar_t | null;
  m_yaw: cvar_t | null;
  m_forward: cvar_t | null;
  m_side: cvar_t | null;
  cl_lightlevel: cvar_t | null;
  info_password: cvar_t | null;
  info_spectator: cvar_t | null;
  name: cvar_t | null;
  skin: cvar_t | null;
  rate: cvar_t | null;
  fov: cvar_t | null;
  msg: cvar_t | null;
  hand: cvar_t | null;
  gender: cvar_t | null;
  gender_auto: cvar_t | null;
  cl_paused: cvar_t | null;
  cl_timedemo: cvar_t | null;
  cl_vwep: cvar_t | null;
  rcon_client_password: cvar_t | null;
  rcon_address: cvar_t | null;
}

/**
 * Original name: N/A
 * Source: N/A (host adapter hooks)
 * Category: New
 * Purpose: Describe host-side callbacks used by the partial `cl_main.c` port.
 *
 * Constraints:
 * - Must keep the runtime testable without real network or renderer shutdown code.
 */
export interface ClientMainHooks extends ClientParseHooks {
  getMilliseconds?: () => number;
  qnet?: QcommonNetRuntime | null;
  keyContext?: ClientKeyContext | null;
  fileExists?: ClientDownloadHooks["fileExists"];
  getPartialDownloadSize?: NonNullable<ClientDownloadHooks["getPartialDownloadSize"]>;
  allowDownload?: ClientPrecacheHooks["allowDownload"];
  allowDownloadMaps?: ClientPrecacheHooks["allowDownloadMaps"];
  allowDownloadModels?: ClientPrecacheHooks["allowDownloadModels"];
  allowDownloadPlayers?: ClientPrecacheHooks["allowDownloadPlayers"];
  allowDownloadSounds?: ClientPrecacheHooks["allowDownloadSounds"];
  loadBinaryFile?: ClientPrecacheHooks["loadBinaryFile"];
  getMapInfo?: ClientPrecacheHooks["getMapInfo"];
  environment?: Record<string, string>;
  isDownloading?: () => boolean;
  onDisconnect?: () => void;
  onBegin?: ClientPrecacheHooks["onBegin"];
  onBeginLoadingPlaque?: () => void;
  onEnableRemoteNetworking?: () => void;
  onPingServer?: (message: string, destination: string, kind: "broadcast" | "broadcast_ipx" | "addressbook") => void;
  onSendRcon?: (message: string, destination: string) => void;
  onServerConnectRequest?: (servername: string) => void;
  onPrepRefresh?: ClientPrecacheHooks["onPrepRefresh"];
  onPrint?: (line: string) => void;
  onAddToServerList?: (address: ReturnType<typeof createNetAdr>, info: string) => void;
  onAppActivate?: () => void;
  onEndLoadingPlaque?: () => void;
  onWriteConfigFile?: (path: string, contents: string) => boolean | void;
  onQuit?: () => void;
  onBeginSoundRegistration?: ClientSoundRegistrationHooks["onBeginRegistration"];
  onRegisterSounds?: ClientPrecacheHooks["onRegisterSounds"];
  onRegisterSound?: ClientSoundRegistrationHooks["onRegisterSound"];
  onEndSoundRegistration?: ClientSoundRegistrationHooks["onEndRegistration"];
  onSoundInit?: () => void;
  onSoundShutdown?: () => void;
  onStopAllSounds?: () => void;
  onCDAudioShutdown?: () => void;
  onShutdownLocalServer?: () => void;
  onPumpEvents?: ClientSoundRegistrationHooks["onPumpEvents"];
  onInputShutdown?: () => void;
  onInputCommands?: () => void;
  onInputFrame?: () => void;
  onConsoleInit?: () => void;
  onVideoInit?: () => void;
  onViewInit?: () => void;
  onMenuInit?: () => void;
  onScreenInit?: () => void;
  onCDAudioInit?: () => void;
  onInitLocal?: () => void;
  onInputInit?: () => void;
  onExecAutoexec?: () => void;
  onCreateDemoPath?: (path: string) => void;
  onOpenDemoFile?: (path: string) => unknown | null;
  onWriteDemoBytes?: (handle: unknown, bytes: Uint8Array) => void;
  onCloseDemoFile?: (handle: unknown) => void;
  onReadPackets?: () => void;
  onPacketParseServerMessage?: () => void;
  onNetDebugPrint?: (line: string) => void;
  onPredictMovement?: () => void;
  onSendCmd?: () => void;
  onSendKeyEvents?: () => void;
  onVideoCheckChanges?: () => void;
  onVideoShutdown?: () => void;
  onUpdateScreen?: () => void;
  onUpdateAudio?: () => void;
  onCDAudioUpdate?: () => void;
  onRunDLights?: () => void;
  onRunLightStyles?: () => void;
  onRunCinematic?: () => void;
  onRunConsole?: () => void;
  isDedicated?: () => boolean;
  hostSpeedsEnabled?: () => boolean;
  onHostSpeedTimeBeforeRef?: (milliseconds: number) => void;
  onHostSpeedTimeAfterRef?: (milliseconds: number) => void;
  logStatsEnabled?: () => boolean;
  onLogStatSample?: (line: string) => void;
  validateAddressString?: (value: string) => boolean;
  serverRunning?: () => boolean;
  getGameDir?: () => string;
}

/**
 * Original name: N/A
 * Source: N/A (client runtime context factory)
 * Category: New
 * Purpose: Create the composite context used by the ported `cl_main.c` subset.
 *
 * Constraints:
 * - Must start with unresolved cvar references before `CL_InitLocal`.
 */
export function createClientMainContext(client: ClientRuntime, cmd: CommandRuntime, cvar: CvarRuntime): ClientMainContext {
  return {
    client,
    cmd,
    cvar,
    shutdown_in_progress: false,
    frame_extratime: 0,
    frame_lasttimecalled: 0,
    demo_file: null,
    cheatvars: [
      { name: "timescale", value: "1", var: null },
      { name: "timedemo", value: "0", var: null },
      { name: "r_drawworld", value: "1", var: null },
      { name: "cl_testlights", value: "0", var: null },
      { name: "r_fullbright", value: "0", var: null },
      { name: "r_drawflat", value: "0", var: null },
      { name: "paused", value: "0", var: null },
      { name: "fixedtime", value: "0", var: null },
      { name: "sw_draworder", value: "0", var: null },
      { name: "gl_lightmap", value: "0", var: null },
      { name: "gl_saturatelighting", value: "0", var: null }
    ],
    adr: new Array<cvar_t | null>(9).fill(null),
    cl_stereo_separation: null,
    cl_stereo: null,
    cl_add_particles: null,
    cl_add_lights: null,
    cl_add_entities: null,
    cl_add_blend: null,
    cl_noskins: null,
    cl_autoskins: null,
    cl_timeout: null,
    cl_predict: null,
    cl_maxfps: null,
    cl_gun: null,
    cl_shownet: null,
    cl_showmiss: null,
    cl_showclamp: null,
    cl_footsteps: null,
    freelook: null,
    lookspring: null,
    lookstrafe: null,
    sensitivity: null,
    m_pitch: null,
    m_yaw: null,
    m_forward: null,
    m_side: null,
    cl_lightlevel: null,
    info_password: null,
    info_spectator: null,
    name: null,
    skin: null,
    rate: null,
    fov: null,
    msg: null,
    hand: null,
    gender: null,
    gender_auto: null,
    cl_paused: null,
    cl_timedemo: null,
    cl_vwep: null,
    rcon_client_password: null,
    rcon_address: null
  };
}

/**
 * Original name: CL_Skins_f
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Prints and rebuilds parsed clientinfo data for every active player skin configstring.
 *
 * Porting notes:
 * - Routes `SCR_UpdateScreen` and `Sys_SendKeyEvents` through hooks.
 */
export function CL_Skins_f(context: ClientMainContext, hooks: ClientMainHooks = {}): number {
  let count = 0;

  for (let index = 0; index < MAX_CLIENTS; index += 1) {
    const skinConfig = context.client.cl.configstrings[CS_PLAYERSKINS + index];
    if (!skinConfig) {
      continue;
    }

    hooks.onPrint?.(`client ${index}: ${skinConfig}`);
    hooks.onUpdateScreen?.();
    hooks.onSendKeyEvents?.();
    CL_ParseClientinfo(context.client, index, hooks);
    count += 1;
  }

  return count;
}

/**
 * Original name: CL_Disconnect
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Drops the current client connection state and clears level-scoped client data.
 *
 * Porting notes:
 * - Writes the stock triple `disconnect` packet when a qnet runtime is supplied.
 * - Keeps cinematic/menu/palette teardown behind host hooks until those adapters are fully owned here.
 */
export function CL_Disconnect(context: ClientMainContext, hooks: ClientMainHooks = {}): void {
  if (context.client.cls.state === connstate_t.ca_disconnected) {
    return;
  }

  if (context.client.cls.demorecording && context.demo_file) {
    CL_Stop_f(context, hooks);
  }

  if (hooks.qnet) {
    const text = "disconnect";
    const final = new Uint8Array(1 + text.length);
    final[0] = clc_ops_e.clc_stringcmd;
    for (let index = 0; index < text.length; index += 1) {
      final[index + 1] = text.charCodeAt(index) & 0xff;
    }

    Netchan_Transmit(hooks.qnet, context.client.cls.netchan, final.length, final);
    Netchan_Transmit(hooks.qnet, context.client.cls.netchan, final.length, final);
    Netchan_Transmit(hooks.qnet, context.client.cls.netchan, final.length, final);
  }

  context.client.cls.state = connstate_t.ca_disconnected;
  context.client.cls.connect_time = 0;
  context.client.cls.downloadname = "";
  context.client.cls.downloadtempname = "";
  context.client.cls.downloadnumber = 0;
  context.client.cls.downloadpercent = 0;
  context.client.cls.demorecording = false;
  context.client.cls.demowaiting = false;
  context.client.cls.precache = createClientPrecacheState();

  CL_ClearState(context.client);
  hooks.onDisconnect?.();
}

/**
 * Original name: CL_Disconnect_f
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Console-facing wrapper around `CL_Disconnect`.
 *
 * Porting notes:
 * - Reuses the shared disconnect implementation directly.
 */
export function CL_Disconnect_f(context: ClientMainContext, hooks: ClientMainHooks = {}): void {
  CL_Disconnect(context, hooks);
}

/**
 * Original name: CL_Quit_f
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Disconnects the client and requests host shutdown.
 *
 * Porting notes:
 * - Uses a hook instead of calling host-wide shutdown APIs directly.
 */
export function CL_Quit_f(context: ClientMainContext, hooks: ClientMainHooks = {}): void {
  CL_Disconnect(context, hooks);
  hooks.onQuit?.();
}

/**
 * Original name: CL_Connect_f
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Starts a new client connection attempt toward the requested server.
 *
 * Porting notes:
 * - Defers local-server shutdown and network enabling to hooks.
 * - Preserves the immediate resend timing by setting `connect_time` to `-99999`.
 */
export function CL_Connect_f(context: ClientMainContext, hooks: ClientMainHooks = {}): void {
  if (Cmd_Argc(context.cmd) !== 2) {
    hooks.onPrint?.("usage: connect <server>");
    return;
  }

  if (hooks.serverRunning?.() === true) {
    hooks.onShutdownLocalServer?.();
  } else {
    CL_Disconnect(context, hooks);
  }

  const server = Cmd_Argv(context.cmd, 1);
  hooks.onEnableRemoteNetworking?.();

  CL_Disconnect(context, hooks);

  context.client.cls.state = connstate_t.ca_connecting;
  context.client.cls.servername = server;
  context.client.cls.connect_time = -99999;
  hooks.onServerConnectRequest?.(server);
}

/**
 * Original name: CL_Rcon_f
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Builds and sends one remote-console command as an out-of-band packet.
 *
 * Porting notes:
 * - Uses the explicit qcommon net runtime for packet transport when available.
 * - Uses the current `rcon_password` and `rcon_address` cvars from the client cvar runtime.
 */
export function CL_Rcon_f(context: ClientMainContext, hooks: ClientMainHooks = {}): void {
  const password = Cvar_VariableString(context.cvar, "rcon_password");
  if (password.length === 0) {
    hooks.onPrint?.("You must set 'rcon_password' before\nissuing an rcon command.");
    return;
  }

  hooks.onEnableRemoteNetworking?.();

  const parts = ["rcon", password];
  for (let index = 1; index < Cmd_Argc(context.cmd); index += 1) {
    parts.push(Cmd_Argv(context.cmd, index));
  }
  const message = `\xff\xff\xff\xff${parts.join(" ")} `;

  const destinationAdr = createNetAdr();
  let destination = "";
  if (context.client.cls.state >= connstate_t.ca_connected) {
    destinationAdr.type = context.client.cls.netchan.remote_address.type;
    destinationAdr.ip.set(context.client.cls.netchan.remote_address.ip);
    destinationAdr.ipx.set(context.client.cls.netchan.remote_address.ipx);
    destinationAdr.port = context.client.cls.netchan.remote_address.port;
    destination = NET_AdrToString(destinationAdr);
  } else {
    destination = Cvar_VariableString(context.cvar, "rcon_address");
    if (destination.length === 0) {
      hooks.onPrint?.("You must either be connected,\nor set the 'rcon_address' cvar\nto issue rcon commands");
      return;
    }
    if (hooks.qnet && !NET_StringToAdr(destination, destinationAdr)) {
      hooks.onPrint?.(`Bad address: ${destination}`);
      return;
    }
    if (destinationAdr.port === 0) {
      destinationAdr.port = PORT_SERVER;
    }
  }

  if (hooks.qnet) {
    const packet = new Uint8Array(message.length + 1);
    for (let index = 0; index < message.length; index += 1) {
      packet[index] = message.charCodeAt(index) & 0xff;
    }
    NET_SendPacket(hooks.qnet, netsrc_t.NS_CLIENT, packet.length, packet, destinationAdr);
  }
  hooks.onSendRcon?.(message, destination);
}

/**
 * Original name: CL_PingServers_f
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Broadcasts Quake II `info` probes and pings every populated address-book entry.
 *
 * Porting notes:
 * - Uses the explicit qcommon net runtime for packet emission when available.
 * - Recreates the original `noudp`, `noipx` and `adr0..adr15` cvar usage locally.
 */
export function CL_PingServers_f(context: ClientMainContext, hooks: ClientMainHooks = {}): void {
  hooks.onEnableRemoteNetworking?.();
  hooks.onPrint?.("pinging broadcast...");

  const noudp = Cvar_Get(context.cvar, "noudp", "0", CVAR_NOSET);
  if (!noudp?.value) {
    if (hooks.qnet) {
      const adr = createNetAdr(netadrtype_t.NA_BROADCAST);
      adr.port = PORT_SERVER;
      Netchan_OutOfBandPrint(hooks.qnet, netsrc_t.NS_CLIENT, adr, `info ${PROTOCOL_VERSION}`);
    }
    hooks.onPingServer?.(`info ${PROTOCOL_VERSION}`, "broadcast", "broadcast");
  }

  const noipx = Cvar_Get(context.cvar, "noipx", "0", CVAR_NOSET);
  if (!noipx?.value) {
    if (hooks.qnet) {
      const adr = createNetAdr(netadrtype_t.NA_BROADCAST_IPX);
      adr.port = PORT_SERVER;
      Netchan_OutOfBandPrint(hooks.qnet, netsrc_t.NS_CLIENT, adr, `info ${PROTOCOL_VERSION}`);
    }
    hooks.onPingServer?.(`info ${PROTOCOL_VERSION}`, "broadcast_ipx", "broadcast_ipx");
  }

  for (let index = 0; index < 16; index += 1) {
    const cvarName = `adr${index}`;
    const address = Cvar_VariableString(context.cvar, cvarName);
    if (address.length === 0) {
      continue;
    }

    hooks.onPrint?.(`pinging ${address}...`);
    const adr = createNetAdr();
    const validAddress = hooks.qnet ? NET_StringToAdr(address, adr) : hooks.validateAddressString?.(address) !== false;
    if (!validAddress) {
      hooks.onPrint?.(`Bad address: ${address}`);
      continue;
    }
    if (adr.port === 0) {
      adr.port = PORT_SERVER;
    }

    if (hooks.qnet) {
      Netchan_OutOfBandPrint(hooks.qnet, netsrc_t.NS_CLIENT, adr, `info ${PROTOCOL_VERSION}`);
    }
    hooks.onPingServer?.(`info ${PROTOCOL_VERSION}`, address, "addressbook");
  }
}

/**
 * Original name: CL_Userinfo_f
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Prints the current Quake II userinfo string in a readable key/value layout.
 *
 * Porting notes:
 * - Reuses the ported `Cvar_Userinfo` and `Info_Print` helpers.
 */
export function CL_Userinfo_f(context: ClientMainContext, hooks: ClientMainHooks = {}): string[] {
  const lines = ["User info settings:", ...Info_Print(Cvar_Userinfo(context.cvar))];
  for (const line of lines) {
    hooks.onPrint?.(line);
  }
  return lines;
}

/**
 * Original name: Cmd_ForwardToServer
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Forwards the full current command line to the server string-command channel.
 *
 * Porting notes:
 * - Keeps the original early rejection for local-only `+` and `-` commands.
 */
export function Cmd_ForwardToServer(context: ClientMainContext, hooks: ClientMainHooks = {}): void {
  const command = Cmd_Argv(context.cmd, 0);
  if (context.client.cls.state <= connstate_t.ca_connected || command.startsWith("-") || command.startsWith("+")) {
    hooks.onPrint?.(`Unknown command "${command}"`);
    return;
  }

  let text = command;
  const args = Cmd_Args(context.cmd);
  if (args.length > 0) {
    text += ` ${args}`;
  }

  CL_WriteStringCmd(context.client, text);
}

/**
 * Original name: CL_Setenv_f
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Sets or prints one environment variable from the console command path.
 *
 * Porting notes:
 * - Uses a hook-owned environment dictionary instead of process-wide `putenv`.
 */
export function CL_Setenv_f(context: ClientMainContext, hooks: ClientMainHooks = {}): void {
  const argc = Cmd_Argc(context.cmd);

  if (argc > 2) {
    const key = Cmd_Argv(context.cmd, 1);
    const parts: string[] = [];
    for (let index = 2; index < argc; index += 1) {
      parts.push(Cmd_Argv(context.cmd, index));
    }

    if (hooks.environment) {
      hooks.environment[key] = `${parts.join(" ")} `;
    }
    return;
  }

  if (argc === 2) {
    const key = Cmd_Argv(context.cmd, 1);
    const value = hooks.environment?.[key];
    if (value !== undefined) {
      hooks.onPrint?.(`${key}=${value}`);
    } else {
      hooks.onPrint?.(`${key} undefined`);
    }
  }
}

/**
 * Original name: CL_Changing_f
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Moves the client back to a loading/connected state during a server map change.
 *
 * Porting notes:
 * - Defers the loading-plaque UI effect to a host hook.
 */
export function CL_Changing_f(context: ClientMainContext, hooks: ClientMainHooks = {}): void {
  if (hooks.isDownloading?.() === true) {
    return;
  }

  hooks.onBeginLoadingPlaque?.();
  context.client.cls.state = connstate_t.ca_connected;
  hooks.onPrint?.("\nChanging map...");
}

/**
 * Original name: CL_Snd_Restart_f
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Restarts the sound subsystem and then re-registers client sounds.
 *
 * Porting notes:
 * - Defers concrete sound backend shutdown/init to hooks.
 */
export function CL_Snd_Restart_f(context: ClientMainContext, hooks: ClientMainHooks = {}): void {
  hooks.onSoundShutdown?.();
  hooks.onSoundInit?.();
  CL_RegisterSounds(context.client, {
    ...(hooks.onBeginSoundRegistration ? { onBeginRegistration: hooks.onBeginSoundRegistration } : {}),
    ...(hooks.onRegisterSound ? { onRegisterSound: hooks.onRegisterSound } : {}),
    ...(hooks.onEndSoundRegistration ? { onEndRegistration: hooks.onEndSoundRegistration } : {}),
    ...(hooks.onPumpEvents ? { onPumpEvents: hooks.onPumpEvents } : {})
  });
  hooks.onRegisterSounds?.();
}

/**
 * Original name: CL_FixUpGender
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Auto-selects the userinfo `gender` from the current skin when `gender_auto` is enabled.
 *
 * Porting notes:
 * - Preserves the original "manual override wins once" rule through the cvar `modified` flag.
 */
export function CL_FixUpGender(context: ClientMainContext): void {
  if ((context.gender_auto?.value ?? 0) === 0 || !context.gender || !context.skin) {
    return;
  }

  if (context.gender.modified) {
    context.gender.modified = false;
    return;
  }

  const slash = context.skin.string.indexOf("/");
  const skinPrefix = (slash >= 0 ? context.skin.string.slice(0, slash) : context.skin.string).toLowerCase();

  if (skinPrefix === "male" || skinPrefix === "cyborg") {
    Cvar_Set(context.cvar, "gender", "male");
  } else if (skinPrefix === "female" || skinPrefix === "crackhor") {
    Cvar_Set(context.cvar, "gender", "female");
  } else {
    Cvar_Set(context.cvar, "gender", "none");
  }

  context.gender.modified = false;
}

/**
 * Original name: CL_SendConnectPacket
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Builds and sends the Quake II out-of-band `connect` packet after a server challenge.
 *
 * Porting notes:
 * - Uses the explicit qcommon net runtime instead of socket globals.
 */
export function CL_SendConnectPacket(context: ClientMainContext, hooks: ClientMainHooks = {}): boolean {
  const adr = createNetAdr();
  if (!NET_StringToAdr(context.client.cls.servername, adr)) {
    hooks.onPrint?.("Bad server address");
    context.client.cls.connect_time = 0;
    return false;
  }

  if (adr.port === 0) {
    adr.port = PORT_SERVER;
  }

  hooks.onEnableRemoteNetworking?.();
  context.cvar.userinfo_modified = false;

  if (hooks.qnet) {
    Netchan_OutOfBandPrint(
      hooks.qnet,
      netsrc_t.NS_CLIENT,
      adr,
      `connect ${PROTOCOL_VERSION} ${hooks.qnet.qport} ${context.client.cls.challenge} "${Cvar_Userinfo(context.cvar)}"\n`
    );
  }

  return true;
}

/**
 * Original name: CL_CheckForResend
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Advances the client connection retry logic, including local-server fast-path connects.
 *
 * Porting notes:
 * - Uses the explicit qcommon net runtime instead of socket globals.
 */
export function CL_CheckForResend(context: ClientMainContext, hooks: ClientMainHooks = {}): void {
  const cls = context.client.cls;

  if (cls.state === connstate_t.ca_disconnected && hooks.serverRunning?.() === true) {
    cls.state = connstate_t.ca_connecting;
    cls.servername = "localhost";
    CL_SendConnectPacket(context, hooks);
    return;
  }

  if (cls.state !== connstate_t.ca_connecting) {
    return;
  }

  if (cls.realtime - cls.connect_time < 3000) {
    return;
  }

  const adr = createNetAdr();
  if (!NET_StringToAdr(cls.servername, adr)) {
    hooks.onPrint?.("Bad server address");
    cls.state = connstate_t.ca_disconnected;
    return;
  }

  if (adr.port === 0) {
    adr.port = PORT_SERVER;
  }

  cls.connect_time = cls.realtime;
  hooks.onEnableRemoteNetworking?.();
  hooks.onPrint?.(`Connecting to ${cls.servername}...`);

  if (hooks.qnet) {
    Netchan_OutOfBandPrint(hooks.qnet, netsrc_t.NS_CLIENT, adr, "getchallenge\n");
  }
}

/**
 * Original name: CL_Drop
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Drops the current client connection and ends the loading plaque when appropriate.
 *
 * Porting notes:
 * - Defers the loading-plaque teardown side effect to a hook.
 */
export function CL_Drop(context: ClientMainContext, hooks: ClientMainHooks = {}): void {
  if (context.client.cls.state === connstate_t.ca_uninitialized || context.client.cls.state === connstate_t.ca_disconnected) {
    return;
  }

  CL_Disconnect(context, hooks);

  if (context.client.cls.disable_servercount !== -1) {
    hooks.onEndLoadingPlaque?.();
  }
}

/**
 * Original name: CL_ParseStatusMessage
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Reads one status response string and forwards it to the server-list consumer.
 *
 * Porting notes:
 * - Uses explicit message/address runtimes instead of file-static globals.
 */
export function CL_ParseStatusMessage(context: ClientMainContext, hooks: ClientMainHooks = {}): string {
  const message = hooks.qnet?.net_message ?? context.client.net_message;
  const from = hooks.qnet?.net_from ?? createNetAdr();
  const status = MSG_ReadString(message);

  hooks.onPrint?.(status);
  hooks.onAddToServerList?.(from, status);
  return status;
}

/**
 * Original name: CL_ConnectionlessPacket
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Dispatches one connectionless client packet such as `info`, `print`, `ping` or `challenge`.
 *
 * Porting notes:
 * - Uses hooks for UI- and platform-facing side effects while preserving source dispatch order.
 */
export function CL_ConnectionlessPacket(context: ClientMainContext, hooks: ClientMainHooks = {}): string {
  const message = hooks.qnet?.net_message ?? context.client.net_message;
  const from = hooks.qnet?.net_from ?? createNetAdr();

  MSG_BeginReading(message);
  MSG_ReadLong(message);

  const line = MSG_ReadStringLine(message);
  Cmd_TokenizeString(context.cmd, line, false);

  const command = Cmd_Argv(context.cmd, 0);
  hooks.onPrint?.(`${NET_AdrToString(from)}: ${command}`);

  if (command === "client_connect") {
    if (context.client.cls.state === connstate_t.ca_connected) {
      hooks.onPrint?.("Dup connect received.  Ignored.");
      return command;
    }

    if (hooks.qnet) {
      Netchan_Setup(hooks.qnet, netsrc_t.NS_CLIENT, context.client.cls.netchan, from, hooks.qnet.qport);
    }
    CL_WriteStringCmd(context.client, "new");
    context.client.cls.state = connstate_t.ca_connected;
    return command;
  }

  if (command === "info") {
    CL_ParseStatusMessage(context, hooks);
    return command;
  }

  if (command === "cmd") {
    if (!NET_IsLocalAddress(from)) {
      hooks.onPrint?.("Command packet from remote host.  Ignored.");
      return command;
    }

    hooks.onAppActivate?.();
    const text = MSG_ReadString(message);
    Cbuf_AddText(context.cmd, text);
    Cbuf_AddText(context.cmd, "\n");
    return command;
  }

  if (command === "print") {
    hooks.onPrint?.(MSG_ReadString(message));
    return command;
  }

  if (command === "ping") {
    if (hooks.qnet) {
      Netchan_OutOfBandPrint(hooks.qnet, netsrc_t.NS_CLIENT, from, "ack");
    }
    return command;
  }

  if (command === "challenge") {
    context.client.cls.challenge = Number.parseInt(Cmd_Argv(context.cmd, 1), 10) || 0;
    CL_SendConnectPacket(context, hooks);
    return command;
  }

  if (command === "echo") {
    if (hooks.qnet) {
      Netchan_OutOfBandPrint(hooks.qnet, netsrc_t.NS_CLIENT, from, Cmd_Argv(context.cmd, 1));
    }
    return command;
  }

  hooks.onPrint?.("Unknown command.");
  return command;
}

/**
 * Original name: CL_FixCvarCheats
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Forces a fixed set of multiplayer cheat-sensitive cvars back to their stock values.
 *
 * Porting notes:
 * - Caches resolved cvar handles in the main context instead of file-static globals.
 */
export function CL_FixCvarCheats(context: ClientMainContext): void {
  const maxClients = context.client.cl.configstrings[CS_MAXCLIENTS] ?? "";
  if (maxClients === "1" || maxClients.length === 0) {
    return;
  }

  for (const cheatvar of context.cheatvars) {
    cheatvar.var ??= Cvar_Get(context.cvar, cheatvar.name, cheatvar.value, 0);
  }

  for (const cheatvar of context.cheatvars) {
    if (cheatvar.var && cheatvar.var.string !== cheatvar.value) {
      Cvar_Set(context.cvar, cheatvar.name, cheatvar.value);
    }
  }
}

/**
 * Original name: CL_SendCommand
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Polls input events, executes queued commands, fixes cheat cvars, sends the current usercmd and retries connects.
 *
 * Porting notes:
 * - Uses hooks for host input polling and cross-file `CL_SendCmd` integration.
 */
export function CL_SendCommand(context: ClientMainContext, hooks: ClientMainHooks = {}): void {
  hooks.onSendKeyEvents?.();
  hooks.onInputCommands?.();
  Cbuf_Execute(context.cmd);
  CL_FixCvarCheats(context);
  hooks.onSendCmd?.();
  CL_CheckForResend(context, hooks);
}

/**
 * Original name: CL_Frame
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Advances one client frame with the original timing gates and subsystem call order.
 *
 * Porting notes:
 * - Delegates subsystem work to hooks while preserving the source-level frame scheduler.
 */
export function CL_Frame(context: ClientMainContext, msec: number, hooks: ClientMainHooks = {}): boolean {
  if (hooks.isDedicated?.() === true) {
    return false;
  }

  context.frame_extratime += msec;

  if ((context.cl_timedemo?.value ?? 0) === 0) {
    if (context.client.cls.state === connstate_t.ca_connected && context.frame_extratime < 100) {
      return false;
    }

    const maxfps = context.cl_maxfps?.value ?? 90;
    if (maxfps > 0 && context.frame_extratime < 1000 / maxfps) {
      return false;
    }
  }

  hooks.onInputFrame?.();

  context.client.cls.frametime = context.frame_extratime / 1000.0;
  context.client.cl.time += context.frame_extratime;
  if (hooks.getMilliseconds) {
    context.client.cls.realtime = hooks.getMilliseconds();
  }

  context.frame_extratime = 0;

  if (context.client.cls.frametime > (1.0 / 5)) {
    context.client.cls.frametime = 1.0 / 5;
  }

  if (msec > 5000 && hooks.getMilliseconds) {
    context.client.cls.netchan.last_received = hooks.getMilliseconds();
  }

  hooks.onReadPackets?.();
  CL_SendCommand(context, hooks);
  hooks.onPredictMovement?.();
  hooks.onVideoCheckChanges?.();

  if (!context.client.cl.refresh_prepped && context.client.cls.state === connstate_t.ca_active) {
    hooks.onPrepRefresh?.();
  }

  if (hooks.hostSpeedsEnabled?.() === true && hooks.getMilliseconds) {
    hooks.onHostSpeedTimeBeforeRef?.(hooks.getMilliseconds());
  }
  hooks.onUpdateScreen?.();
  if (hooks.hostSpeedsEnabled?.() === true && hooks.getMilliseconds) {
    hooks.onHostSpeedTimeAfterRef?.(hooks.getMilliseconds());
  }

  hooks.onUpdateAudio?.();
  hooks.onCDAudioUpdate?.();
  hooks.onRunDLights?.();
  hooks.onRunLightStyles?.();
  hooks.onRunCinematic?.();
  hooks.onRunConsole?.();

  context.client.cls.framecount += 1;

  if (hooks.logStatsEnabled?.() === true && context.client.cls.state === connstate_t.ca_active && hooks.getMilliseconds) {
    if (context.frame_lasttimecalled === 0) {
      context.frame_lasttimecalled = hooks.getMilliseconds();
      hooks.onLogStatSample?.("0");
    } else {
      const now = hooks.getMilliseconds();
      hooks.onLogStatSample?.(`${now - context.frame_lasttimecalled}`);
      context.frame_lasttimecalled = now;
    }
  }

  return true;
}

/**
 * Original name: CL_Init
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes the client-side subsystems in the original high-level order.
 *
 * Porting notes:
 * - Delegates subsystem setup to hooks while preserving the source ordering and bootstrap side effects.
 */
export function CL_Init(context: ClientMainContext, hooks: ClientMainHooks = {}): boolean {
  if (hooks.isDedicated?.() === true) {
    return false;
  }

  hooks.onConsoleInit?.();
  hooks.onVideoInit?.();
  hooks.onSoundInit?.();
  hooks.onViewInit?.();

  context.client.net_message.readcount = 0;
  context.client.net_message.cursize = 0;

  hooks.onMenuInit?.();
  hooks.onScreenInit?.();
  context.client.cls.disable_screen = 1;
  hooks.onCDAudioInit?.();
  hooks.onInitLocal?.();
  hooks.onInputInit?.();
  hooks.onExecAutoexec?.();
  Cbuf_Execute(context.cmd);
  return true;
}

/**
 * Original name: CL_WriteDemoMessage
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Writes the current network message minus its sequencing header into the active demo file.
 *
 * Porting notes:
 * - Uses hook-based binary IO instead of direct stdio writes.
 */
export function CL_WriteDemoMessage(context: ClientMainContext, hooks: ClientMainHooks = {}): Uint8Array | null {
  if (!context.demo_file || !hooks.onWriteDemoBytes) {
    return null;
  }

  const len = context.client.net_message.cursize - 8;
  if (len < 0) {
    return null;
  }

  const chunk = new Uint8Array(4 + len);
  setLittleLong(chunk, 0, LittleLong(len));
  chunk.set(context.client.net_message.data.subarray(8, 8 + len), 4);
  hooks.onWriteDemoBytes(context.demo_file, chunk);
  return chunk;
}

/**
 * Original name: CL_Stop_f
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Stops demo recording by appending the end marker and closing the file.
 *
 * Porting notes:
 * - Uses hook-based binary IO instead of direct stdio writes.
 */
export function CL_Stop_f(context: ClientMainContext, hooks: ClientMainHooks = {}): boolean {
  if (!context.client.cls.demorecording || !context.demo_file) {
    hooks.onPrint?.("Not recording a demo.");
    return false;
  }

  if (hooks.onWriteDemoBytes) {
    const marker = new Uint8Array(4);
    setLittleLong(marker, 0, -1);
    hooks.onWriteDemoBytes(context.demo_file, marker);
  }

  hooks.onCloseDemoFile?.(context.demo_file);
  context.demo_file = null;
  context.client.cls.demorecording = false;
  hooks.onPrint?.("Stopped demo.");
  return true;
}

/**
 * Original name: CL_Record_f
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Starts demo recording and writes the startup packets required to replay the current level state.
 *
 * Porting notes:
 * - Uses hook-based binary IO and path handling instead of direct stdio/filesystem calls.
 */
export function CL_Record_f(context: ClientMainContext, hooks: ClientMainHooks = {}): { path: string; chunks: number } | null {
  if (Cmd_Argc(context.cmd) !== 2) {
    hooks.onPrint?.("record <demoname>");
    return null;
  }

  if (context.client.cls.demorecording) {
    hooks.onPrint?.("Already recording.");
    return null;
  }

  if (context.client.cls.state !== connstate_t.ca_active) {
    hooks.onPrint?.("You must be in a level to record.");
    return null;
  }

  const path = `${hooks.getGameDir?.() ?? "baseq2"}/demos/${Cmd_Argv(context.cmd, 1)}.dm2`;
  hooks.onPrint?.(`recording to ${path}.`);
  hooks.onCreateDemoPath?.(path);

  const handle = hooks.onOpenDemoFile?.(path) ?? null;
  if (!handle) {
    hooks.onPrint?.("ERROR: couldn't open.");
    return null;
  }

  context.demo_file = handle;
  context.client.cls.demorecording = true;
  context.client.cls.demowaiting = true;

  const buf = createSizeBuffer(new Uint8Array(1400));
  let chunks = 0;
  const flushBuffer = (): void => {
    if (!context.demo_file || !hooks.onWriteDemoBytes || buf.cursize === 0) {
      return;
    }

    const chunk = new Uint8Array(4 + buf.cursize);
    setLittleLong(chunk, 0, LittleLong(buf.cursize));
    chunk.set(buf.data.subarray(0, buf.cursize), 4);
    hooks.onWriteDemoBytes(context.demo_file, chunk);
    buf.cursize = 0;
    chunks += 1;
  };

  MSG_WriteByte(buf, svc_ops_e.svc_serverdata);
  MSG_WriteLong(buf, PROTOCOL_VERSION);
  MSG_WriteLong(buf, 0x10000 + context.client.cl.servercount);
  MSG_WriteByte(buf, 1);
  MSG_WriteString(buf, context.client.cl.gamedir);
  MSG_WriteShort(buf, context.client.cl.playernum);
  MSG_WriteString(buf, context.client.cl.configstrings[CS_NAME]);

  for (let index = 0; index < MAX_CONFIGSTRINGS; index += 1) {
    const config = context.client.cl.configstrings[index] ?? "";
    if (config.length === 0) {
      continue;
    }

    if (buf.cursize + config.length + 32 > buf.maxsize) {
      flushBuffer();
    }

    MSG_WriteByte(buf, svc_ops_e.svc_configstring);
    MSG_WriteShort(buf, index);
    MSG_WriteString(buf, config);
  }

  const nullstate = createEntityState();
  for (const entity of context.client.cl_entities) {
    if (!entity.baseline.modelindex) {
      continue;
    }

    if (buf.cursize + 64 > buf.maxsize) {
      flushBuffer();
    }

    MSG_WriteByte(buf, svc_ops_e.svc_spawnbaseline);
    MSG_WriteDeltaEntity(nullstate, entity.baseline, buf, true, true);
  }

  MSG_WriteByte(buf, svc_ops_e.svc_stufftext);
  MSG_WriteString(buf, "precache\n");
  flushBuffer();

  return { path, chunks };
}

/**
 * Original name: CL_Packet_f
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Sends one raw out-of-band packet with optional `\n` escapes in the payload.
 *
 * Porting notes:
 * - Uses the explicit qcommon net runtime instead of socket globals.
 */
export function CL_Packet_f(context: ClientMainContext, hooks: ClientMainHooks = {}): Uint8Array | null {
  if (Cmd_Argc(context.cmd) !== 3) {
    hooks.onPrint?.("packet <destination> <contents>");
    return null;
  }

  if (!hooks.qnet) {
    return null;
  }

  hooks.onEnableRemoteNetworking?.();
  NET_Config(hooks.qnet, true);

  const adr = createNetAdr();
  if (!NET_StringToAdr(Cmd_Argv(context.cmd, 1), adr)) {
    hooks.onPrint?.("Bad address");
    return null;
  }
  if (adr.port === 0) {
    adr.port = PORT_SERVER;
  }

  const input = Cmd_Argv(context.cmd, 2);
  const translated: number[] = [0xff, 0xff, 0xff, 0xff];
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] === "\\" && input[index + 1] === "n") {
      translated.push(10);
      index += 1;
    } else {
      translated.push(input.charCodeAt(index) & 0xff);
    }
  }
  translated.push(0);

  const packet = Uint8Array.from(translated);
  NET_SendPacket(hooks.qnet, netsrc_t.NS_CLIENT, packet.length, packet, adr);
  return packet;
}

/**
 * Original name: CL_DumpPackets
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Drains and logs every pending client packet.
 *
 * Porting notes:
 * - Uses the explicit qcommon net runtime instead of socket globals.
 */
export function CL_DumpPackets(context: ClientMainContext, hooks: ClientMainHooks = {}): number {
  if (!hooks.qnet) {
    return 0;
  }

  let count = 0;
  while (NET_GetPacket(hooks.qnet, netsrc_t.NS_CLIENT, hooks.qnet.net_from, hooks.qnet.net_message)) {
    hooks.onPrint?.("dumnping a packet");
    count += 1;
  }
  return count;
}

/**
 * Original name: CL_ReadPackets
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Pulls pending network packets, dispatches connectionless messages, parses sequenced server packets and checks timeout.
 *
 * Porting notes:
 * - Uses the explicit qcommon net runtime instead of socket globals.
 */
export function CL_ReadPackets(context: ClientMainContext, hooks: ClientMainHooks = {}): number {
  if (!hooks.qnet) {
    return 0;
  }

  let processed = 0;
  while (NET_GetPacket(hooks.qnet, netsrc_t.NS_CLIENT, hooks.qnet.net_from, hooks.qnet.net_message)) {
    processed += 1;

    if (new DataView(hooks.qnet.net_message.data.buffer, hooks.qnet.net_message.data.byteOffset, 4).getInt32(0, true) === -1) {
      CL_ConnectionlessPacket(context, hooks);
      continue;
    }

    if (context.client.cls.state === connstate_t.ca_disconnected || context.client.cls.state === connstate_t.ca_connecting) {
      continue;
    }

    if (hooks.qnet.net_message.cursize < 8) {
      hooks.onPrint?.(`${NET_AdrToString(hooks.qnet.net_from)}: Runt packet`);
      continue;
    }

    if (!NET_CompareAdr(hooks.qnet.net_from, context.client.cls.netchan.remote_address)) {
      hooks.onNetDebugPrint?.(`${NET_AdrToString(hooks.qnet.net_from)}:sequenced packet without connection`);
      continue;
    }

    if (!Netchan_Process(hooks.qnet, context.client.cls.netchan, hooks.qnet.net_message)) {
      continue;
    }

    if (hooks.onPacketParseServerMessage) {
      hooks.onPacketParseServerMessage();
    } else {
      context.client.net_message.data.set(hooks.qnet.net_message.data.subarray(0, hooks.qnet.net_message.cursize), 0);
      context.client.net_message.cursize = hooks.qnet.net_message.cursize;
      context.client.net_message.readcount = hooks.qnet.net_message.readcount;
      context.client.net_message.overflowed = hooks.qnet.net_message.overflowed;
      CL_ParseServerMessage(context.client, {
        ...hooks,
        getShownet: hooks.getShownet ?? (() => context.cl_shownet?.value ?? 0)
      });
    }
  }

  if (
    context.client.cls.state >= connstate_t.ca_connected
    && context.client.cls.realtime - context.client.cls.netchan.last_received > (context.cl_timeout?.value ?? 120) * 1000
  ) {
    context.client.cl.timeoutcount += 1;
    if (context.client.cl.timeoutcount > 5) {
      hooks.onPrint?.("\nServer connection timed out.");
      CL_Disconnect(context, hooks);
    }
  } else {
    context.client.cl.timeoutcount = 0;
  }

  return processed;
}

/**
 * Original name: CL_WriteConfiguration
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Serializes key bindings and archived cvars to `config.cfg`.
 *
 * Porting notes:
 * - Delegates path resolution and concrete file IO to hooks instead of direct filesystem globals.
 */
export function CL_WriteConfiguration(context: ClientMainContext, hooks: ClientMainHooks = {}): { path: string; contents: string } | null {
  if (context.client.cls.state === connstate_t.ca_uninitialized) {
    return null;
  }

  const gamedir = hooks.getGameDir?.() ?? "baseq2";
  const path = `${gamedir}/config.cfg`;
  let contents = "// generated by quake, do not modify\n";

  if (hooks.keyContext) {
    Key_WriteBindings(hooks.keyContext, {
      write: (chunk) => {
        contents += chunk;
      }
    });
  }

  contents += Cvar_WriteVariables(context.cvar);
  const written = hooks.onWriteConfigFile?.(path, contents);
  if (written === false) {
    hooks.onPrint?.("Couldn't write config.cfg.");
    return null;
  }

  return { path, contents };
}

/**
 * Original name: CL_Shutdown
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Writes client configuration and shuts down attached audio, input and video backends once.
 *
 * Porting notes:
 * - Uses hooks in place of platform-global backend shutdown calls.
 */
export function CL_Shutdown(context: ClientMainContext, hooks: ClientMainHooks = {}): void {
  if (context.shutdown_in_progress) {
    hooks.onPrint?.("recursive shutdown");
    return;
  }

  context.shutdown_in_progress = true;
  CL_WriteConfiguration(context, hooks);
  hooks.onCDAudioShutdown?.();
  hooks.onSoundShutdown?.();
  hooks.onInputShutdown?.();
  hooks.onVideoShutdown?.();
}

/**
 * Original name: CL_InitLocal
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Registers the first client-side cvars and console commands needed by the local client runtime.
 *
 * Porting notes:
 * - Focuses on the cvars already consumed by the current client ports.
 */
export function CL_InitLocal(context: ClientMainContext, hooks: ClientMainHooks = {}): void {
  const downloadHooks: ClientDownloadHooks = {
    ...(hooks.fileExists ? { fileExists: hooks.fileExists } : {}),
    ...(hooks.getPartialDownloadSize ? { getPartialDownloadSize: hooks.getPartialDownloadSize } : {}),
    ...(hooks.onPrint ? { onPrint: hooks.onPrint } : {})
  };
  const precacheHooks: ClientPrecacheHooks = {
    ...downloadHooks,
    ...(hooks.allowDownload !== undefined ? { allowDownload: hooks.allowDownload } : {}),
    ...(hooks.allowDownloadMaps !== undefined ? { allowDownloadMaps: hooks.allowDownloadMaps } : {}),
    ...(hooks.allowDownloadModels !== undefined ? { allowDownloadModels: hooks.allowDownloadModels } : {}),
    ...(hooks.allowDownloadPlayers !== undefined ? { allowDownloadPlayers: hooks.allowDownloadPlayers } : {}),
    ...(hooks.allowDownloadSounds !== undefined ? { allowDownloadSounds: hooks.allowDownloadSounds } : {}),
    ...(hooks.loadBinaryFile ? { loadBinaryFile: hooks.loadBinaryFile } : {}),
    ...(hooks.getMapInfo ? { getMapInfo: hooks.getMapInfo } : {}),
    ...(hooks.onPrepRefresh ? { onPrepRefresh: hooks.onPrepRefresh } : {}),
    ...(hooks.onRegisterSounds ? { onRegisterSounds: hooks.onRegisterSounds } : {}),
    ...(hooks.onBegin ? { onBegin: hooks.onBegin } : {})
  };

  context.client.cls.state = connstate_t.ca_disconnected;
  if (hooks.getMilliseconds) {
    context.client.cls.realtime = hooks.getMilliseconds();
  }
  if (hooks.qnet) {
    Netchan_Init(hooks.qnet, context.cvar);
  }

  for (let index = 0; index < context.adr.length; index += 1) {
    context.adr[index] = Cvar_Get(context.cvar, `adr${index}`, "", CVAR_ARCHIVE);
  }

  context.cl_stereo_separation = Cvar_Get(context.cvar, "cl_stereo_separation", "0.4", CVAR_ARCHIVE);
  context.cl_stereo = Cvar_Get(context.cvar, "cl_stereo", "0", 0);
  context.cl_add_blend = Cvar_Get(context.cvar, "cl_blend", "1", 0);
  context.cl_add_lights = Cvar_Get(context.cvar, "cl_lights", "1", 0);
  context.cl_add_particles = Cvar_Get(context.cvar, "cl_particles", "1", 0);
  context.cl_add_entities = Cvar_Get(context.cvar, "cl_entities", "1", 0);
  context.cl_noskins = Cvar_Get(context.cvar, "cl_noskins", "0", 0);
  context.cl_autoskins = Cvar_Get(context.cvar, "cl_autoskins", "0", 0);
  context.cl_predict = Cvar_Get(context.cvar, "cl_predict", "1", 0);
  context.cl_maxfps = Cvar_Get(context.cvar, "cl_maxfps", "90", 0);
  context.cl_gun = Cvar_Get(context.cvar, "cl_gun", "1", 0);
  context.cl_shownet = Cvar_Get(context.cvar, "cl_shownet", "0", 0);
  context.cl_showmiss = Cvar_Get(context.cvar, "cl_showmiss", "0", 0);
  context.cl_showclamp = Cvar_Get(context.cvar, "showclamp", "0", 0);
  context.cl_timeout = Cvar_Get(context.cvar, "cl_timeout", "120", 0);
  context.cl_footsteps = Cvar_Get(context.cvar, "cl_footsteps", "1", 0);
  context.freelook = Cvar_Get(context.cvar, "freelook", "0", CVAR_ARCHIVE);
  context.lookspring = Cvar_Get(context.cvar, "lookspring", "0", CVAR_ARCHIVE);
  context.lookstrafe = Cvar_Get(context.cvar, "lookstrafe", "0", CVAR_ARCHIVE);
  context.sensitivity = Cvar_Get(context.cvar, "sensitivity", "3", CVAR_ARCHIVE);
  context.m_pitch = Cvar_Get(context.cvar, "m_pitch", "0.022", CVAR_ARCHIVE);
  context.m_yaw = Cvar_Get(context.cvar, "m_yaw", "0.022", 0);
  context.m_forward = Cvar_Get(context.cvar, "m_forward", "1", 0);
  context.m_side = Cvar_Get(context.cvar, "m_side", "1", 0);
  context.cl_lightlevel = Cvar_Get(context.cvar, "r_lightlevel", "0", 0);
  context.info_password = Cvar_Get(context.cvar, "password", "", CVAR_USERINFO);
  context.info_spectator = Cvar_Get(context.cvar, "spectator", "0", CVAR_USERINFO);
  context.name = Cvar_Get(context.cvar, "name", "unnamed", CVAR_USERINFO | CVAR_ARCHIVE);
  context.skin = Cvar_Get(context.cvar, "skin", "male/grunt", CVAR_USERINFO | CVAR_ARCHIVE);
  context.rate = Cvar_Get(context.cvar, "rate", "25000", CVAR_USERINFO | CVAR_ARCHIVE);
  context.msg = Cvar_Get(context.cvar, "msg", "1", CVAR_USERINFO | CVAR_ARCHIVE);
  context.hand = Cvar_Get(context.cvar, "hand", "0", CVAR_USERINFO | CVAR_ARCHIVE);
  context.fov = Cvar_Get(context.cvar, "fov", "90", CVAR_USERINFO | CVAR_ARCHIVE);
  context.gender = Cvar_Get(context.cvar, "gender", "male", CVAR_USERINFO | CVAR_ARCHIVE);
  context.gender_auto = Cvar_Get(context.cvar, "gender_auto", "1", CVAR_ARCHIVE);
  context.cl_paused = Cvar_Get(context.cvar, "paused", "0", 0);
  context.cl_timedemo = Cvar_Get(context.cvar, "timedemo", "0", 0);
  context.cl_vwep = Cvar_Get(context.cvar, "cl_vwep", "1", CVAR_ARCHIVE);
  context.rcon_client_password = Cvar_Get(context.cvar, "rcon_password", "", 0);
  context.rcon_address = Cvar_Get(context.cvar, "rcon_address", "", 0);
  context.client.cl.cl_footsteps = ((context.cl_footsteps?.value) ?? 1) !== 0;
  context.client.cl.hand = context.hand?.value ?? 0;
  if (context.gender) {
    context.gender.modified = false;
  }

  registerCommand(context.cmd, "skins", () => {
    CL_Skins_f(context, hooks);
  });
  registerCommand(context.cmd, "cmd", () => {
    CL_ForwardToServer_f(context, hooks);
  });
  registerCommand(context.cmd, "changing", () => {
    CL_Changing_f(context, hooks);
  });
  registerCommand(context.cmd, "connect", () => {
    CL_Connect_f(context, hooks);
  });
  registerCommand(context.cmd, "disconnect", () => {
    CL_Disconnect_f(context, hooks);
  });
  registerCommand(context.cmd, "download", () => {
    CL_Download_f(context.client, context.cmd, downloadHooks);
  });
  registerCommand(context.cmd, "pause", () => {
    CL_Pause_f(context, hooks);
  });
  registerCommand(context.cmd, "pingservers", () => {
    CL_PingServers_f(context, hooks);
  });
  registerCommand(context.cmd, "precache", () => {
    CL_Precache_f(context.client, context.cmd, precacheHooks);
  });
  registerCommand(context.cmd, "quit", () => {
    CL_Quit_f(context, hooks);
  });
  registerCommand(context.cmd, "rcon", () => {
    CL_Rcon_f(context, hooks);
  });
  registerCommand(context.cmd, "reconnect", () => {
    CL_Reconnect_f(context, hooks);
  });
  registerCommand(context.cmd, "record", () => {
    CL_Record_f(context, hooks);
  });
  registerCommand(context.cmd, "setenv", () => {
    CL_Setenv_f(context, hooks);
  });
  registerCommand(context.cmd, "snd_restart", () => {
    CL_Snd_Restart_f(context, hooks);
  });
  registerCommand(context.cmd, "stop", () => {
    CL_Stop_f(context, hooks);
  });
  registerCommand(context.cmd, "userinfo", () => {
    CL_Userinfo_f(context, hooks);
  });

  for (const command of [
    "wave",
    "inven",
    "kill",
    "use",
    "drop",
    "say",
    "say_team",
    "info",
    "prog",
    "give",
    "god",
    "notarget",
    "noclip",
    "invuse",
    "invprev",
    "invnext",
    "invdrop",
    "weapnext",
    "weapprev"
  ]) {
    registerCommand(context.cmd, command, null);
  }
}

/**
 * Original name: CL_ForwardToServer_f
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Validates connection state and forwards command arguments to the server string-command channel.
 *
 * Porting notes:
 * - Uses the explicit command/runtime context instead of file-static globals.
 */
export function CL_ForwardToServer_f(context: ClientMainContext, hooks: ClientMainHooks = {}): void {
  if (context.client.cls.state !== connstate_t.ca_connected && context.client.cls.state !== connstate_t.ca_active) {
    hooks.onPrint?.(`Can't "${Cmd_Argv(context.cmd, 0)}", not connected`);
    return;
  }

  if (Cmd_Argc(context.cmd) > 1) {
    CL_WriteStringCmd(context.client, Cmd_Argv(context.cmd, 1) ? context.cmd.cmd_args : "");
  }
}

/**
 * Original name: CL_Reconnect_f
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Handles reconnect requests during level changes or after a dropped connection.
 *
 * Porting notes:
 * - Defers sound shutdown to a host hook.
 * - Preserves the original resend timing adjustments.
 */
export function CL_Reconnect_f(context: ClientMainContext, hooks: ClientMainHooks = {}): void {
  if (hooks.isDownloading?.() === true) {
    return;
  }

  hooks.onStopAllSounds?.();

  if (context.client.cls.state === connstate_t.ca_connected) {
    hooks.onPrint?.("reconnecting...");
    context.client.cls.state = connstate_t.ca_connected;
    CL_WriteStringCmd(context.client, "new");
    return;
  }

  if (context.client.cls.servername.length > 0) {
    if (context.client.cls.state >= connstate_t.ca_connected) {
      CL_Disconnect(context, hooks);
      context.client.cls.connect_time = context.client.cls.realtime - 1500;
    } else {
      context.client.cls.connect_time = -99999;
    }

    context.client.cls.state = connstate_t.ca_connecting;
    hooks.onPrint?.("reconnecting...");
  }
}

/**
 * Original name: CL_Pause_f
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Toggles pause, except when multiplayer or no local server is running.
 *
 * Porting notes:
 * - Uses cvar runtime state plus an optional hook for the local-server presence check.
 */
export function CL_Pause_f(context: ClientMainContext, hooks: ClientMainHooks = {}): void {
  if (Cvar_VariableValue(context.cvar, "maxclients") > 1 || hooks.serverRunning?.() === false) {
    Cvar_SetValue(context.cvar, "paused", 0);
    return;
  }

  Cvar_SetValue(context.cvar, "paused", context.cl_paused?.value ? 0 : 1);
}

/**
 * Original name: N/A
 * Source: N/A (local pause helper)
 * Category: New
 * Purpose: Toggle the paused cvar using the same value-flip behavior as the original pause command path.
 *
 * Constraints:
 * - Must no-op safely if `CL_InitLocal` has not yet resolved `cl_paused`.
 */
export function CL_TogglePause(context: ClientMainContext): void {
  if (!context.cl_paused) {
    return;
  }

  Cvar_SetValue(context.cvar, "paused", context.cl_paused.value ? 0 : 1);
}

/**
 * Original name: N/A
 * Source: N/A (local command registration guard)
 * Category: New
 * Purpose: Register a command only when the command runtime does not already contain that name.
 */
function registerCommand(runtime: CommandRuntime, name: string, callback: (() => void) | null): void {
  if (Cmd_Exists(runtime, name)) {
    return;
  }

  Cmd_AddCommand(runtime, name, callback);
}
