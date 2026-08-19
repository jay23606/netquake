/**
 * File: md4.ts
 * Source: Quake II original / qcommon/md4.c
 * Purpose: Port the bundled RSA MD4 implementation and `Com_BlockChecksum` helper used by Quake II checksums.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses typed arrays and explicit helpers instead of C pointer casts.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

/**
 * Original name: UINT4
 * Source: qcommon/md4.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Represents the original 32-bit MD4 word type; arithmetic is explicitly wrapped at use sites.
 */
type UINT4 = number;

const S11 = 3;
const S12 = 7;
const S13 = 11;
const S14 = 19;
const S21 = 3;
const S22 = 5;
const S23 = 9;
const S24 = 13;
const S31 = 3;
const S32 = 9;
const S33 = 11;
const S34 = 15;

const PADDING = new Uint8Array([
  0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
]);

/**
 * Original name: MD4_CTX
 * Source: qcommon/md4.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Stores the mutable state of one MD4 digest computation.
 */
export interface MD4_CTX {
  state: Uint32Array;
  count: Uint32Array;
  buffer: Uint8Array;
}

/**
 * Original name: N/A
 * Source: N/A (TS context factory)
 * Category: New
 * Purpose: Create one zero-initialized MD4 context.
 */
export function createMD4Context(): MD4_CTX {
  return {
    state: new Uint32Array(4),
    count: new Uint32Array(2),
    buffer: new Uint8Array(64)
  };
}

/**
 * Original name: MD4Init
 * Source: qcommon/md4.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Initializes one MD4 operation and writes the standard seed state.
 */
export function MD4Init(context: MD4_CTX): void {
  context.count[0] = 0;
  context.count[1] = 0;
  context.state[0] = 0x67452301;
  context.state[1] = 0xefcdab89;
  context.state[2] = 0x98badcfe;
  context.state[3] = 0x10325476;
  context.buffer.fill(0);
}

/**
 * Original name: MD4Update
 * Source: qcommon/md4.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Processes the next span of input bytes into the MD4 context.
 */
export function MD4Update(context: MD4_CTX, input: Uint8Array, inputLen = input.length): void {
  let index = (context.count[0] >>> 3) & 0x3f;
  const bitCountIncrement = ((inputLen << 3) >>> 0);

  context.count[0] = (context.count[0] + bitCountIncrement) >>> 0;
  if (context.count[0] < bitCountIncrement) {
    context.count[1] = (context.count[1] + 1) >>> 0;
  }

  context.count[1] = (context.count[1] + (inputLen >>> 29)) >>> 0;

  const partLen = 64 - index;
  let i = 0;

  if (inputLen >= partLen) {
    context.buffer.set(input.subarray(0, partLen), index);
    MD4Transform(context.state, context.buffer);

    for (i = partLen; i + 63 < inputLen; i += 64) {
      MD4Transform(context.state, input.subarray(i, i + 64));
    }

    index = 0;
  }

  context.buffer.set(input.subarray(i, i + (inputLen - i)), index);
}

/**
 * Original name: MD4Final
 * Source: qcommon/md4.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Finalizes the digest, writes 16 output bytes and clears the context.
 */
export function MD4Final(digest: Uint8Array, context: MD4_CTX): void {
  const bits = new Uint8Array(8);
  Encode(bits, context.count, 8);

  const index = (context.count[0] >>> 3) & 0x3f;
  const padLen = index < 56 ? (56 - index) : (120 - index);
  MD4Update(context, PADDING, padLen);
  MD4Update(context, bits, 8);
  Encode(digest, context.state, 16);

  context.state.fill(0);
  context.count.fill(0);
  context.buffer.fill(0);
}

/**
 * Original name: Com_BlockChecksum
 * Source: qcommon/md4.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Hashes a byte block with MD4 and XORs the four digest words into one checksum.
 */
export function Com_BlockChecksum(buffer: Uint8Array, length = buffer.length): number {
  const digest = new Uint32Array(4);
  const digestBytes = new Uint8Array(digest.buffer);
  const ctx = createMD4Context();

  MD4Init(ctx);
  MD4Update(ctx, buffer, length);
  MD4Final(digestBytes, ctx);

  return (digest[0] ^ digest[1] ^ digest[2] ^ digest[3]) >>> 0;
}

/**
 * Original name: F
 * Source: qcommon/md4.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Implements the first MD4 boolean function with unsigned 32-bit wrapping.
 */
function F(x: UINT4, y: UINT4, z: UINT4): UINT4 {
  return (((x & y) | (~x & z)) >>> 0);
}

/**
 * Original name: G
 * Source: qcommon/md4.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Implements the second MD4 majority function with unsigned 32-bit wrapping.
 */
function G(x: UINT4, y: UINT4, z: UINT4): UINT4 {
  return (((x & y) | (x & z) | (y & z)) >>> 0);
}

/**
 * Original name: H
 * Source: qcommon/md4.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Implements the third MD4 xor function with unsigned 32-bit wrapping.
 */
function H(x: UINT4, y: UINT4, z: UINT4): UINT4 {
  return ((x ^ y ^ z) >>> 0);
}

/**
 * Original name: ROTATE_LEFT
 * Source: qcommon/md4.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Rotates one unsigned 32-bit word left by the requested bit count.
 */
function ROTATE_LEFT(x: UINT4, n: number): UINT4 {
  return (((x << n) | (x >>> (32 - n))) >>> 0);
}

/**
 * Original name: FF
 * Source: qcommon/md4.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Applies one round-1 MD4 transformation step.
 */
