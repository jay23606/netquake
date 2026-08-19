/**
 * File: render-contracts.ts
 * Purpose: Define the runtime-owned render bridge contracts emitted by the Quake II client port.
 *
 * This file is not a direct source port.
 * It is a runtime-side contract layer between the ported client code and renderer adapters.
 *
 * Dependencies:
 * - None
 */

/**
 * Original name: N/A
 * Source: N/A (runtime-renderer contract)
 * Category: New
 * Purpose: Describe one 2D HUD draw rectangle in pixel coordinates.
 *
 * Constraints:
 * - Must preserve Quake II pixel-space placement semantics.
 */
export interface HudBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Original name: N/A
 * Source: N/A (runtime-renderer contract)
 * Category: New
 * Purpose: Describe one image draw request emitted by the ported HUD logic.
 *
 * Constraints:
 * - Must carry the Quake II pic name unchanged.
 */
export interface HudPictureCommand {
  type: "picture";
  x: number;
  y: number;
  pic: string;
  bounds: HudBounds;
}

/**
 * Original name: N/A
 * Source: N/A (runtime-renderer contract)
 * Category: New
 * Purpose: Describe one text draw request emitted by the ported HUD logic.
 *
 * Constraints:
 * - Must preserve the original string payload and alternate/high-bit variant.
 */
export interface HudTextCommand {
  type: "text";
  x: number;
  y: number;
  text: string;
  xorMask: number;
  centerWidth: number;
  variant: "normal" | "alt";
  bounds: HudBounds;
}

/**
 * Original name: N/A
 * Source: N/A (runtime-renderer contract)
 * Category: New
 * Purpose: Describe one number-field draw request emitted by the Quake II HUD logic.
 *
 * Constraints:
 * - Must preserve width clamp, color bank and digit pic mapping.
 */
export interface HudNumberCommand {
  type: "number";
  x: number;
  y: number;
  color: number;
  width: number;
  value: number;
  digits: string[];
  bounds: HudBounds;
}

/**
 * Original name: N/A
 * Source: N/A (runtime-renderer contract)
 * Category: New
 * Purpose: Describe one generic fill rectangle used by HUD overlays and future debug visuals.
 *
 * Constraints:
 * - Must stay backend-agnostic.
 */
export interface HudFillCommand {
  type: "fill";
  x: number;
  y: number;
  width: number;
  height: number;
  color: number;
  bounds: HudBounds;
}

/**
 * Original name: N/A
 * Source: N/A (runtime-renderer contract)
 * Category: New
 * Purpose: Union the HUD draw primitives emitted by the client runtime.
 */
export type HudDrawCommand =
  | HudPictureCommand
  | HudTextCommand
  | HudNumberCommand
  | HudFillCommand;

/**
 * Original name: N/A
 * Source: N/A (runtime-renderer contract)
 * Category: New
 * Purpose: Describe one active Quake II sky state ready to cross the runtime-to-renderer bridge.
 *
 * Constraints:
 * - Must remain directly mappable from `CS_SKY`, `CS_SKYROTATE` and `CS_SKYAXIS`.
 * - Must use value semantics for the axis tuple.
 */
export interface QuakeSkySnapshot {
  name: string;
  rotate: number;
  axis: [number, number, number];
}
