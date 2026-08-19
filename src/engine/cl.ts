import * as cmd from './cmd'
import * as host from './host'
import * as con from './console'
import * as mod from './mod'
import * as msg from './msg'
import * as sz from './sz'
import * as com from './com'
import * as def from './def'
import * as sv from './sv'
import * as chase from './chase'
import * as sys from './sys'
import * as v from './v'
import * as net from './net'
import * as cvar from './cvar'
import * as scr from './scr'
import * as r from './r'
import * as s from './s'
import * as cdAudio from './cdAudio'
import * as input from './input'
import * as protocol from './protocol'
import * as tx from './texture'
import * as q from './q'
import * as vec from './vec'
import * as crc from './crc'
import * as pscript from './pscript'
import IDatagram from './interfaces/net/IDatagram'
import ISocket from './interfaces/net/ISocket'
import { CVars } from './cvar'
import { Entity } from './types/Entity'
import { V3, V4 } from './types/Vector'
import { Model } from './types/Model'
import { KnownAsset } from './types/KnownAsset'
import { Sound } from './types/Sound'

export type KeyState = {
  down: number[];
  state: number;
}

export type Score = {
  name: string
  entertime: number
  frags: number
  colors: number
  ping: number
  isBot: boolean
  pinged: boolean
}

export const requestPingUpdate = () => {
  clState.expectingPingTimes = sys.floatTime() + 2
  cmd.forwardToServer_string('ping')
}

let pingReceivedSet: Set<number> = new Set()

const parseSpecialPrint = (text: string): boolean => {
  if (clState.parsingPings) {
    const trimmed = text.trimStart()
    const spaceIdx = trimmed.indexOf(' ')
    if (spaceIdx > 0 && text.endsWith('\n')) {
      const ping = parseInt(trimmed.substring(0, spaceIdx))
      const name = trimmed.substring(spaceIdx + 1).replace(/\n$/, '')
      if (!isNaN(ping) && name !== 'unconnected') {
        for (let i = clState.pingPlayerIndex; i < clState.maxclients; i++) {
          if (clState.scores[i].name.length === 0) continue
          if (name === clState.scores[i].name || name.startsWith(clState.scores[i].name)) {
            clState.scores[i].ping = ping
            pingReceivedSet.add(i)
            clState.pingPlayerIndex = i + 1
            return true
          }
        }
      }
    }
    // Ping cycle complete — players the server skipped are bots
    clState.parsingPings = false
    for (let i = 0; i < clState.maxclients; i++) {
      if (clState.scores[i].name.length === 0) continue
      clState.scores[i].isBot = !pingReceivedSet.has(i)
      clState.scores[i].pinged = true
    }
    pingReceivedSet.clear()
  }

  if (text === 'Client ping times:\n' && clState.expectingPingTimes > sys.floatTime()) {
    clState.parsingPings = true
    clState.pingPlayerIndex = 0
    return true
  }

  return false
}

export type ClState = {
  viewangles: V3
  time: number
  mtime: number[]
  mviewangles: [V3, V3]
  cmd: {
    forwardmove: number,
    sidemove: number,
    upmove: number
  }
  // mouse/controller movement accumulated per render frame, consumed by the next server tick's sendCmd
  pendingcmd: {
    forwardmove: number,
    sidemove: number,
    upmove: number
  }
  movemessages: number
  stats: number[]
  items: number
  item_gettime: number[]
  faceanimtime: number
  cshifts: V4[]
  mvelocity:[V3, V3]
  velocity: V3
  punchangle: V3
  idealpitch: number
  pitchvel: number
  driftmove: number
  laststop: number
  crouch: number
  intermission: number
  completed_time: number
  oldtime: number
  last_received_message: number
  viewentity: number
  num_statics: number
  viewent: Entity
  cdtrack: number
  looptrack: number
  sound_precache: Sound[]
  protocol: number
  protocolFlags: number
  maxclients: number
  scores: Score[]
  gametype: number
  levelname: string
  model_precache: Model[]
  particle_precache: string[] // dp_precache-transported effectinfo names, index -> name (see pscript.findParticleType)
  worldmodel: Model
  viewheight: number
  onground: boolean
  inwater: boolean
  paused: boolean
  nodrift: boolean
  parsingPings: boolean
  pingPlayerIndex: number
  expectingPingTimes: number
  pingReceivedSet: Set<number>
}

export type DownloadState = {
  model_names: string[]
  sound_names: string[]
  model_download_index: number
  sound_download_index: number
  download_check_wait: number
  download: {
    active: boolean
    filename: string
    size: number
    received: number
    lastPct: number
    data: Uint8Array | null
    lastFilename: string
  }
}

const initClState = (): ClState => ({
  movemessages: 0,
  cmd: {
    forwardmove: 0.0,
    sidemove: 0.0,
    upmove: 0.0
  },
  pendingcmd: {
    forwardmove: 0.0,
    sidemove: 0.0,
    upmove: 0.0
  },
  stats: [
    0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0
  ],
  items: 0,
  item_gettime: [
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0
  ],
  faceanimtime: 0.0,
  cshifts: [vec.emptyV4(), vec.emptyV4(), vec.emptyV4(), vec.emptyV4()],
  mviewangles: [vec.emptyV3(), vec.emptyV3()],
  viewangles: vec.emptyV3(),
  mvelocity: [vec.emptyV3(), vec.emptyV3()],
  velocity: vec.emptyV3(),
  punchangle: vec.emptyV3(),
  idealpitch: 0.0,
  pitchvel: 0.0,
  driftmove: 0.0,
  laststop: 0.0,
  crouch: 0.0,
  intermission: 0,
  completed_time: 0,
  mtime: [0.0, 0.0],
  time: 0.0,
  oldtime: 0.0,
  last_received_message: 0.0,
  viewentity: 0,
  num_statics: 0,
  viewent: newEntity(-1),
  cdtrack: 0,
  looptrack: 0,
  sound_precache: [],
  protocol: 0,
  protocolFlags: 0,
  maxclients: 0,
  scores: [],
  gametype: 0,
  levelname: '',
  model_precache: [],
  particle_precache: [],
  worldmodel: null,
  viewheight: 0,
  onground: false,
  inwater: false,
  paused: false,
  nodrift: false,
  parsingPings: false,
  pingPlayerIndex: 0,
  expectingPingTimes: 0,
  pingReceivedSet: new Set(),
})

const initDlState = (): DownloadState => ({
  model_names: [],
  sound_names: [],
  model_download_index: 1,
  sound_download_index: 1,
  download_check_wait: 0,
  download: {
    active: false,
    filename: '',
    size: 0,
    received: 0,
    lastPct: -1,
    data: null,
    lastFilename: '',
  }
})

export let clState: ClState
export let dlState: DownloadState

export type Beam = {
  endtime: number,
  model: Model, 
  start: V3,
  end: V3,
  entity: number
}
export type DynamicLight = {
  origin: V3,
  color: r.Color,
  radius: number,
  die: number
  decay: number
  minlight: number
  key: number
}

export type TempEntities = {
  sfx_wizhit: Sound
  sfx_knighthit: Sound
  sfx_tink1: Sound
  sfx_ric1: Sound
  sfx_ric2: Sound
  sfx_ric3: Sound
  sfx_r_exp3: Sound
}

export type SpriteEffect = {
  origin: V3,
  model: Model,
  startframe: number,
  framecount: number,
  framerate: number,
  starttime: number,
}

export type ClientStaticState = {
  state: number,
  signon: number
  spawnparms: string,
  demonum: number,
  message: IDatagram
  demoplayback: boolean,
  demofile: ArrayBuffer
  // cached views over demofile, rebuilt by demoView/demoU8 when recording growth or a
  // demo load replaces the buffer
  demofileView: DataView
  demofileU8: Uint8Array
  timedemo: boolean
  demoofs: number
  td_lastframe: number
  td_startframe: number
  td_starttime: number
  demosize: number
  netcon: ISocket
  demorecording: boolean
  demoname: string
  demos: string[]
  forcetrack: number
  sendprespawn: boolean
  protocol_dpdownload: number
  // connected to a same-machine server (in-process loop OR the server Worker),
  // vs a genuinely remote host. Lets local-only decisions (e.g. skip asset
  // downloads — files are already local) avoid reading sv.state.server.phase,
  // which is empty on the main thread when the server runs on the Worker.
  isLocalServer: boolean
}

export let cls: ClientStaticState = {
  signon: 0,
  state: 0,
  spawnparms: '',
  demonum: 0,
  message: sz.newDatagram(def.max_message),
  demoplayback:false,
  demofile: null,
  demofileView: null,
  demofileU8: null,
  timedemo: false,
  demoofs: 0,
  td_lastframe: 0,
  td_startframe: 0,
  td_starttime: 0,
  demosize: 0,
  netcon: null,
  demorecording: false,
  demoname: '',
  forcetrack: 0,
  demos: [],
  sendprespawn: false,
  protocol_dpdownload: 0,
  isLocalServer: false
}

const initStaticState = (): ClientStaticState => ({
  state: 0,
  spawnparms: '',
  demonum: 0,
  message: sz.newDatagram(def.max_message),
  signon: 0,
  demoplayback: false,
  demofile: null,
  demofileView: null,
  demofileU8: null,
  timedemo: false,
  demoofs: 0,
  td_lastframe: 0,
  td_startframe: 0,
  td_starttime: 0,
  demosize: 0,
  netcon: null,
  demorecording: false,
  demoname: '',
  forcetrack: 0,
  demos: [],
  sendprespawn: false,
  protocol_dpdownload: 0,
  isLocalServer: false
})

export type ShowLmpEntry = { pic: tx.Pic, x: number, y: number };

export type ClientState = {
  entities: Entity[],
  visedicts: Entity[],
  numvisedicts: number,
  kbuttons: KeyState[],
  lastmsg: number,
  temp_entities: Entity[],
  num_temp_entities: number,
  sendmovebuf: IDatagram,
  dlights: DynamicLight[]
  lightstyle: string[]
  host: string
  impulse: number
  beams: Beam[]
  tents: TempEntities
  effects: SpriteEffect[]
  showlmps: Map<string, ShowLmpEntry>
}

const initState = (): ClientState => ({
  entities: [],
  visedicts: [],
  numvisedicts: 0,
  kbuttons: [],
  lastmsg: 0.0,
  temp_entities: [],
  num_temp_entities: 0,
  sendmovebuf: sz.newDatagram(20),
  dlights: [],
  host: '',
  impulse: 0,
  lightstyle: [],
  beams: [],
  tents: {
    sfx_wizhit: null,
    sfx_knighthit: null,
    sfx_tink1: null,
    sfx_ric1: null,
    sfx_ric2: null,
    sfx_ric3: null,
    sfx_r_exp3: null
  },
  effects: [],
  showlmps: new Map()
});

export let state: ClientState = initState()




export const cvr: CVars = {}

export const CSHIFT = {
  contents: 0,
  damage: 1,
  bonus: 2,
  powerup: 3
};

export const ACTIVE = {
  disconnected: 0,
  connecting: 1,
  connected: 2
};
export type KBUTTON_ENUM = 'mlook' | 'klook' | 'left' | 'right' | 'forward' | 'back' | 'lookup' | 'lookdown' | 'moveleft' | 'moveright' | 'strafe' | 'speed' | 'use' | 'jump' | 'attack' | 'moveup' | 'movedown' | 'num';
export const KBUTTON: Record<KBUTTON_ENUM, number> = {
  mlook: 0,
  klook: 1,
  left: 2,
  right: 3,
  forward: 4,
  back: 5,
  lookup: 6,
  lookdown: 7,
  moveleft: 8,
  moveright: 9,
  strafe: 10,
  speed: 11,
  use: 12,
  jump: 13,
  attack: 14,
  moveup: 15,
  movedown: 16,
  num: 17
};

const SVC_STRINGS = [
  'bad',
  'nop',
  'disconnect',
  'updatestat',
  'version',
  'setview',
  'sound',
  'time',
  'print',
  'stufftext',
  'setangle',
  'serverinfo',
  'lightstyle',
  'updatename',
  'updatefrags',
  'clientdata',
  'stopsound',
  'updatecolors',
  'particle',
  'damage',
  'spawnstatic',
  'OBSOLETE spawnbinary',
  'spawnbaseline',
  'temp_entity',
  'setpause',
  'signonnum',
  'centerprint',
  'killedmonster',
  'foundsecret',
  'spawnstaticsound',
  'intermission',
  'finale',
  'cdtrack',
  'sellscreen',
  'cutscene'
];

