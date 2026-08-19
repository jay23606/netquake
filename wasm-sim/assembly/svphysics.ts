// Physics MOTION core — port of sv.ts SV_ClipVelocity/SV_CheckVelocity/SV_FlyMove/
// SV_PushEntity/SV_Physics_Toss, on svmove.ts.
//
// - flyMove omits the copyTrace(trace, state.steptrace) on the blocked&2 branch —
//   steptrace's only consumer is the client walk tier (svclient.flyMoveTracked).
// - `pr.entvars.gravity` is progs-dynamic, so it's a gravityFieldIdx parameter
//   (-1 == absent).
// - SV_RunThink runs in svframe's physics_Toss wrapper, not here.
//
// PARITY: trace/vector math is f64 throughout; edict fields go through edLoadFloat
// (widen f32 to f64) / edStoreFloat (round once to f32).

import {
  edLoadFloat, edStoreFloat, edStoreInt,
  linkEdict, linkEdictTouch, impact, isEdictFree, move, MOVE_NORMAL, MOVE_NOMONSTERS, MOVE_MISSILE,
  moveTraceFraction, moveTraceEndX, moveTraceEndY, moveTraceEndZ,
  moveTracePlaneNX, moveTracePlaneNY, moveTracePlaneNZ, moveTracePlaneDist,
  moveTraceAllSolid, moveTraceStartSolid, moveTraceInOpen, moveTraceInWater, moveTraceEnt,
  pointContents,
} from "./svmove";
import { isRerelease } from "./abi";

// Re-export so a standalone build carries the loaders the test harness needs.
export * from "./svmove";

// --- entvars field indices (src/engine/pr.ts entvars, vanilla layout) ---------
const F_MOVETYPE: i32 = 8;
const F_SOLID: i32 = 9;
const F_ORIGIN: i32 = 10, F_ORIGIN1: i32 = 11, F_ORIGIN2: i32 = 12;
const F_VELOCITY: i32 = 16, F_VELOCITY1: i32 = 17, F_VELOCITY2: i32 = 18;
const F_ANGLES: i32 = 19, F_ANGLES1: i32 = 20, F_ANGLES2: i32 = 21;
const F_AVELOCITY: i32 = 22, F_AVELOCITY1: i32 = 23, F_AVELOCITY2: i32 = 24;
const F_MINS: i32 = 33, F_MINS1: i32 = 34, F_MINS2: i32 = 35;
const F_MAXS: i32 = 36, F_MAXS1: i32 = 37, F_MAXS2: i32 = 38;
const F_GROUNDENTITY: i32 = 47;
const F_FLAGS: i32 = 76;
const F_WATERLEVEL: i32 = 83, F_WATERTYPE: i32 = 84;
const CONTENTS_EMPTY: i32 = -1, CONTENTS_WATER: i32 = -3;

// --- sv.ts SOLID / FL / MOVE_TYPE enums (the slice this module touches) -------
const SOLID_NOT: i32 = 0, SOLID_TRIGGER: i32 = 1, SOLID_BSP: i32 = 4;
const FL_ONGROUND: i32 = 512;
const MOVE_TYPE_FLY: i32 = 5, MOVE_TYPE_FLYMISSILE: i32 = 9, MOVE_TYPE_BOUNCE: i32 = 10;
// MOVETYPE_EXT_BOUNCEMISSILE (QSS-M server.h:264) — reused by the rerelease's gibs.
const MOVE_TYPE_BOUNCEMISSILE: i32 = 11;

// ================================================================================
// SV_ClipVelocity — pure vector math; no blocked mask (that bookkeeping lives in
// flyMove, matching vanilla).
// ================================================================================
let cvOutX: f64 = 0.0, cvOutY: f64 = 0.0, cvOutZ: f64 = 0.0;

// Snapshot of pushEntity's own move() trace, captured BEFORE linkEdictTouch/impact
// run — their touch QC can call traceline and CLOBBER svmove's shared moveTrace*
// globals. Vanilla SV_PushEntity returns the trace BY VALUE for exactly this
// reason; readers (physicsToss/walkMove) use these snapshots, not moveTrace*().
let peFrac: f64 = 1.0;
let pePNX: f64 = 0.0, pePNY: f64 = 0.0, pePNZ: f64 = 0.0, pePDist: f64 = 0.0;
let peEntG: i32 = -1;
export function pushTraceFraction(): f64 { return peFrac; }
export function pushTracePlaneNX(): f64 { return pePNX; }
export function pushTracePlaneNY(): f64 { return pePNY; }
export function pushTracePlaneNZ(): f64 { return pePNZ; }
export function pushTracePlaneDist(): f64 { return pePDist; }
export function pushTraceEnt(): i32 { return peEntG; }

