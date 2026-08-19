/**
 * File: messages.ts
 * Source: Quake II original / qcommon/common.c
 * Purpose: Port the core Quake II message read and write primitives used by client and server networking.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Returns JavaScript strings instead of static C buffers.
 * - Uses Uint8Array writes and reads instead of raw pointer arithmetic.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

import {
  MSG_BeginReading,
  SZ_GetSpace,
  SZ_Write,
  type sizebuf_t
} from "../../memory/src/index.js";
import { DotProduct } from "../../math/src/q_shared.js";
import { BYTE_DIRS } from "./anorms.js";
import {
  U_ANGLE1,
  U_ANGLE2,
  U_ANGLE3,
  U_EFFECTS16,
  U_EFFECTS8,
  U_EVENT,
  U_FRAME16,
  U_FRAME8,
  U_MODEL,
  U_MODEL2,
  U_MODEL3,
  U_MODEL4,
  U_MOREBITS1,
  U_MOREBITS2,
  U_MOREBITS3,
  U_NUMBER16,
  U_OLDORIGIN,
  U_ORIGIN1,
  U_ORIGIN2,
  U_ORIGIN3,
  U_RENDERFX16,
  U_RENDERFX8,
  U_SKIN16,
  U_SKIN8,
  U_SOLID,
  U_SOUND
} from "./protocol.js";
import {
  ANGLE2SHORT,
  MAX_EDICTS,
  RF_BEAM,
  SHORT2ANGLE,
  type entity_state_t,
  type usercmd_t,
  type vec3_t
} from "./q_shared.js";

/**
 * Original name: N/A
 * Source: N/A (message string buffer limit)
 * Category: New
 */
const READ_STRING_LIMIT = 2048;

/**
 * Original name: N/A
 * Source: N/A (message coordinate scale helper)
 * Category: New
 */
const COORD_SCALE = 8;

/**
 * Original name: N/A
 * Source: N/A (message angle scale helper)
 * Category: New
 */
const BYTE_ANGLE_SCALE = 256 / 360;

/**
 * Original name: CM_ANGLE1
 * Source: Quake-2-master/qcommon/qcommon.h
 * Category: Adapter
 */
const CM_ANGLE1 = 1 << 0;

/**
 * Original name: CM_ANGLE2
 * Source: Quake-2-master/qcommon/qcommon.h
 * Category: Adapter
 */
const CM_ANGLE2 = 1 << 1;

/**
 * Original name: CM_ANGLE3
 * Source: Quake-2-master/qcommon/qcommon.h
 * Category: Adapter
 */
const CM_ANGLE3 = 1 << 2;

/**
 * Original name: CM_FORWARD
 * Source: Quake-2-master/qcommon/qcommon.h
 * Category: Adapter
 */
const CM_FORWARD = 1 << 3;

/**
 * Original name: CM_SIDE
 * Source: Quake-2-master/qcommon/qcommon.h
 * Category: Adapter
 */
const CM_SIDE = 1 << 4;

/**
 * Original name: CM_UP
 * Source: Quake-2-master/qcommon/qcommon.h
 * Category: Adapter
 */
const CM_UP = 1 << 5;

/**
 * Original name: CM_BUTTONS
 * Source: Quake-2-master/qcommon/qcommon.h
 * Category: Adapter
 */
const CM_BUTTONS = 1 << 6;

/**
 * Original name: CM_IMPULSE
 * Source: Quake-2-master/qcommon/qcommon.h
 * Category: Adapter
 */
const CM_IMPULSE = 1 << 7;

/**
 * Original name: MSG_WriteChar
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Writes a signed 8-bit value into a Quake II message buffer.
 *
 * Porting notes:
 * - Preserves the original one-byte truncation behavior.
 */
export function MSG_WriteChar(sb: sizebuf_t, c: number): void {
  SZ_GetSpace(sb, 1)[0] = c & 0xff;
}

/**
 * Original name: MSG_WriteByte
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Writes an unsigned 8-bit value into a Quake II message buffer.
 *
 * Porting notes:
 * - Preserves the original one-byte truncation behavior.
 */
