// Golden parity test: assembly/svpusher.ts (SV_Physics_Pusher / SV_PushMove /
// SV_PushMoveAngles — MOVETYPE_PUSH bmodel movers) vs a JS reference
// transliterated inline from src/engine/sv.ts, reusing the svphysics.test.mjs /
// svmove.test.mjs self-contained-duplication pattern (areanode tree + link
// machinery + move()/pushEntity copied in again here per project convention).
//
// Scope tested (see svpusher.ts's own header for the full exclusion list):
//   - pushMoveLinear: candidate scan, carry/onground-clear, push+revert-to-old-
//     position+jiggle-retry sequence, block-and-restore (INCLUDING the pusher's
//     own origin/ltime revert and every previously-moved rider's revert), the
//     documented pusher.solid-restore deviation (captured original, not
//     hardcoded SOLID.bsp).
//   - pushMoveAngles: same candidate scan + carry, PLUS the angular transform
//     (forward/right/up from -amove) applied to riders, angle-revert on
//     block-and-restore, the "moved things may have touched a trigger" tail.
//   - pushMove dispatcher: avelocity!=0 -> angular / velocity==0 -> ltime-only /
//     else -> linear.
//   - physicsPusher: oldltime/thinktime movetime clamp, nextthink-in-window think
//     dispatch (a hand-installed trivial builtin-free function — no real
//     progs.dat needed, this path never touches edict fields).
//   - pusherOverlapsBox (FTE_ENT_SKIN_CONTENTS, skin<0): exercised via a
//     dedicated section.
// EXCLUDED (not exercised, per svpusher.ts's header): `.blocked` QC dispatch —
// this test's JS reference omits the call too, so parity holds on the
// surrounding control flow (which is what's actually ported).
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { rng, Check } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = join(HERE, '..', 'build', 'svpusher.wasm');

const hostErrors = [];
async function loadWasm() {
  const bytes = readFileSync(WASM_PATH);
  const __imports = {
    env: { abort: (msg, file, line, col) => { throw new Error(`svpusher.wasm abort @${line}:${col}`); } },
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
    vm: { isServerLoading: () => false, hostError: (code) => { hostErrors.push(code); } },
    strings: {
      host_tostring: () => 0,
      host_tofixed1: () => 0,
    },
  };
  const { instance } = await WebAssembly.instantiate(bytes,
    new Proxy(__imports, { get: (t, k) => (k in t ? t[k] : new Proxy({}, { get: () => () => 0 })), has: () => true }));
  return instance.exports;
}

const x = await loadWasm();

// --- entvars field indices (src/engine/pr.ts entvars, vanilla layout) ---------
const F = {
  ABSMIN: 1, ABSMIN1: 2, ABSMIN2: 3, ABSMAX: 4, ABSMAX1: 5, ABSMAX2: 6,
  LTIME: 7, MOVETYPE: 8, SOLID: 9, ORIGIN: 10, ORIGIN1: 11, ORIGIN2: 12,
  VELOCITY: 16, VELOCITY1: 17, VELOCITY2: 18,
  ANGLES: 19, ANGLES1: 20, ANGLES2: 21,
  AVELOCITY: 22, AVELOCITY1: 23, AVELOCITY2: 24,
  SKIN: 31, MINS: 33, MINS1: 34, MINS2: 35, MAXS: 36, MAXS1: 37, MAXS2: 38, SIZE: 39,
  THINK: 44, NEXTTHINK: 46, GROUNDENTITY: 47, FLAGS: 76,
};
const EDICT_SIZE_WORDS = 100;

const SOLID_NOT = 0, SOLID_TRIGGER = 1, SOLID_BBOX = 2, SOLID_SLIDEBOX = 3;
const FL_ONGROUND = 512;
const MOVE_NORMAL = 0;
const MT = { none: 0, anglenoclip: 1, walk: 3, step: 4, toss: 6, push: 7, noclip: 8 };
const CONTENTS_EMPTY = -1, CONTENTS_SOLID = -2;

