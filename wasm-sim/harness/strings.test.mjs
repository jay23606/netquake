// Golden parity test: assembly/strings.ts (QC string heap + ftos/vtos) vs
// src/engine/pr.ts (getString/compareStrings/newString/tempString) and
// src/engine/pf.ts (#26 ftos / #27 vtos), transliterated inline.
//
// strings.ts compiles standalone (not part of index.ts/sim.wasm), so this test
// loads build/strings.wasm directly instead of using lib.mjs's loadWasm(). It
// supplies the `host_tostring`/`host_tofixed1` host imports strings.ts declares
// for ftos/vtos (see that file's header comment for why formatting is a host
// service, not a native-AS port): the mocks below just run the real V8
// Number#toString()/toFixed(1) and poke the resulting ASCII bytes into wasm
// memory, exactly like a real embedder would.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { rng, Check } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = join(HERE, '..', 'build', 'strings.wasm');

const WASM_BYTES = readFileSync(WASM_PATH);

// Each test section gets its OWN fresh module instance (heapTop/stringTemp are
// module-private mutable state with no reset export -- a shared instance would
// desync wasm offsets from a section's freshly-constructed JsHeap reference).
let mem = null; // rebound per instance; host imports only fire during later
                 // exported-function calls, so this is always populated in time.
function writeAsciiAt(outPtr, s) {
  const u8 = new Uint8Array(mem.buffer, outPtr, s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i) & 0xff;
  return s.length;
}

async function newInstance() {
  const { instance } = await WebAssembly.instantiate(WASM_BYTES, {
    env: { abort: (msg, file, line, col) => { throw new Error(`strings.wasm abort @${line}:${col}`); } },
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
    strings: {
      host_tostring: (v, outPtr) => writeAsciiAt(outPtr, v.toString()),
      host_tofixed1: (v, outPtr) => writeAsciiAt(outPtr, v.toFixed(1)),
    },
  });
  mem = instance.exports.memory;
  return instance.exports;
}

let x = await newInstance();

// --- JS reference: transliterated from src/engine/pr.ts / pf.ts -----------------
// Plain-array string heap mirroring pr.ts state.strings (number[]).
class JsHeap {
  constructor() { this.strings = []; this.string_temp = 0; }
  getString(num) {
    const out = [];
    for (; num < this.strings.length; ++num) {
      if (this.strings[num] === 0) break;
      out.push(String.fromCharCode(this.strings[num]));
    }
    return out.join('');
  }
  compareStrings(a, b) {
    if (a === b) return true;
    const s = this.strings;
    for (;;) {
      const ca = s[a++] || 0, cb = s[b++] || 0;
      if (ca !== cb) return false;
      if (ca === 0) return true;
    }
  }
  stringIsEmpty(ofs) { return (this.strings[ofs] || 0) === 0; }
  newString(s, length) {
    const ofs = this.strings.length;
    let i;
    if (s.length >= length) {
      for (i = 0; i < length - 1; ++i) this.strings[this.strings.length] = s.charCodeAt(i);
      this.strings[this.strings.length] = 0;
      return ofs;
    }
    for (i = 0; i < s.length; ++i) this.strings[this.strings.length] = s.charCodeAt(i);
    length -= s.length;
    for (i = 0; i < length; ++i) this.strings[this.strings.length] = 0;
    return ofs;
  }
  tempString(str) {
    if (str.length > 127) str = str.substring(0, 127);
    for (let i = 0; i < str.length; ++i) this.strings[this.string_temp + i] = str.charCodeAt(i);
    this.strings[this.string_temp + str.length] = 0;
  }
  initStringTemp() { this.string_temp = this.newString('', 128); return this.string_temp; }
  ftos(v) {
    if (v === Math.floor(v)) this.tempString(v.toString());
    else this.tempString(v.toFixed(1));
    return this.string_temp;
  }
  vtos(vx, vy, vz) {
    this.tempString(vx.toFixed(1) + ' ' + vy.toFixed(1) + ' ' + vz.toFixed(1));
    return this.string_temp;
  }
}

