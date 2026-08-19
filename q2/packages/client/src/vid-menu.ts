/**
 * File: vid-menu.ts
 * Source: Quake II original / win32/vid_menu.c
 * Purpose: Port the Win32 video menu implementation behind the `VID_Menu*` hooks.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses an explicit controller object instead of file-static globals.
 * - Applies renderer/video changes to cvars and leaves actual backend reconfiguration to adapter hooks.
 *
 * Notes:
 * - This file is intended to stay close to the original `win32/vid_menu.c` menu behavior.
 */

import {
  Cvar_Set,
  Cvar_SetValue,
  Cvar_VariableString,
  Cvar_VariableValue
} from "../../qcommon/src/index.js";
import {
  K_DOWNARROW,
  K_ENTER,
  K_ESCAPE,
  K_KP_DOWNARROW,
  K_KP_ENTER,
  K_KP_LEFTARROW,
  K_KP_RIGHTARROW,
  K_KP_UPARROW,
  K_LEFTARROW,
  K_RIGHTARROW,
  K_UPARROW
} from "./keys.js";
import { M_ForceMenuOff, M_PopMenu } from "./menu-runtime.js";
import type { ClientMenuContext } from "./menu-types.js";
import {
  MTYPE_ACTION,
  MTYPE_SLIDER,
  MTYPE_SPINCONTROL,
  Menu_AddItem,
  Menu_AdjustCursor,
  Menu_Center,
  Menu_Draw,
  Menu_SelectItem,
  Menu_SlideItem,
  createMenuAction,
  createMenuFramework,
  createMenuList,
  createMenuSlider,
  type menuaction_s,
  type menuframework_s,
  type menulist_s,
  type menuslider_s
} from "./qmenu.js";

/**
 * Original name: SOFTWARE_MENU
 * Source: Quake-2-master/win32/vid_menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
const SOFTWARE_MENU = 0;

/**
 * Original name: OPENGL_MENU
 * Source: Quake-2-master/win32/vid_menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
const OPENGL_MENU = 1;

/**
 * Original name: REF_SOFT
 * Source: Quake-2-master/win32/vid_menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
const REF_SOFT = 0;

/**
 * Original name: REF_OPENGL
 * Source: Quake-2-master/win32/vid_menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
const REF_OPENGL = 1;

/**
 * Original name: REF_3DFX
 * Source: Quake-2-master/win32/vid_menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
const REF_3DFX = 2;

/**
 * Original name: REF_POWERVR
 * Source: Quake-2-master/win32/vid_menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
const REF_POWERVR = 3;

/**
 * Original name: N/A
 * Source: N/A (TypeScript adapter hooks for win32/vid_menu.c side effects)
 * Category: New
 * Purpose: Describe host callbacks for side effects outside the original menu cvar updates.
 */
export interface ClientVidMenuHooks {
  onApplyChanges?: () => void;
}

/**
 * Original name: N/A
 * Source: N/A (TypeScript controller adapter for win32/vid_menu.c)
 * Category: New
 * Purpose: Carry the callable `VID_Menu*` implementation used by `vid.ts` hooks.
 */
export interface ClientVidMenuController {
  VID_MenuInit: () => void;
  VID_MenuDraw: () => void;
  VID_MenuKey: (key: number) => string | null;
  syncMenuOrigins: (viewportWidth: number, viewportHeight: number) => () => void;
}

/**
 * Original name: N/A
 * Source: N/A (TypeScript controller factory for win32/vid_menu.c)
 * Category: New
 * Purpose: Create a ported `win32/vid_menu.c` controller bound to one client menu context.
 */
