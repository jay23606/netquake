// WASM-sim server backend (default; `sv_wasm 0` / -nowasm falls back to sv.physics()).
// Runs the server physics frame via the bit-exact AssemblyScript sim (wasm-sim/).
//
// The WASM sim owns the simulation state in its own linear memory; each frame we
// marshal the JS globals + edict fields into it, drive serverFrame, and marshal the
// results back so the rest of the engine (networking, rendering) sees them. The host
// "syscalls" (print/sound/msg/cvar/precache/changelevel/random) bridge to the engine.
// Load-time builtins (precache/makestatic/ambientsound) run through the JS path during
// spawnServer before this backend activates, so they stay noop here.

import * as sv from '../../../engine/sv';
import * as pr from '../../../engine/pr';
import * as host from '../../../engine/host';
import * as cvar from '../../../engine/cvar';
import * as con from '../../../engine/console';
import * as com from '../../../engine/com';
import * as def from '../../../engine/def';
import * as msg from '../../../engine/msg';
import * as protocol from '../../../engine/protocol';
import * as cmd from '../../../engine/cmd';
import * as loc from '../../../engine/loc';
import * as pf from '../../../engine/pf';
import * as pfStrings from '../../../engine/pf_strings';
import { trackEvent } from '../../../shared/errorReporting';

// One sim_backend activation event per session (wasm success / load-fail), so the Swetrix
// numbers read as sessions, not map loads. Mid-game runtime-trap events are NOT gated.
let simBackendReported = false;

let x: any = null;                 // sim.wasm exports
let mem: () => ArrayBuffer = () => new ArrayBuffer(0);
let ready = false;
let startFrameFn = 0;
let entityFields = 0;
let globalsView: Int32Array | null = null;   // over the wasm GLOBALS region
let edictsView: Int32Array | null = null;    // over the wasm edict block
let viewBuf: ArrayBuffer | null = null;       // buffer the views were built over
let lastTrapCode = -1;                         // last QC VM runError code (for trap diagnostics)
let prevOrigins: Float32Array | null = null;   // per-edict last origin, to re-link only movers (see frame())
let prevModelindex: Float32Array | null = null; // per-edict last modelindex, to refresh leafnums on setmodel (a dormant->modeled entity, e.g. Chthon's boss_awake, changes model without moving)
let siView: Uint8Array | null = null;          // over the sim's per-edict sendinterval bytes (QSS-M U_LERPFINISH timing)
let leafnumsView: Int32Array | null = null;    // over the wasm per-edict leafnums buffer (pvs.ts), read zero-copy by sv.writeEntitiesToClient; null when the map has no render BSP (fall back to JS leafnums)
let leafnumsStride = 0;                          // i32 per edict in the leafnums buffer (1 + MAX_ENT_LEAFS)
let syncedStringLen = 0;                       // string-heap high-water mark agreed by both bump allocators (see the string-heap bridge)
let stringHeapFull = false;                    // string-heap capacity warning latch (once per map, not per frame)

export const isReady = () => ready;

// memory.grow DETACHES the old ArrayBuffer (views go stale); offsets survive, so
// rebuild views over the current buffer. No-op when unchanged => no per-frame alloc.
function ensureViews() {
  const b = mem();
  if (b === viewBuf) return;
  globalsView = new Int32Array(b, x.globalsPtr(), pr.state.globals_int.length);
  edictsView = new Int32Array(b, x.edictsBase(), def.max_edicts * entityFields);
  siView = new Uint8Array(b, x.sendIntervalPtr(), def.max_edicts);
  // Per-edict leafnums, published to sv for zero-copy reads; stride 0 = no render BSP.
  if (leafnumsStride > 0) {
    leafnumsView = new Int32Array(b, x.leafnumsPtr(), def.max_edicts * leafnumsStride);
    sv.state.wasmLeafnums = leafnumsView;
    sv.state.wasmLeafStride = leafnumsStride;
  } else {
    leafnumsView = null;
    sv.state.wasmLeafnums = null;
  }
  viewBuf = b;
}

// App-registered activator; serverFrame calls it once per map when sv_wasm=1.
let activationEpoch = 0;
// Failure latch: the activation guard re-fires EVERY FRAME, so an unlatched load
// failure = infinite retry (console line + sim.wasm fetch per frame). Latched per
// worldmodel: the next map retries once.
let failedWorldmodel: any = null;
export function activate() {
  if (failedWorldmodel != null && failedWorldmodel === sv.state.server.worldmodel) return;
  const epoch = ++activationEpoch;   // a newer spawnServer -> activate() supersedes this load
  host.state.wasmActivating = true;
  loadMap()
    .then(() => {
      if (epoch !== activationEpoch) return;   // map changed mid-load; don't install a stale backend
      host.state.wasmServer = { frame, isReady: () => ready };
      host.state.wasmActivating = false;
      // Success is the DENOMINATOR for the fallback rate — fire it once per session, not per map.
      if (!simBackendReported) { simBackendReported = true; trackEvent('sim_backend', { mode: 'wasm' }); }
    })
    .catch((e) => {
      if (epoch !== activationEpoch) return;
      // Load failed — fall back to the JS server (wasmServer null => sv.physics).
      con.print('[sv_wasm] WASM sim unavailable (' + (e && e.message) + ') — using the JavaScript server.\n');
      ready = false; host.state.wasmServer = null; host.state.wasmActivating = false;
      failedWorldmodel = sv.state.server.worldmodel;   // latch — see note above activate()
      if (!simBackendReported) { simBackendReported = true; trackEvent('sim_backend', { mode: 'js', reason: 'load-failed', detail: (e && e.message) || String(e) }); }
    });
}

// --- host "syscall" bridge --------------------------------------------------------
function readWasmString(ofs: number): string {
  // QC string values are offsets into the wasm STRING heap, NOT absolute
  // addresses; readStringToScratch resolves heap-side into SCRATCH.
  const len = x.readStringToScratch(ofs, x.maxScratch());
  const u8 = new Uint8Array(mem(), x.scratchPtr(), len);
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(u8[i]);
  return s;
}
// pf.ts varString(first). MUST read via the WASM string heap, not pr.getString —
// args can be WASM temp strings whose offsets are garbage in the JS heap.
// OFS_PARM0=4, PARMs 3 apart.
function wasmVarString(first: number): string {
  ensureViews();
  const argc = x.getArgc();
  let s = '';
  for (let i = first; i < argc; i++) s += readWasmString(globalsView![4 + i * 3]);
  return s;
}
// Per ext builtin (pf.ebfs_builtins name), the first arg index from which every arg is a QC string.
const EXT_STRING_ARG_FIRST: Record<string, number> = {
  ex_bprint: 0, ex_sprint: 1, ex_centerprint: 1, ex_localsound: 1,
};
const EXT_STAGE_BYTES = 1024;        // per-arg staging block; > the sim's 512-byte temp slot
let extStageOfs: number[] = [];      // JS-heap staging blocks, one per arg slot, per map
const stagedSlots: number[] = [], stagedVals: number[] = [];   // arg globals stageExtStringArgs rewrote

