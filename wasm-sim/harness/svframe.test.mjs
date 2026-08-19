// Golden parity test: assembly/svframe.ts (SV_RunThink + SV_Physics per-frame
// orchestration) vs a JS reference transliterated from src/engine/sv.ts,
// executing REAL id1 progs.dat think functions through the SAME builtin-free
// eligibility-filtered differential technique as progs_smoke.test.mjs (whose
// JS reference interpreter this test reuses verbatim for QC execution), plus
// the world/link/motion JS reference from svphysics.test.mjs (self-contained
// duplication -- same project convention every *.test.mjs here follows).
//
// Sections:
//   A. Single-frame differential: many random entity fixtures across every
//      dispatched movetype (NONE/NOCLIP/STEP/TOSS/BOUNCE/FLY/FLYMISSILE),
//      varied origin/velocity/gravity/nextthink, thinks = real builtin-free
//      zero-arg id1 QC functions selected via the eligibility filter. Compares
//      the FULL globals array + every touched edict field, bit-exact.
//   B. Multi-frame differential: the same fixture generator, run for several
//      CONSECUTIVE frames (not just one), diffed after every frame -- catches
//      cumulative-state divergence (nextthink rescheduling via OP.state, etc.)
//      that a single-frame check can't see.
//   C. num_edicts/free-flag coherence across a frame, via hand-installed
//      synthetic bytecode that calls the REAL #14 spawn / #15 remove builtins
//      from inside a think -- proves physicsFrame's loop bound is a LIVE
//      re-read of getNumEdicts() (matching sv.ts's `i < state.server.num_edicts`
//      loop condition, re-evaluated every iteration), not a value captured
//      once before the loop: a spawn from an earlier entity's think must make
//      the new edict visible to a LATER `i` in the SAME frame, and a mid-loop
//      remove must not disturb iteration of the entities after it.
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { rng, Check } from './lib.mjs';
import { loadProgs } from './progsLoader.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = join(HERE, '..', 'build', 'svframe.wasm');
const PROGS_PATH = join(HERE, '..', 'build', 'id1_progs.dat');

if (!existsSync(PROGS_PATH)) {
  console.log('[SKIP] svframe.differential: build/id1_progs.dat not found ' +
    '(run `node wasm-sim/harness/extract_progs.mjs` with id1/pak0.pak present).');
  process.exit(0);
}

// --- Op table (assembly/vm.ts / src/engine/pr.ts OP) -----------------------
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
  call0: 51, call1: 52, call2: 53, call3: 54, call4: 55, call5: 56, call6: 57, call7: 58, call8: 59,
  state: 60, jump: 61, and: 62, or: 63, bitand: 64, bitor: 65,
};
const CALL0 = OP.call0, CALL8 = OP.call8;
const STORE_FAMILY = new Set([OP.store_f, OP.store_v, OP.store_s, OP.store_ent, OP.store_fld, OP.store_fnc]);
const LOAD_FAMILY = new Set([OP.load_f, OP.load_v, OP.load_s, OP.load_ent, OP.load_fld, OP.load_fnc]);
const STOREP_FAMILY = new Set([OP.storep_f, OP.storep_v, OP.storep_s, OP.storep_ent, OP.storep_fld, OP.storep_fnc]);
const FLOAT_BINARY = new Set([
  OP.mul_f, OP.mul_v, OP.mul_fv, OP.mul_vf, OP.div_f, OP.add_f, OP.add_v, OP.sub_f, OP.sub_v,
  OP.eq_f, OP.eq_v, OP.ne_f, OP.ne_v, OP.le, OP.ge, OP.lt, OP.gt, OP.and, OP.or, OP.bitand, OP.bitor,
]);
const FLOAT_UNARY = new Set([OP.not_f, OP.not_v]);

const GLOBAL_SELF = 28, GLOBAL_OTHER = 29, GLOBAL_TIME = 31, GLOBAL_FORCE_RETOUCH = 33;
const FIELD_FRAME = 30, FIELD_THINK = 44, FIELD_NEXTTHINK = 46;
const PARM0 = 4;

// --- entvars field indices (src/engine/pr.ts entvars, vanilla layout) ---------
const F = {
  ABSMIN: 1, ABSMIN1: 2, ABSMIN2: 3, ABSMAX: 4, ABSMAX1: 5, ABSMAX2: 6,
  MOVETYPE: 8, SOLID: 9, ORIGIN: 10, ORIGIN1: 11, ORIGIN2: 12,
  VELOCITY: 16, VELOCITY1: 17, VELOCITY2: 18,
  ANGLES: 19, ANGLES1: 20, ANGLES2: 21,
  AVELOCITY: 22, AVELOCITY1: 23, AVELOCITY2: 24,
  MODEL: 29, FRAME: 30, SKIN: 31,
  MINS: 33, MINS1: 34, MINS2: 35, MAXS: 36, MAXS1: 37, MAXS2: 38, SIZE: 39,
  THINK: 44, NEXTTHINK: 46, GROUNDENTITY: 47,
  TAKEDAMAGE: 59, FLAGS: 76, COLORMAP: 77, WATERLEVEL: 83, WATERTYPE: 84, OWNER: 95,
  GRAVITY_TEST: 90, // stand-in "gravity" field slot for the dynamic-field test cases
};
const SOLID_NOT = 0, SOLID_TRIGGER = 1, SOLID_BBOX = 2, SOLID_SLIDEBOX = 3, SOLID_BSP = 4;
const FL_FLY = 1, FL_SWIM = 2, FL_ITEM = 256, FL_ONGROUND = 512, FL_MONSTER = 32;
const MOVE_NORMAL = 0, MOVE_NOMONSTERS = 1, MOVE_MISSILE = 2;
const MT = { none: 0, step: 4, fly: 5, toss: 6, push: 7, noclip: 8, flymissile: 9, bounce: 10 };
const CONTENTS_EMPTY = -1, CONTENTS_SOLID = -2, CONTENTS_WATER = -3;

// ============================================================================
// Load progs.dat into svframe.wasm
// ============================================================================
const progsBytes = new Uint8Array(readFileSync(PROGS_PATH));
const wasmBytes = readFileSync(WASM_PATH);

const hostErrors = [];
const __imports = {
  env: { abort: (msg, file, line, col) => { throw new Error(`svframe.wasm abort @${line}:${col}`); } },
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
  vm: {
    isServerLoading: () => false,
    hostError: (code) => { hostErrors.push(code); },
  },
  strings: {
    host_tostring: (v, outPtr) => writeAscii(outPtr, v.toString()),
    host_tofixed1: (v, outPtr) => writeAscii(outPtr, v.toFixed(1)),
  },
  // Every builtin exercised in this test is either builtin-free (Sections A/B)
  // or resolves to the PURE #14/#15 spawn/remove path (Section C, which never
  // touches a host_* import) -- these never fire either way. Proxy-stub any
  // namespace (host, builtins_move, ...) so instantiation succeeds regardless.
  host: new Proxy({}, { get: () => () => 0 }),
};
const { instance } = await WebAssembly.instantiate(wasmBytes,
  new Proxy(__imports, { get: (t, k) => (k in t ? t[k] : new Proxy({}, { get: () => () => 0 })), has: () => true }));
const x = instance.exports;
let mem = x.memory;
function writeAscii(outPtr, s) {
  const u8 = new Uint8Array(mem.buffer, outPtr, s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i) & 0xff;
  return s.length;
}

const MAX_EDICTS = 400;
const parsed = loadProgs(x, progsBytes, MAX_EDICTS);
const { statements, functions, entityfields, edictSizeBytesQC, numGlobals, stringsLen } = parsed;
console.log(`[progs] version=${parsed.version} statements=${statements.length} functions=${functions.length} entityfields=${entityfields} globals=${numGlobals}`);

const globalsInitial = new Int32Array(Math.max(numGlobals, 8192));
for (let i = 0; i < numGlobals; i++) globalsInitial[i] = x.readGlobalInt(i);

const stringHeapBytes = progsBytes;
const strLumpOfs = (() => {
  const view = new DataView(progsBytes.buffer, progsBytes.byteOffset, progsBytes.byteLength);
  return view.getUint32(8 + 4 * 8, true);
})();
function heapByte(idx) {
  if (idx < 0 || idx >= stringsLen) return 0;
  return stringHeapBytes[strLumpOfs + idx];
}

const FT_VOID = 0, FT_STRING = 1, FT_FLOAT = 2, FT_VECTOR = 3, FT_ENTITY = 4, FT_FIELD = 5, FT_FUNCTION = 6;
const fieldType = new Int8Array(entityfields).fill(-1);
for (const def of parsed.fielddefs) {
  if (def.ofs >= 0 && def.ofs < entityfields) fieldType[def.ofs] = def.type;
}

// ============================================================================
// ELIGIBILITY ANALYSIS -- copied from progs_smoke.test.mjs (see that file for
// the full rationale of every step), narrowed to numparms===0 candidates at
// the end (a QC think function is `void()` -- zero args -- so runThink's
// direct `execute(fnum)` call, which stages NO parameters, is only safe for
// candidates that don't expect any; enterFunction's PARM-staging loop is
// unconditional but a no-op when numparms===0 regardless of what garbage sits
// in PARM0.., so this side-steps the parameter-seeding question entirely).
// ============================================================================
const NUMFN = functions.length;
const withStmts = [];
for (let i = 1; i < NUMFN; i++) if (functions[i].first_statement > 0) withStmts.push(i);
withStmts.sort((a, b) => functions[a].first_statement - functions[b].first_statement);
const funcEnd = new Int32Array(NUMFN);
for (let k = 0; k < withStmts.length; k++) {
  const idx = withStmts[k];
  funcEnd[idx] = (k + 1 < withStmts.length) ? functions[withStmts[k + 1]].first_statement : statements.length;
}

function parmWordsTotal(fn) { let n = 0; for (let i = 0; i < fn.numparms; i++) n += fn.parm_size[i]; return n; }
function windowHi(fn) { return fn.parm_start + Math.max(fn.locals, parmWordsTotal(fn)); }

const ROLE = { NONE: 0, FLOAT: 1, ENTITY: 2, FIELD: 3, POINTER: 4, STRING: 5, RISKY: 6 };
function mergeRole(map, inWindow, g, r) {
  if (!inWindow(g)) return;
  if (r === ROLE.RISKY) { map.set(g, ROLE.RISKY); return; }
  const cur = map.get(g) ?? ROLE.NONE;
  if (cur === ROLE.RISKY) return;
  if (cur === ROLE.NONE) { map.set(g, r); return; }
  if (cur === r) return;
  if (cur === ROLE.FLOAT && r !== ROLE.FLOAT) { map.set(g, r); return; }
  if (r === ROLE.FLOAT && cur !== ROLE.FLOAT) return;
  map.set(g, ROLE.RISKY);
}

const roles = new Array(NUMFN);
const callSites = new Array(NUMFN);
const hasBuiltinCall = new Uint8Array(NUMFN);
const hasUnknownCall = new Uint8Array(NUMFN);

