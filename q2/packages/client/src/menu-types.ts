/**
 * File: menu-types.ts
 * Source: Quake II original / client/menu.c
 * Purpose: Preserve the explicit runtime, shared state and helper utilities used by the `menu.c` port split across subfiles.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Groups the original file-static globals into an explicit context object shared by the split `menu.c` submodules.
 */

import {
  Com_Error,
  Com_ServerState,
  ERR_FATAL,
  type CommandRuntime,
  type CvarRuntime,
  type QcommonGlobals,
  type QcommonMiscRuntime,
  createNetAdr,
  type netadr_t,
  type qboolean
} from "../../qcommon/src/index.js";
import { type ClientKeyContext } from "./keys.js";
import {
  createMenuAction,
  createMenuField,
  createMenuFramework,
  createMenuList,
  createMenuSeparator,
  createMenuSlider,
  type ClientQMenuContext,
  type menuaction_s,
  type menufield_s,
  type menuframework_s,
  type menulist_s,
  type menuseparator_s
} from "./qmenu.js";
import { createRefExport, type refexport_t } from "./ref.js";
import type { refdef_t, entity_t } from "./ref.js";
import { type ClientRuntime } from "./client.js";
import { type ClientVidContext } from "./vid.js";

/**
 * Original name: MAX_MENU_DEPTH
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 */
export const MAX_MENU_DEPTH = 8;

/**
 * Original name: MAIN_ITEMS
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 */
export const MAIN_ITEMS = 5;

/**
 * Original name: NUM_CURSOR_FRAMES
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 */
export const NUM_CURSOR_FRAMES = 15;

/**
 * Original name: MAX_SAVEGAMES
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 */
export const MAX_SAVEGAMES = 15;

/**
 * Original name: MAX_LOCAL_SERVERS
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 */
export const MAX_LOCAL_SERVERS = 8;

/**
 * Original name: NUM_ADDRESSBOOK_ENTRIES
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 */
export const NUM_ADDRESSBOOK_ENTRIES = 9;

/**
 * Original name: NO_SERVER_STRING
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 */
export const NO_SERVER_STRING = "<no server>";

/**
 * Original name: menu_in_sound
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 */
export const menu_in_sound = "misc/menu1.wav";

/**
 * Original name: menu_move_sound
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 */
export const menu_move_sound = "misc/menu2.wav";

/**
 * Original name: menu_out_sound
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 */
export const menu_out_sound = "misc/menu3.wav";

/**
 * Original name: N/A
 * Source: N/A (split menu type helper)
 * Category: New
 */
export type MenuDrawFunction = (() => void) | null;

/**
 * Original name: N/A
 * Source: N/A (split menu type helper)
 * Category: New
 */
export type MenuKeyFunction = ((key: number) => string | null) | null;

/**
 * Original name: menulayer_t
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 */
export interface menulayer_t {
  draw: MenuDrawFunction;
  key: MenuKeyFunction;
}

/**
 * Original name: N/A
 * Source: N/A (web menu data hook)
 * Category: New
 */
export interface ClientMenuMapEntry {
  shortName: string;
  longName: string;
}

/**
 * Original name: N/A
 * Source: N/A (save menu data hook)
 * Category: New
 */
export interface ClientMenuSaveSlot {
  label: string;
  valid: qboolean;
}

/**
 * Original name: playermodelinfo_s
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 */
export interface PlayerModelInfo {
  directory: string;
  displayname?: string;
  skins: string[];
}

/**
 * Original name: N/A
 * Source: N/A (player config preview hook)
 * Category: New
 */
export interface PlayerConfigPreview {
  refdef: refdef_t;
  entity: entity_t;
  modelPath: string;
  skinPath: string;
  iconPath: string;
}

/**
 * Original name: N/A
 * Source: N/A (split menu state container)
 * Category: Adapter
 */
