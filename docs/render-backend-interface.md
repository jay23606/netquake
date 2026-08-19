# Render Backend Interface (WebGL2 + WebGPU)

Design for splitting the renderer behind an `IRenderer` seam so a **WebGPU** backend
(Ironwail-style GPU-driven world render) can run alongside the existing **WebGL2** backend,
with WebGL2 as the fallback for browsers without WebGPU.

Status: **Phase 0 + Phase 1 COMPLETE** (WebGL2 renderer extracted behind `IRenderer`, user-verified
in-browser pixel-identical across all slices). **Phase 2 (WebGPU backend) is next.** Branch
`render-backend-interface`.

Phase-1 commits (each an independently-verified, pixel-identical relocation): `7eb008d` frame skeleton
(beginFrame/beginScene/endScene/begin2D/endFrame/polyBlend) → `399286f` world surfaces + sky →
`4827237` entities/alias/sprites/viewmodel → `28d0ee5` particles + flashblend dlights. Preceded by
`ca14e8e` (this doc) and `b677f52` (Phase-0 scaffold). All backend-agnostic CPU scene logic
(view/refdef, frustum, PVS+mark, per-face visibility stamp, entity list, light animation, dlight
gather, particle sim, fog, load-time model/lightmap build) stayed single-sourced in r.ts/pscript.ts;
only gl.* submission moved into src/engine/render/webgl/WebGLRenderer.ts. The WebGLRenderer methods read
the owning modules' state via imports (r.state.*, pscript.state.*) rather than owning render state —
that resource migration is a Phase-2 concern (see §4). Extraction pattern that worked: move whole draw
bodies into module-private fns in WebGLRenderer, replace the r.ts fn with a relocation comment, rewire
the renderScene/updateScreen call site, export any CPU helper the body needs, never name a local `r`
(shadows the module import). 2D/HUD (draw.ts via GL.stream*) was intentionally left as the WebGL
backend's shared primitives — it gets abstracted in Phase 2 when WebGPU needs it.

---

## 1. Why, and the hard constraint

The FPS bottleneck on large maps (immortal-class) is the **CPU render walk**, not physics or
the GPU. Ironwail proves you get high FPS *in-process, latency-free* by moving world culling +
draw-list construction to the GPU (compute shader per-surface cull → `MultiDrawElementsIndirect`).
That path needs compute shaders + indirect multidraw + storage buffers — none of which WebGL2 has,
all of which WebGPU has. This is the only compelling reason to adopt WebGPU here.

**Constraint that shapes everything:** a canvas is either a WebGL context *or* a WebGPU device per
frame — you cannot mix. So a WebGPU backend is a **second complete renderer**: everything that
draws (world, brush models, alias models, sprites, particles, sky, warp/water, fog, 2D/HUD) needs a
WGSL implementation. WebGL2 stays as the fallback. Two renderers, permanently dual-maintained.

Good news from the recon: the world path is **already shaped** for the GPU-driven approach (see §5),
and the shader surface is **15 programs, not ~74**. The refactor is more *untangling* than *rewriting*.

---

## 2. Architecture — three layers

```
┌─ Shared CPU scene layer (backend-agnostic, single-sourced) ───────────────┐
│  view/refdef, frustum, PVS+mark, per-face visibility stamp, entity list,   │
│  light animation, dlight gather, per-entity transform/pose lerp, fog,      │
│  particle sim, model/lightmap LOAD-time build. NEVER calls gl.*/gpu.*      │
└───────────────────────────────┬───────────────────────────────────────────┘
                                 │ produces data + calls
┌───────────────────────────────▼───────────────────────────────────────────┐
│  IRenderer  (the SEAM — subsystem-level, not gl-call-level)                 │
│  beginFrame/beginScene/drawSky/drawWorld*/drawEntities/drawParticles/...    │
│  + a thin resource layer: ITexture / IBuffer / IRenderTarget / IPipeline    │
└───────────────┬──────────────────────────────────┬─────────────────────────┘
     implements │                                   │ implements
┌───────────────▼──────────────┐      ┌─────────────▼──────────────────────────┐
│  WebGLRenderer (today's code, │      │  WebGPURenderer (new, WGSL; world path  │
│  extracted verbatim)          │      │  = compute cull + indirect multidraw)   │
└───────────────────────────────┘      └─────────────────────────────────────────┘
```

