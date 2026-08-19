// Monster-movement QuakeC builtins — sv.ts SV_CheckBottom / SV_movestep /
// SV_StepDirection / SV_NewChaseDir / closeEnough, plus pf.ts walkmove (#32),
// checkbottom (#40), movetogoal (#67). Composes svmove.ts (SV_Move/linkEdict) +
// world.ts (pointContents) + ed.ts + math.ts (anglemod).
//
// Every sv.ts `linkEdict(ent, true)` site is ported as linkEdictTouch — touch
// dispatch must fire. pf.ts's pr.state.xfunction save/restore is not modeled
// (JS-side error-reporting state only).
//
// host_random(): sv.ts newChaseDir and movetogoal call Math.random(); same
// import ABI as host.ts's BI_RANDOM.
//
// *** PARITY GOTCHA (read before extending): svmove.move() writes its result
// into ONE shared set of module-level out* scalars, while the JS reference
// hands each caller its OWN Trace object. Never read a move()-result getter
// after any call that might itself call move() (checkBottom does, repeatedly)
// — capture the needed field into a local first. See movestep's
// traceEntForGround.
//
// PARITY: reads widen f32->f64, each store rounds once (edStoreFloat/
// edStoreInt); svmove.ts's trace math is f64-exact throughout.

import { gf, gi, setf, seti, GLOBALS } from "./abi";
import { anglemod } from "./math";
import {
  edLoadFloat, edStoreFloat, edLoadInt, edStoreInt,
  linkEdict, linkEdictTouch, move, MOVE_NORMAL, MOVE_NOMONSTERS,
  moveTraceFraction, moveTraceEndX, moveTraceEndY, moveTraceEndZ,
  moveTraceAllSolid, moveTraceStartSolid, moveTraceEnt,
  pointContents,
} from "./svmove";

// Host-bridged transcendentals: AssemblyScript's own Math.sin/cos/atan2 can differ from the
// JS engine's by 1 f64 ulp on rare inputs, which crosses f32 store boundaries and forks the
// sims. Import namespace = this file's name.
declare function host_sin(x: f64): f64;
declare function host_cos(x: f64): f64;

// Re-export svmove (which re-exports ed.ts + world.ts) for the test harness's
// loader surface.
export * from "./svmove";

export function globalsPtr(): usize { return GLOBALS; }
// JS-callable GLOBALS accessors — heap.alloc can grow/detach wasm memory, so
// callers use these instead of a captured typed-array view.
export function writeGlobalFloat(idx: i32, v: f32): void { setf(GLOBALS, idx, <f64>v); }
export function readGlobalFloat(idx: i32): f32 { return <f32>gf(GLOBALS, idx); }
export function writeGlobalInt(idx: i32, v: i32): void { seti(GLOBALS, idx, v); }
export function readGlobalInt(idx: i32): i32 { return gi(GLOBALS, idx); }

declare function host_random(): f64; // same ABI as host.ts's BI_RANDOM import

// --- QC call-ABI / engine-reserved global indices (src/engine/pr.ts globalvars) -
const PARM0: i32 = 4;   // #32 walkmove's yaw / #67 movetogoal's dist / #40 checkbottom's entity
const PARM1: i32 = 7;   // #32 walkmove's dist
const RETURN: i32 = 1;
const GLOBAL_SELF: i32 = 28;

// --- entvars field indices (src/engine/pr.ts entvars, vanilla layout — matches
// svmove.ts/svphysics.ts's own F_* constants) ----------------------------------
const F_ABSMIN: i32 = 1, F_ABSMAX: i32 = 4;
const F_ORIGIN: i32 = 10, F_ORIGIN1: i32 = 11, F_ORIGIN2: i32 = 12;
const F_ANGLES1: i32 = 20;
const F_MINS: i32 = 33, F_MINS1: i32 = 34, F_MINS2: i32 = 35;
const F_MAXS: i32 = 36, F_MAXS1: i32 = 37, F_MAXS2: i32 = 38;
const F_GROUNDENTITY: i32 = 47;
const F_ENEMY: i32 = 75;
const F_FLAGS: i32 = 76;
const F_IDEAL_YAW: i32 = 85;
const F_YAW_SPEED: i32 = 86;
const F_GOALENTITY: i32 = 88;

