/**
 * File: md2.ts
 * Source: Quake II original / qcommon/qfiles.h
 * Purpose: Parse Quake II MD2 alias model files and expose their animation frames.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Returns structured arrays instead of exposing raw packed C structs.
 * - Decodes frame vertices eagerly to simplify future renderer adapters.
 *
 * Notes:
 * - This file is intended to stay close to the original MD2 file declarations.
 */

import { getLittleFloat, getLittleLong, getLittleShort, getUnsignedByte } from "../../memory/src/binary-io.js";

/**
 * Original name: IDALIASHEADER
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 */
export const IDALIASHEADER = (("2".charCodeAt(0) << 24) + ("P".charCodeAt(0) << 16) + ("D".charCodeAt(0) << 8) + "I".charCodeAt(0)) | 0;
/**
 * Original name: ALIAS_VERSION
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 */
export const ALIAS_VERSION = 8;
/**
 * Original name: MAX_TRIANGLES
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 */
export const MAX_TRIANGLES = 4096;
/**
 * Original name: MAX_VERTS
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 */
export const MAX_VERTS = 2048;
/**
 * Original name: MAX_FRAMES
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 */
export const MAX_FRAMES = 512;
/**
 * Original name: MAX_MD2SKINS
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 */
export const MAX_MD2SKINS = 32;
/**
 * Original name: MAX_SKINNAME
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 */
export const MAX_SKINNAME = 64;
/**
 * Original name: DTRIVERTX_V0
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 */
export const DTRIVERTX_V0 = 0;
/**
 * Original name: DTRIVERTX_V1
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 */
export const DTRIVERTX_V1 = 1;
/**
 * Original name: DTRIVERTX_V2
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 */
export const DTRIVERTX_V2 = 2;
/**
 * Original name: DTRIVERTX_LNI
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 */
export const DTRIVERTX_LNI = 3;
/**
 * Original name: DTRIVERTX_SIZE
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 */
export const DTRIVERTX_SIZE = 4;
/**
 * Original name: N/A
 * Source: N/A (local binary layout helper)
 * Category: New
 * Purpose: Fixed byte size of `dstvert_t` when reading MD2 binary data.
 */
const DSTVERT_SIZE = 4;
/**
 * Original name: N/A
 * Source: N/A (local binary layout helper)
 * Category: New
 * Purpose: Fixed byte size of `dtriangle_t` when reading MD2 binary data.
 */
const DTRIANGLE_SIZE = 12;
/**
 * Original name: N/A
 * Source: N/A (local binary layout helper)
 * Category: New
 * Purpose: Fixed byte size of one MD2 OpenGL command dword.
 */
const DGLCMD_SIZE = 4;
/**
 * Original name: N/A
 * Source: N/A (local binary layout helper)
 * Category: New
 * Purpose: Fixed byte size of `dmdl_t` when reading an MD2 header.
 */
const DMDL_SIZE = 68;
/**
 * Original name: N/A
 * Source: N/A (local binary layout helper)
 * Category: New
 * Purpose: Fixed byte width of a `daliasframe_t` frame name.
 */
const FRAME_NAME_SIZE = 16;

/**
 * Original name: dstvert_t
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Stores one texture coordinate pair from an MD2 model.
 *
 * Porting notes:
 * - Preserves the original signed short storage.
 */
export interface dstvert_t {
  s: number;
  t: number;
}

/**
 * Original name: dtriangle_t
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Stores one MD2 triangle using vertex and texture coordinate indices.
 */
export interface dtriangle_t {
  index_xyz: [number, number, number];
  index_st: [number, number, number];
}

/**
 * Original name: dtrivertx_t
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Stores one compressed frame vertex and its light normal index.
 */
export interface dtrivertx_t {
  v: [number, number, number];
  lightnormalindex: number;
}

/**
 * Original name: daliasframe_t
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Stores one MD2 frame with transform metadata and compressed vertices.
 *
 * Porting notes:
 * - Keeps both compressed and decoded positions for future interpolation/rendering.
 */
