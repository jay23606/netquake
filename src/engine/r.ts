import * as cmd from './cmd'
import * as cvar from './cvar'
import * as GL from './GL'
import * as vec from './vec'
import * as cl from './cl'
import * as mod from './mod'
import * as chase from './chase'
import * as v from './v'
import * as scr from './scr'
import * as sys from './sys'
import * as con from './console'
import * as host from './host'
import * as com from './com'
import * as sv from './sv'
import * as pr from './pr'
import * as q from './q'
import * as vid from './vid'
import * as msg from './msg'
import * as def from './def'
import * as s from './s'
import * as lm from './lightmap'
import * as tx from './texture'
import * as mapAlpha from './mapAlpha'
import * as fog from './fog'
import * as sky from './sky'
import * as pscript from './pscript'
import { AliasFrame, AliasFrameGroup, BrushPrecomputeSlot, Face, Leaf, Model, Node, NodeLeaf, Plane, SpriteFrame, SpriteFrameGroup, TexChain, Texture } from './types/Model'
import { V3, V4 } from './types/Vector'
import { EFrags } from './types/Model'
import { Entity, LightCache } from './types/Entity'
import { DynamicLight } from './cl'
import { createAttribParam } from './GL'
import { getRenderer } from './render'
import { SceneSetup, FrameGlobals } from './render/IRenderer'

export const MAX_DLIGHTS = 32
export const LERP = {
	movestep: 1,
	resetanim: 1 << 1,
	resetanim2: 1 << 2,
	resetmove: 1 << 3,
	finish: 1 << 4
}

type Refdef = {
	vrect: {
		x: number,
		y: number,
		width: number,
		height: number
	},
	vieworg: V3,
	viewangles: V3
	fov_y: number
	fov_x: number
}

type RState = {
	framecount: number
	dlightvecs: WebGLBuffer,
	warpbuffer: WebGLBuffer,
	warprenderbuffer: WebGLBuffer,
	warptexture: WebGLTexture,
	notexture_mip: Texture,
	solidskytexture: WebGLTexture,
	alphaskytexture: WebGLTexture,
	null_texture: WebGLTexture,
	vis_changed: boolean,
	visframecount: number,
	frustum: [Plane, Plane, Plane, Plane],
	// Flat mirror of state.frustum, rebuilt each setFrustum() call: 4 planes
	// x (nx, ny, nz, dist); frustumSignbits[k] bit-encodes which normal
	// components of plane k are negative (same convention as Plane.signbits).
	frustumFlat: Float32Array,
	frustumSignbits: Uint8Array,
	// Advanced once per markWorldFrustum() call; surfVisibleFrame stamps compare
	// against this to tell "marked this frame" from "marked N frames ago".
	frustumFrame: number,
	// Explicit (idx, mask) pair stack for the iterative frustum walk; sized far
	// past any BSP tree depth.
	frustumWalkStack: Int32Array,
	refdef: Refdef,
	vup: V3,
	vpn: V3,
	vright: V3,
	perspective: number[],
	dowarp: boolean,
	warpwidth: number,
	warpheight: number,
	oldwarpwidth: number,
	oldwarpheight: number,
	warpSupported: boolean,
	warpDepthFormat: number,
	warpDepthAttachment: number,
	// leaf NUMBER (index into worldmodel.leafs / the flat leaf arrays), -1 = none.
	// The Leaf objects are dropped on the worker-mode client; PVS/efrag/marksurface
	// reads go through the flat leaf arrays keyed by this index.
	viewleaf: number,
	c_brush_verts: number,
	c_alias_polys: number,
	// r_speeds stage timings (ms) + chain-rebuild count for the current frame
	rs_markms: number,
	rs_walkms: number,
	rs_rebuilds: number,
	// worldmodel whose GL geometry (VBO + lightmap textures) is already built for
	// the current GL context; lets newMap skip the rebuild on a same-map respawn
	builtWorldmodel: Model | null,
	skytexturenum: number
	avertexnormals: V3[],
	ramp1: number[],
	ramp2: number[],
	ramp3: number[],
	numparticles: number,
	avelocities: V3[],
	particleOrg: Float32Array,
	particleVel: Float32Array,
	particleRamp: Float32Array,
	particleDie: Float32Array,
	particleColor: Uint8Array,
	particleType: Uint8Array,
	numActiveParticles: number,
	particleInstanceData: ArrayBuffer,
	particleInstanceFloats: Float32Array,
	particleInstanceBytes: Uint8Array,
	particleCornerBuffer: WebGLBuffer,
	particleInstanceBuffer: WebGLBuffer,
	tracercount: number
	lightmap_modified: boolean[]
	drawsky: boolean
	model_vbo: WebGLBuffer
	cl_worldmodel: Model
	oldviewleaf: number
	mod_novis: Uint8Array
	mod_novis_capacity: number
	// persistent decompress target for leafPVS -- rebuilds happen every leaf crossing
	// while moving, and a fresh vis row per rebuild was the top steady-state allocator
	leafpvs_scratch: Uint8Array
	fatbytes: number
	fatpvs: Uint8Array
	fatpvs_capacity: number;
	fatpvs_scratch: Uint8Array
	skyvecs: WebGLBuffer
	// Retained copy of the classic sky-dome geometry (180 verts × vec3) so the WebGPU backend can upload
	// its own dome vertex buffer. Only populated when the active backend is WebGPU (null under WebGL2).
	skyvecs_data: Float32Array | null
	cached_vis: Uint8Array
	// Decoupled-mode (r_gpucull) efrag cache: leaf indices (leafEfrags keys) that are visible
	// AND own an efrag chain, valid while the viewleaf/world/novis/static-count are unchanged.
	// Cuts markEfrags' per-frame full-leaf walk + PVS decompress to a short cached loop.
	efragCacheWorld: Model | null
	efragCacheLeaf: number
	efragCacheNovis: number
	efragCacheStatics: number
	efragCacheLeaves: Int32Array | null
	efragCacheCount: number
	viewAnglesRad: V3
	viewMatrix: number[]
	// Persistent FrameGlobals handed to getRenderer().beginScene() each frame (mutated in place, no
	// per-frame alloc). Float32Array mirrors of the same values perspective() computes/uploads; the
	// WebGL2 backend ignores it, the WebGPU backend uploads it to a uniform buffer. See updateFrameGlobals.
	frameGlobals: FrameGlobals
	// Retained copy of the world model VBO (44-byte interleaved verts) so the WebGPU backend can upload
	// its own vertex buffer. Only populated when the active backend is WebGPU (null under WebGL2).
	model_vbo_data: Float32Array | null
	// WebGPU lightmap-array consolidation: retained parallel per-vertex lightmap-layer stream
	// (4 float32 layers per vertex, same vertex count/order as model_vbo_data) so the WebGPU backend can
	// upload its own layer vertex buffer. Only populated when the active backend is WebGPU (null under WebGL2).
	model_lmlayer_data: Float32Array | null
	activeDlights: Int32Array
	numActiveDlights: number
	// Packed per-frame dlight uniforms for the Brush fragment shader (GPU dlighting):
	// vec4(origin.xyz, radius) and vec4(color.rgb, minlight) per light, MAX_DLIGHTS slots.
	// numShaderDlights is 0 when flashblend or r_dynamic 0 disable surface dlighting.
	dlightPosRadius: Float32Array
	dlightColor: Float32Array
	numShaderDlights: number
	// framecount of the last dlight uniform upload — drawTextureChains runs per
	// brush entity, but the packed arrays only change once per frame.
	dlightUniformFrame: number
	// Persistent hot-path temporaries, consumed immediately at their single call
	// site — never held across calls.
	cullMins: V3
	cullMaxs: V3
	// Saved main-view origin/angles while the skyroom sub-view borrows refdef (renderView).
	skyroomSaveOrg: V3
	skyroomSaveAng: V3
	// setupAliasFrame() result: byte offsets of the two poses to blend between in
	// the alias model's cmds VBO, and the blend factor. Mutated in place per draw.
	aliasLerp: { pose1ofs: number, pose2ofs: number, blend: number }
	// Persistent SceneSetup handed to getRenderer().beginScene() each frame (mutated in place to
	// avoid a per-frame allocation in the render hot path).
	sceneSetup: SceneSetup
}

export const state: RState = {
	framecount: 0,
	dlightvecs: null,
	warpbuffer: null,
	warprenderbuffer: null,
	warptexture: null,
	vis_changed: false,
	notexture_mip: null,
	solidskytexture: null,
	alphaskytexture: null,
	null_texture: null,
	visframecount: 0,
	frustumFlat: new Float32Array(16),
	frustumSignbits: new Uint8Array(4),
	frustumFrame: 0,
	frustumWalkStack: new Int32Array(2048),
	warpwidth: 0,
	warpheight: 0,
	oldwarpwidth: 0,
	oldwarpheight: 0,
	warpSupported: true,
	warpDepthFormat: 0,
	warpDepthAttachment: 0,
	c_brush_verts: 0,
	c_alias_polys: 0,
	rs_markms: 0,
	rs_walkms: 0,
	rs_rebuilds: 0,
	builtWorldmodel: null,
	frustum: [{
		normal: [0, 0, 0],
		dist: 0,
		signbits: 0,
		type: 0
	}, {
		normal: [0, 0, 0],
		dist: 0,
		signbits: 0,
		type: 0
	}, {
		normal: [0, 0, 0],
		dist: 0,
		signbits: 0,
		type: 0
	}, {
		normal: [0, 0, 0],
		dist: 0,
		signbits: 0,
		type: 0
	}],
	vup: [0,0,0],
	vpn: [0,0,0],
	vright: [0,0,0],	
	refdef: {
		vrect: {
			x: 0,
			y: 0,
			width: 0,
			height: 0
		},
		vieworg: [0.0, 0.0, 0.0],
		viewangles: [0.0, 0.0, 0.0],
		fov_y: 0,
		fov_x: 0
	},
	perspective: [
		0.0, 0.0, 0.0, 0.0,
		0.0, 0.0, 0.0, 0.0,
		0.0, 0.0, -65540.0 / 65532.0, -1.0,
		0.0, 0.0, -524288.0 / 65532.0, 0.0
	],
	dowarp: false,
	viewleaf: -1,
	skytexturenum: 0,
	avertexnormals: [],
	ramp1: [],
	ramp2: [],
	ramp3: [],
	numparticles: 0,
	avelocities: [],
	particleOrg: new Float32Array(0),
	particleVel: new Float32Array(0),
	particleRamp: new Float32Array(0),
	particleDie: new Float32Array(0),
	particleColor: new Uint8Array(0),
	particleType: new Uint8Array(0),
	numActiveParticles: 0,
	particleInstanceData: new ArrayBuffer(0),
	particleInstanceFloats: new Float32Array(0),
	particleInstanceBytes: new Uint8Array(0),
	particleCornerBuffer: null,
	particleInstanceBuffer: null,
	tracercount: 0,
	lightmap_modified: [],
	drawsky: false,
	model_vbo: null,
	cl_worldmodel: null,
	oldviewleaf: -1,
	mod_novis: null,
	mod_novis_capacity: 0,
	leafpvs_scratch: null,
	fatbytes: 0,
	fatpvs: null,
	fatpvs_capacity: 0,
	fatpvs_scratch: null,
	skyvecs: null,
	skyvecs_data: null,
	cached_vis: null,
	efragCacheWorld: null,
	efragCacheLeaf: -1,
	efragCacheNovis: 0,
	efragCacheStatics: -1,
	efragCacheLeaves: null,
	efragCacheCount: 0,
	viewAnglesRad: [0.0, 0.0, 0.0],
	viewMatrix: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
	frameGlobals: {
		viewOrigin: new Float32Array(3),
		viewAngles: new Float32Array(9),
		perspective: new Float32Array(16),
		vpn: new Float32Array(3),
		gamma: 1.0,
	},
	model_vbo_data: null,
	model_lmlayer_data: null,
	activeDlights: new Int32Array(MAX_DLIGHTS),
	numActiveDlights: 0,
	dlightPosRadius: new Float32Array(MAX_DLIGHTS * 4),
	dlightColor: new Float32Array(MAX_DLIGHTS * 4),
	numShaderDlights: 0,
	dlightUniformFrame: -1,
	cullMins: [0.0, 0.0, 0.0],
	cullMaxs: [0.0, 0.0, 0.0],
	skyroomSaveOrg: [0.0, 0.0, 0.0],
	skyroomSaveAng: [0.0, 0.0, 0.0],
	aliasLerp: { pose1ofs: 0, pose2ofs: 0, blend: 1.0 },
	sceneSetup: { x: 0, y: 0, width: 0, height: 0, dowarp: false }
}

export const cvr = {
} as any

const	MAXLIGHTMAPS = 16
export type Color = [number, number, number]
// set on init
// let gl: any = null

// efrag

// nodeC: flat child encoding (>= 0 node index, < 0 leaf as -1 - leafnum).
// Walks nodePacked; efrags attach to the flat per-leaf leafEfrags heads.
export const splitEntityOnNode = function (nodeC: number, entity: Entity, emins: V3, emaxs: V3) {
	const wm = cl.clState.worldmodel;
	if (nodeC < 0) {
		// leaf: add an efrag unless it's the solid leaf
		const leafnum = -1 - nodeC;
		if (wm.leafContents[leafnum] === mod.CONTENTS.solid)
			return;
		wm.leafEfrags[leafnum] = { leafnext: wm.leafEfrags[leafnum], entity }
		return;
	}
	const base = nodeC * 16;
	var sides = vec.boxOnPlaneSide(emins, emaxs, wm.planes[wm.nodePlane[nodeC]]);
	if ((sides & 1) !== 0)
		splitEntityOnNode(wm.nodePackedI32[base + 13], entity, emins, emaxs);
	if ((sides & 2) !== 0)
		splitEntityOnNode(wm.nodePackedI32[base + 14], entity, emins, emaxs);
};

const storeEfrags = (efrag: EFrags) => {
	for(var _efrag = efrag; !!_efrag; _efrag = _efrag.leafnext) {
		var ent = _efrag.entity
		if (ent.visframe !== host.state.framecount && cl.state.numvisedicts < def.max_vis_edicts) {
			cl.state.visedicts[cl.state.numvisedicts++] = ent
			ent.visframe = host.state.framecount
		}
	}
}

// light
/*
==================
R_AnimateLight
==================
*/
const animateLight = () => {
	//
	// light animations
	// 'm' is normal light, 'a' is no light, 'z' is double bright
	var t = cl.clState.time * 10.0;
	var base = Math.floor(t);
	var i = base;
	var f = t - base;
	if (cvr.lerplightstyles.value === 0)
		f = 0.0;

	for (var j = 0; j < lm.MAX_LIGHTSTYLES; j++) {
		var val
		if (cvr.fullbright.value === 1 || cl.state.lightstyle[j].length === 0) {
			val = 264;
		}
		else {
			var idx = i % cl.state.lightstyle[j].length;
			var next = idx + 1;
			if (next === cl.state.lightstyle[j].length)
				next = 0;
			var k = cl.state.lightstyle[j].charCodeAt(idx) - 97; // 'a'
			var n = cl.state.lightstyle[j].charCodeAt(next) - 97; // 'a'
			// only interpolate abrupt changes (e.g. flickering light in e1m1) if r_lerplightstyles >= 2
			if (cvr.lerplightstyles.value < 2 && Math.abs(n - k) >= 6)
				n = k;
			val = (k * 22 + (n - k) * 22 * f) | 0;
		}
		//johnfitz
		if (lm.state.lightstylevalue[j] !== val) {
			lm.state.lightstylevalue[j] = val;
			lm.state.lightstyle_uniform_dirty = true
		}
	}
}

