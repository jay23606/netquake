// Golden parity test: builtins_math2.ts (rint, floor, ceil, fabs, sin, cos,
// sqrt, ChangeYaw #49, changepitch #63) vs the JS reference in
// src/engine/pf.ts, transliterated inline below. Drives both with identical
// f32 inputs and asserts BIT-EXACT f32-store equality via Check (see
// harness/lib.mjs) across thousands of deterministic-random cases, including
// full-range/edge-case coverage (NaN, +-Infinity, +-0, tie boundaries, and
// huge f32 magnitudes for rint's ToInt32 wraparound).
//
// This module compiles STANDALONE (not part of assembly/index.ts — see the
// task note: other agents share assembly/index.ts) so it loads its own wasm
// file directly rather than harness/lib.mjs's default WASM_PATH, mirroring
// builtins_math.test.mjs's pattern exactly.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { rng, Check } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = join(HERE, '..', 'build', 'builtins_math2.wasm');

async function loadWasm() {
  const bytes = readFileSync(WASM_PATH);
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: { abort: (msg, file, line, col) => { throw new Error(`wasm abort @${line}:${col}`); } },
    // DEFAULT-NS: full host-import namespace defaults (later keys in this literal override).
    vm: { isServerLoading: () => 0, hostError: () => {} },
    strings: { host_tostring: () => 0, host_tofixed1: () => 0 },
    host: new Proxy({ host_pow: Math.pow }, { get: (t, k) => (k in t ? t[k] : () => 0) }),
    builtins_move: { host_random: () => 0, host_sin: Math.sin, host_cos: Math.cos },
    builtins_math: { host_sin: Math.sin, host_cos: Math.cos, host_atan2: Math.atan2 },
    builtins_math2: { host_sin: Math.sin, host_cos: Math.cos },
    svphysics: { host_watersplash: () => {}, host_hitsound: () => {} },
    svpusher: { host_sin: Math.sin, host_cos: Math.cos },
    svclient: { host_sin: Math.sin, host_cos: Math.cos },
  });
  return instance.exports;
}

const x = await loadWasm();
const g = x.globalsPtr();

// Engine global indices (must match assembly/builtins_math2.ts / src/engine/pr.ts globalvars)
const PARM0 = 4, RETURN = 1, GLOBAL_SELF = 28;
// entvars field indices (src/engine/pr.ts entvars, vanilla layout)
const F_ANGLES1 = 20, F_IDEAL_YAW = 85, F_YAW_SPEED = 86;

const rd = (idx) => x.readGlobalFloat(idx);
const wr = (idx, v) => x.writeGlobalFloat(idx, v);
const wri = (idx, v) => x.writeGlobalInt(idx, v);

const results = [];

// --- JS reference, transliterated verbatim from src/engine/pf.ts -------------
function jsRint(f) {
  return (f >= 0.0 ? f + 0.5 : f - 0.5) >> 0;
}
function jsFloor(f) { return Math.floor(f); }
function jsCeil(f) { return Math.ceil(f); }
function jsFabs(f) { return Math.abs(f); }
function jsSin(f) { return Math.sin(f); }
function jsCos(f) { return Math.cos(f); }
function jsSqrt(f) { return Math.sqrt(f); }
function jsAnglemod(a) { return (a % 360.0 + 360.0) % 360.0; }
// pf.ts changeyaw: reads self.angles1 (yaw)/ideal_yaw/yaw_speed, returns the
// value that WOULD be written to self.angles1 (or the ORIGINAL raw yaw,
// unchanged, if current === ideal — the early return means no write at all,
// so the field keeps whatever it held before, not anglemod(current)).
function jsChangeYaw(rawYaw, ideal, speed) {
  const current = jsAnglemod(rawYaw);
  if (current === ideal) return rawYaw;
  let move = ideal - current;
  if (ideal > current) {
    if (move >= 180.0) move -= 360.0;
  } else if (move <= -180.0) {
    move += 360.0;
  }
  if (move > 0.0) {
    if (move > speed) move = speed;
  } else if (move < -speed) {
    move = -speed;
  }
  return jsAnglemod(current + move);
}