// Copy each string arg through the WASM reader into a JS-heap block and repoint the arg at it,
// so the JS builtin impls can pr.getString them. syncStringsOut mirrors only the persistent
// region, so an ftos'd arg (rewritten in place in the sim's temp slot, or in its temp ring above
// the JS heap) would otherwise read EMPTY. restoreExtStringArgs puts the sim's offsets back
// before the globals are copied home.
function stageExtStringArgs(name: string) {
  stagedSlots.length = 0; stagedVals.length = 0;
  if (!(name in EXT_STRING_ARG_FIRST)) return;
  const first = EXT_STRING_ARG_FIRST[name];
  const argc = (pr.state as any).argc;
  const heap: any = pr.state.strings;
  for (let i = first; i < argc && i < 8; i++) {
    const slot = 4 + i * 3;
    const ofs = globalsView![slot];
    // readStringLen has no negative bound, so a negative offset would walk off the heap start.
    const s = ofs >= 0 ? readWasmString(ofs) : '';
    if (s.length >= EXT_STAGE_BYTES) continue;   // too long for a block — leave the mirrored offset
    if (extStageOfs[i] === undefined) extStageOfs[i] = pr.newString('', EXT_STAGE_BYTES);
    const base = extStageOfs[i];
    for (let j = 0; j < s.length; j++) heap[base + j] = s.charCodeAt(j) & 0xff;
    heap[base + s.length] = 0;
    stagedSlots.push(slot); stagedVals.push(pr.state.globals_int[slot]);
    pr.state.globals_int[slot] = base;
  }
}
function restoreExtStringArgs() {
  for (let i = 0; i < stagedSlots.length; i++) pr.state.globals_int[stagedSlots[i]] = stagedVals[i];
}
function writeAscii(str: string, outPtr: number): number {
  const u8 = new Uint8Array(mem(), outPtr, str.length);
  for (let i = 0; i < str.length; i++) u8[i] = str.charCodeAt(i) & 0xff;
  return str.length;
}
// pf.ts writeDest(): the WASM side pre-resolves PARM0 float>>0 to this dest code.
function writeDest(dest: number, clientEnt: number): any {
  const s = sv.state.server;
  switch (dest) {
    case 0: return s.datagram;                                    // broadcast
    case 1:                                                        // one (msg_entity)
      if (clientEnt <= 0 || clientEnt > sv.state.svs.maxclients) return s.datagram;
      return sv.state.svs.clients[clientEnt - 1].message;
    case 2: return s.reliable_datagram;                           // all
    case 3: return s.signon;                                      // init
  }
  return s.datagram;
}
function hostImports() {
  const noop = () => {};
  return {
    env: { abort: (_m: any, _f: any, l: any, c: any) => { throw new Error('sim.wasm abort @' + l + ':' + c); } },
    vm: {
      isServerLoading: () => (sv.state.server.phase === 'loading' ? 1 : 0),
      // MUST NOT throw: a throw fires before the VM sets its `trapped` flag
      // (wasTrapped would miss it) and unwinds the server loop uncaught.
      hostError: (code: number) => { lastTrapCode = code; console.warn('[sv_wasm] QC VM runError code ' + code); con.print('[sv_wasm] QC VM runError (code ' + code + ')\n'); },
    },
    strings: {
      host_tostring: (v: number, p: number) => writeAscii(String(v), p),
      host_tofixed1: (v: number, p: number) => writeAscii(Number(v).toFixed(1), p),
    },
    host: {
      // pf.ts print levels: 0=dprint, 1=bprint, 2=sprint, 3=centerprint, 4=break. ent = PARM0.
      host_print: (level: number, ent: number, _strOfs: number) => {
        if (level === 0) { con.dPrint(wasmVarString(0)); return; }        // dprint
        if (level === 4) { con.print('break statement\n'); return; }      // break
        if (level === 1) { host.broadcastPrint(loc.getString(wasmVarString(0))); return; } // bprint
        // sprint(2) / centerprint(3): PARM0 is the client entnum.
        if (ent <= 0 || ent > sv.state.svs.maxclients) { con.print('tried to sprint to a non-client\n'); return; }
        const client: any = sv.state.svs.clients[ent - 1];
        msg.writeByte(client.message, level === 3 ? protocol.SVC.centerprint : protocol.SVC.print);
        msg.writeString(client.message, loc.getString(wasmVarString(1)));
      },
      host_error: (_kind: number, _ent: number, strOfs: number) => con.print('WASM QC error: ' + readWasmString(strOfs) + '\n'),
      // Output builtins -> the engine's sv-side writers (load-time ones stay noop; see header).
      host_sound: (ent: number, chan: number, sampStrOfs: number, vol: number, attn: number) => {
        // Fires mid-serverFrame: a just-spawned entity may have no JS edict yet — skip.
        const ed = sv.state.server.edicts[ent];
        if (ed != null) sv.startSound(ed, chan, readWasmString(sampStrOfs), vol, attn);
      },
      host_particle: (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, color: number, count: number) =>
        sv.startParticle([ox, oy, oz], [dx, dy, dz], color, count),
      host_lightstyle: (style: number, strOfs: number) => {
        const val = readWasmString(strOfs);
        sv.state.server.lightstyles[style] = val;
        if (sv.state.server.phase === 'loading') return;
        for (let i = 0; i < sv.state.svs.maxclients; i++) {
          const c: any = sv.state.svs.clients[i];
          if (c.active !== true && c.spawned !== true) continue;
          msg.writeByte(c.message, protocol.SVC.lightstyle);
          msg.writeByte(c.message, style);
          msg.writeString(c.message, val);
        }
      },
      host_ambientsound: noop, host_makestatic: noop,
      host_msg_write: (kind: number, dest: number, clientEnt: number, value: number) => {
        const buf = writeDest(dest, clientEnt);
        const pf = sv.state.server.protocolFlags;
        switch (kind) {
          case 0: msg.writeByte(buf, value); return;   // WRITE_BYTE
          case 1: msg.writeChar(buf, value); return;   // WRITE_CHAR
          case 2: msg.writeShort(buf, value); return;  // WRITE_SHORT
          case 3: msg.writeLong(buf, value); return;   // WRITE_LONG
          case 4: msg.writeCoord(buf, value, pf); return;   // WRITE_COORD
          case 5: msg.writeAngle(buf, value, pf); return;   // WRITE_ANGLE
        }
      },
      host_msg_write_string: (dest: number, clientEnt: number, strOfs: number) =>
        msg.writeString(writeDest(dest, clientEnt), loc.getString(readWasmString(strOfs))),
      host_msg_write_entity: (dest: number, clientEnt: number, entValue: number) =>
        msg.writeShort(writeDest(dest, clientEnt), entValue),
      // Varargs (FTE PF_stuffcmd): join PARM1.. through the WASM reader, since ftos'd args live
      // in the sim's temp slot/ring that the JS heap never mirrors.
      host_stuffcmd: (ent: number, _strOfs: number) => {
        if (ent <= 0 || ent > sv.state.svs.maxclients) return;
        const c = sv.state.svs.clients[ent - 1];
        msg.writeByte(c.message, protocol.SVC.stufftext);
        msg.writeString(c.message, wasmVarString(1));
      },
      host_localcmd: (strOfs: number) => { cmd.state.text += readWasmString(strOfs); },
      host_cvar_get: (strOfs: number) => { const v = cvar.findVar(readWasmString(strOfs)); return v ? v.value : 0.0; },
      host_cvar_set: (nameOfs: number, valOfs: number) => cvar.set(readWasmString(nameOfs), readWasmString(valOfs)),
      host_precache: noop,
      // changelevel is RUNTIME (trigger touch), not load-time — must queue the
      // console command or the map never advances.
      host_changelevel: (strOfs: number) => {
        if (sv.state.svs.changelevel_issued === true) return;
        sv.state.svs.changelevel_issued = true;
        cmd.state.text += 'changelevel ' + readWasmString(strOfs) + '\n';
      },
      host_random: () => Math.random(),   // TODO: match the engine's PF_random rng for bit-parity
      host_pow: Math.pow,                 // transcendental parity (see builtins_math host_sin note)
      host_unimplemented: noop,           // setmodel etc. are handled in-wasm now; leftover fixme slots no-op
      // Extension builtins bridge: sync engine-reserved globals + argc WASM->JS,
      // call the JS pf impl (side effects are JS-side), sync the return back.
      host_extbuiltin: (n: number) => {
        ensureViews();
        // MID-FRAME boundary, both ways: the JS impls below pr.getString their args
        // (so sim-side strzone results must be visible first) and several of them
        // pr.newString their result (so the JS heap grows while the sim is mid-call,
        // and the sim's next alloc would otherwise reuse those offsets).
        syncStringsOut();
        const K = 90;   // engine-reserved globals (RETURN + PARMs + self/other/trace/v_forward/msg_entity)
        pr.state.globals_int.set(globalsView!.subarray(0, K));
        (pr.state as any).argc = x.getArgc();
        let strResult = false;
        switch (n) {
          case 335: pf.particleeffectnum(); break;
          case 336: pf.trailparticles(); break;
          case 337: pf.pointparticles(); break;
          case 409: pf.te_particlerain(); break;
          case 410: pf.te_particlesnow(); break;
          case 438: pf.getsurfacenearpoint(); break;
          case 437: pf.getsurfacetexture(); strResult = true; break;
          case 401: pf.setcolors(); break;
          case 117: pf.stov(); break;   // vector return (generic sync)
          case 225: pf.strpad(); strResult = true; break;
          case 224: pfStrings.strconv(); strResult = true; break;
          case 226: pfStrings.infoadd(); strResult = true; break;
          case 227: pfStrings.infoget(); strResult = true; break;
          case 78: pf.setspawnparms(); break;   // void
          case 99: pf.checkextension(); break;  // float/int (generic sync)
          case 110: pf.fopen(); break;          // float handle
          case 111: pf.fclose(); break;         // void
          case 113: pf.fputs(); break;          // void
          case 80: pf.infokey(); strResult = true; break;
          case 112: pf.fgets(); strResult = true; break;
          default: {
            // Rerelease "= #0" builtins, numbered by pr.loadProgs. None return a string.
            const ext: any = pf.ebfs_builtins.find((b: any) => b.fnNbr === n);
            if (ext != null) {
              stageExtStringArgs(ext.name || '');
              ext.fn();
              restoreExtStringArgs();
            }
            break;
          }
        }
        globalsView!.set(pr.state.globals_int.subarray(0, K));
        if (strResult) {
          // The two string heaps don't share offsets: copy the JS result into the
          // WASM heap and point RETURN there.
          const js = pr.getString(pr.state.globals_int[1]);
          const sc = new Uint8Array(mem(), x.scratchPtr(), js.length);
          for (let i = 0; i < js.length; i++) sc[i] = js.charCodeAt(i) & 0xff;
          globalsView![1] = x.tempStringFromScratch(js.length);
        }
        // ...and hand the sim whatever those impls appended (must run AFTER the
        // strResult copy above — both stage through SCRATCH).
        syncStringsIn();
      },
    },
    // Host-bridged transcendentals: AS's Math can differ from V8's by 1 f64 ulp,
    // enough to cross an f32 store boundary and fork the sims.
    builtins_move: { host_random: () => Math.random(), host_sin: Math.sin, host_cos: Math.cos },
    builtins_math: { host_sin: Math.sin, host_cos: Math.cos, host_atan2: Math.atan2 },
    builtins_math2: { host_sin: Math.sin, host_cos: Math.cos },
    svpusher: { host_sin: Math.sin, host_cos: Math.cos },
    svclient: { host_sin: Math.sin, host_cos: Math.cos },
    // QSS-M SV_CheckWaterTransition splash — cvar-gated (empty string = off);
    // same just-spawned-index guard as host_sound.
    svphysics: {
      host_watersplash: (ent: number) => {
        const snd = sv.cvr.sound_watersplash;
        const ed = sv.state.server.edicts[ent];
        if (ed != null && snd != null && snd.string.length !== 0) sv.startSound(ed, 0, snd.string, 255, 1.0);
      },
      // QSS-M SV_Physics_Step land sound — same gate + just-spawned-index guard.
      host_hitsound: (ent: number) => {
        const snd = sv.cvr.sound_land;
        const ed = sv.state.server.edicts[ent];
        if (ed != null && snd != null && snd.string.length !== 0) sv.startSound(ed, 0, snd.string, 255, 1.0);
      },
    },
  };
}