function clipVelocityInternal(
  velX: f64, velY: f64, velZ: f64, nx: f64, ny: f64, nz: f64, overbounce: f64,
): void {
  const backoff: f64 = (velX * nx + velY * ny + velZ * nz) * overbounce;

  let ox: f64 = velX - nx * backoff;
  if (ox > -0.1 && ox < 0.1) ox = 0.0;
  let oy: f64 = velY - ny * backoff;
  if (oy > -0.1 && oy < 0.1) oy = 0.0;
  let oz: f64 = velZ - nz * backoff;
  if (oz > -0.1 && oz < 0.1) oz = 0.0;

  cvOutX = ox; cvOutY = oy; cvOutZ = oz;
}

export function clipVelocity(
  velX: f64, velY: f64, velZ: f64, nx: f64, ny: f64, nz: f64, overbounce: f64,
): void {
  clipVelocityInternal(velX, velY, velZ, nx, ny, nz, overbounce);
}
export function clipVelocityOutX(): f64 { return cvOutX; }
export function clipVelocityOutY(): f64 { return cvOutY; }
export function clipVelocityOutZ(): f64 { return cvOutZ; }

// ================================================================================
// SV_CheckVelocity — clamp to +-maxVelocity, NaN->0 on velocity AND origin.
// maxVelocity = caller-resolved sv_maxvelocity cvar value.
// ================================================================================
export function checkVelocity(entNum: i32, maxVelocity: f64): void {
  for (let i: i32 = 0; i <= 2; i++) {
    let v: f64 = <f64>edLoadFloat(entNum, F_VELOCITY + i);
    if (isNaN<f64>(v)) v = 0.0;
    const o: f64 = <f64>edLoadFloat(entNum, F_ORIGIN + i);
    if (isNaN<f64>(o)) edStoreFloat(entNum, F_ORIGIN + i, 0.0);
    if (v > maxVelocity) v = maxVelocity;
    else if (v < -maxVelocity) v = -maxVelocity;
    edStoreFloat(entNum, F_VELOCITY + i, v);
  }
}

// ================================================================================
// SV_FlyMove — the up-to-4-bump slide loop. Returns the `blocked` bitmask (1=floor,
// 2=vertical wall, 3/7=literal early-return codes matching vanilla exactly).
// ================================================================================
const MAX_CLIP_PLANES: i32 = 5;
// Fixed 5-slot plane accumulator (sv.ts state.flymovePlanes).
const PLANE_BUF: usize = memory.data(MAX_CLIP_PLANES * 3 * 8);
@inline function planeSet(i: i32, x: f64, y: f64, z: f64): void {
  const p = PLANE_BUF + (<usize>i * 3) * 8;
  store<f64>(p, x); store<f64>(p + 8, y); store<f64>(p + 16, z);
}
@inline function planeX(i: i32): f64 { return load<f64>(PLANE_BUF + (<usize>i * 3) * 8); }
@inline function planeY(i: i32): f64 { return load<f64>(PLANE_BUF + (<usize>i * 3) * 8 + 8); }
@inline function planeZ(i: i32): f64 { return load<f64>(PLANE_BUF + (<usize>i * 3) * 8 + 16); }

