/**
 * File: menu-player-config.ts
 * Source: Quake II original / client/menu.c
 * Purpose: Port the player configuration menu block from `menu.c`.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Keep filesystem and renderer preview dependencies behind explicit hooks.
 */

import {
  CVAR_ARCHIVE,
  CVAR_USERINFO,
  Cvar_Get,
  Cvar_Set,
  Cvar_SetValue,
  Cvar_VariableString,
  Cvar_VariableValue,
  RDF_NOWORLDMODEL,
  RF_FULLBRIGHT
} from "../../qcommon/src/index.js";
import { K_ESCAPE } from "./keys.js";
import { M_DrawTextBox } from "./menu-draw.js";
import { Default_MenuKey, M_PushMenu } from "./menu-runtime.js";
import { M_Menu_DownloadOptions_f } from "./menu-multiplayer.js";
import {
  resetMenuFramework,
  syncMenuVideo,
  type ClientMenuContext,
  type PlayerModelInfo
} from "./menu-types.js";
import { createEntity, createRefDef } from "./ref.js";
import {
  Menu_AddItem,
  Menu_Center,
  Menu_Draw,
  Menu_SetStatusBar,
  MTYPE_ACTION,
  MTYPE_FIELD,
  MTYPE_SEPARATOR,
  MTYPE_SPINCONTROL,
  QMF_LEFT_JUSTIFY
} from "./qmenu.js";
import { CalcFov } from "./cl_view.js";

/**
 * Original name: MAX_DISPLAYNAME
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 */
const MAX_DISPLAYNAME = 16;

/**
 * Original name: MAX_PLAYERMODELS
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 */
const MAX_PLAYERMODELS = 1024;

/**
 * Original name: rate_tbl
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 */
const rate_tbl = [2500, 3200, 5000, 10000, 25000, 0];

/**
 * Original name: rate_names
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 */
const rate_names = ["28.8 Modem", "33.6 Modem", "Single ISDN", "Dual ISDN/Cable", "T1/LAN", "User defined", null];

/**
 * Original name: handedness
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 */
const handedness = ["right", "left", "center", null];

/**
 * Original name: DownloadOptionsFunc
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Opens the download-options menu from the player-config action.
 */
function DownloadOptionsFunc(context: ClientMenuContext): void {
  M_Menu_DownloadOptions_f(context);
}

/**
 * Original name: HandednessCallback
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Writes the current handedness spin-control value to the `hand` userinfo cvar.
 */
function HandednessCallback(context: ClientMenuContext): void {
  Cvar_SetValue(context.cvar, "hand", context.state.s_player_handedness_box.curvalue);
}

/**
 * Original name: RateCallback
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Writes the selected preset rate unless the "User defined" row is selected.
 */
function RateCallback(context: ClientMenuContext): void {
  if (context.state.s_player_rate_box.curvalue !== rate_tbl.length - 1) {
    Cvar_SetValue(context.cvar, "rate", rate_tbl[context.state.s_player_rate_box.curvalue] ?? 0);
  }
}

/**
 * Original name: ModelCallback
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Replaces the skin spin-control entries for the selected model and resets the skin cursor.
 */
