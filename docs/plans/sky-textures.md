# Modern Sky Textures (Skybox) Plan

Goal: support modern six-sided skyboxes — the `sky` worldspawn key, the `sky` console
command, `gfx/env/*` images (TGA/PNG/JPG/PCX), and `skyfog` — so custom maps that ship
skyboxes render them instead of falling back to the classic 128×128 scrolling sky.
The classic scrolling sky remains the fallback and must be untouched.

Reference implementation: **Ironwail** (`C:\source\ironwail\Quake`):

- `gl_sky.c` — `Sky_LoadSkyBox` (~line 409), `Sky_NewMap` worldspawn parsing (~line
  560-608), `Sky_SkyCommand_f` (~line 615)
- `gl_shaders.h:915-979` — `sky_cubemap_vertex_shader` / `sky_cubemap_fragment_shader`
  (ignore the `ANIM`/skywind and `DITHER` blocks — out of scope)
- `image.c:112-158` — `Image_LoadImage` format fallback chain
- `gl_rmain.c:112` — `r_skyfog` default (0.5)

## Rendering approach (the key decision)

Do **not** port the old QuakeSpasm "draw 6 giant quads at the far plane" skybox. Ironwail's
better idea fits this codebase perfectly: draw the **actual visible sky surfaces** from the
BSP, and compute the sample direction per pixel as `worldPos - eyePos`, sampling a single
**cubemap** texture. Advantages:

- Reuses the existing `SkyChain` machinery in `r.ts drawSkyBox` (r.ts:2717-2737): the
  texture-chain walk + `batchRender.batchSurface` batching already produce exactly the
  geometry we need.
- When a skybox is active it's **one batched draw with normal depth writes**, replacing
  the current two-pass trick (depth-only mask pass + 12 hemisphere-dome draws with
  `depthFunc(GREATER)`). Less fill, fewer state changes than the classic path.
- No new vertex data: sky surfaces are already in `state.model_vbo` in world space.

WebGL1 note: `samplerCube` is core in WebGL1/GLSL 100 (context here may be either,
GL.ts:431-433). Use `LINEAR` filtering, `CLAMP_TO_EDGE`, **no mipmaps** — skybox faces
are often NPOT, and WebGL1 forbids NPOT mips.

## Current state (do not re-add / do not break)

- Classic sky: `r.ts makeSky` (dome VBO + `Sky`/`SkyChain` programs, r.ts:2673),
  `drawSkyBox` (r.ts:2717), `initSky` (r.ts:2777, uploads solid/alpha layers from the
  BSP sky miptex — called from mod.ts:362).
- `fog.ts` is the module pattern to copy: `state` object, `parseWorldspawn` walking
  `worldmodel.entities` key/value pairs (fog.ts:136-183), `init()` registering a console
  command (fog.ts:236-238), `getColor()`/`getDensity()` accessors.
- `mapAlpha.parseWorldspawn()` + `fog.parseWorldspawn()` are called from `r.newMap`
  (r.ts:1304-1305) — the skybox hook goes right there.
- There is **no** `r_skyfog`/skyfog support anywhere in this branch yet, and no image
  decoders (`com.loadFile` returns a raw `ArrayBuffer` from the asset store).

Execute phases **in order**. Each phase is a separate commit, verified before moving on.

---

## Non-goals (do NOT do these)

- No skywind / animated cubemap layers (Ironwail's `SKYWIND` blocks in gl_sky.c and the
  `ANIM` shader path). Skip every `wind_*` field.
- No 6×2D-texture fallback renderer for mismatched face sizes (Ironwail's
  `Sky_DrawSkyBox` quad path). Instead, mismatched faces are resized at load time
  (see Phase 1) so there is exactly one skybox render path.
- No changes to the classic scrolling-sky rendering: the depth-mask + dome passes in
  `drawSkyBox` must remain byte-for-byte identical when no skybox is loaded. (Lesson
  learned: unrelated rendering changes on BSP2 maps caused surface blinking.)
- No external high-res texture replacement for world/model textures generally — sky
  only.
- No `loadgame`/savegame persistence of the current skybox beyond what worldspawn
  re-parsing provides.

## Hard rules

1. After every phase: `npx tsc --noEmit -p tsconfig.app.json` and `npm run build` must
   pass. Commit per phase, message `sky textures phase N: <summary>`. No
   `Co-Authored-By` trailer.
2. Module state on exported `state` objects only (CLAUDE.md rule). New module `sky.ts`
   follows the `fog.ts` shape exactly.
3. **Zero per-frame allocations** in the render path. All decoding, resizing, cubemap
   upload, string work happens at load time (cold path — allocation fine there).
   Exception: reusing the existing `fog.getColor()` (which allocates) once per sky draw
   matches current engine practice; do not refactor it.