const r = rng(0xB00B00);

// --- rint --------------------------------------------------------------------
// Half-away-from-zero via JS `>>` (ECMA ToInt32: truncate then reduce mod 2^32
// into [-2^31,2^31)), NOT round-half-to-even. Full range incl. negatives, tie
// boundaries (x.5 exactly, both signs), zero/-0, NaN/Infinity, and huge f32
// magnitudes (exercises the ToInt32 wraparound the naive `<i32>` cast would miss).
{
  const chk = new Check('rint');
  const ranges = [1, 10, 1000, 100000, 1e10, 1e20, 3.4e38];
  let i = 0;
  for (const range of ranges) {
    for (let k = 0; k < 30000; k++, i++) {
      const v = r.f32(range);
      wr(PARM0, v);
      x.pf_rint(g);
      chk.floatEq(rd(RETURN), Math.fround(jsRint(v)), `rint#${i} v=${v} range=${range}`);
    }
  }
  // explicit tie / edge cases
  const edges = [
    0, -0, 0.5, -0.5, 1.5, -1.5, 2.5, -2.5, 179.5, -179.5,
    Math.fround(2147483647.5), Math.fround(-2147483648.5),
    Math.fround(4294967295.5), Math.fround(-4294967295.5),
    Math.fround(3.4028235e38), Math.fround(-3.4028235e38),
    NaN, Infinity, -Infinity,
  ];
  for (const v of edges) {
    const vf = Math.fround(v);
    wr(PARM0, vf);
    x.pf_rint(g);
    chk.floatEq(rd(RETURN), Math.fround(jsRint(vf)), `rint.edge v=${vf}`);
  }
  results.push(chk.report());
}

// --- floor / ceil / fabs / sin / cos / sqrt -----------------------------------
function testUnary(name, wasmFn, jsFn, ranges, edges) {
  const chk = new Check(name);
  let i = 0;
  for (const range of ranges) {
    for (let k = 0; k < 30000; k++, i++) {
      const v = r.f32(range);
      wr(PARM0, v);
      wasmFn(g);
      chk.floatEq(rd(RETURN), Math.fround(jsFn(v)), `${name}#${i} v=${v} range=${range}`);
    }
  }
  for (const v of edges) {
    const vf = Math.fround(v);
    wr(PARM0, vf);
    wasmFn(g);
    chk.floatEq(rd(RETURN), Math.fround(jsFn(vf)), `${name}.edge v=${vf}`);
  }
  results.push(chk.report());
}

const commonEdges = [0, -0, 0.5, -0.5, NaN, Infinity, -Infinity, Math.fround(3.4028235e38), Math.fround(-3.4028235e38)];

testUnary('floor', x.pf_floor, jsFloor, [1, 1000, 100000, 1e20, 3.4e38], commonEdges);
testUnary('ceil', x.pf_ceil, jsCeil, [1, 1000, 100000, 1e20, 3.4e38], commonEdges);
testUnary('fabs', x.pf_fabs, jsFabs, [1, 1000, 100000, 1e20, 3.4e38], commonEdges);
// sin/cos: PF sin/cos take RADIANS directly (no degree conversion) — exercise
// small, medium and very wide (accumulated-rotation-scale) ranges, matching
// builtins_math.ts's makevectors precedent for wide-angle trig coverage.
testUnary('sin', x.pf_sin, jsSin, [1, 10, 1000, 100000, 1e7], commonEdges);
testUnary('cos', x.pf_cos, jsCos, [1, 10, 1000, 100000, 1e7], commonEdges);
// sqrt: only meaningful (non-NaN in both) for non-negative inputs, but negative
// inputs must still match bit-for-bit (both sides yield NaN — Math.sqrt of a
// negative number is NaN in both JS and AS/wasm) — draw from a signed range too.
testUnary('sqrt', x.pf_sqrt, jsSqrt, [1, 1000, 100000, 1e20, 3.4e38], commonEdges);

