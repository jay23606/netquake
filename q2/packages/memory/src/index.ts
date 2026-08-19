/**
 * File: q_shared.ts
 * Purpose: Expose the low-level binary and buffer primitives used by the Quake II port.
 *
 * This file is not a direct source port.
 * It is a package entry point for the low-level memory runtime.
 *
 * Dependencies:
 * - packages/memory/src/binary-io.ts
 * - packages/memory/src/sizebuf.ts
 */

export {
  getLittleFloat,
  getLittleLong,
  getLittleShort,
  getSignedByte,
  getUnsignedByte,
  setLittleFloat,
  setLittleLong,
  setLittleShort,
  setSignedByte,
  setUnsignedByte
} from "./binary-io.js";

export {
  MSG_BeginReading,
  SZ_Clear,
  SZ_GetSpace,
  SZ_Init,
  SZ_Print,
  SZ_Write,
  createSizeBuffer
} from "./sizebuf.js";

export type { sizebuf_t } from "./sizebuf.js";
