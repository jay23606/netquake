/**
 * File: sv_world.ts
 * Source: Quake II original / server/sv_world.c
 * Purpose: Port of server-side world linking and collision query routines.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses an explicit `ServerWorldContext` instead of file-static C globals.
 * - Replaces `STRUCT_FROM_LINK` pointer arithmetic with a `WeakMap<link_t, edict_t>` owner table.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

import type { edict_t, game_export_t, link_t } from "../../game/src/index.js";
import {
  AREA_SOLID,
  MAX_EDICTS,
  type CollisionWorld,
  type cmodel_t,
  type trace_t,
  type vec3_t,
  vec3_origin,
  CM_BoxLeafnums,
  CM_BoxTrace,
  CM_HeadnodeForBox,
  CM_LeafArea,
  CM_LeafCluster,
  CM_PointContents,
  CM_TransformedBoxTrace,
  CM_TransformedPointContents,
  VectorAdd,
  VectorCopy,
  VectorSubtract
} from "../../qcommon/src/index.js";
import { CONTENTS_DEADMONSTER } from "../../qcommon/src/q_shared.js";
import {
  MAX_ENT_CLUSTERS,
  SOLID_BBOX,
  SOLID_BSP,
  SOLID_NOT,
  SOLID_TRIGGER,
  SVF_DEADMONSTER,
  SVF_MONSTER
} from "../../game/src/index.js";
import type { ServerWorldProcedures, server_t } from "./server.js";
import { server_state_t } from "./server.js";

/**
 * Original name: AREA_DEPTH
 * Source: server/sv_world.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines the fixed depth for the uniformly subdivided server area tree.
 */
const AREA_DEPTH = 4;

/**
 * Original name: AREA_NODES
 * Source: server/sv_world.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines the fixed node budget for the uniformly subdivided server area tree.
 */
const AREA_NODES = 32;

/**
 * Original name: MAX_TOTAL_ENT_LEAFS
 * Source: server/sv_world.c
 * Category: Ported
 * Fidelity level: Strict
 */
const MAX_TOTAL_ENT_LEAFS = 128;

/**
 * Original name: areanode_s
 * Source: server/sv_world.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Porting notes:
 * - Keeps the original axis/dist/children/link-head layout with TypeScript references.
 * - The TypeScript symbol uses the C typedef name `areanode_t`.
 */
interface areanode_t {
  axis: number;
  dist: number;
  children: [areanode_t | null, areanode_t | null];
  trigger_edicts: link_t;
  solid_edicts: link_t;
}

/**
 * Original name: moveclip_t
 * Source: server/sv_world.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Carries the swept bbox extents, trace accumulator and entity filtering state for `SV_Trace`.
 */
interface moveclip_t {
  boxmins: vec3_t;
  boxmaxs: vec3_t;
  mins: vec3_t;
  maxs: vec3_t;
  mins2: vec3_t;
  maxs2: vec3_t;
  start: vec3_t;
  end: vec3_t;
  trace: trace_t;
  passedict: edict_t | null;
  contentmask: number;
}

/**
 * Original name: N/A
 * Source: N/A (explicit server world state)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose:
 * - Replaces the file-static globals from `server/sv_world.c` with explicit per-runtime state.
 */
interface ServerWorldState {
  sv_areanodes: areanode_t[];
  sv_numareanodes: number;
  area_mins: vec3_t;
  area_maxs: vec3_t;
  area_list: Array<edict_t | null>;
  area_count: number;
  area_maxcount: number;
  area_type: number;
  linkOwners: WeakMap<link_t, edict_t>;
}

/**
 * Original name: N/A
 * Source: N/A (runtime dependency context)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose: Hold the explicit runtime dependencies required by the `sv_world.c` port.
 *
 * Constraints:
 * - Must provide access to `sv`, `ge` and the active collision world.
 */
export interface ServerWorldContext {
  sv: server_t;
  ge: game_export_t;
  collisionWorld: CollisionWorld;
  onPrintf?: (message: string) => void;
  onDPrintf?: (message: string) => void;
}

/**
 * Original name: N/A
 * Source: N/A (procedure factory)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose: Build the `sv_world.c` procedure table bound to one explicit server world context.
 *
 * Constraints:
 * - Must preserve call order and side effects from the original file-static C implementation.
 */
