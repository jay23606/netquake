/**
 * File: web-audio-adapter.ts
 * Purpose: Adapt the ported Quake II client sound runtime to Web Audio.
 *
 * This file is not a direct source port.
 * It is an adapter layer between `packages/client/src/snd_*.ts` and browser audio nodes.
 *
 * Dependencies:
 * - packages/client
 * - packages/filesystem
 */

import { readMountedFile, type VirtualFilesystem } from "../../filesystem/src/index.js";
import type { channel_t, sfx_t, sfxcache_t } from "../../client/src/snd_loc.js";

const MAX_ACTIVE_SFX_SOURCES = 96;

/**
 * Original name: N/A
 * Source declaree: N/A (web audio adapter contract)
 * Category: New
 */
export interface WebAudioAdapterLogHooks {
  onInfo?: (message: string) => void;
  onWarning?: (message: string) => void;
}

/**
 * Original name: N/A
 * Source declaree: N/A (web audio adapter contract)
 * Category: New
 */
export interface QuakeWebAudioAdapterOptions {
  context?: AudioContext | null;
  createContext?: () => AudioContext | null;
  logs?: WebAudioAdapterLogHooks;
}

/**
 * Original name: N/A
 * Source declaree: N/A (browser sound backend adapter)
 * Category: Adapter
 */
export interface QuakeWebAudioAdapter {
  readonly context: AudioContext | null;
  readonly unlocked: boolean;
  readonly muted: boolean;
  readonly debug: WebAudioAdapterDebugState;
  unlock: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  setMuted: (muted: boolean) => void;
  setMasterVolume: (volume: number) => void;
  setSfxVolume: (volume: number) => void;
  setListener: (listener: WebAudioListenerState) => void;
  stopAll: () => void;
  stopRaw: () => void;
  playSfx: (sfx: sfx_t, options?: WebAudioSfxPlaybackOptions) => void;
  playChannel: (channel: channel_t) => void;
  syncLoopChannels: (channels: readonly channel_t[]) => void;
  playWavAt: (filesystem: VirtualFilesystem, name: string, options?: WebAudioNamedSoundOptions) => void;
  syncWavLoops: (filesystem: VirtualFilesystem, loops: readonly WebAudioNamedLoop[]) => void;
  queueRawSamples: (
    count: number,
    sampleRate: number,
    sampleWidth: number,
    channels: number,
    samples: Uint8Array
  ) => void;
  playWav: (filesystem: VirtualFilesystem, name: string) => void;
}

/**
 * Original name: N/A
 * Source declaree: N/A (web audio debug state)
 * Category: New
 */
export interface WebAudioAdapterDebugState {
  readonly playedSfx: number;
  readonly skippedSfxNoCache: number;
  readonly pendingSfx: number;
  readonly activeSources: number;
  readonly activeLoops: number;
  readonly lastSfxName: string;
  readonly lastSkippedSfxName: string;
}

/**
 * Original name: N/A
 * Source declaree: N/A (sound channel playback options)
 * Category: New
 */
export interface WebAudioSfxPlaybackOptions {
  leftVolume?: number;
  rightVolume?: number;
  entnum?: number;
  entchannel?: number;
  loopKey?: string;
  loop?: boolean;
  offsetSamples?: number;
}

/**
 * Original name: N/A
 * Source declaree: N/A (named wav playback options)
 * Category: New
 */
export interface WebAudioNamedSoundOptions {
  leftVolume?: number;
  rightVolume?: number;
  loop?: boolean;
  loopKey?: string;
}

/**
 * Original name: N/A
 * Source declaree: N/A (named wav loop descriptor)
 * Category: New
 */
export interface WebAudioNamedLoop {
  key: string;
  name: string;
  leftVolume: number;
  rightVolume: number;
}

/**
 * Original name: N/A
 * Source declaree: N/A (web audio listener adapter)
 * Category: Adapter
 */
export interface WebAudioListenerState {
  position: [number, number, number];
  forward: [number, number, number];
  up: [number, number, number];
}

/**
 * Original name: N/A
 * Source declaree: N/A (web audio source bookkeeping)
 * Category: New
 */
interface ActiveSource {
  source: AudioBufferSourceNode;
  gain: GainNode;
  panner: StereoPannerNode | null;
  key: string | null;
}

