/**
 * File: qcommon.ts
 * Source: Quake II original / qcommon/qcommon.h
 * Purpose: Port the shared qcommon header declarations that sit above `q_shared.h` and tie together command, messaging and networking subsystems.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Routes many declarations through explicit runtime helpers and reexports from narrower modules.
 * - Represents C fixed buffers as typed arrays and interfaces.
 *
 * Notes:
 * - This file is the principal TypeScript attachment point for `qcommon/qcommon.h`.
 */

import type { byte, qboolean } from "./q_shared.js";
import { CVAR_NOSET, CVAR_SERVERINFO, type CvarRuntime, Cvar_Get } from "./cvar.js";
import type { cvar_t } from "./cvar.js";
import type { sizebuf_t } from "../../memory/src/index.js";
import { createSizeBuffer, SZ_Clear, SZ_Write } from "../../memory/src/index.js";
import { Cbuf_AddText, Cbuf_Execute, Cmd_AddCommand, Cmd_Argv, type CommandRuntime } from "./cmd.js";
import { CRC_Block } from "./crc.js";
import { MSG_BeginReading } from "./messages.js";
export { Com_BlockChecksum } from "./md4.js";

/**
 * Original name: VERSION
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Exposes the canonical Quake II version string used by the qcommon layer.
 */
export const VERSION = 3.19;

/**
 * Original name: BUILDSTRING
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Exposes the host build label for the current TypeScript runtime.
 *
 * Porting notes:
 * - Uses one explicit TypeScript label instead of platform-specific C preprocessor branches.
 */
export const BUILDSTRING = "TypeScript";

/**
 * Original name: CPUSTRING
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Exposes the host CPU label for the current TypeScript runtime.
 *
 * Porting notes:
 * - Uses one explicit architecture-neutral label instead of platform-specific C preprocessor branches.
 */
export const CPUSTRING = "portable";

/**
 * Original names: PORT_MASTER, PORT_CLIENT, PORT_SERVER
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines the stock Quake II UDP ports for master, client and server traffic.
 */
export const PORT_MASTER = 27900;
export const PORT_CLIENT = 27901;
export const PORT_SERVER = 27910;

export const CM_ANGLE1 = 1 << 0;
export const CM_ANGLE2 = 1 << 1;
export const CM_ANGLE3 = 1 << 2;
export const CM_FORWARD = 1 << 3;
export const CM_SIDE = 1 << 4;
export const CM_UP = 1 << 5;
export const CM_BUTTONS = 1 << 6;
export const CM_IMPULSE = 1 << 7;

/**
 * Original names: PORT_ANY, MAX_MSGLEN, PACKET_HEADER
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines the portable network bind sentinel, maximum Quake II packet payload
 *   size and sequenced-packet header reservation.
 */
export const PORT_ANY = -1;
export const MAX_MSGLEN = 1400;
export const PACKET_HEADER = 10;

/**
 * Original names: OLD_AVG, MAX_LATENT
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines the legacy latency smoothing and latency-sample window constants for netchan state.
 */
export const OLD_AVG = 0.99;
export const MAX_LATENT = 32;

/**
 * Original names: ERR_FATAL, ERR_DROP, ERR_QUIT
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines the common error-control codes used by `Com_Error` and `Com_Quit`.
 */
export const ERR_FATAL = 0;
export const ERR_DROP = 1;
export const ERR_QUIT = 2;

/**
 * Original name: NUMVERTEXNORMALS
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines the byte-normal table size shared by message direction encoding and visual effects.
 */
export const NUMVERTEXNORMALS = 162;

/**
 * Original name: chktbl
 * Source: qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Stores the 1024-byte sequence-protection table consumed by `COM_BlockSequenceCRCByte`.
 */
