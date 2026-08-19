// Server area/link + movement-trace layer — port of sv.ts SV_CreateAreaNode /
// SV_LinkEdict / SV_UnlinkEdict / SV_Move / SV_ClipMoveToEntity / SV_ClipToLinks /
// SV_HullForEntity, on world.ts (BSP clip-hull trace) + ed.ts (edict fields).
//
// - findTouchedLeafs (PVS leafnums) lives in pvs.ts (refreshLeafs), driven by the
//   embedder per moved edict — linkEdict here never rebuilds leafnums.
// - world.ts's hull range (hullFirstClipnode/hullLastClipnode) is shared mutable
//   state; move() repoints it at the reserved box-hull region while clipping
//   touched entities and restores the world hull before returning, so
//   pointContents()/hullPointContents() stay valid afterward.
//
// PARITY: f64 throughout (JS uses plain numbers) EXCEPT edict fields, which are
// f32: every read widens to f64 immediately, every write rounds once via
// edStoreFloat. Field indices are the fixed vanilla entvars layout (pr.ts).

import {
  edLoadFloat, edStoreFloat, edLoadInt,
} from "./ed";
import { execute, readGlobalInt, writeGlobalInt, readGlobalFloat, writeGlobalFloat } from "./vm";
import * as world from "./world";

export * from "./ed";
export * from "./world"; // includes pointContents -- see header note

// --- entvars field indices (src/engine/pr.ts entvars, vanilla layout) ---------
const F_MODELINDEX: i32 = 0;
const F_ABSMIN: i32 = 1, F_ABSMIN1: i32 = 2, F_ABSMIN2: i32 = 3;
const F_ABSMAX: i32 = 4, F_ABSMAX1: i32 = 5, F_ABSMAX2: i32 = 6;
const F_SOLID: i32 = 9;
const F_ORIGIN: i32 = 10, F_ORIGIN1: i32 = 11, F_ORIGIN2: i32 = 12;
const F_SKIN: i32 = 31;
const F_MINS: i32 = 33, F_MINS1: i32 = 34, F_MINS2: i32 = 35;
const F_MAXS: i32 = 36, F_MAXS1: i32 = 37, F_MAXS2: i32 = 38;
const F_SIZE: i32 = 39;
const F_FLAGS: i32 = 76;
const F_OWNER: i32 = 95;
const F_TOUCH: i32 = 42;   // .void() touch — QC function field (entvars.touch)
// QC reserved global offsets (pr.globalvars): self=28, other=29, time=31
const GLOBAL_SELF: i32 = 28, GLOBAL_OTHER: i32 = 29, GLOBAL_TIME: i32 = 31;

// --- sv.ts SOLID / FL / MOVE enums (the slice this module touches) -----------
const SOLID_NOT: i32 = 0, SOLID_TRIGGER: i32 = 1, SOLID_BSP: i32 = 4;
const FL_MONSTER: i32 = 32, FL_ITEM: i32 = 256;
export const MOVE_NORMAL: i32 = 0, MOVE_NOMONSTERS: i32 = 1, MOVE_MISSILE: i32 = 2;

// mod.ts CONTENTS.empty/solid (world.ts keeps its own unexported copy).
const CONTENTS_EMPTY: i32 = -1;
const CONTENTS_SOLID: i32 = -2;

// ================================================================================
// Area-node tree (SV_CreateAreaNode): fixed depth-4 binary tree, 31 nodes,
// split alternately on X/Y. SoA storage, static.
// ================================================================================
const AREA_MAX: i32 = 31;
const AREA_AXIS: usize = memory.data(AREA_MAX * 4);   // i32, -1 = leaf
const AREA_DIST: usize = memory.data(AREA_MAX * 8);   // f64
const AREA_CHILD0: usize = memory.data(AREA_MAX * 4); // i32
const AREA_CHILD1: usize = memory.data(AREA_MAX * 4); // i32

@inline function loadAreaAxis(i: i32): i32 { return load<i32>(AREA_AXIS + (<usize>i << 2)); }
@inline function storeAreaAxis(i: i32, v: i32): void { store<i32>(AREA_AXIS + (<usize>i << 2), v); }
@inline function loadAreaDist(i: i32): f64 { return load<f64>(AREA_DIST + (<usize>i << 3)); }
@inline function storeAreaDist(i: i32, v: f64): void { store<f64>(AREA_DIST + (<usize>i << 3), v); }
@inline function loadAreaChild0(i: i32): i32 { return load<i32>(AREA_CHILD0 + (<usize>i << 2)); }
@inline function storeAreaChild0(i: i32, v: i32): void { store<i32>(AREA_CHILD0 + (<usize>i << 2), v); }
@inline function loadAreaChild1(i: i32): i32 { return load<i32>(AREA_CHILD1 + (<usize>i << 2)); }
@inline function storeAreaChild1(i: i32, v: i32): void { store<i32>(AREA_CHILD1 + (<usize>i << 2), v); }

// --- intrusive link lists (SV_LinkEdict's Link/prev/next) ---------------------
// Unified id space: sentinel ids [0, SENTINEL_COUNT) for each node's two list
// heads (node n: solid = n*2, trigger = n*2+1), then edict area-link ids at
// SENTINEL_COUNT+entNum. -1 = null.
const SENTINEL_COUNT: i32 = AREA_MAX * 2;

let linkPrevBase: usize = 0;
let linkNextBase: usize = 0;
let freeBase: usize = 0; // per-edict free flag (u8) -- sv.ts Edict.free, not modeled by ed.ts
let maxEdictsG: i32 = 0;
let boxHullBase: i32 = 0; // reserved clipnode/plane index range in world.ts's storage for the temp box hull
let boxHullGen: i32 = -1; // world.hullStorageGeneration() the connectivity was last wired against

@inline function linkPrev(id: i32): i32 { return load<i32>(linkPrevBase + (<usize>id << 2)); }
@inline function setLinkPrev(id: i32, v: i32): void { store<i32>(linkPrevBase + (<usize>id << 2), v); }
@inline function linkNext(id: i32): i32 { return load<i32>(linkNextBase + (<usize>id << 2)); }
@inline function setLinkNext(id: i32, v: i32): void { store<i32>(linkNextBase + (<usize>id << 2), v); }