for (const idx of withStmts) {
  const fn = functions[idx];
  const lo = fn.parm_start, hi = windowHi(fn);
  const inWindow = (g) => g >= lo && g < hi;
  const map = new Map();
  const sites = [];
  const s0 = fn.first_statement, s1 = funcEnd[idx];
  for (let s = s0; s < s1; s++) {
    const st = statements[s];
    const { op, a, b } = st;
    if (op === OP.address || LOAD_FAMILY.has(op)) {
      mergeRole(map, inWindow, a, ROLE.ENTITY);
      mergeRole(map, inWindow, b, ROLE.FIELD);
    } else if (STOREP_FAMILY.has(op)) {
      mergeRole(map, inWindow, b, ROLE.POINTER);
    } else if (op === OP.eq_s || op === OP.ne_s) {
      mergeRole(map, inWindow, a, ROLE.STRING);
      mergeRole(map, inWindow, b, ROLE.STRING);
    } else if (op === OP.not_s) {
      mergeRole(map, inWindow, a, ROLE.STRING);
    } else if (FLOAT_BINARY.has(op)) {
      mergeRole(map, inWindow, a, ROLE.FLOAT);
      mergeRole(map, inWindow, b, ROLE.FLOAT);
    } else if (FLOAT_UNARY.has(op)) {
      mergeRole(map, inWindow, a, ROLE.FLOAT);
    } else if (op >= CALL0 && op <= CALL8) {
      mergeRole(map, inWindow, a, ROLE.RISKY);
      const argc = op - CALL0;
      const calleeVal = globalsInitial[a];
      if (calleeVal === 0 || calleeVal < 0 || calleeVal >= NUMFN) hasUnknownCall[idx] = 1;
      else if (functions[calleeVal].first_statement < 0) hasBuiltinCall[idx] = 1;
      else sites.push({ stmtIdx: s, calleeIdx: calleeVal, argc });
    }
  }
  roles[idx] = map;
  callSites[idx] = sites;
}

function hasRisky(idx) { for (const r of roles[idx].values()) if (r === ROLE.RISKY) return true; return false; }

const unsafe = new Uint8Array(NUMFN);
for (const idx of withStmts) if (hasBuiltinCall[idx] || hasUnknownCall[idx] || hasRisky(idx)) unsafe[idx] = 1;

{
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Uint8Array(NUMFN);
  const cyclic = new Uint8Array(NUMFN);
  for (const start of withStmts) {
    if (color[start] !== WHITE) continue;
    const stack = [{ idx: start, i: 0 }];
    color[start] = GRAY;
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const edges = callSites[frame.idx];
      if (frame.i < edges.length) {
        const next = edges[frame.i++].calleeIdx;
        if (color[next] === GRAY) { for (const f of stack) cyclic[f.idx] = 1; }
        else if (color[next] === WHITE) { color[next] = GRAY; stack.push({ idx: next, i: 0 }); }
      } else { color[frame.idx] = BLACK; stack.pop(); }
    }
  }
  for (const idx of withStmts) if (cyclic[idx] && !unsafe[idx]) unsafe[idx] = 1;
}

function findRecentStoreSource(idx, beforeStmt, destGlobal) {
  const fn = functions[idx];
  for (let s = beforeStmt - 1; s >= fn.first_statement; s--) {
    const st = statements[s];
    if (st.op === OP.store_v) { if (destGlobal >= st.b && destGlobal <= st.b + 2) return st.a + (destGlobal - st.b); }
    else if (STORE_FAMILY.has(st.op)) { if (st.b === destGlobal) return st.a; }
  }
  return -1;
}

for (let round = 0; round < 8; round++) {
  let changed = false;
  for (const idx of withStmts) {
    if (unsafe[idx]) continue;
    const fn = functions[idx];
    const lo = fn.parm_start, hi = windowHi(fn);
    const inWindow = (g) => g >= lo && g < hi;
    for (const site of callSites[idx]) {
      if (unsafe[site.calleeIdx]) { unsafe[idx] = 1; changed = true; break; }
      const calleeFn = functions[site.calleeIdx];
      const calleeRoles = roles[site.calleeIdx];
      let running = 0;
      const nparms = Math.min(site.argc, calleeFn.numparms);
      for (let k = 0; k < nparms; k++) {
        const psize = calleeFn.parm_size[k];
        for (let j = 0; j < psize; j++) {
          const parmGlobal = PARM0 + k * 3 + j;
          const srcSlot = findRecentStoreSource(idx, site.stmtIdx, parmGlobal);
          if (srcSlot >= 0) {
            const calleeRole = calleeRoles.get(calleeFn.parm_start + running + j) ?? ROLE.NONE;
            if (calleeRole !== ROLE.NONE) {
              const before = roles[idx].get(srcSlot) ?? ROLE.NONE;
              mergeRole(roles[idx], inWindow, srcSlot, calleeRole);
              const after = roles[idx].get(srcSlot) ?? ROLE.NONE;
              if (after !== before) changed = true;
            }
          }
        }
        running += psize;
      }
    }
    if (!unsafe[idx] && hasRisky(idx)) { unsafe[idx] = 1; changed = true; }
  }
  if (!changed) break;
}

const eligible = withStmts.filter((idx) => !unsafe[idx]);

// Additionally exclude any candidate that writes the SOLID field (offset 9,
// via a simple same-function ADDRESS->STOREP dataflow heuristic, propagated
// through the already-resolved static call graph). This is NOT a VM-parity
// concern -- both the WASM svmove.ts port and this test's JS jsClipToLinks
// reference carry the SAME vanilla invariant (`sys.error('Trigger in
// clipping list')` / svmove.ts's `unreachable()`) for an entity that becomes
// SOLID_TRIGGER (or SOLID_BSP, whose hull table is out of this port's scope)
// while still linked in the solid_edicts list, which real vanilla Quake ALSO
// treats as fatal. Since this test drives arbitrary builtin-free zero-arg
// functions as thinks (out of their real gameplay context), a function that
// happens to reassign `.solid` can construct that fatal scenario by accident
// -- excluding solid-writers keeps every fixture "well-formed" the same way
// svmove.ts's own header already assumes for its unreachable() guards.
const addrFieldOfsCache = new Map();
function addressFieldConstMap(idx) {
  if (addrFieldOfsCache.has(idx)) return addrFieldOfsCache.get(idx);
  const fn = functions[idx];
  const map = new Map();
  for (let s = fn.first_statement; s < funcEnd[idx]; s++) {
    const st = statements[s];
    if (st.op === OP.address) map.set(st.c, globalsInitial[st.b]);
  }
  addrFieldOfsCache.set(idx, map);
  return map;
}
const writesSolid = new Uint8Array(NUMFN);
for (const idx of withStmts) {
  const fn = functions[idx];
  const addrFieldOfs = addressFieldConstMap(idx);
  for (let s = fn.first_statement; s < funcEnd[idx]; s++) {
    const st = statements[s];
    if (!STOREP_FAMILY.has(st.op)) continue;
    const fc = addrFieldOfs.get(st.b);
    if (fc === undefined) continue;
    if (st.op === OP.storep_v ? (fc <= 9 && fc + 2 >= 9) : fc === 9) { writesSolid[idx] = 1; break; }
  }
}
for (let round = 0; round < 8; round++) {
  let changed = false;
  for (const idx of withStmts) {
    if (writesSolid[idx]) continue;
    for (const site of callSites[idx]) {
      if (writesSolid[site.calleeIdx]) { writesSolid[idx] = 1; changed = true; break; }
    }
  }
  if (!changed) break;
}

const thinkCandidates = eligible.filter((idx) => functions[idx].numparms === 0 && !writesSolid[idx]);
console.log(`[eligibility] excluded(writes .solid, directly or transitively)=${eligible.filter(i => functions[i].numparms === 0 && writesSolid[i]).length}`);
const thinkCandidateSet = new Set(thinkCandidates);
console.log(`[eligibility] builtin-free & seed-safe=${eligible.length} / ${withStmts.length}; zero-arg (think-compatible)=${thinkCandidates.length}`);
if (thinkCandidates.length === 0) {
  console.log('[SKIP] svframe.differential: no zero-arg builtin-free candidate functions found.');
  process.exit(0);
}

