/**
 * File: g_svcmds.ts
 * Source: Quake II original / game/g_svcmds.c
 * Purpose: Port of server-issued gameplay commands and packet filtering helpers.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - The mutable C globals for IP filters are grouped into an explicit `GameServerCommandState`.
 * - `SVCmd_WriteIP_f` writes through an injected callback instead of direct stdio calls.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

import { GAMEVERSION } from "./g_local.js";
import type { game_import_t } from "./game.js";
import { PRINT_HIGH, Q_stricmp } from "../../qcommon/src/index.js";

/**
 * Original name: ipfilter_t
 * Source: Quake-2-master/game/g_svcmds.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Stores one packet filter as the original `(mask, compare)` pair.
 */
export interface ipfilter_t {
  mask: number;
  compare: number;
}

/**
 * Original name: N/A
 * Source: N/A (explicit state holder)
 * Category: New
 * Purpose: Hold the mutable packet-filter state that originally lived in file-scope globals.
 *
 * Constraints:
 * - Must preserve `MAX_IPFILTERS`, `numipfilters` and the sentinel free-slot behavior.
 */
export interface GameServerCommandState {
  ipfilters: ipfilter_t[];
  numipfilters: number;
}

/**
 * Original name: N/A
 * Source: N/A (game import adapter)
 * Category: New
 * Purpose: Narrow the imported engine callbacks required by `g_svcmds.c`.
 */
export interface GameServerCommandContext {
  gi: Pick<game_import_t, "argc" | "argv" | "cprintf" | "cvar">;
  writeFile?: (path: string, contents: string) => boolean;
}

/**
 * Original name: MAX_IPFILTERS
 * Source: Quake-2-master/game/g_svcmds.c
 * Category: Ported
 * Fidelity level: Strict
 */
export const MAX_IPFILTERS = 1024;

/**
 * Original name: N/A
 * Source: N/A (free-slot sentinel)
 * Category: New
 * Purpose: Preserve the original deleted-slot sentinel used by `SVCmd_AddIP_f`.
 */
const FREE_IPFILTER_COMPARE = 0xffffffff;

/**
 * Original name: N/A
 * Source: N/A (state factory)
 * Category: New
 * Purpose: Create the zero-initialized server-command state used by the `g_svcmds.c` port.
 */
export function createGameServerCommandState(): GameServerCommandState {
  return {
    ipfilters: Array.from({ length: MAX_IPFILTERS }, () => ({ mask: 0, compare: 0 })),
    numipfilters: 0
  };
}

/**
 * Original name: Svcmd_Test_f
 * Source: Quake-2-master/game/g_svcmds.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits the diagnostic line used by the original `sv test` command.
 */
export function Svcmd_Test_f(context: GameServerCommandContext): void {
  context.gi.cprintf(null, PRINT_HIGH, "Svcmd_Test_f()\n");
}

/**
 * Original name: StringToFilter
 * Source: Quake-2-master/game/g_svcmds.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Parses a dotted IP mask into the original byte-packed `(mask, compare)` representation.
 * - Treats omitted octets as wildcards by leaving the mask bytes at zero.
 */
export function StringToFilter(context: GameServerCommandContext, source: string, filter: ipfilter_t): boolean {
  const bytes = [0, 0, 0, 0];
  const mask = [0, 0, 0, 0];
  let cursor = 0;

  for (let index = 0; index < 4; index += 1) {
    if (cursor >= source.length) {
      context.gi.cprintf(null, PRINT_HIGH, "Bad filter address: %s\n", source);
      return false;
    }

    const character = source.charCodeAt(cursor);
    if (character < 48 || character > 57) {
      context.gi.cprintf(null, PRINT_HIGH, "Bad filter address: %s\n", source);
      return false;
    }

    let start = cursor;
    while (cursor < source.length) {
      const digit = source.charCodeAt(cursor);
      if (digit < 48 || digit > 57) {
        break;
      }
      cursor += 1;
    }

    const value = Number.parseInt(source.slice(start, cursor), 10) & 0xff;
    bytes[index] = value;
    if (value !== 0) {
      mask[index] = 255;
    }

    if (cursor >= source.length) {
      break;
    }

    cursor += 1;
  }

  filter.mask = packFilterBytes(mask);
  filter.compare = packFilterBytes(bytes);
  return true;
}

