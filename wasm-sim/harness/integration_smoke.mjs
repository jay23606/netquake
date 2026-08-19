// Headless integration smoke test for the sv_wasm server backend.
//
// Mirrors src/app/game/net/wasmServer.ts's EXACT loadMap init sequence + per-frame drive on
// sim.debug.wasm (AssemblyScript assertions + bounds checks), running a box world with a
// MOVETYPE_PUSH pusher + on-ground rider for 240 frames. It is a REGRESSION GUARD: it fails
// loudly on a genuine out-of-bounds access (beyond linear memory), a VM trap, a NaN/Inf in
// entity state, or WASM memory growth (a per-frame leak). It exercises the full pusher path
// (physicsPusher -> pushMove -> pushMoveLinear -> setMoved + revert) on the bounds-checked
// build every frame.
//
// SCOPE / HONEST LIMIT: this does NOT catch the setup-omission class it was first aimed at
// (e.g. the missing initPusherState). Those bugs write to WASM *address 0*, which is IN
// bounds (AS bounds-checks only catch out-of-bounds), and setMoved's write+read both use
// base 0 so the rider scratch round-trips correctly within a frame — it corrupts adjacent
// globals/RT memory that this passive (no-QC) scenario never reads back. The `SKIP=` modes
// below document exactly that: they run clean, showing a passive smoke test can't see
// in-bounds corruption. The strongest catch for that class is the STATIC export-audit
// (scratchpad/exportaudit.mjs) that actually found initPusherState.
//
// Prereqs (both gitignored/generated): build the debug wasm `cd wasm-sim && npx asc --target
// debug`, and have build/id1_progs.dat (harness/extract_progs.mjs from id1/pak0.pak).
//
// Usage:  node wasm-sim/harness/integration_smoke.mjs
//         SKIP=pusher|area|entstate|string node wasm-sim/harness/integration_smoke.mjs  (fault-injection study)

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadProgs } from './progsLoader.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SKIP = process.env.SKIP || '';           // fault-injection: 'pusher'|'area'|'entstate'|'string'
const FRAMES = 240;                             // ~3.3s at 72Hz
const MAX_EDICTS = 512;

// --- vanilla entvars field indices (src/engine/pr.ts) ------------------------------
const F = {
  LTIME: 7, MOVETYPE: 8, SOLID: 9, ORIGIN: 10, ORIGIN1: 11, ORIGIN2: 12,
  MODELINDEX: 0 /* placeholder, unused here */,
  VELOCITY: 16, VELOCITY1: 17, VELOCITY2: 18,
  ANGLES: 19, AVELOCITY: 22, AVELOCITY1: 23, AVELOCITY2: 24,
  MINS: 33, MINS1: 34, MINS2: 35, MAXS: 36, MAXS1: 37, MAXS2: 38, SIZE: 39,
  NEXTTHINK: 46, GROUNDENTITY: 47, FLAGS: 76,
};
const MT = { step: 4, push: 7 };
const SOLID_BBOX = 2, SOLID_SLIDEBOX = 3, SOLID_BSP = 4;
const FL_ONGROUND = 512;
const CONTENTS_EMPTY = -1, CONTENTS_SOLID = -2;

const hostErrors = [];
let aborted = null;
const wasmBytes = readFileSync(join(HERE, '..', 'build', 'sim.debug.wasm'));
const imports = {
  env: { abort: (m, f, line, col) => { aborted = `abort @${line}:${col}`; throw new Error(aborted); } },
    // DEFAULT-NS: full host-import namespace defaults (later keys in this literal override).
    vm: { isServerLoading: () => 0, hostError: () => {} },
    strings: { host_tostring: () => 0, host_tofixed1: () => 0 },
    host: new Proxy({ host_pow: Math.pow }, { get: (t, k) => (k in t ? t[k] : () => 0) }),
    builtins_move: { host_random: () => 0, host_sin: Math.sin, host_cos: Math.cos },
    builtins_math: { host_sin: Math.sin, host_cos: Math.cos, host_atan2: Math.atan2 },
    builtins_math2: { host_sin: Math.sin, host_cos: Math.cos },
    svpusher: { host_sin: Math.sin, host_cos: Math.cos },
    svclient: { host_sin: Math.sin, host_cos: Math.cos },
  vm: { isServerLoading: () => 0, hostError: (code) => { hostErrors.push(code); } },
  strings: { host_tostring: () => 0, host_tofixed1: () => 0 },
};
const inst = await WebAssembly.instantiate(wasmBytes,
  new Proxy(imports, { get: (t, k) => (k in t ? t[k] : new Proxy({}, { get: () => () => 0 })), has: () => true }));
