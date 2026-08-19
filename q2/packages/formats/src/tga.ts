/**
 * File: tga.ts
 * Source: Quake II original / ref_gl/gl_image.c
 * Purpose: Port the subset of the Quake II TGA loader used for skybox and image resources.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Returns structured image data instead of writing through out-parameters.
 * - Throws JavaScript errors instead of routing through renderer fatal paths.
 *
 * Notes:
 * - This file intentionally supports only the TGA variants accepted by the original Quake II loader.
 */

/**
 * Original name: _TargaHeader
 * Source: Quake-2-master/ref_gl/gl_image.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Stores the header fields of one TGA image.
 */
export interface TargaHeader {
  id_length: number;
  colormap_type: number;
  image_type: number;
  colormap_index: number;
  colormap_length: number;
  colormap_size: number;
  x_origin: number;
  y_origin: number;
  width: number;
  height: number;
  pixel_size: number;
  attributes: number;
}

/**
 * Original name: N/A
 * Source: N/A (decoded TGA image contract)
 * Category: New
 * Purpose: Describe one decoded TGA image in RGBA byte form.
 *
 * Constraints:
 * - Must preserve bottom-to-top row conversion like the original Quake II loader.
 */
export interface TgaImage {
  header: TargaHeader;
  width: number;
  height: number;
  rgba: Uint8Array;
}

/**
 * Original name: N/A
 * Source: N/A (shared TGA parser)
 * Category: Adapter
 * Fidelity level: Close
 *
 * Behavior:
 * - Decodes an uncompressed or RLE true-color TGA image into RGBA bytes.
 *
 * Porting notes:
 * - The owning `LoadTGA` port remains in `packages/renderer-three/src/gl_image.ts`.
 * - Supports only image types 2 and 10 with 24-bit or 32-bit pixels, matching the original loader.
 */
