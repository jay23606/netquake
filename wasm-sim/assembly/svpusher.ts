// MOVETYPE_PUSH physics — port of sv.ts physics_Pusher (SV_Physics_Pusher) /
// pushMove (SV_PushMove, linear) / pushMoveAngles (SV_PushMoveAngles,
// DP_SV_ROTATINGBMODEL). Does its own inline think dispatch (not svframe.runThink).
//
// - pushMoveLinear re-captures pusher.solid PER RIDER around that rider's pushEntity
//   (sv.ts's solidBackup, sv.ts:1638-1641) — NOT vanilla/QSS-M's hardcoded SOLID_BSP,
//   and not hoisted out of the loop: pushEntity runs touch/impact QC that may change
//   pusher.solid, and later riders must see it. pushMoveAngles never mutates it.
// - Candidate gather is the literal ascending full-edict scan (vanilla/QSS-M's real
//   order) — not sv.ts's area-tree gatherPushCandidates. For area-linked entities the
//   candidate SET matches (the inline absbox filter does the exclusion), and a full
//   scan also covers SOLID_NOT riders without a side registry. It is a strict SUPERSET
//   for edicts in neither JS source: never-linked edicts (absbox still zeroed), and
//   SOLID_NOT edicts that missed registration and were never re-linked.
// - pusherOverlaps (FTE_ENT_SKIN_CONTENTS, skin < 0) delegates to svmove's
//   clipEntityStartSolid, so the pusher's hull is picked by hullForEntity (a
//   SOLID_BSP pusher gets its model's clip hull, not its bounding box).
//
// PARITY: f64 throughout; edict fields via edLoadFloat/edStoreFloat. angleVectors
// is a local transliteration of vec.ts — degrees->radians as `angle * Math.PI /
// 180.0` (not `angle * (PI/180)`, which rounds differently in f64).

import {
  execute, writeGlobalInt, writeGlobalFloat,
  edLoadInt, edStoreInt, edLoadFloat, edStoreFloat,
  linkEdict, linkEdictTouch, unlinkEdict, isEdictFree, getNumEdicts,
  setPlane, setClipNode, setHullMeta, setWorldHullRange,
  pushEntity,
} from "./svframe";
import { move, MOVE_NORMAL, moveTraceStartSolid, clipEntityStartSolid } from "./svmove";
import { isRerelease } from "./abi";

// Host-bridged transcendentals: AssemblyScript's own Math.sin/cos/atan2 can differ from the
// JS engine's by 1 f64 ulp on rare inputs, which crosses f32 store boundaries and forks the
// sims. Import namespace = this file's name.
declare function host_sin(x: f64): f64;
declare function host_cos(x: f64): f64;

// Re-export the setup/accessor surface a standalone test build needs.
export {
  execute, writeGlobalInt, writeGlobalFloat,
  edLoadInt, edStoreInt, edLoadFloat, edStoreFloat,
  linkEdict, unlinkEdict, isEdictFree, getNumEdicts,
  setPlane, setClipNode, setHullMeta, setWorldHullRange,
  pushEntity,
};
export * from "./svframe";

// --- QC call-ABI / engine-reserved global indices (src/engine/pr.ts globalvars) -
const GLOBAL_SELF: i32 = 28;
const GLOBAL_OTHER: i32 = 29;
const GLOBAL_TIME: i32 = 31;

// --- entvars field indices (src/engine/pr.ts entvars, vanilla layout) ---------
const F_ABSMIN: i32 = 1, F_ABSMIN1: i32 = 2, F_ABSMIN2: i32 = 3;
const F_ABSMAX: i32 = 4, F_ABSMAX1: i32 = 5, F_ABSMAX2: i32 = 6;
const F_LTIME: i32 = 7, F_MOVETYPE: i32 = 8, F_SOLID: i32 = 9;
const F_ORIGIN: i32 = 10, F_ORIGIN1: i32 = 11, F_ORIGIN2: i32 = 12;
const F_VELOCITY: i32 = 16, F_VELOCITY1: i32 = 17, F_VELOCITY2: i32 = 18;
const F_ANGLES: i32 = 19, F_ANGLES1: i32 = 20, F_ANGLES2: i32 = 21;
const F_AVELOCITY: i32 = 22, F_AVELOCITY1: i32 = 23, F_AVELOCITY2: i32 = 24;
const F_SKIN: i32 = 31;
const F_MINS: i32 = 33, F_MINS1: i32 = 34, F_MINS2: i32 = 35;
const F_MAXS: i32 = 36, F_MAXS1: i32 = 37, F_MAXS2: i32 = 38;
const F_THINK: i32 = 44, F_BLOCKED: i32 = 45, F_NEXTTHINK: i32 = 46, F_GROUNDENTITY: i32 = 47;
const F_FLAGS: i32 = 76;

