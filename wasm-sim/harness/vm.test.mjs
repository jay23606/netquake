// Golden parity test: assembly/vm.ts (full QC interpreter) vs src/engine/pr.ts
// executeProgram/enterFunction/leaveFunction semantics, transliterated inline.
//
// Loads build/vm.wasm directly (vm.ts is compiled standalone, not part of
// sim.wasm/index.ts) and supplies the host-import stubs documented in vm.ts
// (callBuiltin, stringsEqual, stringIsEmpty, edictLoadInt/StoreInt,
// isServerLoading, hostError) via small in-memory mocks that mirror the real
// pr.ts data shapes (a string-code-heap array, per-edict Int32Array field
// storage) closely enough to drive real programs through them.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { rng, Check } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// vm.ts now binds edict/string ops to ed.ts/strings.ts at COMPILE time, so this
// test drives the unified sim.wasm (which exports ed's initEdicts/edStoreInt/
// edLoadInt + strings' newString/... that vm actually reads/writes) rather than
// mocking those imports. Only callBuiltin/isServerLoading/hostError stay host stubs.
const WASM_PATH = join(HERE, '..', 'build', 'sim.wasm');

// --- Op table (must match assembly/vm.ts / src/engine/pr.ts OP exactly) -----
const OP = {
  done: 0, mul_f: 1, mul_v: 2, mul_fv: 3, mul_vf: 4, div_f: 5,
  add_f: 6, add_v: 7, sub_f: 8, sub_v: 9,
  eq_f: 10, eq_v: 11, eq_s: 12, eq_e: 13, eq_fnc: 14,
  ne_f: 15, ne_v: 16, ne_s: 17, ne_e: 18, ne_fnc: 19,
  le: 20, ge: 21, lt: 22, gt: 23,
  load_f: 24, load_v: 25, load_s: 26, load_ent: 27, load_fld: 28, load_fnc: 29,
  address: 30,
  store_f: 31, store_v: 32, store_s: 33, store_ent: 34, store_fld: 35, store_fnc: 36,
  storep_f: 37, storep_v: 38, storep_s: 39, storep_ent: 40, storep_fld: 41, storep_fnc: 42,
  ret: 43,
  not_f: 44, not_v: 45, not_s: 46, not_ent: 47, not_fnc: 48,
  jnz: 49, jz: 50,
  call0: 51, call1: 52, call2: 53,
  state: 60, jump: 61, and: 62, or: 63, bitand: 64, bitor: 65,
};

// --- Host mocks ---------------------------------------------------------
// Edict field storage: NUM_EDICTS entities x FIELDS_PER_EDICT int32 words,
// mirroring pr.ts edict.v_int (one Int32Array of raw bits per edict).
const NUM_EDICTS = 8;
const FIELDS_PER_EDICT = 48;
const EDICT_SIZE_BYTES = 96 + FIELDS_PER_EDICT * 4; // matches pr.ts edict_size formula
const edictI = new Int32Array(NUM_EDICTS * FIELDS_PER_EDICT);
const edictWord = (ent, field) => ent * FIELDS_PER_EDICT + field;

// Strings live in the REAL wasm heap now (vm calls strings.ts stringsEqual/
// stringIsEmpty directly). The reference tracks each wasm offset's content, so
// it computes the same result without the offsets having to match anything.
// QC compareStrings = full-string content equality; two distinct offsets with
// equal content compare equal (matches strContent lookup).
const strContent = new Map(); // wasm offset -> the string it holds
function refStrEq(a, b) { return a === b || strContent.get(a) === strContent.get(b); }
function refStrEmpty(ofs) { return (strContent.get(ofs) || '') === ''; }

let svLoading = false;
const hostErrors = [];

