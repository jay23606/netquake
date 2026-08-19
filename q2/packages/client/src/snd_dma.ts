/**
 * File: snd_dma.ts
 * Source: Quake II original / client/snd_dma.c
 * Purpose: Port the main Quake II client sound runtime control loop, registration and playsound orchestration.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses an explicit context/state bundle instead of process-global sound variables.
 * - Replaces direct filesystem open probes with `FS_LoadFile`/`FS_FreeFile`-style hook checks where needed.
 * - Keeps command/cvar/runtime glue explicit until the broader client main loop is fully wired to this module.
 *
 * Notes:
 * - This file is the principal attachment point for `client/snd_dma.c`.
 */

import {
  ATTN_STATIC,
  CS_PLAYERSKINS,
  CVAR_ARCHIVE,
  Cmd_AddCommand,
  Cmd_Argc,
  Cmd_Argv,
  Cmd_Exists,
  Cmd_RemoveCommand,
  Cvar_Get,
  ERR_DROP,
  ERR_FATAL,
  MAX_CLIENTS,
  MAX_QPATH,
  MAX_SOUNDS,
  type CommandRuntime,
  type CvarRuntime,
  type cvar_t,
  type vec3_t
} from "../../qcommon/src/index.js";
import { Com_PageInMemory, type SystemRuntime } from "../../qcommon/src/index.js";
import {
  connstate_t,
  createClientRuntime,
  type ClientRuntime
} from "./client.js";
import type {
  channel_t,
  ClientSoundLocalContext,
  playsound_t,
  sfx_t
} from "./snd_loc.js";
import {
  MAX_CHANNELS,
  SNDDMA_BeginPainting,
  SNDDMA_GetDMAPos,
  SNDDMA_Init,
  SNDDMA_Shutdown,
  SNDDMA_Submit,
  S_InitScaletable,
  S_LoadSound,
  S_PaintChannels,
  createChannel,
  createPlaySound,
  createSfx
} from "./snd_loc.js";

/**
 * Original name: SOUND_FULLVOLUME
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Strict
 */
const SOUND_FULLVOLUME = 80;

/**
 * Original name: SOUND_LOOPATTENUATE
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Strict
 */
const SOUND_LOOPATTENUATE = 0.003;

/**
 * Original name: MAX_SFX
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Strict
 */
const MAX_SFX = MAX_SOUNDS * 2;

/**
 * Original name: MAX_PLAYSOUNDS
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Strict
 */
const MAX_PLAYSOUNDS = 128;

/**
 * Original name: N/A
 * Source: N/A (explicit runtime state)
 * Category: New
 * Purpose: Store the mutable globals owned by `snd_dma.c` in one explicit runtime state object.
 *
 * Constraints:
 * - Must preserve the original known-sfx and playsound pool sizes.
 */
export interface ClientSndDmaState {
  s_registration_sequence: number;
  snd_initialized: boolean;
  sound_started: number;
  s_registering: boolean;
  soundtime: number;
  num_sfx: number;
  s_beginofs: number;
  buffers: number;
  oldsamplepos: number;
  known_sfx: sfx_t[];
  s_playsounds: playsound_t[];
  s_freeplays: playsound_t;
}

/**
 * Original name: N/A
 * Source: N/A (host callback contract)
 * Category: New
 * Purpose: Carry the extra host-side callbacks needed by the `snd_dma.c` port beyond the private `snd_loc.h` hooks.
 *
 * Constraints:
 * - Entity-origin lookup remains injectable for adapters but defaults to the client lerp origins like `CL_GetEntitySoundOrigin`.
 */
export interface ClientSndDmaHooks {
  onGetEntitySoundOrigin?: (ent: number) => vec3_t;
}

/**
 * Original name: N/A
 * Source: N/A (explicit runtime context)
 * Category: New
 * Purpose: Bundle the client, qcommon and sound-local runtimes needed by the `snd_dma.c` port.
 *
 * Constraints:
 * - Must keep the principal `snd_dma.c` state explicit and independent from platform adapters.
 */
export interface ClientSndDmaContext {
  client: ClientRuntime;
  cmd: CommandRuntime;
  cvar: CvarRuntime;
  sound: ClientSoundLocalContext;
  system: SystemRuntime | null;
  state: ClientSndDmaState;
  cl_paused: cvar_t | null;
  hooks: ClientSndDmaHooks;
}

/**
 * Original name: N/A
 * Source: N/A (state factory)
 * Category: New
 * Purpose: Create the default explicit runtime state for `snd_dma.c`.
 */
export function createClientSndDmaState(): ClientSndDmaState {
  return {
    s_registration_sequence: 0,
    snd_initialized: false,
    sound_started: 0,
    s_registering: false,
    soundtime: 0,
    num_sfx: 0,
    s_beginofs: 0,
    buffers: 0,
    oldsamplepos: 0,
    known_sfx: Array.from({ length: MAX_SFX }, () => createSfx()),
    s_playsounds: Array.from({ length: MAX_PLAYSOUNDS }, () => createPlaySound()),
    s_freeplays: createPlaySound()
  };
}

/**
 * Original name: N/A
 * Source: N/A (context factory)
 * Category: New
 * Purpose: Create the explicit context used by the `snd_dma.c` port and bind the private sound hooks it owns.
 */
export function createClientSndDmaContext(
  client: ClientRuntime = createClientRuntime(),
  cmd: CommandRuntime,
  cvar: CvarRuntime,
  sound: ClientSoundLocalContext,
  options: {
    system?: SystemRuntime | null;
    cl_paused?: cvar_t | null;
    hooks?: ClientSndDmaHooks;
  } = {}
): ClientSndDmaContext {
  const context: ClientSndDmaContext = {
    client,
    cmd,
    cvar,
    sound,
    system: options.system ?? null,
    state: createClientSndDmaState(),
    cl_paused: options.cl_paused ?? null,
    hooks: options.hooks ?? {}
  };

  bindSoundLocalHooks(context);
  return context;
}