// --- sv.ts SOLID / FL / MOVE_TYPE enums (the slice this module touches) -------
const SOLID_NOT: i32 = 0, SOLID_TRIGGER: i32 = 1;
const FL_ONGROUND: i32 = 512;
const MOVE_TYPE_NONE: i32 = 0, MOVE_TYPE_ANGLENOCLIP: i32 = 1, MOVE_TYPE_WALK: i32 = 3;
const MOVE_TYPE_PUSH: i32 = 7, MOVE_TYPE_NOCLIP: i32 = 8;

// ================================================================================
// SV_TestEntityPosition — a zero-length svmove.move() sweep, startsolid only.
// ================================================================================
function testEntityPosition(entNum: i32): bool {
  const ox: f64 = <f64>edLoadFloat(entNum, F_ORIGIN), oy: f64 = <f64>edLoadFloat(entNum, F_ORIGIN1), oz: f64 = <f64>edLoadFloat(entNum, F_ORIGIN2);
  const minsX: f64 = <f64>edLoadFloat(entNum, F_MINS), minsY: f64 = <f64>edLoadFloat(entNum, F_MINS1), minsZ: f64 = <f64>edLoadFloat(entNum, F_MINS2);
  const maxsX: f64 = <f64>edLoadFloat(entNum, F_MAXS), maxsY: f64 = <f64>edLoadFloat(entNum, F_MAXS1), maxsZ: f64 = <f64>edLoadFloat(entNum, F_MAXS2);
  move(ox, oy, oz, minsX, minsY, minsZ, maxsX, maxsY, maxsZ, ox, oy, oz, MOVE_NORMAL, entNum);
  return moveTraceStartSolid() != 0;
}

// ================================================================================
// pusherOverlaps (FTE_ENT_SKIN_CONTENTS) — sv.ts:2840, a zero-length
// clipMoveToEntity of check's box against the PUSHER's own hull.
// ================================================================================
export function pusherSetWorldHullRange(firstclipnode: i32, lastclipnode: i32): void {
  setWorldHullRange(firstclipnode, lastclipnode);
}

// sv.ts pusherOverlaps. The hull comes from svmove's clipEntityStartSolid, i.e.
// hullForEntity: a SOLID_BSP pusher (what every contents volume is — clipToLinks'
// skin<0 skip only applies to SOLID_BSP) is tested against its MODEL's clip hull.
// Testing it as its bounding BOX instead claimed every entity in the bbox but
// outside the brush as a rider, and a wrongly-claimed rider gets carried — and, on
// a blocked push, has its origin reverted every frame while its velocity keeps
// integrating untouched.
function pusherOverlaps(pusherNum: i32, checkNum: i32): bool {
  return clipEntityStartSolid(
    pusherNum,
    <f64>edLoadFloat(checkNum, F_ORIGIN), <f64>edLoadFloat(checkNum, F_ORIGIN1), <f64>edLoadFloat(checkNum, F_ORIGIN2),
    <f64>edLoadFloat(checkNum, F_MINS), <f64>edLoadFloat(checkNum, F_MINS1), <f64>edLoadFloat(checkNum, F_MINS2),
    <f64>edLoadFloat(checkNum, F_MAXS), <f64>edLoadFloat(checkNum, F_MAXS1), <f64>edLoadFloat(checkNum, F_MAXS2),
  ) != 0;
}

// ================================================================================
// angleVectors — local transliteration of vec.ts (see header). Writes module scratch.
// ================================================================================
let avFwdX: f64, avFwdY: f64, avFwdZ: f64;
let avRightX: f64, avRightY: f64, avRightZ: f64;
let avUpX: f64, avUpY: f64, avUpZ: f64;
function angleVectorsLocal(pitchDeg: f64, yawDeg: f64, rollDeg: f64): void {
  const PI: f64 = Math.PI;
  const pitchRad: f64 = pitchDeg * PI / 180.0;
  const sp: f64 = host_sin(pitchRad), cp: f64 = host_cos(pitchRad);
  const yawRad: f64 = yawDeg * PI / 180.0;
  const sy: f64 = host_sin(yawRad), cy: f64 = host_cos(yawRad);
  const rollRad: f64 = rollDeg * PI / 180.0;
  const sr: f64 = host_sin(rollRad), cr: f64 = host_cos(rollRad);

  avFwdX = cp * cy; avFwdY = cp * sy; avFwdZ = -sp;
  avRightX = cr * sy - sr * sp * cy; avRightY = -sr * sp * sy - cr * cy; avRightZ = -sr * cp;
  avUpX = cr * sp * cy + sr * sy; avUpY = cr * sp * sy - sr * cy; avUpZ = cr * cp;
}

