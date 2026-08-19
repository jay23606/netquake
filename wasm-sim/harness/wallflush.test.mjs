// Regression: a box FLUSH against an axis wall must produce the vanilla
// fraction-0 + valid-plane trace, and a MOVETYPE_BOUNCE entity in that position
// must bounce off it instead of freezing in mid-air forever.
//
// Reproduces the live "monster_tarbaby frozen mid-leap" report (AD 1.81 / e4m7,
// sv_wasm 1): a hull1-size box with maxs_z = 40 (taller than hull1's clip_maxs_z
// of 32) sitting flush against a wall whose plane normal is (0,1,0), moving
// south+down. sv.ts's collision path answers fraction 0 with plane (0,1,0), so
// SV_Physics_Toss's SV_ClipVelocity bounces velocity_y off it; if the sim answers
// with a zeroed plane (or any plane orthogonal to the velocity) ClipVelocity is a
// no-op and the entity is stuck against the wall for the rest of the map.
//
// Two layers:
//   Part A -- raw trace parity: wasm move() vs a JS transliteration of sv.ts
//             (hullForEntity SOLID_BSP branch on the world edict +
//             recursiveHullCheck), over every wall, both flush and epsilon-offset
//             starts, for box sizes spanning all three hulls.
//   Part B -- behavioural: drive the real physicsFrame loop and assert the
//             bouncing entity actually leaves the wall.
//
// Needs build/sim.wasm + build/id1_progs.dat (gitignored; extract_progs.mjs).
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadProgs } from './progsLoader.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAX_EDICTS = 512;
const F = { MODELINDEX: 0, MOVETYPE: 8, SOLID: 9, ORIGIN: 10, ORIGIN1: 11, ORIGIN2: 12,
  VELOCITY: 16, VELOCITY1: 17, VELOCITY2: 18,
  MINS: 33, MINS1: 34, MINS2: 35, MAXS: 36, MAXS1: 37, MAXS2: 38,
  NEXTTHINK: 46, HEALTH: 48, FLAGS: 76 };
const SOLID_NOT = 0, SOLID_SLIDEBOX = 3, SOLID_BSP = 4, MT_BOUNCE = 10, FL_ONGROUND = 512;
const CONTENTS_EMPTY = -1, CONTENTS_SOLID = -2;

// ================================================================================
// wasm instance
// ================================================================================
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

// ================================================================================
// JS reference -- transliterated from src/engine/sv.ts (recursiveHullCheck /
// hullPointContents / hullForEntity SOLID_BSP branch / clipMoveToEntity), the
// same duplication convention world.test.mjs and worldhulls.test.mjs follow.
// ================================================================================
function jsHullPointContents(hull, num, p) {
  while (num >= 0) {
    if (num < hull.firstclipnode || num > hull.lastclipnode) throw new Error('bad node number');
    const node = hull.clipnodes[num];
    const plane = hull.planes[node.planenum];
    let d;
    if (plane.type <= 2) d = p[plane.type] - plane.dist;
    else d = plane.normal[0] * p[0] + plane.normal[1] * p[1] + plane.normal[2] * p[2] - plane.dist;
    num = d >= 0.0 ? node.children[0] : node.children[1];
  }
  return num;
}

function jsRecursiveHullCheck(hull, num, p1f, p2f, p1, p2, trace) {
  if (num < 0) {
    if (num !== CONTENTS_SOLID) {
      trace.allsolid = false;
      if (num === CONTENTS_EMPTY) trace.inopen = true;
      else trace.inwater = true;
    } else trace.startsolid = true;
    return true;
  }
  if (num < hull.firstclipnode || num > hull.lastclipnode) throw new Error('bad node number');

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

  if (side === 0) {
    trace.plane.normal = [plane.normal[0], plane.normal[1], plane.normal[2]];
    trace.plane.dist = plane.dist;
  } else {
    trace.plane.normal = [-plane.normal[0], -plane.normal[1], -plane.normal[2]];
    trace.plane.dist = -plane.dist;
  }

  let f2 = frac, m = mid.slice(), mf = midf;
  while (jsHullPointContents(hull, hull.firstclipnode, m) === CONTENTS_SOLID) {
    f2 -= 0.1;
    if (f2 < 0.0) { trace.fraction = mf; trace.endpos = m.slice(); return false; }
    mf = p1f + (p2f - p1f) * f2;
    m = [p1[0] + f2 * (p2[0] - p1[0]), p1[1] + f2 * (p2[1] - p1[1]), p1[2] + f2 * (p2[2] - p1[2])];
  }
  trace.fraction = mf;
  trace.endpos = m.slice();
  return false;
}

