/**
 * File: cl_parse.ts
 * Source: Quake II original / client/cl_parse.c
 * Purpose: Port the Quake II client message dispatcher and cl_parse.c-owned server data, configstrings, baselines and downloads.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Delegates cl_ents.c, cl_fx.c, cl_tent.c and cl_inv.c packet handlers to their owner modules while re-exporting them for compatibility.
 * - Defers sound, refresh, temporary entity and inventory side effects to optional hooks.
 * - Uses explicit runtime objects instead of file-static globals.
 *
 * Notes:
 * - This file is intended to stay conceptually close to the original C source.
 */

import {
  CS_CDTRACK,
  CS_IMAGES,
  CS_LIGHTS,
  CS_MODELS,
  MSG_ReadByte,
  MSG_ReadData,
  MSG_ReadLong,
  MSG_ReadPos,
  MSG_ReadShort,
  MSG_ReadString,
  MSG_WriteByte,
  MSG_WriteString,
  MAX_IMAGES,
  PRINT_CHAT,
  SND_ATTENUATION,
  SND_ENT,
  SND_OFFSET,
  SND_POS,
  SND_VOLUME,
  createEntityState,
  MAX_MODELS,
  MAX_SOUNDS,
  CS_SKY,
  CS_SKYAXIS,
  CS_SKYROTATE,
  CS_PLAYERSKINS,
  CS_SOUNDS,
  MAX_CONFIGSTRINGS,
  MAX_CLIENTS,
  MAX_EDICTS,
  MAX_ITEMS
} from "../../qcommon/src/index.js";
import {
  BASEDIRNAME,
  clc_ops_e,
  PROTOCOL_VERSION,
  svc_ops_e,
  svc_strings
} from "../../qcommon/src/index.js";
import { connstate_t, createFrame, type ClientRuntime, type frame_t } from "./client.js";
import {
  CL_ParseDelta,
  CL_ParseEntityBits,
  CL_ParseFrame,
  CL_ParsePlayerstate,
  type ClientEntityEvent
} from "./cl_ents.js";
import { CL_ClearEffects, CL_ParseMuzzleFlash, CL_ParseMuzzleFlash2, CL_SetLightstyle } from "./cl_fx.js";
import { CL_ParseInventory } from "./cl_inv.js";
import { CL_AddNetgraph, SCR_CenterPrint, SCR_PlayCinematic } from "./cl_scrn.js";
import {
  CL_ClearTEnts,
  CL_ParseTEnt
} from "./cl_tent.js";
import { createClientCinematicState, createClientScreenState, createClientSkyState } from "./client.js";

export {
  CL_ParseDelta,
  CL_ParseEntityBits,
  CL_ParseFrame,
  CL_ParsePlayerstate
} from "./cl_ents.js";
export {
  CL_ParseMuzzleFlash,
  CL_ParseMuzzleFlash2
} from "./cl_fx.js";
export { CL_ParseInventory } from "./cl_inv.js";
export {
  CL_ParseBeam,
  CL_ParseBeam2,
  CL_ParseLaser,
  CL_ParseLightning,
  CL_ParseNuke,
  CL_ParseParticles,
  CL_ParsePlayerBeam,
  CL_ParseSteam,
  CL_ParseTEnt,
  CL_ParseWidow
} from "./cl_tent.js";

/**
 * Original name: N/A
 * Source: N/A (parser adapter hooks)
 * Category: New
 * Purpose: Describe optional side-effect callbacks used while the client parser is still being ported incrementally.
 *
 * Constraints:
 * - Must keep parser behavior testable without renderer or sound backends.
 */
export interface ClientParseHooks {
  onPrint?: (line: string) => void;
  onDisconnect?: (reason: string) => void;
  onReconnect?: () => void;
  onStufftext?: (text: string) => void;
  onExecuteCommandBuffer?: () => void;
  onCenterPrint?: (text: string) => void;
  onLayout?: (text: string) => void;
  onConfigString?: (index: number, value: string) => void;
  onClientinfo?: (player: number, clientinfo: ClientRuntime["cl"]["clientinfo"][number]) => void;
  onServerData?: (levelName: string) => void;
  onSetGameDir?: (gamedir: string) => void;
  onPlayCinematic?: (name: string) => void;
  onPlayCdTrack?: (track: number, looping: boolean) => void;
  onStartLocalSound?: (path: string) => void;
  onSoundPacket?: (packet: ClientSoundPacket) => void;
  onStartSound?: (
    origin: [number, number, number] | null,
    ent: number,
    channel: number,
    sound: unknown,
    volume: number,
    attenuation: number,
    timeofs: number
  ) => void;
  onMuzzleFlash?: (packet: ClientMuzzleFlashPacket) => void;
  onMuzzleFlash2?: (packet: ClientMuzzleFlash2Packet) => void;
  onParticleEffect?: (packet: ClientParticleEffectPacket) => void;
  onTempEntity?: (packet: ClientTempEntityPacket) => void;
  onDownloadBlock?: (block: ClientDownloadBlock) => void;
  getPartialDownloadSize?: ((path: string) => number | null) | undefined;
  onCreateDownloadPath?: (path: string) => void;
  onOpenDownloadFile?: (path: string, mode: "write" | "append") => unknown | null;
  onWriteDownloadBytes?: (handle: unknown, bytes: Uint8Array) => boolean | void;
  onCloseDownloadFile?: (handle: unknown) => void;
  onRenameDownloadFile?: (oldPath: string, newPath: string) => boolean | void;
  onRequestNextDownload?: () => void;
  onWriteDemoMessage?: () => void;
  onEntityEvent?: (event: ClientEntityEvent) => void;
  onFrameParsed?: (frame: frame_t) => void;
  onEndLoadingPlaque?: () => void;
  getShownet?: () => number;
  onNetDebugPrint?: (line: string) => void;
  registerModel?: (path: string) => unknown;
  registerSkin?: (path: string) => unknown;
  registerPic?: (path: string) => unknown;
  registerSound?: (path: string) => unknown;
  inlineModel?: (path: string) => unknown;
  onUnsupportedCommand?: (command: number) => void;
}

