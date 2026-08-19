/**
 * File: menu-multiplayer.ts
 * Source: Quake II original / client/menu.c
 * Purpose: Port the multiplayer, join-server and address-book blocks from `menu.c`.
 */

import {
  Cbuf_AddText,
  CVAR_ARCHIVE,
  Cvar_Get,
  Cvar_Set,
  Cvar_SetValue,
  Cvar_VariableString,
  Cvar_VariableValue,
  DF_ALLOW_EXIT,
  DF_FIXED_FOV,
  DF_FORCE_RESPAWN,
  DF_INFINITE_AMMO,
  DF_INSTANT_ITEMS,
  DF_MODELTEAMS,
  DF_NO_ARMOR,
  DF_NO_FALLING,
  DF_NO_FRIENDLY_FIRE,
  DF_NO_HEALTH,
  DF_NO_ITEMS,
  DF_NO_MINES,
  DF_NO_NUKES,
  DF_NO_SPHERES,
  DF_NO_STACK_DOUBLE,
  DF_QUAD_DROP,
  DF_SAME_LEVEL,
  DF_SKINTEAMS,
  DF_SPAWN_FARTHEST,
  DF_WEAPONS_STAY,
  NET_AdrToString,
  type netadr_t
} from "../../qcommon/src/index.js";
import { K_ESCAPE } from "./keys.js";
import { M_Banner, M_DrawTextBox, M_Print } from "./menu-draw.js";
import { M_Menu_PlayerConfig_f } from "./menu-player-config.js";
import { M_ForceMenuOff, M_PushMenu, Default_MenuKey } from "./menu-runtime.js";
import {
  MAX_LOCAL_SERVERS,
  NO_SERVER_STRING,
  NUM_ADDRESSBOOK_ENTRIES,
  getServerState,
  menuError,
  resetMenuFramework,
  syncMenuVideo
} from "./menu-types.js";
import type { ClientMenuContext } from "./menu-types.js";
import {
  Menu_AddItem,
  Menu_AdjustCursor,
  Menu_Center,
  Menu_Draw,
  Menu_SetStatusBar,
  QMF_LEFT_JUSTIFY,
  QMF_NUMBERSONLY,
  MTYPE_ACTION,
  MTYPE_FIELD,
  MTYPE_SEPARATOR,
  MTYPE_SPINCONTROL,
  type menulist_s
} from "./qmenu.js";

/**
 * Original name: PlayerSetupFunc
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function PlayerSetupFunc(context: ClientMenuContext): void {
  M_Menu_PlayerConfig_f(context);
}

/**
 * Original name: JoinNetworkServerFunc
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function JoinNetworkServerFunc(context: ClientMenuContext): void {
  M_Menu_JoinServer_f(context);
}

/**
 * Original name: StartNetworkServerFunc
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function StartNetworkServerFunc(context: ClientMenuContext): void {
  M_Menu_StartServer_f(context);
}

/**
 * Original name: Multiplayer_MenuDraw
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function Multiplayer_MenuDraw(context: ClientMenuContext): void {
  syncMenuVideo(context);
  M_Banner(context, "m_banner_multiplayer");
  Menu_AdjustCursor(context.qmenu, context.state.s_multiplayer_menu, 1);
  Menu_Draw(context.qmenu, context.state.s_multiplayer_menu);
}

/**
 * Original name: Multiplayer_MenuInit
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Close
 */
export function Multiplayer_MenuInit(context: ClientMenuContext): void {
  syncMenuVideo(context);

  const menu = context.state.s_multiplayer_menu;
  menu.x = context.vid.viddef.width * 0.5 - 64;
  resetMenuFramework(menu);

  const joinAction = context.state.s_join_network_server_action;
  joinAction.generic.type = MTYPE_ACTION;
  joinAction.generic.flags = QMF_LEFT_JUSTIFY;
  joinAction.generic.x = 0;
  joinAction.generic.y = 0;
  joinAction.generic.name = " join network server";
  joinAction.generic.callback = () => {
    JoinNetworkServerFunc(context);
  };

  const startAction = context.state.s_start_network_server_action;
  startAction.generic.type = MTYPE_ACTION;
  startAction.generic.flags = QMF_LEFT_JUSTIFY;
  startAction.generic.x = 0;
  startAction.generic.y = 10;
  startAction.generic.name = " start network server";
  startAction.generic.callback = () => {
    StartNetworkServerFunc(context);
  };

  const playerAction = context.state.s_player_setup_action;
  playerAction.generic.type = MTYPE_ACTION;
  playerAction.generic.flags = QMF_LEFT_JUSTIFY;
  playerAction.generic.x = 0;
  playerAction.generic.y = 20;
  playerAction.generic.name = " player setup";
  playerAction.generic.callback = () => {
    PlayerSetupFunc(context);
  };

  Menu_AddItem(context.qmenu, menu, joinAction);
  Menu_AddItem(context.qmenu, menu, startAction);
  Menu_AddItem(context.qmenu, menu, playerAction);
  Menu_SetStatusBar(context.qmenu, menu, null);
  Menu_Center(context.qmenu, menu);
}

