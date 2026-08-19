/**
 * File: common.ts
 * Source: Quake II original / qcommon/common.c
 * Purpose: Port the common argument, redirect and info-string helper routines used by both client and server bootstrap code.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses explicit runtime state instead of file-static globals.
 * - Returns formatted lines for helper outputs instead of printing directly.
 *
 * Notes:
 * - This file is intended to stay conceptually close to the original C source.
 */

import {
  MAX_INFO_KEY,
  MAX_INFO_STRING,
  MAX_TOKEN_CHARS
} from "./q_shared.js";

/**
 * Original name: MAX_NUM_ARGVS
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 */
export const MAX_NUM_ARGVS = 50;
export const MAXPRINTMSG = 4096;

/**
 * Original name: bigendien
 * Source: game/q_shared.c, declared by qcommon/qcommon.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Stores whether the current host byte order is big-endian.
 *
 * Porting notes:
 * - JavaScript does not need mutable endian dispatch pointers, so this is a detected constant.
 */
export const bigendien = !isLittleEndianHost();

/**
 * Original name: N/A
 * Source: N/A (explicit runtime state)
 * Category: New
 * Purpose: Store the common runtime state gradually ported from `common.c`.
 *
 * Constraints:
 * - Must keep argv state and redirect state explicit for deterministic tests.
 */
export interface CommonRuntime {
  com_argc: number;
  com_argv: string[];
  rd_target: number;
  rd_buffer: string;
  rd_buffersize: number;
  rd_flush: ((target: number, buffer: string) => void) | null;
}

/**
 * Original name: N/A
 * Source: N/A (parser return adapter)
 * Category: New
 * Purpose: Preserve the parsed token/result pair produced by the `COM_Parse` port.
 *
 * Constraints:
 * - Must keep both the token and the caller's next scan position explicit.
 */
export interface ComParseResult {
  token: string;
  nextIndex: number | null;
}

/**
 * Original name: N/A
 * Source: N/A (explicit runtime state)
 * Category: New
 * Purpose: Create an isolated common runtime state for future `Qcommon_Init` integration.
 *
 * Constraints:
 * - Must start with an empty argv list and no active redirect.
 */
export function createCommonRuntime(): CommonRuntime {
  return {
    com_argc: 0,
    com_argv: [],
    rd_target: 0,
    rd_buffer: "",
    rd_buffersize: 0,
    rd_flush: null
  };
}

/**
 * Original name: COM_InitArgv
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes the global argument array from startup argv values.
 *
 * Porting notes:
 * - Stores argv inside the explicit runtime object.
 */
export function COM_InitArgv(runtime: CommonRuntime, argv: string[]): void {
  if (argv.length > MAX_NUM_ARGVS) {
    throw new Error("COM_InitArgv: argc > MAX_NUM_ARGVS");
  }

  runtime.com_argc = argv.length;
  runtime.com_argv = argv.map((value) => (!value || value.length >= MAX_TOKEN_CHARS ? "" : value));
}

/**
 * Original name: COM_Argc
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the current startup argc value.
 *
 * Porting notes:
 * - Reads from explicit runtime state.
 */
export function COM_Argc(runtime: CommonRuntime): number {
  return runtime.com_argc;
}

/**
 * Original name: COM_Argv
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns one startup argument or an empty string when out of range.
 *
 * Porting notes:
 * - Preserves the original empty-string fallback.
 */
export function COM_Argv(runtime: CommonRuntime, arg: number): string {
  if (arg < 0 || arg >= runtime.com_argc || runtime.com_argv[arg] === undefined) {
    return "";
  }

  return runtime.com_argv[arg];
}

/**
 * Original name: COM_ClearArgv
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Clears one startup argument slot.
 *
 * Porting notes:
 * - Preserves the original no-op behavior on invalid indexes.
 */
export function COM_ClearArgv(runtime: CommonRuntime, arg: number): void {
  if (arg < 0 || arg >= runtime.com_argc || runtime.com_argv[arg] === undefined) {
    return;
  }

  runtime.com_argv[arg] = "";
}

