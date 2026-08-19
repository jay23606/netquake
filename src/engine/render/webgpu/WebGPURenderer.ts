/// <reference types="@webgpu/types" />
// WebGPU backend (see docs/render-backend-interface.md).
//
// The reference above pulls in @webgpu/types program-wide for every tsconfig that compiles this file
// (the app build via src/env.d.ts too, and the node/server build which also walks the engine imports).
//
// Frame structure: everything renders into a persistent offscreen color target, blitted to the
// freshly-acquired swapchain texture in endFrame. 2D primitives interleave, so the batch is split
// into ordered runs keyed by (kind, texture) and replayed in submission order (beginRun/endFrame) —
// later draws land on top, mirroring the WebGL stream's flush-on-change. Textured pics carry their
// expanded RGBA on the source object (retained WebGPU-only in texture.ts/draw.ts); the renderer
// uploads a GPUTexture per source, cached in texCache. While this backend is active a WebGL2 context
// still runs on an OFFSCREEN canvas purely as a resource factory (texture.ts / mod.ts / r.init keep
// creating WebGL textures+VBOs there, unused).
//
// WebGPU handles are typed via @webgpu/types (referenced in src/env.d.ts). The GPUTextureUsage /
// GPUBufferUsage / navigator.gpu globals only exist when a real WebGPU device is present; every method
// guards on this.device, so they are never touched otherwise.

import {
  IRenderer, FrameGlobals, SceneSetup, FaceVis, SurfacePass, RTexture, RBuffer,
} from '../IRenderer'
import { Entity } from '../../types/Entity'
import { Model, TexChain, Skin, Face, SpriteFrame, SpriteFrameGroup } from '../../types/Model'
import { Pic } from '../../texture'
import { V3 } from '../../types/Vector'
import * as def from '../../def'
import * as r from '../../r'
import * as lm from '../../lightmap'
import * as fog from '../../fog'
import * as host from '../../host'
import * as texture from '../../texture'
import * as vid from '../../vid'
import * as draw from '../../draw'
import * as sky from '../../sky'
import * as cl from '../../cl'
import * as pr from '../../pr'
import * as mod from '../../mod'
import * as scr from '../../scr'
import * as chase from '../../chase'
import * as vec from '../../vec'
import * as con from '../../console'
import * as v from '../../v'
import * as pscript from '../../pscript'
import { QUAD_WGSL, TEXQUAD_WGSL, BLIT_WGSL, BLIT_WARP_WGSL, WORLD_WGSL, WORLD_FENCE_WGSL, LITWATER_WGSL, TURB_WGSL, SKYCHAIN_WGSL, SKY_WGSL, SKYCUBE_WGSL, ALIAS_WGSL, PARTICLE_WGSL, PSCRIPT_WGSL, SPRITE_WGSL, DLIGHT_WGSL, ALIAS_PLAYER_WGSL, ALIAS_INST_WGSL, WORLD_INST_WGSL, WORLD_INST_FENCE_WGSL } from './shaders'
import { CULL_WGSL } from './cullShaders'
import { buildCullData, CullData, CullKind } from './gpuCull'
import { buildBrushDrawData, BrushDrawData } from './gpuBrush'

// Byte stride of a cullIndirectBuf drawIndexedIndirect command (see gpuCull.ts INDIRECT_STRIDE).
const CULL_INDIRECT_STRIDE = 20
// Compute-cull dispatch: one thread per marksurface, 64 per workgroup. A single dispatch dimension caps
// at 65535 workgroups (maxComputeWorkgroupsPerDimension), so large marksurf counts spill into a 2D grid.
const CULL_WORKGROUP_SIZE = 64
const CULL_MAX_GROUPS_DIM = 65535
// Size of cullShaders.ts CullUniforms: 4 frustum vec4 + vieworg vec4 + counts vec4<u32> + flags vec4<u32>.
const CULL_UBO_BYTES = 112

// TRANSPARENT black, matching GL.init's gl.clearColor(0,0,0,0). The alpha matters: draw.ts paints
// the BACKTILE pattern as a CSS background on the game container, and undrawn canvas areas (the
// border when viewsize < 100) must let it show through rather than covering it with black.
const CLEAR: GPUColor = { r: 0.0, g: 0.0, b: 0.0, a: 0.0 }
const DEPTH_FORMAT: GPUTextureFormat = 'depth24plus'
// Texture-level flags that exclude a surface from the SOLID world pass (sky/water/tiled/untextured),
// matching drawTextureChains's exclusion mask in the WebGL backend.
const SOLID_SKIP = def.SURF.drawtiled | def.SURF.notexture | def.SURF.drawtub
const WORLD_VERTEX_STRIDE = def.VERTEXSIZE * 4   // 44 bytes: pos[3] tex[2] lm[2] lmstyles[4]
// Second world vertex buffer: 4 float32 lightmap array-layers per vertex (16 bytes).
const LM_LAYER_STRIDE = 16
// Lightmap page atlas size (matches lm.LM_BLOCK_WIDTH/HEIGHT) — the width/height of every array layer.
const LM_PAGE_SIZE = lm.LM_BLOCK_WIDTH
const MAX_QUADS = 8192
const FLOATS_PER_VERT = 6          // colored: x,y, r,g,b,a
const VERTS_PER_QUAD = 6           // two triangles
const QUAD_STRIDE_BYTES = FLOATS_PER_VERT * 4   // 24
const TEX_FLOATS_PER_VERT = 4      // textured: x,y, u,v
const TEX_STRIDE_BYTES = TEX_FLOATS_PER_VERT * 4 // 16

// Ordered 2D runs. 2D primitives interleave (fills, pics, text, more fills) and later draws must
// appear on top, so the batch is split into runs keyed by (kind, texture): a run is flushed as one
// draw and runs are replayed in submission order. This mirrors the WebGL stream's flush-on-
// program/texture-change. Kinds: 0 = colored quad, 1 = textured quad.
const RUN_COLORED = 0
const RUN_TEXTURED = 1
const MAX_RUNS = 4096

// Alias entity per-frame uniform slots: one 256-byte slot per drawn alias entity (256 =
// minUniformBufferOffsetAlignment, the dynamic-offset granularity). def.max_vis_edicts entities plus
// one slot for the viewmodel (drawn outside the visedict list). The uniform struct is 128 bytes; the
// rest of each 256-byte slot is unused padding required by the alignment.
const MAX_ALIAS_ENTS = def.max_vis_edicts + 1
const ALIAS_SLOT_BYTES = 256
const ALIAS_SLOT_FLOATS = ALIAS_SLOT_BYTES / 4   // 64
const ALIAS_STRUCT_BYTES = 160                   // the Ent struct actually written per slot (incl. top/bottom)
// Light-direction basis for the alias shade vector (drawAliasModel's local negX).
const ALIAS_NEG_X: V3 = [-1.0, 0.0, 0.0]
// Instanced alias path (r_instancedmodels): one tightly packed 144B Inst record per batched entity in a
// storage buffer — mat3x3 (48, three padded columns) + 5 vec4 + one vec4<u32>. Both the 4- and 16-byte
// views index the SAME staging array, so the float and u32 fields share one upload.
const ALIAS_INST_BYTES = 144
const ALIAS_INST_FLOATS = ALIAS_INST_BYTES / 4   // 36
// cmds layout (mod.ts): the texcoord block [s t] first, then the pose blocks [x y z nx ny nz] — so the
// texcoord region always starts at f32 index 0 and the shader's per-vertex strides are 2 and 6.
const ALIAS_UV_OFS_FLOATS = 0
// Entry sort key = modelBindId * ALIAS_KEY_SCALE + skinBindId. Both ids are dense per-map counters, so
// 2^20 skins per model is unreachable and the composite stays an exact integer double.
const ALIAS_KEY_SCALE = 1048576

// Sprite billboard geometry: 6 verts (two triangles) per sprite entity, each vert = pos vec3 + uv vec2
// (5 floats / 20 bytes). Sized for the worst case of every visedict being a sprite.
const SPRITE_FLOATS_PER_VERT = 5
const SPRITE_VERTS_PER_QUAD = 6
const SPRITE_QUAD_FLOATS = SPRITE_FLOATS_PER_VERT * SPRITE_VERTS_PER_QUAD   // 30
const SPRITE_STRIDE_BYTES = SPRITE_FLOATS_PER_VERT * 4                      // 20
const MAX_SPRITE_ENTS = def.max_vis_edicts

// Brush-entity per-frame transform slots (drawBrushModel's uOrigin/uAngles + entity alpha): one
// 256-byte dynamic-offset slot per brush-entity draw that needs a transform. Slot 0 is the IDENTITY
// slot bound by the WORLD (and turb-entity) pass so worldPos = Vert. A brush entity can consume up to
// two slots per frame (its solid pass + its lit-water pass both pack a slot), so size for that worst
// case. The struct is mat3x3 angles (48B) + origin vec4 (16B) + params vec4 (16B) = 80B; the rest of
// each 256B slot is alignment padding.
const MAX_BRUSH_ENTS = def.max_vis_edicts * 2 + 1
const BRUSH_SLOT_BYTES = 256
const BRUSH_SLOT_FLOATS = BRUSH_SLOT_BYTES / 4   // 64
const BRUSH_STRUCT_BYTES = 80
// The instanced brush path (r_gpucullents) stores the SAME 80B struct back-to-back in a storage array
// (std430 stride 80, align 16) instead of one padded 256B uniform window per entity.
const BRUSH_STRUCT_FLOATS = BRUSH_STRUCT_BYTES / 4   // 20
// Origin/angles used to pack the identity slot 0 (world + turb-entity transform).
const BRUSH_ZERO: V3 = [0.0, 0.0, 0.0]

// Write one BrushXform record (mat3x3 angles as 3 padded vec4 columns = GL.rotationMatrix(angles) at
// scale 1, origin.xyz, params.x = alpha) into `d` at float offset `f`. Angles [0,0,0] gives the identity
// matrix. Reproduces GL.rotationMatrix / vshBrush's uAngles. Shared by the dynamic-offset uniform slots
// (stride BRUSH_SLOT_FLOATS) and the instanced storage array (stride BRUSH_STRUCT_FLOATS) so the two
// paths can never disagree about the transform.
const packBrushXform = (d: Float32Array, f: number, angles: V3, origin: V3, alpha: number): void => {
  const pitch = angles[0] * (Math.PI / -180.0)
  const yaw = angles[1] * (Math.PI / 180.0)
  const roll = angles[2] * (Math.PI / 180.0)
  const sp = Math.sin(pitch), cp = Math.cos(pitch)
  const sy = Math.sin(yaw), cy = Math.cos(yaw)
  const sr = Math.sin(roll), cr = Math.cos(roll)
  d[f + 0] = cy * cp;                 d[f + 1] = sy * cp;                 d[f + 2] = -sp;      d[f + 3] = 0
  d[f + 4] = -sy * cr + cy * sp * sr; d[f + 5] = cy * cr + sy * sp * sr;  d[f + 6] = cp * sr;  d[f + 7] = 0
  d[f + 8] = sy * sr + cy * sp * cr;  d[f + 9] = -cy * sr + sy * sp * cr; d[f + 10] = cp * cr; d[f + 11] = 0
  d[f + 12] = origin[0]; d[f + 13] = origin[1]; d[f + 14] = origin[2]; d[f + 15] = 0
  d[f + 16] = alpha; d[f + 17] = 0; d[f + 18] = 0; d[f + 19] = 0
}

// The engine-side objects a textured quad can source pixels from: a Pic, or the conchars WebGLTexture
// (both carry rgba/rgbaW/rgbaH retained at creation, WebGPU-only). Used only as an opaque cache key.
type TexSource = { rgba?: Uint8Array | null; rgbaW?: number; rgbaH?: number }
// A cached uploaded 2D texture + its group(1) bind group. World diffuse entries also own the texture's
// fullbright split GPUTexture (fbTex) when it has one — null when the diffuse binds the shared black
// fallback for its fullbright slot (destroyed alongside tex in clearWorldCaches).
interface TexEntry { tex: GPUTexture; bind: GPUBindGroup; fbTex?: GPUTexture | null }

export class WebGPURenderer implements IRenderer {
  readonly backend = 'webgpu' as const

  private device: GPUDevice | null = null
  private context: GPUCanvasContext | null = null
  private canvas: HTMLCanvasElement | null = null
  private format: GPUTextureFormat = 'bgra8unorm'
  // Human-readable name of the physical GPU the adapter selected (Intel/NVIDIA/AMD/…), for the init log.
  // WebGPU exposes only a coarse, privacy-limited vendor/architecture; the driver may add a description.
  public gpuName = 'unknown GPU'

  // persistent offscreen color target (never the swapchain texture — that is acquired only in endFrame)
  private offscreen: GPUTexture | null = null
  private offscreenView: GPUTextureView | null = null
  private depthTex: GPUTexture | null = null
  private depthView: GPUTextureView | null = null
  private offW = 0            // 3D target (A) size — canvas / r_scale divisor
  private offH = 0
  // Native (canvas backing) size — B's dimensions, and what the present blit fills. offW == natW when
  // r_scale is 1.
  private natW = 0
  private natH = 0
  // r_scale divisor for this frame (1..4), read once per frame in beginFrame.
  private scale3D = 1
  // Depth for the B 2D passes (warp/scale frames). B is native-sized while A (and depthTex) may be
  // r_scale-reduced — a pass's attachments must share dimensions, so B needs its own depth.
  private depth2Tex: GPUTexture | null = null
  private depth2View: GPUTextureView | null = null
  // Second offscreen color target, used ONLY when underwater (dowarp): the warp blit resolves the 3D
  // (offscreen A) into this (B) with the sin distortion, then the 2D HUD draws onto B undistorted.
  // Same size/format as offscreen; no depth (2D uses none — it reuses the shared depthView). Created +
  // destroyed alongside offscreen in ensureOffscreen.
  private offscreen2: GPUTexture | null = null
  private offscreen2View: GPUTextureView | null = null
  // Set true in begin2D on a dowarp frame so endFrame presents B (offscreen2) instead of A (offscreen).
  private frameWarp = false

  // per-frame recording handles
  private encoder: GPUCommandEncoder | null = null
  private pass: GPURenderPassEncoder | null = null

  // colored-quad pipeline
  private quadPipeline: GPURenderPipeline | null = null
  private quadVBuf: GPUBuffer | null = null
  private orthoBuf: GPUBuffer | null = null
  private orthoBind: GPUBindGroup | null = null
  private orthoData = new Float32Array(4)

  // textured-quad pipeline (font / pics / console background)
  private texPipeline: GPURenderPipeline | null = null
  private texVBuf: GPUBuffer | null = null
  private texSampler: GPUSampler | null = null
  private orthoBindTex: GPUBindGroup | null = null      // ortho uniform bound against texPipeline's auto layout
  // GPUTexture + bind group per source object (Pic or the conchars WebGLTexture), created lazily.
  private texCache = new Map<TexSource, TexEntry>()
  // drawPicTranslate: CPU-remapped menuplyr texture keyed by (top<<8|bottom). The synthetic TexSource
  // objects are also what texCache keys their GPUTexture on. Menu-only, a few combos → never grows large.
  private picTransCache = new Map<number, TexSource>()

  // blit pipeline
  private blitPipeline: GPURenderPipeline | null = null
  private blitSampler: GPUSampler | null = null
  private blitBind: GPUBindGroup | null = null          // plain blit of offscreen A -> swapchain (non-dowarp present)
  private blitBind2: GPUBindGroup | null = null         // plain blit of offscreen2 B -> swapchain (dowarp present)

  // warp blit pipeline (underwater full-screen distortion; offscreen A -> offscreen2 B)
  private warpPipeline: GPURenderPipeline | null = null
  private warpBind: GPUBindGroup | null = null          // samples offscreen A + the uTime uniform; rebuilt on resize
  private warpUTimeBuf: GPUBuffer | null = null         // 16B uniform: [uTime,0,0,0]
  private warpUTimeData = new Float32Array(4)           // persistent upload scratch (no per-frame alloc)

  // ---- 3D world pipeline (solid geometry, static lightmaps + lightstyles + overbright/gamma + dlights
  // + fog) plus the two water pipelines (slice 4: lit water + unlit turbulent) ----
  private worldPipeline: GPURenderPipeline | null = null
  // World shader, alpha variant (blend on, depthWrite off) — used for a translucent brush ENTITY
  // (entalpha < 1) in the solid pass. Byte-identical shader to worldPipeline; only the blend/depth
  // state differs. The world itself always uses worldPipeline (opaque).
  private worldAlphaPipeline: GPURenderPipeline | null = null
  // Fence pipeline (def.SURF.drawfence: grates/grills/chain-link) — the world shader with a leading
  // alpha-test discard (index-255 texels punched out), matching fshBrush's uUseAlphaTest branch. Opaque-
  // with-holes: identical opaque depth/blend state to worldPipeline (depthWrite on, 'less', no blend);
  // only the WORLD_FENCE_WGSL fragment's leading discard differs. Bound per-texture for fence chains in
  // the SOLID pass (world + brush entities); non-fence surfaces keep worldPipeline byte-for-byte.
  private worldFencePipeline: GPURenderPipeline | null = null
  // Lit-water pipeline: the world shader with the diffuse UV warped + per-surface alpha, blended and
  // depth-write-disabled. Shares group0/1/2 layouts with the world pipeline; the water alpha rides in
  // the transform group (group3) params.x, so the pipeline uses only 4 bind groups.
  private litwaterPipeline: GPURenderPipeline | null = null
  // Unlit turbulent pipeline (classic Turbulent program): warped diffuse + gamma + per-surface alpha,
  // no lightmap/dlight/fog. Shares group0/1 layouts; group2 = the transform layout (params.x = alpha).
  private turbPipeline: GPURenderPipeline | null = null
  // Opaque variants (r_wateralpha >= 1): depth-write ON, no blend — QSS-M/WebGL parity
  // (applyWaterAlpha's `newalpha < 1` branch). Without them, opaque water writes no depth and
  // the later particle pass depth-tests straight through the surface.
  private litwaterOpaquePipeline: GPURenderPipeline | null = null
  private turbOpaquePipeline: GPURenderPipeline | null = null
  // Explicit bind group layouts, shared across the world + water pipelines so their bind groups (globals,
  // diffuse texture, lightmap page, transform) are reusable across pipelines rather than 'auto'-bound
  // to one. g0 = globals+lightstyles+dlights, g1 = diffuse, g2 = lightmap page.
  private worldGroup0Layout: GPUBindGroupLayout | null = null
  private worldGroup1Layout: GPUBindGroupLayout | null = null
  private worldGroup2Layout: GPUBindGroupLayout | null = null
  // Per-brush-entity transform layout (dynamic-offset uniform: angles mat3 + origin + params.x). Shared by
  // the world/litwater/turb pipelines so one brushEntBind is reusable at each pipeline's transform slot;
  // params.x carries the entity/water alpha the fragment outputs (1 for the solid world, water alpha for water).
  private brushXformLayout: GPUBindGroupLayout | null = null
  private worldSampler: GPUSampler | null = null        // linear + REPEAT (wall UVs tile past 0..1)
  private lmSampler: GPUSampler | null = null           // linear + REPEAT for the lightmap atlas slots
  private globalsBuf: GPUBuffer | null = null           // 160-byte frame-globals UBO (group0 binding0)
  private globalsBind: GPUBindGroup | null = null       // group0: globals + lightstyles + dlights
  // Second frame-globals set for the skyroom camera pass. A skyroom frame renders the scene twice
  // (QSS-M R_RenderScene ×2); each camera needs its own globals buffer, since one buffer written twice
  // before submit keeps only the last write. activeGlobalsBind is what the 3D draws bind — it defaults to
  // globalsBind, so every non-skyroom frame is byte-identical.
  private skyroomGlobalsBuf: GPUBuffer | null = null
  private skyroomGlobalsBind: GPUBindGroup | null = null
  private activeGlobalsBind: GPUBindGroup | null = null
  private globalsData = new Float32Array(40)            // persistent packed-upload scratch (std140 padded)
  // Lightstyles UBO (group0 binding1): uLightStyles[65] packed 4-per-vec4 (17 vec4s = 68 f32 slots).
  private lightStylesBuf: GPUBuffer | null = null
  private lightStylesData = new Float32Array(68)        // persistent upload scratch; slots 65..67 stay 0
  // Dlights UBO (group0 binding2): count vec4 (x = numDlights) + posRadius[32] + color[32] = 260 f32 /
  // 1040 bytes. Packed each frame from r.state.dlight* (r.gatherDlights). MAX_DLIGHTS = 32 (fshBrush).
  private dlightsBuf: GPUBuffer | null = null
  private dlightsData = new Float32Array(4 + 32 * 4 + 32 * 4)
  // 1x1 black texture + view: the fallback bound for a diffuse texture's missing fullbright split.
  private blackLmTex: GPUTexture | null = null
  private blackLmView: GPUTextureView | null = null
  // Static world VBO (44B interleaved verts), uploaded lazily and keyed off the retained Float32Array's
  // identity so a map change re-uploads. Only pos(0)+texcoord(12) are consumed this slice.
  private worldVBuf: GPUBuffer | null = null
  private worldVBOData: Float32Array | null = null
  // Per-frame CPU-culled index stream (grouped by texture) + its GPU buffer. Staging is persistent and
  // grown once per map to the model's total prebuilt index count (an upper bound on the visible set).
  private worldIndexBuf: GPUBuffer | null = null
  private worldIndices = new Uint32Array(0)
  // GPUTexture + group(1) bind per world diffuse (the WebGLTexture handle, which carries rgba/rgbaW/H).
  private worldTexCache = new Map<TexSource, TexEntry>()
  // Consolidated lightmaps: 4 per-style 256x256 texture_2d_arrays (a layer = a lightmap page,
  // packed compactly per lm.state.lmPageToLayer) + the single group(2) bind group binding all four, bound
  // ONCE for the whole world pass so world draws batch by texture only. Built lazily and keyed off
  // r.state.model_lmlayer_data identity so a new map rebuilds (see ensureLightmapArrays). Per-vertex layer
  // buffer (world VBO slot 1), uploaded alongside worldVBuf and keyed off the same identity.
  private lmArrayTex: (GPUTexture | null)[] = [null, null, null, null]
  private lmArrayBind: GPUBindGroup | null = null
  private lmArrayIdentity: Float32Array | null = null
  private lmLayerBuf: GPUBuffer | null = null
  // Static GPU-cull buffers staged once per map for the compute-cull pass.
  // Built off the world-VBO identity in beginScene (map change), destroyed in
  // clearWorldCaches. NOTHING consumes this yet — see render/webgpu/gpuCull.ts for the buffer layouts.
  private cull: CullData | null = null
  // ---- GPU compute cull for the SOLID world pass (behind r_gpucull; render/webgpu/cullShaders.ts) ----
  // Two compute pipelines (clear + cull) sharing one module + one pair of group layouts. group0 = the
  // per-frame cull UBO (frustum + vieworg + counts); group1 = the 7 CullData storages. The clear+cull
  // passes are encoded into the frame command encoder BEFORE the render pass opens (a compute pass can't
  // nest in a render pass), so the render pass reads the compacted IBO + indirect args across the pass
  // boundary. cullStorageBind is rebuilt per map (its buffers change); cullUboBind is persistent.
  private cullGroup0Layout: GPUBindGroupLayout | null = null
  private cullGroup1Layout: GPUBindGroupLayout | null = null
  private cullClearPipeline: GPUComputePipeline | null = null
  private cullMarkPipeline: GPUComputePipeline | null = null
  private cullUniformBuf: GPUBuffer | null = null    // 112B cull UBO (group0 binding0)
  private cullUboBind: GPUBindGroup | null = null
  private cullStorageBind: GPUBindGroup | null = null // group1 (per-map, rebuilt in buildCullBindings)
  // Persistent per-frame scratch (no hot-path allocation): the PVS bitfield (grown per map) and the UBO
  // pack buffer viewed as both f32 (frustum/vieworg) and u32 (counts/flags).
  private cullVisScratch = new Uint32Array(0)
  private cullUboBuf = new ArrayBuffer(CULL_UBO_BYTES)
  private cullUboF32 = new Float32Array(this.cullUboBuf)
  private cullUboU32 = new Uint32Array(this.cullUboBuf)
  // Monotonic non-zero per-cull frame stamp for the dedup seen-buffer (atomicExchange compares to this).
  private cullFrameStamp = 0
  // True only on frames the compute cull actually ran (r_gpucull on, cull built, PVS available) — the
  // solid draw takes the indirect path only then; otherwise it falls through to the verified CPU path.
  private cullReady = false
  // When true (r_gpucull on) beginFrame defers opening the render pass so ensurePass() can encode the
  // compute cull first. When false the render pass opens in beginFrame exactly as before (byte-identical).
  private deferPass = false
  // ---- alias models (monsters/items/weapons/viewmodel — vshAlias/fshAlias) ----
  // Opaque + alpha variants of the dual-pose alias pipeline (blend + depthWrite differ). Shared
  // layouts: g0 = worldGroup0Layout (only Globals binding0 is read), g1 = aliasEntLayout (per-entity
  // dynamic uniform), g2 = aliasSkinLayout (skin sampler+texture).
  private aliasPipelineOpaque: GPURenderPipeline | null = null
  private aliasPipelineAlpha: GPURenderPipeline | null = null
  private aliasEntLayout: GPUBindGroupLayout | null = null
  // Player-colormap variants (MP shirt/pants colors). Same vertex layout and ent slots as the plain
  // alias pipelines; g2 gains the colormap mask texture. Built once, used only for player entities.
  private aliasPlayerSkinLayout: GPUBindGroupLayout | null = null
  private aliasPlayerPipelineOpaque: GPURenderPipeline | null = null
  private aliasPlayerPipelineAlpha: GPURenderPipeline | null = null
  // Keyed by the base skin source; each entry binds that skin PLUS its colormap mask.
  private aliasPlayerSkinCache = new Map<TexSource, TexEntry>()
  private aliasSkinLayout: GPUBindGroupLayout | null = null
  // One big per-entity uniform buffer (MAX_ALIAS_ENTS × 256B) + its dynamic-offset bind group. Each
  // drawn entity packs its Ent struct into aliasEntData[slot] and binds group1 at [slot*256]. Packed
  // during the draw calls; uploaded ONCE (the used prefix) in endScene.
  private aliasEntBuf: GPUBuffer | null = null
  private aliasEntBind: GPUBindGroup | null = null
  private aliasEntData = new Float32Array(MAX_ALIAS_ENTS * ALIAS_SLOT_FLOATS)
  private aliasEntCursor = 0
  // Per-brush-entity transform buffer (MAX_BRUSH_ENTS × 256B) + its dynamic-offset bind group. Slot 0 =
  // identity (packed + uploaded ONCE at init, never rewritten), bound by the world/turb passes so
  // worldPos = Vert. Slots 1.. are packed by this frame's brush-entity draws (cursor resets to 1 in
  // beginScene) and uploaded ONCE (the used prefix, slots 1..cursor) in endFrame — the same per-frame
  // upload discipline as the alias entity buffer (must NOT live in endScene: that runs only underwater).
  private brushEntBuf: GPUBuffer | null = null
  private brushEntBind: GPUBindGroup | null = null
  private brushEntData = new Float32Array(MAX_BRUSH_ENTS * BRUSH_SLOT_FLOATS)
  private brushEntCursor = 1
  // ---- GPU-driven brush-ENTITY path (r_gpucullents; WORLD_INST_WGSL + render/webgpu/gpuBrush.ts) ----
  // Ironwail's bmodel design: each eligible brush model's triangles are baked once per map into ONE
  // shared index buffer grouped by (texture, fence) (brushDraw), and a frame only uploads per-entity
  // transform records. Entities are RECORDED during the visedict walk (batchBrushEnt) and drawn together
  // in flushBrushBatches, sorted by (model, frame) so every entity sharing a model+frame collapses into a
  // single instanced drawIndexed. No per-face backface walk, no chain rebuild, no per-frame index upload.
  private brushDraw: BrushDrawData | null = null
  private worldInstPipeline: GPURenderPipeline | null = null
  private worldInstFencePipeline: GPURenderPipeline | null = null
  private brushInstLayout: GPUBindGroupLayout | null = null
  private brushInstBuf: GPUBuffer | null = null
  private brushInstBind: GPUBindGroup | null = null
  // Walk-order staging (one BRUSH_STRUCT_FLOATS record per recorded entity) and the sorted staging that
  // mirrors the GPU instance buffer, both persistent (no per-frame allocation).
  private brushPackData = new Float32Array(MAX_BRUSH_ENTS * BRUSH_STRUCT_FLOATS)
  private brushInstData = new Float32Array(MAX_BRUSH_ENTS * BRUSH_STRUCT_FLOATS)
  // Per-frame entry list: the entity's staging slot and its (model, frame) sort key.
  private brushEntrySlot = new Int32Array(MAX_BRUSH_ENTS)
  private brushEntryModel = new Int32Array(MAX_BRUSH_ENTS)
  private brushEntryKey = new Float64Array(MAX_BRUSH_ENTS)
  private brushEntryFrame = new Int32Array(MAX_BRUSH_ENTS)
  private brushEntryOrder = new Int32Array(MAX_BRUSH_ENTS)
  private brushEntryCount = 0
  // Write cursor into the GPU instance buffer; a skyroom frame flushes twice and the second flush
  // appends after the first's range (reset per frame in beginFrame).
  private brushInstCursor = 0
  // ---- instanced alias path (r_instancedmodels; ALIAS_INST_WGSL) ----
  // ONE draw per distinct (model, skin) pair drawn this frame, not per run of consecutive entities:
  // visedicts interleave models, so consecutive-only batching averaged ~1.3 instances/draw. The walk
  // only packs + records entries; flushAliasBatches then sorts them by (model, skin) so each pair is one
  // contiguous instance range. No vertex buffers: g1 = {model VBO as storage, the per-frame instance
  // buffer}, g2 = the shared skin layout.
  private aliasInstPipeline: GPURenderPipeline | null = null
  private aliasInstLayout: GPUBindGroupLayout | null = null
  private aliasInstBuf: GPUBuffer | null = null
  // Walk-order staging: one 144B record per batched entity, packed where the visedict walk found it.
  private aliasPackData = new Float32Array(MAX_ALIAS_ENTS * ALIAS_INST_FLOATS)
  private aliasPackU32 = new Uint32Array(this.aliasPackData.buffer)
  private aliasPackCursor = 0
  // Sorted staging — mirrors the GPU instance buffer: the same records grouped by (model, skin).
  private aliasInstData = new Float32Array(MAX_ALIAS_ENTS * ALIAS_INST_FLOATS)
  private aliasInstU32 = new Uint32Array(this.aliasInstData.buffer)
  private aliasInstCursor = 0
  // g1 bind per alias model, keyed by its VBO (which the aliasVBCache owns) — dropped with that cache.
  private aliasInstBindCache = new Map<GPUBuffer, GPUBindGroup>()
  // Per-frame entry list (parallel persistent arrays; entryCount resets per frame like the cursors).
  // One entry per batched entity: its walk-order staging slot, the model's vert count, its sort key and
  // the two bind groups the group draw needs.
  private entrySlot = new Int32Array(MAX_ALIAS_ENTS)
  private entryVerts = new Int32Array(MAX_ALIAS_ENTS)
  private entryKey = new Float64Array(MAX_ALIAS_ENTS)
  private entryInstBind: (GPUBindGroup | null)[] = new Array(MAX_ALIAS_ENTS).fill(null)
  private entrySkinBind: (GPUBindGroup | null)[] = new Array(MAX_ALIAS_ENTS).fill(null)
  private entryOrder = new Int32Array(MAX_ALIAS_ENTS)
  private entryCount = 0
  // Dense integer id per bind group, so the entry sort key is numeric. Per-map (the binds die with the
  // caches) → cleared in clearWorldCaches.
  private bindIds = new Map<GPUBindGroup, number>()
  private bindIdNext = 0
  // GPUBuffer per alias model, keyed by the retained cmds Float32Array identity (webgpu-only,
  // model.cmdsData). Per-map (models reload on map change) → cleared in clearWorldCaches.
  private aliasVBCache = new Map<Float32Array, GPUBuffer>()
  // INDEX GPUBuffer per opaque PURE-SOLID brush submodel, keyed by its precomputed indexData Uint32Array
  // identity (Model.brushPrecompute.indexData). Per-map (buildBrushPrecompute makes fresh arrays each map)
  // → cleared in clearWorldCaches.
  private brushPrecomputeBufCache = new Map<Uint32Array, GPUBuffer>()
  // GPUTexture + group2 bind per skin, keyed by the skin's retained texnum object (rgba/rgbaW/rgbaH).
  // Per-map → cleared in clearWorldCaches.
  private aliasSkinCache = new Map<TexSource, TexEntry>()
  // ---- sprite models (explosions/bubbles/flame/laser — vshSprite/fshSprite; no lighting) ----
  // A camera-facing billboard quad per sprite entity, built CPU-side each frame with drawSpriteModel's
  // exact math (world-space origin ± right*w ± up*h). group0 = the shared world globals (only Globals is
  // read); group1 = the frame texture bind (reuses aliasSkinLayout: {sampler, texture}). Alpha-blended,
  // depth-tested 'less', depth-write off — matches drawEntitiesOnList's sprite sub-pass.
  private spritePipeline: GPURenderPipeline | null = null
  // Persistent CPU billboard-vert scratch (all sprites this frame, packed contiguously) + its dynamic
  // vertex buffer (grown as needed). Uploaded once per frame in the sprite sub-pass, then one draw per
  // sprite (each sprite's 6 verts are consecutive, so the draw's firstVertex = spriteIndex*6).
  private spriteVertData = new Float32Array(MAX_SPRITE_ENTS * SPRITE_QUAD_FLOATS)
  private spriteVBuf: GPUBuffer | null = null
  // Per-sprite frame-texture bind group for this frame's packed sprites (persistent, index = packed
  // sprite index). Reused across frames; only entries 0..count are read.
  private spriteDrawBinds: (GPUBindGroup | null)[] = new Array(MAX_SPRITE_ENTS).fill(null)
  // GPUTexture + group1 bind per sprite frame, keyed by the frame's retained texturenum handle
  // (rgba/rgbaW/rgbaH). Per-map (models reload on map change) → cleared in clearWorldCaches.
  private spriteTexCache = new Map<TexSource, TexEntry>()
  // Per-sprite billboard basis for the oriented case (angleVectors output); sprites pack sequentially,
  // so reusing these across sprites within a frame is safe (no per-frame allocation).
  private spriteRight: V3 = [0, 0, 0]
  private spriteUp: V3 = [0, 0, 0]
  // Viewmodel group0: the shared globals with a NARROWED perspective (fov*0.82). Uploaded per frame in
  // drawViewModel; the bind group pairs it with the shared lightstyles/dlights buffers.
  private viewmodelGlobalsBuf: GPUBuffer | null = null
  private viewmodelGlobalsBind: GPUBindGroup | null = null
  private viewmodelGlobalsData = new Float32Array(40)
  // The 3D view-rect viewport in backing pixels (set in beginScene), so drawViewModel can re-set it
  // with a squashed depth range (0..0.3) and restore it (0..1) around the weapon draw.
  private vpX = 0
  private vpY = 0
  private vpW = 0
  private vpH = 0
  // Persistent per-alias-draw scratch (alias draws are sequential — fully processed one at a time — so
  // reusing these across entities is safe and avoids per-frame allocation).
  private aliasLerpOrigin: V3 = [0, 0, 0]
  private aliasLerpAngles: V3 = [0, 0, 0]
  private aliasAmbient: V3 = [0, 0, 0]
  private aliasShade: V3 = [0, 0, 0]
  private aliasForward: V3 = [0, 0, 0]
  private aliasRight: V3 = [0, 0, 0]
  private aliasUp: V3 = [0, 0, 0]
  private aliasLightVec: V3 = [0, 0, 0]
  // prepAliasEntity outputs consumed by both alias paths (valid only until the next prep call).
  private aliasPrepVBO: GPUBuffer | null = null
  private aliasPrepScale = 1
  private aliasPrepAlpha = 1

