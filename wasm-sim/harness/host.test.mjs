// Golden parity test: assembly/host.ts's `callBuiltin(n)` DISPATCH — proves the
// switch routes each builtin number to the right callee with the right
// GLOBALS-slot calling convention (PARITY is control-flow correctness here,
// not new arithmetic: the ported callees' own arithmetic parity is already
// proven by builtins_math.test.mjs / builtins_world.test.mjs / strings.test.mjs).
//
// Sections:
//   A. Ported pure math builtins (#1/#9/#12/#13/#51) driven via callBuiltin,
//      checked bit-exact against a JS reference transliterated from pf.ts
//      (same reference builtins_math.test.mjs uses).
//   B. Ported trace-backed world builtins (#2/#4/#16/#34/#41) driven via
//      callBuiltin over a linked-edict fixture, checked bit-exact against a
//      JS reference transliterated from pf.ts/sv.ts (same reference
//      builtins_world.test.mjs uses, condensed).
//   C. Ported string-heap builtins (#26 ftos / #27 vtos) driven via
//      callBuiltin, checked byte-exact against a JS reference transliterated
//      from pr.ts/pf.ts (same reference strings.test.mjs uses).
//   D. Pure-inline passthrough (#68/#77 precache_file/_file2): RETURN=PARM0,
//      no host import fired.
//   E. Host-service builtins: assert the right `host_*` import fires with the
//      right args (mock records calls), plus RETURN-setting ones (#7 random,
//      #45 cvar, #19/#20/#75/#76 precache_*) checked against the mocked value.
//   F. Unimplemented PURE builtins + unknown numbers: assert `host_unimplemented(n)`
//      fires with the right n.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { rng, Check } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = join(HERE, '..', 'build', 'host.wasm');
const WASM_BYTES = readFileSync(WASM_PATH);

// --- builtin numbers (src/engine/pf.ts pf.builtin[].defaultFnNbr) ---------------
const BI = {
  MAKEVECTORS: 1, SETORIGIN: 2, SETMODEL: 3, SETSIZE: 4, BREAK: 6, RANDOM: 7, SOUND: 8,
  NORMALIZE: 9, ERROR: 10, OBJERROR: 11, VLEN: 12, VECTOYAW: 13, SPAWN: 14, REMOVE: 15,
  TRACELINE: 16, CHECKCLIENT: 17, FIND: 18, PRECACHE_SOUND: 19, PRECACHE_MODEL: 20,
  STUFFCMD: 21, FINDRADIUS: 22, BPRINT: 23, SPRINT: 24, DPRINT: 25, FTOS: 26, VTOS: 27,
  COREDUMP: 28, TRACEON: 29, TRACEOFF: 30, EPRINT: 31, WALKMOVE: 32, DROPTOFLOOR: 34,
  LIGHTSTYLE: 35, RINT: 36, FLOOR: 37, CEIL: 38, CHECKBOTTOM: 40, POINTCONTENTS: 41,
  FABS: 43, AIM: 44, CVAR: 45, LOCALCMD: 46, NEXTENT: 47, PARTICLE: 48, CHANGEYAW: 49,
  VECTOANGLES: 51, WRITEBYTE: 52, WRITECHAR: 53, WRITESHORT: 54, WRITELONG: 55,
  WRITECOORD: 56, WRITEANGLE: 57, WRITESTRING: 58, WRITEENTITY: 59, SIN: 60, COS: 61,
  SQRT: 62, CHANGEPITCH: 63, TRACETOSS: 64, ETOS: 65, MOVETOGOAL: 67, PRECACHE_FILE: 68,
  MAKESTATIC: 69, CHANGELEVEL: 70, CVAR_SET: 72, CENTERPRINT: 73, AMBIENTSOUND: 74,
  PRECACHE_MODEL2: 75, PRECACHE_SOUND2: 76, PRECACHE_FILE2: 77, SETSPAWNPARMS: 78,
  INFOKEY: 80, STOF: 81,
};

// --- GLOBALS slots (src/engine/pr.ts globalvars) ---------------------------------
const PARM0 = 4, PARM1 = 7, PARM2 = 10, PARM3 = 13, PARM4 = 16, RETURN = 1;
const GLOBAL_SELF = 28, MSG_ENTITY = 81;
const TRACE_ALLSOLID = 68, TRACE_STARTSOLID = 69, TRACE_FRACTION = 70;
const TRACE_ENDPOS = 71, TRACE_PLANE_NORMAL = 74, TRACE_PLANE_DIST = 77, TRACE_ENT = 78;
const TRACE_INOPEN = 79, TRACE_INWATER = 80;

// --- mock host-import recorder ----------------------------------------------------
function makeRecorder() {
  const calls = {};
  const rec = (name) => (...args) => { (calls[name] = calls[name] || []).push(args); };
  return { calls, rec };
}

let mem = null, recorder = null;
function writeAsciiAt(outPtr, s) {
  const u8 = new Uint8Array(mem.buffer, outPtr, s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i) & 0xff;
  return s.length;
}

async function newInstance() {
  recorder = makeRecorder();
  const { rec } = recorder;
  const __imp = {
    env: { abort: (msg, file, line, col) => { throw new Error(`host.wasm abort @${line}:${col}`); } },
    // DEFAULT-NS: full host-import namespace defaults (later keys in this literal override).
    vm: { isServerLoading: () => 0, hostError: () => {} },
    strings: { host_tostring: () => 0, host_tofixed1: () => 0 },
    host: new Proxy({ host_pow: Math.pow }, { get: (t, k) => (k in t ? t[k] : () => 0) }),
    builtins_move: { host_random: () => 0, host_sin: Math.sin, host_cos: Math.cos },
    builtins_math: { host_sin: Math.sin, host_cos: Math.cos, host_atan2: Math.atan2 },
    builtins_math2: { host_sin: Math.sin, host_cos: Math.cos },
    svphysics: { host_watersplash: () => {}, host_hitsound: () => {} },
    svpusher: { host_sin: Math.sin, host_cos: Math.cos },
    svclient: { host_sin: Math.sin, host_cos: Math.cos },
    strings: {
      host_tostring: (v, outPtr) => writeAsciiAt(outPtr, v.toString()),
      host_tofixed1: (v, outPtr) => writeAsciiAt(outPtr, v.toFixed(1)),
    },
    host: { host_pow: Math.pow, 
      host_print: rec('print'), host_error: rec('error'), host_sound: rec('sound'),
      host_ambientsound: rec('ambientsound'), host_particle: rec('particle'),
      host_lightstyle: rec('lightstyle'), host_makestatic: rec('makestatic'),
      host_msg_write: rec('msg_write'), host_msg_write_string: rec('msg_write_string'),
      host_msg_write_entity: rec('msg_write_entity'), host_stuffcmd: rec('stuffcmd'),
      host_localcmd: rec('localcmd'),
      host_cvar_get: (strOfs) => { recorder.calls.cvar_get = (recorder.calls.cvar_get || []); recorder.calls.cvar_get.push([strOfs]); return recorder.cvarGetReturn ?? 0.0; },
      host_cvar_set: rec('cvar_set'), host_precache: rec('precache'),
      host_changelevel: rec('changelevel'),
      host_random: () => { recorder.calls.random = (recorder.calls.random || []); recorder.calls.random.push([]); return recorder.randomReturn ?? 0.0; },
      host_unimplemented: rec('unimplemented'), host_extbuiltin: rec('extbuiltin'),
    },
  };
  // host.wasm now pulls in builtins_move (host_random namespace) etc. — stub any
  // host-import namespace not explicitly provided above.
  const { instance } = await WebAssembly.instantiate(WASM_BYTES,
    new Proxy(__imp, { get: (t, k) => (k in t ? t[k] : new Proxy({}, { get: () => () => 0 })), has: () => true }));
  mem = instance.exports.memory;
  return instance.exports;
}

let x = await newInstance();
let g = x.globalsPtr();

function wSetF(idx, v) { x.writeGlobalFloat(idx, Math.fround(v)); }
function wGetF(idx) { return x.readGlobalFloat(idx); }
function wSetI(idx, v) { x.writeGlobalInt(idx, v); }
function wGetI(idx) { return x.readGlobalInt(idx); }

const results = [];

