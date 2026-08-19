import * as cmd from './cmd'
import * as con from './console'
import * as com from './com'
import * as cvar from './cvar'
import * as host from './host'
import * as cl from './cl'
import * as mod from './mod'
import * as q from './q'
import * as vec from './vec'

import {Channel, Nodes, Sound } from './types/Sound'
import { V3 } from './types'

type SoundState = {
  channels: Channel[],
  context: AudioContext | null,
	static_channels: Channel[],
	ambient_channels: Channel[],
	listener_origin: V3,
	listener_forward: V3,
	listener_right: V3,
	listener_up: V3,
	known_sfx: Sound[]
}

export let state: SoundState
export const cvr: cvar.CVars = {} 

const onNoteEnd = (node: Nodes) => () => {
	node.state = 'end'
}

export const init = async function () {
	state = {
    channels: [],
    context: null,
    static_channels: [],
    ambient_channels: [],
    listener_origin: vec.emptyV3(),
    listener_forward: vec.emptyV3(),
    listener_right: vec.emptyV3(),
    listener_up: vec.emptyV3(),
    known_sfx: [],
  }
  
	con.print('\nSound Initialization\n');
	cmd.addCommand('play', play);
	cmd.addCommand('playvol', playVol);
	cmd.addCommand('stopsound', stopAllSounds);
	cmd.addCommand('soundlist', soundList);
	cvr.nosound = cvar.registerVariable('nosound', (com.checkParm('-nosound') != null) ? '1' : '0');
	cvr.volume = cvar.registerVariable('volume', '0.7', true);
	cvr.precache = cvar.registerVariable('precache', '1');
	cvr.bgmvolume = cvar.registerVariable('bgmvolume', '1', true);
	cvr.ambient_level = cvar.registerVariable('ambient_level', '0.3');
	cvr.ambient_fade = cvar.registerVariable('ambient_fade', '100');

	if ((window as any).AudioContext != null)
		state.context = new (window as any).AudioContext();
	else if ((window as any).webkitAudioContext != null)
		state.context = new (window as any).webkitAudioContext();

	var i, ambient_sfx = ['water1', 'wind2'], ch: Channel, nodes: Nodes;
	for (i = 0; i < ambient_sfx.length; ++i) {
		ch = {
      sfx: await precacheSound('ambience/' + ambient_sfx[i] + '.wav'), 
      end: 0.0, 
      master_vol: 0.0,
			nodes: null,
			origin: vec.emptyV3(),
			dist_mult: 0.0,
			entnum: 0,
			entchannel: 0,
			leftvol: 0.0,
			rightvol: 0.0,
			pos: 0.0
    };
		state.ambient_channels[i] = ch;
		if (await loadSound(ch.sfx) !== true)
			continue;
		if (ch.sfx.cache.loopstart == null) {
			con.print('Sound ambience/' + ch.sfx.name + '.wav not looped\n');
			continue;
		}
    nodes = {
      state: 'idle',
      source: state.context.createBufferSource(),
      gain: state.context.createGain(),
      merger1: null,
      splitter: null,
      gain0: null,
      gain1: null,
      merger2: null
    };
    ch.nodes = nodes;
    nodes.source.onended = onNoteEnd(nodes)
    nodes.source.buffer = ch.sfx.cache.data;
    nodes.source.loop = true;
    nodes.source.loopStart = ch.sfx.cache.loopstart;
    nodes.source.loopEnd = nodes.source.buffer.length;
    nodes.source.connect(nodes.gain);
    nodes.gain.connect(state.context.destination);
	}

	con.state.sfx_talk = await precacheSound('misc/talk.wav');
};

export const noteOff = function (node: Nodes) {
	if (node.state === 'playing') {
		try {
			node.source.stop(0)
		} catch(ex) {
			
		}
		node.state = 'idle'
	}
	// if ((node.playbackState === 1) || (node.playbackState === 2)) {
	// 	try { node.noteOff(0.0); } catch (e) { }
	// }
}