export interface ClientMenuState {
  m_main_cursor: number;
  m_game_cursor: number;
  m_entersound: qboolean;
  m_drawfunc: MenuDrawFunction;
  m_keyfunc: MenuKeyFunction;
  m_layers: menulayer_t[];
  m_menudepth: number;
  cursorPicsCached: qboolean;
  s_game_menu: menuframework_s;
  s_easy_game_action: menuaction_s;
  s_medium_game_action: menuaction_s;
  s_hard_game_action: menuaction_s;
  s_load_game_action: menuaction_s;
  s_save_game_action: menuaction_s;
  s_credits_action: menuaction_s;
  credits: Array<string | null>;
  creditsIndex: Array<string | null>;
  creditsBuffer: string | null;
  credits_start_time: number;
  s_blankline: menuseparator_s;
  s_loadgame_menu: menuframework_s;
  s_savegame_menu: menuframework_s;
  s_loadgame_actions: menuaction_s[];
  s_savegame_actions: menuaction_s[];
  m_savestrings: string[];
  m_savevalid: boolean[];
  bind_grab: qboolean;
  s_keys_menu: menuframework_s;
  s_keys_actions: menuaction_s[];
  s_options_menu: menuframework_s;
  s_options_defaults_action: menuaction_s;
  s_options_customize_options_action: menuaction_s;
  s_options_sensitivity_slider: import("./qmenu.js").menuslider_s;
  s_options_freelook_box: menulist_s;
  s_options_noalttab_box: menulist_s;
  s_options_alwaysrun_box: menulist_s;
  s_options_invertmouse_box: menulist_s;
  s_options_lookspring_box: menulist_s;
  s_options_lookstrafe_box: menulist_s;
  s_options_crosshair_box: menulist_s;
  s_options_sfxvolume_slider: import("./qmenu.js").menuslider_s;
  s_options_joystick_box: menulist_s;
  s_options_cdvolume_box: menulist_s;
  s_options_quality_list: menulist_s;
  s_options_compatibility_list: menulist_s;
  s_options_console_action: menuaction_s;
  s_multiplayer_menu: menuframework_s;
  s_join_network_server_action: menuaction_s;
  s_start_network_server_action: menuaction_s;
  s_player_setup_action: menuaction_s;
  s_joinserver_menu: menuframework_s;
  s_joinserver_server_title: menuseparator_s;
  s_joinserver_search_action: menuaction_s;
  s_joinserver_address_book_action: menuaction_s;
  s_joinserver_server_actions: menuaction_s[];
  m_num_servers: number;
  local_server_names: string[];
  local_server_netadr: Array<netadr_t | null>;
  s_addressbook_menu: menuframework_s;
  s_addressbook_fields: menufield_s[];
  s_startserver_menu: menuframework_s;
  mapnames: string[];
  nummaps: number;
  s_startserver_start_action: menuaction_s;
  s_startserver_dmoptions_action: menuaction_s;
  s_timelimit_field: menufield_s;
  s_fraglimit_field: menufield_s;
  s_maxclients_field: menufield_s;
  s_hostname_field: menufield_s;
  s_startmap_list: menulist_s;
  s_rules_box: menulist_s;
  dmoptions_statusbar: string;
  s_dmoptions_menu: menuframework_s;
  s_friendlyfire_box: menulist_s;
  s_falls_box: menulist_s;
  s_weapons_stay_box: menulist_s;
  s_instant_powerups_box: menulist_s;
  s_powerups_box: menulist_s;
  s_health_box: menulist_s;
  s_spawn_farthest_box: menulist_s;
  s_teamplay_box: menulist_s;
  s_samelevel_box: menulist_s;
  s_force_respawn_box: menulist_s;
  s_armor_box: menulist_s;
  s_allow_exit_box: menulist_s;
  s_infinite_ammo_box: menulist_s;
  s_fixed_fov_box: menulist_s;
  s_quad_drop_box: menulist_s;
  s_no_mines_box: menulist_s;
  s_no_nukes_box: menulist_s;
  s_stack_double_box: menulist_s;
  s_no_spheres_box: menulist_s;
  s_downloadoptions_menu: menuframework_s;
  s_download_title: menuseparator_s;
  s_allow_download_box: menulist_s;
  s_allow_download_maps_box: menulist_s;
  s_allow_download_models_box: menulist_s;
  s_allow_download_players_box: menulist_s;
  s_allow_download_sounds_box: menulist_s;
  s_player_config_menu: menuframework_s;
  s_player_name_field: menufield_s;
  s_player_model_box: menulist_s;
  s_player_skin_box: menulist_s;
  s_player_handedness_box: menulist_s;
  s_player_rate_box: menulist_s;
  s_player_skin_title: menuseparator_s;
  s_player_model_title: menuseparator_s;
  s_player_hand_title: menuseparator_s;
  s_player_rate_title: menuseparator_s;
  s_player_download_action: menuaction_s;
  s_pmi: PlayerModelInfo[];
  s_pmnames: Array<string | null>;
  s_numplayermodels: number;
  player_config_yaw: number;
}

/**
 * Original name: N/A
 * Source: N/A (embedder hook contract)
 * Category: New
 */
