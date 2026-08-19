// Savegame system: save/load commands, Ironwail autosave scoring + autoload, and the
// background serialization pipeline (vanilla host_cmd.c's Host_Savegame_f/Host_Loadgame_f
// plus Ironwail's Host_CheckAutosave/Host_AutoLoad/Host_BackgroundSave). Owns its state
// here rather than in HostState so host.init's reset can never wipe the injected worker
// factory or an in-flight save. serializeEdicts/SaveEdictsJob live in saveWorker.ts.

import * as sv from './sv'
import * as pr from './pr'
import * as cl from './cl'
import * as cmd from './cmd'
import * as com from './com'
import * as con from './console'
import * as cvar from './cvar'
import * as def from './def'
import * as mod from './mod'
import * as sys from './sys'
import * as ed from './ed'
import * as host from './host'
import * as scr from './scr'
import * as key from './key'
import * as msg from './msg'
import * as protocol from './protocol'
import { SaveEdictsJob, serializeEdicts } from './saveWorker'
import { Edict } from './types'

export type SaveState = {
  // Background savegame serialization (Ironwail Host_BackgroundSave design): injected by
  // the web layer (null under the dedicated server / no worker support -> inline fallback).
  createSaveWorker: (() => Worker) | null;
  saveWorker: Worker | null;
  saveSeq: number;
  pendingSave: Promise<void> | null;
  saveResolvers: Map<number, { resolve: (text: string) => void, reject: (e: unknown) => void }>;
  // Resolved fielddef names / function names, cached per progs load (rebuilt when
  // pr.state.fielddefs identity changes) so savegame_f doesn't re-resolve strings every save.
  saveDefs: { fielddefs: { name: string, type: number, ofs: number }[], functionNames: string[], forProgs: unknown } | null;
  // Snapshot buffers reused across saves (resized to fit the current map). Safe to reuse
  // because dispatchSave structured-clones the job and savegame_f awaits the previous
  // save before overwriting them.
  savePool: { edicts: Int32Array | null, free: Uint8Array | null, strings: Uint16Array | null };
}

export const state: SaveState = {
  createSaveWorker: null,
  saveWorker: null,
  saveSeq: 0,
  pendingSave: null,
  saveResolvers: new Map(),
  saveDefs: null,
  savePool: { edicts: null, free: null, strings: null }
}

export const cvr: cvar.CVars = {
}