const chktbl = new Uint8Array([
  0x84, 0x47, 0x51, 0xc1, 0x93, 0x22, 0x21, 0x24, 0x2f, 0x66, 0x60, 0x4d, 0xb0, 0x7c, 0xda,
  0x88, 0x54, 0x15, 0x2b, 0xc6, 0x6c, 0x89, 0xc5, 0x9d, 0x48, 0xee, 0xe6, 0x8a, 0xb5, 0xf4,
  0xcb, 0xfb, 0xf1, 0x0c, 0x2e, 0xa0, 0xd7, 0xc9, 0x1f, 0xd6, 0x06, 0x9a, 0x09, 0x41, 0x54,
  0x67, 0x46, 0xc7, 0x74, 0xe3, 0xc8, 0xb6, 0x5d, 0xa6, 0x36, 0xc4, 0xab, 0x2c, 0x7e, 0x85,
  0xa8, 0xa4, 0xa6, 0x4d, 0x96, 0x19, 0x19, 0x9a, 0xcc, 0xd8, 0xac, 0x39, 0x5e, 0x3c, 0xf2,
  0xf5, 0x5a, 0x72, 0xe5, 0xa9, 0xd1, 0xb3, 0x23, 0x82, 0x6f, 0x29, 0xcb, 0xd1, 0xcc, 0x71,
  0xfb, 0xea, 0x92, 0xeb, 0x1c, 0xca, 0x4c, 0x70, 0xfe, 0x4d, 0xc9, 0x67, 0x43, 0x47, 0x94,
  0xb9, 0x47, 0xbc, 0x3f, 0x01, 0xab, 0x7b, 0xa6, 0xe2, 0x76, 0xef, 0x5a, 0x7a, 0x29, 0x0b,
  0x51, 0x54, 0x67, 0xd8, 0x1c, 0x14, 0x3e, 0x29, 0xec, 0xe9, 0x2d, 0x48, 0x67, 0xff, 0xed,
  0x54, 0x4f, 0x48, 0xc0, 0xaa, 0x61, 0xf7, 0x78, 0x12, 0x03, 0x7a, 0x9e, 0x8b, 0xcf, 0x83,
  0x7b, 0xae, 0xca, 0x7b, 0xd9, 0xe9, 0x53, 0x2a, 0xeb, 0xd2, 0xd8, 0xcd, 0xa3, 0x10, 0x25,
  0x78, 0x5a, 0xb5, 0x23, 0x06, 0x93, 0xb7, 0x84, 0xd2, 0xbd, 0x96, 0x75, 0xa5, 0x5e, 0xcf,
  0x4e, 0xe9, 0x50, 0xa1, 0xe6, 0x9d, 0xb1, 0xe3, 0x85, 0x66, 0x28, 0x4e, 0x43, 0xdc, 0x6e,
  0xbb, 0x33, 0x9e, 0xf3, 0x0d, 0x00, 0xc1, 0xcf, 0x67, 0x34, 0x06, 0x7c, 0x71, 0xe3, 0x63,
  0xb7, 0xb7, 0xdf, 0x92, 0xc4, 0xc2, 0x25, 0x5c, 0xff, 0xc3, 0x6e, 0xfc, 0xaa, 0x1e, 0x2a,
  0x48, 0x11, 0x1c, 0x36, 0x68, 0x78, 0x86, 0x79, 0x30, 0xc3, 0xd6, 0xde, 0xbc, 0x3a, 0x2a,
  0x6d, 0x1e, 0x46, 0xdd, 0xe0, 0x80, 0x1e, 0x44, 0x3b, 0x6f, 0xaf, 0x31, 0xda, 0xa2, 0xbd,
  0x77, 0x06, 0x56, 0xc0, 0xb7, 0x92, 0x4b, 0x37, 0xc0, 0xfc, 0xc2, 0xd5, 0xfb, 0xa8, 0xda,
  0xf5, 0x57, 0xa8, 0x18, 0xc0, 0xdf, 0xe7, 0xaa, 0x2a, 0xe0, 0x7c, 0x6f, 0x77, 0xb1, 0x26,
  0xba, 0xf9, 0x2e, 0x1d, 0x16, 0xcb, 0xb8, 0xa2, 0x44, 0xd5, 0x2f, 0x1a, 0x79, 0x74, 0x87,
  0x4b, 0x00, 0xc9, 0x4a, 0x3a, 0x65, 0x8f, 0xe6, 0x5d, 0xe5, 0x0a, 0x77, 0xd8, 0x1a, 0x14,
  0x41, 0x75, 0xb1, 0xe2, 0x50, 0x2c, 0x93, 0x38, 0x2b, 0x6d, 0xf3, 0xf6, 0xdb, 0x1f, 0xcd,
  0xff, 0x14, 0x70, 0xe7, 0x16, 0xe8, 0x3d, 0xf0, 0xe3, 0xbc, 0x5e, 0xb6, 0x3f, 0xcc, 0x81,
  0x24, 0x67, 0xf3, 0x97, 0x3b, 0xfe, 0x3a, 0x96, 0x85, 0xdf, 0xe4, 0x6e, 0x3c, 0x85, 0x05,
  0x0e, 0xa3, 0x2b, 0x07, 0xc8, 0xbf, 0xe5, 0x13, 0x82, 0x62, 0x08, 0x61, 0x69, 0x4b, 0x47,
  0x62, 0x73, 0x44, 0x64, 0x8e, 0xe2, 0x91, 0xa6, 0x9a, 0xb7, 0xe9, 0x04, 0xb6, 0x54, 0x0c,
  0xc5, 0xa9, 0x47, 0xa6, 0xc9, 0x08, 0xfe, 0x4e, 0xa6, 0xcc, 0x8a, 0x5b, 0x90, 0x6f, 0x2b,
  0x3f, 0xb6, 0x0a, 0x96, 0xc0, 0x78, 0x58, 0x3c, 0x76, 0x6d, 0x94, 0x1a, 0xe4, 0x4e, 0xb8,
  0x38, 0xbb, 0xf5, 0xeb, 0x29, 0xd8, 0xb0, 0xf3, 0x15, 0x1e, 0x99, 0x96, 0x3c, 0x5d, 0x63,
  0xd5, 0xb1, 0xad, 0x52, 0xb8, 0x55, 0x70, 0x75, 0x3e, 0x1a, 0xd5, 0xda, 0xf6, 0x7a, 0x48,
  0x7d, 0x44, 0x41, 0xf9, 0x11, 0xce, 0xd7, 0xca, 0xa5, 0x3d, 0x7a, 0x79, 0x7e, 0x7d, 0x25,
  0x1b, 0x77, 0xbc, 0xf7, 0xc7, 0x0f, 0x84, 0x95, 0x10, 0x92, 0x67, 0x15, 0x11, 0x5a, 0x5e,
  0x41, 0x66, 0x0f, 0x38, 0x03, 0xb2, 0xf1, 0x5d, 0xf8, 0xab, 0xc0, 0x02, 0x76, 0x84, 0x28,
  0xf4, 0x9d, 0x56, 0x46, 0x60, 0x20, 0xdb, 0x68, 0xa7, 0xbb, 0xee, 0xac, 0x15, 0x01, 0x2f,
  0x20, 0x09, 0xdb, 0xc0, 0x16, 0xa1, 0x89, 0xf9, 0x94, 0x59, 0x00, 0xc1, 0x76, 0xbf, 0xc1,
  0x4d, 0x5d, 0x2d, 0xa9, 0x85, 0x2c, 0xd6, 0xd3, 0x14, 0xcc, 0x02, 0xc3, 0xc2, 0xfa, 0x6b,
  0xb7, 0xa6, 0xef, 0xdd, 0x12, 0x26, 0xa4, 0x63, 0xe3, 0x62, 0xbd, 0x56, 0x8a, 0x52, 0x2b,
  0xb9, 0xdf, 0x09, 0xbc, 0x0e, 0x97, 0xa9, 0xb0, 0x82, 0x46, 0x08, 0xd5, 0x1a, 0x8e, 0x1b,
  0xa7, 0x90, 0x98, 0xb9, 0xbb, 0x3c, 0x17, 0x9a, 0xf2, 0x82, 0xba, 0x64, 0x0a, 0x7f, 0xca,
  0x5a, 0x8c, 0x7c, 0xd3, 0x79, 0x09, 0x5b, 0x26, 0xbb, 0xbd, 0x25, 0xdf, 0x3d, 0x6f, 0x9a,
  0x8f, 0xee, 0x21, 0x66, 0xb0, 0x8d, 0x84, 0x4c, 0x91, 0x45, 0xd4, 0x77, 0x4f, 0xb3, 0x8c,
  0xbc, 0xa8, 0x99, 0xaa, 0x19, 0x53, 0x7c, 0x02, 0x87, 0xbb, 0x0b, 0x7c, 0x1a, 0x2d, 0xdf,
  0x48, 0x44, 0x06, 0xd6, 0x7d, 0x0c, 0x2d, 0x35, 0x76, 0xae, 0xc4, 0x5f, 0x71, 0x85, 0x97,
  0xc4, 0x3d, 0xef, 0x52, 0xbe, 0x00, 0xe4, 0xcd, 0x49, 0xd1, 0xd1, 0x1c, 0x3c, 0xd0, 0x1c,
  0x42, 0xaf, 0xd4, 0xbd, 0x58, 0x34, 0x07, 0x32, 0xee, 0xb9, 0xb5, 0xea, 0xff, 0xd7, 0x8c,
  0x0d, 0x2e, 0x2f, 0xaf, 0x87, 0xbb, 0xe6, 0x52, 0x71, 0x22, 0xf5, 0x25, 0x17, 0xa1, 0x82,
  0x04, 0xc2, 0x4a, 0xbd, 0x57, 0xc6, 0xab, 0xc8, 0x35, 0x0c, 0x3c, 0xd9, 0xc2, 0x43, 0xdb,
  0x27, 0x92, 0xcf, 0xb8, 0x25, 0x60, 0xfa, 0x21, 0x3b, 0x04, 0x52, 0xc8, 0x96, 0xba, 0x74,
  0xe3, 0x67, 0x3e, 0x8e, 0x8d, 0x61, 0x90, 0x92, 0x59, 0xb6, 0x1a, 0x1c, 0x5e, 0x21, 0xc1,
  0x65, 0xe5, 0xa6, 0x34, 0x05, 0x6f, 0xc5, 0x60, 0xb1, 0x83, 0xc1, 0xd5, 0xd5, 0xed, 0xd9,
  0xc7, 0x11, 0x7b, 0x49, 0x7a, 0xf9, 0xf9, 0x84, 0x47, 0x9b, 0xe2, 0xa5, 0x82, 0xe0, 0xc2,
  0x88, 0xd0, 0xb2, 0x58, 0x88, 0x7f, 0x45, 0x09, 0x67, 0x74, 0x61, 0xbf, 0xe6, 0x40, 0xe2,
  0x9d, 0xc2, 0x47, 0x05, 0x89, 0xed, 0xcb, 0xbb, 0xb7, 0x27, 0xe7, 0xdc, 0x7a, 0xfd, 0xbf,
  0xa8, 0xd0, 0xaa, 0x10, 0x39, 0x3c, 0x20, 0xf0, 0xd3, 0x6e, 0xb1, 0x72, 0xf8, 0xe6, 0x0f,
  0xef, 0x37, 0xe5, 0x09, 0x33, 0x5a, 0x83, 0x43, 0x80, 0x4f, 0x65, 0x2f, 0x7c, 0x8c, 0x6a,
  0xa0, 0x82, 0x0c, 0xd4, 0xd4, 0xfa, 0x81, 0x60, 0x3d, 0xdf, 0x06, 0xf1, 0x5f, 0x08, 0x0d,
  0x6d, 0x43, 0xf2, 0xe3, 0x11, 0x7d, 0x80, 0x32, 0xc5, 0xfb, 0xc5, 0xd9, 0x27, 0xec, 0xc6,
  0x4e, 0x65, 0x27, 0x76, 0x87, 0xa6, 0xee, 0xee, 0xd7, 0x8b, 0xd1, 0xa0, 0x5c, 0xb0, 0x42,
  0x13, 0x0e, 0x95, 0x4a, 0xf2, 0x06, 0xc6, 0x43, 0x33, 0xf4, 0xc7, 0xf8, 0xe7, 0x1f, 0xdd,
  0xe4, 0x46, 0x4a, 0x70, 0x39, 0x6c, 0xd0, 0xed, 0xca, 0xbe, 0x60, 0x3b, 0xd1, 0x7b, 0x57,
  0x48, 0xe5, 0x3a, 0x79, 0xc1, 0x69, 0x33, 0x53, 0x1b, 0x80, 0xb8, 0x91, 0x7d, 0xb4, 0xf6,
  0x17, 0x1a, 0x1d, 0x5a, 0x32, 0xd6, 0xcc, 0x71, 0x29, 0x3f, 0x28, 0xbb, 0xf3, 0x5e, 0x71,
  0xb8, 0x43, 0xaf, 0xf8, 0xb9, 0x64, 0xef, 0xc4, 0xa5, 0x6c, 0x08, 0x53, 0xc7, 0x00, 0x10,
  0x39, 0x4f, 0xdd, 0xe4, 0xb6, 0x19, 0x27, 0xfb, 0xb8, 0xf5, 0x32, 0x73, 0xe5, 0xcb, 0x32
]);

