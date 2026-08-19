/**
 * File: web-config-commands.ts
 * Purpose: Register browser-hosted config commands without exposing storage details to engine packages.
 *
 * This file is not a direct source port.
 * `writeconfig` is a temporary web host command that delegates to the ported CL_WriteConfiguration path.
 *
 * Original name: N/A
 * Source: N/A (web host command)
 * Category: New
 *
 * Dependencies:
 * - packages/qcommon
 */

import {
  Cmd_AddCommand,
  Cmd_Exists,
  type CommandRuntime
} from "../../../packages/qcommon/src/index.js";

/**
 * Original name: N/A
 * Source: N/A (web host command)
 * Category: New
 *
 * Purpose:
 * - Adds the browser-hosted `writeconfig` command and delegates persistence to the client port.
 */
export function registerWebConfigCommands(
  cmd: CommandRuntime,
  hooks: {
    writeConfiguration: () => boolean;
    onPrint?: (message: string) => void;
  }
): void {
  if (Cmd_Exists(cmd, "writeconfig")) {
    return;
  }

  Cmd_AddCommand(cmd, "writeconfig", () => {
    if (hooks.writeConfiguration()) {
      hooks.onPrint?.("Wrote config.cfg.");
    }
  });
}
