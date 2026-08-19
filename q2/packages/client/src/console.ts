/**
 * File: console.ts
 * Source: Quake II original / client/console.c and client/console.h
 * Purpose: Port the Quake II client console state, commands and renderer-facing text snapshots.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses explicit context objects and structured draw snapshots instead of renderer globals.
 * - Routes file output, menu transitions and loading-plaque clearing through injected hooks.
 *
 * Notes:
 * - This file is the principal attachment point for `client/console.c`.
 */

import type { VirtualFilesystem } from "../../filesystem/src/index.js";
import { FS_Gamedir } from "../../filesystem/src/index.js";
import {
  Cbuf_AddText,
  Cmd_AddCommand,
  Cmd_Argc,
  Cmd_Argv,
  Cmd_Exists,
  Com_ServerState,
  Cvar_Get,
  Cvar_Set,
  Cvar_VariableValue,
  VERSION,
  type CommandRuntime,
  type CvarRuntime,
  type QcommonGlobals,
  type cvar_t,
  type qboolean
} from "../../qcommon/src/index.js";
import { MAXCMDLINE, keydest_t, type ClientKeyContext } from "./keys.js";
import { connstate_t, type ClientRuntime } from "./client.js";

/**
 * Original name: NUM_CON_TIMES
 * Source: client/console.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Keeps the same number of transparent notify timestamps as the C console.
 */
export const NUM_CON_TIMES = 4;

/**
 * Original name: CON_TEXTSIZE
 * Source: client/console.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Keeps the fixed scrollback text buffer capacity from the C `console_t`.
 */
export const CON_TEXTSIZE = 32768;

/**
 * Original name: console_t
 * Source: client/console.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Preserves the console state fields and fixed-size buffer/timestamp arrays from the C header.
 *
 * Porting notes:
 * - The C global `con` is represented through explicit `ClientConsoleContext` ownership.
 */
export interface console_t {
  initialized: qboolean;
  text: string[];
  current: number;
  x: number;
  display: number;
  ormask: number;
  linewidth: number;
  totallines: number;
  cursorspeed: number;
  vislines: number;
  times: number[];
}

/**
 * Original name: N/A
 * Source: N/A (renderer-facing console draw command)
 * Category: New
 * Purpose: Represent one `Con_DrawCharacter` glyph draw request without renderer globals.
 */
export interface ConsoleDrawCharacterCommand {
  cx: number;
  line: number;
  num: number;
}

/**
 * Original name: N/A
 * Source: N/A (renderer-facing console snapshot)
 * Category: New
 * Purpose: Represent one scrollback or notify line extracted from `console_t`.
 */
export interface ConsoleLineSnapshot {
  line: number;
  text: string;
  ageMs: number;
}

/**
 * Original name: N/A
 * Source: N/A (renderer-facing console text command)
 * Category: New
 * Purpose: Represent one console text draw command without direct `re.DrawChar` calls.
 */
export interface ConsoleTextCommand {
  x: number;
  y: number;
  text: string;
  variant: "normal" | "alt";
}

/**
 * Original name: N/A
 * Source: N/A (renderer-facing console picture command)
 * Category: New
 * Purpose: Represent the console background picture draw request as structured data.
 */
export interface ConsoleStretchPicCommand {
  x: number;
  y: number;
  width: number;
  height: number;
  pic: string;
}

/**
 * Original name: N/A
 * Source: N/A (renderer-facing console notify snapshot)
 * Category: New
 * Purpose: Group the transient notify overlay draw commands and dirty rectangle.
 */
export interface ConsoleNotifySnapshot {
  lines: ConsoleTextCommand[];
  dirty: { x1: number; y1: number; x2: number; y2: number } | null;
}

/**
 * Original name: N/A
 * Source: N/A (renderer-facing console draw snapshot)
 * Category: New
 * Purpose: Group the full console draw pass into renderer-agnostic commands.
 */
export interface ConsoleDrawConsoleSnapshot {
  lines: number;
  vislines: number;
  background: ConsoleStretchPicCommand;
  version: ConsoleTextCommand;
  rows: ConsoleTextCommand[];
  backscroll: ConsoleTextCommand | null;
  downloadBar: ConsoleTextCommand | null;
  input: ConsoleTextCommand | null;
}

/**
 * Original name: N/A
 * Source: N/A (filesystem adapter result)
 * Category: New
 * Purpose: Return `Con_Dump_f` output to callers when no filesystem hook writes it directly.
 */