// renderDlights body (flashblend glow-ball fan + near-light v.blend accumulation) moved to
// WebGLRenderer.drawFlashblendDlights (render phase1 particle/flashblend slice). renderScene calls it
// through getRenderer(); the CPU dlight gather (gatherDlights, below) stays here.

export const gatherDlights = () => {
	state.numActiveDlights = 0;
	for (var i = 0; i < cl.state.dlights.length; ++i) {
		var dl = cl.state.dlights[i];
		if ((dl.die >= cl.clState.time) && (dl.radius !== 0.0))
			state.activeDlights[state.numActiveDlights++] = i;
	}

	// Pack active dlights for the Brush fragment shader's analytic accumulation.
	// Flashblend (glow-ball rendering) and r_dynamic 0 disable surface dlighting,
	// matching the old CPU overlay path's behavior.
	if (cvr.flashblend.value !== 0 || cvr.dynamic.value === 0) {
		state.numShaderDlights = 0;
	} else {
		state.numShaderDlights = state.numActiveDlights;
		for (i = 0; i < state.numActiveDlights; ++i) {
			var dl = cl.state.dlights[state.activeDlights[i]];
			var o = i * 4;
			state.dlightPosRadius[o] = dl.origin[0];
			state.dlightPosRadius[o + 1] = dl.origin[1];
			state.dlightPosRadius[o + 2] = dl.origin[2];
			state.dlightPosRadius[o + 3] = dl.radius;
			state.dlightColor[o] = dl.color[0];
			state.dlightColor[o + 1] = dl.color[1];
			state.dlightColor[o + 2] = dl.color[2];
			state.dlightColor[o + 3] = dl.minlight;
		}
	}
};

// nodeC is the flat child encoding: >= 0 is a node index, < 0 is a leaf
// (-1 - leafnum). Walks nodePacked so no Node objects are needed.
export const recursiveLightPoint = function (nodeC: number, start: V3, end: V3, cache: LightCache): 0 | -1 | 1 {
	if (nodeC < 0)
		return -1; // leaf: no lightmapped surface here

	const wm = cl.clState.worldmodel;
	const pf = wm.nodePacked, pi = wm.nodePackedI32;
	const base = nodeC * 16;
	var n0 = pf[base + 6], n1 = pf[base + 7], n2 = pf[base + 8], dist = pf[base + 9];
	var front = start[0] * n0 + start[1] * n1 + start[2] * n2 - dist;
	var back = end[0] * n0 + end[1] * n1 + end[2] * n2 - dist;
	var side = front < 0;
	const nearC = side ? pi[base + 14] : pi[base + 13];
	const farC = side ? pi[base + 13] : pi[base + 14];

	if ((back < 0) === side)
		return recursiveLightPoint(nearC, start, end, cache);

	var frac = front / (front - back);
	var mid: V3 = vec.scratch();
	mid[0] = start[0] + (end[0] - start[0]) * frac;
	mid[1] = start[1] + (end[1] - start[1]) * frac;
	mid[2] = start[2] + (end[2] - start[2]) * frac;

	var r = recursiveLightPoint(nearC, start, mid, cache);
	if (r !== 0 && r !== -1)
		return r;

	if ((back < 0) === side)
		return -1;

	const firstface = pi[base + 11], numfaces = pi[base + 12];
	var i, surf, tex, s, t, ds, dt;
	for (i = 0; i < numfaces; ++i) {
		surf = wm.faces[firstface + i];
		if ((surf.sky === true) || (surf.turbulent === true))
			continue;

		if (surf.decoupled) {
			// lmvecs project world->luxels directly (texturemins folded into .w).
			var lv = surf.lmvecs as Float32Array;
			ds = mid[0] * lv[0] + mid[1] * lv[1] + mid[2] * lv[2] + lv[3];
			dt = mid[0] * lv[4] + mid[1] * lv[5] + mid[2] * lv[6] + lv[7];
			if ((ds < 0) || (dt < 0))
				continue;
			if ((ds > surf.lmwidth - 1) || (dt > surf.lmheight - 1))
				continue;
			if (surf.lightofs === 0)
				return 0;
			ds = Math.floor(ds);
			dt = Math.floor(dt);
		} else {
			tex = wm.texinfo[surf.texinfo];

			s = vec.dotProductV3(mid, tex.vecs[0]) + tex.vecs[0][3];
			t = vec.dotProductV3(mid, tex.vecs[1]) + tex.vecs[1][3];
			if ((s < wm.faceTexturemins[surf.num * 2]) || (t < wm.faceTexturemins[surf.num * 2 + 1]))
				continue;

			ds = s - wm.faceTexturemins[surf.num * 2];
			dt = t - wm.faceTexturemins[surf.num * 2 + 1];
			if ((ds > wm.faceExtents[surf.num * 2]) || (dt > wm.faceExtents[surf.num * 2 + 1]))
				continue;

			if (surf.lightofs === 0)
				return 0;

			ds >>= surf.lmshift;
			dt >>= surf.lmshift;
		}

		cache.surf = firstface + i + 1;
		cache.ds = ds;
		cache.dt = dt;
		return 1;
	}
	return recursiveLightPoint(farC, mid, end, cache);
};

export const sampleLightmap = function (surfIdx: number, ds: number, dt: number, out: Color): Color {
	var wm = cl.clState.worldmodel;
	var surf = wm.faces[surfIdx - 1];
	var w = surf.decoupled ? surf.lmwidth : (wm.faceExtents[surf.num * 2] >> surf.lmshift) + 1;
	var h = surf.decoupled ? surf.lmheight : (wm.faceExtents[surf.num * 2 + 1] >> surf.lmshift) + 1;
	var lightmap = surf.lightofs + (dt * w + ds) * 3;
	var size = w * h * 3;

	out[0] = 0; out[1] = 0; out[2] = 0;
	for (var maps = 0; maps < wm.faceNumStyles[surf.num]; ++maps)
	{
		var sv = lm.state.lightstylevalue[wm.faceStyles[surf.num * 4 + maps]];
		out[0] += wm.lightdata[lightmap] * sv;
		out[1] += wm.lightdata[lightmap + 1] * sv;
		out[2] += wm.lightdata[lightmap + 2] * sv;
		lightmap += size;
	}

	out[0] = out[0] >> 8;
	out[1] = out[1] >> 8;
	out[2] = out[2] >> 8;
	return out;
};

// retryOfs (Ironwail r_alias.c, vkQuake #550): when the first trace hits nothing, retry from p.z + retryOfs
// (callers pass model maxs[2]*0.5) — lights models whose origin sits slightly below floor (DOTM candles).
export const lightPoint = function (p: V3, cache: LightCache, retryOfs = 0): Color {
	if (cl.clState.worldmodel.lightdata == null){
		const out = vec.scratch(); out[0] = 255; out[1] = 255; out[2] = 255;
		return out as Color;
	}

	if (cache.surf === 0 || Math.abs(cache.pos[0] - p[0]) >= 1 || Math.abs(cache.pos[1] - p[1]) >= 1 || Math.abs(cache.pos[2] - p[2]) >= 1) {
		cache.pos[0] = p[0]; cache.pos[1] = p[1]; cache.pos[2] = p[2];
		cache.surf = 0;

		const end = vec.scratch();
		// 8192 trace depth per Ironwail gl_rlight.c ("was 2048") — 2048 left entities unlit on tall maps
		end[0] = p[0]; end[1] = p[1]; end[2] = p[2] - 8192.0;
		let r = recursiveLightPoint(0, p, end, cache);

		if (r !== 1 && retryOfs > 0) {
			const start = vec.scratch();
			start[0] = p[0]; start[1] = p[1]; start[2] = p[2] + retryOfs;
			end[2] = start[2] - 8192.0;
			r = recursiveLightPoint(0, start, end, cache);
		}

		if (r !== 1)
			cache.surf = -1;
	}

	if (cache.surf > 0)
		return sampleLightmap(cache.surf, cache.ds, cache.dt, vec.scratch() as Color);

	const out = vec.scratch(); out[0] = 0; out[1] = 0; out[2] = 0;
	return out as Color;
};

// const cullBox = function(mins, maxs)
// {
// 	if (vec.boxOnPlaneSide(mins, maxs, state.frustum[0]) === 2)
// 		return true;
// 	if (vec.boxOnPlaneSide(mins, maxs, state.frustum[1]) === 2)
// 		return true;
// 	if (vec.boxOnPlaneSide(mins, maxs, state.frustum[2]) === 2)
// 		return true;
// 	if (vec.boxOnPlaneSide(mins, maxs, state.frustum[3]) === 2)
// 		return true;
// };

export const cullBox = function (emins: V3, emaxs: V3) {
	for (var i = 0; i < 4; i++) {
		var o = i * 4;
		var nx = state.frustumFlat[o], ny = state.frustumFlat[o + 1], nz = state.frustumFlat[o + 2], dist = state.frustumFlat[o + 3];
		var sb = state.frustumSignbits[i];
		var px = (sb & 1) !== 0 ? emins[0] : emaxs[0];
		var py = (sb & 2) !== 0 ? emins[1] : emaxs[1];
		var pz = (sb & 4) !== 0 ? emins[2] : emaxs[2];
		if (nx * px + ny * py + nz * pz < dist)
			return true;
	}
	return false;
};

// drawSpriteModel body (billboard quad stream) moved to WebGLRenderer (render phase1
// entity/alias/sprite slice). Called there by the drawEntities sprite sub-pass.

state.avertexnormals = [
	[-0.525731, 0.0, 0.850651],
	[-0.442863, 0.238856, 0.864188],
	[-0.295242, 0.0, 0.955423],
	[-0.309017, 0.5, 0.809017],
	[-0.16246, 0.262866, 0.951056],
	[0.0, 0.0, 1.0],
	[0.0, 0.850651, 0.525731],
	[-0.147621, 0.716567, 0.681718],
	[0.147621, 0.716567, 0.681718],
	[0.0, 0.525731, 0.850651],
	[0.309017, 0.5, 0.809017],
	[0.525731, 0.0, 0.850651],
	[0.295242, 0.0, 0.955423],
	[0.442863, 0.238856, 0.864188],
	[0.16246, 0.262866, 0.951056],
	[-0.681718, 0.147621, 0.716567],
	[-0.809017, 0.309017, 0.5],
	[-0.587785, 0.425325, 0.688191],
	[-0.850651, 0.525731, 0.0],
	[-0.864188, 0.442863, 0.238856],
	[-0.716567, 0.681718, 0.147621],
	[-0.688191, 0.587785, 0.425325],
	[-0.5, 0.809017, 0.309017],
	[-0.238856, 0.864188, 0.442863],
	[-0.425325, 0.688191, 0.587785],
	[-0.716567, 0.681718, -0.147621],
	[-0.5, 0.809017, -0.309017],
	[-0.525731, 0.850651, 0.0],
	[0.0, 0.850651, -0.525731],
	[-0.238856, 0.864188, -0.442863],
	[0.0, 0.955423, -0.295242],
	[-0.262866, 0.951056, -0.16246],
	[0.0, 1.0, 0.0],
	[0.0, 0.955423, 0.295242],
	[-0.262866, 0.951056, 0.16246],
	[0.238856, 0.864188, 0.442863],
	[0.262866, 0.951056, 0.16246],
	[0.5, 0.809017, 0.309017],
	[0.238856, 0.864188, -0.442863],
	[0.262866, 0.951056, -0.16246],
	[0.5, 0.809017, -0.309017],
	[0.850651, 0.525731, 0.0],
	[0.716567, 0.681718, 0.147621],
	[0.716567, 0.681718, -0.147621],
	[0.525731, 0.850651, 0.0],
	[0.425325, 0.688191, 0.587785],
	[0.864188, 0.442863, 0.238856],
	[0.688191, 0.587785, 0.425325],
	[0.809017, 0.309017, 0.5],
	[0.681718, 0.147621, 0.716567],
	[0.587785, 0.425325, 0.688191],
	[0.955423, 0.295242, 0.0],
	[1.0, 0.0, 0.0],
	[0.951056, 0.16246, 0.262866],
	[0.850651, -0.525731, 0.0],
	[0.955423, -0.295242, 0.0],
	[0.864188, -0.442863, 0.238856],
	[0.951056, -0.16246, 0.262866],
	[0.809017, -0.309017, 0.5],
	[0.681718, -0.147621, 0.716567],
	[0.850651, 0.0, 0.525731],
	[0.864188, 0.442863, -0.238856],
	[0.809017, 0.309017, -0.5],
	[0.951056, 0.16246, -0.262866],
	[0.525731, 0.0, -0.850651],
	[0.681718, 0.147621, -0.716567],
	[0.681718, -0.147621, -0.716567],
	[0.850651, 0.0, -0.525731],
	[0.809017, -0.309017, -0.5],
	[0.864188, -0.442863, -0.238856],
	[0.951056, -0.16246, -0.262866],
	[0.147621, 0.716567, -0.681718],
	[0.309017, 0.5, -0.809017],
	[0.425325, 0.688191, -0.587785],
	[0.442863, 0.238856, -0.864188],
	[0.587785, 0.425325, -0.688191],
	[0.688191, 0.587785, -0.425325],
	[-0.147621, 0.716567, -0.681718],
	[-0.309017, 0.5, -0.809017],
	[0.0, 0.525731, -0.850651],
	[-0.525731, 0.0, -0.850651],
	[-0.442863, 0.238856, -0.864188],
	[-0.295242, 0.0, -0.955423],
	[-0.16246, 0.262866, -0.951056],
	[0.0, 0.0, -1.0],
	[0.295242, 0.0, -0.955423],
	[0.16246, 0.262866, -0.951056],
	[-0.442863, -0.238856, -0.864188],
	[-0.309017, -0.5, -0.809017],
	[-0.16246, -0.262866, -0.951056],
	[0.0, -0.850651, -0.525731],
	[-0.147621, -0.716567, -0.681718],
	[0.147621, -0.716567, -0.681718],
	[0.0, -0.525731, -0.850651],
	[0.309017, -0.5, -0.809017],
	[0.442863, -0.238856, -0.864188],
	[0.16246, -0.262866, -0.951056],
	[0.238856, -0.864188, -0.442863],
	[0.5, -0.809017, -0.309017],
	[0.425325, -0.688191, -0.587785],
	[0.716567, -0.681718, -0.147621],
	[0.688191, -0.587785, -0.425325],
	[0.587785, -0.425325, -0.688191],
	[0.0, -0.955423, -0.295242],
	[0.0, -1.0, 0.0],
	[0.262866, -0.951056, -0.16246],
	[0.0, -0.850651, 0.525731],
	[0.0, -0.955423, 0.295242],
	[0.238856, -0.864188, 0.442863],
	[0.262866, -0.951056, 0.16246],
	[0.5, -0.809017, 0.309017],
	[0.716567, -0.681718, 0.147621],
	[0.525731, -0.850651, 0.0],
	[-0.238856, -0.864188, -0.442863],
	[-0.5, -0.809017, -0.309017],
	[-0.262866, -0.951056, -0.16246],
	[-0.850651, -0.525731, 0.0],
	[-0.716567, -0.681718, -0.147621],
	[-0.716567, -0.681718, 0.147621],
	[-0.525731, -0.850651, 0.0],
	[-0.5, -0.809017, 0.309017],
	[-0.238856, -0.864188, 0.442863],
	[-0.262866, -0.951056, 0.16246],
	[-0.864188, -0.442863, 0.238856],
	[-0.809017, -0.309017, 0.5],
	[-0.688191, -0.587785, 0.425325],
	[-0.681718, -0.147621, 0.716567],
	[-0.442863, -0.238856, 0.864188],
	[-0.587785, -0.425325, 0.688191],
	[-0.309017, -0.5, 0.809017],
	[-0.147621, -0.716567, 0.681718],
	[-0.425325, -0.688191, 0.587785],
	[-0.16246, -0.262866, 0.951056],
	[0.442863, -0.238856, 0.864188],
	[0.16246, -0.262866, 0.951056],
	[0.309017, -0.5, 0.809017],
	[0.147621, -0.716567, 0.681718],
	[0.0, -0.525731, 0.850651],
	[0.425325, -0.688191, 0.587785],
	[0.587785, -0.425325, 0.688191],
	[0.688191, -0.587785, 0.425325],
	[-0.955423, 0.295242, 0.0],
	[-0.951056, 0.16246, 0.262866],
	[-1.0, 0.0, 0.0],
	[-0.850651, 0.0, 0.525731],
	[-0.955423, -0.295242, 0.0],
	[-0.951056, -0.16246, 0.262866],
	[-0.864188, 0.442863, -0.238856],
	[-0.951056, 0.16246, -0.262866],
	[-0.809017, 0.309017, -0.5],
	[-0.864188, -0.442863, -0.238856],
	[-0.951056, -0.16246, -0.262866],
	[-0.809017, -0.309017, -0.5],
	[-0.681718, 0.147621, -0.716567],
	[-0.681718, -0.147621, -0.716567],
	[-0.850651, 0.0, -0.525731],
	[-0.688191, 0.587785, -0.425325],
	[-0.587785, 0.425325, -0.688191],
	[-0.425325, 0.688191, -0.587785],
	[-0.425325, -0.688191, -0.587785],
	[-0.587785, -0.425325, -0.688191],
	[-0.688191, -0.587785, -0.425325]
];