4. Async safety: skybox loading is async (asset store + `createImageBitmap`). A load
   started for map A must not install its texture after map B has begun loading — use a
   generation counter on `sky.state`, incremented by `clear()`/each `loadSkyBox` call;
   compare before installing the GL texture. (Same cancel-token idea as the package
   install pipeline.)
5. Comments: terse, on interface/type declarations only.

---

## Phase 0 — image decoders (`src/engine/image.ts`, new module)

New cold-path module; no GL, no per-frame concerns.

```ts
export type RGBAImage = { width: number, height: number, data: Uint8Array } // RGBA, row 0 = top

export const decodeTGA = (buf: ArrayBuffer): RGBAImage | null
export const decodePCX = (buf: ArrayBuffer): RGBAImage | null
// Tries gfx-style extension fallback like Ironwail image.c:112-158.
// `name` has no extension. Returns null if nothing found/decodable.
export const loadImage = async (name: string): Promise<RGBAImage | null>
```

- `decodeTGA`: support type 2 (uncompressed truecolor) and type 10 (RLE truecolor),
  16/24/32 bpp, plus type 3/11 (greyscale) cheaply. Honor the image-descriptor origin
  bits (bit 5: top-to-bottom) — flip rows so output is always top-down. BGR(A)→RGBA.
  Warn via `con.print` and return null on paletted types (1/9). This covers every
  skybox in the wild.
- `decodePCX`: 8-bit RLE, 768-byte palette at file end (standard Quake PCX). Expand to
  RGBA.
- `loadImage`: for each extension in order `tga, png, jpg, pcx`: `com.loadFile(name +
  '.' + ext)`; on hit, TGA/PCX go through the decoders; PNG/JPG go through
  `createImageBitmap(new Blob([buf]))` drawn into an `OffscreenCanvas` (fall back to a
  regular canvas if `OffscreenCanvas` is undefined) and read back with `getImageData`
  so **every format returns the same `RGBAImage` shape**. (Ironwail tries png first,
  image.c:114; we try tga first because virtually all Quake skyboxes are TGA and each
  miss is an asset-store roundtrip.)
- Console verification for this phase: load a known TGA from a mounted pak via the dev
  console and check dimensions/first pixels; no renderer integration yet.

---

## Phase 1 — `src/engine/sky.ts` (new module, fog.ts as template)

```ts
export const state = {
  name: '',                     // current skybox name, '' = classic sky
  texture: null as WebGLTexture | null,  // cubemap; null = classic sky
  generation: 0,                // async guard (hard rule 4)
  skyfog: 0.5,                  // r_skyfog cvar mirror is read via cvr, this is worldspawn override storage if needed
}
```

### `loadSkyBox(name: string)` — async

Port of `Sky_LoadSkyBox` (`gl_sky.c:409-511`), browser-adapted:

1. `name === state.name` → return (gl_sky.c:417). `name === ''` → drop texture (delete
   GL texture), reset state, classic sky (gl_sky.c:420-423).
2. Bump `state.generation`, capture it. Load all 6 faces concurrently
   (`Promise.all`) via `image.loadImage('gfx/env/' + name + suffix)`, suffixes
   `['rt','bk','lf','ft','up','dn']` (gl_sky.c:408).
3. Any face missing → `con.print` warning, keep classic sky (gl_sky.c:462-466 —
   deviation: Ironwail tolerates partial sets, we require all 6; simpler and partial
   skyboxes are broken content anyway).
4. If generation changed while awaiting → discard silently.
5. Faces must be square and same-size for a cubemap: find the max dimension, and any
   face that differs gets resized with a canvas `drawImage` (cold path).
6. Create the cubemap: face order is **+X=ft, −X=bk, +Y=up, −Y=dn, +Z=rt, −Z=lf** —
   Ironwail's `cubemap_order = {3,1,4,5,0,2}` into the suffix list (gl_sky.c:472),
   paired with the direction swizzle in the shader (Phase 2). Upload each face with
   `texImage2D(TEXTURE_CUBE_MAP_POSITIVE_X + i, ...)`, RGBA/UNSIGNED_BYTE, then set
   LINEAR min/mag, CLAMP_TO_EDGE wrap S/T, no mipmaps.
7. Install: delete previous texture if any, set `state.texture`, `state.name`.

### Worldspawn + commands

- `parseWorldspawn()`: same walk as `fog.parseWorldspawn` (fog.ts:136-183). Keys, per
  `gl_sky.c:595-606`: `sky`, `skyname` (Half-Life), `qlsky` (Quake Live) → `loadSkyBox
  (value)`; no key → `loadSkyBox('')` reset. Also parse `skyfog` (float) and stash it.
- `skyCommand_f`: 1 arg prints current name, 2 args `loadSkyBox(argv[1])`
  (gl_sky.c:615-627). Register `cmd.addCommand('sky', ...)` in `sky.init()`.
