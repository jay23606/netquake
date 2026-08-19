/**
 * File: q_shared.ts
 * Purpose: Expose Quake II binary format parsers.
 *
 * This file is not a direct source port.
 * It is a package entry point for binary format modules.
 *
 * Dependencies:
 * - packages/formats/src/pak.ts
 */

export {
  ANGLE_DOWN,
  ANGLE_UP,
  BSPVERSION,
  CONTENTS_AREAPORTAL,
  CONTENTS_AUX,
  CONTENTS_CURRENT_0,
  CONTENTS_CURRENT_90,
  CONTENTS_CURRENT_180,
  CONTENTS_CURRENT_270,
  CONTENTS_CURRENT_DOWN,
  CONTENTS_CURRENT_UP,
  CONTENTS_DEADMONSTER,
  CONTENTS_DETAIL,
  CONTENTS_LADDER,
  CONTENTS_LAVA,
  CONTENTS_MIST,
  CONTENTS_MONSTER,
  CONTENTS_MONSTERCLIP,
  CONTENTS_ORIGIN,
  CONTENTS_PLAYERCLIP,
  CONTENTS_SLIME,
  CONTENTS_SOLID,
  CONTENTS_TRANSLUCENT,
  CONTENTS_WATER,
  CONTENTS_WINDOW,
  DVIS_PHS,
  DVIS_PVS,
  HEADER_LUMPS,
  IDBSPHEADER,
  LAST_VISIBLE_CONTENTS,
  LUMP_AREAPORTALS,
  LUMP_AREAS,
  LUMP_BRUSHES,
  LUMP_BRUSHSIDES,
  LUMP_EDGES,
  LUMP_ENTITIES,
  LUMP_FACES,
  LUMP_LEAFBRUSHES,
  LUMP_LEAFFACES,
  LUMP_LEAFS,
  LUMP_LIGHTING,
  LUMP_MODELS,
  LUMP_NODES,
  LUMP_PLANES,
  LUMP_POP,
  LUMP_SURFEDGES,
  LUMP_TEXINFO,
  LUMP_VERTEXES,
  LUMP_VISIBILITY,
  MAXLIGHTMAPS,
  MAX_KEY,
  MAX_MAP_AREAPORTALS,
  MAX_MAP_AREAS,
  MAX_MAP_BRUSHES,
  MAX_MAP_BRUSHSIDES,
  MAX_MAP_EDGES,
  MAX_MAP_ENTITIES,
  MAX_MAP_ENTSTRING,
  MAX_MAP_FACES,
  MAX_MAP_LEAFBRUSHES,
  MAX_MAP_LEAFFACES,
  MAX_MAP_LEAFS,
  MAX_MAP_LIGHTING,
  MAX_MAP_MODELS,
  MAX_MAP_NODES,
  MAX_MAP_PLANES,
  MAX_MAP_PORTALS,
  MAX_MAP_SURFEDGES,
  MAX_MAP_TEXINFO,
  MAX_MAP_VERTS,
  MAX_MAP_VISIBILITY,
  MAX_VALUE,
  PLANE_ANYX,
  PLANE_ANYY,
  PLANE_ANYZ,
  PLANE_X,
  PLANE_Y,
  PLANE_Z,
  SURF_FLOWING,
  SURF_LIGHT,
  SURF_NODRAW,
  SURF_SKY,
  SURF_SLICK,
  SURF_TRANS33,
  SURF_TRANS66,
  SURF_WARP,
  findEntitiesByClassname,
  getEntityOrigin,
  getEntityYaw,
  findPrimarySpawnPoint,
  parseEntityLump,
  parseBsp
} from "./qfiles.js";

export {
  IDPAKHEADER,
  MAX_FILES_IN_PACK,
  findPakEntry,
  parsePak,
  readPakEntryData
} from "./pak.js";

export { parsePcx } from "./pcx.js";
export { parseTga } from "./tga.js";
export {
  ALIAS_VERSION,
  DTRIVERTX_LNI,
  DTRIVERTX_SIZE,
  DTRIVERTX_V0,
  DTRIVERTX_V1,
  DTRIVERTX_V2,
  IDALIASHEADER,
  MAX_FRAMES,
  MAX_MD2SKINS,
  MAX_SKINNAME,
  MAX_TRIANGLES,
  MAX_VERTS,
  parseMd2
} from "./md2.js";
export { IDSPRITEHEADER, SPRITE_VERSION, parseSp2 } from "./sp2.js";
export { MIPLEVELS, parseWal } from "./wal.js";

export type {
  BspMap,
  BspEntity,
  BspSpawnPoint,
  darea_t,
  dareaportal_t,
  dbrush_t,
  dbrushside_t,
  dedge_t,
  dface_t,
  dheader_t,
  dleaf_t,
  dmodel_t,
  dnode_t,
  dplane_t,
  dvertex_t,
  dvis_t,
  lump_t,
  texinfo_t
} from "./qfiles.js";
export type { PakArchive, PakEntry, dpackfile_t, dpackheader_t } from "./pak.js";
export type { daliasframe_t, dmdl_t, dstvert_t, dtriangle_t, dtrivertx_t, Md2Model } from "./md2.js";
export type { PcxImage, pcx_t } from "./pcx.js";
export type { dsprframe_t, dsprite_t } from "./sp2.js";
export type { TargaHeader, TgaImage } from "./tga.js";
export type { miptex_t, WalTexture } from "./wal.js";