export function MSG_WriteByte(sb: sizebuf_t, c: number): void {
  SZ_GetSpace(sb, 1)[0] = c & 0xff;
}

/**
 * Original name: MSG_WriteShort
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Writes a signed 16-bit little-endian value into a Quake II message buffer.
 *
 * Porting notes:
 * - Preserves the original low-byte then high-byte write order.
 */
export function MSG_WriteShort(sb: sizebuf_t, c: number): void {
  const buf = SZ_GetSpace(sb, 2);
  buf[0] = c & 0xff;
  buf[1] = (c >> 8) & 0xff;
}

/**
 * Original name: MSG_WriteLong
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Writes a signed 32-bit little-endian value into a Quake II message buffer.
 *
 * Porting notes:
 * - Preserves the original byte order.
 */
export function MSG_WriteLong(sb: sizebuf_t, c: number): void {
  const buf = SZ_GetSpace(sb, 4);
  buf[0] = c & 0xff;
  buf[1] = (c >> 8) & 0xff;
  buf[2] = (c >> 16) & 0xff;
  buf[3] = (c >> 24) & 0xff;
}

/**
 * Original name: MSG_WriteFloat
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Writes a 32-bit IEEE float using Quake II little-endian message storage.
 *
 * Porting notes:
 * - Uses DataView for stable float packing.
 */
export function MSG_WriteFloat(sb: sizebuf_t, f: number): void {
  const encoded = new Uint8Array(4);
  new DataView(encoded.buffer).setFloat32(0, f, true);
  SZ_Write(sb, encoded);
}

/**
 * Original name: MSG_WriteString
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Writes a null-terminated string, or an empty string if the source is nullish.
 *
 * Porting notes:
 * - Accepts null and undefined as JavaScript equivalents of a null C pointer.
 */
export function MSG_WriteString(sb: sizebuf_t, value?: string | null): void {
  if (value === null || value === undefined) {
    SZ_Write(sb, new Uint8Array([0]));
    return;
  }

  const encoded = new Uint8Array(value.length + 1);
  for (let index = 0; index < value.length; index += 1) {
    encoded[index] = value.charCodeAt(index) & 0xff;
  }
  encoded[value.length] = 0;
  SZ_Write(sb, encoded);
}

/**
 * Original name: MSG_WriteCoord
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Writes a coordinate compressed to a signed short at 1/8 precision.
 *
 * Porting notes:
 * - Keeps the original integer truncation behavior.
 */
export function MSG_WriteCoord(sb: sizebuf_t, f: number): void {
  MSG_WriteShort(sb, Math.trunc(f * COORD_SCALE));
}

/**
 * Original name: MSG_WritePos
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Writes a vec3 position using the compressed coordinate format.
 *
 * Porting notes:
 * - Preserves write order x, y, z.
 */
export function MSG_WritePos(sb: sizebuf_t, pos: vec3_t): void {
  MSG_WriteCoord(sb, pos[0]);
  MSG_WriteCoord(sb, pos[1]);
  MSG_WriteCoord(sb, pos[2]);
}

/**
 * Original name: MSG_WriteAngle
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Writes an angle compressed to one byte.
 *
 * Porting notes:
 * - Preserves the original 0-255 wrap behavior.
 */
export function MSG_WriteAngle(sb: sizebuf_t, f: number): void {
  MSG_WriteByte(sb, Math.trunc(f * BYTE_ANGLE_SCALE) & 255);
}

/**
 * Original name: MSG_WriteAngle16
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Writes an angle compressed to a 16-bit Quake II angle value.
 *
 * Porting notes:
 * - Reuses the shared ANGLE2SHORT helper ported from q_shared.h.
 */
export function MSG_WriteAngle16(sb: sizebuf_t, f: number): void {
  MSG_WriteShort(sb, ANGLE2SHORT(f));
}

/**
 * Original name: MSG_WriteDeltaUsercmd
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Delta-encodes one user command against a previous command.
 *
 * Porting notes:
 * - Preserves the original bit layout and unconditional trailing `msec` / `lightlevel` bytes.
 */
