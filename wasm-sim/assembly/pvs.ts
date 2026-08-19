// PVS / checkclient — the DRAW-BSP visibility the collision hulls (world.ts) don't
// cover. Ports src/engine/pf.ts checkclient/newcheckclient + mod.ts pointInLeaf/
// decompressVis/leafPVS. Render-BSP data is marshaled in at load (initPvs + the
// pvs*Ptr buffers, written JS-side in wasmServer.loadMap).
// PARITY: f32 plane data widens to f64, compare d>0 like mod.ts; decompressVis is
// byte-exact RLE; no f32-store points on this path.

import { edLoadFloat, edStoreFloat } from "./ed";
import { isEdictFree } from "./svmove";
import { gi, seti } from "./abi";
import { getMaxClients, getServerTime } from "./builtins_edict";

// Standard entvars field offsets (id-progs layout, same as the other builtin modules).
const F_MODELINDEX: i32 = 0;
const F_ABSMIN: i32 = 1, F_ABSMIN1: i32 = 2, F_ABSMIN2: i32 = 3;
const F_ABSMAX: i32 = 4, F_ABSMAX1: i32 = 5, F_ABSMAX2: i32 = 6;
const F_ORIGIN: i32 = 10, F_ORIGIN1: i32 = 11, F_ORIGIN2: i32 = 12;
const F_MINS: i32 = 33, F_MINS1: i32 = 34, F_MINS2: i32 = 35;
const F_MAXS: i32 = 36, F_MAXS1: i32 = 37, F_MAXS2: i32 = 38;
const F_VIEW_OFS: i32 = 62, F_VIEW_OFS1: i32 = 63, F_VIEW_OFS2: i32 = 64;
const F_HEALTH: i32 = 48;
const F_FLAGS: i32 = 76;
const FL_ITEM: i32 = 256;
const FL_NOTARGET: i32 = 128;
const GLOBAL_SELF: i32 = 28;
const RETURN: i32 = 1;
const MAX_ENT_LEAFS: i32 = 32;

// --- render-BSP storage (heap.alloc'd per map by initPvs) -----------------------
let NODE_PLANE_BASE: usize = 0;   // 4 x f32 per node: normal.xyz, dist
let NODE_CHILD_BASE: usize = 0;   // 2 x i32 per node: children[0], children[1] (child<0 => leaf -1-child)
let VIS_BASE: usize = 0;          // compressed vis lump (0 if the map has none)
let LEAFVISOFS_BASE: usize = 0;   // i32 per leaf: byte offset into VIS
let CHECKPVS_BASE: usize = 0;     // the last-checked client's decompressed PVS row
let visRowBytesG: i32 = 0;

// checkclient round-robin state (sv lastcheck/lastchecktime) — MARSHALED with the
// JS server each frame; an un-synced private copy phase-shifts the 0.1s rotation.
let lastcheck: i32 = 0;
let lastchecktime: f64 = 0.0;
export function setCheckClientState(lc: i32, lct: f64): void { lastcheck = lc; lastchecktime = lct; }
export function getLastCheck(): i32 { return lastcheck; }
export function getLastCheckTime(): f64 { return lastchecktime; }

// Allocate the render-BSP buffers. rowBytes = (leafCount+7)>>3. Called once per map
// BEFORE the JS side fills the pvs*Ptr buffers; visdataLen 0 => no vis lump (all-visible).
export function initPvs(nodeCount: i32, leafCount: i32, visdataLen: i32, rowBytes: i32): void {
  visRowBytesG = rowBytes;
  lastcheck = 0;
  lastchecktime = 0.0;
  NODE_PLANE_BASE = heap.alloc(<usize>nodeCount * 16);
  NODE_CHILD_BASE = heap.alloc(<usize>nodeCount * 8);
  VIS_BASE = visdataLen > 0 ? heap.alloc(<usize>visdataLen) : 0;
  LEAFVISOFS_BASE = heap.alloc(<usize>leafCount * 4);
  CHECKPVS_BASE = heap.alloc(<usize>rowBytes);
  memory.fill(CHECKPVS_BASE, 0, <usize>rowBytes);
}
export function pvsNodePlanePtr(): usize { return NODE_PLANE_BASE; }
export function pvsNodeChildPtr(): usize { return NODE_CHILD_BASE; }
export function pvsVisdataPtr(): usize { return VIS_BASE; }
export function pvsLeafVisofsPtr(): usize { return LEAFVISOFS_BASE; }

