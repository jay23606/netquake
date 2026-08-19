import type { IWebRTCBroker } from '../../shared/webrtc/IWebRTCBroker'
import * as com from '../../engine/com'
import * as con from '../../engine/console'
import * as host from '../../engine/host'
import * as cvar from '../../engine/cvar'
import * as key from '../../engine/key'
import * as vid from '../../engine/vid'
import * as cl from '../../engine/cl'
import * as q from '../../engine/q'
import * as _assetStore from './assetStore'
import * as loop from './net/loop'
import * as webs from './net/webs'
import * as webrtc from './net/webrtc'
import * as input from '../../engine/input'
import * as cmd from '../../engine/cmd'
import IAssetStore from '../../engine/interfaces/store/IAssetStore'
import { stat } from 'fs'
import { reportError } from '../../shared/errorReporting'

export const assetStore: IAssetStore = _assetStore
type QuitStatus = {quitting: false} | {quitting: true, reason?: string}
export type UIHooks = {
	// Called when the game is quitting
	quit: (reason?: string) => void
	// Initiates the UI to request a pak file
	// Passes a callback to call when finished.
	startRequestPak: (callback: (value: unknown) => void) => void
	// Called when the local player renames in-game, so the UI can write it
	// back to its source of truth (autoexec.cfg).
	nameChanged?: (name: string) => void
}

export type InitArgs = {
	playerId: string | null
	isHost: boolean
	socket: WebSocket | null
	// A signaling broker the frontend has already connected (the Supabase path).
	// Mirrors `socket`: the async connect happens in the app so the engine stays
	// synchronous. When set, it takes precedence over `socket`.
	broker?: IWebRTCBroker | null
	roomId?: string | null
}

export type SysState = {
	scantokey: Record<string, number>,
	oldtime: number,
	// Used to signal the event loop to quit on next frame so the game can quit gracefully.
	quitStatus: QuitStatus,
	hooks: Partial<UIHooks>,
	initArgs: null | InitArgs
}

export const state: SysState = {
  scantokey: {},
  oldtime: 0.0,
  quitStatus: {quitting:false},
  hooks: {},
	initArgs: null
}

function trackError(message: string, stack?: string) {
	void reportError({ name: 'Engine Error', message: message || '', stack: stack || '' })
}

const onbeforeunload = function()
{
	return 'Are you sure you want to quit?';
};

const oncontextmenu = function(e: MouseEvent)
{
	e.preventDefault();
};

const onfocus = async function()
{
	var i;
	for (i = 0; i < 256; ++i)
	{
		await key.event(i, false);
		key.state.down[i] = false;
	}
};

const onkeydown = async function(e: KeyboardEvent)
{
	const _key = state.scantokey[e.code];
	if (_key == null)
		return;
	await key.event(_key, true, e.key);
	e.preventDefault();
};

const onkeyup = async function(e: KeyboardEvent)
{
	const _key = state.scantokey[e.code];
	if (_key == null)
		return;
	await key.event(_key, false);
	e.preventDefault();
};

// Maps a browser MouseEvent.which (1-indexed) to a Quake key number.
// which: 1=left, 2=middle, 3=right, 4=back, 5=forward.
const mouseButtonToKey = function(which: number)
{
	switch (which)
	{
	case 1:
		return key.KEY.mouse1;
	case 2:
		return key.KEY.mouse3;
	case 3:
		return key.KEY.mouse2;
	case 4:
		return key.KEY.mouse4;
	case 5:
		return key.KEY.mouse5;
	default:
		return null;
	}
};

const onmousedown = async function(e: MouseEvent)
{
	if (!input.hasPointerLock()) {
		return
	}
	var _key = mouseButtonToKey(e.which);
	if (_key == null)
		return;
	await key.event(_key, true)
	e.preventDefault();
};

const onmouseup = async function(e: MouseEvent)
{
	if (!input.hasPointerLock()) {
		return
	}
	var _key = mouseButtonToKey(e.which);
	if (_key == null)
		return;
	await key.event(_key, false)
	e.preventDefault();
};

