/**
 * File: cmodel.ts
 * Source: Quake II original / qcommon/cmodel.c
 * Purpose: Port the first BSP collision and contents queries used by client prediction and shared movement code.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Keeps the original map cache and globals inside an explicit runtime object instead of file-static C globals.
 * - Uses the TypeScript BSP parser and an injected file loader instead of direct raw lump pointer access.
 *
 * Notes:
 * - This file is intended to stay close to the original collision model logic.
 */

import {
  AngleVectors,
  CONTENTS_MONSTER,
  CONTENTS_SOLID,
  type cmodel_t,
  type cplane_t,
  type csurface_t,
  type trace_t,
  type vec3_t
} from "./q_shared.js";
import { Com_BlockChecksum } from "./md4.js";
import { DVIS_PHS, DVIS_PVS, MAX_MAP_AREAPORTALS } from "../../formats/src/index.js";
import { parseBsp, type BspMap, type darea_t, type dareaportal_t, type dplane_t, type dvis_t, type texinfo_t } from "../../formats/src/qfiles.js";
import {
  DotProduct,
  VectorAdd,
  VectorClear,
  VectorCopy
} from "../../math/src/q_shared.js";

/**
 * Original name: DIST_EPSILON
 * Source declaree: Quake-2-master/qcommon/cmodel.c
 * Category: Ported
 */
const DIST_EPSILON = 0.03125;

/**
 * Original name: N/A
 * Source declaree: N/A (local portal state serializer)
 * Category: New
 */
const PORTAL_STATE_BYTES = MAX_MAP_AREAPORTALS * 4;

/**
 * Original name: cbrushside_t
 * Source: qcommon/cmodel.c
 * Source declaree: Quake-2-master/qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Porting notes:
 * - Renamed to describe the TypeScript collision-world ownership; fields preserve the original plane/surface references.
 */
interface CollisionBrushSide {
  plane: cplane_t;
  surface: csurface_t;
}

/**
 * Original name: cbrush_t
 * Source: qcommon/cmodel.c
 * Source declaree: Quake-2-master/qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Porting notes:
 * - Renamed to describe the TypeScript collision-world ownership; `checkcount` is replaced by per-trace `checkedBrushes`.
 */
interface CollisionBrush {
  contents: number;
  numsides: number;
  firstbrushside: number;
}

/**
 * Original name: cleaf_t
 * Source: qcommon/cmodel.c
 * Source declaree: Quake-2-master/qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Porting notes:
 * - Renamed to describe the TypeScript collision-world ownership; BSP leaf indexing and brush references are preserved.
 */
interface CollisionLeaf {
  contents: number;
  cluster: number;
  area: number;
  firstleafbrush: number;
  numleafbrushes: number;
}

/**
 * Original name: cnode_t
 * Source: qcommon/cmodel.c
 * Source declaree: Quake-2-master/qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Porting notes:
 * - Renamed to describe the TypeScript collision-world ownership; negative child ids still reference leafs.
 */
interface CollisionNode {
  plane: cplane_t;
  children: [number, number];
}

/**
 * Original name: carea_t
 * Source: qcommon/cmodel.c
 * Source declaree: Quake-2-master/qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Porting notes:
 * - Renamed to describe the TypeScript collision-world ownership; flood fields remain mutable runtime state.
 */
interface CollisionArea {
  numareaportals: number;
  firstareaportal: number;
  floodnum: number;
  floodvalid: number;
}

/**
 * Original name: N/A
 * Source declaree: N/A (collision runtime state)
 * Category: New
 * Purpose: Hold the BSP-derived collision structures needed by point contents and trace queries.
 *
 * Constraints:
 * - Must preserve node/leaf/brush indexing so headnodes from the BSP remain valid.
 */
export interface CollisionWorld {
  map: BspMap;
  map_cmodels: cmodel_t[];
  map_planes: cplane_t[];
  map_nodes: CollisionNode[];
  map_leafs: CollisionLeaf[];
  map_leafbrushes: number[];
  map_brushes: CollisionBrush[];
  map_brushsides: CollisionBrushSide[];
  map_areas: CollisionArea[];
  map_areaportals: dareaportal_t[];
  map_visibility: Uint8Array;
  map_vis: dvis_t | null;
  map_entitystring: string;
  nullsurface: csurface_t;
  numclusters: number;
  numareas: number;
  emptyleaf: number;
  solidleaf: number;
  box_headnode: number;
  box_brush: number;
  box_leaf: number;
  floodvalid: number;
  portalopen: Uint8Array;
  map_noareas: boolean;
}

/**
 * Original name: N/A
 * Source declaree: N/A (collision runtime state)
 * Category: New
 * Purpose: Preserve the `cmodel.c` map cache and the cvar-like knobs needed by `CM_LoadMap`.
 *
 * Constraints:
 * - Must keep the last loaded map name and checksum so repeated `CM_LoadMap` calls can reuse the cached world.
 */
export interface CollisionModelRuntime {
  map_name: string;
  map_noareas: boolean;
  flushmap: boolean;
  last_checksum: number;
  world: CollisionWorld | null;
}

/**
 * Original name: N/A
 * Source declaree: N/A (collision load result shape)
 * Category: New
 * Purpose: Describe the source-faithful result of `CM_LoadMap`.
 *
 * Constraints:
 * - Must always expose the checksum produced for the selected map path, even when the cached world is reused.
 */
export interface CollisionLoadResult {
  world: CollisionWorld | null;
  cmodel: cmodel_t;
  checksum: number;
  reused: boolean;
}

/**
 * Original name: N/A
 * Source declaree: N/A (collision map loader callback)
 * Category: New
 * Purpose: Provide the file-loading callback needed by the TypeScript `CM_LoadMap` path.
 *
 * Constraints:
 * - Must return the raw BSP bytes for `name`, or `undefined` when the file cannot be resolved.
 */
export type CollisionMapLoader = (name: string) => Uint8Array | undefined;

/**
 * Original name: N/A
 * Source declaree: N/A (per-trace runtime state)
 * Category: New
 */
interface TraceWork {
  start: vec3_t;
  end: vec3_t;
  mins: vec3_t;
  maxs: vec3_t;
  extents: vec3_t;
  ispoint: boolean;
  contents: number;
  trace: trace_t;
  checkedBrushes: Set<number>;
}

/**
 * Original name: N/A
 * Source declaree: N/A (collision runtime factory)
 * Category: New
 * Purpose: Create the explicit runtime state that replaces the original `cmodel.c` file-static globals.
 *
 * Constraints:
 * - Must start with no loaded map and a zero checksum.
 */
