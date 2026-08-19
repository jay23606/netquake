/**
 * File: input.ts
 * Source: Quake II original / client/input.h
 * Purpose: Port the external input-device header declarations used by the Quake II client.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses an explicit hook bundle instead of global platform backends.
 *
 * Notes:
 * - This file is the principal attachment point for `client/input.h`.
 */

import type { qboolean, usercmd_t } from "../../qcommon/src/index.js";

/**
 * Original name: N/A
 * Source: N/A (input device hook contract)
 * Category: New
 * Purpose: Describe the host-side external input-device callbacks declared by `client/input.h`.
 *
 * Constraints:
 * - Must preserve the original function split between init, shutdown, command injection, per-frame updates, movement augmentation and activation.
 */
export interface ClientInputDeviceHooks {
  onInit?: () => void;
  onShutdown?: () => void;
  onCommands?: () => void;
  onFrame?: () => void;
  onMove?: (cmd: usercmd_t) => void;
  onActivate?: (active: qboolean) => void;
}

/**
 * Original name: N/A
 * Source: N/A (input device runtime context)
 * Category: New
 * Purpose: Hold the explicit runtime wrapper for the external input-device callbacks.
 *
 * Constraints:
 * - Must keep the header-declared device procedures grouped in one stable context object.
 */
export interface ClientInputDeviceContext {
  hooks: ClientInputDeviceHooks;
}

/**
 * Original name: N/A
 * Source: N/A (client main input adapter)
 * Category: Adapter
 * Purpose: Expose the `client/input.h` device procedures through the hook names used by the `cl_main.c` frame port.
 *
 * Constraints:
 * - Must keep the source-level split between init, shutdown, command injection and per-frame polling.
 */
export interface ClientInputDeviceMainHooks {
  onInputInit: () => void;
  onInputShutdown: () => void;
  onInputCommands: () => void;
  onInputFrame: () => void;
}

/**
 * Original name: N/A
 * Source: N/A (input device context factory)
 * Category: New
 * Purpose: Create the context used by the `client/input.h` procedure ports.
 *
 * Constraints:
 * - Must default to an empty hook bundle so the header procedures remain safe no-ops until a platform adapter is attached.
 */
export function createClientInputDeviceContext(hooks: ClientInputDeviceHooks = {}): ClientInputDeviceContext {
  return { hooks };
}

/**
 * Original name: IN_Init
 * Source: Quake-2-master/client/input.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes the external non-keyboard input devices attached to the client.
 *
 * Porting notes:
 * - Forwards to an explicit host hook instead of a platform-global backend.
 */
export function IN_Init(context: ClientInputDeviceContext): void {
  context.hooks.onInit?.();
}

/**
 * Original name: IN_Shutdown
 * Source: Quake-2-master/client/input.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Shuts down the external non-keyboard input devices attached to the client.
 *
 * Porting notes:
 * - Forwards to an explicit host hook instead of a platform-global backend.
 */
export function IN_Shutdown(context: ClientInputDeviceContext): void {
  context.hooks.onShutdown?.();
}

/**
 * Original name: IN_Commands
 * Source: Quake-2-master/client/input.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Lets external devices append commands to the command buffer.
 *
 * Porting notes:
 * - Preserves the original separation between device command injection and regular frame processing.
 */
export function IN_Commands(context: ClientInputDeviceContext): void {
  context.hooks.onCommands?.();
}

/**
 * Original name: IN_Frame
 * Source: Quake-2-master/client/input.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Advances one external-input frame for mouse/joystick style backends.
 *
 * Porting notes:
 * - Forwards the frame tick to the attached adapter hook.
 */
export function IN_Frame(context: ClientInputDeviceContext): void {
  context.hooks.onFrame?.();
}

/**
 * Original name: IN_Move
 * Source: Quake-2-master/client/input.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Adds external-device movement on top of the keyboard-built `usercmd_t`.
 *
 * Porting notes:
 * - Preserves in-place `usercmd_t` mutation by forwarding the same object reference to the attached hook.
 */
export function IN_Move(context: ClientInputDeviceContext, cmd: usercmd_t): void {
  context.hooks.onMove?.(cmd);
}

/**
 * Original name: IN_Activate
 * Source: Quake-2-master/client/input.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Activates or deactivates the external input devices depending on client focus/state.
 *
 * Porting notes:
 * - Uses the Quake-style `qboolean` flag unchanged at the public boundary.
 */
export function IN_Activate(context: ClientInputDeviceContext, active: qboolean): void {
  context.hooks.onActivate?.(active);
}

/**
 * Original name: N/A
 * Source: N/A (client main input adapter)
 * Category: Adapter
 * Purpose: Bridge `client/input.h` procedures into the high-level `cl_main.c` lifecycle hooks.
 *
 * Constraints:
 * - Must call the ported `IN_*` functions rather than reaching into host hooks directly.
 */
export function createClientInputDeviceMainHooks(context: ClientInputDeviceContext): ClientInputDeviceMainHooks {
  return {
    onInputInit: () => IN_Init(context),
    onInputShutdown: () => IN_Shutdown(context),
    onInputCommands: () => IN_Commands(context),
    onInputFrame: () => IN_Frame(context)
  };
}