const __imports = {
  env: {
    abort: (msg, file, line, col) => { throw new Error(`wasm abort @${line}:${col}`); },
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
  },
  // vm's REMAINING host imports (edict/string ops are now compiled in from ed/strings).
  vm: {
    callBuiltin: (_n) => {},
    isServerLoading: () => svLoading,
    hostError: (code) => { hostErrors.push(code); },
  },
  // strings.ts float formatters (present for instantiation; ftos/vtos aren't exercised here).
  strings: {
    host_tostring: (v, outPtr) => writeAscii(outPtr, v.toString()),
    host_tofixed1: (v, outPtr) => writeAscii(outPtr, v.toFixed(1)),
  },
  // host.ts builtin-dispatch host imports (present for instantiation; this test's
  // programs never call a builtin, so none of these fire).
  host: new Proxy({}, { get: () => () => 0 }),
};
// Stub any other host-import namespace a future module may add (e.g. builtins_move's
// host_random) — sim.wasm carries every module's imports; this test fires none of them.
const { instance } = await WebAssembly.instantiate(readFileSync(WASM_PATH),
  new Proxy(__imports, { get: (t, k) => (k in t ? t[k] : new Proxy({}, { get: () => () => 0 })), has: () => true }));
const x = instance.exports;
function writeAscii(outPtr, s) { const u8 = new Uint8Array(x.memory.buffer, outPtr, s.length); for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i) & 0xff; return s.length; }
x.setEdictSize(EDICT_SIZE_BYTES);   // vm's QC-pointer edict_size (bytes)
x.setNumFunctions(2000);
x.initEdicts(NUM_EDICTS, FIELDS_PER_EDICT); // ed's field block; heap.alloc may grow memory

// Views created AFTER initEdicts (heap.alloc can grow → detach the buffer).
const G = x.globalsPtr();
const wf = new Float32Array(x.memory.buffer, G, 8192);
const wi = new Int32Array(x.memory.buffer, G, 8192);

// Seed an edict field into the REAL ed store (+ mirror to the reference array).
function edSet(ent, field, bits) { x.edStoreInt(ent, field, bits | 0); edictI[edictWord(ent, field)] = bits | 0; }
// Create a string in the REAL wasm heap (via strings.ts) and track its content.
function wasmNewString(s) {
  const u8 = new Uint8Array(x.memory.buffer, x.scratchPtr(), x.maxScratch());
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i) & 0xff;
  const ofs = x.newString(s.length, s.length + 1);
  strContent.set(ofs, s);
  return ofs;
}
// JS reference globals: one buffer aliased by both views, exactly like pr.ts
// state.globals / globals_float / globals_int.
const refBuf = new ArrayBuffer(8192 * 4);
const rf = new Float32Array(refBuf);
const ri = new Int32Array(refBuf);

const r = rng(0xC0FFEE);
let nextStmt = 0;
let nextFn = 1; // function 0 is reserved/invalid, like pr.ts

