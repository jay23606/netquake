/**
 * File: wal.ts
 * Source: Quake II original / qcommon/qfiles.h
 * Purpose: Parse Quake II WAL texture files and expose their mipmapped indexed pixel data.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Returns structured texture objects instead of exposing a raw C struct pointer.
 * - Keeps mip payloads as sliced Uint8Array views for browser-friendly upload paths.
 *
 * Notes:
 * - This file is intended to stay close to the original WAL declarations.
 */

import { getLittleLong } from "../../memory/src/binary-io.js";

/**
 * Original name: MIPLEVELS
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines the number of mipmap offsets stored in a Quake II WAL texture.
 */
export const MIPLEVELS = 4;

/**
 * Original name: N/A
 * Source: N/A (WAL parser constant)
 * Category: New
 * Purpose: Size of the fixed `name` and `animname` fields in `miptex_t`.
 */
const MIPTEX_NAME_SIZE = 32;

/**
 * Original name: N/A
 * Source: N/A (WAL parser constant)
 * Category: New
 * Purpose: Byte size of the serialized `miptex_t` header before mip payloads.
 */
const MIPTEX_HEADER_SIZE = 100;

/**
 * Original name: N/A
 * Source: N/A (WAL parser constant)
 * Category: New
 * Purpose: Mip dimension divisors derived from the four WAL mip levels.
 */
const MIP_DIVISORS = [1, 2, 4, 8] as const;

/**
 * Original name: miptex_s
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Represents the metadata header of a Quake II WAL texture.
 *
 * Porting notes:
 * - The C source declares `struct miptex_s` and aliases it as `miptex_t`; this port exposes the typedef name.
 * - Expands the offset array to a fixed tuple for easier TypeScript use.
 */
export interface miptex_t {
  name: string;
  width: number;
  height: number;
  offsets: [number, number, number, number];
  animname: string;
  flags: number;
  contents: number;
  value: number;
}

/**
 * Category: New
 * Original name: N/A
 * Source: N/A (parsed WAL container)
 * Purpose: Represent a parsed WAL texture with all available mip levels.
 *
 * Constraints:
 * - Must preserve the raw indexed payload for each mip level.
 */
export interface WalTexture {
  header: miptex_t;
  mipmaps: [Uint8Array, Uint8Array, Uint8Array, Uint8Array];
}

/**
 * Original name: N/A
 * Source: N/A (WAL parser adapter)
 * Category: Adapter
 * Fidelity level: Adapter
 *
 * Behavior:
 * - Validates and parses a Quake II WAL texture header and mip payloads.
 *
 * Porting notes:
 * - Adapts the `miptex_t` file format for renderer consumers without claiming ownership of `GL_LoadWal`.
 * - Keeps mip data indexed rather than applying a palette in this layer.
 */
export function parseWal(bytes: Uint8Array, path?: string): WalTexture {
  if (bytes.byteLength < MIPTEX_HEADER_SIZE) {
    throw new Error(`${path ?? "wal"} is too small to contain a WAL header`);
  }

  const header = readWalHeader(bytes);
  validateWalHeader(header, path);

  const mipmaps = MIP_DIVISORS.map((divisor, index) => {
    const width = Math.max(1, header.width / divisor);
    const height = Math.max(1, header.height / divisor);
    const offset = header.offsets[index];
    const size = width * height;

    if (!Number.isInteger(width) || !Number.isInteger(height)) {
      throw new Error(`${path ?? "wal"} has non-integer mip dimensions`);
    }

    if (offset < MIPTEX_HEADER_SIZE || offset + size > bytes.byteLength) {
      throw new Error(`${path ?? "wal"} has an out-of-bounds mip level ${index}`);
    }

    return bytes.slice(offset, offset + size);
  }) as [Uint8Array, Uint8Array, Uint8Array, Uint8Array];

  return {
    header,
    mipmaps
  };
}

/**
 * Category: New
 * Original name: N/A
 * Source: N/A (WAL parser helper)
 * Purpose: Read the fixed-size WAL header into a structured object.
 *
 * Constraints:
 * - Must preserve little-endian semantics for all 32-bit fields.
 */
function readWalHeader(bytes: Uint8Array): miptex_t {
  return {
    name: decodeCString(bytes.subarray(0, MIPTEX_NAME_SIZE)),
    width: getLittleLong(bytes, 32),
    height: getLittleLong(bytes, 36),
    offsets: [
      getLittleLong(bytes, 40),
      getLittleLong(bytes, 44),
      getLittleLong(bytes, 48),
      getLittleLong(bytes, 52)
    ],
    animname: decodeCString(bytes.subarray(56, 88)),
    flags: getLittleLong(bytes, 88),
    contents: getLittleLong(bytes, 92),
    value: getLittleLong(bytes, 96)
  };
}

/**
 * Category: New
 * Original name: N/A
 * Source: N/A (WAL parser validation helper)
 * Purpose: Enforce the subset of WAL header validity required by Quake II textures.
 *
 * Constraints:
 * - Must reject invalid dimensions and missing mip offsets.
 */
function validateWalHeader(header: miptex_t, path?: string): void {
  if (header.width <= 0 || header.height <= 0) {
    throw new Error(`${path ?? "wal"} has invalid texture dimensions`);
  }

  for (let index = 0; index < header.offsets.length; index += 1) {
    if (header.offsets[index] <= 0) {
      throw new Error(`${path ?? "wal"} has an invalid mip offset at level ${index}`);
    }
  }
}

/**
 * Category: New
 * Original name: N/A
 * Source: N/A (local string helper)
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
