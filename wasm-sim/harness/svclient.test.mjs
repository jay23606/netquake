// Golden parity test: assembly/svclient.ts (SV_Physics_Client + SV_ClientThink
// + the movement functions) vs a JS reference transliterated from
// src/engine/sv.ts, executing REAL id1 progs.dat functions through the SAME
// builtin-free eligibility-filtered differential technique as
// progs_smoke.test.mjs / svframe.test.mjs (whose JS reference interpreter and
// eligibility analysis this test reuses verbatim), plus the world/link/motion
// JS reference from svphysics.test.mjs / svframe.test.mjs (self-contained
// duplication -- same project convention every *.test.mjs here follows).
//
// PlayerPreThink/PlayerPostThink stand-ins: the REAL id1 PlayerPreThink/
// PlayerPostThink QC functions are NOT builtin-free (they call sound/ambient/
// rule-check builtins), so this test can't execute them through the
// builtin-free JS reference interpreter (same reasoning progs_smoke/svframe
// already documented for "thinks"). Per the task's guidance, this test
// installs two ELIGIBLE zero-arg builtin-free candidates (from the SAME
// eligibility filter) at the globals[PlayerPreThink]/[PlayerPostThink] slots
// for BOTH the WASM and JS-reference runs -- this still proves the QC-call
// integration (globals.time/self plumbing, execute() dispatch at the right
// points relative to the movement code) bit-exact, without needing the real
// semantic function.
//
// World hull: a 4-band vertical hull (SOLID below -128, EMPTY -128..0, WATER
// 0..64, EMPTY above 64) so ground/air/water fixtures can be placed by Z
// alone while keeping pointContents species distinct from the floor-collision
// plane.
//
// Sections:
//   A. Single client-frame differential across ground/air/water fixtures,
//      random velocities + random usercmds (forward/side/up/angles/buttons),
//      every client movetype (walk/fly/noclip/toss/bounce/none). Compares the
//      FULL globals array + every touched edict field, bit-exact.
//   B. Multi-frame differential (several consecutive frames per fixture,
//      reusing the SAME usercmd across the run like a held key).
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { rng, Check } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = join(HERE, '..', 'build', 'svclient.wasm');
const PROGS_PATH = join(HERE, '..', 'build', 'id1_progs.dat');