// ================================================================================
// JS reference world/link/motion machinery (transliterated from src/engine/sv.ts;
// copied from svphysics.test.mjs's own proven-parity JS reference).
// ================================================================================
function jsHullPointContents(hull, num, p) {
  while (num >= 0) {
    const node = hull.clipnodes[num];
    const plane = hull.planes[node.planenum];
    const d = plane.type <= 2 ? p[plane.type] - plane.dist
      : plane.normal[0] * p[0] + plane.normal[1] * p[1] + plane.normal[2] * p[2] - plane.dist;
    num = d >= 0.0 ? node.children[0] : node.children[1];
  }
  return num;
}
function jsRecursiveHullCheck(hull, num, p1f, p2f, p1, p2, trace) {
  if (num < 0) {
    if (num !== CONTENTS_SOLID) { trace.allsolid = false; if (num === CONTENTS_EMPTY) trace.inopen = true; else trace.inwater = true; }
    else trace.startsolid = true;
    return true;
  }
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
  if (side === 0) { trace.plane.normal = [plane.normal[0], plane.normal[1], plane.normal[2]]; trace.plane.dist = plane.dist; }
  else { trace.plane.normal = [-plane.normal[0], -plane.normal[1], -plane.normal[2]]; trace.plane.dist = -plane.dist; }
  let f2 = frac, m = mid.slice(), mf = midf;
  while (jsHullPointContents(hull, hull.firstclipnode, m) === CONTENTS_SOLID) {
    f2 -= 0.1;
    if (f2 < 0.0) { trace.fraction = mf; trace.endpos = m.slice(); return false; }
    mf = p1f + (p2f - p1f) * f2;
    m = [p1[0] + f2 * (p2[0] - p1[0]), p1[1] + f2 * (p2[1] - p1[1]), p1[2] + f2 * (p2[2] - p1[2])];
  }
  trace.fraction = mf; trace.endpos = m.slice();
  return false;
}
function makeEmptyTrace(end) {
  return { fraction: 1.0, allsolid: true, startsolid: false, inopen: false, inwater: false, endpos: [...end], plane: { normal: [0, 0, 0], dist: 0 }, ent: null };
}
function jsCopyTrace(src, dst) {
  dst.fraction = src.fraction; dst.allsolid = src.allsolid; dst.startsolid = src.startsolid;
  dst.inopen = src.inopen; dst.inwater = src.inwater; dst.ent = src.ent;
  dst.endpos = [...src.endpos]; dst.plane = { normal: [...src.plane.normal], dist: src.plane.dist };
}
function makeEntityBoxHull(entMinsX, entMinsY, entMinsZ, entMaxsX, entMaxsY, entMaxsZ, sweepMins, sweepMaxs) {
  const dist = [entMaxsX - sweepMins[0], entMinsX - sweepMaxs[0], entMaxsY - sweepMins[1], entMinsY - sweepMaxs[1], entMaxsZ - sweepMins[2], entMinsZ - sweepMaxs[2]];
  const clipnodes = [], planes = [];
  for (let i = 0; i <= 5; i++) {
    const node = { planenum: i, children: [0, 0] };
    node.children[i & 1] = CONTENTS_EMPTY;
    node.children[1 - (i & 1)] = (i !== 5) ? i + 1 : CONTENTS_SOLID;
    clipnodes[i] = node;
    const normal = [0, 0, 0]; normal[i >> 1] = 1.0;
    planes[i] = { type: i >> 1, normal, dist: dist[i] };
  }
  return { clipnodes, planes, firstclipnode: 0, lastclipnode: 5 };
}
function jsHullForEntityBox(edicts, entNum, sweepMins, sweepMaxs) {
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
  trace.endpos[0] += offset[0]; trace.endpos[1] += offset[1]; trace.endpos[2] += offset[2]; // unconditional (sv.ts/sim parity)
  if (trace.fraction < 1.0 || trace.startsolid === true) trace.ent = entNum;
  return trace;
}
function jsClipToWorld(hullWorld, start, end) {
  const trace = makeEmptyTrace(end);
  jsRecursiveHullCheck(hullWorld, hullWorld.firstclipnode, 0.0, 1.0, [...start], [...end], trace);
  if (trace.fraction < 1.0 || trace.startsolid === true) trace.ent = 0;
  return trace;
}
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
  // QSS-M SV_LinkEdict order: store into the f32 fields FIRST, then adjust in place
  // (TWO f32 roundings per axis; all six axes expand by 1 on the non-item path).
  edicts.setf(entNum, F.ABSMIN, originX + minsX); edicts.setf(entNum, F.ABSMIN1, originY + minsY); edicts.setf(entNum, F.ABSMIN2, originZ + minsZ);
  edicts.setf(entNum, F.ABSMAX, originX + maxsX); edicts.setf(entNum, F.ABSMAX1, originY + maxsY); edicts.setf(entNum, F.ABSMAX2, originZ + maxsZ);
  edicts.setf(entNum, F.ABSMIN, edicts.f(entNum, F.ABSMIN) - 1.0); edicts.setf(entNum, F.ABSMIN1, edicts.f(entNum, F.ABSMIN1) - 1.0); edicts.setf(entNum, F.ABSMIN2, edicts.f(entNum, F.ABSMIN2) - 1.0);
  edicts.setf(entNum, F.ABSMAX, edicts.f(entNum, F.ABSMAX) + 1.0); edicts.setf(entNum, F.ABSMAX1, edicts.f(entNum, F.ABSMAX1) + 1.0); edicts.setf(entNum, F.ABSMAX2, edicts.f(entNum, F.ABSMAX2) + 1.0);
  const solid = edicts.f(entNum, F.SOLID) | 0;
  if (solid === SOLID_NOT) return;
  let node = root;
  for (;;) {
    if (node.axis === -1) break;
    const amin = edicts.f(entNum, F.ABSMIN + node.axis), amax = edicts.f(entNum, F.ABSMAX + node.axis);
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
  for (let l = node.solid_edicts.next; l !== node.solid_edicts;) {
    const next = l.next;
    const touch = l.ent;
    const solid = edicts.f(touch, F.SOLID) | 0;
    if (solid === SOLID_NOT || touch === clip.passedict) { l = next; continue; }
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
      const touchOwner = edicts.i(touch, 95);
      if (touchOwner === clip.passedict) { l = next; continue; }
      const passOwner = edicts.i(clip.passedict, 95);
      if (passOwner === touch) { l = next; continue; }
    }
    const trace = jsClipMoveToEntity(edicts, touch, clip.start, clip.mins, clip.maxs, clip.end);
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
  const clip = { trace: out, start, end, mins, maxs, type, passedict, boxmins: [0, 0, 0], boxmaxs: [0, 0, 0] };
  for (let i = 0; i <= 2; i++) {
    if (end[i] > start[i]) { clip.boxmins[i] = start[i] + mins[i] - 1; clip.boxmaxs[i] = end[i] + maxs[i] + 1; }
    else { clip.boxmins[i] = end[i] + mins[i] - 1; clip.boxmaxs[i] = start[i] + maxs[i] + 1; }
  }
  jsClipToLinks(edicts, root, clip);
  return clip.trace;
}
function jsPushEntity(edicts, links, root, worldHull, e, push) {
  const ox = edicts.f(e, F.ORIGIN), oy = edicts.f(e, F.ORIGIN1), oz = edicts.f(e, F.ORIGIN2);
  const end = [ox + push[0], oy + push[1], oz + push[2]];
  const mins = [edicts.f(e, F.MINS), edicts.f(e, F.MINS1), edicts.f(e, F.MINS2)];
  const maxs = [edicts.f(e, F.MAXS), edicts.f(e, F.MAXS1), edicts.f(e, F.MAXS2)];
  const trace = jsMove(edicts, root, worldHull, [ox, oy, oz], mins, maxs, end, MOVE_NORMAL, e);
  edicts.setf(e, F.ORIGIN, trace.endpos[0]); edicts.setf(e, F.ORIGIN1, trace.endpos[1]); edicts.setf(e, F.ORIGIN2, trace.endpos[2]);
  jsLinkEdict(edicts, links, root, e);
  return trace;
}
function jsTestEntityPosition(edicts, root, worldHull, entNum) {
  const origin = [edicts.f(entNum, F.ORIGIN), edicts.f(entNum, F.ORIGIN1), edicts.f(entNum, F.ORIGIN2)];
  const mins = [edicts.f(entNum, F.MINS), edicts.f(entNum, F.MINS1), edicts.f(entNum, F.MINS2)];
  const maxs = [edicts.f(entNum, F.MAXS), edicts.f(entNum, F.MAXS1), edicts.f(entNum, F.MAXS2)];
  return jsMove(edicts, root, worldHull, origin, mins, maxs, origin, MOVE_NORMAL, entNum).startsolid === true;
}
// pusherOverlaps (FTE_ENT_SKIN_CONTENTS): a zero-length sweep degenerates to a
// plain hullPointContents classification (p1===p2 => t1===t2 at every node, so
// recursiveHullCheck's only reachable branches are "both >=0" / "both <0" —
// exactly hullPointContents' own child-select rule); see svpusher.ts's header.
// SCOPE: this models hullForEntity's NON-SOLID_BSP branch only, which is all this
// file's pusher fixtures are (SOLID_SLIDEBOX). A SOLID_BSP pusher resolves to its
// MODEL's clip hull instead — covered by pusherhull.test.mjs, NOT here; do not
// widen these fixtures to SOLID_BSP without teaching this reference that branch.
function jsPusherOverlapsBox(edicts, pusherNum, checkNum) {
  const pMins = [edicts.f(pusherNum, F.MINS), edicts.f(pusherNum, F.MINS1), edicts.f(pusherNum, F.MINS2)];
  const pMaxs = [edicts.f(pusherNum, F.MAXS), edicts.f(pusherNum, F.MAXS1), edicts.f(pusherNum, F.MAXS2)];
  const cMins = [edicts.f(checkNum, F.MINS), edicts.f(checkNum, F.MINS1), edicts.f(checkNum, F.MINS2)];
  const cMaxs = [edicts.f(checkNum, F.MAXS), edicts.f(checkNum, F.MAXS1), edicts.f(checkNum, F.MAXS2)];
  const hull = makeEntityBoxHull(pMins[0], pMins[1], pMins[2], pMaxs[0], pMaxs[1], pMaxs[2], cMins, cMaxs);
  const offset = [edicts.f(pusherNum, F.ORIGIN), edicts.f(pusherNum, F.ORIGIN1), edicts.f(pusherNum, F.ORIGIN2)];
  const p = [
    edicts.f(checkNum, F.ORIGIN) - offset[0],
    edicts.f(checkNum, F.ORIGIN1) - offset[1],
    edicts.f(checkNum, F.ORIGIN2) - offset[2],
  ];
  return jsHullPointContents(hull, hull.firstclipnode, p) === CONTENTS_SOLID;
}

