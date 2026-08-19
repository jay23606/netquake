/**
 * File: cmd.ts
 * Source: Quake II original / qcommon/cmd.c
 * Purpose: Port the core Quake II command buffer, tokenization and command registry logic.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses explicit runtime state objects instead of mutable file-static globals.
 * - Defers macro expansion and cvar execution to optional hooks.
 *
 * Notes:
 * - This file is intended to stay conceptually close to the original C source.
 */

import { createSizeBuffer, SZ_Clear, SZ_Write, type sizebuf_t } from "../../memory/src/index.js";
import { MAX_STRING_CHARS, MAX_STRING_TOKENS } from "./q_shared.js";
import { COM_Argc, COM_Argv, COM_ClearArgv, COM_Parse, Q_stricmp, type CommonRuntime } from "./common.js";

/**
 * Original name: EXEC_NOW / EXEC_INSERT / EXEC_APPEND
 * Source: qcommon/qcommon.h
 * Category: Ported
 */
export const EXEC_NOW = 0;
export const EXEC_INSERT = 1;
export const EXEC_APPEND = 2;

/**
 * Original name: ALIAS_LOOP_COUNT / MAX_ALIAS_NAME
 * Source: qcommon/cmd.c
 * Category: Ported
 */
export const ALIAS_LOOP_COUNT = 16;
export const MAX_ALIAS_NAME = 32;

/**
 * Original name: cmd_text_buf
 * Source: qcommon/cmd.c
 * Category: Adapter
 */
const COMMAND_BUFFER_SIZE = 8192;

/**
 * Original name: xcommand_t
 * Source: qcommon/qcommon.h
 * Category: Ported
 */
export type xcommand_t = () => void;

/**
 * Original name: cmd_function_s
 * Source: qcommon/cmd.c
 * Category: Ported
 */
export interface CommandRegistration {
  name: string;
  fn: xcommand_t | null;
}

/**
 * Original name: cmdalias_s
 * Source: qcommon/cmd.c
 * Category: Ported
 */
export interface CommandAlias {
  name: string;
  value: string;
}

/**
 * Original name: N/A
 * Source: N/A (command runtime hooks)
 * Category: New
 */
export interface CommandHooks {
  executeUnknownCommand?: (name: string, text: string) => boolean;
  expandMacroToken?: (token: string) => string;
  isKnownVariable?: (name: string) => boolean;
  loadTextFile?: (path: string) => string | null;
  forwardToServer?: (text: string) => void;
  onPrint?: (line: string) => void;
}

/**
 * Original name: cmd_text / defer_text_buf / cmd_wait / alias_count / cmd_argc / cmd_argv / cmd_args / cmd_functions / cmd_alias
 * Source: qcommon/cmd.c
 * Category: Adapter
 */
export interface CommandRuntime {
  cmd_text: sizebuf_t;
  defer_text: string;
  cmd_wait: boolean;
  alias_count: number;
  cmd_argc: number;
  cmd_argv: string[];
  cmd_args: string;
  cmd_functions: CommandRegistration[];
  cmd_aliases: CommandAlias[];
  hooks: CommandHooks;
}

/**
 * Original name: N/A
 * Source: N/A (command runtime factory)
 * Category: New
 * Purpose: Create an isolated command runtime compatible with Quake II command processing concepts.
 *
 * Constraints:
 * - Must start with a clean command buffer and empty command registry.
 */
export function createCommandRuntime(hooks: CommandHooks = {}): CommandRuntime {
  return {
    cmd_text: createSizeBuffer(COMMAND_BUFFER_SIZE),
    defer_text: "",
    cmd_wait: false,
    alias_count: 0,
    cmd_argc: 0,
    cmd_argv: [],
    cmd_args: "",
    cmd_functions: [],
    cmd_aliases: [],
    hooks
  };
}

/**
 * Original name: Cbuf_Init
 * Source: qcommon/cmd.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes the command text buffer.
 *
 * Porting notes:
 * - Reuses the preallocated runtime size buffer instead of static C arrays.
 */
export function Cbuf_Init(runtime: CommandRuntime): void {
  runtime.cmd_text = createSizeBuffer(COMMAND_BUFFER_SIZE);
}

/**
 * Original name: Cbuf_AddText
 * Source: qcommon/cmd.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Appends raw command text to the end of the command buffer.
 *
 * Porting notes:
 * - Emits through the runtime print hook instead of Com_Printf.
 */