  // ---- classic id particles (blood/explosions/sparks/trails/teleport — PARTICLE_WGSL) ----
  // A static unit-corner quad (slot 0) + a per-frame instance stream (slot 1, 16B: origin f32x3 + color
  // unorm8x4). Instances are re-packed from the r.state pool into the SAME r.state scratch the WebGL
  // drawClassicParticles fills (particleInstanceFloats/Bytes), then uploaded once for one instanced draw.
  private particlePipeline: GPURenderPipeline | null = null
  private particleGlobalsBuf: GPUBuffer | null = null       // 176B: perspective + viewAngles + viewOrigin + vpn/gamma + params/fogColor
  private particleGlobalsBind: GPUBindGroup | null = null
  private particleGlobalsData = new Float32Array(44)        // persistent upload scratch (176B)
  private particleCornerBuf: GPUBuffer | null = null        // static [-1,-1,-1,1,1,-1,1,1] (triangle-strip)
  private particleInstBuf: GPUBuffer | null = null          // per-frame instance stream, grown as needed
  private particleInstBytes = 0

  // ---- flashblend dlight glow balls (gl_flashblend 1 — DLIGHT_WGSL) ----
  // Instanced fan geometry expanded to a triangle-list (WebGPU has no triangle-fan), one instance per
  // active dynamic light carrying (origin, radius). Own globals buffer (can't share the particle one:
  // same-buffer multi-write per frame would clobber, and flashblend draws before particles).
  private dlightPipeline: GPURenderPipeline | null = null
  private dlightGlobalsBuf: GPUBuffer | null = null         // 144B, same PGlobals layout as particles
  private dlightGlobalsBind: GPUBindGroup | null = null
  private dlightGlobalsData = new Float32Array(36)
  private dlightFanBuf: GPUBuffer | null = null             // static 48-vert triangle-list (fan → list)
  private dlightInstBuf: GPUBuffer | null = null            // per-frame (origin f32x3 + radius f32), ≤32 lights
  private dlightInstData = new Float32Array(32 * 4)

  // ---- scripted effectinfo particles (torches/weather — PSCRIPT_WGSL) ----
  // Static unit-corner quad (slot 0) + one per-bucket instance stream (slot 1, 56B stride). The CPU pack
  // (pscript.fillInstanceBuffers) fills pscript.state.instanceData[0..2]; each non-empty bucket uploads
  // its stream and draws with its own blend-mode pipeline (alpha / additive / invmod). All three
  // pipelines share one explicit layout so the globals (group0) + atlas (group1) binds are reusable.
  private pscriptPipelines: (GPURenderPipeline | null)[] = [null, null, null]
  private pscriptGlobalsLayout: GPUBindGroupLayout | null = null
  private pscriptAtlasLayout: GPUBindGroupLayout | null = null
  private pscriptGlobalsBuf: GPUBuffer | null = null        // 176B: + vright + vup/pixelWidth + gamma
  private pscriptGlobalsBind: GPUBindGroup | null = null
  private pscriptGlobalsData = new Float32Array(44)         // persistent upload scratch (176B)
  private pscriptSampler: GPUSampler | null = null          // linear + REPEAT (matches the GL atlas upload)
  private pscriptCornerBuf: GPUBuffer | null = null
  private pscriptInstBufs: (GPUBuffer | null)[] = [null, null, null]
  private pscriptInstBytes: number[] = [0, 0, 0]
  // Atlas GPUTexture + its group1 bind group, keyed by the retained rgba identity (pscript retains rgba
  // WebGPU-gated in loadParticleFont). Dropped in clearWorldCaches; a font reload re-uploads.
  private pscriptAtlasTex: GPUTexture | null = null
  private pscriptAtlasBind: GPUBindGroup | null = null
  private pscriptAtlasSrc: Uint8Array | null = null

  // ---- classic scrolling sky (dome) ----
  // Depth-prime pipeline (SkyChain): renders sky-flagged world surfaces from the world VBO writing
  // depth only (color target writeMask 0). Dome pipeline (Sky): the far-away scrolling two-layer dome,
  // depthCompare 'greater' so it fills only where the prime stamped a nearer sky-surface depth.
  private skyChainPipeline: GPURenderPipeline | null = null
  private skyDomePipeline: GPURenderPipeline | null = null
  // g1 = { per-octant uScale (b0, static), shared uTime.xy+gamma (b1, per-frame) }; g2 = { sampler,
  // tSolid, tAlpha }.
  private skyUniformLayout: GPUBindGroupLayout | null = null
  private skyTexLayout: GPUBindGroupLayout | null = null
  // 8 static per-octant uScale uniforms + their group1 bind groups (each pairs its octant scale buffer
  // with the shared time/gamma buffer), mirroring GL's 8 uScale + drawArrays(0,180) octant draws.
  private skyOctantScaleBuf: (GPUBuffer | null)[] = new Array(8).fill(null)
  private skyOctantBind: (GPUBindGroup | null)[] = new Array(8).fill(null)
  private skyTimeGammaBuf: GPUBuffer | null = null       // 16B uniform [uTime.x, uTime.y, gamma, 0]
  private skyTimeGammaData = new Float32Array(4)         // persistent per-frame upload scratch
  private skyScaleScratch = new Float32Array(4)          // reused to fill each static octant buffer
  // Dome vertex buffer (180 verts × vec3), uploaded lazily keyed off r.state.skyvecs_data identity
  // (built once at engine init, so this uploads once and stays valid across maps).
  private skyDomeVBuf: GPUBuffer | null = null
  private skyDomeData: Float32Array | null = null
  // Sky textures (solid + alpha, 128x128) + their group2 bind group. Keyed off the solid layer's rgba
  // Uint8Array identity: r.initSky writes a fresh copy per map onto the (stable) sky-texture handle, so
  // an identity change re-uploads. Also dropped in clearWorldCaches on map change.
  private skySolidTex: GPUTexture | null = null
  private skyAlphaTex: GPUTexture | null = null
  private skyTexBind: GPUBindGroup | null = null
  private skyUploadedRgba: Uint8Array | null = null
  // ---- cubemap skybox (modern gfx/env skyboxes — SKYCUBE_WGSL) ----
  // Draws the visible sky surfaces (position-only, off the world VBO) sampling a cube texture by the
  // fragment's world-space direction, with skyfog. group0 = the shared world globals; group1 = { CLAMP/
  // linear sampler, cube texture, uSkyFog uniform }. Opaque real-depth surfaces (depthWrite on, 'less').
  private skyCubePipeline: GPURenderPipeline | null = null
  private skyCubeTexLayout: GPUBindGroupLayout | null = null
  private skyCubeSampler: GPUSampler | null = null       // linear + CLAMP_TO_EDGE (matches installCubemap)
  private skyCubeFogBuf: GPUBuffer | null = null          // 16B uniform [uSkyFog, 0, 0, 0], uploaded per frame
  private skyCubeFogData = new Float32Array(4)            // persistent per-frame upload scratch
  // Cube GPUTexture + its group1 bind group, keyed off sky.state.cubeFaces array identity (a fresh array
  // per skybox load → an identity change re-uploads). Dropped in clearWorldCaches on map change.
  private skyCubeTex: GPUTexture | null = null
  private skyCubeBind: GPUBindGroup | null = null
  private skyCubeUploaded: Uint8Array[] | null = null

  // The 8 octant uScale triples, in GL's draw order (drawSkyBox).
  private static readonly SKY_OCTANTS: readonly number[][] = [
    [2, -2, 1], [2, -2, -1], [2, 2, 1], [2, 2, -1],
    [-2, -2, 1], [-2, -2, -1], [-2, 2, 1], [-2, 2, -1],
  ]

  // Frame cursor into worldIndices/worldIndexBuf. The solid, lit-water and turb passes append into the
  // same staging array + GPU index buffer at disjoint ranges (a face belongs to exactly one pass), so
  // one pass's writeBuffer never clobbers another's. Reset to 0 each frame in beginScene.
  private worldIdxCursor = 0
  // Index capacity the last overflow asked for. The requirement is PER DRAWN ENTITY, not per unique
  // model — several entities can share one external .bsp brush model and each appends its whole index
  // set — so it can't be derived from the model list. A gather that would overflow records what it
  // wanted here and beginFrame grows to it, converging in one frame.
  private worldIdxWant = 0

  // CPU vertex batches: colored [x,y,r,g,b,a] and textured [x,y,u,v], each contiguous in its own
  // buffer; runs index into whichever buffer matches their kind.
  private batch = new Float32Array(MAX_QUADS * VERTS_PER_QUAD * FLOATS_PER_VERT)
  private batchVerts = 0
  private texBatch = new Float32Array(MAX_QUADS * VERTS_PER_QUAD * TEX_FLOATS_PER_VERT)
  private texBatchVerts = 0

  // Ordered run table (preallocated — no per-frame allocation). Each run: kind, first vertex (in its
  // kind's buffer), vertex count, and (textured only) the source texture object.
  private runKind = new Int32Array(MAX_RUNS)
  private runFirst = new Int32Array(MAX_RUNS)
  private runCount = new Int32Array(MAX_RUNS)
  private runTex: (TexSource | null)[] = new Array(MAX_RUNS).fill(null)
  private runN = 0
  private curKind = -1
  private curTex: TexSource | null = null

