import * as host from './host'
import * as pr from './pr'
import * as mod from './mod'
import * as msg from './msg'
import * as sys from './sys'
import * as con from './console'
import * as cvar from './cvar'
import * as com from './com'
import * as protocol from './protocol'
import * as def from './def'
import * as cmd from './cmd'
import * as net from './net'
import * as ed from './ed'
import * as q from './q'
import * as vec from './vec'
import * as sz from './sz'
import * as pf from './pf'
import IDatagram from './interfaces/net/IDatagram'
import { Edict, Link } from './types/Edict'
import { V3 } from './types/Vector'
import { ClipNode, Hull, Model, Plane, Node, Leaf } from './types/Model'
import { CVars } from './cvar'
import { Client } from './types'

const MAX_ENT_LEAFS = 32

export type Trace = {
	fraction: number;
	allsolid: boolean;
	endpos: V3;
	plane: Plane;
	startsolid: boolean
	ent: null | Edict
	inopen: boolean
	inwater: boolean
}

export type Clip = {
	trace: Trace
	start: V3,
	end: V3,
	mins: V3,
	maxs: V3,
	mins2: V3,
	maxs2: V3,
	type: number,
	passedict: Edict,
	boxmins: V3,
	boxmaxs: V3
}
export type AreaNode = {
	trigger_edicts: Link
	solid_edicts: Link
	axis?: number
	children?: AreaNode[]
	dist?: number
	sc?: AreaNode[]
}

// Resets every field recursiveHullCheck/clipMoveToEntity read-or-write; the single
// canonical default list -- emptyTrace builds its shell through this.
export const resetTrace = (trace: Trace, end: V3) => {
	trace.fraction = 1.0;
	trace.allsolid = true;
	trace.startsolid = false;
	trace.inopen = false;
	trace.inwater = false;
	trace.ent = null;
	trace.endpos[0] = end[0]; trace.endpos[1] = end[1]; trace.endpos[2] = end[2];
	trace.plane.normal[0] = 0.0; trace.plane.normal[1] = 0.0; trace.plane.normal[2] = 0.0;
	trace.plane.dist = 0.0;
}

export const emptyTrace = (): Trace => {
	const t: Trace = {
		fraction: 0.0,
		allsolid: false,
		endpos: vec.emptyV3() as V3,
		plane: { normal: vec.emptyV3(), dist: 0.0 } as Plane,
		startsolid: false,
		ent: null,
		inwater: false,
		inopen: false
	}
	resetTrace(t, vec.origin)
	return t
}


// Vanilla's clip->trace = trace is a struct copy by value; copying fields instead of
// aliasing the object is what lets clipToLinks reuse one scratch trace per candidate.
const copyTrace = (src: Trace, dst: Trace) => {
	dst.fraction = src.fraction;
	dst.allsolid = src.allsolid;
	dst.startsolid = src.startsolid;
	dst.inopen = src.inopen;
	dst.inwater = src.inwater;
	dst.ent = src.ent;
	dst.endpos[0] = src.endpos[0]; dst.endpos[1] = src.endpos[1]; dst.endpos[2] = src.endpos[2];
	dst.plane.normal[0] = src.plane.normal[0]; dst.plane.normal[1] = src.plane.normal[1]; dst.plane.normal[2] = src.plane.normal[2];
	dst.plane.dist = src.plane.dist;
}

export type Svs = {
	serverinfo: {},
	maxclients: number,
	clients: Client[],
	serverflags: number,
	changelevel_issued: boolean,
	maxclientslimit: number
}

// Server lifecycle, mutually exclusive (replaces the old active + loading bools):
// inactive (down) -> loading (spawnServer building the map) -> active (running).
export type ServerPhase = 'inactive' | 'loading' | 'active'

export type Server = {
	num_edicts: number;
	datagram: IDatagram;
	reliable_datagram: IDatagram;
	signon: IDatagram;
	phase: ServerPhase;
	protocol: number;
	protocolFlags: number;
	sound_precache: string[];
	model_precache: string[];
	particle_precache: string[]; // dp_precache-transported effectinfo names; index 0 unused, like model/sound_precache
	particlePrecacheWarnCount: number; // throttles the "should only be done in spawn functions" warning to 3, like QSS-M
	edicts: Edict[];
	// how the current server was spawned (replaces the old `loadgame` bool)
	spawnKind: 'map' | 'savegame';
	time: number;
	paused: boolean;
	worldmodel: Model;
  	models: Model[];
	lastcheck: number;
	lastchecktime: number;
	modelname: string;
	lightstyles: string[]
	lastsave: string; // relative save name incl. .sav, e.g. autosave/e1m1.sav
	autoloading: boolean;
	autosave: {
		secretBoost: number;
		prevHealth: number;
		prevSecrets: number;
		time: number;
		hurtTime: number;
		shootTime: number;
		cheat: number;
	};
}

export type ServerState = {
	fatpvs: number[];
	fatbytes: number;
	// persistent decompress target for addToFatPVS -- leafPVS/decompressVis otherwise
	// allocates a fresh vis row per leaf, every frame per client (see r.ts fatPVS)
	fatpvs_scratch: Uint8Array;
	clientdatagram: IDatagram
	server: Server
	nop: IDatagram
	reconnect: IDatagram
	svs: Svs
	player: Edict
	steptrace: Trace
	// persistent scratch for findTouchedLeafs box test (avoids per-node-visit allocation)
	linkMins: V3
	linkMaxs: V3
	box_clipnodes: ClipNode[]
	box_planes: Plane[]
	box_hull: Hull
	areanodes: AreaNode[]
	// FTE_ENT_SKIN_CONTENTS: number of negative-skin SOLID_BSP edicts (recomputed each physics frame).
	// When 0 (the case for maps with no FTESKIN ladders/content brushes — nearly all), the skin-contents
	// areanode walk (skinContentsAt) is a no-op and short-circuits, so checkWater reduces to vanilla
	// world PointContents instead of an O(N^2) per-frame scan over every solid entity.
	numSkinContents: number
	// FTE_ENT_SKIN_CONTENTS: the negative-skin SOLID_BSP edicts themselves (first numSkinContents entries
	// valid), rebuilt each physics frame alongside numSkinContents. skinContentsAt iterates only these
	// instead of walking the areanode tree over every solid entity -- the rare content brushes are
	// otherwise buried in node lists full of doors/platforms, making the per-point query O(N).
	skinContentsEnts: Edict[]
	// WASM backend leaf-PVS: when set, writeEntitiesToClient reads per-edict leafnums straight from the
	// sim's flat buffer (Int32Array view over WASM memory: stride wasmLeafStride, [count, bit0, bit1, ...]
	// per edict) instead of the JS Edict.leafnums — the sim computes findTouchedLeafs in-place (pvs.ts).
	// null on the pure-JS server (the JS Edict.leafnums path is used).
	wasmLeafnums: Int32Array | null
	wasmLeafStride: number
	// QSS-M qcvm->warned_rotatingbmodel
	warnedRotatingBmodel: boolean
	// pushMoveAngles: entities displaced by a rotating pusher this call, for blocked-revert.
	// Sized to def.max_edicts and reused across calls instead of allocating per pushMoveAngles.
	movedEdicts: Edict[]
	movedOrigins: Float32Array
	movedAngles: Float32Array
	// pusher candidate query scratch (gatherPushCandidates) + registry of
	// SOLID_NOT pushables, which skip the area chains but can still ride pushers
	pushCandidates: Edict[]
	// monotonically increasing gather id for Edict.pushStamp dedup
	pushGatherSeq: number
	solidNotPushables: Edict[]
	pushQueryMins: V3
	pushQueryMaxs: V3
	// move() scratch: one candidate trace reused per clipToLinks entity (winner is
	// field-copied into clip.trace) and one pooled Clip -- move() is never re-entered
	// while its clip is live, but the returned clip.trace must stay a fresh object
	// (flymove aliases it into state.steptrace across later moves).
	clipScratchTrace: Trace
	moveClip: Clip
	// touchLinks trigger lists, pooled per recursion depth: QC touch handlers can relink
	// entities and re-enter touchLinks, so each depth gets its own reusable array.
	touchLists: Edict[][]
	touchDepth: number
	// Per-caller persistent move() result buffers (vanilla SV_Move returns trace_t by
	// value, so every call site owns its storage). Safety rests on TWO invariants any new
	// move() caller must preserve:
	// 1. QC-reachable builtins (traceline/droptofloor/aim/walkmove+movetogoal->movestep->
	//    checkBottom) use only traceTraceline/DropToFloor/Aim/Movestep/CheckBottom --
	//    flyMove, pushEntity, and physics_Toss read their buffers AFTER impact()/touchLinks
	//    run arbitrary QC, so no QC-reachable path may ever write those three.
	// 2. movestep finishes every read of traceMovestep BEFORE its linkEdict(ent, true)
	//    runs touch QC (which can re-enter movestep via walkmove).
	// A caller that can't satisfy these must copyTrace out (see steptrace) instead of
	// holding a buffer across QC.
	traceCheckBottom: Trace
	traceMovestep: Trace
	traceFlymove: Trace
	tracePushEntity: Trace
	traceIdealPitch: Trace
	traceUserFriction: Trace
	traceTestPosition: Trace
	traceCheckLadder: Trace
	// result buffers for pf.ts's move-calling builtins; housed here beside the other
	// move() buffers because pf<->sv is an import cycle (sv.emptyTrace at pf module
	// scope would hit the TDZ), while sv.state access at call time is safe
	traceTraceline: Trace
	traceDropToFloor: Trace
	traceAim: Trace
	idealPitchZ: Float64Array
	// flyMove clip-plane accumulator (MAX_CLIP_PLANES=5); numplanes guards all reads and
	// flyMove is not QC-reachable, so one persistent container is safe.
	flymovePlanes: V3[]
}

const initState = (): ServerState => ({
	fatpvs: [],
	fatbytes: 0,
	fatpvs_scratch: null,
	clientdatagram: sz.newDatagram(def.max_message),
	server: {
		num_edicts: 0,
		datagram: sz.newDatagram(def.max_message),
		reliable_datagram: sz.newDatagram(def.max_message),
		signon: sz.newDatagram(def.max_message),
		phase: 'inactive',
		paused: false,
		spawnKind: 'map',
		protocol: protocol.netquake,
		protocolFlags: 0,
		sound_precache: [],
		model_precache: [],
		particle_precache: [],
		particlePrecacheWarnCount: 0,
		edicts: [],
		time: 1.0,
		worldmodel: null,
		models: [],
		lastcheck: 0,
		lastchecktime: 0.0,
		modelname: '',
		lightstyles: [],
		lastsave: '',
		autoloading: false,
		autosave: {
			secretBoost: 0,
			prevHealth: 0,
			prevSecrets: 0,
			time: 0,
			hurtTime: 0,
			shootTime: 0,
			cheat: 0
		}
	},
	nop: sz.newDatagram(4, 1),
	reconnect: sz.newDatagram(128),
	svs: {
		serverinfo: {},
		maxclients: 0,
		clients: [],
		serverflags: 0,
		changelevel_issued: false,
		maxclientslimit: 0
	},
	player: null,
	steptrace: emptyTrace(),
	linkMins: [0.0, 0.0, 0.0],
	linkMaxs: [0.0, 0.0, 0.0],
	box_clipnodes: [],
	box_planes: [],
	skinContentsEnts: [],
	wasmLeafnums: null,
	wasmLeafStride: 0,
	box_hull: null,
	areanodes: [],
	numSkinContents: 0,
	warnedRotatingBmodel: false,
	movedEdicts: new Array(def.max_edicts).fill(null),
	movedOrigins: new Float32Array(def.max_edicts * 3),
	movedAngles: new Float32Array(def.max_edicts * 3),
	pushCandidates: [],
	pushGatherSeq: 0,
	pushQueryMins: [0, 0, 0],
	pushQueryMaxs: [0, 0, 0],
	solidNotPushables: [],
	clipScratchTrace: emptyTrace(),
	moveClip: {
		trace: null,
		start: null,
		end: null,
		mins: null,
		maxs: null,
		mins2: [0.0, 0.0, 0.0],
		maxs2: [0.0, 0.0, 0.0],
		type: 0,
		passedict: null,
		boxmins: [0.0, 0.0, 0.0],
		boxmaxs: [0.0, 0.0, 0.0]
	},
	touchLists: [],
	touchDepth: 0,
	traceCheckBottom: emptyTrace(),
	traceMovestep: emptyTrace(),
	traceFlymove: emptyTrace(),
	tracePushEntity: emptyTrace(),
	traceIdealPitch: emptyTrace(),
	traceUserFriction: emptyTrace(),
	traceTestPosition: emptyTrace(),
	traceCheckLadder: emptyTrace(),
	traceTraceline: emptyTrace(),
	traceDropToFloor: emptyTrace(),
	traceAim: emptyTrace(),
	idealPitchZ: new Float64Array(6),
	flymovePlanes: [vec.emptyV3(), vec.emptyV3(), vec.emptyV3(), vec.emptyV3(), vec.emptyV3()]
})

export let state: ServerState = initState();

export const cvr: CVars = {
};

export const MOVE_TYPE = {
	none: 0,
	anglenoclip: 1,
	angleclip: 2,
	walk: 3,
	step: 4,
	fly: 5,
	toss: 6,
	push: 7,
	noclip: 8,
	flymissile: 9,
	bounce: 10,
	// MOVETYPE_EXT_BOUNCEMISSILE (QSS-M server.h:264) -- a DP extension the rerelease
	// stomps on, its gibs using it as MOVETYPE_BOUNCE.
	bouncemissile: 11
};

// 2021 rerelease (Kex) effects bits (QSS-M protocol.h:478-480). They collide with
// EF_NODRAW/ADDITIVE/BLUE/RED, so writeEntitiesToClient translates them on the wire.
// candlelight has no classic equivalent and is only masked off.
const EFQE = {
	quadlight: 16,
	pentlight: 32,
	candlelight: 64,
	// the four high bits the rerelease reuses (QSS-M's 0xf0u)
	mask: 0xf0
};

export const SOLID = {
	not: 0,
	trigger: 1,
	bbox: 2,
	slidebox: 3,
	bsp: 4
};

export const DAMAGE = {
	no: 0,
	yes: 1,
	aim: 2
};

export const FL = {
	fly: 1,
	swim: 2,
	conveyor: 4,
	client: 8,
	inwater: 16,
	monster: 32,
	godmode: 64,
	notarget: 128,
	item: 256,
	onground: 512,
	partialground: 1024,
	waterjump: 2048,
	jumpreleased: 4096
};

// main

export const startParticle = function (org: V3, dir: V3, color: number, count: number) {
	const datagram = state.server.datagram;
	if (datagram.cursize >= 1009)
		return;
	msg.writeByte(datagram, protocol.SVC.particle);
	msg.writeCoord(datagram, org[0], state.server.protocolFlags);
	msg.writeCoord(datagram, org[1], state.server.protocolFlags);
	msg.writeCoord(datagram, org[2], state.server.protocolFlags);
	let i, v;
	for (i = 0; i <= 2; ++i) {
		v = (dir[i] * 16.0) >> 0;
		if (v > 127)
			v = 127;
		else if (v < -128)
			v = -128;
		msg.writeChar(datagram, v);
	}
	msg.writeByte(datagram, count);
	msg.writeByte(datagram, color);
};

export const startSound = function (entity: Edict, channel: number, sample: string, volume: number, attenuation: number) {
	if ((volume < 0) || (volume > 255))
		sys.error('SV.StartSound: volume = ' + volume);
	if ((attenuation < 0.0) || (attenuation > 4.0))
		sys.error('SV.StartSound: attenuation = ' + attenuation);
	if ((channel < 0) || (channel > 7))
		sys.error('SV.StartSound: channel = ' + channel);

	const datagram = state.server.datagram;
	if (datagram.cursize >= 1009)
		return;

	let i;
	for (i = 1; i < state.server.sound_precache.length; ++i) {
		if (sample === state.server.sound_precache[i])
			break;
	}
	if (i >= state.server.sound_precache.length) {
		con.print('SV.StartSound: ' + sample + ' not precached\n');
		return;
	}

	let field_mask = 0;
	if (volume !== 255)
		field_mask += 1;
	if (attenuation !== 1.0)
		field_mask += 2;

	//johnfitz -- PROTOCOL_FITZQUAKE
	if (entity.num >= 8192) {
		if (state.server.protocol === protocol.netquake)
			return; // entity number doesn't fit in the packet, so just drop the sound
		field_mask |= protocol.SND.largeentity;
	}
	if (i >= 256) {
		if (state.server.protocol === protocol.netquake)
			return; // sound number doesn't fit in the packet, so just drop the sound
		field_mask |= protocol.SND.largesound;
	}
	//johnfitz

	msg.writeByte(datagram, protocol.SVC.sound);
	msg.writeByte(datagram, field_mask);
	if ((field_mask & 1) !== 0)
		msg.writeByte(datagram, volume);
	if ((field_mask & 2) !== 0)
		msg.writeByte(datagram, Math.floor(attenuation * 64.0));
	//johnfitz -- PROTOCOL_FITZQUAKE
	if ((field_mask & protocol.SND.largeentity) !== 0) {
		msg.writeShort(datagram, entity.num);
		msg.writeByte(datagram, channel);
	} else
		msg.writeShort(datagram, (entity.num << 3) + channel);
	if ((field_mask & protocol.SND.largesound) !== 0)
		msg.writeShort(datagram, i);
	else
		msg.writeByte(datagram, i);
	//johnfitz
	msg.writeCoord(datagram, entity.v_float[pr.entvars.origin] + 0.5 *
		(entity.v_float[pr.entvars.mins] + entity.v_float[pr.entvars.maxs]), state.server.protocolFlags);
	msg.writeCoord(datagram, entity.v_float[pr.entvars.origin1] + 0.5 *
		(entity.v_float[pr.entvars.mins1] + entity.v_float[pr.entvars.maxs1]), state.server.protocolFlags);
	msg.writeCoord(datagram, entity.v_float[pr.entvars.origin2] + 0.5 *
		(entity.v_float[pr.entvars.mins2] + entity.v_float[pr.entvars.maxs2]), state.server.protocolFlags);
};

const sendServerinfo = function (client: Client) {
	const message = client.message;
	msg.writeByte(message, protocol.SVC.print);
	msg.writeString(message, '\x02\nVERSION 1.09 SERVER (' + pr.state.crc + ' CRC)\n');
	msg.writeByte(message, protocol.SVC.serverinfo);
	msg.writeLong(message, state.server.protocol);

	// protocolFlags already holds real PRFL wire bits -- only RMQ sends the flags long
	if (state.server.protocol === protocol.rmq)
		msg.writeLong(message, state.server.protocolFlags);

	msg.writeByte(message, state.svs.maxclients);
	msg.writeByte(message, ((host.cvr.coop.value === 0) && (host.cvr.deathmatch.value !== 0)) ? 1 : 0);
	msg.writeString(message, pr.getString(state.server.edicts[0].v_int[pr.entvars.message]));
	let i;
	for (i = 1; i < state.server.model_precache.length; ++i)
		msg.writeString(message, state.server.model_precache[i]);
	msg.writeByte(message, 0);
	for (i = 1; i < state.server.sound_precache.length; ++i)
		msg.writeString(message, state.server.sound_precache[i]);
	msg.writeByte(message, 0);
	// dp_precache dump: unlike model/sound above (classic bulk-string signon block), particle
	// names ride the newer type-tagged svc so a plain protocol-15 stream never has to carry it.
	for (i = 1; i < state.server.particle_precache.length; ++i) {
		msg.writeByte(message, protocol.SVC.dp_precache);
		msg.writeShort(message, (protocol.PRECACHE_TYPE.particle << 14) | i);
		msg.writeString(message, state.server.particle_precache[i]);
	}
	msg.writeByte(message, protocol.SVC.cdtrack);
	msg.writeByte(message, state.server.edicts[0].v_float[pr.entvars.sounds]);
	msg.writeByte(message, state.server.edicts[0].v_float[pr.entvars.sounds]);
	msg.writeByte(message, protocol.SVC.setview);
	msg.writeShort(message, client.edict.num);
	msg.writeByte(message, protocol.SVC.signonnum);
	msg.writeByte(message, 1);
	client.sendsignon = true;
	client.spawned = false;
};

const connectClient = function (clientnum: number) {
	const client = state.svs.clients[clientnum];
	let i, spawn_parms;
	if (state.server.spawnKind === 'savegame') {
		spawn_parms = [];
		if (client.spawn_parms == null) {
			client.spawn_parms = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
				0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
		}
		for (i = 0; i <= 15; ++i)
			spawn_parms[i] = client.spawn_parms[i];
	}
	con.dPrint('Client ' + client.netconnection.address + ' connected\n');
	client.active = true;
	client.dropasap = false;
	client.last_message = 0.0;
	client.cmd = { forwardmove: 0.0, sidemove: 0.0, upmove: 0.0 };
	client.wishdir = [0.0, 0.0, 0.0];
	client.message.cursize = 0;
	client.edict = state.server.edicts[clientnum + 1];
	client.edict.v_int[pr.entvars.netname] = pr.state.netnames + (clientnum << 5);
	setClientName(client, 'unconnected');
	client.colors = 0;
	client.ping_times = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
		0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
	client.num_pings = 0;
	if (state.server.spawnKind !== 'savegame') {
		client.spawn_parms = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
			0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
	}
	client.old_frags = 0;
	if (state.server.spawnKind === 'savegame') {
		for (i = 0; i <= 15; ++i)
			client.spawn_parms[i] = spawn_parms[i];
	}
	else {
		pr.executeProgram(pr.state.globals_int[pr.globalvars.SetNewParms]);
		for (i = 0; i <= 15; ++i)
			client.spawn_parms[i] = pr.state.globals_float[pr.globalvars.parms + i];
	}
	sendServerinfo(client);
};