/**
 * Original name: S_SoundInfo_f
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Close
 */
export function S_SoundInfo(context: ClientSndDmaContext): string[] {
  if (!context.state.sound_started) {
    sndDmaPrintf(context, "sound system not started\n");
    return ["sound system not started"];
  }

  const lines = [
    `${context.sound.state.dma.channels - 1} stereo`,
    `${context.sound.state.dma.samples} samples`,
    `${context.sound.state.dma.samplepos} samplepos`,
    `${context.sound.state.dma.samplebits} samplebits`,
    `${context.sound.state.dma.submission_chunk} submission_chunk`,
    `${context.sound.state.dma.speed} speed`,
    `${context.sound.state.dma.buffer ? "dma buffer" : "null dma buffer"}`
  ];

  for (const line of lines) {
    sndDmaPrintf(context, `${line}\n`);
  }

  return lines;
}

/**
 * Original name: S_Init
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Close
 */
export function S_Init(context: ClientSndDmaContext): void {
  sndDmaPrintf(context, "\n------- sound initialization -------\n");
  context.state.snd_initialized = false;

  const s_initsound = Cvar_Get(context.cvar, "s_initsound", "1", 0);
  if (!s_initsound || !s_initsound.value) {
    sndDmaPrintf(context, "not initializing.\n");
    sndDmaPrintf(context, "------------------------------------\n");
    return;
  }

  context.sound.state.s_volume = Cvar_Get(context.cvar, "s_volume", "0.7", CVAR_ARCHIVE);
  context.sound.state.s_khz = Cvar_Get(context.cvar, "s_khz", "11", CVAR_ARCHIVE);
  context.sound.state.s_loadas8bit = Cvar_Get(context.cvar, "s_loadas8bit", "1", CVAR_ARCHIVE);
  context.sound.state.s_mixahead = Cvar_Get(context.cvar, "s_mixahead", "0.2", CVAR_ARCHIVE);
  context.sound.state.s_show = Cvar_Get(context.cvar, "s_show", "0", 0);
  context.sound.state.s_testsound = Cvar_Get(context.cvar, "s_testsound", "0", 0);
  context.sound.state.s_primary = Cvar_Get(context.cvar, "s_primary", "0", CVAR_ARCHIVE);

  registerSoundCommand(context, "play", () => {
    S_Play(context);
  });
  registerSoundCommand(context, "stopsound", () => {
    S_StopAllSounds(context);
  });
  registerSoundCommand(context, "soundlist", () => {
    S_SoundList(context);
  });
  registerSoundCommand(context, "soundinfo", () => {
    S_SoundInfo(context);
  });

  if (!SNDDMA_Init(context.sound)) {
    removeSoundCommands(context);
    sndDmaPrintf(context, "------------------------------------\n");
    return;
  }

  S_InitScaletable(context.sound);
  context.state.sound_started = 1;
  context.state.snd_initialized = true;
  context.state.num_sfx = 0;
  context.state.soundtime = 0;
  context.sound.state.paintedtime = 0;

  sndDmaPrintf(context, `sound sampling rate: ${context.sound.state.dma.speed}\n`);
  S_StopAllSounds(context);
  sndDmaPrintf(context, "------------------------------------\n");
}

/**
 * Original name: S_Shutdown
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Close
 */
export function S_Shutdown(context: ClientSndDmaContext): void {
  if (!context.state.sound_started) {
    return;
  }

  SNDDMA_Shutdown(context.sound);
  context.state.sound_started = 0;
  context.state.snd_initialized = false;

  removeSoundCommands(context);

  for (let i = 0; i < context.state.num_sfx; i += 1) {
    const sfx = context.state.known_sfx[i];
    if (!sfx.name.length) {
      continue;
    }

    sfx.cache = null;
    sfx.name = "";
    sfx.registration_sequence = 0;
    sfx.truename = null;
  }

  context.state.num_sfx = 0;
}

/**
 * Original name: S_FindName
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Close
 */
export function S_FindName(context: ClientSndDmaContext, name: string | null, create: boolean): sfx_t | null {
  if (!name) {
    sndDmaError(context, ERR_FATAL, "S_FindName: NULL\n");
  }
  if (name.length === 0) {
    sndDmaError(context, ERR_FATAL, "S_FindName: empty name\n");
  }
  if (name.length >= MAX_QPATH) {
    sndDmaError(context, ERR_FATAL, `Sound name too long: ${name}`);
  }

  for (let i = 0; i < context.state.num_sfx; i += 1) {
    if (context.state.known_sfx[i].name === name) {
      return context.state.known_sfx[i];
    }
  }

  if (!create) {
    return null;
  }

  let index = -1;
  for (let i = 0; i < context.state.num_sfx; i += 1) {
    if (context.state.known_sfx[i].name.length === 0) {
      index = i;
      break;
    }
  }

  if (index === -1) {
    if (context.state.num_sfx === MAX_SFX) {
      sndDmaError(context, ERR_FATAL, "S_FindName: out of sfx_t");
    }
    index = context.state.num_sfx;
    context.state.num_sfx += 1;
  }

  const sfx = context.state.known_sfx[index];
  sfx.name = name;
  sfx.registration_sequence = context.state.s_registration_sequence;
  sfx.cache = null;
  sfx.truename = null;
  return sfx;
}

/**
 * Original name: S_AliasName
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Close
 */
export function S_AliasName(context: ClientSndDmaContext, aliasname: string, truename: string): sfx_t {
  let index = -1;
  for (let i = 0; i < context.state.num_sfx; i += 1) {
    if (context.state.known_sfx[i].name.length === 0) {
      index = i;
      break;
    }
  }

  if (index === -1) {
    if (context.state.num_sfx === MAX_SFX) {
      sndDmaError(context, ERR_FATAL, "S_FindName: out of sfx_t");
    }
    index = context.state.num_sfx;
    context.state.num_sfx += 1;
  }

  const sfx = context.state.known_sfx[index];
  sfx.name = aliasname;
  sfx.registration_sequence = context.state.s_registration_sequence;
  sfx.cache = null;
  sfx.truename = `${truename}`;
  return sfx;
}

