/**
 * File: web-cd-audio-adapter.ts
 * Purpose: Map Quake II logical CD tracks to browser-decodable music assets.
 *
 * This file is not a direct source port.
 * It adapts `client/cdaudio.h` semantics to Web Audio without emulating native CD-ROM APIs.
 *
 * Dependencies:
 * - packages/filesystem
 */

import { readMountedFile, type VirtualFilesystem } from "../../filesystem/src/index.js";
import type { WebAudioAdapterLogHooks } from "./web-audio-adapter.js";

/**
 * Original name: N/A
 * Source: N/A (web CD audio adapter)
 * Category: Adapter
 * Purpose: Browser dependencies required to translate logical CD-audio hooks into Web Audio playback.
 */
export interface WebCDAudioAdapterOptions {
  context: AudioContext | null;
  filesystem: VirtualFilesystem;
  logs?: WebAudioAdapterLogHooks;
  trackResolver?: (track: number) => string[];
}

/**
 * Original name: N/A
 * Source: N/A (web CD audio adapter)
 * Category: Adapter
 * Purpose: Host backend consumed by the client CD-audio port in browser runtimes.
 */
export interface WebCDAudioAdapter {
  readonly currentTrack: number;
  readonly playing: boolean;
  readonly paused: boolean;
  play: (track: number, looping: boolean) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  setMasterVolume: (volume: number) => void;
  setMusicVolume: (volume: number) => void;
  update: () => void;
}

/**
 * Original name: N/A
 * Source: N/A (web CD audio adapter)
 * Category: Adapter
 * Purpose: Create the browser CD-audio backend used by runtime hooks instead of native CD-ROM APIs.
 */
export function createWebCDAudioAdapter(options: WebCDAudioAdapterOptions): WebCDAudioAdapter {
  const context = options.context;
  const logs = options.logs ?? {};
  const trackResolver = options.trackResolver ?? resolveWebCdTrackCandidates;
  const decodedTracks = new Map<string, AudioBuffer | null>();
  let source: AudioBufferSourceNode | null = null;
  let gain: GainNode | null = context?.createGain() ?? null;
  let currentTrack = 0;
  let playing = false;
  let paused = false;
  let masterVolume = 1;
  let musicVolume = 1;
  let missingLogged = new Set<number>();

  if (context && gain) {
    gain.gain.value = 1;
    gain.connect(context.destination);
  }

  const adapter: WebCDAudioAdapter = {
    get currentTrack() {
      return currentTrack;
    },
    get playing() {
      return playing;
    },
    get paused() {
      return paused;
    },
    play: (track, looping) => {
      if (!context || !gain) {
        return;
      }
      const normalizedTrack = Math.trunc(track);
      if (normalizedTrack <= 0) {
        adapter.stop();
        return;
      }
      if (playing && currentTrack === normalizedTrack) {
        return;
      }

      adapter.stop();
      currentTrack = normalizedTrack;
      void startTrack(context, options.filesystem, decodedTracks, trackResolver(normalizedTrack), logs).then((buffer) => {
        if (!buffer || currentTrack !== normalizedTrack) {
          if (!buffer && !missingLogged.has(normalizedTrack)) {
            logs.onInfo?.(`musique CD absente pour la piste ${normalizedTrack}`);
            missingLogged.add(normalizedTrack);
          }
          return;
        }

        const nextSource = context.createBufferSource();
        nextSource.buffer = buffer;
        nextSource.loop = looping;
        nextSource.connect(gain);
        nextSource.onended = () => {
          if (source === nextSource) {
            source = null;
            playing = false;
            paused = false;
          }
        };
        source = nextSource;
        playing = true;
        paused = false;
        gain.gain.value = computeMusicGain(masterVolume, musicVolume, paused);
        nextSource.start();
      });
    },
    stop: () => {
      if (source) {
        try {
          source.stop();
        } catch {
          // Stopping CD music is idempotent in the original interface.
        }
        source = null;
      }
      playing = false;
      paused = false;
      currentTrack = 0;
    },
    pause: () => {
      if (!gain || !playing || paused) {
        return;
      }
      paused = true;
      playing = false;
      updateMusicGain(gain, masterVolume, musicVolume, paused);
    },
    resume: () => {
      if (!gain || !paused) {
        return;
      }
      paused = false;
      playing = true;
      updateMusicGain(gain, masterVolume, musicVolume, paused);
    },
    setMasterVolume: (volume) => {
      masterVolume = clamp01(volume);
      updateMusicGain(gain, masterVolume, musicVolume, paused);
    },
    setMusicVolume: (volume) => {
      musicVolume = clamp01(volume);
      updateMusicGain(gain, masterVolume, musicVolume, paused);
    },
    update: () => {
      // Native backends poll CD state here. Web Audio sources signal completion through `onended`.
    }
  };

  return adapter;
}

