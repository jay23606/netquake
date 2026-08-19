import * as con from './console'
import * as pr from './pr'
import * as sv from './sv'
import * as pf from './pf'
import * as sys from './sys'
import * as q from './q'
import * as com from './com'
import * as host from './host'
import * as def from './def'
import * as cmd from './cmd'
import * as vec from './vec'
import type  { V3 } from './types/Vector.js'
import type  { Edict } from './types/Edict.js'
import { Entity } from './types'

type EdState = {
  getEvCache: Record<string, pr.Definition>
  // name -> def/index lookup maps, rebuilt when the progs (source array) changes.
  // findField/findGlobal/findFunction are O(n) scans otherwise, and savegame loading
  // calls them per-field per-entity — pathological on large maps.
  fieldCache: { src: pr.Definition[] | null, map: Map<string, pr.Definition> }
  globalCache: { src: pr.Definition[] | null, map: Map<string, pr.Definition> }
  functionCache: { src: pr.Function[] | null, map: Map<string, number> }
}

export const state: EdState = {
  getEvCache: {},
  fieldCache: { src: null, map: new Map() },
  globalCache: { src: null, map: new Map() },
  functionCache: { src: null, map: new Map() }
}

export const clearEdict = function (e: Edict) {
  var i;
  for (i = 0; i < pr.state.entityfields; ++i)
    e.v_int[i] = 0;
  e.free = false;
};

export const alloc = function () {
  var i, e;
  for (i = sv.state.svs.maxclients + 1; i < sv.state.server.num_edicts; ++i) {
    e = sv.state.server.edicts[i];
    if ((e.free === true) && ((e.freetime < 2.0) || ((sv.state.server.time - e.freetime) > 0.5))) {
      clearEdict(e);
      return e;
    }
  }
  if (sv.state.server.num_edicts >= def.max_edicts)
    sys.error('ED.Alloc: no free edicts');
  e = sv.ensureEdict(sv.state.server.num_edicts++); // lazily grows past the pre-allocated base
  clearEdict(e);
  return e;
};

export const free = function (ed: Edict) {
  sv.unlinkEdict(ed);
  ed.free = true;
  ed.v_int[pr.entvars.model] = 0;
  ed.v_float[pr.entvars.takedamage] = 0.0;
  ed.v_float[pr.entvars.modelindex] = 0.0;
  ed.v_float[pr.entvars.colormap] = 0.0;
  ed.v_float[pr.entvars.skin] = 0.0;
  ed.v_float[pr.entvars.frame] = 0.0;
  setVector(ed, pr.entvars.origin, vec.origin);
  setVector(ed, pr.entvars.angles, vec.origin);
  ed.v_float[pr.entvars.nextthink] = -1.0;
  ed.v_float[pr.entvars.solid] = 0.0;
  ed.freetime = sv.state.server.time;
	ed.alpha = 0;
	ed.onladder = false;
};

export const globalAtOfs = function (ofs: number) {
  var i, def;
  for (i = 0; i < pr.state.globaldefs.length; ++i) {
    def = pr.state.globaldefs[i];
    if (def.ofs === ofs)
      return def;
  }
};

export const fieldAtOfs = function (ofs: number) {
  var i, def;
  for (i = 0; i < pr.state.fielddefs.length; ++i) {
    def = pr.state.fielddefs[i];
    if (def.ofs === ofs)
      return def;
  }
};

export const findField = function (name: string) {
  const c = state.fieldCache;
  if (c.src !== pr.state.fielddefs) {
    c.src = pr.state.fielddefs; c.map = new Map();
    for (var i = 0; i < pr.state.fielddefs.length; ++i) {
      const nm = pr.getString(pr.state.fielddefs[i].name);
      if (!c.map.has(nm)) c.map.set(nm, pr.state.fielddefs[i]); // first match wins, as before
    }
  }
  return c.map.get(name);
};

export const findGlobal = function (name: string) {
  const c = state.globalCache;
  if (c.src !== pr.state.globaldefs) {
    c.src = pr.state.globaldefs; c.map = new Map();
    for (var i = 0; i < pr.state.globaldefs.length; ++i) {
      const nm = pr.getString(pr.state.globaldefs[i].name);
      if (!c.map.has(nm)) c.map.set(nm, pr.state.globaldefs[i]);
    }
  }
  return c.map.get(name);
};