// ============================================================================
// JS reference QC interpreter (transliterated from assembly/vm.ts, identical
// to progs_smoke.test.mjs's makeRefInterp -- see that file for commentary).
// ============================================================================
function makeRefInterp(ri, rf, edicts, edictSizeWords) {
  const LOCALSTACK_SIZE = 2048, MAX_DEPTH = 1024;
  const localstack = new Int32Array(LOCALSTACK_SIZE);
  const stackStmt = new Int32Array(MAX_DEPTH), stackFunc = new Int32Array(MAX_DEPTH);
  let localstackUsed = 0, depth = 0, xfunction = -1, xstatement = 0, trapped = false, trapCode = 0, steps = 0;
  const f32bitsBuf = new ArrayBuffer(4);
  const f32view = new Float32Array(f32bitsBuf), i32view = new Int32Array(f32bitsBuf);
  const toBits = (v) => { f32view[0] = v; return i32view[0]; };

  function edWord(ent, field) { return ent * edictSizeWords + field; }
  function edLoadInt(ent, field) { return edicts[edWord(ent, field)] | 0; }
  function edStoreInt(ent, field, v) { edicts[edWord(ent, field)] = v | 0; }

  function strByteOrNul(idx) { return (idx < 0 || idx >= stringsLen) ? 0 : heapByte(idx); }
  function stringsEqual(a, b) {
    if (a === b) return true;
    let pa = a, pb = b;
    for (;;) {
      const ca = strByteOrNul(pa++), cb = strByteOrNul(pb++);
      if (ca !== cb) return false;
      if (ca === 0) return true;
    }
  }
  function stringIsEmpty(ofs) { return strByteOrNul(ofs) === 0; }

  function fail(code) { trapped = true; trapCode = code; }

  function enterFunction(fIdx) {
    stackStmt[depth] = xstatement; stackFunc[depth] = xfunction; depth++;
    const fn = functions[fIdx];
    const locals = fn.locals;
    if (localstackUsed + locals > LOCALSTACK_SIZE) { fail(4); return fn.first_statement - 1; }
    const parmStart = fn.parm_start;
    for (let i = 0; i < locals; i++) localstack[localstackUsed + i] = ri[parmStart + i];
    localstackUsed += locals;
    let o = parmStart;
    for (let i = 0; i < fn.numparms; i++) {
      const psize = fn.parm_size[i];
      for (let j = 0; j < psize; j++) { ri[o] = ri[PARM0 + i * 3 + j]; o++; }
    }
    xfunction = fIdx;
    return fn.first_statement - 1;
  }

  function leaveFunction() {
    if (depth <= 0) { fail(6); return 0; }
    let c = functions[xfunction].locals;
    localstackUsed -= c;
    if (localstackUsed < 0) fail(5);
    const parmStart = functions[xfunction].parm_start;
    for (--c; c >= 0; c--) ri[parmStart + c] = localstack[localstackUsed + c];
    depth--;
    xfunction = stackFunc[depth];
    return stackStmt[depth];
  }

  function execute(fnum) {
    depth = 0; xfunction = -1; localstackUsed = 0; xstatement = 0; trapped = false; trapCode = 0; steps = 0;
    if (fnum === 0 || fnum >= functions.length) { fail(1); return; }
    let runaway = 0x1000000;
    const exitdepth = depth;
    let s = enterFunction(fnum);
    if (trapped) return;
    for (;;) {
      s++;
      const st = statements[s];
      if (!st) { fail(3); return; }
      const { op, a, b, c } = st;
      runaway--; steps++;
      if (runaway === 0) { fail(2); return; }
      xstatement = s;
      if (op === OP.add_f) rf[c] = rf[a] + rf[b];
      else if (op === OP.add_v) { rf[c] = rf[a] + rf[b]; rf[c + 1] = rf[a + 1] + rf[b + 1]; rf[c + 2] = rf[a + 2] + rf[b + 2]; }
      else if (op === OP.sub_f) rf[c] = rf[a] - rf[b];
      else if (op === OP.sub_v) { rf[c] = rf[a] - rf[b]; rf[c + 1] = rf[a + 1] - rf[b + 1]; rf[c + 2] = rf[a + 2] - rf[b + 2]; }
      else if (op === OP.mul_f) rf[c] = rf[a] * rf[b];
      else if (op === OP.mul_v) rf[c] = rf[a] * rf[b] + rf[a + 1] * rf[b + 1] + rf[a + 2] * rf[b + 2];
      else if (op === OP.mul_fv) { rf[c] = rf[a] * rf[b]; rf[c + 1] = rf[a] * rf[b + 1]; rf[c + 2] = rf[a] * rf[b + 2]; }
      else if (op === OP.mul_vf) { rf[c] = rf[b] * rf[a]; rf[c + 1] = rf[b] * rf[a + 1]; rf[c + 2] = rf[b] * rf[a + 2]; }
      else if (op === OP.div_f) rf[c] = rf[a] / rf[b];
      else if (op === OP.bitand) rf[c] = ((rf[a] | 0) & (rf[b] | 0));
      else if (op === OP.bitor) rf[c] = ((rf[a] | 0) | (rf[b] | 0));
      else if (op === OP.ge) rf[c] = (rf[a] >= rf[b]) ? 1 : 0;
      else if (op === OP.le) rf[c] = (rf[a] <= rf[b]) ? 1 : 0;
      else if (op === OP.gt) rf[c] = (rf[a] > rf[b]) ? 1 : 0;
      else if (op === OP.lt) rf[c] = (rf[a] < rf[b]) ? 1 : 0;
      else if (op === OP.and) rf[c] = ((rf[a] !== 0) && (rf[b] !== 0)) ? 1 : 0;
      else if (op === OP.or) rf[c] = ((rf[a] !== 0) || (rf[b] !== 0)) ? 1 : 0;
      else if (op === OP.not_f) rf[c] = (rf[a] === 0) ? 1 : 0;
      else if (op === OP.not_v) rf[c] = (rf[a] === 0 && rf[a + 1] === 0 && rf[a + 2] === 0) ? 1 : 0;
      else if (op === OP.not_s) { const strPtr = ri[a]; rf[c] = strPtr !== 0 ? (stringIsEmpty(strPtr) ? 1 : 0) : 1; }
      else if (op === OP.not_fnc || op === OP.not_ent) rf[c] = (ri[a] === 0) ? 1 : 0;
      else if (op === OP.eq_f) rf[c] = (rf[a] === rf[b]) ? 1 : 0;
      else if (op === OP.eq_v) rf[c] = (rf[a] === rf[b] && rf[a + 1] === rf[b + 1] && rf[a + 2] === rf[b + 2]) ? 1 : 0;
      else if (op === OP.eq_s) rf[c] = stringsEqual(ri[a], ri[b]) ? 1 : 0;
      else if (op === OP.eq_e || op === OP.eq_fnc) rf[c] = (ri[a] === ri[b]) ? 1 : 0;
      else if (op === OP.ne_f) rf[c] = (rf[a] !== rf[b]) ? 1 : 0;
      else if (op === OP.ne_v) rf[c] = (rf[a] !== rf[b] || rf[a + 1] !== rf[b + 1] || rf[a + 2] !== rf[b + 2]) ? 1 : 0;
      else if (op === OP.ne_s) rf[c] = stringsEqual(ri[a], ri[b]) ? 0 : 1;
      else if (op === OP.ne_e || op === OP.ne_fnc) rf[c] = (ri[a] !== ri[b]) ? 1 : 0;
      else if (op === OP.store_f || op === OP.store_ent || op === OP.store_fld || op === OP.store_s || op === OP.store_fnc) ri[b] = ri[a];
      else if (op === OP.store_v) { ri[b] = ri[a]; ri[b + 1] = ri[a + 1]; ri[b + 2] = ri[a + 2]; }
      else if (STOREP_FAMILY.has(op)) {
        const ptr = ri[b];
        const entNum = (ptr / edictSizeBytesQC) | 0;
        const fieldIdx = (ptr % edictSizeBytesQC - 96) >> 2;
        edStoreInt(entNum, fieldIdx, ri[a]);
        if (op === OP.storep_v) { edStoreInt(entNum, fieldIdx + 1, ri[a + 1]); edStoreInt(entNum, fieldIdx + 2, ri[a + 2]); }
      }
      else if (op === OP.address) {
        const entNum = ri[a];
        if (entNum === 0) { fail(7); return; }
        ri[c] = entNum * edictSizeBytesQC + 96 + (ri[b] << 2);
      }
      else if (LOAD_FAMILY.has(op)) {
        const entNum = ri[a], fieldIdx = ri[b];
        ri[c] = edLoadInt(entNum, fieldIdx);
        if (op === OP.load_v) { ri[c + 1] = edLoadInt(entNum, fieldIdx + 1); ri[c + 2] = edLoadInt(entNum, fieldIdx + 2); }
      }
      else if (op === OP.jz) { if (ri[a] === 0) s += ((b << 16) >> 16) - 1; }
      else if (op === OP.jnz) { if (ri[a] !== 0) s += ((b << 16) >> 16) - 1; }
      else if (op === OP.jump) { s += ((a << 16) >> 16) - 1; }
      else if (op === OP.state) {
        const self = ri[GLOBAL_SELF];
        const nextthink = Math.fround(rf[GLOBAL_TIME] + 0.1);
        edStoreInt(self, FIELD_NEXTTHINK, toBits(nextthink));
        edStoreInt(self, FIELD_FRAME, ri[a]);
        edStoreInt(self, FIELD_THINK, ri[b]);
      }
      else if (op === OP.done || op === OP.ret) {
        ri[1] = ri[a]; ri[2] = ri[a + 1]; ri[3] = ri[a + 2];
        s = leaveFunction();
        if (trapped) return;
        if (depth === exitdepth) return;
      }
      else if (op >= CALL0 && op <= CALL8) {
        const fIdx = ri[a];
        if (fIdx === 0) { fail(8); return; }
        const fn = functions[fIdx];
        if (!fn) { fail(1); return; }
        if (fn.first_statement < 0) {
          throw new Error(`reference interpreter: unexpected call into builtin fn=${fIdx} (eligibility filter should have excluded this)`);
        }
        s = enterFunction(fIdx);
        if (trapped) return;
      }
      else { fail(3); return; }
    }
  }

  return { execute, wasTrapped: () => trapped };
}