// ================================================================================
// Section A: ported pure math builtins, via callBuiltin
// ================================================================================
{
  const V_FORWARD = 59, V_UP = 62, V_RIGHT = 65;
  function fround3(v) { return [Math.fround(v[0]), Math.fround(v[1]), Math.fround(v[2])]; }
  function jsAngleVectors(angles) {
    let angle = angles[0] * Math.PI / 180.0;
    const sp = Math.sin(angle), cp = Math.cos(angle);
    angle = angles[1] * Math.PI / 180.0;
    const sy = Math.sin(angle), cy = Math.cos(angle);
    angle = angles[2] * Math.PI / 180.0;
    const sr = Math.sin(angle), cr = Math.cos(angle);
    return {
      forward: [cp * cy, cp * sy, -sp],
      right: [cr * sy - sr * sp * cy, -sr * sp * sy - cr * cy, -sr * cp],
      up: [cr * sp * cy + sr * sy, cr * sp * sy - sr * cy, cr * cp],
    };
  }
  function jsNormalize(v) {
    const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    if (len === 0.0) return [0.0, 0.0, 0.0];
    return [v[0] / len, v[1] / len, v[2] / len];
  }
  function jsVlen(v) { return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); }
  function jsVectoyaw(v1, v2) {
    if (v1 === 0.0 && v2 === 0.0) return 0.0;
    let yaw = (Math.atan2(v2, v1) * 180.0 / Math.PI) >> 0;
    if (yaw < 0) yaw += 360;
    return yaw;
  }
  function jsVectoangles(v) {
    if (v[0] === 0.0 && v[1] === 0.0) return [v[2] > 0.0 ? 90.0 : 270.0, 0.0, 0.0];
    let yaw = Math.atan2(v[1], v[0]) * 180.0 / Math.PI;
    if (yaw < 0) yaw += 360;
    let pitch = Math.atan2(v[2], Math.sqrt(v[0] * v[0] + v[1] * v[1])) * 180.0 / Math.PI;
    if (pitch < 0) pitch += 360;
    return [pitch, yaw, 0.0];
  }

  const r = rng(0xC0FFEE1);

  {
    const chk = new Check('dispatch: makevectors (#1)');
    for (let i = 0; i < 5000; i++) {
      const angles = r.int(3) === 0 ? [r.f32(100000), r.f32(100000), r.f32(100000)] : [r.f32(360), r.f32(360), r.f32(360)];
      wSetF(PARM0, angles[0]); wSetF(PARM0 + 1, angles[1]); wSetF(PARM0 + 2, angles[2]);
      x.callBuiltin(BI.MAKEVECTORS);
      const { forward, right, up } = jsAngleVectors(angles);
      const wf = [wGetF(V_FORWARD), wGetF(V_FORWARD + 1), wGetF(V_FORWARD + 2)];
      const wr = [wGetF(V_RIGHT), wGetF(V_RIGHT + 1), wGetF(V_RIGHT + 2)];
      const wu = [wGetF(V_UP), wGetF(V_UP + 1), wGetF(V_UP + 2)];
      for (let k = 0; k < 3; k++) {
        chk.floatEq(wf[k], Math.fround(forward[k]), `fwd#${i}[${k}]`);
        chk.floatEq(wr[k], Math.fround(right[k]), `right#${i}[${k}]`);
        chk.floatEq(wu[k], Math.fround(up[k]), `up#${i}[${k}]`);
      }
    }
    results.push(chk.report());
  }
  {
    const chk = new Check('dispatch: normalize (#9)');
    for (let i = 0; i < 5000; i++) {
      const v = fround3([r.f32(5000), r.f32(5000), r.f32(5000)]);
      if (i % 500 === 0) { v[0] = 0; v[1] = 0; v[2] = 0; }
      wSetF(PARM0, v[0]); wSetF(PARM0 + 1, v[1]); wSetF(PARM0 + 2, v[2]);
      x.callBuiltin(BI.NORMALIZE);
      const w = [wGetF(RETURN), wGetF(RETURN + 1), wGetF(RETURN + 2)];
      const j = jsNormalize(v).map(Math.fround);
      for (let k = 0; k < 3; k++) chk.floatEq(w[k], j[k], `normalize#${i}[${k}]`);
    }
    results.push(chk.report());
  }
  {
    const chk = new Check('dispatch: vlen (#12)');
    for (let i = 0; i < 5000; i++) {
      const v = fround3([r.f32(5000), r.f32(5000), r.f32(5000)]);
      wSetF(PARM0, v[0]); wSetF(PARM0 + 1, v[1]); wSetF(PARM0 + 2, v[2]);
      x.callBuiltin(BI.VLEN);
      chk.floatEq(wGetF(RETURN), Math.fround(jsVlen(v)), `vlen#${i}`);
    }
    results.push(chk.report());
  }
  {
    const chk = new Check('dispatch: vectoyaw (#13)');
    for (let i = 0; i < 5000; i++) {
      let v1 = r.f32(5000), v2 = r.f32(5000);
      if (i % 700 === 0) { v1 = 0; v2 = 0; }
      wSetF(PARM0, v1); wSetF(PARM0 + 1, v2);
      x.callBuiltin(BI.VECTOYAW);
      chk.floatEq(wGetF(RETURN), Math.fround(jsVectoyaw(v1, v2)), `vectoyaw#${i}`);
    }
    results.push(chk.report());
  }
  {
    const chk = new Check('dispatch: vectoangles (#51)');
    for (let i = 0; i < 5000; i++) {
      let v = fround3([r.f32(5000), r.f32(5000), r.f32(5000)]);
      if (i % 800 === 0) { v[0] = 0; v[1] = 0; }
      wSetF(PARM0, v[0]); wSetF(PARM0 + 1, v[1]); wSetF(PARM0 + 2, v[2]);
      x.callBuiltin(BI.VECTOANGLES);
      const w = [wGetF(RETURN), wGetF(RETURN + 1), wGetF(RETURN + 2)];
      const j = jsVectoangles(v).map(Math.fround);
      for (let k = 0; k < 3; k++) chk.floatEq(w[k], j[k], `vectoangles#${i}[${k}]`);
    }
    results.push(chk.report());
  }
}