export function createCollisionModelRuntime(map_noareas = false): CollisionModelRuntime {
  return {
    map_name: "",
    map_noareas,
    flushmap: false,
    last_checksum: 0,
    world: null
  };
}

/**
 * Original name: N/A
 * Source declaree: N/A (BSP collision world adapter)
 * Category: New
 * Purpose: Build the first collision runtime from a parsed BSP map.
 *
 * Constraints:
 * - Must preserve model headnodes so world model `0` and submodels can be traced later.
 *
 * Porting notes:
 * - This adapter replaces the original static `CMod_Load*` lump loaders after `parseBsp` has performed the raw little-endian lump reads.
 * - It preserves the original collision structure ownership in `CollisionWorld` instead of mutating file-static arrays.
 */
export function createCollisionWorld(map: BspMap): CollisionWorld {
  const map_planes = map.planes.map((plane) => createPlane(plane));
  const surfaces = map.texinfo.map((texinfo) => createSurface(texinfo));
  const nullsurface: csurface_t = { name: "", flags: 0, value: 0 };

  const map_brushsides = map.brushsides.map((side) => ({
    plane: map_planes[side.planenum],
    surface: surfaces[side.texinfo] ?? nullsurface
  }));

  const map_brushes = map.brushes.map((brush) => ({
    contents: brush.contents,
    numsides: brush.numsides,
    firstbrushside: brush.firstside
  }));

  const map_leafs = map.leafs.map((leaf) => ({
    contents: leaf.contents,
    cluster: leaf.cluster,
    area: leaf.area,
    firstleafbrush: leaf.firstleafbrush,
    numleafbrushes: leaf.numleafbrushes
  }));

  const map_nodes = map.nodes.map((node) => ({
    plane: map_planes[node.planenum],
    children: [node.children[0], node.children[1]] as [number, number]
  }));

  const map_cmodels = map.models.map((model) => ({
    mins: [model.mins[0] - 1, model.mins[1] - 1, model.mins[2] - 1] as vec3_t,
    maxs: [model.maxs[0] + 1, model.maxs[1] + 1, model.maxs[2] + 1] as vec3_t,
    origin: [model.origin[0], model.origin[1], model.origin[2]] as vec3_t,
    headnode: model.headnode
  }));

  const map_areas = map.areas.map((area) => createArea(area));
  const map_areaportals = map.areaportals.map((portal) => ({
    portalnum: portal.portalnum,
    otherarea: portal.otherarea
  }));

  let numclusters = 0;
  for (const leaf of map_leafs) {
    if (leaf.cluster >= numclusters) {
      numclusters = leaf.cluster + 1;
    }
  }

  let emptyleaf = -1;
  for (let index = 1; index < map_leafs.length; index += 1) {
    if (map_leafs[index].contents === 0) {
      emptyleaf = index;
      break;
    }
  }

  const world: CollisionWorld = {
    map,
    map_cmodels,
    map_planes,
    map_nodes,
    map_leafs,
    map_leafbrushes: Array.from(map.leafbrushes, (value) => value),
    map_brushes,
    map_brushsides,
    map_areas,
    map_areaportals,
    map_visibility: map.visibility.slice(),
    map_vis: parseVisibilityLump(map.visibility),
    map_entitystring: map.entities,
    nullsurface,
    numclusters,
    numareas: Math.max(1, map_areas.length),
    emptyleaf,
    solidleaf: 0,
    box_headnode: -1,
    box_brush: -1,
    box_leaf: -1,
    floodvalid: 0,
    portalopen: new Uint8Array(MAX_MAP_AREAPORTALS),
    map_noareas: false
  };

  CM_InitBoxHull(world);
  FloodAreaConnections(world);

  return world;
}

/**
 * Original name: CM_LoadMap
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Loads one BSP map through the injected file loader, caches it, computes its checksum and returns model `0`.
 *
 * Porting notes:
 * - Replaces the original filesystem globals and `Cvar_VariableValue("flushmap")` reads with an explicit runtime object.
 */
export function CM_LoadMap(
  runtime: CollisionModelRuntime,
  name: string,
  clientload: boolean,
  loadFile: CollisionMapLoader
): CollisionLoadResult {
  if (name.length > 0 && runtime.world && runtime.map_name === name && (clientload || !runtime.flushmap)) {
    runtime.world.map_noareas = runtime.map_noareas;

    if (!clientload) {
      resetPortalState(runtime.world);
    }

    return {
      world: runtime.world,
      cmodel: runtime.world.map_cmodels[0] ?? createEmptyCmodel(),
      checksum: runtime.last_checksum,
      reused: true
    };
  }

  runtime.world = null;
  runtime.map_name = "";
  runtime.last_checksum = 0;

  if (name.length === 0) {
    return {
      world: null,
      cmodel: createEmptyCmodel(),
      checksum: 0,
      reused: false
    };
  }

  const bytes = loadFile(name);
  if (!bytes) {
    throw new Error(`Couldn't load ${name}`);
  }

  const checksum = Com_BlockChecksum(bytes, bytes.length);
  const map = parseBsp(bytes, name);
  const world = createCollisionWorld(map);
  world.map_noareas = runtime.map_noareas;

  runtime.world = world;
  runtime.map_name = name;
  runtime.last_checksum = checksum;

  if (!clientload) {
    resetPortalState(world);
  }

  return {
    world,
    cmodel: world.map_cmodels[0] ?? createEmptyCmodel(),
    checksum,
    reused: false
  };
}

/**
 * Original name: CM_PointContents
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns the BSP leaf contents for one point under a given headnode.
 */
export function CM_PointContents(world: CollisionWorld, point: vec3_t, headnode = 0): number {
  if (world.map_planes.length === 0) {
    return 0;
  }

  const leafnum = CM_PointLeafnum_r(world, point, headnode);
  return world.map_leafs[leafnum]?.contents ?? CONTENTS_SOLID;
}

/**
 * Original name: CM_TransformedPointContents
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns point contents for one translated or rotated BSP submodel.
 */
export function CM_TransformedPointContents(
  world: CollisionWorld,
  point: vec3_t,
  headnode: number,
  origin: vec3_t,
  angles: vec3_t
): number {
  const localPoint = subtractVec3(point, origin);

  if (headnode !== world.box_headnode && hasRotation(angles)) {
    rotateIntoModelFrame(localPoint, angles, localPoint);
  }

  const leafnum = CM_PointLeafnum_r(world, localPoint, headnode);
  return world.map_leafs[leafnum]?.contents ?? CONTENTS_SOLID;
}