export function Cbuf_AddText(runtime: CommandRuntime, text: string): void {
  const encoded = encodeAscii(text);
  if (runtime.cmd_text.cursize + encoded.length >= runtime.cmd_text.maxsize) {
    runtime.hooks.onPrint?.("Cbuf_AddText: overflow\n");
    return;
  }

  SZ_Write(runtime.cmd_text, encoded);
}

/**
 * Original name: Cbuf_InsertText
 * Source: qcommon/cmd.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Inserts text immediately before the remaining queued commands.
 *
 * Porting notes:
 * - Uses temporary byte snapshots instead of zone allocations.
 */
export function Cbuf_InsertText(runtime: CommandRuntime, text: string): void {
  const existing = runtime.cmd_text.data.slice(0, runtime.cmd_text.cursize);
  SZ_Clear(runtime.cmd_text);
  Cbuf_AddText(runtime, text);
  if (existing.length > 0) {
    SZ_Write(runtime.cmd_text, existing);
  }
}

/**
 * Original name: Cbuf_CopyToDefer
 * Source: qcommon/cmd.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Moves the current command buffer into a deferred holding area.
 *
 * Porting notes:
 * - Stores deferred text as a JavaScript string instead of a raw byte array.
 */
export function Cbuf_CopyToDefer(runtime: CommandRuntime): void {
  runtime.defer_text = decodeAscii(runtime.cmd_text.data.subarray(0, runtime.cmd_text.cursize));
  runtime.cmd_text.cursize = 0;
}

/**
 * Original name: Cbuf_InsertFromDefer
 * Source: qcommon/cmd.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Re-inserts previously deferred command text at the front of the command buffer.
 *
 * Porting notes:
 * - Clears the deferred text after insertion, matching the original intent.
 */
export function Cbuf_InsertFromDefer(runtime: CommandRuntime): void {
  Cbuf_InsertText(runtime, runtime.defer_text);
  runtime.defer_text = "";
}

/**
 * Original name: Cbuf_ExecuteText
 * Source: qcommon/cmd.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Executes text immediately or schedules it in the command buffer.
 *
 * Porting notes:
 * - Throws on invalid exec mode instead of calling Com_Error.
 */
export function Cbuf_ExecuteText(runtime: CommandRuntime, exec_when: number, text: string): void {
  switch (exec_when) {
    case EXEC_NOW:
      Cmd_ExecuteString(runtime, text);
      break;
    case EXEC_INSERT:
      Cbuf_InsertText(runtime, text);
      break;
    case EXEC_APPEND:
      Cbuf_AddText(runtime, text);
      break;
    default:
      throw new Error("Cbuf_ExecuteText: bad exec_when");
  }
}

/**
 * Original name: Cbuf_Execute
 * Source: qcommon/cmd.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Executes queued command lines split on newlines and semicolons outside quotes.
 *
 * Porting notes:
 * - Preserves the original quote-aware command splitting semantics.
 */
export function Cbuf_Execute(runtime: CommandRuntime): void {
  runtime.alias_count = 0;

  while (runtime.cmd_text.cursize > 0) {
    const text = decodeAscii(runtime.cmd_text.data.subarray(0, runtime.cmd_text.cursize));
    const splitIndex = findCommandSplitIndex(text);
    const line = text.slice(0, splitIndex);
    const nextText = splitIndex >= text.length ? "" : text.slice(splitIndex + 1);

    SZ_Clear(runtime.cmd_text);
    if (nextText.length > 0) {
      SZ_Write(runtime.cmd_text, encodeAscii(nextText));
    }

    Cmd_ExecuteString(runtime, line);

    if (runtime.cmd_wait) {
      runtime.cmd_wait = false;
      break;
    }
  }
}

/**
 * Original name: Cbuf_AddEarlyCommands
 * Source: qcommon/cmd.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Scans startup argv for `+set name value` triplets and injects them early into the command buffer.
 */
export function Cbuf_AddEarlyCommands(
  runtime: CommandRuntime,
  common: CommonRuntime,
  clear: boolean
): void {
  for (let index = 0; index < COM_Argc(common); index += 1) {
    const token = COM_Argv(common, index);
    if (token !== "+set") {
      continue;
    }

    Cbuf_AddText(runtime, `set ${COM_Argv(common, index + 1)} ${COM_Argv(common, index + 2)}\n`);
    if (clear) {
      COM_ClearArgv(common, index);
      COM_ClearArgv(common, index + 1);
      COM_ClearArgv(common, index + 2);
    }

    index += 2;
  }
}

