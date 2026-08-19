/**
 * File: sv_ents.ts
 * Source: Quake II original / server/sv_ents.c
 * Purpose: Port of server-side frame/entity network encoding routines.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses an explicit context object instead of file-static globals.
 * - Demo-file writes are routed through an optional context callback (`writeDemoMessage`) instead of direct `fwrite`.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

import { SZ_Clear, SZ_Write, createSizeBuffer, type sizebuf_t } from "../../memory/src/index.js";
import {
  CM_AreasConnected,
  CM_BoxLeafnums,
  CM_ClusterPHS,
  CM_ClusterPVS,
  CM_HeadnodeVisible,
  CM_LeafArea,
  CM_LeafCluster,
  CM_NumClusters,
  CM_PointLeafnum,
  CM_WriteAreaBits,
  MAX_STATS,
  MSG_WriteAngle16,
  MSG_WriteByte,
  MSG_WriteChar,
  MSG_WriteDeltaEntity,
  MSG_WriteLong,
  MSG_WriteShort,
  PS_BLEND,
  PS_FOV,
  PS_KICKANGLES,
  PS_M_DELTA_ANGLES,
  PS_M_FLAGS,
  PS_M_GRAVITY,
  PS_M_ORIGIN,
  PS_M_TIME,
  PS_M_TYPE,
  PS_M_VELOCITY,
  PS_RDFLAGS,
  PS_VIEWANGLES,
  PS_VIEWOFFSET,
  PS_WEAPONFRAME,
  PS_WEAPONINDEX,
  U_MOREBITS1,
  U_NUMBER16,
  U_REMOVE,
  UPDATE_BACKUP,
  UPDATE_MASK,
  VectorLength,
  VectorSubtract,
  createEntityState,
  createPlayerState,
  svc_ops_e,
  type CollisionWorld,
  type cvar_t,
  type entity_state_t,
  type vec3_t
} from "../../qcommon/src/index.js";
import { RF_BEAM } from "../../qcommon/src/index.js";
import { SVF_NOCLIENT, type edict_t, type game_export_t } from "../../game/src/index.js";
import type {
  ServerEntityProcedures,
  client_frame_t,
  client_t,
  server_static_t,
  server_t
} from "./server.js";

/**
 * Original name: N/A
 * Source: N/A (server entity procedure context)
 * Category: New
 * Purpose: Hold the explicit runtime dependencies required by the `sv_ents.c` port.
 *
 * Constraints:
 * - Must provide access to `sv`, `svs`, `ge`, collision visibility queries and `maxclients`.
 */
export interface ServerEntityContext {
  sv: server_t;
  svs: server_static_t;
  ge: game_export_t;
  collisionWorld: CollisionWorld;
  maxclients: cvar_t | null;
  SV_Error?: (error: string, ...args: unknown[]) => never;
  writeDemoMessage?: (demofile: unknown, payload: Uint8Array) => void;
}

/**
 * Original name: N/A
 * Source: N/A (zero player state helper)
 * Category: New
 */
const DUMMY_PLAYER_STATE = createPlayerState();

/**
 * Original name: N/A
 * Source: N/A (zero entity state helper)
 * Category: New
 */
const NULL_ENTITY_STATE = createEntityState();

/**
 * Original name: N/A
 * Source: N/A (packet entity sentinel)
 * Category: New
 */
const UNSET_ENTITY_NUM = 9999;

/**
 * Original name: N/A
 * Source: N/A (derived fatpvs byte count)
 * Category: New
 */
const FATPVS_LEAF_BYTES = 65536 / 8;

/**
 * Original name: fatpvs
 * Source: server/sv_ents.c
 * Category: Ported
 * Fidelity level: Strict
 */
const fatpvs = new Uint8Array(FATPVS_LEAF_BYTES);

/**
 * Original name: N/A
 * Source: N/A (server entity procedure factory)
 * Category: New
 * Purpose: Build the `sv_ents.c` procedure table bound to one explicit server entity context.
 *
 * Constraints:
 * - Must preserve call order and side effects from the original C implementation.
 */
