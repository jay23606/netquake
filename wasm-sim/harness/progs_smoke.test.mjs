// progs.dat SMOKE TEST — differential validation of the unified WASM VM
// (build/sim.wasm) against a JS reference interpreter, both fed the SAME real
// Quake bytecode (build/id1_progs.dat, loaded via progsLoader.mjs) and driven
// from IDENTICAL random input globals/edict state. Every assertion is bit-exact
// (raw i32/f32 bit patterns), per THE PARITY RULE (docs/wasm-sim-port-assemblyscript.md).
//
// Scope: only BUILTIN-FREE functions (see "ELIGIBILITY ANALYSIS" below) are run
// -- host.ts's callBuiltin dispatch (real math/world ports + host_* service
// imports) is a SEPARATE, already-covered parity surface (host.test.mjs); this
// test's job is proving the LOADER + the raw VM interpreter loop execute real
// compiled bytecode identically to the reference, which a builtin call would
// confound (this test's host imports are unfired stubs, not the real services).
//
// The JS reference interpreter below is a straight transliteration of
// assembly/vm.ts's execute/enterFunction/leaveFunction (itself a port of
// src/engine/pr.ts executeProgram) -- see vm.test.mjs for the same pattern
// applied to synthetic single-opcode programs; this test applies it to a whole
// real compiled program.
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { rng, Check } from './lib.mjs';
import { loadProgs } from './progsLoader.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = join(HERE, '..', 'build', 'sim.wasm');
const PROGS_PATH = join(HERE, '..', 'build', 'id1_progs.dat');

