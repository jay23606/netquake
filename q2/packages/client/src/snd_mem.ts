/**
 * File: snd_mem.ts
 * Source: Quake II original / client/snd_mem.c
 * Purpose: Port WAV parsing, sound-effect loading and resampling for the client sound cache.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses `Uint8Array`/`DataView` instead of pointer arithmetic over raw C structs.
 * - Falls back to the input sample rate when `dma.speed` is still unset, until `snd_dma.c` fully owns sound-device initialization.
 *
 * Notes:
 * - This file is the principal attachment point for `client/snd_mem.c`.
 */

import { ERR_DROP } from "../../qcommon/src/index.js";
import type { ClientSoundLocalContext, sfx_t, sfxcache_t, wavinfo_t } from "./snd_loc.js";

/**
 * Original name: cache_full_cycle
 * Source: Quake-2-master/client/snd_mem.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Preserves the original sound-cache cycle global as the owner for `client/snd_mem.c`.
 *
 * Porting notes:
 * - Kept exported for parity with the original symbol even though the current runtime does not mutate it.
 */
export let cache_full_cycle = 0;

/**
 * Original name: N/A
 * Source: N/A (sound host hooks)
 * Category: New
 * Purpose: Carry the host callbacks needed by the `snd_mem.c` port.
 *
 * Constraints:
 * - File loading and diagnostic output must remain injectable until the full client sound runtime is closed.
 */
export interface ClientSndMemHooks {
  onFS_LoadFile?: (path: string) => Uint8Array | null | undefined;
  onFS_FreeFile?: (buffer: Uint8Array) => void;
  onComPrintf?: (message: string) => void;
  onComDPrintf?: (message: string) => void;
  onComError?: (code: number, message: string) => never;
}

/**
 * Original name: N/A
 * Source: N/A (local parser state)
 * Category: New
 * Purpose: Replace the file-static RIFF parser pointers from `snd_mem.c` with explicit state.
 */
interface IffParseState {
  data_p: number | null;
  iff_end: number;
  last_chunk: number;
  iff_data: number;
  iff_chunk_len: number;
}

/**
 * Original name: ResampleSfx
 * Source: Quake-2-master/client/snd_mem.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Resamples one cached sound effect into the current DMA sample rate and width.
 *
 * Porting notes:
 * - Uses `DataView`/typed-array writes instead of C pointer casts while preserving sample conversion rules.
 */
export function ResampleSfx(
  context: ClientSoundLocalContext,
  sfx: sfx_t,
  inrate: number,
  inwidth: number,
  data: Uint8Array
): void {
  const sc = sfx.cache;
  if (!sc) {
    return;
  }

  const dmaSpeed = getActiveDmaSpeed(context, inrate);
  const stepscale = inrate / dmaSpeed;
  const outcount = Math.trunc(sc.length / stepscale);

  sc.length = outcount;
  if (sc.loopstart !== -1) {
    sc.loopstart = Math.trunc(sc.loopstart / stepscale);
  }

  sc.speed = dmaSpeed;
  sc.width = context.state.s_loadas8bit?.value ? 1 : inwidth;
  sc.stereo = 0;

  const signedOutput = new Int8Array(sc.data.buffer, sc.data.byteOffset, sc.data.byteLength);
  const outputView = new DataView(sc.data.buffer, sc.data.byteOffset, sc.data.byteLength);
  const inputView = new DataView(data.buffer, data.byteOffset, data.byteLength);

  if (stepscale === 1 && inwidth === 1 && sc.width === 1) {
    for (let i = 0; i < outcount; i += 1) {
      signedOutput[i] = data[i] - 128;
    }
    return;
  }

  let samplefrac = 0;
  const fracstep = Math.trunc(stepscale * 256);

  for (let i = 0; i < outcount; i += 1) {
    const srcsample = samplefrac >> 8;
    samplefrac += fracstep;

    let sample: number;
    if (inwidth === 2) {
      sample = inputView.getInt16(srcsample * 2, true);
    } else {
      sample = (data[srcsample] - 128) << 8;
    }

    if (sc.width === 2) {
      outputView.setInt16(i * 2, sample, true);
    } else {
      signedOutput[i] = sample >> 8;
    }
  }
}