/**
 * Original name: Cbuf_AddLateCommands
 * Source: qcommon/cmd.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Scans startup argv for `+command ...` segments and appends them after initialization.
 */
export function Cbuf_AddLateCommands(runtime: CommandRuntime, common: CommonRuntime): boolean {
  let text = "";
  const argc = COM_Argc(common);

  for (let index = 1; index < argc; index += 1) {
    text += COM_Argv(common, index);
    if (index !== argc - 1) {
      text += " ";
    }
  }

  if (text.length === 0) {
    return false;
  }

  let build = "";
  for (let index = 0; index < text.length - 1; index += 1) {
    if (text[index] !== "+") {
      continue;
    }

    index += 1;
    let end = index;
    while (end < text.length && text[end] !== "+" && text[end] !== "-") {
      end += 1;
    }

    build += `${text.slice(index, end)}\n`;
    index = end - 1;
  }

  const hasLateCommands = build.length !== 0;
  if (hasLateCommands) {
    Cbuf_AddText(runtime, build);
  }

  return hasLateCommands;
}

/**
 * Original name: Cmd_Argc
 * Source: qcommon/cmd.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the number of tokens in the current command context.
 *
 * Porting notes:
 * - Reads from the explicit runtime state.
 */
export function Cmd_Argc(runtime: CommandRuntime): number {
  return runtime.cmd_argc;
}

/**
 * Original name: Cmd_Argv
 * Source: qcommon/cmd.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns one token from the current command context or an empty string when out of range.
 *
 * Porting notes:
 * - Mirrors the original null-safe empty-string fallback.
 */
export function Cmd_Argv(runtime: CommandRuntime, arg: number): string {
  if (arg < 0 || arg >= runtime.cmd_argc) {
    return "";
  }

  return runtime.cmd_argv[arg];
}

/**
 * Original name: Cmd_Args
 * Source: qcommon/cmd.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the tail of the current command line after the first token.
 *
 * Porting notes:
 * - Reads from the explicit runtime state.
 */
export function Cmd_Args(runtime: CommandRuntime): string {
  return runtime.cmd_args;
}

/**
 * Original name: Cmd_TokenizeString
 * Source: qcommon/cmd.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Tokenizes one command line into argv-style tokens.
 *
 * Porting notes:
 * - Supports optional macro expansion through an injected hook.
 */
export function Cmd_TokenizeString(runtime: CommandRuntime, text: string, macroExpand: boolean): void {
  runtime.cmd_argc = 0;
  runtime.cmd_argv = [];
  runtime.cmd_args = "";

  let workingText = macroExpand ? Cmd_MacroExpandString(runtime, text) : text;
  if (workingText === null) {
    return;
  }

  let index = 0;
  while (index < workingText.length) {
    while (index < workingText.length && workingText[index] <= " " && workingText[index] !== "\n") {
      index += 1;
    }

    if (index < workingText.length && workingText[index] === "\n") {
      index += 1;
      break;
    }

    if (index >= workingText.length) {
      return;
    }

    if (runtime.cmd_argc === 1) {
      runtime.cmd_args = workingText.slice(index).trimEnd();
    }

    const parsed = parseCommandToken(workingText, index);
    if (runtime.cmd_argc < MAX_STRING_TOKENS) {
      runtime.cmd_argv.push(parsed.token);
      runtime.cmd_argc += 1;
    }

    index = parsed.nextIndex;
  }
}

/**
 * Original name: Cmd_AddCommand
 * Source: qcommon/cmd.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Registers a named command callback.
 *
 * Porting notes:
 * - Emits through the runtime print hook instead of Com_Printf.
 */
export function Cmd_AddCommand(runtime: CommandRuntime, cmd_name: string, fn: xcommand_t | null): void {
  if (runtime.hooks.isKnownVariable?.(cmd_name) === true) {
    runtime.hooks.onPrint?.(`Cmd_AddCommand: ${cmd_name} already defined as a var\n`);
    return;
  }

  if (runtime.cmd_functions.some((cmd) => cmd.name === cmd_name)) {
    runtime.hooks.onPrint?.(`Cmd_AddCommand: ${cmd_name} already defined\n`);
    return;
  }

  runtime.cmd_functions.unshift({ name: cmd_name, fn });
}

