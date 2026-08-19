import * as cl from './cl'
import * as host from './host'
import * as cmd from './cmd'
import * as vid from './vid'
import * as con from './console'
import * as key from './key'
import * as v from './v'
import * as draw from './draw'
import * as cvar from './cvar'
import * as r from './r'
import * as scr from './scr'
import * as s from './s'
import * as sbar from './sbar'
import * as m from './m'
import * as GL from './GL'
import * as render from './render'


export const state = {
  con_current: 0,
  centertime_off: 0.0,
  centerstring: [],
	// Precache progress drawn during map load; null when not loading.
	loadProgress: null as null | { text: string, current: number, total: number },
	sizeDirty: true,
	clientWidth: 320,
	clientHeight: 200,
	pixelRatio: 1.0,
	fps: {
		oldtime: 0,
		lastVal: 0,
		oldframecount: 0
	}
} as any

const markSizeDirty = () => { state.sizeDirty = true; }

export const cvr = {
} as any

// Vanilla's centerprint canvas is 40 columns wide (320/8).
const CENTER_COLS = 40;

// The column break is ours — vanilla, QSS-M and Ironwail all split on '\n' only and let a long
// line run off both edges. It breaks between words because rerelease strings arrive as one
// unwrapped line (mg3_start_intermission is 300 chars with no '\n') that a hard chop mangles.
const wrapCenterLine = function(line: string, out: string[])
{
	while (line.length > CENTER_COLS)
	{
		// lastIndexOf is inclusive, so a space on the boundary still yields a full-width line.
		var brk = line.lastIndexOf(' ', CENTER_COLS);
		if (brk <= 0)
			brk = CENTER_COLS;	// a single word wider than the canvas: chop it
		out[out.length] = line.substring(0, brk);
		line = line.substring(line.charCodeAt(brk) === 32 ? brk + 1 : brk);
	}
	out[out.length] = line;
};

export const centerPrint = function(str: string)
{
	state.centerstring = [];
	var lines = str.split('\n'), i;
	for (i = 0; i < lines.length; ++i)
		wrapCenterLine(lines[i], state.centerstring);
	state.centertime_off = cvr.centertime.value;
	state.centertime_start = cl.clState.time;
}

export const drawCenterString = function()
{
	state.centertime_off -= host.state.frametime;
	if (((state.centertime_off <= 0.0) && (cl.clState.intermission === 0)) || (key.state.dest !== key.KEY_DEST.game))
		return;

	var y;
	if (state.centerstring.length <= 4)
		y = Math.floor(vid.state.height * 0.35);
	else
		y = 48;

	var i;
	if (cl.clState.intermission)
	{
		var remaining = Math.floor(cvr.printspeed.value * (cl.clState.time - state.centertime_start));
		var str, x, j;
		for (i = 0; i < state.centerstring.length; ++i)
		{
			str = state.centerstring[i];
			x = (vid.state.width - (str.length * con.cvr.textsize.value)) >> 1;
			for (j = 0; j < str.length; ++j)
			{
				draw.character(x, y, str.charCodeAt(j));
				if ((remaining--) === 0)
					return;
				x += con.cvr.textsize.value;
			}
			y += con.cvr.textsize.value;
		}
		return;
	}

	for (i = 0; i < state.centerstring.length; ++i)
	{
		draw.string((vid.state.width - (state.centerstring[i].length * con.cvr.textsize.value)) >> 1, y, state.centerstring[i]);
		y += con.cvr.textsize.value;
	}
};