function installTinyFn(op, a, b, c) {
  const fn = nextFn++;
  const s = nextStmt; nextStmt += 2;
  x.installStatement(s, op, a, b, c);
  x.installStatement(s + 1, OP.done, 0, 0, 0);
  x.installFunction(fn, s, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  return fn;
}

function seedF(indices, opts = {}) {
  const { forceEqualPairs = [], forceZero = [] } = opts;
  for (const i of indices) {
    const v = r.f32(2000);
    wf[i] = v; rf[i] = v;
  }
  for (const [a, b] of forceEqualPairs) {
    if (r.int(4) === 0) { wf[b] = wf[a]; rf[b] = rf[a]; }
  }
  for (const i of forceZero) {
    if (r.int(6) === 0) { wf[i] = 0; rf[i] = 0; }
  }
}

function seedI(indices, opts = {}) {
  const { forceEqualPairs = [], forceZero = [] } = opts;
  for (const i of indices) {
    const v = r.u32() | 0;
    wi[i] = v; ri[i] = v;
  }
  for (const [a, b] of forceEqualPairs) {
    if (r.int(4) === 0) { wi[b] = wi[a]; ri[b] = ri[a]; }
  }
  for (const i of forceZero) {
    if (r.int(6) === 0) { wi[i] = 0; ri[i] = 0; }
  }
}

function runFn(fn) {
  x.resetVm();
  x.execute(fn);
}

const results = [];
function record(chk) { results.push(chk.report()); }

// ============================================================================
// Section 1: pure float arithmetic / compare / logical opcodes
// ============================================================================
{
  const A = 40, B = 50, C = 60;
  const CASES = 20000;
  const floatOps = [
    ['add_f', OP.add_f, (a, b, c) => { rf[c] = rf[a] + rf[b]; }, 1, false],
    ['add_v', OP.add_v, (a, b, c) => { rf[c] = rf[a] + rf[b]; rf[c+1] = rf[a+1] + rf[b+1]; rf[c+2] = rf[a+2] + rf[b+2]; }, 3, false],
    ['sub_f', OP.sub_f, (a, b, c) => { rf[c] = rf[a] - rf[b]; }, 1, false],
    ['sub_v', OP.sub_v, (a, b, c) => { rf[c] = rf[a] - rf[b]; rf[c+1] = rf[a+1] - rf[b+1]; rf[c+2] = rf[a+2] - rf[b+2]; }, 3, false],
    ['mul_f', OP.mul_f, (a, b, c) => { rf[c] = rf[a] * rf[b]; }, 1, false],
    ['mul_v', OP.mul_v, (a, b, c) => { rf[c] = rf[a]*rf[b] + rf[a+1]*rf[b+1] + rf[a+2]*rf[b+2]; }, 1, false],
    ['mul_fv', OP.mul_fv, (a, b, c) => { rf[c] = rf[a]*rf[b]; rf[c+1] = rf[a]*rf[b+1]; rf[c+2] = rf[a]*rf[b+2]; }, 3, false],
    ['mul_vf', OP.mul_vf, (a, b, c) => { rf[c] = rf[b]*rf[a]; rf[c+1] = rf[b]*rf[a+1]; rf[c+2] = rf[b]*rf[a+2]; }, 3, false],
    ['div_f', OP.div_f, (a, b, c) => { rf[c] = rf[a] / rf[b]; }, 1, false],
    ['bitand', OP.bitand, (a, b, c) => { rf[c] = rf[a] & rf[b]; }, 1, false],
    ['bitor', OP.bitor, (a, b, c) => { rf[c] = rf[a] | rf[b]; }, 1, false],
    ['ge', OP.ge, (a, b, c) => { rf[c] = (rf[a] >= rf[b]) ? 1 : 0; }, 1, false],
    ['le', OP.le, (a, b, c) => { rf[c] = (rf[a] <= rf[b]) ? 1 : 0; }, 1, false],
    ['gt', OP.gt, (a, b, c) => { rf[c] = (rf[a] > rf[b]) ? 1 : 0; }, 1, false],
    ['lt', OP.lt, (a, b, c) => { rf[c] = (rf[a] < rf[b]) ? 1 : 0; }, 1, false],
    ['and', OP.and, (a, b, c) => { rf[c] = ((rf[a] !== 0) && (rf[b] !== 0)) ? 1 : 0; }, 1, false],
    ['or', OP.or, (a, b, c) => { rf[c] = ((rf[a] !== 0) || (rf[b] !== 0)) ? 1 : 0; }, 1, false],
    ['eq_f', OP.eq_f, (a, b, c) => { rf[c] = (rf[a] === rf[b]) ? 1 : 0; }, 1, false],
    ['ne_f', OP.ne_f, (a, b, c) => { rf[c] = (rf[a] !== rf[b]) ? 1 : 0; }, 1, false],
    ['eq_v', OP.eq_v, (a, b, c) => { rf[c] = (rf[a]===rf[b] && rf[a+1]===rf[b+1] && rf[a+2]===rf[b+2]) ? 1 : 0; }, 1, false],
    ['ne_v', OP.ne_v, (a, b, c) => { rf[c] = (rf[a]!==rf[b] || rf[a+1]!==rf[b+1] || rf[a+2]!==rf[b+2]) ? 1 : 0; }, 1, false],
    ['not_f', OP.not_f, (a, _b, c) => { rf[c] = (rf[a] === 0) ? 1 : 0; }, 1, true],
    ['not_v', OP.not_v, (a, _b, c) => { rf[c] = (rf[a]===0 && rf[a+1]===0 && rf[a+2]===0) ? 1 : 0; }, 1, true],
  ];

  for (const [name, op, jsRef, outN, unary] of floatOps) {
    const fn = installTinyFn(op, A, B, C);
    const chk = new Check(`vm.${name}`);
    for (let i = 0; i < CASES; i++) {
      seedF([A, A+1, A+2, B, B+1, B+2], {
        forceEqualPairs: unary ? [] : [[A, B]],
        forceZero: [A, B],
      });
      runFn(fn);
      jsRef(A, B, C);
      for (let k = 0; k < outN; k++) chk.floatEq(wf[C+k], rf[C+k], `${name}#${i}[${k}]`);
    }
    record(chk);
  }
}

// ============================================================================
// Section 2: raw-int-identity opcodes (eq_e/ne_e/eq_fnc/ne_fnc/not_ent/not_fnc)
// ============================================================================
{
  const A = 140, B = 150, C = 160;
  const CASES = 15000;
  const intOps = [
    ['eq_e', OP.eq_e, (a, b, c) => { rf[c] = (ri[a] === ri[b]) ? 1 : 0; }, false],
    ['ne_e', OP.ne_e, (a, b, c) => { rf[c] = (ri[a] !== ri[b]) ? 1 : 0; }, false],
    ['eq_fnc', OP.eq_fnc, (a, b, c) => { rf[c] = (ri[a] === ri[b]) ? 1 : 0; }, false],
    ['ne_fnc', OP.ne_fnc, (a, b, c) => { rf[c] = (ri[a] !== ri[b]) ? 1 : 0; }, false],
    ['not_ent', OP.not_ent, (a, _b, c) => { rf[c] = (ri[a] === 0) ? 1 : 0; }, true],
    ['not_fnc', OP.not_fnc, (a, _b, c) => { rf[c] = (ri[a] === 0) ? 1 : 0; }, true],
  ];
  for (const [name, op, jsRef, unary] of intOps) {
    const fn = installTinyFn(op, A, B, C);
    const chk = new Check(`vm.${name}`);
    for (let i = 0; i < CASES; i++) {
      seedI([A, B], { forceEqualPairs: unary ? [] : [[A, B]], forceZero: [A, B] });
      runFn(fn);
      jsRef(A, B, C);
      chk.floatEq(wf[C], rf[C], `${name}#${i}`);
    }
    record(chk);
  }
}

// ============================================================================
// Section 3: string opcodes (eq_s / ne_s / not_s) via the string-heap mock
// ============================================================================
{
  const pool = ['', 'a', 'foo', 'foo', 'Foo', 'weapon_rocketlauncher', 'x'.repeat(40), 'trigger_multiple', '0', 'nextmap'];
  const poolOfs = pool.map(wasmNewString);
  const A = 240, B = 250, C = 260;
  const CASES = 8000;

  {
    const fnEq = installTinyFn(OP.eq_s, A, B, C);
    const chk = new Check('vm.eq_s');
    for (let i = 0; i < CASES; i++) {
      const ia = r.int(pool.length), ib = (r.int(4) === 0) ? ia : r.int(pool.length);
      wi[A] = ri[A] = poolOfs[ia];
      wi[B] = ri[B] = poolOfs[ib];
      runFn(fnEq);
      rf[C] = refStrEq(ri[A], ri[B]) ? 1 : 0;
      chk.floatEq(wf[C], rf[C], `eq_s#${i}`);
    }
    record(chk);
  }
  {
    const fnNe = installTinyFn(OP.ne_s, A, B, C);
    const chk = new Check('vm.ne_s');
    for (let i = 0; i < CASES; i++) {
      const ia = r.int(pool.length), ib = (r.int(4) === 0) ? ia : r.int(pool.length);
      wi[A] = ri[A] = poolOfs[ia];
      wi[B] = ri[B] = poolOfs[ib];
      runFn(fnNe);
      rf[C] = refStrEq(ri[A], ri[B]) ? 0 : 1;
      chk.floatEq(wf[C], rf[C], `ne_s#${i}`);
    }
    record(chk);
  }
  {
    const fnNot = installTinyFn(OP.not_s, A, B, C);
    const chk = new Check('vm.not_s');
    for (let i = 0; i < CASES; i++) {
      // occasionally test the "null string pointer" (0) path too
      const ia = (r.int(8) === 0) ? -1 : r.int(pool.length);
      const ptr = ia === -1 ? 0 : poolOfs[ia];
      wi[A] = ri[A] = ptr;
      runFn(fnNot);
      rf[C] = ptr !== 0 ? (refStrEmpty(ptr) ? 1 : 0) : 1;
      chk.floatEq(wf[C], rf[C], `not_s#${i}`);
    }
    record(chk);
  }
}

// ============================================================================
// Section 4: global<->global STORE_* (pure int copy, no host) opcodes
// ============================================================================
{
  const A = 340, B = 350;
  const CASES = 10000;
  const storeOps = [
    ['store_f', OP.store_f, 1], ['store_ent', OP.store_ent, 1], ['store_fld', OP.store_fld, 1],
    ['store_s', OP.store_s, 1], ['store_fnc', OP.store_fnc, 1], ['store_v', OP.store_v, 3],
  ];
  for (const [name, op, width] of storeOps) {
    const fn = installTinyFn(op, A, B, 0);
    const chk = new Check(`vm.${name}`);
    for (let i = 0; i < CASES; i++) {
      seedI([A, A+1, A+2]);
      runFn(fn);
      ri[B] = ri[A]; if (width === 3) { ri[B+1] = ri[A+1]; ri[B+2] = ri[A+2]; }
      chk.intEq(wi[B], ri[B], `${name}#${i}[0]`);
      if (width === 3) { chk.intEq(wi[B+1], ri[B+1], `${name}#${i}[1]`); chk.intEq(wi[B+2], ri[B+2], `${name}#${i}[2]`); }
    }
    record(chk);
  }
}

// ============================================================================
// Section 5: ADDRESS / LOAD_* / STOREP_* opcodes, backed by the mock edict store
// ============================================================================
{
  const CASES = 10000;

  // -- ADDRESS: ptr = entNum*edict_size + 96 + (fieldOfs<<2) --
  {
    const A = 440, B = 441, C = 442; // a=entNum, b=field word-offset, c=result ptr
    const fn = installTinyFn(OP.address, A, B, C);
    const chk = new Check('vm.address');
    for (let i = 0; i < CASES; i++) {
      const entNum = 1 + r.int(NUM_EDICTS - 1); // avoid world entity (0) here; guard tested separately below
      const fieldOfs = r.int(FIELDS_PER_EDICT - 3);
      wi[A] = entNum; wi[B] = fieldOfs;
      runFn(fn);
      const expect = entNum * EDICT_SIZE_BYTES + 96 + (fieldOfs << 2);
      chk.intEq(wi[C], expect, `address#${i}`);
    }
    record(chk);

    // world-entity guard: entNum===0 && !loading must trap and NOT write c
    svLoading = false;
    wi[A] = 0; wi[B] = 3; wi[C] = 0x7fffffff;
    const before = hostErrors.length;
    runFn(fn);
    const guardChk = new Check('vm.address.world-guard');
    guardChk.intEq(hostErrors.length > before ? 7 : -1, 7, 'ERR_WORLD_ASSIGN raised');
    guardChk.intEq(wi[C], 0x7fffffff, 'c left untouched');
    record(guardChk);

    // entNum===0 while loading must succeed normally
    svLoading = true;
    wi[A] = 0; wi[B] = 5;
    runFn(fn);
    const loadOkChk = new Check('vm.address.world-while-loading');
    loadOkChk.intEq(wi[C], 0 * EDICT_SIZE_BYTES + 96 + (5 << 2), 'address computed while loading');
    record(loadOkChk);
    svLoading = false;
  }

  // -- LOAD_F/FLD/ENT/S/FNC and LOAD_V --
  {
    const A = 450, B = 451, C = 452;
    const scalarOps = ['load_f', 'load_fld', 'load_ent', 'load_s', 'load_fnc'];
    for (const name of scalarOps) {
      const fn = installTinyFn(OP[name], A, B, C);
      const chk = new Check(`vm.${name}`);
      for (let i = 0; i < CASES; i++) {
        const ent = r.int(NUM_EDICTS), field = r.int(FIELDS_PER_EDICT);
        edSet(ent, field, r.u32());
        wi[A] = ent; wi[B] = field;
        runFn(fn);
        chk.intEq(wi[C], edictI[edictWord(ent, field)], `${name}#${i}`);
      }
      record(chk);
    }
    const fnV = installTinyFn(OP.load_v, A, B, C);
    const chkV = new Check('vm.load_v');
    for (let i = 0; i < CASES; i++) {
      const ent = r.int(NUM_EDICTS), field = r.int(FIELDS_PER_EDICT - 3);
      for (let k = 0; k < 3; k++) edSet(ent, field + k, r.u32());
      wi[A] = ent; wi[B] = field;
      runFn(fnV);
      for (let k = 0; k < 3; k++) chkV.intEq(wi[C+k], edictI[edictWord(ent, field + k)], `load_v#${i}[${k}]`);
    }
    record(chkV);
  }

  // -- STOREP_F/ENT/FLD/S/FNC and STOREP_V (address resolved via the same formula) --
  {
    const A = 460, B = 470; // a=payload (3 words for storep_v), b=flat ptr -- kept apart so A+2 never aliases B
    const scalarOps = ['storep_f', 'storep_ent', 'storep_fld', 'storep_s', 'storep_fnc'];
    for (const name of scalarOps) {
      const fn = installTinyFn(OP[name], A, B, 0);
      const chk = new Check(`vm.${name}`);
      for (let i = 0; i < CASES; i++) {
        const ent = r.int(NUM_EDICTS), field = r.int(FIELDS_PER_EDICT);
        const ptr = ent * EDICT_SIZE_BYTES + 96 + (field << 2);
        const payload = r.u32() | 0;
        wi[A] = payload; wi[B] = ptr;
        runFn(fn);
        chk.intEq(x.edLoadInt(ent, field), payload, `${name}#${i}`);
      }
      record(chk);
    }
    const fnV = installTinyFn(OP.storep_v, A, B, 0);
    const chkV = new Check('vm.storep_v');
    for (let i = 0; i < CASES; i++) {
      const ent = r.int(NUM_EDICTS), field = r.int(FIELDS_PER_EDICT - 3);
      const ptr = ent * EDICT_SIZE_BYTES + 96 + (field << 2);
      wi[B] = ptr;
      const payload = [r.u32() | 0, r.u32() | 0, r.u32() | 0];
      wi[A] = payload[0]; wi[A+1] = payload[1]; wi[A+2] = payload[2];
      runFn(fnV);
      for (let k = 0; k < 3; k++) chkV.intEq(x.edLoadInt(ent, field + k), payload[k], `storep_v#${i}[${k}]`);
    }
    record(chkV);
  }
}

// ============================================================================
// Section 6: OP.state
// ============================================================================
{
  const GLOBAL_SELF = 28, GLOBAL_TIME = 31;
  const A = 560, B = 561; // a=frame value (raw float bits), b=think function index
  const fn = installTinyFn(OP.state, A, B, 0);
  const chk = new Check('vm.state');
  const CASES = 6000;
  for (let i = 0; i < CASES; i++) {
    const ent = r.int(NUM_EDICTS);
    const time = r.f32(1000);
    const frameVal = r.f32(300);
    const thinkFn = r.u32() | 0;
    wi[GLOBAL_SELF] = ent;
    wf[GLOBAL_TIME] = time;
    wf[A] = frameVal;
    wi[B] = thinkFn;
    runFn(fn);

    const FIELD_FRAME = 30, FIELD_THINK = 44, FIELD_NEXTTHINK = 46;
    const expectNextthink = Math.fround(time + 0.1);
    const gotNextthink = new Float32Array(new Int32Array([x.edLoadInt(ent, FIELD_NEXTTHINK)]).buffer)[0];
    chk.floatEq(gotNextthink, expectNextthink, `state.nextthink#${i}`);
    chk.intEq(x.edLoadInt(ent, FIELD_FRAME), wi[A], `state.frame#${i}`);
    chk.intEq(x.edLoadInt(ent, FIELD_THINK), thinkFn, `state.think#${i}`);
  }
  record(chk);
}

// ============================================================================
// Section 7: control flow — IF/IFNOT/GOTO branch selection (fuzzed)
// ============================================================================
{
  // select(x): if (x) c = 1.0 else c = 2.0   -- exercises OP.jnz + OP.jump + OP.jz-style fallthrough
  const X = 660, ONE = 661, TWO = 662, C = 663;
  const s1 = nextStmt; nextStmt += 5;
  x.installStatement(s1 + 0, OP.jnz, X, 3, 0);        // if(x) -> s1+3 (nonzero store)
  x.installStatement(s1 + 1, OP.store_f, TWO, C, 0);  // zero path: C = 2
  x.installStatement(s1 + 2, OP.jump, 2, 0, 0);        // -> s1+4 (DONE), skip the nonzero store
  x.installStatement(s1 + 3, OP.store_f, ONE, C, 0);  // nonzero path: C = 1
  x.installStatement(s1 + 4, OP.done, 0, 0, 0);
  const fnSelectId = nextFn++;
  x.installFunction(fnSelectId, s1, 0, 0, 0, 0,0,0,0,0,0,0,0);

  wf[ONE] = 1; wf[TWO] = 2;
  const chk = new Check('vm.controlflow.select(jnz/jump/jz)');
  const CASES = 12000;
  for (let i = 0; i < CASES; i++) {
    const isZero = r.int(3) === 0;
    const v = isZero ? 0 : r.f32(500) || 1; // avoid accidental 0 on the "nonzero" branch
    wf[X] = v;
    runFn(fnSelectId);
    const expect = (wi[X] !== 0) ? 1 : 2; // OP.jnz branches on raw int bits, like pr.ts
    chk.floatEq(wf[C], expect, `select#${i} x=${v}`);
  }
  record(chk);
}

// ============================================================================
// Section 8: control flow — recursive CALL/RET + locals save/restore (sumTo)
// ============================================================================
{
  // QC-equivalent:
  //   float sumTo(float n) { if (!n) return 0; return n + sumTo(n - 1); }
  // parm_start=700 (n lives at global 700, the function's one local), locals=1,
  // numparms=1, parm_size=[1,...]. Recursion forces enterFunction/leaveFunction
  // to push/pop the SAME global slot (700) via the localstack on every call —
  // exactly what validates the localstack save/restore logic.
  const N = 700;           // local: n (also parm0's landing slot)
  const R = 800;           // scratch: accumulator (write-then-immediately-RET, no hazard)
  const TMP = 801;         // scratch: n-1
  const ZERO = 802, ONE = 803;
  const SELF_FN = 804;     // holds this function's own index (as an int "function" value)

  const s = nextStmt; nextStmt += 8;
  // s+0: JZ n -> s+6 (base case)
  x.installStatement(s + 0, OP.jz, N, 6, 0);
  // s+1: TMP = n - 1
  x.installStatement(s + 1, OP.sub_f, N, ONE, TMP);
  // s+2: parm0(global 4) = TMP
  x.installStatement(s + 2, OP.store_f, TMP, 4, 0);
  // s+3: CALL1 sumTo(TMP)
  x.installStatement(s + 3, OP.call1, SELF_FN, 0, 0);
  // s+4: R = n + retval(global 1)
  x.installStatement(s + 4, OP.add_f, N, 1, R);
  // s+5: JUMP -> s+7 (RET)
  x.installStatement(s + 5, OP.jump, 2, 0, 0);
  // s+6 (base case): R = 0
  x.installStatement(s + 6, OP.store_f, ZERO, R, 0);
  // s+7: RET R
  x.installStatement(s + 7, OP.ret, R, 0, 0);

  const fnSumTo = nextFn++;
  x.installFunction(fnSumTo, s, N, 1 /*locals*/, 1 /*numparms*/, 1,0,0,0,0,0,0,0);
  x.writeGlobalInt(SELF_FN, fnSumTo);
  x.writeGlobalFloat(ZERO, 0);
  x.writeGlobalFloat(ONE, 1);

  const chk = new Check('vm.controlflow.recursive-call-return(sumTo)');
  const CASES = 3000;
  for (let i = 0; i < CASES; i++) {
    const n = r.int(13); // 0..12 -> recursion depth n, well under MAX_DEPTH(64)
    // Matches real QC calling convention: enterFunction ALWAYS copies parm_start.. from
    // the fixed PARM0+ globals (4+), even for this top-level (non-OP.call) invocation --
    // so the caller (here, the test) must stage the argument at global 4, not at N(700)
    // directly (pr.ts pf.ts/sv.ts callers always do this before PR_ExecuteProgram).
    x.writeGlobalFloat(4, n);
    x.resetVm();
    x.execute(fnSumTo);
    const expect = (n * (n + 1)) / 2;
    chk.floatEq(x.readGlobalFloat(1), Math.fround(expect), `sumTo(${n})#${i}`);
    chk.intEq(x.getDepth(), 0, `sumTo(${n})#${i} depth-unwound`);
  }
  record(chk);
}

// ============================================================================
// Section 9: control flow — non-recursive CALL2 with vector params (marshaling)
// ============================================================================
{
  // vaddCallee(v1, v2) { return v1 + v2; }  -- numparms=2, parm_size=[3,3]
  const P = 900; // parm_start / locals region: [0..2]=v1, [3..5]=v2
  const RES = 950;
  const sc = nextStmt; nextStmt += 2;
  x.installStatement(sc + 0, OP.add_v, P, P + 3, RES);
  x.installStatement(sc + 1, OP.ret, RES, 0, 0);
  const fnCallee = nextFn++;
  x.installFunction(fnCallee, sc, P, 6, 2, 3, 3, 0,0,0,0,0,0);

  // caller: parm0 = v1 (globals 4,5,6), parm1 = v2 (globals 7,8,9); CALL2; RET retval
  const V1 = 960, V2 = 963, CALLEE_FN = 970, OUT = 980;
  const scaller = nextStmt; nextStmt += 6;
  x.installStatement(scaller + 0, OP.store_v, V1, 4, 0);
  x.installStatement(scaller + 1, OP.store_v, V2, 7, 0);
  x.installStatement(scaller + 2, OP.call2, CALLEE_FN, 0, 0);
  x.installStatement(scaller + 3, OP.store_v, 1, OUT, 0); // copy retval(1,2,3) -> OUT
  x.installStatement(scaller + 4, OP.ret, OUT, 0, 0);
  x.installStatement(scaller + 5, OP.done, 0, 0, 0);
  const fnCaller = nextFn++;
  x.installFunction(fnCaller, scaller, 0, 0, 0, 0,0,0,0,0,0,0,0);
  x.writeGlobalInt(CALLEE_FN, fnCallee);

  const chk = new Check('vm.controlflow.call2-vector-marshaling');
  const CASES = 5000;
  for (let i = 0; i < CASES; i++) {
    const v1 = [r.f32(500), r.f32(500), r.f32(500)];
    const v2 = [r.f32(500), r.f32(500), r.f32(500)];
    for (let k = 0; k < 3; k++) { x.writeGlobalFloat(V1 + k, v1[k]); x.writeGlobalFloat(V2 + k, v2[k]); }
    x.resetVm();
    x.execute(fnCaller);
    for (let k = 0; k < 3; k++) {
      const expect = v1[k] + v2[k]; // f64 add of two f32s, rounded once on store (parity rule)
      chk.floatEq(x.readGlobalFloat(OUT + k), Math.fround(expect), `vadd#${i}[${k}]`);
    }
    chk.intEq(x.getDepth(), 0, `vadd#${i} depth-unwound`);
  }
  record(chk);
}

process.exit(results.every(Boolean) ? 0 : 1);
