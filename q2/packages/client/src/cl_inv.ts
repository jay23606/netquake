/**
 * File: cl_inv.ts
 * Source: Quake II original / client/cl_inv.c
 * Purpose: Port of the client inventory parsing-facing presentation helpers and overlay draw logic.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Emits backend-agnostic draw commands instead of immediate renderer calls.
 * - Keeps key binding lookup explicit through a resolved binding map.
 *
 * Notes:
 * - This file is intended to stay close to the original `cl_inv.c` responsibilities.
 */

import {
  CS_ITEMS,
  MAX_ITEMS,
  MSG_ReadShort,
  STAT_SELECTED_ITEM
} from "../../qcommon/src/index.js";
import type {
  HudDrawCommand,
  HudPictureCommand,
  HudTextCommand
} from "./render-contracts.js";
import type { refexport_t } from "./ref.js";
import type { ClientRuntime } from "./client.js";

/**
 * Original name: DISPLAY_ITEMS
 * Source: Quake-2-master/client/cl_inv.c
 * Category: Ported
 * Fidelity level: Strict
 */
export const DISPLAY_ITEMS = 17;

/**
 * Original name: N/A
 * Source: N/A (local binding map for client/cl_inv.c)
 * Category: New
 * Purpose: Carry the optional key binding metadata needed by the inventory screen port.
 *
 * Constraints:
 * - Must stay decoupled from the browser input layer and only expose resolved strings.
 */
export interface ClientInventoryBindingMap {
  [itemName: string]: string | undefined;
}

/**
 * Original name: N/A
 * Source: N/A (local draw context for client/cl_inv.c)
 * Category: New
 * Purpose: Carry the viewport and activation state needed by `CL_DrawInventory`.
 *
 * Constraints:
 * - Must preserve the original centering and gating behavior.
 */
export interface ClientInventoryContext {
  viewportWidth: number;
  viewportHeight: number;
  active: boolean;
}

/**
 * Original name: Inv_DrawString
 * Source: Quake-2-master/client/cl_inv.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits one left-aligned inventory text draw command equivalent to the original renderer loop.
 *
 * Porting notes:
 * - The command path defers the per-character draw loop to the HUD renderer adapter.
 */
export function Inv_DrawString(x: number, y: number, text: string): HudTextCommand {
  return {
    type: "text",
    x,
    y,
    text,
    xorMask: 0,
    centerWidth: 0,
    variant: "normal",
    bounds: {
      x,
      y,
      width: text.length * 8,
      height: 8
    }
  };
}

/**
 * Original name: N/A
 * Source: N/A (refexport_t adapter for client/cl_inv.c Inv_DrawString)
 * Category: Adapter
 * Fidelity level: Close
 *
 * Behavior:
 * - Draws one left-aligned inventory string through the renderer export table.
 */
export function Inv_DrawStringRef(ref: refexport_t, x: number, y: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    ref.DrawChar(x + index * 8, y, text.charCodeAt(index) & 0xff);
  }
}

/**
 * Original name: SetStringHighBit
 * Source: Quake-2-master/client/cl_inv.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Sets the high bit on every character of the string.
 */
export function SetStringHighBit(text: string): string {
  let result = "";
  for (const char of text) {
    result += String.fromCharCode(char.charCodeAt(0) | 128);
  }
  return result;
}

/**
 * Original name: CL_DrawInventory
 * Source: Quake-2-master/client/cl_inv.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Builds the Quake II inventory overlay draw commands.
 *
 * Porting notes:
 * - Accepts pre-resolved key binding strings instead of scanning global keybinding arrays directly.
 */