// ================================================================================
// Moved-entity revert scratch (pusher at slot 0 + up to maxEdicts riders);
// sized once at initPusherState.
// ================================================================================
let movedEdictsBase: usize = 0;
let movedOrigXBase: usize = 0, movedOrigYBase: usize = 0, movedOrigZBase: usize = 0;
let movedAngXBase: usize = 0, movedAngYBase: usize = 0, movedAngZBase: usize = 0;

export function initPusherState(maxEdicts: i32): void {
  const n: usize = <usize>(maxEdicts + 1);
  movedEdictsBase = heap.alloc(n * 4);
  movedOrigXBase = heap.alloc(n * 8); movedOrigYBase = heap.alloc(n * 8); movedOrigZBase = heap.alloc(n * 8);
  movedAngXBase = heap.alloc(n * 8); movedAngYBase = heap.alloc(n * 8); movedAngZBase = heap.alloc(n * 8);
}

@inline function setMoved(i: i32, ent: i32, ox: f64, oy: f64, oz: f64, ax: f64, ay: f64, az: f64): void {
  store<i32>(movedEdictsBase + (<usize>i << 2), ent);
  store<f64>(movedOrigXBase + (<usize>i << 3), ox); store<f64>(movedOrigYBase + (<usize>i << 3), oy); store<f64>(movedOrigZBase + (<usize>i << 3), oz);
  store<f64>(movedAngXBase + (<usize>i << 3), ax); store<f64>(movedAngYBase + (<usize>i << 3), ay); store<f64>(movedAngZBase + (<usize>i << 3), az);
}
@inline function movedEnt(i: i32): i32 { return load<i32>(movedEdictsBase + (<usize>i << 2)); }
@inline function movedOrigX(i: i32): f64 { return load<f64>(movedOrigXBase + (<usize>i << 3)); }
@inline function movedOrigY(i: i32): f64 { return load<f64>(movedOrigYBase + (<usize>i << 3)); }
@inline function movedOrigZ(i: i32): f64 { return load<f64>(movedOrigZBase + (<usize>i << 3)); }
@inline function movedAngX(i: i32): f64 { return load<f64>(movedAngXBase + (<usize>i << 3)); }
@inline function movedAngY(i: i32): f64 { return load<f64>(movedAngYBase + (<usize>i << 3)); }
@inline function movedAngZ(i: i32): f64 { return load<f64>(movedAngZBase + (<usize>i << 3)); }

