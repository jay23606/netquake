/**
 * File: qfiles.ts
 * Source: Quake II original / qcommon/qfiles.h
 * Purpose: Parse Quake II BSP map files and expose their core lumps for future rendering and collision ports.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Returns structured arrays instead of exposing raw packed C structs.
 * - Keeps visibility, lighting and entity lumps as typed byte/string payloads for later dedicated ports.
 *
 * Notes:
 * - This file is intended to stay close to the original BSP file declarations.
 */

import { getLittleFloat, getLittleLong, getLittleShort, getUnsignedByte } from "../../memory/src/binary-io.js";

export const IDBSPHEADER = (("P".charCodeAt(0) << 24) + ("S".charCodeAt(0) << 16) + ("B".charCodeAt(0) << 8) + "I".charCodeAt(0)) | 0;
export const BSPVERSION = 38;
export const HEADER_LUMPS = 19;
export const MAX_MAP_MODELS = 1024;
export const MAX_MAP_BRUSHES = 8192;
export const MAX_MAP_ENTITIES = 2048;
export const MAX_MAP_ENTSTRING = 0x40000;
export const MAX_MAP_TEXINFO = 8192;
export const MAX_MAP_AREAS = 256;
export const MAX_MAP_AREAPORTALS = 1024;
export const MAX_MAP_PLANES = 65536;
export const MAX_MAP_NODES = 65536;
export const MAX_MAP_BRUSHSIDES = 65536;
export const MAX_MAP_LEAFS = 65536;
export const MAX_MAP_VERTS = 65536;
export const MAX_MAP_FACES = 65536;
export const MAX_MAP_LEAFFACES = 65536;
export const MAX_MAP_LEAFBRUSHES = 65536;
export const MAX_MAP_PORTALS = 65536;
export const MAX_MAP_EDGES = 128000;
export const MAX_MAP_SURFEDGES = 256000;
export const MAX_MAP_LIGHTING = 0x200000;
export const MAX_MAP_VISIBILITY = 0x100000;
export const MAX_KEY = 32;
export const MAX_VALUE = 1024;
export const LUMP_ENTITIES = 0;
export const LUMP_PLANES = 1;
export const LUMP_VERTEXES = 2;
export const LUMP_VISIBILITY = 3;
export const LUMP_NODES = 4;
export const LUMP_TEXINFO = 5;
export const LUMP_FACES = 6;
export const LUMP_LIGHTING = 7;
export const LUMP_LEAFS = 8;
export const LUMP_LEAFFACES = 9;
export const LUMP_LEAFBRUSHES = 10;
export const LUMP_EDGES = 11;
export const LUMP_SURFEDGES = 12;
export const LUMP_MODELS = 13;
export const LUMP_BRUSHES = 14;
export const LUMP_BRUSHSIDES = 15;
export const LUMP_POP = 16;
export const LUMP_AREAS = 17;
export const LUMP_AREAPORTALS = 18;
export const PLANE_X = 0;
export const PLANE_Y = 1;
export const PLANE_Z = 2;
export const PLANE_ANYX = 3;
export const PLANE_ANYY = 4;
export const PLANE_ANYZ = 5;
export const CONTENTS_SOLID = 1;
export const CONTENTS_WINDOW = 2;
export const CONTENTS_AUX = 4;
export const CONTENTS_LAVA = 8;
export const CONTENTS_SLIME = 16;
export const CONTENTS_WATER = 32;
export const CONTENTS_MIST = 64;
export const LAST_VISIBLE_CONTENTS = 64;
export const CONTENTS_AREAPORTAL = 0x8000;
export const CONTENTS_PLAYERCLIP = 0x10000;
export const CONTENTS_MONSTERCLIP = 0x20000;
export const CONTENTS_CURRENT_0 = 0x40000;
export const CONTENTS_CURRENT_90 = 0x80000;
export const CONTENTS_CURRENT_180 = 0x100000;
export const CONTENTS_CURRENT_270 = 0x200000;
export const CONTENTS_CURRENT_UP = 0x400000;
export const CONTENTS_CURRENT_DOWN = 0x800000;
export const CONTENTS_ORIGIN = 0x1000000;
export const CONTENTS_MONSTER = 0x2000000;
export const CONTENTS_DEADMONSTER = 0x4000000;
export const CONTENTS_DETAIL = 0x8000000;
export const CONTENTS_TRANSLUCENT = 0x10000000;
export const CONTENTS_LADDER = 0x20000000;
export const SURF_LIGHT = 0x1;
export const SURF_SLICK = 0x2;
export const SURF_SKY = 0x4;
export const SURF_WARP = 0x8;
export const SURF_TRANS33 = 0x10;
export const SURF_TRANS66 = 0x20;
export const SURF_FLOWING = 0x40;
export const SURF_NODRAW = 0x80;
export const MAXLIGHTMAPS = 4;
export const ANGLE_UP = -1;
export const ANGLE_DOWN = -2;
export const DVIS_PVS = 0;
export const DVIS_PHS = 1;