// Ironwail Host_CheckAutosave: score-based automatic save while the player is safe.
export const checkAutosave = function()
{
  var ent = sv.state.svs.clients[0].edict;
  var health = ent.v_float[pr.entvars.health];
  if ((cvr.autosave.value === 0) || (cvr.autosaveInterval.value <= 0.0) || (sv.state.svs.maxclients !== 1) || (health <= 0.0) || (cl.clState != null && cl.clState.intermission !== 0))
    return;

  var autosave = sv.state.server.autosave;

  if (cl.cls.signon === 4)
  {
    // Track new secrets
    var secrets = pr.state.globals_float[pr.globalvars.found_secrets];
    if (secrets !== autosave.prevSecrets)
    {
      autosave.prevSecrets = secrets;
      autosave.secretBoost = 1.0;
    }
    else
      autosave.secretBoost = Math.max(0.0, autosave.secretBoost - host.state.frametime / 1.5);
  }

  // Track health changes
  if (!autosave.prevHealth)
    autosave.prevHealth = health;
  var healthChange = health - autosave.prevHealth;
  if (healthChange < 0.0)
  {
    var watertype = ent.v_float[pr.entvars.watertype];
    if ((healthChange < -3.0) || (health < 100.0) || (watertype === mod.CONTENTS.slime) || (watertype === mod.CONTENTS.lava))
      autosave.hurtTime = sv.state.server.time;
  }
  autosave.prevHealth = health;

  // Track attacking
  if (ent.v_float[pr.entvars.button0] !== 0)
    autosave.shootTime = sv.state.server.time;

  // Time spent with cheats active doesn't count
  var movetype = ent.v_float[pr.entvars.movetype];
  var flags = ent.v_float[pr.entvars.flags];
  if ((movetype === sv.MOVE_TYPE.noclip) || ((flags & (sv.FL.godmode | sv.FL.notarget)) !== 0))
  {
    autosave.cheat += host.state.frametime;
    return;
  }

  // Don't save if the player has been hurt recently
  if (sv.state.server.time - autosave.hurtTime < 3.0)
    return;

  // Don't save if the player has fired recently
  if (sv.state.server.time - autosave.shootTime < 3.0)
    return;

  // Only save when the player slows down a bit
  var vx = ent.v_float[pr.entvars.velocity];
  var vy = ent.v_float[pr.entvars.velocity + 1];
  var vz = ent.v_float[pr.entvars.velocity + 2];
  var speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
  if (speed > 100.0)
    return;

  // Copper's func_void holds the player at the bottom for a bit before inflicting damage,
  // so we can't assume it's safe to save just because we're no longer falling
  if (movetype === sv.MOVE_TYPE.none)
    return;

  // Don't save too often
  var elapsed = sv.state.server.time - autosave.time - autosave.cheat;
  if (elapsed < 3.0)
    return;

  // Compute a normalized autosave score

  // Base value is the fraction of the autosave interval already passed
  var score = elapsed / cvr.autosaveInterval.value;
  // Scale down the score if health + armor is below 100 (save less often with lower health)
  score *= Math.min(100.0, health + ent.v_float[pr.entvars.armortype] * ent.v_float[pr.entvars.armorvalue]) / 100.0;
  // Boost the score right after picking up health
  score += Math.max(0.0, healthChange) / 100.0;
  // Lower score a bit based on speed (favor standing still/slowing down)
  score -= (speed / 100.0) * 0.25;
  // Boost the score after finding a secret
  score += autosave.secretBoost * 0.25;
  // Boost the score after teleporting
  score += Math.min(Math.max(1.0 - (sv.state.server.time - ent.v_float[pr.entvars.teleport_time]) / 1.5, 0.0), 1.0) * 0.5;

  // Only save if the score is high enough
  if (score < 1.0)
    return;

  autosave.time = sv.state.server.time;
  autosave.cheat = 0;
  cmd.state.text += 'save "autosave/' + pr.getString(pr.state.globals_int[pr.globalvars.mapname]) + '" 0\n';
};

// Ironwail Host_AutoLoad: reload the last save instead of restarting the level.
// sv_autoload: 0 = off, 1 = ask (no modal support in this port -> treated as 2), 2 = when dead, 3 = always
export const autoLoad = async function(): Promise<boolean>
{
  if ((cvr.autoload.value === 0) || (sv.state.server.lastsave.length === 0) || (sv.state.svs.maxclients !== 1) || (cl.clState != null && cl.clState.intermission !== 0))
    return false;
  if ((cvr.autoload.value < 3) && (sv.state.svs.clients[0].edict.v_float[pr.entvars.health] > 0.0))
    return false;
  con.print('Autoloading...\n');
  // Server-on-worker: the sim runs on the Worker (dedicated), and the client is on the main
  // thread over a loopback connection. Loading here would run load_f on the worker ->
  // shutdownServer drops that loopback client (SVC.disconnect) with nothing to reconnect it
  // (CL.ReadFromServer: lost server connection), because spawnServer only re-issues the
  // `reconnect` stufftext while phase is still 'active'. So stuff the load to the client and
  // let its load_f worker branch drive the coordinated disconnect->reload->reconnect (the
  // same tested path as a manual `load`). Autoloading is single-player, so client 0 is the one.
  if (host.state.dedicated && sv.state.svs.clients[0] != null && sv.state.svs.clients[0].active === true) {
    const client = sv.state.svs.clients[0];
    msg.writeByte(client.message, protocol.SVC.stufftext);
    msg.writeString(client.message, 'load "' + sv.state.server.lastsave + '"\n');
    return true;
  }
  sv.state.server.autoloading = true;
  await cmd.executeString('load "' + sv.state.server.lastsave + '"', cmd.CMD_SOURCE.src_command);
  if (sv.state.server.autoloading === true)
  {
    sv.state.server.autoloading = false;
    con.print('Autoload failed!\n');
    return false;
  }
  return true;
};