export function createServerEntityProcedures(context: ServerEntityContext): ServerEntityProcedures {
  function SV_Error(error: string, ...args: unknown[]): never {
    if (context.SV_Error) {
      return context.SV_Error(error, ...args);
    }

    throw new Error(formatServerError(error, args));
  }

  /**
   * Original name: SV_EmitPacketEntities
   * Source: server/sv_ents.c
   * Category: Ported
   * Fidelity level: Strict
   *
   * Behavior:
   * - Writes a delta update of one `entity_state_t` list to the outgoing message.
   */
  function SV_EmitPacketEntities(from: client_frame_t | null, to: client_frame_t, msg: sizebuf_t): void {
    MSG_WriteByte(msg, svc_ops_e.svc_packetentities);

    const fromNumEntities = from ? from.num_entities : 0;
    const maxclientsValue = getMaxclientsValue(context.maxclients);

    let newindex = 0;
    let oldindex = 0;

    while (newindex < to.num_entities || oldindex < fromNumEntities) {
      const newent = newindex < to.num_entities
        ? getClientEntityState(context.svs, to.first_entity, newindex)
        : null;
      const oldent = oldindex < fromNumEntities && from
        ? getClientEntityState(context.svs, from.first_entity, oldindex)
        : null;

      const newnum = newent ? newent.number : UNSET_ENTITY_NUM;
      const oldnum = oldent ? oldent.number : UNSET_ENTITY_NUM;

      if (newnum === oldnum && newent && oldent) {
        MSG_WriteDeltaEntity(oldent, newent, msg, false, newent.number <= maxclientsValue);
        oldindex += 1;
        newindex += 1;
        continue;
      }

      if (newnum < oldnum && newent) {
        MSG_WriteDeltaEntity(context.sv.baselines[newnum]!, newent, msg, true, true);
        newindex += 1;
        continue;
      }

      if (oldnum < newnum) {
        let bits = U_REMOVE;
        if (oldnum >= 256) {
          bits |= U_NUMBER16 | U_MOREBITS1;
        }

        MSG_WriteByte(msg, bits & 255);
        if ((bits & 0x0000ff00) !== 0) {
          MSG_WriteByte(msg, (bits >> 8) & 255);
        }

        if ((bits & U_NUMBER16) !== 0) {
          MSG_WriteShort(msg, oldnum);
        } else {
          MSG_WriteByte(msg, oldnum);
        }

        oldindex += 1;
        continue;
      }
    }

    MSG_WriteShort(msg, 0);
  }

  /**
   * Original name: SV_WritePlayerstateToClient
   * Source: server/sv_ents.c
   * Category: Ported
   * Fidelity level: Strict
   *
   * Behavior:
   * - Delta-encodes one player state against a previous frame.
   */
  function SV_WritePlayerstateToClient(from: client_frame_t | null, to: client_frame_t, msg: sizebuf_t): void {
    const ps = to.ps;
    const ops = from ? from.ps : DUMMY_PLAYER_STATE;

    let pflags = 0;

    if (ps.pmove.pm_type !== ops.pmove.pm_type) {
      pflags |= PS_M_TYPE;
    }

    if (
      ps.pmove.origin[0] !== ops.pmove.origin[0] ||
      ps.pmove.origin[1] !== ops.pmove.origin[1] ||
      ps.pmove.origin[2] !== ops.pmove.origin[2]
    ) {
      pflags |= PS_M_ORIGIN;
    }

    if (
      ps.pmove.velocity[0] !== ops.pmove.velocity[0] ||
      ps.pmove.velocity[1] !== ops.pmove.velocity[1] ||
      ps.pmove.velocity[2] !== ops.pmove.velocity[2]
    ) {
      pflags |= PS_M_VELOCITY;
    }

    if (ps.pmove.pm_time !== ops.pmove.pm_time) {
      pflags |= PS_M_TIME;
    }

    if (ps.pmove.pm_flags !== ops.pmove.pm_flags) {
      pflags |= PS_M_FLAGS;
    }

    if (ps.pmove.gravity !== ops.pmove.gravity) {
      pflags |= PS_M_GRAVITY;
    }

    if (
      ps.pmove.delta_angles[0] !== ops.pmove.delta_angles[0] ||
      ps.pmove.delta_angles[1] !== ops.pmove.delta_angles[1] ||
      ps.pmove.delta_angles[2] !== ops.pmove.delta_angles[2]
    ) {
      pflags |= PS_M_DELTA_ANGLES;
    }

    if (
      ps.viewoffset[0] !== ops.viewoffset[0] ||
      ps.viewoffset[1] !== ops.viewoffset[1] ||
      ps.viewoffset[2] !== ops.viewoffset[2]
    ) {
      pflags |= PS_VIEWOFFSET;
    }

    if (
      ps.viewangles[0] !== ops.viewangles[0] ||
      ps.viewangles[1] !== ops.viewangles[1] ||
      ps.viewangles[2] !== ops.viewangles[2]
    ) {
      pflags |= PS_VIEWANGLES;
    }

    if (
      ps.kick_angles[0] !== ops.kick_angles[0] ||
      ps.kick_angles[1] !== ops.kick_angles[1] ||
      ps.kick_angles[2] !== ops.kick_angles[2]
    ) {
      pflags |= PS_KICKANGLES;
    }

    if (
      ps.blend[0] !== ops.blend[0] ||
      ps.blend[1] !== ops.blend[1] ||
      ps.blend[2] !== ops.blend[2] ||
      ps.blend[3] !== ops.blend[3]
    ) {
      pflags |= PS_BLEND;
    }

    if (ps.fov !== ops.fov) {
      pflags |= PS_FOV;
    }

    if (ps.rdflags !== ops.rdflags) {
      pflags |= PS_RDFLAGS;
    }

    if (ps.gunframe !== ops.gunframe) {
      pflags |= PS_WEAPONFRAME;
    }

    pflags |= PS_WEAPONINDEX;

    MSG_WriteByte(msg, svc_ops_e.svc_playerinfo);
    MSG_WriteShort(msg, pflags);

    if ((pflags & PS_M_TYPE) !== 0) {
      MSG_WriteByte(msg, ps.pmove.pm_type);
    }

    if ((pflags & PS_M_ORIGIN) !== 0) {
      MSG_WriteShort(msg, ps.pmove.origin[0]);
      MSG_WriteShort(msg, ps.pmove.origin[1]);
      MSG_WriteShort(msg, ps.pmove.origin[2]);
    }

    if ((pflags & PS_M_VELOCITY) !== 0) {
      MSG_WriteShort(msg, ps.pmove.velocity[0]);
      MSG_WriteShort(msg, ps.pmove.velocity[1]);
      MSG_WriteShort(msg, ps.pmove.velocity[2]);
    }

    if ((pflags & PS_M_TIME) !== 0) {
      MSG_WriteByte(msg, ps.pmove.pm_time);
    }

    if ((pflags & PS_M_FLAGS) !== 0) {
      MSG_WriteByte(msg, ps.pmove.pm_flags);
    }

    if ((pflags & PS_M_GRAVITY) !== 0) {
      MSG_WriteShort(msg, ps.pmove.gravity);
    }

    if ((pflags & PS_M_DELTA_ANGLES) !== 0) {
      MSG_WriteShort(msg, ps.pmove.delta_angles[0]);
      MSG_WriteShort(msg, ps.pmove.delta_angles[1]);
      MSG_WriteShort(msg, ps.pmove.delta_angles[2]);
    }

    if ((pflags & PS_VIEWOFFSET) !== 0) {
      MSG_WriteChar(msg, Math.trunc(ps.viewoffset[0] * 4));
      MSG_WriteChar(msg, Math.trunc(ps.viewoffset[1] * 4));
      MSG_WriteChar(msg, Math.trunc(ps.viewoffset[2] * 4));
    }

    if ((pflags & PS_VIEWANGLES) !== 0) {
      MSG_WriteAngle16(msg, ps.viewangles[0]);
      MSG_WriteAngle16(msg, ps.viewangles[1]);
      MSG_WriteAngle16(msg, ps.viewangles[2]);
    }

    if ((pflags & PS_KICKANGLES) !== 0) {
      MSG_WriteChar(msg, Math.trunc(ps.kick_angles[0] * 4));
      MSG_WriteChar(msg, Math.trunc(ps.kick_angles[1] * 4));
      MSG_WriteChar(msg, Math.trunc(ps.kick_angles[2] * 4));
    }

    if ((pflags & PS_WEAPONINDEX) !== 0) {
      MSG_WriteByte(msg, ps.gunindex);
    }

    if ((pflags & PS_WEAPONFRAME) !== 0) {
      MSG_WriteByte(msg, ps.gunframe);
      MSG_WriteChar(msg, Math.trunc(ps.gunoffset[0] * 4));
      MSG_WriteChar(msg, Math.trunc(ps.gunoffset[1] * 4));
      MSG_WriteChar(msg, Math.trunc(ps.gunoffset[2] * 4));
      MSG_WriteChar(msg, Math.trunc(ps.gunangles[0] * 4));
      MSG_WriteChar(msg, Math.trunc(ps.gunangles[1] * 4));
      MSG_WriteChar(msg, Math.trunc(ps.gunangles[2] * 4));
    }

    if ((pflags & PS_BLEND) !== 0) {
      MSG_WriteByte(msg, Math.trunc(ps.blend[0] * 255));
      MSG_WriteByte(msg, Math.trunc(ps.blend[1] * 255));
      MSG_WriteByte(msg, Math.trunc(ps.blend[2] * 255));
      MSG_WriteByte(msg, Math.trunc(ps.blend[3] * 255));
    }

    if ((pflags & PS_FOV) !== 0) {
      MSG_WriteByte(msg, ps.fov);
    }
    if ((pflags & PS_RDFLAGS) !== 0) {
      MSG_WriteByte(msg, ps.rdflags);
    }

    let statbits = 0;
    for (let i = 0; i < MAX_STATS; i += 1) {
      if (ps.stats[i] !== ops.stats[i]) {
        statbits |= (1 << i);
      }
    }

    MSG_WriteLong(msg, statbits);
    for (let i = 0; i < MAX_STATS; i += 1) {
      if ((statbits & (1 << i)) !== 0) {
        MSG_WriteShort(msg, ps.stats[i] ?? 0);
      }
    }
  }

  /**
   * Original name: SV_WriteFrameToClient
   * Source: server/sv_ents.c
   * Category: Ported
   * Fidelity level: Strict
   *
   * Behavior:
   * - Writes one server frame message for the specified client.
   */
  function SV_WriteFrameToClient(client: client_t, msg: sizebuf_t): void {
    const frame = client.frames[context.sv.framenum & UPDATE_MASK];
    if (!frame) {
      SV_Error("SV_WriteFrameToClient: missing frame at index %i", context.sv.framenum & UPDATE_MASK);
    }

    let oldframe: client_frame_t | null = null;
    let lastframe = -1;

    if (client.lastframe > 0) {
      if (context.sv.framenum - client.lastframe < (UPDATE_BACKUP - 3)) {
        oldframe = client.frames[client.lastframe & UPDATE_MASK] ?? null;
        lastframe = client.lastframe;
      }
    }

    MSG_WriteByte(msg, svc_ops_e.svc_frame);
    MSG_WriteLong(msg, context.sv.framenum);
    MSG_WriteLong(msg, lastframe);
    MSG_WriteByte(msg, client.surpressCount);
    client.surpressCount = 0;

    MSG_WriteByte(msg, frame.areabytes);
    SZ_Write(msg, frame.areabits.subarray(0, frame.areabytes));

    SV_WritePlayerstateToClient(oldframe, frame, msg);
    SV_EmitPacketEntities(oldframe, frame, msg);
  }

  /**
   * Original name: SV_RecordDemoMessage
   * Source: server/sv_ents.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Saves a non-delta entity frame and accumulated demo multicast bytes.
   *
   * Porting notes:
   * - Binary file output is routed through `writeDemoMessage` so browser and test hosts can supply storage.
   */
  function SV_RecordDemoMessage(): void {
    if (!context.svs.demofile) {
      return;
    }

    const buf = createSizeBuffer(32768);

    MSG_WriteByte(buf, svc_ops_e.svc_frame);
    MSG_WriteLong(buf, context.sv.framenum);

    MSG_WriteByte(buf, svc_ops_e.svc_packetentities);

    for (let e = 1; e < context.ge.num_edicts; e += 1) {
      const ent = context.ge.edicts[e];
      if (!ent) {
        continue;
      }

      if (
        ent.inuse &&
        ent.s.number &&
        (ent.s.modelindex || ent.s.effects || ent.s.sound || ent.s.event) &&
        (ent.svflags & SVF_NOCLIENT) === 0
      ) {
        MSG_WriteDeltaEntity(NULL_ENTITY_STATE, ent.s, buf, false, true);
      }
    }

    MSG_WriteShort(buf, 0);

    SZ_Write(buf, context.svs.demo_multicast.data.subarray(0, context.svs.demo_multicast.cursize));
    SZ_Clear(context.svs.demo_multicast);

    const payload = new Uint8Array(4 + buf.cursize);
    const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    view.setInt32(0, buf.cursize, true);
    payload.set(buf.data.subarray(0, buf.cursize), 4);

    if (!context.writeDemoMessage) {
      SV_Error("SV_RecordDemoMessage: writeDemoMessage callback is missing");
    }

    context.writeDemoMessage(context.svs.demofile, payload);
  }

  /**
   * Original name: SV_BuildClientFrame
   * Source: server/sv_ents.c
   * Category: Ported
   * Fidelity level: Strict
   *
   * Behavior:
   * - Selects visible entities for one client frame and copies playerstate plus areabits.
   */
  function SV_BuildClientFrame(client: client_t): void {
    const clent = client.edict;
    if (!clent?.client) {
      return;
    }

    const frame = client.frames[context.sv.framenum & UPDATE_MASK];
    if (!frame) {
      SV_Error("SV_BuildClientFrame: missing frame at index %i", context.sv.framenum & UPDATE_MASK);
    }

    frame.senttime = context.svs.realtime;

    const org: vec3_t = [
      clent.client.ps.pmove.origin[0] * 0.125 + clent.client.ps.viewoffset[0],
      clent.client.ps.pmove.origin[1] * 0.125 + clent.client.ps.viewoffset[1],
      clent.client.ps.pmove.origin[2] * 0.125 + clent.client.ps.viewoffset[2]
    ];

    const leafnum = CM_PointLeafnum(context.collisionWorld, org);
    const clientarea = CM_LeafArea(context.collisionWorld, leafnum);
    const clientcluster = CM_LeafCluster(context.collisionWorld, leafnum);

    frame.areabytes = CM_WriteAreaBits(context.collisionWorld, frame.areabits, clientarea);
    frame.ps = clonePlayerState(clent.client.ps);

    SV_FatPVS(context, org);
    const clientphs = CM_ClusterPHS(context.collisionWorld, clientcluster);

    frame.num_entities = 0;
    frame.first_entity = context.svs.next_client_entities;

    let c_fullsend = 0;

    for (let e = 1; e < context.ge.num_edicts; e += 1) {
      const ent = context.ge.edicts[e];
      if (!ent) {
        continue;
      }

      if ((ent.svflags & SVF_NOCLIENT) !== 0) {
        continue;
      }

      if (!ent.s.modelindex && !ent.s.effects && !ent.s.sound && !ent.s.event) {
        continue;
      }

      if (ent !== clent) {
        if (!CM_AreasConnected(context.collisionWorld, clientarea, ent.areanum)) {
          if (!ent.areanum2 || !CM_AreasConnected(context.collisionWorld, clientarea, ent.areanum2)) {
            continue;
          }
        }

        if ((ent.s.renderfx & RF_BEAM) !== 0) {
          const l = ent.clusternums[0];
          if ((clientphs[l >> 3] & (1 << (l & 7))) === 0) {
            continue;
          }
        } else {
          const bitvector = fatpvs;

          if (ent.num_clusters === -1) {
            if (!CM_HeadnodeVisible(context.collisionWorld, ent.headnode, bitvector)) {
              continue;
            }
            c_fullsend += 1;
          } else {
            let i = 0;
            for (; i < ent.num_clusters; i += 1) {
              const l = ent.clusternums[i];
              if ((bitvector[l >> 3] & (1 << (l & 7))) !== 0) {
                break;
              }
            }

            if (i === ent.num_clusters) {
              continue;
            }
          }

          if (!ent.s.modelindex) {
            const delta: vec3_t = [0, 0, 0];
            VectorSubtract(org, ent.s.origin, delta);
            const len = VectorLength(delta);
            if (len > 400) {
              continue;
            }
          }
        }
      }

      const state = getWritableClientEntityState(context.svs);
      if (ent.s.number !== e) {
        ent.s.number = e;
      }

      copyEntityState(state, ent.s);

      if (ent.owner === client.edict) {
        state.solid = 0;
      }

      context.svs.next_client_entities += 1;
      frame.num_entities += 1;
    }

    void c_fullsend;
  }

  return {
    SV_WriteFrameToClient,
    SV_RecordDemoMessage,
    SV_BuildClientFrame,
    SV_Error
  };
}