/**
 * Original name: CM_BoxTrace
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Sweeps an AABB against one BSP headnode and returns the earliest brush hit.
 *
 * Porting notes:
 * - Covers the core world/submodel brush tracing path needed by `pmove`.
 * - Rotated and translated submodel traces are handled by `CM_TransformedBoxTrace`.
 */
export function CM_BoxTrace(
  world: CollisionWorld,
  start: vec3_t,
  end: vec3_t,
  mins: vec3_t,
  maxs: vec3_t,
  headnode: number,
  brushmask: number
): trace_t {
  const trace: trace_t = {
    allsolid: false,
    startsolid: false,
    fraction: 1,
    endpos: [...end],
    plane: createDefaultPlane(),
    surface: world.nullsurface,
    contents: 0,
    ent: null
  };

  if (world.map_nodes.length === 0) {
    return trace;
  }

  const extents: vec3_t = [0, 0, 0];
  const ispoint = mins[0] === 0 && mins[1] === 0 && mins[2] === 0 && maxs[0] === 0 && maxs[1] === 0 && maxs[2] === 0;
  if (!ispoint) {
    for (let index = 0; index < 3; index += 1) {
      extents[index] = Math.max(Math.abs(mins[index]), Math.abs(maxs[index]));
    }
  }

  const work: TraceWork = {
    start: [...start],
    end: [...end],
    mins: [...mins],
    maxs: [...maxs],
    extents,
    ispoint,
    contents: brushmask,
    trace,
    checkedBrushes: new Set<number>()
  };

  if (start[0] === end[0] && start[1] === end[1] && start[2] === end[2]) {
    CM_TestInLeafs(world, headnode, start, mins, maxs, work);
    VectorCopy(start, work.trace.endpos);
    return work.trace;
  }

  CM_RecursiveHullCheck(world, work, headnode, 0, 1, start, end);

  if (work.trace.fraction === 1) {
    VectorCopy(end, work.trace.endpos);
  } else {
    for (let index = 0; index < 3; index += 1) {
      work.trace.endpos[index] = start[index] + work.trace.fraction * (end[index] - start[index]);
    }
  }

  return work.trace;
}

/**
 * Original name: CM_TransformedBoxTrace
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Sweeps an AABB against one translated or rotated BSP submodel.
 */
export function CM_TransformedBoxTrace(
  world: CollisionWorld,
  start: vec3_t,
  end: vec3_t,
  mins: vec3_t,
  maxs: vec3_t,
  headnode: number,
  brushmask: number,
  origin: vec3_t,
  angles: vec3_t
): trace_t {
  const startLocal = subtractVec3(start, origin);
  const endLocal = subtractVec3(end, origin);
  const rotated = headnode !== getBoxHeadnode(world) && hasRotation(angles);

  if (rotated) {
    rotateIntoModelFrame(startLocal, angles, startLocal);
    rotateIntoModelFrame(endLocal, angles, endLocal);
  }

  const trace = CM_BoxTrace(world, startLocal, endLocal, mins, maxs, headnode, brushmask);

  if (rotated && trace.fraction !== 1.0) {
    const inverseAngles = negateVec3(angles);
    rotateOutOfModelFrame(trace.plane.normal, inverseAngles, trace.plane.normal);
  }

  trace.endpos = [
    start[0] + trace.fraction * (end[0] - start[0]),
    start[1] + trace.fraction * (end[1] - start[1]),
    start[2] + trace.fraction * (end[2] - start[2])
  ];

  return trace;
}

/**
 * Original name: N/A
 * Source declaree: N/A (pmove trace adapter)
 * Category: New
 * Purpose: Create a `pmove`-compatible trace callback bound to one collision world and headnode.
 *
 * Constraints:
 * - Must preserve `CM_BoxTrace` argument ordering expected by `pmove`.
 */
export function createCollisionTrace(world: CollisionWorld, headnode = 0, brushmask = -1): (
  start: vec3_t,
  mins: vec3_t,
  maxs: vec3_t,
  end: vec3_t
) => trace_t {
  return (start, mins, maxs, end) => {
    const trace = CM_BoxTrace(world, start, end, mins, maxs, headnode, brushmask);

    // Match Quake II `CL_PMTrace`: the world collision path reports a non-null
    // entity sentinel so `pmove` can recognize solid ground contact.
    if (trace.fraction < 1 || trace.startsolid || trace.allsolid) {
      trace.ent = world;
    }

    return trace;
  };
}

/**
 * Original name: N/A
 * Source declaree: N/A (pmove contents adapter)
 * Category: New
 * Purpose: Create a `pmove`-compatible point contents callback bound to one collision world and headnode.
 *
 * Constraints:
 * - Must preserve `CM_PointContents` semantics for the selected headnode.
 */
export function createCollisionPointContents(world: CollisionWorld, headnode = 0): (point: vec3_t) => number {
  return (point) => CM_PointContents(world, point, headnode);
}

/**
 * Original name: CM_InlineModel
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Exposes one BSP submodel in `cmodel_t` shape for later entity collision usage.
 *
 * Constraints:
 * - Must return null for out-of-range model indexes.
 *
 * Porting notes:
 * - Accepts a numeric index for local adapters in addition to the original `"*n"` name form.
 */
export function CM_InlineModel(world: CollisionWorld, nameOrIndex: number | string): cmodel_t | null {
  if (typeof nameOrIndex === "number") {
    return world.map_cmodels[nameOrIndex] ?? null;
  }

  if (nameOrIndex.length === 0 || nameOrIndex[0] !== "*") {
    throw new Error("CM_InlineModel: bad name");
  }

  const index = Number.parseInt(nameOrIndex.slice(1), 10);
  if (!Number.isFinite(index) || index < 1 || index >= world.map_cmodels.length) {
    throw new Error("CM_InlineModel: bad number");
  }

  return world.map_cmodels[index];
}

/**
 * Original name: CM_NumClusters
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the number of BSP visibility clusters in the loaded collision map.
 */
export function CM_NumClusters(world: CollisionWorld): number {
  return world.numclusters;
}

/**
 * Original name: CM_NumInlineModels
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the number of inline models exposed by the loaded BSP collision map.
 */
export function CM_NumInlineModels(world: CollisionWorld): number {
  return world.map_cmodels.length;
}