// Persistent, load-time constant — never mutated.
const negX: V3 = [-1.0, 0.0, 0.0];

const clamp = (min: number, v: number, max: number) => v < min ? min : (v > max ? max : v)

// Port of Ironwail R_SetupAliasFrame (r_alias.c:84-149): resolves this draw's pose
// via the same frame/framegroup pick logic as before, updates the entity's pose-lerp
// bookkeeping, and writes the resulting blend into state.aliasLerp.
export const setupAliasFrame = function (e: Entity, clmodel: Model) {
	var num = e.frame, i, fullinterval, targettime;
	if ((num >= clmodel.numframes) || (num < 0)) {
		// QSS-M R_AliasSetupFrame names the model — without it a bad-precache model is undebuggable
		con.dPrint('R.DrawAliasModel: no such frame ' + num + ' for \'' + clmodel.name + '\'\n');
		num = 0;
	}
	var time = cl.clState.time + e.syncbase;
	var frame = clmodel.frames[num] as AliasFrame | AliasFrameGroup;
	var isGroup = frame.group === true;
	if (isGroup) {
		var group = frame as AliasFrameGroup;
		num = group.frames.length - 1;
		fullinterval = group.frames[num].interval;
		targettime = time - Math.floor(time / fullinterval) * fullinterval;
		for (i = 0; i < num; ++i) {
			if (group.frames[i].interval > targettime)
				break;
		}
		frame = group.frames[i];
		e.lerptime = group.frames[0].interval;
	}
	else
		e.lerptime = 0.1;
	var posenum = (frame as AliasFrame).cmdofs;

	if ((e.lerpflags & LERP.resetanim) !== 0) { // kill any lerp in progress
		e.lerpstart = 0;
		e.previouspose = posenum;
		e.currentpose = posenum;
		e.lerpflags &= ~LERP.resetanim;
	}
	else if (e.currentpose !== posenum) { // pose changed, start new lerp
		if ((e.lerpflags & LERP.resetanim2) !== 0) { // defer lerping one more time
			e.lerpstart = 0;
			e.previouspose = posenum;
			e.currentpose = posenum;
			e.lerpflags &= ~LERP.resetanim2;
		}
		else {
			e.lerpstart = cl.clState.time;
			e.previouspose = e.currentpose;
			e.currentpose = posenum;
		}
	}

	if (e.previouspose < 0) // never-drawn entity that skipped the resetanim paths
		e.previouspose = e.currentpose;

	var lerp = state.aliasLerp;
	if (cvr.lerpmodels.value !== 0 && !(clmodel.nolerp && cvr.lerpmodels.value !== 2)) {
		if ((e.lerpflags & LERP.finish) !== 0 && !isGroup)
			lerp.blend = clamp(0, (cl.clState.time - e.lerpstart) / (e.lerpfinish - e.lerpstart), 1);
		else
			lerp.blend = clamp(0, (cl.clState.time - e.lerpstart) / e.lerptime, 1);
		if (lerp.blend === 1)
			e.previouspose = e.currentpose;
		lerp.pose1ofs = e.previouspose;
		lerp.pose2ofs = e.currentpose;
	}
	else { // don't lerp
		lerp.blend = 1;
		lerp.pose1ofs = posenum;
		lerp.pose2ofs = posenum;
	}
};

// Port of Ironwail R_SetupEntityTransform (r_alias.c:156-211): resolves the
// MOVETYPE_STEP origin/angle lerp state and writes the blended transform into
// originOut/anglesOut (vec.ts out-param convention).
export const setupEntityTransform = function (e: Entity, originOut: V3, anglesOut: V3): V3 {
	if ((e.lerpflags & LERP.resetmove) !== 0) { // kill any lerps in progress
		e.movelerpstart = 0;
		vec.copy(e.origin, e.previousorigin);
		vec.copy(e.origin, e.currentorigin);
		vec.copy(e.angles, e.previousangles);
		vec.copy(e.angles, e.currentangles);
		e.lerpflags &= ~LERP.resetmove;
	}
	else if (e.origin[0] !== e.currentorigin[0] || e.origin[1] !== e.currentorigin[1] || e.origin[2] !== e.currentorigin[2] ||
		e.angles[0] !== e.currentangles[0] || e.angles[1] !== e.currentangles[1] || e.angles[2] !== e.currentangles[2]) { // origin/angles changed, start new lerp
		e.movelerpstart = cl.clState.time;
		vec.copy(e.currentorigin, e.previousorigin);
		vec.copy(e.origin, e.currentorigin);
		vec.copy(e.currentangles, e.previousangles);
		vec.copy(e.angles, e.currentangles);
	}

	if (cvr.lerpmove.value !== 0 && e !== cl.clState.viewent && (e.lerpflags & LERP.movestep) !== 0) {
		var blend: number;
		if ((e.lerpflags & LERP.finish) !== 0)
			blend = clamp(0, (cl.clState.time - e.movelerpstart) / (e.lerpfinish - e.movelerpstart), 1);
		else
			blend = clamp(0, (cl.clState.time - e.movelerpstart) / 0.1, 1);

		originOut[0] = e.previousorigin[0] + (e.currentorigin[0] - e.previousorigin[0]) * blend;
		originOut[1] = e.previousorigin[1] + (e.currentorigin[1] - e.previousorigin[1]) * blend;
		originOut[2] = e.previousorigin[2] + (e.currentorigin[2] - e.previousorigin[2]) * blend;

		var d;
		d = e.currentangles[0] - e.previousangles[0];
		if (d > 180) d -= 360; else if (d < -180) d += 360;
		anglesOut[0] = e.previousangles[0] + d * blend;

		d = e.currentangles[1] - e.previousangles[1];
		if (d > 180) d -= 360; else if (d < -180) d += 360;
		anglesOut[1] = e.previousangles[1] + d * blend;

		d = e.currentangles[2] - e.previousangles[2];
		if (d > 180) d -= 360; else if (d < -180) d += 360;
		anglesOut[2] = e.previousangles[2] + d * blend;
	}
	else { // don't lerp
		vec.copy(e.origin, originOut);
		vec.copy(e.angles, anglesOut);
	}
	return originOut;
};

// drawAliasModel / drawEntitiesOnList / drawViewModel bodies (the entity/alias/sprite/viewmodel
// gl.* submission) moved to WebGLRenderer.drawEntities / drawViewModel (render phase1
// entity/alias/sprite slice). The backend-agnostic CPU helpers they call — cullBox,
// setupEntityTransform, setupAliasFrame, lightPoint — stay here and are exported for the backend;
// brush-type entities still dispatch back through the exported drawBrushModel (below).

// polyBlend moved to WebGLRenderer.polyBlend (render phase1 frame-skeleton slice).

export const setFrustum = function () {
	vec.rotatePointAroundVector(state.vup, state.vpn, -(90.0 - state.refdef.fov_x * 0.5), state.frustum[0].normal);
	vec.rotatePointAroundVector(state.vup, state.vpn, 90.0 - state.refdef.fov_x * 0.5, state.frustum[1].normal);
	vec.rotatePointAroundVector(state.vright, state.vpn, 90.0 - state.refdef.fov_y * 0.5, state.frustum[2].normal);
	// the fourth plane was missing since the original port -- everything below/above (per
	// sign) was never culled, which also masked bad model radii on that edge
	vec.rotatePointAroundVector(state.vright, state.vpn, -(90.0 - state.refdef.fov_y * 0.5), state.frustum[3].normal);

	var i, out;
	for (i = 0; i <= 3; ++i) {
		out = state.frustum[i];
		out.type = 5;
		out.dist = vec.dotProductV3(state.refdef.vieworg, out.normal);
		out.signbits = 0;
		if (out.normal[0] < 0.0)
			out.signbits = 1;
		if (out.normal[1] < 0.0)
			out.signbits += 2;
		if (out.normal[2] < 0.0)
			out.signbits += 4;

		state.frustumFlat[i * 4] = out.normal[0];
		state.frustumFlat[i * 4 + 1] = out.normal[1];
		state.frustumFlat[i * 4 + 2] = out.normal[2];
		state.frustumFlat[i * 4 + 3] = out.dist;
		state.frustumSignbits[i] = out.signbits;
	}
};


// Fill a 9-element column-major mat3 from refdef.viewangles — the view rotation both perspective()
// (WebGL uniform broadcast) and updateFrameGlobals() (WebGPU uniform buffer) need. Single-sourced so
// the two backends stay bit-identical. `out` is number[] (state.viewMatrix) or Float32Array (globals).
export const computeViewMatrix = function (out: number[] | Float32Array) {
	var viewangles = state.viewAnglesRad;
	viewangles[0] = state.refdef.viewangles[0] * Math.PI / 180.0;
	viewangles[1] = (state.refdef.viewangles[1] - 90.0) * Math.PI / -180.0;
	viewangles[2] = state.refdef.viewangles[2] * Math.PI / -180.0;
	var sp = Math.sin(viewangles[0]);
	var cp = Math.cos(viewangles[0]);
	var sy = Math.sin(viewangles[1]);
	var cy = Math.cos(viewangles[1]);
	var sr = Math.sin(viewangles[2]);
	var cr = Math.cos(viewangles[2]);
	out[0] = cr * cy + sr * sp * sy; out[1] = cp * sy; out[2] = -sr * cy + cr * sp * sy;
	out[3] = cr * -sy + sr * sp * cy; out[4] = cp * cy; out[5] = -sr * -sy + cr * sp * cy;
	out[6] = sr * cp; out[7] = -sp; out[8] = cr * cp;
};

// Refresh state.frameGlobals from the same values perspective() uploads, for backends (WebGPU) that
// consume the struct instead of the per-program GL broadcast. Reuses the persistent Float32Arrays —
// no per-frame allocation. Called in renderScene before beginScene; the WebGL2 path never reads it.
export const updateFrameGlobals = function () {
	const fg = state.frameGlobals;
	computeViewMatrix(fg.viewAngles);
	var o = state.refdef.vieworg;
	fg.viewOrigin[0] = o[0]; fg.viewOrigin[1] = o[1]; fg.viewOrigin[2] = o[2];
	var p = state.perspective;
	for (var i = 0; i < 16; i++) fg.perspective[i] = p[i];
	fg.vpn[0] = state.vpn[0]; fg.vpn[1] = state.vpn[1]; fg.vpn[2] = state.vpn[2];
	// Clamp to the usable range (and write back, so the menu slider shows the applied value).
	// Backend-agnostic: gamma 0 would otherwise blow every shader's pow(rgb, gamma) to white.
	if (v.cvr.gamma.value < 0.2) cvar.setValue('gamma', 0.2);
	else if (v.cvr.gamma.value > 1.0) cvar.setValue('gamma', 1.0);
	fg.gamma = v.cvr.gamma.value;
};

// perspective() (the WebGL per-program view/projection/gamma uniform broadcast) moved to
// WebGLRenderer.beginScene (render phase3 slice). computeViewMatrix + state.perspective/vpn/viewMatrix
// stay here as shared scene data; WebGPU consumes them via updateFrameGlobals/FrameGlobals.

// setupGL body moved to WebGLRenderer.beginScene (render phase1 frame-skeleton slice).

