// Sim runtime — the glue the server worker (and the browser bring-up) drives.
// Instantiates the unified sim.wasm, bridges every host-service builtin import to a
// pluggable `services` object (print/sound/msg/cvar/precache/random/...), and exposes
// the loader + the frame API (physicsFrame). Pure JS, Node + browser.
//
// The WASM sim owns all simulation state in linear memory (globals union, edict field
// block, string heap, area tree, hulls). The host provides only the "syscalls": text
// output, sound/effect network messages, cvar values, precache registration, rng.
import { loadProgs } from '../harness/progsLoader.mjs';

// Default host services — no-ops / neutral values. Override per embedder.
const DEFAULT_SERVICES = {
  isServerLoading: () => 0,
  print: (_level, _ent, _strOfs) => {},
  error: (_kind, _ent, _strOfs) => {},
  sound: () => {}, ambientsound: () => {}, particle: () => {}, lightstyle: () => {}, makestatic: () => {},
  msgWrite: () => {}, msgWriteString: () => {}, msgWriteEntity: () => {},
  stuffcmd: () => {}, localcmd: () => {},
  cvarGet: (_strOfs) => 0.0, cvarSet: () => {},
  precache: (_kind, _strOfs) => {}, changelevel: () => {},
  random: () => 0.0,               // embedder supplies the sim's rng (demo/save policy)
  unimplemented: (_n) => {},        // builtins not yet ported (setmodel/checkclient/aim/...)
};