export function flyMove(entNum: i32, time: f64): i32 {
  const primalVelX: f64 = <f64>edLoadFloat(entNum, F_VELOCITY);
  const primalVelY: f64 = <f64>edLoadFloat(entNum, F_VELOCITY1);
  const primalVelZ: f64 = <f64>edLoadFloat(entNum, F_VELOCITY2);
  let origVelX: f64 = primalVelX, origVelY: f64 = primalVelY, origVelZ: f64 = primalVelZ;

  let numplanes: i32 = 0;
  let timeLeft: f64 = time;
  let blocked: i32 = 0;

  for (let bumpcount: i32 = 0; bumpcount <= 3; bumpcount++) {
    const curVelX: f64 = <f64>edLoadFloat(entNum, F_VELOCITY);
    const curVelY: f64 = <f64>edLoadFloat(entNum, F_VELOCITY1);
    const curVelZ: f64 = <f64>edLoadFloat(entNum, F_VELOCITY2);
    if (curVelX == 0.0 && curVelY == 0.0 && curVelZ == 0.0) break;

    const originX: f64 = <f64>edLoadFloat(entNum, F_ORIGIN);
    const originY: f64 = <f64>edLoadFloat(entNum, F_ORIGIN1);
    const originZ: f64 = <f64>edLoadFloat(entNum, F_ORIGIN2);
    const endX: f64 = originX + timeLeft * curVelX;
    const endY: f64 = originY + timeLeft * curVelY;
    const endZ: f64 = originZ + timeLeft * curVelZ;

    // mins/maxs are re-read EVERY bump: sv.ts:1230 passes fresh ed.vector(ent, mins/maxs)
    // per iteration, and impact() below runs touch QC that can setsize() the entity.
    const minsX: f64 = <f64>edLoadFloat(entNum, F_MINS), minsY: f64 = <f64>edLoadFloat(entNum, F_MINS1), minsZ: f64 = <f64>edLoadFloat(entNum, F_MINS2);
    const maxsX: f64 = <f64>edLoadFloat(entNum, F_MAXS), maxsY: f64 = <f64>edLoadFloat(entNum, F_MAXS1), maxsZ: f64 = <f64>edLoadFloat(entNum, F_MAXS2);

    move(originX, originY, originZ, minsX, minsY, minsZ, maxsX, maxsY, maxsZ, endX, endY, endZ, MOVE_NORMAL, entNum);

    if (moveTraceAllSolid() != 0) {
      edStoreFloat(entNum, F_VELOCITY, 0.0);
      edStoreFloat(entNum, F_VELOCITY1, 0.0);
      edStoreFloat(entNum, F_VELOCITY2, 0.0);
      return 3;
    }

    const fraction: f64 = moveTraceFraction();
    if (fraction > 0.0) {
      edStoreFloat(entNum, F_ORIGIN, moveTraceEndX());
      edStoreFloat(entNum, F_ORIGIN1, moveTraceEndY());
      edStoreFloat(entNum, F_ORIGIN2, moveTraceEndZ());
      // Re-read the velocity field, matching the JS re-copy exactly.
      origVelX = <f64>edLoadFloat(entNum, F_VELOCITY);
      origVelY = <f64>edLoadFloat(entNum, F_VELOCITY1);
      origVelZ = <f64>edLoadFloat(entNum, F_VELOCITY2);
      numplanes = 0;
      if (fraction == 1.0) break;
    }

    // sys.error('!trace.ent') invariant guard not modeled.

    const planeNX: f64 = moveTracePlaneNX(), planeNY: f64 = moveTracePlaneNY(), planeNZ: f64 = moveTracePlaneNZ();
    const traceEnt: i32 = moveTraceEnt();
    if (planeNZ > 0.7) {
      blocked |= 1;
      if (traceEnt != -1 && (<i32>edLoadFloat(traceEnt, F_SOLID)) == SOLID_BSP) {
        const flags: i32 = <i32>edLoadFloat(entNum, F_FLAGS);
        edStoreFloat(entNum, F_FLAGS, <f64>(flags | FL_ONGROUND));
        edStoreInt(entNum, F_GROUNDENTITY, traceEnt);
      }
    } else if (planeNZ == 0.0) {
      blocked |= 2;
      // steptrace not captured here — its only consumer uses svclient's flyMoveTracked.
    }

    impact(entNum, traceEnt);                       // sv.ts SV_FlyMove: SV_Impact(ent, trace.ent)
    if (isEdictFree(entNum) != 0) break;           // impact()'s touch can remove ent

    timeLeft -= timeLeft * fraction;

    if (numplanes >= MAX_CLIP_PLANES) {
      edStoreFloat(entNum, F_VELOCITY, 0.0);
      edStoreFloat(entNum, F_VELOCITY1, 0.0);
      edStoreFloat(entNum, F_VELOCITY2, 0.0);
      return 3;
    }
    planeSet(numplanes, planeNX, planeNY, planeNZ);
    numplanes++;

    let i: i32 = 0, j: i32 = 0;
    for (i = 0; i < numplanes; i++) {
      clipVelocityInternal(origVelX, origVelY, origVelZ, planeX(i), planeY(i), planeZ(i), 1.0);
      const nvX: f64 = cvOutX, nvY: f64 = cvOutY, nvZ: f64 = cvOutZ;
      for (j = 0; j < numplanes; j++) {
        if (j != i) {
          if ((nvX * planeX(j) + nvY * planeY(j) + nvZ * planeZ(j)) < 0.0) break;
        }
      }
      if (j == numplanes) break;
    }

    if (i != numplanes) {
      // cvOut* still holds the winning i's result: the i-loop breaks immediately
      // once found, before any further call.
      edStoreFloat(entNum, F_VELOCITY, cvOutX);
      edStoreFloat(entNum, F_VELOCITY1, cvOutY);
      edStoreFloat(entNum, F_VELOCITY2, cvOutZ);
    } else {
      if (numplanes != 2) {
        edStoreFloat(entNum, F_VELOCITY, 0.0);
        edStoreFloat(entNum, F_VELOCITY1, 0.0);
        edStoreFloat(entNum, F_VELOCITY2, 0.0);
        return 7;
      }
      // dir = crossProduct(planes[0], planes[1])
      const dirX: f64 = planeY(0) * planeZ(1) - planeZ(0) * planeY(1);
      const dirY: f64 = planeZ(0) * planeX(1) - planeX(0) * planeZ(1);
      const dirZ: f64 = planeX(0) * planeY(1) - planeY(0) * planeX(1);
      const curVX: f64 = <f64>edLoadFloat(entNum, F_VELOCITY);
      const curVY: f64 = <f64>edLoadFloat(entNum, F_VELOCITY1);
      const curVZ: f64 = <f64>edLoadFloat(entNum, F_VELOCITY2);
      const d: f64 = dirX * curVX + dirY * curVY + dirZ * curVZ;
      edStoreFloat(entNum, F_VELOCITY, dirX * d);
      edStoreFloat(entNum, F_VELOCITY1, dirY * d);
      edStoreFloat(entNum, F_VELOCITY2, dirZ * d);
    }

    const finalVX: f64 = <f64>edLoadFloat(entNum, F_VELOCITY);
    const finalVY: f64 = <f64>edLoadFloat(entNum, F_VELOCITY1);
    const finalVZ: f64 = <f64>edLoadFloat(entNum, F_VELOCITY2);
    if ((finalVX * primalVelX + finalVY * primalVelY + finalVZ * primalVelZ) <= 0.0) {
      edStoreFloat(entNum, F_VELOCITY, 0.0);
      edStoreFloat(entNum, F_VELOCITY1, 0.0);
      edStoreFloat(entNum, F_VELOCITY2, 0.0);
      return blocked;
    }
  }
  return blocked;
}

