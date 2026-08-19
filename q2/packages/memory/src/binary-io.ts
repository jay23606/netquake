/**
 * File: binary-io.ts
 * Purpose: Provide little-endian binary helpers for Quake II message and file ports.
 *
 * This file is not a direct source port.
 * It supports future ports of the original message and filesystem code.
 *
 * Dependencies:
 * - None
 */

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Read a signed byte from a byte buffer without depending on Node-specific APIs.
 *
 * Constraints:
 * - Must preserve 8-bit signed semantics.
 */
export function getSignedByte(buffer: Uint8Array, offset: number): number {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getInt8(offset);
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Read an unsigned byte from a byte buffer.
 *
 * Constraints:
 * - Must preserve 8-bit unsigned semantics.
 */
export function getUnsignedByte(buffer: Uint8Array, offset: number): number {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getUint8(offset);
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Read a little-endian signed short from a byte buffer.
 *
 * Constraints:
 * - Must preserve Quake II little-endian storage semantics.
 */
export function getLittleShort(buffer: Uint8Array, offset: number): number {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getInt16(offset, true);
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Read a little-endian signed long from a byte buffer.
 *
 * Constraints:
 * - Must preserve Quake II little-endian storage semantics.
 */
export function getLittleLong(buffer: Uint8Array, offset: number): number {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getInt32(offset, true);
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Read a little-endian float from a byte buffer.
 *
 * Constraints:
 * - Must preserve Quake II little-endian storage semantics.
 */
export function getLittleFloat(buffer: Uint8Array, offset: number): number {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getFloat32(offset, true);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Write a signed byte into a byte buffer.
 *
 * Constraints:
 * - Must preserve 8-bit signed semantics.
 */
export function setSignedByte(buffer: Uint8Array, offset: number, value: number): void {
  new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).setInt8(offset, value);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Write an unsigned byte into a byte buffer.
 *
 * Constraints:
 * - Must preserve 8-bit unsigned semantics.
 */
export function setUnsignedByte(buffer: Uint8Array, offset: number, value: number): void {
  new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).setUint8(offset, value);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Write a little-endian signed short into a byte buffer.
 *
 * Constraints:
 * - Must preserve Quake II little-endian storage semantics.
 */
export function setLittleShort(buffer: Uint8Array, offset: number, value: number): void {
  new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).setInt16(offset, value, true);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Write a little-endian signed long into a byte buffer.
 *
 * Constraints:
 * - Must preserve Quake II little-endian storage semantics.
 */
export function setLittleLong(buffer: Uint8Array, offset: number, value: number): void {
  new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).setInt32(offset, value, true);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Write a little-endian float into a byte buffer.
 *
 * Constraints:
 * - Must preserve Quake II little-endian storage semantics.
 */
export function setLittleFloat(buffer: Uint8Array, offset: number, value: number): void {
  new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).setFloat32(offset, value, true);
}
