/**
 * File: cvar.ts
 * Source: Quake II original / qcommon/cvar.c
 * Purpose: Port the core Quake II dynamic variable system used by commands and runtime configuration.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses explicit runtime state objects instead of mutable file-static globals.
 * - Defers game-dir and info-string side effects to optional hooks.
 *
 * Notes:
 * - This file is intended to stay conceptually close to the original C source.
 */

import { type CommandRuntime, Cmd_AddCommand, Cmd_Argc, Cmd_Argv } from "./cmd.js";
import {
  Info_RemoveKey,
  Info_SetValueForKey,
  Info_ValueForKey
} from "./common.js";

/**
 * Original name: CVAR_ARCHIVE / CVAR_USERINFO / CVAR_SERVERINFO / CVAR_NOSET / CVAR_LATCH
 * Source: game/q_shared.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Preserve the original cvar flag bit values shared by qcommon, client and server code.
 */
export const CVAR_ARCHIVE = 1;
export const CVAR_USERINFO = 2;
export const CVAR_SERVERINFO = 4;
export const CVAR_NOSET = 8;
export const CVAR_LATCH = 16;

/**
 * Original name: cvar_t
 * Source: game/q_shared.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Stores the scalar/string value, flags, latched value and modified state of one cvar.
 *
 * Porting notes:
 * - The original linked-list `next` field is represented by `CvarRuntime.cvar_vars`.
 */
export interface cvar_t {
  name: string;
  string: string;
  latched_string: string | null;
  flags: number;
  modified: boolean;
  value: number;
}

/**
 * Original name: N/A
 * Source: N/A (runtime adapter)
 * Category: New
 * Purpose: Expose side-effect hooks for Cvar behavior that was file-static or engine-global in C.
 */
export interface CvarHooks {
  onInfoValidationError?: (kind: "name" | "value") => void;
  onWriteProtected?: (name: string) => void;
  onLatchedChange?: (name: string) => void;
  onVariableSet?: (variable: cvar_t, previousValue: string) => void;
  onGameDirChange?: (value: string) => void;
  onExecAutoexec?: () => void;
  onPrint?: (line: string) => void;
}

/**
 * Original name: cvar_vars / userinfo_modified
 * Source: qcommon/cvar.c
 * Category: Adapter
 * Purpose: Hold the original cvar globals in an explicit runtime object for isolated tests and hosts.
 */
export interface CvarRuntime {
  cvar_vars: cvar_t[];
  userinfo_modified: boolean;
  server_state: number;
  hooks: CvarHooks;
}

/**
 * Original name: N/A
 * Source: N/A (runtime adapter)
 * Category: New
 * Purpose: Create an isolated cvar runtime compatible with Quake II cvar behavior.
 *
 * Constraints:
 * - Must start with an empty variable list.
 */
export function createCvarRuntime(hooks: CvarHooks = {}): CvarRuntime {
  return {
    cvar_vars: [],
    userinfo_modified: false,
    server_state: 0,
    hooks
  };
}

/**
 * Original name: Cvar_VariableValue
 * Source: qcommon/cvar.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the numeric value of a cvar or zero when missing.
 *
 * Porting notes:
 * - Uses JavaScript number parsing instead of `atof`.
 */
export function Cvar_VariableValue(runtime: CvarRuntime, var_name: string): number {
  const variable = Cvar_FindVar(runtime, var_name);
  return variable ? variable.value : 0;
}

/**
 * Original name: Cvar_VariableString
 * Source: qcommon/cvar.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the string value of a cvar or an empty string when missing.
 *
 * Porting notes:
 * - Mirrors the original empty-string fallback.
 */
export function Cvar_VariableString(runtime: CvarRuntime, var_name: string): string {
  const variable = Cvar_FindVar(runtime, var_name);
  return variable ? variable.string : "";
}

/**
 * Original name: Cvar_CompleteVariable
 * Source: qcommon/cvar.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Attempts exact then partial completion for a cvar name.
 *
 * Porting notes:
 * - Preserves search order over the stored cvar list.
 */
export function Cvar_CompleteVariable(runtime: CvarRuntime, partial: string): string | null {
  if (partial.length === 0) {
    return null;
  }

  for (const variable of runtime.cvar_vars) {
    if (variable.name === partial) {
      return variable.name;
    }
  }

  for (const variable of runtime.cvar_vars) {
    if (variable.name.startsWith(partial)) {
      return variable.name;
    }
  }

  return null;
}

/**
 * Original name: Cvar_Get
 * Source: qcommon/cvar.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Finds or creates a cvar, preserving the original "existing value wins" behavior.
 *
 * Porting notes:
 * - Returns null on invalid info strings or missing default values, matching the original failure paths.
 */