/**
 * Original name: netadrtype_t
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Enumerates the network address families supported by Quake II qcommon.
 */
export enum netadrtype_t {
  NA_LOOPBACK,
  NA_BROADCAST,
  NA_IP,
  NA_IPX,
  NA_BROADCAST_IPX
}

/**
 * Original name: netsrc_t
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Distinguishes whether one network path belongs to the client or server side.
 */
export enum netsrc_t {
  NS_CLIENT,
  NS_SERVER
}

/**
 * Original name: netadr_t
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Stores one Quake II network address, including both IP and IPX payloads.
 */
export interface netadr_t {
  type: netadrtype_t;
  ip: Uint8Array;
  ipx: Uint8Array;
  port: number;
}

/**
 * Original name: netchan_t
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Stores one Quake II network channel state including reliable-message staging.
 */
export interface netchan_t {
  fatal_error: qboolean;
  sock: netsrc_t;
  dropped: number;
  last_received: number;
  last_sent: number;
  remote_address: netadr_t;
  qport: number;
  incoming_sequence: number;
  incoming_acknowledged: number;
  incoming_reliable_acknowledged: number;
  incoming_reliable_sequence: number;
  outgoing_sequence: number;
  reliable_sequence: number;
  last_reliable_sequence: number;
  message: sizebuf_t;
  message_buf: Uint8Array;
  reliable_length: number;
  reliable_buf: Uint8Array;
}

/**
 * Original name: N/A
 * Source: N/A (qcommon runtime container)
 * Category: New
 * Purpose: Hold the qcommon-global mutable values declared in `qcommon.h` but not yet owned by narrower ports.
 *
 * Constraints:
 * - Must keep names close to the original globals while remaining explicit.
 *
 * Porting notes:
 * - Represents the C globals `developer`, `dedicated`, `host_speeds`, `log_stats`, `log_stats_file`,
 *   the host-speed timers and `server_state` as explicit host-owned state.
 */
export interface QcommonGlobals {
  developer: cvar_t | null;
  dedicated: cvar_t | null;
  host_speeds: cvar_t | null;
  log_stats: cvar_t | null;
  log_stats_file: string | null;
  timescale: cvar_t | null;
  fixedtime: cvar_t | null;
  logfile_active: cvar_t | null;
  showtrace: cvar_t | null;
  c_traces: number;
  c_brush_traces: number;
  c_pointcontents: number;
  time_before_game: number;
  time_after_game: number;
  time_before_ref: number;
  time_after_ref: number;
  server_state: number;
}

/**
 * Original name: N/A
 * Source: N/A (qcommon control-flow adapter)
 * Category: New
 * Purpose: Represent one qcommon error/quit control-flow signal without depending on C `setjmp`.
 *
 * Constraints:
 * - Must preserve the original error code so callers can branch on `ERR_*`.
 */
export class QcommonSignal extends Error {
  readonly code: number;
  readonly signal: "error" | "quit";