/**
 * Original name: Cmd_RemoveCommand
 * Source: qcommon/cmd.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Removes a previously registered command.
 *
 * Porting notes:
 * - Emits through the runtime print hook instead of Com_Printf.
 */
export function Cmd_RemoveCommand(runtime: CommandRuntime, cmd_name: string): void {
  const index = runtime.cmd_functions.findIndex((cmd) => cmd.name === cmd_name);
  if (index === -1) {
    runtime.hooks.onPrint?.(`Cmd_RemoveCommand: ${cmd_name} not added\n`);
    return;
  }

  runtime.cmd_functions.splice(index, 1);
}

/**
 * Original name: Cmd_Exists
 * Source: qcommon/cmd.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns true when a named command is registered.
 *
 * Porting notes:
 * - Uses case-sensitive comparison, matching the original registration behavior.
 */
export function Cmd_Exists(runtime: CommandRuntime, cmd_name: string): boolean {
  return runtime.cmd_functions.some((cmd) => cmd.name === cmd_name);
}

/**
 * Original name: Cmd_CompleteCommand
 * Source: qcommon/cmd.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Attempts exact then partial completion against commands and aliases.
 *
 * Porting notes:
 * - Preserves command-first then alias lookup order.
 */
export function Cmd_CompleteCommand(runtime: CommandRuntime, partial: string): string | null {
  if (partial.length === 0) {
    return null;
  }

  for (const cmd of runtime.cmd_functions) {
    if (cmd.name === partial) {
      return cmd.name;
    }
  }

  for (const alias of runtime.cmd_aliases) {
    if (alias.name === partial) {
      return alias.name;
    }
  }

  for (const cmd of runtime.cmd_functions) {
    if (cmd.name.startsWith(partial)) {
      return cmd.name;
    }
  }

  for (const alias of runtime.cmd_aliases) {
    if (alias.name.startsWith(partial)) {
      return alias.name;
    }
  }

  return null;
}

/**
 * Original name: Cmd_ExecuteString
 * Source: qcommon/cmd.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Tokenizes and executes one command line through commands, aliases and fallback hooks.
 *
 * Porting notes:
 * - Leaves cvar execution and server forwarding to injected hooks for now.
 */
export function Cmd_ExecuteString(runtime: CommandRuntime, text: string): void {
  Cmd_TokenizeString(runtime, text, true);
  if (Cmd_Argc(runtime) === 0) {
    return;
  }

  const commandName = runtime.cmd_argv[0];

  for (const cmd of runtime.cmd_functions) {
    if (equalsIgnoreCase(commandName, cmd.name)) {
      if (cmd.fn === null) {
        Cmd_ExecuteString(runtime, `cmd ${text}`);
      } else {
        cmd.fn();
      }
      return;
    }
  }

  for (const alias of runtime.cmd_aliases) {
    if (equalsIgnoreCase(commandName, alias.name)) {
      runtime.alias_count += 1;
      if (runtime.alias_count === ALIAS_LOOP_COUNT) {
        runtime.hooks.onPrint?.("ALIAS_LOOP_COUNT\n");
        return;
      }

      Cbuf_InsertText(runtime, alias.value);
      return;
    }
  }

  const handled = runtime.hooks.executeUnknownCommand?.(commandName, text) ?? false;
  if (!handled) {
    Cmd_ForwardToServer(runtime);
  }
}

/**
 * Original name: Cmd_ForwardToServer
 * Source: qcommon/cmd.c / qcommon.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Forwards the current tokenized command line to the client/server transport hook.
 */
export function Cmd_ForwardToServer(runtime: CommandRuntime): void {
  const text = runtime.cmd_argc > 1 ? `${runtime.cmd_argv.join(" ")}` : Cmd_Argv(runtime, 0);
  runtime.hooks.forwardToServer?.(text);
}

/**
 * Original name: Cmd_Alias_f
 * Source: qcommon/cmd.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Registers or replaces an alias using the current command arguments.
 *
 * Porting notes:
 * - Returns a list of aliases when called without arguments instead of printing directly.
 */
export function Cmd_Alias_f(runtime: CommandRuntime): string | string[] | void {
  if (Cmd_Argc(runtime) === 1) {
    return runtime.cmd_aliases.map((alias) => `${alias.name} : ${alias.value}`);
  }

  const name = Cmd_Argv(runtime, 1);
  if (name.length >= MAX_ALIAS_NAME) {
    return "Alias name is too long";
  }

  const existing = runtime.cmd_aliases.find((alias) => alias.name === name);
  const value = buildAliasValue(runtime);

  if (existing) {
    existing.value = value;
    return;
  }

  runtime.cmd_aliases.unshift({ name, value });
}