const LUMP_T_SIZE = 8;
const DHEADER_SIZE = 8 + HEADER_LUMPS * LUMP_T_SIZE;
const DMODEL_SIZE = 48;
const DVERTEX_SIZE = 12;
const DPLANE_SIZE = 20;
const DNODE_SIZE = 28;
const TEXINFO_SIZE = 76;
const DEDGE_SIZE = 4;
const DFACE_SIZE = 20;
const DLEAF_SIZE = 28;
const DBRUSHSIDE_SIZE = 4;
const DBRUSH_SIZE = 12;
const DAREA_SIZE = 8;
const DAREAPORTAL_SIZE = 8;

/**
 * Original name: lump_t
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 */
export interface lump_t {
  fileofs: number;
  filelen: number;
}

/**
 * Original name: dheader_t
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 */
export interface dheader_t {
  ident: number;
  version: number;
  lumps: lump_t[];
}

/**
 * Original name: dmodel_t
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 */
export interface dmodel_t {
  mins: [number, number, number];
  maxs: [number, number, number];
  origin: [number, number, number];
  headnode: number;
  firstface: number;
  numfaces: number;
}

/**
 * Original name: dvertex_t
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 */
export interface dvertex_t {
  point: [number, number, number];
}

/**
 * Original name: dplane_t
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 */
export interface dplane_t {
  normal: [number, number, number];
  dist: number;
  type: number;
}

/**
 * Original name: dnode_t
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 */
export interface dnode_t {
  planenum: number;
  children: [number, number];
  mins: [number, number, number];
  maxs: [number, number, number];
  firstface: number;
  numfaces: number;
}

/**
 * Original name: texinfo_s
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 */
export interface texinfo_t {
  vecs: [[number, number, number, number], [number, number, number, number]];
  flags: number;
  value: number;
  texture: string;
  nexttexinfo: number;
}

/**
 * Original name: dedge_t
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 */
export interface dedge_t {
  v: [number, number];
}

/**
 * Original name: dface_t
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 */
export interface dface_t {
  planenum: number;
  side: number;
  firstedge: number;
  numedges: number;
  texinfo: number;
  styles: [number, number, number, number];
  lightofs: number;
}

/**
 * Original name: dleaf_t
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 */
export interface dleaf_t {
  contents: number;
  cluster: number;
  area: number;
  mins: [number, number, number];
  maxs: [number, number, number];
  firstleafface: number;
  numleaffaces: number;
  firstleafbrush: number;
  numleafbrushes: number;
}

/**
 * Original name: dbrushside_t
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 */
export interface dbrushside_t {
  planenum: number;
  texinfo: number;
}

/**
 * Original name: dbrush_t
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 */
export interface dbrush_t {
  firstside: number;
  numsides: number;
  contents: number;
}

/**
 * Original name: dareaportal_t
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 */
export interface dareaportal_t {
  portalnum: number;
  otherarea: number;
}

/**
 * Original name: darea_t
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 */
export interface darea_t {
  numareaportals: number;
  firstareaportal: number;
}

/**
 * Original name: dvis_t
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Represents the visibility lump header storing per-cluster PVS/PHS offsets.
 *
 * Porting notes:
 * - Keeps the offset pairs in nested arrays instead of a fixed C matrix.
 */