// ================================================================================
// SV_PushMoveAngles — sv.ts pushMoveAngles. Candidate gather: ascending full-edict
// scan (see header) with sv.ts's inline per-candidate filter.
// ================================================================================
function pushMoveAngles(pusherNum: i32, movetime: f64): bool {
  const velX: f64 = <f64>edLoadFloat(pusherNum, F_VELOCITY), velY: f64 = <f64>edLoadFloat(pusherNum, F_VELOCITY1), velZ: f64 = <f64>edLoadFloat(pusherNum, F_VELOCITY2);
  const moveX: f64 = velX * movetime, moveY: f64 = velY * movetime, moveZ: f64 = velZ * movetime;
  const avelX: f64 = <f64>edLoadFloat(pusherNum, F_AVELOCITY), avelY: f64 = <f64>edLoadFloat(pusherNum, F_AVELOCITY1), avelZ: f64 = <f64>edLoadFloat(pusherNum, F_AVELOCITY2);
  const amoveX: f64 = avelX * movetime, amoveY: f64 = avelY * movetime, amoveZ: f64 = avelZ * movetime;

  const pAbsMinX: f64 = <f64>edLoadFloat(pusherNum, F_ABSMIN), pAbsMinY: f64 = <f64>edLoadFloat(pusherNum, F_ABSMIN1), pAbsMinZ: f64 = <f64>edLoadFloat(pusherNum, F_ABSMIN2);
  const pAbsMaxX: f64 = <f64>edLoadFloat(pusherNum, F_ABSMAX), pAbsMaxY: f64 = <f64>edLoadFloat(pusherNum, F_ABSMAX1), pAbsMaxZ: f64 = <f64>edLoadFloat(pusherNum, F_ABSMAX2);
  const minsX: f64 = pAbsMinX + moveX, minsY: f64 = pAbsMinY + moveY, minsZ: f64 = pAbsMinZ + moveZ;
  const maxsX: f64 = pAbsMaxX + moveX, maxsY: f64 = pAbsMaxY + moveY, maxsZ: f64 = pAbsMaxZ + moveZ;

  angleVectorsLocal(-amoveX, -amoveY, -amoveZ);
  const forwardX: f64 = avFwdX, forwardY: f64 = avFwdY, forwardZ: f64 = avFwdZ;
  const rightX: f64 = avRightX, rightY: f64 = avRightY, rightZ: f64 = avRightZ;
  const upX: f64 = avUpX, upY: f64 = avUpY, upZ: f64 = avUpZ;

  const pOrigX0: f64 = <f64>edLoadFloat(pusherNum, F_ORIGIN), pOrigY0: f64 = <f64>edLoadFloat(pusherNum, F_ORIGIN1), pOrigZ0: f64 = <f64>edLoadFloat(pusherNum, F_ORIGIN2);
  const pAngX0: f64 = <f64>edLoadFloat(pusherNum, F_ANGLES), pAngY0: f64 = <f64>edLoadFloat(pusherNum, F_ANGLES1), pAngZ0: f64 = <f64>edLoadFloat(pusherNum, F_ANGLES2);
  setMoved(0, pusherNum, pOrigX0, pOrigY0, pOrigZ0, pAngX0, pAngY0, pAngZ0);
  let movedCount: i32 = 1;

  edStoreFloat(pusherNum, F_ORIGIN, pOrigX0 + moveX);
  edStoreFloat(pusherNum, F_ORIGIN1, pOrigY0 + moveY);
  edStoreFloat(pusherNum, F_ORIGIN2, pOrigZ0 + moveZ);
  edStoreFloat(pusherNum, F_ANGLES, pAngX0 + amoveX);
  edStoreFloat(pusherNum, F_ANGLES1, pAngY0 + amoveY);
  edStoreFloat(pusherNum, F_ANGLES2, pAngZ0 + amoveZ);
  linkEdict(pusherNum);

  const numEdicts: i32 = getNumEdicts();
  for (let check: i32 = 1; check < numEdicts; check++) {
    if (check == pusherNum || isEdictFree(check) != 0) continue;
    const movetype: i32 = <i32>edLoadFloat(check, F_MOVETYPE);
    if (movetype == MOVE_TYPE_PUSH || movetype == MOVE_TYPE_NONE || movetype == MOVE_TYPE_NOCLIP || movetype == MOVE_TYPE_ANGLENOCLIP) continue;

    const flags0: i32 = <i32>edLoadFloat(check, F_FLAGS);
    const ground: i32 = edLoadInt(check, F_GROUNDENTITY);
    if ((flags0 & FL_ONGROUND) == 0 || ground != pusherNum) {
      const cAbsMinX: f64 = <f64>edLoadFloat(check, F_ABSMIN), cAbsMinY: f64 = <f64>edLoadFloat(check, F_ABSMIN1), cAbsMinZ: f64 = <f64>edLoadFloat(check, F_ABSMIN2);
      const cAbsMaxX: f64 = <f64>edLoadFloat(check, F_ABSMAX), cAbsMaxY: f64 = <f64>edLoadFloat(check, F_ABSMAX1), cAbsMaxZ: f64 = <f64>edLoadFloat(check, F_ABSMAX2);
      if (cAbsMinX >= maxsX || cAbsMinY >= maxsY || cAbsMinZ >= maxsZ ||
          cAbsMaxX <= minsX || cAbsMaxY <= minsY || cAbsMaxZ <= minsZ) continue;
      const pusherSkin: i32 = <i32>edLoadFloat(pusherNum, F_SKIN);
      if (pusherSkin < 0) {
        if (!pusherOverlaps(pusherNum, check)) continue;
      } else {
        if (!testEntityPosition(check)) continue;
      }
    }

    if (<i32>edLoadFloat(pusherNum, F_MOVETYPE) == MOVE_TYPE_PUSH || ground == pusherNum) {
      const cOrigX: f64 = <f64>edLoadFloat(check, F_ORIGIN), cOrigY: f64 = <f64>edLoadFloat(check, F_ORIGIN1), cOrigZ: f64 = <f64>edLoadFloat(check, F_ORIGIN2);
      const cAngX: f64 = <f64>edLoadFloat(check, F_ANGLES), cAngY: f64 = <f64>edLoadFloat(check, F_ANGLES1), cAngZ: f64 = <f64>edLoadFloat(check, F_ANGLES2);
      setMoved(movedCount, check, cOrigX, cOrigY, cOrigZ, cAngX, cAngY, cAngZ);
      movedCount++;

      edStoreFloat(check, F_ORIGIN, cOrigX + moveX);
      edStoreFloat(check, F_ORIGIN1, cOrigY + moveY);
      edStoreFloat(check, F_ORIGIN2, cOrigZ + moveZ);
      edStoreFloat(check, F_ANGLES, cAngX + amoveX);
      edStoreFloat(check, F_ANGLES1, cAngY + amoveY);
      edStoreFloat(check, F_ANGLES2, cAngZ + amoveZ);

      const newOrigX: f64 = <f64>edLoadFloat(check, F_ORIGIN), newOrigY: f64 = <f64>edLoadFloat(check, F_ORIGIN1), newOrigZ: f64 = <f64>edLoadFloat(check, F_ORIGIN2);
      const pOrigXn: f64 = <f64>edLoadFloat(pusherNum, F_ORIGIN), pOrigYn: f64 = <f64>edLoadFloat(pusherNum, F_ORIGIN1), pOrigZn: f64 = <f64>edLoadFloat(pusherNum, F_ORIGIN2);
      const orgX: f64 = newOrigX - pOrigXn, orgY: f64 = newOrigY - pOrigYn, orgZ: f64 = newOrigZ - pOrigZn;
      const org2X: f64 = orgX * forwardX + orgY * forwardY + orgZ * forwardZ;
      const org2Y: f64 = -(orgX * rightX + orgY * rightY + orgZ * rightZ);
      const org2Z: f64 = orgX * upX + orgY * upY + orgZ * upZ;
      const move2X: f64 = org2X - orgX, move2Y: f64 = org2Y - orgY, move2Z: f64 = org2Z - orgZ;
      edStoreFloat(check, F_ORIGIN, newOrigX + move2X);
      edStoreFloat(check, F_ORIGIN1, newOrigY + move2Y);
      edStoreFloat(check, F_ORIGIN2, newOrigZ + move2Z);

      // QSS-M rider exemption: keep FL_ONGROUND for entities whose groundentity is
      // THIS pusher — clearing it paralyzes rider AI (movetogoal requires onground).
      if (movetype != MOVE_TYPE_WALK && edLoadInt(check, F_GROUNDENTITY) != pusherNum) {
        const cf: i32 = <i32>edLoadFloat(check, F_FLAGS);
        edStoreFloat(check, F_FLAGS, <f64>(cf & (~FL_ONGROUND)));
      }
      if (edLoadInt(check, F_GROUNDENTITY) != pusherNum) edStoreInt(check, F_GROUNDENTITY, 0);

      if (!testEntityPosition(check)) {
        linkEdict(check);
        continue;
      }

      const pusherSkin2: i32 = <i32>edLoadFloat(pusherNum, F_SKIN);
      if (pusherSkin2 < 0) {
        linkEdict(check);
        continue;
      }

      const baseIdx: i32 = movedCount - 1;
      edStoreFloat(check, F_ORIGIN, movedOrigX(baseIdx));
      edStoreFloat(check, F_ORIGIN1, movedOrigY(baseIdx));
      edStoreFloat(check, F_ORIGIN2, movedOrigZ(baseIdx));
      if (!testEntityPosition(check)) {
        movedCount--;
        continue;
      }

      pushEntity(check, moveX, moveY, moveZ);
      if (!testEntityPosition(check)) continue;

      const baseX: f64 = <f64>edLoadFloat(check, F_ORIGIN), baseY: f64 = <f64>edLoadFloat(check, F_ORIGIN1), baseZ: f64 = <f64>edLoadFloat(check, F_ORIGIN2);
      let blocked: bool = true;
      for (let i: i32 = 0; i < 8 && blocked; i++) {
        edStoreFloat(check, F_ORIGIN, baseX + (((i & 1) != 0) ? -0.125 : 0.125));
        edStoreFloat(check, F_ORIGIN1, baseY + (((i & 2) != 0) ? -0.125 : 0.125));
        edStoreFloat(check, F_ORIGIN2, baseZ + (((i & 4) != 0) ? -0.125 : 0.125));
        blocked = testEntityPosition(check);
      }
      if (!blocked) {
        linkEdict(check);
        continue;
      }
    }

    if (edLoadFloat(check, F_MINS) == edLoadFloat(check, F_MAXS)) {
      linkEdict(check);
      continue;
    }

    const checkSolid: i32 = <i32>edLoadFloat(check, F_SOLID);
    if (checkSolid == SOLID_NOT || checkSolid == SOLID_TRIGGER) {
      edStoreFloat(check, F_MINS, 0.0); edStoreFloat(check, F_MAXS, 0.0);
      edStoreFloat(check, F_MINS1, 0.0); edStoreFloat(check, F_MAXS1, 0.0);
      edStoreFloat(check, F_MAXS2, <f64>edLoadFloat(check, F_MINS2));
      linkEdict(check);
      continue;
    }

    // sv.ts pushMove: pusher's .blocked QC (self=pusher, other=blocker) — squishes a
    // rider the pusher can't shove aside (plat_crush/door_blocked -> T_Damage).
    const blockedFn: i32 = edLoadInt(pusherNum, F_BLOCKED);
    if (blockedFn != 0) {
      writeGlobalInt(GLOBAL_SELF, pusherNum);
      writeGlobalInt(GLOBAL_OTHER, check);
      execute(blockedFn);
    }

    for (let i: i32 = movedCount - 1; i >= 0; i--) {
      const revEnt: i32 = movedEnt(i);
      edStoreFloat(revEnt, F_ORIGIN, movedOrigX(i));
      edStoreFloat(revEnt, F_ORIGIN1, movedOrigY(i));
      edStoreFloat(revEnt, F_ORIGIN2, movedOrigZ(i));
      edStoreFloat(revEnt, F_ANGLES, movedAngX(i));
      edStoreFloat(revEnt, F_ANGLES1, movedAngY(i));
      edStoreFloat(revEnt, F_ANGLES2, movedAngZ(i));
      linkEdict(revEnt);
    }
    return false;
  }

  // Re-link every moved entity WITH touch dispatch (SV_LinkEdict(p->ent, true)).
  for (let i: i32 = movedCount - 1; i >= 0; i--) {
    linkEdictTouch(movedEnt(i));
  }
  return true;
}