/**
 * Original name: N/A
 * Source: N/A (typed sound packet)
 * Category: New
 * Purpose: Describe one parsed Quake II `svc_sound` payload before it is forwarded to an audio backend.
 *
 * Constraints:
 * - Must preserve entity-relative and positioned variants.
 */
export interface ClientSoundPacket {
  flags: number;
  sound_num: number;
  volume: number;
  attenuation: number;
  ofs: number;
  ent: number;
  channel: number;
  pos: [number, number, number] | null;
}

/**
 * Original name: N/A
 * Source: N/A (typed download packet)
 * Category: New
 * Purpose: Describe one parsed Quake II download block emitted by `svc_download`.
 *
 * Constraints:
 * - Must preserve the server-provided percent and payload bytes.
 */
export interface ClientDownloadBlock {
  size: number;
  percent: number;
  bytes: Uint8Array;
  missing: boolean;
}

/**
 * Original name: N/A
 * Source: N/A (typed muzzle-flash packet)
 * Category: New
 * Purpose: Describe one parsed `svc_muzzleflash` payload before client-side visual/audio effects are applied.
 *
 * Constraints:
 * - Must preserve the entity number and original weapon byte including silenced state.
 */
export interface ClientMuzzleFlashPacket {
  entity: number;
  weapon: number;
  silenced: boolean;
}

/**
 * Original name: N/A
 * Source: N/A (typed muzzle-flash packet)
 * Category: New
 * Purpose: Describe one parsed `svc_muzzleflash2` payload.
 *
 * Constraints:
 * - Must preserve the source entity number and monster flash id.
 */
export interface ClientMuzzleFlash2Packet {
  entity: number;
  flashNumber: number;
}

/**
 * Original name: N/A
 * Source: N/A (typed temp-entity packet)
 * Category: New
 *
 * Purpose: Describe one auxiliary particle-effect payload read outside of `CL_ParseTEnt`.
 *
 * Constraints:
 * - Must preserve the original `pos`, `dir`, `color`, `count` field set exactly.
 */
export interface ClientParticleEffectPacket {
  kind: "particle-effect";
  position: [number, number, number];
  directionByte: number;
  color: number;
  count: number;
}

/**
 * Original name: N/A
 * Source: N/A (typed temp-entity packet)
 * Category: New
 * Purpose: Describe one parsed `svc_temp_entity` payload in a renderer/audio-backend-friendly structure.
 *
 * Constraints:
 * - Must preserve the temp event type and all bytes consumed from the message stream.
 */
export interface ClientTempEntityPacket {
  type: number;
  count?: number;
  color?: number;
  direction?: [number, number, number];
  entity?: number;
  entity2?: number;
  id?: number;
  magnitude?: number;
  position?: [number, number, number];
  position2?: [number, number, number];
  offset?: [number, number, number];
  directionByte?: number;
  durationMs?: number;
  beamKind?: "beam" | "beam2" | "player-beam" | "lightning" | "laser" | "steam" | "widow" | "nuke";
}

/**
 * Original name: CL_ClearState
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Clears the level-scoped client state before entering a new server/game state.
 *
 * Porting notes:
 * - Preserves entity and parse entity storage while resetting values in place.
 */
export function CL_ClearState(runtime: ClientRuntime): void {
  runtime.cl = {
    ...runtime.cl,
    ...createFrameClearedClientState(runtime)
  };
  syncClientSkyFromConfigstrings(runtime);

  for (const entity of runtime.cl_entities) {
    entity.baseline = createEntityState();
    entity.current = createEntityState();
    entity.prev = createEntityState();
    entity.serverframe = 0;
    entity.trailcount = 0;
    entity.lerp_origin = [0, 0, 0];
    entity.fly_stoptime = 0;
  }

  for (let index = 0; index < runtime.cl_parse_entities.length; index += 1) {
    runtime.cl_parse_entities[index] = createEntityState();
  }

  runtime.cls.netchan.message.cursize = 0;
  runtime.cls.netchan.message.readcount = 0;
  runtime.cls.netchan.message.overflowed = false;

  CL_ClearTEnts(runtime);
  CL_ClearEffects(runtime);
}