// Sourced from server-side state (worldspawn message + kill globals) rather than
// the client's cl.clState mirror, so it also works on the headless worker server
// where save/autosave actually run. Identical values in-process.
const savegameComment = function()
{
  var levelname = pr.getString(sv.state.server.edicts[0].v_int[pr.entvars.message]);
  var text = levelname.replace(/\s/gm, '_');
  var i;
  for (i = levelname.length; i <= 21; ++i)
    text += '_';

  text += 'kills:';
  var kills = (pr.state.globals_float[pr.globalvars.killed_monsters] >> 0).toString();
  if (kills.length === 2)
    text += '_';
  else if (kills.length === 1)
    text += '__';
  text += kills + '/';
  kills = (pr.state.globals_float[pr.globalvars.total_monsters] >> 0).toString();
  if (kills.length === 2)
    text += '_';
  else if (kills.length === 1)
    text += '__';
  text += kills;

  return text + '____';
};

// Rebuilds the resolved fielddef/function-name snapshot used by the save worker, but only
// when progs changed since the last save (identity check against pr.state.fielddefs, same
// invalidation pattern as ed.ts's findField/findGlobal/findFunction caches).
const ensureSaveDefs = function()
{
  if ((state.saveDefs != null) && (state.saveDefs.forProgs === pr.state.fielddefs))
    return state.saveDefs;
  var fielddefs = [];
  var i;
  for (i = 0; i < pr.state.fielddefs.length; ++i)
  {
    var d = pr.state.fielddefs[i];
    fielddefs[i] = { name: pr.getString(d.name), type: d.type, ofs: d.ofs };
  }
  var functionNames = [];
  for (i = 0; i < pr.state.functions.length; ++i)
    functionNames[i] = pr.getString(pr.state.functions[i].name);
  state.saveDefs = { fielddefs: fielddefs, functionNames: functionNames, forProgs: pr.state.fielddefs };
  return state.saveDefs;
};

const ensureSaveWorker = function(): Worker
{
  if (state.saveWorker == null)
  {
    state.saveWorker = state.createSaveWorker!();
    state.saveWorker.onmessage = function(e: MessageEvent<{ seq: number, data: string }>)
    {
      var resolver = state.saveResolvers.get(e.data.seq);
      if (resolver == null)
        return;
      state.saveResolvers.delete(e.data.seq);
      resolver.resolve(e.data.data);
    };
    // Reject every outstanding job (each call site falls back to inline serialization) and
    // discard the worker: a worker whose script failed to load never fires another event,
    // so a job posted to it would leave its promise -- and pendingSave -- unsettled forever.
    var failWorker = function(e: unknown)
    {
      state.saveResolvers.forEach(function(resolver) { resolver.reject(e); });
      state.saveResolvers.clear();
      if (state.saveWorker != null)
      {
        state.saveWorker.terminate();
        state.saveWorker = null;
      }
    };
    state.saveWorker.onerror = failWorker;
    state.saveWorker.onmessageerror = failWorker;
  }
  return state.saveWorker;
};

// Dispatches the slow edict-serialization step off the main thread when a worker factory
// was injected (browser); serializes inline when not (dedicated server / no worker support).
const dispatchSave = function(job: SaveEdictsJob): Promise<string>
{
  if (state.createSaveWorker == null)
    return Promise.resolve(serializeEdicts(job));

  var worker = ensureSaveWorker();
  return new Promise<string>(function(resolve, reject)
  {
    // A wedged worker (hung job, silently-dead script) never fires another event; without
    // a deadline its unsettled promise would pin pendingSave/pendingCommand forever.
    var timer = setTimeout(function()
    {
      if (!state.saveResolvers.delete(job.seq))
        return;
      if (state.saveWorker != null)
      {
        state.saveWorker.terminate();
        state.saveWorker = null;
      }
      reject(new Error('save worker timed out'));
    }, 10000);
    state.saveResolvers.set(job.seq, {
      resolve: function(text) { clearTimeout(timer); resolve(text); },
      reject: function(e) { clearTimeout(timer); reject(e); }
    });
    // Structured-clone rather than transfer: a transferred job.edicts would be detached
    // on this thread, breaking the inline-serialization fallback if the worker errors.
    worker.postMessage(job);
  });
};

