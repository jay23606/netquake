// Golden parity test: world.ts's per-model hull table (installModelHull/
// selectModelHull) + svmove.ts's now-filled-in SOLID_BSP branch of hullForEntity
// (previously `unreachable()`), vs a JS reference transliterating BOTH branches
// of src/engine/sv.ts's hullForEntity, exactly matching the world.test.mjs /
// svmove.test.mjs / worldhulls.test.mjs pattern.
//
// Scope:
//   - Test 1: selectModelHull's hull-id-by-size selection + clip_mins lookup,
//     isolated from entity/link mechanics, across several independently
//     installed synthetic bmodels (proves the table indexes correctly and
//     doesn't cross-contaminate between models or with world.ts's own separate
//     hull-0/1/2 storage).
//   - Test 2: full SV_Move/SV_ClipToLinks integration with SOLID_BSP touch
//     entities (doors/plats/trains in real play) referencing those bmodels via
//     modelindex -- exactly the previously-trapping path (`unreachable()` in
//     loadHullForEntity's old body). Mixes box (SOLID_BBOX/SLIDEBOX) and
//     SOLID_BSP touch entities in the same area tree, as a real map does.
//   - Test 3 (back-compat): (a) box-entity path (SOLID_BBOX/SLIDEBOX) is
//     untouched by the model-table addition; (b) world.pointContents() remains
//     usable against the world hull after a move() call whose clipToLinks
//     walk touched SOLID_BSP entities (selectModelHull repoints world.ts's
//     shared "current hull" indirection exactly like the pre-existing
//     box-hull-per-touched-entity case already did -- move()'s trailing
//     setHullMeta restore covers both identically); (c) a FRESH instance that
//     never calls installModelHull at all still passes the world-hull-only
//     scenario (svmove.test.mjs's own coverage), proving the addition is
//     purely additive storage.
//
// svmove.wasm already carries every world.ts export (svmove.ts does
// `export * from "./world"`) including installModelHull/selectModelHull/
// selectedModelHullClipMins*/selectedModelHullId -- so this test reuses
// build/svmove.wasm exactly like worldhulls.test.mjs does, without any
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
const F = {
  MODELINDEX: 0,
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

// Float32Array-backed field storage (same trick as ed.test.mjs/svmove.test.mjs's
// JsEdicts): gives automatic f32 quantization identical to ed.ts's edStoreFloat.
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

// --- recursiveHullCheck / hullPointContents (transliterated identically to
// world.test.mjs / svmove.test.mjs / worldhulls.test.mjs -- duplicated per
// project convention: each golden test is self-contained) ----------------------
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

// --- synthetic axial box hull, parameterized by clipnode/plane numbering so
// several models' hulls can be placed at disjoint sub-ranges of ONE shared
// clipnodes/planes array -- exactly mirroring mod.ts's hull sharing (a
// submodel's hull 0 shares the WORLD hull-0 clipnode mirror; hull 1/2 share the
// raw BSP `clipnodes` lump; every hull shares `planes`) -- see world.test.mjs /
// worldhulls.test.mjs's identical makeBoxHullAt precedent. --------------------
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

// --- box hull for the plain box-entity path (SOLID_BBOX/SLIDEBOX), same as
// svmove.test.mjs's makeEntityBoxHull -- a fresh 6-plane hull rebuilt per query
// (dists depend on the move's own mins/maxs, so it can't be pre-installed). ----
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

// sv.ts hullForEntity, BOTH branches, transliterated exactly.
function jsSelectHullIdBySize(sweepMins, sweepMaxs) {
  const size = sweepMaxs[0] - sweepMins[0];
  if (size < 3.0) return 0;
  if (size <= 32.0) return 1;
  return 2;
}

function jsHullForEntity(models, edicts, entNum, sweepMins, sweepMaxs) {
  const solid = edicts.f(entNum, F.SOLID) | 0;
  if (solid === SOLID_BSP) {
    const modelIdx = edicts.f(entNum, F.MODELINDEX) >> 0;
    const model = models[modelIdx];
    const hullId = jsSelectHullIdBySize(sweepMins, sweepMaxs);
    const hull = model.hulls[hullId];
    const offset = [
      hull.clip_mins[0] - sweepMins[0] + edicts.f(entNum, F.ORIGIN),
      hull.clip_mins[1] - sweepMins[1] + edicts.f(entNum, F.ORIGIN1),
      hull.clip_mins[2] - sweepMins[2] + edicts.f(entNum, F.ORIGIN2),
    ];
    return { hullId, hull, offset };
  }
  const eMaxsX = edicts.f(entNum, F.MAXS), eMinsX = edicts.f(entNum, F.MINS);
  const eMaxsY = edicts.f(entNum, F.MAXS1), eMinsY = edicts.f(entNum, F.MINS1);
  const eMaxsZ = edicts.f(entNum, F.MAXS2), eMinsZ = edicts.f(entNum, F.MINS2);
  const hull = makeEntityBoxHull(eMinsX, eMinsY, eMinsZ, eMaxsX, eMaxsY, eMaxsZ, sweepMins, sweepMaxs);
  const offset = [edicts.f(entNum, F.ORIGIN), edicts.f(entNum, F.ORIGIN1), edicts.f(entNum, F.ORIGIN2)];
  return { hullId: -1, hull, offset };
}

function jsClipMoveToEntity(models, edicts, entNum, start, mins, maxs, end) {
  const { hull, offset } = jsHullForEntity(models, edicts, entNum, mins, maxs);
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

// --- areanode tree (sv.ts createAreaNode) + link lists (identical to
// svmove.test.mjs) --------------------------------------------------------------
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

function jsClipToLinks(models, edicts, node, clip) {
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
    if ((flags & FL_MONSTER) !== 0) trace = jsClipMoveToEntity(models, edicts, touch, clip.start, clip.mins2, clip.maxs2, clip.end);
    else trace = jsClipMoveToEntity(models, edicts, touch, clip.start, clip.mins, clip.maxs, clip.end);

    if (trace.allsolid === true || trace.startsolid === true || trace.fraction < clip.trace.fraction ||
        (trace.fraction === clip.trace.fraction && trace.ent != null && trace.ent !== 0 && clip.trace.ent != null && clip.trace.ent !== 0 && trace.ent < clip.trace.ent)) { // tie-break: lowest edict num (matches sv.ts/svmove.ts)
      trace.ent = touch;
      jsCopyTrace(trace, clip.trace);
    }

    l = next;
  }

  if (node.axis === -1) return;
  if (clip.boxmaxs[node.axis] > node.dist) jsClipToLinks(models, edicts, node.children[0], clip);
  if (clip.boxmins[node.axis] < node.dist) jsClipToLinks(models, edicts, node.children[1], clip);
}

function jsMove(models, edicts, root, hullWorld, start, mins, maxs, end, type, passedict) {
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
  jsClipToLinks(models, edicts, root, clip);
  return clip.trace;
}

// ================================================================================
// Fixtures
// ================================================================================
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

function loadWorldHullToWasm(x, hull) {
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

// Builds a synthetic bmodel: 3 box-shaped hulls (hull1/hull2 pre-expanded by
// vanilla's real clip_mins/clip_maxs, same "Minkowski sum" construction as
// worldhulls.test.mjs's hull1/hull2 fixtures), placed at CALLER-supplied disjoint
// clipnode/plane index ranges so several models coexist in the SAME shared
// storage without collision (mirrors mod.ts's real cross-model sharing).
const HULL1_MINS = [-16, -16, -24], HULL1_MAXS = [16, 16, 32];
const HULL2_MINS = [-32, -32, -24], HULL2_MAXS = [32, 32, 64];
function makeSyntheticBmodel(lo0, hi0, ranges) {
  // ranges = { h0: {first, planeBase}, h1: {first, planeBase}, h2: {first, planeBase} }
  const hull0 = { ...makeBoxHullAt(lo0, hi0, ranges.h0.first, ranges.h0.planeBase), clip_mins: [0.0, 0.0, 0.0] };
  const lo1 = [lo0[0] + HULL1_MINS[0], lo0[1] + HULL1_MINS[1], lo0[2] + HULL1_MINS[2]];
  const hi1 = [hi0[0] + HULL1_MAXS[0], hi0[1] + HULL1_MAXS[1], hi0[2] + HULL1_MAXS[2]];
  const hull1 = { ...makeBoxHullAt(lo1, hi1, ranges.h1.first, ranges.h1.planeBase), clip_mins: HULL1_MINS };
  const lo2 = [lo0[0] + HULL2_MINS[0], lo0[1] + HULL2_MINS[1], lo0[2] + HULL2_MINS[2]];
  const hi2 = [hi0[0] + HULL2_MAXS[0], hi0[1] + HULL2_MAXS[1], hi0[2] + HULL2_MAXS[2]];
  const hull2 = { ...makeBoxHullAt(lo2, hi2, ranges.h2.first, ranges.h2.planeBase), clip_mins: HULL2_MINS };
  return { hulls: [hull0, hull1, hull2] };
}

// Loads a model's 3 hulls into the SHARED CLIP_*/CLIP12_*/PLANE_* storage (via
// setClipNode for hull 0, setClipNode12 for hull 1/2, setPlane for all planes)
// and registers it in world.ts's per-model table (installModelHull).
function loadModelToWasm(x, modelIdx, model) {
  for (let h = 0; h < 3; h++) {
    const hull = model.hulls[h];
    for (let i = hull.firstclipnode; i <= hull.lastclipnode; i++) {
      const n = hull.clipnodes[i];
      const p = hull.planes[n.planenum];
      x.setPlane(n.planenum, p.normal[0], p.normal[1], p.normal[2], p.dist, p.type);
      if (h === 0) x.setClipNode(i, n.planenum, n.children[0], n.children[1]);
      else x.setClipNode12(i, n.planenum, n.children[0], n.children[1]);
    }
    x.installModelHull(modelIdx, h, hull.firstclipnode, hull.lastclipnode, hull.clip_mins[0], hull.clip_mins[1], hull.clip_mins[2]);
  }
}

function readMoveTrace(x) {
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

// Three synthetic bmodels at arbitrary (non-contiguous) model indices, each at
// disjoint clipnode/plane ranges within the shared pools -- proves the table
// indexes independently and doesn't require dense/contiguous modelIdx.
const MODEL_IDX_A = 5, MODEL_IDX_B = 7, MODEL_IDX_C = 12;
const modelA = makeSyntheticBmodel([-40, -40, -20], [40, 40, 20], {
  h0: { first: 0, planeBase: 0 }, h1: { first: 0, planeBase: 100 }, h2: { first: 18, planeBase: 200 },
});
const modelB = makeSyntheticBmodel([-64, -20, -64], [64, 20, 64], {
  h0: { first: 6, planeBase: 6 }, h1: { first: 6, planeBase: 106 }, h2: { first: 24, planeBase: 206 },
});
const modelC = makeSyntheticBmodel([-100, -100, -8], [100, 100, 8], {
  h0: { first: 12, planeBase: 12 }, h1: { first: 12, planeBase: 112 }, h2: { first: 30, planeBase: 212 },
});
const models = {}; models[MODEL_IDX_A] = modelA; models[MODEL_IDX_B] = modelB; models[MODEL_IDX_C] = modelC;

// === Test 1: selectModelHull hull-id-by-size + clip_mins lookup, isolated from
// entity/link mechanics. Direct calls to world.selectModelHull/selectedModelHull
// ClipMins*, checked against jsSelectHullIdBySize + the model's own clip_mins,
// across the full size spectrum (including the 3.0/32.0 boundary) for all 3
// models. =========================================================================
{
  const x = await loadSvmoveWasm();
  x.initEdicts(MAX_EDICTS, EDICT_SIZE_WORDS);
  x.initAreaTree(WORLD_MINS[0], WORLD_MINS[1], WORLD_MINS[2], WORLD_MAXS[0], WORLD_MAXS[1], WORLD_MAXS[2], MAX_EDICTS);
  loadModelToWasm(x, MODEL_IDX_A, modelA);
  loadModelToWasm(x, MODEL_IDX_B, modelB);
  loadModelToWasm(x, MODEL_IDX_C, modelC);

  const chkId = new Check('selectModelHull.hullId');
  const chkCM = new CheckF64('selectModelHull.clipMins');
  const r = rng(0xB0DE1);
  const modelIdxs = [MODEL_IDX_A, MODEL_IDX_B, MODEL_IDX_C];
  const modelsByIdx = { [MODEL_IDX_A]: modelA, [MODEL_IDX_B]: modelB, [MODEL_IDX_C]: modelC };
  const sizes = [0, 0.5, 1, 2, 2.999999, 3, 3.000001, 10, 20, 31.999998, 32, 32.000002, 33, 50, 90];

  for (const modelIdx of modelIdxs) {
    for (const size of sizes) {
      const hx = size / 2;
      const mins = [-hx, -1, -1], maxs = [hx, 1, 1];
      const wHullId = x.selectModelHull(modelIdx, mins[0], mins[1], mins[2], maxs[0], maxs[1], maxs[2]);
      const jHullId = jsSelectHullIdBySize(mins, maxs);
      chkId.intEq(wHullId, jHullId, `model=${modelIdx} boundary size=${size}`);
      const jClipMins = modelsByIdx[modelIdx].hulls[jHullId].clip_mins;
      chkCM.eq(x.selectedModelHullClipMinsX(), jClipMins[0], `model=${modelIdx} size=${size} cmx`);
      chkCM.eq(x.selectedModelHullClipMinsY(), jClipMins[1], `model=${modelIdx} size=${size} cmy`);
      chkCM.eq(x.selectedModelHullClipMinsZ(), jClipMins[2], `model=${modelIdx} size=${size} cmz`);
    }
    for (let i = 0; i < 2000; i++) {
      const hx = Math.abs(r.f32(48));
      const mins = [-hx, -hx * 0.7, -hx * 0.5], maxs = [hx, hx * 0.7, hx * 0.5];
      const wHullId = x.selectModelHull(modelIdx, mins[0], mins[1], mins[2], maxs[0], maxs[1], maxs[2]);
      const jHullId = jsSelectHullIdBySize(mins, maxs);
      chkId.intEq(wHullId, jHullId, `model=${modelIdx} rand hx=${hx}`);
    }
  }
  results.push(chkId.report(), chkCM.report());
}

// === Test 2: full SV_Move/SV_ClipToLinks integration -- a population of linked
// entities mixing SOLID_BBOX/SLIDEBOX (box hull, unchanged path) and SOLID_BSP
// (the newly-filled per-model-hull path) referencing the 3 synthetic bmodels by
// modelindex, swept by thousands of random moving boxes of varying size (so all
// 3 hull ids get exercised on the SOLID_BSP entities too). =======================
{
  const x = await loadSvmoveWasm();
  const r = rng(0xB0DE1E5);
  x.initEdicts(MAX_EDICTS, EDICT_SIZE_WORDS);
  x.initAreaTree(WORLD_MINS[0], WORLD_MINS[1], WORLD_MINS[2], WORLD_MAXS[0], WORLD_MAXS[1], WORLD_MAXS[2], MAX_EDICTS);
  loadModelToWasm(x, MODEL_IDX_A, modelA);
  loadModelToWasm(x, MODEL_IDX_B, modelB);
  loadModelToWasm(x, MODEL_IDX_C, modelC);

  const edicts = new JsEdicts(MAX_EDICTS);
  const links = []; for (let i = 0; i < MAX_EDICTS; i++) links.push({ prev: null, next: null, ent: null });
  const nodes = [];
  const root = createAreaNode(nodes, 0, WORLD_MINS, WORLD_MAXS);

  const worldHull = makeBoxHull([-4096, -4096, -4096], [4096, 4096, 4096]);
  loadWorldHullToWasm(x, worldHull);

  function setCommon(e, ox, oy, oz, solid, flags, skin, owner) {
    edicts.setf(e, F.ORIGIN, ox); edicts.setf(e, F.ORIGIN1, oy); edicts.setf(e, F.ORIGIN2, oz);
    edicts.setf(e, F.SOLID, solid); edicts.setf(e, F.FLAGS, flags); edicts.setf(e, F.SKIN, skin);
    edicts.seti(e, F.OWNER, owner);
    x.edStoreFloat(e, F.ORIGIN, ox); x.edStoreFloat(e, F.ORIGIN1, oy); x.edStoreFloat(e, F.ORIGIN2, oz);
    x.edStoreFloat(e, F.SOLID, solid); x.edStoreFloat(e, F.FLAGS, flags); x.edStoreFloat(e, F.SKIN, skin);
    x.edStoreInt(e, F.OWNER, owner);
  }

  const NUM_ENTS = 90;
  const modelIdxs = [MODEL_IDX_A, MODEL_IDX_B, MODEL_IDX_C];
  for (let e = 1; e <= NUM_ENTS; e++) {
    const ox = r.f32(500), oy = r.f32(500), oz = r.f32(500);
    const kindRoll = r.int(10);
    const flags = r.int(6) === 0 ? FL_MONSTER : (r.int(8) === 0 ? FL_ITEM : 0);
    const owner = r.int(4) === 0 ? (1 + r.int(NUM_ENTS)) : 0;

    if (kindRoll < 4) {
      // SOLID_BSP mover referencing one of the 3 synthetic bmodels.
      const modelIdx = modelIdxs[r.int(3)];
      setCommon(e, ox, oy, oz, SOLID_BSP, flags, 0, owner);
      edicts.setf(e, F.MODELINDEX, modelIdx);
      x.edStoreFloat(e, F.MODELINDEX, modelIdx);
      // mins/maxs/size are not read on the SOLID_BSP path (hullForEntity uses
      // the model's own hull, not ent.mins/maxs) but linkEdict/clipToLinks'
      // absmin/absmax + candidate-box-overlap filter still read them, so give
      // every entity SOME shape (matches setmodel's real min/max assignment).
      const hx = 40, hy = 40, hz = 24;
      edicts.setf(e, F.MINS, -hx); edicts.setf(e, F.MINS1, -hy); edicts.setf(e, F.MINS2, -hz);
      edicts.setf(e, F.MAXS, hx); edicts.setf(e, F.MAXS1, hy); edicts.setf(e, F.MAXS2, hz);
      edicts.setf(e, F.SIZE, hx * 2);
      x.edStoreFloat(e, F.MINS, -hx); x.edStoreFloat(e, F.MINS1, -hy); x.edStoreFloat(e, F.MINS2, -hz);
      x.edStoreFloat(e, F.MAXS, hx); x.edStoreFloat(e, F.MAXS1, hy); x.edStoreFloat(e, F.MAXS2, hz);
      x.edStoreFloat(e, F.SIZE, hx * 2);
    } else if (kindRoll === 4) {
      setCommon(e, ox, oy, oz, SOLID_NOT, flags, 0, owner);
      edicts.setf(e, F.MINS, 0); edicts.setf(e, F.MAXS, 0);
      x.edStoreFloat(e, F.MINS, 0); x.edStoreFloat(e, F.MAXS, 0);
    } else {
      const solid = kindRoll < 8 ? SOLID_BBOX : SOLID_SLIDEBOX;
      setCommon(e, ox, oy, oz, solid, flags, 0, owner);
      const hx = Math.abs(r.f32(40)) + 3, hy = Math.abs(r.f32(40)) + 3, hz = Math.abs(r.f32(40)) + 3;
      edicts.setf(e, F.MINS, -hx); edicts.setf(e, F.MINS1, -hy); edicts.setf(e, F.MINS2, -hz);
      edicts.setf(e, F.MAXS, hx); edicts.setf(e, F.MAXS1, hy); edicts.setf(e, F.MAXS2, hz);
      edicts.setf(e, F.SIZE, hx * 2);
      x.edStoreFloat(e, F.MINS, -hx); x.edStoreFloat(e, F.MINS1, -hy); x.edStoreFloat(e, F.MINS2, -hz);
      x.edStoreFloat(e, F.MAXS, hx); x.edStoreFloat(e, F.MAXS1, hy); x.edStoreFloat(e, F.MAXS2, hz);
      x.edStoreFloat(e, F.SIZE, hx * 2);
    }

    x.linkEdict(e);
    jsLinkEdict(edicts, links, root, e);
  }

  const chk = { frac: new CheckF64('bmodel.move.fraction'), end: new CheckF64('bmodel.move.endpos'), plane: new CheckF64('bmodel.move.plane'), flags: new Check('bmodel.move.flags') };

  for (let iter = 0; iter < 20000; iter++) {
    const sx = r.f32(600), sy = r.f32(600), sz = r.f32(600);
    const ex = r.f32(600), ey = r.f32(600), ez = r.f32(600);
    // Bucket the sweep-box size to force coverage of all 3 hulls on SOLID_BSP
    // touch entities (hull 0 <3, hull 1 <=32, hull 2 >32), plus fully random.
    const bucket = r.int(4);
    let hx;
    if (bucket === 0) hx = Math.abs(r.f32(1.4));
    else if (bucket === 1) hx = 1.5 + Math.abs(r.f32(14.5));
    else if (bucket === 2) hx = 16 + Math.abs(r.f32(30));
    else hx = Math.abs(r.f32(40)) + 1;
    const mins = [-hx, -hx, -hx], maxs = [hx, hx, hx];
    const typeRoll = r.int(10);
    const type = typeRoll === 0 ? MOVE_MISSILE : (typeRoll === 1 ? MOVE_NOMONSTERS : MOVE_NORMAL);
    const passRoll = r.int(4);
    const passedict = passRoll === 0 ? null : (1 + r.int(NUM_ENTS));

    x.move(sx, sy, sz, mins[0], mins[1], mins[2], maxs[0], maxs[1], maxs[2], ex, ey, ez, type, passedict === null ? -1 : passedict);
    const w = readMoveTrace(x);
    const j = jsMove(models, edicts, root, worldHull, [sx, sy, sz], mins, maxs, [ex, ey, ez], type, passedict);
    checkTrace(chk, w, j, `bmodel.move#${iter}`);
  }
  results.push(chk.frac.report(), chk.end.report(), chk.plane.report(), chk.flags.report());
}

// === Test 3: back-compat -----------------------------------------------------
{
  // (a) Box-entity path (SOLID_BBOX/SLIDEBOX) is untouched: a scenario with ONLY
  // box entities (no installModelHull call at all) must match the JS reference's
  // box branch exactly, same as svmove.test.mjs's own Test 2.
  const x = await loadSvmoveWasm();
  const r = rng(0xBACC0117);
  x.initEdicts(MAX_EDICTS, EDICT_SIZE_WORDS);
  x.initAreaTree(WORLD_MINS[0], WORLD_MINS[1], WORLD_MINS[2], WORLD_MAXS[0], WORLD_MAXS[1], WORLD_MAXS[2], MAX_EDICTS);
  const edicts = new JsEdicts(MAX_EDICTS);
  const links = []; for (let i = 0; i < MAX_EDICTS; i++) links.push({ prev: null, next: null, ent: null });
  const nodes = [];
  const root = createAreaNode(nodes, 0, WORLD_MINS, WORLD_MAXS);
  const worldHull = makeBoxHull([-4096, -4096, -4096], [4096, 4096, 4096]);
  loadWorldHullToWasm(x, worldHull);

  const NUM_ENTS = 60;
  for (let e = 1; e <= NUM_ENTS; e++) {
    const ox = r.f32(500), oy = r.f32(500), oz = r.f32(500);
    const hx = Math.abs(r.f32(40)) + 3, hy = Math.abs(r.f32(40)) + 3, hz = Math.abs(r.f32(40)) + 3;
    const solid = r.int(2) === 0 ? SOLID_BBOX : SOLID_SLIDEBOX;
    edicts.setf(e, F.ORIGIN, ox); edicts.setf(e, F.ORIGIN1, oy); edicts.setf(e, F.ORIGIN2, oz);
    edicts.setf(e, F.MINS, -hx); edicts.setf(e, F.MINS1, -hy); edicts.setf(e, F.MINS2, -hz);
    edicts.setf(e, F.MAXS, hx); edicts.setf(e, F.MAXS1, hy); edicts.setf(e, F.MAXS2, hz);
    edicts.setf(e, F.SOLID, solid); edicts.setf(e, F.FLAGS, 0); edicts.setf(e, F.SKIN, 0); edicts.setf(e, F.SIZE, hx * 2);
    edicts.seti(e, F.OWNER, 0);
    x.edStoreFloat(e, F.ORIGIN, ox); x.edStoreFloat(e, F.ORIGIN1, oy); x.edStoreFloat(e, F.ORIGIN2, oz);
    x.edStoreFloat(e, F.MINS, -hx); x.edStoreFloat(e, F.MINS1, -hy); x.edStoreFloat(e, F.MINS2, -hz);
    x.edStoreFloat(e, F.MAXS, hx); x.edStoreFloat(e, F.MAXS1, hy); x.edStoreFloat(e, F.MAXS2, hz);
    x.edStoreFloat(e, F.SOLID, solid); x.edStoreFloat(e, F.FLAGS, 0); x.edStoreFloat(e, F.SKIN, 0); x.edStoreFloat(e, F.SIZE, hx * 2);
    x.edStoreInt(e, F.OWNER, 0);
    x.linkEdict(e);
    jsLinkEdict(edicts, links, root, e);
  }

  const chk = { frac: new CheckF64('backcompat.box.fraction'), end: new CheckF64('backcompat.box.endpos'), plane: new CheckF64('backcompat.box.plane'), flags: new Check('backcompat.box.flags') };
  for (let iter = 0; iter < 8000; iter++) {
    const sx = r.f32(600), sy = r.f32(600), sz = r.f32(600);
    const ex = r.f32(600), ey = r.f32(600), ez = r.f32(600);
    const hx = Math.abs(r.f32(30)) + 1, hy = Math.abs(r.f32(30)) + 1, hz = Math.abs(r.f32(30)) + 1;
    const mins = [-hx, -hy, -hz], maxs = [hx, hy, hz];
    x.move(sx, sy, sz, mins[0], mins[1], mins[2], maxs[0], maxs[1], maxs[2], ex, ey, ez, MOVE_NORMAL, -1);
    const w = readMoveTrace(x);
    const j = jsMove({}, edicts, root, worldHull, [sx, sy, sz], mins, maxs, [ex, ey, ez], MOVE_NORMAL, null);
    checkTrace(chk, w, j, `backcompat.box#${iter}`);
  }
  results.push(chk.frac.report(), chk.end.report(), chk.plane.report(), chk.flags.report());

  // (b) world.pointContents() stays usable against the world hull after a move()
  // whose clipToLinks walk touched SOLID_BSP entities (proves selectModelHull's
  // repoint of the shared "current hull" indirection is fully undone by move()'s
  // existing trailing setHullMeta restore, same discipline it already applied
  // for box-hull touched entities).
  {
    const y = await loadSvmoveWasm();
    y.initEdicts(MAX_EDICTS, EDICT_SIZE_WORDS);
    y.initAreaTree(WORLD_MINS[0], WORLD_MINS[1], WORLD_MINS[2], WORLD_MAXS[0], WORLD_MAXS[1], WORLD_MAXS[2], MAX_EDICTS);
    loadModelToWasm(y, MODEL_IDX_A, modelA);
    loadWorldHullToWasm(y, worldHull);

    y.edStoreFloat(1, F.ORIGIN, 0); y.edStoreFloat(1, F.ORIGIN1, 0); y.edStoreFloat(1, F.ORIGIN2, 0);
    y.edStoreFloat(1, F.SOLID, SOLID_BSP); y.edStoreFloat(1, F.MODELINDEX, MODEL_IDX_A);
    y.edStoreFloat(1, F.MINS, -40); y.edStoreFloat(1, F.MINS1, -40); y.edStoreFloat(1, F.MINS2, -20);
    y.edStoreFloat(1, F.MAXS, 40); y.edStoreFloat(1, F.MAXS1, 40); y.edStoreFloat(1, F.MAXS2, 20);
    y.edStoreFloat(1, F.SIZE, 80);
    y.linkEdict(1);

    for (let iter = 0; iter < 200; iter++) {
      y.move(0, 0, 0, -8, -8, -8, 8, 8, 8, 400, 400, 400, MOVE_NORMAL, -1);
    }
    const chkPC = new Check('bmodel.move.pointContents-restore');
    const r2 = rng(0xC0DE);
    for (let iter = 0; iter < 500; iter++) {
      const px = r2.f32(4000), py = r2.f32(4000), pz = r2.f32(4000);
      chkPC.intEq(y.pointContents(px, py, pz), jsHullPointContents(worldHull, 0, [px, py, pz]), `pc#${iter}`);
    }
    results.push(chkPC.report());
  }

  // (c) A FRESH instance that never calls installModelHull at all still passes a
  // world-hull-only scenario (no SOLID_BSP entities linked) -- the model table's
  // storage is purely additive; never touching it changes nothing.
  {
    const z = await loadSvmoveWasm();
    z.initEdicts(MAX_EDICTS, EDICT_SIZE_WORDS);
    z.initAreaTree(WORLD_MINS[0], WORLD_MINS[1], WORLD_MINS[2], WORLD_MAXS[0], WORLD_MAXS[1], WORLD_MAXS[2], MAX_EDICTS);
    loadWorldHullToWasm(z, worldHull);
    const r3 = rng(0xFA57);
    const chkFresh = { frac: new CheckF64('freshnomodel.fraction'), end: new CheckF64('freshnomodel.endpos'), plane: new CheckF64('freshnomodel.plane'), flags: new Check('freshnomodel.flags') };
    for (let iter = 0; iter < 2000; iter++) {
      const sx = r3.f32(600), sy = r3.f32(600), sz = r3.f32(600);
      const ex = r3.f32(600), ey = r3.f32(600), ez = r3.f32(600);
      z.move(sx, sy, sz, 0, 0, 0, 0, 0, 0, ex, ey, ez, MOVE_NORMAL, -1);
      const w = readMoveTrace(z);
      const j = jsClipToWorld(worldHull, [sx, sy, sz], [ex, ey, ez]);
      checkTrace(chkFresh, w, j, `freshnomodel#${iter}`);
    }
    results.push(chkFresh.frac.report(), chkFresh.end.report(), chkFresh.plane.report(), chkFresh.flags.report());
  }
}

const ok = results.every(Boolean);
process.exit(ok ? 0 : 1);