export function createServerWorldProcedures(context: ServerWorldContext): ServerWorldProcedures {
  const state = createServerWorldState();

  /**
   * Original name: SV_ClearWorld
   * Source: server/sv_world.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Rebuilds the server-side area node tree from the loaded world model bounds.
   */
  function SV_ClearWorld(): void {
    state.sv_areanodes.length = 0;
    state.sv_numareanodes = 0;

    const worldModel = getServerModel(context.sv, 1);
    if (!worldModel) {
      return;
    }

    SV_CreateAreaNode(0, worldModel.mins, worldModel.maxs, state);
  }

  /**
   * Original name: SV_UnlinkEdict
   * Source: server/sv_world.c
   * Category: Ported
   * Fidelity level: Strict
   *
   * Behavior:
   * - Removes one edict from the area linked lists if it is currently linked.
   */
  function SV_UnlinkEdict(ent: edict_t): void {
    if (!ent.area.prev) {
      return;
    }

    RemoveLink(ent.area);
    ent.area.prev = null;
    ent.area.next = null;
  }

  /**
   * Original name: SV_LinkEdict
   * Source: server/sv_world.c
   * Category: Ported
   * Fidelity level: Close
   *
   * Behavior:
   * - Encodes solid state, updates abs bounds/PVS metadata and links one edict into area lists.
   */
  function SV_LinkEdict(ent: edict_t): void {
    const leafs: number[] = [];
    const clusters = new Int32Array(MAX_TOTAL_ENT_LEAFS);

    if (ent.area.prev) {
      SV_UnlinkEdict(ent);
    }

    if (ent === context.ge.edicts[0]) {
      return;
    }

    if (!ent.inuse) {
      return;
    }

    VectorSubtract(ent.maxs, ent.mins, ent.size);

    if (ent.solid === SOLID_BBOX && (ent.svflags & SVF_DEADMONSTER) === 0) {
      let i = Math.trunc(ent.maxs[0] / 8);
      if (i < 1) {
        i = 1;
      }
      if (i > 31) {
        i = 31;
      }

      let j = Math.trunc((-ent.mins[2]) / 8);
      if (j < 1) {
        j = 1;
      }
      if (j > 31) {
        j = 31;
      }

      let k = Math.trunc((ent.maxs[2] + 32) / 8);
      if (k < 1) {
        k = 1;
      }
      if (k > 63) {
        k = 63;
      }

      ent.s.solid = (k << 10) | (j << 5) | i;
    } else if (ent.solid === SOLID_BSP) {
      ent.s.solid = 31;
    } else {
      ent.s.solid = 0;
    }

    if (ent.solid === SOLID_BSP && (ent.s.angles[0] !== 0 || ent.s.angles[1] !== 0 || ent.s.angles[2] !== 0)) {
      let max = 0;
      for (let i = 0; i < 3; i += 1) {
        let v = Math.abs(ent.mins[i]);
        if (v > max) {
          max = v;
        }
        v = Math.abs(ent.maxs[i]);
        if (v > max) {
          max = v;
        }
      }
      for (let i = 0; i < 3; i += 1) {
        ent.absmin[i] = ent.s.origin[i] - max;
        ent.absmax[i] = ent.s.origin[i] + max;
      }
    } else {
      VectorAdd(ent.s.origin, ent.mins, ent.absmin);
      VectorAdd(ent.s.origin, ent.maxs, ent.absmax);
    }

    ent.absmin[0] -= 1;
    ent.absmin[1] -= 1;
    ent.absmin[2] -= 1;
    ent.absmax[0] += 1;
    ent.absmax[1] += 1;
    ent.absmax[2] += 1;

    ent.num_clusters = 0;
    ent.areanum = 0;
    ent.areanum2 = 0;

    const { count: num_leafs, topnode } = CM_BoxLeafnums(
      context.collisionWorld,
      ent.absmin,
      ent.absmax,
      leafs,
      MAX_TOTAL_ENT_LEAFS
    );

    for (let i = 0; i < num_leafs; i += 1) {
      const leafnum = leafs[i] ?? 0;
      clusters[i] = CM_LeafCluster(context.collisionWorld, leafnum);
      const area = CM_LeafArea(context.collisionWorld, leafnum);
      if (area) {
        if (ent.areanum && ent.areanum !== area) {
          if (ent.areanum2 && ent.areanum2 !== area && context.sv.state === server_state_t.ss_loading) {
            context.onDPrintf?.(
              `Object touching 3 areas at ${ent.absmin[0]} ${ent.absmin[1]} ${ent.absmin[2]}\n`
            );
          }
          ent.areanum2 = area;
        } else {
          ent.areanum = area;
        }
      }
    }

    if (num_leafs >= MAX_TOTAL_ENT_LEAFS) {
      ent.num_clusters = -1;
      ent.headnode = topnode;
    } else {
      ent.num_clusters = 0;
      for (let i = 0; i < num_leafs; i += 1) {
        const cluster = clusters[i];
        if (cluster === -1) {
          continue;
        }

        let j = 0;
        for (; j < i; j += 1) {
          if (clusters[j] === cluster) {
            break;
          }
        }

        if (j === i) {
          if (ent.num_clusters === MAX_ENT_CLUSTERS) {
            ent.num_clusters = -1;
            ent.headnode = topnode;
            break;
          }

          ent.clusternums[ent.num_clusters] = cluster;
          ent.num_clusters += 1;
        }
      }
    }

    if (!ent.linkcount) {
      VectorCopy(ent.s.origin, ent.s.old_origin);
    }
    ent.linkcount += 1;

    if (ent.solid === SOLID_NOT) {
      return;
    }

    let node: areanode_t | null = state.sv_areanodes[0] ?? null;
    while (node) {
      if (node.axis === -1) {
        break;
      }

      if (ent.absmin[node.axis] > node.dist) {
        node = node.children[0];
      } else if (ent.absmax[node.axis] < node.dist) {
        node = node.children[1];
      } else {
        break;
      }
    }

    if (!node) {
      return;
    }

    state.linkOwners.set(ent.area, ent);
    if (ent.solid === SOLID_TRIGGER) {
      InsertLinkBefore(ent.area, node.trigger_edicts);
    } else {
      InsertLinkBefore(ent.area, node.solid_edicts);
    }
  }

  /**
   * Original name: SV_AreaEdicts
   * Source: server/sv_world.c
   * Category: Ported
   * Fidelity level: Strict
   *
   * Behavior:
   * - Fills a caller-provided list with linked edicts intersecting the query bounds.
   */
  function SV_AreaEdicts(
    mins: vec3_t,
    maxs: vec3_t,
    list: Array<edict_t | null>,
    maxcount: number,
    areatype: number
  ): number {
    state.area_mins = mins;
    state.area_maxs = maxs;
    state.area_list = list;
    state.area_count = 0;
    state.area_maxcount = maxcount;
    state.area_type = areatype;

    const root = state.sv_areanodes[0];
    if (root) {
      SV_AreaEdicts_r(root, state, context);
    }

    return state.area_count;
  }

  /**
   * Original name: SV_PointContents
   * Source: server/sv_world.c
   * Category: Ported
   * Fidelity level: Strict
   *
   * Behavior:
   * - Returns world contents OR-ed with contents from linked solid entities at the point.
   */
  function SV_PointContents(point: vec3_t): number {
    const worldModel = getServerModel(context.sv, 1);
    if (!worldModel) {
      return 0;
    }

    let contents = CM_PointContents(context.collisionWorld, point, worldModel.headnode);
    const touch = new Array<edict_t | null>(MAX_EDICTS).fill(null);
    const num = SV_AreaEdicts(point, point, touch, MAX_EDICTS, AREA_SOLID);

    for (let i = 0; i < num; i += 1) {
      const hit = touch[i];
      if (!hit) {
        continue;
      }

      const headnode = SV_HullForEntity(hit, context);
      const c2 = CM_TransformedPointContents(
        context.collisionWorld,
        point,
        headnode,
        hit.s.origin,
        hit.s.angles
      );
      contents |= c2;
    }

    return contents;
  }

  /**
   * Original name: SV_Trace
   * Source: server/sv_world.c
   * Category: Ported
   * Fidelity level: Strict
   *
   * Behavior:
   * - Traces one swept bbox through world and linked entities while excluding the passedict pair.
   */
  function SV_Trace(
    start: vec3_t,
    mins: vec3_t,
    maxs: vec3_t,
    end: vec3_t,
    passedict: edict_t | null,
    contentmask: number
  ): trace_t {
    const minsResolved = mins ?? vec3_origin;
    const maxsResolved = maxs ?? vec3_origin;

    const clip: moveclip_t = {
      boxmins: [0, 0, 0],
      boxmaxs: [0, 0, 0],
      mins: minsResolved,
      maxs: maxsResolved,
      mins2: [...minsResolved],
      maxs2: [...maxsResolved],
      start,
      end,
      trace: CM_BoxTrace(context.collisionWorld, start, end, minsResolved, maxsResolved, 0, contentmask),
      passedict,
      contentmask
    };

    clip.trace.ent = context.ge.edicts[0] ?? null;
    if (clip.trace.fraction === 0) {
      return clip.trace;
    }

    SV_TraceBounds(start, clip.mins2, clip.maxs2, end, clip.boxmins, clip.boxmaxs);
    SV_ClipMoveToEntities(clip, context, state, SV_AreaEdicts);

    return clip.trace;
  }

  return {
    SV_ClearWorld,
    SV_UnlinkEdict,
    SV_LinkEdict,
    SV_AreaEdicts,
    SV_PointContents,
    SV_Trace
  };
}

