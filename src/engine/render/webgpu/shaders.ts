// WGSL shader sources for the WebGPU backend (see docs/render-backend-interface.md).
// Kept as plain strings so the backend stays a single self-contained module during bring-up.
//
// Scene-wide fog (params.z = density/64, fogColor.rgb, and the fogCoord = pos.w varying) is the GL_EXP2
// port of QSS-M's Fog_EnableGFog. Every pipeline drawing solid scene geometry repeats WORLD_WGSL's two
// fog lines verbatim, before the final gamma, or models stop matching the world they stand on:
// WORLD/LITWATER/TURB, the three ALIAS variants, SPRITE and PARTICLE. Deliberately absent from
// SKY/SKYCHAIN/SKYCUBE (r_skyfog blends those separately), PSCRIPT (QSS-M disables fog for additive
// script particles), BLIT/BLIT_WARP (post-process of an already-fogged scene) and every 2D/HUD pipeline.
// Zero density makes exp(0) = 1, so the mix is an unbranched no-op.

// Colored-quad pipeline: interleaved [x,y, r,g,b,a] verts multiplied by a packed ortho vec4.
// ortho = [2/w, -2/h, -1, 1] so clip.x = x*(2/w) - 1, clip.y = y*(-2/h) + 1 — origin top-left,
// x right, y down (matches GL.set2D / scr.ts: ortho[0]=2/w, ortho[5]=-2/h, tx=-1, ty=1).
export const QUAD_WGSL = `
struct Ortho { m: vec4<f32> };
@group(0) @binding(0) var<uniform> ortho: Ortho;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) color: vec4<f32>,
};

@vertex
fn vs_main(@location(0) xy: vec2<f32>, @location(1) color: vec4<f32>) -> VOut {
  var out: VOut;
  out.pos = vec4<f32>(xy.x * ortho.m.x + ortho.m.z, xy.y * ortho.m.y + ortho.m.w, 0.0, 1.0);
  out.color = color;
  return out;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  return in.color;
}
`

// Textured-quad pipeline: interleaved [x,y, u,v] verts. Position maps through the same packed ortho
// vec4 as QUAD_WGSL; the fragment samples the bound atlas/pic directly (no tint — font glyphs and
// pics use the texture color as-is, matching draw.ts's Pic program). group(0)=ortho uniform,
// group(1)={sampler, texture}.
export const TEXQUAD_WGSL = `
struct Ortho { m: vec4<f32> };
@group(0) @binding(0) var<uniform> ortho: Ortho;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@location(0) xy: vec2<f32>, @location(1) uv: vec2<f32>) -> VOut {
  var out: VOut;
  out.pos = vec4<f32>(xy.x * ortho.m.x + ortho.m.z, xy.y * ortho.m.y + ortho.m.w, 0.0, 1.0);
  out.uv = uv;
  return out;
}

@group(1) @binding(0) var samp: sampler;
@group(1) @binding(1) var tex: texture_2d<f32>;

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  return textureSample(tex, samp, in.uv);
}
`

