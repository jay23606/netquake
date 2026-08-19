// Golden parity test: builtins_math.ts (makevectors, normalize, vlen,
// vectoyaw, vectoangles + the angleVectors helper makevectors uses) vs the
// JS reference in src/engine/pf.ts / src/engine/vec.ts, transliterated
// inline below. Drives both with identical f32 globals and asserts BIT-EXACT
// f32-store equality via Check (see harness/lib.mjs) across thousands of
// deterministic-random cases, including the full angle range for the trig
// builtins.
//
// This module compiles STANDALONE (not part of assembly/index.ts — see the
// task note: other agents share assembly/index.ts) so it loads its own wasm
// file directly rather than harness/lib.mjs's default WASM_PATH.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { rng, Check } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = join(HERE, '..', 'build', 'builtins_math.wasm');

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
const wf = new Float32Array(x.memory.buffer, g, 4096); // f32 view aliasing wasm globals memory

// Engine global indices (must match assembly/builtins_math.ts / src/engine/pr.ts globalvars)
const PARM0 = 4, RETURN = 1;
const V_FORWARD = 59, V_UP = 62, V_RIGHT = 65;

function fround3(v) { return [Math.fround(v[0]), Math.fround(v[1]), Math.fround(v[2])]; }

// --- JS reference, transliterated from src/engine/vec.ts angleVectors --------
function jsAngleVectors(angles) {
  let angle = angles[0] * Math.PI / 180.0;
  const sp = Math.sin(angle), cp = Math.cos(angle);
  angle = angles[1] * Math.PI / 180.0;
  const sy = Math.sin(angle), cy = Math.cos(angle);
  angle = angles[2] * Math.PI / 180.0;
  const sr = Math.sin(angle), cr = Math.cos(angle);
  const forward = [cp * cy, cp * sy, -sp];
  const right = [cr * sy - sr * sp * cy, -sr * sp * sy - cr * cy, -sr * cp];
  const up = [cr * sp * cy + sr * sy, cr * sp * sy - sr * cy, cr * cp];
  return { forward, right, up };
}

// --- JS reference, transliterated from src/engine/pf.ts ----------------------
function jsNormalize(v) {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (len === 0.0) return [0.0, 0.0, 0.0];
  return [v[0] / len, v[1] / len, v[2] / len];
}
function jsVlen(v) {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}
function jsVectoyaw(value1, value2) {
  if (value1 === 0.0 && value2 === 0.0) return 0.0;
  let yaw = (Math.atan2(value2, value1) * 180.0 / Math.PI) >> 0;
  if (yaw < 0) yaw += 360;
  return yaw;
}
function jsVectoangles(v) {
  if (v[0] === 0.0 && v[1] === 0.0) {
    return [v[2] > 0.0 ? 90.0 : 270.0, 0.0, 0.0];
  }
  let yaw = Math.atan2(v[1], v[0]) * 180.0 / Math.PI;
  if (yaw < 0) yaw += 360;
  let pitch = Math.atan2(v[2], Math.sqrt(v[0] * v[0] + v[1] * v[1])) * 180.0 / Math.PI;
  if (pitch < 0) pitch += 360;
  return [pitch, yaw, 0.0];
}

const r = rng(0xA55A5A);