// --- wasm-side helpers ------------------------------------------------------------
function wasmScratchWrite(bytesOrStr) {
  const bytes = typeof bytesOrStr === 'string'
    ? Array.from(bytesOrStr, (c) => c.charCodeAt(0) & 0xff)
    : bytesOrStr;
  const u8 = new Uint8Array(mem.buffer, x.scratchPtr(), x.maxScratch());
  for (let i = 0; i < bytes.length; i++) u8[i] = bytes[i];
  return bytes.length;
}

function wasmNewString(s, length) {
  const srcLen = wasmScratchWrite(s);
  return x.newString(srcLen, length);
}

function wasmTempString(s) {
  const srcLen = wasmScratchWrite(s);
  x.tempString(srcLen);
}

function wasmReadString(ofs) {
  const len = x.readStringToScratch(ofs, x.maxScratch());
  const u8 = new Uint8Array(mem.buffer, x.scratchPtr(), len);
  let out = '';
  for (let i = 0; i < len; i++) out += String.fromCharCode(u8[i]);
  return out;
}

const results = [];

// === Test 1: newString / getString / tempString round-trip, random ASCII =======
{
  const chk = new Check('newString/getString round-trip');
  const chkLen = new Check('newString minLength padding/truncation');
  const jsHeap = new JsHeap();
  const r = rng(0xA5CD11);
  const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 _.,!?-';

  for (let iter = 0; iter < 4000; iter++) {
    const len = r.int(200);
    let s = '';
    for (let i = 0; i < len; i++) s += CHARS[r.int(CHARS.length)];
    const minLength = 1 + r.int(220); // exercises both s.length>=length and <length branches

    const jOfs = jsHeap.newString(s, minLength);
    const wOfs = wasmNewString(s, minLength);
    chk.intEq(wOfs, jOfs, `iter${iter} ofs`);

    const jBack = jsHeap.getString(jOfs);
    const wBack = wasmReadString(wOfs);
    chkLen.intEq(wBack === jBack ? 1 : 0, 1, `iter${iter} content "${wBack}" vs "${jBack}"`);
  }
  results.push(chk.report(), chkLen.report());
}

// === Test 2: compareStrings / stringIsEmpty, random string pairs (incl. shared
// prefixes, equal strings, empty strings) =========================================
{
  x = await newInstance();
  const chk = new Check('compareStrings');
  const chkEmpty = new Check('stringIsEmpty');
  const jsHeap = new JsHeap();
  const r = rng(0xF00D5);
  const CHARS = 'abcXYZ012 !';
  const offsets = [];

  for (let i = 0; i < 500; i++) {
    const len = r.int(12); // includes 0 -> empty strings
    let s = '';
    for (let j = 0; j < len; j++) s += CHARS[r.int(CHARS.length)];
    const jOfs = jsHeap.newString(s, s.length + 1);
    const wOfs = wasmNewString(s, s.length + 1);
    if (jOfs !== wOfs) throw new Error('offset desync in setup');
    offsets.push(jOfs);
  }
  // duplicate a few offsets so a===b (identity fast-path) gets exercised too
  offsets.push(offsets[3], offsets[10]);

  for (let iter = 0; iter < 8000; iter++) {
    const a = offsets[r.int(offsets.length)];
    const b = offsets[r.int(offsets.length)];
    chk.intEq(x.stringsEqual(a, b) ? 1 : 0, jsHeap.compareStrings(a, b) ? 1 : 0, `iter${iter} a=${a} b=${b}`);
  }
  for (const ofs of offsets) {
    chkEmpty.intEq(x.stringIsEmpty(ofs) ? 1 : 0, jsHeap.stringIsEmpty(ofs) ? 1 : 0, `ofs=${ofs}`);
  }
  results.push(chk.report(), chkEmpty.report());
}

