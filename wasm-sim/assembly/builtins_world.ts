// Trace-backed QuakeC builtins — pf.ts traceline (#16), setorigin (#2),
// setsize (#4), pointcontents (#41), droptofloor (#34), aim (#44). Composes
// svmove.ts (SV_Move/linkEdict) + world.ts (pointContents) + ed.ts, on the QC
// globals union at pr.ts's fixed engine-reserved indices.
//
// PARITY: reads widen f32->f64, each store rounds once (abi.setf /
// ed.edStoreFloat) — docs/wasm-sim-port-assemblyscript.md THE PARITY RULE;
// svmove.move itself is f64-exact throughout.
//
// NOT modeled: setsize's backwards-mins/maxs runError (fatal-abort path, never
// hit by well-formed QC).

import { gf, gi, setf, seti, GLOBALS } from "./abi";
import {
  edLoadFloat, edStoreFloat, edStoreInt,
  linkEdict, move, MOVE_NORMAL, isEdictFree,
  moveTraceFraction, moveTraceEndX, moveTraceEndY, moveTraceEndZ,
  moveTracePlaneNX, moveTracePlaneNY, moveTracePlaneNZ, moveTracePlaneDist,
  moveTraceAllSolid, moveTraceStartSolid, moveTraceInOpen, moveTraceInWater, moveTraceEnt,
  pointContents,
} from "./svmove";
import { getMaxClients, getNumEdicts } from "./builtins_edict";

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

// --- QC call-ABI / engine-reserved global indices (src/engine/pr.ts globalvars,
// src/engine/pf.ts arg-read sites) ---------------------------------------------
const PARM0: i32 = 4;   // first builtin arg (float, vector, or entity)
const PARM1: i32 = 7;
const PARM2: i32 = 10;
const PARM3: i32 = 13;
const RETURN: i32 = 1;  // builtin return (float, or vector's [1..3])
const GLOBAL_VFORWARD: i32 = 59;   // pr.globalvars.v_forward
const F_HEALTH: i32 = 48;

const F_TAKEDAMAGE: i32 = 59;
const F_TEAM: i32 = 78;
const DAMAGE_AIM: f64 = 2.0;
// sv_aim (autoaim cone dot threshold, default 0.93) + teamplay, snapshot per map by
// wasmServer.loadMap (setAimCvar/setTeamplayCvar), like the movement/gravity cvars.
let aimCvarG: f64 = 0.93;
let teamplayG: f64 = 0.0;
export function setAimCvar(v: f64): void { aimCvarG = v; }
export function setTeamplayCvar(v: f64): void { teamplayG = v; }

