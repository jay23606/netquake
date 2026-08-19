// QuakeC builtin dispatch — callBuiltin(n) routes a builtin number (src/engine/
// pf.ts pf.builtin[].defaultFnNbr) to its implementation. PURE builtins are direct
// AS-level imports; HOST-SERVICE builtins are `declare function host_*` imports.
// Unwired numbers fall through to host_unimplemented.
// This module is control flow, not arithmetic — it must use EXACTLY the pf.ts
// calling convention (which GLOBALS slots are which args).

import { gf, gi, setf, seti, GLOBALS } from "./abi";
import { makevectors, normalize, vlen, vectoyaw, vectoangles } from "./builtins_math";
import { pf_traceline, pf_setorigin, pf_setsize, pf_pointcontents, pf_droptofloor, pf_aim } from "./builtins_world";
import { checkclient } from "./pvs";
import { pf_rint, pf_floor, pf_ceil, pf_fabs, pf_sin, pf_cos, pf_sqrt, pf_changeyaw } from "./builtins_math2";
import { pf_spawn, pf_remove, pf_find, pf_findradius, pf_nextent, pf_copyentity, pf_findchain, pf_findchainfloat } from "./builtins_edict";
import { pf_walkmove, pf_checkbottom, pf_movetogoal } from "./builtins_move";
import { pf_setmodel } from "./builtins_model";
import {
  ftos, vtos, heapStrCaseCmp, heapStrNCaseCmp,
  heapStrlen, heapStrCmpN, heapStrOfs, heapCharAt, heapSubstring, heapStrzone,
  tempBegin, tempPutc, tempPutHeapStr, tempEnd,
} from "./strings";
import { getArgc } from "./vm";

// Re-export the ed/world/svmove scaffolding builtins_world.ts pulls in — not used
// by the dispatch itself, but the test harness needs it to set up edict/hull state.
export {
  initEdicts, edFieldPtr, edLoadInt, edStoreInt, edLoadFloat, edStoreFloat, clearEdict,
  initAreaTree, linkEdict, unlinkEdict, setEdictFree, isEdictFree, setWorldHullRange,
  setHullMeta, setPlane, setClipNode, initHullStorage,
} from "./builtins_world";
// strings.ts scaffolding (initStringTemp must run once per instance before
// BI_FTOS/BI_VTOS, matching real init order).
export { initStringTemp, newString, readStringToScratch, scratchPtr, maxScratch, stringTempOfs, tempStringFromScratch } from "./strings";

declare function host_pow(x: f64, y: f64): f64; // JS Math.pow parity

export function globalsPtr(): usize { return GLOBALS; }
// JS-callable GLOBALS accessors for the test harness: heap.alloc in transitively
// pulled init code can grow memory and detach a previously captured JS view.
export function writeGlobalFloat(idx: i32, v: f32): void { setf(GLOBALS, idx, <f64>v); }
export function readGlobalFloat(idx: i32): f32 { return <f32>gf(GLOBALS, idx); }
export function writeGlobalInt(idx: i32, v: i32): void { seti(GLOBALS, idx, v); }
export function readGlobalInt(idx: i32): i32 { return gi(GLOBALS, idx); }

// --- QC call-ABI / engine-reserved global indices (src/engine/pr.ts globalvars) -
const PARM0: i32 = 4;
const PARM1: i32 = 7;
const PARM2: i32 = 10;
const PARM3: i32 = 13;
const PARM4: i32 = 16;
const RETURN: i32 = 1;
const GLOBAL_SELF: i32 = 28;
const MSG_ENTITY: i32 = 81;