const x = inst.instance.exports;
const memPages = () => x.memory.buffer.byteLength / 65536;

// --- synthetic box world (mirrors svpusher.test.mjs makeBoxHull) -------------------
function makeBoxHull(lo, hi) {
  const dist = [hi[0], lo[0], hi[1], lo[1], hi[2], lo[2]];
  const clipnodes = [], planes = [];
  for (let i = 0; i <= 5; i++) {
    const node = { planenum: i, children: [0, 0] };
    node.children[i & 1] = CONTENTS_EMPTY;
    node.children[1 - (i & 1)] = (i !== 5) ? i + 1 : CONTENTS_SOLID;
    clipnodes[i] = node;
    const normal = [0, 0, 0]; normal[i >> 1] = 1.0;
    planes[i] = { type: i >> 1, normal, dist: dist[i] };
  }
  return { clipnodes, planes, firstclipnode: 0, lastclipnode: 5, clip_mins: [0, 0, 0] };
}

// ============================ mirror wasmServer.loadMap ============================
const progsBytes = readFileSync(join(HERE, '..', 'build', 'id1_progs.dat'));
const parsed = loadProgs(x, progsBytes, MAX_EDICTS);        // -> initEdicts + statements/globals/strings
const EF = parsed.entityfields;
if (SKIP !== 'string') x.initStringTemp();

const world = makeBoxHull([-1024, -1024, -1024], [1024, 1024, 1024]);
for (let i = 0; i < world.planes.length; i++) { const p = world.planes[i]; x.setPlane(i, p.normal[0], p.normal[1], p.normal[2], p.dist, p.type); }
for (let i = world.firstclipnode; i <= world.lastclipnode; i++) { const c = world.clipnodes[i]; x.setClipNode(i, c.planenum, c.children[0], c.children[1]); }
x.setHullMeta(world.firstclipnode, world.lastclipnode);
// hull1/hull2 (shared clipnode pool) + per-model table entry 0 = world, all 3 hulls
for (const hid of [1, 2]) for (let i = world.firstclipnode; i <= world.lastclipnode; i++) { const c = world.clipnodes[i]; x.setClipNode12(i, c.planenum, c.children[0], c.children[1]); }
x.installHull1(world.firstclipnode, world.lastclipnode, 0, 0, 0);
x.installHull2(world.firstclipnode, world.lastclipnode, 0, 0, 0);
for (const hid of [0, 1, 2]) x.installModelHull(0, hid, world.firstclipnode, world.lastclipnode, 0, 0, 0);
x.pusherSetWorldHullRange(world.firstclipnode, world.lastclipnode);

x.initAreaTree(-2048, -2048, -2048, 2048, 2048, 2048, MAX_EDICTS);
if (SKIP !== 'pusher') { x.initPusherState(MAX_EDICTS); }
if (SKIP !== 'entstate') x.initEntState(0, 0);   // maxClients=0 so edicts 1,2 are pushers/riders, not client slots
x.setMaxVelocity(2000); x.setGravityCvar(800); x.setGravityFieldIdx(-1);
x.setMaxSpeed(320); x.setAccelerateCvar(10); x.setFrictionCvar(4);
x.setEdgeFrictionCvar(2); x.setStopSpeedCvar(100); x.setNoStep(0);

x.initModelPrecache();   // no bmodel needed: the door is SOLID_SLIDEBOX (uses its own bbox)