// #44 aim — autoaim (sv.ts SV_AimTarget / pf.ts aim). Straight-ahead hit on a
// DAMAGE_AIM target keeps v_forward; else blend toward the best in-cone,
// reachable DAMAGE_AIM entity. teamplay gates friendly targets.
export function pf_aim(g: usize): void {
  const ent: i32 = gi(g, PARM0);
  const startX: f64 = <f64>edLoadFloat(ent, F_ORIGIN);
  const startY: f64 = <f64>edLoadFloat(ent, F_ORIGIN1);
  const startZ: f64 = <f64>edLoadFloat(ent, F_ORIGIN2) + 20.0;
  const fwdX: f64 = gf(g, GLOBAL_VFORWARD);
  const fwdY: f64 = gf(g, GLOBAL_VFORWARD + 1);
  const fwdZ: f64 = gf(g, GLOBAL_VFORWARD + 2);
  const entTeam: f64 = <f64>edLoadFloat(ent, F_TEAM);

  // straight-ahead trace: already lined up on a valid target => keep v_forward.
  move(startX, startY, startZ, 0, 0, 0, 0, 0, 0,
    startX + 2048.0 * fwdX, startY + 2048.0 * fwdY, startZ + 2048.0 * fwdZ, MOVE_NORMAL, ent);
  const hit0: i32 = moveTraceEnt();
  if (hit0 != -1 && <f64>edLoadFloat(hit0, F_TAKEDAMAGE) == DAMAGE_AIM &&
      (teamplayG == 0.0 || entTeam <= 0.0 || entTeam != <f64>edLoadFloat(hit0, F_TEAM))) {
    setf(g, RETURN, fwdX); setf(g, RETURN + 1, fwdY); setf(g, RETURN + 2, fwdZ);
    return;
  }

  // otherwise scan every DAMAGE_AIM entity for the best in-cone, reachable one.
  let bestdist: f64 = aimCvarG;
  let bestent: i32 = -1;
  const n: i32 = getNumEdicts();
  for (let i: i32 = 1; i < n; i++) {
    if (<f64>edLoadFloat(i, F_TAKEDAMAGE) != DAMAGE_AIM) continue;
    if (i == ent) continue;
    if (teamplayG != 0.0 && entTeam > 0.0 && entTeam == <f64>edLoadFloat(i, F_TEAM)) continue;
    const cX: f64 = <f64>edLoadFloat(i, F_ORIGIN) + 0.5 * (<f64>edLoadFloat(i, F_MINS) + <f64>edLoadFloat(i, F_MAXS));
    const cY: f64 = <f64>edLoadFloat(i, F_ORIGIN1) + 0.5 * (<f64>edLoadFloat(i, F_MINS1) + <f64>edLoadFloat(i, F_MAXS1));
    const cZ: f64 = <f64>edLoadFloat(i, F_ORIGIN2) + 0.5 * (<f64>edLoadFloat(i, F_MINS2) + <f64>edLoadFloat(i, F_MAXS2));
    let dX: f64 = cX - startX, dY: f64 = cY - startY, dZ: f64 = cZ - startZ;
    const len: f64 = Math.sqrt(dX * dX + dY * dY + dZ * dZ);
    if (len != 0.0) { const il: f64 = 1.0 / len; dX *= il; dY *= il; dZ *= il; }
    const dist: f64 = dX * fwdX + dY * fwdY + dZ * fwdZ;
    if (dist < bestdist) continue;
    move(startX, startY, startZ, 0, 0, 0, 0, 0, 0, cX, cY, cZ, MOVE_NORMAL, ent);
    if (moveTraceEnt() == i) { bestdist = dist; bestent = i; }
  }

  if (bestent != -1) {
    const dX: f64 = <f64>edLoadFloat(bestent, F_ORIGIN) - <f64>edLoadFloat(ent, F_ORIGIN);
    const dY: f64 = <f64>edLoadFloat(bestent, F_ORIGIN1) - <f64>edLoadFloat(ent, F_ORIGIN1);
    const dZ: f64 = <f64>edLoadFloat(bestent, F_ORIGIN2) - <f64>edLoadFloat(ent, F_ORIGIN2);
    const dist: f64 = dX * fwdX + dY * fwdY + dZ * fwdZ;
    let eX: f64 = fwdX * dist, eY: f64 = fwdY * dist, eZ: f64 = dZ;
    const len: f64 = Math.sqrt(eX * eX + eY * eY + eZ * eZ);
    if (len != 0.0) { const il: f64 = 1.0 / len; eX *= il; eY *= il; eZ *= il; }
    setf(g, RETURN, eX); setf(g, RETURN + 1, eY); setf(g, RETURN + 2, eZ);
    return;
  }
  setf(g, RETURN, fwdX); setf(g, RETURN + 1, fwdY); setf(g, RETURN + 2, fwdZ);
}

// #17 checkclient now lives in pvs.ts (real render-BSP PVS gate).
const GLOBAL_SELF: i32 = 28;

const TRACE_ALLSOLID: i32 = 68;
const TRACE_STARTSOLID: i32 = 69;
const TRACE_FRACTION: i32 = 70;
const TRACE_ENDPOS: i32 = 71;         // vec3 [71..73]
const TRACE_PLANE_NORMAL: i32 = 74;   // vec3 [74..76]
const TRACE_PLANE_DIST: i32 = 77;
const TRACE_ENT: i32 = 78;
const TRACE_INOPEN: i32 = 79;
const TRACE_INWATER: i32 = 80;

// --- entvars field indices (src/engine/pr.ts entvars, vanilla layout — matches
// svmove.ts's own F_* constants) ------------------------------------------------
const F_ORIGIN: i32 = 10, F_ORIGIN1: i32 = 11, F_ORIGIN2: i32 = 12;
const F_MINS: i32 = 33, F_MINS1: i32 = 34, F_MINS2: i32 = 35;
const F_MAXS: i32 = 36, F_MAXS1: i32 = 37, F_MAXS2: i32 = 38;
const F_SIZE: i32 = 39, F_SIZE1: i32 = 40, F_SIZE2: i32 = 41;
const F_GROUNDENTITY: i32 = 47;
const F_FLAGS: i32 = 76;

const FL_ONGROUND: i32 = 512; // sv.ts FL.onground

// #16 float(vector v1, vector v2, float tryents) traceline
export function pf_traceline(g: usize): void {
  const sx: f64 = gf(g, PARM0), sy: f64 = gf(g, PARM0 + 1), sz: f64 = gf(g, PARM0 + 2);
  const ex: f64 = gf(g, PARM1), ey: f64 = gf(g, PARM1 + 1), ez: f64 = gf(g, PARM1 + 2);
  const moveType: i32 = <i32>gf(g, PARM2); // pf.ts truncates via >> 0
  const passEnt: i32 = gi(g, PARM3);       // always a real edict (0 == world), never null

  move(sx, sy, sz, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, ex, ey, ez, moveType, passEnt);

  setf(g, TRACE_ALLSOLID, moveTraceAllSolid() != 0 ? 1.0 : 0.0);
  setf(g, TRACE_STARTSOLID, moveTraceStartSolid() != 0 ? 1.0 : 0.0);
  setf(g, TRACE_FRACTION, moveTraceFraction());
  setf(g, TRACE_INWATER, moveTraceInWater() != 0 ? 1.0 : 0.0);
  setf(g, TRACE_INOPEN, moveTraceInOpen() != 0 ? 1.0 : 0.0);
  setf(g, TRACE_ENDPOS, moveTraceEndX());
  setf(g, TRACE_ENDPOS + 1, moveTraceEndY());
  setf(g, TRACE_ENDPOS + 2, moveTraceEndZ());
  setf(g, TRACE_PLANE_NORMAL, moveTracePlaneNX());
  setf(g, TRACE_PLANE_NORMAL + 1, moveTracePlaneNY());
  setf(g, TRACE_PLANE_NORMAL + 2, moveTracePlaneNZ());
  setf(g, TRACE_PLANE_DIST, moveTracePlaneDist());
  const traceEnt: i32 = moveTraceEnt();
  seti(g, TRACE_ENT, traceEnt == -1 ? 0 : traceEnt); // no-hit -> world (0), as pf.ts
}