/**
 * Original name: CM_EntityString
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the raw BSP entity string associated with the loaded collision map.
 */
export function CM_EntityString(world: CollisionWorld): string {
  return world.map_entitystring;
}

/**
 * Original name: CM_LeafContents
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the contents bitmask of one BSP leaf.
 */
export function CM_LeafContents(world: CollisionWorld, leafnum: number): number {
  const leaf = world.map_leafs[leafnum];
  if (!leaf) {
    throw new Error(`CM_LeafContents: bad number ${leafnum}`);
  }
  return leaf.contents;
}

/**
 * Original name: CM_LeafCluster
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the visibility cluster id of one BSP leaf.
 */
export function CM_LeafCluster(world: CollisionWorld, leafnum: number): number {
  const leaf = world.map_leafs[leafnum];
  if (!leaf) {
    throw new Error(`CM_LeafCluster: bad number ${leafnum}`);
  }
  return leaf.cluster;
}

/**
 * Original name: CM_LeafArea
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the area id of one BSP leaf.
 */
export function CM_LeafArea(world: CollisionWorld, leafnum: number): number {
  const leaf = world.map_leafs[leafnum];
  if (!leaf) {
    throw new Error(`CM_LeafArea: bad number ${leafnum}`);
  }
  return leaf.area;
}

/**
 * Original name: CM_PointLeafnum
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the BSP leaf number containing one point in the world headnode.
 */
export function CM_PointLeafnum(world: CollisionWorld, point: vec3_t): number {
  if (world.map_planes.length === 0) {
    return 0;
  }
  return CM_PointLeafnum_r(world, point, 0);
}

/**
 * Original name: CM_HeadnodeForBox
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Updates the synthetic box hull planes from the supplied mins/maxs and returns the box headnode.
 */
export function CM_HeadnodeForBox(world: CollisionWorld, mins: vec3_t, maxs: vec3_t): number {
  const planeOffset = world.map_planes.length - 12;
  world.map_planes[planeOffset + 0].dist = maxs[0];
  world.map_planes[planeOffset + 1].dist = -maxs[0];
  world.map_planes[planeOffset + 2].dist = mins[0];
  world.map_planes[planeOffset + 3].dist = -mins[0];
  world.map_planes[planeOffset + 4].dist = maxs[1];
  world.map_planes[planeOffset + 5].dist = -maxs[1];
  world.map_planes[planeOffset + 6].dist = mins[1];
  world.map_planes[planeOffset + 7].dist = -mins[1];
  world.map_planes[planeOffset + 8].dist = maxs[2];
  world.map_planes[planeOffset + 9].dist = -maxs[2];
  world.map_planes[planeOffset + 10].dist = mins[2];
  world.map_planes[planeOffset + 11].dist = -mins[2];

  return world.box_headnode;
}

/**
 * Original name: CM_BoxLeafnums_headnode
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Collects leaf numbers touched by one bounds box under the requested BSP headnode.
 */
export function CM_BoxLeafnums_headnode(
  world: CollisionWorld,
  mins: vec3_t,
  maxs: vec3_t,
  list: number[],
  listsize: number,
  headnode: number
): { count: number; topnode: number } {
  const output: number[] = [];
  const state = { topnode: -1 };
  CM_BoxLeafnums_r(world, headnode, mins, maxs, output, listsize, state);

  const count = Math.min(output.length, listsize);
  list.length = 0;
  for (let index = 0; index < count; index += 1) {
    list.push(output[index]);
  }

  return {
    count,
    topnode: state.topnode
  };
}

/**
 * Original name: CM_BoxLeafnums
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Collects leaf numbers touched by one bounds box under the world headnode.
 */
export function CM_BoxLeafnums(
  world: CollisionWorld,
  mins: vec3_t,
  maxs: vec3_t,
  list: number[],
  listsize: number
): { count: number; topnode: number } {
  const headnode = world.map_cmodels[0]?.headnode ?? 0;
  return CM_BoxLeafnums_headnode(world, mins, maxs, list, listsize, headnode);
}

/**
 * Original name: CM_DecompressVis
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Decompresses one Quake II RLE visibility row into the caller-supplied output buffer.
 */
export function CM_DecompressVis(world: CollisionWorld, input: Uint8Array | null, output: Uint8Array): void {
  const row = (world.numclusters + 7) >> 3;
  output.fill(0);

  if (!input || world.map_visibility.length === 0 || !world.map_vis) {
    output.fill(0xff, 0, row);
    return;
  }

  let inIndex = 0;
  let outIndex = 0;
  while (outIndex < row && inIndex < input.length) {
    const value = input[inIndex];
    if (value !== 0) {
      output[outIndex] = value;
      outIndex += 1;
      inIndex += 1;
      continue;
    }

    if (inIndex + 1 >= input.length) {
      break;
    }

    let count = input[inIndex + 1];
    inIndex += 2;
    if (outIndex + count > row) {
      count = row - outIndex;
    }

    while (count > 0 && outIndex < row) {
      output[outIndex] = 0;
      outIndex += 1;
      count -= 1;
    }
  }
}

/**
 * Original name: CM_ClusterPVS
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns the decompressed PVS row for one cluster.
 *
 * Porting notes:
 * - Uses a fresh typed-array row instead of the original static `pvsrow` buffer.
 */
export function CM_ClusterPVS(world: CollisionWorld, cluster: number): Uint8Array {
  return getClusterVis(world, cluster, DVIS_PVS);
}

/**
 * Original name: CM_ClusterPHS
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns the decompressed PHS row for one cluster.
 *
 * Porting notes:
 * - Uses a fresh typed-array row instead of the original static `phsrow` buffer.
 */
export function CM_ClusterPHS(world: CollisionWorld, cluster: number): Uint8Array {
  return getClusterVis(world, cluster, DVIS_PHS);
}

/**
 * Original name: CM_SetAreaPortalState
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Opens or closes one areaportal and recomputes flood connectivity.
 */
export function CM_SetAreaPortalState(world: CollisionWorld, portalnum: number, open: boolean): void {
  if (portalnum > world.map_areaportals.length) {
    throw new Error("areaportal > numareaportals");
  }

  world.portalopen[portalnum] = open ? 1 : 0;
  FloodAreaConnections(world);
}

/**
 * Original name: CM_AreasConnected
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns whether two BSP areas are connected through currently open areaportals.
 */