// ================================================================================
// Section B: ported trace-backed world builtins, via callBuiltin (condensed
// fixture from builtins_world.test.mjs)
// ================================================================================
{
  const F = {
    ABSMIN: 1, ABSMIN1: 2, ABSMIN2: 3, ABSMAX: 4, ABSMAX1: 5, ABSMAX2: 6,
    SOLID: 9, ORIGIN: 10, ORIGIN1: 11, ORIGIN2: 12, SKIN: 31,
    MINS: 33, MINS1: 34, MINS2: 35, MAXS: 36, MAXS1: 37, MAXS2: 38,
    SIZE: 39, SIZE1: 40, SIZE2: 41, GROUNDENTITY: 47, FLAGS: 76, OWNER: 95,
  };
  const EDICT_SIZE_WORDS = 100;
  const SOLID_NOT = 0, SOLID_BBOX = 2, SOLID_SLIDEBOX = 3;
  const FL_ITEM = 256, FL_ONGROUND = 512;
  const MOVE_NORMAL = 0, MOVE_NOMONSTERS = 1, MOVE_MISSILE = 2;
  const CONTENTS_EMPTY = -1, CONTENTS_SOLID = -2;

  class JsEdicts {
    constructor(n) {
      this.n = n; this.vf = []; this.vi = [];
      for (let i = 0; i < n; i++) {
        const buf = new ArrayBuffer(EDICT_SIZE_WORDS * 4);
        this.vf.push(new Float32Array(buf)); this.vi.push(new Int32Array(buf));
      }
      this.free = new Array(n).fill(false);
    }
    f(e, idx) { return this.vf[e][idx]; }
    setf(e, idx, v) { this.vf[e][idx] = v; }
    i(e, idx) { return this.vi[e][idx]; }
    seti(e, idx, v) { this.vi[e][idx] = v; }
  }

  function jsHullPointContents(hull, num, p) {
    while (num >= 0) {
      const node = hull.clipnodes[num]; const plane = hull.planes[node.planenum];
      let d;
      if (plane.type <= 2) d = p[plane.type] - plane.dist;
      else d = plane.normal[0] * p[0] + plane.normal[1] * p[1] + plane.normal[2] * p[2] - plane.dist;
      num = d >= 0.0 ? node.children[0] : node.children[1];
    }
    return num;
  }
  function jsRecursiveHullCheck(hull, num, p1f, p2f, p1, p2, trace) {
    if (num < 0) {
      if (num !== CONTENTS_SOLID) { trace.allsolid = false; if (num === CONTENTS_EMPTY) trace.inopen = true; else trace.inwater = true; }
      else trace.startsolid = true;
      return true;
    }
    const node = hull.clipnodes[num]; const plane = hull.planes[node.planenum];
    const child0 = node.children[0], child1 = node.children[1];
    let t1, t2;
    if (plane.type <= 2) { t1 = p1[plane.type] - plane.dist; t2 = p2[plane.type] - plane.dist; }
    else {
      t1 = plane.normal[0] * p1[0] + plane.normal[1] * p1[1] + plane.normal[2] * p1[2] - plane.dist;
      t2 = plane.normal[0] * p2[0] + plane.normal[1] * p2[1] + plane.normal[2] * p2[2] - plane.dist;
    }
    if (t1 >= 0.0 && t2 >= 0.0) return jsRecursiveHullCheck(hull, child0, p1f, p2f, p1, p2, trace);
    if (t1 < 0.0 && t2 < 0.0) return jsRecursiveHullCheck(hull, child1, p1f, p2f, p1, p2, trace);
    let frac = (t1 + (t1 < 0.0 ? 0.03125 : -0.03125)) / (t1 - t2);
    if (frac < 0.0) frac = 0.0; else if (frac > 1.0) frac = 1.0;
    const midf = p1f + (p2f - p1f) * frac;
    const mid = [p1[0] + frac * (p2[0] - p1[0]), p1[1] + frac * (p2[1] - p1[1]), p1[2] + frac * (p2[2] - p1[2])];
    const side = t1 < 0.0 ? 1 : 0;
    if (jsRecursiveHullCheck(hull, side === 0 ? child0 : child1, p1f, midf, p1, mid, trace) !== true) return false;
    if (jsHullPointContents(hull, side === 0 ? child1 : child0, mid) !== CONTENTS_SOLID)
      return jsRecursiveHullCheck(hull, side === 0 ? child1 : child0, midf, p2f, mid, p2, trace);
    if (trace.allsolid === true) return false;
    if (side === 0) { trace.plane.normal = [plane.normal[0], plane.normal[1], plane.normal[2]]; trace.plane.dist = plane.dist; }
    else { trace.plane.normal = [-plane.normal[0], -plane.normal[1], -plane.normal[2]]; trace.plane.dist = -plane.dist; }
    let f2 = frac, m = mid.slice(), mf = midf;
    while (jsHullPointContents(hull, hull.firstclipnode, m) === CONTENTS_SOLID) {
      f2 -= 0.1;
      if (f2 < 0.0) { trace.fraction = mf; trace.endpos = m.slice(); return false; }
      mf = p1f + (p2f - p1f) * f2;
      m = [p1[0] + f2 * (p2[0] - p1[0]), p1[1] + f2 * (p2[1] - p1[1]), p1[2] + f2 * (p2[2] - p1[2])];
    }
    trace.fraction = mf; trace.endpos = m.slice();
    return false;
  }
  function makeEmptyTrace(end) {
    return { fraction: 1.0, allsolid: true, startsolid: false, inopen: false, inwater: false, endpos: [...end], plane: { normal: [0, 0, 0], dist: 0 }, ent: null };
  }
  function jsCopyTrace(src, dst) {
    dst.fraction = src.fraction; dst.allsolid = src.allsolid; dst.startsolid = src.startsolid;
    dst.inopen = src.inopen; dst.inwater = src.inwater; dst.ent = src.ent;
    dst.endpos = [...src.endpos]; dst.plane = { normal: [...src.plane.normal], dist: src.plane.dist };
  }
  function makeEntityBoxHull(entMinsX, entMinsY, entMinsZ, entMaxsX, entMaxsY, entMaxsZ, sweepMins, sweepMaxs) {
    const dist = [entMaxsX - sweepMins[0], entMinsX - sweepMaxs[0], entMaxsY - sweepMins[1], entMinsY - sweepMaxs[1], entMaxsZ - sweepMins[2], entMinsZ - sweepMaxs[2]];
    const clipnodes = [], planes = [];
    for (let i = 0; i <= 5; i++) {
      const node = { planenum: i, children: [0, 0] };
      node.children[i & 1] = CONTENTS_EMPTY;
      node.children[1 - (i & 1)] = (i !== 5) ? i + 1 : CONTENTS_SOLID;
      clipnodes[i] = node;
      const normal = [0, 0, 0]; normal[i >> 1] = 1.0;
      planes[i] = { type: i >> 1, normal, dist: dist[i] };
    }
    return { clipnodes, planes, firstclipnode: 0, lastclipnode: 5 };
  }
  function jsHullForEntityBox(edicts, entNum, sweepMins, sweepMaxs) {
    const eMaxsX = edicts.f(entNum, F.MAXS), eMinsX = edicts.f(entNum, F.MINS);
    const eMaxsY = edicts.f(entNum, F.MAXS1), eMinsY = edicts.f(entNum, F.MINS1);
    const eMaxsZ = edicts.f(entNum, F.MAXS2), eMinsZ = edicts.f(entNum, F.MINS2);
    const hull = makeEntityBoxHull(eMinsX, eMinsY, eMinsZ, eMaxsX, eMaxsY, eMaxsZ, sweepMins, sweepMaxs);
    const offset = [edicts.f(entNum, F.ORIGIN), edicts.f(entNum, F.ORIGIN1), edicts.f(entNum, F.ORIGIN2)];
    return { hull, offset };
  }
  function jsClipMoveToEntity(edicts, entNum, start, mins, maxs, end) {
    const { hull, offset } = jsHullForEntityBox(edicts, entNum, mins, maxs);
    const adjStart = [start[0] - offset[0], start[1] - offset[1], start[2] - offset[2]];
    const adjEnd = [end[0] - offset[0], end[1] - offset[1], end[2] - offset[2]];
    const trace = makeEmptyTrace(adjEnd);
    jsRecursiveHullCheck(hull, hull.firstclipnode, 0.0, 1.0, adjStart, adjEnd, trace);
    trace.endpos[0] += offset[0]; trace.endpos[1] += offset[1]; trace.endpos[2] += offset[2]; // unconditional (sv.ts/sim parity)
    if (trace.fraction < 1.0 || trace.startsolid === true) trace.ent = entNum;
    return trace;
  }
  function jsClipToWorld(hullWorld, start, end) {
    const trace = makeEmptyTrace(end);
    jsRecursiveHullCheck(hullWorld, hullWorld.firstclipnode, 0.0, 1.0, [...start], [...end], trace);
    if (trace.fraction < 1.0 || trace.startsolid === true) trace.ent = 0;
    return trace;
  }
  function makeLink() { const l = { prev: null, next: null, ent: null }; l.prev = l.next = l; return l; }
  function createAreaNode(nodes, depth, mins, maxs) {
    const anode = { trigger_edicts: makeLink(), solid_edicts: makeLink() };
    nodes.push(anode);
    if (depth === 4) { anode.axis = -1; anode.children = []; return anode; }
    anode.axis = (maxs[0] - mins[0]) > (maxs[1] - mins[1]) ? 0 : 1;
    anode.dist = 0.5 * (maxs[anode.axis] + mins[anode.axis]);
    const maxs1 = [maxs[0], maxs[1], maxs[2]], mins2 = [mins[0], mins[1], mins[2]];
    maxs1[anode.axis] = mins2[anode.axis] = anode.dist;
    anode.children = [createAreaNode(nodes, depth + 1, mins2, maxs), createAreaNode(nodes, depth + 1, mins, maxs1)];
    return anode;
  }
  function jsUnlinkEdict(links, e) {
    const area = links[e];
    if (area.prev != null) area.prev.next = area.next;
    if (area.next != null) area.next.prev = area.prev;
    area.prev = area.next = null;
  }
  function jsLinkEdict(edicts, links, root, entNum) {
    if (entNum === 0 || edicts.free[entNum]) return;
    jsUnlinkEdict(links, entNum);
    const originX = edicts.f(entNum, F.ORIGIN), originY = edicts.f(entNum, F.ORIGIN1), originZ = edicts.f(entNum, F.ORIGIN2);
    const minsX = edicts.f(entNum, F.MINS), minsY = edicts.f(entNum, F.MINS1), minsZ = edicts.f(entNum, F.MINS2);
    const maxsX = edicts.f(entNum, F.MAXS), maxsY = edicts.f(entNum, F.MAXS1), maxsZ = edicts.f(entNum, F.MAXS2);
    // QSS-M SV_LinkEdict order: store origin+mins/maxs into the f32 fields FIRST, then adjust the
    // stored values (two f32 roundings per axis) — matches sv.ts refreshLeafs + wasm linkEdict.
    edicts.setf(entNum, F.ABSMIN, originX + minsX); edicts.setf(entNum, F.ABSMIN1, originY + minsY); edicts.setf(entNum, F.ABSMIN2, originZ + minsZ);
    edicts.setf(entNum, F.ABSMAX, originX + maxsX); edicts.setf(entNum, F.ABSMAX1, originY + maxsY); edicts.setf(entNum, F.ABSMAX2, originZ + maxsZ);
    const flags = edicts.f(entNum, F.FLAGS) | 0;
    if ((flags & FL_ITEM) !== 0) {
      edicts.setf(entNum, F.ABSMIN, edicts.f(entNum, F.ABSMIN) - 15.0); edicts.setf(entNum, F.ABSMIN1, edicts.f(entNum, F.ABSMIN1) - 15.0);
      edicts.setf(entNum, F.ABSMAX, edicts.f(entNum, F.ABSMAX) + 15.0); edicts.setf(entNum, F.ABSMAX1, edicts.f(entNum, F.ABSMAX1) + 15.0);
    } else {
      edicts.setf(entNum, F.ABSMIN, edicts.f(entNum, F.ABSMIN) - 1.0); edicts.setf(entNum, F.ABSMIN1, edicts.f(entNum, F.ABSMIN1) - 1.0); edicts.setf(entNum, F.ABSMIN2, edicts.f(entNum, F.ABSMIN2) - 1.0);
      edicts.setf(entNum, F.ABSMAX, edicts.f(entNum, F.ABSMAX) + 1.0); edicts.setf(entNum, F.ABSMAX1, edicts.f(entNum, F.ABSMAX1) + 1.0); edicts.setf(entNum, F.ABSMAX2, edicts.f(entNum, F.ABSMAX2) + 1.0);
    }
    const solid = edicts.f(entNum, F.SOLID) | 0;
    if (solid === SOLID_NOT) return;
    let node = root;
    for (;;) {
      if (node.axis === -1) break;
      const amin = edicts.f(entNum, F.ABSMIN + node.axis), amax = edicts.f(entNum, F.ABSMAX + node.axis);
      if (amin > node.dist) node = node.children[0]; else if (amax < node.dist) node = node.children[1]; else break;
    }
    const before = node.solid_edicts;
    const area = links[entNum];
    area.next = before; area.prev = before.prev; area.prev.next = area; area.next.prev = area; area.ent = entNum;
  }
  function jsClipToLinks(edicts, node, clip) {
    for (let l = node.solid_edicts.next; l !== node.solid_edicts;) {
      const next = l.next; const touch = l.ent;
      const solid = edicts.f(touch, F.SOLID) | 0;
      if (solid === SOLID_NOT || touch === clip.passedict) { l = next; continue; }
      if (clip.type === MOVE_NOMONSTERS && solid !== 4) { l = next; continue; }
      const tAbsMinX = edicts.f(touch, F.ABSMIN), tAbsMinY = edicts.f(touch, F.ABSMIN1), tAbsMinZ = edicts.f(touch, F.ABSMIN2);
      const tAbsMaxX = edicts.f(touch, F.ABSMAX), tAbsMaxY = edicts.f(touch, F.ABSMAX1), tAbsMaxZ = edicts.f(touch, F.ABSMAX2);
      if (clip.boxmins[0] > tAbsMaxX || clip.boxmins[1] > tAbsMaxY || clip.boxmins[2] > tAbsMaxZ ||
        clip.boxmaxs[0] < tAbsMinX || clip.boxmaxs[1] < tAbsMinY || clip.boxmaxs[2] < tAbsMinZ) { l = next; continue; }
      if (clip.passedict != null) {
        const passSize = edicts.f(clip.passedict, F.SIZE), touchSize = edicts.f(touch, F.SIZE);
        if (passSize !== 0.0 && touchSize === 0.0) { l = next; continue; }
      }
      if (clip.trace.allsolid === true) return;
      if (clip.passedict != null) {
        const touchOwner = edicts.i(touch, F.OWNER);
        if (touchOwner === clip.passedict) { l = next; continue; }
        const passOwner = edicts.i(clip.passedict, F.OWNER);
        if (passOwner === touch) { l = next; continue; }
      }
      const trace = jsClipMoveToEntity(edicts, touch, clip.start, clip.mins, clip.maxs, clip.end);
      if (trace.allsolid === true || trace.startsolid === true || trace.fraction < clip.trace.fraction ||
        (trace.fraction === clip.trace.fraction && trace.ent != null && trace.ent !== 0 && clip.trace.ent != null && clip.trace.ent !== 0 && trace.ent < clip.trace.ent)) { // tie-break: lowest edict num (matches sv.ts/svmove.ts)
        trace.ent = touch; jsCopyTrace(trace, clip.trace);
      }
      l = next;
    }
    if (node.axis === -1) return;
    if (clip.boxmaxs[node.axis] > node.dist) jsClipToLinks(edicts, node.children[0], clip);
    if (clip.boxmins[node.axis] < node.dist) jsClipToLinks(edicts, node.children[1], clip);
  }
  function jsMove(edicts, root, hullWorld, start, mins, maxs, end, type, passedict) {
    const out = jsClipToWorld(hullWorld, start, end);
    const clip = {
      trace: out, start, end, mins, maxs, type, passedict,
      boxmins: [0, 0, 0], boxmaxs: [0, 0, 0],
    };
    for (let i = 0; i <= 2; i++) {
      if (end[i] > start[i]) { clip.boxmins[i] = start[i] + mins[i] - 1; clip.boxmaxs[i] = end[i] + maxs[i] + 1; }
      else { clip.boxmins[i] = end[i] + mins[i] - 1; clip.boxmaxs[i] = start[i] + maxs[i] + 1; }
    }
    jsClipToLinks(edicts, root, clip);
    return clip.trace;
  }
  function jsSetOrigin(edicts, links, root, ent, origin) {
    edicts.setf(ent, F.ORIGIN, origin[0]); edicts.setf(ent, F.ORIGIN1, origin[1]); edicts.setf(ent, F.ORIGIN2, origin[2]);
    jsLinkEdict(edicts, links, root, ent);
  }
  function jsSetSize(edicts, links, root, ent, min, max) {
    edicts.setf(ent, F.MINS, min[0]); edicts.setf(ent, F.MINS1, min[1]); edicts.setf(ent, F.MINS2, min[2]);
    edicts.setf(ent, F.MAXS, max[0]); edicts.setf(ent, F.MAXS1, max[1]); edicts.setf(ent, F.MAXS2, max[2]);
    edicts.setf(ent, F.SIZE, max[0] - min[0]); edicts.setf(ent, F.SIZE1, max[1] - min[1]); edicts.setf(ent, F.SIZE2, max[2] - min[2]);
    jsLinkEdict(edicts, links, root, ent);
  }
  function jsPointContents(hull, p) {
    const cont = jsHullPointContents(hull, 0, p);
    return (cont <= -9 && cont >= -14) ? -3 : cont;
  }
  function jsDropToFloor(edicts, links, root, hullWorld, self) {
    const origin = [edicts.f(self, F.ORIGIN), edicts.f(self, F.ORIGIN1), edicts.f(self, F.ORIGIN2)];
    const mins = [edicts.f(self, F.MINS), edicts.f(self, F.MINS1), edicts.f(self, F.MINS2)];
    const maxs = [edicts.f(self, F.MAXS), edicts.f(self, F.MAXS1), edicts.f(self, F.MAXS2)];
    const end = [origin[0], origin[1], origin[2] - 256.0];
    const trace = jsMove(edicts, root, hullWorld, origin, mins, maxs, end, MOVE_NORMAL, self);
    if (trace.fraction === 1.0 || trace.allsolid === true) return { ret: 0.0 };
    jsSetOrigin(edicts, links, root, self, trace.endpos);
    const flags = (edicts.f(self, F.FLAGS) | 0) | FL_ONGROUND;
    edicts.setf(self, F.FLAGS, flags);
    edicts.seti(self, F.GROUNDENTITY, trace.ent);
    return { ret: 1.0 };
  }
  function makeFloorHull(floorZ) {
    return { clipnodes: [{ planenum: 0, children: [CONTENTS_EMPTY, CONTENTS_SOLID] }], planes: [{ type: 2, normal: [0, 0, 1], dist: floorZ }], firstclipnode: 0, lastclipnode: 0 };
  }
  function loadWorldHullToWasm(hull) {
    x.initHullStorage(hull.clipnodes.length, hull.planes.length); // size pools like the live embedder
    for (let i = 0; i < hull.planes.length; i++) { const p = hull.planes[i]; x.setPlane(i, p.normal[0], p.normal[1], p.normal[2], p.dist, p.type); }
    for (let i = hull.firstclipnode; i <= hull.lastclipnode; i++) { const n = hull.clipnodes[i]; x.setClipNode(i, n.planenum, n.children[0], n.children[1]); }
    x.setWorldHullRange(hull.firstclipnode, hull.lastclipnode);
  }
  function setEntityBoth(edicts, e, ox, oy, oz, hx, hy, hz, solid, flags, owner) {
    edicts.setf(e, F.ORIGIN, ox); edicts.setf(e, F.ORIGIN1, oy); edicts.setf(e, F.ORIGIN2, oz);
    edicts.setf(e, F.MINS, -hx); edicts.setf(e, F.MINS1, -hy); edicts.setf(e, F.MINS2, -hz);
    edicts.setf(e, F.MAXS, hx); edicts.setf(e, F.MAXS1, hy); edicts.setf(e, F.MAXS2, hz);
    edicts.setf(e, F.SOLID, solid); edicts.setf(e, F.FLAGS, flags); edicts.setf(e, F.SKIN, 0); edicts.setf(e, F.SIZE, hx * 2);
    edicts.seti(e, F.OWNER, owner);
    x.edStoreFloat(e, F.ORIGIN, ox); x.edStoreFloat(e, F.ORIGIN1, oy); x.edStoreFloat(e, F.ORIGIN2, oz);
    x.edStoreFloat(e, F.MINS, -hx); x.edStoreFloat(e, F.MINS1, -hy); x.edStoreFloat(e, F.MINS2, -hz);
    x.edStoreFloat(e, F.MAXS, hx); x.edStoreFloat(e, F.MAXS1, hy); x.edStoreFloat(e, F.MAXS2, hz);
    x.edStoreFloat(e, F.SOLID, solid); x.edStoreFloat(e, F.FLAGS, flags); x.edStoreFloat(e, F.SKIN, 0); x.edStoreFloat(e, F.SIZE, hx * 2);
    x.edStoreInt(e, F.OWNER, owner);
  }

  const WORLD_MINS = [-2048, -2048, -2048], WORLD_MAXS = [2048, 2048, 2048];
  const MAX_EDICTS = 200;

  // --- traceline (#16) -----------------------------------------------------------
  {
    const r = rng(0xD15EA5E);
    x.initEdicts(MAX_EDICTS, EDICT_SIZE_WORDS);
    x.initAreaTree(WORLD_MINS[0], WORLD_MINS[1], WORLD_MINS[2], WORLD_MAXS[0], WORLD_MAXS[1], WORLD_MAXS[2], MAX_EDICTS);
    const edicts = new JsEdicts(MAX_EDICTS);
    const links = []; for (let i = 0; i < MAX_EDICTS; i++) links.push({ prev: null, next: null, ent: null });
    const nodes = []; const root = createAreaNode(nodes, 0, WORLD_MINS, WORLD_MAXS);
    const worldHull = makeFloorHull(0);
    loadWorldHullToWasm(worldHull);

    const NUM_ENTS = 60;
    for (let e = 1; e <= NUM_ENTS; e++) {
      const ox = r.f32(500), oy = r.f32(500), oz = r.f32(500);
      const hx = Math.abs(r.f32(40)) + 3, hy = Math.abs(r.f32(40)) + 3, hz = Math.abs(r.f32(40)) + 3;
      const solidRoll = r.int(10);
      const solid = solidRoll === 0 ? SOLID_NOT : (solidRoll < 6 ? SOLID_BBOX : SOLID_SLIDEBOX);
      const owner = r.int(4) === 0 ? (1 + r.int(NUM_ENTS)) : 0;
      setEntityBoth(edicts, e, ox, oy, oz, hx, hy, hz, solid, 0, owner);
      x.linkEdict(e); jsLinkEdict(edicts, links, root, e);
    }

    const chk = new Check('dispatch: traceline (#16)');
    for (let iter = 0; iter < 5000; iter++) {
      const sx = r.f32(600), sy = r.f32(600), sz = r.f32(600);
      const ex = r.f32(600), ey = r.f32(600), ez = r.f32(600);
      const nomonsters = r.int(10) === 0 ? MOVE_NOMONSTERS : MOVE_NORMAL;
      const ent = r.int(4);
      wSetF(PARM0, sx); wSetF(PARM0 + 1, sy); wSetF(PARM0 + 2, sz);
      wSetF(PARM1, ex); wSetF(PARM1 + 1, ey); wSetF(PARM1 + 2, ez);
      wSetF(PARM2, nomonsters); wSetI(PARM3, ent);
      x.callBuiltin(BI.TRACELINE);
      const j = jsMove(edicts, root, worldHull, [sx, sy, sz], [0, 0, 0], [0, 0, 0], [ex, ey, ez], nomonsters, ent);
      chk.floatEq(wGetF(TRACE_FRACTION), Math.fround(j.fraction), `tl#${iter} fraction`);
      for (let k = 0; k < 3; k++) chk.floatEq(wGetF(TRACE_ENDPOS + k), Math.fround(j.endpos[k]), `tl#${iter} endpos[${k}]`);
      chk.intEq(wGetI(TRACE_ENT), j.ent != null ? j.ent : 0, `tl#${iter} ent`);
      chk.floatEq(wGetF(TRACE_ALLSOLID), j.allsolid ? 1.0 : 0.0, `tl#${iter} allsolid`);
      chk.floatEq(wGetF(TRACE_STARTSOLID), j.startsolid ? 1.0 : 0.0, `tl#${iter} startsolid`);
      chk.floatEq(wGetF(TRACE_INOPEN), j.inopen ? 1.0 : 0.0, `tl#${iter} inopen`);
      chk.floatEq(wGetF(TRACE_INWATER), j.inwater ? 1.0 : 0.0, `tl#${iter} inwater`);
    }
    results.push(chk.report());
  }

  // --- setorigin / setsize (#2 / #4) ---------------------------------------------
  {
    const r = rng(0xD15EA5F);
    x.initEdicts(MAX_EDICTS, EDICT_SIZE_WORDS);
    x.initAreaTree(WORLD_MINS[0], WORLD_MINS[1], WORLD_MINS[2], WORLD_MAXS[0], WORLD_MAXS[1], WORLD_MAXS[2], MAX_EDICTS);
    const edicts = new JsEdicts(MAX_EDICTS);
    const links = []; for (let i = 0; i < MAX_EDICTS; i++) links.push({ prev: null, next: null, ent: null });
    const nodes = []; const root = createAreaNode(nodes, 0, WORLD_MINS, WORLD_MAXS);

    const NUM_ENTS = 40;
    for (let e = 1; e <= NUM_ENTS; e++) {
      const ox = r.f32(500), oy = r.f32(500), oz = r.f32(500);
      const hx = Math.abs(r.f32(40)) + 3, hy = Math.abs(r.f32(40)) + 3, hz = Math.abs(r.f32(40)) + 3;
      setEntityBoth(edicts, e, ox, oy, oz, hx, hy, hz, SOLID_BBOX, 0, 0);
      x.linkEdict(e); jsLinkEdict(edicts, links, root, e);
    }

    const chk = new Check('dispatch: setorigin/setsize (#2/#4)');
    const FIELDS = [F.ORIGIN, F.ORIGIN1, F.ORIGIN2, F.MINS, F.MINS1, F.MINS2, F.MAXS, F.MAXS1, F.MAXS2,
      F.SIZE, F.SIZE1, F.SIZE2, F.ABSMIN, F.ABSMIN1, F.ABSMIN2, F.ABSMAX, F.ABSMAX1, F.ABSMAX2];
    for (let trial = 0; trial < 5000; trial++) {
      const e = 1 + r.int(NUM_ENTS);
      if (r.int(2) === 0) {
        const origin = [r.f32(800), r.f32(800), r.f32(800)];
        wSetI(PARM0, e); wSetF(PARM1, origin[0]); wSetF(PARM1 + 1, origin[1]); wSetF(PARM1 + 2, origin[2]);
        x.callBuiltin(BI.SETORIGIN);
        jsSetOrigin(edicts, links, root, e, origin);
      } else {
        const hx = Math.abs(r.f32(50)) + 2, hy = Math.abs(r.f32(50)) + 2, hz = Math.abs(r.f32(50)) + 2;
        const min = [-hx, -hy, -hz], max = [hx, hy, hz];
        wSetI(PARM0, e);
        wSetF(PARM1, min[0]); wSetF(PARM1 + 1, min[1]); wSetF(PARM1 + 2, min[2]);
        wSetF(PARM2, max[0]); wSetF(PARM2 + 1, max[1]); wSetF(PARM2 + 2, max[2]);
        x.callBuiltin(BI.SETSIZE);
        jsSetSize(edicts, links, root, e, min, max);
      }
      for (const f of FIELDS) chk.floatEq(x.edLoadFloat(e, f), edicts.f(e, f), `trial#${trial} e=${e} f=${f}`);
    }
    results.push(chk.report());
  }

  // --- pointcontents (#41) --------------------------------------------------------
  {
    const r = rng(0xD15EA60);
    const worldHull = makeEntityBoxHull(-1500, -900, -700, 1200, 1400, 1100, [0, 0, 0], [0, 0, 0]);
    x.initHullStorage(worldHull.clipnodes.length, worldHull.planes.length); // size pools like the live embedder
    x.setHullMeta(worldHull.firstclipnode, worldHull.lastclipnode);
    for (let i = 0; i < worldHull.planes.length; i++) { const p = worldHull.planes[i]; x.setPlane(i, p.normal[0], p.normal[1], p.normal[2], p.dist, p.type); }
    for (let i = worldHull.firstclipnode; i <= worldHull.lastclipnode; i++) { const n = worldHull.clipnodes[i]; x.setClipNode(i, n.planenum, n.children[0], n.children[1]); }

    const chk = new Check('dispatch: pointcontents (#41)');
    for (let iter = 0; iter < 5000; iter++) {
      const px = r.f32(2500), py = r.f32(2500), pz = r.f32(2500);
      wSetF(PARM0, px); wSetF(PARM0 + 1, py); wSetF(PARM0 + 2, pz);
      x.callBuiltin(BI.POINTCONTENTS);
      chk.floatEq(wGetF(RETURN), Math.fround(jsPointContents(worldHull, [px, py, pz])), `pc#${iter}`);
    }
    results.push(chk.report());
  }

  // --- droptofloor (#34) -----------------------------------------------------------
  {
    const r = rng(0xD15EA61);
    x.initEdicts(MAX_EDICTS, EDICT_SIZE_WORDS);
    x.initAreaTree(WORLD_MINS[0], WORLD_MINS[1], WORLD_MINS[2], WORLD_MAXS[0], WORLD_MAXS[1], WORLD_MAXS[2], MAX_EDICTS);
    const edicts = new JsEdicts(MAX_EDICTS);
    const links = []; for (let i = 0; i < MAX_EDICTS; i++) links.push({ prev: null, next: null, ent: null });
    const nodes = []; const root = createAreaNode(nodes, 0, WORLD_MINS, WORLD_MAXS);
    const worldHull = makeFloorHull(-180);
    loadWorldHullToWasm(worldHull);

    const NUM_ENTS = 30;
    for (let e = 2; e <= NUM_ENTS; e++) {
      const ox = r.f32(300), oy = r.f32(300), oz = r.f32(150);
      const hx = Math.abs(r.f32(100)) + 10, hy = Math.abs(r.f32(100)) + 10, hz = Math.abs(r.f32(8)) + 2;
      setEntityBoth(edicts, e, ox, oy, oz, hx, hy, hz, SOLID_BBOX, 0, 0);
      x.linkEdict(e); jsLinkEdict(edicts, links, root, e);
    }
    const SELF = 1;
    const chk = { ret: new Check('dispatch: droptofloor (#34) ret'), origin: new Check('dispatch: droptofloor (#34) origin/ground') };
    for (let iter = 0; iter < 5000; iter++) {
      const sx = r.f32(400), sy = r.f32(400), sz = r.f32(120);
      const hx = Math.abs(r.f32(20)) + 2, hy = Math.abs(r.f32(20)) + 2, hz = Math.abs(r.f32(20)) + 2;
      setEntityBoth(edicts, SELF, sx, sy, sz, hx, hy, hz, SOLID_SLIDEBOX, 0, 0);
      x.linkEdict(SELF); jsLinkEdict(edicts, links, root, SELF);
      wSetI(GLOBAL_SELF, SELF);
      x.callBuiltin(BI.DROPTOFLOOR);
      const wRet = wGetF(RETURN);
      const j = jsDropToFloor(edicts, links, root, worldHull, SELF);
      chk.ret.floatEq(wRet, j.ret, `dtf#${iter}`);
      if (j.ret === 1.0) {
        chk.origin.floatEq(x.edLoadFloat(SELF, F.ORIGIN2), edicts.f(SELF, F.ORIGIN2), `dtf#${iter} origin.z`);
        chk.origin.floatEq(x.edLoadFloat(SELF, F.FLAGS), edicts.f(SELF, F.FLAGS), `dtf#${iter} flags`);
        chk.origin.intEq(x.edLoadInt(SELF, F.GROUNDENTITY), edicts.i(SELF, F.GROUNDENTITY), `dtf#${iter} ground`);
      }
    }
    results.push(chk.ret.report(), chk.origin.report());
  }
}

