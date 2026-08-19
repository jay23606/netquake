/**
 * File: render-source.ts
 * Purpose: Build the server-backed render source consumed by the web-app Three/ref_gl loop.
 *
 * This file is not a direct source port.
 * It is an adapter layer between the authoritative Quake II client state and the browser renderer.
 *
 * Dependencies:
 * - packages/client
 * - packages/qcommon
 * - apps/web web-app-render-loop
 */

import {
  CS_MODELS,
  Cvar_VariableValue,
  type CvarRuntime
} from "../../../packages/qcommon/src/index.js";
import { CL_BuildRefreshFrame } from "../../../packages/client/src/refresh.js";
import { SCR_BuildScreenState } from "../../../packages/client/src/cl_scrn.js";
import { CL_BuildSkySnapshot } from "../../../packages/client/src/sky.js";
import type {
  BrushModelSnapshot,
  ClientRefreshFrame,
  ClientRuntime
} from "../../../packages/client/src/index.js";
import type { WebAppRenderSource } from "./render-loop.js";

/**
 * Original name: N/A
 * Source: N/A (web adapter)
 * Category: New
 * Purpose: Configure projection from the parsed client runtime to the web-app renderer source.
 */
export interface WebAppServerRenderSourceOptions {
  cvar: CvarRuntime;
  predictMovement?: boolean;
  drawGun?: boolean;
}

/**
 * Original name: N/A
 * Source: N/A (web adapter)
 * Category: New
 * Purpose: Resolve the authoritative BSP path from the parsed client world-model configstring.
 *
 * Constraints:
 * - Must prefer `CS_MODELS + 1`, because it is the server snapshot contract consumed by the client.
 * - May fall back to a pending host map request before the first configstring frame is active.
 */
export function getWebAppServerMapPath(client: ClientRuntime, fallbackMapRequest: string | null = null): string | null {
  const worldModel = client.cl.configstrings[CS_MODELS + 1];
  const mapName = normalizeServerMapName(worldModel || fallbackMapRequest || "");
  return mapName ? `maps/${mapName}.bsp` : null;
}

/**
 * Original name: N/A
 * Source: N/A (web adapter)
 * Category: New
 * Purpose: Project the parsed authoritative client snapshot into the renderer source contract.
 *
 * Constraints:
 * - Must keep gameplay ownership on the local server.
 * - Must read renderable entities, HUD state, sky and sounds from the parsed client state.
 */
export function createWebAppServerRenderSource(
  runtime: ClientRuntime,
  options: WebAppServerRenderSourceOptions
): WebAppRenderSource {
  const refreshFrame = CL_BuildRefreshFrame(runtime, {
    predictMovement: options.predictMovement ?? true,
    drawGun: options.drawGun ?? true
  });

  return {
    runtime,
    refreshFrame,
    screenState: SCR_BuildScreenState(runtime),
    skySnapshot: CL_BuildSkySnapshot(runtime),
    getBrushModelSnapshots: () => buildServerBackedBrushModelSnapshots(runtime, refreshFrame),
    getCvarValue: (name) => Cvar_VariableValue(options.cvar, name),
    resolveSoundPath: (soundIndex) => resolveClientSoundPath(runtime, soundIndex)
  };
}

/**
 * Original name: N/A
 * Source: N/A (web adapter)
 * Category: New
 * Purpose: Derive inline brush model transforms from the server-authored packet entities.
 *
 * Constraints:
 * - Must use the original `CS_MODELS + modelindex` configstring as the model name source.
 * - Must include only BSP inline models whose names follow the Quake II `*N` convention.
 * - Must preserve the client refresh frame number that drives ref_gl animated brush textures.
 */
export function buildServerBackedBrushModelSnapshots(client: ClientRuntime, refreshFrame?: ClientRefreshFrame | null): BrushModelSnapshot[] {
  const snapshots: BrushModelSnapshot[] = [];

  if (refreshFrame) {
    for (const entity of refreshFrame.entities) {
      const model = resolveClientModelPath(client, entity.modelindex);
      if (!model?.startsWith("*")) {
        continue;
      }

      snapshots.push({
        model,
        origin: [...entity.origin],
        angles: [...entity.angles],
        frame: entity.frame,
        flags: entity.flags
      });
    }

    return snapshots;
  }

  const frame = client.cl.frame;
  const parseEntities = client.cl_parse_entities;

  for (let index = 0; index < frame.num_entities; index += 1) {
    const parseIndex = (frame.parse_entities + index) & (parseEntities.length - 1);
    const entity = parseEntities[parseIndex];
    const model = resolveClientModelPath(client, entity.modelindex);
    if (!model?.startsWith("*")) {
      continue;
    }

    snapshots.push({
      model,
      origin: [...entity.origin],
      angles: [...entity.angles],
      frame: entity.frame,
      flags: entity.renderfx
    });
  }

  return snapshots;
}

/**
 * Original name: N/A
 * Source: N/A (web adapter)
 * Category: New
 * Purpose: Resolve a client sound precache entry back to the web-loadable Quake sound path.
 *
 * Constraints:
 * - Must support both transitional string precaches and concrete `sfx_t`-like sound handles.
 */
export function resolveClientSoundPath(client: ClientRuntime, soundIndex: number): string | null {
  return resolveClientSoundPathValue(client.cl.sound_precache[soundIndex]);
}

/**
 * Original name: N/A
 * Source: N/A (web adapter)
 * Category: New
 * Purpose: Resolve one opaque client sound precache value without depending on a concrete sound backend.
 */
export function resolveClientSoundPathValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value.length > 0 ? value : null;
  }

  if (typeof value !== "object" || value === null || !("name" in value)) {
    return null;
  }

  const name = (value as { name?: unknown }).name;
  return typeof name === "string" && name.length > 0 ? name : null;
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Resolve one client model index through authoritative configstrings before transitional handles.
 */
function resolveClientModelPath(client: ClientRuntime, modelIndex: number): string | null {
  if (modelIndex <= 0) {
    return null;
  }

  const configstring = client.cl.configstrings[CS_MODELS + modelIndex];
  if (configstring?.length) {
    return configstring;
  }

  const registered = client.cl.model_draw[modelIndex];
  return typeof registered === "string" && registered.length > 0 ? registered : null;
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Normalize server map requests and world-model configstrings to a BSP base name.
 */
function normalizeServerMapName(value: string): string | null {
  let name = value.trim().replaceAll("\\", "/");
  if (!name) {
    return null;
  }

  if (name.startsWith("*")) {
    name = name.slice(1);
  }

  const spawnpointIndex = name.indexOf("$");
  if (spawnpointIndex >= 0) {
    name = name.slice(0, spawnpointIndex);
  }

  if (name.toLowerCase().startsWith("maps/")) {
    name = name.slice(5);
  }

  if (name.toLowerCase().endsWith(".bsp")) {
    name = name.slice(0, -4);
  }

  return name.length > 0 ? name : null;
}