export interface dvis_t {
  numclusters: number;
  bitofs: Array<[number, number]>;
}

/**
 * Original name: N/A
 * Source: N/A (BSP entity model)
 * Category: New
 * Purpose: Represent one parsed Quake II BSP entity from the textual entity lump.
 *
 * Constraints:
 * - Must preserve all original key/value pairs.
 */
export interface BspEntity {
  properties: Record<string, string>;
}

/**
 * Original name: N/A
 * Source: N/A (BSP spawn helper)
 * Category: New
 * Purpose: Represent a first extracted Quake II player spawn point.
 *
 * Constraints:
 * - Must keep origin and angle separate for future camera and gameplay integration.
 */
export interface BspSpawnPoint {
  origin: [number, number, number];
  angle: number;
}

/**
 * Original name: N/A
 * Source: N/A (BSP parser result)
 * Category: New
 * Purpose: Represent the first parsed BSP data needed by renderer and collision bridge layers.
 *
 * Constraints:
 * - Must preserve lump ordering and raw payloads where later subsystems depend on exact bytes.
 */
export interface BspMap {
  header: dheader_t;
  entities: string;
  parsedEntities: BspEntity[];
  planes: dplane_t[];
  vertexes: dvertex_t[];
  visibility: Uint8Array;
  nodes: dnode_t[];
  texinfo: texinfo_t[];
  faces: dface_t[];
  lighting: Uint8Array;
  leafs: dleaf_t[];
  leaffaces: Int16Array;
  leafbrushes: Int16Array;
  edges: dedge_t[];
  surfedges: Int32Array;
  models: dmodel_t[];
  brushes: dbrush_t[];
  brushsides: dbrushside_t[];
  areas: darea_t[];
  areaportals: dareaportal_t[];
}

/**
 * Original name: N/A
 * Source: N/A (BSP parser facade)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Behavior:
 * - Validates and parses the core lumps of a Quake II BSP file.
 *
 * Porting notes:
 * - Keeps some lumps as raw bytes or primitive arrays until dedicated higher-level ports are added.
 */
export function parseBsp(bytes: Uint8Array, path?: string): BspMap {
  if (bytes.byteLength < DHEADER_SIZE) {
    throw new Error(`${path ?? "bsp"} is too small to contain a BSP header`);
  }

  const header = readBspHeader(bytes);
  validateBspHeader(header, bytes, path);
  const entities = decodeCStringBytes(readLumpBytes(bytes, header, LUMP_ENTITIES));

  return {
    header,
    entities,
    parsedEntities: parseEntityLump(entities),
    planes: readPlanes(bytes, header),
    vertexes: readVertexes(bytes, header),
    visibility: readLumpBytes(bytes, header, LUMP_VISIBILITY),
    nodes: readNodes(bytes, header),
    texinfo: readTexInfo(bytes, header),
    faces: readFaces(bytes, header),
    lighting: readLumpBytes(bytes, header, LUMP_LIGHTING),
    leafs: readLeafs(bytes, header),
    leaffaces: readShortLump(bytes, header, LUMP_LEAFFACES),
    leafbrushes: readShortLump(bytes, header, LUMP_LEAFBRUSHES),
    edges: readEdges(bytes, header),
    surfedges: readLongLump(bytes, header, LUMP_SURFEDGES),
    models: readModels(bytes, header),
    brushes: readBrushes(bytes, header),
    brushsides: readBrushSides(bytes, header),
    areas: readAreas(bytes, header),
    areaportals: readAreaPortals(bytes, header)
  };
}

/**
 * Original name: N/A
 * Source: N/A (BSP entity parser)
 * Category: New
 * Purpose: Parse the textual BSP entity lump into structured key/value dictionaries.
 *
 * Constraints:
 * - Must tolerate Quake-style quoted tokens and ignore malformed tails safely.
 */
