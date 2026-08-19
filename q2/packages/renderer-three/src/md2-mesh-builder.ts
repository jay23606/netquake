/**
 * File: md2-mesh-builder.ts
 * Purpose: Convert parsed Quake II MD2 models into Three.js meshes with optional PCX skins.
 *
 * This file is not a direct source port.
 * It is an adapter layer between the MD2 asset format and the Three.js backend.
 *
 * Dependencies:
 * - packages/formats
 * - packages/filesystem
 * - three
 */

import { readMountedFile, type VirtualFilesystem } from "../../filesystem/src/index.js";
import { parseMd2, parsePcx, type Md2Model } from "../../formats/src/index.js";
import { applyOriginalTextureIntensity, type QuakeTextureLightingSettings } from "./quake-texture-intensity.js";
import {
  AngleVectors,
  DotProduct,
  RF_SHELL_BLUE,
  RF_SHELL_DOUBLE,
  RF_SHELL_GREEN,
  RF_SHELL_HALF_DAM,
  RF_SHELL_RED,
  DirFromByte
} from "../../qcommon/src/index.js";
import { POWERSUIT_SCALE } from "../../client/src/ref.js";
import {
  BackSide,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  LinearFilter,
  LinearMipmapNearestFilter,
  Mesh,
  MeshBasicMaterial,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  type Texture
} from "three";

/**
 * Original name: N/A
 * Source: N/A (Three.js MD2 mesh adapter)
 * Category: New
 * Purpose: Store the Three.js objects and frame metadata required to animate one MD2 mesh.
 *
 * Constraints:
 * - Must preserve access to the parsed source model for future adapter work.
 */
export interface Md2MeshInstance {
  mesh: Mesh<BufferGeometry, MeshBasicMaterial>;
  model: Md2Model;
  skinTexture: Texture | null;
  vertexIndices: Uint32Array;
}

/**
 * Original name: N/A
 * Source: N/A (Three.js MD2 mesh adapter)
 * Category: New
 * Purpose: Control how one MD2 mesh is created.
 *
 * Constraints:
 * - Defaults must keep the mesh visible even without a decoded skin.
 */
export interface Md2MeshBuildOptions {
  skinPath?: string;
  skinTexture?: Texture | null;
  textureLighting?: Partial<QuakeTextureLightingSettings>;
}

/**
 * Original name: N/A
 * Source: N/A (alias entity adapter shape)
 * Category: New
 * Purpose: Describe the renderer-facing alias entity state needed by the strict `GL_LerpVerts`-style MD2 interpolation path.
 *
 * Constraints:
 * - Must preserve the original frame/origin/angle/backlerp payload expected by `ref_gl/gl_mesh.c`.
 */
export interface Md2AliasEntityState {
  frame: number;
  oldframe: number;
  backlerp: number;
  flags: number;
  origin: [number, number, number];
  oldorigin: [number, number, number];
  angles: [number, number, number];
}

/**
 * Original name: N/A
 * Source: N/A (Three.js MD2 mesh adapter)
 * Category: New
 * Purpose: Build one visible Three.js mesh from a parsed Quake II MD2 model.
 *
 * Constraints:
 * - Must preserve the source triangle indexing and UV mapping.
 * - Must initialize geometry from frame zero.
 */
export function buildMd2Mesh(
  filesystem: VirtualFilesystem,
  model: Md2Model,
  options: Md2MeshBuildOptions = {}
): Md2MeshInstance {
  const md2Geometry = createMd2Geometry(model);
  const skinPath = options.skinPath ?? model.skins[0] ?? null;
  const skinTexture = options.skinTexture !== undefined
    ? options.skinTexture
    : skinPath
      ? loadMd2SkinTexture(filesystem, skinPath, options.textureLighting)
      : null;
  const material = skinTexture
    ? new MeshBasicMaterial({
        map: skinTexture,
        alphaTest: 0.5,
        transparent: false,
        side: BackSide
      })
    : new MeshBasicMaterial({ color: 0xc9b48c });
  const mesh = new Mesh(md2Geometry.geometry, material);
  mesh.name = `md2:${skinPath ?? "unskinned"}`;

  return {
    mesh,
    model,
    skinTexture,
    vertexIndices: md2Geometry.vertexIndices
  };
}

/**
 * Original name: N/A
 * Source: N/A (MD2 VFS loader)
 * Category: New
 * Purpose: Load and parse one MD2 model from the mounted virtual filesystem.
 *
 * Constraints:
 * - Must return null when the source asset is missing.
 */
export function loadMd2Model(filesystem: VirtualFilesystem, path: string): Md2Model | null {
  const file = readMountedFile(filesystem, path);
  if (!file) {
    return null;
  }

  return parseMd2(file.bytes, file.path);
}

