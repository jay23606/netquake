/**
 * File: quake-texture-intensity.ts
 * Purpose: Share the original Quake II default texture intensity scaling across Three.js asset adapters.
 *
 * This file is not a direct source port.
 * It is a small adapter helper mirroring the default `intensity 2` behavior from `GL_LightScaleTexture`.
 *
 * Dependencies:
 * - none
 */

export const ORIGINAL_DEFAULT_TEXTURE_INTENSITY = 2;
export const ORIGINAL_DEFAULT_INVERSE_INTENSITY = 1 / ORIGINAL_DEFAULT_TEXTURE_INTENSITY;

export interface QuakeTextureLightingSettings {
  intensity: number;
  gamma: number;
}

/**
 * Category: New
 * Purpose: Normalize renderer cvars to the same effective ranges used by Quake II image uploads.
 */
export function normalizeQuakeTextureLightingSettings(
  settings: Partial<QuakeTextureLightingSettings> = {}
): QuakeTextureLightingSettings {
  const intensity = Number.isFinite(settings.intensity) && (settings.intensity ?? 0) > 1
    ? settings.intensity as number
    : ORIGINAL_DEFAULT_TEXTURE_INTENSITY;
  const gamma = Number.isFinite(settings.gamma) && (settings.gamma ?? 0) > 0
    ? settings.gamma as number
    : 1;
  return { intensity, gamma };
}

/**
 * Category: New
 * Purpose: Build a stable cache key for one texture lighting state.
 */
export function quakeTextureLightingKey(settings: QuakeTextureLightingSettings): string {
  return `${settings.intensity}:${settings.gamma}`;
}

/**
 * Category: New
 * Purpose: Apply Quake II's texture intensity/gamma tables to one RGBA buffer.
 *
 * Constraints:
 * - Must leave alpha unchanged.
 * - Must clamp channels like the original intensity and gamma tables.
 */
export function applyOriginalTextureIntensity(
  rgba: Uint8Array,
  settings: Partial<QuakeTextureLightingSettings> = {}
): Uint8Array {
  const normalized = normalizeQuakeTextureLightingSettings(settings);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = applyOriginalTextureIntensityChannel(rgba[offset] ?? 0, normalized);
    rgba[offset + 1] = applyOriginalTextureIntensityChannel(rgba[offset + 1] ?? 0, normalized);
    rgba[offset + 2] = applyOriginalTextureIntensityChannel(rgba[offset + 2] ?? 0, normalized);
  }
  return rgba;
}

/**
 * Category: New
 * Purpose: Apply the original texture intensity and gamma table logic to one color channel.
 */
export function applyOriginalTextureIntensityChannel(
  value: number,
  settings: Partial<QuakeTextureLightingSettings> = {}
): number {
  const normalized = normalizeQuakeTextureLightingSettings(settings);
  const intensified = Math.min(255, Math.trunc(value * normalized.intensity));
  if (normalized.gamma === 1) {
    return intensified;
  }

  let gammaValue = 255 * Math.pow((intensified + 0.5) / 255.5, normalized.gamma) + 0.5;
  if (gammaValue < 0) {
    gammaValue = 0;
  }
  if (gammaValue > 255) {
    gammaValue = 255;
  }
  return Math.trunc(gammaValue);
}
