import * as com from './com'
import * as sys from './sys'
import * as GL from './GL'
import * as tx from './texture'
import * as r from './r'
import * as render from './render'
import * as con from './console'
import { WebGLRenderer } from './render/webgl/WebGLRenderer'
import { trackEvent } from '../shared/errorReporting'
import { WebGPURenderer } from './render/webgpu/WebGPURenderer'
import { webgpuAvailable, forceWebGL, state as backendState } from './render/backend'

export type VidState = {
	height: number
	width: number
	mainwindow: HTMLCanvasElement | null
}
export const state: VidState = {
	height:0,
	width: 0,
	mainwindow: null
}

export const d_8to24table = new Uint32Array(new ArrayBuffer(1024));

export const setPalette = async function()
{
	var palette = await com.loadFile('gfx/palette.lmp');
	if (palette == null)
		sys.error('Couldn\'t load gfx/palette.lmp');
	var pal = new Uint8Array(palette);
	var i, src = 0;
	for (i = 0; i < 256; ++i)
	{
		d_8to24table[i] = pal[src] + (pal[src + 1] << 8) + (pal[src + 2] << 16);
		src += 3;
	}
};

export const init = async function()
{
	document.getElementById('progress').style.display = 'none';
	// Backend selection. WebGPU is the DEFAULT whenever the browser can provide a device; `-webgl` forces
	// the WebGL2 backend (and `-webgpu` remains an explicit, now-redundant opt-in). Under WebGPU the visible
	// canvas is the WebGPU device and a WebGL2 context stays alive on an OFFSCREEN canvas as a resource
	// factory (texture.ts/mod.ts/r.init still create WebGL textures/VBOs whose bytes the WebGPU backend
	// reuses). If WebGPU init fails for any reason we fall back to WebGL2 on the visible canvas.
	if (!forceWebGL() && (await webgpuAvailable())) {
		const offscreen = document.createElement('canvas');
		offscreen.width = state.width || 1024;
		offscreen.height = state.height || 768;
		// Tell GL.init who asked, so a context failure reports the branch (see GL.state.initReason).
		GL.state.initReason = 'webgpu-offscreen-factory';
		GL.init(offscreen);
		try {
			const gpu = new WebGPURenderer();
			await gpu.init(state.mainwindow);
			render.setRenderer(gpu);
			console.log(`[render] WebGPU backend active — ${gpu.gpuName} (WebGL2 running offscreen as a resource factory)`);
			con.print('Renderer: WebGPU (' + gpu.gpuName + ')\n');
			trackEvent('render_backend', { mode: 'webgpu', gpu: gpu.gpuName });
		} catch (e: any) {
			console.warn('[render] WebGPU init failed — reverting to WebGL2 on the visible canvas:', e);
			GL.state.initReason = 'webgpu-init-failed';
			GL.init();
			render.setRenderer(new WebGLRenderer());
			console.log('[render] WebGL2 backend active (WebGPU init failed)');
			con.print('Renderer: WebGL2 — ' + GL.rendererName() + ' (WebGPU init failed)\n');
			trackEvent('render_backend', { mode: 'webgl2', reason: 'webgpu-init-failed', detail: e?.message || String(e), gl: GL.rendererName() });
		}
	} else {
		// The branch behind the production "Unable to initialize WebGL" report: record whether the user
		// forced WebGL or WebGPU was unavailable (+ the probe's own reason), since when BOTH APIs fail the
		// WebGPU half is what tells a blocked/dead GPU stack apart from a pre-WebGPU browser.
		GL.state.initReason = forceWebGL() ? 'forced-webgl-parm' : 'webgpu-unavailable:' + backendState.webgpuProbe;
		GL.init();
		// Install the live WebGL2 backend. GL.init() has already created the real context; the
		// WebGLRenderer.init() stub is intentionally NOT called (it throws until later slices) — this
		// non-breaking wiring coexists with the current direct-gl path, which the backend delegates to.
		render.setRenderer(new WebGLRenderer());
		console.log('[render] WebGL2 backend active' + (forceWebGL() ? ' (-webgl)' : ' (WebGPU unavailable)'));
		con.print('Renderer: WebGL2 — ' + GL.rendererName() + (forceWebGL() ? '\n' : ' (WebGPU unavailable)\n'));
		trackEvent('render_backend', { mode: 'webgl2', reason: forceWebGL() ? 'forced-webgl-parm' : 'webgpu-unavailable', gl: GL.rendererName() });
	}
	await setPalette()
};

export const free = () => {
	GL.freePrograms()
	tx.freeTextures()
	r.freeResources()
}