/**
 * Original name: S_BeginRegistration
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Starts a new registration sequence and defers loading until `S_EndRegistration`.
 */
export function S_BeginRegistration(context: ClientSndDmaContext): void {
  context.state.s_registration_sequence += 1;
  context.state.s_registering = true;
}

/**
 * Original name: S_RegisterSound
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Finds or creates a sound effect and loads it immediately outside registration passes.
 */
export function S_RegisterSound(context: ClientSndDmaContext, name: string): sfx_t | null {
  if (!context.state.sound_started) {
    return null;
  }

  const sfx = S_FindName(context, name, true);
  if (!sfx) {
    return null;
  }

  sfx.registration_sequence = context.state.s_registration_sequence;

  if (!context.state.s_registering) {
    S_LoadSound(context.sound, sfx);
  }

  return sfx;
}

/**
 * Original name: S_EndRegistration
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Drops stale sounds, pages current cached sounds and loads the current registration set.
 *
 * Porting notes:
 * - Uses nullable cache references instead of `Z_Free`; `Com_PageInMemory` is called when a system hook exists.
 */
export function S_EndRegistration(context: ClientSndDmaContext): void {
  for (let i = 0; i < context.state.num_sfx; i += 1) {
    const sfx = context.state.known_sfx[i];
    if (!sfx.name.length) {
      continue;
    }

    if (sfx.registration_sequence !== context.state.s_registration_sequence) {
      detachSfxReferences(context, sfx);
      sfx.cache = null;
      sfx.name = "";
      sfx.truename = null;
      sfx.registration_sequence = 0;
      continue;
    }

    if (sfx.cache && context.system) {
      Com_PageInMemory(context.system, sfx.cache.data, sfx.cache.length * sfx.cache.width);
    }
  }

  for (let i = 0; i < context.state.num_sfx; i += 1) {
    const sfx = context.state.known_sfx[i];
    if (!sfx.name.length) {
      continue;
    }

    S_LoadSound(context.sound, sfx);
  }

  context.state.s_registering = false;
}

/**
 * Original name: S_PickChannel
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Reuses a matching entity channel or chooses the least-lived non-player channel.
 */
export function S_PickChannel(context: ClientSndDmaContext, entnum: number, entchannel: number): channel_t | null {
  if (entchannel < 0) {
    sndDmaError(context, ERR_DROP, "S_PickChannel: entchannel<0");
  }

  let first_to_die = -1;
  let life_left = 0x7fffffff;

  for (let ch_idx = 0; ch_idx < MAX_CHANNELS; ch_idx += 1) {
    const channel = context.sound.state.channels[ch_idx];

    if (
      entchannel !== 0 &&
      channel.entnum === entnum &&
      channel.entchannel === entchannel
    ) {
      first_to_die = ch_idx;
      break;
    }

    if (
      channel.entnum === context.client.cl.playernum + 1 &&
      entnum !== context.client.cl.playernum + 1 &&
      channel.sfx
    ) {
      continue;
    }

    if (channel.end - context.sound.state.paintedtime < life_left) {
      life_left = channel.end - context.sound.state.paintedtime;
      first_to_die = ch_idx;
    }
  }

  if (first_to_die === -1) {
    return null;
  }

  const ch = context.sound.state.channels[first_to_die];
  resetChannel(ch);
  return ch;
}

/**
 * Original name: S_SpatializeOrigin
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Computes stereo left/right volume from listener vectors and distance attenuation.
 */
export function S_SpatializeOrigin(
  context: ClientSndDmaContext,
  origin: vec3_t,
  master_vol: number,
  dist_mult: number
): { left: number; right: number } {
  if (context.client.cls.state !== connstate_t.ca_active) {
    return { left: 255, right: 255 };
  }

  const source_vec: vec3_t = [
    origin[0] - context.sound.state.listener_origin[0],
    origin[1] - context.sound.state.listener_origin[1],
    origin[2] - context.sound.state.listener_origin[2]
  ];

  let dist = normalizeVec3(source_vec);
  dist -= SOUND_FULLVOLUME;
  if (dist < 0) {
    dist = 0;
  }
  dist *= dist_mult;

  const dot =
    context.sound.state.listener_right[0] * source_vec[0] +
    context.sound.state.listener_right[1] * source_vec[1] +
    context.sound.state.listener_right[2] * source_vec[2];

  let rscale: number;
  let lscale: number;

  if (context.sound.state.dma.channels === 1 || !dist_mult) {
    rscale = 1.0;
    lscale = 1.0;
  } else {
    rscale = 0.5 * (1.0 + dot);
    lscale = 0.5 * (1.0 - dot);
  }

  let right = Math.trunc(master_vol * ((1.0 - dist) * rscale));
  if (right < 0) {
    right = 0;
  }

  let left = Math.trunc(master_vol * ((1.0 - dist) * lscale));
  if (left < 0) {
    left = 0;
  }

  return { left, right };
}

/**
 * Original name: S_Spatialize
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Updates a channel's volumes from either a fixed origin or the current entity sound origin.
 */
export function S_Spatialize(context: ClientSndDmaContext, ch: channel_t): void {
  if (ch.entnum === context.client.cl.playernum + 1) {
    ch.leftvol = ch.master_vol;
    ch.rightvol = ch.master_vol;
    return;
  }

  const origin: vec3_t = ch.fixed_origin
    ? [...ch.origin]
    : getEntitySoundOrigin(context, ch.entnum);

  const volumes = S_SpatializeOrigin(context, origin, ch.master_vol, ch.dist_mult);
  ch.leftvol = volumes.left;
  ch.rightvol = volumes.right;
}

/**
 * Original name: S_AllocPlaysound
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Close
 */
export function S_AllocPlaysound(context: ClientSndDmaContext): playsound_t | null {
  const ps = context.state.s_freeplays.next;
  if (!ps || ps === context.state.s_freeplays) {
    return null;
  }

  unlinkPlaySound(ps);
  return ps;
}

