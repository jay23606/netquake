import * as sys from './sys'
import * as con from './console'
import * as com from './com'
import * as vid from './vid'
import * as r from './r'
import * as GL from './GL'
import * as q from './q'
import * as vec from './vec'
import * as host from './host'
import * as def from './def'
import * as tx from './texture'
import * as bspx from './bspx'
import * as lm from './lightmap'
import * as image from './image'
import { V3 } from './types/Vector'
import { Leaf, Model, NodeLeaf, UnloadedModel, Node, Face, Texture, TexInfo, ClipNode, Plane, Skin, SkinGroup, Frame, SpriteFrame, AliasFrame, AliasFrameGroup, SpriteFrameGroup, TexChain, Hull, HullFlat, Md3Surface } from './types'
import { GLTexture } from './texture'
import { getRenderer } from './render'

export const EFFECTS = {
  brightfield: 1,
  muzzleflash: 2,
  brightlight: 4,
  dimlight: 8,
  // DP extension bits (AD powerup items): dimlight-sized glow tinted by channel
  blue: 64,
  red: 128
};

export const TYPE = {
  brush: 0,
  sprite: 1,
  alias: 2
};

export const FLAGS = {
  rocket: 1,
  grenade: 2,
  gib: 4,
  rotate: 8,
  tracer: 16,
  zomgib: 32,
  tracer2: 64,
  tracer3: 128
};

export const VERSION = {
  'bsp2': (('B'.charCodeAt(0) << 0)  | ('S'.charCodeAt(0) << 8)  | ('P'.charCodeAt(0) << 16) | ('2'.charCodeAt(0) << 24)),
  '2psb': (('B'.charCodeAt(0) << 24) | ('S'.charCodeAt(0) << 16) | ('P'.charCodeAt(0) << 8)  | '2'.charCodeAt(0)),
  brush: 29,
  sprite: 1,
  alias: 6,
  md3: 15
};

// Ironwail gl_rmain.c r_nolerp_list: models excluded from animation blending
const NOLERP_LIST = [
  'progs/flame.mdl', 'progs/flame2.mdl', 'progs/braztall.mdl', 'progs/brazshrt.mdl',
  'progs/longtrch.mdl', 'progs/flame_pyre.mdl', 'progs/v_saw.mdl', 'progs/v_xfist.mdl',
  'progs/h2stuff/newfire.mdl'
];



let known: any = [];

//
var loadmodel: Model = null

export const novis = new Uint8Array(0)
var filledcolor = 0

export const init = function()
{
  filledcolor = 0
  loadmodel = null
  known = []
  var i;
  for (i = 0; i < 1024; ++i)
    novis[i] = 0xff;

  for (i = 0; i <= 255; ++i)
  {
    if (vid.d_8to24table[i] === 0)
    {
      filledcolor = i;
      break;
    }
  }
};

// export const pointInLeaf = function(p, model: Model)
// {
//   if (model == null)
//     sys.error('Mod.PointInLeaf: bad model');
//   if (model.nodes == null)
//     sys.error('Mod.PointInLeaf: bad model');
//   var node = model.nodes[0];
//   var normal;
//   var plane;
//   for (;;)
//   {
//     if (node.contents < 0) {
//       return node;
//     }
//     plane = model.planes[node.planenum]
//     normal = plane.normal;
//     if ((p[0] * normal[0] + p[1] * normal[1] + p[2] * normal[2] - plane.dist) > 0)
//       node = model.nodes[node.children[0]];
//     else
//       node = model.nodes[node.children[1]];
//   }
// };
// Walks the flat node SoA (nodePacked) and returns the LEAF NUMBER (index into
// model.leafs / the flat leaf arrays), not the Leaf object, so the worker-mode
// client can drop both Node and Leaf objects. child >= 0 is a node index;
// child < 0 encodes leaf (-1 - leafnum).
export const pointInLeaf = function(p: V3, model: Model) : number
{
  if (model == null || model.nodePacked == null)
    sys.error('Mod.PointInLeaf: bad model');
  const pf = model.nodePacked, pi = model.nodePackedI32;
  var ni = 0;
  for (;;)
  {
    const base = ni * 16;
    const d = p[0] * pf[base + 6] + p[1] * pf[base + 7] + p[2] * pf[base + 8] - pf[base + 9];
    const child = d > 0 ? pi[base + 13] : pi[base + 14];
    if (child < 0)
      return -1 - child;
    ni = child;
  }
};

// One byte per 8 leafs; the single source of truth for vis-row sizing, used by
// decompressVis and both fatPVS implementations (QS/ericw: vanilla's +31 was a bug).
// Uses leafVisofs.length (== the leaf count, sized in buildFlatBsp) rather than
// model.leafs.length, because the worker-mode client drops the Leaf objects
// (leafs = []) but keeps the flat leaf SoA — otherwise the row collapses to 0 and
// every PVS decompresses empty (nothing renders).
export const visRowBytes = function(model: Model)
{
  return (model.leafVisofs.length + 7) >> 3;
};

export const decompressVis = function(i: number, model: Model, dest?: Uint8Array)
{
  var row = visRowBytes(model),
    decompressed = dest || new Uint8Array(row),
    c: number,
    out = 0;
  if (model.visdata == null)
  {
    for (; row >= 0; --row)
      decompressed[out++] = 0xff;
    return decompressed;
  }
  for (out = 0; out < row; )
  {
    if (model.visdata[i] !== 0)
    {
      decompressed[out++] = model.visdata[i++];
      continue;
    }
    for (c = model.visdata[i + 1]; c > 0; --c)
      decompressed[out++] = 0;
    i += 2;
  }
  return decompressed;
};

// Write the vertex referenced by surfedge `se` (signed edge ref) into `out`.
// se >= 0 -> endpoint 0 of edge se; se < 0 -> endpoint 1 of edge -se (matches
// QSS-M CalcSurfaceExtents; the >= is load-bearing for lightmap-stride math).
// Replaces the old vertexes[edges[e][k]] object indexing now both are typed.
export const surfedgeVertexInto = (model: Model, se: number, out: V3): V3 => {
	const ei = se >= 0 ? se * 2 : (-se) * 2 + 1
	const b = model.edges[ei] * 3
	out[0] = model.vertexes[b]; out[1] = model.vertexes[b + 1]; out[2] = model.vertexes[b + 2]
	return out
}

// Read vertex `endpoint` (0 or 1) of edge index `ei` into `out`. For the
// getsurface clip path, which reads both endpoints of an edge directly.
export const edgeVertexInto = (model: Model, ei: number, endpoint: number, out: V3): V3 => {
	const b = model.edges[ei * 2 + endpoint] * 3
	out[0] = model.vertexes[b]; out[1] = model.vertexes[b + 1]; out[2] = model.vertexes[b + 2]
	return out
}

const polyForUnlitSurface = (loadmodel: Model, fa: Face) => {
  var texscale;
  var _vec: V3 = [0, 0, 0];

	if (fa.flags & (def.SURF.drawtub | def.SURF.drawsky))
		texscale = (1.0/128.0); //warp animation repeats every 128
	else
		texscale = (1.0/32.0); //to match r_notexture_mip

  const S = def.POLY_VERT_STRIDE
  const verts = loadmodel.polyVertData
  const base = loadmodel.surfVertOfs[fa.num] * S
  const texinfo = loadmodel.texinfo[fa.texinfo]
	// convert edges back to a normal polygon
	for (var i = 0 ; i < fa.numedges; i++)
	{
		surfedgeVertexInto(loadmodel, loadmodel.surfedges[fa.firstedge + i], _vec);

    var b = base + i * S
    verts[b] = _vec[0]; verts[b + 1] = _vec[1]; verts[b + 2] = _vec[2];
		verts[b + 3] = vec.dotProductV3(_vec, texinfo.vecs[0]) * texscale;
		verts[b + 4] = vec.dotProductV3(_vec, texinfo.vecs[1]) * texscale;
  }
}

export const leafPVS = function(leafNum: number, model: Model)
{
  if (leafNum === 0)
    return novis;
  return decompressVis(model.leafVisofs[leafNum], model);
};

// keepName: a brush model to preserve intact (textures, geometry, needload
// state) instead of gutting + flagging for re-parse. spawnServer passes the
// map being (re)spawned so a savegame load / restart / same-map changelevel
// reuses the already-parsed worldmodel rather than re-parsing it — on a huge
// BSP the re-parse (old freed-but-uncollected + new + re-fetched source all
// resident at once, GC unable to run mid-parse) is what blows the heap.
export const clearAll = function(keepName?: string)
{
  // Only honour keepName if that world is actually loaded (not a needload stub);
  // its inline '*N' submodels share its arrays and are rebuilt only by a parse,
  // so they must be preserved alongside it.
  var keeping = false
  if (keepName != null)
    for (var k = 0; k < known.length; ++k)
      if (known[k] != null && known[k].name === keepName && known[k].type === TYPE.brush && !('needload' in known[k]))
        keeping = true

  var i, mod
  for (i = 0; i < known.length; ++i)
  {
    mod = known[i];
    if (mod.type !== TYPE.brush)
      continue;
    // Same-map respawn: preserve EVERY brush model, not just the reused world and its '*N'
    // submodels. The identical precache list is about to be reloaded, so gutting the rest buys
    // nothing — and it breaks them: r.newMap skips buildModelVertexBuffer when the worldmodel
    // object is unchanged (the huge-map memory guard), which is exactly this case, so a gutted
    // external .bsp gets re-parsed with a ZEROED surfIndexData that nothing ever fills. Every
    // triangle then degenerates to (0,0,0) and the model renders as nothing.
    if (keeping)
      continue;
    tx.freeTextureForOwner(mod)
    // Gut the heavy parse structures now: stale references (the client's
    // model_precache/worldmodel stay pointed here until the reconnect
    // repopulates them) would otherwise keep the whole old world alive
    // through the next map's parse — on huge maps old+new simultaneously
    // blows the tab's heap ceiling. r.renderView skips rendering while the
    // worldmodel is gutted (nodes == null).
    const m = mod as any
    m.faces = m.nodes = m.leafs = m.planes = m.edges = m.vertexes = null
    m.surfedges = m.marksurfaces = m.clipnodes = m.hulls = m.texinfo = null
    m.lightdata = m.visdata = m.textures = m.submodels = null
    m.surfIndexData = m.surfIndexOfs = m.worldChainFaces = null
    m.worldChainOfs = m.worldChainCount = null
    m.polyVertData = m.surfVertOfs = null
    known[i] = {
      name: mod.name,
      needload: true
    };
  }
};

export const findName = function(name: string)
{
  if (name.length === 0)
    sys.error('Mod.FindName: NULL name');
  var i;
  for (i = 0; i < known.length; ++i)
  {
    if (known[i] == null)
      continue;
    if (known[i].name === name)
      return known[i];
  }
  for (i = 0; i <= known.length; ++i)
  {
    if (known[i] != null)
      continue;
    known[i] = {name: name, needload: true};
    return known[i];
  }
};

// True when forName(name) would parse from file bytes (not cached or flushed).
// Side-effect-free — async callers use it to re-fetch large sources into
// residency (evicted after parsing) before the sync load path runs.
export const needsLoad = function(name: string)
{
  for (var i = 0; i < known.length; ++i)
    if (known[i] != null && known[i].name === name)
      return 'needload' in known[i];
  return true;
};

export const loadModel = function(mod: UnloadedModel | Model, crash: boolean)
{
  if (!('needload' in mod))
    return mod;
  const unloadedModel = mod as UnloadedModel
  var buf = com.loadFileSync(mod.name);
  if (buf == null)
  {
    if (crash === true)
      sys.error('Mod.LoadModel: ' + mod.name + ' not found');
    return;
  }
  loadmodel = mod as unknown as Model;
  delete mod.needload

  switch ((new DataView(buf)).getUint32(0, true))
  {
  case 0x4f504449: // 'IDPO'
    loadAliasModel(buf);
    break;
  case 0x33504449: // 'IDP3' (Quake III md3)
    loadMD3Model(buf);
    break;
  case 0x50534449:
    loadSpriteModel(buf);
    break;
  default:
    loadBrushModel(buf);
  }
  return loadmodel;
};

export const forName = function(name: string, crash = false)
{
  return loadModel(findName(name), crash);
};

/*
===============================================================================

          BRUSHMODEL LOADING

===============================================================================
*/

const LUMP =
{
  entities: 0,
  planes: 1,
  textures: 2,
  vertexes: 3,
  visibility: 4,
  nodes: 5,
  texinfo: 6,
  faces: 7,
  lighting: 8,
  clipnodes: 9,
  leafs: 10,
  marksurfaces: 11,
  edges: 12,
  surfedges: 13,
  models: 14
};

export const CONTENTS = {
  empty: -1,
  solid: -2,
  water: -3,
  slime: -4,
  lava: -5,
  sky: -6,
  origin: -7,
  clip: -8,
  current_0: -9,
  current_90: -10,
  current_180: -11,
  current_270: -12,
  current_up: -13,
  current_down: -14,
  ladder: -16
};

