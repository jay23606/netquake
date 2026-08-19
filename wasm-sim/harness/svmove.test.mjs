// Golden parity test: svmove.ts (areanode tree / linkEdict / unlinkEdict / SV_Move
// / SV_ClipToLinks / SV_ClipMoveToEntity / SV_HullForEntity box path) vs a JS
// reference transliterated inline from src/engine/sv.ts, exactly matching the
// world.test.mjs / ed.test.mjs pattern.
//
// Scope tested (see svmove.ts's header comment for the full scope rationale):
//   - Areanode tree + intrusive solid_edicts/trigger_edicts link lists.
//   - linkEdict/unlinkEdict classification + insertion (no PVS, no touch dispatch).
//   - SV_Move / SV_ClipToLinks against SOLID_BBOX/SOLID_SLIDEBOX (box) entities,
//     with the world-hull clip step traced directly via a pre-loaded hull (no
//     hull-selection-by-box-size table -- see svmove.ts header).
//
// svmove.ts compiles standalone (not part of index.ts/sim.wasm) and pulls in
// ed.ts + world.ts via `export * from`, so this test loads build/svmove.wasm
// directly and gets every function from all three modules on one exports object.
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

// --- entvars field indices (src/engine/pr.ts entvars, vanilla layout) ---------
const F = {
  ABSMIN: 1, ABSMIN1: 2, ABSMIN2: 3, ABSMAX: 4, ABSMAX1: 5, ABSMAX2: 6,
  SOLID: 9, ORIGIN: 10, ORIGIN1: 11, ORIGIN2: 12, SKIN: 31,
  MINS: 33, MINS1: 34, MINS2: 35, MAXS: 36, MAXS1: 37, MAXS2: 38,
  SIZE: 39, FLAGS: 76, OWNER: 95,
};
const EDICT_SIZE_WORDS = 100; // >= 96 to cover F.OWNER

const SOLID_NOT = 0, SOLID_TRIGGER = 1, SOLID_BBOX = 2, SOLID_SLIDEBOX = 3, SOLID_BSP = 4;
const FL_MONSTER = 32, FL_ITEM = 256;
const MOVE_NORMAL = 0, MOVE_NOMONSTERS = 1, MOVE_MISSILE = 2;
const CONTENTS_EMPTY = -1, CONTENTS_SOLID = -2;

// Float32Array-backed field storage (same trick as ed.test.mjs's JsEdictStore):
// gives automatic f32 quantization identical to ed.ts's edStoreFloat, so f64
// arithmetic starting from these fields matches the wasm side bit-for-bit.
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
  }
  f(e, idx) { return this.vf[e][idx]; }
  setf(e, idx, v) { this.vf[e][idx] = v; }
  i(e, idx) { return this.vi[e][idx]; }
  seti(e, idx, v) { this.vi[e][idx] = v; }
}

// --- recursiveHullCheck / hullPointContents (transliterated from world.test.mjs,
// duplicated here per project convention: each golden test is self-contained) ---
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
function jsCopyTrace(src, dst) {
  dst.fraction = src.fraction; dst.allsolid = src.allsolid; dst.startsolid = src.startsolid;
  dst.inopen = src.inopen; dst.inwater = src.inwater; dst.ent = src.ent;
  dst.endpos = [...src.endpos];
  dst.plane = { normal: [...src.plane.normal], dist: src.plane.dist };
}

