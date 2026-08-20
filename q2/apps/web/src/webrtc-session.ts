/**
 * File: webrtc-session.ts
 * Purpose: Establish the peer connections that carry Quake 2 packets, using the
 * same Supabase signaling the Quake 1 client uses.
 *
 * This file is not a source port. Signaling only brokers the connection: once a
 * data channel is open, packets go peer to peer and Supabase sees none of them.
 */

import { SupabaseBroker } from "@nq/engine/webrtc/SupabaseBroker";
import { getSupabase, iceServers, supabaseConfigured } from "@nq/shared/supabase/client";
import type { WebRtcTransport } from "./webrtc-transport.js";

export interface WebRtcSessionParams {
  roomId: string;
  playerId: string;
  isHost: boolean;
  /** Map the host loads; ignored on the joining side, which is told by the server. */
  map: string;
  maxClients: number;
  /** Lobby name, so the player is the same person in both games. */
  name: string;
}

export interface WebRtcSession {
  close: () => void;
}

/**
 * Read the session out of the URL. The lobby navigates here with these, so a
 * plain visit to /q2/ stays single player and never touches Supabase.
 */
export function readSessionParams(
  search: string = window.location.search
): WebRtcSessionParams | null {
  const q = new URLSearchParams(search);
  const roomId = q.get("room");
  const playerId = q.get("player");
  if (!roomId || !playerId) return null;
  return {
    roomId,
    playerId,
    isHost: q.get("host") === "1",
    map: q.get("map") ?? "demo1",
    maxClients: Number(q.get("max") ?? "8"),
    name: q.get("name") ?? "player"
  };
}

// Quake's own netchan handles ordering and retransmission, so the channel must
// not: an ordered, reliable channel would head-of-line block and add exactly the
// latency the protocol is built to avoid.
const CHANNEL_CONFIG: RTCDataChannelInit = {
  ordered: false,
  maxRetransmits: 0
};

// Matches peerAddress(0) in the transport: the client side ignores the target
// and always writes to the host channel, but the engine still needs a parseable
// address to begin a connection.
const HOST_ADDRESS = "10.77.0.0:27910";

const log = (message: string): void => console.log("[q2-webrtc]", message);

export async function startWebRtcSession(
  params: WebRtcSessionParams,
  transport: WebRtcTransport,
  runCommand: (text: string) => void
): Promise<WebRtcSession> {
  if (!supabaseConfigured()) {
    throw new Error("Supabase is not configured; multiplayer is unavailable.");
  }

  const broker = new SupabaseBroker(params.roomId, params.playerId, params.isHost);
  const connections = new Map<string, RTCPeerConnection>();
  // Candidates can arrive before the description they belong to; adding one
  // early throws, so they wait here until there is a remote description.
  const pending = new Map<string, RTCIceCandidate[]>();

  const newConnection = (peerId: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    connections.set(peerId, pc);

    pc.addEventListener("icecandidate", (event) => {
      if (event.candidate) broker.sendCandidate(peerId, event.candidate);
    });
    pc.addEventListener("connectionstatechange", () => {
      log(`peer ${peerId}: ${pc.connectionState}`);
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        transport.removePeer(peerId);
      }
    });
    return pc;
  };

  const drainCandidates = async (peerId: string, pc: RTCPeerConnection): Promise<void> => {
    const queued = pending.get(peerId);
    if (!queued) return;
    pending.delete(peerId);
    for (const candidate of queued) {
      try { await pc.addIceCandidate(candidate); } catch { /* stale candidate */ }
    }
  };

  broker.on("newPeer", ({ clientId }) => {
    void (async () => {
      if (params.isHost) {
        // A player announced themselves. Wait for their offer; their channel
        // arrives through ondatachannel.
        const pc = newConnection(clientId);
        pc.addEventListener("datachannel", (event) => {
          log(`data channel open from ${clientId}`);
          transport.addPeer(clientId, event.channel);
        });
        return;
      }

      // Joining: the client opens the channel and offers, mirroring the Quake 1
      // flow so one broker serves both games unchanged.
      const pc = newConnection(clientId);
      const channel = pc.createDataChannel("quake2", CHANNEL_CONFIG);
      channel.addEventListener("open", () => {
        log("data channel to host open");
        transport.setHostChannel(channel);
        // Nothing happens until the engine is told to connect; before the
        // channel is open the packets would go nowhere.
        log("issuing: connect " + HOST_ADDRESS);
        runCommand("connect " + HOST_ADDRESS + "\n");
      });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      broker.sendOffer(clientId, pc.localDescription as RTCSessionDescription);
    })();
  });

  broker.on("offer", ({ clientId, offerOrAnswer }) => {
    void (async () => {
      const pc = connections.get(clientId);
      if (!pc) return;
      await pc.setRemoteDescription(offerOrAnswer);
      await drainCandidates(clientId, pc);
      if (!params.isHost) return; // that was our answer; nothing to send back
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      broker.sendOffer(clientId, pc.localDescription as RTCSessionDescription);
    })();
  });

  broker.on("candidate", ({ clientId, candidate }) => {
    void (async () => {
      const pc = connections.get(clientId);
      if (!pc || !candidate) return;
      if (!pc.remoteDescription) {
        const queued = pending.get(clientId) ?? [];
        queued.push(candidate);
        pending.set(clientId, queued);
        return;
      }
      try { await pc.addIceCandidate(candidate); } catch { /* stale candidate */ }
    })();
  });

  broker.on("peerLost", ({ clientId }) => {
    const pc = connections.get(clientId);
    // Presence can flap while a peer is perfectly healthy -- observed live, a
    // leave arriving between two working handshakes. Tearing down a live peer
    // connection on that signal drops a player mid-match, so a peer whose
    // connection is up is left alone; connectionstatechange handles real loss.
    if (pc && (pc.connectionState === "connected" || pc.connectionState === "connecting")) {
      log(`ignoring presence leave for ${clientId}: connection is ${pc.connectionState}`);
      return;
    }
    transport.removePeer(clientId);
    pc?.close();
    connections.delete(clientId);
  });


  // Leaving the game -- back button, tab close, navigating away -- must remove
  // this player from the room, or the room lingers with phantom occupants. The
  // lobby does this for its own page; the game is a separate document and needs
  // its own. A keepalive fetch is used because promises do not get to finish
  // during unload.
  const { data: { session } } = await getSupabase().auth.getSession();
  const token = session?.access_token ?? null;
  const onUnload = (): void => {
    if (!token) return;
    const base = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
    void fetch(
      `${base}/rest/v1/nq_room_players?room_id=eq.${params.roomId}`
        + `&player_id=eq.${params.playerId}`,
      {
        method: "DELETE",
        keepalive: true,
        headers: { apikey: key, Authorization: `Bearer ${token}` }
      }
    ).catch(() => { /* best effort */ });
  };
  window.addEventListener("beforeunload", onUnload);
  await broker.connect();
  broker.sendReady("0");
  log(`signaling up as ${params.isHost ? "host" : "client"} in room ${params.roomId}`);

  return {
    close: () => {
      window.removeEventListener("beforeunload", onUnload);
      for (const pc of connections.values()) pc.close();
      connections.clear();
      broker.close();
    }
  };
}
