/**
 * File: menu.ts
 * Source: Quake II original / client/menu.c
 * Purpose: Port the Quake II client menu subsystem while preserving a single principal attachment point for `client/menu.c`.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Decomposition:
 * - `menu.ts`: principal facade and public attachment point for `client/menu.c`.
 * - `menu-types.ts`: explicit runtime context, shared state and cross-cutting helpers.
 * - `menu-runtime.ts`: shared menu stack (`M_PushMenu`, `M_PopMenu`, `M_Draw`, `M_Keydown`, `M_Init`).
 * - `menu-draw.ts`: common drawing helpers (`M_Banner`, `M_Draw*`, `M_Print*`).
 * - `menu-main-game.ts`: main menu plus `game/load/save`.
 * - `menu-options-keys.ts`: `options` and `keys`.
 * - `menu-multiplayer.ts`: multiplayer menu block.
 * - `menu-player-config.ts`: player setup block.
 * - `menu-misc.ts`: lightweight remaining entry points such as `video` and `quit`.
 *
 * Porting notes:
 * - This split follows coherent source sub-blocks from the original 4000-line file while keeping `menu.ts` as the explicit source-to-target anchor required by the project rules.
 * - The split is organizational only; the public API still re-exports through this principal file.
 */

export {
  createClientMenuContext,
  getServerState,
  menu_in_sound,
  menu_move_sound,
  menu_out_sound,
  resetMenuFramework,
  startLocalSound,
  syncMenuVideo,
  MAIN_ITEMS,
  MAX_LOCAL_SERVERS,
  MAX_MENU_DEPTH,
  MAX_SAVEGAMES,
  NO_SERVER_STRING,
  NUM_ADDRESSBOOK_ENTRIES,
  NUM_CURSOR_FRAMES
} from "./menu-types.js";
export type {
  ClientMenuContext,
  ClientMenuHooks,
  ClientMenuMapEntry,
  PlayerConfigPreview,
  PlayerModelInfo,
  ClientMenuSaveSlot,
  ClientMenuState,
  MenuDrawFunction,
  MenuKeyFunction
} from "./menu-types.js";

export {
  M_Banner,
  M_DrawCharacter,
  M_DrawCursor,
  M_DrawPic,
  M_DrawTextBox,
  M_Print,
  M_PrintWhite
} from "./menu-draw.js";

export {
  Default_MenuKey,
  M_Draw,
  M_ForceMenuOff,
  M_Init,
  M_Keydown,
  M_PopMenu,
  M_PushMenu
} from "./menu-runtime.js";

export {
  Create_Savestrings,
  Game_MenuInit,
  Game_MenuKey,
  LoadGame_MenuInit,
  LoadGame_MenuKey,
  M_Credits_Key,
  M_Credits_MenuDraw,
  M_Menu_Credits_f,
  M_Main_Draw,
  M_Main_Key,
  M_Menu_Game_f,
  M_Menu_LoadGame_f,
  M_Menu_Main_f,
  M_Menu_SaveGame_f,
  SaveGame_MenuInit,
  SaveGame_MenuKey,
  idcredits,
  roguecredits,
  xatcredits
} from "./menu-main-game.js";

export {
  Keys_MenuInit,
  Keys_MenuKey,
  M_Menu_Keys_f,
  M_Menu_Options_f,
  Options_MenuInit,
  Options_MenuKey
} from "./menu-options-keys.js";

export {
  AddressBook_MenuInit,
  AddressBook_MenuKey,
  DMFlagCallback,
  DMOptions_MenuInit,
  DMOptions_MenuKey,
  DownloadCallback,
  DownloadOptions_MenuInit,
  DownloadOptions_MenuKey,
  JoinServer_MenuInit,
  JoinServer_MenuKey,
  M_AddToServerList,
  M_Menu_AddressBook_f,
  M_Menu_DMOptions_f,
  M_Menu_DownloadOptions_f,
  M_Menu_JoinServer_f,
  M_Menu_StartServer_f,
  M_Menu_Multiplayer_f,
  Multiplayer_MenuInit,
  Multiplayer_MenuKey,
  StartServer_MenuInit,
  StartServer_MenuKey
} from "./menu-multiplayer.js";

export {
  M_Menu_PlayerConfig_f,
  PlayerConfig_MenuInit,
  PlayerConfig_MenuKey,
  PlayerConfig_ScanDirectories,
  pmicmpfnc
} from "./menu-player-config.js";

export {
  M_Menu_Quit_f,
  M_Menu_Video_f,
  M_Quit_Draw,
  M_Quit_Key
} from "./menu-misc.js";
