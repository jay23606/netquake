/**
 * File: system.ts
 * Source: Quake II original / game/q_shared.h
 * Purpose: Port the host-glue declarations from the shared Quake II header through an explicit runtime.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Replaces host globals and callbacks with an explicit runtime and injectable hooks.
 * - Models hunk memory through `Uint8Array` views instead of raw pointers.
 *
 * Notes:
 * - This file closes the platform-facing `Sys_*`, `Hunk_*` and `Com_PageInMemory` portion of `q_shared.h`.
 */

import type { byte } from "./q_shared.js";

/**
 * Original name: N/A
 * Source: N/A (system file-search contract)
 * Category: New
 * Purpose: Describe one file-search result emitted by the `Sys_Find*` hooks.
 *
 * Constraints:
 * - Must preserve ordering so repeated `Sys_FindNext` calls stay deterministic.
 */
export interface SysFindResult {
  path: string;
}

/**
 * Original name: N/A
 * Source: N/A (system hook contract)
 * Category: New
 * Purpose: Hold the host callbacks required by the `q_shared.h` system glue port.
 *
 * Constraints:
 * - Every hook must be optional so the runtime can be created before a host is attached.
 */
export interface SystemHooks {
  milliseconds?: () => number;
  mkdir?: (path: string) => void;
  error?: (message: string) => never;
  find?: (path: string, musthave: number, canthave: number) => SysFindResult[];
}

/**
 * Original name: N/A
 * Source declared: N/A (local TypeScript formatting helper)
 * Category: New
 *
 * Purpose:
 * - Format the subset of C printf placeholders used by the `Sys_Error` port before delegating to the host hook.
 */
function formatSystemError(format: string, args: unknown[]): string {
  if (args.length === 0) {
    return format;
  }

  let argIndex = 0;
  return format.replace(/%([sdif])/g, (match, specifier) => {
    if (argIndex >= args.length) {
      return match;
    }

    const value = args[argIndex++];
    if (specifier === "d" || specifier === "i") {
      return String(Math.trunc(Number(value)));
    }
    if (specifier === "f") {
      return String(Number(value));
    }
    return String(value);
  });
}

/**
 * Original name: N/A
 * Source: N/A (system runtime state)
 * Category: New
 * Purpose: Hold the mutable host-facing runtime state for the `q_shared.h` system helpers.
 *
 * Constraints:
 * - Must preserve `curtime` and `paged_total` as explicit mutable values.
 * - Hunk allocation must remain linear until `Hunk_End`/`Hunk_Free`.
 */
export interface SystemRuntime {
  curtime: number;
  paged_total: number;
  hooks: SystemHooks;
  activeHunk: Uint8Array | null;
  hunkUsed: number;
  findResults: SysFindResult[];
  findIndex: number;
}

/**
 * Original name: N/A
 * Source: N/A (system runtime factory)
 * Category: New
 *
 * Behavior:
 * - Creates the explicit runtime that backs the shared system helper port.
 */
export function createSystemRuntime(hooks: SystemHooks = {}): SystemRuntime {
  return {
    curtime: 0,
    paged_total: 0,
    hooks,
    activeHunk: null,
    hunkUsed: 0,
    findResults: [],
    findIndex: 0
  };
}

/**
 * Original name: curtime
 * Source: game/q_shared.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the time captured by the latest `Sys_Milliseconds` call.
 */
export function get_curtime(runtime: SystemRuntime): number {
  return runtime.curtime;
}

/**
 * Original name: Sys_Milliseconds
 * Source: game/q_shared.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Reads host milliseconds and stores the result in `curtime`.
 */
export function Sys_Milliseconds(runtime: SystemRuntime): number {
  runtime.curtime = runtime.hooks.milliseconds?.() ?? 0;
  return runtime.curtime;
}

/**
 * Original name: Sys_Mkdir
 * Source: game/q_shared.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Requests creation of one host directory path.
 */
export function Sys_Mkdir(runtime: SystemRuntime, path: string): void {
  runtime.hooks.mkdir?.(path);
}