export interface ConsoleDumpResult {
  path: string;
  contents: string;
}

/**
 * Original name: N/A
 * Source: N/A (runtime hook adapter)
 * Category: New
 * Purpose: Inject host actions that were direct engine calls in `client/console.c`.
 */
export interface ClientConsoleHooks {
  SCR_EndLoadingPlaque?: (runtime: ClientRuntime) => void;
  M_ForceMenuOff?: (context: ClientConsoleContext) => void;
  onCreatePath?: (path: string) => void;
  onWriteTextFile?: (path: string, contents: string) => void;
  onPrint?: (line: string) => void;
}

/**
 * Original name: N/A
 * Source: N/A (explicit runtime context)
 * Category: New
 * Purpose: Own the state and dependencies needed by the `client/console.c` port.
 */
export interface ClientConsoleContext {
  con: console_t;
  keys: ClientKeyContext;
  client: ClientRuntime;
  cmd?: CommandRuntime;
  cvar?: CvarRuntime;
  globals?: QcommonGlobals;
  filesystem?: VirtualFilesystem;
  hooks: ClientConsoleHooks;
  con_notifytime: cvar_t | null;
}

/**
 * Original name: N/A
 * Source: N/A (explicit runtime context options)
 * Category: New
 * Purpose: Provide constructor inputs for `ClientConsoleContext`.
 */
export interface ClientConsoleContextOptions {
  con?: console_t;
  keys: ClientKeyContext;
  client: ClientRuntime;
  cmd?: CommandRuntime;
  cvar?: CvarRuntime;
  globals?: QcommonGlobals;
  filesystem?: VirtualFilesystem;
  hooks?: ClientConsoleHooks;
}

/**
 * Original name: cr
 * Source: client/console.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Preserves `Con_Print` carriage-return state across calls like the C static local.
 */
let conPrintCarriageReturn = false;

/**
 * Original name: N/A
 * Source: N/A (explicit runtime context)
 * Category: New
 * Purpose: Create the composite runtime used by the `client/console.c` port.
 *
 * Constraints:
 * - Must keep console state, key state and client runtime explicitly linked.
 */
export function createClientConsoleContext(options: ClientConsoleContextOptions): ClientConsoleContext {
  const con = options.con ?? createConsoleState();

  const context: ClientConsoleContext = {
    con,
    keys: options.keys,
    client: options.client,
    ...(options.cmd ? { cmd: options.cmd } : {}),
    ...(options.cvar ? { cvar: options.cvar } : {}),
    ...(options.globals ? { globals: options.globals } : {}),
    ...(options.filesystem ? { filesystem: options.filesystem } : {}),
    hooks: options.hooks ?? {},
    con_notifytime: null
  };

  syncKeyStateFromConsole(context);
  return context;
}

/**
 * Original name: N/A
 * Source: N/A (console state factory)
 * Category: New
 * Purpose: Create a zero-initialized `console_t` state block matching the Quake II header layout.
 *
 * Constraints:
 * - Must keep the fixed-size text buffer and notify timestamps allocated up front.
 */
export function createConsoleState(): console_t {
  return {
    initialized: false,
    text: new Array<string>(CON_TEXTSIZE).fill(" "),
    current: 0,
    x: 0,
    display: 0,
    ormask: 0,
    linewidth: 0,
    totallines: 0,
    cursorspeed: 4,
    vislines: 0,
    times: new Array<number>(NUM_CON_TIMES).fill(0)
  };
}

/**
 * Original name: DrawString
 * Source: client/console.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns one renderer-agnostic console text command in normal character bank.
 */
export function DrawString(x: number, y: number, s: string): ConsoleTextCommand {
  return {
    x,
    y,
    text: s,
    variant: "normal"
  };
}

/**
 * Original name: DrawAltString
 * Source: client/console.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns one renderer-agnostic console text command in alternate/high-bit character bank.
 */
export function DrawAltString(x: number, y: number, s: string): ConsoleTextCommand {
  return {
    x,
    y,
    text: setHighBit(s),
    variant: "alt"
  };
}

/**
 * Original name: Key_ClearTyping
 * Source: client/console.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Resets the active console input line back to the bare prompt.
 */
export function Key_ClearTyping(context: ClientConsoleContext): void {
  context.keys.state.key_lines[context.keys.state.edit_line] = "]";
  context.keys.state.key_linepos = 1;
}

/**
 * Original name: Con_DrawCharacter
 * Source: client/console.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Encodes one console character draw request in pixel coordinates.
 */