/**
 * Original name: Multiplayer_MenuKey
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function Multiplayer_MenuKey(context: ClientMenuContext, key: number): string | null {
  return Default_MenuKey(context, context.state.s_multiplayer_menu, key);
}

/**
 * Original name: M_Menu_Multiplayer_f
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function M_Menu_Multiplayer_f(context: ClientMenuContext): void {
  Multiplayer_MenuInit(context);
  M_PushMenu(
    context,
    () => Multiplayer_MenuDraw(context),
    (key) => Multiplayer_MenuKey(context, key)
  );
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Keep discovered server addresses independent from caller-owned buffers.
 */
function cloneNetAdr(adr: netadr_t): netadr_t {
  return {
    type: adr.type,
    ip: new Uint8Array(adr.ip),
    ipx: new Uint8Array(adr.ipx),
    port: adr.port
  };
}

/**
 * Original name: M_AddToServerList
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Close
 */
export function M_AddToServerList(context: ClientMenuContext, adr: netadr_t, info: string): void {
  if (context.state.m_num_servers === MAX_LOCAL_SERVERS) {
    return;
  }

  const displayInfo = info.replace(/^ +/, "");

  for (let i = 0; i < context.state.m_num_servers; i += 1) {
    if (displayInfo === context.state.local_server_names[i]) {
      return;
    }
  }

  context.state.local_server_netadr[context.state.m_num_servers] = cloneNetAdr(adr);
  context.state.local_server_names[context.state.m_num_servers] = displayInfo.slice(0, 79);
  context.state.m_num_servers += 1;
}

/**
 * Original name: JoinServerFunc
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Close
 */
function JoinServerFunc(context: ClientMenuContext, self: unknown): void {
  const index = context.state.s_joinserver_server_actions.indexOf(self as import("./qmenu.js").menuaction_s);

  if (index < 0) {
    return;
  }

  if (context.state.local_server_names[index].toLowerCase() === NO_SERVER_STRING.toLowerCase()) {
    return;
  }

  if (index >= context.state.m_num_servers) {
    return;
  }

  const adr = context.state.local_server_netadr[index];
  if (!adr) {
    return;
  }

  Cbuf_AddText(context.cmd, `connect ${NET_AdrToString(adr)}\n`);
  M_ForceMenuOff(context);
}

/**
 * Original name: AddressBookFunc
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function AddressBookFunc(context: ClientMenuContext): void {
  M_Menu_AddressBook_f(context);
}

/**
 * Original name: SearchLocalGames
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Close
 */
function SearchLocalGames(context: ClientMenuContext): void {
  context.state.m_num_servers = 0;

  for (let i = 0; i < MAX_LOCAL_SERVERS; i += 1) {
    context.state.local_server_names[i] = NO_SERVER_STRING;
    context.state.local_server_netadr[i] = null;
  }

  M_DrawTextBox(context, 8, 120 - 48, 36, 3);
  M_Print(context, 16 + 16, 120 - 48 + 8, "Searching for local servers, this");
  M_Print(context, 16 + 16, 120 - 48 + 16, "could take up to a minute, so");
  M_Print(context, 16 + 16, 120 - 48 + 24, "please be patient.");
  context.ref.EndFrame();
  context.hooks.onPingServers?.();
}

/**
 * Original name: SearchLocalGamesFunc
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function SearchLocalGamesFunc(context: ClientMenuContext): void {
  SearchLocalGames(context);
}

/**
 * Original name: JoinServer_MenuInit
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Close
 */
export function JoinServer_MenuInit(context: ClientMenuContext): void {
  syncMenuVideo(context);

  const menu = context.state.s_joinserver_menu;
  menu.x = context.vid.viddef.width * 0.5 - 120;
  resetMenuFramework(menu);

  const addressBook = context.state.s_joinserver_address_book_action;
  addressBook.generic.type = MTYPE_ACTION;
  addressBook.generic.name = "address book";
  addressBook.generic.flags = QMF_LEFT_JUSTIFY;
  addressBook.generic.x = 0;
  addressBook.generic.y = 0;
  addressBook.generic.callback = () => {
    AddressBookFunc(context);
  };

  const search = context.state.s_joinserver_search_action;
  search.generic.type = MTYPE_ACTION;
  search.generic.name = "refresh server list";
  search.generic.flags = QMF_LEFT_JUSTIFY;
  search.generic.x = 0;
  search.generic.y = 10;
  search.generic.callback = () => {
    SearchLocalGamesFunc(context);
  };
  search.generic.statusbar = "search for servers";

  const title = context.state.s_joinserver_server_title;
  title.generic.type = MTYPE_SEPARATOR;
  title.generic.name = "connect to...";
  title.generic.x = 80;
  title.generic.y = 30;

  for (let i = 0; i < MAX_LOCAL_SERVERS; i += 1) {
    context.state.local_server_names[i] = NO_SERVER_STRING;

    const action = context.state.s_joinserver_server_actions[i];
    action.generic.type = MTYPE_ACTION;
    action.generic.name = context.state.local_server_names[i];
    action.generic.flags = QMF_LEFT_JUSTIFY;
    action.generic.x = 0;
    action.generic.y = 40 + i * 10;
    action.generic.callback = (self) => {
      JoinServerFunc(context, self);
    };
    action.generic.statusbar = "press ENTER to connect";
  }

  Menu_AddItem(context.qmenu, menu, addressBook);
  Menu_AddItem(context.qmenu, menu, title);
  Menu_AddItem(context.qmenu, menu, search);

  for (let i = 0; i < MAX_LOCAL_SERVERS; i += 1) {
    Menu_AddItem(context.qmenu, menu, context.state.s_joinserver_server_actions[i]);
  }

  Menu_Center(context.qmenu, menu);
  SearchLocalGames(context);
}