export interface daliasframe_t {
  scale: [number, number, number];
  translate: [number, number, number];
  name: string;
  verts: dtrivertx_t[];
  positions: Float32Array;
}

/**
 * Original name: dmdl_t
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Represents the MD2 model header fields and layout offsets.
 */
export interface dmdl_t {
  ident: number;
  version: number;
  skinwidth: number;
  skinheight: number;
  framesize: number;
  num_skins: number;
  num_xyz: number;
  num_st: number;
  num_tris: number;
  num_glcmds: number;
  num_frames: number;
  ofs_skins: number;
  ofs_st: number;
  ofs_tris: number;
  ofs_frames: number;
  ofs_glcmds: number;
  ofs_end: number;
}

/**
 * Original name: N/A
 * Source: N/A (parsed MD2 aggregate)
 * Category: New
 * Purpose: Represent a parsed MD2 model with header, skins, geometry tables and decoded frames.
 *
 * Constraints:
 * - Must preserve the original table ordering for future renderer bridge code.
 */
export interface Md2Model {
  header: dmdl_t;
  skins: string[];
  st: dstvert_t[];
  triangles: dtriangle_t[];
  frames: daliasframe_t[];
  glcmds: Int32Array;
}

/**
 * Original name: N/A
 * Source: N/A (MD2 parser adapter using qfiles.h layout)
 * Category: Adapter
 * Fidelity level: Close
 *
 * Behavior:
 * - Validates and parses a Quake II MD2 model into structured animation data.
 *
 * Porting notes:
 * - Decodes frame positions eagerly while preserving the original compressed vertex bytes.
 */
export function parseMd2(bytes: Uint8Array, path?: string): Md2Model {
  if (bytes.byteLength < DMDL_SIZE) {
    throw new Error(`${path ?? "md2"} is too small to contain an MD2 header`);
  }

  const header = readMd2Header(bytes);
  validateMd2Header(header, bytes, path);

  return {
    header,
    skins: readMd2Skins(bytes, header),
    st: readMd2TexCoords(bytes, header),
    triangles: readMd2Triangles(bytes, header),
    frames: readMd2Frames(bytes, header),
    glcmds: readMd2GlCommands(bytes, header)
  };
}

/**
 * Original name: N/A
 * Source: N/A (local MD2 parser helper)
 * Category: New
 * Purpose: Read the fixed-size MD2 header.
 *
 * Constraints:
 * - Must preserve little-endian semantics for all fields.
 */
function readMd2Header(bytes: Uint8Array): dmdl_t {
  return {
    ident: getLittleLong(bytes, 0),
    version: getLittleLong(bytes, 4),
    skinwidth: getLittleLong(bytes, 8),
    skinheight: getLittleLong(bytes, 12),
    framesize: getLittleLong(bytes, 16),
    num_skins: getLittleLong(bytes, 20),
    num_xyz: getLittleLong(bytes, 24),
    num_st: getLittleLong(bytes, 28),
    num_tris: getLittleLong(bytes, 32),
    num_glcmds: getLittleLong(bytes, 36),
    num_frames: getLittleLong(bytes, 40),
    ofs_skins: getLittleLong(bytes, 44),
    ofs_st: getLittleLong(bytes, 48),
    ofs_tris: getLittleLong(bytes, 52),
    ofs_frames: getLittleLong(bytes, 56),
    ofs_glcmds: getLittleLong(bytes, 60),
    ofs_end: getLittleLong(bytes, 64)
  };
}

/**
 * Original name: N/A
 * Source: N/A (local MD2 parser helper)
 * Category: New
 * Purpose: Validate the MD2 layout constraints used by Quake II assets.
 *
 * Constraints:
 * - Must reject invalid ids, versions, counts and out-of-bounds offsets.
 */