// ================================================================================
// SV_PushEntity — move + set origin + linkEdictTouch + impact on entity hit.
// The move() result stays live in the moveTrace* getters after return
// (pf_traceline/pf_droptofloor rely on this).
// ================================================================================
export function pushEntity(entNum: i32, pushX: f64, pushY: f64, pushZ: f64): void {
  const ox: f64 = <f64>edLoadFloat(entNum, F_ORIGIN);
  const oy: f64 = <f64>edLoadFloat(entNum, F_ORIGIN1);
  const oz: f64 = <f64>edLoadFloat(entNum, F_ORIGIN2);
  const endX: f64 = ox + pushX, endY: f64 = oy + pushY, endZ: f64 = oz + pushZ;

  const minsX: f64 = <f64>edLoadFloat(entNum, F_MINS), minsY: f64 = <f64>edLoadFloat(entNum, F_MINS1), minsZ: f64 = <f64>edLoadFloat(entNum, F_MINS2);
  const maxsX: f64 = <f64>edLoadFloat(entNum, F_MAXS), maxsY: f64 = <f64>edLoadFloat(entNum, F_MAXS1), maxsZ: f64 = <f64>edLoadFloat(entNum, F_MAXS2);

  const solid: i32 = <i32>edLoadFloat(entNum, F_SOLID);
  const movetype: i32 = <i32>edLoadFloat(entNum, F_MOVETYPE);
  let moveType: i32;
  if (movetype == MOVE_TYPE_FLYMISSILE) moveType = MOVE_MISSILE;
  else if (solid == SOLID_TRIGGER || solid == SOLID_NOT) moveType = MOVE_NOMONSTERS;
  else moveType = MOVE_NORMAL;

  move(ox, oy, oz, minsX, minsY, minsZ, maxsX, maxsY, maxsZ, endX, endY, endZ, moveType, entNum);

  // Snapshot NOW, before linkEdictTouch/impact can clobber moveTrace* via touch-QC
  // traceline (see the peFrac note above).
  peFrac = moveTraceFraction();
  pePNX = moveTracePlaneNX(); pePNY = moveTracePlaneNY(); pePNZ = moveTracePlaneNZ(); pePDist = moveTracePlaneDist();
  peEntG = moveTraceEnt();

  edStoreFloat(entNum, F_ORIGIN, moveTraceEndX());
  edStoreFloat(entNum, F_ORIGIN1, moveTraceEndY());
  edStoreFloat(entNum, F_ORIGIN2, moveTraceEndZ());
  linkEdictTouch(entNum);   // sv.ts physics_Toss links with touch_triggers=true

  if (peEntG != -1) impact(entNum, peEntG);   // impact only on entity hit (snapshot, pre-link)
}

