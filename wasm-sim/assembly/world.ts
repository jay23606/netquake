// Collision core — port of src/engine/sv.ts recursiveHullCheck/hullPointContents/
// pointContents (the BSP clip-hull trace). Install a hull via the loaders below,
// then trace(); results via getters.
// This path is f64 throughout in the JS reference (vec.ts V3s and HullFlat plane
// mirrors are f64) — no f32-store-once step to replicate here.

// --- Hull storage (linear memory, SoA) ----------------------------------------
// Clipnode/plane pools are sized to the loaded BSP at init (initHullStorage), not
// a compile-time cap (mod.ts sizes to the lump; AD-scale maps exceed any constant).
let clipCapacity: i32 = 0;
let planeCapacity: i32 = 0;

// Scratch slots reserved at the TOP of both pools for the synthetic hull other
// modules carve via maxClipnodes()-N (co-indexed: clipnode K uses plane K):
// svmove.ts's box hull at -6..-1. Without this reserve the carve overwrites REAL
// clipnodes/planes at the top of the pools -> false allSolid.
const HULL_SCRATCH: i32 = 16; // >= the 6 slots the box hull actually uses

// Hull 0 (point hull) clipnode storage — installed/selected by setPlane/
// setClipNode/setHullMeta.
let CLIP_PLANE: usize = 0;  // i32 planenum per clipnode
let CLIP_CHILD0: usize = 0; // i32 children[0]
let CLIP_CHILD1: usize = 0; // i32 children[1]

// Hull 1/2 clipnode storage. In mod.ts, hulls[1] and hulls[2] are two firstclipnode
// entry points into the SAME clipnodes array, not two separate trees: one shared
// region here, per-hull firstclipnode/clip_mins (installHull1/installHull2).
let CLIP12_PLANE: usize = 0;
let CLIP12_CHILD0: usize = 0;
let CLIP12_CHILD1: usize = 0;

// Planes are shared across ALL THREE hulls (mod.ts: all reference loadmodel.planes).
let PLANE_NX: usize = 0;   // f64 normal.x
let PLANE_NY: usize = 0;   // f64 normal.y
let PLANE_NZ: usize = 0;   // f64 normal.z
let PLANE_DIST: usize = 0; // f64 dist
let PLANE_TYPE: usize = 0; // i32 type (0/1/2 axial, >=3 generic)

// Allocate the clipnode/plane pools: nClip = largest clipnode count across the
// world hulls, nPlanes = plane lump length. Called once per map before the
// loaders run. heap.alloc does NOT guarantee zeroed memory — filled explicitly.
export function initHullStorage(nClip: i32, nPlanes: i32): void {
  // One shared capacity = max(nClip, nPlanes) + HULL_SCRATCH: the box/pusher carves
  // index the SAME slot into both pools, so both must keep the top slots free.
  const cap: i32 = (nClip > nPlanes ? nClip : nPlanes) + HULL_SCRATCH;
  hullStorageGen++; // fresh (zeroed) pools — carve owners must rewire their connectivity
  clipCapacity = cap;
  planeCapacity = cap;
  const clipBytes: usize = <usize>cap * 4;
  const planeBytesF: usize = <usize>cap * 8;
  const planeBytesI: usize = <usize>cap * 4;
  CLIP_PLANE = heap.alloc(clipBytes);   memory.fill(CLIP_PLANE, 0, clipBytes);
  CLIP_CHILD0 = heap.alloc(clipBytes);  memory.fill(CLIP_CHILD0, 0, clipBytes);
  CLIP_CHILD1 = heap.alloc(clipBytes);  memory.fill(CLIP_CHILD1, 0, clipBytes);
  CLIP12_PLANE = heap.alloc(clipBytes);  memory.fill(CLIP12_PLANE, 0, clipBytes);
  CLIP12_CHILD0 = heap.alloc(clipBytes); memory.fill(CLIP12_CHILD0, 0, clipBytes);
  CLIP12_CHILD1 = heap.alloc(clipBytes); memory.fill(CLIP12_CHILD1, 0, clipBytes);
  PLANE_NX = heap.alloc(planeBytesF);   memory.fill(PLANE_NX, 0, planeBytesF);
  PLANE_NY = heap.alloc(planeBytesF);   memory.fill(PLANE_NY, 0, planeBytesF);
  PLANE_NZ = heap.alloc(planeBytesF);   memory.fill(PLANE_NZ, 0, planeBytesF);
  PLANE_DIST = heap.alloc(planeBytesF); memory.fill(PLANE_DIST, 0, planeBytesF);
  PLANE_TYPE = heap.alloc(planeBytesI); memory.fill(PLANE_TYPE, 0, planeBytesI);
  curClipPlaneBase = CLIP_PLANE;
  curClipChild0Base = CLIP_CHILD0;
  curClipChild1Base = CLIP_CHILD1;
}

