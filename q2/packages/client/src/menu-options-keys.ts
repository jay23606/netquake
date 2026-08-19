/**
 * File: menu-options-keys.ts
 * Source: Quake II original / client/menu.c
 * Purpose: Port the `keys` and `options` menu blocks from `menu.c`.
 */

import {
  Cbuf_AddText,
  Cbuf_Execute,
  Cbuf_InsertText,
  Cvar_Get,
  Cvar_SetValue,
  Cvar_VariableValue,
  CVAR_ARCHIVE
} from "../../qcommon/src/index.js";
import {
  K_BACKSPACE,
  K_CTRL,
  K_DEL,
  K_ENTER,
  K_ESCAPE,
  K_KP_DEL,
  K_KP_ENTER,
  Key_KeynumToString,
  Key_SetBinding,
  keydest_t
} from "./keys.js";
import { M_Banner, M_DrawTextBox, M_Print } from "./menu-draw.js";
import { M_ForceMenuOff, Default_MenuKey, M_PushMenu } from "./menu-runtime.js";
import { menu_in_sound, menu_out_sound, syncMenuVideo, resetMenuFramework } from "./menu-types.js";
import type { ClientMenuContext } from "./menu-types.js";
import {
  createMenuAction,
  Menu_AddItem,
  Menu_AdjustCursor,
  Menu_Center,
  Menu_Draw,
  Menu_ItemAtCursor,
  Menu_SetStatusBar,
  QMF_GRAYED,
  QMF_LEFT_JUSTIFY,
  MTYPE_ACTION,
  MTYPE_SLIDER,
  MTYPE_SPINCONTROL,
  QMenu_DrawChar,
  QMenu_DrawString
} from "./qmenu.js";