export function MSG_WriteDeltaUsercmd(buf: sizebuf_t, from: usercmd_t, cmd: usercmd_t): void {
  let bits = 0;

  if (cmd.angles[0] !== from.angles[0]) {
    bits |= CM_ANGLE1;
  }
  if (cmd.angles[1] !== from.angles[1]) {
    bits |= CM_ANGLE2;
  }
  if (cmd.angles[2] !== from.angles[2]) {
    bits |= CM_ANGLE3;
  }
  if (cmd.forwardmove !== from.forwardmove) {
    bits |= CM_FORWARD;
  }
  if (cmd.sidemove !== from.sidemove) {
    bits |= CM_SIDE;
  }
  if (cmd.upmove !== from.upmove) {
    bits |= CM_UP;
  }
  if (cmd.buttons !== from.buttons) {
    bits |= CM_BUTTONS;
  }
  if (cmd.impulse !== from.impulse) {
    bits |= CM_IMPULSE;
  }

  MSG_WriteByte(buf, bits);

  if ((bits & CM_ANGLE1) !== 0) {
    MSG_WriteShort(buf, cmd.angles[0]);
  }
  if ((bits & CM_ANGLE2) !== 0) {
    MSG_WriteShort(buf, cmd.angles[1]);
  }
  if ((bits & CM_ANGLE3) !== 0) {
    MSG_WriteShort(buf, cmd.angles[2]);
  }
  if ((bits & CM_FORWARD) !== 0) {
    MSG_WriteShort(buf, cmd.forwardmove);
  }
  if ((bits & CM_SIDE) !== 0) {
    MSG_WriteShort(buf, cmd.sidemove);
  }
  if ((bits & CM_UP) !== 0) {
    MSG_WriteShort(buf, cmd.upmove);
  }
  if ((bits & CM_BUTTONS) !== 0) {
    MSG_WriteByte(buf, cmd.buttons);
  }
  if ((bits & CM_IMPULSE) !== 0) {
    MSG_WriteByte(buf, cmd.impulse);
  }

  MSG_WriteByte(buf, cmd.msec);
  MSG_WriteByte(buf, cmd.lightlevel);
}

/**
 * Original name: MSG_WriteDir
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Quantizes one direction vector to the closest Quake byte-dir entry.
 *
 * Porting notes:
 * - Nullish inputs preserve the original zero-byte fallback.
 */
export function MSG_WriteDir(sb: sizebuf_t, dir: vec3_t | null | undefined): void {
  if (!dir) {
    MSG_WriteByte(sb, 0);
    return;
  }

  let bestd = 0;
  let best = 0;

  for (let index = 0; index < BYTE_DIRS.length; index += 1) {
    const d = DotProduct(dir, BYTE_DIRS[index]!);
    if (d > bestd) {
      bestd = d;
      best = index;
    }
  }

  MSG_WriteByte(sb, best);
}

/**
 * Original name: MSG_WriteDeltaEntity
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Writes the delta-compressed network representation of one entity state.
 *
 * Porting notes:
 * - Throws on invalid entity numbers where the original called `Com_Error`.
 */
