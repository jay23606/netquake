// Player (client) physics — port of sv.ts SV_Physics_Client + SV_ClientThink and
// the movement functions they call (userFriction/accelerate/airMove/waterMove/
// waterJump/walkMove/checkStuck/tryUnstick/wallFriction/checkWater/calcRoll/
// testEntityPosition), on svphysics.ts + svmove.ts.
//
// COMPOSITION: sv.ts runs clientThink (runClients phase) BEFORE physics_Client in
// the same frame with the same usercmd; physicsClient() composes them per entity
// in that order. Cross-client ordering between DIFFERENT clients is not modeled.
//
// USERCMD: the network parse (SV_ReadClientMove) is excluded; setUserCmd writes
// exactly the fields it would have produced. `impulse` is only written when
// nonzero (`if (i !== 0) ent.impulse = i`) — a zero-impulse call leaves a
// still-unconsumed prior impulse alone.
//
// checkLadder persists per-slot onladder in the ONLADDER table; clientThink's
// water-vs-air branch reads the PRIOR frame's value (same staleness as waterlevel).
//
// PARITY: f32 entity fields widened to f64 on read (edLoadFloat), computed in f64,
// rounded once on store (edStoreFloat).

import {
  execute, writeGlobalInt, writeGlobalFloat, readGlobalInt, readGlobalFloat, globalsPtr, wasTrapped,
  resetVm, installStatement, installFunction, setNumFunctions, setEdictSize,
} from "./vm";
import {
  edLoadFloat, edStoreFloat, edLoadInt, edStoreInt, clearEdict, initEdicts,
  edictsBase, getMaxEdicts, getEdictSizeWords, setThinkCapture,
  initAreaTree, linkEdict, linkEdictTouch, impact, unlinkEdict, setEdictFree, isEdictFree,
  setWorldHullRange, setPlane, setClipNode, setHullMeta,
  move, MOVE_NORMAL, MOVE_NOMONSTERS, MOVE_MISSILE,
  moveTraceFraction, moveTraceEndX, moveTraceEndY, moveTraceEndZ,
  moveTracePlaneNX, moveTracePlaneNY, moveTracePlaneNZ, moveTracePlaneDist,
  moveTraceAllSolid, moveTraceStartSolid, moveTraceInOpen, moveTraceInWater, moveTraceEnt,
  pointContents,
  skinContentsCount, skinContentsAt, pointContentsAllBsps,
  flyMove, pushEntity, physicsToss, checkVelocity, pushTracePlaneNZ, pushTraceEnt,
  clipVelocity, clipVelocityOutX, clipVelocityOutY, clipVelocityOutZ,
} from "./svphysics";
import { loadStringBlock, initStringTemp, scratchPtr, maxScratch } from "./strings";

// Host-bridged transcendentals: AssemblyScript's own Math.sin/cos/atan2 can differ from the
// JS engine's by 1 f64 ulp on rare inputs, which crosses f32 store boundaries and forks the
// sims. Import namespace = this file's name.
declare function host_sin(x: f64): f64;
declare function host_cos(x: f64): f64;

// Named passthrough, no blind export * (svphysics transitively re-exports
// svmove/world/ed; export * would collide with vm.ts's own names).
export {
  execute, writeGlobalInt, writeGlobalFloat, readGlobalInt, readGlobalFloat, globalsPtr, wasTrapped,
  resetVm, installStatement, installFunction, setNumFunctions, setEdictSize,
  edLoadFloat, edStoreFloat, edLoadInt, edStoreInt, clearEdict, initEdicts,
  edictsBase, getMaxEdicts, getEdictSizeWords,
  initAreaTree, linkEdict, linkEdictTouch, impact, unlinkEdict, setEdictFree, isEdictFree,
  setWorldHullRange, setPlane, setClipNode, setHullMeta,
  move, MOVE_NORMAL, MOVE_NOMONSTERS, MOVE_MISSILE,
  moveTraceFraction, moveTraceEndX, moveTraceEndY, moveTraceEndZ,
  moveTracePlaneNX, moveTracePlaneNY, moveTracePlaneNZ, moveTracePlaneDist,
  moveTraceAllSolid, moveTraceStartSolid, moveTraceInOpen, moveTraceInWater, moveTraceEnt,
  pointContents,
  flyMove, pushEntity, physicsToss, checkVelocity, pushTracePlaneNZ, pushTraceEnt,
  loadStringBlock, initStringTemp, scratchPtr, maxScratch,
};

// --- QC call-ABI / engine-reserved global indices (src/engine/pr.ts globalvars) -
const GLOBAL_SELF: i32 = 28;
const GLOBAL_OTHER: i32 = 29;
const GLOBAL_TIME: i32 = 31;
const GLOBAL_PLAYERPRETHINK: i32 = 84;
const GLOBAL_PLAYERPOSTTHINK: i32 = 85;

// --- entvars field indices (src/engine/pr.ts entvars, vanilla layout) ---------
const F_MOVETYPE: i32 = 8;
const F_SOLID: i32 = 9;
const F_ORIGIN: i32 = 10, F_ORIGIN1: i32 = 11, F_ORIGIN2: i32 = 12;
const F_OLDORIGIN: i32 = 13, F_OLDORIGIN1: i32 = 14, F_OLDORIGIN2: i32 = 15;
const F_VELOCITY: i32 = 16, F_VELOCITY1: i32 = 17, F_VELOCITY2: i32 = 18;
const F_ANGLES: i32 = 19, F_ANGLES1: i32 = 20, F_ANGLES2: i32 = 21;
const F_PUNCHANGLE: i32 = 25, F_PUNCHANGLE1: i32 = 26, F_PUNCHANGLE2: i32 = 27;
const F_FRAME: i32 = 30;
const F_MINS: i32 = 33, F_MINS1: i32 = 34, F_MINS2: i32 = 35;
const F_MAXS: i32 = 36, F_MAXS1: i32 = 37, F_MAXS2: i32 = 38;
const F_THINK: i32 = 44;
const F_NEXTTHINK: i32 = 46;
const F_GROUNDENTITY: i32 = 47;
const F_HEALTH: i32 = 48;
const F_VIEW_OFS: i32 = 62, F_VIEW_OFS1: i32 = 63, F_VIEW_OFS2: i32 = 64;
const F_BUTTON0: i32 = 65, F_BUTTON1: i32 = 66, F_BUTTON2: i32 = 67;
const F_IMPULSE: i32 = 68;
const F_FIXANGLE: i32 = 69;
const F_V_ANGLE: i32 = 70, F_V_ANGLE1: i32 = 71, F_V_ANGLE2: i32 = 72;
const F_FLAGS: i32 = 76;
const F_TELEPORT_TIME: i32 = 80;
const F_WATERLEVEL: i32 = 83;
const F_WATERTYPE: i32 = 84;
const F_MOVEDIR: i32 = 96, F_MOVEDIR1: i32 = 97;

