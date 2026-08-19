/**
 * File: local-input.ts
 * Purpose: Hold the standalone local-input helpers that mirror external key state into the ported Quake II button structures.
 *
 * This file is not a direct source port.
 * It is a runtime-side helper layer for the current standalone client loop.
 *
 * Dependencies:
 * - packages/client/src/cl_input.ts
 */

import type { ClientInputContext } from "./index.js";

/**
 * Original name: N/A
 * Source: N/A (standalone local-input helper)
 * Category: New
 * Purpose: Mirror one standalone movement-key state map into the ported Quake II button structures consumed by `CL_CreateCmd`.
 *
 * Constraints:
 * - Must preserve the held/released timing semantics closely enough for local prediction.
 */
export function syncLocalMovementButtons(
  context: ClientInputContext,
  pressedKeys: Record<string, boolean>,
  realtimeMs: number
): void {
  setLocalButtonHeld(context.in_forward, pressedKeys.forward === true, realtimeMs);
  setLocalButtonHeld(context.in_back, pressedKeys.backward === true, realtimeMs);
  setLocalButtonHeld(context.in_moveleft, pressedKeys.left === true, realtimeMs);
  setLocalButtonHeld(context.in_moveright, pressedKeys.right === true, realtimeMs);
  setLocalButtonHeld(context.in_up, pressedKeys.up === true, realtimeMs);
  setLocalButtonHeld(context.in_down, pressedKeys.down === true, realtimeMs);
}

/**
 * Original name: N/A
 * Source: N/A (standalone local-input helper)
 * Category: New
 * Purpose: Apply one held/not-held boolean to a ported Quake II key button structure.
 *
 * Constraints:
 * - Must only emit transitions when the held state changes.
 */
export function setLocalButtonHeld(button: ClientInputContext["in_forward"], held: boolean, realtimeMs: number): void {
  const isDown = (button.state & 1) !== 0;
  if (held === isDown) {
    return;
  }

  if (held) {
    button.down[0] = 1;
    button.downtime = realtimeMs - 1;
    button.state |= 1 + 2;
    return;
  }

  button.down = [0, 0];
  button.msec += Math.max(1, realtimeMs - button.downtime);
  button.state &= ~1;
  button.state |= 4;
}

/**
 * Original name: N/A
 * Source: N/A (standalone local-input helper)
 * Category: New
 * Purpose: Clear all standalone movement states and their mirrored Quake button states after focus loss or visibility changes.
 *
 * Constraints:
 * - Must prevent sticky movement when one keyup event is missed externally.
 */
export function clearLocalMovementState(
  context: ClientInputContext,
  pressedKeys: Record<string, boolean>
): void {
  for (const key of Object.keys(pressedKeys)) {
    pressedKeys[key] = false;
  }

  resetLocalButtonState(context.in_forward);
  resetLocalButtonState(context.in_back);
  resetLocalButtonState(context.in_moveleft);
  resetLocalButtonState(context.in_moveright);
  resetLocalButtonState(context.in_up);
  resetLocalButtonState(context.in_down);
}

/**
 * Original name: N/A
 * Source: N/A (standalone local-input helper)
 * Category: New
 * Purpose: Fully reset one mirrored Quake key button after an external focus interruption.
 *
 * Constraints:
 * - Must clear held and impulse bits together to avoid residual movement next frame.
 */
export function resetLocalButtonState(button: ClientInputContext["in_forward"]): void {
  button.down = [0, 0];
  button.downtime = 0;
  button.msec = 0;
  button.state = 0;
}
