/**
 * File: snd_mix.ts
 * Source: Quake II original / client/snd_mix.c
 * Purpose: Port the portable channel mixing and DMA transfer code used by the client sound subsystem.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses an explicit per-runtime mix state instead of file-static globals.
 * - Uses typed arrays and `DataView` writes instead of pointer casts and platform asm paths.
 *
 * Notes:
 * - This file is the principal attachment point for `client/snd_mix.c`.
 */

import type {
  channel_t,
  ClientSoundLocalContext,
  playsound_t,
  portable_samplepair_t,
  sfxcache_t
} from "./snd_loc.js";
import { MAX_CHANNELS, MAX_RAW_SAMPLES, S_IssuePlaysound, S_LoadSound } from "./snd_loc.js";

/**
 * Original name: PAINTBUFFER_SIZE
 * Source: Quake-2-master/client/snd_mix.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Preserves the fixed number of portable sample pairs mixed before each DMA transfer chunk.
 */
export const PAINTBUFFER_SIZE = 2048;

/**
 * Original name: N/A
 * Source: N/A (explicit mix state)
 * Category: New
 * Purpose: Store the mutable working buffers and scratch scalars used by the `snd_mix.c` port.
 *
 * Constraints:
 * - Must preserve the original fixed paintbuffer size and 32x256 scale table shape.
 */
export interface ClientSoundMixState {
  paintbuffer: portable_samplepair_t[];
  snd_scaletable: Int32Array[];
  snd_p: Int32Array;
  snd_linear_count: number;
  snd_vol: number;
}

/**
 * Original name: N/A
 * Source: N/A (explicit mix state)
 * Category: New
 * Purpose: Create the default explicit mix state used by the `snd_mix.c` port.
 *
 * Constraints:
 * - The paintbuffer and scaletable sizes must remain aligned with the original code.
 */
export function createClientSoundMixState(): ClientSoundMixState {
  return {
    paintbuffer: Array.from({ length: PAINTBUFFER_SIZE }, () => ({ left: 0, right: 0 })),
    snd_scaletable: Array.from({ length: 32 }, () => new Int32Array(256)),
    snd_p: new Int32Array(0),
    snd_linear_count: 0,
    snd_vol: 0
  };
}

/**
 * Original name: S_WriteLinearBlastStereo16
 * Source: Quake-2-master/client/snd_mix.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Clamps and writes the current linear stereo mix block into one 16-bit DMA segment.
 */
export function S_WriteLinearBlastStereo16(
  context: ClientSoundLocalContext,
  out: Int16Array,
  outOffset: number
): void {
  const { snd_p, snd_linear_count } = context.state.mix;

  for (let i = 0; i < snd_linear_count; i += 2) {
    out[outOffset + i] = clampPaintSample16(snd_p[i] >> 8);
    out[outOffset + i + 1] = clampPaintSample16(snd_p[i + 1] >> 8);
  }
}

/**
 * Original name: S_TransferStereo16
 * Source: Quake-2-master/client/snd_mix.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Transfers the current paintbuffer block into a recirculating stereo 16-bit DMA buffer.
 */
export function S_TransferStereo16(context: ClientSoundLocalContext, endtime: number): void {
  if (!context.state.dma.buffer) {
    return;
  }

  const out = new Int16Array(
    context.state.dma.buffer.buffer,
    context.state.dma.buffer.byteOffset,
    Math.floor(context.state.dma.buffer.byteLength / 2)
  );
  const mix = context.state.mix;
  const paint = flattenPaintbuffer(context.state.mix.paintbuffer, endtime - context.state.paintedtime);

  let lpaintedtime = context.state.paintedtime;
  let paintOffset = 0;

  while (lpaintedtime < endtime) {
    const lpos = lpaintedtime & ((context.state.dma.samples >> 1) - 1);
    const maxLinearCount = (context.state.dma.samples >> 1) - lpos;
    let linearSamples = maxLinearCount;
    if (lpaintedtime + linearSamples > endtime) {
      linearSamples = endtime - lpaintedtime;
    }

    mix.snd_linear_count = linearSamples << 1;
    mix.snd_p = paint.subarray(paintOffset, paintOffset + mix.snd_linear_count);
    S_WriteLinearBlastStereo16(context, out, lpos << 1);

    paintOffset += mix.snd_linear_count;
    lpaintedtime += linearSamples;
  }
}

/**
 * Original name: S_TransferPaintBuffer
 * Source: Quake-2-master/client/snd_mix.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Transfers the current paintbuffer range into the active DMA buffer format.
 *
 * Porting notes:
 * - Keeps the optimized stereo16 path while using typed arrays for the general transfer path.
 */