const addToFatPVS = function (org: V3, node: Node | Leaf) {
	let pvs, i, normal, d;
	for (; ;) {
		if (node.contents < 0) {
			if (node.contents !== mod.CONTENTS.solid) {
				// decompress into the persistent scratch (solid leaf 0, the only novis
				// special case, is already excluded above), matching r.ts addToFatPVS
				pvs = mod.decompressVis((node as Leaf).visofs, state.server.worldmodel, state.fatpvs_scratch);
				for (i = 0; i < state.fatbytes; ++i)
					state.fatpvs[i] |= pvs[i];
			}
			return;
		}
		normal = (node as Node).plane.normal;
		d = org[0] * normal[0] + org[1] * normal[1] + org[2] * normal[2] - (node as Node).plane.dist;
		if (d > 8.0)
			node = (node as Node).children[0];
		else {
			if (d >= -8.0)
				addToFatPVS(org, (node as Node).children[0]);
			node = (node as Node).children[1];
		}
	}
};

const fatPVS = function (org: V3) {
	state.fatbytes = mod.visRowBytes(state.server.worldmodel);
	if (!state.fatpvs_scratch || state.fatpvs_scratch.length < state.fatbytes)
		state.fatpvs_scratch = new Uint8Array(state.fatbytes);
	let i;
	for (i = 0; i < state.fatbytes; ++i)
		state.fatpvs[i] = 0;
	addToFatPVS(org, state.server.worldmodel.nodes[0]);
};

const writeEntitiesToClient = function (clent: Edict, message: IDatagram) {
	fatPVS(ed.eyePosition(clent, vec.scratch()));
	const pvs = state.fatpvs
	let ent, e, i, bits, miss;
	for (e = 1; e < state.server.num_edicts; ++e) {
		ent = state.server.edicts[e];
		if (ent !== clent) {
			if ((ent.v_float[pr.entvars.modelindex] === 0.0) || (pr.state.strings[ent.v_int[pr.entvars.model]] === 0))
				continue;
			if (state.wasmLeafnums !== null) {
				// WASM backend: read this edict's leafnums (count + PVS bit indices) from the sim buffer.
				const wl = state.wasmLeafnums, base = e * state.wasmLeafStride, cnt = wl[base];
				for (i = 0; i < cnt; ++i) {
					const bit = wl[base + 1 + i];
					if ((pvs[bit >> 3] & (1 << (bit & 7))) !== 0)
						break;
				}
				if (i === cnt && cnt < MAX_ENT_LEAFS)
					continue;
			} else {
				for (i = 0; i < ent.leafnums.length; ++i) {
					if ((pvs[ent.leafnums[i] >> 3] & (1 << (ent.leafnums[i] & 7))) !== 0)
						break;
				}
				if (i === ent.leafnums.length && ent.leafnums.length < MAX_ENT_LEAFS)
					continue;
			}
		}
		//johnfitz -- max size for protocol 15 is 18 bytes, not 16 as originally
		//assumed here.  And, for protocol 85 the max size is actually 24 bytes.
		if ((message.data.byteLength - message.cursize) < 24) {
			con.print('packet overflow\n');
			return;
		}
		bits = 0;
		for (i = 0; i <= 2; ++i) {
			miss = ent.v_float[pr.entvars.origin + i] - ent.baseline.origin[i];
			if ((miss < -0.1) || (miss > 0.1))
				bits |= protocol.U.origin1 << i;
		}
		if (ent.v_float[pr.entvars.angles] !== ent.baseline.angles[0])
			bits |= protocol.U.angle1;
		if (ent.v_float[pr.entvars.angles1] !== ent.baseline.angles[1])
			bits |= protocol.U.angle2;
		if (ent.v_float[pr.entvars.angles2] !== ent.baseline.angles[2])
			bits |= protocol.U.angle3;
		if (ent.v_float[pr.entvars.movetype] === MOVE_TYPE.step)
			bits |= protocol.U.nolerp;
		if (ent.baseline.colormap !== ent.v_float[pr.entvars.colormap])
			bits |= protocol.U.colormap;
		if (ent.baseline.skin !== ent.v_float[pr.entvars.skin])
			bits |= protocol.U.skin;
		if (ent.baseline.frame !== ent.v_float[pr.entvars.frame])
			bits |= protocol.U.frame;
		// QSS-M sv_main.c:2899 (qcvm->brokeneffects). Untranslated, every rerelease candle
		// gets a blue dlight, its EF_CANDLELIGHT being our EF_BLUE.
		var effects = ent.v_float[pr.entvars.effects];
		if (pr.state.rerelease === true) {
			const qe = effects >> 0;
			if ((qe & EFQE.mask) !== 0) {
				effects = qe & ~EFQE.mask;
				if ((qe & EFQE.quadlight) !== 0)
					effects |= mod.EFFECTS.blue;
				if ((qe & EFQE.pentlight) !== 0)
					effects |= mod.EFFECTS.red;
			}
		}
		if (ent.baseline.effects !== effects)
			bits |= protocol.U.effects;
		if (ent.baseline.modelindex !== ent.v_float[pr.entvars.modelindex])
			bits |= protocol.U.model;

		ent.alpha = ent.baseline.alpha
		if (pr.state.alpha_supported) {
			// TODO: find a cleaner place to put this code
			const val = ed.getEdictFieldValue(ent, "alpha");
			if (val) {
				ent.alpha = pr.encodeAlpha(val)
			}
		}

		// .scale field -> byte (16 = 1.0); only wire-carried under RMQ (999), matching QSS
		// sv_main.c (U_SCALE gated on sv.protocol == PROTOCOL_RMQ).
		let scale = protocol.ENTSCALE_DEFAULT
		if (pr.state.scale_supported) {
			const sval = ed.getEdictFieldValue(ent, "scale")
			if (sval)
				scale = pr.encodeScale(sval)
		}

		// Fitzquake/RMQ additions
		if (state.server.protocol === protocol.fitzquake || state.server.protocol === protocol.rmq) {
			if (ent.baseline.alpha != ent.alpha) // TODO: Alpha
				bits |= protocol.U.alpha
			if (bits & protocol.U.frame && ent.v_float[pr.entvars.frame] & 0xFF00)
				bits |= protocol.U.frame2
			if (bits & protocol.U.model && ent.v_float[pr.entvars.modelindex] & 0xFF00)
				bits |= protocol.U.model2
			if (ent.sendinterval)
				bits |= protocol.U.lerpfinish
			if (state.server.protocol === protocol.rmq && ent.baseline.scale !== scale)
				bits |= protocol.U.scale
			if (bits >= 65536)
				bits |= protocol.U.extend1
			if (bits >= 16777216)
				bits |= protocol.U.extend2
		}

		if (e >= 256)
			bits += protocol.U.longentity;
		if (bits >= 256)
			bits += protocol.U.morebits;

		msg.writeByte(message, bits + protocol.U.signal);
		if ((bits & protocol.U.morebits) !== 0)
			msg.writeByte(message, bits >> 8);

		if ((bits & protocol.U.extend1) !== 0)
			msg.writeByte(message, bits >> 16)
		if ((bits & protocol.U.extend2) !== 0)
			msg.writeByte(message, bits >> 24)

		if ((bits & protocol.U.longentity) !== 0)
			msg.writeShort(message, e);
		else
			msg.writeByte(message, e);
		if ((bits & protocol.U.model) !== 0)
			msg.writeByte(message, ent.v_float[pr.entvars.modelindex]);
		if ((bits & protocol.U.frame) !== 0)
			msg.writeByte(message, ent.v_float[pr.entvars.frame]);
		if ((bits & protocol.U.colormap) !== 0)
			msg.writeByte(message, ent.v_float[pr.entvars.colormap]);
		if ((bits & protocol.U.skin) !== 0)
			msg.writeByte(message, ent.v_float[pr.entvars.skin]);
		if ((bits & protocol.U.effects) !== 0)
			msg.writeByte(message, effects);
		if ((bits & protocol.U.origin1) !== 0)
			msg.writeCoord(message, ent.v_float[pr.entvars.origin], state.server.protocolFlags);
		if ((bits & protocol.U.angle1) !== 0)
			msg.writeAngle(message, ent.v_float[pr.entvars.angles], state.server.protocolFlags);
		if ((bits & protocol.U.origin2) !== 0)
			msg.writeCoord(message, ent.v_float[pr.entvars.origin1], state.server.protocolFlags);
		if ((bits & protocol.U.angle2) !== 0)
			msg.writeAngle(message, ent.v_float[pr.entvars.angles1], state.server.protocolFlags);
		if ((bits & protocol.U.origin3) !== 0)
			msg.writeCoord(message, ent.v_float[pr.entvars.origin2], state.server.protocolFlags);
		if ((bits & protocol.U.angle3) !== 0)
			msg.writeAngle(message, ent.v_float[pr.entvars.angles2], state.server.protocolFlags);

		//johnfitz -- PROTOCOL_FITZQUAKE
		if (bits & protocol.U.alpha)
			msg.writeByte(message, ent.alpha);
		if (bits & protocol.U.scale)
			msg.writeByte(message, scale);
		if (bits & protocol.U.frame2)
			msg.writeByte(message, ent.v_float[pr.entvars.frame] >> 8);
		if (bits & protocol.U.model2)
			msg.writeByte(message, ent.v_float[pr.entvars.modelindex] >> 8);
		if (bits & protocol.U.lerpfinish)
			msg.writeByte(message,
				Math.round((ent.v_float[pr.entvars.nextthink] - state.server.time) * 255))
	}
};


const sendClientDatagram = function () {
	const client = host.state.client;
	var message = state.clientdatagram;
	message.cursize = 0;
	msg.writeByte(message, protocol.SVC.time);
	msg.writeFloat(message, state.server.time);
	writeClientdataToMessage(client.edict, message);
	writeEntitiesToClient(client.edict, message);
	if ((message.cursize + state.server.datagram.cursize) < message.data.byteLength)
		sz.write(message, sz.u8(state.server.datagram), state.server.datagram.cursize);
	if (net.sendUnreliableMessage(client.netconnection, message) === -1) {
		host.dropClient(true);
		return;
	}
	return true;
};

const updateToReliableMessages = function () {
	var i, frags, j, client;

	for (i = 0; i < state.svs.maxclients; ++i) {
		host.state.client = state.svs.clients[i];
		host.state.client.edict.v_float[pr.entvars.frags] >>= 0;
		frags = host.state.client.edict.v_float[pr.entvars.frags];
		if (host.state.client.old_frags === frags)
			continue;
		for (j = 0; j < state.svs.maxclients; ++j) {
			client = state.svs.clients[j];
			if (client.active !== true)
				continue;
				
			msg.writeByte(client.message, protocol.SVC.updatefrags);
			msg.writeByte(client.message, i);
			msg.writeShort(client.message, frags);
		}
		host.state.client.old_frags = frags;
	}

	for (i = 0; i < state.svs.maxclients; ++i) {
		client = state.svs.clients[i];
		if (client.active === true)
			sz.write(client.message, sz.u8(state.server.reliable_datagram), state.server.reliable_datagram.cursize);
	}

	state.server.reliable_datagram.cursize = 0;
};

export const modelIndex = function (name: string) {
	if (name == null)
		return 0;
	if (name.length === 0)
		return 0;
	var i;
	for (i = 0; i < state.server.model_precache.length; ++i) {
		if (state.server.model_precache[i] === name)
			return i;
	}
	sys.error('SV.ModelIndex: model ' + name + ' not precached');
};

const createBaseline = function () {
	var i, svent, baseline;
	var player = modelIndex('progs/player.mdl');
	var signon = state.server.signon;
	for (i = 0; i < state.server.num_edicts; ++i) {
		svent = state.server.edicts[i];
		if (svent.free === true)
			continue;
		if ((i > state.svs.maxclients) && (svent.v_int[pr.entvars.modelindex] === 0))
			continue;
		baseline = svent.baseline;
		// baselines persist for the whole map -- never scratch
		baseline.origin = ed.vector(svent, pr.entvars.origin, vec.emptyV3());
		baseline.angles = ed.vector(svent, pr.entvars.angles, vec.emptyV3());
		baseline.frame = svent.v_float[pr.entvars.frame] >> 0;
		baseline.skin = svent.v_float[pr.entvars.skin] >> 0;
		// TODO: Alpha
		// scale is only encoded into baselines under RMQ (999), matching QSS/Ironwail
		// SV_CreateBaseline (the field read is gated on sv.protocol == PROTOCOL_RMQ).
		baseline.scale = protocol.ENTSCALE_DEFAULT
		if ((i > 0) && (i <= state.svs.maxclients)) {
			baseline.colormap = i
			baseline.modelindex = player;
			baseline.alpha = protocol.ENT_ALPHA.default
		}
		else {
			baseline.colormap = 0;
			baseline.modelindex = modelIndex(pr.getString(svent.v_int[pr.entvars.model]));
			baseline.alpha = svent.alpha
			if (state.server.protocol === protocol.rmq && pr.state.scale_supported) {
				const sval = ed.getEdictFieldValue(svent, "scale")
				if (sval)
					baseline.scale = pr.encodeScale(sval)
			}
		}

		// fitzquake
		var bits = 0
		if (state.server.protocol === protocol.netquake) {
			if (baseline.modelindex & 0xFF00)
				baseline.modelindex = 0
			if (baseline.frame & 0xFF00)
				baseline.frame = 0

			baseline.alpha = protocol.ENT_ALPHA.default
			baseline.scale = protocol.ENTSCALE_DEFAULT
		} else {
			if (baseline.modelindex & 0xFF00)
				bits |= protocol.BASE.largemodel
			if (baseline.frame & 0xFF00)
				bits |= protocol.BASE.largeframe
			if (baseline.alpha !== protocol.ENT_ALPHA.default)
				bits |= protocol.BASE.alpha
			if (baseline.scale !== protocol.ENTSCALE_DEFAULT)
				bits |= protocol.BASE.scale
		}

		if (bits)
			msg.writeByte(signon, protocol.SVC.spawnbaseline2)
		else
			msg.writeByte(signon, protocol.SVC.spawnbaseline)

		msg.writeShort(signon, i);

		if (bits)
			msg.writeByte(signon, bits)

		if (bits & protocol.BASE.largemodel)
			msg.writeShort(signon, baseline.modelindex)
		else
			msg.writeByte(signon, baseline.modelindex)
		if (bits & protocol.BASE.largeframe)
			msg.writeShort(signon, baseline.frame)
		else
			msg.writeByte(signon, baseline.frame)

		msg.writeByte(signon, baseline.colormap);
		msg.writeByte(signon, baseline.skin);
		msg.writeCoord(signon, baseline.origin[0], state.server.protocolFlags);
		msg.writeAngle(signon, baseline.angles[0], state.server.protocolFlags);
		msg.writeCoord(signon, baseline.origin[1], state.server.protocolFlags);
		msg.writeAngle(signon, baseline.angles[1], state.server.protocolFlags);
		msg.writeCoord(signon, baseline.origin[2], state.server.protocolFlags);
		msg.writeAngle(signon, baseline.angles[2], state.server.protocolFlags);

		if (bits & protocol.BASE.alpha)
			msg.writeByte(signon, baseline.alpha)
		if (bits & protocol.BASE.scale)
			msg.writeByte(signon, baseline.scale)
	}
};

// move

export const checkBottom = function (ent: Edict): boolean {
	var mins = vec.scratch();
	mins[0] = ent.v_float[pr.entvars.origin] + ent.v_float[pr.entvars.mins];
	mins[1] = ent.v_float[pr.entvars.origin1] + ent.v_float[pr.entvars.mins1];
	mins[2] = ent.v_float[pr.entvars.origin2] + ent.v_float[pr.entvars.mins2];
	var maxs = vec.scratch();
	maxs[0] = ent.v_float[pr.entvars.origin] + ent.v_float[pr.entvars.maxs];
	maxs[1] = ent.v_float[pr.entvars.origin1] + ent.v_float[pr.entvars.maxs1];
	maxs[2] = ent.v_float[pr.entvars.origin2] + ent.v_float[pr.entvars.maxs2];
	var pt = vec.scratch();
	for (; ;) {
		pt[0] = mins[0]; pt[1] = mins[1]; pt[2] = mins[2] - 1.0;
		if (pointContents(pt) !== mod.CONTENTS.solid)
			break;
		pt[0] = mins[0]; pt[1] = maxs[1]; pt[2] = mins[2] - 1.0;
		if (pointContents(pt) !== mod.CONTENTS.solid)
			break;
		pt[0] = maxs[0]; pt[1] = mins[1]; pt[2] = mins[2] - 1.0;
		if (pointContents(pt) !== mod.CONTENTS.solid)
			break;
		pt[0] = maxs[0]; pt[1] = maxs[1]; pt[2] = mins[2] - 1.0;
		if (pointContents(pt) !== mod.CONTENTS.solid)
			break;
		return true;
	}
	var start: V3 = vec.scratch();
	start[0] = (mins[0] + maxs[0]) * 0.5; start[1] = (mins[1] + maxs[1]) * 0.5; start[2] = mins[2];
	var stop: V3 = vec.scratch();
	stop[0] = start[0]; stop[1] = start[1]; stop[2] = start[2] - 36.0;
	var trace = move(start, vec.origin, vec.origin, stop, 1, ent, state.traceCheckBottom);
	if (trace.fraction === 1.0)
		return false;
	var mid, bottom;
	mid = bottom = trace.endpos[2];
	var x, y;
	for (x = 0; x <= 1; ++x) {
		for (y = 0; y <= 1; ++y) {
			start[0] = stop[0] = (x !== 0) ? maxs[0] : mins[0];
			start[1] = stop[1] = (y !== 0) ? maxs[1] : mins[1];
			trace = move(start, vec.origin, vec.origin, stop, 1, ent, state.traceCheckBottom);
			if ((trace.fraction !== 1.0) && (trace.endpos[2] > bottom))
				bottom = trace.endpos[2];
			if ((trace.fraction === 1.0) || ((mid - trace.endpos[2]) > 18.0))
				return false;
		}
	}
	return true;
};

export const movestep = function (ent: Edict, _move: [number, number], relink: boolean) {
	var oldorg = ed.vector(ent, pr.entvars.origin, vec.scratch());
	var neworg:V3 = vec.scratch();
	var mins = ed.vector(ent, pr.entvars.mins, vec.scratch()), maxs = ed.vector(ent, pr.entvars.maxs, vec.scratch());
	var trace;
	if ((ent.v_float[pr.entvars.flags] & (FL.swim + FL.fly)) !== 0) {
		var i, enemy = ent.v_int[pr.entvars.enemy], dz;
		for (i = 0; i <= 1; ++i) {
			neworg[0] = ent.v_float[pr.entvars.origin] + _move[0];
			neworg[1] = ent.v_float[pr.entvars.origin1] + _move[1];
			neworg[2] = ent.v_float[pr.entvars.origin2];
			if ((i === 0) && (enemy !== 0)) {
				dz = ent.v_float[pr.entvars.origin2] - state.server.edicts[enemy].v_float[pr.entvars.origin2];
				if (dz > 40.0)
					neworg[2] -= 8.0;
				else if (dz < 30.0)
					neworg[2] += 8.0;
			}
			trace = move(oldorg, mins, maxs, neworg, 0, ent, state.traceMovestep);
			if (trace.fraction === 1.0) {
				if (((ent.v_float[pr.entvars.flags] & FL.swim) !== 0) && (pointContents(trace.endpos) === mod.CONTENTS.empty))
					return 0;
				ent.v_float[pr.entvars.origin] = trace.endpos[0];
				ent.v_float[pr.entvars.origin1] = trace.endpos[1];
				ent.v_float[pr.entvars.origin2] = trace.endpos[2];
				if (relink === true)
					linkEdict(ent, true);
				return 1;
			}
			if (enemy === 0)
				return 0;
		}
		return 0;
	}
	neworg[0] = ent.v_float[pr.entvars.origin] + _move[0];
	neworg[1] = ent.v_float[pr.entvars.origin1] + _move[1];
	neworg[2] = ent.v_float[pr.entvars.origin2] + 18.0;
	var end: V3 = vec.scratch();
	end[0] = neworg[0]; end[1] = neworg[1]; end[2] = neworg[2] - 36.0;
	trace = move(neworg, mins, maxs, end, 0, ent, state.traceMovestep);
	if (trace.allsolid === true)
		return 0;
	if (trace.startsolid === true) {
		neworg[2] -= 18.0;
		trace = move(neworg, mins, maxs, end, 0, ent, state.traceMovestep);
		if ((trace.allsolid === true) || (trace.startsolid === true))
			return 0;
	}
	if (trace.fraction === 1.0) {
		if ((ent.v_float[pr.entvars.flags] & FL.partialground) === 0)
			return 0;
		ent.v_float[pr.entvars.origin] += _move[0];
		ent.v_float[pr.entvars.origin1] += _move[1];
		if (relink === true)
			linkEdict(ent, true);
		ent.v_float[pr.entvars.flags] &= (~FL.onground >>> 0);
		return 1;
	}
	ent.v_float[pr.entvars.origin] = trace.endpos[0];
	ent.v_float[pr.entvars.origin1] = trace.endpos[1];
	ent.v_float[pr.entvars.origin2] = trace.endpos[2];
	if (checkBottom(ent) !== true) {
		if ((ent.v_float[pr.entvars.flags] & FL.partialground) !== 0) {
			if (relink === true)
				linkEdict(ent, true);
			return 1;
		}
		ent.v_float[pr.entvars.origin] = oldorg[0];
		ent.v_float[pr.entvars.origin1] = oldorg[1];
		ent.v_float[pr.entvars.origin2] = oldorg[2];
		return 0;
	}
	ent.v_float[pr.entvars.flags] &= (~FL.partialground >>> 0);
	ent.v_int[pr.entvars.groundentity] = trace.ent.num;
	if (relink === true)
		linkEdict(ent, true);
	return 1;
};

export const stepDirection = function (ent: Edict, yaw: number, dist: number) {
	ent.v_float[pr.entvars.ideal_yaw] = yaw;
	pf.changeyaw();
	yaw *= Math.PI / 180.0;
	var oldorigin = ed.vector(ent, pr.entvars.origin, vec.scratch());
	if (movestep(ent, [Math.cos(yaw) * dist, Math.sin(yaw) * dist], false) === 1) {
		var delta = ent.v_float[pr.entvars.angles1] - ent.v_float[pr.entvars.ideal_yaw];
		if ((delta > 45.0) && (delta < 315.0))
			ed.setVector(ent, pr.entvars.origin, oldorigin);
		linkEdict(ent, true);
		return true;
	}
	linkEdict(ent, true);
};