/**
 * Original name: JoinServer_MenuDraw
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Close
 */
function JoinServer_MenuDraw(context: ClientMenuContext): void {
  syncMenuVideo(context);
  M_Banner(context, "m_banner_join_server");
  for (let i = 0; i < MAX_LOCAL_SERVERS; i += 1) {
    context.state.s_joinserver_server_actions[i].generic.name = context.state.local_server_names[i];
  }
  Menu_Draw(context.qmenu, context.state.s_joinserver_menu);
}

/**
 * Original name: JoinServer_MenuKey
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function JoinServer_MenuKey(context: ClientMenuContext, key: number): string | null {
  return Default_MenuKey(context, context.state.s_joinserver_menu, key);
}

/**
 * Original name: M_Menu_JoinServer_f
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function M_Menu_JoinServer_f(context: ClientMenuContext): void {
  JoinServer_MenuInit(context);
  M_PushMenu(
    context,
    () => JoinServer_MenuDraw(context),
    (key) => JoinServer_MenuKey(context, key)
  );
}

/**
 * Original name: Developer_searchpath
 * Source: Quake-2-master/qcommon/files.c
 * Category: Adapter
 * Fidelity level: Adapter
 *
 * Porting notes:
 * - Routed through the menu context hook because filesystem search paths are owned outside this menu module.
 */