/**
 * Original name: bindnames
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
const bindnames: Array<[string, string]> = [
  ["+attack", "attack"],
  ["weapnext", "next weapon"],
  ["+forward", "walk forward"],
  ["+back", "backpedal"],
  ["+left", "turn left"],
  ["+right", "turn right"],
  ["+speed", "run"],
  ["+moveleft", "step left"],
  ["+moveright", "step right"],
  ["+strafe", "sidestep"],
  ["+lookup", "look up"],
  ["+lookdown", "look down"],
  ["centerview", "center view"],
  ["+mlook", "mouse look"],
  ["+klook", "keyboard look"],
  ["+moveup", "up / jump"],
  ["+movedown", "down / crouch"],
  ["inven", "inventory"],
  ["invuse", "use item"],
  ["invdrop", "drop item"],
  ["invprev", "prev item"],
  ["invnext", "next item"],
  ["cmd help", "help computer"]
];

/**
 * Original name: yesno_names
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
const yesno_names = ["no", "yes", null] as const;

/**
 * Original name: cd_music_items
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
const cd_music_items = ["disabled", "enabled", null] as const;

/**
 * Original name: quality_items
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
const quality_items = ["low", "high", null] as const;

/**
 * Original name: compatibility_items
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
const compatibility_items = ["max compatibility", "max performance", null] as const;

/**
 * Original name: crosshair_names
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
const crosshair_names = ["none", "cross", "dot", "angle", null] as const;

/**
 * Original name: M_UnbindCommand
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function M_UnbindCommand(context: ClientMenuContext, command: string): void {
  const length = command.length;

  for (let keynum = 0; keynum < context.keys.state.keybindings.length; keynum += 1) {
    const binding = context.keys.state.keybindings[keynum];
    if (!binding) {
      continue;
    }

    if (binding.slice(0, length) === command) {
      Key_SetBinding(context.keys, keynum, "");
    }
  }
}

/**
 * Original name: M_FindKeysForCommand
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function M_FindKeysForCommand(context: ClientMenuContext, command: string): [number, number] {
  const length = command.length;
  const matches: [number, number] = [-1, -1];
  let count = 0;

  for (let keynum = 0; keynum < context.keys.state.keybindings.length; keynum += 1) {
    const binding = context.keys.state.keybindings[keynum];
    if (!binding) {
      continue;
    }

    if (binding.slice(0, length) === command) {
      matches[count] = keynum;
      count += 1;
      if (count === 2) {
        break;
      }
    }
  }

  return matches;
}

/**
 * Original name: KeyCursorDrawFunc
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function KeyCursorDrawFunc(context: ClientMenuContext, menu: import("./qmenu.js").menuframework_s): void {
  if (context.state.bind_grab) {
    QMenu_DrawChar(context.qmenu, menu.x, menu.y + menu.cursor * 9, "=".charCodeAt(0));
  } else {
    QMenu_DrawChar(
      context.qmenu,
      menu.x,
      menu.y + menu.cursor * 9,
      12 + (Math.trunc(context.client.cls.realtime / 250) & 1)
    );
  }
}

/**
 * Original name: DrawKeyBindingFunc
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function DrawKeyBindingFunc(context: ClientMenuContext, self: unknown): void {
  const action = self as import("./qmenu.js").menuaction_s;
  const [command] = bindnames[action.generic.localdata[0]] ?? ["", ""];
  const keys = M_FindKeysForCommand(context, command);
  const baseX = action.generic.x + (action.generic.parent?.x ?? 0) + 16;
  const baseY = action.generic.y + (action.generic.parent?.y ?? 0);

  if (keys[0] === -1) {
    QMenu_DrawString(context.qmenu, baseX, baseY, "???");
    return;
  }

  const first = Key_KeynumToString(keys[0]);
  QMenu_DrawString(context.qmenu, baseX, baseY, first);

  if (keys[1] !== -1) {
    const offset = first.length * 8;
    QMenu_DrawString(context.qmenu, baseX + 8 + offset, baseY, "or");
    QMenu_DrawString(context.qmenu, baseX + 32 + offset, baseY, Key_KeynumToString(keys[1]));
  }
}

/**
 * Original name: KeyBindingFunc
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function KeyBindingFunc(context: ClientMenuContext, self: unknown): void {
  const action = self as import("./qmenu.js").menuaction_s;
  const [command] = bindnames[action.generic.localdata[0]] ?? ["", ""];
  const keys = M_FindKeysForCommand(context, command);

  if (keys[1] !== -1) {
    M_UnbindCommand(context, command);
  }

  context.state.bind_grab = true;
  Menu_SetStatusBar(context.qmenu, context.state.s_keys_menu, "press a key or button for this action");
}

/**
 * Original name: Keys_MenuInit
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Close
 */
export function Keys_MenuInit(context: ClientMenuContext): void {
  syncMenuVideo(context);

  const menu = context.state.s_keys_menu;
  menu.x = context.vid.viddef.width * 0.5;
  resetMenuFramework(menu);
  menu.cursordraw = (drawContext, currentMenu) => {
    KeyCursorDrawFunc(context, currentMenu);
  };

  let y = 0;
  for (let i = 0; i < bindnames.length; i += 1) {
    const action = context.state.s_keys_actions[i] ?? createMenuAction();
    context.state.s_keys_actions[i] = action;

    action.generic.type = MTYPE_ACTION;
    action.generic.flags = QMF_GRAYED;
    action.generic.x = 0;
    action.generic.y = y;
    action.generic.ownerdraw = (drawContext, self) => {
      DrawKeyBindingFunc(context, self);
    };
    action.generic.localdata[0] = i;
    action.generic.name = bindnames[i][1];

    Menu_AddItem(context.qmenu, menu, action);
    y += 9;
  }

  Menu_SetStatusBar(context.qmenu, menu, "enter to change, backspace to clear");
  Menu_Center(context.qmenu, menu);
}

/**
 * Original name: Keys_MenuDraw
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function Keys_MenuDraw(context: ClientMenuContext): void {
  syncMenuVideo(context);
  Menu_AdjustCursor(context.qmenu, context.state.s_keys_menu, 1);
  Menu_Draw(context.qmenu, context.state.s_keys_menu);
}

/**
 * Original name: Keys_MenuKey
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Close
 */