export function CM_AreasConnected(world: CollisionWorld, area1: number, area2: number): boolean {
  if (world.map_noareas) {
    return true;
  }

  if (area1 >= world.numareas || area2 >= world.numareas) {
    throw new Error("area > numareas");
  }

  return world.map_areas[area1].floodnum === world.map_areas[area2].floodnum;
}

/**
 * Original name: CM_WriteAreaBits
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Writes the area connectivity bitset for the supplied source area into the caller buffer.
 */
export function CM_WriteAreaBits(world: CollisionWorld, buffer: Uint8Array, area: number): number {
  const bytes = (world.numareas + 7) >> 3;
  buffer.fill(0, 0, bytes);

  if (world.map_noareas) {
    buffer.fill(0xff, 0, bytes);
    return bytes;
  }

  const floodnum = world.map_areas[area]?.floodnum ?? 0;
  for (let index = 0; index < world.numareas; index += 1) {
    if (world.map_areas[index].floodnum === floodnum || area === 0) {
      buffer[index >> 3] |= 1 << (index & 7);
    }
  }

  return bytes;
}

/**
 * Original name: CM_WritePortalState
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Serializes the areaportal open-state array using Quake II `qboolean`-sized little-endian integers.
 */
export function CM_WritePortalState(world: CollisionWorld): Uint8Array {
  const bytes = new Uint8Array(PORTAL_STATE_BYTES);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  for (let index = 0; index < MAX_MAP_AREAPORTALS; index += 1) {
    view.setInt32(index * 4, world.portalopen[index] !== 0 ? 1 : 0, true);
  }

  return bytes;
}

/**
 * Original name: CM_ReadPortalState
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Restores the areaportal open-state array from Quake II savegame bytes and rebuilds flood connectivity.
 */
export function CM_ReadPortalState(world: CollisionWorld, bytes: Uint8Array): void {
  if (bytes.byteLength < PORTAL_STATE_BYTES) {
    throw new Error("CM_ReadPortalState: bad portal state size");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let index = 0; index < MAX_MAP_AREAPORTALS; index += 1) {
    world.portalopen[index] = view.getInt32(index * 4, true) !== 0 ? 1 : 0;
  }

  FloodAreaConnections(world);
}

/**
 * Original name: CM_HeadnodeVisible
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns whether any leaf under the supplied headnode is visible in the given cluster bitset.
 */
export function CM_HeadnodeVisible(world: CollisionWorld, nodenum: number, visbits: Uint8Array): boolean {
  if (nodenum < 0) {
    const leafnum = -1 - nodenum;
    const cluster = world.map_leafs[leafnum]?.cluster ?? -1;
    if (cluster === -1) {
      return false;
    }
    return (visbits[cluster >> 3] & (1 << (cluster & 7))) !== 0;
  }

  const node = world.map_nodes[nodenum];
  return CM_HeadnodeVisible(world, node.children[0], visbits) || CM_HeadnodeVisible(world, node.children[1], visbits);
}

/**
 * Original name: CM_PointLeafnum_r
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Walks the BSP node tree to find the leaf containing one point.
 */
function CM_PointLeafnum_r(world: CollisionWorld, point: vec3_t, num: number): number {
  let current = num;

  while (current >= 0) {
    const node = world.map_nodes[current];
    const plane = node.plane;
    let distance: number;
    if (plane.type < 3) {
      distance = point[plane.type] - plane.dist;
    } else {
      distance = DotProduct(point, plane.normal) - plane.dist;
    }

    current = distance < 0 ? node.children[1] : node.children[0];
  }

  return -1 - current;
}

/**
 * Original name: CM_TestBoxInBrush
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Tests whether a stationary AABB starts inside one brush.
 */
function CM_TestBoxInBrush(world: CollisionWorld, mins: vec3_t, maxs: vec3_t, point: vec3_t, trace: trace_t, brush: CollisionBrush): void {
  if (!brush.numsides) {
    return;
  }

  const ofs: vec3_t = [0, 0, 0];
  for (let sideIndex = 0; sideIndex < brush.numsides; sideIndex += 1) {
    const side = world.map_brushsides[brush.firstbrushside + sideIndex];
    const plane = side.plane;

    for (let axis = 0; axis < 3; axis += 1) {
      ofs[axis] = plane.normal[axis] < 0 ? maxs[axis] : mins[axis];
    }

    let dist = DotProduct(ofs, plane.normal);
    dist = plane.dist - dist;
    const d1 = DotProduct(point, plane.normal) - dist;

    if (d1 > 0) {
      return;
    }
  }

  trace.startsolid = true;
  trace.allsolid = true;
  trace.fraction = 0;
  trace.contents = brush.contents;
}

/**
 * Original name: CM_ClipBoxToBrush
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Clips one swept AABB against one convex brush and updates the trace when it is hit sooner.
 */
function CM_ClipBoxToBrush(
  world: CollisionWorld,
  mins: vec3_t,
  maxs: vec3_t,
  p1: vec3_t,
  p2: vec3_t,
  trace: trace_t,
  brush: CollisionBrush
): void {
  if (!brush.numsides) {
    return;
  }

  let enterfrac = -1;
  let leavefrac = 1;
  let clipplane: cplane_t | null = null;
  let leadside: CollisionBrushSide | null = null;
  let getout = false;
  let startout = false;
  const ofs: vec3_t = [0, 0, 0];

  for (let sideIndex = 0; sideIndex < brush.numsides; sideIndex += 1) {
    const side = world.map_brushsides[brush.firstbrushside + sideIndex];
    const plane = side.plane;

    for (let axis = 0; axis < 3; axis += 1) {
      ofs[axis] = plane.normal[axis] < 0 ? maxs[axis] : mins[axis];
    }

    let dist = DotProduct(ofs, plane.normal);
    dist = plane.dist - dist;

    const d1 = DotProduct(p1, plane.normal) - dist;
    const d2 = DotProduct(p2, plane.normal) - dist;

    if (d2 > 0) {
      getout = true;
    }
    if (d1 > 0) {
      startout = true;
    }

    if (d1 > 0 && d2 >= d1) {
      return;
    }
    if (d1 <= 0 && d2 <= 0) {
      continue;
    }

    if (d1 > d2) {
      const fraction = (d1 - DIST_EPSILON) / (d1 - d2);
      if (fraction > enterfrac) {
        enterfrac = fraction;
        clipplane = plane;
        leadside = side;
      }
    } else {
      const fraction = (d1 + DIST_EPSILON) / (d1 - d2);
      if (fraction < leavefrac) {
        leavefrac = fraction;
      }
    }
  }

  if (!startout) {
    trace.startsolid = true;
    trace.contents = brush.contents;
    if (!getout) {
      trace.allsolid = true;
    }
    return;
  }

  if (enterfrac < leavefrac && enterfrac > -1 && enterfrac < trace.fraction) {
    const clampedFraction = enterfrac < 0 ? 0 : enterfrac;
    trace.fraction = clampedFraction;
    trace.contents = brush.contents;
    if (clipplane) {
      trace.plane = {
        normal: [...clipplane.normal],
        dist: clipplane.dist,
        type: clipplane.type,
        signbits: clipplane.signbits,
        pad: [clipplane.pad[0], clipplane.pad[1]]
      };
    }
    trace.surface = leadside?.surface ?? world.nullsurface;
  }
}