function Developer_searchpath(context: ClientMenuContext, who: number): number {
  return context.hooks.getDeveloperSearchpath?.(who) ?? 0;
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Preserve the start-server menu's non-negative numeric clamp without claiming the shared ClampCvar port.
 */
function clampStartServerValue(min: number, max: number, value: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Convert menu field buffers to C atoi-like integer values.
 */
function parseMenuInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Original name: DMOptionsFunc
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function DMOptionsFunc(context: ClientMenuContext): void {
  if (context.state.s_rules_box.curvalue === 1) {
    return;
  }

  M_Menu_DMOptions_f(context);
}

/**
 * Original name: RulesChangeFunc
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function RulesChangeFunc(context: ClientMenuContext): void {
  const rules = context.state.s_rules_box.curvalue;

  if (rules === 0) {
    context.state.s_maxclients_field.generic.statusbar = null;
    context.state.s_startserver_dmoptions_action.generic.statusbar = null;
    return;
  }

  if (rules === 1) {
    context.state.s_maxclients_field.generic.statusbar = "4 maximum for cooperative";
    if (parseMenuInt(context.state.s_maxclients_field.buffer) > 4) {
      context.state.s_maxclients_field.buffer = "4";
      context.state.s_maxclients_field.cursor = context.state.s_maxclients_field.buffer.length;
    }
    context.state.s_startserver_dmoptions_action.generic.statusbar = "N/A for cooperative";
    return;
  }

  if (Developer_searchpath(context, 2) === 2 && rules === 2) {
    context.state.s_maxclients_field.generic.statusbar = null;
    context.state.s_startserver_dmoptions_action.generic.statusbar = null;
  }
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Extract the map short name from the formatted menu label.
 */
function getStartMapName(context: ClientMenuContext): string {
  const selected = context.state.mapnames[context.state.s_startmap_list.curvalue] ?? "";
  const newline = selected.indexOf("\n");
  return newline >= 0 ? selected.slice(newline + 1) : selected;
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Isolate the original cooperative spawn-spot table used by StartServerActionFunc.
 */
function getCoopStartSpot(startmap: string): string | null {
  switch (startmap.toLowerCase()) {
    case "bunk1":
    case "mintro":
    case "fact1":
      return "start";
    case "power1":
      return "pstart";
    case "biggun":
      return "bstart";
    case "hangar1":
    case "city1":
      return "unitstart";
    case "boss1":
      return "bosstart";
    default:
      return null;
  }
}

/**
 * Original name: StartServerActionFunc
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Close
 */
function StartServerActionFunc(context: ClientMenuContext): void {
  const startmap = getStartMapName(context);
  const maxclients = parseMenuInt(context.state.s_maxclients_field.buffer);
  const timelimit = parseMenuInt(context.state.s_timelimit_field.buffer);
  const fraglimit = parseMenuInt(context.state.s_fraglimit_field.buffer);
  const rules = context.state.s_rules_box.curvalue;

  Cvar_SetValue(context.cvar, "maxclients", clampStartServerValue(0, maxclients, maxclients));
  Cvar_SetValue(context.cvar, "timelimit", clampStartServerValue(0, timelimit, timelimit));
  Cvar_SetValue(context.cvar, "fraglimit", clampStartServerValue(0, fraglimit, fraglimit));
  Cvar_Set(context.cvar, "hostname", context.state.s_hostname_field.buffer);

  if (rules < 2 || Developer_searchpath(context, 2) !== 2) {
    Cvar_SetValue(context.cvar, "deathmatch", Number(!rules));
    Cvar_SetValue(context.cvar, "coop", rules);
    Cvar_SetValue(context.cvar, "gamerules", 0);
  } else {
    Cvar_SetValue(context.cvar, "deathmatch", 1);
    Cvar_SetValue(context.cvar, "coop", 0);
    Cvar_SetValue(context.cvar, "gamerules", rules);
  }

  const spot = rules === 1 ? getCoopStartSpot(startmap) : null;
  if (spot) {
    if (getServerState(context)) {
      Cbuf_AddText(context.cmd, "disconnect\n");
    }
    Cbuf_AddText(context.cmd, `gamemap "*${startmap}$${spot}"\n`);
  } else {
    Cbuf_AddText(context.cmd, `map ${startmap}\n`);
  }

  M_ForceMenuOff(context);
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Convert the host-provided maps.lst entries into StartServer_MenuInit labels.
 */
function buildMapNames(context: ClientMenuContext): string[] {
  const entries = context.hooks.getMapList?.() ?? null;

  if (!entries || entries.length === 0) {
    menuError(context, "no maps in maps.lst");
  }

  return entries.map((entry) => `${entry.longName}\n${entry.shortName.toUpperCase()}`);
}

/**
 * Original name: StartServer_MenuInit
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Porting notes:
 * - Reads `maps.lst` through `getMapList` instead of direct host filesystem access.
 */
export function StartServer_MenuInit(context: ClientMenuContext): void {
  syncMenuVideo(context);

  const dmCoopNames = ["deathmatch", "cooperative", null];
  const dmCoopNamesRogue = ["deathmatch", "cooperative", "tag", null];

  context.state.mapnames = buildMapNames(context);
  context.state.nummaps = context.state.mapnames.length;

  const menu = context.state.s_startserver_menu;
  menu.x = context.vid.viddef.width * 0.5;
  resetMenuFramework(menu);

  const startmap = context.state.s_startmap_list;
  startmap.generic.type = MTYPE_SPINCONTROL;
  startmap.generic.x = 0;
  startmap.generic.y = 0;
  startmap.generic.name = "initial map";
  startmap.itemnames = [...context.state.mapnames, null];
  startmap.curvalue = 0;

  const rules = context.state.s_rules_box;
  rules.generic.type = MTYPE_SPINCONTROL;
  rules.generic.x = 0;
  rules.generic.y = 20;
  rules.generic.name = "rules";
  rules.itemnames = Developer_searchpath(context, 2) === 2 ? dmCoopNamesRogue : dmCoopNames;
  rules.curvalue = Cvar_VariableValue(context.cvar, "coop") ? 1 : 0;
  rules.generic.callback = () => {
    RulesChangeFunc(context);
  };

  const timelimit = context.state.s_timelimit_field;
  timelimit.generic.type = MTYPE_FIELD;
  timelimit.generic.name = "time limit";
  timelimit.generic.flags = QMF_NUMBERSONLY;
  timelimit.generic.x = 0;
  timelimit.generic.y = 36;
  timelimit.generic.statusbar = "0 = no limit";
  timelimit.length = 3;
  timelimit.visible_length = 3;
  timelimit.visible_offset = 0;
  timelimit.buffer = Cvar_VariableString(context.cvar, "timelimit");
  timelimit.cursor = timelimit.buffer.length;

  const fraglimit = context.state.s_fraglimit_field;
  fraglimit.generic.type = MTYPE_FIELD;
  fraglimit.generic.name = "frag limit";
  fraglimit.generic.flags = QMF_NUMBERSONLY;
  fraglimit.generic.x = 0;
  fraglimit.generic.y = 54;
  fraglimit.generic.statusbar = "0 = no limit";
  fraglimit.length = 3;
  fraglimit.visible_length = 3;
  fraglimit.visible_offset = 0;
  fraglimit.buffer = Cvar_VariableString(context.cvar, "fraglimit");
  fraglimit.cursor = fraglimit.buffer.length;

  const maxclients = context.state.s_maxclients_field;
  maxclients.generic.type = MTYPE_FIELD;
  maxclients.generic.name = "max players";
  maxclients.generic.flags = QMF_NUMBERSONLY;
  maxclients.generic.x = 0;
  maxclients.generic.y = 72;
  maxclients.generic.statusbar = null;
  maxclients.length = 3;
  maxclients.visible_length = 3;
  maxclients.visible_offset = 0;
  maxclients.buffer = Cvar_VariableValue(context.cvar, "maxclients") === 1
    ? "8"
    : Cvar_VariableString(context.cvar, "maxclients");
  maxclients.cursor = maxclients.buffer.length;

  const hostname = context.state.s_hostname_field;
  hostname.generic.type = MTYPE_FIELD;
  hostname.generic.name = "hostname";
  hostname.generic.flags = 0;
  hostname.generic.x = 0;
  hostname.generic.y = 90;
  hostname.generic.statusbar = null;
  hostname.length = 12;
  hostname.visible_length = 12;
  hostname.visible_offset = 0;
  hostname.buffer = Cvar_VariableString(context.cvar, "hostname");
  hostname.cursor = hostname.buffer.length;

  const dmoptions = context.state.s_startserver_dmoptions_action;
  dmoptions.generic.type = MTYPE_ACTION;
  dmoptions.generic.name = " deathmatch flags";
  dmoptions.generic.flags = QMF_LEFT_JUSTIFY;
  dmoptions.generic.x = 24;
  dmoptions.generic.y = 108;
  dmoptions.generic.statusbar = null;
  dmoptions.generic.callback = () => {
    DMOptionsFunc(context);
  };

  const start = context.state.s_startserver_start_action;
  start.generic.type = MTYPE_ACTION;
  start.generic.name = " begin";
  start.generic.flags = QMF_LEFT_JUSTIFY;
  start.generic.x = 24;
  start.generic.y = 128;
  start.generic.callback = () => {
    StartServerActionFunc(context);
  };

  Menu_AddItem(context.qmenu, menu, startmap);
  Menu_AddItem(context.qmenu, menu, rules);
  Menu_AddItem(context.qmenu, menu, timelimit);
  Menu_AddItem(context.qmenu, menu, fraglimit);
  Menu_AddItem(context.qmenu, menu, maxclients);
  Menu_AddItem(context.qmenu, menu, hostname);
  Menu_AddItem(context.qmenu, menu, dmoptions);
  Menu_AddItem(context.qmenu, menu, start);
  Menu_Center(context.qmenu, menu);

  RulesChangeFunc(context);
}

/**
 * Original name: StartServer_MenuDraw
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function StartServer_MenuDraw(context: ClientMenuContext): void {
  syncMenuVideo(context);
  Menu_Draw(context.qmenu, context.state.s_startserver_menu);
}

/**
 * Original name: StartServer_MenuKey
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function StartServer_MenuKey(context: ClientMenuContext, key: number): string | null {
  if (key === K_ESCAPE) {
    context.state.mapnames = [];
    context.state.nummaps = 0;
    context.state.s_startmap_list.itemnames = null;
  }

  return Default_MenuKey(context, context.state.s_startserver_menu, key);
}

/**
 * Original name: M_Menu_StartServer_f
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function M_Menu_StartServer_f(context: ClientMenuContext): void {
  StartServer_MenuInit(context);
  M_PushMenu(
    context,
    () => StartServer_MenuDraw(context),
    (key) => StartServer_MenuKey(context, key)
  );
}

/**
 * Original name: yes_no_names
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
const yes_no_names = ["no", "yes", null];

/**
 * Original name: teamplay_names
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
const teamplay_names = ["disabled", "by skin", "by model", null];

/**
 * Original name: DMFlagCallback
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function DMFlagCallback(context: ClientMenuContext, self: unknown): void {
  const f = self as menulist_s | null;
  let flags = Cvar_VariableValue(context.cvar, "dmflags");
  let bit = 0;

  if (f === context.state.s_friendlyfire_box) {
    if (f.curvalue) {
      flags &= ~DF_NO_FRIENDLY_FIRE;
    } else {
      flags |= DF_NO_FRIENDLY_FIRE;
    }
  } else if (f === context.state.s_falls_box) {
    if (f.curvalue) {
      flags &= ~DF_NO_FALLING;
    } else {
      flags |= DF_NO_FALLING;
    }
  } else if (f === context.state.s_weapons_stay_box) {
    bit = DF_WEAPONS_STAY;
  } else if (f === context.state.s_instant_powerups_box) {
    bit = DF_INSTANT_ITEMS;
  } else if (f === context.state.s_allow_exit_box) {
    bit = DF_ALLOW_EXIT;
  } else if (f === context.state.s_powerups_box) {
    if (f.curvalue) {
      flags &= ~DF_NO_ITEMS;
    } else {
      flags |= DF_NO_ITEMS;
    }
  } else if (f === context.state.s_health_box) {
    if (f.curvalue) {
      flags &= ~DF_NO_HEALTH;
    } else {
      flags |= DF_NO_HEALTH;
    }
  } else if (f === context.state.s_spawn_farthest_box) {
    bit = DF_SPAWN_FARTHEST;
  } else if (f === context.state.s_teamplay_box) {
    if (f.curvalue === 1) {
      flags |= DF_SKINTEAMS;
      flags &= ~DF_MODELTEAMS;
    } else if (f.curvalue === 2) {
      flags |= DF_MODELTEAMS;
      flags &= ~DF_SKINTEAMS;
    } else {
      flags &= ~(DF_MODELTEAMS | DF_SKINTEAMS);
    }
  } else if (f === context.state.s_samelevel_box) {
    bit = DF_SAME_LEVEL;
  } else if (f === context.state.s_force_respawn_box) {
    bit = DF_FORCE_RESPAWN;
  } else if (f === context.state.s_armor_box) {
    if (f.curvalue) {
      flags &= ~DF_NO_ARMOR;
    } else {
      flags |= DF_NO_ARMOR;
    }
  } else if (f === context.state.s_infinite_ammo_box) {
    bit = DF_INFINITE_AMMO;
  } else if (f === context.state.s_fixed_fov_box) {
    bit = DF_FIXED_FOV;
  } else if (f === context.state.s_quad_drop_box) {
    bit = DF_QUAD_DROP;
  } else if (Developer_searchpath(context, 2) === 2) {
    if (f === context.state.s_no_mines_box) {
      bit = DF_NO_MINES;
    } else if (f === context.state.s_no_nukes_box) {
      bit = DF_NO_NUKES;
    } else if (f === context.state.s_stack_double_box) {
      bit = DF_NO_STACK_DOUBLE;
    } else if (f === context.state.s_no_spheres_box) {
      bit = DF_NO_SPHERES;
    }
  }

  if (f && bit !== 0) {
    if (f.curvalue === 0) {
      flags &= ~bit;
    } else {
      flags |= bit;
    }
  }

  Cvar_SetValue(context.cvar, "dmflags", flags);
  context.state.dmoptions_statusbar = `dmflags = ${Math.trunc(flags)}`;
  context.state.s_dmoptions_menu.statusbar = context.state.dmoptions_statusbar;
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Share repeated DM options spin-control initialization.
 */
function initDmSpin(
  context: ClientMenuContext,
  item: menulist_s,
  name: string,
  y: number,
  curvalue: number,
  itemnames: Array<string | null> = yes_no_names
): void {
  item.generic.type = MTYPE_SPINCONTROL;
  item.generic.x = 0;
  item.generic.y = y;
  item.generic.name = name;
  item.generic.callback = (self) => {
    DMFlagCallback(context, self);
  };
  item.itemnames = itemnames;
  item.curvalue = curvalue;
}

/**
 * Original name: DMOptions_MenuInit
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function DMOptions_MenuInit(context: ClientMenuContext): void {
  syncMenuVideo(context);

  const dmflags = Cvar_VariableValue(context.cvar, "dmflags");
  let y = 0;
  const menu = context.state.s_dmoptions_menu;
  menu.x = context.vid.viddef.width * 0.5;
  resetMenuFramework(menu);

  initDmSpin(context, context.state.s_falls_box, "falling damage", y, (dmflags & DF_NO_FALLING) === 0 ? 1 : 0);
  initDmSpin(context, context.state.s_weapons_stay_box, "weapons stay", y += 10, (dmflags & DF_WEAPONS_STAY) !== 0 ? 1 : 0);
  initDmSpin(context, context.state.s_instant_powerups_box, "instant powerups", y += 10, (dmflags & DF_INSTANT_ITEMS) !== 0 ? 1 : 0);
  initDmSpin(context, context.state.s_powerups_box, "allow powerups", y += 10, (dmflags & DF_NO_ITEMS) === 0 ? 1 : 0);
  initDmSpin(context, context.state.s_health_box, "allow health", y += 10, (dmflags & DF_NO_HEALTH) === 0 ? 1 : 0);
  initDmSpin(context, context.state.s_armor_box, "allow armor", y += 10, (dmflags & DF_NO_ARMOR) === 0 ? 1 : 0);
  initDmSpin(context, context.state.s_spawn_farthest_box, "spawn farthest", y += 10, (dmflags & DF_SPAWN_FARTHEST) !== 0 ? 1 : 0);
  initDmSpin(context, context.state.s_samelevel_box, "same map", y += 10, (dmflags & DF_SAME_LEVEL) !== 0 ? 1 : 0);
  initDmSpin(context, context.state.s_force_respawn_box, "force respawn", y += 10, (dmflags & DF_FORCE_RESPAWN) !== 0 ? 1 : 0);

  let teamplay = 0;
  if ((dmflags & DF_SKINTEAMS) !== 0) {
    teamplay = 1;
  } else if ((dmflags & DF_MODELTEAMS) !== 0) {
    teamplay = 2;
  }
  initDmSpin(context, context.state.s_teamplay_box, "teamplay", y += 10, teamplay, teamplay_names);

  initDmSpin(context, context.state.s_allow_exit_box, "allow exit", y += 10, (dmflags & DF_ALLOW_EXIT) !== 0 ? 1 : 0);
  initDmSpin(context, context.state.s_infinite_ammo_box, "infinite ammo", y += 10, (dmflags & DF_INFINITE_AMMO) !== 0 ? 1 : 0);
  initDmSpin(context, context.state.s_fixed_fov_box, "fixed FOV", y += 10, (dmflags & DF_FIXED_FOV) !== 0 ? 1 : 0);
  initDmSpin(context, context.state.s_quad_drop_box, "quad drop", y += 10, (dmflags & DF_QUAD_DROP) !== 0 ? 1 : 0);
  initDmSpin(context, context.state.s_friendlyfire_box, "friendly fire", y += 10, (dmflags & DF_NO_FRIENDLY_FIRE) === 0 ? 1 : 0);

  if (Developer_searchpath(context, 2) === 2) {
    initDmSpin(context, context.state.s_no_mines_box, "remove mines", y += 10, (dmflags & DF_NO_MINES) !== 0 ? 1 : 0);
    initDmSpin(context, context.state.s_no_nukes_box, "remove nukes", y += 10, (dmflags & DF_NO_NUKES) !== 0 ? 1 : 0);
    initDmSpin(context, context.state.s_stack_double_box, "2x/4x stacking off", y += 10, (dmflags & DF_NO_STACK_DOUBLE) !== 0 ? 1 : 0);
    initDmSpin(context, context.state.s_no_spheres_box, "remove spheres", y += 10, (dmflags & DF_NO_SPHERES) !== 0 ? 1 : 0);
  }

  Menu_AddItem(context.qmenu, menu, context.state.s_falls_box);
  Menu_AddItem(context.qmenu, menu, context.state.s_weapons_stay_box);
  Menu_AddItem(context.qmenu, menu, context.state.s_instant_powerups_box);
  Menu_AddItem(context.qmenu, menu, context.state.s_powerups_box);
  Menu_AddItem(context.qmenu, menu, context.state.s_health_box);
  Menu_AddItem(context.qmenu, menu, context.state.s_armor_box);
  Menu_AddItem(context.qmenu, menu, context.state.s_spawn_farthest_box);
  Menu_AddItem(context.qmenu, menu, context.state.s_samelevel_box);
  Menu_AddItem(context.qmenu, menu, context.state.s_force_respawn_box);
  Menu_AddItem(context.qmenu, menu, context.state.s_teamplay_box);
  Menu_AddItem(context.qmenu, menu, context.state.s_allow_exit_box);
  Menu_AddItem(context.qmenu, menu, context.state.s_infinite_ammo_box);
  Menu_AddItem(context.qmenu, menu, context.state.s_fixed_fov_box);
  Menu_AddItem(context.qmenu, menu, context.state.s_quad_drop_box);
  Menu_AddItem(context.qmenu, menu, context.state.s_friendlyfire_box);

  if (Developer_searchpath(context, 2) === 2) {
    Menu_AddItem(context.qmenu, menu, context.state.s_no_mines_box);
    Menu_AddItem(context.qmenu, menu, context.state.s_no_nukes_box);
    Menu_AddItem(context.qmenu, menu, context.state.s_stack_double_box);
    Menu_AddItem(context.qmenu, menu, context.state.s_no_spheres_box);
  }

  Menu_Center(context.qmenu, menu);
  DMFlagCallback(context, null);
  Menu_SetStatusBar(context.qmenu, menu, context.state.dmoptions_statusbar);
}

/**
 * Original name: DMOptions_MenuDraw
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function DMOptions_MenuDraw(context: ClientMenuContext): void {
  syncMenuVideo(context);
  Menu_Draw(context.qmenu, context.state.s_dmoptions_menu);
}

/**
 * Original name: DMOptions_MenuKey
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function DMOptions_MenuKey(context: ClientMenuContext, key: number): string | null {
  return Default_MenuKey(context, context.state.s_dmoptions_menu, key);
}

/**
 * Original name: M_Menu_DMOptions_f
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function M_Menu_DMOptions_f(context: ClientMenuContext): void {
  DMOptions_MenuInit(context);
  M_PushMenu(
    context,
    () => DMOptions_MenuDraw(context),
    (key) => DMOptions_MenuKey(context, key)
  );
}

/**
 * Original name: DownloadCallback
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function DownloadCallback(context: ClientMenuContext, self: unknown): void {
  const f = self as menulist_s;

  if (f === context.state.s_allow_download_box) {
    Cvar_SetValue(context.cvar, "allow_download", f.curvalue);
  } else if (f === context.state.s_allow_download_maps_box) {
    Cvar_SetValue(context.cvar, "allow_download_maps", f.curvalue);
  } else if (f === context.state.s_allow_download_models_box) {
    Cvar_SetValue(context.cvar, "allow_download_models", f.curvalue);
  } else if (f === context.state.s_allow_download_players_box) {
    Cvar_SetValue(context.cvar, "allow_download_players", f.curvalue);
  } else if (f === context.state.s_allow_download_sounds_box) {
    Cvar_SetValue(context.cvar, "allow_download_sounds", f.curvalue);
  }
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Share repeated download options spin-control initialization.
 */
function initDownloadSpin(
  context: ClientMenuContext,
  item: menulist_s,
  name: string,
  y: number,
  cvarName: string
): void {
  item.generic.type = MTYPE_SPINCONTROL;
  item.generic.x = 0;
  item.generic.y = y;
  item.generic.name = name;
  item.generic.callback = (self) => {
    DownloadCallback(context, self);
  };
  item.itemnames = yes_no_names;
  item.curvalue = Cvar_VariableValue(context.cvar, cvarName) !== 0 ? 1 : 0;
}

/**
 * Original name: DownloadOptions_MenuInit
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function DownloadOptions_MenuInit(context: ClientMenuContext): void {
  syncMenuVideo(context);

  let y = 0;
  const menu = context.state.s_downloadoptions_menu;
  menu.x = context.vid.viddef.width * 0.5;
  resetMenuFramework(menu);

  const title = context.state.s_download_title;
  title.generic.type = MTYPE_SEPARATOR;
  title.generic.name = "Download Options";
  title.generic.x = 48;
  title.generic.y = y;

  initDownloadSpin(context, context.state.s_allow_download_box, "allow downloading", y += 20, "allow_download");
  initDownloadSpin(context, context.state.s_allow_download_maps_box, "maps", y += 20, "allow_download_maps");
  initDownloadSpin(context, context.state.s_allow_download_players_box, "player models/skins", y += 10, "allow_download_players");
  initDownloadSpin(context, context.state.s_allow_download_models_box, "models", y += 10, "allow_download_models");
  initDownloadSpin(context, context.state.s_allow_download_sounds_box, "sounds", y += 10, "allow_download_sounds");

  Menu_AddItem(context.qmenu, menu, title);
  Menu_AddItem(context.qmenu, menu, context.state.s_allow_download_box);
  Menu_AddItem(context.qmenu, menu, context.state.s_allow_download_maps_box);
  Menu_AddItem(context.qmenu, menu, context.state.s_allow_download_players_box);
  Menu_AddItem(context.qmenu, menu, context.state.s_allow_download_models_box);
  Menu_AddItem(context.qmenu, menu, context.state.s_allow_download_sounds_box);

  Menu_Center(context.qmenu, menu);

  if (menu.cursor === 0) {
    menu.cursor = 1;
  }
}

/**
 * Original name: DownloadOptions_MenuDraw
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function DownloadOptions_MenuDraw(context: ClientMenuContext): void {
  syncMenuVideo(context);
  Menu_Draw(context.qmenu, context.state.s_downloadoptions_menu);
}

/**
 * Original name: DownloadOptions_MenuKey
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function DownloadOptions_MenuKey(context: ClientMenuContext, key: number): string | null {
  return Default_MenuKey(context, context.state.s_downloadoptions_menu, key);
}

/**
 * Original name: M_Menu_DownloadOptions_f
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function M_Menu_DownloadOptions_f(context: ClientMenuContext): void {
  DownloadOptions_MenuInit(context);
  M_PushMenu(
    context,
    () => DownloadOptions_MenuDraw(context),
    (key) => DownloadOptions_MenuKey(context, key)
  );
}

/**
 * Original name: AddressBook_MenuInit
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Close
 */
export function AddressBook_MenuInit(context: ClientMenuContext): void {
  syncMenuVideo(context);

  const menu = context.state.s_addressbook_menu;
  menu.x = Math.trunc(context.vid.viddef.width / 2 - 142);
  menu.y = Math.trunc(context.vid.viddef.height / 2 - 58);
  resetMenuFramework(menu);

  for (let i = 0; i < NUM_ADDRESSBOOK_ENTRIES; i += 1) {
    const cvar = Cvar_Get(context.cvar, `adr${i}`, "", CVAR_ARCHIVE);
    const field = context.state.s_addressbook_fields[i];

    field.generic.type = MTYPE_FIELD;
    field.generic.name = null;
    field.generic.callback = null;
    field.generic.x = 0;
    field.generic.y = i * 18;
    field.generic.localdata[0] = i;
    field.cursor = 0;
    field.length = 60;
    field.visible_length = 30;
    field.visible_offset = 0;
    field.buffer = cvar?.string ?? "";

    Menu_AddItem(context.qmenu, menu, field);
  }
}

/**
 * Original name: AddressBook_MenuKey
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Close
 */
export function AddressBook_MenuKey(context: ClientMenuContext, key: number): string | null {
  if (key === K_ESCAPE) {
    for (let index = 0; index < NUM_ADDRESSBOOK_ENTRIES; index += 1) {
      Cvar_Set(context.cvar, `adr${index}`, context.state.s_addressbook_fields[index].buffer);
    }
  }

  return Default_MenuKey(context, context.state.s_addressbook_menu, key);
}

/**
 * Original name: AddressBook_MenuDraw
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function AddressBook_MenuDraw(context: ClientMenuContext): void {
  syncMenuVideo(context);
  M_Banner(context, "m_banner_addressbook");
  Menu_Draw(context.qmenu, context.state.s_addressbook_menu);
}

/**
 * Original name: M_Menu_AddressBook_f
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function M_Menu_AddressBook_f(context: ClientMenuContext): void {
  AddressBook_MenuInit(context);
  M_PushMenu(
    context,
    () => AddressBook_MenuDraw(context),
    (key) => AddressBook_MenuKey(context, key)
  );
}