// ============================================================================
// Builtin numbers (src/engine/pf.ts pf.builtin[].defaultFnNbr — the classic set)
// ============================================================================
const BI_MAKEVECTORS: i32 = 1;
const BI_SETORIGIN: i32 = 2;
const BI_SETMODEL: i32 = 3;
const BI_SETSIZE: i32 = 4;
const BI_BREAK: i32 = 6;
const BI_RANDOM: i32 = 7;
const BI_SOUND: i32 = 8;
const BI_NORMALIZE: i32 = 9;
const BI_ERROR: i32 = 10;
const BI_OBJERROR: i32 = 11;
const BI_VLEN: i32 = 12;
const BI_VECTOYAW: i32 = 13;
const BI_SPAWN: i32 = 14;
const BI_REMOVE: i32 = 15;
const BI_TRACELINE: i32 = 16;
const BI_CHECKCLIENT: i32 = 17;
const BI_FIND: i32 = 18;
const BI_PRECACHE_SOUND: i32 = 19;
const BI_PRECACHE_MODEL: i32 = 20;
const BI_STUFFCMD: i32 = 21;
const BI_FINDRADIUS: i32 = 22;
const BI_BPRINT: i32 = 23;
const BI_SPRINT: i32 = 24;
const BI_DPRINT: i32 = 25;
const BI_FTOS: i32 = 26;
const BI_VTOS: i32 = 27;
const BI_COREDUMP: i32 = 28;
const BI_TRACEON: i32 = 29;
const BI_TRACEOFF: i32 = 30;
const BI_EPRINT: i32 = 31;
const BI_WALKMOVE: i32 = 32;
const BI_DROPTOFLOOR: i32 = 34;
const BI_LIGHTSTYLE: i32 = 35;
const BI_RINT: i32 = 36;
const BI_FLOOR: i32 = 37;
const BI_CEIL: i32 = 38;
const BI_CHECKBOTTOM: i32 = 40;
const BI_POINTCONTENTS: i32 = 41;
const BI_FABS: i32 = 43;
const BI_AIM: i32 = 44;
const BI_CVAR: i32 = 45;
const BI_LOCALCMD: i32 = 46;
const BI_NEXTENT: i32 = 47;
const BI_PARTICLE: i32 = 48;
const BI_CHANGEYAW: i32 = 49;
const BI_VECTOANGLES: i32 = 51;
const BI_WRITEBYTE: i32 = 52;
const BI_WRITECHAR: i32 = 53;
const BI_WRITESHORT: i32 = 54;
const BI_WRITELONG: i32 = 55;
const BI_WRITECOORD: i32 = 56;
const BI_WRITEANGLE: i32 = 57;
const BI_WRITESTRING: i32 = 58;
const BI_WRITEENTITY: i32 = 59;
const BI_SIN: i32 = 60;
const BI_COS: i32 = 61;
const BI_SQRT: i32 = 62;
const BI_CHANGEPITCH: i32 = 63;
const BI_TRACETOSS: i32 = 64;
const BI_ETOS: i32 = 65;
const BI_MOVETOGOAL: i32 = 67;
const BI_PRECACHE_FILE: i32 = 68;
const BI_MAKESTATIC: i32 = 69;
const BI_CHANGELEVEL: i32 = 70;
const BI_CVAR_SET: i32 = 72;
const BI_CENTERPRINT: i32 = 73;
const BI_AMBIENTSOUND: i32 = 74;
const BI_PRECACHE_MODEL2: i32 = 75;
const BI_PRECACHE_SOUND2: i32 = 76;
const BI_PRECACHE_FILE2: i32 = 77;
const BI_SETSPAWNPARMS: i32 = 78;
const BI_INFOKEY: i32 = 80;
const BI_STOF: i32 = 81;
// DP extension math (pure).
const BI_FMIN: i32 = 94;
const BI_FMAX: i32 = 95;
const BI_FBOUND: i32 = 96;
const BI_FPOW: i32 = 97;
// FTE_STRINGS builtins (pure string ops on the WASM string heap — see strings.ts).
const BI_STRLEN: i32 = 114;
const BI_STRCAT: i32 = 115;
const BI_SUBSTRING: i32 = 116;
const BI_STRZONE: i32 = 118;
const BI_STRUNZONE: i32 = 119;
const BI_STRSTROFS: i32 = 221;
const BI_STR2CHR: i32 = 222;
const BI_CHR2STR: i32 = 223;
const BI_STRNCMP: i32 = 228;
const BI_STRCASECMP: i32 = 229;
const BI_STRNCASECMP: i32 = 230;   // FTE/DP #230; progs_dump combat's surface "sky" check
// DP/FTE particle-effect output builtins — bridged to the JS pf impls via host_extbuiltin.
const BI_PARTICLEEFFECTNUM: i32 = 335;
const BI_TRAILPARTICLES: i32 = 336;
const BI_POINTPARTICLES: i32 = 337;
const BI_TE_PARTICLERAIN: i32 = 409;
const BI_TE_PARTICLESNOW: i32 = 410;
// DP_QC_GETSURFACE — bridged (needs the JS worldmodel's face data). 437 returns a STRING.
const BI_GETSURFACENEARPOINT: i32 = 438;
const BI_GETSURFACETEXTURE: i32 = 437;
// Host-service bridges: setspawnparms(78), infokey(80), checkextension(99),
// file I/O(110-113). fgets/infokey return strings.
const BI_CHECKEXTENSION: i32 = 99;
const BI_FOPEN: i32 = 110;
const BI_FCLOSE: i32 = 111;
const BI_FGETS: i32 = 112;
const BI_FPUTS: i32 = 113;
// Complex/cold string + info builtins — bridged. stov returns a vector; the rest strings.
const BI_STOV: i32 = 117;
const BI_STRCONV: i32 = 224;
const BI_STRPAD: i32 = 225;
const BI_INFOADD: i32 = 226;
const BI_INFOGET: i32 = 227;
// entity builtins: copyentity/findchain/findchainfloat native; setcolor bridged (client + network).
const BI_COPYENTITY: i32 = 400;
const BI_SETCOLOR: i32 = 401;
const BI_FINDCHAIN: i32 = 402;
const BI_FINDCHAINFLOAT: i32 = 403;
// 2021-rerelease "= #0" builtins, numbered from here up by src/engine/pr.ts (above every real
// builtin) since QCC leaves them for the engine to bind by name. All bridge to their JS impls.
const EXT_BUILTIN_BASE: i32 = 900;