export const newChaseDir = function (actor: Edict, enemy: Edict, dist: number) {
	var olddir = vec.anglemod(((actor.v_float[pr.entvars.ideal_yaw] / 45.0) >> 0) * 45.0);
	var turnaround = vec.anglemod(olddir - 180.0);
	var deltax = enemy.v_float[pr.entvars.origin] - actor.v_float[pr.entvars.origin];
	var deltay = enemy.v_float[pr.entvars.origin1] - actor.v_float[pr.entvars.origin1];
	var dx, dy;
	if (deltax > 10.0)
		dx = 0.0;
	else if (deltax < -10.0)
		dx = 180.0;
	else
		dx = -1;
	if (deltay < -10.0)
		dy = 270.0;
	else if (deltay > 10.0)
		dy = 90.0;
	else
		dy = -1;
	var tdir;
	if ((dx !== -1) && (dy !== -1)) {
		if (dx === 0.0)
			tdir = (dy === 90.0) ? 45.0 : 315.0;
		else
			tdir = (dy === 90.0) ? 135.0 : 215.0;
		if ((tdir !== turnaround) && (stepDirection(actor, tdir, dist) === true))
			return;
	}
	if ((Math.random() >= 0.25) || (Math.abs(deltay) > Math.abs(deltax))) {
		tdir = dx;
		dx = dy;
		dy = tdir;
	}
	if ((dx !== -1) && (dx !== turnaround) && (stepDirection(actor, dx, dist) === true))
		return;
	if ((dy !== -1) && (dy !== turnaround) && (stepDirection(actor, dy, dist) === true))
		return;
	if ((olddir !== -1) && (stepDirection(actor, olddir, dist) === true))
		return;
	if (Math.random() >= 0.5) {
		for (tdir = 0.0; tdir <= 315.0; tdir += 45.0) {
			if ((tdir !== turnaround) && (stepDirection(actor, tdir, dist) === true))
				return;
		}
	}
	else {
		for (tdir = 315.0; tdir >= 0.0; tdir -= 45.0) {
			if ((tdir !== turnaround) && (stepDirection(actor, tdir, dist) === true))
				return;
		}
	}
	if ((turnaround !== -1) && (stepDirection(actor, turnaround, dist) === true))
		return;
	actor.v_float[pr.entvars.ideal_yaw] = olddir;
	if (checkBottom(actor) !== true)
		actor.v_float[pr.entvars.flags] |= FL.partialground;
};

export const closeEnough = function (ent: Edict, goal: Edict, dist: number) {
	var i;
	for (i = 0; i <= 2; ++i) {
		if (goal.v_float[pr.entvars.absmin + i] > (ent.v_float[pr.entvars.absmax + i] + dist))
			return;
		if (goal.v_float[pr.entvars.absmax + i] < (ent.v_float[pr.entvars.absmin + i] - dist))
			return;
	}
	return true;
};

// phys

const checkAllEnts = function () {
	var e, check;
	for (e = 1; e < state.server.num_edicts; ++e) {
		check = state.server.edicts[e];
		if (check.free === true)
			continue;
		switch (check.v_float[pr.entvars.movetype]) {
			case MOVE_TYPE.push:
			case MOVE_TYPE.none:
			case MOVE_TYPE.noclip:
				continue;
		}
		if (testEntityPosition(check) === true)
			con.print('entity in invalid position\n');
	}
};

const checkVelocity = function (ent: Edict) {
	var i, velocity;
	for (i = 0; i <= 2; ++i) {
		velocity = ent.v_float[pr.entvars.velocity + i];
		if (q.isNaN(velocity) === true) {
			con.print('Got a NaN velocity on ' + pr.getString(ent.v_int[pr.entvars.classname]) + '\n');
			velocity = 0.0;
		}
		if (q.isNaN(ent.v_float[pr.entvars.origin + i]) === true) {
			con.print('Got a NaN origin on ' + pr.getString(ent.v_int[pr.entvars.classname]) + '\n');
			ent.v_float[pr.entvars.origin + i] = 0.0;
		}
		if (velocity > cvr.maxvelocity.value)
			velocity = cvr.maxvelocity.value;
		else if (velocity < -cvr.maxvelocity.value)
			velocity = -cvr.maxvelocity.value;
		ent.v_float[pr.entvars.velocity + i] = velocity;
	}
};

function runThink(ent: Edict) {
	var thinktime = ent.v_float[pr.entvars.nextthink];
	if ((thinktime <= 0.0) || (thinktime > (state.server.time + host.state.frametime)))
		return true;
	if (thinktime < state.server.time)
		thinktime = state.server.time;

	// QSS-M SV_RunThink: persistent capture read by the sendinterval computation at the
	// END of the physics loop (not here — QSS-M recomputes it for EVERY entity, every frame).
	ent.oldthinktime = thinktime;
	ent.oldframe = ent.v_float[pr.entvars.frame];

	ent.v_float[pr.entvars.nextthink] = 0.0;
	pr.state.globals_float[pr.globalvars.time] = thinktime;
	pr.state.globals_int[pr.globalvars.self] = ent.num;
	pr.state.globals_int[pr.globalvars.other] = 0;
	pr.executeProgram(ent.v_int[pr.entvars.think]);

	return (ent.free !== true);
}

const impact = function (e1: Edict, e2: Edict) {
	var old_self = pr.state.globals_int[pr.globalvars.self];
	var old_other = pr.state.globals_int[pr.globalvars.other];
	pr.state.globals_float[pr.globalvars.time] = state.server.time;

	if ((e1.v_int[pr.entvars.touch] !== 0) && (e1.v_float[pr.entvars.solid] !== SOLID.not)) {
		pr.state.globals_int[pr.globalvars.self] = e1.num;
		pr.state.globals_int[pr.globalvars.other] = e2.num;
		pr.executeProgram(e1.v_int[pr.entvars.touch]);
	}
	if ((e2.v_int[pr.entvars.touch] !== 0) && (e2.v_float[pr.entvars.solid] !== SOLID.not)) {
		pr.state.globals_int[pr.globalvars.self] = e2.num;
		pr.state.globals_int[pr.globalvars.other] = e1.num;
		pr.executeProgram(e2.v_int[pr.entvars.touch]);
	}

	pr.state.globals_int[pr.globalvars.self] = old_self;
	pr.state.globals_int[pr.globalvars.other] = old_other;
};

const clipVelocity = function (vec: V3, normal: V3, out: V3, overbounce: number) {
	var backoff = (vec[0] * normal[0] + vec[1] * normal[1] + vec[2] * normal[2]) * overbounce;

	out[0] = vec[0] - normal[0] * backoff;
	if ((out[0] > -0.1) && (out[0] < 0.1))
		out[0] = 0.0;
	out[1] = vec[1] - normal[1] * backoff;
	if ((out[1] > -0.1) && (out[1] < 0.1))
		out[1] = 0.0;
	out[2] = vec[2] - normal[2] * backoff;
	if ((out[2] > -0.1) && (out[2] < 0.1))
		out[2] = 0.0;
};

const flyMove = function (ent: Edict, time: number) {
	var bumpcount;
	var numplanes = 0;
	var dir, d;
	var planes = state.flymovePlanes, plane;
	var primal_velocity = ed.vector(ent, pr.entvars.velocity, vec.scratch());
	var original_velocity = ed.vector(ent, pr.entvars.velocity, vec.scratch());
	var new_velocity: V3 = vec.scratch();
	var i, j;
	var trace;
	var end: V3 = vec.scratch();
	var time_left = time;
	var blocked = 0;
	for (bumpcount = 0; bumpcount <= 3; ++bumpcount) {
		if ((ent.v_float[pr.entvars.velocity] === 0.0) &&
			(ent.v_float[pr.entvars.velocity1] === 0.0) &&
			(ent.v_float[pr.entvars.velocity2] === 0.0))
			break;
		end[0] = ent.v_float[pr.entvars.origin] + time_left * ent.v_float[pr.entvars.velocity];
		end[1] = ent.v_float[pr.entvars.origin1] + time_left * ent.v_float[pr.entvars.velocity1];
		end[2] = ent.v_float[pr.entvars.origin2] + time_left * ent.v_float[pr.entvars.velocity2];
		trace = move(ed.vector(ent, pr.entvars.origin, vec.scratch()), ed.vector(ent, pr.entvars.mins, vec.scratch()), ed.vector(ent, pr.entvars.maxs, vec.scratch()), end, 0, ent, state.traceFlymove);
		if (trace.allsolid === true) {
			ed.setVector(ent, pr.entvars.velocity, vec.origin);
			return 3;
		}
		if (trace.fraction > 0.0) {
			ed.setVector(ent, pr.entvars.origin, trace.endpos);
			ed.vector(ent, pr.entvars.velocity, original_velocity);
			numplanes = 0;
			if (trace.fraction === 1.0)
				break;
		}
		if (trace.ent == null)
			sys.error('SV.FlyMove: !trace.ent');
		if (trace.plane.normal[2] > 0.7) {
			blocked |= 1;
			if (trace.ent.v_float[pr.entvars.solid] === SOLID.bsp) {
				ent.v_float[pr.entvars.flags] |= FL.onground;
				ent.v_int[pr.entvars.groundentity] = trace.ent.num;
			}
		}
		else if (trace.plane.normal[2] === 0.0) {
			blocked |= 2;
			// copy, don't alias: traceFlymove is reused by later bumpcount iterations and
			// by tryUnstick before wallFriction(state.steptrace) reads it
			copyTrace(trace, state.steptrace);
		}
		impact(ent, trace.ent);
		if (ent.free === true)
			break;
		time_left -= time_left * trace.fraction;
		if (numplanes >= 5) {
			ed.setVector(ent, pr.entvars.velocity, vec.origin);
			return 3;
		}
		planes[numplanes][0] = trace.plane.normal[0];
		planes[numplanes][1] = trace.plane.normal[1];
		planes[numplanes][2] = trace.plane.normal[2];
		++numplanes;
		for (i = 0; i < numplanes; ++i) {
			clipVelocity(original_velocity, planes[i], new_velocity, 1.0);
			for (j = 0; j < numplanes; ++j) {
				if (j !== i) {
					plane = planes[j];
					if ((new_velocity[0] * plane[0] + new_velocity[1] * plane[1] + new_velocity[2] * plane[2]) < 0.0)
						break;
				}
			}
			if (j === numplanes)
				break;
		}
		if (i !== numplanes)
			ed.setVector(ent, pr.entvars.velocity, new_velocity);
		else {
			if (numplanes !== 2) {
				ed.setVector(ent, pr.entvars.velocity, vec.origin);
				return 7;
			}
			dir = vec.crossProduct(planes[0], planes[1], vec.scratch());
			d = dir[0] * ent.v_float[pr.entvars.velocity] +
				dir[1] * ent.v_float[pr.entvars.velocity1] +
				dir[2] * ent.v_float[pr.entvars.velocity2];
			ent.v_float[pr.entvars.velocity] = dir[0] * d;
			ent.v_float[pr.entvars.velocity1] = dir[1] * d;
			ent.v_float[pr.entvars.velocity2] = dir[2] * d;
		}
		if ((ent.v_float[pr.entvars.velocity] * primal_velocity[0] +
			ent.v_float[pr.entvars.velocity1] * primal_velocity[1] +
			ent.v_float[pr.entvars.velocity2] * primal_velocity[2]) <= 0.0) {
			ed.setVector(ent, pr.entvars.velocity, vec.origin);
			return blocked;
		}
	}
	return blocked;
};

const addGravity = function (ent: Edict) {
	var val = pr.entvars.gravity, ent_gravity;
	if (val != null)
		ent_gravity = (ent.v_float[val] !== 0.0) ? ent.v_float[val] : 1.0;
	else
		ent_gravity = 1.0;
	ent.v_float[pr.entvars.velocity2] -= ent_gravity * cvr.gravity.value * host.state.frametime;
};

const pushEntity = function (ent: Edict, push: V3) {
	var end: V3 = vec.scratch();
	end[0] = ent.v_float[pr.entvars.origin] + push[0];
	end[1] = ent.v_float[pr.entvars.origin1] + push[1];
	end[2] = ent.v_float[pr.entvars.origin2] + push[2];
	var nomonsters;
	var solid = ent.v_float[pr.entvars.solid];
	if (ent.v_float[pr.entvars.movetype] === MOVE_TYPE.flymissile)
		nomonsters = MOVE.missile;
	else if ((solid === SOLID.trigger) || (solid === SOLID.not))
		nomonsters = MOVE.nomonsters
	else
		nomonsters = MOVE.normal;
	var trace = move(ed.vector(ent, pr.entvars.origin, vec.scratch()), ed.vector(ent, pr.entvars.mins, vec.scratch()),
		ed.vector(ent, pr.entvars.maxs, vec.scratch()), end, nomonsters, ent, state.tracePushEntity);
	ed.setVector(ent, pr.entvars.origin, trace.endpos);
	linkEdict(ent, true);
	if (trace.ent != null)
		impact(ent, trace.ent);
	return trace;
};

// DP_SV_ROTATINGBMODEL, always enabled (no pext negotiation). Mirrors QSS-M's
// SV_PushMoveAngles: translates+rotates the pusher, carries/clips riders through the
// same rigid transform, unwinds everything on blocked. Returns false if blocked.
const pushMoveAngles = function (pusher: Edict, movetime: number): boolean {
	var move: V3 = vec.scratch();
	move[0] = pusher.v_float[pr.entvars.velocity] * movetime;
	move[1] = pusher.v_float[pr.entvars.velocity1] * movetime;
	move[2] = pusher.v_float[pr.entvars.velocity2] * movetime;
	var amove: V3 = vec.scratch();
	amove[0] = pusher.v_float[pr.entvars.avelocity] * movetime;
	amove[1] = pusher.v_float[pr.entvars.avelocity1] * movetime;
	amove[2] = pusher.v_float[pr.entvars.avelocity2] * movetime;

	var mins: V3 = vec.scratch();
	mins[0] = pusher.v_float[pr.entvars.absmin] + move[0];
	mins[1] = pusher.v_float[pr.entvars.absmin1] + move[1];
	mins[2] = pusher.v_float[pr.entvars.absmin2] + move[2];
	var maxs: V3 = vec.scratch();
	maxs[0] = pusher.v_float[pr.entvars.absmax] + move[0];
	maxs[1] = pusher.v_float[pr.entvars.absmax1] + move[1];
	maxs[2] = pusher.v_float[pr.entvars.absmax2] + move[2];

	// AngleVectors of the negated amove, used to transform rider origins below
	var negamove: V3 = vec.scratch();
	negamove[0] = -amove[0];
	negamove[1] = -amove[1];
	negamove[2] = -amove[2];
	var forward: V3 = vec.scratch();
	var right: V3 = vec.scratch();
	var up: V3 = vec.scratch();
	vec.angleVectors(negamove, forward, right, up);

	var movedEdicts = state.movedEdicts, movedOrigins = state.movedOrigins, movedAngles = state.movedAngles;
	var movedCount = 0;

	// save the pusher's original position
	movedEdicts[0] = pusher;
	movedOrigins[0] = pusher.v_float[pr.entvars.origin];
	movedOrigins[1] = pusher.v_float[pr.entvars.origin1];
	movedOrigins[2] = pusher.v_float[pr.entvars.origin2];
	movedAngles[0] = pusher.v_float[pr.entvars.angles];
	movedAngles[1] = pusher.v_float[pr.entvars.angles1];
	movedAngles[2] = pusher.v_float[pr.entvars.angles2];
	movedCount = 1;

	// move the pusher to its final position
	pusher.v_float[pr.entvars.origin] += move[0];
	pusher.v_float[pr.entvars.origin1] += move[1];
	pusher.v_float[pr.entvars.origin2] += move[2];
	pusher.v_float[pr.entvars.angles] += amove[0];
	pusher.v_float[pr.entvars.angles1] += amove[1];
	pusher.v_float[pr.entvars.angles2] += amove[2];
	linkEdict(pusher, false);

	var e: number, i: number, check: Edict, movetype: number, base: number;
	var org: V3 = vec.scratch();
	var org2: V3 = vec.scratch();
	var move2: V3 = vec.scratch();
	var baseOrigin: V3 = vec.scratch();
	var candidates = gatherPushCandidates(pusher, mins, maxs, move);
	for (e = 0; e < candidates.length; ++e) {
		check = candidates[e];
		if (check.free === true)
			continue;
		movetype = check.v_float[pr.entvars.movetype];
		if ((movetype === MOVE_TYPE.push)
			|| (movetype === MOVE_TYPE.none)
			|| (movetype === MOVE_TYPE.noclip)
			|| (movetype === MOVE_TYPE.anglenoclip))
			continue;

		if (((check.v_float[pr.entvars.flags] & FL.onground) === 0) ||
			(check.v_int[pr.entvars.groundentity] !== pusher.num)) {
			if ((check.v_float[pr.entvars.absmin] >= maxs[0])
				|| (check.v_float[pr.entvars.absmin1] >= maxs[1])
				|| (check.v_float[pr.entvars.absmin2] >= maxs[2])
				|| (check.v_float[pr.entvars.absmax] <= mins[0])
				|| (check.v_float[pr.entvars.absmax1] <= mins[1])
				|| (check.v_float[pr.entvars.absmax2] <= mins[2]))
				continue;
			// FTE_ENT_SKIN_CONTENTS: contents pushers are invisible to clipToLinks (and so
			// to testEntityPosition) -- test overlap directly against this pusher's hull so
			// water volumes still carry riders (QSS-M sv_phys.c ~806)
			if ((pusher.v_float[pr.entvars.skin] >> 0) < 0) {
				if (pusherOverlaps(pusher, check) !== true)
					continue;
			}
			else if (testEntityPosition(check) !== true)
				continue;
		}

		if ((pusher.v_float[pr.entvars.movetype] === MOVE_TYPE.push) || (check.v_int[pr.entvars.groundentity] === pusher.num)) {
			// save this rider for blocked-revert
			base = movedCount * 3;
			movedEdicts[movedCount] = check;
			movedOrigins[base] = check.v_float[pr.entvars.origin];
			movedOrigins[base + 1] = check.v_float[pr.entvars.origin1];
			movedOrigins[base + 2] = check.v_float[pr.entvars.origin2];
			movedAngles[base] = check.v_float[pr.entvars.angles];
			movedAngles[base + 1] = check.v_float[pr.entvars.angles1];
			movedAngles[base + 2] = check.v_float[pr.entvars.angles2];
			++movedCount;

			// try moving the contacted entity
			check.v_float[pr.entvars.origin] += move[0];
			check.v_float[pr.entvars.origin1] += move[1];
			check.v_float[pr.entvars.origin2] += move[2];
			check.v_float[pr.entvars.angles] += amove[0];
			check.v_float[pr.entvars.angles1] += amove[1];
			check.v_float[pr.entvars.angles2] += amove[2];

			// figure movement due to the pusher's amove
			org[0] = check.v_float[pr.entvars.origin] - pusher.v_float[pr.entvars.origin];
			org[1] = check.v_float[pr.entvars.origin1] - pusher.v_float[pr.entvars.origin1];
			org[2] = check.v_float[pr.entvars.origin2] - pusher.v_float[pr.entvars.origin2];
			org2[0] = org[0] * forward[0] + org[1] * forward[1] + org[2] * forward[2];
			org2[1] = -(org[0] * right[0] + org[1] * right[1] + org[2] * right[2]);
			org2[2] = org[0] * up[0] + org[1] * up[1] + org[2] * up[2];
			move2[0] = org2[0] - org[0];
			move2[1] = org2[1] - org[1];
			move2[2] = org2[2] - org[2];
			check.v_float[pr.entvars.origin] += move2[0];
			check.v_float[pr.entvars.origin1] += move2[1];
			check.v_float[pr.entvars.origin2] += move2[2];

			// QSS-M rider exemption — see the identical note in pushMove below.
			if (movetype !== MOVE_TYPE.walk && check.v_int[pr.entvars.groundentity] !== pusher.num)
				check.v_float[pr.entvars.flags] &= (~FL.onground) >>> 0;

			// may have pushed them off an edge
			if (check.v_int[pr.entvars.groundentity] !== pusher.num)
				check.v_int[pr.entvars.groundentity] = 0;

			if (testEntityPosition(check) !== true) {
				// pushed ok
				linkEdict(check, false);
				continue;
			}

			// contents brushes can't crush: the rider just stays in the water (QSS-M ~686)
			if ((pusher.v_float[pr.entvars.skin] >> 0) < 0) {
				linkEdict(check, false);
				continue;
			}

			// if it is ok to leave in the old position, do it (riders only; doesn't
			// account for the angle change already applied, matching QSS-M)
			base = (movedCount - 1) * 3;
			check.v_float[pr.entvars.origin] = movedOrigins[base];
			check.v_float[pr.entvars.origin1] = movedOrigins[base + 1];
			check.v_float[pr.entvars.origin2] = movedOrigins[base + 2];
			if (testEntityPosition(check) !== true) {
				--movedCount;
				continue;
			}

			// that didn't work, try pushing the entity against stuff (translation only)
			pushEntity(check, move);
			if (testEntityPosition(check) !== true)
				continue;

			// precision errors can strike when you least expect it; try to reduce them
			baseOrigin[0] = check.v_float[pr.entvars.origin];
			baseOrigin[1] = check.v_float[pr.entvars.origin1];
			baseOrigin[2] = check.v_float[pr.entvars.origin2];
			var blocked = true;
			for (i = 0; i < 8 && blocked; ++i) {
				check.v_float[pr.entvars.origin] = baseOrigin[0] + ((i & 1) ? -0.125 : 0.125);
				check.v_float[pr.entvars.origin1] = baseOrigin[1] + ((i & 2) ? -0.125 : 0.125);
				check.v_float[pr.entvars.origin2] = baseOrigin[2] + ((i & 4) ? -0.125 : 0.125);
				blocked = testEntityPosition(check) === true;
			}
			if (!blocked) {
				linkEdict(check, false);
				continue;
			}
		}

		// if it is sitting on top, do not block
		if (check.v_float[pr.entvars.mins] === check.v_float[pr.entvars.maxs]) {
			linkEdict(check, false);
			continue;
		}

		if ((check.v_float[pr.entvars.solid] === SOLID.not) || (check.v_float[pr.entvars.solid] === SOLID.trigger)) {
			// corpse
			check.v_float[pr.entvars.mins] = check.v_float[pr.entvars.maxs] = 0.0;
			check.v_float[pr.entvars.mins1] = check.v_float[pr.entvars.maxs1] = 0.0;
			check.v_float[pr.entvars.maxs2] = check.v_float[pr.entvars.mins2];
			linkEdict(check, false);
			continue;
		}

		if (pusher.v_int[pr.entvars.blocked] !== 0) {
			pr.state.globals_int[pr.globalvars.self] = pusher.num;
			pr.state.globals_int[pr.globalvars.other] = check.num;
			pr.executeProgram(pusher.v_int[pr.entvars.blocked]);
		}

		// move back any entities we already moved, most-recent-first so a doubly
		// pushed entity ends at its original position
		for (i = movedCount - 1; i >= 0; --i) {
			var revEnt = movedEdicts[i];
			base = i * 3;
			revEnt.v_float[pr.entvars.origin] = movedOrigins[base];
			revEnt.v_float[pr.entvars.origin1] = movedOrigins[base + 1];
			revEnt.v_float[pr.entvars.origin2] = movedOrigins[base + 2];
			revEnt.v_float[pr.entvars.angles] = movedAngles[base];
			revEnt.v_float[pr.entvars.angles1] = movedAngles[base + 1];
			revEnt.v_float[pr.entvars.angles2] = movedAngles[base + 2];
			linkEdict(revEnt, false);
		}
		return false;
	}

	// see if anything we moved has touched a trigger
	for (i = movedCount - 1; i >= 0; --i)
		linkEdict(movedEdicts[i], true);

	return true;
};