  async init(canvas: HTMLCanvasElement): Promise<void> {
    const gpu = navigator.gpu
    if (gpu == null) throw new Error('WebGPU: navigator.gpu unavailable')
    const adapter = await gpu.requestAdapter()
    if (adapter == null) throw new Error('WebGPU: no adapter')
    // GPUAdapterInfo (Chrome ≥119 exposes it as a property; older builds need requestAdapterInfo()).
    // Fields are privacy-limited: vendor ('intel'/'nvidia'/'amd'/'apple'/…) + architecture are the
    // reliable ones; description is a fuller name when the driver provides it.
    try {
      const info: any = (adapter as any).info ?? (typeof (adapter as any).requestAdapterInfo === 'function'
        ? await (adapter as any).requestAdapterInfo() : null)
      if (info != null) {
        const parts = [info.description, info.vendor, info.architecture, info.device].filter((s: string) => s)
        if (parts.length > 0) this.gpuName = (info.description && info.description.length > 0)
          ? info.description
          : [info.vendor, info.architecture].filter((s: string) => s).join(' ') || parts[0]
      }
    } catch { /* adapter info is best-effort; leave the default */ }
    // Raise every limit we lean on to the adapter's own maximum — requesting the adapter's reported
    // limit always succeeds. WebGPU's DEFAULTS are far too small for large maps:
    //  - maxBufferSize default 256MB: immortal's world vertex buffer alone is ~324MB → CreateBuffer fails.
    //  - maxStorageBufferBindingSize default 128MB: the GPU-cull IBO-as-SSBO + per-surface SSBO exceed it.
    //  - maxBindGroups default 4: world/lit-water use exactly 4; headroom is harmless.
    //  - maxTextureArrayLayers default 256: the consolidated lightmap texture_2d_arrays use one layer per
    //    lightmap page — big maps exceed 256 (a multi-array fallback past the adapter max is a future slice).
    const lim = adapter.limits
    this.device = await adapter.requestDevice({
      requiredLimits: {
        maxBindGroups: lim.maxBindGroups,
        maxBufferSize: lim.maxBufferSize,
        maxStorageBufferBindingSize: lim.maxStorageBufferBindingSize,
        maxTextureArrayLayers: lim.maxTextureArrayLayers,
      },
    })
    // Surface WebGPU validation errors + device loss to the console (they otherwise only appear in
    // Chrome-internal logging, invisible to headless/automation console readers).
    this.device.addEventListener('uncapturederror', (e) => {
      console.log('[webgpu-error] ' + (e as GPUUncapturedErrorEvent).error.message)
    })
    this.device.lost.then((info) => {
      console.log('[webgpu-lost] reason=' + info.reason + ' ' + info.message)
    })
    this.canvas = canvas
    this.context = canvas.getContext('webgpu')
    if (this.context == null) throw new Error('WebGPU: canvas.getContext("webgpu") returned null')
    this.format = gpu.getPreferredCanvasFormat ? gpu.getPreferredCanvasFormat() : 'bgra8unorm'
    // 'premultiplied', not 'opaque': the canvas composites over the page so the CSS BACKTILE
    // border shows through wherever the frame left alpha 0 (see CLEAR).
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'premultiplied' })

    this.createPipelines()
    this.createCullPipelines()
    // r_scale isn't registered yet at init (r.init runs after vid.init); beginFrame re-derives per frame.
    this.ensureOffscreen(canvas.width || 1, canvas.height || 1, canvas.width || 1, canvas.height || 1)
  }

  // The two compute-cull pipelines (clear + cull) + their shared group layouts and the
  // persistent cull UBO / its bind group. Storage bind group (group1) is per-map — buildCullBindings().
  private createCullPipelines(): void {
    const dev = this.device
    if (dev == null) return
    const CS = GPUShaderStage.COMPUTE
    this.cullGroup0Layout = dev.createBindGroupLayout({
      entries: [{ binding: 0, visibility: CS, buffer: { type: 'uniform' } }],
    })
    this.cullGroup1Layout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: CS, buffer: { type: 'read-only-storage' } },   // marksurf
        { binding: 1, visibility: CS, buffer: { type: 'read-only-storage' } },   // surfs
        { binding: 2, visibility: CS, buffer: { type: 'read-only-storage' } },   // srcIdx
        { binding: 3, visibility: CS, buffer: { type: 'read-only-storage' } },   // vis
        { binding: 4, visibility: CS, buffer: { type: 'storage' } },             // idx (out IBO)
        { binding: 5, visibility: CS, buffer: { type: 'storage' } },             // cmds (indirect, atomic)
        { binding: 6, visibility: CS, buffer: { type: 'storage' } },             // seen (atomic)
      ],
    })
    const cullLayout = dev.createPipelineLayout({
      bindGroupLayouts: [this.cullGroup0Layout, this.cullGroup1Layout],
    })
    const cullModule = dev.createShaderModule({ code: CULL_WGSL })
    this.cullClearPipeline = dev.createComputePipeline({
      layout: cullLayout, compute: { module: cullModule, entryPoint: 'cs_clear' },
    })
    this.cullMarkPipeline = dev.createComputePipeline({
      layout: cullLayout, compute: { module: cullModule, entryPoint: 'cs_cull' },
    })
    this.cullUniformBuf = dev.createBuffer({ size: CULL_UBO_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.cullUboBind = dev.createBindGroup({
      layout: this.cullGroup0Layout,
      entries: [{ binding: 0, resource: { buffer: this.cullUniformBuf } }],
    })
  }

  // Rebuild the per-map compute-cull storage bind group (group1) + size the PVS scratch. Called after
  // buildCullData in beginScene (map change); leaves cullStorageBind null when there is no cull data.
  private buildCullBindings(): void {
    const dev = this.device
    this.cullStorageBind = null
    const cull = this.cull
    if (dev == null || cull == null || this.cullGroup1Layout == null) return
    this.cullStorageBind = dev.createBindGroup({
      layout: this.cullGroup1Layout,
      entries: [
        { binding: 0, resource: { buffer: cull.marksurfBuf } },
        { binding: 1, resource: { buffer: cull.surfBuf } },
        { binding: 2, resource: { buffer: cull.srcIndexBuf } },
        { binding: 3, resource: { buffer: cull.visBuf } },
        { binding: 4, resource: { buffer: cull.indexBuf } },
        { binding: 5, resource: { buffer: cull.indirectBuf } },
        { binding: 6, resource: { buffer: cull.seenBuf } },
      ],
    })
    const visWords = (cull.numLeaves + 31) >> 5
    if (this.cullVisScratch.length < visWords) this.cullVisScratch = new Uint32Array(visWords)
  }

  // Open the persistent offscreen render pass (color clear + depth clear). Factored out of beginFrame so
  // ensurePass() can open it lazily on an r_gpucull frame (after the compute cull is encoded).
  private openOffscreenPass(): void {
    if (this.encoder == null || this.offscreenView == null) return
    this.pass = this.encoder.beginRenderPass({
      colorAttachments: [{
        view: this.offscreenView,
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: CLEAR,
      }],
      depthStencilAttachment: this.depthView != null ? {
        view: this.depthView,
        depthLoadOp: 'clear',
        depthClearValue: 1.0,
        depthStoreOp: 'store',
      } : undefined,
    })
  }

  // Skyroom depth-reset (clearFrame(false,true) from r.renderView, between the skyroom and main passes,
  // mirroring QSS-M's glClear(GL_DEPTH_BUFFER_BIT) with color-clear disabled): end the offscreen pass and
  // reopen it KEEPING color (the composited skyroom) but CLEARING depth, so the main world draws over the
  // skyroom while its sky windows (depth-only prime in drawSky) let the skyroom show through.
  private restartPassDepthClear(): void {
    if (this.encoder == null || this.pass == null || this.offscreenView == null) return
    this.pass.end()
    this.pass = this.encoder.beginRenderPass({
      colorAttachments: [{
        view: this.offscreenView,
        loadOp: 'load',
        storeOp: 'store',
      }],
      depthStencilAttachment: this.depthView != null ? {
        view: this.depthView,
        depthLoadOp: 'clear',
        depthClearValue: 1.0,
        depthStoreOp: 'store',
      } : undefined,
    })
    // A fresh pass resets the viewport to the full target — re-apply the stored 3D view rect.
    this.pass.setViewport(this.vpX, this.vpY, this.vpW, this.vpH, 0.0, 1.0)
  }

  // Ensure the offscreen render pass is open, opening it lazily when beginFrame deferred it for r_gpucull.
  // The FIRST 3D draw (drawSky) calls this with applyViewport=true so the compute cull is encoded into the
  // command encoder BEFORE the render pass begins (a compute pass cannot be nested in a render pass) and
  // the stored 3D viewport is applied; the 2D fallback (begin2D) calls it with false. A no-op once open,
  // so on the r_gpucull=0 path (pass already opened in beginFrame) it costs one null check.
  private ensurePass(applyViewport: boolean): void {
    if (this.pass != null) return
    if (this.encoder == null || this.offscreenView == null) return
    if (applyViewport) this.encodeCull()   // compute BEFORE opening the render pass
    this.openOffscreenPass()
    if (applyViewport && this.pass != null)
      this.pass.setViewport(this.vpX, this.vpY, this.vpW, this.vpH, 0.0, 1.0)
  }

  // Encode the clear + cull compute passes for this frame's solid world into the frame command encoder.
  // Uploads the per-leaf PVS bitfield (reusing the engine's just-computed r.state.cached_vis — the exact
  // leaf visibility markSurfaces used this frame) and the cull UBO (frustum planes + view origin + a
  // monotonic frameStamp for dedup), then dispatches one thread per draw slot (clear) and one per
  // marksurface (cull). Sets cullReady so the solid draw takes the indirect path. No-op (leaves cullReady
  // false → CPU fallback) if r_gpucull is off, the cull data isn't built, or the PVS isn't available yet.
  private encodeCull(): void {
    this.cullReady = false
    const dev = this.device
    const enc = this.encoder
    if (dev == null || enc == null) return
    if (r.cvr.gpucull == null || r.cvr.gpucull.value === 0) return
    const cull = this.cull
    if (cull == null || this.cullStorageBind == null || this.cullUboBind == null
        || this.cullUniformBuf == null || this.cullClearPipeline == null || this.cullMarkPipeline == null) return
    const vis = r.state.cached_vis
    if (vis == null) return

    // Per-leaf PVS bitfield keyed by model.leafs index. Classic PVS off-by-one: vis bit j (0-based over
    // the numleafs real leaves) is leaf j+1 in model.leafs, so set cullVis bit (j+1). Leaf 0 (the solid
    // outside leaf) stays 0 — never visible. cull.numLeaves = model.leafs.length = numleafs + 1.
    const scratch = this.cullVisScratch
    const visWords = (cull.numLeaves + 31) >> 5
    scratch.fill(0, 0, visWords)
    // Bit loop bound: numVisLeafs (model.numleafs), NOT leafs.length-1 — BSP2 leafs beyond the vis-leaf
    // count have no PVS row coverage (their bits are padding) and no marksurf entries reference them.
    const numleafs = cull.numVisLeafs
    for (let j = 0; j < numleafs; j++) {
      if (vis[j >> 3] & (1 << (j & 7))) {
        const li = j + 1
        scratch[li >> 5] |= (1 << (li & 31))
      }
    }
    dev.queue.writeBuffer(cull.visBuf, 0, scratch.buffer, 0, visWords * 4)

    // Monotonic non-zero frame stamp for the dedup seen-buffer (a u32 never wraps in practice).
    let fs = (this.cullFrameStamp + 1) >>> 0
    if (fs === 0) fs = 1
    this.cullFrameStamp = fs

    // 2D dispatch linearization: one thread per marksurface, 64/workgroup; spill past the 65535 single-
    // dimension cap into rows of gx groups. rowStride (counts.w) = gx*64 = threads per grid row.
    const groups = Math.ceil(cull.numMarksurfs / CULL_WORKGROUP_SIZE)
    const gx = Math.min(Math.max(1, groups), CULL_MAX_GROUPS_DIM)
    const gy = Math.max(1, Math.ceil(groups / CULL_MAX_GROUPS_DIM))

    // Pack the cull UBO: 4 frustum planes (r.state.frustumFlat), view origin, counts.
    const f = this.cullUboF32
    const uu = this.cullUboU32
    const fr = r.state.frustumFlat
    for (let i = 0; i < 16; i++) f[i] = fr[i]
    const vo = r.state.refdef.vieworg
    f[16] = vo[0]; f[17] = vo[1]; f[18] = vo[2]; f[19] = 0
    uu[20] = cull.numMarksurfs
    uu[21] = fs
    uu[22] = cull.numSlots
    uu[23] = gx * CULL_WORKGROUP_SIZE
    // flags.x = r_oldskyleaf: 0 drops marksurfs whose leaf is CONTENTS_SKY (cs_cull's packedleafsky gate),
    // keeping the cull's leaf set identical to r.markSurfaces'. Read per frame — the cvar is live.
    uu[24] = (r.cvr.oldskyleaf != null && r.cvr.oldskyleaf.value !== 0) ? 1 : 0
    uu[25] = 0; uu[26] = 0; uu[27] = 0
    dev.queue.writeBuffer(this.cullUniformBuf, 0, this.cullUboBuf, 0, CULL_UBO_BYTES)

    const cpass = enc.beginComputePass()
    // CLEAR: zero each slot's indirect indexCount.
    cpass.setPipeline(this.cullClearPipeline)
    cpass.setBindGroup(0, this.cullUboBind)
    cpass.setBindGroup(1, this.cullStorageBind)
    cpass.dispatchWorkgroups(Math.max(1, Math.ceil(cull.numSlots / CULL_WORKGROUP_SIZE)))
    // CULL: PVS/backface/frustum/dedup + compact fan indices per surface.
    cpass.setPipeline(this.cullMarkPipeline)
    cpass.setBindGroup(0, this.cullUboBind)
    cpass.setBindGroup(1, this.cullStorageBind)
    cpass.dispatchWorkgroups(gx, gy, 1)
    cpass.end()
    // The compute->render pass boundary makes these writes visible to the solid draw's indirect+index reads.
    this.cullReady = true
  }

  private createPipelines(): void {
    const dev = this.device
    if (dev == null) return

    // ---- colored-quad pipeline ----
    const quadModule = dev.createShaderModule({ code: QUAD_WGSL })
    this.quadPipeline = dev.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: quadModule,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: QUAD_STRIDE_BYTES,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },   // xy
            { shaderLocation: 1, offset: 8, format: 'float32x4' },   // rgba
          ],
        }],
      },
      fragment: {
        module: quadModule,
        entryPoint: 'fs_main',
        targets: [{
          format: this.format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
      // The offscreen pass now owns a depth attachment (for the 3D world). The 2D pipelines never test
      // or write depth (they draw on top, in submission order), but must declare a compatible depth
      // state or they can't render into a pass that has one.
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'always' },
    })

    this.quadVBuf = dev.createBuffer({
      size: MAX_QUADS * VERTS_PER_QUAD * QUAD_STRIDE_BYTES,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
    this.orthoBuf = dev.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.orthoBind = dev.createBindGroup({
      layout: this.quadPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.orthoBuf } }],
    })

    // ---- textured-quad pipeline ----
    const texModule = dev.createShaderModule({ code: TEXQUAD_WGSL })
    this.texPipeline = dev.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: texModule,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: TEX_STRIDE_BYTES,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x2' },   // xy
            { shaderLocation: 1, offset: 8, format: 'float32x2' },   // uv
          ],
        }],
      },
      fragment: {
        module: texModule,
        entryPoint: 'fs_main',
        targets: [{
          format: this.format,
          blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            alpha: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
          },
        }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'always' },
    })
    this.texVBuf = dev.createBuffer({
      size: MAX_QUADS * VERTS_PER_QUAD * TEX_STRIDE_BYTES,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
    // The ortho uniform is shared, but 'auto' layouts are per-pipeline, so bind it against texPipeline's.
    this.orthoBindTex = dev.createBindGroup({
      layout: this.texPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.orthoBuf } }],
    })
    // Linear to match the WebGL 2D path (loadPicTexture / char_texture upload with LINEAR filtering),
    // so WebGPU text/pics look identical rather than crisper. The blit sampler stays nearest (the
    // offscreen target is 1:1 with the swapchain, so nearest is an exact copy).
    this.texSampler = dev.createSampler({ magFilter: 'linear', minFilter: 'linear' })

    // ---- blit pipeline ----
    const blitModule = dev.createShaderModule({ code: BLIT_WGSL })
    this.blitPipeline = dev.createRenderPipeline({
      layout: 'auto',
      vertex: { module: blitModule, entryPoint: 'vs_main' },
      fragment: {
        module: blitModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list' },
    })
    this.blitSampler = dev.createSampler({ magFilter: 'nearest', minFilter: 'nearest' })

    // ---- warp blit pipeline (underwater full-screen distortion) ----
    // Same fullscreen-triangle blit as blitPipeline, but the fragment perturbs the sampled UV by
    // fshWarp's sin distortion. group(0) = { sampler(0), source texture(1), uTime uniform(2) }.
    const warpModule = dev.createShaderModule({ code: BLIT_WARP_WGSL })
    this.warpPipeline = dev.createRenderPipeline({
      layout: 'auto',
      vertex: { module: warpModule, entryPoint: 'vs_main' },
      fragment: {
        module: warpModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list' },
    })
    this.warpUTimeBuf = dev.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    // ---- 3D world pipeline (solid) + water pipelines (lit water / unlit turbulent) ----
    // Explicit, shared bind group layouts so the world/litwater/turb pipelines can reuse the same
    // globals/diffuse/lightmap/alpha bind groups (an 'auto' layout is per-pipeline and non-shareable).
    const VF = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT
    // g0: globals (b0) + lightstyles (b1) + dlights (b2). All three uniforms; globals+lightstyles read
    // in the vertex stage, globals+dlights in the fragment stage — VERTEX|FRAGMENT covers every case.
    this.worldGroup0Layout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: VF, buffer: { type: 'uniform' } },
        { binding: 1, visibility: VF, buffer: { type: 'uniform' } },
        { binding: 2, visibility: VF, buffer: { type: 'uniform' } },
      ],
    })
    // g1: diffuse sampler + texture + fullbright texture. The fullbright binding (2) is always present:
    // a texture with a fullbright split binds its own glow GPUTexture, one without binds the shared 1x1
    // black fallback (so the shader's additive fullbright is +0 — no per-texture flag needed, and the
    // solid world stays byte-identical). Shared by the world/litwater/turb pipelines; turb's shader
    // simply ignores binding 2.
    this.worldGroup1Layout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    })
    // g2: lightmap sampler + 4 per-style texture_2d_arrays (one array per style slot, a layer =
    // a lightmap page). Bound ONCE for the whole world pass; the surface's page is a per-vertex layer index.
    this.worldGroup2Layout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
        { binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d-array' } },
      ],
    })
    // Per-brush-entity transform: dynamic-offset uniform (angles mat3 + origin + alpha). VERTEX reads
    // angles/origin; FRAGMENT reads params.x (the entity/water alpha the fragment outputs) — VERTEX|FRAGMENT
    // covers both. Shared across the world/litwater/turb pipelines (each at its own free group index).
    this.brushXformLayout = dev.createBindGroupLayout({
      entries: [{
        binding: 0, visibility: VF,
        buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: BRUSH_STRUCT_BYTES },
      }],
    })
    // The 4-attribute world/lit-water vertex layout (pos, texcoord, lmcoord, lmstyles) off the 44B VBO,
    // plus a SECOND buffer (slot 1) carrying the 4 compact lightmap array-layers per vertex.
    const worldVertexBuffers: GPUVertexBufferLayout[] = [{
      arrayStride: WORLD_VERTEX_STRIDE,
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },    // pos      (4*0)
        { shaderLocation: 1, offset: 12, format: 'float32x2' },   // texcoord (4*3)
        { shaderLocation: 2, offset: 20, format: 'float32x2' },   // lmcoord  (4*5)
        { shaderLocation: 3, offset: 28, format: 'float32x4' },   // lmstyles (4*7)
      ],
    }, {
      arrayStride: LM_LAYER_STRIDE,
      attributes: [
        { shaderLocation: 4, offset: 0, format: 'float32x4' },    // lightmap array-layers (per style slot)
      ],
    }]
    // src-alpha / one-minus-src-alpha blend for the translucent water passes (alpha=1 reduces to opaque
    // color, so an alpha-1 water surface still matches the WebGL opaque case rgb-for-rgb).
    const WATER_BLEND: GPUBlendState = {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    }

    const worldModule = dev.createShaderModule({ code: WORLD_WGSL })
    // World layout gains group3 (the per-entity transform). Slot 0 = identity → worldPos = Vert, so the
    // solid world render is byte-identical; brush entities bind their own slot.
    const worldLayout = dev.createPipelineLayout({
      bindGroupLayouts: [this.worldGroup0Layout, this.worldGroup1Layout, this.worldGroup2Layout, this.brushXformLayout],
    })
    this.worldPipeline = dev.createRenderPipeline({
      layout: worldLayout,
      vertex: { module: worldModule, entryPoint: 'vs_main', buffers: worldVertexBuffers },
      fragment: {
        module: worldModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format }],   // opaque world: no blend
      },
      // Cull FRONT faces, matching GL (GL.ts cullFace(FRONT) + CULL_FACE on during the scene): the CPU
      // visibility walk stamps whole leaf chains WITHOUT a per-face plane-side test, so the chains
      // contain back-facing surfaces. GL removes them at raster; 'none' let an UNLIT back-facing face
      // that sits between the eye and lit geometry win the depth test and paint a black polygon over
      // the room behind it (the e1m1 "third room black lightmaps" corruption). The WGSL vs applies the
      // same .xz,-y handedness flip as the GL shaders, so screen winding — and thus the FRONT cull —
      // matches GL exactly (frontFace defaults to 'ccw' in both APIs).
      primitive: { topology: 'triangle-list', cullMode: 'front' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
    })
    // Alpha variant for a translucent brush entity (entalpha < 1): same shader/layout, but src-alpha
    // blend + depthWrite off (depthCompare still 'less'), matching drawTextureChains's
    // depthMask(false)/enable(BLEND). The fragment's output alpha = xf.params.x (the entity alpha).
    this.worldAlphaPipeline = dev.createRenderPipeline({
      layout: worldLayout,
      vertex: { module: worldModule, entryPoint: 'vs_main', buffers: worldVertexBuffers },
      fragment: {
        module: worldModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format, blend: WATER_BLEND }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'front' },   // matches worldPipeline (see comment there)
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'less' },
    })
    // Fence variant (def.SURF.drawfence): IDENTICAL to worldPipeline — same worldLayout, opaque target
    // (no blend), depthWrite ON / depthCompare 'less' (kept texels write depth) — differing ONLY in the
    // fragment (WORLD_FENCE_WGSL adds the leading `if (diffuse.a < 0.666) { discard; }` before lighting).
    // Non-fence surfaces never touch this pipeline, so they stay byte-identical to worldPipeline.
    const worldFenceModule = dev.createShaderModule({ code: WORLD_FENCE_WGSL })
    this.worldFencePipeline = dev.createRenderPipeline({
      layout: worldLayout,
      vertex: { module: worldFenceModule, entryPoint: 'vs_main', buffers: worldVertexBuffers },
      fragment: {
        module: worldFenceModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format }],   // opaque-with-holes: no blend
      },
      primitive: { topology: 'triangle-list', cullMode: 'front' },   // matches worldPipeline (see comment there)
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
    })

    // Instanced brush-entity variants (r_gpucullents). Same vertex layout, same group0/1/2, same raster +
    // depth state as worldPipeline/worldFencePipeline — the ONLY difference is group3: a read-only STORAGE
    // array of BrushXform indexed by @builtin(instance_index), so one drawIndexed covers every entity
    // sharing a model (Ironwail R_DrawBrushModels_Real's instanced indirect draws). The fragment re-reads
    // the record through a flat u32 varying for the output alpha, so the storage buffer is visible to both
    // stages. The non-instanced world/entity pipelines above keep the uniform layout untouched, which is
    // what makes the r_gpucullents 0 fallback byte-identical.
    this.brushInstLayout = dev.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'read-only-storage' },
      }],
    })
    const worldInstLayout = dev.createPipelineLayout({
      bindGroupLayouts: [this.worldGroup0Layout, this.worldGroup1Layout, this.worldGroup2Layout, this.brushInstLayout],
    })
    const worldInstModule = dev.createShaderModule({ code: WORLD_INST_WGSL })
    this.worldInstPipeline = dev.createRenderPipeline({
      layout: worldInstLayout,
      vertex: { module: worldInstModule, entryPoint: 'vs_main', buffers: worldVertexBuffers },
      fragment: { module: worldInstModule, entryPoint: 'fs_main', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'front' },   // matches worldPipeline (see comment there)
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
    })
    const worldInstFenceModule = dev.createShaderModule({ code: WORLD_INST_FENCE_WGSL })
    this.worldInstFencePipeline = dev.createRenderPipeline({
      layout: worldInstLayout,
      vertex: { module: worldInstFenceModule, entryPoint: 'vs_main', buffers: worldVertexBuffers },
      fragment: { module: worldInstFenceModule, entryPoint: 'fs_main', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'front' },   // matches worldPipeline (see comment there)
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
    })
    // Per-frame instance records, uploaded once in flushBrushBatches (tight 80B stride, no padding).
    this.brushInstBuf = dev.createBuffer({
      size: MAX_BRUSH_ENTS * BRUSH_STRUCT_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    this.brushInstBind = dev.createBindGroup({
      layout: this.brushInstLayout,
      entries: [{ binding: 0, resource: { buffer: this.brushInstBuf } }],
    })

    // Lit water: same shader groups as the world — globals / diffuse / lightmap / transform (group3).
    // The water alpha rides in the transform group's params.x (packed per water run), so this is 4 bind
    // groups. Translucent: blend on, no depth write (depthCompare still 'less' so nearer solids occlude
    // it), matching drawTextureChains_litwater.
    const litwaterModule = dev.createShaderModule({ code: LITWATER_WGSL })
    this.litwaterPipeline = dev.createRenderPipeline({
      layout: dev.createPipelineLayout({
        bindGroupLayouts: [this.worldGroup0Layout, this.worldGroup1Layout, this.worldGroup2Layout, this.brushXformLayout],
      }),
      vertex: { module: litwaterModule, entryPoint: 'vs_main', buffers: worldVertexBuffers },
      fragment: {
        module: litwaterModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format, blend: WATER_BLEND }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'front' },   // matches worldPipeline (see comment there)
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'less' },
    })
    // Opaque lit water (alpha >= 1): identical, but no blend + depth writes ON (QSS-M parity).
    this.litwaterOpaquePipeline = dev.createRenderPipeline({
      layout: dev.createPipelineLayout({
        bindGroupLayouts: [this.worldGroup0Layout, this.worldGroup1Layout, this.worldGroup2Layout, this.brushXformLayout],
      }),
      vertex: { module: litwaterModule, entryPoint: 'vs_main', buffers: worldVertexBuffers },
      fragment: {
        module: litwaterModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'front' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
    })

    // Unlit turbulent: globals (b0) + diffuse (g1) + transform (g2, params.x = water alpha) = 3 bind
    // groups. Only pos+texcoord consumed.
    const turbModule = dev.createShaderModule({ code: TURB_WGSL })
    this.turbPipeline = dev.createRenderPipeline({
      layout: dev.createPipelineLayout({
        bindGroupLayouts: [this.worldGroup0Layout, this.worldGroup1Layout, this.brushXformLayout],
      }),
      vertex: {
        module: turbModule,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: WORLD_VERTEX_STRIDE,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },    // pos      (4*0)
            { shaderLocation: 1, offset: 12, format: 'float32x2' },   // texcoord (4*3)
          ],
        }],
      },
      fragment: {
        module: turbModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format, blend: WATER_BLEND }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'front' },   // matches worldPipeline (see comment there)
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'less' },
    })
    // Opaque turbulent (alpha >= 1): no blend + depth writes ON (QSS-M parity — see litwaterOpaquePipeline).
    this.turbOpaquePipeline = dev.createRenderPipeline({
      layout: dev.createPipelineLayout({
        bindGroupLayouts: [this.worldGroup0Layout, this.worldGroup1Layout, this.brushXformLayout],
      }),
      vertex: {
        module: turbModule,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: WORLD_VERTEX_STRIDE,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 12, format: 'float32x2' },
          ],
        }],
      },
      fragment: {
        module: turbModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'front' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
    })
    // group0 binding0: frame globals (perspective mat4 + view basis + params[overbright,gamma,fogDensity]
    // + fogColor vec4) = 160B.
    this.globalsBuf = dev.createBuffer({
      size: 160,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    // group0 binding1: uLightStyles packed as 17 vec4s (272B).
    this.lightStylesBuf = dev.createBuffer({
      size: 272,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    // group0 binding2: dlights (count vec4 + posRadius[32] + color[32]) = 1040B.
    this.dlightsBuf = dev.createBuffer({
      size: 1040,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.globalsBind = dev.createBindGroup({
      layout: this.worldGroup0Layout,
      entries: [
        { binding: 0, resource: { buffer: this.globalsBuf } },
        { binding: 1, resource: { buffer: this.lightStylesBuf } },
        { binding: 2, resource: { buffer: this.dlightsBuf } },
      ],
    })
    // Skyroom-camera globals: its own 160B buffer, but sharing the (camera-independent) lightstyles +
    // dlights buffers. Bound only during the skyroom pass; activeGlobalsBind starts on the main set.
    this.skyroomGlobalsBuf = dev.createBuffer({
      size: 160,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.skyroomGlobalsBind = dev.createBindGroup({
      layout: this.worldGroup0Layout,
      entries: [
        { binding: 0, resource: { buffer: this.skyroomGlobalsBuf } },
        { binding: 1, resource: { buffer: this.lightStylesBuf } },
        { binding: 2, resource: { buffer: this.dlightsBuf } },
      ],
    })
    this.activeGlobalsBind = this.globalsBind
    this.worldSampler = dev.createSampler({
      magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'repeat', addressModeV: 'repeat',
    })
    // Lightmap slots: LINEAR + REPEAT, matching the GL slot textures (loadLightmapTextureSlot sets
    // LINEAR filtering and leaves the default REPEAT wrap; page-space LM coords stay in-range anyway).
    this.lmSampler = dev.createSampler({
      magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'repeat', addressModeV: 'repeat',
    })
    // 1x1 black fallback for a diffuse's missing fullbright split (mirrors tx.state.black_texture).
    this.blackLmTex = dev.createTexture({
      size: { width: 1, height: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    dev.queue.writeTexture(
      { texture: this.blackLmTex },
      new Uint8Array([0, 0, 0, 255]),
      { bytesPerRow: 4, rowsPerImage: 1 },
      { width: 1, height: 1 },
    )
    this.blackLmView = this.blackLmTex.createView()

    // ---- classic sky: depth-prime (SkyChain) + scrolling dome (Sky) pipelines ----
    // Prime: world-VBO position-only vertex layout (stride 44, pos at offset 0), depth-only (color
    // target writeMask 0), depthWrite on / depthCompare 'less'.
    const skyChainModule = dev.createShaderModule({ code: SKYCHAIN_WGSL })
    this.skyChainPipeline = dev.createRenderPipeline({
      layout: dev.createPipelineLayout({ bindGroupLayouts: [this.worldGroup0Layout] }),
      vertex: {
        module: skyChainModule,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: WORLD_VERTEX_STRIDE,
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
        }],
      },
      fragment: {
        module: skyChainModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format, writeMask: 0 }],   // depth only — discard color
      },
      primitive: { topology: 'triangle-list', cullMode: 'front' },   // matches worldPipeline (see comment there)
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
    })

    // Dome group layouts: g1 = { uScale (b0), uTime+gamma (b1) }, g2 = { sampler, tSolid, tAlpha }.
    this.skyUniformLayout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: VF, buffer: { type: 'uniform' } },
        { binding: 1, visibility: VF, buffer: { type: 'uniform' } },
      ],
    })
    this.skyTexLayout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    })
    const skyModule = dev.createShaderModule({ code: SKY_WGSL })
    this.skyDomePipeline = dev.createRenderPipeline({
      layout: dev.createPipelineLayout({
        bindGroupLayouts: [this.worldGroup0Layout, this.skyUniformLayout, this.skyTexLayout],
      }),
      vertex: {
        module: skyModule,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: 12,   // dome verts: vec3 position only
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
        }],
      },
      fragment: {
        module: skyModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format }],   // opaque (GL dome writes alpha 1, no blend)
      },
      // GL disables CULL_FACE for the dome; depthFunc(GREATER) + depthMask(false).
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'greater' },
    })

    // Shared per-frame time/gamma uniform, and the 8 static per-octant uScale uniforms + bind groups.
    this.skyTimeGammaBuf = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    for (let k = 0; k < 8; k++) {
      const buf = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
      const o = WebGPURenderer.SKY_OCTANTS[k]
      const s = this.skyScaleScratch
      s[0] = o[0]; s[1] = o[1]; s[2] = o[2]; s[3] = 0
      dev.queue.writeBuffer(buf, 0, s.buffer, 0, 16)
      this.skyOctantScaleBuf[k] = buf
      this.skyOctantBind[k] = dev.createBindGroup({
        layout: this.skyUniformLayout,
        entries: [
          { binding: 0, resource: { buffer: buf } },
          { binding: 1, resource: { buffer: this.skyTimeGammaBuf } },
        ],
      })
    }

    // ---- cubemap skybox pipeline (SkyCube) ----
    // group0 = the shared world globals (worldGroup0Layout; only Globals binding0 is read). group1 =
    // { sampler(0), cube texture(1), uSkyFog uniform(2) }. Draws real-depth sky surfaces: opaque, no
    // blend, depthWrite on / depthCompare 'less' (matches the SkyChain prime — the surfaces sit at their
    // true depth), so nearer world geometry occludes them and the cube fills the sky footprint.
    this.skyCubeTexLayout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: 'cube' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    })
    const skyCubeModule = dev.createShaderModule({ code: SKYCUBE_WGSL })
    this.skyCubePipeline = dev.createRenderPipeline({
      layout: dev.createPipelineLayout({ bindGroupLayouts: [this.worldGroup0Layout, this.skyCubeTexLayout] }),
      vertex: {
        module: skyCubeModule,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: WORLD_VERTEX_STRIDE,
          attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
        }],
      },
      fragment: {
        module: skyCubeModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.format }],   // opaque: no blend
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
    })
    // Linear + CLAMP_TO_EDGE on all axes, matching installCubemap's TEXTURE_CUBE_MAP filter/wrap.
    this.skyCubeSampler = dev.createSampler({
      magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge',
    })
    this.skyCubeFogBuf = dev.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })

    // ---- alias model pipelines (opaque + alpha) ----
    // g1: per-entity uniform with a DYNAMIC offset (one 256B slot per entity). Read in both stages
    // (vertex: angles/origin/lightVec/blend; fragment: ambient/shade/alpha/overbright/fullbright).
    this.aliasEntLayout = dev.createBindGroupLayout({
      entries: [{
        binding: 0, visibility: VF,
        buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: ALIAS_STRUCT_BYTES },
      }],
    })
    // g2: skin sampler + texture.
    this.aliasSkinLayout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    })
    // g2 for the player-colormap variant: the same pair plus the colormap mask.
    this.aliasPlayerSkinLayout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    })
    // Three vertex bindings of the SAME alias VBO at different byte offsets (pose1ofs, pose2ofs, 0),
    // reproducing the WebGL dual-offset attribute binding: pose slots carry pos(0)+normal(12) at
    // stride 24; the texcoord slot carries uv(0) at stride 8.
    const aliasVertexBuffers: GPUVertexBufferLayout[] = [
      {
        arrayStride: 24,
        attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },   // p1
          { shaderLocation: 1, offset: 12, format: 'float32x3' },  // n1
        ],
      },
      {
        arrayStride: 24,
        attributes: [
          { shaderLocation: 2, offset: 0, format: 'float32x3' },   // p2
          { shaderLocation: 3, offset: 12, format: 'float32x3' },  // n2
        ],
      },
      {
        arrayStride: 8,
        attributes: [
          { shaderLocation: 4, offset: 0, format: 'float32x2' },   // texcoord
        ],
      },
    ]
    const aliasLayout = dev.createPipelineLayout({
      bindGroupLayouts: [this.worldGroup0Layout, this.aliasEntLayout, this.aliasSkinLayout],
    })
    const aliasModule = dev.createShaderModule({ code: ALIAS_WGSL })
    // Opaque: depth write on, no blend. cullMode 'none' matches the world pipeline's documented choice
    // (GL culls FRONT with the .xz,-y handedness flip; the exact WebGPU winding match is deferred, and
    // 'none' is depth-identical for closed opaque alias models).
    this.aliasPipelineOpaque = dev.createRenderPipeline({
      layout: aliasLayout,
      vertex: { module: aliasModule, entryPoint: 'vs_main', buffers: aliasVertexBuffers },
      fragment: { module: aliasModule, entryPoint: 'fs_main', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
    })
    // Alpha (entalpha<1): src-alpha blend, depth write OFF (depthCompare still 'less'), matching
    // drawAliasModel's gl.depthMask(false)/enable(BLEND).
    const ALIAS_BLEND: GPUBlendState = {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    }
    this.aliasPipelineAlpha = dev.createRenderPipeline({
      layout: aliasLayout,
      vertex: { module: aliasModule, entryPoint: 'vs_main', buffers: aliasVertexBuffers },
      fragment: { module: aliasModule, entryPoint: 'fs_main', targets: [{ format: this.format, blend: ALIAS_BLEND }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'less' },
    })
    // Player-colormap variants: identical state, the colormap shader and the 3-binding g2 layout.
    const aliasPlayerLayout = dev.createPipelineLayout({
      bindGroupLayouts: [this.worldGroup0Layout, this.aliasEntLayout, this.aliasPlayerSkinLayout],
    })
    const aliasPlayerModule = dev.createShaderModule({ code: ALIAS_PLAYER_WGSL })
    this.aliasPlayerPipelineOpaque = dev.createRenderPipeline({
      layout: aliasPlayerLayout,
      vertex: { module: aliasPlayerModule, entryPoint: 'vs_main', buffers: aliasVertexBuffers },
      fragment: { module: aliasPlayerModule, entryPoint: 'fs_main', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
    })
    this.aliasPlayerPipelineAlpha = dev.createRenderPipeline({
      layout: aliasPlayerLayout,
      vertex: { module: aliasPlayerModule, entryPoint: 'vs_main', buffers: aliasVertexBuffers },
      fragment: { module: aliasPlayerModule, entryPoint: 'fs_main', targets: [{ format: this.format, blend: ALIAS_BLEND }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'less' },
    })
    // Instanced variant (r_instancedmodels): opaque only — a translucent entity always takes the
    // per-entity path, so no alpha pipeline. Same depth/cull state as aliasPipelineOpaque.
    this.aliasInstLayout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
      ],
    })
    const aliasInstModule = dev.createShaderModule({ code: ALIAS_INST_WGSL })
    this.aliasInstPipeline = dev.createRenderPipeline({
      layout: dev.createPipelineLayout({
        bindGroupLayouts: [this.worldGroup0Layout, this.aliasInstLayout, this.aliasSkinLayout],
      }),
      vertex: { module: aliasInstModule, entryPoint: 'vs_main' },
      fragment: { module: aliasInstModule, entryPoint: 'fs_main', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
    })
    this.aliasInstBuf = dev.createBuffer({
      size: MAX_ALIAS_ENTS * ALIAS_INST_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    // Per-entity uniform buffer + its dynamic-offset bind group (window = the 128B struct; the dynamic
    // offset selects the slot).
    this.aliasEntBuf = dev.createBuffer({
      size: MAX_ALIAS_ENTS * ALIAS_SLOT_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.aliasEntBind = dev.createBindGroup({
      layout: this.aliasEntLayout,
      entries: [{ binding: 0, resource: { buffer: this.aliasEntBuf, offset: 0, size: ALIAS_STRUCT_BYTES } }],
    })
    // Per-brush-entity transform buffer + its dynamic-offset bind group (window = the 80B struct; the
    // dynamic offset selects the slot). Pack + upload slot 0 = IDENTITY (angles = identity, origin = 0,
    // alpha = 1) ONCE here — it never changes, so the world/turb passes can bind it every frame without
    // a re-upload, and the endFrame per-frame upload only touches slots 1.. (this frame's entities).
    this.brushEntBuf = dev.createBuffer({
      size: MAX_BRUSH_ENTS * BRUSH_SLOT_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.brushEntBind = dev.createBindGroup({
      layout: this.brushXformLayout,
      entries: [{ binding: 0, resource: { buffer: this.brushEntBuf, offset: 0, size: BRUSH_STRUCT_BYTES } }],
    })
    this.packBrushEnt(0, BRUSH_ZERO, BRUSH_ZERO, 1.0)
    dev.queue.writeBuffer(this.brushEntBuf, 0, this.brushEntData.buffer, 0, BRUSH_SLOT_BYTES)
    // Viewmodel group0: its own globals buffer (narrowed perspective, uploaded per frame) paired with
    // the shared lightstyles/dlights buffers so the alias shader's group0 layout is satisfied.
    this.viewmodelGlobalsBuf = dev.createBuffer({
      size: 160,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    this.viewmodelGlobalsBind = dev.createBindGroup({
      layout: this.worldGroup0Layout,
      entries: [
        { binding: 0, resource: { buffer: this.viewmodelGlobalsBuf } },
        { binding: 1, resource: { buffer: this.lightStylesBuf } },
        { binding: 2, resource: { buffer: this.dlightsBuf } },
      ],
    })

    // ---- classic id particle pipeline (PARTICLE_WGSL) ----
    // Two vertex buffers: slot 0 = the static unit-corner quad (stepMode 'vertex'), slot 1 = the
    // per-instance origin+color stream (stepMode 'instance', 16B). draw(4, count) as a triangle-strip,
    // matching WebGL's TRIANGLE_STRIP corner order. Standard alpha blend; depth 'less', write off.
    const PARTICLE_BLEND: GPUBlendState = {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    }
    const particleModule = dev.createShaderModule({ code: PARTICLE_WGSL })
    this.particlePipeline = dev.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: particleModule,
        entryPoint: 'vs_main',
        buffers: [
          { arrayStride: 8, stepMode: 'vertex', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
          {
            arrayStride: 16, stepMode: 'instance',
            attributes: [
              { shaderLocation: 1, offset: 0, format: 'float32x3' },    // origin
              { shaderLocation: 2, offset: 12, format: 'unorm8x4' },    // color
            ],
          },
        ],
      },
      fragment: { module: particleModule, entryPoint: 'fs_main', targets: [{ format: this.format, blend: PARTICLE_BLEND }] },
      primitive: { topology: 'triangle-strip' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'less' },
    })
    this.particleGlobalsBuf = dev.createBuffer({ size: 176, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.particleGlobalsBind = dev.createBindGroup({
      layout: this.particlePipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.particleGlobalsBuf } }],
    })
    this.particleCornerBuf = dev.createBuffer({ size: 32, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
    dev.queue.writeBuffer(this.particleCornerBuf, 0, new Float32Array([-1, -1, -1, 1, 1, -1, 1, 1]).buffer, 0, 32)

    // ---- flashblend dlight pipeline (DLIGHT_WGSL) ----
    // Additive glow (src-alpha, one) modulated by the fan's per-vertex alpha; depth-tested, no depth write
    // (matches the classic dlight glow). Fan (18 verts, TRIANGLE_FAN in WebGL) → triangle-list here.
    const DLIGHT_BLEND: GPUBlendState = {
      color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
      alpha: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
    }
    const dlightModule = dev.createShaderModule({ code: DLIGHT_WGSL })
    this.dlightPipeline = dev.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: dlightModule,
        entryPoint: 'vs_main',
        buffers: [
          { arrayStride: 12, stepMode: 'vertex', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
          {
            arrayStride: 16, stepMode: 'instance',
            attributes: [
              { shaderLocation: 1, offset: 0, format: 'float32x3' },   // light origin
              { shaderLocation: 2, offset: 12, format: 'float32' },    // radius
            ],
          },
        ],
      },
      fragment: { module: dlightModule, entryPoint: 'fs_main', targets: [{ format: this.format, blend: DLIGHT_BLEND }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'less' },
    })
    this.dlightGlobalsBuf = dev.createBuffer({ size: 144, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.dlightGlobalsBind = dev.createBindGroup({
      layout: this.dlightPipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.dlightGlobalsBuf } }],
    })
    // Expand the 18-vert fan (dlightvecs) into a 48-vert triangle-list: for i=1..16, (v0, vi, vi+1).
    const fan = [
      0, -1, 0,  0, 0, 1,  -0.382683, 0, 0.92388,  -0.707107, 0, 0.707107,  -0.92388, 0, 0.382683,
      -1, 0, 0,  -0.92388, 0, -0.382683,  -0.707107, 0, -0.707107,  -0.382683, 0, -0.92388,  0, 0, -1,
      0.382683, 0, -0.92388,  0.707107, 0, -0.707107,  0.92388, 0, -0.382683,  1, 0, 0,  0.92388, 0, 0.382683,
      0.707107, 0, 0.707107,  0.382683, 0, 0.92388,  0, 0, 1,
    ]
    const list = new Float32Array(48 * 3)
    let li = 0
    for (let i = 1; i <= 16; i++) {
      list[li++] = fan[0]; list[li++] = fan[1]; list[li++] = fan[2]
      list[li++] = fan[i * 3]; list[li++] = fan[i * 3 + 1]; list[li++] = fan[i * 3 + 2]
      list[li++] = fan[(i + 1) * 3]; list[li++] = fan[(i + 1) * 3 + 1]; list[li++] = fan[(i + 1) * 3 + 2]
    }
    this.dlightFanBuf = dev.createBuffer({ size: list.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
    dev.queue.writeBuffer(this.dlightFanBuf, 0, list.buffer, 0, list.byteLength)
    this.dlightInstBuf = dev.createBuffer({ size: 32 * 16, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })

    // ---- scripted effectinfo particle pipelines (PSCRIPT_WGSL, 3 blend variants) ----
    // Explicit shared layouts so the globals (g0) + atlas (g1) bind groups are reusable across the three
    // blend-mode pipelines (an 'auto' layout is per-pipeline). g0 = one uniform (read in both stages).
    this.pscriptGlobalsLayout = dev.createBindGroupLayout({
      entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }],
    })
    this.pscriptAtlasLayout = dev.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      ],
    })
    const pscriptLayout = dev.createPipelineLayout({ bindGroupLayouts: [this.pscriptGlobalsLayout, this.pscriptAtlasLayout] })
    const pscriptModule = dev.createShaderModule({ code: PSCRIPT_WGSL })
    const pscriptVertexBuffers: GPUVertexBufferLayout[] = [
      { arrayStride: 8, stepMode: 'vertex', attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
      {
        arrayStride: 56, stepMode: 'instance',
        attributes: [
          { shaderLocation: 1, offset: 0, format: 'float32x3' },    // origin
          { shaderLocation: 2, offset: 12, format: 'float32x3' },   // velocity (stretch / normal)
          { shaderLocation: 3, offset: 24, format: 'float32' },     // size
          { shaderLocation: 4, offset: 28, format: 'float32' },     // rotation
          { shaderLocation: 5, offset: 32, format: 'float32x4' },   // atlas uv (s1,t1,s2,t2)
          { shaderLocation: 6, offset: 48, format: 'float32' },     // orientation
          { shaderLocation: 7, offset: 52, format: 'unorm8x4' },    // color
        ],
      },
    ]
    // Blend per bucket, matching drawBucket's blendFunc: alpha (SRC_ALPHA/ONE_MINUS_SRC_ALPHA),
    // additive (SRC_ALPHA/ONE), invmod (ZERO/ONE_MINUS_SRC_COLOR — WebGPU 'one-minus-src').
    const PSCRIPT_BLENDS: GPUBlendState[] = [
      {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      },
      {
        color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
        alpha: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
      },
      {
        color: { srcFactor: 'zero', dstFactor: 'one-minus-src', operation: 'add' },
        alpha: { srcFactor: 'zero', dstFactor: 'one-minus-src', operation: 'add' },
      },
    ]
    for (let b = 0; b < 3; b++) {
      this.pscriptPipelines[b] = dev.createRenderPipeline({
        layout: pscriptLayout,
        vertex: { module: pscriptModule, entryPoint: 'vs_main', buffers: pscriptVertexBuffers },
        fragment: { module: pscriptModule, entryPoint: 'fs_main', targets: [{ format: this.format, blend: PSCRIPT_BLENDS[b] }] },
        primitive: { topology: 'triangle-strip' },
        depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'less' },
      })
    }
    this.pscriptGlobalsBuf = dev.createBuffer({ size: 176, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
    this.pscriptGlobalsBind = dev.createBindGroup({
      layout: this.pscriptGlobalsLayout,
      entries: [{ binding: 0, resource: { buffer: this.pscriptGlobalsBuf } }],
    })
    this.pscriptSampler = dev.createSampler({
      magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'repeat', addressModeV: 'repeat',
    })
    this.pscriptCornerBuf = dev.createBuffer({ size: 32, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
    dev.queue.writeBuffer(this.pscriptCornerBuf, 0, new Float32Array([-1, -1, -1, 1, 1, -1, 1, 1]).buffer, 0, 32)

    // ---- sprite pipeline (SPRITE_WGSL) ----
    // group0 = worldGroup0Layout (only Globals binding0 is read; the shared globalsBind satisfies it,
    // exactly like the alias pipeline). group1 = aliasSkinLayout ({sampler, texture}) — the sprite frame
    // texture. Vertex layout: world pos (float32x3) + uv (float32x2), stride 20B. Standard alpha blend,
    // depthWrite off / depthCompare 'less' (occluded by nearer world geometry, no self-occlusion),
    // matching drawEntitiesOnList's sprite sub-pass (enable BLEND + depthMask(false)).
    const spriteModule = dev.createShaderModule({ code: SPRITE_WGSL })
    const SPRITE_BLEND: GPUBlendState = {
      color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      alpha: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
    }
    this.spritePipeline = dev.createRenderPipeline({
      layout: dev.createPipelineLayout({ bindGroupLayouts: [this.worldGroup0Layout, this.aliasSkinLayout] }),
      vertex: {
        module: spriteModule,
        entryPoint: 'vs_main',
        buffers: [{
          arrayStride: SPRITE_STRIDE_BYTES,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },   // world pos
            { shaderLocation: 1, offset: 12, format: 'float32x2' },  // uv
          ],
        }],
      },
      fragment: { module: spriteModule, entryPoint: 'fs_main', targets: [{ format: this.format, blend: SPRITE_BLEND }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: false, depthCompare: 'less' },
    })
    this.spriteVBuf = dev.createBuffer({
      size: MAX_SPRITE_ENTS * SPRITE_QUAD_FLOATS * 4,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
  }

  // (Re)create the offscreen color target when the backing size changes, and rebuild its blit bind group.
  // w/h = the 3D target (A) size (canvas / r_scale divisor); nw/nh = the native canvas backing size
  // (B + its depth + the present target). Equal when r_scale is 1.
  private ensureOffscreen(w: number, h: number, nw: number, nh: number): void {
    const dev = this.device
    if (dev == null || this.blitPipeline == null || this.blitSampler == null) return
    w = Math.max(1, w | 0)
    h = Math.max(1, h | 0)
    nw = Math.max(1, nw | 0)
    nh = Math.max(1, nh | 0)
    if (this.offscreen != null && this.offW === w && this.offH === h && this.natW === nw && this.natH === nh) return
    if (this.offscreen != null) this.offscreen.destroy()
    this.offscreen = dev.createTexture({
      size: { width: w, height: h },
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    this.offscreenView = this.offscreen.createView()
    // Second offscreen color target (B): the 2D target on warp/r_scale frames, NATIVE-sized (the HUD
    // stays sharp while A may be r_scale-reduced). Sampled by the present blit (blitBind2).
    if (this.offscreen2 != null) this.offscreen2.destroy()
    this.offscreen2 = dev.createTexture({
      size: { width: nw, height: nh },
      format: this.format,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    })
    this.offscreen2View = this.offscreen2.createView()
    // Depth target for the 3D world pass, sized to match A.
    if (this.depthTex != null) this.depthTex.destroy()
    this.depthTex = dev.createTexture({
      size: { width: w, height: h },
      format: DEPTH_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    })
    this.depthView = this.depthTex.createView()
    // Depth for the B 2D passes (2D pipelines declare a depth state, so those passes must carry a depth
    // attachment matching B's native size; contents ignored — 2D uses depthCompare 'always', write off).
    if (this.depth2Tex != null) this.depth2Tex.destroy()
    this.depth2Tex = dev.createTexture({
      size: { width: nw, height: nh },
      format: DEPTH_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    })
    this.depth2View = this.depth2Tex.createView()
    this.offW = w
    this.offH = h
    this.natW = nw
    this.natH = nh
    this.blitBind = dev.createBindGroup({
      layout: this.blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.blitSampler },
        { binding: 1, resource: this.offscreenView },
      ],
    })
    // Present blit for B (dowarp frames): plain blit sampling offscreen2.
    this.blitBind2 = dev.createBindGroup({
      layout: this.blitPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.blitSampler },
        { binding: 1, resource: this.offscreen2View },
      ],
    })
    // Warp blit bind group: samples offscreen A (only changes on resize, like A itself) + the persistent
    // uTime uniform (its buffer contents are re-uploaded per dowarp frame in begin2D). Built here since
    // both the source view and the uniform buffer are stable between resizes.
    if (this.warpPipeline != null && this.blitSampler != null && this.warpUTimeBuf != null) {
      this.warpBind = dev.createBindGroup({
        layout: this.warpPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.blitSampler },
          { binding: 1, resource: this.offscreenView },
          { binding: 2, resource: { buffer: this.warpUTimeBuf } },
        ],
      })
    }
  }

  // r_scale divisor: integer 1..4 (Ironwail's CLAMP(1, r_scale, maxscale)); cvar may not exist yet at init.
  private scaleDivisor(): number {
    const v = r.cvr.scale != null ? (r.cvr.scale.value | 0) : 1
    return v < 1 ? 1 : (v > 4 ? 4 : v)
  }

  resize(width: number, height: number): void {
    if (this.device == null) return
    const s = this.scaleDivisor()
    this.ensureOffscreen(Math.ceil(width / s), Math.ceil(height / s), width, height)
  }

  // No-op: the WebGPU backend builds its pipelines and render targets in its own init(); it has no
  // equivalent of the WebGL 3D shader programs / warp FBO / dlight VBO that r.init's WebGL block creates.
  initResources(): void {}

  // No-op: WebGPU's underwater warp uses its own offscreen targets (ensureOffscreen), not the WebGL warp FBO.
  resizeWarp(): void {}

  beginFrame(_globals?: FrameGlobals): void {
    const dev = this.device
    if (dev == null || this.context == null) return
    // Lazily match the canvas backing store size (nothing calls resize() yet). r_scale reduces the 3D
    // target (A) by an integer divisor; B (the 2D/present side) stays native. Divisor read once per frame
    // so a mid-frame cvar change can't split the frame across sizes.
    const cw = this.canvas ? (this.canvas.width || 1) : this.natW
    const ch = this.canvas ? (this.canvas.height || 1) : this.natH
    this.scale3D = this.scaleDivisor()
    this.ensureOffscreen(Math.ceil(cw / this.scale3D), Math.ceil(ch / this.scale3D), cw, ch)
    if (this.offscreenView == null) return

    this.batchVerts = 0
    this.texBatchVerts = 0
    this.runN = 0
    this.curKind = -1
    this.curTex = null
    this.frameWarp = false
    this.cullReady = false
    // Per-frame 3D streaming cursors reset ONCE per frame here (moved out of beginScene) so a two-camera
    // frame (skyroom renders the scene twice) appends the second camera's world indices + entity uniform
    // slots after the first instead of overwriting them. Single-scene frames reset once either way.
    // Honour a growth request from last frame's gather. Done here, before anything is recorded against
    // the buffer. The old GPU buffer is dropped WITHOUT destroy() — a previous frame's submit may still
    // reference it, and destroying one in flight is exactly the "used in submit while destroyed" error.
    if (this.worldIdxWant > this.worldIndices.length) {
      this.worldIndices = new Uint32Array(this.worldIdxWant)
      this.worldIndexBuf = null
    }
    this.worldIdxWant = 0
    this.worldIdxCursor = 0
    this.aliasEntCursor = 0
    this.aliasPackCursor = 0
    this.aliasInstCursor = 0
    this.entryCount = 0
    this.brushEntCursor = 1
    this.brushEntryCount = 0
    this.brushInstCursor = 0
    this.encoder = dev.createCommandEncoder()
    this.pass = null
    // r_gpucull: defer opening the render pass so ensurePass() can encode the compute cull into this
    // encoder BEFORE the render pass begins (the first 3D draw, drawSky, triggers it). r_gpucull=0 opens
    // the pass here exactly as before, so that path stays byte-identical.
    this.deferPass = r.cvr.gpucull != null && r.cvr.gpucull.value !== 0
    if (!this.deferPass) this.openOffscreenPass()
  }

  // The main frame clear (true,true) is handled by the offscreen pass's loadOp → no-op here. The skyroom
  // depth-reset (false,true, from r.renderView between the skyroom and main passes) restarts the pass
  // keeping color but clearing depth.
  clearFrame(color: boolean, depth: boolean): void {
    if (depth && !color) this.restartPassDepthClear()
  }

  // No-op: endFrame already submitted the frame and blitted it into the swapchain, so the canvas holds
  // finished pixels for scr.updateScreen's synchronous toDataURL screenshot read (no gl.finish analogue).
  finishFrame(): void {}

  // World visibility comes from the compute cull this frame (r_gpucull on + per-map cull data built) —
  // renderScene skips the CPU markSurfaces/markWorldFrustum walk (keeps efrags) and the sky gather uses
  // cull.skyFaces. Checked AFTER beginScene (which builds this.cull on map change), so it's accurate.
  gpuCullActive(): boolean {
    return this.cull != null && r.cvr.gpucull != null && r.cvr.gpucull.value !== 0
  }

  endFrame(): void {
    const dev = this.device
    if (dev == null || this.context == null || this.encoder == null) return

    // Upload the per-entity alias uniform buffer ONCE per frame (used prefix packed by this frame's
    // drawAliasModel calls). This must live here, NOT in endScene — endScene is only called underwater
    // (if dowarp), while the alias dynamic-offset draws recorded during renderScene need their uniforms
    // every frame. queue.writeBuffer is ordered before the submit below, so those draws read correct data.
    if (this.aliasEntBuf != null && this.aliasEntCursor > 0)
      dev.queue.writeBuffer(this.aliasEntBuf, 0, this.aliasEntData.buffer, 0, this.aliasEntCursor * ALIAS_SLOT_BYTES)
    // The instanced path's storage buffer uploads in flushAliasBatches instead (its records must be
    // sorted before they can be uploaded, and writeBuffer is queue-ordered before this frame's submit).

    // Upload this frame's brush-entity transform slots (1..cursor). Slot 0 (identity) was uploaded once
    // at init and is never rewritten, so start at slot 1. Same must-be-here-not-endScene reasoning as
    // the alias buffer above (the brush draws recorded in renderScene need their transforms every frame).
    if (this.brushEntBuf != null && this.brushEntCursor > 1)
      dev.queue.writeBuffer(this.brushEntBuf, BRUSH_SLOT_BYTES, this.brushEntData.buffer,
        BRUSH_SLOT_BYTES, (this.brushEntCursor - 1) * BRUSH_SLOT_BYTES)

    // Flush the ordered 2D runs into the offscreen pass, preserving submission order so later draws
    // land on top. Upload both vertex batches once, then replay each run with its pipeline/bindings.
    const pass = this.pass
    if (pass != null && this.quadPipeline != null && this.texPipeline != null
        && this.quadVBuf != null && this.texVBuf != null && this.orthoBind != null && this.orthoBindTex != null) {
      if (this.batchVerts > 0)
        dev.queue.writeBuffer(this.quadVBuf, 0, this.batch.buffer, 0, this.batchVerts * FLOATS_PER_VERT * 4)
      if (this.texBatchVerts > 0)
        dev.queue.writeBuffer(this.texVBuf, 0, this.texBatch.buffer, 0, this.texBatchVerts * TEX_FLOATS_PER_VERT * 4)
      for (let i = 0; i < this.runN; i++) {
        const cnt = this.runCount[i]
        if (cnt === 0) continue
        if (this.runKind[i] === RUN_COLORED) {
          pass.setPipeline(this.quadPipeline)
          pass.setBindGroup(0, this.orthoBind)
          pass.setVertexBuffer(0, this.quadVBuf)
          pass.draw(cnt, 1, this.runFirst[i], 0)
        } else {
          const entry = this.ensureTexture(this.runTex[i])
          if (entry == null) continue
          pass.setPipeline(this.texPipeline)
          pass.setBindGroup(0, this.orthoBindTex)
          pass.setBindGroup(1, entry.bind)
          pass.setVertexBuffer(0, this.texVBuf)
          pass.draw(cnt, 1, this.runFirst[i], 0)
        }
      }
    }
    if (pass != null) pass.end()

    // Acquire the swapchain ONLY here, then blit the current 2D target into it and submit — all in one
    // synchronous block so the swapchain texture is never held across a task boundary. The 2D target is
    // B (offscreen2) on a dowarp frame (warp done in begin2D) and A (offscreen) otherwise.
    const presentBind = this.frameWarp ? this.blitBind2 : this.blitBind
    if (this.blitPipeline != null && presentBind != null) {
      const swapView = this.context.getCurrentTexture().createView()
      const blit = this.encoder.beginRenderPass({
        colorAttachments: [{
          view: swapView,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: CLEAR,
        }],
      })
      blit.setPipeline(this.blitPipeline)
      blit.setBindGroup(0, presentBind)
      blit.draw(3, 1, 0, 0)
      blit.end()
    }

    dev.queue.submit([this.encoder.finish()])
    this.encoder = null
    this.pass = null
  }

  // ---- 3D scene ----
  // Upload the frame globals (view basis + projection) into the world UBO. The offscreen pass is
  // already open (from beginFrame); the world draw records into it in drawWorldSurfaces('solid').
  beginScene(scene: SceneSetup, globals?: FrameGlobals): void {
    const dev = this.device
    if (dev == null || this.globalsBuf == null || this.lightStylesBuf == null
        || this.dlightsBuf == null || globals == null) return

    // Map change (world-VBO identity changed): clear all per-map GPU caches and drop the world buffers
    // HERE, at frame start, before ANY 3D draw records. drawSky/drawViewModel/entities run before
    // drawWorldSurfaces, so doing this mid-frame (its old home in ensureWorldBuffers) destroyed alias/
    // sky/texture caches those earlier draws had already recorded → "buffer used in submit while
    // destroyed". ensureWorldBuffers now only lazily (re)creates the buffers.
    const mapVbo = r.state.model_vbo_data
    if (mapVbo != null && this.worldVBOData !== mapVbo) {
      this.clearWorldCaches()
      if (this.worldVBuf != null) { this.worldVBuf.destroy(); this.worldVBuf = null }
      if (this.worldIndexBuf != null) { this.worldIndexBuf.destroy(); this.worldIndexBuf = null }
      if (this.lmLayerBuf != null) { this.lmLayerBuf.destroy(); this.lmLayerBuf = null }
      this.worldVBOData = mapVbo
      // (Re)stage the static GPU-cull buffers for the new map. Wrapped so any
      // failure logs and continues — this must never break the working map load or the render path.
      // clearWorldCaches() above already destroyed the previous map's cull data.
      try {
        const worldmodel = cl.clState.worldmodel
        this.cull = worldmodel != null ? buildCullData(dev, worldmodel) : null
      } catch (e) {
        con.print(`WebGPU: GPU-cull data build failed (continuing without it): ${e}\n`)
        this.cull = null
      }
      // (Re)stage the brush-ENTITY draw tables (r_gpucullents). Same discipline as the cull data: any
      // failure logs and leaves every brush entity on the verified per-face chain path.
      try {
        this.brushDraw = buildBrushDrawData(dev, cl.clState.model_precache, cl.clState.worldmodel ?? null)
      } catch (e) {
        con.print(`WebGPU: brush-entity draw data build failed (continuing without it): ${e}\n`)
        this.brushDraw = null
      }
      // (Re)build the compute-cull storage bind group + size the PVS scratch for the new map's
      // cull buffers (unconditional — independent of r_gpucull — so toggling it mid-map works instantly).
      this.buildCullBindings()
    }

    const d = this.globalsData
    const p = globals.perspective
    // perspective mat4 (column-major, floats 0..15). Remap GL's [-1,1] clip-Z to WebGPU's [0,1]:
    // z_row' = 0.5*(z_row + w_row). z-row = indices 2,6,10,14; w-row = 3,7,11,15.
    for (let i = 0; i < 16; i++) d[i] = p[i]
    d[2] = 0.5 * (p[2] + p[3])
    d[6] = 0.5 * (p[6] + p[7])
    d[10] = 0.5 * (p[10] + p[11])
    d[14] = 0.5 * (p[14] + p[15])
    // viewAngles mat3, columns padded to vec4 per WGSL uniform layout (float offsets 16/20/24).
    const va = globals.viewAngles
    d[16] = va[0]; d[17] = va[1]; d[18] = va[2]; d[19] = 0
    d[20] = va[3]; d[21] = va[4]; d[22] = va[5]; d[23] = 0
    d[24] = va[6]; d[25] = va[7]; d[26] = va[8]; d[27] = 0
    // viewOrigin vec3 at float offset 28.
    const vo = globals.viewOrigin
    d[28] = vo[0]; d[29] = vo[1]; d[30] = vo[2]; d[31] = 0
    // params vec4 at float offset 32: x = gl_overbright (from r.cvr), y = gamma (from FrameGlobals),
    // z = fog density / 64 (matches the WebGL Brush upload: uniform1f(uFogDensity, fogDensity/64)).
    // fogColor vec4 at float offset 36 (fog.getColor() = [r,g,b,1], same as uFogColor).
    const fogColor = fog.getColor()
    const fogDensity = fog.getDensity()
    d[32] = r.cvr.overbright.value ? 1.0 : 0.0
    d[33] = globals.gamma
    d[34] = fogDensity / 64.0
    // params.w = uTime: the turbulent-warp phase, host.realtime % 2π — the exact source the WebGL
    // Turbulent/lit-water passes push to uTime. The solid WORLD_WGSL never reads params.w (its shader
    // is untouched), so the solid pass stays byte-identical; only the water shaders consume it.
    d[35] = host.state.realtime % (Math.PI * 2.0)
    d[36] = fogColor[0]; d[37] = fogColor[1]; d[38] = fogColor[2]; d[39] = fogColor[3]
    // Route the view globals to the right camera's buffer. skyroom_drawing (QSS-M's skyroom pass) uses
    // skyroomGlobalsBuf/Bind; every other frame uses the main globalsBuf/globalsBind. activeGlobalsBind is
    // what the 3D draws bind — a single buffer written twice per frame would keep only the last write, so
    // both passes of a skyroom frame would otherwise read the main camera. The per-frame streaming cursors
    // reset in beginFrame now (not here), so the second scene appends rather than clobbering the first.
    if (sky.state.skyroom_drawing && this.skyroomGlobalsBuf != null && this.skyroomGlobalsBind != null) {
      dev.queue.writeBuffer(this.skyroomGlobalsBuf, 0, d.buffer, 0, 160)
      this.activeGlobalsBind = this.skyroomGlobalsBind
    } else {
      dev.queue.writeBuffer(this.globalsBuf, 0, d.buffer, 0, 160)
      this.activeGlobalsBind = this.globalsBind
    }

    // uLightStyles: lightstylevalue/128 (same as the WebGL Brush upload), slot 64 = 0. Reuses the
    // persistent lightStylesData scratch; uploaded every frame (272B, no allocation) rather than
    // dirty-flagged so the WebGL path's lm.state.lightstyle_uniform_dirty is left untouched.
    const ls = this.lightStylesData
    const lsv = lm.state.lightstylevalue
    for (let j = 0; j < lm.MAX_LIGHTSTYLES; j++) ls[j] = lsv[j] / 128.0
    ls[64] = 0.0
    dev.queue.writeBuffer(this.lightStylesBuf, 0, ls.buffer, 0, 272)

    // Dlights: count.x = numShaderDlights, then the packed posRadius[32] / color[32] arrays exactly as
    // r.gatherDlights built them (same source the WebGL Brush upload reads). Reuses the persistent
    // dlightsData scratch (no per-frame alloc); uploaded every frame (1040B). The whole array is sent
    // regardless of count — the shader loop breaks at numDlights, matching fshBrush.
    const dld = this.dlightsData
    dld[0] = r.state.numShaderDlights
    dld.set(r.state.dlightPosRadius, 4)
    dld.set(r.state.dlightColor, 4 + 32 * 4)
    dev.queue.writeBuffer(this.dlightsBuf, 0, dld.buffer, 0, 1040)

    // Clip the 3D world to the view rect (like WebGL's gl.viewport(vrect)) so it doesn't fill the whole
    // offscreen — otherwise the world (and the underwater warp) bleed into the strip beside the HUD,
    // which polyBlend only tints within the view rect. The offscreen is DPR-scaled (backing pixels)
    // while vrect is logical, so scale by offscreen/logical. WebGPU viewport y is top-down (no GL flip).
    // Always store the 3D viewport (a deferred r_gpucull frame has no pass open yet — ensurePass applies
    // it when the first 3D draw opens the pass). When the pass is already open (r_gpucull=0) set it now,
    // byte-identically to before.
    const sx = this.offW / (vid.state.width || 1)
    const sy = this.offH / (vid.state.height || 1)
    this.vpX = scene.x * sx; this.vpY = scene.y * sy
    this.vpW = scene.width * sx; this.vpH = scene.height * sy
    if (this.pass != null)
      this.pass.setViewport(this.vpX, this.vpY, this.vpW, this.vpH, 0.0, 1.0)
  }

  // Lazily (re)upload the static world VBO + per-frame index buffer, keyed off the retained Float32Array
  // identity. Called by both drawSky (depth prime, first) and drawWorldSurfaces('solid') — idempotent
  // within a frame. Returns false when the world VBO data isn't available yet. A new map (VBO identity
  // changed) invalidates all per-map GPU resources: the diffuse/lightmap/sky caches are keyed by engine
  // handles (texture handles, page slot-array object, sky rgba) that the new map's mod.clearAll
  // rebuilds/REUSES — a stale cache hit would bind the PREVIOUS map's textures, and the old map's
  // GPUTextures would leak. Drop them so this map re-uploads fresh.
  private ensureWorldBuffers(model: Model): boolean {
    const dev = this.device
    if (dev == null) return false
    const vboData = r.state.model_vbo_data
    if (vboData == null) return false
    // Lazy (re)create only — the map-change clear + reset is done in beginScene (frame start) so it can
    // never destroy buffers an earlier draw this frame already recorded.
    if (this.worldVBuf == null) {
      this.worldVBuf = dev.createBuffer({
        size: vboData.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      })
      dev.queue.writeBuffer(this.worldVBuf, 0, vboData.buffer, vboData.byteOffset, vboData.byteLength)
      this.worldVBOData = vboData
    }
    // Second world vertex buffer: the per-vertex lightmap array-layers, same vertex count as the
    // main VBO. Retained parallel to model_vbo_data; destroyed alongside worldVBuf on map change (beginScene).
    if (this.lmLayerBuf == null) {
      const layerData = r.state.model_lmlayer_data
      if (layerData == null) return false
      this.lmLayerBuf = dev.createBuffer({
        size: Math.max(16, layerData.byteLength),
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      })
      dev.queue.writeBuffer(this.lmLayerBuf, 0, layerData.buffer, layerData.byteOffset, layerData.byteLength)
    }
    if (this.worldIndexBuf == null) {
      // Room for one scene's worth of gathered indices — doubled on skyroom maps, where a frame renders
      // the world twice (skyroom + main camera) and both append into this buffer/staging from beginFrame's
      // reset. Sized across EVERY brush model that shares the VBO, not just the worldmodel: r.buildModel-
      // VertexBuffer packs the world AND every external .bsp brush model into one buffer, and brush
      // entities append their own model's indices here too. Sizing off the world alone overflows on a map
      // whose brush entities are external .bsp models (Immortal Lock's portal).
      // Summed ONLY here (buffer creation, once per map) — this is per-draw hot path, and the precache
      // walk is O(thousands) on big maps. Entity-count-driven demand beyond this static bound is
      // handled by the worldIdxWant grow-on-demand in beginFrame.
      let maxIdx = 0
      const precache = cl.clState.model_precache
      for (let mi = 1; mi < precache.length; mi++) {
        const m = precache[mi]
        // '*N' submodels share their parent's surfIndexData — counting them would double-count.
        if (m == null || m.name[0] === '*' || m.type !== mod.TYPE.brush || m.surfIndexData == null) continue
        maxIdx += m.surfIndexData.length
      }
      if (maxIdx === 0) maxIdx = model.surfIndexData.length
      maxIdx *= (sky.state.skyroom_enabled ? 2 : 1)
      if (this.worldIndices.length < maxIdx) this.worldIndices = new Uint32Array(maxIdx)
      // Never shrink below a staging array a previous overflow grew.
      const size = Math.max(maxIdx, this.worldIndices.length)
      this.worldIndexBuf = dev.createBuffer({
        size: Math.max(4, size * 4),
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      })
    }
    return true
  }

  // Decoupled-mode sky gather: appends the fan indices of every PVS-visible, in-frustum sky face into
  // the shared index staging at worldIdxCursor and sets sky.skyVisibleThisFrame per visible face.
  // Returns the appended index count; the caller draws [cursor, cursor+count) and advances the cursor.
  //
  // The PVS test is load-bearing. The dome drawn after this prime uses depthCompare 'greater' with no
  // depth write, so it colors wherever the prime stamped sky depth: a sky face outside the PVS stamps
  // depth the CPU walk never would, and the dome paints the wrong sky layer there (id1 start.bsp's
  // skill-selection window showed clouds instead of its starfield). Reproduces r.markSurfaces' gate.
  private gatherSkyFacesCull(model: Model): number {
    const cull = this.cull
    if (cull == null) return 0
    const sf = cull.skyFaces
    const ff = r.state.frustumFlat
    const vis = r.state.cached_vis
    const oldsky = (r.cvr.oldskyleaf != null && r.cvr.oldskyleaf.value !== 0) ? 1 : 0
    const idxData = model.surfIndexData, idxOfs = model.surfIndexOfs, idxCnt = model.surfIndexCount
    const staging = this.worldIndices
    const start = this.worldIdxCursor
    let n = start
    for (let s = 0; s < sf.count; s++) {
      // PVS + sky-leaf gate first: it rejects far more than the frustum test and costs less.
      if (vis != null) {
        let marked = false
        const ro = sf.leafOfs[s], rc = sf.leafCount[s]
        for (let k = 0; k < rc; k++) {
          const packed = sf.leafRefs[ro + k]
          if ((packed & 1) > oldsky) continue          // sky leaf, r_oldskyleaf 0 — contributes nothing
          const j = (packed >> 1) - 1                  // vis bit j == leaf j+1 (classic PVS off-by-one)
          if (j >= 0 && (vis[j >> 3] & (1 << (j & 7))) !== 0) { marked = true; break }
        }
        if (!marked) continue
      }
      const b = s * 6
      let culled = false
      for (let p = 0; p < 4; p++) {
        const px = ff[p * 4], py = ff[p * 4 + 1], pz = ff[p * 4 + 2], pd = ff[p * 4 + 3]
        const cx = px >= 0 ? sf.bounds[b + 3] : sf.bounds[b]
        const cy = py >= 0 ? sf.bounds[b + 4] : sf.bounds[b + 1]
        const cz = pz >= 0 ? sf.bounds[b + 5] : sf.bounds[b + 2]
        if (px * cx + py * cy + pz * cz < pd) { culled = true; break }
      }
      if (culled) continue
      sky.state.skyVisibleThisFrame = true
      const f = sf.faceNums[s]
      const o = idxOfs[f], c = idxCnt[f]
      for (let e = 0; e < c; e++) staging[n++] = idxData[o + e]
    }
    return n - start
  }

  // Classic scrolling sky dome (id1 default). Runs FIRST in renderScene (before the world), recording
  // into the open 3D pass. Two steps mirror WebGLRenderer.drawSky's classic sub-path exactly:
  //   1. Depth prime (SkyChain): draw the visible sky-flagged world surfaces writing DEPTH ONLY, so the
  //      dome (drawn far away with depthCompare 'greater') fills only their footprint.
  //   2. Dome (Sky): the two-layer scrolling dome, 8 octant draws each with a fixed uScale.
  // Cubemap skybox (sky.state.texture) and the skyroom depth trick (sky.state.skyroom_drawn) both
  // take the same branches as the WebGL path.
  drawSky(_faces?: FaceVis): void {
    // First 3D draw of the frame: on a deferred (r_gpucull) frame this opens the render pass, encoding the
    // compute cull into the encoder first and applying the 3D viewport. A no-op when the pass is already
    // open (r_gpucull=0). Must run before the no-sky early return so later 3D draws still find the pass.
    this.ensurePass(true)
    if (r.state.drawsky !== true) return
    // Modern cubemap skybox: sample a cube texture over the sky surfaces (own sub-path). Skyroom takes
    // precedence (WebGL drawSkyBox checks skyroom_drawn first): once a skyroom was composited this frame,
    // fall through to the depth-only sky prime below and skip both the cubemap and the dome.
    if (sky.state.texture !== null && !sky.state.skyroom_drawn) { this.drawSkyCube(); return }

    const dev = this.device
    const pass3d = this.pass
    if (dev == null || pass3d == null || this.skyChainPipeline == null || this.skyDomePipeline == null
        || this.globalsBind == null || this.skyTimeGammaBuf == null) return

    const model = cl.clState.worldmodel
    if (model == null) return
    if (!this.ensureWorldBuffers(model)) return
    if (this.worldVBuf == null || this.worldIndexBuf == null) return

    // ---- Step 1: depth prime the sky surfaces (color writeMask 0, depth-only) ----
    const stamp = r.state.frustumFrame
    const visible = model.surfVisibleFrame
    const chainFaces = model.worldChainFaces, chainOfs = model.worldChainOfs, chainCount = model.worldChainCount
    const idxData = model.surfIndexData, idxOfs = model.surfIndexOfs, idxCnt = model.surfIndexCount
    const staging = this.worldIndices

    pass3d.setPipeline(this.skyChainPipeline)
    pass3d.setBindGroup(0, this.activeGlobalsBind)
    pass3d.setVertexBuffer(0, this.worldVBuf)
    pass3d.setIndexBuffer(this.worldIndexBuf, 'uint32')

    const start = this.worldIdxCursor
    let n = start
    if (this.gpuCullActive()) {
      // Decoupled mode: no CPU visibility stamps this frame — gather the in-frustum sky faces from
      // cull.skyFaces (CPU AABB test, dozens of faces) into one depth-prime draw.
      n = start + this.gatherSkyFacesCull(model)
      if (n > start) pass3d.drawIndexed(n - start, 1, start, 0, 0)
    } else {
      for (let i = 0; i < model.textures.length; i++) {
        const t = model.textures[i]
        if (t == null || t.texturechains == null) continue
        const chain = t.texturechains[TexChain.world]
        if (chain == null || !(chain.flags & def.SURF.drawsky)) continue
        const count = chainCount[i]
        if (count === 0) continue
        const ofs = chainOfs[i]
        const runFirst = n
        for (let ci = 0; ci < count; ci++) {
          const f = chainFaces[ofs + ci]
          if (visible[f] !== stamp) continue
          sky.state.skyVisibleThisFrame = true   // keep any skyroom alive next frame (matches GL)
          const s = idxOfs[f], c = idxCnt[f]
          for (let e = 0; e < c; e++) staging[n++] = idxData[s + e]
        }
        if (n > runFirst) pass3d.drawIndexed(n - runFirst, 1, runFirst, 0, 0)
      }
    }
    if (n > start)
      dev.queue.writeBuffer(this.worldIndexBuf, start * 4, staging.buffer, start * 4, (n - start) * 4)
    this.worldIdxCursor = n

    // Skyroom: the depth-primed sky surfaces are all that's needed — the skyroom color composited by the
    // first pass shows through them, and the main world (drawn after) can't overdraw it. No dome/sky color
    // here (matches WebGLRenderer.drawSky's skyroom_drawn branch, which writes sky depth only).
    if (sky.state.skyroom_drawn) return

    // ---- Step 2: draw the scrolling dome where the prime stamped sky-surface depth ----
    const domeVBuf = this.ensureSkyDomeVBO()
    const texBind = this.ensureSkyTextures()
    if (domeVBuf == null || texBind == null) return

    // uTime.xy = the two scroll speeds; gamma from FrameGlobals. Same source as GL's
    // gl.uniform2f(uTime, (realtime*0.125)%1, (realtime*0.03125)%1) + uGamma. Uploaded ONCE per frame
    // (shared by all 8 octant bind groups) so every octant draw reads the same value.
    const tg = this.skyTimeGammaData
    tg[0] = (host.state.realtime * 0.125) % 1.0
    tg[1] = (host.state.realtime * 0.03125) % 1.0
    tg[2] = r.state.frameGlobals.gamma
    tg[3] = 0
    dev.queue.writeBuffer(this.skyTimeGammaBuf, 0, tg.buffer, 0, 16)

    pass3d.setPipeline(this.skyDomePipeline)
    pass3d.setBindGroup(0, this.activeGlobalsBind)
    pass3d.setBindGroup(2, texBind)
    pass3d.setVertexBuffer(0, domeVBuf)
    for (let k = 0; k < 8; k++) {
      const bind = this.skyOctantBind[k]
      if (bind == null) continue
      pass3d.setBindGroup(1, bind)
      pass3d.draw(180, 1, 0, 0)   // GL: gl.drawArrays(TRIANGLES, 0, 180) per octant
    }
  }

  // Cubemap-skybox sub-path (port of drawSkyBox's `sky.state.texture !== null` branch): draw the visible
  // sky-flagged world surfaces with the SkyCube pipeline, sampling the cube texture by each fragment's
  // world-space direction, with skyfog. Reuses the world VBO + index staging exactly like drawSky's depth
  // prime — but writes COLOR at real depth (opaque, depthWrite on / 'less'), so no dome pass follows.
  private drawSkyCube(): void {
    const dev = this.device
    const pass3d = this.pass
    if (dev == null || pass3d == null || this.skyCubePipeline == null || this.globalsBind == null
        || this.skyCubeFogBuf == null) return

    const model = cl.clState.worldmodel
    if (model == null) return
    if (!this.ensureWorldBuffers(model)) return
    if (this.worldVBuf == null || this.worldIndexBuf == null) return

    const texBind = this.ensureSkyCubeTexture()
    if (texBind == null) return

    // uSkyFog = fogDensity <= 0 ? 0 : clamp(skyfog, 0, 1) — the exact WebGL uSkyFog computation. uFogColor
    // rides in the globals UBO (g.fogColor, already uploaded in beginScene = fog.getColor()), so only the
    // scalar skyfog is uploaded here.
    const fd = fog.getDensity()
    const sf = fd <= 0 ? 0 : (sky.state.skyfog < 0 ? 0 : (sky.state.skyfog > 1 ? 1 : sky.state.skyfog))
    const fog4 = this.skyCubeFogData
    fog4[0] = sf; fog4[1] = 0; fog4[2] = 0; fog4[3] = 0
    dev.queue.writeBuffer(this.skyCubeFogBuf, 0, fog4.buffer, 0, 16)

    const stamp = r.state.frustumFrame
    const visible = model.surfVisibleFrame
    const chainOfs = model.worldChainOfs, chainCount = model.worldChainCount
    const chainFaces = model.worldChainFaces
    const idxData = model.surfIndexData, idxOfs = model.surfIndexOfs, idxCnt = model.surfIndexCount
    const staging = this.worldIndices

    pass3d.setPipeline(this.skyCubePipeline)
    pass3d.setBindGroup(0, this.activeGlobalsBind)
    pass3d.setBindGroup(1, texBind)
    pass3d.setVertexBuffer(0, this.worldVBuf)
    pass3d.setIndexBuffer(this.worldIndexBuf, 'uint32')

    const start = this.worldIdxCursor
    let n = start
    if (this.gpuCullActive()) {
      // Decoupled mode: no CPU visibility stamps — cube-draw the in-frustum sky faces from cull.skyFaces.
      n = start + this.gatherSkyFacesCull(model)
      if (n > start) pass3d.drawIndexed(n - start, 1, start, 0, 0)
    } else {
      for (let i = 0; i < model.textures.length; i++) {
        const t = model.textures[i]
        if (t == null || t.texturechains == null) continue
        const chain = t.texturechains[TexChain.world]
        if (chain == null || !(chain.flags & def.SURF.drawsky)) continue
        const count = chainCount[i]
        if (count === 0) continue
        const ofs = chainOfs[i]
        const runFirst = n
        for (let ci = 0; ci < count; ci++) {
          const f = chainFaces[ofs + ci]
          if (visible[f] !== stamp) continue
          sky.state.skyVisibleThisFrame = true
          const s = idxOfs[f], c = idxCnt[f]
          for (let e = 0; e < c; e++) staging[n++] = idxData[s + e]
        }
        if (n > runFirst) pass3d.drawIndexed(n - runFirst, 1, runFirst, 0, 0)
      }
    }
    if (n > start)
      dev.queue.writeBuffer(this.worldIndexBuf, start * 4, staging.buffer, start * 4, (n - start) * 4)
    this.worldIdxCursor = n
  }

  // Lazily build the cube GPUTexture (6 array layers, rgba8unorm) from sky.state.cubeFaces (retained in
  // cube-layer order +X,-X,+Y,-Y,+Z,-Z) + its group1 bind group, keyed off the cubeFaces array identity
  // (a fresh array per skybox load → an identity change re-uploads). Dropped in clearWorldCaches on map
  // change. Returns null until the faces are retained (webgpu-gated in sky.installCubemap).
  private ensureSkyCubeTexture(): GPUBindGroup | null {
    const dev = this.device
    if (dev == null || this.skyCubeTexLayout == null || this.skyCubeSampler == null
        || this.skyCubeFogBuf == null) return null
    const faces = sky.state.cubeFaces
    const size = sky.state.cubeSize
    if (faces == null || faces.length !== 6 || size <= 0) return null
    if (this.skyCubeBind != null && this.skyCubeUploaded === faces) return this.skyCubeBind
    if (this.skyCubeTex != null) this.skyCubeTex.destroy()
    const tex = dev.createTexture({
      size: { width: size, height: size, depthOrArrayLayers: 6 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    for (let i = 0; i < 6; i++) {
      dev.queue.writeTexture(
        { texture: tex, origin: { x: 0, y: 0, z: i } },
        faces[i] as GPUAllowSharedBufferSource,
        { bytesPerRow: size * 4, rowsPerImage: size },
        { width: size, height: size, depthOrArrayLayers: 1 },
      )
    }
    this.skyCubeTex = tex
    this.skyCubeBind = dev.createBindGroup({
      layout: this.skyCubeTexLayout,
      entries: [
        { binding: 0, resource: this.skyCubeSampler },
        { binding: 1, resource: tex.createView({ dimension: 'cube' }) },
        { binding: 2, resource: { buffer: this.skyCubeFogBuf } },
      ],
    })
    this.skyCubeUploaded = faces
    return this.skyCubeBind
  }

  // Lazily upload the dome vertex buffer (180 verts × vec3), keyed off r.state.skyvecs_data identity
  // (built once at engine init in r.makeSky, so this uploads once). Returns null until the data exists.
  private ensureSkyDomeVBO(): GPUBuffer | null {
    const data = r.state.skyvecs_data
    if (data == null) return null
    if (this.skyDomeVBuf != null && this.skyDomeData === data) return this.skyDomeVBuf
    const dev = this.device
    if (dev == null) return null
    if (this.skyDomeVBuf != null) this.skyDomeVBuf.destroy()
    this.skyDomeVBuf = dev.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })
    dev.queue.writeBuffer(this.skyDomeVBuf, 0, data.buffer, data.byteOffset, data.byteLength)
    this.skyDomeData = data
    return this.skyDomeVBuf
  }

  // Lazily upload the two sky textures (solid + alpha) + build the group2 bind group, keyed off the
  // solid layer's rgba Uint8Array identity (r.initSky writes a fresh copy per map onto the stable
  // sky-texture handle, so an identity change re-uploads). Sampler = worldSampler (linear + REPEAT, for
  // the scroll). Returns null until both layers' rgba are retained.
  private ensureSkyTextures(): GPUBindGroup | null {
    const dev = this.device
    if (dev == null || this.skyTexLayout == null || this.worldSampler == null) return null
    const solid = r.state.solidskytexture as unknown as TexSource | null
    const alpha = r.state.alphaskytexture as unknown as TexSource | null
    if (solid == null || alpha == null) return null
    if (solid.rgba == null || alpha.rgba == null || !solid.rgbaW || !solid.rgbaH) return null
    if (this.skyTexBind != null && this.skyUploadedRgba === solid.rgba) return this.skyTexBind
    if (this.skySolidTex != null) this.skySolidTex.destroy()
    if (this.skyAlphaTex != null) this.skyAlphaTex.destroy()
    this.skySolidTex = this.uploadSkyLayer(solid)
    this.skyAlphaTex = this.uploadSkyLayer(alpha)
    this.skyTexBind = dev.createBindGroup({
      layout: this.skyTexLayout,
      entries: [
        { binding: 0, resource: this.worldSampler },
        { binding: 1, resource: this.skySolidTex.createView() },
        { binding: 2, resource: this.skyAlphaTex.createView() },
      ],
    })
    this.skyUploadedRgba = solid.rgba
    return this.skyTexBind
  }

  // Upload one 128x128 sky layer's retained RGBA into a fresh GPUTexture (cold path — cache miss only).
  private uploadSkyLayer(src: TexSource): GPUTexture {
    const dev = this.device as GPUDevice
    const w = src.rgbaW as number, h = src.rgbaH as number
    const gtex = dev.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    dev.queue.writeTexture(
      { texture: gtex },
      src.rgba as GPUAllowSharedBufferSource,
      { bytesPerRow: w * 4, rowsPerImage: h },
      { width: w, height: h },
    )
    return gtex
  }

  // The weapon viewmodel — the same alias draw as any entity, but (1) with a narrowed perspective
  // (fov*0.82, matching drawViewModel's ymax recompute) uploaded to viewmodelGlobalsBuf, and (2) with
  // the depth range squashed to 0..0.3 (WebGL's gl.depthRange(0,0.3)) via the render pass's viewport
  // min/max depth, so the gun never clips into world geometry. Guards mirror the WebGL path exactly.
  drawViewModel(ent: Entity): void {
    const dev = this.device
    const pass3d = this.pass
    if (dev == null || pass3d == null || this.viewmodelGlobalsBuf == null || this.viewmodelGlobalsBind == null) return
    if (sky.state.skyroom_drawing) return   // no viewmodel inside the skyroom
    if (r.cvr.drawviewmodel.value === 0) return
    if (chase.cvr.active.value !== 0) return
    if (r.cvr.drawentities.value === 0) return
    if ((cl.clState.items & def.IT.invisibility) !== 0) return
    if (cl.clState.stats[def.STAT.health] <= 0) return
    if (ent.model == null) return

    // Narrowed perspective: copy the frame globals, override only perspective[0]/[5] (X/Y scale) — the
    // WebGPU Z-remap rows (2,6,10,14) are untouched by these, so overriding after the remap is exact.
    const vd = this.viewmodelGlobalsData
    vd.set(this.globalsData)   // 40 floats already packed (remapped perspective + view basis + params)
    const vrect = r.state.refdef.vrect
    const ymax = 4.0 * Math.tan(scr.cvr.fov.value * 0.82 * Math.PI / 360.0)
    vd[0] = 4.0 / (ymax * vrect.width / vrect.height)
    vd[5] = 4.0 / ymax
    dev.queue.writeBuffer(this.viewmodelGlobalsBuf, 0, vd.buffer, 0, 160)

    // Squash depth to the near 30% around the weapon draw, then restore full range.
    pass3d.setViewport(this.vpX, this.vpY, this.vpW, this.vpH, 0.0, 0.3)
    this.drawAliasModel(ent, this.viewmodelGlobalsBind)
    pass3d.setViewport(this.vpX, this.vpY, this.vpW, this.vpH, 0.0, 1.0)
  }

  // Lazily upload + cache the alias VBO (the retained interleaved cmds data), keyed by the
  // model.cmdsData Float32Array identity. Per-map — cleared in clearWorldCaches. Returns null until the
  // data is retained (webgpu-only) or on device loss.
  private ensureAliasVBO(model: Model): GPUBuffer | null {
    const data = model.cmdsData
    if (data == null) return null
    const cached = this.aliasVBCache.get(data)
    if (cached != null) return cached
    const dev = this.device
    if (dev == null) return null
    // STORAGE as well as VERTEX: the instanced path pulls the same buffer as a flat array<f32>.
    const buf = dev.createBuffer({
      size: data.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    })
    dev.queue.writeBuffer(buf, 0, data.buffer, data.byteOffset, data.byteLength)
    this.aliasVBCache.set(data, buf)
    return buf
  }

  // The instanced path's group1 for one model: its VBO as a storage buffer plus the shared per-frame
  // instance buffer. Keyed by the VBO, so it dies with the aliasVBCache on map change.
  private ensureAliasInstBind(vbo: GPUBuffer): GPUBindGroup | null {
    const cached = this.aliasInstBindCache.get(vbo)
    if (cached != null) return cached
    const dev = this.device
    if (dev == null || this.aliasInstLayout == null || this.aliasInstBuf == null) return null
    const bind = dev.createBindGroup({
      layout: this.aliasInstLayout,
      entries: [
        { binding: 0, resource: { buffer: vbo } },
        { binding: 1, resource: { buffer: this.aliasInstBuf } },
      ],
    })
    this.aliasInstBindCache.set(vbo, bind)
    return bind
  }

  // Lazily upload + cache a skin GPUTexture + its group2 bind group, keyed by the skin's retained
  // texnum object (rgba/rgbaW/rgbaH — from loadTexture with TEXPREF.skin for MDL, where the alpha=0 on
  // palette indices 224-255 IS the fullbright mask fshAlias reads; loadRGBATexture for MD3). Per-map —
  // cleared in clearWorldCaches. Uses the shared world sampler (linear + REPEAT), matching GL's skin
  // upload (LINEAR filter, default REPEAT wrap).
  // Bind group for a colormapped player skin: the base skin plus its retained colormap mask
  // (mod.translatePlayerSkin). Returns null when the skin has no mask, so the caller falls back
  // to the plain alias path rather than drawing untextured.
  private ensureAliasPlayerSkin(src: TexSource | null, mask: Uint8Array | null | undefined): TexEntry | null {
    if (src == null || mask == null) return null
    const cached = this.aliasPlayerSkinCache.get(src)
    if (cached != null) return cached
    const dev = this.device
    if (dev == null || this.aliasPlayerSkinLayout == null || this.worldSampler == null) return null
    const base = this.ensureAliasSkin(src)
    if (base == null) return null
    // The mask is always the resampled 512x256 RGBA that translatePlayerSkin produces.
    const mw = 512, mh = 256
    if (mask.length < mw * mh * 4) return null
    const mtex = dev.createTexture({
      size: { width: mw, height: mh },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    dev.queue.writeTexture(
      { texture: mtex },
      mask as GPUAllowSharedBufferSource,
      { bytesPerRow: mw * 4, rowsPerImage: mh },
      { width: mw, height: mh },
    )
    const entry: TexEntry = {
      tex: mtex,
      bind: dev.createBindGroup({
        layout: this.aliasPlayerSkinLayout,
        entries: [
          { binding: 0, resource: this.worldSampler },
          { binding: 1, resource: base.tex.createView() },
          { binding: 2, resource: mtex.createView() },
        ],
      }),
    }
    this.aliasPlayerSkinCache.set(src, entry)
    return entry
  }

  private ensureAliasSkin(src: TexSource | null): TexEntry | null {
    if (src == null) return null
    const cached = this.aliasSkinCache.get(src)
    if (cached != null) return cached
    const dev = this.device
    if (dev == null || this.aliasSkinLayout == null || this.worldSampler == null) return null
    if (src.rgba == null || !src.rgbaW || !src.rgbaH) return null
    const w = src.rgbaW | 0, h = src.rgbaH | 0
    const gtex = dev.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    dev.queue.writeTexture(
      { texture: gtex },
      src.rgba as GPUAllowSharedBufferSource,
      { bytesPerRow: w * 4, rowsPerImage: h },
      { width: w, height: h },
    )
    const entry: TexEntry = {
      tex: gtex,
      bind: dev.createBindGroup({
        layout: this.aliasSkinLayout,
        entries: [
          { binding: 0, resource: this.worldSampler },
          { binding: 1, resource: gtex.createView() },
        ],
      }),
    }
    this.aliasSkinCache.set(src, entry)
    return entry
  }

  // Lazily upload + cache a sprite-frame GPUTexture + its group1 bind group, keyed by the frame's
  // retained texturenum handle (rgba/rgbaW/rgbaH, retained WebGPU-gated in mod.loadSpriteFrame). Reuses
  // aliasSkinLayout ({sampler, texture}) + the shared world sampler (linear + REPEAT — matches GL's
  // sprite upload: LINEAR filter, default REPEAT wrap). Per-map → cleared in clearWorldCaches.
  private ensureSpriteTexture(src: TexSource | null): TexEntry | null {
    if (src == null) return null
    const cached = this.spriteTexCache.get(src)
    if (cached != null) return cached
    const dev = this.device
    if (dev == null || this.aliasSkinLayout == null || this.worldSampler == null) return null
    if (src.rgba == null || !src.rgbaW || !src.rgbaH) return null
    const w = src.rgbaW | 0, h = src.rgbaH | 0
    const gtex = dev.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    dev.queue.writeTexture(
      { texture: gtex },
      src.rgba as GPUAllowSharedBufferSource,
      { bytesPerRow: w * 4, rowsPerImage: h },
      { width: w, height: h },
    )
    const entry: TexEntry = {
      tex: gtex,
      bind: dev.createBindGroup({
        layout: this.aliasSkinLayout,
        entries: [
          { binding: 0, resource: this.worldSampler },
          { binding: 1, resource: gtex.createView() },
        ],
      }),
    }
    this.spriteTexCache.set(src, entry)
    return entry
  }

  // Resolve e's active sprite frame (group interpolation, exactly as drawSpriteModel) and pack its
  // camera/oriented billboard quad (6 verts: world pos + uv) into spriteVertData at floatBase. Returns
  // the frame texture's bind group, or null (missing frame texture / not-yet-retained rgba). Math is
  // byte-identical to the WebGL drawSpriteModel; only the GPU submission differs.
  private packSprite(e: Entity, floatBase: number): GPUBindGroup | null {
    const model = e.model
    if (model == null) return null
    let num = e.frame
    if (num >= model.numframes || num < 0) {
      con.dPrint('R.DrawSpriteModel: no such frame ' + num + '\n')
      num = 0
    }
    let frame = model.frames[num] as SpriteFrame | SpriteFrameGroup
    if (frame.group === true) {
      const time = cl.clState.time + e.syncbase
      let n = frame.frames.length - 1
      const fullinterval = frame.frames[n].interval
      const targettime = time - Math.floor(time / fullinterval) * fullinterval
      let i = 0
      for (; i < n; ++i) {
        if (frame.frames[i].interval > targettime) break
      }
      frame = frame.frames[i]
    }
    const sf = frame as SpriteFrame
    const entry = this.ensureSpriteTexture(sf.texturenum as unknown as TexSource)
    if (entry == null) return null

    // Billboard basis: r.state.vright/vup for a camera-facing sprite, angleVectors for an oriented one.
    let sr: V3, su: V3
    if (model.oriented === true) {
      vec.angleVectors(e.angles, null, this.spriteRight, this.spriteUp)
      sr = this.spriteRight; su = this.spriteUp
    } else {
      sr = r.state.vright; su = r.state.vup
    }
    const p = e.origin
    // entity .scale grows the sprite quad about its origin (Ironwail/QSS r_sprite.c), same as WebGL.
    const ss = pr.decodeScale(e.scale)
    const x1 = sf.origin[0] * ss, y1 = sf.origin[1] * ss
    const x2 = x1 + sf.width * ss, y2 = y1 + sf.height * ss
    const d = this.spriteVertData
    let o = floatBase
    // Vert order + UVs match GL.streamWrite calls in drawSpriteModel exactly (two triangles).
    // v0 (x1,y1) uv(0,1)
    d[o] = p[0] + x1 * sr[0] + y1 * su[0]; d[o + 1] = p[1] + x1 * sr[1] + y1 * su[1]; d[o + 2] = p[2] + x1 * sr[2] + y1 * su[2]; d[o + 3] = 0.0; d[o + 4] = 1.0; o += 5
    // v1 (x1,y2) uv(0,0)
    d[o] = p[0] + x1 * sr[0] + y2 * su[0]; d[o + 1] = p[1] + x1 * sr[1] + y2 * su[1]; d[o + 2] = p[2] + x1 * sr[2] + y2 * su[2]; d[o + 3] = 0.0; d[o + 4] = 0.0; o += 5
    // v2 (x2,y1) uv(1,1)
    d[o] = p[0] + x2 * sr[0] + y1 * su[0]; d[o + 1] = p[1] + x2 * sr[1] + y1 * su[1]; d[o + 2] = p[2] + x2 * sr[2] + y1 * su[2]; d[o + 3] = 1.0; d[o + 4] = 1.0; o += 5
    // v3 (x2,y1) uv(1,1)
    d[o] = p[0] + x2 * sr[0] + y1 * su[0]; d[o + 1] = p[1] + x2 * sr[1] + y1 * su[1]; d[o + 2] = p[2] + x2 * sr[2] + y1 * su[2]; d[o + 3] = 1.0; d[o + 4] = 1.0; o += 5
    // v4 (x1,y2) uv(0,0)
    d[o] = p[0] + x1 * sr[0] + y2 * su[0]; d[o + 1] = p[1] + x1 * sr[1] + y2 * su[1]; d[o + 2] = p[2] + x1 * sr[2] + y2 * su[2]; d[o + 3] = 0.0; d[o + 4] = 0.0; o += 5
    // v5 (x2,y2) uv(1,0)
    d[o] = p[0] + x2 * sr[0] + y2 * su[0]; d[o + 1] = p[1] + x2 * sr[1] + y2 * su[1]; d[o + 2] = p[2] + x2 * sr[2] + y2 * su[2]; d[o + 3] = 1.0; d[o + 4] = 0.0
    return entry.bind
  }

  // Sprite sub-pass — mirrors the tail of drawEntitiesOnList (opaque pass only): after the alias/brush
  // entities, sprites draw blended with depth-write off. Packs every visedict sprite's billboard quad
  // into the persistent vertex scratch, uploads once, then one draw per sprite (each sprite's 6 verts
  // are consecutive, so firstVertex = packed index * 6). Records into the open 3D pass.
  private drawSprites(): void {
    const dev = this.device
    const pass3d = this.pass
    if (dev == null || pass3d == null || this.spritePipeline == null || this.spriteVBuf == null
        || this.globalsBind == null) return

    let count = 0
    for (let i = 0; i < cl.state.numvisedicts; ++i) {
      const ent = cl.state.visedicts[i]
      if (ent.model == null || ent.model.type !== mod.TYPE.sprite) continue
      if (count >= MAX_SPRITE_ENTS) break
      const bind = this.packSprite(ent, count * SPRITE_QUAD_FLOATS)
      if (bind == null) continue
      this.spriteDrawBinds[count] = bind
      count++
    }
    if (count === 0) return

    dev.queue.writeBuffer(this.spriteVBuf, 0, this.spriteVertData.buffer, 0, count * SPRITE_QUAD_FLOATS * 4)
    pass3d.setPipeline(this.spritePipeline)
    pass3d.setBindGroup(0, this.activeGlobalsBind)
    pass3d.setVertexBuffer(0, this.spriteVBuf)
    for (let s = 0; s < count; s++) {
      pass3d.setBindGroup(1, this.spriteDrawBinds[s] as GPUBindGroup)
      pass3d.draw(SPRITE_VERTS_PER_QUAD, 1, s * SPRITE_VERTS_PER_QUAD, 0)
    }
  }

  // Port of drawAliasModel (WebGLRenderer). CPU cull/lerp/lighting via the r.ts helpers (kept
  // backend-agnostic); the GPU path packs one 256B per-entity uniform slot (dynamic offset) and records
  // the dual-pose draw. group0Bind = globalsBind for world entities, viewmodelGlobalsBind for the gun.
  // Colormapped player models (MP shirt/pants) take the aliasPlayer* pipelines; see ensureAliasPlayerSkin.
  private drawAliasModel(e: Entity, group0Bind: GPUBindGroup): void {
    const dev = this.device
    const pass3d = this.pass
    if (dev == null || pass3d == null || this.aliasPipelineOpaque == null || this.aliasPipelineAlpha == null
        || this.aliasEntBind == null || this.globalsBind == null) return
    const clmodel = e.model
    if (clmodel == null) return
    if (!this.prepAliasEntity(e, clmodel)) return
    const vbuf = this.aliasPrepVBO as GPUBuffer
    const scalefactor = this.aliasPrepScale
    const entalpha = this.aliasPrepAlpha
    const lerpAngles = this.aliasLerpAngles, lerpOrigin = this.aliasLerpOrigin
    const amb = this.aliasAmbient, shade = this.aliasShade, lv = this.aliasLightVec
    const lerp = r.state.aliasLerp

    // --- pack this entity's 256B uniform slot ---
    const slot = this.aliasEntCursor
    if (slot >= MAX_ALIAS_ENTS) return
    this.aliasEntCursor++
    this.packAliasEnt(slot, lerpAngles, scalefactor, lerpOrigin, lv, amb, shade, lerp.blend, entalpha)

    // --- colormap (WebGL drawAliasModel's Player-program condition, verbatim) ---
    // MDL only: the colormap mask is built by translatePlayerSkin for .mdl skins, and the WebGL
    // path likewise never binds a mask on the md3 surface branch.
    const useColormap = e.colormap !== 0 && clmodel.player === true && r.cvr.nocolors.value === 0
      && clmodel.surfaces === undefined && cl.clState.scores[e.colormap - 1] != null
    if (useColormap) this.packAliasPlayerColors(slot, cl.clState.scores[e.colormap - 1].colors)

    // --- record the draw ---
    const pipeline = useColormap
      ? (entalpha < 1 ? this.aliasPlayerPipelineAlpha! : this.aliasPlayerPipelineOpaque!)
      : (entalpha < 1 ? this.aliasPipelineAlpha : this.aliasPipelineOpaque)
    pass3d.setPipeline(pipeline)
    pass3d.setBindGroup(0, group0Bind)
    pass3d.setBindGroup(1, this.aliasEntBind, [slot * ALIAS_SLOT_BYTES])
    // Three bindings of the SAME VBO at pose1ofs / pose2ofs / 0 (byte offsets, all multiples of 4).
    pass3d.setVertexBuffer(0, vbuf, lerp.pose1ofs)
    pass3d.setVertexBuffer(1, vbuf, lerp.pose2ofs)
    pass3d.setVertexBuffer(2, vbuf, 0)

    if (clmodel.surfaces !== undefined) {
      // md3: each surface has its own skin(s) + vertex range in the shared pose VBO.
      for (let s = 0; s < clmodel.surfaces.length; ++s) {
        const sf = clmodel.surfaces[s]
        let ssi = e.skinnum
        if ((ssi < 0) || (ssi >= sf.skins.length)) ssi = 0
        const skinEntry = this.ensureAliasSkin(sf.skins[ssi].texnum as unknown as TexSource)
        if (skinEntry == null) continue
        pass3d.setBindGroup(2, skinEntry.bind)
        pass3d.draw(sf.count, 1, sf.first, 0)
      }
      return
    }
    const resolved = this.resolveAliasSkin(e, clmodel)
    if (resolved == null) return
    const src = resolved.texturenum.texnum as unknown as TexSource
    const skinEntry = (useColormap ? this.ensureAliasPlayerSkin(src, resolved.playerRgba) : null)
      ?? this.ensureAliasSkin(src)
    if (skinEntry == null) return
    pass3d.setBindGroup(2, skinEntry.bind)
    pass3d.draw(clmodel.numtris * 3, 1, 0, 0)
  }

  // Shared per-entity alias work for BOTH alias paths (so their CPU math cannot drift): cull, alpha,
  // VBO, movestep-lerped transform, lighting, shade vector, pose lerp. Outputs land in the alias*
  // scratch + aliasPrep* fields, valid until the next call. False = culled/invisible, do not draw.
  private prepAliasEntity(e: Entity, clmodel: Model): boolean {
    // --- cull (on the un-lerped origin, scaled bounds) ---
    const scalefactor = pr.decodeScale(e.scale)
    const cullRadius = clmodel.boundingradius * scalefactor
    const cullMins = r.state.cullMins, cullMaxs = r.state.cullMaxs
    cullMins[0] = e.origin[0] - cullRadius; cullMins[1] = e.origin[1] - cullRadius; cullMins[2] = e.origin[2] - cullRadius
    cullMaxs[0] = e.origin[0] + cullRadius; cullMaxs[1] = e.origin[1] + cullRadius; cullMaxs[2] = e.origin[2] + cullRadius
    if (r.cullBox(cullMins, cullMaxs) === true) return false

    const entalpha = pr.decodeAlpha(e.alpha)
    if (entalpha === 0) return false

    // VBO must be ready before we record anything.
    const vbuf = this.ensureAliasVBO(clmodel)
    if (vbuf == null) return false
    this.aliasPrepVBO = vbuf
    this.aliasPrepScale = scalefactor
    this.aliasPrepAlpha = entalpha

    // --- movestep-lerped transform (uniforms only; cull stayed on e.origin) ---
    const lerpOrigin = this.aliasLerpOrigin, lerpAngles = this.aliasLerpAngles
    r.setupEntityTransform(e, lerpOrigin, lerpAngles)

    // --- per-entity lighting (exact port of drawAliasModel) ---
    const amb = this.aliasAmbient, shade = this.aliasShade
    const lp = r.lightPoint(e.origin, e.lightcache, e.model != null ? e.model.maxs[2] * 0.5 : 0)
    amb[0] = lp[0]; amb[1] = lp[1]; amb[2] = lp[2]
    let add: number
    if (e === cl.clState.viewent) {
      add = 72 - (amb[0] + amb[1] + amb[2])
      if (add > 0) { amb[0] += add / 3; amb[1] += add / 3; amb[2] += add / 3 }
    }
    for (let i = 0; i < r.state.numActiveDlights; ++i) {
      const dl = cl.state.dlights[r.state.activeDlights[i]]
      const dx = e.origin[0] - dl.origin[0], dy = e.origin[1] - dl.origin[1], dz = e.origin[2] - dl.origin[2]
      const distSq = dx * dx + dy * dy + dz * dz
      if (dl.radius * dl.radius <= distSq) continue
      const a = dl.radius - Math.sqrt(distSq)
      amb[0] += a * dl.color[0]; amb[1] += a * dl.color[1]; amb[2] += a * dl.color[2]
    }
    shade[0] = amb[0]; shade[1] = amb[1]; shade[2] = amb[2]
    amb[0] = amb[0] > 128.0 ? 128.0 : amb[0]
    amb[1] = amb[1] > 128.0 ? 128.0 : amb[1]
    amb[2] = amb[2] > 128.0 ? 128.0 : amb[2]
    shade[0] = amb[0] + shade[0] > 192.0 ? 192.0 - amb[0] : shade[0]
    shade[1] = amb[1] + shade[1] > 192.0 ? 192.0 - amb[1] : shade[1]
    shade[2] = amb[2] + shade[2] > 192.0 ? 192.0 - amb[2] : shade[2]
    if ((e.num >= 1) && (e.num <= cl.clState.maxclients)) {
      add = 24.0 - (amb[0] + amb[1] + amb[2])
      if (add > 0.0) {
        amb[0] += add / 3.0; amb[1] += add / 3.0; amb[2] += add / 3.0
        shade[0] = amb[0]; shade[1] = amb[1]; shade[2] = amb[2]
      }
    }

    // --- shade light direction (angleVectors of the lerped angles, dotted against negX) ---
    const fwd = this.aliasForward, right = this.aliasRight, up = this.aliasUp, lv = this.aliasLightVec
    vec.angleVectors(lerpAngles, fwd, right, up)
    lv[0] = vec.dotProductV3(ALIAS_NEG_X, fwd)
    lv[1] = -vec.dotProductV3(ALIAS_NEG_X, right)
    lv[2] = vec.dotProductV3(ALIAS_NEG_X, up)

    r.state.c_alias_polys += clmodel.numtris
    r.setupAliasFrame(e, clmodel)
    return true
  }

  // The mdl (non-md3) skin for this draw, resolving skin groups by time as drawAliasModel always has.
  // Null = the model has no usable skin at all.
  private resolveAliasSkin(e: Entity, clmodel: Model): Skin | null {
    const time = cl.clState.time + e.syncbase
    let num = e.skinnum
    if ((num >= clmodel.numskins) || (num < 0)) {
      con.dPrint('R.DrawAliasModel: no such skin # ' + num + '\n')
      num = 0
    }
    const baseSkin = clmodel.skins[num]
    if (baseSkin.group !== true) return baseSkin
    const gskins = baseSkin.skins
    if (gskins == null || gskins.length === 0) return null
    const last = gskins.length - 1
    const fullinterval = gskins[last].interval
    const targettime = time - Math.floor(time / fullinterval) * fullinterval
    let gi = 0
    for (; gi < last; ++gi) { if (gskins[gi].interval > targettime) break }
    return gskins[gi]
  }

  // Instanced-path entry for one visedict. Returns false only when the entity is NOT batchable (the
  // caller then takes the per-entity path); true means consumed — recorded or culled. Nothing is drawn
  // here: the entity's record is packed in walk order and an entry appended for flushAliasBatches.
  // Batchable = plain mdl (md3 surfaces have per-surface skins/ranges), opaque, not colormapped.
  private batchAliasModel(e: Entity): boolean {
    const clmodel = e.model
    if (clmodel == null || clmodel.surfaces !== undefined) return false
    if (pr.decodeAlpha(e.alpha) !== 1) return false
    if (e.colormap !== 0 && clmodel.player === true && r.cvr.nocolors.value === 0
      && cl.clState.scores[e.colormap - 1] != null) return false
    if (!this.prepAliasEntity(e, clmodel)) return true
    const resolved = this.resolveAliasSkin(e, clmodel)
    if (resolved == null) return true
    const skinEntry = this.ensureAliasSkin(resolved.texturenum.texnum as unknown as TexSource)
    if (skinEntry == null) return true
    const instBind = this.ensureAliasInstBind(this.aliasPrepVBO as GPUBuffer)
    if (instBind == null) return true

    const slot = this.aliasPackCursor
    const n = this.entryCount
    if (slot >= MAX_ALIAS_ENTS || n >= MAX_ALIAS_ENTS) return true
    this.aliasPackCursor++
    this.packAliasInst(slot)
    this.entrySlot[n] = slot
    this.entryVerts[n] = clmodel.numtris * 3
    this.entryInstBind[n] = instBind
    this.entrySkinBind[n] = skinEntry.bind
    this.entryKey[n] = this.bindId(instBind) * ALIAS_KEY_SCALE + this.bindId(skinEntry.bind)
    this.entryCount = n + 1
    return true
  }

  private bindId(b: GPUBindGroup): number {
    let id = this.bindIds.get(b)
    if (id === undefined) { id = this.bindIdNext++; this.bindIds.set(b, id) }
    return id
  }

  // Draw everything the walk recorded: sort the entries by (model, skin), repack their records into the
  // sorted staging so each pair owns a contiguous instance range, upload that range once, then one
  // instanced draw per pair. All batched entities are opaque + depth-write, so deferring them past the
  // brush/other alias draws they were interleaved with is depth-correct.
  private flushAliasBatches(): void {
    const n = this.entryCount
    if (n === 0) return
    this.entryCount = 0
    const dev = this.device
    const pass3d = this.pass
    if (dev == null || pass3d == null || this.aliasInstPipeline == null || this.aliasInstBuf == null
      || this.globalsBind == null) return
    // A two-camera frame (skyroom) flushes twice; the second flush appends after the first's range.
    const base = this.aliasInstCursor
    if (base + n > MAX_ALIAS_ENTS) return

    // Insertion sort of the index array by key (n = visible batchable entities, typically < 200).
    const order = this.entryOrder, key = this.entryKey
    for (let i = 0; i < n; ++i) order[i] = i
    for (let i = 1; i < n; ++i) {
      const v = order[i], k = key[v]
      let j = i - 1
      for (; j >= 0 && key[order[j]] > k; --j) order[j + 1] = order[j]
      order[j + 1] = v
    }

    // Repack walk-order → sorted. Copied through the u32 views so the packed u32 offset fields survive
    // bit-exact (an f32 element copy would round-trip their bit patterns as floats).
    const src = this.aliasPackU32, dst = this.aliasInstU32
    for (let i = 0; i < n; ++i) {
      const s = this.entrySlot[order[i]] * ALIAS_INST_FLOATS
      const d = (base + i) * ALIAS_INST_FLOATS
      for (let f = 0; f < ALIAS_INST_FLOATS; ++f) dst[d + f] = src[s + f]
    }
    this.aliasInstCursor = base + n
    dev.queue.writeBuffer(this.aliasInstBuf, base * ALIAS_INST_BYTES, this.aliasInstData.buffer,
      base * ALIAS_INST_BYTES, n * ALIAS_INST_BYTES)

    pass3d.setPipeline(this.aliasInstPipeline)
    pass3d.setBindGroup(0, this.globalsBind)
    for (let start = 0; start < n;) {
      const head = order[start], k = key[head]
      let end = start + 1
      while (end < n && key[order[end]] === k) ++end
      pass3d.setBindGroup(1, this.entryInstBind[head] as GPUBindGroup)
      pass3d.setBindGroup(2, this.entrySkinBind[head] as GPUBindGroup)
      pass3d.draw(this.entryVerts[head], end - start, 0, base + start)
      start = end
    }
  }

  // Pack one instance record from the prepAliasEntity scratch into the WALK-ORDER staging. Floats 0..31
  // are byte-identical to packAliasEnt's Ent prefix; floats 32..35 are the u32 VBO offsets (byte offsets
  // >> 2 = f32 indices).
  private packAliasInst(slot: number): void {
    const d = this.aliasPackData
    const f = slot * ALIAS_INST_FLOATS
    const angles = this.aliasLerpAngles, origin = this.aliasLerpOrigin
    const lightVec = this.aliasLightVec, ambient = this.aliasAmbient, shade = this.aliasShade
    const scale = this.aliasPrepScale
    const lerp = r.state.aliasLerp
    const pitch = angles[0] * (Math.PI / -180.0)
    const yaw = angles[1] * (Math.PI / 180.0)
    const roll = angles[2] * (Math.PI / 180.0)
    const sp = Math.sin(pitch), cp = Math.cos(pitch)
    const sy = Math.sin(yaw), cy = Math.cos(yaw)
    const sr = Math.sin(roll), cr = Math.cos(roll)
    d[f + 0] = cy * cp * scale;                     d[f + 1] = sy * cp * scale;                     d[f + 2] = -sp * scale;      d[f + 3] = 0
    d[f + 4] = (-sy * cr + cy * sp * sr) * scale;   d[f + 5] = (cy * cr + sy * sp * sr) * scale;    d[f + 6] = cp * sr * scale;  d[f + 7] = 0
    d[f + 8] = (sy * sr + cy * sp * cr) * scale;    d[f + 9] = (-cy * sr + sy * sp * cr) * scale;   d[f + 10] = cp * cr * scale; d[f + 11] = 0
    d[f + 12] = origin[0]; d[f + 13] = origin[1]; d[f + 14] = origin[2]; d[f + 15] = 0
    d[f + 16] = lightVec[0]; d[f + 17] = lightVec[1]; d[f + 18] = lightVec[2]; d[f + 19] = 0
    d[f + 20] = ambient[0] * 0.0078125; d[f + 21] = ambient[1] * 0.0078125; d[f + 22] = ambient[2] * 0.0078125; d[f + 23] = 0
    d[f + 24] = shade[0] * 0.0078125; d[f + 25] = shade[1] * 0.0078125; d[f + 26] = shade[2] * 0.0078125; d[f + 27] = 0
    d[f + 28] = lerp.blend
    d[f + 29] = this.aliasPrepAlpha
    d[f + 30] = r.cvr.overbright.value ? 1.0 : 0.0
    d[f + 31] = r.cvr.fullbrights.value ? 1.0 : 0.0
    const u = this.aliasPackU32
    u[f + 32] = lerp.pose1ofs >>> 2
    u[f + 33] = lerp.pose2ofs >>> 2
    u[f + 34] = ALIAS_UV_OFS_FLOATS
    u[f + 35] = 0
  }

  // Pack one entity's Ent struct into aliasEntData[slot]. Layout (std140, 128B): mat3 angles as 3
  // padded vec4 columns (rotationMatrix(angles)*scale), origin.xyz, lightVec.xyz, ambient.xyz,
  // shade.xyz (all *0.0078125 = /128 to match uAmbientLight/uShadeLight), params(blend, alpha,
  // overbright, fullbright). Reproduces GL.rotationMatrix + the fshAlias uniform scaling exactly.
  private packAliasEnt(slot: number, angles: V3, scale: number, origin: V3, lightVec: V3,
    ambient: V3, shade: V3, blend: number, alpha: number): void {
    const d = this.aliasEntData
    const f = slot * ALIAS_SLOT_FLOATS
    const pitch = angles[0] * (Math.PI / -180.0)
    const yaw = angles[1] * (Math.PI / 180.0)
    const roll = angles[2] * (Math.PI / 180.0)
    const sp = Math.sin(pitch), cp = Math.cos(pitch)
    const sy = Math.sin(yaw), cy = Math.cos(yaw)
    const sr = Math.sin(roll), cr = Math.cos(roll)
    // Columns of the mat3, each padded to a vec4 (GL.rotationMatrix's row0/row1/row2 = the 3 columns).
    d[f + 0] = cy * cp * scale;                     d[f + 1] = sy * cp * scale;                     d[f + 2] = -sp * scale;      d[f + 3] = 0
    d[f + 4] = (-sy * cr + cy * sp * sr) * scale;   d[f + 5] = (cy * cr + sy * sp * sr) * scale;    d[f + 6] = cp * sr * scale;  d[f + 7] = 0
    d[f + 8] = (sy * sr + cy * sp * cr) * scale;    d[f + 9] = (-cy * sr + sy * sp * cr) * scale;   d[f + 10] = cp * cr * scale; d[f + 11] = 0
    d[f + 12] = origin[0]; d[f + 13] = origin[1]; d[f + 14] = origin[2]; d[f + 15] = 0
    d[f + 16] = lightVec[0]; d[f + 17] = lightVec[1]; d[f + 18] = lightVec[2]; d[f + 19] = 0
    d[f + 20] = ambient[0] * 0.0078125; d[f + 21] = ambient[1] * 0.0078125; d[f + 22] = ambient[2] * 0.0078125; d[f + 23] = 0
    d[f + 24] = shade[0] * 0.0078125; d[f + 25] = shade[1] * 0.0078125; d[f + 26] = shade[2] * 0.0078125; d[f + 27] = 0
    d[f + 28] = blend
    d[f + 29] = alpha
    d[f + 30] = r.cvr.overbright.value ? 1.0 : 0.0
    d[f + 31] = r.cvr.fullbrights.value ? 1.0 : 0.0
    // top/bottom colormap colors — zeroed here, filled by packAliasPlayerColors for player entities.
    d[f + 32] = 0; d[f + 33] = 0; d[f + 34] = 0; d[f + 35] = 0
    d[f + 36] = 0; d[f + 37] = 0; d[f + 38] = 0; d[f + 39] = 0
  }

  // WebGL drawAliasModel's colormap uniforms: palette-index shade rows -> RGB, 0..255.
  private packAliasPlayerColors(slot: number, colors: number): void {
    const d = this.aliasEntData
    const f = slot * ALIAS_SLOT_FLOATS
    let top = (colors & 0xf0) + 4
    let bottom = ((colors & 0xf) << 4) + 4
    if (top <= 127) top += 7
    if (bottom <= 127) bottom += 7
    const t = vid.d_8to24table[top], b = vid.d_8to24table[bottom]
    d[f + 32] = t & 0xff; d[f + 33] = (t >> 8) & 0xff; d[f + 34] = (t >>> 16) & 0xff; d[f + 35] = 0
    d[f + 36] = b & 0xff; d[f + 37] = (b >> 8) & 0xff; d[f + 38] = (b >>> 16) & 0xff; d[f + 39] = 0
  }

  // Solid world surfaces (slice 2: static lightmaps). Only the world chain (pass 'solid', ent null)
  // renders; litwater/turb/entity brush passes stay no-op. Walks the visible faces exactly as the
  // WebGL backend does — per-texture worldChain ranges gated by surfVisibleFrame === frustumFrame —
  // appending each visible face's prebuilt fan indices into a CPU stream. Runs are keyed by
  // (diffuse texture, lightmap page): a new draw is emitted whenever the diffuse changes (texture
  // boundary) OR the per-face lightmap page changes, mirroring batchRender's flush-on-page-change so
  // each surface is lit by its own page's 4 style slots (group2).
  drawWorldSurfaces(model: Model, ent: Entity | null, pass: SurfacePass, _faces?: FaceVis): void {
    // Brush-model ENTITY passes (ent != null): the per-entity chains that r.drawBrushModel built under
    // TexChain.model, transformed by the entity's origin/angles. World chain otherwise.
    if (ent !== null) {
      if (pass === 'litwater') { this.drawBrushEntLitWater(model, ent); return }
      if (pass === 'turb') { this.drawBrushEntTurb(model, ent); return }
      if (pass === 'solid') this.drawBrushEntSolid(model, ent)
      return
    }
    if (pass === 'litwater') { this.drawLitWater(model); return }
    if (pass === 'turb') { this.drawTurb(model); return }
    if (pass !== 'solid') return
    const dev = this.device
    const pass3d = this.pass
    if (dev == null || pass3d == null || this.worldPipeline == null || this.worldFencePipeline == null
        || this.globalsBind == null || this.worldSampler == null || this.brushEntBind == null) return

    // Lazily (re)upload the static world VBO + index buffer (drawSky may have already done this for the
    // depth prime this frame — idempotent by VBO identity).
    if (!this.ensureWorldBuffers(model)) return

    const stamp = r.state.frustumFrame
    const visible = model.surfVisibleFrame
    const chainFaces = model.worldChainFaces, chainOfs = model.worldChainOfs, chainCount = model.worldChainCount
    const idxData = model.surfIndexData, idxOfs = model.surfIndexOfs, idxCnt = model.surfIndexCount
    const staging = this.worldIndices

    // Consolidated lightmaps: all pages live in the 4 style texture_2d_arrays, bound ONCE for the
    // whole pass (group2). The surface's page reaches the shader via the per-vertex layer buffer (VBO slot 1),
    // so there is no per-page sub-run — each texture is ONE drawIndexed.
    const lmBind = this.ensureLightmapArrays()
    if (lmBind == null || this.lmLayerBuf == null) return

    // ---- GPU compute-cull indirect path (behind r_gpucull). The compute cull already PVS/
    // frustum/backface-culled every solid surface, deduped it, and compacted its fan indices into
    // cull.indexBuf while filling cull.indirectBuf's per-slot indexCount (encodeCull, before this pass
    // opened). So SKIP the CPU per-texture index gather: bind the shared groups once, then issue one
    // drawIndexedIndirect per draw slot (one per base texture). Draw ORDER differs from the CPU texture-
    // index walk, but the opaque/fence world is depth-tested + single-sided, so the image is identical.
    // Falls through to the verified CPU path below when the cull didn't run this frame. ----
    if (this.cullReady && this.cull != null && r.cvr.gpucull != null && r.cvr.gpucull.value !== 0) {
      const cull = this.cull
      pass3d.setBindGroup(0, this.activeGlobalsBind)
      pass3d.setBindGroup(2, lmBind)
      pass3d.setBindGroup(3, this.brushEntBind, [0])
      pass3d.setVertexBuffer(0, this.worldVBuf)
      pass3d.setVertexBuffer(1, this.lmLayerBuf)
      pass3d.setIndexBuffer(cull.indexBuf, 'uint32')
      for (let s = 0; s < cull.numSlots; s++) {
        const meta = cull.slots[s]
        if (meta.kind !== CullKind.Solid && meta.kind !== CullKind.Fence) continue   // water slots draw in their passes
        const t = model.textures[meta.textureIndex]
        if (t == null) continue
        const animated = r.textureAnimation(model, t, 0)
        const entry = this.ensureWorldTexture(
          animated.texturenum as unknown as TexSource,
          (animated.fullbright ?? null) as unknown as TexSource | null,
        )
        if (entry == null) continue
        pass3d.setPipeline(meta.isFence ? this.worldFencePipeline : this.worldPipeline)
        pass3d.setBindGroup(1, entry.bind)
        pass3d.drawIndexedIndirect(cull.indirectBuf, s * CULL_INDIRECT_STRIDE)
      }
      return
    }

    // Global pipeline state set once — the diffuse (group1) is set per texture. The pipeline itself is set
    // PER TEXTURE (worldPipeline, or worldFencePipeline for a def.SURF.drawfence chain), mirroring WebGL
    // toggling uUseAlphaTest per texture; both share worldLayout, so the group0/2/3 binds + vertex/index
    // buffers set here persist across the switch. Index data is uploaded once at the end; queue.writeBuffer
    // is ordered before endFrame's submit, so recording draws that reference it here is valid.
    pass3d.setBindGroup(0, this.activeGlobalsBind)
    pass3d.setBindGroup(2, lmBind)
    // Identity transform slot (worldPos = Vert) — the solid world stays byte-identical.
    pass3d.setBindGroup(3, this.brushEntBind, [0])
    pass3d.setVertexBuffer(0, this.worldVBuf)
    pass3d.setVertexBuffer(1, this.lmLayerBuf)
    pass3d.setIndexBuffer(this.worldIndexBuf, 'uint32')

    // Append into the shared index staging from the frame cursor (0 for the solid pass, which runs
    // first). runFirst/firstIndex are absolute positions in the buffer.
    const start = this.worldIdxCursor
    let n = start

    for (let i = 0; i < model.textures.length; i++) {
      const t = model.textures[i]
      if (t == null || t.texturechains == null) continue
      const chain = t.texturechains[TexChain.world]
      if (chain == null || (chain.flags & SOLID_SKIP)) continue
      const count = chainCount[i]
      if (count === 0) continue
      // Resolve + upload the diffuse first; skip the whole texture (indices and draw) if not ready.
      const animated = r.textureAnimation(model, t, 0)
      const entry = this.ensureWorldTexture(
        animated.texturenum as unknown as TexSource,
        (animated.fullbright ?? null) as unknown as TexSource | null,
      )
      if (entry == null) continue
      // Fence chains (grates/grills/chain-link) render through the alpha-test pipeline (index-255 texels
      // discarded); all others through the opaque world pipeline. Per-texture, matching WebGL's per-
      // texture uUseAlphaTest toggle. worldFencePipeline shares worldLayout, so the binds set above hold.
      pass3d.setPipeline((chain.flags & def.SURF.drawfence) ? this.worldFencePipeline : this.worldPipeline)
      pass3d.setBindGroup(1, entry.bind)

      const ofs = chainOfs[i]
      const runFirst = n
      // Gather every visible face's fan indices for this texture into one contiguous run.
      for (let ci = 0; ci < count; ci++) {
        const f = chainFaces[ofs + ci]
        if (visible[f] !== stamp) continue
        const s = idxOfs[f], c = idxCnt[f]
        for (let e = 0; e < c; e++) staging[n++] = idxData[s + e]
      }
      if (n > runFirst) pass3d.drawIndexed(n - runFirst, 1, runFirst, 0, 0)
    }
    if (n > start)
      dev.queue.writeBuffer(this.worldIndexBuf, start * 4, staging.buffer, start * 4, (n - start) * 4)
    this.worldIdxCursor = n
  }

  // GPU compute-cull indirect draw of the water slots (litwater/turb passes behind r_gpucull). The compute
  // already PVS/frustum/backface-culled + compacted every water surface into its slot, so this just issues
  // one drawIndexedIndirect per matching slot. Water alpha is per-content = per-texture = uniform per slot
  // (r.waterAlphaForFlags on the slot's retained content flags), packed into a per-slot transform slot at
  // `alphaGroup`. drawLit/drawTurb pick which kinds this pass draws — a LitWater slot falls back to the turb
  // pass+pipeline when r_litwater is off (drawTurb passes drawLit=!litwaterActive), mirroring the CPU split.
  // lmBind non-null → litwater (also bind the lightmap arrays at group2 + the per-vertex layer VBO slot 1).
  private drawWaterIndirect(model: Model, pipeline: GPURenderPipeline, opaquePipeline: GPURenderPipeline, lmBind: GPUBindGroup | null,
      alphaGroup: number, drawLit: boolean, drawTurb: boolean): void {
    const pass3d = this.pass, cull = this.cull
    if (pass3d == null || cull == null || this.worldVBuf == null || this.brushEntBind == null) return
    let curOpaque = false
    pass3d.setPipeline(pipeline)
    pass3d.setBindGroup(0, this.activeGlobalsBind)
    if (lmBind != null && this.lmLayerBuf != null) {
      pass3d.setBindGroup(2, lmBind)
      pass3d.setVertexBuffer(1, this.lmLayerBuf)
    }
    pass3d.setVertexBuffer(0, this.worldVBuf)
    pass3d.setIndexBuffer(cull.indexBuf, 'uint32')
    for (let s = 0; s < cull.numSlots; s++) {
      const meta = cull.slots[s]
      if (!((meta.kind === CullKind.LitWater && drawLit) || (meta.kind === CullKind.Turb && drawTurb))) continue
      const t = model.textures[meta.textureIndex]
      if (t == null) continue
      const animated = r.textureAnimation(model, t, 0)
      const entry = this.ensureWorldTexture(
        animated.texturenum as unknown as TexSource,
        (animated.fullbright ?? null) as unknown as TexSource | null,
      )
      if (entry == null) continue
      const a = r.waterAlphaForFlags(meta.waterFlags)
      const opq = a >= 1
      if (opq !== curOpaque) { pass3d.setPipeline(opq ? opaquePipeline : pipeline); curOpaque = opq }
      if (!this.bindWaterSlot(alphaGroup, BRUSH_ZERO, BRUSH_ZERO, a)) continue
      pass3d.setBindGroup(1, entry.bind)
      pass3d.drawIndexedIndirect(cull.indirectBuf, s * CULL_INDIRECT_STRIDE)
    }
  }

  // Lit-water world surfaces (drawWorldSurfaces pass 'litwater', world model). The WebGL path routes
  // turb surfaces with real lightmap samples (isLitWaterFlags) through the Brush shader with uWarp=1, so
  // they pick up lightmaps/lightstyles/dlights/fog exactly like the solid world — only the diffuse UV is
  // warped and the surface is alpha-blended (translucent, no depth write). Reuses the solid pass's VBO +
  // per-texture index walk; the consolidated lightmap arrays (group2) + per-vertex layer buffer (VBO slot
  // 1) are bound once, so this groups by (diffuse, water alpha) only — a run flushes on a water-alpha
  // change (the alpha rides in the transform group). Alpha per surface = r.waterAlphaForFlags.
  private drawLitWater(model: Model): void {
    if (!r.cvr.litwater.value || !model.haslitwater) return
    const dev = this.device
    const pass3d = this.pass
    if (dev == null || pass3d == null || this.litwaterPipeline == null || this.globalsBind == null
        || this.worldVBuf == null || this.worldIndexBuf == null || this.brushEntBind == null) return
    const lmBind = this.ensureLightmapArrays()
    if (lmBind == null || this.lmLayerBuf == null) return

    // GPU compute-cull indirect path (r_gpucull): the compute already culled + compacted every LitWater
    // surface into its slot; draw those slots' indirect commands with the litwater pipeline. Falls through
    // to the CPU per-texture gather below when the cull didn't run this frame.
    if (this.cullReady && this.cull != null && r.cvr.gpucull != null && r.cvr.gpucull.value !== 0) {
      this.drawWaterIndirect(model, this.litwaterPipeline, this.litwaterOpaquePipeline!, lmBind, 3, true, false)
      return
    }

    const stamp = r.state.frustumFrame
    const visible = model.surfVisibleFrame
    const flags = model.surfFlags
    const chainFaces = model.worldChainFaces, chainOfs = model.worldChainOfs, chainCount = model.worldChainCount
    const idxData = model.surfIndexData, idxOfs = model.surfIndexOfs, idxCnt = model.surfIndexCount
    const staging = this.worldIndices

    pass3d.setPipeline(this.litwaterPipeline)
    let curOpaque = false   // opacity class of the bound pipeline (alpha>=1 -> opaque variant)
    pass3d.setBindGroup(0, this.activeGlobalsBind)
    pass3d.setBindGroup(2, lmBind)
    pass3d.setVertexBuffer(0, this.worldVBuf)
    pass3d.setVertexBuffer(1, this.lmLayerBuf)
    pass3d.setIndexBuffer(this.worldIndexBuf, 'uint32')

    const start = this.worldIdxCursor
    let n = start

    for (let i = 0; i < model.textures.length; i++) {
      const t = model.textures[i]
      if (t == null || t.texturechains == null) continue
      const chain = t.texturechains[TexChain.world]
      if (chain == null || !(chain.flags & def.SURF.drawtub)) continue
      const count = chainCount[i]
      if (count === 0) continue
      const animated = r.textureAnimation(model, t, 0)
      const entry = this.ensureWorldTexture(
        animated.texturenum as unknown as TexSource,
        (animated.fullbright ?? null) as unknown as TexSource | null,
      )
      if (entry == null) continue

      const ofs = chainOfs[i]
      let runFirst = n
      let bound = false
      let curAlpha = -1
      for (let ci = 0; ci < count; ci++) {
        const f = chainFaces[ofs + ci]
        if (visible[f] !== stamp) continue
        if (!r.isLitWaterFlags(flags[f])) continue    // non-lit turb draws in the turb pass
        const a = r.waterAlphaForFlags(flags[f])
        if (!bound) {
          bound = true; curAlpha = a
          pass3d.setBindGroup(1, entry.bind)
          const opq = a >= 1
          if (opq !== curOpaque) { pass3d.setPipeline(opq ? this.litwaterOpaquePipeline! : this.litwaterPipeline!); curOpaque = opq }
          // Identity transform (world) + params.x = this run's water alpha, bound at the transform group (3).
          this.bindWaterSlot(3, BRUSH_ZERO, BRUSH_ZERO, a)
        } else if (a !== curAlpha) {
          // Water alpha changed: flush the accumulated run, then rebind and start a new one.
          if (n > runFirst) pass3d.drawIndexed(n - runFirst, 1, runFirst, 0, 0)
          runFirst = n
          const opq = a >= 1
          if (opq !== curOpaque) { pass3d.setPipeline(opq ? this.litwaterOpaquePipeline! : this.litwaterPipeline!); curOpaque = opq }
          this.bindWaterSlot(3, BRUSH_ZERO, BRUSH_ZERO, a)
          curAlpha = a
        }
        const s = idxOfs[f], c = idxCnt[f]
        for (let e = 0; e < c; e++) staging[n++] = idxData[s + e]
      }
      if (bound && n > runFirst)
        pass3d.drawIndexed(n - runFirst, 1, runFirst, 0, 0)
    }
    if (n > start)
      dev.queue.writeBuffer(this.worldIndexBuf, start * 4, staging.buffer, start * 4, (n - start) * 4)
    this.worldIdxCursor = n
  }

  // Unlit turbulent world surfaces (drawWorldSurfaces pass 'turb', world model). The classic Turbulent
  // program: warped diffuse + gamma + per-surface alpha, no lightmap/dlight/fog. Draws every visible
  // drawtub face EXCEPT the lit-water ones (which draw in the litwater pass) — matching WebGL's
  // `if (litwaterActive && isLitWaterFlags) continue`. Groups by (diffuse, water alpha) only.
  private drawTurb(model: Model): void {
    const dev = this.device
    const pass3d = this.pass
    if (dev == null || pass3d == null || this.turbPipeline == null || this.globalsBind == null
        || this.worldVBuf == null || this.worldIndexBuf == null || this.brushEntBind == null) return

    const litwaterActive = r.cvr.litwater.value !== 0 && model.haslitwater

    // GPU compute-cull indirect path (r_gpucull): draw the Turb slots (and, when lit water is off, the
    // LitWater slots too — they fall back to the turb pipeline exactly as the CPU path does) via indirect.
    if (this.cullReady && this.cull != null && r.cvr.gpucull != null && r.cvr.gpucull.value !== 0) {
      this.drawWaterIndirect(model, this.turbPipeline, this.turbOpaquePipeline!, null, 2, !litwaterActive, true)
      return
    }

    const stamp = r.state.frustumFrame
    const visible = model.surfVisibleFrame
    const flags = model.surfFlags
    const chainFaces = model.worldChainFaces, chainOfs = model.worldChainOfs, chainCount = model.worldChainCount
    const idxData = model.surfIndexData, idxOfs = model.surfIndexOfs, idxCnt = model.surfIndexCount
    const staging = this.worldIndices

    pass3d.setPipeline(this.turbPipeline)
    let curOpaque = false   // opacity class of the bound pipeline (alpha>=1 -> opaque variant)
    pass3d.setBindGroup(0, this.activeGlobalsBind)
    pass3d.setVertexBuffer(0, this.worldVBuf)
    pass3d.setIndexBuffer(this.worldIndexBuf, 'uint32')

    const start = this.worldIdxCursor
    let n = start

    for (let i = 0; i < model.textures.length; i++) {
      const t = model.textures[i]
      if (t == null || t.texturechains == null) continue
      const chain = t.texturechains[TexChain.world]
      if (chain == null || !(chain.flags & def.SURF.drawtub)) continue
      const count = chainCount[i]
      if (count === 0) continue
      const animated = r.textureAnimation(model, t, 0)
      const entry = this.ensureWorldTexture(
        animated.texturenum as unknown as TexSource,
        (animated.fullbright ?? null) as unknown as TexSource | null,
      )
      if (entry == null) continue

      const ofs = chainOfs[i]
      let runFirst = n
      let bound = false
      let curAlpha = -1
      for (let ci = 0; ci < count; ci++) {
        const f = chainFaces[ofs + ci]
        if (visible[f] !== stamp) continue
        if (litwaterActive && r.isLitWaterFlags(flags[f])) continue   // lit water draws in the litwater pass
        const a = r.waterAlphaForFlags(flags[f])
        if (!bound) {
          bound = true; curAlpha = a
          pass3d.setBindGroup(1, entry.bind)
          const opq = a >= 1
          if (opq !== curOpaque) { pass3d.setPipeline(opq ? this.turbOpaquePipeline! : this.turbPipeline!); curOpaque = opq }
          // Identity transform (world) + params.x = this run's water alpha, bound at the transform group (2).
          this.bindWaterSlot(2, BRUSH_ZERO, BRUSH_ZERO, a)
        } else if (a !== curAlpha) {
          if (n > runFirst) pass3d.drawIndexed(n - runFirst, 1, runFirst, 0, 0)
          runFirst = n
          const opq = a >= 1
          if (opq !== curOpaque) { pass3d.setPipeline(opq ? this.turbOpaquePipeline! : this.turbPipeline!); curOpaque = opq }
          this.bindWaterSlot(2, BRUSH_ZERO, BRUSH_ZERO, a)
          curAlpha = a
        }
        const s = idxOfs[f], c = idxCnt[f]
        for (let e = 0; e < c; e++) staging[n++] = idxData[s + e]
      }
      if (bound && n > runFirst)
        pass3d.drawIndexed(n - runFirst, 1, runFirst, 0, 0)
    }
    if (n > start)
      dev.queue.writeBuffer(this.worldIndexBuf, start * 4, staging.buffer, start * 4, (n - start) * 4)
    this.worldIdxCursor = n
  }

  // ---- brush-model ENTITY passes (drawWorldSurfaces with ent != null) ----
  // r.drawBrushModel culls the entity, builds its per-texture chains under TexChain.model (backface-
  // culled front faces only), computes its origin/angles/alpha, then calls drawWorldSurfaces solid/
  // litwater/turb. These three methods consume those chains. Unlike the world path, the entity path
  // walks the per-texture LINKED LIST (t.texturechains[TexChain.model], the faces drawBrushModel
  // chained) and does NOT test surfVisibleFrame — the chain already holds only the visible front faces.
  // Each face's prebuilt fan indices (surfIndexData, keyed by Face.num — shared with the worldmodel)
  // append into the same shared index staging as the world, so drawIndexed reads the same worldVBuf.

  // Solid brush-entity surfaces (pass 'solid'). Groups by (diffuse, lightmap page = Face.lightmap-
  // texturenum) exactly like the world solid path; binds the entity's transform slot (origin/angles) so
  // worldPos = angles*Vert + origin. entalpha < 1 selects the alpha (blend/no-depth-write) pipeline and
  // is delivered to the fragment's output alpha via the transform slot's params.x.
  private drawBrushEntSolid(model: Model, ent: Entity): void {
    const dev = this.device
    const pass3d = this.pass
    if (dev == null || pass3d == null || this.worldPipeline == null || this.worldAlphaPipeline == null
        || this.worldFencePipeline == null
        || this.globalsBind == null || this.worldSampler == null || this.brushEntBind == null) return
    if (!this.ensureWorldBuffers(model)) return
    if (this.worldVBuf == null || this.worldIndexBuf == null) return
    const lmBind = this.ensureLightmapArrays()
    if (lmBind == null || this.lmLayerBuf == null) return

    const entalpha = pr.decodeAlpha(ent.alpha)
    const slot = this.brushEntCursor
    if (slot >= MAX_BRUSH_ENTS) return
    this.brushEntCursor++
    this.packBrushEnt(slot, ent.angles, ent.origin, entalpha)

    const idxData = model.surfIndexData, idxOfs = model.surfIndexOfs, idxCnt = model.surfIndexCount
    const usedTex = model.usedTextures
    const staging = this.worldIndices

    // The pipeline is chosen PER TEXTURE below (fence vs opaque vs translucent). group0/2/3 binds and the
    // vertex/index buffers set here persist across the switch — all three pipelines share worldLayout. The
    // consolidated lightmap arrays (group2) + layer buffer (slot 1) are bound once → one draw per texture.
    pass3d.setBindGroup(0, this.activeGlobalsBind)
    pass3d.setBindGroup(2, lmBind)
    pass3d.setBindGroup(3, this.brushEntBind, [slot * BRUSH_SLOT_BYTES])
    pass3d.setVertexBuffer(0, this.worldVBuf)
    pass3d.setVertexBuffer(1, this.lmLayerBuf)
    pass3d.setIndexBuffer(this.worldIndexBuf, 'uint32')

    const start = this.worldIdxCursor
    let n = start
    for (let ui = 0; ui < usedTex.length; ui++) {
      const i = usedTex[ui]
      const t = model.textures[i]
      if (t == null || t.texturechains == null) continue
      const chain = t.texturechains[TexChain.model]
      if (chain == null || (chain.flags & SOLID_SKIP)) continue
      const animated = r.textureAnimation(model, t, ent.frame)
      const entry = this.ensureWorldTexture(
        animated.texturenum as unknown as TexSource,
        (animated.fullbright ?? null) as unknown as TexSource | null,
      )
      if (entry == null) continue
      // Fence chains render through the alpha-test pipeline (index-255 texels discarded); otherwise the
      // opaque world pipeline, or the alpha pipeline for a translucent entity (entalpha < 1). Per-texture,
      // matching WebGL's per-texture uUseAlphaTest toggle. All three share worldLayout, so binds hold.
      pass3d.setPipeline(
        (chain.flags & def.SURF.drawfence)
          ? this.worldFencePipeline
          : (entalpha < 1 ? this.worldAlphaPipeline : this.worldPipeline),
      )
      pass3d.setBindGroup(1, entry.bind)

      const runFirst = n
      for (let s: Face | null = chain; s != null; s = s.texturechain) {
        const so = idxOfs[s.num], c = idxCnt[s.num]
        // Writes past a typed array are silently dropped, so an overflow would only surface as an
        // out-of-range writeBuffer below. Stop gathering and ask for more room next frame; the run
        // drawn so far stays valid.
        if (n + c > staging.length) { this.worldIdxWant = Math.max(this.worldIdxWant, (n + c) * 2); break }
        for (let e = 0; e < c; e++) staging[n++] = idxData[so + e]
      }
      if (n > runFirst) pass3d.drawIndexed(n - runFirst, 1, runFirst, 0, 0)
    }
    if (n > start)
      dev.queue.writeBuffer(this.worldIndexBuf, start * 4, staging.buffer, start * 4, (n - start) * 4)
    this.worldIdxCursor = n
  }

  // WebGPU opaque brush-entity FAST PATH (r.drawBrushModel's precompute branch). Draws an alpha==1 entity
  // whose PURE-SOLID submodel carries a precomputed static index set (Model.brushPrecompute, built in
  // r.buildBrushPrecompute) — every drawable solid/fence face's fan indices, grouped by (base texture,
  // fence). Reuses drawBrushEntSolid's binds + pipelines EXACTLY; only the index source differs (a static
  // per-submodel INDEX buffer instead of a per-frame CPU gather into the shared staging), so there is no
  // per-face backface walk or re-chain on the CPU. The extra (back-facing) triangles are depth-culled
  // overdraw on the idle GPU → image-identical for closed opaque models.
  drawBrushEntPrecomputed(ent: Entity): void {
    const dev = this.device
    const pass3d = this.pass
    const model = ent.model
    const pc = model.brushPrecompute
    if (pc == null) return
    if (dev == null || pass3d == null || this.worldPipeline == null || this.worldFencePipeline == null
        || this.globalsBind == null || this.worldSampler == null || this.brushEntBind == null) return
    if (!this.ensureWorldBuffers(model)) return
    if (this.worldVBuf == null || this.lmLayerBuf == null) return
    const lmBind = this.ensureLightmapArrays()
    if (lmBind == null) return

    // Lazily upload the submodel's static index list, cached by its Uint32Array identity (a new map's
    // buildBrushPrecompute makes fresh arrays → new buffers; the old ones freed in clearWorldCaches).
    let ibuf = this.brushPrecomputeBufCache.get(pc.indexData)
    if (ibuf == null) {
      ibuf = dev.createBuffer({
        size: Math.max(4, pc.indexData.byteLength),
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      })
      dev.queue.writeBuffer(ibuf, 0, pc.indexData.buffer, pc.indexData.byteOffset, pc.indexData.byteLength)
      this.brushPrecomputeBufCache.set(pc.indexData, ibuf)
    }

    // Entity transform slot (origin/angles, alpha=1) — same packing as drawBrushEntSolid.
    const slot = this.brushEntCursor
    if (slot >= MAX_BRUSH_ENTS) return
    this.brushEntCursor++
    this.packBrushEnt(slot, ent.angles, ent.origin, 1.0)

    // Same binds as drawBrushEntSolid: g0 globals, g2 lightmap arrays, g3 this entity's transform slot,
    // VBO slot0 world verts + slot1 lm layers. Only the index buffer differs (the static precomputed set).
    pass3d.setBindGroup(0, this.activeGlobalsBind)
    pass3d.setBindGroup(2, lmBind)
    pass3d.setBindGroup(3, this.brushEntBind, [slot * BRUSH_SLOT_BYTES])
    pass3d.setVertexBuffer(0, this.worldVBuf)
    pass3d.setVertexBuffer(1, this.lmLayerBuf)
    pass3d.setIndexBuffer(ibuf, 'uint32')

    const textures = model.textures
    const slots = pc.slots
    for (let s = 0; s < slots.length; s++) {
      const meta = slots[s]
      const t = textures[meta.textureIndex]
      if (t == null) continue
      // Animated diffuse resolves per draw (base texture + entity frame), matching drawBrushEntSolid.
      const animated = r.textureAnimation(model, t, ent.frame)
      const entry = this.ensureWorldTexture(
        animated.texturenum as unknown as TexSource,
        (animated.fullbright ?? null) as unknown as TexSource | null,
      )
      if (entry == null) continue
      // Fence chains render through the alpha-test pipeline; all others opaque (alpha==1 only here, so
      // never the alpha pipeline). Both share worldLayout, so the binds set above hold across the switch.
      pass3d.setPipeline(meta.isFence ? this.worldFencePipeline : this.worldPipeline)
      pass3d.setBindGroup(1, entry.bind)
      pass3d.drawIndexed(meta.count, 1, meta.first, 0, 0)
    }
  }

  // GPU-driven brush-entity path (r_gpucullents), called by r.drawBrushModel AFTER its entity-level
  // frustum cull — the same point Ironwail's R_SortEntities hands a surviving bmodel to the instanced
  // path. Returns false when the entity is NOT eligible (caller falls through to the verified per-face
  // chain path); true means consumed. Nothing draws here: the entity's transform is packed in walk order
  // and an entry recorded for flushBrushBatches, so entities sharing a model collapse into one draw.
  //
  // Eligible = the model has baked draw tables (gpuBrush.ts: brush model, pure-solid, drawable faces) and
  // the entity is opaque. Translucent entities keep the chain path: their alpha needs the blend pipeline
  // AND back-to-front ordering, neither of which survives being batched.
  batchBrushEnt(ent: Entity): boolean {
    if (r.cvr.gpucull == null || r.cvr.gpucull.value === 0) return false
    if (r.cvr.gpucullents == null || r.cvr.gpucullents.value === 0) return false
    const bd = this.brushDraw
    const model = ent.model
    if (bd == null || model == null || this.pass == null) return false
    if (this.worldInstPipeline == null || this.worldInstFencePipeline == null
        || this.brushInstBind == null || this.brushInstBuf == null) return false
    const id = bd.ids.get(model)
    if (id === undefined) return false
    if (pr.decodeAlpha(ent.alpha) !== 1) return false
    // The batch draws from the shared world VBO + lightmap arrays; only consume the entity once both are
    // ready, otherwise it would be recorded and then silently dropped by the flush.
    if (!this.ensureWorldBuffers(model)) return false
    if (this.worldVBuf == null || this.lmLayerBuf == null) return false
    if (this.ensureLightmapArrays() == null) return false

    const n = this.brushEntryCount
    if (n >= MAX_BRUSH_ENTS || this.brushInstCursor + n >= MAX_BRUSH_ENTS) return false
    packBrushXform(this.brushPackData, n * BRUSH_STRUCT_FLOATS, ent.angles, ent.origin, 1.0)
    const frame = ent.frame | 0
    this.brushEntrySlot[n] = n
    this.brushEntryModel[n] = id
    this.brushEntryFrame[n] = frame
    // Sort key groups by model AND frame: textureAnimation resolves per entity frame, so two entities of
    // the same model on different frames must not share a draw (Ironwail folds frame into its sort key
    // the same way — MODSORT_FRAMEMASK).
    this.brushEntryKey[n] = id * 65536 + (frame & 0xffff)
    this.brushEntryCount = n + 1
    return true
  }

  // Draw every brush entity the walk recorded: sort the entries by (model, frame), repack their transform
  // records so each group owns a contiguous instance range, upload that range once, then issue one
  // instanced drawIndexed per (model, texture, fence) group — the model's baked static index range with
  // instanceCount = the group's entity count and firstInstance = its base (WebGPU's @builtin(instance_index)
  // includes firstInstance for direct draws). All batched entities are opaque + depth-write, so drawing
  // them here rather than interleaved with the alias/other entities they were found among is depth-correct.
  private flushBrushBatches(): void {
    const n = this.brushEntryCount
    if (n === 0) return
    this.brushEntryCount = 0
    const dev = this.device
    const pass3d = this.pass
    const bd = this.brushDraw
    if (dev == null || pass3d == null || bd == null || this.brushInstBuf == null
        || this.brushInstBind == null || this.worldInstPipeline == null
        || this.worldInstFencePipeline == null || this.worldVBuf == null || this.lmLayerBuf == null) return
    const lmBind = this.ensureLightmapArrays()
    if (lmBind == null) return
    // A two-camera frame (skyroom) flushes twice; the second flush appends after the first's range.
    const base = this.brushInstCursor
    if (base + n > MAX_BRUSH_ENTS) return

    // Insertion sort of the index array by key (n = visible brush entities).
    const order = this.brushEntryOrder, key = this.brushEntryKey
    for (let i = 0; i < n; ++i) order[i] = i
    for (let i = 1; i < n; ++i) {
      const v = order[i], k = key[v]
      let j = i - 1
      for (; j >= 0 && key[order[j]] > k; --j) order[j + 1] = order[j]
      order[j + 1] = v
    }

    // Repack walk-order -> sorted so each (model, frame) group is one contiguous instance range.
    const src = this.brushPackData, dst = this.brushInstData
    for (let i = 0; i < n; ++i) {
      const s = this.brushEntrySlot[order[i]] * BRUSH_STRUCT_FLOATS
      const d = (base + i) * BRUSH_STRUCT_FLOATS
      for (let f = 0; f < BRUSH_STRUCT_FLOATS; ++f) dst[d + f] = src[s + f]
    }
    this.brushInstCursor = base + n
    dev.queue.writeBuffer(this.brushInstBuf, base * BRUSH_STRUCT_BYTES, this.brushInstData.buffer,
      base * BRUSH_STRUCT_BYTES, n * BRUSH_STRUCT_BYTES)

    // Shared state for every batch: the transform storage array (group3, no dynamic offset), the world
    // VBO + lightmap layer stream, and the ONE baked brush index buffer — none of it rebinds per entity.
    pass3d.setBindGroup(0, this.activeGlobalsBind)
    pass3d.setBindGroup(2, lmBind)
    pass3d.setBindGroup(3, this.brushInstBind)
    pass3d.setVertexBuffer(0, this.worldVBuf)
    pass3d.setVertexBuffer(1, this.lmLayerBuf)
    pass3d.setIndexBuffer(bd.indexBuf, 'uint32')

    for (let start = 0; start < n;) {
      const head = order[start], k = key[head]
      let end = start + 1
      while (end < n && key[order[end]] === k) ++end
      const count = end - start
      const id = this.brushEntryModel[head]
      const frame = this.brushEntryFrame[head]
      const model = bd.models[id]
      const first = bd.firstDraw[id], num = bd.numDraws[id]
      for (let d = first; d < first + num; d++) {
        const t = model.textures[bd.drawTex[d]]
        if (t == null) continue
        // Animated diffuse resolves per group (base texture + the group's entity frame), matching the
        // chain path's per-entity resolve.
        const animated = r.textureAnimation(model, t, frame)
        const entry = this.ensureWorldTexture(
          animated.texturenum as unknown as TexSource,
          (animated.fullbright ?? null) as unknown as TexSource | null,
        )
        if (entry == null) continue
        pass3d.setPipeline(bd.drawFence[d] !== 0 ? this.worldInstFencePipeline : this.worldInstPipeline)
        pass3d.setBindGroup(1, entry.bind)
        pass3d.drawIndexed(bd.drawCount[d], count, bd.drawFirst[d], 0, base + start)
      }
      start = end
    }
  }

  // Lit-water brush-entity surfaces (pass 'litwater'). Mirrors drawLitWater but over the entity's
  // TexChain.model linked list, with the entity's real transform and per-surface alpha =
  // r.waterAlphaForEntitySurface (entity alpha overrides the map water alpha), packed together into one
  // transform slot per water run. Gated on the WORLD's haslitwater, matching drawTextureChains_litwater.
  private drawBrushEntLitWater(model: Model, ent: Entity): void {
    if (!r.cvr.litwater.value || !cl.clState.worldmodel.haslitwater) return
    const dev = this.device
    const pass3d = this.pass
    if (dev == null || pass3d == null || this.litwaterPipeline == null || this.globalsBind == null
        || this.brushEntBind == null) return
    if (!this.ensureWorldBuffers(model)) return
    if (this.worldVBuf == null || this.worldIndexBuf == null) return
    const lmBind = this.ensureLightmapArrays()
    if (lmBind == null || this.lmLayerBuf == null) return

    const idxData = model.surfIndexData, idxOfs = model.surfIndexOfs, idxCnt = model.surfIndexCount
    const usedTex = model.usedTextures
    const staging = this.worldIndices

    pass3d.setPipeline(this.litwaterPipeline)
    let curOpaque = false   // opacity class of the bound pipeline (alpha>=1 -> opaque variant)
    pass3d.setBindGroup(0, this.activeGlobalsBind)
    pass3d.setBindGroup(2, lmBind)
    pass3d.setVertexBuffer(0, this.worldVBuf)
    pass3d.setVertexBuffer(1, this.lmLayerBuf)
    pass3d.setIndexBuffer(this.worldIndexBuf, 'uint32')

    const start = this.worldIdxCursor
    let n = start
    for (let ui = 0; ui < usedTex.length; ui++) {
      const i = usedTex[ui]
      const t = model.textures[i]
      if (t == null || t.texturechains == null) continue
      const chain = t.texturechains[TexChain.model]
      if (chain == null || !(chain.flags & def.SURF.drawtub)) continue
      const animated = r.textureAnimation(model, t, ent.frame)
      const entry = this.ensureWorldTexture(
        animated.texturenum as unknown as TexSource,
        (animated.fullbright ?? null) as unknown as TexSource | null,
      )
      if (entry == null) continue

      let runFirst = n
      let bound = false
      let curAlpha = -1
      for (let s: Face | null = chain; s != null; s = s.texturechain) {
        if (!r.isLitWaterFlags(s.flags)) continue
        const a = r.waterAlphaForEntitySurface(ent, s)
        if (!bound) {
          const opq = a >= 1
          if (opq !== curOpaque) { pass3d.setPipeline(opq ? this.litwaterOpaquePipeline! : this.litwaterPipeline!); curOpaque = opq }
          // Entity transform + params.x = this run's water alpha, bound at the transform group (3).
          if (!this.bindWaterSlot(3, ent.angles, ent.origin, a)) continue
          bound = true; curAlpha = a
          pass3d.setBindGroup(1, entry.bind)
        } else if (a !== curAlpha) {
          if (n > runFirst) pass3d.drawIndexed(n - runFirst, 1, runFirst, 0, 0)
          runFirst = n
          const opq = a >= 1
          if (opq !== curOpaque) { pass3d.setPipeline(opq ? this.litwaterOpaquePipeline! : this.litwaterPipeline!); curOpaque = opq }
          this.bindWaterSlot(3, ent.angles, ent.origin, a)
          curAlpha = a
        }
        const so = idxOfs[s.num], c = idxCnt[s.num]
        // Writes past a typed array are silently dropped, so an overflow would only surface as an
        // out-of-range writeBuffer below. Stop gathering and ask for more room next frame; the run
        // drawn so far stays valid.
        if (n + c > staging.length) { this.worldIdxWant = Math.max(this.worldIdxWant, (n + c) * 2); break }
        for (let e = 0; e < c; e++) staging[n++] = idxData[so + e]
      }
      if (bound && n > runFirst)
        pass3d.drawIndexed(n - runFirst, 1, runFirst, 0, 0)
    }
    if (n > start)
      dev.queue.writeBuffer(this.worldIndexBuf, start * 4, staging.buffer, start * 4, (n - start) * 4)
    this.worldIdxCursor = n
  }

  // Unlit turbulent brush-entity surfaces (pass 'turb'). Mirrors drawTurb over the entity's
  // TexChain.model linked list. The classic Turbulent program uses the IDENTITY transform even for
  // entities (drawTextureChains_water always sets uOrigin=0/uAngles=identity), so this packs identity
  // transform slots (params.x = the run's water alpha) exactly like the world. Per-surface alpha =
  // r.waterAlphaForEntitySurface.
  private drawBrushEntTurb(model: Model, ent: Entity): void {
    const dev = this.device
    const pass3d = this.pass
    if (dev == null || pass3d == null || this.turbPipeline == null || this.globalsBind == null
        || this.brushEntBind == null) return
    if (!this.ensureWorldBuffers(model)) return
    if (this.worldVBuf == null || this.worldIndexBuf == null) return

    const litwaterActive = r.cvr.litwater.value !== 0 && cl.clState.worldmodel.haslitwater
    const idxData = model.surfIndexData, idxOfs = model.surfIndexOfs, idxCnt = model.surfIndexCount
    const usedTex = model.usedTextures
    const staging = this.worldIndices

    pass3d.setPipeline(this.turbPipeline)
    let curOpaque = false   // opacity class of the bound pipeline (alpha>=1 -> opaque variant)
    pass3d.setBindGroup(0, this.activeGlobalsBind)
    pass3d.setVertexBuffer(0, this.worldVBuf)
    pass3d.setIndexBuffer(this.worldIndexBuf, 'uint32')

    const start = this.worldIdxCursor
    let n = start
    for (let ui = 0; ui < usedTex.length; ui++) {
      const i = usedTex[ui]
      const t = model.textures[i]
      if (t == null || t.texturechains == null) continue
      const chain = t.texturechains[TexChain.model]
      if (chain == null || !(chain.flags & def.SURF.drawtub)) continue
      const animated = r.textureAnimation(model, t, ent.frame)
      const entry = this.ensureWorldTexture(
        animated.texturenum as unknown as TexSource,
        (animated.fullbright ?? null) as unknown as TexSource | null,
      )
      if (entry == null) continue

      let runFirst = n
      let bound = false
      let curAlpha = -1
      for (let s: Face | null = chain; s != null; s = s.texturechain) {
        if (litwaterActive && r.isLitWaterFlags(s.flags)) continue
        const a = r.waterAlphaForEntitySurface(ent, s)
        if (!bound) {
          const opq = a >= 1
          if (opq !== curOpaque) { pass3d.setPipeline(opq ? this.turbOpaquePipeline! : this.turbPipeline!); curOpaque = opq }
          // Identity transform (WebGL turb entities too) + params.x = this run's water alpha, at group 2.
          if (!this.bindWaterSlot(2, BRUSH_ZERO, BRUSH_ZERO, a)) continue
          bound = true; curAlpha = a
          pass3d.setBindGroup(1, entry.bind)
        } else if (a !== curAlpha) {
          if (n > runFirst) pass3d.drawIndexed(n - runFirst, 1, runFirst, 0, 0)
          runFirst = n
          const opq = a >= 1
          if (opq !== curOpaque) { pass3d.setPipeline(opq ? this.turbOpaquePipeline! : this.turbPipeline!); curOpaque = opq }
          this.bindWaterSlot(2, BRUSH_ZERO, BRUSH_ZERO, a)
          curAlpha = a
        }
        const so = idxOfs[s.num], c = idxCnt[s.num]
        // Writes past a typed array are silently dropped, so an overflow would only surface as an
        // out-of-range writeBuffer below. Stop gathering and ask for more room next frame; the run
        // drawn so far stays valid.
        if (n + c > staging.length) { this.worldIdxWant = Math.max(this.worldIdxWant, (n + c) * 2); break }
        for (let e = 0; e < c; e++) staging[n++] = idxData[so + e]
      }
      if (bound && n > runFirst)
        pass3d.drawIndexed(n - runFirst, 1, runFirst, 0, 0)
    }
    if (n > start)
      dev.queue.writeBuffer(this.worldIndexBuf, start * 4, staging.buffer, start * 4, (n - start) * 4)
    this.worldIdxCursor = n
  }

  // Pack one brush entity's transform slot: the WGSL BrushXform struct (std140, 80B) — mat3x3 angles as
  // 3 padded vec4 columns (GL.rotationMatrix(angles), scale 1), origin.xyz, params.x = alpha. Angles
  // [0,0,0] gives the identity matrix (slot 0). Reproduces GL.rotationMatrix / vshBrush's uAngles.
  private packBrushEnt(slot: number, angles: V3, origin: V3, alpha: number): void {
    packBrushXform(this.brushEntData, slot * BRUSH_SLOT_FLOATS, angles, origin, alpha)
  }

  // Pack one water-run transform slot (identity for the world, the entity transform for a brush entity)
  // with params.x = the run's water alpha, and bind it at the pipeline's transform group. Each distinct
  // water run consumes one slot from the shared brushEnt dynamic-offset buffer (the buffer is sized for
  // solid + water slots per entity). Returns false only if the per-frame slot budget is exhausted (draw
  // then keeps the previously bound slot — practically unreachable at 8193 slots).
  private bindWaterSlot(group: number, angles: V3, origin: V3, alpha: number): boolean {
    const pass3d = this.pass
    if (pass3d == null || this.brushEntBind == null) return false
    const slot = this.brushEntCursor
    if (slot >= MAX_BRUSH_ENTS) return false
    this.brushEntCursor++
    this.packBrushEnt(slot, angles, origin, alpha)
    pass3d.setBindGroup(group, this.brushEntBind, [slot * BRUSH_SLOT_BYTES])
    return true
  }

  // Consolidated lightmaps: build (once per map) the 4 per-style texture_2d_arrays + the single
  // group(2) bind group binding all four, so world draws batch by texture (no per-page flush). Keyed off
  // r.state.model_lmlayer_data identity — a new map (fresh identity) rebuilds; unchanged returns the cached
  // bind. Each populated page's retained slot rgba is uploaded into its compact layer (lm.state.lmPageToLayer;
  // slot 0 layer == page). Untouched layers stay WebGPU-zero-initialized (black); a surface on a page lacking
  // a slot emits layer 0 for it, but its style weight is 0 so the sample is discarded.
  private ensureLightmapArrays(): GPUBindGroup | null {
    const dev = this.device
    if (dev == null || this.worldGroup2Layout == null || this.lmSampler == null) return null
    const identity = r.state.model_lmlayer_data
    if (identity == null) return null
    if (this.lmArrayBind != null && this.lmArrayIdentity === identity) return this.lmArrayBind

    // Rebuild: free the previous map's arrays first.
    for (let m = 0; m < 4; m++) {
      const old = this.lmArrayTex[m]
      if (old != null) { old.destroy(); this.lmArrayTex[m] = null }
    }
    const numPages = lm.state.lmNumPages
    const counts = lm.state.lmLayerCount
    const pageToLayer = lm.state.lmPageToLayer
    const lmtex = texture.state.lightmap_style_textures
    const maxLayers = dev.limits.maxTextureArrayLayers
    if (numPages > maxLayers)
      con.print(`WebGPU: ${numPages} lightmap pages exceed maxTextureArrayLayers ${maxLayers} — lightmaps beyond the limit will be black (multi-array fallback is a future slice).\n`)

    for (let m = 0; m < 4; m++) {
      const layers = Math.min(Math.max(1, counts[m]), maxLayers)
      const tex = dev.createTexture({
        size: { width: LM_PAGE_SIZE, height: LM_PAGE_SIZE, depthOrArrayLayers: layers },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      })
      // Upload ALL layers in ONE contiguous writeTexture (no per-layer origin.z calls): per-layer array
      // writes were producing corrupted content for some layers (right index, garbage texels — the e1m1
      // third-room corruption) across vendors/browsers; a single volume-shaped write goes through a
      // different copy path. Cold path (map load) — the transient staging alloc is fine.
      const p2l = pageToLayer[m]
      const layerBytes = LM_PAGE_SIZE * LM_PAGE_SIZE * 4
      const staging = new Uint8Array(layerBytes * layers)   // zero-filled = black for absent layers
      for (let page = 0; page < numPages; page++) {
        const layer = m === 0 ? page : (p2l != null ? p2l[page] : -1)
        if (layer < 0 || layer >= layers) continue
        const slots = lmtex[page]
        const glt = slots != null ? slots[m] : null
        const src = glt != null ? (glt.texnum as unknown as TexSource) : null
        if (src == null || src.rgba == null || !src.rgbaW || !src.rgbaH) continue
        const w = Math.min(src.rgbaW | 0, LM_PAGE_SIZE), h = Math.min(src.rgbaH | 0, LM_PAGE_SIZE)
        const dstBase = layer * layerBytes
        const srcStride = (src.rgbaW | 0) * 4
        for (let row = 0; row < h; row++)
          staging.set(src.rgba.subarray(row * srcStride, row * srcStride + w * 4), dstBase + row * LM_PAGE_SIZE * 4)
      }
      dev.queue.writeTexture(
        { texture: tex },
        staging,
        { bytesPerRow: LM_PAGE_SIZE * 4, rowsPerImage: LM_PAGE_SIZE },
        { width: LM_PAGE_SIZE, height: LM_PAGE_SIZE, depthOrArrayLayers: layers },
      )
      this.lmArrayTex[m] = tex
    }

    this.lmArrayBind = dev.createBindGroup({
      layout: this.worldGroup2Layout,
      entries: [
        { binding: 0, resource: this.lmSampler },
        { binding: 1, resource: (this.lmArrayTex[0] as GPUTexture).createView({ dimension: '2d-array' }) },
        { binding: 2, resource: (this.lmArrayTex[1] as GPUTexture).createView({ dimension: '2d-array' }) },
        { binding: 3, resource: (this.lmArrayTex[2] as GPUTexture).createView({ dimension: '2d-array' }) },
        { binding: 4, resource: (this.lmArrayTex[3] as GPUTexture).createView({ dimension: '2d-array' }) },
      ],
    })
    this.lmArrayIdentity = identity
    return this.lmArrayBind
  }

  // Drop all per-map GPU texture caches (diffuse + lightmap slots + page bind groups), destroying the
  // GPUTextures. Called on map change (see drawWorldSurfaces) so the next map re-uploads fresh rather
  // than binding the previous map's stale lightmaps/diffuse, and to free the old map's GPU memory.
  private clearWorldCaches(): void {
    for (const e of this.worldTexCache.values()) { e.tex.destroy(); if (e.fbTex != null) e.fbTex.destroy() }
    this.worldTexCache.clear()
    // Free the previous map's GPU-cull buffers (rebuilt right after this in beginScene).
    if (this.cull != null) { this.cull.destroy(); this.cull = null }
    // Brush-entity draw tables hold this map's shared index buffer + Model references — free and drop
    // both, and clear any entries recorded this frame so a stale modelId can never be drawn.
    if (this.brushDraw != null) { this.brushDraw.destroy(); this.brushDraw = null }
    this.brushEntryCount = 0
    // Drop the per-map compute-cull storage bind group (its buffers were just destroyed);
    // buildCullBindings rebuilds it for the new map. GPUBindGroups have no destroy(); GC reclaims it.
    this.cullStorageBind = null
    // Consolidated lightmap arrays: destroy the 4 per-style array textures + drop the bind so the
    // next map rebuilds fresh (ensureLightmapArrays also identity-checks r.state.model_lmlayer_data).
    for (let m = 0; m < 4; m++) {
      const t = this.lmArrayTex[m]
      if (t != null) { t.destroy(); this.lmArrayTex[m] = null }
    }
    this.lmArrayBind = null
    this.lmArrayIdentity = null   // GPUBindGroups have no destroy(); GC reclaims them
    // Alias models reload per map (fresh cmdsData identities + skin texnum handles), so drop the alias
    // VBO + skin caches and free their GPU memory — a stale hit would bind the previous map's data.
    for (const b of this.aliasVBCache.values()) b.destroy()
    this.aliasVBCache.clear()
    // The instanced g1 binds reference those VBOs — drop them, plus the entry list's references to
    // this map's bind groups and their sort ids. GC reclaims GPUBindGroups.
    this.aliasInstBindCache.clear()
    this.bindIds.clear()
    this.bindIdNext = 0
    this.entryCount = 0
    this.entryInstBind.fill(null)
    this.entrySkinBind.fill(null)
    // Brush-entity precompute index buffers reload per map (buildBrushPrecompute makes fresh indexData
    // identities); drop + free them so the next map re-uploads and no stale buffer is bound.
    for (const b of this.brushPrecomputeBufCache.values()) b.destroy()
    this.brushPrecomputeBufCache.clear()
    // Player-colormap entries first: their bind groups reference the base skin views destroyed below.
    for (const e of this.aliasPlayerSkinCache.values()) e.tex.destroy()
    this.aliasPlayerSkinCache.clear()
    for (const e of this.aliasSkinCache.values()) e.tex.destroy()
    this.aliasSkinCache.clear()
    // Sprite frame textures reload per map (fresh texturenum handles) — drop the cache + free GPU memory.
    for (const e of this.spriteTexCache.values()) e.tex.destroy()
    this.spriteTexCache.clear()
    // Sky textures: the handle is stable across maps but the content differs; drop so the next map's
    // fresh rgba re-uploads (ensureSkyTextures also identity-checks, this frees the old GPU memory).
    if (this.skySolidTex != null) { this.skySolidTex.destroy(); this.skySolidTex = null }
    if (this.skyAlphaTex != null) { this.skyAlphaTex.destroy(); this.skyAlphaTex = null }
    this.skyTexBind = null
    this.skyUploadedRgba = null
    // Cubemap skybox: drop the cube GPUTexture + bind so a new map's skybox re-uploads (ensureSkyCubeTexture
    // also identity-checks against sky.state.cubeFaces; this frees the old GPU memory on map change).
    if (this.skyCubeTex != null) { this.skyCubeTex.destroy(); this.skyCubeTex = null }
    this.skyCubeBind = null
    this.skyCubeUploaded = null
    // Scripted-particle atlas: the rgba handle is stable across maps, but drop it so its GPU memory frees
    // on map change; ensurePScriptAtlas re-uploads next frame (identity-checked, so a stable atlas is a
    // single re-upload). Null the bind + src so the re-upload fires.
    if (this.pscriptAtlasTex != null) { this.pscriptAtlasTex.destroy(); this.pscriptAtlasTex = null }
    this.pscriptAtlasBind = null
    this.pscriptAtlasSrc = null
  }

  // Port of drawEntitiesOnList's visedict loop: opaque entities in the first pass (alphaPass=false),
  // translucent in the alpha pass. Alias-type entities dispatch to the alias draw; brush-type dispatch
  // to r.drawBrushModel (→ drawWorldSurfaces ent != null). Sprite-type entities are drawn in a separate
  // blended sub-pass (drawSprites) at the END of the OPAQUE pass, exactly like drawEntitiesOnList (which
  // runs its sprite loop after the alias/brush loop, only when !alphaPass, with BLEND on + depthMask off).
  drawEntities(alphaPass: boolean): void {
    if (r.cvr.drawentities.value === 0) return
    // r_instancedmodels: batchable opaque alias entities are only RECORDED during the walk and drawn
    // together in flushAliasBatches below, bucketed by (model, skin) — visedicts interleave models, so
    // batching only consecutive runs is worth almost nothing. They are opaque + depth-write, so
    // deferring them past the brush/non-batchable draws is depth-correct. The alpha pass never batches.
    const instanced = !alphaPass && this.pass != null && this.aliasInstPipeline != null
      && r.cvr.instancedmodels != null && r.cvr.instancedmodels.value !== 0
    for (let i = 0; i < cl.state.numvisedicts; ++i) {
      const ent = cl.state.visedicts[i]
      const entalpha = pr.decodeAlpha(ent.alpha)
      // johnfitz -- opaque entities in the first pass, translucent in the alpha pass
      if (ent.model == null || (entalpha === 1) === alphaPass) continue
      switch (ent.model.type) {
        case mod.TYPE.alias:
          if (instanced && this.batchAliasModel(ent)) continue
          this.drawAliasModel(ent, this.globalsBind as GPUBindGroup)
          continue
        case mod.TYPE.brush:
          // Brush-model entities (b_*.bsp pickups, doors/plats/buttons/func_ brushwork): r.drawBrushModel
          // culls + builds the entity's TexChain.model chains, then calls back into drawWorldSurfaces
          // (solid/litwater/turb, ent != null) — the drawBrushEnt* paths above.
          r.drawBrushModel(ent)
          continue
        // Sprites are handled below in the opaque-pass sprite sub-pass, not here.
      }
    }
    // Still before the sprite sub-pass (blended, depth-write off) and before the alpha pass.
    this.flushBrushBatches()
    this.flushAliasBatches()
    // Sprite sub-pass: opaque pass only, after the alias/brush entities (drawEntitiesOnList tail).
    if (!alphaPass) this.drawSprites()
  }

  // Flashblend glow balls (gl_flashblend 1). Mirrors WebGLRenderer's drawFlashblendDlights: near lights
  // (< radius*0.35) accumulate into v.blend (the screen tint, backend-agnostic) instead of drawing; the
  // rest draw as instanced additive fans. globals share the particle PGlobals packing (perspective +
  // viewAngles + viewOrigin from globalsData, gamma in vpn.w).
  drawFlashblendDlights(): void {
    if (r.cvr.flashblend.value === 0) return
    const dev = this.device
    const pass3d = this.pass
    if (dev == null || pass3d == null || this.dlightPipeline == null || this.dlightGlobalsBuf == null
        || this.dlightGlobalsBind == null || this.dlightFanBuf == null || this.dlightInstBuf == null) return

    const inst = this.dlightInstData
    const org = r.state.refdef.vieworg
    let count = 0
    for (let i = 0; i <= 31; i++) {
      const l = cl.state.dlights[i]
      if (l.die < cl.clState.time || l.radius === 0.0) continue
      const dx = l.origin[0] - org[0], dy = l.origin[1] - org[1], dz = l.origin[2] - org[2]
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) < l.radius * 0.35) {
        // Too close to see the ball — bleed it into the view tint (identical math to the WebGL path).
        let a = l.radius * 0.0003
        v.blend[3] += a * (1.0 - v.blend[3])
        a /= v.blend[3]
        v.blend[0] = v.blend[1] * (1.0 - a) + (255.0 * a)
        v.blend[1] = v.blend[1] * (1.0 - a) + (127.5 * a)
        v.blend[2] *= 1.0 - a
        continue
      }
      const o = count * 4
      inst[o] = l.origin[0]; inst[o + 1] = l.origin[1]; inst[o + 2] = l.origin[2]; inst[o + 3] = l.radius
      count++
    }
    if (count === 0) return

    // Globals: same 32-float perspective/viewAngles/viewOrigin prefix as the particle path + gamma in vpn.w.
    const gd = this.dlightGlobalsData
    gd.set(this.globalsData.subarray(0, 32))
    gd[35] = this.globalsData[33]   // gamma → vpn.w
    dev.queue.writeBuffer(this.dlightGlobalsBuf, 0, gd.buffer, 0, 144)
    dev.queue.writeBuffer(this.dlightInstBuf, 0, inst.buffer, 0, count * 16)

    pass3d.setPipeline(this.dlightPipeline)
    pass3d.setBindGroup(0, this.dlightGlobalsBind)
    pass3d.setVertexBuffer(0, this.dlightFanBuf)
    pass3d.setVertexBuffer(1, this.dlightInstBuf)
    pass3d.draw(48, count, 0, 0)
  }

  // Classic id particles (blood/explosions/sparks/rocket trails/teleport). Re-packs the active pool into
  // the 16B instance layout using the SAME logic + scratch (r.state.particleInstanceFloats/Bytes) the
  // WebGL drawClassicParticles fills — the CPU sim (r.runParticles) and pool are reused, not reimplemented
  // — then one instanced draw of the static corner quad. Records into the open 3D pass (after the world),
  // depth-tested but not depth-writing, so particles are occluded by nearer geometry but not by each other.
  drawClassicParticles(): void {
    const n = r.state.numActiveParticles
    if (n === 0) return
    const dev = this.device
    const pass3d = this.pass
    if (dev == null || pass3d == null || this.particlePipeline == null || this.particleGlobalsBuf == null
        || this.particleGlobalsBind == null || this.particleCornerBuf == null) return

    // Pack origin (f32x3) + color (unorm8x4) per instance into the shared r.state scratch (identical to
    // the WebGL packing) — the palette lookup + 16B stride are single-sourced with the WebGL path.
    const floats = r.state.particleInstanceFloats
    const bytes = r.state.particleInstanceBytes
    const org = r.state.particleOrg, pcolor = r.state.particleColor, pal = vid.d_8to24table
    for (let i = 0; i < n; i++) {
      const fBase = i * 4, bBase = i * 16, i3 = i * 3
      floats[fBase] = org[i3]; floats[fBase + 1] = org[i3 + 1]; floats[fBase + 2] = org[i3 + 2]
      const color = pal[pcolor[i]]
      bytes[bBase + 12] = color & 0xff
      bytes[bBase + 13] = (color >> 8) & 0xff
      bytes[bBase + 14] = color >> 16
      bytes[bBase + 15] = 255
    }

    // Globals: perspective + viewAngles + viewOrigin (the 32 floats beginScene packed), then vpn.xyz +
    // gamma, then the world UBO's params + fogColor vec4s verbatim (32..39 → 36..43), so PGlobals.params.z
    // is the same fog density WORLD_WGSL reads and particles fog with the surfaces behind them.
    const pd = this.particleGlobalsData
    pd.set(this.globalsData.subarray(0, 32))
    const vpn = r.state.vpn
    pd[32] = vpn[0]; pd[33] = vpn[1]; pd[34] = vpn[2]; pd[35] = this.globalsData[33]
    pd.set(this.globalsData.subarray(32, 40), 36)
    dev.queue.writeBuffer(this.particleGlobalsBuf, 0, pd.buffer, 0, 176)

    const inst = this.ensureParticleInstBuf(r.state.particleInstanceData.byteLength)
    if (inst == null) return
    dev.queue.writeBuffer(inst, 0, r.state.particleInstanceData, 0, n * 16)

    pass3d.setPipeline(this.particlePipeline)
    pass3d.setBindGroup(0, this.particleGlobalsBind)
    pass3d.setVertexBuffer(0, this.particleCornerBuf)
    pass3d.setVertexBuffer(1, inst)
    pass3d.draw(4, n, 0, 0)
  }

  // Scripted effectinfo particles (torches / weather / effectinfo). The CPU pack stays single-sourced in
  // pscript.fillInstanceBuffers (fills pscript.state.instanceData[0..2]); this uploads each non-empty
  // bucket's 56B stream and issues one instanced draw per blend mode (alpha/additive/invmod). Guards +
  // uVright/uVup/uPixelWidth match the WebGL drawScriptParticles exactly.
  drawScriptParticles(): void {
    if (pscript.cvr.fteparticles.value === 0) return
    if (pscript.state.pNumActive === 0) return
    if (pscript.state.atlasTexture == null) return
    const dev = this.device
    const pass3d = this.pass
    if (dev == null || pass3d == null || this.pscriptGlobalsBuf == null || this.pscriptGlobalsBind == null
        || this.pscriptCornerBuf == null) return

    const atlasBind = this.ensurePScriptAtlas()
    if (atlasBind == null) return

    // Globals: reuse the beginScene-packed perspective/viewAngles/viewOrigin, then vright, vup +
    // uPixelWidth (world half-width of one screen pixel at distance 1 — the spark min-width clamp), gamma.
    const sd = this.pscriptGlobalsData
    sd.set(this.globalsData.subarray(0, 32))
    const vr = r.state.vright, vu = r.state.vup
    sd[32] = vr[0]; sd[33] = vr[1]; sd[34] = vr[2]; sd[35] = 0
    sd[36] = vu[0]; sd[37] = vu[1]; sd[38] = vu[2]
    sd[39] = Math.tan(r.state.refdef.fov_y * Math.PI / 360) / Math.max(1, r.state.refdef.vrect.height)
    sd[40] = this.globalsData[33]; sd[41] = 0; sd[42] = 0; sd[43] = 0
    dev.queue.writeBuffer(this.pscriptGlobalsBuf, 0, sd.buffer, 0, 176)

    pscript.fillInstanceBuffers()

    pass3d.setBindGroup(0, this.pscriptGlobalsBind)
    pass3d.setBindGroup(1, atlasBind)
    pass3d.setVertexBuffer(0, this.pscriptCornerBuf)
    for (let b = 0; b < 3; b++) {
      const count = pscript.state.instanceCounts[b]
      if (count === 0) continue
      const pipeline = this.pscriptPipelines[b]
      if (pipeline == null) continue
      const inst = this.ensurePScriptInstBuf(b, pscript.state.instanceData[b].byteLength)
      if (inst == null) continue
      dev.queue.writeBuffer(inst, 0, pscript.state.instanceData[b], 0, count * pscript.INSTANCE_STRIDE)
      pass3d.setPipeline(pipeline)
      pass3d.setVertexBuffer(1, inst)
      pass3d.draw(4, count, 0, 0)
    }
  }

  // Lazily (re)create the classic-particle instance stream, grown to hold the pool's packed bytes.
  private ensureParticleInstBuf(byteLength: number): GPUBuffer | null {
    const dev = this.device
    if (dev == null) return null
    if (this.particleInstBuf != null && this.particleInstBytes >= byteLength) return this.particleInstBuf
    if (this.particleInstBuf != null) this.particleInstBuf.destroy()
    const size = Math.max(16, byteLength)
    this.particleInstBuf = dev.createBuffer({ size, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
    this.particleInstBytes = size
    return this.particleInstBuf
  }

  // Lazily (re)create one scripted-particle blend bucket's instance stream, grown as needed.
  private ensurePScriptInstBuf(bucket: number, byteLength: number): GPUBuffer | null {
    const dev = this.device
    if (dev == null) return null
    const cur = this.pscriptInstBufs[bucket]
    if (cur != null && this.pscriptInstBytes[bucket] >= byteLength) return cur
    if (cur != null) cur.destroy()
    const size = Math.max(pscript.INSTANCE_STRIDE, byteLength)
    const buf = dev.createBuffer({ size, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
    this.pscriptInstBufs[bucket] = buf
    this.pscriptInstBytes[bucket] = size
    return buf
  }

  // Lazily upload the effectinfo atlas RGBA (retained WebGPU-gated on pscript.state.atlasTexture in
  // loadParticleFont) into a GPUTexture + build its group1 bind group, keyed by the rgba identity so a
  // font reload re-uploads. Sampler = linear + REPEAT (matches the GL atlas texture). Cleared in
  // clearWorldCaches on map change.
  private ensurePScriptAtlas(): GPUBindGroup | null {
    const dev = this.device
    if (dev == null || this.pscriptAtlasLayout == null || this.pscriptSampler == null) return null
    const src = pscript.state.atlasTexture as unknown as TexSource | null
    if (src == null || src.rgba == null || !src.rgbaW || !src.rgbaH) return null
    if (this.pscriptAtlasBind != null && this.pscriptAtlasSrc === src.rgba) return this.pscriptAtlasBind
    if (this.pscriptAtlasTex != null) this.pscriptAtlasTex.destroy()
    const w = src.rgbaW | 0, h = src.rgbaH | 0
    const gtex = dev.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    dev.queue.writeTexture(
      { texture: gtex },
      src.rgba as GPUAllowSharedBufferSource,
      { bytesPerRow: w * 4, rowsPerImage: h },
      { width: w, height: h },
    )
    this.pscriptAtlasTex = gtex
    this.pscriptAtlasBind = dev.createBindGroup({
      layout: this.pscriptAtlasLayout,
      entries: [
        { binding: 0, resource: this.pscriptSampler },
        { binding: 1, resource: gtex.createView() },
      ],
    })
    this.pscriptAtlasSrc = src.rgba
    return this.pscriptAtlasBind
  }

  // No-op: the underwater warp resolve moved to begin2D, and the per-entity alias uniform upload moved
  // to endFrame (endScene is only called when dowarp — doing the upload here would leave entity uniforms
  // stale above water).
  endScene(): void {}

  // ---- 2D / HUD ----
  begin2D(_ortho?: Float32Array): void {
    if (this.device == null || this.orthoBuf == null) return
    const dev = this.device

    // Fallback opener for a 2D-only frame (no 3D ran, so drawSky never opened the deferred r_gpucull
    // pass). applyViewport=false: 2D sets the full-target viewport itself below; no compute cull is
    // encoded here (the solid world isn't drawn on a 2D-only frame). A no-op when the pass is already open.
    this.ensurePass(false)

    // Underwater: warp the 3D (offscreen A) into offscreen2 (B) here, BEFORE the 2D pass, so the HUD/
    // console/menu drawn afterward land on B undistorted. Non-dowarp keeps today's single-target path
    // exactly (2D flushes straight into the offscreen pass opened in beginFrame; endFrame presents A).
    if (r.state.dowarp && this.encoder != null && this.pass != null && this.warpPipeline != null
        && this.warpBind != null && this.warpUTimeBuf != null && this.offscreen2View != null) {
      // End the 3D pass (A) so A can be sampled, then blit A -> B with the warp distortion.
      this.pass.end()
      const u = this.warpUTimeData
      u[0] = host.state.realtime % (Math.PI * 2.0)   // same uTime source as WebGLRenderer.endScene's Warp
      u[1] = 0; u[2] = 0; u[3] = 0
      dev.queue.writeBuffer(this.warpUTimeBuf, 0, u.buffer, 0, 16)
      const warp = this.encoder.beginRenderPass({
        colorAttachments: [{
          view: this.offscreen2View,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: CLEAR,
        }],
      })
      warp.setPipeline(this.warpPipeline)
      warp.setBindGroup(0, this.warpBind)
      warp.draw(3, 1, 0, 0)
      warp.end()
      // New 2D pass into B, preserving the warped 3D (loadOp 'load'). The 2D pipelines declare a depth
      // state, so the pass must carry a depth attachment — B's own native-sized depth2 (contents ignored:
      // 2D uses depthCompare 'always', depthWrite off). A's depthView may be r_scale-reduced ≠ B.
      this.pass = this.encoder.beginRenderPass({
        colorAttachments: [{
          view: this.offscreen2View,
          loadOp: 'load',
          storeOp: 'store',
        }],
        depthStencilAttachment: this.depth2View != null ? {
          view: this.depth2View,
          depthLoadOp: 'load',
          depthStoreOp: 'store',
        } : undefined,
      })
      this.frameWarp = true
    }

    // r_scale (non-warp frames — the warp above upscales A→B as a side effect of its own blit): the 3D
    // rendered into the reduced A; plain-blit it up into native B (nearest, the QS/Ironwail chunky look),
    // then draw the 2D layer on B at native res. endFrame presents B (frameWarp).
    if (!this.frameWarp && this.scale3D > 1 && this.encoder != null && this.pass != null
        && this.blitPipeline != null && this.blitBind != null && this.offscreen2View != null) {
      this.pass.end()
      const up = this.encoder.beginRenderPass({
        colorAttachments: [{
          view: this.offscreen2View,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: CLEAR,
        }],
      })
      up.setPipeline(this.blitPipeline)
      up.setBindGroup(0, this.blitBind)
      up.draw(3, 1, 0, 0)
      up.end()
      this.pass = this.encoder.beginRenderPass({
        colorAttachments: [{
          view: this.offscreen2View,
          loadOp: 'load',
          storeOp: 'store',
        }],
        depthStencilAttachment: this.depth2View != null ? {
          view: this.depth2View,
          depthLoadOp: 'load',
          depthStoreOp: 'store',
        } : undefined,
      })
      this.frameWarp = true
    }

    // The 3D pass set its viewport to the view rect; reset to the full target so the 2D layer (the HUD
    // sits BELOW the view rect) isn't clipped. The 2D target is native-sized B on warp/r_scale frames
    // (frameWarp), the (possibly reduced) A otherwise.
    if (this.pass != null)
      this.pass.setViewport(0, 0, this.frameWarp ? this.natW : this.offW, this.frameWarp ? this.natH : this.offH, 0.0, 1.0)

    // Packed ortho vec4 [2/w, -2/h, -1, 1] mapping logical pixels -> clip (top-left origin, y down),
    // matching GL.set2D/scr.ts. 2D coords are logical (vid.state.width/height), same as WebGL.
    const w = vid.state.width || 1
    const h = vid.state.height || 1
    this.orthoData[0] = 2.0 / w
    this.orthoData[1] = -2.0 / h
    this.orthoData[2] = -1.0
    this.orthoData[3] = 1.0
    this.device.queue.writeBuffer(this.orthoBuf, 0, this.orthoData.buffer, 0, 16)
  }

  // Full-screen view tint (underwater/damage/powerup/item pickup) — v.blend as a translucent colored
  // quad over the view rect, in the 2D pass (under the HUD), matching WebGLRenderer.polyBlend. v.blend
  // rgb is 0-255 (ubyte scale, like the WebGL Fill quad); /255 for the float colored pipeline; a is 0-1.
  polyBlend(rgba: number[]): void {
    if (this.device == null) return
    if (r.cvr.polyblend.value === 0) return
    if (rgba[3] === 0.0) return
    const vrect = r.state.refdef.vrect
    this.pushColoredQuad(vrect.x, vrect.y, vrect.width, vrect.height,
      rgba[0] / 255, rgba[1] / 255, rgba[2] / 255, rgba[3])
  }

  // ---- 2D / HUD textured primitives ----

  // Font glyph from the conchars atlas (draw.state.char_texture). Geometry matches draw.char +
  // streamDrawTexturedQuad: (x,y,size,size) with the caller-computed cell UVs.
  drawCharacter(x: number, y: number, size: number, u1: number, v1: number, u2: number, v2: number): void {
    if (this.device == null) return
    this.pushTexQuad(x, y, size, size, u1, v1, u2, v2, draw.state.char_texture as unknown as TexSource)
  }

  // Pic sized by pic.width/height (× scale), UVs 0..1 — matches draw.pic's streamDrawTexturedQuad.
  drawPic(x: number, y: number, pic: Pic, scale = 1): void {
    if (this.device == null) return
    this.pushTexQuad(x, y, pic.width * scale, pic.height * scale, 0.0, 0.0, 1.0, 1.0, pic)
  }

  // Colormap-remapped pic (player skin top/bottom colors), used by the multiplayer Setup menu preview.
  // The WebGL path mixes a base texture + a translate-mask texture in the PicTranslate fragment shader;
  // here we CPU-remap the 64×64 index buffer (pic.translateData, retained in m.ts) into an rgba texture
  // and draw it as a normal textured quad — no dedicated pipeline. Cached per (top,bottom); this is a
  // menu-only element redrawn each frame but with a tiny handful of color combos.
  drawPicTranslate(x: number, y: number, pic: Pic, top: number, bottom: number, scale = 1): void {
    if (this.device == null) return
    const idx = pic.translateData
    if (idx == null) { this.drawPic(x, y, pic, scale); return }   // no remap source → plain base pic
    const key = ((top & 0xff) << 8) | (bottom & 0xff)
    let src = this.picTransCache.get(key)
    if (src == null) {
      src = this.buildPicTranslate(idx, top, bottom)
      this.picTransCache.set(key, src)
    }
    this.pushTexQuad(x, y, pic.width * scale, pic.height * scale, 0.0, 0.0, 1.0, 1.0, src)
  }

  // Reproduce the PicTranslate fragment shader on the CPU: top-range (index 0x1N) → uTop*intensity,
  // bottom-range (0x6N) → uBottom*intensity, everything else the base palette color. Matches the WebGL
  // uniforms (color * 1/191.25, intensity = (index&15)*17/255, clamped). Palette index 255 → transparent.
  private buildPicTranslate(idx: Uint8Array, top: number, bottom: number): TexSource {
    const pal = vid.d_8to24table
    const n = idx.length
    const dim = Math.sqrt(n) | 0
    const rgba = new Uint8Array(n * 4)
    const s = 1.0 / 191.25
    const tp = pal[top], bp = pal[bottom]
    const tr = (tp & 0xff) * s, tg = ((tp >> 8) & 0xff) * s, tb = ((tp >> 16) & 0xff) * s
    const br = (bp & 0xff) * s, bg = ((bp >> 8) & 0xff) * s, bb = ((bp >> 16) & 0xff) * s
    for (let i = 0; i < n; i++) {
      const p = idx[i], o = i << 2, hi = p >> 4
      if (hi === 1) {
        const t = ((p & 15) * 17) / 255
        rgba[o]   = Math.min(1, tr * t) * 255
        rgba[o+1] = Math.min(1, tg * t) * 255
        rgba[o+2] = Math.min(1, tb * t) * 255
        rgba[o+3] = 255
      } else if (hi === 6) {
        const t = ((p & 15) * 17) / 255
        rgba[o]   = Math.min(1, br * t) * 255
        rgba[o+1] = Math.min(1, bg * t) * 255
        rgba[o+2] = Math.min(1, bb * t) * 255
        rgba[o+3] = 255
      } else {
        const c = pal[p]
        rgba[o]   = c & 0xff
        rgba[o+1] = (c >> 8) & 0xff
        rgba[o+2] = (c >> 16) & 0xff
        rgba[o+3] = (p === 255) ? 0 : 255
      }
    }
    return { rgba, rgbaW: dim, rgbaH: dim }
  }

  // Scrolled console background: conback drawn at y = lines - height, full logical width/height,
  // UVs 0..1 — matches draw.consoleBackground's streamDrawTexturedQuad.
  drawConsoleBackground(lines: number): void {
    if (this.device == null) return
    const cb = draw.state.conback
    if (cb == null) return
    this.pushTexQuad(0, lines - (vid.state.height || 1), vid.state.width || 1, vid.state.height || 1,
      0.0, 0.0, 1.0, 1.0, cb as unknown as TexSource)
  }

  // Solid rect filled with palette color index `c` (d_8to24table is packed 0xBBGGRR).
  drawFill(x: number, y: number, w: number, h: number, c: number): void {
    if (this.device == null) return
    const v = vid.d_8to24table[c]
    const r = (v & 0xff) / 255
    const gg = ((v >> 8) & 0xff) / 255
    const b = ((v >> 16) & 0xff) / 255
    this.pushColoredQuad(x, y, w, h, r, gg, b, 1.0)
  }

  // Full-screen translucent black quad behind menus. Alpha 204/255 matches draw.ts's WebGL fadeScreen.
  fadeScreen(): void {
    if (this.device == null) return
    this.pushColoredQuad(0, 0, vid.state.width || 1, vid.state.height || 1, 0, 0, 0, 204 / 255)
  }

  // Open (or continue) a run of the given kind/texture. Returns false only on run-table overflow.
  private beginRun(kind: number, tex: TexSource | null): boolean {
    if (this.runN > 0 && this.curKind === kind && this.curTex === tex)
      return true
    if (this.runN >= MAX_RUNS)
      return false
    const i = this.runN++
    this.runKind[i] = kind
    this.runTex[i] = tex
    this.runFirst[i] = kind === RUN_COLORED ? this.batchVerts : this.texBatchVerts
    this.runCount[i] = 0
    this.curKind = kind
    this.curTex = tex
    return true
  }

  private pushColoredQuad(x: number, y: number, w: number, h: number, r: number, g_: number, b: number, a: number): void {
    if (this.batchVerts + VERTS_PER_QUAD > MAX_QUADS * VERTS_PER_QUAD) return
    if (!this.beginRun(RUN_COLORED, null)) return
    const x2 = x + w, y2 = y + h
    const buf = this.batch
    let o = this.batchVerts * FLOATS_PER_VERT
    // tri 1: (x,y) (x,y2) (x2,y) ; tri 2: (x2,y) (x,y2) (x2,y2) — same winding as streamDrawColoredQuad
    buf[o++] = x;  buf[o++] = y;  buf[o++] = r; buf[o++] = g_; buf[o++] = b; buf[o++] = a
    buf[o++] = x;  buf[o++] = y2; buf[o++] = r; buf[o++] = g_; buf[o++] = b; buf[o++] = a
    buf[o++] = x2; buf[o++] = y;  buf[o++] = r; buf[o++] = g_; buf[o++] = b; buf[o++] = a
    buf[o++] = x2; buf[o++] = y;  buf[o++] = r; buf[o++] = g_; buf[o++] = b; buf[o++] = a
    buf[o++] = x;  buf[o++] = y2; buf[o++] = r; buf[o++] = g_; buf[o++] = b; buf[o++] = a
    buf[o++] = x2; buf[o++] = y2; buf[o++] = r; buf[o++] = g_; buf[o++] = b; buf[o++] = a
    this.batchVerts += VERTS_PER_QUAD
    this.runCount[this.runN - 1] += VERTS_PER_QUAD
  }

  // Push one textured quad. No per-call allocation: verts are written straight into texBatch by index,
  // matching streamDrawTexturedQuad's winding exactly.
  private pushTexQuad(x: number, y: number, w: number, h: number,
    u: number, v: number, u2: number, v2: number, src: TexSource | null): void {
    if (src == null) return
    if (this.ensureTexture(src) == null) return   // no rgba yet / upload failed → skip
    if (this.texBatchVerts + VERTS_PER_QUAD > MAX_QUADS * VERTS_PER_QUAD) return
    if (!this.beginRun(RUN_TEXTURED, src)) return
    const x2 = x + w, y2 = y + h
    const buf = this.texBatch
    let o = this.texBatchVerts * TEX_FLOATS_PER_VERT
    buf[o++] = x;  buf[o++] = y;  buf[o++] = u;  buf[o++] = v
    buf[o++] = x;  buf[o++] = y2; buf[o++] = u;  buf[o++] = v2
    buf[o++] = x2; buf[o++] = y;  buf[o++] = u2; buf[o++] = v
    buf[o++] = x2; buf[o++] = y;  buf[o++] = u2; buf[o++] = v
    buf[o++] = x;  buf[o++] = y2; buf[o++] = u;  buf[o++] = v2
    buf[o++] = x2; buf[o++] = y2; buf[o++] = u2; buf[o++] = v2
    this.texBatchVerts += VERTS_PER_QUAD
    this.runCount[this.runN - 1] += VERTS_PER_QUAD
  }

  // Lazily create + cache the GPUTexture and its bind group for a Pic / conchars object carrying
  // rgba/rgbaW/rgbaH (retained at texture-creation time, WebGPU-only). Reused across frames.
  private ensureTexture(src: TexSource | null): TexEntry | null {
    if (src == null) return null
    const cached = this.texCache.get(src)
    if (cached != null) return cached
    const dev = this.device
    if (dev == null || this.texPipeline == null || this.texSampler == null) return null
    if (src.rgba == null || !src.rgbaW || !src.rgbaH) return null
    const w = src.rgbaW | 0, h = src.rgbaH | 0
    const gtex = dev.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    dev.queue.writeTexture(
      { texture: gtex },
      // Cast: TS 5.7+ types a bare Uint8Array as Uint8Array<ArrayBufferLike> (buffer may be shared),
      // which @webgpu/types' GPUAllowSharedBufferSource rejects; the RGBA here is always a plain
      // ArrayBuffer-backed view, so this is safe.
      src.rgba as GPUAllowSharedBufferSource,
      { bytesPerRow: w * 4, rowsPerImage: h },
      { width: w, height: h },
    )
    const entry: TexEntry = {
      tex: gtex,
      bind: dev.createBindGroup({
        layout: this.texPipeline.getBindGroupLayout(1),
        entries: [
          { binding: 0, resource: this.texSampler },
          { binding: 1, resource: gtex.createView() },
        ],
      }),
    }
    this.texCache.set(src, entry)
    return entry
  }

  // World diffuse variant of ensureTexture: same lazy upload + cache, but bound against the world
  // pipeline's group(1) layout and the REPEAT sampler (wall UVs tile past 0..1). The cache key is the
  // WebGLTexture handle, which carries rgba/rgbaW/rgbaH (retained in texture.ts, WebGPU-only).
  // Resolve group1 (diffuse + fullbright) for a world texture. `fbSrc` is the diffuse texture's
  // fullbright split handle (its retained rgba, WebGPU-only) or null when it has none — in which case
  // the fullbright slot binds the shared 1x1 black fallback so the shader's additive fullbright is +0.
  // fbSrc is 1:1 with src (a texture's diffuse and fullbright handles are fixed), so keying the cache
  // by the diffuse src alone is sufficient.
  private ensureWorldTexture(src: TexSource | null, fbSrc: TexSource | null): TexEntry | null {
    if (src == null) return null
    const cached = this.worldTexCache.get(src)
    if (cached != null) return cached
    const dev = this.device
    if (dev == null || this.worldGroup1Layout == null || this.worldSampler == null
        || this.blackLmView == null) return null
    if (src.rgba == null || !src.rgbaW || !src.rgbaH) return null
    const w = src.rgbaW | 0, h = src.rgbaH | 0
    const gtex = dev.createTexture({
      size: { width: w, height: h },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })
    dev.queue.writeTexture(
      { texture: gtex },
      src.rgba as GPUAllowSharedBufferSource,
      { bytesPerRow: w * 4, rowsPerImage: h },
      { width: w, height: h },
    )
    // Fullbright split: upload its own GPUTexture when present, else bind the shared black fallback.
    let fbTex: GPUTexture | null = null
    let fbView: GPUTextureView = this.blackLmView
    if (fbSrc != null && fbSrc.rgba != null && fbSrc.rgbaW && fbSrc.rgbaH) {
      const fw = fbSrc.rgbaW | 0, fh = fbSrc.rgbaH | 0
      fbTex = dev.createTexture({
        size: { width: fw, height: fh },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      })
      dev.queue.writeTexture(
        { texture: fbTex },
        fbSrc.rgba as GPUAllowSharedBufferSource,
        { bytesPerRow: fw * 4, rowsPerImage: fh },
        { width: fw, height: fh },
      )
      fbView = fbTex.createView()
    }
    const entry: TexEntry = {
      tex: gtex,
      fbTex,
      bind: dev.createBindGroup({
        layout: this.worldGroup1Layout,
        entries: [
          { binding: 0, resource: this.worldSampler },
          { binding: 1, resource: gtex.createView() },
          { binding: 2, resource: fbView },
        ],
      }),
    }
    this.worldTexCache.set(src, entry)
    return entry
  }

  // ---- resources (Phase-2 resource layer; not reached yet — WebGL offscreen still owns creation) ----
  createTexture(_desc: unknown): RTexture { throw new Error('WebGPURenderer.createTexture: not yet implemented') }
  createStaticBuffer(_data: ArrayBufferView): RBuffer { throw new Error('WebGPURenderer.createStaticBuffer: not yet implemented') }
  createDynamicBuffer(_byteLength: number): RBuffer { throw new Error('WebGPURenderer.createDynamicBuffer: not yet implemented') }
}
