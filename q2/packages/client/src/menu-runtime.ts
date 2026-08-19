/**
 * File: menu-runtime.ts
 * Source: Quake-2-master/client/menu.c
 * Purpose: Port the shared menu stack, command registration and global draw/key entry points from `menu.c`.
 */

import { Cmd_AddCommand, Cmd_Exists, Cvar_Set, Cvar_VariableValue } from "../../qcommon/src/index.js";
import {
  K_AUX1,
  K_AUX2,
  K_AUX3,
  K_AUX4,
  K_AUX5,
  K_AUX6,
  K_AUX7,
  K_AUX8,
  K_AUX9,
  K_AUX10,
  K_AUX11,
  K_AUX12,
  K_AUX13,
  K_AUX14,
  K_AUX15,
  K_AUX16,
  K_AUX17,
  K_AUX18,
  K_AUX19,
  K_AUX20,
  K_AUX21,
  K_AUX22,
  K_AUX23,
  K_AUX24,
  K_AUX25,
  K_AUX26,
  K_AUX27,
  K_AUX28,
  K_AUX29,
  K_AUX30,
  K_AUX31,
  K_AUX32,
  K_DOWNARROW,
  K_ENTER,
  K_ESCAPE,
  K_JOY1,
  K_JOY2,
  K_JOY3,
  K_JOY4,
  K_KP_DOWNARROW,
  K_KP_ENTER,
  K_KP_LEFTARROW,
  K_KP_RIGHTARROW,
  K_KP_UPARROW,
  K_LEFTARROW,
  K_MOUSE1,
  K_MOUSE2,
  K_MOUSE3,
  K_RIGHTARROW,
  K_TAB,
  K_UPARROW,
  Key_ClearStates,
  keydest_t
} from "./keys.js";
import {
  M_Menu_Credits_f,
  M_Menu_Game_f,
  M_Menu_LoadGame_f,
  M_Menu_Main_f,
  M_Menu_SaveGame_f
} from "./menu-main-game.js";
import { M_Menu_Keys_f, M_Menu_Options_f } from "./menu-options-keys.js";
import { M_Menu_PlayerConfig_f } from "./menu-player-config.js";
import { M_Menu_Quit_f, M_Menu_Video_f } from "./menu-misc.js";
import {
  M_Menu_AddressBook_f,
  M_Menu_DMOptions_f,
  M_Menu_DownloadOptions_f,
  M_Menu_JoinServer_f,
  M_Menu_Multiplayer_f,
  M_Menu_StartServer_f
} from "./menu-multiplayer.js";
import {
  getServerState,
  MAX_MENU_DEPTH,
  menu_move_sound,
  menu_in_sound,
  menu_out_sound,
  menuError,
  startLocalSound,
  syncMenuVideo
} from "./menu-types.js";
import type { ClientMenuContext } from "./menu-types.js";
import {
  Field_Key,
  Menu_AdjustCursor,
  Menu_ItemAtCursor,
  Menu_SelectItem,
  Menu_SlideItem,
  MTYPE_FIELD
} from "./qmenu.js";
import { SCR_DirtyScreen } from "./cl_scrn.js";

/**
 * Original name: M_PushMenu
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Close
 */
export function M_PushMenu(
  context: ClientMenuContext,
  draw: Exclude<ClientMenuContext["state"]["m_drawfunc"], null>,
  key: Exclude<ClientMenuContext["state"]["m_keyfunc"], null>
): void {
  let i = 0;

  if (Cvar_VariableValue(context.cvar, "maxclients") === 1 && getServerState(context) !== 0) {
    Cvar_Set(context.cvar, "paused", "1");
  }

  for (i = 0; i < context.state.m_menudepth; i += 1) {
    if (context.state.m_layers[i].draw === draw && context.state.m_layers[i].key === key) {
      context.state.m_menudepth = i;
    }
  }

  if (i === context.state.m_menudepth) {
    if (context.state.m_menudepth >= MAX_MENU_DEPTH) {
      menuError(context, "M_PushMenu: MAX_MENU_DEPTH");
    }

    context.state.m_layers[context.state.m_menudepth].draw = context.state.m_drawfunc;
    context.state.m_layers[context.state.m_menudepth].key = context.state.m_keyfunc;
    context.state.m_menudepth += 1;
  }

  context.state.m_drawfunc = draw;
  context.state.m_keyfunc = key;
  context.state.m_entersound = true;
  context.keys.state.key_dest = keydest_t.key_menu;
}