export function parseEntityLump(text: string): BspEntity[] {
  const entities: BspEntity[] = [];
  let index = 0;

  while (index < text.length) {
    index = skipEntityWhitespace(text, index);
    if (index >= text.length) {
      break;
    }

    if (text[index] !== "{") {
      index += 1;
      continue;
    }

    index += 1;
    const properties: Record<string, string> = {};

    while (index < text.length) {
      index = skipEntityWhitespace(text, index);
      if (index >= text.length) {
        break;
      }

      if (text[index] === "}") {
        index += 1;
        break;
      }

      const keyToken = readQuotedToken(text, index);
      if (keyToken === null) {
        index += 1;
        continue;
      }

      index = keyToken.nextIndex;
      index = skipEntityWhitespace(text, index);

      const valueToken = readQuotedToken(text, index);
      if (valueToken === null) {
        break;
      }

      properties[keyToken.value] = valueToken.value;
      index = valueToken.nextIndex;
    }

    entities.push({ properties });
  }

  return entities;
}

/**
 * Original name: N/A
 * Source: N/A (BSP entity helper)
 * Category: New
 * Purpose: Find BSP entities with one exact classname.
 *
 * Constraints:
 * - Must preserve original entity ordering.
 */
export function findEntitiesByClassname(map: BspMap, classname: string): BspEntity[] {
  return map.parsedEntities.filter((entity) => entity.properties.classname === classname);
}

/**
 * Original name: N/A
 * Source: N/A (BSP spawn helper)
 * Category: New
 * Purpose: Extract the primary single-player spawn point from a BSP map.
 *
 * Constraints:
 * - Must return null when the map has no valid spawn origin.
 * - Must mirror the original Quake II single-player fallback order:
 *   prefer an untargeted `info_player_start` when no explicit spawnpoint is requested,
 *   otherwise match the requested targetname, then fall back to any valid start.
 */
export function findPrimarySpawnPoint(map: BspMap, spawnpoint = ""): BspSpawnPoint | null {
  let fallback: BspSpawnPoint | null = null;

  for (const entity of map.parsedEntities) {
    if (entity.properties.classname !== "info_player_start") {
      continue;
    }

    const origin = parseEntityOrigin(entity.properties.origin);
    if (origin === null) {
      continue;
    }

    const candidate: BspSpawnPoint = {
      origin,
      angle: parseEntityAngle(entity.properties.angle)
    };

    if (fallback === null) {
      fallback = candidate;
    }

    const targetname = entity.properties.targetname ?? "";
    if (!spawnpoint) {
      if (!targetname) {
        return candidate;
      }
      continue;
    }

    if (targetname.localeCompare(spawnpoint, undefined, { sensitivity: "accent" }) === 0) {
      return candidate;
    }
  }

  return fallback;
}

/**
 * Original name: N/A
 * Source: N/A (BSP entity helper)
 * Category: New
 * Purpose: Extract an entity origin from one parsed BSP entity.
 *
 * Constraints:
 * - Must return null when the entity has no valid origin field.
 */
export function getEntityOrigin(entity: BspEntity): [number, number, number] | null {
  return parseEntityOrigin(entity.properties.origin);
}

/**
 * Original name: N/A
 * Source: N/A (BSP entity helper)
 * Category: New
 * Purpose: Extract the yaw angle commonly used by Quake entities.
 *
 * Constraints:
 * - Must support both `angle` and `angles` fields with a zero fallback.
 */
