/**
 * File: keys.ts
 * Source: Quake II original / client/keys.c and client/keys.h
 * Purpose: Port the Quake II client key system, including bindings, console line editing and key dispatch.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses explicit context objects instead of file-static globals.
 * - Keeps platform and UI side effects behind hooks or injected runtimes.
 * - Represents fixed C char buffers as bounded JavaScript strings.
 *
 * Notes:
 * - This file is the principal attachment point for `client/keys.c`.
 */

import {
  Cbuf_AddText,
  Cmd_AddCommand,
  Cmd_Argc,
  Cmd_Argv,
  Cmd_CompleteCommand,
  Cmd_Exists,
  Cvar_CompleteVariable,
  STAT_LAYOUTS,
  Sys_GetClipboardData,
  Sys_SendKeyEvents,
  type CommandRuntime,
  type CvarRuntime,
  type QcommonHostRuntime,
  type qboolean
} from "../../qcommon/src/index.js";
import { connstate_t, type ClientRuntime } from "./client.js";

/**
 * Original name: N/A
 * Source: N/A (typed key array bound)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose:
 * - Names the original fixed `keybindings[256]` / key state array size for TS
 *   allocation and bounds checks.
 */
export const KEY_ARRAY_SIZE = 256;
/**
 * Original name: MAXCMDLINE
 * Source: client/keys.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Caps editable console and chat command lines at the original fixed C buffer size.
 */
export const MAXCMDLINE = 256;
/**
 * Original name: N/A
 * Source: N/A (typed console history bound)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose:
 * - Names the original `key_lines[32]` history ring size for TS allocation.
 */
export const KEY_LINE_COUNT = 32;

/**
 * Original name: K_* key code macros
 * Source: client/keys.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Preserve Quake II virtual key numbers passed to `Key_Event`, including
 *   keypad, mouse, joystick, aux, wheel and pause codes.
 */
export const K_TAB = 9;
export const K_ENTER = 13;
export const K_ESCAPE = 27;
export const K_SPACE = 32;
export const K_BACKSPACE = 127;
export const K_UPARROW = 128;
export const K_DOWNARROW = 129;
export const K_LEFTARROW = 130;
export const K_RIGHTARROW = 131;
export const K_ALT = 132;
export const K_CTRL = 133;
export const K_SHIFT = 134;
export const K_F1 = 135;
export const K_F2 = 136;
export const K_F3 = 137;
export const K_F4 = 138;
export const K_F5 = 139;
export const K_F6 = 140;
export const K_F7 = 141;
export const K_F8 = 142;
export const K_F9 = 143;
export const K_F10 = 144;
export const K_F11 = 145;
export const K_F12 = 146;
export const K_INS = 147;
export const K_DEL = 148;
export const K_PGDN = 149;
export const K_PGUP = 150;
export const K_HOME = 151;
export const K_END = 152;
export const K_KP_HOME = 160;
export const K_KP_UPARROW = 161;
export const K_KP_PGUP = 162;
export const K_KP_LEFTARROW = 163;
export const K_KP_5 = 164;
export const K_KP_RIGHTARROW = 165;
export const K_KP_END = 166;
export const K_KP_DOWNARROW = 167;
export const K_KP_PGDN = 168;
export const K_KP_ENTER = 169;
export const K_KP_INS = 170;
export const K_KP_DEL = 171;
export const K_KP_SLASH = 172;
export const K_KP_MINUS = 173;
export const K_KP_PLUS = 174;
export const K_MOUSE1 = 200;
export const K_MOUSE2 = 201;
export const K_MOUSE3 = 202;
export const K_JOY1 = 203;
export const K_JOY2 = 204;
export const K_JOY3 = 205;
export const K_JOY4 = 206;
export const K_AUX1 = 207;
export const K_AUX2 = 208;
export const K_AUX3 = 209;
export const K_AUX4 = 210;
export const K_AUX5 = 211;
export const K_AUX6 = 212;
export const K_AUX7 = 213;
export const K_AUX8 = 214;
export const K_AUX9 = 215;
export const K_AUX10 = 216;
export const K_AUX11 = 217;
export const K_AUX12 = 218;
export const K_AUX13 = 219;
export const K_AUX14 = 220;
export const K_AUX15 = 221;
export const K_AUX16 = 222;
export const K_AUX17 = 223;
export const K_AUX18 = 224;
export const K_AUX19 = 225;
export const K_AUX20 = 226;
export const K_AUX21 = 227;
export const K_AUX22 = 228;
export const K_AUX23 = 229;
export const K_AUX24 = 230;
export const K_AUX25 = 231;
export const K_AUX26 = 232;
export const K_AUX27 = 233;
export const K_AUX28 = 234;
export const K_AUX29 = 235;
export const K_AUX30 = 236;
export const K_AUX31 = 237;
export const K_AUX32 = 238;
export const K_MWHEELDOWN = 239;
export const K_MWHEELUP = 240;
export const K_PAUSE = 255;

/**
 * Original name: keydest_t
 * Source: client/client.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Selects which keyboard consumer receives input: game, console, chat message or menu.
 *
 * Porting notes:
 * - Kept in `keys.ts` because the TypeScript port owns keyboard state with the `keys.c` cluster.
 */
export enum keydest_t {
  key_game,
  key_console,
  key_message,
  key_menu
}

/**
 * Original name: keyname_t
 * Source: client/keys.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Maps a textual key name to the integer key code used by keybindings[].
 */
export interface keyname_t {
  name: string;
  keynum: number;
}

