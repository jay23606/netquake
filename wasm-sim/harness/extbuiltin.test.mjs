// 2021-rerelease "= #0" builtin binding, end to end on the real remaster progs.
//
// Rerelease QCC declares ex_centerprint/ex_bprint/ex_sprint/ex_localsound/ex_finaleFinished
// as "= #0", leaving the engine to bind them by name (src/engine/pr.ts loadProgs). The bug
// this pins: installing the raw file value instead gives the VM a first_statement of 0,
// which it enters as QC code rather than dispatching a builtin.
//
// Needs a remaster pak at <repo>/mg1/pak0.pak or mg3/pak0.pak; skips (passing) without one.

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadWasm, Check } from './lib.mjs';
import { loadProgs } from './progsLoader.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

// --- pak0.pak reader (dir offset/length at 4/8; 64-byte entries) ------------------
function pakFile(pakPath, want) {
  const b = readFileSync(pakPath);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const dirOfs = dv.getUint32(4, true), dirLen = dv.getUint32(8, true);
  for (let i = 0; i < dirLen / 64; i++) {
    const o = dirOfs + i * 64;
    let name = '';
    for (let j = 0; j < 56; j++) { const c = b[o + j]; if (c === 0) break; name += String.fromCharCode(c); }
    if (name.toLowerCase() === want) return b.subarray(dv.getUint32(o + 56, true), dv.getUint32(o + 56, true) + dv.getUint32(o + 60, true));
  }
  return null;
}

// pf.ts ebfs_builtins entries with defaultFnNbr 0 — the names pr.loadProgs can bind.
const EX_NAMES = [
  'ex_finaleFinished', 'ex_localsound', 'ex_centerprint', 'ex_bprint', 'ex_sprint',
  'ex_CheckPlayerEXFlags', 'ex_walkpathtogoal', 'ex_bot_movetopoint', 'ex_bot_followentity',
];
const EXT_BUILTIN_BASE = 900;   // src/engine/pr.ts EXT_BUILTIN_BASE / assembly/host.ts

// src/engine/pr.ts loadProgs' rerelease remap, replicated.
function bindExtBuiltins(functions, nameOf) {
  const assigned = new Map();   // builtin name -> number
  let next = EXT_BUILTIN_BASE;
  const firstStatement = functions.map((f) => f.first_statement);
  for (let i = 0; i < functions.length; i++) {
    const f = functions[i];
    if (f.first_statement !== 0 || f.parm_start !== 0 || f.locals !== 0 || f.s_name === 0) continue;
    const name = nameOf(f.s_name);
    const known = EX_NAMES.find((n) => n.toLowerCase() === name.toLowerCase());
    if (!known) continue;
    if (!assigned.has(known)) assigned.set(known, next++);
    firstStatement[i] = -assigned.get(known);
  }
  return { firstStatement, assigned };
}

const results = [];
let ran = 0;

for (const game of ['mg1', 'mg3']) {
  const pak = join(ROOT, game, 'pak0.pak');
  if (!existsSync(pak)) continue;
  const progs = pakFile(pak, 'progs.dat');
  if (progs == null) continue;
  ran++;

  const chk = new Check(`ext builtins: ${game}/pak0.pak progs.dat`);
  const calls = { extbuiltin: [], unimplemented: [] };
  const x = await loadWasm({
    host: new Proxy({
      host_pow: Math.pow,
      host_extbuiltin: (n) => calls.extbuiltin.push(n),
      host_unimplemented: (n) => calls.unimplemented.push(n),
    }, { get: (t, k) => (k in t ? t[k] : () => 0) }),
  });

  const p = loadProgs(x, progs, 64);   // installs the RAW file first_statement
  const nameOf = (ofs) => {
    const len = x.readStringToScratch(ofs, 256);
    const u8 = new Uint8Array(x.memory.buffer, x.scratchPtr(), len);
    let s = ''; for (let i = 0; i < len; i++) s += String.fromCharCode(u8[i]);
    return s;
  };
  const FUNC_RECORD_SIZE = 24;   // assembly/vm.ts
  const fnFirstStatement = (i) => new Int32Array(x.memory.buffer, x.functionsPtr() + i * FUNC_RECORD_SIZE, 1)[0];

  const idxOf = new Map();
  for (let i = 0; i < p.functions.length; i++) {
    const n = nameOf(p.functions[i].s_name);
    if (EX_NAMES.includes(n)) idxOf.set(n, i);
  }
  chk.intEq(idxOf.has('ex_centerprint') ? 1 : 0, 1, 'ex_centerprint present (rerelease progs)');

  // --- pre-fix state: raw install leaves the "= #0" builtins at 0 -----------------
  for (const [name, i] of idxOf) chk.intEq(fnFirstStatement(i), 0, `raw first_statement ${name}`);

  // Synthetic caller appended past the progs' own statements/functions/globals:
  //   <call>: CALL2 <global holding the ex_centerprint function index>
  //   <call+1>: DONE
  const callStmt = p.statements.length, fnSlot = p.functions.length, gSlot = p.numGlobals;
  const target = idxOf.get('ex_centerprint');
  x.writeGlobalInt(gSlot, target);
  x.installStatement(callStmt, 53 /* CALL2 */, gSlot, 0, 0);
  x.installStatement(callStmt + 1, 0 /* DONE */, 0, 0, 0);
  x.installFunction(fnSlot, callStmt, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  x.setNumFunctions(fnSlot + 1);

  // Negative control: the raw entry point enters ex_centerprint as QC at statement 0 (a DONE in
  // both remaster progs), so the call silently does nothing — the reported symptom.
  x.execute(fnSlot);
  chk.intEq(x.wasTrapped() ? 1 : 0, 0, 'raw: no VM trap');
  chk.intEq(calls.extbuiltin.length, 0, 'raw: call never reaches the bridge');
  chk.intEq(calls.unimplemented.length, 0, 'raw: call never reaches host_unimplemented');

  // --- the fix: install the NAME-BOUND entry points -------------------------------
  const { firstStatement, assigned } = bindExtBuiltins(p.functions, nameOf);
  for (let i = 0; i < p.functions.length; i++) {
    const f = p.functions[i];
    x.installFunction(i, firstStatement[i], f.parm_start, f.locals, f.numparms, ...f.parm_size);
  }
  for (const [name, i] of idxOf) {
    const n = assigned.get(name);
    chk.intEq(n >= EXT_BUILTIN_BASE ? 1 : 0, 1, `${name} numbered >= ${EXT_BUILTIN_BASE}`);
    chk.intEq(fnFirstStatement(i), -n, `bound first_statement ${name}`);
  }

  // --- end to end: the same QC CALL now reaches host_extbuiltin -------------------
  x.execute(fnSlot);
  chk.intEq(x.wasTrapped() ? 1 : 0, 0, 'no VM trap');
  chk.intEq(calls.extbuiltin.length, 1, 'host_extbuiltin fired once');
  chk.intEq(calls.extbuiltin[0] | 0, assigned.get('ex_centerprint') | 0, 'host_extbuiltin got ex_centerprint');
  chk.intEq(calls.unimplemented.length, 0, 'not routed to host_unimplemented');
  chk.intEq(x.getArgc(), 2, 'argc reaches the bridge');

  results.push(chk.report());
}

if (ran === 0) console.log('[SKIP] ext builtins: no mg1/mg3 pak0.pak in the repo root');
process.exit(results.every(Boolean) ? 0 : 1);