export function Con_DrawCharacter(cx: number, line: number, num: number): ConsoleDrawCharacterCommand {
  return { cx, line, num };
}

/**
 * Original name: Con_CheckResize
 * Source: client/console.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Recomputes console line geometry from the viewport width and preserves the newest text rows.
 */
export function Con_CheckResize(con: console_t, viewportWidth: number): void {
  let width = (viewportWidth >> 3) - 2;

  if (width === con.linewidth) {
    return;
  }

  if (width < 1) {
    width = 38;
    con.linewidth = width;
    con.totallines = Math.floor(CON_TEXTSIZE / con.linewidth);
    con.text.fill(" ");
  } else {
    const oldwidth = con.linewidth;
    const oldtotallines = con.totallines;
    const oldText = con.text.slice();

    con.linewidth = width;
    con.totallines = Math.floor(CON_TEXTSIZE / con.linewidth);
    con.text.fill(" ");

    if (oldwidth > 0 && oldtotallines > 0) {
      let numlines = oldtotallines;
      if (con.totallines < numlines) {
        numlines = con.totallines;
      }

      let numchars = oldwidth;
      if (con.linewidth < numchars) {
        numchars = con.linewidth;
      }

      for (let i = 0; i < numlines; i += 1) {
        for (let j = 0; j < numchars; j += 1) {
          con.text[(con.totallines - 1 - i) * con.linewidth + j] =
            oldText[((con.current - i + oldtotallines) % oldtotallines) * oldwidth + j] ?? " ";
        }
      }

      Con_ClearNotify(con);
    }
  }

  con.current = con.totallines - 1;
  con.display = con.current;
}

/**
 * Original name: Con_Init
 * Source: client/console.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes the console geometry, registers console commands and resolves `con_notifytime`.
 *
 * Porting notes:
 * - Supports both the legacy header-only `console_t` form and the full `ClientConsoleContext` form.
 */
export function Con_Init(con: console_t, viewportWidth?: number): void;
export function Con_Init(context: ClientConsoleContext, viewportWidth?: number): void;
export function Con_Init(arg: console_t | ClientConsoleContext, viewportWidth = 320): void {
  if (isConsoleContext(arg)) {
    const context = arg;
    context.con.linewidth = -1;
    Con_CheckResize(context.con, viewportWidth);

    if (context.cvar) {
      context.con_notifytime = Cvar_Get(context.cvar, "con_notifytime", "3", 0);
    }

    if (context.cmd) {
      registerConsoleCommand(context.cmd, "toggleconsole", () => {
        Con_ToggleConsole_f(context);
      });
      registerConsoleCommand(context.cmd, "togglechat", () => {
        Con_ToggleChat_f(context);
      });
      registerConsoleCommand(context.cmd, "messagemode", () => {
        Con_MessageMode_f(context);
      });
      registerConsoleCommand(context.cmd, "messagemode2", () => {
        Con_MessageMode2_f(context);
      });
      registerConsoleCommand(context.cmd, "clear", () => {
        Con_Clear_f(context);
      });
      registerConsoleCommand(context.cmd, "condump", () => {
        const result = Con_Dump_f(context);
        if (typeof result === "string") {
          emitConsolePrint(context, result);
        }
      });
    }

    context.con.initialized = true;
    syncKeyStateFromConsole(context);
    emitConsolePrint(context, "Console initialized.\n");
    return;
  }

  const con = arg;
  con.linewidth = -1;
  Con_CheckResize(con, viewportWidth);
  con.initialized = true;
}

/**
 * Original name: Con_Linefeed
 * Source: client/console.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Advances the scrollback cursor by one line and clears the destination row.
 */
function Con_Linefeed(con: console_t): void {
  con.x = 0;
  if (con.display === con.current) {
    con.display += 1;
  }
  con.current += 1;

  const row = mod(con.current, con.totallines);
  for (let i = 0; i < con.linewidth; i += 1) {
    con.text[row * con.linewidth + i] = " ";
  }
}

/**
 * Original name: Con_Print
 * Source: client/console.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Appends console text while preserving word wrap, carriage returns and notify timestamps.
 *
 * Porting notes:
 * - Preserves the original function-static carriage-return state across calls.
 */
