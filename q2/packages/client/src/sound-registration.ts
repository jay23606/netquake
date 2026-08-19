/**
 * File: sound-registration.ts
 * Source: Quake II original / client/cl_parse.c and client/cl_tent.c
 * Purpose: Port the first client-side sound registration path used during refresh preparation and sound restarts.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Stores registered sound identifiers as path strings instead of backend sound handles.
 * - Defers actual audio backend registration calls to optional hooks.
 *
 * Notes:
 * - This file is intended to stay conceptually close to the original client sound precache flow.
 * - The public `client/sound.h` API is attached to `sound.ts`.
 */

import { CS_SOUNDS, MAX_SOUNDS } from "../../qcommon/src/index.js";
import { CL_RegisterTEntSounds } from "./cl_tent.js";
import type { ClientRuntime } from "./client.js";

/**
 * Original name: N/A
 * Source: N/A (sound registration hooks)
 * Category: New
 * Purpose: Describe host-side callbacks used by the first client sound registration port.
 *
 * Constraints:
 * - Must keep backend sound registration optional while preserving registration order.
 */
export interface ClientSoundRegistrationHooks {
  onBeginRegistration?: () => void;
  onRegisterSound?: (path: string, category: "tent" | "precache") => unknown;
  onEndRegistration?: () => void;
  onPumpEvents?: () => void;
}

/**
 * Original name: CL_RegisterSounds
 * Source: Quake-2-master/client/cl_parse.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Registers temp-entity sounds first, then all configstring sound assets.
 *
 * Porting notes:
 * - Stores backend sound handles when a concrete registration hook returns one, falling back to path strings.
 */
export function CL_RegisterSounds(runtime: ClientRuntime, hooks: ClientSoundRegistrationHooks = {}): string[] {
  const registered: string[] = [];

  hooks.onBeginRegistration?.();

  for (const path of CL_RegisterTEntSounds(runtime)) {
    hooks.onRegisterSound?.(path, "tent");
    registered.push(path);
  }

  for (let index = 1; index < MAX_SOUNDS; index += 1) {
    const path = runtime.cl.configstrings[CS_SOUNDS + index];
    if (path.length === 0) {
      break;
    }

    runtime.cl.sound_precache[index] = hooks.onRegisterSound?.(path, "precache") ?? path;
    hooks.onPumpEvents?.();
    registered.push(path);
  }

  hooks.onEndRegistration?.();
  return registered;
}
