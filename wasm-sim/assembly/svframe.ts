// Per-frame server orchestration — port of sv.ts SV_RunThink (runThink) and
// SV_Physics (physicsFrame; serverFrame = StartFrame QC + physicsFrame): movetype
// dispatch, clients [1,maxclients] -> physicsClient, force_retouch re-links, and
// the QSS-M sendinterval computation at the loop tail.
//
// TIME OWNERSHIP: runThink compares thinktime against module-private `svTime`
// (mirrors state.server.time — frame-stable, advanced ONCE at physicsFrame exit),
// NOT the QC time global, which every runThink overwrites. setServerTime is called
// at entry (pre-frame time, so ED_Alloc/ED_Free during thinks see the same
// not-yet-advanced time sv.ts's edicts would) and at exit; this module is the
// single owner reconciling svTime with builtins_edict's serverTimeG.
//
// CVARS are ambient host state, exposed as JS-callable setters (setMaxVelocity/
// setGravityCvar/setGravityFieldIdx) — set once by the embedder, read every frame,
// feeding svphysics.ts's parameterized functions.

import {
  execute, resetVm, installStatement, installFunction, setNumFunctions, setEdictSize,
  writeGlobalInt, writeGlobalFloat, readGlobalInt, readGlobalFloat, globalsPtr, wasTrapped,
} from "./vm";
import {
  edLoadInt, edStoreInt, edLoadFloat, edStoreFloat, clearEdict, initEdicts,
  edictsBase, getMaxEdicts, getEdictSizeWords,
  setThinkCapture, getOldThinkTime, getOldFrame, setSendInterval, sendIntervalPtr,
  initAreaTree, linkEdict, linkEdictTouch, unlinkEdict, setEdictFree, isEdictFree,
  flyMove, pushEntity, physicsToss, checkVelocity, checkWaterTransition, hitsound,
  setWorldHullRange, setPlane, setClipNode, setHullMeta, initHullStorage,
  setSimTime, rebuildSkinContents,
} from "./svphysics";
import {
  getNumEdicts, setNumEdicts, setMaxClients, getMaxClients, setServerTime, initEntState,
  edAlloc, edFree, markFree, getFreetime,
} from "./builtins_edict";
import { loadStringBlock, initStringTemp, scratchPtr, maxScratch } from "./strings";

// Named passthrough, no blind export * (svphysics/builtins_edict transitively
// re-export svmove/ed/world; export * would collide).
export {
  execute, resetVm, installStatement, installFunction, setNumFunctions, setEdictSize,
  writeGlobalInt, writeGlobalFloat, readGlobalInt, readGlobalFloat, globalsPtr, wasTrapped,
  edLoadInt, edStoreInt, edLoadFloat, edStoreFloat, clearEdict, initEdicts,
  edictsBase, getMaxEdicts, getEdictSizeWords,
  setThinkCapture, getOldThinkTime, getOldFrame, setSendInterval, sendIntervalPtr,
  initAreaTree, linkEdict, linkEdictTouch, unlinkEdict, setEdictFree, isEdictFree,
  flyMove, pushEntity, physicsToss, checkVelocity,
  setWorldHullRange, setPlane, setClipNode, setHullMeta, initHullStorage,
  getNumEdicts, setNumEdicts, setMaxClients, setServerTime, initEntState,
  edAlloc, edFree, markFree, getFreetime,
  loadStringBlock, initStringTemp, scratchPtr, maxScratch,
};
// svpusher imports back through this barrel — a function-level cycle AS resolves
// at link time (nothing runs at module init).
import { physicsPusher } from "./svpusher";
import { physicsClient } from "./svclient";

// --- QC call-ABI / engine-reserved global indices (src/engine/pr.ts globalvars) -
const GLOBAL_SELF: i32 = 28;
const GLOBAL_OTHER: i32 = 29;
const GLOBAL_TIME: i32 = 31;
const GLOBAL_FORCE_RETOUCH: i32 = 33;

