/**
 * File: refresh-debug-layer.ts
 * Purpose: Hold the lightweight web-only Three.js debug layer for client refresh force walls and sustains.
 *
 * This file is not a direct source port.
 * It is an adapter layer for visual debugging in the browser renderer.
 *
 * Dependencies:
 * - packages/client
 * - three
 */

import {
  BufferGeometry,
  Color,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  SphereGeometry,
  Vector3
} from "three";
import type { ClientRefreshFrame } from "../../../packages/client/src/index.js";

/**
 * Category: New
 * Original name: N/A
 * Source: N/A (web debug adapter)
 * Purpose: Build a lightweight scene debug layer for client refresh force walls and sustains.
 *
 * Constraints:
 * - Must stay cheap enough to rebuild every frame during the current prototype stage.
 */
export function createRefreshDebugLayer(): {
  root: Group;
  update: (frame: ClientRefreshFrame | null) => void;
} {
  const root = new Group();
  const forceWalls = new Group();
  const sustains = new Group();
  root.add(forceWalls);
  root.add(sustains);

  const forceWallMaterial = new LineBasicMaterial({ color: new Color("#e0a85f"), transparent: true, opacity: 0.9 });
  const steamMaterial = new LineBasicMaterial({ color: new Color("#c6d5d9"), transparent: true, opacity: 0.75 });
  const widowMaterial = new MeshBasicMaterial({ color: new Color("#8dd6ff"), wireframe: true, transparent: true, opacity: 0.4 });
  const nukeMaterial = new MeshBasicMaterial({ color: new Color("#ffb347"), wireframe: true, transparent: true, opacity: 0.35 });

  return {
    root,
    update: (frame) => {
      clearGroup(forceWalls);
      clearGroup(sustains);

      if (!frame) {
        return;
      }

      for (const wall of frame.forceWalls) {
        forceWalls.add(createLineObject(wall.start, wall.end, forceWallMaterial));
      }

      for (const sustain of frame.sustains) {
        sustains.add(createSustainObject(sustain, steamMaterial, widowMaterial, nukeMaterial));
      }
    }
  };
}

/**
 * Category: New
 * Original name: N/A
 * Source: N/A (web debug adapter)
 * Purpose: Create one simple Three.js line object between two Quake-space points.
 */
function createLineObject(start: [number, number, number], end: [number, number, number], material: LineBasicMaterial): Line {
  const geometry = new BufferGeometry().setFromPoints([
    new Vector3(start[0], start[1], start[2]),
    new Vector3(end[0], end[1], end[2])
  ]);
  return new Line(geometry, material);
}

/**
 * Category: New
 * Original name: N/A
 * Source: N/A (web debug adapter)
 * Purpose: Create one minimal debug object representing a client sustain effect.
 */
function createSustainObject(
  sustain: ClientRefreshFrame["sustains"][number],
  steamMaterial: LineBasicMaterial,
  widowMaterial: MeshBasicMaterial,
  nukeMaterial: MeshBasicMaterial
): Object3D {
  if (sustain.kind === "steam") {
    const end: [number, number, number] = [
      sustain.origin[0] + sustain.direction[0] * sustain.radius,
      sustain.origin[1] + sustain.direction[1] * sustain.radius,
      sustain.origin[2] + sustain.direction[2] * sustain.radius
    ];
    return createLineObject(sustain.origin, end, steamMaterial);
  }

  const geometry = new SphereGeometry(Math.max(8, sustain.radius), 10, 8);
  const material = sustain.kind === "widow" ? widowMaterial : nukeMaterial;
  const mesh = new Mesh(geometry, material);
  mesh.position.set(sustain.origin[0], sustain.origin[1], sustain.origin[2]);
  return mesh;
}

/**
 * Category: New
 * Original name: N/A
 * Source: N/A (web debug adapter)
 * Purpose: Remove and dispose all transient debug objects from one Three.js group.
 */
function clearGroup(group: Group): void {
  const children = [...group.children];
  for (const child of children) {
    group.remove(child);
    disposeObject(child);
  }
}

/**
 * Category: New
 * Original name: N/A
 * Source: N/A (web debug adapter)
 * Purpose: Dispose transient line geometries created by the current debug refresh layer.
 */
function disposeObject(object: Object3D): void {
  if ("geometry" in object) {
    const geometry = (object as { geometry?: BufferGeometry | SphereGeometry }).geometry;
    geometry?.dispose();
  }
}