function getEdictFree(entNum: i32): bool { return load<u8>(freeBase + <usize>entNum) != 0; }
export function setEdictFree(entNum: i32, isFree: i32): void { store<u8>(freeBase + <usize>entNum, isFree ? 1 : 0); }
export function isEdictFree(entNum: i32): i32 { return getEdictFree(entNum) ? 1 : 0; }

// sv.ts createAreaNode: pre-order node numbering, axis = longer of X/Y, dist
// bisects it; leaves (depth 4) get axis=-1. Seeds each node's two sentinel
// self-loops (every node in [0,31) is visited exactly once).
let areaNodeCount: i32 = 0;
function buildAreaNode(depth: i32, minsX: f64, minsY: f64, minsZ: f64, maxsX: f64, maxsY: f64, maxsZ: f64): i32 {
  const idx = areaNodeCount;
  areaNodeCount++;

  const solidSentinel = idx * 2, triggerSentinel = idx * 2 + 1;
  setLinkPrev(solidSentinel, solidSentinel); setLinkNext(solidSentinel, solidSentinel);
  setLinkPrev(triggerSentinel, triggerSentinel); setLinkNext(triggerSentinel, triggerSentinel);

  if (depth == 4) {
    storeAreaAxis(idx, -1);
    storeAreaChild0(idx, -1);
    storeAreaChild1(idx, -1);
    return idx;
  }

  const axis: i32 = (maxsX - minsX) > (maxsY - minsY) ? 0 : 1;
  const dist: f64 = axis == 0 ? 0.5 * (maxsX + minsX) : 0.5 * (maxsY + minsY);
  storeAreaAxis(idx, axis);
  storeAreaDist(idx, dist);

  let m1x = maxsX, m1y = maxsY, m1z = maxsZ;
  let m2x = minsX, m2y = minsY, m2z = minsZ;
  if (axis == 0) { m1x = dist; m2x = dist; } else { m1y = dist; m2y = dist; }

  // Pre-order numbering: child0 (mins2,maxs) must be built before child1.
  const c0 = buildAreaNode(depth + 1, m2x, m2y, m2z, maxsX, maxsY, maxsZ);
  const c1 = buildAreaNode(depth + 1, minsX, minsY, minsZ, m1x, m1y, m1z);
  storeAreaChild0(idx, c0);
  storeAreaChild1(idx, c1);
  return idx;
}

// sv.ts initBoxHull connectivity — static; only the 6 plane distances get
// rebuilt per hullForEntity call.
function boxChild0(i: i32): i32 {
  if ((i & 1) == 0) return CONTENTS_EMPTY;
  return (i != 5) ? (boxHullBase + i + 1) : CONTENTS_SOLID;
}
function boxChild1(i: i32): i32 {
  if ((i & 1) == 0) return (i != 5) ? (boxHullBase + i + 1) : CONTENTS_SOLID;
  return CONTENTS_EMPTY;
}
function setupBoxHullConnectivity(): void {
  for (let i: i32 = 0; i <= 5; i++) {
    world.setClipNode(boxHullBase + i, boxHullBase + i, boxChild0(i), boxChild1(i));
  }
}

// initAreaTree: per-map allocation; mins/maxs = worldmodel bounds (sv.ts spawnServer).
// SV_TouchLinks scratch: one buffer per re-entrancy depth (a touch() can relink/
// remove edicts and re-enter touchLinks). Sized maxEdicts*MAX_TOUCH_DEPTH.
const MAX_TOUCH_DEPTH: i32 = 8;
let touchListBase: usize = 0;
let touchDepth: i32 = 0;


export function initAreaTree(
  minsX: f64, minsY: f64, minsZ: f64, maxsX: f64, maxsY: f64, maxsZ: f64, maxEdicts: i32,
): void {
  maxEdictsG = maxEdicts;
  const totalLinks: i32 = SENTINEL_COUNT + maxEdicts;
  linkPrevBase = heap.alloc(<usize>totalLinks * 4);
  linkNextBase = heap.alloc(<usize>totalLinks * 4);
  freeBase = heap.alloc(<usize>maxEdicts);
  touchListBase = heap.alloc(<usize>maxEdicts * <usize>MAX_TOUCH_DEPTH * 4);
  skinListBase = heap.alloc(<usize>maxEdicts << 2);
  skinListCount = 0;

  areaNodeCount = 0;
  buildAreaNode(0, minsX, minsY, minsZ, maxsX, maxsY, maxsZ);

  // heap.alloc does NOT guarantee zeroed memory: fill unlinked (-1) area-links
  // and false free flags explicitly.
  memory.fill(linkPrevBase + (<usize>SENTINEL_COUNT << 2), 0xFF, <usize>maxEdicts << 2);
  memory.fill(linkNextBase + (<usize>SENTINEL_COUNT << 2), 0xFF, <usize>maxEdicts << 2);
  memory.fill(freeBase, 0, <usize>maxEdicts);

  boxHullBase = world.maxClipnodes() - 6;
  // Pools may not be sized yet (initHullStorage can run after this); writing at a
  // negative base would corrupt the heap. loadHullForEntity re-derives at use time.
  if (world.maxClipnodes() >= 12) setupBoxHullConnectivity();
}

// sv.ts SV_UnlinkEdict.
export function unlinkEdict(entNum: i32): void {
  const id = SENTINEL_COUNT + entNum;
  const p = linkPrev(id), n = linkNext(id);
  if (p != -1) setLinkNext(p, n);
  if (n != -1) setLinkPrev(n, p);
  setLinkPrev(id, -1);
  setLinkNext(id, -1);
}