// ================================================================================
// SV_PushMove (linear movers) — sv.ts pushMove's non-angular branch.
// ================================================================================
function pushMoveLinear(pusherNum: i32, movetime: f64): void {
  const velX: f64 = <f64>edLoadFloat(pusherNum, F_VELOCITY), velY: f64 = <f64>edLoadFloat(pusherNum, F_VELOCITY1), velZ: f64 = <f64>edLoadFloat(pusherNum, F_VELOCITY2);
  const moveX: f64 = velX * movetime, moveY: f64 = velY * movetime, moveZ: f64 = velZ * movetime;

  const pAbsMinX: f64 = <f64>edLoadFloat(pusherNum, F_ABSMIN), pAbsMinY: f64 = <f64>edLoadFloat(pusherNum, F_ABSMIN1), pAbsMinZ: f64 = <f64>edLoadFloat(pusherNum, F_ABSMIN2);
  const pAbsMaxX: f64 = <f64>edLoadFloat(pusherNum, F_ABSMAX), pAbsMaxY: f64 = <f64>edLoadFloat(pusherNum, F_ABSMAX1), pAbsMaxZ: f64 = <f64>edLoadFloat(pusherNum, F_ABSMAX2);
  const minsX: f64 = pAbsMinX + moveX, minsY: f64 = pAbsMinY + moveY, minsZ: f64 = pAbsMinZ + moveZ;
  const maxsX: f64 = pAbsMaxX + moveX, maxsY: f64 = pAbsMaxY + moveY, maxsZ: f64 = pAbsMaxZ + moveZ;

  const pushOrigX: f64 = <f64>edLoadFloat(pusherNum, F_ORIGIN), pushOrigY: f64 = <f64>edLoadFloat(pusherNum, F_ORIGIN1), pushOrigZ: f64 = <f64>edLoadFloat(pusherNum, F_ORIGIN2);
  edStoreFloat(pusherNum, F_ORIGIN, pushOrigX + moveX);
  edStoreFloat(pusherNum, F_ORIGIN1, pushOrigY + moveY);
  edStoreFloat(pusherNum, F_ORIGIN2, pushOrigZ + moveZ);
  edStoreFloat(pusherNum, F_LTIME, <f64>edLoadFloat(pusherNum, F_LTIME) + movetime);
  linkEdict(pusherNum);

  let numMoved: i32 = 0;
  const numEdicts: i32 = getNumEdicts();
  for (let check: i32 = 1; check < numEdicts; check++) {
    if (check == pusherNum || isEdictFree(check) != 0) continue;
    const movetype: i32 = <i32>edLoadFloat(check, F_MOVETYPE);
    if (movetype == MOVE_TYPE_PUSH || movetype == MOVE_TYPE_NONE || movetype == MOVE_TYPE_NOCLIP) continue;

    const flags0: i32 = <i32>edLoadFloat(check, F_FLAGS);
    const ground: i32 = edLoadInt(check, F_GROUNDENTITY);
    if ((flags0 & FL_ONGROUND) == 0 || ground != pusherNum) {
      const cAbsMinX: f64 = <f64>edLoadFloat(check, F_ABSMIN), cAbsMinY: f64 = <f64>edLoadFloat(check, F_ABSMIN1), cAbsMinZ: f64 = <f64>edLoadFloat(check, F_ABSMIN2);
      const cAbsMaxX: f64 = <f64>edLoadFloat(check, F_ABSMAX), cAbsMaxY: f64 = <f64>edLoadFloat(check, F_ABSMAX1), cAbsMaxZ: f64 = <f64>edLoadFloat(check, F_ABSMAX2);
      if (cAbsMinX >= maxsX || cAbsMinY >= maxsY || cAbsMinZ >= maxsZ ||
          cAbsMaxX <= minsX || cAbsMaxY <= minsY || cAbsMaxZ <= minsZ) continue;
      const pusherSkin: i32 = <i32>edLoadFloat(pusherNum, F_SKIN);
      if (pusherSkin < 0) {
        if (!pusherOverlaps(pusherNum, check)) continue;
      } else {
        if (!testEntityPosition(check)) continue;
      }
    }

    // QSS-M rider exemption — see pushMoveAngles above.
    if (movetype != MOVE_TYPE_WALK && edLoadInt(check, F_GROUNDENTITY) != pusherNum) {
      const cf: i32 = <i32>edLoadFloat(check, F_FLAGS);
      edStoreFloat(check, F_FLAGS, <f64>(cf & (~FL_ONGROUND)));
    }

    const entOrigX: f64 = <f64>edLoadFloat(check, F_ORIGIN), entOrigY: f64 = <f64>edLoadFloat(check, F_ORIGIN1), entOrigZ: f64 = <f64>edLoadFloat(check, F_ORIGIN2);
    setMoved(numMoved, check, entOrigX, entOrigY, entOrigZ, 0.0, 0.0, 0.0);
    numMoved++;

    // Re-captured per rider (sv.ts:1638-1641): pushEntity runs touch/impact QC that
    // can change pusher.solid, and the next rider must see that new value.
    const solidBackup: i32 = <i32>edLoadFloat(pusherNum, F_SOLID);
    edStoreFloat(pusherNum, F_SOLID, <f64>SOLID_NOT);
    pushEntity(check, moveX, moveY, moveZ);
    edStoreFloat(pusherNum, F_SOLID, <f64>solidBackup);

    if (testEntityPosition(check)) {
      const pusherSkin2: i32 = <i32>edLoadFloat(pusherNum, F_SKIN);
      if (pusherSkin2 < 0) continue;
      if (edLoadFloat(check, F_MINS) == edLoadFloat(check, F_MAXS)) continue;
      const checkSolid: i32 = <i32>edLoadFloat(check, F_SOLID);
      if (checkSolid == SOLID_NOT || checkSolid == SOLID_TRIGGER) {
        edStoreFloat(check, F_MINS, 0.0); edStoreFloat(check, F_MAXS, 0.0);
        edStoreFloat(check, F_MINS1, 0.0); edStoreFloat(check, F_MAXS1, 0.0);
        edStoreFloat(check, F_MAXS2, <f64>edLoadFloat(check, F_MINS2));
        continue;
      }

      edStoreFloat(check, F_ORIGIN, entOrigX);
      edStoreFloat(check, F_ORIGIN1, entOrigY);
      edStoreFloat(check, F_ORIGIN2, entOrigZ);
      // QSS-M SV_PushMove: SV_LinkEdict(check, true) — the blocked entity's revert
      // link FIRES TOUCH TRIGGERS.
      linkEdictTouch(check);

      edStoreFloat(pusherNum, F_ORIGIN, pushOrigX);
      edStoreFloat(pusherNum, F_ORIGIN1, pushOrigY);
      edStoreFloat(pusherNum, F_ORIGIN2, pushOrigZ);
      linkEdict(pusherNum);
      edStoreFloat(pusherNum, F_LTIME, <f64>edLoadFloat(pusherNum, F_LTIME) - movetime);

      // sv.ts pushMove: pusher's .blocked QC — see pushMoveAngles above.
    const blockedFn: i32 = edLoadInt(pusherNum, F_BLOCKED);
    if (blockedFn != 0) {
      writeGlobalInt(GLOBAL_SELF, pusherNum);
      writeGlobalInt(GLOBAL_OTHER, check);
      execute(blockedFn);
    }

      for (let i: i32 = 0; i < numMoved; i++) {
        const m: i32 = movedEnt(i);
        edStoreFloat(m, F_ORIGIN, movedOrigX(i));
        edStoreFloat(m, F_ORIGIN1, movedOrigY(i));
        edStoreFloat(m, F_ORIGIN2, movedOrigZ(i));
        linkEdict(m);
      }
      return;
    }
  }
}