**Seam is at the subsystem level, NOT per-gl-call.** A lowest-common-denominator "wrap every
`gl.*`" abstraction forces WebGPU into WebGL's stateful model and strangles the compute payoff —
the whole point. Each backend owns its resources and submission and is free to use a totally
different strategy for the world (WebGL keeps `batchRender`; WebGPU uses compute+indirect).

### 2a. Shared CPU scene layer — stays single-sourced (verified backend-agnostic)

Keep, unchanged, called before/around IRenderer:
- **View/refdef:** `v.calcRefdef`, `v.calcBlend`, `v.driftPitch`, `chase.update`, `scr.calcRefdef` (minus its warp-FBO tail).
- **Frustum + cull:** `r.setFrustum`, `r.cullBox`.
- **PVS + mark:** `r.markSurfaces`, `leafPVS`/`fatPVS`/`noVisPVS`, `markAncestorsVisible`, `chainSurface`, `flattenWorldChains`, `mod.decompressVis`, `visEquals` cache.
- **Per-face visibility:** `r.markWorldFrustum` → `surfVisibleFrame` stamp (frustum + backface).
- **Entity list:** `cl.relinkEntities` (visedicts), `r.storeEfrags`/`splitEntityOnNode`.
- **Lighting:** `r.animateLight` (lightstylevalue), `r.gatherDlights`, `r.lightPoint`/`recursiveLightPoint`/`sampleLightmap`.
- **Per-entity:** `r.setupEntityTransform`, `r.setupAliasFrame` (→ `{pose1ofs, pose2ofs, blend}`).
- **Effects sim:** `r.runParticles`, `pscript.runPScriptParticles`, **all of `fog.ts`**.
- **Load-time build:** `r.buildSurfaceDisplayLists`, `r.buildModelVertexBuffer`, `lightmap.allocBlock`, `mod.ts` model loaders (geometry *shape*; only the trailing GL upload is backend-specific).

The refactor work is that `r.ts` currently **interleaves** this CPU logic with `gl.*` submission in
the same functions (`renderScene`, `drawTextureChains*`, `drawAliasModel`, `drawSkyBox`). Each must
be split: CPU part stays here, submission part moves into `WebGLRenderer`.

---

## 3. The `IRenderer` interface (subsystem-level)

Grouped by the existing frame order (`host._frame → scr.updateScreen → v.renderView → r.renderScene`).
Method names are indicative; exact signatures land in `src/engine/render/IRenderer.ts` in Phase 0.

```ts
interface IRenderer {
  // --- lifecycle / device ---
  init(canvas: HTMLCanvasElement): Promise<void>
  resize(w: number, h: number): void
  beginFrame(view: FrameGlobals): void   // perspective/view/gamma/vpn broadcast + stream begin
  endFrame(): void                       // flush + present

  // --- 3D scene (r.renderScene order) ---
  beginScene(scene: SceneSetup): void    // setupGL: warp-FBO redirect if dowarp, viewport, clear, depth/cull
  drawSky(sky: SkyState, faces: FaceVis): void
  drawViewModel(ent: Entity): void
  drawWorldSolid(model, chain, faces: FaceVis, lm: LightmapState, dlights, fog): void
  drawWorldWater(model, chain, lit: boolean, faces, ...): void        // litwater(Brush uWarp) + turb(Turbulent)
  drawEntities(visedicts, alphaPass: boolean): void                  // dispatches alias/brush/sprite
  drawFlashblendDlights(lights): void
  drawClassicParticles(pool): void
  drawScriptParticles(buckets): void
  endScene(): void                        // warp resolve blit → default target

  // --- 2D / HUD ---
  begin2D(ortho: Mat4): void
  drawPic(...) / drawChar(...) / drawFill(...) / drawPicTranslate(...)   // or expose stream prims
  polyBlend(rgba): void

  // --- resources (thin device layer, see §4) ---
  createTexture(desc): ITexture
  createStaticBuffer(data): IBuffer
  createDynamicBuffer(bytes): IBuffer
  createLightmapPage(slots): ITexture[]
  // pipelines/bind-groups are backend-internal; not exposed to the scene layer
}
```

Notes:
- `FrameGlobals` carries what `perspective()` broadcasts today (view origin/angles, perspective mat,
  gamma, vpn). In WebGPU this becomes a per-frame **uniform buffer**; in WebGL it stays the
  loop-over-programs push. Either way the scene layer just hands over the struct.