// World-surface pipeline (slice 3: static lightmaps + lightstyles + overbright + gamma, plus analytic
// dynamic lights + exponential fog). Replicates vshBrush/fshBrush for the WORLD model, where
// uAngles = identity and uOrigin = 0, so worldPos = Vert:
//   worldPos = Vert
//   eye      = uViewAngles * (worldPos - uViewOrigin)
//   clip     = uPerspective * vec4(eye.x, eye.z, -eye.y, 1.0)   // GL's .xz,-y handedness swizzle
//
// group0: Globals UBO (perspective mat4, view rotation mat3 with columns padded to vec4, view origin,
//   params.x = gl_overbright / params.y = gamma / params.z = fog density (already /64), and fogColor
//   vec4) + LightStyles UBO (the 65-entry uLightStyles[] array, packed as vec4s so it satisfies uniform
//   layout — logical index i lives at styles[i>>2][i&3]; slot 64 is 0) + Dlights UBO (count.x =
//   uNumDlights, posRadius[32] = xyz origin/w radius, color[32] = rgb color/w minlight — the CPU-side
//   r.state.dlight* arrays packed by r.gatherDlights). group1: diffuse sampler + texture. group2: the
//   lightmap sampler + the 4 per-style lightmap texture_2d_arrays (lm0..3; a layer = a lightmap page),
//   bound once for the whole pass — the surface's page is a per-vertex per-slot layer index (in.layers).
//
// The vertex stage blends the 4 lightstyle indices (LMStyles) into per-vertex weights exactly as
// vshBrush (index 64 -> weight 0), and passes worldPos (= posv, identity transform for the world) and
// fogCoord (= gl_Position.w, matching vshBrush's FogFragCoord — the perspective z-remap leaves .w
// untouched, so this equals GL's clip w). The fragment stage reproduces fshBrush exactly (minus the
// fullbright/alpha-test/warp branches not in the solid world pass), in the SAME order:
//   dlight   = clamp(sum over lights of color.rgb*(radius-dist) where (radius-dist) > minlight) * 2/255)
//   lm       = sum(LMTexN.rgb * weightN) + dlight               // dlights add INTO the lightmap
//   result   = diffuse.rgb * clamp(lm, 0, overbright ? 2.0 : 1.0)
//   result   = clamp(result, 0, 1)
//   result   = mix(fogColor.rgb, result, exp(-density^2 * fogCoord^2))   // fog BEFORE gamma
//   result   = pow(result, gamma)                              // fshBrush's final gamma, last
// The perspective matrix is remapped to WebGPU's [0,1] clip-Z on the CPU before upload (beginScene).
export const WORLD_WGSL = `
// shader-cache-bust 2026-07-31a: comment-only change so Dawn's disk pipeline cache (keyed on WGSL source
// hash) recompiles fresh instead of replaying a possibly-poisoned cached artifact. Semantically inert.
struct Globals {
  perspective: mat4x4<f32>,
  viewAngles: mat3x3<f32>,
  viewOrigin: vec3<f32>,
  params: vec4<f32>,   // x = gl_overbright (0/1), y = gamma, z = fog density (already /64)
  fogColor: vec4<f32>, // rgb = fog color, a = 1
};
@group(0) @binding(0) var<uniform> g: Globals;

// uLightStyles[65] packed 4-per-vec4 (uniform arrays pad scalar elements to 16B, so vec4 packing keeps
// it tight). 17 vec4s = 68 slots; only 0..64 are used (64 = the unused-style slot, always 0).
struct LightStyles {
  styles: array<vec4<f32>, 17>,
};
@group(0) @binding(1) var<uniform> ls: LightStyles;

// GPU dlights: count.x = uNumDlights (as float; 0..32). posRadius[i] = xyz origin, w radius. color[i] =
// rgb color (0..1), w minlight. Packed each frame from r.state.dlight* (r.gatherDlights).
struct Dlights {
  count: vec4<f32>,
  posRadius: array<vec4<f32>, 32>,
  color: array<vec4<f32>, 32>,
};
@group(0) @binding(2) var<uniform> dl: Dlights;

// Per-brush-entity transform (dynamic offset): worldPos = angles*Vert + origin. Slot 0 is IDENTITY
// (angles = identity mat3, origin = 0, params.x = 1) — bound by the WORLD pass so worldPos = Vert and
// the solid world stays byte-identical. Each drawn brush entity binds its own slot. params.x is the
// entity alpha driving the fragment's output alpha (1.0 for the world / opaque entities).
struct BrushXform {
  angles: mat3x3<f32>,
  origin: vec4<f32>,
  params: vec4<f32>,   // x = entity alpha
};
@group(3) @binding(0) var<uniform> xf: BrushXform;

fn styleWeight(idx: u32) -> f32 {
  return ls.styles[idx >> 2u][idx & 3u];
}

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) lmuv: vec2<f32>,
  @location(2) w: vec4<f32>,
  @location(3) worldPos: vec3<f32>,
  @location(4) fogCoord: f32,
  // Compact lightmap array-layer per style slot (from world VBO slot 1). Flat-interpolated NATIVE u32:
  // carrying this as a flat f32 varying and converting u32(x + 0.5) in the fragment produced WRONG
  // SAMPLES from textureSampleLevel on some faces (layer index provably 3.0 via debug paint, constant
  // 3u sampled correctly, varying-derived index read another layer — the e1m1 "black third room" bug).
  // Converting once in the VS and passing an integer varying avoids the miscompiled f32→u32 path.
  @location(5) @interpolate(flat) layers: vec4<u32>,
};

@vertex
fn vs_main(
  @location(0) posv: vec3<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) lmuv: vec2<f32>,
  @location(3) lmstyles: vec4<f32>,
  @location(4) layers: vec4<f32>,
) -> VOut {
  var out: VOut;
  out.layers = vec4<u32>(layers + vec4<f32>(0.5));
  let worldPos = xf.angles * posv + xf.origin.xyz;
  let eye = g.viewAngles * (worldPos - g.viewOrigin);
  out.pos = g.perspective * vec4<f32>(eye.x, eye.z, -eye.y, 1.0);
  out.uv = uv;
  out.lmuv = lmuv;
  out.worldPos = worldPos;
  out.fogCoord = out.pos.w;
  out.w = vec4<f32>(
    styleWeight(u32(lmstyles.x + 0.5)),
    styleWeight(u32(lmstyles.y + 0.5)),
    styleWeight(u32(lmstyles.z + 0.5)),
    styleWeight(u32(lmstyles.w + 0.5)),
  );
  return out;
}

@group(1) @binding(0) var samp: sampler;
@group(1) @binding(1) var tex: texture_2d<f32>;
// Fullbright split companion (fshBrush's FullbrightTex): glowing texels as color, the rest black.
// Textures without a fullbright layer bind a 1x1 black fallback, so the add below is a no-op (+0)
// and needs no per-texture flag (mirrors fshBrush's uUseFullbrightTex, which adds fullbrightTex.rgb
// when set and 0 otherwise). Sampled with the UNWARPED diffuse uv (in.uv), exactly as fshBrush uses
// vTexCoords (not diffuseCoords) — so lit-water's warp does not perturb the fullbright lookup.
@group(1) @binding(2) var fbtex: texture_2d<f32>;

// Lightmap-array consolidation: the 4 per-style lightmap layers are now 256x256 texture_2d_arrays
// (one array per style slot; a layer = a lightmap page), bound ONCE for the whole world pass. The surface's
// page reaches here as the per-vertex per-slot compact layer index in.layers[m].
@group(2) @binding(0) var lmsamp: sampler;
@group(2) @binding(1) var lm0: texture_2d_array<f32>;
@group(2) @binding(2) var lm1: texture_2d_array<f32>;
@group(2) @binding(3) var lm2: texture_2d_array<f32>;
@group(2) @binding(4) var lm3: texture_2d_array<f32>;

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let diffuse = textureSample(tex, samp, in.uv);

  // Analytic dynamic lights — mirrors fshBrush's loop exactly: per light, add (radius - dist) in
  // brightness units when it exceeds the light's minlight, then scale by 2/255 and clamp 0..1.
  var dlight = vec3<f32>(0.0);
  let numDlights = i32(dl.count.x + 0.5);
  for (var i = 0; i < 32; i = i + 1) {
    if (i >= numDlights) { break; }
    let posRadius = dl.posRadius[i];
    let colorMin = dl.color[i];
    let add = posRadius.w - distance(in.worldPos, posRadius.xyz);
    if (add > colorMin.w) {
      dlight = dlight + colorMin.rgb * add;
    }
  }
  dlight = clamp(dlight * (2.0 / 255.0), vec3<f32>(0.0), vec3<f32>(1.0));

  let lm = textureSampleLevel(lm0, lmsamp, in.lmuv, in.layers.x, 0.0).rgb * in.w.x
         + textureSampleLevel(lm1, lmsamp, in.lmuv, in.layers.y, 0.0).rgb * in.w.y
         + textureSampleLevel(lm2, lmsamp, in.lmuv, in.layers.z, 0.0).rgb * in.w.z
         + textureSampleLevel(lm3, lmsamp, in.lmuv, in.layers.w, 0.0).rgb * in.w.w
         + dlight;
  let lmCeil = select(1.0, 2.0, g.params.x > 0.5);
  var rgb = diffuse.rgb * clamp(lm, vec3<f32>(0.0), vec3<f32>(lmCeil));
  // fshBrush order: add the fullbright texels AFTER the lightmap multiply, BEFORE the 0..1 clamp
  // (and before fog/gamma). Black fallback for non-fullbright textures makes this +0.
  rgb = rgb + textureSample(fbtex, samp, in.uv).rgb;
  rgb = clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0));

  // Exponential fog (fshBrush): fog = exp(-density^2 * fogCoord^2), mixed BEFORE the final gamma.
  let fog = clamp(exp(-g.params.z * g.params.z * in.fogCoord * in.fogCoord), 0.0, 1.0);
  rgb = mix(g.fogColor.rgb, rgb, fog);

  rgb = pow(rgb, vec3<f32>(g.params.y));
  return vec4<f32>(rgb, xf.params.x);
}
`

// Alpha-tested FENCE variant of WORLD_WGSL (grates/grills/chain-link — def.SURF.drawfence). BYTE-
// IDENTICAL to WORLD_WGSL except for a single leading discard inserted right after the diffuse sample
// (before any lighting), reproducing fshBrush's `if (uUseAlphaTest && result.a < 0.666) discard;`. The
// diffuse upload gives opaque texels alpha 255 and index-255 texels alpha 0 (texture.ts), so the
// index-255 texels are punched out. Derived via string-replace so the two shaders can never drift; the
// replace runs once at module eval (no per-frame cost). Fence is opaque-with-holes: its kept texels
// write depth, so the pipeline that uses this stays depthWrite-on / no-blend, exactly like worldPipeline.
export const WORLD_FENCE_WGSL = WORLD_WGSL.replace(
  'let diffuse = textureSample(tex, samp, in.uv);',
  'let diffuse = textureSample(tex, samp, in.uv);\n  if (diffuse.a < 0.666) { discard; }',
)

