/**
 * File: protocol.ts
 * Source: Quake-2-master/qcommon/qcommon.h
 * Purpose: Port the Quake II protocol constants shared by client and server message parsing.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Exposes preprocessor constants as TypeScript exports.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

/**
 * Original name: BASEDIRNAME
 * Source: Quake-2-master/qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Exposes the default base game directory shared by client, server and filesystem flows.
 */
export const BASEDIRNAME = "baseq2";

/**
 * Original name: PROTOCOL_VERSION, UPDATE_BACKUP, UPDATE_MASK
 * Source: Quake-2-master/qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines the stock Quake II network protocol id and circular snapshot history size.
 */
export const PROTOCOL_VERSION = 34;
export const UPDATE_BACKUP = 16;
export const UPDATE_MASK = UPDATE_BACKUP - 1;

/**
 * Original name: svc_ops_e
 * Source: Quake-2-master/qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Preserves the server-to-client opcode order used by message parsing and writing.
 */
export enum svc_ops_e {
  svc_bad,
  svc_muzzleflash,
  svc_muzzleflash2,
  svc_temp_entity,
  svc_layout,
  svc_inventory,
  svc_nop,
  svc_disconnect,
  svc_reconnect,
  svc_sound,
  svc_print,
  svc_stufftext,
  svc_serverdata,
  svc_configstring,
  svc_spawnbaseline,
  svc_centerprint,
  svc_download,
  svc_playerinfo,
  svc_packetentities,
  svc_deltapacketentities,
  svc_frame
}

/**
 * Original name: clc_ops_e
 * Source: Quake-2-master/qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Preserves the client-to-server opcode order used by command/message flows.
 */
export enum clc_ops_e {
  clc_bad,
  clc_nop,
  clc_move,
  clc_userinfo,
  clc_stringcmd
}

/**
 * Original name: PS_M_TYPE through PS_RDFLAGS
 * Source: Quake-2-master/qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines the player_state_t delta bit flags shared by server write and client parse.
 */
export const PS_M_TYPE = 1 << 0;
export const PS_M_ORIGIN = 1 << 1;
export const PS_M_VELOCITY = 1 << 2;
export const PS_M_TIME = 1 << 3;
export const PS_M_FLAGS = 1 << 4;
export const PS_M_GRAVITY = 1 << 5;
export const PS_M_DELTA_ANGLES = 1 << 6;
export const PS_VIEWOFFSET = 1 << 7;
export const PS_VIEWANGLES = 1 << 8;
export const PS_KICKANGLES = 1 << 9;
export const PS_BLEND = 1 << 10;
export const PS_FOV = 1 << 11;
export const PS_WEAPONINDEX = 1 << 12;
export const PS_WEAPONFRAME = 1 << 13;
export const PS_RDFLAGS = 1 << 14;

/**
 * Original name: SND_VOLUME through DEFAULT_SOUND_PACKET_ATTENUATION
 * Source: Quake-2-master/qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines the sound packet optional-field flags and stock default values.
 */
export const SND_VOLUME = 1 << 0;
export const SND_ATTENUATION = 1 << 1;
export const SND_POS = 1 << 2;
export const SND_ENT = 1 << 3;
export const SND_OFFSET = 1 << 4;
export const DEFAULT_SOUND_PACKET_VOLUME = 1.0;
export const DEFAULT_SOUND_PACKET_ATTENUATION = 1.0;

/**
 * Original name: U_ORIGIN1 through U_SOLID
 * Source: Quake-2-master/qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines the entity_state_t delta bit flags shared by qcommon message deltas and clients.
 */
export const U_ORIGIN1 = 1 << 0;
export const U_ORIGIN2 = 1 << 1;
export const U_ANGLE2 = 1 << 2;
export const U_ANGLE3 = 1 << 3;
export const U_FRAME8 = 1 << 4;
export const U_EVENT = 1 << 5;
export const U_REMOVE = 1 << 6;
export const U_MOREBITS1 = 1 << 7;
export const U_NUMBER16 = 1 << 8;
export const U_ORIGIN3 = 1 << 9;
export const U_ANGLE1 = 1 << 10;
export const U_MODEL = 1 << 11;
export const U_RENDERFX8 = 1 << 12;
export const U_EFFECTS8 = 1 << 14;
export const U_MOREBITS2 = 1 << 15;
export const U_SKIN8 = 1 << 16;
export const U_FRAME16 = 1 << 17;
export const U_RENDERFX16 = 1 << 18;
export const U_EFFECTS16 = 1 << 19;
export const U_MODEL2 = 1 << 20;
export const U_MODEL3 = 1 << 21;
export const U_MODEL4 = 1 << 22;
export const U_MOREBITS3 = 1 << 23;
export const U_OLDORIGIN = 1 << 24;
export const U_SKIN16 = 1 << 25;
export const U_SOUND = 1 << 26;
export const U_SOLID = 1 << 27;

/**
 * Original name: svc_strings
 * Source: Quake-2-master/client/cl_parse.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Exposes the original service-command labels used for shownet/debug output.
 *
 * Constraints:
 * - Array indexes must line up with `svc_ops_e`.
 * - Preserves the original Quake II spelling of `svc_muzzlflash2`.
 */
export const svc_strings: string[] = [
  "svc_bad",
  "svc_muzzleflash",
  "svc_muzzlflash2",
  "svc_temp_entity",
  "svc_layout",
  "svc_inventory",
  "svc_nop",
  "svc_disconnect",
  "svc_reconnect",
  "svc_sound",
  "svc_print",
  "svc_stufftext",
  "svc_serverdata",
  "svc_configstring",
  "svc_spawnbaseline",
  "svc_centerprint",
  "svc_download",
  "svc_playerinfo",
  "svc_packetentities",
  "svc_deltapacketentities",
  "svc_frame"
];