- `FaceVis` = the existing `surfVisibleFrame` + `worldChainFaces/Ofs/Count` + `surfIndexData/Ofs/Count`.
  WebGL consumes it via `batchRender`; WebGPU uploads it and lets a compute shader emit draws (§5).
- Dirty-flag uploads (dlights `dlightUniformFrame`, lightstyles `lightstyle_uniform_dirty`) rely on
  **WebGL per-program uniform persistence**. WebGPU must make these explicit UBOs updated per frame.

---

## 4. Resource layer (the part that doesn't exist yet)

`GL.ts` today abstracts only program creation, an immediate-mode quad stream, and instancing shims —
**not** textures, buffers, framebuffers, or state. `r.ts` (449 raw `gl.*`) and `texture.ts` (192)
reach the context directly. So Phase 1 must introduce opaque handles both backends implement:

- **`ITexture`** — wraps texture creation/upload/bind. Absorbs `texture.ts`: the palette 8→24-bit
  expansion (CPU, shared) produces RGBA bytes; the backend does the actual GPU upload. Lightmap
  slot pages, sky split textures, cubemap, conchars all become `ITexture`.
- **`IBuffer`** — static (model VBO, per-face index ranges, sky/particle corner buffers) and dynamic
  (batch IBO, instance buffers, the 2D stream). Backend picks storage/usage flags.
- **`IRenderTarget`** — the water-warp FBO (only offscreen target today) + the default framebuffer.
- **`IPipeline`** — backend-internal: (shaders + vertex layout + depth/blend/cull state). WebGL folds
  state into per-draw calls; WebGPU bakes it into a pipeline object. The 15 programs map to pipelines
  (with state permutations for alpha/fence/warp/overbright as pipeline variants in WebGPU).

No VAOs exist today (attrib pointers re-specified per draw) — *convenient*, because WebGPU encodes
vertex layout in the pipeline anyway.

---

## 5. The world path — the payoff, and why it's narrow

Current world submission (per frame): `markWorldFrustum` stamps `surfVisibleFrame[f]`; then the three
surface workers walk texture chains and, per visible face, `batchRender` copies that face's prebuilt
fan indices into a staging `Uint32Array` and issues one `drawElements` per texture×lightmap-page run.
The **geometry VBO is static**; only the **index stream is rebuilt each frame**.

That means the WebGPU world path replaces exactly **one stage** — "which faces are visible → emit
indices/draw args" — with GPU work, keeping everything else:

| Data (already exists) | WebGL2 use | WebGPU use |
|---|---|---|
| static `model_vbo` (11f/44B) | bound per worker | storage/vertex buffer, unchanged |
| per-face `surfIndexData/Ofs/Count` | CPU copy loop | source ranges for GPU emit |
| `surfVisibleFrame` stamp (CPU) | filter in copy loop | **replaced** by compute cull (PVS bit + frustum on GPU, à la Ironwail `cull_mark`) |
| lightmap slot pages + lightstyle weights | 4 textures + shader blend | same (carries over) |
| analytic dlights (uniform arrays) | Brush shader loop | UBO/storage + same shader loop |

So the WebGPU world path = upload PVS + per-face bounds → compute `cull_mark` (append indices/instances
per texture into indirect commands) → `MultiDrawIndirect`. It's a replacement of the CPU emit stage,
not a rebuild of the world pipeline. Lightmaps/dlights/fog port straight across.

---

## 6. Per-subsystem port notes (from recon)

- **Alias/Player:** one static VBO = texcoord block + per-pose blocks (stride 24). Entity lerp = two
  `vertexAttribPointer` bindings into the same buffer at `pose1ofs`/`pose2ofs` + `mix()` in the vertex
  stage. WGSL must reproduce two vertex-buffer bindings (or one buffer, two attribute sets) + the blend.
  Fullbright via skin-texture **alpha mask** (a=0 for palette 224–255). No instancing here.
- **Sprites:** CPU billboard → 6 verts through the shared stream. Trivial WGSL port.
- **Classic particles:** instanced unit quad, 16B instance (origin + ubyte4 color). Direct WebGPU
  instancing. (WebGL1 stream fallback can be dropped for the WebGPU backend.)
- **Script particles (pscript):** 3 blend-bucket instance buffers, 56B instance, `aOrientation` branches
  (billboard/spark-stretch/flat). Instanced draws per bucket with per-bucket blend state → 3 pipeline
  variants in WebGPU.
- **Dlights:** modern path is a 32-entry uniform array + analytic shader loop (keep the packed
  `dlightPosRadius`/`dlightColor` layout, move to UBO). Flashblend fan is legacy/opt.
