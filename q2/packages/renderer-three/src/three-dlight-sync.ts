/**
 * File: three-dlight-sync.ts
 * Purpose: Synchronize client refresh dynamic lights into Three.js through the ported `ref_gl` `R_RenderDlights` path.
 *
 * This file is not a direct source port.
 * It is an adapter layer for `gl_light.c` flashblend dynamic-light output.
 *
 * Dependencies:
 * - packages/client/src/ref.ts
 * - packages/client/src/refresh.ts
 * - packages/renderer-three/src/gl_light.ts
 * - three
 */

import { createRefDef, type dlight_t } from "../../client/src/ref.js";
import type { ClientRefreshFrame } from "../../client/src/refresh.js";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  type Object3D
} from "three";
import {
  R_RenderDlights,
  createGlLightRuntime,
  setGlFlashblendEnabled,
  setGlLightFrameCount,
  setGlLightRefdef,
  setGlLightViewVectors,
  type GlLightRuntime
} from "./gl_light.js";

/**
 * Original name: N/A
 * Source declaree: N/A (Three.js dlight scene adapter)
 * Category: New
 * Purpose: Public handle for applying refresh dynamic lights to an adapter-owned Three.js group.
 */
export interface ThreeDlightSync {
  root: Group;
  apply: (refreshFrame: ClientRefreshFrame | null) => number;
  dispose: () => void;
}

/**
 * Original name: N/A
 * Source declaree: N/A (Three.js dlight scene adapter)
 * Category: New
 * Purpose: Create the Three.js adapter that consumes `R_RenderDlights` output for refresh dynamic lights.
 */
export function createThreeDlightSync(): ThreeDlightSync {
  const root = new Group();
  root.name = "refresh-dlights-ref-gl";
  const runtime = createGlLightRuntime({
    beginFlashblendDlights: () => {
      clearGroup(root);
    },
    renderDlight: (light, center, ring, radius) => {
      const group = new Group();
      group.name = "ref-gl-dlight";
      group.userData.refGl = {
        source: "R_RenderDlights",
        radius,
        intensity: light.intensity,
        color: [...light.color]
      };
      group.add(createFlashblendMesh(light, center, ring));
      root.add(group);
    },
    endFlashblendDlights: () => {}
  });
  setGlFlashblendEnabled(runtime, true);

  let frameCount = 0;

  return {
    root,
    apply: (refreshFrame) => {
      if (!refreshFrame || refreshFrame.lights.length === 0) {
        clearGroup(root);
        return 0;
      }

      frameCount += 1;
      setGlLightFrameCount(runtime, frameCount);
      setGlLightViewVectors(runtime, {
        origin: [...refreshFrame.view.vieworg],
        vpn: [...refreshFrame.view.forward],
        vright: [...refreshFrame.view.right],
        vup: [...refreshFrame.view.up]
      });
      setGlLightRefdef(runtime, createDlightRefdef(refreshFrame));
      R_RenderDlights(runtime);
      return root.children.length;
    },
    dispose: () => {
      clearGroup(root);
    }
  };
}

/**
 * Original name: N/A
 * Source declaree: N/A (Three.js dlight refdef adapter)
 * Category: New
 * Purpose: Convert a client refresh frame into the refdef shape consumed by the ported light runtime.
 */
function createDlightRefdef(refreshFrame: ClientRefreshFrame): ReturnType<typeof createRefDef> {
  const refdef = createRefDef();
  refdef.vieworg = [...refreshFrame.view.vieworg];
  refdef.viewangles = [...refreshFrame.view.viewangles];
  refdef.fov_x = refreshFrame.view.fov_x;
  refdef.num_dlights = refreshFrame.lights.length;
  refdef.dlights = refreshFrame.lights.map((light) => ({
    origin: [...light.origin],
    color: [...light.color],
    intensity: light.intensity
  }));
  return refdef;
}

/**
 * Original name: N/A
 * Source declaree: N/A (Three.js flashblend mesh adapter)
 * Category: New
 * Purpose: Materialize the `R_RenderDlight` triangle fan as a disposable Three.js mesh.
 */
function createFlashblendMesh(
  light: dlight_t,
  center: readonly [number, number, number],
  ring: readonly [number, number, number][]
): Mesh<BufferGeometry, MeshBasicMaterial> {
  const positions: number[] = [center[0], center[1], center[2]];
  for (const point of ring) {
    positions.push(point[0], point[1], point[2]);
  }

  const indices: number[] = [];
  for (let index = 1; index < ring.length; index += 1) {
    indices.push(0, index, index + 1);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);

  const material = new MeshBasicMaterial({
    color: createThreeColor(light.color),
    transparent: true,
    opacity: 0.35,
    depthTest: true,
    depthWrite: false,
    blending: AdditiveBlending,
    toneMapped: false
  });

  const mesh = new Mesh(geometry, material);
  mesh.name = "ref-gl-dlight-flashblend";
  mesh.frustumCulled = false;
  mesh.renderOrder = 25;
  return mesh;
}

/**
 * Original name: N/A
 * Source declaree: N/A (Three.js color adapter)
 * Category: New
 * Purpose: Clamp refresh light color channels into the Three.js color object used by flashblend meshes.
 */
function createThreeColor(color: readonly [number, number, number]): Color {
  return new Color(
    Math.max(0, color[0]),
    Math.max(0, color[1]),
    Math.max(0, color[2])
  );
}

/**
 * Original name: N/A
 * Source declaree: N/A (Three.js object lifecycle helper)
 * Category: New
 * Purpose: Clear an adapter-owned group and dispose all nested resources.
 */
function clearGroup(group: Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    disposeObject(child);
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (Three.js object lifecycle helper)
 * Category: New
 * Purpose: Dispose geometry and materials owned by the dlight adapter.
 */
function disposeObject(object: Object3D): void {
  if (object instanceof Mesh) {
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      material.dispose();
    }
  }

  for (const child of [...object.children]) {
    disposeObject(child);
  }
}