/**
 * Original name: key_lines, key_linepos, shift_down, anykeydown, edit_line,
 * history_line, key_waiting, keybindings, consolekeys, menubound, keyshift,
 * key_repeats, keydown, chat_team, chat_buffer, chat_bufferlen
 * Source: client/keys.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Holds the mutable keyboard, console-editing, chat and binding state from the
 *   original file-static globals.
 *
 * Porting notes:
 * - Uses an explicit context object instead of module globals so web runtimes and
 *   tests can host isolated key systems.
 */
export interface client_key_state_t {
  keybindings: Array<string | null>;
  key_repeats: Int32Array;
  anykeydown: number;
  chat_buffer: string;
  chat_bufferlen: number;
  chat_team: qboolean;
  key_lines: string[];
  key_linepos: number;
  shift_down: qboolean;
  edit_line: number;
  history_line: number;
  key_waiting: number;
  consolekeys: boolean[];
  menubound: boolean[];
  keyshift: Int32Array;
  keydown: boolean[];
  key_dest: keydest_t;
  console_open: qboolean;
  con_display: number;
  con_current: number;
  con_totallines: number;
}

/**
 * Original name: N/A
 * Source: N/A (binding writer adapter)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose:
 * - Provides the host-neutral write target used by `Key_WriteBindings`.
 */
export interface KeyBindingWriter {
  write: (chunk: string) => void;
}

/**
 * Original name: N/A
 * Source: N/A (runtime hooks)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose:
 * - Injects command, UI, clipboard and menu side effects that were global C
 *   calls in `keys.c`, keeping the key port testable and host-neutral.
 */
export interface ClientKeyHooks {
  onPrint?: (line: string) => void;
  onError?: (message: string) => never;
  onUpdateScreen?: () => void;
  onMenuKeydown?: (key: number) => void;
  onMenuMain?: () => void;
  onToggleConsole?: (context: ClientKeyContext) => void;
  onCompleteCommand?: (partial: string) => string | null;
  onCompleteVariable?: (partial: string) => string | null;
  onAddText?: (text: string) => void;
  onGetClipboardData?: () => string | null;
  onWaitForKey?: () => number;
  onInit?: () => void;
  onKeyEvent?: (key: number, down: qboolean, time: number) => void;
  onSetBinding?: (keynum: number, binding: string) => void;
  onClearStates?: () => void;
  onGetKey?: () => number;
}

/**
 * Original name: N/A
 * Source: N/A (explicit key runtime context)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose:
 * - Carries the ported key state plus injected runtimes that replace C file
 *   globals and direct engine calls.
 */
export interface ClientKeyContext {
  state: client_key_state_t;
  hooks: ClientKeyHooks;
  cmd?: CommandRuntime;
  cvar?: CvarRuntime;
  host?: QcommonHostRuntime;
  client?: ClientRuntime;
}

/**
 * Original name: N/A
 * Source: N/A (context construction options)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose:
 * - Allows callers to create an isolated `ClientKeyContext` with only the
 *   runtimes and hooks available in that host.
 */
export interface ClientKeyContextOptions {
  hooks?: ClientKeyHooks;
  cmd?: CommandRuntime;
  cvar?: CvarRuntime;
  host?: QcommonHostRuntime;
  client?: ClientRuntime;
}

/**
 * Original name: keynames
 * Source: client/keys.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Provides the original named-key lookup table, including the SEMICOLON alias.
 */