// --- lifecycle --------------------------------------------------------------------
let wasmModule: WebAssembly.Module | null = null;   // compiled once; instantiated per map

// FRESH sim instance on EVERY map load: AS heap.alloc is a bump allocator with no
// free, so re-init on one instance orphans the prior map's blocks and grows the
// heap each map change. Module is cached — instantiate-only per map.
export async function init() {
  if (wasmModule == null) {
    // Cache-bust: a plain reload would serve stale browser-cached sim.wasm bytes.
    const bytes = await fetch(`${import.meta.env.BASE_URL}wasm-sim/sim.wasm?t=${Date.now()}`, { cache: 'no-store' }).then((r) => r.arrayBuffer());
    wasmModule = await WebAssembly.compile(bytes);
  }
  const inst = await WebAssembly.instantiate(wasmModule, hostImports());
  x = (inst as WebAssembly.Instance).exports;
  mem = () => x.memory.buffer;
  viewBuf = null;   // marshal views must rebuild over the new instance's memory
  ready = false;
}

// Called after spawnServer has built the map (entities loaded). Loads progs + the
// world/bmodel hulls into the WASM sim and marshals the initial state.
export async function loadMap() {
  await init();   // fresh instance per map load — see init() (frees the prior map's heap)
  const s = sv.state.server;
  const wm: any = s.worldmodel;
  entityFields = s.edicts[0].v_int.length;

  // progs.dat -> the VM (statements/functions/globals/strings/edict field block).
  const progsBytes = new Uint8Array((await com.loadFile('progs.dat')) as ArrayBuffer);
  loadProgsIntoWasm(progsBytes);
  x.initStringTemp();   // ftos/vtos temp-string slot (pr.ts string_temp)
  // Overlay the FULL JS string heap: loadProgsIntoWasm loads only the static progs
  // string block, so map-entity strings (targetname/target/...) read EMPTY in the
  // WASM and fork QC find()/target matching (a killtarget find() once removed the
  // player). The JS heap supersets the progs block, so overwriting is safe;
  // heapTop tracks the JS length for new-string allocs.
  {
    const jsStrHeap: any = pr.state.strings;
    const sc = new Uint8Array(mem(), x.scratchPtr(), jsStrHeap.length);
    for (let i = 0; i < jsStrHeap.length; i++) sc[i] = jsStrHeap[i] & 0xff;
    x.loadStringBlock(jsStrHeap.length);
    // Both allocators now agree here; syncStringsIn/Out keep them agreeing.
    syncedStringLen = jsStrHeap.length;
    stringHeapFull = false;
    extStageOfs = [];   // pr.loadProgs rebuilt the JS heap — the old blocks are gone
  }
  startFrameFn = pr.state.globals_int[pr.globalvars.StartFrame];

  // world model: 3 clip hulls (shared clipnode/plane pools per BSP).
  installWorldHulls(wm);
  // bmodel submodels (movers) -> per-model hull table + precache bbox registry.
  installBmodelHulls();
  // Pusher (mover) collision tests riders against the world hull0 clipnode range.
  x.pusherSetWorldHullRange(wm.hulls[0].firstclipnode, wm.hulls[0].lastclipnode);

  // area tree + entity state, then marshal the spawned entities in.
  const worldMins = wm.mins || [-4096, -4096, -4096], worldMaxs = wm.maxs || [4096, 4096, 4096];
  x.initAreaTree(worldMins[0], worldMins[1], worldMins[2], worldMaxs[0], worldMaxs[1], worldMaxs[2], def.max_edicts);
  // Pusher setup is load-bearing: without it movedEdictsBase stays 0 and every
  // MOVETYPE_PUSH entity writes rider-revert scratch to WASM address 0.
  x.initPusherState(def.max_edicts);
  x.initEntState(sv.state.svs.maxclients, s.num_edicts);
  // QSS-M's qcvm->brokenbouncemissile + ->rotatingbmodel. Per map, since the progs decide it.
  x.setRerelease(pr.state.rerelease ? 1 : 0);
  x.setMaxVelocity(cvar.findVar('sv_maxvelocity')?.value ?? 2000);
  x.setGravityCvar(cvar.findVar('sv_gravity')?.value ?? 800);
  // Per-entity gravity: progs-resolved .gravity field index, or -1 when the progs
  // defines none (id1). Hardcoding -1 breaks mods that use it (progs_dump/AD).
  x.setGravityFieldIdx(pr.entvars.gravity != null ? pr.entvars.gravity : -1);
  // svclient owns a SEPARATE copy of all three; without these the player alone
  // ignored .gravity (AD's low-gravity wormhole diverged from the JS server).
  x.setClientMaxVelocity(cvar.findVar('sv_maxvelocity')?.value ?? 2000);
  x.setClientGravityCvar(cvar.findVar('sv_gravity')?.value ?? 800);
  x.setClientGravityFieldIdx(pr.entvars.gravity != null ? pr.entvars.gravity : -1);
  // QSS-M reads these cvars live at each use, so they're RE-PUSHED EVERY FRAME —
  // a mid-map change must apply immediately. Handles cached here (findVar is a
  // linear scan, no place in the frame loop).
  cvarHandles = {
    maxvelocity: cvar.findVar('sv_maxvelocity'), gravity: cvar.findVar('sv_gravity'),
    maxspeed: cvar.findVar('sv_maxspeed'), accelerate: cvar.findVar('sv_accelerate'),
    friction: cvar.findVar('sv_friction'), edgefriction: cvar.findVar('edgefriction'),
    stopspeed: cvar.findVar('sv_stopspeed'), nostep: cvar.findVar('sv_nostep'),
    rollangle: cvar.findVar('cl_rollangle'), rollspeed: cvar.findVar('cl_rollspeed'),
    aim: cvar.findVar('sv_aim'), teamplay: cvar.findVar('teamplay'),
  };
  pushLiveCvars();

  // PVS render-BSP for checkclient (pvs.ts) — the DRAW BSP, separate from the
  // collision clip-BSP above.
  leafnumsStride = 0;   // set below only when the map has a render BSP (else JS leafnums)
  if (wm.nodePacked != null && wm.leafVisofs != null) {
    const npf = wm.nodePacked, npi = wm.nodePackedI32, visdata = wm.visdata || null, leafVisofs = wm.leafVisofs;
    const nodeCount = (npf.length / 16) | 0, rowBytes = (leafVisofs.length + 7) >> 3;
    x.initPvs(nodeCount, leafVisofs.length, visdata ? visdata.length : 0, rowBytes);
    // MUST alloc here — after initPvs, BEFORE the write-views below — so it's the
    // last heap.alloc and the views are over the now-final linear memory.
    x.initLeafnums(def.max_edicts);
    leafnumsStride = x.leafnumsStride();
    const planeView = new Float32Array(mem(), x.pvsNodePlanePtr(), nodeCount * 4);
    const childView = new Int32Array(mem(), x.pvsNodeChildPtr(), nodeCount * 2);
    for (let i = 0; i < nodeCount; i++) {
      const b = i * 16;
      planeView[i * 4] = npf[b + 6]; planeView[i * 4 + 1] = npf[b + 7]; planeView[i * 4 + 2] = npf[b + 8]; planeView[i * 4 + 3] = npf[b + 9];
      childView[i * 2] = npi[b + 13]; childView[i * 2 + 1] = npi[b + 14];
    }
    if (visdata) new Uint8Array(mem(), x.pvsVisdataPtr(), visdata.length).set(visdata);
    new Int32Array(mem(), x.pvsLeafVisofsPtr(), leafVisofs.length).set(leafVisofs);
  }

  viewBuf = null;
  ensureViews();
  seedStateToWasm();
  for (let e = 0; e < s.num_edicts; e++) x.setEdictFree(e, s.edicts[e].free ? 1 : 0);
  // Link every in-use entity into the WASM area tree: seeding copies fields but
  // NOT area links, so without this SV_Move finds nothing to clip against. Must
  // run after fields + free flags are set (linkEdict reads them). Movers re-link
  // themselves each frame; this seeds the statics.
  for (let e = 1; e < s.num_edicts; e++) if (s.edicts[e].free !== true) x.linkEdict(e);
  // Seed leafnums for statics: the buffer starts zeroed (count 0) and frame()
  // only refreshes movers — unseeded statics would be PVS-culled.
  if (leafnumsStride > 0)
    for (let e = 1; e < s.num_edicts; e++) if (s.edicts[e].free !== true) x.refreshLeafs(e);
  // Point every JS edict at its slice of the sim's memory: from here the JS
  // server and the sim share ONE copy of edict fields.
  repointEdicts(0, s.num_edicts);
  // Seed last-known origins so frame()'s re-link runs only for movers; NaN for
  // not-yet-seen slots forces a link on first appearance.
  prevOrigins = new Float32Array(def.max_edicts * 3).fill(NaN);
  prevModelindex = new Float32Array(def.max_edicts).fill(NaN);
  for (let e = 0; e < s.num_edicts; e++) {
    const vf = s.edicts[e].v_float;
    prevOrigins[e * 3] = vf[pr.entvars.origin]; prevOrigins[e * 3 + 1] = vf[pr.entvars.origin + 1]; prevOrigins[e * 3 + 2] = vf[pr.entvars.origin + 2];
    prevModelindex[e] = vf[pr.entvars.modelindex];
  }
  // EMPTY the JS area tree — the sim owns collision. Stale spawn-time links under
  // sim-side free/slot-reuse can land a trigger in the solid chain -> "Trigger in
  // clipping list" Sys_Error in setIdealPitch (AD frees+reuses within one frame,
  // so unlink-on-free can't catch it). Unlinking keeps leafnums intact;
  // disableBackend relinks for the JS fallback.
  for (let e = 1; e < s.num_edicts; e++) { const ed = s.edicts[e]; if (ed && ed.free !== true) sv.unlinkEdict(ed); }
  ready = true;
  con.print('[sv_wasm] WASM server backend loaded (' + s.num_edicts + ' edicts)\n');
}