/**
 * Original name: S_FreePlaysound
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Close
 */
export function S_FreePlaysound(context: ClientSndDmaContext, ps: playsound_t): void {
  unlinkPlaySound(ps);
  insertAfter(context.state.s_freeplays, ps);
}

/**
 * Original name: S_IssuePlaysound
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Assigns a queued playsound to a mixer channel, spatializes it, and frees the queued node.
 */
export function S_IssuePlaysound(context: ClientSndDmaContext, ps: playsound_t): channel_t | null {
  if ((context.sound.state.s_show?.value ?? 0) !== 0) {
    sndDmaPrintf(context, `Issue ${ps.begin}\n`);
  }

  const ch = S_PickChannel(context, ps.entnum, ps.entchannel);
  if (!ch) {
    S_FreePlaysound(context, ps);
    return null;
  }

  ch.dist_mult = ps.attenuation === ATTN_STATIC ? ps.attenuation * 0.001 : ps.attenuation * 0.0005;
  ch.master_vol = ps.volume;
  ch.entnum = ps.entnum;
  ch.entchannel = ps.entchannel;
  ch.sfx = ps.sfx;
  copyVec3(ps.origin, ch.origin);
  ch.fixed_origin = ps.fixed_origin;

  S_Spatialize(context, ch);

  ch.pos = 0;
  const sc = ch.sfx ? S_LoadSound(context.sound, ch.sfx) : null;
  ch.end = context.sound.state.paintedtime + (sc?.length ?? 0);

  S_FreePlaysound(context, ps);
  return ch;
}

/**
 * Original name: S_RegisterSexedSound
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Resolves player-model-specific sounds and falls back to the male sound alias.
 *
 * Porting notes:
 * - Probes existence through the sound-local filesystem hooks.
 */
export function S_RegisterSexedSound(context: ClientSndDmaContext, entNumber: number, base: string): sfx_t | null {
  let model = "";
  const configIndex = CS_PLAYERSKINS + entNumber - 1;
  const clientSkin = context.client.cl.configstrings[configIndex] ?? "";
  if (clientSkin.length > 0) {
    const slash = clientSkin.indexOf("\\");
    if (slash >= 0) {
      const tail = clientSkin.slice(slash + 1);
      const modelSlash = tail.indexOf("/");
      model = modelSlash >= 0 ? tail.slice(0, modelSlash) : tail;
    }
  }
  if (!model.length) {
    model = "male";
  }

  const sexedFilename = `#players/${model}/${base.slice(1)}`;
  let sfx = S_FindName(context, sexedFilename, false);
  if (sfx) {
    return sfx;
  }

  const probePath = sexedFilename.slice(1);
  const found = context.sound.hooks.onFS_LoadFile?.(probePath) ?? null;
  if (found) {
    context.sound.hooks.onFS_FreeFile?.(found);
    return S_RegisterSound(context, sexedFilename);
  }

  const maleFilename = `player/male/${base.slice(1)}`;
  return S_AliasName(context, sexedFilename, maleFilename);
}

/**
 * Original name: S_StartSound
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Validates one sound effect, loads its cache, builds a pending playsound and schedules it by server time.
 *
 * Porting notes:
 * - Nullable `origin` preserves the original entity-following sound path; dynamic origin lookup occurs at spatialization time.
 */
export function S_StartSound(
  context: ClientSndDmaContext,
  origin: vec3_t | null,
  entnum: number,
  entchannel: number,
  sfx: sfx_t | null,
  fvol: number,
  attenuation: number,
  timeofs: number
): playsound_t | null {
  if (!context.state.sound_started || !sfx) {
    return null;
  }

  if (sfx.name[0] === "*") {
    sfx = S_RegisterSexedSound(context, entnum, sfx.name);
  }
  if (!sfx) {
    return null;
  }

  const sc = S_LoadSound(context.sound, sfx);
  if (!sc) {
    return null;
  }

  const vol = Math.trunc(fvol * 255);
  const ps = S_AllocPlaysound(context);
  if (!ps) {
    return null;
  }

  if (origin) {
    copyVec3(origin, ps.origin);
    ps.fixed_origin = true;
  } else {
    ps.fixed_origin = false;
  }

  ps.entnum = entnum;
  ps.entchannel = entchannel;
  ps.attenuation = attenuation;
  ps.volume = vol;
  ps.sfx = sfx;

  let start = context.client.cl.frame.servertime * 0.001 * context.sound.state.dma.speed + context.state.s_beginofs;
  if (start < context.sound.state.paintedtime) {
    start = context.sound.state.paintedtime;
    context.state.s_beginofs = start - (context.client.cl.frame.servertime * 0.001 * context.sound.state.dma.speed);
  } else if (start > context.sound.state.paintedtime + 0.3 * context.sound.state.dma.speed) {
    start = context.sound.state.paintedtime + 0.1 * context.sound.state.dma.speed;
    context.state.s_beginofs = start - (context.client.cl.frame.servertime * 0.001 * context.sound.state.dma.speed);
  } else {
    context.state.s_beginofs -= 10;
  }

  ps.begin = !timeofs ? context.sound.state.paintedtime : Math.trunc(start + timeofs * context.sound.state.dma.speed);
  insertPendingByBegin(context.sound.state.s_pendingplays, ps);
  return ps;
}

/**
 * Original name: N/A
 * Source: N/A (web audio scheduling helper)
 * Category: New
 * Purpose: Let host adapters issue ready scheduled playsounds without duplicating the `snd_dma.c` queue rules.
 */
export function S_IssueReadyPlaysounds(context: ClientSndDmaContext): channel_t[] {
  const issued: channel_t[] = [];
  const sentinel = context.sound.state.s_pendingplays;

  while (true) {
    const ps = sentinel.next;
    if (!ps || ps === sentinel || ps.begin > context.sound.state.paintedtime) {
      break;
    }

    const channel = S_IssuePlaysound(context, ps);
    if (channel) {
      issued.push(channel);
    }
  }

  return issued;
}