const newEntity = (num: number): Entity => ({
    num: num,
    update_type: 0,
    scale: protocol.ENTSCALE_DEFAULT,
    baseline: {
      alpha: 0,
      scale: protocol.ENTSCALE_DEFAULT,
      origin: vec.emptyV3(),
      angles: vec.emptyV3(),
      modelindex: 0,
      frame: 0,
      colormap: 0,
      skin: 0,
      effects: 0
    },
    msgtime: 0.0,
    msg_origins: [vec.emptyV3(), vec.emptyV3()],
    origin: vec.emptyV3(),
    msg_angles: [vec.emptyV3(), vec.emptyV3()],
    angles: vec.emptyV3(),
    frame: 0,
    syncbase: 0.0,
    effects: 0,
    skinnum: 0,
    visframe: 0,
    dlightframe: 0,
    dlightbits: [],
    alpha: 0,
    free: false,
    model: null,
    forcelink: false,
    area: null,
    leafnums: [],
    freetime: 0.0,
    v: null,
    v_float: null,
    v_int: null,
    colormap: 0,
    lerpflags: 0,
    lerpfinish: 0,
    lerpstart: 0,
    lerptime: 0,
    previouspose: -1,
    currentpose: -1,
    movelerpstart: 0,
    previousorigin: vec.emptyV3(),
    currentorigin: vec.emptyV3(),
    previousangles: vec.emptyV3(),
    currentangles: vec.emptyV3(),
    lightcache: { surf: 0, ds: 0, dt: 0, pos: new Float32Array(3) }
})
// demo

export const stopPlayback = function()
{
  if (cls.demoplayback !== true)
    return;
  cls.demoplayback = false;
  cls.demofile = null;
  cls.state = ACTIVE.disconnected;
  if (cls.timedemo === true)
    finishTimeDemo();
};

const demoView = (): DataView => {
  if (cls.demofileView == null || cls.demofileView.buffer !== cls.demofile)
    cls.demofileView = new DataView(cls.demofile);
  return cls.demofileView;
};

const demoU8 = (): Uint8Array => {
  if (cls.demofileU8 == null || cls.demofileU8.buffer !== cls.demofile)
    cls.demofileU8 = new Uint8Array(cls.demofile);
  return cls.demofileU8;
};

export const writeDemoMessage = function()
{
  var len = cls.demoofs + 16 + net.state.message.cursize;
  if (cls.demofile.byteLength < len)
  {
    var src = new Uint8Array(cls.demofile, 0, cls.demoofs);
    cls.demofile = new ArrayBuffer(cls.demofile.byteLength + 16384);
    (new Uint8Array(cls.demofile)).set(src);
  }
  var f = demoView();
  f.setInt32(cls.demoofs, net.state.message.cursize, true);
  f.setFloat32(cls.demoofs + 4, clState.viewangles[0], true);
  f.setFloat32(cls.demoofs + 8, clState.viewangles[1], true);
  f.setFloat32(cls.demoofs + 12, clState.viewangles[2], true);
  demoU8().set(sz.u8(net.state.message).subarray(0, net.state.message.cursize), cls.demoofs + 16);
  cls.demoofs = len;
};

export const getMessage = function()
{
  if (cls.demoplayback === true)
  {
    if (cls.signon === 4)
    {
      if (cls.timedemo === true)
      {
        if (host.state.framecount === cls.td_lastframe)
          return 0;
        cls.td_lastframe = host.state.framecount;
        if (host.state.framecount === (cls.td_startframe + 1))
          cls.td_starttime = host.state.realtime;
      }
      else if (clState.time <= clState.mtime[0])
        return 0;
    }
    if ((cls.demoofs + 16) >= cls.demosize)
    {
      stopPlayback();
      return 0;
    }
    var view = demoView();
    net.state.message.cursize = view.getUint32(cls.demoofs, true);
    if (net.state.message.cursize > def.max_message)
      sys.error('Demo message > MAX_MSGLEN');
    clState.mviewangles[1][0] = clState.mviewangles[0][0];
    clState.mviewangles[1][1] = clState.mviewangles[0][1];
    clState.mviewangles[1][2] = clState.mviewangles[0][2];
    clState.mviewangles[0][0] = view.getFloat32(cls.demoofs + 4, true);
    clState.mviewangles[0][1] = view.getFloat32(cls.demoofs + 8, true);
    clState.mviewangles[0][2] = view.getFloat32(cls.demoofs + 12, true);
    cls.demoofs += 16;
    if ((cls.demoofs + net.state.message.cursize) > cls.demosize)
    {
      stopPlayback();
      return 0;
    }
    var src = demoU8();
    var dest = sz.u8(net.state.message);
    var i;
    for (i = 0; i < net.state.message.cursize; ++i)
      dest[i] = src[cls.demoofs + i];
    cls.demoofs += net.state.message.cursize;
    return 1;
  };

  var r;
  for (;;)
  {
    r = net.getMessage(cls.netcon);
    if ((r !== 1) && (r !== 2))
      return r;
    if ((net.state.message.cursize === 1) && (sz.u8(net.state.message)[0] === protocol.SVC.nop))
      con.print('<-- server to client keepalive\n');
    else
      break;
  }

  if (cls.demorecording === true)
    writeDemoMessage();

  return r;
};

export const stop_f = async function()
{
  if (cmd.state.cmdSource !== cmd.CMD_SOURCE.src_command)
    return;
  
  if (cls.demorecording !== true)
  {
    con.print('Not recording a demo.\n');
    return;
  }
  net.state.message.cursize = 0;
  msg.writeByte(net.state.message, protocol.SVC.disconnect);
  writeDemoMessage();
  if (await com.writeFile(cls.demoname, new Uint8Array(cls.demofile), cls.demoofs) !== true)
    con.print('ERROR: couldn\'t open.\n');
  cls.demofile = null;
  cls.demorecording = false;
  con.print('Completed demo\n');
};

export const record_f = async function()
{
  if (cmd.state.cmdSource !== cmd.CMD_SOURCE.src_command)
    return;

  var c = cmd.state.argv.length;
  if ((c <= 1) || (c >= 5))
  {
    con.print('record <demoname> [<map> [cd track]]\n');
    return;
  }
  if (cmd.state.argv[1].indexOf('..') !== -1)
  {
    con.print('Relative pathnames are not allowed.\n');
    return;
  }
  if ((c === 2) && (cls.state === ACTIVE.connected))
  {
    con.print('Can not record - already connected to server\nClient demo recording must be started before connecting\n');
    return;
  }
  if (c === 4)
  {
    cls.forcetrack = q.atoi(cmd.state.argv[3]);
    con.print('Forcing CD track to ' + cls.forcetrack);
  }
  else
    cls.forcetrack = -1;
  cls.demoname = com.defaultExtension(cmd.state.argv[1], '.dem');
  if (c >= 3)
    await cmd.executeString('map ' + cmd.state.argv[2], cmd.CMD_SOURCE.src_command);
  con.print('recording to ' + cls.demoname + '.\n');
  cls.demofile = new ArrayBuffer(16384);
  var track = cls.forcetrack.toString() + '\n';
  var i, dest = new Uint8Array(cls.demofile, 0, track.length);
  for (i = 0; i < track.length; ++i)
    dest[i] = track.charCodeAt(i);
  cls.demoofs = track.length;
  cls.demorecording = true;
};

export const playDemo_f = async function()
{
  if (cmd.state.cmdSource !== cmd.CMD_SOURCE.src_command)
    return;
  if (cmd.state.argv.length !== 2)
  {
    con.print('playdemo <demoname> : plays a demo\n');
    return;
  }
  await disconnect();
  var name = com.defaultExtension(cmd.state.argv[1], '.dem');
  con.print('Playing demo from ' + name + '.\n');
  var demofile = await com.loadFile(name) as any;
  if (demofile == null)
  {
    con.print('ERROR: couldn\'t open.\n');
    cls.demonum = -1;
    scr.state.disabled_for_loading = false;
    return;
  }
  cls.demofile = demofile;
  demofile = new Uint8Array(demofile);
  cls.demosize = demofile.length;
  cls.demoplayback = true;
  cls.state = ACTIVE.connected;
  cls.forcetrack = 0;
  var i, c, neg;
  for (i = 0; i < demofile.length; ++i)
  {
    c = demofile[i];
    if (c === 10)
      break;
    if (c === 45)
      neg = true;
    else
      cls.forcetrack = cls.forcetrack * 10 + c - 48;
  }
  if (neg === true)
    cls.forcetrack = -cls.forcetrack;
  cls.demoofs = i + 1;
};

export const finishTimeDemo = function()
{
  cls.timedemo = false;
  var frames = host.state.framecount - cls.td_startframe - 1;
  var time = host.state.realtime - cls.td_starttime;
  if (time === 0.0)
    time = 1.0;
  con.print(frames + ' frames ' + time.toFixed(1) + ' seconds ' + (frames / time).toFixed(1) + ' fps\n');
};

export const timeDemo_f = async function()
{
  if (cmd.state.cmdSource !== cmd.CMD_SOURCE.src_command)
    return;
  if (cmd.state.argv.length !== 2)
  {
    con.print('timedemo <demoname> : gets demo speeds\n');
    return;
  }
  await playDemo_f();
  cls.timedemo = true;
  cls.td_startframe = host.state.framecount;
  cls.td_lastframe = -1;
};

// input

export const keyDown = function()
{
  var b = KBUTTON[cmd.state.argv[0].substring(1) as KBUTTON_ENUM];
  if (b == null)
    return;
  const key = state.kbuttons[b];

  var k;
  if (cmd.state.argv[1] != null)
    k = q.atoi(cmd.state.argv[1]);
  else
    k = -1;
    

  if ((k === key.down[0]) || (k === key.down[1]))
    return;

  if (key.down[0] === 0)
    key.down[0] = k;
  else if (key.down[1] === 0)
    key.down[1] = k;
  else
  {
    con.print('Three keys down for a button!\n');
    return;
  }

  if ((key.state & 1) === 0)
    key.state |= 3;
};

export const keyUp = function()
{
  var b = KBUTTON[cmd.state.argv[0].substring(1) as KBUTTON_ENUM];
  if (b == null)
    return;
  const key = state.kbuttons[b];

  var k;
  if (cmd.state.argv[1] != null)
    k = q.atoi(cmd.state.argv[1]);
  else
  {
    key.down[0] = key.down[1] = 0;
    key.state = 4;
    return;
  }

  if (key.down[0] === k)
    key.down[0] = 0;
  else if (key.down[1] === k)
    key.down[1] = 0;
  else
    return;
  if ((key.down[0] !== 0) || (key.down[1] !== 0))
    return;

  if ((key.state & 1) !== 0)
    key.state = (key.state - 1) | 4;
};

export const mLookUp = function()
{
  keyUp();
  if (((state.kbuttons[KBUTTON.mlook].state & 1) === 0) && (cvr.lookspring.value !== 0))
    v.startPitchDrift();
};

export const impulse = function()
{
  state.impulse = q.atoi(cmd.state.argv[1]);
};

export const keyState = function(keyNum: number)
{
  const key = state.kbuttons[keyNum];
  var down = key.state & 1;
  key.state &= 1;
  if ((key.state & 2) !== 0)
  {
    if ((key.state & 4) !== 0)
      return (down !== 0) ? 0.75 : 0.25;
    return (down !== 0) ? 0.5 : 0.0;
  }
  if ((key.state & 4) !== 0)
    return 0.0;
  return (down !== 0) ? 1.0 : 0.0;
};

export const adjustAngles = function()
{
  var speed = host.state.frametime;
  if ((state.kbuttons[KBUTTON.speed].state & 1) !== 0)
    speed *= cvr.anglespeedkey.value;

  var angles = clState.viewangles;

  if ((state.kbuttons[KBUTTON.strafe].state & 1) === 0)
  {
    angles[1] += speed * cvr.yawspeed.value * (keyState(KBUTTON.left) - keyState(KBUTTON.right));
    angles[1] = vec.anglemod(angles[1]);
  }
  if ((state.kbuttons[KBUTTON.klook].state & 1) !== 0)
  {
    v.stopPitchDrift();
    angles[0] += speed * cvr.pitchspeed.value * (keyState(KBUTTON.back) - keyState(KBUTTON.forward));
  }

  var up = keyState(KBUTTON.lookup), down = keyState(KBUTTON.lookdown);

  if ((up !== 0.0) || (down !== 0.0))
  {
    angles[0] += speed * cvr.pitchspeed.value * (down - up);
    v.stopPitchDrift();
  }

  if (angles[0] > 80.0)
    angles[0] = 80.0;
  else if (angles[0] < -70.0)
    angles[0] = -70.0;

  if (angles[2] > 50.0)
    angles[2] = 50.0;
  else if (angles[2] < -50.0)
    angles[2] = -50.0;
};

