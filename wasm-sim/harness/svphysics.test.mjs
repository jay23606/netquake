// Golden parity test: svphysics.ts (SV_ClipVelocity/SV_CheckVelocity/SV_FlyMove/
// SV_PushEntity/SV_Physics_Toss motion core) vs a JS reference transliterated
// inline from src/engine/sv.ts, matching the svmove.test.mjs / builtins_world.
// test.mjs self-contained-duplication pattern (areanode tree + link machinery +
// move() copied in again here per project convention).
//
// Scope tested (see svphysics.ts's header comment for the full exclusion list):
//   - clipVelocity: pure vector math.
//   - checkVelocity: NaN->0 + maxvelocity clamp on velocity/origin.
//   - flyMove: the up-to-4-bump slide loop, INCLUDING inline FL_ONGROUND/
//     groundentity on a SOLID_BSP hit, EXCLUDING impact()/touch dispatch.
//   - pushEntity: move + setorigin(raw) + linkEdict, EXCLUDING impact()/touch.
//   - physicsToss: onground-early-return + checkVelocity + conditional gravity +
//     angle integration + pushEntity + bounce/stick, EXCLUDING SV_RunThink's
//     think() dispatch and checkWaterTransition.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { rng, Check } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = join(HERE, '..', 'build', 'svphysics.wasm');