if (!existsSync(PROGS_PATH)) {
  console.log('[SKIP] svclient.differential: build/id1_progs.dat not found ' +
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

const GLOBAL_SELF = 28, GLOBAL_OTHER = 29, GLOBAL_TIME = 31;
const GLOBAL_PLAYERPRETHINK = 84, GLOBAL_PLAYERPOSTTHINK = 85;
const FIELD_FRAME = 30, FIELD_THINK = 44, FIELD_NEXTTHINK = 46;
const PARM0 = 4;

// --- entvars field indices (src/engine/pr.ts entvars, vanilla layout) ---------
const F = {
  MOVETYPE: 8, SOLID: 9,
  ABSMIN: 1, ABSMIN1: 2, ABSMIN2: 3, ABSMAX: 4, ABSMAX1: 5, ABSMAX2: 6,
  ORIGIN: 10, ORIGIN1: 11, ORIGIN2: 12,
  OLDORIGIN: 13, OLDORIGIN1: 14, OLDORIGIN2: 15,
  VELOCITY: 16, VELOCITY1: 17, VELOCITY2: 18,
  ANGLES: 19, ANGLES1: 20, ANGLES2: 21,
  AVELOCITY: 22, AVELOCITY1: 23, AVELOCITY2: 24,
  PUNCHANGLE: 25, PUNCHANGLE1: 26, PUNCHANGLE2: 27,
  MODEL: 29, FRAME: 30, SKIN: 31,
  MINS: 33, MINS1: 34, MINS2: 35, MAXS: 36, MAXS1: 37, MAXS2: 38, SIZE: 39,
  THINK: 44, NEXTTHINK: 46, GROUNDENTITY: 47, HEALTH: 48,
  VIEW_OFS: 62, VIEW_OFS1: 63, VIEW_OFS2: 64,
  BUTTON0: 65, BUTTON1: 66, BUTTON2: 67, IMPULSE: 68, FIXANGLE: 69,
  V_ANGLE: 70, V_ANGLE1: 71, V_ANGLE2: 72,
  FLAGS: 76, COLORMAP: 77,
  TELEPORT_TIME: 80, WATERLEVEL: 83, WATERTYPE: 84,
  OWNER: 95, MOVEDIR: 96, MOVEDIR1: 97,
};
const SOLID_NOT = 0, SOLID_TRIGGER = 1, SOLID_BBOX = 2, SOLID_SLIDEBOX = 3, SOLID_BSP = 4;
const FL_FLY = 1, FL_SWIM = 2, FL_ITEM = 256, FL_ONGROUND = 512, FL_MONSTER = 32, FL_WATERJUMP = 2048;
const MOVE_NORMAL = 0, MOVE_NOMONSTERS = 1, MOVE_MISSILE = 2;
const MT = { none: 0, walk: 3, step: 4, fly: 5, toss: 6, push: 7, noclip: 8, flymissile: 9, bounce: 10 };
const CONTENTS_EMPTY = -1, CONTENTS_SOLID = -2, CONTENTS_WATER = -3;

// ============================================================================
// Load progs.dat into svclient.wasm
// ============================================================================
const progsBytes = new Uint8Array(readFileSync(PROGS_PATH));
const wasmBytes = readFileSync(WASM_PATH);

const hostErrors = [];
const __imports = {
  env: { abort: (msg, file, line, col) => { throw new Error(`svclient.wasm abort @${line}:${col}`); } },
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
  // Every builtin exercised in this test is builtin-free by construction
  // (eligibility filter) -- these never fire either way. Proxy-stub any
  // namespace so instantiation succeeds regardless.
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

const MAX_EDICTS = 64;

// ============================================================================
// progs.dat loader (same shape as progsLoader.mjs, inlined here so this test
// also installs into GLOBALS the two picked eligible-candidate function
// indices at PlayerPreThink/PlayerPostThink -- progsLoader.mjs's own loader
// doesn't know about that override, so we do the install steps ourselves).
// ============================================================================
import { loadProgs } from './progsLoader.mjs';
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

// ============================================================================
// ELIGIBILITY ANALYSIS -- copied verbatim from svframe.test.mjs (see that
// file for the full rationale of every step), narrowed to numparms===0
// candidates (PlayerPreThink/PlayerPostThink and think are all `void()`).
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

// Exclude SOLID-writers (see svframe.test.mjs's identical rationale -- a
// think/PreThink/PostThink stand-in that reassigns .solid could construct the
// same "trigger in clipping list" fatal scenario svmove.ts's unreachable()
// guards against, out of real gameplay context).
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
console.log(`[eligibility] builtin-free & seed-safe=${eligible.length} / ${withStmts.length}; zero-arg=${thinkCandidates.length}`);
if (thinkCandidates.length < 2) {
  console.log('[SKIP] svclient.differential: fewer than 2 zero-arg builtin-free candidate functions found.');
  process.exit(0);
}

// ============================================================================
// JS reference QC interpreter -- identical to progs_smoke/svframe's makeRefInterp.
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
// JS reference world/link/motion machinery -- copied from svframe.test.mjs's
// own JS reference (self-contained duplication, same project convention).
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
  // QSS-M SV_LinkEdict order: store origin+mins/maxs into the f32 fields FIRST, then adjust the
  // stored values (two f32 roundings per axis) — matches sv.ts refreshLeafs + wasm linkEdict.
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
function jsFlyMove(edicts, root, worldHull, e, time, steptraceOut) {
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
    } else if (planeN[2] === 0.0) {
      blocked |= 2;
      if (steptraceOut) { steptraceOut[0] = planeN[0]; steptraceOut[1] = planeN[1]; steptraceOut[2] = planeN[2]; }
    }
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
  return trace;
}
function jsAddGravity(edicts, e, frametime, gravityCvar, gravityFieldIdx) {
  let entGravity = 1.0;
  if (gravityFieldIdx >= 0) { const g = edicts.f(e, gravityFieldIdx); entGravity = (g !== 0.0) ? g : 1.0; }
  const v2 = edicts.f(e, F.VELOCITY2);
  edicts.setf(e, F.VELOCITY2, v2 - entGravity * gravityCvar * frametime);
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
}

// ============================================================================
// JS reference SV_Physics_Client / SV_ClientThink / movement functions --
// transliterated from src/engine/sv.ts, mirrors assembly/svclient.ts exactly
// (see that file's header for the same SCOPE/exclusion commentary: onladder
// always false, network parse excluded, etc.)
// ============================================================================
function makeClientReference(edicts, links, root, worldHull, ref) {
  let maxVelocity = 2000, gravityCvar = 800, gravityFieldIdx = -1;
  let maxSpeed = 320, accelerateCvar = 10, friction = 4, edgeFriction = 2, stopSpeed = 100, noStep = 0;
  let rollAngle = 2.0, rollSpeed = 200.0;
  let cmdForward = 0, cmdSide = 0, cmdUp = 0;
  const steptrace = [0, 0, 0];

  function runThinkClient(e, svTime, frametime) {
    let thinktime = edicts.f(e, F.NEXTTHINK);
    if (thinktime <= 0.0 || thinktime > (svTime + frametime)) return true;
    if (thinktime < svTime) thinktime = svTime;
    edicts.setf(e, F.NEXTTHINK, 0.0);
    ri_rf_time(svTime, thinktime);
    ri[GLOBAL_SELF] = e; ri[GLOBAL_OTHER] = 0;
    ref.execute(edicts.i(e, F.THINK));
    return !edicts.free[e];
  }
  function ri_rf_time(_unused, thinktime) { rf[GLOBAL_TIME] = Math.fround(thinktime); }

  function testEntityPosition(e) {
    const o = [edicts.f(e, F.ORIGIN), edicts.f(e, F.ORIGIN1), edicts.f(e, F.ORIGIN2)];
    const mins = [edicts.f(e, F.MINS), edicts.f(e, F.MINS1), edicts.f(e, F.MINS2)];
    const maxs = [edicts.f(e, F.MAXS), edicts.f(e, F.MAXS1), edicts.f(e, F.MAXS2)];
    return jsMove(edicts, root, worldHull, o, mins, maxs, o, MOVE_NORMAL, e).startsolid === true;
  }
  function checkStuck(e) {
    if (testEntityPosition(e) !== true) {
      edicts.setf(e, F.OLDORIGIN, edicts.f(e, F.ORIGIN)); edicts.setf(e, F.OLDORIGIN1, edicts.f(e, F.ORIGIN1)); edicts.setf(e, F.OLDORIGIN2, edicts.f(e, F.ORIGIN2));
      return;
    }
    const org = [edicts.f(e, F.ORIGIN), edicts.f(e, F.ORIGIN1), edicts.f(e, F.ORIGIN2)];
    edicts.setf(e, F.ORIGIN, edicts.f(e, F.OLDORIGIN)); edicts.setf(e, F.ORIGIN1, edicts.f(e, F.OLDORIGIN1)); edicts.setf(e, F.ORIGIN2, edicts.f(e, F.OLDORIGIN2));
    if (testEntityPosition(e) !== true) { jsLinkEdict(edicts, links, root, e); return; }
    for (let z = 0; z <= 17; z++) {
      for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
          edicts.setf(e, F.ORIGIN, org[0] + i); edicts.setf(e, F.ORIGIN1, org[1] + j); edicts.setf(e, F.ORIGIN2, org[2] + z);
          if (testEntityPosition(e) !== true) { jsLinkEdict(edicts, links, root, e); return; }
        }
      }
    }
    edicts.setf(e, F.ORIGIN, org[0]); edicts.setf(e, F.ORIGIN1, org[1]); edicts.setf(e, F.ORIGIN2, org[2]);
  }
  function checkWater(e) {
    const o = [edicts.f(e, F.ORIGIN), edicts.f(e, F.ORIGIN1), edicts.f(e, F.ORIGIN2)];
    const mins2 = edicts.f(e, F.MINS2), maxs2 = edicts.f(e, F.MAXS2), viewOfs2 = edicts.f(e, F.VIEW_OFS2);
    edicts.setf(e, F.WATERLEVEL, 0.0); edicts.setf(e, F.WATERTYPE, -1.0);
    let pz = o[2] + mins2 + 1.0;
    let cont = jsHullPointContents(worldHull, worldHull.firstclipnode, [o[0], o[1], pz]);
    if (cont > CONTENTS_WATER) return false;
    edicts.setf(e, F.WATERTYPE, cont); edicts.setf(e, F.WATERLEVEL, 1.0);
    pz = o[2] + (mins2 + maxs2) * 0.5;
    cont = jsHullPointContents(worldHull, worldHull.firstclipnode, [o[0], o[1], pz]);
    if (cont <= CONTENTS_WATER) {
      edicts.setf(e, F.WATERLEVEL, 2.0);
      pz = o[2] + viewOfs2;
      cont = jsHullPointContents(worldHull, worldHull.firstclipnode, [o[0], o[1], pz]);
      if (cont <= CONTENTS_WATER) edicts.setf(e, F.WATERLEVEL, 3.0);
    }
    return edicts.f(e, F.WATERLEVEL) > 1.0;
  }
  function wallFriction(e) {
    const vaX = edicts.f(e, F.V_ANGLE), vaY = edicts.f(e, F.V_ANGLE1);
    const pitchRad = vaX * Math.PI / 180, sp = Math.sin(pitchRad), cp = Math.cos(pitchRad);
    const yawRad = vaY * Math.PI / 180, sy = Math.sin(yawRad), cy = Math.cos(yawRad);
    const fw = [cp * cy, cp * sy, -sp];
    const n = steptrace;
    let d = n[0] * fw[0] + n[1] * fw[1] + n[2] * fw[2] + 0.5;
    if (d >= 0.0) return;
    d += 1.0;
    const vel = [edicts.f(e, F.VELOCITY), edicts.f(e, F.VELOCITY1), edicts.f(e, F.VELOCITY2)];
    const i = n[0] * vel[0] + n[1] * vel[1] + n[2] * vel[2];
    edicts.setf(e, F.VELOCITY, (vel[0] - n[0] * i) * d);
    edicts.setf(e, F.VELOCITY1, (vel[1] - n[1] * i) * d);
  }
  function tryUnstick(e, oldvel) {
    const oldorg = [edicts.f(e, F.ORIGIN), edicts.f(e, F.ORIGIN1), edicts.f(e, F.ORIGIN2)];
    let dir = [2.0, 0.0, 0.0];
    let clip = 0;
    for (let i = 0; i <= 7; i++) {
      switch (i) {
        case 1: dir = [0.0, 2.0, 0.0]; break;
        case 2: dir = [-2.0, 0.0, 0.0]; break;
        case 3: dir = [0.0, -2.0, 0.0]; break;
        case 4: dir = [2.0, 2.0, 0.0]; break;
        case 5: dir = [-2.0, 2.0, 0.0]; break;
        case 6: dir = [2.0, -2.0, 0.0]; break;
        case 7: dir = [-2.0, -2.0, 0.0]; break;
      }
      jsPushEntity(edicts, links, root, worldHull, e, dir);
      edicts.setf(e, F.VELOCITY, oldvel[0]); edicts.setf(e, F.VELOCITY1, oldvel[1]); edicts.setf(e, F.VELOCITY2, 0.0);
      clip = jsFlyMove(edicts, root, worldHull, e, 0.1, steptrace);
      if (Math.abs(oldorg[1] - edicts.f(e, F.ORIGIN1)) > 4.0 || Math.abs(oldorg[0] - edicts.f(e, F.ORIGIN)) > 4.0) return clip;
      edicts.setf(e, F.ORIGIN, oldorg[0]); edicts.setf(e, F.ORIGIN1, oldorg[1]); edicts.setf(e, F.ORIGIN2, oldorg[2]);
    }
    edicts.setf(e, F.VELOCITY, 0.0); edicts.setf(e, F.VELOCITY1, 0.0); edicts.setf(e, F.VELOCITY2, 0.0);
    return 7;
  }
  function walkMove(e, frametime) {
    const flags0 = edicts.f(e, F.FLAGS) | 0;
    const oldonground = flags0 & FL_ONGROUND;
    edicts.setf(e, F.FLAGS, flags0 ^ oldonground);
    const oldorg = [edicts.f(e, F.ORIGIN), edicts.f(e, F.ORIGIN1), edicts.f(e, F.ORIGIN2)];
    const oldvel = [edicts.f(e, F.VELOCITY), edicts.f(e, F.VELOCITY1), edicts.f(e, F.VELOCITY2)];
    let clip = jsFlyMove(edicts, root, worldHull, e, frametime, null);
    if ((clip & 2) === 0) return;
    if (oldonground === 0 && edicts.f(e, F.WATERLEVEL) === 0.0) return;
    if ((edicts.f(e, F.MOVETYPE) | 0) !== MT.walk) return;
    if (noStep !== 0) return;
    if (((edicts.f(e, F.FLAGS) | 0) & FL_WATERJUMP) !== 0) return;
    const nosteporg = [edicts.f(e, F.ORIGIN), edicts.f(e, F.ORIGIN1), edicts.f(e, F.ORIGIN2)];
    const nostepvel = [edicts.f(e, F.VELOCITY), edicts.f(e, F.VELOCITY1), edicts.f(e, F.VELOCITY2)];
    edicts.setf(e, F.ORIGIN, oldorg[0]); edicts.setf(e, F.ORIGIN1, oldorg[1]); edicts.setf(e, F.ORIGIN2, oldorg[2]);
    jsPushEntity(edicts, links, root, worldHull, e, [0, 0, 18]);
    edicts.setf(e, F.VELOCITY, oldvel[0]); edicts.setf(e, F.VELOCITY1, oldvel[1]); edicts.setf(e, F.VELOCITY2, 0.0);
    clip = jsFlyMove(edicts, root, worldHull, e, frametime, steptrace);
    if (clip !== 0) {
      if (Math.abs(oldorg[1] - edicts.f(e, F.ORIGIN1)) < 0.03125 && Math.abs(oldorg[0] - edicts.f(e, F.ORIGIN)) < 0.03125) {
        clip = tryUnstick(e, oldvel);
      }
      if ((clip & 2) !== 0) wallFriction(e);
    }
    const stepDown = [0, 0, oldvel[2] * frametime - 18];
    const downtrace = jsPushEntity(edicts, links, root, worldHull, e, stepDown);
    if (downtrace.plane.normal[2] > 0.7) {
      if ((edicts.f(e, F.SOLID) | 0) === SOLID_BSP) {
        const f = edicts.f(e, F.FLAGS) | 0;
        edicts.setf(e, F.FLAGS, f | FL_ONGROUND);
        edicts.seti(e, F.GROUNDENTITY, downtrace.ent);
      }
      return;
    }
    edicts.setf(e, F.ORIGIN, nosteporg[0]); edicts.setf(e, F.ORIGIN1, nosteporg[1]); edicts.setf(e, F.ORIGIN2, nosteporg[2]);
    edicts.setf(e, F.VELOCITY, nostepvel[0]); edicts.setf(e, F.VELOCITY1, nostepvel[1]); edicts.setf(e, F.VELOCITY2, nostepvel[2]);
  }
  function userFriction(e, frametime) {
    const vel0 = edicts.f(e, F.VELOCITY), vel1 = edicts.f(e, F.VELOCITY1);
    const speed = Math.sqrt(vel0 * vel0 + vel1 * vel1);
    if (speed === 0.0) return;
    const o = [edicts.f(e, F.ORIGIN), edicts.f(e, F.ORIGIN1), edicts.f(e, F.ORIGIN2)];
    const mins2 = edicts.f(e, F.MINS2);
    const start = [o[0] + vel0 / speed * 16.0, o[1] + vel1 / speed * 16.0, o[2] + mins2];
    let fric = friction;
    const end = [start[0], start[1], start[2] - 34.0];
    const trace = jsMove(edicts, root, worldHull, start, [0, 0, 0], [0, 0, 0], end, MOVE_NOMONSTERS, e);
    if (trace.fraction === 1.0) fric *= edgeFriction;
    let newspeed = speed - frametime * ((speed < stopSpeed) ? stopSpeed : speed) * fric;
    if (newspeed < 0.0) newspeed = 0.0;
    newspeed /= speed;
    const vel2 = edicts.f(e, F.VELOCITY2);
    edicts.setf(e, F.VELOCITY, vel0 * newspeed); edicts.setf(e, F.VELOCITY1, vel1 * newspeed); edicts.setf(e, F.VELOCITY2, vel2 * newspeed);
  }
  function accelerateFn(e, wv, air, wd, wishspeed, frametime) {
    const vel = [edicts.f(e, F.VELOCITY), edicts.f(e, F.VELOCITY1), edicts.f(e, F.VELOCITY2)];
    let addspeed, mul;
    if (air) {
      const len = Math.sqrt(wv[0] * wv[0] + wv[1] * wv[1] + wv[2] * wv[2]);
      let nwv = [0, 0, 0];
      if (len !== 0.0) nwv = [wv[0] / len, wv[1] / len, wv[2] / len];
      let wishAir = len; if (wishAir > 30) wishAir = 30;
      addspeed = wishAir - (vel[0] * nwv[0] + vel[1] * nwv[1] + vel[2] * nwv[2]);
      mul = nwv;
    } else {
      addspeed = wishspeed - (vel[0] * wd[0] + vel[1] * wd[1] + vel[2] * wd[2]);
      mul = wd;
    }
    if (addspeed <= 0.0) return;
    let accelspeed = accelerateCvar * frametime * wishspeed;
    if (accelspeed > addspeed) accelspeed = addspeed;
    edicts.setf(e, F.VELOCITY, vel[0] + accelspeed * mul[0]);
    edicts.setf(e, F.VELOCITY1, vel[1] + accelspeed * mul[1]);
    edicts.setf(e, F.VELOCITY2, vel[2] + accelspeed * mul[2]);
  }
  function waterMove(e, frametime) {
    const vaX = edicts.f(e, F.V_ANGLE), vaY = edicts.f(e, F.V_ANGLE1), vaZ = edicts.f(e, F.V_ANGLE2);
    const pitchRad = vaX * Math.PI / 180, sp = Math.sin(pitchRad), cp = Math.cos(pitchRad);
    const yawRad = vaY * Math.PI / 180, sy = Math.sin(yawRad), cy = Math.cos(yawRad);
    const rollRad = vaZ * Math.PI / 180, sr = Math.sin(rollRad), cr = Math.cos(rollRad);
    const fw = [cp * cy, cp * sy, -sp];
    const r = [cr * sy - sr * sp * cy, -sr * sp * sy - cr * cy, -sr * cp];
    const fm = cmdForward, sm = cmdSide, um = cmdUp;
    let wish = [fw[0] * fm + r[0] * sm, fw[1] * fm + r[1] * sm, fw[2] * fm + r[2] * sm];
    if (fm === 0.0 && sm === 0.0 && um === 0.0) wish[2] -= 60.0; else wish[2] += um;
    let wishspeed = Math.sqrt(wish[0] * wish[0] + wish[1] * wish[1] + wish[2] * wish[2]);
    if (wishspeed > maxSpeed) {
      const scale = maxSpeed / wishspeed;
      wish = [wish[0] * scale, wish[1] * scale, wish[2] * scale];
      wishspeed = maxSpeed;
    }
    wishspeed *= 0.7;
    const vel = [edicts.f(e, F.VELOCITY), edicts.f(e, F.VELOCITY1), edicts.f(e, F.VELOCITY2)];
    const speed = Math.sqrt(vel[0] * vel[0] + vel[1] * vel[1] + vel[2] * vel[2]);
    let newspeed;
    if (speed !== 0.0) {
      newspeed = speed - frametime * speed * friction;
      if (newspeed < 0.0) newspeed = 0.0;
      const scale = newspeed / speed;
      edicts.setf(e, F.VELOCITY, vel[0] * scale); edicts.setf(e, F.VELOCITY1, vel[1] * scale); edicts.setf(e, F.VELOCITY2, vel[2] * scale);
    } else newspeed = 0.0;
    if (wishspeed === 0.0) return;
    const addspeed = wishspeed - newspeed;
    if (addspeed <= 0.0) return;
    let accelspeed = accelerateCvar * wishspeed * frametime;
    if (accelspeed > addspeed) accelspeed = addspeed;
    edicts.setf(e, F.VELOCITY, edicts.f(e, F.VELOCITY) + accelspeed * (wish[0] / wishspeed));
    edicts.setf(e, F.VELOCITY1, edicts.f(e, F.VELOCITY1) + accelspeed * (wish[1] / wishspeed));
    edicts.setf(e, F.VELOCITY2, edicts.f(e, F.VELOCITY2) + accelspeed * (wish[2] / wishspeed));
  }
  function waterJump(e, svTime) {
    if (svTime > edicts.f(e, F.TELEPORT_TIME) || edicts.f(e, F.WATERLEVEL) === 0.0) {
      const f = edicts.f(e, F.FLAGS) | 0;
      edicts.setf(e, F.FLAGS, f & ~FL_WATERJUMP);
      edicts.setf(e, F.TELEPORT_TIME, 0.0);
    }
    edicts.setf(e, F.VELOCITY, edicts.f(e, F.MOVEDIR));
    edicts.setf(e, F.VELOCITY1, edicts.f(e, F.MOVEDIR1));
  }
  function airMove(e, svTime, frametime) {
    const angX = edicts.f(e, F.ANGLES), angY = edicts.f(e, F.ANGLES1), angZ = edicts.f(e, F.ANGLES2);
    const pitchRad = angX * Math.PI / 180, sp = Math.sin(pitchRad), cp = Math.cos(pitchRad);
    const yawRad = angY * Math.PI / 180, sy = Math.sin(yawRad), cy = Math.cos(yawRad);
    const rollRad = angZ * Math.PI / 180, sr = Math.sin(rollRad), cr = Math.cos(rollRad);
    const fw = [cp * cy, cp * sy, -sp];
    const r = [cr * sy - sr * sp * cy, -sr * sp * sy - cr * cy, -sr * cp];
    let fmove = cmdForward; const smove = cmdSide;
    if (svTime < edicts.f(e, F.TELEPORT_TIME) && fmove < 0.0) fmove = 0.0;
    const movetype = edicts.f(e, F.MOVETYPE) | 0;
    let wish = [fw[0] * fmove + r[0] * smove, fw[1] * fmove + r[1] * smove, (movetype !== MT.walk) ? cmdUp : 0.0];
    const wishspeed0 = Math.sqrt(wish[0] * wish[0] + wish[1] * wish[1] + wish[2] * wish[2]);
    let wdir = [0, 0, 0];
    if (wishspeed0 !== 0.0) wdir = [wish[0] / wishspeed0, wish[1] / wishspeed0, wish[2] / wishspeed0];
    let wishspeed = wishspeed0;
    const scaler = maxSpeed / wishspeed;
    if (wishspeed > maxSpeed) { wish = [wish[0] * scaler, wish[1] * scaler, wish[2] * scaler]; wishspeed = maxSpeed; }
    if (movetype === MT.noclip) {
      edicts.setf(e, F.VELOCITY, wish[0]); edicts.setf(e, F.VELOCITY1, wish[1]); edicts.setf(e, F.VELOCITY2, wish[2]);
    } else if (((edicts.f(e, F.FLAGS) | 0) & FL_ONGROUND) !== 0) {
      userFriction(e, frametime);
      accelerateFn(e, wish, false, wdir, wishspeed, frametime);
    } else {
      accelerateFn(e, wish, true, wdir, wishspeed, frametime);
    }
  }
  function calcRoll(ang, vel) {
    const pitchRad = ang[0] * Math.PI / 180, sp = Math.sin(pitchRad), cp = Math.cos(pitchRad);
    const yawRad = ang[1] * Math.PI / 180, sy = Math.sin(yawRad), cy = Math.cos(yawRad);
    const rollRad = ang[2] * Math.PI / 180, sr = Math.sin(rollRad), cr = Math.cos(rollRad);
    const right = [cr * sy - sr * sp * cy, -sr * sp * sy - cr * cy, -sr * cp];
    let side = vel[0] * right[0] + vel[1] * right[1] + vel[2] * right[2];
    const sign = side < 0.0 ? -1.0 : 1.0;
    side = Math.abs(side);
    if (side < rollSpeed) return side * sign * rollAngle / rollSpeed;
    return rollAngle * sign;
  }
  function clientThink(e, svTime, frametime) {
    const movetype = edicts.f(e, F.MOVETYPE) | 0;
    if (movetype === MT.none) return;
    const p = [edicts.f(e, F.PUNCHANGLE), edicts.f(e, F.PUNCHANGLE1), edicts.f(e, F.PUNCHANGLE2)];
    const plen = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
    let u = [0, 0, 0];
    if (plen !== 0.0) u = [p[0] / plen, p[1] / plen, p[2] / plen];
    let len = plen - 10.0 * frametime;
    if (len < 0.0) len = 0.0;
    edicts.setf(e, F.PUNCHANGLE, u[0] * len); edicts.setf(e, F.PUNCHANGLE1, u[1] * len); edicts.setf(e, F.PUNCHANGLE2, u[2] * len);
    if (edicts.f(e, F.HEALTH) <= 0.0) return;
    const ang = [edicts.f(e, F.ANGLES), edicts.f(e, F.ANGLES1), edicts.f(e, F.ANGLES2)];
    const vel = [edicts.f(e, F.VELOCITY), edicts.f(e, F.VELOCITY1), edicts.f(e, F.VELOCITY2)];
    edicts.setf(e, F.ANGLES2, calcRoll(ang, vel) * 4.0);
    if (edicts.f(e, F.FIXANGLE) === 0.0) {
      const va = [edicts.f(e, F.V_ANGLE), edicts.f(e, F.V_ANGLE1)];
      const pu = [edicts.f(e, F.PUNCHANGLE), edicts.f(e, F.PUNCHANGLE1)];
      edicts.setf(e, F.ANGLES, (va[0] + pu[0]) / -3.0);
      edicts.setf(e, F.ANGLES1, va[1] + pu[1]);
    }
    const flags = edicts.f(e, F.FLAGS) | 0;
    if ((flags & FL_WATERJUMP) !== 0) waterJump(e, svTime);
    else if (edicts.f(e, F.WATERLEVEL) >= 2.0 && (edicts.f(e, F.MOVETYPE) | 0) !== MT.noclip) waterMove(e, frametime);
    else airMove(e, svTime, frametime);
  }

  function physicsClient(e, svTime, frametime) {
    clientThink(e, svTime, frametime);
    rf[GLOBAL_TIME] = Math.fround(svTime); ri[GLOBAL_SELF] = e;
    ref.execute(preThinkFn);
    jsCheckVelocity(edicts, e, maxVelocity);
    const movetype = edicts.f(e, F.MOVETYPE) | 0;
    if (movetype === MT.toss || movetype === MT.bounce) {
      if (runThinkClient(e, svTime, frametime)) jsPhysicsToss(edicts, links, root, worldHull, e, frametime, maxVelocity, gravityCvar, gravityFieldIdx);
    } else {
      if (!runThinkClient(e, svTime, frametime)) return;
      switch (movetype) {
        case MT.none: break;
        case MT.walk: {
          const flags = edicts.f(e, F.FLAGS) | 0;
          if (checkWater(e) !== true && (flags & FL_WATERJUMP) === 0) jsAddGravity(edicts, e, frametime, gravityCvar, gravityFieldIdx);
          checkStuck(e);
          walkMove(e, frametime);
          break;
        }
        case MT.fly: jsFlyMove(edicts, root, worldHull, e, frametime, null); break;
        case MT.noclip:
          edicts.setf(e, F.ORIGIN, edicts.f(e, F.ORIGIN) + frametime * edicts.f(e, F.VELOCITY));
          edicts.setf(e, F.ORIGIN1, edicts.f(e, F.ORIGIN1) + frametime * edicts.f(e, F.VELOCITY1));
          edicts.setf(e, F.ORIGIN2, edicts.f(e, F.ORIGIN2) + frametime * edicts.f(e, F.VELOCITY2));
          break;
        default: break;
      }
    }
    jsLinkEdict(edicts, links, root, e);
    rf[GLOBAL_TIME] = Math.fround(svTime); ri[GLOBAL_SELF] = e;
    ref.execute(postThinkFn);
  }

  let preThinkFn = 0, postThinkFn = 0;
  return {
    physicsClient,
    setMaxVelocity: (v) => { maxVelocity = v; },
    setGravityCvar: (v) => { gravityCvar = v; },
    setGravityFieldIdx: (i) => { gravityFieldIdx = i; },
    setMaxSpeed: (v) => { maxSpeed = v; },
    setAccelerateCvar: (v) => { accelerateCvar = v; },
    setFrictionCvar: (v) => { friction = v; },
    setEdgeFrictionCvar: (v) => { edgeFriction = v; },
    setStopSpeedCvar: (v) => { stopSpeed = v; },
    setNoStep: (v) => { noStep = v; },
    setRollAngle: (v) => { rollAngle = v; },
    setRollSpeed: (v) => { rollSpeed = v; },
    setUserCmd: (e, fm, sm, um, vx, vy, vz, b0, b2, imp) => {
      cmdForward = fm; cmdSide = sm; cmdUp = um;
      edicts.setf(e, F.V_ANGLE, vx); edicts.setf(e, F.V_ANGLE1, vy); edicts.setf(e, F.V_ANGLE2, vz);
      edicts.setf(e, F.BUTTON0, b0); edicts.setf(e, F.BUTTON2, b2);
      if (imp !== 0.0) edicts.setf(e, F.IMPULSE, imp);
    },
    setPreThinkFn: (fn) => { preThinkFn = fn; },
    setPostThinkFn: (fn) => { postThinkFn = fn; },
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
// 4-band world hull: SOLID below z=-128, EMPTY [-128,0), WATER [0,64), EMPTY above 64.
function makeBandedHull() {
  return {
    clipnodes: [
      { planenum: 0, children: [CONTENTS_EMPTY, 1] },
      { planenum: 1, children: [CONTENTS_WATER, 2] },
      { planenum: 2, children: [CONTENTS_EMPTY, CONTENTS_SOLID] },
    ],
    planes: [
      { type: 2, normal: [0, 0, 1], dist: 64 },
      { type: 2, normal: [0, 0, 1], dist: 0 },
      { type: 2, normal: [0, 0, 1], dist: -128 },
    ],
    firstclipnode: 0, lastclipnode: 2,
  };
}
function loadWorldHullToWasm(hull) {
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

x.initAreaTree(-4096, -4096, -4096, 4096, 4096, 4096, MAX_EDICTS);
const worldHull = makeBandedHull();
loadWorldHullToWasm(worldHull);

const edicts = new JsEdicts(MAX_EDICTS, entityfields);
const links = []; for (let i = 0; i < MAX_EDICTS; i++) links.push({ prev: null, next: null, ent: null });
const areaNodes = [];
const areaRoot = createAreaNode(areaNodes, 0, [-4096, -4096, -4096], [4096, 4096, 4096]);
edicts.setf(0, F.SOLID, SOLID_BSP); x.edStoreFloat(0, F.SOLID, SOLID_BSP);

const G = x.globalsPtr();
const wf = new Float32Array(mem.buffer, G, Math.max(numGlobals, 8192));
const wi = new Int32Array(mem.buffer, G, Math.max(numGlobals, 8192));
const edView = new Int32Array(mem.buffer, x.edictsBase(), MAX_EDICTS * entityfields);

const refBuf = new ArrayBuffer(Math.max(numGlobals, 8192) * 4);
const rf = new Float32Array(refBuf);
const ri = new Int32Array(refBuf);
const ref = makeRefInterp(ri, rf, edicts.vi, entityfields);
const svref = makeClientReference(edicts, links, areaRoot, worldHull, ref);

// PlayerPreThink/PlayerPostThink stand-ins: two distinct eligible candidates
// (see header). Installed at the GLOBAL slot on BOTH sides so `execute(readGlobalInt(...))`
// (wasm) / `ref.execute(...)` (js) dispatch identically.
const preThinkFn = thinkCandidates[0];
const postThinkFn = thinkCandidates[1 % thinkCandidates.length] === preThinkFn && thinkCandidates.length > 1 ? thinkCandidates[1] : thinkCandidates[thinkCandidates.length - 1];
svref.setPreThinkFn(preThinkFn);
svref.setPostThinkFn(postThinkFn);
console.log(`[stand-ins] PlayerPreThink=fn${preThinkFn} PlayerPostThink=fn${postThinkFn}`);

const ENT_RANGE = 4; // world(0) + client(1) + 2 spare filler slots
const CLIENT = 1;

function resetGlobals() {
  wi.set(globalsInitial.subarray(0, Math.max(numGlobals, 8192)));
  ri.set(globalsInitial.subarray(0, Math.max(numGlobals, 8192)));
  wi[GLOBAL_PLAYERPRETHINK] = preThinkFn; wi[GLOBAL_PLAYERPOSTTHINK] = postThinkFn;
  ri[GLOBAL_PLAYERPRETHINK] = preThinkFn; ri[GLOBAL_PLAYERPOSTTHINK] = postThinkFn;
}
function resetClientEdict() {
  for (let f = 0; f < entityfields; f++) { edView[CLIENT * entityfields + f] = 0; edicts.vi[CLIENT * entityfields + f] = 0; }
  edicts.free[CLIENT] = false; x.setEdictFree(CLIENT, 0);
}

const KIND = { GROUND: 0, AIR: 1, WATER: 2 };
function placeFixture(kind, r) {
  const hx = 16, hy = 16, hz = 24; // roughly player-sized box
  let oz;
  if (kind === KIND.GROUND) oz = -128 + hz + Math.abs(r.f32(2)); // resting just above the floor
  else if (kind === KIND.AIR) oz = 200 + Math.abs(r.f32(200));   // well above the water band
  else oz = 20 + Math.abs(r.f32(30));                             // inside the [0,64) water band

  const ox = r.f32(200), oy = r.f32(200);
  const movetypeRoll = r.int(6);
  const movetype = [MT.walk, MT.walk, MT.walk, MT.fly, MT.noclip, MT.none][movetypeRoll];
  const flagsOnGround = (kind === KIND.GROUND && r.int(2) === 0) ? FL_ONGROUND : 0;

  const setBoth = (f, v) => { edicts.setf(CLIENT, f, v); x.edStoreFloat(CLIENT, f, v); };
  const setBothI = (f, v) => { edicts.seti(CLIENT, f, v); x.edStoreInt(CLIENT, f, v); };

  setBoth(F.ORIGIN, ox); setBoth(F.ORIGIN1, oy); setBoth(F.ORIGIN2, oz);
  setBoth(F.OLDORIGIN, ox); setBoth(F.OLDORIGIN1, oy); setBoth(F.OLDORIGIN2, oz);
  setBoth(F.MINS, -hx); setBoth(F.MINS1, -hy); setBoth(F.MINS2, -hz);
  setBoth(F.MAXS, hx); setBoth(F.MAXS1, hy); setBoth(F.MAXS2, hz);
  setBoth(F.SIZE, hx * 2);
  setBoth(F.SOLID, SOLID_SLIDEBOX);
  setBoth(F.SKIN, 0);
  setBoth(F.MOVETYPE, movetype);
  setBoth(F.FLAGS, flagsOnGround);
  setBoth(F.VELOCITY, r.f32(300)); setBoth(F.VELOCITY1, r.f32(300)); setBoth(F.VELOCITY2, r.f32(200));
  setBoth(F.ANGLES, r.f32(30)); setBoth(F.ANGLES1, r.f32(180)); setBoth(F.ANGLES2, 0);
  setBoth(F.PUNCHANGLE, r.f32(5)); setBoth(F.PUNCHANGLE1, r.f32(5)); setBoth(F.PUNCHANGLE2, r.f32(5));
  setBoth(F.HEALTH, r.int(4) === 0 ? -Math.abs(r.f32(10)) : (50 + Math.abs(r.f32(50))));
  setBoth(F.FIXANGLE, r.int(4) === 0 ? 1 : 0);
  setBoth(F.VIEW_OFS2, 22);
  setBoth(F.TELEPORT_TIME, r.int(3) === 0 ? Math.abs(r.f32(50)) : 0);
  setBoth(F.MOVEDIR, r.f32(100)); setBoth(F.MOVEDIR1, r.f32(100));
  setBothI(F.GROUNDENTITY, 0);
  setBoth(F.WATERLEVEL, 0); setBoth(F.WATERTYPE, -1);
  const waterjumpFlag = (r.int(5) === 0) ? FL_WATERJUMP : 0;
  setBoth(F.FLAGS, flagsOnGround | waterjumpFlag);

  const thinkRoll = r.int(3);
  let nextthink = 0, thinkFn = 0;
  if (thinkRoll !== 0) {
    thinkFn = thinkCandidates[r.int(thinkCandidates.length)];
  }
  setBoth(F.NEXTTHINK, nextthink); setBothI(F.THINK, thinkFn);

  x.linkEdict(CLIENT); jsLinkEdict(edicts, links, areaRoot, CLIENT);
  return { thinkRoll };
}
function applyUserCmd(entNum, r, time, frametime) {
  const fm = r.f32(320), sm = r.f32(320), um = r.f32(320);
  const va0 = r.f32(80), va1 = r.f32(180), va2 = r.f32(10);
  const b0 = r.int(2), b2 = r.int(2);
  const imp = r.int(4) === 0 ? (1 + r.int(9)) : 0;
  x.setUserCmd(entNum, fm, sm, um, va0, va1, va2, b0, b2, imp);
  svref.setUserCmd(entNum, fm, sm, um, va0, va1, va2, b0, b2, imp);
}

// bit-exact i32 checker (subsumes float exactness since both sides store f32
// bit patterns on every write, per THE PARITY RULE).
function compareState(chk, label) {
  for (let i = 0; i < numGlobals; i++) {
    if (wi[i] !== ri[i]) chk.intEq(wi[i], ri[i], `${label} global[${i}]`);
  }
  for (let f = 0; f < entityfields; f++) {
    const idx = CLIENT * entityfields + f;
    if (edView[idx] !== edicts.vi[idx]) chk.intEq(edView[idx], edicts.vi[idx], `${label} client field[${f}]`);
  }
}

const results = [];

// ================================================================================
// Section A: single client-frame differential, ground/air/water x random
// velocities/usercmds/movetypes.
// ================================================================================
{
  const r = rng(0xC11E17);
  const chk = new Check('svclient.singleFrame');
  const TRIALS = 4000;
  const kinds = [KIND.GROUND, KIND.AIR, KIND.WATER];
  for (let trial = 0; trial < TRIALS; trial++) {
    resetGlobals();
    resetClientEdict();

    const time = Math.abs(r.f32(1000));
    const frametime = 0.02 + Math.abs(r.f32(0.08));
    const maxVelocity = 2000 + r.f32(500);
    const gravityCvar = 700 + r.f32(200);
    const maxSpeed = 320 + r.f32(60);
    const accelerateCvar = 10 + Math.abs(r.f32(5));
    const friction = 4 + Math.abs(r.f32(2));
    const edgeFriction = 2 + Math.abs(r.f32(2));
    const stopSpeed = 100 + Math.abs(r.f32(50));

    x.setMaxVelocity(maxVelocity); svref.setMaxVelocity(maxVelocity);
    x.setGravityCvar(gravityCvar); svref.setGravityCvar(gravityCvar);
    x.setGravityFieldIdx(-1); svref.setGravityFieldIdx(-1);
    x.setMaxSpeed(maxSpeed); svref.setMaxSpeed(maxSpeed);
    x.setAccelerateCvar(accelerateCvar); svref.setAccelerateCvar(accelerateCvar);
    x.setFrictionCvar(friction); svref.setFrictionCvar(friction);
    x.setEdgeFrictionCvar(edgeFriction); svref.setEdgeFrictionCvar(edgeFriction);
    x.setStopSpeedCvar(stopSpeed); svref.setStopSpeedCvar(stopSpeed);
    x.setNoStep(0); svref.setNoStep(0);
    x.setRollAngle(2.0); svref.setRollAngle(2.0);
    x.setRollSpeed(200.0); svref.setRollSpeed(200.0);

    const kind = kinds[trial % kinds.length];
    placeFixture(kind, r);
    applyUserCmd(CLIENT, r, time, frametime);

    x.physicsClient(CLIENT, time, frametime);
    svref.physicsClient(CLIENT, time, frametime);

    compareState(chk, `trial#${trial} kind=${kind}`);
  }
  console.log(`[svclient.singleFrame] ${TRIALS} trials run`);
  results.push(chk.report());
}

// ================================================================================
// Section B: multi-frame differential (held usercmd across several frames).
// ================================================================================
{
  const r = rng(0xC11E27);
  const chk = new Check('svclient.multiFrame');
  const FIXTURES = 200, FRAMES = 5;
  const kinds = [KIND.GROUND, KIND.AIR, KIND.WATER];
  for (let trial = 0; trial < FIXTURES; trial++) {
    resetGlobals();
    resetClientEdict();

    let time = Math.abs(r.f32(500));
    const frametime = 0.02 + Math.abs(r.f32(0.06));
    const maxVelocity = 2000 + r.f32(500);
    const gravityCvar = 700 + r.f32(200);
    const maxSpeed = 320 + r.f32(60);
    const accelerateCvar = 10 + Math.abs(r.f32(5));
    const friction = 4 + Math.abs(r.f32(2));
    const edgeFriction = 2 + Math.abs(r.f32(2));
    const stopSpeed = 100 + Math.abs(r.f32(50));

    x.setMaxVelocity(maxVelocity); svref.setMaxVelocity(maxVelocity);
    x.setGravityCvar(gravityCvar); svref.setGravityCvar(gravityCvar);
    x.setGravityFieldIdx(-1); svref.setGravityFieldIdx(-1);
    x.setMaxSpeed(maxSpeed); svref.setMaxSpeed(maxSpeed);
    x.setAccelerateCvar(accelerateCvar); svref.setAccelerateCvar(accelerateCvar);
    x.setFrictionCvar(friction); svref.setFrictionCvar(friction);
    x.setEdgeFrictionCvar(edgeFriction); svref.setEdgeFrictionCvar(edgeFriction);
    x.setStopSpeedCvar(stopSpeed); svref.setStopSpeedCvar(stopSpeed);
    x.setNoStep(0); svref.setNoStep(0);
    x.setRollAngle(2.0); svref.setRollAngle(2.0);
    x.setRollSpeed(200.0); svref.setRollSpeed(200.0);

    const kind = kinds[trial % kinds.length];
    placeFixture(kind, r);
    const fm = r.f32(320), sm = r.f32(320), um = r.f32(320);
    const va0 = r.f32(80), va1 = r.f32(180), va2 = r.f32(10);
    const b0 = r.int(2), b2 = r.int(2);

    for (let f = 0; f < FRAMES; f++) {
      // Held usercmd (like a player holding a key) -- re-applied every frame,
      // no impulse (avoid repeated impulse-triggered QC across frames, out of
      // this differential's scope).
      x.setUserCmd(CLIENT, fm, sm, um, va0, va1, va2, b0, b2, 0);
      svref.setUserCmd(CLIENT, fm, sm, um, va0, va1, va2, b0, b2, 0);

      x.physicsClient(CLIENT, time, frametime);
      svref.physicsClient(CLIENT, time, frametime);
      compareState(chk, `fixture#${trial} kind=${kind} frame#${f}`);

      // A think can reschedule itself to an unvetted successor via OP.state/
      // STORE_FNC (see svframe.test.mjs's identical rationale) -- disarm so
      // the next frame stays well-formed on both sides.
      const thinkFn = x.edLoadInt(CLIENT, F.THINK);
      if (thinkFn !== 0 && !thinkCandidates.includes(thinkFn)) {
        x.edStoreFloat(CLIENT, F.NEXTTHINK, 0.0);
        edicts.setf(CLIENT, F.NEXTTHINK, 0.0);
      }

      time += frametime;
    }
  }
  results.push(chk.report());
}

console.log(`[hostErrors] ${hostErrors.length} vm.hostError() calls during the whole run (expect 0)`);
const ok = results.every(Boolean) && hostErrors.length === 0;
process.exit(ok ? 0 : 1);
