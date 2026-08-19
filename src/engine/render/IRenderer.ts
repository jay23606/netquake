// The render backend seam (see docs/render-backend-interface.md).
//
// IRenderer is a SUBSYSTEM-level interface, deliberately NOT a per-gl-call abstraction: each
// backend (WebGL2 today, WebGPU later) owns its own resources, pipelines and submission strategy
// and is free to implement the world path however it likes (WebGL streams indices per frame;
// WebGPU runs a compute cull + indirect multidraw). The backend-agnostic CPU scene layer
// (view/refdef, frustum, PVS+mark, per-face visibility stamp, entity list, light animation, fog,
// particle sim, load-time model/lightmap build) stays single-sourced OUTSIDE this interface and
// feeds it data.
//
// PHASE 0 SCAFFOLD: these signatures are the starting contract. They are intentionally coarse and
// will be firmed up slice-by-slice during the Phase-1 extraction (each slice pins the exact params
// as it moves the corresponding gl.* code out of r.ts/draw.ts/etc. into WebGLRenderer). Prefer
// tightening a signature during extraction over inventing speculative detail here.

import { Entity } from '../types/Entity'
import { Model } from '../types/Model'
import { Pic } from '../texture'

// ---- opaque GPU resource handles (the resource layer that does not exist yet) ----
// Backends return their own concrete implementations; the scene/asset layer treats these as opaque.
export interface RTexture { readonly __rtexture: unique symbol }
export interface RBuffer { readonly __rbuffer: unique symbol }
export interface RRenderTarget { readonly __rtarget: unique symbol }

// ---- per-frame / per-scene data the scene layer hands the backend ----

// What perspective() broadcasts to every program today (view basis + projection + gamma).
export interface FrameGlobals {
  viewOrigin: Float32Array   // vec3
  viewAngles: Float32Array   // mat3
  perspective: Float32Array  // mat4
  vpn: Float32Array          // vec3 (forward, for particle point-size)
  gamma: number
}

export interface SceneSetup {
  // viewport rect within the target
  x: number; y: number; width: number; height: number
  // underwater full-screen warp: when true the scene renders into the warp render target and
  // endScene() resolves it with the distortion blit.
  dowarp: boolean
}

// The shared per-face visibility products (r.markWorldFrustum stamp + flattened chains + prebuilt
// per-face index ranges). WebGL consumes these to stream indices; WebGPU uploads them for the
// compute cull. Concrete typed-array shapes are pinned during the world-surface extraction slice.
export interface FaceVis {
  visibleFrame: Int32Array   // surfVisibleFrame[]; face is visible when === stampFrame
  stampFrame: number
  chainFaces: Int32Array     // worldChainFaces[]
  chainOfs: Int32Array       // worldChainOfs[] per texture
  chainCount: Int32Array     // worldChainCount[] per texture
}

// Which surface worker/program variant to run (mirrors today's three workers + sky).
export type SurfacePass = 'solid' | 'litwater' | 'turb'

export interface IRenderer {
  readonly backend: 'webgpu' | 'webgl2'

  // ---- lifecycle ----
  init(canvas: HTMLCanvasElement): Promise<void>
  resize(width: number, height: number): void
  // Create the backend's static per-session GPU resources, called once from r.init. WebGL2 builds its
  // 3D shader programs, the underwater warp FBO, the index batcher, and the flashblend dlight VBO;
  // WebGPU no-ops (it builds its pipelines/targets in its own init). The shared cvar/command registration
  // and the texture/particle/sky factory setup stay in r.init.
  initResources(): void
  // Reallocate the underwater warp render target to the current r.state.warpwidth/warpheight (set in
  // scr.calcRefdef) when they change. WebGL2 resizes the warp FBO's color texture + depth renderbuffer
  // and re-checks completeness; WebGPU no-ops (its warp path uses its own offscreen targets).
  resizeWarp(): void
  // True when this frame's world visibility comes from the GPU compute cull (WebGPU with r_gpucull on and
  // the per-map cull data built) — r.renderScene then SKIPS the CPU markSurfaces/markWorldFrustum walk
  // (keeping only the efrag gather) instead of duplicating the culling. Always false on WebGL2.
  gpuCullActive(): boolean
  // globals optional for now: the perspective/gamma broadcast still runs inside beginScene during
  // the frame-skeleton slice; FrameGlobals is consumed in a later slice (leave a TODO).
  beginFrame(globals?: FrameGlobals): void
  endFrame(): void
  // Block until the current frame's GPU work is complete, so a screenshot (canvas.toDataURL, taken right
  // after endFrame) reads finished pixels. WebGL2 calls gl.finish(); WebGPU no-ops (endFrame already
  // submitted the frame and blitted it to the swapchain — the canvas holds it for the sync toDataURL read).
  finishFrame(): void
  // Clear the frame's color and/or depth. Called from r.renderView (the main frame clear before the
  // scene, and the skyroom depth-reset between the skyroom and main passes). WebGL2 issues gl.clear;
  // WebGPU no-ops (it clears its render targets via each pass's loadOp).
  clearFrame(color: boolean, depth: boolean): void