// --- findTouchedLeafs: per-edict PVS leaf linking (sv.ts findTouchedLeafs) -------
// leafnums live in a flat buffer JS reads zero-copy: stride (1 + MAX_ENT_LEAFS) i32
// per edict = [count, bit0, bit1, ...], each bit = leaf number - 1 (the PVS bit
// index). Solid leaf 0 is skipped (a standard BSP's only solid leaf).
const LEAF_STRIDE: i32 = 1 + MAX_ENT_LEAFS;
let LEAFNUMS_BASE: usize = 0;

export function initLeafnums(maxEdicts: i32): void {
  LEAFNUMS_BASE = heap.alloc(<usize>maxEdicts * <usize>LEAF_STRIDE * 4);
  memory.fill(LEAFNUMS_BASE, 0, <usize>maxEdicts * <usize>LEAF_STRIDE * 4);
}
export function leafnumsPtr(): usize { return LEAFNUMS_BASE; }
export function leafnumsStride(): i32 { return LEAF_STRIDE; }

// General form of vec.boxOnPlaneSide. Axial planes get the same result; a boundary
// tie differs only by an extra child visit — safely over-inclusive for PVS linking.
// @inline
function boxOnPlaneSide(minX: f64, minY: f64, minZ: f64, maxX: f64, maxY: f64, maxZ: f64,
    nx: f64, ny: f64, nz: f64, dist: f64): i32 {
  const d1: f64 = (nx < 0.0 ? minX : maxX) * nx + (ny < 0.0 ? minY : maxY) * ny + (nz < 0.0 ? minZ : maxZ) * nz;
  const d2: f64 = (nx < 0.0 ? maxX : minX) * nx + (ny < 0.0 ? maxY : minY) * ny + (nz < 0.0 ? maxZ : minZ) * nz;
  let sides: i32 = 0;
  if (d1 >= dist) sides = 1;
  if (d2 < dist) sides |= 2;
  return sides;
}

function addLeaf(rec: usize, leafNum: i32): void {
  if (leafNum == 0) return;   // solid leaf (leaf 0) — JS skips node.contents == SOLID
  const count: i32 = load<i32>(rec);
  if (count >= MAX_ENT_LEAFS) return;
  store<i32>(rec + 4 + (<usize>count) * 4, leafNum - 1);   // PVS bit index (leaf - 1)
  store<i32>(rec, count + 1);
}

// Box-walk of the render node tree from node `ni` (>= 0), adding every touched leaf to `rec`.
// A child < 0 encodes leaf -1-child (mod.ts/pointInLeaf convention).
function ftlRecurse(rec: usize, ni: i32, minX: f64, minY: f64, minZ: f64, maxX: f64, maxY: f64, maxZ: f64): void {
  const pb: usize = NODE_PLANE_BASE + (<usize>ni) * 16;
  const nx: f64 = <f64>load<f32>(pb);
  const ny: f64 = <f64>load<f32>(pb + 4);
  const nz: f64 = <f64>load<f32>(pb + 8);
  const dist: f64 = <f64>load<f32>(pb + 12);
  const sides: i32 = boxOnPlaneSide(minX, minY, minZ, maxX, maxY, maxZ, nx, ny, nz, dist);
  const cb: usize = NODE_CHILD_BASE + (<usize>ni) * 8;
  if ((sides & 1) != 0) {
    const c0: i32 = load<i32>(cb);
    if (c0 < 0) addLeaf(rec, -1 - c0);
    else ftlRecurse(rec, c0, minX, minY, minZ, maxX, maxY, maxZ);
  }
  if ((sides & 2) != 0) {
    const c1: i32 = load<i32>(cb + 4);
    if (c1 < 0) addLeaf(rec, -1 - c1);
    else ftlRecurse(rec, c1, minX, minY, minZ, maxX, maxY, maxZ);
  }
}

// Rebuild the entity's leafnums (leaf half only — the sim owns the area-tree chains).
// QSS-M PARITY: reads the STORED absmin/absmax — never recompute here (QC can change
// an origin by direct field write without relinking). linkEdict (svmove.ts) remains
// the only absbox writer.
export function refreshLeafs(entNum: i32): void {
  const aminX: f64 = <f64>edLoadFloat(entNum, F_ABSMIN);
  const aminY: f64 = <f64>edLoadFloat(entNum, F_ABSMIN1);
  const aminZ: f64 = <f64>edLoadFloat(entNum, F_ABSMIN2);
  const amaxX: f64 = <f64>edLoadFloat(entNum, F_ABSMAX);
  const amaxY: f64 = <f64>edLoadFloat(entNum, F_ABSMAX1);
  const amaxZ: f64 = <f64>edLoadFloat(entNum, F_ABSMAX2);
  const rec: usize = LEAFNUMS_BASE + (<usize>entNum) * (<usize>LEAF_STRIDE) * 4;
  store<i32>(rec, 0);   // reset count
  if (<f64>edLoadFloat(entNum, F_MODELINDEX) != 0.0)
    ftlRecurse(rec, 0, aminX, aminY, aminZ, amaxX, amaxY, amaxZ);
}