function ModelCallback(context: ClientMenuContext): void {
  context.state.s_player_skin_box.itemnames = skinItemNames(context.state.s_pmi[context.state.s_player_model_box.curvalue]);
  context.state.s_player_skin_box.curvalue = 0;
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Normalize the player model records supplied by filesystem/browser hooks before menu use.
 */
function normalizePlayerModel(model: PlayerModelInfo): PlayerModelInfo | null {
  const directory = model.directory.trim();
  const skins = model.skins
    .map((skin) => stripExtension(stripPath(skin.trim())))
    .filter((skin) => skin.length > 0);

  if (!directory || skins.length === 0) {
    return null;
  }

  return {
    directory,
    displayname: (model.displayname ?? stripPath(directory)).slice(0, MAX_DISPLAYNAME - 1),
    skins
  };
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Extract a file or directory basename from slash- or backslash-delimited paths.
 */
function stripPath(value: string): string {
  const slash = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  return slash >= 0 ? value.slice(slash + 1) : value;
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Remove the final filename extension from hook-supplied skin names.
 */
function stripExtension(value: string): string {
  const dot = value.lastIndexOf(".");
  return dot >= 0 ? value.slice(0, dot) : value;
}

/**
 * Original name: PlayerConfig_ScanDirectories
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Porting notes:
 * - Uses `getPlayerModels` instead of direct `FS_NextPath`, `FS_ListFiles` and `Sys_FindFirst` access.
 */
export function PlayerConfig_ScanDirectories(context: ClientMenuContext): boolean {
  const models = context.hooks.getPlayerModels?.() ?? null;
  context.state.s_pmi = [];
  context.state.s_pmnames = [];
  context.state.s_numplayermodels = 0;

  if (!models) {
    return false;
  }

  for (const model of models.slice(0, MAX_PLAYERMODELS)) {
    const normalized = normalizePlayerModel(model);
    if (normalized) {
      context.state.s_pmi.push(normalized);
    }
  }

  context.state.s_numplayermodels = context.state.s_pmi.length;
  return context.state.s_numplayermodels !== 0;
}

/**
 * Original name: pmicmpfnc
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function pmicmpfnc(a: PlayerModelInfo, b: PlayerModelInfo): number {
  if (a.directory.toLowerCase() === "male") {
    return -1;
  }
  if (b.directory.toLowerCase() === "male") {
    return 1;
  }

  if (a.directory.toLowerCase() === "female") {
    return -1;
  }
  if (b.directory.toLowerCase() === "female") {
    return 1;
  }

  return a.directory.localeCompare(b.directory);
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Split the userinfo `skin` cvar into model directory and skin name with Quake II defaults.
 */
function splitSkin(value: string): { directory: string; skin: string } {
  const slash = value.search(/[\\/]/);
  if (slash >= 0) {
    return {
      directory: value.slice(0, slash),
      skin: value.slice(slash + 1)
    };
  }

  return {
    directory: "male",
    skin: "grunt"
  };
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Convert a normalized player model skin list into qmenu's null-terminated itemnames array.
 */
function skinItemNames(model: PlayerModelInfo | undefined): Array<string | null> | null {
  if (!model) {
    return null;
  }

  return [...model.skins, null];
}

/**
 * Original name: PlayerConfig_MenuInit
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Scans player models, selects the active `name`/`skin`/`hand`/`rate` cvars, and builds the player-config menu.
 *
 * Porting notes:
 * - Uses explicit menu context state instead of C globals and local buffers.
 */
export function PlayerConfig_MenuInit(context: ClientMenuContext): boolean {
  syncMenuVideo(context);

  Cvar_Get(context.cvar, "name", "unnamed", CVAR_USERINFO | CVAR_ARCHIVE);
  Cvar_Get(context.cvar, "skin", "male/grunt", CVAR_USERINFO | CVAR_ARCHIVE);
  const hand = Cvar_Get(context.cvar, "hand", "0", CVAR_USERINFO | CVAR_ARCHIVE);

  if (!PlayerConfig_ScanDirectories(context)) {
    return false;
  }

  if ((hand?.value ?? 0) < 0 || (hand?.value ?? 0) > 2) {
    Cvar_SetValue(context.cvar, "hand", 0);
  }

  const current = splitSkin(Cvar_VariableString(context.cvar, "skin"));
  let currentdirectoryindex = 0;
  let currentskinindex = 0;

  context.state.s_pmi.sort(pmicmpfnc);
  context.state.s_pmnames = [];

  for (let i = 0; i < context.state.s_numplayermodels; i += 1) {
    const model = context.state.s_pmi[i];
    context.state.s_pmnames[i] = model.displayname ?? model.directory;

    if (model.directory.toLowerCase() === current.directory.toLowerCase()) {
      currentdirectoryindex = i;

      for (let j = 0; j < model.skins.length; j += 1) {
        if (model.skins[j].toLowerCase() === current.skin.toLowerCase()) {
          currentskinindex = j;
          break;
        }
      }
    }
  }
  context.state.s_pmnames[context.state.s_numplayermodels] = null;

  const menu = context.state.s_player_config_menu;
  menu.x = Math.trunc(context.vid.viddef.width / 2 - 95);
  menu.y = Math.trunc(context.vid.viddef.height / 2 - 97);
  resetMenuFramework(menu);

  const name = context.state.s_player_name_field;
  name.generic.type = MTYPE_FIELD;
  name.generic.name = "name";
  name.generic.callback = null;
  name.generic.x = 0;
  name.generic.y = 0;
  name.length = 20;
  name.visible_length = 20;
  name.visible_offset = 0;
  name.buffer = Cvar_VariableString(context.cvar, "name");
  name.cursor = name.buffer.length;

  const modelTitle = context.state.s_player_model_title;
  modelTitle.generic.type = MTYPE_SEPARATOR;
  modelTitle.generic.name = "model";
  modelTitle.generic.x = -8;
  modelTitle.generic.y = 60;

  const modelBox = context.state.s_player_model_box;
  modelBox.generic.type = MTYPE_SPINCONTROL;
  modelBox.generic.x = -56;
  modelBox.generic.y = 70;
  modelBox.generic.callback = () => {
    ModelCallback(context);
  };
  modelBox.generic.cursor_offset = -48;
  modelBox.curvalue = currentdirectoryindex;
  modelBox.itemnames = context.state.s_pmnames;

  const skinTitle = context.state.s_player_skin_title;
  skinTitle.generic.type = MTYPE_SEPARATOR;
  skinTitle.generic.name = "skin";
  skinTitle.generic.x = -16;
  skinTitle.generic.y = 84;

  const skinBox = context.state.s_player_skin_box;
  skinBox.generic.type = MTYPE_SPINCONTROL;
  skinBox.generic.x = -56;
  skinBox.generic.y = 94;
  skinBox.generic.name = null;
  skinBox.generic.callback = null;
  skinBox.generic.cursor_offset = -48;
  skinBox.curvalue = currentskinindex;
  skinBox.itemnames = skinItemNames(context.state.s_pmi[currentdirectoryindex]);

  const handTitle = context.state.s_player_hand_title;
  handTitle.generic.type = MTYPE_SEPARATOR;
  handTitle.generic.name = "handedness";
  handTitle.generic.x = 32;
  handTitle.generic.y = 108;

  const handBox = context.state.s_player_handedness_box;
  handBox.generic.type = MTYPE_SPINCONTROL;
  handBox.generic.x = -56;
  handBox.generic.y = 118;
  handBox.generic.name = null;
  handBox.generic.cursor_offset = -48;
  handBox.generic.callback = () => {
    HandednessCallback(context);
  };
  handBox.curvalue = Math.trunc(Cvar_VariableValue(context.cvar, "hand"));
  handBox.itemnames = handedness;

  let rateIndex = 0;
  for (; rateIndex < rate_tbl.length - 1; rateIndex += 1) {
    if (Cvar_VariableValue(context.cvar, "rate") === rate_tbl[rateIndex]) {
      break;
    }
  }

  const rateTitle = context.state.s_player_rate_title;
  rateTitle.generic.type = MTYPE_SEPARATOR;
  rateTitle.generic.name = "connect speed";
  rateTitle.generic.x = 56;
  rateTitle.generic.y = 156;

  const rateBox = context.state.s_player_rate_box;
  rateBox.generic.type = MTYPE_SPINCONTROL;
  rateBox.generic.x = -56;
  rateBox.generic.y = 166;
  rateBox.generic.name = null;
  rateBox.generic.cursor_offset = -48;
  rateBox.generic.callback = () => {
    RateCallback(context);
  };
  rateBox.curvalue = rateIndex;
  rateBox.itemnames = rate_names;

  const download = context.state.s_player_download_action;
  download.generic.type = MTYPE_ACTION;
  download.generic.name = "download options";
  download.generic.flags = QMF_LEFT_JUSTIFY;
  download.generic.x = -24;
  download.generic.y = 186;
  download.generic.statusbar = null;
  download.generic.callback = () => {
    DownloadOptionsFunc(context);
  };

  Menu_AddItem(context.qmenu, menu, name);
  Menu_AddItem(context.qmenu, menu, modelTitle);
  Menu_AddItem(context.qmenu, menu, modelBox);
  if (skinBox.itemnames) {
    Menu_AddItem(context.qmenu, menu, skinTitle);
    Menu_AddItem(context.qmenu, menu, skinBox);
  }
  Menu_AddItem(context.qmenu, menu, handTitle);
  Menu_AddItem(context.qmenu, menu, handBox);
  Menu_AddItem(context.qmenu, menu, rateTitle);
  Menu_AddItem(context.qmenu, menu, rateBox);
  Menu_AddItem(context.qmenu, menu, download);

  return true;
}

/**
 * Original name: PlayerConfig_MenuDraw
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Draws the menu, renders the selected player model preview, and draws the selected skin icon.
 *
 * Porting notes:
 * - Keeps the preview refdef renderer-neutral, then calls `ref.RenderFrame` like the original renderer export.
 */
function PlayerConfig_MenuDraw(context: ClientMenuContext): void {
  syncMenuVideo(context);

  const model = context.state.s_pmi[context.state.s_player_model_box.curvalue];
  const skin = model?.skins[context.state.s_player_skin_box.curvalue];

  if (model && skin) {
    const refdef = createRefDef();
    refdef.x = Math.trunc(context.vid.viddef.width / 2);
    refdef.y = Math.trunc(context.vid.viddef.height / 2 - 72);
    refdef.width = 144;
    refdef.height = 168;
    refdef.fov_x = 40;
    refdef.fov_y = CalcFov(refdef.fov_x, refdef.width, refdef.height);
    refdef.time = context.client.cls.realtime * 0.001;

    const entity = createEntity();
    const modelPath = `players/${model.directory}/tris.md2`;
    const skinPath = `players/${model.directory}/${skin}.pcx`;
    const iconPath = `/players/${model.directory}/${skin}_i.pcx`;

    entity.model = context.ref.RegisterModel(modelPath);
    entity.skin = context.ref.RegisterSkin(skinPath);
    entity.flags = RF_FULLBRIGHT;
    entity.origin[0] = 80;
    entity.oldorigin[0] = entity.origin[0];
    entity.frame = 0;
    entity.oldframe = 0;
    entity.backlerp = 0.0;
    entity.angles[1] = context.state.player_config_yaw;
    context.state.player_config_yaw += 2;
    if (context.state.player_config_yaw > 360) {
      context.state.player_config_yaw -= 360;
    }

    refdef.num_entities = 1;
    refdef.entities = [entity];
    refdef.rdflags = RDF_NOWORLDMODEL;

    Menu_Draw(context.qmenu, context.state.s_player_config_menu);
    M_DrawTextBox(
      context,
      refdef.x * (320.0 / context.vid.viddef.width) - 8,
      (context.vid.viddef.height / 2) * (240.0 / context.vid.viddef.height) - 77,
      refdef.width / 8,
      refdef.height / 8
    );
    refdef.height += 4;

    context.ref.RenderFrame(refdef);
    context.hooks.onPlayerConfigPreview?.({ refdef, entity, modelPath, skinPath, iconPath });
    context.ref.DrawPic(context.state.s_player_config_menu.x - 40, refdef.y, iconPath);
  }
}

/**
 * Original name: FreeFileList
 * Source: Quake-2-master/client/menu.c
 * Category: Adapter
 * Fidelity level: Close
 *
 * Porting notes:
 * - JS garbage collection replaces the original allocation frees; this clears menu-owned temporary model arrays.
 */
function clearPlayerModels(context: ClientMenuContext): void {
  context.state.s_pmi = [];
  context.state.s_pmnames = [];
  context.state.s_numplayermodels = 0;
  context.state.s_player_model_box.itemnames = null;
  context.state.s_player_skin_box.itemnames = null;
}

/**
 * Original name: PlayerConfig_MenuKey
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - On Escape, persists `name` and `skin`, clears temporary player-model state, then delegates to `Default_MenuKey`.
 *
 * Porting notes:
 * - JS garbage collection replaces the original per-skin `free` loop.
 */
export function PlayerConfig_MenuKey(context: ClientMenuContext, key: number): string | null {
  if (key === K_ESCAPE) {
    const model = context.state.s_pmi[context.state.s_player_model_box.curvalue];
    const skin = model?.skins[context.state.s_player_skin_box.curvalue];

    Cvar_Set(context.cvar, "name", context.state.s_player_name_field.buffer);

    if (model && skin) {
      Cvar_Set(context.cvar, "skin", `${model.directory}/${skin}`);
    }

    clearPlayerModels(context);
  }

  return Default_MenuKey(context, context.state.s_player_config_menu, key);
}

/**
 * Original name: M_Menu_PlayerConfig_f
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes the player-config menu or reports missing models on the multiplayer status bar, then pushes draw/key handlers.
 */
export function M_Menu_PlayerConfig_f(context: ClientMenuContext): void {
  if (!PlayerConfig_MenuInit(context)) {
    Menu_SetStatusBar(context.qmenu, context.state.s_multiplayer_menu, "No valid player models found");
    return;
  }

  Menu_SetStatusBar(context.qmenu, context.state.s_multiplayer_menu, null);
  M_PushMenu(
    context,
    () => PlayerConfig_MenuDraw(context),
    (key) => PlayerConfig_MenuKey(context, key)
  );
}