export function MSG_WriteDeltaEntity(
  from: entity_state_t,
  to: entity_state_t,
  msg: sizebuf_t,
  force: boolean,
  newentity: boolean
): void {
  if (!to.number) {
    throw new Error("MSG_WriteDeltaEntity: unset entity number");
  }
  if (to.number >= MAX_EDICTS) {
    throw new Error("MSG_WriteDeltaEntity: entity number >= MAX_EDICTS");
  }

  let bits = 0;

  if (to.number >= 256) {
    bits |= U_NUMBER16;
  }

  if (to.origin[0] !== from.origin[0]) {
    bits |= U_ORIGIN1;
  }
  if (to.origin[1] !== from.origin[1]) {
    bits |= U_ORIGIN2;
  }
  if (to.origin[2] !== from.origin[2]) {
    bits |= U_ORIGIN3;
  }

  if (to.angles[0] !== from.angles[0]) {
    bits |= U_ANGLE1;
  }
  if (to.angles[1] !== from.angles[1]) {
    bits |= U_ANGLE2;
  }
  if (to.angles[2] !== from.angles[2]) {
    bits |= U_ANGLE3;
  }

  if (to.skinnum !== from.skinnum) {
    if ((to.skinnum >>> 0) < 256) {
      bits |= U_SKIN8;
    } else if ((to.skinnum >>> 0) < 0x10000) {
      bits |= U_SKIN16;
    } else {
      bits |= U_SKIN8 | U_SKIN16;
    }
  }

  if (to.frame !== from.frame) {
    bits |= to.frame < 256 ? U_FRAME8 : U_FRAME16;
  }

  if (to.effects !== from.effects) {
    if (to.effects < 256) {
      bits |= U_EFFECTS8;
    } else if (to.effects < 0x8000) {
      bits |= U_EFFECTS16;
    } else {
      bits |= U_EFFECTS8 | U_EFFECTS16;
    }
  }

  if (to.renderfx !== from.renderfx) {
    if (to.renderfx < 256) {
      bits |= U_RENDERFX8;
    } else if (to.renderfx < 0x8000) {
      bits |= U_RENDERFX16;
    } else {
      bits |= U_RENDERFX8 | U_RENDERFX16;
    }
  }

  if (to.solid !== from.solid) {
    bits |= U_SOLID;
  }

  if (to.event) {
    bits |= U_EVENT;
  }

  if (to.modelindex !== from.modelindex) {
    bits |= U_MODEL;
  }
  if (to.modelindex2 !== from.modelindex2) {
    bits |= U_MODEL2;
  }
  if (to.modelindex3 !== from.modelindex3) {
    bits |= U_MODEL3;
  }
  if (to.modelindex4 !== from.modelindex4) {
    bits |= U_MODEL4;
  }

  if (to.sound !== from.sound) {
    bits |= U_SOUND;
  }

  if (newentity || (to.renderfx & RF_BEAM) !== 0) {
    bits |= U_OLDORIGIN;
  }

  if (!bits && !force) {
    return;
  }

  if ((bits & 0xff000000) !== 0) {
    bits |= U_MOREBITS3 | U_MOREBITS2 | U_MOREBITS1;
  } else if ((bits & 0x00ff0000) !== 0) {
    bits |= U_MOREBITS2 | U_MOREBITS1;
  } else if ((bits & 0x0000ff00) !== 0) {
    bits |= U_MOREBITS1;
  }

  MSG_WriteByte(msg, bits & 255);

  if ((bits & 0xff000000) !== 0) {
    MSG_WriteByte(msg, (bits >> 8) & 255);
    MSG_WriteByte(msg, (bits >> 16) & 255);
    MSG_WriteByte(msg, (bits >> 24) & 255);
  } else if ((bits & 0x00ff0000) !== 0) {
    MSG_WriteByte(msg, (bits >> 8) & 255);
    MSG_WriteByte(msg, (bits >> 16) & 255);
  } else if ((bits & 0x0000ff00) !== 0) {
    MSG_WriteByte(msg, (bits >> 8) & 255);
  }

  if ((bits & U_NUMBER16) !== 0) {
    MSG_WriteShort(msg, to.number);
  } else {
    MSG_WriteByte(msg, to.number);
  }

  if ((bits & U_MODEL) !== 0) {
    MSG_WriteByte(msg, to.modelindex);
  }
  if ((bits & U_MODEL2) !== 0) {
    MSG_WriteByte(msg, to.modelindex2);
  }
  if ((bits & U_MODEL3) !== 0) {
    MSG_WriteByte(msg, to.modelindex3);
  }
  if ((bits & U_MODEL4) !== 0) {
    MSG_WriteByte(msg, to.modelindex4);
  }

  if ((bits & U_FRAME8) !== 0) {
    MSG_WriteByte(msg, to.frame);
  }
  if ((bits & U_FRAME16) !== 0) {
    MSG_WriteShort(msg, to.frame);
  }

  if ((bits & (U_SKIN8 | U_SKIN16)) === (U_SKIN8 | U_SKIN16)) {
    MSG_WriteLong(msg, to.skinnum);
  } else if ((bits & U_SKIN8) !== 0) {
    MSG_WriteByte(msg, to.skinnum);
  } else if ((bits & U_SKIN16) !== 0) {
    MSG_WriteShort(msg, to.skinnum);
  }

  if ((bits & (U_EFFECTS8 | U_EFFECTS16)) === (U_EFFECTS8 | U_EFFECTS16)) {
    MSG_WriteLong(msg, to.effects);
  } else if ((bits & U_EFFECTS8) !== 0) {
    MSG_WriteByte(msg, to.effects);
  } else if ((bits & U_EFFECTS16) !== 0) {
    MSG_WriteShort(msg, to.effects);
  }

  if ((bits & (U_RENDERFX8 | U_RENDERFX16)) === (U_RENDERFX8 | U_RENDERFX16)) {
    MSG_WriteLong(msg, to.renderfx);
  } else if ((bits & U_RENDERFX8) !== 0) {
    MSG_WriteByte(msg, to.renderfx);
  } else if ((bits & U_RENDERFX16) !== 0) {
    MSG_WriteShort(msg, to.renderfx);
  }

  if ((bits & U_ORIGIN1) !== 0) {
    MSG_WriteCoord(msg, to.origin[0]);
  }
  if ((bits & U_ORIGIN2) !== 0) {
    MSG_WriteCoord(msg, to.origin[1]);
  }
  if ((bits & U_ORIGIN3) !== 0) {
    MSG_WriteCoord(msg, to.origin[2]);
  }

  if ((bits & U_ANGLE1) !== 0) {
    MSG_WriteAngle(msg, to.angles[0]);
  }
  if ((bits & U_ANGLE2) !== 0) {
    MSG_WriteAngle(msg, to.angles[1]);
  }
  if ((bits & U_ANGLE3) !== 0) {
    MSG_WriteAngle(msg, to.angles[2]);
  }

  if ((bits & U_OLDORIGIN) !== 0) {
    MSG_WriteCoord(msg, to.old_origin[0]);
    MSG_WriteCoord(msg, to.old_origin[1]);
    MSG_WriteCoord(msg, to.old_origin[2]);
  }

  if ((bits & U_SOUND) !== 0) {
    MSG_WriteByte(msg, to.sound);
  }
  if ((bits & U_EVENT) !== 0) {
    MSG_WriteByte(msg, to.event);
  }
  if ((bits & U_SOLID) !== 0) {
    MSG_WriteShort(msg, to.solid);
  }
}