/**
 * Original name: N/A
 * Source: N/A (web CD audio volume helper)
 * Category: New
 * Purpose: Synchronize the Web Audio gain node with Quake II master/music volume and pause state.
 */
function updateMusicGain(gain: GainNode | null, masterVolume: number, musicVolume: number, paused: boolean): void {
  if (gain) {
    gain.gain.value = computeMusicGain(masterVolume, musicVolume, paused);
  }
}

/**
 * Original name: N/A
 * Source: N/A (web CD audio volume helper)
 * Category: New
 * Purpose: Combine clamped master/music volume while muting paused browser CD playback.
 */
function computeMusicGain(masterVolume: number, musicVolume: number, paused: boolean): number {
  return paused ? 0 : clamp01(masterVolume) * clamp01(musicVolume);
}

/**
 * Original name: N/A
 * Source: N/A (web CD audio volume helper)
 * Category: New
 * Purpose: Keep browser audio volume inputs inside the Web Audio gain range.
 */
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Original name: N/A
 * Source: N/A (web CD audio asset mapping)
 * Category: Adapter
 * Purpose: Translate Quake II logical CD track numbers into browser-loadable music filenames.
 */
export function resolveWebCdTrackCandidates(track: number): string[] {
  const number = Math.max(0, Math.trunc(track));
  const padded = number.toString().padStart(2, "0");
  return [
    `music/track${padded}.ogg`,
    `music/track${padded}.mp3`,
    `music/track${padded}.wav`,
    `music/track${number}.ogg`,
    `music/track${number}.mp3`,
    `music/track${number}.wav`,
    `music/${padded}.ogg`,
    `music/${padded}.mp3`,
    `music/${padded}.wav`,
    `music/${number}.ogg`,
    `music/${number}.mp3`,
    `music/${number}.wav`
  ];
}

/**
 * Original name: N/A
 * Source: N/A (web CD audio asset loader)
 * Category: Adapter
 * Purpose: Resolve, decode and cache browser music assets for one logical CD track request.
 */
async function startTrack(
  context: AudioContext,
  filesystem: VirtualFilesystem,
  cache: Map<string, AudioBuffer | null>,
  candidates: string[],
  logs: WebAudioAdapterLogHooks
): Promise<AudioBuffer | null> {
  for (const candidate of candidates) {
    const cached = cache.get(candidate);
    if (cached !== undefined) {
      if (cached) {
        return cached;
      }
      continue;
    }

    const file = readMountedFile(filesystem, candidate);
    if (!file) {
      cache.set(candidate, null);
      continue;
    }

    try {
      const audioData = new ArrayBuffer(file.bytes.byteLength);
      new Uint8Array(audioData).set(file.bytes);
      const buffer = await context.decodeAudioData(audioData);
      cache.set(candidate, buffer);
      return buffer;
    } catch (error) {
      cache.set(candidate, null);
      logs.onWarning?.(`musique illisible: ${candidate} (${error instanceof Error ? error.message : error})`);
    }
  }

  return null;
}