const pushMove = function (pusher: Edict, movetime: number) {
	if ((pusher.v_float[pr.entvars.avelocity] !== 0.0) ||
		(pusher.v_float[pr.entvars.avelocity1] !== 0.0) ||
		(pusher.v_float[pr.entvars.avelocity2] !== 0.0)) {
		// Rerelease progs break avelocity on MOVETYPE_PUSH, so DP_SV_ROTATINGBMODEL is off for
		// them: QSS-M only sets qcvm->rotatingbmodel from an extension query they never make,
		// and FTE gates the angular path on !remasterlogic. Falling through to the linear path
		// with a one-shot warning is QSS-M SV_PushMove (sv_phys.c:737-753).
		if (pr.state.rerelease !== true) {
			if (pushMoveAngles(pusher, movetime))
				pusher.v_float[pr.entvars.ltime] += movetime;
			return;
		}
		if (state.warnedRotatingBmodel !== true) {
			state.warnedRotatingBmodel = true;
			con.print('Warning: MOVETYPE_PUSH("' + pr.getString(pusher.v_int[pr.entvars.classname]) +
				'") has avelocity, but DP_SV_ROTATINGBMODEL is not enabled\n');
		}
	}
	if ((pusher.v_float[pr.entvars.velocity] === 0.0) &&
		(pusher.v_float[pr.entvars.velocity1] === 0.0) &&
		(pusher.v_float[pr.entvars.velocity2] === 0.0)) {
		pusher.v_float[pr.entvars.ltime] += movetime;
		return;
	}
	var _move: V3 = vec.scratch();
	_move[0] = pusher.v_float[pr.entvars.velocity] * movetime;
	_move[1] = pusher.v_float[pr.entvars.velocity1] * movetime;
	_move[2] = pusher.v_float[pr.entvars.velocity2] * movetime;
	var mins: V3 = vec.scratch();
	mins[0] = pusher.v_float[pr.entvars.absmin] + _move[0];
	mins[1] = pusher.v_float[pr.entvars.absmin1] + _move[1];
	mins[2] = pusher.v_float[pr.entvars.absmin2] + _move[2];
	var maxs: V3 = vec.scratch();
	maxs[0] = pusher.v_float[pr.entvars.absmax] + _move[0];
	maxs[1] = pusher.v_float[pr.entvars.absmax1] + _move[1];
	maxs[2] = pusher.v_float[pr.entvars.absmax2] + _move[2];
	var pushorig = ed.vector(pusher, pr.entvars.origin, vec.scratch());
	pusher.v_float[pr.entvars.origin] += _move[0];
	pusher.v_float[pr.entvars.origin1] += _move[1];
	pusher.v_float[pr.entvars.origin2] += _move[2];
	pusher.v_float[pr.entvars.ltime] += movetime;
	linkEdict(pusher, false);
	var e: number, check: Edict, movetype;
	// pooled rider list shared with pushMoveAngles (they can never interleave: pusher
	// physics isn't reachable from the QC that pushEntity's touch handlers run)
	var entorig, i;
	var moved = state.movedEdicts, movedOrigins = state.movedOrigins, numMoved = 0;
	var candidates = gatherPushCandidates(pusher, mins, maxs, _move);
	for (e = 0; e < candidates.length; ++e) {
		check = candidates[e];
		if (check.free === true)
			continue;
		movetype = check.v_float[pr.entvars.movetype];
		if ((movetype === MOVE_TYPE.push)
			|| (movetype === MOVE_TYPE.none)
			|| (movetype === MOVE_TYPE.noclip))
			continue;
		if (((check.v_float[pr.entvars.flags] & FL.onground) === 0) ||
			(check.v_int[pr.entvars.groundentity] !== pusher.num)) {
			if ((check.v_float[pr.entvars.absmin] >= maxs[0])
				|| (check.v_float[pr.entvars.absmin1] >= maxs[1])
				|| (check.v_float[pr.entvars.absmin2] >= maxs[2])
				|| (check.v_float[pr.entvars.absmax] <= mins[0])
				|| (check.v_float[pr.entvars.absmax1] <= mins[1])
				|| (check.v_float[pr.entvars.absmax2] <= mins[2]))
				continue;
			// FTE_ENT_SKIN_CONTENTS: contents pushers are invisible to clipToLinks (and so
			// to testEntityPosition) -- test overlap directly against this pusher's hull so
			// water volumes still carry riders (QSS-M sv_phys.c ~806)
			if ((pusher.v_float[pr.entvars.skin] >> 0) < 0) {
				if (pusherOverlaps(pusher, check) !== true)
					continue;
			}
			else if (testEntityPosition(check) !== true)
				continue;
		}
		// QSS-M sv_phys.c: keep FL_ONGROUND for entities already riding THIS pusher.
		// Without the exemption riders lose onground every push tick and movetogoal
		// (which requires onground) no-ops mid-ride, paralyzing monsters on plats.
		if (movetype !== MOVE_TYPE.walk && check.v_int[pr.entvars.groundentity] !== pusher.num)
			check.v_float[pr.entvars.flags] &= (~FL.onground) >>> 0;
		entorig = ed.vector(check, pr.entvars.origin, vec.scratch());
		moved[numMoved] = check;
		movedOrigins[numMoved * 3] = entorig[0];
		movedOrigins[numMoved * 3 + 1] = entorig[1];
		movedOrigins[numMoved * 3 + 2] = entorig[2];
		++numMoved;
		// QSS-M QIP end.bsp fix: save/restore the pusher's ACTUAL solid (the port hardcoded
		// SOLID_BSP on restore, corrupting SOLID_BBOX/SLIDEBOX pushers).
		var solidBackup = pusher.v_float[pr.entvars.solid];
		pusher.v_float[pr.entvars.solid] = SOLID.not;
		pushEntity(check, _move);
		pusher.v_float[pr.entvars.solid] = solidBackup;
		if (testEntityPosition(check) === true) {
			// contents brushes can't crush: the rider just stays in the water (QSS-M ~686)
			if ((pusher.v_float[pr.entvars.skin] >> 0) < 0)
				continue;
			if (check.v_float[pr.entvars.mins] === check.v_float[pr.entvars.maxs])
				continue;
			if ((check.v_float[pr.entvars.solid] === SOLID.not) || (check.v_float[pr.entvars.solid] === SOLID.trigger)) {
				check.v_float[pr.entvars.mins] = check.v_float[pr.entvars.maxs] = 0.0;
				check.v_float[pr.entvars.mins1] = check.v_float[pr.entvars.maxs1] = 0.0;
				check.v_float[pr.entvars.maxs2] = check.v_float[pr.entvars.mins2];
				continue;
			}
			check.v_float[pr.entvars.origin] = entorig[0];
			check.v_float[pr.entvars.origin1] = entorig[1];
			check.v_float[pr.entvars.origin2] = entorig[2];
			linkEdict(check, true);
			pusher.v_float[pr.entvars.origin] = pushorig[0];
			pusher.v_float[pr.entvars.origin1] = pushorig[1];
			pusher.v_float[pr.entvars.origin2] = pushorig[2];
			linkEdict(pusher, false);
			pusher.v_float[pr.entvars.ltime] -= movetime;
			if (pusher.v_int[pr.entvars.blocked] !== 0) {
				pr.state.globals_int[pr.globalvars.self] = pusher.num;
				pr.state.globals_int[pr.globalvars.other] = check.num;
				pr.executeProgram(pusher.v_int[pr.entvars.blocked]);
			}
			for (i = 0; i < numMoved; ++i) {
				moved[i].v_float[pr.entvars.origin] = movedOrigins[i * 3];
				moved[i].v_float[pr.entvars.origin1] = movedOrigins[i * 3 + 1];
				moved[i].v_float[pr.entvars.origin2] = movedOrigins[i * 3 + 2];
				linkEdict(moved[i], false);
			}
			return;
		}
	}
};

const physics_Pusher = function (ent: Edict) {
	var oldltime = ent.v_float[pr.entvars.ltime];
	var thinktime = ent.v_float[pr.entvars.nextthink];
	var movetime;
	
	if (thinktime < (oldltime + host.state.frametime)) {
		movetime = thinktime - oldltime;
		if (movetime < 0.0)
			movetime = 0.0;
	}
	else
		movetime = host.state.frametime;
	if (movetime !== 0.0)
		pushMove(ent, movetime);
	if ((thinktime <= oldltime) || (thinktime > ent.v_float[pr.entvars.ltime]))
		return;
	ent.v_float[pr.entvars.nextthink] = 0.0;
	pr.state.globals_float[pr.globalvars.time] = state.server.time;
	pr.state.globals_int[pr.globalvars.self] = ent.num;
	pr.state.globals_int[pr.globalvars.other] = 0;
	pr.executeProgram(ent.v_int[pr.entvars.think]);
};

const checkStuck = function (ent: Edict) {
	if (testEntityPosition(ent) !== true) {
		ent.v_float[pr.entvars.oldorigin] = ent.v_float[pr.entvars.origin];
		ent.v_float[pr.entvars.oldorigin1] = ent.v_float[pr.entvars.origin1];
		ent.v_float[pr.entvars.oldorigin2] = ent.v_float[pr.entvars.origin2];
		return;
	}
	var org = ed.vector(ent, pr.entvars.origin, vec.scratch());
	ent.v_float[pr.entvars.origin] = ent.v_float[pr.entvars.oldorigin];
	ent.v_float[pr.entvars.origin1] = ent.v_float[pr.entvars.oldorigin1];
	ent.v_float[pr.entvars.origin2] = ent.v_float[pr.entvars.oldorigin2];
	if (testEntityPosition(ent) !== true) {
		con.dPrint('Unstuck.\n');
		linkEdict(ent, true);
		return;
	}
	var z, i, j;
	for (z = 0.0; z <= 17.0; ++z) {
		for (i = -1.0; i <= 1.0; ++i) {
			for (j = -1.0; j <= 1.0; ++j) {
				ent.v_float[pr.entvars.origin] = org[0] + i;
				ent.v_float[pr.entvars.origin1] = org[1] + j;
				ent.v_float[pr.entvars.origin2] = org[2] + z;
				if (testEntityPosition(ent) !== true) {
					con.dPrint('Unstuck.\n');
					linkEdict(ent, true);
					return;
				}
			}
		}
	}
	ed.setVector(ent, pr.entvars.origin, org);
	con.dPrint('player is stuck.\n');
};

// FTE_ENT_SKIN_CONTENTS: is `ent` overlapping a negative-skin SOLID_BSP entity whose skin
// is CONTENTS_LADDER, with a real wall within 24 units in front of it (the forward trace
// tells an actual FTESKIN ladder apart from a random volume placed behind the player)?
const checkLadder = function (ent: Edict) {
	var mins: V3 = vec.scratch(), maxs: V3 = vec.scratch(), origin: V3 = vec.scratch();
	mins[0] = ent.v_float[pr.entvars.mins]; mins[1] = ent.v_float[pr.entvars.mins1]; mins[2] = ent.v_float[pr.entvars.mins2];
	maxs[0] = ent.v_float[pr.entvars.maxs]; maxs[1] = ent.v_float[pr.entvars.maxs1]; maxs[2] = ent.v_float[pr.entvars.maxs2];
	origin[0] = ent.v_float[pr.entvars.origin]; origin[1] = ent.v_float[pr.entvars.origin1]; origin[2] = ent.v_float[pr.entvars.origin2];
	if (state.numSkinContents === 0 ||
		skinContentsAt(origin, mins, maxs, ent, mod.CONTENTS.empty) !== mod.CONTENTS.ladder) {
		ent.onladder = false;
		return;
	}
	var yaw = ent.v_float[pr.entvars.angles1] * Math.PI / 180.0;
	var point: V3 = vec.scratch();
	point[0] = origin[0] + Math.cos(yaw) * 24.0;
	point[1] = origin[1] + Math.sin(yaw) * 24.0;
	point[2] = origin[2];
	ent.onladder = move(origin, mins, maxs, point, MOVE.normal, ent, state.traceCheckLadder).fraction < 1.0;
};

const checkWater = function (ent: Edict) {
	checkLadder(ent);
	var point: V3 = vec.scratch();
	point[0] = ent.v_float[pr.entvars.origin];
	point[1] = ent.v_float[pr.entvars.origin1];
	point[2] = ent.v_float[pr.entvars.origin2] + ent.v_float[pr.entvars.mins2] + 1.0;
	ent.v_float[pr.entvars.waterlevel] = 0.0;
	ent.v_float[pr.entvars.watertype] = mod.CONTENTS.empty;
	var cont = pointContentsAllBsps(point, ent);
	if (cont > mod.CONTENTS.water)
		return;
	ent.v_float[pr.entvars.watertype] = cont;
	ent.v_float[pr.entvars.waterlevel] = 1.0;
	point[2] = ent.v_float[pr.entvars.origin2] + (ent.v_float[pr.entvars.mins2] + ent.v_float[pr.entvars.maxs2]) * 0.5;
	cont = pointContentsAllBsps(point, ent);
	if (cont <= mod.CONTENTS.water) {
		ent.v_float[pr.entvars.waterlevel] = 2.0;
		point[2] = ent.v_float[pr.entvars.origin2] + ent.v_float[pr.entvars.view_ofs2];
		cont = pointContentsAllBsps(point, ent);
		if (cont <= mod.CONTENTS.water)
			ent.v_float[pr.entvars.waterlevel] = 3.0;
	}
	return ent.v_float[pr.entvars.waterlevel] > 1.0;
};

const wallFriction = function (ent: Edict, trace: Trace) {
	var forward: V3 = vec.scratch();
	vec.angleVectors(ed.vector(ent, pr.entvars.v_angle, vec.scratch()), forward, null, null);
	var normal = trace.plane.normal;
	var d = normal[0] * forward[0] + normal[1] * forward[1] + normal[2] * forward[2] + 0.5;
	if (d >= 0.0)
		return;
	d += 1.0;
	var i = normal[0] * ent.v_float[pr.entvars.velocity]
		+ normal[1] * ent.v_float[pr.entvars.velocity1]
		+ normal[2] * ent.v_float[pr.entvars.velocity2];
	ent.v_float[pr.entvars.velocity] = (ent.v_float[pr.entvars.velocity] - normal[0] * i) * d;
	ent.v_float[pr.entvars.velocity1] = (ent.v_float[pr.entvars.velocity1] - normal[1] * i) * d;
};

const tryUnstick = function (ent: Edict, oldvel: V3) {
	var oldorg = ed.vector(ent, pr.entvars.origin, vec.scratch());
	var dir: V3 = vec.scratch();
	dir[0] = 2.0; dir[1] = 0.0; dir[2] = 0.0;
	var i, clip;
	for (i = 0; i <= 7; ++i) {
		switch (i) {
			case 1: dir[0] = 0.0; dir[1] = 2.0; break;
			case 2: dir[0] = -2.0; dir[1] = 0.0; break;
			case 3: dir[0] = 0.0; dir[1] = -2.0; break;
			case 4: dir[0] = 2.0; dir[1] = 2.0; break;
			case 5: dir[0] = -2.0; dir[1] = 2.0; break;
			case 6: dir[0] = 2.0; dir[1] = -2.0; break;
			case 7: dir[0] = -2.0; dir[1] = -2.0;
		}
		pushEntity(ent, dir);
		ent.v_float[pr.entvars.velocity] = oldvel[0];
		ent.v_float[pr.entvars.velocity1] = oldvel[1];
		ent.v_float[pr.entvars.velocity2] = 0.0;
		clip = flyMove(ent, 0.1);
		if ((Math.abs(oldorg[1] - ent.v_float[pr.entvars.origin1]) > 4.0)
			|| (Math.abs(oldorg[0] - ent.v_float[pr.entvars.origin]) > 4.0))
			return clip;
		ed.setVector(ent, pr.entvars.origin, oldorg);
	}
	ed.setVector(ent, pr.entvars.velocity, vec.origin);
	return 7;
};

const walkMove = function (ent: Edict) {
	var oldonground = ent.v_float[pr.entvars.flags] & FL.onground;
	ent.v_float[pr.entvars.flags] ^= oldonground;
	var oldorg = ed.vector(ent, pr.entvars.origin, vec.scratch());
	var oldvel = ed.vector(ent, pr.entvars.velocity, vec.scratch());
	var clip = flyMove(ent, host.state.frametime);
	if ((clip & 2) === 0)
		return;
	if ((oldonground === 0) && (ent.v_float[pr.entvars.waterlevel] === 0.0))
		return;
	if (ent.v_float[pr.entvars.movetype] !== MOVE_TYPE.walk)
		return;
	if (cvr.nostep.value !== 0)
		return;
	if ((state.player.v_float[pr.entvars.flags] & FL.waterjump) !== 0)
		return;
	var nosteporg = ed.vector(ent, pr.entvars.origin, vec.scratch());
	var nostepvel = ed.vector(ent, pr.entvars.velocity, vec.scratch());
	ed.setVector(ent, pr.entvars.origin, oldorg);
	var stepUp: V3 = vec.scratch();
	stepUp[0] = 0.0; stepUp[1] = 0.0; stepUp[2] = 18.0;
	pushEntity(ent, stepUp);
	ent.v_float[pr.entvars.velocity] = oldvel[0];
	ent.v_float[pr.entvars.velocity1] = oldvel[1];
	ent.v_float[pr.entvars.velocity2] = 0.0;
	clip = flyMove(ent, host.state.frametime);
	if (clip !== 0) {
		if ((Math.abs(oldorg[1] - ent.v_float[pr.entvars.origin1]) < 0.03125)
			&& (Math.abs(oldorg[0] - ent.v_float[pr.entvars.origin]) < 0.03125))
			clip = tryUnstick(ent, oldvel);
		if ((clip & 2) !== 0)
			wallFriction(ent, state.steptrace);
	}
	var stepDown: V3 = vec.scratch();
	stepDown[0] = 0.0; stepDown[1] = 0.0; stepDown[2] = oldvel[2] * host.state.frametime - 18.0;
	var downtrace = pushEntity(ent, stepDown);
	if (downtrace.plane.normal[2] > 0.7) {
		if (ent.v_float[pr.entvars.solid] === SOLID.bsp) {
			ent.v_float[pr.entvars.flags] |= FL.onground;
			ent.v_int[pr.entvars.groundentity] = downtrace.ent.num;
		}
		return;
	}
	ed.setVector(ent, pr.entvars.origin, nosteporg);
	ed.setVector(ent, pr.entvars.velocity, nostepvel);
};

let inTest: boolean = false
const physics_Client = function (ent: Edict) {
	try {
		if (state.svs.clients[ent.num - 1].active !== true)
			return;
		pr.state.globals_float[pr.globalvars.time] = state.server.time;
		pr.state.globals_int[pr.globalvars.self] = ent.num;
		pr.executeProgram(pr.state.globals_int[pr.globalvars.PlayerPreThink]);
		checkVelocity(ent);
		var movetype = ent.v_float[pr.entvars.movetype] >> 0;
		if ((movetype === MOVE_TYPE.toss) || (movetype === MOVE_TYPE.bounce) || (movetype === MOVE_TYPE.bouncemissile))
			physics_Toss(ent);
		else {
			if (runThink(ent) !== true)
				return;
			switch (movetype) {
				case MOVE_TYPE.none:
					break;
				case MOVE_TYPE.walk:
					// FTE_ENT_SKIN_CONTENTS: no gravity while on a ladder (QSS-M sv_phys.c ~1300,
					// `if (!sv_player->onladder) SV_AddGravity`). checkWater sets onladder, so it
					// must be evaluated first — the && chain already guarantees that.
					if ((checkWater(ent) !== true) && ((ent.v_float[pr.entvars.flags] & FL.waterjump) === 0) && !ent.onladder)
						addGravity(ent);
					checkStuck(ent);
					inTest = true
					walkMove(ent);
					inTest = false
					break;
				case MOVE_TYPE.fly:
					flyMove(ent, host.state.frametime);
					break;
				case MOVE_TYPE.noclip:
					ent.v_float[pr.entvars.origin] += host.state.frametime * ent.v_float[pr.entvars.velocity];
					ent.v_float[pr.entvars.origin1] += host.state.frametime * ent.v_float[pr.entvars.velocity1];
					ent.v_float[pr.entvars.origin2] += host.state.frametime * ent.v_float[pr.entvars.velocity2];
					break;
				default:
					sys.error('SV.Physics_Client: bad movetype ' + movetype);
			}
		}
		linkEdict(ent, true);
		pr.state.globals_float[pr.globalvars.time] = state.server.time;
		pr.state.globals_int[pr.globalvars.self] = ent.num;
		pr.executeProgram(pr.state.globals_int[pr.globalvars.PlayerPostThink]);

	}
	finally 
	{
		inTest = false
	}
};