export const noteOn = function (node: Nodes) {
	if (node.state !== 'playing') {
		try {
			node.source.start(0)
		} catch(ex) {
			
		}
		node.state = 'playing'
	}
	// if ((node.playbackState === 0) || (node.playbackState === 3)) {
	// 	try { node.noteOn(0.0); } catch (e) { }
	// }
}

export const precacheSound = async function (name: string) {
	if (cvr.nosound.value !== 0)
		return;
	var i, sfx;
	for (i = 0; i < state.known_sfx.length; ++i) {
		if (state.known_sfx[i].name === name) {
			sfx = state.known_sfx[i];
			break;
		}
	}
	if (i === state.known_sfx.length) {
		state.known_sfx[i] = { 
      name: name,
      cache: null,
      data: null,
      type: null
    };
		sfx = state.known_sfx[i];
	}
	if (cvr.precache.value !== 0)
		await loadSound(sfx);
	return sfx;
};

export const pickChannel = function (entnum: number, entchannel: number) {
	var i, channel;

	if (entchannel !== 0) {
		for (i = 0; i < state.channels.length; ++i) {
			channel = state.channels[i];
			if (channel == null)
				continue;
			if ((channel.entnum === entnum) && ((channel.entchannel === entchannel) || (entchannel === -1))) {
				channel.sfx = null;
				if (channel.nodes != null) {
          noteOff(channel.nodes);
          channel.nodes = null;
				}

				break;
			}
		}
	}

	if ((entchannel === 0) || (i === state.channels.length)) {
		for (i = 0; i < state.channels.length; ++i) {
			channel = state.channels[i];
			if (channel == null)
				break;
			if (channel.sfx == null)
				break;
		}
	}

	if (i === state.channels.length) {
		state.channels[i] = { 
      sfx: null, 
      end: 0.0, 
      master_vol: 0.0,
			nodes: null,
			origin: vec.emptyV3(),
			dist_mult: 0.0,
			entnum: 0,
			entchannel: 0,
			leftvol: 0.0,
			rightvol: 0.0,
			pos: 0.0
    };
		return state.channels[i];
	}
	return channel;
};

export const spatialize = function (ch: Channel) {
	if (ch.entnum === cl.clState.viewentity) {
		ch.leftvol = ch.master_vol;
		ch.rightvol = ch.master_vol;
		return;
	}

	var source = [
		ch.origin[0] - state.listener_origin[0],
		ch.origin[1] - state.listener_origin[1],
		ch.origin[2] - state.listener_origin[2]
	];
	var dist = Math.sqrt(source[0] * source[0] + source[1] * source[1] + source[2] * source[2]);
	if (dist !== 0.0) {
		source[0] /= dist;
		source[1] /= dist;
		source[2] /= dist;
	}
	dist *= ch.dist_mult;
	var dot = state.listener_right[0] * source[0]
		+ state.listener_right[1] * source[1]
		+ state.listener_right[2] * source[2];

	ch.rightvol = ch.master_vol * (1.0 - dist) * (1.0 + dot);
	if (ch.rightvol < 0.0)
		ch.rightvol = 0.0;
	ch.leftvol = ch.master_vol * (1.0 - dist) * (1.0 - dot);
	if (ch.leftvol < 0.0)
		ch.leftvol = 0.0;
};