// ============================================================================
// JS reference world/link/motion machinery (transliterated from src/engine/
// sv.ts -- copied from svphysics.test.mjs's own JS reference model, since that
// module's parity is proven there; this test only needs to compose it
// identically to how svframe.ts composes the WASM equivalents).
// ============================================================================
function jsHullPointContents(hull, num, p) {
  while (num >= 0) {
    const node = hull.clipnodes[num];
    const plane = hull.planes[node.planenum];
    const d = plane.type <= 2 ? p[plane.type] - plane.dist
      : plane.normal[0] * p[0] + plane.normal[1] * p[1] + plane.normal[2] * p[2] - plane.dist;
    num = d >= 0.0 ? node.children[0] : node.children[1];
  }
  return num;
}
function jsRecursiveHullCheck(hull, num, p1f, p2f, p1, p2, trace) {
  if (num < 0) {
    if (num !== CONTENTS_SOLID) { trace.allsolid = false; if (num === CONTENTS_EMPTY) trace.inopen = true; else trace.inwater = true; }
    else trace.startsolid = true;
    return true;
  }
  const node = hull.clipnodes[num];
  const plane = hull.planes[node.planenum];
  const child0 = node.children[0], child1 = node.children[1];
  let t1, t2;
  if (plane.type <= 2) { t1 = p1[plane.type] - plane.dist; t2 = p2[plane.type] - plane.dist; }
  else {
    t1 = plane.normal[0] * p1[0] + plane.normal[1] * p1[1] + plane.normal[2] * p1[2] - plane.dist;
    t2 = plane.normal[0] * p2[0] + plane.normal[1] * p2[1] + plane.normal[2] * p2[2] - plane.dist;
  }
  if (t1 >= 0.0 && t2 >= 0.0) return jsRecursiveHullCheck(hull, child0, p1f, p2f, p1, p2, trace);
  if (t1 < 0.0 && t2 < 0.0) return jsRecursiveHullCheck(hull, child1, p1f, p2f, p1, p2, trace);
  let frac = (t1 + (t1 < 0.0 ? 0.03125 : -0.03125)) / (t1 - t2);
  if (frac < 0.0) frac = 0.0; else if (frac > 1.0) frac = 1.0;
  const midf = p1f + (p2f - p1f) * frac;
  const mid = [p1[0] + frac * (p2[0] - p1[0]), p1[1] + frac * (p2[1] - p1[1]), p1[2] + frac * (p2[2] - p1[2])];
  const side = t1 < 0.0 ? 1 : 0;
  if (jsRecursiveHullCheck(hull, side === 0 ? child0 : child1, p1f, midf, p1, mid, trace) !== true) return false;
  if (jsHullPointContents(hull, side === 0 ? child1 : child0, mid) !== CONTENTS_SOLID)
    return jsRecursiveHullCheck(hull, side === 0 ? child1 : child0, midf, p2f, mid, p2, trace);
  if (trace.allsolid === true) return false;
  if (side === 0) { trace.plane.normal = [plane.normal[0], plane.normal[1], plane.normal[2]]; trace.plane.dist = plane.dist; }
  else { trace.plane.normal = [-plane.normal[0], -plane.normal[1], -plane.normal[2]]; trace.plane.dist = -plane.dist; }
  let f2 = frac, m = mid.slice(), mf = midf;
  while (jsHullPointContents(hull, hull.firstclipnode, m) === CONTENTS_SOLID) {
    f2 -= 0.1;
    if (f2 < 0.0) { trace.fraction = mf; trace.endpos = m.slice(); return false; }
    mf = p1f + (p2f - p1f) * f2;
    m = [p1[0] + f2 * (p2[0] - p1[0]), p1[1] + f2 * (p2[1] - p1[1]), p1[2] + f2 * (p2[2] - p1[2])];
  }
  trace.fraction = mf; trace.endpos = m.slice();
  return false;
}
function makeEmptyTrace(end) {
  return { fraction: 1.0, allsolid: true, startsolid: false, inopen: false, inwater: false, endpos: [...end], plane: { normal: [0, 0, 0], dist: 0 }, ent: null };
}
function jsCopyTrace(src, dst) {
  dst.fraction = src.fraction; dst.allsolid = src.allsolid; dst.startsolid = src.startsolid;
  dst.inopen = src.inopen; dst.inwater = src.inwater; dst.ent = src.ent;
  dst.endpos = [...src.endpos]; dst.plane = { normal: [...src.plane.normal], dist: src.plane.dist };
}
function makeEntityBoxHull(entMinsX, entMinsY, entMinsZ, entMaxsX, entMaxsY, entMaxsZ, sweepMins, sweepMaxs) {
  const dist = [entMaxsX - sweepMins[0], entMinsX - sweepMaxs[0], entMaxsY - sweepMins[1], entMinsY - sweepMaxs[1], entMaxsZ - sweepMins[2], entMinsZ - sweepMaxs[2]];
  const clipnodes = [], planes = [];
  for (let i = 0; i <= 5; i++) {
    const node = { planenum: i, children: [0, 0] };
    node.children[i & 1] = CONTENTS_EMPTY;
    node.children[1 - (i & 1)] = (i !== 5) ? i + 1 : CONTENTS_SOLID;
    clipnodes[i] = node;
    const normal = [0, 0, 0]; normal[i >> 1] = 1.0;
    planes[i] = { type: i >> 1, normal, dist: dist[i] };
  }
  return { clipnodes, planes, firstclipnode: 0, lastclipnode: 5 };
}
function jsHullForEntityBox(edicts, entNum, sweepMins, sweepMaxs) {
  const eMaxsX = edicts.f(entNum, F.MAXS), eMinsX = edicts.f(entNum, F.MINS);
  const eMaxsY = edicts.f(entNum, F.MAXS1), eMinsY = edicts.f(entNum, F.MINS1);
  const eMaxsZ = edicts.f(entNum, F.MAXS2), eMinsZ = edicts.f(entNum, F.MINS2);
  const hull = makeEntityBoxHull(eMinsX, eMinsY, eMinsZ, eMaxsX, eMaxsY, eMaxsZ, sweepMins, sweepMaxs);
  const offset = [edicts.f(entNum, F.ORIGIN), edicts.f(entNum, F.ORIGIN1), edicts.f(entNum, F.ORIGIN2)];
  return { hull, offset };
}
function jsClipMoveToEntity(edicts, entNum, start, mins, maxs, end) {
  const { hull, offset } = jsHullForEntityBox(edicts, entNum, mins, maxs);
  const adjStart = [start[0] - offset[0], start[1] - offset[1], start[2] - offset[2]];
  const adjEnd = [end[0] - offset[0], end[1] - offset[1], end[2] - offset[2]];
  const trace = makeEmptyTrace(adjEnd);
  jsRecursiveHullCheck(hull, hull.firstclipnode, 0.0, 1.0, adjStart, adjEnd, trace);
  trace.endpos[0] += offset[0]; trace.endpos[1] += offset[1]; trace.endpos[2] += offset[2]; // unconditional (sv.ts/sim parity)
  if (trace.fraction < 1.0 || trace.startsolid === true) trace.ent = entNum;
  return trace;
}
function jsClipToWorld(hullWorld, start, end) {
  const trace = makeEmptyTrace(end);
  jsRecursiveHullCheck(hullWorld, hullWorld.firstclipnode, 0.0, 1.0, [...start], [...end], trace);
  if (trace.fraction < 1.0 || trace.startsolid === true) trace.ent = 0;
  return trace;
}
function makeLink() { const l = { prev: null, next: null, ent: null }; l.prev = l.next = l; return l; }
function createAreaNode(nodes, depth, mins, maxs) {
  const anode = { trigger_edicts: makeLink(), solid_edicts: makeLink() };
  nodes.push(anode);
  if (depth === 4) { anode.axis = -1; anode.children = []; return anode; }
  anode.axis = (maxs[0] - mins[0]) > (maxs[1] - mins[1]) ? 0 : 1;
  anode.dist = 0.5 * (maxs[anode.axis] + mins[anode.axis]);
  const maxs1 = [maxs[0], maxs[1], maxs[2]], mins2 = [mins[0], mins[1], mins[2]];
  maxs1[anode.axis] = mins2[anode.axis] = anode.dist;
  anode.children = [createAreaNode(nodes, depth + 1, mins2, maxs), createAreaNode(nodes, depth + 1, mins, maxs1)];
  return anode;
}
function jsUnlinkEdict(links, e) {
  const area = links[e];
  if (area.prev != null) area.prev.next = area.next;
  if (area.next != null) area.next.prev = area.prev;
  area.prev = area.next = null;
}
function jsLinkEdict(edicts, links, root, entNum) {
  if (entNum === 0 || edicts.free[entNum]) return;
  jsUnlinkEdict(links, entNum);
  const originX = edicts.f(entNum, F.ORIGIN), originY = edicts.f(entNum, F.ORIGIN1), originZ = edicts.f(entNum, F.ORIGIN2);
  const minsX = edicts.f(entNum, F.MINS), minsY = edicts.f(entNum, F.MINS1), minsZ = edicts.f(entNum, F.MINS2);
  const maxsX = edicts.f(entNum, F.MAXS), maxsY = edicts.f(entNum, F.MAXS1), maxsZ = edicts.f(entNum, F.MAXS2);
  // QSS-M SV_LinkEdict order: store into the f32 fields FIRST, then adjust in place
  // (TWO f32 roundings per axis — matches the sim and live sv.ts refreshLeafs).
  edicts.setf(entNum, F.ABSMIN, originX + minsX); edicts.setf(entNum, F.ABSMIN1, originY + minsY); edicts.setf(entNum, F.ABSMIN2, originZ + minsZ);
  edicts.setf(entNum, F.ABSMAX, originX + maxsX); edicts.setf(entNum, F.ABSMAX1, originY + maxsY); edicts.setf(entNum, F.ABSMAX2, originZ + maxsZ);
  const flags = edicts.f(entNum, F.FLAGS) | 0;
  if ((flags & FL_ITEM) !== 0) {
    edicts.setf(entNum, F.ABSMIN, edicts.f(entNum, F.ABSMIN) - 15.0); edicts.setf(entNum, F.ABSMIN1, edicts.f(entNum, F.ABSMIN1) - 15.0);
    edicts.setf(entNum, F.ABSMAX, edicts.f(entNum, F.ABSMAX) + 15.0); edicts.setf(entNum, F.ABSMAX1, edicts.f(entNum, F.ABSMAX1) + 15.0);
  } else {
    edicts.setf(entNum, F.ABSMIN, edicts.f(entNum, F.ABSMIN) - 1.0); edicts.setf(entNum, F.ABSMIN1, edicts.f(entNum, F.ABSMIN1) - 1.0); edicts.setf(entNum, F.ABSMIN2, edicts.f(entNum, F.ABSMIN2) - 1.0);
    edicts.setf(entNum, F.ABSMAX, edicts.f(entNum, F.ABSMAX) + 1.0); edicts.setf(entNum, F.ABSMAX1, edicts.f(entNum, F.ABSMAX1) + 1.0); edicts.setf(entNum, F.ABSMAX2, edicts.f(entNum, F.ABSMAX2) + 1.0);
  }
  const solid = edicts.f(entNum, F.SOLID) | 0;
  if (solid === SOLID_NOT) return;
  let node = root;
  for (;;) {
    if (node.axis === -1) break;
    const amin = edicts.f(entNum, F.ABSMIN + node.axis), amax = edicts.f(entNum, F.ABSMAX + node.axis);
    if (amin > node.dist) node = node.children[0];
    else if (amax < node.dist) node = node.children[1];
    else break;
  }
  const before = (solid === SOLID_TRIGGER) ? node.trigger_edicts : node.solid_edicts;
  const area = links[entNum];
  area.next = before; area.prev = before.prev;
  area.prev.next = area; area.next.prev = area;
  area.ent = entNum;
}
function jsClipToLinks(edicts, node, clip) {
  for (let l = node.solid_edicts.next; l !== node.solid_edicts;) {
    const next = l.next;
    const touch = l.ent;
    const solid = edicts.f(touch, F.SOLID) | 0;
    if (solid === SOLID_NOT || touch === clip.passedict) { l = next; continue; }
    if (solid === SOLID_BSP) { const skin = edicts.f(touch, F.SKIN) | 0; if (skin < 0) { l = next; continue; } }
    if (clip.type === MOVE_NOMONSTERS && solid !== SOLID_BSP) { l = next; continue; }
    const tAbsMinX = edicts.f(touch, F.ABSMIN), tAbsMinY = edicts.f(touch, F.ABSMIN1), tAbsMinZ = edicts.f(touch, F.ABSMIN2);
    const tAbsMaxX = edicts.f(touch, F.ABSMAX), tAbsMaxY = edicts.f(touch, F.ABSMAX1), tAbsMaxZ = edicts.f(touch, F.ABSMAX2);
    if (clip.boxmins[0] > tAbsMaxX || clip.boxmins[1] > tAbsMaxY || clip.boxmins[2] > tAbsMaxZ ||
      clip.boxmaxs[0] < tAbsMinX || clip.boxmaxs[1] < tAbsMinY || clip.boxmaxs[2] < tAbsMinZ) { l = next; continue; }
    if (clip.passedict != null) {
      const passSize = edicts.f(clip.passedict, F.SIZE), touchSize = edicts.f(touch, F.SIZE);
      if (passSize !== 0.0 && touchSize === 0.0) { l = next; continue; }
    }
    if (clip.trace.allsolid === true) return;
    if (clip.passedict != null) {
      const touchOwner = edicts.i(touch, F.OWNER);
      if (touchOwner === clip.passedict) { l = next; continue; }
      const passOwner = edicts.i(clip.passedict, F.OWNER);
      if (passOwner === touch) { l = next; continue; }
    }
    const flags = edicts.f(touch, F.FLAGS) | 0;
    let trace;
    if ((flags & FL_MONSTER) !== 0) trace = jsClipMoveToEntity(edicts, touch, clip.start, clip.mins2, clip.maxs2, clip.end);
    else trace = jsClipMoveToEntity(edicts, touch, clip.start, clip.mins, clip.maxs, clip.end);
    if (trace.allsolid === true || trace.startsolid === true || trace.fraction < clip.trace.fraction ||
        (trace.fraction === clip.trace.fraction && trace.ent != null && trace.ent !== 0 && clip.trace.ent != null && clip.trace.ent !== 0 && trace.ent < clip.trace.ent)) { // tie-break: lowest edict num (matches sv.ts/svmove.ts)
      trace.ent = touch;
      jsCopyTrace(trace, clip.trace);
    }
    l = next;
  }
  if (node.axis === -1) return;
  if (clip.boxmaxs[node.axis] > node.dist) jsClipToLinks(edicts, node.children[0], clip);
  if (clip.boxmins[node.axis] < node.dist) jsClipToLinks(edicts, node.children[1], clip);
}
function jsMove(edicts, root, hullWorld, start, mins, maxs, end, type, passedict) {
  const out = jsClipToWorld(hullWorld, start, end);
  const clip = {
    trace: out, start, end, mins, maxs, type, passedict,
    mins2: type === MOVE_MISSILE ? [-15, -15, -15] : [mins[0], mins[1], mins[2]],
    maxs2: type === MOVE_MISSILE ? [15, 15, 15] : [maxs[0], maxs[1], maxs[2]],
    boxmins: [0, 0, 0], boxmaxs: [0, 0, 0],
  };
  for (let i = 0; i <= 2; i++) {
    if (end[i] > start[i]) { clip.boxmins[i] = start[i] + clip.mins2[i] - 1; clip.boxmaxs[i] = end[i] + clip.maxs2[i] + 1; }
    else { clip.boxmins[i] = end[i] + clip.mins2[i] - 1; clip.boxmaxs[i] = start[i] + clip.maxs2[i] + 1; }
  }
  jsClipToLinks(edicts, root, clip);
  return clip.trace;
}
function jsClipVelocity(vel, normal, overbounce) {
  const backoff = (vel[0] * normal[0] + vel[1] * normal[1] + vel[2] * normal[2]) * overbounce;
  const out = [0, 0, 0];
  out[0] = vel[0] - normal[0] * backoff; if (out[0] > -0.1 && out[0] < 0.1) out[0] = 0.0;
  out[1] = vel[1] - normal[1] * backoff; if (out[1] > -0.1 && out[1] < 0.1) out[1] = 0.0;
  out[2] = vel[2] - normal[2] * backoff; if (out[2] > -0.1 && out[2] < 0.1) out[2] = 0.0;
  return out;
}
function jsCheckVelocity(edicts, e, maxVelocity) {
  for (let i = 0; i <= 2; i++) {
    let v = edicts.f(e, F.VELOCITY + i);
    if (Number.isNaN(v)) v = 0.0;
    const o = edicts.f(e, F.ORIGIN + i);
    if (Number.isNaN(o)) edicts.setf(e, F.ORIGIN + i, 0.0);
    if (v > maxVelocity) v = maxVelocity; else if (v < -maxVelocity) v = -maxVelocity;
    edicts.setf(e, F.VELOCITY + i, v);
  }
}
// Vanilla SV_Impact stamps pr time = sv.time UNCONDITIONALLY (before even checking
// whether either entity has a touch function). The fixtures set no touch functions,
// so the stamp is impact's only observable effect — the sim's impact() does it, and
// the reference must too or the QC time global drifts to the last think's time.
let REF_RF = null, REF_SIMTIME = 0;
function refImpactStamp() { if (REF_RF !== null) REF_RF[GLOBAL_TIME] = Math.fround(REF_SIMTIME); }