/**
 * Original name: M_ForceMenuOff
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function M_ForceMenuOff(context: ClientMenuContext): void {
  context.state.m_drawfunc = null;
  context.state.m_keyfunc = null;
  context.keys.state.key_dest = keydest_t.key_game;
  context.state.m_menudepth = 0;
  Key_ClearStates(context.keys);
  Cvar_Set(context.cvar, "paused", "0");
}

/**
 * Original name: M_PopMenu
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function M_PopMenu(context: ClientMenuContext): void {
  startLocalSound(context, menu_out_sound);

  if (context.state.m_menudepth < 1) {
    menuError(context, "M_PopMenu: depth < 1");
  }

  context.state.m_menudepth -= 1;
  context.state.m_drawfunc = context.state.m_layers[context.state.m_menudepth].draw;
  context.state.m_keyfunc = context.state.m_layers[context.state.m_menudepth].key;

  if (!context.state.m_menudepth) {
    M_ForceMenuOff(context);
  }
}

/**
 * Original name: Default_MenuKey
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Close
 */
export function Default_MenuKey(context: ClientMenuContext, menu: import("./qmenu.js").menuframework_s | null, key: number): string | null {
  let sound: string | null = null;

  if (menu) {
    const item = Menu_ItemAtCursor(context.qmenu, menu);
    if (item && item.generic.type === MTYPE_FIELD) {
      if (Field_Key(context.qmenu, item as import("./qmenu.js").menufield_s, key)) {
        return null;
      }
    }
  }

  switch (key) {
    case K_ESCAPE:
      M_PopMenu(context);
      return menu_out_sound;

    case K_KP_UPARROW:
    case K_UPARROW:
      if (menu) {
        menu.cursor -= 1;
        Menu_AdjustCursor(context.qmenu, menu, -1);
        sound = menu_move_sound;
      }
      break;

    case K_TAB:
      if (menu) {
        menu.cursor += 1;
        Menu_AdjustCursor(context.qmenu, menu, 1);
        sound = menu_move_sound;
      }
      break;

    case K_KP_DOWNARROW:
    case K_DOWNARROW:
      if (menu) {
        menu.cursor += 1;
        Menu_AdjustCursor(context.qmenu, menu, 1);
        sound = menu_move_sound;
      }
      break;

    case K_KP_LEFTARROW:
    case K_LEFTARROW:
      if (menu) {
        Menu_SlideItem(context.qmenu, menu, -1);
        sound = menu_move_sound;
      }
      break;

    case K_KP_RIGHTARROW:
    case K_RIGHTARROW:
      if (menu) {
        Menu_SlideItem(context.qmenu, menu, 1);
        sound = menu_move_sound;
      }
      break;

    case K_MOUSE1:
    case K_MOUSE2:
    case K_MOUSE3:
    case K_JOY1:
    case K_JOY2:
    case K_JOY3:
    case K_JOY4:
    case K_AUX1:
    case K_AUX2:
    case K_AUX3:
    case K_AUX4:
    case K_AUX5:
    case K_AUX6:
    case K_AUX7:
    case K_AUX8:
    case K_AUX9:
    case K_AUX10:
    case K_AUX11:
    case K_AUX12:
    case K_AUX13:
    case K_AUX14:
    case K_AUX15:
    case K_AUX16:
    case K_AUX17:
    case K_AUX18:
    case K_AUX19:
    case K_AUX20:
    case K_AUX21:
    case K_AUX22:
    case K_AUX23:
    case K_AUX24:
    case K_AUX25:
    case K_AUX26:
    case K_AUX27:
    case K_AUX28:
    case K_AUX29:
    case K_AUX30:
    case K_AUX31:
    case K_AUX32:
    case K_KP_ENTER:
    case K_ENTER:
      if (menu) {
        Menu_SelectItem(context.qmenu, menu);
      }
      sound = menu_move_sound;
      break;
    default:
      break;
  }

  return sound;
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose:
 * - Keeps menu command registration idempotent for browser and test runtimes that can initialize the menu more than once.
 */
function registerMenuCommand(context: ClientMenuContext, name: string, callback: () => void): void {
  if (!Cmd_Exists(context.cmd, name)) {
    Cmd_AddCommand(context.cmd, name, callback);
  }
}

/**
 * Original name: M_Init
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Registers the original `menu_*` console commands and routes each command to its ported menu entry point.
 *
 * Porting notes:
 * - Uses `Cmd_Exists` to keep initialization idempotent in browser/test runtimes.
 */
export function M_Init(context: ClientMenuContext): void {
  registerMenuCommand(context, "menu_main", () => {
    M_Menu_Main_f(context);
  });
  registerMenuCommand(context, "menu_game", () => {
    M_Menu_Game_f(context);
  });
  registerMenuCommand(context, "menu_loadgame", () => {
    M_Menu_LoadGame_f(context);
  });
  registerMenuCommand(context, "menu_savegame", () => {
    M_Menu_SaveGame_f(context);
  });
  registerMenuCommand(context, "menu_credits", () => {
    M_Menu_Credits_f(context);
  });
  registerMenuCommand(context, "menu_multiplayer", () => {
    M_Menu_Multiplayer_f(context);
  });
  registerMenuCommand(context, "menu_joinserver", () => {
    M_Menu_JoinServer_f(context);
  });
  registerMenuCommand(context, "menu_addressbook", () => {
    M_Menu_AddressBook_f(context);
  });
  registerMenuCommand(context, "menu_startserver", () => {
    M_Menu_StartServer_f(context);
  });
  registerMenuCommand(context, "menu_dmoptions", () => {
    M_Menu_DMOptions_f(context);
  });
  registerMenuCommand(context, "menu_downloadoptions", () => {
    M_Menu_DownloadOptions_f(context);
  });
  registerMenuCommand(context, "menu_playerconfig", () => {
    M_Menu_PlayerConfig_f(context);
  });
  registerMenuCommand(context, "menu_video", () => {
    M_Menu_Video_f(context);
  });
  registerMenuCommand(context, "menu_options", () => {
    M_Menu_Options_f(context);
  });
  registerMenuCommand(context, "menu_keys", () => {
    M_Menu_Keys_f(context);
  });
  registerMenuCommand(context, "menu_quit", () => {
    M_Menu_Quit_f(context);
  });
}

/**
 * Original name: M_Draw
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Draws the active menu only in menu input mode, dirties the screen, fades/fills the background, and plays deferred enter sounds.
 */
export function M_Draw(context: ClientMenuContext): void {
  if (context.keys.state.key_dest !== keydest_t.key_menu) {
    return;
  }

  syncMenuVideo(context);
  SCR_DirtyScreen(context.client, context.vid.viddef.width, context.vid.viddef.height);

  if (context.client.cl.cinematic.cinematictime > 0) {
    context.ref.DrawFill(0, 0, context.vid.viddef.width, context.vid.viddef.height, 0);
  } else {
    context.ref.DrawFadeScreen();
  }

  context.state.m_drawfunc?.();

  if (context.state.m_entersound) {
    startLocalSound(context, menu_in_sound);
    context.state.m_entersound = false;
  }
}

/**
 * Original name: M_Keydown
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Dispatches a key to the active menu key handler and plays any returned menu sound.
 */
export function M_Keydown(context: ClientMenuContext, key: number): void {
  const sound = context.state.m_keyfunc?.(key);
  if (sound) {
    startLocalSound(context, sound);
  }
}