// Per-render-frame input: keyboard look + mouse apply to viewangles every frame
// so aiming stays full-rate; mouse movement accumulates into pendingcmd until the
// next server tick (QSS CL_AccumulateCmd).
export const accumulateCmd = function()
{
  if (cls.signon !== 4)
    return;
  adjustAngles();
  input.move();
};

export const baseMove = function()
{
  if (cls.signon !== 4)
    return;

  var _cmd = clState.cmd;

  _cmd.sidemove = cvr.sidespeed.value * (keyState(KBUTTON.moveright) - keyState(KBUTTON.moveleft));
  if ((state.kbuttons[KBUTTON.strafe].state & 1) !== 0)
    _cmd.sidemove += cvr.sidespeed.value * (keyState(KBUTTON.right) - keyState(KBUTTON.left));

  _cmd.upmove = cvr.upspeed.value * (keyState(KBUTTON.moveup) - keyState(KBUTTON.movedown));

  if ((state.kbuttons[KBUTTON.klook].state & 1) === 0)
    _cmd.forwardmove = cvr.forwardspeed.value * keyState(KBUTTON.forward) - cvr.backspeed.value * keyState(KBUTTON.back);
  else
    _cmd.forwardmove = 0.0;

  if ((state.kbuttons[KBUTTON.speed].state & 1) !== 0)
  {
    _cmd.forwardmove *= cvr.movespeedkey.value;
    _cmd.sidemove *= cvr.movespeedkey.value;
    _cmd.upmove *= cvr.movespeedkey.value;
  }
};

export const sendMove = function()
{
  var buf = state.sendmovebuf;
  buf.cursize = 0;
  // FitzQuake/RMQ CLC_MOVE always carries 16-bit angles regardless of protocolFlags
  // (matches QSS-M cl_input.c CL_SendMove); NetQuake stays byte-precision.
  const isFitz = clState.protocol === protocol.fitzquake || clState.protocol === protocol.rmq
  msg.writeByte(buf, protocol.CLC.move);
  msg.writeFloat(buf, clState.mtime[0]);
  if (isFitz) {
    msg.writeAngle16(buf, clState.viewangles[0]);
    msg.writeAngle16(buf, clState.viewangles[1]);
    msg.writeAngle16(buf, clState.viewangles[2]);
  } else {
    msg.writeAngle(buf, clState.viewangles[0], clState.protocolFlags);
    msg.writeAngle(buf, clState.viewangles[1], clState.protocolFlags);
    msg.writeAngle(buf, clState.viewangles[2], clState.protocolFlags);
  }
  msg.writeShort(buf, clState.cmd.forwardmove);
  msg.writeShort(buf, clState.cmd.sidemove);
  msg.writeShort(buf, clState.cmd.upmove);
  var bits = 0;
  if ((state.kbuttons[KBUTTON.attack].state & 3) !== 0)
    bits += 1;
  state.kbuttons[KBUTTON.attack].state &= 5;
  if ((state.kbuttons[KBUTTON.jump].state & 3) !== 0)
    bits += 2;
  state.kbuttons[KBUTTON.jump].state &= 5;
  msg.writeByte(buf, bits);
  msg.writeByte(buf, state.impulse);
  state.impulse = 0;
  if (cls.demoplayback === true)
    return;
  if (++clState.movemessages <= 2)
    return;
  if (net.sendUnreliableMessage(cls.netcon, buf) === -1)
  {
    con.print('CL.SendMove: lost server connection\n');
    disconnect();
    sys.quit('Lost connection to the game server.\n');
  }
};

export const initInput = function()
{
  var i;

  var commands = ['moveup', 'movedown', 'left', 'right',
    'forward', 'back', 'lookup', 'lookdown',
    'strafe', 'moveleft', 'moveright', 'speed',
    'attack', 'use', 'jump', 'klook'
  ];
  for (i = 0; i < commands.length; ++i)
  {
    cmd.addCommand('+' + commands[i], keyDown);
    cmd.addCommand('-' + commands[i], keyUp);
  }
  cmd.addCommand('impulse', impulse);
  cmd.addCommand('+mlook', keyDown);
  cmd.addCommand('-mlook', mLookUp);
  for (i = 0; i < KBUTTON.num; ++i)
    state.kbuttons[i] = {down: [0, 0], state: 0};
};

// main

export const rcon_f = function()
{
  if (cvr.rcon_password.string.length === 0)
  {
    con.print('You must set \'rcon_password\' before\nissuing an rcon command.\n');
    return;
  }
  var to;
  if ((cls.state === ACTIVE.connected) && (cls.netcon != null))
  {
    if (net.state.drivers[cls.netcon.driver].name === "websocket")
      to = cls.netcon.address.substring(5);
  }
  if (to == null)
  {
    if (cvr.rcon_address.string.length === 0)
    {
      con.print('You must either be connected,\nor set the \'rcon_address\' cvar\nto issue rcon commands\n');
      return;
    }
    to = cvr.rcon_address.string;
  }
  var pw;
  try
  {
    pw = btoa('quake:' + cvr.rcon_password.string);
  }
  catch (e)
  {
    return;
  }
  var message = '', i;
  for (i = 1; i < cmd.state.argv.length; ++i)
    message += cmd.state.argv[i] + ' ';
  try
  {
    message = encodeURIComponent(message);
  }
  catch (e)
  {
    return;
  }
  var xhr = new XMLHttpRequest();
  xhr.open('HEAD', 'http://' + to + '/rcon/' + message);
  xhr.setRequestHeader('Authorization', 'Basic ' + pw);
  xhr.send();
};

export const clearState = function()
{
  if (sv.state.server.phase !== 'active')
  {
    con.dPrint('Clearing memory\n');
    mod.clearAll();
    cls.signon = 0;
  }

  Object.keys(clState).forEach(function(key) {
    delete (clState as any)[key];
  });

  clState = initClState();
  dlState = initDlState();

  cls.message.cursize = 0;
  state.showlmps.clear();
  state.effects = [];

  state.entities = [];
  
  var i;

  state.dlights = [];
  for (i = 0; i <= 31; ++i)
    state.dlights[i] = {radius: 0.0, die: 0.0, decay: 0.0, minlight: 0.0, key: 0, origin: vec.emptyV3(), color: vec.emptyV3()};

  state.lightstyle = [];
  for (i = 0; i <= 63; ++i)
    state.lightstyle[i] = '';

  state.beams = [];
  for (i = 0; i <= 23; ++i) {
    state.beams[i] = {
      endtime: 0.0,
      model: null, 
      start: vec.emptyV3(),
      end: vec.emptyV3(),
      entity: 0
    };
  }
};

export const disconnect = async function()
{
  s.stopAllSounds();
  if (cls.demoplayback === true)
    stopPlayback();
  else if (cls.state === ACTIVE.connected)
  {
    if (cls.demorecording === true)
      await stop_f();
    con.dPrint('Sending clc_disconnect\n');
    cls.message.cursize = 0;
    msg.writeByte(cls.message, protocol.CLC.disconnect);
    net.sendUnreliableMessage(cls.netcon, cls.message);
    cls.message.cursize = 0;
    net.close(cls.netcon);
    cls.state = ACTIVE.disconnected;
    if (sv.state.server.phase === 'active')
      await host.shutdownServer();
  }
  cls.demoplayback = cls.timedemo = false;
  cls.signon = 0;
};

export const connect = function(sock: ISocket)
{
  Object.keys(clState).forEach(function(key) { delete (clState as any)[key]; });
  clState = initClState();
  dlState = initDlState();
  cls.sendprespawn = false;
  cls.protocol_dpdownload = 0;
  cls.netcon = sock;
  // 'local' is the loopback address for both the in-process server and the
  // server Worker; any other host is remote (WebRTC / WebSocket).
  cls.isLocalServer = state.host === 'local';
  con.dPrint('CL.Connect: connected to ' + state.host + '\n');
  cls.demonum = -1;
  cls.state = ACTIVE.connected;
  cls.signon = 0;
};

export const establishConnection = async function(host_url : string)
{
  if (cls.demoplayback === true)
    return;
  await disconnect();
  state.host = host_url;
  var sock = await net.connect(host_url);
  if (sock == null)
    await host.error('CL.EstablishConnection: connect failed\n');

  // TODO: Joe -  Fix types on connect - should *only* return a socket?
  if (sock === 'connected' || sock === 'failed') {
    await host.error('Socket not returned by connect');
    return
  }
  connect(sock);
};

export const signonReply = function()
{
  con.dPrint('CL.SignonReply: ' + cls.signon + '\n');
  switch (cls.signon)
  {
  case 1:
    cls.sendprespawn = true;
    return;
  case 2:
    msg.writeByte(cls.message, protocol.CLC.stringcmd);
    msg.writeString(cls.message, 'name "' + cvr.name.string + '"\n');
    msg.writeByte(cls.message, protocol.CLC.stringcmd);
    msg.writeString(cls.message, 'color ' + (cvr.color.value >> 4) + ' ' + (cvr.color.value & 15) + '\n');
    msg.writeByte(cls.message, protocol.CLC.stringcmd);
    msg.writeString(cls.message, 'spawn ' + cls.spawnparms);
    return;
  case 3:
    msg.writeByte(cls.message, protocol.CLC.stringcmd);
    msg.writeString(cls.message, 'begin');
    return;
  case 4:
    scr.endLoadingPlaque();
  }
};

export const nextDemo = function()
{
  if (cls.demonum === -1)
    return;
  scr.beginLoadingPlaque();
  if (cls.demonum >= cls.demos.length)
  {
    if (cls.demos.length === 0)
    {
      con.print('No demos listed with startdemos\n');
      cls.demonum = -1;
      return;
    }
    cls.demonum = 0;
  }
  cmd.state.text = 'playdemo ' + cls.demos[cls.demonum++] + '\n' + cmd.state.text;
};

export const printEntities_f = function()
{
  var i, ent;
  for (i = 0; i < state.entities.length; ++i)
  {
    ent = state.entities[i];
    if (i <= 9)
      con.print('  ' + i + ':');
    else if (i <= 99)
      con.print(' ' + i + ':');
    else
      con.print(i + ':');
    if (ent.model == null)
    {
      con.print('EMPTY\n');
      continue;
    }
    con.print(ent.model.name + (ent.frame <= 9 ? ': ' : ':') + ent.frame +
      '  (' + ent.origin[0].toFixed(1) + ',' + ent.origin[1].toFixed(1) + ',' + ent.origin[2].toFixed(1) +
      ') [' + ent.angles[0].toFixed(1) + ' ' + ent.angles[1].toFixed(1) + ' ' + ent.angles[2].toFixed(1) + ']\n');
  }
};

export const allocDlight = function(key: number)
{
  var i, dl;
  if (key !== 0)
  {
    for (i = 0; i <= 31; ++i)
    {
      if (state.dlights[i].key === key)
      {
        dl = state.dlights[i];
        break;
      }
    }
  }
  if (dl == null)
  {
    for (i = 0; i <= 31; ++i)
    {
      if (state.dlights[i].die < clState.time)
      {
        dl = state.dlights[i];
        break;
      }
    }
    if (dl == null)
      dl = state.dlights[0];
  }
  dl.origin = [0.0, 0.0, 0.0];
  dl.color = [1.0, 1.0, 1.0];
  dl.radius = 0.0;
  dl.die = 0.0;
  dl.decay = 0.0;
  dl.minlight = 0.0;
  dl.key = key;
  return dl;
};

export const decayLights = function()
{
  var i, dl, time = clState.time - clState.oldtime;
  for (i = 0; i <= 31; ++i)
  {
    dl = state.dlights[i];
    if ((dl.die < clState.time) || (dl.radius === 0.0))
      continue;
    dl.radius -= time * dl.decay;
    if (dl.radius < 0.0)
      dl.radius = 0.0;
  }
}