export function S_TransferPaintBuffer(context: ClientSoundLocalContext, endtime: number): void {
  const dma = context.state.dma;
  if (!dma.buffer) {
    return;
  }

  if (context.state.s_testsound?.value) {
    const count = endtime - context.state.paintedtime;
    for (let i = 0; i < count; i += 1) {
      const sample = Math.sin((context.state.paintedtime + i) * 0.1) * 20000 * 256;
      context.state.mix.paintbuffer[i].left = sample;
      context.state.mix.paintbuffer[i].right = sample;
    }
  }

  if (dma.samplebits === 16 && dma.channels === 2) {
    S_TransferStereo16(context, endtime);
    return;
  }

  const count = (endtime - context.state.paintedtime) * dma.channels;
  const out_mask = dma.samples - 1;
  let out_idx = (context.state.paintedtime * dma.channels) & out_mask;
  const step = 3 - dma.channels;
  const paint = flattenPaintbuffer(context.state.mix.paintbuffer, endtime - context.state.paintedtime);
  let paintIndex = 0;

  if (dma.samplebits === 16) {
    const out = new Int16Array(dma.buffer.buffer, dma.buffer.byteOffset, Math.floor(dma.buffer.byteLength / 2));

    for (let i = 0; i < count; i += 1) {
      const val = clampPaintSample16(paint[paintIndex] >> 8);
      paintIndex += step;
      out[out_idx] = val;
      out_idx = (out_idx + 1) & out_mask;
    }
    return;
  }

  if (dma.samplebits === 8) {
    for (let i = 0; i < count; i += 1) {
      const val = clampPaintSample16(paint[paintIndex] >> 8);
      paintIndex += step;
      dma.buffer[out_idx] = ((val >> 8) + 128) & 0xff;
      out_idx = (out_idx + 1) & out_mask;
    }
  }
}

/**
 * Original name: S_PaintChannels
 * Source: Quake-2-master/client/snd_mix.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Mixes pending streaming/raw samples and active channels into the paintbuffer, then transfers them into DMA.
 *
 * Porting notes:
 * - Accepts null sentinels in the still-partial `s_pendingplays` list representation.
 */
export function S_PaintChannels(context: ClientSoundLocalContext, endtime: number): void {
  context.state.mix.snd_vol = (context.state.s_volume?.value ?? 0) * 256;

  while (context.state.paintedtime < endtime) {
    let end = endtime;
    if (endtime - context.state.paintedtime > PAINTBUFFER_SIZE) {
      end = context.state.paintedtime + PAINTBUFFER_SIZE;
    }

    while (true) {
      const ps = getPendingPlayHead(context.state.s_pendingplays);
      if (!ps) {
        break;
      }

      if (ps.begin <= context.state.paintedtime) {
        const nextBeforeIssue = ps.next;
        S_IssuePlaysound(context, ps);
        if (getPendingPlayHead(context.state.s_pendingplays) === ps) {
          unlinkPendingPlay(context.state.s_pendingplays, ps, nextBeforeIssue);
        }
        continue;
      }

      if (ps.begin < end) {
        end = ps.begin;
      }
      break;
    }

    clearOrPrimePaintbuffer(context, end);

    for (let i = 0; i < MAX_CHANNELS; i += 1) {
      const ch = context.state.channels[i];
      let ltime = context.state.paintedtime;

      while (ltime < end) {
        if (!ch.sfx || (!ch.leftvol && !ch.rightvol)) {
          break;
        }

        let count = end - ltime;
        if (ch.end - ltime < count) {
          count = ch.end - ltime;
        }

        const sc = S_LoadSound(context, ch.sfx);
        if (!sc) {
          break;
        }

        if (count > 0 && ch.sfx) {
          if (sc.width === 1) {
            S_PaintChannelFrom8(context, ch, sc, count, ltime - context.state.paintedtime);
          } else {
            S_PaintChannelFrom16(context, ch, sc, count, ltime - context.state.paintedtime);
          }

          ltime += count;
        }

        if (ltime >= ch.end) {
          if (ch.autosound) {
            ch.pos = 0;
            ch.end = ltime + sc.length;
          } else if (sc.loopstart >= 0) {
            ch.pos = sc.loopstart;
            ch.end = ltime + sc.length - ch.pos;
          } else {
            ch.sfx = null;
          }
        }
      }
    }

    S_TransferPaintBuffer(context, end);
    context.state.paintedtime = end;
  }
}

/**
 * Original name: S_InitScaletable
 * Source: Quake-2-master/client/snd_mix.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Rebuilds the 32x256 lookup table used by 8-bit sample mixing.
 */
export function S_InitScaletable(context: ClientSoundLocalContext): void {
  const volume = context.state.s_volume?.value ?? 0;
  if (context.state.s_volume) {
    context.state.s_volume.modified = false;
  }

  for (let i = 0; i < 32; i += 1) {
    const scale = i * 8 * 256 * volume;
    const row = context.state.mix.snd_scaletable[i];
    for (let j = 0; j < 256; j += 1) {
      row[j] = toSignedByte(j) * scale;
    }
  }
}

/**
 * Original name: S_PaintChannelFrom8
 * Source: Quake-2-master/client/snd_mix.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Mixes one 8-bit cached sound effect range into the paintbuffer.
 */