export function Cvar_Get(runtime: CvarRuntime, var_name: string, var_value: string | null, flags: number): cvar_t | null {
  if ((flags & (CVAR_USERINFO | CVAR_SERVERINFO)) !== 0 && !Cvar_InfoValidate(var_name)) {
    runtime.hooks.onPrint?.("invalid info cvar name\n");
    runtime.hooks.onInfoValidationError?.("name");
    return null;
  }

  const existing = Cvar_FindVar(runtime, var_name);
  if (existing) {
    existing.flags |= flags;
    return existing;
  }

  if (var_value === null) {
    return null;
  }

  if ((flags & (CVAR_USERINFO | CVAR_SERVERINFO)) !== 0 && !Cvar_InfoValidate(var_value)) {
    runtime.hooks.onPrint?.("invalid info cvar value\n");
    runtime.hooks.onInfoValidationError?.("value");
    return null;
  }

  const variable: cvar_t = {
    name: var_name,
    string: var_value,
    latched_string: null,
    flags,
    modified: true,
    value: parseCvarFloat(var_value)
  };

  runtime.cvar_vars.unshift(variable);
  return variable;
}

/**
 * Original name: Cvar_ForceSet
 * Source: qcommon/cvar.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Sets a cvar while bypassing NOSET and LATCH restrictions.
 *
 * Porting notes:
 * - Reuses the shared Cvar_Set2 port with `force = true`.
 */
export function Cvar_ForceSet(runtime: CvarRuntime, var_name: string, value: string): cvar_t | null {
  return Cvar_Set2(runtime, var_name, value, true);
}

/**
 * Original name: Cvar_Set
 * Source: qcommon/cvar.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Sets a cvar while respecting NOSET and LATCH restrictions.
 *
 * Porting notes:
 * - Reuses the shared Cvar_Set2 port with `force = false`.
 */
export function Cvar_Set(runtime: CvarRuntime, var_name: string, value: string): cvar_t | null {
  return Cvar_Set2(runtime, var_name, value, false);
}

/**
 * Original name: Cvar_FullSet
 * Source: qcommon/cvar.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Sets both the value and flag mask of a cvar.
 *
 * Porting notes:
 * - Preserves the original overwrite semantics for existing variables.
 */
export function Cvar_FullSet(runtime: CvarRuntime, var_name: string, value: string, flags: number): cvar_t | null {
  const existing = Cvar_FindVar(runtime, var_name);
  if (!existing) {
    return Cvar_Get(runtime, var_name, value, flags);
  }

  existing.modified = true;
  if ((existing.flags & CVAR_USERINFO) !== 0) {
    runtime.userinfo_modified = true;
  }

  existing.string = value;
  existing.value = parseCvarFloat(value);
  existing.flags = flags;
  return existing;
}

/**
 * Original name: Cvar_SetValue
 * Source: qcommon/cvar.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Formats a numeric value and forwards it through Cvar_Set.
 *
 * Porting notes:
 * - Preserves the original integer formatting shortcut.
 */
export function Cvar_SetValue(runtime: CvarRuntime, var_name: string, value: number): cvar_t | null {
  const serialized = Number.isInteger(value) ? `${value}` : value.toFixed(6);
  return Cvar_Set(runtime, var_name, serialized);
}

/**
 * Original name: Cvar_GetLatchedVars
 * Source: qcommon/cvar.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies all latched values to their active cvars.
 *
 * Porting notes:
 * - Triggers the optional game-dir and autoexec hooks when `game` changes.
 */
export function Cvar_GetLatchedVars(runtime: CvarRuntime): void {
  for (const variable of runtime.cvar_vars) {
    if (variable.latched_string === null) {
      continue;
    }

    variable.string = variable.latched_string;
    variable.latched_string = null;
    variable.value = parseCvarFloat(variable.string);

    if (variable.name === "game") {
      runtime.hooks.onGameDirChange?.(variable.string);
      runtime.hooks.onExecAutoexec?.();
    }
  }
}

/**
 * Original name: Cvar_Command
 * Source: qcommon/cvar.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Prints or sets a cvar from the current command context.
 *
 * Porting notes:
 * - Returns a structured result instead of printing directly.
 */
export function Cvar_Command(cvarRuntime: CvarRuntime, cmdRuntime: CommandRuntime): { handled: boolean; output?: string } {
  const variable = Cvar_FindVar(cvarRuntime, Cmd_Argv(cmdRuntime, 0));
  if (!variable) {
    return { handled: false };
  }

  if (Cmd_Argc(cmdRuntime) === 1) {
    return {
      handled: true,
      output: `"${variable.name}" is "${variable.string}"`
    };
  }

  Cvar_Set(cvarRuntime, variable.name, Cmd_Argv(cmdRuntime, 1));
  return { handled: true };
}