export const loadTextures = function(buf: ArrayBuffer)
{
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.textures << 3) + 4, true);
  var filelen = view.getUint32((LUMP.textures << 3) + 8, true);
  loadmodel.textures = [];
  var nummiptex = view.getUint32(fileofs, true);
  var dataofs = fileofs + 4;
  var i, miptexofs, texture: Texture, glt;
  for (i = 0; i < nummiptex; ++i)
  {
    miptexofs = view.getInt32(dataofs, true);
    dataofs += 4;
    if (miptexofs === -1)
    {
      loadmodel.textures[i] = r.state.notexture_mip;
      continue;
    }
    miptexofs += fileofs;
    texture =
    {
      name: q.memstr(new Uint8Array(buf, miptexofs, 16)),
      width: view.getUint32(miptexofs + 16, true),
      height: view.getUint32(miptexofs + 20, true),
      texturechains: {[TexChain.world]: null, [TexChain.model]: null},
    } as Texture
    if (texture.name.substring(0, 3).toLowerCase() === 'sky')
    {
      r.initSky(new Uint8Array(buf, miptexofs + view.getUint32(miptexofs + 24, true), 32768));
      texture.texturenum = r.state.solidskytexture;
      r.state.skytexturenum = i;
      texture.sky = true;
    }
    else
    {
      if (texture.name.charCodeAt(0) === 42)
        texture.turbulent = true;
      if (GL.getContext()) {
        let data = null
        if (texture.height === 0 || texture.width === 0) {
          data = new Uint8Array()
        } else {
          data = new Uint8Array(buf, miptexofs + view.getUint32(miptexofs + 24, true), texture.width * texture.height)
        }
        // QSS-style fullbright split: a miptex with fullbright texels (palette
        // 224-255) loads its base with those texels blacked out plus a companion
        // texture the brush shader adds after the lightmap multiply. Warp
        // textures are excluded, matching QSS (drawn unlit, no fullbright pass).
        var hasFullbrights = false
        if (!texture.turbulent && r.cvr.fullbrights.value) {
          for (var p = data.length - 1; p >= 0; --p) {
            if (data[p] > 223) {
              hasFullbrights = true
              break
            }
          }
        }
        if (hasFullbrights) {
          var fenceFlag = texture.name.charCodeAt(0) === 123 ? def.TEXPREF.alpha : 0
          glt = tx.loadTexture(loadmodel, texture.name, texture.width, texture.height, data, def.TEXPREF.nobright | fenceFlag);
          texture.texturenum = glt.texnum;
          texture.fullbright = tx.loadTexture(loadmodel, texture.name + '@fb', texture.width, texture.height, data, def.TEXPREF.fullbright | fenceFlag).texnum;
        } else {
          glt = tx.loadTexture(loadmodel, texture.name, texture.width, texture.height, data);
          texture.texturenum = glt.texnum;
        }
      }
    }
    loadmodel.textures[i] = texture;
  }

  var j, texture2, num, name;
  for (i = 0; i < nummiptex; ++i)
  {
    texture = loadmodel.textures[i];
    if (texture.name.charCodeAt(0) !== 43)
      continue;
    if (texture.name.charCodeAt(1) !== 48)
      continue;
    name = texture.name.substring(2);
    texture.anims = [i];
    texture.alternate_anims = [];
    for (j = 0; j < nummiptex; ++j)
    {
      texture2 = loadmodel.textures[j];
      if (texture2.name.charCodeAt(0) !== 43)
        continue;
      if (texture2.name.substring(2) !== name)
        continue;
      num = texture2.name.charCodeAt(1);
      if (num === 48)
        continue;
      if ((num >= 49) && (num <= 57))
      {
        texture.anims[num - 48] = j;
        texture2.anim_base = i;
        texture2.anim_frame = num - 48;
        continue;
      }
      if (num >= 97)
        num -= 32;
      if ((num >= 65) && (num <= 74))
      {
        texture.alternate_anims[num - 65] = j;
        texture2.anim_base = i;
        texture2.anim_frame = num - 65;
        continue;
      }
      sys.error('Bad animating texture ' + texture.name);
    }
    for (j = 0; j < texture.anims.length; ++j)
    {
      if (texture.anims[j] == null)
        sys.error('Missing frame ' + j + ' of ' + texture.name);
    }
    for (j = 0; j < texture.alternate_anims.length; ++j)
    {
      if (texture.alternate_anims[j] == null)
        sys.error('Missing frame ' + j + ' of ' + texture.name);
    }
    loadmodel.textures[i] = texture;
  }

  loadmodel.textures[loadmodel.textures.length] = r.state.notexture_mip;
};


export const loadLighting = function(buf: ArrayBuffer)
{
  let i = 0, j = 0
  const litFileName = com.removeExtension(loadmodel.name) + '.lit'
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.lighting << 3) + 4, true);
  var filelen = view.getUint32((LUMP.lighting << 3) + 8, true);
  var litFile = com.loadFileSync(litFileName);
  if (litFile) {
			i = com.state.littleLong((new DataView(litFile).getUint8(4)))
			if (i == 1)
			{
				if (8+filelen*3 == litFile.byteLength)
				{
					con.dPrint(`${litFileName} loaded\n`);
          loadmodel.lightdata = new Uint8Array(new ArrayBuffer(filelen*3));
          loadmodel.lightdata.set(new Uint8Array(litFile, 8, filelen*3));
					return;
				}
				con.print(`Outdated .lit file (${litFileName} should be ${8+filelen*3} bytes, not ${litFile.byteLength})\n`)
			}
			else
			{
				con.print(`Unknown .lit file version (${i})\n`);
			}
  } else {
    if (filelen === 0)
      return;
    loadmodel.lightdata = new Uint8Array(new ArrayBuffer(filelen * 3));
    const lightData = new Uint8Array(buf, fileofs, filelen)
    for (i = 0,  j = 0; i < filelen; i++) {
      loadmodel.lightdata[j++] = lightData[i]
      loadmodel.lightdata[j++] = lightData[i]
      loadmodel.lightdata[j++] = lightData[i]
    }
  }
};

export const loadVisibility = function(buf: ArrayBuffer)
{
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.visibility << 3) + 4, true);
  var filelen = view.getUint32((LUMP.visibility << 3) + 8, true);
  if (filelen === 0)
    return;
  loadmodel.visdata = new Uint8Array(new ArrayBuffer(filelen));
  loadmodel.visdata.set(new Uint8Array(buf, fileofs, filelen));
};

export const loadEntities = function(buf: ArrayBuffer)
{
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.entities << 3) + 4, true);
  var filelen = view.getUint32((LUMP.entities << 3) + 8, true);
  loadmodel.entities = q.memstr(new Uint8Array(buf, fileofs, filelen));
};

export const loadVertexes = function(buf: ArrayBuffer)
{
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.vertexes << 3) + 4, true);
  var filelen = view.getUint32((LUMP.vertexes << 3) + 8, true);
  if ((filelen % 12) !== 0)
    sys.error('Mod.LoadVisibility: funny lump size in ' + loadmodel.name);
  var count = filelen / 12;
  loadmodel.vertexes = new Float32Array(count * 3);
  var i;
  for (i = 0; i < count; ++i)
  {
    loadmodel.vertexes[i * 3] = view.getFloat32(fileofs, true);
    loadmodel.vertexes[i * 3 + 1] = view.getFloat32(fileofs + 4, true);
    loadmodel.vertexes[i * 3 + 2] = view.getFloat32(fileofs + 8, true);
    fileofs += 12;
  }
};

export const loadSubmodels = function(buf: ArrayBuffer)
{
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.models << 3) + 4, true);
  var filelen = view.getUint32((LUMP.models << 3) + 8, true);
  var count = filelen >> 6;
  if (count === 0)
    sys.error('Mod.LoadSubmodels: funny lump size in ' + loadmodel.name);
  loadmodel.submodels = [];

  loadmodel.visleafs = view.getUint32(fileofs + 52, true);
  loadmodel.numleafs = loadmodel.visleafs

  loadmodel.mins = [view.getFloat32(fileofs, true) - 1.0,
    view.getFloat32(fileofs + 4, true) - 1.0,
    view.getFloat32(fileofs + 8, true) - 1.0];
  loadmodel.maxs = [view.getFloat32(fileofs + 12, true) + 1.0,
    view.getFloat32(fileofs + 16, true) + 1.0,
    view.getFloat32(fileofs + 20, true) + 1.0];
  loadmodel.hulls[0].firstclipnode = view.getUint32(fileofs + 36, true);
  loadmodel.hulls[1].firstclipnode = view.getUint32(fileofs + 40, true);
  loadmodel.hulls[2].firstclipnode = view.getUint32(fileofs + 44, true);
  fileofs += 64;

  var i, clipnodes = loadmodel.hulls[0].clipnodes, out: Model;
  for (i = 1; i < count; ++i)
  {
    out = findName('*' + i);
    // @ts-ignore
    delete out.needload
    out.type = TYPE.brush;
    out.submodel = true;
    out.mins = [view.getFloat32(fileofs, true) - 1.0,
      view.getFloat32(fileofs + 4, true) - 1.0,
      view.getFloat32(fileofs + 8, true) - 1.0];
    out.maxs = [view.getFloat32(fileofs + 12, true) + 1.0,
      view.getFloat32(fileofs + 16, true) + 1.0,
      view.getFloat32(fileofs + 20, true) + 1.0];
    out.origin = [view.getFloat32(fileofs + 24, true), view.getFloat32(fileofs + 28, true), view.getFloat32(fileofs + 32, true)];
    out.hulls = [
      {
        clipnodes: clipnodes,
        firstclipnode: view.getUint32(fileofs + 36, true),
        lastclipnode: loadmodel.nodes.length - 1,
        planes: loadmodel.planes,
        clip_mins: [0.0, 0.0, 0.0],
        clip_maxs: [0.0, 0.0, 0.0],
        flat: loadmodel.hulls[0].flat
      },
      {
        clipnodes: loadmodel.clipnodes,
        firstclipnode: view.getUint32(fileofs + 40, true),
        lastclipnode: loadmodel.clipnodes.length - 1,
        planes: loadmodel.planes,
        clip_mins: [-16.0, -16.0, -24.0],
        clip_maxs: [16.0, 16.0, 32.0],
        flat: loadmodel.hulls[1].flat
      },
      {
        clipnodes: loadmodel.clipnodes,
        firstclipnode: view.getUint32(fileofs + 44, true),
        lastclipnode: loadmodel.clipnodes.length - 1,
        planes: loadmodel.planes,
        clip_mins: [-32.0, -32.0, -24.0],
        clip_maxs: [32.0, 32.0, 64.0],
        flat: loadmodel.hulls[2].flat
      }
    ];
    out.textures = loadmodel.textures;
    out.lightdata = loadmodel.lightdata;
    out.faces = loadmodel.faces;
    out.surfVisframe = loadmodel.surfVisframe;
    out.surfVisibleFrame = loadmodel.surfVisibleFrame;
    out.surfFlags = loadmodel.surfFlags;
    out.surfLightmapPage = loadmodel.surfLightmapPage;
    out.surfIndexData = loadmodel.surfIndexData;
    out.surfIndexOfs = loadmodel.surfIndexOfs;
    out.surfIndexCount = loadmodel.surfIndexCount;
    out.texinfo = loadmodel.texinfo;
    out.visleafs = view.getUint32(fileofs + 52, true);
    out.firstface = view.getUint32(fileofs + 56, true);
    out.numfaces = view.getUint32(fileofs + 60, true);
    loadmodel.submodels[i - 1] = out;
    fileofs += 64;
  }
};

export const loadEdges = function(buf: ArrayBuffer, bspVersion: number)
{
  var size = bspVersion === VERSION["2psb"] || bspVersion === VERSION['bsp2'] ? 8 : 4
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.edges << 3) + 4, true);
  var filelen = view.getUint32((LUMP.edges << 3) + 8, true);
  if ((filelen % size) !== 0)
    sys.error('Mod.LoadEdges: funny lump size in ' + loadmodel.name);
  var count = filelen / size;
  loadmodel.edges = new Uint32Array(count * 2);
  var i;

  if (bspVersion === VERSION["2psb"] || bspVersion === VERSION['bsp2']) {
    for (i = 0; i < count; ++i)
    {
      loadmodel.edges[i * 2] = view.getUint32(fileofs, true);
      loadmodel.edges[i * 2 + 1] = view.getUint32(fileofs + 4, true);
      fileofs += 8;
    }
  } else {
    for (i = 0; i < count; ++i)
    {
      loadmodel.edges[i * 2] = view.getUint16(fileofs, true);
      loadmodel.edges[i * 2 + 1] = view.getUint16(fileofs + 2, true);
      fileofs += 4;
    }
  }
};

export const loadTexinfo = function(buf: ArrayBuffer)
{
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.texinfo << 3) + 4, true);
  var filelen = view.getUint32((LUMP.texinfo << 3) + 8, true);
  if ((filelen % 40) !== 0)
    sys.error('Mod.LoadTexinfo: funny lump size in ' + loadmodel.name);
  var count = filelen / 40;
  loadmodel.texinfo = [];
  var i, out: TexInfo;
  for (i = 0; i < count; ++i)
  {
    out = {
      vecs: [
        [view.getFloat32(fileofs, true), view.getFloat32(fileofs + 4, true), view.getFloat32(fileofs + 8, true), view.getFloat32(fileofs + 12, true)],
        [view.getFloat32(fileofs + 16, true), view.getFloat32(fileofs + 20, true), view.getFloat32(fileofs + 24, true), view.getFloat32(fileofs + 28, true)]
      ],
      texture: view.getUint32(fileofs + 32, true),
      flags: view.getUint32(fileofs + 36, true)
    };
    if (out.texture >= loadmodel.textures.length)
    {
      out.texture = loadmodel.textures.length - 1;
      out.flags = 0;
    }
    loadmodel.texinfo[i] = out;
    fileofs += 40;
  }
};

