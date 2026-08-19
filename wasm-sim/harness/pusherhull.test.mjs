// Regression: SV_PushMove's contents-pusher rider test (FTE_ENT_SKIN_CONTENTS,
// skin < 0) must trace the check entity against the pusher's OWN hull, which for
// a SOLID_BSP pusher is its MODEL's clip hull -- not its bounding box.
//
// sv.ts pusherOverlaps (sv.ts:2840) calls clipMoveToEntity(pusher, ...), which
// resolves the hull through hullForEntity (sv.ts:2390): SOLID_BSP takes the
// model-hull branch, everything else the temp 6-plane box hull. The sim's
// pusherOverlapsBox built a box hull UNCONDITIONALLY, so a brush pusher was
// tested as its bounding box: every entity inside the bbox but outside the brush
// was claimed as a rider. A wrongly-claimed rider is carried by the pusher and,
// when the pusher's move is blocked, has its origin REVERTED every frame -- which
// pins the entity in place while its velocity keeps integrating untouched.
//
// The fixture is the cheapest brush shape with a bbox much larger than the solid:
// a small solid block whose entity mins/maxs are a large box (what any L-shaped or
// sloped water/lava volume looks like to a bbox test).
//
// Needs build/sim.wasm.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_EDICTS = 64;
const F = { MODELINDEX: 0, ABSMIN: 1, ABSMAX: 4, LTIME: 7, MOVETYPE: 8, SOLID: 9,
  ORIGIN: 10, ORIGIN1: 11, ORIGIN2: 12, VELOCITY: 16, VELOCITY1: 17, VELOCITY2: 18,
  ANGLES: 19, AVELOCITY: 22, SKIN: 31,
  MINS: 33, MINS1: 34, MINS2: 35, MAXS: 36, MAXS1: 37, MAXS2: 38, SIZE: 39,
  NEXTTHINK: 46, GROUNDENTITY: 47, FLAGS: 76 };
const SOLID_NOT = 0, SOLID_SLIDEBOX = 3, SOLID_BSP = 4;
const MT_TOSS = 6, MT_PUSH = 7;
const CONTENTS_EMPTY = -1, CONTENTS_SOLID = -2;

const wasmBytes = readFileSync(join(HERE, '..', 'build', 'sim.wasm'));
const imports = {
  env: { abort: (m, f, l, c) => { throw new Error('abort @' + l + ':' + c); } },
  vm: { isServerLoading: () => 0, hostError: () => {} },
  strings: { host_tostring: () => 0, host_tofixed1: () => 0 },
  host: new Proxy({ host_pow: Math.pow }, { get: (t, k) => (k in t ? t[k] : () => 0) }),
  builtins_move: { host_random: () => 0, host_sin: Math.sin, host_cos: Math.cos },
  builtins_math: { host_sin: Math.sin, host_cos: Math.cos, host_atan2: Math.atan2 },
  builtins_math2: { host_sin: Math.sin, host_cos: Math.cos },
  svphysics: { host_watersplash: () => {}, host_hitsound: () => {} },
  svpusher: { host_sin: Math.sin, host_cos: Math.cos },
  svclient: { host_sin: Math.sin, host_cos: Math.cos },
};
const inst = await WebAssembly.instantiate(wasmBytes,
  new Proxy(imports, { get: (t, k) => (k in t ? t[k] : new Proxy({}, { get: () => () => 0 })), has: () => true }));
const x = inst.instance.exports;

// --- geometry helpers ----------------------------------------------------------
// hollow room: empty inside, solid outside (the world).
function room(lo, hi, clipBase, planeBase) {
  const dist = [hi[0], lo[0], hi[1], lo[1], hi[2], lo[2]];
  const nodes = [], planes = [];
  for (let i = 0; i <= 5; i++) {
    const children = [0, 0];
    children[1 - (i & 1)] = (i !== 5) ? (clipBase + i + 1) : CONTENTS_EMPTY;
    children[i & 1] = CONTENTS_SOLID;
    nodes.push({ idx: clipBase + i, planenum: planeBase + i, children });
    const normal = [0, 0, 0]; normal[i >> 1] = 1.0;
    planes.push({ idx: planeBase + i, type: i >> 1, normal, dist: dist[i] });
  }
  return { nodes, planes, first: clipBase, last: clipBase + 5 };
}
// solid block: solid inside, empty outside (the pusher's brush).
function block(lo, hi, clipBase, planeBase) {
  const dist = [hi[0], lo[0], hi[1], lo[1], hi[2], lo[2]];
  const nodes = [], planes = [];
  for (let i = 0; i <= 5; i++) {
    const children = [0, 0];
    children[i & 1] = CONTENTS_EMPTY;
    children[1 - (i & 1)] = (i !== 5) ? (clipBase + i + 1) : CONTENTS_SOLID;
    nodes.push({ idx: clipBase + i, planenum: planeBase + i, children });
    const normal = [0, 0, 0]; normal[i >> 1] = 1.0;
    planes.push({ idx: planeBase + i, type: i >> 1, normal, dist: dist[i] });
  }
  return { nodes, planes, first: clipBase, last: clipBase + 5 };
}