// --- sv.ts FL.* (the slice this module touches) -------------------------------
const FL_FLY: i32 = 1, FL_SWIM: i32 = 2;
const FL_ONGROUND: i32 = 512, FL_PARTIALGROUND: i32 = 1024;

// mod.ts CONTENTS.empty/solid (world.ts's copy is not exported).
const CONTENTS_EMPTY: i32 = -1;
const CONTENTS_SOLID: i32 = -2;

// ================================================================================
// SV_CheckBottom
// ================================================================================
export function checkBottom(entNum: i32): bool {
  const originX: f64 = <f64>edLoadFloat(entNum, F_ORIGIN);
  const originY: f64 = <f64>edLoadFloat(entNum, F_ORIGIN1);
  const originZ: f64 = <f64>edLoadFloat(entNum, F_ORIGIN2);
  const minsX: f64 = originX + <f64>edLoadFloat(entNum, F_MINS);
  const minsY: f64 = originY + <f64>edLoadFloat(entNum, F_MINS1);
  const minsZ: f64 = originZ + <f64>edLoadFloat(entNum, F_MINS2);
  const maxsX: f64 = originX + <f64>edLoadFloat(entNum, F_MAXS);
  const maxsY: f64 = originY + <f64>edLoadFloat(entNum, F_MAXS1);
  const maxsZ: f64 = originZ + <f64>edLoadFloat(entNum, F_MAXS2);

  // Quick corner check. MUST stay `while (true)`, NOT `for (;;)`: an AS/
  // binaryen quirk treats code after a bare `for (;;) {...break...}` as
  // unreachable — -O3 silently discarded the entire trace-down fallback below.
  while (true) {
    if (pointContents(minsX, minsY, minsZ - 1.0) != CONTENTS_SOLID) break;
    if (pointContents(minsX, maxsY, minsZ - 1.0) != CONTENTS_SOLID) break;
    if (pointContents(maxsX, minsY, minsZ - 1.0) != CONTENTS_SOLID) break;
    if (pointContents(maxsX, maxsY, minsZ - 1.0) != CONTENTS_SOLID) break;
    return true;
  }

  // Trace-down fallback: each corner must land within 18 units of the center.
  const startX: f64 = (minsX + maxsX) * 0.5;
  const startY: f64 = (minsY + maxsY) * 0.5;
  const startZ: f64 = minsZ;
  const stopZ: f64 = startZ - 36.0;

  move(startX, startY, startZ, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, startX, startY, stopZ, MOVE_NOMONSTERS, entNum);
  if (moveTraceFraction() == 1.0) return false;

  const mid: f64 = moveTraceEndZ();
  let bottom: f64 = mid;

  for (let x: i32 = 0; x <= 1; x++) {
    for (let y: i32 = 0; y <= 1; y++) {
      const cx: f64 = (x != 0) ? maxsX : minsX;
      const cy: f64 = (y != 0) ? maxsY : minsY;
      move(cx, cy, startZ, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, cx, cy, stopZ, MOVE_NOMONSTERS, entNum);
      const fraction: f64 = moveTraceFraction();
      const endZ: f64 = moveTraceEndZ();
      if (fraction != 1.0 && endZ > bottom) bottom = endZ;
      if (fraction == 1.0 || (mid - endZ) > 18.0) return false;
    }
  }
  return true;
}