/**
 * Original name: Cmd_Wait_f
 * Source: qcommon/cmd.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Delays further command buffer execution until the next call to Cbuf_Execute.
 *
 * Porting notes:
 * - Keeps the original one-flag behavior.
 */
export function Cmd_Wait_f(runtime: CommandRuntime): void {
  runtime.cmd_wait = true;
}

/**
 * Original name: Cmd_Init
 * Source: qcommon/cmd.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Registers the built-in command primitives from qcommon/cmd.c.
 *
 * Porting notes:
 * - Captures the runtime object in closures instead of relying on C file-static globals.
 */
export function Cmd_Init(runtime: CommandRuntime): void {
  Cmd_AddCommand(runtime, "cmdlist", () => {
    emitCommandOutput(runtime, Cmd_List_f(runtime));
  });
  Cmd_AddCommand(runtime, "exec", () => {
    emitCommandOutput(runtime, Cmd_Exec_f(runtime));
  });
  Cmd_AddCommand(runtime, "echo", () => {
    emitCommandOutput(runtime, Cmd_Echo_f(runtime));
  });
  Cmd_AddCommand(runtime, "alias", () => {
    emitCommandOutput(runtime, Cmd_Alias_f(runtime));
  });
  Cmd_AddCommand(runtime, "wait", () => {
    Cmd_Wait_f(runtime);
  });
}

/**
 * Original name: Cmd_Exec_f
 * Source: qcommon/cmd.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Loads a script file and inserts its contents at the front of the command buffer.
 *
 * Porting notes:
 * - Uses an injected text loader instead of the original FS_LoadFile API.
 */
export function Cmd_Exec_f(runtime: CommandRuntime): string | void {
  if (Cmd_Argc(runtime) !== 2) {
    return "exec <filename> : execute a script file";
  }

  const filename = Cmd_Argv(runtime, 1);
  const contents = runtime.hooks.loadTextFile?.(filename) ?? null;
  if (contents === null) {
    return `couldn't exec ${filename}`;
  }

  emitCommandOutput(runtime, `execing ${filename}`);
  Cbuf_InsertText(runtime, contents);
}

/**
 * Original name: Cmd_Echo_f
 * Source: qcommon/cmd.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Prints the remaining command arguments as one console line.
 *
 * Porting notes:
 * - Returns the formatted line instead of printing directly.
 */
export function Cmd_Echo_f(runtime: CommandRuntime): string {
  const parts: string[] = [];
  for (let index = 1; index < Cmd_Argc(runtime); index += 1) {
    parts.push(Cmd_Argv(runtime, index));
  }

  return parts.join(" ");
}

/**
 * Original name: Cmd_List_f
 * Source: qcommon/cmd.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Lists all registered commands in registration order.
 *
 * Porting notes:
 * - Returns output lines instead of printing directly.
 */
export function Cmd_List_f(runtime: CommandRuntime): string[] {
  const lines = runtime.cmd_functions.map((cmd) => cmd.name);
  lines.push(`${runtime.cmd_functions.length} commands`);
  return lines;
}

/**
 * Original name: Cmd_MacroExpandString
 * Source: qcommon/cmd.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Expands `$cvar` tokens outside quoted regions.
 * - Discards lines that exceed MAX_STRING_CHARS, loop during expansion, or have unmatched quotes.
 *
 * Porting notes:
 * - Uses the runtime macro hook in place of direct Cvar_VariableString calls.
 * - Emits C Com_Printf messages through the optional print hook.
 */