// Buffer base pointers for BULK marshaling: the embedder writes the SoA arrays
// through typed-array views over these (per-element setters stay for the parity
// harnesses). Valid only after initHullStorage — a heap.alloc there may have
// grown/detached the memory; take these AFTER it returns.
export function clipPlanePtr(): usize { return CLIP_PLANE; }
export function clipChild0Ptr(): usize { return CLIP_CHILD0; }
export function clipChild1Ptr(): usize { return CLIP_CHILD1; }
export function clip12PlanePtr(): usize { return CLIP12_PLANE; }
export function clip12Child0Ptr(): usize { return CLIP12_CHILD0; }
export function clip12Child1Ptr(): usize { return CLIP12_CHILD1; }
export function planeNXPtr(): usize { return PLANE_NX; }
export function planeNYPtr(): usize { return PLANE_NY; }
export function planeNZPtr(): usize { return PLANE_NZ; }
export function planeDistPtr(): usize { return PLANE_DIST; }
export function planeTypePtr(): usize { return PLANE_TYPE; }

@inline function loadF64(base: usize, idx: i32): f64 { return load<f64>(base + (<usize>idx << 3)); }
@inline function storeF64(base: usize, idx: i32, v: f64): void { store<f64>(base + (<usize>idx << 3), v); }
@inline function loadI32(base: usize, idx: i32): i32 { return load<i32>(base + (<usize>idx << 2)); }
@inline function storeI32(base: usize, idx: i32, v: i32): void { store<i32>(base + (<usize>idx << 2), v); }

let hullFirstClipnode: i32 = 0;
let hullLastClipnode: i32 = 0;

// --- "current hull" indirection ------------------------------------------------
// hullPointContents/recursiveHullCheck/trace read clipnode storage through these
// bases, so the same recursion works against hull 0's or the shared hull-1/2
// storage, whichever was last selected. Default = hull 0.
let curClipPlaneBase: usize = CLIP_PLANE;
let curClipChild0Base: usize = CLIP_CHILD0;
let curClipChild1Base: usize = CLIP_CHILD1;

// Hull 0's installed range, kept separately so selecting hull 0 again after a
// hull 1/2 selection can restore it exactly.
let hull0FirstStored: i32 = 0;
let hull0LastStored: i32 = 0;

// Hull 1/2 metadata. *Installed is the back-compat flag: selectWorldHull only does
// size-based selection once BOTH are installed; otherwise hull 0, zero offset.
let hull1First: i32 = 0, hull1Last: i32 = 0;
let hull1ClipMinsX: f64 = 0.0, hull1ClipMinsY: f64 = 0.0, hull1ClipMinsZ: f64 = 0.0;
let hull1Installed: bool = false;

let hull2First: i32 = 0, hull2Last: i32 = 0;
let hull2ClipMinsX: f64 = 0.0, hull2ClipMinsY: f64 = 0.0, hull2ClipMinsZ: f64 = 0.0;
let hull2Installed: bool = false;