/**
 * Original name: Cvar_BitInfo
 * Source: qcommon/cvar.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Builds a key/value info string from cvars selected by one flag bit.
 *
 * Porting notes:
 * - Uses the shared Quake info-string limits.
 */
export function Cvar_BitInfo(runtime: CvarRuntime, bit: number): string {
  let info = "";

  for (const variable of runtime.cvar_vars) {
    if ((variable.flags & bit) === 0) {
      continue;
    }

    info = Info_SetValueForKey(info, variable.name, variable.string);
  }

  return info;
}

/**
 * Original name: Cvar_Userinfo
 * Source: qcommon/cvar.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns an info string containing all userinfo cvars.
 *
 * Porting notes:
 * - Reuses the shared Cvar_BitInfo helper.
 */
export function Cvar_Userinfo(runtime: CvarRuntime): string {
  return Cvar_BitInfo(runtime, CVAR_USERINFO);
}

/**
 * Original name: Cvar_Serverinfo
 * Source: qcommon/cvar.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns an info string containing all serverinfo cvars.
 *
 * Porting notes:
 * - Reuses the shared Cvar_BitInfo helper.
 */
export function Cvar_Serverinfo(runtime: CvarRuntime): string {
  return Cvar_BitInfo(runtime, CVAR_SERVERINFO);
}

/**
 * Original name: Cvar_WriteVariables
 * Source: qcommon/cvar.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Serializes all archive-marked cvars to `set` commands.
 *
 * Porting notes:
 * - Returns the serialized text instead of appending to a FILE stream.
 */
