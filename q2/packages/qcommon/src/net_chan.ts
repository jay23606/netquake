/**
 * File: net_chan.ts
 * Source: Quake II original / qcommon/net_chan.c
 * Purpose: Port the Quake II network-channel sequencing, reliable delivery and out-of-band packet helpers.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Reads `showpackets`, `showdrop` and `qport` from cvars when `Netchan_Init` receives a cvar runtime.
 * - Uses injectable transport hooks instead of the native socket layer.
 *
 * Notes:
 * - This file is intended to stay close to the original `qcommon/net_chan.c`.
 */

import type { qboolean } from "./q_shared.js";
import type { sizebuf_t } from "../../memory/src/index.js";
import { createSizeBuffer, SZ_Init, SZ_Write } from "../../memory/src/index.js";
import { CVAR_NOSET, Cvar_Get, type CvarRuntime } from "./cvar.js";
import { MSG_BeginReading, MSG_ReadLong, MSG_ReadShort, MSG_WriteLong, MSG_WriteShort } from "./messages.js";
import {
  MAX_MSGLEN,
  NET_AdrToString,
  NET_SendPacket,
  createNetchan,
  type QcommonNetRuntime,
  type netadr_t,
  type netchan_t,
  netsrc_t
} from "./qcommon.js";

/**
 * Original name: Netchan_Init
 * Source: qcommon/net_chan.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes the runtime qport used by client packets.
 * - Registers the original `showpackets`, `showdrop` and `qport` cvars when cvar runtime is supplied.
 *
 * Porting notes:
 * - Retains runtime booleans as an adapter fallback for harnesses that do not wire cvars yet.
 */
export function Netchan_Init(runtime: QcommonNetRuntime, cvarRuntime?: CvarRuntime): void {
  const port = (runtime.hooks.now?.() ?? Date.now()) & 0xffff;
  runtime.qport = port;

  if (cvarRuntime) {
    runtime.showpacketsCvar = Cvar_Get(cvarRuntime, "showpackets", "0", 0);
    runtime.showdropCvar = Cvar_Get(cvarRuntime, "showdrop", "0", 0);
    runtime.qportCvar = Cvar_Get(cvarRuntime, "qport", `${port}`, CVAR_NOSET);
    runtime.showpackets = (runtime.showpacketsCvar?.value ?? 0) !== 0;
    runtime.showdrop = (runtime.showdropCvar?.value ?? 0) !== 0;
    runtime.qport = runtime.qportCvar?.value ?? port;
  }
}

/**
 * Original name: Netchan_Setup
 * Source: qcommon/net_chan.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Opens one channel to a remote endpoint and clears its reliable state.
 */
export function Netchan_Setup(
  runtime: QcommonNetRuntime,
  sock: netsrc_t,
  chan: netchan_t,
  adr: netadr_t,
  qport: number
): void {
  const reset = createNetchan(sock);
  Object.assign(chan, reset);

  chan.sock = sock;
  chan.remote_address = cloneNetAdr(adr);
  chan.qport = qport;
  chan.last_received = runtime.hooks.now?.() ?? Date.now();
  chan.incoming_sequence = 0;
  chan.outgoing_sequence = 1;

  SZ_Init(chan.message, chan.message_buf);
  chan.message.allowoverflow = true;
}

/**
 * Original name: Netchan_CanReliable
 * Source: qcommon/net_chan.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns true when the previous reliable payload has been acknowledged.
 */
export function Netchan_CanReliable(chan: netchan_t): qboolean {
  return chan.reliable_length === 0;
}

/**
 * Original name: Netchan_NeedReliable
 * Source: qcommon/net_chan.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns true when a reliable payload should be sent or retransmitted.
 */
export function Netchan_NeedReliable(chan: netchan_t): qboolean {
  let send_reliable = false;

  if (
    chan.incoming_acknowledged > chan.last_reliable_sequence &&
    chan.incoming_reliable_acknowledged !== chan.reliable_sequence
  ) {
    send_reliable = true;
  }

  if (chan.reliable_length === 0 && chan.message.cursize !== 0) {
    send_reliable = true;
  }

  return send_reliable;
}