// ================================================================================
// Section C: ftos (#26) / vtos (#27), via callBuiltin
// ================================================================================
{
  x = await newInstance(); g = x.globalsPtr();
  x.initStringTemp();

  function jsFtos(v) { return v === Math.floor(v) ? v.toString() : v.toFixed(1); }
  function jsVtos(vx, vy, vz) { return vx.toFixed(1) + ' ' + vy.toFixed(1) + ' ' + vz.toFixed(1); }
  function wasmReadString(ofs) {
    const len = x.readStringToScratch(ofs, x.maxScratch());
    const u8 = new Uint8Array(mem.buffer, x.scratchPtr(), len);
    let out = ''; for (let i = 0; i < len; i++) out += String.fromCharCode(u8[i]);
    return out;
  }

  const r = rng(0xF705F705);
  {
    const chk = new Check('dispatch: ftos (#26)');
    const values = [0, -0, 1, -1, 100, -100, 1000000, -1000000];
    for (let i = 0; i < 2000; i++) values.push(r.f32(2000));
    for (let i = 0; i < 500; i++) values.push(r.f32(0.01));
    for (let i = 0; i < 500; i++) values.push(r.f32(1e8));
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      wSetF(PARM0, v);
      x.callBuiltin(BI.FTOS);
      const wOfs = wGetI(RETURN);
      const wStr = wasmReadString(wOfs);
      const jStr = jsFtos(Math.fround(v));
      chk.intEq(wStr === jStr ? 1 : 0, 1, `ftos#${i} v=${v} wasm="${wStr}" js="${jStr}"`);
    }
    results.push(chk.report());
  }
  {
    const chk = new Check('dispatch: vtos (#27)');
    for (let i = 0; i < 3000; i++) {
      const vx = r.f32(4000), vy = r.f32(4000), vz = r.f32(4000);
      wSetF(PARM0, vx); wSetF(PARM0 + 1, vy); wSetF(PARM0 + 2, vz);
      x.callBuiltin(BI.VTOS);
      const wOfs = wGetI(RETURN);
      const wStr = wasmReadString(wOfs);
      const jStr = jsVtos(Math.fround(vx), Math.fround(vy), Math.fround(vz));
      chk.intEq(wStr === jStr ? 1 : 0, 1, `vtos#${i} wasm="${wStr}" js="${jStr}"`);
    }
    results.push(chk.report());
  }
}

