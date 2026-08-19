// Golden parity test: builtins_move.ts (SV_CheckBottom/SV_movestep/
// SV_StepDirection/SV_NewChaseDir/SV.closeEnough + the walkmove(#32)/
// checkbottom(#40)/movetogoal(#67) builtin wrappers) vs a JS reference
// transliterated inline from src/engine/sv.ts / src/engine/pf.ts, matching the
// svphysics.test.mjs / builtins_world.test.mjs self-contained-duplication
// pattern (areanode tree + link machinery + move() copied in again here per
// project convention).
//
// Scope tested (see builtins_move.ts's header for the full exclusion list):
//   - checkBottom: quick 4-corner check + full center+4-corner trace-down
//     fallback.
//   - movestep: swim/fly enemy-relative-Z branch + ground step-up/step-down/
//     checkBottom branch, INCLUDING FL_PARTIALGROUND and oldorg-restore.
//   - stepDirection / closeEnough / newChaseDir (host_random-driven) /
//     pf_walkmove / pf_checkbottom / pf_movetogoal — the full movetogoal
//     chain, EXCLUDING touch/trigger QC dispatch (linkEdict never fires it in
//     this port, inherited from svmove.ts).
import { rng, Check } from './lib.mjs';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = join(HERE, '..', 'build', 'builtins_move.wasm');

// --- host_random: a single shared queue consumed by BOTH the wasm import and
// the JS reference (see file-level note below), so results are bit-exact
// regardless of how many draws either side's control flow actually takes --
// both draw from the SAME positions since the queue is reset to index 0
// before each side's call for a given trial.
let RQ = [];
let RQI = 0;
function hostRandomShared() {
  if (RQI >= RQ.length) throw new Error('random queue exhausted -- increase pre-fill count');
  return RQ[RQI++];
}
function fillRand(r, n = 6) {
  RQ = []; for (let i = 0; i < n; i++) RQ.push(r.u32() / 0x100000000);
  RQI = 0;
}

async function loadWasm() {
  const bytes = readFileSync(WASM_PATH);
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: {
      abort: (msg, file, line, col) => { throw new Error(`builtins_move.wasm abort @${line}:${col}`); },
    },
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
    // AS binds a bare `declare function` under a module named after the
    // DECLARING FILE's basename (no @external annotation) -- e.g. host.ts's
    // `declare function host_random()` links under module "host" (see
    // host.test.mjs's identical binding). This module declares its own copy
    // under module "builtins_move" (see builtins_move.ts header note).
    builtins_move: { host_sin: Math.sin, host_cos: Math.cos, 
      host_random: hostRandomShared,
    },
  });
  return instance.exports;
}

const x = await loadWasm();

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
// JS reference model (src/engine/sv.ts + src/engine/pf.ts, transliterated)
// ================================================================================

const F = {
  ABSMIN: 1, ABSMIN1: 2, ABSMIN2: 3, ABSMAX: 4, ABSMAX1: 5, ABSMAX2: 6,
  SOLID: 9, ORIGIN: 10, ORIGIN1: 11, ORIGIN2: 12,
  ANGLES: 19, ANGLES1: 20, ANGLES2: 21,
  SKIN: 31, MINS: 33, MINS1: 34, MINS2: 35, MAXS: 36, MAXS1: 37, MAXS2: 38,
  SIZE: 39, GROUNDENTITY: 47, ENEMY: 75, FLAGS: 76,
  IDEAL_YAW: 85, YAW_SPEED: 86, GOALENTITY: 88, OWNER: 95,
};
const EDICT_SIZE_WORDS = 100;

const SOLID_NOT = 0, SOLID_TRIGGER = 1, SOLID_BBOX = 2, SOLID_SLIDEBOX = 3, SOLID_BSP = 4;
const FL_FLY = 1, FL_SWIM = 2, FL_MONSTER = 32, FL_ITEM = 256, FL_ONGROUND = 512, FL_PARTIALGROUND = 1024;
const MOVE_NORMAL = 0, MOVE_NOMONSTERS = 1, MOVE_MISSILE = 2;
const CONTENTS_EMPTY = -1, CONTENTS_SOLID = -2, CONTENTS_WATER = -3;

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

// --- recursiveHullCheck / hullPointContents (transliterated, same as
// svphysics.test.mjs / world.test.mjs) -------------------------------------------
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
function jsPointContents(worldHull, p) {
  const cont = jsHullPointContents(worldHull, 0, p);
  if (cont <= -9 && cont >= -14) return CONTENTS_WATER;
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
  if (trace.fraction < 1.0 || trace.startsolid === true) trace.ent = 0;
  return trace;
}