/**
 * Original name: MSG_ReadChar
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Reads a signed 8-bit value or returns -1 past the readable end.
 *
 * Porting notes:
 * - Preserves the original readcount increment even on overflow.
 */
export function MSG_ReadChar(msg_read: sizebuf_t): number {
  let c = -1;
  if (msg_read.readcount + 1 <= msg_read.cursize) {
    const value = msg_read.data[msg_read.readcount];
    c = value > 127 ? value - 256 : value;
  }
  msg_read.readcount += 1;
  return c;
}

/**
 * Original name: MSG_ReadByte
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Reads an unsigned 8-bit value or returns -1 past the readable end.
 *
 * Porting notes:
 * - Preserves the original readcount increment even on overflow.
 */
export function MSG_ReadByte(msg_read: sizebuf_t): number {
  let c = -1;
  if (msg_read.readcount + 1 <= msg_read.cursize) {
    c = msg_read.data[msg_read.readcount];
  }
  msg_read.readcount += 1;
  return c;
}

/**
 * Original name: MSG_ReadShort
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Reads a signed 16-bit little-endian value or returns -1 past the readable end.
 *
 * Porting notes:
 * - Preserves the original readcount increment even on overflow.
 */
export function MSG_ReadShort(msg_read: sizebuf_t): number {
  let c = -1;
  if (msg_read.readcount + 2 <= msg_read.cursize) {
    const value = msg_read.data[msg_read.readcount] + (msg_read.data[msg_read.readcount + 1] << 8);
    c = value & 0x8000 ? value - 0x10000 : value;
  }
  msg_read.readcount += 2;
  return c;
}