- **Sky:** three sub-paths — skyroom depth-only (`colorMask` trick), cubemap (`SkyCube`), classic
  scrolling dome (`depthFunc(GREATER)`, 8 octant `uScale` draws). Each becomes a pipeline; the depth
  tricks map to depth/color write masks in the pipeline state.
- **Warp:** (a) full-screen underwater FBO redirect + blit (`IRenderTarget`), (b) per-surface turb
  (unlit `Turbulent`, or lit via Brush `uWarp=1`).
- **Fog:** cleanest split — all of `fog.ts` is shared; backend only pushes `uFogDensity/uFogColor`
  and does 2 lines of shader math. WebGPU reuses `fog.ts` verbatim.
- **2D/HUD:** already ~all through `GL.stream*`/`useProgram`/`tx.bind`. 3 programs (Fill/Pic/PicTranslate).
  Straight port to a WGSL quad pipeline + dynamic vertex buffer.

---

## 7. Phased plan

**Phase 0 — scaffolding (small, mine):** create `src/engine/render/` with `IRenderer.ts`,
`types.ts` (FrameGlobals/SceneSetup/FaceVis/handles), a `getRenderer()` factory with capability
detection (`navigator.gpu?.requestAdapter()` → WebGPU else WebGL2), and an empty `WebGLRenderer`
shell. No behavior change.

**Phase 1 — extract WebGL2 behind IRenderer (the big grunt-work phase; DELEGATED).** Pure,
behavior-preserving move of `gl.*` submission out of `r.ts`/`draw.ts`/`sky.ts`/`pscript.ts`/`texture.ts`
into `WebGLRenderer`, leaving the CPU scene layer calling through the interface. Verified **pixel-identical**
(WebGPU not involved yet). This is the safe, valuable half and stands on its own. Delegation slices:
1. Resource layer + `texture.ts` → `ITexture`/`IBuffer` handles.
2. 2D/HUD (`draw.ts`, stream) → `begin2D`/`drawPic`/`drawChar`/`drawFill`/`polyBlend`.
3. World surfaces (`drawTextureChains*` + `batchRender` + lightmap bind) → `drawWorldSolid`/`drawWorldWater`.
4. Alias/sprites/entities → `drawEntities`/`drawViewModel`.
5. Effects (particles, dlights, sky, warp) → the effect methods + `beginScene`/`endScene`/FBO.
   Each slice: extract, wire through IRenderer, confirm no visual change, no CPU-logic move.

**Phase 2 — WebGPU backend (DELEGATED, after Phase 1 lands).** Implement `WebGPURenderer` behind the
capability check + a cvar, subsystem by subsystem: **2D/HUD first** (proves device/swapchain/pipeline
plumbing), then alias/particles/sky (mechanical WGSL), then the **world path** (compute `cull_mark` +
indirect multidraw — the payoff, ported from Ironwail `Quake/r_world.c`, local `c:\source\ironwail`).

**Phase 3 — parity + flip.** Verify across the feature maps (overbright, BSPX/decoupled-LM, lit water,
skyroom, MD3, fullbright skins, cubemap sky, lightstyles, fog), then default to WebGPU where available;
WebGL2 stays the fallback.

---

## 8. Risks / gotchas

- **Uniform persistence:** WebGL keeps per-program uniforms between binds (dlights/lightstyles pushed
  once/frame). WebGPU has no such persistence → explicit per-frame UBOs.
- **Palette expansion:** 8-bit indexed → RGBA happens CPU-side (`texture.ts`/`palette.ts`); keep it
  shared, upload RGBA. Fullbright-alpha-mask convention must be preserved.
- **Per-frame index streaming** is the WebGL world submission; don't try to force WebGPU to mimic it —
  WebGPU replaces it with compute+indirect (§5).
- **Coupling debt:** `r.ts` (449 raw `gl.*`) and `texture.ts` (192) are the hard surface; funnel them
  through the resource layer FIRST in Phase 1 or later slices will have nothing to call.
- **Dual maintenance:** every future rendering feature/fix is done twice (or gated). Consider shader
  cross-compilation (Tint/naga) later to cut the WGSL/GLSL duplication.
- **Shared CPU logic must not drift:** the scene layer is single-sourced; a bug there hits both backends
  (good) but a backend-specific submission bug hits only one (isolate in the backend, not the scene layer).