// let array = []
// let lastREport = 0
// const perf = (start, end) => {
// 	let ms = end - start
// 	if(array.length> 50) {
// 		array.pop()
// 	}
// 	array.push(ms)
// 	if (end - lastREport > 1000) {
// 		lastREport = end
// 		console.log('Performance: ' + ((array.reduce((partialSum, a) => partialSum + a, 0)) / array.length).toFixed(2))
// 	}
// }
export const renderScene = function () {
	animateLight();
	vec.angleVectors(state.refdef.viewangles, state.vpn, state.vright, state.vup);
	state.viewleaf = mod.pointInLeaf(state.refdef.vieworg, cl.clState.worldmodel);
	const viewleafContents = cl.clState.worldmodel.leafContents[state.viewleaf];
	v.setContentsColor(viewleafContents);
	v.calcBlend();
	state.dowarp = (cvr.waterwarp.value !== 0) && (viewleafContents <= mod.CONTENTS.water) && (state.warpSupported !== false);
	setFrustum();
	// beginScene ← former setupGL (warp-FBO redirect / viewport / perspective broadcast / depth
	// enable). Mutate the persistent SceneSetup in place (no per-frame allocation in this hot path).
	state.sceneSetup.x = state.refdef.vrect.x;
	state.sceneSetup.y = state.refdef.vrect.y;
	state.sceneSetup.width = state.refdef.vrect.width;
	state.sceneSetup.height = state.refdef.vrect.height;
	state.sceneSetup.dowarp = state.dowarp;
	// Refresh the persistent FrameGlobals (view basis/projection) from the same values perspective()
	// broadcasts, and hand them to the backend. WebGL2 ignores them (perspective() still runs inside
	// its beginScene); WebGPU uploads them to its world uniform buffer.
	updateFrameGlobals();
	getRenderer().beginScene(state.sceneSetup, state.frameGlobals);
	var rs_t = performance.now();
	// Decoupled GPU-cull mode (WebGPU + r_gpucull + cull data built — checked AFTER beginScene, which
	// builds the per-map cull data): the compute cull is the world's visibility, so skip the CPU
	// markSurfaces chain-stamping + the markWorldFrustum walk it would duplicate. Only the efrag gather
	// (static entities, PVS-driven) and the sky gather (cull.skyFaces in the backend) remain CPU-side.
	if (getRenderer().gpuCullActive()) {
		markEfrags();
		state.rs_markms = performance.now() - rs_t;
		state.rs_walkms = 0;
	} else {
		markSurfaces();
		state.rs_markms = performance.now() - rs_t;
		rs_t = performance.now();
		markWorldFrustum();
		state.rs_walkms = performance.now() - rs_t;
	}
	// Back-face culling brackets the opaque world/entity draws but not the billboarded particles/
	// flashblend that follow. The toggle is WebGL GL state (WebGPU sets cull per-pipeline), so it now
	// lives in the WebGL backend: drawSky enables CULL_FACE, drawFlashblendDlights disables it — keeping
	// the exact same enable-before-sky / disable-before-flashblend transitions this loop used to make.
	getRenderer().drawSky();
	getRenderer().drawViewModel(cl.clState.viewent);
	getRenderer().drawWorldSurfaces(cl.clState.worldmodel, null, 'solid');
	getRenderer().drawEntities(false);
	getRenderer().drawWorldSurfaces(cl.clState.worldmodel, null, 'litwater');
	getRenderer().drawWorldSurfaces(cl.clState.worldmodel, null, 'turb');
	getRenderer().drawEntities(true);
	getRenderer().drawFlashblendDlights();
	runParticles();
	getRenderer().drawClassicParticles();
	pscript.runPScriptParticles();
	getRenderer().drawScriptParticles();
};

export const renderView = function () {
	// During a map change mod.clearAll guts the old worldmodel while the client
	// can still be connected for a few frames (async spawnServer yields) — don't
	// walk a gutted world; the loading plaque/console covers the screen.
	if (!cl.clState.worldmodel || (cl.clState.worldmodel as any).nodes == null)
		return;
	var time1;
	if (cvr.speeds.value !== 0)
		time1 = sys.floatTime();
	state.c_brush_verts = 0;
	state.c_alias_polys = 0;
	state.rs_rebuilds = 0;
	getRenderer().clearFrame(true, true);

	// Skyroom (_skyroom): draw the world once from the skyroom camera into color+depth,
	// then clear only depth so the main pass composites over it through the sky windows.
	// Gated on a sky surface having been visible last frame (QSS gl_rmain.c:1208 R_RenderView).
	sky.state.skyroom_drawn = false;
	if (sky.state.skyroom_enabled && sky.state.skyVisibleLastFrame && cl.clState.worldmodel) {
		vec.copy(state.refdef.vieworg, state.skyroomSaveOrg);
		vec.copy(state.refdef.viewangles, state.skyroomSaveAng);
		// vieworg = skyroom_origin + parallax * mainvieworg (QSS VectorMA, gl_rmain.c:1216);
		// angles unchanged (spin/orientation parsed but not applied — minimal key first).
		var sr = sky.state.skyroom_origin;
		state.refdef.vieworg[0] = sr[0] + sr[3] * state.skyroomSaveOrg[0];
		state.refdef.vieworg[1] = sr[1] + sr[3] * state.skyroomSaveOrg[1];
		state.refdef.vieworg[2] = sr[2] + sr[3] * state.skyroomSaveOrg[2];
		sky.state.skyroom_drawing = true;
		renderScene();
		sky.state.skyroom_drawing = false;
		vec.copy(state.skyroomSaveOrg, state.refdef.vieworg);
		vec.copy(state.skyroomSaveAng, state.refdef.viewangles);
		sky.state.skyroom_drawn = true;
		getRenderer().clearFrame(false, true); // keep skyroom color, reset depth for the main view
	}

	// reset the sky-visible accumulator; drawSkyBox sets it when a sky surface draws
	sky.state.skyVisibleThisFrame = false;
	renderScene();
	// 1-frame-lagged gate for next frame; never render a skyroom from inside the void
	sky.state.skyVisibleLastFrame = cl.clState.worldmodel.leafContents[state.viewleaf] === mod.CONTENTS.solid
		? false : sky.state.skyVisibleThisFrame;
	sky.state.skyroom_drawn = false;
	if (cvr.speeds.value !== 0) {
		var time2 = Math.floor((sys.floatTime() - time1) * 1000.0);
		var c_brush_polys = state.c_brush_verts / 3;
		var c_alias_polys = state.c_alias_polys;
		var message = ((time2 >= 100) ? '' : ((time2 >= 10) ? ' ' : '  ')) + time2 + ' ms  ';
		message += ((c_brush_polys >= 1000) ? '' : ((c_brush_polys >= 100) ? ' ' : ((c_brush_polys >= 10) ? '  ' : '   '))) + c_brush_polys + ' wpoly ';
		message += ((c_alias_polys >= 1000) ? '' : ((c_alias_polys >= 100) ? ' ' : ((c_alias_polys >= 10) ? '  ' : '   '))) + c_alias_polys + ' epoly ';
		message += 'mark ' + state.rs_markms.toFixed(1) + ' walk ' + state.rs_walkms.toFixed(1) + (state.rs_rebuilds ? ' REBUILD' : '') + '\n';
		con.print(message);
	}
};

// misc

export const initTextures = function () {
	const gl = GL.getContext()
	var data = new Uint8Array(new ArrayBuffer(256));
	var i, j;
	for (i = 0; i < 8; ++i) {
		for (j = 0; j < 8; ++j) {
			data[(i << 4) + j] = data[136 + (i << 4) + j] = 255;
			data[8 + (i << 4) + j] = data[128 + (i << 4) + j] = 0;
		}
	}
	state.notexture_mip = tx.createNoTexture(gl)
	tx.bind(0, state.notexture_mip.texturenum);
	tx.upload(data, 16, 16);

	state.solidskytexture = gl.createTexture();
	tx.bind(0, state.solidskytexture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

	state.alphaskytexture = gl.createTexture();
	tx.bind(0, state.alphaskytexture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

	state.null_texture = gl.createTexture();
	tx.bind(0, state.null_texture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
};

export const init = function () {
	// fresh GL context (first init or game-view remount): any previously built
	// VBO/lightmap textures belong to the dead context, force a rebuild
	state.builtWorldmodel = null
	initTextures();

	cmd.addCommand('timerefresh', timeRefresh_f);
	cmd.addCommand('pointfile', readPointFile_f);

	cvr.waterwarp = cvar.registerVariable('r_waterwarp', '1');
	cvr.fullbright = cvar.registerVariable('r_fullbright', '0');
	cvr.drawentities = cvar.registerVariable('r_drawentities', '1');
	cvr.drawviewmodel = cvar.registerVariable('r_drawviewmodel', '1');
	cvr.novis = cvar.registerVariable('r_novis', '0');
	cvr.speeds = cvar.registerVariable('r_speeds', '0');
	cvr.polyblend = cvar.registerVariable('gl_polyblend', '1');
	cvr.flashblend = cvar.registerVariable('gl_flashblend', '0');
	cvr.nocolors = cvar.registerVariable('gl_nocolors', '0');
	cvr.overbright = cvar.registerVariable('gl_overbright', '1');
	cvr.fullbrights = cvar.registerVariable('gl_fullbrights', '1');
	cvr.oldskyleaf = cvar.registerVariable('r_oldskyleaf', '0')
	cvr.flatlightstyles = cvar.registerVariable('r_flatlightstyles', '0')
	cvr.lerplightstyles = cvar.registerVariable('r_lerplightstyles', '1', true)
  cvr.litwater = cvar.registerVariable('r_litwater', '1')
  cvr.wateralpha = cvar.registerVariable('r_wateralpha', '1')
  cvr.lavaalpha = cvar.registerVariable('r_lavaalpha', '0')
  cvr.telealpha = cvar.registerVariable('r_telealpha', '0')
  cvr.slimealpha = cvar.registerVariable('r_slimealpha', '0')
  cvr.dynamic = cvar.registerVariable('r_dynamic', '1')
  cvr.test = cvar.registerVariable('r_test', '0')
  cvr.lerpmodels = cvar.registerVariable('r_lerpmodels', '1')
  cvr.lerpmove = cvar.registerVariable('r_lerpmove', '1')
  // WebGPU-only: route world visibility+index-gathering through a GPU compute cull + one
  // drawIndexedIndirect per texture batch (render/webgpu/gpuCull.ts). 1 (default) = the GPU compute-cull
  // path for ALL world passes (solid + fence + lit water + turb; sky stays CPU) — skips the CPU
  // markSurfaces chain rebuild and frustum walk entirely. 0 = the verified CPU chain path (fallback).
  cvr.gpucull = cvar.registerVariable('r_gpucull', '1')
  // WebGPU-only (Ironwail bmodel instancing): fold brush ENTITIES (doors/plats/func_ brushwork and
  // external .bsp brush models) into the GPU-driven path — their triangles are baked per (texture, fence)
  // at map load into one shared index buffer, and a frame only uploads per-entity transforms, so the CPU
  // pays no per-face backface walk, no chain rebuild and no per-frame index upload. Entities sharing a
  // model+frame draw as ONE instanced call. Requires r_gpucull; 0 = the verified per-face chain path.
  cvr.gpucullents = cvar.registerVariable('r_gpucullents', '1')
  // WebGPU-only (Ironwail-style): draw runs of consecutive same-(model, skin) opaque alias entities as
  // ONE instanced draw, pulling vertices from the model VBO as a storage buffer. 0 = the per-entity
  // draw path for every alias model.
  cvr.instancedmodels = cvar.registerVariable('r_instancedmodels', '1')
  // Ironwail/QS r_scale: render the 3D view at 1/N resolution (integer divisor, clamped 1..4) and
  // upscale; the 2D layer (HUD/console/menu) stays native. WebGPU-only (the WebGL2 backend ignores it).
  // For fill-rate/bandwidth-bound GPUs (iGPUs on big maps) — trades sharpness for per-pixel cost.
  cvr.scale = cvar.registerVariable('r_scale', '1', true)

	cvar.registerChangedEvent('r_novis', () => state.vis_changed = true)
	
	initParticles();
	pscript.init();

	getRenderer().initResources();

	makeSky();
};

export const newMap = function () {
	const gl = GL.getContext()
	var i;
	for (i = 0; i < 64; ++i)
		lm.state.lightstylevalue[i] = 264;

	clearParticles();
	pscript.clearPScriptParticles();
	pscript.loadWorldWeather();  // async; guards internally against map changes racing its loads
	state.oldviewleaf = -1
	state.cached_vis = null
	state.efragCacheWorld = null
	lm.init()
	mapAlpha.parseWorldspawn()
	fog.parseWorldspawn()
	sky.parseWorldspawn()

	// Same worldmodel respawned into the same GL context (savegame load,
	// restart, same-map changelevel): its VBO + lightmap textures are still
	// valid, so skip the geometry rebuild — on a huge map that rebuild is a
	// transient ~344MB Float32Array (VBO) plus lightmap staging, enough to blow
	// the heap when respawning an already-near-ceiling map. The world reuse in
	// mod.clearAll is what keeps the model object identity across the respawn.
	if (state.builtWorldmodel !== cl.clState.worldmodel || state.model_vbo == null) {
		for (i = 1; i < cl.clState.model_precache.length; ++i) {
			var model = cl.clState.model_precache[i];
			if (model.type !== mod.TYPE.brush)
				continue;
			if (model.name.charCodeAt(0) !== 42) {
				lm.buildLightmaps(gl, model);
				buildSurfaceDisplayLists(model)
			}
		}

		lm.freeStagingSlots()

		// WebGPU lightmap-array consolidation: build the compact per-style layer maps now — after every
		// model's lightmaps exist and before buildModelVertexBuffer reads them for the per-vertex layer
		// stream. WebGPU-only (the maps are consumed only by the WebGPU backend).
		if (getRenderer().backend === 'webgpu')
			lm.buildLightmapArrays()

		buildModelVertexBuffer(gl)
		state.builtWorldmodel = cl.clState.worldmodel

		// Force the GPU to process all queued uploads (lightmaps, VBOs) now,
		// during loading, rather than deferring to the first 3D draw call
		// which would cause a ~400ms stall at the start of gameplay.
		gl.flush()
	}
};

export const timeRefresh_f = function () {
	const gl = GL.getContext()
	gl.finish();
	var i;
	var start = sys.floatTime();
	for (i = 0; i <= 127; ++i) {
		state.refdef.viewangles[1] = i * 2.8125;
		renderView();
	}
	gl.finish();
	var time = sys.floatTime() - start;
	con.print(time.toFixed(6) + ' seconds (' + (128.0 / time).toFixed(6) + ' fps)\n');
};

// part

const PTYPE = {
	tracer: 0,
	grav: 1,
	slowgrav: 2,
	fire: 3,
	explode: 4,
	explode2: 5,
	blob: 6,
	blob2: 7
};

state.ramp1 = [0x6f, 0x6d, 0x6b, 0x69, 0x67, 0x65, 0x63, 0x61];
state.ramp2 = [0x6f, 0x6e, 0x6d, 0x6c, 0x6b, 0x6a, 0x68, 0x66];
state.ramp3 = [0x6d, 0x6b, 6, 5, 4, 3];

export const initParticles = function () {
	const gl = GL.getContext()
	var i = com.checkParm('-particles');
	if (i != null) {
		state.numparticles = q.atoi(com.state.argv[i + 1]);
		if (state.numparticles < 512)
			state.numparticles = 512;
	}
	else
		state.numparticles = 2048;

	state.avelocities = [];
	for (i = 0; i <= 161; ++i)
		state.avelocities[i] = [Math.random() * 2.56, Math.random() * 2.56, Math.random() * 2.56];

	state.particleOrg = new Float32Array(state.numparticles * 3);
	state.particleVel = new Float32Array(state.numparticles * 3);
	state.particleRamp = new Float32Array(state.numparticles);
	state.particleDie = new Float32Array(state.numparticles);
	state.particleColor = new Uint8Array(state.numparticles);
	state.particleType = new Uint8Array(state.numparticles);
	state.numActiveParticles = 0;

	state.particleInstanceData = new ArrayBuffer(state.numparticles * 16);
	state.particleInstanceFloats = new Float32Array(state.particleInstanceData);
	state.particleInstanceBytes = new Uint8Array(state.particleInstanceData);

	GL.createProgram('Particle',
		['uViewOrigin', 'uViewAngles', 'uPerspective', 'uGamma', 'uVpn', 'uFogDensity', 'uFogColor'],
		[
			createAttribParam('aCorner', gl.FLOAT, 2),
			createAttribParam('aOrigin', gl.FLOAT, 3),
			createAttribParam('aColor', gl.UNSIGNED_BYTE, 4, true)
		],
		[]);

	state.particleCornerBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, state.particleCornerBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1.0, -1.0, -1.0, 1.0, 1.0, -1.0, 1.0, 1.0]), gl.STATIC_DRAW);

	state.particleInstanceBuffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, state.particleInstanceBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, state.particleInstanceData.byteLength, gl.DYNAMIC_DRAW);
};