/**
 * Original name: MSG_ReadLong
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Reads a signed 32-bit little-endian value or returns -1 past the readable end.
 *
 * Porting notes:
 * - Preserves the original readcount increment even on overflow.
 */
export function MSG_ReadLong(msg_read: sizebuf_t): number {
  let c = -1;
  if (msg_read.readcount + 4 <= msg_read.cursize) {
    c =
      msg_read.data[msg_read.readcount] +
      (msg_read.data[msg_read.readcount + 1] << 8) +
      (msg_read.data[msg_read.readcount + 2] << 16) +
      (msg_read.data[msg_read.readcount + 3] << 24);
  }
  msg_read.readcount += 4;
  return c;
}

/**
 * Original name: MSG_ReadFloat
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Reads a 32-bit float or returns -1 past the readable end.
 *
 * Porting notes:
 * - Uses DataView to mirror the original packed byte interpretation.
 */
export function MSG_ReadFloat(msg_read: sizebuf_t): number {
  if (msg_read.readcount + 4 > msg_read.cursize) {
    msg_read.readcount += 4;
    return -1;
  }

  const dat = new Uint8Array(4);
  dat[0] = msg_read.data[msg_read.readcount];
  dat[1] = msg_read.data[msg_read.readcount + 1];
  dat[2] = msg_read.data[msg_read.readcount + 2];
  dat[3] = msg_read.data[msg_read.readcount + 3];
  msg_read.readcount += 4;
  return new DataView(dat.buffer).getFloat32(0, true);
}

/**
 * Original name: MSG_ReadString
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Reads a null-terminated string up to the Quake II temporary read buffer limit.
 *
 * Porting notes:
 * - Returns a JavaScript string instead of a shared static C char buffer.
 */
export function MSG_ReadString(msg_read: sizebuf_t): string {
  return readStringInternal(msg_read, false);
}

/**
 * Original name: MSG_ReadStringLine
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Reads a string terminated by null, EOF or newline.
 *
 * Porting notes:
 * - Returns a JavaScript string instead of a shared static C char buffer.
 */
export function MSG_ReadStringLine(msg_read: sizebuf_t): string {
  return readStringInternal(msg_read, true);
}

/**
 * Original name: MSG_ReadCoord
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Reads a coordinate encoded at 1/8 precision.
 *
 * Porting notes:
 * - Preserves the original conversion factor.
 */
export function MSG_ReadCoord(msg_read: sizebuf_t): number {
  return MSG_ReadShort(msg_read) * (1 / COORD_SCALE);
}

/**
 * Original name: MSG_ReadPos
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Reads a compressed vec3 position.
 *
 * Porting notes:
 * - Returns a vec3 tuple rather than mutating an out pointer.
 */
export function MSG_ReadPos(msg_read: sizebuf_t): vec3_t {
  return [MSG_ReadCoord(msg_read), MSG_ReadCoord(msg_read), MSG_ReadCoord(msg_read)];
}

/**
 * Original name: MSG_ReadAngle
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Reads a one-byte angle and converts it to degrees.
 *
 * Porting notes:
 * - Preserves the original 360/256 scale.
 */
export function MSG_ReadAngle(msg_read: sizebuf_t): number {
  return MSG_ReadChar(msg_read) * (360 / 256);
}

/**
 * Original name: MSG_ReadAngle16
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Reads a 16-bit Quake II packed angle and converts it to degrees.
 *
 * Porting notes:
 * - Reuses the shared SHORT2ANGLE helper ported from q_shared.h.
 */
export function MSG_ReadAngle16(msg_read: sizebuf_t): number {
  return SHORT2ANGLE(MSG_ReadShort(msg_read));
}