export const loadFaces = function(buf: ArrayBuffer, bspVersion: number)
{
  var size = bspVersion === VERSION["2psb"] || bspVersion === VERSION['bsp2'] ? 28 : 20
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.faces << 3) + 4, true);
  var filelen = view.getUint32((LUMP.faces << 3) + 8, true);
  if ((filelen % size) !== 0)
    sys.error('Mod.LoadFaces: funny lump size in ' + loadmodel.name);
  var count = filelen / size;
  loadmodel.firstface = 0;
  loadmodel.numfaces = count;
  loadmodel.faces = [];
  // Per-face SoA (see Model type). faceStyles is 255-filled = "no style" so a
  // face's inactive slots read as unused; faceNumStyles counts the active ones.
  loadmodel.faceStyles = new Uint8Array(count * 4).fill(255);
  loadmodel.faceNumStyles = new Uint8Array(count);
  loadmodel.faceExtents = new Int32Array(count * 2);
  loadmodel.faceTexturemins = new Int32Array(count * 2);

  // BSPX .lit2 per-face lightmap scale. LMSHIFT: one byte/face (texels-per-luxel
  // = 1<<shift, 4 = vanilla 16). LMOFFSET: one int32/face repacking each face's
  // lightmap sample offset to match. Ref QSS gl_model.c Mod_LoadFaces; a size
  // mismatch voids the lump. LMSTYLE/LMSTYLE16 deferred (needs >4 styles/face).
  var lmshiftLump = bspx.findLump(loadmodel.bspx, buf, 'LMSHIFT');
  if (lmshiftLump !== null && lmshiftLump.length !== count) {
    con.dPrint(`bspx: LMSHIFT is ${lmshiftLump.length} bytes for ${count} faces, ignoring\n`);
    lmshiftLump = null;
  }
  var lmoffsetLump = bspx.findLump(loadmodel.bspx, buf, 'LMOFFSET');
  var lmoffsetView: DataView | null = null;
  if (lmoffsetLump !== null) {
    if (lmoffsetLump.byteLength !== count * 4)
      con.dPrint(`bspx: LMOFFSET is ${lmoffsetLump.byteLength} bytes for ${count} faces, ignoring\n`);
    else
      lmoffsetView = new DataView(lmoffsetLump.buffer, lmoffsetLump.byteOffset, lmoffsetLump.byteLength);
  }

  // BSPX DECOUPLED_LM (ericw-tools -world_units_per_luxel): per-face lightmap
  // size + world->lightmap projection, independent of texinfo/extents. Per-face
  // struct (40 bytes, LE): uint16 lmsize[2]; int32 lmoffset; float lmvecs[2][4].
  // Stomps LMSHIFT/LMOFFSET when present (they describe the same lightmap data).
  // Ref QSS-M gl_model.c Mod_LoadFaces / bspfile.h decoupled_lm_info_s.
  var DECOUPLED_LM_SIZE = 40;
  var decoupledLump = bspx.findLump(loadmodel.bspx, buf, 'DECOUPLED_LM');
  var decoupledView: DataView | null = null;
  if (decoupledLump !== null) {
    if (decoupledLump.byteLength !== count * DECOUPLED_LM_SIZE) {
      con.dPrint(`bspx: DECOUPLED_LM is ${decoupledLump.byteLength} bytes for ${count} faces, ignoring\n`);
    } else {
      decoupledView = new DataView(decoupledLump.buffer, decoupledLump.byteOffset, decoupledLump.byteLength);
      lmshiftLump = null;
      lmoffsetView = null;
    }
  }

  var i, styles, out: Face;
  var mins, maxs, j, e, tex, val;
  var v: V3 = [0, 0, 0]; // reused per-vertex scratch for the extents loop
  for (i = 0; i < count; ++i) {
    if (bspVersion === VERSION["2psb"] || bspVersion === VERSION['bsp2']) {
      styles = new Uint8Array(buf, fileofs + 20, 4);
      out = {
        plane: loadmodel.planes[view.getUint32(fileofs, true)],
        side: view.getUint32(fileofs + 4, true),
        firstedge: view.getUint32(fileofs + 8, true),
        numedges: view.getUint32(fileofs + 12, true),
        texinfo: view.getUint32(fileofs + 16, true),
        lightofs: view.getInt32(fileofs + 24, true)
      } as any;
      fileofs += 28;
    } else {
      styles = new Uint8Array(buf, fileofs + 12, 4);
      out = {
        plane: loadmodel.planes[view.getUint16(fileofs, true)],
        side: view.getUint16(fileofs + 2, true),
        firstedge: view.getUint32(fileofs + 4, true),
        numedges: view.getUint16(fileofs + 8, true),
        texinfo: view.getUint16(fileofs + 10, true),
        lightofs: view.getInt32(fileofs + 16, true)
      } as any;
      fileofs += 20;
    }
    // Store active (non-255) styles into the SoA at their slot; faceStyles is
    // pre-filled 255. faceNumStyles = highest active slot + 1 (= the old
    // out.styles.length, the number of lightmap layers). Active styles are
    // contiguous from 0 in real BSPs, so slot == layer index.
    var maxStyle = -1;
    if (styles[0] !== 255) { loadmodel.faceStyles[i * 4] = styles[0]; maxStyle = 0; }
    if (styles[1] !== 255) { loadmodel.faceStyles[i * 4 + 1] = styles[1]; maxStyle = 1; }
    if (styles[2] !== 255) { loadmodel.faceStyles[i * 4 + 2] = styles[2]; maxStyle = 2; }
    if (styles[3] !== 255) { loadmodel.faceStyles[i * 4 + 3] = styles[3]; maxStyle = 3; }
    loadmodel.faceNumStyles[i] = maxStyle + 1;

    mins = [999999, 999999];
    maxs = [-99999, -99999];
    tex = loadmodel.texinfo[out.texinfo];
    out.texture = tex.texture;
		out.flags = 0;

		if (out.side) // side
      out.flags |= def.SURF.planeback
    
    if (loadmodel.textures[tex.texture].sky){
      out.flags |= (def.SURF.drawsky | def.SURF.drawtiled)
      out.sky = true;
    }
    else if (loadmodel.textures[tex.texture].turbulent) {
      out.flags |= def.SURF.drawtub
      out.turbulent = true;

      // detect special liquid types

      if (loadmodel.textures[tex.texture].name.substring(0, 5).toLowerCase() === '*lava')
        out.flags |= def.SURF.drawlava
      else if (loadmodel.textures[tex.texture].name.substring(0, 6).toLowerCase() === '*slime')
        out.flags |= def.SURF.drawslime
      else if (loadmodel.textures[tex.texture].name.substring(0, 5).toLowerCase() === '*tele')
        out.flags |= def.SURF.drawtele
      else out.flags |= def.SURF.drawwater;

      // r_litwater: a modern compiler (ericw-tools) lights liquid surfaces by
      // leaving TEX.special unset and writing real samples; vanilla-style
      // liquid stays TEX.special with lightofs -1. Matches Ironwail
      // gl_model.c:1384-1391 (samples check is per-surface, not per-texture).
      if ((tex.flags & def.TEX.special) || out.lightofs < 0)
        out.flags |= def.SURF.drawtiled
      else
        loadmodel.haslitwater = true;

      // GL_SubdivideSurface (out);
    } else if (loadmodel.textures[tex.texture].name[0] === '{') {
      out.flags |= def.SURF.drawfence
    } else if (tex.flags & def.TEX.missing) {
      if (out.lightofs < 0) {
        out.flags |= (def.SURF.notexture | def.SURF.drawtiled);
      } else {
        out.flags |= def.SURF.notexture
      }
    }
    for (j = 0; j < out.numedges; ++j)
    {
      surfedgeVertexInto(loadmodel, loadmodel.surfedges[out.firstedge + j], v);
      // QSS-M gl_model.c CalcSurfaceExtents: the dot product must be rounded to
      // 32-bit float ("the result is rounded down to 32-bits and stored in val")
      // to match the light compiler's rounding. Full double precision can leave
      // a ~1e-5 excess on faces whose texcoord lands exactly on a luxel
      // boundary, popping ceil() one luxel wider than the compiler's lightmap —
      // which shifts every subsequent style layer's stride and reads a
      // neighboring face's samples (corrupted/leaked lightmaps).
      val = Math.fround(vec.dotProductV3(v, tex.vecs[0]) + tex.vecs[0][3]);
      if (val < mins[0])
        mins[0] = val;
      if (val > maxs[0])
        maxs[0] = val;
      val = Math.fround(vec.dotProductV3(v, tex.vecs[1]) + tex.vecs[1][3]);
      if (val < mins[1])
        mins[1] = val;
      if (val > maxs[1])
        maxs[1] = val;
    }
    
    out.lmshift = lmshiftLump !== null ? lmshiftLump[i] : 4;
    out.decoupled = false;
    out.lmwidth = 0;
    out.lmheight = 0;
    out.lmvecs = null;
    // texture units per luxel (16 = vanilla); `1 << out.lmshift` inline trips esbuild's
    // TS variance-modifier parse of `<< out`, hence the intermediate
    var lmshift = out.lmshift;
    var lmscale = 1 << lmshift;

    var tmin0 = Math.floor(mins[0] / lmscale) * lmscale, tmin1 = Math.floor(mins[1] / lmscale) * lmscale;
    loadmodel.faceTexturemins[i * 2] = tmin0;
    loadmodel.faceTexturemins[i * 2 + 1] = tmin1;
    loadmodel.faceExtents[i * 2] = Math.ceil(maxs[0] / lmscale) * lmscale - tmin0;
    loadmodel.faceExtents[i * 2 + 1] = Math.ceil(maxs[1] / lmscale) * lmscale - tmin1;

    // LMOFFSET overrides the face lump's sample offset when LMSHIFT repacks the
    // lightmap data (int32, 0xFFFFFFFF -> -1 = no samples, same as the face field).
    if (lmoffsetView !== null)
      out.lightofs = lmoffsetView.getInt32(i * 4, true);
    out.lightofs = out.lightofs > 0 ? out.lightofs * 3 : out.lightofs

    // Clamp oversized extents rather than erroring (matches QSS-M behaviour).
    // LM_BLOCK_WIDTH/HEIGHT = 256 luxels minus the 2-luxel atlas gutter (lightmap.ts
    // allocBlock); extents are in texture units (multiples of lmscale), so the
    // per-axis limit is 254*lmscale and a bad face collapses to one luxel.
    if (!(tex.flags & def.TEX.special)) {
      if (loadmodel.faceExtents[i * 2] >= 254 * lmscale) { loadmodel.faceExtents[i * 2] = lmscale; con.dPrint(`Mod.LoadFaces: bad surface extents, clamping\n`); }
      if (loadmodel.faceExtents[i * 2 + 1] >= 254 * lmscale) { loadmodel.faceExtents[i * 2 + 1] = lmscale; con.dPrint(`Mod.LoadFaces: bad surface extents, clamping\n`); }
    }

    // DECOUPLED_LM: override the lightmap size (luxel counts), sample offset, and
    // projection with the per-face lump data. Classic extents/texturemins above
    // stay untouched for turb subdivision / sky / culling. lmvecs are already in
    // luxels with texturemins folded into the .w term (QSS-M Mod_LoadFaces).
    if (decoupledView !== null) {
      var db = i * DECOUPLED_LM_SIZE;
      out.lmwidth = decoupledView.getUint16(db, true);
      out.lmheight = decoupledView.getUint16(db + 2, true);
      out.lightofs = decoupledView.getInt32(db + 4, true);
      out.lightofs = out.lightofs > 0 ? out.lightofs * 3 : out.lightofs; // RGB (.lit) stride, -1 = no samples
      var lmv = new Float32Array(8);
      for (var kv = 0; kv < 8; kv++)
        lmv[kv] = decoupledView.getFloat32(db + 8 + kv * 4, true);
      out.lmvecs = lmv;
      out.decoupled = true;
      // Guard the atlas: a face bigger than one page (incl. the 2-luxel gutter)
      // can't pack. Mirrors QSS-M's LMBLOCK bad-extents clamp.
      if (out.lmwidth > lm.LM_BLOCK_WIDTH - 2 || out.lmheight > lm.LM_BLOCK_HEIGHT - 2) {
        con.dPrint(`Mod.LoadFaces: DECOUPLED_LM bad extents ${out.lmwidth}x${out.lmheight}, clamping\n`);
        out.lmwidth = out.lmheight = 2;
      }
    }
      
    if (loadmodel.textures[tex.texture].turbulent === true)
      out.turbulent = true;
    else if (loadmodel.textures[tex.texture].sky === true)
      out.sky = true;

    out.num = i;
    loadmodel.faces[i] = out;
  }
};

export const setParent = function(node: NodeLeaf, parent?: Node)
{
  node.parent = parent;
  if (node.contents < 0)
    return;
  
  const _node = node as Node
  setParent(_node.children[0], _node);
  setParent(_node.children[1], _node);
};

export const loadNodes = function(buf: ArrayBuffer, bspVersion: number)
{
  var size = bspVersion === VERSION["2psb"] ? 32 : 
    bspVersion === VERSION.bsp2 ? 44 : 24
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.nodes << 3) + 4, true);
  var filelen = view.getUint32((LUMP.nodes << 3) + 8, true);
  if ((filelen === 0) || ((filelen % size) !== 0))
    sys.error('Mod.LoadNodes: funny lump size in ' + loadmodel.name);
  var count = filelen / size;
  loadmodel.numNodes = count;
  // Stash the raw lump so buildFlatBsp can build the flat node SoA (nodePacked) straight
  // from it. Always kept (a cheap DataView + 3 numbers), so the developer parity self-check
  // can cross-build it against the fat path too. Cleared at the end of buildFlatBsp.
  loadmodel.nodeLump = { view, fileofs, count, version: bspVersion };
  loadmodel.nodes = [];

  // The render-only client (worker mode: !modelNeedsCollision) never touches fat Node
  // objects — makeHull0 keeps hull 0 empty and the renderer walks nodePacked — so skip
  // allocating ~millions of them (the immortal-scale OOM peak) and build the SoA from the
  // lump in buildFlatBsp. The server (dedicated / in-process) still needs fat nodes for
  // makeHull0's clipnode mirror, so it takes the original path unchanged.
  if (!modelNeedsCollision())
    return;

  switch (bspVersion) {
    case VERSION["2psb"]:
      return loadNodes_2psb(view, count, fileofs)
    case VERSION['bsp2']:
      return loadNodes_bsp2(view, count, fileofs)
    default:
      return loadNodes_s(view, count, fileofs)
  }
};

// Decode a big-format (BSP2 / 2PSB) node child value into the flat nodePacked encoding
// (node child = its index >= 0; leaf child = -1 - leafnum < 0), replicating loadNodes_bsp2/
// _2psb's resolve-and-clamp exactly: an out-of-range leaf falls back to leaf 0 (-> -1).
const flatChildBig = (p: number, count: number, numLeafs: number): number => {
  if (p >= 0 && p < count) return p;
  const leafnum = (0xffffffff - p) >>> 0;
  return leafnum < numLeafs ? (-1 - leafnum) : -1;
};

// Fill the flat node SoA (nodePacked/nodePackedI32 + nodePlane) DIRECTLY from the raw nodes
// lump, without allocating any fat Node objects. Byte-identical to what buildFlatBsp's
// fat-node loop produces (verified by the developer parity check). Requires the plane SoA
// (planeNormal/Dist/Type) to already be built and fat leafs still present (for the count).
const fillFlatNodes = function(model: Model, npF: Float32Array, npI: Int32Array, nodePlane: Int32Array) {
  const lump = model.nodeLump!;
  const view = lump.view, count = lump.count, version = lump.version;
  const numLeafs = model.leafs.length;
  const pType = model.planeType, pDist = model.planeDist, pNorm = model.planeNormal;
  const isBsp2 = version === VERSION['bsp2'], is2psb = version === VERSION['2psb'];
  const stride = is2psb ? 32 : isBsp2 ? 44 : 24;
  let ofs = lump.fileofs;
  for (let i = 0; i < count; ++i) {
    const base = i * 16;
    const pn = view.getUint32(ofs, true);
    nodePlane[i] = pn;
    let c0: number, c1: number;
    if (isBsp2) {
      c0 = flatChildBig(view.getInt32(ofs + 4, true), count, numLeafs);
      c1 = flatChildBig(view.getInt32(ofs + 8, true), count, numLeafs);
      npF[base]     = view.getFloat32(ofs + 12, true); npF[base + 1] = view.getFloat32(ofs + 16, true); npF[base + 2] = view.getFloat32(ofs + 20, true);
      npF[base + 3] = view.getFloat32(ofs + 24, true); npF[base + 4] = view.getFloat32(ofs + 28, true); npF[base + 5] = view.getFloat32(ofs + 32, true);
      npI[base + 11] = view.getUint32(ofs + 36, true); npI[base + 12] = view.getUint32(ofs + 40, true);
    } else if (is2psb) {
      c0 = flatChildBig(view.getInt32(ofs + 4, true), count, numLeafs);
      c1 = flatChildBig(view.getInt32(ofs + 8, true), count, numLeafs);
      npF[base]     = view.getInt16(ofs + 12, true); npF[base + 1] = view.getInt16(ofs + 14, true); npF[base + 2] = view.getInt16(ofs + 16, true);
      npF[base + 3] = view.getInt16(ofs + 18, true); npF[base + 4] = view.getInt16(ofs + 20, true); npF[base + 5] = view.getInt16(ofs + 22, true);
      npI[base + 11] = view.getUint32(ofs + 24, true); npI[base + 12] = view.getUint32(ofs + 28, true);
    } else { // bsp29: childrenNum is ALREADY the flat encoding (node = +idx, leaf = -1 - leafnum)
      c0 = view.getInt16(ofs + 4, true); c1 = view.getInt16(ofs + 6, true);
      npF[base]     = view.getInt16(ofs + 8, true);  npF[base + 1] = view.getInt16(ofs + 10, true); npF[base + 2] = view.getInt16(ofs + 12, true);
      npF[base + 3] = view.getInt16(ofs + 14, true); npF[base + 4] = view.getInt16(ofs + 16, true); npF[base + 5] = view.getInt16(ofs + 18, true);
      npI[base + 11] = view.getUint16(ofs + 20, true); npI[base + 12] = view.getUint16(ofs + 22, true);
    }
    npI[base + 13] = c0; npI[base + 14] = c1;
    npI[base + 10] = pType[pn];
    npF[base + 9] = pDist[pn];
    npF[base + 6] = pNorm[pn * 3]; npF[base + 7] = pNorm[pn * 3 + 1]; npF[base + 8] = pNorm[pn * 3 + 2];
    ofs += stride;
  }
};