/**
 * Original name: CM_TraceToLeaf
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Tests the swept AABB against every relevant brush referenced by one leaf.
 */
function CM_TraceToLeaf(world: CollisionWorld, leafnum: number, work: TraceWork): void {
  const leaf = world.map_leafs[leafnum];
  if ((leaf.contents & work.contents) === 0) {
    return;
  }

  for (let index = 0; index < leaf.numleafbrushes; index += 1) {
    const brushnum = world.map_leafbrushes[leaf.firstleafbrush + index] ?? -1;
    if (brushnum < 0 || work.checkedBrushes.has(brushnum)) {
      continue;
    }
    work.checkedBrushes.add(brushnum);

    const brush = world.map_brushes[brushnum];
    if (!brush || (brush.contents & work.contents) === 0) {
      continue;
    }

    CM_ClipBoxToBrush(world, work.mins, work.maxs, work.start, work.end, work.trace, brush);
    if (work.trace.fraction === 0) {
      return;
    }
  }
}

/**
 * Original name: CM_TestInLeaf
 * Source declaree: Quake-2-master/qcommon/cmodel.c
 * Category: Adapter
 * Purpose: Collect the leafs overlapped by a stationary box and test them for initial solid overlap.
 *
 * Constraints:
 * - Must stay deterministic and avoid duplicate brush testing.
 */
function CM_TestInLeafs(world: CollisionWorld, headnode: number, start: vec3_t, mins: vec3_t, maxs: vec3_t, work: TraceWork): void {
  const c1: vec3_t = [0, 0, 0];
  const c2: vec3_t = [0, 0, 0];
  VectorAdd(start, mins, c1);
  VectorAdd(start, maxs, c2);

  for (let index = 0; index < 3; index += 1) {
    c1[index] -= 1;
    c2[index] += 1;
  }

  const leafs: number[] = [];
  CM_BoxLeafnums_r(world, headnode, c1, c2, leafs, Number.MAX_SAFE_INTEGER, { topnode: -1 });
  for (const leafnum of leafs) {
    const leaf = world.map_leafs[leafnum];
    if ((leaf.contents & work.contents) === 0) {
      continue;
    }

    for (let brushIndex = 0; brushIndex < leaf.numleafbrushes; brushIndex += 1) {
      const brushnum = world.map_leafbrushes[leaf.firstleafbrush + brushIndex] ?? -1;
      if (brushnum < 0 || work.checkedBrushes.has(brushnum)) {
        continue;
      }
      work.checkedBrushes.add(brushnum);

      const brush = world.map_brushes[brushnum];
      if (!brush || (brush.contents & work.contents) === 0) {
        continue;
      }

      CM_TestBoxInBrush(world, mins, maxs, start, work.trace, brush);
      if (work.trace.allsolid) {
        return;
      }
    }
  }
}

/**
 * Original name: CM_BoxLeafnums_r
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Recursively collects leaf numbers intersected by an axis-aligned bounds box.
 *
 * Porting notes:
 * - Replaces the original file-static traversal state with explicit parameters.
 */
function CM_BoxLeafnums_r(
  world: CollisionWorld,
  nodenum: number,
  mins: vec3_t,
  maxs: vec3_t,
  output: number[],
  maxcount: number,
  state: { topnode: number }
): void {
  if (nodenum < 0) {
    if (output.length < maxcount) {
      output.push(-1 - nodenum);
    }
    return;
  }

  const node = world.map_nodes[nodenum];
  const plane = node.plane;
  let dist1: number;
  let dist2: number;

  if (plane.type < 3) {
    dist1 = mins[plane.type] - plane.dist;
    dist2 = maxs[plane.type] - plane.dist;
  } else {
    dist1 = distToPlaneCorner(mins, maxs, plane.normal, plane.dist, false);
    dist2 = distToPlaneCorner(mins, maxs, plane.normal, plane.dist, true);
  }

  if (dist1 >= 0 && dist2 >= 0) {
    CM_BoxLeafnums_r(world, node.children[0], mins, maxs, output, maxcount, state);
    return;
  }
  if (dist1 < 0 && dist2 < 0) {
    CM_BoxLeafnums_r(world, node.children[1], mins, maxs, output, maxcount, state);
    return;
  }

  if (state.topnode === -1) {
    state.topnode = nodenum;
  }

  CM_BoxLeafnums_r(world, node.children[0], mins, maxs, output, maxcount, state);
  CM_BoxLeafnums_r(world, node.children[1], mins, maxs, output, maxcount, state);
}

/**
 * Original name: CM_RecursiveHullCheck
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Walks the BSP recursively and clips the swept AABB against every relevant leaf.
 */