function jsFlyMove(edicts, root, worldHull, e, time) {
  const mins = [edicts.f(e, F.MINS), edicts.f(e, F.MINS1), edicts.f(e, F.MINS2)];
  const maxs = [edicts.f(e, F.MAXS), edicts.f(e, F.MAXS1), edicts.f(e, F.MAXS2)];
  const primalVel = [edicts.f(e, F.VELOCITY), edicts.f(e, F.VELOCITY1), edicts.f(e, F.VELOCITY2)];
  let origVel = primalVel.slice();
  let numplanes = 0, timeLeft = time, blocked = 0;
  const planes = [];
  for (let bumpcount = 0; bumpcount <= 3; bumpcount++) {
    const curVel = [edicts.f(e, F.VELOCITY), edicts.f(e, F.VELOCITY1), edicts.f(e, F.VELOCITY2)];
    if (curVel[0] === 0.0 && curVel[1] === 0.0 && curVel[2] === 0.0) break;
    const origin = [edicts.f(e, F.ORIGIN), edicts.f(e, F.ORIGIN1), edicts.f(e, F.ORIGIN2)];
    const end = [origin[0] + timeLeft * curVel[0], origin[1] + timeLeft * curVel[1], origin[2] + timeLeft * curVel[2]];
    const trace = jsMove(edicts, root, worldHull, origin, mins, maxs, end, MOVE_NORMAL, e);
    if (trace.allsolid === true) {
      edicts.setf(e, F.VELOCITY, 0.0); edicts.setf(e, F.VELOCITY1, 0.0); edicts.setf(e, F.VELOCITY2, 0.0);
      return 3;
    }
    if (trace.fraction > 0.0) {
      edicts.setf(e, F.ORIGIN, trace.endpos[0]); edicts.setf(e, F.ORIGIN1, trace.endpos[1]); edicts.setf(e, F.ORIGIN2, trace.endpos[2]);
      origVel = [edicts.f(e, F.VELOCITY), edicts.f(e, F.VELOCITY1), edicts.f(e, F.VELOCITY2)];
      numplanes = 0;
      if (trace.fraction === 1.0) break;
    }
    const planeN = trace.plane.normal, traceEnt = trace.ent;
    if (planeN[2] > 0.7) {
      blocked |= 1;
      if (traceEnt != null && (edicts.f(traceEnt, F.SOLID) | 0) === SOLID_BSP) {
        const flags = edicts.f(e, F.FLAGS) | 0;
        edicts.setf(e, F.FLAGS, flags | FL_ONGROUND);
        edicts.seti(e, F.GROUNDENTITY, traceEnt);
      }
    } else if (planeN[2] === 0.0) blocked |= 2;
    refImpactStamp(); // SV_FlyMove: SV_Impact(ent, trace.ent) per bump
    timeLeft -= timeLeft * trace.fraction;
    if (numplanes >= 5) {
      edicts.setf(e, F.VELOCITY, 0.0); edicts.setf(e, F.VELOCITY1, 0.0); edicts.setf(e, F.VELOCITY2, 0.0);
      return 3;
    }
    planes[numplanes] = [planeN[0], planeN[1], planeN[2]];
    numplanes++;
    let i, j, winningNv;
    for (i = 0; i < numplanes; i++) {
      const nv = jsClipVelocity(origVel, planes[i], 1.0);
      winningNv = nv;
      for (j = 0; j < numplanes; j++) {
        if (j !== i) { const p = planes[j]; if ((nv[0] * p[0] + nv[1] * p[1] + nv[2] * p[2]) < 0.0) break; }
      }
      if (j === numplanes) break;
    }
    if (i !== numplanes) {
      edicts.setf(e, F.VELOCITY, winningNv[0]); edicts.setf(e, F.VELOCITY1, winningNv[1]); edicts.setf(e, F.VELOCITY2, winningNv[2]);
    } else {
      if (numplanes !== 2) {
        edicts.setf(e, F.VELOCITY, 0.0); edicts.setf(e, F.VELOCITY1, 0.0); edicts.setf(e, F.VELOCITY2, 0.0);
        return 7;
      }
      const dir = [
        planes[0][1] * planes[1][2] - planes[0][2] * planes[1][1],
        planes[0][2] * planes[1][0] - planes[0][0] * planes[1][2],
        planes[0][0] * planes[1][1] - planes[0][1] * planes[1][0],
      ];
      const curV = [edicts.f(e, F.VELOCITY), edicts.f(e, F.VELOCITY1), edicts.f(e, F.VELOCITY2)];
      const d = dir[0] * curV[0] + dir[1] * curV[1] + dir[2] * curV[2];
      edicts.setf(e, F.VELOCITY, dir[0] * d); edicts.setf(e, F.VELOCITY1, dir[1] * d); edicts.setf(e, F.VELOCITY2, dir[2] * d);
    }
    const finalV = [edicts.f(e, F.VELOCITY), edicts.f(e, F.VELOCITY1), edicts.f(e, F.VELOCITY2)];
    if ((finalV[0] * primalVel[0] + finalV[1] * primalVel[1] + finalV[2] * primalVel[2]) <= 0.0) {
      edicts.setf(e, F.VELOCITY, 0.0); edicts.setf(e, F.VELOCITY1, 0.0); edicts.setf(e, F.VELOCITY2, 0.0);
      return blocked;
    }
  }
  return blocked;
}
function jsPushEntity(edicts, links, root, worldHull, e, push) {
  const ox = edicts.f(e, F.ORIGIN), oy = edicts.f(e, F.ORIGIN1), oz = edicts.f(e, F.ORIGIN2);
  const end = [ox + push[0], oy + push[1], oz + push[2]];
  const mins = [edicts.f(e, F.MINS), edicts.f(e, F.MINS1), edicts.f(e, F.MINS2)];
  const maxs = [edicts.f(e, F.MAXS), edicts.f(e, F.MAXS1), edicts.f(e, F.MAXS2)];
  const solid = edicts.f(e, F.SOLID) | 0, movetype = edicts.f(e, F.MOVETYPE) | 0;
  let type;
  if (movetype === MT.flymissile) type = MOVE_MISSILE;
  else if (solid === SOLID_TRIGGER || solid === SOLID_NOT) type = MOVE_NOMONSTERS;
  else type = MOVE_NORMAL;
  const trace = jsMove(edicts, root, worldHull, [ox, oy, oz], mins, maxs, end, type, e);
  edicts.setf(e, F.ORIGIN, trace.endpos[0]); edicts.setf(e, F.ORIGIN1, trace.endpos[1]); edicts.setf(e, F.ORIGIN2, trace.endpos[2]);
  jsLinkEdict(edicts, links, root, e);
  if (trace.ent !== null) refImpactStamp(); // SV_PushEntity: impact only on entity hit
  return trace;
}
function jsAddGravity(edicts, e, frametime, gravityCvar, gravityFieldIdx) {
  let entGravity = 1.0;
  if (gravityFieldIdx >= 0) { const g = edicts.f(e, gravityFieldIdx); entGravity = (g !== 0.0) ? g : 1.0; }
  const v2 = edicts.f(e, F.VELOCITY2);
  edicts.setf(e, F.VELOCITY2, v2 - entGravity * gravityCvar * frametime);
}
// sv.ts checkWaterTransition (vanilla SV_CheckWaterTransition), including the quirk
// that leaving water stores the raw CONTENTS value into waterlevel. Splash sound is
// host-side (stubbed), no state effect here.
function jsCheckWaterTransition(edicts, worldHull, e) {
  const cont = jsHullPointContents(worldHull, worldHull.firstclipnode,
    [edicts.f(e, F.ORIGIN), edicts.f(e, F.ORIGIN1), edicts.f(e, F.ORIGIN2)]);
  if (edicts.f(e, F.WATERTYPE) === 0.0) {
    edicts.setf(e, F.WATERTYPE, cont); edicts.setf(e, F.WATERLEVEL, 1.0); return;
  }
  if (cont <= CONTENTS_WATER) {
    edicts.setf(e, F.WATERTYPE, cont); edicts.setf(e, F.WATERLEVEL, 1.0); return;
  }
  edicts.setf(e, F.WATERTYPE, CONTENTS_EMPTY); edicts.setf(e, F.WATERLEVEL, cont);
}

function jsPhysicsToss(edicts, links, root, worldHull, e, frametime, maxVelocity, gravityCvar, gravityFieldIdx) {
  const flags0 = edicts.f(e, F.FLAGS) | 0;
  if ((flags0 & FL_ONGROUND) !== 0) return;
  jsCheckVelocity(edicts, e, maxVelocity);
  const movetype = edicts.f(e, F.MOVETYPE) | 0;
  if (movetype !== MT.fly && movetype !== MT.flymissile) jsAddGravity(edicts, e, frametime, gravityCvar, gravityFieldIdx);
  const aX = edicts.f(e, F.ANGLES), aY = edicts.f(e, F.ANGLES1), aZ = edicts.f(e, F.ANGLES2);
  const avX = edicts.f(e, F.AVELOCITY), avY = edicts.f(e, F.AVELOCITY1), avZ = edicts.f(e, F.AVELOCITY2);
  edicts.setf(e, F.ANGLES, aX + frametime * avX); edicts.setf(e, F.ANGLES1, aY + frametime * avY); edicts.setf(e, F.ANGLES2, aZ + frametime * avZ);
  const velX = edicts.f(e, F.VELOCITY), velY = edicts.f(e, F.VELOCITY1), velZ = edicts.f(e, F.VELOCITY2);
  const trace = jsPushEntity(edicts, links, root, worldHull, e, [velX * frametime, velY * frametime, velZ * frametime]);
  if (trace.fraction === 1.0) return;
  const curVel = [edicts.f(e, F.VELOCITY), edicts.f(e, F.VELOCITY1), edicts.f(e, F.VELOCITY2)];
  const overbounce = (movetype === MT.bounce) ? 1.5 : 1.0;
  const nv = jsClipVelocity(curVel, trace.plane.normal, overbounce);
  edicts.setf(e, F.VELOCITY, nv[0]); edicts.setf(e, F.VELOCITY1, nv[1]); edicts.setf(e, F.VELOCITY2, nv[2]);
  if (trace.plane.normal[2] > 0.7) {
    if (nv[2] < 60.0 || movetype !== MT.bounce) {
      const flags = edicts.f(e, F.FLAGS) | 0;
      edicts.setf(e, F.FLAGS, flags | FL_ONGROUND);
      edicts.seti(e, F.GROUNDENTITY, trace.ent);
      edicts.setf(e, F.VELOCITY, 0.0); edicts.setf(e, F.VELOCITY1, 0.0); edicts.setf(e, F.VELOCITY2, 0.0);
      edicts.setf(e, F.AVELOCITY, 0.0); edicts.setf(e, F.AVELOCITY1, 0.0); edicts.setf(e, F.AVELOCITY2, 0.0);
    }
  }
  jsCheckWaterTransition(edicts, worldHull, e);
}