// Fill nodeParent + leafParent from the flat node children (iterative DFS from the root),
// replacing the fat setParent walk. Callers pre-fill both arrays with -1 (unreachable /
// root -> -1, matching the fat path's `parent != null ? parent.num : -1`).
const computeFlatParents = function(model: Model) {
  const npI = model.nodePackedI32, nodeParent = model.nodeParent, leafParent = model.leafParent;
  if (model.numNodes === 0) return;
  const stack: number[] = [0];
  while (stack.length > 0) {
    const n = stack.pop() as number, base = n * 16;
    for (let j = 0; j < 2; ++j) {
      const c = npI[base + 13 + j];
      if (c >= 0) { nodeParent[c] = n; stack.push(c); }
      else leafParent[-1 - c] = n;
    }
  }
};

const loadNodes_s = (view: DataView, count: number, fileofs: number) => {
  loadmodel.nodes = [];
  var i: number;
  var out: Node;
  
  for (i = 0; i < count; ++i) {
    loadmodel.nodes[i] = {
      num: i,
      contents: 0,
      planenum: view.getUint32(fileofs, true),
      childrenNum: [view.getInt16(fileofs + 4, true), view.getInt16(fileofs + 6, true)],
      mins: [view.getInt16(fileofs + 8, true), view.getInt16(fileofs + 10, true), view.getInt16(fileofs + 12, true)],
      maxs: [view.getInt16(fileofs + 14, true), view.getInt16(fileofs + 16, true), view.getInt16(fileofs + 18, true)],
      firstface: view.getUint16(fileofs + 20, true),
      numfaces: view.getUint16(fileofs + 22, true),
      cmds: [],
      // deferred set
      children: [] as any,
      plane: null as any
    };
    fileofs += 24;
  }
  for (i = 0; i < count; ++i)
  {
    out = loadmodel.nodes[i] as Node;
    out.plane = loadmodel.planes[out.planenum];
    
    if (out.childrenNum[0] >= 0)
      out.children[0] = loadmodel.nodes[out.childrenNum[0]];
    else
      out.children[0] = loadmodel.leafs[-1 - out.childrenNum[0]];
    if (out.childrenNum[1] >= 0)
      out.children[1] = loadmodel.nodes[out.childrenNum[1]];
    else
      out.children[1] = loadmodel.leafs[-1 - out.childrenNum[1]];

    delete out.childrenNum
  }
  setParent(loadmodel.nodes[0], undefined);
}
const loadNodes_2psb = (view: DataView, count: number, fileofs: number) => {
  loadmodel.nodes = [];
  var i,j, out: Node, p
  
  for (i = 0; i < count; ++i) {
    loadmodel.nodes[i] = {
      num: i,
      contents: 0,
      planenum: view.getUint32(fileofs, true),
      childrenNum: [view.getInt32(fileofs + 4, true), view.getInt32(fileofs + 8, true)],
      mins: [view.getInt16(fileofs + 12, true), view.getInt16(fileofs + 14, true), view.getInt16(fileofs + 16, true)],
      maxs: [view.getInt16(fileofs + 18, true), view.getInt16(fileofs + 20, true), view.getInt16(fileofs + 22, true)],
      firstface: view.getUint32(fileofs + 24, true),
      numfaces: view.getUint32(fileofs + 28, true),
      cmds: [],
      // deferred set
      children: [] as any,
      plane: null as any
    };
    fileofs += 32;
  }

  for (i = 0; i < count; ++i) {
    out = loadmodel.nodes[i] as Node;
    out.plane = loadmodel.planes[out.planenum];
    for (j = 0; j < 2; j++) {
      
      p = out.childrenNum[j]
      if (p >= 0 && p < count) {
        out.children[j] = loadmodel.nodes[p];
      } else {
        p = (new Uint32Array([0xffffffff - p]))[0];
        if ( p >= 0 && p < loadmodel.leafs.length) {
          out.children[j] = loadmodel.leafs[p]
        } else {
          con.print(`Mod_LoadNodes: invalid leaf index ${p} (file has only ${loadmodel.leafs.length} leafs)\n`)
          out.children[j] = loadmodel.leafs[0]
        }
      }
    }
    delete out.childrenNum
  }
  setParent(loadmodel.nodes[0], undefined);
}

const loadNodes_bsp2 = (view: DataView, count: number, fileofs: number) => {

  loadmodel.nodes = [];
  var i,j, out: Node, p
  
  for (i = 0; i < count; ++i) {
    loadmodel.nodes[i] = {
      num: i,
      contents: 0,
      planenum: view.getUint32(fileofs, true),
      childrenNum: [view.getInt32(fileofs + 4, true), view.getInt32(fileofs + 8, true)],
      mins: [view.getFloat32(fileofs + 12, true), view.getFloat32(fileofs + 16, true), view.getFloat32(fileofs + 20, true)],
      maxs: [view.getFloat32(fileofs + 24, true), view.getFloat32(fileofs + 28, true), view.getFloat32(fileofs + 32, true)],
      firstface: view.getUint32(fileofs + 36, true),
      numfaces: view.getUint32(fileofs + 40, true),
      cmds: [],
      // deferred set
      children: [] as any,
      plane: null as any
    };
    fileofs += 44;
  }
  
  for (i = 0; i < count; ++i) {
    out = loadmodel.nodes[i] as Node;
    out.plane = loadmodel.planes[out.planenum];
    for (j = 0; j < 2; j++) {
			//johnfitz -- hack to handle nodes > 32k, adapted from darkplaces
      p = out.childrenNum[j]
      if (p > 0 && p < count) {
        out.children[j] = loadmodel.nodes[p];
      } else {
        p = (new Uint32Array([0xffffffff - p]))[0];
        if ( p >= 0 && p < loadmodel.leafs.length) {
          out.children[j] = loadmodel.leafs[p]
        } else {
          con.print(`Mod_LoadNodes: invalid leaf index ${p} (file has only ${loadmodel.leafs.length} leafs)\n`)
          out.children[j] = loadmodel.leafs[0]
        }
      }
    }
    delete out.childrenNum
  }
  setParent(loadmodel.nodes[0], undefined);
}
export const loadLeafs = function(buf: ArrayBuffer, bspVersion: number)
{
  var size = bspVersion === VERSION["2psb"] ? 32 :
    bspVersion === VERSION.bsp2 ? 44 : 28
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.leafs << 3) + 4, true);
  var filelen = view.getUint32((LUMP.leafs << 3) + 8, true);
  if ((filelen % size) !== 0)
    sys.error('Mod.LoadLeafs: funny lump size in ' + loadmodel.name);
  var count = filelen / size;
  loadmodel.leafs = [];
  var i, out: Leaf;
  for (i = 0; i < count; ++i)
  {
    switch (bspVersion) {
      case VERSION["2psb"]:
        out = {
          num: i,
          contents: view.getInt32(fileofs, true),
          visofs: view.getInt32(fileofs + 4, true),
          mins: [view.getInt16(fileofs + 8, true), view.getInt16(fileofs + 10, true), view.getInt16(fileofs + 12, true)],
          maxs: [view.getInt16(fileofs + 14, true), view.getInt16(fileofs + 16, true), view.getInt16(fileofs + 18, true)],
          firstmarksurface: view.getUint32(fileofs + 20, true),
          nummarksurfaces: view.getUint32(fileofs + 24, true),
          ambient_level: [view.getUint8(fileofs + 28), view.getUint8(fileofs + 29), view.getUint8(fileofs + 30), view.getUint8(fileofs + 31)],
          cmds: [],
          skychain: 0,
          waterchain: 0,
          parent: null as any,
          efrags: null
        };
        loadmodel.leafs[i] = out
        fileofs += 32
        break
      case VERSION['bsp2']:
          out = {
            num: i,
            contents: view.getInt32(fileofs, true),
            visofs: view.getInt32(fileofs + 4, true),
            mins: [view.getFloat32(fileofs + 8, true), view.getFloat32(fileofs + 12, true), view.getFloat32(fileofs + 16, true)],
            maxs: [view.getFloat32(fileofs + 20, true), view.getFloat32(fileofs + 24, true), view.getFloat32(fileofs + 28, true)],
            firstmarksurface: view.getUint32(fileofs + 32, true),
            nummarksurfaces: view.getUint32(fileofs + 36, true),
            ambient_level: [view.getUint8(fileofs + 40), view.getUint8(fileofs + 41), view.getUint8(fileofs + 42), view.getUint8(fileofs + 43)],
            cmds: [],
            skychain: 0,
            waterchain: 0,
            parent: null as any,
            efrags: null
          }
          loadmodel.leafs[i] = out
          fileofs += 44
        break
      default:
        out = {
          num: i,
          contents: view.getInt32(fileofs, true),
          visofs: view.getInt32(fileofs + 4, true),
          mins: [view.getInt16(fileofs + 8, true), view.getInt16(fileofs + 10, true), view.getInt16(fileofs + 12, true)],
          maxs: [view.getInt16(fileofs + 14, true), view.getInt16(fileofs + 16, true), view.getInt16(fileofs + 18, true)],
          firstmarksurface: view.getUint16(fileofs + 20, true),
          nummarksurfaces: view.getUint16(fileofs + 22, true),
          ambient_level: [view.getUint8(fileofs + 24), view.getUint8(fileofs + 25), view.getUint8(fileofs + 26), view.getUint8(fileofs + 27)],
          cmds: [],
          skychain: 0,
          waterchain: 0,
          parent: null as any,
          efrags: null
        };
        loadmodel.leafs[i] = out
        fileofs += 28
      break
    }
  };
};

// Whether this host must build the BSP collision hulls (clipnodes + hull 0).
// A dedicated server needs them (it traces player/monster movement) and the
// in-process client shares its worldmodel with the local server, so it needs
// them too. Only the render-only worker-mode client (physics runs on the server
// Worker, the client never traces) can skip them and keep empty hulls.
const modelNeedsCollision = () => host.state.dedicated || host.state.workerServer == null;

export const loadClipnodes = function(buf: ArrayBuffer, bspVersion: number)
{
  var size = bspVersion === VERSION["2psb"] || bspVersion === VERSION.bsp2 ? 12 : 8
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.clipnodes << 3) + 4, true);
  var filelen = view.getUint32((LUMP.clipnodes << 3) + 8, true);
  // The box hulls are collision-only. A render-only worker-mode client (physics
  // runs on the server Worker; the client never traces) skips reading the lump
  // and keeps empty hulls — on huge maps the clipnode objects are a large share
  // of the heap that the render half already strains. See modelNeedsCollision.
  var count = modelNeedsCollision() ? filelen / size : 0;
  loadmodel.clipnodes = [];

  loadmodel.hulls = [];
  loadmodel.hulls[1] = {
    clipnodes: loadmodel.clipnodes,
    firstclipnode: 0,
    lastclipnode: count - 1,
    planes: loadmodel.planes,
    clip_mins: [-16.0, -16.0, -24.0],
    clip_maxs: [16.0, 16.0, 32.0]
  };
  loadmodel.hulls[2] = {
    clipnodes: loadmodel.clipnodes,
    firstclipnode: 0,
    lastclipnode: count - 1,
    planes: loadmodel.planes,
    clip_mins: [-32.0, -32.0, -24.0],
    clip_maxs: [32.0, 32.0, 64.0]
  };
  var i;
  for (i = 0; i < count; ++i)
  {
    if (bspVersion === VERSION["2psb"] || bspVersion === VERSION.bsp2) {
      loadmodel.clipnodes[i] = {
        planenum: view.getUint32(fileofs, true),
        children: [view.getInt32(fileofs + 4, true), view.getInt32(fileofs + 8, true)]
      };
      fileofs += size
    } else {
			//johnfitz -- support clipnodes > 32k
      var out = {
        planenum: view.getUint32(fileofs, true),
        children: [
          view.getUint16(fileofs + 4, true), 
          view.getUint16(fileofs + 6, true)
        ] as [number, number]
      };
			if (out.children[0] >= count)
				out.children[0] -= 65536;
			if (out.children[1] >= count)
        out.children[1] -= 65536;

      loadmodel.clipnodes[i] = out
      fileofs += size
    }
  }
};

export const makeHull0 = function()
{
  // hull 0 (the point hull, mirrored from the node tree) is used only for
  // collision point-content queries. The render-only worker-mode client uses
  // pointInLeaf on the nodes directly, never hull 0, so it keeps an empty hull
  // and skips mirroring every node. See modelNeedsCollision.
  const collision = modelNeedsCollision();
  var node: Node, child, clipnodes: ClipNode[] = [], i, out: ClipNode;
  var hull = {
    clipnodes: clipnodes,
    lastclipnode: collision ? loadmodel.nodes.length - 1 : -1,
    planes: loadmodel.planes,
    clip_mins: vec.emptyV3(),
    clip_maxs: vec.emptyV3()
  };
  if (collision)
    for (i = 0; i < loadmodel.nodes.length; ++i)
    {
      node = loadmodel.nodes[i] as Node;
      out = {planenum: node.planenum, children: [0,0]};
      child = node.children[0];
      out.children[0] = child.contents < 0 ? child.contents : child.num;
      child = node.children[1];
      out.children[1] = child.contents < 0 ? child.contents : child.num;
      clipnodes[i] = out;
    }
  loadmodel.hulls[0] = hull;
};

// Builds the SoA mirror of a hull's clipnodes, sharing the model's plane SoA
// (requires buildFlatBsp to have run). Read-only after load. The box hull
// never gets one — its plane dists are mutated per query.
const buildHullFlat = function(clipnodes: ClipNode[], model: Model): HullFlat
{
  const n = clipnodes.length;
  const flat: HullFlat = {
    clipPlane: new Int32Array(n),
    clipChildren: new Int32Array(n * 2),
    planeNormal: model.planeNormal,
    planeDist: model.planeDist,
    planeType: model.planeType
  };
  for (var i = 0; i < n; ++i)
  {
    flat.clipPlane[i] = clipnodes[i].planenum;
    flat.clipChildren[i * 2] = clipnodes[i].children[0];
    flat.clipChildren[i * 2 + 1] = clipnodes[i].children[1];
  }
  return flat;
};