// A moving object that doesn't obey physics: integrate avelocity/velocity every
// server frame so cameras and other scripted movers pan/glide smoothly. (QSS-M
// SV_Physics_Noclip) Without this, MOVETYPE_NOCLIP entities only move when their
// QC think fires, so avelocity/velocity-driven motion steps at the think rate.
const physics_Noclip = function (ent: Edict) {
	if (runThink(ent) !== true)
		return;
	ent.v_float[pr.entvars.angles] += host.state.frametime * ent.v_float[pr.entvars.avelocity];
	ent.v_float[pr.entvars.angles1] += host.state.frametime * ent.v_float[pr.entvars.avelocity1];
	ent.v_float[pr.entvars.angles2] += host.state.frametime * ent.v_float[pr.entvars.avelocity2];
	ent.v_float[pr.entvars.origin] += host.state.frametime * ent.v_float[pr.entvars.velocity];
	ent.v_float[pr.entvars.origin1] += host.state.frametime * ent.v_float[pr.entvars.velocity1];
	ent.v_float[pr.entvars.origin2] += host.state.frametime * ent.v_float[pr.entvars.velocity2];
	linkEdict(ent, false);
};

const checkWaterTransition = function (ent: Edict) {
	var cont = pointContents(ed.vector(ent, pr.entvars.origin, vec.scratch()));
	if (ent.v_float[pr.entvars.watertype] === 0.0) {
		ent.v_float[pr.entvars.watertype] = cont;
		ent.v_float[pr.entvars.waterlevel] = 1.0;
		return;
	}
	if (cont <= mod.CONTENTS.water) {
		if (ent.v_float[pr.entvars.watertype] === mod.CONTENTS.empty && cvr.sound_watersplash.string.length !== 0)
			startSound(ent, 0, cvr.sound_watersplash.string, 255, 1.0);
		ent.v_float[pr.entvars.watertype] = cont;
		ent.v_float[pr.entvars.waterlevel] = 1.0;
		return;
	}
	if (ent.v_float[pr.entvars.watertype] !== mod.CONTENTS.empty && cvr.sound_watersplash.string.length !== 0)
		startSound(ent, 0, cvr.sound_watersplash.string, 255, 1.0);
	ent.v_float[pr.entvars.watertype] = mod.CONTENTS.empty;
	ent.v_float[pr.entvars.waterlevel] = cont;
};

const physics_Toss = function (ent: Edict) {
	if (runThink(ent) !== true)
		return;
	if ((ent.v_float[pr.entvars.flags] & FL.onground) !== 0)
		return;
	checkVelocity(ent);
	var movetype = ent.v_float[pr.entvars.movetype];
	if ((movetype !== MOVE_TYPE.fly) && (movetype !== MOVE_TYPE.flymissile))
		addGravity(ent);
	ent.v_float[pr.entvars.angles] += host.state.frametime * ent.v_float[pr.entvars.avelocity];
	ent.v_float[pr.entvars.angles1] += host.state.frametime * ent.v_float[pr.entvars.avelocity1];
	ent.v_float[pr.entvars.angles2] += host.state.frametime * ent.v_float[pr.entvars.avelocity2];
	var pushVel: V3 = vec.scratch();
	pushVel[0] = ent.v_float[pr.entvars.velocity] * host.state.frametime;
	pushVel[1] = ent.v_float[pr.entvars.velocity1] * host.state.frametime;
	pushVel[2] = ent.v_float[pr.entvars.velocity2] * host.state.frametime;
	var trace = pushEntity(ent, pushVel);
	if ((trace.fraction === 1.0) || (ent.free === true))
		return;
	// QSS-M sv_phys.c:1460-1466: only the backoff sees bouncemissile coerced to bounce under
	// qcvm->brokenbouncemissile (rerelease gibs want 1.5, DP's bouncemissile 2). Gravity above
	// and the ground-stop below keep reading the raw movetype, as QSS-M does.
	var bouncetype = ((movetype === MOVE_TYPE.bouncemissile) && pr.state.rerelease) ? MOVE_TYPE.bounce : movetype;
	var backoff = (bouncetype === MOVE_TYPE.bounce) ? 1.5 : ((bouncetype === MOVE_TYPE.bouncemissile) ? 2.0 : 1.0);
	const velocity:V3 = vec.scratch();
	clipVelocity(ed.vector(ent, pr.entvars.velocity, vec.scratch()), trace.plane.normal, velocity, backoff);
	ed.setVector(ent, pr.entvars.velocity, velocity);
	if (trace.plane.normal[2] > 0.7) {
		if ((ent.v_float[pr.entvars.velocity2] < 60.0) || (movetype !== MOVE_TYPE.bounce)) {
			ent.v_float[pr.entvars.flags] |= FL.onground;
			ent.v_int[pr.entvars.groundentity] = trace.ent.num;
			ent.v_float[pr.entvars.velocity] = ent.v_float[pr.entvars.velocity1] = ent.v_float[pr.entvars.velocity2] = 0.0;
			ent.v_float[pr.entvars.avelocity] = ent.v_float[pr.entvars.avelocity1] = ent.v_float[pr.entvars.avelocity2] = 0.0;
		}
	}
	checkWaterTransition(ent);
};

const physics_Step = function (ent: Edict) {
	if ((ent.v_float[pr.entvars.flags] & (FL.onground + FL.fly + FL.swim)) === 0) {
		var hitsound = (ent.v_float[pr.entvars.velocity2] < (cvr.gravity.value * -0.1));
		addGravity(ent);
		checkVelocity(ent);
		flyMove(ent, host.state.frametime);
		linkEdict(ent, true);
		if (((ent.v_float[pr.entvars.flags] & FL.onground) !== 0) && (hitsound === true) && cvr.sound_land.string.length !== 0)
			startSound(ent, 0, cvr.sound_land.string, 255, 1.0);
	}
	runThink(ent);
	checkWaterTransition(ent);
};


// user

const setIdealPitch = function () {
	var ent = state.player;
	if ((ent.v_float[pr.entvars.flags] & FL.onground) === 0)
		return;
	var angleval = ent.v_float[pr.entvars.angles1] * (Math.PI / 180.0);
	var sinval = Math.sin(angleval);
	var cosval = Math.cos(angleval);
	var top: V3 = vec.scratch();
	top[0] = 0.0; top[1] = 0.0; top[2] = ent.v_float[pr.entvars.origin2] + ent.v_float[pr.entvars.view_ofs2];
	var bottom: V3 = vec.scratch();
	bottom[0] = 0.0; bottom[1] = 0.0; bottom[2] = top[2] - 160.0;
	var i, tr, z = state.idealPitchZ;
	for (i = 0; i < 6; ++i) {
		top[0] = bottom[0] = ent.v_float[pr.entvars.origin] + cosval * (i + 3) * 12.0;
		top[1] = bottom[1] = ent.v_float[pr.entvars.origin1] + sinval * (i + 3) * 12.0;
		tr = move(top, vec.origin, vec.origin, bottom, 1, ent, state.traceIdealPitch);
		if ((tr.allsolid === true) || (tr.fraction === 1.0))
			return;
		z[i] = top[2] - tr.fraction * 160.0;
	}
	var dir = 0.0, step, steps = 0;
	for (i = 1; i < 6; ++i) {
		step = z[i] - z[i - 1];
		if ((step > -0.1) && (step < 0.1))
			continue;
		if ((dir !== 0.0) && (((step - dir) > 0.1) || ((step - dir) < -0.1)))
			return;
		++steps;
		dir = step;
	}
	if (dir === 0.0) {
		ent.v_float[pr.entvars.idealpitch] = 0.0;
		return;
	}
	if (steps >= 2)
		ent.v_float[pr.entvars.idealpitch] = -dir * cvr.idealpitchscale.value;
};

const userFriction = function () {
	var ent = state.player;
	var vel0 = ent.v_float[pr.entvars.velocity], vel1 = ent.v_float[pr.entvars.velocity1];
	var speed = Math.sqrt(vel0 * vel0 + vel1 * vel1);
	if (speed === 0.0)
		return;
	var start: V3 = vec.scratch();
	start[0] = ent.v_float[pr.entvars.origin] + vel0 / speed * 16.0;
	start[1] = ent.v_float[pr.entvars.origin1] + vel1 / speed * 16.0;
	start[2] = ent.v_float[pr.entvars.origin2] + ent.v_float[pr.entvars.mins2];
	var friction = cvr.friction.value;
	var ufEnd = vec.scratch();
	ufEnd[0] = start[0]; ufEnd[1] = start[1]; ufEnd[2] = start[2] - 34.0;
	if (move(start, vec.origin, vec.origin, ufEnd, 1, ent, state.traceUserFriction).fraction === 1.0)
		friction *= cvr.edgefriction.value;
	var newspeed = speed - host.state.frametime * (speed < cvr.stopspeed.value ? cvr.stopspeed.value : speed) * friction;
	if (newspeed < 0.0)
		newspeed = 0.0;
	newspeed /= speed;
	ent.v_float[pr.entvars.velocity] *= newspeed;
	ent.v_float[pr.entvars.velocity1] *= newspeed;
	ent.v_float[pr.entvars.velocity2] *= newspeed;
};

const accelerate = function (wishvel: V3, air: boolean, wishdir: V3, wishspeed: number) {
	var wishAir, addspeed, ent = state.player;
	if (air) {
		wishAir = vec.normalize(wishvel);
		if (wishAir > 30)
			wishAir = 30;

		addspeed = wishAir - (ent.v_float[pr.entvars.velocity] * wishvel[0]
			+ ent.v_float[pr.entvars.velocity1] * wishvel[1]
			+ ent.v_float[pr.entvars.velocity2] * wishvel[2]);

	} else {
		addspeed = wishspeed - (ent.v_float[pr.entvars.velocity] * wishdir[0]
			+ ent.v_float[pr.entvars.velocity1] * wishdir[1]
			+ ent.v_float[pr.entvars.velocity2] * wishdir[2]);
	}
	if (addspeed <= 0)
		return;
	var accelspeed = cvr.accelerate.value * host.state.frametime * wishspeed;
	if (accelspeed > addspeed)
		accelspeed = addspeed;

	var velToMult = air ? wishvel : wishdir;

	ent.v_float[pr.entvars.velocity] += accelspeed * velToMult[0];
	ent.v_float[pr.entvars.velocity1] += accelspeed * velToMult[1];
	ent.v_float[pr.entvars.velocity2] += accelspeed * velToMult[2];
};

const waterMove = function () {
	var ent = state.player, _cmd = host.state.client.cmd;
	var forward: V3 = vec.scratch(), right: V3 = vec.scratch();
	vec.angleVectors(ed.vector(ent, pr.entvars.v_angle, vec.scratch()), forward, right, null);
	var wishvel: V3 = vec.scratch();
	wishvel[0] = forward[0] * _cmd.forwardmove + right[0] * _cmd.sidemove;
	wishvel[1] = forward[1] * _cmd.forwardmove + right[1] * _cmd.sidemove;
	wishvel[2] = forward[2] * _cmd.forwardmove + right[2] * _cmd.sidemove;
	if (ent.onladder) {
		wishvel[2] *= 1.0 + Math.abs(wishvel[2] / 200.0) * 9.0; // exaggerate vertical movement
		if (ent.v_float[pr.entvars.button2] !== 0.0)
			wishvel[2] += 400.0; // jump climbs off the ladder
	}
	if ((_cmd.forwardmove === 0.0) && (_cmd.sidemove === 0.0) && (_cmd.upmove === 0.0) && !ent.onladder)
		wishvel[2] -= 60.0;
	else
		wishvel[2] += _cmd.upmove;
	var wishspeed = Math.sqrt(wishvel[0] * wishvel[0] + wishvel[1] * wishvel[1] + wishvel[2] * wishvel[2]);
	var scale;
	if (wishspeed > cvr.maxspeed.value) {
		scale = cvr.maxspeed.value / wishspeed;
		wishvel[0] *= scale;
		wishvel[1] *= scale;
		wishvel[2] *= scale;
		wishspeed = cvr.maxspeed.value;
	}
	wishspeed *= 0.7;
	var speed = Math.sqrt(ent.v_float[pr.entvars.velocity] * ent.v_float[pr.entvars.velocity]
		+ ent.v_float[pr.entvars.velocity1] * ent.v_float[pr.entvars.velocity1]
		+ ent.v_float[pr.entvars.velocity2] * ent.v_float[pr.entvars.velocity2]
	), newspeed;
	if (speed !== 0.0) {
		newspeed = speed - host.state.frametime * speed * cvr.friction.value;
		if (newspeed < 0.0)
			newspeed = 0.0;
		scale = newspeed / speed;
		ent.v_float[pr.entvars.velocity] *= scale;
		ent.v_float[pr.entvars.velocity1] *= scale;
		ent.v_float[pr.entvars.velocity2] *= scale;
	}
	else
		newspeed = 0.0;
	if (wishspeed === 0.0)
		return;
	var addspeed = wishspeed - newspeed;
	if (addspeed <= 0.0)
		return;
	var accelspeed = cvr.accelerate.value * wishspeed * host.state.frametime;
	if (accelspeed > addspeed)
		accelspeed = addspeed;
	ent.v_float[pr.entvars.velocity] += accelspeed * (wishvel[0] / wishspeed);
	ent.v_float[pr.entvars.velocity1] += accelspeed * (wishvel[1] / wishspeed);
	ent.v_float[pr.entvars.velocity2] += accelspeed * (wishvel[2] / wishspeed);
};

const waterJump = function () {
	var ent = state.player;
	if ((state.server.time > ent.v_float[pr.entvars.teleport_time]) || (ent.v_float[pr.entvars.waterlevel] === 0.0)) {
		ent.v_float[pr.entvars.flags] &= (~FL.waterjump >>> 0);
		ent.v_float[pr.entvars.teleport_time] = 0.0;
	}
	ent.v_float[pr.entvars.velocity] = ent.v_float[pr.entvars.movedir];
	ent.v_float[pr.entvars.velocity1] = ent.v_float[pr.entvars.movedir1];
};

const airMove = function () {
	var ent = state.player;
	var _cmd = host.state.client.cmd;
	var forward: V3 = vec.scratch(), right: V3 = vec.scratch();

	vec.angleVectors(ed.vector(ent, pr.entvars.angles, vec.scratch()), forward, right, null);

	var fmove = _cmd.forwardmove;
	var smove = _cmd.sidemove;

	if ((state.server.time < ent.v_float[pr.entvars.teleport_time]) && (fmove < 0.0))
		fmove = 0.0;

	var wishvel: V3 = vec.scratch();
	wishvel[0] = forward[0] * fmove + right[0] * smove;
	wishvel[1] = forward[1] * fmove + right[1] * smove;
	wishvel[2] = ((ent.v_float[pr.entvars.movetype] >> 0) !== MOVE_TYPE.walk) ? _cmd.upmove : 0.0;

	var wishdir: V3 = vec.scratch();
	vec.copy(wishvel, wishdir);
	var wishspeed = vec.normalize(wishdir);
	var scaler = (cvr.maxspeed.value / wishspeed);
	if (wishspeed > cvr.maxspeed.value) {
		wishvel[0] = wishvel[0] * scaler;
		wishvel[1] = wishvel[1] * scaler;
		wishvel[2] = wishvel[2] * scaler;
		wishspeed = cvr.maxspeed.value;
	}

	if (ent.v_float[pr.entvars.movetype] === MOVE_TYPE.noclip)
		ed.setVector(ent, pr.entvars.velocity, wishvel);
	else if ((ent.v_float[pr.entvars.flags] & FL.onground) !== 0) {
		userFriction() // wishvel); original has this param. Fn doesn't take one.
		accelerate(wishvel, false, wishdir, wishspeed);
	}
	else{
		accelerate(wishvel, true, wishdir, wishspeed);
	}
};

// Authoritative view-roll from strafing velocity, written into the player's
// angles2 so other clients see the lean. Same math as v.calcRoll (which the
// local client also applies to its own view); the server owns the
// cl_rollangle/cl_rollspeed cvars (registered in init) so it needs no view module.
const calcRoll = function (angles: V3, velocity: V3): number {
	const right = vec.scratch();
	vec.angleVectors(angles, null, right, null);
	var side = velocity[0] * right[0] + velocity[1] * right[1] + velocity[2] * right[2];
	const sign = side < 0.0 ? -1.0 : 1.0;
	side = Math.abs(side);
	if (side < cvr.rollspeed.value)
		return side * sign * cvr.rollangle.value / cvr.rollspeed.value;
	return cvr.rollangle.value * sign;
};

const clientThink = function () {
	var ent = state.player;

	if (ent.v_float[pr.entvars.movetype] === MOVE_TYPE.none)
		return;

	var punchangle = ed.vector(ent, pr.entvars.punchangle, vec.scratch());
	var len = vec.normalize(punchangle) - 10.0 * host.state.frametime;
	if (len < 0.0)
		len = 0.0;
	ent.v_float[pr.entvars.punchangle] = punchangle[0] * len;
	ent.v_float[pr.entvars.punchangle1] = punchangle[1] * len;
	ent.v_float[pr.entvars.punchangle2] = punchangle[2] * len;

	if (ent.v_float[pr.entvars.health] <= 0.0)
		return;

	ent.v_float[pr.entvars.angles2] = calcRoll(ed.vector(ent, pr.entvars.angles, vec.scratch()), ed.vector(ent, pr.entvars.velocity, vec.scratch())) * 4.0;
	if (state.player.v_float[pr.entvars.fixangle] === 0.0) {
		ent.v_float[pr.entvars.angles] = (ent.v_float[pr.entvars.v_angle] + ent.v_float[pr.entvars.punchangle]) / -3.0;
		ent.v_float[pr.entvars.angles1] = ent.v_float[pr.entvars.v_angle1] + ent.v_float[pr.entvars.punchangle1];
	}

	if ((ent.v_float[pr.entvars.flags] & FL.waterjump) !== 0)
		waterJump();
	else if (((ent.v_float[pr.entvars.waterlevel] >= 2.0) || ent.onladder) && (ent.v_float[pr.entvars.movetype] !== MOVE_TYPE.noclip))
		waterMove();
	else
		airMove();
};

const readClientMove = function () {
	var client = host.state.client;
	client.ping_times[client.num_pings++ & 15] = state.server.time - msg.readFloat();
	if (state.server.protocol === protocol.fitzquake || state.server.protocol === protocol.rmq) {
		client.edict.v_float[pr.entvars.v_angle] = msg.readAngle16();
		client.edict.v_float[pr.entvars.v_angle1] = msg.readAngle16();
		client.edict.v_float[pr.entvars.v_angle2] = msg.readAngle16();
	} else {
		client.edict.v_float[pr.entvars.v_angle] = msg.readAngle(state.server.protocolFlags);
		client.edict.v_float[pr.entvars.v_angle1] = msg.readAngle(state.server.protocolFlags);
		client.edict.v_float[pr.entvars.v_angle2] = msg.readAngle(state.server.protocolFlags);
	}
	client.cmd.forwardmove = msg.readShort();
	client.cmd.sidemove = msg.readShort();
	client.cmd.upmove = msg.readShort();
	var i = msg.readByte();
	client.edict.v_float[pr.entvars.button0] = i & 1;
	client.edict.v_float[pr.entvars.button2] = (i & 2) >> 1;
	i = msg.readByte();
	if (i !== 0)
		client.edict.v_float[pr.entvars.impulse] = i;
};

const readClientMessage = function () {
	var ret, _cmd, s, i;
	var cmds = [
		'status',
		'god',
		'notarget',
		'fly',
		'name',
		'noclip',
		'say',
		'say_team',
		'tell',
		'color',
		'kill',
		'pause',
		'spawn',
		'begin',
		'prespawn',
		'kick',
		'ping',
		'give',
		'ban'
	];
	do {
		ret = net.getMessage(host.state.client.netconnection);
		if (ret === -1) {
			sys.print('SV.ReadClientMessage: NET.GetMessage failed\n');
			return;
		}
		if (ret === 0)
			return true;
		msg.beginReading();
		for (; ;) {
			if (host.state.client.active !== true)
				return;
			if (msg.state.badread === true) {
				sys.print('SV.ReadClientMessage: badread\n');
				return;
			}
			_cmd = msg.readChar();
			if (_cmd === -1) {
				ret = 1;
				break;
			}
			if (_cmd === protocol.CLC.nop)
				continue;
			if (_cmd === protocol.CLC.stringcmd) {
				s = msg.readString();
				for (i = 0; i < cmds.length; ++i) {
					if (s.substring(0, cmds[i].length).toLowerCase() !== cmds[i])
						continue;
					const r = cmd.executeString(s, cmd.CMD_SOURCE.src_client);
					if (r != null && typeof (r as any).then === 'function') return true;
					break;
				}
				if (i === cmds.length)
					con.dPrint(getClientName(host.state.client) + ' tried to ' + s);
			}
			else if (_cmd === protocol.CLC.disconnect)
				return;
			else if (_cmd === protocol.CLC.move)
				readClientMove();
			else {
				sys.print('SV.ReadClientMessage: unknown command char\n');
				return;
			}
		}
	} while (ret === 1);
};

// world

const MOVE = {
	normal: 0,
	nomonsters: 1,
	missile: 2
};