// ================================================================================
// SV_movestep. Returns 0/1 ints, not bools — callers compare == 1.
// ================================================================================
export function movestep(entNum: i32, moveX: f64, moveY: f64, relink: bool): i32 {
  const oldX: f64 = <f64>edLoadFloat(entNum, F_ORIGIN);
  const oldY: f64 = <f64>edLoadFloat(entNum, F_ORIGIN1);
  const oldZ: f64 = <f64>edLoadFloat(entNum, F_ORIGIN2);
  const minsX: f64 = <f64>edLoadFloat(entNum, F_MINS), minsY: f64 = <f64>edLoadFloat(entNum, F_MINS1), minsZ: f64 = <f64>edLoadFloat(entNum, F_MINS2);
  const maxsX: f64 = <f64>edLoadFloat(entNum, F_MAXS), maxsY: f64 = <f64>edLoadFloat(entNum, F_MAXS1), maxsZ: f64 = <f64>edLoadFloat(entNum, F_MAXS2);
  const flags0: i32 = <i32>edLoadFloat(entNum, F_FLAGS);

  if ((flags0 & (FL_SWIM | FL_FLY)) != 0) {
    const enemy: i32 = edLoadInt(entNum, F_ENEMY);
    for (let i: i32 = 0; i <= 1; i++) {
      // oldX/Y/Z double as "current origin": nothing in this loop writes
      // origin before a successful return.
      let newX: f64 = oldX + moveX;
      let newY: f64 = oldY + moveY;
      let newZ: f64 = oldZ;
      if (i == 0 && enemy != 0) {
        const dz: f64 = oldZ - <f64>edLoadFloat(enemy, F_ORIGIN2);
        if (dz > 40.0) newZ -= 8.0;
        else if (dz < 30.0) newZ += 8.0;
      }
      move(oldX, oldY, oldZ, minsX, minsY, minsZ, maxsX, maxsY, maxsZ, newX, newY, newZ, MOVE_NORMAL, entNum);
      if (moveTraceFraction() == 1.0) {
        const endX: f64 = moveTraceEndX(), endY: f64 = moveTraceEndY(), endZ: f64 = moveTraceEndZ();
        if ((flags0 & FL_SWIM) != 0 && pointContents(endX, endY, endZ) == CONTENTS_EMPTY) return 0;
        edStoreFloat(entNum, F_ORIGIN, endX);
        edStoreFloat(entNum, F_ORIGIN1, endY);
        edStoreFloat(entNum, F_ORIGIN2, endZ);
        if (relink) linkEdictTouch(entNum);
        return 1;
      }
      if (enemy == 0) return 0;
    }
    return 0;
  }

  const stepX: f64 = oldX + moveX;
  const stepY: f64 = oldY + moveY;
  let startZ: f64 = oldZ + 18.0;
  const endZ: f64 = startZ - 36.0; // fixed target Z: computed ONCE, before any step-down retry adjusts startZ

  move(stepX, stepY, startZ, minsX, minsY, minsZ, maxsX, maxsY, maxsZ, stepX, stepY, endZ, MOVE_NORMAL, entNum);
  if (moveTraceAllSolid()) return 0;
  if (moveTraceStartSolid()) {
    startZ -= 18.0;
    move(stepX, stepY, startZ, minsX, minsY, minsZ, maxsX, maxsY, maxsZ, stepX, stepY, endZ, MOVE_NORMAL, entNum);
    if (moveTraceAllSolid() || moveTraceStartSolid()) return 0;
  }

  if (moveTraceFraction() == 1.0) {
    if ((flags0 & FL_PARTIALGROUND) == 0) return 0;
    edStoreFloat(entNum, F_ORIGIN, oldX + moveX);
    edStoreFloat(entNum, F_ORIGIN1, oldY + moveY);
    if (relink) linkEdictTouch(entNum);
    edStoreFloat(entNum, F_FLAGS, <f64>(flags0 & ~FL_ONGROUND));
    return 1;
  }

  const traceEndX: f64 = moveTraceEndX(), traceEndY: f64 = moveTraceEndY(), traceEndZ: f64 = moveTraceEndZ();
  // Capture BEFORE checkBottom(): its internal move() calls overwrite the
  // shared trace-result state (header PARITY GOTCHA).
  const traceEntForGround: i32 = moveTraceEnt();

  edStoreFloat(entNum, F_ORIGIN, traceEndX);
  edStoreFloat(entNum, F_ORIGIN1, traceEndY);
  edStoreFloat(entNum, F_ORIGIN2, traceEndZ);

  if (!checkBottom(entNum)) {
    if ((flags0 & FL_PARTIALGROUND) != 0) {
      if (relink) linkEdictTouch(entNum);
      return 1;
    }
    edStoreFloat(entNum, F_ORIGIN, oldX);
    edStoreFloat(entNum, F_ORIGIN1, oldY);
    edStoreFloat(entNum, F_ORIGIN2, oldZ);
    return 0;
  }

  // flags0 is still current: nothing since function entry writes F_FLAGS.
  edStoreFloat(entNum, F_FLAGS, <f64>(flags0 & ~FL_PARTIALGROUND));
  edStoreInt(entNum, F_GROUNDENTITY, traceEntForGround);
  if (relink) linkEdictTouch(entNum);
  return 1;
}