// ================================================================================
// Section D: pure-inline passthrough — #68/#77 precache_file/_file2
// ================================================================================
{
  x = await newInstance(); g = x.globalsPtr();
  const chk = new Check('dispatch: precache_file/_file2 (#68/#77) pure passthrough');
  const r = rng(0xF11E);
  for (let i = 0; i < 500; i++) {
    const s = r.int(1 << 30);
    wSetI(PARM0, s);
    x.callBuiltin(i % 2 === 0 ? BI.PRECACHE_FILE : BI.PRECACHE_FILE2);
    chk.intEq(wGetI(RETURN), s, `precache_file#${i}`);
  }
  const noHostCall = !recorder.calls.precache && !recorder.calls.unimplemented;
  chk.intEq(noHostCall ? 1 : 0, 1, 'precache_file fired no host import');
  results.push(chk.report());
}

// ================================================================================
// Section E: host-service builtins — assert the right import fires w/ right args
// ================================================================================
{
  x = await newInstance(); g = x.globalsPtr();
  const chk = new Check('dispatch: host-service import routing');

  function last(name) { const c = recorder.calls[name]; return c && c[c.length - 1]; }
  // Mutate recorder.calls IN PLACE (the host_* import closures captured this
  // exact object at instantiation time -- reassigning recorder.calls to a new
  // object would desync the two).
  function reset() { for (const k in recorder.calls) delete recorder.calls[k]; }

  // dprint (#25) -> host_print(DPRINT, 0, PARM0)
  reset(); wSetI(PARM0, 12345); x.callBuiltin(BI.DPRINT);
  chk.intEq(last('print') ? 1 : 0, 1, 'dprint fired');
  if (last('print')) { const [lvl, ent, s] = last('print'); chk.intEq(lvl, 0, 'dprint level'); chk.intEq(ent, 0, 'dprint ent'); chk.intEq(s, 12345, 'dprint strOfs'); }

  // bprint (#23) -> host_print(BPRINT, 0, PARM0)
  reset(); wSetI(PARM0, 555); x.callBuiltin(BI.BPRINT);
  { const [lvl, ent, s] = last('print'); chk.intEq(lvl, 1, 'bprint level'); chk.intEq(s, 555, 'bprint strOfs'); }

  // sprint (#24) -> host_print(SPRINT, PARM0, PARM1)
  reset(); wSetI(PARM0, 3); wSetI(PARM1, 777); x.callBuiltin(BI.SPRINT);
  { const [lvl, ent, s] = last('print'); chk.intEq(lvl, 2, 'sprint level'); chk.intEq(ent, 3, 'sprint ent'); chk.intEq(s, 777, 'sprint strOfs'); }

  // centerprint (#73) -> host_print(CENTERPRINT, PARM0, PARM1)
  reset(); wSetI(PARM0, 4); wSetI(PARM1, 888); x.callBuiltin(BI.CENTERPRINT);
  { const [lvl, ent, s] = last('print'); chk.intEq(lvl, 3, 'centerprint level'); chk.intEq(ent, 4, 'centerprint ent'); chk.intEq(s, 888, 'centerprint strOfs'); }

  // break (#6) -> host_print(BREAK, 0, -1)
  reset(); x.callBuiltin(BI.BREAK);
  { const [lvl, ent, s] = last('print'); chk.intEq(lvl, 4, 'break level'); chk.intEq(s, -1, 'break strOfs sentinel'); }

  // error (#10) -> host_error(0, self, PARM0)
  reset(); wSetI(GLOBAL_SELF, 9); wSetI(PARM0, 111); x.callBuiltin(BI.ERROR);
  { const [kind, ent, s] = last('error'); chk.intEq(kind, 0, 'error kind'); chk.intEq(ent, 9, 'error ent'); chk.intEq(s, 111, 'error strOfs'); }

  // objerror (#11) -> host_error(1, self, PARM0)
  reset(); wSetI(GLOBAL_SELF, 10); wSetI(PARM0, 222); x.callBuiltin(BI.OBJERROR);
  { const [kind, ent, s] = last('error'); chk.intEq(kind, 1, 'objerror kind'); chk.intEq(ent, 10, 'objerror ent'); chk.intEq(s, 222, 'objerror strOfs'); }

  // sound (#8): ent=PARM0, chan=PARM1>>0, sampOfs=PARM2, vol=(PARM3*255)>>0, attn=PARM4
  reset(); wSetI(PARM0, 5); wSetF(PARM1, 2); wSetI(PARM2, 999); wSetF(PARM3, 1.0); wSetF(PARM4, 0.5);
  x.callBuiltin(BI.SOUND);
  { const [ent, chan, s, vol, attn] = last('sound'); chk.intEq(ent, 5, 'sound ent'); chk.intEq(chan, 2, 'sound chan'); chk.intEq(s, 999, 'sound sampOfs'); chk.intEq(vol, 255, 'sound vol'); chk.floatEq(attn, Math.fround(0.5), 'sound attn'); }

  // ambientsound (#74): org=PARM0(xyz), sampOfs=PARM1, vol=PARM2, attn=PARM3
  reset(); wSetF(PARM0, 1); wSetF(PARM0 + 1, 2); wSetF(PARM0 + 2, 3); wSetI(PARM1, 44); wSetF(PARM2, 0.8); wSetF(PARM3, 1.2);
  x.callBuiltin(BI.AMBIENTSOUND);
  { const [x_, y_, z_, s, vol, attn] = last('ambientsound'); chk.floatEq(x_, 1, 'ambient x'); chk.floatEq(y_, 2, 'ambient y'); chk.floatEq(z_, 3, 'ambient z'); chk.intEq(s, 44, 'ambient sampOfs'); }

  // particle (#48): org=PARM0, dir=PARM1, color=PARM2>>0, count=PARM3>>0
  reset(); wSetF(PARM0, 10); wSetF(PARM0 + 1, 20); wSetF(PARM0 + 2, 30);
  wSetF(PARM1, 1); wSetF(PARM1 + 1, 0); wSetF(PARM1 + 2, 0); wSetF(PARM2, 7); wSetF(PARM3, 12);
  x.callBuiltin(BI.PARTICLE);
  { const [ox, oy, oz, dx, dy, dz, color, count] = last('particle'); chk.intEq(color, 7, 'particle color'); chk.intEq(count, 12, 'particle count'); }

  // lightstyle (#35): style=PARM0>>0, strOfs=PARM1
  reset(); wSetF(PARM0, 3); wSetI(PARM1, 65); x.callBuiltin(BI.LIGHTSTYLE);
  { const [style, s] = last('lightstyle'); chk.intEq(style, 3, 'lightstyle style'); chk.intEq(s, 65, 'lightstyle strOfs'); }

  // makestatic (#69): ent=PARM0
  reset(); wSetI(PARM0, 42); x.callBuiltin(BI.MAKESTATIC);
  { const [ent] = last('makestatic'); chk.intEq(ent, 42, 'makestatic ent'); }

  // write* family: dest=PARM0>>0, value=PARM1, clientEnt=msg_entity
  reset(); wSetF(PARM0, 1); wSetI(MSG_ENTITY, 7); wSetF(PARM1, 200); x.callBuiltin(BI.WRITEBYTE);
  { const [kind, dest, ent, val] = last('msg_write'); chk.intEq(kind, 0, 'writebyte kind'); chk.intEq(dest, 1, 'writebyte dest'); chk.intEq(ent, 7, 'writebyte clientEnt'); chk.floatEq(val, 200, 'writebyte value'); }
  reset(); wSetF(PARM0, 2); wSetF(PARM1, -5); x.callBuiltin(BI.WRITECHAR);
  { const [kind] = last('msg_write'); chk.intEq(kind, 1, 'writechar kind'); }
  reset(); wSetF(PARM0, 0); wSetF(PARM1, 300); x.callBuiltin(BI.WRITESHORT);
  { const [kind] = last('msg_write'); chk.intEq(kind, 2, 'writeshort kind'); }
  reset(); wSetF(PARM0, 3); wSetF(PARM1, 70000); x.callBuiltin(BI.WRITELONG);
  { const [kind] = last('msg_write'); chk.intEq(kind, 3, 'writelong kind'); }
  reset(); wSetF(PARM0, 2); wSetF(PARM1, 123.5); x.callBuiltin(BI.WRITECOORD);
  { const [kind, , , val] = last('msg_write'); chk.intEq(kind, 4, 'writecoord kind'); chk.floatEq(val, Math.fround(123.5), 'writecoord value'); }
  reset(); wSetF(PARM0, 2); wSetF(PARM1, 45); x.callBuiltin(BI.WRITEANGLE);
  { const [kind] = last('msg_write'); chk.intEq(kind, 5, 'writeangle kind'); }
  reset(); wSetF(PARM0, 3); wSetI(PARM1, 909); x.callBuiltin(BI.WRITESTRING);
  { const [dest, ent, s] = last('msg_write_string'); chk.intEq(dest, 3, 'writestring dest'); chk.intEq(s, 909, 'writestring strOfs'); }
  reset(); wSetF(PARM0, 2); wSetI(PARM1, 17); x.callBuiltin(BI.WRITEENTITY);
  { const [dest, ent, ev] = last('msg_write_entity'); chk.intEq(dest, 2, 'writeentity dest'); chk.intEq(ev, 17, 'writeentity value'); }

  // stuffcmd (#21): clientEnt=PARM0, strOfs=PARM1
  reset(); wSetI(PARM0, 2); wSetI(PARM1, 456); x.callBuiltin(BI.STUFFCMD);
  { const [ent, s] = last('stuffcmd'); chk.intEq(ent, 2, 'stuffcmd ent'); chk.intEq(s, 456, 'stuffcmd strOfs'); }

  // localcmd (#46): strOfs=PARM0
  reset(); wSetI(PARM0, 654); x.callBuiltin(BI.LOCALCMD);
  { const [s] = last('localcmd'); chk.intEq(s, 654, 'localcmd strOfs'); }

  // cvar (#45): strOfs=PARM0 -> host_cvar_get returns f64, dispatch stores to RETURN
  reset(); recorder.cvarGetReturn = 3.5; wSetI(PARM0, 321); x.callBuiltin(BI.CVAR);
  { const [s] = last('cvar_get'); chk.intEq(s, 321, 'cvar strOfs'); chk.floatEq(wGetF(RETURN), Math.fround(3.5), 'cvar RETURN'); }

  // cvar_set (#72): nameOfs=PARM0, valueOfs=PARM1
  reset(); wSetI(PARM0, 11); wSetI(PARM1, 22); x.callBuiltin(BI.CVAR_SET);
  { const [n, v] = last('cvar_set'); chk.intEq(n, 11, 'cvar_set name'); chk.intEq(v, 22, 'cvar_set value'); }

  // precache_model/_sound (+*2 aliases): RETURN=PARM0 AND host_precache(kind, PARM0)
  for (const [bi, kind, label] of [[BI.PRECACHE_MODEL, 0, 'model'], [BI.PRECACHE_MODEL2, 0, 'model2'], [BI.PRECACHE_SOUND, 1, 'sound'], [BI.PRECACHE_SOUND2, 1, 'sound2']]) {
    reset(); wSetI(PARM0, 4242); x.callBuiltin(bi);
    chk.intEq(wGetI(RETURN), 4242, `precache_${label} RETURN`);
    const [k, s] = last('precache'); chk.intEq(k, kind, `precache_${label} kind`); chk.intEq(s, 4242, `precache_${label} strOfs`);
  }

  // changelevel (#70): strOfs=PARM0
  reset(); wSetI(PARM0, 8080); x.callBuiltin(BI.CHANGELEVEL);
  { const [s] = last('changelevel'); chk.intEq(s, 8080, 'changelevel strOfs'); }

  // random (#7): host_random() -> RETURN
  reset(); recorder.randomReturn = 0.42; x.callBuiltin(BI.RANDOM);
  chk.intEq(recorder.calls.random ? 1 : 0, 1, 'random fired');
  chk.floatEq(wGetF(RETURN), Math.fround(0.42), 'random RETURN');

  results.push(chk.report());
}