/**
 * Original name: S_LoadSound
 * Source: Quake-2-master/client/snd_mem.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Loads one WAV sound effect through the filesystem, parses its metadata and caches the resampled PCM payload.
 *
 * Porting notes:
 * - Uses injected filesystem hooks instead of the global `FS_LoadFile` / `FS_FreeFile` procedures.
 */
export function S_LoadSound(context: ClientSoundLocalContext, s: sfx_t): sfxcache_t | null {
  const hooks = getSndMemHooks(context);

  if (s.name[0] === "*") {
    return null;
  }

  const cached = s.cache;
  if (cached) {
    return cached;
  }

  const name = s.truename ?? s.name;
  const resolvedName = name[0] === "#" ? name.slice(1) : `sound/${name}`;

  const data = hooks.onFS_LoadFile?.(resolvedName) ?? null;
  if (!data) {
    hooks.onComDPrintf?.(`Couldn't load ${resolvedName}\n`);
    return null;
  }

  const info = GetWavinfo(s.name, data, data.length, hooks);
  if (info.channels !== 1) {
    hooks.onComPrintf?.(`${s.name} is a stereo sample\n`);
    hooks.onFS_FreeFile?.(data);
    return null;
  }

  const dmaSpeed = getActiveDmaSpeed(context, info.rate);
  const stepscale = info.rate / dmaSpeed;
  let len = Math.trunc(info.samples / stepscale);
  len = len * info.width * info.channels;

  const sc: sfxcache_t = {
    length: info.samples,
    loopstart: info.loopstart,
    speed: info.rate,
    width: info.width,
    stereo: info.channels,
    data: new Uint8Array(Math.max(0, len))
  };

  s.cache = sc;
  ResampleSfx(context, s, sc.speed, sc.width, data.subarray(info.dataofs));
  hooks.onFS_FreeFile?.(data);

  return sc;
}

/**
 * Original name: DumpChunks
 * Source: Quake-2-master/client/snd_mem.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Enumerates the chunks contained in one WAV/RIFF byte stream for diagnostics.
 *
 * Porting notes:
 * - Returns formatted lines instead of printing directly.
 */
export function DumpChunks(wav: Uint8Array, wavlength = wav.length): string[] {
  const state = createIffParseState(wavlength);
  const lines: string[] = [];

  state.iff_data = 0;
  state.iff_end = Math.min(wav.length, wavlength);
  FindChunk(wav, state, "RIFF");
  if (state.data_p !== null && readChunkName(wav, state.data_p + 8) === "WAVE") {
    state.iff_data = state.data_p + 12;
  }
  state.data_p = state.iff_data;

  while (state.data_p < state.iff_end) {
    const name = readChunkName(wav, state.data_p);
    state.data_p += 4;
    state.iff_chunk_len = GetLittleLong(wav, state);
    lines.push(`0x${(state.data_p - 4).toString(16)} : ${name} (${state.iff_chunk_len})`);
    state.data_p += (state.iff_chunk_len + 1) & ~1;
  }

  return lines;
}

/**
 * Original name: GetWavinfo
 * Source: Quake-2-master/client/snd_mem.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Parses one RIFF/WAVE buffer and returns the Quake II WAV metadata block.
 *
 * Porting notes:
 * - Uses integer offsets instead of file-static pointer globals while preserving chunk walk order.
 */