// ================================================================================
// JS reference: src/engine/sv.ts pushMoveAngles/pushMove/physics_Pusher, with the
// SAME documented deviations as svpusher.ts (ascending full-edict-scan candidate
// gather instead of the area-tree query; pusher.solid restored to its captured
// original value instead of hardcoded SOLID.bsp; `.blocked` QC dispatch omitted).
// ================================================================================
function jsPushMoveAngles(edicts, links, root, worldHull, numEdicts, pusherNum, movetime) {
  const velX = edicts.f(pusherNum, F.VELOCITY), velY = edicts.f(pusherNum, F.VELOCITY1), velZ = edicts.f(pusherNum, F.VELOCITY2);
  const moveX = velX * movetime, moveY = velY * movetime, moveZ = velZ * movetime;
  const avelX = edicts.f(pusherNum, F.AVELOCITY), avelY = edicts.f(pusherNum, F.AVELOCITY1), avelZ = edicts.f(pusherNum, F.AVELOCITY2);
  const amoveX = avelX * movetime, amoveY = avelY * movetime, amoveZ = avelZ * movetime;

  const pAbsMinX = edicts.f(pusherNum, F.ABSMIN), pAbsMinY = edicts.f(pusherNum, F.ABSMIN1), pAbsMinZ = edicts.f(pusherNum, F.ABSMIN2);
  const pAbsMaxX = edicts.f(pusherNum, F.ABSMAX), pAbsMaxY = edicts.f(pusherNum, F.ABSMAX1), pAbsMaxZ = edicts.f(pusherNum, F.ABSMAX2);
  const minsX = pAbsMinX + moveX, minsY = pAbsMinY + moveY, minsZ = pAbsMinZ + moveZ;
  const maxsX = pAbsMaxX + moveX, maxsY = pAbsMaxY + moveY, maxsZ = pAbsMaxZ + moveZ;

  const negamove = [-amoveX, -amoveY, -amoveZ];
  const PI = Math.PI;
  const pitchRad = negamove[0] * PI / 180.0, sp = Math.sin(pitchRad), cp = Math.cos(pitchRad);
  const yawRad = negamove[1] * PI / 180.0, sy = Math.sin(yawRad), cy = Math.cos(yawRad);
  const rollRad = negamove[2] * PI / 180.0, sr = Math.sin(rollRad), cr = Math.cos(rollRad);
  const forward = [cp * cy, cp * sy, -sp];
  const right = [cr * sy - sr * sp * cy, -sr * sp * sy - cr * cy, -sr * cp];
  const up = [cr * sp * cy + sr * sy, cr * sp * sy - sr * cy, cr * cp];

  const moved = [], movedOrig = [], movedAng = [];
  const pOrigX0 = edicts.f(pusherNum, F.ORIGIN), pOrigY0 = edicts.f(pusherNum, F.ORIGIN1), pOrigZ0 = edicts.f(pusherNum, F.ORIGIN2);
  const pAngX0 = edicts.f(pusherNum, F.ANGLES), pAngY0 = edicts.f(pusherNum, F.ANGLES1), pAngZ0 = edicts.f(pusherNum, F.ANGLES2);
  moved.push(pusherNum); movedOrig.push([pOrigX0, pOrigY0, pOrigZ0]); movedAng.push([pAngX0, pAngY0, pAngZ0]);

  edicts.setf(pusherNum, F.ORIGIN, pOrigX0 + moveX); edicts.setf(pusherNum, F.ORIGIN1, pOrigY0 + moveY); edicts.setf(pusherNum, F.ORIGIN2, pOrigZ0 + moveZ);
  edicts.setf(pusherNum, F.ANGLES, pAngX0 + amoveX); edicts.setf(pusherNum, F.ANGLES1, pAngY0 + amoveY); edicts.setf(pusherNum, F.ANGLES2, pAngZ0 + amoveZ);
  jsLinkEdict(edicts, links, root, pusherNum);

  for (let check = 1; check < numEdicts; check++) {
    if (check === pusherNum || edicts.free[check]) continue;
    const movetype = edicts.f(check, F.MOVETYPE) | 0;
    if (movetype === MT.push || movetype === MT.none || movetype === MT.noclip || movetype === MT.anglenoclip) continue;

    const flags0 = edicts.f(check, F.FLAGS) | 0;
    const ground = edicts.i(check, F.GROUNDENTITY);
    if ((flags0 & FL_ONGROUND) === 0 || ground !== pusherNum) {
      const cAbsMinX = edicts.f(check, F.ABSMIN), cAbsMinY = edicts.f(check, F.ABSMIN1), cAbsMinZ = edicts.f(check, F.ABSMIN2);
      const cAbsMaxX = edicts.f(check, F.ABSMAX), cAbsMaxY = edicts.f(check, F.ABSMAX1), cAbsMaxZ = edicts.f(check, F.ABSMAX2);
      if (cAbsMinX >= maxsX || cAbsMinY >= maxsY || cAbsMinZ >= maxsZ || cAbsMaxX <= minsX || cAbsMaxY <= minsY || cAbsMaxZ <= minsZ) continue;
      const pusherSkin = edicts.f(pusherNum, F.SKIN) | 0;
      if (pusherSkin < 0) { if (!jsPusherOverlapsBox(edicts, pusherNum, check)) continue; }
      else { if (!jsTestEntityPosition(edicts, root, worldHull, check)) continue; }
    }

    if ((edicts.f(pusherNum, F.MOVETYPE) | 0) === MT.push || ground === pusherNum) {
      const cOrigX = edicts.f(check, F.ORIGIN), cOrigY = edicts.f(check, F.ORIGIN1), cOrigZ = edicts.f(check, F.ORIGIN2);
      const cAngX = edicts.f(check, F.ANGLES), cAngY = edicts.f(check, F.ANGLES1), cAngZ = edicts.f(check, F.ANGLES2);
      moved.push(check); movedOrig.push([cOrigX, cOrigY, cOrigZ]); movedAng.push([cAngX, cAngY, cAngZ]);

      edicts.setf(check, F.ORIGIN, cOrigX + moveX); edicts.setf(check, F.ORIGIN1, cOrigY + moveY); edicts.setf(check, F.ORIGIN2, cOrigZ + moveZ);
      edicts.setf(check, F.ANGLES, cAngX + amoveX); edicts.setf(check, F.ANGLES1, cAngY + amoveY); edicts.setf(check, F.ANGLES2, cAngZ + amoveZ);

      const newOrigX = edicts.f(check, F.ORIGIN), newOrigY = edicts.f(check, F.ORIGIN1), newOrigZ = edicts.f(check, F.ORIGIN2);
      const pOrigXn = edicts.f(pusherNum, F.ORIGIN), pOrigYn = edicts.f(pusherNum, F.ORIGIN1), pOrigZn = edicts.f(pusherNum, F.ORIGIN2);
      const orgX = newOrigX - pOrigXn, orgY = newOrigY - pOrigYn, orgZ = newOrigZ - pOrigZn;
      const org2X = orgX * forward[0] + orgY * forward[1] + orgZ * forward[2];
      const org2Y = -(orgX * right[0] + orgY * right[1] + orgZ * right[2]);
      const org2Z = orgX * up[0] + orgY * up[1] + orgZ * up[2];
      const move2X = org2X - orgX, move2Y = org2Y - orgY, move2Z = org2Z - orgZ;
      edicts.setf(check, F.ORIGIN, newOrigX + move2X); edicts.setf(check, F.ORIGIN1, newOrigY + move2Y); edicts.setf(check, F.ORIGIN2, newOrigZ + move2Z);

      // QSS-M rider exemption: keep onground when groundentity === pusher (matches sv.ts + sim)
      if (movetype !== MT.walk && edicts.i(check, F.GROUNDENTITY) !== pusherNum) {
        const cf = edicts.f(check, F.FLAGS) | 0;
        edicts.setf(check, F.FLAGS, cf & (~FL_ONGROUND));
      }
      if (edicts.i(check, F.GROUNDENTITY) !== pusherNum) edicts.seti(check, F.GROUNDENTITY, 0);

      if (!jsTestEntityPosition(edicts, root, worldHull, check)) { jsLinkEdict(edicts, links, root, check); continue; }

      const pusherSkin2 = edicts.f(pusherNum, F.SKIN) | 0;
      if (pusherSkin2 < 0) { jsLinkEdict(edicts, links, root, check); continue; }

      const baseIdx = moved.length - 1;
      edicts.setf(check, F.ORIGIN, movedOrig[baseIdx][0]); edicts.setf(check, F.ORIGIN1, movedOrig[baseIdx][1]); edicts.setf(check, F.ORIGIN2, movedOrig[baseIdx][2]);
      if (!jsTestEntityPosition(edicts, root, worldHull, check)) { moved.pop(); movedOrig.pop(); movedAng.pop(); continue; }

      jsPushEntity(edicts, links, root, worldHull, check, [moveX, moveY, moveZ]);
      if (!jsTestEntityPosition(edicts, root, worldHull, check)) continue;

      const baseX = edicts.f(check, F.ORIGIN), baseY = edicts.f(check, F.ORIGIN1), baseZ = edicts.f(check, F.ORIGIN2);
      let blocked = true;
      for (let i = 0; i < 8 && blocked; i++) {
        edicts.setf(check, F.ORIGIN, baseX + ((i & 1) ? -0.125 : 0.125));
        edicts.setf(check, F.ORIGIN1, baseY + ((i & 2) ? -0.125 : 0.125));
        edicts.setf(check, F.ORIGIN2, baseZ + ((i & 4) ? -0.125 : 0.125));
        blocked = jsTestEntityPosition(edicts, root, worldHull, check);
      }
      if (!blocked) { jsLinkEdict(edicts, links, root, check); continue; }
    }

    if (edicts.f(check, F.MINS) === edicts.f(check, F.MAXS)) { jsLinkEdict(edicts, links, root, check); continue; }

    const checkSolid = edicts.f(check, F.SOLID) | 0;
    if (checkSolid === SOLID_NOT || checkSolid === SOLID_TRIGGER) {
      edicts.setf(check, F.MINS, 0.0); edicts.setf(check, F.MAXS, 0.0);
      edicts.setf(check, F.MINS1, 0.0); edicts.setf(check, F.MAXS1, 0.0);
      edicts.setf(check, F.MAXS2, edicts.f(check, F.MINS2));
      jsLinkEdict(edicts, links, root, check);
      continue;
    }

    // .blocked QC dispatch: EXCLUDED (see svpusher.ts header).

    for (let i = moved.length - 1; i >= 0; i--) {
      const revEnt = moved[i];
      edicts.setf(revEnt, F.ORIGIN, movedOrig[i][0]); edicts.setf(revEnt, F.ORIGIN1, movedOrig[i][1]); edicts.setf(revEnt, F.ORIGIN2, movedOrig[i][2]);
      edicts.setf(revEnt, F.ANGLES, movedAng[i][0]); edicts.setf(revEnt, F.ANGLES1, movedAng[i][1]); edicts.setf(revEnt, F.ANGLES2, movedAng[i][2]);
      jsLinkEdict(edicts, links, root, revEnt);
    }
    return false;
  }

  for (let i = moved.length - 1; i >= 0; i--) jsLinkEdict(edicts, links, root, moved[i]);
  return true;
}

