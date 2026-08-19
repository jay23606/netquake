// Golden parity test: builtins_edict.ts (pf_spawn, pf_remove, pf_find,
// pf_findradius, pf_nextent, and the ED_Alloc/ED_Free machinery they build on)
// vs the JS reference in src/engine/pf.ts / src/engine/ed.ts / src/engine/sv.ts,
// transliterated inline below — same self-contained-golden-test convention as
// builtins_world.test.mjs.
//
// builtins_edict.ts re-exports svmove.ts's (and, through it, ed.ts's/world.ts's)
// entire surface, so this test loads build/builtins_edict.wasm directly and gets
// every loader (initEdicts/initAreaTree/linkEdict/edStoreFloat/edLoadInt/
// setEdictFree/isEdictFree/...) plus the pf_* builtins, edAlloc/edFree, the
// entity-state setup exports, and the GLOBALS accessors on one exports object.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { rng, Check } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = join(HERE, '..', 'build', 'builtins_edict.wasm');

async function loadWasm() {
  const bytes = readFileSync(WASM_PATH);
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: { abort: (msg, file, line, col) => { throw new Error(`builtins_edict.wasm abort @${line}:${col}`); } },
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

// Exact f64 checker (freetime is never f32-quantized on either side).
Check.prototype.floatEqStrict = function (w, j, ctx = '') {
  this.n++;
  if (!Object.is(w, j)) { this.fails++; if (this.samples.length < 5) this.samples.push(`${ctx} wasm=${w} js=${j}`); }
};

function wSetF(idx, v) { x.writeGlobalFloat(idx, Math.fround(v)); }
function wGetF(idx) { return x.readGlobalFloat(idx); }
function wSetI(idx, v) { x.writeGlobalInt(idx, v); }
function wGetI(idx) { return x.readGlobalInt(idx); }

// ================================================================================
// JS reference model (src/engine/pf.ts / src/engine/ed.ts / src/engine/sv.ts,
// transliterated)
// ================================================================================

const PARM0 = 4, PARM1 = 7, PARM2 = 10, RETURN = 1;

// --- entvars field indices (src/engine/pr.ts entvars, vanilla layout) ---------
const F = {
  SOLID: 9, ORIGIN: 10, ORIGIN1: 11, ORIGIN2: 12,
  ANGLES: 19, ANGLES1: 20, ANGLES2: 21,
  CLASSNAME: 28, MODEL: 29, FRAME: 30, SKIN: 31,
  MINS: 33, MINS1: 34, MINS2: 35, MAXS: 36, MAXS1: 37, MAXS2: 38,
  NEXTTHINK: 46, TAKEDAMAGE: 59, CHAIN: 60, COLORMAP: 77, MODELINDEX: 0,
};
const EDICT_SIZE_WORDS = 100;
const SOLID_NOT = 0, SOLID_BBOX = 2, SOLID_SLIDEBOX = 3;
// Section A's alloc/free churn needs headroom: num_edicts is a monotonic
// high-water mark (ED_Alloc's grow branch never reuses a slot until its freetime
// clears the reuse rule -- see that section's header note), so worst case a long
// spawn-heavy run can rack up thousands of never-yet-reusable slots well before
// any given edict number is ever reused. 20000 gives ample headroom under
// def.max_edicts-style caps without ever exercising ED_Alloc's fatal
// "no free edicts" abort (out of scope -- see builtins_edict.ts header).
const MAX_EDICTS = 20000;
const WORLD_MINS = [-2048, -2048, -2048], WORLD_MAXS = [2048, 2048, 2048];

// isEdictFree/setEdictFree/unlinkEdict (edAlloc/edFree/pf_find/pf_findradius/
// pf_nextent all touch these) live in svmove.ts's own per-edict storage, which is
// allocated by initAreaTree (NOT initEdicts, NOR initEntState -- see ed.ts/
// svmove.ts/builtins_edict.ts header notes on who owns what). Every section below
// must call this after initEdicts, mirroring builtins_world.test.mjs's own setup
// order, even though this test never calls linkEdict/move.
function initWorldForEntState() {
  x.initAreaTree(WORLD_MINS[0], WORLD_MINS[1], WORLD_MINS[2], WORLD_MAXS[0], WORLD_MAXS[1], WORLD_MAXS[2], MAX_EDICTS);
}

// Float32Array-backed field storage (automatic f32 quantization) + free/freetime
// side arrays (Edict.free/Edict.freetime, sv.ts makeEdict), mirroring JsEdicts
// from builtins_world.test.mjs plus the two fields that module didn't need.
class JsEdicts {
  constructor(n) {
    this.n = n;
    this.vf = []; this.vi = [];
    for (let i = 0; i < n; i++) {
      const buf = new ArrayBuffer(EDICT_SIZE_WORDS * 4);
      this.vf.push(new Float32Array(buf));
      this.vi.push(new Int32Array(buf));
    }
    this.free = new Array(n).fill(false);
    this.freetime = new Array(n).fill(0.0);
  }
  f(e, idx) { return this.vf[e][idx]; }
  setf(e, idx, v) { this.vf[e][idx] = v; }
  i(e, idx) { return this.vi[e][idx]; }
  seti(e, idx, v) { this.vi[e][idx] = v; }
}

// --- src/engine/ed.ts clearEdict, transliterated --------------------------------
function jsClearEdict(edicts, e) {
  for (let i = 0; i < EDICT_SIZE_WORDS; i++) edicts.vi[e][i] = 0;
  edicts.free[e] = false;
}

// --- src/engine/ed.ts alloc, transliterated (state = { num_edicts, maxclients,
// time } passed explicitly rather than through sv.state/pr.state singletons) ----
function jsEdAlloc(edicts, state) {
  for (let i = state.maxclients + 1; i < state.num_edicts; i++) {
    if (edicts.free[i] === true && (edicts.freetime[i] < 2.0 || (state.time - edicts.freetime[i]) > 0.5)) {
      jsClearEdict(edicts, i);
      return i;
    }
  }
  if (state.num_edicts >= MAX_EDICTS) throw new Error('ED.Alloc: no free edicts');
  const e = state.num_edicts++;
  jsClearEdict(edicts, e);
  return e;
}

// --- src/engine/ed.ts free, transliterated (sv.unlinkEdict has no observable
// effect on the field/free-flag/freetime state this test checks, since the JS
// reference doesn't model the area-link list at all here -- WASM's edFree does
// call svmove's real unlinkEdict, which is a no-op on an edict that was never
// linked, or safely relinks-out one that was; parity is on the FIELDS below). ---
function jsEdFree(edicts, state, e) {
  edicts.free[e] = true;
  edicts.seti(e, F.MODEL, 0);
  edicts.setf(e, F.TAKEDAMAGE, 0.0);
  edicts.setf(e, F.MODELINDEX, 0.0);
  edicts.setf(e, F.COLORMAP, 0.0);
  edicts.setf(e, F.SKIN, 0.0);
  edicts.setf(e, F.FRAME, 0.0);
  edicts.setf(e, F.ORIGIN, 0.0); edicts.setf(e, F.ORIGIN1, 0.0); edicts.setf(e, F.ORIGIN2, 0.0);
  edicts.setf(e, F.ANGLES, 0.0); edicts.setf(e, F.ANGLES1, 0.0); edicts.setf(e, F.ANGLES2, 0.0);
  edicts.setf(e, F.NEXTTHINK, -1.0);
  edicts.setf(e, F.SOLID, 0.0);
  edicts.freetime[e] = state.time;
}

// --- src/engine/pr.ts compareStrings, transliterated over a byte-string heap ---
function jsCompareStrings(strings, a, b) {
  if (a === b) return true;
  let pa = a, pb = b;
  for (;;) {
    const ca = strings[pa++] || 0;
    const cb = strings[pb++] || 0;
    if (ca !== cb) return false;
    if (ca === 0) return true;
  }
}

// --- pf.ts builtins, transliterated ---------------------------------------------
function jsSpawn(edicts, state) { return jsEdAlloc(edicts, state); }
function jsRemove(edicts, state, e) { jsEdFree(edicts, state, e); }
function jsFind(edicts, state, strings, start, f, s) {
  for (let e = start + 1; e < state.num_edicts; e++) {
    if (edicts.free[e] === true) continue;
    if (jsCompareStrings(strings, edicts.i(e, f), s)) return e;
  }
  return 0;
}
function jsFindRadius(edicts, state, org, rad) {
  let chain = 0;
  for (let i = 1; i < state.num_edicts; i++) {
    if (edicts.free[i] === true) continue;
    if ((edicts.f(i, F.SOLID) | 0) === SOLID_NOT) continue;
    const ex = org[0] - (edicts.f(i, F.ORIGIN) + (edicts.f(i, F.MINS) + edicts.f(i, F.MAXS)) * 0.5);
    const ey = org[1] - (edicts.f(i, F.ORIGIN1) + (edicts.f(i, F.MINS1) + edicts.f(i, F.MAXS1)) * 0.5);
    const ez = org[2] - (edicts.f(i, F.ORIGIN2) + (edicts.f(i, F.MINS2) + edicts.f(i, F.MAXS2)) * 0.5);
    if (Math.sqrt(ex * ex + ey * ey + ez * ez) > rad) continue;
    edicts.seti(i, F.CHAIN, chain);
    chain = i;
  }
  return chain;
}
function jsNextEnt(edicts, state, start) {
  for (let i = start + 1; i < state.num_edicts; i++) {
    if (edicts.free[i] !== true) return i;
  }
  return 0;
}

// ================================================================================
// Fixtures + wasm wiring
// ================================================================================
function setEntityBoth(edicts, e, ox, oy, oz, hx, hy, hz, solid, chainStr) {
  edicts.setf(e, F.ORIGIN, ox); edicts.setf(e, F.ORIGIN1, oy); edicts.setf(e, F.ORIGIN2, oz);
  edicts.setf(e, F.MINS, -hx); edicts.setf(e, F.MINS1, -hy); edicts.setf(e, F.MINS2, -hz);
  edicts.setf(e, F.MAXS, hx); edicts.setf(e, F.MAXS1, hy); edicts.setf(e, F.MAXS2, hz);
  edicts.setf(e, F.SOLID, solid);
  edicts.seti(e, F.CLASSNAME, chainStr);

  x.edStoreFloat(e, F.ORIGIN, ox); x.edStoreFloat(e, F.ORIGIN1, oy); x.edStoreFloat(e, F.ORIGIN2, oz);
  x.edStoreFloat(e, F.MINS, -hx); x.edStoreFloat(e, F.MINS1, -hy); x.edStoreFloat(e, F.MINS2, -hz);
  x.edStoreFloat(e, F.MAXS, hx); x.edStoreFloat(e, F.MAXS1, hy); x.edStoreFloat(e, F.MAXS2, hz);
  x.edStoreFloat(e, F.SOLID, solid);
  x.edStoreInt(e, F.CLASSNAME, chainStr);
}

const results = [];

// === Section A: ED_Alloc reuse rule + growth, thousands of alloc()/free() calls
// interleaved (mirrors ED_Alloc's own free-list scan + the <2.0s / >0.5s reuse
// timing rule, and ED_Alloc's grow-past-num_edicts path). ========================
{
  const r = rng(0xED1C01);
  x.initEdicts(MAX_EDICTS, EDICT_SIZE_WORDS);
  initWorldForEntState();
  const edicts = new JsEdicts(MAX_EDICTS);
  const MAXCLIENTS = 4;
  const state = { num_edicts: MAXCLIENTS + 1, maxclients: MAXCLIENTS, time: 0.0 };
  x.initEntState(MAXCLIENTS, state.num_edicts);
  // edict 0 (world) and 1..maxclients (players) always start non-free -- matches
  // sv.ts spawnServer's ensureEdict loop (makeEdict defaults free=false).
  for (let i = 0; i <= MAXCLIENTS; i++) { edicts.free[i] = false; x.markFree(i, 0, 0.0); }

  const chk = { num: new Check('edAlloc.returnedNum'), state: new Check('edAlloc/edFree.state'), fld: new Check('edAlloc/edFree.fields') };
  const live = new Set();
  for (let i = 1; i <= MAXCLIENTS; i++) live.add(i);

  for (let trial = 0; trial < 30000; trial++) {
    // advance time occasionally (both models in lockstep) so the <2.0/>0.5s reuse
    // window gets genuinely exercised (not just always-past or always-within).
    if (r.int(3) === 0) {
      state.time += r.int(2) === 0 ? (r.int(100) / 100) : (0.4 + r.int(50) / 100); // small or >0.4 steps
      x.setServerTime(state.time);
    }

    if (r.int(2) === 0 || live.size === 0) {
      // spawn
      wSetI(RETURN, -1); // sentinel, overwritten by pf_spawn
      x.pf_spawn(g);
      const w = wGetI(RETURN);
      const j = jsSpawn(edicts, state);
      chk.num.intEq(w, j, `trial#${trial} spawn`);
      chk.state.intEq(x.getNumEdicts(), state.num_edicts, `trial#${trial} num_edicts after spawn`);
      live.add(j);
      // spawned edict must read free=false on both sides, and every field zeroed.
      chk.fld.intEq(x.isEdictFree(j), edicts.free[j] ? 1 : 0, `trial#${trial} spawn free-flag e=${j}`);
      for (const f of [F.SOLID, F.ORIGIN, F.CLASSNAME, F.CHAIN, F.NEXTTHINK]) {
        chk.fld.intEq(x.edLoadInt(j, f), edicts.i(j, f), `trial#${trial} spawn cleared field f=${f} e=${j}`);
      }
      // give it some non-zero state so a later free()/realloc() cycle is meaningful
      setEntityBoth(edicts, j, r.f32(300), r.f32(300), r.f32(300), 5, 5, 5, SOLID_BBOX, 0);
    } else {
      // remove a random live non-client edict (never target the world/clients)
      const candidates = [...live].filter((e) => e > MAXCLIENTS);
      if (candidates.length === 0) continue;
      const e = candidates[r.int(candidates.length)];
      live.delete(e);
      wSetI(PARM0, e);
      x.pf_remove(g);
      jsRemove(edicts, state, e);
      chk.fld.intEq(x.isEdictFree(e), edicts.free[e] ? 1 : 0, `trial#${trial} remove free-flag e=${e}`);
      for (const f of [F.MODEL, F.TAKEDAMAGE, F.MODELINDEX, F.COLORMAP, F.SKIN, F.FRAME,
        F.ORIGIN, F.ORIGIN1, F.ORIGIN2, F.ANGLES, F.ANGLES1, F.ANGLES2, F.NEXTTHINK, F.SOLID]) {
        chk.fld.intEq(x.edLoadInt(e, f), edicts.i(e, f), `trial#${trial} remove field f=${f} e=${e}`);
      }
      chk.state.floatEqStrict(x.getFreetime(e), edicts.freetime[e], `trial#${trial} freetime e=${e}`);
    }
  }
  results.push(chk.num.report(), chk.state.report(), chk.fld.report());
}

// === Section B: pf_find -- a population with random classname-like string-field
// values (a handful of repeated string offsets so genuine matches occur), find()
// chained from every possible start point. ======================================
{
  const r = rng(0xED1C02);
  x.initEdicts(MAX_EDICTS, EDICT_SIZE_WORDS);
  initWorldForEntState();
  const edicts = new JsEdicts(MAX_EDICTS);
  const MAXCLIENTS = 2;
  const state = { num_edicts: 40, maxclients: MAXCLIENTS, time: 0.0 };
  x.initEntState(MAXCLIENTS, state.num_edicts);
  for (let i = 0; i < state.num_edicts; i++) { edicts.free[i] = false; x.markFree(i, 0, 0.0); }

  // Small string "heap": a few distinct strings at fixed byte offsets, shared by
  // both sides (WASM classname field just stores an int offset into this same
  // conceptual heap -- stringsEqual/compareStrings walk bytes, and both sides use
  // an IDENTICAL byte layout below via a shared JS array poked into wasm memory
  // through x.edStoreInt only for the offset -- the actual byte comparison inside
  // wasm reads strings.ts's OWN heap, so the fixture must place the same bytes
  // there too).
  const STR_TABLE = ['player', 'monster_army', 'door', 'trigger_once', 'weapon_supershotgun', ''];
  // Layout: place each string (with NUL) sequentially starting at offset 16 (clear
  // of strings.ts's built-in string_temp region, which newString(0,128) claims
  // starting at 0) via newString-equivalent direct memory writes. We use the
  // module's own newString via scratch to guarantee identical semantics/offsets.
  x.initStringTemp();
  const strOfs = STR_TABLE.map((s) => {
    const bytes = new TextEncoder().encode(s);
    const scratch = x.scratchPtr();
    const mem = new Uint8Array(x.memory.buffer, scratch, bytes.length);
    mem.set(bytes);
    return x.newString(bytes.length, bytes.length + 1);
  });
  // Mirror the exact same byte layout in a plain JS array heap for the reference.
  const jsStrings = [];
  for (let k = 0; k < STR_TABLE.length; k++) {
    const bytes = new TextEncoder().encode(STR_TABLE[k]);
    while (jsStrings.length < strOfs[k]) jsStrings.push(0);
    for (const b of bytes) jsStrings.push(b);
    jsStrings.push(0);
  }

  const NUM_ENTS = 35;
  for (let e = MAXCLIENTS + 1; e < state.num_edicts; e++) {
    const which = r.int(STR_TABLE.length);
    setEntityBoth(edicts, e, r.f32(200), r.f32(200), r.f32(200), 5, 5, 5, SOLID_BBOX, strOfs[which]);
    if (r.int(6) === 0) { edicts.free[e] = true; x.markFree(e, 1, 0.0); }
  }

  const chk = new Check('find.RETURN');
  for (let iter = 0; iter < 20000; iter++) {
    const start = r.int(state.num_edicts + 2) - 1; // includes -1 (start of range) and a couple past-end
    const target = strOfs[r.int(STR_TABLE.length)];
    wSetI(PARM0, start); wSetI(PARM1, F.CLASSNAME); wSetI(PARM2, target);
    x.pf_find(g);
    const w = wGetI(RETURN);
    const j = jsFind(edicts, state, jsStrings, start, F.CLASSNAME, target);
    chk.intEq(w, j, `find#${iter} start=${start} target=${target}`);
  }
  results.push(chk.report());
}

// === Section C: pf_findradius -- linked-free population (chain field write +
// RETURN), thousands of random origin/radius queries. ===========================
{
  const r = rng(0xED1C03);
  x.initEdicts(MAX_EDICTS, EDICT_SIZE_WORDS);
  initWorldForEntState();
  const edicts = new JsEdicts(MAX_EDICTS);
  const MAXCLIENTS = 2;
  const state = { num_edicts: 70, maxclients: MAXCLIENTS, time: 0.0 };
  x.initEntState(MAXCLIENTS, state.num_edicts);
  for (let i = 0; i < state.num_edicts; i++) { edicts.free[i] = false; x.markFree(i, 0, 0.0); }

  for (let e = MAXCLIENTS + 1; e < state.num_edicts; e++) {
    const solidRoll = r.int(6);
    const solid = solidRoll === 0 ? SOLID_NOT : (solidRoll < 3 ? SOLID_BBOX : SOLID_SLIDEBOX);
    setEntityBoth(edicts, e, r.f32(400), r.f32(400), r.f32(400),
      Math.abs(r.f32(30)) + 2, Math.abs(r.f32(30)) + 2, Math.abs(r.f32(30)) + 2, solid, 0);
    if (r.int(8) === 0) { edicts.free[e] = true; x.markFree(e, 1, 0.0); }
  }

  const chk = { ret: new Check('findradius.RETURN'), chain: new Check('findradius.chainFields') };
  for (let iter = 0; iter < 20000; iter++) {
    const org = [r.f32(400), r.f32(400), r.f32(400)];
    const rad = Math.abs(r.f32(400));
    wSetF(PARM0, org[0]); wSetF(PARM0 + 1, org[1]); wSetF(PARM0 + 2, org[2]);
    wSetF(PARM1, rad);
    x.pf_findradius(g);
    const w = wGetI(RETURN);
    const j = jsFindRadius(edicts, state, org, rad);
    chk.ret.intEq(w, j, `fr#${iter} org=${org} rad=${rad}`);
    for (let e = MAXCLIENTS + 1; e < state.num_edicts; e++) {
      chk.chain.intEq(x.edLoadInt(e, F.CHAIN), edicts.i(e, F.CHAIN), `fr#${iter} chain e=${e}`);
    }
  }
  results.push(chk.ret.report(), chk.chain.report());
}

// === Section D: pf_nextent -- iterate every start point over a population with
// scattered free gaps. ===========================================================
{
  const r = rng(0xED1C04);
  x.initEdicts(MAX_EDICTS, EDICT_SIZE_WORDS);
  initWorldForEntState();
  const edicts = new JsEdicts(MAX_EDICTS);
  const MAXCLIENTS = 3;
  const state = { num_edicts: 50, maxclients: MAXCLIENTS, time: 0.0 };
  x.initEntState(MAXCLIENTS, state.num_edicts);
  for (let i = 0; i < state.num_edicts; i++) {
    const free = i > MAXCLIENTS && r.int(4) === 0;
    edicts.free[i] = free;
    x.markFree(i, free ? 1 : 0, 0.0);
  }

  const chk = new Check('nextent.RETURN');
  for (let start = -1; start < state.num_edicts + 3; start++) {
    wSetI(PARM0, start);
    x.pf_nextent(g);
    const w = wGetI(RETURN);
    const j = jsNextEnt(edicts, state, start);
    chk.intEq(w, j, `nextent start=${start}`);
  }
  results.push(chk.report());
}

const ok = results.every(Boolean);
process.exit(ok ? 0 : 1);