// --- entvars field indices (src/engine/pr.ts entvars, vanilla layout) ---------
const F_MOVETYPE: i32 = 8;
const F_ORIGIN: i32 = 10, F_ORIGIN1: i32 = 11, F_ORIGIN2: i32 = 12;
const F_VELOCITY: i32 = 16, F_VELOCITY1: i32 = 17, F_VELOCITY2: i32 = 18;
const F_ANGLES: i32 = 19, F_ANGLES1: i32 = 20, F_ANGLES2: i32 = 21;
const F_AVELOCITY: i32 = 22, F_AVELOCITY1: i32 = 23, F_AVELOCITY2: i32 = 24;
const F_THINK: i32 = 44;
const F_NEXTTHINK: i32 = 46;
const F_FLAGS: i32 = 76;

// --- sv.ts MOVE_TYPE / FL enums (the slice this module dispatches on) ---------
const MOVE_TYPE_NONE: i32 = 0;
const MOVE_TYPE_STEP: i32 = 4;
const MOVE_TYPE_WALK: i32 = 3;   // clients only — read by the sendinterval tail
const F_FRAME: i32 = 30;
const MOVE_TYPE_FLY: i32 = 5;
const MOVE_TYPE_TOSS: i32 = 6;
const MOVE_TYPE_PUSH: i32 = 7;
const MOVE_TYPE_NOCLIP: i32 = 8;
const MOVE_TYPE_FLYMISSILE: i32 = 9;
const MOVE_TYPE_BOUNCE: i32 = 10;
// MOVETYPE_EXT_BOUNCEMISSILE (QSS-M server.h:264) — the 2021 rerelease's gibs use it.
// QSS-M SV_Physics routes it to SV_Physics_Toss alongside toss/bounce (sv_phys.c:1678).
const MOVE_TYPE_BOUNCEMISSILE: i32 = 11;
const FL_FLY: i32 = 1;
const FL_SWIM: i32 = 2;
const FL_ONGROUND: i32 = 512;

// --- module-private frame/cvar state (see header TIME OWNERSHIP / CVARS notes) -
let svTime: f64 = 0.0;
let maxVelocityG: f64 = 2000.0;  // sv.ts cvr.maxvelocity default
let gravityCvarG: f64 = 800.0;   // sv.ts cvr.gravity default
let gravityFieldIdxG: i32 = -1;  // -1 == progs.dat has no per-entity "gravity" field

export function setMaxVelocity(v: f64): void { maxVelocityG = v; }
export function setGravityCvar(v: f64): void { gravityCvarG = v; }
export function setGravityFieldIdx(idx: i32): void { gravityFieldIdxG = idx; }
export function getSvTime(): f64 { return svTime; }

// sv.ts addGravity (svphysics's copy is private and cvar-parameterized).
function addGravity(entNum: i32, frametime: f64): void {
  let entGravity: f64 = 1.0;
  if (gravityFieldIdxG >= 0) {
    const g: f64 = <f64>edLoadFloat(entNum, gravityFieldIdxG);
    entGravity = (g != 0.0) ? g : 1.0;
  }
  const v2: f64 = <f64>edLoadFloat(entNum, F_VELOCITY2);
  edStoreFloat(entNum, F_VELOCITY2, v2 - entGravity * gravityCvarG * frametime);
}

// ================================================================================
// SV_RunThink (sv.ts runThink). Returns false iff the entity freed itself.
// ================================================================================
export function runThink(entNum: i32, frametime: f64): bool {
  let thinktime: f64 = <f64>edLoadFloat(entNum, F_NEXTTHINK);
  if (thinktime <= 0.0 || thinktime > (svTime + frametime)) return true;
  if (thinktime < svTime) thinktime = svTime;

  // QSS-M oldthinktime/oldframe capture — read by updateSendInterval at the loop tail.
  setThinkCapture(entNum, thinktime, <f64>edLoadFloat(entNum, F_FRAME));

  edStoreFloat(entNum, F_NEXTTHINK, 0.0);
  writeGlobalFloat(GLOBAL_TIME, <f32>thinktime);
  writeGlobalInt(GLOBAL_SELF, entNum);
  writeGlobalInt(GLOBAL_OTHER, 0);
  execute(edLoadInt(entNum, F_THINK));

  return isEdictFree(entNum) == 0;
}