// sv.ts SV_LinkEdict, minus findTouchedLeafs and touch_triggers dispatch.
export function linkEdict(entNum: i32): void {
  if (entNum == 0 || getEdictFree(entNum)) return;
  unlinkEdict(entNum);

  const originX = <f64>edLoadFloat(entNum, F_ORIGIN);
  const originY = <f64>edLoadFloat(entNum, F_ORIGIN1);
  const originZ = <f64>edLoadFloat(entNum, F_ORIGIN2);
  const minsX = <f64>edLoadFloat(entNum, F_MINS);
  const minsY = <f64>edLoadFloat(entNum, F_MINS1);
  const minsZ = <f64>edLoadFloat(entNum, F_MINS2);
  const maxsX = <f64>edLoadFloat(entNum, F_MAXS);
  const maxsY = <f64>edLoadFloat(entNum, F_MAXS1);
  const maxsZ = <f64>edLoadFloat(entNum, F_MAXS2);

  // QSS-M SV_LinkEdict order: store origin+mins/maxs into the f32 FIELDS first, then
  // adjust the STORED values — each axis gets TWO f32 roundings. One f64 compute +
  // single store drifts absboxes by an ulp, flipping boundary trigger touches.
  edStoreFloat(entNum, F_ABSMIN, originX + minsX);
  edStoreFloat(entNum, F_ABSMIN1, originY + minsY);
  edStoreFloat(entNum, F_ABSMIN2, originZ + minsZ);
  edStoreFloat(entNum, F_ABSMAX, originX + maxsX);
  edStoreFloat(entNum, F_ABSMAX1, originY + maxsY);
  edStoreFloat(entNum, F_ABSMAX2, originZ + maxsZ);

  const flags: i32 = <i32>edLoadFloat(entNum, F_FLAGS);
  if ((flags & FL_ITEM) != 0) {
    edStoreFloat(entNum, F_ABSMIN, <f64>edLoadFloat(entNum, F_ABSMIN) - 15.0);
    edStoreFloat(entNum, F_ABSMIN1, <f64>edLoadFloat(entNum, F_ABSMIN1) - 15.0);
    edStoreFloat(entNum, F_ABSMAX, <f64>edLoadFloat(entNum, F_ABSMAX) + 15.0);
    edStoreFloat(entNum, F_ABSMAX1, <f64>edLoadFloat(entNum, F_ABSMAX1) + 15.0);
  } else {
    edStoreFloat(entNum, F_ABSMIN, <f64>edLoadFloat(entNum, F_ABSMIN) - 1.0);
    edStoreFloat(entNum, F_ABSMIN1, <f64>edLoadFloat(entNum, F_ABSMIN1) - 1.0);
    edStoreFloat(entNum, F_ABSMIN2, <f64>edLoadFloat(entNum, F_ABSMIN2) - 1.0);
    edStoreFloat(entNum, F_ABSMAX, <f64>edLoadFloat(entNum, F_ABSMAX) + 1.0);
    edStoreFloat(entNum, F_ABSMAX1, <f64>edLoadFloat(entNum, F_ABSMAX1) + 1.0);
    edStoreFloat(entNum, F_ABSMAX2, <f64>edLoadFloat(entNum, F_ABSMAX2) + 1.0);
  }

  // findTouchedLeafs (PVS leafnums): pvs.ts refreshLeafs, driven by the embedder.

  const solid: i32 = <i32>edLoadFloat(entNum, F_SOLID);
  if (solid == SOLID_NOT) {
    // SOLID_NOT entities are never linked (svpusher iterates all edicts instead).
    return;
  }

  let node: i32 = 0; // areanodes[0], the root
  for (; ;) {
    const axis = loadAreaAxis(node);
    if (axis == -1) break;
    const dist = loadAreaDist(node);
    const amin = <f64>edLoadFloat(entNum, F_ABSMIN + axis);
    const amax = <f64>edLoadFloat(entNum, F_ABSMAX + axis);
    if (amin > dist) node = loadAreaChild0(node);
    else if (amax < dist) node = loadAreaChild1(node);
    else break;
  }

  const beforeId = (solid == SOLID_TRIGGER) ? (node * 2 + 1) : (node * 2);
  const id = SENTINEL_COUNT + entNum;
  const oldPrev = linkPrev(beforeId);
  setLinkNext(id, beforeId);
  setLinkPrev(id, oldPrev);
  setLinkNext(oldPrev, id);
  setLinkPrev(beforeId, id);

  // touch_triggers dispatch: linkEdictTouch below.
}

// QSS-M SV_AreaTriggerEdicts: collect-first so a touch() relink can't corrupt the live
// area list mid-walk. Filter at COLLECT time (QSS-M does): a mid-chain teleport must not
// let destination-area triggers dispatch in the same call.
function collectTriggers(entNum: i32, node: i32, list: usize, n: i32): i32 {
  const triggerSentinel = node * 2 + 1;
  let l = linkNext(triggerSentinel);
  const cap = getMaxEdicts();
  while (l != triggerSentinel) {
    const trig = l - SENTINEL_COUNT;
    l = linkNext(l);
    if (n >= cap) return n;
    if (trig == entNum || getEdictFree(trig)) continue;
    if (edLoadInt(trig, F_TOUCH) == 0) continue;
    if ((<i32>edLoadFloat(trig, F_SOLID)) != SOLID_TRIGGER) continue;
    if (<f64>edLoadFloat(entNum, F_ABSMIN) > <f64>edLoadFloat(trig, F_ABSMAX) ||
        <f64>edLoadFloat(entNum, F_ABSMIN1) > <f64>edLoadFloat(trig, F_ABSMAX1) ||
        <f64>edLoadFloat(entNum, F_ABSMIN2) > <f64>edLoadFloat(trig, F_ABSMAX2) ||
        <f64>edLoadFloat(entNum, F_ABSMAX) < <f64>edLoadFloat(trig, F_ABSMIN) ||
        <f64>edLoadFloat(entNum, F_ABSMAX1) < <f64>edLoadFloat(trig, F_ABSMIN1) ||
        <f64>edLoadFloat(entNum, F_ABSMAX2) < <f64>edLoadFloat(trig, F_ABSMIN2)) continue;
    store<i32>(list + (<usize>n << 2), trig);
    n++;
  }
  const axis = loadAreaAxis(node);
  if (axis == -1) return n;
  const dist = loadAreaDist(node);
  if (<f64>edLoadFloat(entNum, F_ABSMAX + axis) > dist) n = collectTriggers(entNum, loadAreaChild0(node), list, n);
  if (<f64>edLoadFloat(entNum, F_ABSMIN + axis) < dist) n = collectTriggers(entNum, loadAreaChild1(node), list, n);
  return n;
}