function loadProgsIntoWasm(bytes: Uint8Array) {
  // dprograms_t header + lumps (mirrors wasm-sim/harness/progsLoader.mjs).
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const L = (i: number) => ({ ofs: dv.getUint32(8 + i * 8, true), num: dv.getUint32(12 + i * 8, true) });
  const [st, , , fn, str, gl] = [0, 1, 2, 3, 4, 5].map(L);
  const entityfields = dv.getUint32(8 + 6 * 8, true);
  x.setNumFunctions(fn.num);
  x.setEdictSize(96 + entityfields * 4);
  x.initEdicts(def.max_edicts, entityfields);
  // op AND a/b/c are UNSIGNED 16-bit; the VM sign-extends only jump offsets at
  // the use site. Signed reads corrupt operand indices >= 32768 (progs_dump/AD).
  for (let i = 0; i < st.num; i++) { const o = st.ofs + i * 8; x.installStatement(i, dv.getUint16(o, true), dv.getUint16(o + 2, true), dv.getUint16(o + 4, true), dv.getUint16(o + 6, true)); }
  // first_statement comes from pr.state.functions, not the file: loadProgs bound the rerelease
  // "= #0" builtins by name there. The file value is 0, which the VM enters as QC code.
  const prFns: any[] = pr.state.functions as any;
  const patched = prFns != null && prFns.length === fn.num;
  if (!patched)
    con.print('[sv_wasm] progs function count mismatch (pr ' + (prFns != null ? prFns.length : -1) + ' vs file ' + fn.num +
      ') — installing raw entry points; rerelease ex_* builtins will not bind.\n');
  for (let i = 0; i < fn.num; i++) { const o = fn.ofs + i * 36; x.installFunction(i, patched ? prFns[i].first_statement : dv.getInt32(o, true), dv.getInt32(o + 4, true), dv.getInt32(o + 8, true), dv.getInt32(o + 24, true), bytes[o + 28], bytes[o + 29], bytes[o + 30], bytes[o + 31], bytes[o + 32], bytes[o + 33], bytes[o + 34], bytes[o + 35]); }
  for (let i = 0; i < gl.num; i++) x.writeGlobalInt(i, dv.getInt32(gl.ofs + i * 4, true));
  const u8 = new Uint8Array(mem(), x.scratchPtr(), str.num);
  for (let i = 0; i < str.num; i++) u8[i] = bytes[str.ofs + i];
  x.loadStringBlock(str.num);
}