export const keynames: keyname_t[] = [
  { name: "TAB", keynum: K_TAB },
  { name: "ENTER", keynum: K_ENTER },
  { name: "ESCAPE", keynum: K_ESCAPE },
  { name: "SPACE", keynum: K_SPACE },
  { name: "BACKSPACE", keynum: K_BACKSPACE },
  { name: "UPARROW", keynum: K_UPARROW },
  { name: "DOWNARROW", keynum: K_DOWNARROW },
  { name: "LEFTARROW", keynum: K_LEFTARROW },
  { name: "RIGHTARROW", keynum: K_RIGHTARROW },
  { name: "ALT", keynum: K_ALT },
  { name: "CTRL", keynum: K_CTRL },
  { name: "SHIFT", keynum: K_SHIFT },
  { name: "F1", keynum: K_F1 },
  { name: "F2", keynum: K_F2 },
  { name: "F3", keynum: K_F3 },
  { name: "F4", keynum: K_F4 },
  { name: "F5", keynum: K_F5 },
  { name: "F6", keynum: K_F6 },
  { name: "F7", keynum: K_F7 },
  { name: "F8", keynum: K_F8 },
  { name: "F9", keynum: K_F9 },
  { name: "F10", keynum: K_F10 },
  { name: "F11", keynum: K_F11 },
  { name: "F12", keynum: K_F12 },
  { name: "INS", keynum: K_INS },
  { name: "DEL", keynum: K_DEL },
  { name: "PGDN", keynum: K_PGDN },
  { name: "PGUP", keynum: K_PGUP },
  { name: "HOME", keynum: K_HOME },
  { name: "END", keynum: K_END },
  { name: "MOUSE1", keynum: K_MOUSE1 },
  { name: "MOUSE2", keynum: K_MOUSE2 },
  { name: "MOUSE3", keynum: K_MOUSE3 },
  { name: "JOY1", keynum: K_JOY1 },
  { name: "JOY2", keynum: K_JOY2 },
  { name: "JOY3", keynum: K_JOY3 },
  { name: "JOY4", keynum: K_JOY4 },
  { name: "AUX1", keynum: K_AUX1 },
  { name: "AUX2", keynum: K_AUX2 },
  { name: "AUX3", keynum: K_AUX3 },
  { name: "AUX4", keynum: K_AUX4 },
  { name: "AUX5", keynum: K_AUX5 },
  { name: "AUX6", keynum: K_AUX6 },
  { name: "AUX7", keynum: K_AUX7 },
  { name: "AUX8", keynum: K_AUX8 },
  { name: "AUX9", keynum: K_AUX9 },
  { name: "AUX10", keynum: K_AUX10 },
  { name: "AUX11", keynum: K_AUX11 },
  { name: "AUX12", keynum: K_AUX12 },
  { name: "AUX13", keynum: K_AUX13 },
  { name: "AUX14", keynum: K_AUX14 },
  { name: "AUX15", keynum: K_AUX15 },
  { name: "AUX16", keynum: K_AUX16 },
  { name: "AUX17", keynum: K_AUX17 },
  { name: "AUX18", keynum: K_AUX18 },
  { name: "AUX19", keynum: K_AUX19 },
  { name: "AUX20", keynum: K_AUX20 },
  { name: "AUX21", keynum: K_AUX21 },
  { name: "AUX22", keynum: K_AUX22 },
  { name: "AUX23", keynum: K_AUX23 },
  { name: "AUX24", keynum: K_AUX24 },
  { name: "AUX25", keynum: K_AUX25 },
  { name: "AUX26", keynum: K_AUX26 },
  { name: "AUX27", keynum: K_AUX27 },
  { name: "AUX28", keynum: K_AUX28 },
  { name: "AUX29", keynum: K_AUX29 },
  { name: "AUX30", keynum: K_AUX30 },
  { name: "AUX31", keynum: K_AUX31 },
  { name: "AUX32", keynum: K_AUX32 },
  { name: "KP_HOME", keynum: K_KP_HOME },
  { name: "KP_UPARROW", keynum: K_KP_UPARROW },
  { name: "KP_PGUP", keynum: K_KP_PGUP },
  { name: "KP_LEFTARROW", keynum: K_KP_LEFTARROW },
  { name: "KP_5", keynum: K_KP_5 },
  { name: "KP_RIGHTARROW", keynum: K_KP_RIGHTARROW },
  { name: "KP_END", keynum: K_KP_END },
  { name: "KP_DOWNARROW", keynum: K_KP_DOWNARROW },
  { name: "KP_PGDN", keynum: K_KP_PGDN },
  { name: "KP_ENTER", keynum: K_KP_ENTER },
  { name: "KP_INS", keynum: K_KP_INS },
  { name: "KP_DEL", keynum: K_KP_DEL },
  { name: "KP_SLASH", keynum: K_KP_SLASH },
  { name: "KP_MINUS", keynum: K_KP_MINUS },
  { name: "KP_PLUS", keynum: K_KP_PLUS },
  { name: "MWHEELUP", keynum: K_MWHEELUP },
  { name: "MWHEELDOWN", keynum: K_MWHEELDOWN },
  { name: "PAUSE", keynum: K_PAUSE },
  { name: "SEMICOLON", keynum: ";".charCodeAt(0) }
];

/**
 * Original name: N/A
 * Source: N/A (context factory)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose:
 * - Allocates the explicit TypeScript key context that replaces file-static
 *   globals from `keys.c` and the related declarations in `keys.h`.
 */
export function createClientKeyContext(optionsOrHooks: ClientKeyContextOptions | ClientKeyHooks = {}): ClientKeyContext {
  const options = normalizeContextOptions(optionsOrHooks);

  return {
    state: {
      keybindings: new Array<string | null>(KEY_ARRAY_SIZE).fill(null),
      key_repeats: new Int32Array(KEY_ARRAY_SIZE),
      anykeydown: 0,
      chat_buffer: "",
      chat_bufferlen: 0,
      chat_team: false,
      key_lines: Array.from({ length: KEY_LINE_COUNT }, () => "]"),
      key_linepos: 1,
      shift_down: false,
      edit_line: 0,
      history_line: 0,
      key_waiting: 0,
      consolekeys: new Array<boolean>(KEY_ARRAY_SIZE).fill(false),
      menubound: new Array<boolean>(KEY_ARRAY_SIZE).fill(false),
      keyshift: new Int32Array(KEY_ARRAY_SIZE),
      keydown: new Array<boolean>(KEY_ARRAY_SIZE).fill(false),
      key_dest: keydest_t.key_game,
      console_open: false,
      con_display: 0,
      con_current: 0,
      con_totallines: 0
    },
    hooks: options.hooks ?? {},
    ...(options.cmd ? { cmd: options.cmd } : {}),
    ...(options.cvar ? { cvar: options.cvar } : {}),
    ...(options.host ? { host: options.host } : {}),
    ...(options.client ? { client: options.client } : {})
  };
}

/**
 * Original name: CompleteCommand
 * Source: client/keys.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Completes the current console edit line by trying commands first, then
 *   cvars, and rewrites the prompt as `]/<completion> ` when a match exists.
 *
 * Porting notes:
 * - Uses injected command/cvar runtimes or hooks instead of file-global engines.
 */
export function CompleteCommand(context: ClientKeyContext): void {
  let s = getEditLine(context).slice(1);
  if (s.startsWith("\\") || s.startsWith("/")) {
    s = s.slice(1);
  }

  let cmd = context.hooks.onCompleteCommand?.(s)
    ?? (context.cmd ? Cmd_CompleteCommand(context.cmd, s) : null);
  if (!cmd) {
    cmd = context.hooks.onCompleteVariable?.(s)
      ?? (context.cvar ? Cvar_CompleteVariable(context.cvar, s) : null);
  }

  if (!cmd) {
    return;
  }

  let next = `]/${cmd} `;
  next = clampCommandLine(next);
  setEditLine(context, next);
}

/**
 * Original name: Key_Console
 * Source: client/keys.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Handles console line editing, history navigation, clipboard paste, command
 *   submission, command completion and console scrollback keys.
 *
 * Porting notes:
 * - Console state is mirrored through the key context so this module can own
 *   the original `keys.c` editing behavior without importing `console.c`.
 */