// --- box hull (sv.ts initBoxHull + hullForEntity's box branch) ------------------
function makeEntityBoxHull(entMinsX, entMinsY, entMinsZ, entMaxsX, entMaxsY, entMaxsZ, sweepMins, sweepMaxs) {
  const dist = [entMaxsX - sweepMins[0], entMinsX - sweepMaxs[0], entMaxsY - sweepMins[1], entMinsY - sweepMaxs[1], entMaxsZ - sweepMins[2], entMinsZ - sweepMaxs[2]];
  const clipnodes = [], planes = [];
  for (let i = 0; i <= 5; i++) {
    const node = { planenum: i, children: [0, 0] };
    node.children[i & 1] = CONTENTS_EMPTY;
    node.children[1 - (i & 1)] = (i !== 5) ? i + 1 : CONTENTS_SOLID;
    clipnodes[i] = node;
    const normal = [0.0, 0.0, 0.0];
    normal[i >> 1] = 1.0;
    planes[i] = { type: i >> 1, normal, dist: dist[i] };
  }
  return { clipnodes, planes, firstclipnode: 0, lastclipnode: 5 };
}

function jsHullForEntityBox(edicts, entNum, sweepMins, sweepMaxs) {
  const solid = edicts.f(entNum, F.SOLID) | 0;
  if (solid === SOLID_BSP) throw new Error('SOLID_BSP hull table not modeled in JS reference either');
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
  // Offset re-added UNCONDITIONALLY -- endpos is always adjusted-space (sv.ts/sim parity).
  trace.endpos[0] += offset[0]; trace.endpos[1] += offset[1]; trace.endpos[2] += offset[2];
  if (trace.fraction < 1.0 || trace.startsolid === true) trace.ent = entNum;
  return trace;
}

function jsClipToWorld(hullWorld, start, end) {
  const trace = makeEmptyTrace(end);
  jsRecursiveHullCheck(hullWorld, hullWorld.firstclipnode, 0.0, 1.0, [...start], [...end], trace);
  if (trace.fraction < 1.0 || trace.startsolid === true) trace.ent = 0; // the world edict
  return trace;
}