function hullMeta(h: any) { return { first: h.firstclipnode, last: h.lastclipnode, cm: h.clip_mins }; }
// Cvar handles cached at activation, re-pushed every frame (QSS-M reads live).
let cvarHandles: Record<string, any> = {};
function pushLiveCvars() {
  const h = cvarHandles;
  x.setMaxVelocity(h.maxvelocity?.value ?? 2000);        // svframe's copy (toss/step)
  x.setGravityCvar(h.gravity?.value ?? 800);
  x.setClientMaxVelocity(h.maxvelocity?.value ?? 2000);  // svclient's own copy (see 5769eb9)
  x.setClientGravityCvar(h.gravity?.value ?? 800);
  x.setMaxSpeed(h.maxspeed?.value ?? 320);
  x.setAccelerateCvar(h.accelerate?.value ?? 10);
  x.setFrictionCvar(h.friction?.value ?? 4);
  x.setEdgeFrictionCvar(h.edgefriction?.value ?? 2);
  x.setStopSpeedCvar(h.stopspeed?.value ?? 100);
  x.setNoStep(h.nostep?.value ?? 0);
  x.setRollAngle(h.rollangle?.value ?? 2);
  x.setRollSpeed(h.rollspeed?.value ?? 200);
  x.setAimCvar(h.aim?.value ?? 0.93);
  x.setTeamplayCvar(h.teamplay?.value ?? 0);
}
// Rebased hull ranges for EXTERNAL .bsp models — see installWorldHulls' external-model pass.
// modelindex -> per-hull {first,last} into the shared pools. Empty for maps without any.
const externalHullRanges = new Map<number, ({ first: number, last: number } | undefined)[]>();
function installWorldHulls(wm: any) {
  // Size the WASM clipnode/plane pools to this map's BSP (no fixed cap).
  let nClip = 0;
  for (const hid of [0, 1, 2]) { const h = wm.hulls[hid]; if (h && h.lastclipnode + 1 > nClip) nClip = h.lastclipnode + 1; }
  // EXTERNAL .bsp models (AD breakables/decorations) are separate BSPs: their
  // clipnodes/planes are their OWN 0-based arrays, NOT offsets into the world's
  // lumps. They're appended to the shared pools below — reserve room here.
  const allModels: any[] = (sv.state.server as any).models || [];
  const seenPlanes = new Set<any>(), seenClip0 = new Set<any>(), seenClip12 = new Set<any>();
  let extraPlanes = 0, extraClip0 = 0, extraClip12 = 0;
  for (const m of allModels) {
    if (m == null || m.hulls == null) continue;
    if (m.planes != null && m.planes !== wm.planes && !seenPlanes.has(m.planes)) { seenPlanes.add(m.planes); extraPlanes += m.planes.length; }
    const a0 = m.hulls[0] != null ? m.hulls[0].clipnodes : null;
    if (a0 != null && a0 !== wm.hulls[0].clipnodes && !seenClip0.has(a0)) { seenClip0.add(a0); extraClip0 += a0.length; }
    for (const hid of [1, 2]) {
      const a = m.hulls[hid] != null ? m.hulls[hid].clipnodes : null;
      if (a != null && a !== wm.hulls[1].clipnodes && !seenClip12.has(a)) { seenClip12.add(a); extraClip12 += a.length; }
    }
  }
  nClip = Math.max(nClip + extraClip0, wm.hulls[1].clipnodes.length + extraClip12);
  x.initHullStorage(nClip, wm.planes.length + extraPlanes);
  // BULK marshal via typed-array views, not per-element boundary calls (~5.6M on
  // immortal froze the main thread >45s). initHullStorage was the last alloc, so
  // this buffer snapshot is stable across the writes below.
  const buf = mem();
  {
    const np = wm.planes.length;
    const nx = new Float64Array(buf, x.planeNXPtr(), np), ny = new Float64Array(buf, x.planeNYPtr(), np), nz = new Float64Array(buf, x.planeNZPtr(), np);
    const nd = new Float64Array(buf, x.planeDistPtr(), np), nt = new Int32Array(buf, x.planeTypePtr(), np);
    for (let i = 0; i < np; i++) { const p = wm.planes[i], n = p.normal; nx[i] = n[0]; ny[i] = n[1]; nz[i] = n[2]; nd[i] = p.dist; nt[i] = p.type; }
  }
  const h0 = wm.hulls[0];
  {
    const cn = h0.clipnodes;
    const cp = new Int32Array(buf, x.clipPlanePtr(), nClip), c0 = new Int32Array(buf, x.clipChild0Ptr(), nClip), c1 = new Int32Array(buf, x.clipChild1Ptr(), nClip);
    for (let i = h0.firstclipnode; i <= h0.lastclipnode; i++) { const c = cn[i]; cp[i] = c.planenum; c0[i] = c.children[0]; c1[i] = c.children[1]; }
  }
  x.setHullMeta(h0.firstclipnode, h0.lastclipnode);
  {
    // Hull 1 and 2 share ONE clipnode array (wm.hulls[1].clipnodes === hulls[2].clipnodes); write it once.
    const cn = wm.hulls[1].clipnodes, n = cn.length;
    const cp = new Int32Array(buf, x.clip12PlanePtr(), nClip), c0 = new Int32Array(buf, x.clip12Child0Ptr(), nClip), c1 = new Int32Array(buf, x.clip12Child1Ptr(), nClip);
    for (let i = 0; i < n; i++) { const c = cn[i]; cp[i] = c.planenum; c0[i] = c.children[0]; c1[i] = c.children[1]; }
  }
  const m1 = hullMeta(wm.hulls[1]), m2 = hullMeta(wm.hulls[2]);
  x.installHull1(m1.first, m1.last, m1.cm[0], m1.cm[1], m1.cm[2]);
  x.installHull2(m2.first, m2.last, m2.cm[0], m2.cm[1], m2.cm[2]);
  // world = model index 0 in the per-model table (all 3 hulls).
  for (const hid of [0, 1, 2]) { const h = wm.hulls[hid]; x.installModelHull(0, hid, h.firstclipnode, h.lastclipnode, h.clip_mins[0], h.clip_mins[1], h.clip_mins[2]); }

  // --- external .bsp models: append their planes/clipnodes and rebase every index ----------
  // Raw first/last would index the WORLD's geometry and trap the sim on descent.
  // Each array is copied once (models sharing an array share a base); planenum and
  // non-negative children are rebased; negative children are CONTENTS_* leaves,
  // passed through untouched.
  externalHullRanges.clear();
  if (extraPlanes > 0 || extraClip0 > 0 || extraClip12 > 0) {
    const capC = x.maxClipnodes(), capP = x.maxPlanes();
    const pnx = new Float64Array(buf, x.planeNXPtr(), capP), pny = new Float64Array(buf, x.planeNYPtr(), capP);
    const pnz = new Float64Array(buf, x.planeNZPtr(), capP), pdist = new Float64Array(buf, x.planeDistPtr(), capP);
    const ptype = new Int32Array(buf, x.planeTypePtr(), capP);
    const c0p = new Int32Array(buf, x.clipPlanePtr(), capC), c0a = new Int32Array(buf, x.clipChild0Ptr(), capC), c0b = new Int32Array(buf, x.clipChild1Ptr(), capC);
    const c1p = new Int32Array(buf, x.clip12PlanePtr(), capC), c1a = new Int32Array(buf, x.clip12Child0Ptr(), capC), c1b = new Int32Array(buf, x.clip12Child1Ptr(), capC);
    let planeCursor = wm.planes.length, clip0Cursor = h0.lastclipnode + 1, clip12Cursor = wm.hulls[1].clipnodes.length;
    const planeBase = new Map<any, number>(), clip0Base = new Map<any, number>(), clip12Base = new Map<any, number>();
    const copyPlanes = (arr: any[]) => {
      let base = planeBase.get(arr);
      if (base !== undefined) return base;
      base = planeCursor;
      for (let i = 0; i < arr.length; i++) {
        const pl = arr[i], n = pl.normal;
        pnx[base + i] = n[0]; pny[base + i] = n[1]; pnz[base + i] = n[2]; pdist[base + i] = pl.dist; ptype[base + i] = pl.type;
      }
      planeCursor += arr.length; planeBase.set(arr, base); return base;
    };
    const copyClip = (arr: any[], pbase: number, hull0: boolean) => {
      const seen = hull0 ? clip0Base : clip12Base;
      let base = seen.get(arr);
      if (base !== undefined) return base;
      base = hull0 ? clip0Cursor : clip12Cursor;
      const cp = hull0 ? c0p : c1p, ca = hull0 ? c0a : c1a, cb = hull0 ? c0b : c1b;
      for (let i = 0; i < arr.length; i++) {
        const c = arr[i];
        cp[base + i] = c.planenum + pbase;
        ca[base + i] = c.children[0] >= 0 ? c.children[0] + base : c.children[0];
        cb[base + i] = c.children[1] >= 0 ? c.children[1] + base : c.children[1];
      }
      if (hull0) clip0Cursor += arr.length; else clip12Cursor += arr.length;
      seen.set(arr, base); return base;
    };
    for (let mi = 1; mi < allModels.length; mi++) {
      const m = allModels[mi];
      if (m == null || m.hulls == null) continue;
      const ranges: ({ first: number, last: number } | undefined)[] = [];
      let touched = false;
      const pbase = (m.planes != null && m.planes !== wm.planes) ? copyPlanes(m.planes) : 0;
      for (const hid of [0, 1, 2]) {
        const mh = m.hulls[hid];
        if (mh == null || mh.clipnodes == null) continue;
        const isWorldArray = hid === 0 ? mh.clipnodes === wm.hulls[0].clipnodes : mh.clipnodes === wm.hulls[1].clipnodes;
        if (isWorldArray) continue;
        const base = copyClip(mh.clipnodes, pbase, hid === 0);
        ranges[hid] = { first: mh.firstclipnode + base, last: mh.lastclipnode + base };
        touched = true;
      }
      if (touched) externalHullRanges.set(mi, ranges);
    }
  }
}
// Byte offset of a NUL-terminated string in the JS string heap. pf_setmodel
// compares by CONTENT, so any offset with the right bytes works. -1 when absent —
// NEVER 0: offset 0 is the empty string (model_precache[0]), so a 0 sentinel
// aliases it and registerModelPrecache's content-dedup silently collapses the slot.
function findStringOffset(heap: any, name: string): number {
  if (name.length === 0) return 0;
  const n = name.length;
  for (let i = 0; i <= heap.length - n; i++) {
    let ok = true;
    for (let j = 0; j < n; j++) { if (heap[i + j] !== name.charCodeAt(j)) { ok = false; break; } }
    if (ok && (i + n >= heap.length || heap[i + n] === 0)) return i;
  }
  return -1;
}

