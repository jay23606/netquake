// Golden parity test: world.ts's hull 1/2 storage + selectWorldHull (the
// hull-selection-by-box-size table) and svmove.ts's clipToWorld wiring, vs a JS
// reference transliterating sv.ts's hullForEntity (SOLID_BSP branch, applied to
// the world edict) + recursiveHullCheck/hullPointContents, exactly matching the
// world.test.mjs / svmove.test.mjs pattern.
//
// Scope: the WORLD entity's own hull pick only (hullForEntity's SOLID_BSP
// branch with the world edict's origin pinned at (0,0,0), per svmove.ts's
// clipToWorld header note). No linked touch entities are needed to exercise
// this -- svmove.ts's move() with an empty area tree returns exactly
// clipToWorld's result unchanged (SV_ClipToLinks has nothing to walk), so
// move()'s output is a direct, integration-level check of clipToWorld's hull
// selection + offset arithmetic.
//
// svmove.wasm already carries every world.ts export (svmove.ts does
// `export * from "./world"`), including the new installHull1/installHull2/
// setClipNode12/selectWorldHull/selectedHullOffset*/selectedHullId -- so this
// test reuses build/svmove.wasm exactly like svmove.test.mjs does, without any
// run.mjs/index.ts changes.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { rng, Check } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SVMOVE_WASM = join(HERE, '..', 'build', 'svmove.wasm');