/**
 * Original name: N/A
 * Source: N/A (client entity ring accessor)
 * Category: New
 */
function getClientEntityState(svs: server_static_t, firstEntity: number, index: number) {
  if (svs.num_client_entities <= 0) {
    throw new Error("SV_EmitPacketEntities: svs.num_client_entities <= 0");
  }

  const ringIndex = (firstEntity + index) % svs.num_client_entities;
  const entity = svs.client_entities[ringIndex];
  if (!entity) {
    throw new Error(`SV_EmitPacketEntities: missing client entity at ring index ${ringIndex}`);
  }

  return entity;
}

/**
 * Original name: N/A
 * Source: N/A (client entity ring writer)
 * Category: New
 */
function getWritableClientEntityState(svs: server_static_t): entity_state_t {
  if (svs.num_client_entities <= 0) {
    throw new Error("SV_BuildClientFrame: svs.num_client_entities <= 0");
  }

  const ringIndex = svs.next_client_entities % svs.num_client_entities;
  const entity = svs.client_entities[ringIndex];
  if (!entity) {
    throw new Error(`SV_BuildClientFrame: missing writable client entity at ring index ${ringIndex}`);
  }

  return entity;
}

/**
 * Original name: N/A
 * Source: N/A (cvar value adapter)
 * Category: New
 */