export const calcRefdef = function()
{
	state.recalc_refdef = false;

	if (cvr.viewsize.value < 30)
		cvar.set('viewsize', '30');
	else if (cvr.viewsize.value > 120)
		cvar.set('viewsize', '120');

	var size, full;
	if (cl.clState.intermission !== 0)
	{
		full = true;
		size = 1.0;
		sbar.state.lines = 0;
	}
	else
	{
		size = cvr.viewsize.value;
		if (size >= 120.0)
			sbar.state.lines = 0;
		else if (size >= 110.0)
			sbar.state.lines = 24 * sbar.state.scale;
		else
			sbar.state.lines = 48 * sbar.state.scale;
		if (size >= 100.0)
		{
			full = true;
			size = 100.0;
		}
		size *= 0.01;
	}

	var vrect = r.state.refdef.vrect;
	vrect.width = Math.floor(vid.state.width * size);
	if (vrect.width < 96)
	{
		size = 96.0 / vrect.width;
		vrect.width = 96;
	}
	vrect.height = Math.floor(vid.state.height * size);
	if (vrect.height > (vid.state.height - sbar.state.lines))
		vrect.height = vid.state.height - sbar.state.lines;
	vrect.x = (vid.state.width - vrect.width) >> 1;
	if (full === true)
		vrect.y = 0;
	else
		vrect.y = (vid.state.height - sbar.state.lines - vrect.height) >> 1;

	if (cvr.fov.value < 10)
		cvar.set('fov', '10');
	else if (cvr.fov.value > 170)
		cvar.set('fov', '170');
	if ((vrect.width * 0.75) <= vrect.height)
	{
		r.state.refdef.fov_x = cvr.fov.value;
		r.state.refdef.fov_y = Math.atan(vrect.height / (vrect.width / Math.tan(cvr.fov.value * Math.PI / 360.0))) * 360.0 / Math.PI;
	}
	else
	{
		r.state.refdef.fov_x = Math.atan(vrect.width / (vrect.height / Math.tan(cvr.fov.value * 0.82 * Math.PI / 360.0))) * 360.0 / Math.PI;
		r.state.refdef.fov_y = cvr.fov.value * 0.82;
	}

	var ymax = 4.0 * Math.tan(r.state.refdef.fov_y * Math.PI / 360.0);
	r.state.perspective[0] = 4.0 / (ymax * r.state.refdef.vrect.width / r.state.refdef.vrect.height);
	r.state.perspective[5] = 4.0 / ymax;
	GL.ortho[0] = 2.0 / vid.state.width;
	GL.ortho[5] = -2.0 / vid.state.height;

	r.state.warpwidth = Math.max(1, Math.min((vrect.width * state.devicePixelRatio) >> 0, 2048));
	r.state.warpheight = Math.max(1, Math.min((vrect.height * state.devicePixelRatio) >> 0, 2048));
	// The warp-FBO reallocation (WebGL) moved into the backend (phase5); it re-checks size internally.
	render.getRenderer().resizeWarp();
};

export const sizeUp_f = function()
{
	cvar.setValue('viewsize', cvr.viewsize.value + 10);
	state.recalc_refdef = true;
};

export const sizeDown_f = function()
{
	cvar.setValue('viewsize', cvr.viewsize.value - 10);
	state.recalc_refdef = true;
};

export const init = async function()
{
  state.con_current = 0
  state.centertime_off = 0.0
  state.centerstring = []
	state.sizeDirty = true
	// remove first so re-initializing the engine doesn't stack listeners
	window.removeEventListener('resize', markSizeDirty)
	window.addEventListener('resize', markSizeDirty)
	cvr.fov = cvar.registerVariable('fov', '90');
	cvr.viewsize = cvar.registerVariable('viewsize', '100', true);
	cvr.conspeed = cvar.registerVariable('scr_conspeed', '300');
	cvr.showturtle = cvar.registerVariable('showturtle', '0');
	cvr.showpause = cvar.registerVariable('showpause', '1');
	cvr.centertime = cvar.registerVariable('scr_centertime', '2');
	cvr.printspeed = cvar.registerVariable('scr_printspeed', '8');
	cvr.showfps = cvar.registerVariable('scr_showfps', '0');
	// Inert: the rerelease QC sets it unconditionally and only needs it to exist. In FTE it
	// switches prints to UTF-8 kfont parsing, which loc.ts's charset fold covers instead.
	cvr.usekfont = cvar.registerVariable('scr_usekfont', '0');
	cmd.addCommand('screenshot', screenShot_f);
	cmd.addCommand('sizeup', sizeUp_f);
	cmd.addCommand('sizedown', sizeDown_f);
	state.net = draw.picFromWad('NET');
	state.turtle = draw.picFromWad('TURTLE');
	state.pause = await draw.cachePic('pause');
};

var count = 0;
export const drawTurtle = function()
{
	if (cvr.value === 0)
		return;
	if (host.state.frametime < 0.1)
	{
		count = 0;
		return;
	}
	if (++count >= 3)
		draw.pic(r.state.refdef.vrect.x, r.state.refdef.vrect.y, state.turtle);
};

