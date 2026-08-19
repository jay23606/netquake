// Transport abstraction for the server-on-worker loopback (see docs/server-worker.md).
//
// A Port is the thin byte/control channel between the client half (main thread)
// and the server half (worker thread). The worker-loop network driver
// (workerLoop.ts) is written against this interface so the same driver code runs
// P0 (synchronous in-process pair, for verifying framing without a worker) and
// P1 (a real Worker MessagePort), with no driver changes.
//
// Messages are small tagged envelopes rather than raw ArrayBuffers so the driver
// can multiplex data with the connection/flow-control handshake that loop.ts gets
// "for free" from shared socket references:
//   connect  client -> server : request a local connection
//   accept   server -> client : connection established
//   data     either           : one framed datagram ([type][len:3]+payload) in buf
//   ack      either           : peer consumed a reliable message; re-enable canSend
//   close    either           : tear down
export type PortMsgKind = 'connect' | 'accept' | 'data' | 'ack' | 'close'

export type PortMsg = {
  k: PortMsgKind
  // present for 'data'; the framed datagram bytes. Transferred where possible.
  buf?: ArrayBuffer
}

export interface Port {
  post: (msg: PortMsg, transfer?: Transferable[]) => void
  // Set by the driver; invoked for each message arriving from the peer.
  onmessage: ((msg: PortMsg) => void) | null
}

// P0: a synchronous in-process pair of Ports wired directly to each other, so the
// worker-loop driver can be exercised end-to-end (framing, handshake, flow
// control) on one thread before the Worker exists. Delivery is deferred to a
// microtask so a handler that posts back doesn't re-enter synchronously (matching
// the real MessagePort's async, ordered delivery).
export const createSyncPortPair = (): [Port, Port] => {
  const a: Port = { post: null as any, onmessage: null }
  const b: Port = { post: null as any, onmessage: null }
  const deliver = (to: Port, msg: PortMsg) => {
    Promise.resolve().then(() => { if (to.onmessage) to.onmessage(msg) })
  }
  a.post = (msg) => deliver(b, msg)
  b.post = (msg) => deliver(a, msg)
  return [a, b]
}

// P1: wrap a real Worker MessagePort (or the Worker/DedicatedWorkerGlobalScope
// message channel) as a Port. Kept here so workerLoop.ts never imports Worker
// APIs directly.
export const wrapMessagePort = (mp: {
  postMessage: (msg: any, transfer?: Transferable[]) => void
  onmessage: ((ev: { data: any }) => void) | null
}): Port => {
  const port: Port = {
    post: (msg, transfer) => mp.postMessage(msg, transfer || []),
    onmessage: null,
  }
  mp.onmessage = (ev) => { if (port.onmessage) port.onmessage(ev.data as PortMsg) }
  return port
}