export function Keys_MenuKey(context: ClientMenuContext, key: number): string | null {
  const item = Menu_ItemAtCursor(context.qmenu, context.state.s_keys_menu) as import("./qmenu.js").menuaction_s | null;

  if (context.state.bind_grab) {
    if (key !== K_ESCAPE && key !== "`".charCodeAt(0) && item) {
      const command = bindnames[item.generic.localdata[0]]?.[0] ?? "";
      Cbuf_InsertText(context.cmd, `bind "${Key_KeynumToString(key)}" "${command}"\n`);
    }

    Menu_SetStatusBar(context.qmenu, context.state.s_keys_menu, "enter to change, backspace to clear");
    context.state.bind_grab = false;
    return menu_out_sound;
  }

  if (!item) {
    return Default_MenuKey(context, context.state.s_keys_menu, key);
  }

  switch (key) {
    case K_KP_ENTER:
    case K_ENTER:
      KeyBindingFunc(context, item);
      return menu_in_sound;
    case K_BACKSPACE:
    case K_DEL:
    case K_KP_DEL:
      M_UnbindCommand(context, bindnames[item.generic.localdata[0]]?.[0] ?? "");
      return menu_out_sound;
    default:
      return Default_MenuKey(context, context.state.s_keys_menu, key);
  }
}

/**
 * Original name: M_Menu_Keys_f
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Close
 */
export function M_Menu_Keys_f(context: ClientMenuContext): void {
  Keys_MenuInit(context);
  M_PushMenu(
    context,
    () => Keys_MenuDraw(context),
    (key) => Keys_MenuKey(context, key)
  );
}

/**
 * Original name: CrosshairFunc
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function CrosshairFunc(context: ClientMenuContext): void {
  Cvar_SetValue(context.cvar, "crosshair", context.state.s_options_crosshair_box.curvalue);
}

/**
 * Original name: JoystickFunc
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function JoystickFunc(context: ClientMenuContext): void {
  Cvar_SetValue(context.cvar, "in_joystick", context.state.s_options_joystick_box.curvalue);
}

/**
 * Original name: CustomizeControlsFunc
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function CustomizeControlsFunc(context: ClientMenuContext): void {
  M_Menu_Keys_f(context);
}

/**
 * Original name: AlwaysRunFunc
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function AlwaysRunFunc(context: ClientMenuContext): void {
  Cvar_SetValue(context.cvar, "cl_run", context.state.s_options_alwaysrun_box.curvalue);
}

/**
 * Original name: FreeLookFunc
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function FreeLookFunc(context: ClientMenuContext): void {
  Cvar_SetValue(context.cvar, "freelook", context.state.s_options_freelook_box.curvalue);
}

/**
 * Original name: MouseSpeedFunc
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function MouseSpeedFunc(context: ClientMenuContext): void {
  Cvar_SetValue(context.cvar, "sensitivity", context.state.s_options_sensitivity_slider.curvalue / 2.0);
}

/**
 * Original name: ClampCvar
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function ClampCvar(min: number, max: number, value: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

/**
 * Original name: ControlsSetMenuItemValues
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Close
 */