  // ---- 3D scene (r.renderScene order) ----
  // globals carries what perspective() computes/broadcasts (view origin/angles/projection/vpn/gamma).
  // The WebGL2 backend ignores it (its own beginScene calls a local perspective() to push the uniforms
  // per program, unchanged); the WebGPU backend uploads it to a per-frame uniform buffer the world vertex
  // shader reads. Optional so callers that don't produce globals still compile.
  beginScene(scene: SceneSetup, globals?: FrameGlobals): void
  // faces optional for now: the WebGL2 backend reads the per-face visibility products directly off
  // model.* (worldChainFaces/Ofs/Count, surfVisibleFrame) + r.state.frustumFrame, exactly as the
  // original r.ts workers did. FaceVis is the shape the WebGPU slice will upload; TODO(phase1) thread
  // it through once a backend actually consumes the struct instead of reaching model/r.state.
  drawSky(faces?: FaceVis): void
  drawViewModel(ent: Entity): void
  // pass selects the surface worker: 'solid' (Brush) | 'litwater' (Brush uWarp=1) | 'turb' (Turbulent).
  // The world/model chain is derived from ent (null ⇒ world chain, else the entity's model chain),
  // mirroring the two original call sites (renderScene passes null+world, drawBrushModel passes ent+model).
  drawWorldSurfaces(model: Model, ent: Entity | null, pass: SurfacePass, faces?: FaceVis): void
  // Opaque brush-entity fast path: draw an alpha==1 entity whose PURE-SOLID submodel is precompute-
  // eligible (Model.brushPrecomputeEligible), skipping drawBrushModel's per-frame per-face CPU backface
  // walk. r.drawBrushModel calls this in place of the 3 drawWorldSurfaces passes for such entities. Both
  // backends implement it (WebGPU from its texture-grouped index set, WebGL from a lazily-built static
  // per-lightmap-page buffer).
  drawBrushEntPrecomputed(ent: Entity): void
  // GPU-driven brush-entity path (WebGPU r_gpucullents): record an already-frustum-culled brush entity
  // for the frame's instanced batch instead of drawing it now. Returns true when the entity is consumed;
  // false means "not eligible", and r.drawBrushModel falls through to the precompute/chain paths below
  // it. WebGL always returns false.
  batchBrushEnt(ent: Entity): boolean
  drawEntities(alphaPass: boolean): void
  drawFlashblendDlights(): void
  drawClassicParticles(): void
  drawScriptParticles(): void
  endScene(): void

  // ---- 2D / HUD ----
  // ortho optional for now: begin2D delegates to GL.set2D() which uses GL's own ortho matrix
  // (leave a TODO to thread the matrix through).
  begin2D(ortho?: Float32Array): void
  // rgba is the engine's persistent view-blend array (v.blend), a plain number[] today.
  polyBlend(rgba: number[]): void

  // ---- 2D / HUD primitives ----
  // These hold ONLY the per-primitive gl submission (program bind + tx.bind + stream quad + any
  // uniform pushes). The backend-agnostic 2D logic stays single-sourced in draw.ts: the glyph-atlas
  // UV math, the string iteration, and the char_texture/conback texture CREATION. A WebGPU backend
  // implements the same set. draw.ts's public functions (char/character/string/stringWhite/pic/
  // picTranslate/consoleBackground/fill/fadeScreen) are thin wrappers over these — their callers
  // (sbar/m/console/scr) keep calling draw.* unchanged.

  // One glyph quad from the char atlas. draw.ts computes the cell UVs from the glyph index (the char
  // UV math stays there) and passes them in; the method binds the Pic program + char_texture and
  // streams the quad. Called per-character in the string loops — scalars only, no per-glyph alloc.
  drawCharacter(x: number, y: number, size: number, u1: number, v1: number, u2: number, v2: number): void
  // A cached pic at x,y, its own width/height times `scale`.
  drawPic(x: number, y: number, pic: Pic, scale?: number): void
  // Colormapped pic (PicTranslate program) with top/bottom palette indices (scoreboard faces).
  drawPicTranslate(x: number, y: number, pic: Pic, top: number, bottom: number, scale?: number): void
  // The console background pic slid `lines` px down from the top of the screen.
  drawConsoleBackground(lines: number): void
  // Solid rect filled with palette color index `c`.
  drawFill(x: number, y: number, w: number, h: number, c: number): void
  // Full-screen translucent black quad behind menus.
  fadeScreen(): void

  // ---- resources ----
  createTexture(desc: unknown): RTexture
  createStaticBuffer(data: ArrayBufferView): RBuffer
  createDynamicBuffer(byteLength: number): RBuffer
}