export function GetWavinfo(
  name: string,
  wav: Uint8Array,
  wavlength: number,
  hooks: ClientSndMemHooks = {}
): wavinfo_t {
  const info: wavinfo_t = {
    rate: 0,
    width: 0,
    channels: 0,
    loopstart: -1,
    samples: 0,
    dataofs: 0
  };

  if (wavlength <= 0) {
    return info;
  }

  const state = createIffParseState(wavlength);
  state.iff_data = 0;

  FindChunk(wav, state, "RIFF");
  if (!(state.data_p !== null && readChunkName(wav, state.data_p + 8) === "WAVE")) {
    hooks.onComPrintf?.("Missing RIFF/WAVE chunks\n");
    return info;
  }

  state.iff_data = state.data_p + 12;

  FindChunk(wav, state, "fmt ");
  if (state.data_p === null) {
    hooks.onComPrintf?.("Missing fmt chunk\n");
    return info;
  }

  state.data_p += 8;
  const format = GetLittleShort(wav, state);
  if (format !== 1) {
    hooks.onComPrintf?.("Microsoft PCM format only\n");
    return info;
  }

  info.channels = GetLittleShort(wav, state);
  info.rate = GetLittleLong(wav, state);
  state.data_p += 4 + 2;
  info.width = GetLittleShort(wav, state) / 8;

  FindChunk(wav, state, "cue ");
  if (state.data_p !== null) {
    state.data_p += 32;
    info.loopstart = GetLittleLong(wav, state);

    FindNextChunk(wav, state, "LIST");
    if (state.data_p !== null && readChunkName(wav, state.data_p + 28) === "mark") {
      state.data_p += 24;
      const loopSamples = GetLittleLong(wav, state);
      info.samples = info.loopstart + loopSamples;
    }
  } else {
    info.loopstart = -1;
  }

  FindChunk(wav, state, "data");
  if (state.data_p === null) {
    hooks.onComPrintf?.("Missing data chunk\n");
    return info;
  }

  state.data_p += 4;
  const samples = Math.trunc(GetLittleLong(wav, state) / Math.max(1, info.width));

  if (info.samples !== 0) {
    if (samples < info.samples) {
      emitSndMemError(hooks, ERR_DROP, `Sound ${name} has a bad loop length`);
    }
  } else {
    info.samples = samples;
  }

  info.dataofs = state.data_p;
  return info;
}

/**
 * Original name: GetLittleShort
 * Source: Quake-2-master/client/snd_mem.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Reads one signed little-endian 16-bit value from the current RIFF parser cursor and advances it.
 *
 * Porting notes:
 * - Uses `IffParseState.data_p` instead of the original file-static `data_p` pointer.
 */
function GetLittleShort(wav: Uint8Array, state: IffParseState): number {
  const data_p = requireDataPointer(state);
  if (data_p + 2 > state.iff_end || data_p + 2 > wav.length) {
    state.data_p = null;
    return 0;
  }
  const value = wav[data_p] | (wav[data_p + 1] << 8);
  state.data_p = data_p + 2;
  return (value << 16) >> 16;
}

/**
 * Original name: GetLittleLong
 * Source: Quake-2-master/client/snd_mem.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Reads one signed little-endian 32-bit value from the current RIFF parser cursor and advances it.
 *
 * Porting notes:
 * - Uses `IffParseState.data_p` instead of the original file-static `data_p` pointer.
 */
function GetLittleLong(wav: Uint8Array, state: IffParseState): number {
  const data_p = requireDataPointer(state);
  if (data_p + 4 > state.iff_end || data_p + 4 > wav.length) {
    state.data_p = null;
    return 0;
  }
  const value =
    wav[data_p] |
    (wav[data_p + 1] << 8) |
    (wav[data_p + 2] << 16) |
    (wav[data_p + 3] << 24);
  state.data_p = data_p + 4;
  return value | 0;
}

/**
 * Original name: FindNextChunk
 * Source: Quake-2-master/client/snd_mem.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Walks RIFF chunks from `last_chunk`, records each chunk length, and stops on the requested fourCC.
 *
 * Porting notes:
 * - Keeps the original odd-length padding rule and null-cursor failure state through `IffParseState`.
 */