export function Con_Print(con: console_t, txt: string, realtime: number): void {
  if (!con.initialized || con.linewidth <= 0 || con.totallines <= 0) {
    return;
  }

  let index = 0;
  let mask = 0;

  if (txt[0] === "\u0001" || txt[0] === "\u0002") {
    mask = 128;
    index += 1;
  }

  while (index < txt.length) {
    const c = txt[index];

    let l = 0;
    while (l < con.linewidth && index + l < txt.length) {
      if ((txt[index + l] ?? " ") <= " ") {
        break;
      }
      l += 1;
    }

    if (l !== con.linewidth && (con.x + l > con.linewidth)) {
      con.x = 0;
    }

    index += 1;

    if (conPrintCarriageReturn) {
      con.current -= 1;
      conPrintCarriageReturn = false;
    }

    if (con.x === 0) {
      Con_Linefeed(con);
      if (con.current >= 0) {
        con.times[con.current % NUM_CON_TIMES] = realtime;
      }
    }

    switch (c) {
      case "\n":
        con.x = 0;
        break;
      case "\r":
        con.x = 0;
        conPrintCarriageReturn = true;
        break;
      default: {
        const y = mod(con.current, con.totallines);
        con.text[y * con.linewidth + con.x] = String.fromCharCode(c.charCodeAt(0) | mask | con.ormask);
        con.x += 1;
        if (con.x >= con.linewidth) {
          con.x = 0;
        }
        break;
      }
    }
  }
}

/**
 * Original name: Con_CenteredPrint
 * Source: client/console.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Prints one console line centered within the current line width.
 */
export function Con_CenteredPrint(con: console_t, text: string, realtime: number): void {
  let l = text.length;
  l = Math.trunc((con.linewidth - l) / 2);
  if (l < 0) {
    l = 0;
  }

  const buffer = `${" ".repeat(l)}${text}\n`;
  Con_Print(con, buffer, realtime);
}

/**
 * Original name: Con_Clear_f
 * Source: client/console.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Clears the full console text buffer to spaces.
 */
export function Con_Clear_f(con: console_t): void;
export function Con_Clear_f(context: ClientConsoleContext): void;
export function Con_Clear_f(arg: console_t | ClientConsoleContext): void {
  const con = isConsoleContext(arg) ? arg.con : arg;
  con.text.fill(" ");
}

/**
 * Original name: Con_Dump_f
 * Source: client/console.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Serializes the visible console scrollback to a text file path inside the current gamedir.
 *
 * Porting notes:
 * - Emits file output through hooks instead of writing directly to the host filesystem.
 */
export function Con_Dump_f(context: ClientConsoleContext): ConsoleDumpResult | string | void {
  if (!context.cmd) {
    return;
  }

  if (Cmd_Argc(context.cmd) !== 2) {
    return "usage: condump <filename>\n";
  }

  const gamedir = context.filesystem ? FS_Gamedir(context.filesystem) : "baseq2";
  const path = `${gamedir}/${Cmd_Argv(context.cmd, 1)}.txt`;
  const contents = buildConsoleDump(context.con);

  emitConsolePrint(context, `Dumped console text to ${path}.\n`);

  if (context.hooks.onWriteTextFile) {
    context.hooks.onCreatePath?.(path);
    context.hooks.onWriteTextFile(path, contents);
    return;
  }

  return {
    path,
    contents
  };
}

/**
 * Original name: Con_ClearNotify
 * Source: client/console.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Clears the notify-line timestamps.
 */
export function Con_ClearNotify(con: console_t): void {
  con.times.fill(0);
}

/**
 * Original name: Con_MessageMode_f
 * Source: client/console.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Switches the client key destination into chat message mode.
 */
export function Con_MessageMode_f(context: ClientConsoleContext): void {
  context.keys.state.chat_team = false;
  context.keys.state.key_dest = keydest_t.key_message;
  context.keys.state.console_open = false;
}

/**
 * Original name: Con_MessageMode2_f
 * Source: client/console.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Switches the client key destination into team-chat message mode.
 */
export function Con_MessageMode2_f(context: ClientConsoleContext): void {
  context.keys.state.chat_team = true;
  context.keys.state.key_dest = keydest_t.key_message;
  context.keys.state.console_open = false;
}

/**
 * Original name: Con_ToggleConsole_f
 * Source: client/console.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Toggles console mode while preserving attract-loop, disconnected-demo and single-player pause behavior.
 *
 * Porting notes:
 * - Keeps the old boolean helper form used by earlier header-only verification.
 */