function validateMd2Header(header: dmdl_t, bytes: Uint8Array, path?: string): void {
  if (header.ident !== IDALIASHEADER) {
    throw new Error(`${path ?? "md2"} is not an MD2 model`);
  }

  if (header.version !== ALIAS_VERSION) {
    throw new Error(`${path ?? "md2"} has unsupported MD2 version ${header.version}`);
  }

  if (header.skinwidth <= 0 || header.skinheight <= 0 || header.framesize <= 0) {
    throw new Error(`${path ?? "md2"} has invalid dimensions or frame size`);
  }

  if (header.num_xyz <= 0 || header.num_st < 0 || header.num_tris < 0 || header.num_frames <= 0 || header.num_glcmds < 0 || header.num_skins < 0) {
    throw new Error(`${path ?? "md2"} has invalid table counts`);
  }

  const minimumFrameSize = 24 + FRAME_NAME_SIZE + header.num_xyz * DTRIVERTX_SIZE;
  if (header.framesize < minimumFrameSize) {
    throw new Error(`${path ?? "md2"} has a frame size smaller than the declared vertex payload`);
  }

  assertRange(header.ofs_skins, header.num_skins * MAX_SKINNAME, bytes, path, "skins");
  assertRange(header.ofs_st, header.num_st * DSTVERT_SIZE, bytes, path, "st");
  assertRange(header.ofs_tris, header.num_tris * DTRIANGLE_SIZE, bytes, path, "triangles");
  assertRange(header.ofs_frames, header.num_frames * header.framesize, bytes, path, "frames");
  assertRange(header.ofs_glcmds, header.num_glcmds * DGLCMD_SIZE, bytes, path, "glcmds");

  if (header.ofs_end <= 0 || header.ofs_end > bytes.byteLength) {
    throw new Error(`${path ?? "md2"} has an invalid end offset`);
  }
}

/**
 * Original name: N/A
 * Source: N/A (local MD2 parser helper)
 * Category: New
 * Purpose: Read the MD2 skin name table.
 *
 * Constraints:
 * - Must preserve the original skin ordering.
 */
function readMd2Skins(bytes: Uint8Array, header: dmdl_t): string[] {
  const skins: string[] = [];

  for (let index = 0; index < header.num_skins; index += 1) {
    const offset = header.ofs_skins + index * MAX_SKINNAME;
    skins.push(decodeCString(bytes.subarray(offset, offset + MAX_SKINNAME)));
  }

  return skins;
}

/**
 * Original name: N/A
 * Source: N/A (local MD2 parser helper)
 * Category: New
 * Purpose: Read the MD2 texture coordinate table.
 *
 * Constraints:
 * - Must preserve the original signed short values.
 */
function readMd2TexCoords(bytes: Uint8Array, header: dmdl_t): dstvert_t[] {
  const st: dstvert_t[] = [];

  for (let index = 0; index < header.num_st; index += 1) {
    const offset = header.ofs_st + index * DSTVERT_SIZE;
    st.push({
      s: getLittleShort(bytes, offset),
      t: getLittleShort(bytes, offset + 2)
    });
  }

  return st;
}

/**
 * Original name: N/A
 * Source: N/A (local MD2 parser helper)
 * Category: New
 * Purpose: Read the MD2 triangle table.
 *
 * Constraints:
 * - Must preserve original triangle ordering and indices.
 */
function readMd2Triangles(bytes: Uint8Array, header: dmdl_t): dtriangle_t[] {
  const triangles: dtriangle_t[] = [];

  for (let index = 0; index < header.num_tris; index += 1) {
    const offset = header.ofs_tris + index * DTRIANGLE_SIZE;
    triangles.push({
      index_xyz: [
        getLittleShort(bytes, offset),
        getLittleShort(bytes, offset + 2),
        getLittleShort(bytes, offset + 4)
      ],
      index_st: [
        getLittleShort(bytes, offset + 6),
        getLittleShort(bytes, offset + 8),
        getLittleShort(bytes, offset + 10)
      ]
    });
  }

  return triangles;
}