// --- sv.ts MOVE_TYPE / FL / SOLID / CONTENTS enums (the slice this module touches) -
const MOVE_TYPE_NONE: i32 = 0;
const MOVE_TYPE_WALK: i32 = 3;
const MOVE_TYPE_FLY: i32 = 5;
const MOVE_TYPE_TOSS: i32 = 6;
const MOVE_TYPE_NOCLIP: i32 = 8;
const MOVE_TYPE_BOUNCE: i32 = 10;
// MOVETYPE_EXT_BOUNCEMISSILE — SV_Physics_Client tosses it too (QSS-M sv_phys.c:1308).
const MOVE_TYPE_BOUNCEMISSILE: i32 = 11;
const SOLID_BSP: i32 = 4;
const FL_ONGROUND: i32 = 512;
const FL_WATERJUMP: i32 = 2048;
const CONTENTS_WATER: i32 = -3;
const CONTENTS_EMPTY: i32 = -1;
const CONTENTS_LADDER: i32 = -16; // FTE_ENT_SKIN_CONTENTS (mod.CONTENTS.ladder)

const PI: f64 = Math.PI;

// ================================================================================
// Module-private ambient state — cvar setters + the current usercmd.
// ================================================================================
let maxVelocityG: f64 = 2000.0;   // sv_maxvelocity
let gravityCvarG: f64 = 800.0;    // sv_gravity
let gravityFieldIdxG: i32 = -1;   // -1 == progs.dat has no per-entity "gravity" field
let maxSpeedG: f64 = 320.0;       // sv_maxspeed
let accelerateG: f64 = 10.0;      // sv_accelerate
let frictionG: f64 = 4.0;         // sv_friction
let edgeFrictionG: f64 = 2.0;     // edgefriction
let stopSpeedG: f64 = 100.0;      // sv_stopspeed
let noStepG: f64 = 0.0;           // sv_nostep
let rollAngleG: f64 = 2.0;        // cl_rollangle
let rollSpeedG: f64 = 200.0;      // cl_rollspeed

// Working registers = the CURRENT client's usercmd (loaded per-client at
// physicsClient's entry from the table below). airMove/waterMove read these.
let cmdForwardG: f64 = 0.0, cmdSideG: f64 = 0.0, cmdUpG: f64 = 0.0;

// Per-client usercmd table, indexed by entnum. The embedder calls setUserCmd for
// EVERY active client before the single serverFrame() dispatch — a lone scalar
// would leave every client moving on the LAST client's cmd (a multiplayer bug).
const MAX_CMD_CLIENTS: i32 = 256; // NQ maxclients is a protocol byte (<=255) + headroom
const CMD_FWD: usize = memory.data(MAX_CMD_CLIENTS * 8);
const CMD_SIDE: usize = memory.data(MAX_CMD_CLIENTS * 8);
const CMD_UP: usize = memory.data(MAX_CMD_CLIENTS * 8);
// svs.clients[n-1].active per slot, stored INVERTED (1 = INACTIVE) so zero-init
// means "active" — harness fixtures need no setup call; the live embedder
// marshals real flags every frame.
const CLIENT_INACTIVE: usize = memory.data(MAX_CMD_CLIENTS);
// sv.ts Edict.onladder (FTE_ENT_SKIN_CONTENTS), client slots only. Zero-init = false.
const ONLADDER: usize = memory.data(MAX_CMD_CLIENTS);
@inline function onladder(entNum: i32): bool {
  return entNum >= 0 && entNum < MAX_CMD_CLIENTS && load<u8>(ONLADDER + <usize>entNum) != 0;
}

export function setClientActive(entNum: i32, active: i32): void {
  if (entNum >= 0 && entNum < MAX_CMD_CLIENTS)
    store<u8>(CLIENT_INACTIVE + <usize>entNum, <u8>(active != 0 ? 0 : 1));
}

export function setMaxVelocity(v: f64): void { maxVelocityG = v; }
export function setGravityCvar(v: f64): void { gravityCvarG = v; }
export function setGravityFieldIdx(idx: i32): void { gravityFieldIdxG = idx; }
export function setMaxSpeed(v: f64): void { maxSpeedG = v; }
export function setAccelerateCvar(v: f64): void { accelerateG = v; }
export function setFrictionCvar(v: f64): void { frictionG = v; }
export function setEdgeFrictionCvar(v: f64): void { edgeFrictionG = v; }
export function setStopSpeedCvar(v: f64): void { stopSpeedG = v; }
export function setNoStep(v: f64): void { noStepG = v; }
export function setRollAngle(v: f64): void { rollAngleG = v; }
export function setRollSpeed(v: f64): void { rollSpeedG = v; }

// sv.ts readClientMove's field-writing half (see header USERCMD note).
export function setUserCmd(
  entNum: i32, forwardmove: f64, sidemove: f64, upmove: f64,
  vAngleX: f64, vAngleY: f64, vAngleZ: f64,
  button0: f64, button2: f64, impulse: f64,
): void {
  if (entNum >= 0 && entNum < MAX_CMD_CLIENTS) {
    const o: usize = <usize>entNum << 3;
    store<f64>(CMD_FWD + o, forwardmove);
    store<f64>(CMD_SIDE + o, sidemove);
    store<f64>(CMD_UP + o, upmove);
  }
  edStoreFloat(entNum, F_V_ANGLE, vAngleX);
  edStoreFloat(entNum, F_V_ANGLE1, vAngleY);
  edStoreFloat(entNum, F_V_ANGLE2, vAngleZ);
  edStoreFloat(entNum, F_BUTTON0, button0);
  edStoreFloat(entNum, F_BUTTON2, button2);
  if (impulse != 0.0) edStoreFloat(entNum, F_IMPULSE, impulse);
}

// sv.ts addGravity, duplicated (svphysics's copy is private and cvar-parameterized).
function addGravity(entNum: i32, frametime: f64): void {
  let entGravity: f64 = 1.0;
  if (gravityFieldIdxG >= 0) {
    const g: f64 = <f64>edLoadFloat(entNum, gravityFieldIdxG);
    entGravity = (g != 0.0) ? g : 1.0;
  }
  const v2: f64 = <f64>edLoadFloat(entNum, F_VELOCITY2);
  edStoreFloat(entNum, F_VELOCITY2, v2 - entGravity * gravityCvarG * frametime);
}