// ================================================================================
// SV_Physics_Toss (SV_RunThink runs in svframe's wrapper). gravityFieldIdx = -1
// if the loaded progs has no per-entity "gravity" field.
// ================================================================================
function addGravity(entNum: i32, frametime: f64, gravityCvar: f64, gravityFieldIdx: i32): void {
  let entGravity: f64 = 1.0;
  if (gravityFieldIdx >= 0) {
    const g: f64 = <f64>edLoadFloat(entNum, gravityFieldIdx);
    entGravity = (g != 0.0) ? g : 1.0;
  }
  const v2: f64 = <f64>edLoadFloat(entNum, F_VELOCITY2);
  edStoreFloat(entNum, F_VELOCITY2, v2 - entGravity * gravityCvar * frametime);
}

export function physicsToss(entNum: i32, frametime: f64, maxVelocity: f64, gravityCvar: f64, gravityFieldIdx: i32): void {
  const flags0: i32 = <i32>edLoadFloat(entNum, F_FLAGS);
  if ((flags0 & FL_ONGROUND) != 0) return;

  checkVelocity(entNum, maxVelocity);

  const movetype: i32 = <i32>edLoadFloat(entNum, F_MOVETYPE);
  if (movetype != MOVE_TYPE_FLY && movetype != MOVE_TYPE_FLYMISSILE) {
    addGravity(entNum, frametime, gravityCvar, gravityFieldIdx);
  }

  const aX: f64 = <f64>edLoadFloat(entNum, F_ANGLES), aY: f64 = <f64>edLoadFloat(entNum, F_ANGLES1), aZ: f64 = <f64>edLoadFloat(entNum, F_ANGLES2);
  const avX: f64 = <f64>edLoadFloat(entNum, F_AVELOCITY), avY: f64 = <f64>edLoadFloat(entNum, F_AVELOCITY1), avZ: f64 = <f64>edLoadFloat(entNum, F_AVELOCITY2);
  edStoreFloat(entNum, F_ANGLES, aX + frametime * avX);
  edStoreFloat(entNum, F_ANGLES1, aY + frametime * avY);
  edStoreFloat(entNum, F_ANGLES2, aZ + frametime * avZ);

  const velX: f64 = <f64>edLoadFloat(entNum, F_VELOCITY);
  const velY: f64 = <f64>edLoadFloat(entNum, F_VELOCITY1);
  const velZ: f64 = <f64>edLoadFloat(entNum, F_VELOCITY2);
  const pushX: f64 = velX * frametime, pushY: f64 = velY * frametime, pushZ: f64 = velZ * frametime;

  pushEntity(entNum, pushX, pushY, pushZ);

  // pushTrace* snapshot, NOT moveTrace* (see peFrac note). impact's touch QC can
  // free ent inside pushEntity.
  if (pushTraceFraction() == 1.0 || isEdictFree(entNum) != 0) return;

  const curVelX: f64 = <f64>edLoadFloat(entNum, F_VELOCITY);
  const curVelY: f64 = <f64>edLoadFloat(entNum, F_VELOCITY1);
  const curVelZ: f64 = <f64>edLoadFloat(entNum, F_VELOCITY2);
  // Mirrors sv.ts physics_Toss (QSS-M sv_phys.c:1460-1466): only the backoff sees movetype 11
  // coerced to MOVETYPE_BOUNCE. Gravity above and the ground-stop below read the raw movetype.
  const bouncetype: i32 = (movetype == MOVE_TYPE_BOUNCEMISSILE && isRerelease()) ? MOVE_TYPE_BOUNCE : movetype;
  const overbounce: f64 = (bouncetype == MOVE_TYPE_BOUNCE) ? 1.5 : ((bouncetype == MOVE_TYPE_BOUNCEMISSILE) ? 2.0 : 1.0);
  clipVelocityInternal(curVelX, curVelY, curVelZ, pushTracePlaneNX(), pushTracePlaneNY(), pushTracePlaneNZ(), overbounce);
  edStoreFloat(entNum, F_VELOCITY, cvOutX);
  edStoreFloat(entNum, F_VELOCITY1, cvOutY);
  edStoreFloat(entNum, F_VELOCITY2, cvOutZ);

  if (pushTracePlaneNZ() > 0.7) {
    // sv.ts:1986 re-reads the FIELD after ed.setVector, so this compares the
    // f32-rounded value: a cvOutZ just under 60 rounds to exactly 60f and must
    // NOT ground the entity.
    const v2AfterClip: f64 = <f64>edLoadFloat(entNum, F_VELOCITY2);
    if (v2AfterClip < 60.0 || movetype != MOVE_TYPE_BOUNCE) {
      const flags: i32 = <i32>edLoadFloat(entNum, F_FLAGS);
      edStoreFloat(entNum, F_FLAGS, <f64>(flags | FL_ONGROUND));
      edStoreInt(entNum, F_GROUNDENTITY, pushTraceEnt());
      edStoreFloat(entNum, F_VELOCITY, 0.0);
      edStoreFloat(entNum, F_VELOCITY1, 0.0);
      edStoreFloat(entNum, F_VELOCITY2, 0.0);
      edStoreFloat(entNum, F_AVELOCITY, 0.0);
      edStoreFloat(entNum, F_AVELOCITY1, 0.0);
      edStoreFloat(entNum, F_AVELOCITY2, 0.0);
    }
  }

  checkWaterTransition(entNum);
}

