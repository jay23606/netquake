// Entity-lifecycle QuakeC builtins — pf.ts spawn (#14), remove (#15), find (#18),
// findradius (#22), nextent (#47), plus ed.ts alloc/free (ED_Alloc/ED_Free).
//
// PARITY: reads widen f32->f64, each store rounds once (abi.setf / ed.edStoreFloat)
// — docs/wasm-sim-port-assemblyscript.md THE PARITY RULE.
//
// Module-private state ed.ts/svmove.ts don't model:
//   numEdictsG   — sv.ts num_edicts high-water mark, capped at ed.ts's
//                  initEdicts-time maxEdicts (field block is sized upfront).
//   freetimeBase — per-edict Edict.freetime (f64); edAlloc's reuse gate reads it.
//   maxClientsG / serverTimeG — sv.svs.maxclients / server.time.
// The free flag itself is svmove.ts's setEdictFree/isEdictFree (single source of
// truth — do not add a second).
//
// edAlloc reuse gate: a free edict in [maxclients+1, num_edicts) is reused only
// if freetime < 2.0 (early map life) or server.time - freetime > 0.5 (vanilla
// anti-effect-stomp delay). At cap, sys.error is modeled as unreachable().
//
// edFree NOT modeled: ed.alpha / ed.onladder — JS Edict state outside the
// contiguous field block.

import { gf, gi, setf, seti, GLOBALS } from "./abi";
import {
  edLoadFloat, edStoreFloat, edLoadInt, edStoreInt, clearEdict, getMaxEdicts, getEdictSizeWords,
  setEdictFree, isEdictFree, unlinkEdict,
} from "./svmove";
import { stringsEqual, stringIsEmpty } from "./strings";

export * from "./svmove";
// Named re-export only: strings.ts's ftos/vtos would drag host_tostring/
// host_tofixed1 import bindings into this standalone build.
export { newString, initStringTemp, scratchPtr, maxScratch } from "./strings";

export function globalsPtr(): usize { return GLOBALS; }

// JS-callable GLOBALS accessors — heap.alloc can grow/detach wasm memory, so
// callers use these instead of a captured typed-array view.
export function writeGlobalFloat(idx: i32, v: f32): void { setf(GLOBALS, idx, <f64>v); }
export function readGlobalFloat(idx: i32): f32 { return <f32>gf(GLOBALS, idx); }
export function writeGlobalInt(idx: i32, v: i32): void { seti(GLOBALS, idx, v); }
export function readGlobalInt(idx: i32): i32 { return gi(GLOBALS, idx); }

// --- QC call-ABI / engine-reserved global indices (src/engine/pr.ts globalvars) -
const PARM0: i32 = 4;
const PARM1: i32 = 7;
const PARM2: i32 = 10;
const RETURN: i32 = 1;

// --- entvars field indices (src/engine/pr.ts entvars, vanilla layout) ---------
const F_MODELINDEX: i32 = 0;
const F_SOLID: i32 = 9;
const F_ORIGIN: i32 = 10, F_ORIGIN1: i32 = 11, F_ORIGIN2: i32 = 12;
const F_ANGLES: i32 = 19, F_ANGLES1: i32 = 20, F_ANGLES2: i32 = 21;
const F_MODEL: i32 = 29;
const F_FRAME: i32 = 30;
const F_SKIN: i32 = 31;
const F_MINS: i32 = 33, F_MINS1: i32 = 34, F_MINS2: i32 = 35;
const F_MAXS: i32 = 36, F_MAXS1: i32 = 37, F_MAXS2: i32 = 38;
const F_NEXTTHINK: i32 = 46;
const F_TAKEDAMAGE: i32 = 59;
const F_CHAIN: i32 = 60;
const F_COLORMAP: i32 = 77;

const SOLID_NOT: i32 = 0;

// --- module-private entity-lifecycle state (see header DESIGN note) -----------
let freetimeBase: usize = 0;
let numEdictsG: i32 = 0;
let maxClientsG: i32 = 0;
let serverTimeG: f64 = 0.0;