/**
 * Original name: Netchan_OutOfBand
 * Source: qcommon/net_chan.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Sends one out-of-band datagram prefixed with sequence `-1`.
 */
export function Netchan_OutOfBand(
  runtime: QcommonNetRuntime,
  net_socket: netsrc_t,
  adr: netadr_t,
  length: number,
  data: Uint8Array
): void {
  const send_buf = new Uint8Array(MAX_MSGLEN);
  const send = createSizeBuffer(send_buf);

  MSG_WriteLong(send, -1);
  SZ_Write(send, data.subarray(0, length));

  NET_SendPacket(runtime, net_socket, send.cursize, send.data, adr);
}

/**
 * Original name: Netchan_OutOfBandPrint
 * Source: qcommon/net_chan.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Sends one text out-of-band datagram.
 */
export function Netchan_OutOfBandPrint(
  runtime: QcommonNetRuntime,
  net_socket: netsrc_t,
  adr: netadr_t,
  message: string
): void {
  const encoded = encodeAscii(message);
  Netchan_OutOfBand(runtime, net_socket, adr, encoded.length, encoded);
}

/**
 * Original name: Netchan_Transmit
 * Source: qcommon/net_chan.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Sends one packet while handling reliable sequencing and retransmission state.
 */
export function Netchan_Transmit(
  runtime: QcommonNetRuntime,
  chan: netchan_t,
  length: number,
  data: Uint8Array
): void {
  if (chan.message.overflowed) {
    chan.fatal_error = true;
    runtime.hooks.onPrintf?.(`${NET_AdrToString(chan.remote_address)}:Outgoing message overflow\n`);
    return;
  }

  const send_reliable = Netchan_NeedReliable(chan);

  if (chan.reliable_length === 0 && chan.message.cursize !== 0) {
    chan.reliable_buf.set(chan.message_buf.subarray(0, chan.message.cursize), 0);
    chan.reliable_length = chan.message.cursize;
    chan.message.cursize = 0;
    chan.reliable_sequence ^= 1;
  }

  const send_buf = new Uint8Array(MAX_MSGLEN);
  const send = createSizeBuffer(send_buf);
  const w1 = (chan.outgoing_sequence & ~(1 << 31)) | (Number(send_reliable) << 31);
  const w2 = (chan.incoming_sequence & ~(1 << 31)) | (chan.incoming_reliable_sequence << 31);

  chan.outgoing_sequence += 1;
  chan.last_sent = runtime.hooks.now?.() ?? Date.now();

  MSG_WriteLong(send, w1);
  MSG_WriteLong(send, w2);

  if (chan.sock === netsrc_t.NS_CLIENT) {
    MSG_WriteShort(send, getRuntimeQport(runtime));
  }

  if (send_reliable) {
    SZ_Write(send, chan.reliable_buf.subarray(0, chan.reliable_length));
    chan.last_reliable_sequence = chan.outgoing_sequence;
  }

  if (send.maxsize - send.cursize >= length) {
    SZ_Write(send, data.subarray(0, length));
  } else {
    runtime.hooks.onPrintf?.("Netchan_Transmit: dumped unreliable\n");
  }

  NET_SendPacket(runtime, chan.sock, send.cursize, send.data, chan.remote_address);

  if (getShowPackets(runtime)) {
    runtime.hooks.onPrintf?.(
      send_reliable
        ? `send ${padPacketSize(send.cursize)} : s=${chan.outgoing_sequence - 1} reliable=${chan.reliable_sequence} ack=${chan.incoming_sequence} rack=${chan.incoming_reliable_sequence}\n`
        : `send ${padPacketSize(send.cursize)} : s=${chan.outgoing_sequence - 1} ack=${chan.incoming_sequence} rack=${chan.incoming_reliable_sequence}\n`
    );
  }
}

/**
 * Original name: Netchan_Process
 * Source: qcommon/net_chan.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Processes one received packet header and updates reliable sequencing state.
 */