// ============================================================================
// JS reference SV_RunThink / SV_Physics (src/engine/sv.ts, transliterated --
// mirrors assembly/svframe.ts exactly, see that file's header for the same
// SCOPE/exclusion commentary).
// ============================================================================
function makeSvReference(edicts, links, root, worldHull, ref) {
  let svTime = 0, maxVelocity = 2000, gravityCvar = 800, gravityFieldIdx = -1, numEdicts = 0, maxClients = 0;

  function addGravity(e, frametime) { jsAddGravity(edicts, e, frametime, gravityCvar, gravityFieldIdx); }

  function runThink(e, frametime, ri, rf) {
    let thinktime = edicts.f(e, F.NEXTTHINK);
    if (thinktime <= 0.0 || thinktime > (svTime + frametime)) return true;
    if (thinktime < svTime) thinktime = svTime;
    edicts.setf(e, F.NEXTTHINK, 0.0);
    rf[GLOBAL_TIME] = Math.fround(thinktime);
    ri[GLOBAL_SELF] = e;
    ri[GLOBAL_OTHER] = 0;
    ref.execute(edicts.i(e, F.THINK));
    return !edicts.free[e];
  }

  function physics_None(e, frametime, ri, rf) { runThink(e, frametime, ri, rf); }
  function physics_Noclip(e, frametime, ri, rf) {
    if (!runThink(e, frametime, ri, rf)) return;
    edicts.setf(e, F.ANGLES, edicts.f(e, F.ANGLES) + frametime * edicts.f(e, F.AVELOCITY));
    edicts.setf(e, F.ANGLES1, edicts.f(e, F.ANGLES1) + frametime * edicts.f(e, F.AVELOCITY1));
    edicts.setf(e, F.ANGLES2, edicts.f(e, F.ANGLES2) + frametime * edicts.f(e, F.AVELOCITY2));
    edicts.setf(e, F.ORIGIN, edicts.f(e, F.ORIGIN) + frametime * edicts.f(e, F.VELOCITY));
    edicts.setf(e, F.ORIGIN1, edicts.f(e, F.ORIGIN1) + frametime * edicts.f(e, F.VELOCITY1));
    edicts.setf(e, F.ORIGIN2, edicts.f(e, F.ORIGIN2) + frametime * edicts.f(e, F.VELOCITY2));
    jsLinkEdict(edicts, links, root, e);
  }
  function physics_Step(e, frametime, ri, rf) {
    const flags = edicts.f(e, F.FLAGS) | 0;
    if ((flags & (FL_ONGROUND | FL_FLY | FL_SWIM)) === 0) {
      addGravity(e, frametime);
      jsCheckVelocity(edicts, e, maxVelocity);
      jsFlyMove(edicts, root, worldHull, e, frametime);
      jsLinkEdict(edicts, links, root, e);
    }
    runThink(e, frametime, ri, rf);
    jsCheckWaterTransition(edicts, worldHull, e);
  }
  function physics_Toss(e, frametime, ri, rf) {
    if (!runThink(e, frametime, ri, rf)) return;
    jsPhysicsToss(edicts, links, root, worldHull, e, frametime, maxVelocity, gravityCvar, gravityFieldIdx);
  }

  function physicsFrame(time, frametime, ri, rf) {
    svTime = time;
    REF_RF = rf; REF_SIMTIME = time; // impact/touch dispatch clock (sim setSimTime)
    ri[GLOBAL_SELF] = 0; ri[GLOBAL_OTHER] = 0; rf[GLOBAL_TIME] = Math.fround(time);
    // Live re-read of numEdicts in the loop CONDITION (matches sv.ts's
    // `i < state.server.num_edicts` -- see svframe.ts's header note).
    for (let i = 0; i < numEdicts; i++) {
      if (edicts.free[i]) continue;
      // force_retouch re-links EVERY entity with touch dispatch (read live each
      // iteration, like the sim). No fixture defines triggers/touch fns, so the
      // observable effect is the absbox recompute.
      if (rf[GLOBAL_FORCE_RETOUCH] !== 0) jsLinkEdict(edicts, links, root, i);
      const movetype = edicts.f(i, F.MOVETYPE) | 0;
      switch (movetype) {
        case MT.push: break; // SV_Physics_Pusher: EXCLUDED
        case MT.none: physics_None(i, frametime, ri, rf); break;
        case MT.noclip: physics_Noclip(i, frametime, ri, rf); break;
        case MT.step: physics_Step(i, frametime, ri, rf); break;
        case MT.toss: case MT.bounce: case MT.fly: case MT.flymissile:
          physics_Toss(i, frametime, ri, rf); break;
        default: break;
      }
    }
    const fr = rf[GLOBAL_FORCE_RETOUCH];
    if (fr !== 0) rf[GLOBAL_FORCE_RETOUCH] = Math.fround(fr - 1.0);
    svTime = time + frametime;
  }

  return {
    physicsFrame,
    setMaxVelocity: (v) => { maxVelocity = v; },
    setGravityCvar: (v) => { gravityCvar = v; },
    setGravityFieldIdx: (i) => { gravityFieldIdx = i; },
    setNumEdicts: (n) => { numEdicts = n; },
    getNumEdicts: () => numEdicts,
  };
}

// ============================================================================
// Fixtures + wasm wiring
// ============================================================================
class JsEdicts {
  constructor(n, fields) {
    this.n = n; this.fields = fields;
    this.buf = new ArrayBuffer(n * fields * 4);
    this.vf = new Float32Array(this.buf);
    this.vi = new Int32Array(this.buf);
    this.free = new Array(n).fill(false);
  }
  w(e, idx) { return e * this.fields + idx; }
  f(e, idx) { return this.vf[this.w(e, idx)]; }
  setf(e, idx, v) { this.vf[this.w(e, idx)] = v; }
  i(e, idx) { return this.vi[this.w(e, idx)]; }
  seti(e, idx, v) { this.vi[this.w(e, idx)] = v; }
}
function makeFloorHull(floorZ) {
  return {
    clipnodes: [{ planenum: 0, children: [CONTENTS_EMPTY, CONTENTS_SOLID] }],
    planes: [{ type: 2, normal: [0, 0, 1], dist: floorZ }],
    firstclipnode: 0, lastclipnode: 0,
  };
}
function loadWorldHullToWasm(hull) {
  // Size the clipnode/plane pools like the live embedder (wasmServer.loadMap) --
  // without this the pools are never allocated and the box/pusher-hull scratch
  // carve at maxClipnodes()-N corrupts low linear memory.
  x.initHullStorage(hull.clipnodes.length, hull.planes.length);
  for (let i = 0; i < hull.planes.length; i++) {
    const p = hull.planes[i];
    x.setPlane(i, p.normal[0], p.normal[1], p.normal[2], p.dist, p.type);
  }
  for (let i = hull.firstclipnode; i <= hull.lastclipnode; i++) {
    const n = hull.clipnodes[i];
    x.setClipNode(i, n.planenum, n.children[0], n.children[1]);
  }
  x.setWorldHullRange(hull.firstclipnode, hull.lastclipnode);
}
function setEntityBoth(edicts, e, ox, oy, oz, hx, hy, hz, solid, flags) {
  edicts.setf(e, F.ORIGIN, ox); edicts.setf(e, F.ORIGIN1, oy); edicts.setf(e, F.ORIGIN2, oz);
  edicts.setf(e, F.MINS, -hx); edicts.setf(e, F.MINS1, -hy); edicts.setf(e, F.MINS2, -hz);
  edicts.setf(e, F.MAXS, hx); edicts.setf(e, F.MAXS1, hy); edicts.setf(e, F.MAXS2, hz);
  edicts.setf(e, F.SOLID, solid); edicts.setf(e, F.FLAGS, flags); edicts.setf(e, F.SKIN, 0); edicts.setf(e, F.SIZE, hx * 2);
  x.edStoreFloat(e, F.ORIGIN, ox); x.edStoreFloat(e, F.ORIGIN1, oy); x.edStoreFloat(e, F.ORIGIN2, oz);
  x.edStoreFloat(e, F.MINS, -hx); x.edStoreFloat(e, F.MINS1, -hy); x.edStoreFloat(e, F.MINS2, -hz);
  x.edStoreFloat(e, F.MAXS, hx); x.edStoreFloat(e, F.MAXS1, hy); x.edStoreFloat(e, F.MAXS2, hz);
  x.edStoreFloat(e, F.SOLID, solid); x.edStoreFloat(e, F.FLAGS, flags); x.edStoreFloat(e, F.SKIN, 0); x.edStoreFloat(e, F.SIZE, hx * 2);
}
function seedFieldValue(fieldIdx, r) {
  switch (fieldType[fieldIdx]) {
    case FT_ENTITY: return r.int(ENT_RANGE) | 0;
    case FT_FIELD: return r.int(Math.max(1, entityfields - 3)) | 0;
    case FT_STRING: return r.int(Math.max(1, stringsLen)) | 0;
    case FT_FUNCTION: return 0;
    case FT_FLOAT:
    case FT_VECTOR: { const v = Math.fround((r.u32() / 0xffffffff) * 1000 - 500); const b = new Float32Array(1); b[0] = v; return new Int32Array(b.buffer)[0]; }
    default: return r.int(Math.min(ENT_RANGE, entityfields)) | 0;
  }
}

const WORLD_MINS = [-4096, -4096, -4096], WORLD_MAXS = [4096, 4096, 4096];
const ENT_RANGE = 41; // world(0) + 40 actor/baseline entities
const NUM_ACTORS = 20; // indices [1, NUM_ACTORS] get controlled movetype/think fixtures
const OBSTACLE_BASE = 200, NUM_OBSTACLES = 60;

x.initAreaTree(WORLD_MINS[0], WORLD_MINS[1], WORLD_MINS[2], WORLD_MAXS[0], WORLD_MAXS[1], WORLD_MAXS[2], MAX_EDICTS);
x.initEntState(0, ENT_RANGE);

const worldHull = makeFloorHull(-128);
loadWorldHullToWasm(worldHull);

