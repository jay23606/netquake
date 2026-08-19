/**
 * Category: New
 * Purpose: Placeholder entry point for browser and host platform adapters.
 */
export {
  computeQuakeChannelGain,
  createQuakeWebAudioAdapter,
  resolveQuakeSoundPath,
  writeRawSamplesToAudioBuffer,
  type QuakeWebAudioAdapter,
  type QuakeWebAudioAdapterOptions,
  type WebAudioAdapterLogHooks,
  type WebAudioListenerState,
  type WebAudioNamedLoop,
  type WebAudioNamedSoundOptions,
  type WebAudioSfxPlaybackOptions
} from "./web-audio-adapter.js";
export {
  createWebCDAudioAdapter,
  resolveWebCdTrackCandidates,
  type WebCDAudioAdapter,
  type WebCDAudioAdapterOptions
} from "./web-cd-audio-adapter.js";