export function parseTga(bytes: Uint8Array, path?: string): TgaImage {
  if (bytes.length < 18) {
    throw new Error(`${path ?? "tga"} is too small to contain a valid TGA image`);
  }

  const header = readTgaHeader(bytes);
  validateTgaHeader(header, path);

  const columns = header.width;
  const rows = header.height;
  const numPixels = columns * rows;
  const rgba = new Uint8Array(numPixels * 4);
  let offset = 18 + header.id_length;

  if (offset > bytes.length) {
    throw new Error(`${path ?? "tga"} ends inside the image ID field`);
  }

  if (header.image_type === 2) {
    decodeUncompressedTga(bytes, offset, header, rgba, path);
  } else {
    decodeRleTga(bytes, offset, header, rgba, path);
  }

  return {
    header,
    width: columns,
    height: rows,
    rgba
  };
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Read the fixed 18-byte TGA header.
 */
function readTgaHeader(bytes: Uint8Array): TargaHeader {
  return {
    id_length: bytes[0],
    colormap_type: bytes[1],
    image_type: bytes[2],
    colormap_index: getLittleShort(bytes, 3),
    colormap_length: getLittleShort(bytes, 5),
    colormap_size: bytes[7],
    x_origin: getLittleShort(bytes, 8),
    y_origin: getLittleShort(bytes, 10),
    width: getLittleShort(bytes, 12),
    height: getLittleShort(bytes, 14),
    pixel_size: bytes[16],
    attributes: bytes[17]
  };
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Validate the exact TGA feature subset accepted by Quake II.
 */
function validateTgaHeader(header: TargaHeader, path?: string): void {
  if (header.image_type !== 2 && header.image_type !== 10) {
    throw new Error(`${path ?? "tga"} supports only TGA image types 2 and 10`);
  }

  if (header.colormap_type !== 0 || (header.pixel_size !== 24 && header.pixel_size !== 32)) {
    throw new Error(`${path ?? "tga"} supports only 24-bit or 32-bit true-color images without colormaps`);
  }

  if (header.width <= 0 || header.height <= 0) {
    throw new Error(`${path ?? "tga"} has invalid image bounds`);
  }
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Decode one uncompressed true-color TGA image.
 */
function decodeUncompressedTga(
  bytes: Uint8Array,
  startOffset: number,
  header: TargaHeader,
  rgba: Uint8Array,
  path?: string
): void {
  const bytesPerPixel = header.pixel_size >> 3;
  let offset = startOffset;

  for (let row = header.height - 1; row >= 0; row -= 1) {
    let pixelOffset = row * header.width * 4;
    for (let column = 0; column < header.width; column += 1) {
      if (offset + bytesPerPixel > bytes.length) {
        throw new Error(`${path ?? "tga"} ended before all pixels were decoded`);
      }

      const blue = bytes[offset];
      const green = bytes[offset + 1];
      const red = bytes[offset + 2];
      const alpha = bytesPerPixel === 4 ? bytes[offset + 3] : 255;
      offset += bytesPerPixel;

      rgba[pixelOffset] = red;
      rgba[pixelOffset + 1] = green;
      rgba[pixelOffset + 2] = blue;
      rgba[pixelOffset + 3] = alpha;
      pixelOffset += 4;
    }
  }
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Decode one RLE true-color TGA image.
 */
function decodeRleTga(
  bytes: Uint8Array,
  startOffset: number,
  header: TargaHeader,
  rgba: Uint8Array,
  path?: string
): void {
  const bytesPerPixel = header.pixel_size >> 3;
  let offset = startOffset;
  let row = header.height - 1;
  let column = 0;

  while (row >= 0) {
    if (offset >= bytes.length) {
      throw new Error(`${path ?? "tga"} ended in the middle of an RLE packet`);
    }

    const packetHeader = bytes[offset++];
    const packetSize = 1 + (packetHeader & 0x7f);

    if ((packetHeader & 0x80) !== 0) {
      const pixel = readTgaPixel(bytes, offset, bytesPerPixel, path);
      offset += bytesPerPixel;

      for (let repeat = 0; repeat < packetSize; repeat += 1) {
        writeRgbaPixel(rgba, header.width, row, column, pixel);
        column += 1;
        if (column === header.width) {
          column = 0;
          row -= 1;
          if (row < 0) {
            break;
          }
        }
      }

      continue;
    }

    for (let repeat = 0; repeat < packetSize; repeat += 1) {
      const pixel = readTgaPixel(bytes, offset, bytesPerPixel, path);
      offset += bytesPerPixel;
      writeRgbaPixel(rgba, header.width, row, column, pixel);

      column += 1;
      if (column === header.width) {
        column = 0;
        row -= 1;
        if (row < 0) {
          break;
        }
      }
    }
  }
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Read one true-color TGA pixel in source BGR(A) order and return RGBA bytes.
 */
function readTgaPixel(bytes: Uint8Array, offset: number, bytesPerPixel: number, path?: string): [number, number, number, number] {
  if (offset + bytesPerPixel > bytes.length) {
    throw new Error(`${path ?? "tga"} ended before one pixel packet could be read`);
  }

  const blue = bytes[offset];
  const green = bytes[offset + 1];
  const red = bytes[offset + 2];
  const alpha = bytesPerPixel === 4 ? bytes[offset + 3] : 255;
  return [red, green, blue, alpha];
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Write one RGBA pixel into the destination image buffer.
 */
function writeRgbaPixel(
  rgba: Uint8Array,
  width: number,
  row: number,
  column: number,
  pixel: [number, number, number, number]
): void {
  const pixelOffset = (row * width + column) * 4;
  rgba[pixelOffset] = pixel[0];
  rgba[pixelOffset + 1] = pixel[1];
  rgba[pixelOffset + 2] = pixel[2];
  rgba[pixelOffset + 3] = pixel[3];
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Read one little-endian 16-bit value from the TGA byte stream.
 */
function getLittleShort(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}
