// GPU lightstyles: lightstyle animation is performed in the Brush fragment shader by blending
// up to 4 raw per-style lightmap layers (written once at map load). Dynamic lights are computed
// analytically in the Brush fragment shader (see fshBrush) from per-frame uniforms — no CPU overlay.
import {loadLightmapTextureSlot, createBlackTexture, bind, state as textureState} from './texture'
import * as def from './def'
import * as con from './console'
import { Face, Model } from './types/Model'

export const LM_BLOCK_WIDTH = 256
export const LM_BLOCK_HEIGHT = 256
// Max 256x256 lightmap atlas pages. Huge modern maps (Immortal Lock) exceed the
// classic count. Only pages the map actually uses get GL textures (buildLightmaps
// breaks at the first unused page); the cap just sizes the bookkeeping array.
export const MAXLIGHTMAPS = 2048
export const MAX_LIGHTSTYLES = 64

// const cvr = {
// 	gl_overbright: {value: 1},
// 	gl_fullbrights: {value: 0},
// 	r_novis: {value: 0},
//   dynamic: {value:0},
// 	oldskyleaf: {value: 0}
// }

type LightmapPageEntry = {
	slots: (Uint8Array | null)[]
}

export type LightmapState = {
	lightstylevalue: Uint32Array,
	lightstyle_uniform: Float32Array,
	lightstyle_uniform_dirty: boolean,
	allocated: number[][],
	last_lightmap_allocated: number,
	lightmap_pages: LightmapPageEntry[],
	// WebGPU lightmap-array consolidation: compact per-style layer maps built by
	// buildLightmapArrays after the per-model buildLightmaps loop. lmNumPages = used 256x256 pages;
	// lmLayerCount[m] = populated layers in style-slot m's texture_2d_array; lmPageToLayer[m][page] =
	// that page's compact layer in slot m (-1 if slot m is absent on the page). Slot 0 is dense (layer ==
	// page); slots 1-3 are sparse. WebGPU-only (left at their empty defaults under WebGL2).
	lmNumPages: number,
	lmLayerCount: Int32Array,
	lmPageToLayer: Int32Array[]
}

export const state: LightmapState = {
    lightstylevalue: new Uint32Array(new ArrayBuffer(256 * 4)),
    lightstyle_uniform: new Float32Array(65), // index 64 is always 0 (unused slot)
    lightstyle_uniform_dirty: true,
  allocated: Array.apply(null, new Array(MAXLIGHTMAPS)).map((): number[] => []),
  last_lightmap_allocated: 0,
  lightmap_pages: [],
  lmNumPages: 0,
  lmLayerCount: new Int32Array(4),
  lmPageToLayer: []
}

export const init = () => {
	for (var i=0 ; i<256 ; i++)
		state.lightstylevalue[i] = 264;

	state.allocated = Array.apply(null, new Array(MAXLIGHTMAPS)).map(() =>
		Array.apply(null, new Array(LM_BLOCK_WIDTH)).map(() => 0))
	state.last_lightmap_allocated = 0;

	state.lightmap_pages = []
	state.lightstyle_uniform_dirty = true

	state.lmNumPages = 0
	state.lmLayerCount = new Int32Array(4)
	state.lmPageToLayer = []
}

/*
========================
AllocBlock -- returns a texture number and the position inside it
========================
*/
const allocBlock = (model: Model, surf: Face) => {
	var	i, j;
	var	best, best2;
	var	texnum;
	var w = surf.decoupled ? surf.lmwidth : (model.faceExtents[surf.num * 2]>>surf.lmshift)+1;
	var h = surf.decoupled ? surf.lmheight : (model.faceExtents[surf.num * 2 + 1]>>surf.lmshift)+1;
	// 1-luxel gutter on every side: slot textures hold RAW per-style layers, so a
	// GL_LINEAR tap at a rect edge otherwise reads a neighboring face's layer — which
	// can belong to a DIFFERENT style (e.g. an off switchable's baked glow) but gets
	// weighted by THIS face's style, leaking light along face borders. Edge-replicated
	// padding (writeStyleLayers) keeps bilinear taps inside the face's own data.
	// (QSS-M needs no gutter: it uploads CPU-combined, already style-weighted lightmaps.)
	var pw = w + 2, ph = h + 2;

	// ericw -- rather than searching starting at lightmap 0 every time,
	// start at the last lightmap we allocated a surface in.
	// This makes AllocBlock much faster on large levels (can shave off 3+ seconds
	// of load time on a level with 180 lightmaps), at a cost of not quite packing
	// lightmaps as tightly vs. not doing this (uses ~5% more lightmaps)
	for (texnum=state.last_lightmap_allocated ; texnum<MAXLIGHTMAPS ; texnum++, state.last_lightmap_allocated++)
	{
		best = LM_BLOCK_HEIGHT;

		for (i=0 ; i<LM_BLOCK_WIDTH-pw ; i++)
		{
			best2 = 0;

			for (j=0 ; j<pw ; j++)
			{
				if (state.allocated[texnum][i+j] >= best)
					break;
				if (state.allocated[texnum][i+j] > best2)
					best2 = state.allocated[texnum][i+j];
			}
			if (j == pw)
			{	// this is a valid spot; light_s/light_t are the inner (unpadded) origin
				surf.light_s = i + 1;
				best = best2;
				surf.light_t = best + 1;
			}
		}

		if (best + ph > LM_BLOCK_HEIGHT)
			continue;

		for (i=0 ; i<pw ; i++)
			state.allocated[texnum][surf.light_s - 1 + i] = best + ph;

		return texnum;
	}

	throw new Error ("AllocBlock: full");
}