/**
 * Original name: CL_ParseBaseline
 * Source: client/cl_parse.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Parses and stores one baseline entity.
 *
 * Porting notes:
 * - Reuses the already ported entity delta parser against a null state.
 */
export function CL_ParseBaseline(runtime: ClientRuntime): void {
  const { bits, number } = CL_ParseEntityBits(runtime);
  const nullstate = createEntityState();
  const baseline = runtime.cl_entities[number].baseline;
  CL_ParseDelta(runtime, nullstate, baseline, number, bits);
}

/**
 * Original name: CL_ParseStartSoundPacket
 * Source: client/cl_parse.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Parses one `svc_sound` packet, resolves the precached sound handle and forwards it to the client sound runtime.
 *
 * Porting notes:
 * - Keeps the direct `S_StartSound` dependency injectable so the parser stays testable without a concrete audio backend.
 */
export function CL_ParseStartSoundPacket(runtime: ClientRuntime, hooks: ClientParseHooks = {}): ClientSoundPacket {
  const flags = MSG_ReadByte(runtime.net_message);
  const sound_num = MSG_ReadByte(runtime.net_message);

  const volume = (flags & SND_VOLUME) !== 0 ? MSG_ReadByte(runtime.net_message) / 255 : 1.0;
  const attenuation = (flags & SND_ATTENUATION) !== 0 ? MSG_ReadByte(runtime.net_message) / 64 : 1.0;
  const ofs = (flags & SND_OFFSET) !== 0 ? MSG_ReadByte(runtime.net_message) / 1000 : 0;

  let ent = 0;
  let channel = 0;
  if ((flags & SND_ENT) !== 0) {
    const packedChannel = MSG_ReadShort(runtime.net_message);
    ent = packedChannel >> 3;
    if (ent > MAX_EDICTS) {
      throw new Error(`CL_ParseStartSoundPacket: ent = ${ent}`);
    }
    channel = packedChannel & 7;
  }

  const pos = (flags & SND_POS) !== 0 ? MSG_ReadPos(runtime.net_message) : null;
  const packet: ClientSoundPacket = {
    flags,
    sound_num,
    volume,
    attenuation,
    ofs,
    ent,
    channel,
    pos
  };

  hooks.onSoundPacket?.(packet);
  const sound = runtime.cl.sound_precache[sound_num] ?? null;
  if (sound) {
    hooks.onStartSound?.(pos, ent, channel, sound, volume, attenuation, ofs);
  }
  return packet;
}

/**
 * Original name: SHOWNET
 * Source: client/cl_parse.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits one parser trace line when `cl_shownet` is at least 2.
 *
 * Porting notes:
 * - Reads `cl_shownet` through a hook because `cl_parse.c` is ported against an explicit client runtime, not file-static cvars.
 */
export function SHOWNET(runtime: ClientRuntime, text: string, hooks: ClientParseHooks = {}): void {
  if ((hooks.getShownet?.() ?? 0) >= 2) {
    hooks.onNetDebugPrint?.(`${(runtime.net_message.readcount - 1).toString().padStart(3, " ")}:${text}\n`);
  }
}

/**
 * Original name: CL_ParseDownload
 * Source: client/cl_parse.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Parses one download block from the server and updates in-progress download state.
 *
 * Porting notes:
 * - Uses hook-based file IO for `FS_CreatePath`, `fopen`, `fwrite`, `fclose` and `rename`.
 */
export function CL_ParseDownload(runtime: ClientRuntime, hooks: ClientParseHooks = {}): ClientDownloadBlock {
  const size = MSG_ReadShort(runtime.net_message);
  const percent = MSG_ReadByte(runtime.net_message);

  if (size === -1) {
    emitPrint(runtime, "Server does not have this file.\n", hooks);
    if (runtime.cls.download) {
      hooks.onCloseDownloadFile?.(runtime.cls.download);
    }
    runtime.cls.download = null;
    runtime.cls.downloadpercent = 0;
    const missingBlock: ClientDownloadBlock = {
      size,
      percent,
      bytes: new Uint8Array(0),
      missing: true
    };
    hooks.onDownloadBlock?.(missingBlock);
    hooks.onRequestNextDownload?.();
    return missingBlock;
  }

  const tempPath = resolveDownloadFileName(runtime, runtime.cls.downloadtempname);
  if (!runtime.cls.download && hooks.onOpenDownloadFile) {
    hooks.onCreateDownloadPath?.(tempPath);
    const resumeSize = hooks.getPartialDownloadSize?.(tempPath) ?? null;
    const opened = hooks.onOpenDownloadFile(tempPath, resumeSize !== null && resumeSize > 0 ? "append" : "write");
    if (!opened) {
      const skipped = MSG_ReadData(runtime.net_message, size);
      emitPrint(runtime, `Failed to open ${runtime.cls.downloadtempname}\n`, hooks);
      hooks.onRequestNextDownload?.();
      return {
        size,
        percent,
        bytes: skipped,
        missing: false
      };
    }
    runtime.cls.download = opened;
  }

  const bytes = MSG_ReadData(runtime.net_message, size);
  if (runtime.cls.download) {
    hooks.onWriteDownloadBytes?.(runtime.cls.download, bytes);
  }
  runtime.cls.downloadpercent = percent;

  const block: ClientDownloadBlock = {
    size,
    percent,
    bytes,
    missing: false
  };
  hooks.onDownloadBlock?.(block);
  if (percent === 100) {
    if (runtime.cls.download) {
      hooks.onCloseDownloadFile?.(runtime.cls.download);
      const finalPath = resolveDownloadFileName(runtime, runtime.cls.downloadname);
      const renamed = hooks.onRenameDownloadFile?.(tempPath, finalPath);
      if (renamed === false) {
        emitPrint(runtime, "failed to rename.\n", hooks);
      }
    }
    runtime.cls.download = null;
    runtime.cls.downloadpercent = 0;
    hooks.onRequestNextDownload?.();
  } else {
    CL_WriteStringCmd(runtime, "nextdl");
  }
  return block;
}