function jsPushMoveLinear(edicts, links, root, worldHull, numEdicts, pusherNum, movetime) {
  const velX = edicts.f(pusherNum, F.VELOCITY), velY = edicts.f(pusherNum, F.VELOCITY1), velZ = edicts.f(pusherNum, F.VELOCITY2);
  const moveX = velX * movetime, moveY = velY * movetime, moveZ = velZ * movetime;

  const pAbsMinX = edicts.f(pusherNum, F.ABSMIN), pAbsMinY = edicts.f(pusherNum, F.ABSMIN1), pAbsMinZ = edicts.f(pusherNum, F.ABSMIN2);
  const pAbsMaxX = edicts.f(pusherNum, F.ABSMAX), pAbsMaxY = edicts.f(pusherNum, F.ABSMAX1), pAbsMaxZ = edicts.f(pusherNum, F.ABSMAX2);
  const minsX = pAbsMinX + moveX, minsY = pAbsMinY + moveY, minsZ = pAbsMinZ + moveZ;
  const maxsX = pAbsMaxX + moveX, maxsY = pAbsMaxY + moveY, maxsZ = pAbsMaxZ + moveZ;

  const pushOrigX = edicts.f(pusherNum, F.ORIGIN), pushOrigY = edicts.f(pusherNum, F.ORIGIN1), pushOrigZ = edicts.f(pusherNum, F.ORIGIN2);
  edicts.setf(pusherNum, F.ORIGIN, pushOrigX + moveX); edicts.setf(pusherNum, F.ORIGIN1, pushOrigY + moveY); edicts.setf(pusherNum, F.ORIGIN2, pushOrigZ + moveZ);
  edicts.setf(pusherNum, F.LTIME, edicts.f(pusherNum, F.LTIME) + movetime);
  jsLinkEdict(edicts, links, root, pusherNum);

  const originalPusherSolid = edicts.f(pusherNum, F.SOLID) | 0; // captured -- see header DEVIATION note

  const moved = [], movedOrig = [];
  for (let check = 1; check < numEdicts; check++) {
    if (check === pusherNum || edicts.free[check]) continue;
    const movetype = edicts.f(check, F.MOVETYPE) | 0;
    if (movetype === MT.push || movetype === MT.none || movetype === MT.noclip) continue;

    const flags0 = edicts.f(check, F.FLAGS) | 0;
    const ground = edicts.i(check, F.GROUNDENTITY);
    if ((flags0 & FL_ONGROUND) === 0 || ground !== pusherNum) {
      const cAbsMinX = edicts.f(check, F.ABSMIN), cAbsMinY = edicts.f(check, F.ABSMIN1), cAbsMinZ = edicts.f(check, F.ABSMIN2);
      const cAbsMaxX = edicts.f(check, F.ABSMAX), cAbsMaxY = edicts.f(check, F.ABSMAX1), cAbsMaxZ = edicts.f(check, F.ABSMAX2);
      if (cAbsMinX >= maxsX || cAbsMinY >= maxsY || cAbsMinZ >= maxsZ || cAbsMaxX <= minsX || cAbsMaxY <= minsY || cAbsMaxZ <= minsZ) continue;
      const pusherSkin = edicts.f(pusherNum, F.SKIN) | 0;
      if (pusherSkin < 0) { if (!jsPusherOverlapsBox(edicts, pusherNum, check)) continue; }
      else { if (!jsTestEntityPosition(edicts, root, worldHull, check)) continue; }
    }

    // QSS-M rider exemption (see above)
    if (movetype !== MT.walk && edicts.i(check, F.GROUNDENTITY) !== pusherNum) {
      const cf = edicts.f(check, F.FLAGS) | 0;
      edicts.setf(check, F.FLAGS, cf & (~FL_ONGROUND));
    }

    const entOrigX = edicts.f(check, F.ORIGIN), entOrigY = edicts.f(check, F.ORIGIN1), entOrigZ = edicts.f(check, F.ORIGIN2);
    moved.push(check); movedOrig.push([entOrigX, entOrigY, entOrigZ]);

    edicts.setf(pusherNum, F.SOLID, SOLID_NOT);
    jsPushEntity(edicts, links, root, worldHull, check, [moveX, moveY, moveZ]);
    edicts.setf(pusherNum, F.SOLID, originalPusherSolid);

    if (jsTestEntityPosition(edicts, root, worldHull, check)) {
      const pusherSkin2 = edicts.f(pusherNum, F.SKIN) | 0;
      if (pusherSkin2 < 0) continue;
      if (edicts.f(check, F.MINS) === edicts.f(check, F.MAXS)) continue;
      const checkSolid = edicts.f(check, F.SOLID) | 0;
      if (checkSolid === SOLID_NOT || checkSolid === SOLID_TRIGGER) {
        edicts.setf(check, F.MINS, 0.0); edicts.setf(check, F.MAXS, 0.0);
        edicts.setf(check, F.MINS1, 0.0); edicts.setf(check, F.MAXS1, 0.0);
        edicts.setf(check, F.MAXS2, edicts.f(check, F.MINS2));
        continue;
      }

      edicts.setf(check, F.ORIGIN, entOrigX); edicts.setf(check, F.ORIGIN1, entOrigY); edicts.setf(check, F.ORIGIN2, entOrigZ);
      jsLinkEdict(edicts, links, root, check);

      edicts.setf(pusherNum, F.ORIGIN, pushOrigX); edicts.setf(pusherNum, F.ORIGIN1, pushOrigY); edicts.setf(pusherNum, F.ORIGIN2, pushOrigZ);
      jsLinkEdict(edicts, links, root, pusherNum);
      edicts.setf(pusherNum, F.LTIME, edicts.f(pusherNum, F.LTIME) - movetime);

      // .blocked QC dispatch: EXCLUDED (see svpusher.ts header).

      for (let i = 0; i < moved.length; i++) {
        const m = moved[i];
        edicts.setf(m, F.ORIGIN, movedOrig[i][0]); edicts.setf(m, F.ORIGIN1, movedOrig[i][1]); edicts.setf(m, F.ORIGIN2, movedOrig[i][2]);
        jsLinkEdict(edicts, links, root, m);
      }
      return;
    }
  }
}

