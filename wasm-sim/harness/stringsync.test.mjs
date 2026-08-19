// Regression: the JS<->WASM string bridge and the precache registry's not-found
// sentinel. Both produce SILENT wrong-model corruption, so this test asserts the
// broken host behaviour reproduces it and the fixed host behaviour doesn't.
//
// The two heaps (pr.state.strings JS-side, assembly/strings.ts wasm-side) are ONE
// offset space with TWO bump allocators. wasmServer.loadMap copies the JS heap in
// once; every append after that must be reconciled at the call boundary
// (syncStringsIn/syncStringsOut), or an offset handed across resolves to whatever
// bytes the OTHER allocator left there.
//
// Bug 1 (registry collapse): findStringOffset returned 0 — the empty string, i.e.
//   model_precache[0] — for a name it could not find. Engine-generated names ('*N'
//   submodels) need not exist as QC strings at all, so this fires on real maps;
//   registerModelPrecache's content-dedup then folds the slot into slot 0 and every
//   later modelindex shifts down by one. The client resolves the shifted index
//   against ITS OWN precache list => a hell knight renders as a megahealth.
// Bug 2 (unsynced append): a string allocated JS-side after the load-time copy is
//   all zeros in wasm memory => reads as "" => pf_setmodel resolves it to the ""
//   slot (modelindex 0) instead of trapping.
//
// Emulates wasmServer.ts's host side (installBmodelHulls + syncStringsIn/Out)
// against the real sim.wasm.

import { loadWasm } from './lib.mjs';

const MAX_EDICTS = 512;
const PARM0 = 4, PARM1 = 7;
const F_MODELINDEX = 0, F_MODEL = 29, F_SOLID = 9;

const x = await loadWasm();

// --- host-side JS string heap (src/engine/pr.ts state.strings + newString) ---------
let jsHeap = [];
function jsNewString(s) {                       // pr.newString(s, s.length + 1)
  const ofs = jsHeap.length;
  for (let i = 0; i < s.length; i++) jsHeap.push(s.charCodeAt(i) & 0xff);
  jsHeap.push(0);
  return ofs;
}

// --- host-side bridge (wasmServer.ts syncStringsIn / syncStringsOut) ---------------
let syncedStringLen = 0;
function syncStringsIn() {
  const len = jsHeap.length;
  if (len <= syncedStringLen) return;
  const add = len - syncedStringLen;
  const sc = new Uint8Array(x.memory.buffer, x.scratchPtr(), add);
  for (let i = 0; i < add; i++) sc[i] = jsHeap[syncedStringLen + i] & 0xff;
  if (!x.writeStringsFromScratch(syncedStringLen, add)) throw new Error('string heap capacity');
  syncedStringLen = len;
}
function syncStringsOut() {
  const top = x.heapLength() | 0;
  if (top <= syncedStringLen) return;
  const n = x.readStringsToScratch(syncedStringLen, top - syncedStringLen) | 0;
  const sc = new Uint8Array(x.memory.buffer, x.scratchPtr(), n);
  for (let i = 0; i < n; i++) jsHeap[syncedStringLen + i] = sc[i];
  syncedStringLen = top;
}

// --- host-side name resolution: the BROKEN one and the FIXED one ------------------
function findStringOffsetRaw(heap, name) {
  const n = name.length;
  for (let i = 0; i <= heap.length - n; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) { if (heap[i + j] !== name.charCodeAt(j)) { ok = false; break; } }
    if (ok && (i + n >= heap.length || heap[i + n] === 0)) return i;
  }
  return -1;
}
const findStringOffsetOLD = (heap, name) => {    // 0 on miss == the "" slot
  if (name.length === 0) return 0;
  const f = findStringOffsetRaw(heap, name);
  return f >= 0 ? f : 0;
};
const internStringOffsetNEW = (heap, name) => {  // miss => allocate a unique offset
  if (name.length === 0) return 0;
  const f = findStringOffsetRaw(heap, name);
  return f >= 0 ? f : jsNewString(name);
};

// --- the map load ------------------------------------------------------------------
// A progs string block: "" at offset 0 (QC string 0), then names the QC holds.
// NOTE '*2' is deliberately absent — sv.spawnServer generates '*N' submodel names
// JS-side, and one that no entity keyvalue references never becomes a QC string.
jsHeap = [0];
for (const s of ['maps/test.bsp', '*1', 'progs/health_100.mdl', 'progs/mon_hknight.mdl']) jsNewString(s);
const progsBlockLen = jsHeap.length;

// wasmServer.loadMap: whole-heap copy in, then both sides bump from here.
{
  const sc = new Uint8Array(x.memory.buffer, x.scratchPtr(), jsHeap.length);
  for (let i = 0; i < jsHeap.length; i++) sc[i] = jsHeap[i];
  x.loadStringBlock(jsHeap.length);
  syncedStringLen = jsHeap.length;
}
x.initAreaTree(-4096, -4096, -4096, 4096, 4096, 4096, MAX_EDICTS);

// sv.spawnServer's model_precache, in order — index IS the modelindex.
const names = ['', 'maps/test.bsp', '*1', '*2', 'progs/health_100.mdl', 'progs/mon_hknight.mdl'];
const HKNIGHT = names.indexOf('progs/mon_hknight.mdl');   // 5
const HEALTH = names.indexOf('progs/health_100.mdl');     // 4