/**
 * Original name: CL_DownloadFileName
 * Source: client/cl_parse.c
 * Category: Adapter
 * Purpose: Resolve `CL_ParseDownload` temp/final names without importing `CL_DownloadFileName` and creating a module cycle.
 *
 * Constraints:
 * - Must mirror `CL_DownloadFileName` from `download.ts`.
 */
function resolveDownloadFileName(runtime: ClientRuntime, filename: string): string {
  const gameDir = runtime.cl.gamedir.length > 0 ? runtime.cl.gamedir : BASEDIRNAME;
  const root = filename.startsWith("players") ? BASEDIRNAME : gameDir;
  return `${root}/${filename}`;
}

/**
 * Original name: CL_LoadClientinfo
 * Source: client/cl_parse.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Parses one Quake II player skin/model descriptor into derived clientinfo filenames.
 *
 * Porting notes:
 * - Computes filenames and validity state without registering renderer resources yet.
 */
export function CL_LoadClientinfo(runtime: ClientRuntime, clientinfo: ClientRuntime["cl"]["clientinfo"][number], info: string): void {
  clientinfo.cinfo = info.slice(0, 63);
  clientinfo.name = info;
  clientinfo.model_name = "";
  clientinfo.skin_name = "";
  clientinfo.model_filename = "";
  clientinfo.skin_filename = "";
  clientinfo.iconname = "";
  clientinfo.model = null;
  clientinfo.skin = null;
  clientinfo.icon = null;
  clientinfo.weaponmodel.fill(null);
  clientinfo.weaponmodel_paths.fill("");
  clientinfo.valid = false;

  const separatorIndex = info.indexOf("\\");
  if (separatorIndex >= 0) {
    clientinfo.name = info.slice(0, separatorIndex);
    info = info.slice(separatorIndex + 1);
  } else {
    clientinfo.name = info;
    info = "";
  }

  let model_name = "male";
  let skin_name = "grunt";

  if (info.length > 0) {
    const slashIndex = findModelSkinSeparator(info);
    if (slashIndex > 0) {
      model_name = info.slice(0, slashIndex);
      skin_name = info.slice(slashIndex + 1) || "grunt";
    } else if (slashIndex === 0) {
      skin_name = info.slice(1) || "grunt";
    } else {
      model_name = info;
    }
  }

  clientinfo.model_name = model_name;
  clientinfo.skin_name = skin_name;
  clientinfo.model_filename = `players/${model_name}/tris.md2`;
  clientinfo.skin_filename = `players/${model_name}/${skin_name}.pcx`;
  clientinfo.iconname = `/players/${model_name}/${skin_name}_i.pcx`;

  for (let index = 0; index < runtime.cl.num_cl_weaponmodels; index += 1) {
    clientinfo.weaponmodel_paths[index] = `players/${model_name}/${runtime.cl.cl_weaponmodels[index]}`;
  }

  clientinfo.valid = true;
}

/**
 * Original name: CL_ParseClientinfo
 * Source: client/cl_parse.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Loads derived clientinfo state for one player from the corresponding playerskin configstring.
 *
 * Porting notes:
 * - Defers renderer registration to later phases.
 */
export function CL_ParseClientinfo(runtime: ClientRuntime, player: number, hooks: ClientParseHooks = {}): void {
  if (player < 0 || player >= MAX_CLIENTS) {
    return;
  }

  const info = runtime.cl.configstrings[player + CS_PLAYERSKINS] ?? "";
  const clientinfo = runtime.cl.clientinfo[player];
  CL_LoadClientinfo(runtime, clientinfo, info);
  if (runtime.cl.refresh_prepped) {
    registerClientinfoResources(clientinfo, hooks);
  }
  hooks.onClientinfo?.(player, clientinfo);
}

/**
 * Original name: CL_ParseLayout
 * Source: client/client.h and client/cl_parse.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Reads and stores the current layout string.
 *
 * Porting notes:
 * - Reuses the shared hook used by direct `svc_layout` parsing.
 */