export const startSound = function (entnum: number, entchannel: number, sfx: Sound, origin: V3, vol: number, attenuation: number) {
	if ((cvr.nosound.value !== 0) || (sfx == null))
		return;

	const target_chan = pickChannel(entnum, entchannel);
	target_chan.origin = [origin[0], origin[1], origin[2]];
	target_chan.dist_mult = attenuation * 0.001;
	target_chan.master_vol = vol;
	target_chan.entnum = entnum;
	target_chan.entchannel = entchannel;
	spatialize(target_chan);
	if ((target_chan.leftvol === 0.0) && (target_chan.rightvol === 0.0))
		return;

	if (sfx.cache == null) {
		loadSound(sfx);
		target_chan.sfx = null;
		return;
	}

	target_chan.sfx = sfx;
	target_chan.pos = 0.0;
	target_chan.end = host.state.realtime + sfx.cache.length;
	var volume;
  
  var nodes: Nodes = {
    state: 'idle',
    source: state.context.createBufferSource(),
    merger1: state.context.createChannelMerger(2),
    splitter: state.context.createChannelSplitter(2),
    gain0: state.context.createGain(),
    gain1: state.context.createGain(),
    merger2: state.context.createChannelMerger(2),
    gain: null
  };
  target_chan.nodes = nodes;
  nodes.source.onended = onNoteEnd(nodes)
  nodes.source.buffer = sfx.cache.data;
  if (sfx.cache.loopstart != null) {
    nodes.source.loop = true;
    nodes.source.loopStart = sfx.cache.loopstart;
    nodes.source.loopEnd = nodes.source.buffer.length;
  }
  nodes.source.connect(nodes.merger1);
  nodes.source.connect(nodes.merger1, 0, 1);
  nodes.merger1.connect(nodes.splitter);
  nodes.splitter.connect(nodes.gain0, 0);
  nodes.splitter.connect(nodes.gain1, 1);
  volume = target_chan.leftvol;
  if (volume > 1.0)
    volume = 1.0;
  nodes.gain0.gain.value = volume * cvr.volume.value;
  nodes.gain0.connect(nodes.merger2, 0, 0);
  volume = target_chan.rightvol;
  if (volume > 1.0)
    volume = 1.0;
  nodes.gain1.gain.value = volume * cvr.volume.value;
  nodes.gain1.connect(nodes.merger2, 0, 1);
  nodes.merger2.connect(state.context.destination);
  var i, check, skip;
  for (i = 0; i < state.channels.length; ++i) {
    check = state.channels[i];
    if (check === target_chan)
      continue;
    if ((check.sfx !== sfx) || (check.pos !== 0.0))
      continue;
    skip = Math.random() * 0.1;
    if (skip >= sfx.cache.length) {
      noteOn(nodes);
      break;
    }
    target_chan.pos += skip;
    target_chan.end -= skip;
    nodes.source.start(0.0, skip, nodes.source.buffer.length - skip)
    nodes.state = 'playing'
    break;
  }
  noteOn(nodes);

};

export const stopSound = function (entnum: number, entchannel: number) {
	if (cvr.nosound.value !== 0)
		return;
	var i, ch;
	for (i = 0; i < state.channels.length; ++i) {
		ch = state.channels[i];
		if (ch == null)
			continue;
		if ((ch.entnum === entnum) && (ch.entchannel === entchannel)) {
			ch.end = 0.0;
			ch.sfx = null;

      noteOff(ch.nodes);
      ch.nodes = null;

			return;
		}
	}
};

export const stopAllSounds = function () {
	if (!cvr.nosound || cvr.nosound.value !== 0)
		return;

	var i, ch;

	for (i = 0; i < state.ambient_channels.length; ++i) {
		ch = state.ambient_channels[i];
		ch.master_vol = 0.0;

		if (ch.nodes != null)
      noteOff(ch.nodes);
	}

	for (i = 0; i < state.channels.length; ++i) {
		ch = state.channels[i];
		if (ch == null)
			continue;
		if (ch.nodes != null)
      noteOff(ch.nodes);
	}
	state.channels = [];

  for (i = 0; i < state.static_channels.length; ++i)
    noteOff(state.static_channels[i].nodes);
    
	state.static_channels = [];
};

