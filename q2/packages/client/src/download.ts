/**
 * File: download.ts
 * Source: Quake II original / client/cl_parse.c
 * Purpose: Port the first client-side download request helpers used to fetch missing assets from the server.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses hook-based file checks and resume probes instead of direct stdio and filesystem globals.
 * - Writes queued string commands through the current client runtime buffer.
 *
 * Notes:
 * - This file is intended to stay conceptually close to the original C source.
 */

import { Cmd_Argc, Cmd_Argv, type CommandRuntime } from "../../qcommon/src/index.js";
import { BASEDIRNAME } from "../../qcommon/src/index.js";
import { CL_WriteStringCmd } from "./cl_parse.js";
import type { ClientRuntime } from "./client.js";

/**
 * Original name: N/A
 * Source: N/A (download host hooks)
 * Category: New
 * Purpose: Group the host-side services needed by the partial download port.
 *
 * Constraints:
 * - Must keep filesystem and console behavior injectable while the platform layer is still in flux.
 */
export interface ClientDownloadHooks {
  fileExists?: (filename: string) => boolean;
  getPartialDownloadSize?: (filename: string) => number | null;
  onPrint?: (line: string) => void;
}

/**
 * Original name: CL_DownloadFileName
 * Source: client/cl_parse.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Resolves the local destination path used for one download target or temporary file.
 *
 * Porting notes:
 * - Returns the path string directly instead of writing into an output buffer.
 */
export function CL_DownloadFileName(runtime: ClientRuntime, filename: string): string {
  const gameDir = runtime.cl.gamedir.length > 0 ? runtime.cl.gamedir : BASEDIRNAME;
  const root = filename.startsWith("players") ? BASEDIRNAME : gameDir;
  return `${root}/${filename}`;
}

/**
 * Original name: CL_CheckOrDownloadFile
 * Source: client/cl_parse.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns true when a file already exists locally, otherwise queues a server download request.
 *
 * Porting notes:
 * - Uses hook-driven file existence and resume checks instead of direct filesystem/stdin access.
 */
export function CL_CheckOrDownloadFile(
  runtime: ClientRuntime,
  filename: string,
  hooks: ClientDownloadHooks = {}
): boolean {
  if (filename.includes("..")) {
    hooks.onPrint?.("Refusing to download a path with ..");
    return true;
  }

  if (hooks.fileExists?.(filename) === true) {
    return true;
  }

  runtime.cls.downloadname = filename;
  runtime.cls.downloadtempname = stripExtension(filename) + ".tmp";

  const tempPath = CL_DownloadFileName(runtime, runtime.cls.downloadtempname);
  const resumeSize = hooks.getPartialDownloadSize?.(tempPath) ?? null;

  if (resumeSize !== null && resumeSize > 0) {
    hooks.onPrint?.(`Resuming ${runtime.cls.downloadname}`);
    CL_WriteStringCmd(runtime, `download ${runtime.cls.downloadname} ${resumeSize}`);
  } else {
    hooks.onPrint?.(`Downloading ${runtime.cls.downloadname}`);
    CL_WriteStringCmd(runtime, `download ${runtime.cls.downloadname}`);
  }

  runtime.cls.downloadnumber += 1;
  return false;
}

/**
 * Original name: CL_Download_f
 * Source: client/cl_parse.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Requests one explicit download from the console command path.
 *
 * Porting notes:
 * - Reads command arguments from the injected `CommandRuntime`.
 * - Emits console text through hooks instead of direct `Com_Printf`.
 */
export function CL_Download_f(
  runtime: ClientRuntime,
  cmd: CommandRuntime,
  hooks: ClientDownloadHooks = {}
): void {
  if (Cmd_Argc(cmd) !== 2) {
    hooks.onPrint?.("Usage: download <filename>");
    return;
  }

  const filename = Cmd_Argv(cmd, 1);
  if (filename.includes("..")) {
    hooks.onPrint?.("Refusing to download a path with ..");
    return;
  }

  if (hooks.fileExists?.(filename) === true) {
    hooks.onPrint?.("File already exists.");
    return;
  }

  runtime.cls.downloadname = filename;
  runtime.cls.downloadtempname = stripExtension(filename) + ".tmp";

  hooks.onPrint?.(`Downloading ${runtime.cls.downloadname}`);
  CL_WriteStringCmd(runtime, `download ${runtime.cls.downloadname}`);
  runtime.cls.downloadnumber += 1;
}

/**
 * Original name: N/A
 * Source: N/A (local filename helper)
 * Category: New
 * Purpose: Remove the last filename extension while preserving the rest of the path.
 */
function stripExtension(filename: string): string {
  const lastSlash = Math.max(filename.lastIndexOf("/"), filename.lastIndexOf("\\"));
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= lastSlash) {
    return filename;
  }

  return filename.slice(0, lastDot);
}