// sv.ts hullForEntity SOLID_BSP branch applied to the world edict (origin (0,0,0)),
// then clipMoveToEntity: size = maxs[0]-mins[0] (X ONLY), <3 -> hull0, <=32 -> hull1.
function jsWorldClip(hulls, mins, maxs, start, end) {
  const size = maxs[0] - mins[0];
  const hullId = size < 3.0 ? 0 : (size <= 32.0 ? 1 : 2);
  const hull = hulls[hullId];
  const off = [hull.clip_mins[0] - mins[0], hull.clip_mins[1] - mins[1], hull.clip_mins[2] - mins[2]];
  const adjStart = [start[0] - off[0], start[1] - off[1], start[2] - off[2]];
  const adjEnd = [end[0] - off[0], end[1] - off[1], end[2] - off[2]];
  const trace = { fraction: 1.0, allsolid: true, startsolid: false, inopen: false, inwater: false,
    endpos: [...adjEnd], plane: { normal: [0.0, 0.0, 0.0], dist: 0.0 }, ent: null };
  jsRecursiveHullCheck(hull, hull.firstclipnode, 0.0, 1.0, adjStart, adjEnd, trace);
  trace.endpos = [trace.endpos[0] + off[0], trace.endpos[1] + off[1], trace.endpos[2] + off[2]];
  if (trace.fraction < 1.0 || trace.startsolid === true) trace.ent = 0;
  return { hullId, trace };
}

// ================================================================================
// Geometry: a hollow room (empty inside, solid outside), pre-dilated per hull --
// the same construction hulloffset.test.mjs uses.
// ================================================================================
function room(lo, hi, clipBase, planeBase) {
  const dist = [hi[0], lo[0], hi[1], lo[1], hi[2], lo[2]];
  const nodes = [], planes = [], clipnodes = [];
  for (let i = 0; i <= 5; i++) {
    const children = [0, 0];
    children[1 - (i & 1)] = (i !== 5) ? (clipBase + i + 1) : CONTENTS_EMPTY;
    children[i & 1] = CONTENTS_SOLID;
    nodes.push({ idx: clipBase + i, planenum: planeBase + i, children });
    clipnodes[clipBase + i] = { planenum: planeBase + i, children };
    const normal = [0, 0, 0]; normal[i >> 1] = 1.0;
    planes[planeBase + i] = { type: i >> 1, normal, dist: dist[i] };
  }
  return { nodes, planes, clipnodes, first: clipBase, last: clipBase + 5,
           firstclipnode: clipBase, lastclipnode: clipBase + 5 };
}