// Touch/impact dispatch clock: vanilla sets pr time = sv.time, NOT the time global,
// which during runThink holds the clamped thinktime (can lead sv.time by a frame).
// physicsFrame stamps this each tick.
let simTime: f64 = 0;
export function setSimTime(t: f64): void { simTime = t; }

// Shadow-verify debug: ring log of (trigger, toucher) per dispatch this tick.
// Reset by the embedder per tick; read via ptr/count.
const TOUCH_LOG_MAX: i32 = 4096;
const TOUCH_LOG: usize = memory.data(TOUCH_LOG_MAX * 8);
let touchLogN: i32 = 0;
export function touchLogReset(): void { touchLogN = 0; }
export function touchLogCount(): i32 { return touchLogN; }
export function touchLogPtr(): usize { return TOUCH_LOG; }
// Debug: dump every area node's TRIGGER chain into the ring as (node, ent) pairs.
export function touchLogDumpTriggers(nodeCount: i32): void {
  touchLogDumpChains(nodeCount, 1);
}
// which=1 dumps TRIGGER chains, which=0 dumps SOLID chains (sentinel node*2+which).
export function touchLogDumpChains(nodeCount: i32, which: i32): void {
  for (let node: i32 = 0; node < nodeCount; node++) {
    const sentinel = node * 2 + which;
    let l = linkNext(sentinel);
    let guard = 0;
    while (l != sentinel && guard < 4096) {
      touchLogPush(node, l - SENTINEL_COUNT);
      l = linkNext(l);
      guard++;
    }
  }
}
function touchLogPush(trig: i32, toucher: i32): void {
  if (touchLogN < TOUCH_LOG_MAX) {
    store<i32>(TOUCH_LOG + (<usize>touchLogN << 3), trig);
    store<i32>(TOUCH_LOG + (<usize>touchLogN << 3) + 4, toucher);
    touchLogN++;
  }
}

// sv.ts touchLinks: fire the touch() of every trigger overlapping ent. Re-validates each
// candidate before dispatch (a prior touch() can free/relink/desolidify it).
export function touchLinks(entNum: i32): void {
  if (touchDepth >= MAX_TOUCH_DEPTH) return;
  const list = touchListBase + <usize>touchDepth * <usize>getMaxEdicts() * 4;
  const count = collectTriggers(entNum, 0, list, 0);
  // Dispatch order MUST match sv.ts touchLinks (edict-num ascending): multi-trigger
  // overlaps interleave QC chains by dispatch sequence, and the raw collect order is
  // area-chain insertion history, which differs between the sims.
  for (let i: i32 = 1; i < count; i++) {
    const v = load<i32>(list + (<usize>i << 2));
    let j: i32 = i - 1;
    while (j >= 0 && load<i32>(list + (<usize>j << 2)) > v) {
      store<i32>(list + (<usize>(j + 1) << 2), load<i32>(list + (<usize>j << 2)));
      j--;
    }
    store<i32>(list + (<usize>(j + 1) << 2), v);
  }
  touchDepth++;
  const now = <f32>simTime;   // sv.time — see setSimTime note
  for (let i: i32 = 0; i < count; i++) {
    const touch = load<i32>(list + (<usize>i << 2));
    if (touch == entNum || getEdictFree(touch)) continue;
    if (edLoadInt(touch, F_TOUCH) == 0) continue;
    if ((<i32>edLoadFloat(touch, F_SOLID)) != SOLID_TRIGGER) continue;
    // QSS-M SV_TouchLinks reads ent->v.absmin/absmax LIVE per candidate — a touch
    // handler earlier in THIS loop can move/relink ent, and later overlap tests must
    // see the NEW box, so do not hoist the box into locals.
    if (<f64>edLoadFloat(entNum, F_ABSMIN) > <f64>edLoadFloat(touch, F_ABSMAX) ||
        <f64>edLoadFloat(entNum, F_ABSMIN1) > <f64>edLoadFloat(touch, F_ABSMAX1) ||
        <f64>edLoadFloat(entNum, F_ABSMIN2) > <f64>edLoadFloat(touch, F_ABSMAX2) ||
        <f64>edLoadFloat(entNum, F_ABSMAX) < <f64>edLoadFloat(touch, F_ABSMIN) ||
        <f64>edLoadFloat(entNum, F_ABSMAX1) < <f64>edLoadFloat(touch, F_ABSMIN1) ||
        <f64>edLoadFloat(entNum, F_ABSMAX2) < <f64>edLoadFloat(touch, F_ABSMIN2)) continue;
    const oldSelf = readGlobalInt(GLOBAL_SELF);
    const oldOther = readGlobalInt(GLOBAL_OTHER);
    writeGlobalInt(GLOBAL_SELF, touch);
    writeGlobalInt(GLOBAL_OTHER, entNum);
    writeGlobalFloat(GLOBAL_TIME, now);
    touchLogPush(touch, entNum);
    execute(edLoadInt(touch, F_TOUCH));
    writeGlobalInt(GLOBAL_SELF, oldSelf);
    writeGlobalInt(GLOBAL_OTHER, oldOther);
  }
  touchDepth--;
}

// sv.ts linkEdict(ent, true): link, then fire trigger touches — for the
// entity-movement paths where JS passes touch_triggers=true.
export function linkEdictTouch(entNum: i32): void {
  linkEdict(entNum);
  if (getEdictFree(entNum) != 0) return;
  // QSS-M world.c:667: SV_LinkEdict returns for SOLID_NOT BEFORE the touch_triggers
  // call — a moving dead body/gib never fires trigger touches.
  if ((<i32>edLoadFloat(entNum, F_SOLID)) == SOLID_NOT) return;
  touchLinks(entNum);
}

