/**
 * File: runtime.ts
 * Purpose: Wire together the first ported qcommon subsystems into one reusable runtime facade.
 *
 * This file is not a direct source port.
 * It is an adapter layer between ported qcommon modules and the surrounding platform/runtime.
 *
 * Dependencies:
 * - packages/qcommon
 * - packages/filesystem
 */

import { readMountedTextFile, type VirtualFilesystem } from "../../filesystem/src/index.js";
import {
  COM_InitArgv,
  createCommonRuntime,
  type CommonRuntime
} from "./common.js";
import {
  Cmd_Init,
  createCommandRuntime,
  type CommandRuntime
} from "./cmd.js";
import {
  Cvar_Command,
  Cvar_Init,
  Cvar_VariableString,
  createCvarRuntime,
  type CvarRuntime
} from "./cvar.js";

/**
 * Original name: N/A
 * Source: N/A (runtime facade)
 * Category: New
 * Purpose: Describe optional services used to adapt the qcommon runtime to the host platform.
 *
 * Constraints:
 * - Must keep the runtime independent from browser and Node-specific globals.
 */
export interface QcommonRuntimeOptions {
  argv?: string[];
  filesystem?: VirtualFilesystem;
  onPrint?: (line: string) => void;
}

/**
 * Original name: N/A
 * Source: N/A (runtime facade)
 * Category: New
 * Purpose: Expose the first integrated qcommon runtime state used by future client/server ports.
 *
 * Constraints:
 * - Must keep command and cvar runtimes accessible for direct incremental ports.
 */
export interface QcommonRuntime {
  common: CommonRuntime;
  cmd: CommandRuntime;
  cvar: CvarRuntime;
  filesystem?: VirtualFilesystem;
  output: string[];
}

/**
 * Original name: N/A
 * Source: N/A (runtime facade)
 * Category: New
 * Purpose: Create and initialize a qcommon runtime that wires together command, cvar and filesystem hooks.
 *
 * Constraints:
 * - Must preserve the original command-to-cvar fallback order.
 * - Must make macro expansion read through the cvar system.
 */
export function createQcommonRuntime(options: QcommonRuntimeOptions = {}): QcommonRuntime {
  const output: string[] = [];
  const emit = (line: string): void => {
    output.push(line);
    options.onPrint?.(line);
  };

  const common = createCommonRuntime();
  COM_InitArgv(common, options.argv ?? []);

  const cvar = createCvarRuntime({
    onPrint: emit
  });

  const cmd = createCommandRuntime({
    expandMacroToken: (token) => Cvar_VariableString(cvar, token),
    isKnownVariable: (name) => Cvar_VariableString(cvar, name).length > 0,
    executeUnknownCommand: () => {
      const result = Cvar_Command(cvar, cmd);
      if (result.handled) {
        if (result.output !== undefined) {
          emit(result.output);
        }
        return true;
      }

      return false;
    },
    loadTextFile: (path) => {
      if (!options.filesystem) {
        return null;
      }

      return readMountedTextFile(options.filesystem, path) ?? null;
    },
    onPrint: emit
  });

  Cmd_Init(cmd);
  Cvar_Init(cvar, cmd);

  return options.filesystem
    ? {
        common,
        cmd,
        cvar,
        filesystem: options.filesystem,
        output
      }
    : {
        common,
        cmd,
        cvar,
        output
      };
}
