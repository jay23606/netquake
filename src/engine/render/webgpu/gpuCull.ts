/// <reference types="@webgpu/types" />
// Load-time GPU-cull data buffers.
//
// Stages the static GPU buffers the compute-cull pass (cullShaders.ts) reads. The Ironwail-adapted
// design: one thread per marksurface (a leaf->surface reference) tests the leaf's PVS bit, does
// frustum-AABB + backface, dedups via cullSeenBuf, then atomicAdds the surface's prebuilt fan indices
// into a per-draw-slot region of cullIndexBuf while bumping that slot's drawIndexedIndirect indexCount.
// The result is one drawIndexedIndirect per texture batch, WebGPU having no multidraw. Covers every
// drawWorldSurfaces pass — opaque, fence, lit-water and turb — each slot tagged with a CullKind the draw
// side routes. Sky stays on the CPU path, its prime needing CPU-side visibility for skyroom.
//
// Built once per map, keyed off the world-VBO Float32Array identity. The caller wraps the whole build in
// try/catch and logs+continues, so a failure here can never break the working map load.
//
// ============================ std430 BUFFER LAYOUTS (the cull pass consumes these) ============================
//
// cullSrcIndexBuf : array<u32>            — verbatim copy of model.surfIndexData (prebuilt fan indices,
//                                           global world-VBO vertex indices). Static, read-only storage.
//
// cullSurfBuf     : array<Surf>, stride 64 bytes, one entry per SOLID world surface. std430:
//   offset  0  plane      : vec4<f32>  = [nx, ny, nz, dist], SURF_PLANEBACK-signed (see below) so
//                                        `dot(plane.xyz, vieworg) < plane.w` == backface (cull).
//   offset 16  minsFirst  : vec4<f32>  = [mins.x, mins.y, mins.z, 0]   (surface AABB min; .w pad/unused)
//   offset 32  maxsCount  : vec4<f32>  = [maxs.x, maxs.y, maxs.z, 0]   (surface AABB max; .w pad/unused)
//   offset 48  meta       : vec4<u32>  = [srcFirstIndex, indexCount, drawSlot, 0]
//                                        srcFirstIndex = first index of this surface's fan in
//                                        cullSrcIndexBuf; indexCount = number of indices (3*(numedges-2));
//                                        drawSlot = which draw-batch (0..numSlots-1) this surface belongs to.
//
// cullMarksurfBuf : array<vec2<u32>>, stride 8 bytes, one entry per leaf->solid-surface reference:
//   .x = packedleafsky — bit 0 = the leaf is CONTENTS_SKY, bits 1.. = leafIndex (index into model.leafs;
//        leafIndex is also the bit index into cullVisBuf). Ironwail's bmodel_gpu_marksurf_t packing: the
//        sky bit lets the shader honour r_oldskyleaf without rebuilding the buffer.
//   .y = surfIndex  (index into cullSurfBuf)
//   A surface appears once per leaf that references it, so it recurs across many entries — hence the
//   per-surface dedup (cullSeenBuf) in the cull pass. immortal has millions of these; the buffer is sized to fit.
//
// cullIndirectBuf : array<DrawCmd>, stride 20 bytes, one per draw slot. WebGPU drawIndexedIndirect args:
//   offset  0  indexCount    : u32  = 0    (compute atomicAdds each surface's indexCount into this)
//   offset  4  instanceCount : u32  = 1
//   offset  8  firstIndex    : u32  = baseIndex[slot]   (slot's start in cullIndexBuf; NOT bumped by compute)
//   offset 12  baseVertex    : i32  = 0
//   offset 16  firstInstance : u32  = 0
//
// cullSlotMetaBuf : array<SlotMeta>, stride 16 bytes, one per draw slot. std430:
//   offset  0  baseIndex     : u32  (slot's write base in cullIndexBuf — where the compute compacts into)
//   offset  4  textureIndex  : u32  (index into model.textures — the draw pass binds this slot's diffuse)
//   offset  8  isFence       : u32  (1 = def.SURF.drawfence: bind the alpha-test pipeline; 0 = opaque)
//   offset 12  maxIndexCount : u32  (Σ indexCount of the slot's surfaces — upper bound / validation)
//   The base-texture object reference can't live in a GPU buffer, so CullData.slots retains the CPU-side
//   per-slot metadata (textureIndex + isFence + baseIndex + maxIndexCount) too.
//
// cullIndexBuf    : array<u32>, sized Σ maxIndexCount (total solid indices) — the compacted output IBO the
//                   compute writes and the drawIndexedIndirect calls read. INDEX | STORAGE | COPY_DST.
//
// cullVisBuf      : array<u32>, ceil(numLeaves/32) words — per-leaf PVS bitfield (leaf `li` = word li>>5,
//                   bit li&31). Uploaded per frame by the renderer; allocated (zeroed) here.
//
// cullSeenBuf     : array<u32>, one word per SOLID surface — dedup framecount. The cull shader atomicExchanges a
//                   surface's word to the frame stamp so each surface is compacted once. Allocated here.
//
// ======================================================================================================