function getMaxclientsValue(maxclients: cvar_t | null): number {
  if (!maxclients) {
    return 0;
  }

  return Math.trunc(maxclients.value);
}

/**
 * Original name: SV_FatPVS
 * Source: server/sv_ents.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Builds the expanded PVS bitvector around the client view origin for snapshot visibility.
 *
 * Porting notes:
 * - The original file-static collision calls are provided by the explicit server entity context.
 */
function SV_FatPVS(context: ServerEntityContext, org: vec3_t): void {
  const leafs: number[] = [];
  const mins: vec3_t = [org[0] - 8, org[1] - 8, org[2] - 8];
  const maxs: vec3_t = [org[0] + 8, org[1] + 8, org[2] + 8];

  const { count } = CM_BoxLeafnums(context.collisionWorld, mins, maxs, leafs, 64);
  if (count < 1) {
    throw new Error("SV_FatPVS: count < 1");
  }

  const longs = (CM_NumClusters(context.collisionWorld) + 31) >> 5;
  const bytes = longs << 2;

  for (let i = 0; i < count; i += 1) {
    leafs[i] = CM_LeafCluster(context.collisionWorld, leafs[i] ?? 0);
  }

  fatpvs.fill(0);
  const first = CM_ClusterPVS(context.collisionWorld, leafs[0] ?? -1);
  fatpvs.set(first.subarray(0, Math.min(bytes, first.length)));

  for (let i = 1; i < count; i += 1) {
    let duplicate = false;
    for (let j = 0; j < i; j += 1) {
      if (leafs[i] === leafs[j]) {
        duplicate = true;
        break;
      }
    }
    if (duplicate) {
      continue;
    }

    const src = CM_ClusterPVS(context.collisionWorld, leafs[i] ?? -1);
    const srcBytes = Math.min(bytes, src.length);
    for (let j = 0; j < srcBytes; j += 1) {
      fatpvs[j] |= src[j];
    }
  }
}

