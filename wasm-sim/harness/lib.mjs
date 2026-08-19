// Reusable parity-harness helpers. A "golden" test loads the compiled WASM,
// drives a ported function and its JS reference with identical inputs, and
// asserts BIT-EXACT equality on every float (via Float32 bit patterns, not ===,
// so -0/NaN/ulp differences are caught).

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const buildPath = (name) => join(HERE, '..', 'build', name);

// Load a compiled module. `wasmName` defaults to the standalone module build;
// pass extra `imports` for modules that declare host functions (e.g. vm).
// Default no-op stubs cover every host-import namespace the sim declares, so a
// standalone module build that newly pulls in vm/host/strings (e.g. builtins_move
// gaining touch dispatch via linkEdictTouch) instantiates without each test file
// having to grow its own stubs. Caller-provided namespaces replace the stubs wholesale.
export async function loadWasm(imports = {}, wasmName = 'sim.wasm') {
  const bytes = readFileSync(buildPath(wasmName));
  // host_pow must be the REAL Math.pow (not the ()=>0 proxy stub): the JS reference impls
  // use Math.pow, and the whole point of the transcendental host bridge is bit-parity.
  const hostStub = new Proxy({ host_pow: Math.pow }, { get: (t, k) => (k in t ? t[k] : () => 0) });
  // Transcendental host bridge (see assembly builtins_math `declare function host_sin` note):
  // every namespace that declares host_sin/cos/atan2 gets the engine's own Math fns.
  const trig = { host_sin: Math.sin, host_cos: Math.cos, host_atan2: Math.atan2 };
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: { abort: (msg, file, line, col) => { throw new Error(`wasm abort @${line}:${col}`); } },
    vm: { isServerLoading: () => 0, hostError: () => {} },
    strings: { host_tostring: () => 0, host_tofixed1: () => 0 },
    host: hostStub,
    builtins_move: { host_random: () => 0, ...trig },
    builtins_math: { ...trig },
    builtins_math2: { ...trig },
    svpusher: { ...trig },
    svclient: { ...trig },
    svphysics: { host_watersplash: () => {}, host_hitsound: () => {} },   // splash is host-side audio; parity tests ignore it
    ...imports,
  });
  return instance.exports;
}

// Deterministic PRNG (no Date/Math.random — reproducible golden runs).
export function rng(seed = 0x1234567) {
  let s = seed >>> 0;
  return {
    u32() { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s; },
    // float in [-range, range], quantized to f32 (what the sim actually holds)
    f32(range = 1000) { return Math.fround((this.u32() / 0xffffffff) * 2 * range - range); },
    // draw from the FULL 32-bit range mapped to [0,n) — avoids the LCG's weak low
    // bits (u32()%n collapses onto a short period for small power-of-2 n).
    int(n) { return Math.floor((this.u32() / 0x100000000) * n); },
  };
}

const f32bits = (() => { const b = new Float32Array(1), u = new Uint32Array(b.buffer); return (x) => { b[0] = x; return u[0]; }; })();
export function f32eq(a, b) { return f32bits(a) === f32bits(b); }

export class Check {
  constructor(name) { this.name = name; this.n = 0; this.fails = 0; this.samples = []; }
  floatEq(w, j, ctx = '') {
    this.n++;
    if (!f32eq(w, j)) { this.fails++; if (this.samples.length < 5) this.samples.push(`${ctx} wasm=${w} js=${j}`); }
  }
  intEq(w, j, ctx = '') {
    this.n++;
    if ((w | 0) !== (j | 0)) { this.fails++; if (this.samples.length < 5) this.samples.push(`${ctx} wasm=${w} js=${j}`); }
  }
  report() {
    const ok = this.fails === 0;
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${this.name}: ${this.n - this.fails}/${this.n} bit-exact`);
    for (const s of this.samples) console.log('   ', s);
    return ok;
  }
}