export function getEntityYaw(entity: BspEntity): number {
  if (entity.properties.angle) {
    return parseEntityAngle(entity.properties.angle);
  }

  if (entity.properties.angles) {
    const parts = entity.properties.angles.trim().split(/\s+/);
    if (parts.length === 3) {
      const parsed = Number.parseFloat(parts[1]);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
  }

  return 0;
}

/**
 * Original name: N/A
 * Source: N/A (BSP parser helper)
 * Category: New
 * Purpose: Read the BSP header and its lump table.
 *
 * Constraints:
 * - Must preserve the original lump order.
 */
function readBspHeader(bytes: Uint8Array): dheader_t {
  const lumps: lump_t[] = [];

  for (let index = 0; index < HEADER_LUMPS; index += 1) {
    const offset = 8 + index * LUMP_T_SIZE;
    lumps.push({
      fileofs: getLittleLong(bytes, offset),
      filelen: getLittleLong(bytes, offset + 4)
    });
  }

  return {
    ident: getLittleLong(bytes, 0),
    version: getLittleLong(bytes, 4),
    lumps
  };
}

/**
 * Original name: N/A
 * Source: N/A (BSP parser helper)
 * Category: New
 * Purpose: Validate the BSP header and lump bounds.
 *
 * Constraints:
 * - Must reject wrong ids, versions and out-of-bounds lumps.
 */
function validateBspHeader(header: dheader_t, bytes: Uint8Array, path?: string): void {
  if (header.ident !== IDBSPHEADER) {
    throw new Error(`${path ?? "bsp"} is not a Quake II BSP file`);
  }

  if (header.version !== BSPVERSION) {
    throw new Error(`${path ?? "bsp"} has unsupported BSP version ${header.version}`);
  }

  for (let index = 0; index < header.lumps.length; index += 1) {
    const lump = header.lumps[index];
    if (lump.fileofs < 0 || lump.filelen < 0 || lump.fileofs + lump.filelen > bytes.byteLength) {
      throw new Error(`${path ?? "bsp"} has an out-of-bounds lump ${index}`);
    }
  }
}

/**
 * Original name: N/A
 * Source: N/A (BSP parser helper)
 * Category: New
 * Purpose: Read raw bytes for one BSP lump.
 *
 * Constraints:
 * - Must return an isolated copy to avoid accidental mutation.
 */
function readLumpBytes(bytes: Uint8Array, header: dheader_t, lumpIndex: number): Uint8Array {
  const lump = header.lumps[lumpIndex];
  return bytes.slice(lump.fileofs, lump.fileofs + lump.filelen);
}

/**
 * Original name: N/A
 * Source: N/A (BSP parser helper)
 * Category: New
 * Purpose: Read the BSP model table.
 *
 * Constraints:
 * - Must preserve original ordering.
 */
function readModels(bytes: Uint8Array, header: dheader_t): dmodel_t[] {
  return readStructArray(bytes, header.lumps[LUMP_MODELS], DMODEL_SIZE, (offset) => ({
    mins: [getLittleFloat(bytes, offset), getLittleFloat(bytes, offset + 4), getLittleFloat(bytes, offset + 8)],
    maxs: [getLittleFloat(bytes, offset + 12), getLittleFloat(bytes, offset + 16), getLittleFloat(bytes, offset + 20)],
    origin: [getLittleFloat(bytes, offset + 24), getLittleFloat(bytes, offset + 28), getLittleFloat(bytes, offset + 32)],
    headnode: getLittleLong(bytes, offset + 36),
    firstface: getLittleLong(bytes, offset + 40),
    numfaces: getLittleLong(bytes, offset + 44)
  }));
}

/**
 * Original name: N/A
 * Source: N/A (BSP parser helper)
 * Category: New
 * Purpose: Read the BSP vertex table.
 *
 * Constraints:
 * - Must preserve original ordering.
 */
function readVertexes(bytes: Uint8Array, header: dheader_t): dvertex_t[] {
  return readStructArray(bytes, header.lumps[LUMP_VERTEXES], DVERTEX_SIZE, (offset) => ({
    point: [getLittleFloat(bytes, offset), getLittleFloat(bytes, offset + 4), getLittleFloat(bytes, offset + 8)]
  }));
}

/**
 * Original name: N/A
 * Source: N/A (BSP parser helper)
 * Category: New
 * Purpose: Read the BSP plane table.
 *
 * Constraints:
 * - Must preserve original ordering.
 */
function readPlanes(bytes: Uint8Array, header: dheader_t): dplane_t[] {
  return readStructArray(bytes, header.lumps[LUMP_PLANES], DPLANE_SIZE, (offset) => ({
    normal: [getLittleFloat(bytes, offset), getLittleFloat(bytes, offset + 4), getLittleFloat(bytes, offset + 8)],
    dist: getLittleFloat(bytes, offset + 12),
    type: getLittleLong(bytes, offset + 16)
  }));
}

/**
 * Original name: N/A
 * Source: N/A (BSP parser helper)
 * Category: New
 * Purpose: Read the BSP node table.
 *
 * Constraints:
 * - Must preserve original ordering.
 */
function readNodes(bytes: Uint8Array, header: dheader_t): dnode_t[] {
  return readStructArray(bytes, header.lumps[LUMP_NODES], DNODE_SIZE, (offset) => ({
    planenum: getLittleLong(bytes, offset),
    children: [getLittleLong(bytes, offset + 4), getLittleLong(bytes, offset + 8)],
    mins: [getLittleShort(bytes, offset + 12), getLittleShort(bytes, offset + 14), getLittleShort(bytes, offset + 16)],
    maxs: [getLittleShort(bytes, offset + 18), getLittleShort(bytes, offset + 20), getLittleShort(bytes, offset + 22)],
    firstface: getUnsignedShort(bytes, offset + 24),
    numfaces: getUnsignedShort(bytes, offset + 26)
  }));
}

/**
 * Original name: N/A
 * Source: N/A (BSP parser helper)
 * Category: New
 * Purpose: Read the BSP texinfo table.
 *
 * Constraints:
 * - Must preserve original ordering.
 */
function readTexInfo(bytes: Uint8Array, header: dheader_t): texinfo_t[] {
  return readStructArray(bytes, header.lumps[LUMP_TEXINFO], TEXINFO_SIZE, (offset) => ({
    vecs: [
      [getLittleFloat(bytes, offset), getLittleFloat(bytes, offset + 4), getLittleFloat(bytes, offset + 8), getLittleFloat(bytes, offset + 12)],
      [getLittleFloat(bytes, offset + 16), getLittleFloat(bytes, offset + 20), getLittleFloat(bytes, offset + 24), getLittleFloat(bytes, offset + 28)]
    ],
    flags: getLittleLong(bytes, offset + 32),
    value: getLittleLong(bytes, offset + 36),
    texture: decodeFixedCString(bytes.subarray(offset + 40, offset + 72)),
    nexttexinfo: getLittleLong(bytes, offset + 72)
  }));
}

/**
 * Original name: N/A
 * Source: N/A (BSP parser helper)
 * Category: New
 * Purpose: Read the BSP edge table.
 *
 * Constraints:
 * - Must preserve original ordering.
 */
function readEdges(bytes: Uint8Array, header: dheader_t): dedge_t[] {
  return readStructArray(bytes, header.lumps[LUMP_EDGES], DEDGE_SIZE, (offset) => ({
    v: [getUnsignedShort(bytes, offset), getUnsignedShort(bytes, offset + 2)]
  }));
}

/**
 * Original name: N/A
 * Source: N/A (BSP parser helper)
 * Category: New
 * Purpose: Read the BSP face table.
 *
 * Constraints:
 * - Must preserve original ordering.
 */
function readFaces(bytes: Uint8Array, header: dheader_t): dface_t[] {
  return readStructArray(bytes, header.lumps[LUMP_FACES], DFACE_SIZE, (offset) => ({
    planenum: getUnsignedShort(bytes, offset),
    side: getLittleShort(bytes, offset + 2),
    firstedge: getLittleLong(bytes, offset + 4),
    numedges: getLittleShort(bytes, offset + 8),
    texinfo: getLittleShort(bytes, offset + 10),
    styles: [
      getUnsignedByte(bytes, offset + 12),
      getUnsignedByte(bytes, offset + 13),
      getUnsignedByte(bytes, offset + 14),
      getUnsignedByte(bytes, offset + 15)
    ],
    lightofs: getLittleLong(bytes, offset + 16)
  }));
}

/**
 * Original name: N/A
 * Source: N/A (BSP parser helper)
 * Category: New
 * Purpose: Read the BSP leaf table.
 *
 * Constraints:
 * - Must preserve original ordering.
 */
function readLeafs(bytes: Uint8Array, header: dheader_t): dleaf_t[] {
  return readStructArray(bytes, header.lumps[LUMP_LEAFS], DLEAF_SIZE, (offset) => ({
    contents: getLittleLong(bytes, offset),
    cluster: getLittleShort(bytes, offset + 4),
    area: getLittleShort(bytes, offset + 6),
    mins: [getLittleShort(bytes, offset + 8), getLittleShort(bytes, offset + 10), getLittleShort(bytes, offset + 12)],
    maxs: [getLittleShort(bytes, offset + 14), getLittleShort(bytes, offset + 16), getLittleShort(bytes, offset + 18)],
    firstleafface: getUnsignedShort(bytes, offset + 20),
    numleaffaces: getUnsignedShort(bytes, offset + 22),
    firstleafbrush: getUnsignedShort(bytes, offset + 24),
    numleafbrushes: getUnsignedShort(bytes, offset + 26)
  }));
}

/**
 * Original name: N/A
 * Source: N/A (BSP parser helper)
 * Category: New
 * Purpose: Read the BSP brush side table.
 *
 * Constraints:
 * - Must preserve original ordering.
 */
function readBrushSides(bytes: Uint8Array, header: dheader_t): dbrushside_t[] {
  return readStructArray(bytes, header.lumps[LUMP_BRUSHSIDES], DBRUSHSIDE_SIZE, (offset) => ({
    planenum: getUnsignedShort(bytes, offset),
    texinfo: getLittleShort(bytes, offset + 2)
  }));
}

/**
 * Original name: N/A
 * Source: N/A (BSP parser helper)
 * Category: New
 * Purpose: Read the BSP brush table.
 *
 * Constraints:
 * - Must preserve original ordering.
 */
function readBrushes(bytes: Uint8Array, header: dheader_t): dbrush_t[] {
  return readStructArray(bytes, header.lumps[LUMP_BRUSHES], DBRUSH_SIZE, (offset) => ({
    firstside: getLittleLong(bytes, offset),
    numsides: getLittleLong(bytes, offset + 4),
    contents: getLittleLong(bytes, offset + 8)
  }));
}

/**
 * Original name: N/A
 * Source: N/A (BSP parser helper)
 * Category: New
 * Purpose: Read the BSP area table.
 *
 * Constraints:
 * - Must preserve original ordering.
 */
function readAreas(bytes: Uint8Array, header: dheader_t): darea_t[] {
  return readStructArray(bytes, header.lumps[LUMP_AREAS], DAREA_SIZE, (offset) => ({
    numareaportals: getLittleLong(bytes, offset),
    firstareaportal: getLittleLong(bytes, offset + 4)
  }));
}

/**
 * Original name: N/A
 * Source: N/A (BSP parser helper)
 * Category: New
 * Purpose: Read the BSP areaportal table.
 *
 * Constraints:
 * - Must preserve original ordering.
 */
function readAreaPortals(bytes: Uint8Array, header: dheader_t): dareaportal_t[] {
  return readStructArray(bytes, header.lumps[LUMP_AREAPORTALS], DAREAPORTAL_SIZE, (offset) => ({
    portalnum: getLittleLong(bytes, offset),
    otherarea: getLittleLong(bytes, offset + 4)
  }));
}

/**
 * Original name: N/A
 * Source: N/A (BSP parser helper)
 * Category: New
 * Purpose: Read a signed short lump into a typed array.
 *
 * Constraints:
 * - Must preserve lump ordering exactly.
 */
function readShortLump(bytes: Uint8Array, header: dheader_t, lumpIndex: number): Int16Array {
  const lump = header.lumps[lumpIndex];
  if ((lump.filelen % 2) !== 0) {
    throw new Error(`BSP lump ${lumpIndex} has invalid short alignment`);
  }

  const values = new Int16Array(lump.filelen / 2);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = getLittleShort(bytes, lump.fileofs + index * 2);
  }
  return values;
}