// sv.ts runThink (SV_RunThink), duplicated with an explicit svTime parameter
// (this module is driven per-entity; svframe owns the module-private mirror).
function runThinkClient(entNum: i32, svTime: f64, frametime: f64): bool {
  let thinktime: f64 = <f64>edLoadFloat(entNum, F_NEXTTHINK);
  if (thinktime <= 0.0 || thinktime > (svTime + frametime)) return true;
  if (thinktime < svTime) thinktime = svTime;
  // QSS-M oldthinktime/oldframe capture — read by svframe's sendinterval tail.
  setThinkCapture(entNum, thinktime, <f64>edLoadFloat(entNum, F_FRAME));
  edStoreFloat(entNum, F_NEXTTHINK, 0.0);
  writeGlobalFloat(GLOBAL_TIME, <f32>thinktime);
  writeGlobalInt(GLOBAL_SELF, entNum);
  writeGlobalInt(GLOBAL_OTHER, 0);
  execute(edLoadInt(entNum, F_THINK));
  return isEdictFree(entNum) == 0;
}

// src/engine/sv.ts `testEntityPosition` (SV_TestEntityPosition).
function testEntityPosition(entNum: i32): bool {
  const ox: f64 = <f64>edLoadFloat(entNum, F_ORIGIN);
  const oy: f64 = <f64>edLoadFloat(entNum, F_ORIGIN1);
  const oz: f64 = <f64>edLoadFloat(entNum, F_ORIGIN2);
  const minsX: f64 = <f64>edLoadFloat(entNum, F_MINS), minsY: f64 = <f64>edLoadFloat(entNum, F_MINS1), minsZ: f64 = <f64>edLoadFloat(entNum, F_MINS2);
  const maxsX: f64 = <f64>edLoadFloat(entNum, F_MAXS), maxsY: f64 = <f64>edLoadFloat(entNum, F_MAXS1), maxsZ: f64 = <f64>edLoadFloat(entNum, F_MAXS2);
  move(ox, oy, oz, minsX, minsY, minsZ, maxsX, maxsY, maxsZ, ox, oy, oz, MOVE_NORMAL, entNum);
  return moveTraceStartSolid() != 0;
}

// sv.ts checkStuck. con.dPrint diagnostics excluded.
function checkStuck(entNum: i32): void {
  if (!testEntityPosition(entNum)) {
    edStoreFloat(entNum, F_OLDORIGIN, <f64>edLoadFloat(entNum, F_ORIGIN));
    edStoreFloat(entNum, F_OLDORIGIN1, <f64>edLoadFloat(entNum, F_ORIGIN1));
    edStoreFloat(entNum, F_OLDORIGIN2, <f64>edLoadFloat(entNum, F_ORIGIN2));
    return;
  }
  const orgX: f64 = <f64>edLoadFloat(entNum, F_ORIGIN);
  const orgY: f64 = <f64>edLoadFloat(entNum, F_ORIGIN1);
  const orgZ: f64 = <f64>edLoadFloat(entNum, F_ORIGIN2);
  edStoreFloat(entNum, F_ORIGIN, <f64>edLoadFloat(entNum, F_OLDORIGIN));
  edStoreFloat(entNum, F_ORIGIN1, <f64>edLoadFloat(entNum, F_OLDORIGIN1));
  edStoreFloat(entNum, F_ORIGIN2, <f64>edLoadFloat(entNum, F_OLDORIGIN2));
  if (!testEntityPosition(entNum)) {
    linkEdict(entNum);
    return;
  }
  for (let z: f64 = 0.0; z <= 17.0; z += 1.0) {
    for (let i: f64 = -1.0; i <= 1.0; i += 1.0) {
      for (let j: f64 = -1.0; j <= 1.0; j += 1.0) {
        edStoreFloat(entNum, F_ORIGIN, orgX + i);
        edStoreFloat(entNum, F_ORIGIN1, orgY + j);
        edStoreFloat(entNum, F_ORIGIN2, orgZ + z);
        if (!testEntityPosition(entNum)) {
          linkEdict(entNum);
          return;
        }
      }
    }
  }
  edStoreFloat(entNum, F_ORIGIN, orgX);
  edStoreFloat(entNum, F_ORIGIN1, orgY);
  edStoreFloat(entNum, F_ORIGIN2, orgZ);
}

// sv.ts checkLadder (FTE_ENT_SKIN_CONTENTS): overlapping a CONTENTS_LADDER skin
// volume AND a real wall within 24 units in front (the forward trace).
function checkLadder(entNum: i32): void {
  const ox: f64 = <f64>edLoadFloat(entNum, F_ORIGIN);
  const oy: f64 = <f64>edLoadFloat(entNum, F_ORIGIN1);
  const oz: f64 = <f64>edLoadFloat(entNum, F_ORIGIN2);
  const minsX: f64 = <f64>edLoadFloat(entNum, F_MINS), minsY: f64 = <f64>edLoadFloat(entNum, F_MINS1), minsZ: f64 = <f64>edLoadFloat(entNum, F_MINS2);
  const maxsX: f64 = <f64>edLoadFloat(entNum, F_MAXS), maxsY: f64 = <f64>edLoadFloat(entNum, F_MAXS1), maxsZ: f64 = <f64>edLoadFloat(entNum, F_MAXS2);
  if (skinContentsCount() == 0 ||
      skinContentsAt(ox, oy, oz, minsX, minsY, minsZ, maxsX, maxsY, maxsZ, entNum, CONTENTS_EMPTY) != CONTENTS_LADDER) {
    if (entNum >= 0 && entNum < MAX_CMD_CLIENTS) store<u8>(ONLADDER + <usize>entNum, 0);
    return;
  }
  const yaw: f64 = (<f64>edLoadFloat(entNum, F_ANGLES1)) * PI / 180.0;
  const px: f64 = ox + host_cos(yaw) * 24.0;
  const py: f64 = oy + host_sin(yaw) * 24.0;
  move(ox, oy, oz, minsX, minsY, minsZ, maxsX, maxsY, maxsZ, px, py, oz, MOVE_NORMAL, entNum);
  if (entNum >= 0 && entNum < MAX_CMD_CLIENTS)
    store<u8>(ONLADDER + <usize>entNum, moveTraceFraction() < 1.0 ? 1 : 0);
}

// sv.ts checkWater (SV_CheckWater), incl. checkLadder + the skin-contents override.
function checkWater(entNum: i32): bool {
  checkLadder(entNum);
  const ox: f64 = <f64>edLoadFloat(entNum, F_ORIGIN);
  const oy: f64 = <f64>edLoadFloat(entNum, F_ORIGIN1);
  const oz: f64 = <f64>edLoadFloat(entNum, F_ORIGIN2);
  const mins2: f64 = <f64>edLoadFloat(entNum, F_MINS2);
  const maxs2: f64 = <f64>edLoadFloat(entNum, F_MAXS2);
  const viewOfs2: f64 = <f64>edLoadFloat(entNum, F_VIEW_OFS2);

  edStoreFloat(entNum, F_WATERLEVEL, 0.0);
  edStoreFloat(entNum, F_WATERTYPE, -1.0); // mod.CONTENTS.empty

  let pz: f64 = oz + mins2 + 1.0;
  let cont: i32 = pointContentsAllBsps(ox, oy, pz, entNum);
  if (cont > CONTENTS_WATER) return false;

  edStoreFloat(entNum, F_WATERTYPE, <f64>cont);
  edStoreFloat(entNum, F_WATERLEVEL, 1.0);
  pz = oz + (mins2 + maxs2) * 0.5;
  cont = pointContentsAllBsps(ox, oy, pz, entNum);
  if (cont <= CONTENTS_WATER) {
    edStoreFloat(entNum, F_WATERLEVEL, 2.0);
    pz = oz + viewOfs2;
    cont = pointContentsAllBsps(ox, oy, pz, entNum);
    if (cont <= CONTENTS_WATER) edStoreFloat(entNum, F_WATERLEVEL, 3.0);
  }
  return <f64>edLoadFloat(entNum, F_WATERLEVEL) > 1.0;
}