export function Cvar_WriteVariables(runtime: CvarRuntime): string {
  const lines: string[] = [];

  for (const variable of runtime.cvar_vars) {
    if ((variable.flags & CVAR_ARCHIVE) === 0) {
      continue;
    }

    lines.push(`set ${variable.name} "${variable.string}"`);
  }

  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

/**
 * Original name: Cvar_Init
 * Source: qcommon/cvar.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Registers the built-in `set` and `cvarlist` console commands in the command runtime.
 *
 * Porting notes:
 * - Captures explicit cvar and command runtimes instead of using file-static globals.
 * - Routes command output through the runtime print hook.
 */
export function Cvar_Init(cvarRuntime: CvarRuntime, cmdRuntime: CommandRuntime): void {
  Cmd_AddCommand(cmdRuntime, "set", () => {
    emitCvarOutput(cvarRuntime, Cvar_Set_f(cvarRuntime, cmdRuntime));
  });
  Cmd_AddCommand(cmdRuntime, "cvarlist", () => {
    emitCvarOutput(cvarRuntime, Cvar_List_f(cvarRuntime));
  });
}

/**
 * Original name: Cvar_Set_f
 * Source: qcommon/cvar.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Handles the console-facing `set` command with optional `u` and `s` flags.
 *
 * Porting notes:
 * - Returns usage/help strings instead of printing directly.
 */
export function Cvar_Set_f(cvarRuntime: CvarRuntime, cmdRuntime: CommandRuntime): string | void {
  const argc = Cmd_Argc(cmdRuntime);
  if (argc !== 3 && argc !== 4) {
    return "usage: set <variable> <value> [u / s]";
  }

  if (argc === 4) {
    const flagArg = Cmd_Argv(cmdRuntime, 3);
    if (flagArg === "u") {
      Cvar_FullSet(cvarRuntime, Cmd_Argv(cmdRuntime, 1), Cmd_Argv(cmdRuntime, 2), CVAR_USERINFO);
      return;
    }

    if (flagArg === "s") {
      Cvar_FullSet(cvarRuntime, Cmd_Argv(cmdRuntime, 1), Cmd_Argv(cmdRuntime, 2), CVAR_SERVERINFO);
      return;
    }

    return "flags can only be 'u' or 's'";
  }

  Cvar_Set(cvarRuntime, Cmd_Argv(cmdRuntime, 1), Cmd_Argv(cmdRuntime, 2));
}

/**
 * Original name: Cvar_List_f
 * Source: qcommon/cvar.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Lists all cvars with their archive/user/server/latch flags.
 *
 * Porting notes:
 * - Returns formatted lines instead of printing directly.
 */
export function Cvar_List_f(runtime: CvarRuntime): string[] {
  const lines: string[] = [];

  for (const variable of runtime.cvar_vars) {
    lines.push(`${flagPrefix(variable.flags)} ${variable.name} "${variable.string}"`);
  }

  lines.push(`${runtime.cvar_vars.length} cvars`);
  return lines;
}

/**
 * Original name: Cvar_FindVar
 * Source: qcommon/cvar.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Finds a cvar by exact name.
 *
 * Porting notes:
 * - Preserves the original linear search behavior.
 */
export function Cvar_FindVar(runtime: CvarRuntime, var_name: string): cvar_t | null {
  return runtime.cvar_vars.find((variable) => variable.name === var_name) ?? null;
}

/**
 * Original name: Cvar_InfoValidate
 * Source: qcommon/cvar.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Rejects info strings containing `\\`, `\"` or `;`.
 *
 * Porting notes:
 * - Preserves the original forbidden character checks.
 */
export function Cvar_InfoValidate(value: string): boolean {
  return !value.includes("\\") && !value.includes("\"") && !value.includes(";");
}

/**
 * Original name: N/A
 * Source: N/A (runtime adapter)
 * Category: New
 * Purpose: Set the runtime server state used by latched cvar behavior.
 *
 * Constraints:
 * - Must keep the state explicit for predictable tests.
 */
export function Cvar_SetServerState(runtime: CvarRuntime, state: number): void {
  runtime.server_state = state;
}

/**
 * Original name: Cvar_Set2
 * Source: qcommon/cvar.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Internal shared setter handling NOSET, LATCH and forced updates.
 *
 * Porting notes:
 * - Exposed to simplify incremental porting and tests.
 */
export function Cvar_Set2(runtime: CvarRuntime, var_name: string, value: string, force: boolean): cvar_t | null {
  const variable = Cvar_FindVar(runtime, var_name);
  if (!variable) {
    return Cvar_Get(runtime, var_name, value, 0);
  }

  if ((variable.flags & (CVAR_USERINFO | CVAR_SERVERINFO)) !== 0 && !Cvar_InfoValidate(value)) {
    runtime.hooks.onPrint?.("invalid info cvar value\n");
    runtime.hooks.onInfoValidationError?.("value");
    return variable;
  }

  if (!force) {
    if ((variable.flags & CVAR_NOSET) !== 0) {
      runtime.hooks.onPrint?.(`${var_name} is write protected.\n`);
      runtime.hooks.onWriteProtected?.(var_name);
      return variable;
    }

    if ((variable.flags & CVAR_LATCH) !== 0) {
      if (variable.latched_string !== null) {
        if (value === variable.latched_string) {
          return variable;
        }
      } else if (value === variable.string) {
        return variable;
      }

      if (runtime.server_state !== 0) {
        runtime.hooks.onPrint?.(`${var_name} will be changed for next game.\n`);
        variable.latched_string = value;
        runtime.hooks.onLatchedChange?.(var_name);
      } else {
        variable.string = value;
        variable.value = parseCvarFloat(variable.string);
        if (variable.name === "game") {
          runtime.hooks.onGameDirChange?.(variable.string);
          runtime.hooks.onExecAutoexec?.();
        }
      }

      return variable;
    }
  } else if (variable.latched_string !== null) {
    variable.latched_string = null;
  }

  if (value === variable.string) {
    return variable;
  }

  variable.modified = true;
  if ((variable.flags & CVAR_USERINFO) !== 0) {
    runtime.userinfo_modified = true;
  }

  const previousValue = variable.string;
  variable.string = value;
  variable.value = parseCvarFloat(variable.string);
  runtime.hooks.onVariableSet?.(variable, previousValue);
  return variable;
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Parse a cvar string to a numeric value using Quake-like permissive float parsing.
 *
 * Constraints:
 * - Must return zero for non-numeric values.
 */
function parseCvarFloat(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Render the four-character flag prefix used by the original `cvarlist` output.
 *
 * Constraints:
 * - Must preserve archive, userinfo, serverinfo and no-set/latch markers.
 */
function flagPrefix(flags: number): string {
  const archive = (flags & CVAR_ARCHIVE) !== 0 ? "*" : " ";
  const userinfo = (flags & CVAR_USERINFO) !== 0 ? "U" : " ";
  const serverinfo = (flags & CVAR_SERVERINFO) !== 0 ? "S" : " ";
  const protection = (flags & CVAR_NOSET) !== 0 ? "-" : (flags & CVAR_LATCH) !== 0 ? "L" : " ";
  return `${archive}${userinfo}${serverinfo}${protection}`;
}

/**
 * Original name: N/A
 * Source: N/A (runtime adapter)
 * Category: New
 * Purpose: Forward cvar command output values to the optional print hook in a consistent way.
 *
 * Constraints:
 * - Must ignore undefined results.
 * - Must emit array outputs line by line.
 */
function emitCvarOutput(runtime: CvarRuntime, output: string | string[] | void): void {
  if (output === undefined) {
    return;
  }

  if (Array.isArray(output)) {
    for (const line of output) {
      runtime.hooks.onPrint?.(line);
    }
    return;
  }

  runtime.hooks.onPrint?.(output);
}