export function Key_Console(context: ClientKeyContext, key: number): void {
  const state = context.state;
  key = translateKeypadConsoleKey(key);

  if ((toUpperAscii(key) === "V".charCodeAt(0) && state.keydown[K_CTRL])
    || ((key === K_INS || key === K_KP_INS) && state.keydown[K_SHIFT])) {
    const clipboard = sanitizeClipboard(readClipboard(context));
    if (clipboard.length > 0) {
      appendToEditLine(context, clipboard);
    }
    return;
  }

  if (key === "l".charCodeAt(0) && state.keydown[K_CTRL]) {
    addText(context, "clear\n");
    return;
  }

  if (key === K_ENTER || key === K_KP_ENTER) {
    const line = getEditLine(context);
    if (line[1] === "\\" || line[1] === "/") {
      addText(context, `${line.slice(2)}\n`);
    } else {
      addText(context, `${line.slice(1)}\n`);
    }

    printLine(context, `${line}\n`);
    state.edit_line = (state.edit_line + 1) & 31;
    state.history_line = state.edit_line;
    setEditLine(context, "]");
    if (context.client?.cls.state === connstate_t.ca_disconnected) {
      context.hooks.onUpdateScreen?.();
    }
    return;
  }

  if (key === K_TAB) {
    CompleteCommand(context);
    return;
  }

  if (key === K_BACKSPACE || key === K_LEFTARROW || key === K_KP_LEFTARROW
    || (key === "h".charCodeAt(0) && state.keydown[K_CTRL])) {
    if (state.key_linepos > 1) {
      const line = getEditLine(context);
      setEditLine(context, line.slice(0, state.key_linepos - 1));
    }
    return;
  }

  if (key === K_UPARROW || key === K_KP_UPARROW
    || (key === "p".charCodeAt(0) && state.keydown[K_CTRL])) {
    do {
      state.history_line = (state.history_line - 1) & 31;
    } while (state.history_line !== state.edit_line && getHistoryLine(context, state.history_line)[1] === undefined);

    if (state.history_line === state.edit_line) {
      state.history_line = (state.edit_line + 1) & 31;
    }

    setEditLine(context, getHistoryLine(context, state.history_line));
    return;
  }

  if (key === K_DOWNARROW || key === K_KP_DOWNARROW
    || (key === "n".charCodeAt(0) && state.keydown[K_CTRL])) {
    if (state.history_line === state.edit_line) {
      return;
    }

    do {
      state.history_line = (state.history_line + 1) & 31;
    } while (state.history_line !== state.edit_line && getHistoryLine(context, state.history_line)[1] === undefined);

    if (state.history_line === state.edit_line) {
      setEditLine(context, "]");
    } else {
      setEditLine(context, getHistoryLine(context, state.history_line));
    }
    return;
  }

  if (key === K_PGUP || key === K_KP_PGUP) {
    state.con_display -= 2;
    return;
  }

  if (key === K_PGDN || key === K_KP_PGDN) {
    state.con_display += 2;
    if (state.con_display > state.con_current) {
      state.con_display = state.con_current;
    }
    return;
  }

  if (key === K_HOME || key === K_KP_HOME) {
    state.con_display = state.con_current - state.con_totallines + 10;
    return;
  }

  if (key === K_END || key === K_KP_END) {
    state.con_display = state.con_current;
    return;
  }

  if (key < 32 || key > 127) {
    return;
  }

  appendToEditLine(context, String.fromCharCode(key));
}

/**
 * Original name: Key_Message
 * Source: client/keys.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Edits the chat buffer, sends `say` or `say_team` commands on Enter, and
 *   cancels chat input on Escape.
 *
 * Porting notes:
 * - The fixed C char buffer is represented as a string plus mirrored length.
 */
export function Key_Message(context: ClientKeyContext, key: number): void {
  const state = context.state;

  if (key === K_ENTER || key === K_KP_ENTER) {
    addText(context, state.chat_team ? "say_team \"" : "say \"");
    addText(context, state.chat_buffer);
    addText(context, "\"\n");
    state.key_dest = keydest_t.key_game;
    clearChatBuffer(state);
    return;
  }

  if (key === K_ESCAPE) {
    state.key_dest = keydest_t.key_game;
    clearChatBuffer(state);
    return;
  }

  if (key === K_BACKSPACE) {
    if (state.chat_bufferlen > 0) {
      state.chat_buffer = state.chat_buffer.slice(0, -1);
      state.chat_bufferlen = state.chat_buffer.length;
    }
    return;
  }

  if (key < 32 || key > 127) {
    return;
  }

  if (state.chat_bufferlen === MAXCMDLINE - 1) {
    return;
  }

  state.chat_buffer += String.fromCharCode(key);
  state.chat_bufferlen = state.chat_buffer.length;
}

/**
 * Original name: Key_StringToKeynum
 * Source: client/keys.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns a single ASCII character code directly, otherwise resolves a
 *   case-insensitive named key from keynames.
 */
export function Key_StringToKeynum(str: string | null | undefined): number {
  if (!str || str.length === 0) {
    return -1;
  }
  if (str.length === 1) {
    return str.charCodeAt(0);
  }

  const upper = str.toUpperCase();
  for (const kn of keynames) {
    if (upper === kn.name) {
      return kn.keynum;
    }
  }
  return -1;
}

/**
 * Original name: Key_KeynumToString
 * Source: client/keys.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Converts printable ASCII key codes or named Quake key codes back to their
 *   bind/config string representation.
 */
