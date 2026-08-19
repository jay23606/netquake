/**
 * File: menu-draw.ts
 * Source: Quake II original / client/menu.c
 * Purpose: Port the shared drawing helpers and picture/text primitives used throughout `menu.c`.
 */

import { NUM_CURSOR_FRAMES } from "./menu-types.js";
import type { ClientMenuContext } from "./menu-types.js";

/**
 * Original name: M_Banner
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function M_Banner(context: ClientMenuContext, name: string): void {
  const size = context.ref.DrawGetPicSize(name);
  context.ref.DrawPic(
    Math.trunc(context.vid.viddef.width / 2 - size.width / 2),
    Math.trunc(context.vid.viddef.height / 2 - 110),
    name
  );
}

/**
 * Original name: M_DrawCharacter
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function M_DrawCharacter(context: ClientMenuContext, cx: number, cy: number, num: number): void {
  context.ref.DrawChar(
    cx + ((context.vid.viddef.width - 320) >> 1),
    cy + ((context.vid.viddef.height - 240) >> 1),
    num
  );
}

/**
 * Original name: M_Print
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function M_Print(context: ClientMenuContext, cx: number, cy: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    M_DrawCharacter(context, cx, cy, text.charCodeAt(i) + 128);
    cx += 8;
  }
}

/**
 * Original name: M_PrintWhite
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function M_PrintWhite(context: ClientMenuContext, cx: number, cy: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    M_DrawCharacter(context, cx, cy, text.charCodeAt(i));
    cx += 8;
  }
}

/**
 * Original name: M_DrawPic
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function M_DrawPic(context: ClientMenuContext, x: number, y: number, pic: string): void {
  context.ref.DrawPic(
    x + ((context.vid.viddef.width - 320) >> 1),
    y + ((context.vid.viddef.height - 240) >> 1),
    pic
  );
}

/**
 * Original name: M_DrawCursor
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Close
 */
export function M_DrawCursor(context: ClientMenuContext, x: number, y: number, f: number): void {
  if (!context.state.cursorPicsCached) {
    for (let i = 0; i < NUM_CURSOR_FRAMES; i += 1) {
      context.ref.RegisterPic(`m_cursor${i}`);
    }

    context.state.cursorPicsCached = true;
  }

  context.ref.DrawPic(x, y, `m_cursor${f}`);
}

/**
 * Original name: M_DrawTextBox
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function M_DrawTextBox(context: ClientMenuContext, x: number, y: number, width: number, lines: number): void {
  let cx = x;
  let cy = y;

  M_DrawCharacter(context, cx, cy, 1);
  for (let n = 0; n < lines; n += 1) {
    cy += 8;
    M_DrawCharacter(context, cx, cy, 4);
  }
  M_DrawCharacter(context, cx, cy + 8, 7);

  cx += 8;
  while (width > 0) {
    cy = y;
    M_DrawCharacter(context, cx, cy, 2);
    for (let n = 0; n < lines; n += 1) {
      cy += 8;
      M_DrawCharacter(context, cx, cy, 5);
    }
    M_DrawCharacter(context, cx, cy + 8, 8);
    width -= 1;
    cx += 8;
  }

  cy = y;
  M_DrawCharacter(context, cx, cy, 3);
  for (let n = 0; n < lines; n += 1) {
    cy += 8;
    M_DrawCharacter(context, cx, cy, 6);
  }
  M_DrawCharacter(context, cx, cy + 8, 9);
}
