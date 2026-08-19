/**
 * File: vid.ts
 * Source: Quake-2-master/client/vid.h
 * Purpose: Port the public Quake II video-driver declarations used by the client runtime.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses an explicit state/context object instead of a C global.
 *
 * Notes:
 * - This file is the principal attachment point for `client/vid.h`.
 */

export type { vrect_t } from "./cl_scrn.js";

/**
 * Original name: viddef_t
 * Source: Quake-2-master/client/vid.h
 * Category: Ported
 * Fidelity level: Strict
 */
export interface viddef_t {
  width: number;
  height: number;
}

/**
 * Original name: N/A
 * Source: N/A (TypeScript host hooks for client/vid.h)
 * Category: New
 * Purpose: Describe the host-side implementation hooks for the `VID_*` procedures declared by `client/vid.h`.
 *
 * Constraints:
 * - Must preserve the public split between initialization, shutdown, runtime changes and video menu entry points.
 */
export interface ClientVidHooks {
  onInit?: () => void;
  onShutdown?: () => void;
  onCheckChanges?: () => void;
  onMenuInit?: () => void;
  onMenuDraw?: () => void;
  onMenuKey?: (key: number) => string | null;
}

/**
 * Original name: N/A
 * Source: N/A (TypeScript context replacing the C `viddef` global)
 * Category: New
 * Purpose: Group the header-visible global video state with the pending `VID_*` implementation hooks.
 *
 * Constraints:
 * - Must keep the `viddef` global explicit and mutable.
 */
export interface ClientVidContext {
  viddef: viddef_t;
  hooks: ClientVidHooks;
}

/**
 * Original name: N/A
 * Source: N/A (TypeScript factory for client/vid.h state)
 * Category: New
 * Purpose: Create a zero-initialized `viddef_t` matching the public `client/vid.h` global state.
 *
 * Constraints:
 * - Must keep width and height mutable for menu, screen and renderer consumers.
 */
export function createVidDef(): viddef_t {
  return {
    width: 0,
    height: 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (TypeScript context factory for client/vid.h)
 * Category: New
 * Purpose: Create the explicit context replacing the C global `viddef` plus the public `VID_*` hooks.
 *
 * Constraints:
 * - Must keep the hook bundle optional so the public video API remains safe before a backend is attached.
 */
export function createClientVidContext(hooks: ClientVidHooks = {}): ClientVidContext {
  return {
    viddef: createVidDef(),
    hooks
  };
}

/**
 * Original name: VID_Init
 * Source: Quake-2-master/client/vid.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes the video backend.
 */
export function VID_Init(context: ClientVidContext): void {
  context.hooks.onInit?.();
}

/**
 * Original name: VID_Shutdown
 * Source: Quake-2-master/client/vid.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Shuts down the video backend.
 */
export function VID_Shutdown(context: ClientVidContext): void {
  context.hooks.onShutdown?.();
}

/**
 * Original name: VID_CheckChanges
 * Source: Quake-2-master/client/vid.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Lets the video backend apply pending video mode or renderer changes.
 */
export function VID_CheckChanges(context: ClientVidContext): void {
  context.hooks.onCheckChanges?.();
}

/**
 * Original name: VID_MenuInit
 * Source: Quake-2-master/client/vid.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes the video options menu.
 */
export function VID_MenuInit(context: ClientVidContext): void {
  context.hooks.onMenuInit?.();
}

/**
 * Original name: VID_MenuDraw
 * Source: Quake-2-master/client/vid.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Draws the active video options menu.
 */
export function VID_MenuDraw(context: ClientVidContext): void {
  context.hooks.onMenuDraw?.();
}

/**
 * Original name: VID_MenuKey
 * Source: Quake-2-master/client/vid.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Dispatches one key to the video options menu and returns the source sound name when applicable.
 */
export function VID_MenuKey(context: ClientVidContext, key: number): string | null {
  return context.hooks.onMenuKey?.(key) ?? null;
}