const savegame_f = async function()
{
  if (cmd.state.cmdSource !== cmd.CMD_SOURCE.src_command)
    return;
  // Server-on-worker: the real server state lives on the Worker, so serialize it
  // there (this thread's sv is dormant). The Worker shares this origin's IndexedDB
  // asset store, so the save it writes is readable back here for load.
  if (host.state.workerServer != null && !host.state.dedicated)
  {
    host.state.workerServer.sendCommand(cmd.state.argv.join(' '));
    return;
  }
  if (sv.state.server.phase !== 'active')
  {
    con.print('Not playing a local game.\n');
    return;
  }
  if (cl.clState != null && cl.clState.intermission !== 0)
  {
    con.print('Can\'t save in intermission.\n');
    return;
  }
  if (sv.state.svs.maxclients !== 1)
  {
    con.print('Can\'t save multiplayer games.\n');
    return;
  }
  if (cmd.state.argv.length < 2)
  {
    con.print('save <savename> : save a game\n');
    return;
  }
  var skipnotify = (cmd.state.argv.length > 2) && (parseFloat(cmd.state.argv[2]) === 0);
  if (cmd.state.argv[1].indexOf('..') !== -1)
  {
    con.print('Relative pathnames are not allowed.\n');
    return;
  }
  // argv is global tokenizer state -- capture before any await, or a command executed
  // while we wait (rcon path) retokenizes it under us.
  var name = com.defaultExtension(cmd.state.argv[1], '.sav');
  var client = sv.state.svs.clients[0];
  if (client.active === true)
  {
    if (client.edict.v_float[pr.entvars.health] <= 0.0)
    {
      con.print('Can\'t savegame with a dead player\n');
      return;
    }
  }

  // Ironwail Host_WaitForSaveThread: don't start a new save until the previous one
  // (worker serialization + file write) has fully finished. Must happen before BOTH the
  // header and the snapshot: frames can advance during the await (rcon path), and the
  // two halves must describe the same server tick; the pooled buffers also can't be
  // overwritten while a still-running save's inline fallback might read them.
  if (state.pendingSave != null)
    await state.pendingSave;

  var f = ['5\n' + savegameComment() + '\n'];
  var i;
  for (i = 0; i <= 15; ++i)
    f[f.length] = client.spawn_parms[i].toFixed(6) + '\n';
  f[f.length] = host.state.current_skill + '\n' + pr.getString(pr.state.globals_int[pr.globalvars.mapname]) + '\n' + sv.state.server.time.toFixed(6) + '\n';
  for (i = 0; i <= 63; ++i)
  {
    if (sv.state.server.lightstyles[i].length !== 0)
      f[f.length] = sv.state.server.lightstyles[i] + '\n';
    else
      f[f.length] = 'm\n';
  }
  f[f.length] = '{\n';
  var def_, type;
  for (i = 0; i < pr.state.globaldefs.length; ++i)
  {
    def_ = pr.state.globaldefs[i];
    type = def_.type;
    if ((type & 0x8000) === 0)
      continue;
    type &= 0x7fff;
    if ((type !== pr.ETYPE.ev_string) && (type !== pr.ETYPE.ev_float) && (type !== pr.ETYPE.ev_entity))
      continue;
    f[f.length] = '"' + pr.getString(def_.name) + '" "' + pr.uglyValueString(type, pr.state.globals, def_.ofs) + '"\n';
  }
  f[f.length] = '}\n';
  var header = f.join('');

  // Fast part stays on the main thread: snapshot each edict's field buffer, the free
  // mask and the pr string heap into the pooled typed arrays. Pools grow on demand and
  // shrink when a map needs less than half the capacity -- postMessage structured-clones
  // the ENTIRE underlying buffer (even for an exact-length subarray view), so retaining a
  // big map's high-water capacity would tax every later save with it.
  var edict, numEdicts = sv.state.server.num_edicts, entityFields = pr.state.entityfields;
  var pool = state.savePool;
  var need = numEdicts * entityFields;
  if ((pool.edicts == null) || (pool.edicts.length < need) || (pool.edicts.length > need * 2))
    pool.edicts = new Int32Array(need);
  if ((pool.free == null) || (pool.free.length < numEdicts) || (pool.free.length > numEdicts * 2))
    pool.free = new Uint8Array(numEdicts);
  var edicts = pool.edicts, free = pool.free;
  for (i = 0; i < numEdicts; ++i)
  {
    edict = sv.state.server.edicts[i];
    if (edict.free === true)
      free[i] = 1;
    else
    {
      free[i] = 0;  // pooled buffer keeps last save's flags -- both branches must write
      edicts.set(edict.v_int, i * entityFields);
    }
  }
  var stringsLen = pr.state.strings.length;
  if ((pool.strings == null) || (pool.strings.length < stringsLen) || (pool.strings.length > stringsLen * 2))
    pool.strings = new Uint16Array(stringsLen);
  pool.strings.set(pr.state.strings);
  // Exact-length view: the worker's getString bounds by strings.length, so the pooled
  // buffer's stale tail must not be visible (structured clone preserves view length).
  var strings = pool.strings.subarray(0, stringsLen);

  var defs = ensureSaveDefs();
  var job: SaveEdictsJob = {
    seq: ++state.saveSeq,
    numEdicts: numEdicts,
    entityFields: entityFields,
    edicts: edicts.buffer as ArrayBuffer,
    free: free,
    strings: strings,
    fielddefs: defs.fielddefs,
    functionNames: defs.functionNames
  };

  con.print('Saving game to ' + name + '...\n', skipnotify);

  // Slow part (text serialization) runs off the main thread; the game loop keeps ticking
  // while this promise is outstanding.
  var savePromise = (async function()
  {
    var edictsText: string;
    try
    {
      edictsText = await dispatchSave(job);
    }
    catch (e)
    {
      con.print('WARNING: savegame worker failed (' + e + '), serializing inline\n');
      edictsText = serializeEdicts(job);
    }
    if (await com.writeTextFile(name, header + edictsText) === true)
    {
      sv.state.server.lastsave = name;
      con.print('done.\n', skipnotify);
    }
    else
      con.print('ERROR: couldn\'t open.\n', skipnotify);
  })();
  state.pendingSave = savePromise;
  try
  {
    await savePromise;
  }
  finally
  {
    state.pendingSave = null;
  }
};