  constructor(signal: "error" | "quit", code: number, message: string) {
    super(message);
    this.name = signal === "quit" ? "ComQuitSignal" : "ComErrorSignal";
    this.signal = signal;
    this.code = code;
  }
}

/**
 * Original name: N/A
 * Source: N/A (qcommon runtime container)
 * Category: New
 * Purpose: Track the tagged zone allocations and lifecycle callbacks that back the remaining `qcommon.h` misc helpers.
 *
 * Constraints:
 * - Zone allocations must stay zero-filled and individually freeable by reference.
 */
export interface QcommonMiscRuntime {
  initialized: qboolean;
  last_frame_msec: number;
  recursive_error: qboolean;
  zone_allocations: Map<Uint8Array, { tag: number; size: number }>;
  hooks: {
    onPrintf?: (message: string) => void;
    onError?: (code: number, message: string) => void;
    onQuit?: () => void;
    onInit?: () => void;
    onFrame?: (msec: number) => void;
    onShutdown?: () => void;
  };
}

/**
 * Original name: N/A
 * Source: N/A (qcommon debug runtime record)
 * Category: New
 * Purpose: Preserve one debug-graph sample emitted through `SCR_DebugGraph`.
 *
 * Constraints:
 * - Must retain insertion order so later consumers can replay the trace.
 */
export interface DebugGraphSample {
  value: number;
  color: number;
}

/**
 * Original name: N/A
 * Source: N/A (qcommon host callback adapter)
 * Category: New
 * Purpose: Hold the host callbacks referenced by the final system/client/server declaration tail of `qcommon.h`.
 *
 * Constraints:
 * - Every callback must be optional so the runtime can be assembled incrementally.
 */
export interface QcommonHostHooks {
  sysInit?: () => void;
  sysAppActivate?: () => void;
  sysUnloadGame?: () => void;
  sysGetGameAPI?: (parms: unknown) => unknown;
  sysConsoleInput?: () => string | null;
  sysConsoleOutput?: (text: string) => void;
  sysSendKeyEvents?: () => void;
  sysQuit?: () => never;
  sysGetClipboardData?: () => string | null;
  sysCopyProtect?: () => void;
  clInit?: () => void;
  clDrop?: () => void;
  clShutdown?: () => void;
  clFrame?: (msec: number) => void;
  conPrint?: (text: string) => void;
  scrBeginLoadingPlaque?: () => void;
  svInit?: () => void;
  svShutdown?: (finalmsg: string, reconnect: qboolean) => void;
  svFrame?: (msec: number) => void;
  scrDebugGraph?: (value: number, color: number) => void;
}

/**
 * Original name: N/A
 * Source: N/A (qcommon host runtime container)
 * Category: New
 * Purpose: Hold the explicit runtime that backs the final host/client/server declaration tail of `qcommon.h`.
 *
 * Constraints:
 * - Must keep debug-graph samples explicit for deterministic verification.
 */
export interface QcommonHostRuntime {
  hooks: QcommonHostHooks;
  debugGraph: DebugGraphSample[];
}

/**
 * Original name: N/A
 * Source: N/A (qcommon network packet adapter)
 * Category: New
 * Purpose: Describe one host-level packet used by the qcommon network runtime hooks.
 *
 * Constraints:
 * - Must preserve payload bytes and source address without reinterpretation.
 */
export interface NetPacket {
  from: netadr_t;
  data: Uint8Array;
}

/**
 * Original name: N/A
 * Source: N/A (qcommon network hook adapter)
 * Category: New
 * Purpose: Hold the host callbacks needed by the qcommon network port.
 *
 * Constraints:
 * - Transport access must stay injectable so the port remains platform-neutral.
 */
export interface QcommonNetHooks {
  now?: () => number;
  config?: (multiplayer: qboolean) => void;
  sendPacket?: (sock: netsrc_t, data: Uint8Array, to: netadr_t) => void;
  getPacket?: (sock: netsrc_t) => NetPacket | null;
  sleep?: (msec: number) => void;
  onPrintf?: (message: string) => void;
}

/**
 * Original name: N/A
 * Source: N/A (qcommon network runtime container)
 * Category: New
 * Purpose: Track the mutable qcommon network globals declared in `qcommon.h`.
 *
 * Constraints:
 * - Must preserve explicit `net_from`, `net_message` and `net_message_buffer` state.
 */
export interface QcommonNetRuntime {
  hooks: QcommonNetHooks;
  showpackets: qboolean;
  showdrop: qboolean;
  qport: number;
  showpacketsCvar: cvar_t | null;
  showdropCvar: cvar_t | null;
  qportCvar: cvar_t | null;
  multiplayer: qboolean;
  net_from: netadr_t;
  net_message: sizebuf_t;
  net_message_buffer: Uint8Array;
}

/**
 * Original name: N/A
 * Source: N/A (qcommon runtime factory)
 * Category: New
 * Purpose: Create the default qcommon global state not yet owned by narrower ports.
 */