async function loadSvmoveWasm() {
  const bytes = readFileSync(SVMOVE_WASM);
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: { abort: (msg, file, line, col) => { throw new Error(`svmove.wasm abort @${line}:${col}`); } },
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

const x = await loadSvmoveWasm();

// --- bit-exact f64 checker (trace fields are never f32-quantized -- see
// world.test.mjs's identical rationale) -----------------------------------------
class CheckF64 {
  constructor(name) { this.name = name; this.n = 0; this.fails = 0; this.samples = []; }
  eq(w, j, ctx = '') {
    this.n++;
    if (!Object.is(w, j)) { this.fails++; if (this.samples.length < 8) this.samples.push(`${ctx} wasm=${w} js=${j}`); }
  }
  report() {
    const ok = this.fails === 0;
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${this.name}: ${this.n - this.fails}/${this.n} bit-exact`);
    for (const s of this.samples) console.log('   ', s);
    return ok;
  }
}

// ================================================================================
// JS reference model
// ================================================================================
const CONTENTS_EMPTY = -1, CONTENTS_SOLID = -2;

// --- recursiveHullCheck / hullPointContents (transliterated identically to
// world.test.mjs / svmove.test.mjs -- duplicated per project convention) -------
function jsHullPointContents(hull, num, p) {
  while (num >= 0) {
    if (num < hull.firstclipnode || num > hull.lastclipnode) throw new Error('bad node number');
    const node = hull.clipnodes[num];
    const plane = hull.planes[node.planenum];
    let d;
    if (plane.type <= 2) d = p[plane.type] - plane.dist;
    else d = plane.normal[0] * p[0] + plane.normal[1] * p[1] + plane.normal[2] * p[2] - plane.dist;
    if (d >= 0.0) num = node.children[0];
    else num = node.children[1];
  }
  return num;
}

function jsRecursiveHullCheck(hull, num, p1f, p2f, p1, p2, trace) {
  if (num < 0) {
    if (num !== CONTENTS_SOLID) {
      trace.allsolid = false;
      if (num === CONTENTS_EMPTY) trace.inopen = true;
      else trace.inwater = true;
    } else {
      trace.startsolid = true;
    }
    return true;
  }
  if (num < hull.firstclipnode || num > hull.lastclipnode) throw new Error('bad node number');

  const node = hull.clipnodes[num];
  const plane = hull.planes[node.planenum];
  const child0 = node.children[0], child1 = node.children[1];
  let t1, t2;
  if (plane.type <= 2) {
    t1 = p1[plane.type] - plane.dist;
    t2 = p2[plane.type] - plane.dist;
  } else {
    t1 = plane.normal[0] * p1[0] + plane.normal[1] * p1[1] + plane.normal[2] * p1[2] - plane.dist;
    t2 = plane.normal[0] * p2[0] + plane.normal[1] * p2[1] + plane.normal[2] * p2[2] - plane.dist;
  }

  if (t1 >= 0.0 && t2 >= 0.0) return jsRecursiveHullCheck(hull, child0, p1f, p2f, p1, p2, trace);
  if (t1 < 0.0 && t2 < 0.0) return jsRecursiveHullCheck(hull, child1, p1f, p2f, p1, p2, trace);

  let frac = (t1 + (t1 < 0.0 ? 0.03125 : -0.03125)) / (t1 - t2);
  if (frac < 0.0) frac = 0.0;
  else if (frac > 1.0) frac = 1.0;
  const midf = p1f + (p2f - p1f) * frac;
  const mid = [p1[0] + frac * (p2[0] - p1[0]), p1[1] + frac * (p2[1] - p1[1]), p1[2] + frac * (p2[2] - p1[2])];
  const side = t1 < 0.0 ? 1 : 0;

  if (jsRecursiveHullCheck(hull, side === 0 ? child0 : child1, p1f, midf, p1, mid, trace) !== true)
    return false;

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
    if (f2 < 0.0) {
      trace.fraction = mf;
      trace.endpos = m.slice();
      return false;
    }
    mf = p1f + (p2f - p1f) * f2;
    m = [p1[0] + f2 * (p2[0] - p1[0]), p1[1] + f2 * (p2[1] - p1[1]), p1[2] + f2 * (p2[2] - p1[2])];
  }
  trace.fraction = mf;
  trace.endpos = m.slice();
  return false;
}

function makeEmptyTrace(end) {
  return { fraction: 1.0, allsolid: true, startsolid: false, inopen: false, inwater: false, endpos: [...end], plane: { normal: [0.0, 0.0, 0.0], dist: 0.0 }, ent: null };
}

// --- synthetic axial box hull (same 6-plane pattern as world.test.mjs /
// svmove.test.mjs's makeBoxHull, parameterized by clipnode/plane numbering so
// hull 1 and hull 2 can be placed at disjoint sub-ranges of ONE shared
// clipnodes array -- exactly mirroring mod.ts's hull1/hull2 sharing the raw
// BSP `clipnodes` lump, see world.ts's CLIP12_* header note). -------------------
function makeBoxHullAt(lo, hi, firstclipnode, planeBase) {
  const dist = [hi[0], lo[0], hi[1], lo[1], hi[2], lo[2]];
  const clipnodes = [], planes = [];
  for (let i = 0; i <= 5; i++) {
    const node = { planenum: planeBase + i, children: [0, 0] };
    node.children[i & 1] = CONTENTS_EMPTY;
    node.children[1 - (i & 1)] = (i !== 5) ? firstclipnode + i + 1 : CONTENTS_SOLID;
    clipnodes[firstclipnode + i] = node;
    const normal = [0.0, 0.0, 0.0];
    normal[i >> 1] = 1.0;
    planes[planeBase + i] = { type: i >> 1, normal, dist: dist[i] };
  }
  return { clipnodes, planes, firstclipnode, lastclipnode: firstclipnode + 5 };
}

// sv.ts hullForEntity's SOLID_BSP branch, specialized to the world edict (whose
// origin is always (0,0,0), and whose solid is always SOLID_BSP): size is the
// move's own box X-extent ONLY (the exact vanilla quirk), thresholds <3.0/<=32.0.
function jsSelectWorldHull(mins, maxs) {
  const size = maxs[0] - mins[0];
  if (size < 3.0) return 0;
  if (size <= 32.0) return 1;
  return 2;
}

function jsHullForEntityWorld(hulls, mins, maxs) {
  const hullId = jsSelectWorldHull(mins, maxs);
  const hull = hulls[hullId];
  const offset = [hull.clip_mins[0] - mins[0], hull.clip_mins[1] - mins[1], hull.clip_mins[2] - mins[2]];
  return { hullId, hull, offset };
}

function jsClipToWorld3(hulls, mins, maxs, start, end) {
  const { hullId, hull, offset } = jsHullForEntityWorld(hulls, mins, maxs);
  const adjStart = [start[0] - offset[0], start[1] - offset[1], start[2] - offset[2]];
  const adjEnd = [end[0] - offset[0], end[1] - offset[1], end[2] - offset[2]];
  const trace = makeEmptyTrace(adjEnd);
  jsRecursiveHullCheck(hull, hull.firstclipnode, 0.0, 1.0, adjStart, adjEnd, trace);
  // Offset re-added UNCONDITIONALLY -- endpos is always adjusted-space (sv.ts/sim parity).
  trace.endpos[0] += offset[0]; trace.endpos[1] += offset[1]; trace.endpos[2] += offset[2];
  if (trace.fraction < 1.0 || trace.startsolid === true) trace.ent = 0; // the world edict
  return { hullId, trace };
}

// ================================================================================
// Fixtures + wasm wiring
// ================================================================================
const MAX_EDICTS = 4; // no touch entities needed -- see header note

// hull 0 (point hull): a "raw" solid box, sized generously so hull0-selected
// (size < 3.0) sweeps starting/ending near it produce a mix of hit/miss.
const LO0 = [-32, -32, -32], HI0 = [32, 32, 32];
// hull 1/2 clip_mins/maxs -- vanilla's actual player/large-monster hull dims.
const HULL1_MINS = [-16, -16, -24], HULL1_MAXS = [16, 16, 32];
const HULL2_MINS = [-32, -32, -24], HULL2_MAXS = [32, 32, 64];
// hull1/hull2's own solid box = hull0's box "pre-expanded" by that hull's own
// clip_mins/clip_maxs (a Minkowski sum with the swept box, same as vanilla's
// hull-building CSG conceptually does) -- deterministic and gives each hull a
// visibly distinct solid region so selection actually changes trace outcomes.
const LO1 = [LO0[0] + HULL1_MINS[0], LO0[1] + HULL1_MINS[1], LO0[2] + HULL1_MINS[2]];
const HI1 = [HI0[0] + HULL1_MAXS[0], HI0[1] + HULL1_MAXS[1], HI0[2] + HULL1_MAXS[2]];
const LO2 = [LO0[0] + HULL2_MINS[0], LO0[1] + HULL2_MINS[1], LO0[2] + HULL2_MINS[2]];
const HI2 = [HI0[0] + HULL2_MAXS[0], HI0[1] + HULL2_MAXS[1], HI0[2] + HULL2_MAXS[2]];

const hull0 = { ...makeBoxHullAt(LO0, HI0, 0, 0), clip_mins: [0.0, 0.0, 0.0] };
const hull1 = { ...makeBoxHullAt(LO1, HI1, 0, 100), clip_mins: HULL1_MINS };
const hull2 = { ...makeBoxHullAt(LO2, HI2, 6, 200), clip_mins: HULL2_MINS };
const hulls = [hull0, hull1, hull2];

function loadHullsToWasm() {
  // Size the shared pools like the live embedder: plane indices reach 205 (hull2's
  // 200..205 range in the fully-shared plane store), clipnode indices reach 11.
  x.initHullStorage(12, 206);
  // hull 0 -- the module's original single-hull storage (setPlane/setClipNode/
  // setWorldHullRange), back-compat path.
  for (let i = 0; i <= 5; i++) {
    const p = hull0.planes[i];
    x.setPlane(i, p.normal[0], p.normal[1], p.normal[2], p.dist, p.type);
  }
  for (let i = hull0.firstclipnode; i <= hull0.lastclipnode; i++) {
    const n = hull0.clipnodes[i];
    x.setClipNode(i, n.planenum, n.children[0], n.children[1]);
  }
  x.setWorldHullRange(hull0.firstclipnode, hull0.lastclipnode);

  // hull 1/2 -- shared CLIP12 storage, disjoint index ranges (0..5 / 6..11),
  // planes at disjoint plane-number ranges (100../200..) in the SAME shared
  // plane store hull 0 also used (mirrors mod.ts's fully-shared `planes` array).
  for (let i = 100; i <= 105; i++) {
    const p = hull1.planes[i];
    x.setPlane(i, p.normal[0], p.normal[1], p.normal[2], p.dist, p.type);
  }
  for (let i = hull1.firstclipnode; i <= hull1.lastclipnode; i++) {
    const n = hull1.clipnodes[i];
    x.setClipNode12(i, n.planenum, n.children[0], n.children[1]);
  }
  x.installHull1(hull1.firstclipnode, hull1.lastclipnode, HULL1_MINS[0], HULL1_MINS[1], HULL1_MINS[2]);

  for (let i = 200; i <= 205; i++) {
    const p = hull2.planes[i];
    x.setPlane(i, p.normal[0], p.normal[1], p.normal[2], p.dist, p.type);
  }
  for (let i = hull2.firstclipnode; i <= hull2.lastclipnode; i++) {
    const n = hull2.clipnodes[i];
    x.setClipNode12(i, n.planenum, n.children[0], n.children[1]);
  }
  x.installHull2(hull2.firstclipnode, hull2.lastclipnode, HULL2_MINS[0], HULL2_MINS[1], HULL2_MINS[2]);
}

function readMoveTrace() {
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

function checkTrace(chk, w, j, ctx) {
  chk.frac.eq(w.fraction, j.fraction, ctx);
  chk.end.eq(w.endpos[0], j.endpos[0], ctx + ' endpos.x');
  chk.end.eq(w.endpos[1], j.endpos[1], ctx + ' endpos.y');
  chk.end.eq(w.endpos[2], j.endpos[2], ctx + ' endpos.z');
  chk.plane.eq(w.plane.normal[0], j.plane.normal[0], ctx + ' plane.normal.x');
  chk.plane.eq(w.plane.normal[1], j.plane.normal[1], ctx + ' plane.normal.y');
  chk.plane.eq(w.plane.normal[2], j.plane.normal[2], ctx + ' plane.normal.z');
  chk.plane.eq(w.plane.dist, j.plane.dist, ctx + ' plane.dist');
  chk.flags.intEq(w.allsolid ? 1 : 0, j.allsolid ? 1 : 0, ctx + ' allsolid');
  chk.flags.intEq(w.startsolid ? 1 : 0, j.startsolid ? 1 : 0, ctx + ' startsolid');
  chk.flags.intEq(w.inopen ? 1 : 0, j.inopen ? 1 : 0, ctx + ' inopen');
  chk.flags.intEq(w.inwater ? 1 : 0, j.inwater ? 1 : 0, ctx + ' inwater');
  chk.flags.intEq(w.ent === null ? -1 : w.ent, j.ent === null ? -1 : j.ent, ctx + ' ent');
}

const results = [];
const WORLD_MINS = [-2048, -2048, -2048], WORLD_MAXS = [2048, 2048, 2048];

x.initEdicts(MAX_EDICTS, 100);
x.initAreaTree(WORLD_MINS[0], WORLD_MINS[1], WORLD_MINS[2], WORLD_MAXS[0], WORLD_MAXS[1], WORLD_MAXS[2], MAX_EDICTS);
loadHullsToWasm();

// === Test 1: hull-id selection parity across the full size spectrum, including
// the exact 3.0/32.0 boundary values (size<3.0 -> 0, size<=32.0 -> 1, else 2). ==
{
  const r = rng(0xD00D1E5);
  const chkId = new Check('selectWorldHull.hullId');
  const sizes = [0, 0.5, 1, 2, 2.999999, 3, 3.000001, 10, 20, 31.999998, 32, 32.000002, 33, 50, 90];
  for (const size of sizes) {
    const hx = size / 2;
    const mins = [-hx, -1, -1], maxs = [hx, 1, 1];
    const wHullId = x.selectWorldHull(mins[0], mins[1], mins[2], maxs[0], maxs[1], maxs[2]);
    const jHullId = jsSelectWorldHull(mins, maxs);
    chkId.intEq(wHullId, jHullId, `boundary size=${size}`);
  }
  for (let i = 0; i < 5000; i++) {
    const hx = Math.abs(r.f32(48));
    const mins = [-hx, -hx * 0.7, -hx * 0.5], maxs = [hx, hx * 0.7, hx * 0.5];
    const wHullId = x.selectWorldHull(mins[0], mins[1], mins[2], maxs[0], maxs[1], maxs[2]);
    const jHullId = jsSelectWorldHull(mins, maxs);
    chkId.intEq(wHullId, jHullId, `rand#${i} hx=${hx}`);
  }
  results.push(chkId.report());
}

// === Test 2: full move() integration -- thousands of random box-sweeps of
// varying size (spanning all 3 hulls) through the empty area tree, asserting
// bit-exact trace (fraction/endpos/plane/flags/ent) against jsClipToWorld3,
// AND that the selected hull id (read back via selectedHullId(), which
// clipToWorld leaves set after move()'s internal selectWorldHull call) matches
// the JS reference's hull pick. =================================================
{
  const r = rng(0xFEEDF00D);
  const chk = { frac: new CheckF64('move3.fraction'), end: new CheckF64('move3.endpos'), plane: new CheckF64('move3.plane'), flags: new Check('move3.flags') };
  const chkId = new Check('move3.hullId');

  // Buckets: force coverage of each hull's size range, plus fully random.
  function pickHalfExtent(bucket) {
    if (bucket === 0) return Math.abs(r.f32(1.4));         // size in [0,~2.8) -> hull 0
    if (bucket === 1) return 1.5 + Math.abs(r.f32(14.5));  // size in [3,32]   -> hull 1
    if (bucket === 2) return 16 + Math.abs(r.f32(30));     // size > 32        -> hull 2
    return Math.abs(r.f32(40));                            // fully random
  }

  for (let iter = 0; iter < 20000; iter++) {
    const bucket = r.int(4);
    const hx = pickHalfExtent(bucket);
    const mins = [-hx, -hx, -hx], maxs = [hx, hx, hx];

    const sx = r.f32(80), sy = r.f32(80), sz = r.f32(80);
    const ex = r.f32(80), ey = r.f32(80), ez = r.f32(80);

    // Read the hull pick via a direct selectWorldHull(...) call BEFORE move() --
    // move()'s own trailing `world.setHullMeta(...)` restore (see svmove.ts's
    // header note) resets world.ts's "last selected" bookkeeping to hull 0 by
    // design (that restore is what keeps pointContents() usable after a move()
    // call), so reading selectedHullId() AFTER move() would only ever see 0.
    const wHullId = x.selectWorldHull(mins[0], mins[1], mins[2], maxs[0], maxs[1], maxs[2]);

    x.move(sx, sy, sz, mins[0], mins[1], mins[2], maxs[0], maxs[1], maxs[2], ex, ey, ez, 0 /* MOVE_NORMAL */, -1 /* no passedict */);
    const w = readMoveTrace();

    const { hullId: jHullId, trace: j } = jsClipToWorld3(hulls, mins, maxs, [sx, sy, sz], [ex, ey, ez]);

    chkId.intEq(wHullId, jHullId, `move#${iter} hx=${hx}`);
    checkTrace(chk, w, j, `move#${iter}`);
  }
  results.push(chkId.report(), chk.frac.report(), chk.end.report(), chk.plane.report(), chk.flags.report());
}

// === Test 3: back-compat -- a FRESH single-hull setup that never installs
// hull 1/2 must always select hull 0 with a ZERO offset (the exact pre-task
// behavior), even for box sizes that would land on hull 1/2 once installed. ====
{
  const chk = { frac: new CheckF64('backcompat.fraction'), end: new CheckF64('backcompat.endpos'), plane: new CheckF64('backcompat.plane'), flags: new Check('backcompat.flags') };
  const chkId = new Check('backcompat.hullId');

  // Only hull 0 -- reuse hull0's own box geometry, but note hull1/hull2 remain
  // "installed" from the earlier tests in this same wasm instance; back-compat
  // is about clipToWorld/selectWorldHull's behavior when the CALLER only ever
  // loaded a single hull, which for a truly fresh module instance means
  // hull1Installed/hull2Installed are false. Verify that in a fresh instance.
  const freshBytes = readFileSync(SVMOVE_WASM);
  const { instance } = await WebAssembly.instantiate(freshBytes, {
    env: { abort: (msg, file, line, col) => { throw new Error(`svmove.wasm abort @${line}:${col}`); } },
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
  const y = instance.exports;
  y.initEdicts(MAX_EDICTS, 100);
  y.initAreaTree(WORLD_MINS[0], WORLD_MINS[1], WORLD_MINS[2], WORLD_MAXS[0], WORLD_MAXS[1], WORLD_MAXS[2], MAX_EDICTS);
  for (let i = 0; i <= 5; i++) {
    const p = hull0.planes[i];
    y.setPlane(i, p.normal[0], p.normal[1], p.normal[2], p.dist, p.type);
  }
  for (let i = hull0.firstclipnode; i <= hull0.lastclipnode; i++) {
    const n = hull0.clipnodes[i];
    y.setClipNode(i, n.planenum, n.children[0], n.children[1]);
  }
  y.setWorldHullRange(hull0.firstclipnode, hull0.lastclipnode);

  function jsClipToWorldZeroOffset(hull, start, end) {
    const trace = makeEmptyTrace(end);
    jsRecursiveHullCheck(hull, hull.firstclipnode, 0.0, 1.0, [...start], [...end], trace);
    if (trace.fraction < 1.0 || trace.startsolid === true) trace.ent = 0;
    return trace;
  }

  const r = rng(0xBACC0117);
  for (let iter = 0; iter < 5000; iter++) {
    // Sizes deliberately span into what WOULD be hull 1/2 territory -- back-compat
    // requires hull 0 + zero offset regardless.
    const hx = Math.abs(r.f32(60));
    const mins = [-hx, -hx, -hx], maxs = [hx, hx, hx];
    const sx = r.f32(80), sy = r.f32(80), sz = r.f32(80);
    const ex = r.f32(80), ey = r.f32(80), ez = r.f32(80);

    const wHullId = y.selectWorldHull(mins[0], mins[1], mins[2], maxs[0], maxs[1], maxs[2]);
    y.move(sx, sy, sz, mins[0], mins[1], mins[2], maxs[0], maxs[1], maxs[2], ex, ey, ez, 0, -1);
    const w = {
      fraction: y.moveTraceFraction(),
      endpos: [y.moveTraceEndX(), y.moveTraceEndY(), y.moveTraceEndZ()],
      plane: { normal: [y.moveTracePlaneNX(), y.moveTracePlaneNY(), y.moveTracePlaneNZ()], dist: y.moveTracePlaneDist() },
      allsolid: y.moveTraceAllSolid() !== 0,
      startsolid: y.moveTraceStartSolid() !== 0,
      inopen: y.moveTraceInOpen() !== 0,
      inwater: y.moveTraceInWater() !== 0,
      ent: y.moveTraceEnt() === -1 ? null : y.moveTraceEnt(),
    };
    chkId.intEq(wHullId, 0, `backcompat#${iter}`);
    const j = jsClipToWorldZeroOffset(hull0, [sx, sy, sz], [ex, ey, ez]);
    checkTrace(chk, w, j, `backcompat#${iter}`);
  }
  results.push(chkId.report(), chk.frac.report(), chk.end.report(), chk.plane.report(), chk.flags.report());
}

const ok = results.every(Boolean);
process.exit(ok ? 0 : 1);