// Load-time assert that the flat arrays match what the object-path clip
// functions would read through this hull, including every referenced plane
// as reached via hull.planes.
const verifyHullFlat = function(hull: Hull, model: Model)
{
  const flat = hull.flat;
  const fail = (what: string) => sys.error('Mod.VerifyHullFlat: ' + what + ' mismatch in ' + model.name);
  if (flat == null || flat.clipPlane.length !== hull.clipnodes.length)
    fail('clipnode count');
  for (var i = 0; i < hull.clipnodes.length; ++i)
  {
    const cn = hull.clipnodes[i];
    if (flat.clipPlane[i] !== cn.planenum)
      fail('clipPlane[' + i + ']');
    if (flat.clipChildren[i * 2] !== cn.children[0] || flat.clipChildren[i * 2 + 1] !== cn.children[1])
      fail('clipChildren[' + i + ']');
    const pn = cn.planenum;
    const plane = hull.planes[pn];
    if (flat.planeType[pn] !== plane.type)
      fail('planeType[' + pn + ']');
    if (flat.planeDist[pn] !== plane.dist)
      fail('planeDist[' + pn + ']');
    if (flat.planeNormal[pn * 3] !== plane.normal[0] ||
        flat.planeNormal[pn * 3 + 1] !== plane.normal[1] ||
        flat.planeNormal[pn * 3 + 2] !== plane.normal[2])
      fail('planeNormal[' + pn + ']');
  }
};

// Builds the SoA mirror of the BSP tree: plane SoA + flat node/leaf arrays
// derived from the resolved object graph. Read-only after load.
const buildFlatBsp = function(model: Model)
{
  var i, j;

  const numPlanes = model.planes.length;
  model.planeNormal = new Float64Array(numPlanes * 3);
  model.planeDist = new Float64Array(numPlanes);
  model.planeType = new Uint8Array(numPlanes);
  model.planeSignbits = new Uint8Array(numPlanes);
  for (i = 0; i < numPlanes; ++i)
  {
    const plane = model.planes[i];
    model.planeNormal[i * 3] = plane.normal[0];
    model.planeNormal[i * 3 + 1] = plane.normal[1];
    model.planeNormal[i * 3 + 2] = plane.normal[2];
    model.planeDist[i] = plane.dist;
    model.planeType[i] = plane.type;
    model.planeSignbits[i] = plane.signbits;
  }

  const numNodes = model.numNodes;
  model.nodePlane = new Int32Array(numNodes);
  model.nodeParent = new Int32Array(numNodes);
  // See Model.nodePacked for the field layout.
  model.nodePacked = new Float32Array(numNodes * 16);
  model.nodePackedI32 = new Int32Array(model.nodePacked.buffer);
  if (model.nodes.length === 0) {
    // render-only client: no fat Node objects were allocated (the OOM peak on huge maps);
    // build the SoA straight from the raw lump. Byte-identical to the fat path below.
    fillFlatNodes(model, model.nodePacked, model.nodePackedI32, model.nodePlane);
  } else {
    for (i = 0; i < numNodes; ++i)
    {
      const node = model.nodes[i];
      model.nodePlane[i] = node.planenum;
      const base = i * 16;
      for (j = 0; j < 2; ++j)
      {
        const child = node.children[j];
        const c = child.contents < 0 ? -1 - child.num : child.num;
        model.nodePackedI32[base + 13 + j] = c;
      }
      model.nodeParent[i] = node.parent != null ? node.parent.num : -1;
      for (j = 0; j < 3; ++j)
      {
        model.nodePacked[base + j] = node.mins[j];
        model.nodePacked[base + 3 + j] = node.maxs[j];
      }
      model.nodePackedI32[base + 11] = node.firstface;
      model.nodePackedI32[base + 12] = node.numfaces;
      const pn = node.planenum;
      model.nodePackedI32[base + 10] = model.planeType[pn];
      model.nodePacked[base + 9] = model.planeDist[pn];
      model.nodePacked[base + 6] = model.planeNormal[pn * 3];
      model.nodePacked[base + 7] = model.planeNormal[pn * 3 + 1];
      model.nodePacked[base + 8] = model.planeNormal[pn * 3 + 2];
    }
  }

  // 1 where the face is on the back side of its owning node's plane
  // (def.SURF.planeback) — markWorldFrustumNode compares this against the
  // node's view-side to decide which of its faces face the camera.
  if (!host.state.dedicated)
  {
    const numFaces = model.faces.length;
    model.surfPlaneBack = new Uint8Array(numFaces);
    for (i = 0; i < numFaces; ++i)
      model.surfPlaneBack[i] = (model.faces[i].flags & def.SURF.planeback) ? 1 : 0;
  }

  const numLeafs = model.leafs.length;
  model.leafContents = new Int32Array(numLeafs);
  model.leafParent = new Int32Array(numLeafs);
  model.leafVisofs = new Int32Array(numLeafs);
  model.leafFirstMarksurface = new Int32Array(numLeafs);
  model.leafNumMarksurfaces = new Int32Array(numLeafs);
  model.leafAmbientLevel = new Uint8Array(numLeafs * 4);
  model.leafEfrags = new Array(numLeafs).fill(null);
  for (i = 0; i < numLeafs; ++i)
  {
    const leaf = model.leafs[i];
    model.leafContents[i] = leaf.contents;
    model.leafParent[i] = leaf.parent != null ? leaf.parent.num : -1;
    model.leafVisofs[i] = leaf.visofs;
    model.leafFirstMarksurface[i] = leaf.firstmarksurface;
    model.leafNumMarksurfaces[i] = leaf.nummarksurfaces;
    model.leafAmbientLevel[i * 4] = leaf.ambient_level[0];
    model.leafAmbientLevel[i * 4 + 1] = leaf.ambient_level[1];
    model.leafAmbientLevel[i * 4 + 2] = leaf.ambient_level[2];
    model.leafAmbientLevel[i * 4 + 3] = leaf.ambient_level[3];
  }

  // Render client only: no fat Node/Leaf .parent was ever set (setParent walks fat nodes,
  // which it never built), so derive nodeParent/leafParent from the flat children instead.
  // The server keeps its fat-derived parents above, byte-for-byte unchanged. (leafParent was
  // just filled with -1 from the undefined fat leaf.parent; nodeParent still needs it.)
  if (model.nodes.length === 0) {
    model.nodeParent.fill(-1);
    computeFlatParents(model);
  }

  // Deepest node path, so the frustum walk can size its explicit DFS stack
  // provably instead of trusting a constant.
  var maxDepth = 0;
  const depthStack = new Int32Array((numNodes + 1) * 2);
  depthStack[0] = 0;
  depthStack[1] = 1;
  var dsp = numNodes > 0 ? 2 : 0;
  while (dsp > 0)
  {
    dsp -= 2;
    const nIdx = depthStack[dsp], depth = depthStack[dsp + 1];
    if (depth > maxDepth)
      maxDepth = depth;
    for (j = 0; j < 2; ++j)
    {
      const c = model.nodePackedI32[nIdx * 16 + 13 + j];
      if (c >= 0)
      {
        depthStack[dsp] = c;
        depthStack[dsp + 1] = depth + 1;
        dsp += 2;
      }
    }
  }
  model.bspMaxDepth = maxDepth;
};

// Load-time assert that the flat arrays decode back to the exact same
// objects/values as the object graph.
const verifyFlatBsp = function(model: Model)
{
  var i, j;
  const fail = (what: string) => sys.error('Mod.VerifyFlatBsp: ' + what + ' mismatch in ' + model.name);

  for (i = 0; i < model.planes.length; ++i)
  {
    const plane = model.planes[i];
    if (model.planeNormal[i * 3] !== plane.normal[0] ||
        model.planeNormal[i * 3 + 1] !== plane.normal[1] ||
        model.planeNormal[i * 3 + 2] !== plane.normal[2])
      fail('planeNormal[' + i + ']');
    if (model.planeDist[i] !== plane.dist)
      fail('planeDist[' + i + ']');
    if (model.planeType[i] !== plane.type)
      fail('planeType[' + i + ']');
    if (model.planeSignbits[i] !== plane.signbits)
      fail('planeSignbits[' + i + ']');
  }

  for (i = 0; i < model.nodes.length; ++i)
  {
    const node: Node = model.nodes[i];
    if (node.num !== i)
      fail('node.num[' + i + ']');
    if (model.planes[model.nodePlane[i]] !== node.plane)
      fail('nodePlane[' + i + ']');
    const p = model.nodeParent[i];
    if ((p === -1) !== (node.parent == null) || (p !== -1 && model.nodes[p] !== node.parent))
      fail('nodeParent[' + i + ']');
    const base = i * 16;
    for (j = 0; j < 3; ++j)
    {
      if (model.nodePacked[base + j] !== node.mins[j] || model.nodePacked[base + 3 + j] !== node.maxs[j])
        fail('nodePacked mins/maxs[' + i + ']');
    }
    if (model.nodePackedI32[base + 11] !== node.firstface || model.nodePackedI32[base + 12] !== node.numfaces)
      fail('nodePacked firstFace/numFaces[' + i + ']');
    for (j = 0; j < 2; ++j)
    {
      const c = model.nodePackedI32[base + 13 + j];
      const decoded = c >= 0 ? model.nodes[c] : model.leafs[-1 - c];
      if (decoded !== node.children[j])
        fail('nodePacked children[' + i + '][' + j + ']');
    }
    if (model.nodePackedI32[base + 10] !== node.plane.type || model.nodePacked[base + 9] !== node.plane.dist)
      fail('nodePacked planeType/Dist[' + i + ']');
    if (model.nodePacked[base + 6] !== node.plane.normal[0] ||
        model.nodePacked[base + 7] !== node.plane.normal[1] ||
        model.nodePacked[base + 8] !== node.plane.normal[2])
      fail('nodePacked planeNormal[' + i + ']');
  }

  if (!host.state.dedicated)
  {
    for (i = 0; i < model.faces.length; ++i)
      if (model.surfPlaneBack[i] !== ((model.faces[i].flags & def.SURF.planeback) ? 1 : 0))
        fail('surfPlaneBack[' + i + ']');
  }

  for (i = 0; i < model.leafs.length; ++i)
  {
    const leaf: Leaf = model.leafs[i];
    if (leaf.num !== i)
      fail('leaf.num[' + i + ']');
    if (model.leafContents[i] !== leaf.contents)
      fail('leafContents[' + i + ']');
    // leaf.parent is only set when fat nodes exist (setParent walked them); the render
    // client has none and computes leafParent flat instead, so skip this comparison there.
    if (model.nodes.length > 0) {
      const p = model.leafParent[i];
      if ((p === -1) !== (leaf.parent == null) || (p !== -1 && model.nodes[p] !== leaf.parent))
        fail('leafParent[' + i + ']');
    }
    if (model.leafVisofs[i] !== leaf.visofs)
      fail('leafVisofs[' + i + ']');
    if (model.leafFirstMarksurface[i] !== leaf.firstmarksurface ||
        model.leafNumMarksurfaces[i] !== leaf.nummarksurfaces)
      fail('leafMarksurface[' + i + ']');
    for (j = 0; j < 4; ++j)
      if (model.leafAmbientLevel[i * 4 + j] !== leaf.ambient_level[j])
        fail('leafAmbientLevel[' + i + '][' + j + ']');
  }

  // Direct-node-loader parity: whenever fat nodes exist (server / main-thread load), rebuild
  // the flat node SoA straight from the lump via fillFlatNodes — the EXACT path the render
  // client takes with no fat nodes — and assert it is bit-identical to the fat-built
  // nodePacked. Compared over the i32 view so f32 bit patterns (incl. NaN) are exact. Bounded
  // to modest maps to keep the temp cheap; the loader is format-driven, so a small map of a
  // given BSP format proves the same format at immortal scale.
  if (model.nodes.length > 0 && model.nodeLump != null && model.numNodes <= (1 << 19)) {
    const tF = new Float32Array(model.numNodes * 16), tI = new Int32Array(tF.buffer);
    const tPlane = new Int32Array(model.numNodes);
    fillFlatNodes(model, tF, tI, tPlane);
    for (i = 0; i < tI.length; ++i)
      if (tI[i] !== model.nodePackedI32[i])
        fail('direct nodePacked word ' + i);
    for (i = 0; i < tPlane.length; ++i)
      if (tPlane[i] !== model.nodePlane[i])
        fail('direct nodePlane[' + i + ']');
  }
  model.nodeLump = null;
};

export const loadMarksurfaces = function(buf: ArrayBuffer, bspVersion: number)
{
  var size = bspVersion === VERSION["2psb"] || bspVersion === VERSION['bsp2'] ? 4 : 2
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.marksurfaces << 3) + 4, true);
  var filelen = view.getUint32((LUMP.marksurfaces << 3) + 8, true);
  var count = filelen / size;
  loadmodel.marksurfaces = [];
  var i, j;
  for (i = 0; i < count; ++i)
  {
    if (bspVersion === VERSION["2psb"] || bspVersion === VERSION['bsp2']) { 
      j = view.getInt32(fileofs + (i << 2), true);
    } else {
      j = view.getUint16(fileofs + (i << 1), true);
    }
    if (j > loadmodel.faces.length)
      sys.error('Mod.LoadMarksurfaces: bad surface number');
    loadmodel.marksurfaces[i] = j;
  }
};

export const loadSurfedges = function(buf: ArrayBuffer)
{
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.surfedges << 3) + 4, true);
  var filelen = view.getUint32((LUMP.surfedges << 3) + 8, true);
  var count = filelen >> 2;
  loadmodel.surfedges = new Int32Array(count);
  var i;
  for (i = 0; i < count; ++i)
    loadmodel.surfedges[i] = view.getInt32(fileofs + (i << 2), true);
}

export const loadPlanes = function(buf: ArrayBuffer)
{
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.planes << 3) + 4, true);
  var filelen = view.getUint32((LUMP.planes << 3) + 8, true);
  if ((filelen % 20) !== 0)
    sys.error('Mod.LoadPlanes: funny lump size in ' + loadmodel.name);
  var count = filelen / 20;
  loadmodel.planes = [];
  var i, out: Plane;
  for (i = 0; i < count; ++i)
  {
    out = {
      normal: [view.getFloat32(fileofs, true), view.getFloat32(fileofs + 4, true), view.getFloat32(fileofs + 8, true)],
      dist: view.getFloat32(fileofs + 12, true),
      type: view.getUint32(fileofs + 16, true),
      signbits: 0
    };
    if (out.normal[0] < 0)
      ++out.signbits;
    if (out.normal[1] < 0)
      out.signbits += 2;
    if (out.normal[2] < 0)
      out.signbits += 4;
    loadmodel.planes[i] = out;
    fileofs += 20;
  }
};

