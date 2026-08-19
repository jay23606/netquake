/**
 * File: sky-scene-adapter.ts
 * Source: Quake II original / ref_gl/gl_warp.c
 * Purpose: Render the active Quake II sky with face ordering and texture mapping aligned to the original skybox code path.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Keeps a full six-face skybox fallback when no clipped `R_DrawSkyBox` faces are available.
 * - Uses Three.js meshes and UVs in place of immediate-mode OpenGL calls.
 *
 * Notes:
 * - This file intentionally follows the original `st_to_vec`, `skytexorder` and `MakeSkyVec` conventions.
 */

import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  Vector3,
  type Camera
} from "three";
import { QUAKE_SKY_FACE_SUFFIXES, type QuakeSkySnapshot } from "../../renderer-common/src/index.js";
import type { LoadedQuakeSkyTextureSet, QuakeSkyResolver } from "./quake-sky-resolver.js";
import { MakeSkyVec, SKY_TEX_ORDER, createGlWarpRuntime, getSkyTexClampBounds, type GlWarpSkyFace } from "./gl_warp.js";

/**
 * Original name: N/A
 * Source: N/A (Three.js sky scene adapter)
 * Category: New
 * Purpose: Hold the imperative hooks used to keep the rendered sky aligned with client sky state and camera movement.
 *
 * Constraints:
 * - Must tolerate `null` sky snapshots without breaking the scene.
 */
export interface ThreeSkySceneAdapter {
  root: Group;
  update: (snapshot: QuakeSkySnapshot | null, camera: Camera, elapsedSeconds: number, skyFaces?: readonly GlWarpSkyFace[]) => void;
}

/**
 * Original name: N/A
 * Source: N/A (Three.js sky scene adapter)
 * Category: New
 * Purpose: Create a dedicated Three.js sky adapter that follows Quake II face ordering and UV conventions.
 *
 * Constraints:
 * - Must render sky independently from BSP geometry.
 * - Must keep the sky centered on the camera origin.
 */
export function createThreeSkySceneAdapter(resolver: QuakeSkyResolver): ThreeSkySceneAdapter {
  const root = new Group();
  root.name = "quake-sky-root";

  let currentSkyKey = "";
  let currentSkyMesh: Mesh | null = null;

  return {
    root,
    update: (snapshot, camera, elapsedSeconds, skyFaces = []) => {
      root.position.copy(camera.position);

      if (!snapshot) {
        currentSkyKey = "";
        currentSkyMesh = replaceSkyMesh(root, currentSkyMesh, null);
        return;
      }

      const nextSkyKey = buildSkyKey(snapshot, skyFaces);
      if (nextSkyKey !== currentSkyKey) {
        currentSkyKey = nextSkyKey;
        const textureSet = resolver.resolveTextureSet(snapshot.name);
        currentSkyMesh = replaceSkyMesh(root, currentSkyMesh, textureSet ? createSkyMesh(textureSet, snapshot.rotate, skyFaces) : null);
      }

      if (!currentSkyMesh) {
        return;
      }

      const axis = normalizeAxis(snapshot.axis);
      const rotationRadians = degreesToRadians(snapshot.rotate * elapsedSeconds);
      if (axis.lengthSq() === 0 || rotationRadians === 0) {
        currentSkyMesh.quaternion.identity();
        return;
      }

      currentSkyMesh.quaternion.copy(new Quaternion().setFromAxisAngle(axis, rotationRadians));
    }
  };
}

/**
 * Original name: N/A
 * Source: N/A (Three.js sky scene cache helper)
 * Category: New
 * Purpose: Build a stable cache key from the active Quake II sky snapshot.
 */
function buildSkyKey(snapshot: QuakeSkySnapshot, skyFaces: readonly GlWarpSkyFace[]): string {
  return `${snapshot.name}|${snapshot.rotate}|${snapshot.axis.join(",")}|${buildSkyFacesKey(skyFaces)}`;
}

/**
 * Original name: N/A
 * Source: N/A (Three.js sky scene cache helper)
 * Category: New
 * Purpose: Build the clipped-sky-face portion of the sky mesh cache key.
 */
