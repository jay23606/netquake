/**
 * File: sky.ts
 * Purpose: Define renderer-agnostic sky snapshot contracts shared between the Quake II client runtime and rendering adapters.
 *
 * This file is not a direct source port.
 * It is an adapter contract layer between original client configstrings and renderer backends.
 *
 * Dependencies:
 * - none
 */

export type { QuakeSkySnapshot } from "../../client/src/render-contracts.js";

/**
 * Original name: N/A
 * Source: N/A (renderer-common sky contract)
 * Category: New
 * Purpose: Preserve the original Quake II environment face ordering shared by precache and renderer code.
 *
 * Constraints:
 * - Must follow the original `rt`, `bk`, `lf`, `ft`, `up`, `dn` order.
 */
export const QUAKE_SKY_FACE_SUFFIXES = ["rt", "bk", "lf", "ft", "up", "dn"] as const;

/**
 * Original name: N/A
 * Source: N/A (renderer-common sky contract)
 * Category: New
 * Purpose: Describe the canonical face-name union for one Quake II skybox.
 *
 * Constraints:
 * - Must stay aligned with `QUAKE_SKY_FACE_SUFFIXES`.
 */
export type QuakeSkyFaceName = (typeof QUAKE_SKY_FACE_SUFFIXES)[number];

/**
 * Original name: N/A
 * Source: N/A (renderer-common sky contract)
 * Category: New
 * Purpose: Describe one canonical set of Quake II sky asset paths resolved from a sky name.
 *
 * Constraints:
 * - Must preserve all six environment faces explicitly.
 */
export interface QuakeSkyAssetSet {
  name: string;
  faces: Record<QuakeSkyFaceName, string>;
}