/**
 * Original name: S_StartLocalSound
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Registers a local UI sound and queues it on the listener entity at full volume.
 */
export function S_StartLocalSound(context: ClientSndDmaContext, sound: string): void {
  if (!context.state.sound_started) {
    return;
  }

  const sfx = S_RegisterSound(context, sound);
  if (!sfx) {
    sndDmaPrintf(context, `S_StartLocalSound: can't cache ${sound}\n`);
    return;
  }

  S_StartSound(context, null, context.client.cl.playernum + 1, 0, sfx, 1, 1, 0);
}

/**
 * Original name: S_ClearBuffer
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Clears the DMA buffer with the original 8-bit silence bias or 16-bit zero value.
 */
export function S_ClearBuffer(context: ClientSndDmaContext): void {
  if (!context.state.sound_started) {
    return;
  }

  context.sound.state.s_rawend = 0;
  const clear = context.sound.state.dma.samplebits === 8 ? 0x80 : 0;

  SNDDMA_BeginPainting(context.sound);
  if (context.sound.state.dma.buffer) {
    context.sound.state.dma.buffer.fill(clear, 0, Math.floor(context.sound.state.dma.samples * context.sound.state.dma.samplebits / 8));
  }
  SNDDMA_Submit(context.sound);
}

/**
 * Original name: S_StopAllSounds
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Rebuilds pending/free playsound lists, clears active mixer channels and zeros the DMA buffer.
 */
export function S_StopAllSounds(context: ClientSndDmaContext): void {
  if (!context.state.sound_started) {
    return;
  }

  initializePlaySoundLists(context);

  for (const channel of context.sound.state.channels) {
    resetChannel(channel);
  }

  S_ClearBuffer(context);
}

/**
 * Original name: S_AddLoopSounds
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Rebuilds per-frame entity loop sound channels from the current parsed entity frame.
 * - Merges matching sound indices, spatializes their origins and caps stereo totals to Quake II's 255 range.
 *
 * Porting notes:
 * - Uses the typed client parse-entity ring length instead of the C `MAX_PARSE_ENTITIES` mask constant.
 */
export function S_AddLoopSounds(context: ClientSndDmaContext): void {
  if (context.cl_paused?.value) {
    return;
  }
  if (context.client.cls.state !== connstate_t.ca_active) {
    return;
  }
  if (!context.client.cl.sound_prepped) {
    return;
  }

  const sounds = new Array<number>(context.client.cl.frame.num_entities).fill(0);
  for (let i = 0; i < context.client.cl.frame.num_entities; i += 1) {
    const num = (context.client.cl.frame.parse_entities + i) & (context.client.cl_parse_entities.length - 1);
    sounds[i] = context.client.cl_parse_entities[num].sound;
  }

  for (let i = 0; i < context.client.cl.frame.num_entities; i += 1) {
    if (!sounds[i]) {
      continue;
    }

    const sfx = context.client.cl.sound_precache[sounds[i]] as sfx_t | null;
    if (!sfx?.cache) {
      continue;
    }

    const num = (context.client.cl.frame.parse_entities + i) & (context.client.cl_parse_entities.length - 1);
    const ent = context.client.cl_parse_entities[num];
    let totals = S_SpatializeOrigin(context, ent.origin, 255.0, SOUND_LOOPATTENUATE);
    let left_total = totals.left;
    let right_total = totals.right;

    for (let j = i + 1; j < context.client.cl.frame.num_entities; j += 1) {
      if (sounds[j] !== sounds[i]) {
        continue;
      }
      sounds[j] = 0;
      const otherNum = (context.client.cl.frame.parse_entities + j) & (context.client.cl_parse_entities.length - 1);
      const other = context.client.cl_parse_entities[otherNum];
      totals = S_SpatializeOrigin(context, other.origin, 255.0, SOUND_LOOPATTENUATE);
      left_total += totals.left;
      right_total += totals.right;
    }

    if (left_total === 0 && right_total === 0) {
      continue;
    }

    const ch = S_PickChannel(context, 0, 0);
    if (!ch) {
      return;
    }

    if (left_total > 255) {
      left_total = 255;
    }
    if (right_total > 255) {
      right_total = 255;
    }

    ch.leftvol = left_total;
    ch.rightvol = right_total;
    ch.autosound = true;
    ch.sfx = sfx;
    ch.pos = context.sound.state.paintedtime % sfx.cache.length;
    ch.end = context.sound.state.paintedtime + sfx.cache.length - ch.pos;
  }
}

/**
 * Original name: S_RawSamples
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Streams cinematic or network voice samples into the raw sample ring.
 * - Preserves the original mono/stereo and 8/16-bit conversion paths, including simple rate scaling.
 */
export function S_RawSamples(
  context: ClientSndDmaContext,
  samples: number,
  rate: number,
  width: number,
  channels: number,
  data: Uint8Array
): void {
  if (!context.state.sound_started) {
    return;
  }

  if (context.sound.state.s_rawend < context.sound.state.paintedtime) {
    context.sound.state.s_rawend = context.sound.state.paintedtime;
  }

  const dmaSpeed = context.sound.state.dma.speed || rate;
  const scale = rate / dmaSpeed;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  if (channels === 2 && width === 2 && scale === 1.0) {
    for (let i = 0; i < samples; i += 1) {
      const dst = context.sound.state.s_rawend & (context.sound.state.s_rawsamples.length - 1);
      context.sound.state.s_rawend += 1;
      context.sound.state.s_rawsamples[dst].left = view.getInt16(i * 4, true) << 8;
      context.sound.state.s_rawsamples[dst].right = view.getInt16(i * 4 + 2, true) << 8;
    }
    return;
  }

  for (let i = 0; ; i += 1) {
    const src = Math.trunc(i * scale);
    if (src >= samples) {
      break;
    }

    const dst = context.sound.state.s_rawend & (context.sound.state.s_rawsamples.length - 1);
    context.sound.state.s_rawend += 1;

    if (channels === 2 && width === 2) {
      context.sound.state.s_rawsamples[dst].left = view.getInt16(src * 4, true) << 8;
      context.sound.state.s_rawsamples[dst].right = view.getInt16(src * 4 + 2, true) << 8;
    } else if (channels === 1 && width === 2) {
      const sample = view.getInt16(src * 2, true) << 8;
      context.sound.state.s_rawsamples[dst].left = sample;
      context.sound.state.s_rawsamples[dst].right = sample;
    } else if (channels === 2 && width === 1) {
      context.sound.state.s_rawsamples[dst].left = toSignedByte(data[src * 2]) << 16;
      context.sound.state.s_rawsamples[dst].right = toSignedByte(data[src * 2 + 1]) << 16;
    } else if (channels === 1 && width === 1) {
      const sample = (data[src] - 128) << 16;
      context.sound.state.s_rawsamples[dst].left = sample;
      context.sound.state.s_rawsamples[dst].right = sample;
    }
  }
}