function buildRegistry(resolve) {
  x.initModelPrecache();
  const ofs = names.map((n) => resolve(jsHeap, n));
  syncStringsIn();   // interned bytes must reach the sim BEFORE the content-dedup runs
  const slots = [];
  for (let mi = 0; mi < names.length; mi++) slots.push(x.registerModelPrecache(ofs[mi], 0, 0, 0, 0, 0, 0));
  return { ofs, slots };
}
function setmodel(entNum, nameOfs) {
  const g = new Int32Array(x.memory.buffer, x.globalsPtr(), 64);
  x.setEdictFree(entNum, 0);
  x.edStoreFloat(entNum, F_SOLID, 0);
  g[PARM0] = entNum; g[PARM1] = nameOfs;
  x.pf_setmodel(x.globalsPtr());
  return { modelindex: x.edLoadFloat(entNum, F_MODELINDEX), model: x.edLoadInt(entNum, F_MODEL) };
}

let pass = true;
const check = (ok, label, detail) => {
  if (!ok) pass = false;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ' — ' + detail : ''}`);
};

// --- 1. the OLD host reproduces the registry collapse ------------------------------
{
  const savedLen = jsHeap.length;
  const { slots } = buildRegistry(findStringOffsetOLD);
  const collapsed = slots[names.indexOf('*2')] === 0;
  check(collapsed, "OLD host: a not-found precache name folds into slot 0 (the '' slot)",
    `'*2' -> slot ${slots[names.indexOf('*2')]}`);
  check(slots[HKNIGHT] === HKNIGHT - 1,
    'OLD host: every later modelindex shifts down by one (the live 220->219 symptom)',
    `hknight expected ${HKNIGHT}, registry gave ${slots[HKNIGHT]}`);
  const r = setmodel(1, findStringOffsetRaw(jsHeap, 'progs/mon_hknight.mdl'));
  check(r.modelindex === HEALTH,
    'OLD host: setmodel(hell knight) silently resolves to the megahealth index',
    `modelindex ${r.modelindex} == precache["${names[r.modelindex]}"]`);
  jsHeap.length = savedLen;   // OLD path interns nothing; keep the heap pristine
}

// --- 2. the FIXED host keeps registry index == modelindex --------------------------
const fixed = buildRegistry(internStringOffsetNEW);
check(fixed.slots.every((s, i) => s === i), 'FIXED host: registry index == precache index for every model',
  `slots ${fixed.slots.join(',')}`);
check(fixed.ofs[names.indexOf('*2')] !== 0, "FIXED host: a not-found name never aliases offset 0",
  `'*2' interned at ${fixed.ofs[names.indexOf('*2')]}`);
{
  const r = setmodel(1, findStringOffsetRaw(jsHeap, 'progs/mon_hknight.mdl'));
  check(r.modelindex === HKNIGHT, 'FIXED host: setmodel(hell knight) resolves to the hell knight',
    `modelindex ${r.modelindex}`);
}

// --- 3. a JS-side string allocated AFTER the load-time copy ------------------------
// ed.newString makes a fresh copy per entity keyvalue and JS-side builtins
// (strconv/infoadd/strpad...) pr.newString their results mid-frame — all of it lands
// past progsBlockLen, where wasm memory is untouched.
{
  const lateOfs = jsNewString('progs/mon_hknight.mdl');
  check(lateOfs >= progsBlockLen, 'late JS alloc lands past the load-time copy', `ofs ${lateOfs}`);
  const before = setmodel(2, lateOfs);
  check(before.modelindex === 0,
    'UNSYNCED: a JS-allocated offset reads as "" in wasm memory and resolves to slot 0',
    `modelindex ${before.modelindex}, not ${HKNIGHT}`);
  syncStringsIn();
  const after = setmodel(2, lateOfs);
  check(after.modelindex === HKNIGHT, 'SYNCED: the same offset now resolves to the right model',
    `modelindex ${after.modelindex}`);
  check(after.model === lateOfs, 'setmodel stores the caller\'s string offset unchanged', `.model ${after.model}`);
}

// --- 4. reverse direction: strings the SIM allocates --------------------------------
{
  const srcOfs = findStringOffsetRaw(jsHeap, 'progs/health_100.mdl');
  const zoned = x.heapStrzone(srcOfs);          // #118 strzone, wasm-side bump alloc
  check(zoned >= syncedStringLen, 'strzone allocates above the agreed high-water mark', `ofs ${zoned}`);
  syncStringsOut();
  let js = '';
  for (let i = zoned; jsHeap[i] !== 0 && i < jsHeap.length; i++) js += String.fromCharCode(jsHeap[i]);
  check(js === 'progs/health_100.mdl', 'sim -> JS: pr.getString resolves a strzone\'d string', `"${js}"`);
  // ...and the JS allocator must not hand that range out again.
  const next = jsNewString('progs/mon_army.mdl');
  check(next > zoned, 'JS allocator resumes ABOVE the sim-allocated range', `next ${next} > zoned ${zoned}`);
  syncStringsIn();
  check(x.readStringToScratch(zoned, 64) === 'progs/health_100.mdl'.length,
    'the JS-side append did not clobber the sim\'s own string');
}

console.log(`\n${pass ? 'STRING-SYNC PARITY OK' : 'STRING-SYNC PARITY FAILED'}`);
process.exit(pass ? 0 : 1);