export const lerpPoint = function()
{
  var f = clState.mtime[0] - clState.mtime[1];
  if ((f === 0.0) || (cvr.nolerp.value !== 0) || (cls.timedemo === true) ||
    ((sv.state.server.phase === 'active') && (host.state.netinterval === 0)))
  {
    clState.time = clState.mtime[0];
    return 1.0;
  }
  if (f > 0.1)
  {
    clState.mtime[1] = clState.mtime[0] - 0.1;
    f = 0.1;
  }
  var frac = (clState.time - clState.mtime[1]) / f;
  if (frac >= 0.0 && frac <= 1.0)
    return frac;
  // Remote server: vanilla hard resync. cl.time must stay locked to the
  // server's message timeline — a gradual correction lets it drift up to
  // 100ms off, seen online as added display latency / rubber banding.
  if (sv.state.server.phase !== 'active')
  {
    if (frac < -0.01)
      clState.time = clState.mtime[1];
    else if (frac > 1.01)
      clState.time = clState.mtime[0];
    return frac < 0.0 ? 0.0 : 1.0;
  }
  // Local isolated server (netinterval): vanilla's hard snap freezes cl.time
  // onto the 72Hz tick grid, quantizing all interpolated entity motion to
  // 72Hz. Keep cl.time monotonic and bleed drift off slowly instead.
  var bound = frac < 0.0 ? clState.mtime[1] : clState.mtime[0];
  var err = clState.time - bound;
  if (Math.abs(err) > 0.1)
    clState.time = bound; // way off (map load, pause, stall): snap
  else
    clState.time -= err * 0.1;
  return frac < 0.0 ? 0.0 : 1.0;
};

export const relinkEntities = function()
{
  var i, j;
  var frac = lerpPoint(), f, d, delta = vec.scratch();

  state.numvisedicts = 0;

  clState.velocity[0] = clState.mvelocity[1][0] + frac * (clState.mvelocity[0][0] - clState.mvelocity[1][0]);
  clState.velocity[1] = clState.mvelocity[1][1] + frac * (clState.mvelocity[0][1] - clState.mvelocity[1][1]);
  clState.velocity[2] = clState.mvelocity[1][2] + frac * (clState.mvelocity[0][2] - clState.mvelocity[1][2]);

  if (cls.demoplayback === true)
  {
    for (i = 0; i <= 2; ++i)
    {
      d = clState.mviewangles[0][i] - clState.mviewangles[1][i];
      if (d > 180.0)
        d -= 360.0;
      else if (d < -180.0)
        d += 360.0;
      clState.viewangles[i] = clState.mviewangles[1][i] + frac * d;
    }
  }

  var bobjrotate = vec.anglemod(100.0 * clState.time);
  var ent, oldorg = vec.scratch(), dl;
  for (i = 1; i < state.entities.length; ++i)
  {
    ent = state.entities[i];
    if (ent.model == null)
      continue;
    if (ent.msgtime !== clState.mtime[0])
    {
      ent.model = null;
      ent.lerpflags |= r.LERP.resetmove | r.LERP.resetanim;
      continue;
    }
    oldorg[0] = ent.origin[0];
    oldorg[1] = ent.origin[1];
    oldorg[2] = ent.origin[2];
    if (ent.forcelink === true)
    {
      vec.copy(ent.msg_origins[0], ent.origin);
      vec.copy(ent.msg_angles[0], ent.angles);
    }
    else
    {
      f = frac;
      for (j = 0; j <= 2; ++j)
      {
        delta[j] = ent.msg_origins[0][j] - ent.msg_origins[1][j];
        if ((delta[j] > 100.0) || (delta[j] < -100.0))
        {
          f = 1.0;
          ent.lerpflags |= r.LERP.resetmove;
        }
      }
      if ((r.cvr.lerpmove.value !== 0) && ((ent.lerpflags & r.LERP.movestep) !== 0))
        f = 1.0;
      for (j = 0; j <= 2; ++j)
      {
        ent.origin[j] = ent.msg_origins[1][j] + f * delta[j];
        d = ent.msg_angles[0][j] - ent.msg_angles[1][j];
        if (d > 180.0)
          d -= 360.0;
        else if (d < -180.0)
          d += 360.0;
        ent.angles[j] = ent.msg_angles[1][j] + f * d;
      }
    }

    if ((ent.model.flags & mod.FLAGS.rotate) !== 0)
    {
      ent.angles[1] = bobjrotate;
      // QSS-M cl_main.c:1796. Rides 0..10 above the resting origin, so the pickup never
      // sinks into the floor. Before the model-flag trails below, so an EF_GIB pickup
      // drips as it bobs.
      if (cvr.bobbing.value !== 0)
        ent.origin[2] += Math.sin(bobjrotate / 90.0 * Math.PI) * 5.0 + 5.0;
    }
    if ((ent.effects & mod.EFFECTS.brightfield) !== 0)
      r.entityParticles(ent);
    if ((ent.effects & mod.EFFECTS.muzzleflash) !== 0)
    {
      dl = allocDlight(i);
      const fv = vec.scratch();
      vec.angleVectors(ent.angles, fv);
      dl.origin[0] = ent.origin[0] + 18.0 * fv[0];
      dl.origin[1] = ent.origin[1] + 18.0 * fv[1];
      dl.origin[2] = ent.origin[2] + 16.0 + 18.0 * fv[2];
      dl.radius = 200.0 + Math.random() * 32.0;
      dl.minlight = 32.0;
      dl.die = clState.time + 0.1;
      if (r.cvr.lerpmodels.value !== 2) {
        if (i === clState.viewentity)
          clState.viewent.lerpflags |= r.LERP.resetanim | r.LERP.resetanim2;
        else
          ent.lerpflags |= r.LERP.resetanim | r.LERP.resetanim2;
      }
    }
    if ((ent.effects & mod.EFFECTS.brightlight) !== 0)
    {
      dl = allocDlight(i);
      dl.origin[0] = ent.origin[0]; dl.origin[1] = ent.origin[1]; dl.origin[2] = ent.origin[2] + 16.0;
      dl.radius = 400.0 + Math.random() * 32.0;
      dl.die = clState.time + 0.001;
    }
    if ((ent.effects & (mod.EFFECTS.dimlight | mod.EFFECTS.red | mod.EFFECTS.blue)) !== 0)
    {
      dl = allocDlight(i);
      dl.origin[0] = ent.origin[0]; dl.origin[1] = ent.origin[1]; dl.origin[2] = ent.origin[2] + 16.0;
      dl.radius = 200.0 + Math.random() * 32.0;
      dl.die = clState.time + 0.001;
      if ((ent.effects & (mod.EFFECTS.red | mod.EFFECTS.blue)) !== 0)
      {
        dl.color[0] = (ent.effects & mod.EFFECTS.red) !== 0 ? 1.0 : 0.0;
        dl.color[1] = 0.0;
        dl.color[2] = (ent.effects & mod.EFFECTS.blue) !== 0 ? 1.0 : 0.0;
      }
    }
    if ((ent.model.flags & mod.FLAGS.gib) !== 0)
      r.rocketTrail(oldorg, ent.origin, 2);
    else if ((ent.model.flags & mod.FLAGS.zomgib) !== 0)
      r.rocketTrail(oldorg, ent.origin, 4);
    else if ((ent.model.flags & mod.FLAGS.tracer) !== 0)
      r.rocketTrail(oldorg, ent.origin, 3);
    else if ((ent.model.flags & mod.FLAGS.tracer2) !== 0)
      r.rocketTrail(oldorg, ent.origin, 5);
    else if ((ent.model.flags & mod.FLAGS.rocket) !== 0)
    {
      r.rocketTrail(oldorg, ent.origin, 0);
      dl = allocDlight(i)
      dl.origin[0] = ent.origin[0]; dl.origin[1] = ent.origin[1]; dl.origin[2] = ent.origin[2];
      dl.radius = 200.0;
      dl.die = clState.time + 0.01;
    }
    else if ((ent.model.flags & mod.FLAGS.grenade) !== 0)
      r.rocketTrail(oldorg, ent.origin, 1);
    else if ((ent.model.flags & mod.FLAGS.tracer3) !== 0)
      r.rocketTrail(oldorg, ent.origin, 6);

    ent.forcelink = false;
    if ((i !== clState.viewentity) || (chase.cvr.active.value !== 0))
      state.visedicts[state.numvisedicts++] = ent;
  }
};

export const readFromServer = async function()
{
  clState.oldtime = clState.time;
  clState.time += host.state.frametime;

  // Debug: periodic nqnetchan health check
  if (cls.netcon?.protocol === 'nqnetchan' && Math.floor(host.state.realtime) !== Math.floor(host.state.realtime - host.state.frametime)) {
    const q = cls.netcon.receiveMessage?.length ?? 0
    const cs = cls.netcon.canSend
    if (q > 5 || !cs)
      console.warn(`[nqnetchan] queue=${q} canSend=${cs} recvSeq=${cls.netcon.receiveSequence}`)
  }

  var ret;
  for (;;)
  {
    ret = getMessage();
    if (ret === -1)
      host.throwError('CL.ReadFromServer: lost server connection');
    if (ret === 0)
      break;
    clState.last_received_message = host.state.realtime;
    await parseServerMessage();
    if (cls.state !== ACTIVE.connected)
      break;
  }
  if (cvr.shownet.value !== 0)
    con.print('\n');
  relinkEntities();
  updateTEnts();
};

export const sendCmd = function()
{
  if (cls.state !== ACTIVE.connected)
    return;

  if (cls.signon === 4)
  {
    baseMove();
    var pending = clState.pendingcmd;
    clState.cmd.forwardmove += pending.forwardmove;
    clState.cmd.sidemove += pending.sidemove;
    clState.cmd.upmove += pending.upmove;
    pending.forwardmove = pending.sidemove = pending.upmove = 0.0;
    sendMove();
  }

  if (cls.demoplayback === true)
  {
    cls.message.cursize = 0;
    return;
  }

  if (cls.message.cursize === 0)
    return;

  if (net.canSendMessage(cls.netcon) !== true)
  {
    con.dPrint('CL.SendCmd: can\'t send\n');
    return;
  }

  if (net.sendMessage(cls.netcon, cls.message) === -1)
    host.throwError('CL.SendCmd: lost server connection');

  cls.message.cursize = 0;
};

export const init = async function()
{
  state = initState();
  clState = initClState();
  dlState = initDlState();
  cls = initStaticState();
  clearState();
  initInput();
  await initTEnts();
  cvr.name = cvar.registerVariable('_cl_name', 'player', true);
  cvr.color = cvar.registerVariable('_cl_color', '0', true);
  cvr.upspeed = cvar.registerVariable('cl_upspeed', '200');
  cvr.forwardspeed = cvar.registerVariable('cl_forwardspeed', '200', true);
  cvr.backspeed = cvar.registerVariable('cl_backspeed', '200', true);
  cvr.sidespeed = cvar.registerVariable('cl_sidespeed', '350');
  cvr.movespeedkey = cvar.registerVariable('cl_movespeedkey', '2.0');
  cvr.yawspeed = cvar.registerVariable('cl_yawspeed', '140');
  cvr.pitchspeed = cvar.registerVariable('cl_pitchspeed', '150');
  cvr.anglespeedkey = cvar.registerVariable('cl_anglespeedkey', '1.5');
  cvr.maxfps = cvar.registerVariable('cl_maxfps', '0', true);
  cvr.shownet = cvar.registerVariable('cl_shownet', '0');
  cvr.nolerp = cvar.registerVariable('cl_nolerp', '0');
  // JoeQuake item bob (QSS-M cl_main.c:95). Off by default, as vanilla spins EF_ROTATE
  // pickups without bobbing them.
  cvr.bobbing = cvar.registerVariable('cl_bobbing', '0', true);
  cvr.lookspring = cvar.registerVariable('lookspring', '0', true);
  cvr.lookstrafe = cvar.registerVariable('lookstrafe', '0', true);
  cvr.sensitivity = cvar.registerVariable('sensitivity', '3', true);
  cvr.m_pitch = cvar.registerVariable('m_pitch', '0.022', true);
  cvr.m_yaw = cvar.registerVariable('m_yaw', '0.022', true);
  cvr.m_forward = cvar.registerVariable('m_forward', '1', true);
  cvr.m_side = cvar.registerVariable('m_side', '0.8', true);
  cvr.rcon_password = cvar.registerVariable('rcon_password', '');
  cvr.rcon_address = cvar.registerVariable('rcon_address', '');
  cmd.addCommand('entities', printEntities_f);
  cmd.addCommand('disconnect', disconnect);
  cmd.addCommand('record', record_f);
  cmd.addCommand('stop', stop_f);
  cmd.addCommand('playdemo', playDemo_f);
  cmd.addCommand('timedemo', timeDemo_f);
  cmd.addCommand('rcon', rcon_f);
  // QSS download extension commands (received via stufftext from server)
  cmd.addCommand('cl_serverextension_download', cl_serverextension_download_f);
  cmd.addCommand('cl_downloadbegin', cl_downloadbegin_f);
  cmd.addCommand('cl_downloadfinished', cl_downloadfinished_f);
  cmd.addCommand('stopdownload', stopdownload_f);
};

// parse

export const entityNum = function(num: number)
{
  if (num < state.entities.length)
    return state.entities[num];
  for (; state.entities.length <= num; )
  {
    state.entities[state.entities.length] = newEntity(num);
  }
  return state.entities[num];
};

