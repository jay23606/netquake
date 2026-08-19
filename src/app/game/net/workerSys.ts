// ISys implementation for the server Worker (see docs/server-worker.md, P1).
// The engine's platform layer is injected via sys.init(argv, impl); this is the
// worker-thread impl — the analogue of app/game/sys.ts (browser) and
// server/game/sys.ts (node), but for a DedicatedWorkerGlobalScope: no DOM, no
// process/fs. Console output and external commands cross to the main thread over
// the worker's default message channel; the game network transport is a separate
// MessageChannel (workerLoop), set up by serverWorker.ts.
import { ISys } from '../../../engine/interfaces/ISys'
import IAssetStore from '../../../engine/interfaces/store/IAssetStore'
import INetworkDriver from '../../../engine/interfaces/net/INetworkDriver'
import * as com from '../../../engine/com'
import * as host from '../../../engine/host'
import * as q from '../../../engine/q'

// worker global (DedicatedWorkerGlobalScope) — typed loosely to avoid pulling in
// the WebWorker lib in the app tsconfig
declare const self: { postMessage: (m: any) => void }

export type WorkerSysDeps = {
  assetStore: IAssetStore
  netDrivers: INetworkDriver[]
  // pending external commands forwarded from the main thread (e.g. "map x")
  externalCommands: () => string
  // called after host.init resolves so the orchestrator can start the tick loop
  onInitialized: () => void
}

export const createWorkerSys = (deps: WorkerSysDeps): ISys => {
  const t0 = (globalThis as any).performance ? (globalThis as any).performance.now() : Date.now()
  const now = () => ((globalThis as any).performance ? (globalThis as any).performance.now() : Date.now())

  const impl: ISys = {
    assetStore: deps.assetStore,
    print: (text: string) => { self.postMessage({ ch: 'console', text }) },
    error: (text: string) => { self.postMessage({ ch: 'console', text: 'ERROR: ' + text + '\n' }); throw new Error(text) },
    quit: () => { self.postMessage({ ch: 'quit' }) },
    floatTime: () => (now() - t0) / 1000.0,
    getExternalCommand: () => deps.externalCommands(),
    requestPak: () => Promise.resolve(),
    init: async (argv: string) => {
      // q.atoi/atof route NaN checks through q.state.isNaN, which the platform
      // sys layer must install (the browser/node sys.init do this). Without it
      // q.isNaN returns undefined and atoi's terminator never fires -> infinite
      // loop the first time the server parses a numeric client command (e.g.
      // "color 2 11" during signon). Match app/game/sys.ts.
      q.state.isNaN = (Number.isNaN != null) ? Number.isNaN : isNaN
      // argv already tokenized into com by the orchestrator (com.initArgv) before
      // sys.init; host.init boots the dedicated host (server only, no renderer).
      await host.init(true, deps.assetStore, deps.netDrivers)
      deps.onInitialized()
    },
  }
  return impl
}

// re-export for the orchestrator
export { com, host }
