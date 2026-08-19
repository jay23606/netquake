/**
 * File: web-render-bootstrap.ts
 * Purpose: Hold the web renderer, scene and camera bootstrap helpers used by the Quake2JS browser app.
 *
 * This file is not a direct source port.
 * It is an adapter layer for Three.js renderer and scene bootstrap.
 *
 * Dependencies:
 * - packages/formats
 * - packages/client
 * - three
 */

import {
  AmbientLight,
  Color,
  DirectionalLight,
  Group,
  PerspectiveCamera,
  Scene,
  WebGLRenderer
} from "three";
import { WebGPURenderer } from "three/webgpu";
import type { BspMap } from "../../../packages/formats/src/index.js";
import type { QuakeSkySnapshot } from "../../../packages/client/src/index.js";

/**
 * Original name: N/A
 * Source: N/A (web renderer bootstrap)
 * Category: New
 * Purpose: Describe the active Three.js renderer used by the browser app.
 */
export type ActiveRenderer = WebGPURenderer | WebGLRenderer;

/**
 * Original name: N/A
 * Source: N/A (web renderer bootstrap)
 * Category: New
 * Purpose: Create the preferred Three.js renderer with WebGPU first and WebGL fallback.
 *
 * Constraints:
 * - Must await WebGPU backend initialization before rendering.
 */
export async function createRenderer(): Promise<{ renderer: ActiveRenderer; label: string }> {
  const canvas = document.createElement("canvas");

  if ("gpu" in navigator) {
    try {
      const renderer = new WebGPURenderer({ antialias: true, canvas });
      await renderer.init();
      renderer.setClearColor(new Color("#0d0906"));
      return { renderer, label: "WebGPU" };
    } catch {
      // WebGL fallback is intentional when WebGPU init fails.
    }
  }

  const renderer = new WebGLRenderer({ antialias: true, canvas });
  renderer.setClearColor(new Color("#0d0906"));
  return { renderer, label: "WebGL" };
}

/**
 * Original name: N/A
 * Source: N/A (web renderer bootstrap)
 * Category: New
 * Purpose: Create a minimal lit scene around the generated BSP group.
 *
 * Constraints:
 * - Must preserve the Quake-friendly Z-up convention.
 */
export function createScene(group: Group): Scene {
  const scene = new Scene();
  scene.background = new Color("#0d0906");
  scene.add(group);

  const ambient = new AmbientLight(0xffffff, 0.8);
  const directional = new DirectionalLight(0xffffff, 0.35);
  directional.position.set(0.8, 0.2, 1);

  scene.add(ambient);
  scene.add(directional);
  return scene;
}

/**
 * Original name: N/A
 * Source: N/A (web renderer bootstrap)
 * Category: New
 * Purpose: Create the main perspective camera used for the map preview.
 *
 * Constraints:
 * - Must use Z-up to stay aligned with Quake II coordinates.
 */
export function createCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(75, 1, 4, 20000);
  camera.up.set(0, 0, 1);
  return camera;
}

/**
 * Original name: N/A
 * Source: N/A (web renderer bootstrap)
 * Category: New
 * Purpose: Resolve the compiled render origin used for one BSP inline model group.
 *
 * Constraints:
 * - Must match the entity `origin` field when present.
 * - Must fall back to the BSP model origin for safety.
 */
export function getInlineModelRenderOrigin(map: BspMap, modelIndex: number): [number, number, number] {
  if (modelIndex <= 0) {
    return [0, 0, 0];
  }

  const modelName = `*${modelIndex}`;
  const entity = map.parsedEntities.find((candidate) => candidate.properties.model === modelName);
  if (entity?.properties.origin) {
    const origin = parseEntityOrigin(entity.properties.origin);
    if (origin) {
      return origin;
    }
  }

  const model = map.models[modelIndex];
  return model ? [...model.origin] : [0, 0, 0];
}

/**
 * Original name: N/A
 * Source: N/A (web renderer bootstrap)
 * Category: New
 * Purpose: Format one optional Quake II sky snapshot for the lightweight web debug overlay.
 *
 * Constraints:
 * - Must stay readable without assuming the renderer sky implementation already exists.
 */
export function formatSkySnapshot(skySnapshot: QuakeSkySnapshot | null): string {
  if (!skySnapshot) {
    return "aucun";
  }

  return `${skySnapshot.name} | rot ${skySnapshot.rotate} | axis ${skySnapshot.axis.join(", ")}`;
}

/**
 * Original name: N/A
 * Source: N/A (web renderer bootstrap)
 * Category: New
 * Purpose: Parse one Quake-style entity origin string into a numeric tuple.
 */
function parseEntityOrigin(value: string): [number, number, number] | null {
  const parts = value.trim().split(/\s+/).map((part) => Number.parseFloat(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }

  return [parts[0], parts[1], parts[2]];
}
