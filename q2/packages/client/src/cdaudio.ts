/**
 * File: cdaudio.ts
 * Source: Quake II original / client/cdaudio.h and native cd_*.c backends
 * Purpose: Port the logical CD-audio control surface used by the client runtime.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses an explicit context and host hooks instead of native CD-ROM APIs.
 * - Keeps pause/resume explicit because the browser adapter needs them for focus and visibility changes.
 *
 * Notes:
 * - Native platform commands such as eject/remap are not modeled here; browser music mapping lives in platform adapters.
 */

import type { qboolean } from "../../qcommon/src/index.js";

/**
 * Original name: N/A
 * Source: N/A (client CD audio context)
 * Category: New
 * Purpose: Host callback surface used by the logical CD-audio port.
 */
export interface ClientCDAudioHooks {
  onInit?: () => boolean | number | void;
  onShutdown?: () => void;
  onPlay?: (track: number, looping: qboolean) => void;
  onStop?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onUpdate?: () => void;
}

/**
 * Original name: N/A
 * Source: N/A (client CD audio context)
 * Category: New
 * Purpose: Explicit replacement for the native CD-audio module globals.
 */
export interface ClientCDAudioState {
  initialized: qboolean;
  enabled: qboolean;
  playing: qboolean;
  wasPlaying: qboolean;
  playLooping: qboolean;
  playTrack: number;
}

/**
 * Original name: N/A
 * Source: N/A (client CD audio context)
 * Category: New
 * Purpose: Bundle CD-audio state and host hooks for runtime-owned calls.
 */
export interface ClientCDAudioContext {
  state: ClientCDAudioState;
  hooks: ClientCDAudioHooks;
}

/**
 * Original name: N/A
 * Source: N/A (client CD audio context)
 * Category: New
 * Purpose: Create the explicit CD-audio context used instead of native module globals.
 */
export function createClientCDAudioContext(hooks: ClientCDAudioHooks = {}): ClientCDAudioContext {
  return {
    state: {
      initialized: false,
      enabled: true,
      playing: false,
      wasPlaying: false,
      playLooping: false,
      playTrack: 0
    },
    hooks
  };
}

/**
 * Original name: CDAudio_Init
 * Source: client/cdaudio.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes the logical CD-audio surface and enables later play/update calls when the host backend succeeds.
 *
 * Porting notes:
 * - Browser and test backends report native CD-device availability through `onInit` instead of opening a CD-ROM.
 */
export function CDAudio_Init(context: ClientCDAudioContext): number {
  const result = context.hooks.onInit?.();
  const status = typeof result === "number" ? result : result === false ? -1 : 0;
  context.state.initialized = status === 0;
  context.state.enabled = status === 0;
  return status;
}

/**
 * Original name: CDAudio_Shutdown
 * Source: client/cdaudio.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Stops any active CD track, shuts down the host backend and disables the logical CD-audio state.
 *
 * Porting notes:
 * - Preserves the original idempotent shutdown guard while delegating native close operations to hooks.
 */
export function CDAudio_Shutdown(context: ClientCDAudioContext): void {
  if (!context.state.initialized) {
    return;
  }

  CDAudio_Stop(context);
  context.hooks.onShutdown?.();
  context.state.initialized = false;
  context.state.enabled = false;
}

/**
 * Original name: CDAudio_Play
 * Source: client/cdaudio.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Starts a positive-numbered track, ignores repeated play of the current track and stops before switching tracks.
 *
 * Porting notes:
 * - Track validation is limited to logical positive track numbers; media lookup and browser asset mapping live in platform adapters.
 */
export function CDAudio_Play(context: ClientCDAudioContext, track: number, looping: qboolean): void {
  if (!context.state.enabled) {
    return;
  }
  if (track <= 0) {
    CDAudio_Stop(context);
    return;
  }
  if (context.state.playing && context.state.playTrack === Math.trunc(track)) {
    return;
  }
  if (context.state.playing) {
    CDAudio_Stop(context);
  }

  context.state.playTrack = Math.trunc(track);
  context.state.playLooping = looping;
  context.state.playing = true;
  context.state.wasPlaying = false;
  context.hooks.onPlay?.(context.state.playTrack, looping);
}

/**
 * Original name: CDAudio_Stop
 * Source: client/cdaudio.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Stops active or paused CD playback and clears the playing/was-playing state.
 *
 * Porting notes:
 * - Keeps the original idempotent stop shape and forwards the concrete stop request to the host hook.
 */
export function CDAudio_Stop(context: ClientCDAudioContext): void {
  if (!context.state.playing && !context.state.wasPlaying) {
    return;
  }

  context.hooks.onStop?.();
  context.state.playing = false;
  context.state.wasPlaying = false;
}

/**
 * Original name: CDAudio_Pause
 * Source: Quake-2-master/win32/cd_win.c and Quake-2-master/linux/cd_linux.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Pauses active playback, records that a track was playing, and leaves inactive or disabled state unchanged.
 *
 * Porting notes:
 * - Native pause calls are delegated to the host hook because browser playback is implemented by an adapter.
 */
export function CDAudio_Pause(context: ClientCDAudioContext): void {
  if (!context.state.enabled || !context.state.playing) {
    return;
  }

  context.hooks.onPause?.();
  context.state.wasPlaying = true;
  context.state.playing = false;
}

/**
 * Original name: CDAudio_Resume
 * Source: Quake-2-master/win32/cd_win.c and Quake-2-master/linux/cd_linux.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Resumes playback only when CD audio is enabled and a paused track was previously marked as playing.
 *
 * Porting notes:
 * - Native resume calls are delegated to the host hook because browser playback is implemented by an adapter.
 */
export function CDAudio_Resume(context: ClientCDAudioContext): void {
  if (!context.state.enabled || !context.state.wasPlaying) {
    return;
  }

  context.hooks.onResume?.();
  context.state.playing = true;
  context.state.wasPlaying = false;
}

/**
 * Original name: CDAudio_Update
 * Source: client/cdaudio.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Lets the host backend poll or synchronize CD playback once per client frame while CD audio is enabled.
 *
 * Porting notes:
 * - Native backends use this for cvar/media polling; the web adapter currently relies on Web Audio events.
 */
export function CDAudio_Update(context: ClientCDAudioContext): void {
  if (!context.state.enabled) {
    return;
  }

  context.hooks.onUpdate?.();
}

/**
 * Original name: CDAudio_Activate
 * Source: client/cdaudio.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Resumes CD playback when the client becomes active and pauses it when the client loses focus.
 *
 * Porting notes:
 * - Reuses the exported pause/resume helpers because browser visibility and focus events need the same semantics.
 */
export function CDAudio_Activate(context: ClientCDAudioContext, active: qboolean): void {
  if (active) {
    CDAudio_Resume(context);
  } else {
    CDAudio_Pause(context);
  }
}