export function Netchan_Process(runtime: QcommonNetRuntime, chan: netchan_t, msg: sizebuf_t): qboolean {
  MSG_BeginReading(msg);
  let sequence = MSG_ReadLong(msg) >>> 0;
  let sequence_ack = MSG_ReadLong(msg) >>> 0;

  if (chan.sock === netsrc_t.NS_SERVER) {
    MSG_ReadShort(msg);
  }

  const reliable_message = sequence >>> 31;
  const reliable_ack = sequence_ack >>> 31;

  sequence &= ~(1 << 31);
  sequence_ack &= ~(1 << 31);

  if (getShowPackets(runtime)) {
    runtime.hooks.onPrintf?.(
      reliable_message
        ? `recv ${padPacketSize(msg.cursize)} : s=${sequence} reliable=${chan.incoming_reliable_sequence ^ 1} ack=${sequence_ack} rack=${reliable_ack}\n`
        : `recv ${padPacketSize(msg.cursize)} : s=${sequence} ack=${sequence_ack} rack=${reliable_ack}\n`
    );
  }

  if (sequence <= chan.incoming_sequence) {
    if (getShowDrop(runtime)) {
      runtime.hooks.onPrintf?.(
        `${NET_AdrToString(chan.remote_address)}:Out of order packet ${sequence} at ${chan.incoming_sequence}\n`
      );
    }
    return false;
  }

  chan.dropped = sequence - (chan.incoming_sequence + 1);
  if (chan.dropped > 0 && getShowDrop(runtime)) {
    runtime.hooks.onPrintf?.(
      `${NET_AdrToString(chan.remote_address)}:Dropped ${chan.dropped} packets at ${sequence}\n`
    );
  }

  if (reliable_ack === chan.reliable_sequence) {
    chan.reliable_length = 0;
  }

  chan.incoming_sequence = sequence;
  chan.incoming_acknowledged = sequence_ack;
  chan.incoming_reliable_acknowledged = reliable_ack;
  if (reliable_message) {
    chan.incoming_reliable_sequence ^= 1;
  }

  chan.last_received = runtime.hooks.now?.() ?? Date.now();
  return true;
}

/**
 * Original name: N/A
 * Source: N/A (local address-copy helper)
 * Category: New
 * Purpose: Clone one `netadr_t` value so channel setup preserves address bytes by value.
 */
function cloneNetAdr(address: netadr_t): netadr_t {
  return {
    type: address.type,
    ip: new Uint8Array(address.ip),
    ipx: new Uint8Array(address.ipx),
    port: address.port
  };
}

/**
 * Original name: N/A
 * Source: N/A (local text encoding helper)
 * Category: New
 * Purpose: Encode one text payload into the 8-bit byte stream used by out-of-band prints.
 */
function encodeAscii(value: string): Uint8Array {
  const encoded = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    encoded[index] = value.charCodeAt(index) & 0xff;
  }
  return encoded;
}

/**
 * Original name: N/A
 * Source: N/A (local formatting helper)
 * Category: New
 * Purpose: Match the original `%4i` packet-size formatting used by `showpackets`.
 */
function padPacketSize(size: number): string {
  return String(size).padStart(4, " ");
}

/**
 * Original name: N/A
 * Source: N/A (local cvar/runtime adapter)
 * Category: New
 * Purpose: Read `showpackets` through the original cvar pointer when it is wired.
 */
function getShowPackets(runtime: QcommonNetRuntime): qboolean {
  return runtime.showpacketsCvar ? runtime.showpacketsCvar.value !== 0 : runtime.showpackets;
}

/**
 * Original name: N/A
 * Source: N/A (local cvar/runtime adapter)
 * Category: New
 * Purpose: Read `showdrop` through the original cvar pointer when it is wired.
 */
function getShowDrop(runtime: QcommonNetRuntime): qboolean {
  return runtime.showdropCvar ? runtime.showdropCvar.value !== 0 : runtime.showdrop;
}

/**
 * Original name: N/A
 * Source: N/A (local cvar/runtime adapter)
 * Category: New
 * Purpose: Read `qport` through the original no-set cvar when it is wired.
 */
function getRuntimeQport(runtime: QcommonNetRuntime): number {
  const qport = runtime.qportCvar ? runtime.qportCvar.value : runtime.qport;
  runtime.qport = qport;
  return qport;
}