const LO = [-1024, -1024, -1024], HI = [1024, 1024, 1024];
const CMIN = [[0, 0, 0], [-16, -16, -24], [-32, -32, -24]];
const CMAX = [[0, 0, 0], [16, 16, 32], [32, 32, 64]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

// hull 0 uses its own pool/index space; hulls 1+2 share the CLIP12 pool.
const h0 = room(LO, HI, 0, 0);
const h1 = room(sub(LO, CMIN[1]), sub(HI, CMAX[1]), 0, 6);
const h2 = room(sub(LO, CMIN[2]), sub(HI, CMAX[2]), 6, 12);
const jsHulls = [
  { ...h0, clip_mins: CMIN[0] },
  { ...h1, clip_mins: CMIN[1] },
  { ...h2, clip_mins: CMIN[2] },
];

loadProgs(x, readFileSync(join(HERE, '..', 'build', 'id1_progs.dat')), MAX_EDICTS);
x.initStringTemp();
for (const h of [h0, h1, h2]) for (let i = 0; i < h.planes.length; i++) {
  const p = h.planes[i]; if (p) x.setPlane(i, p.normal[0], p.normal[1], p.normal[2], p.dist, p.type);
}
for (const n of h0.nodes) x.setClipNode(n.idx, n.planenum, n.children[0], n.children[1]);
x.setHullMeta(h0.first, h0.last);
x.setWorldHullRange(h0.first, h0.last);
for (const n of h1.nodes) x.setClipNode12(n.idx, n.planenum, n.children[0], n.children[1]);
for (const n of h2.nodes) x.setClipNode12(n.idx, n.planenum, n.children[0], n.children[1]);
x.installHull1(h1.first, h1.last, CMIN[1][0], CMIN[1][1], CMIN[1][2]);
x.installHull2(h2.first, h2.last, CMIN[2][0], CMIN[2][1], CMIN[2][2]);
for (const hid of [0, 1, 2]) {
  const h = [h0, h1, h2][hid];
  x.installModelHull(0, hid, h.first, h.last, CMIN[hid][0], CMIN[hid][1], CMIN[hid][2]);
}
x.pusherSetWorldHullRange(h0.first, h0.last);
x.initAreaTree(-2048, -2048, -2048, 2048, 2048, 2048, MAX_EDICTS);
x.initPusherState(MAX_EDICTS); x.initEntState(0, 0);
x.setMaxVelocity(2000); x.setGravityCvar(800); x.setGravityFieldIdx(-1);
x.setMaxSpeed(320); x.setAccelerateCvar(10); x.setFrictionCvar(4);
x.setEdgeFrictionCvar(2); x.setStopSpeedCvar(100); x.setNoStep(0);
x.initModelPrecache();

const setf = (e, i, v) => x.edStoreFloat(e, i, v);

function wasmMove(mins, maxs, start, end) {
  x.move(start[0], start[1], start[2], mins[0], mins[1], mins[2], maxs[0], maxs[1], maxs[2],
    end[0], end[1], end[2], 0 /* MOVE_NORMAL */, -1 /* no passedict */);
  return {
    fraction: x.moveTraceFraction(),
    endpos: [x.moveTraceEndX(), x.moveTraceEndY(), x.moveTraceEndZ()],
    plane: { normal: [x.moveTracePlaneNX(), x.moveTracePlaneNY(), x.moveTracePlaneNZ()], dist: x.moveTracePlaneDist() },
    allsolid: x.moveTraceAllSolid() !== 0,
    startsolid: x.moveTraceStartSolid() !== 0,
    inopen: x.moveTraceInOpen() !== 0,
    inwater: x.moveTraceInWater() !== 0,
    ent: x.moveTraceEnt() === -1 ? null : x.moveTraceEnt(),
  };
}

let fails = 0, checks = 0;
const sample = [];
function eq(w, j, ctx) {
  checks++;
  if (!Object.is(w, j)) { fails++; if (sample.length < 10) sample.push(`${ctx} wasm=${w} js=${j}`); }
}
function cmpTrace(w, j, ctx) {
  eq(w.fraction, j.fraction, ctx + ' fraction');
  for (let i = 0; i < 3; i++) eq(w.endpos[i], j.endpos[i], `${ctx} endpos[${i}]`);
  for (let i = 0; i < 3; i++) eq(w.plane.normal[i], j.plane.normal[i], `${ctx} plane.normal[${i}]`);
  eq(w.plane.dist, j.plane.dist, ctx + ' plane.dist');
  eq(w.allsolid, j.allsolid, ctx + ' allsolid');
  eq(w.startsolid, j.startsolid, ctx + ' startsolid');
  eq(w.inopen, j.inopen, ctx + ' inopen');
  eq(w.inwater, j.inwater, ctx + ' inwater');
  eq(w.ent, j.ent, ctx + ' ent');
}

// ================================================================================
// Part A -- flush-against-wall trace parity, every wall, every box size.
// ================================================================================
// The tarbaby from the live report, plus the hull0/hull1/hull2 spectrum. maxs_z=40
// is the load-bearing detail: it is TALLER than hull1's clip_maxs_z (32), so the
// swept box pokes out of the hull it is traced against.
const BOXES = [
  { name: 'tarbaby(maxs_z=40)', mins: [-16, -16, -24], maxs: [16, 16, 40] },
  { name: 'player', mins: [-16, -16, -24], maxs: [16, 16, 32] },
  { name: 'head(mins_z=0)', mins: [-16, -16, 0], maxs: [16, 16, 56] },
  { name: 'point', mins: [0, 0, 0], maxs: [0, 0, 0] },
  { name: 'shambler', mins: [-32, -32, -24], maxs: [32, 32, 64] },
];
// Room face -> (axis, sign): sign -1 = the low wall, +1 = the high wall.
const WALLS = [[0, -1], [0, 1], [1, -1], [1, 1], [2, -1], [2, 1]];
// How far off the exact flush position to start (0 = flush; 0.03125 = the
// recursiveHullCheck DIST_EPSILON, the boundary the side test flips on).
const OFFSETS = [0, 0.03125, -0.03125, 0.5, -0.5, 1];

for (const box of BOXES) {
  const size = box.maxs[0] - box.mins[0];
  const hullId = size < 3.0 ? 0 : (size <= 32.0 ? 1 : 2);
  for (const [axis, sign] of WALLS) {
    // The flush coordinate in WORLD space: the hull's wall plane sits at
    // (room bound - hull clip bound); a box origin there has its face on the wall.
    const wallDist = sign < 0 ? LO[axis] - CMIN[hullId][axis] : HI[axis] - CMAX[hullId][axis];
    const off = [hullId === 0 ? 0 : CMIN[hullId][axis] - box.mins[axis]];
    void off;
    for (const eps of OFFSETS) {
      const start = [0, 0, 0];
      start[axis] = wallDist - sign * eps;
      // Moves: straight into the wall, into the wall + down, along the wall,
      // straight down, and a zero-length probe.
      const moves = [];
      const intoWall = [0, 0, 0]; intoWall[axis] = sign * 8;
      moves.push(['into', intoWall]);
      const diag = [0, 0, 0]; diag[axis] = sign * 8; if (axis !== 2) diag[2] = -8;
      moves.push(['into+down', diag]);
      moves.push(['down', [0, 0, -8]]);
      moves.push(['zero', [0, 0, 0]]);
      const away = [0, 0, 0]; away[axis] = -sign * 8;
      moves.push(['away', away]);
      for (const [mname, d] of moves) {
        const end = [start[0] + d[0], start[1] + d[1], start[2] + d[2]];
        const j = jsWorldClip(jsHulls, box.mins, box.maxs, start, end);
        const w = wasmMove(box.mins, box.maxs, start, end);
        cmpTrace(w, j.trace, `${box.name} wall(ax=${axis},s=${sign}) eps=${eps} ${mname}`);
      }
    }
  }
}
const partA = fails === 0;
console.log(`[${partA ? 'PASS' : 'FAIL'}] wallflush.trace: ${checks - fails}/${checks} bit-exact`);
for (const s of sample) console.log('   ', s);

// ================================================================================
// Part B -- behavioural: a MOVETYPE_BOUNCE entity flush against a wall must bounce
// off it (SV_ClipVelocity against the wall plane), not freeze in place forever.
// This is the live symptom: origin never changes, velocity_y never changes, only
// gravity integrates.
// ================================================================================
function bounceOffWall(box, axis, sign, vel) {
  for (let e = 0; e < 2; e++) x.setEdictFree(e, 0);
  // worldspawn
  setf(0, F.SOLID, SOLID_BSP); setf(0, F.MOVETYPE, 0); setf(0, F.MODELINDEX, 0);
  for (const i of [F.ORIGIN, F.ORIGIN1, F.ORIGIN2, F.MINS, F.MINS1, F.MINS2, F.MAXS, F.MAXS1, F.MAXS2]) setf(0, i, 0);
  const size = box.maxs[0] - box.mins[0];
  const hullId = size < 3.0 ? 0 : (size <= 32.0 ? 1 : 2);
  const wallDist = sign < 0 ? LO[axis] - CMIN[hullId][axis] : HI[axis] - CMAX[hullId][axis];
  const start = [0, 0, 0]; start[axis] = wallDist;
  setf(1, F.ORIGIN, start[0]); setf(1, F.ORIGIN1, start[1]); setf(1, F.ORIGIN2, start[2]);
  setf(1, F.MINS, box.mins[0]); setf(1, F.MINS1, box.mins[1]); setf(1, F.MINS2, box.mins[2]);
  setf(1, F.MAXS, box.maxs[0]); setf(1, F.MAXS1, box.maxs[1]); setf(1, F.MAXS2, box.maxs[2]);
  setf(1, F.SOLID, SOLID_SLIDEBOX); setf(1, F.MOVETYPE, MT_BOUNCE);
  setf(1, F.VELOCITY, vel[0]); setf(1, F.VELOCITY1, vel[1]); setf(1, F.VELOCITY2, vel[2]);
  setf(1, F.NEXTTHINK, -1); setf(1, F.HEALTH, 100); setf(1, F.FLAGS, 0);
  x.setNumEdicts(2); x.linkEdict(0); x.linkEdict(1);

  const v0 = [x.edLoadFloat(1, F.VELOCITY), x.edLoadFloat(1, F.VELOCITY1), x.edLoadFloat(1, F.VELOCITY2)];
  let time = 0; const dt = 1 / 72;
  for (let fr = 0; fr < 8; fr++) {
    x.setServerTime(time); x.physicsFrame(time, dt);
    time += dt;
    const o = [x.edLoadFloat(1, F.ORIGIN), x.edLoadFloat(1, F.ORIGIN1), x.edLoadFloat(1, F.ORIGIN2)];
    const v = [x.edLoadFloat(1, F.VELOCITY), x.edLoadFloat(1, F.VELOCITY1), x.edLoadFloat(1, F.VELOCITY2)];
    // Bounced if the into-wall velocity component reversed sign (ClipVelocity ran)
    // or the entity actually left the wall coordinate.
    const bounced = Math.sign(v[axis]) !== Math.sign(v0[axis]) || o[axis] !== start[axis];
    if (bounced) return { ok: true, fr };
  }
  return { ok: false, fr: 8,
    o: [x.edLoadFloat(1, F.ORIGIN), x.edLoadFloat(1, F.ORIGIN1), x.edLoadFloat(1, F.ORIGIN2)],
    v: [x.edLoadFloat(1, F.VELOCITY), x.edLoadFloat(1, F.VELOCITY1), x.edLoadFloat(1, F.VELOCITY2)] };
}

let partB = true;
for (const box of BOXES) {
  if (box.name === 'point') continue; // a point hull box has no meaningful wall bounce
  for (const [axis, sign] of WALLS) {
    if (axis === 2 && sign < 0) continue; // floor: lands (FL_ONGROUND) instead of bouncing
    const vel = [0, 0, 0]; vel[axis] = sign * 100;
    if (axis !== 2) vel[2] = 129; // the live report's upward leap component
    const r = bounceOffWall(box, axis, sign, vel);
    if (!r.ok) {
      partB = false;
      console.log(`    STUCK: ${box.name} wall(ax=${axis},s=${sign}) origin=${r.o} velocity=${r.v}`);
    }
  }
}
console.log(`[${partB ? 'PASS' : 'FAIL'}] wallflush.bounce: MOVETYPE_BOUNCE unsticks from every wall`);

const ok = partA && partB;
console.log(ok ? 'wallflush: OK' : 'wallflush: FAILED');
process.exit(ok ? 0 : 1);