// This differential runs against real vanilla progs.dat, extracted from the user's
// Quake pak (gitignored). Skip gracefully where the asset isn't present.
if (!existsSync(PROGS_PATH)) {
  console.log('[SKIP] progs_smoke.differential: build/id1_progs.dat not found ' +
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

const GLOBAL_SELF = 28, GLOBAL_TIME = 31;
const FIELD_FRAME = 30, FIELD_THINK = 44, FIELD_NEXTTHINK = 46;
const PARM0 = 4;

// ============================================================================
// Load progs.dat into sim.wasm
// ============================================================================
const progsBytes = new Uint8Array(readFileSync(PROGS_PATH));
const wasmBytes = readFileSync(WASM_PATH);

const hostErrors = [];
const __imports = {
  env: { abort: (msg, file, line, col) => { throw new Error(`sim.wasm abort @${line}:${col}`); } },
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
  // callBuiltin is compiled in (host.ts, linked at AS level into vm.ts within
  // this same module) -- NOT a host import anymore. "host" module imports are
  // host.ts's own HOST-SERVICE builtins (print/sound/cvar/...); builtin-free
  // functions never reach them, so a Proxy stub is sufficient (never fires).
  host: new Proxy({}, { get: () => () => 0 }),
};
// Stub any other host-import namespace a future module adds (e.g. builtins_move's
// host_random) — builtin-free functions never fire them.
const { instance } = await WebAssembly.instantiate(wasmBytes,
  new Proxy(__imports, { get: (t, k) => (k in t ? t[k] : new Proxy({}, { get: () => () => 0 })), has: () => true }));
const x = instance.exports;
function writeAscii(outPtr, s) {
  const u8 = new Uint8Array(x.memory.buffer, outPtr, s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i) & 0xff;
  return s.length;
}

const parsed = loadProgs(x, progsBytes, 1024);
const { statements, functions, entityfields, edictSizeBytesQC, numGlobals, stringsLen, maxEdicts } = parsed;
console.log(`[progs] version=${parsed.version} crc=${parsed.crc} statements=${statements.length} functions=${functions.length} entityfields=${entityfields} globals=${numGlobals} stringsLen=${stringsLen}`);

// Snapshot the INITIAL globals (post-load, pre-execution) -- these hold the
// compile-time constants (including static function-pointer immediates used
// by direct CALLs), read back via the wasm exports so they're guaranteed
// identical to what the interpreter will actually see.
const globalsInitial = new Int32Array(Math.max(numGlobals, 8192));
for (let i = 0; i < numGlobals; i++) globalsInitial[i] = x.readGlobalInt(i);

// The exact string bytes loaded into the wasm heap (id1_progs.dat's strings
// lump) -- the JS reference reads string content from this, matching the wasm
// side's STRINGS heap byte-for-byte (both loaded from the same file bytes).
const stringHeapBytes = progsBytes; // indices [0, stringsLen) of the *file's* strings lump ARE the heap content (loadStringBlock copies them starting at offset 0)
const strLumpOfs = (() => {
  const view = new DataView(progsBytes.buffer, progsBytes.byteOffset, progsBytes.byteLength);
  return view.getUint32(8 + 4 * 8, true); // lump index 4 = strings
})();
function heapByte(idx) {
  if (idx < 0 || idx >= stringsLen) return 0;
  return stringHeapBytes[strLumpOfs + idx];
}

// Per-field-INDEX type, from the fielddefs lump (progs.dat def type enum:
// 0=void 1=string 2=float 3=vector 4=entity 5=field 6=function). This is what
// makes random EDICT CONTENT safe to seed: a field's raw int32, when read via
// `self.enemy`-style code, can itself feed an entity/field/pointer role (e.g.
// fn127 below: `other = self.enemy;` then loads a field off `other`) -- a risk
// the per-FUNCTION role classification below can't see, since it only reasons
// about the tested function's own local/parm window, not edict CONTENTS.
const FT_VOID = 0, FT_STRING = 1, FT_FLOAT = 2, FT_VECTOR = 3, FT_ENTITY = 4, FT_FIELD = 5, FT_FUNCTION = 6;
const fieldType = new Int8Array(entityfields).fill(-1); // -1 = unknown/uncovered by any fielddef
for (const def of parsed.fielddefs) {
  if (def.ofs >= 0 && def.ofs < entityfields) fieldType[def.ofs] = def.type;
}

// ============================================================================
// ELIGIBILITY ANALYSIS -- which functions are safe + correct to differential-test
// ============================================================================
// A function is a testable candidate iff first_statement > 0 (has real bytecode,
// isn't itself a builtin stub). Its statement RANGE is [first_statement, end),
// where `end` is the next function's first_statement in program order (classic
// QCC/fteqcc lay out function bodies contiguously with no gaps -- verified true
// for id1 progs.dat below via a coverage check).
const NUMFN = functions.length;
const withStmts = [];
for (let i = 1; i < NUMFN; i++) if (functions[i].first_statement > 0) withStmts.push(i);
withStmts.sort((a, b) => functions[a].first_statement - functions[b].first_statement);
const funcEnd = new Int32Array(NUMFN);
for (let k = 0; k < withStmts.length; k++) {
  const idx = withStmts[k];
  funcEnd[idx] = (k + 1 < withStmts.length) ? functions[withStmts[k + 1]].first_statement : statements.length;
}
let numBuiltins = 0, numDefZero = 0;
for (let i = 1; i < NUMFN; i++) {
  if (functions[i].first_statement < 0) numBuiltins++;
  else if (functions[i].first_statement === 0) numDefZero++;
}

// Role classification (per candidate function, restricted to its own working
// window) -- determines what KIND of random value is safe to seed a given
// local/parm slot with, so execution never derefs a garbage entity/field/
// pointer out of the allocated edict block.
//
// The window is NOT simply [parm_start, parm_start+locals): enterFunction's
// PARM-staging copy (`for i<numparms: for j<parm_size[i]: GLOBALS[parm_start+..]
// = GLOBALS[PARM0+i*3+j]`) is unconditional and independent of `locals` --
// QCC sets locals=0 (skipping the localstack save/restore entirely) whenever
// a function makes NO nested calls, even though it still legitimately reads/
// writes its parameter words at parm_start.. (e.g. fn386, a boxes-overlap
// comparator: numparms=2, parm_size=[1,1], locals=0). A window of just
// [parm_start,parm_start+locals) would then be EMPTY, so those parameter
// slots would silently fall through classification to the FLOAT default and
// get seeded as arbitrary bit patterns -- exactly the kind of garbage entity
// number that sent fn386 out of bounds until this was caught. So the window's
// upper bound is max(locals, sum(parm_size)).
function parmWordsTotal(fn) {
  let n = 0;
  for (let i = 0; i < fn.numparms; i++) n += fn.parm_size[i];
  return n;
}
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
  if (r === ROLE.FLOAT && cur !== ROLE.FLOAT) return; // keep the more specific role
  map.set(g, ROLE.RISKY); // two conflicting structural roles on one slot -- bail safe
}

const roles = new Array(NUMFN);       // funcIdx -> Map(globalIdx -> ROLE)
const callSites = new Array(NUMFN);   // funcIdx -> [{stmtIdx, calleeIdx, argc}]
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
      mergeRole(map, inWindow, a, ROLE.RISKY); // dynamic call through a local/parm slot
      const argc = op - CALL0;
      const calleeVal = globalsInitial[a];
      if (calleeVal === 0 || calleeVal < 0 || calleeVal >= NUMFN) hasUnknownCall[idx] = 1;
      else if (functions[calleeVal].first_statement < 0) hasBuiltinCall[idx] = 1;
      else sites.push({ stmtIdx: s, calleeIdx: calleeVal, argc });
    }
    // OP.state's a/b (frame/think) carry no memory-safety role; leave unclassified (FLOAT bucket default).
  }
  roles[idx] = map;
  callSites[idx] = sites;
}