// INSTANCED variant of WORLD_WGSL for the GPU-driven brush-entity path (r_gpucullents; Ironwail's
// bmodel instancing, gl_shaders.h world_vertex_shader + WORLD_INSTANCEDATA_BUFFER). Identical lighting,
// fog, lightmap and fullbright maths — the ONLY change is where the transform comes from: group(3) is a
// read-only STORAGE array of the same BrushXform struct instead of one dynamic-offset uniform window, and
// each vertex selects its entity with @builtin(instance_index). One drawIndexed with instanceCount = N
// then draws N copies of a brush model (Ironwail merges runs of entities sharing a qmodel_t the same way).
//
// The instance index reaches the fragment as a FLAT u32 varying which re-reads the record (exactly what
// ALIAS_INST_WGSL does) — never as an f32 varying converted back to an integer, which is the Dawn
// miscompile that produced the "black lightmaps" bug.
//
// Derived by string-replace off WORLD_WGSL so the two can never drift; the replaces run once at module
// eval (no per-frame cost). Every anchor below occurs exactly once in WORLD_WGSL.
// The multi-line anchors are matched with \r?\n so the derivation is immune to the checked-out line
// endings (this file is CRLF on Windows; a literal \n anchor silently matches nothing and would ship an
// un-instanced shader).
export const WORLD_INST_WGSL = WORLD_WGSL
  .replace(
    '@group(3) @binding(0) var<uniform> xf: BrushXform;',
    '@group(3) @binding(0) var<storage, read> insts: array<BrushXform>;',
  )
  .replace(
    /( {2}@location\(5\) @interpolate\(flat\) layers: vec4<u32>,\r?\n)\};/,
    '$1  @location(6) @interpolate(flat) ii: u32,\n};',
  )
  .replace(
    /( {2}@location\(4\) layers: vec4<f32>,\r?\n)\) -> VOut \{\r?\n {2}var out: VOut;/,
    '$1  @builtin(instance_index) ii: u32,\n) -> VOut {\n'
      + '  var out: VOut;\n  let xf = insts[ii];\n  out.ii = ii;',
  )
  .replace('return vec4<f32>(rgb, xf.params.x);', 'return vec4<f32>(rgb, insts[in.ii].params.x);')

// Alpha-tested FENCE variant of the instanced world shader — the same single leading discard
// WORLD_FENCE_WGSL adds, applied to WORLD_INST_WGSL.
export const WORLD_INST_FENCE_WGSL = WORLD_INST_WGSL.replace(
  'let diffuse = textureSample(tex, samp, in.uv);',
  'let diffuse = textureSample(tex, samp, in.uv);\n  if (diffuse.a < 0.666) { discard; }',
)

// Lit-water pipeline (world slice 4): the WebGL Brush shader with uWarp=1 (drawTextureChains_litwater).
// Identical to WORLD_WGSL — same group0 (globals+lightstyles+dlights), group1 (diffuse), group2
// (lightmap) — so it reuses the exact same lighting (lightmap/lightstyles/overbright/dlights/fog). Two
// differences replicate fshBrush's water path: (1) the DIFFUSE uv is warped by fshBrush's turbulent
// formula (the LIGHTMAP uv, in.lmuv, stays UNWARPED); (2) the final color's alpha is the per-surface
// water alpha (uAlpha), not 1. uTime lives in g.params.w (uploaded once per frame in beginScene =
// host.realtime % 2π, the same source as the GL uWarp/uTime path); uAlpha is delivered via the
// transform group's xf.params.x (packed per water run — the same slot the vertex stage reads for the
// transform), so lit water needs only 4 bind groups. The warp: uv + vec2(sin(uv.y*π+t), sin(uv.x*π+t)) * 0.125
// — GL's .t (=y) drives the x offset and .s (=x) the y offset, exactly as fshBrush.
export const LITWATER_WGSL = `
// shader-cache-bust 2026-07-31a (see WORLD_WGSL note).
struct Globals {
  perspective: mat4x4<f32>,
  viewAngles: mat3x3<f32>,
  viewOrigin: vec3<f32>,
  params: vec4<f32>,   // x = gl_overbright (0/1), y = gamma, z = fog density (already /64), w = uTime (warp phase)
  fogColor: vec4<f32>, // rgb = fog color, a = 1
};
@group(0) @binding(0) var<uniform> g: Globals;

struct LightStyles {
  styles: array<vec4<f32>, 17>,
};
@group(0) @binding(1) var<uniform> ls: LightStyles;

struct Dlights {
  count: vec4<f32>,
  posRadius: array<vec4<f32>, 32>,
  color: array<vec4<f32>, 32>,
};
@group(0) @binding(2) var<uniform> dl: Dlights;

// Per-brush-entity transform (see WORLD_WGSL). Slot 0-style identity for the world; the entity path
// binds the moving brush entity's slot. The lit-water fragment's output alpha is xf.params.x — the
// per-water-run alpha packed into the transform slot (map water alpha for the world, entity water alpha
// for a brush entity), exactly the value the WORLD solid shader outputs as its alpha.
struct BrushXform {
  angles: mat3x3<f32>,
  origin: vec4<f32>,
  params: vec4<f32>,   // x = water alpha
};
@group(3) @binding(0) var<uniform> xf: BrushXform;

fn styleWeight(idx: u32) -> f32 {
  return ls.styles[idx >> 2u][idx & 3u];
}

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) lmuv: vec2<f32>,
  @location(2) w: vec4<f32>,
  @location(3) worldPos: vec3<f32>,
  @location(4) fogCoord: f32,
  // Compact lightmap array-layer per style slot (from world VBO slot 1). Flat-interpolated NATIVE u32:
  // carrying this as a flat f32 varying and converting u32(x + 0.5) in the fragment produced WRONG
  // SAMPLES from textureSampleLevel on some faces (layer index provably 3.0 via debug paint, constant
  // 3u sampled correctly, varying-derived index read another layer — the e1m1 "black third room" bug).
  // Converting once in the VS and passing an integer varying avoids the miscompiled f32→u32 path.
  @location(5) @interpolate(flat) layers: vec4<u32>,
};

@vertex
fn vs_main(
  @location(0) posv: vec3<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) lmuv: vec2<f32>,
  @location(3) lmstyles: vec4<f32>,
  @location(4) layers: vec4<f32>,
) -> VOut {
  var out: VOut;
  out.layers = vec4<u32>(layers + vec4<f32>(0.5));
  let worldPos = xf.angles * posv + xf.origin.xyz;
  let eye = g.viewAngles * (worldPos - g.viewOrigin);
  out.pos = g.perspective * vec4<f32>(eye.x, eye.z, -eye.y, 1.0);
  out.uv = uv;
  out.lmuv = lmuv;
  out.worldPos = worldPos;
  out.fogCoord = out.pos.w;
  out.w = vec4<f32>(
    styleWeight(u32(lmstyles.x + 0.5)),
    styleWeight(u32(lmstyles.y + 0.5)),
    styleWeight(u32(lmstyles.z + 0.5)),
    styleWeight(u32(lmstyles.w + 0.5)),
  );
  return out;
}

@group(1) @binding(0) var samp: sampler;
@group(1) @binding(1) var tex: texture_2d<f32>;
// Fullbright split companion (fshBrush's FullbrightTex): glowing texels as color, the rest black.
// Textures without a fullbright layer bind a 1x1 black fallback, so the add below is a no-op (+0)
// and needs no per-texture flag (mirrors fshBrush's uUseFullbrightTex, which adds fullbrightTex.rgb
// when set and 0 otherwise). Sampled with the UNWARPED diffuse uv (in.uv), exactly as fshBrush uses
// vTexCoords (not diffuseCoords) — so lit-water's warp does not perturb the fullbright lookup.
@group(1) @binding(2) var fbtex: texture_2d<f32>;

// Lightmap-array consolidation: the 4 per-style lightmap layers are now 256x256 texture_2d_arrays
// (one array per style slot; a layer = a lightmap page), bound ONCE for the whole world pass. The surface's
// page reaches here as the per-vertex per-slot compact layer index in.layers[m].
@group(2) @binding(0) var lmsamp: sampler;
@group(2) @binding(1) var lm0: texture_2d_array<f32>;
@group(2) @binding(2) var lm1: texture_2d_array<f32>;
@group(2) @binding(3) var lm2: texture_2d_array<f32>;
@group(2) @binding(4) var lm3: texture_2d_array<f32>;

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  // uWarp=1: warp the DIFFUSE uv only (fshBrush's turbulent formula); lightmap uv stays unwarped.
  let warped = in.uv + vec2<f32>(sin(in.uv.y * 3.141593 + g.params.w),
                                 sin(in.uv.x * 3.141593 + g.params.w)) * 0.125;
  let diffuse = textureSample(tex, samp, warped);

  var dlight = vec3<f32>(0.0);
  let numDlights = i32(dl.count.x + 0.5);
  for (var i = 0; i < 32; i = i + 1) {
    if (i >= numDlights) { break; }
    let posRadius = dl.posRadius[i];
    let colorMin = dl.color[i];
    let add = posRadius.w - distance(in.worldPos, posRadius.xyz);
    if (add > colorMin.w) {
      dlight = dlight + colorMin.rgb * add;
    }
  }
  dlight = clamp(dlight * (2.0 / 255.0), vec3<f32>(0.0), vec3<f32>(1.0));

  let lm = textureSampleLevel(lm0, lmsamp, in.lmuv, in.layers.x, 0.0).rgb * in.w.x
         + textureSampleLevel(lm1, lmsamp, in.lmuv, in.layers.y, 0.0).rgb * in.w.y
         + textureSampleLevel(lm2, lmsamp, in.lmuv, in.layers.z, 0.0).rgb * in.w.z
         + textureSampleLevel(lm3, lmsamp, in.lmuv, in.layers.w, 0.0).rgb * in.w.w
         + dlight;
  let lmCeil = select(1.0, 2.0, g.params.x > 0.5);
  var rgb = diffuse.rgb * clamp(lm, vec3<f32>(0.0), vec3<f32>(lmCeil));
  // fshBrush order: add the fullbright texels AFTER the lightmap multiply, BEFORE the 0..1 clamp
  // (and before fog/gamma). Black fallback for non-fullbright textures makes this +0.
  rgb = rgb + textureSample(fbtex, samp, in.uv).rgb;
  rgb = clamp(rgb, vec3<f32>(0.0), vec3<f32>(1.0));

  let fog = clamp(exp(-g.params.z * g.params.z * in.fogCoord * in.fogCoord), 0.0, 1.0);
  rgb = mix(g.fogColor.rgb, rgb, fog);

  rgb = pow(rgb, vec3<f32>(g.params.y));
  return vec4<f32>(rgb, xf.params.x);
}
`