function FF(a: UINT4, b: UINT4, c: UINT4, d: UINT4, x: UINT4, s: number): UINT4 {
  a = (a + F(b, c, d) + x) >>> 0;
  return ROTATE_LEFT(a, s);
}

/**
 * Original name: GG
 * Source: qcommon/md4.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Applies one round-2 MD4 transformation step, including the C constant 0x5a827999.
 */
function GG(a: UINT4, b: UINT4, c: UINT4, d: UINT4, x: UINT4, s: number): UINT4 {
  a = (a + G(b, c, d) + x + 0x5a827999) >>> 0;
  return ROTATE_LEFT(a, s);
}

/**
 * Original name: HH
 * Source: qcommon/md4.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Applies one round-3 MD4 transformation step, including the C constant 0x6ed9eba1.
 */
function HH(a: UINT4, b: UINT4, c: UINT4, d: UINT4, x: UINT4, s: number): UINT4 {
  a = (a + H(b, c, d) + x + 0x6ed9eba1) >>> 0;
  return ROTATE_LEFT(a, s);
}

/**
 * Original name: MD4Transform
 * Source: qcommon/md4.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Applies the 48-step MD4 block transform and accumulates the result into the digest state.
 */
function MD4Transform(state: Uint32Array, block: Uint8Array): void {
  let a = state[0] >>> 0;
  let b = state[1] >>> 0;
  let c = state[2] >>> 0;
  let d = state[3] >>> 0;
  const x = new Uint32Array(16);

  Decode(x, block, 64);

  a = FF(a, b, c, d, x[0], S11);
  d = FF(d, a, b, c, x[1], S12);
  c = FF(c, d, a, b, x[2], S13);
  b = FF(b, c, d, a, x[3], S14);
  a = FF(a, b, c, d, x[4], S11);
  d = FF(d, a, b, c, x[5], S12);
  c = FF(c, d, a, b, x[6], S13);
  b = FF(b, c, d, a, x[7], S14);
  a = FF(a, b, c, d, x[8], S11);
  d = FF(d, a, b, c, x[9], S12);
  c = FF(c, d, a, b, x[10], S13);
  b = FF(b, c, d, a, x[11], S14);
  a = FF(a, b, c, d, x[12], S11);
  d = FF(d, a, b, c, x[13], S12);
  c = FF(c, d, a, b, x[14], S13);
  b = FF(b, c, d, a, x[15], S14);

  a = GG(a, b, c, d, x[0], S21);
  d = GG(d, a, b, c, x[4], S22);
  c = GG(c, d, a, b, x[8], S23);
  b = GG(b, c, d, a, x[12], S24);
  a = GG(a, b, c, d, x[1], S21);
  d = GG(d, a, b, c, x[5], S22);
  c = GG(c, d, a, b, x[9], S23);
  b = GG(b, c, d, a, x[13], S24);
  a = GG(a, b, c, d, x[2], S21);
  d = GG(d, a, b, c, x[6], S22);
  c = GG(c, d, a, b, x[10], S23);
  b = GG(b, c, d, a, x[14], S24);
  a = GG(a, b, c, d, x[3], S21);
  d = GG(d, a, b, c, x[7], S22);
  c = GG(c, d, a, b, x[11], S23);
  b = GG(b, c, d, a, x[15], S24);

  a = HH(a, b, c, d, x[0], S31);
  d = HH(d, a, b, c, x[8], S32);
  c = HH(c, d, a, b, x[4], S33);
  b = HH(b, c, d, a, x[12], S34);
  a = HH(a, b, c, d, x[2], S31);
  d = HH(d, a, b, c, x[10], S32);
  c = HH(c, d, a, b, x[6], S33);
  b = HH(b, c, d, a, x[14], S34);
  a = HH(a, b, c, d, x[1], S31);
  d = HH(d, a, b, c, x[9], S32);
  c = HH(c, d, a, b, x[5], S33);
  b = HH(b, c, d, a, x[13], S34);
  a = HH(a, b, c, d, x[3], S31);
  d = HH(d, a, b, c, x[11], S32);
  c = HH(c, d, a, b, x[7], S33);
  b = HH(b, c, d, a, x[15], S34);

  state[0] = (state[0] + a) >>> 0;
  state[1] = (state[1] + b) >>> 0;
  state[2] = (state[2] + c) >>> 0;
  state[3] = (state[3] + d) >>> 0;
}

/**
 * Original name: Encode
 * Source: qcommon/md4.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Encodes little-endian 32-bit MD4 words into bytes, assuming `len` is a multiple of 4.
 */
function Encode(output: Uint8Array, input: Uint32Array, len: number): void {
  for (let i = 0, j = 0; j < len; i += 1, j += 4) {
    output[j] = input[i] & 0xff;
    output[j + 1] = (input[i] >>> 8) & 0xff;
    output[j + 2] = (input[i] >>> 16) & 0xff;
    output[j + 3] = (input[i] >>> 24) & 0xff;
  }
}

/**
 * Original name: Decode
 * Source: qcommon/md4.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Decodes little-endian byte groups into unsigned 32-bit MD4 words, assuming `len` is a multiple of 4.
 */
function Decode(output: Uint32Array, input: Uint8Array, len: number): void {
  for (let i = 0, j = 0; j < len; i += 1, j += 4) {
    output[i] = (
      input[j] |
      (input[j + 1] << 8) |
      (input[j + 2] << 16) |
      (input[j + 3] << 24)
    ) >>> 0;
  }
}