import { Model } from '../../types/Model'
import * as def from '../../def'
import * as mod from '../../mod'

// Byte strides of the std430 layouts documented above.
const SURF_STRIDE = 64
const MARKSURF_STRIDE = 8
const INDIRECT_STRIDE = 20
const SLOTMETA_STRIDE = 16

// Draw-pass kind of a slot (which pipeline draws it, and in which renderScene pass). The COMPUTE cull is
// kind-agnostic — it just compacts each surface into its slot; kind is consumed only at draw time in
// WebGPURenderer. So adding water passes needed no compute/GPU-buffer change, only slot classification here.
// Plain const object (not a const enum — esbuild/Vite isolatedModules can't inline a const enum across
// modules). Values are the slot kinds; WebGPURenderer routes each to its pass/pipeline.
export const CullKind = {
  Solid: 0,     // opaque world (worldPipeline)
  Fence: 1,     // alpha-test world (worldFencePipeline)
  LitWater: 2,  // lit warp water (litwaterPipeline when r_litwater; falls back to turb otherwise)
  Turb: 3,      // unlit warp water (turbPipeline)
} as const

// Classify a surface by its flags into a cull kind, or -1 to EXCLUDE it from the GPU cull (kept on the
// CPU path: sky — needs CPU-side skyVisibleThisFrame detection for skyroom — and non-sky tiled/untextured).
// isLitWaterFlags == drawtub && !drawtiled (r.isLitWaterFlags); non-lit water has drawtub+drawtiled → Turb.
const classifyKind = (f: number): number => {
  if (f & def.SURF.notexture) return -1
  if (f & def.SURF.drawtub) return (f & def.SURF.drawtiled) ? CullKind.Turb : CullKind.LitWater
  if (f & def.SURF.drawtiled) return -1   // sky (drawsky+drawtiled) + non-sky tiled → CPU path
  if (f & def.SURF.drawfence) return CullKind.Fence
  return CullKind.Solid
}

// Per-slot CPU metadata retained alongside the GPU buffers (the texture object can't go in a buffer).
export interface SlotMeta {
  textureIndex: number  // index into model.textures
  isFence: boolean      // def.SURF.drawfence → alpha-test pipeline (== kind Fence)
  kind: number          // CullKind — which pass/pipeline draws this slot
  waterFlags: number    // representative surface flags for water slots (→ r.waterAlphaForFlags); 0 otherwise
  baseIndex: number     // slot's write base in cullIndexBuf
  maxIndexCount: number // Σ indexCount of the slot's surfaces
}

// Sky faces stay outside the GPU cull, since their prime sets sky.skyVisibleThisFrame for skyroom — a
// CPU-side decision. This is the CPU substitute the decoupled mode needs once r_gpucull skips
// markSurfaces: frustum- and PVS-tested per frame in the renderer's sky gather (dozens of faces).
//
// Over-inclusion is not safe despite the depth-only prime — see gatherSkyFacesCull — so leafRefs
// carries markSurfaces' gate verbatim: a face is visible only through a leaf that is in the PVS and
// (r_oldskyleaf || not CONTENTS_SKY).
export interface SkyFaceList {
  faceNums: Int32Array     // face index per sky face
  bounds: Float32Array     // 6 f32 per sky face: minX,minY,minZ,maxX,maxY,maxZ
  // Referencing leaves, packed exactly like cullMarksurfBuf's packedleafsky:
  // (leafIndex << 1) | (leaf is CONTENTS_SKY). leafOfs/leafCount index into leafRefs per sky face.
  leafOfs: Int32Array
  leafCount: Int32Array
  leafRefs: Int32Array
  count: number
}