/**
 * Original name: SV_FilterPacket
 * Source: Quake-2-master/game/g_svcmds.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Evaluates one textual remote address against the current IP filter list and `filterban`.
 */
export function SV_FilterPacket(
  state: GameServerCommandState,
  context: GameServerCommandContext,
  from: string
): boolean {
  const bytes = [0, 0, 0, 0];
  let octet = 0;
  let cursor = 0;

  while (cursor < from.length && octet < 4) {
    bytes[octet] = 0;
    while (cursor < from.length) {
      const character = from.charCodeAt(cursor);
      if (character < 48 || character > 57) {
        break;
      }

      bytes[octet] = bytes[octet] * 10 + (character - 48);
      cursor += 1;
    }

    if (cursor >= from.length || from[cursor] === ":") {
      break;
    }

    octet += 1;
    cursor += 1;
  }

  const address = packFilterBytes(bytes);
  const filterban = getFilterBanValue(context);

  for (let index = 0; index < state.numipfilters; index += 1) {
    const filter = state.ipfilters[index];
    if (((address & filter.mask) >>> 0) === filter.compare) {
      return filterban !== 0;
    }
  }

  return filterban === 0;
}

/**
 * Original name: SVCmd_AddIP_f
 * Source: Quake-2-master/game/g_svcmds.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Adds one dotted IP mask to the persistent filter table.
 */
export function SVCmd_AddIP_f(state: GameServerCommandState, context: GameServerCommandContext): void {
  if (context.gi.argc() < 3) {
    context.gi.cprintf(null, PRINT_HIGH, "Usage:  addip <ip-mask>\n");
    return;
  }

  let index = 0;
  for (; index < state.numipfilters; index += 1) {
    if (state.ipfilters[index].compare === FREE_IPFILTER_COMPARE) {
      break;
    }
  }

  if (index === state.numipfilters) {
    if (state.numipfilters === MAX_IPFILTERS) {
      context.gi.cprintf(null, PRINT_HIGH, "IP filter list is full\n");
      return;
    }
    state.numipfilters += 1;
  }

  if (!StringToFilter(context, context.gi.argv(2), state.ipfilters[index])) {
    state.ipfilters[index].compare = FREE_IPFILTER_COMPARE;
  }
}

/**
 * Original name: SVCmd_RemoveIP_f
 * Source: Quake-2-master/game/g_svcmds.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Removes one exact `(mask, compare)` match from the filter table.
 */
export function SVCmd_RemoveIP_f(state: GameServerCommandState, context: GameServerCommandContext): void {
  const filter: ipfilter_t = { mask: 0, compare: 0 };

  if (context.gi.argc() < 3) {
    context.gi.cprintf(null, PRINT_HIGH, "Usage:  sv removeip <ip-mask>\n");
    return;
  }

  if (!StringToFilter(context, context.gi.argv(2), filter)) {
    return;
  }

  for (let index = 0; index < state.numipfilters; index += 1) {
    const current = state.ipfilters[index];
    if (current.mask === filter.mask && current.compare === filter.compare) {
      for (let move = index + 1; move < state.numipfilters; move += 1) {
        state.ipfilters[move - 1] = { ...state.ipfilters[move] };
      }
      state.numipfilters -= 1;
      context.gi.cprintf(null, PRINT_HIGH, "Removed.\n");
      return;
    }
  }

  context.gi.cprintf(null, PRINT_HIGH, "Didn't find %s.\n", context.gi.argv(2));
}

/**
 * Original name: SVCmd_ListIP_f
 * Source: Quake-2-master/game/g_svcmds.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Prints the current filter list using the original padded formatting.
 */
export function SVCmd_ListIP_f(state: GameServerCommandState, context: GameServerCommandContext): void {
  context.gi.cprintf(null, PRINT_HIGH, "Filter list:\n");

  for (let index = 0; index < state.numipfilters; index += 1) {
    const bytes = unpackFilterBytes(state.ipfilters[index].compare);
    context.gi.cprintf(
      null,
      PRINT_HIGH,
      "%3i.%3i.%3i.%3i\n",
      bytes[0],
      bytes[1],
      bytes[2],
      bytes[3]
    );
  }
}