// ================================================================================
// Per-movetype physics_* (sv.ts): runThink + the svphysics motion core.
// ================================================================================

// sv.ts physics() inline `case MOVE_TYPE.none: runThink(ent); continue;`
function physics_None(entNum: i32, frametime: f64): void {
  runThink(entNum, frametime);
}

// sv.ts physics_Noclip.
function physics_Noclip(entNum: i32, frametime: f64): void {
  if (!runThink(entNum, frametime)) return;

  edStoreFloat(entNum, F_ANGLES, <f64>edLoadFloat(entNum, F_ANGLES) + frametime * <f64>edLoadFloat(entNum, F_AVELOCITY));
  edStoreFloat(entNum, F_ANGLES1, <f64>edLoadFloat(entNum, F_ANGLES1) + frametime * <f64>edLoadFloat(entNum, F_AVELOCITY1));
  edStoreFloat(entNum, F_ANGLES2, <f64>edLoadFloat(entNum, F_ANGLES2) + frametime * <f64>edLoadFloat(entNum, F_AVELOCITY2));
  edStoreFloat(entNum, F_ORIGIN, <f64>edLoadFloat(entNum, F_ORIGIN) + frametime * <f64>edLoadFloat(entNum, F_VELOCITY));
  edStoreFloat(entNum, F_ORIGIN1, <f64>edLoadFloat(entNum, F_ORIGIN1) + frametime * <f64>edLoadFloat(entNum, F_VELOCITY1));
  edStoreFloat(entNum, F_ORIGIN2, <f64>edLoadFloat(entNum, F_ORIGIN2) + frametime * <f64>edLoadFloat(entNum, F_VELOCITY2));
  linkEdict(entNum);
}

// sv.ts physics_Step. checkWaterTransition's watertype/waterlevel writes are
// QC-visible state (DeathBubblesSpawn gates on owner.waterlevel).
function physics_Step(entNum: i32, frametime: f64): void {
  const flags: i32 = <i32>edLoadFloat(entNum, F_FLAGS);
  if ((flags & (FL_ONGROUND | FL_FLY | FL_SWIM)) == 0) {
    // Decided BEFORE the move (falling fast), played only if the move landed.
    const hit: bool = <f64>edLoadFloat(entNum, F_VELOCITY2) < gravityCvarG * -0.1;
    addGravity(entNum, frametime);
    checkVelocity(entNum, maxVelocityG);
    flyMove(entNum, frametime);
    linkEdictTouch(entNum);   // sv.ts physics_Step links with touch_triggers=true
    if (((<i32>edLoadFloat(entNum, F_FLAGS)) & FL_ONGROUND) != 0 && hit) hitsound(entNum);
  }
  runThink(entNum, frametime);
  checkWaterTransition(entNum);
}

// sv.ts physics_Toss's runThink; the motion body is svphysics.physicsToss.
function physics_Toss(entNum: i32, frametime: f64): void {
  if (!runThink(entNum, frametime)) return;
  physicsToss(entNum, frametime, maxVelocityG, gravityCvarG, gravityFieldIdxG);
}