// Unlit turbulent pipeline (world slice 4): the classic Turbulent program (vshTurbulent/fshTurbulent)
// for water surfaces that are NOT lit water (drawtub && drawtiled, or when r_litwater is off). No
// lightmap and no dlights — just the warped diffuse, global fog, gamma, and per-surface water alpha
// (fshTurbulent carries the same fog as fshBrush, so an unlit pool matches the fogged room around it).
// Reuses group0 (globals: view/perspective + gamma in params.y + fog in params.z/fogColor + uTime in
// params.w) and group1 (diffuse);
// the per-surface water alpha is delivered via the transform group's xf.params.x (packed per water
// run), so turb needs only 3 bind groups. Warp formula + uTime source are identical to fshBrush/LITWATER_WGSL.
export const TURB_WGSL = `
struct Globals {
  perspective: mat4x4<f32>,
  viewAngles: mat3x3<f32>,
  viewOrigin: vec3<f32>,
  params: vec4<f32>,   // y = gamma, z = fog density (already /64), w = uTime (warp phase); x unused here
  fogColor: vec4<f32>, // rgb = fog color
};
@group(0) @binding(0) var<uniform> g: Globals;

// Per-brush-entity transform (see WORLD_WGSL). The classic Turbulent program (like the WebGL path,
// drawTextureChains_water) always draws with the IDENTITY transform even for brush entities, so both
// the world and entity turb paths pack an identity transform; only xf.params.x (the per-water-run
// alpha) varies, and it drives the fragment's output alpha.
struct BrushXform {
  angles: mat3x3<f32>,
  origin: vec4<f32>,
  params: vec4<f32>,   // x = water alpha
};
@group(2) @binding(0) var<uniform> xf: BrushXform;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) fogCoord: f32,
};

@vertex
fn vs_main(@location(0) posv: vec3<f32>, @location(1) uv: vec2<f32>) -> VOut {
  var out: VOut;
  let worldPos = xf.angles * posv + xf.origin.xyz;
  let eye = g.viewAngles * (worldPos - g.viewOrigin);
  out.pos = g.perspective * vec4<f32>(eye.x, eye.z, -eye.y, 1.0);
  out.uv = uv;
  out.fogCoord = out.pos.w;
  return out;
}

@group(1) @binding(0) var samp: sampler;
@group(1) @binding(1) var tex: texture_2d<f32>;

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let warped = in.uv + vec2<f32>(sin(in.uv.y * 3.141593 + g.params.w),
                                 sin(in.uv.x * 3.141593 + g.params.w)) * 0.125;
  var rgb = textureSample(tex, samp, warped).rgb;
  // Exponential fog, byte-identical to WORLD_WGSL's and mixed BEFORE the final gamma.
  let fog = clamp(exp(-g.params.z * g.params.z * in.fogCoord * in.fogCoord), 0.0, 1.0);
  rgb = mix(g.fogColor.rgb, rgb, fog);
  rgb = pow(rgb, vec3<f32>(g.params.y));
  return vec4<f32>(rgb, xf.params.x);
}
`

// Sky depth-prime pipeline (classic scrolling dome, step 1 — the SkyChain program). Renders the
// visible SKY-flagged world surfaces from the world VBO (position only) writing DEPTH ONLY (the color
// target is bound with writeMask 0, so the fragment output is discarded). depthWrite on, depthCompare
// 'less' — this stamps each sky brush face's real depth into the buffer so the far-away dome (drawn
// next with depthCompare 'greater') only fills where a sky surface was, exactly like GL's SkyChain
// colorMask-off pass followed by the depthFunc(GREATER) dome. The vertex transform is identical to the
// world/vshSkyChain path (world uOrigin = 0): eye = viewAngles*(pos - viewOrigin); clip = perspective *
// (eye.x, eye.z, -eye.y, 1). group0 = the world Globals UBO (only binding 0 is read).
export const SKYCHAIN_WGSL = `
struct Globals {
  perspective: mat4x4<f32>,
  viewAngles: mat3x3<f32>,
  viewOrigin: vec3<f32>,
  params: vec4<f32>,
  fogColor: vec4<f32>,
};
@group(0) @binding(0) var<uniform> g: Globals;

@vertex
fn vs_main(@location(0) posv: vec3<f32>) -> @builtin(position) vec4<f32> {
  let eye = g.viewAngles * (posv - g.viewOrigin);
  return g.perspective * vec4<f32>(eye.x, eye.z, -eye.y, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
  return vec4<f32>(0.0, 0.0, 0.0, 0.0);   // discarded: the color target is bound writeMask 0
}
`