export const parseStartSoundPacket = function()
{
  var field_mask = msg.readByte();
  var volume = ((field_mask & 1) !== 0) ? msg.readByte() : 255;
  var attenuation = ((field_mask & 2) !== 0) ? msg.readByte() * 0.015625 : 1.0;

  var ent, channel;
  if (field_mask & protocol.SND.largeentity) {
    ent = msg.readShort();
    channel = msg.readByte();
  } else {
    channel = msg.readShort();
    ent = channel >> 3;
    channel &= 7;
  }
  var sound_num = (field_mask & protocol.SND.largesound) ? msg.readShort() : msg.readByte();
  if (field_mask & protocol.SND.largesound)
    con.dPrint('[cl] large sound ' + sound_num + ': ' + clState.sound_precache[sound_num]?.name + '\n');

  var pos: V3 = [msg.readCoord(clState.protocolFlags), msg.readCoord(clState.protocolFlags), msg.readCoord(clState.protocolFlags)];
  s.startSound(ent, channel, clState.sound_precache[sound_num], pos, volume / 255.0, attenuation);
};

export const parseServerInfo = async function()
{
  con.dPrint('Serverinfo packet received.\n');
  clearState();
  var i = msg.readLong();
  if (i !== protocol.netquake && i !== protocol.fitzquake && i !== protocol.rmq)
  {
    con.print('Server returned protocol version ' + i + ' which is unsupported.\n');
    return;
  }
  clState.protocol = i

  // RMQ carries a flags long after the protocol long; protocolFlags stores it verbatim
  // (real PRFL wire bits, no translation). Matches QSS-M CL_ParseServerInfo.
  if (i === protocol.rmq) {
    clState.protocolFlags = msg.readLong();
    const supportedFlags = protocol.PRFL.SHORTANGLE | protocol.PRFL.FLOATANGLE | protocol.PRFL.COORD24 |
      protocol.PRFL.FLOATCOORD | protocol.PRFL.EDICTSCALE | protocol.PRFL.INT32COORD;
    if (clState.protocolFlags & ~supportedFlags)
      con.print('PROTOCOL_RMQ protocolflags ' + clState.protocolFlags + ' contains unsupported flags\n');
  } else
    clState.protocolFlags = 0;

  clState.maxclients = msg.readByte();
  if ((clState.maxclients <= 0) || (clState.maxclients > 16))
  {
    con.print('Bad maxclients (' + clState.maxclients + ') from server\n');
    return;
  }
  clState.scores = [];
  for (i = 0; i < clState.maxclients; ++i)
  {
    clState.scores[i] = {
      name: '',
      entertime: 0.0,
      frags: 0,
      colors: 0,
      ping: 0,
      isBot: false,
      pinged: false
    };
  }
  clState.gametype = msg.readByte();
  clState.levelname = msg.readString();
  con.print('\n\n\x1D\x1E\x1E\x1E\x1E\x1E\x1E\x1E\x1E\x1E\x1E\x1E\x1E\x1E\x1E\x1E\x1E\x1E\x1E\x1E\x1E\x1E\x1E\x1E\x1E\x1E\x1E\x1E\x1E\x1E\x1E\x1E\x1E\x1E\x1E\x1E\x1F\n\n');
  con.print('\x02' + clState.levelname + '\n');

  var str;
  var nummodels, model_precache = [];
  for (nummodels = 1; ; ++nummodels)
  {
    str = msg.readString();
    if (str.length === 0)
      break;
    model_precache[nummodels] = str;
  }
  var numsounds, sound_precache = [];
  for (numsounds = 1; ; ++numsounds)
  {
    str = msg.readString();
    if (str.length === 0)
      break;
    sound_precache[numsounds] = str;
  }

  // Store precache names — actual loading is deferred to checkDownloads()
  // so that missing assets can be downloaded first
  dlState.model_names = model_precache;
  dlState.sound_names = sound_precache;
  dlState.model_download_index = 1;
  dlState.sound_download_index = 1;
  clState.model_precache = [];
  clState.sound_precache = [];
  clState.particle_precache = [];
  pscript.reset(); // effectinfo.txt can differ per mod dir; re-resolved lazily on next lookup

  // Actual model/sound loading is deferred to checkDownloads() in the frame loop.
  // This allows cl_serverextension_download (received via stufftext in the same message)
  // to be executed first by cmd.execute() at the top of the next frame, so checkDownloads
  // knows whether to attempt downloads before loading.
};

// Lets the browser present the canvas and paint between precache items.
const yieldToBrowser = function(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve));
};

const loadAllPrecaches = async function() {
  const model_precache = dlState.model_names;
  const sound_precache = dlState.sound_names;
  const total = (model_precache.length - 1) + (sound_precache.length - 1);
  let done = 0;
  try {
    for (let i = 1; i < model_precache.length; ++i)
    {
      const name = model_precache[i];
      scr.state.loadProgress = {text: 'Loading ' + name, current: done, total};
      if (name[0] !== '*')
      {
        scr.updateScreen();
        await yieldToBrowser();
        // loadFileSync only sees files made resident at engine init; pull
        // anything that arrived later (IndexedDB writes, remote files) into
        // residency here — this is a pause point, awaits are allowed. Models
        // already parsed (e.g. shared with the local server) skip the byte
        // fetch entirely: huge sources are evicted from residency after
        // parsing (mod.loadBrushModel) and must not be pointlessly re-read.
        if (mod.needsLoad(name)) {
          if (com.loadFileSync(name) == null)
            await com.loadFile(name);
          if (name.endsWith('.bsp')) {
            const litName = com.removeExtension(name) + '.lit';
            if (com.loadFileSync(litName) == null)
              await com.loadFile(litName);
          }
        }
      }
      clState.model_precache[i] = mod.forName(name);
      if (clState.model_precache[i] == null)
        host.throwError('Model ' + name + ' not found');
      ++done;
    }
    for (let i = 1; i < sound_precache.length; ++i)
    {
      scr.state.loadProgress = {text: 'Loading sound/' + sound_precache[i], current: done, total};
      if ((i & 15) === 1)
      {
        scr.updateScreen();
        await yieldToBrowser();
      }
      clState.sound_precache[i] = await s.precacheSound(sound_precache[i]);
      ++done;
    }
  } finally {
    scr.state.loadProgress = null;
  }
  clState.worldmodel = clState.model_precache[1];
  entityNum(0).model = clState.worldmodel;
  r.newMap();
  host.state.noclip_anglehack = false;
};

// --- QSS Download Extension Protocol ---

const DOWNLOAD_ALLOWED_PREFIXES = ['sound/', 'progs/', 'maps/', 'models/'];
const DOWNLOAD_ALLOWED_EXTENSIONS = [
  'bsp', 'mdl', 'iqm', 'md3', 'spr', 'spr32',
  'wav', 'ogg', 'mp3',
  'tga', 'png',
  'lux', 'lit2', 'lit'
];

const downloadNameOkay = function(filename: string): boolean {
  if (!filename || filename.length === 0)
    return false;
  // Block path traversal
  if (filename.indexOf('\\') !== -1 || filename.indexOf(':') !== -1 ||
      filename.indexOf('*') !== -1 || filename.indexOf('?') !== -1 ||
      filename.indexOf('"') !== -1)
    return false;
  if (filename.indexOf('//') !== -1)
    return false;
  if (filename[0] === '.' || filename.indexOf('/.') !== -1)
    return false;

  // Check prefix
  const hasValidPrefix = DOWNLOAD_ALLOWED_PREFIXES.some(p => filename.startsWith(p));
  if (!hasValidPrefix)
    return false;

  // Check extension
  const dot = filename.lastIndexOf('.');
  if (dot === -1)
    return false;
  const ext = filename.substring(dot + 1).toLowerCase();
  return DOWNLOAD_ALLOWED_EXTENSIONS.indexOf(ext) !== -1;
};

const shouldDownload = function(filename: string): boolean {
  if (!cls.protocol_dpdownload)
    return false;
  if (cls.isLocalServer) // local server (in-process or Worker) — files are already local
    return false;
  if (filename[0] === '*') // internal names (inline models)
    return false;
  if (!downloadNameOkay(filename))
    return false;
  return true;
};

// Command handler: server sends "cl_serverextension_download 1" via stufftext
const cl_serverextension_download_f = function() {
  cls.protocol_dpdownload = q.atoi(cmd.state.argv[1]);
  con.dPrint('[cl] Server supports download extension: ' + cls.protocol_dpdownload + '\n');
};

// Command handler: server sends "cl_downloadbegin <size> <filename>" via stufftext
const cl_downloadbegin_f = function() {
  const size = parseInt(cmd.state.argv[1]);
  const filename = cmd.state.argv[2];
  // Buffer may already be allocated by immediate stufftext intercept
  if (!dlState.download.data) {
    dlState.download.size = size;
    dlState.download.data = new Uint8Array(size);
    con.print('[cl] Download begin: ' + filename + ' (' + size + ' bytes)\n');
  }
  // Respond with sv_startdownload to tell server to start sending data
  msg.writeByte(cls.message, protocol.CLC.stringcmd);
  msg.writeString(cls.message, 'sv_startdownload');
};

// Command handler: server sends "cl_downloadfinished <size> <crc> <filename>" via stufftext
const cl_downloadfinished_f = async function() {
  const size = parseInt(cmd.state.argv[1]);
  const hash = parseInt(cmd.state.argv[2]);
  const filename = cmd.state.argv[3];

  if (!dlState.download.active || !dlState.download.data) {
    con.print('[cl] Download finished but no active download\n');
    return;
  }

  // Verify size
  if (size !== dlState.download.size) {
    con.print('[cl] Download size mismatch: expected ' + dlState.download.size + ', got ' + size + '\n');
    dlState.download.active = false;
    dlState.download.data = null;
    return;
  }

  // Verify CRC
  const computedCrc = crc.block(dlState.download.data);
  if (computedCrc !== hash) {
    con.print('[cl] Download CRC mismatch for ' + filename + ': expected ' + hash + ', got ' + computedCrc + '\n');
    dlState.download.active = false;
    dlState.download.data = null;
    return;
  }

  // Save the downloaded file to the asset store
  const game = com.state.searchpaths[com.state.searchpaths.length - 1].dir;
  const saveBuf = new ArrayBuffer(dlState.download.data.byteLength);
  new Uint8Array(saveBuf).set(dlState.download.data);
  await com.state.assetStore.saveDownloadedFile(game, filename, saveBuf);
  con.print('[cl] Downloaded and saved: ' + filename + '\n');

  dlState.download.active = false;
  dlState.download.data = null;
};

// Command handler: server sends "stopdownload" via stufftext when download is rejected
const stopdownload_f = function() {
  con.print('[cl] Server rejected download' +
    (dlState.download.active ? ': ' + dlState.download.filename : '') + '\n');
  dlState.download.active = false;
  dlState.download.data = null;
};

// Handle SVC 50 (svcdp_downloaddata): binary download data chunk
export const parseDownloadData = function() {
  const start = msg.readLong();
  const size = msg.readShort() & 0xFFFF; // unsigned short
  const data = msg.readData(size);

  if (!dlState.download.active || !dlState.download.data)
    return;

  // Write data into our buffer at the specified offset
  if (start >= 0 && start + size <= dlState.download.size) {
    dlState.download.data.set(data, start);
    dlState.download.received = start + size;

    // Print progress at every 10% increment
    const pct = Math.floor(dlState.download.received * 10 / dlState.download.size) * 10;
    if (pct !== dlState.download.lastPct) {
      dlState.download.lastPct = pct;
      con.print('Downloading ' + dlState.download.filename + '... ' + pct + '%\n');
    }
  }

  // Send ack back unreliably — reliable acks block the nqnetchan
  // canSend flag and prevent sv_startdownload and other messages
  // from being sent in a timely manner
  const ackBuf: IDatagram = sz.newDatagram(7);
  msg.writeByte(ackBuf, protocol.CLC.dp_ackdownloaddata);
  msg.writeLong(ackBuf, start);
  msg.writeShort(ackBuf, size);
  net.sendUnreliableMessage(cls.netcon, ackBuf);
};