// selectWorldHull's result: last-selected id + world-space offset
// (hull.clip_mins - moveMins) to subtract from start/end before tracing and add
// back to a non-full-fraction endpos afterward.
let selOffX: f64 = 0.0, selOffY: f64 = 0.0, selOffZ: f64 = 0.0;
let selectedHullIdG: i32 = 0;

// mod.ts CONTENTS_* (children[] entries < 0 are these).
const CONTENTS_EMPTY: i32 = -1;
const CONTENTS_SOLID: i32 = -2;
const CONTENTS_WATER: i32 = -3;
const CONTENTS_CURRENT_0: i32 = -9;
const CONTENTS_CURRENT_DOWN: i32 = -14;

export function maxClipnodes(): i32 { return clipCapacity; }
export function maxPlanes(): i32 { return planeCapacity; }
// Bumped by every initHullStorage call (even same-size: pools are re-zeroed). Carve
// owners compare at use time and rewire connectivity when pools were re-allocated.
let hullStorageGen: i32 = 0;
export function hullStorageGeneration(): i32 { return hullStorageGen; }

// --- Loaders (JS-callable) ------------------------------------------------------

// Back-compat entry point: installs/selects hull 0 and repoints the "current hull"
// indirection at hull 0's storage, unconditionally.
export function setHullMeta(firstclipnode: i32, lastclipnode: i32): void {
  hull0FirstStored = firstclipnode;
  hull0LastStored = lastclipnode;
  hullFirstClipnode = firstclipnode;
  hullLastClipnode = lastclipnode;
  curClipPlaneBase = CLIP_PLANE;
  curClipChild0Base = CLIP_CHILD0;
  curClipChild1Base = CLIP_CHILD1;
  selOffX = 0.0; selOffY = 0.0; selOffZ = 0.0;
  selectedHullIdG = 0;
}

export function setPlane(idx: i32, nx: f64, ny: f64, nz: f64, dist: f64, ptype: i32): void {
  storeF64(PLANE_NX, idx, nx);
  storeF64(PLANE_NY, idx, ny);
  storeF64(PLANE_NZ, idx, nz);
  storeF64(PLANE_DIST, idx, dist);
  storeI32(PLANE_TYPE, idx, ptype);
}

export function setClipNode(idx: i32, planenum: i32, child0: i32, child1: i32): void {
  storeI32(CLIP_PLANE, idx, planenum);
  storeI32(CLIP_CHILD0, idx, child0);
  storeI32(CLIP_CHILD1, idx, child1);
}

// Hull 1/2 shared clipnode storage loader.
export function setClipNode12(idx: i32, planenum: i32, child0: i32, child1: i32): void {
  storeI32(CLIP12_PLANE, idx, planenum);
  storeI32(CLIP12_CHILD0, idx, child0);
  storeI32(CLIP12_CHILD1, idx, child1);
}

// Installs hull 1 (player-size hull). clipMins = hull.clip_mins (hullForEntity's
// offset term); clip_maxs is never read by that math so it is not stored.
export function installHull1(firstclipnode: i32, lastclipnode: i32, clipMinsX: f64, clipMinsY: f64, clipMinsZ: f64): void {
  hull1First = firstclipnode;
  hull1Last = lastclipnode;
  hull1ClipMinsX = clipMinsX; hull1ClipMinsY = clipMinsY; hull1ClipMinsZ = clipMinsZ;
  hull1Installed = true;
}

// Installs hull 2 (large-monster-size hull).
export function installHull2(firstclipnode: i32, lastclipnode: i32, clipMinsX: f64, clipMinsY: f64, clipMinsZ: f64): void {
  hull2First = firstclipnode;
  hull2Last = lastclipnode;
  hull2ClipMinsX = clipMinsX; hull2ClipMinsY = clipMinsY; hull2ClipMinsZ = clipMinsZ;
  hull2Installed = true;
}