// Deduped indices into model.textures referenced by model's own face range.
// Called once at load for the worldmodel and each of its submodels.
const buildUsedTextures = function(model: Model)
{
  var seen = new Set<number>();
  for (var i = 0; i < model.numfaces; i++) {
    var face = model.faces[model.firstface + i];
    seen.add(model.texinfo[face.texinfo].texture);
  }
  model.usedTextures = Int32Array.from(seen).sort();
};

export const loadBrushModel = function(buffer: ArrayBuffer)
{
  loadmodel.type = TYPE.brush;
  loadmodel.haslitwater = false; // set true in loadFaces when a turb face has real lightmap samples
  var version = (new DataView(buffer)).getUint32(0, true);

  switch (version) {
    case VERSION.bsp2:
    case VERSION["2psb"]:
    case VERSION.brush:
      break;
    default:
      throw new Error('Mod.LoadBrushModel: ' +  loadmodel.name  + ' has wrong version number (' + version + ')');
  }

  // BSPX directory lives just past the highest standard lump (v29 and BSP2
  // share this same 15-lump layout); scan it for the end offset, same as
  // QSS Q1BSPX_Setup, then hand off to bspx.parse. Discovery only here -
  // no consumer reads loadmodel.bspx yet.
  {
    var bspxView = new DataView(buffer);
    var bspxEnd = 0;
    var bspxMisaligned = false;
    var numLumps = Object.keys(LUMP).length;
    for (var lumpIdx = 0; lumpIdx < numLumps; lumpIdx++)
    {
      var lumpOfs = bspxView.getUint32((lumpIdx << 3) + 4, true);
      var lumpLen = bspxView.getUint32((lumpIdx << 3) + 8, true);
      if ((lumpOfs & 3) && lumpIdx !== LUMP.entities)
        bspxMisaligned = true;
      if (bspxEnd < lumpOfs + lumpLen)
        bspxEnd = lumpOfs + lumpLen;
    }
    if (bspxMisaligned)
      con.dPrint(`${loadmodel.name} contains misaligned lumps\n`);
    loadmodel.bspx = bspx.parse(buffer, bspxEnd);
    if (loadmodel.bspx !== null)
      for (var bspxName in loadmodel.bspx)
        con.dPrint(`bspx: ${bspxName} (${loadmodel.bspx[bspxName].filelen} bytes)\n`);
  }

  if (!host.state.dedicated) {
    loadVertexes(buffer);
    loadEdges(buffer, version);
    loadSurfedges(buffer);
    loadTextures(buffer);
    loadLighting(buffer);
  }
  loadPlanes(buffer);
  if (!host.state.dedicated) {
    loadTexinfo(buffer);
    loadFaces(buffer, version);
    loadMarksurfaces(buffer, version);
  }
  loadVisibility(buffer);
  loadLeafs(buffer, version);
  loadNodes(buffer, version);
  loadClipnodes(buffer, version);
  makeHull0();

  // Dense per-frame render state (markSurfaces' PVS stamps + markWorldFrustum),
  // indexed by node/leaf/surf.num.
  loadmodel.nodeMarkvisframe = new Int32Array(loadmodel.numNodes);
  loadmodel.leafMarkvisframe = new Int32Array(loadmodel.leafs.length);
  if (!host.state.dedicated) {
    loadmodel.surfVisframe = new Int32Array(loadmodel.faces.length);
    loadmodel.surfVisibleFrame = new Int32Array(loadmodel.faces.length);

    // Flat per-face mirrors so per-frame draw loops never touch Face objects.
    // surfFlags is BSP-derived and filled immediately; surfLightmapPage is
    // filled later by lightmap.createSurfaceLightmap once pages are assigned.
    loadmodel.surfFlags = new Int32Array(loadmodel.faces.length);
    loadmodel.surfLightmapPage = new Int32Array(loadmodel.faces.length);

    // Prebuilt triangle-fan indices for the world VBO. ofs/count only depend
    // on numedges, so they're computed here; the index values themselves are
    // filled in r.buildModelVertexBuffer once vbo_firstvert is assigned.
    loadmodel.surfIndexOfs = new Int32Array(loadmodel.faces.length);
    loadmodel.surfIndexCount = new Int32Array(loadmodel.faces.length);
    // Shared vertex-staging buffer: surfVertOfs[i] is face i's first vertex,
    // and it has numedges vertices (POLY_VERT_STRIDE floats each).
    loadmodel.surfVertOfs = new Int32Array(loadmodel.faces.length);
    var idxTotal = 0, vertTotal = 0;
    for (var fi = 0; fi < loadmodel.faces.length; fi++) {
      loadmodel.surfFlags[fi] = loadmodel.faces[fi].flags;
      loadmodel.surfIndexOfs[fi] = idxTotal;
      loadmodel.surfIndexCount[fi] = 3 * (loadmodel.faces[fi].numedges - 2);
      idxTotal += loadmodel.surfIndexCount[fi];
      loadmodel.surfVertOfs[fi] = vertTotal;
      vertTotal += loadmodel.faces[fi].numedges;
    }
    loadmodel.surfIndexData = new Uint32Array(idxTotal);
    loadmodel.polyVertData = new Float32Array(vertTotal * def.POLY_VERT_STRIDE);

    // Unlit faces (sky / notexture: drawtiled without drawtub) build their poly
    // verts once here, now that polyVertData exists; lit + water faces are
    // (re)built into the same buffer at each r.newMap by buildSurfaceDisplayLists.
    for (var fu = 0; fu < loadmodel.faces.length; fu++) {
      var ff = loadmodel.faces[fu];
      if ((ff.flags & def.SURF.drawtiled) && !(ff.flags & def.SURF.drawtub))
        polyForUnlitSurface(loadmodel, ff);
    }

    // Flat mirror of the world texture chains; filled by r.markSurfaces.
    loadmodel.worldChainFaces = new Int32Array(loadmodel.faces.length);
    loadmodel.worldChainOfs = new Int32Array(loadmodel.textures.length);
    loadmodel.worldChainCount = new Int32Array(loadmodel.textures.length);
  }

  buildFlatBsp(loadmodel);
  verifyFlatBsp(loadmodel);

  // Hulls 1 and 2 share loadmodel.clipnodes, so they share one flat mirror;
  // hull 0's clipnodes are built separately in makeHull0.
  loadmodel.hulls[0].flat = buildHullFlat(loadmodel.hulls[0].clipnodes, loadmodel);
  loadmodel.hulls[1].flat = loadmodel.hulls[2].flat = buildHullFlat(loadmodel.clipnodes, loadmodel);
  verifyHullFlat(loadmodel.hulls[0], loadmodel);
  verifyHullFlat(loadmodel.hulls[1], loadmodel);
  verifyHullFlat(loadmodel.hulls[2], loadmodel);

  loadEntities(buffer);
  loadSubmodels(buffer);

  if (!host.state.dedicated) {
    buildUsedTextures(loadmodel);
    for (var si = 0; si < loadmodel.submodels.length; si++)
      buildUsedTextures(loadmodel.submodels[si]);
  }

  if (!host.state.dedicated) {
    var i, vx, vy, vz, vd = loadmodel.vertexes, mins = [0.0, 0.0, 0.0], maxs = [0.0, 0.0, 0.0];
    for (i = 0; i < vd.length; i += 3)
    {
      vx = vd[i]; vy = vd[i + 1]; vz = vd[i + 2];
      if (vx < mins[0]) mins[0] = vx; else if (vx > maxs[0]) maxs[0] = vx;
      if (vy < mins[1]) mins[1] = vy; else if (vy > maxs[1]) maxs[1] = vy;
      if (vz < mins[2]) mins[2] = vz; else if (vz > maxs[2]) maxs[2] = vz;
    };
    loadmodel.radius = vec.length([
      Math.abs(mins[0]) > Math.abs(maxs[0]) ? Math.abs(mins[0]) : Math.abs(maxs[0]),
      Math.abs(mins[1]) > Math.abs(maxs[1]) ? Math.abs(mins[1]) : Math.abs(maxs[1]),
      Math.abs(mins[2]) > Math.abs(maxs[2]) ? Math.abs(mins[2]) : Math.abs(maxs[2])
    ]);
  }

  // Everything needed at runtime has been copied into engine structures; drop
  // huge source bytes (and the companion .lit, already copied into lightdata)
  // from assetStore residency. A re-parse (restart/changelevel after clearAll)
  // re-fetches via the needsLoad checks in cl.loadAllPrecaches / sv.spawnServer.
  if (buffer.byteLength >= 32 * 1024 * 1024) {
    com.evictFile(loadmodel.name);
    com.evictFile(com.removeExtension(loadmodel.name) + '.lit');
  }

  // The worker-mode client (renders only; the server runs on the Worker) walks
  // the flat node/leaf SoA at runtime — pointInLeaf/recursiveLightPoint/
  // splitEntityOnNode/markSurfaces/leafPVS/fatPVS and the ambient-sound path all
  // read nodePacked + the flat leaf arrays (leafContents/leafVisofs/leafEfrags/
  // leafFirstMarksurface/leafNumMarksurfaces/leafAmbientLevel), never the Node or
  // Leaf objects. So release both: on a 1.7M-face map that is ~0.9GB. The whole
  // node+leaf graph is unrooted once these arrays go (mark-sweep collects the
  // internal parent/children cycles). Kept for the in-process client (shares its
  // worldmodel with the local server, which walks Node/Leaf objects in
  // fatPVS/findTouchedLeafs) and for the dedicated/Worker server. renderView uses
  // `nodes == null` as the "gutted worldmodel" sentinel, so leave [] not null.
  if (!host.state.dedicated && host.state.workerServer != null) {
    loadmodel.nodes = [];
    loadmodel.leafs = [];
  }
};

/*
==============================================================================

ALIAS MODELS

==============================================================================
*/

export const translatePlayerSkin = function(data: Uint8Array, skin: Skin)
{
  const gl = GL.getContext()
  if ((loadmodel.skinwidth !== 512) || (loadmodel.skinheight !== 256))
    data = tx.resampleTexture(data, loadmodel.skinwidth, loadmodel.skinheight, 512, 256);
  var out = new Uint8Array(new ArrayBuffer(524288));
  var i, original;
  for (i = 0; i < 131072; ++i)
  {
    original = data[i];
    if ((original >> 4) === 1)
    {
      out[i << 2] = (original & 15) * 17;
      out[(i << 2) + 1] = 255;
    }
    else if ((original >> 4) === 6)
    {
      out[(i << 2) + 2] = (original & 15) * 17;
      out[(i << 2) + 3] = 255;
    }
  }
  // Retain the mask for WebGPU, which uploads its own texture from these bytes.
  skin.playerRgba = out;
  skin.playertexture = gl.createTexture();
  tx.bind(0, skin.playertexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 512, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, out);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, tx.state.filter_min);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, tx.state.filter_max);
};

export const floodFillSkin = function(skin: Uint8Array)
{
  var fillcolor = skin[0];
  if (fillcolor === filledcolor)
    return;

  var width = loadmodel.skinwidth;
  var height = loadmodel.skinheight;

  var lifo = [[0, 0]], sp, cur, x, y;

  for (sp = 1; sp > 0; )
  {
    cur = lifo[--sp];
    x = cur[0];
    y = cur[1];
    skin[y * width + x] = filledcolor;
    if (x > 0)
    {
      if (skin[y * width + x - 1] === fillcolor)
        lifo[sp++] = [x - 1, y];
    }
    if (x < (width - 1))
    {
      if (skin[y * width + x + 1] === fillcolor)
        lifo[sp++] = [x + 1, y];
    }
    if (y > 0)
    {
      if (skin[(y - 1) * width + x] === fillcolor)
        lifo[sp++] = [x, y - 1];
    }
    if (y < (height - 1))
    {
      if (skin[(y + 1) * width + x] === fillcolor)
        lifo[sp++] = [x, y + 1];
    }
  }
};

export const loadAllSkins = function(buffer: ArrayBuffer, inmodel: number)
{
  loadmodel.skins = [];
  var model = new DataView(buffer);
  var i, j, group: SkinGroup, numskins;
  var skinsize = loadmodel.skinwidth * loadmodel.skinheight;
  var skin;
  for (i = 0; i < loadmodel.numskins; ++i)
  {
    inmodel += 4;
    if (model.getUint32(inmodel - 4, true) === 0)
    {
      if (GL.getContext()) {
        skin = new Uint8Array(buffer, inmodel, skinsize);
        floodFillSkin(skin);
        const newSkin: Skin = {
          group: false,
          texturenum: tx.loadTexture(loadmodel, loadmodel.name + '_' + i,
            loadmodel.skinwidth,
            loadmodel.skinheight,
            skin, def.TEXPREF.skin),
          playertexture: null,
          interval: 0
        };
        loadmodel.skins[i] = newSkin
        if (loadmodel.player === true)
          translatePlayerSkin(new Uint8Array(buffer, inmodel, skinsize), newSkin);
      }
      inmodel += skinsize;
    }
    else
    {
      group = {
        group: true,
        skins: []
      };
      numskins = model.getUint32(inmodel, true);
      inmodel += 4;
      for (j = 0; j < numskins; ++j)
      {
        group.skins[j] = {
          group: false,
          interval: model.getFloat32(inmodel, true), 
          texturenum: null, 
          playertexture: null
        };
        if (group.skins[j].interval <= 0.0)
          sys.error('Mod.LoadAllSkins: interval<=0');
        inmodel += 4;
      }
      for (j = 0; j < numskins; ++j)
      {
        if (GL.getContext()) {
          skin = new Uint8Array(buffer, inmodel, skinsize);
          floodFillSkin(skin);
          group.skins[j].texturenum = tx.loadTexture(loadmodel, loadmodel.name + '_' + i + '_' + j,
            loadmodel.skinwidth,
            loadmodel.skinheight,
            skin, def.TEXPREF.skin);
          if (loadmodel.player === true)
            translatePlayerSkin(new Uint8Array(buffer, inmodel, skinsize), group.skins[j]);
        }
        inmodel += skinsize;
      }
      loadmodel.skins[i] = group;
    }
  }
  return inmodel;
};