@inline function loadFreetime(entNum: i32): f64 { return load<f64>(freetimeBase + (<usize>entNum << 3)); }
@inline function storeFreetime(entNum: i32, v: f64): void { store<f64>(freetimeBase + (<usize>entNum << 3), v); }

// Call once per fresh map load, AFTER ed.initEdicts (and svmove.initAreaTree if
// entities will be linked). startNumEdicts = spawnServer's maxclients+1.
export function initEntState(maxClients: i32, startNumEdicts: i32): void {
  const maxEdicts = getMaxEdicts();
  freetimeBase = heap.alloc(<usize>maxEdicts << 3);
  memory.fill(freetimeBase, 0, <usize>maxEdicts << 3);
  maxClientsG = maxClients;
  numEdictsG = startNumEdicts;
  serverTimeG = 0.0;
}

export function setNumEdicts(n: i32): void { numEdictsG = n; }
export function getNumEdicts(): i32 { return numEdictsG; }
export function setMaxClients(n: i32): void { maxClientsG = n; }
export function getMaxClients(): i32 { return maxClientsG; }
export function setServerTime(t: f64): void { serverTimeG = t; }
export function getServerTime(): f64 { return serverTimeG; }
export function getFreetime(entNum: i32): f64 { return loadFreetime(entNum); }

// Seed free/freetime state directly, bypassing edAlloc/edFree.
export function markFree(entNum: i32, isFree: i32, freetime: f64): void {
  setEdictFree(entNum, isFree);
  storeFreetime(entNum, freetime);
}

// src/engine/ed.ts alloc (reuse gate in header).
export function edAlloc(): i32 {
  for (let i: i32 = maxClientsG + 1; i < numEdictsG; i++) {
    if (isEdictFree(i) != 0) {
      const ft = loadFreetime(i);
      if (ft < 2.0 || (serverTimeG - ft) > 0.5) {
        clearEdict(i);
        setEdictFree(i, 0);
        return i;
      }
    }
  }
  if (numEdictsG >= getMaxEdicts()) {
    unreachable(); // ED_Alloc: no free edicts (sys.error, not modeled)
  }
  const e = numEdictsG;
  numEdictsG++;
  clearEdict(e);
  setEdictFree(e, 0);
  return e;
}

// src/engine/ed.ts free.
export function edFree(entNum: i32): void {
  // Never free a client edict (1..maxclients): a divergent QC path (e.g. a
  // killtarget find() matching the player) would zero it to origin (0,0,0).
  // Clients are freed only via connect/disconnect/level-change paths.
  if (entNum >= 1 && entNum <= maxClientsG) return;
  unlinkEdict(entNum);
  setEdictFree(entNum, 1);
  edStoreInt(entNum, F_MODEL, 0);
  edStoreFloat(entNum, F_TAKEDAMAGE, 0.0);
  edStoreFloat(entNum, F_MODELINDEX, 0.0);
  edStoreFloat(entNum, F_COLORMAP, 0.0);
  edStoreFloat(entNum, F_SKIN, 0.0);
  edStoreFloat(entNum, F_FRAME, 0.0);
  edStoreFloat(entNum, F_ORIGIN, 0.0);
  edStoreFloat(entNum, F_ORIGIN1, 0.0);
  edStoreFloat(entNum, F_ORIGIN2, 0.0);
  edStoreFloat(entNum, F_ANGLES, 0.0);
  edStoreFloat(entNum, F_ANGLES1, 0.0);
  edStoreFloat(entNum, F_ANGLES2, 0.0);
  edStoreFloat(entNum, F_NEXTTHINK, -1.0);
  edStoreFloat(entNum, F_SOLID, 0.0);
  storeFreetime(entNum, serverTimeG);
}

// #14 entity() spawn
export function pf_spawn(g: usize): void {
  seti(g, RETURN, edAlloc());
}

