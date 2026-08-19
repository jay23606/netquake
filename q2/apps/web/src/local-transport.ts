/**
 * File: local-transport.ts
 * Purpose: Provide the in-memory loopback packet transport used by the browser web-app host.
 *
 * This file is not a direct source port.
 * It is a web adapter for the qcommon `NET_*` hooks.
 *
 * Dependencies:
 * - packages/qcommon
 */

import {
  createNetAdr,
  createQcommonNetRuntime,
  netsrc_t,
  type NetPacket,
  type QcommonNetRuntime,
  type netadr_t
} from "../../../packages/qcommon/src/index.js";

/**
 * Original name: N/A
 * Source: N/A (web transport adapter)
 * Category: New
 * Purpose: Expose the paired client/server qcommon network runtimes used by the browser-local host.
 *
 * Porting notes:
 * - No direct C/H owner: this is an apps/web adapter around the ported qcommon `NET_*` hooks.
 */
export interface WebAppLocalTransport {
  clientQnet: QcommonNetRuntime;
  serverQnet: QcommonNetRuntime;
  readonly queuedClientToServer: number;
  readonly queuedServerToClient: number;
  clear: () => void;
}

/**
 * Original name: N/A
 * Source: N/A (web transport adapter)
 * Category: New
 * Purpose: Configure the browser-local transport without coupling it to game, client or server payloads.
 *
 * Porting notes:
 * - No direct C/H owner: the callbacks feed explicit qcommon runtime hooks.
 */
export interface WebAppLocalTransportOptions {
  now?: () => number;
  onPrint?: (message: string) => void;
}

/**
 * Original name: N/A
 * Source: N/A (web transport adapter)
 * Category: New
 * Purpose: Create paired qcommon runtimes whose packets are delivered through deterministic in-memory queues.
 *
 * Porting notes:
 * - No direct C/H owner: this is the apps/web host-side transport for qcommon `NET_SendPacket`/`NET_GetPacket`.
 *
 * Constraints:
 * - Must remain an adapter around `QcommonNetRuntime`; it must not interpret game, client or server payloads.
 */
export function createWebAppLocalTransport(
  options: WebAppLocalTransportOptions = {}
): WebAppLocalTransport {
  const clientToServer: NetPacket[] = [];
  const serverToClient: NetPacket[] = [];
  const clientAddress = createNetAdr();
  const serverAddress = createNetAdr();

  const sendPacket = (sock: netsrc_t, data: Uint8Array, _to: netadr_t): void => {
    const packet = {
      from: cloneAddress(sock === netsrc_t.NS_CLIENT ? clientAddress : serverAddress),
      data: new Uint8Array(data)
    };

    if (sock === netsrc_t.NS_CLIENT) {
      clientToServer.push(packet);
    } else {
      serverToClient.push(packet);
    }
  };

  const getPacket = (sock: netsrc_t): NetPacket | null => {
    const packet = sock === netsrc_t.NS_CLIENT
      ? serverToClient.shift()
      : clientToServer.shift();
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
    get queuedClientToServer() {
      return clientToServer.length;
    },
    get queuedServerToClient() {
      return serverToClient.length;
    },
    clear: () => {
      clientToServer.length = 0;
      serverToClient.length = 0;
    }
  };
}

/**
 * Original name: N/A
 * Source: N/A (local transport helper)
 * Category: New
 * Purpose: Return a defensive copy of one queued packet before handing it to a qcommon runtime.
 *
 * Constraints:
 * - Must clone both the source address and payload bytes; queued packets must not share mutable buffers.
 */
function clonePacket(packet: NetPacket): NetPacket {
  return {
    from: cloneAddress(packet.from),
    data: new Uint8Array(packet.data)
  };
}

/**
 * Original name: N/A
 * Source: N/A (local transport helper)
 * Category: New
 * Purpose: Copy one browser-local packet address without depending on qcommon internals.
 *
 * Constraints:
 * - Must preserve `netadr_t` value semantics by duplicating the `ip` and `ipx` byte arrays.
 */
function cloneAddress(address: netadr_t): netadr_t {
  return {
    type: address.type,
    ip: new Uint8Array(address.ip),
    ipx: new Uint8Array(address.ipx),
    port: address.port
  };
}