// Find-or-intern. A miss is NORMAL, not an error: model_precache holds names the
// engine generated (sv.spawnServer's '*N' submodels, the '' at slot 0) that no QC
// string ever held. Interning gives the slot its own unique offset instead of
// dropping it — syncStringsIn pushes the bytes to the sim.
function internStringOffset(heap: any, name: string): number {
  if (name.length === 0) return 0;   // slot 0 of the progs string block IS ""
  const found = findStringOffset(heap, name);
  if (found >= 0) return found;
  con.dPrint('[sv_wasm] precache name "' + name + '" absent from the QC string heap — interning\n');
  return pr.newString(name, name.length + 1);
}

function installBmodelHulls() {
  x.initModelPrecache();
  const models: any[] = (sv.state.server as any).models || [];
  const names: string[] = (sv.state.server as any).model_precache || [];
  const heap: any = pr.state.strings;
  // Resolve every name BEFORE registering: registerModelPrecache dedups by CONTENT
  // read out of the SIM's heap, so interned bytes must be synced across first.
  const nameOfs: number[] = new Array(names.length);
  for (let mi = 0; mi < names.length; mi++) nameOfs[mi] = internStringOffset(heap, names[mi]);
  syncStringsIn();
  // Register EVERY precached model (not just bmodels) so pf_setmodel resolves
  // alias models; precache order keeps registry index == modelindex.
  for (let mi = 0; mi < names.length; mi++) {
    const m = models[mi];
    const mins = m != null && m.mins ? m.mins : [0, 0, 0];
    const maxs = m != null && m.maxs ? m.maxs : [0, 0, 0];
    // The registry index IS the modelindex pf_setmodel writes, and the client
    // resolves it against ITS OWN precache list — so a shift renders a different
    // model entirely (and every model after it). Content-dedup on a duplicate name
    // is the one way they diverge; it must never be silent.
    const slot = x.registerModelPrecache(nameOfs[mi], mins[0], mins[1], mins[2], maxs[0], maxs[1], maxs[2]);
    if (slot !== mi)
      con.print('[sv_wasm] model_precache[' + mi + '] "' + names[mi] + '" took sim registry slot ' + slot +
        ' — duplicate precache name; this model and every later one will resolve WRONG.\n');
    if (m != null && m.hulls != null) {
      // External .bsp models use their REBASED pool ranges (installWorldHulls).
      const ext = externalHullRanges.get(mi);
      for (const hid of [0, 1, 2]) {
        const h = m.hulls[hid]; if (!h) continue;
        const r = ext != null ? ext[hid] : undefined;
        x.installModelHull(mi, hid, r ? r.first : h.firstclipnode, r ? r.last : h.lastclipnode, h.clip_mins[0], h.clip_mins[1], h.clip_mins[2]);
      }
    }
  }
}