/**
 * Original name: S_Update
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Updates listener vectors, refreshes dynamic channel spatialization, regenerates loop sounds and advances mixing.
 */
export function S_Update(context: ClientSndDmaContext, origin: vec3_t, forward: vec3_t, right: vec3_t, up: vec3_t): void {
  if (!context.state.sound_started) {
    return;
  }

  if (context.client.cls.disable_screen) {
    if (hasExternalDmaFrameClock(context)) {
      GetSoundtime(context);
      context.sound.state.paintedtime = context.state.soundtime;
    }
    S_ClearBuffer(context);
    return;
  }

  if (context.sound.state.s_volume?.modified) {
    S_InitScaletable(context.sound);
  }

  copyVec3(origin, context.sound.state.listener_origin);
  copyVec3(forward, context.sound.state.listener_forward);
  copyVec3(right, context.sound.state.listener_right);
  copyVec3(up, context.sound.state.listener_up);

  for (const ch of context.sound.state.channels) {
    if (!ch.sfx) {
      continue;
    }
    if (ch.autosound) {
      resetChannel(ch);
      continue;
    }

    S_Spatialize(context, ch);
    if (!ch.leftvol && !ch.rightvol) {
      resetChannel(ch);
    }
  }

  S_AddLoopSounds(context);

  if ((context.sound.state.s_show?.value ?? 0) !== 0) {
    let total = 0;
    for (const ch of context.sound.state.channels) {
      if (ch.sfx && (ch.leftvol || ch.rightvol)) {
        sndDmaPrintf(context, `${ch.leftvol} ${ch.rightvol} ${ch.sfx.name}\n`);
        total += 1;
      }
    }
    sndDmaPrintf(context, `----(${total})---- painted: ${context.sound.state.paintedtime}\n`);
  }

  S_Update_(context);
}

/**
 * Original name: GetSoundtime
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Converts the DMA sample cursor into monotonically increasing sound time and tracks DMA buffer wraps.
 */
export function GetSoundtime(context: ClientSndDmaContext): void {
  const fullsamples = Math.trunc(context.sound.state.dma.samples / Math.max(1, context.sound.state.dma.channels));
  const hostDmaFrame = context.sound.hooks.onSNDDMA_GetDMAFrame?.();
  if (hostDmaFrame !== undefined) {
    const soundtime = Math.max(context.state.soundtime, Math.trunc(hostDmaFrame));
    context.state.soundtime = soundtime;
    context.state.buffers = fullsamples > 0 ? Math.trunc(soundtime / fullsamples) : 0;
    context.state.oldsamplepos = fullsamples > 0
      ? (soundtime % fullsamples) * Math.max(1, context.sound.state.dma.channels)
      : 0;
    return;
  }

  const samplepos = SNDDMA_GetDMAPos(context.sound);

  if (samplepos < context.state.oldsamplepos) {
    context.state.buffers += 1;

    if (context.sound.state.paintedtime > 0x40000000) {
      context.state.buffers = 0;
      context.sound.state.paintedtime = fullsamples;
      S_StopAllSounds(context);
    }
  }

  context.state.oldsamplepos = samplepos;
  context.state.soundtime = context.state.buffers * fullsamples + Math.trunc(samplepos / Math.max(1, context.sound.state.dma.channels));
}

/**
 * Original name: S_Update_
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Begins DMA painting, updates sound time, clamps mix-ahead to the DMA buffer and submits mixed samples.
 */
export function S_Update_(context: ClientSndDmaContext): void {
  if (!context.state.sound_started) {
    return;
  }

  SNDDMA_BeginPainting(context.sound);
  if (!context.sound.state.dma.buffer) {
    return;
  }

  GetSoundtime(context);

  if (context.sound.state.paintedtime < context.state.soundtime) {
    if (!hasExternalDmaFrameClock(context)) {
      sndDmaDPrintf(context, "S_Update_ : overflow\n");
    }
    context.sound.state.paintedtime = context.state.soundtime;
  }

  const mixAhead = context.sound.state.s_mixahead?.value ?? 0;
  let endtime = Math.trunc(context.state.soundtime + mixAhead * context.sound.state.dma.speed);
  endtime = (endtime + context.sound.state.dma.submission_chunk - 1) & ~(context.sound.state.dma.submission_chunk - 1);

  const samps = context.sound.state.dma.samples >> (context.sound.state.dma.channels - 1);
  if (endtime - context.state.soundtime > samps) {
    endtime = context.state.soundtime + samps;
  }

  S_PaintChannels(context.sound, endtime);
  SNDDMA_Submit(context.sound);
}

/**
 * Original name: S_Play
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Implements the `play` console command by registering each argument and starting it as a local player sound.
 *
 * Porting notes:
 * - Uses string construction instead of the C `strcpy`/`strcat` scratch buffer.
 */