export function Key_KeynumToString(keynum: number): string {
  if (keynum === -1) {
    return "<KEY NOT FOUND>";
  }

  if (keynum > 32 && keynum < 127) {
    return String.fromCharCode(keynum);
  }

  for (const kn of keynames) {
    if (kn.keynum === keynum) {
      return kn.name;
    }
  }

  return "<UNKNOWN KEYNUM>";
}

/**
 * Original name: Key_SetBinding
 * Source: client/keys.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Replaces the binding string for one key slot.
 *
 * Porting notes:
 * - JavaScript strings replace Z_Malloc/Z_Free ownership; out-of-range key slots
 *   are ignored instead of writing outside keybindings[].
 */
export function Key_SetBinding(context: ClientKeyContext, keynum: number, binding: string): void {
  if (keynum < 0 || keynum >= KEY_ARRAY_SIZE) {
    return;
  }

  context.state.keybindings[keynum] = (` ${binding}`).slice(1);
  context.hooks.onSetBinding?.(keynum, binding);
}

/**
 * Original name: Key_Unbind_f
 * Source: client/keys.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Implements the `unbind <key>` console command and clears one binding.
 */
export function Key_Unbind_f(context: ClientKeyContext): void {
  if (!context.cmd) {
    return;
  }

  if (Cmd_Argc(context.cmd) !== 2) {
    printLine(context, "unbind <key> : remove commands from a key\n");
    return;
  }

  const b = Key_StringToKeynum(Cmd_Argv(context.cmd, 1));
  if (b === -1) {
    printLine(context, `"${Cmd_Argv(context.cmd, 1)}" isn't a valid key\n`);
    return;
  }

  Key_SetBinding(context, b, "");
}

/**
 * Original name: Key_Unbindall_f
 * Source: client/keys.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Clears every non-empty key binding.
 */
export function Key_Unbindall_f(context: ClientKeyContext): void {
  for (let i = 0; i < KEY_ARRAY_SIZE; i += 1) {
    if (context.state.keybindings[i]) {
      Key_SetBinding(context, i, "");
    }
  }
}

/**
 * Original name: Key_Bind_f
 * Source: client/keys.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Implements `bind <key> [command]`, including query-only output when no
 *   command text is supplied.
 */
export function Key_Bind_f(context: ClientKeyContext): void {
  if (!context.cmd) {
    return;
  }

  const c = Cmd_Argc(context.cmd);
  if (c < 2) {
    printLine(context, "bind <key> [command] : attach a command to a key\n");
    return;
  }

  const keyName = Cmd_Argv(context.cmd, 1);
  const b = Key_StringToKeynum(keyName);
  if (b === -1) {
    printLine(context, `"${keyName}" isn't a valid key\n`);
    return;
  }

  if (c === 2) {
    const binding = context.state.keybindings[b];
    if (binding) {
      printLine(context, `"${keyName}" = "${binding}"\n`);
    } else {
      printLine(context, `"${keyName}" is not bound\n`);
    }
    return;
  }

  const parts: string[] = [];
  for (let i = 2; i < c; i += 1) {
    parts.push(Cmd_Argv(context.cmd, i));
  }

  Key_SetBinding(context, b, parts.join(" "));
}

/**
 * Original name: Key_WriteBindings
 * Source: client/keys.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits config-file `bind key "value"` lines for non-empty bindings.
 */
export function Key_WriteBindings(context: ClientKeyContext, writer: KeyBindingWriter): void {
  for (let i = 0; i < KEY_ARRAY_SIZE; i += 1) {
    const binding = context.state.keybindings[i];
    if (binding && binding.length > 0) {
      writer.write(`bind ${Key_KeynumToString(i)} "${binding}"\n`);
    }
  }
}

/**
 * Original name: Key_Bindlist_f
 * Source: client/keys.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Prints every non-empty key binding to the console.
 */
export function Key_Bindlist_f(context: ClientKeyContext): void {
  for (let i = 0; i < KEY_ARRAY_SIZE; i += 1) {
    const binding = context.state.keybindings[i];
    if (binding && binding.length > 0) {
      printLine(context, `${Key_KeynumToString(i)} "${binding}"\n`);
    }
  }
}

/**
 * Original name: Key_Init
 * Source: client/keys.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes console edit lines, console/menu key masks, shifted key mapping
 *   and the bind/unbind console commands.
 *
 * Porting notes:
 * - Registers commands on the injected command runtime and keeps existing
 *   bindings, matching the original initialization intent.
 */