function ControlsSetMenuItemValues(context: ClientMenuContext): void {
  context.state.s_options_sfxvolume_slider.curvalue = Cvar_VariableValue(context.cvar, "s_volume") * 10;
  context.state.s_options_cdvolume_box.curvalue = Number(!Cvar_VariableValue(context.cvar, "cd_nocd"));
  context.state.s_options_quality_list.curvalue = Number(!Cvar_VariableValue(context.cvar, "s_loadas8bit"));
  context.state.s_options_sensitivity_slider.curvalue = Cvar_VariableValue(context.cvar, "sensitivity") * 2;

  Cvar_SetValue(context.cvar, "cl_run", ClampCvar(0, 1, Cvar_VariableValue(context.cvar, "cl_run")));
  context.state.s_options_alwaysrun_box.curvalue = Cvar_VariableValue(context.cvar, "cl_run");

  context.state.s_options_invertmouse_box.curvalue = Cvar_VariableValue(context.cvar, "m_pitch") < 0 ? 1 : 0;

  Cvar_SetValue(context.cvar, "lookspring", ClampCvar(0, 1, Cvar_VariableValue(context.cvar, "lookspring")));
  context.state.s_options_lookspring_box.curvalue = Cvar_VariableValue(context.cvar, "lookspring");

  Cvar_SetValue(context.cvar, "lookstrafe", ClampCvar(0, 1, Cvar_VariableValue(context.cvar, "lookstrafe")));
  context.state.s_options_lookstrafe_box.curvalue = Cvar_VariableValue(context.cvar, "lookstrafe");

  Cvar_SetValue(context.cvar, "freelook", ClampCvar(0, 1, Cvar_VariableValue(context.cvar, "freelook")));
  context.state.s_options_freelook_box.curvalue = Cvar_VariableValue(context.cvar, "freelook");

  Cvar_SetValue(context.cvar, "crosshair", ClampCvar(0, 3, Cvar_VariableValue(context.cvar, "crosshair")));
  context.state.s_options_crosshair_box.curvalue = Cvar_VariableValue(context.cvar, "crosshair");

  Cvar_SetValue(context.cvar, "in_joystick", ClampCvar(0, 1, Cvar_VariableValue(context.cvar, "in_joystick")));
  context.state.s_options_joystick_box.curvalue = Cvar_VariableValue(context.cvar, "in_joystick");

  context.state.s_options_noalttab_box.curvalue = Cvar_VariableValue(context.cvar, "win_noalttab");
}

/**
 * Original name: ControlsResetDefaultsFunc
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Close
 */
function ControlsResetDefaultsFunc(context: ClientMenuContext): void {
  Cbuf_AddText(context.cmd, "exec default.cfg\n");
  Cbuf_Execute(context.cmd);
  ControlsSetMenuItemValues(context);
}

/**
 * Original name: InvertMouseFunc
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function InvertMouseFunc(context: ClientMenuContext): void {
  const pitch = Cvar_VariableValue(context.cvar, "m_pitch");
  if (context.state.s_options_invertmouse_box.curvalue === 0) {
    Cvar_SetValue(context.cvar, "m_pitch", Math.abs(pitch));
  } else {
    Cvar_SetValue(context.cvar, "m_pitch", -Math.abs(pitch));
  }
}

/**
 * Original name: LookspringFunc
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function LookspringFunc(context: ClientMenuContext): void {
  Cvar_SetValue(context.cvar, "lookspring", context.state.s_options_lookspring_box.curvalue);
}

/**
 * Original name: LookstrafeFunc
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function LookstrafeFunc(context: ClientMenuContext): void {
  Cvar_SetValue(context.cvar, "lookstrafe", context.state.s_options_lookstrafe_box.curvalue);
}

/**
 * Original name: UpdateVolumeFunc
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function UpdateVolumeFunc(context: ClientMenuContext): void {
  Cvar_SetValue(context.cvar, "s_volume", context.state.s_options_sfxvolume_slider.curvalue / 10);
}

/**
 * Original name: UpdateCDVolumeFunc
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function UpdateCDVolumeFunc(context: ClientMenuContext): void {
  Cvar_SetValue(context.cvar, "cd_nocd", Number(!context.state.s_options_cdvolume_box.curvalue));
}

/**
 * Original name: ConsoleFunc
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Close
 */
function ConsoleFunc(context: ClientMenuContext): void {
  if (context.client.cl.attractloop) {
    Cbuf_AddText(context.cmd, "killserver\n");
    return;
  }

  context.hooks.onClearTyping?.();
  context.hooks.onClearNotify?.();

  M_ForceMenuOff(context);
  context.keys.state.key_dest = keydest_t.key_console;
}

/**
 * Original name: UpdateSoundQualityFunc
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Close
 */
