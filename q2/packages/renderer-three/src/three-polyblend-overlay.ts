/**
 * File: three-polyblend-overlay.ts
 * Purpose: Adapt the ported `ref_gl` polyblend output to a Three.js fullscreen overlay.
 *
 * This file is not a direct source port.
 * It is an adapter layer for `gl_rmain.c` `R_PolyBlend` / `R_Flash` output.
 *
 * Dependencies:
 * - packages/client/src/refresh.ts
 * - packages/renderer-three/src/gl_rmain.ts
 * - three
 */

import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Scene,
  Vector3
} from "three";
import type { ClientRefreshFrame } from "../../client/src/refresh.js";
import type { GlRmainHooks } from "./gl_rmain.js";

/**
 * Original name: N/A
 * Source declaree: N/A (Three.js polyblend scene adapter)
 * Category: New
 * Purpose: Expose the scene, camera and hook surface used to render view blends as a Three.js overlay.
 */
export interface ThreePolyblendOverlay {
  scene: Scene;
  camera: OrthographicCamera;
  root: Group;
  hooks: Pick<GlRmainHooks, "polyBlend">;
  setViewport: (width: number, height: number) => void;
  applyBlend: (blend: readonly [number, number, number, number], enabled?: boolean) => void;
  applyFrame: (frame: ClientRefreshFrame | null, enabled?: boolean) => void;
  clear: () => void;
  dispose: () => void;
}

/**
 * Original name: N/A
 * Source declaree: N/A (Three.js polyblend scene adapter)
 * Category: New
 * Purpose: Create the fullscreen overlay used by the split Three.js runtime to display `R_PolyBlend`-style view blends.
 */
export function createThreePolyblendOverlay(): ThreePolyblendOverlay {
  const scene = new Scene();
  const camera = new OrthographicCamera(0, 1, 1, 0, -100, 100);
  const root = new Group();
  const geometry = createUnitQuadGeometry();
  const material = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false
  });
  const mesh = new Mesh(geometry, material);
  mesh.visible = false;
  mesh.name = "ref-gl-polyblend-overlay";
  mesh.userData.refGl = {
    source: "R_PolyBlend"
  };

  root.add(mesh);
  scene.add(root);

  const adapter: ThreePolyblendOverlay = {
    scene,
    camera,
    root,
    hooks: {
      polyBlend: (blend) => {
        adapter.applyBlend(blend);
      }
    },
    setViewport: (width, height) => {
      const viewportWidth = Math.max(1, width);
      const viewportHeight = Math.max(1, height);
      camera.left = 0;
      camera.right = viewportWidth;
      camera.top = viewportHeight;
      camera.bottom = 0;
      camera.position.set(0, 0, 10);
      camera.lookAt(new Vector3(0, 0, 0));
      camera.updateProjectionMatrix();
      mesh.position.set(viewportWidth / 2, viewportHeight / 2, 0);
      mesh.scale.set(viewportWidth, viewportHeight, 1);
    },
    applyBlend: (blend, enabled = true) => {
      const alpha = clamp01(blend[3]);
      if (!enabled || alpha <= 0) {
        mesh.visible = false;
        material.opacity = 0;
        return;
      }

      material.color.setRGB(clamp01(blend[0]), clamp01(blend[1]), clamp01(blend[2]));
      material.opacity = alpha;
      material.needsUpdate = true;
      mesh.visible = true;
      mesh.userData.refGl.blend = [
        clamp01(blend[0]),
        clamp01(blend[1]),
        clamp01(blend[2]),
        alpha
      ];
    },
    applyFrame: (frame, enabled = true) => {
      adapter.applyBlend(frame?.view.blend ?? [0, 0, 0, 0], enabled);
    },
    clear: () => {
      adapter.applyBlend([0, 0, 0, 0]);
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    }
  };

  adapter.setViewport(1, 1);
  return adapter;
}

/**
 * Original name: N/A
 * Source declaree: N/A (Three.js overlay geometry helper)
 * Category: New
 * Purpose: Build a centered unit quad that is scaled to the current viewport.
 */
function createUnitQuadGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array([
    -0.5, -0.5, 0,
    0.5, -0.5, 0,
    -0.5, 0.5, 0,
    0.5, 0.5, 0
  ]), 3));
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  return geometry;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local color channel helper)
 * Category: New
 * Purpose: Clamp overlay color and alpha channels to the normalized range expected by Three.js materials.
 */
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