function jsPushMove(edicts, links, root, worldHull, numEdicts, pusherNum, movetime) {
  const avelX = edicts.f(pusherNum, F.AVELOCITY), avelY = edicts.f(pusherNum, F.AVELOCITY1), avelZ = edicts.f(pusherNum, F.AVELOCITY2);
  if (avelX !== 0.0 || avelY !== 0.0 || avelZ !== 0.0) {
    if (jsPushMoveAngles(edicts, links, root, worldHull, numEdicts, pusherNum, movetime)) {
      edicts.setf(pusherNum, F.LTIME, edicts.f(pusherNum, F.LTIME) + movetime);
    }
    return;
  }
  const velX = edicts.f(pusherNum, F.VELOCITY), velY = edicts.f(pusherNum, F.VELOCITY1), velZ = edicts.f(pusherNum, F.VELOCITY2);
  if (velX === 0.0 && velY === 0.0 && velZ === 0.0) {
    edicts.setf(pusherNum, F.LTIME, edicts.f(pusherNum, F.LTIME) + movetime);
    return;
  }
  jsPushMoveLinear(edicts, links, root, worldHull, numEdicts, pusherNum, movetime);
}

function jsPhysicsPusher(edicts, links, root, worldHull, numEdicts, entNum, frametime) {
  const oldltime = edicts.f(entNum, F.LTIME);
  const thinktime = edicts.f(entNum, F.NEXTTHINK);
  let movetime;
  if (thinktime < (oldltime + frametime)) {
    movetime = thinktime - oldltime;
    if (movetime < 0.0) movetime = 0.0;
  } else {
    movetime = frametime;
  }
  if (movetime !== 0.0) jsPushMove(edicts, links, root, worldHull, numEdicts, entNum, movetime);
  let didThink = false;
  if (!(thinktime <= oldltime || thinktime > edicts.f(entNum, F.LTIME))) {
    edicts.setf(entNum, F.NEXTTHINK, 0.0);
    didThink = true; // the hand-installed builtin-free think has no field-visible effect
  }
  return didThink;
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
    const normal = [0, 0, 0]; normal[i >> 1] = 1.0;
    planes[i] = { type: i >> 1, normal, dist: dist[i] };
  }
  return { clipnodes, planes, firstclipnode: 0, lastclipnode: 5 };
}
function loadWorldHullToWasm(hull) {
  for (let i = 0; i < hull.planes.length; i++) {
    const p = hull.planes[i];
    x.setPlane(i, p.normal[0], p.normal[1], p.normal[2], p.dist, p.type);
  }
  for (let i = hull.firstclipnode; i <= hull.lastclipnode; i++) {
    const n = hull.clipnodes[i];
    x.setClipNode(i, n.planenum, n.children[0], n.children[1]);
  }
  x.pusherSetWorldHullRange(hull.firstclipnode, hull.lastclipnode);
}

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

// Resets every field this module (or svmove's move()/linkEdict) reads for a
// given entity, in BOTH wasm and js, avoiding stale-state leakage across
// reseeded trials (see test header rationale).
function resetEntity(edicts, e) {
  const zf = [F.ORIGIN, F.ORIGIN1, F.ORIGIN2, F.ANGLES, F.ANGLES1, F.ANGLES2,
    F.VELOCITY, F.VELOCITY1, F.VELOCITY2, F.AVELOCITY, F.AVELOCITY1, F.AVELOCITY2,
    F.FLAGS, F.LTIME, F.NEXTTHINK, F.SKIN, F.SOLID, F.MOVETYPE, F.SIZE];
  for (const f of zf) { edicts.setf(e, f, 0.0); x.edStoreFloat(e, f, 0.0); }
  edicts.seti(e, F.GROUNDENTITY, 0); x.edStoreInt(e, F.GROUNDENTITY, 0);
  edicts.seti(e, 95, 0); x.edStoreInt(e, 95, 0); // owner
}
function setBox(edicts, e, ox, oy, oz, hx, hy, hz, solid, movetype) {
  edicts.setf(e, F.ORIGIN, ox); edicts.setf(e, F.ORIGIN1, oy); edicts.setf(e, F.ORIGIN2, oz);
  edicts.setf(e, F.MINS, -hx); edicts.setf(e, F.MINS1, -hy); edicts.setf(e, F.MINS2, -hz);
  edicts.setf(e, F.MAXS, hx); edicts.setf(e, F.MAXS1, hy); edicts.setf(e, F.MAXS2, hz);
  edicts.setf(e, F.SOLID, solid); edicts.setf(e, F.MOVETYPE, movetype); edicts.setf(e, F.SIZE, hx * 2);

  x.edStoreFloat(e, F.ORIGIN, ox); x.edStoreFloat(e, F.ORIGIN1, oy); x.edStoreFloat(e, F.ORIGIN2, oz);
  x.edStoreFloat(e, F.MINS, -hx); x.edStoreFloat(e, F.MINS1, -hy); x.edStoreFloat(e, F.MINS2, -hz);
  x.edStoreFloat(e, F.MAXS, hx); x.edStoreFloat(e, F.MAXS1, hy); x.edStoreFloat(e, F.MAXS2, hz);
  x.edStoreFloat(e, F.SOLID, solid); x.edStoreFloat(e, F.MOVETYPE, movetype); x.edStoreFloat(e, F.SIZE, hx * 2);
}
function linkBoth(edicts, links, root, e) {
  x.linkEdict(e);
  jsLinkEdict(edicts, links, root, e);
}