// ================================================================================
// SV_FlyMove, duplicated from svphysics.flyMove with ONE addition: captures the
// last blocked&2 (vertical wall) plane normal into stepTrace* (sv.ts's shared
// state.steptrace), consumed only by walkMove's wallFriction / tryUnstick.
// Non-walk paths still use svphysics's plain flyMove.
// ================================================================================
const CLIENT_MAX_CLIP_PLANES: i32 = 5;
const CLIENT_PLANE_BUF: usize = memory.data(CLIENT_MAX_CLIP_PLANES * 3 * 8);
@inline function cPlaneSet(i: i32, x: f64, y: f64, z: f64): void {
  const p = CLIENT_PLANE_BUF + (<usize>i * 3) * 8;
  store<f64>(p, x); store<f64>(p + 8, y); store<f64>(p + 16, z);
}
@inline function cPlaneX(i: i32): f64 { return load<f64>(CLIENT_PLANE_BUF + (<usize>i * 3) * 8); }
@inline function cPlaneY(i: i32): f64 { return load<f64>(CLIENT_PLANE_BUF + (<usize>i * 3) * 8 + 8); }
@inline function cPlaneZ(i: i32): f64 { return load<f64>(CLIENT_PLANE_BUF + (<usize>i * 3) * 8 + 16); }

let stepTraceNX: f64 = 0.0, stepTraceNY: f64 = 0.0, stepTraceNZ: f64 = 0.0;