function UpdateSoundQualityFunc(context: ClientMenuContext): void {
  if (context.state.s_options_quality_list.curvalue) {
    Cvar_SetValue(context.cvar, "s_khz", 22);
    Cvar_SetValue(context.cvar, "s_loadas8bit", 0);
  } else {
    Cvar_SetValue(context.cvar, "s_khz", 11);
    Cvar_SetValue(context.cvar, "s_loadas8bit", 1);
  }

  Cvar_SetValue(context.cvar, "s_primary", context.state.s_options_compatibility_list.curvalue);

  M_DrawTextBox(context, 8, 120 - 48, 36, 3);
  M_Print(context, 32, 80, "Restarting the sound system. This");
  M_Print(context, 32, 88, "could take up to a minute, so");
  M_Print(context, 32, 96, "please be patient.");

  context.ref.EndFrame();
  context.hooks.onSoundRestart?.();
}

/**
 * Original name: Options_MenuInit
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Close
 */
export function Options_MenuInit(context: ClientMenuContext): void {
  syncMenuVideo(context);
  Cvar_Get(context.cvar, "win_noalttab", "0", CVAR_ARCHIVE);

  const menu = context.state.s_options_menu;
  resetMenuFramework(menu);
  menu.x = Math.trunc(context.vid.viddef.width / 2);
  menu.y = Math.trunc(context.vid.viddef.height / 2 - 58);

  const sfx = context.state.s_options_sfxvolume_slider;
  sfx.generic.type = MTYPE_SLIDER;
  sfx.generic.x = 0;
  sfx.generic.y = 0;
  sfx.generic.name = "effects volume";
  sfx.generic.callback = () => UpdateVolumeFunc(context);
  sfx.minvalue = 0;
  sfx.maxvalue = 10;

  const cd = context.state.s_options_cdvolume_box;
  cd.generic.type = MTYPE_SPINCONTROL;
  cd.generic.x = 0;
  cd.generic.y = 10;
  cd.generic.name = "CD music";
  cd.generic.callback = () => UpdateCDVolumeFunc(context);
  cd.itemnames = [...cd_music_items];

  const quality = context.state.s_options_quality_list;
  quality.generic.type = MTYPE_SPINCONTROL;
  quality.generic.x = 0;
  quality.generic.y = 20;
  quality.generic.name = "sound quality";
  quality.generic.callback = () => UpdateSoundQualityFunc(context);
  quality.itemnames = [...quality_items];

  const compatibility = context.state.s_options_compatibility_list;
  compatibility.generic.type = MTYPE_SPINCONTROL;
  compatibility.generic.x = 0;
  compatibility.generic.y = 30;
  compatibility.generic.name = "sound compatibility";
  compatibility.generic.callback = () => UpdateSoundQualityFunc(context);
  compatibility.itemnames = [...compatibility_items];

  const sensitivity = context.state.s_options_sensitivity_slider;
  sensitivity.generic.type = MTYPE_SLIDER;
  sensitivity.generic.x = 0;
  sensitivity.generic.y = 50;
  sensitivity.generic.name = "mouse speed";
  sensitivity.generic.callback = () => MouseSpeedFunc(context);
  sensitivity.minvalue = 2;
  sensitivity.maxvalue = 22;

  const alwaysRun = context.state.s_options_alwaysrun_box;
  alwaysRun.generic.type = MTYPE_SPINCONTROL;
  alwaysRun.generic.x = 0;
  alwaysRun.generic.y = 60;
  alwaysRun.generic.name = "always run";
  alwaysRun.generic.callback = () => AlwaysRunFunc(context);
  alwaysRun.itemnames = [...yesno_names];

  const invert = context.state.s_options_invertmouse_box;
  invert.generic.type = MTYPE_SPINCONTROL;
  invert.generic.x = 0;
  invert.generic.y = 70;
  invert.generic.name = "invert mouse";
  invert.generic.callback = () => InvertMouseFunc(context);
  invert.itemnames = [...yesno_names];

  const spring = context.state.s_options_lookspring_box;
  spring.generic.type = MTYPE_SPINCONTROL;
  spring.generic.x = 0;
  spring.generic.y = 80;
  spring.generic.name = "lookspring";
  spring.generic.callback = () => LookspringFunc(context);
  spring.itemnames = [...yesno_names];

  const strafe = context.state.s_options_lookstrafe_box;
  strafe.generic.type = MTYPE_SPINCONTROL;
  strafe.generic.x = 0;
  strafe.generic.y = 90;
  strafe.generic.name = "lookstrafe";
  strafe.generic.callback = () => LookstrafeFunc(context);
  strafe.itemnames = [...yesno_names];

  const freelook = context.state.s_options_freelook_box;
  freelook.generic.type = MTYPE_SPINCONTROL;
  freelook.generic.x = 0;
  freelook.generic.y = 100;
  freelook.generic.name = "free look";
  freelook.generic.callback = () => FreeLookFunc(context);
  freelook.itemnames = [...yesno_names];

  const crosshair = context.state.s_options_crosshair_box;
  crosshair.generic.type = MTYPE_SPINCONTROL;
  crosshair.generic.x = 0;
  crosshair.generic.y = 110;
  crosshair.generic.name = "crosshair";
  crosshair.generic.callback = () => CrosshairFunc(context);
  crosshair.itemnames = [...crosshair_names];

  const joystick = context.state.s_options_joystick_box;
  joystick.generic.type = MTYPE_SPINCONTROL;
  joystick.generic.x = 0;
  joystick.generic.y = 120;
  joystick.generic.name = "use joystick";
  joystick.generic.callback = () => JoystickFunc(context);
  joystick.itemnames = [...yesno_names];

  const customize = context.state.s_options_customize_options_action;
  customize.generic.type = MTYPE_ACTION;
  customize.generic.x = 0;
  customize.generic.y = 140;
  customize.generic.name = "customize controls";
  customize.generic.callback = () => CustomizeControlsFunc(context);

  const defaults = context.state.s_options_defaults_action;
  defaults.generic.type = MTYPE_ACTION;
  defaults.generic.x = 0;
  defaults.generic.y = 150;
  defaults.generic.name = "reset defaults";
  defaults.generic.callback = () => ControlsResetDefaultsFunc(context);

  const consoleAction = context.state.s_options_console_action;
  consoleAction.generic.type = MTYPE_ACTION;
  consoleAction.generic.x = 0;
  consoleAction.generic.y = 160;
  consoleAction.generic.name = "go to console";
  consoleAction.generic.callback = () => ConsoleFunc(context);

  ControlsSetMenuItemValues(context);

  Menu_AddItem(context.qmenu, menu, sfx);
  Menu_AddItem(context.qmenu, menu, cd);
  Menu_AddItem(context.qmenu, menu, quality);
  Menu_AddItem(context.qmenu, menu, compatibility);
  Menu_AddItem(context.qmenu, menu, sensitivity);
  Menu_AddItem(context.qmenu, menu, alwaysRun);
  Menu_AddItem(context.qmenu, menu, invert);
  Menu_AddItem(context.qmenu, menu, spring);
  Menu_AddItem(context.qmenu, menu, strafe);
  Menu_AddItem(context.qmenu, menu, freelook);
  Menu_AddItem(context.qmenu, menu, crosshair);
  Menu_AddItem(context.qmenu, menu, joystick);
  Menu_AddItem(context.qmenu, menu, customize);
  Menu_AddItem(context.qmenu, menu, defaults);
  Menu_AddItem(context.qmenu, menu, consoleAction);
}

/**
 * Original name: Options_MenuDraw
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function Options_MenuDraw(context: ClientMenuContext): void {
  syncMenuVideo(context);
  M_Banner(context, "m_banner_options");
  Menu_AdjustCursor(context.qmenu, context.state.s_options_menu, 1);
  Menu_Draw(context.qmenu, context.state.s_options_menu);
}

/**
 * Original name: Options_MenuKey
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function Options_MenuKey(context: ClientMenuContext, key: number): string | null {
  return Default_MenuKey(context, context.state.s_options_menu, key);
}

/**
 * Original name: M_Menu_Options_f
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Close
 */
export function M_Menu_Options_f(context: ClientMenuContext): void {
  Options_MenuInit(context);
  M_PushMenu(
    context,
    () => Options_MenuDraw(context),
    (key) => Options_MenuKey(context, key)
  );
}