/**
 * Original name: N/A
 * Source: N/A (BSP parser helper)
 * Category: New
 * Purpose: Read a signed long lump into a typed array.
 *
 * Constraints:
 * - Must preserve lump ordering exactly.
 */
function readLongLump(bytes: Uint8Array, header: dheader_t, lumpIndex: number): Int32Array {
  const lump = header.lumps[lumpIndex];
  if ((lump.filelen % 4) !== 0) {
    throw new Error(`BSP lump ${lumpIndex} has invalid long alignment`);
  }

  const values = new Int32Array(lump.filelen / 4);
  for (let index = 0; index < values.length; index += 1) {
    values[index] = getLittleLong(bytes, lump.fileofs + index * 4);
  }
  return values;
}

/**
 * Original name: N/A
 * Source: N/A (BSP parser helper)
 * Category: New
 * Purpose: Read one BSP lump as a struct array with fixed record size.
 *
 * Constraints:
 * - Must reject invalid lump alignment.
 */
function readStructArray<T>(bytes: Uint8Array, lump: lump_t, recordSize: number, reader: (offset: number) => T): T[] {
  if ((lump.filelen % recordSize) !== 0) {
    throw new Error(`BSP lump at offset ${lump.fileofs} is not aligned to record size ${recordSize}`);
  }

  const values: T[] = [];
  const count = lump.filelen / recordSize;

  for (let index = 0; index < count; index += 1) {
    values.push(reader(lump.fileofs + index * recordSize));
  }

  return values;
}