function flyMoveTracked(entNum: i32, time: f64): i32 {
  const minsX: f64 = <f64>edLoadFloat(entNum, F_MINS), minsY: f64 = <f64>edLoadFloat(entNum, F_MINS1), minsZ: f64 = <f64>edLoadFloat(entNum, F_MINS2);
  const maxsX: f64 = <f64>edLoadFloat(entNum, F_MAXS), maxsY: f64 = <f64>edLoadFloat(entNum, F_MAXS1), maxsZ: f64 = <f64>edLoadFloat(entNum, F_MAXS2);

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
      origVelX = <f64>edLoadFloat(entNum, F_VELOCITY);
      origVelY = <f64>edLoadFloat(entNum, F_VELOCITY1);
      origVelZ = <f64>edLoadFloat(entNum, F_VELOCITY2);
      numplanes = 0;
      if (fraction == 1.0) break;
    }

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
      // sv.ts: copyTrace(trace, state.steptrace).
      stepTraceNX = planeNX; stepTraceNY = planeNY; stepTraceNZ = planeNZ;
    }

    impact(entNum, traceEnt);                 // sv.ts SV_FlyMove: SV_Impact(ent, trace.ent)
    if (isEdictFree(entNum) != 0) break;

    timeLeft -= timeLeft * fraction;

    if (numplanes >= CLIENT_MAX_CLIP_PLANES) {
      edStoreFloat(entNum, F_VELOCITY, 0.0);
      edStoreFloat(entNum, F_VELOCITY1, 0.0);
      edStoreFloat(entNum, F_VELOCITY2, 0.0);
      return 3;
    }
    cPlaneSet(numplanes, planeNX, planeNY, planeNZ);
    numplanes++;

    let i: i32 = 0, j: i32 = 0;
    for (i = 0; i < numplanes; i++) {
      clipVelocity(origVelX, origVelY, origVelZ, cPlaneX(i), cPlaneY(i), cPlaneZ(i), 1.0);
      const nvX: f64 = clipVelocityOutX(), nvY: f64 = clipVelocityOutY(), nvZ: f64 = clipVelocityOutZ();
      for (j = 0; j < numplanes; j++) {
        if (j != i) {
          if ((nvX * cPlaneX(j) + nvY * cPlaneY(j) + nvZ * cPlaneZ(j)) < 0.0) break;
        }
      }
      if (j == numplanes) break;
    }

    if (i != numplanes) {
      edStoreFloat(entNum, F_VELOCITY, clipVelocityOutX());
      edStoreFloat(entNum, F_VELOCITY1, clipVelocityOutY());
      edStoreFloat(entNum, F_VELOCITY2, clipVelocityOutZ());
    } else {
      if (numplanes != 2) {
        edStoreFloat(entNum, F_VELOCITY, 0.0);
        edStoreFloat(entNum, F_VELOCITY1, 0.0);
        edStoreFloat(entNum, F_VELOCITY2, 0.0);
        return 7;
      }
      const dirX: f64 = cPlaneY(0) * cPlaneZ(1) - cPlaneZ(0) * cPlaneY(1);
      const dirY: f64 = cPlaneZ(0) * cPlaneX(1) - cPlaneX(0) * cPlaneZ(1);
      const dirZ: f64 = cPlaneX(0) * cPlaneY(1) - cPlaneY(0) * cPlaneX(1);
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

// sv.ts wallFriction. Only `forward` is needed — right/up are unused by the real
// function too, so roll (v_angle2) is never read.
function wallFriction(entNum: i32): void {
  const vaX: f64 = <f64>edLoadFloat(entNum, F_V_ANGLE);
  const vaY: f64 = <f64>edLoadFloat(entNum, F_V_ANGLE1);
  const pitchRad: f64 = vaX * PI / 180.0, sp: f64 = host_sin(pitchRad), cp: f64 = host_cos(pitchRad);
  const yawRad: f64 = vaY * PI / 180.0, sy: f64 = host_sin(yawRad), cy: f64 = host_cos(yawRad);
  const fwX: f64 = cp * cy, fwY: f64 = cp * sy, fwZ: f64 = -sp;

  const nX: f64 = stepTraceNX, nY: f64 = stepTraceNY, nZ: f64 = stepTraceNZ;
  let d: f64 = nX * fwX + nY * fwY + nZ * fwZ + 0.5;
  if (d >= 0.0) return;
  d += 1.0;
  const velX: f64 = <f64>edLoadFloat(entNum, F_VELOCITY);
  const velY: f64 = <f64>edLoadFloat(entNum, F_VELOCITY1);
  const velZ: f64 = <f64>edLoadFloat(entNum, F_VELOCITY2);
  const i: f64 = nX * velX + nY * velY + nZ * velZ;
  edStoreFloat(entNum, F_VELOCITY, (velX - nX * i) * d);
  edStoreFloat(entNum, F_VELOCITY1, (velY - nY * i) * d);
  // velocity2 (z) is NOT touched — matches sv.ts.
}

// sv.ts tryUnstick. Uses flyMoveTracked: steptrace is shared mutable state — a
// call made here can be the one wallFriction reads back in walkMove.
function tryUnstick(entNum: i32, oldvelX: f64, oldvelY: f64, oldvelZ: f64): i32 {
  const oldorgX: f64 = <f64>edLoadFloat(entNum, F_ORIGIN);
  const oldorgY: f64 = <f64>edLoadFloat(entNum, F_ORIGIN1);
  const oldorgZ: f64 = <f64>edLoadFloat(entNum, F_ORIGIN2);
  let dirX: f64 = 2.0, dirY: f64 = 0.0, dirZ: f64 = 0.0;
  let clip: i32 = 0;
  for (let i: i32 = 0; i <= 7; i++) {
    switch (i) {
      case 1: dirX = 0.0; dirY = 2.0; break;
      case 2: dirX = -2.0; dirY = 0.0; break;
      case 3: dirX = 0.0; dirY = -2.0; break;
      case 4: dirX = 2.0; dirY = 2.0; break;
      case 5: dirX = -2.0; dirY = 2.0; break;
      case 6: dirX = 2.0; dirY = -2.0; break;
      case 7: dirX = -2.0; dirY = -2.0; break;
      default: break; // i===0: keep the pre-loop (2,0,0) init, matches sv.ts's switch (no case 0)
    }
    pushEntity(entNum, dirX, dirY, dirZ);
    edStoreFloat(entNum, F_VELOCITY, oldvelX);
    edStoreFloat(entNum, F_VELOCITY1, oldvelY);
    edStoreFloat(entNum, F_VELOCITY2, 0.0);
    clip = flyMoveTracked(entNum, 0.1);
    if (Math.abs(oldorgY - <f64>edLoadFloat(entNum, F_ORIGIN1)) > 4.0
      || Math.abs(oldorgX - <f64>edLoadFloat(entNum, F_ORIGIN)) > 4.0) {
      return clip;
    }
    edStoreFloat(entNum, F_ORIGIN, oldorgX);
    edStoreFloat(entNum, F_ORIGIN1, oldorgY);
    edStoreFloat(entNum, F_ORIGIN2, oldorgZ);
  }
  edStoreFloat(entNum, F_VELOCITY, 0.0);
  edStoreFloat(entNum, F_VELOCITY1, 0.0);
  edStoreFloat(entNum, F_VELOCITY2, 0.0);
  return 7;
}

// sv.ts walkMove (SV_WalkMove).
function walkMove(entNum: i32, frametime: f64): void {
  const flags0: i32 = <i32>edLoadFloat(entNum, F_FLAGS);
  const oldonground: i32 = flags0 & FL_ONGROUND;
  edStoreFloat(entNum, F_FLAGS, <f64>(flags0 ^ oldonground));

  const oldorgX: f64 = <f64>edLoadFloat(entNum, F_ORIGIN);
  const oldorgY: f64 = <f64>edLoadFloat(entNum, F_ORIGIN1);
  const oldorgZ: f64 = <f64>edLoadFloat(entNum, F_ORIGIN2);
  const oldvelX: f64 = <f64>edLoadFloat(entNum, F_VELOCITY);
  const oldvelY: f64 = <f64>edLoadFloat(entNum, F_VELOCITY1);
  const oldvelZ: f64 = <f64>edLoadFloat(entNum, F_VELOCITY2);

  let clip: i32 = flyMove(entNum, frametime); // svphysics.ts's plain export -- no steptrace consumer for this first call
  if ((clip & 2) == 0) return;
  if (oldonground == 0 && <f64>edLoadFloat(entNum, F_WATERLEVEL) == 0.0) return;
  if ((<i32>edLoadFloat(entNum, F_MOVETYPE)) != MOVE_TYPE_WALK) return;
  if (noStepG != 0.0) return;
  if (((<i32>edLoadFloat(entNum, F_FLAGS)) & FL_WATERJUMP) != 0) return;

  const nosteporgX: f64 = <f64>edLoadFloat(entNum, F_ORIGIN);
  const nosteporgY: f64 = <f64>edLoadFloat(entNum, F_ORIGIN1);
  const nosteporgZ: f64 = <f64>edLoadFloat(entNum, F_ORIGIN2);
  const nostepvelX: f64 = <f64>edLoadFloat(entNum, F_VELOCITY);
  const nostepvelY: f64 = <f64>edLoadFloat(entNum, F_VELOCITY1);
  const nostepvelZ: f64 = <f64>edLoadFloat(entNum, F_VELOCITY2);

  edStoreFloat(entNum, F_ORIGIN, oldorgX);
  edStoreFloat(entNum, F_ORIGIN1, oldorgY);
  edStoreFloat(entNum, F_ORIGIN2, oldorgZ);

  pushEntity(entNum, 0.0, 0.0, 18.0);
  edStoreFloat(entNum, F_VELOCITY, oldvelX);
  edStoreFloat(entNum, F_VELOCITY1, oldvelY);
  edStoreFloat(entNum, F_VELOCITY2, 0.0);
  clip = flyMoveTracked(entNum, frametime);
  if (clip != 0) {
    if (Math.abs(oldorgY - <f64>edLoadFloat(entNum, F_ORIGIN1)) < 0.03125
      && Math.abs(oldorgX - <f64>edLoadFloat(entNum, F_ORIGIN)) < 0.03125) {
      clip = tryUnstick(entNum, oldvelX, oldvelY, oldvelZ);
    }
    if ((clip & 2) != 0) wallFriction(entNum);
  }

  const stepDownZ: f64 = oldvelZ * frametime - 18.0;
  pushEntity(entNum, 0.0, 0.0, stepDownZ);
  // pushTrace* snapshot, NOT moveTrace*(): pushEntity's linkEdictTouch can clobber
  // the shared moveTrace* globals via a touch-QC traceline (see svphysics peFrac).
  if (pushTracePlaneNZ() > 0.7) {
    if ((<i32>edLoadFloat(entNum, F_SOLID)) == SOLID_BSP) {
      const f: i32 = <i32>edLoadFloat(entNum, F_FLAGS);
      edStoreFloat(entNum, F_FLAGS, <f64>(f | FL_ONGROUND));
      edStoreInt(entNum, F_GROUNDENTITY, pushTraceEnt());
    }
    return;
  }

  edStoreFloat(entNum, F_ORIGIN, nosteporgX);
  edStoreFloat(entNum, F_ORIGIN1, nosteporgY);
  edStoreFloat(entNum, F_ORIGIN2, nosteporgZ);
  edStoreFloat(entNum, F_VELOCITY, nostepvelX);
  edStoreFloat(entNum, F_VELOCITY1, nostepvelY);
  edStoreFloat(entNum, F_VELOCITY2, nostepvelZ);
}

// ================================================================================
// User movement: SV_UserFriction / SV_Accelerate / SV_WaterMove / SV_WaterJump /
// SV_AirMove / CalcRoll — entNum replaces sv.ts's state.player.
// ================================================================================

// sv.ts userFriction (SV_UserFriction).
function userFriction(entNum: i32, frametime: f64): void {
  const vel0: f64 = <f64>edLoadFloat(entNum, F_VELOCITY);
  const vel1: f64 = <f64>edLoadFloat(entNum, F_VELOCITY1);
  const speed: f64 = Math.sqrt(vel0 * vel0 + vel1 * vel1);
  if (speed == 0.0) return;

  const ox: f64 = <f64>edLoadFloat(entNum, F_ORIGIN);
  const oy: f64 = <f64>edLoadFloat(entNum, F_ORIGIN1);
  const oz: f64 = <f64>edLoadFloat(entNum, F_ORIGIN2);
  const mins2: f64 = <f64>edLoadFloat(entNum, F_MINS2);
  const startX: f64 = ox + vel0 / speed * 16.0;
  const startY: f64 = oy + vel1 / speed * 16.0;
  const startZ: f64 = oz + mins2;

  let friction: f64 = frictionG;
  move(startX, startY, startZ, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, startX, startY, startZ - 34.0, MOVE_NOMONSTERS, entNum);
  if (moveTraceFraction() == 1.0) friction *= edgeFrictionG;

  let newspeed: f64 = speed - frametime * ((speed < stopSpeedG) ? stopSpeedG : speed) * friction;
  if (newspeed < 0.0) newspeed = 0.0;
  newspeed /= speed;

  const vel2: f64 = <f64>edLoadFloat(entNum, F_VELOCITY2);
  edStoreFloat(entNum, F_VELOCITY, vel0 * newspeed);
  edStoreFloat(entNum, F_VELOCITY1, vel1 * newspeed);
  edStoreFloat(entNum, F_VELOCITY2, vel2 * newspeed);
}

// sv.ts accelerate (SV_Accelerate / SV_AirAccelerate combined; `air` selects the
// branch). In the air branch wishvel is normalized IN PLACE (vec.ts's mutating
// normalize) and that unit vector is what accelspeed scales at the end.
function accelerateFn(
  entNum: i32,
  wvX: f64, wvY: f64, wvZ: f64,
  air: bool,
  wdX: f64, wdY: f64, wdZ: f64,
  wishspeed: f64, frametime: f64,
): void {
  const velX: f64 = <f64>edLoadFloat(entNum, F_VELOCITY);
  const velY: f64 = <f64>edLoadFloat(entNum, F_VELOCITY1);
  const velZ: f64 = <f64>edLoadFloat(entNum, F_VELOCITY2);
  let addspeed: f64;
  let mulX: f64, mulY: f64, mulZ: f64;

  if (air) {
    const len: f64 = Math.sqrt(wvX * wvX + wvY * wvY + wvZ * wvZ);
    let nwvX: f64 = 0.0, nwvY: f64 = 0.0, nwvZ: f64 = 0.0;
    if (len != 0.0) { nwvX = wvX / len; nwvY = wvY / len; nwvZ = wvZ / len; }
    let wishAir: f64 = len;
    if (wishAir > 30.0) wishAir = 30.0;
    addspeed = wishAir - (velX * nwvX + velY * nwvY + velZ * nwvZ);
    mulX = nwvX; mulY = nwvY; mulZ = nwvZ;
  } else {
    addspeed = wishspeed - (velX * wdX + velY * wdY + velZ * wdZ);
    mulX = wdX; mulY = wdY; mulZ = wdZ;
  }
  if (addspeed <= 0.0) return;

  let accelspeed: f64 = accelerateG * frametime * wishspeed;
  if (accelspeed > addspeed) accelspeed = addspeed;

  edStoreFloat(entNum, F_VELOCITY, velX + accelspeed * mulX);
  edStoreFloat(entNum, F_VELOCITY1, velY + accelspeed * mulY);
  edStoreFloat(entNum, F_VELOCITY2, velZ + accelspeed * mulZ);
}

// sv.ts waterMove (SV_WaterMove), including the onladder branches.
function waterMove(entNum: i32, frametime: f64): void {
  const vaX: f64 = <f64>edLoadFloat(entNum, F_V_ANGLE);
  const vaY: f64 = <f64>edLoadFloat(entNum, F_V_ANGLE1);
  const vaZ: f64 = <f64>edLoadFloat(entNum, F_V_ANGLE2);
  const pitchRad: f64 = vaX * PI / 180.0, sp: f64 = host_sin(pitchRad), cp: f64 = host_cos(pitchRad);
  const yawRad: f64 = vaY * PI / 180.0, sy: f64 = host_sin(yawRad), cy: f64 = host_cos(yawRad);
  const rollRad: f64 = vaZ * PI / 180.0, sr: f64 = host_sin(rollRad), cr: f64 = host_cos(rollRad);
  const fwX: f64 = cp * cy, fwY: f64 = cp * sy, fwZ: f64 = -sp;
  const rX: f64 = cr * sy - sr * sp * cy, rY: f64 = -sr * sp * sy - cr * cy, rZ: f64 = -sr * cp;

  const fm: f64 = cmdForwardG, sm: f64 = cmdSideG, um: f64 = cmdUpG;
  let wishX: f64 = fwX * fm + rX * sm;
  let wishY: f64 = fwY * fm + rY * sm;
  let wishZ: f64 = fwZ * fm + rZ * sm;
  if (onladder(entNum)) {
    wishZ *= 1.0 + Math.abs(wishZ / 200.0) * 9.0; // exaggerate vertical movement
    if ((<f64>edLoadFloat(entNum, F_BUTTON2)) != 0.0)
      wishZ += 400.0; // jump climbs off the ladder
  }
  if (fm == 0.0 && sm == 0.0 && um == 0.0 && !onladder(entNum)) wishZ -= 60.0;
  else wishZ += um;

  let wishspeed: f64 = Math.sqrt(wishX * wishX + wishY * wishY + wishZ * wishZ);
  if (wishspeed > maxSpeedG) {
    const scale: f64 = maxSpeedG / wishspeed;
    wishX *= scale; wishY *= scale; wishZ *= scale;
    wishspeed = maxSpeedG;
  }
  wishspeed *= 0.7;

  const velX: f64 = <f64>edLoadFloat(entNum, F_VELOCITY);
  const velY: f64 = <f64>edLoadFloat(entNum, F_VELOCITY1);
  const velZ: f64 = <f64>edLoadFloat(entNum, F_VELOCITY2);
  const speed: f64 = Math.sqrt(velX * velX + velY * velY + velZ * velZ);
  let newspeed: f64;
  if (speed != 0.0) {
    newspeed = speed - frametime * speed * frictionG;
    if (newspeed < 0.0) newspeed = 0.0;
    const scale: f64 = newspeed / speed;
    edStoreFloat(entNum, F_VELOCITY, velX * scale);
    edStoreFloat(entNum, F_VELOCITY1, velY * scale);
    edStoreFloat(entNum, F_VELOCITY2, velZ * scale);
  } else {
    newspeed = 0.0;
  }
  if (wishspeed == 0.0) return;
  const addspeed: f64 = wishspeed - newspeed;
  if (addspeed <= 0.0) return;
  let accelspeed: f64 = accelerateG * wishspeed * frametime;
  if (accelspeed > addspeed) accelspeed = addspeed;

  edStoreFloat(entNum, F_VELOCITY, <f64>edLoadFloat(entNum, F_VELOCITY) + accelspeed * (wishX / wishspeed));
  edStoreFloat(entNum, F_VELOCITY1, <f64>edLoadFloat(entNum, F_VELOCITY1) + accelspeed * (wishY / wishspeed));
  edStoreFloat(entNum, F_VELOCITY2, <f64>edLoadFloat(entNum, F_VELOCITY2) + accelspeed * (wishZ / wishspeed));
}

// sv.ts waterJump (SV_WaterJump). svTime = state.server.time.
function waterJump(entNum: i32, svTime: f64): void {
  if (svTime > (<f64>edLoadFloat(entNum, F_TELEPORT_TIME)) || (<f64>edLoadFloat(entNum, F_WATERLEVEL)) == 0.0) {
    const f: i32 = <i32>edLoadFloat(entNum, F_FLAGS);
    edStoreFloat(entNum, F_FLAGS, <f64>(f & ~FL_WATERJUMP));
    edStoreFloat(entNum, F_TELEPORT_TIME, 0.0);
  }
  edStoreFloat(entNum, F_VELOCITY, <f64>edLoadFloat(entNum, F_MOVEDIR));
  edStoreFloat(entNum, F_VELOCITY1, <f64>edLoadFloat(entNum, F_MOVEDIR1));
}

// sv.ts airMove (SV_AirMove). Uses ent.angles (updated by clientThink this call),
// NOT v_angle — matches sv.ts.
function airMove(entNum: i32, svTime: f64, frametime: f64): void {
  const angX: f64 = <f64>edLoadFloat(entNum, F_ANGLES);
  const angY: f64 = <f64>edLoadFloat(entNum, F_ANGLES1);
  const angZ: f64 = <f64>edLoadFloat(entNum, F_ANGLES2);
  const pitchRad: f64 = angX * PI / 180.0, sp: f64 = host_sin(pitchRad), cp: f64 = host_cos(pitchRad);
  const yawRad: f64 = angY * PI / 180.0, sy: f64 = host_sin(yawRad), cy: f64 = host_cos(yawRad);
  const rollRad: f64 = angZ * PI / 180.0, sr: f64 = host_sin(rollRad), cr: f64 = host_cos(rollRad);
  const fwX: f64 = cp * cy, fwY: f64 = cp * sy, fwZ: f64 = -sp;
  const rX: f64 = cr * sy - sr * sp * cy, rY: f64 = -sr * sp * sy - cr * cy, rZ: f64 = -sr * cp;

  let fmove: f64 = cmdForwardG;
  const smove: f64 = cmdSideG;
  if (svTime < (<f64>edLoadFloat(entNum, F_TELEPORT_TIME)) && fmove < 0.0) fmove = 0.0;

  const movetype: i32 = <i32>edLoadFloat(entNum, F_MOVETYPE);
  let wishX: f64 = fwX * fmove + rX * smove;
  let wishY: f64 = fwY * fmove + rY * smove;
  let wishZ: f64 = (movetype != MOVE_TYPE_WALK) ? cmdUpG : 0.0;

  const wishspeed0: f64 = Math.sqrt(wishX * wishX + wishY * wishY + wishZ * wishZ);
  let wdirX: f64 = 0.0, wdirY: f64 = 0.0, wdirZ: f64 = 0.0;
  if (wishspeed0 != 0.0) { wdirX = wishX / wishspeed0; wdirY = wishY / wishspeed0; wdirZ = wishZ / wishspeed0; }
  let wishspeed: f64 = wishspeed0;
  const scaler: f64 = maxSpeedG / wishspeed; // computed unconditionally, matches sv.ts's literal order
  if (wishspeed > maxSpeedG) {
    wishX *= scaler; wishY *= scaler; wishZ *= scaler;
    wishspeed = maxSpeedG;
  }

  if (movetype == MOVE_TYPE_NOCLIP) {
    edStoreFloat(entNum, F_VELOCITY, wishX);
    edStoreFloat(entNum, F_VELOCITY1, wishY);
    edStoreFloat(entNum, F_VELOCITY2, wishZ);
  } else if (((<i32>edLoadFloat(entNum, F_FLAGS)) & FL_ONGROUND) != 0) {
    userFriction(entNum, frametime);
    accelerateFn(entNum, wishX, wishY, wishZ, false, wdirX, wdirY, wdirZ, wishspeed, frametime);
  } else {
    accelerateFn(entNum, wishX, wishY, wishZ, true, wdirX, wdirY, wdirZ, wishspeed, frametime);
  }
}

// sv.ts calcRoll (CalcRoll). Only `right` is needed.
function calcRoll(angX: f64, angY: f64, angZ: f64, velX: f64, velY: f64, velZ: f64): f64 {
  const pitchRad: f64 = angX * PI / 180.0, sp: f64 = host_sin(pitchRad), cp: f64 = host_cos(pitchRad);
  const yawRad: f64 = angY * PI / 180.0, sy: f64 = host_sin(yawRad), cy: f64 = host_cos(yawRad);
  const rollRad: f64 = angZ * PI / 180.0, sr: f64 = host_sin(rollRad), cr: f64 = host_cos(rollRad);
  const rightX: f64 = cr * sy - sr * sp * cy, rightY: f64 = -sr * sp * sy - cr * cy, rightZ: f64 = -sr * cp;
  let side: f64 = velX * rightX + velY * rightY + velZ * rightZ;
  const sign: f64 = side < 0.0 ? -1.0 : 1.0;
  side = Math.abs(side);
  if (side < rollSpeedG) return side * sign * rollAngleG / rollSpeedG;
  return rollAngleG * sign;
}

// sv.ts clientThink (SV_ClientThink).
function clientThink(entNum: i32, svTime: f64, frametime: f64): void {
  const movetype: i32 = <i32>edLoadFloat(entNum, F_MOVETYPE);
  if (movetype == MOVE_TYPE_NONE) return;

  const pX: f64 = <f64>edLoadFloat(entNum, F_PUNCHANGLE);
  const pY: f64 = <f64>edLoadFloat(entNum, F_PUNCHANGLE1);
  const pZ: f64 = <f64>edLoadFloat(entNum, F_PUNCHANGLE2);
  const plen: f64 = Math.sqrt(pX * pX + pY * pY + pZ * pZ);
  let uX: f64 = 0.0, uY: f64 = 0.0, uZ: f64 = 0.0;
  if (plen != 0.0) { uX = pX / plen; uY = pY / plen; uZ = pZ / plen; }
  let len: f64 = plen - 10.0 * frametime;
  if (len < 0.0) len = 0.0;
  edStoreFloat(entNum, F_PUNCHANGLE, uX * len);
  edStoreFloat(entNum, F_PUNCHANGLE1, uY * len);
  edStoreFloat(entNum, F_PUNCHANGLE2, uZ * len);

  if ((<f64>edLoadFloat(entNum, F_HEALTH)) <= 0.0) return;

  const angX: f64 = <f64>edLoadFloat(entNum, F_ANGLES);
  const angY: f64 = <f64>edLoadFloat(entNum, F_ANGLES1);
  const angZ: f64 = <f64>edLoadFloat(entNum, F_ANGLES2);
  const velX: f64 = <f64>edLoadFloat(entNum, F_VELOCITY);
  const velY: f64 = <f64>edLoadFloat(entNum, F_VELOCITY1);
  const velZ: f64 = <f64>edLoadFloat(entNum, F_VELOCITY2);
  edStoreFloat(entNum, F_ANGLES2, calcRoll(angX, angY, angZ, velX, velY, velZ) * 4.0);

  if ((<f64>edLoadFloat(entNum, F_FIXANGLE)) == 0.0) {
    const vaX: f64 = <f64>edLoadFloat(entNum, F_V_ANGLE);
    const vaY: f64 = <f64>edLoadFloat(entNum, F_V_ANGLE1);
    const puX: f64 = <f64>edLoadFloat(entNum, F_PUNCHANGLE);   // post-decay value, stored above
    const puY: f64 = <f64>edLoadFloat(entNum, F_PUNCHANGLE1);
    edStoreFloat(entNum, F_ANGLES, (vaX + puX) / -3.0);
    edStoreFloat(entNum, F_ANGLES1, vaY + puY);
  }

  const flags: i32 = <i32>edLoadFloat(entNum, F_FLAGS);
  if ((flags & FL_WATERJUMP) != 0) {
    waterJump(entNum, svTime);
  } else if (((<f64>edLoadFloat(entNum, F_WATERLEVEL)) >= 2.0 || onladder(entNum))
    && (<i32>edLoadFloat(entNum, F_MOVETYPE)) != MOVE_TYPE_NOCLIP) {
    waterMove(entNum, frametime);
  } else {
    airMove(entNum, svTime, frametime);
  }
}

// ================================================================================
// SV_Physics_Client, composed with SV_ClientThink (see header COMPOSITION note).
// svTime = state.server.time for this frame; frametime = host.state.frametime.
// ================================================================================
export function physicsClient(entNum: i32, svTime: f64, frametime: f64): void {
  // Vanilla first line: return for an unconnected slot (svs.clients[num-1].active).
  if (entNum >= 0 && entNum < MAX_CMD_CLIENTS && load<u8>(CLIENT_INACTIVE + <usize>entNum) != 0) return;

  // Load THIS client's usercmd — not the last setUserCmd call's, which in
  // multiplayer is a DIFFERENT client's cmd.
  if (entNum >= 0 && entNum < MAX_CMD_CLIENTS) {
    const o: usize = <usize>entNum << 3;
    cmdForwardG = load<f64>(CMD_FWD + o);
    cmdSideG = load<f64>(CMD_SIDE + o);
    cmdUpG = load<f64>(CMD_UP + o);
  }

  // clientThink runs BEFORE PlayerPreThink, on the PRIOR frame's waterlevel.
  clientThink(entNum, svTime, frametime);

  writeGlobalFloat(GLOBAL_TIME, <f32>svTime);
  writeGlobalInt(GLOBAL_SELF, entNum);
  // globals.other is NOT reset here — matches sv.ts (only runThink resets it;
  // PreThink/PostThink inherit the last value).
  execute(readGlobalInt(GLOBAL_PLAYERPRETHINK));

  checkVelocity(entNum, maxVelocityG);
  const movetype: i32 = <i32>edLoadFloat(entNum, F_MOVETYPE);

  if (movetype == MOVE_TYPE_TOSS || movetype == MOVE_TYPE_BOUNCE || movetype == MOVE_TYPE_BOUNCEMISSILE) {
    // Same physics_Toss path as non-clients; NO early return if think frees the
    // entity — sv.ts falls through to linkEdict+PlayerPostThink in this branch.
    if (runThinkClient(entNum, svTime, frametime)) {
      physicsToss(entNum, frametime, maxVelocityG, gravityCvarG, gravityFieldIdxG);
    }
  } else {
    if (!runThinkClient(entNum, svTime, frametime)) return;
    switch (movetype) {
      case MOVE_TYPE_NONE:
        break;
      case MOVE_TYPE_WALK: {
        const flags: i32 = <i32>edLoadFloat(entNum, F_FLAGS);
        // No gravity on a ladder (QSS-M sv_phys.c ~1300); checkWater sets onladder
        // and && is left-to-right, so it's read after the update.
        if (!checkWater(entNum) && (flags & FL_WATERJUMP) == 0 && !onladder(entNum)) addGravity(entNum, frametime);
        checkStuck(entNum);
        walkMove(entNum, frametime);
        break;
      }
      case MOVE_TYPE_FLY:
        flyMove(entNum, frametime);
        break;
      case MOVE_TYPE_NOCLIP:
        edStoreFloat(entNum, F_ORIGIN, (<f64>edLoadFloat(entNum, F_ORIGIN)) + frametime * (<f64>edLoadFloat(entNum, F_VELOCITY)));
        edStoreFloat(entNum, F_ORIGIN1, (<f64>edLoadFloat(entNum, F_ORIGIN1)) + frametime * (<f64>edLoadFloat(entNum, F_VELOCITY1)));
        edStoreFloat(entNum, F_ORIGIN2, (<f64>edLoadFloat(entNum, F_ORIGIN2)) + frametime * (<f64>edLoadFloat(entNum, F_VELOCITY2)));
        break;
      default:
        // sv.ts: sys.error bad movetype — fatal, not modeled.
        break;
    }
  }

  linkEdictTouch(entNum);   // sv.ts SV_Physics_Client links the player with touch_triggers=true
  writeGlobalFloat(GLOBAL_TIME, <f32>svTime);
  writeGlobalInt(GLOBAL_SELF, entNum);
  execute(readGlobalInt(GLOBAL_PLAYERPOSTTHINK));
}
