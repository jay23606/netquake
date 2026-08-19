/// <reference types="@webgpu/types" />
// Load-time brush-ENTITY draw tables — the bmodel half of the GPU-driven world path (r_gpucullents).
//
// Design (Ironwail r_brush.c GL_BuildBModelMarkBuffers / r_world.c R_DrawBrushModels_Real): a brush
// entity's faces never change, so its triangles are baked ONCE per map into a shared index buffer,
// grouped by (base texture, fence), and the per-frame CPU work collapses to "pick a transform".
// Ironwail deliberately does NOT per-face cull bmodels — no PVS (their faces aren't in leaf
// marksurfaces), no frustum, no backface. The entity is frustum-culled whole on the CPU
// (r.drawBrushModel's cullBox, our R_CullModelForEntity equivalent) and the rasterizer's back-face
// cull discards the rest. The extra back-facing triangles are depth-culled overdraw on an idle GPU.
//
// That removes, per visible brush entity, the CPU per-face backface dot products, the per-texture
// chain walk, and the per-frame index gather + upload that the chain path (drawBrushEntSolid) pays.
//
// This module owns the STATIC half: one shared index buffer for every eligible brush model in the
// precache, plus a flat per-model draw table. The per-frame half (instance records + instanced draws)
// lives in WebGPURenderer.batchBrushModel/flushBrushBatches.
//
// ============================ LAYOUT ============================
//
// indexBuf : array<u32>  — every eligible model's fan indices, concatenated. Values are GLOBAL world-VBO
//            vertex indices (r.buildModelVertexBuffer packs the worldmodel AND every external .bsp brush
//            model into one VBO; '*N' submodels alias their parent's surfIndexData), so one index buffer
//            serves every model and a batch never rebinds it.
//
// Draw table (parallel flat arrays, one entry per (model, texture, fence) group):
//   drawTex[d]   : index into the OWNING model's textures[] (resolved per draw — animated + fullbright)
//   drawFence[d] : 1 = def.SURF.drawfence -> alpha-test pipeline, 0 = opaque
//   drawFirst[d] : firstIndex into indexBuf
//   drawCount[d] : indexCount
// Per model (indexed by the dense modelId that `ids` maps to):
//   firstDraw[m] / numDraws[m] : that model's contiguous run in the draw table (Ironwail's m->firstcmd
//                                + the texofs[] window, flattened — we have one texture type range).
//
// ELIGIBILITY mirrors r.buildBrushPrecompute's PURE-SOLID gate: a model with ANY water/turb
// (def.SURF.drawtub) face is excluded outright and keeps the exact per-face chain path, so water alpha,
// lit-water routing and pass ordering are untouched. Unlike buildBrushPrecompute this covers EXTERNAL
// .bsp brush models too (Immortal Lock's spinny.bsp portal), not just inline '*N' submodels.
//
// Built once per map, WebGPU-only, wrapped in try/catch by the caller: any failure logs and leaves the
// verified chain path in charge.

import { Model } from '../../types/Model'
import * as def from '../../def'
import * as mod from '../../mod'

// Faces the solid pass skips anyway (SOLID_SKIP) — excluded so the baked set matches what the chain
// path would have drawn. Same constant set as r.buildBrushPrecompute's PRECOMPUTE_SKIP.
const BRUSH_SKIP = def.SURF.drawtiled | def.SURF.notexture | def.SURF.drawsky

// The staged shared index buffer + the per-model draw table.
export interface BrushDrawData {
  indexBuf: GPUBuffer
  // draw table (length numDrawsTotal)
  drawTex: Int32Array
  drawFence: Uint8Array
  drawFirst: Uint32Array
  drawCount: Uint32Array
  // per dense modelId
  firstDraw: Int32Array
  numDraws: Int32Array
  models: Model[]
  ids: Map<Model, number>   // model -> dense modelId (absent = ineligible, use the chain path)
  totalIndices: number
  destroy(): void
}

// Module state (engine state-object convention). identity keys the last build against the world VBO's
// Float32Array so the renderer rebuilds exactly when the map changes.
export const state: { identity: Float32Array | null } = { identity: null }