function CM_RecursiveHullCheck(
  world: CollisionWorld,
  work: TraceWork,
  num: number,
  p1f: number,
  p2f: number,
  p1: vec3_t,
  p2: vec3_t
): void {
  if (work.trace.fraction <= p1f) {
    return;
  }

  if (num < 0) {
    CM_TraceToLeaf(world, -1 - num, work);
    return;
  }

  const node = world.map_nodes[num];
  const plane = node.plane;
  let t1: number;
  let t2: number;
  let offset: number;

  if (plane.type < 3) {
    t1 = p1[plane.type] - plane.dist;
    t2 = p2[plane.type] - plane.dist;
    offset = work.extents[plane.type];
  } else {
    t1 = DotProduct(plane.normal, p1) - plane.dist;
    t2 = DotProduct(plane.normal, p2) - plane.dist;
    if (work.ispoint) {
      offset = 0;
    } else {
      offset =
        Math.abs(work.extents[0] * plane.normal[0]) +
        Math.abs(work.extents[1] * plane.normal[1]) +
        Math.abs(work.extents[2] * plane.normal[2]);
    }
  }

  if (t1 >= offset && t2 >= offset) {
    CM_RecursiveHullCheck(world, work, node.children[0], p1f, p2f, p1, p2);
    return;
  }
  if (t1 < -offset && t2 < -offset) {
    CM_RecursiveHullCheck(world, work, node.children[1], p1f, p2f, p1, p2);
    return;
  }

  let side: number;
  let frac: number;
  let frac2: number;

  if (t1 < t2) {
    const idist = 1 / (t1 - t2);
    side = 1;
    frac2 = (t1 + offset + DIST_EPSILON) * idist;
    frac = (t1 - offset + DIST_EPSILON) * idist;
  } else if (t1 > t2) {
    const idist = 1 / (t1 - t2);
    side = 0;
    frac2 = (t1 - offset - DIST_EPSILON) * idist;
    frac = (t1 + offset + DIST_EPSILON) * idist;
  } else {
    side = 0;
    frac = 1;
    frac2 = 0;
  }

  frac = clamp01(frac);
  const midf = p1f + (p2f - p1f) * frac;
  const mid: vec3_t = [0, 0, 0];
  for (let index = 0; index < 3; index += 1) {
    mid[index] = p1[index] + frac * (p2[index] - p1[index]);
  }

  CM_RecursiveHullCheck(world, work, node.children[side], p1f, midf, p1, mid);

  frac2 = clamp01(frac2);
  const midf2 = p1f + (p2f - p1f) * frac2;
  for (let index = 0; index < 3; index += 1) {
    mid[index] = p1[index] + frac2 * (p2[index] - p1[index]);
  }

  CM_RecursiveHullCheck(world, work, node.children[side ^ 1], midf2, p2f, mid, p2);
}

/**
 * Original name: N/A
 * Source declaree: N/A (BSP plane adapter)
 * Category: New
 * Purpose: Convert one BSP plane into the shared collision plane shape.
 */
function createPlane(plane: dplane_t): cplane_t {
  return {
    normal: [...plane.normal],
    dist: plane.dist,
    type: plane.type,
    signbits: computePlaneSignbits(plane.normal),
    pad: [0, 0]
  };
}

/**
 * Original name: N/A
 * Source declaree: N/A (BSP texinfo adapter)
 * Category: New
 * Purpose: Convert one BSP texinfo record into the shared collision/render surface shape.
 */
function createSurface(texinfo: texinfo_t): csurface_t {
  return {
    name: texinfo.texture,
    flags: texinfo.flags,
    value: texinfo.value
  };
}

/**
 * Original name: N/A
 * Source declaree: N/A (trace default plane helper)
 * Category: New
 * Purpose: Create a neutral default plane for miss traces.
 */
function createDefaultPlane(): cplane_t {
  return {
    normal: [0, 0, 0],
    dist: 0,
    type: 0,
    signbits: 0,
    pad: [0, 0]
  };
}

/**
 * Original name: N/A
 * Source declaree: N/A (plane signbits helper)
 * Category: New
 * Purpose: Compute Quake-style signbits for one plane normal.
 */
function computePlaneSignbits(normal: vec3_t): number {
  let signbits = 0;
  if (normal[0] < 0) {
    signbits |= 1;
  }
  if (normal[1] < 0) {
    signbits |= 2;
  }
  if (normal[2] < 0) {
    signbits |= 4;
  }
  return signbits;
}

/**
 * Original name: N/A
 * Source declaree: N/A (trace fraction helper)
 * Category: New
 * Purpose: Clamp one trace fraction into the inclusive `[0, 1]` interval.
 */
function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

/**
 * Original name: N/A
 * Source declaree: N/A (bounds-plane helper)
 * Category: New
 * Purpose: Compute conservative min/max distances from an AABB to a non-axial BSP plane.
 */
function distToPlaneCorner(mins: vec3_t, maxs: vec3_t, normal: vec3_t, dist: number, farthest: boolean): number {
  const corner: vec3_t = [0, 0, 0];
  for (let index = 0; index < 3; index += 1) {
    if (farthest) {
      corner[index] = normal[index] >= 0 ? maxs[index] : mins[index];
    } else {
      corner[index] = normal[index] >= 0 ? mins[index] : maxs[index];
    }
  }

  return DotProduct(corner, normal) - dist;
}

/**
 * Original name: N/A
 * Source declaree: N/A (model rotation helper)
 * Category: New
 * Purpose: Resolve whether one model-space collision query must account for entity rotation.
 */
function hasRotation(angles: vec3_t): boolean {
  return angles[0] !== 0 || angles[1] !== 0 || angles[2] !== 0;
}

/**
 * Original name: N/A
 * Source declaree: N/A (box hull accessor)
 * Category: New
 * Purpose: Resolve the synthetic box-model headnode used by the original transformed trace fast path.
 *
 * Constraints:
 * - Returns the dedicated temporary box hull headnode created during collision-world initialization.
 */
function getBoxHeadnode(world: CollisionWorld): number {
  return world.box_headnode;
}

/**
 * Original name: N/A
 * Source declaree: N/A (model rotation helper)
 * Category: New
 * Purpose: Rotate one point from world space into the local frame of a rotated BSP submodel.
 */
function rotateIntoModelFrame(input: vec3_t, angles: vec3_t, output: vec3_t): void {
  const basis = AngleVectors(angles);
  const temp: vec3_t = [input[0], input[1], input[2]];
  output[0] = DotProduct(temp, basis.forward);
  output[1] = -DotProduct(temp, basis.right);
  output[2] = DotProduct(temp, basis.up);
}

/**
 * Original name: N/A
 * Source declaree: N/A (model rotation helper)
 * Category: New
 * Purpose: Rotate one plane normal back out of a BSP submodel local frame.
 */
function rotateOutOfModelFrame(input: vec3_t, inverseAngles: vec3_t, output: vec3_t): void {
  const basis = AngleVectors(inverseAngles);
  const temp: vec3_t = [input[0], input[1], input[2]];
  output[0] = DotProduct(temp, basis.forward);
  output[1] = -DotProduct(temp, basis.right);
  output[2] = DotProduct(temp, basis.up);
}

/**
 * Original name: N/A
 * Source declaree: N/A (vector helper)
 * Category: New
 * Purpose: Subtract one vector from another without mutating the inputs.
 */
function subtractVec3(left: vec3_t, right: vec3_t): vec3_t {
  return [
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2]
  ];
}