/**
 * Original name: N/A
 * Source: N/A (explicit server world state initializer)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose:
 * - Initializes the TypeScript holder for `sv_world.c` file-static state.
 */
function createServerWorldState(): ServerWorldState {
  return {
    sv_areanodes: [],
    sv_numareanodes: 0,
    area_mins: [0, 0, 0],
    area_maxs: [0, 0, 0],
    area_list: [],
    area_count: 0,
    area_maxcount: 0,
    area_type: AREA_SOLID,
    linkOwners: new WeakMap<link_t, edict_t>()
  };
}

/**
 * Original name: N/A
 * Source: N/A (safe model lookup helper)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose:
 * - Centralizes nullable server model lookup for the explicit-context port.
 */
function getServerModel(sv: server_t, modelIndex: number): cmodel_t | null {
  const model = sv.models[modelIndex] as cmodel_t | null | undefined;
  if (!model) {
    return null;
  }

  return model;
}

/**
 * Original name: ClearLink
 * Source: server/sv_world.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Initializes a link as a self-referential list head.
 */
function ClearLink(link: link_t): void {
  link.prev = link;
  link.next = link;
}

/**
 * Original name: RemoveLink
 * Source: server/sv_world.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Splices a linked node out of its doubly linked list.
 *
 * Porting notes:
 * - Guards against null links because TypeScript edicts can start detached instead of containing stale pointers.
 */