const onmousewheel = async function(e: WheelEvent)
{
	var _key = e.deltaY > 0 ? key.KEY.mwheelup : key.KEY.mwheeldown;
	await key.event(_key, true);
	await key.event(_key, false);
	e.preventDefault();
};

const onunload = function()
{
	host.shutdown();
};

const onwheel = async function(e: WheelEvent)
{
	var _key = e.deltaY < 0 ? key.KEY.mwheelup : key.KEY.mwheeldown;
	await key.event(_key, true);
	await key.event(_key, false);
};

export const init = async (argv: string) =>
{
	if ((document.location.protocol !== 'http:') && (document.location.protocol !== 'https:'))
		error('Protocol is ' + document.location.protocol + ', not http: or https:');
	if (Number.isNaN != null)
		q.state.isNaN = Number.isNaN;
	else
		q.state.isNaN = isNaN;

	var i;

	const args = [location.href.substring(0, location.href.length - location.search.length)]
	// var cmdline = decodeURIComponent(document.location.search);
	
	// var location = document.location;
	// var argv = [location.href.substring(0, location.href.length - location.search.length)];

	var text = '';
	var quotes = false;
	var c;
	for (i = 0; i < argv.length; ++i)
	{
		c = argv.charCodeAt(i);
		if ((c < 32) || (c > 127))
			continue;
		if (c === 34)
		{
			quotes = !quotes;
			continue;
		}
		if ((quotes === false) && (c === 32))
		{
			if (text.length === 0)
				continue;
			args.push(text);
			text = '';
			continue;
		}
		text += argv.charAt(i);
	}
	if (text.length !== 0){
		args.push(text);
	}
	com.initArgv(args);

	var elem = document.documentElement;
	vid.state.width = (elem.clientWidth <= 320) ? 320 : elem.clientWidth;
	vid.state.height = (elem.clientHeight <= 200) ? 200 : elem.clientHeight;
	
	state.quitStatus = {quitting:false};
	state.scantokey = {
		'Backspace':      key.KEY.backspace,
		'Tab':            key.KEY.tab,
		'Enter':          key.KEY.enter,
		'NumpadEnter':    key.KEY.enter,
		'ShiftLeft':      key.KEY.shift,
		'ShiftRight':     key.KEY.shift,
		'ControlLeft':    key.KEY.ctrl,
		'ControlRight':   key.KEY.ctrl,
		'AltLeft':        key.KEY.alt,
		'AltRight':       key.KEY.alt,
		'Pause':          key.KEY.pause,
		'Escape':         key.KEY.escape,
		'Space':          key.KEY.space,
		'PageUp':         key.KEY.pgup,
		'Numpad9':        key.KEY.pgup,
		'PageDown':       key.KEY.pgdn,
		'Numpad3':        key.KEY.pgdn,
		'End':            key.KEY.end,
		'Numpad1':        key.KEY.end,
		'Home':           key.KEY.home,
		'Numpad7':        key.KEY.home,
		'ArrowLeft':      key.KEY.leftarrow,
		'Numpad4':        key.KEY.leftarrow,
		'ArrowUp':        key.KEY.uparrow,
		'Numpad8':        key.KEY.uparrow,
		'ArrowRight':     key.KEY.rightarrow,
		'Numpad6':        key.KEY.rightarrow,
		'ArrowDown':      key.KEY.downarrow,
		'Numpad2':        key.KEY.downarrow,
		'Insert':         key.KEY.ins,
		'Numpad0':        key.KEY.ins,
		'Delete':         key.KEY.del,
		'NumpadDecimal':  key.KEY.del,
		'Digit0': 48, 'Digit1': 49, 'Digit2': 50, 'Digit3': 51, 'Digit4': 52,
		'Digit5': 53, 'Digit6': 54, 'Digit7': 55, 'Digit8': 56, 'Digit9': 57,
		'Semicolon':      59,
		'Equal':          61,
		'KeyA': 97,  'KeyB': 98,  'KeyC': 99,  'KeyD': 100, 'KeyE': 101,
		'KeyF': 102, 'KeyG': 103, 'KeyH': 104, 'KeyI': 105, 'KeyJ': 106,
		'KeyK': 107, 'KeyL': 108, 'KeyM': 109, 'KeyN': 110, 'KeyO': 111,
		'KeyP': 112, 'KeyQ': 113, 'KeyR': 114, 'KeyS': 115, 'KeyT': 116,
		'KeyU': 117, 'KeyV': 118, 'KeyW': 119, 'KeyX': 120, 'KeyY': 121,
		'KeyZ': 122,
		'MetaLeft':       key.KEY.command,
		'MetaRight':      key.KEY.command,
		'NumpadMultiply': 42,
		'NumpadAdd':      43,
		'NumpadSubtract': 45,
		'Minus':          45,
		'NumpadDivide':   47,
		'Slash':          47,
		'F1':  key.KEY.f1,  'F2':  key.KEY.f2,  'F3':  key.KEY.f3,
		'F4':  key.KEY.f4,  'F5':  key.KEY.f5,  'F6':  key.KEY.f6,
		'F7':  key.KEY.f7,  'F8':  key.KEY.f8,  'F9':  key.KEY.f9,
		'F10': key.KEY.f10, 'F11': key.KEY.f11, 'F12': key.KEY.f12,
		'Comma':          44,
		'Period':         46,
		'Backquote':      96,
		'BracketLeft':    91,
		'Backslash':      92,
		'IntlBackslash':  92, // UK extra key (between LShift and Z)
		'BracketRight':   93,
		'Quote':          39,
	};

	state.oldtime = Date.now() * 0.001;

	print('Host.Init\n');

	// Backend selection. The DEFAULT is the WASM sim on the MAIN THREAD (~1.7x faster server
	// tick than the JS sim, bit-exact vs it); `-nowasm` opts back into the in-process JS
	// server (kept as the A/B + fallback baseline). `-worker` must STAY OPT-IN, never a
	// default: running the server on a Worker adds server-round-trip input latency (NQ has
	// no client prediction to hide it) — see docs/server-worker.md. The sim choice composes
	// with it (worker+WASM by default, worker+JS with -nowasm).
	// Degradation stays graceful, with a game-console note: no WebAssembly -> JS server; the
	// WASM sim failing to instantiate/trapping -> JS server (wasmServer.activate); a browser
	// that can't spawn the module worker (older Firefox) -> server on the main thread.
	// (`-wasm` remains accepted as a no-op for old links.)
	let workerMode = args.indexOf('-worker') !== -1
	let wasmMode = args.indexOf('-nowasm') === -1
	if (wasmMode && typeof WebAssembly !== 'object') {
		con.print('WebAssembly is not supported by this browser — using the JavaScript server.\n')
		wasmMode = false
	}
	let workerServer: any = null
	if (workerMode) {
		try {
			const { createWorkerServer } = await import('./net/workerServer')
			workerServer = createWorkerServer()
			// Surface the worker (server) console in the game console, like a non-worker server
			// prints directly to it — otherwise server output (incl. the [sv_wasm] backend
			// status) only reaches devtools and looks like nothing happened.
			workerServer.onConsole = (t: string) => con.print(t)
			// boot the worker with searchpath args only; every map (initial +map and
			// later changelevels) is forwarded from this thread's map_f, so strip +map
			// to avoid a double spawn.
			const workerArgs: string[] = []
			for (var wi = 0; wi < args.length; wi++) {
				if (args[wi] === '+map') { wi++; continue }
				workerArgs.push(args[wi])
			}
			// The worker host is `dedicated` (headless), which otherwise defaults to an
			// 8-slot listen server -> maxclients>1 -> deathmatch 1, so monsters remove
			// themselves and only items spawn. Single-player-over-worker hosts exactly
			// one client (this renderer), so force maxclients=1 (deathmatch 0) unless
			// the launch explicitly asked for more.
			if (workerArgs.indexOf('-maxplayers') === -1)
				workerArgs.push('-maxplayers', '1')
			workerServer.boot(workerArgs)
			// Wait for the worker to actually come up BEFORE choosing the network driver, so a
			// worker that can't start (no module-worker support, etc.) falls back cleanly rather
			// than hanging on a driver that never answers. `ready` rejects on the worker's
			// onerror or a timeout (see createWorkerServer).
			await workerServer.ready
		} catch (e: any) {
			con.print('Server worker unavailable (' + ((e && e.message) || e) + ') — running the server on the main thread.\n')
			try { if (workerServer) workerServer.terminate() } catch (_e) { /* ignore */ }
			workerServer = null
			workerMode = false
		}
	}

	try {
		await host.init(false, assetStore,
			workerMode ? [workerServer.driver, webrtc, webs] : [loop, webrtc, webs]);
	}
	catch (e) {
		trackError(e.message, e.stack)
		state.hooks.quit(e.message);
		return
	}

	if (workerMode) {
		host.state.workerServer = { sendCommand: (t: string) => workerServer.sendCommand(t), nextCmdDone: () => workerServer.nextCmdDone() }
		// run the WASM sim ON the worker. The worker registers its own activator
		// (serverWorker.ts); enable it by setting the server-side cvar over the cmd channel.
		if (wasmMode) workerServer.sendCommand('sv_wasm 1')
	} else {
		// Main-thread server: register the WASM-sim backend (activated per-map by
		// host.serverFrame when sv_wasm=1; falls back to sv.physics with a console note if it
		// fails to instantiate — see wasmServer.activate / disableBackend).
		const wasmSrv = await import('./net/wasmServer')
		host.state.wasmServerActivate = () => wasmSrv.activate()
		if (wasmMode) cvar.set('sv_wasm', '1')   // run the WASM sim in-process
	}

	// Announce the selected server sim, styled like the `Renderer:` line above it (in worker
	// mode `sv_wasm` typed in the client console reads the main-thread copy, which stays 0 — the
	// real server cvar lives on the worker — so this line is the reliable indicator). This is the
	// INTENT at boot; the per-map truth follows at activation ("[sv_wasm] WASM server backend
	// loaded (N edicts)") or on the fallback lines (load failure / mid-game trap → JS).
	con.print('Server sim: ' + (wasmMode ? 'WASM' : 'JavaScript') + ' ('
		+ (workerMode ? 'Web Worker' : 'main thread')
		+ (wasmMode ? '' : (typeof WebAssembly !== 'object' ? ', WebAssembly unavailable' : ', -nowasm'))
		+ ')\n')

	// On mobile (touch) devices the warp FBO path has driver-specific issues on
	// Android tile-based GPUs. Disable r_waterwarp so the world stays visible
	// underwater. The console.log from scr.ts will show the FBO status for debugging.
	const isTouchDevice = navigator.maxTouchPoints > 0 && window.matchMedia('(pointer: coarse)').matches
	if (isTouchDevice) {
		queueCommand('r_waterwarp 0')
	}

  const eventNames = Object.keys(events) as (keyof typeof events)[]
	for (i = 0; i < eventNames.length; ++i){
		window[eventNames[i] as any] = events[eventNames[i]] as any; // @ts-ignore
  }
	// requestAnimationFrame stops in hidden tabs. For a listen-server host that
	// freezes the server simulation, so every peer connected to it times out and
	// drops -- the game dies as soon as the host's window goes behind another.
	// Worker timers keep firing when the page is hidden, so the frame pump moves
	// to one for as long as that lasts, at a reduced rate: ample for NetQuake's
	// ~20Hz snapshots without doing full-rate render work nobody can see.
	const HIDDEN_TICK_MS = 33
	let tickWorker: Worker | null = null
	let pumpMode: 'raf' | 'worker' = 'raf'
	let frameInFlight = false

	const ensureTickWorker = (): Worker | null => {
		if (tickWorker) return tickWorker
		try {
			const src = 'let i=null;onmessage=(e)=>{clearInterval(i);i=null;'
				+ 'if(!e.data.stop){i=setInterval(()=>postMessage(0),e.data.ms)}}'
			const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }))
			tickWorker = new Worker(url)
			URL.revokeObjectURL(url)
			// Unlike rAF this fires on a fixed interval regardless of how long the
			// previous frame took, so overlapping entry has to be refused.
			tickWorker.onmessage = () => {
				if (document.hidden && !frameInFlight) void gameLoop(performance.now())
			}
		} catch {
			tickWorker = null // no worker (CSP, old browser) -> setTimeout fallback
		}
		return tickWorker
	}

	const scheduleFrame = () => {
		if (document.hidden) {
			const w = ensureTickWorker()
			if (w) {
				if (pumpMode !== 'worker') {
					pumpMode = 'worker'
					w.postMessage({ ms: HIDDEN_TICK_MS })
				}
				return // the worker's tick drives the next frame from here
			}
			setTimeout(() => void gameLoop(performance.now()), HIDDEN_TICK_MS)
			return
		}
		if (pumpMode === 'worker') {
			pumpMode = 'raf'
			tickWorker?.postMessage({ stop: true })
		}
		requestAnimationFrame(gameLoop)
	}

	// Resume immediately on becoming visible rather than waiting out a worker tick.
	document.addEventListener('visibilitychange', () => {
		if (!document.hidden && pumpMode === 'worker' && !frameInFlight) scheduleFrame()
	})

	let rafLastTime = 0
	const gameLoop = async (timestamp: number) => {
		// Skip frames that arrive before the maxfps interval has elapsed; 0 = uncapped
		// (every rAF), matching host_maxfps 0 semantics -- not a 60fps fallback
		if (cl.cvr.maxfps.value > 0) {
			const minInterval = 1000 / cl.cvr.maxfps.value
			if (timestamp - rafLastTime < minInterval - 1) {
				scheduleFrame()
				return
			}
		}
		rafLastTime = timestamp
		frameInFlight = true

		try{
			await host.frame();
		}
		catch(e) {
			if(e && e.message)
			{
				console.log(e && e.message)
				console.log(e && e.stack)
				trackError(e.message, e.stack)
				debugger
				quit(e.message)
			}
		}

		if(state.quitStatus.quitting) {
			var i;
			const eventNames = Object.keys(events)
			for (i = 0; i < eventNames.length; ++i)
				window[eventNames[i] as any] = null; // @ts-ignore
			host.shutdown();
			tickWorker?.terminate()
			tickWorker = null
			document.body.style.cursor = 'auto';
			if (state.hooks && state.hooks.quit) {
				state.hooks.quit(state.quitStatus.reason || '');
			}
			return;
		}

		frameInFlight = false
		scheduleFrame()
	}

	scheduleFrame();
};