export function CL_ParseLayout(runtime: ClientRuntime, hooks: ClientParseHooks = {}): string {
  const layout = MSG_ReadString(runtime.net_message);
  runtime.cl.layout = layout;
  hooks.onLayout?.(layout);
  return layout;
}

/**
 * Original name: CL_ParseConfigString
 * Source: client/cl_parse.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Updates one configstring slot from the network message.
 *
 * Porting notes:
 * - Defers refresh and sound side effects to hooks for now.
 */
export function CL_ParseConfigString(runtime: ClientRuntime, hooks: ClientParseHooks = {}): void {
  const index = MSG_ReadShort(runtime.net_message);
  if (index < 0 || index >= MAX_CONFIGSTRINGS) {
    throw new Error("CL_ParseConfigString: configstring > MAX_CONFIGSTRINGS");
  }

  const value = MSG_ReadString(runtime.net_message);
  runtime.cl.configstrings[index] = value;
  if (index === CS_SKY || index === CS_SKYROTATE || index === CS_SKYAXIS) {
    syncClientSkyFromConfigstrings(runtime);
  }
  if (index >= CS_LIGHTS && index < CS_LIGHTS + runtime.cl.lightstyles.length) {
    CL_SetLightstyle(runtime, index - CS_LIGHTS);
  }
  if (runtime.cl.refresh_prepped) {
    if (index === CS_CDTRACK) {
      const track = Number.parseInt(value, 10);
      hooks.onPlayCdTrack?.(Number.isFinite(track) ? track : 0, true);
    } else if (index >= CS_MODELS && index < CS_MODELS + MAX_MODELS) {
      const modelIndex = index - CS_MODELS;
      runtime.cl.model_draw[modelIndex] = value.length > 0 ? (hooks.registerModel?.(value) ?? value) : null;
      runtime.cl.model_clip[modelIndex] = value.startsWith("*")
        ? (hooks.inlineModel?.(value) ?? value)
        : null;
    } else if (index >= CS_SOUNDS && index < CS_SOUNDS + MAX_SOUNDS) {
      const soundIndex = index - CS_SOUNDS;
      runtime.cl.sound_precache[soundIndex] = value.length > 0 ? (hooks.registerSound?.(value) ?? value) : null;
    } else if (index >= CS_IMAGES && index < CS_IMAGES + MAX_IMAGES) {
      const imageIndex = index - CS_IMAGES;
      runtime.cl.image_precache[imageIndex] = value.length > 0 ? (hooks.registerPic?.(value) ?? value) : null;
    }
  }

  if (runtime.cl.refresh_prepped && index >= CS_PLAYERSKINS && index < CS_PLAYERSKINS + MAX_CLIENTS) {
    CL_ParseClientinfo(runtime, index - CS_PLAYERSKINS, hooks);
  }
  hooks.onConfigString?.(index, value);
}

/**
 * Original name: CL_ParseServerData
 * Source: client/cl_parse.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Parses the initial serverdata message and resets level-scoped client state.
 *
 * Porting notes:
 * - Throws on protocol mismatch instead of routing through `Com_Error`.
 */
export function CL_ParseServerData(runtime: ClientRuntime, hooks: ClientParseHooks = {}): void {
  CL_ClearState(runtime);
  runtime.cls.state = connstate_t.ca_connected;

  const protocol = MSG_ReadLong(runtime.net_message);
  runtime.cls.serverProtocol = protocol;
  if (protocol !== PROTOCOL_VERSION && protocol !== 26) {
    throw new Error(`Server returned version ${protocol}, not ${PROTOCOL_VERSION}`);
  }

  runtime.cl.servercount = MSG_ReadLong(runtime.net_message);
  runtime.cl.attractloop = MSG_ReadByte(runtime.net_message) !== 0;

  const gamedir = MSG_ReadString(runtime.net_message);
  runtime.cl.gamedir = gamedir;
  hooks.onSetGameDir?.(gamedir);

  runtime.cl.playernum = MSG_ReadShort(runtime.net_message);
  const levelName = MSG_ReadString(runtime.net_message);
  if (runtime.cl.playernum === -1) {
    hooks.onPlayCinematic?.(levelName);
    if (!hooks.onPlayCinematic) {
      SCR_PlayCinematic(runtime, levelName);
    }
  } else {
    runtime.cl.refresh_prepped = false;
  }
  hooks.onServerData?.(levelName);
}

/**
 * Original name: CL_ParseServerMessage
 * Source: client/cl_parse.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Parses one full incoming server message stream command by command.
 *
 * Porting notes:
 * - Leaves unsupported command bodies to hooks so parsing can advance incrementally.
 */