function RemoveLink(link: link_t): void {
  if (!link.prev || !link.next) {
    return;
  }

  link.next.prev = link.prev;
  link.prev.next = link.next;
}

/**
 * Original name: InsertLinkBefore
 * Source: server/sv_world.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Inserts a link immediately before the supplied list head/node.
 *
 * Porting notes:
 * - Reinitializes a detached `before` head so browser-created entities can be linked safely.
 */
function InsertLinkBefore(link: link_t, before: link_t): void {
  if (!before.prev || !before.next) {
    ClearLink(before);
  }

  link.next = before;
  link.prev = before.prev;
  if (link.prev) {
    link.prev.next = link;
  }
  before.prev = link;
}

/**
 * Original name: SV_CreateAreaNode
 * Source: server/sv_world.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Recursively builds the fixed-depth area tree and initializes trigger/solid list heads.
 */
function SV_CreateAreaNode(depth: number, mins: vec3_t, maxs: vec3_t, state: ServerWorldState): areanode_t {
  const node: areanode_t = {
    axis: -1,
    dist: 0,
    children: [null, null],
    trigger_edicts: { prev: null, next: null },
    solid_edicts: { prev: null, next: null }
  };

  state.sv_areanodes.push(node);
  state.sv_numareanodes += 1;

  ClearLink(node.trigger_edicts);
  ClearLink(node.solid_edicts);

  if (depth === AREA_DEPTH || state.sv_numareanodes >= AREA_NODES) {
    node.axis = -1;
    return node;
  }

  const size: vec3_t = [0, 0, 0];
  VectorSubtract(maxs, mins, size);
  node.axis = size[0] > size[1] ? 0 : 1;
  node.dist = 0.5 * (maxs[node.axis] + mins[node.axis]);

  const mins1: vec3_t = [...mins];
  const mins2: vec3_t = [...mins];
  const maxs1: vec3_t = [...maxs];
  const maxs2: vec3_t = [...maxs];

  maxs1[node.axis] = node.dist;
  mins2[node.axis] = node.dist;

  node.children[0] = SV_CreateAreaNode(depth + 1, mins2, maxs2, state);
  node.children[1] = SV_CreateAreaNode(depth + 1, mins1, maxs1, state);
  return node;
}

/**
 * Original name: SV_AreaEdicts_r
 * Source: server/sv_world.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Recurses area nodes and appends linked edicts whose absolute boxes intersect the query.
 *
 * Porting notes:
 * - Uses the `STRUCT_FROM_LINK` replacement owner table to recover the edict from `edict.area`.
 */