// ================================================================================
// SV_PushMove dispatcher — avelocity!=0 -> angular, velocity==0 -> ltime-only,
// else linear.
// ================================================================================
export function pushMove(pusherNum: i32, movetime: f64): void {
  const avelX: f64 = <f64>edLoadFloat(pusherNum, F_AVELOCITY), avelY: f64 = <f64>edLoadFloat(pusherNum, F_AVELOCITY1), avelZ: f64 = <f64>edLoadFloat(pusherNum, F_AVELOCITY2);
  if (avelX != 0.0 || avelY != 0.0 || avelZ != 0.0) {
    // Mirrors sv.ts pushMove: rerelease progs break avelocity on MOVETYPE_PUSH, so
    // DP_SV_ROTATINGBMODEL is off for them and the linear path takes over. Its one-shot
    // warning stays JS-side, the sim having no console import.
    if (!isRerelease()) {
      if (pushMoveAngles(pusherNum, movetime)) {
        edStoreFloat(pusherNum, F_LTIME, <f64>edLoadFloat(pusherNum, F_LTIME) + movetime);
      }
      return;
    }
  }

  const velX: f64 = <f64>edLoadFloat(pusherNum, F_VELOCITY), velY: f64 = <f64>edLoadFloat(pusherNum, F_VELOCITY1), velZ: f64 = <f64>edLoadFloat(pusherNum, F_VELOCITY2);
  if (velX == 0.0 && velY == 0.0 && velZ == 0.0) {
    edStoreFloat(pusherNum, F_LTIME, <f64>edLoadFloat(pusherNum, F_LTIME) + movetime);
    return;
  }

  pushMoveLinear(pusherNum, movetime);
}

// ================================================================================
// SV_Physics_Pusher — sv.ts physics_Pusher. `serverTime` = state.server.time,
// caller-owned (no dependency on svframe's module-private svTime).
// ================================================================================
export function physicsPusher(entNum: i32, frametime: f64, serverTime: f64): void {
  const oldltime: f64 = <f64>edLoadFloat(entNum, F_LTIME);
  const thinktime: f64 = <f64>edLoadFloat(entNum, F_NEXTTHINK);
  let movetime: f64;
  if (thinktime < (oldltime + frametime)) {
    movetime = thinktime - oldltime;
    if (movetime < 0.0) movetime = 0.0;
  } else {
    movetime = frametime;
  }
  if (movetime != 0.0) pushMove(entNum, movetime);
  if (thinktime <= oldltime || thinktime > <f64>edLoadFloat(entNum, F_LTIME)) return;

  edStoreFloat(entNum, F_NEXTTHINK, 0.0);
  writeGlobalFloat(GLOBAL_TIME, <f32>serverTime);
  writeGlobalInt(GLOBAL_SELF, entNum);
  writeGlobalInt(GLOBAL_OTHER, 0);
  execute(edLoadInt(entNum, F_THINK));
}