// --- ChangeYaw (#49) ----------------------------------------------------------
{
  const maxEdicts = 32, edictSizeWords = 150;
  x.initEdicts(maxEdicts, edictSizeWords);
  const chk = new Check('changeyaw');
  for (let i = 0; i < 100000; i++) {
    const e = r.int(maxEdicts);
    let rawYaw = r.f32(720); // exercise out-of-[0,360) stored yaw too
    let ideal = r.f32(720);
    let speed = r.f32(500); // allow negative speed too (pf.ts doesn't guard against it)
    if (i % 5000 === 0) {
      // force the current===ideal early-return branch: ideal exactly equals
      // anglemod(rawYaw) as an f32 value
      ideal = Math.fround(jsAnglemod(rawYaw));
    }
    x.edStoreFloat(e, F_ANGLES1, rawYaw);
    x.edStoreFloat(e, F_IDEAL_YAW, ideal);
    x.edStoreFloat(e, F_YAW_SPEED, speed);
    wri(GLOBAL_SELF, e);

    x.pf_changeyaw(g);

    const wasmYaw = x.edLoadFloat(e, F_ANGLES1);
    const jsYaw = Math.fround(jsChangeYaw(rawYaw, ideal, speed));
    chk.floatEq(wasmYaw, jsYaw, `changeyaw#${i} e=${e} rawYaw=${rawYaw} ideal=${ideal} speed=${speed}`);
  }
  results.push(chk.report());
}

// --- changepitch (#63) — bug-for-bug: verified GUARANTEED NO-OP -------------
// pf.ts's changepitch reads/writes `pr.entvars.angles0`, which does not exist
// in pr.ts's entvars table (only angles/angles1/angles2 do), so `current` is
// always NaN, every comparison against it is always false, and the terminal
// `ent.v_float[undefined] = ...` store never touches real edict storage
// (confirmed empirically — see builtins_math2.ts file header). The bit-exact
// parity claim here is therefore: calling pf_changepitch NEVER changes any
// field of any entity, for ANY input — snapshot every field of the resolved
// self entity (and a neighbor, to catch any stray out-of-bounds write) before
// and after the call and assert byte-for-byte (raw int32) equality.
{
  const maxEdicts = 32, edictSizeWords = 150;
  x.initEdicts(maxEdicts, edictSizeWords);
  const chk = new Check('changepitch.noop');
  for (let i = 0; i < 20000; i++) {
    const e = r.int(maxEdicts);
    const neighbor = (e + 1) % maxEdicts;
    const idealpitchField = r.int(edictSizeWords);
    const pitchSpeedField = r.int(edictSizeWords);

    // fill both edicts with random garbage bit patterns (ints, so any float
    // reinterpretation — including NaN payloads — is exercised too)
    for (let f = 0; f < edictSizeWords; f++) {
      x.edStoreInt(e, f, (r.u32() | 0) || 1);
      x.edStoreInt(neighbor, f, (r.u32() | 0) || 1);
    }
    const before = new Int32Array(edictSizeWords);
    for (let f = 0; f < edictSizeWords; f++) before[f] = x.edLoadInt(e, f);
    const beforeNeighbor = new Int32Array(edictSizeWords);
    for (let f = 0; f < edictSizeWords; f++) beforeNeighbor[f] = x.edLoadInt(neighbor, f);

    wri(PARM0, e); // pf.ts's changepitch resolves self via globals_int[4] (PARM0), not GLOBAL_SELF — see file header quirk note
    x.pf_changepitch(g, idealpitchField, pitchSpeedField);

    for (let f = 0; f < edictSizeWords; f++) {
      chk.intEq(x.edLoadInt(e, f), before[f], `changepitch.self#${i} e=${e} f=${f}`);
      chk.intEq(x.edLoadInt(neighbor, f), beforeNeighbor[f], `changepitch.neighbor#${i} e=${e} f=${f}`);
    }
  }
  results.push(chk.report());
}

const ok = results.every(Boolean);
process.exit(ok ? 0 : 1);