function Cmd_MacroExpandString(runtime: CommandRuntime, text: string): string | null {
  let scan = text;
  let inQuote = false;

  if (scan.length >= MAX_STRING_CHARS) {
    runtime.hooks.onPrint?.(`Line exceeded ${MAX_STRING_CHARS} chars, discarded.\n`);
    return null;
  }

  let count = 0;
  for (let index = 0; index < scan.length; index += 1) {
    if (scan[index] === "\"") {
      inQuote = !inQuote;
    }

    if (inQuote || scan[index] !== "$") {
      continue;
    }

    const parsed = COM_Parse(scan, index + 1);
    if (parsed.nextIndex === null && parsed.token.length === 0) {
      continue;
    }

    const tokenValue = runtime.hooks.expandMacroToken?.(parsed.token) ?? "";
    const nextIndex = parsed.nextIndex ?? scan.length;
    const expanded = `${scan.slice(0, index)}${tokenValue}${scan.slice(nextIndex)}`;
    if (expanded.length >= MAX_STRING_CHARS) {
      runtime.hooks.onPrint?.(`Expanded line exceeded ${MAX_STRING_CHARS} chars, discarded.\n`);
      return null;
    }

    scan = expanded;
    index -= 1;

    count += 1;
    if (count === 100) {
      runtime.hooks.onPrint?.("Macro expansion loop, discarded.\n");
      return null;
    }
  }

  if (inQuote) {
    runtime.hooks.onPrint?.("Line has unmatched quote, discarded.\n");
    return null;
  }

  return scan;
}

/**
 * Original name: N/A
 * Source: N/A (command tokenizer helper)
 * Category: New
 * Purpose: Parse one command token with basic Quake-style quoted token support.
 *
 * Constraints:
 * - Must preserve spaces inside quoted tokens.
 */
function parseCommandToken(text: string, startIndex: number): { token: string; nextIndex: number } {
  let index = startIndex;
  if (text[index] === "\"") {
    index += 1;
    let token = "";
    while (index < text.length && text[index] !== "\"") {
      token += text[index];
      index += 1;
    }
    if (index < text.length && text[index] === "\"") {
      index += 1;
    }
    return { token, nextIndex: index };
  }

  let token = "";
  while (index < text.length && text[index] > " " && text[index] !== "\n") {
    token += text[index];
    index += 1;
  }
  return { token, nextIndex: index };
}

/**
 * Original name: N/A
 * Source: N/A (command buffer splitter helper)
 * Category: New
 * Purpose: Find the next command split point while ignoring semicolons inside quoted strings.
 *
 * Constraints:
 * - Must match the original newline and semicolon split behavior.
 */
function findCommandSplitIndex(text: string): number {
  let quotes = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\"") {
      quotes += 1;
    }
    if ((quotes & 1) === 0 && text[index] === ";") {
      return index;
    }
    if (text[index] === "\n") {
      return index;
    }
  }
  return text.length;
}

/**
 * Original name: N/A
 * Source: N/A (command buffer encoding helper)
 * Category: New
 * Purpose: Convert plain text to the ASCII-style byte storage expected by Quake command buffers.
 *
 * Constraints:
 * - Must preserve low 8-bit char values.
 */
function encodeAscii(value: string): Uint8Array {
  const encoded = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    encoded[index] = value.charCodeAt(index) & 0xff;
  }
  return encoded;
}

/**
 * Original name: N/A
 * Source: N/A (command buffer decoding helper)
 * Category: New
 * Purpose: Decode Quake command buffer bytes back into a JavaScript string.
 *
 * Constraints:
 * - Must preserve low 8-bit char values.
 */
function decodeAscii(bytes: Uint8Array): string {
  let result = "";
  for (let index = 0; index < bytes.length; index += 1) {
    result += String.fromCharCode(bytes[index]);
  }
  return result;
}

/**
 * Original name: N/A
 * Source: N/A (alias assembly helper)
 * Category: New
 * Purpose: Build alias text from the current argv tail while preserving the original newline suffix.
 *
 * Constraints:
 * - Must separate argv tokens with single spaces.
 */
function buildAliasValue(runtime: CommandRuntime): string {
  const parts: string[] = [];
  for (let index = 2; index < Cmd_Argc(runtime); index += 1) {
    parts.push(Cmd_Argv(runtime, index));
  }
  return `${parts.join(" ")}\n`;
}

/**
 * Original name: N/A
 * Source: N/A (case-insensitive command comparison helper)
 * Category: New
 * Purpose: Compare command names case-insensitively in a Quake-compatible way.
 *
 * Constraints:
 * - Must not depend on locale-sensitive comparisons.
 */
function equalsIgnoreCase(left: string, right: string): boolean {
  return Q_stricmp(left, right) === 0;
}

/**
 * Original name: N/A
 * Source: N/A (command output adapter helper)
 * Category: New
 * Purpose: Forward command output values to the optional print hook in a consistent way.
 *
 * Constraints:
 * - Must ignore undefined results.
 * - Must emit array outputs line by line.
 */
function emitCommandOutput(runtime: CommandRuntime, output: string | string[] | void): void {
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