// Check if a file needs downloading; if so, request it.
// Returns: true = file is available (or can't be downloaded), false = waiting for download
const checkOrDownloadFile = async function(filename: string): Promise<boolean> {
  if (!shouldDownload(filename))
    return true;

  // Already downloading?
  if (dlState.download.active)
    return false;

  // Already tried this file (prevents infinite retry)
  if (dlState.download.lastFilename === filename)
    return true;

  // Check if file exists locally
  const existing = await com.loadFile(filename);
  if (existing)
    return true;

  // Request download
  con.print('[cl] Requesting download: ' + filename + '\n');
  dlState.download.active = true;
  dlState.download.filename = filename;
  dlState.download.lastFilename = filename;
  dlState.download.size = 0;
  dlState.download.received = 0;
  dlState.download.lastPct = -1;
  dlState.download.data = null;
  msg.writeByte(cls.message, protocol.CLC.stringcmd);
  msg.writeString(cls.message, 'download "' + filename + '"');
  return false;
};

// Main download state machine — called each frame from host._frame while sendprespawn is true.
// Returns true when all downloads are complete and precaches are loaded.
export const checkDownloads = async function(): Promise<boolean> {
  // If no model names have been stored, parseServerInfo hasn't run yet
  // (e.g. FTE protocol negotiation phase). Don't send prespawn — let the
  // NOP keepalive maintain the connection while the protocols response
  // reaches the server and triggers the real signon with SVC_SERVERINFO.
  if (dlState.model_names.length === 0)
    return false;

  // If dpdownload is not yet set, wait a couple of frames for
  // cl_serverextension_download stufftext to be processed by cmd.execute.
  // The stufftext may arrive in the same or a different reliable message
  // as SVC_SERVERINFO — waiting avoids a premature loadAllPrecaches.
  if (!cls.protocol_dpdownload) {
    dlState.download_check_wait++;
    if (dlState.download_check_wait <= 2)
      return false;
  }

  // If download protocol is supported, check for missing files first
  if (cls.protocol_dpdownload) {
    // If a download is currently in progress, wait for it to finish
    if (dlState.download.active)
      return false;

    // Check models
    while (dlState.model_download_index < dlState.model_names.length) {
      const name = dlState.model_names[dlState.model_download_index];
      if (name && name[0] !== '*') { // skip inline models
        if (!await checkOrDownloadFile(name)) {
          return false; // download started, wait
        }
      }
      dlState.model_download_index++;
    }

    // Check sounds (need "sound/" prefix for download path)
    while (dlState.sound_download_index < dlState.sound_names.length) {
      const name = dlState.sound_names[dlState.sound_download_index];
      if (name) {
        if (!await checkOrDownloadFile('sound/' + name)) {
          return false; // download started, wait
        }
      }
      dlState.sound_download_index++;
    }
  }

  // All downloads complete (or no download support) — load all precaches
  await loadAllPrecaches();
  return true;
};

export const parseUpdate = function(bits: number)
{
  if (cls.signon === 3)
  {
    cls.signon = 4;
    signonReply();
  }

  if ((bits & protocol.U.morebits) !== 0)
    bits |= (msg.readByte() << 8);
  if ((bits & protocol.U.extend1) !== 0)
    bits |= (msg.readByte() << 16)
  if ((bits & protocol.U.extend2) !== 0)
    bits |= (msg.readByte() << 24)
  
  var ent = entityNum(((bits & protocol.U.longentity) !== 0) ? msg.readShort() : msg.readByte());

  var forcelink = ent.msgtime !== clState.mtime[1];
  // johnfitz -- no update in >0.2s (incl. brand-new entities, msgtime 0): kill all
  // lerps. Without resetmove, previousorigin stays at its initial (0,0,0) and any
  // U_LERPFINISH entity is rendered sliding in from the world origin forever.
  if (ent.msgtime + 0.2 < clState.mtime[0])
    ent.lerpflags |= r.LERP.resetanim | r.LERP.resetanim2 | r.LERP.resetmove;
  ent.msgtime = clState.mtime[0];

  let modNum = ((bits & protocol.U.model) !== 0) ? msg.readByte() : ent.baseline.modelindex

  ent.frame = ((bits & protocol.U.frame) !== 0) ? msg.readByte() : ent.baseline.frame;
  ent.colormap = ((bits & protocol.U.colormap) !== 0) ? msg.readByte() : ent.baseline.colormap;
  if (ent.colormap > clState.maxclients)
    ent.colormap = 0; // extended player slot beyond maxclients, use default colormap
  ent.skinnum = ((bits & protocol.U.skin) !== 0) ? msg.readByte() : ent.baseline.skin;
  ent.effects = ((bits & protocol.U.effects) !== 0) ? msg.readByte() : ent.baseline.effects;

  vec.copy(ent.msg_origins[0], ent.msg_origins[1]);
  vec.copy(ent.msg_angles[0], ent.msg_angles[1]);
  ent.msg_origins[0][0] = ((bits & protocol.U.origin1) !== 0) ? msg.readCoord(clState.protocolFlags) : ent.baseline.origin[0];
  ent.msg_angles[0][0] = ((bits & protocol.U.angle1) !== 0) ? msg.readAngle(clState.protocolFlags) : ent.baseline.angles[0];
  ent.msg_origins[0][1] = ((bits & protocol.U.origin2) !== 0) ? msg.readCoord(clState.protocolFlags) : ent.baseline.origin[1];
  ent.msg_angles[0][1] = ((bits & protocol.U.angle2) !== 0) ? msg.readAngle(clState.protocolFlags) : ent.baseline.angles[1];
  ent.msg_origins[0][2] = ((bits & protocol.U.origin3) !== 0) ? msg.readCoord(clState.protocolFlags) : ent.baseline.origin[2];
  ent.msg_angles[0][2] = ((bits & protocol.U.angle3) !== 0) ? msg.readAngle(clState.protocolFlags) : ent.baseline.angles[2];

  if (bits & protocol.U.alpha)
    ent.alpha = msg.readByte()
  else
    ent.alpha = ent.baseline.alpha

  // RMQ (999) .scale; reset to baseline every update so a stale value can't survive
  // slot reuse -- mirrors CL_ParseUpdate (cl_parse.c) alpha/scale handling.
  if (bits & protocol.U.scale)
    ent.scale = msg.readByte()
  else
    ent.scale = ent.baseline.scale

  if (bits & protocol.U.frame2)
    ent.frame = (ent.frame & 0x00FF) | (msg.readByte() << 8)
  if (bits & protocol.U.model2) 
    modNum = (modNum & 0x00FF) | (msg.readByte() << 8)

  if (bits & protocol.U.lerpfinish) {
    ent.lerpfinish = ent.msgtime + (msg.readByte() / 255)
    ent.lerpflags |= r.LERP.finish
  } else {
    ent.lerpflags &= ~r.LERP.finish
  }

  var model = clState.model_precache[modNum];
  if (model !== ent.model)
  {
    ent.model = model;
    if (model != null)
      ent.syncbase = (model.random === true) ? Math.random() : 0.0;
    else
      forcelink = true;
    ent.lerpflags |= r.LERP.resetanim;
  }

  if ((bits & protocol.U.nolerp) !== 0) {
    ent.lerpflags |= r.LERP.movestep;
    ent.forcelink = true;
  } else
    ent.lerpflags &= ~r.LERP.movestep;

  if (forcelink === true)
  {
    vec.copy(ent.msg_origins[0], ent.origin);
    vec.copy(ent.origin, ent.msg_origins[1]);
    vec.copy(ent.msg_angles[0], ent.angles);
    vec.copy(ent.angles, ent.msg_angles[1]);
    ent.forcelink = true;
  }
};

const parseBaseline = function(ent: Entity, version: number)
{
  var i, bits
  if (clState.protocol === protocol.VERSION.bjp3) {
    ent.baseline.modelindex = msg.readShort()
    ent.baseline.frame = msg.readByte()
    bits = 0
  } else {
    bits = version === 2 ? msg.readByte() : 0
    ent.baseline.modelindex = (bits & protocol.BASE.largemodel) ? msg.readShort() : msg.readByte()
    ent.baseline.frame = (bits & protocol.BASE.largeframe) ? msg.readShort() : msg.readByte()
  }

  ent.baseline.colormap = msg.readByte();
  ent.baseline.skin = msg.readByte();
  ent.baseline.origin[0] = msg.readCoord(clState.protocolFlags);
  ent.baseline.angles[0] = msg.readAngle(clState.protocolFlags);
  ent.baseline.origin[1] = msg.readCoord(clState.protocolFlags);
  ent.baseline.angles[1] = msg.readAngle(clState.protocolFlags);
  ent.baseline.origin[2] = msg.readCoord(clState.protocolFlags);
  ent.baseline.angles[2] = msg.readAngle(clState.protocolFlags);

  ent.baseline.alpha = bits & protocol.BASE.alpha ? msg.readByte() : protocol.ENT_ALPHA.default
  // B_SCALE only valid under RMQ, but read whenever the bit is set (server only sets it
  // under 999) -- matches QSS-M cl_parse.c CL_ParseSpawnBaseline.
  ent.baseline.scale = bits & protocol.BASE.scale ? msg.readByte() : protocol.ENTSCALE_DEFAULT
};

export const parseClientdata = function()
{
  var i;

  var bits = (new Uint16Array([msg.readShort()]))[0]

  // fitzquake protocol additional data
	if (bits & protocol.SU.extend1)
		bits |= (msg.readByte() << 16);

	if (bits & protocol.SU.extend2)
    bits |= (msg.readByte() << 24);
  
  clState.viewheight = ((bits & protocol.SU.viewheight) !== 0) ? msg.readChar() : protocol.default_viewheight;
  clState.idealpitch = ((bits & protocol.SU.idealpitch) !== 0) ? msg.readChar() : 0.0;

  clState.mvelocity[1] = [clState.mvelocity[0][0], clState.mvelocity[0][1], clState.mvelocity[0][2]];
  for (i = 0; i <= 2; ++i)
  {
    if ((bits & (protocol.SU.punch1 << i)) !== 0)
      clState.punchangle[i] = msg.readChar();
    else
      clState.punchangle[i] = 0.0;
    if ((bits & (protocol.SU.velocity1 << i)) !== 0)
      clState.mvelocity[0][i] = msg.readChar() * 16.0;
    else
      clState.mvelocity[0][i] = 0.0;
  }

  i = msg.readLong();
  var j;
  if (clState.items !== i)
  {
    for (j = 0; j <= 31; ++j)
    {
      if ((((i >>> j) & 1) !== 0) && (((clState.items >>> j) & 1) === 0))
        clState.item_gettime[j] = clState.time;
    }
    clState.items = i;
  }

  clState.onground = (bits & protocol.SU.onground) !== 0;
  clState.inwater = (bits & protocol.SU.inwater) !== 0;

  clState.stats[def.STAT.weaponframe] = ((bits & protocol.SU.weaponframe) !== 0) ? msg.readByte() : 0;
  clState.stats[def.STAT.armor] = ((bits & protocol.SU.armor) !== 0) ? msg.readByte() : 0;
  clState.stats[def.STAT.weapon] = ((bits & protocol.SU.weapon) !== 0) ? msg.readByte() : 0;
  clState.stats[def.STAT.health] = msg.readShort();
  clState.stats[def.STAT.ammo] = msg.readByte();
  clState.stats[def.STAT.shells] = msg.readByte();
  clState.stats[def.STAT.nails] = msg.readByte();
  clState.stats[def.STAT.rockets] = msg.readByte();
  clState.stats[def.STAT.cells] = msg.readByte();
  if (com.state.standard_quake === true)
    clState.stats[def.STAT.activeweapon] = msg.readByte();
  else
    clState.stats[def.STAT.activeweapon] = 1 << msg.readByte();

  if (bits & protocol.SU.weapon2)
    clState.stats[def.STAT.weapon] |= (msg.readByte() << 8);

  if (bits & protocol.SU.armor2)
    clState.stats[def.STAT.armor] |= (msg.readByte() << 8);

  if (bits & protocol.SU.ammo2)
    clState.stats[def.STAT.ammo] |= (msg.readByte() << 8);

  if (bits & protocol.SU.shells2)
    clState.stats[def.STAT.shells] |= (msg.readByte() << 8);

  if (bits & protocol.SU.nails2)
    clState.stats[def.STAT.nails] |= (msg.readByte() << 8);

  if (bits & protocol.SU.rockets2)
    clState.stats[def.STAT.rockets] |= (msg.readByte() << 8);

  if (bits & protocol.SU.cells2)
    clState.stats[def.STAT.cells] |= (msg.readByte() << 8);

  if (bits & protocol.SU.weaponframe2)
    clState.stats[def.STAT.weaponframe] |= (msg.readByte() << 8);

  if (bits & protocol.SU.weaponalpha)
    msg.readByte() // TODO: weaponalpha

  // if (bits & SU_WEAPONALPHA)
  //   cl.viewent_gun.alpha = MSG_ReadByte();
  // else
  //   cl.viewent_gun.alpha = ENTALPHA_DEFAULT;
};