export const staticSound = function (sfx: Sound, origin: V3, vol: number, attenuation: number) {
	if ((cvr.nosound.value !== 0) || (sfx == null))
		return;
	if (sfx.cache == null) {
		loadSound(sfx);
		return;
	}
	if (sfx.cache.loopstart == null) {
		con.print('Sound ' + sfx.name + ' not looped\n');
		return;
	}
	var ssChan: Channel = {
		sfx: sfx,
		origin: [origin[0], origin[1], origin[2]],
		master_vol: vol,
		dist_mult: attenuation * 0.000015625,
		end: host.state.realtime + sfx.cache.length,
    entnum: 0,
    entchannel: 0,
    leftvol: 0.0,
    rightvol: 0.0,
    pos: 0.0,
    nodes: {
      state: 'idle',
      gain: null,
      source: state.context.createBufferSource(),
      merger1: state.context.createChannelMerger(2),
      splitter: state.context.createChannelSplitter(2),
      gain0: state.context.createGain(),
      gain1: state.context.createGain(),
      merger2: state.context.createChannelMerger(2)
    }
	}

  const nodes = ssChan.nodes;

	state.static_channels[state.static_channels.length] = ssChan;

  nodes.source.onended = onNoteEnd(nodes)
  nodes.source.buffer = sfx.cache.data;
  nodes.source.loop = true;
  nodes.source.loopStart = sfx.cache.loopstart;
  nodes.source.loopEnd = nodes.source.buffer.length;
  nodes.source.connect(nodes.merger1);
  nodes.source.connect(nodes.merger1, 0, 1);
  nodes.merger1.connect(nodes.splitter);
  nodes.splitter.connect(nodes.gain0, 0);
  nodes.splitter.connect(nodes.gain1, 1);
  nodes.gain0.connect(nodes.merger2, 0, 0);
  nodes.gain1.connect(nodes.merger2, 0, 1);
  nodes.merger2.connect(state.context.destination);
};

export const soundList = function () {
	var total = 0, i, sfx, sc, size;
	for (i = 0; i < state.known_sfx.length; ++i) {
		sfx = state.known_sfx[i];
		sc = sfx.cache;
		if (sc == null)
			continue;
		size = sc.size.toString();
		total += sc.size;
		for (; size.length <= 5;)
			size = ' ' + size;
		if (sc.loopstart != null)
			size = 'L' + size;
		else
			size = ' ' + size;
		con.print(size + ' : ' + sfx.name + '\n');
	}
	con.print('Total resident: ' + total + '\n');
};

export const localSound = function (sound: Sound) {
	startSound(cl.clState.viewentity, -1, sound, vec.origin, 1.0, 1.0);
};

export const updateAmbientSounds = function () {
	if (cl.clState.worldmodel == null)
		return;

	var i, ch, vol, sc;

	var wm = cl.clState.worldmodel;
	var l = mod.pointInLeaf(state.listener_origin, wm);
	if ((l < 0) || (cvr.ambient_level.value === 0)) {
		for (i = 0; i < state.ambient_channels.length; ++i) {
			ch = state.ambient_channels[i];
			ch.master_vol = 0.0;
      noteOff(ch.nodes);
		}
		return;
	}

	for (i = 0; i < state.ambient_channels.length; ++i) {
		ch = state.ambient_channels[i];
		if (ch.nodes == null)
			continue;
		vol = cvr.ambient_level.value * wm.leafAmbientLevel[l * 4 + i];
		if (vol < 8.0)
			vol = 0.0;
		vol /= 255.0;
		if (ch.master_vol < vol) {
			ch.master_vol += (host.state.frametime * cvr.ambient_fade.value) / 255.0;
			if (ch.master_vol > vol)
				ch.master_vol = vol;
		}
		else if (ch.master_vol > vol) {
			ch.master_vol -= (host.state.frametime * cvr.ambient_fade.value) / 255.0;
			if (ch.master_vol < vol)
				ch.master_vol = vol;
		}

		if (ch.master_vol === 0.0) {
      noteOff(ch.nodes);

			continue;
		}
		if (ch.master_vol > 1.0)
			ch.master_vol = 1.0;

    ch.nodes.gain.gain.value = ch.master_vol * cvr.volume.value;
    noteOn(ch.nodes);
	}
};