// ============================================================================
// HOST IMPORTS — the ABI surface this module needs from the embedder, grouped
// by pf.ts function family.
// ============================================================================

// --- console/print family --------------------------------------------------------
// pf.ts varString concatenates EVERY optional string arg (QC varargs); `strOfs`
// here is only the FIRST format-string arg (PARM0 for bprint/dprint, PARM1 for
// sprint/centerprint), not the concatenated varString — a known gap.
export const PRINT_DPRINT: i32 = 0;
export const PRINT_BPRINT: i32 = 1;
export const PRINT_SPRINT: i32 = 2;
export const PRINT_CENTERPRINT: i32 = 3;
export const PRINT_BREAK: i32 = 4; // no string (pf.ts: literal "break statement\n"); strOfs unused
declare function host_print(level: i32, ent: i32, strOfs: i32): void;

export const ERR_ERROR: i32 = 0;    // #10 error — fatal (pf.ts: host.throwError after printing)
export const ERR_OBJERROR: i32 = 1; // #11 objerror — non-fatal (pf.ts: ed.free(ent) after printing)
declare function host_error(kind: i32, ent: i32, strOfs: i32): void;

// --- network message-out family ---------------------------------------------
// ent = edict NUMBER (pf.ts resolves the edict; host.ts only ever has the number).
declare function host_sound(ent: i32, chan: i32, sampStrOfs: i32, vol: i32, attn: f64): void;
declare function host_ambientsound(x: f64, y: f64, z: f64, sampStrOfs: i32, vol: f64, attn: f64): void;
declare function host_particle(orgX: f64, orgY: f64, orgZ: f64, dirX: f64, dirY: f64, dirZ: f64, color: i32, count: i32): void;
declare function host_lightstyle(style: i32, strOfs: i32): void;
declare function host_makestatic(ent: i32): void;

// write* family: dest/clientEnt are pre-resolved (pf.ts writeDest: 0=datagram,
// 1=one/msg_entity, 2=reliable, 3=signon) since the buffers are host-side state.
// WriteString/WriteEntity get their own imports (string offset / raw entity int).
export const WRITE_BYTE: i32 = 0;
export const WRITE_CHAR: i32 = 1;
export const WRITE_SHORT: i32 = 2;
export const WRITE_LONG: i32 = 3;
export const WRITE_COORD: i32 = 4;
export const WRITE_ANGLE: i32 = 5;
declare function host_msg_write(kind: i32, dest: i32, clientEnt: i32, value: f64): void;
declare function host_msg_write_string(dest: i32, clientEnt: i32, strOfs: i32): void;
declare function host_msg_write_entity(dest: i32, clientEnt: i32, entValue: i32): void;