export async function createSim(wasmBytes, services = {}) {
  const S = { ...DEFAULT_SERVICES, ...services };
  let inst;
  const u8at = (ptr, len) => new Uint8Array(inst.exports.memory.buffer, ptr, len);
  const writeAscii = (str, outPtr) => { const b = u8at(outPtr, str.length); for (let i = 0; i < str.length; i++) b[i] = str.charCodeAt(i) & 0xff; return str.length; };

  const imports = {
    env: { abort: (_m, _f, line, col) => { throw new Error(`sim.wasm abort @${line}:${col}`); } },
    vm: {
      isServerLoading: () => (S.isServerLoading() ? 1 : 0),
      hostError: (code) => { throw new Error(`sim VM fatal (code ${code})`); },
    },
    strings: {
      host_tostring: (v, p) => writeAscii(String(v), p),
      host_tofixed1: (v, p) => writeAscii(Number(v).toFixed(1), p),
    },
    host: { host_pow: Math.pow,
      host_print: (l, e, s) => S.print(l, e, s),
      host_error: (k, e, s) => S.error(k, e, s),
      host_sound: (...a) => S.sound(...a),
      host_ambientsound: (...a) => S.ambientsound(...a),
      host_particle: (...a) => S.particle(...a),
      host_lightstyle: (style, s) => S.lightstyle(style, s),
      host_makestatic: (e) => S.makestatic(e),
      host_msg_write: (...a) => S.msgWrite(...a),
      host_msg_write_string: (...a) => S.msgWriteString(...a),
      host_msg_write_entity: (...a) => S.msgWriteEntity(...a),
      host_stuffcmd: (e, s) => S.stuffcmd(e, s),
      host_localcmd: (s) => S.localcmd(s),
      host_cvar_get: (s) => S.cvarGet(s),
      host_cvar_set: (n, v) => S.cvarSet(n, v),
      host_precache: (k, s) => S.precache(k, s),
      host_changelevel: (s) => S.changelevel(s),
      host_random: () => S.random(),
      host_unimplemented: (n) => S.unimplemented(n),
      host_extbuiltin: (n) => (S.extbuiltin ? S.extbuiltin(n) : undefined),
    },
    // Transcendental host bridge — one Math implementation shared with the JS engine
    // (see assembly builtins_math `declare function host_sin` note).
    builtins_move: { host_random: () => S.random(), host_sin: Math.sin, host_cos: Math.cos },
    builtins_math: { host_sin: Math.sin, host_cos: Math.cos, host_atan2: Math.atan2 },
    builtins_math2: { host_sin: Math.sin, host_cos: Math.cos },
    svpusher: { host_sin: Math.sin, host_cos: Math.cos },
    svclient: { host_sin: Math.sin, host_cos: Math.cos },
    svphysics: {
      host_watersplash: (e) => (S.watersplash ? S.watersplash(e) : undefined),
      host_hitsound: (e) => (S.hitsound ? S.hitsound(e) : undefined),
    },
  };

  inst = (await WebAssembly.instantiate(wasmBytes, imports)).instance;
  const x = inst.exports;

  return {
    services: S,
    exports: x,
    memory: () => inst.exports.memory,

    // --- load a program (returns the parsed tables) ---------------------------
    loadProgs: (progsBytes, maxEdicts = 1024) => loadProgs(x, progsBytes, maxEdicts),

    // --- world collision hull(s) (from the map BSP) ---------------------------
    // Single hull-0 install (open-space / simple traces).
    setWorldHull(firstclipnode, lastclipnode, planes, clipnodes) {
      for (let i = 0; i < planes.length; i++) { const p = planes[i]; x.setPlane(i, p.normal[0], p.normal[1], p.normal[2], p.dist, p.type); }
      for (let i = firstclipnode; i <= lastclipnode; i++) { const c = clipnodes[i]; x.setClipNode(i, c.planenum, c.children[0], c.children[1]); }
      x.setHullMeta(firstclipnode, lastclipnode);
    },
    // Full world model: 3 size-selected clip hulls (real map). `model` = {
    //   planes: [{normal,dist,type}],           // shared across all 3 hulls
    //   hull0: { firstclipnode, lastclipnode, clipnodes:[{planenum,children:[a,b]}] },  // BSP-node hull
    //   hull1/hull2: { firstclipnode, lastclipnode, clipMins:[x,y,z], clipnodes:[...] } // clipnode-lump hulls
    // }. hull1/hull2 share clipnode storage (setClipNode12) like mod.ts.
    setWorldModel(model) {
      for (let i = 0; i < model.planes.length; i++) { const p = model.planes[i]; x.setPlane(i, p.normal[0], p.normal[1], p.normal[2], p.dist, p.type); }
      const h0 = model.hull0;
      for (let i = h0.firstclipnode; i <= h0.lastclipnode; i++) { const c = h0.clipnodes[i]; x.setClipNode(i, c.planenum, c.children[0], c.children[1]); }
      x.setHullMeta(h0.firstclipnode, h0.lastclipnode);
      for (const h of [model.hull1, model.hull2]) {
        for (let i = h.firstclipnode; i <= h.lastclipnode; i++) { const c = h.clipnodes[i]; x.setClipNode12(i, c.planenum, c.children[0], c.children[1]); }
      }
      x.installHull1(model.hull1.firstclipnode, model.hull1.lastclipnode, model.hull1.clipMins[0], model.hull1.clipMins[1], model.hull1.clipMins[2]);
      x.installHull2(model.hull2.firstclipnode, model.hull2.lastclipnode, model.hull2.clipMins[0], model.hull2.clipMins[1], model.hull2.clipMins[2]);
    },

    // --- entity-lifecycle state (the runtime's single owner) ------------------
    // initAreaTree allocates the area tree + the per-edict free-flag storage; call
    // it with the map's world bounds + max edicts before initEntState.
    initAreaTree: (minx, miny, minz, maxx, maxy, maxz, maxEdicts) => x.initAreaTree(minx, miny, minz, maxx, maxy, maxz, maxEdicts),
    initEntState: (maxClients, numEdicts) => x.initEntState(maxClients, numEdicts),
    setNumEdicts: (n) => x.setNumEdicts(n),
    getNumEdicts: () => x.getNumEdicts(),
    setEdictFree: (ent, isFree) => x.setEdictFree(ent, isFree ? 1 : 0),   // the physics free flag (svmove storage)
    isEdictFree: (ent) => x.isEdictFree(ent),
    markFree: (ent, isFree, freetime) => x.markFree(ent, isFree, freetime), // + ED_Alloc freetime

    // --- global + edict field access (raw i32 bits; float = reinterpret) ------
    writeGlobalInt: (i, v) => x.writeGlobalInt(i, v),
    writeGlobalFloat: (i, v) => x.writeGlobalFloat(i, v),
    readGlobalInt: (i) => x.readGlobalInt(i),
    readGlobalFloat: (i) => x.readGlobalFloat(i),
    edStoreInt: (e, f, bits) => x.edStoreInt(e, f, bits),
    edStoreFloat: (e, f, v) => x.edStoreFloat(e, f, v),
    edLoadInt: (e, f) => x.edLoadInt(e, f),
    edLoadFloat: (e, f) => x.edLoadFloat(e, f),

    // --- advance one server frame ---------------------------------------------
    // tick = SV_Physics only (validation vs a post-StartFrame snapshot).
    tick: (time, frametime) => x.physicsFrame(time, frametime),
    // serverFrame = the full driving frame: StartFrame QC (pass the progs'
    // globalvars.StartFrame function number; 0 = none) then physics. Set each
    // client's usercmd via setUserCmd(...) before calling.
    serverFrame: (startFrameFn, time, frametime) => x.serverFrame(startFrameFn, time, frametime),
    setUserCmd: (...a) => x.setUserCmd(...a),
    getSvTime: () => x.getSvTime(),
  };
}