export function CL_ParseServerMessage(runtime: ClientRuntime, hooks: ClientParseHooks = {}): void {
  const shownet = hooks.getShownet?.() ?? 0;
  if (shownet === 1) {
    hooks.onNetDebugPrint?.(`${runtime.net_message.cursize} `);
  } else if (shownet >= 2) {
    hooks.onNetDebugPrint?.("------------------\n");
  }

  while (true) {
    if (runtime.net_message.readcount > runtime.net_message.cursize) {
      throw new Error("CL_ParseServerMessage: Bad server message");
    }

    const command = MSG_ReadByte(runtime.net_message);
    if (command === -1) {
      SHOWNET(runtime, "END OF MESSAGE", hooks);
      break;
    }

    if (shownet >= 2) {
      const label = svc_strings[command];
      if (label) {
        SHOWNET(runtime, label, hooks);
      } else {
        hooks.onNetDebugPrint?.(`${(runtime.net_message.readcount - 1).toString().padStart(3, " ")}:BAD CMD ${command}\n`);
      }
    }

    switch (command) {
      case svc_ops_e.svc_nop:
        break;
      case svc_ops_e.svc_disconnect:
        hooks.onDisconnect?.("Server disconnected");
        throw new Error("Server disconnected");
      case svc_ops_e.svc_reconnect:
        runtime.cls.download = null;
        runtime.cls.downloadpercent = 0;
        runtime.cls.state = connstate_t.ca_connecting;
        runtime.cls.connect_time = -99999;
        hooks.onReconnect?.();
        break;
      case svc_ops_e.svc_print: {
        const level = MSG_ReadByte(runtime.net_message);
        const text = MSG_ReadString(runtime.net_message);
        if (level === PRINT_CHAT) {
          hooks.onStartLocalSound?.("misc/talk.wav");
          emitPrint(runtime, text, hooks);
        } else {
          emitPrint(runtime, text, hooks);
        }
        break;
      }
      case svc_ops_e.svc_centerprint:
      {
        const text = MSG_ReadString(runtime.net_message);
        SCR_CenterPrint(runtime, text);
        hooks.onCenterPrint?.(text);
        break;
      }
      case svc_ops_e.svc_stufftext: {
        const text = MSG_ReadString(runtime.net_message);
        hooks.onStufftext?.(text);
        break;
      }
      case svc_ops_e.svc_serverdata:
        hooks.onExecuteCommandBuffer?.();
        CL_ParseServerData(runtime, hooks);
        break;
      case svc_ops_e.svc_configstring:
        CL_ParseConfigString(runtime, hooks);
        break;
      case svc_ops_e.svc_sound:
        CL_ParseStartSoundPacket(runtime, hooks);
        break;
      case svc_ops_e.svc_muzzleflash:
        CL_ParseMuzzleFlash(runtime, hooks);
        break;
      case svc_ops_e.svc_muzzleflash2:
        CL_ParseMuzzleFlash2(runtime, hooks);
        break;
      case svc_ops_e.svc_temp_entity:
        CL_ParseTEnt(runtime, hooks);
        break;
      case svc_ops_e.svc_spawnbaseline:
        CL_ParseBaseline(runtime);
        break;
      case svc_ops_e.svc_download:
        CL_ParseDownload(runtime, hooks);
        break;
      case svc_ops_e.svc_frame:
        CL_ParseFrame(runtime, hooks);
        break;
      case svc_ops_e.svc_layout: {
        CL_ParseLayout(runtime, hooks);
        break;
      }
      case svc_ops_e.svc_inventory:
        CL_ParseInventory(runtime);
        break;
      case svc_ops_e.svc_playerinfo:
      case svc_ops_e.svc_packetentities:
      case svc_ops_e.svc_deltapacketentities:
        throw new Error("Out of place frame data");
      default:
        hooks.onUnsupportedCommand?.(command);
        throw new Error(`CL_ParseServerMessage: unsupported command ${svc_strings[command] ?? command}`);
    }
  }

  CL_AddNetgraph({
    client: runtime,
    cmd: null as never,
    cvar: null as never,
    scr_viewsize: null,
    scr_conspeed: null,
    scr_showturtle: null,
    scr_showpause: null,
    scr_centertime: null,
    scr_printspeed: null,
    scr_netgraph: null,
    scr_drawall: null,
    scr_timegraph: null,
    scr_debuggraph: null,
    scr_graphheight: null,
    scr_graphscale: null,
    scr_graphshift: null,
    crosshair: null
  });

  if (runtime.cls.demorecording && !runtime.cls.demowaiting) {
    hooks.onWriteDemoMessage?.();
  }
}

/**
 * Original name: N/A
 * Source: N/A (outgoing command helper)
 * Category: New
 * Purpose: Write one string command into the client message buffer using the original `clc_stringcmd` envelope.
 *
 * Constraints:
 * - Must preserve command serialization order and null-terminated string encoding.
 */
export function CL_WriteStringCmd(runtime: ClientRuntime, text: string): void {
  MSG_WriteByte(runtime.cls.netchan.message, clc_ops_e.clc_stringcmd);
  MSG_WriteString(runtime.cls.netchan.message, text);
}

/**
 * Original name: N/A
 * Source: N/A (local print helper)
 * Category: New
 * Purpose: Emit parser output to both runtime capture and optional hooks.
 *
 * Constraints:
 * - Must keep print order stable for future golden tests.
 */
function emitPrint(runtime: ClientRuntime, text: string, hooks: ClientParseHooks): void {
  runtime.output.push(text);
  hooks.onPrint?.(text);
}