// sv.ts hullForEntity's hull-selection-by-box-size, applied to the WORLD hull
// (world origin is (0,0,0), so the "+ ent.origin" offset term drops out):
//   size = maxs[0] - mins[0]   (X-AXIS ONLY -- exact vanilla quirk)
//   size < 3.0 -> hull 0; size <= 32.0 -> hull 1; else hull 2
//   offset[i] = hull.clip_mins[i] - mins[i]
// BACK-COMPAT: size-based selection only once BOTH hull 1/2 are installed. Until
// then this always selects hull 0 with a ZERO offset (pre-hull-1/2 behavior),
// NOT hullForEntity's literal `0 - mins` (see worldhulls.test.mjs).
export function selectWorldHull(minsX: f64, minsY: f64, minsZ: f64, maxsX: f64, maxsY: f64, maxsZ: f64): i32 {
  const multiHull: bool = hull1Installed && hull2Installed;
  let hullId: i32 = 0;
  if (multiHull) {
    const size: f64 = maxsX - minsX;
    if (size < 3.0) hullId = 0;
    else if (size <= 32.0) hullId = 1;
    else hullId = 2;
  }

  let clipMinsX: f64 = 0.0, clipMinsY: f64 = 0.0, clipMinsZ: f64 = 0.0;
  if (hullId == 1) {
    curClipPlaneBase = CLIP12_PLANE; curClipChild0Base = CLIP12_CHILD0; curClipChild1Base = CLIP12_CHILD1;
    hullFirstClipnode = hull1First; hullLastClipnode = hull1Last;
    clipMinsX = hull1ClipMinsX; clipMinsY = hull1ClipMinsY; clipMinsZ = hull1ClipMinsZ;
  } else if (hullId == 2) {
    curClipPlaneBase = CLIP12_PLANE; curClipChild0Base = CLIP12_CHILD0; curClipChild1Base = CLIP12_CHILD1;
    hullFirstClipnode = hull2First; hullLastClipnode = hull2Last;
    clipMinsX = hull2ClipMinsX; clipMinsY = hull2ClipMinsY; clipMinsZ = hull2ClipMinsZ;
  } else {
    curClipPlaneBase = CLIP_PLANE; curClipChild0Base = CLIP_CHILD0; curClipChild1Base = CLIP_CHILD1;
    hullFirstClipnode = hull0FirstStored; hullLastClipnode = hull0LastStored;
    clipMinsX = 0.0; clipMinsY = 0.0; clipMinsZ = 0.0; // hull0.clip_mins is always (0,0,0)
  }

  if (multiHull) {
    selOffX = clipMinsX - minsX; selOffY = clipMinsY - minsY; selOffZ = clipMinsZ - minsZ;
  } else {
    selOffX = 0.0; selOffY = 0.0; selOffZ = 0.0; // back-compat: see header note
  }

  selectedHullIdG = hullId;
  return hullId;
}

export function selectedHullOffsetX(): f64 { return selOffX; }
export function selectedHullOffsetY(): f64 { return selOffY; }
export function selectedHullOffsetZ(): f64 { return selOffZ; }
export function selectedHullId(): i32 { return selectedHullIdG; }
export function selectedHullFirstClipnode(): i32 { return hullFirstClipnode; }
export function selectedHullLastClipnode(): i32 { return hullLastClipnode; }

// --- Per-model hull table (bmodel/submodel SOLID_BSP entities) -----------------
// In mod.ts every submodel of the BSP shares the world's clipnode/plane pools —
// only firstclipnode/lastclipnode/clip_mins differ per model per hull. This table
// stores ONLY that metadata and reuses the CLIP_*/CLIP12_*/PLANE_* pools above.
// installModelHull's caller must have already loaded the model's clipnode range
// via setClipNode (hull 0) / setClipNode12 (hull 1/2).
const MAX_MODELS: i32 = 1 << 13; // 8192 -- Ironwail's MAX_MODELS
const MODEL_HULL_FIRST: usize = memory.data(MAX_MODELS * 3 * 4); // i32, indexed by modelIdx*3+hullId
const MODEL_HULL_LAST: usize = memory.data(MAX_MODELS * 3 * 4);  // i32
const MODEL_HULL_CMX: usize = memory.data(MAX_MODELS * 3 * 8);   // f64 clip_mins.x
const MODEL_HULL_CMY: usize = memory.data(MAX_MODELS * 3 * 8);   // f64 clip_mins.y
const MODEL_HULL_CMZ: usize = memory.data(MAX_MODELS * 3 * 8);   // f64 clip_mins.z

