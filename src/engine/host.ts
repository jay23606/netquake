import * as sv from './sv'
import * as cmd from './cmd'
import * as com from './com'
import * as chase from './chase'
import * as sys from './sys'
import * as con from './console'
import * as cl from './cl'
import * as v from './v'
import * as w from './w'
import * as key from './key'
import * as pr from './pr'
import * as mod from './mod'
import * as net from './net'
import * as vid from './vid'
import * as draw from './draw'
import * as scr from './scr'
import * as r from './r'
import * as msg from './msg'
import * as s from './s'
import * as cdAudio from './cdAudio'
import * as sbar from './sbar'
import * as m from './m'
import * as input from './input'
import * as cvar from './cvar'
import * as def from './def'
import * as protocol from './protocol'
import * as q from './q'
import * as vec from './vec'
import * as sz from './sz'
import * as tx from './texture'
import * as mapAlpha from './mapAlpha'
import * as fog from './fog'
import * as sky from './sky'
import * as save from './save'
import * as loc from './loc'

import IAssetStore from './interfaces/store/IAssetStore';
import INetworkDriver from './interfaces/net/INetworkDriver';
import { Client } from './types/Client'

export type HostState = {
  timetotal: number;
  timecount: number;
  inerror: boolean;
  realtime: number;
  oldrealtime: number;
  initialized: boolean;
  frametime: number;
  // QSS renderer/server isolation: server tick interval (1/72 when host_maxfps > 72, 0 = coupled)
  netinterval: number;
  // render time accumulated toward the next server tick
  accumtime: number;
  client: null | Client;
  framecount: number;
  dedicated: boolean;
  connectOnLoad: string;
  serverId: string;
  startdemos: boolean;
  noclip_anglehack: boolean;
  current_skill: number;
  isdown: boolean;
  // perf_stats: ring buffer of wall-clock ms between successive _frame calls
  frameTimesMs: Float64Array;
  frameTimeCursor: number;
  frameTimeTotal: number;
  lastFrameTimestamp: number;
  // Server-on-worker: when set, map/changelevel run the server in a Worker and
  // this thread is a pure client connecting over the worker-loop transport.
  workerServer: { sendCommand: (text: string) => void, nextCmdDone: () => Promise<void> } | null;
  // Opt-in WASM-sim server backend (set by the app layer when sv_wasm=1). Null = the
  // JS server runs the physics frame. See src/app/game/net/wasmServer.ts.
  wasmServer: { frame: () => void, isReady: () => boolean } | null;
  // App-provided async activator (loads the current map into the WASM sim + sets
  // wasmServer). serverFrame triggers it once per map when sv_wasm=1; wasmActivating
  // guards against re-triggering while the async load is in flight.
  wasmServerActivate: (() => void) | null;
  wasmActivating: boolean;
}

const emptyState = (): HostState => ({
  timetotal: 0.0,
  timecount: 0,
  inerror: false,
  realtime: 0.0,
  oldrealtime: 0.0,
  initialized: false,
  frametime: 0.0,
  netinterval: 0.0,
  accumtime: 0.0,
  client: null,
  framecount: 0,
  dedicated: false,
  connectOnLoad: '',
  serverId: '',
  startdemos: false,
  noclip_anglehack: false,
  current_skill: 0,
  isdown: false,
  frameTimesMs: new Float64Array(512),
  frameTimeCursor: 0,
  frameTimeTotal: 0,
  lastFrameTimestamp: 0,
  workerServer: null,
  wasmServer: null,
  wasmServerActivate: null,
  wasmActivating: false
})

export let state: HostState = emptyState()

export const cvr: cvar.CVars = {
}

export const endGame = async function(message: string)
{
  con.dPrint('Host.EndGame: ' + message + '\n');
  if (cl.cls.demonum !== -1)
    cl.nextDemo();
  else
    await cl.disconnect();
  throw 'Host.abortserver';
};

export class HostError extends Error {}
export class HostEndGame extends Error {}

export const throwError = (message: string): never => {
  throw new HostError(message);
};

export const throwEndGame = (message: string): never => {
  throw new HostEndGame(message);
};

const findMaxClients = function()
{
	var mpArg = com.checkParm('-maxplayers');
	var listenArg = com.checkParm('-listen');
  
	sv.state.svs.maxclients = listenArg || state.dedicated ? 8 : 1
	if (mpArg != null)
	{
		++mpArg;
		if (mpArg < com.state.argv.length)
		{
			sv.state.svs.maxclients = q.atoi(com.state.argv[mpArg]);
			if (sv.state.svs.maxclients <= 0)
                sv.state.svs.maxclients = 8;
			else if (sv.state.svs.maxclients > 16)
                sv.state.svs.maxclients = 16;
		} 
	}

  sv.state.svs.maxclientslimit = sv.state.svs.maxclients;
  cl.cls.state = cl.ACTIVE.disconnected;
  sv.state.svs.clients = []
	for (var i = 0; i < sv.state.svs.maxclientslimit; ++i)
	{
    sv.state.svs.clients[i] = {
      num: i,
      message: Object.assign(sz.newDatagram(def.max_message), { allowoverflow: true }),
      colors: 0,
      old_frags: 0,
      name: '',
      active: false, 
      spawn_parms: [],
      dropasap: false,
      cmd: {forwardmove: 0, sidemove: 0, upmove:0 },
      wishdir: vec.emptyV3(),
      spawned: false,
      sendsignon: false,
      reconnect: false,
      lastspoke: 0,
      lockedtill: 0,
      floodprotmessage: 0
    };
  }
	if (sv.state.svs.maxclients > 1)
		cvar.setValue('deathmatch', 1);
	else
		cvar.setValue('deathmatch', 0);
};

const clientPrint = function(string: string)
{
  msg.writeByte(state.client.message, protocol.SVC.print);
  msg.writeString(state.client.message, string);
};

export const broadcastPrint = function(string: string)
{
  var i, client;
  for (i = 0; i < sv.state.svs.maxclients; ++i)
  {
    client = sv.state.svs.clients[i];
    if ((client.active !== true) || (client.spawned !== true))
      continue;
    msg.writeByte(client.message, protocol.SVC.print);
    msg.writeString(client.message, string);
  }
};

export const dropClient = function(crash: boolean)
{
  var client = state.client;
  if (crash !== true)
  {
    if (net.canSendMessage(client.netconnection) === true)
    {
      msg.writeByte(client.message, protocol.SVC.disconnect);
      net.sendMessage(client.netconnection, client.message);
    }
    if ((client.edict != null) && (client.spawned === true))
    {
      var saveSelf = pr.state.globals_int[pr.globalvars.self];
      pr.state.globals_int[pr.globalvars.self] = client.edict.num;
      pr.executeProgram(pr.state.globals_int[pr.globalvars.ClientDisconnect]);
      pr.state.globals_int[pr.globalvars.self] = saveSelf;
    }
    sys.print('Client ' + sv.getClientName(client) + ' removed\n');
  }
  net.close(client.netconnection);
  client.netconnection = null;
  client.active = false;
  sv.setClientName(client, '');
  client.old_frags = -999999;
  --net.state.activeconnections;
  var i, num = client.num;
  for (i = 0; i < sv.state.svs.maxclients; ++i)
  {
    client = sv.state.svs.clients[i];
    if (client.active !== true)
      continue;
    msg.writeByte(client.message, protocol.SVC.updatename);
    msg.writeByte(client.message, num);
    msg.writeByte(client.message, 0);
    msg.writeByte(client.message, protocol.SVC.updatefrags);
    msg.writeByte(client.message, num);
    msg.writeShort(client.message, 0);
    msg.writeByte(client.message, protocol.SVC.updatecolors);
    msg.writeByte(client.message, num);
    msg.writeByte(client.message, 0);
  }
};