/**
 * Original name: N/A
 * Source: N/A (local clientinfo parser helper)
 * Category: New
 * Purpose: Find the first model/skin separator accepted by the TS clientinfo parser.
 *
 * Constraints:
 * - Must accept both slash styles while preserving the original first-separator behavior.
 */
function findModelSkinSeparator(value: string): number {
  const forwardSlash = value.indexOf("/");
  const backSlash = value.indexOf("\\");

  if (forwardSlash === -1) {
    return backSlash;
  }
  if (backSlash === -1) {
    return forwardSlash;
  }
  return Math.min(forwardSlash, backSlash);
}

/**
 * Original name: CL_LoadClientinfo / CL_PrepRefresh
 * Source: client/cl_parse.c and client/cl_view.c
 * Category: Adapter
 * Fidelity level: Close
 *
 * Behavior:
 * - Registers renderer resources for a parsed clientinfo entry and applies the original fallback model/skin rules.
 *
 * Porting notes:
 * - Split from `CL_LoadClientinfo` so parsing remains available without a refresh backend.
 */
export function registerClientinfoResources(
  clientinfo: ClientRuntime["cl"]["clientinfo"][number],
  hooks: Pick<ClientParseHooks, "registerModel" | "registerSkin" | "registerPic">
): void {
  let modelName = clientinfo.model_name || "male";
  let skinName = clientinfo.skin_name || "grunt";

  const requestedModel = `players/${modelName}/tris.md2`;
  clientinfo.model = registerModelWithNull(hooks, requestedModel);
  if (!clientinfo.model) {
    modelName = "male";
    clientinfo.model = registerModelWithNull(hooks, "players/male/tris.md2");
  }

  let skinFilename = `players/${modelName}/${skinName}.pcx`;
  clientinfo.skin = registerSkinWithNull(hooks, skinFilename);
  if (!clientinfo.skin && modelName !== "male") {
    modelName = "male";
    clientinfo.model = registerModelWithNull(hooks, "players/male/tris.md2");
    skinFilename = `players/male/${skinName}.pcx`;
    clientinfo.skin = registerSkinWithNull(hooks, skinFilename);
  }
  if (!clientinfo.skin) {
    skinName = "grunt";
    skinFilename = `players/${modelName}/grunt.pcx`;
    clientinfo.skin = registerSkinWithNull(hooks, skinFilename);
  }

  clientinfo.model_name = modelName;
  clientinfo.skin_name = skinName;
  clientinfo.model_filename = `players/${modelName}/tris.md2`;
  clientinfo.skin_filename = skinFilename;
  clientinfo.iconname = `/players/${modelName}/${skinName}_i.pcx`;
  clientinfo.icon = clientinfo.iconname ? (hooks.registerPic?.(clientinfo.iconname) ?? clientinfo.iconname) : null;

  for (let index = 0; index < clientinfo.weaponmodel_paths.length; index += 1) {
    const sourcePath = clientinfo.weaponmodel_paths[index];
    if (!sourcePath) {
      clientinfo.weaponmodel[index] = null;
      continue;
    }

    const weaponName = sourcePath.slice(sourcePath.lastIndexOf("/") + 1);
    const weaponPath = `players/${modelName}/${weaponName}`;
    clientinfo.weaponmodel_paths[index] = weaponPath;
    clientinfo.weaponmodel[index] = registerModelWithNull(hooks, weaponPath);
    if (!clientinfo.weaponmodel[index] && modelName === "cyborg") {
      const fallbackWeaponPath = `players/male/${weaponName}`;
      clientinfo.weaponmodel_paths[index] = fallbackWeaponPath;
      clientinfo.weaponmodel[index] = registerModelWithNull(hooks, fallbackWeaponPath);
    }
  }

  clientinfo.valid = clientinfo.model !== null
    && clientinfo.skin !== null
    && clientinfo.icon !== null
    && clientinfo.weaponmodel[0] !== null;
}

function registerModelWithNull(
  hooks: Pick<ClientParseHooks, "registerModel">,
  path: string
): unknown {
  return hooks.registerModel ? hooks.registerModel(path) : path;
}

function registerSkinWithNull(
  hooks: Pick<ClientParseHooks, "registerSkin">,
  path: string
): unknown {
  return hooks.registerSkin ? hooks.registerSkin(path) : path;
}

/**
 * Original name: N/A
 * Source: N/A (local clear-state helper)
 * Category: New
 * Purpose: Produce the fields reset by `CL_ClearState` while preserving the outer runtime object.
 *
 * Constraints:
 * - Must rebuild frame rings and parse counters to clean startup values.
 */