export const drawDownloadProgress = function()
{
	if (!cl.dlState.download.active || cl.dlState.download.size <= 0)
		return;
	const pct = Math.floor(cl.dlState.download.received * 100 / cl.dlState.download.size);
	const filename = cl.dlState.download.filename;
	const textSize = con.cvr.textsize?.value || 16;
	const text = 'Downloading ' + filename + ' ' + pct + '%';
	const x = (vid.state.width - text.length * textSize) >> 1;
	const y = vid.state.height >> 1;
	draw.string(x, y, text, textSize);

	// Draw a simple progress bar below the text
	const barWidth = Math.min(vid.state.width - 64, 320);
	const barX = (vid.state.width - barWidth) >> 1;
	const barY = y + textSize + 4;
	const barHeight = textSize;
	const fillWidth = Math.floor(barWidth * cl.dlState.download.received / cl.dlState.download.size);
	draw.fill(barX, barY, barWidth, barHeight, 0);
	if (fillWidth > 0)
		draw.fill(barX, barY, fillWidth, barHeight, 79);
};

export const drawLoadProgress = function()
{
	const p = state.loadProgress;
	if (p == null || p.total <= 0)
		return;
	const textSize = con.cvr.textsize?.value || 16;
	const x = (vid.state.width - p.text.length * textSize) >> 1;
	const y = vid.state.height >> 1;
	draw.string(x, y, p.text, textSize);

	const barWidth = Math.min(vid.state.width - 64, 320);
	const barX = (vid.state.width - barWidth) >> 1;
	const barY = y + textSize + 4;
	const fillWidth = Math.floor(barWidth * p.current / p.total);
	draw.fill(barX, barY, barWidth, textSize, 0);
	if (fillWidth > 0)
		draw.fill(barX, barY, fillWidth, textSize, 79);
};

export const drawNet = function()
{
	if (((host.state.realtime - cl.clState.last_received_message) >= 0.3) && (cl.cls.demoplayback !== true))
		draw.pic(r.state.refdef.vrect.x, r.state.refdef.vrect.y, state.net);
};

export const drawShowlmps = function()
{
	for (const entry of cl.state.showlmps.values())
		draw.pic(entry.x, entry.y, entry.pic);
};

export const drawPause = function()
{
	if ((cvr.showpause.value !== 0) && (cl.clState.paused === true))
		draw.pic((vid.state.width - state.pause.width) >> 1, (vid.state.height - 48 - state.pause.height) >> 1, state.pause);
};

export const setUpToDrawConsole = function()
{
	con.state.forcedup = (cl.clState.worldmodel == null) || (cl.cls.signon !== 4);

	if (con.state.forcedup === true)
	{
		state.con_current = 200;
		return;
	}

	var conlines;
	if (key.state.dest === key.KEY_DEST.console)
		conlines = 100;
	else
		conlines = 0;

	if (conlines < state.con_current)
	{
		state.con_current -= cvr.conspeed.value * host.state.frametime;
		if (conlines > state.con_current)
			state.con_current = conlines;
	}
	else if (conlines > state.con_current)
	{
		state.con_current += cvr.conspeed.value * host.state.frametime;
		if (conlines < state.con_current)
			state.con_current = conlines;
	}
};

const drawFPS = function () {
	let elapsed_time = host.state.realtime - state.fps.oldtime;
	let frames = host.state.framecount - state.fps.oldframecount
	if (elapsed_time < 0 || frames < 0)
	{
		state.fps.oldtime = host.state.realtime;
		state.fps.oldframecount = host.state.framecount;
		return;
	}

	if (elapsed_time > 0.75) {
		state.fps.lastVal = frames / elapsed_time
		state.fps.oldtime = host.state.realtime
		state.fps.oldframecount = host.state.framecount
	}

	if (cvr.showfps.value) {
		const str = `${Math.round(state.fps.lastVal)} fps`
		const x = vid.state.width - (str.length << 4)
		const y = vid.state.height - 16
		draw.string(x, y, str)
	}
}

export const drawConsole = function()
{
	if (state.con_current > 0)
	{
		con.drawConsole(state.con_current);
		return;
	}
	if ((key.state.dest === key.KEY_DEST.game) || (key.state.dest === key.KEY_DEST.message))
		con.drawNotify();
};