export function Key_Init(context: ClientKeyContext): void {
  const state = context.state;

  for (let i = 0; i < KEY_LINE_COUNT; i += 1) {
    state.key_lines[i] = "]";
  }
  state.key_linepos = 1;
  state.edit_line = 0;
  state.history_line = 0;
  state.key_waiting = 0;
  state.shift_down = false;
  state.anykeydown = 0;
  state.chat_buffer = "";
  state.chat_bufferlen = 0;

  state.consolekeys.fill(false);
  state.menubound.fill(false);
  state.keydown.fill(false);
  state.key_repeats.fill(0);

  for (let i = 32; i < 128; i += 1) {
    state.consolekeys[i] = true;
  }
  state.consolekeys[K_ENTER] = true;
  state.consolekeys[K_KP_ENTER] = true;
  state.consolekeys[K_TAB] = true;
  state.consolekeys[K_LEFTARROW] = true;
  state.consolekeys[K_KP_LEFTARROW] = true;
  state.consolekeys[K_RIGHTARROW] = true;
  state.consolekeys[K_KP_RIGHTARROW] = true;
  state.consolekeys[K_UPARROW] = true;
  state.consolekeys[K_KP_UPARROW] = true;
  state.consolekeys[K_DOWNARROW] = true;
  state.consolekeys[K_KP_DOWNARROW] = true;
  state.consolekeys[K_BACKSPACE] = true;
  state.consolekeys[K_HOME] = true;
  state.consolekeys[K_KP_HOME] = true;
  state.consolekeys[K_END] = true;
  state.consolekeys[K_KP_END] = true;
  state.consolekeys[K_PGUP] = true;
  state.consolekeys[K_KP_PGUP] = true;
  state.consolekeys[K_PGDN] = true;
  state.consolekeys[K_KP_PGDN] = true;
  state.consolekeys[K_SHIFT] = true;
  state.consolekeys[K_INS] = true;
  state.consolekeys[K_KP_INS] = true;
  state.consolekeys[K_KP_DEL] = true;
  state.consolekeys[K_KP_SLASH] = true;
  state.consolekeys[K_KP_PLUS] = true;
  state.consolekeys[K_KP_MINUS] = true;
  state.consolekeys[K_KP_5] = true;
  state.consolekeys["`".charCodeAt(0)] = false;
  state.consolekeys["~".charCodeAt(0)] = false;

  for (let i = 0; i < KEY_ARRAY_SIZE; i += 1) {
    state.keyshift[i] = i;
  }
  for (let i = "a".charCodeAt(0); i <= "z".charCodeAt(0); i += 1) {
    state.keyshift[i] = i - 32;
  }
  state.keyshift["1".charCodeAt(0)] = "!".charCodeAt(0);
  state.keyshift["2".charCodeAt(0)] = "@".charCodeAt(0);
  state.keyshift["3".charCodeAt(0)] = "#".charCodeAt(0);
  state.keyshift["4".charCodeAt(0)] = "$".charCodeAt(0);
  state.keyshift["5".charCodeAt(0)] = "%".charCodeAt(0);
  state.keyshift["6".charCodeAt(0)] = "^".charCodeAt(0);
  state.keyshift["7".charCodeAt(0)] = "&".charCodeAt(0);
  state.keyshift["8".charCodeAt(0)] = "*".charCodeAt(0);
  state.keyshift["9".charCodeAt(0)] = "(".charCodeAt(0);
  state.keyshift["0".charCodeAt(0)] = ")".charCodeAt(0);
  state.keyshift["-".charCodeAt(0)] = "_".charCodeAt(0);
  state.keyshift["=".charCodeAt(0)] = "+".charCodeAt(0);
  state.keyshift[",".charCodeAt(0)] = "<".charCodeAt(0);
  state.keyshift[".".charCodeAt(0)] = ">".charCodeAt(0);
  state.keyshift["/".charCodeAt(0)] = "?".charCodeAt(0);
  state.keyshift[";".charCodeAt(0)] = ":".charCodeAt(0);
  state.keyshift["'".charCodeAt(0)] = "\"".charCodeAt(0);
  state.keyshift["[".charCodeAt(0)] = "{".charCodeAt(0);
  state.keyshift["]".charCodeAt(0)] = "}".charCodeAt(0);
  state.keyshift["`".charCodeAt(0)] = "~".charCodeAt(0);
  state.keyshift["\\".charCodeAt(0)] = "|".charCodeAt(0);

  state.menubound[K_ESCAPE] = true;
  for (let i = 0; i < 12; i += 1) {
    state.menubound[K_F1 + i] = true;
  }

  if (context.cmd) {
    registerCommand(context.cmd, "bind", () => {
      Key_Bind_f(context);
    });
    registerCommand(context.cmd, "unbind", () => {
      Key_Unbind_f(context);
    });
    registerCommand(context.cmd, "unbindall", () => {
      Key_Unbindall_f(context);
    });
    registerCommand(context.cmd, "bindlist", () => {
      Key_Bindlist_f(context);
    });
  }

  context.hooks.onInit?.();
}

/**
 * Original name: Key_Event
 * Source: client/keys.c, declared in client/keys.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Dispatches one key transition through waits, repeats, bindings, console,
 *   chat and menu routing exactly as the original client key entry point.
 *
 * Porting notes:
 * - Receives an explicit key context instead of using the `keys.c` globals.
 */