const writeConfiguration = function()
{
  com.writeTextFile('config.cfg', key.writeBindings() + cvar.writeVariables());
};

const serverFrame = function()
{
  pr.state.globals_float[pr.globalvars.frametime] = state.frametime;
  sv.state.server.datagram.cursize = 0;
  sv.checkForNewClients();
  // The WASM physicsClient COMPOSES clientThink into the physics pass (usercmd -> clientThink ->
  // PlayerPreThink). When the wasm frame will run this tick, runClients must NOT also apply it —
  // that double-ran friction/accelerate/punchangle-decay on players every tick (both writes land
  // in the shared zero-copy store). Decided BEFORE the activation trigger below: activation is
  // async, so useWasm can't flip between here and the physics branch within one tick.
  // QSS-M sv_user.c SV_RunClients gates SV_ClientThink with the SAME pause/console condition as
  // physics (`if (!sv.paused && (svs.maxclients > 1 || key_dest == key_game)) SV_ClientThink()`),
  // so clientThink runs ONLY on physics ticks — and on the JS path only (wasm composes its own).
  const runPhysics = (sv.state.server.paused !== true) && ((sv.state.svs.maxclients >= 2) || (key.state.dest === key.KEY_DEST.game));
  const useWasm = state.wasmServer != null && state.wasmServer.isReady() && cvr.wasm != null && cvr.wasm.value !== 0;
  sv.runClients(!runPhysics || useWasm);
  // Opt-in WASM server backend: activate it once per map when sv_wasm=1 (async load;
  // JS physics runs until it's ready). state.wasmServer is reset on each spawnServer.
  if (cvr.wasm != null && cvr.wasm.value !== 0 && sv.state.server.phase === 'active' &&
      state.wasmServer == null && !state.wasmActivating && state.wasmServerActivate != null)
    state.wasmServerActivate();
  if (runPhysics) {
    if (useWasm)
      state.wasmServer!.frame();   // WASM backend; useWasm re-checks the cvar so sv_wasm 1->0 falls back live
    else
      sv.physics();
  }
  sv.sendClientMessages();
  save.checkAutosave();
};

export const remoteCommand = function(from: string, data: string, password: string)
{
	if ((cvr.rcon_password.string.length === 0) || (password !== cvr.rcon_password.string))
	{
		con.print('Bad rcon from ' + from + ':\n' + data + '\n');
		return;
	};
	con.print('Rcon from ' + from + ':\n' + data + '\n');
	cmd.executeString(data, cmd.CMD_SOURCE.src_command);
	return true;
};

const getConsoleCommands = function()
{
	var command;
	for (;;)
	{
		command = sys.getExternalCommand();
		if (command == null)
			return;
		cmd.state.text += command;
	}
};

const _frame = async function()
{
  vec.resetScratch();

  const frameTimestamp = performance.now();
  if (state.lastFrameTimestamp !== 0)
  {
    state.frameTimesMs[state.frameTimeCursor] = frameTimestamp - state.lastFrameTimestamp;
    state.frameTimeCursor = (state.frameTimeCursor + 1) % state.frameTimesMs.length;
    ++state.frameTimeTotal;
  }
  state.lastFrameTimestamp = frameTimestamp;

  state.realtime = sys.floatTime();
  state.frametime = state.realtime - state.oldrealtime;
  state.oldrealtime = state.realtime;
  if (cvr.framerate.value > 0)
    state.frametime = cvr.framerate.value;
  else
  {
    if (state.frametime > 0.1)
      state.frametime = 0.1;
    else if (state.frametime < 0.001)
      state.frametime = 0.001;
  }

  if (cl.cls.state === cl.ACTIVE.connecting)
  {
    await net.checkForResend();
    if (!state.dedicated){
      scr.updateScreen();
    }
    return;
  }

  cmd.execute();

  // Everything below assumes commands completed (the old awaited-execute
  // semantics) — an async command like map/restart tears the server down
  // across its awaits, so stall the frame until it resolves.
  if (cmd.state.pendingCommand != null)
    return;

  // QSS download extension: check for pending downloads before sending prespawn
  if (cl.cls.sendprespawn && cl.cls.state === cl.ACTIVE.connected) {
    const done = await cl.checkDownloads();
    if (done) {
      cl.cls.sendprespawn = false;
      msg.writeByte(cl.cls.message, protocol.CLC.stringcmd);
      msg.writeString(cl.cls.message, 'prespawn');
    } else if (cl.cls.message.cursize === 0 && !cl.dlState.download.data) {
      // Send NOP keepalive only when not actively downloading — during
      // downloads, nqnetchan ACKs for incoming server packets serve as
      // keepalive, and NOPs would block the reliable channel
      msg.writeByte(cl.cls.message, protocol.CLC.nop);
    }
  }

  cl.accumulateCmd();

  // QSS renderer/server isolation: above 72fps the server steps at a fixed ~72Hz
  // so physics dt never shrinks below vanilla's (dt-sensitive code like pusher/rider
  // ground contact breaks otherwise); the client renders every frame and interpolates.
  state.netinterval = (cvr.maxfps.value > 72 || cvr.maxfps.value <= 0) ? 1.0 / 72.0 : 0.0;
  if (state.netinterval > 0)
    state.accumtime += state.frametime;
  if (state.netinterval === 0 || state.accumtime >= state.netinterval)
  {
    const realframetime = state.frametime;
    if (state.netinterval > 0)
    {
      state.frametime = state.accumtime > state.netinterval ? state.accumtime : state.netinterval;
      state.accumtime -= state.frametime;
      if (state.frametime > 0.1)
        state.frametime = 0.1;
    }
    cl.sendCmd();
    if (sv.state.server.phase === 'active')
      serverFrame();
    state.frametime = realframetime;
  }

  if (cl.cls.state === cl.ACTIVE.connected)
    await cl.readFromServer();
  
  if (!state.dedicated) {
    scr.updateScreen();
  }

  if (!state.dedicated) {
    if (cl.cls.signon === 4)
    {
      s.update(r.state.refdef.vieworg, r.state.vpn, r.state.vright, r.state.vup);
      cl.decayLights();
    }
    else
      s.update(vec.scratch(), vec.scratch(), vec.scratch(), vec.scratch());
    cdAudio.update();
  
    if (state.connectOnLoad) {
      const url = state.connectOnLoad
      state.connectOnLoad = null
      await cl.establishConnection(url);
    } else if (state.startdemos === true)
    {
      cl.nextDemo();
      state.startdemos = false;
    }
  }
  getConsoleCommands()
  ++state.framecount;
};

