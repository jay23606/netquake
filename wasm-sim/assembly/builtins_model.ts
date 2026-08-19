// Precached-model QuakeC builtin — pf.ts setmodel (#3). Collision hulls live in
// world.ts's per-model hull table (installModelHull/selectModelHull); this
// module's own registry holds the OTHER datum — the model bounding box (mod.ts
// Model.mins/maxs), consumed only by the inlined setMinMaxSize.
//
// PARITY: edict reads/writes via ed.ts's f32<->f64 widen-once/round-once helpers.
// NOT modeled (fatal paths, per port convention): pr.runError('no precache')
// -> unreachable(); setsize's backwards-mins/maxs guard.
//
// Host contract: call initModelPrecache() once per map load, then register each
// precache slot with the SAME index in this registry (registerModelPrecache)
// and in world.installModelHull.

import { gi, GLOBALS } from "./abi";
import {
  edLoadInt, edStoreInt, edLoadFloat, edStoreFloat, linkEdict,
} from "./svmove";
import { stringsEqual } from "./strings";

export * from "./svmove";
// Named re-export only — see builtins_edict.ts's identical line.
// The heap-sync/loader entries ride along so the standalone parity test can drive
// the host side of the string bridge (harness/stringsync.test.mjs).
export {
  newString, initStringTemp, scratchPtr, maxScratch,
  loadStringBlock, heapLength, stringsHeapCapacity,
  writeStringsFromScratch, readStringsToScratch, readStringToScratch, heapStrzone,
} from "./strings";

export function globalsPtr(): usize { return GLOBALS; }

// --- QC call-ABI / engine-reserved global indices (src/engine/pr.ts globalvars) -
const PARM0: i32 = 4;
const PARM1: i32 = 7;

// --- entvars field indices (src/engine/pr.ts entvars, vanilla layout) ---------
const F_MODELINDEX: i32 = 0;
const F_MODEL: i32 = 29;
const F_MINS: i32 = 33, F_MINS1: i32 = 34, F_MINS2: i32 = 35;
const F_MAXS: i32 = 36, F_MAXS1: i32 = 37, F_MAXS2: i32 = 38;
const F_SIZE: i32 = 39, F_SIZE1: i32 = 40, F_SIZE2: i32 = 41;

// --- Precached-model registry (name-string-offset + bounding box per index) --
// Index space is shared with world.ts's hull table BY CONVENTION (host passes
// the same modelIdx to both), not enforced here.
const MAX_PRECACHE: i32 = 1 << 13; // 8192 -- matches world.ts MAX_MODELS (Ironwail); immortal precaches 2954
const NAME_OFS: usize = memory.data(MAX_PRECACHE * 4);  // i32 string-heap offset, -1 == unregistered
const MINS_X: usize = memory.data(MAX_PRECACHE * 8);
const MINS_Y: usize = memory.data(MAX_PRECACHE * 8);
const MINS_Z: usize = memory.data(MAX_PRECACHE * 8);
const MAXS_X: usize = memory.data(MAX_PRECACHE * 8);
const MAXS_Y: usize = memory.data(MAX_PRECACHE * 8);
const MAXS_Z: usize = memory.data(MAX_PRECACHE * 8);

let registeredCount: i32 = 0;

@inline function nameOfsAt(i: i32): i32 { return load<i32>(NAME_OFS + (<usize>i << 2)); }
@inline function setNameOfsAt(i: i32, v: i32): void { store<i32>(NAME_OFS + (<usize>i << 2), v); }
@inline function f64At(base: usize, i: i32): f64 { return load<f64>(base + (<usize>i << 3)); }
@inline function setF64At(base: usize, i: i32, v: f64): void { store<f64>(base + (<usize>i << 3), v); }

// Call once per fresh map/server load (mirrors `state.server.model_precache = []`).
export function initModelPrecache(): void {
  registeredCount = 0;
  memory.fill(NAME_OFS, 0xFF, <usize>MAX_PRECACHE << 2); // -1 == unregistered (i32 -1 is all-FF bytes)
  memory.fill(MINS_X, 0, <usize>MAX_PRECACHE << 3);
  memory.fill(MINS_Y, 0, <usize>MAX_PRECACHE << 3);
  memory.fill(MINS_Z, 0, <usize>MAX_PRECACHE << 3);
  memory.fill(MAXS_X, 0, <usize>MAX_PRECACHE << 3);
  memory.fill(MAXS_Y, 0, <usize>MAX_PRECACHE << 3);
  memory.fill(MAXS_Z, 0, <usize>MAX_PRECACHE << 3);
}

export function getRegisteredCount(): i32 { return registeredCount; }

// Host-callable registration; duplicate names return the existing index.
// Zero bounds are a valid placeholder — real bounds may be registered later
// without changing the assigned index.
export function registerModelPrecache(
  nameStrOfs: i32,
  minsX: f64, minsY: f64, minsZ: f64,
  maxsX: f64, maxsY: f64, maxsZ: f64,
): i32 {
  for (let i: i32 = 0; i < registeredCount; i++) {
    if (stringsEqual(nameOfsAt(i), nameStrOfs)) return i;
  }
  if (registeredCount >= MAX_PRECACHE) unreachable();
  const idx = registeredCount;
  setNameOfsAt(idx, nameStrOfs);
  setF64At(MINS_X, idx, minsX); setF64At(MINS_Y, idx, minsY); setF64At(MINS_Z, idx, minsZ);
  setF64At(MAXS_X, idx, maxsX); setF64At(MAXS_Y, idx, maxsY); setF64At(MAXS_Z, idx, maxsZ);
  registeredCount = idx + 1;
  return idx;
}

// #3 void(entity e, string m) setmodel — src/engine/pf.ts setmodel.
export function pf_setmodel(g: usize): void {
  const entNum: i32 = gi(g, PARM0);
  const nameOfs: i32 = gi(g, PARM1);

  let idx: i32 = -1;
  for (let i: i32 = 0; i < registeredCount; i++) {
    if (stringsEqual(nameOfsAt(i), nameOfs)) { idx = i; break; }
  }
  if (idx == -1) unreachable(); // pr.runError('no precache') -- fatal, not modeled

  edStoreInt(entNum, F_MODEL, nameOfs);
  edStoreFloat(entNum, F_MODELINDEX, <f64>idx);

  // setMinMaxSize inline. pf.ts's mod==null branch uses (0,0,0)/(0,0,0) — the
  // registry's zero-fill default, so no separate branch needed.
  const minsX = f64At(MINS_X, idx), minsY = f64At(MINS_Y, idx), minsZ = f64At(MINS_Z, idx);
  const maxsX = f64At(MAXS_X, idx), maxsY = f64At(MAXS_Y, idx), maxsZ = f64At(MAXS_Z, idx);
  edStoreFloat(entNum, F_MINS, minsX); edStoreFloat(entNum, F_MINS1, minsY); edStoreFloat(entNum, F_MINS2, minsZ);
  edStoreFloat(entNum, F_MAXS, maxsX); edStoreFloat(entNum, F_MAXS1, maxsY); edStoreFloat(entNum, F_MAXS2, maxsZ);
  edStoreFloat(entNum, F_SIZE, maxsX - minsX);
  edStoreFloat(entNum, F_SIZE1, maxsY - minsY);
  edStoreFloat(entNum, F_SIZE2, maxsZ - minsZ);
  linkEdict(entNum);
}
