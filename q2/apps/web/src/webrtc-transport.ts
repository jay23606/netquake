/**
 * File: webrtc-transport.ts
 * Purpose: Carry qcommon packets between browsers over WebRTC data channels.
 *
 * This file is not a source port. It is the peer-to-peer sibling of
 * local-transport.ts: same adapter shape around the qcommon `NET_*` hooks, but
 * the packets leave the tab instead of moving between two in-memory queues.
 *
 * Dependencies:
 * - packages/qcommon
 */

import {
  createNetAdr,
  createQcommonNetRuntime,
  netadrtype_t,
  netsrc_t,
  NET_CompareAdr,
  type NetPacket,
  type QcommonNetRuntime,
  type netadr_t
} from "../../../packages/qcommon/src/index.js";

export type WebRtcTransportRole = "host" | "client";

export interface WebRtcTransport {
  clientQnet: QcommonNetRuntime;
  serverQnet: QcommonNetRuntime;
  /** Attach a connected data channel for one remote peer (host side). */
  addPeer: (peerId: string, channel: RTCDataChannel) => void;
  removePeer: (peerId: string) => void;
  /** Attach the channel to the host (client side). */
  setHostChannel: (channel: RTCDataChannel) => void;
  readonly peerCount: number;
  clear: () => void;
}

export interface WebRtcTransportOptions {
  role: WebRtcTransportRole;
  now?: () => number;
  onPrint?: (message: string) => void;
}

// Remote peers need addresses the server can tell apart: sv_main tracks clients
// by netadr_t, so every peer gets a distinct synthetic NA_IP address. These are
// never put on a wire -- they are identity within this tab only.
const peerAddress = (index: number): netadr_t => {
  const adr = createNetAdr(netadrtype_t.NA_IP);
  adr.ip = new Uint8Array([10, 77, (index >> 8) & 0xff, index & 0xff]);
  adr.port = 27910 + index;
  return adr;
};

const clonePacket = (packet: NetPacket): NetPacket => ({
  from: {
    type: packet.from.type,
    ip: new Uint8Array(packet.from.ip),
    ipx: new Uint8Array(packet.from.ipx),
    port: packet.from.port
  },
  data: new Uint8Array(packet.data)
});

export function createWebRtcTransport(
  options: WebRtcTransportOptions
): WebRtcTransport {
  const { role } = options;

  // Host: the local client still talks to its own server through memory, so a
  // listen-server host pays no latency for its own play. Only remote peers go
  // over a channel.
  const loopClientToServer: NetPacket[] = [];
  const loopServerToClient: NetPacket[] = [];

  // Everything arriving from remote peers, already tagged with which peer sent
  // it. On the client this holds packets from the host.
  const inbound: NetPacket[] = [];

  const localClientAddress = createNetAdr();
  const localServerAddress = createNetAdr();
  const hostAddress = peerAddress(0);

  type Peer = { channel: RTCDataChannel; adr: netadr_t };
  const peers = new Map<string, Peer>();
  let nextPeerIndex = 1;

  const print = (message: string): void => options.onPrint?.(message);

  const attach = (channel: RTCDataChannel, from: netadr_t): void => {
    channel.binaryType = "arraybuffer";
    channel.addEventListener("message", (event: MessageEvent) => {
      const payload = event.data;
      if (!(payload instanceof ArrayBuffer)) return;
      inbound.push({ from, data: new Uint8Array(payload) });
    });
  };

  const sendOver = (channel: RTCDataChannel, data: Uint8Array): void => {
    if (channel.readyState !== "open") return;
    // Copy: the engine reuses its outgoing buffer between frames.
    channel.send(new Uint8Array(data).buffer as ArrayBuffer);
  };

  let hostChannel: RTCDataChannel | null = null;

  const findPeerByAdr = (to: netadr_t): Peer | null => {
    for (const peer of peers.values()) {
      if (NET_CompareAdr(peer.adr, to)) return peer;
    }
    return null;
  };

  const sendPacket = (sock: netsrc_t, data: Uint8Array, to: netadr_t): void => {
    if (role === "client") {
      // A joining player has no server of its own; everything goes to the host.
      if (sock !== netsrc_t.NS_CLIENT || !hostChannel) return;
      sendOver(hostChannel, data);
      return;
    }

    if (sock === netsrc_t.NS_CLIENT) {
      // The host's own client, still talking to its server through memory.
      loopClientToServer.push({
        from: clonePacket({ from: localClientAddress, data }).from,
        data: new Uint8Array(data)
      });
      return;
    }

    // Server side. Loopback destinations are the host's own client; anything
    // else is a remote peer identified by its synthetic address.
    if (to.type === netadrtype_t.NA_LOOPBACK || NET_CompareAdr(to, localClientAddress)) {
      loopServerToClient.push({
        from: clonePacket({ from: localServerAddress, data }).from,
        data: new Uint8Array(data)
      });
      return;
    }

    const peer = findPeerByAdr(to);
    if (peer) sendOver(peer.channel, data);
  };

  const getPacket = (sock: netsrc_t): NetPacket | null => {
    if (role === "client") {
      if (sock !== netsrc_t.NS_CLIENT) return null;
      const packet = inbound.shift();
      return packet ? clonePacket(packet) : null;
    }

    if (sock === netsrc_t.NS_CLIENT) {
      const packet = loopServerToClient.shift();
      return packet ? clonePacket(packet) : null;
    }

    // Server reads its own client first, then remote peers, so a listen-server
    // host never starves its own input behind a busy peer.
    const packet = loopClientToServer.shift() ?? inbound.shift();
    return packet ? clonePacket(packet) : null;
  };

  const hooks = {
    ...(options.now ? { now: options.now } : {}),
    ...(options.onPrint ? { onPrintf: options.onPrint } : {}),
    sendPacket,
    getPacket
  };

  const clientQnet = createQcommonNetRuntime(hooks);
  const serverQnet = createQcommonNetRuntime(hooks);

  return {
    clientQnet,
    serverQnet,
    addPeer: (peerId: string, channel: RTCDataChannel) => {
      if (peers.has(peerId)) return;
      const adr = peerAddress(nextPeerIndex++);
      attach(channel, adr);
      peers.set(peerId, { channel, adr });
      print(`webrtc: peer ${peerId} attached as ${adr.ip.join(".")}:${adr.port}\n`);
    },
    removePeer: (peerId: string) => {
      const peer = peers.get(peerId);
      if (!peer) return;
      try { peer.channel.close(); } catch { /* already gone */ }
      peers.delete(peerId);
      print(`webrtc: peer ${peerId} detached\n`);
    },
    setHostChannel: (channel: RTCDataChannel) => {
      hostChannel = channel;
      attach(channel, hostAddress);
      print("webrtc: attached to host\n");
    },
    get peerCount() {
      return peers.size;
    },
    clear: () => {
      loopClientToServer.length = 0;
      loopServerToClient.length = 0;
      inbound.length = 0;
    }
  };
}