const loadgame_f = async function()
{
  if (cmd.state.cmdSource !== cmd.CMD_SOURCE.src_command)
    return;
  if (cmd.state.argv.length !== 2)
  {
    con.print('load <savename> : load a game\n');
    return;
  }
  // Server-on-worker: the sim and its collision data live on the Worker. Spawning +
  // restoring on this render-only thread would walk the dropped node/leaf objects
  // and crash (undefined.contents), so forward the load to the Worker, then
  // reconnect this thread's client to pick up the restored state (mirrors host.map_f).
  if (host.state.workerServer != null && !host.state.dedicated)
  {
    key.state.dest = key.KEY_DEST.game;
    scr.beginLoadingPlaque();
    cl.cls.demonum = -1;
    await cl.disconnect();
    // Wait for the worker to FULLY finish loadgame (spawnServer's async map load +
    // the edict restore) before connecting. Otherwise `connect local` reaches the
    // worker mid-load: the client spawns into a half-restored server (loadgame flag
    // not yet set -> fresh spawn), the restore then mutates edicts under it, and the
    // desynced connection stops receiving and times out (net_messagetimeout, ~10-40s).
    const loadDone = host.state.workerServer.nextCmdDone();
    host.state.workerServer.sendCommand('load ' + cmd.state.argv[1]);
    await loadDone;
    await cmd.executeString('connect local', cmd.CMD_SOURCE.src_command);
    return;
  }
  // argv is global tokenizer state -- capture before the await below can let other
  // commands retokenize it (rcon path).
  var name = com.defaultExtension(cmd.state.argv[1], '.sav');
  // Ironwail Host_WaitForSaveThread: don't read a save file while a background save
  // (which may target the same file) is still in flight.
  if (state.pendingSave != null)
    await state.pendingSave;
  cl.cls.demonum = -1;
  con.print('Loading game from ' + name + '...\n');
  var f = await com.loadTextFile(name);
  if (f == null)
  {
    con.print('ERROR: couldn\'t open.\n');
    return;
  }
  var flines = f.split('\n');

  var i;

  var tfloat = parseFloat(flines[0]);
  if (tfloat !== 5)
  {
    con.print('Savegame is version ' + tfloat + ', not 5\n');
    return;
  }

  var spawn_parms = [];
  for (i = 0; i <= 15; ++i)
    spawn_parms[i] = parseFloat(flines[2 + i]);

  host.state.current_skill = (parseFloat(flines[18]) + 0.1) >> 0;
  cvar.setValue('skill', host.state.current_skill);

  var time = parseFloat(flines[20]);
  // Dedicated worker has no client connection to tear down (and cl.disconnect touches
  // client-only state); the worker-mode client disconnected on the main thread already.
  if (!host.state.dedicated)
    await cl.disconnect();
  // Cleanly tear down the old server before respawning, exactly as host.map_f does.
  // Without it the reconnecting worker-mode client races the reload: its `connect local`
  // reaches the still-active old server, which spawnServer then resets out from under it
  // (NET.GetMessage: disconnected socket -> lost server connection).
  await host.shutdownServer(false);
  await sv.spawnServer(flines[19]);
  if (sv.state.server.phase !== 'active')
  {
    con.print('Couldn\'t load map\n');
    return;
  }
  sv.state.server.paused = true;
  sv.state.server.spawnKind = 'savegame';

  for (i = 0; i <= 63; ++i)
    sv.state.server.lightstyles[i] = flines[21 + i];

  var token, keyname, keydef, i;

  if (flines[85] !== '{')
    sys.error('First token isn\'t a brace');
  for (i = 86; i < flines.length; ++i)
  {
    if (flines[i] === '}')
    {
      ++i;
      break;
    }
    token = flines[i].split('"');
    keyname = token[1];
    keydef = ed.findGlobal(keyname);
    if (keydef == null)
    {
      con.print('\'' + keyname + '\' is not a global\n');
      continue;
    }
    if (ed.parseEpair(pr.state.globals, keydef, token[3]) !== true)
      await host.error('Host.Loadgame_f: parse error');
  }

  flines[flines.length] = '';
  var entnum = 0, ent: Edict, j;
  var data = flines.slice(i).join('\n');
  for (;;)
  {
    data = com.parse(data);
    if (data == null)
      break;
    if (com.state.token.charCodeAt(0) !== 123)
      sys.error('Host.Loadgame_f: found ' + com.state.token + ' when expecting {');
    if (entnum >= def.max_edicts)
      sys.error('Host.Loadgame_f: too many edicts in savegame');
    ent = sv.ensureEdict(entnum++); // lazily grows past the pre-allocated base
    for (j = 0; j < pr.state.entityfields; ++j)
      ent.v_int[j] = 0;
    ent.free = false;
    data = await ed.parseEdict(data, ent);
    // @ts-ignore  the above may have mutated this object. Yay side-effects!
    if (ent.free !== true)
      sv.linkEdict(ent, false);
  }
  sv.state.server.num_edicts = entnum;

  sv.state.server.time = time;
  var client = sv.state.svs.clients[0];
  client.spawn_parms = [];
  for (i = 0; i <= 15; ++i)
    client.spawn_parms[i] = spawn_parms[i];
  sv.state.server.lastsave = name;
  sv.state.server.autosave.time = time;
  // The dedicated worker has no local client to connect -- the worker-mode client
  // reconnects from the main thread (see the workerServer branch above). Running
  // this here on the worker would connect its dormant client to itself and corrupt
  // the restored server state the real client is about to sign on to.
  if (!host.state.dedicated)
  {
    await cl.establishConnection('local');
    host.reconnect_f();
  }
};

export const init = function()
{
  cvr.autosave = cvar.registerVariable('sv_autosave', '1', true);
  cvr.autosaveInterval = cvar.registerVariable('sv_autosave_interval', '30', true);
  cvr.autoload = cvar.registerVariable('sv_autoload', '2', true);
  cmd.addCommand('load', loadgame_f);
  cmd.addCommand('save', savegame_f);
};