const edicts = new JsEdicts(MAX_EDICTS, entityfields);
const links = []; for (let i = 0; i < MAX_EDICTS; i++) links.push({ prev: null, next: null, ent: null });
const areaNodes = [];
const areaRoot = createAreaNode(areaNodes, 0, WORLD_MINS, WORLD_MAXS);

// world entity (index 0): SOLID_BSP, fixed.
edicts.setf(0, F.SOLID, SOLID_BSP); x.edStoreFloat(0, F.SOLID, SOLID_BSP);

// Obstacle cluster (fixed for the whole run -- passive collision geometry).
{
  const r = rng(0x5F0BB1);
  for (let e = OBSTACLE_BASE; e < OBSTACLE_BASE + NUM_OBSTACLES; e++) {
    const ox = r.f32(300), oy = r.f32(300), oz = -128 + Math.abs(r.f32(80));
    const hx = Math.abs(r.f32(25)) + 4, hy = Math.abs(r.f32(25)) + 4, hz = Math.abs(r.f32(25)) + 4;
    setEntityBoth(edicts, e, ox, oy, oz, hx, hy, hz, SOLID_SLIDEBOX, 0);
    x.linkEdict(e); jsLinkEdict(edicts, links, areaRoot, e);
  }
}

// GLOBALS buffers (created ONCE, after every heap.alloc-triggering setup call above).
const G = x.globalsPtr();
const wf = new Float32Array(mem.buffer, G, Math.max(numGlobals, 8192));
const wi = new Int32Array(mem.buffer, G, Math.max(numGlobals, 8192));
const edView = new Int32Array(mem.buffer, x.edictsBase(), MAX_EDICTS * entityfields);

const refBuf = new ArrayBuffer(Math.max(numGlobals, 8192) * 4);
const rf = new Float32Array(refBuf);
const ri = new Int32Array(refBuf);
const ref = makeRefInterp(ri, rf, edicts.vi, entityfields);
const svref = makeSvReference(edicts, links, areaRoot, worldHull, ref);

const edictBaseline = new Int32Array(ENT_RANGE * entityfields);
{
  const seedR = rng(0xED1C70);
  for (let ent = 1; ent < ENT_RANGE; ent++) for (let f = 0; f < entityfields; f++) edictBaseline[ent * entityfields + f] = seedFieldValue(f, seedR);
  // Baseline entities [1,ENT_RANGE) are unlinked filler (indirect field-deref
  // safety, same role as progs_smoke's random edicts) -- they must NEVER be
  // dispatched by physicsFrame's movetype switch, because a random MOVETYPE
  // that happens to truncate to a dispatched constant (0/4/5/6/7/8/9/10) would
  // make that entity self-link via physics_Noclip/Step/Toss's own linkEdict
  // call, carrying whatever RANDOM value landed in its SOLID field -- if that
  // truncates to SOLID_BSP (4), a later touch against it hits
  // loadHullForEntityBox's deliberate `unreachable()` (SOLID_BSP hull-table
  // lookup is out of scope, see svmove.ts's header). Force MOVETYPE to a safe
  // sentinel here (setActor() overwrites it again for the controlled [1,
  // NUM_ACTORS] range, so this only affects the untouched baseline tail).
  const negOneBits = new Int32Array(new Float32Array([-1.0]).buffer)[0];
  for (let ent = 1; ent < ENT_RANGE; ent++) edictBaseline[ent * entityfields + F.MOVETYPE] = negOneBits;
}

function resetSharedState() {
  wi.set(globalsInitial.subarray(0, Math.max(numGlobals, 8192)));
  ri.set(globalsInitial.subarray(0, Math.max(numGlobals, 8192)));
  // Only re-baseline [1, ENT_RANGE) -- index 0 (world) and the obstacle cluster
  // are set up once above and never mutated by physicsFrame (world is movetype
  // none/no-think; obstacles are outside [0,numEdicts) so never dispatched).
  for (let ent = 1; ent < ENT_RANGE; ent++) {
    for (let f = 0; f < entityfields; f++) {
      const v = edictBaseline[ent * entityfields + f];
      edView[ent * entityfields + f] = v;
      edicts.vi[ent * entityfields + f] = v;
    }
  }
  edicts.free.fill(false);
}

const MOVETYPES = [MT.none, MT.noclip, MT.step, MT.toss, MT.bounce, MT.fly, MT.flymissile];

function setActor(e, r, opts = {}) {
  const movetype = opts.movetype ?? MOVETYPES[r.int(MOVETYPES.length)];
  const ox = r.f32(200), oy = r.f32(200), oz = -100 + Math.abs(r.f32(150));
  const hx = Math.abs(r.f32(15)) + 2, hy = Math.abs(r.f32(15)) + 2, hz = Math.abs(r.f32(15)) + 2;
  const vel = [r.f32(300), r.f32(300), r.f32(250)];
  const angles = [r.f32(180), r.f32(180), r.f32(180)];
  const avel = [r.f32(200), r.f32(200), r.f32(200)];
  const flagsRoll = r.int(6);
  const flags0 = flagsRoll === 0 ? FL_ONGROUND : (flagsRoll === 1 ? FL_FLY : (flagsRoll === 2 ? FL_SWIM : 0));

  setEntityBoth(edicts, e, ox, oy, oz, hx, hy, hz, SOLID_SLIDEBOX, flags0);
  edicts.setf(e, F.MOVETYPE, movetype); x.edStoreFloat(e, F.MOVETYPE, movetype);
  edicts.setf(e, F.VELOCITY, vel[0]); edicts.setf(e, F.VELOCITY1, vel[1]); edicts.setf(e, F.VELOCITY2, vel[2]);
  x.edStoreFloat(e, F.VELOCITY, vel[0]); x.edStoreFloat(e, F.VELOCITY1, vel[1]); x.edStoreFloat(e, F.VELOCITY2, vel[2]);
  edicts.setf(e, F.ANGLES, angles[0]); edicts.setf(e, F.ANGLES1, angles[1]); edicts.setf(e, F.ANGLES2, angles[2]);
  x.edStoreFloat(e, F.ANGLES, angles[0]); x.edStoreFloat(e, F.ANGLES1, angles[1]); x.edStoreFloat(e, F.ANGLES2, angles[2]);
  edicts.setf(e, F.AVELOCITY, avel[0]); edicts.setf(e, F.AVELOCITY1, avel[1]); edicts.setf(e, F.AVELOCITY2, avel[2]);
  x.edStoreFloat(e, F.AVELOCITY, avel[0]); x.edStoreFloat(e, F.AVELOCITY1, avel[1]); x.edStoreFloat(e, F.AVELOCITY2, avel[2]);
  edicts.seti(e, F.GROUNDENTITY, 0); x.edStoreInt(e, F.GROUNDENTITY, 0);

  const gravityRoll = r.int(4);
  const gravityVal = gravityRoll === 0 ? 0.0 : r.f32(2);
  edicts.setf(e, F.GRAVITY_TEST, gravityVal); x.edStoreFloat(e, F.GRAVITY_TEST, gravityVal);

  // nextthink: sometimes fires this frame (real builtin-free think), sometimes
  // scheduled later, sometimes unset (<=0).
  const svTime = opts.time;
  const frametime = opts.frametime;
  const thinkRoll = r.int(3);
  let nextthink, thinkFn;
  if (thinkRoll === 0) { nextthink = 0.0; thinkFn = 0; }
  else {
    thinkFn = thinkCandidates[r.int(thinkCandidates.length)];
    nextthink = thinkRoll === 1
      ? svTime + Math.abs(r.f32(frametime)) // fires this frame
      : svTime + frametime + 1.0 + Math.abs(r.f32(50)); // scheduled later
  }
  edicts.setf(e, F.NEXTTHINK, nextthink); x.edStoreFloat(e, F.NEXTTHINK, nextthink);
  edicts.seti(e, F.THINK, thinkFn); x.edStoreInt(e, F.THINK, thinkFn);

  x.linkEdict(e); jsLinkEdict(edicts, links, areaRoot, e);
}

// bit-exact i32 checker (subsumes float exactness since both sides store f32
// bit patterns on every write, per THE PARITY RULE).
function compareState(chk, label) {
  let ok = true;
  for (let i = 0; i < numGlobals; i++) {
    if (wi[i] !== ri[i]) { chk.intEq(wi[i], ri[i], `${label} global[${i}]`); ok = false; }
  }
  for (let i = 0; i < ENT_RANGE * entityfields; i++) {
    if (edView[i] !== edicts.vi[i]) { chk.intEq(edView[i], edicts.vi[i], `${label} edict[${(i / entityfields) | 0}][${i % entityfields}]`); ok = false; }
  }
  const wN = x.getNumEdicts ? x.getNumEdicts() : ENT_RANGE;
  chk.intEq(wN, svref.getNumEdicts(), `${label} numEdicts`);
  return ok;
}

const results = [];

// ================================================================================
// Section A: single-frame differential.
// ================================================================================
{
  const r = rng(0xF00D01);
  const chk = new Check('svframe.singleFrame');
  const TRIALS = 4000;
  let okCount = 0;
  for (let trial = 0; trial < TRIALS; trial++) {
    resetSharedState();
    x.resetVm();
    x.setNumEdicts(ENT_RANGE);
    svref.setNumEdicts(ENT_RANGE);

    const time = Math.abs(r.f32(1000));
    const frametime = 0.02 + Math.abs(r.f32(0.08));
    const maxVelocity = 2000 + r.f32(500);
    const gravityCvar = 700 + r.f32(200);
    const hasGravityField = r.int(3) === 0;
    const gravityFieldIdx = hasGravityField ? F.GRAVITY_TEST : -1;
    x.setMaxVelocity(maxVelocity); svref.setMaxVelocity(maxVelocity);
    x.setGravityCvar(gravityCvar); svref.setGravityCvar(gravityCvar);
    x.setGravityFieldIdx(gravityFieldIdx); svref.setGravityFieldIdx(gravityFieldIdx);

    for (let e = 1; e <= NUM_ACTORS; e++) setActor(e, r, { time, frametime });

    x.physicsFrame(time, frametime);
    svref.physicsFrame(time, frametime, ri, rf);

    const ok = compareState(chk, `trial#${trial}`);
    if (ok) okCount++;
  }
  console.log(`[svframe.singleFrame] ${okCount}/${TRIALS} trials fully bit-exact`);
  results.push(chk.report());
}