// Commands

export const quit_f = function()
{
  if (key.state.dest !== key.KEY_DEST.console)
  {
    m.menu_Quit_f();
    return;
  }
  sys.quit();
};

const maskIp = (ip: string) => {
  if (ip.indexOf('.') > 3) {
    const split = ip.split('.')
    split.pop()
    return split.join('.') + '.xxx'
  } else if(ip.indexOf(':') > 6) {
    const split = ip.split(':')
    split.pop()
    return split.join(':') + ':xxxx'
  } else {
    return ip
  }
}

const status_f = function()
{
  var print;
  if (cmd.state.cmdSource !== cmd.CMD_SOURCE.src_client)
  {
    if (sv.state.server.phase !== 'active')
    {
      cmd.forwardToServer();
      return;
    }
    print = con.print;
  }
  else
    print = clientPrint;
  print('host:    ' + net.cvr.hostname.string + '\n');
  print('version: 1.09\n');
  print('map:     ' + pr.getString(pr.state.globals_int[pr.globalvars.mapname]) + '\n');
  print('players: ' + net.state.activeconnections + ' active (' + sv.state.svs.maxclients + ' max)\n\n');
  var i, client: Client, str, frags, hours, minutes, seconds;
  for (i = 0; i < sv.state.svs.maxclients; ++i)
  {
    client = sv.state.svs.clients[i];
    if (client.active !== true)
      continue;
    frags = client.edict.v_float[pr.entvars.frags].toFixed(0);
    if (frags.length === 1)
      frags = '  ' + frags;
    else if (frags.length === 2)
      frags = ' ' + frags;
    seconds = (net.state.time - client.netconnection.connecttime) >> 0;
    minutes = (seconds / 60) >> 0;
    if (minutes !== 0)
    {
      seconds -= minutes * 60;
      hours = (minutes / 60) >> 0;
      if (hours !== 0)
        minutes -= hours * 60;
    }
    else
      hours = 0;
    str = '#' + (i + 1) + ' ';
    if (i <= 8)
      str += ' ';
    str += sv.getClientName(client);
    for (; str.length <= 21; )
      str += ' ';
    str += frags + '  ';
    if (hours <= 9)
      str += ' ';
    str += hours + ':';
    if (minutes <= 9)
      str += '0';
    str += minutes + ':';
    if (seconds <= 9)
      str += '0';
    print(str + seconds + '\n');
    if (cmd.state.cmdSource !== cmd.CMD_SOURCE.src_client) {
      print('   ' + client.netconnection.address + '\n');
    } else {
      
      print('   ' + maskIp(client.netconnection.address) + '\n');
    }
  }
};

const god_f = function()
{
  if (cmd.state.cmdSource !== cmd.CMD_SOURCE.src_client)
  {
    cmd.forwardToServer();
    return;
  }
  if (pr.state.globals_float[pr.globalvars.deathmatch] !== 0)
    return;
  sv.state.player.v_float[pr.entvars.flags] ^= sv.FL.godmode;
  if ((sv.state.player.v_float[pr.entvars.flags] & sv.FL.godmode) === 0)
    clientPrint('godmode OFF\n');
  else
    clientPrint('godmode ON\n');
};

const notarget_f = function()
{
  if (cmd.state.cmdSource !== cmd.CMD_SOURCE.src_client)
  {
    cmd.forwardToServer();
    return;
  }
  if (pr.state.globals_float[pr.globalvars.deathmatch] !== 0)
    return;
  sv.state.player.v_float[pr.entvars.flags] ^= sv.FL.notarget;
  if ((sv.state.player.v_float[pr.entvars.flags] & sv.FL.notarget) === 0)
    clientPrint('notarget OFF\n');
  else
    clientPrint('notarget ON\n');
};

const noclip_f = function()
{
  if (cmd.state.cmdSource !== cmd.CMD_SOURCE.src_client)
  {
    cmd.forwardToServer();
    return;
  }
  if (pr.state.globals_float[pr.globalvars.deathmatch] !== 0)
    return;
  if (sv.state.player.v_float[pr.entvars.movetype] !== sv.MOVE_TYPE.noclip)
  {
    state.noclip_anglehack = true;
    sv.state.player.v_float[pr.entvars.movetype] = sv.MOVE_TYPE.noclip;
    clientPrint('noclip ON\n');
    return;
  }
  state.noclip_anglehack = false;
  sv.state.player.v_float[pr.entvars.movetype] = sv.MOVE_TYPE.walk;
  clientPrint('noclip OFF\n');
};

// QSS host.c Host_SetPos_f -- teleport the local player (implies noclip)
const setpos_f = function()
{
  if (cmd.state.cmdSource !== cmd.CMD_SOURCE.src_client)
  {
    cmd.forwardToServer();
    return;
  }
  if (cmd.state.argv.length !== 4)
  {
    clientPrint('usage: setpos x y z\n');
    return;
  }
  const player = sv.state.player;
  if (player.v_float[pr.entvars.movetype] !== sv.MOVE_TYPE.noclip)
  {
    state.noclip_anglehack = true;
    player.v_float[pr.entvars.movetype] = sv.MOVE_TYPE.noclip;
    clientPrint('noclip ON\n');
  }
  player.v_float[pr.entvars.velocity] = 0.0;
  player.v_float[pr.entvars.velocity + 1] = 0.0;
  player.v_float[pr.entvars.velocity + 2] = 0.0;
  player.v_float[pr.entvars.origin] = q.atof(cmd.state.argv[1]);
  player.v_float[pr.entvars.origin + 1] = q.atof(cmd.state.argv[2]);
  player.v_float[pr.entvars.origin + 2] = q.atof(cmd.state.argv[3]);
  sv.linkEdict(player, false);
};

const fly_f = function()
{
  if (cmd.state.cmdSource !== cmd.CMD_SOURCE.src_client)
  {
    cmd.forwardToServer();
    return;
  }
  if (pr.state.globals_float[pr.globalvars.deathmatch] !== 0)
    return;
  if (sv.state.player.v_float[pr.entvars.movetype] !== sv.MOVE_TYPE.fly)
  {
    sv.state.player.v_float[pr.entvars.movetype] = sv.MOVE_TYPE.fly;
    clientPrint('flymode ON\n');
    return;
  }
  sv.state.player.v_float[pr.entvars.movetype] = sv.MOVE_TYPE.walk;
  clientPrint('flymode OFF\n');
};

const ping_f = function()
{
  if (cmd.state.cmdSource !== cmd.CMD_SOURCE.src_client)
  {
    cmd.forwardToServer();
    return;
  }
  

  clientPrint('Client ping times:\n');
  var i, client: Client, total, j;
  for (i = 0; i < sv.state.svs.maxclients; ++i)
  {
    client = sv.state.svs.clients[i];
    if (client.active !== true)
      continue;
    total = 0;
    for (j = 0; j <= 15; ++j)
      total += client.ping_times[j];
    total = (total * 62.5).toFixed(0);
    if (total.length === 1)
      total = '   ' + total;
    else if (total.length === 2)
      total = '  ' + total;
    else if (total.length === 3)
      total = ' ' + total;
    clientPrint(total + ' ' + sv.getClientName(client) + '\n');
  }
};