/**
 * Original name: N/A
 * Source: N/A (Three.js MD2 frame adapter)
 * Category: New
 * Purpose: Apply one MD2 animation frame to an existing mesh geometry.
 *
 * Constraints:
 * - Must update only the position attribute data.
 */
export function applyMd2Frame(meshInstance: Md2MeshInstance, frameIndex: number): void {
  const frame = meshInstance.model.frames[frameIndex];
  if (!frame) {
    return;
  }

  const positionAttribute = meshInstance.mesh.geometry.getAttribute("position") as BufferAttribute | undefined;
  if (!positionAttribute) {
    return;
  }

  const array = positionAttribute.array as Float32Array;
  let writeIndex = 0;

  for (const sourceVertexIndex of meshInstance.vertexIndices) {
    const vertexIndex = sourceVertexIndex * 3;
    array[writeIndex] = frame.positions[vertexIndex];
    array[writeIndex + 1] = frame.positions[vertexIndex + 1];
    array[writeIndex + 2] = frame.positions[vertexIndex + 2];
    writeIndex += 3;
  }

  positionAttribute.needsUpdate = true;
  refreshMd2GeometryBounds(meshInstance.mesh.geometry);
  meshInstance.mesh.geometry.computeVertexNormals();
}

/**
 * Original name: N/A
 * Source: N/A (Three.js MD2 frame adapter)
 * Category: New
 * Purpose: Apply one interpolated MD2 pose between two source frames using the Quake-style backlerp fraction.
 *
 * Constraints:
 * - Must fall back to a single frame when one source frame is unavailable.
 * - Must preserve the original triangle indexing and only mutate the position buffer.
 */
export function applyMd2LerpedFrame(
  meshInstance: Md2MeshInstance,
  currentFrameIndex: number,
  previousFrameIndex: number,
  backlerp: number
): void {
  const currentFrame = meshInstance.model.frames[currentFrameIndex];
  const previousFrame = meshInstance.model.frames[previousFrameIndex];
  if (!currentFrame) {
    return;
  }

  if (!previousFrame || currentFrameIndex === previousFrameIndex || backlerp <= 0) {
    applyMd2Frame(meshInstance, currentFrameIndex);
    return;
  }

  const frontlerp = 1 - backlerp;
  const positionAttribute = meshInstance.mesh.geometry.getAttribute("position") as BufferAttribute | undefined;
  if (!positionAttribute) {
    return;
  }

  const array = positionAttribute.array as Float32Array;
  let writeIndex = 0;

  for (const sourceVertexIndex of meshInstance.vertexIndices) {
    const vertexIndex = sourceVertexIndex * 3;
    array[writeIndex] =
      (previousFrame.positions[vertexIndex] * backlerp) +
      (currentFrame.positions[vertexIndex] * frontlerp);
    array[writeIndex + 1] =
      (previousFrame.positions[vertexIndex + 1] * backlerp) +
      (currentFrame.positions[vertexIndex + 1] * frontlerp);
    array[writeIndex + 2] =
      (previousFrame.positions[vertexIndex + 2] * backlerp) +
      (currentFrame.positions[vertexIndex + 2] * frontlerp);
    writeIndex += 3;
  }

  positionAttribute.needsUpdate = true;
  refreshMd2GeometryBounds(meshInstance.mesh.geometry);
  meshInstance.mesh.geometry.computeVertexNormals();
}

/**
 * Original name: GL_LerpVerts / GL_DrawAliasFrameLerp
 * Source: ref_gl/gl_mesh.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies Quake II alias-model vertex interpolation using compressed MD2 vertices plus
 *   frame scale/translate and the original `oldorigin/origin` local-space movement correction.
 *
 * Porting notes:
 * - Reuses decoded mesh topology from this adapter but preserves the original lerp math and shell offset semantics.
 */