// The staged GPU resources + metadata; the compute-cull pass binds them.
export interface CullData {
  srcIndexBuf: GPUBuffer
  surfBuf: GPUBuffer
  marksurfBuf: GPUBuffer
  indirectBuf: GPUBuffer
  slotMetaBuf: GPUBuffer
  indexBuf: GPUBuffer
  visBuf: GPUBuffer
  seenBuf: GPUBuffer
  // metadata
  numSurfs: number
  numMarksurfs: number
  numSlots: number
  totalIndices: number
  numLeaves: number
  numVisLeafs: number   // model.numleafs — leafs beyond this have no PVS coverage and are never walked
  slots: SlotMeta[]
  skyFaces: SkyFaceList
  destroy(): void
}

// Module state (per the engine's state-object convention). identity keys the last build against the
// world-VBO Float32Array so the renderer rebuilds on map change.
export const state: { identity: Float32Array | null } = { identity: null }

// Build all Slice-C cull buffers for `model` (the world model). Returns null on any failure (caller logs).
// Cold path (map load) — allocation is fine here.
export const buildCullData = (device: GPUDevice, model: Model): CullData | null => {
  const faces = model.faces
  const leafs = model.leafs
  const marksurfaces = model.marksurfaces
  const idxOfs = model.surfIndexOfs
  const idxCnt = model.surfIndexCount
  const flags = model.surfFlags
  const srcIndexData = model.surfIndexData
  const polyVertData = model.polyVertData   // shared surface-vertex staging (POLY_VERT_STRIDE floats/vert)
  const surfVertOfs = model.surfVertOfs     // per-face first-vertex index into polyVertData
  if (faces == null || leafs == null || marksurfaces == null || idxOfs == null
      || idxCnt == null || flags == null || srcIndexData == null
      || polyVertData == null || surfVertOfs == null) return null

  const numLeaves = leafs.length
  // Leaf walk bound: numleafs + 1, NOT leafs.length. BSP2 maps carry leafs BEYOND the vis-leaf count
  // (numleafs) — detail/illusionary leafs with no PVS coverage. markSurfaces' rebuild (and QSS-M's
  // R_MarkSurfaces) iterate leafs [1..numleafs] only; walking further pulls in faces referenced solely
  // by beyond-vis leafs whose "PVS bits" are row padding — on Immortal Lock's start.bsp that was 1,020
  // giant void_wht1/glas_wht1 faces permanently in view (the r_gpucull white void).
  const leafWalkEnd = Math.min(numLeaves, model.numleafs + 1)

  // --- Pass 1: collect solid surfaces referenced by leaves, assign compact surfIndex + drawSlot, and
  //     count marksurf references. A surface is "solid" when it has no SOLID_SKIP flag (fence included). ---
  const surfIndexMap = new Int32Array(faces.length).fill(-1)  // faceNum -> compact surfIndex (-1 = not solid/unref)
  const surfFaceNum = new Int32Array(faces.length)            // compact surfIndex -> faceNum (upper-bounded)
  const slotForTex = new Int32Array(model.textures.length).fill(-1)  // textureIndex -> drawSlot
  const slots: SlotMeta[] = []
  let numSurfs = 0
  let numMarksurfs = 0

  for (let li = 0; li < leafWalkEnd; li++) {
    const leaf = leafs[li]
    if (leaf == null) continue
    const first = leaf.firstmarksurface
    const nummark = leaf.nummarksurfaces
    for (let m = 0; m < nummark; m++) {
      const faceNum = marksurfaces[first + m]
      if (faceNum == null) continue
      const kind = classifyKind(flags[faceNum])
      if (kind === -1) continue   // sky/tiled/untextured — kept on the CPU path
      numMarksurfs++
      if (surfIndexMap[faceNum] !== -1) continue   // already registered by an earlier leaf
      const si = numSurfs++
      surfIndexMap[faceNum] = si
      surfFaceNum[si] = faceNum
      // Assign / accumulate this face's draw slot (one slot per base texture; kind is a texture property —
      // a texture's surfaces are uniformly solid/fence/lit-water/turb, so the first surface sets the slot).
      const texIndex = faces[faceNum].texture
      let slot = slotForTex[texIndex]
      if (slot === -1) {
        slot = slots.length
        slotForTex[texIndex] = slot
        slots.push({
          textureIndex: texIndex,
          isFence: kind === CullKind.Fence,
          kind,
          waterFlags: (kind === CullKind.LitWater || kind === CullKind.Turb) ? flags[faceNum] : 0,
          baseIndex: 0,          // filled by the prefix-sum below
          maxIndexCount: 0,
        })
      }
      slots[slot].maxIndexCount += idxCnt[faceNum]
    }
  }

  const numSlots = slots.length

  // --- Pass 2: prefix-sum each slot's maxIndexCount into its baseIndex (start in the compacted IBO). ---
  let totalIndices = 0
  for (let s = 0; s < numSlots; s++) {
    slots[s].baseIndex = totalIndices
    totalIndices += slots[s].maxIndexCount
  }

  // --- Build cullSrcIndexBuf: verbatim copy of the prebuilt fan indices (static, read-only). ---
  const srcIndexBuf = device.createBuffer({
    size: Math.max(4, srcIndexData.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  })
  new Uint32Array(srcIndexBuf.getMappedRange()).set(srcIndexData)
  srcIndexBuf.unmap()

  // --- Build cullSurfBuf: 64-byte entry per solid surface. f32 view for plane/AABB, u32 view for meta. ---
  const surfBuf = device.createBuffer({
    size: Math.max(SURF_STRIDE, numSurfs * SURF_STRIDE),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  })
  {
    const range = surfBuf.getMappedRange()
    const f32 = new Float32Array(range)
    const u32 = new Uint32Array(range)
    for (let si = 0; si < numSurfs; si++) {
      const faceNum = surfFaceNum[si]
      const face = faces[faceNum]
      const base = si * 16   // 64 bytes / 4 = 16 f32/u32 slots
      // SURF_PLANEBACK sign bake: s = -1 when the surface is on the back side of its plane, +1 otherwise.
      // With plane.xyz = s*normal and plane.w = s*dist, the uniform test dot(plane.xyz,vieworg) < plane.w
      // == backface for both cases (Ironwail's `dot-dist` sign convention folded into the data).
      const s = (flags[faceNum] & def.SURF.planeback) ? -1.0 : 1.0
      const n = face.plane.normal
      f32[base + 0] = n[0] * s
      f32[base + 1] = n[1] * s
      f32[base + 2] = n[2] * s
      f32[base + 3] = face.plane.dist * s
      // Per-surface world-space AABB, computed here from the surface's own vertices in the shared
      // polyVertData (first 3 floats/vertex = position). The face no longer carries mins/maxs (wasm-sim
      // memory-model refactor); this cold-path scan replaces mod.calcSurfaceBounds. numedges verts/face.
      const S = def.POLY_VERT_STRIDE
      let vb = surfVertOfs[faceNum] * S
      let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity
      for (let e = 0; e < face.numedges; e++, vb += S) {
        const x = polyVertData[vb], y = polyVertData[vb + 1], z = polyVertData[vb + 2]
        if (x < mnx) mnx = x; if (y < mny) mny = y; if (z < mnz) mnz = z
        if (x > mxx) mxx = x; if (y > mxy) mxy = y; if (z > mxz) mxz = z
      }
      f32[base + 4] = mnx; f32[base + 5] = mny; f32[base + 6] = mnz; f32[base + 7] = 0.0
      f32[base + 8] = mxx; f32[base + 9] = mxy; f32[base + 10] = mxz; f32[base + 11] = 0.0
      // meta: srcFirstIndex, indexCount, drawSlot, pad
      u32[base + 12] = idxOfs[faceNum]
      u32[base + 13] = idxCnt[faceNum]
      u32[base + 14] = slotForTex[face.texture]
      u32[base + 15] = 0
    }
  }
  surfBuf.unmap()

  // --- Build cullMarksurfBuf: {packedleafsky, surfIndex} per leaf->solid-surface reference (second walk). ---
  const marksurfBuf = device.createBuffer({
    size: Math.max(MARKSURF_STRIDE, numMarksurfs * MARKSURF_STRIDE),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  })
  {
    const u32 = new Uint32Array(marksurfBuf.getMappedRange())
    const leafContents = model.leafContents
    let w = 0
    for (let li = 0; li < leafWalkEnd; li++) {
      const leaf = leafs[li]
      if (leaf == null) continue
      // Ironwail r_brush.c: packedleafsky = (leafIndex << 1) | (contents == CONTENTS_SKY). The shader
      // drops sky-leaf references unless r_oldskyleaf, matching r.markSurfaces' per-leaf gate — without
      // it the cull draws every surface reachable ONLY through a sky leaf (the white-void regression).
      const packedleafsky = (li << 1) | (leafContents[li] === mod.CONTENTS.sky ? 1 : 0)
      const first = leaf.firstmarksurface
      const nummark = leaf.nummarksurfaces
      for (let m = 0; m < nummark; m++) {
        const faceNum = marksurfaces[first + m]
        if (faceNum == null) continue
        const si = surfIndexMap[faceNum]
        if (si === -1) continue   // non-solid, skipped exactly as in pass 1
        u32[w++] = packedleafsky
        u32[w++] = si
      }
    }
  }
  marksurfBuf.unmap()

  // --- Build cullIndirectBuf: one 20-byte drawIndexedIndirect command per slot (indexCount 0, base set). ---
  const indirectBuf = device.createBuffer({
    size: Math.max(INDIRECT_STRIDE, numSlots * INDIRECT_STRIDE),
    usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  })
  {
    const u32 = new Uint32Array(indirectBuf.getMappedRange())
    for (let s = 0; s < numSlots; s++) {
      const b = s * 5   // 20 bytes / 4 = 5 u32
      u32[b + 0] = 0                    // indexCount (compute bumps)
      u32[b + 1] = 1                    // instanceCount
      u32[b + 2] = slots[s].baseIndex   // firstIndex
      u32[b + 3] = 0                    // baseVertex
      u32[b + 4] = 0                    // firstInstance
    }
  }
  indirectBuf.unmap()

  // --- Build cullSlotMetaBuf: per-slot {baseIndex, textureIndex, isFence, maxIndexCount} (16 bytes). ---
  const slotMetaBuf = device.createBuffer({
    size: Math.max(SLOTMETA_STRIDE, numSlots * SLOTMETA_STRIDE),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  })
  {
    const u32 = new Uint32Array(slotMetaBuf.getMappedRange())
    for (let s = 0; s < numSlots; s++) {
      const b = s * 4   // 16 bytes / 4 = 4 u32
      u32[b + 0] = slots[s].baseIndex
      u32[b + 1] = slots[s].textureIndex
      u32[b + 2] = slots[s].isFence ? 1 : 0
      u32[b + 3] = slots[s].maxIndexCount
    }
  }
  slotMetaBuf.unmap()

  // --- Output IBO (compacted, compute-written) + per-frame PVS bitfield + per-surface dedup words.
  //     All zero-initialized by WebGPU on creation. ---
  const indexBuf = device.createBuffer({
    size: Math.max(4, totalIndices * 4),
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const visWords = Math.max(1, (numLeaves + 31) >> 5)
  const visBuf = device.createBuffer({
    size: visWords * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  const seenBuf = device.createBuffer({
    size: Math.max(4, numSurfs * 4),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })

  // --- Sky-face list (CPU-side, for the decoupled sky gather — see SkyFaceList). World faces only. ---
  let numSky = 0
  for (let i = 0; i < model.numfaces; i++)
    if (flags[model.firstface + i] & def.SURF.drawsky) numSky++
  const skyNums = new Int32Array(numSky)
  const skyBounds = new Float32Array(numSky * 6)
  {
    const S = def.POLY_VERT_STRIDE
    let w = 0
    for (let i = 0; i < model.numfaces; i++) {
      const fi = model.firstface + i
      if (!(flags[fi] & def.SURF.drawsky)) continue
      skyNums[w] = fi
      let vb = surfVertOfs[fi] * S
      let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity
      for (let e = 0; e < faces[fi].numedges; e++, vb += S) {
        const x = polyVertData[vb], y = polyVertData[vb + 1], z = polyVertData[vb + 2]
        if (x < mnx) mnx = x; if (y < mny) mny = y; if (z < mnz) mnz = z
        if (x > mxx) mxx = x; if (y > mxy) mxy = y; if (z > mxz) mxz = z
      }
      const b = w * 6
      skyBounds[b] = mnx; skyBounds[b + 1] = mny; skyBounds[b + 2] = mnz
      skyBounds[b + 3] = mxx; skyBounds[b + 4] = mxy; skyBounds[b + 5] = mxz
      w++
    }
  }
  // Referencing leaves per sky face, from the same [1..numleafs] walk the marksurf build uses (leaves
  // past numleafs have no PVS row, so a reference from one can never be "visible"). Map-load cold path:
  // the intermediate arrays are fine here, the per-frame gather reads only the flattened Int32Arrays.
  const skySlotOfFace = new Int32Array(model.numfaces + model.firstface).fill(-1)
  for (let s = 0; s < numSky; s++) skySlotOfFace[skyNums[s]] = s
  const skyRefs: number[][] = new Array(numSky)
  for (let s = 0; s < numSky; s++) skyRefs[s] = []
  for (let li = 0; li < leafWalkEnd; li++) {
    const leaf = leafs[li]
    if (leaf == null) continue
    const packedleafsky = (li << 1) | (model.leafContents[li] === mod.CONTENTS.sky ? 1 : 0)
    const first = leaf.firstmarksurface, nummark = leaf.nummarksurfaces
    for (let m = 0; m < nummark; m++) {
      const faceNum = marksurfaces[first + m]
      if (faceNum == null) continue
      const slot = skySlotOfFace[faceNum]
      if (slot >= 0) skyRefs[slot].push(packedleafsky)
    }
  }
  const skyLeafOfs = new Int32Array(numSky), skyLeafCount = new Int32Array(numSky)
  let totalRefs = 0
  for (let s = 0; s < numSky; s++) { skyLeafOfs[s] = totalRefs; skyLeafCount[s] = skyRefs[s].length; totalRefs += skyRefs[s].length }
  const skyLeafRefs = new Int32Array(totalRefs)
  for (let s = 0, w = 0; s < numSky; s++) for (const p of skyRefs[s]) skyLeafRefs[w++] = p

  const skyFaces: SkyFaceList = {
    faceNums: skyNums, bounds: skyBounds, count: numSky,
    leafOfs: skyLeafOfs, leafCount: skyLeafCount, leafRefs: skyLeafRefs,
  }

  const totalBytes = srcIndexBuf.size + surfBuf.size + marksurfBuf.size + indirectBuf.size
    + slotMetaBuf.size + indexBuf.size + visBuf.size + seenBuf.size

  // eslint-disable-next-line no-console
  console.log(`[gpucull] surfs=${numSurfs} marksurfs=${numMarksurfs} slots=${numSlots} `
    + `totalIndices=${totalIndices} leaves=${numLeaves} bytes≈${totalBytes}`)

  return {
    srcIndexBuf, surfBuf, marksurfBuf, indirectBuf, slotMetaBuf, indexBuf, visBuf, seenBuf,
    numSurfs, numMarksurfs, numSlots, totalIndices, numLeaves, numVisLeafs: model.numleafs, slots, skyFaces,
    destroy(): void {
      srcIndexBuf.destroy()
      surfBuf.destroy()
      marksurfBuf.destroy()
      indirectBuf.destroy()
      slotMetaBuf.destroy()
      indexBuf.destroy()
      visBuf.destroy()
      seenBuf.destroy()
    },
  }
}
