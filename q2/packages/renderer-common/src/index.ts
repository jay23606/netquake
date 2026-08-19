/**
 * File: q_shared.ts
 * Purpose: Expose renderer-agnostic contracts and bridge helpers for Quake II data.
 *
 * This file is not a direct source port.
 * It is a package entry point for renderer-common modules.
 *
 * Dependencies:
 * - packages/renderer-common/src/sky.ts
 */

export { QUAKE_SKY_FACE_SUFFIXES } from "./sky.js";
export type { QuakeSkyAssetSet, QuakeSkyFaceName, QuakeSkySnapshot } from "./sky.js";