export interface ClientMenuHooks {
  startLocalSound?: (name: string) => void;
  getServerState?: () => number;
  getSaveSlots?: () => Array<ClientMenuSaveSlot | null> | null;
  getMapList?: () => Array<ClientMenuMapEntry> | null;
  getCreditsText?: () => string | null;
  getPlayerModels?: () => PlayerModelInfo[] | null;
  onPlayerConfigPreview?: (preview: PlayerConfigPreview) => void;
  getDeveloperSearchpath?: (who: number) => number;
  onMenuJoinServer?: () => void;
  onMenuStartServer?: () => void;
  onPingServers?: () => void;
  onSoundRestart?: () => void;
  onClearTyping?: () => void;
  onClearNotify?: () => void;
  onQuit?: () => void;
}

/**
 * Original name: N/A
 * Source: N/A (split menu runtime context)
 * Category: New
 */
export interface ClientMenuContext {
  client: ClientRuntime;
  keys: ClientKeyContext;
  qmenu: ClientQMenuContext;
  cmd: CommandRuntime;
  cvar: CvarRuntime;
  vid: ClientVidContext;
  ref: refexport_t;
  state: ClientMenuState;
  hooks: ClientMenuHooks;
  globals?: QcommonGlobals;
  misc?: QcommonMiscRuntime;
}

/**
 * Original name: N/A
 * Source: N/A (split menu context factory)
 * Category: New
 */
export function createClientMenuContext(options: {
  client: ClientRuntime;
  keys: ClientKeyContext;
  qmenu: ClientQMenuContext;
  cmd: CommandRuntime;
  cvar: CvarRuntime;
  vid: ClientVidContext;
  ref?: refexport_t;
  hooks?: ClientMenuHooks;
  globals?: QcommonGlobals;
  misc?: QcommonMiscRuntime;
}): ClientMenuContext {
  return {
    client: options.client,
    keys: options.keys,
    qmenu: options.qmenu,
    cmd: options.cmd,
    cvar: options.cvar,
    vid: options.vid,
    ref: options.ref ?? createRefExport(),
    hooks: options.hooks ?? {},
    ...(options.globals ? { globals: options.globals } : {}),
    ...(options.misc ? { misc: options.misc } : {}),
    state: {
      m_main_cursor: 0,
      m_game_cursor: 0,
      m_entersound: false,
      m_drawfunc: null,
      m_keyfunc: null,
      m_layers: Array.from({ length: MAX_MENU_DEPTH }, () => ({ draw: null, key: null })),
      m_menudepth: 0,
      cursorPicsCached: false,
      s_game_menu: createMenuFramework(),
      s_easy_game_action: createMenuAction(),
      s_medium_game_action: createMenuAction(),
      s_hard_game_action: createMenuAction(),
      s_load_game_action: createMenuAction(),
      s_save_game_action: createMenuAction(),
      s_credits_action: createMenuAction(),
      credits: [],
      creditsIndex: new Array<string | null>(256).fill(null),
      creditsBuffer: null,
      credits_start_time: 0,
      s_blankline: createMenuSeparator(),
      s_loadgame_menu: createMenuFramework(),
      s_savegame_menu: createMenuFramework(),
      s_loadgame_actions: Array.from({ length: MAX_SAVEGAMES }, () => createMenuAction()),
      s_savegame_actions: Array.from({ length: MAX_SAVEGAMES }, () => createMenuAction()),
      m_savestrings: new Array<string>(MAX_SAVEGAMES).fill("<EMPTY>"),
      m_savevalid: new Array<boolean>(MAX_SAVEGAMES).fill(false),
      bind_grab: false,
      s_keys_menu: createMenuFramework(),
      s_keys_actions: Array.from({ length: 23 }, () => createMenuAction()),
      s_options_menu: createMenuFramework(),
      s_options_defaults_action: createMenuAction(),
      s_options_customize_options_action: createMenuAction(),
      s_options_sensitivity_slider: createMenuSlider(),
      s_options_freelook_box: createMenuList(3),
      s_options_noalttab_box: createMenuList(3),
      s_options_alwaysrun_box: createMenuList(3),
      s_options_invertmouse_box: createMenuList(3),
      s_options_lookspring_box: createMenuList(3),
      s_options_lookstrafe_box: createMenuList(3),
      s_options_crosshair_box: createMenuList(3),
      s_options_sfxvolume_slider: createMenuSlider(),
      s_options_joystick_box: createMenuList(3),
      s_options_cdvolume_box: createMenuList(3),
      s_options_quality_list: createMenuList(3),
      s_options_compatibility_list: createMenuList(3),
      s_options_console_action: createMenuAction(),
      s_multiplayer_menu: createMenuFramework(),
      s_join_network_server_action: createMenuAction(),
      s_start_network_server_action: createMenuAction(),
      s_player_setup_action: createMenuAction(),
      s_joinserver_menu: createMenuFramework(),
      s_joinserver_server_title: createMenuSeparator(),
      s_joinserver_search_action: createMenuAction(),
      s_joinserver_address_book_action: createMenuAction(),
      s_joinserver_server_actions: Array.from({ length: MAX_LOCAL_SERVERS }, () => createMenuAction()),
      m_num_servers: 0,
      local_server_names: new Array<string>(MAX_LOCAL_SERVERS).fill(NO_SERVER_STRING),
      local_server_netadr: Array.from({ length: MAX_LOCAL_SERVERS }, () => createNetAdr()),
      s_addressbook_menu: createMenuFramework(),
      s_addressbook_fields: Array.from({ length: NUM_ADDRESSBOOK_ENTRIES }, () => createMenuField()),
      s_startserver_menu: createMenuFramework(),
      mapnames: [],
      nummaps: 0,
      s_startserver_start_action: createMenuAction(),
      s_startserver_dmoptions_action: createMenuAction(),
      s_timelimit_field: createMenuField(),
      s_fraglimit_field: createMenuField(),
      s_maxclients_field: createMenuField(),
      s_hostname_field: createMenuField(),
      s_startmap_list: createMenuList(3),
      s_rules_box: createMenuList(3),
      dmoptions_statusbar: "",
      s_dmoptions_menu: createMenuFramework(),
      s_friendlyfire_box: createMenuList(3),
      s_falls_box: createMenuList(3),
      s_weapons_stay_box: createMenuList(3),
      s_instant_powerups_box: createMenuList(3),
      s_powerups_box: createMenuList(3),
      s_health_box: createMenuList(3),
      s_spawn_farthest_box: createMenuList(3),
      s_teamplay_box: createMenuList(3),
      s_samelevel_box: createMenuList(3),
      s_force_respawn_box: createMenuList(3),
      s_armor_box: createMenuList(3),
      s_allow_exit_box: createMenuList(3),
      s_infinite_ammo_box: createMenuList(3),
      s_fixed_fov_box: createMenuList(3),
      s_quad_drop_box: createMenuList(3),
      s_no_mines_box: createMenuList(3),
      s_no_nukes_box: createMenuList(3),
      s_stack_double_box: createMenuList(3),
      s_no_spheres_box: createMenuList(3),
      s_downloadoptions_menu: createMenuFramework(),
      s_download_title: createMenuSeparator(),
      s_allow_download_box: createMenuList(3),
      s_allow_download_maps_box: createMenuList(3),
      s_allow_download_models_box: createMenuList(3),
      s_allow_download_players_box: createMenuList(3),
      s_allow_download_sounds_box: createMenuList(3),
      s_player_config_menu: createMenuFramework(),
      s_player_name_field: createMenuField(),
      s_player_model_box: createMenuList(3),
      s_player_skin_box: createMenuList(3),
      s_player_handedness_box: createMenuList(3),
      s_player_rate_box: createMenuList(3),
      s_player_skin_title: createMenuSeparator(),
      s_player_model_title: createMenuSeparator(),
      s_player_hand_title: createMenuSeparator(),
      s_player_rate_title: createMenuSeparator(),
      s_player_download_action: createMenuAction(),
      s_pmi: [],
      s_pmnames: [],
      s_numplayermodels: 0,
      player_config_yaw: 0
    }
  };
}