const initBoxHull = function () {
	state.box_clipnodes = [];
	state.box_planes = [];
	state.box_hull = {
		clipnodes: state.box_clipnodes,
		planes: state.box_planes,
		firstclipnode: 0,
		lastclipnode: 5,
		clip_mins: vec.emptyV3(),
		clip_maxs: vec.emptyV3()
	};
	var i, node: ClipNode, plane: Plane;
	for (i = 0; i <= 5; ++i) {
		node = {
			planenum: i,
			children: [0,0]
		};
		state.box_clipnodes[i] = node;
		node.children[i & 1] = mod.CONTENTS.empty;
		if (i !== 5)
			node.children[1 - (i & 1)] = i + 1;
		else
			node.children[1 - (i & 1)] = mod.CONTENTS.solid;
		plane = {
			type: i >> 1,
			normal: [0.0, 0.0, 0.0],
			dist: 0.0,
			signbits: 0
		};
		plane.normal[i >> 1] = 1.0;
		state.box_planes[i] = plane;
	}
};

const hullForEntity = function (ent: Edict, mins: V3, maxs: V3, offset: V3) {
	if (ent.v_float[pr.entvars.solid] !== SOLID.bsp) {
		state.box_planes[0].dist = ent.v_float[pr.entvars.maxs] - mins[0];
		state.box_planes[1].dist = ent.v_float[pr.entvars.mins] - maxs[0];
		state.box_planes[2].dist = ent.v_float[pr.entvars.maxs1] - mins[1];
		state.box_planes[3].dist = ent.v_float[pr.entvars.mins1] - maxs[1];
		state.box_planes[4].dist = ent.v_float[pr.entvars.maxs2] - mins[2];
		state.box_planes[5].dist = ent.v_float[pr.entvars.mins2] - maxs[2];
		offset[0] = ent.v_float[pr.entvars.origin];
		offset[1] = ent.v_float[pr.entvars.origin1];
		offset[2] = ent.v_float[pr.entvars.origin2];
		return state.box_hull;
	}
	if (ent.v_float[pr.entvars.movetype] !== MOVE_TYPE.push)
		sys.error('SOLID_BSP without MOVETYPE_PUSH');
	var model = state.server.models[ent.v_float[pr.entvars.modelindex] >> 0];
	if (model == null)
		sys.error('MOVETYPE_PUSH with a non bsp model');
	if (model.type !== mod.TYPE.brush)
		sys.error('MOVETYPE_PUSH with a non bsp model');
	var size = maxs[0] - mins[0];
	var hull;
	if (size < 3.0)
		hull = model.hulls[0];
	else if (size <= 32.0)
		hull = model.hulls[1];
	else
		hull = model.hulls[2];
	offset[0] = hull.clip_mins[0] - mins[0] + ent.v_float[pr.entvars.origin];
	offset[1] = hull.clip_mins[1] - mins[1] + ent.v_float[pr.entvars.origin1];
	offset[2] = hull.clip_mins[2] - mins[2] + ent.v_float[pr.entvars.origin2];
	return hull;
};

// A circular link_t sentinel head: prev/next point at itself (empty list).
const makeLink = function (): Link {
	const l: Link = { prev: null, next: null, ent: null };
	l.prev = l.next = l;
	return l;
};

const createAreaNode = function (depth: number, mins: V3, maxs: V3): AreaNode {
	const anode: AreaNode = { trigger_edicts: makeLink(), solid_edicts: makeLink() };
	state.areanodes[state.areanodes.length++] = anode;

	if (depth === 4) {
		anode.axis = -1;
		anode.children = [];
		return anode;
	}

	anode.axis = (maxs[0] - mins[0]) > (maxs[1] - mins[1]) ? 0 : 1;
	anode.dist = 0.5 * (maxs[anode.axis] + mins[anode.axis]);

	var maxs1: V3 = [maxs[0], maxs[1], maxs[2]];
	var mins2: V3 = [mins[0], mins[1], mins[2]];
	maxs1[anode.axis] = mins2[anode.axis] = anode.dist;
	anode.children = [createAreaNode(depth + 1, mins2, maxs), createAreaNode(depth + 1, mins, maxs1)];
	return anode;
};

export const unlinkEdict = function (ent: Edict) {
	if (ent.area.prev != null)
		ent.area.prev.next = ent.area.next;
	if (ent.area.next != null)
		ent.area.next.prev = ent.area.prev;
	ent.area.prev = ent.area.next = null;
};
/*
====================
SV_AreaTriggerEdicts

Spike -- just builds a list of entities within the area, rather than walking
them and risking the list getting corrupt.
====================
*/
const areaTriggerEdicts = (ent: Edict, node: AreaNode, list: Edict[]) => {
	var next: Link | null, touch: Edict

	// touch linked edicts
	for (var l = node.trigger_edicts.next!; l !== node.trigger_edicts; l = next!) {
		next = l.next;
		touch = l.ent!;
		if (touch === ent)
			continue;
		if ((touch.v_int[pr.entvars.touch] === 0) || (touch.v_float[pr.entvars.solid] !== SOLID.trigger))
			continue;
		if ((ent.v_float[pr.entvars.absmin] > touch.v_float[pr.entvars.absmax]) ||
			(ent.v_float[pr.entvars.absmin1] > touch.v_float[pr.entvars.absmax1]) ||
			(ent.v_float[pr.entvars.absmin2] > touch.v_float[pr.entvars.absmax2]) ||
			(ent.v_float[pr.entvars.absmax] < touch.v_float[pr.entvars.absmin]) ||
			(ent.v_float[pr.entvars.absmax1] < touch.v_float[pr.entvars.absmin1]) ||
			(ent.v_float[pr.entvars.absmax2] < touch.v_float[pr.entvars.absmin2]))
			continue;

		list.push(touch)
	}

	if (node.axis === -1)
		return;
	if (ent.v_float[pr.entvars.absmax + node.axis] > node.dist)
		areaTriggerEdicts(ent, node.children[0], list);
	if (ent.v_float[pr.entvars.absmin + node.axis] < node.dist)
		areaTriggerEdicts(ent, node.children[1], list);
}

// FTE-style pusher candidate query (FTE sv_phys.c SV_PushMove over
// World_AreaEdicts): gather the area-linked edicts overlapping the pusher's
// swept bounds instead of scanning every edict per pusher per tick — on maps
// with thousands of edicts and dozens of constantly-active movers the full
// scan dominated the server tick. The per-candidate logic in pushMove /
// pushMoveAngles is unchanged, so anything gathered behaves exactly as before.
const collectPushCandidates = (node: AreaNode, mins: V3, maxs: V3, list: Edict[]) => {
	var next: Link | null, check: Edict
	for (var l = node.solid_edicts.next!; l !== node.solid_edicts; l = next!) {
		next = l.next
		check = l.ent!
		if ((check.v_float[pr.entvars.absmin] >= maxs[0]) ||
			(check.v_float[pr.entvars.absmin1] >= maxs[1]) ||
			(check.v_float[pr.entvars.absmin2] >= maxs[2]) ||
			(check.v_float[pr.entvars.absmax] <= mins[0]) ||
			(check.v_float[pr.entvars.absmax1] <= mins[1]) ||
			(check.v_float[pr.entvars.absmax2] <= mins[2]))
			continue
		list.push(check)
	}
	for (l = node.trigger_edicts.next!; l !== node.trigger_edicts; l = next!) {
		next = l.next
		check = l.ent!
		if ((check.v_float[pr.entvars.absmin] >= maxs[0]) ||
			(check.v_float[pr.entvars.absmin1] >= maxs[1]) ||
			(check.v_float[pr.entvars.absmin2] >= maxs[2]) ||
			(check.v_float[pr.entvars.absmax] <= mins[0]) ||
			(check.v_float[pr.entvars.absmax1] <= mins[1]) ||
			(check.v_float[pr.entvars.absmax2] <= mins[2]))
			continue
		list.push(check)
	}
	if (node.axis === -1)
		return;
	if (maxs[node.axis] > node.dist)
		collectPushCandidates(node.children[0], mins, maxs, list);
	if (mins[node.axis] < node.dist)
		collectPushCandidates(node.children[1], mins, maxs, list);
}

// mins/maxs are the pusher's moved bounds (absbox + move); the query expands
// them to the union of before/after positions plus 1 unit so riders in surface
// contact are always gathered (their carry path in pushMove skips the bbox
// test). SOLID_NOT pushables (gibs, backpacks riding lifts) are skipped by
// linkEdict's area insert and come from the link-time registry instead — but the
// two sources OVERLAP (an edict demoted to SOLID_NOT without a relink is in both),
// so every insert is pushStamp-deduped. Riders whose
// groundentity is this pusher but who sit OUTSIDE the swept bounds (stale
// groundentity — SV_WalkMove's step-down settle is SV_PushEntity, which never
// updates groundentity, so stepping off a mover leaves it pointing at the
// mover) come from the rider-completion scan: vanilla SV_PushMove "definately"
// moves them with no bbox test, and QSS-M/Ironwail keep that full-scan
// semantics (the wasm sim does too — dropping them forked a plat rider-drag).
const gatherPushCandidates = (pusher: Edict, mins: V3, maxs: V3, move: V3): Edict[] => {
	const list = state.pushCandidates
	list.length = 0
	// persistent (not vec.scratch): pushMove runs from the direct physics() path
	// during spawnServer, outside the per-frame scratch reset — dozens of pushers
	// would exhaust the scratch pool
	const qmins = state.pushQueryMins, qmaxs = state.pushQueryMaxs
	for (var i = 0; i < 3; i++) {
		qmins[i] = mins[i] - (move[i] > 0 ? move[i] : 0) - 1
		qmaxs[i] = maxs[i] - (move[i] < 0 ? move[i] : 0) + 1
	}
	const seq = ++state.pushGatherSeq
	collectPushCandidates(state.areanodes[0], qmins, qmaxs, list)
	// Stamp the area results BEFORE consulting the registry, not after both: an edict
	// linked while non-SOLID_NOT and later demoted to SOLID_NOT by QC without a relink
	// (setting .solid alone never relinks) is STILL in its area chain while also being
	// in the registry — stamping afterwards let it enter the list twice, and QSS-M's
	// single `for (e=1; e<num_edicts; e++)` scan visits every edict exactly once, so
	// the duplicate meant two setMoved slots and two pushEntity calls (double
	// displacement, double touch/blocked QC) for one edict in one pushMove.
	for (i = 0; i < list.length; i++)
		list[i].pushStamp = seq
	const notLinked = state.solidNotPushables
	for (i = 0; i < notLinked.length; i++) {
		const nl = notLinked[i]
		if (nl.pushStamp === seq || nl.free === true)
			continue
		if (nl.v_float[pr.entvars.solid] === SOLID.not) {
			nl.pushStamp = seq
			list.push(nl)
		}
	}
	// Rider-completion scan (see header comment). Lean on purpose: two field reads
	// per edict, no bbox math, no candidate objects — pushMove's own gates re-check
	// free/movetype, so liberal inclusion here cannot change processing semantics.
	const edicts = state.server.edicts, ne = state.server.num_edicts, pnum = pusher.num
	for (i = 1; i < ne; i++) {
		const ed = edicts[i]
		if (ed.pushStamp === seq || ed.free === true)
			continue
		if ((ed.v_float[pr.entvars.flags] & FL.onground) !== 0 && ed.v_int[pr.entvars.groundentity] === pnum) {
			ed.pushStamp = seq
			list.push(ed)
		}
	}
	// Vanilla/QSS-M SV_PushMove scans `for (e = 1; e < num_edicts; e++)` — EDICT ORDER — and
	// processing order is load-bearing: the first blocked entity fires blocked() and aborts the
	// whole push, and crushing a corpse box or moving one rider changes the test for the next.
	// The area-tree gather yields tree-traversal order (same SET, different ORDER), which forked
	// a func_train's crush verdict against the vanilla-ordered wasm sim. Sort to edict order.
	// With the pushStamp dedup above, the result is exactly QSS-M's visit sequence: every
	// candidate at most once, ascending by edict number.
	list.sort((a, b) => a.num - b.num)
	return list
}

const touchLinks = function (ent: Edict, node: AreaNode) {
	var depth = state.touchDepth++, old_self, old_other
	var list = state.touchLists[depth]
	if (list == null)
		list = state.touchLists[depth] = []
	list.length = 0
	try {
		areaTriggerEdicts(ent, node, list)
		// Deterministic dispatch order (fix-#19 family): the collect order is area-chain
		// insertion history, which differs between this tree and the wasm sim's. When one
		// mover overlaps SEVERAL triggers (zombie entering the e1m7 exit: teleporter +
		// telefrag chain), the dispatch sequence decides how the QC chains interleave —
		// sort to edict order so both sims dispatch identically. Vanilla's own order is
		// chain-history luck; the wasm touchLinks applies the same rule.
		list.sort((a, b) => a.num - b.num)
		for (var i = 0; i < list.length; i++) {
			var touch = list[i]

			// re-validate in case of PR_ExecuteProgram having side effects that make
			// edicts later in the list no longer touch
			if (touch === ent)
				continue;
			if ((touch.v_int[pr.entvars.touch] === 0) || (touch.v_float[pr.entvars.solid] !== SOLID.trigger))
				continue;
			if ((ent.v_float[pr.entvars.absmin] > touch.v_float[pr.entvars.absmax]) ||
				(ent.v_float[pr.entvars.absmin1] > touch.v_float[pr.entvars.absmax1]) ||
				(ent.v_float[pr.entvars.absmin2] > touch.v_float[pr.entvars.absmax2]) ||
				(ent.v_float[pr.entvars.absmax] < touch.v_float[pr.entvars.absmin]) ||
				(ent.v_float[pr.entvars.absmax1] < touch.v_float[pr.entvars.absmin1]) ||
				(ent.v_float[pr.entvars.absmax2] < touch.v_float[pr.entvars.absmin2]))
				continue;
			old_self = pr.state.globals_int[pr.globalvars.self];
			old_other = pr.state.globals_int[pr.globalvars.other];
			pr.state.globals_int[pr.globalvars.self] = touch.num;
			pr.state.globals_int[pr.globalvars.other] = ent.num;
			pr.state.globals_float[pr.globalvars.time] = state.server.time;
			pr.executeProgram(touch.v_int[pr.entvars.touch]);
			pr.state.globals_int[pr.globalvars.self] = old_self;
			pr.state.globals_int[pr.globalvars.other] = old_other;
		}
	} finally {
		--state.touchDepth;
	}
};

const findTouchedLeafs = function (ent: Edict, node: Node) {
	if (node.contents === mod.CONTENTS.solid)
		return;

	if (node.contents < 0) {
		if (ent.leafnums.length === MAX_ENT_LEAFS)
			return;
		ent.leafnums[ent.leafnums.length] = node.num - 1;
		return;
	}

	// reuse persistent scratch — this recurses per node per entity per frame, so the
	// old [x,y,z] literals here were a major GC-garbage source (see perf profile)
	var mins = state.linkMins, maxs = state.linkMaxs;
	mins[0] = ent.v_float[pr.entvars.absmin]; mins[1] = ent.v_float[pr.entvars.absmin1]; mins[2] = ent.v_float[pr.entvars.absmin2];
	maxs[0] = ent.v_float[pr.entvars.absmax]; maxs[1] = ent.v_float[pr.entvars.absmax1]; maxs[2] = ent.v_float[pr.entvars.absmax2];
	var sides = vec.boxOnPlaneSide(mins, maxs, node.plane);
	if ((sides & 1) !== 0)
		findTouchedLeafs(ent, node.children[0] as Node);
	if ((sides & 2) !== 0)
		findTouchedLeafs(ent, node.children[1] as Node);
};

// Recompute absmin/absmax and rebuild ent.leafnums (the BSP leaves the entity touches),
// WITHOUT touching the area-tree solid/trigger chains. linkEdict uses it for the leaf half;
// the WASM backend calls it standalone (wasmServer.frame) to refresh leafnums for PVS culling
// (writeEntitiesToClient) after the sim has moved entities — the sim owns the area tree, so
// the JS chains must NOT be mutated per-frame (doing so corrupted them -> "trigger in
// clipping list" in setIdealPitch's trace).
export const refreshLeafs = function (ent: Edict) {
	// QSS-M world.c SV_LinkEdict order, literally: VectorAdd stores origin+mins/maxs into the
	// f32 fields FIRST, then the expansion adjusts the stored values in place — each axis gets
	// TWO f32 roundings. Folding the ±1 into one expression (single rounding) drifted absboxes
	// by one ulp vs the C (and vs the wasm sim once it mimics the same order); absboxes feed
	// trigger-touch overlap tests, so sub-ulp drift can flip a boundary touch.
	ent.v_float[pr.entvars.absmin] = ent.v_float[pr.entvars.origin] + ent.v_float[pr.entvars.mins];
	ent.v_float[pr.entvars.absmin1] = ent.v_float[pr.entvars.origin1] + ent.v_float[pr.entvars.mins1];
	ent.v_float[pr.entvars.absmin2] = ent.v_float[pr.entvars.origin2] + ent.v_float[pr.entvars.mins2];
	ent.v_float[pr.entvars.absmax] = ent.v_float[pr.entvars.origin] + ent.v_float[pr.entvars.maxs];
	ent.v_float[pr.entvars.absmax1] = ent.v_float[pr.entvars.origin1] + ent.v_float[pr.entvars.maxs1];
	ent.v_float[pr.entvars.absmax2] = ent.v_float[pr.entvars.origin2] + ent.v_float[pr.entvars.maxs2];

	if ((ent.v_float[pr.entvars.flags] & FL.item) !== 0) {
		ent.v_float[pr.entvars.absmin] -= 15.0;
		ent.v_float[pr.entvars.absmin1] -= 15.0;
		ent.v_float[pr.entvars.absmax] += 15.0;
		ent.v_float[pr.entvars.absmax1] += 15.0;
	}
	else {
		ent.v_float[pr.entvars.absmin] -= 1.0;
		ent.v_float[pr.entvars.absmin1] -= 1.0;
		ent.v_float[pr.entvars.absmin2] -= 1.0;
		ent.v_float[pr.entvars.absmax] += 1.0;
		ent.v_float[pr.entvars.absmax1] += 1.0;
		ent.v_float[pr.entvars.absmax2] += 1.0;
	}

	// reset in place; leafnums is rebuilt before writeEntitiesToClient reads it
	ent.leafnums.length = 0;
	if (ent.v_float[pr.entvars.modelindex] !== 0.0)
		findTouchedLeafs(ent, state.server.worldmodel.nodes[0]);
};

export const linkEdict = function (ent: Edict, touch_triggers: boolean = false) {
	if ((ent === state.server.edicts[0]) || (ent.free === true))
		return;
	unlinkEdict(ent);

	refreshLeafs(ent);

	if (ent.v_float[pr.entvars.solid] === SOLID.not) {
		// SOLID_NOT edicts skip the area chains, but pushers must still find the
		// pushable ones — register once for gatherPushCandidates (iteration
		// re-checks free/solid; movetype filter mirrors the pushMove rejects)
		const mt = ent.v_float[pr.entvars.movetype]
		if (ent.solidNotListed !== true && mt !== MOVE_TYPE.none && mt !== MOVE_TYPE.push && mt !== MOVE_TYPE.noclip) {
			ent.solidNotListed = true
			state.solidNotPushables.push(ent)
		}
		return;
	}

	var node = state.areanodes[0];
	for (; ;) {
		if (node.axis === -1)
			break;
		if (ent.v_float[pr.entvars.absmin + node.axis] > node.dist)
			node = node.children[0];
		else if (ent.v_float[pr.entvars.absmax + node.axis] < node.dist)
			node = node.children[1];
		else
			break;
	}

	var before = (ent.v_float[pr.entvars.solid] === SOLID.trigger) ? node.trigger_edicts : node.solid_edicts;
	ent.area.next = before;
	ent.area.prev = before.prev;
	ent.area.prev!.next = ent.area;
	ent.area.next!.prev = ent.area;

	ent.area.ent = ent;

	if (touch_triggers === true)
		touchLinks(ent, state.areanodes[0]);
};

const hullPointContents = function (hull: Hull, num: number, p: V3) {
	var d, node, plane;
	const flat = hull.flat;
	if (flat != null) {
		const clipPlane = flat.clipPlane, clipChildren = flat.clipChildren;
		const planeNormal = flat.planeNormal, planeDist = flat.planeDist, planeType = flat.planeType;
		for (; num >= 0;) {
			if ((num < hull.firstclipnode) || (num > hull.lastclipnode))
				sys.error('SV.HullPointContents: bad node number');
			const pn = clipPlane[num];
			const type = planeType[pn];
			if (type <= 2)
				d = p[type] - planeDist[pn];
			else
				d = planeNormal[pn * 3] * p[0] + planeNormal[pn * 3 + 1] * p[1] + planeNormal[pn * 3 + 2] * p[2] - planeDist[pn];
			if (d >= 0.0)
				num = clipChildren[num * 2];
			else
				num = clipChildren[num * 2 + 1];
		}
		return num;
	}
	for (; num >= 0;) {
		if ((num < hull.firstclipnode) || (num > hull.lastclipnode))
			sys.error('SV.HullPointContents: bad node number');
		node = hull.clipnodes[num];
		plane = hull.planes[node.planenum];
		if (plane.type <= 2)
			d = p[plane.type] - plane.dist;
		else
			d = plane.normal[0] * p[0] + plane.normal[1] * p[1] + plane.normal[2] * p[2] - plane.dist;
		if (d >= 0.0)
			num = node.children[0];
		else
			num = node.children[1];
	}
	return num;
};

export const pointContents = function (p: V3) {
	var cont = hullPointContents(state.server.worldmodel.hulls[0], 0, p);
	if ((cont <= mod.CONTENTS.current_0) && (cont >= mod.CONTENTS.current_down))
		return mod.CONTENTS.water;
	return cont;
};