// Classic scrolling sky-dome pipeline (step 2 — the Sky program, port of vshSky/fshSky). The dome
// geometry (r.state.skyvecs, 180 verts) is drawn once per octant, each octant selecting a fixed
// per-octant uScale (group1 binding0) that mirrors GL's 8 gl.uniform3f(uScale,...) + drawArrays(0,180)
// calls. depthCompare 'greater' + depthWrite off (GL depthFunc(GREATER)/depthMask(false)): the dome
// sits ~18918 units out (≈ the far plane, depth ≈ 1.0), so 'greater' passes only where the SkyChain
// prime wrote a nearer sky-surface depth and fails against the cleared far value elsewhere — the
// strict '>' is what keeps the dome out of non-sky (cleared-depth == dome-depth) regions, matching GL.
//
// vshSky: position = uViewAngles * (aPosition * uScale * 18918); clip = uPerspective*(pos.xz,-pos.y,1);
//         vTexCoord = aPosition.xy * uScale.xy * 1.5.
// fshSky: alpha = tAlpha(vTexCoord + uTime.x); rgb = mix(tSolid(vTexCoord + uTime.y).rgb, alpha.rgb,
//         alpha.a); rgb = pow(rgb, uGamma). uTime.xy = the two scroll speeds (per frame). group1
//         binding1 carries uTime.xy + gamma (shared across octants, one per-frame upload); group2 =
//         { REPEAT/linear sampler, tSolid, tAlpha }.
export const SKY_WGSL = `
struct Globals {
  perspective: mat4x4<f32>,
  viewAngles: mat3x3<f32>,
  viewOrigin: vec3<f32>,
  params: vec4<f32>,
  fogColor: vec4<f32>,
};
@group(0) @binding(0) var<uniform> g: Globals;

struct SkyScale { v: vec4<f32> };        // xyz = uScale (per octant)
@group(1) @binding(0) var<uniform> sc: SkyScale;
struct SkyTime { v: vec4<f32> };         // x = uTime.x, y = uTime.y, z = uGamma
@group(1) @binding(1) var<uniform> st: SkyTime;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@location(0) aPosition: vec3<f32>) -> VOut {
  var out: VOut;
  let position = g.viewAngles * (aPosition * sc.v.xyz * 18918.0);
  out.pos = g.perspective * vec4<f32>(position.x, position.z, -position.y, 1.0);
  out.uv = aPosition.xy * sc.v.xy * 1.5;
  return out;
}

@group(2) @binding(0) var samp: sampler;
@group(2) @binding(1) var tSolid: texture_2d<f32>;
@group(2) @binding(2) var tAlpha: texture_2d<f32>;

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let alpha = textureSample(tAlpha, samp, in.uv + vec2<f32>(st.v.x));
  var rgb = mix(textureSample(tSolid, samp, in.uv + vec2<f32>(st.v.y)).rgb, alpha.rgb, alpha.a);
  rgb = pow(rgb, vec3<f32>(st.v.z));
  return vec4<f32>(rgb, 1.0);
}
`

// Cubemap-skybox pipeline (modern gfx/env/<name> skyboxes — port of vshSkyCube/fshSkyCube). Draws the
// visible sky-flagged world surfaces (position-only, off the world VBO) sampling a cube texture by the
// fragment's world-space direction, with skyfog. group0 = the shared world Globals UBO (perspective +
// viewAngles + viewOrigin transform, params.y = gamma, fogColor = uFogColor). group1 = { CLAMP/linear
// sampler, cube texture, uSkyFog uniform }. Opaque, real-depth surfaces: depthWrite on / depthCompare
// 'less' (the sky surfaces sit at their true depth), matching the SkyChain prime's depth state.
//
// vshSkyCube: eye = viewAngles*(pos - viewOrigin); clip = perspective*(eye.x, eye.z, -eye.y, 1);
//   vDir = vec3(-(pos.y - viewOrigin.y), pos.z - viewOrigin.z, pos.x - viewOrigin.x)  // (-Δy, Δz, Δx)
// fshSkyCube: color = textureCube(tSky, vDir); rgb = mix(color.rgb, uFogColor, uSkyFog);
//   rgb = pow(rgb, uGamma).
export const SKYCUBE_WGSL = `
struct Globals {
  perspective: mat4x4<f32>,
  viewAngles: mat3x3<f32>,
  viewOrigin: vec3<f32>,
  params: vec4<f32>,   // y = gamma, z = fog density (already /64)
  fogColor: vec4<f32>, // rgb = fog color
};
@group(0) @binding(0) var<uniform> g: Globals;

@group(1) @binding(0) var samp: sampler;
@group(1) @binding(1) var tSky: texture_cube<f32>;
struct SkyFog { v: vec4<f32> };   // x = uSkyFog
@group(1) @binding(2) var<uniform> sf: SkyFog;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) dir: vec3<f32>,
};

@vertex
fn vs_main(@location(0) posv: vec3<f32>) -> VOut {
  var out: VOut;
  let eye = g.viewAngles * (posv - g.viewOrigin);
  out.pos = g.perspective * vec4<f32>(eye.x, eye.z, -eye.y, 1.0);
  let d = posv - g.viewOrigin;
  out.dir = vec3<f32>(-d.y, d.z, d.x);
  return out;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  var color = textureSample(tSky, samp, in.dir);
  let rgb = pow(mix(color.rgb, g.fogColor.rgb, sf.v.x), vec3<f32>(g.params.y));
  return vec4<f32>(rgb, color.a);
}
`

// Alias-model pipeline (monsters/items/weapons/viewmodel — port of vshAlias/fshAlias). Dual-pose
// vertex blend for animation + per-entity lighting (ambient + shade*lightdot), overbright, fullbright
// (skin alpha mask), gamma and per-entity alpha. group0 = the shared world Globals UBO (only
// perspective/viewAngles/viewOrigin + params.y=gamma are read; the viewmodel supplies its own narrowed
// perspective via a separate group0 buffer). group1 = per-entity uniforms (dynamic offset, one 256B
// slot per drawn entity). group2 = { skin sampler, skin texture }.
//
// The vertex transform reproduces vshAlias EXACTLY (uAngles = ent.angles, uOrigin = ent.origin):
//   lerpedPos = mix(p1, p2, blend)
//   position  = viewAngles * (angles * lerpedPos + origin - viewOrigin)
//   clip      = perspective * vec4(position.x, position.z, -position.y, 1.0)   // .xz,-y swizzle
//   lightDot  = mix(dot(n1, lightVec), dot(n2, lightVec), blend)
// The perspective matrix is remapped to WebGPU's [0,1] clip-Z on the CPU before upload (like the world).
//
// The fragment reproduces fshAlias EXACTLY, in order:
//   light  = lightDot * shadeLight + ambientLight
//   if (overbright) light = clamp(light, 0, 1) * 2
//   fb     = fullbrights ? skin.a : 1                       // skin alpha 0 == palette 224-255 fullbright
//   rgb    = skin.rgb * mix(vec3(1), light, fb)
//   rgb    = mix(fogColor.rgb, rgb, exp(-density^2 * fogCoord^2))   // fog BEFORE gamma, as fshBrush
//   rgb    = pow(rgb, gamma)                                // final gamma, last
//   out    = vec4(rgb, alpha)
export const ALIAS_WGSL = `
struct Globals {
  perspective: mat4x4<f32>,
  viewAngles: mat3x3<f32>,
  viewOrigin: vec3<f32>,
  params: vec4<f32>,   // y = gamma, z = fog density (already /64); x/w unused here
  fogColor: vec4<f32>, // rgb = fog color
};
@group(0) @binding(0) var<uniform> g: Globals;

// Per-entity uniforms, one 256B-aligned slot per drawn entity (dynamic offset). The mat3x3 occupies
// bytes 0..47 (3 columns padded to vec4); the rest are vec4s with only .xyz (or params fields) used.
struct Ent {
  angles: mat3x3<f32>,     // rotationMatrix(lerpAngles) * scale
  origin: vec4<f32>,       // xyz = lerpOrigin
  lightVec: vec4<f32>,     // xyz = shade light direction
  ambient: vec4<f32>,      // xyz = uAmbientLight (0..~1.5)
  shade: vec4<f32>,        // xyz = uShadeLight
  params: vec4<f32>,       // x = blend, y = alpha, z = overbright (0/1), w = fullbrights (0/1)
};
@group(1) @binding(0) var<uniform> e: Ent;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) lightDot: f32,
  @location(2) fogCoord: f32,
};

@vertex
fn vs_main(
  @location(0) p1: vec3<f32>,
  @location(1) n1: vec3<f32>,
  @location(2) p2: vec3<f32>,
  @location(3) n2: vec3<f32>,
  @location(4) uv: vec2<f32>,
) -> VOut {
  var out: VOut;
  let blend = e.params.x;
  let lerpedPos = mix(p1, p2, blend);
  let world = e.angles * lerpedPos + e.origin.xyz;
  let position = g.viewAngles * (world - g.viewOrigin);
  out.pos = g.perspective * vec4<f32>(position.x, position.z, -position.y, 1.0);
  out.uv = uv;
  out.lightDot = mix(dot(n1, e.lightVec.xyz), dot(n2, e.lightVec.xyz), blend);
  out.fogCoord = out.pos.w;
  return out;
}

@group(2) @binding(0) var samp: sampler;
@group(2) @binding(1) var tex: texture_2d<f32>;

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let skin = textureSample(tex, samp, in.uv);
  var light = in.lightDot * e.shade.xyz + e.ambient.xyz;
  if (e.params.z > 0.5) {
    light = clamp(light, vec3<f32>(0.0), vec3<f32>(1.0)) * 2.0;
  }
  let fb = select(1.0, skin.a, e.params.w > 0.5);
  var rgb = skin.rgb * mix(vec3<f32>(1.0, 1.0, 1.0), light, fb);
  // Exponential fog, byte-identical to WORLD_WGSL's and mixed BEFORE the final gamma — a model must
  // agree with the surfaces it stands on or it seams against them.
  let fog = clamp(exp(-g.params.z * g.params.z * in.fogCoord * in.fogCoord), 0.0, 1.0);
  rgb = mix(g.fogColor.rgb, rgb, fog);
  rgb = pow(rgb, vec3<f32>(g.params.y));
  return vec4<f32>(rgb, e.params.y);
}
`