// --- string-heap bridge -------------------------------------------------------------
// The JS heap (pr.state.strings) and the sim's heap (assembly/strings.ts) are ONE
// offset space with TWO bump allocators: a QC string value is an offset, and edicts
// (shared zero-copy) + globals carry those offsets across the boundary both ways.
// loadMap seeds the sim with a full copy; after that each side's appends must reach
// the other BEFORE the other side reads OR allocates — unsynced, the same offset
// means different bytes and both allocators hand out the same next offset.
// syncedStringLen (declared with the rest of the module state) is the high-water
// mark the two allocators have agreed on.
//
// JS -> sim. One length compare when nothing was appended, which is every frame in
// the common case; the copy is O(bytes appended), never O(heap).
function syncStringsIn() {
  const heap: any = pr.state.strings;
  const len = heap.length;
  if (len <= syncedStringLen) return;
  if (stringHeapFull) { syncedStringLen = len; return; }
  const add = len - syncedStringLen;
  const sc = new Uint8Array(mem(), x.scratchPtr(), add);
  for (let i = 0; i < add; i++) sc[i] = heap[syncedStringLen + i] & 0xff;
  if (!x.writeStringsFromScratch(syncedStringLen, add)) {
    stringHeapFull = true;
    con.print('[sv_wasm] QC string heap passed the sim capacity (' + x.stringsHeapCapacity() +
      ' bytes) — strings past it are invisible to the sim.\n');
  }
  syncedStringLen = len;
}

// sim -> JS: the appends the sim made (strzone), so pr.getString resolves them and
// the JS allocator cannot hand the same offset out a second time. The temp ring is
// deliberately NOT mirrored — it lives at the top of the sim's 2MB heap, far above
// any JS offset, and the bridge already copies temp results by CONTENT.
function syncStringsOut() {
  const top = x.heapLength() | 0;
  if (top <= syncedStringLen) return;
  const n = x.readStringsToScratch(syncedStringLen, top - syncedStringLen) | 0;
  if (n > 0) {
    const sc = new Uint8Array(mem(), x.scratchPtr(), n);
    const heap: any = pr.state.strings;
    for (let i = 0; i < n; i++) heap[syncedStringLen + i] = sc[i];
  }
  syncedStringLen = top;
}

// --- state sync -------------------------------------------------------------------
// Load-time seed: copy JS globals + edict fields into the sim once, before
// repointEdicts makes the two share one copy.
function seedStateToWasm() {
  ensureViews();
  const s = sv.state.server;
  globalsView!.set(pr.state.globals_int.subarray(0, globalsView!.length));
  for (let e = 0; e < s.num_edicts; e++) edictsView!.set(s.edicts[e].v_int, e * entityFields);
}
// Globals are marshaled both ways each frame; edicts are NOT (shared views).
function syncGlobalsIn() {
  ensureViews();
  globalsView!.set(pr.state.globals_int.subarray(0, globalsView!.length));
}
function syncGlobalsOut() {
  ensureViews();   // serverFrame may have grown (thus detached) the buffer
  pr.state.globals_int.set(globalsView!.subarray(0, pr.state.globals_int.length));
}
// Zero-copy: point JS edicts [fromE, toE) at the sim's edict block so both share
// ONE copy of edict fields (kills the per-tick marshal that dominated frame cost).
function repointEdicts(fromE: number, toE: number) {
  const buf = mem();
  const base = x.edictsBase();
  const stride = entityFields * 4;
  for (let e = fromE; e < toE; e++) sv.rebindEdictStorage(sv.ensureEdict(e), buf, base + e * stride);
}

// A mid-frame trap/throw leaves sim state partial. Disable the backend, unbind JS
// edicts back onto their own buffers (values are a partially-applied frame — no
// clean snapshot exists under zero-copy; acceptable since the backend is dead),
// and run this frame on the JS server. sv_wasm->0 stops instant re-activation.
function disableBackend(reason: string) {
  try { (globalThis as any).__wasmTrap = reason; } catch (_e) { /* ignore */ }
  console.error('[sv_wasm] ' + reason + ' — disabling WASM backend, reverting to the JS server');
  con.print('[sv_wasm] ' + reason + ' — disabling WASM backend, reverting to the JS server\n');
  // Mid-game downgrade — always report (rare, and each one is a real sim bug lead; the
  // per-session guard is only for the activation-time success/fail pair).
  trackEvent('sim_backend', { mode: 'js', reason: 'runtime-trap', detail: reason });
  ready = false;
  host.state.wasmServer = null;
  // Stop reading the sim's leafnums buffer — the JS relink below repopulates Edict.leafnums for the JS path.
  sv.state.wasmLeafnums = null; leafnumsView = null; leafnumsStride = 0;
  const s = sv.state.server;
  for (let e = 0; e < s.num_edicts; e++) { const ed = s.edicts[e]; if (ed != null) sv.unbindEdictStorage(ed); }
  // Rebuild the JS area tree (emptied at activation) at current positions so the
  // JS server's SV_Move has entities to clip against.
  for (let e = 1; e < s.num_edicts; e++) { const ed = s.edicts[e]; if (ed != null && ed.free !== true) sv.linkEdict(ed); }
  if (cvar.findVar('sv_wasm') != null) cvar.set('sv_wasm', '0');
  // Don't let a throw from the fallback frame propagate.
  try { sv.physics(); } catch (e: any) { console.error('[sv_wasm] JS fallback frame threw: ' + (e?.message || e)); }
}