function checkAllFields(chk, edicts, ents, iter, tag) {
  for (const e of ents) {
    chk.origin.floatEq(x.edLoadFloat(e, F.ORIGIN), edicts.f(e, F.ORIGIN), `${tag}#${iter} e${e} origin.x`);
    chk.origin.floatEq(x.edLoadFloat(e, F.ORIGIN1), edicts.f(e, F.ORIGIN1), `${tag}#${iter} e${e} origin.y`);
    chk.origin.floatEq(x.edLoadFloat(e, F.ORIGIN2), edicts.f(e, F.ORIGIN2), `${tag}#${iter} e${e} origin.z`);
    chk.angles.floatEq(x.edLoadFloat(e, F.ANGLES), edicts.f(e, F.ANGLES), `${tag}#${iter} e${e} angles.x`);
    chk.angles.floatEq(x.edLoadFloat(e, F.ANGLES1), edicts.f(e, F.ANGLES1), `${tag}#${iter} e${e} angles.y`);
    chk.angles.floatEq(x.edLoadFloat(e, F.ANGLES2), edicts.f(e, F.ANGLES2), `${tag}#${iter} e${e} angles.z`);
    chk.flags.floatEq(x.edLoadFloat(e, F.FLAGS), edicts.f(e, F.FLAGS), `${tag}#${iter} e${e} flags`);
    chk.ground.intEq(x.edLoadInt(e, F.GROUNDENTITY), edicts.i(e, F.GROUNDENTITY), `${tag}#${iter} e${e} groundentity`);
    chk.ltime.floatEq(x.edLoadFloat(e, F.LTIME), edicts.f(e, F.LTIME), `${tag}#${iter} e${e} ltime`);
    chk.mins.floatEq(x.edLoadFloat(e, F.MINS), edicts.f(e, F.MINS), `${tag}#${iter} e${e} mins.x`);
    chk.mins.floatEq(x.edLoadFloat(e, F.MAXS2), edicts.f(e, F.MAXS2), `${tag}#${iter} e${e} maxs.z`);
  }
}

const results = [];
const WORLD_MINS = [-2048, -2048, -2048], WORLD_MAXS = [2048, 2048, 2048];
const MAX_EDICTS = 64;

x.initEdicts(MAX_EDICTS, EDICT_SIZE_WORDS);
x.initAreaTree(WORLD_MINS[0], WORLD_MINS[1], WORLD_MINS[2], WORLD_MAXS[0], WORLD_MAXS[1], WORLD_MAXS[2], MAX_EDICTS);
x.initPusherState(MAX_EDICTS);
x.initEntState(0, 0); // maxClients=0 (irrelevant here) -- allocates svframe's freetime array; numEdicts set explicitly below

const worldHull = makeBoxHull([-1024, -1024, -1024], [1024, 1024, 1024]);
loadWorldHullToWasm(worldHull);

const edicts = new JsEdicts(MAX_EDICTS);
const links = []; for (let i = 0; i < MAX_EDICTS; i++) links.push({ prev: null, next: null, ent: null });
const nodes = [];
const root = createAreaNode(nodes, 0, WORLD_MINS, WORLD_MAXS);

const PUSHER = 1, RIDER = 2, OBSTACLE = 3;
const CLUSTER_LO = 4, CLUSTER_HI = 20;
const numEdicts = CLUSTER_HI + 1;
x.setNumEdicts(numEdicts);

// Static cluster, set up once (like svphysics.test.mjs's own convention).
{
  const r = rng(0x50A5E1);
  for (let e = CLUSTER_LO; e <= CLUSTER_HI; e++) {
    const ox = r.f32(300), oy = r.f32(300), oz = r.f32(300);
    const hx = Math.abs(r.f32(20)) + 4, hy = Math.abs(r.f32(20)) + 4, hz = Math.abs(r.f32(20)) + 4;
    resetEntity(edicts, e);
    setBox(edicts, e, ox, oy, oz, hx, hy, hz, SOLID_BBOX, MT.none);
    linkBoth(edicts, links, root, e);
  }
}

// ================================================================================
// Section A: pushMove (linear + angular dispatch), general random trials — mostly
// unblocked but frequently forcing a block via an obstacle placed at the rider's
// expected destination.
// ================================================================================
{
  const r = rng(0x50A5A1);
  const chk = {
    origin: new Check('pushMove.origin'), angles: new Check('pushMove.angles'),
    flags: new Check('pushMove.flags'), ground: new Check('pushMove.groundentity'),
    ltime: new Check('pushMove.ltime'), mins: new Check('pushMove.mins'),
  };
  const ENTS = [PUSHER, RIDER, OBSTACLE];
  const TRIALS = 20000;
  for (let iter = 0; iter < TRIALS; iter++) {
    const angular = (iter % 2) === 1;
    const forceBlock = (iter % 3) === 0;

    resetEntity(edicts, PUSHER);
    const pox = r.f32(80), poy = r.f32(80), poz = r.f32(80);
    const phx = Math.abs(r.f32(30)) + 8, phy = Math.abs(r.f32(30)) + 8, phz = Math.abs(r.f32(20)) + 8;
    setBox(edicts, PUSHER, pox, poy, poz, phx, phy, phz, SOLID_SLIDEBOX, MT.push);
    edicts.setf(PUSHER, F.LTIME, r.f32(50));
    x.edStoreFloat(PUSHER, F.LTIME, edicts.f(PUSHER, F.LTIME));
    if (angular) {
      const av = [r.f32(30), r.f32(30), r.f32(30)];
      edicts.setf(PUSHER, F.AVELOCITY, av[0]); edicts.setf(PUSHER, F.AVELOCITY1, av[1]); edicts.setf(PUSHER, F.AVELOCITY2, av[2]);
      x.edStoreFloat(PUSHER, F.AVELOCITY, av[0]); x.edStoreFloat(PUSHER, F.AVELOCITY1, av[1]); x.edStoreFloat(PUSHER, F.AVELOCITY2, av[2]);
    } else {
      const vel = [r.f32(60), r.f32(60), r.f32(60)];
      edicts.setf(PUSHER, F.VELOCITY, vel[0]); edicts.setf(PUSHER, F.VELOCITY1, vel[1]); edicts.setf(PUSHER, F.VELOCITY2, vel[2]);
      x.edStoreFloat(PUSHER, F.VELOCITY, vel[0]); x.edStoreFloat(PUSHER, F.VELOCITY1, vel[1]); x.edStoreFloat(PUSHER, F.VELOCITY2, vel[2]);
    }
    linkBoth(edicts, links, root, PUSHER);

    resetEntity(edicts, RIDER);
    const rhx = Math.abs(r.f32(10)) + 3, rhy = Math.abs(r.f32(10)) + 3, rhz = Math.abs(r.f32(10)) + 3;
    // sits on top of the pusher, riding via groundentity (bypasses the overlap
    // gate) — the realistic "door/platform carries an item" scenario.
    const rox = pox + r.f32(phx * 0.6), roy = poy + r.f32(phy * 0.6), roz = poz + phz + rhz;
    setBox(edicts, RIDER, rox, roy, roz, rhx, rhy, rhz, SOLID_SLIDEBOX, MT.toss);
    edicts.setf(RIDER, F.FLAGS, FL_ONGROUND); x.edStoreFloat(RIDER, F.FLAGS, FL_ONGROUND);
    edicts.seti(RIDER, F.GROUNDENTITY, PUSHER); x.edStoreInt(RIDER, F.GROUNDENTITY, PUSHER);
    linkBoth(edicts, links, root, RIDER);

    resetEntity(edicts, OBSTACLE);
    if (forceBlock) {
      // placed to guarantee the pusher's own destination overlaps a genuine
      // solid obstacle (angular: near the pusher's post-move absbox; linear:
      // directly along the velocity direction) so both riders AND the pusher
      // itself hit the block-and-restore path frequently.
      const ohx = phx + 10, ohy = phy + 10, ohz = phz + 10;
      let dx = 0, dy = 0, dz = 0;
      if (!angular) {
        const vx = edicts.f(PUSHER, F.VELOCITY), vy = edicts.f(PUSHER, F.VELOCITY1), vz = edicts.f(PUSHER, F.VELOCITY2);
        const len = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
        dx = (vx / len) * (phx + ohx) * 0.5; dy = (vy / len) * (phy + ohy) * 0.5; dz = (vz / len) * (phz + ohz) * 0.5;
      }
      setBox(edicts, OBSTACLE, pox + dx, poy + dy, poz + dz, ohx, ohy, ohz, SOLID_BBOX, MT.none);
    } else {
      setBox(edicts, OBSTACLE, pox + 5000, poy + 5000, poz + 5000, 5, 5, 5, SOLID_BBOX, MT.none); // far away, inert
    }
    linkBoth(edicts, links, root, OBSTACLE);

    const movetime = 0.02 + Math.abs(r.f32(0.08));

    x.pushMove(PUSHER, movetime);
    jsPushMove(edicts, links, root, worldHull, numEdicts, PUSHER, movetime);

    checkAllFields(chk, edicts, ENTS, iter, angular ? 'ang' : 'lin');
  }
  results.push(chk.origin.report(), chk.angles.report(), chk.flags.report(), chk.ground.report(), chk.ltime.report(), chk.mins.report());
}

