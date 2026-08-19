import { GLTexture } from "../texture.js"
import { Entity } from "./Entity.js"
import { V3, V4 } from "./Vector.js"
import type { BspxDirectory } from "../bspx.js"

export enum TexChain {
  world = 0,
  model
} 

export type UnloadedModel = {
  name: string
  needload: true
}

export type EFrags = {
  leafnext: EFrags | null
  entity: Entity
}

export type ClipNode = {
  planenum: number;
  children: [number, number];
}


export type Texture = {
  name: string;
  width: number;
  height: number;
  texturenum: WebGLTexture
  // additive luma companion (fullbright palette texels 224-255), null when the miptex has none
  fullbright?: WebGLTexture | null
  texturechains: Record<TexChain, Face>;
  turbulent: boolean;
  sky: boolean;
  anims: number[]
  alternate_anims: number[]
  anim_base: number
  anim_frame: number
}

export type Hull = {
  firstclipnode?: number;
  lastclipnode: number;
  planes: Plane[];
  clip_mins: V3;
  clip_maxs: V3;
  clipnodes: ClipNode[]
  // Flat clipnode/plane arrays, derived read-only at load. Absent on the box
  // hull, whose plane dists are mutated per query (hullForBox) — the clip
  // functions branch on `flat != null`.
  flat?: HullFlat
}

// SoA mirror of a hull's clipnodes plus the owning model's plane SoA.
// clipChildren values: >= 0 next clipnode index, < 0 CONTENTS_* value,
// exactly as stored in ClipNode.children.
export type HullFlat = {
  clipPlane: Int32Array
  clipChildren: Int32Array
  planeNormal: Float64Array
  planeDist: Float64Array
  planeType: Uint8Array
}


export type Node = {
  num: number;
  contents: number;
  planenum?: number;
  children: [Node | Leaf, Node | Leaf];
  childrenNum?: [number, number];
  mins: V3;
  maxs: V3;
  firstface: number;
  numfaces: number;
  cmds: number[];
  plane: Plane;
  parent?: Node
  // per-frame mutable state lives in the owning Model's nodeMarkvisframe,
  // indexed by `num` — see Model type
}

export type Leaf = {
  num: number;
  contents: number;
  visofs: number;
  mins: V3;
  maxs: V3;
  firstmarksurface: number;
  nummarksurfaces: number;
  ambient_level: V4;
  cmds: [],
  skychain: 0,
  waterchain: 0
  parent: Node
  efrags: EFrags
  // per-frame mutable state lives in the owning Model's leafMarkvisframe,
  // indexed by `num` — see Model type
}
export type Face = {
  num: number;
  plane: Plane;
  side: number;
  firstedge: number;
  numedges: number;
  texinfo: number;
  // styles/texturemins/extents now live in the owning Model's SoA arrays
  // (faceStyles/faceNumStyles/faceTexturemins/faceExtents), indexed by num.
  lightofs: number;
  texture: number;
  flags: number;
  sky: boolean;
  turbulent: boolean;
  // BSPX LMSHIFT: texels-per-luxel = 1<<lmshift (4 = classic 16). Replaces the
  // hardcoded >>4 in extents/lightmap-block/ST/sample math. Default 4 absent.
  lmshift: number;
  // BSPX DECOUPLED_LM (ericw-tools -world_units_per_luxel): per-face lightmap
  // sizing + world->lightmap projection independent of texinfo/extents. When
  // `decoupled`, lightmap block size is lmwidth/lmheight (luxel counts) and UVs
  // / point sampling come from lmvecs (s = dot(pos,lmvecs[0..2]) + lmvecs[3], in
  // luxels, texturemins folded in). Classic extents stay for turb/sky/culling.
  decoupled: boolean;
  lmwidth: number;
  lmheight: number;
  lmvecs: Float32Array | null; // [s.x,s.y,s.z,s.w, t.x,t.y,t.z,t.w] or null

  // vertex staging now lives in the owning Model's shared polyVertData at
  // surfVertOfs[num] (POLY_VERT_STRIDE floats/vertex, numedges vertices)
  light_t: number
  light_s: number
  texturechain: Face
  lightmaptexturenum: number
  vbo_firstvert: number,
  // per-frame mutable state lives in the owning Model's surfVisframe /
  // surfVisibleFrame, indexed by `num`
}

export type NodeLeaf = Node | Leaf

export type Plane = {
  normal: V3;
  dist: number;
  type: number;
  signbits: number
}

export type TexInfo = {
  vecs: [V4, V4]
  texture: number;
  flags: number;
}