export const loadAllFrames = function(buffer: ArrayBuffer, inmodel: number)
{
  var poseverts = []
  loadmodel.frames = [];
  var model = new DataView(buffer);
  var i, j, k, frame: AliasFrame, group: AliasFrameGroup, numframes;
  for (i = 0; i < loadmodel.numframes; ++i)
  {
    inmodel += 4;
    if (model.getUint32(inmodel - 4, true) === 0) // ALIAS_SINGLE
    {
      frame = {
        type: 'alias',
        numposes: 1,
        group: false,
        bboxmin: [model.getUint8(inmodel), model.getUint8(inmodel + 1), model.getUint8(inmodel + 2)],
        bboxmax: [model.getUint8(inmodel + 4), model.getUint8(inmodel + 5), model.getUint8(inmodel + 6)],
        name: q.memstr(new Uint8Array(buffer, inmodel + 8, 16)),
        interval: 0,
        v: [],
        cmdofs: 0
      };
      inmodel += 24;
      for (j = 0; j < loadmodel.numverts; ++j)
      {
        frame.v[j] = {
          v: [model.getUint8(inmodel), model.getUint8(inmodel + 1), model.getUint8(inmodel + 2)],
          lightnormalindex: model.getUint8(inmodel + 3)
        };
        inmodel += 4;
      }
      loadmodel.frames[i] = frame;
    }
    else
    {
      group = {
        type: 'alias',
        group: true,
        bboxmin: [model.getUint8(inmodel + 4), model.getUint8(inmodel + 5), model.getUint8(inmodel + 6)],
        bboxmax: [model.getUint8(inmodel + 8), model.getUint8(inmodel + 9), model.getUint8(inmodel + 10)],
        frames: []
      };
      numframes = model.getUint32(inmodel, true);
      inmodel += 12;
      for (j = 0; j < numframes; ++j)
      {
        group.frames[j] = {
          type: 'alias',
          group: false,
          numposes: 0,
          name: '',
          bboxmin: [0, 0, 0],
          bboxmax: [0, 0, 0],
          v: [],
          interval: model.getFloat32(inmodel, true),
          cmdofs: 0
        };
        if (group.frames[j].interval <= 0.0)
          sys.error('Mod.LoadAllFrames: interval<=0');
        inmodel += 4;
      }
      for (j = 0; j < numframes; ++j)
      {
        frame = group.frames[j];
        frame.bboxmin = [model.getUint8(inmodel), model.getUint8(inmodel + 1), model.getUint8(inmodel + 2)];
        frame.bboxmax = [model.getUint8(inmodel + 4), model.getUint8(inmodel + 5), model.getUint8(inmodel + 6)];
        frame.name = q.memstr(new Uint8Array(buffer, inmodel + 8, 16));
        frame.v = [];
        inmodel += 24;
        for (k = 0; k < loadmodel.numverts; ++k)
        {
          frame.v[k] = {
            v: [model.getUint8(inmodel), model.getUint8(inmodel + 1), model.getUint8(inmodel + 2)],
            lightnormalindex: model.getUint8(inmodel + 3)
          };
          inmodel += 4;
        }
      }
      loadmodel.frames[i] = group;
    }
  }
};


//=========================================================================

/*
=================
Mod_CalcAliasBounds -- johnfitz -- calculate bounds of alias model for nonrotated, yawrotated, and fullrotated cases
=================
*/
// const calcAliasBounds = a => {
//   var i, j, k
// 	var		dist, yawradius, radius, v;

// 	//clear out all data
// 	for (i = 0; i < 3; i++)
// 	{
// 		loadmodel.mins[i] = loadmodel.ymins[i] = loadmodel.rmins[i] = 999999;
// 		loadmodel.maxs[i] = loadmodel.ymaxs[i] = loadmodel.rmaxs[i] = -999999;
// 		radius = yawradius = 0;
// 	}

// 	//process verts
// 	for (i = 0 ; i < a.numposes; i++)
// 		for (j = 0; j < a.numverts; j++)
// 		{
// 			for (k = 0; k < 3; k++)
// 				v[k] = poseverts[i][j].v[k] * pheader->scale[k] + pheader->scale_origin[k];

// 			for (k=0; k<3;k++)
// 			{
// 				loadmodel->mins[k] = q_min(loadmodel->mins[k], v[k]);
// 				loadmodel->maxs[k] = q_max(loadmodel->maxs[k], v[k]);
// 			}
// 			dist = v[0] * v[0] + v[1] * v[1];
// 			if (yawradius < dist)
// 				yawradius = dist;
// 			dist += v[2] * v[2];
// 			if (radius < dist)
// 				radius = dist;
// 		}

// 	//rbounds will be used when entity has nonzero pitch or roll
// 	radius = sqrt(radius);
// 	loadmodel->rmins[0] = loadmodel->rmins[1] = loadmodel->rmins[2] = -radius;
// 	loadmodel->rmaxs[0] = loadmodel->rmaxs[1] = loadmodel->rmaxs[2] = radius;

// 	//ybounds will be used when entity has nonzero yaw
// 	yawradius = sqrt(yawradius);
// 	loadmodel->ymins[0] = loadmodel->ymins[1] = -yawradius;
// 	loadmodel->ymaxs[0] = loadmodel->ymaxs[1] = yawradius;
// 	loadmodel->ymins[2] = loadmodel->mins[2];
// 	loadmodel->ymaxs[2] = loadmodel->maxs[2];
// }


// ---- Quake III .md3 (IDP3, version 15) ------------------------------------------------
// Ported from QSS gl_mesh.c Mod_LoadMD3Model. md3 is multi-surface and indexed; we unroll
// each surface into the same non-indexed triangle-soup `cmds` layout the mdl path uses so
// drawAliasModel renders it through the existing pose-VBO binding. The only renderer
// addition is a per-surface skin loop (surfaces carry their own external textures).

const md3StripExtension = function(name: string): string {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  const dot = name.lastIndexOf('.');
  return (dot > slash) ? name.substring(0, dot) : name;
};

const md3DirName = function(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.substring(0, slash + 1) : '';
};

// 16x16 grey checkerboard shown until an md3 skin resolves, and left in place when the
// referenced image is missing -- matches QSS falling back to its notexture. Deduped by
// identifier so only one GL texture is ever created.
const md3PlaceholderSkin = function(): GLTexture {
  const px = new Uint8Array(16 * 16 * 4);
  for (var y = 0; y < 16; y++)
    for (var x = 0; x < 16; x++) {
      const v = (((x >> 2) ^ (y >> 2)) & 1) ? 128 : 64;
      const o = (y * 16 + x) * 4;
      px[o] = px[o + 1] = px[o + 2] = v; px[o + 3] = 255;
    }
  return tx.loadRGBATexture(loadmodel, '__md3_notexture', 16, 16, px);
};

// md3 skins are external image files named by shader. Image decode is async, so resolve
// off the critical path and swap the surface skin from the placeholder to the real texture
// when it arrives; a missing image leaves the placeholder (QSS notexture behaviour).
const resolveMd3Skin = async function(model: Model, surface: Md3Surface, idx: number, texname: string) {
  const img = await image.loadImage(texname);
  if (img == null) {
    con.dPrint('Mod.LoadMD3: skin not found: ' + texname + '\n');
    return;
  }
  surface.skins[idx] = tx.loadRGBATexture(model, texname, img.width, img.height, img.data);
};

type Md3ParsedSurface = {
  name: string, numVerts: number, numTris: number,
  ofsSt: number, ofsXyz: number, numShaders: number, ofsShaders: number,
  first: number, corners: number[] // md3 vertex index per unrolled triangle corner
};

export const loadMD3Model = function(buffer: ArrayBuffer)
{
  loadmodel.type = TYPE.alias;
  loadmodel.player = false;
  const view = new DataView(buffer);

  const version = view.getInt32(4, true);
  if (version !== VERSION.md3)
    sys.error(loadmodel.name + ' has wrong version number (' + version + ' should be ' + VERSION.md3 + ')');

  // header: 72 flags, 76 numFrames, 84 numSurfaces, 92 ofsFrames, 100 ofsSurfaces
  const flags = view.getInt32(72, true);
  const numFrames = view.getInt32(76, true);
  const numSurfaces = view.getInt32(84, true);
  const ofsFrames = view.getInt32(92, true);
  const ofsSurfaces = view.getInt32(100, true);

  if (numFrames <= 0)
    sys.error('model ' + loadmodel.name + ' has no frames');
  if (numSurfaces <= 0)
    sys.error('model ' + loadmodel.name + ' has no surfaces');
  if (ofsFrames < 0 || ofsSurfaces < 0 || ofsFrames + numFrames * 56 > buffer.byteLength)
    sys.error('model ' + loadmodel.name + ' is corrupt (bad frame/surface offsets)');

  const gl = GL.getContext();

  // --- pass 1: parse surface headers, unroll triangle indices, count soup verts ---
  const surfs: Md3ParsedSurface[] = [];
  var unrolled = 0;
  var so = ofsSurfaces;
  for (var s = 0; s < numSurfaces; s++) {
    if (view.getUint32(so, true) !== 0x33504449) // 'IDP3'
      sys.error(loadmodel.name + ' corrupt surface ident');
    // surface: 4 name[64], 72 numFrames, 76 numShaders, 80 numVerts, 84 numTriangles,
    // 88 ofsTriangles, 92 ofsShaders, 96 ofsSt, 100 ofsXyzNormals, 104 ofsEnd (all
    // sub-offsets relative to the surface start)
    const sname = q.memstr(new Uint8Array(buffer, so + 4, 64));
    const sNumFrames = view.getInt32(so + 72, true);
    const numShaders = view.getInt32(so + 76, true);
    const numVerts = view.getInt32(so + 80, true);
    const numTris = view.getInt32(so + 84, true);
    const ofsTris = so + view.getInt32(so + 88, true);
    const ofsShaders = so + view.getInt32(so + 92, true);
    const ofsSt = so + view.getInt32(so + 96, true);
    const ofsXyz = so + view.getInt32(so + 100, true);
    const ofsEnd = view.getInt32(so + 104, true);
    if (sNumFrames !== numFrames)
      sys.error(loadmodel.name + ' mismatched surface framecounts');

    const corners: number[] = [];
    for (var t = 0; t < numTris; t++) {
      const to = ofsTris + t * 12;
      corners.push(view.getInt32(to, true), view.getInt32(to + 4, true), view.getInt32(to + 8, true));
    }
    surfs.push({ name: sname, numVerts, numTris, ofsSt, ofsXyz, numShaders, ofsShaders, first: unrolled, corners });
    unrolled += numTris * 3;
    if (ofsEnd <= 0) break;
    so += ofsEnd;
  }

  // --- pass 2: build the shared cmds buffer (texcoords, then one pose block per frame) ---
  const cmds: number[] = [];
  for (var si = 0; si < surfs.length; si++) {
    const su = surfs[si];
    for (var c = 0; c < su.corners.length; c++) {
      const stofs = su.ofsSt + su.corners[c] * 8; // md3St: float s, float t
      cmds.push(view.getFloat32(stofs, true), view.getFloat32(stofs + 4, true));
    }
  }

  loadmodel.frames = [];
  const mins: V3 = [Infinity, Infinity, Infinity];
  const maxs: V3 = [-Infinity, -Infinity, -Infinity];
  var radiusSq = 0;
  for (var f = 0; f < numFrames; f++) {
    // md3 frame header: 0 mins(vec3) 12 maxs(vec3) 24 localOrigin(vec3) 36 radius 40 name[16]
    const fo = ofsFrames + f * 56;
    const frame: AliasFrame = {
      type: 'alias', group: false, numposes: 1,
      name: q.memstr(new Uint8Array(buffer, fo + 40, 16)), interval: 0.1,
      bboxmin: [view.getFloat32(fo, true), view.getFloat32(fo + 4, true), view.getFloat32(fo + 8, true)],
      bboxmax: [view.getFloat32(fo + 12, true), view.getFloat32(fo + 16, true), view.getFloat32(fo + 20, true)],
      v: [], cmdofs: cmds.length << 2
    };
    for (var si2 = 0; si2 < surfs.length; si2++) {
      const su2 = surfs[si2];
      const poseBase = su2.ofsXyz + f * su2.numVerts * 8; // md3XyzNormal: short xyz[3], byte latlong[2]
      for (var cc = 0; cc < su2.corners.length; cc++) {
        const vo = poseBase + su2.corners[cc] * 8;
        const x = view.getInt16(vo, true) * (1 / 64);
        const y = view.getInt16(vo + 2, true) * (1 / 64);
        const z = view.getInt16(vo + 4, true) * (1 / 64);
        // lat/long encoded normal, decoded like QSS gl_mesh.c:296-300 (unit float here)
        const lat = view.getUint8(vo + 6) * (2 * Math.PI / 255);
        const lng = view.getUint8(vo + 7) * (2 * Math.PI / 255);
        const slat = Math.sin(lat);
        cmds.push(x, y, z, Math.cos(lng) * slat, Math.sin(lng) * slat, Math.cos(lat));
        if (x < mins[0]) mins[0] = x; if (x > maxs[0]) maxs[0] = x;
        if (y < mins[1]) mins[1] = y; if (y > maxs[1]) maxs[1] = y;
        if (z < mins[2]) mins[2] = z; if (z > maxs[2]) maxs[2] = z;
        const d = x * x + y * y + z * z;
        if (d > radiusSq) radiusSq = d;
      }
    }
    loadmodel.frames[f] = frame;
  }

  loadmodel.numframes = numFrames;
  loadmodel.numtris = unrolled / 3;
  loadmodel.numverts = unrolled;
  loadmodel.random = false;
  loadmodel.flags = flags; // QSS borrows quake1 model flags from the md3 header
  loadmodel.mins = mins;
  loadmodel.maxs = maxs;
  // Real per-vertex radius (md3 ships real bounds, unlike the garbage mdl boundingradius);
  // feeds the same cull sphere the mdl path recomputes.
  loadmodel.boundingradius = Math.sqrt(radiusSq);
  loadmodel.nolerp = NOLERP_LIST.indexOf(loadmodel.name) !== -1;

  // --- skins + GPU upload (GL only; dedicated server needs neither) ---
  loadmodel.skins = [];
  loadmodel.numskins = 0;
  if (gl) {
    const placeholder = md3PlaceholderSkin();
    const dir = md3DirName(loadmodel.name);
    const outSurfaces: Md3Surface[] = [];
    for (var si3 = 0; si3 < surfs.length; si3++) {
      const su3 = surfs[si3];
      // QSS clamps a surface to [1 .. min(numShaders, 4)] skins (gl_mesh.c:698)
      const numskins = Math.max(1, Math.min(4, su3.numShaders));
      const skins: GLTexture[] = [];
      const surface: Md3Surface = { name: su3.name, first: su3.first, count: su3.numTris * 3, skins };
      for (var j = 0; j < numskins; j++) {
        skins[j] = placeholder;
        // texture-name resolution follows QSS gl_mesh.c:706-728
        var texname: string;
        if (j >= su3.numShaders) {
          texname = dir + su3.name; // no shader for this index -> dir + polyset name
        } else {
          const shname = q.memstr(new Uint8Array(buffer, su3.ofsShaders + j * 68, 64)); // md3Shader: name[64], int
          if (shname.indexOf('/') >= 0 || shname.indexOf('\\') >= 0)
            texname = shname;         // has a path -> use as-is
          else if (shname.length > 0)
            texname = dir + shname;   // bare name -> prefix with the model's dir
          else
            texname = dir + su3.name; // empty shader -> polyset name
        }
        resolveMd3Skin(loadmodel, surface, j, md3StripExtension(texname));
      }
      if (numskins > loadmodel.numskins) loadmodel.numskins = numskins;
      outSurfaces.push(surface);
    }
    loadmodel.surfaces = outSurfaces;

    const cmdsArray = new Float32Array(cmds);
    loadmodel.cmds = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, loadmodel.cmds);
    gl.bufferData(gl.ARRAY_BUFFER, cmdsArray, gl.STATIC_DRAW);
    // WebGPU backend: retain the interleaved pose/texcoord data so the WebGPU renderer can upload
    // its own alias VBO (keyed by this array's identity). Additive + backend-gated (pixel-identical
    // under WebGL, which reads from the GL buffer above).
    if (getRenderer().backend === 'webgpu')
      loadmodel.cmdsData = cmdsArray;
  }
};