export const createSurfaceLightmap = (model: Model, surf: Face) => {
	surf.lightmaptexturenum = allocBlock (model, surf);
	model.surfLightmapPage[surf.num] = surf.lightmaptexturenum;
	writeStyleLayers (model, surf);
}

// Write the raw (unscaled) per-style lightmap samples into per-page/per-slot staging buffers.
// Called at map load for every lightmapped surface; staging is later uploaded as GL textures.
const writeStyleLayers = (model: Model, surf: Face) => {
	const page = surf.lightmaptexturenum
	const smax = surf.decoupled ? surf.lmwidth : (model.faceExtents[surf.num * 2] >> surf.lmshift) + 1
	const tmax = surf.decoupled ? surf.lmheight : (model.faceExtents[surf.num * 2 + 1] >> surf.lmshift) + 1
	const size = smax * tmax

	if (!state.lightmap_pages[page])
		state.lightmap_pages[page] = { slots: [] }

	const pageEntry = state.lightmap_pages[page]

	if (!model || !model.lightdata) {
		// Full bright: write 255s into slot 0 so the GPU path can light this surface.
		// Unlit BSPs carry all-255 style bytes (numStyles 0), which the vertex buffer maps
		// to the zero-weight slot 64 — force style 0 so the slot-0 data gets a live weight.
		model.faceStyles[surf.num * 4] = 0
		if (model.faceNumStyles[surf.num] === 0) model.faceNumStyles[surf.num] = 1
		if (!pageEntry.slots[0])
			pageEntry.slots[0] = new Uint8Array(LM_BLOCK_WIDTH * LM_BLOCK_HEIGHT * 4)
		const staging = pageEntry.slots[0]
		// -1..max loops cover the 1-luxel gutter allocBlock reserved around the rect
		for (var t = -1; t <= tmax; t++) {
			for (var s = -1; s <= smax; s++) {
				const dstIdx = ((surf.light_t + t) * LM_BLOCK_WIDTH + (surf.light_s + s)) * 4
				staging[dstIdx] = 255
				staging[dstIdx + 1] = 255
				staging[dstIdx + 2] = 255
				staging[dstIdx + 3] = 255
			}
		}
		return
	}

	if (surf.lightofs < 0)
		return // No lightmap data for this surface — leave staging black

	for (var m = 0; m < model.faceNumStyles[surf.num]; m++) {
		if (!pageEntry.slots[m])
			pageEntry.slots[m] = new Uint8Array(LM_BLOCK_WIDTH * LM_BLOCK_HEIGHT * 4)
		const staging = pageEntry.slots[m]
		const srcBase = surf.lightofs + m * size * 3

		// -1..max loops fill the 1-luxel gutter by replicating the edge samples
		for (var t = -1; t <= tmax; t++) {
			const st = t < 0 ? 0 : (t >= tmax ? tmax - 1 : t)
			for (var s = -1; s <= smax; s++) {
				const ss = s < 0 ? 0 : (s >= smax ? smax - 1 : s)
				const srcIdx = srcBase + (st * smax + ss) * 3
				const dstIdx = ((surf.light_t + t) * LM_BLOCK_WIDTH + (surf.light_s + s)) * 4
				staging[dstIdx] = model.lightdata[srcIdx]
				staging[dstIdx + 1] = model.lightdata[srcIdx + 1]
				staging[dstIdx + 2] = model.lightdata[srcIdx + 2]
				staging[dstIdx + 3] = 255
			}
		}
	}
}