/**
 * Original name: COM_AddParm
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Appends one startup argument to the current argv list.
 *
 * Porting notes:
 * - Throws on overflow instead of calling `Com_Error`.
 */
export function COM_AddParm(runtime: CommonRuntime, parm: string): void {
  if (runtime.com_argc === MAX_NUM_ARGVS) {
    throw new Error("COM_AddParm: MAX_NUM_ARGVS");
  }

  runtime.com_argv[runtime.com_argc] = parm;
  runtime.com_argc += 1;
}

/**
 * Original name: memsearch
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the first index where one byte value appears, or `-1` when absent.
 *
 * Porting notes:
 * - Accepts a `Uint8Array` instead of a raw byte pointer; `count` preserves the original bounded scan.
 */
export function memsearch(start: Uint8Array, count: number, search: number): number {
  const limit = Math.min(Math.max(count, 0), start.length);
  const byte = search & 0xff;
  for (let index = 0; index < limit; index += 1) {
    if (start[index] === byte) {
      return index;
    }
  }

  return -1;
}

/**
 * Original name: COM_CheckParm
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Finds the index of one startup argument, skipping argv[0].
 *
 * Porting notes:
 * - Preserves the original 0 return value when not found.
 */
export function COM_CheckParm(runtime: CommonRuntime, parm: string): number {
  for (let index = 1; index < runtime.com_argc; index += 1) {
    if (runtime.com_argv[index] === parm) {
      return index;
    }
  }

  return 0;
}

/**
 * Original name: Com_BeginRedirect
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Starts buffering common output into a temporary redirect buffer.
 *
 * Porting notes:
 * - Stores the redirect buffer as a string instead of a caller-provided char pointer.
 */
export function Com_BeginRedirect(
  runtime: CommonRuntime,
  target: number,
  buffersize: number,
  flush: (target: number, buffer: string) => void
): void {
  if (!target || !buffersize) {
    return;
  }

  runtime.rd_target = target;
  runtime.rd_buffersize = buffersize;
  runtime.rd_flush = flush;
  runtime.rd_buffer = "";
}

/**
 * Original name: Com_EndRedirect
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Flushes and disables the active redirect buffer.
 *
 * Porting notes:
 * - No-ops safely when no redirect is active.
 */
export function Com_EndRedirect(runtime: CommonRuntime): void {
  if (!runtime.rd_target || !runtime.rd_flush) {
    return;
  }

  runtime.rd_flush(runtime.rd_target, runtime.rd_buffer);
  runtime.rd_target = 0;
  runtime.rd_buffer = "";
  runtime.rd_buffersize = 0;
  runtime.rd_flush = null;
}

/**
 * Original name: Com_Printf
 * Source: Quake-2-master/qcommon/common.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Formats one common output string, appends it to the active redirect buffer when present,
 *   otherwise emits it through the provided host sink.
 *
 * Porting notes:
 * - `game/q_shared.h` declares this function only so shared/system code can link to the
 *   `qcommon/common.c` implementation.
 * - Console and logfile side effects are delegated to the host sink/runtime adapters.
 */
export function Com_Printf(runtime: CommonRuntime, format: string, sink: (line: string) => void, ...args: Array<string | number>): void;
export function Com_Printf(runtime: CommonRuntime, format: string, ...args: Array<string | number>): void;
export function Com_Printf(
  runtime: CommonRuntime,
  format: string,
  sinkOrArg?: ((line: string) => void) | string | number,
  ...remainingArgs: Array<string | number>
): void {
  const sink = typeof sinkOrArg === "function" ? sinkOrArg : undefined;
  const args = typeof sinkOrArg === "function" || sinkOrArg === undefined ? remainingArgs : [sinkOrArg, ...remainingArgs];
  const formatted = args.length > 0 ? va(format, ...args) : format;
  const message = formatted.length >= MAXPRINTMSG ? formatted.slice(0, MAXPRINTMSG - 1) : formatted;

  if (runtime.rd_target && runtime.rd_flush) {
    if (message.length + runtime.rd_buffer.length > runtime.rd_buffersize - 1) {
      runtime.rd_flush(runtime.rd_target, runtime.rd_buffer);
      runtime.rd_buffer = "";
    }

    runtime.rd_buffer += message;
    return;
  }

  sink?.(message);
}