// ================================================================================
// Section B: multi-frame differential (several consecutive frames per fixture).
// ================================================================================
{
  const r = rng(0xF00D02);
  const chk = new Check('svframe.multiFrame');
  const FIXTURES = 60, FRAMES = 5;
  for (let trial = 0; trial < FIXTURES; trial++) {
    resetSharedState();
    x.resetVm();
    x.setNumEdicts(ENT_RANGE);
    svref.setNumEdicts(ENT_RANGE);

    let time = Math.abs(r.f32(500));
    const frametime = 0.02 + Math.abs(r.f32(0.06));
    const maxVelocity = 2000 + r.f32(500);
    const gravityCvar = 700 + r.f32(200);
    const gravityFieldIdx = r.int(3) === 0 ? F.GRAVITY_TEST : -1;
    x.setMaxVelocity(maxVelocity); svref.setMaxVelocity(maxVelocity);
    x.setGravityCvar(gravityCvar); svref.setGravityCvar(gravityCvar);
    x.setGravityFieldIdx(gravityFieldIdx); svref.setGravityFieldIdx(gravityFieldIdx);

    for (let e = 1; e <= NUM_ACTORS; e++) setActor(e, r, { time, frametime });

    for (let f = 0; f < FRAMES; f++) {
      x.physicsFrame(time, frametime);
      svref.physicsFrame(time, frametime, ri, rf);
      compareState(chk, `fixture#${trial} frame#${f}`);

      // A think can reschedule itself to a DIFFERENT function via OP.state
      // (real monster AI frame-chains) or a STORE_FNC -- that successor was
      // never vetted by the eligibility filter (which only checks the
      // function we ORIGINALLY assigned), so it may contain a builtin call
      // the JS reference interpreter can't execute (by design -- see its
      // header). Disarm any actor now pointed at an unvetted think so the
      // NEXT frame stays well-formed on both sides identically; this still
      // exercises real multi-frame rescheduling for every chain that DOES
      // stay within the vetted set (most do).
      for (let e = 1; e <= NUM_ACTORS; e++) {
        const thinkFn = x.edLoadInt(e, F.THINK);
        if (thinkFn !== 0 && !thinkCandidateSet.has(thinkFn)) {
          x.edStoreFloat(e, F.NEXTTHINK, 0.0);
          edicts.setf(e, F.NEXTTHINK, 0.0);
        }
      }

      time += frametime;
    }
  }
  results.push(chk.report());
}

// ================================================================================
// Section C: num_edicts/free-flag coherence -- synthetic bytecode calling the
// REAL #14 spawn / #15 remove builtins from a think (see file header). The JS
// side special-cases these two synthetic think values directly (jsEdAlloc/
// jsEdFree, transliterated from src/engine/ed.ts) rather than interpreting
// bytecode, since the WASM side already proves real bytecode execution
// bit-exact in Sections A/B -- this section's job is proving the ORCHESTRATION
// (loop-bound liveness, free-flag skip) around a builtin call, not re-proving
// the VM.
// ================================================================================
{
  const BI_REMOVE = 15, BI_SPAWN = 14;
  // Safely beyond every index progs.dat itself used.
  const SYN_FN_BASE = functions.length + 1000;
  const SYN_STMT_BASE = statements.length + 1000;
  // Placed beyond the [0, max(numGlobals,8192)) range resetSharedState()
  // bulk-restores every trial (GLOBALS_MAX in abi.ts is 65536) -- otherwise
  // Scenario A/B's own resetSharedState() call would wipe these constants
  // back to 0 before the synthetic bytecode ever runs.
  const SYN_GLOBAL_BASE = 65536 - 100;
  const FN_BI_REMOVE_STUB = SYN_FN_BASE + 0;
  const FN_BI_SPAWN_STUB = SYN_FN_BASE + 1;
  const FN_THINK_REMOVE = SYN_FN_BASE + 2;
  const FN_THINK_SPAWN = SYN_FN_BASE + 3;
  const G_REMOVE_FNPTR = SYN_GLOBAL_BASE + 0;
  const G_SPAWN_FNPTR = SYN_GLOBAL_BASE + 1;
  const PARM_SCRATCH = SYN_GLOBAL_BASE + 10;

  // function records: builtin stubs (first_statement = -builtinNumber).
  x.installFunction(FN_BI_REMOVE_STUB, -BI_REMOVE, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  x.installFunction(FN_BI_SPAWN_STUB, -BI_SPAWN, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  // think_remove: self -> PARM0; CALL0 remove-stub; DONE.
  x.installStatement(SYN_STMT_BASE + 0, OP.store_ent, GLOBAL_SELF, PARM0, 0);
  x.installStatement(SYN_STMT_BASE + 1, OP.call0, G_REMOVE_FNPTR, 0, 0);
  x.installStatement(SYN_STMT_BASE + 2, OP.done, 0, 0, 0);
  x.installFunction(FN_THINK_REMOVE, SYN_STMT_BASE + 0, PARM_SCRATCH, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  // think_spawn: CALL0 spawn-stub (return discarded); DONE.
  x.installStatement(SYN_STMT_BASE + 10, OP.call0, G_SPAWN_FNPTR, 0, 0);
  x.installStatement(SYN_STMT_BASE + 11, OP.done, 0, 0, 0);
  x.installFunction(FN_THINK_SPAWN, SYN_STMT_BASE + 10, PARM_SCRATCH, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  x.setNumFunctions(FN_THINK_SPAWN + 1);
  x.writeGlobalInt(G_REMOVE_FNPTR, FN_BI_REMOVE_STUB);
  x.writeGlobalInt(G_SPAWN_FNPTR, FN_BI_SPAWN_STUB);

  function jsClearEdictC(e) { for (let f = 0; f < entityfields; f++) edicts.vi[e * entityfields + f] = 0; edicts.free[e] = false; }
  function jsEdFreeC(e, serverTime) {
    edicts.free[e] = true;
    edicts.seti(e, F.MODEL, 0); edicts.setf(e, F.TAKEDAMAGE, 0.0); edicts.setf(e, 0 /*MODELINDEX*/, 0.0);
    edicts.setf(e, F.COLORMAP, 0.0); edicts.setf(e, F.SKIN, 0.0); edicts.setf(e, F.FRAME, 0.0);
    edicts.setf(e, F.ORIGIN, 0.0); edicts.setf(e, F.ORIGIN1, 0.0); edicts.setf(e, F.ORIGIN2, 0.0);
    edicts.setf(e, F.ANGLES, 0.0); edicts.setf(e, F.ANGLES1, 0.0); edicts.setf(e, F.ANGLES2, 0.0);
    edicts.setf(e, F.NEXTTHINK, -1.0); edicts.setf(e, F.SOLID, 0.0);
  }
  function jsEdAllocC(maxClients, numEdicts) {
    for (let i = maxClients + 1; i < numEdicts; i++) if (edicts.free[i]) { jsClearEdictC(i); return { e: i, numEdicts }; }
    const e = numEdicts; jsClearEdictC(e); return { e, numEdicts: numEdicts + 1 };
  }

  // JS reference physicsFrame for THIS section: identical structure to
  // makeSvReference's, but dispatches the two synthetic think values directly
  // instead of calling ref.execute().
  function jsPhysicsFrameSynthetic(state, time, frametime) {
    state.svTime = time;
    for (let i = 0; i < state.numEdicts; i++) {
      if (edicts.free[i]) continue;
      const movetype = edicts.f(i, F.MOVETYPE) | 0;
      if (movetype !== MT.none) continue; // this section only uses movetype none
      let thinktime = edicts.f(i, F.NEXTTHINK);
      if (thinktime <= 0.0 || thinktime > (state.svTime + frametime)) continue;
      edicts.setf(i, F.NEXTTHINK, 0.0);
      const thinkFn = edicts.i(i, F.THINK);
      if (thinkFn === FN_THINK_REMOVE) jsEdFreeC(i, state.svTime);
      else if (thinkFn === FN_THINK_SPAWN) { const r2 = jsEdAllocC(0, state.numEdicts); state.numEdicts = r2.numEdicts; }
    }
    state.svTime = time + frametime;
  }

  const chk = new Check('svframe.spawnRemoveCoherence');

  // --- Scenario A: mid-loop remove -------------------------------------------
  {
    resetSharedState();
    x.resetVm();
    const N = 5;
    x.setNumEdicts(N);
    const jsState = { numEdicts: N, svTime: 0 };
    for (let e = 1; e < N; e++) { edicts.setf(e, F.MOVETYPE, MT.none); x.edStoreFloat(e, F.MOVETYPE, MT.none); edicts.setf(e, F.NEXTTHINK, 0); x.edStoreFloat(e, F.NEXTTHINK, 0); edicts.seti(e, F.THINK, 0); x.edStoreInt(e, F.THINK, 0); edicts.free[e] = false; x.setEdictFree(e, 0); }
    const time = 10.0, frametime = 0.1;
    edicts.setf(2, F.NEXTTHINK, time + 0.01); x.edStoreFloat(2, F.NEXTTHINK, time + 0.01);
    edicts.seti(2, F.THINK, FN_THINK_REMOVE); x.edStoreInt(2, F.THINK, FN_THINK_REMOVE);

    x.physicsFrame(time, frametime);
    jsPhysicsFrameSynthetic(jsState, time, frametime);

    chk.intEq(x.isEdictFree(2), 1, 'sceneA entity2 free after frame1');
    chk.intEq(x.isEdictFree(2), edicts.free[2] ? 1 : 0, 'sceneA free-flag match frame1');
    chk.intEq(x.getNumEdicts(), jsState.numEdicts, 'sceneA numEdicts unchanged frame1');
    chk.intEq(x.getNumEdicts(), N, 'sceneA numEdicts still N frame1');

    // Second frame: freed entity must be skipped entirely (no crash, no field churn).
    x.setNumEdicts(x.getNumEdicts());
    x.physicsFrame(time + frametime, frametime);
    jsPhysicsFrameSynthetic(jsState, time + frametime, frametime);
    chk.intEq(x.isEdictFree(2), 1, 'sceneA entity2 stays free frame2');
    for (let f = 0; f < entityfields; f++) {
      chk.intEq(x.edLoadInt(2, f), edicts.i(2, f), `sceneA entity2 field[${f}] frame2 match`);
    }
  }

  // --- Scenario B: spawn grows num_edicts, new edict visited SAME frame -----
  {
    resetSharedState();
    x.resetVm();
    const N = 3;
    x.setNumEdicts(N);
    const jsState = { numEdicts: N, svTime: 0 };
    for (let e = 1; e < N; e++) { edicts.setf(e, F.MOVETYPE, MT.none); x.edStoreFloat(e, F.MOVETYPE, MT.none); edicts.setf(e, F.NEXTTHINK, 0); x.edStoreFloat(e, F.NEXTTHINK, 0); edicts.seti(e, F.THINK, 0); x.edStoreInt(e, F.THINK, 0); edicts.free[e] = false; x.setEdictFree(e, 0); }
    const time = 20.0, frametime = 0.1;
    edicts.setf(1, F.NEXTTHINK, time + 0.01); x.edStoreFloat(1, F.NEXTTHINK, time + 0.01);
    edicts.seti(1, F.THINK, FN_THINK_SPAWN); x.edStoreInt(1, F.THINK, FN_THINK_SPAWN);

    x.physicsFrame(time, frametime);
    jsPhysicsFrameSynthetic(jsState, time, frametime);

    chk.intEq(x.getNumEdicts(), N + 1, 'sceneB numEdicts grew by 1');
    chk.intEq(x.getNumEdicts(), jsState.numEdicts, 'sceneB numEdicts wasm==js');
    chk.intEq(x.isEdictFree(N), 0, 'sceneB new edict not free');
    chk.intEq(x.isEdictFree(N), edicts.free[N] ? 1 : 0, 'sceneB new edict free-flag match');
    for (let f = 0; f < entityfields; f++) {
      chk.intEq(x.edLoadInt(N, f), edicts.i(N, f), `sceneB new edict field[${f}] match (expect all-zero)`);
    }
    chk.intEq(x.edLoadInt(N, F.MOVETYPE), 0, 'sceneB new edict movetype is 0 (none, cleared)');
  }

  results.push(chk.report());
}

console.log(`[hostErrors] ${hostErrors.length} vm.hostError() calls during the whole run (expect 0)`);
const ok = results.every(Boolean) && hostErrors.length === 0;
process.exit(ok ? 0 : 1);