// FTE_ENT_SKIN_CONTENTS: walks solid_edicts (same area-node tree as clipToLinks) looking
// for a SOLID_BSP entity with negative skin whose model overlaps box [mins,maxs] at p;
// its skin overrides `cont` when found. This is a content-classification query, not a
// swept collision trace, so it doesn't go through clipToLinks/clipMoveToEntity -- those
// deliberately skip these entities now (see clipToLinks) since they aren't solid to
// ordinary movement. Used only by checkWater (waterlevel + ladder detection).
const skinContentsAt = function (p: V3, mins: V3, maxs: V3, ignore: Edict, cont: number): number {
	// FTE_ENT_SKIN_CONTENTS: iterate ONLY the negative-skin SOLID_BSP edicts (state.skinContentsEnts,
	// rebuilt each physics frame). numSkinContents is normally 0 (no FTESKIN content brushes) -> this is
	// the vanilla no-op. When nonzero it is still a tiny handful, so we scan them directly instead of
	// walking the areanode tree over every solid entity (doors/platforms) just to skip past them.
	var ents = state.skinContentsEnts;
	var i, touch, skin, offset, local, hull;
	for (i = 0; i < state.numSkinContents; ++i) {
		touch = ents[i];
		if ((touch === ignore) || (touch.free === true) || (touch.v_float[pr.entvars.solid] !== SOLID.bsp))
			continue;
		skin = touch.v_float[pr.entvars.skin] >> 0;
		if (skin >= 0)
			continue;
		if ((p[0] + maxs[0] < touch.v_float[pr.entvars.absmin]) ||
			(p[1] + maxs[1] < touch.v_float[pr.entvars.absmin1]) ||
			(p[2] + maxs[2] < touch.v_float[pr.entvars.absmin2]) ||
			(p[0] + mins[0] > touch.v_float[pr.entvars.absmax]) ||
			(p[1] + mins[1] > touch.v_float[pr.entvars.absmax1]) ||
			(p[2] + mins[2] > touch.v_float[pr.entvars.absmax2]))
			continue;
		offset = vec.scratch();
		hull = hullForEntity(touch, mins, maxs, offset);
		local = vec.scratch();
		local[0] = p[0] - offset[0]; local[1] = p[1] - offset[1]; local[2] = p[2] - offset[2];
		if (hullPointContents(hull, hull.firstclipnode, local) === mod.CONTENTS.solid)
			cont = skin;
	}
	return cont;
};

// FTE_ENT_SKIN_CONTENTS: SV_PointContentsAllBsps -- world contents, overridden by an
// overlapping negative-skin SOLID_BSP entity's own skin value.
export const pointContentsAllBsps = function (p: V3, ignore: Edict) {
	if (state.numSkinContents === 0)
		return pointContents(p);
	return skinContentsAt(p, vec.origin, vec.origin, ignore, pointContents(p));
};

const testEntityPosition = function (ent: Edict) {
	var origin = ed.vector(ent, pr.entvars.origin, vec.scratch());
	return move(origin, ed.vector(ent, pr.entvars.mins, vec.scratch()), ed.vector(ent, pr.entvars.maxs, vec.scratch()), origin, 0, ent, state.traceTestPosition).startsolid;
};

// FTE_ENT_SKIN_CONTENTS: does `check`'s bbox overlap `pusher`'s hull? Contents pushers
// (skin < 0) are skipped by clipToLinks, so pusher rider-detection tests against the
// pusher's own hull directly (QSS-M SV_ClipMoveToEntity precision check, sv_phys.c ~806).
const pusherOverlaps = function (pusher: Edict, check: Edict) {
	var origin = ed.vector(check, pr.entvars.origin, vec.scratch());
	return clipMoveToEntity(pusher, origin, ed.vector(check, pr.entvars.mins, vec.scratch()), ed.vector(check, pr.entvars.maxs, vec.scratch()), origin, state.clipScratchTrace).startsolid === true;
};

export const recursiveHullCheck = function (hull:Hull, num: number, p1f: number, p2f: number, p1: V3, p2: V3, trace: Trace) : boolean {
	if (num < 0) {
		if (num !== mod.CONTENTS.solid) {
			trace.allsolid = false;
			if (num === mod.CONTENTS.empty)
				trace.inopen = true;
			else
				trace.inwater = true;
		}
		else
			trace.startsolid = true;
		return true;
	}

	if ((num < hull.firstclipnode) || (num > hull.lastclipnode))
		sys.error('SV.RecursiveHullCheck: bad node number');

	var t1, t2;
	var child0: number, child1: number;
	var nx: number, ny: number, nz: number, pdist: number;
	const flat = hull.flat;
	if (flat != null) {
		const pn = flat.clipPlane[num];
		child0 = flat.clipChildren[num * 2];
		child1 = flat.clipChildren[num * 2 + 1];
		pdist = flat.planeDist[pn];
		nx = flat.planeNormal[pn * 3];
		ny = flat.planeNormal[pn * 3 + 1];
		nz = flat.planeNormal[pn * 3 + 2];
		const ptype = flat.planeType[pn];
		if (ptype <= 2) {
			t1 = p1[ptype] - pdist;
			t2 = p2[ptype] - pdist;
		}
		else {
			t1 = nx * p1[0] + ny * p1[1] + nz * p1[2] - pdist;
			t2 = nx * p2[0] + ny * p2[1] + nz * p2[2] - pdist;
		}
	}
	else {
		const node = hull.clipnodes[num];
		const plane = hull.planes[node.planenum];
		child0 = node.children[0];
		child1 = node.children[1];
		pdist = plane.dist;
		nx = plane.normal[0];
		ny = plane.normal[1];
		nz = plane.normal[2];
		if (plane.type <= 2) {
			t1 = p1[plane.type] - pdist;
			t2 = p2[plane.type] - pdist;
		}
		else {
			t1 = nx * p1[0] + ny * p1[1] + nz * p1[2] - pdist;
			t2 = nx * p2[0] + ny * p2[1] + nz * p2[2] - pdist;
		}
	}

	if ((t1 >= 0.0) && (t2 >= 0.0))
		return recursiveHullCheck(hull, child0, p1f, p2f, p1, p2, trace);
	if ((t1 < 0.0) && (t2 < 0.0))
		return recursiveHullCheck(hull, child1, p1f, p2f, p1, p2, trace);

	var frac = (t1 + (t1 < 0.0 ? 0.03125 : -0.03125)) / (t1 - t2);

	if (frac < 0.0)
		frac = 0.0;
	else if (frac > 1.0)
		frac = 1.0;
	var midf = p1f + (p2f - p1f) * frac;
	var mid: V3 = vec.scratch();
	mid[0] = p1[0] + frac * (p2[0] - p1[0]);
	mid[1] = p1[1] + frac * (p2[1] - p1[1]);
	mid[2] = p1[2] + frac * (p2[2] - p1[2]);
	var side = t1 < 0.0 ? 1 : 0;

	if (recursiveHullCheck(hull, side === 0 ? child0 : child1, p1f, midf, p1, mid, trace) !== true)
		return false;

	if (hullPointContents(hull, side === 0 ? child1 : child0, mid) !== mod.CONTENTS.solid)
		return recursiveHullCheck(hull, side === 0 ? child1 : child0, midf, p2f, mid, p2, trace);

	if (trace.allsolid === true)
		return false;

	if (side === 0) {
		trace.plane.normal[0] = nx;
		trace.plane.normal[1] = ny;
		trace.plane.normal[2] = nz;
		trace.plane.dist = pdist;
	}
	else {
		trace.plane.normal[0] = -nx;
		trace.plane.normal[1] = -ny;
		trace.plane.normal[2] = -nz;
		trace.plane.dist = -pdist;
	}

	while (hullPointContents(hull, hull.firstclipnode, mid) === mod.CONTENTS.solid) {
		frac -= 0.1;
		if (frac < 0.0) {
			trace.fraction = midf;
			trace.endpos[0] = mid[0]; trace.endpos[1] = mid[1]; trace.endpos[2] = mid[2];
			con.dPrint('backup past 0\n');
			return false;
		}
		midf = p1f + (p2f - p1f) * frac;
		mid[0] = p1[0] + frac * (p2[0] - p1[0]);
		mid[1] = p1[1] + frac * (p2[1] - p1[1]);
		mid[2] = p1[2] + frac * (p2[2] - p1[2]);
	}
	trace.fraction = midf;
	trace.endpos[0] = mid[0]; trace.endpos[1] = mid[1]; trace.endpos[2] = mid[2];

	return false
};

const clipMoveToEntity = function (ent: Edict, start: V3, mins: V3, maxs: V3, end: V3, trace: Trace) {
	resetTrace(trace, end);
	var offset = vec.scratch();
	var hull = hullForEntity(ent, mins, maxs, offset);
	var adjStart = vec.scratch(), adjEnd = vec.scratch();
	adjStart[0] = start[0] - offset[0]; adjStart[1] = start[1] - offset[1]; adjStart[2] = start[2] - offset[2];
	adjEnd[0] = end[0] - offset[0]; adjEnd[1] = end[1] - offset[1]; adjEnd[2] = end[2] - offset[2];
	recursiveHullCheck(hull, hull.firstclipnode, 0.0, 1.0, adjStart, adjEnd, trace);

	if (trace.fraction !== 1.0) {
		trace.endpos[0] += offset[0];
		trace.endpos[1] += offset[1];
		trace.endpos[2] += offset[2];
	} 
	if ((trace.fraction < 1.0) || (trace.startsolid === true))
		trace.ent = ent;
	return trace;
};

const clipToLinks = function (node: AreaNode, clip: Clip) {
	var next, touch, solid, trace;
	for (var l = node.solid_edicts.next!; l !== node.solid_edicts; l = l.next!) {
		touch = l.ent!;
		solid = touch.v_float[pr.entvars.solid];
		if ((solid === SOLID.not) || (touch === clip.passedict))
			continue;
		if (solid === SOLID.trigger)
			sys.error('Trigger in clipping list');
		// FTE_ENT_SKIN_CONTENTS: a SOLID_BSP ent with negative skin reports that skin as
		// contents (see skinContentsAt) instead of being solid -- never blocks ordinary
		// movement/collision, only the dedicated content queries consult it.
		if ((solid === SOLID.bsp) && (touch.v_float[pr.entvars.skin] < 0.0))
			continue;
		if ((clip.type === MOVE.nomonsters) && (solid !== SOLID.bsp))
			continue;
		if ((clip.boxmins[0] > touch.v_float[pr.entvars.absmax]) ||
			(clip.boxmins[1] > touch.v_float[pr.entvars.absmax1]) ||
			(clip.boxmins[2] > touch.v_float[pr.entvars.absmax2]) ||
			(clip.boxmaxs[0] < touch.v_float[pr.entvars.absmin]) ||
			(clip.boxmaxs[1] < touch.v_float[pr.entvars.absmin1]) ||
			(clip.boxmaxs[2] < touch.v_float[pr.entvars.absmin2]))
			continue;
		if (clip.passedict != null) {
			if ((clip.passedict.v_float[pr.entvars.size] !== 0.0) && (touch.v_float[pr.entvars.size] === 0.0))
				continue;
		}
		if (clip.trace.allsolid === true)
			return;
		if (clip.passedict != null) {
			if (state.server.edicts[touch.v_int[pr.entvars.owner]] === clip.passedict)
				continue;
			if (state.server.edicts[clip.passedict.v_int[pr.entvars.owner]] === touch)
				continue;
		}
		if ((touch.v_float[pr.entvars.flags] & FL.monster) !== 0)
			trace = clipMoveToEntity(touch, clip.start, clip.mins2, clip.maxs2, clip.end, state.clipScratchTrace);
		else
			trace = clipMoveToEntity(touch, clip.start, clip.mins, clip.maxs, clip.end, state.clipScratchTrace);
		// EXACT-fraction ties (a box landing on the seam of two coplanar bmodels) are broken
		// by LOWEST EDICT NUM instead of vanilla's first-tested-wins: vanilla's winner is
		// area-chain insertion-history luck, and the wasm sim's incrementally-maintained
		// chains order differently than this tree — groundentity forked at e1m7's pillar
		// button/wall seam. Same determinism rationale as the pushMove candidate sort; the
		// wasm clipToLinks applies the identical rule.
		if ((trace.allsolid === true) || (trace.startsolid === true) || (trace.fraction < clip.trace.fraction) ||
			((trace.fraction === clip.trace.fraction) && (trace.ent != null) && (clip.trace.ent != null) && (touch.num < clip.trace.ent.num))) {
			trace.ent = touch;
			copyTrace(trace, clip.trace);
		}
	}
	if (node.axis === -1)
		return;
	if (clip.boxmaxs[node.axis] > node.dist)
		clipToLinks(node.children[0], clip);
	if (clip.boxmins[node.axis] < node.dist)
		clipToLinks(node.children[1], clip);
};

export const move = function (start: V3, mins: V3, maxs: V3, end: V3, type: number, passedict: Edict, out: Trace) {
	var clip: Clip = state.moveClip;
	clip.trace = clipMoveToEntity(state.server.edicts[0], start, mins, maxs, end, out);
	clip.start = start;
	clip.end = end;
	clip.mins = mins;
	clip.maxs = maxs;
	clip.type = type;
	clip.passedict = passedict;
	if (type === MOVE.missile) {
		clip.mins2[0] = -15.0; clip.mins2[1] = -15.0; clip.mins2[2] = -15.0;
		clip.maxs2[0] = 15.0; clip.maxs2[1] = 15.0; clip.maxs2[2] = 15.0;
	}
	else {
		clip.mins2[0] = mins[0]; clip.mins2[1] = mins[1]; clip.mins2[2] = mins[2];
		clip.maxs2[0] = maxs[0]; clip.maxs2[1] = maxs[1]; clip.maxs2[2] = maxs[2];
	}
	var i;
	for (i = 0; i <= 2; ++i) {
		if (end[i] > start[i]) {
			clip.boxmins[i] = start[i] + clip.mins2[i] - 1.0;
			clip.boxmaxs[i] = end[i] + clip.maxs2[i] + 1.0;
			continue;
		}
		clip.boxmins[i] = end[i] + clip.mins2[i] - 1.0;
		clip.boxmaxs[i] = start[i] + clip.maxs2[i] + 1.0;
	}
	clipToLinks(state.areanodes[0], clip);
	return clip.trace;
};

// skipClientThink: the WASM backend's physicsClient composes clientThink into the physics pass,
// so host.serverFrame passes true when the wasm frame will run this tick (else players get
// friction/accelerate/punchangle-decay applied twice — both into the shared zero-copy store).
export const runClients = function (skipClientThink: boolean = false) {
	var i;
	for (i = 0; i < state.svs.maxclients; ++i) {
		host.state.client = state.svs.clients[i];
		if (host.state.client.active !== true)
			continue;
		state.player = host.state.client.edict;
		if (readClientMessage() !== true) {
			host.dropClient(false);
			continue;
		}
		if (host.state.client.spawned !== true) {
			host.state.client.cmd.forwardmove = 0.0;
			host.state.client.cmd.sidemove = 0.0;
			host.state.client.cmd.upmove = 0.0;
			continue;
		}
		if (!skipClientThink)
			clientThink();
	}
};

export const writeClientdataToMessage = function (ent: Edict, message: IDatagram) {
	if ((ent.v_float[pr.entvars.dmg_take] !== 0.0) || (ent.v_float[pr.entvars.dmg_save] !== 0.0)) {
		var other = state.server.edicts[ent.v_int[pr.entvars.dmg_inflictor]];
		msg.writeByte(message, protocol.SVC.damage);
		msg.writeByte(message, ent.v_float[pr.entvars.dmg_save]);
		msg.writeByte(message, ent.v_float[pr.entvars.dmg_take]);
		msg.writeCoord(message, other.v_float[pr.entvars.origin] + 0.5 * (other.v_float[pr.entvars.mins] + other.v_float[pr.entvars.maxs]), state.server.protocolFlags);
		msg.writeCoord(message, other.v_float[pr.entvars.origin1] + 0.5 * (other.v_float[pr.entvars.mins1] + other.v_float[pr.entvars.maxs1]), state.server.protocolFlags);
		msg.writeCoord(message, other.v_float[pr.entvars.origin2] + 0.5 * (other.v_float[pr.entvars.mins2] + other.v_float[pr.entvars.maxs2]), state.server.protocolFlags);
		ent.v_float[pr.entvars.dmg_take] = 0.0;
		ent.v_float[pr.entvars.dmg_save] = 0.0;
	}

	setIdealPitch();

	if (ent.v_float[pr.entvars.fixangle] !== 0.0) {
		msg.writeByte(message, protocol.SVC.setangle);
		msg.writeAngle(message, ent.v_float[pr.entvars.angles], state.server.protocolFlags);
		msg.writeAngle(message, ent.v_float[pr.entvars.angles1], state.server.protocolFlags);
		msg.writeAngle(message, ent.v_float[pr.entvars.angles2], state.server.protocolFlags);
		ent.v_float[pr.entvars.fixangle] = 0.0;
	};

	var bits = protocol.SU.items + protocol.SU.weapon;
	if (ent.v_float[pr.entvars.view_ofs2] !== protocol.default_viewheight)
		bits |= protocol.SU.viewheight;
	if (ent.v_float[pr.entvars.idealpitch] !== 0.0)
		bits |= protocol.SU.idealpitch;

	var val = pr.entvars.items2, items;
	if (val != null) {
		if (ent.v_float[val] !== 0.0)
			items = (ent.v_float[pr.entvars.items] >> 0) + ((ent.v_float[val] << 23) >>> 0);
		else
			items = (ent.v_float[pr.entvars.items] >> 0) + ((pr.state.globals_float[pr.globalvars.serverflags] << 28) >>> 0);
	}
	else
		items = (ent.v_float[pr.entvars.items] >> 0) + ((pr.state.globals_float[pr.globalvars.serverflags] << 28) >>> 0);

	if (ent.v_float[pr.entvars.flags] & FL.onground)
		bits |= protocol.SU.onground;
	if (ent.v_float[pr.entvars.waterlevel] >= 2.0)
		bits |= protocol.SU.inwater;

	if (ent.v_float[pr.entvars.punchangle] !== 0.0)
		bits |= protocol.SU.punch1;
	if (ent.v_float[pr.entvars.velocity] !== 0.0)
		bits |= protocol.SU.velocity1;
	if (ent.v_float[pr.entvars.punchangle1] !== 0.0)
		bits |= protocol.SU.punch2;
	if (ent.v_float[pr.entvars.velocity1] !== 0.0)
		bits |= protocol.SU.velocity2;
	if (ent.v_float[pr.entvars.punchangle2] !== 0.0)
		bits |= protocol.SU.punch3;
	if (ent.v_float[pr.entvars.velocity2] !== 0.0)
		bits |= protocol.SU.velocity3;

	if (ent.v_float[pr.entvars.weaponframe] !== 0.0)
		bits |= protocol.SU.weaponframe;
	if (ent.v_float[pr.entvars.armorvalue] !== 0.0)
		bits |= protocol.SU.armor;

	if (state.server.protocol !== protocol.netquake) {
		if (bits & protocol.SU.weapon && modelIndex(pr.getString(ent.v_int[pr.entvars.weaponmodel])) & 0xFF00)
			bits |= protocol.SU.weapon2;
		if (ent.v_float[pr.entvars.armorvalue] & 0xFF00)
			bits |= protocol.SU.armor2;
		if (ent.v_float[pr.entvars.currentammo] & 0xFF00)
			bits |= protocol.SU.ammo2;
		if (ent.v_float[pr.entvars.ammo_shells] & 0xFF00)
			bits |= protocol.SU.shells2;
		if (ent.v_float[pr.entvars.ammo_nails] & 0xFF00)
			bits |= protocol.SU.nails2;
		if (ent.v_float[pr.entvars.ammo_rockets] & 0xFF00)
			bits |= protocol.SU.rockets2;
		if (ent.v_float[pr.entvars.ammo_cells] & 0xFF00)
			bits |= protocol.SU.cells2;
		if (bits & protocol.SU.weaponframe && ent.v_float[pr.entvars.weaponframe] & 0xFF00)
			bits |= protocol.SU.weaponframe2
		// TODO: weaponalpha
		//if (bits & SU_WEAPON && ent_alpha != ENTALPHA_DEFAULT) bits |= SU_WEAPONALPHA; //for now, weaponalpha = client entity alpha
		if (bits >= 65536)
			bits |= protocol.SU.extend1
		if (bits >= 16777216)
			bits |= protocol.SU.extend2
	}

	msg.writeByte(message, protocol.SVC.clientdata);
	msg.writeShort(message, bits);

	// fitzquake additions
	if (bits & protocol.SU.extend1)
		msg.writeByte(message, bits >> 16);
	if (bits & protocol.SU.extend2)
		msg.writeByte(message, bits >> 24);

	if ((bits & protocol.SU.viewheight) !== 0)
		msg.writeChar(message, ent.v_float[pr.entvars.view_ofs2]);
	if ((bits & protocol.SU.idealpitch) !== 0)
		msg.writeChar(message, ent.v_float[pr.entvars.idealpitch]);

	if ((bits & protocol.SU.punch1) !== 0)
		msg.writeChar(message, ent.v_float[pr.entvars.punchangle]);
	if ((bits & protocol.SU.velocity1) !== 0)
		msg.writeChar(message, ent.v_float[pr.entvars.velocity] * 0.0625);
	if ((bits & protocol.SU.punch2) !== 0)
		msg.writeChar(message, ent.v_float[pr.entvars.punchangle1]);
	if ((bits & protocol.SU.velocity2) !== 0)
		msg.writeChar(message, ent.v_float[pr.entvars.velocity1] * 0.0625);
	if ((bits & protocol.SU.punch3) !== 0)
		msg.writeChar(message, ent.v_float[pr.entvars.punchangle2]);
	if ((bits & protocol.SU.velocity3) !== 0)
		msg.writeChar(message, ent.v_float[pr.entvars.velocity2] * 0.0625);

	msg.writeLong(message, items);
	if ((bits & protocol.SU.weaponframe) !== 0)
		msg.writeByte(message, ent.v_float[pr.entvars.weaponframe]);
	if ((bits & protocol.SU.armor) !== 0)
		msg.writeByte(message, ent.v_float[pr.entvars.armorvalue]);
	msg.writeByte(message, modelIndex(pr.getString(ent.v_int[pr.entvars.weaponmodel])));
	msg.writeShort(message, ent.v_float[pr.entvars.health]);
	msg.writeByte(message, ent.v_float[pr.entvars.currentammo]);
	msg.writeByte(message, ent.v_float[pr.entvars.ammo_shells]);
	msg.writeByte(message, ent.v_float[pr.entvars.ammo_nails]);
	msg.writeByte(message, ent.v_float[pr.entvars.ammo_rockets]);
	msg.writeByte(message, ent.v_float[pr.entvars.ammo_cells]);
	if (com.state.standard_quake === true)
		msg.writeByte(message, ent.v_float[pr.entvars.weapon]);
	else {
		var i, weapon = ent.v_float[pr.entvars.weapon];
		for (i = 0; i <= 31; ++i) {
			if ((weapon & (1 << i)) !== 0) {
				msg.writeByte(message, i);
				break;
			}
		}
	}

	if (bits & protocol.SU.weapon2)
		msg.writeByte(message, modelIndex(pr.getString(ent.v_int[pr.entvars.weaponmodel])) >> 8)
	if (bits & protocol.SU.armor2)
		msg.writeByte(message, ent.v_float[pr.entvars.armorvalue] >> 8)
	if (bits & protocol.SU.ammo2)
		msg.writeByte(message, ent.v_float[pr.entvars.currentammo] >> 8)
	if (bits & protocol.SU.shells2)
		msg.writeByte(message, ent.v_float[pr.entvars.ammo_shells] >> 8)
	if (bits & protocol.SU.nails2)
		msg.writeByte(message, ent.v_float[pr.entvars.ammo_nails] >> 8)
	if (bits & protocol.SU.rockets2)
		msg.writeByte(message, ent.v_float[pr.entvars.ammo_rockets] >> 8)
	if (bits & protocol.SU.cells2)
		msg.writeByte(message, ent.v_float[pr.entvars.ammo_cells] >> 8)
	if (bits & protocol.SU.weaponframe2)
		msg.writeByte(message, ent.v_float[pr.entvars.weaponframe] >> 8)
	if (bits & protocol.SU.weaponalpha)
		msg.writeByte(message, ent.v_float[pr.entvars.alpha] >> 8)
};