export const updateDynamicSounds = function () {
	var i, ch, sc, volume;
	for (i = 0; i < state.channels.length; ++i) {
		ch = state.channels[i];
		if (ch == null)
			continue;
		if (ch.sfx == null)
			continue;
		if (host.state.realtime >= ch.end) {
			sc = ch.sfx.cache;
			if (sc.loopstart != null) {
				ch.end = host.state.realtime + sc.length - sc.loopstart;
			}
			else {
				ch.sfx = null;
				ch.nodes = null;
				continue;
			}
		}

		spatialize(ch);
    
    if (ch.leftvol > 1.0)
      ch.leftvol = 1.0;
    if (ch.rightvol > 1.0)
      ch.rightvol = 1.0;

    ch.nodes.gain0.gain.value = ch.leftvol * cvr.volume.value;
    ch.nodes.gain1.gain.value = ch.rightvol * cvr.volume.value;
	}
};

export const updateStaticSounds = function () {
	var i, j, ch, ch2, sfx, sc, volume;

	for (i = 0; i < state.static_channels.length; ++i)
		spatialize(state.static_channels[i]);

	for (i = 0; i < state.static_channels.length; ++i) {
		ch = state.static_channels[i];
		if ((ch.leftvol === 0.0) && (ch.rightvol === 0.0))
			continue;
		sfx = ch.sfx;
		for (j = i + 1; j < state.static_channels.length; ++j) {
			ch2 = state.static_channels[j];
			if (sfx === ch2.sfx) {
				ch.leftvol += ch2.leftvol;
				ch.rightvol += ch2.rightvol;
				ch2.leftvol = 0.0;
				ch2.rightvol = 0.0;
			}
		}
	}

  for (i = 0; i < state.static_channels.length; ++i) {
    ch = state.static_channels[i];
    if ((ch.leftvol === 0.0) && (ch.rightvol === 0.0)) {
      noteOff(ch.nodes);
      continue;
    }
    if (ch.leftvol > 1.0)
      ch.leftvol = 1.0;
    if (ch.rightvol > 1.0)
      ch.rightvol = 1.0;
    ch.nodes.gain0.gain.value = ch.leftvol * cvr.volume.value;
    ch.nodes.gain1.gain.value = ch.rightvol * cvr.volume.value;
    noteOn(ch.nodes);
  }
};

export const update = function (origin: V3, forward: V3, right: V3, up: V3) {
	if (cvr.nosound.value !== 0)
		return;

	state.listener_origin[0] = origin[0];
	state.listener_origin[1] = origin[1];
	state.listener_origin[2] = origin[2];
	state.listener_forward[0] = forward[0];
	state.listener_forward[1] = forward[1];
	state.listener_forward[2] = forward[2];
	state.listener_right[0] = right[0];
	state.listener_right[1] = right[1];
	state.listener_right[2] = right[2];
	state.listener_up[0] = up[0];
	state.listener_up[1] = up[1];
	state.listener_up[2] = up[2];

	if (cvr.volume.value < 0.0)
		cvar.setValue('volume', 0.0);
	else if (cvr.volume.value > 1.0)
		cvar.setValue('volume', 1.0);

	updateAmbientSounds();
	updateDynamicSounds();
	updateStaticSounds();
};

export const play = async function () {
	if (cvr.nosound.value !== 0)
		return;
	var i, sfx;
	for (i = 1; i < cmd.state.argv.length; ++i) {
		sfx = await precacheSound(com.defaultExtension(cmd.state.argv[i], '.wav'));
		if (sfx != null)
			await startSound(cl.clState.viewentity, 0, sfx, state.listener_origin, 1.0, 1.0);
	}
};

export const playVol = async function () {
	if (cvr.nosound.value !== 0)
		return;
	var i, sfx;
	for (i = 1; i < cmd.state.argv.length; i += 2) {
		sfx = await precacheSound(com.defaultExtension(cmd.state.argv[i], '.wav'));
		if (sfx != null)
			await startSound(cl.clState.viewentity, 0, sfx, state.listener_origin, q.atof(cmd.state.argv[i + 1]), 1.0);
	}
};

