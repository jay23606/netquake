// Pure math QuakeC builtins — pf.ts rint (#36), floor (#37), ceil (#38),
// fabs (#43), sin (#60), cos (#61), sqrt (#62), ChangeYaw (#49),
// changepitch (#63). Globals via abi.GLOBALS at pr.ts's fixed indices;
// ChangeYaw/changepitch also read/write `self`'s fields via ed.ts.
//
// PARITY: reads widen f32->f64, compute in f64, single f32 store — docs/
// wasm-sim-port-assemblyscript.md THE PARITY RULE. floor/ceil/abs/sqrt are
// IEEE-754-exact and used natively; sin/cos go through the host imports below.
//
// rint (#36): pf.ts truncates via JS `>> 0`, i.e. ECMA-262 ToInt32 — for
// |x| >= 2^31 that reduces modulo 2^32 into [-2^31, 2^31), NOT plain
// truncation. AS's bare `<i32>` cast of an out-of-range f64 diverges, hence
// the toInt32() helper below.
//
// changepitch (#63) BUG-FOR-BUG: pf.ts reads/writes `pr.entvars.angles0`, a
// key that does not exist, so in JS `current` is always NaN, every comparison
// is false, and the final store is a non-index expando write that never touches
// the field buffer — a guaranteed no-op for every input. Reproduced as-is.
// If pf.ts is ever fixed (angles0 -> angles, entvars index 19), mirror the fix
// here with F_ANGLES and a real store.

import { gf, gi, setf, GLOBALS } from "./abi";
import { edLoadFloat, edStoreFloat } from "./ed";
import { anglemod } from "./math";

// Host-bridged transcendentals: AssemblyScript's own Math.sin/cos/atan2 can differ from the
// JS engine's by 1 f64 ulp on rare inputs, which crosses f32 store boundaries and forks the
// sims. Import namespace = this file's name.
declare function host_sin(x: f64): f64;
declare function host_cos(x: f64): f64;

// Re-export ed.ts so a standalone build carries the test harness's setup surface.
export * from "./ed";

export function globalsPtr(): usize { return GLOBALS; }

// JS-callable GLOBALS accessors — heap.alloc can grow/detach wasm memory, so
// callers use these instead of a captured typed-array view.
export function writeGlobalFloat(idx: i32, v: f32): void { setf(GLOBALS, idx, <f64>v); }
export function readGlobalFloat(idx: i32): f32 { return <f32>gf(GLOBALS, idx); }
export function writeGlobalInt(idx: i32, v: i32): void { store<i32>(GLOBALS + (<usize>idx << 2), v); }
export function readGlobalInt(idx: i32): i32 { return gi(GLOBALS, idx); }

// --- QC call-ABI / engine-reserved global indices (src/engine/pf.ts, pr.ts globalvars).
const PARM0: i32 = 4;      // first builtin arg (float)
const RETURN: i32 = 1;     // builtin return (float)
const GLOBAL_SELF: i32 = 28;

// --- entvars field indices (src/engine/pr.ts entvars, vanilla layout) ---------
const F_ANGLES1: i32 = 20;    // yaw component of self.angles
const F_IDEAL_YAW: i32 = 85;
const F_YAW_SPEED: i32 = 86;

// ECMA-262 ToInt32(x): truncate toward zero, reduce modulo 2^32 into
// [-2^31, 2^31); NaN/Infinity -> 0. Matches JS `x >> 0` bit-exactly (AS f64 `%`
// is fmod-compatible, which keeps the reduction exact).
function toInt32(x: f64): i32 {
  if (isNaN(x) || !isFinite(x)) return 0;
  const truncated: f64 = Math.trunc(x);
  let mod: f64 = truncated % 4294967296.0;
  if (mod < 0.0) mod += 4294967296.0;
  if (mod >= 2147483648.0) mod -= 4294967296.0;
  return <i32>mod;
}

// #36 float(float f) rint — round to nearest int, half-away-from-zero (NOT
// round-half-to-even: pf.ts's `f >= 0.0 ? f + 0.5 : f - 0.5` then truncate).
export function pf_rint(g: usize): void {
  const f: f64 = gf(g, PARM0);
  const biased: f64 = f >= 0.0 ? f + 0.5 : f - 0.5;
  setf(g, RETURN, <f64>toInt32(biased));
}

// #37 float(float f) floor
export function pf_floor(g: usize): void {
  setf(g, RETURN, Math.floor(gf(g, PARM0)));
}

// #38 float(float f) ceil
export function pf_ceil(g: usize): void {
  setf(g, RETURN, Math.ceil(gf(g, PARM0)));
}

// #43 float(float f) fabs
export function pf_fabs(g: usize): void {
  setf(g, RETURN, Math.abs(gf(g, PARM0)));
}

// #60 float(float f) sin
export function pf_sin(g: usize): void {
  setf(g, RETURN, host_sin(gf(g, PARM0)));
}

// #61 float(float f) cos
export function pf_cos(g: usize): void {
  setf(g, RETURN, host_cos(gf(g, PARM0)));
}

// #62 float(float f) sqrt
export function pf_sqrt(g: usize): void {
  setf(g, RETURN, Math.sqrt(gf(g, PARM0)));
}

// #49 void() ChangeYaw. Reads `self` (GLOBAL_SELF), no arg slots. Turns
// self.angles_yaw toward self.ideal_yaw by at most self.yaw_speed degrees.
export function pf_changeyaw(g: usize): void {
  const self: i32 = gi(g, GLOBAL_SELF);
  const current: f64 = anglemod(<f64>edLoadFloat(self, F_ANGLES1));
  const ideal: f64 = <f64>edLoadFloat(self, F_IDEAL_YAW);
  if (current == ideal) return;
  let move: f64 = ideal - current;
  if (ideal > current) {
    if (move >= 180.0) move -= 360.0;
  } else if (move <= -180.0) {
    move += 360.0;
  }
  const speed: f64 = <f64>edLoadFloat(self, F_YAW_SPEED);
  if (move > 0.0) {
    if (move > speed) move = speed;
  } else if (move < -speed) {
    move = -speed;
  }
  edStoreFloat(self, F_ANGLES1, anglemod(current + move));
}

// #63 void() changepitch — file-header BUG-FOR-BUG note applies. SECOND pf.ts
// quirk, reproduced: it resolves `self` from PARM0's slot (index 4), NOT
// globalvars.self (28) — changepitch takes no args, so PARM0 holds stale data.
// idealpitchField/pitchSpeedField are host-resolved progs.dat-dependent field
// indices (pf.ts getEdictFieldValue "idealpitch"/"pitch_speed"); read for
// NaN-propagation parity but never observably written.
export function pf_changepitch(g: usize, idealpitchField: i32, pitchSpeedField: i32): void {
  const self: i32 = gi(g, PARM0); // deliberately PARM0, not GLOBAL_SELF (quirk above)
  const current: f64 = NaN; // JS anglemod(undefined) — see file header
  const ideal: f64 = <f64>edLoadFloat(self, idealpitchField);
  if (current == ideal) return; // always false (NaN); kept for shape parity
  let move: f64 = ideal - current;
  if (ideal > current) {
    if (move >= 180.0) move -= 360.0;
  } else if (move <= -180.0) {
    move += 360.0;
  }
  const speed: f64 = <f64>edLoadFloat(self, pitchSpeedField);
  if (move > 0.0) {
    if (move > speed) move = speed;
  } else if (move < -speed) {
    move = -speed;
  }
  // pf.ts's final angles0 store is a silent no-op — intentionally not modeled.
}
