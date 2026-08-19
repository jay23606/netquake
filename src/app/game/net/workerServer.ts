// Main-thread manager for the server Worker (see docs/server-worker.md, P1).
// Spawns serverWorker.ts, sets up the game-transport MessageChannel, exposes the
// client-side worker-loop network driver (registered as the loopback driver in
// the client's net stack), and relays boot/console/command control messages.
//
// This is the client half of the split; the worker half is serverWorker.ts. P2
// wires this into single-player launch (replacing the in-process loop driver and
// forwarding the "map"/game args to the worker).
import { createWorkerLoopDriver, WorkerLoopRole } from './workerLoop'
import { wrapMessagePort } from './workerPort'
import INetworkDriver from '../../../engine/interfaces/net/INetworkDriver'

export type WorkerServerHandle = {
  driver: INetworkDriver          // register as the client loopback driver
  boot: (argv: string[]) => void  // start the worker's dedicated host with these args
  sendCommand: (text: string) => void // forward a console command to run server-side
  nextCmdDone: () => Promise<void> // resolves after the worker finishes the next forwarded command's frame
  ready: Promise<void>            // resolves when the worker's host has initialized
  terminate: () => void
  onConsole?: (text: string) => void // set by caller to surface worker console output
}

export const createWorkerServer = (): WorkerServerHandle => {
  // vite bundles this URL form into a separate module-worker chunk
  const worker = new Worker(new URL('../serverWorker.ts', import.meta.url), { type: 'module' })
  const channel = new MessageChannel()

  const driver = createWorkerLoopDriver(wrapMessagePort(channel.port1 as any), 'client' as WorkerLoopRole) as unknown as INetworkDriver

  let resolveReady: () => void = () => {}, rejectReady: (e: any) => void = () => {}
  let readySettled = false
  let readyTimer: any = 0
  const ready = new Promise<void>((res, rej) => { resolveReady = res; rejectReady = rej })
  // Settle `ready` once: resolve on the worker's 'ready', reject on a boot error, an onerror
  // (e.g. the module script fails to parse where module workers aren't supported), or a
  // timeout — so the caller can fall back to the main-thread server instead of awaiting
  // forever. Runtime errors after startup just log (this is a no-op once settled).
  const settleReady = (ok: boolean, err?: any) => {
    if (readySettled) return
    readySettled = true
    if (readyTimer) clearTimeout(readyTimer)
    if (ok) resolveReady(); else rejectReady(err || new Error('server worker failed to start'))
  }
  readyTimer = setTimeout(() => settleReady(false, new Error('server worker init timed out')), 10000)

  // one-shot waiters resolved on the next 'cmddone' from the worker
  let cmdDoneWaiters: Array<() => void> = []

  const handle: WorkerServerHandle = {
    driver,
    ready,
    boot: (argv: string[]) => {
      // transfer port2 (the worker's net end) into the worker
      worker.postMessage({ boot: argv, netPort: channel.port2 }, [channel.port2])
    },
    sendCommand: (text: string) => worker.postMessage({ ch: 'cmd', text }),
    nextCmdDone: () => new Promise<void>((res) => { cmdDoneWaiters.push(res) }),
    terminate: () => worker.terminate(),
  }

  worker.onmessage = (ev: MessageEvent) => {
    const msg = ev.data
    if (!msg) return
    switch (msg.ch) {
      case 'console': handle.onConsole?.(msg.text); break
      case 'ready': settleReady(true); break
      case 'cmddone': { const w = cmdDoneWaiters; cmdDoneWaiters = []; w.forEach((r) => r()); break }
      case 'error': handle.onConsole?.('[server-worker] ERROR: ' + msg.text + '\n'); settleReady(false, new Error(msg.text)); break
      case 'quit': break
    }
  }
  worker.onerror = (e: ErrorEvent) => { handle.onConsole?.('[server-worker] ' + e.message + '\n'); settleReady(false, new Error(e.message || 'server worker error')) }

  return handle
}