function FindNextChunk(wav: Uint8Array, state: IffParseState, name: string): void {
  while (true) {
    state.data_p = state.last_chunk;

    if (state.data_p >= state.iff_end) {
      state.data_p = null;
      return;
    }

    state.data_p += 4;
    state.iff_chunk_len = GetLittleLong(wav, state);
    if (state.data_p === null) {
      return;
    }
    if (state.iff_chunk_len < 0) {
      state.data_p = null;
      return;
    }

    state.data_p -= 8;
    state.last_chunk = state.data_p + 8 + ((state.iff_chunk_len + 1) & ~1);
    if (readChunkName(wav, state.data_p) === name) {
      return;
    }
  }
}

/**
 * Original name: FindChunk
 * Source: Quake-2-master/client/snd_mem.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Restarts chunk scanning from the active RIFF data base and delegates to `FindNextChunk`.
 *
 * Porting notes:
 * - Preserves the source ownership while making the formerly file-static parser state explicit.
 */
function FindChunk(wav: Uint8Array, state: IffParseState, name: string): void {
  state.last_chunk = state.iff_data;
  FindNextChunk(wav, state, name);
}

/**
 * Original name: N/A
 * Source: N/A (local parser helper)
 * Category: New
 * Purpose: Build explicit RIFF parser state for helpers that were file-static in C.
 */
function createIffParseState(wavlength: number): IffParseState {
  return {
    data_p: 0,
    iff_end: wavlength,
    last_chunk: 0,
    iff_data: 0,
    iff_chunk_len: 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (local parser helper)
 * Category: New
 * Purpose: Read a RIFF fourCC safely from a byte buffer.
 */
function readChunkName(wav: Uint8Array, offset: number): string {
  if (offset < 0 || offset + 4 > wav.length) {
    return "";
  }

  return String.fromCharCode(wav[offset], wav[offset + 1], wav[offset + 2], wav[offset + 3]);
}

/**
 * Original name: N/A
 * Source: N/A (local parser helper)
 * Category: New
 * Purpose: Guard the explicit RIFF parser cursor before little-endian reads.
 */
function requireDataPointer(state: IffParseState): number {
  if (state.data_p === null) {
    throw new Error("snd_mem: null data pointer");
  }

  return state.data_p;
}

/**
 * Original name: N/A
 * Source: N/A (sound host hooks)
 * Category: New
 * Purpose: Project the broader sound-local hooks object into the callbacks used by `snd_mem.ts`.
 */
function getSndMemHooks(context: ClientSoundLocalContext): ClientSndMemHooks {
  const hooks: ClientSndMemHooks = {};

  if (context.hooks.onFS_LoadFile) {
    hooks.onFS_LoadFile = context.hooks.onFS_LoadFile;
  }
  if (context.hooks.onFS_FreeFile) {
    hooks.onFS_FreeFile = context.hooks.onFS_FreeFile;
  }
  if (context.hooks.onComPrintf) {
    hooks.onComPrintf = context.hooks.onComPrintf;
  }
  if (context.hooks.onComDPrintf) {
    hooks.onComDPrintf = context.hooks.onComDPrintf;
  }
  if (context.hooks.onComError) {
    hooks.onComError = context.hooks.onComError;
  }

  return hooks;
}

/**
 * Original name: N/A
 * Source: N/A (sound runtime guard)
 * Category: New
 * Purpose: Use the active DMA speed, or the input sample rate before DMA initialization has completed.
 */
function getActiveDmaSpeed(context: ClientSoundLocalContext, fallbackRate: number): number {
  return context.state.dma.speed > 0 ? context.state.dma.speed : fallbackRate;
}

/**
 * Original name: N/A
 * Source: N/A (sound host hooks)
 * Category: New
 * Purpose: Route fatal WAV parse errors through the injected host callback when available.
 */
function emitSndMemError(hooks: ClientSndMemHooks, code: number, message: string): never {
  if (hooks.onComError) {
    return hooks.onComError(code, message);
  }

  throw new Error(message);
}
