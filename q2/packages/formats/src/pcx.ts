/**
 * File: pcx.ts
 * Source: Quake II original / qcommon/qfiles.h
 * Purpose: Parse Quake II PCX images and decode their indexed pixel payload.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Returns structured image data instead of exposing a raw C struct pointer.
 * - Decodes the RLE payload eagerly for browser-ready consumption.
 *
 * Notes:
 * - This file is intended to stay close to the original PCX file declarations.
 */

import { getLittleShort, getUnsignedByte } from "../../memory/src/binary-io.js";

/**
 * Original name: N/A
 * Source: N/A (local PCX parser constant)
 * Category: New
 * Purpose: Size of the fixed `pcx_t` header before the unbounded pixel data.
 */
const PCX_HEADER_SIZE = 128;

/**
 * Original name: N/A
 * Source: N/A (local PCX parser constant)
 * Category: New
 * Purpose: Marker byte preceding the trailing 256-color PCX palette.
 */
const PCX_PALETTE_MARKER = 0x0c;

/**
 * Original name: N/A
 * Source: N/A (local PCX parser constant)
 * Category: New
 * Purpose: Number of RGB bytes in a 256-color PCX palette.
 */
const PCX_PALETTE_SIZE = 768;

/**
 * Original name: pcx_t
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Represents the header fields stored by Quake II PCX assets.
 *
 * Porting notes:
 * - Splits compound C arrays into explicit scalar fields and typed arrays.
 */
export interface pcx_t {
  manufacturer: number;
  version: number;
  encoding: number;
  bits_per_pixel: number;
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  hres: number;
  vres: number;
  palette: Uint8Array;
  reserved: number;
  color_planes: number;
  bytes_per_line: number;
  palette_type: number;
  filler: Uint8Array;
  data: Uint8Array;
}

/**
 * Original name: N/A
 * Source: N/A (decoded PCX DTO)
 * Category: New
 * Purpose: Represent a decoded Quake II PCX image with both indexed and RGBA pixels.
 *
 * Constraints:
 * - Must preserve the original palette indices.
 * - Must expose browser-ready RGBA bytes for easy upload to textures.
 */
export interface PcxImage {
  header: pcx_t;
  width: number;
  height: number;
  indices: Uint8Array;
  paletteRgb: Uint8Array;
  rgba: Uint8Array;
}

/**
 * Original name: N/A
 * Source: N/A (shared PCX decoder adapter)
 * Category: Adapter
 * Fidelity level: Close
 *
 * Behavior:
 * - Validates a Quake-style 8-bit PCX file and decodes its RLE-compressed image payload.
 *
 * Porting notes:
 * - Shared parser used by `SCR_LoadPCX` and renderer `LoadPCX` owners; it is not their proprietary port.
 * - Restricts support to the Quake II 8-bit single-plane flavor.
 * - Requires the trailing 256-color palette marker to be present.
 */
export function parsePcx(bytes: Uint8Array, path?: string): PcxImage {
  if (bytes.byteLength < PCX_HEADER_SIZE + 1 + PCX_PALETTE_SIZE) {
    throw new Error(`${path ?? "pcx"} is too small to contain a valid PCX image`);
  }

  const header = readPcxHeader(bytes);
  validatePcxHeader(header, path);

  const width = header.xmax - header.xmin + 1;
  const height = header.ymax - header.ymin + 1;
  const expectedRowBytes = header.bytes_per_line * header.color_planes;
  const decoded = decodePcxRle(bytes.subarray(PCX_HEADER_SIZE, bytes.byteLength - (1 + PCX_PALETTE_SIZE)), expectedRowBytes, height, path);
  const indices = extractIndexedPixels(decoded, width, height, header.bytes_per_line);
  const paletteRgb = readPcxPalette(bytes, path);
  const rgba = expandPaletteIndices(indices, paletteRgb, width);

  return {
    header,
    width,
    height,
    indices,
    paletteRgb,
    rgba
  };
}

/**
 * Original name: N/A
 * Source: N/A (local PCX parser helper)
 * Category: New
 * Purpose: Read the fixed-size PCX header fields into a structured object.
 *
 * Constraints:
 * - Must preserve little-endian semantics for 16-bit fields.
 */
function readPcxHeader(bytes: Uint8Array): pcx_t {
  return {
    manufacturer: getUnsignedByte(bytes, 0),
    version: getUnsignedByte(bytes, 1),
    encoding: getUnsignedByte(bytes, 2),
    bits_per_pixel: getUnsignedByte(bytes, 3),
    xmin: getLittleShort(bytes, 4),
    ymin: getLittleShort(bytes, 6),
    xmax: getLittleShort(bytes, 8),
    ymax: getLittleShort(bytes, 10),
    hres: getLittleShort(bytes, 12),
    vres: getLittleShort(bytes, 14),
    palette: bytes.slice(16, 64),
    reserved: getUnsignedByte(bytes, 64),
    color_planes: getUnsignedByte(bytes, 65),
    bytes_per_line: getLittleShort(bytes, 66),
    palette_type: getLittleShort(bytes, 68),
    filler: bytes.slice(70, PCX_HEADER_SIZE),
    data: bytes.slice(PCX_HEADER_SIZE)
  };
}

/**
 * Original name: N/A
 * Source: N/A (local PCX parser helper)
 * Category: New
 * Purpose: Enforce the subset of the PCX format used by Quake II assets.
 *
 * Constraints:
 * - Must reject unsupported encodings and pixel layouts clearly.
 */