// Player-colormapped alias models (MP shirt/pants colors) — ALIAS_WGSL plus the top/bottom
// remap. Port of fshPlayer: the mask texture's R/G carry the top shade+coverage and B/A the
// bottom, and the two mixes replace the skin RGB BEFORE lighting, exactly as in the GL shader.
// The Ent struct gains top/bottom (the 256B slot had the room); everything else is identical.
export const ALIAS_PLAYER_WGSL = `
struct Globals {
  perspective: mat4x4<f32>,
  viewAngles: mat3x3<f32>,
  viewOrigin: vec3<f32>,
  params: vec4<f32>,   // y = gamma, z = fog density (already /64)
  fogColor: vec4<f32>, // rgb = fog color
};
@group(0) @binding(0) var<uniform> g: Globals;

struct Ent {
  angles: mat3x3<f32>,
  origin: vec4<f32>,
  lightVec: vec4<f32>,
  ambient: vec4<f32>,
  shade: vec4<f32>,
  params: vec4<f32>,   // x = blend, y = alpha, z = overbright, w = fullbrights
  top: vec4<f32>,      // xyz = top color    (0..255, scaled in the shader)
  bottom: vec4<f32>,   // xyz = bottom color (0..255)
};
@group(1) @binding(0) var<uniform> e: Ent;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) lightDot: f32,
  @location(2) fogCoord: f32,
};

@vertex
fn vs_main(
  @location(0) p1: vec3<f32>,
  @location(1) n1: vec3<f32>,
  @location(2) p2: vec3<f32>,
  @location(3) n2: vec3<f32>,
  @location(4) uv: vec2<f32>,
) -> VOut {
  var out: VOut;
  let blend = e.params.x;
  let lerpedPos = mix(p1, p2, blend);
  let world = e.angles * lerpedPos + e.origin.xyz;
  let position = g.viewAngles * (world - g.viewOrigin);
  out.pos = g.perspective * vec4<f32>(position.x, position.z, -position.y, 1.0);
  out.uv = uv;
  out.lightDot = mix(dot(n1, e.lightVec.xyz), dot(n2, e.lightVec.xyz), blend);
  out.fogCoord = out.pos.w;
  return out;
}

@group(2) @binding(0) var samp: sampler;
@group(2) @binding(1) var tex: texture_2d<f32>;
@group(2) @binding(2) var playerTex: texture_2d<f32>;

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let skin = textureSample(tex, samp, in.uv);
  let mask = textureSample(playerTex, samp, in.uv);
  var light = in.lightDot * e.shade.xyz + e.ambient.xyz;
  if (e.params.z > 0.5) {
    light = clamp(light, vec3<f32>(0.0), vec3<f32>(1.0)) * 2.0;
  }
  let fb = select(1.0, skin.a, e.params.w > 0.5);
  // 1/191.25 — the GL shader's scale from the 0..255 uniform colors into shaded texture space.
  let remapped = mix(mix(skin.rgb, e.top.xyz * (1.0 / 191.25) * mask.x, mask.y),
                     e.bottom.xyz * (1.0 / 191.25) * mask.z, mask.w);
  var rgb = remapped * mix(vec3<f32>(1.0, 1.0, 1.0), light, fb);
  // Exponential fog, byte-identical to WORLD_WGSL's and mixed BEFORE the final gamma.
  let fog = clamp(exp(-g.params.z * g.params.z * in.fogCoord * in.fogCoord), 0.0, 1.0);
  rgb = mix(g.fogColor.rgb, rgb, fog);
  rgb = pow(rgb, vec3<f32>(g.params.y));
  return vec4<f32>(rgb, e.params.y);
}
`

