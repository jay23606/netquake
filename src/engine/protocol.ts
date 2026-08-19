export const netquake = 15;
export const fitzquake = 666;
export const rmq = 999;

// RMQ (999) wire-format protocol flags, sent as a long after the protocol long in
// SVC_SERVERINFO and used directly (not translated) as state.server.protocolFlags /
// clState.protocolFlags -- matches QSS-M protocol.h PRFL_* verbatim.
export const PRFL = {
	SHORTANGLE:  1 << 1,
	FLOATANGLE:  1 << 2,
	COORD24:     1 << 3, // PRFL_24BITCOORD
	FLOATCOORD:  1 << 4,
	EDICTSCALE:  1 << 5,
	ALPHASANITY: 1 << 6,
	INT32COORD:  1 << 7,
};

export const VERSION = {
	netquake: 15,
	fitzquake: 666,
	rmq: 999,
	bjp3: 10002
}
export const U = {
	morebits: 1,
	origin1: 1 << 1,
	origin2: 1 << 2,
	origin3: 1 << 3,
	angle2: 1 << 4,
	nolerp: 1 << 5,
	frame: 1 << 6,
	signal: 1 << 7,

	angle1: 1 << 8,
	angle3: 1 << 9,
	model: 1 << 10,
	colormap: 1 << 11,
	skin: 1 << 12,
	effects: 1 << 13,
	longentity: 1 << 14,
	// fitzquake
	extend1: 1 << 15,
	alpha: 1 << 16,
	frame2: 1 << 17,
	model2: 1 << 18,
	lerpfinish: 1 << 19,
	scale: 1 << 20,		// 1 byte, PROTOCOL_RMQ (999) only -- ENTSCALE_ENCODE, PRFL_EDICTSCALE
	unused21: 1 << 21,
	unused22: 1 << 22,
	extend2: 1 << 23
};

export const SU = {
	viewheight: 1,
	idealpitch: 1 << 1,
	punch1: 1 << 2,
	punch2: 1 << 3,
	punch3: 1 << 4,
	velocity1: 1 << 5,
	velocity2: 1 << 6,
	velocity3: 1 << 7,
	items: 1 << 9,
	onground: 1 << 10,
	inwater: 1 << 11,
	weaponframe: 1 << 12,
	armor: 1 << 13,
	weapon: 1 << 14,
	// fitzquake
	extend1: 1 << 15,
	weapon2: 1 << 16,
	armor2: 1 << 17,
	ammo2: 1 << 18,
	shells2: 1 << 19,
	nails2: 1 << 20,
	rockets2: 1 << 21,
	cells2: 1 << 22,
	extend2: 1 << 23,
	weaponframe2: 1 << 24,
	weaponalpha: 1 << 25,
};

export const default_viewheight = 22;

export const SVC = {
	nop: 1,
	disconnect: 2,
	updatestat: 3,
	version: 4,
	setview: 5,
	sound: 6,
	time: 7,
	print: 8,
	stufftext: 9,
	setangle: 10,
	serverinfo: 11,
	lightstyle: 12,
	updatename: 13,
	updatefrags: 14,
	clientdata: 15,
	stopsound: 16,
	updatecolors: 17,
	particle: 18,
	damage: 19,
	spawnstatic: 20,
	spawnbaseline: 22,
	temp_entity: 23,
	setpause: 24,
	signonnum: 25,
	centerprint: 26,
	killedmonster: 27,
	foundsecret: 28,
	spawnstaticsound: 29,
	intermission: 30,
	finale: 31,
	cdtrack: 32,
	sellscreen: 33,
	cutscene: 34,
	showlmp: 35,	// Nehahra: [string] slotname [string] lmpfilename [coord] x [coord] y
	hidelmp: 36,	// Nehahra: [string] slotname

	// 2021 rerelease (Kex): [string] id. Written by the QC itself with stock WriteByte/WriteString,
	// so it arrives on plain NQ/666. Shares its number with the unimplemented svcdp_effect.
	achievement: 52,

	//johnfitz -- PROTOCOL_FITZQUAKE -- new server messages
	skybox:	37,	// [string] name
	bf:	40,
	fog: 41,	// [byte] density [byte] red [byte] green [byte] blue [float] time
	spawnbaseline2:	42,  // support for large modelindex, large framenum, alpha, using flags
	spawnstatic2:	43,	// support for large modelindex, large framenum, alpha, using flags
	spawnstaticsound2:44,	// [coord3] [short] samp [byte] vol [byte] aten
	//johnfitz

	dp_downloaddata: 50, // [long] offset [short] size [byte*size] data

	effect: 52, // [vector] org [byte] modelindex [byte] startframe [byte] framecount [byte] framerate
	effect2: 53, // [vector] org [short] modelindex [short] startframe [byte] framecount [byte] framerate

	// spike's DP-particle-script extension (svcdp_*, QSS-M protocol.h). No PEXT gating on
	// either side -- our server always negotiates FitzQuake/RMQ (never plain protocol 15),
	// so these are unconditional the same way spawnbaseline2/spawnstatic2 above are.
	dp_precache: 54, // [short] index|(type<<14) [string] name -- type 0=model 1=particle 2=sound
	dp_trailparticles: 60, // [short] entnum [short] effectnum [coord3] start [coord3] end
	dp_pointparticles: 61, // [short] effectnum [coord3] org [coord3] vel [short] count
	dp_pointparticles1: 62, // compact form: count==1, vel==(0,0,0) implied -- [short] effectnum [coord3] org
};

// dp_precache's type tag, packed into the top 2 bits of the wire index short.
export const PRECACHE_TYPE = {
	model: 0,
	particle: 1,
	sound: 2,
};

export const CLC = {
	nop: 1,
	disconnect: 2,
	move: 3,
	stringcmd: 4,
	dp_ackdownloaddata: 51,
};

export const TE = {
	spike: 0,
	superspike: 1,
	gunshot: 2,
	explosion: 3,
	tarexplosion: 4,
	lightning1: 5,
	lightning2: 6,
	wizspike: 7,
	knightspike: 8,
	lightning3: 9,
	lavasplash: 10,
	teleport: 11,
	explosion2: 12,
	beam: 13,
	// DarkPlaces extended TEs (DP_TE_PARTICLERAIN/SNOW):
	// [vector] min [vector] max [vector] dir [short] count [byte] color
	dp_particlerain: 55,
	dp_particlesnow: 56
};

// fitzquake
export const ENT_ALPHA = {
	default: 0,		//entity's alpha is "default" (i.e. water obeys r_wateralpha) -- must be zero so zeroed out memory works
	zero: 1,		 	//entity is invisible (lowest possible alpha)
	one: 255 			//entity is fully opaque (highest possible alpha)
}

// Quakespasm/Ironwail entity .scale byte packing: 16 == float 1.0 (protocol.h ENTSCALE_DEFAULT).
export const ENTSCALE_DEFAULT = 16;

//johnfitz -- PROTOCOL_FITZQUAKE -- new bits
export const SND = {
	largeentity: 1 << 3,
	largesound: 1 << 4
}

//johnfitz -- PROTOCOL_FITZQUAKE -- flags for entity baseline messages
export const BASE = {
	largemodel: 1,			// modelindex is short instead of byte
	largeframe: 1 << 1,	// frame is short instead of byte
	alpha: 1 << 2,			// 1 byte, uses ENTALPHA_ENCODE, not sent if ENTALPHA_DEFAULT
	scale: 1 << 3				// 1 byte, ENTSCALE_ENCODE, RMQ (999) only, not sent if ENTSCALE_DEFAULT
}