export function Key_Event(context: ClientKeyContext, key: number, down: qboolean, time: number): void {
  if (key < 0 || key >= KEY_ARRAY_SIZE) {
    return;
  }

  const state = context.state;

  if (state.key_waiting === -1) {
    if (down) {
      state.key_waiting = key;
    }
    return;
  }

  if (down) {
    state.key_repeats[key] += 1;
    if (key !== K_BACKSPACE
      && key !== K_PAUSE
      && key !== K_PGUP
      && key !== K_KP_PGUP
      && key !== K_PGDN
      && key !== K_KP_PGDN
      && state.key_repeats[key] > 1) {
      return;
    }

    if (key >= 200 && !state.keybindings[key]) {
      printLine(context, `${Key_KeynumToString(key)} is unbound, hit F4 to set.\n`);
    }
  } else {
    state.key_repeats[key] = 0;
  }

  if (key === K_SHIFT) {
    state.shift_down = down;
  }

  if (key === "`".charCodeAt(0) || key === "~".charCodeAt(0)) {
    if (!down) {
      return;
    }
    toggleConsole(context);
    return;
  }

  if (context.client?.cl.attractloop && state.key_dest !== keydest_t.key_menu) {
    key = K_ESCAPE;
  }

  if (key === K_ESCAPE) {
    if (!down) {
      return;
    }

    const layouts = context.client?.cl.frame.playerstate.stats[STAT_LAYOUTS] ?? 0;
    if (layouts && state.key_dest === keydest_t.key_game) {
      addText(context, "cmd putaway\n");
      return;
    }

    switch (state.key_dest) {
      case keydest_t.key_message:
        Key_Message(context, key);
        break;
      case keydest_t.key_menu:
        context.hooks.onMenuKeydown?.(key);
        break;
      case keydest_t.key_game:
      case keydest_t.key_console:
        if (context.hooks.onMenuMain) {
          context.hooks.onMenuMain();
        } else {
          state.key_dest = keydest_t.key_menu;
        }
        break;
      default:
        error(context, "Bad cls.key_dest");
    }
    return;
  }

  state.keydown[key] = down;
  if (down) {
    if (state.key_repeats[key] === 1) {
      state.anykeydown += 1;
    }
  } else {
    state.anykeydown -= 1;
    if (state.anykeydown < 0) {
      state.anykeydown = 0;
    }
  }

  if (!down) {
    emitButtonRelease(context, key, time);
    context.hooks.onKeyEvent?.(key, down, time);
    return;
  }

  const clientState = context.client?.cls.state ?? connstate_t.ca_active;
  if ((state.key_dest === keydest_t.key_menu && state.menubound[key])
    || (state.key_dest === keydest_t.key_console && !state.consolekeys[key])
    || (state.key_dest === keydest_t.key_game && (clientState === connstate_t.ca_active || !state.consolekeys[key]))) {
    const binding = state.keybindings[key];
    if (binding) {
      if (binding.startsWith("+")) {
        addText(context, `${binding} ${key} ${time}\n`);
      } else {
        addText(context, `${binding}\n`);
      }
    }
    context.hooks.onKeyEvent?.(key, down, time);
    return;
  }

  let dispatchKey = key;
  if (state.shift_down) {
    dispatchKey = state.keyshift[dispatchKey] ?? dispatchKey;
  }

  switch (state.key_dest) {
    case keydest_t.key_message:
      Key_Message(context, dispatchKey);
      break;
    case keydest_t.key_menu:
      context.hooks.onMenuKeydown?.(dispatchKey);
      break;
    case keydest_t.key_game:
    case keydest_t.key_console:
      Key_Console(context, dispatchKey);
      break;
    default:
      error(context, "Bad cls.key_dest");
  }

  context.hooks.onKeyEvent?.(key, down, time);
}

/**
 * Original name: Key_ClearStates
 * Source: client/keys.c, declared in client/keys.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Releases every pressed or repeating key through Key_Event, clears repeat
 *   counters and resets aggregate key state.
 *
 * Porting notes:
 * - Receives an explicit key context instead of using the `keys.c` globals.
 */
export function Key_ClearStates(context: ClientKeyContext): void {
  context.state.anykeydown = 0;

  for (let i = 0; i < KEY_ARRAY_SIZE; i += 1) {
    if (context.state.keydown[i] || context.state.key_repeats[i]) {
      Key_Event(context, i, false, 0);
    }
    context.state.keydown[i] = false;
    context.state.key_repeats[i] = 0;
  }

  context.state.shift_down = false;
  context.hooks.onClearStates?.();
}

/**
 * Original name: Key_GetKey
 * Source: client/keys.c, declared in client/keys.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Arms the wait-for-key sentinel, pumps key events when a host is available
 *   and returns the captured key number.
 *
 * Porting notes:
 * - Test and web hosts can inject synchronous wait hooks instead of spinning
 *   in a blocking loop.
 */
export function Key_GetKey(context: ClientKeyContext): number {
  context.state.key_waiting = -1;

  const waited = context.hooks.onWaitForKey?.();
  if (waited !== undefined) {
    context.state.key_waiting = waited;
    return waited;
  }

  const fallback = context.hooks.onGetKey?.();
  if (fallback !== undefined) {
    context.state.key_waiting = fallback;
    return fallback;
  }

  if (context.host) {
    Sys_SendKeyEvents(context.host);
  }

  return context.state.key_waiting;
}

/**
 * Original name: N/A
 * Source: N/A (context overload helper)
 * Category: New
 * Purpose: Normalize the public context factory overloads into one option bag.
 */
function normalizeContextOptions(optionsOrHooks: ClientKeyContextOptions | ClientKeyHooks): ClientKeyContextOptions {
  if ("hooks" in optionsOrHooks || "cmd" in optionsOrHooks || "cvar" in optionsOrHooks || "host" in optionsOrHooks || "client" in optionsOrHooks) {
    return optionsOrHooks as ClientKeyContextOptions;
  }

  return { hooks: optionsOrHooks as ClientKeyHooks };
}

/**
 * Original name: N/A
 * Source: N/A (command registration guard)
 * Category: New
 * Purpose: Register key commands without duplicating existing host commands.
 */
function registerCommand(runtime: CommandRuntime, name: string, handler: () => void): void {
  if (Cmd_Exists(runtime, name)) {
    return;
  }
  Cmd_AddCommand(runtime, name, handler);
}

/**
 * Original name: N/A
 * Source: N/A (keypad translation helper)
 * Category: New
 * Purpose: Convert keypad virtual keys to printable console characters.
 */
function translateKeypadConsoleKey(key: number): number {
  switch (key) {
    case K_KP_SLASH: return "/".charCodeAt(0);
    case K_KP_MINUS: return "-".charCodeAt(0);
    case K_KP_PLUS: return "+".charCodeAt(0);
    case K_KP_HOME: return "7".charCodeAt(0);
    case K_KP_UPARROW: return "8".charCodeAt(0);
    case K_KP_PGUP: return "9".charCodeAt(0);
    case K_KP_LEFTARROW: return "4".charCodeAt(0);
    case K_KP_5: return "5".charCodeAt(0);
    case K_KP_RIGHTARROW: return "6".charCodeAt(0);
    case K_KP_END: return "1".charCodeAt(0);
    case K_KP_DOWNARROW: return "2".charCodeAt(0);
    case K_KP_PGDN: return "3".charCodeAt(0);
    case K_KP_INS: return "0".charCodeAt(0);
    case K_KP_DEL: return ".".charCodeAt(0);
    default: return key;
  }
}