const map_f = async function()
{
  if (cmd.state.argv.length <= 1)
  {
    con.print('USAGE: map <map>\n');
    return;
  }
  if (cmd.state.cmdSource !== cmd.CMD_SOURCE.src_command)
    return;

  if (!state.dedicated) {
    cl.cls.demonum = -1;
    await cl.disconnect();
  }

  // Server-on-worker: the simulation runs in a Worker (see docs/server-worker.md).
  // Forward the map to the worker to spawn there instead of spawning locally,
  // then connect this thread's client to it over the worker-loop transport.
  if (state.workerServer != null && !state.dedicated) {
    key.state.dest = key.KEY_DEST.game
    scr.beginLoadingPlaque();
    // Wait for the worker to FULLY spawn the new map before connecting. Register the waiter
    // BEFORE sending (so we can't miss the cmddone), send, then await it. Without this,
    // `connect local` reaches a half-torn-down / still-loading worker server and the client
    // spawns into it, stops receiving, and times out (CL.ReadFromServer: lost server
    // connection) on every map->map change. Mirrors the loadgame path (save.ts).
    const mapDone = state.workerServer.nextCmdDone();
    state.workerServer.sendCommand(cmd.state.argv.slice(0, cmd.state.argv.length).join(' '));
    await mapDone;
    cl.cls.spawnparms = '';
    for (var j = 2; j < cmd.state.argv.length; ++j)
      cl.cls.spawnparms += cmd.state.argv[j] + ' ';
    await cmd.executeString('connect local', cmd.CMD_SOURCE.src_command);
    return;
  }

  await shutdownServer(false);
  key.state.dest = key.KEY_DEST.game
  if (!state.dedicated) {
    scr.beginLoadingPlaque();
  }
  sv.state.svs.serverflags = 0;
  await sv.spawnServer(cmd.state.argv[1]);
  if (!state.dedicated) {
    if (sv.state.server.phase !== 'active')
      return;
    cl.cls.spawnparms = '';
    var i;
    for (i = 2; i < cmd.state.argv.length; ++i)
      cl.cls.spawnparms += cmd.state.argv[i] + ' ';
    await cmd.executeString('connect local', cmd.CMD_SOURCE.src_command);
  }
};

const changelevel_f = async function()
{
  if (cmd.state.argv.length !== 2)
  {
    con.print('changelevel <levelname> : continue game on a new level\n');
    return;
  }
  if ((sv.state.server.phase !== 'active') || (cl.cls.demoplayback === true))
  {
    con.print('Only the server may changelevel\n');
    return;
  }
  if ((pr.getString(pr.state.globals_int[pr.globalvars.mapname]) === cmd.state.argv[1]) && (await save.autoLoad()))
    return;
  await sv.saveSpawnparms();
  await sv.spawnServer(cmd.state.argv[1]);
};

const restart_f = async function()
{
  if (cmd.state.cmdSource !== cmd.CMD_SOURCE.src_command)
    return
  if ((cl.cls.demoplayback === true) || (sv.state.server.phase !== 'active'))
    return;
  if (await save.autoLoad())
    return;
  await sv.spawnServer(pr.getString(pr.state.globals_int[pr.globalvars.mapname]));
};

export const reconnect_f = function()
{
  if (!state.dedicated) {
    scr.beginLoadingPlaque();
  }
  // net.clearAllBuffers()
  cl.cls.signon = 0;
};

const connect_f = async function()
{
  cl.cls.demonum = -1;
  if (cl.cls.demoplayback === true)
  {
    cl.stopPlayback();
    await cl.disconnect();
  }
  await cl.establishConnection(cmd.state.argv[1]);
  cl.cls.signon = 0;
};

const name_f = function()
{
  if (cmd.state.argv.length <= 1)
  {
    con.print('"name" is "' + cl.cvr.name.string + '"\n');
    return; 
  }

  var newName;
  if (cmd.state.argv.length === 2)
    newName = cmd.state.argv[1].substring(0, 15);
  else
    newName = cmd.state.args.substring(0, 15);

  if (cmd.state.cmdSource !== cmd.CMD_SOURCE.src_client)
  {
    cvar.set('_cl_name', newName);
    sys.nameChanged(newName);
    if (cl.cls.state === cl.ACTIVE.connected)
      cmd.forwardToServer();
    return;
  }

  var name = sv.getClientName(state.client);
  if ((name.length !== 0) && (name !== 'unconnected') && (name !== newName))
    con.print(name + ' renamed to ' + newName + '\n');
  sv.setClientName(state.client, newName);
  var _msg = sv.state.server.reliable_datagram;
  msg.writeByte(_msg, protocol.SVC.updatename);
  msg.writeByte(_msg, state.client.num);
  msg.writeString(_msg, newName);
};

const version_f = function()
{
  con.print('Version 1.09\n');
  con.print(def.timedate);
};

const perf_stats_f = function()
{
  const n = Math.min(state.frameTimeTotal, state.frameTimesMs.length);
  if (n === 0)
  {
    con.print('perf_stats: no frames recorded yet\n');
    return;
  }
  let sum = 0.0;
  let max = 0.0;
  for (let i = 0; i < n; ++i)
  {
    const t = state.frameTimesMs[i];
    sum += t;
    if (t > max)
      max = t;
  }
  con.print('frames counted: ' + n + ' (of ' + state.frameTimeTotal + ' total)\n');
  con.print('avg frame ms:   ' + (sum / n).toFixed(3) + '\n');
  con.print('max frame ms:   ' + max.toFixed(3) + '\n');
  con.print('vec scratch highWater: ' + vec.state.highWater + ' / ' + vec.state.pool.length + '\n');
};

const say = function(teamonly: boolean = false)
{
  if (cmd.state.cmdSource === cmd.CMD_SOURCE.src_command)
  {
    if (!state.dedicated) {
      cmd.forwardToServer();
      return;
    }
    teamonly = false
  }
  if (cmd.state.argv.length <= 1)
    return;
  
  if (!teamonly || !sv.cvr.sv_floodprotect_team_exception.value) {
    let floodtime = 0
    if ((floodtime = sv.checkFloodProt(state.client)))
    {
      if (sv.cvr.sv_floodprotect_silencetime.value === floodtime) {
        clientPrint(`* Spam protection is on\n`);
      } else {
        clientPrint(`You can't talk for ${floodtime} more seconds\n`);
      }
      return;
    }
    sv.pushFloodProt(state.client);
  }
  var save = state.client;
  var p = cmd.state.args;
  if (p.charCodeAt(0) === 34)
    p = p.substring(1, p.length - 1);
  let name = sv.getClientName(save);
  if (cmd.state.cmdSource === cmd.CMD_SOURCE.src_command) {
    name = '<' + net.cvr.hostname.string + '>'
  }
  let name2 = cvr.teamplay.value !== 0 && teamonly ? '(' + name + ')' : name
  let text = '\x01' + name2 + ': ';
  var i = 62 - text.length;
  if (p.length > i)
    p = p.substring(0, i);
  text += p + '\n';
  var client;
  for (i = 0; i < sv.state.svs.maxclients; ++i)
  {
    client = sv.state.svs.clients[i];
    if ((client.active !== true) || (client.spawned !== true))
      continue;
    if ((cvr.teamplay.value !== 0) && (teamonly === true) && (client.edict.v_float[pr.entvars.team] !== save.edict.v_float[pr.entvars.team]))
      continue;
    state.client = client;
    clientPrint(text);
  }
  state.client = save;
  sys.print(text.substring(1));
};