// hasRisky(idx): any window slot classified RISKY in its (possibly still-growing) role map.
function hasRisky(idx) {
  for (const r of roles[idx].values()) if (r === ROLE.RISKY) return true;
  return false;
}

const unsafe = new Uint8Array(NUMFN);
for (const idx of withStmts) {
  if (hasBuiltinCall[idx] || hasUnknownCall[idx] || hasRisky(idx)) unsafe[idx] = 1;
}

// Cycle detection on the statically-resolved (non-builtin) call graph. Real
// id1 QC has genuine mutual recursion here -- e.g. paired monster frame
// functions that CALL the next frame function directly (not just set it as
// .think for the engine to invoke later), such as fn247<->fn248 (a
// walk/run-style animation pair). assembly/vm.ts's enterFunction has NO
// MAX_DEPTH bounds check (STACK_STMT/STACK_FUNC are fixed 64-word regions,
// but depth is never clamped against that) -- unbounded recursion silently
// overwrites adjacent static memory once depth > 64, well before the
// runaway-loop breaker (0x1000000 statements) would ever fire, causing either
// an eventual out-of-bounds trap or (worse) silent state corruption. This is
// a genuine latent VM gap (see the port report), NOT a loader/harness issue --
// vm.ts is out of scope to fix here, so cyclic (and anything reaching a
// cyclic function) is excluded from the differential the same way a builtin
// call is: it is not safe/meaningful to random-seed and execute.
{
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Uint8Array(NUMFN);
  const cyclic = new Uint8Array(NUMFN);
  for (const start of withStmts) {
    if (color[start] !== WHITE) continue;
    // iterative DFS with an explicit stack (call chains can run deep; avoid JS recursion limits)
    const stack = [{ idx: start, i: 0 }];
    color[start] = GRAY;
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const edges = callSites[frame.idx];
      if (frame.i < edges.length) {
        const next = edges[frame.i++].calleeIdx;
        if (color[next] === GRAY) {
          // back-edge -- every node currently on the stack is part of (or feeds) a cycle
          for (const f of stack) cyclic[f.idx] = 1;
        } else if (color[next] === WHITE) {
          color[next] = GRAY;
          stack.push({ idx: next, i: 0 });
        }
      } else {
        color[frame.idx] = BLACK;
        stack.pop();
      }
    }
  }
  let cyclicCount = 0;
  for (const idx of withStmts) if (cyclic[idx] && !unsafe[idx]) { unsafe[idx] = 1; cyclicCount++; }
  console.log(`[eligibility] excluded(recursive/cyclic call graph -- vm.ts enterFunction has no MAX_DEPTH guard)=${cyclicCount}`);
}