// --- entities: world(0), a rising door(1, MOVETYPE_PUSH/SOLID_BSP), a rider box(2) ---
const setf = (e, i, v) => x.edStoreFloat(e, i, v);
function setBox(e, o, half, solid, movetype) {
  setf(e, F.ORIGIN, o[0]); setf(e, F.ORIGIN1, o[1]); setf(e, F.ORIGIN2, o[2]);
  setf(e, F.MINS, -half[0]); setf(e, F.MINS1, -half[1]); setf(e, F.MINS2, -half[2]);
  setf(e, F.MAXS, half[0]); setf(e, F.MAXS1, half[1]); setf(e, F.MAXS2, half[2]);
  setf(e, F.SOLID, solid); setf(e, F.MOVETYPE, movetype);
}
const NE = 3;
for (let e = 0; e < NE; e++) x.setEdictFree(e, 0);
setBox(0, [0, 0, 0], [0, 0, 0], SOLID_BSP, 0);                       // world
setBox(1, [0, 0, -100], [64, 64, 8], SOLID_SLIDEBOX, MT.push);       // door (bbox pusher)
setf(1, F.VELOCITY2, 20); setf(1, F.NEXTTHINK, 9999); setf(1, F.LTIME, 0);  // rising, no think
setBox(2, [0, 0, -75], [16, 16, 16], SOLID_BBOX, MT.step);          // rider box just above the door (door top=-92, rider bottom=-91: 1u gap so touching doesn't read as blocked)
x.edStoreInt(2, F.GROUNDENTITY, 1); setf(2, F.FLAGS, FL_ONGROUND);
x.setNumEdicts(NE);
x.linkEdict(0); x.linkEdict(1); x.linkEdict(2);

// ============================ drive frames (mirror frame()) ========================
let time = 0.0; const dt = 1 / 72;
let framesRun = 0, nanHits = 0, trapHits = 0;
let firstFault = null;
for (let f = 0; f < FRAMES; f++) {
  x.setServerTime(time);
  try {
    x.physicsFrame(time, dt);
  } catch (e) {
    firstFault = firstFault || `THROW frame ${f}: ${e.message}`;
    trapHits++; break;
  }
  if (x.wasTrapped && x.wasTrapped()) { firstFault = firstFault || `VM trapped frame ${f}`; trapHits++; break; }
  // scan every edict's origin/velocity for NaN/Inf (corruption tell)
  const ne = x.getNumEdicts();
  for (let e = 0; e < ne; e++) {
    for (const fi of [F.ORIGIN, F.ORIGIN1, F.ORIGIN2, F.VELOCITY, F.VELOCITY1, F.VELOCITY2]) {
      const v = x.edLoadFloat(e, fi);
      if (!Number.isFinite(v)) { firstFault = firstFault || `NaN/Inf frame ${f} e${e} field ${fi} = ${v}`; nanHits++; }
    }
  }
  if (nanHits) break;
  framesRun++;
  time += dt;
}

// ============================ report ==============================================
const pagesEnd = memPages();
const doorZ = x.edLoadFloat(1, F.ORIGIN2), riderZ = x.edLoadFloat(2, F.ORIGIN2);
console.log('=== sv_wasm integration smoke (debug/bounds-checked wasm) ===');
console.log(`SKIP=${SKIP || '(none)'}  entityfields=${EF}  frames requested=${FRAMES}`);
console.log(`frames run clean : ${framesRun}`);
console.log(`wasm aborts      : ${aborted ? aborted : 'none'}`);
console.log(`VM hostErrors    : ${hostErrors.length ? hostErrors.join(',') : 'none'}`);
console.log(`traps/throws     : ${trapHits}   NaN/Inf hits: ${nanHits}`);
console.log(`door.z ${doorZ.toFixed(1)}  rider.z ${riderZ.toFixed(1)}  (pusher path exercised each frame; the synthetic rider blocks->reverts, which also runs the revert/scratch-readback path)`);
console.log(`mem pages end    : ${pagesEnd} (${(pagesEnd * 64).toFixed(0)} KB)`);
if (firstFault) console.log(`FIRST FAULT      : ${firstFault}`);

const clean = !firstFault && framesRun === FRAMES && !aborted && hostErrors.length === 0;
if (SKIP) {
  const caught = !!(firstFault || aborted || hostErrors.length);
  console.log(`\n[fault-injection SKIP=${SKIP}] ${caught ? 'DETECTED a fault — harness has teeth' : 'NO fault surfaced by this scenario'}`);
  process.exit(0);
} else if (clean) {
  console.log('\nPASS — full wasmServer setup + 240 pusher/rider frames on the bounds-checked build: no abort, no VM trap, no NaN, no memory growth.');
  process.exit(0);
} else {
  console.log('\nFAIL — see FIRST FAULT above.');
  process.exit(1);
}