const say_Team_f = function()
{
  say(true);
};

const tell_f = function()
{
  if (cmd.state.cmdSource !== cmd.CMD_SOURCE.src_client)
  {
    cmd.forwardToServer();
    return;
  }
  if (cmd.state.argv.length <= 2)
    return;
  var text = sv.getClientName(state.client) + ': ';
  var p = cmd.state.args;
  if (p.charCodeAt(0) === 34)
    p = p.substring(1, p.length - 1);
  var i = 62 - text.length;
  if (p.length > i)
     p = p.substring(0, i);
  text += p + '\n';
  var save = state.client, client;
  for (i = 0; i < sv.state.svs.maxclients; ++i)
  {
    client = sv.state.svs.clients[i];
    if ((client.active !== true) || (client.spawned !== true))
      continue;
    if (sv.getClientName(client).toLowerCase() !== cmd.state.argv[1].toLowerCase())
      continue;
    state.client = client;
    clientPrint(text);
    break;
  }
  state.client = save;
};

const color_f = function()
{
  if (cmd.state.argv.length <= 1)
  {
    con.print('"color" is "' + (cl.cvr.color.value >> 4) + ' ' + (cl.cvr.color.value & 15) + '"\ncolor <0-13> [0-13]\n');
    return;
  }

  var top, bottom;
  if (cmd.state.argv.length === 2)
    top = bottom = (q.atoi(cmd.state.argv[1]) & 15) >>> 0;
  else
  {
    top = (q.atoi(cmd.state.argv[1]) & 15) >>> 0;
    bottom = (q.atoi(cmd.state.argv[2]) & 15) >>> 0;
  }
  if (top >= 14)
    top = 13;
  if (bottom >= 14)
    bottom = 13;
  var playercolor = (top << 4) + bottom;

  if (cmd.state.cmdSource !== cmd.CMD_SOURCE.src_client)
  {
    cvar.setValue('_cl_color', playercolor);
    if (cl.cls.state === cl.ACTIVE.connected)
      cmd.forwardToServer();
    return;
  }

  state.client.colors = playercolor;
  state.client.edict.v_float[pr.entvars.team] = bottom + 1;
  var _msg = sv.state.server.reliable_datagram;
  msg.writeByte(_msg, protocol.SVC.updatecolors);
  msg.writeByte(_msg, state.client.num);
  msg.writeByte(_msg, playercolor);
};

const kill_f = async function()
{
  if (cmd.state.cmdSource !== cmd.CMD_SOURCE.src_client)
  {
    cmd.forwardToServer();
    return;
  }
  if (sv.cvr.sv_floodprotect_suicide.value) {
    let floodtime = 0
    if ((floodtime = sv.checkFloodProt(state.client)))
    {
      clientPrint(`You can't suicide for ${floodtime} seconds\n`);
      return;
    }
    sv.pushFloodProt(state.client);
  }
  if (sv.state.player.v_float[pr.entvars.health] <= 0.0)
  {
    clientPrint('Can\'t suicide -- already dead!\n');
    return;
  }
  pr.state.globals_float[pr.globalvars.time] = sv.state.server.time;
  pr.state.globals_int[pr.globalvars.self] = sv.state.player.num;
  pr.executeProgram(pr.state.globals_int[pr.globalvars.ClientKill]);
};

const pause_f = function()
{
  if (cmd.state.cmdSource !== cmd.CMD_SOURCE.src_client)
  {
    cmd.forwardToServer();
    return;
  }
  if (cvr.pausable.value === 0)
  {
    clientPrint('Pause not allowed.\n');
    return;
  }
  sv.state.server.paused = !sv.state.server.paused;
  broadcastPrint(sv.getClientName(state.client) + (sv.state.server.paused === true ? ' paused the game\n' : ' unpaused the game\n'));
  msg.writeByte(sv.state.server.reliable_datagram, protocol.SVC.setpause);
  msg.writeByte(sv.state.server.reliable_datagram, sv.state.server.paused === true ? 1 : 0);
};

const preSpawn_f = function()
{
  if (cmd.state.cmdSource !== cmd.CMD_SOURCE.src_client)
  {
    con.print('prespawn is not valid from the console\n');
    return;
  }

  var client = state.client;
  if (client.spawned === true)
  {
    con.print('prespawn not valid -- already spawned\n');
    return;
  }
  state.client.reconnect = false
  sz.write(client.message, new Uint8Array(sv.state.server.signon.data), sv.state.server.signon.cursize);
  msg.writeByte(client.message, protocol.SVC.signonnum);
  msg.writeByte(client.message, 2);
  client.sendsignon = true;
};

const spawn_f = async function()
{
  if (cmd.state.cmdSource !== cmd.CMD_SOURCE.src_client)
  {
    con.print('spawn is not valid from the console\n');
    return;
  }
  var client = state.client;
  if (client.spawned === true)
  {
    con.print('Spawn not valid -- already spawned\n');
    return;
  }

  var i;

  var ent = client.edict;
  if (sv.state.server.spawnKind === 'savegame')
    sv.state.server.paused = false;
  else
  {
    for (i = 0; i < pr.state.entityfields; ++i)
      ent.v_int[i] = 0;
    ent.v_float[pr.entvars.colormap] = ent.num;
    ent.v_float[pr.entvars.team] = (client.colors & 15) + 1;
    ent.v_int[pr.entvars.netname] = pr.state.netnames + (client.num << 5);
    for (i = 0; i <= 15; ++i)
      pr.state.globals_float[pr.globalvars.parms + i] = client.spawn_parms[i];
    pr.state.globals_float[pr.globalvars.time] = sv.state.server.time;
    pr.state.globals_int[pr.globalvars.self] = ent.num;
    pr.executeProgram(pr.state.globals_int[pr.globalvars.ClientConnect]);
    if ((sys.floatTime() - client.netconnection.connecttime) <= sv.state.server.time)
      sys.print(sv.getClientName(client) + ' entered the game\n');
    pr.executeProgram(pr.state.globals_int[pr.globalvars.PutClientInServer]);
  }

  var message = client.message;
  message.cursize = 0;
  msg.writeByte(message, protocol.SVC.time);
  msg.writeFloat(message, sv.state.server.time);
  for (i = 0; i < sv.state.svs.maxclients; ++i)
  {
    client = sv.state.svs.clients[i];
    msg.writeByte(message, protocol.SVC.updatename);
    msg.writeByte(message, i);
    msg.writeString(message, sv.getClientName(client));
    msg.writeByte(message, protocol.SVC.updatefrags);
    msg.writeByte(message, i);
    msg.writeShort(message, client.old_frags);
    msg.writeByte(message, protocol.SVC.updatecolors);
    msg.writeByte(message, i);
    msg.writeByte(message, client.colors);
  }
  for (i = 0; i <= 63; ++i)
  {
    msg.writeByte(message, protocol.SVC.lightstyle);
    msg.writeByte(message, i);
    msg.writeString(message, sv.state.server.lightstyles[i]);
  }
  msg.writeByte(message, protocol.SVC.updatestat);
  msg.writeByte(message, def.STAT.totalsecrets);
  msg.writeLong(message, pr.state.globals_float[pr.globalvars.total_secrets]);
  msg.writeByte(message, protocol.SVC.updatestat);
  msg.writeByte(message, def.STAT.totalmonsters);
  msg.writeLong(message, pr.state.globals_float[pr.globalvars.total_monsters]);
  msg.writeByte(message, protocol.SVC.updatestat);
  msg.writeByte(message, def.STAT.secrets);
  msg.writeLong(message, pr.state.globals_float[pr.globalvars.found_secrets]);
  msg.writeByte(message, protocol.SVC.updatestat);
  msg.writeByte(message, def.STAT.monsters);
  msg.writeLong(message, pr.state.globals_float[pr.globalvars.killed_monsters]);
  msg.writeByte(message, protocol.SVC.setangle);
  msg.writeAngle(message, ent.v_float[pr.entvars.angles], sv.state.server.protocolFlags);
  msg.writeAngle(message, ent.v_float[pr.entvars.angles1], sv.state.server.protocolFlags);
  msg.writeAngle(message, 0.0, sv.state.server.protocolFlags);
  sv.writeClientdataToMessage(ent, message);
  msg.writeByte(message, protocol.SVC.signonnum);
  msg.writeByte(message, 3);
  state.client.sendsignon = true;
};