export const saveSpawnparms = function () {
	state.svs.serverflags = pr.state.globals_float[pr.globalvars.serverflags];
	var i, j;
	for (i = 0; i < state.svs.maxclients; ++i) {
		host.state.client = state.svs.clients[i];
		if (host.state.client.active !== true)
			continue;
		pr.state.globals_int[pr.globalvars.self] = host.state.client.edict.num;
		pr.executeProgram(pr.state.globals_int[pr.globalvars.SetChangeParms]);
		for (j = 0; j <= 15; ++j)
			host.state.client.spawn_parms[j] = pr.state.globals_float[pr.globalvars.parms + j];
	}
};

// const getString = (strings, ofs) => {
// 	var ret = ''
// 	while (strings[ofs]) {
// 		ret += String.fromCharCode(strings[ofs++])
// 	}
// 	return ret
// }

// Edict #1 (the player) historically wraps its v_float in a passthrough Proxy — a
// legacy write hook. Hoisted to module scope so makeEdict AND rebindEdictStorage
// (which repoints field storage for the WASM backend) build v_float identically.
const playerVFloatHandler = {
	set: function (obj: Float32Array, prop: string, value: number) {
		return Reflect.set(obj, prop, value);
	}
};
const makeVFloatView = function (buffer: ArrayBuffer, byteOffset: number, num: number): Float32Array {
	const view = new Float32Array(buffer, byteOffset, pr.state.entityfields);
	return num === 1 ? new Proxy(view, playerVFloatHandler) : view;
};

// Point an edict's field storage (v / v_int / v_float) at an EXTERNAL buffer slice
// [byteOffset, byteOffset + entityfields*4) rather than its own ArrayBuffer. The WASM
// server backend uses this to make JS edicts share the sim's linear memory (zero-copy:
// no per-tick field marshal). v_int/v_float carry byteOffset, so all field access is
// unchanged — only code that treated `.v` as a standalone 0-based buffer must use the
// views instead (fixed at pf.ts copyentity, ed.ts ED_Print).
export const rebindEdictStorage = function (ed: Edict, buffer: ArrayBuffer, byteOffset: number): void {
	ed.v = buffer;
	ed.v_int = new Int32Array(buffer, byteOffset, pr.state.entityfields);
	ed.v_float = makeVFloatView(buffer, byteOffset, ed.num);
};

// Detach an edict from an external (WASM) buffer back onto its own ArrayBuffer, copying
// current field values across. Used when the WASM backend is disabled mid-map so the JS
// server owns independent storage again.
export const unbindEdictStorage = function (ed: Edict): void {
	const entV = new ArrayBuffer(pr.state.entityfields << 2);
	new Int32Array(entV).set(ed.v_int);
	ed.v = entV;
	ed.v_int = new Int32Array(entV);
	ed.v_float = makeVFloatView(entV, 0, ed.num);
};

// Build one server edict.
const makeEdict = function (num: number): Edict {
	const entV = new ArrayBuffer(pr.state.entityfields << 2)
	const ed: Edict = {
		alpha: 0,
		num: num,
		free: false,
		area: { prev: null, next: null, ent: null },
		leafnums: [],
		baseline: {
			alpha: 0,
			scale: protocol.ENTSCALE_DEFAULT,
			origin: [0.0, 0.0, 0.0],
			angles: [0.0, 0.0, 0.0],
			modelindex: 0,
			frame: 0,
			colormap: 0,
			skin: 0,
			effects: 0
		},
		freetime: 0.0,
		v: entV,
		v_float: makeVFloatView(entV, 0, num),
		v_int: new Int32Array(entV),
		visframe: 0,
		pushStamp: 0,
		onladder: false,
		oldthinktime: 0,
		oldframe: 0
	};
	ed.area.ent = ed;
	return ed;
};

// Return edict num, lazily creating it (up to def.max_edicts) so huge maps grow past
// the pre-allocated base without pre-allocating the full cap on every map.
export const ensureEdict = function (num: number): Edict {
	var e = state.server.edicts[num];
	if (e == null) {
		e = makeEdict(num);
		state.server.edicts[num] = e;
	}
	return e;
};

export const spawnServer = async function (server: string) {
	var i;

	if (net.cvr.hostname.string.length === 0)
		cvar.set('hostname', 'UNNAMED');

	con.dPrint('SpawnServer: ' + server + '\n');
	state.svs.changelevel_issued = false;
	// New map: drop any active WASM server backend so it re-activates for this map
	// (host.serverFrame re-triggers wasmServerActivate when sv_wasm=1).
	host.state.wasmServer = null;
	host.state.wasmActivating = false;

	if (state.server.phase === 'active') {
		await net.sendToAll(state.reconnect);
		await cmd.executeString('reconnect\n', cmd.CMD_SOURCE.src_server);
	}

	if (host.cvr.coop.value !== 0)
		cvar.setValue('deathmatch', 0);
	host.state.current_skill = Math.floor(host.cvr.skill.value + 0.5);
	if (host.state.current_skill < 0)
		host.state.current_skill = 0;
	else if (host.state.current_skill > 3)
		host.state.current_skill = 3;
	cvar.setValue('skill', host.state.current_skill);

	con.dPrint('Clearing memory\n');
	// Preserve the worldmodel when respawning the SAME map (savegame load,
	// restart, same-map changelevel): reusing the parsed BSP avoids a second
	// full parse of a huge map stacking on the old one's memory. A different
	// map name matches nothing loaded, so everything is cleared as before.
	mod.clearAll('maps/' + server + '.bsp');

	await pr.loadProgs();

	state.server.protocol = protocol.rmq
	// QSS-M SV_SpawnServer default for RMQ without PEXT2 negotiation (sv_main.c ~4083):
	// PRFL_INT32COORD|PRFL_SHORTANGLE. We never negotiate PEXT2, so this is always the branch.
	state.server.protocolFlags = protocol.PRFL.INT32COORD | protocol.PRFL.SHORTANGLE
	state.server.edicts = [];
	// Pre-allocate a base; alloc() grows lazily up to def.max_edicts on huge maps
	// (Immortal Lock etc.) so small maps don't pay for 32000 edicts every load.
	for (i = 0; i < def.initial_edicts; ++i)
		state.server.edicts[i] = makeEdict(i);

	state.server.datagram.cursize = 0;
	state.server.reliable_datagram.cursize = 0;
	state.server.signon.cursize = 0;
	state.server.num_edicts = state.svs.maxclients + 1;
	for (i = 0; i < state.svs.maxclients; ++i)
		state.svs.clients[i].edict = state.server.edicts[i + 1];
	state.server.phase = 'loading';
	state.server.paused = false;
	state.server.spawnKind = 'map';
	state.server.time = 1.0;
	state.server.lastcheck = 0;
	state.server.lastchecktime = 0.0;
	state.server.lastsave = '';
	state.server.autoloading = false;
	state.server.autosave.secretBoost = 0;
	state.server.autosave.prevHealth = 0;
	state.server.autosave.prevSecrets = 0;
	state.server.autosave.time = 0;
	state.server.autosave.hurtTime = 0;
	state.server.autosave.shootTime = 0;
	state.server.autosave.cheat = 0;
	state.server.modelname = 'maps/' + server + '.bsp';
	// Huge map sources are evicted from residency after parsing (mod.ts); a
	// re-parse (restart/changelevel after clearAll) must re-fetch the bytes
	// before the sync mod.forName path runs. No-op when already resident.
	if (mod.needsLoad(state.server.modelname)) {
		if (com.loadFileSync(state.server.modelname) == null)
			await com.loadFile(state.server.modelname);
		const litName = com.removeExtension(state.server.modelname) + '.lit';
		if (com.loadFileSync(litName) == null)
			await com.loadFile(litName);
	}
	state.server.worldmodel = mod.forName(state.server.modelname, false);
	if (state.server.worldmodel == null) {
		con.print('Couldn\'t spawn server ' + state.server.modelname + '\n');
		state.server.phase = 'inactive';
		return;
	}
	state.solidNotPushables.length = 0;
	state.pushCandidates.length = 0;
	state.server.models = [];
	state.server.models[1] = state.server.worldmodel;

	state.areanodes = [];
	createAreaNode(0, state.server.worldmodel.mins, state.server.worldmodel.maxs);

	state.server.sound_precache = [''];
	state.server.model_precache = ['', state.server.modelname];
	state.server.particle_precache = [''];
	state.server.particlePrecacheWarnCount = 0;
	for (i = 1; i <= state.server.worldmodel.submodels.length; ++i) {
		state.server.model_precache[i + 1] = '*' + i;
		state.server.models[i + 1] = mod.forName('*' + i, false);
	}

	state.server.lightstyles = [];
	for (i = 0; i <= 63; ++i)
		state.server.lightstyles[i] = '';

	var ent = state.server.edicts[0];
	ent.v_int[pr.entvars.model] = pr.newString(state.server.modelname, 64);
	ent.v_float[pr.entvars.modelindex] = 1.0;
	ent.v_float[pr.entvars.solid] = SOLID.bsp;
	ent.v_float[pr.entvars.movetype] = MOVE_TYPE.push;

	if (host.cvr.coop.value !== 0)
		pr.state.globals_float[pr.globalvars.coop] = host.cvr.coop.value;
	else
		pr.state.globals_float[pr.globalvars.deathmatch] = host.cvr.deathmatch.value;

	pr.state.globals_int[pr.globalvars.mapname] = pr.newString(server, 64);
	pr.state.globals_float[pr.globalvars.serverflags] = state.svs.serverflags;
	await ed.loadFromFile(state.server.worldmodel.entities);
	state.server.phase = 'active';
	host.state.frametime = 0.1;

	physics();
	physics();
	createBaseline();
	for (i = 0; i < state.svs.maxclients; ++i) {
		host.state.client = state.svs.clients[i];
		if (host.state.client.active !== true)
			continue;
		host.state.client.edict.v_int[pr.entvars.netname] = pr.state.netnames + (i << 5);
		host.state.client.reconnect = true
		sendServerinfo(host.state.client);
	}
	net.registerWithMaster()
	con.dPrint('Server spawned.\n');
};

export const sendClientMessages = function () {
	updateToReliableMessages();
	var i, client;
	for (i = 0; i < state.svs.maxclients; ++i) {
		host.state.client = client = state.svs.clients[i];
		if (client.active !== true)
			continue;
		if (client.spawned === true) {
			if (sendClientDatagram() !== true)
				continue;
		}
		else if (client.sendsignon !== true) {
			if ((host.state.realtime - client.last_message) > 5.0) {
				if (net.sendUnreliableMessage(client.netconnection, state.nop) === -1)
					host.dropClient(true);
				client.last_message = host.state.realtime;
			}
			continue;
		}

		if (client.message.overflowed === true) {
			host.dropClient(true);
			client.message.overflowed = false;
			continue;
		}
		if (client.dropasap === true) {
			if (net.canSendMessage(client.netconnection) === true)
				host.dropClient(false);
		}
		else if (client.message.cursize !== 0) {
			if (net.canSendMessage(client.netconnection) !== true)
				continue;
			if (net.sendMessage(client.netconnection, client.message) === -1)
				host.dropClient(true);
			client.message.cursize = 0;
			client.last_message = host.state.realtime;
			client.sendsignon = false;
		}
	}

	for (i = 1; i < state.server.num_edicts; ++i)
		state.server.edicts[i].v_float[pr.entvars.effects] &= (~mod.EFFECTS.muzzleflash >>> 0);
};
export const physics = function () {
	pr.state.globals_int[pr.globalvars.self] = 0;
	pr.state.globals_int[pr.globalvars.other] = 0;
	pr.state.globals_float[pr.globalvars.time] = state.server.time;
	pr.executeProgram(pr.state.globals_int[pr.globalvars.StartFrame]);
	// FTE_ENT_SKIN_CONTENTS: recompute the negative-skin SOLID_BSP count once (O(N)) so the per-entity
	// checkWater skin-contents walk (skinContentsAt) can short-circuit when there are none — otherwise it
	// is O(N^2) over every solid entity, every frame (dominant cost on entity-heavy maps like Quoth).
	var _nsk = 0;
	var _skEnts = state.skinContentsEnts;
	for (var _e = 1; _e < state.server.num_edicts; ++_e) {
		var _se = state.server.edicts[_e];
		if (_se.free === true)
			continue;
		if ((_se.v_float[pr.entvars.solid] === SOLID.bsp) && ((_se.v_float[pr.entvars.skin] >> 0) < 0))
			_skEnts[_nsk++] = _se;
	}
	state.numSkinContents = _nsk;
	var i, ent;
	for (i = 0; i < state.server.num_edicts; ++i) {
		ent = state.server.edicts[i];
		if (ent.free === true)
			continue;
		if (pr.state.globals_float[pr.globalvars.force_retouch] !== 0.0)
			linkEdict(ent, true);
		if ((i > 0) && (i <= state.svs.maxclients)) {
			physics_Client(ent);
		} else {
			switch (ent.v_float[pr.entvars.movetype]) {
				case MOVE_TYPE.push:
					physics_Pusher(ent);
					break;
				case MOVE_TYPE.none:
					runThink(ent);
					break;
				case MOVE_TYPE.noclip:
					physics_Noclip(ent);
					break;
				case MOVE_TYPE.step:
					physics_Step(ent);
					break;
				case MOVE_TYPE.toss:
				case MOVE_TYPE.bounce:
				case MOVE_TYPE.bouncemissile:
				case MOVE_TYPE.fly:
				case MOVE_TYPE.flymissile:
					physics_Toss(ent);
					break;
				default:
					sys.error('SV.Physics: bad movetype ' + (ent.v_float[pr.entvars.movetype] >> 0));
			}
		}
		// QSS-M sv_phys.c SV_Physics tail (johnfitz PROTOCOL_FITZQUAKE): capture the interval
		// to nextthink for the client's lerp timing, unless it is ~0.1 (which the client
		// assumes). Recomputed for EVERY entity (clients included) every frame; reads the
		// oldthinktime/oldframe pair runThink captured. Q_rint is truncate-after-add-half.
		ent.sendinterval = false;
		if (!ent.free && ent.v_float[pr.entvars.nextthink] > state.server.time &&
			(ent.v_float[pr.entvars.movetype] === MOVE_TYPE.step || ent.v_float[pr.entvars.movetype] === MOVE_TYPE.walk ||
				ent.v_float[pr.entvars.frame] !== ent.oldframe)) {
			const x = (ent.v_float[pr.entvars.nextthink] - ent.oldthinktime) * 255;
			const j = x > 0 ? Math.trunc(x + 0.5) : Math.trunc(x - 0.5);
			if (j >= 0 && j < 256 && j !== 25 && j !== 26) //25 and 26 are close enough to 0.1 to not send
				ent.sendinterval = true;
		}
	}
	if (pr.state.globals_float[pr.globalvars.force_retouch] !== 0.0)
		--pr.state.globals_float[pr.globalvars.force_retouch];
	state.server.time += host.state.frametime;
};

export const checkForNewClients = function () {
	var ret, i;
	for (; ;) {
		ret = net.checkNewConnections();
		if (ret == null)
			return;
		for (i = 0; i < state.svs.maxclients; ++i) {
			if (state.svs.clients[i].active !== true)
				break;
		}
		if (i === state.svs.maxclients)
			sys.error('SV.CheckForNewClients: no free clients');
		state.svs.clients[i].netconnection = ret;
		connectClient(i);
		++net.state.activeconnections;
	}
};

export const setClientName = function (client: Client, name: string) {
	var ofs = pr.state.netnames + (client.num << 5), i;
	for (i = 0; i < name.length; ++i)
		pr.state.strings[ofs + i] = name.charCodeAt(i);
	pr.state.strings[ofs + i] = 0;
};

export const getClientName = function (client: Client) {
	return pr.getString(pr.state.netnames + (client.num << 5));
};


export const checkFloodProt = function (client: Client)
{
	if (!cvr.sv_floodprotect.value)
		return 0;
	if (cvr.sv_floodprotect_messages.value <= 0 || cvr.sv_floodprotect_interval.value <= 0)
		return 0;
	if (state.server.paused)
		return 0;
	if (host.state.realtime < client.lockedtill)
		return Math.ceil(client.lockedtill - host.state.realtime);

	if (client.floodprotmessage > cvr.sv_floodprotect_messages.value)
	{
		client.lockedtill = host.state.realtime + cvr.sv_floodprotect_silencetime.value;
		client.floodprotmessage = 0.0;
		client.lastspoke = 0.0;
		return cvr.sv_floodprotect_silencetime.value;
	}

	return 0;
}

export const pushFloodProt = function(client: Client) {
	if (!cvr.sv_floodprotect.value)
		return;
	if (cvr.sv_floodprotect_messages.value <= 0 || cvr.sv_floodprotect_interval.value <= 0)
		return;
	if (state.server.paused)
		return;

	if (client.lastspoke)
	{
		client.floodprotmessage -= (host.state.realtime - client.lastspoke)
			* cvr.sv_floodprotect_messages.value
			/ cvr.sv_floodprotect_interval.value;
		client.floodprotmessage = Math.max(0, client.floodprotmessage);
		client.floodprotmessage++;
	}
	else
		client.floodprotmessage = 1.0;
	client.lastspoke = host.state.realtime;
}

export const init = function () {
	state = initState()
	// Player view-roll cvars: the server owns them (it writes the authoritative
	// angles2 roll in clientThink); the view module reuses them via cvar.findVar.
	cvr.rollspeed = cvar.registerVariable('cl_rollspeed', '200');
	cvr.rollangle = cvar.registerVariable('cl_rollangle', '2.0');
	cvr.maxvelocity = cvar.registerVariable('sv_maxvelocity', '2000');
	// Opt-in: run the server physics frame via the WASM sim (wasm-sim/) instead of
	// sv.physics(). 0 = the JS server (default; also the -worker JS-on-worker path).
	// Lets us A/B the WASM backend against the JS server for perf. See wasmServer.ts.
	// Registered into HOST's cvr, not sv's: host.serverFrame's activation guard + run-branch
	// read host.cvr.wasm. sv.ts has its own separate `cvr` object, so registering it here as
	// `cvr.wasm` left host.cvr.wasm undefined => the guard never fired and sv_wasm never activated.
	host.cvr.wasm = cvar.registerVariable('sv_wasm', '0');
	cvr.gravity = cvar.registerVariable('sv_gravity', '800', false, true);
	cvr.friction = cvar.registerVariable('sv_friction', '4', false, true);
	cvr.edgefriction = cvar.registerVariable('edgefriction', '2');
	cvr.stopspeed = cvar.registerVariable('sv_stopspeed', '100');
	cvr.maxspeed = cvar.registerVariable('sv_maxspeed', '320', false, true);
	cvr.accelerate = cvar.registerVariable('sv_accelerate', '10');
	cvr.idealpitchscale = cvar.registerVariable('sv_idealpitchscale', '0.8');
	cvr.aim = cvar.registerVariable('sv_aim', '0.93');
	cvr.nostep = cvar.registerVariable('sv_nostep', '0');
	// QSS-M sv_phys.c: the SV_CheckWaterTransition splash sample, changeable/disableable
	// (empty string = no splash). Spike's generalization of vanilla's hardcoded h2ohit1.
	cvr.sound_watersplash = cvar.registerVariable('sv_sound_watersplash', 'misc/h2ohit1.wav');
	// QSS-M sv_phys.c: the SV_Physics_Step landing thud, same changeable/disableable shape.
	cvr.sound_land = cvar.registerVariable('sv_sound_land', 'demon/dland2.wav');


	cvr.sv_floodprotect = cvar.registerVariable('sv_floodprotect', '1');
	cvr.sv_floodprotect_messages = cvar.registerVariable('sv_floodprotect_messages', '4');
	cvr.sv_floodprotect_interval	= cvar.registerVariable('sv_floodprotect_interval', '3');
	cvr.sv_floodprotect_silencetime = cvar.registerVariable('sv_floodprotect_silencetime', '10');
	cvr.sv_floodprotect_suicide = cvar.registerVariable('sv_floodprotect_suicide', '1');
	cvr.sv_floodprotect_team_exception = cvar.registerVariable('sv_floodprotect_team_exception', '1');

	sz.u8(state.nop)[0] = protocol.SVC.nop;
	msg.writeByte(state.reconnect, protocol.SVC.stufftext);
	msg.writeString(state.reconnect, 'reconnect\n');

	initBoxHull();
};