// --- client command / stuffing --------------------------------------------------
// Varargs (FTE PF_stuffcmd): `strOfs` is only the FIRST string arg. The embedder joins PARM1..
// itself from getArgc() and the globals, resolving each through this module's string reader.
declare function host_stuffcmd(clientEnt: i32, strOfs: i32): void;
declare function host_localcmd(strOfs: i32): void;

// --- cvar -------------------------------------------------------------------------
declare function host_cvar_get(strOfs: i32): f64;
declare function host_cvar_set(nameStrOfs: i32, valueStrOfs: i32): void;

// --- asset/precache -----------------------------------------------------------
// precache_model/_sound (+ *2 aliases) register/validate host-side, in addition
// to the inline RETURN=PARM0 passthrough in the dispatch.
export const PRECACHE_MODEL: i32 = 0;
export const PRECACHE_SOUND: i32 = 1;
declare function host_precache(kind: i32, strOfs: i32): void;

// --- server control -------------------------------------------------------------
declare function host_changelevel(strOfs: i32): void;
declare function host_random(): f64; // rng policy is a host decision
// Bridge an extension builtin to its JS pf impl: the host syncs the arg region +
// argc, calls pf[n](), and syncs the return back.
declare function host_extbuiltin(n: i32): void;

// --- catch-all for unported/unrecognized builtin numbers -----------------------
declare function host_unimplemented(n: i32): void;