export const screenShot_f = function()
{
	state.screenshot = true;
};

export const beginLoadingPlaque = function()
{
	s.stopAllSounds();
	if ((cl.cls.state !== cl.ACTIVE.connected) || (cl.cls.signon !== 4))
		return;
	state.centertime_off = 0.0;
	state.con_current = 0;
	state.disabled_for_loading = true;
	state.disabled_time = host.state.realtime + 60.0;
};

export const endLoadingPlaque = function()
{
	state.disabled_for_loading = false;
	con.clearNotify();
};

export const updateScreen = function()
{
	render.getRenderer().beginFrame();
	// In the original C engine, disabled_for_loading blanked the screen during
	// synchronous map loads. In this async port, loading spans many frames so
	// blanking causes a visible freeze. Let the normal console/loading path
	// in setUpToDrawConsole handle the signon transition instead.
	if (state.disabled_for_loading && host.state.realtime > state.disabled_time) {
		state.disabled_for_loading = false;
		con.print('load failed.\n');
	}

	// Reading clientWidth/clientHeight forces a synchronous layout pass in the
	// browser, so only touch the DOM when a resize has actually happened.
	if (state.sizeDirty) {
		state.sizeDirty = false;
		var elem = document.documentElement;
		state.clientWidth = (elem.clientWidth <= 320) ? 320 : elem.clientWidth;
		state.clientHeight = (elem.clientHeight <= 200) ? 200 : elem.clientHeight;
		state.pixelRatio = (window.devicePixelRatio >= 1.0) ? window.devicePixelRatio : 1.0;
	}
	var width = state.clientWidth;
	var height = state.clientHeight;
	var pixelRatio = state.pixelRatio;
	if ((vid.state.width !== width) || (vid.state.height !== height) || (state.devicePixelRatio !== pixelRatio) || (host.state.framecount === 0))
	{
		vid.state.width = width;
		vid.state.height = height;
		vid.state.mainwindow.width = (width * pixelRatio) >> 0;
		vid.state.mainwindow.height = (height * pixelRatio) >> 0;
		vid.state.mainwindow.style.width = width + 'px';
		vid.state.mainwindow.style.height = height + 'px';
		state.devicePixelRatio = pixelRatio;
		state.recalc_refdef = true;
	}

	if (state.oldfov !== cvr.fov.value)
	{
		state.oldfov = cvr.fov.value;
		state.recalc_refdef = true;
	}
	if (state.oldscreensize !== cvr.viewsize.value)
	{
		state.oldscreensize = cvr.viewsize.value;
		state.recalc_refdef = true;
	}
	if (state.recalc_refdef === true)
		calcRefdef();

	setUpToDrawConsole();
	v.renderView();
	render.getRenderer().begin2D();
	if (r.state.dowarp === true)
		render.getRenderer().endScene();
	if (con.state.forcedup !== true)
		render.getRenderer().polyBlend(v.blend);

	drawDownloadProgress();
	drawLoadProgress();

	if (cl.cls.state === cl.ACTIVE.connecting)
		drawConsole();
	else if ((cl.clState.intermission === 1) && (key.state.dest === key.KEY_DEST.game))
		sbar.intermissionOverlay();
	else if ((cl.clState.intermission === 2) && (key.state.dest === key.KEY_DEST.game))
	{
		sbar.finaleOverlay();
		drawCenterString();
	}
	else if ((cl.clState.intermission === 3) && (key.state.dest === key.KEY_DEST.game))
		drawCenterString();
	else
	{
		if (v.cvr.crosshair.value !== 0)
		{
			draw.character(r.state.refdef.vrect.x + (r.state.refdef.vrect.width >> 1) + v.cvr.crossx.value,
				r.state.refdef.vrect.y + (r.state.refdef.vrect.height >> 1) + v.cvr.crossy.value, 43);
		}
		drawNet();
		drawTurtle();
		drawPause();
		drawCenterString();
		drawShowlmps();
		sbar.drawSbar();
		drawFPS();
		drawConsole();
		m.drawMenu();
	}

	render.getRenderer().endFrame();

	if (state.screenshot === true)
	{
		state.screenshot = false;
		render.getRenderer().finishFrame();
		// OPEN is not defined, wtf?
		// oh it's browser API.
		open(vid.state.mainwindow.toDataURL('image/jpeg'));
	}
};