// ================================================================================
// SV_Physics (sv.ts physics). StartFrame QC runs in serverFrame before this.
// ================================================================================
export function physicsFrame(time: f64, frametime: f64): void {
  svTime = time;
  setServerTime(time);
  setSimTime(time);   // touch/impact dispatch clock (vanilla: pr time = sv.time, not thinktime)

  writeGlobalInt(GLOBAL_SELF, 0);
  writeGlobalInt(GLOBAL_OTHER, 0);
  writeGlobalFloat(GLOBAL_TIME, <f32>time);

  // FTE_ENT_SKIN_CONTENTS: rebuild the negative-skin list after StartFrame, before the loop.
  rebuildSkinContents(getNumEdicts());

  // LIVE bound: getNumEdicts() is re-evaluated every iteration, not hoisted — a
  // think that spawns an edict makes it visible to THIS frame's loop (vanilla
  // behavior); removal only sets the free flag (num_edicts never shrinks).
  for (let i: i32 = 0; i < getNumEdicts(); i++) {
    if (isEdictFree(i) != 0) continue;
    // force_retouch re-links EVERY entity with touch=true (even stationary — how
    // teledeath telefrags a stationary boss). Read live each iteration (a touch
    // this frame can set it).
    if (readGlobalFloat(GLOBAL_FORCE_RETOUCH) != 0.0) linkEdictTouch(i);
    // clients [1,maxclients] -> physicsClient; usercmds fed via svclient.setUserCmd.
    if (i > 0 && i <= getMaxClients()) { physicsClient(i, time, frametime); updateSendInterval(i); continue; }

    const movetype: i32 = <i32>edLoadFloat(i, F_MOVETYPE);
    switch (movetype) {
      case MOVE_TYPE_PUSH:
        physicsPusher(i, frametime, time);   // svpusher.ts (movers)
        break;
      case MOVE_TYPE_NONE:
        physics_None(i, frametime);
        break;
      case MOVE_TYPE_NOCLIP:
        physics_Noclip(i, frametime);
        break;
      case MOVE_TYPE_STEP:
        physics_Step(i, frametime);
        break;
      case MOVE_TYPE_TOSS:
      case MOVE_TYPE_BOUNCE:
      case MOVE_TYPE_BOUNCEMISSILE:
      case MOVE_TYPE_FLY:
      case MOVE_TYPE_FLYMISSILE:
        physics_Toss(i, frametime);
        break;
      default:
        // sv.ts: sys.error bad movetype — walk/anglenoclip only reachable via physicsClient.
        break;
    }
    updateSendInterval(i);
  }
  // Decrement force_retouch once per frame (if nonzero).
  const fr: f64 = <f64>readGlobalFloat(GLOBAL_FORCE_RETOUCH);
  if (fr != 0.0) writeGlobalFloat(GLOBAL_FORCE_RETOUCH, <f32>(fr - 1.0));
  svTime = time + frametime;
  setServerTime(svTime);
}

// QSS-M SV_Physics tail / sv.ts loop tail: capture the interval to nextthink for
// client lerp timing, unless ~0.1 (which the client assumes). Recomputed for EVERY
// non-free entity per frame from runThink's oldthinktime/oldframe capture.
// Q_rint = C truncate-after-add-half; <i32> casts truncate toward zero.
function updateSendInterval(entNum: i32): void {
  if (isEdictFree(entNum) != 0) { setSendInterval(entNum, 0); return; }
  let si: i32 = 0;
  const nextthink: f64 = <f64>edLoadFloat(entNum, F_NEXTTHINK);
  const movetype: i32 = <i32>edLoadFloat(entNum, F_MOVETYPE);
  if (nextthink > svTime &&
      (movetype == MOVE_TYPE_STEP || movetype == MOVE_TYPE_WALK ||
        <f64>edLoadFloat(entNum, F_FRAME) != getOldFrame(entNum))) {
    const x: f64 = (nextthink - getOldThinkTime(entNum)) * 255.0;
    const j: i32 = x > 0 ? <i32>(x + 0.5) : <i32>(x - 0.5);
    if (j >= 0 && j < 256 && j != 25 && j != 26) si = 1;
  }
  setSendInterval(entNum, si);
}

// Full server frame: StartFrame QC then the physics loop. startFrameFn = the
// loaded progs' globalvars.StartFrame (0 = none).
export function serverFrame(startFrameFn: i32, time: f64, frametime: f64): void {
  writeGlobalInt(GLOBAL_SELF, 0);
  writeGlobalInt(GLOBAL_OTHER, 0);
  writeGlobalFloat(GLOBAL_TIME, <f32>time);
  if (startFrameFn != 0) execute(startFrameFn);
  physicsFrame(time, frametime);
}