export function maxModels(): i32 { return MAX_MODELS; }

// Installs hull `hullId` (0/1/2) of model `modelIdx`: clipnode range + clip_mins.
// Call once per precached model per hull, after the shared pools carry that range.
export function installModelHull(
  modelIdx: i32, hullId: i32,
  firstclipnode: i32, lastclipnode: i32,
  clipMinsX: f64, clipMinsY: f64, clipMinsZ: f64,
): void {
  if (modelIdx < 0 || modelIdx >= MAX_MODELS || hullId < 0 || hullId > 2) unreachable();
  const idx = modelIdx * 3 + hullId;
  storeI32(MODEL_HULL_FIRST, idx, firstclipnode);
  storeI32(MODEL_HULL_LAST, idx, lastclipnode);
  storeF64(MODEL_HULL_CMX, idx, clipMinsX);
  storeF64(MODEL_HULL_CMY, idx, clipMinsY);
  storeF64(MODEL_HULL_CMZ, idx, clipMinsZ);
}

let selModelClipMinsX: f64 = 0.0, selModelClipMinsY: f64 = 0.0, selModelClipMinsZ: f64 = 0.0;
let selectedModelHullIdG: i32 = 0;

// sv.ts hullForEntity's SOLID_BSP branch, for any precached model:
//   size = maxs[0] - mins[0]  (X-AXIS ONLY) -> hull 0/1/2 as in selectWorldHull.
// Repoints the "current hull" indirection. Callers must restore via setHullMeta
// before any subsequent world-hull pointContents()/hullPointContents() call
// (svmove.ts move() does this at the end of every call).
export function selectModelHull(
  modelIdx: i32,
  minsX: f64, minsY: f64, minsZ: f64,
  maxsX: f64, maxsY: f64, maxsZ: f64,
): i32 {
  if (modelIdx < 0 || modelIdx >= MAX_MODELS) unreachable();
  const size: f64 = maxsX - minsX;
  let hullId: i32 = 0;
  if (size < 3.0) hullId = 0;
  else if (size <= 32.0) hullId = 1;
  else hullId = 2;

  const idx = modelIdx * 3 + hullId;
  if (hullId == 0) {
    curClipPlaneBase = CLIP_PLANE; curClipChild0Base = CLIP_CHILD0; curClipChild1Base = CLIP_CHILD1;
  } else {
    curClipPlaneBase = CLIP12_PLANE; curClipChild0Base = CLIP12_CHILD0; curClipChild1Base = CLIP12_CHILD1;
  }
  hullFirstClipnode = loadI32(MODEL_HULL_FIRST, idx);
  hullLastClipnode = loadI32(MODEL_HULL_LAST, idx);
  selModelClipMinsX = loadF64(MODEL_HULL_CMX, idx);
  selModelClipMinsY = loadF64(MODEL_HULL_CMY, idx);
  selModelClipMinsZ = loadF64(MODEL_HULL_CMZ, idx);
  selectedModelHullIdG = hullId;
  return hullId;
}

export function selectedModelHullClipMinsX(): f64 { return selModelClipMinsX; }
export function selectedModelHullClipMinsY(): f64 { return selModelClipMinsY; }
export function selectedModelHullClipMinsZ(): f64 { return selModelClipMinsZ; }
export function selectedModelHullId(): i32 { return selectedModelHullIdG; }

// --- Trace result (module-level scalars; exposed via getters below) ------------
// sv.ts Trace: fraction, endpos, plane, allsolid/startsolid/inopen/inwater.