/**
 * Original name: N/A
 * Source declaree: N/A (queued raw audio chunk)
 * Category: New
 */
interface PendingRawChunk {
  count: number;
  sampleRate: number;
  sampleWidth: number;
  channels: number;
  samples: Uint8Array;
}

/**
 * Original name: N/A
 * Source declaree: N/A (queued sound effect playback)
 * Category: New
 */
interface PendingSfxPlayback {
  sfx: sfx_t;
  options: WebAudioSfxPlaybackOptions;
}

/**
 * Original name: N/A
 * Source declaree: N/A (browser sound backend adapter)
 * Category: Adapter
 * Fidelity level: Adapter
 *
 * Purpose:
 * - Bridge the ported client sound runtime and browser WebAudio playback nodes.
 */
export function createQuakeWebAudioAdapter(options: QuakeWebAudioAdapterOptions = {}): QuakeWebAudioAdapter {
  const context = options.context ?? options.createContext?.() ?? createDefaultAudioContext();
  const logs = options.logs ?? {};
  const decodedWavCache = new Map<string, AudioBuffer | null>();
  const sfxBufferCache = new WeakMap<sfxcache_t, AudioBuffer>();
  const activeSources: ActiveSource[] = [];
  const activeLoops = new Map<string, ActiveSource>();
  const activeWavLoops = new Map<string, ActiveSource>();
  const pendingWavLoops = new Set<string>();
  const activeRawSources: AudioBufferSourceNode[] = [];
  const pendingRawChunks: PendingRawChunk[] = [];
  const pendingSfxPlaybacks: PendingSfxPlayback[] = [];
  let playedSfx = 0;
  let skippedSfxNoCache = 0;
  let lastSfxName = "";
  let lastSkippedSfxName = "";
  const masterGain = context?.createGain() ?? null;
  const sfxGain = context?.createGain() ?? null;
  let unlocked = false;
  let muted = false;
  let masterVolume = 1;
  let sfxVolume = 1;
  let nextRawStartTime = 0;

  if (context && masterGain) {
    masterGain.gain.value = 1;
    masterGain.connect(context.destination);
  }
  if (sfxGain && masterGain) {
    sfxGain.gain.value = 1;
    sfxGain.connect(masterGain);
  }

  const adapter: QuakeWebAudioAdapter = {
    context,
    get unlocked() {
      return unlocked;
    },
    get muted() {
      return muted;
    },
    get debug() {
      return {
        playedSfx,
        skippedSfxNoCache,
        pendingSfx: pendingSfxPlaybacks.length,
        activeSources: activeSources.length,
        activeLoops: activeLoops.size,
        lastSfxName,
        lastSkippedSfxName
      };
    },
    unlock: async () => {
      if (!context) {
        logs.onWarning?.("Web Audio indisponible dans ce navigateur.");
        return;
      }

      if (context.state !== "running") {
        try {
          await context.resume();
        } catch (error) {
          unlocked = false;
          logs.onWarning?.(`audio suspendu (${error instanceof Error ? error.message : error})`);
          return;
        }
      }
      unlocked = context.state === "running";
      if (!unlocked) {
        logs.onWarning?.(`audio suspendu (${context.state})`);
        return;
      }

      logs.onInfo?.(`audio actif (${context.sampleRate} Hz), chunks en attente: ${pendingRawChunks.length}`);
      const queued = pendingRawChunks.splice(0);
      for (const chunk of queued) {
        adapter.queueRawSamples(chunk.count, chunk.sampleRate, chunk.sampleWidth, chunk.channels, chunk.samples);
      }
      const queuedSfx = pendingSfxPlaybacks.splice(0);
      for (const playback of queuedSfx) {
        adapter.playSfx(playback.sfx, playback.options);
      }
    },
    pause: async () => {
      if (context && context.state === "running") {
        await context.suspend();
      }
    },
    resume: async () => {
      await adapter.unlock();
    },
    setMuted: (nextMuted) => {
      muted = nextMuted;
      updateMasterGain(masterGain, muted, masterVolume);
    },
    setMasterVolume: (volume) => {
      masterVolume = clamp01(volume);
      updateMasterGain(masterGain, muted, masterVolume);
    },
    setSfxVolume: (volume) => {
      sfxVolume = clamp01(volume);
      if (sfxGain) {
        sfxGain.gain.value = sfxVolume;
      }
    },
    setListener: (listener) => {
      if (!context) {
        return;
      }
      updateAudioContextListener(context, listener);
    },
    stopAll: () => {
      stopActiveSources(activeSources);
      activeLoops.clear();
      for (const active of activeWavLoops.values()) {
        stopActiveSource(active);
      }
      activeWavLoops.clear();
      adapter.stopRaw();
    },
    stopRaw: () => {
      for (const source of activeRawSources.splice(0)) {
        stopRawSource(source);
      }
      nextRawStartTime = context ? context.currentTime : 0;
    },
    playSfx: (sfx, playOptions = {}) => {
      if (!context || !sfxGain) {
        return;
      }
      unlocked = context.state === "running";
      if (!unlocked || context.state !== "running") {
        if (pendingSfxPlaybacks.length < 128) {
          pendingSfxPlaybacks.push({ sfx, options: { ...playOptions } });
        }
        void adapter.unlock().catch(() => undefined);
        return;
      }
      const cache = sfx.cache;
      if (!cache) {
        skippedSfxNoCache += 1;
        lastSkippedSfxName = sfx.name;
        return;
      }

      try {
        const buffer = getSfxAudioBuffer(context, sfxBufferCache, cache);
        const key = playOptions.loopKey ?? makeChannelKey(playOptions.entnum ?? 0, playOptions.entchannel ?? 0);
        if (key) {
          stopMatchingSources(activeSources, activeLoops, key);
        }

        trimActiveSfxSources(activeSources, activeLoops, MAX_ACTIVE_SFX_SOURCES - 1);
        const active = createSpatialSource(context, sfxGain, buffer, {
          leftVolume: playOptions.leftVolume ?? 255,
          rightVolume: playOptions.rightVolume ?? 255,
          key,
          loop: playOptions.loop ?? cache.loopstart >= 0,
          offsetSamples: playOptions.offsetSamples ?? 0
        });
        activeSources.push(active);
        playedSfx += 1;
        lastSfxName = sfx.name;
        if (playOptions.loop && key) {
          activeLoops.set(key, active);
        }
        active.source.onended = () => {
          removeActiveSource(activeSources, active);
          if (key && activeLoops.get(key) === active) {
            activeLoops.delete(key);
          }
          disconnectActiveSource(active);
        };
      } catch {
        // Browser source startup may fail transiently; Quake keeps running and later sounds can still play.
      }
    },
    playChannel: (channel) => {
      if (!channel.sfx) {
        return;
      }
      adapter.playSfx(channel.sfx, {
        leftVolume: channel.leftvol,
        rightVolume: channel.rightvol,
        entnum: channel.entnum,
        entchannel: channel.entchannel,
        loop: channel.autosound || channel.looping !== 0,
        offsetSamples: channel.pos
      });
    },
    syncLoopChannels: (channels) => {
      const wanted = new Set<string>();
      for (const channel of channels) {
        if (!channel.sfx || (!channel.autosound && channel.looping === 0)) {
          continue;
        }
        const key = makeChannelKey(channel.entnum, channel.entchannel) ?? `autosound:${channel.sfx.name}`;
        wanted.add(key);
        const active = activeLoops.get(key);
        if (active) {
          applyQuakeStereoVolumes(active.gain, active.panner, channel.leftvol, channel.rightvol);
          continue;
        }
        adapter.playSfx(channel.sfx, {
          leftVolume: channel.leftvol,
          rightVolume: channel.rightvol,
          entnum: channel.entnum,
          entchannel: channel.entchannel,
          loopKey: key,
          loop: true,
          offsetSamples: channel.pos
        });
      }

      for (const [key, active] of activeLoops) {
        if (wanted.has(key)) {
          continue;
        }
        activeLoops.delete(key);
        removeActiveSource(activeSources, active);
        stopActiveSource(active);
      }
    },
    playWavAt: (filesystem, name, playOptions = {}) => {
      if (!context || !sfxGain || !unlocked || context.state !== "running") {
        return;
      }
      void playDecodedWav(context, sfxGain, decodedWavCache, filesystem, name, logs, {
        leftVolume: playOptions.leftVolume ?? 255,
        rightVolume: playOptions.rightVolume ?? 255,
        loop: playOptions.loop ?? false,
        loopKey: playOptions.loopKey ?? null,
        activeLoops: activeWavLoops,
        pendingLoops: pendingWavLoops
      });
    },
    syncWavLoops: (filesystem, loops) => {
      const wanted = new Set<string>();
      for (const loop of loops) {
        wanted.add(loop.key);
        const active = activeWavLoops.get(loop.key);
        if (active) {
          applyQuakeStereoVolumes(active.gain, active.panner, loop.leftVolume, loop.rightVolume);
          continue;
        }
        adapter.playWavAt(filesystem, loop.name, {
          leftVolume: loop.leftVolume,
          rightVolume: loop.rightVolume,
          loop: true,
          loopKey: loop.key
        });
      }

      for (const [key, active] of activeWavLoops) {
        if (wanted.has(key)) {
          continue;
        }
        activeWavLoops.delete(key);
        stopActiveSource(active);
      }
    },
    queueRawSamples: (count, sampleRate, sampleWidth, channels, samples) => {
      if (!context || !masterGain) {
        return;
      }
      if (!unlocked || context.state !== "running") {
        if (pendingRawChunks.length < 96) {
          pendingRawChunks.push({ count, sampleRate, sampleWidth, channels, samples: samples.slice() });
        }
        return;
      }

      let source: AudioBufferSourceNode | null = null;
      try {
        const audioBuffer = context.createBuffer(Math.max(1, channels), count, sampleRate);
        writeRawSamplesToAudioBuffer(audioBuffer, count, sampleWidth, channels, samples);

        const rawSource = context.createBufferSource();
        source = rawSource;
        rawSource.buffer = audioBuffer;
        rawSource.connect(masterGain);
        rawSource.onended = () => {
          const index = activeRawSources.indexOf(rawSource);
          if (index >= 0) {
            activeRawSources.splice(index, 1);
          }
          disconnectRawSource(rawSource);
        };

        const startTime = Math.max(context.currentTime + 0.02, nextRawStartTime);
        rawSource.start(startTime);
        nextRawStartTime = startTime + audioBuffer.duration;
        activeRawSources.push(rawSource);
      } catch {
        if (source) {
          disconnectRawSource(source);
        }
      }
    },
    playWav: (filesystem, name) => {
      if (!context || !sfxGain || !unlocked || context.state !== "running") {
        return;
      }
      void playDecodedWav(context, sfxGain, decodedWavCache, filesystem, name, logs);
    }
  };

  return adapter;
}

