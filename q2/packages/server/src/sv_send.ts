/**
 * File: sv_send.ts
 * Source: Quake II original / server/sv_send.c
 * Purpose: Port of server-side message dispatch, multicast and per-client send routines.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses an explicit context object instead of file-static globals.
 * - Demo-file IO is abstracted through optional callbacks.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

import { SZ_Clear, SZ_Write, createSizeBuffer, type sizebuf_t } from "../../memory/src/index.js";
import {
  ATTN_NONE,
  CHAN_RELIABLE,
  CM_AreasConnected,
  CM_ClusterPHS,
  CM_ClusterPVS,
  CM_LeafArea,
  CM_LeafCluster,
  CM_PointLeafnum,
  DEFAULT_SOUND_PACKET_ATTENUATION,
  DEFAULT_SOUND_PACKET_VOLUME,
  MSG_WriteByte,
  MSG_WritePos,
  MSG_WriteShort,
  MSG_WriteString,
  Netchan_OutOfBandPrint,
  Netchan_Transmit,
  PRINT_HIGH,
  SND_ATTENUATION,
  SND_ENT,
  SND_OFFSET,
  SND_POS,
  SND_VOLUME,
  MAX_MSGLEN,
  netadrtype_t,
  netsrc_t,
  svc_ops_e,
  type CollisionWorld,
  type QcommonNetRuntime,
  type cvar_t,
  multicast_t,
  type netadr_t,
  type vec3_t
} from "../../qcommon/src/index.js";
import { CHAN_NO_PHS_ADD } from "../../qcommon/src/index.js";
import { SOLID_BSP, SVF_NOCLIENT, type edict_t, type game_export_t } from "../../game/src/index.js";
import {
  NUM_FOR_EDICT,
  RATE_MESSAGES,
  client_state_t,
  redirect_t,
  server_state_t,
  type ServerSendProcedures,
  type client_t,
  type server_static_t,
  type server_t
} from "./server.js";

/**
 * Original name: N/A
 * Source: N/A (server send context)
 * Category: New
 * Purpose: Hold the explicit runtime dependencies required by the `sv_send.c` port.
 *
 * Constraints:
 * - Must provide access to server state, qcommon net runtime and `sv_ents` write/build callbacks.
 */
export interface ServerSendContext {
  sv: server_t;
  svs: server_static_t;
  ge: game_export_t;
  collisionWorld: CollisionWorld;
  qnet: QcommonNetRuntime;
  maxclients: cvar_t | null;
  dedicated: cvar_t | null;
  sv_paused: cvar_t | null;
  sv_client: client_t | null;
  net_from: netadr_t;
  SV_BuildClientFrame: (client: client_t) => void;
  SV_WriteFrameToClient: (client: client_t, msg: sizebuf_t) => void;
  SV_DropClient: (client: client_t) => void;
  SV_Nextserver: () => void;
  SV_Error?: (error: string, ...args: unknown[]) => never;
  onPrintf?: (message: string) => void;
  nowMs?: () => number;
  readDemoMessage?: (demofile: unknown) => Uint8Array | null;
  closeDemoFile?: (demofile: unknown) => void;
}

/**
 * Original name: N/A
 * Source: N/A (server send procedure factory)
 * Category: New
 * Purpose: Build the `sv_send.c` procedure table bound to one explicit server-send context.
 *
 * Constraints:
 * - Must preserve call order and side effects from the original C implementation.
 */