export function Con_ToggleConsole_f(isOpen: boolean): boolean;
export function Con_ToggleConsole_f(context: ClientConsoleContext): void;
export function Con_ToggleConsole_f(arg: boolean | ClientConsoleContext): boolean | void {
  if (typeof arg === "boolean") {
    return !arg;
  }

  const context = arg;
  context.hooks.SCR_EndLoadingPlaque?.(context.client);

  if (context.client.cl.attractloop) {
    if (context.cmd) {
      Cbuf_AddText(context.cmd, "killserver\n");
    }
    return;
  }

  if (context.client.cls.state === connstate_t.ca_disconnected) {
    if (context.cmd) {
      Cbuf_AddText(context.cmd, "d1\n");
    }
    return;
  }

  Key_ClearTyping(context);
  Con_ClearNotify(context.con);

  if (context.keys.state.key_dest === keydest_t.key_console) {
    forceMenuOff(context);
    if (context.cvar) {
      Cvar_Set(context.cvar, "paused", "0");
    }
    context.keys.state.key_dest = keydest_t.key_game;
    context.keys.state.console_open = false;
  } else {
    forceMenuOff(context);
    context.keys.state.key_dest = keydest_t.key_console;
    context.keys.state.console_open = true;

    if (context.cvar
      && Cvar_VariableValue(context.cvar, "maxclients") === 1
      && context.globals
      && Com_ServerState(context.globals) !== 0) {
      Cvar_Set(context.cvar, "paused", "1");
    }
  }
}

/**
 * Original name: Con_ToggleChat_f
 * Source: client/console.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Toggles between console and active gameplay while clearing typing and notify timestamps.
 */
export function Con_ToggleChat_f(context: ClientConsoleContext): void {
  Key_ClearTyping(context);

  if (context.keys.state.key_dest === keydest_t.key_console) {
    if (context.client.cls.state === connstate_t.ca_active) {
      forceMenuOff(context);
      context.keys.state.key_dest = keydest_t.key_game;
      context.keys.state.console_open = false;
    }
  } else {
    context.keys.state.key_dest = keydest_t.key_console;
    context.keys.state.console_open = true;
  }

  Con_ClearNotify(context.con);
}

/**
 * Original name: Con_DrawInput
 * Source: client/console.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Builds the currently visible console input line, including cursor blinking and horizontal scrolling.
 */
export function Con_DrawInput(context: ClientConsoleContext): ConsoleTextCommand | null {
  if (context.keys.state.key_dest === keydest_t.key_menu) {
    return null;
  }

  if (context.keys.state.key_dest !== keydest_t.key_console && context.client.cls.state === connstate_t.ca_active) {
    return null;
  }

  const con = context.con;
  if (con.linewidth <= 0) {
    return null;
  }

  const rawText = context.keys.state.key_lines[context.keys.state.edit_line] ?? "]";
  const cursor = String.fromCharCode(10 + ((Math.trunc(context.client.cls.realtime) >> 8) & 1));
  let displayText = `${rawText.slice(0, context.keys.state.key_linepos)}${cursor}`;

  if (displayText.length < con.linewidth) {
    displayText = displayText.padEnd(con.linewidth, " ");
  }

  if (context.keys.state.key_linepos >= con.linewidth) {
    displayText = displayText.slice(1 + context.keys.state.key_linepos - con.linewidth);
  } else {
    displayText = displayText.slice(0, con.linewidth);
  }

  return {
    x: 8,
    y: con.vislines - 22,
    text: displayText,
    variant: "normal"
  };
}

/**
 * Original name: Con_DrawNotify
 * Source: client/console.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns the recent notify lines that are still inside the configured timeout window.
 *
 * Porting notes:
 * - Supports the earlier header-only snapshot form and the full interactive `console.c` overlay form.
 */