async function loadWasm() {
  const bytes = readFileSync(WASM_PATH);
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: { abort: (msg, file, line, col) => { throw new Error(`svphysics.wasm abort @${line}:${col}`); } },
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

// --- bit-exact f64 checker (raw trace/vector fields, never f32-quantized) ------
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
// JS reference model (src/engine/sv.ts, transliterated)
// ================================================================================

// --- entvars field indices (src/engine/pr.ts entvars, vanilla layout) ---------
const F = {
  ABSMIN: 1, ABSMIN1: 2, ABSMIN2: 3, ABSMAX: 4, ABSMAX1: 5, ABSMAX2: 6,
  MOVETYPE: 8, SOLID: 9, ORIGIN: 10, ORIGIN1: 11, ORIGIN2: 12,
  VELOCITY: 16, VELOCITY1: 17, VELOCITY2: 18,
  ANGLES: 19, ANGLES1: 20, ANGLES2: 21,
  AVELOCITY: 22, AVELOCITY1: 23, AVELOCITY2: 24,
  SKIN: 31, MINS: 33, MINS1: 34, MINS2: 35, MAXS: 36, MAXS1: 37, MAXS2: 38,
  SIZE: 39, GROUNDENTITY: 47, FLAGS: 76, OWNER: 95,
  GRAVITY_TEST: 90, // stand-in "gravity" field slot for the dynamic-field test cases
};
const EDICT_SIZE_WORDS = 100;

const SOLID_NOT = 0, SOLID_TRIGGER = 1, SOLID_BBOX = 2, SOLID_SLIDEBOX = 3, SOLID_BSP = 4;
const FL_MONSTER = 32, FL_ITEM = 256, FL_ONGROUND = 512;
const MOVE_NORMAL = 0, MOVE_NOMONSTERS = 1, MOVE_MISSILE = 2;
const MOVE_TYPE_FLY = 5, MOVE_TYPE_FLYMISSILE = 9, MOVE_TYPE_BOUNCE = 10;
const CONTENTS_EMPTY = -1, CONTENTS_SOLID = -2;

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

// --- src/engine/sv.ts SV_ClipVelocity/SV_CheckVelocity/SV_FlyMove/SV_PushEntity/
// SV_Physics_Toss (motion slice) -------------------------------------------------
function jsClipVelocity(vel, normal, overbounce) {
  const backoff = (vel[0] * normal[0] + vel[1] * normal[1] + vel[2] * normal[2]) * overbounce;
  const out = [0, 0, 0];
  out[0] = vel[0] - normal[0] * backoff; if (out[0] > -0.1 && out[0] < 0.1) out[0] = 0.0;
  out[1] = vel[1] - normal[1] * backoff; if (out[1] > -0.1 && out[1] < 0.1) out[1] = 0.0;
  out[2] = vel[2] - normal[2] * backoff; if (out[2] > -0.1 && out[2] < 0.1) out[2] = 0.0;
  return out;
}

function jsCheckVelocity(edicts, e, maxVelocity) {
  for (let i = 0; i <= 2; i++) {
    let v = edicts.f(e, F.VELOCITY + i);
    if (Number.isNaN(v)) v = 0.0;
    const o = edicts.f(e, F.ORIGIN + i);
    if (Number.isNaN(o)) edicts.setf(e, F.ORIGIN + i, 0.0);
    if (v > maxVelocity) v = maxVelocity;
    else if (v < -maxVelocity) v = -maxVelocity;
    edicts.setf(e, F.VELOCITY + i, v);
  }
}

function jsFlyMove(edicts, root, worldHull, e, time) {
  const mins = [edicts.f(e, F.MINS), edicts.f(e, F.MINS1), edicts.f(e, F.MINS2)];
  const maxs = [edicts.f(e, F.MAXS), edicts.f(e, F.MAXS1), edicts.f(e, F.MAXS2)];
  const primalVel = [edicts.f(e, F.VELOCITY), edicts.f(e, F.VELOCITY1), edicts.f(e, F.VELOCITY2)];
  let origVel = primalVel.slice();
  let numplanes = 0;
  let timeLeft = time;
  let blocked = 0;
  const planes = [];

  for (let bumpcount = 0; bumpcount <= 3; bumpcount++) {
    const curVel = [edicts.f(e, F.VELOCITY), edicts.f(e, F.VELOCITY1), edicts.f(e, F.VELOCITY2)];
    if (curVel[0] === 0.0 && curVel[1] === 0.0 && curVel[2] === 0.0) break;

    const origin = [edicts.f(e, F.ORIGIN), edicts.f(e, F.ORIGIN1), edicts.f(e, F.ORIGIN2)];
    const end = [origin[0] + timeLeft * curVel[0], origin[1] + timeLeft * curVel[1], origin[2] + timeLeft * curVel[2]];

    const trace = jsMove(edicts, root, worldHull, origin, mins, maxs, end, MOVE_NORMAL, e);

    if (trace.allsolid === true) {
      edicts.setf(e, F.VELOCITY, 0.0); edicts.setf(e, F.VELOCITY1, 0.0); edicts.setf(e, F.VELOCITY2, 0.0);
      return 3;
    }

    if (trace.fraction > 0.0) {
      edicts.setf(e, F.ORIGIN, trace.endpos[0]); edicts.setf(e, F.ORIGIN1, trace.endpos[1]); edicts.setf(e, F.ORIGIN2, trace.endpos[2]);
      origVel = [edicts.f(e, F.VELOCITY), edicts.f(e, F.VELOCITY1), edicts.f(e, F.VELOCITY2)];
      numplanes = 0;
      if (trace.fraction === 1.0) break;
    }

    const planeN = trace.plane.normal;
    const traceEnt = trace.ent;
    if (planeN[2] > 0.7) {
      blocked |= 1;
      if (traceEnt != null && (edicts.f(traceEnt, F.SOLID) | 0) === SOLID_BSP) {
        const flags = edicts.f(e, F.FLAGS) | 0;
        edicts.setf(e, F.FLAGS, flags | FL_ONGROUND);
        edicts.seti(e, F.GROUNDENTITY, traceEnt);
      }
    } else if (planeN[2] === 0.0) {
      blocked |= 2;
    }

    timeLeft -= timeLeft * trace.fraction;

    if (numplanes >= 5) {
      edicts.setf(e, F.VELOCITY, 0.0); edicts.setf(e, F.VELOCITY1, 0.0); edicts.setf(e, F.VELOCITY2, 0.0);
      return 3;
    }
    planes[numplanes] = [planeN[0], planeN[1], planeN[2]];
    numplanes++;

    let i, j, winningNv;
    for (i = 0; i < numplanes; i++) {
      const nv = jsClipVelocity(origVel, planes[i], 1.0);
      winningNv = nv;
      for (j = 0; j < numplanes; j++) {
        if (j !== i) {
          const p = planes[j];
          if ((nv[0] * p[0] + nv[1] * p[1] + nv[2] * p[2]) < 0.0) break;
        }
      }
      if (j === numplanes) break;
    }

    if (i !== numplanes) {
      edicts.setf(e, F.VELOCITY, winningNv[0]); edicts.setf(e, F.VELOCITY1, winningNv[1]); edicts.setf(e, F.VELOCITY2, winningNv[2]);
    } else {
      if (numplanes !== 2) {
        edicts.setf(e, F.VELOCITY, 0.0); edicts.setf(e, F.VELOCITY1, 0.0); edicts.setf(e, F.VELOCITY2, 0.0);
        return 7;
      }
      const dir = [
        planes[0][1] * planes[1][2] - planes[0][2] * planes[1][1],
        planes[0][2] * planes[1][0] - planes[0][0] * planes[1][2],
        planes[0][0] * planes[1][1] - planes[0][1] * planes[1][0],
      ];
      const curV = [edicts.f(e, F.VELOCITY), edicts.f(e, F.VELOCITY1), edicts.f(e, F.VELOCITY2)];
      const d = dir[0] * curV[0] + dir[1] * curV[1] + dir[2] * curV[2];
      edicts.setf(e, F.VELOCITY, dir[0] * d); edicts.setf(e, F.VELOCITY1, dir[1] * d); edicts.setf(e, F.VELOCITY2, dir[2] * d);
    }

    const finalV = [edicts.f(e, F.VELOCITY), edicts.f(e, F.VELOCITY1), edicts.f(e, F.VELOCITY2)];
    if ((finalV[0] * primalVel[0] + finalV[1] * primalVel[1] + finalV[2] * primalVel[2]) <= 0.0) {
      edicts.setf(e, F.VELOCITY, 0.0); edicts.setf(e, F.VELOCITY1, 0.0); edicts.setf(e, F.VELOCITY2, 0.0);
      return blocked;
    }
  }
  return blocked;
}

function jsPushEntity(edicts, links, root, worldHull, e, push) {
  const ox = edicts.f(e, F.ORIGIN), oy = edicts.f(e, F.ORIGIN1), oz = edicts.f(e, F.ORIGIN2);
  const end = [ox + push[0], oy + push[1], oz + push[2]];
  const mins = [edicts.f(e, F.MINS), edicts.f(e, F.MINS1), edicts.f(e, F.MINS2)];
  const maxs = [edicts.f(e, F.MAXS), edicts.f(e, F.MAXS1), edicts.f(e, F.MAXS2)];
  const solid = edicts.f(e, F.SOLID) | 0;
  const movetype = edicts.f(e, F.MOVETYPE) | 0;
  let type;
  if (movetype === MOVE_TYPE_FLYMISSILE) type = MOVE_MISSILE;
  else if (solid === SOLID_TRIGGER || solid === SOLID_NOT) type = MOVE_NOMONSTERS;
  else type = MOVE_NORMAL;

  const trace = jsMove(edicts, root, worldHull, [ox, oy, oz], mins, maxs, end, type, e);
  edicts.setf(e, F.ORIGIN, trace.endpos[0]); edicts.setf(e, F.ORIGIN1, trace.endpos[1]); edicts.setf(e, F.ORIGIN2, trace.endpos[2]);
  jsLinkEdict(edicts, links, root, e);
  return trace;
}

function jsAddGravity(edicts, e, frametime, gravityCvar, gravityFieldIdx) {
  let entGravity = 1.0;
  if (gravityFieldIdx >= 0) {
    const g = edicts.f(e, gravityFieldIdx);
    entGravity = (g !== 0.0) ? g : 1.0;
  }
  const v2 = edicts.f(e, F.VELOCITY2);
  edicts.setf(e, F.VELOCITY2, v2 - entGravity * gravityCvar * frametime);
}

function jsPhysicsToss(edicts, links, root, worldHull, e, frametime, maxVelocity, gravityCvar, gravityFieldIdx) {
  const flags0 = edicts.f(e, F.FLAGS) | 0;
  if ((flags0 & FL_ONGROUND) !== 0) return;

  jsCheckVelocity(edicts, e, maxVelocity);

  const movetype = edicts.f(e, F.MOVETYPE) | 0;
  if (movetype !== MOVE_TYPE_FLY && movetype !== MOVE_TYPE_FLYMISSILE) {
    jsAddGravity(edicts, e, frametime, gravityCvar, gravityFieldIdx);
  }

  const aX = edicts.f(e, F.ANGLES), aY = edicts.f(e, F.ANGLES1), aZ = edicts.f(e, F.ANGLES2);
  const avX = edicts.f(e, F.AVELOCITY), avY = edicts.f(e, F.AVELOCITY1), avZ = edicts.f(e, F.AVELOCITY2);
  edicts.setf(e, F.ANGLES, aX + frametime * avX);
  edicts.setf(e, F.ANGLES1, aY + frametime * avY);
  edicts.setf(e, F.ANGLES2, aZ + frametime * avZ);

  const velX = edicts.f(e, F.VELOCITY), velY = edicts.f(e, F.VELOCITY1), velZ = edicts.f(e, F.VELOCITY2);
  const push = [velX * frametime, velY * frametime, velZ * frametime];
  const trace = jsPushEntity(edicts, links, root, worldHull, e, push);

  if (trace.fraction === 1.0) return;

  const curVel = [edicts.f(e, F.VELOCITY), edicts.f(e, F.VELOCITY1), edicts.f(e, F.VELOCITY2)];
  const overbounce = (movetype === MOVE_TYPE_BOUNCE) ? 1.5 : 1.0;
  const nv = jsClipVelocity(curVel, trace.plane.normal, overbounce);
  edicts.setf(e, F.VELOCITY, nv[0]); edicts.setf(e, F.VELOCITY1, nv[1]); edicts.setf(e, F.VELOCITY2, nv[2]);

  if (trace.plane.normal[2] > 0.7) {
    if (nv[2] < 60.0 || movetype !== MOVE_TYPE_BOUNCE) {
      const flags = edicts.f(e, F.FLAGS) | 0;
      edicts.setf(e, F.FLAGS, flags | FL_ONGROUND);
      edicts.seti(e, F.GROUNDENTITY, trace.ent);
      edicts.setf(e, F.VELOCITY, 0.0); edicts.setf(e, F.VELOCITY1, 0.0); edicts.setf(e, F.VELOCITY2, 0.0);
      edicts.setf(e, F.AVELOCITY, 0.0); edicts.setf(e, F.AVELOCITY1, 0.0); edicts.setf(e, F.AVELOCITY2, 0.0);
    }
  }
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

// === Section A: clipVelocity -- random vel/normal/overbounce, no entities. ======
{
  const r = rng(0x5F10A1);
  const chk = new CheckF64('clipVelocity');
  for (let iter = 0; iter < 20000; iter++) {
    const vel = [r.f32(2000), r.f32(2000), r.f32(2000)];
    let normal;
    const roll = r.int(3);
    if (roll === 0) {
      // near-unit axis-ish normal (typical trace-plane shape)
      normal = [0, 0, 0];
      normal[r.int(3)] = r.int(2) === 0 ? 1.0 : -1.0;
    } else {
      normal = [r.f32(1.5), r.f32(1.5), r.f32(1.5)];
    }
    const overbounce = r.int(4) === 0 ? 1.0 : (r.int(3) === 0 ? 1.5 : r.f32(3));

    x.clipVelocity(vel[0], vel[1], vel[2], normal[0], normal[1], normal[2], overbounce);
    const w = [x.clipVelocityOutX(), x.clipVelocityOutY(), x.clipVelocityOutZ()];
    const j = jsClipVelocity(vel, normal, overbounce);
    chk.eq(w[0], j[0], `cv#${iter} x`); chk.eq(w[1], j[1], `cv#${iter} y`); chk.eq(w[2], j[2], `cv#${iter} z`);
  }
  results.push(chk.report());
}

// === Section B: checkVelocity -- NaN injection + over-max clamp on velocity and
// origin, thousands of random entities/trials. ===================================
{
  const r = rng(0x5F10B1);
  x.initEdicts(MAX_EDICTS, EDICT_SIZE_WORDS);
  const edicts = new JsEdicts(MAX_EDICTS);

  const chk = new Check('checkVelocity.fields');
  for (let trial = 0; trial < 20000; trial++) {
    const e = 1 + r.int(50);
    const maxVelocity = 1000 + r.f32(1500);
    for (let i = 0; i <= 2; i++) {
      const roll = r.int(10);
      const v = roll === 0 ? NaN : r.f32(3000);
      const oroll = r.int(10);
      const o = oroll === 0 ? NaN : r.f32(3000);
      edicts.setf(e, F.VELOCITY + i, v); x.edStoreFloat(e, F.VELOCITY + i, v);
      edicts.setf(e, F.ORIGIN + i, o); x.edStoreFloat(e, F.ORIGIN + i, o);
    }
    x.checkVelocity(e, maxVelocity);
    jsCheckVelocity(edicts, e, maxVelocity);
    for (const f of [F.VELOCITY, F.VELOCITY1, F.VELOCITY2, F.ORIGIN, F.ORIGIN1, F.ORIGIN2]) {
      chk.floatEq(x.edLoadFloat(e, f), edicts.f(e, f), `trial#${trial} e=${e} f=${f}`);
    }
  }
  results.push(chk.report());
}

// === Section C: flyMove -- dense obstacle cluster + closed world box (world solid
// = SOLID_BSP so the FL_ONGROUND/groundentity-on-world-hit branch is exercised
// too), a reseeded "mover" entity per trial with random velocity, exercising real
// multi-bump slides + crease stops + allsolid/max-planes paths. ===================
{
  const r = rng(0x5F10C1);
  x.initEdicts(MAX_EDICTS, EDICT_SIZE_WORDS);
  x.initAreaTree(WORLD_MINS[0], WORLD_MINS[1], WORLD_MINS[2], WORLD_MAXS[0], WORLD_MAXS[1], WORLD_MAXS[2], MAX_EDICTS);
  const edicts = new JsEdicts(MAX_EDICTS);
  const links = []; for (let i = 0; i < MAX_EDICTS; i++) links.push({ prev: null, next: null, ent: null });
  const nodes = [];
  const root = createAreaNode(nodes, 0, WORLD_MINS, WORLD_MAXS);

  const worldHull = makeBoxHull([-300, -300, -300], [300, 300, 300]);
  loadWorldHullToWasm(worldHull);
  // world edict (#0) must be SOLID_BSP for the flyMove onground-on-world branch.
  edicts.setf(0, F.SOLID, SOLID_BSP); x.edStoreFloat(0, F.SOLID, SOLID_BSP);

  const NUM_ENTS = 60;
  const CLUSTER = 150;
  for (let e = 2; e <= NUM_ENTS; e++) {
    const ox = r.f32(CLUSTER), oy = r.f32(CLUSTER), oz = r.f32(CLUSTER);
    const hx = Math.abs(r.f32(25)) + 4, hy = Math.abs(r.f32(25)) + 4, hz = Math.abs(r.f32(25)) + 4;
    const solid = r.int(9) === 0 ? SOLID_NOT : (r.int(2) === 0 ? SOLID_BBOX : SOLID_SLIDEBOX);
    setEntityBoth(edicts, e, ox, oy, oz, hx, hy, hz, solid, 0, 0);
    x.linkEdict(e); jsLinkEdict(edicts, links, root, e);
  }

  const MOVER = 1;
  const chk = {
    origin: new Check('flyMove.origin'), velocity: new Check('flyMove.velocity'),
    flags: new Check('flyMove.flags'), ground: new Check('flyMove.groundentity'), blocked: new Check('flyMove.blocked'),
  };

  for (let iter = 0; iter < 20000; iter++) {
    const ox = r.f32(CLUSTER * 1.2), oy = r.f32(CLUSTER * 1.2), oz = r.f32(CLUSTER * 1.2);
    const hx = Math.abs(r.f32(15)) + 2, hy = Math.abs(r.f32(15)) + 2, hz = Math.abs(r.f32(15)) + 2;
    const vroll = r.int(12);
    const vel = vroll === 0 ? [0, 0, 0] : [r.f32(400), r.f32(400), r.f32(400)];

    setEntityBoth(edicts, MOVER, ox, oy, oz, hx, hy, hz, SOLID_SLIDEBOX, 0, 0);
    edicts.setf(MOVER, F.VELOCITY, vel[0]); edicts.setf(MOVER, F.VELOCITY1, vel[1]); edicts.setf(MOVER, F.VELOCITY2, vel[2]);
    edicts.seti(MOVER, F.GROUNDENTITY, 0);
    x.edStoreFloat(MOVER, F.VELOCITY, vel[0]); x.edStoreFloat(MOVER, F.VELOCITY1, vel[1]); x.edStoreFloat(MOVER, F.VELOCITY2, vel[2]);
    x.edStoreInt(MOVER, F.GROUNDENTITY, 0);
    x.linkEdict(MOVER); jsLinkEdict(edicts, links, root, MOVER);

    const t = 0.02 + Math.abs(r.f32(0.15));

    const wBlocked = x.flyMove(MOVER, t);
    const jBlocked = jsFlyMove(edicts, root, worldHull, MOVER, t);

    chk.blocked.intEq(wBlocked, jBlocked, `fm#${iter} blocked`);
    chk.origin.floatEq(x.edLoadFloat(MOVER, F.ORIGIN), edicts.f(MOVER, F.ORIGIN), `fm#${iter} origin.x`);
    chk.origin.floatEq(x.edLoadFloat(MOVER, F.ORIGIN1), edicts.f(MOVER, F.ORIGIN1), `fm#${iter} origin.y`);
    chk.origin.floatEq(x.edLoadFloat(MOVER, F.ORIGIN2), edicts.f(MOVER, F.ORIGIN2), `fm#${iter} origin.z`);
    chk.velocity.floatEq(x.edLoadFloat(MOVER, F.VELOCITY), edicts.f(MOVER, F.VELOCITY), `fm#${iter} vel.x`);
    chk.velocity.floatEq(x.edLoadFloat(MOVER, F.VELOCITY1), edicts.f(MOVER, F.VELOCITY1), `fm#${iter} vel.y`);
    chk.velocity.floatEq(x.edLoadFloat(MOVER, F.VELOCITY2), edicts.f(MOVER, F.VELOCITY2), `fm#${iter} vel.z`);
    chk.flags.floatEq(x.edLoadFloat(MOVER, F.FLAGS), edicts.f(MOVER, F.FLAGS), `fm#${iter} flags`);
    chk.ground.intEq(x.edLoadInt(MOVER, F.GROUNDENTITY), edicts.i(MOVER, F.GROUNDENTITY), `fm#${iter} groundentity`);
  }
  results.push(chk.origin.report(), chk.velocity.report(), chk.flags.report(), chk.ground.report(), chk.blocked.report());
}

// === Section D: pushEntity -- random pushes through the same dense-cluster world,
// cycling movetype/solid to hit all three MOVE.* branches (normal/nomonsters/
// missile), checking both the resulting origin AND the raw f64 trace fields still
// live in svmove's own getters afterward. ========================================
{
  const r = rng(0x5F10D1);
  x.initEdicts(MAX_EDICTS, EDICT_SIZE_WORDS);
  x.initAreaTree(WORLD_MINS[0], WORLD_MINS[1], WORLD_MINS[2], WORLD_MAXS[0], WORLD_MAXS[1], WORLD_MAXS[2], MAX_EDICTS);
  const edicts = new JsEdicts(MAX_EDICTS);
  const links = []; for (let i = 0; i < MAX_EDICTS; i++) links.push({ prev: null, next: null, ent: null });
  const nodes = [];
  const root = createAreaNode(nodes, 0, WORLD_MINS, WORLD_MAXS);

  const worldHull = makeBoxHull([-300, -300, -300], [300, 300, 300]);
  loadWorldHullToWasm(worldHull);
  edicts.setf(0, F.SOLID, SOLID_BSP); x.edStoreFloat(0, F.SOLID, SOLID_BSP);

  const NUM_ENTS = 60;
  const CLUSTER = 150;
  for (let e = 2; e <= NUM_ENTS; e++) {
    const ox = r.f32(CLUSTER), oy = r.f32(CLUSTER), oz = r.f32(CLUSTER);
    const hx = Math.abs(r.f32(25)) + 4, hy = Math.abs(r.f32(25)) + 4, hz = Math.abs(r.f32(25)) + 4;
    const solid = r.int(9) === 0 ? SOLID_NOT : (r.int(2) === 0 ? SOLID_BBOX : SOLID_SLIDEBOX);
    setEntityBoth(edicts, e, ox, oy, oz, hx, hy, hz, solid, 0, 0);
    x.linkEdict(e); jsLinkEdict(edicts, links, root, e);
  }

  const MOVER = 1;
  const chk = { origin: new Check('pushEntity.origin'), trace: new CheckF64('pushEntity.trace') };

  for (let iter = 0; iter < 20000; iter++) {
    const ox = r.f32(CLUSTER * 1.2), oy = r.f32(CLUSTER * 1.2), oz = r.f32(CLUSTER * 1.2);
    const hx = Math.abs(r.f32(15)) + 2, hy = Math.abs(r.f32(15)) + 2, hz = Math.abs(r.f32(15)) + 2;
    const solidRoll = r.int(3);
    const solid = solidRoll === 0 ? SOLID_TRIGGER : (solidRoll === 1 ? SOLID_NOT : SOLID_SLIDEBOX);
    const mtRoll = r.int(4);
    const movetype = mtRoll === 0 ? MOVE_TYPE_FLYMISSILE : 6; // 6 = MOVE_TYPE.toss (irrelevant beyond flymissile check)

    setEntityBoth(edicts, MOVER, ox, oy, oz, hx, hy, hz, solid, 0, 0);
    edicts.setf(MOVER, F.MOVETYPE, movetype); x.edStoreFloat(MOVER, F.MOVETYPE, movetype);
    x.linkEdict(MOVER); jsLinkEdict(edicts, links, root, MOVER);

    const push = [r.f32(80), r.f32(80), r.f32(80)];

    x.pushEntity(MOVER, push[0], push[1], push[2]);
    const j = jsPushEntity(edicts, links, root, worldHull, MOVER, push);

    chk.origin.floatEq(x.edLoadFloat(MOVER, F.ORIGIN), edicts.f(MOVER, F.ORIGIN), `pe#${iter} origin.x`);
    chk.origin.floatEq(x.edLoadFloat(MOVER, F.ORIGIN1), edicts.f(MOVER, F.ORIGIN1), `pe#${iter} origin.y`);
    chk.origin.floatEq(x.edLoadFloat(MOVER, F.ORIGIN2), edicts.f(MOVER, F.ORIGIN2), `pe#${iter} origin.z`);
    chk.trace.eq(x.moveTraceFraction(), j.fraction, `pe#${iter} trace.fraction`);
    chk.trace.eq(x.moveTraceEndX(), j.endpos[0], `pe#${iter} trace.endpos.x`);
    chk.trace.eq(x.moveTraceEndY(), j.endpos[1], `pe#${iter} trace.endpos.y`);
    chk.trace.eq(x.moveTraceEndZ(), j.endpos[2], `pe#${iter} trace.endpos.z`);
    chk.trace.eq(x.moveTraceEnt() === -1 ? null : x.moveTraceEnt(), j.ent, `pe#${iter} trace.ent`);
  }
  results.push(chk.origin.report(), chk.trace.report());
}

// === Section E: physicsToss -- gravity arcs into a floor + scattered obstacle
// slabs, self reseeded every trial (varied movetype: toss/bounce/fly/flymissile,
// occasional pre-set FL_ONGROUND to exercise the early-return, occasional dynamic
// "gravity" field). ================================================================
{
  const r = rng(0x5F10E1);
  x.initEdicts(MAX_EDICTS, EDICT_SIZE_WORDS);
  x.initAreaTree(WORLD_MINS[0], WORLD_MINS[1], WORLD_MINS[2], WORLD_MAXS[0], WORLD_MAXS[1], WORLD_MAXS[2], MAX_EDICTS);
  const edicts = new JsEdicts(MAX_EDICTS);
  const links = []; for (let i = 0; i < MAX_EDICTS; i++) links.push({ prev: null, next: null, ent: null });
  const nodes = [];
  const root = createAreaNode(nodes, 0, WORLD_MINS, WORLD_MAXS);

  const worldHull = makeFloorHull(-180);
  loadWorldHullToWasm(worldHull);
  edicts.setf(0, F.SOLID, SOLID_BSP); x.edStoreFloat(0, F.SOLID, SOLID_BSP);

  const NUM_ENTS = 60;
  for (let e = 2; e <= NUM_ENTS; e++) {
    const ox = r.f32(300), oy = r.f32(300), oz = r.f32(150);
    const flat = r.int(2) === 0;
    const hx = flat ? (Math.abs(r.f32(150)) + 20) : (Math.abs(r.f32(30)) + 3);
    const hy = flat ? (Math.abs(r.f32(150)) + 20) : (Math.abs(r.f32(30)) + 3);
    const hz = flat ? (Math.abs(r.f32(8)) + 2) : (Math.abs(r.f32(30)) + 3);
    const solid = r.int(9) === 0 ? SOLID_NOT : (r.int(2) === 0 ? SOLID_BBOX : SOLID_SLIDEBOX);
    setEntityBoth(edicts, e, ox, oy, oz, hx, hy, hz, solid, 0, 0);
    x.linkEdict(e); jsLinkEdict(edicts, links, root, e);
  }

  const SELF = 1;
  const chk = {
    origin: new Check('physicsToss.origin'), velocity: new Check('physicsToss.velocity'),
    angles: new Check('physicsToss.angles'), avelocity: new Check('physicsToss.avelocity'),
    flags: new Check('physicsToss.flags'), ground: new Check('physicsToss.groundentity'),
  };

  for (let iter = 0; iter < 20000; iter++) {
    const sx = r.f32(400), sy = r.f32(400), sz = r.f32(120);
    const hx = Math.abs(r.f32(20)) + 2, hy = Math.abs(r.f32(20)) + 2, hz = Math.abs(r.f32(20)) + 2;
    const mtRoll = r.int(10);
    const movetype = mtRoll === 0 ? MOVE_TYPE_FLY : (mtRoll === 1 ? MOVE_TYPE_FLYMISSILE : (mtRoll < 5 ? MOVE_TYPE_BOUNCE : 6));
    const onground = r.int(8) === 0;
    const flags0 = onground ? FL_ONGROUND : 0;
    const vel = [r.f32(300), r.f32(300), r.f32(250)];
    const angles = [r.f32(180), r.f32(180), r.f32(180)];
    const avel = [r.f32(200), r.f32(200), r.f32(200)];
    const frametime = 0.02 + Math.abs(r.f32(0.08));
    const maxVelocity = 2000 + r.f32(500);
    const gravityCvar = 700 + r.f32(200);
    const hasGravityField = r.int(3) === 0;
    const gravityFieldIdx = hasGravityField ? F.GRAVITY_TEST : -1;
    const gravityVal = hasGravityField ? (r.int(4) === 0 ? 0.0 : r.f32(2)) : 0.0;

    setEntityBoth(edicts, SELF, sx, sy, sz, hx, hy, hz, SOLID_SLIDEBOX, flags0, 0);
    edicts.setf(SELF, F.MOVETYPE, movetype); x.edStoreFloat(SELF, F.MOVETYPE, movetype);
    edicts.setf(SELF, F.VELOCITY, vel[0]); edicts.setf(SELF, F.VELOCITY1, vel[1]); edicts.setf(SELF, F.VELOCITY2, vel[2]);
    x.edStoreFloat(SELF, F.VELOCITY, vel[0]); x.edStoreFloat(SELF, F.VELOCITY1, vel[1]); x.edStoreFloat(SELF, F.VELOCITY2, vel[2]);
    edicts.setf(SELF, F.ANGLES, angles[0]); edicts.setf(SELF, F.ANGLES1, angles[1]); edicts.setf(SELF, F.ANGLES2, angles[2]);
    x.edStoreFloat(SELF, F.ANGLES, angles[0]); x.edStoreFloat(SELF, F.ANGLES1, angles[1]); x.edStoreFloat(SELF, F.ANGLES2, angles[2]);
    edicts.setf(SELF, F.AVELOCITY, avel[0]); edicts.setf(SELF, F.AVELOCITY1, avel[1]); edicts.setf(SELF, F.AVELOCITY2, avel[2]);
    x.edStoreFloat(SELF, F.AVELOCITY, avel[0]); x.edStoreFloat(SELF, F.AVELOCITY1, avel[1]); x.edStoreFloat(SELF, F.AVELOCITY2, avel[2]);
    edicts.setf(SELF, F.GRAVITY_TEST, gravityVal); x.edStoreFloat(SELF, F.GRAVITY_TEST, gravityVal);
    edicts.seti(SELF, F.GROUNDENTITY, 0); x.edStoreInt(SELF, F.GROUNDENTITY, 0);
    x.linkEdict(SELF); jsLinkEdict(edicts, links, root, SELF);

    x.physicsToss(SELF, frametime, maxVelocity, gravityCvar, gravityFieldIdx);
    jsPhysicsToss(edicts, links, root, worldHull, SELF, frametime, maxVelocity, gravityCvar, gravityFieldIdx);

    chk.origin.floatEq(x.edLoadFloat(SELF, F.ORIGIN), edicts.f(SELF, F.ORIGIN), `pt#${iter} origin.x`);
    chk.origin.floatEq(x.edLoadFloat(SELF, F.ORIGIN1), edicts.f(SELF, F.ORIGIN1), `pt#${iter} origin.y`);
    chk.origin.floatEq(x.edLoadFloat(SELF, F.ORIGIN2), edicts.f(SELF, F.ORIGIN2), `pt#${iter} origin.z`);
    chk.velocity.floatEq(x.edLoadFloat(SELF, F.VELOCITY), edicts.f(SELF, F.VELOCITY), `pt#${iter} vel.x`);
    chk.velocity.floatEq(x.edLoadFloat(SELF, F.VELOCITY1), edicts.f(SELF, F.VELOCITY1), `pt#${iter} vel.y`);
    chk.velocity.floatEq(x.edLoadFloat(SELF, F.VELOCITY2), edicts.f(SELF, F.VELOCITY2), `pt#${iter} vel.z`);
    chk.angles.floatEq(x.edLoadFloat(SELF, F.ANGLES), edicts.f(SELF, F.ANGLES), `pt#${iter} angles.x`);
    chk.angles.floatEq(x.edLoadFloat(SELF, F.ANGLES1), edicts.f(SELF, F.ANGLES1), `pt#${iter} angles.y`);
    chk.angles.floatEq(x.edLoadFloat(SELF, F.ANGLES2), edicts.f(SELF, F.ANGLES2), `pt#${iter} angles.z`);
    chk.avelocity.floatEq(x.edLoadFloat(SELF, F.AVELOCITY), edicts.f(SELF, F.AVELOCITY), `pt#${iter} avel.x`);
    chk.avelocity.floatEq(x.edLoadFloat(SELF, F.AVELOCITY1), edicts.f(SELF, F.AVELOCITY1), `pt#${iter} avel.y`);
    chk.avelocity.floatEq(x.edLoadFloat(SELF, F.AVELOCITY2), edicts.f(SELF, F.AVELOCITY2), `pt#${iter} avel.z`);
    chk.flags.floatEq(x.edLoadFloat(SELF, F.FLAGS), edicts.f(SELF, F.FLAGS), `pt#${iter} flags`);
    chk.ground.intEq(x.edLoadInt(SELF, F.GROUNDENTITY), edicts.i(SELF, F.GROUNDENTITY), `pt#${iter} groundentity`);
  }
  results.push(chk.origin.report(), chk.velocity.report(), chk.angles.report(), chk.avelocity.report(), chk.flags.report(), chk.ground.report());
}

const ok = results.every(Boolean);
process.exit(ok ? 0 : 1);