const CMIN = [[0, 0, 0], [-16, -16, -24], [-32, -32, -24]];
const CMAX = [[0, 0, 0], [16, 16, 32], [32, 32, 64]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// World: a big hollow room, dilated per hull.
const WLO = [-2048, -2048, -2048], WHI = [2048, 2048, 2048];
const w0 = room(WLO, WHI, 0, 0);
const w1 = room(sub(WLO, CMIN[1]), sub(WHI, CMAX[1]), 0, 6);
const w2 = room(sub(WLO, CMIN[2]), sub(WHI, CMAX[2]), 6, 12);

// Pusher brush (model index 1): a SMALL solid block. Its hull-N solid region is
// the block Minkowski-expanded by that hull's clip box (lo - clip_maxs, hi - clip_mins),
// exactly as qbsp's hull expansion produces.
const BLO = [-32, -32, -32], BHI = [32, 32, 32];
const b0 = block(BLO, BHI, 6, 18);
const b1 = block(sub(BLO, CMAX[1]), sub(BHI, CMIN[1]), 12, 24);
const b2 = block(sub(BLO, CMAX[2]), sub(BHI, CMIN[2]), 18, 30);

for (const h of [w0, w1, w2, b0, b1, b2]) {
  for (const p of h.planes) x.setPlane(p.idx, p.normal[0], p.normal[1], p.normal[2], p.dist, p.type);
}
// hull 0 pool: world room (0..5) + pusher block (6..11)
for (const n of [...w0.nodes, ...b0.nodes]) x.setClipNode(n.idx, n.planenum, n.children[0], n.children[1]);
// hull 1/2 pool: world hull1 (0..5), world hull2 (6..11), block hull1 (12..17), block hull2 (18..23)
for (const n of [...w1.nodes, ...w2.nodes, ...b1.nodes, ...b2.nodes]) x.setClipNode12(n.idx, n.planenum, n.children[0], n.children[1]);

x.setHullMeta(w0.first, w0.last);
x.setWorldHullRange(w0.first, w0.last);
x.installHull1(w1.first, w1.last, CMIN[1][0], CMIN[1][1], CMIN[1][2]);
x.installHull2(w2.first, w2.last, CMIN[2][0], CMIN[2][1], CMIN[2][2]);
for (const hid of [0, 1, 2]) {
  const h = [w0, w1, w2][hid];
  x.installModelHull(0, hid, h.first, h.last, CMIN[hid][0], CMIN[hid][1], CMIN[hid][2]);
}
// model index 1 = the pusher's brush
for (const hid of [0, 1, 2]) {
  const h = [b0, b1, b2][hid];
  x.installModelHull(1, hid, h.first, h.last, CMIN[hid][0], CMIN[hid][1], CMIN[hid][2]);
}
x.pusherSetWorldHullRange(w0.first, w0.last);
x.initEdicts(MAX_EDICTS, 128); // entvars run to index 104; no progs needed for this path
x.initAreaTree(-4096, -4096, -4096, 4096, 4096, 4096, MAX_EDICTS);
x.initPusherState(MAX_EDICTS);
x.initEntState(0, 0);
x.setMaxVelocity(2000); x.setGravityCvar(800); x.setGravityFieldIdx(-1);
x.initModelPrecache();

const setf = (e, i, v) => x.edStoreFloat(e, i, v);
const getf = (e, i) => x.edLoadFloat(e, i);

const PUSHER = 1, CHECK = 2;
// The pusher's ENTITY bbox is far larger than its brush -- the shape of any
// non-boxy brush volume. mins/maxs are what the buggy box-hull test used.
const PMINS = [-512, -512, -512], PMAXS = [512, 512, 512];

function setup(checkOrigin) {
  for (let e = 0; e <= CHECK; e++) { x.setEdictFree(e, 0); x.unlinkEdict(e); }
  // worldspawn
  setf(0, F.SOLID, SOLID_BSP); setf(0, F.MOVETYPE, 0); setf(0, F.MODELINDEX, 0); setf(0, F.SKIN, 0);
  for (const i of [F.ORIGIN, F.ORIGIN1, F.ORIGIN2, F.MINS, F.MINS1, F.MINS2, F.MAXS, F.MAXS1, F.MAXS2]) setf(0, i, 0);

  // contents pusher: SOLID_BSP + skin < 0 (invisible to clipToLinks, so SV_PushMove
  // must test overlap against its own hull -- the path under test).
  setf(PUSHER, F.SOLID, SOLID_BSP); setf(PUSHER, F.MOVETYPE, MT_PUSH);
  setf(PUSHER, F.MODELINDEX, 1); setf(PUSHER, F.SKIN, -3);
  setf(PUSHER, F.ORIGIN, 0); setf(PUSHER, F.ORIGIN1, 0); setf(PUSHER, F.ORIGIN2, 0);
  setf(PUSHER, F.ANGLES, 0); setf(PUSHER, F.ANGLES + 1, 0); setf(PUSHER, F.ANGLES + 2, 0);
  setf(PUSHER, F.AVELOCITY, 0); setf(PUSHER, F.AVELOCITY + 1, 0); setf(PUSHER, F.AVELOCITY + 2, 0);
  setf(PUSHER, F.MINS, PMINS[0]); setf(PUSHER, F.MINS1, PMINS[1]); setf(PUSHER, F.MINS2, PMINS[2]);
  setf(PUSHER, F.MAXS, PMAXS[0]); setf(PUSHER, F.MAXS1, PMAXS[1]); setf(PUSHER, F.MAXS2, PMAXS[2]);
  setf(PUSHER, F.SIZE, PMAXS[0] - PMINS[0]);
  setf(PUSHER, F.VELOCITY, 0); setf(PUSHER, F.VELOCITY1, 0); setf(PUSHER, F.VELOCITY2, 40);
  setf(PUSHER, F.LTIME, 0); setf(PUSHER, F.NEXTTHINK, -1); setf(PUSHER, F.FLAGS, 0);
  x.edStoreInt(PUSHER, F.GROUNDENTITY, 0);

  // free-floating entity: inside the pusher's BBOX, outside (or inside) its BRUSH
  setf(CHECK, F.SOLID, SOLID_SLIDEBOX); setf(CHECK, F.MOVETYPE, MT_TOSS);
  setf(CHECK, F.MODELINDEX, 0); setf(CHECK, F.SKIN, 0);
  setf(CHECK, F.ORIGIN, checkOrigin[0]); setf(CHECK, F.ORIGIN1, checkOrigin[1]); setf(CHECK, F.ORIGIN2, checkOrigin[2]);
  setf(CHECK, F.MINS, -16); setf(CHECK, F.MINS1, -16); setf(CHECK, F.MINS2, -24);
  setf(CHECK, F.MAXS, 16); setf(CHECK, F.MAXS1, 16); setf(CHECK, F.MAXS2, 40);
  setf(CHECK, F.SIZE, 32);
  setf(CHECK, F.VELOCITY, 0); setf(CHECK, F.VELOCITY1, 0); setf(CHECK, F.VELOCITY2, 0);
  setf(CHECK, F.ANGLES, 0); setf(CHECK, F.NEXTTHINK, -1); setf(CHECK, F.FLAGS, 0);
  x.edStoreInt(CHECK, F.GROUNDENTITY, 0);

  x.setNumEdicts(CHECK + 1);
  x.linkEdict(0); x.linkEdict(PUSHER); x.linkEdict(CHECK);
}

// Does one pushMove carry the CHECK entity?
function carried(checkOrigin) {
  setup(checkOrigin);
  const before = [getf(CHECK, F.ORIGIN), getf(CHECK, F.ORIGIN1), getf(CHECK, F.ORIGIN2)];
  x.pushMove(PUSHER, 0.05);
  const after = [getf(CHECK, F.ORIGIN), getf(CHECK, F.ORIGIN1), getf(CHECK, F.ORIGIN2)];
  return { moved: before[0] !== after[0] || before[1] !== after[1] || before[2] !== after[2], before, after };
}

let ok = true;

// (1) Inside the bbox, well OUTSIDE the brush (hull1 solid half-extent is 48/56 in
// z; 300 units out on X is unambiguously empty) -- vanilla does NOT carry it.
{
  const r = carried([300, 0, 0]);
  const pass = !r.moved;
  ok = ok && pass;
  console.log(`[${pass ? 'PASS' : 'FAIL'}] outside-brush entity is NOT a rider  (origin ${r.before} -> ${r.after})`);
}

// (2) Inside the brush -- vanilla DOES carry it. Guards against "fix" by disabling
// the overlap path entirely.
{
  const r = carried([0, 0, 0]);
  const pass = r.moved;
  ok = ok && pass;
  console.log(`[${pass ? 'PASS' : 'FAIL'}] inside-brush entity IS a rider       (origin ${r.before} -> ${r.after})`);
}

// (3) Just outside the hull1 solid region on X (block half-extent 32 + clip_maxs 16
// = 48; at 60 the check's own box is clear of it) -- still not a rider.
{
  const r = carried([60, 0, 0]);
  const pass = !r.moved;
  ok = ok && pass;
  console.log(`[${pass ? 'PASS' : 'FAIL'}] just-outside-brush entity is NOT a rider (origin ${r.before} -> ${r.after})`);
}

console.log(ok ? 'pusherhull: OK' : 'pusherhull: FAILED');
process.exit(ok ? 0 : 1);