// Instanced alias models (Ironwail's r_alias instancing): one draw per (model, skin) run, no vertex
// buffers — the model VBO is read as a flat storage array (vertex pulling), so the two pose regions and
// the texcoord region are addressed per instance instead of by three buffer bindings. Fragment math is
// identical to ALIAS_WGSL; the per-entity values come from the instance record, which the fragment
// stage re-reads via the flat instance index (no f32 varyings round-tripped).
export const ALIAS_INST_WGSL = `
struct Globals {
  perspective: mat4x4<f32>,
  viewAngles: mat3x3<f32>,
  viewOrigin: vec3<f32>,
  params: vec4<f32>,   // y = gamma, z = fog density (already /64)
  fogColor: vec4<f32>, // rgb = fog color
};
@group(0) @binding(0) var<uniform> g: Globals;

// 144B per batched entity: ALIAS_WGSL's Ent fields plus this entity's f32-index offsets into the VBO.
struct Inst {
  angles: mat3x3<f32>,   // rotationMatrix(lerpAngles) * scale
  origin: vec4<f32>,     // xyz = lerpOrigin
  lightVec: vec4<f32>,   // xyz = shade light direction
  ambient: vec4<f32>,    // xyz = uAmbientLight
  shade: vec4<f32>,      // xyz = uShadeLight
  params: vec4<f32>,     // x = blend, y = alpha, z = overbright (0/1), w = fullbrights (0/1)
  ofs: vec4<u32>,        // x = pose1, y = pose2, z = texcoords (f32 indices), w unused
};
// Flat array<f32>, not array<vec3>: a vec3 element would carry a 16-byte stride and mis-address the
// packed 24-byte pose vertices.
@group(1) @binding(0) var<storage, read> vbo: array<f32>;
@group(1) @binding(1) var<storage, read> insts: array<Inst>;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) lightDot: f32,
  @location(2) @interpolate(flat) ii: u32,
  @location(3) fogCoord: f32,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var out: VOut;
  let e = insts[ii];
  let a = e.ofs.x + vi * 6u;   // pose vertex: pos vec3 + normal vec3
  let b = e.ofs.y + vi * 6u;
  let t = e.ofs.z + vi * 2u;   // texcoord: vec2
  let p1 = vec3<f32>(vbo[a], vbo[a + 1u], vbo[a + 2u]);
  let n1 = vec3<f32>(vbo[a + 3u], vbo[a + 4u], vbo[a + 5u]);
  let p2 = vec3<f32>(vbo[b], vbo[b + 1u], vbo[b + 2u]);
  let n2 = vec3<f32>(vbo[b + 3u], vbo[b + 4u], vbo[b + 5u]);
  let blend = e.params.x;
  let lerpedPos = mix(p1, p2, blend);
  let world = e.angles * lerpedPos + e.origin.xyz;
  let position = g.viewAngles * (world - g.viewOrigin);
  out.pos = g.perspective * vec4<f32>(position.x, position.z, -position.y, 1.0);
  out.uv = vec2<f32>(vbo[t], vbo[t + 1u]);
  out.lightDot = mix(dot(n1, e.lightVec.xyz), dot(n2, e.lightVec.xyz), blend);
  out.ii = ii;
  out.fogCoord = out.pos.w;
  return out;
}

@group(2) @binding(0) var samp: sampler;
@group(2) @binding(1) var tex: texture_2d<f32>;

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let e = insts[in.ii];
  let skin = textureSample(tex, samp, in.uv);
  var light = in.lightDot * e.shade.xyz + e.ambient.xyz;
  if (e.params.z > 0.5) {
    light = clamp(light, vec3<f32>(0.0), vec3<f32>(1.0)) * 2.0;
  }
  let fb = select(1.0, skin.a, e.params.w > 0.5);
  var rgb = skin.rgb * mix(vec3<f32>(1.0, 1.0, 1.0), light, fb);
  // Exponential fog, byte-identical to WORLD_WGSL's and mixed BEFORE the final gamma — a model must
  // agree with the surfaces it stands on or it seams against them.
  let fog = clamp(exp(-g.params.z * g.params.z * in.fogCoord * in.fogCoord), 0.0, 1.0);
  rgb = mix(g.fogColor.rgb, rgb, fog);
  rgb = pow(rgb, vec3<f32>(g.params.y));
  return vec4<f32>(rgb, e.params.y);
}
`

// Blit pipeline: a fullscreen triangle (3 verts from vertex_index, no vertex buffer) sampling the
// offscreen color target into the swapchain. UV is v-flipped so the top row of the offscreen texture
// (pixel y=0, where the 2D pass drew) lands at the top of the screen.
export const BLIT_WGSL = `
struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VOut {
  var out: VOut;
  let p = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u));
  out.pos = vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2<f32>(p.x, 1.0 - p.y);
  return out;
}

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  return textureSample(tex, samp, in.uv);
}
`

// Warp blit pipeline (underwater full-screen distortion): the same fullscreen-triangle blit as
// BLIT_WGSL — including the v-flip (out.uv = p.x, 1.0 - p.y) so the offscreen 3D target keeps its
// orientation — but the sampled UV is perturbed by fshWarp's underwater sin distortion before the
// sample. warp.params.x = uTime = host.realtime % 2π (the same source WebGLRenderer.endScene pushes
// to the Warp program). The perturbation matches fshWarp exactly: .t (=y) drives the x offset with
// 15.70796 / 0.003125, .s (=x) drives the y offset with 9.817477 / 0.005. group(0) = { sampler,
// source texture, uTime uniform }. Used to warp offscreen A -> offscreen2 B; the 2D HUD then draws
// onto B undistorted.
export const BLIT_WARP_WGSL = `
struct Warp { params: vec4<f32> };   // x = uTime (warp phase)
@group(0) @binding(2) var<uniform> warp: Warp;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VOut {
  var out: VOut;
  let p = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u));
  out.pos = vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
  out.uv = vec2<f32>(p.x, 1.0 - p.y);
  return out;
}

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let t = warp.params.x;
  let uv = in.uv + vec2<f32>(sin(in.uv.y * 15.70796 + t) * 0.003125,
                             sin(in.uv.x * 9.817477 + t) * 0.005);
  return textureSample(tex, samp, uv);
}
`

// Classic id particle pipeline (blood/explosions/sparks/rocket trails/teleport — port of
// vshParticle/fshParticle). Instanced: a static unit-corner quad (slot 0, per-vertex) + a per-instance
// origin(f32x3)+color(unorm8x4) stream (slot 1, 16B stride). The vertex stage reproduces vshParticle
// EXACTLY: view-distance point scale (0.375 near, growing with distance past 20 units), the corner laid
// in the view plane (point.x, 0, point.y) added to the rotated eye offset, then the .xz,-y handedness
// swizzle. The fragment reproduces fshParticle: a round point via smoothstep on the corner length, then
// global fog and final gamma on rgb only (alpha untouched). Standard alpha blend, depth-test 'less'
// (occluded by the world), depth-write off. group0 = 176B { perspective mat4, viewAngles mat3, viewOrigin,
// vpn.xyz + gamma, params (z = fog density), fogColor } — the last two vec4s hold the SAME values as the
// world Globals UBO's params/fogColor (copied wholesale in drawClassicParticles), so params.y duplicates
// the gamma already in vpn.w and params.x/w are inert here.
export const PARTICLE_WGSL = `
struct PGlobals {
  perspective: mat4x4<f32>,
  viewAngles: mat3x3<f32>,
  viewOrigin: vec4<f32>,   // xyz = view origin
  vpn: vec4<f32>,          // xyz = view forward (uVpn), w = gamma
  params: vec4<f32>,       // z = fog density (already /64); x/y/w unused here
  fogColor: vec4<f32>,     // rgb = fog color
};
@group(0) @binding(0) var<uniform> g: PGlobals;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) coord: vec2<f32>,
  @location(1) color: vec3<f32>,
  @location(2) fogCoord: f32,
};

@vertex
fn vs_main(@location(0) corner: vec2<f32>, @location(1) origin: vec3<f32>, @location(2) color: vec4<f32>) -> VOut {
  var out: VOut;
  let offset = origin - g.viewOrigin.xyz;
  let d = dot(offset, g.vpn.xyz);
  let scale = select(0.375 + d * 0.0015, 0.375, d < 20.0);
  let point = corner * scale;
  let position = vec3<f32>(point.x, 0.0, point.y) + g.viewAngles * offset;
  out.pos = g.perspective * vec4<f32>(position.x, position.z, -position.y, 1.0);
  out.coord = corner;
  out.color = color.rgb;
  out.fogCoord = out.pos.w;
  return out;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let a = 1.0 - smoothstep(0.75, 1.0, length(in.coord));
  // Exponential fog, byte-identical to WORLD_WGSL's and mixed BEFORE the final gamma.
  let fog = clamp(exp(-g.params.z * g.params.z * in.fogCoord * in.fogCoord), 0.0, 1.0);
  let rgb = pow(mix(g.fogColor.rgb, in.color, fog), vec3<f32>(g.vpn.w));
  return vec4<f32>(rgb, a);
}
`