// ================================================================================
// pf.ts changeyaw (#49) inlined. Takes entNum directly instead of GLOBAL_SELF:
// within this call chain self is always the acting entity (touchLinks saves/
// restores self around dispatch).
// ================================================================================
function changeyawStep(entNum: i32): void {
  const current: f64 = anglemod(<f64>edLoadFloat(entNum, F_ANGLES1));
  const ideal: f64 = <f64>edLoadFloat(entNum, F_IDEAL_YAW);
  if (current == ideal) return;
  let mv: f64 = ideal - current;
  if (ideal > current) {
    if (mv >= 180.0) mv -= 360.0;
  } else if (mv <= -180.0) {
    mv += 360.0;
  }
  const speed: f64 = <f64>edLoadFloat(entNum, F_YAW_SPEED);
  if (mv > 0.0) {
    if (mv > speed) mv = speed;
  } else if (mv < -speed) {
    mv = -speed;
  }
  edStoreFloat(entNum, F_ANGLES1, anglemod(current + mv));
}

// ================================================================================
// SV.StepDirection
// ================================================================================
function stepDirection(entNum: i32, yawDeg: f64, dist: f64): bool {
  edStoreFloat(entNum, F_IDEAL_YAW, yawDeg);
  changeyawStep(entNum);
  // sv.ts uses a compound assignment here, grouping as yaw * (pi/180) — which
  // rounds differently from (yaw*pi)/180 for some yaws (215, a newChaseDir
  // candidate, among them). This ONE site must keep the grouped form; every
  // other conversion in the port uses the ungrouped `a * PI / 180.0`.
  const yawRad: f64 = yawDeg * (Math.PI / 180.0);
  const oldX: f64 = <f64>edLoadFloat(entNum, F_ORIGIN);
  const oldY: f64 = <f64>edLoadFloat(entNum, F_ORIGIN1);
  const oldZ: f64 = <f64>edLoadFloat(entNum, F_ORIGIN2);
  if (movestep(entNum, host_cos(yawRad) * dist, host_sin(yawRad) * dist, false) == 1) {
    const delta: f64 = <f64>edLoadFloat(entNum, F_ANGLES1) - <f64>edLoadFloat(entNum, F_IDEAL_YAW);
    if (delta > 45.0 && delta < 315.0) {
      edStoreFloat(entNum, F_ORIGIN, oldX);
      edStoreFloat(entNum, F_ORIGIN1, oldY);
      edStoreFloat(entNum, F_ORIGIN2, oldZ);
    }
    // TOUCH must fire here (both branches), or monsters walk through
    // path_corners without t_movetarget firing.
    linkEdictTouch(entNum);
    return true;
  }
  linkEdictTouch(entNum);
  return false;
}

// ================================================================================
// SV.closeEnough
// ================================================================================
function closeEnough(entNum: i32, goalNum: i32, dist: f64): bool {
  for (let i: i32 = 0; i <= 2; i++) {
    if (<f64>edLoadFloat(goalNum, F_ABSMIN + i) > (<f64>edLoadFloat(entNum, F_ABSMAX + i) + dist)) return false;
    if (<f64>edLoadFloat(goalNum, F_ABSMAX + i) < (<f64>edLoadFloat(entNum, F_ABSMIN + i) - dist)) return false;
  }
  return true;
}