const begin_f = function()
{
  if (state.client.reconnect) {
    con.print('Ignoring begin durring reconnect\n');
    return;
  }
  if (cmd.state.cmdSource !== cmd.CMD_SOURCE.src_client)
  {
    con.print('begin is not valid from the console\n');
    return;
  }
  state.client.spawned = true;
};

const kick_f = async function()
{
  if (cmd.state.cmdSource !== cmd.CMD_SOURCE.src_client)
  {
    if (sv.state.server.phase !== 'active')
    {
      cmd.forwardToServer();
      return;
    }
  }
  else if (pr.state.globals_float[pr.globalvars.deathmatch] !== 0.0)
    return;
  if (cmd.state.argv.length <= 1)
    return;
  var save = state.client;
  var s = cmd.state.argv[1].toLowerCase();
  var i, byNumber;
  if ((cmd.state.argv.length >= 3) && (s === '#'))
  {
    i = q.atoi(cmd.state.argv[2]) - 1;
    if ((i < 0) || (i >= sv.state.svs.maxclients))
      return;
    if (sv.state.svs.clients[i].active !== true)
      return;
    state.client = sv.state.svs.clients[i];
    byNumber = true;
  }
  else
  {
    for (i = 0; i < sv.state.svs.maxclients; ++i)
    {
      state.client = sv.state.svs.clients[i];
      if (state.client.active !== true)
        continue;
      if (sv.getClientName(state.client).toLowerCase() === s)
        break;
    }
  }
  if (i >= sv.state.svs.maxclients)
  {
    state.client = save;
    return;
  }
  if (state.client === save)
    return;
  var who;
  if (cmd.state.cmdSource !== cmd.CMD_SOURCE.src_client){
    if (!state.dedicated) {
      who = cl.cvr.name.string;
    } else {
      who = "Server"
    }
  }
  else
  {
    if (state.client === save)
      return;
    who = sv.getClientName(save);
  }
  var message;
  if (cmd.state.argv.length >= 3)
    message = com.parse(cmd.state.args);
  if (message != null)
  {
    var p = 0;
    if (byNumber === true)
    {
      ++p;
      for (; p < message.length; ++p)
      {
        if (message.charCodeAt(p) !== 32)
          break;
      }
      p += cmd.state.argv[2].length;
    }
    for (; p < message.length; ++p)
    {
      if (message.charCodeAt(p) !== 32)
        break;
    }
    clientPrint('Kicked by ' + who + ': ' + message.substring(p) + '\n');
  }
  else
    clientPrint('Kicked by ' + who + '\n');
  await dropClient(false);
  state.client = save;
};

const give_f = function()
{
  if (cmd.state.cmdSource !== cmd.CMD_SOURCE.src_client)
  {
    cmd.forwardToServer();
    return;
  }
  if (pr.state.globals_float[pr.globalvars.deathmatch] !== 0)
    return;
  if (cmd.state.argv.length <= 1)
    return;
  var t = cmd.state.argv[1].charCodeAt(0);
  var ent = sv.state.player;

  if ((t >= 48) && (t <= 57))
  {
    if (com.state.hipnotic !== true)
    {
      if (t >= 50)
        ent.v_float[pr.entvars.items] |= def.IT.shotgun << (t - 50);
      return;
    }
    if (t === 54)
    {
      if (cmd.state.argv[1].charCodeAt(1) === 97)
        ent.v_float[pr.entvars.items] |= def.HIT.proximity_gun;
      else
        ent.v_float[pr.entvars.items] |= def.IT.grenade_launcher;
      return;
    }
    if (t === 57)
      ent.v_float[pr.entvars.items] |= def.HIT.laser_cannon;
    else if (t === 48)
      ent.v_float[pr.entvars.items] |= def.HIT.mjolnir;
    else if (t >= 50)
      ent.v_float[pr.entvars.items] |= def.IT.shotgun << (t - 50);
    return;
  }
  var v = q.atoi(cmd.state.argv[2]);
  if (t === 104)
  {
    ent.v_float[pr.entvars.health] = v;
    return;
  }
  if (com.state.rogue !== true)
  {
    switch (t)
    {
    case 115:
      ent.v_float[pr.entvars.ammo_shells] = v;
      return;
    case 110:
      ent.v_float[pr.entvars.ammo_nails] = v;
      return;
    case 114:
      ent.v_float[pr.entvars.ammo_rockets] = v;
      return;
    case 99:
      ent.v_float[pr.entvars.ammo_cells] = v;
    }
    return;
  }
  switch (t)
  {
  case 115:
    if (pr.entvars.ammo_shells1 != null)
      ent.v_float[pr.entvars.ammo_shells1] = v;
    ent.v_float[pr.entvars.ammo_shells] = v;
    return;
  case 110:
    if (pr.entvars.ammo_nails1 != null)
    {
      ent.v_float[pr.entvars.ammo_nails1] = v;
      if (ent.v_float[pr.entvars.weapon] <= def.IT.lightning)
        ent.v_float[pr.entvars.ammo_nails] = v;
    }
    return;
  case 108:
    if (pr.entvars.ammo_lava_nails != null)
    {
      ent.v_float[pr.entvars.ammo_lava_nails] = v;
      if (ent.v_float[pr.entvars.weapon] > def.IT.lightning)
        ent.v_float[pr.entvars.ammo_nails] = v;
    }
    return;
  case 114:
    if (pr.entvars.ammo_rockets1 != null)
    {
      ent.v_float[pr.entvars.ammo_rockets1] = v;
      if (ent.v_float[pr.entvars.weapon] <= def.IT.lightning)
        ent.v_float[pr.entvars.ammo_rockets] = v;
    }
    return;
  case 109:
    if (pr.entvars.ammo_multi_rockets != null)
    {
      ent.v_float[pr.entvars.ammo_multi_rockets] = v;
      if (ent.v_float[pr.entvars.weapon] > def.IT.lightning)
        ent.v_float[pr.entvars.ammo_rockets] = v;
    }
    return;
  case 99:
    if (pr.entvars.ammo_cells1 != null)
    {
      ent.v_float[pr.entvars.ammo_cells1] = v;
      if (ent.v_float[pr.entvars.weapon] <= def.IT.lightning)
        ent.v_float[pr.entvars.ammo_cells] = v;
    }
    return;
  case 112:
    if (pr.entvars.ammo_plasma != null)
    {
      ent.v_float[pr.entvars.ammo_plasma] = v;
      if (ent.v_float[pr.entvars.weapon] > def.IT.lightning)
        ent.v_float[pr.entvars.ammo_cells] = v;
    }
  }
};