// #15 void(entity e) remove
export function pf_remove(g: usize): void {
  edFree(gi(g, PARM0));
}

// #18 entity(entity start, .string fld, string match) find
export function pf_find(g: usize): void {
  const f: i32 = gi(g, PARM1);
  const s: i32 = gi(g, PARM2);
  let e: i32 = gi(g, PARM0) + 1;
  for (; e < numEdictsG; e++) {
    if (isEdictFree(e) != 0) continue;
    if (stringsEqual(edLoadInt(e, f), s)) {
      seti(g, RETURN, e);
      return;
    }
  }
  seti(g, RETURN, 0);
}

// #400 copyentity (pf.ts): copy every field of PARM0's edict into PARM1's.
export function pf_copyentity(g: usize): void {
  const ine: i32 = gi(g, PARM0), oute: i32 = gi(g, PARM1);
  const n: i32 = getEdictSizeWords();
  for (let i: i32 = 0; i < n; i++) edStoreInt(oute, i, edLoadInt(ine, i));
}

// #402 findchain (pf.ts): chain edicts whose string field PARM0 == PARM1 via .chain; returns head.
export function pf_findchain(g: usize): void {
  const f: i32 = gi(g, PARM0), s: i32 = gi(g, PARM1);
  if (stringIsEmpty(s)) { seti(g, RETURN, 0); return; }
  let chain: i32 = 0;
  for (let e: i32 = 1; e < numEdictsG; e++) {
    if (isEdictFree(e) != 0) continue;
    if (!stringsEqual(edLoadInt(e, f), s)) continue;
    edStoreInt(e, F_CHAIN, chain);
    chain = e;
  }
  seti(g, RETURN, chain);
}

// #403 findchainfloat (pf.ts): same, float field.
export function pf_findchainfloat(g: usize): void {
  const f: i32 = gi(g, PARM0);
  const s: f64 = gf(g, PARM1);
  let chain: i32 = 0;
  for (let e: i32 = 1; e < numEdictsG; e++) {
    if (isEdictFree(e) != 0) continue;
    if (s != <f64>edLoadFloat(e, f)) continue;
    edStoreInt(e, F_CHAIN, chain);
    chain = e;
  }
  seti(g, RETURN, chain);
}

// #22 entity(vector org, float rad) findradius
export function pf_findradius(g: usize): void {
  const orgX: f64 = gf(g, PARM0), orgY: f64 = gf(g, PARM0 + 1), orgZ: f64 = gf(g, PARM0 + 2);
  const rad: f64 = gf(g, PARM1);
  let chain: i32 = 0;
  for (let i: i32 = 1; i < numEdictsG; i++) {
    if (isEdictFree(i) != 0) continue;
    const solid: i32 = <i32>edLoadFloat(i, F_SOLID);
    if (solid == SOLID_NOT) continue;
    const ex = orgX - (<f64>edLoadFloat(i, F_ORIGIN) + (<f64>edLoadFloat(i, F_MINS) + <f64>edLoadFloat(i, F_MAXS)) * 0.5);
    const ey = orgY - (<f64>edLoadFloat(i, F_ORIGIN1) + (<f64>edLoadFloat(i, F_MINS1) + <f64>edLoadFloat(i, F_MAXS1)) * 0.5);
    const ez = orgZ - (<f64>edLoadFloat(i, F_ORIGIN2) + (<f64>edLoadFloat(i, F_MINS2) + <f64>edLoadFloat(i, F_MAXS2)) * 0.5);
    if (Math.sqrt(ex * ex + ey * ey + ez * ez) > rad) continue;
    edStoreInt(i, F_CHAIN, chain);
    chain = i;
  }
  seti(g, RETURN, chain);
}

// #47 entity(entity ent) nextent
export function pf_nextent(g: usize): void {
  for (let i: i32 = gi(g, PARM0) + 1; i < numEdictsG; i++) {
    if (isEdictFree(i) == 0) {
      seti(g, RETURN, i);
      return;
    }
  }
  seti(g, RETURN, 0);
}