export function S_Play(context: ClientSndDmaContext): void {
  let i = 1;
  while (i < Cmd_Argc(context.cmd)) {
    const arg = Cmd_Argv(context.cmd, i);
    const name = arg.includes(".") ? arg : `${arg}.wav`;
    const sfx = S_RegisterSound(context, name);
    if (sfx) {
      S_StartSound(context, null, context.client.cl.playernum + 1, 0, sfx, 1.0, 1.0, 0);
    }
    i += 1;
  }
}

/**
 * Original name: S_SoundList
 * Source: Quake-2-master/client/snd_dma.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Implements the `soundlist` console command by listing registered sounds and resident cache bytes.
 *
 * Porting notes:
 * - Returns the computed lines for tests while still emitting the original console output.
 */
export function S_SoundList(context: ClientSndDmaContext): { total: number; lines: string[] } {
  let total = 0;
  const lines: string[] = [];

  for (let i = 0; i < context.state.num_sfx; i += 1) {
    const sfx = context.state.known_sfx[i];
    if (!sfx.registration_sequence) {
      continue;
    }

    const sc = sfx.cache;
    if (sc) {
      const size = sc.length * sc.width * (sc.stereo + 1);
      total += size;
      const bits = `${sc.width * 8}`.padStart(2, " ");
      const byteCount = `${size}`.padStart(6, " ");
      const line = `${sc.loopstart >= 0 ? "L" : " "}(${bits}b) ${byteCount} : ${sfx.name}`;
      lines.push(line);
      sndDmaPrintf(context, `${line}\n`);
      continue;
    }

    const line = sfx.name[0] === "*"
      ? `  placeholder : ${sfx.name}`
      : `  not loaded  : ${sfx.name}`;
    lines.push(line);
    sndDmaPrintf(context, `${line}\n`);
  }

  sndDmaPrintf(context, `Total resident: ${total}\n`);
  return { total, lines };
}

/**
 * Original name: N/A
 * Source: N/A (local hook binding)
 * Category: New
 * Purpose: Connect `snd_loc.ts` declaration adapters back to the owning `snd_dma.c` procedures.
 */
function bindSoundLocalHooks(context: ClientSndDmaContext): void {
  if (!context.sound.hooks.onS_IssuePlaysound) {
    context.sound.hooks.onS_IssuePlaysound = (ps) => {
      S_IssuePlaysound(context, ps);
    };
  }
  if (!context.sound.hooks.onS_PickChannel) {
    context.sound.hooks.onS_PickChannel = (entnum, entchannel) => S_PickChannel(context, entnum, entchannel);
  }
  if (!context.sound.hooks.onS_Spatialize) {
    context.sound.hooks.onS_Spatialize = (channel) => {
      S_Spatialize(context, channel);
    };
  }
}

/**
 * Original name: N/A
 * Source: N/A (command registration helper)
 * Category: New
 * Purpose: Register one sound console command without replacing an existing command binding.
 */
function registerSoundCommand(context: ClientSndDmaContext, name: string, callback: () => void): void {
  if (!Cmd_Exists(context.cmd, name)) {
    Cmd_AddCommand(context.cmd, name, callback);
  }
}

/**
 * Original name: N/A
 * Source: N/A (command cleanup helper)
 * Category: New
 * Purpose: Remove the console commands installed by `S_Init`.
 */
function removeSoundCommands(context: ClientSndDmaContext): void {
  if (Cmd_Exists(context.cmd, "play")) {
    Cmd_RemoveCommand(context.cmd, "play");
  }
  if (Cmd_Exists(context.cmd, "stopsound")) {
    Cmd_RemoveCommand(context.cmd, "stopsound");
  }
  if (Cmd_Exists(context.cmd, "soundlist")) {
    Cmd_RemoveCommand(context.cmd, "soundlist");
  }
  if (Cmd_Exists(context.cmd, "soundinfo")) {
    Cmd_RemoveCommand(context.cmd, "soundinfo");
  }
}

/**
 * Original name: N/A
 * Source: N/A (playsound list helper)
 * Category: New
 * Purpose: Rebuild the free and pending playsound linked-list sentinels from the explicit state arrays.
 */
function initializePlaySoundLists(context: ClientSndDmaContext): void {
  for (const ps of context.state.s_playsounds) {
    resetPlaySound(ps);
  }

  resetPlaySound(context.state.s_freeplays);
  resetPlaySound(context.sound.state.s_pendingplays);
  context.state.s_freeplays.next = context.state.s_freeplays;
  context.state.s_freeplays.prev = context.state.s_freeplays;
  context.sound.state.s_pendingplays.next = context.sound.state.s_pendingplays;
  context.sound.state.s_pendingplays.prev = context.sound.state.s_pendingplays;

  for (const ps of context.state.s_playsounds) {
    insertAfter(context.state.s_freeplays, ps);
  }
}

/**
 * Original name: N/A
 * Source: N/A (host DMA clock adapter)
 * Category: New
 * Purpose: Detect browser/host DMA clocks where elapsed output time may advance while Quake is not painting.
 */
function hasExternalDmaFrameClock(context: ClientSndDmaContext): boolean {
  return context.sound.hooks.onSNDDMA_GetDMAFrame !== undefined;
}

/**
 * Original name: N/A
 * Source: N/A (TypeScript lifetime guard around `S_EndRegistration`)
 * Category: New
 * Purpose: Drop active channel and pending playsound references before a stale `sfx_t` is cleared.
 *
 * Constraints:
 * - Preserve `S_EndRegistration` ownership while avoiding empty-name sound handles in the mixer.
 */
function detachSfxReferences(context: ClientSndDmaContext, sfx: sfx_t): void {
  for (const channel of context.sound.state.channels) {
    if (channel.sfx === sfx) {
      resetChannel(channel);
    }
  }

  const sentinel = context.sound.state.s_pendingplays;
  let ps = sentinel.next;
  while (ps && ps !== sentinel) {
    const next = ps.next;
    if (ps.sfx === sfx) {
      unlinkPlaySound(ps);
      resetPlaySound(ps);
      insertAfter(context.state.s_freeplays, ps);
    }
    ps = next;
  }

  for (let i = 0; i < context.client.cl.sound_precache.length; i += 1) {
    if (context.client.cl.sound_precache[i] === sfx) {
      context.client.cl.sound_precache[i] = null;
    }
  }
}