export const findFunction = function (name: string) {
  const c = state.functionCache;
  if (c.src !== pr.state.functions) {
    c.src = pr.state.functions; c.map = new Map();
    for (var i = 0; i < pr.state.functions.length; ++i) {
      const nm = pr.getString(pr.state.functions[i].name);
      if (!c.map.has(nm)) c.map.set(nm, i);
    }
  }
  return c.map.get(name);
};

export const print = function (ed: Edict) {
  if (ed.free === true) {
    con.print('FREE\n');
    return;
  }
  con.print('\nEDICT ' + ed.num + ':\n');
  var i, d, name, v, l;
  for (i = 1; i < pr.state.fielddefs.length; ++i) {
    d = pr.state.fielddefs[i];
    name = pr.getString(d.name);
    if (name.charCodeAt(name.length - 2) === 95)
      continue;
    v = d.ofs;
    if (ed.v_int[v] === 0) {
      if ((d.type & 0x7fff) === 3) {
        if ((ed.v_int[v + 1] === 0) && (ed.v_int[v + 2] === 0))
          continue;
      }
      else
        continue;
    }
    for (; name.length <= 14;)
      name += ' ';
    // Pass the edict's backing buffer + ABSOLUTE word offset (v_int carries the byteOffset)
    // so this reads the right field whether storage is standalone or a slice of the WASM sim's
    // shared linear memory — `ed.v` is that whole memory in the shared case, not this edict.
    con.print(name + pr.valueString(d.type, ed.v_int.buffer as ArrayBuffer, (ed.v_int.byteOffset >> 2) + v) + '\n');
  }
};

export const printEdicts = function () {
  if (sv.state.server.phase !== 'active')
    return;
  con.print(sv.state.server.num_edicts + ' entities\n');
  var i;
  for (i = 0; i < sv.state.server.num_edicts; ++i)
    print(sv.state.server.edicts[i]);
};

export const printEdict_f = function () {
  if (sv.state.server.phase !== 'active')
    return;
  var i = q.atoi(cmd.state.argv[1]);
  if ((i >= 0) && (i < sv.state.server.num_edicts))
    print(sv.state.server.edicts[i]);
};

export const count = function () {
  if (sv.state.server.phase !== 'active')
    return;
  var i, ent, active = 0, models = 0, solid = 0, step = 0;
  for (i = 0; i < sv.state.server.num_edicts; ++i) {
    ent = sv.state.server.edicts[i];
    if (ent.free === true)
      continue;
    ++active;
    if (ent.v_float[pr.entvars.solid] !== 0.0)
      ++solid;
    if (ent.v_int[pr.entvars.model] !== 0)
      ++models;
    if (ent.v_float[pr.entvars.movetype] === sv.MOVE_TYPE.step)
      ++step;
  }
  var num_edicts = sv.state.server.num_edicts;
  con.print('num_edicts:' + (num_edicts <= 9 ? '  ' : (num_edicts <= 99 ? ' ' : '')) + num_edicts + '\n');
  con.print('active    :' + (active <= 9 ? '  ' : (active <= 99 ? ' ' : '')) + active + '\n');
  con.print('view      :' + (models <= 9 ? '  ' : (models <= 99 ? ' ' : '')) + models + '\n');
  con.print('touch     :' + (solid <= 9 ? '  ' : (solid <= 99 ? ' ' : '')) + solid + '\n');
  con.print('step      :' + (step <= 9 ? '  ' : (step <= 99 ? ' ' : '')) + step + '\n');
};

export const parseGlobals = async function (data: string) {
  var keyname, key;
  for (; ;) {
    data = com.parse(data);
    if (com.state.token.charCodeAt(0) === 125)
      return;
    if (data == null)
      sys.error('parseGlobals: EOF without closing brace');
    keyname = com.state.token;
    data = com.parse(data);
    if (data == null)
      sys.error('parseGlobals: EOF without closing brace');
    if (com.state.token.charCodeAt(0) === 125)
      sys.error('parseGlobals: closing brace without data');
    key = findGlobal(keyname);
    if (key == null) {
      con.print('\'' + keyname + '\' is not a global\n');
      continue;
    }
    if (parseEpair(pr.state.globals, key, com.state.token) !== true)
      host.throwError('parseGlobals: parse error');
  }
};