export function createQcommonGlobals(): QcommonGlobals {
  return {
    developer: null,
    dedicated: null,
    host_speeds: null,
    log_stats: null,
    log_stats_file: null,
    timescale: null,
    fixedtime: null,
    logfile_active: null,
    showtrace: null,
    c_traces: 0,
    c_brush_traces: 0,
    c_pointcontents: 0,
    time_before_game: 0,
    time_after_game: 0,
    time_before_ref: 0,
    time_after_ref: 0,
    server_state: 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (qcommon runtime factory)
 * Category: New
 * Purpose: Create the explicit runtime used by the remaining qcommon misc helper ports.
 */
export function createQcommonMiscRuntime(
  hooks: QcommonMiscRuntime["hooks"] = {}
): QcommonMiscRuntime {
  return {
    initialized: false,
    last_frame_msec: 0,
    recursive_error: false,
    zone_allocations: new Map(),
    hooks
  };
}

/**
 * Original name: N/A
 * Source: N/A (qcommon runtime factory)
 * Category: New
 * Purpose: Create the runtime that backs the final system/client/server declaration tail of `qcommon.h`.
 */
export function createQcommonHostRuntime(hooks: QcommonHostHooks = {}): QcommonHostRuntime {
  return {
    hooks,
    debugGraph: []
  };
}

/**
 * Original name: N/A
 * Source: N/A (qcommon runtime factory)
 * Category: New
 * Purpose: Create the explicit runtime used by the `NET_*` and `Netchan_*` qcommon ports.
 */
export function createQcommonNetRuntime(hooks: QcommonNetHooks = {}): QcommonNetRuntime {
  const net_message_buffer = new Uint8Array(MAX_MSGLEN);

  return {
    hooks,
    showpackets: false,
    showdrop: false,
    qport: 0,
    showpacketsCvar: null,
    showdropCvar: null,
    qportCvar: null,
    multiplayer: false,
    net_from: createNetAdr(),
    net_message: createSizeBuffer(net_message_buffer),
    net_message_buffer
  };
}

/**
 * Original name: N/A
 * Source: N/A (qcommon network value factory)
 * Category: New
 * Purpose: Create one zero-initialized `netadr_t` value.
 */
export function createNetAdr(type = netadrtype_t.NA_LOOPBACK): netadr_t {
  return {
    type,
    ip: new Uint8Array(4),
    ipx: new Uint8Array(10),
    port: 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (qcommon network value factory)
 * Category: New
 * Purpose: Create one zero-initialized `netchan_t` value with correctly sized message buffers.
 */
export function createNetchan(sock = netsrc_t.NS_CLIENT): netchan_t {
  const message_buf = new Uint8Array(MAX_MSGLEN - 16);
  return {
    fatal_error: false,
    sock,
    dropped: 0,
    last_received: 0,
    last_sent: 0,
    remote_address: createNetAdr(),
    qport: 0,
    incoming_sequence: 0,
    incoming_acknowledged: 0,
    incoming_reliable_acknowledged: 0,
    incoming_reliable_sequence: 0,
    outgoing_sequence: 0,
    reliable_sequence: 0,
    last_reliable_sequence: 0,
    message: {
      allowoverflow: false,
      overflowed: false,
      data: message_buf,
      maxsize: message_buf.length,
      cursize: 0,
      readcount: 0
    },
    message_buf,
    reliable_length: 0,
    reliable_buf: new Uint8Array(MAX_MSGLEN - 16)
  };
}

/**
 * Original name: NET_Init
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes the qcommon network runtime globals.
 */
export function NET_Init(runtime: QcommonNetRuntime): void {
  runtime.qport = (runtime.hooks.now?.() ?? Date.now()) & 0xffff;
  runtime.net_from = createNetAdr();
  runtime.net_message = createSizeBuffer(runtime.net_message_buffer);
}

/**
 * Original name: NET_Shutdown
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Resets the qcommon network runtime transport state.
 */
export function NET_Shutdown(runtime: QcommonNetRuntime): void {
  runtime.multiplayer = false;
  runtime.net_from = createNetAdr();
  runtime.net_message = createSizeBuffer(runtime.net_message_buffer);
}

/**
 * Original name: NET_Config
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies the active multiplayer transport mode to the host transport hooks.
 */
export function NET_Config(runtime: QcommonNetRuntime, multiplayer: qboolean): void {
  runtime.multiplayer = multiplayer;
  runtime.hooks.config?.(multiplayer);
}

/**
 * Original name: NET_GetPacket
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Pulls one packet from the host transport into `net_from` and `net_message`.
 */
export function NET_GetPacket(
  runtime: QcommonNetRuntime,
  sock: netsrc_t,
  net_from = runtime.net_from,
  net_message = runtime.net_message
): qboolean {
  const packet = runtime.hooks.getPacket?.(sock) ?? null;
  if (!packet) {
    return false;
  }

  copyNetAdr(net_from, packet.from);
  const length = Math.min(packet.data.length, net_message.maxsize);
  SZ_Clear(net_message);
  SZ_Write(net_message, packet.data.subarray(0, length));
  MSG_BeginReading(net_message);
  return true;
}

/**
 * Original name: NET_SendPacket
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Sends one raw packet through the injected host transport.
 */
export function NET_SendPacket(
  runtime: QcommonNetRuntime,
  sock: netsrc_t,
  length: number,
  data: Uint8Array,
  to: netadr_t
): void {
  runtime.hooks.sendPacket?.(sock, data.subarray(0, length), cloneNetAdr(to));
}

/**
 * Original name: NET_CompareAdr
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns true when both the base address and port match.
 */
export function NET_CompareAdr(a: netadr_t, b: netadr_t): qboolean {
  if (a.type !== b.type) {
    return false;
  }

  if (a.type === netadrtype_t.NA_LOOPBACK) {
    return true;
  }

  if (a.type === netadrtype_t.NA_IP) {
    return compareBytes(a.ip, b.ip) && a.port === b.port;
  }

  if (a.type === netadrtype_t.NA_IPX || a.type === netadrtype_t.NA_BROADCAST_IPX) {
    return compareBytes(a.ipx, b.ipx) && a.port === b.port;
  }

  return a.port === b.port;
}

/**
 * Original name: NET_CompareBaseAdr
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns true when the address family and address bytes match, ignoring the port.
 */
export function NET_CompareBaseAdr(a: netadr_t, b: netadr_t): qboolean {
  if (a.type !== b.type) {
    return false;
  }

  if (a.type === netadrtype_t.NA_LOOPBACK) {
    return true;
  }

  if (a.type === netadrtype_t.NA_IP || a.type === netadrtype_t.NA_BROADCAST) {
    return compareBytes(a.ip, b.ip);
  }

  if (a.type === netadrtype_t.NA_IPX || a.type === netadrtype_t.NA_BROADCAST_IPX) {
    return compareBytes(a.ipx, b.ipx);
  }

  return false;
}

/**
 * Original name: NET_IsLocalAddress
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns true when the address targets the loopback transport.
 */
export function NET_IsLocalAddress(adr: netadr_t): qboolean {
  return adr.type === netadrtype_t.NA_LOOPBACK;
}

/**
 * Original name: NET_AdrToString
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Formats one network address in the canonical Quake-friendly debug form.
 */
export function NET_AdrToString(a: netadr_t): string {
  switch (a.type) {
    case netadrtype_t.NA_LOOPBACK:
      return "loopback";
    case netadrtype_t.NA_BROADCAST:
    case netadrtype_t.NA_IP:
      return `${a.ip[0]}.${a.ip[1]}.${a.ip[2]}.${a.ip[3]}:${a.port}`;
    case netadrtype_t.NA_IPX:
    case netadrtype_t.NA_BROADCAST_IPX:
      return `${bytesToHex(a.ipx)}:${a.port}`;
    default:
      return "unknown";
  }
}

/**
 * Original name: NET_StringToAdr
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Parses loopback and dotted-quad host strings into a `netadr_t`.
 */
export function NET_StringToAdr(value: string, out: netadr_t = createNetAdr()): qboolean {
  if (value === "localhost" || value === "loopback") {
    out.type = netadrtype_t.NA_LOOPBACK;
    out.port = 0;
    out.ip.fill(0);
    out.ipx.fill(0);
    return true;
  }

  const match = /^(\d{1,3})(?:\.(\d{1,3}))?(?:\.(\d{1,3}))?(?:\.(\d{1,3}))?(?::(\d+))?$/.exec(value.trim());
  if (!match) {
    return false;
  }

  const octets = match.slice(1, 5).map((part) => (part === undefined ? NaN : Number.parseInt(part, 10)));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  out.type = netadrtype_t.NA_IP;
  out.ip.set(octets as number[]);
  out.ipx.fill(0);
  out.port = match[5] ? Number.parseInt(match[5], 10) : 0;
  return true;
}

/**
 * Original name: NET_Sleep
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Forwards the host sleep hint used by dedicated-server style polling loops.
 */
export function NET_Sleep(runtime: QcommonNetRuntime, msec: number): void {
  runtime.hooks.sleep?.(msec);
}

export {
  Netchan_CanReliable,
  Netchan_Init,
  Netchan_NeedReliable,
  Netchan_OutOfBand,
  Netchan_OutOfBandPrint,
  Netchan_Process,
  Netchan_Setup,
  Netchan_Transmit
} from "./net_chan.js";

/**
 * Original name: CopyString
 * Source: qcommon/common.c / qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns one owned copy of the provided string.
 */
export function CopyString(input: string): string {
  return (` ${input}`).slice(1);
}

/**
 * Original name: Com_ServerState
 * Source: qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the current qcommon server-state integer.
 */
export function Com_ServerState(globals: QcommonGlobals): number {
  return globals.server_state;
}

/**
 * Original name: Com_SetServerState
 * Source: qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Sets the current qcommon server-state integer.
 */
export function Com_SetServerState(globals: QcommonGlobals, state: number): void {
  globals.server_state = state;
}

/**
 * Original name: frand
 * Source: qcommon/common.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns one random float in the `[0, 1]` range using the original 15-bit `rand()` quantization.
 *
 * Porting notes:
 * - Preserves `(rand() & 32767) / 32767` quantization, but not the libc RNG sequence.
 */
export function frand(): number {
  return (Math.floor(Math.random() * 0x8000) & 32767) * (1.0 / 32767);
}

/**
 * Original name: crand
 * Source: qcommon/common.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns one random float in the `[-1, 1]` range using the original 15-bit `rand()` quantization.
 *
 * Porting notes:
 * - Preserves `(rand() & 32767) * (2 / 32767) - 1` quantization, but not the libc RNG sequence.
 */
export function crand(): number {
  return (Math.floor(Math.random() * 0x8000) & 32767) * (2.0 / 32767) - 1;
}

/**
 * Original name: COM_BlockSequenceCheckByte
 * Source: qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Preserves the original disabled legacy proxy checksum entry point, which immediately raises a fatal error.
 *
 * Porting notes:
 * - The live C implementation calls `Sys_Error` before the obsolete `#if 0` checksum body can run.
 */
export function COM_BlockSequenceCheckByte(
  _base: Uint8Array,
  _length: number,
  _sequence: number,
  _challenge: number
): never {
  throw new Error("COM_BlockSequenceCheckByte called");
}

/**
 * Original name: COM_BlockSequenceCRCByte
 * Source: qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Computes the Quake II sequence-protection byte for the given block prefix.
 */
export function COM_BlockSequenceCRCByte(base: Uint8Array, length: number, sequence: number): byte {
  if (sequence < 0) {
    throw new Error("COM_BlockSequenceCRCByte: sequence < 0");
  }

  const start = sequence % (chktbl.length - 4);
  const clampedLength = Math.min(length, 60);
  const chkb = new Uint8Array(clampedLength + 4);
  chkb.set(base.subarray(0, clampedLength), 0);
  chkb[clampedLength] = chktbl[start];
  chkb[clampedLength + 1] = chktbl[start + 1];
  chkb[clampedLength + 2] = chktbl[start + 2];
  chkb[clampedLength + 3] = chktbl[start + 3];

  const crc = CRC_Block(chkb);
  let sum = 0;
  for (let index = 0; index < chkb.length; index += 1) {
    sum += chkb[index];
  }

  return ((crc ^ sum) & 0xff) as byte;
}

/**
 * Original name: Com_DPrintf
 * Source: qcommon/common.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits one diagnostic line only when the `developer` cvar is enabled.
 */
export function Com_DPrintf(
  globals: QcommonGlobals,
  runtime: QcommonMiscRuntime,
  message: string
): void {
  if (!globals.developer || !globals.developer.value) {
    return;
  }

  runtime.hooks.onPrintf?.(message);
}

/**
 * Original name: Com_Error
 * Source: qcommon/common.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Raises one qcommon error signal with the original `ERR_*` code.
 *
 * Porting notes:
 * - Uses a structured exception instead of `setjmp` / `longjmp`.
 */
export function Com_Error(runtime: QcommonMiscRuntime, code: number, message: string): never {
  if (runtime.recursive_error) {
    throw new Error(`recursive error after: ${message}`);
  }

  runtime.recursive_error = true;
  runtime.hooks.onError?.(code, message);
  if (code === ERR_DROP) {
    runtime.recursive_error = false;
  }
  throw new QcommonSignal("error", code, message);
}

/**
 * Original name: Com_Quit
 * Source: qcommon/common.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Raises one quit control-flow signal for the outer host loop.
 */
export function Com_Quit(runtime: QcommonMiscRuntime): never {
  runtime.hooks.onQuit?.();
  throw new QcommonSignal("quit", ERR_QUIT, "Com_Quit");
}

/**
 * Original name: Z_TagMalloc
 * Source: qcommon/common.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Allocates one zero-filled tagged zone block.
 */
export function Z_TagMalloc(runtime: QcommonMiscRuntime, size: number, tag: number): Uint8Array {
  const clampedSize = Math.max(0, size | 0);
  const allocation = new Uint8Array(clampedSize);
  runtime.zone_allocations.set(allocation, { tag, size: clampedSize });
  return allocation;
}

/**
 * Original name: Z_Malloc
 * Source: qcommon/common.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Allocates one zero-filled default-tag zone block.
 */
export function Z_Malloc(runtime: QcommonMiscRuntime, size: number): Uint8Array {
  return Z_TagMalloc(runtime, size, 0);
}

/**
 * Original name: Z_Free
 * Source: qcommon/common.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Frees one previously allocated zone block by reference.
 */
export function Z_Free(runtime: QcommonMiscRuntime, ptr: Uint8Array): void {
  if (!runtime.zone_allocations.delete(ptr)) {
    throw new Error("Z_Free: bad allocation reference");
  }
}

/**
 * Original name: Z_FreeTags
 * Source: qcommon/common.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Frees all zone blocks carrying the requested tag.
 */
export function Z_FreeTags(runtime: QcommonMiscRuntime, tag: number): void {
  for (const [allocation, metadata] of runtime.zone_allocations) {
    if (metadata.tag === tag) {
      runtime.zone_allocations.delete(allocation);
    }
  }
}

/**
 * Original name: Z_Stats_f
 * Source: qcommon/common.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Prints the current tracked zone byte/block counters.
 *
 * Porting notes:
 * - Counts payload bytes only because JavaScript allocations do not expose the C `zhead_t` header.
 */
export function Z_Stats_f(runtime: QcommonMiscRuntime): string {
  let bytes = 0;
  let count = 0;

  for (const metadata of runtime.zone_allocations.values()) {
    bytes += metadata.size;
    count += 1;
  }

  const message = `${bytes} bytes in ${count} blocks\n`;
  runtime.hooks.onPrintf?.(message);
  return message;
}

export interface QcommonLifecycleOptions {
  cmd?: CommandRuntime;
  cvar?: CvarRuntime;
  globals?: QcommonGlobals;
  now?: () => number;
  consoleInput?: () => string | null;
  endLoadingPlaque?: () => void;
  dedicatedDefault?: "0" | "1";
}

function normalizeLifecycleOptions(options?: CommandRuntime | QcommonLifecycleOptions): QcommonLifecycleOptions {
  if (!options) {
    return {};
  }

  if ("cmd_text" in options) {
    return { cmd: options };
  }

  return options;
}

function requireLifecycleCvar(cvar: cvar_t | null, name: string): cvar_t {
  if (!cvar) {
    throw new Error(`Qcommon_Init: failed to create ${name}`);
  }

  return cvar;
}

/**
 * Original name: Com_Error_f
 * Source: qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Throws a fatal qcommon error using the command's first argument.
 *
 * Porting notes:
 * - Takes explicit misc and command runtimes instead of reading file-static globals.
 */
export function Com_Error_f(runtime: QcommonMiscRuntime, cmd: CommandRuntime): never {
  return Com_Error(runtime, ERR_FATAL, Cmd_Argv(cmd, 1));
}

/**
 * Original name: Qcommon_Init
 * Source: qcommon/common.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Marks the qcommon bootstrap stage as initialized, registers lifecycle commands and creates core qcommon cvars when runtimes are supplied.
 *
 * Porting notes:
 * - The full subsystem call chain remains distributed across the narrower ports already attached to `cmd`, `cvar`, `filesystem` and `runtime`.
 * - Accepts either the historical command runtime argument or an options bag with command, cvar and qcommon-global state.
 */
export function Qcommon_Init(runtime: QcommonMiscRuntime, options?: CommandRuntime | QcommonLifecycleOptions): void {
  const lifecycle = normalizeLifecycleOptions(options);
  runtime.initialized = true;
  if (lifecycle.cmd) {
    Cmd_AddCommand(lifecycle.cmd, "z_stats", () => {
      Z_Stats_f(runtime);
    });
    Cmd_AddCommand(lifecycle.cmd, "error", () => {
      Com_Error_f(runtime, lifecycle.cmd!);
    });
  }
  if (lifecycle.cvar && lifecycle.globals) {
    lifecycle.globals.host_speeds = requireLifecycleCvar(Cvar_Get(lifecycle.cvar, "host_speeds", "0", 0), "host_speeds");
    lifecycle.globals.log_stats = requireLifecycleCvar(Cvar_Get(lifecycle.cvar, "log_stats", "0", 0), "log_stats");
    lifecycle.globals.developer = requireLifecycleCvar(Cvar_Get(lifecycle.cvar, "developer", "0", 0), "developer");
    lifecycle.globals.timescale = requireLifecycleCvar(Cvar_Get(lifecycle.cvar, "timescale", "1", 0), "timescale");
    lifecycle.globals.fixedtime = requireLifecycleCvar(Cvar_Get(lifecycle.cvar, "fixedtime", "0", 0), "fixedtime");
    lifecycle.globals.logfile_active = requireLifecycleCvar(Cvar_Get(lifecycle.cvar, "logfile", "0", 0), "logfile");
    lifecycle.globals.showtrace = requireLifecycleCvar(Cvar_Get(lifecycle.cvar, "showtrace", "0", 0), "showtrace");
    lifecycle.globals.dedicated = requireLifecycleCvar(
      Cvar_Get(lifecycle.cvar, "dedicated", lifecycle.dedicatedDefault ?? "0", CVAR_NOSET),
      "dedicated"
    );
    const version = `${VERSION.toFixed(2)} ${CPUSTRING} TypeScript ${BUILDSTRING}`;
    Cvar_Get(lifecycle.cvar, "version", version, CVAR_SERVERINFO | CVAR_NOSET);
  }
  runtime.hooks.onInit?.();
}

/**
 * Original name: Qcommon_Frame
 * Source: qcommon/common.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies qcommon frame cvars, pumps console/command input, records one frame tick and forwards it to the optional host hook.
 *
 * Porting notes:
 * - Server and client frame bodies remain behind `onFrame` because the TypeScript host owns their concrete runtime objects.
 * - `log_stats_file` is represented as a marker string instead of a native file handle.
 */
export function Qcommon_Frame(runtime: QcommonMiscRuntime, msec: number, options?: QcommonLifecycleOptions): void {
  const lifecycle = normalizeLifecycleOptions(options);
  let frameMsec = msec;

  if (lifecycle.globals?.log_stats?.modified) {
    lifecycle.globals.log_stats.modified = false;
    lifecycle.globals.log_stats_file = lifecycle.globals.log_stats.value ? "stats.log" : null;
  }

  const fixedtime = lifecycle.globals?.fixedtime?.value ?? 0;
  const timescale = lifecycle.globals?.timescale?.value ?? 0;
  if (fixedtime !== 0) {
    frameMsec = fixedtime;
  } else if (timescale !== 0) {
    frameMsec *= timescale;
    if (frameMsec < 1) {
      frameMsec = 1;
    }
  }

  if ((lifecycle.globals?.showtrace?.value ?? 0) !== 0) {
    runtime.hooks.onPrintf?.(
      `${lifecycle.globals!.c_traces.toString().padStart(4)} traces  ${lifecycle.globals!.c_pointcontents.toString().padStart(4)} points\n`
    );
    lifecycle.globals!.c_traces = 0;
    lifecycle.globals!.c_brush_traces = 0;
    lifecycle.globals!.c_pointcontents = 0;
  }

  if (lifecycle.cmd) {
    while (true) {
      const text = lifecycle.consoleInput?.() ?? null;
      if (!text) {
        break;
      }
      Cbuf_AddText(lifecycle.cmd, `${text}\n`);
    }
    Cbuf_Execute(lifecycle.cmd);
  }

  const hostSpeeds = lifecycle.globals?.host_speeds?.value ?? 0;
  const timeBefore = hostSpeeds && lifecycle.now ? lifecycle.now() : 0;
  runtime.last_frame_msec = frameMsec | 0;
  runtime.hooks.onFrame?.(runtime.last_frame_msec);
  if (hostSpeeds && lifecycle.now) {
    const timeAfter = lifecycle.now();
    const all = timeAfter - timeBefore;
    const gm = lifecycle.globals!.time_after_game - lifecycle.globals!.time_before_game;
    const rf = lifecycle.globals!.time_after_ref - lifecycle.globals!.time_before_ref;
    runtime.hooks.onPrintf?.(
      `all:${all.toString().padStart(3)} sv:${"0".padStart(3)} gm:${gm.toString().padStart(3)} cl:${all.toString().padStart(3)} rf:${rf.toString().padStart(3)}\n`
    );
  }
}

/**
 * Original name: Qcommon_Shutdown
 * Source: qcommon/common.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Marks qcommon as shut down and releases tracked zone allocations.
 */
export function Qcommon_Shutdown(runtime: QcommonMiscRuntime): void {
  runtime.initialized = false;
  runtime.zone_allocations.clear();
  runtime.hooks.onShutdown?.();
}

/**
 * Original name: Sys_Init
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Forwards system initialization to the attached host implementation.
 */
export function Sys_Init(runtime: QcommonHostRuntime): void {
  runtime.hooks.sysInit?.();
}

/**
 * Original name: Sys_AppActivate
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Notifies the host layer that the application should be considered active.
 */
export function Sys_AppActivate(runtime: QcommonHostRuntime): void {
  runtime.hooks.sysAppActivate?.();
}

/**
 * Original name: Sys_UnloadGame
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Requests unloading the current game module through the host layer.
 */
export function Sys_UnloadGame(runtime: QcommonHostRuntime): void {
  runtime.hooks.sysUnloadGame?.();
}

/**
 * Original name: Sys_GetGameAPI
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Loads the game module entrypoint through the attached host implementation.
 */
export function Sys_GetGameAPI(runtime: QcommonHostRuntime, parms: unknown): unknown {
  return runtime.hooks.sysGetGameAPI?.(parms) ?? null;
}

/**
 * Original name: Sys_ConsoleInput
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Reads one console line from the attached host implementation.
 */
export function Sys_ConsoleInput(runtime: QcommonHostRuntime): string | null {
  return runtime.hooks.sysConsoleInput?.() ?? null;
}

/**
 * Original name: Sys_ConsoleOutput
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits one console line to the attached host implementation.
 */
export function Sys_ConsoleOutput(runtime: QcommonHostRuntime, text: string): void {
  runtime.hooks.sysConsoleOutput?.(text);
}

/**
 * Original name: Sys_SendKeyEvents
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Polls or forwards pending host key events.
 */
export function Sys_SendKeyEvents(runtime: QcommonHostRuntime): void {
  runtime.hooks.sysSendKeyEvents?.();
}

/**
 * Original name: Sys_Quit
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Exits through the attached host implementation or raises a fallback quit signal.
 */
export function Sys_Quit(runtime: QcommonHostRuntime): never {
  if (runtime.hooks.sysQuit) {
    return runtime.hooks.sysQuit();
  }

  throw new QcommonSignal("quit", ERR_QUIT, "Sys_Quit");
}

/**
 * Original name: Sys_GetClipboardData
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns one clipboard text payload from the host layer when available.
 */
export function Sys_GetClipboardData(runtime: QcommonHostRuntime): string | null {
  return runtime.hooks.sysGetClipboardData?.() ?? null;
}

/**
 * Original name: Sys_CopyProtect
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Forwards the legacy copy-protect hook to the attached host implementation.
 */
export function Sys_CopyProtect(runtime: QcommonHostRuntime): void {
  runtime.hooks.sysCopyProtect?.();
}

/**
 * Original name: CL_Init
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Forwards client initialization to the attached client-side implementation.
 */
export function CL_Init(runtime: QcommonHostRuntime): void {
  runtime.hooks.clInit?.();
}

/**
 * Original name: CL_Drop
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Forwards the client drop/disconnect action to the attached implementation.
 */
export function CL_Drop(runtime: QcommonHostRuntime): void {
  runtime.hooks.clDrop?.();
}

/**
 * Original name: CL_Shutdown
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Forwards client shutdown to the attached implementation.
 */
export function CL_Shutdown(runtime: QcommonHostRuntime): void {
  runtime.hooks.clShutdown?.();
}

/**
 * Original name: CL_Frame
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Advances the attached client implementation by one frame.
 */
export function CL_Frame(runtime: QcommonHostRuntime, msec: number): void {
  runtime.hooks.clFrame?.(msec);
}

/**
 * Original name: Con_Print
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits one console-print line through the attached client/UI implementation.
 */
export function Con_Print(runtime: QcommonHostRuntime, text: string): void {
  runtime.hooks.conPrint?.(text);
}

/**
 * Original name: SCR_BeginLoadingPlaque
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Starts the loading plaque through the attached client/screen implementation.
 */
export function SCR_BeginLoadingPlaque(runtime: QcommonHostRuntime): void {
  runtime.hooks.scrBeginLoadingPlaque?.();
}

/**
 * Original name: SV_Init
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Forwards server initialization to the attached server implementation.
 */
export function SV_Init(runtime: QcommonHostRuntime): void {
  runtime.hooks.svInit?.();
}

/**
 * Original name: SV_Shutdown
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Forwards server shutdown to the attached server implementation.
 */
export function SV_Shutdown(runtime: QcommonHostRuntime, finalmsg: string, reconnect: qboolean): void {
  runtime.hooks.svShutdown?.(finalmsg, reconnect);
}

/**
 * Original name: SV_Frame
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Advances the attached server implementation by one frame.
 */
export function SV_Frame(runtime: QcommonHostRuntime, msec: number): void {
  runtime.hooks.svFrame?.(msec);
}

/**
 * Original name: SCR_DebugGraph
 * Source: qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Records one debug-graph sample and forwards it to the attached host/client implementation.
 */
export function SCR_DebugGraph(runtime: QcommonHostRuntime, value: number, color: number): void {
  runtime.debugGraph.push({ value, color });
  runtime.hooks.scrDebugGraph?.(value, color);
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Behavior:
 * - Compares two byte arrays with exact length and value matching.
 */
function compareBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }

  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }

  return true;
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Behavior:
 * - Clones one `netadr_t` value and duplicates its backing byte arrays.
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
 * Source: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Behavior:
 * - Copies one `netadr_t` into another existing structure without reallocating it.
 */
function copyNetAdr(target: netadr_t, source: netadr_t): void {
  target.type = source.type;
  target.ip.set(source.ip);
  target.ipx.set(source.ipx);
  target.port = source.port;
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Behavior:
 * - Formats a byte array as a lowercase hexadecimal string.
 */
function bytesToHex(bytes: Uint8Array): string {
  let result = "";

  for (let index = 0; index < bytes.length; index += 1) {
    result += bytes[index].toString(16).padStart(2, "0");
  }

  return result;
}