// Internal slot allocator: reserves the next free particle index, or -1 if
// the pool is full.
const spawnParticle = function (): number {
	if (state.numActiveParticles >= state.numparticles)
		return -1;
	return state.numActiveParticles++;
};

// Allocates a particle and writes all its SoA fields in one place. Returns
// false when the pool is full (emission dropped).
const emitParticle = (ox: number, oy: number, oz: number, vx: number, vy: number, vz: number, die: number, color: number, ramp: number, type: number): boolean => {
	var idx = spawnParticle();
	if (idx < 0)
		return false;
	var i3 = idx * 3;
	state.particleOrg[i3] = ox;
	state.particleOrg[i3 + 1] = oy;
	state.particleOrg[i3 + 2] = oz;
	state.particleVel[i3] = vx;
	state.particleVel[i3 + 1] = vy;
	state.particleVel[i3 + 2] = vz;
	state.particleDie[idx] = die;
	state.particleColor[idx] = color;
	state.particleRamp[idx] = ramp;
	state.particleType[idx] = type;
	return true;
};

export const entityParticles = function (ent: Entity) {
	var angle, sp, sy, cp, cy;
	for (var i = 0; i <= 161; ++i) {
		angle = cl.clState.time * state.avelocities[i][0];
		sp = Math.sin(angle);
		cp = Math.cos(angle);
		angle = cl.clState.time * state.avelocities[i][1];
		sy = Math.sin(angle);
		cy = Math.cos(angle);

		var ox = ent.origin[0] + state.avertexnormals[i][0] * 64.0 + cp * cy * 16.0;
		var oy = ent.origin[1] + state.avertexnormals[i][1] * 64.0 + cp * sy * 16.0;
		var oz = ent.origin[2] + state.avertexnormals[i][2] * 64.0 + sp * -16.0;
		if (!emitParticle(ox, oy, oz, 0.0, 0.0, 0.0, cl.clState.time + 0.01, 0x6f, 0.0, PTYPE.explode))
			return;
	}
};

export const clearParticles = function () {
	state.numActiveParticles = 0;
};

export const readPointFile_f = async function () {
	if (sv.state.server.phase !== 'active')
		return;
	var name = 'maps/' + pr.getString(pr.state.globals_int[pr.globalvars.mapname]) + '.pts';
	var f = await com.loadTextFile(name);
	if (f == null) {
		con.print('couldn\'t open ' + name + '\n');
		return;
	}
	con.print('Reading ' + name + '...\n');
	var flines = f.split('\n');
	var c, org;
	for (c = 0; c < flines.length;) {
		org = flines[c].split(' ');
		if (org.length !== 3)
			break;
		++c;
		var ox = q.atof(org[0]), oy = q.atof(org[1]), oz = q.atof(org[2]);
		if (!emitParticle(ox, oy, oz, 0.0, 0.0, 0.0, 99999.0, -c & 15, 0, PTYPE.tracer)) {
			con.print('Not enough free particles\n');
			break;
		}
	}
	con.print(c + ' points read\n');
};

export const parseParticleEffect = function () {
	var org: V3 = [msg.readCoord(cl.clState.protocolFlags), msg.readCoord(cl.clState.protocolFlags), msg.readCoord(cl.clState.protocolFlags)];
	var dir: V3 = [msg.readChar() * 0.0625, msg.readChar() * 0.0625, msg.readChar() * 0.0625];
	var msgcount = msg.readByte();
	var color = msg.readByte();
	if (msgcount === 255)
		particleExplosion(org);
	else
		runParticleEffect(org, dir, color, msgcount);
};

export const particleExplosion = function (org: V3) {
	for (var i = 0; i < 1024; ++i) {
		var ramp = Math.floor(Math.random() * 4.0);
		var type = ((i & 1) !== 0) ? PTYPE.explode : PTYPE.explode2;
		var ox = org[0] + Math.random() * 32.0 - 16.0;
		var oy = org[1] + Math.random() * 32.0 - 16.0;
		var oz = org[2] + Math.random() * 32.0 - 16.0;
		var vx = Math.random() * 512.0 - 256.0;
		var vy = Math.random() * 512.0 - 256.0;
		var vz = Math.random() * 512.0 - 256.0;
		if (!emitParticle(ox, oy, oz, vx, vy, vz, cl.clState.time + 5.0, state.ramp1[0], ramp, type))
			return;
	}
};

export const particleExplosion2 = function (org: V3, colorStart: number, colorLength: number) {
	var colorMod = 0;
	for (var i = 0; i < 512; ++i) {
		var color = colorStart + (colorMod++ % colorLength);
		var ox = org[0] + Math.random() * 32.0 - 16.0;
		var oy = org[1] + Math.random() * 32.0 - 16.0;
		var oz = org[2] + Math.random() * 32.0 - 16.0;
		var vx = Math.random() * 512.0 - 256.0;
		var vy = Math.random() * 512.0 - 256.0;
		var vz = Math.random() * 512.0 - 256.0;
		if (!emitParticle(ox, oy, oz, vx, vy, vz, cl.clState.time + 0.3, color, 0, PTYPE.blob))
			return;
	}
};

export const blobExplosion = function (org: V3) {
	for (var i = 0; i < 1024; ++i) {
		var type, color;
		if ((i & 1) !== 0) {
			type = PTYPE.blob;
			color = 66 + Math.floor(Math.random() * 7.0);
		}
		else {
			type = PTYPE.blob2;
			color = 150 + Math.floor(Math.random() * 7.0);
		}
		var ox = org[0] + Math.random() * 32.0 - 16.0;
		var oy = org[1] + Math.random() * 32.0 - 16.0;
		var oz = org[2] + Math.random() * 32.0 - 16.0;
		var vx = Math.random() * 512.0 - 256.0;
		var vy = Math.random() * 512.0 - 256.0;
		var vz = Math.random() * 512.0 - 256.0;
		// ramp isn't used by blob/blob2 in runParticles, so 0 is safe here.
		if (!emitParticle(ox, oy, oz, vx, vy, vz, cl.clState.time + 1.0 + Math.random() * 0.4, color, 0, type))
			return;
	}
};

export const runParticleEffect = function (org: V3, dir: V3, color: number, count: number) {
	for (var i = 0; i < count; ++i) {
		var ox = org[0] + Math.random() * 16.0 - 8.0;
		var oy = org[1] + Math.random() * 16.0 - 8.0;
		var oz = org[2] + Math.random() * 16.0 - 8.0;
		var c = (color & 0xf8) + Math.floor(Math.random() * 8.0);
		var die = cl.clState.time + 0.6 * Math.random();
		if (!emitParticle(ox, oy, oz, dir[0] * 15.0, dir[1] * 15.0, dir[2] * 15.0, die, c, 0, PTYPE.slowgrav))
			return;
	}
};

export const lavaSplash = function (org: V3) {
	var dir = vec.emptyV3(), vel;
	for (var i = -16; i <= 15; ++i) {
		for (var j = -16; j <= 15; ++j) {
			dir[0] = (j + Math.random()) * 8.0;
			dir[1] = (i + Math.random()) * 8.0;
			dir[2] = 256.0;
			var ox = org[0] + dir[0];
			var oy = org[1] + dir[1];
			var oz = org[2] + Math.random() * 64.0;
			vec.normalize(dir);
			vel = 50.0 + Math.random() * 64.0;
			var color = 224 + Math.floor(Math.random() * 8.0);
			var die = cl.clState.time + 2.0 + Math.random() * 0.64;
			if (!emitParticle(ox, oy, oz, dir[0] * vel, dir[1] * vel, dir[2] * vel, die, color, 0, PTYPE.slowgrav))
				return;
		}
	}
};

export const teleportSplash = function (org: V3) {
	var dir = vec.emptyV3(), vel;
	for (var i = -16; i <= 15; i += 4) {
		for (var j = -16; j <= 15; j += 4) {
			for (var k = -24; k <= 31; k += 4) {
				dir[0] = j * 8.0;
				dir[1] = i * 8.0;
				dir[2] = k * 8.0;
				var ox = org[0] + i + Math.random() * 4.0;
				var oy = org[1] + j + Math.random() * 4.0;
				var oz = org[2] + k + Math.random() * 4.0;
				vec.normalize(dir);
				vel = 50.0 + Math.random() * 64.0;
				var color = 7 + Math.floor(Math.random() * 8.0);
				var die = cl.clState.time + 0.2 + Math.random() * 0.16;
				if (!emitParticle(ox, oy, oz, dir[0] * vel, dir[1] * vel, dir[2] * vel, die, color, 0, PTYPE.slowgrav))
					return;
			}
		}
	}
};

export const rocketTrail = function (start: V3, end: V3, type: number) {
	var dx = end[0] - start[0], dy = end[1] - start[1], dz = end[2] - start[2];
	var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
	if (len === 0.0)
		return;
	dx /= len; dy /= len; dz /= len;

	// QSS-M R_RocketTrail: while (len > 0) with len -= 3 per particle — spawns at least one
	// particle whenever the projectile moved AT ALL. A floor(len/3) count here starved slow
	// projectiles at high fps (a 400u/s voreball moves <3 units per 240fps frame -> zero spawns).
	// Case 4 (slight blood) halves density via an extra len -= 3 inside the loop, as QSS-M does.
	while (len > 0) {
		len -= 3.0;
		if (type === 4)
			len -= 3.0;
		// Peek pool capacity before the switch below: case 3/5 mutates
		// state.tracercount, a persistent module state field, and that must
		// not fire on an iteration whose particle gets dropped.
		if (state.numActiveParticles >= state.numparticles)
			return;

		var die = cl.clState.time + 2.0;
		var vx = 0.0, vy = 0.0, vz = 0.0;
		var ox = start[0], oy = start[1], oz = start[2];
		var ptype = PTYPE.fire, color = 0, ramp = 0;
		switch (type) {
			case 0:
			case 1:
				ramp = Math.floor(Math.random() * 4.0) + (type << 1);
				color = state.ramp3[ramp];
				ptype = PTYPE.fire;
				ox = start[0] + Math.random() * 6.0 - 3.0;
				oy = start[1] + Math.random() * 6.0 - 3.0;
				oz = start[2] + Math.random() * 6.0 - 3.0;
				break;
			case 2:
			case 4:
				ptype = PTYPE.grav;
				color = 67 + Math.floor(Math.random() * 4.0);
				ox = start[0] + Math.random() * 6.0 - 3.0;
				oy = start[1] + Math.random() * 6.0 - 3.0;
				oz = start[2] + Math.random() * 6.0 - 3.0;
				break;
			case 3:
			case 5:
				die = cl.clState.time + 0.5;
				ptype = PTYPE.tracer;
				if (type === 3)
					color = 52 + ((state.tracercount++ & 4) << 1);
				else
					color = 230 + ((state.tracercount++ & 4) << 1);
				if ((state.tracercount & 1) !== 0) {
					vx = 30.0 * dy;
					vz = -30.0 * dx;
				}
				else {
					vx = -30.0 * dy;
					vz = 30.0 * dx;
				}
				break;
			case 6:
				color = 152 + Math.floor(Math.random() * 4.0);
				ptype = PTYPE.tracer;
				die = cl.clState.time + 0.3;
				ox = start[0] + Math.random() * 16.0 - 8.0;
				oy = start[1] + Math.random() * 16.0 - 8.0;
				oz = start[2] + Math.random() * 16.0 - 8.0;
		}
		emitParticle(ox, oy, oz, vx, vy, vz, die, color, ramp, ptype);

		start[0] += dx;
		start[1] += dy;
		start[2] += dz;
	}
};

export const runParticles = function () {
	var frametime = cl.clState.time - cl.clState.oldtime;
	var grav = frametime * sv.cvr.gravity.value * 0.05;
	var dvel = frametime * 4.0;

	var i = 0;
	while (i < state.numActiveParticles) {
		if (state.particleDie[i] < cl.clState.time) {
			var last = --state.numActiveParticles;
			if (i !== last) {
				var i3 = i * 3, l3 = last * 3;
				state.particleOrg[i3] = state.particleOrg[l3];
				state.particleOrg[i3 + 1] = state.particleOrg[l3 + 1];
				state.particleOrg[i3 + 2] = state.particleOrg[l3 + 2];
				state.particleVel[i3] = state.particleVel[l3];
				state.particleVel[i3 + 1] = state.particleVel[l3 + 1];
				state.particleVel[i3 + 2] = state.particleVel[l3 + 2];
				state.particleRamp[i] = state.particleRamp[last];
				state.particleDie[i] = state.particleDie[last];
				state.particleColor[i] = state.particleColor[last];
				state.particleType[i] = state.particleType[last];
			}
			continue;
		}

		var i3 = i * 3;
		state.particleOrg[i3] += state.particleVel[i3] * frametime;
		state.particleOrg[i3 + 1] += state.particleVel[i3 + 1] * frametime;
		state.particleOrg[i3 + 2] += state.particleVel[i3 + 2] * frametime;

		switch (state.particleType[i]) {
			case PTYPE.fire:
				state.particleRamp[i] += frametime * 5.0;
				if (state.particleRamp[i] >= 6.0)
					state.particleDie[i] = -1.0;
				else
					state.particleColor[i] = state.ramp3[Math.floor(state.particleRamp[i])];
				state.particleVel[i3 + 2] += grav;
				break;
			case PTYPE.explode:
				state.particleRamp[i] += frametime * 10.0;
				if (state.particleRamp[i] >= 8.0)
					state.particleDie[i] = -1.0;
				else
					state.particleColor[i] = state.ramp1[Math.floor(state.particleRamp[i])];
				state.particleVel[i3] += state.particleVel[i3] * dvel;
				state.particleVel[i3 + 1] += state.particleVel[i3 + 1] * dvel;
				state.particleVel[i3 + 2] += state.particleVel[i3 + 2] * dvel - grav;
				break;
			case PTYPE.explode2:
				state.particleRamp[i] += frametime * 15.0;
				if (state.particleRamp[i] >= 8.0)
					state.particleDie[i] = -1.0;
				else
					state.particleColor[i] = state.ramp2[Math.floor(state.particleRamp[i])];
				state.particleVel[i3] -= state.particleVel[i3] * frametime;
				state.particleVel[i3 + 1] -= state.particleVel[i3 + 1] * frametime;
				state.particleVel[i3 + 2] -= state.particleVel[i3 + 2] * frametime + grav;
				break;
			case PTYPE.blob:
				state.particleVel[i3] += state.particleVel[i3] * dvel;
				state.particleVel[i3 + 1] += state.particleVel[i3 + 1] * dvel;
				state.particleVel[i3 + 2] += state.particleVel[i3 + 2] * dvel - grav;
				break;
			case PTYPE.blob2:
				// vanilla pt_blob2 DAMPS xy (vel -= vel*dvel) — QSS-M/Ironwail r_part.c
				state.particleVel[i3] -= state.particleVel[i3] * dvel;
				state.particleVel[i3 + 1] -= state.particleVel[i3 + 1] * dvel;
				state.particleVel[i3 + 2] -= grav;
				break;
			case PTYPE.grav:
			case PTYPE.slowgrav:
				state.particleVel[i3 + 2] -= grav;
				break;
		}
		++i;
	}
};

