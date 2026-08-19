// WASM sim entry — the unified public API surface (compiles to build/sim.wasm).
// Modules are also built standalone for their parity tests (see run.mjs).
//
// globalsPtr is exported by both vm and builtins_math; vm's is canonical, so
// builtins_math is re-exported selectively to avoid the duplicate.
// Per-map host config the whole sim shares (abi.ts owns the single global).
export { setRerelease } from "./abi";
export * from "./math";
export * from "./vm";
export * from "./world";
export * from "./ed";
export * from "./strings";
export { makevectors, normalize, vlen, vectoyaw, vectoangles } from "./builtins_math";
// svmove re-exports ed+world internally, so export only its OWN symbols here.
export {
  initAreaTree, linkEdict, unlinkEdict, setEdictFree, isEdictFree, setWorldHullRange,
  touchLogReset, touchLogCount, touchLogPtr, touchLogDumpTriggers, touchLogDumpChains,
  move, moveTraceFraction, moveTraceEndX, moveTraceEndY, moveTraceEndZ,
  moveTracePlaneNX, moveTracePlaneNY, moveTracePlaneNZ, moveTracePlaneDist,
  moveTraceAllSolid, moveTraceStartSolid, moveTraceInOpen, moveTraceInWater, moveTraceEnt,
} from "./svmove";
// builtins_world re-exports svmove and exports colliding globalsPtr/writeGlobal*,
// so take only the pf_* builtins.
export {
  pf_traceline, pf_setorigin, pf_setsize, pf_pointcontents, pf_droptofloor,
  setAimCvar, setTeamplayCvar,
} from "./builtins_world";
// svphysics re-exports svmove internally, so take only its own motion functions.
export {
  clipVelocity, clipVelocityOutX, clipVelocityOutY, clipVelocityOutZ,
  checkVelocity, flyMove, pushEntity, physicsToss,
} from "./svphysics";
// host.ts also exports vm-colliding globalsPtr/writeGlobal*; take only callBuiltin.
export { callBuiltin } from "./host";
// Builtin modules — export only their pf_* (colliding exports otherwise).
export { pf_rint, pf_floor, pf_ceil, pf_fabs, pf_sin, pf_cos, pf_sqrt, pf_changeyaw, pf_changepitch } from "./builtins_math2";
export {
  pf_spawn, pf_remove, pf_find, pf_findradius, pf_nextent,
  initEntState, setNumEdicts, getNumEdicts, setMaxClients, setServerTime, markFree, getFreetime,
} from "./builtins_edict";
export { pf_walkmove, pf_checkbottom, pf_movetogoal } from "./builtins_move";
// The frame driver — advances the whole sim one server frame (SV_Physics + RunThink).
export { setMaxVelocity, setGravityCvar, setGravityFieldIdx, getSvTime, runThink, physicsFrame, serverFrame } from "./svframe";
export { initPusherState, pusherSetWorldHullRange, pushMove, physicsPusher } from "./svpusher";
export { pf_setmodel, initModelPrecache, registerModelPrecache, getRegisteredCount } from "./builtins_model";
// PVS / checkclient — initPvs + pvs*Ptr buffers filled JS-side (wasmServer.loadMap);
// checkclient dispatched by host.ts (#17).
export { initPvs, pvsNodePlanePtr, pvsNodeChildPtr, pvsVisdataPtr, pvsLeafVisofsPtr, checkclient,
  initLeafnums, leafnumsPtr, leafnumsStride, refreshLeafs,
  setCheckClientState, getLastCheck, getLastCheckTime } from "./pvs";
// The player. svclient keeps its OWN maxvelocity/gravity globals — svframe's
// identically-named setters write svframe's copies only, so these must be exported
// and fed SEPARATELY or the player silently runs on vanilla defaults (per-entity
// .gravity and sv_gravity/sv_maxvelocity changes ignored).
export {
  setMaxSpeed, setAccelerateCvar, setFrictionCvar, setEdgeFrictionCvar, setStopSpeedCvar,
  setNoStep, setRollAngle, setRollSpeed, setUserCmd, setClientActive, physicsClient,
  setMaxVelocity as setClientMaxVelocity,
  setGravityCvar as setClientGravityCvar,
  setGravityFieldIdx as setClientGravityFieldIdx,
} from "./svclient";