// Watersplash (QSS-M SV_CheckWaterTransition) / land (SV_Physics_Step) sounds: the
// host owns the cvars and their empty-string gates; the sim only signals which
// entity crossed. Import namespace = this file's basename.
declare function host_watersplash(entNum: i32): void;
declare function host_hitsound(entNum: i32): void;

export function hitsound(entNum: i32): void { host_hitsound(entNum); }

// sv.ts checkWaterTransition — incl. the vanilla quirk that leaving water stores
// the raw CONTENTS value into waterlevel. QC branches on these fields.
export function checkWaterTransition(entNum: i32): void {
  const cont: i32 = pointContents(
    <f64>edLoadFloat(entNum, F_ORIGIN),
    <f64>edLoadFloat(entNum, F_ORIGIN1),
    <f64>edLoadFloat(entNum, F_ORIGIN2));
  if (edLoadFloat(entNum, F_WATERTYPE) == 0.0) {
    edStoreFloat(entNum, F_WATERTYPE, <f64>cont);
    edStoreFloat(entNum, F_WATERLEVEL, 1.0);
    return;
  }
  if (cont <= CONTENTS_WATER) {
    if (edLoadFloat(entNum, F_WATERTYPE) == <f32>CONTENTS_EMPTY) host_watersplash(entNum);
    edStoreFloat(entNum, F_WATERTYPE, <f64>cont);
    edStoreFloat(entNum, F_WATERLEVEL, 1.0);
    return;
  }
  if (edLoadFloat(entNum, F_WATERTYPE) != <f32>CONTENTS_EMPTY) host_watersplash(entNum);
  edStoreFloat(entNum, F_WATERTYPE, <f64>CONTENTS_EMPTY);
  edStoreFloat(entNum, F_WATERLEVEL, <f64>cont);
}