// drawParticles body (instanced Particle draw) and its drawParticlesStream WebGL1 fallback (+ the
// particleCoords corner table) moved to WebGLRenderer.drawClassicParticles (render phase1
// particle/flashblend slice). renderScene calls it through getRenderer(); the particle sim/SoA pool
// (runParticles, above) and the color-table lookups stay here.

// surf

state.lightmap_modified = [];

export const textureAnimation = function (model: Model, base: Texture, entFrame: number) {
	var frame = 0;
	if (base.anim_base != null) {
		frame = base.anim_frame;
		base = model.textures[base.anim_base];
	}
	var anims = base.anims;
	if (anims == null)
		return base;
	if ((entFrame !== 0) && (base.alternate_anims.length !== 0))
		anims = base.alternate_anims;
	return model.textures[anims[(Math.floor(cl.clState.time * 5.0) + frame) % anims.length]];
};

const clearTextureChains = (model: Model, chain: TexChain) => {
	// set all chains to null — restricted to textures this model's own faces
	// can reference (chainSurface only ever chains a model's own faces)
	var used = model.usedTextures
	for (var i = 0; i < used.length; i++) {
		var t = model.textures[used[i]]
		if (t && t.texturechains)
			t.texturechains[chain] = null;
	}
}

export const drawBrushModel = function (e: Entity) {
	var clmodel = e.model;

	if (clmodel.submodel === true) {
		var cullMins = state.cullMins, cullMaxs = state.cullMaxs;
		cullMins[0] = e.origin[0] + clmodel.mins[0];
		cullMins[1] = e.origin[1] + clmodel.mins[1];
		cullMins[2] = e.origin[2] + clmodel.mins[2];
		cullMaxs[0] = e.origin[0] + clmodel.maxs[0];
		cullMaxs[1] = e.origin[1] + clmodel.maxs[1];
		cullMaxs[2] = e.origin[2] + clmodel.maxs[2];
		if (cullBox(cullMins, cullMaxs) === true)
			return;
	}
	else {
		var cullMins = state.cullMins, cullMaxs = state.cullMaxs;
		cullMins[0] = e.origin[0] - clmodel.radius;
		cullMins[1] = e.origin[1] - clmodel.radius;
		cullMins[2] = e.origin[2] - clmodel.radius;
		cullMaxs[0] = e.origin[0] + clmodel.radius;
		cullMaxs[1] = e.origin[1] + clmodel.radius;
		cullMaxs[2] = e.origin[2] + clmodel.radius;
		if (cullBox(cullMins, cullMaxs) === true)
			return;
	}

	// GPU-driven path (WebGPU r_gpucullents): the entity survived the frustum cull above, so hand it to
	// the frame's instanced brush batch — its triangles were baked per (texture, fence) at map load, so
	// nothing below this point runs. Returns false (falls through) for a translucent entity, a model with
	// water/turb faces, or any backend/cvar state where the batch is off.
	if (getRenderer().batchBrushEnt(e) === true)
		return;

	// Opaque fast path: an opaque entity (alpha == 1) whose submodel is PURE-SOLID (no water/turb faces)
	// draws from a precomputed static index set — skip the per-frame per-face backface walk + re-chain +
	// the 3 drawWorldSurfaces calls. Closed opaque models render identically (the extra back-faces are
	// depth-culled overdraw). Both backends implement drawBrushEntPrecomputed (WebGPU from its texture-
	// grouped set, WebGL from a lazily-built per-lightmap-page static buffer). Translucent entities and
	// water/turb submodels (ineligible) fall through to the unchanged per-face path below.
	if (clmodel.brushPrecomputeEligible === true && pr.decodeAlpha(e.alpha) === 1) {
		getRenderer().drawBrushEntPrecomputed(e);
		return;
	}

	clearTextureChains(clmodel, TexChain.model);
	var modelOrg = vec.subtract(state.refdef.vieworg, e.origin, vec.scratch())
	if (e.angles[0] || e.angles[1] || e.angles[2]) {
		var temp = vec.scratch()
		var forward = vec.scratch(), right = vec.scratch(), up = vec.scratch()
		vec.copy(modelOrg, temp)

		vec.angleVectors(e.angles, forward, right, up);
		modelOrg[0] = vec.dotProductV3(temp, forward);
		modelOrg[1] = -vec.dotProductV3(temp, right);
		modelOrg[2] = vec.dotProductV3(temp, up);
	}
	// firstmodelsurface is not used TODO: Joe Should this be the "first face" on a submodel
	// if (clmodel.firstmodelsurface != 0 && !cvr.flashblend.value) {
	// 	for (var k = 0; k < cl.state.dlights.length; k++) {
	// 		if ((cl.state.dlights[k].die < cl.clState.time) ||
	// 			(!cl.state.dlights[k].radius))
	// 			continue;

	// 		markLights(cl.state.dlights[k], k, cl.clState.worldmodel.nodes[clmodel.hulls[0].firstclipnode]);
	// 	}
	// }

	for (var i = 0; i < clmodel.numfaces; i++) {
		var surf = clmodel.faces[clmodel.firstface + i]
		var pplane = surf.plane;
		var dot = vec.dotProductV3(modelOrg, pplane.normal) - pplane.dist;
		if (((surf.flags & def.SURF.planeback) && (dot < -0.01)) ||
			(!(surf.flags & def.SURF.planeback) && (dot > 0.01))) {
			chainSurface(clmodel, surf, TexChain.model);
		}
	}

	getRenderer().drawWorldSurfaces(e.model, e, 'solid')
	getRenderer().drawWorldSurfaces(e.model, e, 'litwater')
	getRenderer().drawWorldSurfaces(e.model, e, 'turb')
};

// Hierarchical frustum walk over the flat world BSP. Every face belongs to
// exactly one interior node (nodePacked firstFace/numFaces) whose bbox
// contains it, and that owning node is always an ancestor of any visible leaf that
// chains the face, so nodeMarkvisframe alone (no leaf test) is a sound PVS
// gate for stamping it. A subtree already known out of the PVS or fully
// outside a frustum plane is skipped without testing any faces; a subtree
// found fully inside a plane drops that plane's bit from mask so descendants
// don't retest it. Every face owned by a node lies on that node's split
// plane (marked front/back via surfPlaneBack), so the view-side of the
// plane is identical for all of them and is computed once per node — only
// the front-facing half of the node's face range gets stamped with
// state.frustumFrame. Leaves carry no faces and are never visited.
export const markWorldFrustum = () => {
	// |0 keeps the counter inside int32 so it always equals the truncated
	// values the branchless stamp stores in surfVisibleFrame (Int32Array).
	state.frustumFrame = (state.frustumFrame + 1) | 0;

	// Iterative with every array and scalar hoisted to locals: the walk visits
	// thousands of nodes per frame, and per-visit property chains (state.*,
	// model.*, refdef.vieworg[i]) or recursion overhead dominate its cost.
	// Per-node fields (bbox/plane/faces/children) come from nodePacked, one
	// interleaved 64B record per node (see Model.nodePacked), so a visited
	// node costs 1-2 cache lines instead of touching 7 separate arrays.
	var model = cl.clState.worldmodel;
	var markvis = model.nodeMarkvisframe, visframe = state.visframecount;
	var packed = model.nodePacked, packedI32 = model.nodePackedI32;
	var planeBack = model.surfPlaneBack, visible = model.surfVisibleFrame;
	var frustum = state.frustumFlat, signbits = state.frustumSignbits;
	var stampFrame = state.frustumFrame;
	var vieworg = state.refdef.vieworg;
	var vx = vieworg[0], vy = vieworg[1], vz = vieworg[2];
	// DFS holds at most depth+1 pending (idx, mask) pairs; typed arrays drop
	// out-of-bounds writes silently, so an undersized stack would silently cull
	// subtrees. Regrow from the load-time depth bound (at most once per map).
	var need = (model.bspMaxDepth + 2) * 2;
	if (state.frustumWalkStack.length < need)
		state.frustumWalkStack = new Int32Array(need);
	var stack = state.frustumWalkStack;

	stack[0] = 0;
	stack[1] = 0b1111;
	var sp = 2;
	while (sp > 0) {
		sp -= 2;
		var idx = stack[sp], mask = stack[sp + 1];
		if (markvis[idx] !== visframe)
			continue;
		var base = idx * 16;
		if (mask !== 0) {
			var culled = false;
			for (var i = 0; i < 4; i++) {
				var bit = 1 << i;
				if ((mask & bit) === 0)
					continue;
				var o = i * 4;
				var nx = frustum[o], ny = frustum[o + 1], nz = frustum[o + 2], dist = frustum[o + 3];
				var sb = signbits[i];
				var px = (sb & 1) !== 0 ? packed[base] : packed[base + 3];
				var py = (sb & 2) !== 0 ? packed[base + 1] : packed[base + 4];
				var pz = (sb & 4) !== 0 ? packed[base + 2] : packed[base + 5];
				if (nx * px + ny * py + nz * pz < dist) {
					culled = true;
					break;
				}
				var nvx = (sb & 1) !== 0 ? packed[base + 3] : packed[base];
				var nvy = (sb & 2) !== 0 ? packed[base + 4] : packed[base + 1];
				var nvz = (sb & 4) !== 0 ? packed[base + 5] : packed[base + 2];
				if (nx * nvx + ny * nvy + nz * nvz >= dist)
					mask &= ~bit;
			}
			if (culled)
				continue;
		}

		var pt = packedI32[base + 10];
		var pdist = packed[base + 9];
		var dot = pt < 3
			? vieworg[pt] - pdist
			: vx * packed[base + 6] + vy * packed[base + 7] + vz * packed[base + 8] - pdist;
		var side = dot < 0 ? 1 : 0;
		var first = packedI32[base + 11], end = first + packedI32[base + 12];
		// Branchless: a face is kept when planeBack === side. Each face belongs
		// to exactly one node, so a rejected face can't have been stamped this
		// frame by anyone else — writing 0 instead of skipping keeps the write
		// stream unconditional (no per-face branch misprediction).
		for (var f = first; f < end; f++)
			visible[f] = stampFrame & ((planeBack[f] ^ side) - 1);

		var c0 = packedI32[base + 13], c1 = packedI32[base + 14];
		if (c0 >= 0) {
			stack[sp] = c0;
			stack[sp + 1] = mask;
			sp += 2;
		}
		if (c1 >= 0) {
			stack[sp] = c1;
			stack[sp + 1] = mask;
			sp += 2;
		}
	}
};

// Flags-int variant so the world draw loop never dereferences a Face object.
export const waterAlphaForFlags = (flags: number) => {
	if (flags & def.SURF.drawlava)
		return mapAlpha.state.lava > 0 ? mapAlpha.state.lava : mapAlpha.state.water;
	else if (flags & def.SURF.drawtele)
		return mapAlpha.state.tele > 0 ? mapAlpha.state.tele : mapAlpha.state.water;
	else if (flags & def.SURF.drawslime)
		return mapAlpha.state.slime > 0 ? mapAlpha.state.slime : mapAlpha.state.water;
	else
		return mapAlpha.state.water;
}

const waterAlphaForSurface = (surf: Face) => waterAlphaForFlags(surf.flags)

// applyWaterAlpha (water blend-state toggle) moved to WebGLRenderer (render phase1 world-surface slice).


/*
================
GL_WaterAlphaForEntitySurface -- ericw
 
Returns the water alpha to use for the entity and surface combination.
================
*/
export const waterAlphaForEntitySurface = (ent: Entity, surf: Face) => {
	var entalpha = 1
	if (!ent || ent.alpha == 1)
		entalpha = waterAlphaForSurface(surf);
	else
		entalpha = pr.decodeAlpha(ent.alpha);
	return entalpha;
}

// r_litwater: a turb surface with real lightmap samples (mod.ts only sets
// drawtub without drawtiled when the texinfo isn't TEX.special and lightofs
// is valid — Ironwail gl_model.c:1384-1391). Such surfaces draw through
// drawTextureChains_litwater instead of the classic unlit Turbulent path.
export const isLitWaterFlags = (flags: number) => (flags & def.SURF.drawtub) !== 0 && !(flags & def.SURF.drawtiled)

// The three world-surface submission workers (drawTextureChains solid / _litwater / _water)
// plus their gl-submission helpers (applyWaterAlpha above, bindFullbrightTexture,
// bindLightmapPageTextures) moved to WebGLRenderer.drawWorldSurfaces (render phase1
// world-surface slice). The CPU water-alpha selection (waterAlphaForFlags /
// waterAlphaForEntitySurface / isLitWaterFlags) stays here and is exported for the backend.

// Marks the leaf, then walks nodeParent to the root, stopping at the first
// already-marked node.
const markAncestorsVisible = (model: Model, leafNum: number, visframecount: number) => {
	if (leafNum >= model.leafMarkvisframe.length)
		return;
	if (model.leafMarkvisframe[leafNum] === visframecount)
		return;
	model.leafMarkvisframe[leafNum] = visframecount;
	for (var n = model.leafParent[leafNum]; n >= 0; n = model.nodeParent[n]) {
		if (model.nodeMarkvisframe[n] === visframecount)
			break;
		model.nodeMarkvisframe[n] = visframecount;
	}
}

const noVisPVS = (model: Model) => {
	const pvsbytes = (model.numleafs + 7) >> 3;
	if (!state.mod_novis || pvsbytes > state.mod_novis_capacity) {
		state.mod_novis_capacity = pvsbytes;
		state.mod_novis = new Uint8Array(new ArrayBuffer(state.mod_novis_capacity))
		state.mod_novis.fill(0xFF)
	}
	return state.mod_novis;
}

const leafPVS = (leafNum: number, model: Model) => {
	if (leafNum === 0)
		return noVisPVS(model);
	// shared scratch: markSurfaces copies what it caches, so no caller may retain this
	const row = mod.visRowBytes(model)
	if (!state.leafpvs_scratch || state.leafpvs_scratch.length < row)
		state.leafpvs_scratch = new Uint8Array(row)
	return mod.decompressVis(model.leafVisofs[leafNum], model, state.leafpvs_scratch);
}

// The PVS must include a small area around the client to allow head bobbing
// or other small motion on the client side.  Otherwise, a bob might cause an
// entity that should be visible to not show up, especially when the bob
// crosses a waterline.