// sv.ts SV_Impact: fire BOTH touch functions (self=e1/other=e2, then swapped).
// e2 == -1 (null) or 0 (world) still fires e1's touch.
export function impact(e1: i32, e2: i32): void {
  const now = <f32>simTime;   // sv.time — see setSimTime note
  const oldSelf = readGlobalInt(GLOBAL_SELF);
  const oldOther = readGlobalInt(GLOBAL_OTHER);
  const other: i32 = e2 < 0 ? 0 : e2;   // trace.ent === null -> world
  // QSS-M sv_phys.c:250: the time write is UNCONDITIONAL at SV_Impact entry — even
  // with no touch functions; blocked() consumers read it (train_blocked's gate).
  writeGlobalFloat(GLOBAL_TIME, now);
  if (edLoadInt(e1, F_TOUCH) != 0 && (<i32>edLoadFloat(e1, F_SOLID)) != SOLID_NOT) {
    writeGlobalInt(GLOBAL_SELF, e1);
    writeGlobalInt(GLOBAL_OTHER, other);
    execute(edLoadInt(e1, F_TOUCH));
  }
  if (other != 0 && edLoadInt(other, F_TOUCH) != 0 && (<i32>edLoadFloat(other, F_SOLID)) != SOLID_NOT) {
    writeGlobalInt(GLOBAL_SELF, other);
    writeGlobalInt(GLOBAL_OTHER, e1);
    execute(edLoadInt(other, F_TOUCH));
  }
  writeGlobalInt(GLOBAL_SELF, oldSelf);
  writeGlobalInt(GLOBAL_OTHER, oldOther);
}

// ================================================================================
// Movement trace: SV_Move / SV_ClipToLinks / SV_ClipMoveToEntity / SV_HullForEntity
// ================================================================================

// "Candidate" scratch trace — sv.ts state.clipScratchTrace, reused per touched entity.
let candFraction: f64 = 1.0;
let candEndX: f64 = 0.0, candEndY: f64 = 0.0, candEndZ: f64 = 0.0;
let candPlaneNX: f64 = 0.0, candPlaneNY: f64 = 0.0, candPlaneNZ: f64 = 0.0, candPlaneDist: f64 = 0.0;
let candAllSolid: bool = true, candStartSolid: bool = false, candInOpen: bool = false, candInWater: bool = false;
let candEnt: i32 = -1; // -1 == JS trace.ent === null

// "Out" trace — sv.ts clip.trace, the accumulating best-hit result of move().
let outFraction: f64 = 1.0;
let outEndX: f64 = 0.0, outEndY: f64 = 0.0, outEndZ: f64 = 0.0;
let outPlaneNX: f64 = 0.0, outPlaneNY: f64 = 0.0, outPlaneNZ: f64 = 0.0, outPlaneDist: f64 = 0.0;
let outAllSolid: bool = true, outStartSolid: bool = false, outInOpen: bool = false, outInWater: bool = false;
let outEnt: i32 = -1;

function copyCandToOut(): void {
  outFraction = candFraction;
  outEndX = candEndX; outEndY = candEndY; outEndZ = candEndZ;
  outPlaneNX = candPlaneNX; outPlaneNY = candPlaneNY; outPlaneNZ = candPlaneNZ; outPlaneDist = candPlaneDist;
  outAllSolid = candAllSolid; outStartSolid = candStartSolid; outInOpen = candInOpen; outInWater = candInWater;
  outEnt = candEnt;
}

// sv.ts SV_HullForEntity, both branches. SOLID_BSP: per-model hull table
// (selectModelHull), offset = clip_mins - mins + ent.origin. Everything else:
// temp 6-plane box hull in the reserved boxHullBase..+5 region, off{X,Y,Z} =
// entity origin (subtracted from start/end before tracing, added back on hit).
// sv.ts's fatal-abort guards are not modeled; selectModelHull's unreachable()
// stands in for them.
let offX: f64 = 0.0, offY: f64 = 0.0, offZ: f64 = 0.0;
function loadHullForEntity(entNum: i32, minsX: f64, minsY: f64, minsZ: f64, maxsX: f64, maxsY: f64, maxsZ: f64): void {
  const solid: i32 = <i32>edLoadFloat(entNum, F_SOLID);
  if (solid == SOLID_BSP) {
    const modelIdx: i32 = <i32>edLoadFloat(entNum, F_MODELINDEX);
    world.selectModelHull(modelIdx, minsX, minsY, minsZ, maxsX, maxsY, maxsZ);
    offX = world.selectedModelHullClipMinsX() - minsX + <f64>edLoadFloat(entNum, F_ORIGIN);
    offY = world.selectedModelHullClipMinsY() - minsY + <f64>edLoadFloat(entNum, F_ORIGIN1);
    offZ = world.selectedModelHullClipMinsZ() - minsZ + <f64>edLoadFloat(entNum, F_ORIGIN2);
    return;
  }

  const eMaxsX = <f64>edLoadFloat(entNum, F_MAXS);
  const eMinsX = <f64>edLoadFloat(entNum, F_MINS);
  const eMaxsY = <f64>edLoadFloat(entNum, F_MAXS1);
  const eMinsY = <f64>edLoadFloat(entNum, F_MINS1);
  const eMaxsZ = <f64>edLoadFloat(entNum, F_MAXS2);
  const eMinsZ = <f64>edLoadFloat(entNum, F_MINS2);

  // Carve base + connectivity are invalidated whenever initHullStorage runs (it can
  // run after initAreaTree, or re-run and zero the pools) — re-derive at use time.
  if (boxHullGen != world.hullStorageGeneration() || boxHullBase != world.maxClipnodes() - 6) {
    boxHullBase = world.maxClipnodes() - 6;
    boxHullGen = world.hullStorageGeneration();
    setupBoxHullConnectivity();
  }
  world.setPlane(boxHullBase + 0, 1.0, 0.0, 0.0, eMaxsX - minsX, 0);
  world.setPlane(boxHullBase + 1, 1.0, 0.0, 0.0, eMinsX - maxsX, 0);
  world.setPlane(boxHullBase + 2, 0.0, 1.0, 0.0, eMaxsY - minsY, 1);
  world.setPlane(boxHullBase + 3, 0.0, 1.0, 0.0, eMinsY - maxsY, 1);
  world.setPlane(boxHullBase + 4, 0.0, 0.0, 1.0, eMaxsZ - minsZ, 2);
  world.setPlane(boxHullBase + 5, 0.0, 0.0, 1.0, eMinsZ - maxsZ, 2);
  world.setHullMeta(boxHullBase, boxHullBase + 5);

  offX = <f64>edLoadFloat(entNum, F_ORIGIN);
  offY = <f64>edLoadFloat(entNum, F_ORIGIN1);
  offZ = <f64>edLoadFloat(entNum, F_ORIGIN2);
}