/**
 * Original name: COM_SkipPath
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the substring after the last `/` path separator.
 */
export function COM_SkipPath(pathname: string): string {
  const slash = pathname.lastIndexOf("/");
  return slash >= 0 ? pathname.slice(slash + 1) : pathname;
}

/**
 * Original name: COM_StripExtension
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Removes the first extension marker from the provided path string.
 *
 * Porting notes:
 * - Returns the stripped string instead of writing through an out buffer.
 */
export function COM_StripExtension(input: string): string {
  const dot = input.indexOf(".");
  return dot >= 0 ? input.slice(0, dot) : input;
}

/**
 * Original name: COM_FileExtension
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns up to seven characters after the first `.` in a path, or an empty string when none exists.
 */
export function COM_FileExtension(input: string): string {
  const dot = input.indexOf(".");
  if (dot < 0) {
    return "";
  }

  return input.slice(dot + 1, dot + 8);
}

/**
 * Original name: COM_FileBase
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the filename without its directory and extension.
 */
export function COM_FileBase(input: string): string {
  const lastSlash = input.lastIndexOf("/");
  const start = lastSlash >= 0 ? lastSlash + 1 : 0;
  const lastDot = input.lastIndexOf(".");

  if (lastDot - start < 2) {
    return "";
  }

  return input.slice(start, lastDot);
}

/**
 * Original name: COM_FilePath
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the path up to, but not including, the final `/`.
 */
export function COM_FilePath(input: string): string {
  const lastSlash = input.lastIndexOf("/");
  return lastSlash >= 0 ? input.slice(0, lastSlash) : "";
}

/**
 * Original name: COM_DefaultExtension
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Appends `extension` when the final path segment has no `.` extension.
 */
export function COM_DefaultExtension(path: string, extension: string): string {
  const lastSlash = path.lastIndexOf("/");
  const tail = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
  if (tail.includes(".")) {
    return path;
  }

  return `${path}${extension}`;
}

/**
 * Original name: COM_Parse
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Parses one token from a Quake-style script string, skipping whitespace and `//` comments.
 *
 * Porting notes:
 * - Returns `{ token, nextIndex }` instead of mutating a `char **`.
 */
export function COM_Parse(data: string | null, startIndex = 0): ComParseResult {
  if (data === null) {
    return { token: "", nextIndex: null };
  }

  let index = startIndex;

  while (index < data.length) {
    while (index < data.length && data.charCodeAt(index) <= 32) {
      index += 1;
    }

    if (index >= data.length) {
      return { token: "", nextIndex: null };
    }

    if (data[index] === "/" && data[index + 1] === "/") {
      while (index < data.length && data[index] !== "\n") {
        index += 1;
      }
      continue;
    }

    break;
  }

  if (index >= data.length) {
    return { token: "", nextIndex: null };
  }

  if (data[index] === "\"") {
    index += 1;
    let token = "";

    while (index < data.length) {
      const character = data[index];
      index += 1;

      if (character === "\"") {
        return { token, nextIndex: index };
      }

      if (token.length < MAX_TOKEN_CHARS) {
        token += character;
      }
    }

    return { token, nextIndex: index };
  }

  let token = "";
  while (index < data.length && data.charCodeAt(index) > 32) {
    if (token.length < MAX_TOKEN_CHARS) {
      token += data[index];
    }
    index += 1;
  }

  if (token.length === MAX_TOKEN_CHARS) {
    token = "";
  }

  return {
    token,
    nextIndex: index < data.length ? index : null
  };
}