const findViewthing = function()
{
  var i, e;
  if (sv.state.server.phase === 'active')
  {
    for (i = 0; i < sv.state.server.num_edicts; ++i)
    {
      e = sv.state.server.edicts[i];
      if (pr.getString(e.v_int[pr.entvars.classname]) === 'viewthing')
        return e;
    }
  }
  con.print('No viewthing on map\n');
};

const viewmodel_f = async function()
{
  if (cmd.state.argv.length !== 2)
    return;
  var ent = findViewthing();
  if (ent == null)
    return;
  var m = mod.forName(cmd.state.argv[1]);
  if (m == null)
  {
    con.print('Can\'t load ' + cmd.state.argv[1] + '\n');
    return;
  }
  ent.v_float[pr.entvars.frame] = 0.0;
  cl.clState.model_precache[ent.v_float[pr.entvars.modelindex] >> 0] = m;
};

const viewframe_f = function()
{
  var ent = findViewthing();
  if (ent == null)
    return;
  var m = cl.clState.model_precache[ent.v_float[pr.entvars.modelindex] >> 0];
  var f = q.atoi(cmd.state.argv[1]);
  if (f >= m.frames.length)
    f = m.frames.length - 1;
  ent.v_float[pr.entvars.frame] = f;
};

const viewnext_f = function()
{
  var ent = findViewthing();
  if (ent == null)
    return;
  var m = cl.clState.model_precache[ent.v_float[pr.entvars.modelindex] >> 0];
  var f = (ent.v_float[pr.entvars.frame] >> 0) + 1;
  if (f >= m.frames.length)
    f = m.frames.length - 1;
  ent.v_float[pr.entvars.frame] = f;
  // @ts-ignore
  con.print('frame ' + f + ': ' + m.frames[f].name + '\n');
};

const viewprev_f = function()
{
  var ent = findViewthing();
  if (ent == null)
    return;
  var m = cl.clState.model_precache[ent.v_float[pr.entvars.modelindex] >> 0];
  var f = (ent.v_float[pr.entvars.frame] >> 0) - 1;
  if (f < 0)
    f = 0;
  ent.v_float[pr.entvars.frame] = f;
  // @ts-ignore
  con.print('frame ' + f + ': ' + m.frames[f].name + '\n');
};

const startdemos_f = function()
{
  con.print((cmd.state.argv.length - 1) + ' demo(s) in loop\n');
  cl.cls.demos = [];
  var i;
  for (i = 1; i < cmd.state.argv.length; ++i)
    cl.cls.demos[i - 1] = cmd.state.argv[i];
  if ((cl.cls.demonum !== -1) && (cl.cls.demoplayback !== true))
  {
    cl.cls.demonum = 0;
    if (state.framecount !== 0)
      cl.nextDemo();
    else
      state.startdemos = true;
  }
  else
    cl.cls.demonum = -1;
};

const demos_f = async function()
{
  if (cl.cls.demonum === -1)
    cl.cls.demonum = 1;
  await cl.disconnect();
  cl.nextDemo();
};

const stopdemo_f = async function()
{
  if (cl.cls.demoplayback !== true)
    return;
  cl.stopPlayback();
  await cl.disconnect();
};

const initCommands = () => {
  cmd.addCommand('status', status_f);
  cmd.addCommand('quit', quit_f);
  cmd.addCommand('god', god_f);
  cmd.addCommand('notarget', notarget_f);
  cmd.addCommand('fly', fly_f);
  cmd.addCommand('map', map_f);
  cmd.addCommand('restart', restart_f);
  cmd.addCommand('changelevel', changelevel_f);
  cmd.addCommand('connect', connect_f);
  cmd.addCommand('reconnect', reconnect_f);
  cmd.addCommand('name', name_f);
  cmd.addCommand('noclip', noclip_f);
  cmd.addCommand('setpos', setpos_f);
  cmd.addCommand('version', version_f);
  cmd.addCommand('say', say);
  cmd.addCommand('say_team', say_Team_f);
  cmd.addCommand('tell', tell_f);
  cmd.addCommand('color', color_f);
  cmd.addCommand('kill', kill_f);
  cmd.addCommand('pause', pause_f);
  cmd.addCommand('spawn', spawn_f);
  cmd.addCommand('begin', begin_f);
  cmd.addCommand('prespawn', preSpawn_f);
  cmd.addCommand('kick', kick_f);
  cmd.addCommand('ping', ping_f);
  cmd.addCommand('give', give_f);
  cmd.addCommand('startdemos', startdemos_f);
  cmd.addCommand('demos', demos_f);
  cmd.addCommand('stopdemo', stopdemo_f);
  cmd.addCommand('viewmodel', viewmodel_f);
  cmd.addCommand('viewframe', viewframe_f);
  cmd.addCommand('viewnext', viewnext_f);
  cmd.addCommand('viewprev', viewprev_f);
  cmd.addCommand('mcache', mod.print);
  cmd.addCommand('perf_stats', perf_stats_f);
}

export const error = async function(error: string)
{
  if (state.inerror === true) {
    sys.error('Host.Error: recursively entered');
  }
  state.inerror = true;
  if (!state.dedicated) {
    scr.endLoadingPlaque();
  }
  con.print('Host.Error: ' + error + '\n');
  if (sv.state.server.phase === 'active')
    await shutdownServer(false);
  await cl.disconnect();
  cl.cls.demonum = -1;
  state.inerror = false;
  throw new Error(error);
};

// Rethrows the original HostError after cleanup so the reported message and
// stack point at the throw site, not this handler.
const handleHostError = async function(err: HostError): Promise<never> {
  if (state.inerror === true) {
    sys.error('Host.Error: recursively entered');
  }
  state.inerror = true;
  if (!state.dedicated) {
    scr.endLoadingPlaque();
  }
  con.print('Host.Error: ' + err.message + '\n');
  if (sv.state.server.phase === 'active')
    await shutdownServer(false);
  await cl.disconnect();
  cl.cls.demonum = -1;
  state.inerror = false;
  throw err;
};