export function Con_DrawNotify(con: console_t, realtime: number, notifyTimeMs: number): ConsoleLineSnapshot[];
export function Con_DrawNotify(context: ClientConsoleContext, viewportWidth: number): ConsoleNotifySnapshot;
export function Con_DrawNotify(
  arg: console_t | ClientConsoleContext,
  realtimeOrViewportWidth: number,
  notifyTimeMs?: number
): ConsoleLineSnapshot[] | ConsoleNotifySnapshot {
  if (!isConsoleContext(arg)) {
    const con = arg;
    const realtime = realtimeOrViewportWidth;
    const snapshots: ConsoleLineSnapshot[] = [];

    for (let i = con.current - NUM_CON_TIMES + 1; i <= con.current; i += 1) {
      if (i < 0) {
        continue;
      }

      const generatedAt = con.times[i % NUM_CON_TIMES] ?? 0;
      if (generatedAt === 0) {
        continue;
      }

      const ageMs = realtime - generatedAt;
      if (ageMs > (notifyTimeMs ?? 0)) {
        continue;
      }

      snapshots.push({
        line: i,
        text: readConsoleLine(con, i, true),
        ageMs
      });
    }

    return snapshots;
  }

  const context = arg;
  const viewportWidth = realtimeOrViewportWidth;
  const con = context.con;
  const effectiveDisplay = getEffectiveDisplay(context);
  const notifyWindowMs = (context.con_notifytime?.value ?? 3) * 1000;
  const lines: ConsoleTextCommand[] = [];

  for (let i = getEffectiveCurrent(context) - NUM_CON_TIMES + 1; i <= getEffectiveCurrent(context); i += 1) {
    if (i < 0) {
      continue;
    }

    const generatedAt = con.times[i % NUM_CON_TIMES] ?? 0;
    if (generatedAt === 0) {
      continue;
    }

    const ageMs = context.client.cls.realtime - generatedAt;
    if (ageMs > notifyWindowMs) {
      continue;
    }

    lines.push({
      x: 8,
      y: lines.length * 8,
      text: readConsoleLine(con, i, false),
      variant: "normal"
    });
  }

  if (context.keys.state.key_dest === keydest_t.key_message) {
    const prefix = context.keys.state.chat_team ? "say_team:" : "say:";
    const skip = context.keys.state.chat_team ? 11 : 5;
    let chatText = context.keys.state.chat_buffer;
    const maxVisible = Math.max(0, (viewportWidth >> 3) - (skip + 1));

    if (context.keys.state.chat_bufferlen > maxVisible) {
      chatText = chatText.slice(context.keys.state.chat_bufferlen - maxVisible);
    }

    const cursor = String.fromCharCode(10 + ((Math.trunc(context.client.cls.realtime) >> 8) & 1));
    lines.push({
      x: 8,
      y: lines.length * 8,
      text: `${prefix}${chatText}${cursor}`,
      variant: "normal"
    });
  }

  const dirtyHeight = lines.length * 8;
  return {
    lines,
    dirty: dirtyHeight > 0
      ? {
          x1: 0,
          y1: 0,
          x2: viewportWidth - 1,
          y2: dirtyHeight
        }
      : null
  };
}

/**
 * Original name: Con_DrawConsole
 * Source: client/console.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns the currently visible console lines for one solid console draw pass.
 *
 * Porting notes:
 * - Supports the earlier header-only line snapshot form and the full renderer-facing `console.c` draw snapshot.
 */
export function Con_DrawConsole(con: console_t, frac: number, realtime: number): ConsoleLineSnapshot[];
export function Con_DrawConsole(
  context: ClientConsoleContext,
  frac: number,
  viewportWidth: number,
  viewportHeight: number
): ConsoleDrawConsoleSnapshot | null;
export function Con_DrawConsole(
  arg: console_t | ClientConsoleContext,
  frac: number,
  realtimeOrViewportWidth: number,
  viewportHeight?: number
): ConsoleLineSnapshot[] | ConsoleDrawConsoleSnapshot | null {
  if (!isConsoleContext(arg)) {
    const con = arg;
    const realtime = realtimeOrViewportWidth;
    const lines = Math.max(0, Math.trunc(con.vislines * frac));
    if (lines <= 0 || con.linewidth <= 0 || con.totallines <= 0) {
      return [];
    }

    const rows = Math.max(0, (lines - 8) >> 3);
    const snapshots: ConsoleLineSnapshot[] = [];

    for (let row = con.display; row >= 0 && snapshots.length < rows; row -= 1) {
      snapshots.push({
        line: row,
        text: readConsoleLine(con, row, true),
        ageMs: realtime - (con.times[row % NUM_CON_TIMES] ?? 0)
      });
    }

    return snapshots.reverse();
  }

  const context = arg;
  const viewportWidth = realtimeOrViewportWidth;
  const height = viewportHeight ?? 0;
  const con = context.con;

  let lines = Math.trunc(height * frac);
  if (lines <= 0) {
    return null;
  }

  if (lines > height) {
    lines = height;
  }

  con.vislines = lines;
  context.keys.state.con_current = con.current;
  context.keys.state.con_totallines = con.totallines;
  con.display = context.keys.state.con_display;

  const rowsToDraw = Math.max(0, (lines - 22) >> 3);
  let y = lines - 30;
  const rows: ConsoleTextCommand[] = [];
  const current = getEffectiveCurrent(context);
  const display = getEffectiveDisplay(context);

  let backscroll: ConsoleTextCommand | null = null;
  let remainingRows = rowsToDraw;

  if (display !== current) {
    backscroll = {
      x: 8,
      y,
      text: buildBackscrollRow(con.linewidth),
      variant: "normal"
    };
    y -= 8;
    remainingRows -= 1;
  }

  let row = display;
  for (let i = 0; i < remainingRows; i += 1, y -= 8, row -= 1) {
    if (row < 0) {
      break;
    }
    if (current - row >= con.totallines) {
      break;
    }

    rows.push({
      x: 8,
      y,
      text: readConsoleLine(con, row, false),
      variant: "normal"
    });
  }

  const downloadBar = buildDownloadBar(context);

  return {
    lines,
    vislines: con.vislines,
    background: {
      x: 0,
      y: -height + lines,
      width: viewportWidth,
      height,
      pic: "conback"
    },
    version: {
      x: viewportWidth - 44,
      y: lines - 12,
      text: setHighBit(`v${VERSION.toFixed(2).padStart(4, " ")}`),
      variant: "alt"
    },
    rows,
    backscroll,
    downloadBar,
    input: Con_DrawInput(context)
  };
}