// #2 void(entity e, vector o) setorigin
export function pf_setorigin(g: usize): void {
  const ent: i32 = gi(g, PARM0);
  edStoreFloat(ent, F_ORIGIN, gf(g, PARM1));
  edStoreFloat(ent, F_ORIGIN1, gf(g, PARM1 + 1));
  edStoreFloat(ent, F_ORIGIN2, gf(g, PARM1 + 2));
  linkEdict(ent);
}

// #4 void(entity e, vector min, vector max) setsize
// (backwards-mins/maxs runError guard NOT modeled — see header.)
export function pf_setsize(g: usize): void {
  const ent: i32 = gi(g, PARM0);
  const minX: f64 = gf(g, PARM1), minY: f64 = gf(g, PARM1 + 1), minZ: f64 = gf(g, PARM1 + 2);
  const maxX: f64 = gf(g, PARM2), maxY: f64 = gf(g, PARM2 + 1), maxZ: f64 = gf(g, PARM2 + 2);
  edStoreFloat(ent, F_MINS, minX);
  edStoreFloat(ent, F_MINS1, minY);
  edStoreFloat(ent, F_MINS2, minZ);
  edStoreFloat(ent, F_MAXS, maxX);
  edStoreFloat(ent, F_MAXS1, maxY);
  edStoreFloat(ent, F_MAXS2, maxZ);
  edStoreFloat(ent, F_SIZE, maxX - minX);
  edStoreFloat(ent, F_SIZE1, maxY - minY);
  edStoreFloat(ent, F_SIZE2, maxZ - minZ);
  linkEdict(ent);
}

// #41 float(vector v) pointcontents. CONTENTS_* ints are all f32-exact, so the
// straight store into the float RETURN slot is lossless.
export function pf_pointcontents(g: usize): void {
  const px: f64 = gf(g, PARM0), py: f64 = gf(g, PARM0 + 1), pz: f64 = gf(g, PARM0 + 2);
  const cont: i32 = pointContents(px, py, pz);
  setf(g, RETURN, <f64>cont);
}

// #34 float() droptofloor. Reads `self` (GLOBAL_SELF), not an arg slot.
export function pf_droptofloor(g: usize): void {
  const ent: i32 = gi(g, GLOBAL_SELF);
  const ox: f64 = <f64>edLoadFloat(ent, F_ORIGIN);
  const oy: f64 = <f64>edLoadFloat(ent, F_ORIGIN1);
  const oz: f64 = <f64>edLoadFloat(ent, F_ORIGIN2);
  const minsX: f64 = <f64>edLoadFloat(ent, F_MINS), minsY: f64 = <f64>edLoadFloat(ent, F_MINS1), minsZ: f64 = <f64>edLoadFloat(ent, F_MINS2);
  const maxsX: f64 = <f64>edLoadFloat(ent, F_MAXS), maxsY: f64 = <f64>edLoadFloat(ent, F_MAXS1), maxsZ: f64 = <f64>edLoadFloat(ent, F_MAXS2);
  const endZ: f64 = oz - 256.0;

  move(ox, oy, oz, minsX, minsY, minsZ, maxsX, maxsY, maxsZ, ox, oy, endZ, MOVE_NORMAL, ent);

  const fraction: f64 = moveTraceFraction();
  const allsolid: bool = moveTraceAllSolid() != 0;
  if (fraction == 1.0 || allsolid) {
    setf(g, RETURN, 0.0);
    return;
  }
  edStoreFloat(ent, F_ORIGIN, moveTraceEndX());
  edStoreFloat(ent, F_ORIGIN1, moveTraceEndY());
  edStoreFloat(ent, F_ORIGIN2, moveTraceEndZ());
  linkEdict(ent);
  let flags: i32 = <i32>edLoadFloat(ent, F_FLAGS);
  flags |= FL_ONGROUND;
  edStoreFloat(ent, F_FLAGS, <f64>flags);
  edStoreInt(ent, F_GROUNDENTITY, moveTraceEnt()); // pf.ts: ent.v_int[groundentity] = trace.ent.num
  setf(g, RETURN, 1.0);
}