// sv.ts SV_ClipMoveToEntity (box-entity path). Writes the candidate trace fields.
function clipMoveToEntityBox(
  entNum: i32,
  sx: f64, sy: f64, sz: f64,
  minsX: f64, minsY: f64, minsZ: f64,
  maxsX: f64, maxsY: f64, maxsZ: f64,
  ex: f64, ey: f64, ez: f64,
): void {
  loadHullForEntity(entNum, minsX, minsY, minsZ, maxsX, maxsY, maxsZ);
  const adjSx = sx - offX, adjSy = sy - offY, adjSz = sz - offZ;
  const adjEx = ex - offX, adjEy = ey - offY, adjEz = ez - offZ;
  world.trace(adjSx, adjSy, adjSz, adjEx, adjEy, adjEz);

  candFraction = world.traceFraction();
  // trEnd is always adjusted-space — add offset back UNCONDITIONALLY (see clipToWorld).
  const endX = world.traceEndX() + offX, endY = world.traceEndY() + offY, endZ = world.traceEndZ() + offZ;
  candEndX = endX; candEndY = endY; candEndZ = endZ;
  candPlaneNX = world.tracePlaneNX(); candPlaneNY = world.tracePlaneNY(); candPlaneNZ = world.tracePlaneNZ();
  candPlaneDist = world.tracePlaneDist();
  candAllSolid = world.traceAllSolid() != 0;
  candStartSolid = world.traceStartSolid() != 0;
  candInOpen = world.traceInOpen() != 0;
  candInWater = world.traceInWater() != 0;
  candEnt = (candFraction < 1.0 || candStartSolid) ? entNum : -1;
}

// Top-level world clip of SV_Move: traces against the hull loaded into world.ts
// (setWorldHullRange), zero offset (worldspawn origin is always (0,0,0)).
let worldHullFirst: i32 = 0, worldHullLast: i32 = 0;
export function setWorldHullRange(firstclipnode: i32, lastclipnode: i32): void {
  worldHullFirst = firstclipnode;
  worldHullLast = lastclipnode;
}

// sv.ts pusherOverlaps: a ZERO-LENGTH clipMoveToEntity of a box against entNum's
// OWN hull, reporting startsolid. Goes through loadHullForEntity, so a SOLID_BSP
// entity is tested against its MODEL's clip hull (hullForEntity's SOLID_BSP
// branch) and everything else against the temp box hull -- a box hull for both
// would test a brush entity as its bounding BOX, which for any non-boxy brush
// (L-shaped water volume, sloped lava pit) claims riders the brush never touches.
// Restores the world hull range on the way out, as move() does.
export function clipEntityStartSolid(
  entNum: i32,
  px: f64, py: f64, pz: f64,
  minsX: f64, minsY: f64, minsZ: f64,
  maxsX: f64, maxsY: f64, maxsZ: f64,
): i32 {
  clipMoveToEntityBox(entNum, px, py, pz, minsX, minsY, minsZ, maxsX, maxsY, maxsZ, px, py, pz);
  const startSolid = candStartSolid;
  world.setHullMeta(worldHullFirst, worldHullLast);
  return startSolid ? 1 : 0;
}

// sv.ts's `clipMoveToEntity(edicts[0], ...)`: the world edict is SOLID_BSP, so the
// real hull-selection-by-box-size + clip_mins offset apply (world.selectWorldHull).
// setHullMeta re-installs hull 0's range every call so selectWorldHull has a valid
// range to fall back to, and callers that never install hull 1/2 stay on the
// original single-hull path.
function clipToWorld(
  sx: f64, sy: f64, sz: f64,
  minsX: f64, minsY: f64, minsZ: f64,
  maxsX: f64, maxsY: f64, maxsZ: f64,
  ex: f64, ey: f64, ez: f64,
): void {
  world.setHullMeta(worldHullFirst, worldHullLast);
  world.selectWorldHull(minsX, minsY, minsZ, maxsX, maxsY, maxsZ);
  const offX = world.selectedHullOffsetX(), offY = world.selectedHullOffsetY(), offZ = world.selectedHullOffsetZ();
  world.trace(sx - offX, sy - offY, sz - offZ, ex - offX, ey - offY, ez - offZ);

  candFraction = world.traceFraction();
  // world.trace's trEnd is ALWAYS adjusted (offset-subtracted) space, so add the
  // offset back UNCONDITIONALLY. sv.ts inits endpos to the REAL end and only re-adds
  // on hit; this port traces with the adjusted end, so the NO-HIT case needs it too —
  // else a box with a nonzero hull offset drifts every airborne frame and never lands.
  const endX = world.traceEndX() + offX, endY = world.traceEndY() + offY, endZ = world.traceEndZ() + offZ;
  candEndX = endX; candEndY = endY; candEndZ = endZ;
  candPlaneNX = world.tracePlaneNX(); candPlaneNY = world.tracePlaneNY(); candPlaneNZ = world.tracePlaneNZ();
  candPlaneDist = world.tracePlaneDist();
  candAllSolid = world.traceAllSolid() != 0;
  candStartSolid = world.traceStartSolid() != 0;
  candInOpen = world.traceInOpen() != 0;
  candInWater = world.traceInWater() != 0;
  candEnt = (candFraction < 1.0 || candStartSolid) ? 0 : -1; // 0 == the world edict
}