// ================================================================================
// Section F: unimplemented PURE builtins + unknown numbers -> host_unimplemented(n)
// ================================================================================
{
  x = await newInstance(); g = x.globalsPtr();
  const chk = new Check('dispatch: unimplemented routing');
  // Still unimplemented (zero-RETURN + host_unimplemented). CHECKCLIENT/AIM are real
  // now (pvs.ts / pf_aim — validated in their own suites; calling them on this bare
  // instance would walk uninitialized hull data), and SETSPAWNPARMS/INFOKEY route to
  // host_extbuiltin.
  const UNIMPLEMENTED = [
    BI.CHANGEPITCH, BI.TRACEON, BI.TRACEOFF, BI.TRACETOSS, BI.ETOS, BI.STOF,
  ];
  // coredump (#28) / eprint (#31) now route to host_extbuiltin -> the JS pf impls (the edict
  // store is shared, so ed.printEdicts/ed.print read live data).
  const EXTBRIDGED = [BI.COREDUMP, BI.EPRINT];
  function reset() { for (const k in recorder.calls) delete recorder.calls[k]; }
  for (const n of UNIMPLEMENTED) {
    reset();
    x.callBuiltin(n);
    const c = recorder.calls.unimplemented;
    chk.intEq(c && c.length === 1 && c[0][0] === n ? 1 : 0, 1, `unimplemented#${n}`);
  }
  for (const n of EXTBRIDGED) {
    reset();
    x.callBuiltin(n);
    chk.intEq(recorder.calls.unimplemented ? 1 : 0, 0, `extbridged-not-unimplemented#${n}`);
    chk.intEq(recorder.calls.extbuiltin && recorder.calls.extbuiltin.length === 1 ? 1 : 0, 1, `extbridged#${n}`);
  }
  // The now-wired STATELESS math builtins route to their real functions (not
  // host_unimplemented). Stateful ones (spawn/find/walkmove/...) are dispatch-routed
  // too but validated in their own module suites (they need edict/area state).
  for (const [bi, ref, label] of [
    [BI.FLOOR, Math.floor, 'floor'], [BI.CEIL, Math.ceil, 'ceil'], [BI.FABS, Math.abs, 'fabs'],
    [BI.SQRT, Math.sqrt, 'sqrt'], [BI.SIN, Math.sin, 'sin'], [BI.COS, Math.cos, 'cos'],
  ]) {
    reset(); wSetF(PARM0, 2.7); x.callBuiltin(bi);
    chk.intEq(recorder.calls.unimplemented ? 1 : 0, 0, `${label} not unimplemented`);
    chk.floatEq(wGetF(RETURN), Math.fround(ref(Math.fround(2.7))), `${label} routed`);
  }
  reset(); wSetF(PARM0, 2.7); x.callBuiltin(BI.RINT);
  chk.intEq(recorder.calls.unimplemented ? 1 : 0, 0, 'rint not unimplemented');
  // unknown / extension-table numbers below EXT_BUILTIN_BASE (default case)
  for (const n of [0, 5, 33, 39, 42, 50, 66, 71, 79, 90, 338, 627, 899]) { // 335-337 are wired now (effectinfo particles)
    reset();
    x.callBuiltin(n);
    const c = recorder.calls.unimplemented;
    chk.intEq(c && c.length === 1 && c[0][0] === n ? 1 : 0, 1, `default-case unimplemented#${n}`);
  }
  // EXT_BUILTIN_BASE (900) and up = the rerelease "= #0" builtins pr.loadProgs
  // numbers by name — bridged to their JS pf impls, never "unimplemented".
  for (const n of [900, 904, 9999]) {
    reset();
    x.callBuiltin(n);
    chk.intEq(recorder.calls.unimplemented ? 1 : 0, 0, `ext#${n} not unimplemented`);
    const c = recorder.calls.extbuiltin;
    chk.intEq(c && c.length === 1 && c[0][0] === n ? 1 : 0, 1, `ext#${n} -> host_extbuiltin`);
  }
  results.push(chk.report());
}

const ok = results.every(Boolean);
process.exit(ok ? 0 : 1);