// The server physics frame, WASM-driven. Called from host.serverFrame() when sv_wasm=1.
export function frame() {
  const s = sv.state.server;
  try {
    x.setNumEdicts(s.num_edicts);
    x.setServerTime(s.time);
    // Edicts the JS VM allocated between frames (host.ts runs ClientConnect/PutClientInServer on
    // the JS interpreter) still own makeEdict's private buffer, and setNumEdicts exposes the slot,
    // not the values. Copy the fields in and rebind BEFORE the sim reads a zeroed field block.
    ensureViews();
    for (let e = 0; e < s.num_edicts; e++) {
      const ed = sv.state.server.edicts[e];
      if (ed == null || ed.v_int.buffer === viewBuf) continue;
      edictsView!.set(ed.v_int, e * entityFields);
      sv.rebindEdictStorage(ed, mem(), x.edictsBase() + e * entityFields * 4);
    }
    // Edict fields need no marshal-in (shared views), but free flags/freetimes
    // aren't in the field block — push JS-side frees in. Freetime rides only the
    // JS->wasm free TRANSITION (markFree): ed.alloc's 0.5s reuse gate reads it,
    // and a stale copy forked spawn slots between the sims. Slots the sim itself
    // freed keep the sim's own (authoritative) freetime.
    for (let e = 0; e < s.num_edicts; e++) {
      const jsFree = s.edicts[e].free ? 1 : 0;
      if (jsFree === 1 && x.isEdictFree(e) === 0) x.markFree(e, 1, s.edicts[e].freetime);
      else x.setEdictFree(e, jsFree);
    }
    // checkclient rotation state is server-struct state, not globals — marshal
    // both ways so the sims share ONE rotation phase.
    x.setCheckClientState(s.lastcheck, s.lastchecktime);
    syncGlobalsIn();
    // Strings the JS side appended between frames (client names, JS-side builtins)
    // must land before any QC can read the offset carried in a global/edict field.
    syncStringsIn();
    // Feed each client's usercmd (the cmd struct is not edict fields) + active
    // flag — the sim must know which slots are connected THIS frame.
    for (let e = 1; e <= sv.state.svs.maxclients; e++) {
      const c: any = sv.state.svs.clients[e - 1];
      const active = c != null && c.active === true;
      x.setClientActive(e, active ? 1 : 0);
      if (!active) continue;
      const vf = s.edicts[e].v_float;
      x.setUserCmd(e, c.cmd.forwardmove, c.cmd.sidemove, c.cmd.upmove,
        vf[pr.entvars.v_angle], vf[pr.entvars.v_angle + 1], vf[pr.entvars.v_angle + 2],
        vf[pr.entvars.button0], vf[pr.entvars.button2], vf[pr.entvars.impulse]);
    }
    // Pass the f64 host frametime, NOT the f32 globals slot: the sim's time
    // accumulator is f64, and the f32-rounded value drifted the clock enough to
    // fork nextthink timing. QC still reads frametime via the f32 global.
    pushLiveCvars();   // QSS-M reads these live — mid-map changes must apply this frame
    x.serverFrame(startFrameFn, s.time, host.state.frametime);
    // A QC runError sets the VM's trapped flag and unwinds — detect and bail.
    if (x.wasTrapped()) {
      ensureViews();
      const self = globalsView![pr.globalvars.self] | 0;
      const stmt = x.getXStatement ? x.getXStatement() : -1;
      let cls = '?';
      try { cls = readWasmString(edictsView![self * entityFields + pr.entvars.classname]); } catch (_e) { /* ignore */ }
      const msg = 'QC VM trapped (code ' + lastTrapCode + ', stmt ' + stmt + ', self=' + self + ' classname="' + cls + '")';
      console.warn('[sv_wasm] ' + msg);
      disableBackend(msg);
      return;
    }
    // Sync num_edicts + free flags back; newly spawned edicts need a JS object
    // pointed at the sim's memory. The buffer-identity check also catches a
    // memory.grow by rebinding every edict over the new buffer.
    const newNe = x.getNumEdicts();
    ensureViews();   // rebuild siView (and the rest) if serverFrame grew the memory
    const buf = mem(), base = x.edictsBase(), stride = entityFields * 4;
    const po = prevOrigins!, OX = pr.entvars.origin;
    const pm = prevModelindex!, MI = pr.entvars.modelindex;
    for (let e = 0; e < newNe; e++) {
      const ed = sv.ensureEdict(e);
      if (ed.v_int.buffer !== buf) sv.rebindEdictStorage(ed, buf, base + e * stride);
      const wasFree = ed.free, nowFree = x.isEdictFree(e) !== 0;
      ed.free = nowFree;
      if (nowFree) {
        // Sim freed the slot — unlink JS-side too, else a reused slot lingers in
        // a stale chain ("trigger in clipping list" in setIdealPitch's JS trace).
        if (!wasFree) sv.unlinkEdict(ed);
        // Pull the sim's freetime EVERY frame the slot is free, not just on the
        // flag transition: freed->realloc->freed within a frame never flips at
        // the boundary, and a stale freetime forked ED_Alloc's 0.5s reuse gate.
        // The gate only reads FREE slots' freetimes, so this is airtight.
        ed.freetime = x.getFreetime(e);
        continue;
      }
      // QSS-M sendinterval (U_LERPFINISH timing), computed sim-side.
      ed.sendinterval = siView![e] !== 0;
      // Refresh leafnums for entities that moved OR changed model — the
      // modelindex gate matters: a dormant entity made visible via setmodel
      // without moving (Chthon boss_awake, e1m7) would otherwise keep empty
      // spawn leafnums and be PVS-culled forever. refreshLeafs must NOT touch
      // area-tree chains (the sim owns collision).
      if (e >= 1) {
        const vf = ed.v_float, ox = vf[OX], oy = vf[OX + 1], oz = vf[OX + 2], mi = vf[MI];
        if (po[e * 3] !== ox || po[e * 3 + 1] !== oy || po[e * 3 + 2] !== oz || pm[e] !== mi) {
          // findTouchedLeafs runs in the sim; the JS walk is only the no-render-BSP fallback.
          if (leafnumsStride > 0) x.refreshLeafs(e); else sv.refreshLeafs(ed);
          po[e * 3] = ox; po[e * 3 + 1] = oy; po[e * 3 + 2] = oz;
          pm[e] = mi;
        }
      }
    }
    s.num_edicts = newNe;
    syncGlobalsOut();
    // Mirror back what the sim strzone'd this frame — the offsets are already in
    // shared edict fields, so pr.getString must be able to resolve them.
    syncStringsOut();
    s.lastcheck = x.getLastCheck();
    s.lastchecktime = x.getLastCheckTime();
    s.time = x.getSvTime();   // keep the JS server's authoritative clock in step
  } catch (e: any) {
    disableBackend('exception in WASM frame: ' + (e?.message || e) + (e?.stack ? ' | ' + String(e.stack).split('\n').slice(0, 4).join('  <-  ') : ''));
  }
}