// move()'s clip parameters (sv.ts's `clip: Clip`) — one call in flight, non-reentrant.
let clipStartX: f64, clipStartY: f64, clipStartZ: f64;
let clipEndX: f64, clipEndY: f64, clipEndZ: f64;
let clipMinsX: f64, clipMinsY: f64, clipMinsZ: f64;
let clipMaxsX: f64, clipMaxsY: f64, clipMaxsZ: f64;
let clipMins2X: f64, clipMins2Y: f64, clipMins2Z: f64;
let clipMaxs2X: f64, clipMaxs2Y: f64, clipMaxs2Z: f64;
let clipBoxMinsX: f64, clipBoxMinsY: f64, clipBoxMinsZ: f64;
let clipBoxMaxsX: f64, clipBoxMaxsY: f64, clipBoxMaxsZ: f64;
let clipType: i32;
let clipPassEnt: i32; // -1 == JS passedict === null

// sv.ts SV_ClipToLinks.
function clipToLinks(node: i32): void {
  const solidSentinel = node * 2;
  let l = linkNext(solidSentinel);
  while (l != solidSentinel) {
    const next = linkNext(l);
    const touch = l - SENTINEL_COUNT;

    const solid: i32 = <i32>edLoadFloat(touch, F_SOLID);
    if (solid == SOLID_NOT || touch == clipPassEnt) { l = next; continue; }
    if (solid == SOLID_TRIGGER) { l = next; continue; } // skip instead of vanilla Sys_Error("Trigger in clipping list") — a runtime-spawned trigger can transiently land in the solid list mid-relink
    if (solid == SOLID_BSP) {
      const skin: i32 = <i32>edLoadFloat(touch, F_SKIN);
      if (skin < 0) { l = next; continue; } // FTE_ENT_SKIN_CONTENTS: invisible to movement
    }
    if (clipType == MOVE_NOMONSTERS && solid != SOLID_BSP) { l = next; continue; }

    const tAbsMinX = <f64>edLoadFloat(touch, F_ABSMIN), tAbsMinY = <f64>edLoadFloat(touch, F_ABSMIN1), tAbsMinZ = <f64>edLoadFloat(touch, F_ABSMIN2);
    const tAbsMaxX = <f64>edLoadFloat(touch, F_ABSMAX), tAbsMaxY = <f64>edLoadFloat(touch, F_ABSMAX1), tAbsMaxZ = <f64>edLoadFloat(touch, F_ABSMAX2);
    if (clipBoxMinsX > tAbsMaxX || clipBoxMinsY > tAbsMaxY || clipBoxMinsZ > tAbsMaxZ ||
      clipBoxMaxsX < tAbsMinX || clipBoxMaxsY < tAbsMinY || clipBoxMaxsZ < tAbsMinZ) { l = next; continue; }

    if (clipPassEnt != -1) {
      const passSize = <f64>edLoadFloat(clipPassEnt, F_SIZE);
      const touchSize = <f64>edLoadFloat(touch, F_SIZE);
      if (passSize != 0.0 && touchSize == 0.0) { l = next; continue; }
    }

    if (outAllSolid) return;

    if (clipPassEnt != -1) {
      const touchOwner = edLoadInt(touch, F_OWNER);
      if (touchOwner == clipPassEnt) { l = next; continue; }
      const passOwner = edLoadInt(clipPassEnt, F_OWNER);
      if (passOwner == touch) { l = next; continue; }
    }

    const flags: i32 = <i32>edLoadFloat(touch, F_FLAGS);
    if ((flags & FL_MONSTER) != 0) {
      clipMoveToEntityBox(touch, clipStartX, clipStartY, clipStartZ, clipMins2X, clipMins2Y, clipMins2Z, clipMaxs2X, clipMaxs2Y, clipMaxs2Z, clipEndX, clipEndY, clipEndZ);
    } else {
      clipMoveToEntityBox(touch, clipStartX, clipStartY, clipStartZ, clipMinsX, clipMinsY, clipMinsZ, clipMaxsX, clipMaxsY, clipMaxsZ, clipEndX, clipEndY, clipEndZ);
    }
    // Exact-fraction tie-break by lowest edict num — MUST match sv.ts clipToLinks
    // (cross-sim determinism at coplanar bmodel seams).
    if (candAllSolid || candStartSolid || candFraction < outFraction ||
        (candFraction == outFraction && candEnt != -1 && outEnt != -1 && candEnt < outEnt)) {
      copyCandToOut();
    }

    l = next;
  }

  const axis = loadAreaAxis(node);
  if (axis == -1) return;
  const dist = loadAreaDist(node);
  if ((axis == 0 ? clipBoxMaxsX : clipBoxMaxsY) > dist) clipToLinks(loadAreaChild0(node));
  if ((axis == 0 ? clipBoxMinsX : clipBoxMinsY) < dist) clipToLinks(loadAreaChild1(node));
}