// ================================================================================
// Section B: pusher NOT already riding (groundentity mismatch) — exercises the
// overlap-gate branch (testEntityPosition) instead of the onground bypass, both
// linear and angular, with a rider placed to overlap (or clearly not) the swept box.
// ================================================================================
{
  const r = rng(0x50A5B1);
  const chk = {
    origin: new Check('pushMove.overlapGate.origin'), angles: new Check('pushMove.overlapGate.angles'),
    flags: new Check('pushMove.overlapGate.flags'), ground: new Check('pushMove.overlapGate.groundentity'),
    ltime: new Check('pushMove.overlapGate.ltime'), mins: new Check('pushMove.overlapGate.mins'),
  };
  const ENTS = [PUSHER, RIDER, OBSTACLE];
  const TRIALS = 20000;
  for (let iter = 0; iter < TRIALS; iter++) {
    const angular = (iter % 2) === 1;

    resetEntity(edicts, PUSHER);
    const pox = r.f32(60), poy = r.f32(60), poz = r.f32(60);
    const phx = Math.abs(r.f32(25)) + 8, phy = Math.abs(r.f32(25)) + 8, phz = Math.abs(r.f32(20)) + 8;
    setBox(edicts, PUSHER, pox, poy, poz, phx, phy, phz, SOLID_SLIDEBOX, MT.push);
    if (angular) {
      const av = [r.f32(40), r.f32(40), r.f32(40)];
      edicts.setf(PUSHER, F.AVELOCITY, av[0]); edicts.setf(PUSHER, F.AVELOCITY1, av[1]); edicts.setf(PUSHER, F.AVELOCITY2, av[2]);
      x.edStoreFloat(PUSHER, F.AVELOCITY, av[0]); x.edStoreFloat(PUSHER, F.AVELOCITY1, av[1]); x.edStoreFloat(PUSHER, F.AVELOCITY2, av[2]);
    } else {
      const vel = [r.f32(50), r.f32(50), r.f32(50)];
      edicts.setf(PUSHER, F.VELOCITY, vel[0]); edicts.setf(PUSHER, F.VELOCITY1, vel[1]); edicts.setf(PUSHER, F.VELOCITY2, vel[2]);
      x.edStoreFloat(PUSHER, F.VELOCITY, vel[0]); x.edStoreFloat(PUSHER, F.VELOCITY1, vel[1]); x.edStoreFloat(PUSHER, F.VELOCITY2, vel[2]);
    }
    linkBoth(edicts, links, root, PUSHER);

    resetEntity(edicts, RIDER);
    const rhx = Math.abs(r.f32(10)) + 3, rhy = Math.abs(r.f32(10)) + 3, rhz = Math.abs(r.f32(10)) + 3;
    // NOT grounded on the pusher (groundentity left 0) — sometimes overlapping
    // the pusher's swept absbox, sometimes not (both branches of the overlap gate).
    const overlaps = (iter % 5) !== 0;
    const rox = overlaps ? pox + r.f32(phx * 0.8) : pox + phx * 4 + 500;
    const roy = overlaps ? poy + r.f32(phy * 0.8) : poy;
    const roz = overlaps ? poz + r.f32(phz * 0.8) : poz;
    setBox(edicts, RIDER, rox, roy, roz, rhx, rhy, rhz, SOLID_SLIDEBOX, MT.step);
    linkBoth(edicts, links, root, RIDER);

    resetEntity(edicts, OBSTACLE);
    setBox(edicts, OBSTACLE, pox + 5000, poy + 5000, poz + 5000, 5, 5, 5, SOLID_BBOX, MT.none);
    linkBoth(edicts, links, root, OBSTACLE);

    const movetime = 0.02 + Math.abs(r.f32(0.08));

    x.pushMove(PUSHER, movetime);
    jsPushMove(edicts, links, root, worldHull, numEdicts, PUSHER, movetime);

    checkAllFields(chk, edicts, ENTS, iter, angular ? 'gate-ang' : 'gate-lin');
  }
  results.push(chk.origin.report(), chk.angles.report(), chk.flags.report(), chk.ground.report(), chk.ltime.report(), chk.mins.report());
}

// ================================================================================
// Section C: corpse / point-entity skip branches (SOLID_NOT|SOLID_TRIGGER riders,
// and mins.x===maxs.x "point" riders) — the "sitting on top, do not block" and
// "corpse" mins/maxs-zeroing paths.
// ================================================================================
{
  const r = rng(0x50A5C1);
  const chk = {
    origin: new Check('pushMove.corpse.origin'), mins: new Check('pushMove.corpse.mins'),
    ltime: new Check('pushMove.corpse.ltime'), angles: new Check('pushMove.corpse.angles'),
    flags: new Check('pushMove.corpse.flags'), ground: new Check('pushMove.corpse.groundentity'),
  };
  const ENTS = [PUSHER, RIDER];
  const TRIALS = 8000;
  for (let iter = 0; iter < TRIALS; iter++) {
    const angular = (iter % 2) === 1;
    const pointEntity = (iter % 3) === 0;

    resetEntity(edicts, PUSHER);
    const pox = r.f32(60), poy = r.f32(60), poz = r.f32(60);
    const phx = Math.abs(r.f32(25)) + 8, phy = Math.abs(r.f32(25)) + 8, phz = Math.abs(r.f32(20)) + 8;
    setBox(edicts, PUSHER, pox, poy, poz, phx, phy, phz, SOLID_SLIDEBOX, MT.push);
    if (angular) {
      edicts.setf(PUSHER, F.AVELOCITY1, 45.0); x.edStoreFloat(PUSHER, F.AVELOCITY1, 45.0);
    } else {
      edicts.setf(PUSHER, F.VELOCITY, 40.0); x.edStoreFloat(PUSHER, F.VELOCITY, 40.0);
    }
    linkBoth(edicts, links, root, PUSHER);

    resetEntity(edicts, RIDER);
    const rox = pox + r.f32(phx * 0.5), roy = poy + r.f32(phy * 0.5), roz = poz + phz + 4;
    if (pointEntity) {
      setBox(edicts, RIDER, rox, roy, roz, 0, 0, 0, SOLID_SLIDEBOX, MT.toss); // mins.x===maxs.x===0
    } else {
      setBox(edicts, RIDER, rox, roy, roz, 6, 6, 6, r.int(2) === 0 ? SOLID_NOT : SOLID_TRIGGER, MT.toss);
    }
    edicts.setf(RIDER, F.FLAGS, FL_ONGROUND); x.edStoreFloat(RIDER, F.FLAGS, FL_ONGROUND);
    edicts.seti(RIDER, F.GROUNDENTITY, PUSHER); x.edStoreInt(RIDER, F.GROUNDENTITY, PUSHER);
    linkBoth(edicts, links, root, RIDER);

    const movetime = 0.02 + Math.abs(r.f32(0.06));
    x.pushMove(PUSHER, movetime);
    jsPushMove(edicts, links, root, worldHull, numEdicts, PUSHER, movetime);

    checkAllFields(chk, edicts, ENTS, iter, 'corpse');
  }
  results.push(chk.origin.report(), chk.mins.report(), chk.ltime.report(), chk.angles.report(), chk.flags.report(), chk.ground.report());
}