/**
 * Original name: N/A
 * Source: N/A (local MD2 parser helper)
 * Category: New
 * Purpose: Read and decode all MD2 frames.
 *
 * Constraints:
 * - Must preserve frame ordering exactly.
 */
function readMd2Frames(bytes: Uint8Array, header: dmdl_t): daliasframe_t[] {
  const frames: daliasframe_t[] = [];

  for (let frameIndex = 0; frameIndex < header.num_frames; frameIndex += 1) {
    const frameOffset = header.ofs_frames + frameIndex * header.framesize;
    const scale: [number, number, number] = [
      getLittleFloat(bytes, frameOffset),
      getLittleFloat(bytes, frameOffset + 4),
      getLittleFloat(bytes, frameOffset + 8)
    ];
    const translate: [number, number, number] = [
      getLittleFloat(bytes, frameOffset + 12),
      getLittleFloat(bytes, frameOffset + 16),
      getLittleFloat(bytes, frameOffset + 20)
    ];
    const name = decodeCString(bytes.subarray(frameOffset + 24, frameOffset + 24 + FRAME_NAME_SIZE));
    const verts: dtrivertx_t[] = [];
    const positions = new Float32Array(header.num_xyz * 3);
    let vertexOffset = frameOffset + 24 + FRAME_NAME_SIZE;

    for (let vertexIndex = 0; vertexIndex < header.num_xyz; vertexIndex += 1) {
      const compressed: dtrivertx_t = {
        v: [
          getUnsignedByte(bytes, vertexOffset),
          getUnsignedByte(bytes, vertexOffset + 1),
          getUnsignedByte(bytes, vertexOffset + 2)
        ],
        lightnormalindex: getUnsignedByte(bytes, vertexOffset + 3)
      };

      verts.push(compressed);

      const positionIndex = vertexIndex * 3;
      positions[positionIndex] = compressed.v[0] * scale[0] + translate[0];
      positions[positionIndex + 1] = compressed.v[1] * scale[1] + translate[1];
      positions[positionIndex + 2] = compressed.v[2] * scale[2] + translate[2];

      vertexOffset += DTRIVERTX_SIZE;
    }

    frames.push({
      scale,
      translate,
      name,
      verts,
      positions
    });
  }

  return frames;
}

/**
 * Original name: N/A
 * Source: N/A (local MD2 parser helper)
 * Category: New
 * Purpose: Read the raw MD2 OpenGL command stream.
 *
 * Constraints:
 * - Must preserve dword ordering exactly for future strip/fan reconstruction.
 */
function readMd2GlCommands(bytes: Uint8Array, header: dmdl_t): Int32Array {
  const glcmds = new Int32Array(header.num_glcmds);

  for (let index = 0; index < header.num_glcmds; index += 1) {
    glcmds[index] = getLittleLong(bytes, header.ofs_glcmds + index * DGLCMD_SIZE);
  }

  return glcmds;
}

/**
 * Original name: N/A
 * Source: N/A (local validation helper)
 * Category: New
 * Purpose: Assert that one MD2 table range stays inside file bounds.
 *
 * Constraints:
 * - Must reject negative offsets and overflows.
 */
function assertRange(offset: number, length: number, bytes: Uint8Array, path: string | undefined, label: string): void {
  if (offset < 0 || length < 0 || offset + length > bytes.byteLength) {
    throw new Error(`${path ?? "md2"} has an out-of-bounds ${label} table`);
  }
}

/**
 * Original name: N/A
 * Source: N/A (local string helper)
 * Category: New
 * Purpose: Decode a fixed-width null-terminated Quake C string field.
 *
 * Constraints:
 * - Must stop at the first zero byte.
 */
function decodeCString(bytes: Uint8Array): string {
  let end = bytes.indexOf(0);
  if (end === -1) {
    end = bytes.length;
  }

  let result = "";
  for (let index = 0; index < end; index += 1) {
    result += String.fromCharCode(bytes[index]);
  }

  return result;
}