let trFraction: f64 = 1.0;
let trEndX: f64 = 0.0, trEndY: f64 = 0.0, trEndZ: f64 = 0.0;
let trPlaneNX: f64 = 0.0, trPlaneNY: f64 = 0.0, trPlaneNZ: f64 = 0.0, trPlaneDist: f64 = 0.0;
let trAllSolid: bool = true;
let trStartSolid: bool = false;
let trInOpen: bool = false;
let trInWater: bool = false;

export function traceFraction(): f64 { return trFraction; }
export function traceEndX(): f64 { return trEndX; }
export function traceEndY(): f64 { return trEndY; }
export function traceEndZ(): f64 { return trEndZ; }
export function tracePlaneNX(): f64 { return trPlaneNX; }
export function tracePlaneNY(): f64 { return trPlaneNY; }
export function tracePlaneNZ(): f64 { return trPlaneNZ; }
export function tracePlaneDist(): f64 { return trPlaneDist; }
export function traceAllSolid(): i32 { return trAllSolid ? 1 : 0; }
export function traceStartSolid(): i32 { return trStartSolid ? 1 : 0; }
export function traceInOpen(): i32 { return trInOpen ? 1 : 0; }
export function traceInWater(): i32 { return trInWater ? 1 : 0; }

// sv.ts hullPointContents.
export function hullPointContents(num: i32, px: f64, py: f64, pz: f64): i32 {
  while (num >= 0) {
    if (num < hullFirstClipnode || num > hullLastClipnode) unreachable();
    const pn = loadI32(curClipPlaneBase, num);
    const ptype = loadI32(PLANE_TYPE, pn);
    let d: f64;
    if (ptype <= 2) {
      if (ptype == 0) d = px - loadF64(PLANE_DIST, pn);
      else if (ptype == 1) d = py - loadF64(PLANE_DIST, pn);
      else d = pz - loadF64(PLANE_DIST, pn);
    } else {
      d = loadF64(PLANE_NX, pn) * px + loadF64(PLANE_NY, pn) * py + loadF64(PLANE_NZ, pn) * pz - loadF64(PLANE_DIST, pn);
    }
    if (d >= 0.0) num = loadI32(curClipChild0Base, num);
    else num = loadI32(curClipChild1Base, num);
  }
  return num;
}

// sv.ts pointContents: hull 0 from the root, folding current_0..current_down into water.
export function pointContents(px: f64, py: f64, pz: f64): i32 {
  const cont = hullPointContents(0, px, py, pz);
  if (cont <= CONTENTS_CURRENT_0 && cont >= CONTENTS_CURRENT_DOWN) return CONTENTS_WATER;
  return cont;
}