// === Test 3: ftos (#26) -- thousands of deterministic-random floats ==============
{
  x = await newInstance();
  const chk = new Check('ftos byte-exact');
  const jsHeap = new JsHeap();
  jsHeap.initStringTemp();
  x.initStringTemp();
  const r = rng(0xF705);

  const values = [];
  // Integers (exact and near-boundary), across magnitudes.
  for (let i = 0; i < 500; i++) values.push(Math.fround(r.int(2) === 0 ? r.int(2000000) - 1000000 : r.int(20000) - 10000));
  values.push(0, -0, 1, -1, 100, -100, 1000000, -1000000);
  // Fractional f32s across the "normal QC" range, deliberately re-quantized to f32
  // (Math.fround) since that's what globals_float actually holds.
  for (let i = 0; i < 4000; i++) values.push(r.f32(2000));
  for (let i = 0; i < 2000; i++) values.push(r.f32(0.01));   // tiny
  for (let i = 0; i < 2000; i++) values.push(r.f32(1e8));    // huge
  for (let i = 0; i < 2000; i++) values.push(r.f32(1e30));   // near f32 range extreme
  // Values landing exactly on a .x5 tenths boundary (toFixed tie-breaking stress).
  for (let i = 0; i < 1000; i++) values.push(Math.fround((r.int(20000) - 10000) / 20 + 0.05));

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    const jOfs = jsHeap.ftos(v);
    const wOfs = x.ftos(v);
    chk.intEq(wOfs === jOfs ? 1 : 0, 1, `ftos#${i} v=${v} ofs w=${wOfs} j=${jOfs}`);
    const jStr = jsHeap.getString(jOfs);
    const wStr = wasmReadString(wOfs);
    if (wStr !== jStr) {
      chk.fails++; chk.n++;
      if (chk.samples.length < 8) chk.samples.push(`ftos#${i} v=${v} wasm="${wStr}" js="${jStr}"`);
    } else { chk.n++; }
  }
  results.push(chk.report());
}

// === Test 4: vtos (#27) -- thousands of deterministic-random float triples =======
{
  x = await newInstance();
  const chk = new Check('vtos byte-exact');
  const jsHeap = new JsHeap();
  jsHeap.initStringTemp();
  x.initStringTemp();
  const r = rng(0x705705);

  for (let i = 0; i < 6000; i++) {
    let vx, vy, vz;
    const mode = r.int(4);
    if (mode === 0) { vx = r.f32(4000); vy = r.f32(4000); vz = r.f32(4000); }
    else if (mode === 1) { vx = Math.fround(r.int(4000) - 2000); vy = Math.fround(r.int(4000) - 2000); vz = Math.fround(r.int(4000) - 2000); }
    else if (mode === 2) { vx = r.f32(0.05); vy = r.f32(0.05); vz = r.f32(0.05); }
    else { vx = 0; vy = -0; vz = r.f32(100000); }

    const jOfs = jsHeap.vtos(vx, vy, vz);
    const wOfs = x.vtos(vx, vy, vz);
    chk.intEq(wOfs === jOfs ? 1 : 0, 1, `vtos#${i} ofs`);
    const jStr = jsHeap.getString(jOfs);
    const wStr = wasmReadString(wOfs);
    if (wStr !== jStr) {
      chk.fails++; chk.n++;
      if (chk.samples.length < 8) chk.samples.push(`vtos#${i} v=(${vx},${vy},${vz}) wasm="${wStr}" js="${jStr}"`);
    } else { chk.n++; }
  }
  results.push(chk.report());
}

// === Test 5: sanity -- tempString truncation at 127 chars =========================
{
  x = await newInstance();
  const chk = new Check('tempString 127-char truncation');
  const jsHeap = new JsHeap();
  jsHeap.initStringTemp();
  x.initStringTemp();
  const long = 'x'.repeat(200) + 'END';
  jsHeap.tempString(long);
  wasmTempString(long);
  const jStr = jsHeap.getString(jsHeap.string_temp);
  const wStr = wasmReadString(x.stringTempOfs());
  chk.intEq(wStr === jStr ? 1 : 0, 1, `truncated content len wasm=${wStr.length} js=${jStr.length}`);
  results.push(chk.report());
}

const ok = results.every(Boolean);
process.exit(ok ? 0 : 1);