const handleHostEndGame = async function(message: string): Promise<never> {
  con.dPrint('Host.EndGame: ' + message + '\n');
  if (cl.cls.demonum !== -1)
    cl.nextDemo();
  else
    await cl.disconnect();
  throw 'Host.abortserver';
};

const getCmdDeclaration = (varName: string) => {
  return com.checkParm(`-${varName}`) ? true : false
}
const getCmdParam = (varName: string) => {
  const i = com.checkParm(`-${varName}`);
  return i ? com.state.argv[i + 1] : null;
}

const initLocal = () => {
  initCommands();
  cvr.framerate = cvar.registerVariable('host_framerate', '0');
  cvr.maxfps = cvar.registerVariable('host_maxfps', '250', true);
  cvr.speeds = cvar.registerVariable('host_speeds', '0');
  cvr.ticrate = cvar.registerVariable('sys_ticrate', '0.05');
  cvr.serverprofile = cvar.registerVariable('serverprofile', '0');
  cvr.fraglimit = cvar.registerVariable('fraglimit', getCmdParam('fraglimit') ?? '0', false, true);
  cvr.timelimit = cvar.registerVariable('timelimit', getCmdParam('timelimit') ?? '0', false, true);
  cvr.teamplay = cvar.registerVariable('teamplay', getCmdParam('teamplay') ?? '0', false, true);
  cvr.samelevel = cvar.registerVariable('samelevel', '0');
  cvr.noexit = cvar.registerVariable('noexit', '0', false, true);
  cvr.skill = cvar.registerVariable('skill', getCmdParam('skill') ?? '1');
  cvr.developer = cvar.registerVariable('developer', '0');
  cvr.deathmatch = cvar.registerVariable('deathmatch', '0');
  cvr.coop = cvar.registerVariable('coop', getCmdDeclaration('coop') ? "1" : '0');
  cvr.pausable = cvar.registerVariable('pausable', '1');
  cvr.temp1 = cvar.registerVariable('temp1', '0');
  // Inert engine-side: the rerelease QC owns these game modes and only needs them to exist
  // (QSS-M host.c ~96-98).
  cvr.campaign = cvar.registerVariable('campaign', '0');
  cvr.horde = cvar.registerVariable('horde', '0');
  cvr.sv_cheats = cvar.registerVariable('sv_cheats', '0');
  cvr.rcon_password = cvar.registerVariable('rcon_password', 'abcd');
  save.init();

  findMaxClients();
}

const getConnectUrl = () => {
  const i = com.checkParm('-connect')
  return i ? com.state.argv[i + 1] : ''
}
export const init = async function(
  dedicated: boolean,
  assetStore: IAssetStore,
  netDrivers: INetworkDriver[])
{
  state = emptyState()
  state.serverId = com.uuidv4()
  state.dedicated = dedicated
  state.oldrealtime = sys.floatTime();
  state.connectOnLoad = getConnectUrl()
  cvar.init();
  
  sv.init();
  cmd.init();
  v.init();
  chase.init();
  await com.init(assetStore);
  initLocal();
  // QSS-M Host_Init order (host.c:1811): after com.init so the loc file can come out of a -game
  // pak, and after initLocal so `developer` exists. Server-side print builtins consume it, so it
  // stays outside the dedicated check.
  await loc.init();
  await w.loadWadFile('gfx.wad');
  key.init();
  con.init();
  pr.init();
  mod.init();
  net.init(netDrivers);
  con.print(def.timedate);
  if (!dedicated) {
    await vid.init();
    await tx.init();
    await draw.init();
    await scr.init();
    mapAlpha.init();
    fog.init();
    sky.init();
    r.init();
    await s.init();
    await m.init();
    await cdAudio.init();
    await sbar.init();
    await cl.init();
    input.init();
  }
  cmd.state.text = ""
  if (typeof process !== 'undefined' && process.env && process.env.STARTUP_CFG) {
    sys.print('Applying startup cfg...\n');
    cmd.state.text += process.env.STARTUP_CFG + "\n"
  }
  cmd.state.text += '\n+mlook\n' + cmd.state.text;
  cmd.state.text += 'exec quake.rc\n' + cmd.state.text;
  state.initialized = true;
  sys.print('========Quake Initialized=========\n');
};

const runFrame = async function() {
  try { await _frame(); }
  catch (e) {
    if (e instanceof HostError) await handleHostError(e);
    else if (e instanceof HostEndGame) await handleHostEndGame(e.message);
    else throw e;
  }
};

export const frame = async function()
{
  if (cvr.serverprofile.value === 0)
  {
    await runFrame();
    return;
  }
  var time1 = sys.floatTime();
  await runFrame();
  state.timetotal += sys.floatTime() - time1;
  if (++state.timecount <= 999)
    return;
  var m = (state.timetotal * 1000.0 / state.timecount) >> 0;
  state.timecount = 0;
  state.timetotal = 0.0;
  var i, c = 0;
  for (i = 0; i < sv.state.svs.maxclients; ++i)
  {
    if (sv.state.svs.clients[i].active === true)
      ++c;
  }
  con.print('serverprofile: ' + (c <= 9 ? ' ' : '') + c + ' clients ' + (m <= 9 ? ' ' : '') + m + ' msec\n');
};

export const shutdown = function()
{
  if (state.isdown === true)
  {
    sys.print('recursive shutdown\n');
    return;
  }
  state.isdown = true;
  writeConfiguration();
  cdAudio.stop();
  net.shutdown();
  s.stopAllSounds();
  input.shutdown();
  vid.free()
};

export const shutdownServer = async function(crash: boolean = false)
{
  if (sv.state.server.phase !== 'active')
    return;
  sv.state.server.phase = 'inactive';
  if (cl.cls.state === cl.ACTIVE.connected)
    await cl.disconnect();
  var start = sys.floatTime(), count, i;
  do
  {
    count = 0;
    for (i = 0; i < sv.state.svs.maxclients; ++i)
    {
      state.client = sv.state.svs.clients[i];
      if ((state.client.active !== true) || (state.client.message.cursize === 0))
        continue;
      if (net.canSendMessage(state.client.netconnection) === true)
      {
        net.sendMessage(state.client.netconnection, state.client.message);
        state.client.message.cursize = 0;
        continue;
      }
      net.getMessage(state.client.netconnection);
      ++count;
    }
    if ((sys.floatTime() - start) > 3.0)
      break;
  } while (count !== 0);
  var buf = sz.newDatagram(4, 1);
  sz.u8(buf)[0] = protocol.SVC.disconnect;
  count = await net.sendToAll(buf);
  if (count !== 0)
    con.print('Host.ShutdownServer: NET.SendToAll failed for ' + count + ' clients\n');
  for (i = 0; i < sv.state.svs.maxclients; ++i)
  {
    state.client = sv.state.svs.clients[i];
    if (state.client.active === true)
      await dropClient(crash);
  }
};