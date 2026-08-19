// Golden parity test: builtins_world.ts (pf_traceline, pf_setorigin, pf_setsize,
// pf_pointcontents, pf_droptofloor) vs the JS reference in src/engine/pf.ts,
// transliterated inline below (plus the SV_Move/link machinery it composes over,
// transliterated the same way svmove.test.mjs does — duplicated here per project
// convention: each golden test is self-contained).
//
// builtins_world.ts re-exports svmove.ts's (and, through it, ed.ts's/world.ts's)
// entire surface, so this test loads build/builtins_world.wasm directly and gets
// every loader (initEdicts/initAreaTree/setWorldHullRange/setPlane/setClipNode/
// edStoreFloat/...) plus the pf_* builtins and the GLOBALS accessors on one
// exports object.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { rng, Check } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = join(HERE, '..', 'build', 'builtins_world.wasm');

async function loadWasm() {
  const bytes = readFileSync(WASM_PATH);
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: { abort: (msg, file, line, col) => { throw new Error(`builtins_world.wasm abort @${line}:${col}`); } },
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

const x = await loadWasm();
const g = x.globalsPtr();

// GLOBALS accessed only through exported function calls (writeGlobalFloat/
// readGlobalFloat/writeGlobalInt/readGlobalInt) rather than a raw typed-array
// view over wasm memory: initEdicts/initAreaTree call heap.alloc, which can
// grow linear memory and detach any previously captured ArrayBuffer/view.
function wSetF(idx, v) { x.writeGlobalFloat(idx, Math.fround(v)); }
function wGetF(idx) { return x.readGlobalFloat(idx); }
function wSetI(idx, v) { x.writeGlobalInt(idx, v); }
function wGetI(idx) { return x.readGlobalInt(idx); }

// --- bit-exact f64 checker (trace fraction/endpos/plane are never f32-quantized
// on the svmove/world path -- see those modules' header notes) -----------------
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
// JS reference model (src/engine/pf.ts / src/engine/sv.ts, transliterated)
// ================================================================================

// --- QC call-ABI / engine-reserved global indices (src/engine/pr.ts globalvars) -
const PARM0 = 4, PARM1 = 7, PARM2 = 10, PARM3 = 13, RETURN = 1;
const GLOBAL_SELF = 28;
const TRACE_ALLSOLID = 68, TRACE_STARTSOLID = 69, TRACE_FRACTION = 70;
const TRACE_ENDPOS = 71, TRACE_PLANE_NORMAL = 74, TRACE_PLANE_DIST = 77;
const TRACE_ENT = 78, TRACE_INOPEN = 79, TRACE_INWATER = 80;

// --- entvars field indices (src/engine/pr.ts entvars, vanilla layout) ---------
const F = {
  ABSMIN: 1, ABSMIN1: 2, ABSMIN2: 3, ABSMAX: 4, ABSMAX1: 5, ABSMAX2: 6,
  SOLID: 9, ORIGIN: 10, ORIGIN1: 11, ORIGIN2: 12, SKIN: 31,
  MINS: 33, MINS1: 34, MINS2: 35, MAXS: 36, MAXS1: 37, MAXS2: 38,
  SIZE: 39, SIZE1: 40, SIZE2: 41, GROUNDENTITY: 47, FLAGS: 76, OWNER: 95,
};
const EDICT_SIZE_WORDS = 100; // >= 96 to cover F.OWNER

const SOLID_NOT = 0, SOLID_TRIGGER = 1, SOLID_BBOX = 2, SOLID_SLIDEBOX = 3, SOLID_BSP = 4;
const FL_MONSTER = 32, FL_ITEM = 256, FL_ONGROUND = 512;
const MOVE_NORMAL = 0, MOVE_NOMONSTERS = 1, MOVE_MISSILE = 2;
const CONTENTS_EMPTY = -1, CONTENTS_SOLID = -2, CONTENTS_WATER = -3;
const CONTENTS_CURRENT_0 = -9, CONTENTS_CURRENT_DOWN = -14;

// Float32Array-backed field storage (automatic f32 quantization, same trick as
// svmove.test.mjs's JsEdicts).
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

// --- recursiveHullCheck / hullPointContents (transliterated from world.test.mjs) -
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
function jsPointContents(hull, p) {
  const cont = jsHullPointContents(hull, 0, p);
  if (cont <= CONTENTS_CURRENT_0 && cont >= CONTENTS_CURRENT_DOWN) return CONTENTS_WATER;
  return cont;
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

// --- pf.ts builtins, transliterated ---------------------------------------------
function jsTraceline(edicts, root, hullWorld, v1, v2, nomonsters, passEnt) {
  const trace = jsMove(edicts, root, hullWorld, v1, [0, 0, 0], [0, 0, 0], v2, nomonsters, passEnt);
  return {
    allsolid: trace.allsolid ? 1.0 : 0.0,
    startsolid: trace.startsolid ? 1.0 : 0.0,
    fraction: trace.fraction,
    inwater: trace.inwater ? 1.0 : 0.0,
    inopen: trace.inopen ? 1.0 : 0.0,
    endpos: trace.endpos,
    plane_normal: trace.plane.normal,
    plane_dist: trace.plane.dist,
    ent: trace.ent != null ? trace.ent : 0,
  };
}
function jsSetOrigin(edicts, links, root, ent, origin) {
  edicts.setf(ent, F.ORIGIN, origin[0]); edicts.setf(ent, F.ORIGIN1, origin[1]); edicts.setf(ent, F.ORIGIN2, origin[2]);
  jsLinkEdict(edicts, links, root, ent);
}
function jsSetSize(edicts, links, root, ent, min, max) {
  edicts.setf(ent, F.MINS, min[0]); edicts.setf(ent, F.MINS1, min[1]); edicts.setf(ent, F.MINS2, min[2]);
  edicts.setf(ent, F.MAXS, max[0]); edicts.setf(ent, F.MAXS1, max[1]); edicts.setf(ent, F.MAXS2, max[2]);
  edicts.setf(ent, F.SIZE, max[0] - min[0]); edicts.setf(ent, F.SIZE1, max[1] - min[1]); edicts.setf(ent, F.SIZE2, max[2] - min[2]);
  jsLinkEdict(edicts, links, root, ent);
}
function jsDropToFloor(edicts, links, root, hullWorld, self) {
  const origin = [edicts.f(self, F.ORIGIN), edicts.f(self, F.ORIGIN1), edicts.f(self, F.ORIGIN2)];
  const mins = [edicts.f(self, F.MINS), edicts.f(self, F.MINS1), edicts.f(self, F.MINS2)];
  const maxs = [edicts.f(self, F.MAXS), edicts.f(self, F.MAXS1), edicts.f(self, F.MAXS2)];
  const end = [origin[0], origin[1], origin[2] - 256.0];
  const trace = jsMove(edicts, root, hullWorld, origin, mins, maxs, end, MOVE_NORMAL, self);
  if (trace.fraction === 1.0 || trace.allsolid === true) {
    return { ret: 0.0 };
  }
  jsSetOrigin(edicts, links, root, self, trace.endpos);
  const flags = (edicts.f(self, F.FLAGS) | 0) | FL_ONGROUND;
  edicts.setf(self, F.FLAGS, flags);
  edicts.seti(self, F.GROUNDENTITY, trace.ent); // trace.ent guaranteed non-null here
  return { ret: 1.0 };
}

// ================================================================================
// Fixtures + wasm wiring
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
// A single-plane "floor" world hull: solid below floorZ, empty above (unlike
// makeBoxHull, whose solid region is its INTERIOR -- correct for an entity's
// own Minkowski box, but a poor stand-in "world" here: with sweep points deep
// inside a huge box, every world-clip would trivially resolve allsolid=true at
// the very first plane pair, degenerating clipToLinks's `if (allsolid) return`
// into a no-op that starves droptofloor's success path). A floor plane instead
// gives genuine open space above + a real hit surface below, so traceline/
// droptofloor exercise real fraction<1 hits against the world, not just entities.
function makeFloorHull(floorZ) {
  return {
    clipnodes: [{ planenum: 0, children: [CONTENTS_EMPTY, CONTENTS_SOLID] }],
    planes: [{ type: 2, normal: [0.0, 0.0, 1.0], dist: floorZ }],
    firstclipnode: 0, lastclipnode: 0,
  };
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

function setEntityBoth(edicts, e, ox, oy, oz, hx, hy, hz, solid, flags, owner) {
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
}

const results = [];
const WORLD_MINS = [-2048, -2048, -2048], WORLD_MAXS = [2048, 2048, 2048];
const MAX_EDICTS = 200;

// === Section A: pf_traceline -- population of linked box entities, thousands of
// random traceline() queries (read-only w.r.t. edict state). ====================
{
  const r = rng(0xBEEF01);
  x.initEdicts(MAX_EDICTS, EDICT_SIZE_WORDS);
  x.initAreaTree(WORLD_MINS[0], WORLD_MINS[1], WORLD_MINS[2], WORLD_MAXS[0], WORLD_MAXS[1], WORLD_MAXS[2], MAX_EDICTS);
  const edicts = new JsEdicts(MAX_EDICTS);
  const links = []; for (let i = 0; i < MAX_EDICTS; i++) links.push({ prev: null, next: null, ent: null });
  const nodes = [];
  const root = createAreaNode(nodes, 0, WORLD_MINS, WORLD_MAXS);

  const worldHull = makeFloorHull(0); // floor at z=0, inside the [-600,600] sweep range used below
  loadWorldHullToWasm(worldHull);

  const NUM_ENTS = 80;
  for (let e = 1; e <= NUM_ENTS; e++) {
    const ox = r.f32(500), oy = r.f32(500), oz = r.f32(500);
    const hx = Math.abs(r.f32(40)) + 3, hy = Math.abs(r.f32(40)) + 3, hz = Math.abs(r.f32(40)) + 3;
    const solidRoll = r.int(10);
    const solid = solidRoll === 0 ? SOLID_NOT : (solidRoll < 6 ? SOLID_BBOX : SOLID_SLIDEBOX);
    const flags = r.int(6) === 0 ? FL_MONSTER : (r.int(8) === 0 ? FL_ITEM : 0);
    const owner = r.int(4) === 0 ? (1 + r.int(NUM_ENTS)) : 0;
    setEntityBoth(edicts, e, ox, oy, oz, hx, hy, hz, solid, flags, owner);
    x.linkEdict(e);
    jsLinkEdict(edicts, links, root, e);
  }

  // trace_* are QC GLOBALS (f32-quantized on every store, unlike svmove.move()'s
  // own getters which return the raw f64 Trace fields) -- so parity here means
  // f32-rounded equality (Check.floatEq against Math.fround(j.*)), same as
  // builtins_math.test.mjs, NOT the exact-f64 Object.is used for svmove's own
  // trace getters in svmove.test.mjs/world.test.mjs.
  const chk = {
    frac: new Check('traceline.fraction'), end: new Check('traceline.endpos'), plane: new Check('traceline.plane'),
    flags: new Check('traceline.flags'), ret: new Check('traceline.retflags'),
  };

  for (let iter = 0; iter < 20000; iter++) {
    const sx = r.f32(600), sy = r.f32(600), sz = r.f32(600);
    const ex = r.f32(600), ey = r.f32(600), ez = r.f32(600);
    const nomonsters = r.int(10) === 0 ? MOVE_NOMONSTERS : MOVE_NORMAL;
    const ent = r.int(4); // 0 (world/no exclusion) most of the time, else a real entity

    wSetF(PARM0, sx); wSetF(PARM0 + 1, sy); wSetF(PARM0 + 2, sz);
    wSetF(PARM1, ex); wSetF(PARM1 + 1, ey); wSetF(PARM1 + 2, ez);
    wSetF(PARM2, nomonsters);
    wSetI(PARM3, ent);
    x.pf_traceline(g);

    const w = {
      allsolid: wGetF(TRACE_ALLSOLID), startsolid: wGetF(TRACE_STARTSOLID), fraction: wGetF(TRACE_FRACTION),
      inwater: wGetF(TRACE_INWATER), inopen: wGetF(TRACE_INOPEN),
      endpos: [wGetF(TRACE_ENDPOS), wGetF(TRACE_ENDPOS + 1), wGetF(TRACE_ENDPOS + 2)],
      plane_normal: [wGetF(TRACE_PLANE_NORMAL), wGetF(TRACE_PLANE_NORMAL + 1), wGetF(TRACE_PLANE_NORMAL + 2)],
      plane_dist: wGetF(TRACE_PLANE_DIST), ent: wGetI(TRACE_ENT),
    };
    const j = jsTraceline(edicts, root, worldHull, [sx, sy, sz], [ex, ey, ez], nomonsters, ent);

    chk.frac.floatEq(w.fraction, Math.fround(j.fraction), `tl#${iter} fraction`);
    for (let k = 0; k < 3; k++) chk.end.floatEq(w.endpos[k], Math.fround(j.endpos[k]), `tl#${iter} endpos[${k}]`);
    for (let k = 0; k < 3; k++) chk.plane.floatEq(w.plane_normal[k], Math.fround(j.plane_normal[k]), `tl#${iter} plane_normal[${k}]`);
    chk.plane.floatEq(w.plane_dist, Math.fround(j.plane_dist), `tl#${iter} plane_dist`);
    chk.ret.floatEq(w.allsolid, j.allsolid, `tl#${iter} allsolid`);
    chk.ret.floatEq(w.startsolid, j.startsolid, `tl#${iter} startsolid`);
    chk.ret.floatEq(w.inwater, j.inwater, `tl#${iter} inwater`);
    chk.ret.floatEq(w.inopen, j.inopen, `tl#${iter} inopen`);
    chk.flags.intEq(w.ent, j.ent, `tl#${iter} trace_ent`);
  }
  results.push(chk.frac.report(), chk.end.report(), chk.plane.report(), chk.ret.report(), chk.flags.report());
}

// === Section B: pf_setorigin / pf_setsize -- interleaved random calls against a
// linked population, checking origin/mins/maxs/size + absmin/absmax (i.e. the
// builtin's own field writes AND the linkEdict call it makes) after every op,
// exactly like svmove.test.mjs's Test 1 churn pattern. ===========================
{
  const r = rng(0xBEEF02);
  x.initEdicts(MAX_EDICTS, EDICT_SIZE_WORDS);
  x.initAreaTree(WORLD_MINS[0], WORLD_MINS[1], WORLD_MINS[2], WORLD_MAXS[0], WORLD_MAXS[1], WORLD_MAXS[2], MAX_EDICTS);
  const edicts = new JsEdicts(MAX_EDICTS);
  const links = []; for (let i = 0; i < MAX_EDICTS; i++) links.push({ prev: null, next: null, ent: null });
  const nodes = [];
  const root = createAreaNode(nodes, 0, WORLD_MINS, WORLD_MAXS);

  const NUM_ENTS = 60;
  for (let e = 1; e <= NUM_ENTS; e++) {
    const ox = r.f32(500), oy = r.f32(500), oz = r.f32(500);
    const hx = Math.abs(r.f32(40)) + 3, hy = Math.abs(r.f32(40)) + 3, hz = Math.abs(r.f32(40)) + 3;
    const solidRoll = r.int(10);
    const solid = solidRoll === 0 ? SOLID_NOT : (solidRoll < 6 ? SOLID_BBOX : SOLID_SLIDEBOX);
    const flags = r.int(6) === 0 ? FL_ITEM : 0;
    setEntityBoth(edicts, e, ox, oy, oz, hx, hy, hz, solid, flags, 0);
    x.linkEdict(e);
    jsLinkEdict(edicts, links, root, e);
  }

  const chk = new Check('setorigin/setsize.fields');
  const FIELDS_TO_CHECK = [F.ORIGIN, F.ORIGIN1, F.ORIGIN2, F.MINS, F.MINS1, F.MINS2, F.MAXS, F.MAXS1, F.MAXS2,
    F.SIZE, F.SIZE1, F.SIZE2, F.ABSMIN, F.ABSMIN1, F.ABSMIN2, F.ABSMAX, F.ABSMAX1, F.ABSMAX2];

  for (let trial = 0; trial < 20000; trial++) {
    const e = 1 + r.int(NUM_ENTS);
    if (r.int(2) === 0) {
      const origin = [r.f32(800), r.f32(800), r.f32(800)];
      wSetI(PARM0, e);
      wSetF(PARM1, origin[0]); wSetF(PARM1 + 1, origin[1]); wSetF(PARM1 + 2, origin[2]);
      x.pf_setorigin(g);
      jsSetOrigin(edicts, links, root, e, origin);
    } else {
      const hx = Math.abs(r.f32(50)) + 2, hy = Math.abs(r.f32(50)) + 2, hz = Math.abs(r.f32(50)) + 2;
      const min = [-hx, -hy, -hz], max = [hx, hy, hz];
      wSetI(PARM0, e);
      wSetF(PARM1, min[0]); wSetF(PARM1 + 1, min[1]); wSetF(PARM1 + 2, min[2]);
      wSetF(PARM2, max[0]); wSetF(PARM2 + 1, max[1]); wSetF(PARM2 + 2, max[2]);
      x.pf_setsize(g);
      jsSetSize(edicts, links, root, e, min, max);
    }
    for (const f of FIELDS_TO_CHECK) {
      chk.floatEq(x.edLoadFloat(e, f), edicts.f(e, f), `trial#${trial} e=${e} f=${f}`);
    }
  }
  results.push(chk.report());
}

// === Section C: pf_pointcontents -- random points against a box hull (an
// entity-shaped Minkowski box is fine here: unlike Sections A/D, this section
// tests point CLASSIFICATION variety only, not movement through open space). ====
{
  const r = rng(0xBEEF03);
  const worldHull = makeBoxHull([-1500, -900, -700], [1200, 1400, 1100]);
  // pf_pointcontents calls world.pointContents() directly, with NO intervening
  // move() -- so (unlike Sections A/D) world.ts's own hullFirstClipnode/
  // hullLastClipnode (which hullPointContents bounds-checks every traversed
  // node against) must be set immediately via setHullMeta, matching world.
  // test.mjs's loadHullToWasm. setWorldHullRange (loadWorldHullToWasm's call)
  // is a DIFFERENT thing -- it only updates svmove.ts's own bookkeeping vars,
  // applied to world.ts's actual hull range lazily inside move()'s clipToWorld
  // -- so using it alone here (with no move() call to apply it) leaves world.ts
  // still pointed at whatever hull the last move()/pf_traceline call left
  // behind, and hullPointContents traps via unreachable() on an out-of-range node.
  x.initHullStorage(worldHull.clipnodes.length, worldHull.planes.length); // size pools like the live embedder
  x.setHullMeta(worldHull.firstclipnode, worldHull.lastclipnode);
  for (let i = 0; i < worldHull.planes.length; i++) {
    const p = worldHull.planes[i];
    x.setPlane(i, p.normal[0], p.normal[1], p.normal[2], p.dist, p.type);
  }
  for (let i = worldHull.firstclipnode; i <= worldHull.lastclipnode; i++) {
    const n = worldHull.clipnodes[i];
    x.setClipNode(i, n.planenum, n.children[0], n.children[1]);
  }

  const chk = new Check('pointcontents.RETURN');
  for (let iter = 0; iter < 20000; iter++) {
    const px = r.f32(2500), py = r.f32(2500), pz = r.f32(2500);
    wSetF(PARM0, px); wSetF(PARM0 + 1, py); wSetF(PARM0 + 2, pz);
    x.pf_pointcontents(g);
    const w = wGetF(RETURN);
    const j = Math.fround(jsPointContents(worldHull, [px, py, pz]));
    chk.floatEq(w, j, `pc#${iter} p=${px},${py},${pz}`);
  }
  results.push(chk.report());
}

// === Section D: pf_droptofloor -- a fixed obstacle population (floor slabs +
// scattered box entities) plus a dedicated "self" entity (#1) whose origin is
// re-seeded every trial, exercising fall-and-land, fall-through-to-world-only,
// fall-past-everything (allsolid/no-hit), and immediate-solid-start cases. ======
{
  const r = rng(0xBEEF04);
  x.initEdicts(MAX_EDICTS, EDICT_SIZE_WORDS);
  x.initAreaTree(WORLD_MINS[0], WORLD_MINS[1], WORLD_MINS[2], WORLD_MAXS[0], WORLD_MAXS[1], WORLD_MAXS[2], MAX_EDICTS);
  const edicts = new JsEdicts(MAX_EDICTS);
  const links = []; for (let i = 0; i < MAX_EDICTS; i++) links.push({ prev: null, next: null, ent: null });
  const nodes = [];
  const root = createAreaNode(nodes, 0, WORLD_MINS, WORLD_MAXS);

  // Floor at z=-180: self starts at z in [-120,120] and sweeps down 256 units
  // (dfEnd.z = origin.z - 256), so the floor is inside reach for roughly the
  // low half of that range and out of reach for the rest -- a genuine mix of
  // "lands on the world floor", "lands on an obstacle above it", and "falls
  // clean past everything" (fraction stays 1, RETURN 0) outcomes.
  const worldHull = makeFloorHull(-180);
  loadWorldHullToWasm(worldHull);

  // Obstacles: entities #2..#NUM_ENTS, biased toward wide/flat "floor slab" shapes
  // sitting at scattered heights (kept within reach of a 256-unit drop from the
  // self z-range below) so a straight-down sweep frequently lands on one too.
  const NUM_ENTS = 60;
  for (let e = 2; e <= NUM_ENTS; e++) {
    const ox = r.f32(300), oy = r.f32(300), oz = r.f32(150);
    const flat = r.int(2) === 0;
    const hx = flat ? (Math.abs(r.f32(150)) + 20) : (Math.abs(r.f32(30)) + 3);
    const hy = flat ? (Math.abs(r.f32(150)) + 20) : (Math.abs(r.f32(30)) + 3);
    const hz = flat ? (Math.abs(r.f32(8)) + 2) : (Math.abs(r.f32(30)) + 3);
    const solidRoll = r.int(10);
    const solid = solidRoll === 0 ? SOLID_NOT : (solidRoll < 6 ? SOLID_BBOX : SOLID_SLIDEBOX);
    setEntityBoth(edicts, e, ox, oy, oz, hx, hy, hz, solid, 0, 0);
    x.linkEdict(e);
    jsLinkEdict(edicts, links, root, e);
  }

  // "self" -- entity #1, box-shaped, re-seeded every trial (both js+wasm), always
  // linked before the call so it participates normally in area-tree queries.
  const SELF = 1;

  const chk = {
    ret: new Check('droptofloor.RETURN'), origin: new CheckF64('droptofloor.origin'),
    flags: new Check('droptofloor.flags'), ground: new Check('droptofloor.groundentity'),
  };

  for (let iter = 0; iter < 20000; iter++) {
    let sx, sy, sz;
    if (r.int(4) === 0) {
      // guaranteed start-inside-an-obstacle case (exercises the allsolid path)
      const e = 2 + r.int(NUM_ENTS - 1);
      sx = edicts.f(e, F.ORIGIN) + r.f32(2); sy = edicts.f(e, F.ORIGIN1) + r.f32(2); sz = edicts.f(e, F.ORIGIN2) + r.f32(2);
    } else {
      sx = r.f32(400); sy = r.f32(400); sz = r.f32(120);
    }
    const hx = Math.abs(r.f32(20)) + 2, hy = Math.abs(r.f32(20)) + 2, hz = Math.abs(r.f32(20)) + 2;
    setEntityBoth(edicts, SELF, sx, sy, sz, hx, hy, hz, SOLID_SLIDEBOX, 0, 0);
    x.linkEdict(SELF);
    jsLinkEdict(edicts, links, root, SELF);

    wSetI(GLOBAL_SELF, SELF);
    x.pf_droptofloor(g);
    const wRet = wGetF(RETURN);

    const j = jsDropToFloor(edicts, links, root, worldHull, SELF);

    chk.ret.floatEq(wRet, j.ret, `dtf#${iter} ret`);
    // Only check the mutated-on-success fields when the JS reference says it
    // succeeded (mirrors pf.ts's own early-return -- on failure nothing else
    // is written, by either side).
    if (j.ret === 1.0) {
      chk.origin.eq(x.edLoadFloat(SELF, F.ORIGIN), edicts.f(SELF, F.ORIGIN), `dtf#${iter} origin.x`);
      chk.origin.eq(x.edLoadFloat(SELF, F.ORIGIN1), edicts.f(SELF, F.ORIGIN1), `dtf#${iter} origin.y`);
      chk.origin.eq(x.edLoadFloat(SELF, F.ORIGIN2), edicts.f(SELF, F.ORIGIN2), `dtf#${iter} origin.z`);
      chk.flags.floatEq(x.edLoadFloat(SELF, F.FLAGS), edicts.f(SELF, F.FLAGS), `dtf#${iter} flags`);
      chk.ground.intEq(x.edLoadInt(SELF, F.GROUNDENTITY), edicts.i(SELF, F.GROUNDENTITY), `dtf#${iter} groundentity`);
      chk.origin.eq(x.edLoadFloat(SELF, F.ABSMIN2), edicts.f(SELF, F.ABSMIN2), `dtf#${iter} absmin.z (post-relink)`);
    }
  }
  results.push(chk.ret.report(), chk.origin.report(), chk.flags.report(), chk.ground.report());
}

const ok = results.every(Boolean);
process.exit(ok ? 0 : 1);