// ================================================================================
// SV.newChaseDir. Both host_random() draws are UNCONDITIONAL — Math.random()
// is the left operand of each JS `||`, so the short-circuit never skips it.
// ================================================================================
function newChaseDir(actorNum: i32, goalNum: i32, dist: f64): void {
  const idealYaw: f64 = <f64>edLoadFloat(actorNum, F_IDEAL_YAW);
  const olddir: f64 = anglemod(<f64>(<i32>(idealYaw / 45.0)) * 45.0);
  const turnaround: f64 = anglemod(olddir - 180.0);
  const deltax: f64 = <f64>edLoadFloat(goalNum, F_ORIGIN) - <f64>edLoadFloat(actorNum, F_ORIGIN);
  const deltay: f64 = <f64>edLoadFloat(goalNum, F_ORIGIN1) - <f64>edLoadFloat(actorNum, F_ORIGIN1);

  let dx: f64, dy: f64;
  if (deltax > 10.0) dx = 0.0;
  else if (deltax < -10.0) dx = 180.0;
  else dx = -1.0;
  if (deltay < -10.0) dy = 270.0;
  else if (deltay > 10.0) dy = 90.0;
  else dy = -1.0;

  let tdir: f64;
  if (dx != -1.0 && dy != -1.0) {
    if (dx == 0.0) tdir = (dy == 90.0) ? 45.0 : 315.0;
    else tdir = (dy == 90.0) ? 135.0 : 215.0;
    if (tdir != turnaround && stepDirection(actorNum, tdir, dist)) return;
  }

  if (host_random() >= 0.25 || Math.abs(deltay) > Math.abs(deltax)) {
    tdir = dx; dx = dy; dy = tdir;
  }
  if (dx != -1.0 && dx != turnaround && stepDirection(actorNum, dx, dist)) return;
  if (dy != -1.0 && dy != turnaround && stepDirection(actorNum, dy, dist)) return;
  if (olddir != -1.0 && stepDirection(actorNum, olddir, dist)) return;

  if (host_random() >= 0.5) {
    for (tdir = 0.0; tdir <= 315.0; tdir += 45.0) {
      if (tdir != turnaround && stepDirection(actorNum, tdir, dist)) return;
    }
  } else {
    for (tdir = 315.0; tdir >= 0.0; tdir -= 45.0) {
      if (tdir != turnaround && stepDirection(actorNum, tdir, dist)) return;
    }
  }
  if (turnaround != -1.0 && stepDirection(actorNum, turnaround, dist)) return;

  edStoreFloat(actorNum, F_IDEAL_YAW, olddir);
  if (!checkBottom(actorNum)) {
    const f: i32 = <i32>edLoadFloat(actorNum, F_FLAGS);
    edStoreFloat(actorNum, F_FLAGS, <f64>(f | FL_PARTIALGROUND));
  }
}

// Exported for direct golden-testing (not part of the QC builtin ABI).
export function stepDirectionExport(entNum: i32, yawDeg: f64, dist: f64): bool { return stepDirection(entNum, yawDeg, dist); }
export function closeEnoughExport(entNum: i32, goalNum: i32, dist: f64): bool { return closeEnough(entNum, goalNum, dist); }
export function newChaseDirExport(actorNum: i32, goalNum: i32, dist: f64): void { newChaseDir(actorNum, goalNum, dist); }

// ================================================================================
// Builtin-ABI wrappers (src/engine/pf.ts walkmove/checkbottom/moveToGoal)
// ================================================================================

// #32 float(float yaw, float dist) walkmove
export function pf_walkmove(g: usize): void {
  const entNum: i32 = gi(g, GLOBAL_SELF);
  const flags0: i32 = <i32>edLoadFloat(entNum, F_FLAGS);
  if ((flags0 & (FL_ONGROUND | FL_FLY | FL_SWIM)) == 0) {
    setf(g, RETURN, 0.0);
    return;
  }
  const yawRad: f64 = gf(g, PARM0) * Math.PI / 180.0;
  const dist: f64 = gf(g, PARM1);
  const result: i32 = movestep(entNum, host_cos(yawRad) * dist, host_sin(yawRad) * dist, true);
  setf(g, RETURN, <f64>result);
  seti(g, GLOBAL_SELF, entNum); // pf.ts's no-op self restore, kept verbatim
}

// #40 float(entity e) checkbottom
export function pf_checkbottom(g: usize): void {
  const entNum: i32 = gi(g, PARM0);
  setf(g, RETURN, checkBottom(entNum) ? 1.0 : 0.0);
}

// #67 void(float dist) movetogoal. Void builtin: RETURN is written only on the
// early-bail path, matching pf.ts moveToGoal.
export function pf_movetogoal(g: usize): void {
  const entNum: i32 = gi(g, GLOBAL_SELF);
  const flags0: i32 = <i32>edLoadFloat(entNum, F_FLAGS);
  if ((flags0 & (FL_ONGROUND | FL_FLY | FL_SWIM)) == 0) {
    setf(g, RETURN, 0.0);
    return;
  }
  const goalNum: i32 = edLoadInt(entNum, F_GOALENTITY);
  const dist: f64 = gf(g, PARM0);
  const enemy: i32 = edLoadInt(entNum, F_ENEMY);
  if (enemy != 0 && closeEnough(entNum, goalNum, dist)) return;
  const idealYaw: f64 = <f64>edLoadFloat(entNum, F_IDEAL_YAW);
  if (host_random() >= 0.75 || !stepDirection(entNum, idealYaw, dist)) {
    newChaseDir(entNum, goalNum, dist);
  }
}