/**
 * Original name: N/A
 * Source: N/A (BSP string decoder)
 * Category: New
 * Purpose: Decode a BSP entity string or other lump payload without UTF-8 reinterpretation.
 *
 * Constraints:
 * - Must preserve low 8-bit bytes.
 */
function decodeCStringBytes(bytes: Uint8Array): string {
  let result = "";

  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0) {
      break;
    }
    result += String.fromCharCode(bytes[index]);
  }

  return result;
}

/**
 * Original name: N/A
 * Source: N/A (BSP string decoder)
 * Category: New
 * Purpose: Decode a fixed-width null-terminated Quake C string field.
 *
 * Constraints:
 * - Must stop at the first zero byte.
 */
function decodeFixedCString(bytes: Uint8Array): string {
  let end = bytes.indexOf(0);
  if (end === -1) {
    end = bytes.length;
  }

  let result = "";
  for (let index = 0; index < end; index += 1) {
    result += String.fromCharCode(bytes[index]);
  }
  return result;
}

/**
 * Original name: N/A
 * Source: N/A (binary reader helper)
 * Category: New
 * Purpose: Read one unsigned little-endian short.
 *
 * Constraints:
 * - Must preserve 16-bit unsigned semantics.
 */
function getUnsignedShort(buffer: Uint8Array, offset: number): number {
  return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getUint16(offset, true);
}