// sv.ts SV_Move. passEnt = -1 for a null passedict.
export function move(
  sx: f64, sy: f64, sz: f64,
  minsX: f64, minsY: f64, minsZ: f64,
  maxsX: f64, maxsY: f64, maxsZ: f64,
  ex: f64, ey: f64, ez: f64,
  moveType: i32, passEnt: i32,
): void {
  clipToWorld(sx, sy, sz, minsX, minsY, minsZ, maxsX, maxsY, maxsZ, ex, ey, ez);
  copyCandToOut(); // clip.trace = clipMoveToEntity(edicts[0], ...) in sv.ts

  clipStartX = sx; clipStartY = sy; clipStartZ = sz;
  clipEndX = ex; clipEndY = ey; clipEndZ = ez;
  clipMinsX = minsX; clipMinsY = minsY; clipMinsZ = minsZ;
  clipMaxsX = maxsX; clipMaxsY = maxsY; clipMaxsZ = maxsZ;
  clipType = moveType;
  clipPassEnt = passEnt;

  if (moveType == MOVE_MISSILE) {
    clipMins2X = -15.0; clipMins2Y = -15.0; clipMins2Z = -15.0;
    clipMaxs2X = 15.0; clipMaxs2Y = 15.0; clipMaxs2Z = 15.0;
  } else {
    clipMins2X = minsX; clipMins2Y = minsY; clipMins2Z = minsZ;
    clipMaxs2X = maxsX; clipMaxs2Y = maxsY; clipMaxs2Z = maxsZ;
  }

  // moveBounds (sv.ts's inline boxmins/boxmaxs loop in SV_Move).
  if (ex > sx) { clipBoxMinsX = sx + clipMins2X - 1.0; clipBoxMaxsX = ex + clipMaxs2X + 1.0; }
  else { clipBoxMinsX = ex + clipMins2X - 1.0; clipBoxMaxsX = sx + clipMaxs2X + 1.0; }
  if (ey > sy) { clipBoxMinsY = sy + clipMins2Y - 1.0; clipBoxMaxsY = ey + clipMaxs2Y + 1.0; }
  else { clipBoxMinsY = ey + clipMins2Y - 1.0; clipBoxMaxsY = sy + clipMaxs2Y + 1.0; }
  if (ez > sz) { clipBoxMinsZ = sz + clipMins2Z - 1.0; clipBoxMaxsZ = ez + clipMaxs2Z + 1.0; }
  else { clipBoxMinsZ = ez + clipMins2Z - 1.0; clipBoxMaxsZ = sz + clipMaxs2Z + 1.0; }

  clipToLinks(0); // areanodes[0], the root

  // Restore the world hull range (clipToLinks repointed it at the box-hull region)
  // so pointContents() stays valid afterward.
  world.setHullMeta(worldHullFirst, worldHullLast);
}

// ================================================================================
// FTE_ENT_SKIN_CONTENTS (sv.ts skinContentsAt / pointContentsAllBsps): negative-skin
// SOLID_BSP entities are invisible to movement (clipToLinks skips them) but override
// point contents: skin -3 = water volume, -16 = ladder.
// ================================================================================
let skinListBase: usize = 0;   // per-frame list of negative-skin SOLID_BSP edict nums
let skinListCount: i32 = 0;

// sv.ts physics() pre-loop rebuild. Entries are re-validated live in skinContentsAt
// (a mid-frame free/solid/skin change is caught at query time).
export function rebuildSkinContents(numEdicts: i32): void {
  let n: i32 = 0;
  for (let e: i32 = 1; e < numEdicts; ++e) {
    if (getEdictFree(e)) continue;
    if ((<i32>edLoadFloat(e, F_SOLID)) != SOLID_BSP) continue;
    if ((<i32>edLoadFloat(e, F_SKIN)) >= 0) continue;
    store<i32>(skinListBase + (<usize>n << 2), e);
    ++n;
  }
  skinListCount = n;
}
export function skinContentsCount(): i32 { return skinListCount; }

// sv.ts skinContentsAt: overlapping negative-skin SOLID_BSP entities override
// `cont` with their skin (ascending edict num, last wins).
export function skinContentsAt(
  px: f64, py: f64, pz: f64,
  minsX: f64, minsY: f64, minsZ: f64,
  maxsX: f64, maxsY: f64, maxsZ: f64,
  ignore: i32, cont: i32,
): i32 {
  let loadedHull = false;
  for (let i: i32 = 0; i < skinListCount; ++i) {
    const touch: i32 = load<i32>(skinListBase + (<usize>i << 2));
    if (touch == ignore || getEdictFree(touch)) continue;
    if ((<i32>edLoadFloat(touch, F_SOLID)) != SOLID_BSP) continue;
    const skin: i32 = <i32>edLoadFloat(touch, F_SKIN);
    if (skin >= 0) continue;
    if (px + maxsX < <f64>edLoadFloat(touch, F_ABSMIN) ||
        py + maxsY < <f64>edLoadFloat(touch, F_ABSMIN1) ||
        pz + maxsZ < <f64>edLoadFloat(touch, F_ABSMIN2) ||
        px + minsX > <f64>edLoadFloat(touch, F_ABSMAX) ||
        py + minsY > <f64>edLoadFloat(touch, F_ABSMAX1) ||
        pz + minsZ > <f64>edLoadFloat(touch, F_ABSMAX2))
      continue;
    loadHullForEntity(touch, minsX, minsY, minsZ, maxsX, maxsY, maxsZ);
    loadedHull = true;
    if (world.hullPointContents(world.selectedHullFirstClipnode(), px - offX, py - offY, pz - offZ) == CONTENTS_SOLID)
      cont = skin;
  }
  // Restore the world hull (loadHullForEntity repointed the hull meta).
  if (loadedHull) world.setHullMeta(worldHullFirst, worldHullLast);
  return cont;
}

// sv.ts pointContentsAllBsps: world contents, overridden by an overlapping
// negative-skin SOLID_BSP entity's skin value.
export function pointContentsAllBsps(px: f64, py: f64, pz: f64, ignore: i32): i32 {
  const c: i32 = world.pointContents(px, py, pz);
  if (skinListCount == 0) return c;
  return skinContentsAt(px, py, pz, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, ignore, c);
}

// --- move() result getters ------------------------------------------------------
export function moveTraceFraction(): f64 { return outFraction; }
export function moveTraceEndX(): f64 { return outEndX; }
export function moveTraceEndY(): f64 { return outEndY; }
export function moveTraceEndZ(): f64 { return outEndZ; }
export function moveTracePlaneNX(): f64 { return outPlaneNX; }
export function moveTracePlaneNY(): f64 { return outPlaneNY; }
export function moveTracePlaneNZ(): f64 { return outPlaneNZ; }
export function moveTracePlaneDist(): f64 { return outPlaneDist; }
export function moveTraceAllSolid(): i32 { return outAllSolid ? 1 : 0; }
export function moveTraceStartSolid(): i32 { return outStartSolid ? 1 : 0; }
export function moveTraceInOpen(): i32 { return outInOpen ? 1 : 0; }
export function moveTraceInWater(): i32 { return outInWater ? 1 : 0; }
export function moveTraceEnt(): i32 { return outEnt; } // -1 == null