function buildSkyFacesKey(skyFaces: readonly GlWarpSkyFace[]): string {
  if (skyFaces.length === 0) {
    return "full";
  }

  return skyFaces
    .map((face) => `${face.axis}:${face.mins.join(",")}:${face.maxs.join(",")}`)
    .join("|");
}

/**
 * Original name: N/A
 * Source: N/A (Three.js sky scene adapter)
 * Category: New
 * Purpose: Replace the currently rendered sky mesh while disposing previous sky resources.
 *
 * Constraints:
 * - Must keep exactly one active sky child under the adapter root.
 */
function replaceSkyMesh(root: Group, currentMesh: Mesh | null, nextMesh: Mesh | null): Mesh | null {
  if (currentMesh) {
    root.remove(currentMesh);
    disposeSkyMesh(currentMesh);
  }

  if (nextMesh) {
    root.add(nextMesh);
  }

  return nextMesh;
}

/**
 * Original name: N/A
 * Source: N/A (Three.js sky mesh adapter)
 * Category: New
 * Purpose: Build one Quake II-style sky mesh with explicit per-face geometry and texture mapping.
 *
 * Constraints:
 * - Must preserve the original `skytexorder` face-to-texture correspondence.
 * - Must preserve the original `MakeSkyVec` vertex ordering.
 */
function createSkyMesh(textureSet: LoadedQuakeSkyTextureSet, rotate: number, skyFaces: readonly GlWarpSkyFace[]): Mesh {
  const geometry = skyFaces.length > 0
    ? buildSkyFacesGeometry(skyFaces)
    : buildFullSkyGeometry(rotate);
  const materials = buildSkyMaterials(textureSet);
  const mesh = new Mesh(geometry, materials);
  mesh.name = `quake-sky:${textureSet.assets.name}`;
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  mesh.userData.refGl = {
    source: skyFaces.length > 0 ? "R_DrawSkyBox" : "full-skybox-fallback",
    skyFaceCount: skyFaces.length || 6
  };
  return mesh;
}

/**
 * Original name: N/A
 * Source: N/A (Three.js sky geometry fallback)
 * Category: New
 * Purpose: Build the full skybox geometry from the Quake II `MakeSkyVec` convention.
 *
 * Constraints:
 * - Must emit six quads in axis order.
 * - Must use the original texture clamp interval for rotating vs non-rotating skies.
 */
function buildFullSkyGeometry(rotate: number): BufferGeometry {
  const { skyMin, skyMax } = getSkyTexClampBounds(rotate);
  const warpRuntime = createGlWarpRuntime();
  warpRuntime.sky_min = skyMin;
  warpRuntime.sky_max = skyMax;

  const positions = new Float32Array(6 * 4 * 3);
  const uvs = new Float32Array(6 * 4 * 2);
  const indices = new Uint16Array(6 * 6);

  let vertexOffset = 0;
  let uvOffset = 0;
  let indexOffset = 0;

  for (let axis = 0; axis < 6; axis += 1) {
    const corners: Array<[number, number]> = [
      [-1, -1],
      [-1, 1],
      [1, 1],
      [1, -1]
    ];

    for (let cornerIndex = 0; cornerIndex < corners.length; cornerIndex += 1) {
      const [s, t] = corners[cornerIndex];
      const vertex = MakeSkyVec(warpRuntime, s, t, axis);

      positions[vertexOffset] = vertex.position[0];
      positions[vertexOffset + 1] = vertex.position[1];
      positions[vertexOffset + 2] = vertex.position[2];
      vertexOffset += 3;

      uvs[uvOffset] = vertex.uv[0];
      uvs[uvOffset + 1] = vertex.uv[1];
      uvOffset += 2;
    }

    const baseVertex = axis * 4;
    indices[indexOffset] = baseVertex;
    indices[indexOffset + 1] = baseVertex + 1;
    indices[indexOffset + 2] = baseVertex + 2;
    indices[indexOffset + 3] = baseVertex;
    indices[indexOffset + 4] = baseVertex + 2;
    indices[indexOffset + 5] = baseVertex + 3;
    indexOffset += 6;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));

  geometry.clearGroups();
  for (let axis = 0; axis < 6; axis += 1) {
    geometry.addGroup(axis * 6, 6, axis);
  }

  return geometry;
}