export type Skin = {
  group: false;
  texturenum: GLTexture
  playertexture: WebGLTexture
  // Retained 512x256 RGBA colormap mask (WebGPU only — it can't sample `playertexture`).
  // R/G = top shade/mask, B/A = bottom shade/mask; see mod.translatePlayerSkin.
  playerRgba?: Uint8Array
  interval: number
}

export type SkinGroup = {
  group: true,
  skins?: Skin[]
}

export type FrameVert = {
  lightnormalindex: number
  v: V3
}

// One MD3 surface baked into the shared alias `cmds` VBO. `first`/`count` are vertex
// ranges into the unrolled-triangle-soup layout (drawArrays TRIANGLES, first, count);
// `skins` are the surface's external textures selected by entity skinnum. Present only
// on md3-derived alias models; its presence is what routes drawAliasModel to per-surface
// draws (mdl models leave it undefined and take the single-draw path unchanged).
export type Md3Surface = {
  name: string
  first: number
  count: number
  skins: GLTexture[]
}

export type AliasFrameGroup = {
  type: 'alias'
  group: true,
  bboxmin: V3,
  bboxmax: V3,
  frames: AliasFrame[]
}

export type AliasFrame = {
  type: 'alias'
  group: false,
  name: string
  numposes: number,
  bboxmin: V3,
  bboxmax: V3,
  interval: number,
  v: FrameVert[],
  cmdofs: number
  // Sprite?
}

export type SpriteFrame = {
  type: 'sprite'
  group: false,
  origin: [number, number]
  width: number
  height: number
  texturenum: WebGLTexture
  interval: number,
}
export type SpriteFrameGroup = {
  type: 'sprite'
  group: true,
  frames: SpriteFrame[]
}

export type Frame = AliasFrame | AliasFrameGroup | SpriteFrame | SpriteFrameGroup

export type StVert = {
  onseam: boolean,
  s: number;
  t: number
}
export type Triangle = {
  facesfront: boolean;
  vertindex: V3
}

// One draw range of a brush submodel's precomputed static index set, grouped by
// base texture and opaque-vs-fence (they use different pipelines). first/count
// index into BrushPrecompute.indexData.
export type BrushPrecomputeSlot = {
  textureIndex: number   // index into Model.textures (the base texture)
  isFence: boolean       // def.SURF.drawfence → alpha-test pipeline
  first: number          // start offset into indexData
  count: number          // index count for this (texture, fence) run
}

// WebGPU-only: a precomputed static index set for an opaque PURE-SOLID brush
// submodel (no water/turb faces). Lets the WebGPU backend draw such a brush
// entity (door/platform/func_ brushwork) without r.drawBrushModel's per-frame,
// per-face CPU backface walk + re-chain — it draws every drawable face's fan
// indices statically; the extra back-faces are harmless depth-culled overdraw,
// so the image is identical for closed opaque models. indexData holds global
// world-VBO vertex indices (shared worldVBuf) grouped into slots.
export type BrushPrecompute = {
  indexData: Uint32Array           // concatenated fan indices (global vertex indices)
  slots: BrushPrecomputeSlot[]     // draw ranges, grouped by (textureIndex, isFence)
}

// One draw range of the WebGL2 brush-submodel precompute: a single drawElements
// with texture `textureIndex`, alpha-test per `isFence`, and lightmap page `lmpage`
// bound. first/count are index offsets into the submodel's static GL index buffer.
export type BrushPrecomputeGLSlot = {
  textureIndex: number
  isFence: boolean
  lmpage: number
  first: number
  count: number
}

// WebGL2 counterpart of BrushPrecompute. Unlike the WebGPU version (which draws a
// whole texture at once against a consolidated lightmap array), WebGL binds one
// lightmap page per draw, so slots are additionally split by lightmap page. `buffer`
// is a STATIC_DRAW ELEMENT_ARRAY_BUFFER of all the submodel's drawable fan indices,
// ordered so each slot's range is contiguous. `worldVbo` is the WebGLBuffer the
// indices reference — a mismatch (map change) invalidates the cache.
export type BrushPrecomputeGL = {
  buffer: WebGLBuffer
  slots: BrushPrecomputeGLSlot[]
  worldVbo: WebGLBuffer
}