// nodeC: flat child encoding (>= 0 node index, < 0 leaf as -1 - leafnum).
const addToFatPVS = (org: V3, nodeC: number, worldmodel: Model) => {
	const pf = worldmodel.nodePacked, pi = worldmodel.nodePackedI32;
	while (1) {
		// if this is a leaf, accumulate the pvs bits
		if (nodeC < 0) {
			const leafNum = -1 - nodeC;
			if (worldmodel.leafContents[leafNum] !== mod.CONTENTS.solid) {
				// decompress into the persistent scratch buffer — this runs every frame
				// while near water, so a fresh allocation per leaf adds up
				const pvs = mod.decompressVis(worldmodel.leafVisofs[leafNum], worldmodel, state.fatpvs_scratch);
				for (var i = 0; i < state.fatbytes; i++)
					state.fatpvs[i] |= pvs[i];
			}
			return;
		}

		const base = nodeC * 16;
		const d = org[0] * pf[base + 6] + org[1] * pf[base + 7] + org[2] * pf[base + 8] - pf[base + 9];
		if (d > 8)
			nodeC = pi[base + 13];
		else if (d < -8)
			nodeC = pi[base + 14];
		else {	// go down both
			addToFatPVS(org, pi[base + 13], worldmodel);
			nodeC = pi[base + 14];
		}
	}
}

// Calculates a PVS that is the inclusive or of all leafs within 8 pixels of the
// given point.
const fatPVS = (org: V3, worldmodel: Model) => //johnfitz -- added worldmodel as a parameter
{
	state.fatbytes = (worldmodel.numleafs + 7) >> 3; // ericw -- was +31, assumed to be a bug/typo
	if (!state.fatpvs || state.fatbytes > state.fatpvs_capacity) {
		state.fatpvs_capacity = state.fatbytes;
		state.fatpvs = new Uint8Array(new ArrayBuffer(state.fatpvs_capacity))
	}
	const scratchbytes = mod.visRowBytes(worldmodel)
	if (!state.fatpvs_scratch || state.fatpvs_scratch.length < scratchbytes)
		state.fatpvs_scratch = new Uint8Array(scratchbytes)
	state.fatpvs.fill(0, 0, state.fatbytes)
	addToFatPVS(org, 0, worldmodel);
	return state.fatpvs;
}

const visEquals = (a: Uint8Array, b: Uint8Array, nbytes: number) => {
	if (a === b)
		return true
	if (a.length < nbytes || b.length < nbytes)
		return false
	for (var i = 0; i < nbytes; i++)
		if (a[i] !== b[i])
			return false
	return true
}

// Persist this frame's PVS row into state.cached_vis. Every vis source (leafPVS/fatPVS/noVisPVS) returns a
// shared buffer that the next decompress overwrites, so this copy is what markSurfaces' reuse compare AND
// the WebGPU compute cull's per-frame PVS upload (WebGPURenderer.encodeCull) read.
const cacheVis = (worldmodel: Model, vis: Uint8Array) => {
	const rowbytes = mod.visRowBytes(worldmodel);
	if (state.cached_vis == null || state.cached_vis.length < rowbytes)
		state.cached_vis = new Uint8Array(rowbytes);
	state.cached_vis.set(vis.length <= rowbytes ? vis : vis.subarray(0, rowbytes));
}

const chainSurface = (model: Model, surf: Face, chain: TexChain) => {
	const texture = model.textures[model.texinfo[surf.texinfo].texture]
	surf.texturechain = texture.texturechains[chain];
	texture.texturechains[chain] = surf;
}

// Decoupled GPU-cull mode's slim substitute for markSurfaces: ONLY the PVS-driven efrag gather (static
// entities — torches/flames — live in leaf efrag chains and are added to the visedict list per visible
// leaf). No ancestor marking (only markWorldFrustum consumed it), no chain stamping/rebuild (the compute
// cull owns world visibility). vis_changed is forced true so a later CPU frame (r_gpucull toggled off,
// or cull-data build failure next map) rebuilds the now-stale chains instead of trusting them.
const markEfrags = () => {
	const worldmodel = cl.clState.worldmodel
	var vis: Uint8Array
	var i, nearwaterportal = false;
	for (var i2 = 0, mark = worldmodel.leafFirstMarksurface[state.viewleaf]; i2 < worldmodel.leafNumMarksurfaces[state.viewleaf]; i2++, mark++)
		if (worldmodel.faces[worldmodel.marksurfaces[mark]].flags & def.SURF.drawtub)
			nearwaterportal = true;
	// Reuse the cached visible-efrag leaf list while it's valid (same reuse rule as
	// markSurfaces): the leafPVS row depends only on the viewleaf, so the ~numleafs-wide
	// bit walk + PVS decompress need not rerun every frame. nearwaterportal frames use a
	// position-dependent fatPVS and bypass the cache; a static-entity count change means a
	// late svc_spawnstatic linked new efrag chains.
	const novis = cvr.novis.value
	if (!nearwaterportal && state.efragCacheWorld === worldmodel && state.efragCacheLeaf === state.viewleaf
			&& state.efragCacheNovis === novis && state.efragCacheStatics === cl.clState.num_statics) {
		const list = state.efragCacheLeaves
		for (i = 0; i < state.efragCacheCount; i++)
			storeEfrags(worldmodel.leafEfrags[list[i]])
		state.drawsky = true
		state.vis_changed = true
		return
	}
	const viewContents = worldmodel.leafContents[state.viewleaf];
	if (novis || viewContents === mod.CONTENTS.solid || viewContents === mod.CONTENTS.sky)
		vis = noVisPVS(worldmodel);
	else if (nearwaterportal)
		vis = fatPVS(state.refdef.vieworg, worldmodel);
	else
		vis = leafPVS(state.viewleaf, worldmodel);
	// The compute cull's visibility IS this row (encodeCull uploads cached_vis), so decoupled mode must
	// refresh it here — markSurfaces, the only other writer, does not run in this mode.
	cacheVis(worldmodel, vis)
	let list = state.efragCacheLeaves
	if (list == null || list.length < worldmodel.numleafs)
		list = state.efragCacheLeaves = new Int32Array(worldmodel.numleafs)
	let n = 0
	for (i = 0; i < worldmodel.numleafs; i++) {
		if (vis[i >> 3] & (1 << (i & 7))) {
			const ef = worldmodel.leafEfrags[i + 1];
			if (ef) {
				storeEfrags(ef);
				list[n++] = i + 1
			}
		}
	}
	if (nearwaterportal) {
		state.efragCacheWorld = null   // position-dependent PVS — never reuse
	} else {
		state.efragCacheWorld = worldmodel
		state.efragCacheLeaf = state.viewleaf
		state.efragCacheNovis = novis
		state.efragCacheStatics = cl.clState.num_statics
		state.efragCacheCount = n
	}
	state.drawsky = true
	state.vis_changed = true
}

const markSurfaces = () => {
	var vis: Uint8Array
	const worldmodel = cl.clState.worldmodel
	// A chain-mode frame retargets cached_vis at its own viewleaf, which breaks markEfrags' rule that a
	// valid efrag cache implies cached_vis holds that leaf's row. Drop the cache so the next decoupled
	// frame takes the full path (one PVS decompress) and re-establishes both together.
	state.efragCacheWorld = null
	// check this leaf for water portals
	// TODO: loop through all water surfs and use distance to leaf cullbox
	var nearwaterportal = false;
	for (var i = 0, mark = worldmodel.leafFirstMarksurface[state.viewleaf]; i < worldmodel.leafNumMarksurfaces[state.viewleaf]; i++ , mark++)
		if (worldmodel.faces[worldmodel.marksurfaces[mark]].flags & def.SURF.drawtub)
			nearwaterportal = true;

	// if surface chains don't need regenerating, just add static entities and return
	// (reuse the vis decompressed when the chains were last rebuilt — decompressing
	// the PVS every frame allocates and burns CPU on large maps)
	const viewContents = worldmodel.leafContents[state.viewleaf];
	if (state.oldviewleaf == state.viewleaf && !state.vis_changed && state.cached_vis) {
		var reuse = !nearwaterportal
		if (!reuse && !cvr.novis.value && viewContents !== mod.CONTENTS.solid && viewContents !== mod.CONTENTS.sky) {
			// near water the PVS is position-dependent (fatPVS), so it must be recomputed
			// every frame — but while its bytes are unchanged the chains are still valid,
			// and this compare is far cheaper than the re-mark + chain rebuild below
			reuse = visEquals(fatPVS(state.refdef.vieworg, worldmodel), state.cached_vis, state.fatbytes)
		}
		if (reuse) {
			vis = state.cached_vis
			for (i = 0; i < worldmodel.numleafs; i++) {
				if (vis[i>>3] & (1<<(i&7))) {
					const ef = worldmodel.leafEfrags[i + 1];
					if (ef)
						storeEfrags (ef);
				}
			}
			return;
		}
	}

	// choose vis data
	if (cvr.novis.value || viewContents === mod.CONTENTS.solid || viewContents === mod.CONTENTS.sky)
		vis = noVisPVS(worldmodel);
	else if (nearwaterportal)
		vis = fatPVS(state.refdef.vieworg, worldmodel);
	else {
		vis = leafPVS(state.viewleaf, worldmodel);
		// The viewleaf changed but its decompressed PVS row is byte-identical to
		// the one the chains were built from (common for adjacent leafs on large
		// maps) — the chains are still valid, so skip the O(visible) re-mark and
		// rebuild. The compare is ~rowbytes; the rebuild is tens of ms on 1M+
		// face maps.
		if (!state.vis_changed && state.cached_vis && visEquals(vis, state.cached_vis, mod.visRowBytes(worldmodel))) {
			state.oldviewleaf = state.viewleaf
			for (i = 0; i < worldmodel.numleafs; i++) {
				const ef = worldmodel.leafEfrags[i + 1];
				if ((vis[i >> 3] & (1 << (i & 7))) && ef)
					storeEfrags(ef);
			}
			return;
		}
	}
	cacheVis(worldmodel, vis)

	state.vis_changed = false
	state.visframecount++;
	state.oldviewleaf = state.viewleaf
	state.rs_rebuilds++

	// set all chains to null
	for (i = 0; i < worldmodel.textures.length; i++)
		if (worldmodel.textures[i] && worldmodel.textures[i].texturechains)
			worldmodel.textures[i].texturechains[TexChain.world] = null;

	// Iterate through leaves, marking surfaces and chaining them as they're
	// first seen (QSS-M r_world.c R_MarkSurfaces order) — the visframe stamp
	// doubles as the dedup guard for faces shared between leafs. This replaces
	// the old FitzQuake full node/face sweep, which cost O(all faces) per
	// rebuild regardless of how few were visible.
	for (i = 0; i < worldmodel.numleafs; i++) {
		if (vis[i >> 3] & (1 << (i & 7))) {
			const lnum = i + 1;
			// stamps leafMarkvisframe/nodeMarkvisframe up to the root — the
			// hierarchical frustum walk (markWorldFrustum) relies on these to
			// know which subtrees are in the current PVS
			markAncestorsVisible(worldmodel, lnum, state.visframecount);

			if (cvr.oldskyleaf.value || worldmodel.leafContents[lnum] != mod.CONTENTS.sky) {
				const first = worldmodel.leafFirstMarksurface[lnum], num = worldmodel.leafNumMarksurfaces[lnum];
				for (var j = 0; j < num; j++) {
					const snum = worldmodel.marksurfaces[first + j]
					if (worldmodel.surfVisframe[snum] !== state.visframecount) {
						worldmodel.surfVisframe[snum] = state.visframecount;
						chainSurface(worldmodel, worldmodel.faces[snum], TexChain.world);
					}
				}
			}

			// add static models
			const ef = worldmodel.leafEfrags[lnum];
			if (ef)
				storeEfrags (ef);
		}
	}

	flattenWorldChains(worldmodel)

	state.drawsky = true
}

// Mirrors the just-rebuilt TexChain.world linked lists into worldChainFaces
// (grouped by texture, worldChainOfs/Count give each texture's range) so the
// per-frame draw loops can stream a typed array instead of chasing pointers.
// Only runs when markSurfaces rebuilds the chains (PVS change) — the linked
// lists remain the source of truth.
const flattenWorldChains = (model: Model) => {
	var cursor = 0
	for (var i = 0; i < model.textures.length; i++) {
		var t = model.textures[i]
		model.worldChainOfs[i] = cursor
		if (t && t.texturechains)
			for (var s = t.texturechains[TexChain.world]; s; s = s.texturechain)
				model.worldChainFaces[cursor++] = s.num
		model.worldChainCount[i] = cursor - model.worldChainOfs[i]
	}
}

// reused per-vertex scratch for buildSurfaceDisplayLists (cold: runs at newMap)
const dispVertScratch: V3 = [0, 0, 0]
const buildSurfaceDisplayLists = (model: Model) => {
	for (var i = 0; i < model.numfaces; i++) {

		if ((model.faces[i].flags & def.SURF.drawtiled) && !(model.faces[i].flags & def.SURF.drawtub))
			continue;

		var fa = model.faces[i]
		const S = def.POLY_VERT_STRIDE
		const pverts = model.polyVertData
		const pbase = model.surfVertOfs[i] * S

		const texInfo = model.texinfo[fa.texinfo]
		const texture = model.textures[texInfo.texture]
		const lmscale = 1 << fa.lmshift // texture units per luxel (BSPX LMSHIFT; 16 = vanilla)

		for (var j = 0; j < fa.numedges; j++) {
			var s, t
			const _vec = dispVertScratch
			mod.surfedgeVertexInto(model, model.surfedges[fa.firstedge + j], _vec);
			//@ts-ignore
			s = vec.dotProductV3(_vec, texInfo.vecs[0]) + texInfo.vecs[0][3];
			s /= texture.width;
			//@ts-ignore
			t = vec.dotProductV3(_vec, texInfo.vecs[1]) + texInfo.vecs[1][3];
			t /= texture.height;

			var vb = pbase + j * S
			pverts[vb] = _vec[0]; pverts[vb + 1] = _vec[1]; pverts[vb + 2] = _vec[2];
			pverts[vb + 3] = s;
			pverts[vb + 4] = t;

			//
			// lightmap texture coordinates
			//
			if (fa.decoupled) {
				// lmvecs give luxel coords directly (texturemins folded into .w);
				// the classic path below reduces to this once divided by lmscale.
				const lv = fa.lmvecs as Float32Array
				//@ts-ignore
				s = _vec[0] * lv[0] + _vec[1] * lv[1] + _vec[2] * lv[2] + lv[3]
				s += fa.light_s
				s += 0.5
				s /= lm.LM_BLOCK_WIDTH
				//@ts-ignore
				t = _vec[0] * lv[4] + _vec[1] * lv[5] + _vec[2] * lv[6] + lv[7]
				t += fa.light_t
				t += 0.5
				t /= lm.LM_BLOCK_HEIGHT
			} else {
				//@ts-ignore
				s = vec.dotProductV3(_vec, texInfo.vecs[0]) + texInfo.vecs[0][3];
				s -= model.faceTexturemins[i * 2];
				s += fa.light_s * lmscale;
				s += lmscale / 2;
				s /= lm.LM_BLOCK_WIDTH * lmscale; //fa->texinfo->texture->width;

				//@ts-ignore
				t = vec.dotProductV3(_vec, texInfo.vecs[1]) + texInfo.vecs[1][3];
				t -= model.faceTexturemins[i * 2 + 1];
				t += fa.light_t * lmscale;
				t += lmscale / 2;
				t /= lm.LM_BLOCK_HEIGHT * lmscale; //fa->texinfo->texture->height;
			}

			pverts[vb + 5] = s;
			pverts[vb + 6] = t;
		}

		//johnfitz -- removed gl_keeptjunctions code
	}
}