function SV_AreaEdicts_r(node: areanode_t, state: ServerWorldState, context: ServerWorldContext): void {
  const start = state.area_type === AREA_SOLID ? node.solid_edicts : node.trigger_edicts;
  let link = start.next;

  while (link && link !== start) {
    const next = link.next;
    const check = state.linkOwners.get(link);
    if (check && check.solid !== SOLID_NOT) {
      if (
        check.absmin[0] <= state.area_maxs[0] &&
        check.absmin[1] <= state.area_maxs[1] &&
        check.absmin[2] <= state.area_maxs[2] &&
        check.absmax[0] >= state.area_mins[0] &&
        check.absmax[1] >= state.area_mins[1] &&
        check.absmax[2] >= state.area_mins[2]
      ) {
        if (state.area_count === state.area_maxcount) {
          context.onPrintf?.("SV_AreaEdicts: MAXCOUNT\n");
          return;
        }

        state.area_list[state.area_count] = check;
        state.area_count += 1;
      }
    }

    link = next;
  }

  if (node.axis === -1) {
    return;
  }

  if (state.area_maxs[node.axis] > node.dist) {
    const child = node.children[0];
    if (child) {
      SV_AreaEdicts_r(child, state, context);
    }
  }
  if (state.area_mins[node.axis] < node.dist) {
    const child = node.children[1];
    if (child) {
      SV_AreaEdicts_r(child, state, context);
    }
  }
}

/**
 * Original name: SV_HullForEntity
 * Source: server/sv_world.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns an inline BSP headnode for brush models, or a temporary bbox hull for other solids.
 */
function SV_HullForEntity(ent: edict_t, context: ServerWorldContext): number {
  if (ent.solid === SOLID_BSP) {
    const model = getServerModel(context.sv, ent.s.modelindex);
    if (!model) {
      throw new Error("MOVETYPE_PUSH with a non bsp model");
    }

    return model.headnode;
  }

  return CM_HeadnodeForBox(context.collisionWorld, ent.mins, ent.maxs);
}

/**
 * Original name: SV_ClipMoveToEntities
 * Source: server/sv_world.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Clips the current move against linked solid edicts and preserves the earliest/startsolid trace.
 * - Applies the original `passedict`, owner and dead-monster contentmask filters.
 */
function SV_ClipMoveToEntities(
  clip: moveclip_t,
  context: ServerWorldContext,
  state: ServerWorldState,
  areaQuery: ServerWorldProcedures["SV_AreaEdicts"]
): void {
  void state;

  const touchlist = new Array<edict_t | null>(MAX_EDICTS).fill(null);
  const num = areaQuery(clip.boxmins, clip.boxmaxs, touchlist, MAX_EDICTS, AREA_SOLID);

  for (let i = 0; i < num; i += 1) {
    const touch = touchlist[i];
    if (!touch || touch.solid === SOLID_NOT) {
      continue;
    }

    if (touch === clip.passedict) {
      continue;
    }
    if (clip.trace.allsolid) {
      return;
    }
    if (clip.passedict) {
      if (touch.owner === clip.passedict) {
        continue;
      }
      if (clip.passedict.owner === touch) {
        continue;
      }
    }

    if ((clip.contentmask & CONTENTS_DEADMONSTER) === 0 && (touch.svflags & SVF_DEADMONSTER) !== 0) {
      continue;
    }

    const headnode = SV_HullForEntity(touch, context);
    const angles = touch.solid !== SOLID_BSP ? vec3_origin : touch.s.angles;

    const trace =
      (touch.svflags & SVF_MONSTER) !== 0
        ? CM_TransformedBoxTrace(
          context.collisionWorld,
          clip.start,
          clip.end,
          clip.mins2,
          clip.maxs2,
          headnode,
          clip.contentmask,
          touch.s.origin,
          angles
        )
        : CM_TransformedBoxTrace(
          context.collisionWorld,
          clip.start,
          clip.end,
          clip.mins,
          clip.maxs,
          headnode,
          clip.contentmask,
          touch.s.origin,
          angles
        );

    if (trace.allsolid || trace.startsolid || trace.fraction < clip.trace.fraction) {
      trace.ent = touch;
      if (clip.trace.startsolid) {
        clip.trace = trace;
        clip.trace.startsolid = true;
      } else {
        clip.trace = trace;
      }
    } else if (trace.startsolid) {
      clip.trace.startsolid = true;
    }
  }
}

/**
 * Original name: SV_TraceBounds
 * Source: server/sv_world.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Builds the expanded query bounds enclosing the whole swept box move.
 */
function SV_TraceBounds(
  start: vec3_t,
  mins: vec3_t,
  maxs: vec3_t,
  end: vec3_t,
  boxmins: vec3_t,
  boxmaxs: vec3_t
): void {
  for (let i = 0; i < 3; i += 1) {
    if (end[i] > start[i]) {
      boxmins[i] = start[i] + mins[i] - 1;
      boxmaxs[i] = end[i] + maxs[i] + 1;
    } else {
      boxmins[i] = end[i] + mins[i] - 1;
      boxmaxs[i] = start[i] + maxs[i] + 1;
    }
  }
}