export function createClientVidMenuController(
  context: ClientMenuContext,
  hooks: ClientVidMenuHooks = {}
): ClientVidMenuController {
  const resolutions = [
    "[320 240  ]",
    "[400 300  ]",
    "[512 384  ]",
    "[640 480  ]",
    "[800 600  ]",
    "[960 720  ]",
    "[1024 768 ]",
    "[1152 864 ]",
    "[1280 960 ]",
    "[1600 1200]",
    null
  ];
  const refs = [
    "[software      ]",
    "[default OpenGL]",
    "[3Dfx OpenGL   ]",
    "[PowerVR OpenGL]",
    null
  ];
  const yesNo = ["no", "yes", null];

  const softwareMenu = createMenuFramework();
  const openglMenu = createMenuFramework();
  const modeList: [menulist_s, menulist_s] = [createMenuList(MTYPE_SPINCONTROL), createMenuList(MTYPE_SPINCONTROL)];
  const refList: [menulist_s, menulist_s] = [createMenuList(MTYPE_SPINCONTROL), createMenuList(MTYPE_SPINCONTROL)];
  const screenSizeSlider: [menuslider_s, menuslider_s] = [createMenuSlider(), createMenuSlider()];
  const brightnessSlider: [menuslider_s, menuslider_s] = [createMenuSlider(), createMenuSlider()];
  const fullscreenBox: [menulist_s, menulist_s] = [createMenuList(MTYPE_SPINCONTROL), createMenuList(MTYPE_SPINCONTROL)];
  const defaultsAction: [menuaction_s, menuaction_s] = [createMenuAction(), createMenuAction()];
  const cancelAction: [menuaction_s, menuaction_s] = [createMenuAction(), createMenuAction()];
  const stippleBox = createMenuList(MTYPE_SPINCONTROL);
  const textureQualitySlider = createMenuSlider();
  const palettedTextureBox = createMenuList(MTYPE_SPINCONTROL);
  const finishBox = createMenuList(MTYPE_SPINCONTROL);

  let currentMenu = openglMenu;
  let currentMenuIndex = OPENGL_MENU;

  function DriverCallback(): void {
    refList[1 - currentMenuIndex].curvalue = refList[currentMenuIndex].curvalue;

    if (refList[currentMenuIndex].curvalue === REF_SOFT) {
      currentMenu = softwareMenu;
      currentMenuIndex = SOFTWARE_MENU;
      return;
    }

    currentMenu = openglMenu;
    currentMenuIndex = OPENGL_MENU;
  }

  function ScreenSizeCallback(slider: menuslider_s): void {
    Cvar_SetValue(context.cvar, "viewsize", slider.curvalue * 10);
  }

  function BrightnessCallback(slider: menuslider_s): void {
    brightnessSlider[1 - currentMenuIndex].curvalue = brightnessSlider[currentMenuIndex].curvalue;

    if (Cvar_VariableString(context.cvar, "vid_ref").toLowerCase() === "soft") {
      const gamma = (0.8 - (slider.curvalue / 10.0 - 0.5)) + 0.5;
      Cvar_SetValue(context.cvar, "vid_gamma", gamma);
    }
  }

  function ResetDefaults(): void {
    VID_MenuInit();
  }

  function ApplyChanges(): void {
    fullscreenBox[1 - currentMenuIndex].curvalue = fullscreenBox[currentMenuIndex].curvalue;
    brightnessSlider[1 - currentMenuIndex].curvalue = brightnessSlider[currentMenuIndex].curvalue;
    refList[1 - currentMenuIndex].curvalue = refList[currentMenuIndex].curvalue;

    const gamma = (0.8 - (brightnessSlider[currentMenuIndex].curvalue / 10.0 - 0.5)) + 0.5;
    Cvar_SetValue(context.cvar, "vid_gamma", gamma);
    Cvar_SetValue(context.cvar, "sw_stipplealpha", stippleBox.curvalue);
    Cvar_SetValue(context.cvar, "gl_picmip", 3 - textureQualitySlider.curvalue);
    Cvar_SetValue(context.cvar, "vid_fullscreen", fullscreenBox[currentMenuIndex].curvalue);
    Cvar_SetValue(context.cvar, "gl_ext_palettedtexture", palettedTextureBox.curvalue);
    Cvar_SetValue(context.cvar, "gl_finish", finishBox.curvalue);
    Cvar_SetValue(context.cvar, "sw_mode", modeList[SOFTWARE_MENU].curvalue);
    Cvar_SetValue(context.cvar, "gl_mode", modeList[OPENGL_MENU].curvalue);

    switch (refList[currentMenuIndex].curvalue) {
      case REF_SOFT:
        Cvar_Set(context.cvar, "vid_ref", "soft");
        break;
      case REF_3DFX:
        Cvar_Set(context.cvar, "vid_ref", "gl");
        Cvar_Set(context.cvar, "gl_driver", "3dfxgl");
        break;
      case REF_POWERVR:
        Cvar_Set(context.cvar, "vid_ref", "gl");
        Cvar_Set(context.cvar, "gl_driver", "pvrgl");
        break;
      case REF_OPENGL:
      default:
        Cvar_Set(context.cvar, "vid_ref", "gl");
        Cvar_Set(context.cvar, "gl_driver", "opengl32");
        break;
    }

    hooks.onApplyChanges?.();
    M_ForceMenuOff(context);
  }

  function CancelChanges(): void {
    M_PopMenu(context);
  }

  function configureSharedItem(index: number): void {
    const refItem = refList[index];
    refItem.generic.type = MTYPE_SPINCONTROL;
    refItem.generic.name = "driver";
    refItem.generic.x = 0;
    refItem.generic.y = 0;
    refItem.generic.callback = DriverCallback;
    refItem.itemnames = refs;

    const modeItem = modeList[index];
    modeItem.generic.type = MTYPE_SPINCONTROL;
    modeItem.generic.name = "video mode";
    modeItem.generic.x = 0;
    modeItem.generic.y = 10;
    modeItem.itemnames = resolutions;

    const screenSize = screenSizeSlider[index];
    screenSize.generic.type = MTYPE_SLIDER;
    screenSize.generic.x = 0;
    screenSize.generic.y = 20;
    screenSize.generic.name = "screen size";
    screenSize.generic.callback = () => ScreenSizeCallback(screenSize);
    screenSize.minvalue = 3;
    screenSize.maxvalue = 12;

    const brightness = brightnessSlider[index];
    brightness.generic.type = MTYPE_SLIDER;
    brightness.generic.x = 0;
    brightness.generic.y = 30;
    brightness.generic.name = "brightness";
    brightness.generic.callback = () => BrightnessCallback(brightness);
    brightness.minvalue = 5;
    brightness.maxvalue = 13;
    brightness.curvalue = (1.3 - Cvar_VariableValue(context.cvar, "vid_gamma") + 0.5) * 10;

    const fullscreen = fullscreenBox[index];
    fullscreen.generic.type = MTYPE_SPINCONTROL;
    fullscreen.generic.x = 0;
    fullscreen.generic.y = 40;
    fullscreen.generic.name = "fullscreen";
    fullscreen.itemnames = yesNo;
    fullscreen.curvalue = Cvar_VariableValue(context.cvar, "vid_fullscreen");

    const defaults = defaultsAction[index];
    defaults.generic.type = MTYPE_ACTION;
    defaults.generic.name = "reset to defaults";
    defaults.generic.x = 0;
    defaults.generic.y = 90;
    defaults.generic.callback = ResetDefaults;

    const cancel = cancelAction[index];
    cancel.generic.type = MTYPE_ACTION;
    cancel.generic.name = "cancel";
    cancel.generic.x = 0;
    cancel.generic.y = 100;
    cancel.generic.callback = CancelChanges;
  }

  function resetFramework(menu: menuframework_s): void {
    menu.x = context.vid.viddef.width * 0.5;
    menu.y = 0;
    menu.cursor = 0;
    menu.nitems = 0;
    menu.nslots = 0;
    menu.items.fill(null);
    menu.statusbar = null;
    menu.cursordraw = null;
  }

  /**
   * Original name: N/A
   * Source: N/A (web viewport adapter for win32/vid_menu.c)
   * Category: Adapter
   * Fidelity level: Adapter
   *
   * Purpose:
   * - Reapply the original video-menu framework origin formulas after a host temporarily changes `viddef`.
   *
   * Porting notes:
   * - Mirrors the `VID_MenuInit` sequence: `x = viddef.width * 0.50`, `Menu_Center`, then `x -= 8`.
   * - Returns a restore callback so overlay-only coordinates do not leak back into the regular menu path.
   */
  function syncMenuOrigins(viewportWidth: number, viewportHeight: number): () => void {
    const previousSoftwareOrigin = { x: softwareMenu.x, y: softwareMenu.y };
    const previousOpenGlOrigin = { x: openglMenu.x, y: openglMenu.y };

    context.qmenu.state.vidWidth = viewportWidth;
    context.qmenu.state.vidHeight = viewportHeight;

    softwareMenu.x = viewportWidth * 0.5;
    openglMenu.x = viewportWidth * 0.5;
    Menu_Center(context.qmenu, softwareMenu);
    Menu_Center(context.qmenu, openglMenu);
    softwareMenu.x -= 8;
    openglMenu.x -= 8;
    currentMenu = currentMenuIndex === SOFTWARE_MENU ? softwareMenu : openglMenu;

    return () => {
      softwareMenu.x = previousSoftwareOrigin.x;
      softwareMenu.y = previousSoftwareOrigin.y;
      openglMenu.x = previousOpenGlOrigin.x;
      openglMenu.y = previousOpenGlOrigin.y;
      currentMenu = currentMenuIndex === SOFTWARE_MENU ? softwareMenu : openglMenu;
    };
  }

  function VID_MenuInit(): void {
    resetFramework(softwareMenu);
    resetFramework(openglMenu);

    modeList[SOFTWARE_MENU].curvalue = Cvar_VariableValue(context.cvar, "sw_mode");
    modeList[OPENGL_MENU].curvalue = Cvar_VariableValue(context.cvar, "gl_mode");
    screenSizeSlider[SOFTWARE_MENU].curvalue = Cvar_VariableValue(context.cvar, "viewsize") / 10;
    screenSizeSlider[OPENGL_MENU].curvalue = Cvar_VariableValue(context.cvar, "viewsize") / 10;

    const vidRef = Cvar_VariableString(context.cvar, "vid_ref").toLowerCase();
    const glDriver = Cvar_VariableString(context.cvar, "gl_driver").toLowerCase();
    if (vidRef === "soft") {
      currentMenuIndex = SOFTWARE_MENU;
      refList[SOFTWARE_MENU].curvalue = REF_SOFT;
      refList[OPENGL_MENU].curvalue = REF_SOFT;
    } else {
      currentMenuIndex = OPENGL_MENU;
      if (glDriver === "3dfxgl") {
        refList[OPENGL_MENU].curvalue = REF_3DFX;
      } else if (glDriver === "pvrgl") {
        refList[OPENGL_MENU].curvalue = REF_POWERVR;
      } else {
        refList[OPENGL_MENU].curvalue = REF_OPENGL;
      }
      refList[SOFTWARE_MENU].curvalue = refList[OPENGL_MENU].curvalue;
    }

    configureSharedItem(SOFTWARE_MENU);
    configureSharedItem(OPENGL_MENU);

    stippleBox.generic.type = MTYPE_SPINCONTROL;
    stippleBox.generic.x = 0;
    stippleBox.generic.y = 60;
    stippleBox.generic.name = "stipple alpha";
    stippleBox.curvalue = Cvar_VariableValue(context.cvar, "sw_stipplealpha");
    stippleBox.itemnames = yesNo;

    textureQualitySlider.generic.type = MTYPE_SLIDER;
    textureQualitySlider.generic.x = 0;
    textureQualitySlider.generic.y = 60;
    textureQualitySlider.generic.name = "texture quality";
    textureQualitySlider.minvalue = 0;
    textureQualitySlider.maxvalue = 3;
    textureQualitySlider.curvalue = 3 - Cvar_VariableValue(context.cvar, "gl_picmip");

    palettedTextureBox.generic.type = MTYPE_SPINCONTROL;
    palettedTextureBox.generic.x = 0;
    palettedTextureBox.generic.y = 70;
    palettedTextureBox.generic.name = "8-bit textures";
    palettedTextureBox.itemnames = yesNo;
    palettedTextureBox.curvalue = Cvar_VariableValue(context.cvar, "gl_ext_palettedtexture");

    finishBox.generic.type = MTYPE_SPINCONTROL;
    finishBox.generic.x = 0;
    finishBox.generic.y = 80;
    finishBox.generic.name = "sync every frame";
    finishBox.itemnames = yesNo;
    finishBox.curvalue = Cvar_VariableValue(context.cvar, "gl_finish");

    Menu_AddItem(context.qmenu, softwareMenu, refList[SOFTWARE_MENU]);
    Menu_AddItem(context.qmenu, softwareMenu, modeList[SOFTWARE_MENU]);
    Menu_AddItem(context.qmenu, softwareMenu, screenSizeSlider[SOFTWARE_MENU]);
    Menu_AddItem(context.qmenu, softwareMenu, brightnessSlider[SOFTWARE_MENU]);
    Menu_AddItem(context.qmenu, softwareMenu, fullscreenBox[SOFTWARE_MENU]);
    Menu_AddItem(context.qmenu, softwareMenu, stippleBox);
    Menu_AddItem(context.qmenu, softwareMenu, defaultsAction[SOFTWARE_MENU]);
    Menu_AddItem(context.qmenu, softwareMenu, cancelAction[SOFTWARE_MENU]);

    Menu_AddItem(context.qmenu, openglMenu, refList[OPENGL_MENU]);
    Menu_AddItem(context.qmenu, openglMenu, modeList[OPENGL_MENU]);
    Menu_AddItem(context.qmenu, openglMenu, screenSizeSlider[OPENGL_MENU]);
    Menu_AddItem(context.qmenu, openglMenu, brightnessSlider[OPENGL_MENU]);
    Menu_AddItem(context.qmenu, openglMenu, fullscreenBox[OPENGL_MENU]);
    Menu_AddItem(context.qmenu, openglMenu, textureQualitySlider);
    Menu_AddItem(context.qmenu, openglMenu, palettedTextureBox);
    Menu_AddItem(context.qmenu, openglMenu, finishBox);
    Menu_AddItem(context.qmenu, openglMenu, defaultsAction[OPENGL_MENU]);
    Menu_AddItem(context.qmenu, openglMenu, cancelAction[OPENGL_MENU]);

    Menu_Center(context.qmenu, softwareMenu);
    Menu_Center(context.qmenu, openglMenu);
    softwareMenu.x -= 8;
    openglMenu.x -= 8;
    currentMenu = currentMenuIndex === SOFTWARE_MENU ? softwareMenu : openglMenu;
  }

  function VID_MenuDraw(): void {
    currentMenu = currentMenuIndex === SOFTWARE_MENU ? softwareMenu : openglMenu;
    const size = context.ref.DrawGetPicSize("m_banner_video");
    context.ref.DrawPic(
      Math.trunc(context.vid.viddef.width / 2 - size.width / 2),
      Math.trunc(context.vid.viddef.height / 2 - 110),
      "m_banner_video"
    );
    Menu_AdjustCursor(context.qmenu, currentMenu, 1);
    Menu_Draw(context.qmenu, currentMenu);
  }

  /**
   * Original name: VID_MenuKey
   * Source: Quake-2-master/win32/vid_menu.c + Quake-2-master/linux/vid_menu.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Routes movement and selection keys through the active software/OpenGL video menu.
   *
   * Porting notes:
   * - Escape uses the Linux submenu behavior (`M_PopMenu`) so the browser main-menu stack returns to the parent menu.
   */
  function VID_MenuKey(key: number): string | null {
    const menu = currentMenu;
    switch (key) {
      case K_ESCAPE:
        CancelChanges();
        return null;
      case K_KP_UPARROW:
      case K_UPARROW:
        menu.cursor -= 1;
        Menu_AdjustCursor(context.qmenu, menu, -1);
        break;
      case K_KP_DOWNARROW:
      case K_DOWNARROW:
        menu.cursor += 1;
        Menu_AdjustCursor(context.qmenu, menu, 1);
        break;
      case K_KP_LEFTARROW:
      case K_LEFTARROW:
        Menu_SlideItem(context.qmenu, menu, -1);
        break;
      case K_KP_RIGHTARROW:
      case K_RIGHTARROW:
        Menu_SlideItem(context.qmenu, menu, 1);
        break;
      case K_KP_ENTER:
      case K_ENTER:
        if (!Menu_SelectItem(context.qmenu, menu)) {
          ApplyChanges();
        }
        break;
      default:
        break;
    }

    return "misc/menu1.wav";
  }

  return {
    VID_MenuInit,
    VID_MenuDraw,
    VID_MenuKey,
    syncMenuOrigins
  };
}