/**
 * Original name: N/A
 * Source declaree: N/A (vector helper)
 * Category: New
 * Purpose: Negate one vector without mutating the source.
 */
function negateVec3(vector: vec3_t): vec3_t {
  return [-vector[0], -vector[1], -vector[2]];
}

/**
 * Original name: N/A
 * Source declaree: N/A (BSP area adapter)
 * Category: New
 * Purpose: Build one mutable collision area record from the parsed BSP area lump.
 */
function createArea(area: darea_t): CollisionArea {
  return {
    numareaportals: area.numareaportals,
    firstareaportal: area.firstareaportal,
    floodnum: 0,
    floodvalid: 0
  };
}

/**
 * Original name: CM_InitBoxHull
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Appends the synthetic BSP data used to represent temporary AABB hulls as a regular headnode.
 */
function CM_InitBoxHull(world: CollisionWorld): void {
  world.box_headnode = world.map_nodes.length;

  world.box_brush = world.map_brushes.length;
  world.map_brushes.push({
    contents: CONTENTS_MONSTER,
    numsides: 6,
    firstbrushside: world.map_brushsides.length
  });

  world.box_leaf = world.map_leafs.length;
  world.map_leafs.push({
    contents: CONTENTS_MONSTER,
    cluster: -1,
    area: 0,
    firstleafbrush: world.map_leafbrushes.length,
    numleafbrushes: 1
  });
  world.map_leafbrushes.push(world.box_brush);

  const planeOffset = world.map_planes.length;
  for (let index = 0; index < 12; index += 1) {
    world.map_planes.push(createDefaultPlane());
  }

  for (let index = 0; index < 6; index += 1) {
    const side = index & 1;

    world.map_brushsides.push({
      plane: world.map_planes[planeOffset + index * 2 + side],
      surface: world.nullsurface
    });

    world.map_nodes.push({
      plane: world.map_planes[planeOffset + index * 2],
      children: [
        side === 0 ? -1 - world.emptyleaf : (index !== 5 ? world.box_headnode + index + 1 : -1 - world.box_leaf),
        side === 1 ? -1 - world.emptyleaf : (index !== 5 ? world.box_headnode + index + 1 : -1 - world.box_leaf)
      ]
    });

    const positivePlane = world.map_planes[planeOffset + index * 2];
    positivePlane.type = Math.trunc(index / 2);
    positivePlane.signbits = 0;
    VectorClear(positivePlane.normal);
    positivePlane.normal[Math.trunc(index / 2)] = 1;

    const negativePlane = world.map_planes[planeOffset + index * 2 + 1];
    negativePlane.type = 3 + Math.trunc(index / 2);
    negativePlane.signbits = 0;
    VectorClear(negativePlane.normal);
    negativePlane.normal[Math.trunc(index / 2)] = -1;
  }
}

/**
 * Category: New
 * Original name: N/A
 * Source declaree: N/A (local visibility adapter)
 * Purpose: Decode the BSP visibility lump header into a structured offset table.
 */
function parseVisibilityLump(bytes: Uint8Array): dvis_t | null {
  if (bytes.length < 4) {
    return null;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numclusters = view.getInt32(0, true);
  if (numclusters < 0 || bytes.length < 4 + numclusters * 8) {
    return null;
  }

  const bitofs: Array<[number, number]> = [];
  for (let index = 0; index < numclusters; index += 1) {
    const offset = 4 + index * 8;
    bitofs.push([view.getInt32(offset, true), view.getInt32(offset + 4, true)]);
  }

  return { numclusters, bitofs };
}

/**
 * Category: New
 * Original name: N/A
 * Source declaree: N/A (local PVS/PHS adapter)
 * Purpose: Return one decompressed PVS/PHS row for the selected cluster and visibility kind.
 */
function getClusterVis(world: CollisionWorld, cluster: number, kind: 0 | 1): Uint8Array {
  const row = (world.numclusters + 7) >> 3;
  const output = new Uint8Array(row);

  if (cluster === -1) {
    return output;
  }

  if (!world.map_vis) {
    CM_DecompressVis(world, null, output);
    return output;
  }

  const offset = world.map_vis.bitofs[cluster]?.[kind] ?? -1;
  if (offset < 0 || offset >= world.map_visibility.length) {
    return output;
  }

  CM_DecompressVis(world, world.map_visibility.subarray(offset), output);
  return output;
}

/**
 * Original name: N/A
 * Source declaree: N/A (portal state reset helper)
 * Category: New
 * Purpose: Reinitialize the portal-open state exactly like the original cached-map fast path.
 */
function resetPortalState(world: CollisionWorld): void {
  world.portalopen.fill(0);
  FloodAreaConnections(world);
}

/**
 * Original name: N/A
 * Source declaree: N/A (empty map model helper)
 * Category: New
 * Purpose: Provide the zeroed `map_cmodels[0]` shape used when no map is currently loaded.
 */
function createEmptyCmodel(): cmodel_t {
  return {
    mins: [0, 0, 0],
    maxs: [0, 0, 0],
    origin: [0, 0, 0],
    headnode: 0
  };
}

/**
 * Original name: FloodArea_r
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Flood-fills one area through all currently open areaportals with the supplied flood number.
 */
function FloodArea_r(world: CollisionWorld, areaIndex: number, floodnum: number): void {
  const area = world.map_areas[areaIndex];
  if (!area) {
    return;
  }

  if (area.floodvalid === world.floodvalid) {
    if (area.floodnum === floodnum) {
      return;
    }
    throw new Error("FloodArea_r: reflooded");
  }

  area.floodnum = floodnum;
  area.floodvalid = world.floodvalid;

  for (let index = 0; index < area.numareaportals; index += 1) {
    const portal = world.map_areaportals[area.firstareaportal + index];
    if (!portal) {
      continue;
    }
    if (world.portalopen[portal.portalnum] !== 0) {
      FloodArea_r(world, portal.otherarea, floodnum);
    }
  }
}

/**
 * Original name: FloodAreaConnections
 * Source: qcommon/cmodel.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Rebuilds area flood connectivity for the currently loaded set of areaportals.
 */
function FloodAreaConnections(world: CollisionWorld): void {
  world.floodvalid += 1;
  let floodnum = 0;

  for (let index = 1; index < world.numareas; index += 1) {
    const area = world.map_areas[index];
    if (!area || area.floodvalid === world.floodvalid) {
      continue;
    }
    floodnum += 1;
    FloodArea_r(world, index, floodnum);
  }
}