// Build the shared brush-entity index buffer + draw table for every eligible brush model in `precache`.
// `worldmodel` is excluded (it renders through the world/cull path). Returns null when nothing qualifies.
// Cold path (map load) — allocation is fine here.
export const buildBrushDrawData = (
  device: GPUDevice, precache: (Model | null)[], worldmodel: Model | null,
): BrushDrawData | null => {
  // --- Pass 1: select eligible models and size the index buffer + draw table. ---
  const models: Model[] = []
  const ids = new Map<Model, number>()
  // Per selected model, its group key list + per-key index counts, kept for pass 2 (cold path).
  const modelKeys: number[][] = []
  const modelCounts: Map<number, number>[] = []
  let totalIndices = 0
  let numDrawsTotal = 0

  for (let mi = 1; mi < precache.length; mi++) {
    const model = precache[mi]
    if (model == null || model === worldmodel || model.type !== mod.TYPE.brush) continue
    const faces = model.faces, first = model.firstface, num = model.numfaces
    const texinfo = model.texinfo, idxCnt = model.surfIndexCount
    if (faces == null || texinfo == null || idxCnt == null || model.surfIndexData == null
        || model.surfIndexOfs == null || num === 0) continue

    // PURE-SOLID gate: any water/turb face -> keep the whole model on the per-face chain path.
    let pure = true
    for (let i = 0; i < num; i++) {
      if (faces[first + i].flags & def.SURF.drawtub) { pure = false; break }
    }
    if (!pure) continue

    // Group key = textureIndex<<1 | isFence (same key as r.buildBrushPrecompute).
    const counts = new Map<number, number>()
    const keys: number[] = []
    let modelTotal = 0
    for (let i = 0; i < num; i++) {
      const surf = faces[first + i]
      if (surf.flags & BRUSH_SKIP) continue
      const key = (texinfo[surf.texinfo].texture << 1) | ((surf.flags & def.SURF.drawfence) ? 1 : 0)
      const c = idxCnt[first + i]
      const prev = counts.get(key)
      if (prev === undefined) { counts.set(key, c); keys.push(key) } else counts.set(key, prev + c)
      modelTotal += c
    }
    if (modelTotal === 0) continue

    ids.set(model, models.length)
    models.push(model)
    modelKeys.push(keys)
    modelCounts.push(counts)
    totalIndices += modelTotal
    numDrawsTotal += keys.length
  }

  if (models.length === 0 || totalIndices === 0) return null

  // --- Pass 2: prefix-sum every group into its slice of the shared index data and fill the tables. ---
  const drawTex = new Int32Array(numDrawsTotal)
  const drawFence = new Uint8Array(numDrawsTotal)
  const drawFirst = new Uint32Array(numDrawsTotal)
  const drawCount = new Uint32Array(numDrawsTotal)
  const firstDraw = new Int32Array(models.length)
  const numDraws = new Int32Array(models.length)
  const indexData = new Uint32Array(totalIndices)

  let running = 0   // write cursor in indexData
  let d = 0         // draw-table cursor
  // Reused per model: group key -> current write cursor in indexData.
  const cursors = new Map<number, number>()

  for (let m = 0; m < models.length; m++) {
    const model = models[m]
    const keys = modelKeys[m], counts = modelCounts[m]
    firstDraw[m] = d
    numDraws[m] = keys.length
    cursors.clear()
    // Groups are laid out in first-seen order, each contiguous — one drawIndexed per group.
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k]
      const c = counts.get(key) as number
      drawTex[d] = key >> 1
      drawFence[d] = (key & 1) !== 0 ? 1 : 0
      drawFirst[d] = running
      drawCount[d] = c
      cursors.set(key, running)
      running += c
      d++
    }
    // Copy each drawable face's prebuilt fan indices into its group's range.
    const faces = model.faces, first = model.firstface, num = model.numfaces
    const texinfo = model.texinfo
    const idxOfs = model.surfIndexOfs, idxCnt = model.surfIndexCount, idxData = model.surfIndexData
    for (let i = 0; i < num; i++) {
      const surf = faces[first + i]
      if (surf.flags & BRUSH_SKIP) continue
      const key = (texinfo[surf.texinfo].texture << 1) | ((surf.flags & def.SURF.drawfence) ? 1 : 0)
      let cur = cursors.get(key) as number
      const so = idxOfs[first + i], cc = idxCnt[first + i]
      for (let e = 0; e < cc; e++) indexData[cur++] = idxData[so + e]
      cursors.set(key, cur)
    }
  }

  const indexBuf = device.createBuffer({
    size: Math.max(4, indexData.byteLength),
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    mappedAtCreation: true,
  })
  new Uint32Array(indexBuf.getMappedRange()).set(indexData)
  indexBuf.unmap()

  // eslint-disable-next-line no-console
  console.log(`[gpubrush] models=${models.length} draws=${numDrawsTotal} indices=${totalIndices} `
    + `bytes≈${indexBuf.size}`)

  return {
    indexBuf, drawTex, drawFence, drawFirst, drawCount, firstDraw, numDraws, models, ids, totalIndices,
    destroy(): void { indexBuf.destroy() },
  }
}