/**
 * Original name: Hunk_Begin
 * Source: game/q_shared.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Starts one linear hunk allocation block with the given maximum size.
 */
export function Hunk_Begin(runtime: SystemRuntime, maxsize: number): Uint8Array {
  const size = Math.max(0, maxsize | 0);
  runtime.activeHunk = new Uint8Array(size);
  runtime.hunkUsed = 0;
  return runtime.activeHunk;
}

/**
 * Original name: Hunk_Alloc
 * Source: game/q_shared.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns one contiguous slice from the active linear hunk block.
 *
 * Porting notes:
 * - Preserves Quake II's 32-byte cacheline rounding for consumed hunk size.
 */
export function Hunk_Alloc(runtime: SystemRuntime, size: number): Uint8Array {
  if (!runtime.activeHunk) {
    throw new Error("Hunk_Alloc called before Hunk_Begin");
  }

  const requestedSize = Math.max(0, size | 0);
  const allocationSize = (requestedSize + 31) & ~31;
  const nextUsed = runtime.hunkUsed + allocationSize;
  if (nextUsed > runtime.activeHunk.length) {
    throw new Error("Hunk_Alloc overflow");
  }

  const slice = runtime.activeHunk.subarray(runtime.hunkUsed, runtime.hunkUsed + requestedSize);
  runtime.hunkUsed = nextUsed;
  return slice;
}

/**
 * Original name: Hunk_Free
 * Source: game/q_shared.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Releases the active linear hunk block.
 *
 * Porting notes:
 * - Accepts the buffer argument for signature fidelity even though the runtime tracks one active block.
 */
export function Hunk_Free(runtime: SystemRuntime, _buffer: Uint8Array | null): void {
  runtime.activeHunk = null;
  runtime.hunkUsed = 0;
}

/**
 * Original name: Hunk_End
 * Source: game/q_shared.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the current number of bytes allocated from the active hunk.
 */
export function Hunk_End(runtime: SystemRuntime): number {
  return runtime.hunkUsed;
}

/**
 * Original name: Sys_FindFirst
 * Source: game/q_shared.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Starts one host file search and returns the first matching path.
 */
export function Sys_FindFirst(
  runtime: SystemRuntime,
  path: string,
  musthave: number,
  canthave: number
): string | null {
  runtime.findResults = runtime.hooks.find?.(path, musthave, canthave) ?? [];
  runtime.findIndex = 0;
  return runtime.findResults[0]?.path ?? null;
}

/**
 * Original name: Sys_FindNext
 * Source: game/q_shared.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns the next path from the active host file search.
 */
export function Sys_FindNext(runtime: SystemRuntime, _musthave: number, _canthave: number): string | null {
  runtime.findIndex += 1;
  return runtime.findResults[runtime.findIndex]?.path ?? null;
}

/**
 * Original name: Sys_FindClose
 * Source: game/q_shared.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Closes the active host file search.
 */
export function Sys_FindClose(runtime: SystemRuntime): void {
  runtime.findResults = [];
  runtime.findIndex = 0;
}

/**
 * Original name: Sys_Error
 * Source: qcommon/qcommon.h and game/q_shared.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Formats the variadic message and raises a fatal host error.
 *
 * Porting notes:
 * - The C declarations share the same `char *error, ...` system-service contract; the host hook still receives one formatted fatal message.
 */
export function Sys_Error(runtime: SystemRuntime, message: string, ...args: unknown[]): never {
  const formatted = formatSystemError(message, args);
  if (runtime.hooks.error) {
    return runtime.hooks.error(formatted);
  }

  throw new Error(formatted);
}

/**
 * Original name: Com_PageInMemory
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Touches one byte per 4096-byte page and accumulates the sum into `paged_total`.
 */
export function Com_PageInMemory(runtime: SystemRuntime, buffer: Uint8Array, size = buffer.length): void {
  for (let index = size - 1; index > 0; index -= 4096) {
    runtime.paged_total += buffer[index] as byte;
  }
}