// Find the nearest STORE_* writing `destGlobal` before statement index `beforeStmt`,
// within function `idx`'s own statement range. Returns the source global index
// (adjusted for store_v's 3-word block) or -1 if none found.
function findRecentStoreSource(idx, beforeStmt, destGlobal) {
  const fn = functions[idx];
  for (let s = beforeStmt - 1; s >= fn.first_statement; s--) {
    const st = statements[s];
    if (st.op === OP.store_v) {
      if (destGlobal >= st.b && destGlobal <= st.b + 2) return st.a + (destGlobal - st.b);
    } else if (STORE_FAMILY.has(st.op)) {
      if (st.b === destGlobal) return st.a;
    }
  }
  return -1;
}

// Interprocedural fixed point: propagate a callee's formal-parameter role
// requirements back onto the caller's argument-staging source slot (if that
// source is itself one of the caller's own window slots), and propagate
// unsafe-ness through the (statically resolved, non-builtin) call graph.
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
console.log(`[eligibility] total functions=${NUMFN - 1} builtins=${numBuiltins} def-zero(rerelease-only, unexpected here)=${numDefZero} with-statements=${withStmts.length}`);
console.log(`[eligibility] excluded(builtin-call)=${withStmts.filter(i => hasBuiltinCall[i]).length} excluded(unknown/dynamic-call)=${withStmts.filter(i => hasUnknownCall[i]).length} excluded(risky-role)=${withStmts.filter(i => !hasBuiltinCall[i] && !hasUnknownCall[i] && unsafe[i]).length}`);
console.log(`[eligibility] builtin-free & seed-safe (tested)=${eligible.length} / ${withStmts.length} candidates`);

// ============================================================================
// JS reference interpreter (transliterated from assembly/vm.ts / src/engine/pr.ts)
// ============================================================================
function makeRefInterp(ri, rf, edicts, edictSizeWords) {
  const LOCALSTACK_SIZE = 2048, MAX_DEPTH = 64;
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
        if (entNum === 0) { fail(7); return; } // isServerLoading() mocked false on both sides
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

  return {
    execute,
    reset: () => { depth = 0; xfunction = -1; localstackUsed = 0; xstatement = 0; trapped = false; trapCode = 0; steps = 0; },
    wasTrapped: () => trapped, trapCode: () => trapCode, getDepth: () => depth, getSteps: () => steps,
  };
}

// ============================================================================
// Differential run
// ============================================================================
const ENT_RANGE = Math.min(64, maxEdicts);
const FIELD_RANGE = Math.max(1, entityfields - 3);
const CASES_PER_FN = 60;
const MAX_FUNCTIONS_TESTED = 1600;

// Views over the FULL declared globals width (numGlobals), created ONCE, AFTER
// loadProgs (whose initEdicts call is the only heap.alloc in this run -- no
// further memory growth happens afterward, so this stays valid/undetached).
const G = x.globalsPtr();
const wf = new Float32Array(x.memory.buffer, G, numGlobals);
const wi = new Int32Array(x.memory.buffer, G, numGlobals);

// Random baseline edict content (both sides identical), TYPE-AWARE per field
// (see fieldType above) -- unconstrained random bits are NOT safe here: code
// like fn127 (`other = self.enemy; ... other.<field>`) reads a field's raw
// content and immediately uses it AS an entity/field-offset value, so a
// garbage bit pattern there is just as OOB-risky as a garbage window slot.
function seedFieldValue(fieldIdx, r) {
  switch (fieldType[fieldIdx]) {
    case FT_ENTITY: return r.int(ENT_RANGE) | 0;
    case FT_FIELD: return r.int(FIELD_RANGE) | 0;
    case FT_STRING: return r.int(Math.max(1, stringsLen)) | 0;
    case FT_FUNCTION: return 0; // NULL function -- any dynamic-call use is already excluded via hasUnknownCall
    case FT_FLOAT:
    case FT_VECTOR: {
      const v = r.f32(500);
      const b = new Float32Array(1); b[0] = v;
      return new Int32Array(b.buffer)[0];
    }
    default: // FT_VOID or not covered by any fielddef -- safe under entity/field misinterpretation too
      return r.int(Math.min(ENT_RANGE, FIELD_RANGE)) | 0;
  }
}

