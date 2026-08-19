/// <reference types="@webgpu/types" />
// WGSL compute-cull shaders — the GPU half of the solid-world pass behind r_gpucull.
//
// Consumes the static buffers staged by render/webgpu/gpuCull.ts (see that file for the exact std430
// layouts). Two entry points share one module so the struct/binding declarations never drift and both
// bind to the SAME two group layouts (group0 = the per-frame cull UBO, group1 = the 7 storages):
//
//   cs_clear — one thread per draw SLOT: zeroes that slot's drawIndexedIndirect indexCount.
//   cs_cull  — one thread per MARKSURFACE (leaf->surface reference): PVS-tests the leaf, backface- and
//              frustum-culls the surface, dedups it (once per frame), then atomicAdds its prebuilt fan
//              indices into its slot's compacted region of the output IBO while bumping the slot's
//              indexCount. The result is one drawIndexedIndirect per texture batch.
//
// Bindings (group1) — matches WebGPURenderer.buildCullBindings():
//   0 marksurf : array<vec2<u32>>  read        {packedleafsky (bit0=sky leaf, bits1..=leafIndex), surfIndex}
//   1 surfs    : array<Surf>       read        plane/mins/maxs/meta, 64B stride
//   2 srcIdx   : array<u32>        read        verbatim prebuilt fan indices
//   3 vis       : array<u32>       read        per-leaf PVS bitfield (leaf li = word li>>5, bit li&31)
//   4 idx       : array<u32>       read_write  compacted output IBO the render pass draws
//   5 cmds      : array<DrawCmd>   read_write  the drawIndexedIndirect args (indexCount is atomic)
//   6 seen      : array<atomic<u32>> read_write per-surface dedup framestamp
//
// The cull UBO counts vec4<u32> = (numMarksurf, frameStamp, numSlots, rowStride) where rowStride =
// dispatchGroupsX*64 linearizes a 2D dispatch (marksurf counts on immortal-scale maps exceed the 65535
// single-dimension workgroup cap, so cs_cull recovers the linear thread as gid.y*rowStride + gid.x).
// Its flags vec4<u32> carries r_oldskyleaf in .x (Ironwail's FrameCullUBO oldskyleaf).
export const CULL_WGSL = `
struct CullUniforms {
  frustum: array<vec4<f32>, 4>,   // [nx,ny,nz,dist] per plane, inward normals (r.state.frustumFlat)
  vieworg: vec4<f32>,             // xyz = view origin
  counts: vec4<u32>,              // x=numMarksurf, y=frameStamp, z=numSlots, w=rowStride
  flags: vec4<u32>,               // x=oldskyleaf (r_oldskyleaf != 0); yzw unused
};
@group(0) @binding(0) var<uniform> u: CullUniforms;

struct Surf {
  plane: vec4<f32>,   // SURF_PLANEBACK-signed: dot(plane.xyz, vieworg) < plane.w == backface (cull)
  mins: vec4<f32>,    // surface AABB min (.w pad)
  maxs: vec4<f32>,    // surface AABB max (.w pad)
  sinfo: vec4<u32>,   // srcFirstIndex, indexCount, drawSlot, pad ('meta' is a WGSL reserved keyword)
};

struct DrawCmd {
  indexCount: atomic<u32>,   // compute atomicAdds each surface's indexCount into this
  instanceCount: u32,
  firstIndex: u32,           // slot's write base in idx[] (never bumped by compute)
  baseVertex: u32,
  firstInstance: u32,
};

@group(1) @binding(0) var<storage, read> marksurf: array<vec2<u32>>;
@group(1) @binding(1) var<storage, read> surfs: array<Surf>;
@group(1) @binding(2) var<storage, read> srcIdx: array<u32>;
@group(1) @binding(3) var<storage, read> vis: array<u32>;
@group(1) @binding(4) var<storage, read_write> idx: array<u32>;
@group(1) @binding(5) var<storage, read_write> cmds: array<DrawCmd>;
@group(1) @binding(6) var<storage, read_write> seen: array<atomic<u32>>;

// One thread per draw slot: reset the slot's indirect indexCount to 0 for this frame's compaction.
@compute @workgroup_size(64)
fn cs_clear(@builtin(global_invocation_id) gid: vec3<u32>) {
  let slot = gid.x;
  if (slot >= u.counts.z) { return; }
  atomicStore(&cmds[slot].indexCount, 0u);
}

// One thread per marksurface: PVS + backface + frustum + dedup, then compact this surface's fan indices.
@compute @workgroup_size(64)
fn cs_cull(@builtin(global_invocation_id) gid: vec3<u32>) {
  let mi = gid.y * u.counts.w + gid.x;
  if (mi >= u.counts.x) { return; }
  let ms = marksurf[mi];
  let surfIndex = ms.y;

  // Sky leaves: with r_oldskyleaf 0 a reference from a CONTENTS_SKY leaf contributes nothing, so a surface
  // reachable only through sky leaves is not drawn — r.markSurfaces' "oldskyleaf || contents != sky" gate,
  // and Ironwail cull_mark_compute_shader's "(mark.packedleafsky & 1u) > oldskyleaf" early-out.
  if ((ms.x & 1u) > u.flags.x) { return; }
  let leafIndex = ms.x >> 1u;

  // PVS: the marksurface's leaf must be in the current view PVS.
  if ((vis[leafIndex >> 5u] & (1u << (leafIndex & 31u))) == 0u) { return; }

  let s = surfs[surfIndex];

  // Backface: the plane was baked SURF_PLANEBACK-signed so this single test culls both sign cases
  // (gpuCull.ts). If the WHOLE world vanishes with r_gpucull 1, flip this comparison to greater-than.
  if (dot(s.plane.xyz, u.vieworg.xyz) < s.plane.w) { return; }

  // Frustum: positive-vertex AABB test against the 4 inward planes (mirrors r.cullBox exactly — cull if
  // the far corner along the plane normal is still behind the plane).
  for (var p = 0u; p < 4u; p = p + 1u) {
    let pl = u.frustum[p];
    let pv = vec3<f32>(
      select(s.mins.x, s.maxs.x, pl.x >= 0.0),
      select(s.mins.y, s.maxs.y, pl.y >= 0.0),
      select(s.mins.z, s.maxs.z, pl.z >= 0.0));
    if (dot(pl.xyz, pv) < pl.w) { return; }
  }

  // Dedup: a surface recurs once per referencing leaf; emit it only once per frame (frameStamp != 0).
  if (atomicExchange(&seen[surfIndex], u.counts.y) == u.counts.y) { return; }

  // Emit: reserve this surface's index range in its slot's compacted region, then copy the fan indices.
  let srcFirst = s.sinfo.x;
  let cnt = s.sinfo.y;
  let slot = s.sinfo.z;
  let base = cmds[slot].firstIndex;
  let dst = base + atomicAdd(&cmds[slot].indexCount, cnt);
  for (var e = 0u; e < cnt; e = e + 1u) {
    idx[dst + e] = srcIdx[srcFirst + e];
  }
}
`