// --- makevectors (exercises angleVectors) — full angle range -----------------
{
  const chk = new Check('makevectors');
  for (let i = 0; i < 200000; i++) {
    // full angle range, not just [-360,360]: pf.ts angles can be arbitrary
    // accumulated floats (e.g. spinning func_rotate), so exercise wide range too.
    const wide = i % 4 === 0;
    const angles = wide
      ? [r.f32(100000), r.f32(100000), r.f32(100000)]
      : [r.f32(360), r.f32(360), r.f32(360)];
    wf[PARM0] = angles[0]; wf[PARM0 + 1] = angles[1]; wf[PARM0 + 2] = angles[2];
    x.makevectors(g);
    const wForward = [wf[V_FORWARD], wf[V_FORWARD + 1], wf[V_FORWARD + 2]];
    const wRight = [wf[V_RIGHT], wf[V_RIGHT + 1], wf[V_RIGHT + 2]];
    const wUp = [wf[V_UP], wf[V_UP + 1], wf[V_UP + 2]];
    const { forward, right, up } = jsAngleVectors(angles);
    for (let k = 0; k < 3; k++) {
      chk.floatEq(wForward[k], Math.fround(forward[k]), `fwd#${i}[${k}] angles=${angles}`);
      chk.floatEq(wRight[k], Math.fround(right[k]), `right#${i}[${k}] angles=${angles}`);
      chk.floatEq(wUp[k], Math.fround(up[k]), `up#${i}[${k}] angles=${angles}`);
    }
  }
  globalThis.__results = (globalThis.__results || []).concat(chk.report());
}

// --- normalize -----------------------------------------------------------
{
  const chk = new Check('normalize');
  for (let i = 0; i < 100000; i++) {
    const v = fround3([r.f32(5000), r.f32(5000), r.f32(5000)]);
    if (i % 5000 === 0) { v[0] = 0; v[1] = 0; v[2] = 0; } // exercise the zero-length branch
    wf[PARM0] = v[0]; wf[PARM0 + 1] = v[1]; wf[PARM0 + 2] = v[2];
    x.normalize(g);
    const w = [wf[RETURN], wf[RETURN + 1], wf[RETURN + 2]];
    const j = jsNormalize(v).map(Math.fround);
    for (let k = 0; k < 3; k++) chk.floatEq(w[k], j[k], `normalize#${i}[${k}] v=${v}`);
  }
  globalThis.__results.push(chk.report());
}

// --- vlen ------------------------------------------------------------------
{
  const chk = new Check('vlen');
  for (let i = 0; i < 100000; i++) {
    const v = fround3([r.f32(5000), r.f32(5000), r.f32(5000)]);
    wf[PARM0] = v[0]; wf[PARM0 + 1] = v[1]; wf[PARM0 + 2] = v[2];
    x.vlen(g);
    chk.floatEq(wf[RETURN], Math.fround(jsVlen(v)), `vlen#${i} v=${v}`);
  }
  globalThis.__results.push(chk.report());
}

// --- vectoyaw ----------------------------------------------------------------
{
  const chk = new Check('vectoyaw');
  for (let i = 0; i < 150000; i++) {
    let v1 = r.f32(5000), v2 = r.f32(5000);
    if (i % 7000 === 0) { v1 = 0; v2 = 0; } // exercise the (0,0) branch
    wf[PARM0] = v1; wf[PARM0 + 1] = v2;
    x.vectoyaw(g);
    chk.floatEq(wf[RETURN], Math.fround(jsVectoyaw(v1, v2)), `vectoyaw#${i} v1=${v1} v2=${v2}`);
  }
  globalThis.__results.push(chk.report());
}

// --- vectoangles -------------------------------------------------------------
{
  const chk = new Check('vectoangles');
  for (let i = 0; i < 200000; i++) {
    let v = fround3([r.f32(5000), r.f32(5000), r.f32(5000)]);
    if (i % 8000 === 0) { v[0] = 0; v[1] = 0; } // exercise the (x==0 && y==0) branch, both signs of z
    if (i % 8000 === 1) { v[0] = 0; v[1] = 0; v[2] = Math.fround(-r.f32(5000) - 1); }
    wf[PARM0] = v[0]; wf[PARM0 + 1] = v[1]; wf[PARM0 + 2] = v[2];
    x.vectoangles(g);
    const w = [wf[RETURN], wf[RETURN + 1], wf[RETURN + 2]];
    const j = jsVectoangles(v).map(Math.fround);
    for (let k = 0; k < 3; k++) chk.floatEq(w[k], j[k], `vectoangles#${i}[${k}] v=${v}`);
  }
  globalThis.__results.push(chk.report());
}

const ok = globalThis.__results.every(Boolean);
process.exit(ok ? 0 : 1);