/**
 * Original name: N/A
 * Source: N/A (playsound list helper)
 * Category: New
 * Purpose: Insert a scheduled playsound into the pending list sorted by its begin time.
 */
function insertPendingByBegin(sentinel: playsound_t, ps: playsound_t): void {
  let sort = sentinel.next;
  while (sort && sort !== sentinel && sort.begin < ps.begin) {
    sort = sort.next;
  }

  if (!sort) {
    sort = sentinel;
  }

  ps.next = sort;
  ps.prev = sort.prev ?? sentinel;
  if (ps.next) {
    ps.next.prev = ps;
  }
  if (ps.prev) {
    ps.prev.next = ps;
  }
}

/**
 * Original name: N/A
 * Source: N/A (linked-list helper)
 * Category: New
 * Purpose: Insert one playsound node after a sentinel in the explicit linked-list representation.
 */
function insertAfter(sentinel: playsound_t, ps: playsound_t): void {
  const next = sentinel.next ?? sentinel;
  ps.next = next;
  ps.prev = sentinel;
  next.prev = ps;
  sentinel.next = ps;
}

/**
 * Original name: N/A
 * Source: N/A (linked-list helper)
 * Category: New
 * Purpose: Detach one playsound node from whichever list currently owns it.
 */
function unlinkPlaySound(ps: playsound_t): void {
  if (ps.prev) {
    ps.prev.next = ps.next;
  }
  if (ps.next) {
    ps.next.prev = ps.prev;
  }
  ps.prev = null;
  ps.next = null;
}

/**
 * Original name: N/A
 * Source: N/A (state reset helper)
 * Category: New
 * Purpose: Reset one playsound node to the empty values expected before reuse.
 */
function resetPlaySound(ps: playsound_t): void {
  ps.prev = null;
  ps.next = null;
  ps.sfx = null;
  ps.volume = 0;
  ps.attenuation = 0;
  ps.entnum = 0;
  ps.entchannel = 0;
  ps.fixed_origin = false;
  ps.origin[0] = 0;
  ps.origin[1] = 0;
  ps.origin[2] = 0;
  ps.begin = 0;
}

/**
 * Original name: N/A
 * Source: N/A (state reset helper)
 * Category: New
 * Purpose: Reset one mixer channel using the same defaults as a freshly created channel.
 */
function resetChannel(channel: channel_t): void {
  const reset = createChannel();
  channel.sfx = reset.sfx;
  channel.leftvol = reset.leftvol;
  channel.rightvol = reset.rightvol;
  channel.end = reset.end;
  channel.pos = reset.pos;
  channel.looping = reset.looping;
  channel.entnum = reset.entnum;
  channel.entchannel = reset.entchannel;
  copyVec3(reset.origin, channel.origin);
  channel.dist_mult = reset.dist_mult;
  channel.master_vol = reset.master_vol;
  channel.fixed_origin = reset.fixed_origin;
  channel.autosound = reset.autosound;
}

/**
 * Original name: CL_GetEntitySoundOrigin
 * Source: Quake-2-master/client/sound.h
 * Category: Adapter
 * Fidelity level: Close
 *
 * Behavior:
 * - Reads entity sound origins from a host hook or the client entity lerp origin array.
 */
function getEntitySoundOrigin(context: ClientSndDmaContext, ent: number): vec3_t {
  const hooked = context.hooks.onGetEntitySoundOrigin?.(ent);
  if (hooked) {
    return [...hooked];
  }

  if (ent < 0 || ent >= context.client.cl_entities.length) {
    sndDmaError(context, ERR_DROP, "CL_GetEntitySoundOrigin: bad ent");
  }

  return [...context.client.cl_entities[ent].lerp_origin];
}

/**
 * Original name: N/A
 * Source: N/A (vector helper)
 * Category: New
 * Purpose: Copy a Quake vector without sharing the backing array.
 */
function copyVec3(source: vec3_t, target: vec3_t): void {
  target[0] = source[0];
  target[1] = source[1];
  target[2] = source[2];
}

/**
 * Original name: N/A
 * Source: N/A (vector helper)
 * Category: New
 * Purpose: Normalize a Quake vector in place and return its original length.
 */
function normalizeVec3(vector: vec3_t): number {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length === 0) {
    vector[0] = 0;
    vector[1] = 0;
    vector[2] = 0;
    return 0;
  }

  vector[0] /= length;
  vector[1] /= length;
  vector[2] /= length;
  return length;
}

/**
 * Original name: N/A
 * Source: N/A (sample conversion helper)
 * Category: New
 * Purpose: Reinterpret one unsigned byte as a signed 8-bit sample.
 */
function toSignedByte(value: number): number {
  return (value << 24) >> 24;
}

/**
 * Original name: N/A
 * Source: N/A (console adapter)
 * Category: New
 * Purpose: Route regular sound console output through the injected qcommon hook.
 */
function sndDmaPrintf(context: ClientSndDmaContext, message: string): void {
  context.sound.hooks.onComPrintf?.(message);
}

/**
 * Original name: N/A
 * Source: N/A (console adapter)
 * Category: New
 * Purpose: Route developer sound console output through the injected qcommon hook.
 */
function sndDmaDPrintf(context: ClientSndDmaContext, message: string): void {
  context.sound.hooks.onComDPrintf?.(message);
}

/**
 * Original name: N/A
 * Source: N/A (error adapter)
 * Category: New
 * Purpose: Route sound fatal/drop errors through the injected qcommon hook or throw in tests.
 */
function sndDmaError(context: ClientSndDmaContext, code: number, message: string): never {
  if (context.sound.hooks.onComError) {
    return context.sound.hooks.onComError(code, message);
  }

  throw new Error(message);
}