export function S_PaintChannelFrom8(
  context: ClientSoundLocalContext,
  ch: channel_t,
  sc: sfxcache_t,
  count: number,
  offset: number
): void {
  if (ch.leftvol > 255) {
    ch.leftvol = 255;
  }
  if (ch.rightvol > 255) {
    ch.rightvol = 255;
  }

  const lscale = context.state.mix.snd_scaletable[ch.leftvol >> 11];
  const rscale = context.state.mix.snd_scaletable[ch.rightvol >> 11];
  const sampleBase = ch.pos;

  for (let i = 0; i < count; i += 1) {
    const data = sc.data[sampleBase + i] ?? 0;
    const samp = context.state.mix.paintbuffer[offset + i];
    samp.left += lscale[data];
    samp.right += rscale[data];
  }

  ch.pos += count;
}

/**
 * Original name: S_PaintChannelFrom16
 * Source: Quake-2-master/client/snd_mix.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Mixes one 16-bit cached sound effect range into the paintbuffer.
 */
export function S_PaintChannelFrom16(
  context: ClientSoundLocalContext,
  ch: channel_t,
  sc: sfxcache_t,
  count: number,
  offset: number
): void {
  const leftvol = ch.leftvol * context.state.mix.snd_vol;
  const rightvol = ch.rightvol * context.state.mix.snd_vol;
  const sampleView = new DataView(sc.data.buffer, sc.data.byteOffset, sc.data.byteLength);
  const sampleBase = ch.pos;

  for (let i = 0; i < count; i += 1) {
    const data = sampleView.getInt16((sampleBase + i) * 2, true);
    const samp = context.state.mix.paintbuffer[offset + i];
    samp.left += (data * leftvol) >> 8;
    samp.right += (data * rightvol) >> 8;
  }

  ch.pos += count;
}

/**
 * Original name: N/A
 * Source: N/A (typed array helper)
 * Category: New
 * Purpose: Flatten the portable paintbuffer pairs into the interleaved sample view used by DMA transfers.
 */
function flattenPaintbuffer(paintbuffer: portable_samplepair_t[], sampleCount: number): Int32Array {
  const flattened = new Int32Array(sampleCount * 2);
  for (let i = 0; i < sampleCount; i += 1) {
    const pair = paintbuffer[i];
    flattened[i * 2] = pair.left | 0;
    flattened[i * 2 + 1] = pair.right | 0;
  }
  return flattened;
}

/**
 * Original name: N/A
 * Source: N/A (typed array helper)
 * Category: New
 * Purpose: Clamp one mixed sample to the signed 16-bit DMA range.
 */
function clampPaintSample16(value: number): number {
  if (value > 0x7fff) {
    return 0x7fff;
  }
  if (value < -0x8000) {
    return -0x8000;
  }
  return value;
}

/**
 * Original name: N/A
 * Source: N/A (typed array helper)
 * Category: New
 * Purpose: Reproduce C signed-char conversion for scale-table indexing.
 */
function toSignedByte(value: number): number {
  return (value << 24) >> 24;
}

/**
 * Original name: N/A
 * Source: N/A (local mix helper)
 * Category: New
 * Purpose: Initialize the current paintbuffer chunk from raw streaming samples or silence.
 */
function clearOrPrimePaintbuffer(context: ClientSoundLocalContext, end: number): void {
  const count = end - context.state.paintedtime;

  if (context.state.s_rawend < context.state.paintedtime) {
    for (let i = 0; i < count; i += 1) {
      context.state.mix.paintbuffer[i].left = 0;
      context.state.mix.paintbuffer[i].right = 0;
    }
    return;
  }

  const stop = end < context.state.s_rawend ? end : context.state.s_rawend;
  let i = context.state.paintedtime;

  for (; i < stop; i += 1) {
    const s = i & (MAX_RAW_SAMPLES - 1);
    const source = context.state.s_rawsamples[s];
    const target = context.state.mix.paintbuffer[i - context.state.paintedtime];
    target.left = source.left;
    target.right = source.right;
  }

  for (; i < end; i += 1) {
    const target = context.state.mix.paintbuffer[i - context.state.paintedtime];
    target.left = 0;
    target.right = 0;
  }
}

/**
 * Original name: N/A
 * Source: N/A (pending sound list helper)
 * Category: New
 * Purpose: Return the first pending playsound while tolerating null or self-linked sentinels.
 */
function getPendingPlayHead(sentinel: playsound_t): playsound_t | null {
  if (!sentinel.next || sentinel.next === sentinel) {
    return null;
  }

  return sentinel.next;
}

/**
 * Original name: N/A
 * Source: N/A (pending sound list helper)
 * Category: New
 * Purpose: Detach one pending playsound from the explicit TypeScript list representation.
 */
function unlinkPendingPlay(sentinel: playsound_t, ps: playsound_t, fallbackNext: playsound_t | null): void {
  if (ps.prev) {
    ps.prev.next = ps.next;
  } else if (sentinel.next === ps) {
    sentinel.next = ps.next;
  }

  if (ps.next) {
    ps.next.prev = ps.prev;
  }

  if (sentinel.next === ps) {
    sentinel.next = fallbackNext === ps ? null : fallbackNext;
  }

  ps.prev = null;
  ps.next = null;
}