/**
 * Original name: N/A
 * Source: N/A (Three.js clipped sky geometry adapter)
 * Category: New
 * Purpose: Build the visible sky geometry directly from faces emitted by `R_DrawSkyBox`.
 */
function buildSkyFacesGeometry(skyFaces: readonly GlWarpSkyFace[]): BufferGeometry {
  const positions = new Float32Array(skyFaces.length * 4 * 3);
  const uvs = new Float32Array(skyFaces.length * 4 * 2);
  const indices = new Uint32Array(skyFaces.length * 6);

  let vertexOffset = 0;
  let uvOffset = 0;
  let indexOffset = 0;

  for (let faceIndex = 0; faceIndex < skyFaces.length; faceIndex += 1) {
    const face = skyFaces[faceIndex];
    for (const vertex of face.vertices) {
      positions[vertexOffset] = vertex.position[0];
      positions[vertexOffset + 1] = vertex.position[1];
      positions[vertexOffset + 2] = vertex.position[2];
      vertexOffset += 3;

      uvs[uvOffset] = vertex.uv[0];
      uvs[uvOffset + 1] = vertex.uv[1];
      uvOffset += 2;
    }

    const baseVertex = faceIndex * 4;
    indices[indexOffset] = baseVertex;
    indices[indexOffset + 1] = baseVertex + 1;
    indices[indexOffset + 2] = baseVertex + 2;
    indices[indexOffset + 3] = baseVertex;
    indices[indexOffset + 4] = baseVertex + 2;
    indices[indexOffset + 5] = baseVertex + 3;
    indexOffset += 6;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));

  geometry.clearGroups();
  for (let faceIndex = 0; faceIndex < skyFaces.length; faceIndex += 1) {
    geometry.addGroup(faceIndex * 6, 6, skyFaces[faceIndex].axis);
  }

  return geometry;
}

/**
 * Original name: N/A
 * Source: N/A (Three.js sky material adapter)
 * Category: New
 * Purpose: Build the six sky materials in the same effective face order used by the original renderer.
 *
 * Constraints:
 * - Must preserve `skytexorder`.
 */
function buildSkyMaterials(textureSet: LoadedQuakeSkyTextureSet): MeshBasicMaterial[] {
  return SKY_TEX_ORDER.map((textureIndex) => {
    const faceName = QUAKE_SKY_FACE_SUFFIXES[textureIndex];
    return new MeshBasicMaterial({
      map: textureSet.textures[faceName],
      side: BackSide,
      depthWrite: false,
      fog: false
    });
  });
}

/**
 * Original name: N/A
 * Source: N/A (Three.js sky resource lifecycle)
 * Category: New
 * Purpose: Dispose one transient sky mesh and its owned geometry/material state.
 */
function disposeSkyMesh(mesh: Mesh): void {
  mesh.geometry.dispose();
  const material = mesh.material;
  if (Array.isArray(material)) {
    for (const entry of material) {
      entry.dispose();
    }
    return;
  }

  material.dispose();
}

/**
 * Original name: N/A
 * Source: N/A (local angle conversion helper)
 * Category: New
 * Purpose: Convert degrees to radians for sky rotation updates.
 */
function degreesToRadians(value: number): number {
  return value * Math.PI / 180;
}

/**
 * Original name: N/A
 * Source: N/A (Three.js sky axis helper)
 * Category: New
 * Purpose: Normalize one Quake II sky axis into a stable Three.js vector.
 *
 * Constraints:
 * - Must return a zero vector when no valid axis is present.
 */
function normalizeAxis(axis: [number, number, number]): Vector3 {
  const vector = new Vector3(axis[0], axis[1], axis[2]);
  if (vector.lengthSq() === 0) {
    return vector;
  }

  return vector.normalize();
}