export const parseStatic = function(version: number) {
  const ent = newEntity(-1)
  parseBaseline(ent, version);
  ent.model = clState.model_precache[ent.baseline.modelindex];
  ent.lerpflags |= r.LERP.resetanim | r.LERP.resetmove
  ent.frame = ent.baseline.frame;
  ent.skinnum = ent.baseline.skin;
  ent.effects = ent.baseline.effects;
  ent.alpha = ent.baseline.alpha
  ent.scale = ent.baseline.scale
  ent.colormap = 0 // TODO: Joe this doesn't seem right.
  ent.origin = [ent.baseline.origin[0], ent.baseline.origin[1], ent.baseline.origin[2]];
  ent.angles = [ent.baseline.angles[0], ent.baseline.angles[1], ent.baseline.angles[2]];

  if (ent.model) {
    var emins: V3 = [ent.origin[0] + ent.model.mins[0], ent.origin[1] + ent.model.mins[1], ent.origin[2] + ent.model.mins[2]];
    var emaxs: V3 = [ent.origin[0] + ent.model.maxs[0], ent.origin[1] + ent.model.maxs[1], ent.origin[2] + ent.model.maxs[2]];
  
    r.splitEntityOnNode(0, ent, emins, emaxs);
  }
};

export const parseStaticSound = function(version: number) {
  var org: V3 = [msg.readCoord(clState.protocolFlags), msg.readCoord(clState.protocolFlags), msg.readCoord(clState.protocolFlags)];
  var sound_num

	//johnfitz -- PROTOCOL_FITZQUAKE
	if (version == 2)
		sound_num = msg.readShort();
	else
		sound_num = msg.readByte();
  //johnfitz
  
  var vol = msg.readByte();
  var atten = msg.readByte();
  s.staticSound(clState.sound_precache[sound_num], org, vol / 255.0, atten);
};

export const shownet = function(x: string)
{
  if (cvr.shownet.value === 2)
  {
    con.print((msg.state.readcount <= 99 ? (msg.state.readcount <= 9 ? '  ' : ' ') : '')
      + (msg.state.readcount - 1) + ':' + x + '\n');
  }
};

export const parseServerMessage = async function()
{
  if (cvr.shownet.value === 1)
    con.print(net.state.message.cursize + ' ');
  else if (cvr.shownet.value === 2)
    con.print('------------------\n');

  // no vanilla `onground = false` reset here (QSS-M cl_parse.c): messages without
  // clientdata (reliables) would leave a false airborne tick and jerk the view's
  // stair-step smoothing while riding movers; svc_clientdata is the sole writer

  msg.beginReading();

  var _cmd, i;
  var _lastcmd = -1;
  for (;;)
  {
    if (msg.state.badread === true) {
      const msgBytes = Array.from(new Uint8Array(net.state.message.data, 0, net.state.message.cursize)).map(b => b.toString(16).padStart(2,'0')).join(' ');
      console.error(`[cl] Bad server message after svc ${_lastcmd} (0x${_lastcmd.toString(16)}), readcount=${msg.state.readcount}, cursize=${net.state.message.cursize}\nFull message: ${msgBytes}`);
      host.throwError(`CL.ParseServerMessage: Bad server message (after svc ${_lastcmd})`);
    }

    _cmd = msg.readByte();
    _lastcmd = _cmd;

    if (_cmd === -1)
    {
      shownet('END OF MESSAGE');
      return;
    }

    if ((_cmd & 128) !== 0)
    {
      shownet('fast update');
      parseUpdate(_cmd & 127);
      continue;
    }

    shownet('svc_' + SVC_STRINGS[_cmd]);
    switch (_cmd)
    {
      case protocol.SVC.nop:
        continue;
      case protocol.SVC.time:
        clState.mtime[1] = clState.mtime[0];
        clState.mtime[0] = msg.readFloat();
        continue;
      case protocol.SVC.clientdata:
        parseClientdata();
        continue;
      case protocol.SVC.version:
        i = msg.readLong();
        if (i !== protocol.netquake && i !== protocol.fitzquake && i !== protocol.rmq)
          host.throwError('CL.ParseServerMessage: Server is protocol ' + i + ' is not supported\n');
        clState.protocol = i
        continue;
      case protocol.SVC.disconnect:
        host.throwEndGame('Server disconnected\n');
      case protocol.SVC.print: {
        const printtext = msg.readString()
        if (!parseSpecialPrint(printtext))
          con.print(printtext);
        continue;
      }
      case protocol.SVC.centerprint:
        scr.centerPrint(msg.readString());
        continue;
      case protocol.SVC.stufftext: {
        const stuffed = msg.readString();
        // Handle download-related stufftext immediately rather than waiting
        // for cmd.execute() next frame — SVC 50 data chunks may follow in
        // the same server message and need the download state set up.
        if (stuffed.startsWith('cl_serverextension_download ')) {
          cls.protocol_dpdownload = parseInt(stuffed.split(' ')[1]) || 0;
        } else if (stuffed.startsWith('cl_downloadbegin ')) {
          // Parse and set up the download buffer immediately so that
          // SVC 50 chunks in the same message aren't discarded
          const parts = stuffed.trim().split(' ');
          const dlSize = parseInt(parts[1]);
          const dlName = parts[2];
          if (dlSize > 0 && dlName) {
            dlState.download.size = dlSize;
            dlState.download.data = new Uint8Array(dlSize);
            con.print('[cl] Download begin: ' + dlName + ' (' + dlSize + ' bytes)\n');
          }
        }
        cmd.state.text += stuffed;
        continue;
      }
      case protocol.SVC.damage:
        v.parseDamage();
        continue;
      case protocol.SVC.serverinfo:
        await parseServerInfo();
        scr.state.recalc_refdef = true;
        continue;
      case protocol.SVC.setangle: {
        clState.viewangles[0] = msg.readAngle(clState.protocolFlags);
        clState.viewangles[1] = msg.readAngle(clState.protocolFlags);
        clState.viewangles[2] = msg.readAngle(clState.protocolFlags);
        continue;
      }
      case protocol.SVC.setview:
        clState.viewentity = msg.readShort();
        continue;
      case protocol.SVC.lightstyle:
        i = msg.readByte();
        if (i >= 64)
          sys.error('svc_lightstyle > MAX_LIGHTSTYLES');
        state.lightstyle[i] = msg.readString();
        continue;
      case protocol.SVC.sound:
        parseStartSoundPacket();
        continue;
      case protocol.SVC.stopsound:
        i = msg.readShort();
        s.stopSound(i >> 3, i & 7);
        continue;
      case protocol.SVC.updatename:
        i = msg.readByte();
        if (i >= clState.maxclients) {
          msg.readString();
          continue;
        }
        clState.scores[i].name = msg.readString();
        continue;
      case protocol.SVC.updatefrags:
        i = msg.readByte();
        if (i >= clState.maxclients) {
          msg.readShort();
          continue;
        }
        clState.scores[i].frags = msg.readShort();
        continue;
      case protocol.SVC.updatecolors:
        i = msg.readByte();
        if (i >= clState.maxclients) {
          msg.readByte();
          continue;
        }
        clState.scores[i].colors = msg.readByte();
        continue;
      case protocol.SVC.particle:
        r.parseParticleEffect();
        continue;
      case protocol.SVC.spawnbaseline:
        parseBaseline(entityNum(msg.readShort()), 1);
        continue;
      case protocol.SVC.spawnstatic:
        parseStatic(1);
        continue;
      case protocol.SVC.temp_entity:
        parseTEnt();
        continue;
      case protocol.SVC.setpause:
        clState.paused = msg.readByte() !== 0;
        if (clState.paused === true)
          cdAudio.pause();
        else
          await cdAudio.resume();
        continue;
      case protocol.SVC.signonnum:
        i = msg.readByte();
        if (i <= cls.signon)
          host.throwError('Received signon ' + i + ' when at ' + cls.signon);
        cls.signon = i;
        signonReply();
        continue;
      case protocol.SVC.killedmonster:
        ++clState.stats[def.STAT.monsters];
        continue;
      case protocol.SVC.foundsecret:
        ++clState.stats[def.STAT.secrets];
        continue;
      case protocol.SVC.updatestat:
        i = msg.readByte();
        if (i >= 32) {
          msg.readLong(); // extended stat index - read and discard
          continue;
        }
        clState.stats[i] = msg.readLong();
        continue;
      case protocol.SVC.spawnstaticsound:
        parseStaticSound(1);
        continue;
      case protocol.SVC.cdtrack:
        clState.cdtrack = msg.readByte();
        msg.readByte();
        // fire-and-forget: the track lookup can probe 8 asset paths (IndexedDB queued
        // behind package installs, remote file list) and must not stall svc parsing
        if (((cls.demoplayback === true) || (cls.demorecording === true)) && (cls.forcetrack !== -1))
          cdAudio.play(cls.forcetrack, true).catch(function() {});
        else
          cdAudio.play(clState.cdtrack, true).catch(function() {});
        continue;
      case protocol.SVC.intermission:
        clState.intermission = 1;
        clState.completed_time = clState.time;
        scr.state.recalc_refdef = true;
        continue;
      case protocol.SVC.finale:
        clState.intermission = 2;
        clState.completed_time = clState.time;
        scr.state.recalc_refdef = true;
        scr.centerPrint(msg.readString());
        continue;
      case protocol.SVC.cutscene:
        clState.intermission = 3;
        clState.completed_time = clState.time;
        scr.state.recalc_refdef = true;
        scr.centerPrint(msg.readString());
        continue;
      case protocol.SVC.sellscreen:
        cmd.executeString('help', cmd.CMD_SOURCE.src_command);
        continue;
      // Read and drop, as QSS-M cl_parse.c:4514 does: no achievement backend, but the
      // string still has to leave the stream.
      case protocol.SVC.achievement:
        con.dPrint('Ignoring svc_achievement (' + msg.readString() + ')\n');
        continue;
      case protocol.SVC.showlmp: {
        const slotname = msg.readString();
        const lmpfile = msg.readString();
        const lx = msg.readByte();
        const ly = msg.readByte();
        tx.loadLmp(lmpfile).then(pic => {
          if (pic) state.showlmps.set(slotname, { pic, x: lx, y: ly });
        });
        continue;
      }
      case protocol.SVC.hidelmp:
        // FTE NQ mode: [byte player][short value] (player stat update, not Nehahra hidelmp)
        msg.readByte();
        msg.readShort();
        continue;
      case protocol.SVC.skybox:
        // FTE NQ mode: [byte player][long value] (player stat update, not FitzQuake skybox string)
        msg.readByte();
        msg.readLong();
        continue;
      case protocol.SVC.bf:
        // FTE NQ mode: [byte player][long flags][string infostring] (player info update, not FitzQuake bf)
        msg.readByte();
        msg.readLong();
        msg.readString();
        continue;
      case protocol.SVC.fog:
        msg.readByte(); msg.readByte(); msg.readByte(); msg.readByte(); // density, r, g, b
        msg.readShort(); // time in centiseconds
        continue;
      case protocol.SVC.spawnbaseline2: //PROTOCOL_FITZQUAKE
        parseBaseline(entityNum(msg.readShort()), 2);
        continue;
      case protocol.SVC.spawnstatic2:
        parseStatic(2)
        continue;
      case protocol.SVC.spawnstaticsound2:
        parseStaticSound(2);
        continue;
      case protocol.SVC.dp_downloaddata:
        parseDownloadData();
        continue;
      case protocol.SVC.effect:
        parseEffect(false);
        continue;
      case protocol.SVC.effect2:
        // In NQ/FitzQuake protocol (non-DP7), SVC 53 appears to be a 2-byte FTE message (e.g. playernum + ping)
        msg.readByte();
        msg.readByte();
        continue;
      case protocol.SVC.dp_precache:
        parseDpPrecache();
        continue;
      case protocol.SVC.dp_trailparticles:
        parseDpTrailParticles();
        continue;
      case protocol.SVC.dp_pointparticles:
        parseDpPointParticles(false);
        continue;
      case protocol.SVC.dp_pointparticles1:
        parseDpPointParticles(true);
        continue;
    }
    const msgBytes = Array.from(new Uint8Array(net.state.message.data, 0, net.state.message.cursize)).map(b => b.toString(16).padStart(2,'0')).join(' ');
    console.error(`[cl] Illegible server message code ${_cmd} (0x${_cmd.toString(16)}), readcount=${msg.state.readcount}, cursize=${net.state.message.cursize}\nMessage bytes: ${msgBytes}`);
    host.throwError(`CL.ParseServerMessage: Illegible server message code ${_cmd}\n`);
  }
};