- `r_skyfog` cvar (default `'0.5'`, per gl_rmain.c:112) registered in `sky.init()`.
  Effective skyfog for a frame = `clamp(0, r_skyfog.value * (worldspawn skyfog if
  present, else 1), 1)` — check Ironwail's exact precedence in `gl_sky.c` (`skyfog`
  variable) and match it: Fitz semantics are that the worldspawn value *sets* the
  cvar-equivalent for the map. Simplest faithful version: worldspawn `skyfog`
  overwrites the runtime value each map load; `r_skyfog` cvar changes it live.
- `sky.init()` called next to `fog.init()`; `sky.parseWorldspawn()` called in
  `r.newMap` next to `fog.parseWorldspawn()` (r.ts:1304-1305). Map change with no
  worldspawn sky key must clear any previous map's skybox.

Server-driven sky changes (`stuffcmd "sky foo\n"`) work automatically once the command
is registered — no protocol work needed.

---

## Phase 2 — renderer (`r.ts`, `shaders.ts`)

### `SkyCube` program

New shader pair in shaders.ts + `GL.createProgram('SkyCube', ...)` in `makeSky`:

```glsl
// vertex — same construction as vshSkyChain (shaders.ts:247)
uniform vec3 uViewOrigin; uniform mat3 uViewAngles; uniform mat4 uPerspective;
attribute vec3 aPosition;
varying vec3 vDir;
void main(void) {
  vec3 position = uViewAngles * (aPosition - uViewOrigin);
  gl_Position = uPerspective * vec4(position.xz, -position.y, 1.0);
  vDir = vec3(-(aPosition.y - uViewOrigin.y),   // Ironwail swizzle, gl_shaders.h:935-937
                aPosition.z - uViewOrigin.z,
                aPosition.x - uViewOrigin.x);
}

// fragment
precision mediump float;
uniform float uGamma; uniform float uSkyFog; uniform vec3 uFogColor;
uniform samplerCube tSky;
varying vec3 vDir;
void main(void) {
  gl_FragColor = textureCube(tSky, vDir);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, uSkyFog);
  gl_FragColor.rgb = pow(gl_FragColor.rgb, vec3(uGamma));
}
```

(Cubemap lookup doesn't require a normalized direction — no `normalize` needed.)

### `drawSkyBox` (r.ts:2717)

At the top, branch on `sky.state.texture !== null`:

- **Skybox path**: bind `SkyCube`, bind `state.model_vbo` + the same
  `vertexAttribPointer` stride as the SkyChain pass (r.ts:2725-2727), bind the cubemap
  (`gl.TEXTURE_CUBE_MAP` — check `tx.bind` supports the target, else bind manually and
  invalidate tx's cached binding for that unit), set `uSkyFog` (0 when
  `fog.getDensity() <= 0`, else effective skyfog) and `uFogColor` from
  `fog.getColor()`, then run the **identical** texture-chain walk +
  `batchSurface`/`flushBatch` loop already in the function. Normal depth state, color
  writes on, then `return`. No colorMask flip, no dome, no `depthFunc(GREATER)`.
- **Classic path**: existing code, untouched.

Per-frame cost of the skybox path: one program switch, one cubemap bind, four uniform
stores, one batched surface draw — strictly cheaper than the classic two-pass path. No
allocations besides the existing `fog.getColor()` array.

### Cleanup

`r.shutdown` (r.ts:2640-2648 block): delete `sky.state.texture` if present. Also make
sure a `vid_restart`/GL-context-loss path (wherever `makeSky` is re-run) forces a
reload: on context re-init just call `sky.loadSkyBox('')`-style reset and re-request
`sky.state.name` if non-empty.

---

## Phase 3 — verification

1. `npx tsc --noEmit -p tsconfig.app.json` and `npm run build` pass.
2. Classic regression: id1 maps (e1m1) render the scrolling sky pixel-identical to
   before (no skybox present); `oldskyleaf` behavior unchanged; no brush-surface
   blinking on a BSP2 map.
3. Skybox: install a map package that ships `gfx/env/*.tga` (most Quaddicted releases
   with custom skies, e.g. anything using `sky` worldspawn key — check the maps store)
   and verify:
   - Skybox appears, **orientation correct**: sun/horizon features continuous across
     all four side seams, up/down not mirrored. Compare side-by-side with Ironwail
     running the same map. If a face is mirrored/rotated, fix it by flipping that
     face's pixel rows/columns **at load time** in sky.ts — never in the shader.
   - `sky ""` in console returns to classic sky; `sky <name>` swaps live.
   - `r_skyfog 0` / `1` visibly interpolates sky toward fog color on a fogged map.
   - Fast map switch while a skybox is mid-download doesn't install a stale texture
     (generation guard) — test by switching maps immediately after load starts.
   - Missing/partial skybox (bogus `sky garbage` command) warns and keeps classic sky.
4. Perf sanity: on a large BSP2 map with sky visible, fps with skybox ≥ fps with
   classic sky (it should be, given the removed second pass).