// ================================================================================
// Section D: FTE_ENT_SKIN_CONTENTS (skin<0 "contents" pusher, e.g. a water volume
// riding a lift) — pusherOverlapsBox path.
// ================================================================================
{
  const r = rng(0x50A5D1);
  const chk = {
    origin: new Check('pushMove.contents.origin'), ground: new Check('pushMove.contents.groundentity'),
    angles: new Check('pushMove.contents.angles'), flags: new Check('pushMove.contents.flags'),
    ltime: new Check('pushMove.contents.ltime'), mins: new Check('pushMove.contents.mins'),
  };
  const ENTS = [PUSHER, RIDER];
  const TRIALS = 6000;
  for (let iter = 0; iter < TRIALS; iter++) {
    const angular = (iter % 2) === 1;

    resetEntity(edicts, PUSHER);
    const pox = r.f32(60), poy = r.f32(60), poz = r.f32(60);
    const phx = Math.abs(r.f32(30)) + 10, phy = Math.abs(r.f32(30)) + 10, phz = Math.abs(r.f32(20)) + 10;
    setBox(edicts, PUSHER, pox, poy, poz, phx, phy, phz, SOLID_SLIDEBOX, MT.push);
    edicts.setf(PUSHER, F.SKIN, -1.0); x.edStoreFloat(PUSHER, F.SKIN, -1.0);
    if (angular) {
      edicts.setf(PUSHER, F.AVELOCITY2, 30.0); x.edStoreFloat(PUSHER, F.AVELOCITY2, 30.0);
    } else {
      edicts.setf(PUSHER, F.VELOCITY2, r.f32(40)); x.edStoreFloat(PUSHER, F.VELOCITY2, edicts.f(PUSHER, F.VELOCITY2));
    }
    linkBoth(edicts, links, root, PUSHER);

    resetEntity(edicts, RIDER);
    const rhx = Math.abs(r.f32(8)) + 2, rhy = Math.abs(r.f32(8)) + 2, rhz = Math.abs(r.f32(8)) + 2;
    const rox = pox + r.f32(phx * 0.5), roy = poy + r.f32(phy * 0.5), roz = poz + r.f32(phz * 0.5);
    setBox(edicts, RIDER, rox, roy, roz, rhx, rhy, rhz, SOLID_SLIDEBOX, MT.toss);
    linkBoth(edicts, links, root, RIDER);

    const movetime = 0.02 + Math.abs(r.f32(0.06));
    x.pushMove(PUSHER, movetime);
    jsPushMove(edicts, links, root, worldHull, numEdicts, PUSHER, movetime);

    checkAllFields(chk, edicts, ENTS, iter, 'contents');
  }
  results.push(chk.origin.report(), chk.ground.report(), chk.angles.report(), chk.flags.report(), chk.ltime.report(), chk.mins.report());
}

// ================================================================================
// Section E: physicsPusher orchestration — oldltime/thinktime movetime clamp,
// nextthink-in-window handling. Installs one trivial builtin-free function
// (statement 0 = OP.done) as the pusher's `.think`; the trace itself never
// touches an edict field, so JS reference models the field-visible effect
// exactly (nextthink cleared iff the window condition holds) without needing
// a real progs.dat.
// ================================================================================
{
  x.setNumFunctions(2);
  x.setEdictSize(EDICT_SIZE_WORDS * 4 + 96);
  x.installStatement(0, 0 /* OP.done */, 0, 0, 0);
  x.installFunction(1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);

  // Isolate this section to the pusher alone: RIDER/OBSTACLE are leftover from
  // earlier sections with a candidate-eligible movetype (e.g. MT.toss) — mark
  // them free so pushMove's candidate scan skips them (only the inert,
  // movetype=none static cluster remains reachable, which the movetype filter
  // already excludes), matching this section's intent to test physicsPusher's
  // OWN orchestration logic (ltime/nextthink/think) in isolation.
  x.setEdictFree(RIDER, 1); x.setEdictFree(OBSTACLE, 1);
  edicts.free[RIDER] = true; edicts.free[OBSTACLE] = true;

  const r = rng(0x50A5E1);
  const chk = { ltime: new Check('physicsPusher.ltime'), nextthink: new Check('physicsPusher.nextthink'), origin: new Check('physicsPusher.origin') };
  const TRIALS = 10000;
  for (let iter = 0; iter < TRIALS; iter++) {
    resetEntity(edicts, PUSHER);
    const pox = r.f32(60), poy = r.f32(60), poz = r.f32(60);
    setBox(edicts, PUSHER, pox, poy, poz, 16, 16, 16, SOLID_SLIDEBOX, MT.push);
    edicts.seti(PUSHER, F.THINK, 1); x.edStoreInt(PUSHER, F.THINK, 1);

    const ltime = r.f32(20);
    edicts.setf(PUSHER, F.LTIME, ltime); x.edStoreFloat(PUSHER, F.LTIME, ltime);
    const frametime = 0.02 + Math.abs(r.f32(0.08));
    // nextthink roll: sometimes inside this frame's window, sometimes past it,
    // sometimes <=0 (disabled), sometimes already <= oldltime (stale/no-op).
    const roll = r.int(4);
    let nextthink;
    if (roll === 0) nextthink = 0.0;
    else if (roll === 1) nextthink = ltime - Math.abs(r.f32(2)); // stale
    else if (roll === 2) nextthink = ltime + frametime * 0.5; // in-window
    else nextthink = ltime + frametime * 5; // past window
    edicts.setf(PUSHER, F.NEXTTHINK, nextthink); x.edStoreFloat(PUSHER, F.NEXTTHINK, nextthink);
    const vel = [r.f32(30), r.f32(30), r.f32(30)];
    edicts.setf(PUSHER, F.VELOCITY, vel[0]); edicts.setf(PUSHER, F.VELOCITY1, vel[1]); edicts.setf(PUSHER, F.VELOCITY2, vel[2]);
    x.edStoreFloat(PUSHER, F.VELOCITY, vel[0]); x.edStoreFloat(PUSHER, F.VELOCITY1, vel[1]); x.edStoreFloat(PUSHER, F.VELOCITY2, vel[2]);
    linkBoth(edicts, links, root, PUSHER);

    x.physicsPusher(PUSHER, frametime, ltime + frametime);
    jsPhysicsPusher(edicts, links, root, worldHull, numEdicts, PUSHER, frametime);

    chk.ltime.floatEq(x.edLoadFloat(PUSHER, F.LTIME), edicts.f(PUSHER, F.LTIME), `pp#${iter} ltime`);
    chk.nextthink.floatEq(x.edLoadFloat(PUSHER, F.NEXTTHINK), edicts.f(PUSHER, F.NEXTTHINK), `pp#${iter} nextthink`);
    chk.origin.floatEq(x.edLoadFloat(PUSHER, F.ORIGIN), edicts.f(PUSHER, F.ORIGIN), `pp#${iter} origin.x`);
  }
  results.push(chk.ltime.report(), chk.nextthink.report(), chk.origin.report());
  console.log(`[info] physicsPusher: hostErrors=${hostErrors.length} (expected 0)`);
  results.push(hostErrors.length === 0);
}

const ok = results.every(Boolean);
process.exit(ok ? 0 : 1);