// sv.ts recursiveHullCheck. Mutates the module-level trace fields; the
// con.dPrint('backup past 0\n') on the give-up path is omitted (pure diagnostic).
function recursiveHullCheck(
  num: i32, p1f: f64, p2f: f64,
  p1x: f64, p1y: f64, p1z: f64,
  p2x: f64, p2y: f64, p2z: f64,
): bool {
  if (num < 0) {
    if (num != CONTENTS_SOLID) {
      trAllSolid = false;
      if (num == CONTENTS_EMPTY) trInOpen = true;
      else trInWater = true;
    } else {
      trStartSolid = true;
    }
    return true;
  }

  if (num < hullFirstClipnode || num > hullLastClipnode) unreachable();

  const pn = loadI32(curClipPlaneBase, num);
  const child0 = loadI32(curClipChild0Base, num);
  const child1 = loadI32(curClipChild1Base, num);
  const pdist = loadF64(PLANE_DIST, pn);
  const nx = loadF64(PLANE_NX, pn);
  const ny = loadF64(PLANE_NY, pn);
  const nz = loadF64(PLANE_NZ, pn);
  const ptype = loadI32(PLANE_TYPE, pn);

  let t1: f64, t2: f64;
  if (ptype <= 2) {
    if (ptype == 0) { t1 = p1x - pdist; t2 = p2x - pdist; }
    else if (ptype == 1) { t1 = p1y - pdist; t2 = p2y - pdist; }
    else { t1 = p1z - pdist; t2 = p2z - pdist; }
  } else {
    t1 = nx * p1x + ny * p1y + nz * p1z - pdist;
    t2 = nx * p2x + ny * p2y + nz * p2z - pdist;
  }

  if (t1 >= 0.0 && t2 >= 0.0) return recursiveHullCheck(child0, p1f, p2f, p1x, p1y, p1z, p2x, p2y, p2z);
  if (t1 < 0.0 && t2 < 0.0) return recursiveHullCheck(child1, p1f, p2f, p1x, p1y, p1z, p2x, p2y, p2z);

  let frac: f64 = (t1 + (t1 < 0.0 ? 0.03125 : -0.03125)) / (t1 - t2);
  if (frac < 0.0) frac = 0.0;
  else if (frac > 1.0) frac = 1.0;
  const midf: f64 = p1f + (p2f - p1f) * frac;
  const midx: f64 = p1x + frac * (p2x - p1x);
  const midy: f64 = p1y + frac * (p2y - p1y);
  const midz: f64 = p1z + frac * (p2z - p1z);
  const side: i32 = t1 < 0.0 ? 1 : 0;

  if (!recursiveHullCheck(side == 0 ? child0 : child1, p1f, midf, p1x, p1y, p1z, midx, midy, midz))
    return false;

  if (hullPointContents(side == 0 ? child1 : child0, midx, midy, midz) != CONTENTS_SOLID)
    return recursiveHullCheck(side == 0 ? child1 : child0, midf, p2f, midx, midy, midz, p2x, p2y, p2z);

  if (trAllSolid) return false;

  if (side == 0) {
    trPlaneNX = nx; trPlaneNY = ny; trPlaneNZ = nz; trPlaneDist = pdist;
  } else {
    trPlaneNX = -nx; trPlaneNY = -ny; trPlaneNZ = -nz; trPlaneDist = -pdist;
  }

  // "Backup" loop reuses THIS call's own p1f/p2f/p1/p2 (the function params),
  // not the mid point's parent range, as sv.ts does.
  let f2: f64 = frac;
  let mx: f64 = midx, my: f64 = midy, mz: f64 = midz, mf: f64 = midf;
  while (hullPointContents(hullFirstClipnode, mx, my, mz) == CONTENTS_SOLID) {
    f2 -= 0.1;
    if (f2 < 0.0) {
      trFraction = mf;
      trEndX = mx; trEndY = my; trEndZ = mz;
      return false;
    }
    mf = p1f + (p2f - p1f) * f2;
    mx = p1x + f2 * (p2x - p1x);
    my = p1y + f2 * (p2y - p1y);
    mz = p1z + f2 * (p2z - p1z);
  }
  trFraction = mf;
  trEndX = mx; trEndY = my; trEndZ = mz;
  return false;
}

// --- Entry point (JS-callable) --------------------------------------------------
// sv.ts clipMoveToEntity resetTrace + recursiveHullCheck; callers apply the
// hullForEntity offset to start/end first.
export function trace(sx: f64, sy: f64, sz: f64, ex: f64, ey: f64, ez: f64): void {
  trFraction = 1.0;
  trAllSolid = true;
  trStartSolid = false;
  trInOpen = false;
  trInWater = false;
  trEndX = ex; trEndY = ey; trEndZ = ez;
  trPlaneNX = 0.0; trPlaneNY = 0.0; trPlaneNZ = 0.0; trPlaneDist = 0.0;
  recursiveHullCheck(hullFirstClipnode, 0.0, 1.0, sx, sy, sz, ex, ey, ez);
}

// Module-load default pool for the standalone parity harnesses (no map load, so
// no initHullStorage call). Real map loads call initHullStorage with the BSP's
// actual counts before any clipnode/plane is written.
initHullStorage(1 << 12, 1 << 12);
