/**
 * File: sound.ts
 * Source: Quake II original / client/sound.h
 * Purpose: Port the public Quake II client sound API exposed to the rest of the client runtime.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses an explicit hook/context bundle instead of process-global sound backends.
 * - Represents sample buffers with `Uint8Array` and nullable origins explicitly.
 *
 * Notes:
 * - This file is the principal attachment point for `client/sound.h`.
 */

import type { byte, qboolean, vec3_t } from "../../qcommon/src/index.js";
import type { sfx_t } from "./snd_loc.js";

/**
 * Original name: N/A
 * Source: N/A (public sound hook contract)
 * Category: New
 * Purpose: Describe the host-side implementations for the public sound procedures declared by `client/sound.h`.
 *
 * Constraints:
 * - Must preserve the original split between lifecycle, playback, registration and entity-origin callback procedures.
 */
export interface ClientSoundPublicHooks {
  onInit?: () => void;
  onShutdown?: () => void;
  onStartSound?: (
    origin: vec3_t | null,
    entnum: number,
    entchannel: number,
    sfx: sfx_t | null,
    fvol: number,
    attenuation: number,
    timeofs: number
  ) => void;
  onStartLocalSound?: (name: string) => void;
  onRawSamples?: (samples: number, rate: number, width: number, channels: number, data: Uint8Array) => void;
  onStopAllSounds?: () => void;
  onUpdate?: (origin: vec3_t, forward: vec3_t, right: vec3_t, up: vec3_t) => void;
  onActivate?: (active: qboolean) => void;
  onBeginRegistration?: () => void;
  onRegisterSound?: (sample: string) => sfx_t | null;
  onEndRegistration?: () => void;
  onFindName?: (name: string, create: qboolean) => sfx_t | null;
  onGetEntitySoundOrigin?: (ent: number) => vec3_t;
}

/**
 * Original name: N/A
 * Source: N/A (public sound hook contract)
 * Category: New
 * Purpose: Carry the hook bundle used by the public `client/sound.h` forwarding API.
 *
 * Constraints:
 * - Must stay a thin context wrapper so concrete DMA/backend ownership remains in `snd_dma.ts`.
 */
export interface ClientSoundPublicContext {
  hooks: ClientSoundPublicHooks;
}

/**
 * Original name: N/A
 * Source: N/A (public sound hook contract)
 * Category: New
 * Purpose: Create the explicit context used by the public `client/sound.h` procedure forwards.
 *
 * Constraints:
 * - Must default to an empty hook bundle so the public API remains safe until a concrete sound runtime is attached.
 */
export function createClientSoundPublicContext(hooks: ClientSoundPublicHooks = {}): ClientSoundPublicContext {
  return { hooks };
}

/**
 * Original name: S_Init
 * Source: client/sound.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes the public client sound backend.
 *
 * Porting notes:
 * - Forwards to the attached sound runtime hook instead of a process-global backend.
 */
export function S_Init(context: ClientSoundPublicContext): void {
  context.hooks.onInit?.();
}

/**
 * Original name: S_Shutdown
 * Source: client/sound.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Shuts down the public client sound backend.
 */
export function S_Shutdown(context: ClientSoundPublicContext): void {
  context.hooks.onShutdown?.();
}

/**
 * Original name: S_StartSound
 * Source: client/sound.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Starts one spatialized or entity-following sound event.
 *
 * Porting notes:
 * - Uses `null` to represent the original nullable `vec3_t origin` pointer.
 */
export function S_StartSound(
  context: ClientSoundPublicContext,
  origin: vec3_t | null,
  entnum: number,
  entchannel: number,
  sfx: sfx_t | null,
  fvol: number,
  attenuation: number,
  timeofs: number
): void {
  context.hooks.onStartSound?.(origin, entnum, entchannel, sfx, fvol, attenuation, timeofs);
}

/**
 * Original name: S_StartLocalSound
 * Source: client/sound.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Starts one non-spatialized local sound by sample name.
 */
export function S_StartLocalSound(context: ClientSoundPublicContext, name: string): void {
  context.hooks.onStartLocalSound?.(name);
}

/**
 * Original name: S_RawSamples
 * Source: client/sound.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Streams raw decoded samples into the client sound pipeline.
 *
 * Porting notes:
 * - Preserves the byte payload as a `Uint8Array`.
 */
export function S_RawSamples(
  context: ClientSoundPublicContext,
  samples: number,
  rate: number,
  width: number,
  channels: number,
  data: Uint8Array
): void {
  context.hooks.onRawSamples?.(samples, rate, width, channels, data);
}

/**
 * Original name: S_StopAllSounds
 * Source: client/sound.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Stops all active client sounds.
 */
export function S_StopAllSounds(context: ClientSoundPublicContext): void {
  context.hooks.onStopAllSounds?.();
}

/**
 * Original name: S_Update
 * Source: client/sound.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Updates listener origin and orientation for spatialized playback.
 */
export function S_Update(
  context: ClientSoundPublicContext,
  origin: vec3_t,
  v_forward: vec3_t,
  v_right: vec3_t,
  v_up: vec3_t
): void {
  context.hooks.onUpdate?.(origin, v_forward, v_right, v_up);
}

/**
 * Original name: S_Activate
 * Source: client/sound.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Activates or deactivates the client sound system.
 */
export function S_Activate(context: ClientSoundPublicContext, active: qboolean): void {
  context.hooks.onActivate?.(active);
}

/**
 * Original name: S_BeginRegistration
 * Source: client/sound.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Begins one sound registration pass.
 */
export function S_BeginRegistration(context: ClientSoundPublicContext): void {
  context.hooks.onBeginRegistration?.();
}

/**
 * Original name: S_RegisterSound
 * Source: client/sound.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Registers or looks up one sound sample by name.
 */
export function S_RegisterSound(context: ClientSoundPublicContext, sample: string): sfx_t | null {
  return context.hooks.onRegisterSound?.(sample) ?? null;
}

/**
 * Original name: S_EndRegistration
 * Source: client/sound.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Ends the current sound registration pass and releases stale registrations.
 */
export function S_EndRegistration(context: ClientSoundPublicContext): void {
  context.hooks.onEndRegistration?.();
}

/**
 * Original name: S_FindName
 * Source: client/sound.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Finds or optionally creates one `sfx_t` entry by canonical sound name.
 */
export function S_FindName(context: ClientSoundPublicContext, name: string, create: qboolean): sfx_t | null {
  return context.hooks.onFindName?.(name, create) ?? null;
}

/**
 * Original name: CL_GetEntitySoundOrigin
 * Source: client/sound.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns the current origin used to spatialize sounds emitted by one entity.
 *
 * Porting notes:
 * - Returns a copied vector or `[0, 0, 0]` when no hook is attached.
 */
export function CL_GetEntitySoundOrigin(context: ClientSoundPublicContext, ent: number, org: vec3_t): void {
  const origin = context.hooks.onGetEntitySoundOrigin?.(ent) ?? [0, 0, 0];
  org[0] = origin[0];
  org[1] = origin[1];
  org[2] = origin[2];
}

/**
 * Original name: N/A
 * Source: N/A (raw sample helper)
 * Category: New
 * Purpose: Create a stable byte buffer used by `S_RawSamples` verification and adapters.
 *
 * Constraints:
 * - Must preserve raw byte payload identity without reinterpretation.
 */
export function createRawSampleBuffer(values: byte[] | Uint8Array): Uint8Array {
  return values instanceof Uint8Array ? new Uint8Array(values) : new Uint8Array(values);
}