/**
 * Original name: N/A
 * Source: N/A (ASCII shift helper)
 * Category: New
 * Purpose: Apply console uppercase handling to printable ASCII keys.
 */
function toUpperAscii(key: number): number {
  const char = String.fromCharCode(key);
  return char.toUpperCase().charCodeAt(0);
}

/**
 * Original name: N/A
 * Source: N/A (clipboard adapter)
 * Category: New
 * Purpose: Read clipboard text through injected hooks or the host system.
 */
function readClipboard(context: ClientKeyContext): string {
  return context.hooks.onGetClipboardData?.()
    ?? (context.host ? Sys_GetClipboardData(context.host) : null)
    ?? "";
}

/**
 * Original name: N/A
 * Source: N/A (clipboard sanitizer)
 * Category: New
 * Purpose: Trim pasted console text at control characters rejected by keys.c.
 */
function sanitizeClipboard(clipboard: string): string {
  const newlineIndex = clipboard.search(/[\n\r\b]/u);
  return newlineIndex >= 0 ? clipboard.slice(0, newlineIndex) : clipboard;
}

/**
 * Original name: N/A
 * Source: N/A (console edit helper)
 * Category: New
 * Purpose: Append text to the active console input line within MAXCMDLINE.
 */
function appendToEditLine(context: ClientKeyContext, chunk: string): void {
  if (chunk.length === 0) {
    return;
  }

  const line = getEditLine(context);
  const remaining = MAXCMDLINE - context.state.key_linepos - 1;
  if (remaining <= 0) {
    return;
  }

  const next = `${line}${chunk.slice(0, remaining)}`;
  setEditLine(context, next);
}

/**
 * Original name: N/A
 * Source: N/A (console line bound helper)
 * Category: New
 * Purpose: Keep console command lines within the original fixed buffer size.
 */
function clampCommandLine(line: string): string {
  return line.slice(0, MAXCMDLINE - 1);
}

/**
 * Original name: N/A
 * Source: N/A (console edit helper)
 * Category: New
 * Purpose: Return the active console input line with the Quake prompt fallback.
 */
function getEditLine(context: ClientKeyContext): string {
  return context.state.key_lines[context.state.edit_line] ?? "]";
}

/**
 * Original name: N/A
 * Source: N/A (console edit helper)
 * Category: New
 * Purpose: Store the active console input line and synchronize key_linepos.
 */
function setEditLine(context: ClientKeyContext, line: string): void {
  const clamped = clampCommandLine(line.length > 0 ? line : "]");
  context.state.key_lines[context.state.edit_line] = clamped;
  context.state.key_linepos = clamped.length;
}

/**
 * Original name: N/A
 * Source: N/A (console history helper)
 * Category: New
 * Purpose: Read a console history line with the Quake prompt fallback.
 */
function getHistoryLine(context: ClientKeyContext, index: number): string {
  return context.state.key_lines[index] ?? "]";
}

/**
 * Original name: N/A
 * Source: N/A (chat buffer helper)
 * Category: New
 * Purpose: Reset the explicit chat buffer fields kept in the key context.
 */
function clearChatBuffer(state: client_key_state_t): void {
  state.chat_buffer = "";
  state.chat_bufferlen = 0;
}

/**
 * Original name: N/A
 * Source: N/A (button release helper)
 * Category: New
 * Purpose: Emit matching minus commands for key-up transitions.
 */
function emitButtonRelease(context: ClientKeyContext, key: number, time: number): void {
  const binding = context.state.keybindings[key];
  if (binding?.startsWith("+")) {
    addText(context, `-${binding.slice(1)} ${key} ${time}\n`);
  }

  const shifted = context.state.keyshift[key];
  if (shifted !== key) {
    const shiftedBinding = context.state.keybindings[shifted];
    if (shiftedBinding?.startsWith("+")) {
      addText(context, `-${shiftedBinding.slice(1)} ${key} ${time}\n`);
    }
  }
}

/**
 * Original name: N/A
 * Source: N/A (command buffer adapter)
 * Category: New
 * Purpose: Route generated key command text to hooks or the command buffer.
 */
function addText(context: ClientKeyContext, text: string): void {
  if (context.hooks.onAddText) {
    context.hooks.onAddText(text);
    return;
  }

  if (context.cmd) {
    Cbuf_AddText(context.cmd, text);
  }
}

/**
 * Original name: N/A
 * Source: N/A (console print adapter)
 * Category: New
 * Purpose: Route key command feedback through the injected print hook.
 */
function printLine(context: ClientKeyContext, line: string): void {
  context.hooks.onPrint?.(line);
}

/**
 * Original name: N/A
 * Source: N/A (console toggle adapter)
 * Category: New
 * Purpose: Toggle console state through host hooks or the local key context.
 */
function toggleConsole(context: ClientKeyContext): void {
  if (context.hooks.onToggleConsole) {
    context.hooks.onToggleConsole(context);
    return;
  }

  context.state.console_open = !context.state.console_open;
  context.state.key_dest = context.state.console_open ? keydest_t.key_console : keydest_t.key_game;
}

/**
 * Original name: N/A
 * Source: N/A (error adapter)
 * Category: New
 * Purpose: Report key dispatcher errors through hooks or by throwing.
 */
function error(context: ClientKeyContext, message: string): never {
  if (context.hooks.onError) {
    return context.hooks.onError(message);
  }

  throw new Error(message);
}