const buildModelVertexBuffer = (gl: WebGLRenderingContext) => {
	// Pass 1: exact vertex count. Pre-sizing the Float32Array avoids staging the
	// whole VBO in a growing JS number[] first — on a 1.7M-face BSP2 that
	// intermediate is a transient GB-scale allocation.
	var total = 0
	for (var midx = 1; midx < cl.clState.model_precache.length; ++midx) {
		var model = cl.clState.model_precache[midx];
		if (!model || model.name[0] == '*' || model.type != mod.TYPE.brush)
			continue;
		total += model.polyVertData.length / def.POLY_VERT_STRIDE
	}

	var v_buffer = new Float32Array(total * def.VERTEXSIZE)
	// WebGPU lightmap-array consolidation: a parallel per-vertex layer stream (4 float32 layers per vertex,
	// one per style slot) so the world shader can index its 4 lightmap texture_2d_arrays. Same vertex
	// count/order as v_buffer. WebGPU-gated (null under WebGL2 — the WebGL path never binds it).
	const webgpu = getRenderer().backend === 'webgpu'
	var l_buffer: Float32Array | null = webgpu ? new Float32Array(total * 4) : null
	const p2l1 = lm.state.lmPageToLayer[1], p2l2 = lm.state.lmPageToLayer[2], p2l3 = lm.state.lmPageToLayer[3]
	var o = 0
	var lo = 0
	var v_index = 0

	for (var midx = 1; midx < cl.clState.model_precache.length; ++midx) {
		var model = cl.clState.model_precache[midx];
		if (!model || model.name[0] == '*' || model.type != mod.TYPE.brush)
			continue;

		for (var i = 0; i < model.faces.length; i++) {
			const surf = model.faces[i]
			surf.vbo_firstvert = v_index
			const pv = model.polyVertData, nv = surf.numedges, S = def.POLY_VERT_STRIDE
			var b = model.surfVertOfs[i] * S
			// Face styles now live in the model's flat SoA arrays (wasm-sim memory-model refactor); read
			// the active-style count + the 4 style slots from there instead of the removed surf.styles[].
			const nS = model.faceNumStyles[i]
			const s0 = nS > 0 ? model.faceStyles[i * 4] : 64
			const s1 = nS > 1 ? model.faceStyles[i * 4 + 1] : 64
			const s2 = nS > 2 ? model.faceStyles[i * 4 + 2] : 64
			const s3 = nS > 3 ? model.faceStyles[i * 4 + 3] : 64
			// Compact lightmap layer per style slot for this surface's page (WebGPU lightmap arrays). Slot 0
			// layer == page (dense); slots 1-3 use the sparse page→layer map (absent slot → layer 0, its
			// weight is 0 so the black sample is discarded). Sky/tiled faces have page 0 and never sample.
			var pg = surf.lightmaptexturenum
			if (!(pg >= 0)) pg = 0
			const ml0 = pg
			const ml1 = webgpu ? (p2l1[pg] >= 0 ? p2l1[pg] : 0) : 0
			const ml2 = webgpu ? (p2l2[pg] >= 0 ? p2l2[pg] : 0) : 0
			const ml3 = webgpu ? (p2l3[pg] >= 0 ? p2l3[pg] : 0) : 0
			for (var j = 0; j < nv; j++) {
				for (var k = 0; k < 7; k++)
					v_buffer[o++] = pv[b++]
				// 4 lightstyle indices (slots 0-3); 64 = unused slot (GPU weight = 0)
				v_buffer[o++] = s0
				v_buffer[o++] = s1
				v_buffer[o++] = s2
				v_buffer[o++] = s3
				if (l_buffer !== null) {
					l_buffer[lo++] = ml0
					l_buffer[lo++] = ml1
					l_buffer[lo++] = ml2
					l_buffer[lo++] = ml3
				}
			}

			v_index += nv

			// Fill the prebuilt fan indices (ofs/count already computed at load
			// time in mod.loadBrushModel) now that vbo_firstvert is final.
			var idx = model.surfIndexOfs[i]
			for (var e = 2; e < surf.numedges; e++) {
				model.surfIndexData[idx++] = surf.vbo_firstvert
				model.surfIndexData[idx++] = surf.vbo_firstvert + e - 1
				model.surfIndexData[idx++] = surf.vbo_firstvert + e
			}
		}
	}

	state.model_vbo = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, state.model_vbo);
	gl.bufferData(gl.ARRAY_BUFFER, v_buffer, gl.STATIC_DRAW);

	// WebGPU backend: retain the interleaved verts so the WebGPU renderer can upload its own vertex
	// buffer (lazily, keyed off this Float32Array). Additive + backend-gated; null under WebGL2.
	state.model_vbo_data = webgpu ? v_buffer : null;
	// WebGPU lightmap-array consolidation: retain the parallel layer stream (uploaded as a second world
	// vertex buffer). Its identity keys the WebGPU backend's lightmap-array + layer-buffer rebuild on map change.
	state.model_lmlayer_data = l_buffer;

	// Precompute per-brush-submodel eligibility (+ the WebGPU index set) now that surfIndexData is final.
	buildBrushPrecompute();
}

// WebGPU-only, load-time (cold path): for each inline brush submodel (*N — doors, platforms, func_
// brushwork), build a STATIC concatenated index set of all its drawable solid/fence faces' fan indices,
// grouped by (base texture, fence). Lets drawBrushEntPrecomputed draw an opaque instance of the submodel
// without the per-frame per-face CPU backface walk in drawBrushModel. A submodel with ANY water/turb
// (drawtub) face is left un-precomputed (brushPrecompute = null) so it keeps the exact per-face path
// (its water/translucency stays correct). Sky/tiled/notexture faces are excluded — the existing solid
// pass skips them (SOLID_SKIP) too, so the image is unchanged. Indices reference the shared world VBO.
const PRECOMPUTE_SKIP = def.SURF.drawtiled | def.SURF.notexture | def.SURF.drawsky
const buildBrushPrecompute = () => {
	// Eligibility (opaque pure-solid submodel with drawable faces) is backend-agnostic and gates the
	// fast path in drawBrushModel for both backends; the WebGPU index set is only built under WebGPU
	// (WebGL builds its own per-lightmap-page representation lazily in the WebGL renderer).
	const webgpu = getRenderer().backend === 'webgpu'
	for (var midx = 1; midx < cl.clState.model_precache.length; ++midx) {
		const model = cl.clState.model_precache[midx];
		if (!model || model.submodel !== true || model.type !== mod.TYPE.brush)
			continue;
		model.brushPrecompute = null;
		model.brushPrecomputeEligible = false;
		const faces = model.faces, first = model.firstface, num = model.numfaces;
		const texinfo = model.texinfo;
		const idxOfs = model.surfIndexOfs, idxCnt = model.surfIndexCount, idxData = model.surfIndexData;

		// PURE-SOLID gate: any water/turb face → keep the existing per-face path.
		var pure = true;
		for (var i = 0; i < num; i++) {
			if (faces[first + i].flags & def.SURF.drawtub) { pure = false; break; }
		}
		if (!pure)
			continue;

		// Pass 1: group key = textureIndex<<1 | isFence; total up each group's index count.
		const counts = new Map<number, number>();
		var total = 0;
		for (var i = 0; i < num; i++) {
			const surf = faces[first + i];
			if (surf.flags & PRECOMPUTE_SKIP)
				continue;
			const key = (texinfo[surf.texinfo].texture << 1) | ((surf.flags & def.SURF.drawfence) ? 1 : 0);
			const c = idxCnt[first + i];
			counts.set(key, (counts.get(key) || 0) + c);
			total += c;
		}
		if (total === 0)
			continue;

		// This submodel is opaque pure-solid with drawable faces → both backends may use the fast path.
		model.brushPrecomputeEligible = true;

		// WebGL builds its own (texture,fence,lightmap-page)-grouped static buffer lazily at draw time;
		// only the WebGPU texture-grouped index set is precomputed here.
		if (!webgpu)
			continue;

		// Prefix-sum each group into a contiguous range in indexData; build the slot list + write cursors.
		const indexData = new Uint32Array(total);
		const slots: BrushPrecomputeSlot[] = [];
		const groupFirst = new Map<number, number>();
		var running = 0;
		counts.forEach((c, key) => {
			groupFirst.set(key, running);
			slots.push({ textureIndex: key >> 1, isFence: (key & 1) !== 0, first: running, count: c });
			running += c;
		});

		// Pass 2: copy each drawable face's fan indices into its group's range.
		for (var i = 0; i < num; i++) {
			const surf = faces[first + i];
			if (surf.flags & PRECOMPUTE_SKIP)
				continue;
			const key = (texinfo[surf.texinfo].texture << 1) | ((surf.flags & def.SURF.drawfence) ? 1 : 0);
			var cur = groupFirst.get(key);
			const so = idxOfs[first + i], cc = idxCnt[first + i];
			for (var e = 0; e < cc; e++)
				indexData[cur++] = idxData[so + e];
			groupFirst.set(key, cur);
		}

		model.brushPrecompute = { indexData, slots };
	}
}

export const freeResources = () => {
	const gl = GL.getContext()
	gl.deleteFramebuffer(state.warpbuffer)
	gl.deleteBuffer(state.model_vbo)
	gl.deleteBuffer(state.skyvecs)
	gl.deleteBuffer(state.dlightvecs)
	gl.deleteRenderbuffer(state.warprenderbuffer)

	gl.deleteTexture(state.notexture_mip && state.notexture_mip.texturenum)
	gl.deleteTexture(state.warptexture)
	gl.deleteTexture(state.solidskytexture)
	gl.deleteTexture(state.alphaskytexture)
	gl.deleteTexture(state.null_texture)

	if (sky.state.texture) {
		gl.deleteTexture(sky.state.texture)
		sky.state.texture = null
	}
	sky.state.name = ''
	sky.state.generation++ // cancel any load still in flight
}

// scan

// warpScreen (underwater warp resolve blit) moved to WebGLRenderer.endScene (render phase1
// frame-skeleton slice).

// warp

export const makeSky = function () {
	const gl = GL.getContext()
	var sin = [0.0, 0.19509, 0.382683, 0.55557, 0.707107, 0.831470, 0.92388, 0.980785, 1.0];
	var vecs: number[] = [], i, j;

	for (i = 0; i < 7; i += 2) {
		vecs = vecs.concat(
			[
				0.0, 0.0, 1.0,
				sin[i + 2] * 0.19509, sin[6 - i] * 0.19509, 0.980785,
				sin[i] * 0.19509, sin[8 - i] * 0.19509, 0.980785
			]);
		for (j = 0; j < 7; ++j) {
			vecs = vecs.concat(
				[
					sin[i] * sin[8 - j], sin[8 - i] * sin[8 - j], sin[j],
					sin[i] * sin[7 - j], sin[8 - i] * sin[7 - j], sin[j + 1],
					sin[i + 2] * sin[7 - j], sin[6 - i] * sin[7 - j], sin[j + 1],

					sin[i] * sin[8 - j], sin[8 - i] * sin[8 - j], sin[j],
					sin[i + 2] * sin[7 - j], sin[6 - i] * sin[7 - j], sin[j + 1],
					sin[i + 2] * sin[8 - j], sin[6 - i] * sin[8 - j], sin[j]
				]);
		}
	}

	GL.createProgram('Sky',
		['uViewAngles', 'uPerspective', 'uScale', 'uGamma', 'uTime'],
		[
			createAttribParam('aPosition', gl.FLOAT, 3)
		],
		['tSolid', 'tAlpha']);
	GL.createProgram('SkyChain',
		['uViewOrigin', 'uViewAngles', 'uPerspective'],
		[
			createAttribParam('aPosition', gl.FLOAT, 3)
		],
		[]);
	GL.createProgram('SkyCube',
		['uViewOrigin', 'uViewAngles', 'uPerspective', 'uGamma', 'uSkyFog', 'uFogColor'],
		[
			createAttribParam('aPosition', gl.FLOAT, 3)
		],
		['tSky']);

	const skyvecs = new Float32Array(vecs);
	state.skyvecs = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, state.skyvecs);
	gl.bufferData(gl.ARRAY_BUFFER, skyvecs, gl.STATIC_DRAW);

	// WebGPU backend: retain the dome verts so the WebGPU renderer can upload its own vertex buffer
	// (keyed off this Float32Array's identity). Additive + backend-gated; null under WebGL2.
	state.skyvecs_data = getRenderer().backend === 'webgpu' ? skyvecs : null;
};

// drawSkyBox body (skyroom depth-only / cubemap SkyCube / classic scrolling dome) moved to
// WebGLRenderer.drawSky (render phase1 world-surface + sky slice).

export const initSky = function (src: Uint8Array) {
	const gl = GL.getContext()
	const wgpu = getRenderer().backend === 'webgpu';
	var i, j, p;
	var trans = new ArrayBuffer(65536);
	var trans32 = new Uint32Array(trans);

	for (i = 0; i < 128; ++i) {
		for (j = 0; j < 128; ++j)
			trans32[(i << 7) + j] = com.state.littleLong(vid.d_8to24table[src[(i << 8) + j + 128]] + 0xff000000);
	}
	if (gl) {
		tx.bind(0, state.solidskytexture, false);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 128, 128, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(trans));
		gl.generateMipmap(gl.TEXTURE_2D);
	}
	// WebGPU backend: retain the expanded RGBA (a fresh copy — `trans` is reused for the alpha layer
	// below) on the sky-texture handle so the WebGPU renderer can upload its own GPUTexture. The handle
	// is stable across maps (created once in r.init) but the content differs per map; the WebGPU cache
	// keys off this Uint8Array's identity, so a new map's fresh copy invalidates it. Backend-gated —
	// under WebGL2 these fields stay undefined (pixel-identical).
	if (wgpu) {
		(state.solidskytexture as any).rgba = new Uint8Array(trans).slice();
		(state.solidskytexture as any).rgbaW = 128;
		(state.solidskytexture as any).rgbaH = 128;
	}

	for (i = 0; i < 128; ++i) {
		for (j = 0; j < 128; ++j) {
			p = (i << 8) + j;
			if (src[p] !== 0)
				trans32[(i << 7) + j] = com.state.littleLong(vid.d_8to24table[src[p]] + 0xff000000);
			else
				trans32[(i << 7) + j] = 0;
		}
	}
	if (gl) {
		tx.bind(0, state.alphaskytexture, false);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 128, 128, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(trans));
		gl.generateMipmap(gl.TEXTURE_2D);
	}
	if (wgpu) {
		(state.alphaskytexture as any).rgba = new Uint8Array(trans).slice();
		(state.alphaskytexture as any).rgbaW = 128;
		(state.alphaskytexture as any).rgbaH = 128;
	}
}