const _doLoadSound = async function (s: Sound): Promise<boolean | undefined> {
	var sc = {} as any

	var data = await com.loadFile('sound/' + s.name);
	if (data == null) {
		con.print('Couldn\'t load sound/' + s.name + '\n');
		s.loading = undefined;
		return;
	}

	var view = new DataView(data);
	if ((view.getUint32(0, true) !== 0x46464952) || (view.getUint32(8, true) !== 0x45564157)) {
		con.print('Missing RIFF/WAVE chunks\n');
		s.loading = undefined;
		return;
	}
	var p, fmt, dataofs, datalen, cue, loopstart, samples;
	for (p = 12; p < data.byteLength - 8;) {
		switch (view.getUint32(p, true)) {
			case 0x20746d66: // fmt
				if (view.getInt16(p + 8, true) !== 1) {
					con.print('Microsoft PCM format only\n');
					s.loading = undefined;
					return;
				}
				fmt = {
					channels: view.getUint16(p + 10, true),
					samplesPerSec: view.getUint32(p + 12, true),
					avgBytesPerSec: view.getUint32(p + 16, true),
					blockAlign: view.getUint16(p + 20, true),
					bitsPerSample: view.getUint16(p + 22, true)
				};
				break;
			case 0x61746164: // data
				dataofs = p + 8;
				datalen = view.getUint32(p + 4, true);
				break;
			case 0x20657563: // cue
				cue = true;
				loopstart = view.getUint32(p + 32, true);
				break;
			case 0x5453494c: // LIST
				if (cue !== true)
					break;
				cue = false;
				if (p + 32 < data.byteLength && view.getUint32(p + 28, true) === 0x6b72616d)
					samples = loopstart + view.getUint32(p + 24, true);

				break;
		}
		p += view.getUint32(p + 4, true) + 8;
		if ((p & 1) !== 0)
			++p;
	}

	if (fmt == null) {
		con.print('Missing fmt chunk\n');
		s.loading = undefined;
		return;
	}
	if (dataofs == null) {
		con.print('Missing data chunk\n');
		s.loading = undefined;
		return;
	}
	if (loopstart != null)
		sc.loopstart = loopstart * fmt.blockAlign / fmt.samplesPerSec;
	if (samples != null)
		sc.length = samples / fmt.samplesPerSec;
	else
		sc.length = datalen / fmt.avgBytesPerSec;

	sc.size = datalen + 44;
	if ((sc.size & 1) !== 0)
		++sc.size;
	var out = new ArrayBuffer(sc.size);
	view = new DataView(out);
	view.setUint32(0, 0x46464952, true); // RIFF
	view.setUint32(4, sc.size - 8, true);
	view.setUint32(8, 0x45564157, true); // WAVE
	view.setUint32(12, 0x20746d66, true); // fmt
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, fmt.channels, true);
	view.setUint32(24, fmt.samplesPerSec, true);
	view.setUint32(28, fmt.avgBytesPerSec, true);
	view.setUint16(32, fmt.blockAlign, true);
	view.setUint16(34, fmt.bitsPerSample, true);
	view.setUint32(36, 0x61746164, true); // data
	view.setUint32(40, datalen, true);
	(new Uint8Array(out, 44, datalen)).set(new Uint8Array(data, dataofs, datalen));

  // sc.data = context.createBuffer(out, true);
  // const length = datalen / fmt.channels / (fmt.bitsPerSample / 8)
  //const buffer = context.createBuffer(fmt.channels, length, fmt.samplesPerSec)
  sc.data = await new Promise((resolve, reject) =>
    state.context.decodeAudioData(out, buffer => resolve(buffer))
  )

	s.cache = sc;
	s.loading = undefined;
	return true;
};

export const loadSound = function (s: Sound): Promise<boolean | undefined> {
	if (cvr.nosound.value !== 0)
		return Promise.resolve(undefined);
	if (s.cache != null)
		return Promise.resolve(true);
	if (s.loading != null)
		return s.loading;
	s.loading = _doLoadSound(s);
	return s.loading;
};