const events = {
  onbeforeunload,
  oncontextmenu,
  onfocus,
  onkeydown,
  onkeyup,
  onmousedown,
  onmouseup,
  onmousewheel,
  onunload,
  onwheel
}

export const floatTime = (): number =>
{
	return Date.now() * 0.001 - state.oldtime;
};

export const print = function(text: string)
{
	if (window.console != null)
		console.log(text);
};

export const quit = function(reason? : string)
{
	state.quitStatus = {quitting: true, reason}
};

export const error = function(text: string)
{
	throw new Error(`Error: ${text}`)
};

export const getExternalCommand = (): string => {
	return null
}

export const registerHooks = (hooks: UIHooks) => {
	state.hooks = hooks
}

export const requestPak = () => {
	if (state.hooks && state.hooks.startRequestPak) {
		return new Promise((resolve, reject) => {
			state.hooks.startRequestPak(resolve)
		})
	}
	return Promise.resolve()
}

export const nameChanged = (name: string) => {
	state.hooks.nameChanged?.(name)
}

export const queueCommand = (command: string) => {
	cmd.state.text += command + '\n'
}

export const sendMouseDelta = (x: number, y: number) => {
	input.addMouseDelta(x, y)
}

export const sendKeyEvent = async (keyCode: number, down: boolean) => {
	await key.event(keyCode, down)
}

export const getKeyDest = (): number => {
	return key.state.dest
}

// Key code constants for touch controls
export const TOUCH_KEYS = {
	uparrow: key.KEY.uparrow,
	downarrow: key.KEY.downarrow,
	leftarrow: key.KEY.leftarrow,
	rightarrow: key.KEY.rightarrow,
	enter: key.KEY.enter,
	escape: key.KEY.escape,
	mwheelup: key.KEY.mwheelup,
	mwheeldown: key.KEY.mwheeldown,
}

export const KEY_DEST_GAME = 0
export const KEY_DEST_MENU = 3