export type Model = {
  name: string
  type: number;
  player: boolean;
  firstface: number
  numfaces: number;
  cmds: WebGLBuffer;
  // WebGPU backend: the interleaved alias pose/texcoord data (texcoord block then per-pose
  // pos+normal blocks) retained so the WebGPU renderer can upload its own GPUBuffer. Additive +
  // backend-gated in mod.ts — under WebGL this stays null (pixel-identical).
  cmdsData?: Float32Array | null;

  submodels: Model[];
  // r_litwater: true when loadFaces found a turb face with real lightmap
  // samples (not TEX.special, lightofs valid). Only meaningful on the
  // worldmodel — submodels/brush entities share its liquid data and the
  // renderer always checks cl.clState.worldmodel.haslitwater (matches
  // Ironwail's cl.worldmodel->haslitwater).
  haslitwater: boolean;
  visleafs: number;
  numleafs: number;
  mins: V3;
  maxs: V3;
  hulls: Hull[];
  textures: Texture[];
  lightdata: Uint8Array;
  visdata: Uint8Array;
  entities: string;
  planes: Plane[];
  nodes: Node[];
  // Node COUNT — authoritative even when `nodes` is left empty on the render-only
  // client (which builds nodePacked directly from the BSP lump; see mod.loadNodes).
  numNodes: number;
  // Transient handle to the raw nodes lump (cleared after buildFlatBsp), so the flat
  // node SoA can be built without ever allocating the fat Node objects on the client.
  nodeLump?: { view: DataView, fileofs: number, count: number, version: number } | null;
  clipnodes: ClipNode[]
  leafs: Leaf[]
  // flat typed arrays (BSP geometry): edges = 2 vertex indices per edge,
  // surfedges = signed edge refs, vertexes = 3 floats per vertex. Flattened
  // from arrays-of-arrays to keep 3.5M edges + 1.7M vertexes off the V8 object
  // heap on huge maps. Read via mod.readVertexInto / edge index math.
  edges: Uint32Array
  texinfo: TexInfo[]
  faces: Face[]
  surfedges: Int32Array
  marksurfaces: number[]
  skinwidth: number
  skinheight: number
  radius: number
  scale: V3;
  scale_origin: V3;
  boundingradius: number;
  oriented: boolean
  width: number
  height: number

  numtris: number
  triangles: Triangle[]

  random: boolean
  flags: number
  nolerp: boolean // true for models on Ironwail's r_nolerp_list (flames, torches, view weapons that shouldn't blend)

  numskins: number;
  skins: (Skin | SkinGroup)[]

  numframes: number;
  frames: Frame[]

  // md3-only: per-surface skin ranges into `cmds`. undefined for mdl models.
  surfaces?: Md3Surface[]

  numverts: number;
  vertexes: Float32Array; // 3 floats per vertex

  stverts: StVert[]
  submodel: boolean
  origin: V3

  // Dense per-frame render state, indexed by node/leaf/surf.num — flat and
  // shared with submodels (which share the same underlying faces array) so
  // surfVisframe/surfVisibleFrame indices line up across model and submodels[i].
  nodeMarkvisframe: Int32Array
  leafMarkvisframe: Int32Array
  surfVisframe: Int32Array
  // Stamped with r.state.frustumFrame by markWorldFrustum for every marksurface
  // reachable from an in-PVS, in-frustum node whose owning node also faces the
  // camera (see surfPlaneBack) — consumers compare against the current frame's
  // stamp instead of re-testing each surface's own plane/bbox.
  surfVisibleFrame: Int32Array

  // SoA mirror of the BSP tree, derived read-only at load and verified
  // against the object graph (verifyFlatBsp). Child values (in nodePacked):
  // >= 0 node index, < 0 encodes leaf -1-leafIndex (C convention).
  // nodeParent/leafParent: parent node index, -1 = root/none.
  nodePlane: Int32Array
  nodeParent: Int32Array
  // markWorldFrustum's per-node record: one 16-element (64B) slot per node,
  // two typed-array views over the same buffer so a visit costs 1-2 cache
  // lines instead of touching 7 separate arrays. base = idx * 16.
  //   f32[base+0..2]  mins xyz          f32[base+9]   plane dist
  //   f32[base+3..5]  maxs xyz          i32[base+10]  plane type
  //   f32[base+6..8]  plane normal xyz  i32[base+11]  firstFace
  //   i32[base+12]    numFaces          i32[base+13]  child0
  //   i32[base+14]    child1            [base+15]     unused (padding)
  // Does NOT include nodeMarkvisframe: that array is rewritten per view-leaf
  // chain rebuild by markAncestorsVisible, so it stays a separate array —
  // the walk reads it first as a PVS gate and only touches this record for
  // nodes that pass, which also means culled nodes skip this cache line.
  nodePacked: Float32Array
  nodePackedI32: Int32Array
  // Deepest node path (root = depth 1); sizes markWorldFrustum's DFS stack.
  bspMaxDepth: number
  leafContents: Int32Array
  leafParent: Int32Array
  // SoA of the Leaf fields the render/PVS path reads, so the worker-mode client
  // (server is on the Worker) can drop the Leaf objects. Indexed by leaf num.
  // leafEfrags is the per-leaf efrag list head (entity fragments), still object
  // links. leafAmbientLevel is 4 bytes/leaf (ambient sound levels).
  leafVisofs: Int32Array
  leafFirstMarksurface: Int32Array
  leafNumMarksurfaces: Int32Array
  leafEfrags: (EFrags | null)[]
  leafAmbientLevel: Uint8Array
  planeNormal: Float64Array
  planeDist: Float64Array
  planeType: Uint8Array
  planeSignbits: Uint8Array
  // 1 where the face is on the back side of its owning node's plane
  // (def.SURF.planeback); indexed by Face.num.
  surfPlaneBack: Uint8Array

  // Flat per-face mirrors of Face.flags/lightmaptexturenum, indexed by
  // Face.num, so per-frame draw loops never dereference Face objects.
  // surfFlags is filled at load; surfLightmapPage once lightmap pages are
  // assigned (lightmap.createSurfaceLightmap).
  surfFlags: Int32Array
  surfLightmapPage: Int32Array

  // SoA replacements for the old per-Face array fields (indexed by Face.num) so
  // the objects don't each carry ~5 tiny heap-allocated arrays. faceStyles holds
  // MAXLIGHTMAPS(4) style bytes/face, faceNumStyles the count of ACTIVE styles
  // (loadFaces stores only non-255 styles contiguously; = the lightmap layer
  // count). faceExtents/faceTexturemins are 2/face.
  faceStyles: Uint8Array
  faceNumStyles: Uint8Array
  faceExtents: Int32Array
  faceTexturemins: Int32Array

  // Prebuilt triangle-fan indices for the world VBO (same generation as the
  // old triangleIndicesForSurf), concatenated across all faces. ofs/count
  // are BSP-derived (known at load); the index values in surfIndexData are
  // filled once vbo_firstvert is assigned (r.buildModelVertexBuffer).
  surfIndexData: Uint32Array
  surfIndexOfs: Int32Array
  surfIndexCount: Int32Array

  // One shared vertex-staging buffer for the whole model (POLY_VERT_STRIDE
  // floats per vertex): xyz + diffuse st + lightmap st. surfVertOfs[faceIndex]
  // is the face's first vertex; a face has numedges verts. Replaces the old
  // per-face Face.polys.verts — on a 1.7M-face BSP2 that was 1.7M tiny typed
  // arrays whose wrapper overhead alone was ~700MB. Feeds buildModelVertexBuffer.
  polyVertData: Float32Array
  surfVertOfs: Int32Array

  // Flat mirror of the world (TexChain.world) texture chains, rebuilt in
  // r.markSurfaces whenever the linked chains are rebuilt (PVS change).
  // worldChainFaces holds Face.num values grouped by texture; texture i's
  // range is [worldChainOfs[i], worldChainOfs[i] + worldChainCount[i]).
  worldChainFaces: Int32Array
  worldChainOfs: Int32Array
  worldChainCount: Int32Array

  // Deduped texture indices (into `textures`) referenced by this model's own
  // faces (faces[firstface..firstface+numfaces)). Lets per-entity texture
  // chain scans skip the full world texture array for brush entities, which
  // typically touch only a handful of textures. Built once at load time.
  usedTextures: Int32Array

  // Set by r.buildBrushPrecompute (load time, backend-agnostic): true for an
  // opaque PURE-SOLID inline brush submodel (door/platform/func_ brushwork with
  // no water/turb faces and at least one drawable face). Gates the precompute
  // fast path in r.drawBrushModel for BOTH backends; each backend then builds
  // its own representation on first draw.
  brushPrecomputeEligible?: boolean

  // WebGPU precomputed static index set for an eligible brush submodel (see
  // BrushPrecompute). Built in r.buildBrushPrecompute (WebGPU backend only);
  // null for the worldmodel, ineligible submodels, and under WebGL2 (which
  // keeps its own per-lightmap-page representation in the WebGL renderer).
  brushPrecompute: BrushPrecompute | null

  // WebGL2 precomputed static draw for an eligible brush submodel: one static
  // ELEMENT_ARRAY_BUFFER holding all drawable faces' fan indices, grouped into
  // contiguous (base texture, fence, lightmap page) runs so each run is a single
  // drawElements with one bound lightmap page. Built lazily on first draw in the
  // WebGL renderer, keyed off the world-VBO identity (dropped on map change).
  brushPrecomputeGL?: BrushPrecomputeGL | null

  // BSPX extension lump directory (bspx.parse), null when the map has none.
  // Discovery only for now - see src/engine/bspx.ts.
  bspx: BspxDirectory | null
}