/**
 * Original name: MSG_ReadDeltaUsercmd
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Reconstructs one user command from a delta-compressed message.
 *
 * Porting notes:
 * - Returns a copied command struct instead of mutating an output pointer.
 */
export function MSG_ReadDeltaUsercmd(msg_read: sizebuf_t, from: usercmd_t): usercmd_t {
  const move = cloneUsercmd(from);
  const bits = MSG_ReadByte(msg_read);

  if ((bits & CM_ANGLE1) !== 0) {
    move.angles[0] = MSG_ReadShort(msg_read);
  }
  if ((bits & CM_ANGLE2) !== 0) {
    move.angles[1] = MSG_ReadShort(msg_read);
  }
  if ((bits & CM_ANGLE3) !== 0) {
    move.angles[2] = MSG_ReadShort(msg_read);
  }

  if ((bits & CM_FORWARD) !== 0) {
    move.forwardmove = MSG_ReadShort(msg_read);
  }
  if ((bits & CM_SIDE) !== 0) {
    move.sidemove = MSG_ReadShort(msg_read);
  }
  if ((bits & CM_UP) !== 0) {
    move.upmove = MSG_ReadShort(msg_read);
  }

  if ((bits & CM_BUTTONS) !== 0) {
    move.buttons = MSG_ReadByte(msg_read);
  }
  if ((bits & CM_IMPULSE) !== 0) {
    move.impulse = MSG_ReadByte(msg_read);
  }

  move.msec = MSG_ReadByte(msg_read);
  move.lightlevel = MSG_ReadByte(msg_read);

  return move;
}

/**
 * Original name: MSG_ReadData
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Reads a raw byte slice of the requested length from the message stream.
 *
 * Porting notes:
 * - Returns a Uint8Array instead of mutating a caller-provided void pointer.
 */
export function MSG_ReadData(msg_read: sizebuf_t, len: number): Uint8Array {
  const data = new Uint8Array(len);
  for (let index = 0; index < len; index += 1) {
    data[index] = MSG_ReadByte(msg_read) & 0xff;
  }
  return data;
}

/**
 * Original name: MSG_ReadDir
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Expands one encoded byte-dir index back to its canonical direction vector.
 *
 * Porting notes:
 * - Throws on invalid indices where the original routed through `Com_Error(ERR_DROP)`.
 */
export function MSG_ReadDir(msg_read: sizebuf_t): vec3_t {
  const index = MSG_ReadByte(msg_read);
  if (index < 0 || index >= BYTE_DIRS.length) {
    throw new Error("MSG_ReadDir: out of range");
  }

  const dir = BYTE_DIRS[index]!;
  return [dir[0], dir[1], dir[2]];
}

export { MSG_BeginReading };

/**
 * Original name: N/A
 * Source: N/A (message string reader helper)
 * Category: New
 * Purpose: Read a Quake II message string using the original temporary-buffer limits.
 *
 * Constraints:
 * - Must stop on EOF, null terminator, and optionally newline.
 */
function readStringInternal(msg_read: sizebuf_t, stopOnNewline: boolean): string {
  let result = "";

  while (result.length < READ_STRING_LIMIT - 1) {
    const c = MSG_ReadChar(msg_read);
    if (c === -1 || c === 0 || (stopOnNewline && c === 10)) {
      break;
    }

    result += String.fromCharCode(c & 0xff);
  }

  return result;
}

/**
 * Original name: N/A
 * Source: N/A (usercmd clone helper)
 * Category: New
 * Purpose: Copy one `usercmd_t` while preserving the original fixed field layout.
 *
 * Constraints:
 * - Must duplicate the angle triplet instead of aliasing it.
 */
function cloneUsercmd(cmd: usercmd_t): usercmd_t {
  return {
    msec: cmd.msec,
    buttons: cmd.buttons,
    angles: [cmd.angles[0], cmd.angles[1], cmd.angles[2]],
    forwardmove: cmd.forwardmove,
    sidemove: cmd.sidemove,
    upmove: cmd.upmove,
    impulse: cmd.impulse,
    lightlevel: cmd.lightlevel
  };
}