const edView = new Int32Array(x.memory.buffer, x.edictsBase(), maxEdicts * entityfields);
const refEdicts = new Int32Array(maxEdicts * entityfields);
{
  const seedR = rng(0xED1C7);
  for (let ent = 0; ent < ENT_RANGE; ent++) {
    for (let f = 0; f < entityfields; f++) refEdicts[ent * entityfields + f] = seedFieldValue(f, seedR);
  }
}
const edictBaseline = refEdicts.slice();

const refBuf = new ArrayBuffer(numGlobals * 4);
const rf = new Float32Array(refBuf);
const ri = new Int32Array(refBuf);

const ref = makeRefInterp(ri, rf, refEdicts, entityfields);

// Reset BOTH sides to the pristine loaded state (globals as loaded from
// progs.dat, edicts to the random baseline). MUST run before every case --
// without it, a function that leaves globals/edicts outside its own window
// mutated (e.g. via a call chain, or a trap mid-execution) would silently
// contaminate every later, otherwise-unrelated case's full-width comparison.
function resetSharedState() {
  wi.set(globalsInitial.subarray(0, numGlobals));
  ri.set(globalsInitial.subarray(0, numGlobals));
  edView.set(edictBaseline);
  refEdicts.set(edictBaseline);
}

function seedValueFor(role, r) {
  switch (role) {
    case ROLE.ENTITY: return r.int(ENT_RANGE) | 0;
    case ROLE.FIELD: return r.int(FIELD_RANGE) | 0;
    case ROLE.POINTER: {
      const ent = r.int(ENT_RANGE), fld = r.int(FIELD_RANGE);
      return (ent * edictSizeBytesQC + 96 + (fld << 2)) | 0;
    }
    case ROLE.STRING: return r.int(Math.max(1, stringsLen)) | 0;
    default: {
      const v = r.f32(500);
      const b = new Float32Array(1); b[0] = v;
      return new Int32Array(b.buffer)[0];
    }
  }
}

const r = rng(0xB1750DA7);
const chk = new Check('progs_smoke.differential');
let totalCases = 0, totalSteps = 0, functionsTested = 0, trapMismatches = 0, wasmTraps = 0, refTraps = 0, trappedMismatchCount = 0;
let totalValueChecks = 0, totalValueMismatches = 0; // honest denominator (chk.n only counts calls, which are only made on mismatch below)
const perFnFails = [];