/**
 * Original name: N/A
 * Source: N/A (entity state copy helper)
 * Category: New
 */
function copyEntityState(out: entity_state_t, source: entity_state_t): void {
  out.number = source.number;
  out.origin[0] = source.origin[0];
  out.origin[1] = source.origin[1];
  out.origin[2] = source.origin[2];
  out.angles[0] = source.angles[0];
  out.angles[1] = source.angles[1];
  out.angles[2] = source.angles[2];
  out.old_origin[0] = source.old_origin[0];
  out.old_origin[1] = source.old_origin[1];
  out.old_origin[2] = source.old_origin[2];
  out.modelindex = source.modelindex;
  out.modelindex2 = source.modelindex2;
  out.modelindex3 = source.modelindex3;
  out.modelindex4 = source.modelindex4;
  out.frame = source.frame;
  out.skinnum = source.skinnum;
  out.effects = source.effects;
  out.renderfx = source.renderfx;
  out.solid = source.solid;
  out.sound = source.sound;
  out.event = source.event;
}

/**
 * Original name: N/A
 * Source: N/A (player state clone helper)
 * Category: New
 */
function clonePlayerState(source: client_frame_t["ps"]): client_frame_t["ps"] {
  return {
    pmove: {
      pm_type: source.pmove.pm_type,
      origin: [source.pmove.origin[0], source.pmove.origin[1], source.pmove.origin[2]],
      velocity: [source.pmove.velocity[0], source.pmove.velocity[1], source.pmove.velocity[2]],
      pm_flags: source.pmove.pm_flags,
      pm_time: source.pmove.pm_time,
      gravity: source.pmove.gravity,
      delta_angles: [
        source.pmove.delta_angles[0],
        source.pmove.delta_angles[1],
        source.pmove.delta_angles[2]
      ]
    },
    viewangles: [source.viewangles[0], source.viewangles[1], source.viewangles[2]],
    viewoffset: [source.viewoffset[0], source.viewoffset[1], source.viewoffset[2]],
    kick_angles: [source.kick_angles[0], source.kick_angles[1], source.kick_angles[2]],
    gunangles: [source.gunangles[0], source.gunangles[1], source.gunangles[2]],
    gunoffset: [source.gunoffset[0], source.gunoffset[1], source.gunoffset[2]],
    gunindex: source.gunindex,
    gunframe: source.gunframe,
    blend: [source.blend[0], source.blend[1], source.blend[2], source.blend[3]],
    fov: source.fov,
    rdflags: source.rdflags,
    stats: source.stats.slice(0, MAX_STATS)
  };
}

/**
 * Original name: N/A
 * Source: N/A (server error formatter)
 * Category: New
 */
function formatServerError(error: string, args: unknown[]): string {
  if (args.length === 0) {
    return error;
  }

  return `${error} ${args.map((value) => String(value)).join(" ")}`;
}