// Scripted effectinfo particle pipeline (torches/weather/effectinfo — port of vshPScript/fshPScript).
// Instanced: a static unit-corner quad (slot 0, per-vertex) + a per-instance stream (slot 1, 56B stride:
// origin f32x3, velocity f32x3, size f32, rotation f32, uv f32x4, orientation f32, color unorm8x4). The
// vertex stage reproduces vshPScript's three aOrientation branches EXACTLY: >1.5 = flat quad oriented by
// the velocity-normal basis, >0.5 = camera-relative velocity-stretched spark (with the ~1px min-width
// clamp via g.vup.w = uPixelWidth), else = camera billboard from uVright/uVup; then the atlas UV lerp and
// the .xz,-y swizzle. The fragment reproduces fshPScript: atlas sample * vColor, then final gamma on rgb.
// Three pipeline variants differ ONLY in blend state (alpha / additive / invmod). depth-test 'less',
// depth-write off. group0 = { perspective, viewAngles, viewOrigin, vright, vup+pixelWidth, params.x=gamma };
// group1 = { atlas sampler, atlas texture }.
export const PSCRIPT_WGSL = `
struct PSGlobals {
  perspective: mat4x4<f32>,
  viewAngles: mat3x3<f32>,
  viewOrigin: vec4<f32>,   // xyz
  vright: vec4<f32>,       // xyz = uVright
  vup: vec4<f32>,          // xyz = uVup, w = uPixelWidth
  params: vec4<f32>,       // x = gamma
};
@group(0) @binding(0) var<uniform> g: PSGlobals;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) color: vec4<f32>,
};

@vertex
fn vs_main(
  @location(0) aCorner: vec2<f32>,
  @location(1) aOrigin: vec3<f32>,
  @location(2) aVelocity: vec3<f32>,
  @location(3) aSize: f32,
  @location(4) aRotation: f32,
  @location(5) aUV: vec4<f32>,
  @location(6) aOrientation: f32,
  @location(7) aColor: vec4<f32>,
) -> VOut {
  var out: VOut;
  let halfSize = aSize * 0.5;
  var corner = aCorner;
  if (aRotation != 0.0) {
    let sr = sin(aRotation);
    let cr = cos(aRotation);
    corner = vec2<f32>(aCorner.x * cr - aCorner.y * sr, aCorner.x * sr + aCorner.y * cr);
  }
  var offset: vec3<f32>;
  if (aOrientation > 1.5) {
    let n = aVelocity;
    let h = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 0.0, 1.0), abs(n.z) < 0.9);
    let s = normalize(cross(n, h));
    let t = cross(n, s);
    offset = s * (corner.x * halfSize) + t * (corner.y * halfSize);
  } else if (aOrientation > 0.5) {
    let toCamera = g.viewOrigin.xyz - aOrigin;
    let dist = length(toCamera);
    let across = normalize(cross(toCamera, aVelocity));
    let hw = max(halfSize, dist * g.vup.w);
    offset = across * (aCorner.x * hw) + aVelocity * aCorner.y;
  } else {
    offset = g.vright.xyz * (corner.x * halfSize) + g.vup.xyz * (corner.y * halfSize);
  }
  let worldPos = aOrigin + offset;
  let eyePos = g.viewAngles * (worldPos - g.viewOrigin.xyz);
  out.pos = g.perspective * vec4<f32>(eyePos.x, eyePos.z, -eyePos.y, 1.0);
  out.uv = vec2<f32>(mix(aUV.x, aUV.z, (aCorner.x + 1.0) * 0.5), mix(aUV.y, aUV.w, (aCorner.y + 1.0) * 0.5));
  out.color = aColor;
  return out;
}

@group(1) @binding(0) var samp: sampler;
@group(1) @binding(1) var tex: texture_2d<f32>;

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  var c = textureSample(tex, samp, in.uv) * in.color;
  return vec4<f32>(pow(c.rgb, vec3<f32>(g.params.x)), c.a);
}
`

// Sprite pipeline (explosion/bubble/flame/laser sprites — port of vshSprite/fshSprite). The billboard
// quad verts are built CPU-side in world space (origin + right*w + up*h, from r.state.vright/vup for a
// camera billboard or angleVectors for an oriented sprite — the exact drawSpriteModel math), each vert
// carrying a world position + atlas uv. The vertex stage only applies the view/perspective transform
// with the .xz,-y handedness swizzle (identical to vshSprite); there is NO lighting. The fragment
// samples the frame texture, applies global fog and then final gamma (fshSprite), keeping the texture
// alpha for the alpha blend. group0 = the shared world Globals UBO (only perspective/viewAngles/viewOrigin
// + params.y = gamma / params.z = fog density / fogColor are read; bindings 1/2 of the layout are present
// but unused, like the alias pipeline). group1 = { sprite sampler, frame texture }.
export const SPRITE_WGSL = `
struct Globals {
  perspective: mat4x4<f32>,
  viewAngles: mat3x3<f32>,
  viewOrigin: vec3<f32>,
  params: vec4<f32>,   // y = gamma, z = fog density (already /64); x/w unused here
  fogColor: vec4<f32>, // rgb = fog color
};
@group(0) @binding(0) var<uniform> g: Globals;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
  @location(1) fogCoord: f32,
};

@vertex
fn vs_main(@location(0) posv: vec3<f32>, @location(1) uv: vec2<f32>) -> VOut {
  var out: VOut;
  let position = g.viewAngles * (posv - g.viewOrigin);
  out.pos = g.perspective * vec4<f32>(position.x, position.z, -position.y, 1.0);
  out.uv = uv;
  out.fogCoord = out.pos.w;
  return out;
}

@group(1) @binding(0) var samp: sampler;
@group(1) @binding(1) var tex: texture_2d<f32>;

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  let c = textureSample(tex, samp, in.uv);
  // Exponential fog, byte-identical to WORLD_WGSL's and mixed BEFORE the final gamma.
  let fog = clamp(exp(-g.params.z * g.params.z * in.fogCoord * in.fogCoord), 0.0, 1.0);
  let rgb = mix(g.fogColor.rgb, c.rgb, fog);
  return vec4<f32>(pow(rgb, vec3<f32>(g.params.y)), c.a);
}
`

// Flashblend dynamic-light glow balls (gl_flashblend 1). Ports vsh/fshDlight: instanced fan geometry
// (dir per vertex) scaled by 0.35*radius and offset by the view-transformed light origin, projected with
// the .xz,-y swizzle; orange glow with per-vertex alpha (dir.y * -0.2). Globals struct matches PGlobals's
// first 144 bytes (the particle globals now carry two more vec4s of fog state, which the flashblend glow
// does not read — QSS-M leaves these additive balls unfogged) so the packing prefix is shared.
// gamma is g.vpn.w.
export const DLIGHT_WGSL = `
struct DGlobals {
  perspective: mat4x4<f32>,
  viewAngles: mat3x3<f32>,
  viewOrigin: vec4<f32>,
  vpn: vec4<f32>,          // w = gamma
};
@group(0) @binding(0) var<uniform> g: DGlobals;

struct VOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) alpha: f32,
};

@vertex
fn vs_main(@location(0) dir: vec3<f32>, @location(1) origin: vec3<f32>, @location(2) radius: f32) -> VOut {
  let p = dir * 0.35 * radius + g.viewAngles * (origin - g.viewOrigin.xyz);
  var out: VOut;
  out.pos = g.perspective * vec4<f32>(p.x, p.z, -p.y, 1.0);
  out.alpha = dir.y * -0.2;
  return out;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  return vec4<f32>(1.0, pow(0.5, g.vpn.w), 0.0, in.alpha);
}
`