function validatePcxHeader(header: pcx_t, path?: string): void {
  if (header.manufacturer !== 0x0a) {
    throw new Error(`${path ?? "pcx"} has an invalid manufacturer`);
  }

  if (header.encoding !== 1) {
    throw new Error(`${path ?? "pcx"} uses an unsupported PCX encoding`);
  }

  if (header.bits_per_pixel !== 8 || header.color_planes !== 1) {
    throw new Error(`${path ?? "pcx"} is not an 8-bit indexed single-plane PCX`);
  }

  if (header.xmax < header.xmin || header.ymax < header.ymin) {
    throw new Error(`${path ?? "pcx"} has invalid image bounds`);
  }
}

/**
 * Original name: N/A
 * Source: N/A (local PCX parser helper)
 * Category: New
 * Purpose: Decode the PCX RLE payload into padded scanline bytes.
 *
 * Constraints:
 * - Must decode exactly `bytesPerRow * height` bytes.
 * - Must reject truncated or overlong payloads.
 */
function decodePcxRle(data: Uint8Array, bytesPerRow: number, height: number, path?: string): Uint8Array {
  const expectedSize = bytesPerRow * height;
  const decoded = new Uint8Array(expectedSize);
  let sourceIndex = 0;
  let targetIndex = 0;

  while (targetIndex < expectedSize) {
    if (sourceIndex >= data.length) {
      throw new Error(`${path ?? "pcx"} ended before the RLE payload was fully decoded`);
    }

    const token = data[sourceIndex];
    sourceIndex += 1;

    if ((token & 0xc0) === 0xc0) {
      const count = token & 0x3f;
      if (sourceIndex >= data.length) {
        throw new Error(`${path ?? "pcx"} ended in the middle of an RLE run`);
      }

      const value = data[sourceIndex];
      sourceIndex += 1;

      if (targetIndex + count > expectedSize) {
        throw new Error(`${path ?? "pcx"} expands beyond the expected image size`);
      }

      decoded.fill(value, targetIndex, targetIndex + count);
      targetIndex += count;
      continue;
    }

    decoded[targetIndex] = token;
    targetIndex += 1;
  }

  return decoded;
}

/**
 * Original name: N/A
 * Source: N/A (local PCX parser helper)
 * Category: New
 * Purpose: Remove per-scanline padding and keep only the visible pixel indices.
 *
 * Constraints:
 * - Must preserve row order exactly.
 */
function extractIndexedPixels(decoded: Uint8Array, width: number, height: number, bytesPerLine: number): Uint8Array {
  const indices = new Uint8Array(width * height);

  for (let row = 0; row < height; row += 1) {
    const sourceOffset = row * bytesPerLine;
    const targetOffset = row * width;
    indices.set(decoded.subarray(sourceOffset, sourceOffset + width), targetOffset);
  }

  return indices;
}

/**
 * Original name: N/A
 * Source: N/A (local PCX parser helper)
 * Category: New
 * Purpose: Read the 256-color palette stored at the end of Quake II PCX files.
 *
 * Constraints:
 * - Must require the standard 0x0C palette marker.
 */
function readPcxPalette(bytes: Uint8Array, path?: string): Uint8Array {
  const paletteOffset = bytes.byteLength - (1 + PCX_PALETTE_SIZE);
  if (bytes[paletteOffset] !== PCX_PALETTE_MARKER) {
    throw new Error(`${path ?? "pcx"} is missing the 256-color palette marker`);
  }

  return bytes.slice(paletteOffset + 1, paletteOffset + 1 + PCX_PALETTE_SIZE);
}

/**
 * Original name: N/A
 * Source: N/A (local PCX parser helper)
 * Category: New
 * Purpose: Expand palette indices into RGBA pixels for direct renderer upload.
 *
 * Constraints:
 * - Must preserve palette colors exactly.
 * - Must preserve Quake II transparency semantics where palette index 255 is transparent.
 */
function expandPaletteIndices(indices: Uint8Array, paletteRgb: Uint8Array, width: number): Uint8Array {
  const rgba = new Uint8Array(indices.length * 4);

  for (let index = 0; index < indices.length; index += 1) {
    const pixel = indices[index];
    const paletteIndex = pixel * 3;
    const rgbaIndex = index * 4;
    const rgbIndex = pixel === 255 ? resolveTransparentNeighborIndex(indices, width, index) * 3 : paletteIndex;
    rgba[rgbaIndex] = paletteRgb[rgbIndex];
    rgba[rgbaIndex + 1] = paletteRgb[rgbIndex + 1];
    rgba[rgbaIndex + 2] = paletteRgb[rgbIndex + 2];
    rgba[rgbaIndex + 3] = pixel === 255 ? 0 : 255;
  }

  return rgba;
}

/**
 * Original name: N/A
 * Source: N/A (local PCX parser helper)
 * Category: New
 * Purpose: Reproduce Quake II's transparent-pixel neighbor color selection to avoid alpha fringes.
 *
 * Constraints:
 * - Must treat palette index 255 as transparent.
 * - Must search adjacent pixels using the same priority as the original GL upload path.
 */
function resolveTransparentNeighborIndex(indices: Uint8Array, width: number, index: number): number {
  const previousRow = index - width;
  if (previousRow >= 0 && indices[previousRow] !== 255) {
    return indices[previousRow];
  }

  const nextRow = index + width;
  if (nextRow < indices.length && indices[nextRow] !== 255) {
    return indices[nextRow];
  }

  const previousColumn = index - 1;
  if (previousColumn >= 0 && indices[previousColumn] !== 255) {
    return indices[previousColumn];
  }

  const nextColumn = index + 1;
  if (nextColumn < indices.length && indices[nextColumn] !== 255) {
    return indices[nextColumn];
  }

  return 0;
}