// --- areanode tree (sv.ts createAreaNode) + link lists --------------------------
function createAreaNode(nodes, depth, mins, maxs) {
  const anode = { trigger_edicts: { prev: null, next: null, ent: null }, solid_edicts: { prev: null, next: null, ent: null } };
  anode.trigger_edicts.prev = anode.trigger_edicts.next = anode.trigger_edicts;
  anode.solid_edicts.prev = anode.solid_edicts.next = anode.solid_edicts;
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

// --- src/engine/sv.ts checkBottom/movestep/stepDirection/newChaseDir/closeEnough,
// src/engine/pf.ts changeyaw/walkmove/checkbottom/moveToGoal --------------------
function jsCheckBottom(edicts, root, worldHull, e) {
  const originX = edicts.f(e, F.ORIGIN), originY = edicts.f(e, F.ORIGIN1), originZ = edicts.f(e, F.ORIGIN2);
  const minsX = originX + edicts.f(e, F.MINS), minsY = originY + edicts.f(e, F.MINS1), minsZ = originZ + edicts.f(e, F.MINS2);
  const maxsX = originX + edicts.f(e, F.MAXS), maxsY = originY + edicts.f(e, F.MAXS1), maxsZ = originZ + edicts.f(e, F.MAXS2);

  for (;;) {
    if (jsPointContents(worldHull, [minsX, minsY, minsZ - 1.0]) !== CONTENTS_SOLID) break;
    if (jsPointContents(worldHull, [minsX, maxsY, minsZ - 1.0]) !== CONTENTS_SOLID) break;
    if (jsPointContents(worldHull, [maxsX, minsY, minsZ - 1.0]) !== CONTENTS_SOLID) break;
    if (jsPointContents(worldHull, [maxsX, maxsY, minsZ - 1.0]) !== CONTENTS_SOLID) break;
    return true;
  }

  const start = [(minsX + maxsX) * 0.5, (minsY + maxsY) * 0.5, minsZ];
  let stop = [start[0], start[1], start[2] - 36.0];
  let trace = jsMove(edicts, root, worldHull, start, [0, 0, 0], [0, 0, 0], stop, MOVE_NOMONSTERS, e);
  if (trace.fraction === 1.0) return false;
  let mid = trace.endpos[2], bottom = mid;
  for (let x = 0; x <= 1; x++) {
    for (let y = 0; y <= 1; y++) {
      const sx = (x !== 0) ? maxsX : minsX, sy = (y !== 0) ? maxsY : minsY;
      const s2 = [sx, sy, start[2]], e2 = [sx, sy, stop[2]];
      trace = jsMove(edicts, root, worldHull, s2, [0, 0, 0], [0, 0, 0], e2, MOVE_NOMONSTERS, e);
      if (trace.fraction !== 1.0 && trace.endpos[2] > bottom) bottom = trace.endpos[2];
      if (trace.fraction === 1.0 || (mid - trace.endpos[2]) > 18.0) return false;
    }
  }
  return true;
}

function jsMovestep(edicts, links, root, worldHull, e, moveX, moveY, relink) {
  const oldX = edicts.f(e, F.ORIGIN), oldY = edicts.f(e, F.ORIGIN1), oldZ = edicts.f(e, F.ORIGIN2);
  const mins = [edicts.f(e, F.MINS), edicts.f(e, F.MINS1), edicts.f(e, F.MINS2)];
  const maxs = [edicts.f(e, F.MAXS), edicts.f(e, F.MAXS1), edicts.f(e, F.MAXS2)];
  const flags0 = edicts.f(e, F.FLAGS) | 0;

  if ((flags0 & (FL_SWIM | FL_FLY)) !== 0) {
    const enemy = edicts.i(e, F.ENEMY);
    for (let i = 0; i <= 1; i++) {
      const neworg = [oldX + moveX, oldY + moveY, oldZ];
      if (i === 0 && enemy !== 0) {
        const dz = oldZ - edicts.f(enemy, F.ORIGIN2);
        if (dz > 40.0) neworg[2] -= 8.0;
        else if (dz < 30.0) neworg[2] += 8.0;
      }
      const trace = jsMove(edicts, root, worldHull, [oldX, oldY, oldZ], mins, maxs, neworg, MOVE_NORMAL, e);
      if (trace.fraction === 1.0) {
        if ((flags0 & FL_SWIM) !== 0 && jsPointContents(worldHull, trace.endpos) === CONTENTS_EMPTY) return 0;
        edicts.setf(e, F.ORIGIN, trace.endpos[0]); edicts.setf(e, F.ORIGIN1, trace.endpos[1]); edicts.setf(e, F.ORIGIN2, trace.endpos[2]);
        if (relink) jsLinkEdict(edicts, links, root, e);
        return 1;
      }
      if (enemy === 0) return 0;
    }
    return 0;
  }

  const stepX = oldX + moveX, stepY = oldY + moveY;
  let startZ = oldZ + 18.0;
  const endZ = startZ - 36.0;
  let trace = jsMove(edicts, root, worldHull, [stepX, stepY, startZ], mins, maxs, [stepX, stepY, endZ], MOVE_NORMAL, e);
  if (trace.allsolid === true) return 0;
  if (trace.startsolid === true) {
    startZ -= 18.0;
    trace = jsMove(edicts, root, worldHull, [stepX, stepY, startZ], mins, maxs, [stepX, stepY, endZ], MOVE_NORMAL, e);
    if (trace.allsolid === true || trace.startsolid === true) return 0;
  }
  if (trace.fraction === 1.0) {
    if ((flags0 & FL_PARTIALGROUND) === 0) return 0;
    edicts.setf(e, F.ORIGIN, oldX + moveX);
    edicts.setf(e, F.ORIGIN1, oldY + moveY);
    if (relink) jsLinkEdict(edicts, links, root, e);
    edicts.setf(e, F.FLAGS, flags0 & ~FL_ONGROUND);
    return 1;
  }
  edicts.setf(e, F.ORIGIN, trace.endpos[0]); edicts.setf(e, F.ORIGIN1, trace.endpos[1]); edicts.setf(e, F.ORIGIN2, trace.endpos[2]);
  if (jsCheckBottom(edicts, root, worldHull, e) !== true) {
    if ((flags0 & FL_PARTIALGROUND) !== 0) {
      if (relink) jsLinkEdict(edicts, links, root, e);
      return 1;
    }
    edicts.setf(e, F.ORIGIN, oldX); edicts.setf(e, F.ORIGIN1, oldY); edicts.setf(e, F.ORIGIN2, oldZ);
    return 0;
  }
  edicts.setf(e, F.FLAGS, flags0 & ~FL_PARTIALGROUND);
  edicts.seti(e, F.GROUNDENTITY, trace.ent);
  if (relink) jsLinkEdict(edicts, links, root, e);
  return 1;
}

function jsAnglemod(a) { return ((a % 360.0) + 360.0) % 360.0; }

function jsChangeYaw(edicts, e) {
  const current = jsAnglemod(edicts.f(e, F.ANGLES1));
  const ideal = edicts.f(e, F.IDEAL_YAW);
  if (current === ideal) return;
  let mv = ideal - current;
  if (ideal > current) { if (mv >= 180.0) mv -= 360.0; }
  else if (mv <= -180.0) mv += 360.0;
  const speed = edicts.f(e, F.YAW_SPEED);
  if (mv > 0.0) { if (mv > speed) mv = speed; }
  else if (mv < -speed) mv = -speed;
  edicts.setf(e, F.ANGLES1, jsAnglemod(current + mv));
}

function jsStepDirection(edicts, links, root, worldHull, e, yawDeg, dist) {
  edicts.setf(e, F.IDEAL_YAW, yawDeg);
  jsChangeYaw(edicts, e);
  const yaw = yawDeg * Math.PI / 180.0;
  const oldorigin = [edicts.f(e, F.ORIGIN), edicts.f(e, F.ORIGIN1), edicts.f(e, F.ORIGIN2)];
  if (jsMovestep(edicts, links, root, worldHull, e, Math.cos(yaw) * dist, Math.sin(yaw) * dist, false) === 1) {
    const delta = edicts.f(e, F.ANGLES1) - edicts.f(e, F.IDEAL_YAW);
    if (delta > 45.0 && delta < 315.0) {
      edicts.setf(e, F.ORIGIN, oldorigin[0]); edicts.setf(e, F.ORIGIN1, oldorigin[1]); edicts.setf(e, F.ORIGIN2, oldorigin[2]);
    }
    jsLinkEdict(edicts, links, root, e);
    return true;
  }
  jsLinkEdict(edicts, links, root, e);
  return false;
}

function jsCloseEnough(edicts, e, goal, dist) {
  for (let i = 0; i <= 2; i++) {
    if (edicts.f(goal, F.ABSMIN + i) > (edicts.f(e, F.ABSMAX + i) + dist)) return false;
    if (edicts.f(goal, F.ABSMAX + i) < (edicts.f(e, F.ABSMIN + i) - dist)) return false;
  }
  return true;
}

function jsNewChaseDir(edicts, links, root, worldHull, actor, enemy, dist) {
  const olddir = jsAnglemod(((edicts.f(actor, F.IDEAL_YAW) / 45.0) >> 0) * 45.0);
  const turnaround = jsAnglemod(olddir - 180.0);
  const deltax = edicts.f(enemy, F.ORIGIN) - edicts.f(actor, F.ORIGIN);
  const deltay = edicts.f(enemy, F.ORIGIN1) - edicts.f(actor, F.ORIGIN1);
  let dx, dy;
  if (deltax > 10.0) dx = 0.0;
  else if (deltax < -10.0) dx = 180.0;
  else dx = -1;
  if (deltay < -10.0) dy = 270.0;
  else if (deltay > 10.0) dy = 90.0;
  else dy = -1;

  let tdir;
  if (dx !== -1 && dy !== -1) {
    if (dx === 0.0) tdir = (dy === 90.0) ? 45.0 : 315.0;
    else tdir = (dy === 90.0) ? 135.0 : 215.0;
    if (tdir !== turnaround && jsStepDirection(edicts, links, root, worldHull, actor, tdir, dist) === true) return;
  }
  if (hostRandomShared() >= 0.25 || Math.abs(deltay) > Math.abs(deltax)) {
    tdir = dx; dx = dy; dy = tdir;
  }
  if (dx !== -1 && dx !== turnaround && jsStepDirection(edicts, links, root, worldHull, actor, dx, dist) === true) return;
  if (dy !== -1 && dy !== turnaround && jsStepDirection(edicts, links, root, worldHull, actor, dy, dist) === true) return;
  if (olddir !== -1 && jsStepDirection(edicts, links, root, worldHull, actor, olddir, dist) === true) return;

  if (hostRandomShared() >= 0.5) {
    for (tdir = 0.0; tdir <= 315.0; tdir += 45.0) {
      if (tdir !== turnaround && jsStepDirection(edicts, links, root, worldHull, actor, tdir, dist) === true) return;
    }
  } else {
    for (tdir = 315.0; tdir >= 0.0; tdir -= 45.0) {
      if (tdir !== turnaround && jsStepDirection(edicts, links, root, worldHull, actor, tdir, dist) === true) return;
    }
  }
  if (turnaround !== -1 && jsStepDirection(edicts, links, root, worldHull, actor, turnaround, dist) === true) return;

  edicts.setf(actor, F.IDEAL_YAW, olddir);
  if (jsCheckBottom(edicts, root, worldHull, actor) !== true) {
    edicts.setf(actor, F.FLAGS, (edicts.f(actor, F.FLAGS) | 0) | FL_PARTIALGROUND);
  }
}

function jsMoveToGoal(edicts, links, root, worldHull, e, dist) {
  const flags0 = edicts.f(e, F.FLAGS) | 0;
  if ((flags0 & (FL_ONGROUND | FL_FLY | FL_SWIM)) === 0) return;
  const goal = edicts.i(e, F.GOALENTITY);
  const enemy = edicts.i(e, F.ENEMY);
  if (enemy !== 0 && jsCloseEnough(edicts, e, goal, dist) === true) return;
  if (hostRandomShared() >= 0.75 || jsStepDirection(edicts, links, root, worldHull, e, edicts.f(e, F.IDEAL_YAW), dist) !== true)
    jsNewChaseDir(edicts, links, root, worldHull, e, goal, dist);
}

// ================================================================================
// Fixtures
// ================================================================================
// World: a floor at Z=0 PLUS a raised step-platform (Z in [24,1e6]) covering
// x in [40,300] so both flat-ground movestep/checkBottom AND step-up/step-down
// transitions get exercised (movestep's fixed 18-up/36-down window makes a
// ~24-unit step the natural size to probe the edge cases with).
function makeSteppedFloorHull() {
  // node0: split on floor-plane (z=0): front(child0, d>=0)=empty-ish subtree
  // via node1(step plane), back(child1, d<0)=SOLID.
  // node1: split on x=40 plane: child0(x>=40, i.e. on the raised side)=node2
  // (z=24 plane), child1(x<40)=EMPTY (flat floor already resolved by node0).
  // node2: split on z=24: child0(z>=24)=EMPTY (above the step), child1(z<24)=SOLID.
  return {
    clipnodes: [
      { planenum: 0, children: [1, CONTENTS_SOLID] },        // 0: z - 0
      { planenum: 1, children: [2, CONTENTS_EMPTY] },        // 1: x - 40
      { planenum: 2, children: [CONTENTS_EMPTY, CONTENTS_SOLID] }, // 2: z - 24
    ],
    planes: [
      { type: 2, normal: [0, 0, 1], dist: 0 },
      { type: 0, normal: [1, 0, 0], dist: 40 },
      { type: 2, normal: [0, 0, 1], dist: 24 },
    ],
    firstclipnode: 0, lastclipnode: 2,
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
  // checkBottom's quick corner check calls world.pointContents() directly, with
  // NO intervening move() call -- so world.ts's own hullFirstClipnode/
  // hullLastClipnode (bounds-checked by hullPointContents) must be set
  // immediately via setHullMeta too. setWorldHullRange alone only updates
  // svmove.ts's bookkeeping, applied to world.ts lazily inside move()'s
  // clipToWorld -- see builtins_world.test.mjs Section C's identical note.
  x.setHullMeta(hull.firstclipnode, hull.lastclipnode);
}
function setEntityBoth(edicts, e, ox, oy, oz, hx, hy, hz, solid, flags, owner, extra = {}) {
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
  for (const k in extra) {
    edicts.setf(e, F[k], extra[k]); x.edStoreFloat(e, F[k], extra[k]);
  }
}
function syncScalarField(edicts, e, fname, v) { edicts.setf(e, F[fname], v); x.edStoreFloat(e, F[fname], v); }
function syncIntField(edicts, e, fname, v) { edicts.seti(e, F[fname], v); x.edStoreInt(e, F[fname], v); }

const results = [];
const WORLD_MINS = [-2048, -2048, -2048], WORLD_MAXS = [2048, 2048, 2048];
const MAX_EDICTS = 200;
const worldHull = makeSteppedFloorHull();

function freshWorld() {
  x.initEdicts(MAX_EDICTS, EDICT_SIZE_WORDS);
  x.initAreaTree(WORLD_MINS[0], WORLD_MINS[1], WORLD_MINS[2], WORLD_MAXS[0], WORLD_MAXS[1], WORLD_MAXS[2], MAX_EDICTS);
  loadWorldHullToWasm(worldHull);
  const edicts = new JsEdicts(MAX_EDICTS);
  const links = []; for (let i = 0; i < MAX_EDICTS; i++) links.push({ prev: null, next: null, ent: null });
  const nodes = [];
  const root = createAreaNode(nodes, 0, WORLD_MINS, WORLD_MAXS);
  edicts.setf(0, F.SOLID, SOLID_BSP); x.edStoreFloat(0, F.SOLID, SOLID_BSP);
  return { edicts, links, root };
}

// === Section A: checkBottom -- random box entities scattered over the stepped
// floor (flat side, raised side, and straddling the 40-unit step edge), plus
// scattered SLIDEBOX/BBOX obstacles for the corner-solid quick-path too. =========
{
  const r = rng(0x6D0A1);
  const { edicts, links, root } = freshWorld();

  const NUM_ENTS = 40;
  for (let e = 2; e <= NUM_ENTS; e++) {
    const ox = r.f32(200) , oy = r.f32(200), oz = 30 + Math.abs(r.f32(40));
    const hx = Math.abs(r.f32(20)) + 3, hy = Math.abs(r.f32(20)) + 3, hz = Math.abs(r.f32(15)) + 3;
    const solid = r.int(2) === 0 ? SOLID_BBOX : SOLID_SLIDEBOX;
    setEntityBoth(edicts, e, ox, oy, oz, hx, hy, hz, solid, 0, 0);
    x.linkEdict(e); jsLinkEdict(edicts, links, root, e);
  }

  const chk = new Check('checkBottom.result');
  const SELF = 1;
  for (let iter = 0; iter < 20000; iter++) {
    const ox = r.f32(250), oy = r.f32(250);
    const oz = 0.5 + Math.abs(r.f32(45)); // near floor / near step top / mid-air
    const hx = Math.abs(r.f32(16)) + 2, hy = Math.abs(r.f32(16)) + 2, hz = Math.abs(r.f32(16)) + 2;
    setEntityBoth(edicts, SELF, ox, oy, oz, hx, hy, hz, SOLID_SLIDEBOX, 0, 0);
    x.linkEdict(SELF); jsLinkEdict(edicts, links, root, SELF);

    const w = x.checkBottom(SELF) ? 1 : 0;
    const j = jsCheckBottom(edicts, root, worldHull, SELF) ? 1 : 0;
    chk.intEq(w, j, `cb#${iter} ox=${ox.toFixed(2)} oy=${oy.toFixed(2)} oz=${oz.toFixed(2)}`);
  }
  results.push(chk.report());
}

// === Section B: movestep -- ground path, random start positions across the
// stepped floor + obstacle field, random move deltas sized to trigger step-up/
// step-down/blocked/partialground branches, random FL_PARTIALGROUND presets and
// relink true/false. ==============================================================
{
  const r = rng(0x6D0B1);
  const { edicts, links, root } = freshWorld();

  const NUM_ENTS = 40;
  for (let e = 2; e <= NUM_ENTS; e++) {
    const ox = r.f32(200), oy = r.f32(200), oz = 30 + Math.abs(r.f32(40));
    const hx = Math.abs(r.f32(20)) + 3, hy = Math.abs(r.f32(20)) + 3, hz = Math.abs(r.f32(15)) + 3;
    const solid = r.int(2) === 0 ? SOLID_BBOX : SOLID_SLIDEBOX;
    setEntityBoth(edicts, e, ox, oy, oz, hx, hy, hz, solid, 0, 0);
    x.linkEdict(e); jsLinkEdict(edicts, links, root, e);
  }

  const SELF = 1;
  const chk = {
    ret: new Check('movestep.return'), origin: new Check('movestep.origin'),
    flags: new Check('movestep.flags'), ground: new Check('movestep.groundentity'),
  };

  for (let iter = 0; iter < 20000; iter++) {
    const ox = r.f32(250), oy = r.f32(250);
    const oz = 0.05 + Math.abs(r.f32(30)); // start on/near the floor or step
    const hx = Math.abs(r.f32(14)) + 2, hy = Math.abs(r.f32(14)) + 2, hz = Math.abs(r.f32(14)) + 2;
    const partial = r.int(4) === 0 ? FL_PARTIALGROUND : 0;
    setEntityBoth(edicts, SELF, ox, oy, oz, hx, hy, hz, SOLID_SLIDEBOX, partial, 0);
    x.linkEdict(SELF); jsLinkEdict(edicts, links, root, SELF);

    const moveX = r.f32(48), moveY = r.f32(48);
    const relink = r.int(2) === 0;

    const w = x.movestep(SELF, moveX, moveY, relink);
    const j = jsMovestep(edicts, links, root, worldHull, SELF, moveX, moveY, relink);

    chk.ret.intEq(w, j, `ms#${iter} ret`);
    chk.origin.floatEq(x.edLoadFloat(SELF, F.ORIGIN), edicts.f(SELF, F.ORIGIN), `ms#${iter} origin.x`);
    chk.origin.floatEq(x.edLoadFloat(SELF, F.ORIGIN1), edicts.f(SELF, F.ORIGIN1), `ms#${iter} origin.y`);
    chk.origin.floatEq(x.edLoadFloat(SELF, F.ORIGIN2), edicts.f(SELF, F.ORIGIN2), `ms#${iter} origin.z`);
    chk.flags.floatEq(x.edLoadFloat(SELF, F.FLAGS), edicts.f(SELF, F.FLAGS), `ms#${iter} flags`);
    chk.ground.intEq(x.edLoadInt(SELF, F.GROUNDENTITY), edicts.i(SELF, F.GROUNDENTITY), `ms#${iter} groundentity`);
  }
  results.push(chk.ret.report(), chk.origin.report(), chk.flags.report(), chk.ground.report());
}

// === Section C: movestep -- swim/fly path, with and without an `enemy` set
// (random relative Z to hit the +-8 adjustment branches, and the enemy===0
// early-bail branch). No world obstacles needed on this path beyond the floor
// (fly/swim ignores checkBottom entirely). ========================================
{
  const r = rng(0x6D0C1);
  const { edicts, links, root } = freshWorld();
  const SELF = 1, ENEMY = 2;

  const chk = { ret: new Check('movestep.swimfly.return'), origin: new Check('movestep.swimfly.origin') };

  for (let iter = 0; iter < 20000; iter++) {
    const hasEnemy = r.int(3) !== 0;
    if (hasEnemy) {
      const ex = r.f32(300), ey = r.f32(300), ez = 20 + Math.abs(r.f32(80));
      setEntityBoth(edicts, ENEMY, ex, ey, ez, 16, 16, 16, SOLID_SLIDEBOX, 0, 0);
      x.linkEdict(ENEMY); jsLinkEdict(edicts, links, root, ENEMY);
    }
    const ox = r.f32(300), oy = r.f32(300), oz = 20 + Math.abs(r.f32(80));
    const hx = Math.abs(r.f32(14)) + 2, hy = Math.abs(r.f32(14)) + 2, hz = Math.abs(r.f32(14)) + 2;
    const flags = FL_FLY | (r.int(2) === 0 ? FL_SWIM : 0);
    setEntityBoth(edicts, SELF, ox, oy, oz, hx, hy, hz, SOLID_SLIDEBOX, flags, 0);
    syncIntField(edicts, SELF, 'ENEMY', hasEnemy ? ENEMY : 0); // entity field: int-typed, not float
    x.linkEdict(SELF); jsLinkEdict(edicts, links, root, SELF);

    const moveX = r.f32(40), moveY = r.f32(40);
    const relink = r.int(2) === 0;

    const w = x.movestep(SELF, moveX, moveY, relink);
    const j = jsMovestep(edicts, links, root, worldHull, SELF, moveX, moveY, relink);

    chk.ret.intEq(w, j, `msf#${iter} ret`);
    chk.origin.floatEq(x.edLoadFloat(SELF, F.ORIGIN), edicts.f(SELF, F.ORIGIN), `msf#${iter} origin.x`);
    chk.origin.floatEq(x.edLoadFloat(SELF, F.ORIGIN1), edicts.f(SELF, F.ORIGIN1), `msf#${iter} origin.y`);
    chk.origin.floatEq(x.edLoadFloat(SELF, F.ORIGIN2), edicts.f(SELF, F.ORIGIN2), `msf#${iter} origin.z`);
  }
  results.push(chk.ret.report(), chk.origin.report());
}

// === Section D: the full movetogoal chain (closeEnough / stepDirection /
// newChaseDir, host_random-driven) -- random actor/goal placement across the
// stepped floor + obstacle field, random ideal_yaw/enemy/dist. Exercises
// stepDirectionExport/closeEnoughExport/newChaseDirExport directly (not just
// through the movetogoal builtin) for finer-grained fault isolation. ============
{
  const r = rng(0x6D0D1);
  const { edicts, links, root } = freshWorld();

  const NUM_ENTS = 30;
  for (let e = 3; e <= NUM_ENTS; e++) {
    const ox = r.f32(200), oy = r.f32(200), oz = 30 + Math.abs(r.f32(40));
    const hx = Math.abs(r.f32(20)) + 3, hy = Math.abs(r.f32(20)) + 3, hz = Math.abs(r.f32(15)) + 3;
    const solid = r.int(2) === 0 ? SOLID_BBOX : SOLID_SLIDEBOX;
    setEntityBoth(edicts, e, ox, oy, oz, hx, hy, hz, solid, 0, 0);
    x.linkEdict(e); jsLinkEdict(edicts, links, root, e);
  }

  const ACTOR = 1, GOAL = 2;
  const chk = {
    origin: new Check('newChaseDir.origin'), yaw: new Check('newChaseDir.yaw'),
    idealyaw: new Check('newChaseDir.idealyaw'), flags: new Check('newChaseDir.flags'),
  };

  for (let iter = 0; iter < 10000; iter++) {
    const gox = r.f32(220), goy = r.f32(220), goz = 30 + Math.abs(r.f32(40));
    setEntityBoth(edicts, GOAL, gox, goy, goz, 20, 20, 20, SOLID_SLIDEBOX, 0, 0);
    x.linkEdict(GOAL); jsLinkEdict(edicts, links, root, GOAL);

    const aox = r.f32(220), aoy = r.f32(220), aoz = 0.1 + Math.abs(r.f32(30));
    const ideal = r.f32(360);
    const yawspeed = 10 + Math.abs(r.f32(30));
    setEntityBoth(edicts, ACTOR, aox, aoy, aoz, 16, 16, 24, SOLID_SLIDEBOX, 0, 0, { IDEAL_YAW: ideal, YAW_SPEED: yawspeed });
    syncScalarField(edicts, ACTOR, 'ANGLES1', r.f32(360));
    x.linkEdict(ACTOR); jsLinkEdict(edicts, links, root, ACTOR);

    const dist = 4 + Math.abs(r.f32(20));

    fillRand(r, 6);
    const savedRQ = RQ.slice();
    x.newChaseDirExport(ACTOR, GOAL, dist);
    RQ = savedRQ; RQI = 0;
    jsNewChaseDir(edicts, links, root, worldHull, ACTOR, GOAL, dist);

    chk.origin.floatEq(x.edLoadFloat(ACTOR, F.ORIGIN), edicts.f(ACTOR, F.ORIGIN), `ncd#${iter} origin.x`);
    chk.origin.floatEq(x.edLoadFloat(ACTOR, F.ORIGIN1), edicts.f(ACTOR, F.ORIGIN1), `ncd#${iter} origin.y`);
    chk.origin.floatEq(x.edLoadFloat(ACTOR, F.ORIGIN2), edicts.f(ACTOR, F.ORIGIN2), `ncd#${iter} origin.z`);
    chk.yaw.floatEq(x.edLoadFloat(ACTOR, F.ANGLES1), edicts.f(ACTOR, F.ANGLES1), `ncd#${iter} angles1`);
    chk.idealyaw.floatEq(x.edLoadFloat(ACTOR, F.IDEAL_YAW), edicts.f(ACTOR, F.IDEAL_YAW), `ncd#${iter} idealyaw`);
    chk.flags.floatEq(x.edLoadFloat(ACTOR, F.FLAGS), edicts.f(ACTOR, F.FLAGS), `ncd#${iter} flags`);
  }
  results.push(chk.origin.report(), chk.yaw.report(), chk.idealyaw.report(), chk.flags.report());
}

// === Section E: builtin-ABI wrappers -- pf_walkmove(#32) / pf_checkbottom(#40) /
// pf_movetogoal(#67), driven through the GLOBALS convention exactly like a QC
// caller would (self/PARM0/PARM1/RETURN). =========================================
{
  const r = rng(0x6D0E1);
  const { edicts, links, root } = freshWorld();
  const GLOBAL_SELF = 28, PARM0 = 4, PARM1 = 7, RETURN = 1;

  const NUM_ENTS = 30;
  for (let e = 3; e <= NUM_ENTS; e++) {
    const ox = r.f32(200), oy = r.f32(200), oz = 30 + Math.abs(r.f32(40));
    const hx = Math.abs(r.f32(20)) + 3, hy = Math.abs(r.f32(20)) + 3, hz = Math.abs(r.f32(15)) + 3;
    const solid = r.int(2) === 0 ? SOLID_BBOX : SOLID_SLIDEBOX;
    setEntityBoth(edicts, e, ox, oy, oz, hx, hy, hz, solid, 0, 0);
    x.linkEdict(e); jsLinkEdict(edicts, links, root, e);
  }

  // --- walkmove ---
  {
    const SELF = 1;
    const chk = { ret: new Check('pf_walkmove.return'), origin: new Check('pf_walkmove.origin') };
    for (let iter = 0; iter < 8000; iter++) {
      const ox = r.f32(250), oy = r.f32(250), oz = 0.05 + Math.abs(r.f32(30));
      const hx = Math.abs(r.f32(14)) + 2, hy = Math.abs(r.f32(14)) + 2, hz = Math.abs(r.f32(14)) + 2;
      const onground = r.int(4) !== 0 ? FL_ONGROUND : 0;
      setEntityBoth(edicts, SELF, ox, oy, oz, hx, hy, hz, SOLID_SLIDEBOX, onground, 0);
      x.linkEdict(SELF); jsLinkEdict(edicts, links, root, SELF);

      const yaw = r.f32(360), dist = r.f32(48);

      x.writeGlobalInt(GLOBAL_SELF, SELF);
      x.writeGlobalFloat(PARM0, Math.fround(yaw));
      x.writeGlobalFloat(PARM1, Math.fround(dist));
      x.pf_walkmove(x.globalsPtr());
      const wRet = x.readGlobalFloat(RETURN);

      // JS reference (pf.ts walkmove, transliterated inline: xfunction save/
      // restore excluded per header, self restore is a no-op ported verbatim).
      let jRet;
      const flags0 = edicts.f(SELF, F.FLAGS) | 0;
      if ((flags0 & (FL_ONGROUND | FL_FLY | FL_SWIM)) === 0) {
        jRet = 0.0;
      } else {
        const yawRad = yaw * Math.PI / 180.0;
        jRet = jsMovestep(edicts, links, root, worldHull, SELF, Math.cos(yawRad) * dist, Math.sin(yawRad) * dist, true);
      }

      chk.ret.floatEq(wRet, jRet, `wm#${iter} ret`);
      chk.origin.floatEq(x.edLoadFloat(SELF, F.ORIGIN), edicts.f(SELF, F.ORIGIN), `wm#${iter} origin.x`);
      chk.origin.floatEq(x.edLoadFloat(SELF, F.ORIGIN1), edicts.f(SELF, F.ORIGIN1), `wm#${iter} origin.y`);
      chk.origin.floatEq(x.edLoadFloat(SELF, F.ORIGIN2), edicts.f(SELF, F.ORIGIN2), `wm#${iter} origin.z`);
    }
    results.push(chk.ret.report(), chk.origin.report());
  }

  // --- checkbottom ---
  {
    const SELF = 1;
    const chk = new Check('pf_checkbottom.return');
    for (let iter = 0; iter < 8000; iter++) {
      const ox = r.f32(250), oy = r.f32(250), oz = 0.5 + Math.abs(r.f32(45));
      const hx = Math.abs(r.f32(16)) + 2, hy = Math.abs(r.f32(16)) + 2, hz = Math.abs(r.f32(16)) + 2;
      setEntityBoth(edicts, SELF, ox, oy, oz, hx, hy, hz, SOLID_SLIDEBOX, 0, 0);
      x.linkEdict(SELF); jsLinkEdict(edicts, links, root, SELF);

      x.writeGlobalInt(PARM0, SELF);
      x.pf_checkbottom(x.globalsPtr());
      const wRet = x.readGlobalFloat(RETURN);
      const jRet = jsCheckBottom(edicts, root, worldHull, SELF) ? 1.0 : 0.0;
      chk.floatEq(wRet, jRet, `cbi#${iter}`);
    }
    results.push(chk.report());
  }

  // --- movetogoal ---
  {
    const SELF = 1, GOAL = 2;
    const chk = {
      origin: new Check('pf_movetogoal.origin'), flags: new Check('pf_movetogoal.flags'),
      idealyaw: new Check('pf_movetogoal.idealyaw'),
    };
    for (let iter = 0; iter < 8000; iter++) {
      const gox = r.f32(220), goy = r.f32(220), goz = 30 + Math.abs(r.f32(40));
      setEntityBoth(edicts, GOAL, gox, goy, goz, 20, 20, 20, SOLID_SLIDEBOX, 0, 0);
      x.linkEdict(GOAL); jsLinkEdict(edicts, links, root, GOAL);

      const aox = r.f32(220), aoy = r.f32(220), aoz = 0.1 + Math.abs(r.f32(30));
      const ideal = r.f32(360);
      const onground = r.int(5) !== 0 ? FL_ONGROUND : 0;
      const hasEnemy = r.int(2) === 0;
      setEntityBoth(edicts, SELF, aox, aoy, aoz, 16, 16, 24, SOLID_SLIDEBOX, onground, 0,
        { IDEAL_YAW: ideal, YAW_SPEED: 20 });
      syncIntField(edicts, SELF, 'GOALENTITY', GOAL); // entity fields: int-typed, not float
      syncIntField(edicts, SELF, 'ENEMY', hasEnemy ? GOAL : 0);
      x.linkEdict(SELF); jsLinkEdict(edicts, links, root, SELF);

      // fround: pf_movetogoal reads dist via gf(g, PARM0) (an f32 global,
      // widened to f64) -- the JS reference must see the SAME f32-quantized
      // value, not full f64 precision, or origin math downstream (movestep's
      // cos(yaw)*dist / sin(yaw)*dist) diverges by an ulp.
      const dist = Math.fround(4 + Math.abs(r.f32(20)));

      fillRand(r, 6);
      const savedRQ = RQ.slice();
      x.writeGlobalInt(GLOBAL_SELF, SELF);
      x.writeGlobalFloat(PARM0, Math.fround(dist));
      x.pf_movetogoal(x.globalsPtr());
      RQ = savedRQ; RQI = 0;
      jsMoveToGoal(edicts, links, root, worldHull, SELF, dist);

      chk.origin.floatEq(x.edLoadFloat(SELF, F.ORIGIN), edicts.f(SELF, F.ORIGIN), `mtg#${iter} origin.x`);
      chk.origin.floatEq(x.edLoadFloat(SELF, F.ORIGIN1), edicts.f(SELF, F.ORIGIN1), `mtg#${iter} origin.y`);
      chk.origin.floatEq(x.edLoadFloat(SELF, F.ORIGIN2), edicts.f(SELF, F.ORIGIN2), `mtg#${iter} origin.z`);
      chk.flags.floatEq(x.edLoadFloat(SELF, F.FLAGS), edicts.f(SELF, F.FLAGS), `mtg#${iter} flags`);
      chk.idealyaw.floatEq(x.edLoadFloat(SELF, F.IDEAL_YAW), edicts.f(SELF, F.IDEAL_YAW), `mtg#${iter} idealyaw`);
    }
    results.push(chk.origin.report(), chk.flags.report(), chk.idealyaw.report());
  }
}

const ok = results.every(Boolean);
process.exit(ok ? 0 : 1);