export function createServerSendProcedures(context: ServerSendContext): ServerSendProcedures {
  function SV_Error(error: string, ...args: unknown[]): never {
    if (context.SV_Error) {
      return context.SV_Error(error, ...args);
    }

    throw new Error(formatPrintf(error, args));
  }

  /**
   * Original name: SV_FlushRedirect
   * Source: server/sv_send.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Flushes one redirected text buffer to packet or client reliable channel.
   */
  function SV_FlushRedirect(sv_redirected: number, outputbuf: string): void {
    if (sv_redirected === redirect_t.RD_PACKET) {
      Netchan_OutOfBandPrint(context.qnet, netsrc_t.NS_SERVER, context.net_from, `print\n${outputbuf}`);
      return;
    }

    if (sv_redirected === redirect_t.RD_CLIENT && context.sv_client) {
      MSG_WriteByte(context.sv_client.netchan.message, svc_ops_e.svc_print);
      MSG_WriteByte(context.sv_client.netchan.message, PRINT_HIGH);
      MSG_WriteString(context.sv_client.netchan.message, outputbuf);
    }
  }

  /**
   * Original name: SV_ClientPrintf
   * Source: server/sv_send.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Queues one print command to the target client when the level is high enough.
   */
  function SV_ClientPrintf(cl: client_t, level: number, fmt: string, ...args: unknown[]): void {
    if (level < cl.messagelevel) {
      return;
    }

    const text = formatPrintf(fmt, args);
    MSG_WriteByte(cl.netchan.message, svc_ops_e.svc_print);
    MSG_WriteByte(cl.netchan.message, level);
    MSG_WriteString(cl.netchan.message, text);
  }

  /**
   * Original name: SV_BroadcastPrintf
   * Source: server/sv_send.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Queues one print command to all spawned clients whose messagelevel accepts it.
   */
  function SV_BroadcastPrintf(level: number, fmt: string, ...args: unknown[]): void {
    const text = formatPrintf(fmt, args);

    if ((context.dedicated?.value ?? 0) !== 0) {
      context.onPrintf?.(stripHighBits(text));
    }

    const maxClients = Math.trunc(context.maxclients?.value ?? 0);
    for (let i = 0; i < maxClients; i += 1) {
      const cl = context.svs.clients[i];
      if (!cl) {
        continue;
      }
      if (level < cl.messagelevel) {
        continue;
      }
      if (cl.state !== client_state_t.cs_spawned) {
        continue;
      }

      MSG_WriteByte(cl.netchan.message, svc_ops_e.svc_print);
      MSG_WriteByte(cl.netchan.message, level);
      MSG_WriteString(cl.netchan.message, text);
    }
  }

  /**
   * Original name: SV_BroadcastCommand
   * Source: server/sv_send.c
   * Category: Ported
   * Fidelity level: Strict
   *
   * Behavior:
   * - Sends one reliable `svc_stufftext` command to all clients.
   */
  function SV_BroadcastCommand(fmt: string, ...args: unknown[]): void {
    if (context.sv.state === server_state_t.ss_dead) {
      return;
    }

    const text = formatPrintf(fmt, args);
    MSG_WriteByte(context.sv.multicast, svc_ops_e.svc_stufftext);
    MSG_WriteString(context.sv.multicast, text);
    SV_Multicast([0, 0, 0], multicast_t.MULTICAST_ALL_R);
  }

  /**
   * Original name: SV_Multicast
   * Source: server/sv_send.c
   * Category: Ported
   * Fidelity level: Strict
   *
   * Behavior:
   * - Sends `sv.multicast` contents to one destination subset and clears the multicast buffer.
   */
  function SV_Multicast(origin: vec3_t | null, to: multicast_t): void {
    let mask: Uint8Array | null = null;
    let reliable = false;
    let area1 = 0;

    if (to !== multicast_t.MULTICAST_ALL_R && to !== multicast_t.MULTICAST_ALL) {
      if (!origin) {
        SV_Error("SV_Multicast: origin is null for PHS/PVS mode");
      }
      const leafnum = CM_PointLeafnum(context.collisionWorld, origin);
      area1 = CM_LeafArea(context.collisionWorld, leafnum);
    }

    if (context.svs.demofile) {
      SZ_Write(context.svs.demo_multicast, context.sv.multicast.data.subarray(0, context.sv.multicast.cursize));
    }

    switch (to) {
      case multicast_t.MULTICAST_ALL_R:
        reliable = true;
      case multicast_t.MULTICAST_ALL:
        mask = null;
        break;
      case multicast_t.MULTICAST_PHS_R: {
        reliable = true;
      }
      case multicast_t.MULTICAST_PHS: {
        if (!origin) {
          SV_Error("SV_Multicast: origin is null for MULTICAST_PHS");
        }
        const leafnum = CM_PointLeafnum(context.collisionWorld, origin);
        const cluster = CM_LeafCluster(context.collisionWorld, leafnum);
        mask = CM_ClusterPHS(context.collisionWorld, cluster);
        break;
      }
      case multicast_t.MULTICAST_PVS_R: {
        reliable = true;
      }
      case multicast_t.MULTICAST_PVS: {
        if (!origin) {
          SV_Error("SV_Multicast: origin is null for MULTICAST_PVS");
        }
        const leafnum = CM_PointLeafnum(context.collisionWorld, origin);
        const cluster = CM_LeafCluster(context.collisionWorld, leafnum);
        mask = CM_ClusterPVS(context.collisionWorld, cluster);
        break;
      }
      default:
        SV_Error("SV_Multicast: bad to:%i", to);
    }

    const maxClients = Math.trunc(context.maxclients?.value ?? 0);
    for (let i = 0; i < maxClients; i += 1) {
      const client = context.svs.clients[i];
      if (!client) {
        continue;
      }

      if (client.state === client_state_t.cs_free || client.state === client_state_t.cs_zombie) {
        continue;
      }
      if (client.state !== client_state_t.cs_spawned && !reliable) {
        continue;
      }

      if (mask) {
        const clientOrigin = client.edict?.s.origin;
        if (!clientOrigin) {
          continue;
        }

        const leafnum = CM_PointLeafnum(context.collisionWorld, clientOrigin);
        const cluster = CM_LeafCluster(context.collisionWorld, leafnum);
        const area2 = CM_LeafArea(context.collisionWorld, leafnum);

        if (!CM_AreasConnected(context.collisionWorld, area1, area2)) {
          continue;
        }
        if ((mask[cluster >> 3] & (1 << (cluster & 7))) === 0) {
          continue;
        }
      }

      const payload = context.sv.multicast.data.subarray(0, context.sv.multicast.cursize);
      if (reliable) {
        SZ_Write(client.netchan.message, payload);
      } else {
        SZ_Write(client.datagram, payload);
      }
    }

    SZ_Clear(context.sv.multicast);
  }

  /**
   * Original name: SV_StartSound
   * Source: server/sv_send.c
   * Category: Ported
   * Fidelity level: Strict
   *
   * Behavior:
   * - Queues one positional/server sound event through `sv.multicast`.
   */
  function SV_StartSound(
    origin: vec3_t | null,
    entity: edict_t | null,
    channel: number,
    soundindex: number,
    volume: number,
    attenuation: number,
    timeofs: number
  ): void {
    if (volume < 0 || volume > 1.0) {
      SV_Error("SV_StartSound: volume = %f", volume);
    }
    if (attenuation < 0 || attenuation > 4) {
      SV_Error("SV_StartSound: attenuation = %f", attenuation);
    }
    if (timeofs < 0 || timeofs > 0.255) {
      SV_Error("SV_StartSound: timeofs = %f", timeofs);
    }
    if (!entity) {
      SV_Error("SV_StartSound: entity is null");
    }

    const ent = NUM_FOR_EDICT(context.ge, entity);
    if (ent < 0) {
      SV_Error("SV_StartSound: entity not found in game exports");
    }
    let use_phs = true;

    if ((channel & CHAN_NO_PHS_ADD) !== 0) {
      use_phs = false;
      channel &= 7;
    }

    const sendchan = (ent << 3) | (channel & 7);
    let flags = 0;
    if (volume !== DEFAULT_SOUND_PACKET_VOLUME) {
      flags |= SND_VOLUME;
    }
    if (attenuation !== DEFAULT_SOUND_PACKET_ATTENUATION) {
      flags |= SND_ATTENUATION;
    }
    if ((entity.svflags & SVF_NOCLIENT) !== 0 || entity.solid === SOLID_BSP || origin !== null) {
      flags |= SND_POS;
    }
    flags |= SND_ENT;
    if (timeofs !== 0) {
      flags |= SND_OFFSET;
    }

    const origin_v: vec3_t = [0, 0, 0];
    let sendOrigin: vec3_t;
    if (origin === null) {
      sendOrigin = origin_v;
      if (entity.solid === SOLID_BSP) {
        origin_v[0] = entity.s.origin[0] + 0.5 * (entity.mins[0] + entity.maxs[0]);
        origin_v[1] = entity.s.origin[1] + 0.5 * (entity.mins[1] + entity.maxs[1]);
        origin_v[2] = entity.s.origin[2] + 0.5 * (entity.mins[2] + entity.maxs[2]);
      } else {
        origin_v[0] = entity.s.origin[0];
        origin_v[1] = entity.s.origin[1];
        origin_v[2] = entity.s.origin[2];
      }
    } else {
      sendOrigin = origin;
    }

    MSG_WriteByte(context.sv.multicast, svc_ops_e.svc_sound);
    MSG_WriteByte(context.sv.multicast, flags);
    MSG_WriteByte(context.sv.multicast, soundindex);

    if ((flags & SND_VOLUME) !== 0) {
      MSG_WriteByte(context.sv.multicast, Math.trunc(volume * 255));
    }
    if ((flags & SND_ATTENUATION) !== 0) {
      MSG_WriteByte(context.sv.multicast, Math.trunc(attenuation * 64));
    }
    if ((flags & SND_OFFSET) !== 0) {
      MSG_WriteByte(context.sv.multicast, Math.trunc(timeofs * 1000));
    }
    if ((flags & SND_ENT) !== 0) {
      MSG_WriteShort(context.sv.multicast, sendchan);
    }
    if ((flags & SND_POS) !== 0) {
      MSG_WritePos(context.sv.multicast, sendOrigin);
    }

    if (attenuation === ATTN_NONE) {
      use_phs = false;
    }

    if ((channel & CHAN_RELIABLE) !== 0) {
      SV_Multicast(sendOrigin, use_phs ? multicast_t.MULTICAST_PHS_R : multicast_t.MULTICAST_ALL_R);
    } else {
      SV_Multicast(sendOrigin, use_phs ? multicast_t.MULTICAST_PHS : multicast_t.MULTICAST_ALL);
    }
  }

  /**
   * Original name: SV_DemoCompleted
   * Source: server/sv_send.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Closes the active server demo and advances to next server command.
   */
  function SV_DemoCompleted(): void {
    if (context.sv.demofile) {
      context.closeDemoFile?.(context.sv.demofile);
      context.sv.demofile = null;
    }
    context.SV_Nextserver();
  }

  /**
   * Original name: SV_SendClientMessages
   * Source: server/sv_send.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Sends one outgoing packet (or reliable-only pulse) to each active server client.
   */
  function SV_SendClientMessages(): void {
    let demoMsg: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

    if (context.sv.state === server_state_t.ss_demo && context.sv.demofile) {
      if ((context.sv_paused?.value ?? 0) === 0) {
        if (!context.readDemoMessage) {
          SV_DemoCompleted();
          return;
        }

        const next = context.readDemoMessage(context.sv.demofile);
        if (!next) {
          SV_DemoCompleted();
          return;
        }
        if (next.length > MAX_MSGLEN) {
          SV_Error("SV_SendClientMessages: msglen > MAX_MSGLEN (%i)", next.length);
        }
        demoMsg = next;
      }
    }

    const maxClients = Math.trunc(context.maxclients?.value ?? 0);
    for (let i = 0; i < maxClients; i += 1) {
      const c = context.svs.clients[i];
      if (!c || c.state === client_state_t.cs_free) {
        continue;
      }

      if (c.netchan.message.overflowed) {
        SZ_Clear(c.netchan.message);
        SZ_Clear(c.datagram);
        SV_BroadcastPrintf(PRINT_HIGH, "%s overflowed\n", c.name);
        context.SV_DropClient(c);
      }

      if (
        context.sv.state === server_state_t.ss_cinematic ||
        context.sv.state === server_state_t.ss_demo ||
        context.sv.state === server_state_t.ss_pic
      ) {
        const demoPayload = new Uint8Array(demoMsg);
        Netchan_Transmit(context.qnet, c.netchan, demoPayload.length, demoPayload);
        continue;
      }

      if (c.state === client_state_t.cs_spawned) {
        if (SV_RateDrop(c)) {
          continue;
        }
        SV_SendClientDatagram(c);
        continue;
      }

      const now = context.nowMs?.() ?? Date.now();
      if (c.netchan.message.cursize !== 0 || now - c.netchan.last_sent > 1000) {
        Netchan_Transmit(context.qnet, c.netchan, 0, new Uint8Array(0));
      }
    }
  }

  /**
   * Original name: SV_SendClientDatagram
   * Source: server/sv_send.c
   * Category: Ported
   * Fidelity level: Strict
   *
   * Behavior:
   * - Builds and transmits one game datagram for a spawned client.
   *
   * Porting notes:
   * - Keeps multicast datagram append after `SV_WriteFrameToClient`, matching the original entity-reference ordering.
   */
  function SV_SendClientDatagram(client: client_t): boolean {
    context.SV_BuildClientFrame(client);

    const msgBuffer = new Uint8Array(MAX_MSGLEN);
    const msg = createSizeBuffer(msgBuffer, true);

    context.SV_WriteFrameToClient(client, msg);

    if (client.datagram.overflowed) {
      context.onPrintf?.(`WARNING: datagram overflowed for ${client.name}\n`);
    } else {
      SZ_Write(msg, client.datagram.data.subarray(0, client.datagram.cursize));
    }
    SZ_Clear(client.datagram);

    if (msg.overflowed) {
      context.onPrintf?.(`WARNING: msg overflowed for ${client.name}\n`);
      SZ_Clear(msg);
    }

    Netchan_Transmit(context.qnet, client.netchan, msg.cursize, msg.data);
    client.message_size[context.sv.framenum % RATE_MESSAGES] = msg.cursize;
    return true;
  }

  /**
   * Original name: SV_RateDrop
   * Source: server/sv_send.c
   * Category: Ported
   * Fidelity level: Strict
   *
   * Behavior:
   * - Returns true when recent packet sizes exceed the client's rate limit.
   */
  function SV_RateDrop(c: client_t): boolean {
    if (c.netchan.remote_address.type === netadrtype_t.NA_LOOPBACK) {
      return false;
    }

    let total = 0;
    for (let i = 0; i < RATE_MESSAGES; i += 1) {
      total += c.message_size[i] ?? 0;
    }

    if (total > c.rate) {
      c.surpressCount += 1;
      c.message_size[context.sv.framenum % RATE_MESSAGES] = 0;
      return true;
    }

    return false;
  }

  return {
    SV_FlushRedirect,
    SV_DemoCompleted,
    SV_SendClientMessages,
    SV_Multicast,
    SV_StartSound,
    SV_ClientPrintf,
    SV_BroadcastPrintf,
    SV_BroadcastCommand
  };
}

/**
 * Original name: N/A
 * Source: N/A (local printf formatter)
 * Category: New
 * Purpose: Format the small printf subset used by the server send procedures.
 */
function formatPrintf(fmt: string, args: unknown[]): string {
  if (args.length === 0) {
    return fmt;
  }

  let argIndex = 0;
  return fmt.replace(/%(%|s|d|i|f)/g, (_, spec: string) => {
    if (spec === "%") {
      return "%";
    }

    const value = args[argIndex];
    argIndex += 1;
    if (spec === "f") {
      return Number(value ?? 0).toString();
    }
    if (spec === "d" || spec === "i") {
      return Math.trunc(Number(value ?? 0)).toString();
    }

    return String(value ?? "");
  });
}

/**
 * Original name: N/A
 * Source: N/A (local console string helper)
 * Category: New
 * Purpose: Mirror the high-bit masking used before echoing dedicated-server broadcasts.
 */
function stripHighBits(text: string): string {
  let out = "";
  const limit = Math.min(text.length, 1023);
  for (let i = 0; i < limit; i += 1) {
    out += String.fromCharCode(text.charCodeAt(i) & 127);
  }
  return out;
}