// --- areanode tree (sv.ts createAreaNode) + link lists --------------------------
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

  // QSS-M SV_LinkEdict order: VectorAdd stores into the f32 fields FIRST, then the
  // expansion adjusts the stored values in place — each axis gets TWO f32 roundings
  // (matches the sim and live sv.ts refreshLeafs; single-rounded math drifts one ulp).
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
    const amin = edicts.f(entNum, F.ABSMIN + node.axis);
    const amax = edicts.f(entNum, F.ABSMAX + node.axis);
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
  for (let l = node.solid_edicts.next; l !== node.solid_edicts; ) {
    const next = l.next;
    const touch = l.ent;

    const solid = edicts.f(touch, F.SOLID) | 0;
    if (solid === SOLID_NOT || touch === clip.passedict) { l = next; continue; }
    if (solid === SOLID_TRIGGER) throw new Error('Trigger in clipping list');
    if (solid === SOLID_BSP) {
      const skin = edicts.f(touch, F.SKIN) | 0;
      if (skin < 0) { l = next; continue; }
    }
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

// ================================================================================
// Fixtures + wasm wiring
// ================================================================================

// A single-node axial box "world" hull sized generously around the test volume --
// consistent hull for the whole scenario (see svmove.ts header re: hull-selection
// simplification). Reused from the world.test.mjs box-hull pattern.
function makeBoxHull(lo, hi) {
  const dist = [hi[0], lo[0], hi[1], lo[1], hi[2], lo[2]];
  const clipnodes = [], planes = [];
  for (let i = 0; i <= 5; i++) {
    const node = { planenum: i, children: [0, 0] };
    node.children[i & 1] = CONTENTS_EMPTY;
    node.children[1 - (i & 1)] = (i !== 5) ? i + 1 : CONTENTS_SOLID;
    clipnodes[i] = node;
    const normal = [0.0, 0.0, 0.0];
    normal[i >> 1] = 1.0;
    planes[i] = { type: i >> 1, normal, dist: dist[i] };
  }
  return { clipnodes, planes, firstclipnode: 0, lastclipnode: 5 };
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
const MAX_EDICTS = 200;

// === Test 1: link/unlink structural parity -- random link/unlink/relink churn,
// verify every solid/trigger list (walked via the wasm sentinel-id scheme vs the
// JS Link objects) contains exactly the same entity set after each op. ===========
{
  const r = rng(0xA5EA);
  x.initEdicts(MAX_EDICTS, EDICT_SIZE_WORDS);
  x.initAreaTree(WORLD_MINS[0], WORLD_MINS[1], WORLD_MINS[2], WORLD_MAXS[0], WORLD_MAXS[1], WORLD_MAXS[2], MAX_EDICTS);
  const edicts = new JsEdicts(MAX_EDICTS);
  const links = []; for (let i = 0; i < MAX_EDICTS; i++) links.push({ prev: null, next: null, ent: null });
  const nodes = [];
  const root = createAreaNode(nodes, 0, WORLD_MINS, WORLD_MAXS);

  const chk = new Check('link.membership');

  // List-walk membership/order is exhaustively exercised indirectly by Test 2/3
  // (move()'s clipToLinks walks solid_edicts on every call, over thousands of
  // link/unlink/relink states); this test isolates linkEdict's own arithmetic
  // (absmin/absmax + classification) by checking it directly after every op.
  function setEntity(e) {
    const ox = r.f32(900), oy = r.f32(900), oz = r.f32(900);
    const hx = Math.abs(r.f32(60)) + 2, hy = Math.abs(r.f32(60)) + 2, hz = Math.abs(r.f32(60)) + 2;
    const solidRoll = r.int(10);
    const solid = solidRoll === 0 ? SOLID_NOT : (solidRoll < 5 ? SOLID_BBOX : SOLID_SLIDEBOX);
    const flags = r.int(8) === 0 ? FL_ITEM : 0;
    edicts.setf(e, F.ORIGIN, ox); edicts.setf(e, F.ORIGIN1, oy); edicts.setf(e, F.ORIGIN2, oz);
    edicts.setf(e, F.MINS, -hx); edicts.setf(e, F.MINS1, -hy); edicts.setf(e, F.MINS2, -hz);
    edicts.setf(e, F.MAXS, hx); edicts.setf(e, F.MAXS1, hy); edicts.setf(e, F.MAXS2, hz);
    edicts.setf(e, F.SOLID, solid); edicts.setf(e, F.FLAGS, flags); edicts.setf(e, F.SKIN, 0); edicts.setf(e, F.SIZE, hx * 2);
    edicts.seti(e, F.OWNER, 0);
    x.edStoreFloat(e, F.ORIGIN, ox); x.edStoreFloat(e, F.ORIGIN1, oy); x.edStoreFloat(e, F.ORIGIN2, oz);
    x.edStoreFloat(e, F.MINS, -hx); x.edStoreFloat(e, F.MINS1, -hy); x.edStoreFloat(e, F.MINS2, -hz);
    x.edStoreFloat(e, F.MAXS, hx); x.edStoreFloat(e, F.MAXS1, hy); x.edStoreFloat(e, F.MAXS2, hz);
    x.edStoreFloat(e, F.SOLID, solid); x.edStoreFloat(e, F.FLAGS, flags); x.edStoreFloat(e, F.SKIN, 0); x.edStoreFloat(e, F.SIZE, hx * 2);
    x.edStoreInt(e, F.OWNER, 0);
  }

  // link/unlink/relink a population of entities repeatedly, then verify absmin/
  // absmax bit-exact after every linkEdict (this exercises linkEdict's arithmetic
  // directly, independent of the list-walk which Test 2/3 cover via move()).
  for (let e = 1; e < 60; e++) setEntity(e);
  for (let trial = 0; trial < 2000; trial++) {
    const e = 1 + r.int(59);
    const op = r.int(3);
    if (op === 0) {
      setEntity(e);
      x.linkEdict(e);
      jsLinkEdict(edicts, links, root, e);
    } else if (op === 1) {
      x.unlinkEdict(e);
      jsUnlinkEdict(links, e);
    } else {
      x.linkEdict(e);
      jsLinkEdict(edicts, links, root, e);
    }
    for (const f of [F.ABSMIN, F.ABSMIN1, F.ABSMIN2, F.ABSMAX, F.ABSMAX1, F.ABSMAX2]) {
      chk.floatEq(x.edLoadFloat(e, f), edicts.f(e, f), `abs#${trial} e=${e} f=${f}`);
    }
  }
  results.push(chk.report());
}

// === Test 2: SV_Move against box entities -- thousands of random sweeps through
// a population of linked SOLID_BBOX/SOLID_SLIDEBOX entities, some SOLID_NOT
// (must be skipped), varied moveType/passedict/monster-flag. ====================
{
  const r = rng(0xB0B5EED);
  x.initEdicts(MAX_EDICTS, EDICT_SIZE_WORDS);
  x.initAreaTree(WORLD_MINS[0], WORLD_MINS[1], WORLD_MINS[2], WORLD_MAXS[0], WORLD_MAXS[1], WORLD_MAXS[2], MAX_EDICTS);
  const edicts = new JsEdicts(MAX_EDICTS);
  const links = []; for (let i = 0; i < MAX_EDICTS; i++) links.push({ prev: null, next: null, ent: null });
  const nodes = [];
  const root = createAreaNode(nodes, 0, WORLD_MINS, WORLD_MAXS);

  // World hull: a single generous box (sweeps stay inside it; the JS reference's
  // own recursiveHullCheck exercises the exact same trace math as world.ts,
  // already separately parity-tested in world.test.mjs -- this test's focus is
  // the link/clipToLinks/move layer built on top).
  const worldHull = makeBoxHull([-4096, -4096, -4096], [4096, 4096, 4096]);
  loadWorldHullToWasm(worldHull);

  const NUM_ENTS = 80;
  for (let e = 1; e <= NUM_ENTS; e++) {
    const ox = r.f32(500), oy = r.f32(500), oz = r.f32(500);
    const hx = Math.abs(r.f32(40)) + 3, hy = Math.abs(r.f32(40)) + 3, hz = Math.abs(r.f32(40)) + 3;
    const solidRoll = r.int(10);
    const solid = solidRoll === 0 ? SOLID_NOT : (solidRoll < 6 ? SOLID_BBOX : SOLID_SLIDEBOX);
    const flags = r.int(6) === 0 ? FL_MONSTER : (r.int(8) === 0 ? FL_ITEM : 0);
    const owner = r.int(4) === 0 ? (1 + r.int(NUM_ENTS)) : 0;

    edicts.setf(e, F.ORIGIN, ox); edicts.setf(e, F.ORIGIN1, oy); edicts.setf(e, F.ORIGIN2, oz);
    edicts.setf(e, F.MINS, -hx); edicts.setf(e, F.MINS1, -hy); edicts.setf(e, F.MINS2, -hz);
    edicts.setf(e, F.MAXS, hx); edicts.setf(e, F.MAXS1, hy); edicts.setf(e, F.MAXS2, hz);
    edicts.setf(e, F.SOLID, solid); edicts.setf(e, F.FLAGS, flags); edicts.setf(e, F.SKIN, 0); edicts.setf(e, F.SIZE, hx * 2);
    edicts.seti(e, F.OWNER, owner);

    x.edStoreFloat(e, F.ORIGIN, ox); x.edStoreFloat(e, F.ORIGIN1, oy); x.edStoreFloat(e, F.ORIGIN2, oz);
    x.edStoreFloat(e, F.MINS, -hx); x.edStoreFloat(e, F.MINS1, -hy); x.edStoreFloat(e, F.MINS2, -hz);
    x.edStoreFloat(e, F.MAXS, hx); x.edStoreFloat(e, F.MAXS1, hy); x.edStoreFloat(e, F.MAXS2, hz);
    x.edStoreFloat(e, F.SOLID, solid); x.edStoreFloat(e, F.FLAGS, flags); x.edStoreFloat(e, F.SKIN, 0); x.edStoreFloat(e, F.SIZE, hx * 2);
    x.edStoreInt(e, F.OWNER, owner);

    x.linkEdict(e);
    jsLinkEdict(edicts, links, root, e);
  }

  const chk = { frac: new CheckF64('move.fraction'), end: new CheckF64('move.endpos'), plane: new CheckF64('move.plane'), flags: new Check('move.flags') };

  for (let iter = 0; iter < 20000; iter++) {
    const sx = r.f32(600), sy = r.f32(600), sz = r.f32(600);
    const ex = r.f32(600), ey = r.f32(600), ez = r.f32(600);
    const hx = Math.abs(r.f32(30)) + 1, hy = Math.abs(r.f32(30)) + 1, hz = Math.abs(r.f32(30)) + 1;
    const mins = [-hx, -hy, -hz], maxs = [hx, hy, hz];
    const typeRoll = r.int(10);
    const type = typeRoll === 0 ? MOVE_MISSILE : (typeRoll === 1 ? MOVE_NOMONSTERS : MOVE_NORMAL);
    const passRoll = r.int(4);
    const passedict = passRoll === 0 ? null : (1 + r.int(NUM_ENTS));

    x.move(sx, sy, sz, mins[0], mins[1], mins[2], maxs[0], maxs[1], maxs[2], ex, ey, ez, type, passedict === null ? -1 : passedict);
    const w = readMoveTrace();
    const j = jsMove(edicts, root, worldHull, [sx, sy, sz], mins, maxs, [ex, ey, ez], type, passedict);
    checkTrace(chk, w, j, `move#${iter}`);
  }
  results.push(chk.frac.report(), chk.end.report(), chk.plane.report(), chk.flags.report());

  // world.pointContents() must remain usable against the world hull after move()
  // calls repoint world.ts's hull range at the box-hull region mid-call (see
  // svmove.ts header note on move()'s restore-at-end behaviour).
  const chkPC = new Check('move.pointContents-restore');
  for (let iter = 0; iter < 500; iter++) {
    const px = r.f32(4000), py = r.f32(4000), pz = r.f32(4000);
    chkPC.intEq(x.pointContents(px, py, pz), jsHullPointContents(worldHull, 0, [px, py, pz]), `pc#${iter}`);
  }
  results.push(chkPC.report());
}

// === Test 3: dense cluster -- many overlapping small entities packed into a
// tight volume (forces deep areanode traversal + many candidate comparisons per
// move, stressing the fraction-comparison / copyCandToOut bookkeeping and the
// "starts inside a solid entity" / grazing-contact paths). ======================
{
  const r = rng(0xC1057E5);
  x.initEdicts(MAX_EDICTS, EDICT_SIZE_WORDS);
  x.initAreaTree(WORLD_MINS[0], WORLD_MINS[1], WORLD_MINS[2], WORLD_MAXS[0], WORLD_MAXS[1], WORLD_MAXS[2], MAX_EDICTS);
  const edicts = new JsEdicts(MAX_EDICTS);
  const links = []; for (let i = 0; i < MAX_EDICTS; i++) links.push({ prev: null, next: null, ent: null });
  const nodes = [];
  const root = createAreaNode(nodes, 0, WORLD_MINS, WORLD_MAXS);

  const worldHull = makeBoxHull([-1024, -1024, -1024], [1024, 1024, 1024]);
  loadWorldHullToWasm(worldHull);

  const NUM_ENTS = 120;
  const CLUSTER = 80; // half-extent of the packing volume
  for (let e = 1; e <= NUM_ENTS; e++) {
    const ox = r.f32(CLUSTER), oy = r.f32(CLUSTER), oz = r.f32(CLUSTER);
    const hx = Math.abs(r.f32(12)) + 2, hy = Math.abs(r.f32(12)) + 2, hz = Math.abs(r.f32(12)) + 2;
    const solid = r.int(9) === 0 ? SOLID_NOT : (r.int(2) === 0 ? SOLID_BBOX : SOLID_SLIDEBOX);
    const flags = r.int(5) === 0 ? FL_MONSTER : 0;

    edicts.setf(e, F.ORIGIN, ox); edicts.setf(e, F.ORIGIN1, oy); edicts.setf(e, F.ORIGIN2, oz);
    edicts.setf(e, F.MINS, -hx); edicts.setf(e, F.MINS1, -hy); edicts.setf(e, F.MINS2, -hz);
    edicts.setf(e, F.MAXS, hx); edicts.setf(e, F.MAXS1, hy); edicts.setf(e, F.MAXS2, hz);
    edicts.setf(e, F.SOLID, solid); edicts.setf(e, F.FLAGS, flags); edicts.setf(e, F.SKIN, 0); edicts.setf(e, F.SIZE, hx * 2);
    edicts.seti(e, F.OWNER, 0);

    x.edStoreFloat(e, F.ORIGIN, ox); x.edStoreFloat(e, F.ORIGIN1, oy); x.edStoreFloat(e, F.ORIGIN2, oz);
    x.edStoreFloat(e, F.MINS, -hx); x.edStoreFloat(e, F.MINS1, -hy); x.edStoreFloat(e, F.MINS2, -hz);
    x.edStoreFloat(e, F.MAXS, hx); x.edStoreFloat(e, F.MAXS1, hy); x.edStoreFloat(e, F.MAXS2, hz);
    x.edStoreFloat(e, F.SOLID, solid); x.edStoreFloat(e, F.FLAGS, flags); x.edStoreFloat(e, F.SKIN, 0); x.edStoreFloat(e, F.SIZE, hx * 2);
    x.edStoreInt(e, F.OWNER, 0);

    x.linkEdict(e);
    jsLinkEdict(edicts, links, root, e);
  }

  const chk = { frac: new CheckF64('cluster.fraction'), end: new CheckF64('cluster.endpos'), plane: new CheckF64('cluster.plane'), flags: new Check('cluster.flags') };
  for (let iter = 0; iter < 20000; iter++) {
    let sx, sy, sz, ex, ey, ez;
    if (r.int(3) === 0) {
      // guaranteed start-inside-a-solid-entity case
      const e = 1 + r.int(NUM_ENTS);
      sx = edicts.f(e, F.ORIGIN) + r.f32(3); sy = edicts.f(e, F.ORIGIN1) + r.f32(3); sz = edicts.f(e, F.ORIGIN2) + r.f32(3);
    } else {
      sx = r.f32(CLUSTER * 1.5); sy = r.f32(CLUSTER * 1.5); sz = r.f32(CLUSTER * 1.5);
    }
    ex = r.f32(CLUSTER * 1.5); ey = r.f32(CLUSTER * 1.5); ez = r.f32(CLUSTER * 1.5);
    const hx = Math.abs(r.f32(6)) + 1, hy = Math.abs(r.f32(6)) + 1, hz = Math.abs(r.f32(6)) + 1;
    const mins = [-hx, -hy, -hz], maxs = [hx, hy, hz];
    const type = MOVE_NORMAL;
    const passedict = r.int(3) === 0 ? (1 + r.int(NUM_ENTS)) : null;

    x.move(sx, sy, sz, mins[0], mins[1], mins[2], maxs[0], maxs[1], maxs[2], ex, ey, ez, type, passedict === null ? -1 : passedict);
    const w = readMoveTrace();
    const j = jsMove(edicts, root, worldHull, [sx, sy, sz], mins, maxs, [ex, ey, ez], type, passedict);
    checkTrace(chk, w, j, `cluster#${iter}`);
  }
  results.push(chk.frac.report(), chk.end.report(), chk.plane.report(), chk.flags.report());
}

const ok = results.every(Boolean);
process.exit(ok ? 0 : 1);