/**
 * Original name: Com_sprintf
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Formats a string and clamps the final result to `size - 1` characters.
 *
 * Porting notes:
 * - Accepts already-materialized arguments instead of C varargs formatting rules.
 */
export function Com_sprintf(size: number, message: string): string {
  if (size <= 0) {
    return "";
  }

  return message.length >= size ? message.slice(0, size - 1) : message;
}

/**
 * Original name: va
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Provides the convenience formatting helper used throughout Quake II utility code.
 *
 * Porting notes:
 * - Emulates the printf specifiers used by the port instead of exposing a reusable static buffer.
 */
export function va(format: string, ...args: Array<string | number>): string {
  let argIndex = 0;

  return format.replace(/%([0 +#-]*)(\d+)?(?:\.(\d+))?([%sdifuxXc])/g, (match, flags, width, precision, type) => {
    if (type === "%") {
      return "%";
    }

    const value = args[argIndex++];
    let rendered: string;

    switch (type) {
      case "d":
      case "i":
        rendered = Math.trunc(Number(value)).toString(10);
        break;
      case "u":
        rendered = (Math.trunc(Number(value)) >>> 0).toString(10);
        break;
      case "x":
        rendered = (Math.trunc(Number(value)) >>> 0).toString(16);
        break;
      case "X":
        rendered = (Math.trunc(Number(value)) >>> 0).toString(16).toUpperCase();
        break;
      case "f": {
        const digits = precision === undefined ? 6 : Number(precision);
        rendered = Number(value).toFixed(digits);
        break;
      }
      case "c":
        rendered = typeof value === "number" ? String.fromCharCode(value) : String(value)[0] ?? "";
        break;
      case "s":
        rendered = String(value);
        break;
      default:
        return match;
    }

    const minWidth = width === undefined ? 0 : Number(width);
    const pad = flags.includes("0") && ["d", "i", "u", "x", "X", "f"].includes(type) ? "0" : " ";
    return minWidth > rendered.length ? `${pad.repeat(minWidth - rendered.length)}${rendered}` : rendered;
  });
}

/**
 * Original name: BigShort
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Reinterprets one 16-bit integer as big-endian input and returns host-order numeric value.
 */
export function BigShort(value: number): number {
  return isLittleEndianHost() ? ShortSwap(value) : ShortNoSwap(value);
}

/**
 * Original name: LittleShort
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Reinterprets one 16-bit integer as little-endian input and returns host-order numeric value.
 */
export function LittleShort(value: number): number {
  return isLittleEndianHost() ? ShortNoSwap(value) : ShortSwap(value);
}

/**
 * Original name: BigLong
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Reinterprets one 32-bit integer as big-endian input and returns host-order numeric value.
 */
export function BigLong(value: number): number {
  return isLittleEndianHost() ? LongSwap(value) : LongNoSwap(value);
}

/**
 * Original name: LittleLong
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Reinterprets one 32-bit integer as little-endian input and returns host-order numeric value.
 */
export function LittleLong(value: number): number {
  return isLittleEndianHost() ? LongNoSwap(value) : LongSwap(value);
}

/**
 * Original name: BigFloat
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Reinterprets one 32-bit float as big-endian input and returns host-order numeric value.
 */
export function BigFloat(value: number): number {
  return isLittleEndianHost() ? FloatSwap(value) : FloatNoSwap(value);
}

/**
 * Original name: LittleFloat
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Reinterprets one 32-bit float as little-endian input and returns host-order numeric value.
 */
export function LittleFloat(value: number): number {
  return isLittleEndianHost() ? FloatNoSwap(value) : FloatSwap(value);
}

/**
 * Original name: ShortSwap
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Swaps the two bytes of one signed 16-bit integer and returns a signed 16-bit result.
 */
export function ShortSwap(value: number): number {
  const b1 = value & 255;
  const b2 = (value >> 8) & 255;
  return toSigned16((b1 << 8) + b2);
}

/**
 * Original name: ShortNoSwap
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns one signed 16-bit integer unchanged.
 */
export function ShortNoSwap(value: number): number {
  return toSigned16(value);
}

/**
 * Original name: LongSwap
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Swaps the four bytes of one signed 32-bit integer and returns a signed 32-bit result.
 */
export function LongSwap(value: number): number {
  const b1 = value & 255;
  const b2 = (value >> 8) & 255;
  const b3 = (value >> 16) & 255;
  const b4 = (value >> 24) & 255;
  return ((b1 << 24) | (b2 << 16) | (b3 << 8) | b4) | 0;
}

/**
 * Original name: LongNoSwap
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns one signed 32-bit integer unchanged.
 */
export function LongNoSwap(value: number): number {
  return value | 0;
}

/**
 * Original name: FloatSwap
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Reverses the four raw bytes of one 32-bit float and returns the reinterpreted float.
 */
export function FloatSwap(value: number): number {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setFloat32(0, value, true);
  const b0 = view.getUint8(0);
  const b1 = view.getUint8(1);
  const b2 = view.getUint8(2);
  const b3 = view.getUint8(3);
  view.setUint8(0, b3);
  view.setUint8(1, b2);
  view.setUint8(2, b1);
  view.setUint8(3, b0);
  return view.getFloat32(0, true);
}

/**
 * Original name: FloatNoSwap
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns one float unchanged.
 */
export function FloatNoSwap(value: number): number {
  return value;
}

/**
 * Original name: Swap_Init
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Reports whether the host is big-endian, mirroring the original byte-order initialization.
 *
 * Porting notes:
 * - JavaScript engines do not need mutable function-pointer setup, so the port returns the detected mode.
 */
export function Swap_Init(): { bigendien: boolean } {
  return {
    bigendien
  };
}

/**
 * Original name: Q_strncasecmp
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Compares at most `count` characters with Quake II's ASCII-only case folding.
 */
export function Q_strncasecmp(left: string, right: string, count: number): number {
  let index = 0;

  while (true) {
    const c1 = index < left.length ? left.charCodeAt(index) : 0;
    const c2 = index < right.length ? right.charCodeAt(index) : 0;
    index += 1;

    if (count === 0) {
      return 0;
    }
    count -= 1;

    if (c1 !== c2) {
      const folded1 = foldAsciiUpper(c1);
      const folded2 = foldAsciiUpper(c2);
      if (folded1 !== folded2) {
        return -1;
      }
    }

    if (c1 === 0) {
      return 0;
    }
  }
}

/**
 * Original name: Q_strcasecmp
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Compares two strings case-insensitively using the original large bound.
 */
export function Q_strcasecmp(left: string, right: string): number {
  return Q_strncasecmp(left, right, 99999);
}

/**
 * Original name: Q_stricmp
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Compatibility alias for the portable case-insensitive compare.
 */
export function Q_stricmp(left: string, right: string): number {
  return Q_strcasecmp(left, right);
}

/**
 * Original name: Info_ValueForKey
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the current value stored under one Quake info-string key.
 */
export function Info_ValueForKey(info: string, key: string): string {
  let index = info.startsWith("\\") ? 1 : 0;

  while (true) {
    const keyEnd = info.indexOf("\\", index);
    if (keyEnd === -1) {
      return "";
    }

    const parsedKey = info.slice(index, keyEnd);
    index = keyEnd + 1;

    let valueEnd = info.indexOf("\\", index);
    if (valueEnd === -1) {
      valueEnd = info.length;
    }

    const parsedValue = info.slice(index, valueEnd);
    if (parsedKey === key) {
      return parsedValue;
    }

    if (valueEnd >= info.length) {
      return "";
    }

    index = valueEnd + 1;
  }
}

/**
 * Original name: Info_RemoveKey
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Removes the first matching key from a Quake-style info string while preserving the remaining bytes.
 *
 * Porting notes:
 * - Returns the updated string instead of mutating a caller-owned char buffer.
 */
export function Info_RemoveKey(info: string, key: string): string {
  if (key.includes("\\")) {
    return info;
  }

  let index = 0;

  while (true) {
    const start = index;
    if (info[index] === "\\") {
      index += 1;
    }

    const keyEnd = info.indexOf("\\", index);
    if (keyEnd === -1) {
      return info;
    }

    const parsedKey = info.slice(index, keyEnd);
    index = keyEnd + 1;

    let valueEnd = info.indexOf("\\", index);
    if (valueEnd === -1) {
      valueEnd = info.length;
    }

    if (parsedKey === key) {
      return info.slice(0, start) + info.slice(valueEnd);
    }

    if (valueEnd >= info.length) {
      return info;
    }

    index = valueEnd;
  }
}

/**
 * Original name: Info_Validate
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Rejects info strings containing characters that break Quake II parsing.
 */
export function Info_Validate(info: string): boolean {
  return !info.includes("\"") && !info.includes(";");
}

/**
 * Original name: Info_SetValueForKey
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Inserts or replaces one `\\key\\value` pair in an info string while preserving Quake II validation rules.
 *
 * Porting notes:
 * - Returns the updated string instead of mutating a caller-owned char buffer.
 */
export function Info_SetValueForKey(info: string, key: string, value: string): string {
  if (
    key.includes("\\") || value.includes("\\") ||
    key.includes(";") ||
    key.includes("\"") || value.includes("\"")
  ) {
    return info;
  }

  if (key.length > MAX_INFO_KEY - 1 || value.length > MAX_INFO_KEY - 1) {
    return info;
  }

  let next = Info_RemoveKey(info, key);
  if (value.length === 0) {
    return next;
  }

  const pair = `\\${key}\\${value}`;
  if (next.length + pair.length > MAX_INFO_STRING) {
    return next;
  }

  let sanitizedPair = "";
  for (let index = 0; index < pair.length; index += 1) {
    const code = pair.charCodeAt(index) & 127;
    if (code >= 32 && code < 127) {
      sanitizedPair += String.fromCharCode(code);
    }
  }

  next += sanitizedPair;
  return next;
}

/**
 * Original name: Info_Print
 * Source: qcommon/common.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Formats one Quake info string as aligned key/value lines.
 *
 * Porting notes:
 * - Returns formatted lines instead of printing through `Com_Printf`.
 */
export function Info_Print(s: string): string[] {
  const lines: string[] = [];
  let working = s.startsWith("\\") ? s.slice(1) : s;

  while (working.length > 0) {
    const keyStop = working.indexOf("\\");
    const key = keyStop >= 0 ? working.slice(0, keyStop) : working;
    const paddedKey = key.length < 20 ? `${key}${" ".repeat(20 - key.length)}` : key;

    if (keyStop === -1) {
      lines.push(`${paddedKey}MISSING VALUE`);
      return lines;
    }

    working = working.slice(keyStop + 1);

    const valueStop = working.indexOf("\\");
    const value = valueStop >= 0 ? working.slice(0, valueStop) : working;
    lines.push(`${paddedKey}${value}`);

    working = valueStop >= 0 ? working.slice(valueStop + 1) : "";
  }

  return lines;
}

/**
 * Original name: N/A
 * Source: N/A (host endian detector)
 * Category: New
 * Purpose: Detect the host numeric endianness once for the q_shared byte-order helpers.
 */
function isLittleEndianHost(): boolean {
  const buffer = new ArrayBuffer(2);
  new DataView(buffer).setUint16(0, 1, true);
  return new Uint16Array(buffer)[0] === 1;
}

/**
 * Original name: N/A
 * Source: N/A (local ASCII helper)
 * Category: New
 * Purpose: Fold one ASCII lowercase byte to uppercase for Quake-style string comparisons.
 */
function foldAsciiUpper(code: number): number {
  return code >= 97 && code <= 122 ? code - 32 : code;
}

function toSigned16(value: number): number {
  const truncated = value & 0xffff;
  return truncated & 0x8000 ? truncated - 0x10000 : truncated;
}