/**
 * Original name: N/A
 * Source: N/A (console/key state sync helper)
 * Category: New
 * Purpose: Keep the key-state console mirrors synchronized with the primary console state.
 *
 * Constraints:
 * - Must preserve the original duplicated `con_current` / `con_display` bookkeeping used by `keys.c`.
 */
export function Con_SyncConsoleToKeys(context: ClientConsoleContext): void {
  syncKeyStateFromConsole(context);
}

/**
 * Original name: N/A
 * Source: N/A (console/key state sync helper)
 * Category: New
 * Purpose: Re-apply the key-state scrollback position onto the primary console state before drawing.
 *
 * Constraints:
 * - Must not alter `con.current`, only the backscroll-visible `display` line.
 */
export function Con_SyncKeysToConsole(context: ClientConsoleContext): void {
  context.con.display = context.keys.state.con_display;
}

/**
 * Original name: N/A
 * Source: N/A (local console dump helper)
 * Category: New
 * Purpose: Serialize console scrollback into the plain-text body consumed by `Con_Dump_f`.
 */
function buildConsoleDump(con: console_t): string {
  if (con.linewidth <= 0 || con.totallines <= 0) {
    return "";
  }

  let firstLine = con.current - con.totallines + 1;
  for (; firstLine <= con.current; firstLine += 1) {
    const line = readConsoleLine(con, firstLine, false);
    if (line.trimEnd().length !== 0) {
      break;
    }
  }

  const lines: string[] = [];
  for (let lineIndex = firstLine; lineIndex <= con.current; lineIndex += 1) {
    let line = readConsoleLine(con, lineIndex, false).replace(/\s+$/u, "");
    line = stripHighBit(line);
    lines.push(line);
  }

  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

/**
 * Original name: N/A
 * Source: N/A (local console draw helper)
 * Category: New
 * Purpose: Build the renderer-neutral download progress row used by `Con_DrawConsole`.
 */
function buildDownloadBar(context: ClientConsoleContext): ConsoleTextCommand | null {
  if (!context.client.cls.downloadname || context.client.cls.downloadpercent < 0) {
    return null;
  }

  const con = context.con;
  let text = context.client.cls.downloadname;
  const slash = text.lastIndexOf("/");
  if (slash >= 0) {
    text = text.slice(slash + 1);
  }

  const x = con.linewidth - Math.trunc((con.linewidth * 7) / 40);
  let y = x - text.length - 8;
  const maxName = Math.trunc(con.linewidth / 3);
  let dlbar = "";

  if (text.length > maxName) {
    y = x - maxName - 11;
    dlbar = `${text.slice(0, maxName)}...`;
  } else {
    dlbar = text;
  }

  dlbar += ": ";
  dlbar += String.fromCharCode(0x80);

  let n = 0;
  if (context.client.cls.downloadpercent !== 0) {
    n = Math.trunc(y * context.client.cls.downloadpercent / 100);
  }

  for (let j = 0; j < y; j += 1) {
    dlbar += String.fromCharCode(j === n ? 0x83 : 0x81);
  }

  dlbar += String.fromCharCode(0x82);
  dlbar += ` ${`${context.client.cls.downloadpercent}`.padStart(2, "0")}%`;

  return {
    x: 8,
    y: con.vislines - 12,
    text: dlbar,
    variant: "normal"
  };
}

/**
 * Original name: N/A
 * Source: N/A (local console draw helper)
 * Category: New
 * Purpose: Build the Quake II backscroll marker row used by `Con_DrawConsole`.
 */
function buildBackscrollRow(linewidth: number): string {
  const chars = new Array<string>(linewidth).fill(" ");
  for (let x = 0; x < linewidth; x += 4) {
    chars[x] = "^";
  }
  return chars.join("");
}

/**
 * Original name: N/A
 * Source: N/A (menu hook adapter)
 * Category: New
 * Purpose: Route the original `M_ForceMenuOff` side effect through the explicit console hooks.
 */
function forceMenuOff(context: ClientConsoleContext): void {
  if (context.hooks.M_ForceMenuOff) {
    context.hooks.M_ForceMenuOff(context);
    return;
  }

  context.keys.state.key_dest = keydest_t.key_game;
  context.keys.state.console_open = false;
}

/**
 * Original name: N/A
 * Source: N/A (console/key state sync helper)
 * Category: New
 * Purpose: Mirror primary console scroll state into the key subsystem compatibility fields.
 */
function syncKeyStateFromConsole(context: ClientConsoleContext): void {
  context.keys.state.con_current = context.con.current;
  context.keys.state.con_display = context.con.display;
  context.keys.state.con_totallines = context.con.totallines;
}

/**
 * Original name: N/A
 * Source: N/A (console/key state sync helper)
 * Category: New
 * Purpose: Read the current console row from the key-state mirror used by scrollback controls.
 */
function getEffectiveCurrent(context: ClientConsoleContext): number {
  return context.keys.state.con_current;
}

/**
 * Original name: N/A
 * Source: N/A (console/key state sync helper)
 * Category: New
 * Purpose: Read the displayed console row from the key-state mirror used by scrollback controls.
 */
function getEffectiveDisplay(context: ClientConsoleContext): number {
  return context.keys.state.con_display;
}

/**
 * Original name: N/A
 * Source: N/A (local console text helper)
 * Category: New
 * Purpose: Read one wrapped console text-buffer row without exposing buffer indexing to draw code.
 */
function readConsoleLine(con: console_t, line: number, trimEnd: boolean): string {
  const row = mod(line, con.totallines);
  const start = row * con.linewidth;
  const text = con.text.slice(start, start + con.linewidth).join("");
  return trimEnd ? text.replace(/\s+$/u, "") : text;
}

/**
 * Original name: N/A
 * Source: N/A (command registration adapter)
 * Category: New
 * Purpose: Register a console command only when the shared command runtime does not already own it.
 */
function registerConsoleCommand(runtime: CommandRuntime, name: string, handler: () => void): void {
  if (!Cmd_Exists(runtime, name)) {
    Cmd_AddCommand(runtime, name, handler);
  }
}

/**
 * Original name: N/A
 * Source: N/A (runtime hook adapter)
 * Category: New
 * Purpose: Route console status messages through the injected host print hook.
 */
function emitConsolePrint(context: ClientConsoleContext, line: string): void {
  context.hooks.onPrint?.(line);
}

/**
 * Original name: N/A
 * Source: N/A (local console text helper)
 * Category: New
 * Purpose: Apply Quake II's alternate console character-bank bit to a JavaScript string.
 */
function setHighBit(text: string): string {
  let result = "";
  for (const char of text) {
    result += String.fromCharCode(char.charCodeAt(0) | 0x80);
  }
  return result;
}

/**
 * Original name: N/A
 * Source: N/A (local console text helper)
 * Category: New
 * Purpose: Remove Quake II's alternate console character-bank bit before plain-text output.
 */
function stripHighBit(text: string): string {
  let result = "";
  for (const char of text) {
    result += String.fromCharCode(char.charCodeAt(0) & 0x7f);
  }
  return result;
}

/**
 * Original name: N/A
 * Source: N/A (local arithmetic helper)
 * Category: New
 * Purpose: Preserve positive modulo semantics for wrapped console buffer indices.
 */
function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

/**
 * Original name: N/A
 * Source: N/A (local overload discriminator)
 * Category: New
 * Purpose: Distinguish legacy `console_t` overload calls from full runtime context calls.
 */
function isConsoleContext(value: console_t | ClientConsoleContext): value is ClientConsoleContext {
  return "con" in value && "keys" in value && "client" in value;
}
