/**
 * File: sp2.ts
 * Source: Quake II original / qcommon/qfiles.h
 * Purpose: Parse Quake II SP2 sprite files and expose their frame metadata.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Returns structured metadata objects instead of exposing a raw C struct pointer.
 *
 * Notes:
 * - This file is intended to stay close to the original SP2 declarations.
 */

import { getLittleLong } from "../../memory/src/binary-io.js";

/**
 * Original name: IDSPRITEHEADER
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Identifies Quake II SP2 sprite files as little-endian "IDS2".
 */
export const IDSPRITEHEADER = (("2".charCodeAt(0) << 24) + ("S".charCodeAt(0) << 16) + ("D".charCodeAt(0) << 8) + "I".charCodeAt(0)) | 0;

/**
 * Original name: SPRITE_VERSION
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Stores the supported Quake II SP2 sprite format version.
 */
export const SPRITE_VERSION = 2;

/**
 * Original name: MAX_SKINNAME
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Adapter
 * Fidelity level: Strict
 *
 * Purpose:
 * - Reuses the shared fixed-width skin/name field size for SP2 frame names.
 *
 * Porting notes:
 * - The canonical exported `MAX_SKINNAME` port is owned by `packages/formats/src/md2.ts`.
 */
const MAX_SKINNAME = 64;

/**
 * Original name: N/A
 * Source: N/A (binary layout helper)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose:
 * - Captures the byte size of one serialized `dsprframe_t` entry.
 */
const DSPRFRAME_SIZE = 80;

/**
 * Original name: N/A
 * Source: N/A (binary layout helper)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose:
 * - Captures the byte size of the fixed `dsprite_t` header before variable frames.
 */
const DSPRITE_HEADER_SIZE = 12;

/**
 * Original name: dsprframe_t
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Stores one SP2 sprite frame size, origin and PCX path.
 */
export interface dsprframe_t {
  width: number;
  height: number;
  origin_x: number;
  origin_y: number;
  name: string;
}

/**
 * Original name: dsprite_t
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Represents the SP2 sprite header and its ordered frame list.
 */
export interface dsprite_t {
  ident: number;
  version: number;
  numframes: number;
  frames: dsprframe_t[];
}

/**
 * Original name: N/A
 * Source: N/A (format parser)
 * Category: Adapter
 * Fidelity level: Adapter
 *
 * Purpose:
 * - Validates and parses a Quake II SP2 sprite file into structured frame metadata.
 *
 * Porting notes:
 * - Adapts the raw `dsprite_t` layout from `qfiles.h`; the owner of that source struct is the `dsprite_t` interface above.
 * - Keeps frame ordering and names exactly so later renderer adapters can resolve sprite images faithfully.
 */
export function parseSp2(bytes: Uint8Array, path?: string): dsprite_t {
  if (bytes.byteLength < DSPRITE_HEADER_SIZE) {
    throw new Error(`${path ?? "sp2"} is too small to contain an SP2 header`);
  }

  const ident = getLittleLong(bytes, 0);
  const version = getLittleLong(bytes, 4);
  const numframes = getLittleLong(bytes, 8);

  if (ident !== IDSPRITEHEADER) {
    throw new Error(`${path ?? "sp2"} is not a Quake II SP2 sprite`);
  }

  if (version !== SPRITE_VERSION) {
    throw new Error(`${path ?? "sp2"} has unsupported sprite version ${version}`);
  }

  if (numframes < 0) {
    throw new Error(`${path ?? "sp2"} has an invalid frame count`);
  }

  const framesOffset = DSPRITE_HEADER_SIZE;
  const framesByteLength = numframes * DSPRFRAME_SIZE;
  if (framesOffset + framesByteLength > bytes.byteLength) {
    throw new Error(`${path ?? "sp2"} has an out-of-bounds frame table`);
  }

  const frames: dsprframe_t[] = [];
  for (let index = 0; index < numframes; index += 1) {
    const offset = framesOffset + index * DSPRFRAME_SIZE;
    frames.push({
      width: getLittleLong(bytes, offset),
      height: getLittleLong(bytes, offset + 4),
      origin_x: getLittleLong(bytes, offset + 8),
      origin_y: getLittleLong(bytes, offset + 12),
      name: decodeCString(bytes.subarray(offset + 16, offset + 16 + MAX_SKINNAME))
    });
  }

  return {
    ident,
    version,
    numframes,
    frames
  };
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
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