// Upload a finished page's slot textures and drop its staging. A page is final
// once allocBlock's frontier (last_lightmap_allocated) has moved past it.
const uploadPageSlots = (gl: WebGLRenderingContext, page: number) => {
	const pageEntry = state.lightmap_pages[page]
	if (!pageEntry) return
	for (var slot = 0; slot < pageEntry.slots.length; slot++) {
		const slotData = pageEntry.slots[slot]
		if (slotData)
			loadLightmapTextureSlot(gl, page, slot, `lightmap#${page}_s${slot}`, LM_BLOCK_WIDTH, LM_BLOCK_HEIGHT, slotData)
	}
	pageEntry.slots = []
}

// GPU lightstyles: write raw per-style layers into per-page/per-slot staging at load time,
// then create GL textures for each slot. Dynamic lights are computed analytically in the
// Brush fragment shader (see fshBrush) — no per-frame lightmap texture updates needed.
export const buildLightmaps = (gl: WebGLRenderingContext, model: Model) => {

	// Upload-and-free each page as the allocation frontier passes it: staging
	// for a huge map would otherwise hold every page's slot buffers (256KB per
	// slot x hundreds of pages) simultaneously until the loop below.
	var flushed = state.last_lightmap_allocated

	for (var i=0 ; i<model.numfaces ; i++)
	{
		if (model.faces[i].flags & def.SURF.drawtiled)
			continue;
		createSurfaceLightmap (model, model.faces[i]);
		while (flushed < state.last_lightmap_allocated)
			uploadPageSlots(gl, flushed++)
	}

	// Create per-slot GL textures for every used page
	for (i = 0; i<MAXLIGHTMAPS; i++)
	{
		if (!state.allocated[i][0])
			break;		// no more used

		const pageEntry = state.lightmap_pages[i]
		if (pageEntry) {
			for (var slot = 0; slot < pageEntry.slots.length; slot++) {
				const slotData = pageEntry.slots[slot]
				if (slotData) {
					const slotName = `lightmap#${i}_s${slot}`
					loadLightmapTextureSlot(gl, i, slot, slotName, LM_BLOCK_WIDTH, LM_BLOCK_HEIGHT, slotData)
				}
			}
			if (i < state.last_lightmap_allocated)
				pageEntry.slots = []
		}
	}

	// Create the shared black fallback texture (used for missing style slots)
	createBlackTexture(gl)

	//johnfitz -- warn about exceeding old limits
	if (i >= 64)
		con.dPrint(`${i} lightmaps exceeds standard limit of 64 (max = ${MAXLIGHTMAPS}).\n`);
	//johnfitz
}


// WebGPU lightmap-array consolidation: pack the used lightmap pages into 4 per-style
// texture_2d_array layer maps so the world draw can bind ALL lightmaps once and batch by texture (no
// per-page draw flush). Must run AFTER the per-model buildLightmaps loop (so texture.state
// .lightmap_style_textures is fully populated) and BEFORE r.buildModelVertexBuffer (which reads these
// maps to emit the per-vertex layer stream). WebGPU-only — the WebGL path never calls this.
export const buildLightmapArrays = () => {
	let numPages = 0
	for (let i = 0; i < MAXLIGHTMAPS; i++) {
		if (!state.allocated[i][0]) break   // same used-page frontier as buildLightmaps
		numPages = i + 1
	}
	const counts = new Int32Array(4)
	const pageToLayer: Int32Array[] = [
		new Int32Array(numPages), new Int32Array(numPages), new Int32Array(numPages), new Int32Array(numPages),
	]
	// Slot 0 is populated for every page → dense: compact layer == page.
	for (let page = 0; page < numPages; page++) pageToLayer[0][page] = page
	counts[0] = numPages
	// Slots 1-3 are sparse: assign a compact layer only to pages whose slot m exists (-1 otherwise),
	// bounding each array to actual usage (matches the current sparse per-style memory).
	const lmtex = textureState.lightmap_style_textures
	for (let m = 1; m < 4; m++) {
		let layer = 0
		for (let page = 0; page < numPages; page++) {
			const slots = lmtex[page]
			pageToLayer[m][page] = (slots != null && slots[m] != null) ? layer++ : -1
		}
		counts[m] = layer
	}
	state.lmNumPages = numPages
	state.lmLayerCount = counts
	state.lmPageToLayer = pageToLayer
}


// Free the per-style staging buffers once every model's lightmaps are uploaded.
// Must not run between per-model buildLightmaps calls: models can share a page,
// and a fresh zeroed staging buffer would wipe earlier surfaces on re-upload.
export const freeStagingSlots = () => {
	for (const pageEntry of state.lightmap_pages) {
		if (pageEntry)
			pageEntry.slots = []
	}
}

