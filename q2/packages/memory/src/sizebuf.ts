/**
 * File: sizebuf.ts
 * Source: Quake II original / qcommon/qcommon.h and qcommon/common.c
 * Purpose: Port the size buffer primitives used by Quake II message and binary IO.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses Uint8Array instead of raw C pointers.
 * - Throws JavaScript errors instead of calling Com_Error.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

/**
 * Original name: sizebuf_s
 * Source: Quake-2-master/qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Stores write and read cursors for a byte buffer used by Quake II message IO.
 *
 * Porting notes:
 * - TS symbol uses the original typedef name `sizebuf_t`; the C/H matrix tracks the owning struct as `sizebuf_s`.
 * - Keeps the original field names to preserve source traceability.
 */
export interface sizebuf_t {
  allowoverflow: boolean;
  overflowed: boolean;
  data: Uint8Array;
  maxsize: number;
  cursize: number;
  readcount: number;
}

/**
 * Original name: N/A
 * Source: N/A (local allocation helper)
 * Category: New
 * Purpose: Allocate a new size buffer backed by a Uint8Array.
 *
 * Constraints:
 * - Must initialize the structure with Quake II-compatible defaults.
 */
export function createSizeBuffer(lengthOrData: number | Uint8Array, allowoverflow = false): sizebuf_t {
  const data = typeof lengthOrData === "number" ? new Uint8Array(lengthOrData) : lengthOrData;

  return {
    allowoverflow,
    overflowed: false,
    data,
    maxsize: data.length,
    cursize: 0,
    readcount: 0
  };
}

/**
 * Original name: SZ_Init
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Initializes a size buffer around an existing byte array.
 *
 * Porting notes:
 * - Preserves original field names and reset semantics.
 */
export function SZ_Init(buf: sizebuf_t, data: Uint8Array): void {
  buf.allowoverflow = false;
  buf.overflowed = false;
  buf.data = data;
  buf.maxsize = data.length;
  buf.cursize = 0;
  buf.readcount = 0;
}

/**
 * Original name: SZ_Clear
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Resets a size buffer write state while keeping its backing storage.
 *
 * Porting notes:
 * - Matches the original reset of cursize and overflowed state.
 */
export function SZ_Clear(buf: sizebuf_t): void {
  buf.cursize = 0;
  buf.overflowed = false;
}

/**
 * Original name: MSG_BeginReading
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Resets the read cursor used by future message reads.
 *
 * Porting notes:
 * - Keeps the exact original field mutation.
 */
export function MSG_BeginReading(buf: sizebuf_t): void {
  buf.readcount = 0;
}

/**
 * Original name: SZ_GetSpace
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Reserves a contiguous write window inside the size buffer.
 *
 * Porting notes:
 * - Throws on fatal overflow paths instead of calling Com_Error.
 * - Returns a Uint8Array subarray instead of a raw pointer.
 */
export function SZ_GetSpace(buf: sizebuf_t, length: number): Uint8Array {
  if (buf.cursize + length > buf.maxsize) {
    if (!buf.allowoverflow) {
      throw new Error("SZ_GetSpace: overflow without allowoverflow set");
    }

    if (length > buf.maxsize) {
      throw new Error(`SZ_GetSpace: ${length} is > full buffer size`);
    }

    SZ_Clear(buf);
    buf.overflowed = true;
  }

  const start = buf.cursize;
  buf.cursize += length;
  return buf.data.subarray(start, start + length);
}

/**
 * Original name: SZ_Write
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Copies raw bytes into the next available space in the size buffer.
 *
 * Porting notes:
 * - Accepts Uint8Array-compatible byte sources instead of raw pointers.
 */
export function SZ_Write(buf: sizebuf_t, data: Uint8Array): void {
  SZ_GetSpace(buf, data.length).set(data);
}

/**
 * Original name: SZ_Print
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Appends a null-terminated string to the size buffer, reusing an existing trailing null when present.
 *
 * Porting notes:
 * - Encodes JavaScript strings as ASCII-compatible byte values.
 */
export function SZ_Print(buf: sizebuf_t, data: string): void {
  const encoded = encodeCString(data);
  if (buf.cursize !== 0 && buf.data[buf.cursize - 1] === 0) {
    buf.cursize -= 1;
    SZ_Write(buf, encoded);
    return;
  }

  SZ_Write(buf, encoded);
}

/**
 * Original name: N/A
 * Source: N/A (local string encoding helper)
 * Category: New
 * Purpose: Encode a JavaScript string as a null-terminated byte sequence for Quake II buffers.
 *
 * Constraints:
 * - Must produce a trailing zero byte.
 * - Intended for ASCII and Quake II asset text paths.
 */
function encodeCString(value: string): Uint8Array {
  const encoded = new Uint8Array(value.length + 1);

  for (let index = 0; index < value.length; index += 1) {
    encoded[index] = value.charCodeAt(index) & 0xff;
  }

  encoded[value.length] = 0;
  return encoded;
}