export function CL_DrawInventory(
  runtime: ClientRuntime,
  context: ClientInventoryContext,
  bindings: ClientInventoryBindingMap = {}
): HudDrawCommand[] {
  if (!context.active) {
    return [];
  }

  const commands: HudDrawCommand[] = [];
  const selected = runtime.cl.frame.playerstate.stats[STAT_SELECTED_ITEM] ?? 0;
  const index: number[] = [];
  let num = 0;
  let selected_num = 0;

  for (let i = 0; i < runtime.cl.inventory.length; i += 1) {
    if (i === selected) {
      selected_num = num;
    }
    if ((runtime.cl.inventory[i] ?? 0) !== 0) {
      index[num] = i;
      num += 1;
    }
  }

  let top = selected_num - Math.trunc(DISPLAY_ITEMS / 2);
  if ((num - top) < DISPLAY_ITEMS) {
    top = num - DISPLAY_ITEMS;
  }
  if (top < 0) {
    top = 0;
  }

  let x = Math.trunc((context.viewportWidth - 256) / 2);
  let y = Math.trunc((context.viewportHeight - 240) / 2);

  commands.push(createPictureCommand(x, y + 8, "inventory"));

  y += 24;
  x += 24;
  commands.push(Inv_DrawString(x, y, "hotkey ### item"));
  commands.push(Inv_DrawString(x, y + 8, "------ --- ----"));
  y += 16;

  for (let i = top; i < num && i < (top + DISPLAY_ITEMS); i += 1) {
    const item = index[i];
    const itemName = runtime.cl.configstrings[CS_ITEMS + item] ?? "";
    const bind = bindings[itemName] ?? "";
    let line = `${bind.padStart(6, " ")} ${`${runtime.cl.inventory[item] ?? 0}`.padStart(3, " ")} ${itemName}`;

    if (item !== selected) {
      line = SetStringHighBit(line);
    } else if ((Math.trunc(runtime.cls.realtime * 10) & 1) !== 0) {
      commands.push({
        type: "text",
        x: x - 8,
        y,
        text: String.fromCharCode(15),
        xorMask: 0,
        centerWidth: 0,
        variant: "normal",
        bounds: {
          x: x - 8,
          y,
          width: 8,
          height: 8
        }
      });
    }

    commands.push(Inv_DrawString(x, y, line));
    y += 8;
  }

  return commands;
}

/**
 * Original name: N/A
 * Source: N/A (refexport_t adapter for client/cl_inv.c CL_DrawInventory)
 * Category: Adapter
 * Fidelity level: Close
 *
 * Behavior:
 * - Draws the Quake II inventory overlay through `refexport_t`.
 *
 * Porting notes:
 * - Kept beside `CL_DrawInventory` while the legacy HUD command path is still tested.
 */
export function CL_DrawInventoryRef(
  runtime: ClientRuntime,
  ref: refexport_t,
  context: ClientInventoryContext,
  bindings: ClientInventoryBindingMap = {}
): void {
  if (!context.active) {
    return;
  }

  const selected = runtime.cl.frame.playerstate.stats[STAT_SELECTED_ITEM] ?? 0;
  const index: number[] = [];
  let num = 0;
  let selected_num = 0;

  for (let i = 0; i < runtime.cl.inventory.length; i += 1) {
    if (i === selected) {
      selected_num = num;
    }
    if ((runtime.cl.inventory[i] ?? 0) !== 0) {
      index[num] = i;
      num += 1;
    }
  }

  let top = selected_num - Math.trunc(DISPLAY_ITEMS / 2);
  if ((num - top) < DISPLAY_ITEMS) {
    top = num - DISPLAY_ITEMS;
  }
  if (top < 0) {
    top = 0;
  }

  let x = Math.trunc((context.viewportWidth - 256) / 2);
  let y = Math.trunc((context.viewportHeight - 240) / 2);

  ref.DrawPic(x, y + 8, "inventory");

  y += 24;
  x += 24;
  Inv_DrawStringRef(ref, x, y, "hotkey ### item");
  Inv_DrawStringRef(ref, x, y + 8, "------ --- ----");
  y += 16;

  for (let i = top; i < num && i < (top + DISPLAY_ITEMS); i += 1) {
    const item = index[i];
    const itemName = runtime.cl.configstrings[CS_ITEMS + item] ?? "";
    const bind = bindings[itemName] ?? "";
    let line = `${bind.padStart(6, " ")} ${`${runtime.cl.inventory[item] ?? 0}`.padStart(3, " ")} ${itemName}`;

    if (item !== selected) {
      line = SetStringHighBit(line);
    } else if ((Math.trunc(runtime.cls.realtime * 10) & 1) !== 0) {
      ref.DrawChar(x - 8, y, 15);
    }

    Inv_DrawStringRef(ref, x, y, line);
    y += 8;
  }
}

/**
 * Original name: N/A
 * Source: N/A (local HUD picture command helper)
 * Category: New
 * Purpose: Create one inventory picture command that defers native size resolution to the renderer.
 */
function createPictureCommand(x: number, y: number, pic: string): HudPictureCommand {
  return {
    type: "picture",
    x,
    y,
    pic,
    bounds: {
      x,
      y,
      width: 0,
      height: 0
    }
  };
}

/**
 * Original name: CL_ParseInventory
 * Source: client/cl_inv.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Reads the current inventory item counts from the message stream.
 *
 * Porting notes:
 * - Updates the fixed inventory array in place.
 */
export function CL_ParseInventory(runtime: ClientRuntime): number[] {
  for (let index = 0; index < MAX_ITEMS; index += 1) {
    runtime.cl.inventory[index] = MSG_ReadShort(runtime.net_message);
  }

  return runtime.cl.inventory;
}