// ============================================================================
// DISPATCH
// ============================================================================
export function callBuiltin(n: i32): void {
  const g: usize = GLOBALS;
  switch (n) {
    // --- ported: pure vector/trig math (builtins_math.ts) ---------------------
    case BI_MAKEVECTORS: makevectors(g); return;
    case BI_NORMALIZE: normalize(g); return;
    case BI_VLEN: vlen(g); return;
    case BI_VECTOYAW: vectoyaw(g); return;
    case BI_VECTOANGLES: vectoangles(g); return;

    // --- ported: trace-backed world builtins (builtins_world.ts) --------------
    case BI_SETORIGIN: pf_setorigin(g); return;
    case BI_SETSIZE: pf_setsize(g); return;
    case BI_TRACELINE: pf_traceline(g); return;
    case BI_POINTCONTENTS: pf_pointcontents(g); return;
    case BI_DROPTOFLOOR: pf_droptofloor(g); return;

    // --- ported: math/angle (builtins_math2.ts) ------------------------------
    case BI_RINT: pf_rint(g); return;
    case BI_FLOOR: pf_floor(g); return;
    case BI_CEIL: pf_ceil(g); return;
    case BI_FABS: pf_fabs(g); return;
    case BI_SIN: pf_sin(g); return;
    case BI_COS: pf_cos(g); return;
    case BI_SQRT: pf_sqrt(g); return;
    case BI_CHANGEYAW: pf_changeyaw(g); return;

    // --- ported: entity lifecycle (builtins_edict.ts) — num_edicts/server.time
    // are maintained by the embedder via builtins_edict's setters. -------------
    case BI_SPAWN: pf_spawn(g); return;
    case BI_REMOVE: pf_remove(g); return;
    case BI_FIND: pf_find(g); return;
    case BI_FINDRADIUS: pf_findradius(g); return;
    case BI_NEXTENT: pf_nextent(g); return;

    // --- ported: movement (builtins_move.ts) ---------------------------------
    case BI_WALKMOVE: pf_walkmove(g); return;
    case BI_CHECKBOTTOM: pf_checkbottom(g); return;
    case BI_MOVETOGOAL: pf_movetogoal(g); return;

    // --- ported: setmodel (builtins_model.ts) — sets modelindex + bmodel mins/maxs
    case BI_SETMODEL: pf_setmodel(g); return;

    // --- ported: string-heap formatting (strings.ts) --------------------------
    case BI_FTOS: {
      const v: f64 = gf(g, PARM0);
      seti(g, RETURN, ftos(v));
      return;
    }
    case BI_VTOS: {
      const x: f64 = gf(g, PARM0), y: f64 = gf(g, PARM0 + 1), z: f64 = gf(g, PARM0 + 2);
      seti(g, RETURN, vtos(x, y, z));
      return;
    }

    // #68/#77 precache_file/_file2 (pf.ts): RETURN = PARM0, no other effect.
    case BI_PRECACHE_FILE:
    case BI_PRECACHE_FILE2:
      seti(g, RETURN, gi(g, PARM0));
      return;

    // --- host-service: precache (pure RETURN passthrough + host register/validate) -
    case BI_PRECACHE_MODEL:
    case BI_PRECACHE_MODEL2: {
      const s: i32 = gi(g, PARM0);
      seti(g, RETURN, s);
      host_precache(PRECACHE_MODEL, s);
      return;
    }
    case BI_PRECACHE_SOUND:
    case BI_PRECACHE_SOUND2: {
      const s: i32 = gi(g, PARM0);
      seti(g, RETURN, s);
      host_precache(PRECACHE_SOUND, s);
      return;
    }

    // --- host-service: console/print family ------------------------------------
    case BI_DPRINT: host_print(PRINT_DPRINT, 0, gi(g, PARM0)); return;
    case BI_BPRINT: host_print(PRINT_BPRINT, 0, gi(g, PARM0)); return;
    case BI_SPRINT: host_print(PRINT_SPRINT, gi(g, PARM0), gi(g, PARM1)); return;
    case BI_CENTERPRINT: host_print(PRINT_CENTERPRINT, gi(g, PARM0), gi(g, PARM1)); return;
    case BI_BREAK: host_print(PRINT_BREAK, 0, -1); return;
    case BI_ERROR: host_error(ERR_ERROR, gi(g, GLOBAL_SELF), gi(g, PARM0)); return;
    case BI_OBJERROR: host_error(ERR_OBJERROR, gi(g, GLOBAL_SELF), gi(g, PARM0)); return;

    // --- host-service: network message-out --------------------------------------
    case BI_SOUND:
      host_sound(gi(g, PARM0), <i32>gf(g, PARM1), gi(g, PARM2), <i32>(gf(g, PARM3) * 255.0), gf(g, PARM4));
      return;
    case BI_AMBIENTSOUND:
      host_ambientsound(gf(g, PARM0), gf(g, PARM0 + 1), gf(g, PARM0 + 2), gi(g, PARM1), gf(g, PARM2), gf(g, PARM3));
      return;
    case BI_PARTICLE:
      host_particle(gf(g, PARM0), gf(g, PARM0 + 1), gf(g, PARM0 + 2), gf(g, PARM1), gf(g, PARM1 + 1), gf(g, PARM1 + 2), <i32>gf(g, PARM2), <i32>gf(g, PARM3));
      return;
    case BI_LIGHTSTYLE: host_lightstyle(<i32>gf(g, PARM0), gi(g, PARM1)); return;
    case BI_MAKESTATIC: host_makestatic(gi(g, PARM0)); return;

    // --- host-service: write* family ---------------------------------------------
    case BI_WRITEBYTE: host_msg_write(WRITE_BYTE, <i32>gf(g, PARM0), gi(g, MSG_ENTITY), gf(g, PARM1)); return;
    case BI_WRITECHAR: host_msg_write(WRITE_CHAR, <i32>gf(g, PARM0), gi(g, MSG_ENTITY), gf(g, PARM1)); return;
    case BI_WRITESHORT: host_msg_write(WRITE_SHORT, <i32>gf(g, PARM0), gi(g, MSG_ENTITY), gf(g, PARM1)); return;
    case BI_WRITELONG: host_msg_write(WRITE_LONG, <i32>gf(g, PARM0), gi(g, MSG_ENTITY), gf(g, PARM1)); return;
    case BI_WRITECOORD: host_msg_write(WRITE_COORD, <i32>gf(g, PARM0), gi(g, MSG_ENTITY), gf(g, PARM1)); return;
    case BI_WRITEANGLE: host_msg_write(WRITE_ANGLE, <i32>gf(g, PARM0), gi(g, MSG_ENTITY), gf(g, PARM1)); return;
    case BI_WRITESTRING: host_msg_write_string(<i32>gf(g, PARM0), gi(g, MSG_ENTITY), gi(g, PARM1)); return;
    case BI_WRITEENTITY: host_msg_write_entity(<i32>gf(g, PARM0), gi(g, MSG_ENTITY), gi(g, PARM1)); return;

    // --- host-service: client command / stuffing ----------------------------------
    case BI_STUFFCMD: host_stuffcmd(gi(g, PARM0), gi(g, PARM1)); return;
    case BI_LOCALCMD: host_localcmd(gi(g, PARM0)); return;

    // --- host-service: cvar --------------------------------------------------------
    case BI_CVAR: setf(g, RETURN, host_cvar_get(gi(g, PARM0))); return;
    case BI_CVAR_SET: host_cvar_set(gi(g, PARM0), gi(g, PARM1)); return;

    // --- host-service: server control ----------------------------------------------
    case BI_CHANGELEVEL: host_changelevel(gi(g, PARM0)); return;
    case BI_RANDOM: setf(g, RETURN, host_random()); return;

    // --- extension/bridged builtins -------------------------------------------
    case BI_CHECKCLIENT: checkclient(g); return;   // client PVS visibility (pvs.ts)
    case BI_AIM: pf_aim(g); return;                   // autoaim direction (simplified — see builtins_world)
    case BI_PARTICLEEFFECTNUM:                        // DP/FTE particle-effect emitters (AD effectinfo)
    case BI_TRAILPARTICLES:
    case BI_POINTPARTICLES:
    case BI_TE_PARTICLERAIN:
    case BI_TE_PARTICLESNOW:
    case BI_GETSURFACENEARPOINT:                      // surface queries (JS worldmodel faces)
    case BI_GETSURFACETEXTURE:
    case BI_SETCOLOR:                                // #401 client color + SVC_updatecolors broadcast
    case BI_STOV:                                    // #117 string->vector
    case BI_STRCONV:                                 // #224 case/colour remap
    case BI_STRPAD:                                  // #225 pad
    case BI_INFOADD:                                 // #226 info-string set
    case BI_INFOGET:                                 // #227 info-string get
    case BI_COREDUMP:                                // #28 ed.printEdicts — console diagnostic
    case BI_EPRINT:                                  // #31 ed.print(PARM0) — console diagnostic
    case BI_SETSPAWNPARMS:                           // #78 client spawn-state (campaign carry-over)
    case BI_INFOKEY:                                 // #80 client/server info value (string)
    case BI_CHECKEXTENSION:                          // #99 extension query
    case BI_FOPEN:                                   // #110-113 file I/O (asset store)
    case BI_FCLOSE:
    case BI_FGETS:
    case BI_FPUTS: host_extbuiltin(n); return;
    case BI_FMIN: {                                    // #94 min of the float args
      let r: f64 = gf(g, PARM0); const an: i32 = getArgc();
      for (let i: i32 = 1; i < an; i++) { const v: f64 = gf(g, PARM0 + i * 3); if (v < r) r = v; }
      setf(g, RETURN, r); return;
    }
    case BI_FMAX: {                                    // #95 max of the float args
      let r: f64 = gf(g, PARM0); const an: i32 = getArgc();
      for (let i: i32 = 1; i < an; i++) { const v: f64 = gf(g, PARM0 + i * 3); if (v > r) r = v; }
      setf(g, RETURN, r); return;
    }
    case BI_FBOUND: {                                  // #96 clamp(val, min, max)
      let v: f64 = gf(g, PARM1); const mn: f64 = gf(g, PARM0), mx: f64 = gf(g, PARM2);
      if (v > mx) v = mx; if (v < mn) v = mn;
      setf(g, RETURN, v); return;
    }
    case BI_FPOW: setf(g, RETURN, host_pow(gf(g, PARM0), gf(g, PARM1))); return;  // #97
    case BI_COPYENTITY: pf_copyentity(g); return;      // #400
    case BI_FINDCHAIN: pf_findchain(g); return;        // #402
    case BI_FINDCHAINFLOAT: pf_findchainfloat(g); return; // #403
    case BI_STRLEN: setf(g, RETURN, <f64>heapStrlen(gi(g, PARM0))); return;
    case BI_STRCAT: {                                  // #115 concat up to 8 string args
      tempBegin();
      const argn: i32 = getArgc();
      for (let i: i32 = 0; i < argn; i++) tempPutHeapStr(gi(g, PARM0 + i * 3));
      seti(g, RETURN, tempEnd());
      return;
    }
    case BI_SUBSTRING: seti(g, RETURN, heapSubstring(gi(g, PARM0), <i32>gf(g, PARM1), <i32>gf(g, PARM2))); return;
    case BI_STRZONE: seti(g, RETURN, heapStrzone(gi(g, PARM0))); return;
    case BI_STRUNZONE: return;                          // #119 no-op (linear heap; per-map reset bounds the leak)
    case BI_STR2CHR: {                                 // #222 char code at index
      const idx: i32 = getArgc() > 1 ? <i32>gf(g, PARM1) : 0;
      setf(g, RETURN, <f64>heapCharAt(gi(g, PARM0), idx));
      return;
    }
    case BI_CHR2STR: {                                 // #223 char codes -> string
      tempBegin();
      const cn: i32 = getArgc();
      for (let i: i32 = 0; i < cn; i++) {
        const u: i32 = <i32>gf(g, PARM0 + i * 3);
        tempPutc(((u >= 0xe000 && u < 0xe100) || u < 256) ? (u & 0xff) : 0x3f);
      }
      seti(g, RETURN, tempEnd());
      return;
    }
    case BI_STRSTROFS: {                               // #221 index of sub in s (or -1)
      const instr: i32 = gi(g, PARM0), match: i32 = gi(g, PARM1);
      const firstofs: i32 = getArgc() > 2 ? <i32>gf(g, PARM2) : 0;
      if (firstofs != 0 && (firstofs < 0 || firstofs > heapStrlen(instr))) { setf(g, RETURN, -1.0); return; }
      setf(g, RETURN, <f64>heapStrOfs(instr, match, firstofs));
      return;
    }
    case BI_STRNCMP: {                                 // #228 case-sensitive n-compare (2-arg = full strcmp)
      const a: i32 = gi(g, PARM0), b: i32 = gi(g, PARM1);
      if (getArgc() > 2) {
        const aofs: i32 = getArgc() > 3 ? <i32>gf(g, PARM3) : 0;
        setf(g, RETURN, <f64>heapStrCmpN(a, aofs, b, <i32>gf(g, PARM2), false));
      } else {
        setf(g, RETURN, <f64>heapStrCmpN(a, 0, b, -1, false));
      }
      return;
    }
    case BI_STRCASECMP: setf(g, RETURN, <f64>heapStrCaseCmp(gi(g, PARM0), gi(g, PARM1))); return;  // #229
    case BI_STRNCASECMP: {                             // #230 strncasecmp / strcasecmp (case-insensitive string compare)
      const a: i32 = gi(g, PARM0), b: i32 = gi(g, PARM1);
      if (getArgc() > 2) {
        const n: i32 = <i32>gf(g, PARM2);
        const aofs: i32 = getArgc() > 3 ? <i32>gf(g, PARM3) : 0;
        setf(g, RETURN, <f64>heapStrNCaseCmp(a, aofs, b, n));
      } else {
        setf(g, RETURN, <f64>heapStrCaseCmp(a, b));
      }
      return;
    }
    case BI_CHANGEPITCH:   // pf.ts no-op today (reads nonexistent angles0) — see builtins_math2 header
    case BI_TRACEON:    // sets pr.state.trace, which only steers the JS VM — inert for this one
    case BI_TRACEOFF:
    case BI_TRACETOSS: // pf.ts itself stubs this to `fixme` — never implemented in JS either
    case BI_ETOS:       // pf.ts itself stubs this to `fixme` — never implemented in JS either
    case BI_STOF:
      // Zero RETURN so QC gets a SAFE value instead of a STALE one: a stale ENTITY
      // return gets dereferenced by QC into an out-of-range edict address and a
      // wasm OOB trap. Zeroing degrades gracefully.
      setf(g, RETURN, 0.0); setf(g, RETURN + 1, 0.0); setf(g, RETURN + 2, 0.0);
      host_unimplemented(n);
      return;

    default:
      setf(g, RETURN, 0.0); setf(g, RETURN + 1, 0.0); setf(g, RETURN + 2, 0.0);
      if (n >= EXT_BUILTIN_BASE) { host_extbuiltin(n); return; }
      host_unimplemented(n);
      return;
  }
}