/**
 * Original name: N/A
 * Source: N/A (BSP entity parser)
 * Category: New
 * Purpose: Skip insignificant whitespace while parsing the textual BSP entity lump.
 *
 * Constraints:
 * - Must preserve parser forward progress.
 */
function skipEntityWhitespace(text: string, index: number): number {
  while (index < text.length && text[index] <= " ") {
    index += 1;
  }

  return index;
}

/**
 * Original name: N/A
 * Source: N/A (BSP entity parser)
 * Category: New
 * Purpose: Read one Quake-style quoted token from the BSP entity lump.
 *
 * Constraints:
 * - Must return null when the next token is not a quoted string.
 */
function readQuotedToken(text: string, index: number): { value: string; nextIndex: number } | null {
  if (index >= text.length || text[index] !== "\"") {
    return null;
  }

  index += 1;
  let value = "";

  while (index < text.length && text[index] !== "\"") {
    value += text[index];
    index += 1;
  }

  if (index < text.length && text[index] === "\"") {
    index += 1;
  }

  return { value, nextIndex: index };
}

/**
 * Original name: N/A
 * Source: N/A (BSP entity helper)
 * Category: New
 * Purpose: Parse a Quake entity origin string into a numeric vector.
 *
 * Constraints:
 * - Must return null for malformed vectors.
 */
function parseEntityOrigin(value: string | undefined): [number, number, number] | null {
  if (!value) {
    return null;
  }

  const parts = value.trim().split(/\s+/);
  if (parts.length !== 3) {
    return null;
  }

  const parsed = parts.map((part) => Number.parseFloat(part));
  if (parsed.some((part) => Number.isNaN(part))) {
    return null;
  }

  return [parsed[0], parsed[1], parsed[2]];
}

/**
 * Original name: N/A
 * Source: N/A (BSP entity helper)
 * Category: New
 * Purpose: Parse a Quake entity angle string with the usual default fallback.
 *
 * Constraints:
 * - Must return zero when the angle is absent or invalid.
 */
function parseEntityAngle(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