/**
 * Original name: N/A
 * Source declaree: N/A (Quake sound path adapter)
 * Category: Adapter
 */
export function resolveQuakeSoundPath(name: string): string {
  const normalized = name.replaceAll("\\", "/").replace(/^\/+/, "");
  return normalized.startsWith("sound/") ? normalized : `sound/${normalized}`;
}

/**
 * Original name: N/A
 * Source declaree: N/A (Quake stereo volume adapter)
 * Category: Adapter
 */
export function computeQuakeChannelGain(leftVolume: number, rightVolume: number): { gain: number; pan: number } {
  const left = clamp01(leftVolume / 255);
  const right = clamp01(rightVolume / 255);
  const loudest = Math.max(left, right);
  if (loudest === 0) {
    return { gain: 0, pan: 0 };
  }

  return {
    gain: loudest,
    pan: clampSigned(right - left)
  };
}

/**
 * Original name: N/A
 * Source declaree: N/A (raw sample WebAudio adapter)
 * Category: Adapter
 */
export function writeRawSamplesToAudioBuffer(
  audioBuffer: AudioBuffer,
  count: number,
  sampleWidth: number,
  channels: number,
  samples: Uint8Array
): void {
  const view = new DataView(samples.buffer, samples.byteOffset, samples.byteLength);

  for (let frame = 0; frame < count; frame += 1) {
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
      const sourceChannel = Math.min(channel, channels - 1);
      let value = 0;

      if (sampleWidth === 2) {
        const offset = (frame * channels + sourceChannel) * 2;
        value = offset + 1 < samples.byteLength ? view.getInt16(offset, true) / 32768 : 0;
      } else {
        const offset = frame * channels + sourceChannel;
        value = offset < samples.byteLength ? (samples[offset] - 128) / 128 : 0;
      }

      audioBuffer.getChannelData(channel)[frame] = Math.max(-1, Math.min(1, value));
    }
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (browser audio context factory)
 * Category: New
 */
function createDefaultAudioContext(): AudioContext | null {
  const AudioContextCtor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  return AudioContextCtor ? new AudioContextCtor() : null;
}

/**
 * Original name: N/A
 * Source declaree: N/A (sfx cache WebAudio adapter)
 * Category: Adapter
 */
function getSfxAudioBuffer(
  context: AudioContext,
  cache: WeakMap<sfxcache_t, AudioBuffer>,
  sfxCache: sfxcache_t
): AudioBuffer {
  const existing = cache.get(sfxCache);
  if (existing) {
    return existing;
  }

  const channels = sfxCache.stereo ? 2 : 1;
  const buffer = context.createBuffer(channels, Math.max(1, sfxCache.length), sfxCache.speed || context.sampleRate);
  writeSfxCacheToAudioBuffer(buffer, sfxCache);
  cache.set(sfxCache, buffer);
  return buffer;
}

/**
 * Original name: N/A
 * Source declaree: N/A (sfx cache WebAudio adapter)
 * Category: Adapter
 */
function writeSfxCacheToAudioBuffer(audioBuffer: AudioBuffer, sfxCache: sfxcache_t): void {
  const channels = sfxCache.stereo ? 2 : 1;
  const view = new DataView(sfxCache.data.buffer, sfxCache.data.byteOffset, sfxCache.data.byteLength);

  for (let frame = 0; frame < sfxCache.length; frame += 1) {
    for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
      const sourceChannel = Math.min(channel, channels - 1);
      const sourceIndex = frame * channels + sourceChannel;
      let value = 0;
      if (sfxCache.width === 2) {
        const offset = sourceIndex * 2;
        value = offset + 1 < sfxCache.data.byteLength ? view.getInt16(offset, true) / 32768 : 0;
      } else {
        value = sourceIndex < sfxCache.data.byteLength ? toSignedByte(sfxCache.data[sourceIndex]) / 128 : 0;
      }
      audioBuffer.getChannelData(channel)[frame] = Math.max(-1, Math.min(1, value));
    }
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (WebAudio spatial playback adapter)
 * Category: New
 * Fidelity level: Adapter
 *
 * Purpose:
 * - Build and start the WebAudio node chain used for a Quake positional sound.
 */
function createSpatialSource(
  context: AudioContext,
  destination: AudioNode,
  buffer: AudioBuffer,
  options: {
    leftVolume: number;
    rightVolume: number;
    key: string | null;
    loop: boolean;
    offsetSamples: number;
  }
): ActiveSource {
  const source = context.createBufferSource();
  const gain = context.createGain();
  const panner = typeof context.createStereoPanner === "function" ? context.createStereoPanner() : null;
  source.buffer = buffer;
  source.loop = options.loop;
  if (options.loop && buffer.length > 0) {
    source.loopStart = 0;
    source.loopEnd = buffer.duration;
  }
  applyQuakeStereoVolumes(gain, panner, options.leftVolume, options.rightVolume);

  source.connect(gain);
  if (panner) {
    gain.connect(panner);
    panner.connect(destination);
  } else {
    gain.connect(destination);
  }

  const offsetSeconds = buffer.sampleRate > 0
    ? Math.max(0, options.offsetSamples) / buffer.sampleRate
    : 0;
  try {
    source.start(context.currentTime, Math.min(offsetSeconds, Math.max(0, buffer.duration - 0.001)));
  } catch (error) {
    disconnectAudioNode(source);
    disconnectAudioNode(gain);
    if (panner) {
      disconnectAudioNode(panner);
    }
    throw error;
  }
  return { source, gain, panner, key: options.key };
}

/**
 * Original name: N/A
 * Source declaree: N/A (Quake stereo volume adapter)
 * Category: Adapter
 */
function applyQuakeStereoVolumes(
  gainNode: GainNode,
  pannerNode: StereoPannerNode | null,
  leftVolume: number,
  rightVolume: number
): void {
  const values = computeQuakeChannelGain(leftVolume, rightVolume);
  gainNode.gain.value = values.gain;
  if (pannerNode) {
    pannerNode.pan.value = values.pan;
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (decoded wav playback adapter)
 * Category: Adapter
 */
async function playDecodedWav(
  context: AudioContext,
  destination: AudioNode,
  cache: Map<string, AudioBuffer | null>,
  filesystem: VirtualFilesystem,
  name: string,
  logs: WebAudioAdapterLogHooks,
  options: {
    leftVolume?: number;
    rightVolume?: number;
    loop?: boolean;
    loopKey?: string | null;
    activeLoops?: Map<string, ActiveSource>;
    pendingLoops?: Set<string>;
  } = {}
): Promise<void> {
  const path = resolveQuakeSoundPath(name);
  if (options.loopKey) {
    if (options.activeLoops?.has(options.loopKey) || options.pendingLoops?.has(options.loopKey)) {
      return;
    }
    options.pendingLoops?.add(options.loopKey);
  }
  let buffer = cache.get(path);

  try {
    if (buffer === undefined) {
      const file = readMountedFile(filesystem, path);
      if (!file) {
        cache.set(path, null);
        return;
      }

      try {
        const wavBytes = new Uint8Array(file.bytes.byteLength);
        wavBytes.set(file.bytes);
        const audioData = new ArrayBuffer(wavBytes.byteLength);
        new Uint8Array(audioData).set(wavBytes);
        buffer = await context.decodeAudioData(audioData);
        cache.set(path, buffer);
      } catch (error) {
        cache.set(path, null);
        logs.onWarning?.(`son illisible: ${path} (${error instanceof Error ? error.message : error})`);
        return;
      }
    }

    if (!buffer) {
      return;
    }

    if (options.loopKey && options.activeLoops?.has(options.loopKey)) {
      return;
    }

    let active: ActiveSource;
    try {
      active = createSpatialSource(context, destination, buffer, {
        leftVolume: options.leftVolume ?? 255,
        rightVolume: options.rightVolume ?? 255,
        key: options.loopKey ?? null,
        loop: options.loop ?? false,
        offsetSamples: 0
      });
    } catch {
      return;
    }
    active.source.onended = () => {
      if (options.loop && options.loopKey && options.activeLoops?.get(options.loopKey) === active) {
        options.activeLoops.delete(options.loopKey);
      }
      disconnectActiveSource(active);
    };
    if (options.loop && options.loopKey && options.activeLoops) {
      options.activeLoops.set(options.loopKey, active);
    }
  } finally {
    if (options.loopKey) {
      options.pendingLoops?.delete(options.loopKey);
    }
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (Quake sound channel key adapter)
 * Category: Adapter
 */
function makeChannelKey(entnum: number, entchannel: number): string | null {
  return entchannel !== 0 ? `${entnum}:${entchannel}` : null;
}

/**
 * Original name: N/A
 * Source declaree: N/A (Quake sound channel replacement adapter)
 * Category: Adapter
 */
function stopMatchingSources(sources: ActiveSource[], loops: Map<string, ActiveSource>, key: string): void {
  for (let index = sources.length - 1; index >= 0; index -= 1) {
    const active = sources[index];
    if (active.key !== key) {
      continue;
    }
    if (loops.get(key) === active) {
      loops.delete(key);
    }
    sources.splice(index, 1);
    stopActiveSource(active);
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (WebAudio source limit helper)
 * Category: New
 */
function trimActiveSfxSources(sources: ActiveSource[], loops: Map<string, ActiveSource>, maxSources: number): void {
  for (let index = 0; sources.length > maxSources && index < sources.length;) {
    const active = sources[index];
    if (active.key && loops.get(active.key) === active) {
      index += 1;
      continue;
    }

    sources.splice(index, 1);
    stopActiveSource(active);
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (WebAudio lifecycle adapter)
 * Category: New
 */
function stopActiveSources(sources: ActiveSource[]): void {
  for (const active of sources.splice(0)) {
    stopActiveSource(active);
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (WebAudio source bookkeeping)
 * Category: New
 */
function removeActiveSource(sources: ActiveSource[], active: ActiveSource): void {
  const index = sources.indexOf(active);
  if (index >= 0) {
    sources.splice(index, 1);
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (WebAudio lifecycle adapter)
 * Category: New
 * Fidelity level: Adapter
 *
 * Purpose:
 * - Stop and detach a full WebAudio source chain owned by a Quake sound channel.
 */
function stopActiveSource(active: ActiveSource): void {
  stopSource(active.source);
  disconnectActiveSource(active);
}

/**
 * Original name: N/A
 * Source declaree: N/A (WebAudio lifecycle adapter)
 * Category: New
 * Fidelity level: Adapter
 *
 * Purpose:
 * - Disconnect ended or stopped WebAudio nodes so dense combat sounds do not leak graph nodes.
 */
function disconnectActiveSource(active: ActiveSource): void {
  disconnectAudioNode(active.source);
  disconnectAudioNode(active.gain);
  if (active.panner) {
    disconnectAudioNode(active.panner);
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (WebAudio lifecycle adapter)
 * Category: New
 * Fidelity level: Adapter
 *
 * Purpose:
 * - Stop and detach a raw streaming source used by cinematics and loading audio.
 */
function stopRawSource(source: AudioBufferSourceNode): void {
  stopSource(source);
  disconnectRawSource(source);
}

/**
 * Original name: N/A
 * Source declaree: N/A (WebAudio lifecycle adapter)
 * Category: New
 * Fidelity level: Adapter
 *
 * Purpose:
 * - Disconnect a raw WebAudio source after playback or explicit stop.
 */
function disconnectRawSource(source: AudioBufferSourceNode): void {
  disconnectAudioNode(source);
}

/**
 * Original name: N/A
 * Source declaree: N/A (WebAudio lifecycle adapter)
 * Category: New
 * Fidelity level: Adapter
 *
 * Purpose:
 * - Ignore browser-specific double-disconnect errors on already detached nodes.
 */
function disconnectAudioNode(node: AudioNode): void {
  try {
    node.disconnect();
  } catch {
    // The browser throws when a node is already disconnected; cleanup remains idempotent.
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (WebAudio lifecycle adapter)
 * Category: New
 * Fidelity level: Adapter
 *
 * Purpose:
 * - Stop a WebAudio buffer source while preserving Quake's idempotent stop paths.
 */
function stopSource(source: AudioBufferSourceNode): void {
  try {
    source.stop();
  } catch {
    // The browser throws if a source is already stopped; Quake's stop path is idempotent.
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (WebAudio master gain helper)
 * Category: New
 */
function updateMasterGain(masterGain: GainNode | null, muted: boolean, volume: number): void {
  if (masterGain) {
    masterGain.gain.value = muted ? 0 : clamp01(volume);
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (listener orientation WebAudio adapter)
 * Category: Adapter
 */
function updateAudioContextListener(context: AudioContext, listener: WebAudioListenerState): void {
  const audioListener = context.listener;
  const time = context.currentTime;
  setAudioParam(audioListener.positionX, listener.position[0], time);
  setAudioParam(audioListener.positionY, listener.position[1], time);
  setAudioParam(audioListener.positionZ, listener.position[2], time);
  setAudioParam(audioListener.forwardX, listener.forward[0], time);
  setAudioParam(audioListener.forwardY, listener.forward[1], time);
  setAudioParam(audioListener.forwardZ, listener.forward[2], time);
  setAudioParam(audioListener.upX, listener.up[0], time);
  setAudioParam(audioListener.upY, listener.up[1], time);
  setAudioParam(audioListener.upZ, listener.up[2], time);
}

/**
 * Original name: N/A
 * Source declaree: N/A (WebAudio param helper)
 * Category: New
 */
function setAudioParam(param: AudioParam | undefined, value: number, time: number): void {
  if (!param) {
    return;
  }
  param.setValueAtTime(value, time);
}

/**
 * Original name: N/A
 * Source declaree: N/A (numeric clamp helper)
 * Category: New
 */
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Original name: N/A
 * Source declaree: N/A (numeric clamp helper)
 * Category: New
 */
function clampSigned(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

/**
 * Original name: N/A
 * Source declaree: N/A (signed byte audio adapter)
 * Category: Adapter
 */
function toSignedByte(value: number): number {
  return (value << 24) >> 24;
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }

  var webkitAudioContext: typeof AudioContext | undefined;
}
