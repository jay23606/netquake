// Worker-loop network driver: the byte transport between the client (main thread)
// and the server (worker thread) for single-player. It is the split-across-threads
// equivalent of the in-process loop driver (loop.ts) and preserves that driver's
// exact queue framing ([type][len0][len1][len2] + payload) and reliable-message
// flow control, so the engine's net.ts / getMessage / sendMessage paths are
// unchanged. Bytes and the connect/ack handshake cross via a Port (workerPort.ts),
// which is a synchronous in-process pair in P0 and a real Worker MessagePort in P1.
//
// Each side owns exactly ONE ISocket (its local end). loop.ts could write straight
// into the peer socket's receiveMessage queue because both sockets lived in one
// heap; here the peer is on another thread, so a send posts the framed bytes and
// the peer's onmessage appends them into its own local socket's queue. The one
// piece loop got from shared refs — re-enabling the sender's canSend once the
// receiver consumes a reliable message — becomes an explicit 'ack' control message.
import * as def from '../../../engine/def'
import * as net from '../../../engine/net'
import * as sz from '../../../engine/sz'
import ISocket from '../../../engine/interfaces/net/ISocket'
import IDatagram from '../../../engine/interfaces/net/IDatagram'
import { QConnectStatus } from '../../../engine/interfaces/net/INetworkDriver'
import { Port } from './workerPort'

export type WorkerLoopRole = 'client' | 'server'

// Append one framed datagram (already carrying the loop [type][len:3] header we
// build on send) into sock's receive queue — the mirror of loop.sendMessage's
// write into the peer's receiveMessage, but driven by an inbound Port message.
const enqueue = (sock: ISocket, type: number, payload: Uint8Array) => {
  const at = sock.receiveMessageLength
  sock.receiveMessageLength += payload.length + 4
  if (sock.receiveMessageLength > def.max_message)
    throw new Error('WorkerLoop: receive overflow')
  const q = sock.receiveMessage as Uint8Array
  q[at] = type
  q[at + 1] = payload.length & 0xff
  q[at + 2] = (payload.length >> 8) & 0xff
  q[at + 3] = (payload.length >> 16) & 0xff
  q.set(payload, at + 4)
}

export const createWorkerLoopDriver = (port: Port, role: WorkerLoopRole) => {
  let sock: ISocket | null = null
  let connectPending = false // server: a 'connect' arrived, checkNewConnections should accept

  const makeSocket = (address: string): ISocket => {
    const s = net.newQSocket()
    s.receiveMessage = new Uint8Array(new ArrayBuffer(def.max_message))
    s.receiveMessageLength = 0
    s.canSend = true
    s.address = address
    return s
  }

  port.onmessage = (msg) => {
    switch (msg.k) {
      case 'connect':
        // server side: peer wants to connect. Create our end now so data that
        // follows (ordered) has a queue to land in; checkNewConnections accepts it.
        if (role === 'server' && sock == null) {
          sock = makeSocket('LOCAL')
          connectPending = true
          port.post({ k: 'accept' })
        }
        break
      case 'accept':
        break // client already holds its socket from connect(); nothing to do
      case 'data': {
        if (sock == null) break
        const framed = new Uint8Array(msg.buf as ArrayBuffer)
        // 'data' carries a single frame: [type][len:3][payload]
        const type = framed[0]
        const len = framed[1] + (framed[2] << 8) + (framed[3] << 16)
        enqueue(sock, type, framed.subarray(4, 4 + len))
        break
      }
      case 'ack':
        // peer consumed our reliable message: we may send the next one
        if (sock != null) sock.canSend = true
        break
      case 'close':
        if (sock != null) { sock.disconnected = true; sock.canSend = false }
        break
    }
  }

  const frameAndPost = (data: IDatagram, type: number) => {
    const payload = sz.u8(data).subarray(0, data.cursize)
    const framed = new Uint8Array(data.cursize + 4)
    framed[0] = type
    framed[1] = data.cursize & 0xff
    framed[2] = (data.cursize >> 8) & 0xff
    framed[3] = (data.cursize >> 16) & 0xff
    framed.set(payload, 4)
    port.post({ k: 'data', buf: framed.buffer }, [framed.buffer])
  }

  const driver = {
    initialized: false,
    available: true,
    name: 'workerloop',

    init: () => { driver.initialized = true; return true },
    listen: () => {},
    registerWithMaster: () => {},
    supportedAddress: (addr: string) => addr === 'local',

    // client side only: establish the local connection
    connect: async (host: string): Promise<QConnectStatus | ISocket> => {
      if (role !== 'client' || host !== 'local') return 'failed'
      if (sock == null) sock = makeSocket('localhost')
      sock.receiveMessageLength = 0
      sock.canSend = true
      // stamp the driver index net is currently dispatching (this driver's slot);
      // the socket may have been created earlier in onmessage when driverlevel
      // pointed elsewhere, and net.getMessage/sendMessage use sock.driver.
      sock.driver = net.state.driverlevel
      port.post({ k: 'connect' })
      return sock
    },

    // server side only: hand the accepted socket to the engine once per connect
    checkNewConnections: (): ISocket | undefined => {
      if (role !== 'server' || !connectPending) return undefined
      connectPending = false
      ;(sock as ISocket).driver = net.state.driverlevel
      return sock as ISocket
    },

    checkForResend: () => 1,

    getMessage: (s: ISocket) => {
      if (s.receiveMessageLength === 0) return 0
      const q = s.receiveMessage as Uint8Array
      const ret = q[0]
      const length = q[1] + (q[2] << 8) + (q[3] << 16)
      if (length > net.state.message.data.byteLength)
        throw new Error('WorkerLoop.getMessage: overflow')
      net.state.message.cursize = length
      sz.u8(net.state.message).set(q.subarray(4, length + 4))
      s.receiveMessageLength -= length + 4
      if (s.receiveMessageLength > 0)
        q.copyWithin(0, length + 4, length + 4 + s.receiveMessageLength)
      // consumed a reliable message: tell the peer it may send its next one
      if (ret === 1) port.post({ k: 'ack' })
      return ret
    },

    sendMessage: (s: ISocket, data: IDatagram) => {
      frameAndPost(data, 1)
      s.canSend = false
      return 1
    },

    sendUnreliableMessage: (s: ISocket, data: IDatagram) => {
      frameAndPost(data, 2)
      return 1
    },

    canSendMessage: (s: ISocket) => s.canSend,

    close: (s: ISocket) => {
      port.post({ k: 'close' })
      s.receiveMessageLength = 0
      s.canSend = false
      sock = null
    },
  }
  return driver
}
