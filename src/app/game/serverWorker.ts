// Server Worker entry (see docs/server-worker.md, P1). Runs the dedicated Quake
// host (server simulation only, no renderer) on a worker thread. Talks to the
// main-thread client over a MessageChannel via the worker-loop network driver.
//
// Boot handshake (main -> worker, default channel):
//   { boot: string[]  // argv (game/map args)
//     netPort: MessagePort }   // the server end of the game transport
// Runtime control (main -> worker, default channel):
//   { ch: 'cmd', text }  // console command to run server-side (e.g. "map x")
// Worker -> main (default channel):
//   { ch: 'console', text } | { ch: 'ready' } | { ch: 'quit' } | { ch: 'error', text }
import * as sys from '../../engine/sys'
import * as com from '../../engine/com'
import * as host from '../../engine/host'
import * as _assetStore from './assetStore'
import { createWorkerSys } from './net/workerSys'
import { createWorkerLoopDriver } from './net/workerLoop'
import { wrapMessagePort } from './net/workerPort'
// Static (not dynamic) import: the worker entry bundles as a single IIFE, which can't
// code-split. Top-level is side-effect-free (fetch/instantiate happen lazily in activate).
import * as wasmSrv from './net/wasmServer'

const assetStore = _assetStore as any

declare const self: {
  postMessage: (m: any) => void
  onmessage: ((ev: { data: any }) => void) | null
}

let externalCommandBuffer = ''
let ranExternalCmd = false
const pullExternalCommands = () => {
  const t = externalCommandBuffer
  externalCommandBuffer = ''
  if (t.length) ranExternalCmd = true
  return t.length ? t : (undefined as any)
}

let ticLoopStarted = false
const startTickLoop = () => {
  if (ticLoopStarted) return
  ticLoopStarted = true
  self.postMessage({ ch: 'ready' })
  const tick = async () => {
    try {
      await host.frame()
    } catch (e: any) {
      self.postMessage({ ch: 'error', text: (e && e.message) || String(e) })
      if (e && e.stack) self.postMessage({ ch: 'console', text: e.stack + '\n' })
    }
    // A forwarded command (map/load) fully executed this frame -- host.frame awaits
    // its async handler, so spawnServer + savegame restore are done. Tell the main
    // thread it is now safe to `connect local` (loadgame_f's client must not connect
    // mid-load or it spawns into a half-restored server and the connection times out).
    if (ranExternalCmd) {
      ranExternalCmd = false
      self.postMessage({ ch: 'cmddone' })
    }
    // same cadence source as the node dedicated server (host_ticrate)
    const ms = (host.cvr as any).ticrate ? (host.cvr as any).ticrate.value * 1000.0 : 1000 / 72
    setTimeout(tick, ms)
  }
  tick()
}

const boot = async (argv: string[], netPort: MessagePort) => {
  const netDriver = createWorkerLoopDriver(wrapMessagePort(netPort as any), 'server') as any
  // engine reads argv from com; initArgv before sys.init/host.init (matches the
  // node dedicated server order in server/game/sys.ts)
  com.initArgv(argv)
  const workerSys = createWorkerSys({
    assetStore,
    netDrivers: [netDriver],
    externalCommands: pullExternalCommands,
    onInitialized: startTickLoop,
  })
  // argv[0] is the base path token; sys.init forwards it to workerSys.init
  await sys.init(argv.join(' '), workerSys)
  // Let the WASM-sim backend run ON this worker when sv_wasm=1 (the main thread forwards
  // `sv_wasm 1` for `-worker -wasm`). Registered after sys.init so host.init's state
  // reset doesn't clobber it; the worker's own engine hosts the sound/msg/cvar bridges,
  // and its sendClientMessages serializes the datagram back to the main-thread client.
  host.state.wasmServerActivate = () => wasmSrv.activate()
}

self.onmessage = (ev: { data: any }) => {
  const msg = ev.data
  if (msg && msg.boot) {
    boot(msg.boot as string[], msg.netPort as MessagePort).catch((e: any) => {
      self.postMessage({ ch: 'error', text: (e && e.message) || String(e) })
    })
    return
  }
  if (msg && msg.ch === 'cmd' && typeof msg.text === 'string') {
    externalCommandBuffer += msg.text.endsWith('\n') ? msg.text : msg.text + '\n'
  }
}