export const newString = function (string: string) {
  var newstring = [], i, c;
  for (i = 0; i < string.length; ++i) {
    c = string.charCodeAt(i);
    if ((c === 92) && (i < (string.length - 1))) {
      ++i;
      newstring[newstring.length] = (string.charCodeAt(i) === 110) ? '\n' : '\\';
    }
    else
      newstring[newstring.length] = String.fromCharCode(c);
  }
  return pr.newString(newstring.join(''), string.length + 1);
};

export const parseEpair = function (base: ArrayBuffer, key: pr.Definition, s: string) {
  var d_float = new Float32Array(base);
  var d_int = new Int32Array(base);
  var d, v;
  switch (key.type & 0x7fff) {
    case pr.ETYPE.ev_string:
      d_int[key.ofs] = newString(s);
      return true;
    case pr.ETYPE.ev_float:
      d_float[key.ofs] = q.atof(s);
      return true;
    case pr.ETYPE.ev_vector:
      v = s.split(' ');
      d_float[key.ofs] = q.atof(v[0]);
      d_float[key.ofs + 1] = q.atof(v[1]);
      d_float[key.ofs + 2] = q.atof(v[2]);
      return true;
    case pr.ETYPE.ev_entity:
      d_int[key.ofs] = q.atoi(s);
      return true;
    case pr.ETYPE.ev_field:
      d = findField(s);
      if (d == null) {
        con.print('Can\'t find field ' + s + '\n');
        return;
      }
      d_int[key.ofs] = d.ofs;
      return true;
    case pr.ETYPE.ev_function:
      d = findFunction(s);
      if (d == null) {
        con.print('Can\'t find function ' + s + '\n');
        return;
      }
      d_int[key.ofs] = d;
  }
  return true;
};

export const parseEdict = async function (data: string, ent: Edict) {
  var i, init, anglehack, keyname, n, key;
  if (ent !== sv.state.server.edicts[0]) {
    for (i = 0; i < pr.state.entityfields; ++i)
      ent.v_int[i] = 0;
  }
  for (; ;) {
    data = com.parse(data);
    if (com.state.token.charCodeAt(0) === 125)
      break;
    if (data == null)
      sys.error('parseEdict: EOF without closing brace');
    if (com.state.token === 'angle') {
      com.state.token = 'angles';
      anglehack = true;
    }
    else {
      anglehack = false;
      if (com.state.token === 'light')
        com.state.token = 'light_lev';
    }
    for (n = com.state.token.length; n > 0; --n) {
      if (com.state.token.charCodeAt(n - 1) !== 32)
        break;
    }
    keyname = com.state.token.substring(0, n);
    data = com.parse(data);
    if (data == null)
      sys.error('parseEdict: EOF without closing brace');
    if (com.state.token.charCodeAt(0) === 125)
      sys.error('parseEdict: closing brace without data');
    init = true;
    if (keyname.charCodeAt(0) === 95)
      continue;

    //johnfitz -- hack to support .alpha even when progs.dat doesn't know about it
    if (keyname === 'alpha')
      ent.alpha = pr.encodeAlpha(q.atof(com.state.token));
    //johnfitz
    key = findField(keyname);
    if (key == null) {
      if (keyname !== 'alpha' && keyname !== 'fog' && keyname !== 'sky')
        con.dPrint('\'' + keyname + '\' is not a field\n');
      continue;
    }
    if (anglehack == true)
      com.state.token = '0 ' + com.state.token + ' 0';
    if (parseEpair(ent.v, key, com.state.token) !== true)
      host.throwError('parseEdict: parse error');
  }
  if (init !== true)
    ent.free = true;
  return data;
};