export function applyMd2AliasFrameLerp(meshInstance: Md2MeshInstance, entityState: Md2AliasEntityState): void {
  const frame = meshInstance.model.frames[entityState.frame];
  if (!frame) {
    return;
  }

  const shell = hasShellFlags(entityState.flags);
  const oldframe = meshInstance.model.frames[entityState.oldframe];
  if (!shell && (!oldframe || entityState.frame === entityState.oldframe || entityState.backlerp <= 0)) {
    applyMd2Frame(meshInstance, entityState.frame);
    return;
  }

  const positionAttribute = meshInstance.mesh.geometry.getAttribute("position") as BufferAttribute | undefined;
  if (!positionAttribute) {
    return;
  }

  const frontlerp = oldframe && entityState.frame !== entityState.oldframe && entityState.backlerp > 0
    ? 1 - entityState.backlerp
    : 1;
  const vectors = AngleVectors(entityState.angles);
  const delta: [number, number, number] = [
    entityState.oldorigin[0] - entityState.origin[0],
    entityState.oldorigin[1] - entityState.origin[1],
    entityState.oldorigin[2] - entityState.origin[2]
  ];

  const move: [number, number, number] = [
    DotProduct(delta, vectors.forward),
    -DotProduct(delta, vectors.right),
    DotProduct(delta, vectors.up)
  ];

  move[0] += oldframe?.translate[0] ?? frame.translate[0];
  move[1] += oldframe?.translate[1] ?? frame.translate[1];
  move[2] += oldframe?.translate[2] ?? frame.translate[2];

  move[0] = entityState.backlerp * move[0] + frontlerp * frame.translate[0];
  move[1] = entityState.backlerp * move[1] + frontlerp * frame.translate[1];
  move[2] = entityState.backlerp * move[2] + frontlerp * frame.translate[2];

  const frontv: [number, number, number] = [
    frontlerp * frame.scale[0],
    frontlerp * frame.scale[1],
    frontlerp * frame.scale[2]
  ];
  const backv: [number, number, number] = [
    oldframe ? entityState.backlerp * oldframe.scale[0] : 0,
    oldframe ? entityState.backlerp * oldframe.scale[1] : 0,
    oldframe ? entityState.backlerp * oldframe.scale[2] : 0
  ];

  const array = positionAttribute.array as Float32Array;
  let writeIndex = 0;

  for (const sourceVertexIndex of meshInstance.vertexIndices) {
    const v = frame.verts[sourceVertexIndex];
    const ov = oldframe?.verts[sourceVertexIndex] ?? v;
    if (!v || !ov) {
      array[writeIndex] = 0;
      array[writeIndex + 1] = 0;
      array[writeIndex + 2] = 0;
      writeIndex += 3;
      continue;
    }

    let x = move[0] + ov.v[0] * backv[0] + v.v[0] * frontv[0];
    let y = move[1] + ov.v[1] * backv[1] + v.v[1] * frontv[1];
    let z = move[2] + ov.v[2] * backv[2] + v.v[2] * frontv[2];

    if (shell) {
      const normal = DirFromByte(frame.verts[sourceVertexIndex]?.lightnormalindex);
      x += normal[0] * POWERSUIT_SCALE;
      y += normal[1] * POWERSUIT_SCALE;
      z += normal[2] * POWERSUIT_SCALE;
    }

    array[writeIndex] = x;
    array[writeIndex + 1] = y;
    array[writeIndex + 2] = z;
    writeIndex += 3;
  }

  positionAttribute.needsUpdate = true;
  refreshMd2GeometryBounds(meshInstance.mesh.geometry);
  meshInstance.mesh.geometry.computeVertexNormals();
}

/**
 * Original name: N/A
 * Source: N/A (Three.js geometry adapter)
 * Category: New
 * Purpose: Keep Three.js render culling in sync with the current MD2 animation pose.
 *
 * Constraints:
 * - Must run after mutating the shared position buffer, before WebGL/WebGPU sees the mesh.
 */
function refreshMd2GeometryBounds(geometry: BufferGeometry): void {
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
}

/**
 * Original name: N/A
 * Source: N/A (Three.js geometry adapter)
 * Category: New
 * Purpose: Build the initial Three.js geometry from MD2 frame zero.
 *
 * Constraints:
 * - Must duplicate triangle vertices so UV seams are preserved.
 */