// mod.ts pointInLeaf: returns the LEAF NUMBER, not a node; child < 0 encodes leaf -1-child.
function pointInLeaf(px: f64, py: f64, pz: f64): i32 {
  let ni: i32 = 0;
  while (true) {
    const pb: usize = NODE_PLANE_BASE + (<usize>ni) * 16;
    const nx: f64 = <f64>load<f32>(pb);
    const ny: f64 = <f64>load<f32>(pb + 4);
    const nz: f64 = <f64>load<f32>(pb + 8);
    const dist: f64 = <f64>load<f32>(pb + 12);
    const d: f64 = px * nx + py * ny + pz * nz - dist;
    const cb: usize = NODE_CHILD_BASE + (<usize>ni) * 8;
    const child: i32 = d > 0.0 ? load<i32>(cb) : load<i32>(cb + 4);
    if (child < 0) return -1 - child;
    ni = child;
  }
}

// self/client eye leaf (ed.eyePosition = origin + view_ofs, then pointInLeaf).
function eyeLeaf(entNum: i32): i32 {
  const ex: f64 = <f64>edLoadFloat(entNum, F_ORIGIN) + <f64>edLoadFloat(entNum, F_VIEW_OFS);
  const ey: f64 = <f64>edLoadFloat(entNum, F_ORIGIN1) + <f64>edLoadFloat(entNum, F_VIEW_OFS1);
  const ez: f64 = <f64>edLoadFloat(entNum, F_ORIGIN2) + <f64>edLoadFloat(entNum, F_VIEW_OFS2);
  return pointInLeaf(ex, ey, ez);
}

// mod.ts decompressVis into CHECKPVS. The inner run is clamped to the row so a long
// trailing run can't overrun the buffer.
function computeCheckPvs(leafNum: i32): void {
  const row: i32 = visRowBytesG;
  if (leafNum == 0 || VIS_BASE == 0) { memory.fill(CHECKPVS_BASE, 0xff, <usize>row); return; }
  let i: i32 = load<i32>(LEAFVISOFS_BASE + (<usize>leafNum) * 4);
  let out: i32 = 0;
  while (out < row) {
    const b: i32 = <i32>load<u8>(VIS_BASE + (<usize>i));
    if (b != 0) { store<u8>(CHECKPVS_BASE + (<usize>out), <u8>b); out++; i++; continue; }
    let c: i32 = <i32>load<u8>(VIS_BASE + (<usize>i) + 1);
    i += 2;
    while (c > 0 && out < row) { store<u8>(CHECKPVS_BASE + (<usize>out), 0); out++; c--; }
  }
}

// pf.ts newcheckclient: cycle to the next targetable client (alive, not FL_NOTARGET) and
// cache ITS PVS into CHECKPVS.
function newcheckclient(check: i32): i32 {
  const mc: i32 = getMaxClients();
  if (check <= 0) check = 1;
  else if (check > mc) check = mc;
  let i: i32 = 1;
  if (check != mc) i += check;
  while (true) {
    if (i == mc + 1) i = 1;
    if (i == check) break;
    if (isEdictFree(i) == 0) {
      const health: f64 = <f64>edLoadFloat(i, F_HEALTH);
      const flags: i32 = <i32>edLoadFloat(i, F_FLAGS);
      if (!(health <= 0.0 || (flags & FL_NOTARGET) != 0)) break;
    }
    i++;
  }
  computeCheckPvs(eyeLeaf(i));
  return i;
}

// #17 checkclient: the cached client if self's eye is in its PVS, else world (0). Cycles the
// checked client every >=0.1s (pf.ts checkclient).
export function checkclient(g: usize): void {
  const t: f64 = getServerTime();
  if (t - lastchecktime >= 0.1) {
    lastcheck = newcheckclient(lastcheck);
    lastchecktime = t;
  }
  const ent: i32 = lastcheck;
  if (isEdictFree(ent) != 0 || <f64>edLoadFloat(ent, F_HEALTH) <= 0.0) { seti(g, RETURN, 0); return; }
  const self: i32 = gi(g, GLOBAL_SELF);
  const l: i32 = eyeLeaf(self) - 1;
  if (l < 0 || (l >> 3) >= visRowBytesG || (<i32>load<u8>(CHECKPVS_BASE + (<usize>(l >> 3))) & (1 << (l & 7))) == 0) {
    seti(g, RETURN, 0);
    return;
  }
  seti(g, RETURN, ent);
}