// TEnt

export const initTEnts = async function()
{
  state.tents.sfx_wizhit = await s.precacheSound('wizard/hit.wav');
  state.tents.sfx_knighthit = await s.precacheSound('hknight/hit.wav');
  state.tents.sfx_tink1 = await s.precacheSound('weapons/tink1.wav');
  state.tents.sfx_ric1 = await s.precacheSound('weapons/ric1.wav');
  state.tents.sfx_ric2 = await s.precacheSound('weapons/ric2.wav');
  state.tents.sfx_ric3 = await s.precacheSound('weapons/ric3.wav');
  state.tents.sfx_r_exp3 = await s.precacheSound('weapons/r_exp3.wav');
};

export const parseBeam = function(m: Model)
{
  var ent = msg.readShort();
  var start = [msg.readCoord(clState.protocolFlags), msg.readCoord(clState.protocolFlags), msg.readCoord(clState.protocolFlags)];
  var end = [msg.readCoord(clState.protocolFlags), msg.readCoord(clState.protocolFlags), msg.readCoord(clState.protocolFlags)];
  let i, b: Beam;
  for (i = 0; i <= 23; ++i)
  {
    b = state.beams[i];
    if (b.entity !== ent)
      continue;
    b.model = m;
    b.endtime = clState.time + 0.2;
    b.start = [start[0], start[1], start[2]];
    b.end = [end[0], end[1], end[2]];
    return;
  }
  for (i = 0; i <= 23; ++i)
  {
    b = state.beams[i];
    if ((b.model != null) && (b.endtime >= clState.time))
      continue;
    b.entity = ent;
    b.model = m;
    b.endtime = clState.time + 0.2;
    b.start = [start[0], start[1], start[2]];
    b.end = [end[0], end[1], end[2]];
    return;
  }
  con.print('beam list overflow!\n');
};

export const parseTEnt = function()
{
  var type = msg.readByte();

  switch (type)
  {
  case protocol.TE.lightning1:
    parseBeam(mod.forName('progs/bolt.mdl', true));
    return;
  case protocol.TE.lightning2:
    parseBeam(mod.forName('progs/bolt2.mdl', true));
    return;
  case protocol.TE.lightning3:
    parseBeam(mod.forName('progs/bolt3.mdl', true));
    return;
  case protocol.TE.beam:
    parseBeam(mod.forName('progs/beam.mdl', true));
    return;
  case protocol.TE.dp_particlerain:
  case protocol.TE.dp_particlesnow: {
    const minb = vec.scratch(), maxb = vec.scratch(), wdir = vec.scratch();
    minb[0] = msg.readCoord(clState.protocolFlags); minb[1] = msg.readCoord(clState.protocolFlags); minb[2] = msg.readCoord(clState.protocolFlags);
    maxb[0] = msg.readCoord(clState.protocolFlags); maxb[1] = msg.readCoord(clState.protocolFlags); maxb[2] = msg.readCoord(clState.protocolFlags);
    wdir[0] = msg.readCoord(clState.protocolFlags); wdir[1] = msg.readCoord(clState.protocolFlags); wdir[2] = msg.readCoord(clState.protocolFlags);
    const cnt = msg.readShort() & 0xffff;
    const colour = msg.readByte();
    pscript.runParticleWeather(minb as unknown as pscript.Vec3, maxb as unknown as pscript.Vec3, wdir as unknown as pscript.Vec3, cnt, colour, type === protocol.TE.dp_particlesnow ? 'snow' : 'rain');
    return;
  }
  }

  var pos: V3 = [msg.readCoord(clState.protocolFlags), msg.readCoord(clState.protocolFlags), msg.readCoord(clState.protocolFlags)];
  var dl;
  switch (type)
  {
  case protocol.TE.wizspike:
    r.runParticleEffect(pos, vec.origin, 20, 20);
    s.startSound(-1, 0, state.tents.sfx_wizhit, pos, 1.0, 1.0);
    return;
  case protocol.TE.knightspike:
    r.runParticleEffect(pos, vec.origin, 226, 20);
    s.startSound(-1, 0, state.tents.sfx_knighthit, pos, 1.0, 1.0);
    return;
  case protocol.TE.spike:
    r.runParticleEffect(pos, vec.origin, 0, 10);
    return;
  case protocol.TE.superspike:
    r.runParticleEffect(pos, vec.origin, 0, 20);
    return;
  case protocol.TE.gunshot:
    r.runParticleEffect(pos, vec.origin, 0, 20);
    return;
  case protocol.TE.explosion:
    r.particleExplosion(pos);
    dl = allocDlight(0);
    dl.origin = [pos[0], pos[1], pos[2]];
    dl.radius = 350.0;
    dl.die = clState.time + 0.5;
    dl.decay = 300.0;
    s.startSound(-1, 0, state.tents.sfx_r_exp3, pos, 1.0, 1.0);
    return;
  case protocol.TE.tarexplosion:
    r.blobExplosion(pos);
    s.startSound(-1, 0, state.tents.sfx_r_exp3, pos, 1.0, 1.0);
    return;
  case protocol.TE.lavasplash:
    r.lavaSplash(pos);
    return;
  case protocol.TE.teleport:
    r.teleportSplash(pos);
    return;
  case protocol.TE.explosion2:
    var colorStart = msg.readByte();
    var colorLength = msg.readByte();
    r.particleExplosion2(pos, colorStart, colorLength);
    dl = allocDlight(0);
    dl.origin = [pos[0], pos[1], pos[2]];
    dl.radius = 350.0;
    dl.die = clState.time + 0.5;
    dl.decay = 300.0;
    s.startSound(-1, 0, state.tents.sfx_r_exp3, pos, 1.0, 1.0);
    return;
  }

  sys.error('CL.ParseTEnt: bad type');
};

export const newTempEntity = function()
{
  // temp_entities is a growing pool, reused frame to frame by index — every
  // caller fully overwrites origin/angles/model/frame right after this call.
  var ent = state.temp_entities[state.num_temp_entities];
  if (ent == null)
  {
    ent = newEntity(0);
    state.temp_entities[state.num_temp_entities] = ent;
  }
  // temp entities bypass parseUpdate, so reset lerp state here (Ironwail
  // memsets per spawn); without this previouspose stays -1 and binds as a
  // negative VBO offset
  ent.lerpflags |= r.LERP.resetanim | r.LERP.resetmove;
  ++state.num_temp_entities;
  state.visedicts[state.numvisedicts++] = ent;
  return ent;
};

const parseEffect = function(big: boolean)
{
  const origin: V3 = [msg.readCoord(clState.protocolFlags), msg.readCoord(clState.protocolFlags), msg.readCoord(clState.protocolFlags)];
  const modelindex = big ? msg.readShort() : msg.readByte();
  const startframe = big ? msg.readShort() : msg.readByte();
  const framecount = msg.readByte();
  const framerate = msg.readByte();
  const model = clState.model_precache[modelindex];
  if (model == null)
    return;
  state.effects.push({
    origin,
    model,
    startframe,
    framecount: framecount || model.numframes,
    framerate,
    starttime: clState.time,
  });
};

// dp_precache (svc 54): [short] index|(type<<14) [string] name. We only act on the particle
// slice; model/sound tags are read and discarded so the stream doesn't desync (our own server
// never sends those tags, but a foreign QSS-M server could in principle).
const parseDpPrecache = function()
{
  const code = msg.readShort();
  const index = code & 0x3fff;
  const type = (code >> 14) & 0x3;
  const name = msg.readString();
  if (type === protocol.PRECACHE_TYPE.particle) {
    clState.particle_precache[index] = name;
    // Kick the background effectinfo.txt parse as soon as we know we'll need it -- idempotent,
    // see ensureEffectsLoaded's own comment. Timing compromise: a pointparticles/trailparticles
    // svc arriving before this resolves silently drops (findParticleType returns -1); in
    // practice the precache table fills at signon time, well before gameplay effects fire.
    pscript.ensureEffectsLoaded();
  }
};

// dp_trailparticles (svc 60): [short] entnum [short] effectnum [coord3] start [coord3] end.
// entnum only keys QSS-M's persistent per-entity trailstate cache, which pscript.runTrailEffect
// doesn't reproduce (see its comment) -- start/end already carry the absolute positions.
const parseDpTrailParticles = function()
{
  msg.readShort(); // entnum, unused (see comment above)
  const efnum = msg.readShort();
  const start = vec.scratch();
  start[0] = msg.readCoord(clState.protocolFlags); start[1] = msg.readCoord(clState.protocolFlags); start[2] = msg.readCoord(clState.protocolFlags);
  const end = vec.scratch();
  end[0] = msg.readCoord(clState.protocolFlags); end[1] = msg.readCoord(clState.protocolFlags); end[2] = msg.readCoord(clState.protocolFlags);
  const name = clState.particle_precache[efnum];
  if (name) pscript.runTrailEffect(pscript.findParticleType(name), start, end);
};

// dp_pointparticles / dp_pointparticles1 (svc 61/62): compact === true is the count==1,
// vel==0 short form (svc 62); compact === false reads the full vel+count form (svc 61).
const parseDpPointParticles = function(compact: boolean)
{
  const efnum = msg.readShort();
  const org = vec.scratch();
  org[0] = msg.readCoord(clState.protocolFlags); org[1] = msg.readCoord(clState.protocolFlags); org[2] = msg.readCoord(clState.protocolFlags);
  const vel = vec.scratch();
  let count = 1;
  if (compact) {
    vel[0] = 0; vel[1] = 0; vel[2] = 0;
  } else {
    vel[0] = msg.readCoord(clState.protocolFlags); vel[1] = msg.readCoord(clState.protocolFlags); vel[2] = msg.readCoord(clState.protocolFlags);
    count = msg.readShort();
  }
  const name = clState.particle_precache[efnum];
  if (name) pscript.runParticleEffect(pscript.findParticleType(name), org, vel, count);
};

export const updateTEnts = function()
{
  state.num_temp_entities = 0;
  var i, b, dist = vec.scratch(), yaw, pitch, org = vec.scratch(), d, ent;

  // sprite effects
  for (i = state.effects.length - 1; i >= 0; --i)
  {
    const ef = state.effects[i];
    const frame = Math.floor((clState.time - ef.starttime) * ef.framerate) + ef.startframe;
    if (frame >= ef.startframe + ef.framecount)
    {
      state.effects.splice(i, 1);
      continue;
    }
    ent = newTempEntity();
    ent.origin[0] = ef.origin[0]; ent.origin[1] = ef.origin[1]; ent.origin[2] = ef.origin[2];
    ent.model = ef.model;
    ent.frame = frame;
    ent.angles[0] = 0; ent.angles[1] = 0; ent.angles[2] = 0;
    ent.colormap = 0;
    ent.skinnum = 0;
    ent.effects = 0;
  }

  for (i = 0; i <= 23; ++i)
  {
    b = state.beams[i];
    if ((b.model == null) || (b.endtime < clState.time))
      continue;
    if (b.entity === clState.viewentity)
      vec.copy(state.entities[clState.viewentity].origin, b.start);
    dist[0] = b.end[0] - b.start[0];
    dist[1] = b.end[1] - b.start[1];
    dist[2] = b.end[2] - b.start[2];
    if ((dist[0] === 0.0) && (dist[1] === 0.0))
    {
      yaw = 0;
      pitch = dist[2] > 0.0 ? 90 : 270;
    }
    else
    {
      yaw = (Math.atan2(dist[1], dist[0]) * 180.0 / Math.PI) >> 0;
      if (yaw < 0)
        yaw += 360;
      pitch = (Math.atan2(dist[2], Math.sqrt(dist[0] * dist[0] + dist[1] * dist[1])) * 180.0 / Math.PI) >> 0;
      if (pitch < 0)
        pitch += 360;
    }
    org[0] = b.start[0];
    org[1] = b.start[1];
    org[2] = b.start[2];
    d = Math.sqrt(dist[0] * dist[0] + dist[1] * dist[1] + dist[2] * dist[2]);
    if (d !== 0.0)
    {
      dist[0] /= d;
      dist[1] /= d;
      dist[2] /= d;
    }
    for (; d > 0.0; )
    {
      ent = newTempEntity();
      ent.origin[0] = org[0]; ent.origin[1] = org[1]; ent.origin[2] = org[2];
      ent.model = b.model;
      ent.angles[0] = pitch; ent.angles[1] = yaw; ent.angles[2] = Math.random() * 360.0;
      org[0] += dist[0] * 30.0;
      org[1] += dist[1] * 30.0;
      org[2] += dist[2] * 30.0;
      d -= 30.0;
    }
  }
};