function createMd2Geometry(model: Md2Model): { geometry: BufferGeometry; vertexIndices: Uint32Array } {
  const glCommandVertices = buildMd2GlCommandVertices(model);
  const frame = model.frames[0];
  const positions = new Float32Array(glCommandVertices.length * 3);
  const uvs = new Float32Array(glCommandVertices.length * 2);
  const vertexIndices = new Uint32Array(glCommandVertices.length);

  let positionOffset = 0;
  let uvOffset = 0;

  for (let index = 0; index < glCommandVertices.length; index += 1) {
    const commandVertex = glCommandVertices[index];
    const positionIndex = commandVertex.vertexIndex * 3;
    positions[positionOffset] = frame.positions[positionIndex];
    positions[positionOffset + 1] = frame.positions[positionIndex + 1];
    positions[positionOffset + 2] = frame.positions[positionIndex + 2];
    positionOffset += 3;

    uvs[uvOffset] = commandVertex.s;
    uvs[uvOffset + 1] = 1 - commandVertex.t;
    uvOffset += 2;

    vertexIndices[index] = commandVertex.vertexIndex;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return { geometry, vertexIndices };
}

/**
 * Original name: N/A
 * Source: N/A (MD2 GL command adapter)
 * Category: New
 * Purpose: Rebuild the original MD2 OpenGL command stream into a flat triangle list that preserves Quake II strip and fan winding.
 *
 * Constraints:
 * - Must follow `dmdl_t.ofs_glcmds` semantics from `ref_gl/gl_mesh.c`.
 * - Must preserve the original per-command texture coordinates and vertex ordering.
 */
function buildMd2GlCommandVertices(model: Md2Model): Array<{ s: number; t: number; vertexIndex: number }> {
  const vertices: Array<{ s: number; t: number; vertexIndex: number }> = [];
  let commandOffset = 0;

  while (commandOffset < model.glcmds.length) {
    const count = model.glcmds[commandOffset];
    commandOffset += 1;

    if (count === 0) {
      break;
    }

    const primitiveVertexCount = Math.abs(count);
    const primitiveVertices: Array<{ s: number; t: number; vertexIndex: number }> = [];

    for (let index = 0; index < primitiveVertexCount; index += 1) {
      primitiveVertices.push({
        s: decodeMd2GlFloat(model.glcmds[commandOffset]),
        t: decodeMd2GlFloat(model.glcmds[commandOffset + 1]),
        vertexIndex: model.glcmds[commandOffset + 2]
      });
      commandOffset += 3;
    }

    if (count < 0) {
      appendMd2TriangleFan(vertices, primitiveVertices);
      continue;
    }

    appendMd2TriangleStrip(vertices, primitiveVertices);
  }

  return vertices;
}

/**
 * Original name: N/A
 * Source: N/A (MD2 GL command adapter)
 * Category: New
 * Purpose: Append one MD2 triangle-fan command to the flattened triangle list.
 *
 * Constraints:
 * - Must preserve the original fan center and winding as emitted by Quake II.
 */
function appendMd2TriangleFan(
  target: Array<{ s: number; t: number; vertexIndex: number }>,
  source: Array<{ s: number; t: number; vertexIndex: number }>
): void {
  for (let index = 2; index < source.length; index += 1) {
    target.push(source[0], source[index - 1], source[index]);
  }
}

/**
 * Original name: N/A
 * Source: N/A (MD2 GL command adapter)
 * Category: New
 * Purpose: Append one MD2 triangle-strip command to the flattened triangle list.
 *
 * Constraints:
 * - Must alternate winding exactly like OpenGL triangle strips.
 */
function appendMd2TriangleStrip(
  target: Array<{ s: number; t: number; vertexIndex: number }>,
  source: Array<{ s: number; t: number; vertexIndex: number }>
): void {
  for (let index = 2; index < source.length; index += 1) {
    if ((index & 1) === 0) {
      target.push(source[index - 2], source[index - 1], source[index]);
      continue;
    }

    target.push(source[index - 1], source[index - 2], source[index]);
  }
}

/**
 * Original name: N/A
 * Source: N/A (MD2 GL command adapter)
 * Category: New
 * Purpose: Decode one packed MD2 OpenGL command float stored in the raw dword stream.
 *
 * Constraints:
 * - Must preserve IEEE-754 bit layout exactly.
 */
function decodeMd2GlFloat(value: number): number {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setInt32(0, value, true);
  return view.getFloat32(0, true);
}

/**
 * Original name: N/A
 * Source: N/A (Three.js MD2 skin adapter)
 * Category: New
 * Purpose: Load an MD2 PCX skin as a Three.js texture.
 *
 * Constraints:
 * - Must return null when the skin asset is missing or invalid.
 */
export function loadMd2SkinTexture(
  filesystem: VirtualFilesystem,
  path: string,
  textureLighting: Partial<QuakeTextureLightingSettings> = {}
): Texture | null {
  const file = readMountedFile(filesystem, path);
  if (!file) {
    return null;
  }

  try {
    const image = parsePcx(file.bytes, file.path);
    const texture = new DataTexture(
      applyOriginalTextureIntensity(image.rgba.slice(), textureLighting),
      image.width,
      image.height,
      RGBAFormat,
      UnsignedByteType
    );
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.magFilter = LinearFilter;
    texture.minFilter = LinearMipmapNearestFilter;
    texture.generateMipmaps = true;
    texture.flipY = true;
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  } catch {
    return null;
  }
}

/**
 * Original name: N/A
 * Source: N/A (local alias shell helper)
 * Category: New
 * Purpose: Detect shell flags before applying the powersuit normal offset.
 */
function hasShellFlags(flags: number): boolean {
  return (flags & (RF_SHELL_RED | RF_SHELL_GREEN | RF_SHELL_BLUE | RF_SHELL_DOUBLE | RF_SHELL_HALF_DAM)) !== 0;
}
