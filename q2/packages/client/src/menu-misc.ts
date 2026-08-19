/**
 * File: menu-misc.ts
 * Source: Quake II original / client/menu.c
 * Purpose: Port the lightweight menu entry points from `menu.c` that do not justify a dedicated submodule yet.
 */

import { keydest_t } from "./keys.js";
import { M_PopMenu, M_PushMenu } from "./menu-runtime.js";
import { syncMenuVideo } from "./menu-types.js";
import type { ClientMenuContext } from "./menu-types.js";
import { VID_MenuDraw, VID_MenuInit, VID_MenuKey } from "./vid.js";

/**
 * Original name: M_Menu_Video_f
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Close
 */
export function M_Menu_Video_f(context: ClientMenuContext): void {
  VID_MenuInit(context.vid);
  M_PushMenu(
    context,
    () => {
      syncMenuVideo(context);
      VID_MenuDraw(context.vid);
    },
    (key) => VID_MenuKey(context.vid, key)
  );
}

/**
 * Original name: M_Quit_Key
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Escape/`n` pops the quit menu; `y` switches to console input and invokes the quit hook.
 */
export function M_Quit_Key(context: ClientMenuContext, key: number): string | null {
  switch (key) {
    case 27:
    case 110:
    case 78:
      M_PopMenu(context);
      break;

    case 89:
    case 121:
      context.keys.state.key_dest = keydest_t.key_console;
      context.hooks.onQuit?.();
      break;
    default:
      break;
  }

  return null;
}

/**
 * Original name: M_Quit_Draw
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Centers and draws the original `quit` picture using renderer draw exports.
 */
export function M_Quit_Draw(context: ClientMenuContext): void {
  const size = context.ref.DrawGetPicSize("quit");
  context.ref.DrawPic(
    Math.trunc((context.vid.viddef.width - size.width) / 2),
    Math.trunc((context.vid.viddef.height - size.height) / 2),
    "quit"
  );
}

/**
 * Original name: M_Menu_Quit_f
 * Source: Quake-2-master/client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Pushes the quit menu draw/key handlers on the shared menu stack.
 */
export function M_Menu_Quit_f(context: ClientMenuContext): void {
  M_PushMenu(
    context,
    () => M_Quit_Draw(context),
    (key) => M_Quit_Key(context, key)
  );
}
