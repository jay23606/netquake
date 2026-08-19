/**
 * File: sky.ts
 * Source: Quake II original / client/cl_parse.c
 * Purpose: Expose a renderer-facing snapshot of the active Quake II sky configstrings.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Emits a renderer-agnostic snapshot instead of calling refresh registration functions directly.
 *
 * Notes:
 * - This file stays close to the client configstring ownership model while preparing bridge-friendly output.
 */

import type { QuakeSkySnapshot } from "./render-contracts.js";
import type { ClientRuntime } from "./client.js";

/**
 * Original name: N/A
 * Source: N/A (renderer-facing client snapshot)
 * Category: New
 * Purpose: Build an optional renderer-facing snapshot from the active client sky state.
 *
 * Constraints:
 * - Must return `null` when no sky name is currently active.
 * - Must preserve value semantics for the returned axis tuple.
 */
export function CL_BuildSkySnapshot(runtime: ClientRuntime): QuakeSkySnapshot | null {
  if (runtime.cl.sky.name.length === 0) {
    return null;
  }

  return {
    name: runtime.cl.sky.name,
    rotate: runtime.cl.sky.rotate,
    axis: [...runtime.cl.sky.axis]
  };
}