/**
 * Original name: Com_Error
 * Source: Quake-2-master/qcommon/common.c
 * Category: Adapter
 */
export function menuError(context: ClientMenuContext, message: string): never {
  if (context.misc) {
    return Com_Error(context.misc, ERR_FATAL, message);
  }

  throw new Error(message);
}

/**
 * Original name: N/A
 * Source: N/A (split menu video sync helper)
 * Category: New
 */
export function syncMenuVideo(context: ClientMenuContext): void {
  context.qmenu.state.vidWidth = context.vid.viddef.width;
  context.qmenu.state.vidHeight = context.vid.viddef.height;
}

/**
 * Original name: Com_ServerState
 * Source: Quake-2-master/qcommon/common.c
 * Category: Adapter
 */
export function getServerState(context: ClientMenuContext): number {
  if (context.hooks.getServerState) {
    return context.hooks.getServerState();
  }

  if (context.globals) {
    return Com_ServerState(context.globals);
  }

  return 0;
}

/**
 * Original name: S_StartLocalSound
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Adapter
 */
export function startLocalSound(context: ClientMenuContext, name: string): void {
  context.hooks.startLocalSound?.(name);
}

/**
 * Original name: N/A
 * Source: N/A (split menu framework reset helper)
 * Category: New
 */
export function resetMenuFramework(menu: menuframework_s): void {
  menu.y = 0;
  menu.cursor = 0;
  menu.nitems = 0;
  menu.nslots = 0;
  menu.items.fill(null);
  menu.statusbar = null;
  menu.cursordraw = null;
}
