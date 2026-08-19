// Golden parity test: ed.ts (contiguous edict field storage) vs a JS reference
// model built the way src/engine/sv.ts makeEdict actually does it -- one
// ArrayBuffer per edict, Float32Array/Int32Array VIEWS over it (the int/float
// union) -- plus the QC pointer<->entNum/fieldIdx arithmetic transliterated
// from src/engine/pr.ts (OP.storep_*/OP.load_*/OP.address).
//
// ed.ts compiles standalone (not part of index.ts/sim.wasm), so this test loads
// build/ed.wasm directly, mirroring world.test.mjs's pattern.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { rng, Check } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ED_WASM = join(HERE, '..', 'build', 'ed.wasm');

async function loadEdWasm() {
  const bytes = readFileSync(ED_WASM);
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: { abort: (msg, file, line, col) => { throw new Error(`ed.wasm abort @${line}:${col}`); } },
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

const x = await loadEdWasm();

// --- JS reference model: src/engine/sv.ts makeEdict + ed.ts clearEdict --------
// (per-edict ArrayBuffer(entityfields<<2), v_float/v_int VIEWS over it)
class JsEdictStore {
  constructor(maxEdicts, edictSizeWords) {
    this.edictSizeWords = edictSizeWords;
    this.edicts = [];
    for (let i = 0; i < maxEdicts; i++) {
      const buf = new ArrayBuffer(edictSizeWords << 2);
      this.edicts.push({ v_float: new Float32Array(buf), v_int: new Int32Array(buf) });
    }
  }
  loadInt(e, f) { return this.edicts[e].v_int[f]; }
  storeInt(e, f, v) { this.edicts[e].v_int[f] = v; }
  loadFloat(e, f) { return this.edicts[e].v_float[f]; }
  storeFloat(e, f, v) { this.edicts[e].v_float[f] = v; }
  clearEdict(e) {
    const vi = this.edicts[e].v_int;
    for (let i = 0; i < this.edictSizeWords; i++) vi[i] = 0;
  }
}

// pr.ts QC-pointer arithmetic, transliterated verbatim:
//   entNum   = Math.floor(ptr / state.edict_size)                 (pr.ts:992/995)
//   fieldIdx = ((ptr % state.edict_size) - 96) >> 2                (pr.ts:992/996)
//   ptr      = entNum * state.edict_size + 96 + (fieldIdx << 2)    (pr.ts:1005, OP.address)
const HEADER_BYTES = 96;
function jsPtrToEntNum(ptr, edictSizeBytesQC) { return Math.floor(ptr / edictSizeBytesQC); }
function jsPtrToFieldIdx(ptr, edictSizeBytesQC) { return ((ptr % edictSizeBytesQC) - HEADER_BYTES) >> 2; }
function jsEntFieldToPtr(entNum, fieldIdx, edictSizeBytesQC) { return entNum * edictSizeBytesQC + HEADER_BYTES + (fieldIdx << 2); }

// f32 bit-pattern helpers (raw int/float reinterpret cross-check)
const f32box = new Float32Array(1);
const i32box = new Int32Array(f32box.buffer);
function floatBitsOf(f) { f32box[0] = f; return i32box[0]; }
function intBitsAsFloat(i) { i32box[0] = i; return f32box[0]; }

const results = [];

// === Test config: several (maxEdicts, edictSizeWords) shapes, matching real
// progs.dat scale (Quake ~100 entityfields, AD/large mods can run a few hundred) ==
const SHAPES = [
  { maxEdicts: 32, edictSizeWords: 40, seed: 0xED1 },
  { maxEdicts: 256, edictSizeWords: 105, seed: 0xED2 },   // ~vanilla entvars_t size
  { maxEdicts: 64, edictSizeWords: 320, seed: 0xED3 },    // AD-scale mod entityfields
];

for (const { maxEdicts, edictSizeWords, seed } of SHAPES) {
  const label = `${maxEdicts}x${edictSizeWords}`;
  x.initEdicts(maxEdicts, edictSizeWords);
  const js = new JsEdictStore(maxEdicts, edictSizeWords);
  const r = rng(seed);

  // (a) round-trip thousands of random int/float writes/reads, bit-exact,
  //     including raw int/float reinterpret cross-checks (store one, read the
  //     other's accessor, compare bit patterns).
  const chkInt = new Check(`${label}.int`);
  const chkFloat = new Check(`${label}.float`);
  const chkCross = new Check(`${label}.reinterpret`);

  for (let iter = 0; iter < 20000; iter++) {
    const e = r.int(maxEdicts);
    const f = r.int(edictSizeWords);
    // NOTE: mode is drawn from the HIGH bits of a fresh u32, not r.int(4) (low-bit
    // mod-4 of this LCG at a fixed per-iteration stride collapses onto 1-2
    // residues -- a classic LCG low-bit-periodicity artifact, not a real dependency
    // between rng() calls; verified separately against wasm-sim/harness/lib.mjs).
    const mode = r.u32() >>> 30;

    if (mode === 0) {
      // int store/load
      const v = (r.u32() | 0);
      x.edStoreInt(e, f, v);
      js.storeInt(e, f, v);
      chkInt.intEq(x.edLoadInt(e, f), js.loadInt(e, f), `int#${iter} e=${e} f=${f}`);
    } else if (mode === 1) {
      // float store/load
      const v = r.f32(5000);
      x.edStoreFloat(e, f, v);
      js.storeFloat(e, f, v);
      chkFloat.floatEq(x.edLoadFloat(e, f), js.loadFloat(e, f), `float#${iter} e=${e} f=${f}`);
    } else if (mode === 2) {
      // store float, read raw int back -- must match the JS buffer's bit pattern
      const v = r.f32(5000);
      x.edStoreFloat(e, f, v);
      js.storeFloat(e, f, v);
      chkCross.intEq(x.edLoadInt(e, f), js.loadInt(e, f), `f->i#${iter} e=${e} f=${f}`);
      chkCross.intEq(x.edLoadInt(e, f), floatBitsOf(v), `f->i(direct)#${iter} e=${e} f=${f}`);
    } else {
      // store int, read raw float back -- must match the JS buffer's reinterpret
      const v = (r.u32() | 0);
      x.edStoreInt(e, f, v);
      js.storeInt(e, f, v);
      chkCross.floatEq(x.edLoadFloat(e, f), js.loadFloat(e, f), `i->f#${iter} e=${e} f=${f}`);
      chkCross.floatEq(x.edLoadFloat(e, f), intBitsAsFloat(v), `i->f(direct)#${iter} e=${e} f=${f}`);
    }
  }
  results.push(chkInt.report(), chkFloat.report(), chkCross.report());

  // Whole-buffer sweep: every (entNum, fieldIdx) still matches after thousands
  // of scattered writes above (catches any base/stride miscalculation).
  const chkSweep = new Check(`${label}.sweep`);
  for (let e = 0; e < maxEdicts; e++) {
    for (let f = 0; f < edictSizeWords; f++) {
      chkSweep.intEq(x.edLoadInt(e, f), js.loadInt(e, f), `sweep e=${e} f=${f}`);
    }
  }
  results.push(chkSweep.report());

  // (b) QC pointer arithmetic: random pointers -> entNum/fieldIdx exactly match
  // the JS floor/% expressions; and entNum/fieldIdx -> pointer round-trips.
  const chkPtr = new Check(`${label}.ptr`);
  const edictSizeBytesQC = x.getEdictSizeBytesQC();
  for (let iter = 0; iter < 20000; iter++) {
    // realistic domain: valid QC pointers are non-negative (entNum*edict_size + 96 + fieldOfs*4)
    const e = r.int(maxEdicts);
    const f = r.int(edictSizeWords);
    const ptr = jsEntFieldToPtr(e, f, edictSizeBytesQC);

    chkPtr.intEq(x.ptrToEntNum(ptr), jsPtrToEntNum(ptr, edictSizeBytesQC), `ptr->ent#${iter} ptr=${ptr}`);
    chkPtr.intEq(x.ptrToFieldIdx(ptr), jsPtrToFieldIdx(ptr, edictSizeBytesQC), `ptr->fld#${iter} ptr=${ptr}`);
    chkPtr.intEq(x.entFieldToPtr(e, f), jsEntFieldToPtr(e, f, edictSizeBytesQC), `ent+fld->ptr#${iter} e=${e} f=${f}`);

    // round-trip: entNum/fieldIdx -> ptr -> entNum/fieldIdx recovers the originals
    chkPtr.intEq(x.ptrToEntNum(x.entFieldToPtr(e, f)), e, `roundtrip.ent#${iter}`);
    chkPtr.intEq(x.ptrToFieldIdx(x.entFieldToPtr(e, f)), f, `roundtrip.fld#${iter}`);
  }
  // also sweep raw random ptr values across the whole valid range (not just ones
  // constructed from an (e,f) pair) to exercise every byte offset's %/floor path
  for (let iter = 0; iter < 20000; iter++) {
    const ptr = r.int(maxEdicts * edictSizeBytesQC);
    chkPtr.intEq(x.ptrToEntNum(ptr), jsPtrToEntNum(ptr, edictSizeBytesQC), `rawptr->ent#${iter} ptr=${ptr}`);
    chkPtr.intEq(x.ptrToFieldIdx(ptr), jsPtrToFieldIdx(ptr, edictSizeBytesQC), `rawptr->fld#${iter} ptr=${ptr}`);
  }
  results.push(chkPtr.report());

  // (c) clearEdict zeroes correctly: fill with garbage, clear, verify all zero
  // (both WASM's own storage and the JS reference, plus neighboring edicts
  // untouched).
  const chkClear = new Check(`${label}.clear`);
  for (let trial = 0; trial < 20; trial++) {
    const e = r.int(maxEdicts);
    const neighbor = (e + 1) % maxEdicts;
    for (let f = 0; f < edictSizeWords; f++) {
      const v = (r.u32() | 0) || 1; // avoid accidental zero so clear is a real change
      x.edStoreInt(e, f, v);
      js.storeInt(e, f, v);
      x.edStoreInt(neighbor, f, v ^ 0x5a5a5a5a);
      js.storeInt(neighbor, f, v ^ 0x5a5a5a5a);
    }
    x.clearEdict(e);
    js.clearEdict(e);
    for (let f = 0; f < edictSizeWords; f++) {
      chkClear.intEq(x.edLoadInt(e, f), 0, `clear#${trial} e=${e} f=${f}`);
      chkClear.intEq(x.edLoadInt(e, f), js.loadInt(e, f), `clear.vs-js#${trial} e=${e} f=${f}`);
      // neighbor must be untouched by clearing e
      chkClear.intEq(x.edLoadInt(neighbor, f), js.loadInt(neighbor, f), `clear.neighbor#${trial} e=${e} f=${f}`);
    }
  }
  results.push(chkClear.report());
}

const ok = results.every(Boolean);
process.exit(ok ? 0 : 1);