// Port of QSS-M PR_spawnfunc_misc_model (pr_cmds.c:1850): resolve mdl->model, random
// yaw if negative (AD mimic), precache, then makestatic so it renders as a static prop.
const spawnMiscModel = (ent: Edict) => {
  if (!ent.v_int[pr.entvars.model]) {
    const mdl = findField('mdl');
    if (mdl != null && ent.v_int[mdl.ofs])
      ent.v_int[pr.entvars.model] = ent.v_int[mdl.ofs];
  }
  if (!pr.getString(ent.v_int[pr.entvars.model])) {
    free(ent); // no model to show
    return;
  }
  if (ent.v_float[pr.entvars.angles1] < 0.0)
    ent.v_float[pr.entvars.angles1] = Math.random() * 360.0;
  pr.state.globals_int[4] = ent.v_int[pr.entvars.model]; // OFS_PARM0
  pf.precache_model();
  ent.v_float[pr.entvars.modelindex] = sv.modelIndex(pr.getString(ent.v_int[pr.entvars.model]));
  pr.state.globals_int[4] = ent.num;
  pf.makestatic(); // frees the edict, emits a spawnstatic to the signon
};

export const loadFromFile = async function (data: string) {
  var ent, spawnflags, inhibit = 0, func;
  pr.state.globals_float[pr.globalvars.time] = sv.state.server.time;

  for (; ;) {
    data = com.parse(data);
    if (data == null)
      break;
    if (com.state.token.charCodeAt(0) !== 123)
      sys.error('ED.LoadFromFile: found ' + com.state.token + ' when expecting {');

    if (ent == null)
      ent = sv.state.server.edicts[0];
    else
      ent = alloc();
    data = await parseEdict(data, ent);

    spawnflags = ent.v_float[pr.entvars.spawnflags] >> 0;
    if (host.cvr.deathmatch.value !== 0) {
      if ((spawnflags & 2048) !== 0) {
        free(ent);
        ++inhibit;
        continue;
      }
    }
    else if (((host.state.current_skill === 0) && ((spawnflags & 256) !== 0))
      || ((host.state.current_skill === 1) && ((spawnflags & 512) !== 0))
      || ((host.state.current_skill >= 2) && ((spawnflags & 1024) !== 0))) {
      free(ent);
      ++inhibit;
      continue;
    }

    if (ent.v_int[pr.entvars.classname] === 0) {
      con.print('No classname for:\n');
      print(ent);
      free(ent);
      continue;
    }

    // DP_SV_SPAWNFUNC_PREFIX: modern progs (Progs_dump/Copper) register custom
    // entity spawns as spawnfunc_<classname>; try that before the bare classname
    // (matches QSS-M/FTE). Without this, such entities are dropped at map load.
    const classname = pr.getString(ent.v_int[pr.entvars.classname]);
    func = findFunction('spawnfunc_' + classname);
    if (func == null)
      func = findFunction(classname);
    if (func == null) {
      // misc_model has no QC spawn function — AD/DP maps place decorative external
      // models this way. Spawn it engine-side like QSS-M PR_spawnfunc_misc_model.
      if (classname === 'misc_model') {
        spawnMiscModel(ent);
        continue;
      }
      con.print('No spawn function for:\n');
      print(ent);
      free(ent);
      continue;
    }

    pr.state.globals_int[pr.globalvars.self] = ent.num;
    pr.executeProgram(func);
  }

  con.dPrint(inhibit + ' entities inhibited\n');
};

export const vector = function (e: Edict, o: number, out: V3): V3 {
  out[0] = e.v_float[o]; out[1] = e.v_float[o + 1]; out[2] = e.v_float[o + 2];
  return out;
};

// origin + view_ofs (the PVS/vis test point used by fatPVS and checkclient)
export const eyePosition = function (e: Edict, out: V3): V3 {
  out[0] = e.v_float[pr.entvars.origin] + e.v_float[pr.entvars.view_ofs];
  out[1] = e.v_float[pr.entvars.origin1] + e.v_float[pr.entvars.view_ofs1];
  out[2] = e.v_float[pr.entvars.origin2] + e.v_float[pr.entvars.view_ofs2];
  return out;
};

export const setVector = function (e: Edict, o: number, v: V3) {
  e.v_float[o] = v[0];
  e.v_float[o + 1] = v[1];
  e.v_float[o + 2] = v[2];
};

export const getEdictFieldValue = (ed: Edict, field: string) => {
  var def = null
  if (!state.getEvCache[field]) {
    def = findField(field)
    state.getEvCache[field] = def
  } else {
    def = state.getEvCache[field]
  }

  return ed.v_float[def.ofs]
}