function createFrameClearedClientState(runtime: ClientRuntime): Omit<ClientRuntime["cl"], "clientinfo" | "baseclientinfo" | "model_draw" | "model_clip" | "sound_precache" | "image_precache" | "configstrings" | "inventory"> & {
  inventory: number[];
  configstrings: string[];
  model_draw: unknown[];
  model_clip: unknown[];
  sound_precache: unknown[];
  image_precache: unknown[];
  clientinfo: ClientRuntime["cl"]["clientinfo"];
  baseclientinfo: ClientRuntime["cl"]["baseclientinfo"];
} {
  return {
    timeoutcount: 0,
    timedemo_frames: 0,
    timedemo_start: 0,
    refresh_prepped: false,
    sound_prepped: false,
    force_refdef: false,
    parse_entities: 0,
    cmd: runtime.cl.cmd,
    cmds: runtime.cl.cmds,
    cmd_time: runtime.cl.cmd_time,
    predicted_origins: runtime.cl.predicted_origins,
    predicted_pmove: runtime.cl.predicted_pmove,
    predicted_viewheight: 0,
    predicted_step: 0,
    predicted_step_time: 0,
    predicted_origin: [0, 0, 0],
    predicted_angles: [0, 0, 0],
    prediction_error: [0, 0, 0],
    frame: createFrame(),
    surpressCount: 0,
    frames: Array.from({ length: runtime.cl.frames.length }, () => createFrame()),
    viewangles: [0, 0, 0],
    time: 0,
    lerpfrac: 0,
    cl_footsteps: runtime.cl.cl_footsteps,
    hand: runtime.cl.hand,
    layout: "",
    inventory: new Array<number>(MAX_ITEMS).fill(0),
    attractloop: false,
    servercount: 0,
    gamedir: BASEDIRNAME,
    playernum: 0,
    configstrings: new Array<string>(MAX_CONFIGSTRINGS).fill(""),
    sky: createClientSkyState(),
    model_draw: new Array<unknown>(runtime.cl.model_draw.length).fill(null),
    model_clip: new Array<unknown>(runtime.cl.model_clip.length).fill(null),
    sound_precache: new Array<unknown>(runtime.cl.sound_precache.length).fill(null),
    image_precache: new Array<unknown>(runtime.cl.image_precache.length).fill(null),
    lightstyles: runtime.cl.lightstyles.map((lightstyle) => ({
      length: lightstyle.length,
      value: [...lightstyle.value],
      map: [...lightstyle.map]
    })),
    last_lightstyle_ofs: -1,
    dlights: runtime.cl.dlights.map((dlight) => ({
      key: dlight.key,
      color: [...dlight.color],
      origin: [...dlight.origin],
      radius: dlight.radius,
      die: dlight.die,
      decay: dlight.decay,
      minlight: dlight.minlight
    })),
    particles: Array.from({ length: runtime.cl.cl_numparticles }, (_, index) => {
      const particle = runtime.cl.particles[index];
      return {
        time: particle.time,
        org: [...particle.org],
        vel: [...particle.vel],
        accel: [...particle.accel],
        color: particle.color,
        colorvel: particle.colorvel,
        alpha: particle.alpha,
        alphavel: particle.alphavel,
        next: index + 1 < runtime.cl.cl_numparticles ? index + 1 : -1
      };
    }),
    active_particles: -1,
    free_particles: runtime.cl.cl_numparticles > 0 ? 0 : -1,
    cl_numparticles: runtime.cl.cl_numparticles,
    vidref_val: runtime.cl.vidref_val,
    cl_weaponmodels: [...runtime.cl.cl_weaponmodels],
    num_cl_weaponmodels: runtime.cl.num_cl_weaponmodels,
    clientinfo: runtime.cl.clientinfo,
    baseclientinfo: runtime.cl.baseclientinfo,
    tents: runtime.cl.tents,
    screen: createClientScreenState(),
    cinematic: createClientCinematicState()
  };
}

/**
 * Original name: N/A
 * Source: N/A (local sky config helper)
 * Category: New
 * Purpose: Synchronize the structured client sky state from the raw Quake II configstring slots.
 *
 * Constraints:
 * - Must derive values only from `CS_SKY`, `CS_SKYROTATE` and `CS_SKYAXIS`.
 * - Must reset missing or invalid values to stable zero defaults.
 */
function syncClientSkyFromConfigstrings(runtime: ClientRuntime): void {
  runtime.cl.sky.name = runtime.cl.configstrings[CS_SKY] ?? "";
  runtime.cl.sky.rotate = parseSkyRotate(runtime.cl.configstrings[CS_SKYROTATE] ?? "");
  runtime.cl.sky.axis = parseSkyAxis(runtime.cl.configstrings[CS_SKYAXIS] ?? "");
}

/**
 * Original name: N/A
 * Source: N/A (local sky config helper)
 * Category: New
 * Purpose: Parse the Quake II sky rotation configstring into a numeric value.
 *
 * Constraints:
 * - Must fall back to `0` when the configstring is absent or invalid.
 */
function parseSkyRotate(value: string): number {
  const parsed = Number.parseFloat(value.trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Original name: N/A
 * Source: N/A (local sky config helper)
 * Category: New
 * Purpose: Parse the Quake II sky axis configstring into a three-component vector.
 *
 * Constraints:
 * - Must require exactly three finite numeric components.
 * - Must fall back to `[0, 0, 0]` when the configstring is absent or invalid.
 */
function parseSkyAxis(value: string): [number, number, number] {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => Number.parseFloat(part));

  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return [0, 0, 0];
  }

  return [parts[0], parts[1], parts[2]];
}