/**
 * Original name: SVCmd_WriteIP_f
 * Source: Quake-2-master/game/g_svcmds.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Serializes the current filter list to `listip.cfg`.
 *
 * Porting notes:
 * - Uses an injected writer callback instead of direct `fopen`/`fprintf`.
 */
export function SVCmd_WriteIP_f(state: GameServerCommandState, context: GameServerCommandContext): void {
  const game = context.gi.cvar("game", "", 0);
  const directory = game?.string ? game.string : GAMEVERSION;
  const name = `${directory}/listip.cfg`;

  context.gi.cprintf(null, PRINT_HIGH, "Writing %s.\n", name);

  if (!context.writeFile) {
    context.gi.cprintf(null, PRINT_HIGH, "Couldn't open %s\n", name);
    return;
  }

  const lines: string[] = [`set filterban ${getFilterBanValue(context)}`];
  for (let index = 0; index < state.numipfilters; index += 1) {
    const bytes = unpackFilterBytes(state.ipfilters[index].compare);
    lines.push(`sv addip ${bytes[0]}.${bytes[1]}.${bytes[2]}.${bytes[3]}`);
  }

  const wrote = context.writeFile(name, `${lines.join("\n")}\n`);
  if (!wrote) {
    context.gi.cprintf(null, PRINT_HIGH, "Couldn't open %s\n", name);
  }
}

/**
 * Original name: ServerCommand
 * Source: Quake-2-master/game/g_svcmds.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Dispatches one `sv` command by name through the original command table.
 */
export function ServerCommand(state: GameServerCommandState, context: GameServerCommandContext): void {
  const cmd = context.gi.argv(1);

  if (stringsEqualIgnoreCase(cmd, "test")) {
    Svcmd_Test_f(context);
  } else if (stringsEqualIgnoreCase(cmd, "addip")) {
    SVCmd_AddIP_f(state, context);
  } else if (stringsEqualIgnoreCase(cmd, "removeip")) {
    SVCmd_RemoveIP_f(state, context);
  } else if (stringsEqualIgnoreCase(cmd, "listip")) {
    SVCmd_ListIP_f(state, context);
  } else if (stringsEqualIgnoreCase(cmd, "writeip")) {
    SVCmd_WriteIP_f(state, context);
  } else {
    context.gi.cprintf(null, PRINT_HIGH, "Unknown server command \"%s\"\n", cmd);
  }
}

/**
 * Original name: N/A
 * Source: N/A (cvar access helper)
 * Category: New
 * Purpose: Centralize the original `filterban` default/fallback behavior.
 */
function getFilterBanValue(context: GameServerCommandContext): number {
  const filterban = context.gi.cvar("filterban", "1", 0);
  return filterban ? (filterban.value | 0) : 1;
}

/**
 * Original name: N/A
 * Source: N/A (local string compare helper)
 * Category: New
 * Purpose: Keep server-command dispatch on the shared Quake II case-insensitive comparison.
 */
function stringsEqualIgnoreCase(left: string, right: string): boolean {
  return Q_stricmp(left, right) === 0;
}

/**
 * Original name: N/A
 * Source: N/A (byte packing helper)
 * Category: New
 * Purpose: Reproduce the little-endian byte view used by the C packet filter code.
 */
function packFilterBytes(bytes: number[]): number {
  return (
    ((bytes[0] ?? 0) & 0xff) |
    (((bytes[1] ?? 0) & 0xff) << 8) |
    (((bytes[2] ?? 0) & 0xff) << 16) |
    (((bytes[3] ?? 0) & 0xff) << 24)
  ) >>> 0;
}

/**
 * Original name: N/A
 * Source: N/A (byte unpacking helper)
 * Category: New
 * Purpose: Reproduce the little-endian byte view used when listing and writing filters.
 */
function unpackFilterBytes(value: number): [number, number, number, number] {
  return [
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff
  ];
}