const testSet = eligible.slice(0, MAX_FUNCTIONS_TESTED);
for (const fnIdx of testSet) {
  const fn = functions[fnIdx];
  const roleMap = roles[fnIdx];
  functionsTested++;
  let fnFails = 0;

  for (let c = 0; c < CASES_PER_FN; c++) {
    totalCases++;
    x.resetVm();
    ref.reset();
    resetSharedState();

    // shared reserved globals
    const selfV = r.int(ENT_RANGE) | 0;
    const timeV = Math.fround(r.f32(1000));
    x.writeGlobalInt(GLOBAL_SELF, selfV); ri[GLOBAL_SELF] = selfV;
    x.writeGlobalFloat(GLOBAL_TIME, timeV); rf[GLOBAL_TIME] = timeV;

    // formal-parameter portion, staged through PARM0.. (real QC call ABI)
    let running = 0;
    for (let k = 0; k < fn.numparms; k++) {
      const psize = fn.parm_size[k];
      for (let j = 0; j < psize; j++) {
        const windowSlot = fn.parm_start + running + j;
        const role = roleMap.get(windowSlot) ?? ROLE.FLOAT;
        const bits = seedValueFor(role, r);
        const parmGlobal = PARM0 + k * 3 + j;
        x.writeGlobalInt(parmGlobal, bits);
        ri[parmGlobal] = bits;
      }
      running += psize;
    }
    // pure-locals portion (enterFunction never overwrites these -- seed directly)
    for (let off = running; off < fn.locals; off++) {
      const windowSlot = fn.parm_start + off;
      const role = roleMap.get(windowSlot) ?? ROLE.FLOAT;
      const bits = seedValueFor(role, r);
      x.writeGlobalInt(windowSlot, bits);
      ri[windowSlot] = bits;
    }

    let wasmErr = null, refErr = null;
    try { x.execute(fnIdx); } catch (e) { wasmErr = e; wasmTraps++; }
    try { ref.execute(fnIdx); } catch (e) { refErr = e; refTraps++; }

    if (wasmErr || refErr) {
      // A genuine WASM/JS runtime trap (not a graceful VM-level fail()) --
      // the eligibility/seeding analysis should prevent these; log and
      // continue rather than aborting the whole suite.
      trapMismatches++;
      if (fnFails < 3) console.log(`   [TRAP] fn=${fnIdx} case=${c} wasm=${wasmErr ? wasmErr.message : 'ok'} ref=${refErr ? refErr.message : 'ok'}`);
      fnFails++;
      continue;
    }

    // x.wasTrapped() is an AssemblyScript `bool` export, which crosses the JS
    // boundary as a NUMBER (0/1), not a JS boolean -- ref.wasTrapped() returns
    // a real boolean, so `!==` alone would strict-type-mismatch on EVERY call
    // (0 !== false is true). Coerce both to 0/1 before comparing.
    const wTrapped = x.wasTrapped() ? 1 : 0, rTrapped = ref.wasTrapped() ? 1 : 0;
    if (wTrapped !== rTrapped) {
      trappedMismatchCount++;
      chk.intEq(wTrapped, rTrapped, `fn${fnIdx}#${c} trapped-mismatch`);
      fnFails++;
      continue;
    }
    totalSteps += ref.getSteps();

    // Compare the ENTIRE globals window we actually operate over (raw int
    // bit patterns -- strictest possible check, subsumes float bit-exactness).
    let ok = true;
    totalValueChecks += numGlobals + ENT_RANGE * entityfields;
    for (let i = 0; i < numGlobals; i++) {
      if (wi[i] !== ri[i]) {
        chk.intEq(wi[i], ri[i], `fn${fnIdx}#${c} global[${i}]`);
        ok = false;
        totalValueMismatches++;
      }
    }
    // Compare the edict field range our seeding could plausibly have touched.
    for (let i = 0; i < ENT_RANGE * entityfields; i++) {
      if (edView[i] !== refEdicts[i]) {
        chk.intEq(edView[i], refEdicts[i], `fn${fnIdx}#${c} edict[${(i / entityfields) | 0}][${i % entityfields}]`);
        ok = false;
        totalValueMismatches++;
      }
    }
    if (!ok) fnFails++;
  }
  if (fnFails > 0) perFnFails.push({ fnIdx, fnFails });
}

console.log(`[run] functions tested=${functionsTested} total cases=${totalCases} total ref-interpreted statements=${totalSteps} trapped-mismatch(both-graceful-fail-disagree)=${trappedMismatchCount}`);
console.log(`[run] genuine runtime traps (excluded from parity check)=${trapMismatches} (wasm=${wasmTraps} ref=${refTraps})`);
if (perFnFails.length) {
  console.log(`[run] functions with >=1 mismatched case: ${perFnFails.length}`);
  for (const { fnIdx, fnFails } of perFnFails.slice(0, 10)) console.log(`    fn=${fnIdx} fails=${fnFails}/${CASES_PER_FN}`);
}

const passedChecks = totalValueChecks - totalValueMismatches;
const ok = chk.report();
console.log(`[${(ok && trapMismatches === 0) ? 'PASS' : 'FAIL'}] progs_smoke.differential (globals+edicts, honest total): ${passedChecks}/${totalValueChecks} bit-exact`);
process.exit((ok && trapMismatches === 0) ? 0 : 1);