export const loadAliasModel = function(buffer: ArrayBuffer)
{
  var i, j, k, l;

  loadmodel.type = TYPE.alias;
  loadmodel.player = loadmodel.name === 'progs/player.mdl';
  var model = new DataView(buffer);
  var version = model.getUint32(4, true);
  if (version !== VERSION.alias)
    sys.error(loadmodel.name + ' has wrong version number (' + version + ' should be ' + VERSION.alias + ')');
  loadmodel.scale = [model.getFloat32(8, true), model.getFloat32(12, true), model.getFloat32(16, true)];
  loadmodel.scale_origin = [model.getFloat32(20, true), model.getFloat32(24, true), model.getFloat32(28, true)];
  loadmodel.boundingradius = model.getFloat32(32, true);
  loadmodel.numskins = model.getUint32(48, true);
  if (loadmodel.numskins === 0)
    sys.error('model ' + loadmodel.name + ' has no skins');
  loadmodel.skinwidth = model.getUint32(52, true);
  loadmodel.skinheight = model.getUint32(56, true);
  loadmodel.numverts = model.getUint32(60, true);
  if (loadmodel.numverts === 0)
    sys.error('model ' + loadmodel.name + ' has no vertices');
  loadmodel.numtris = model.getUint32(64, true);
  if (loadmodel.numtris === 0)
    sys.error('model ' + loadmodel.name + ' has no triangles');
  loadmodel.numframes = model.getUint32(68, true);
  if (loadmodel.numframes === 0)
    sys.error('model ' + loadmodel.name + ' has no frames');
  loadmodel.random = model.getUint32(72, true) === 1;
  loadmodel.flags = model.getUint32(76, true);
  loadmodel.mins = [-16.0, -16.0, -16.0];
  loadmodel.maxs = [16.0, 16.0, 16.0];

  var inmodel = loadAllSkins(buffer, 84);

  loadmodel.stverts = [];
  for (i = 0; i < loadmodel.numverts; ++i)
  {
    loadmodel.stverts[i] = {
      onseam: model.getUint32(inmodel, true) !== 0,
      s: model.getUint32(inmodel + 4, true),
      t: model.getUint32(inmodel + 8, true)
    };
    inmodel += 12;
  }

  loadmodel.triangles = [];
  for (i = 0; i < loadmodel.numtris; ++i)
  {
    loadmodel.triangles[i] = {
      facesfront: model.getUint32(inmodel, true) !== 0,
      vertindex: [
        model.getUint32(inmodel + 4, true),
        model.getUint32(inmodel + 8, true),
        model.getUint32(inmodel + 12, true)
      ]
    };
    inmodel += 16;
  }

  loadAllFrames(buffer, inmodel);

  var cmds = [];

  var triangle, vert, s;
  for (i = 0; i < loadmodel.numtris; ++i)
  {
    triangle = loadmodel.triangles[i];
    if (triangle.facesfront === true)
    {
      vert = loadmodel.stverts[triangle.vertindex[0]];
      cmds[cmds.length] = (vert.s + 0.5) / loadmodel.skinwidth;
      cmds[cmds.length] = (vert.t + 0.5) / loadmodel.skinheight;
      vert = loadmodel.stverts[triangle.vertindex[1]];
      cmds[cmds.length] = (vert.s + 0.5) / loadmodel.skinwidth;
      cmds[cmds.length] = (vert.t + 0.5) / loadmodel.skinheight;
      vert = loadmodel.stverts[triangle.vertindex[2]];
      cmds[cmds.length] = (vert.s + 0.5) / loadmodel.skinwidth;
      cmds[cmds.length] = (vert.t + 0.5) / loadmodel.skinheight;
      continue;
    }
    for (j = 0; j < 3; ++j)
    {
      vert = loadmodel.stverts[triangle.vertindex[j]];
      if (vert.onseam === true)
        cmds[cmds.length] = (vert.s + loadmodel.skinwidth / 2 + 0.5) / loadmodel.skinwidth;
      else
        cmds[cmds.length] = (vert.s + 0.5) / loadmodel.skinwidth;
      cmds[cmds.length] = (vert.t + 0.5) / loadmodel.skinheight;
    }
  }

  var group: AliasFrameGroup, frame: AliasFrame;
  for (i = 0; i < loadmodel.numframes; ++i)
  {
    if (loadmodel.frames[i].group === true)
    {
      group = loadmodel.frames[i] as AliasFrameGroup
      for (j = 0; j < group.frames.length; ++j)
      {
        frame = group.frames[j];
        frame.cmdofs = cmds.length << 2;
        for (k = 0; k < loadmodel.numtris; ++k)
        {
          triangle = loadmodel.triangles[k];
          for (l = 0; l < 3; ++l)
          {
            vert = frame.v[triangle.vertindex[l]];
            if (vert.lightnormalindex >= 162)
              sys.error('lightnormalindex >= NUMVERTEXNORMALS');
            cmds[cmds.length] = vert.v[0] * loadmodel.scale[0] + loadmodel.scale_origin[0];
            cmds[cmds.length] = vert.v[1] * loadmodel.scale[1] + loadmodel.scale_origin[1];
            cmds[cmds.length] = vert.v[2] * loadmodel.scale[2] + loadmodel.scale_origin[2];
            cmds[cmds.length] = r.state.avertexnormals[vert.lightnormalindex][0];
            cmds[cmds.length] = r.state.avertexnormals[vert.lightnormalindex][1];
            cmds[cmds.length] = r.state.avertexnormals[vert.lightnormalindex][2];
          }
        }
      }
      continue;
    }
    frame = loadmodel.frames[i] as AliasFrame;
    frame.cmdofs = cmds.length << 2;
    for (j = 0; j < loadmodel.numtris; ++j)
    {
      triangle = loadmodel.triangles[j];
      for (k = 0; k < 3; ++k)
      {
        vert = frame.v[triangle.vertindex[k]];
        if (vert.lightnormalindex >= 162)
          sys.error('lightnormalindex >= NUMVERTEXNORMALS');
        cmds[cmds.length] = vert.v[0] * loadmodel.scale[0] + loadmodel.scale_origin[0];
        cmds[cmds.length] = vert.v[1] * loadmodel.scale[1] + loadmodel.scale_origin[1];
        cmds[cmds.length] = vert.v[2] * loadmodel.scale[2] + loadmodel.scale_origin[2];
        cmds[cmds.length] = r.state.avertexnormals[vert.lightnormalindex][0];
        cmds[cmds.length] = r.state.avertexnormals[vert.lightnormalindex][1];
        cmds[cmds.length] = r.state.avertexnormals[vert.lightnormalindex][2];
      }
    }
  }
  // The MDL header's boundingradius is tool-written and often garbage/zero in modern
  // models (AD items/props) -- a ~0 radius turns cullBox into a point test, popping the
  // entity at screen edges while still mostly visible (origin-out = model-out). Recompute
  // from the decoded pose verts like QuakeSpasm's Mod_CalcAliasBounds. cmds layout:
  // texcoord block (numtris*3*2 floats) then per-pose [x y z nx ny nz] blocks.
  var radiusSq = 0.0;
  for (i = loadmodel.numtris * 6; i < cmds.length; i += 6) {
    var vd = cmds[i] * cmds[i] + cmds[i + 1] * cmds[i + 1] + cmds[i + 2] * cmds[i + 2];
    if (vd > radiusSq) radiusSq = vd;
  }
  loadmodel.boundingradius = Math.sqrt(radiusSq);

  const gl = GL.getContext()
  if (gl) {
    const cmdsArray = new Float32Array(cmds);
    loadmodel.cmds = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, loadmodel.cmds);
    gl.bufferData(gl.ARRAY_BUFFER, cmdsArray, gl.STATIC_DRAW);
    // WebGPU backend: retain the interleaved pose/texcoord data for the WebGPU alias VBO (keyed by
    // this array's identity). Additive + backend-gated — WebGL reads the GL buffer above.
    if (getRenderer().backend === 'webgpu')
      loadmodel.cmdsData = cmdsArray;
  }

  loadmodel.nolerp = NOLERP_LIST.indexOf(loadmodel.name) !== -1;
};

export const loadSpriteFrame = function(identifier: string, buffer: ArrayBuffer, inframe: number, frame: Partial<SpriteFrame>)
{
  const gl = GL.getContext()
  var i;

  var model = new DataView(buffer);
  frame.origin = [model.getInt32(inframe, true), -model.getInt32(inframe + 4, true)];
  frame.width = model.getUint32(inframe + 8, true);
  frame.height = model.getUint32(inframe + 12, true);
  var size = frame.width * frame.height;

  var glt: GLTexture;
  for (i = 0; i < tx.state.textures.length; ++i)
  {
    glt = tx.state.textures[i];
    if (glt.identifier === identifier)
    {
      // JOE:FIXME: width height undefined! This was in the original code though
      //if ((width !== glt.width) || (height !== glt.height))
      sys.error('Mod.LoadSpriteFrame: cache mismatch');
      frame.texturenum = glt.texnum;
      return inframe + 16 + frame.width * frame.height;
    }
  }

  var data = new Uint8Array(buffer, inframe + 16, size);
  var scaled_width = frame.width, scaled_height = frame.height;
  if (((frame.width & (frame.width - 1)) !== 0) || ((frame.height & (frame.height - 1)) !== 0))
  {
    --scaled_width;
    scaled_width |= (scaled_width >> 1);
    scaled_width |= (scaled_width >> 2);
    scaled_width |= (scaled_width >> 4);
    scaled_width |= (scaled_width >> 8);
    scaled_width |= (scaled_width >> 16);
    ++scaled_width;
    --scaled_height;
    scaled_height |= (scaled_height >> 1);
    scaled_height |= (scaled_height >> 2);
    scaled_height |= (scaled_height >> 4);
    scaled_height |= (scaled_height >> 8);
    scaled_height |= (scaled_height >> 16);
    ++scaled_height;
  }
  if (scaled_width > tx.state.maxtexturesize)
    scaled_width = tx.state.maxtexturesize;
  if (scaled_height > tx.state.maxtexturesize)
    scaled_height = tx.state.maxtexturesize;
  if ((scaled_width !== frame.width) || (scaled_height !== frame.height))
  {
    size = scaled_width * scaled_height;
    if (gl) {
      data = tx.resampleTexture(data, frame.width, frame.height, scaled_width, scaled_height);
    }
  }

  var trans = new ArrayBuffer(size << 2);
  var trans32 = new Uint32Array(trans);
  for (i = 0; i < size; ++i)
  {
    if (data[i] !== 255)
      trans32[i] = com.state.littleLong(vid.d_8to24table[data[i]] + 0xff000000);
  }
  if (gl) {
    glt = {
      texnum: gl.createTexture(), 
      identifier: identifier, 
      width: frame.width, 
      height: frame.height,
      owner: null
    };
    tx.bind(0, glt.texnum);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, scaled_width, scaled_height, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(trans));
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, tx.state.filter_min);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, tx.state.filter_max);
    tx.state.textures[tx.state.textures.length] = glt;
    frame.texturenum = glt.texnum;
    // WebGPU backend: retain the expanded (power-of-two-scaled) RGBA on the sprite-frame texture handle
    // so the WebGPU renderer can upload its own GPUTexture (keyed by this handle). Additive + backend-
    // gated — under WebGL2 these fields are never set, so that path stays pixel-identical.
    if (getRenderer().backend === 'webgpu') {
      const t = glt.texnum as unknown as { rgba: Uint8Array; rgbaW: number; rgbaH: number };
      t.rgba = new Uint8Array(trans);
      t.rgbaW = scaled_width;
      t.rgbaH = scaled_height;
    }
  }
  return inframe + 16 + frame.width * frame.height;
}

export const loadSpriteModel = function(buffer: ArrayBuffer)
{
  loadmodel.type = TYPE.sprite;
  var model = new DataView(buffer);
  var version = model.getUint32(4, true);
  if (version !== VERSION.sprite)
    sys.error(loadmodel.name + ' has wrong version number (' + version + ' should be ' + VERSION.sprite + ')');
  loadmodel.oriented = model.getUint32(8, true) === 3;
  loadmodel.boundingradius = model.getFloat32(12, true);
  loadmodel.width = model.getUint32(16, true);
  loadmodel.height = model.getUint32(20, true);
  loadmodel.numframes = model.getUint32(24, true);
  if (loadmodel.numframes === 0)
    sys.error('model ' + loadmodel.name + ' has no frames');
  loadmodel.random = model.getUint32(32, true) === 1;
  loadmodel.mins = [loadmodel.width * -0.5, loadmodel.width * -0.5, loadmodel.height * -0.5];
  loadmodel.maxs = [loadmodel.width * 0.5, loadmodel.width * 0.5, loadmodel.height * 0.5];

  loadmodel.frames = [];
  var inframe = 36, i, j, frame: Partial<SpriteFrame>, group: Partial<SpriteFrameGroup>, numframes;
  for (i = 0; i < loadmodel.numframes; ++i)
  {
    inframe += 4;
    if (model.getUint32(inframe - 4, true) === 0)
    {
      frame = {
        type: 'sprite',
        group: false
      };
      loadmodel.frames[i] = frame as SpriteFrame;
      inframe = loadSpriteFrame(loadmodel.name + '_' + i + '_' + j, buffer, inframe, frame);
    }
    else
    {
      group = {
        type: 'sprite',
        group: true,
        frames: []
      };
      loadmodel.frames[i] = group as SpriteFrameGroup;
      numframes = model.getUint32(inframe, true);
      inframe += 4;
      for (j = 0; j < numframes; ++j)
      {
        const spriteFrame: Partial<SpriteFrame> = {type: 'sprite', group: false, interval: model.getFloat32(inframe, true)}
        group.frames[j] = spriteFrame as SpriteFrame
        if (group.frames[j].interval <= 0.0)
          sys.error('Mod.LoadSpriteModel: interval<=0');
        inframe += 4;
      }
      for (j = 0; j < numframes; ++j)
        inframe = loadSpriteFrame(loadmodel.name + '_' + i + '_' + j, buffer, inframe, group.frames[j]);
    }
  }
};

export const print = function()
{
  con.print('Cached models:\n');
  var i;
  for (i = 0; i < known.length; ++i)
    con.print(known[i].name + '\n');
};