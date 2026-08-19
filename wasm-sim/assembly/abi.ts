// ============================================================================
// WASM sim ABI — the shared contract every ported module codes against.
// ============================================================================
//
// THE PARITY RULE: every arithmetic op reads f32 operands, computes in f64,
// stores f32 ONCE. JS gets this implicitly (Float32Array read, f64 math, one
// rounding store); AS does not — `f32 * f32` computes in f32 and diverges:
//
//   store<f32>(c, <f32>(<f64>load<f32>(a) * <f64>load<f32>(b)))   // CORRECT
//   store<f32>(c, load<f32>(a) * load<f32>(b))                    // WRONG (f32 mul)
//
// Keep the JS accumulation ORDER too (a dot product is one f64 expression with a
// single f32 store, never three rounded partials).

// --- Linear-memory scalar access (QC globals / edict fields live here) --------
// A QC "pointer" is a byte offset; a global/field "index" is that offset >> 2.

@inline export function gf(base: usize, index: i32): f64 {
  // read a float global/field, WIDENED to f64 for arithmetic
  return <f64>load<f32>(base + (<usize>index << 2));
}

@inline export function gi(base: usize, index: i32): i32 {
  return load<i32>(base + (<usize>index << 2));
}

@inline export function setf(base: usize, index: i32, v: f64): void {
  // store an f64 result rounding ONCE to f32 (the parity-critical store)
  store<f32>(base + (<usize>index << 2), <f32>v);
}

@inline export function seti(base: usize, index: i32, v: i32): void {
  store<i32>(base + (<usize>index << 2), v);
}

// --- Per-map host config shared by every sim module ---------------------------
// 2021 rerelease (Kex) progs flag -- QSS-M's qcvm->brokenbouncemissile /
// ->rotatingbmodel, pushed per map by wasmServer.loadMap. Lives here, the one module
// with no imports, so every sim module reads the same global.

let rereleaseG: bool = false;

export function setRerelease(v: i32): void { rereleaseG = v != 0; }

@inline export function isRerelease(): bool { return rereleaseG; }

// --- Reserved static regions --------------------------------------------------
// memory.data gives fixed compile-time pointers so JS can alias the bytes with
// typed arrays.

// QC globals union (globals_float / globals_int over one buffer). 64K globals cap
// = 256 KB, above any progs.dat.
export const GLOBALS_MAX: i32 = 1 << 16;
export const GLOBALS: usize = memory.data(GLOBALS_MAX << 2);
