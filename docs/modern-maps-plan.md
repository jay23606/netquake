# Modern Custom Map Compatibility Plan

**Status (2026-07-19, branch `modern-maps`):** Phases 1, 2a-2c, 3, 4, 5, 6, and 7's
lerplightstyles are implemented and committed (overbright `86cc609`, BSPX parser
`4d29c83`, LMSHIFT `2965ffd`, DECOUPLED_LM `88fb05f`, Kex QC `94056a6`, .scale
`7fac29a`, MD3 `58b661c`, skyroom `e1643e2`, lightstyle lerp `6e00ff2`). Protocol
auto-select is moot: spawnServer always runs RMQ 999/INT32COORD. Remaining: 2d
BRUSHLIST, 2e LIGHTGRID, skyroom server-side PVS punch + orientation/spin, QSS-M
brokenbouncemissile/brokeneffects rerelease quirks, and the runtime limits sweep
(needs play session). All visual verification pending user smoke test.

Goal: recent community maps (2020s jams, Alkaline, AD/Copper releases, re-release content)
look and run correctly. Every feature below has a local reference implementation to port
against — `C:/source/ironwail`, `C:/source/QSS`, `C:/source/QSS-M` — per the project rule
that engine changes need QSS-M/Ironwail/vanilla precedent.

Already done (don't re-plan): BSP2, protocol 666/999 + float coords, fog + skyfog, cubemap
skyboxes, lit water, rotating bmodels, fence/alpha-masked textures, `.lit`, entity alpha,
entity/pose lerp, effectinfo particles + weather, `checkextension`, hipnotic/rogue HUDs,
pak music, autosave/autoload.

Phases are ordered by (impact on real maps) / (effort); later phases don't depend on
earlier ones unless noted.

---

## Phase 1 — Overbright lighting (S)

**Why:** every map since ~2000 is lit for QuakeSpasm's 2× overbright. `gl_overbright` is
registered (r.ts:1322) but defaults to `0`, and r.ts:969 has a "todo - full bright &
overbright" in the alias path — so it's partial at best. Highest visual payoff per line.

**Reference:** QuakeSpasm `gl_rsurf.c R_BuildLightMap` (lightmap scale), Ironwail
`glsl` shaders (overbright factor baked into the world/alias shaders),
`gl_mesh.c/r_alias.c` for alias shading.

**Changes here:**
- Audit what `cvr.overbright` currently gates. Lightmaps are GPU-side (GPU lightstyles
  from the perf work), so the 2× likely belongs in the brush shader where style values
  are combined — multiply + clamp there, gated on a uniform.
- Alias models: `drawAliasModel`'s ambient/shade light scaling (r.ts ~712) needs the same
  2× treatment (QS scales `shadelight` and clamps).
- Lit water shader and any fullbright-mask path must NOT double-apply (fullbright texels
  bypass lighting; fence/fbright palette tables already exist in texture.ts).
- Flip default to `1` to match QS/Ironwail.

**Verify:** side-by-side screenshots vs Ironwail on id1 `e1m1` + one dark AD map;
`gl_overbright 0/1` toggle live-updates; sbar/console/UI unaffected.

---

## Phase 2 — BSPX infrastructure + LMSHIFT + DECOUPLED_LM (L, the core of this plan)

**Why:** `bspx.ts` is entirely commented out. ericw-tools' `-world_units_per_luxel`
(DECOUPLED_LM) is the modern lighting workflow and is NOT backward compatible — engines
that ignore the lump missample lightmaps on exactly the newest, best-lit maps. LMSHIFT
(per-face lightmap scale) is the older variant. This is the single biggest compat gap.

**Reference:** Ironwail `Quake/gl_model.c` (grep `DECOUPLED_LM`, `LMSHIFT`,
`Mod_LoadBSPX`), `bspfile.h` lump structs, `gl_brush.c/gl_rsurf.c` for how `lmvecs`
replace texinfo vecs in lightmap UV building. QSS has LMSHIFT only.

**Step 2a — BSPX header parser (S).** Resurrect `bspx.ts`: locate the `BSPX` header after
the last standard lump, expose `findLump(name)`. Wire into `mod.loadBrushModel` after
lump parsing. No behavior change yet; `developer 1` prints discovered lumps.

**Step 2b — LMSHIFT (M).** Per-face shift replaces the hardcoded 4 (`>> 4`). Touch
points found by grep: `lightmap.ts:68-69/120-121` (build/upload extents math),
`r.ts:466-469 sampleLightmap` (model lighting reads), plus wherever polys' lightmap
ST coords are generated in mod.ts (`buildSurfaceDisplayList`-equivalent). Store
`surf.lmshift` (default 4) and replace every `>> 4` with per-surf shift. Also
`LMOFFSET`/`LMSTYLE` if trivially available in the same lumps.

**Step 2c — DECOUPLED_LM (M, after 2b).** Per-face `lmwidth/lmheight` + `lmvecs`
(world→lightmap projection independent of texinfo). Replaces the extents-derived sizes
and the texinfo-vec UV math in the same three places 2b touched; `sampleLightmap`'s
`ds/dt` derivation must use lmvecs too (lightPoint feeds alias model lighting — wrong
here means wrongly-lit monsters, subtle). Fall back to 2b/vanilla math when absent.

**Step 2d — BRUSHLIST (M, optional, independent after 2a).** QSS uses it for exact
rotating-bmodel collision instead of hull approximation — firms up the rotation support
from the AD work. Reference: QSS `gl_model.c`/`world.c` (grep `BRUSHLIST`).

**Step 2e — LIGHTGRID (L, optional, after 2c).** Ironwail's voxel light grid for model
lighting. Luxury; only newest maps ship it. Defer until something visibly needs it.

**Verify:** compile a test map twice with ericw-tools (default vs `-world_units_per_luxel 4`
and `-lmscale`) and compare against Ironwail; then a real decoupled-LM jam release.
Watch the lightmap atlas: decoupled maps pack 4-16× more luxels — page count and the
grow-only atlas need a look under `ad_tears`-scale input.

---

## Phase 3 — Entity `.scale` (M)

**Why:** QSS-2021/Ironwail/re-release all support per-entity scale; jam maps targeting
them use it for props/monsters. Missing scale = visibly wrong geometry.

**Reference:** Ironwail (grep `scale` in `protocol.h`, `sv_main.c
SV_WriteEntitiesToClient`, `cl_parse.c CL_ParseUpdate`, `r_alias.c`) — port their exact
wire bit and encoding (byte, 16 = 1.0) rather than inventing one; QSS-M for cross-check.

**Changes here:**
- protocol.ts: the U bit (extend range — U.extend1/2 machinery already exists from the
  fitzquake work) + encode/decode helpers.
- sv.ts `writeEntitiesToClient`: read `.scale` fielddef like alpha does
  (`ed.getEdictFieldValue` cached path), baseline field, send-when-differs.
- cl.ts `parseUpdate` + entity state: carry scale; lerp not needed (QS doesn't lerp it).
- r.ts `drawAliasModel`: scale the model matrix (and bbox for culling — the static-entity
  edge-pop fix means culling uses real bounds; scale must feed that too). Brush entities:
  QS applies scale to alias/sprite only — match reference exactly.
- Save/load: `.scale` is a plain QC field — serializes for free via the fielddef path.

**Verify:** AD's `scale` test entities or a Kex-aware jam map; demo record/playback
round-trip (wire format!); protocol 15 servers must never send the bit.

---

## Phase 4 — MD3 models (M-L)

**Why:** Alkaline (the dominant modern base mod) ships md3 props; they currently
error/missing-model.

**Reference:** QSS `Quake/gl_model.c` (grep `MD3`, `Mod_LoadMD3`) + its md3 header
structs; QSS-M same lineage.

**Changes here:**
- mod.ts: magic dispatch in `loadAliasModel`/`loadModel` (`IDP3`), loader producing the
  same runtime shape the alias path renders (frames/verts/st/tris → the existing
  pose-VBO layout from the entity-lerp work; multi-surface md3s can concat surfaces).
- Normals: md3 stores lat/long encoded normals — decode to the anorms-equivalent the
  alias shading uses.
- Skins: md3 references external image paths — route through existing TGA/PCX loaders
  (tx.ts already loads external images for skyboxes).
- Frame groups/tags can be skipped (QSS skips tags for Q1 use).

**Verify:** Alkaline start map props; pose lerp works (md3 is per-frame verts like mdl);
`r_showbboxes`-style sanity via existing culling (bounds from frames, not the MDL
boundingradius workaround).

---

## Phase 5 — Skyrooms (M)

**Why:** `_skyroom` worldspawn key (QSS feature, adopted by Ironwail; used by Alkaline
maps and newer jams) renders a small room as a live 3D skybox. Degrades gracefully
today, but increasingly expected.

**Reference:** QSS (grep `skyroom` in `gl_rmain.c`/`r_sky.c` — worldspawn parse, the
second view render, stencil/depth handling); Ironwail's version if cleaner.

**Changes here:**
- sky.ts: parse `_skyroom "x y z [orientation]"` alongside the existing worldspawn sky
  parsing (fog.ts/sky.ts already share that hook).
- r.ts: render the world a second time from the skyroom viewpoint into the sky surface
  region before the main pass — needs the sky-surface depth/stencil mask the current
  skybox pass already establishes (`drawSkyBox` r.ts:2586). Careful with the per-frame
  budget: it's a second `markWorldFrustum` + draw walk from another origin; reuse the
  existing walk with a saved/restored view state, and gate with `r_skyroom` cvar.
- Interaction with fog (skyroom uses its own fog per QSS `_skyroom_fog`? — match
  reference scope; ship the minimal key first).

**Verify:** an Alkaline map with a skyroom vs Ironwail; perf check on a big map (the
second walk must respect PVS from the skyroom leaf).

---

## Phase 6 — Re-release (Kex) QC compat (M)

**Why:** runs *Dimension of the Machine* / rerelease-targeting maps. Self-contained;
do only if that content matters.

**Reference:** QuakeSpasm 0.94+/QSS-M "2021 rerelease" support (grep `2021`, `ex_`,
`localsound` in QSS-M's `pr_ext.c`/`host_cmd.c`).

**Changes here:** the builtin set QSS implements (`ex_CheckPlayerEXFlags`,
`localsound`, `ex_bot_*` stubs, `walkpathtogoal` stub returning failure, etc.),
`checkextension` entries, and the couple of svc quirks QSS documents. pf.ts already has
the builtin table + FTE_STRINGS machinery to hang these on.

**Verify:** DOTM first map start-to-exit; standard id1 progs unaffected.

---

## Phase 7 — Robustness sweep (S, do alongside anything)

- **Protocol auto-selection:** confirm `spawnServer` auto-picks 999/FLOAT_COORDS when
  map bounds exceed ±4096 (BSP2 loader knows the bounds) instead of trusting a cvar.
- **Limits under one mega-map** (`ad_tears` or `ad_magna`): visedicts, dlights, beams,
  sound channels, lightmap pages, efrag pool — one instrumented session, raise what tops
  out.
- **`r_lerplightstyles`** (Ironwail): interpolate style values GPU-side — tiny now that
  styles are uniforms.

---

## Suggested order & rough effort

| # | Feature | Effort | Unblocks |
|---|---------|--------|----------|
| 1 | Overbright audit + enable | S | every map's lighting |
| 2a | BSPX parser | S | 2b-2e |
| 2b | LMSHIFT | M | high-res lightmaps |
| 2c | DECOUPLED_LM | M | 2023+ jam maps |
| 3 | Entity .scale | M | Kex-aware maps |
| 4 | MD3 | M-L | Alkaline |
| 5 | Skyroom | M | Alkaline/new jams |
| 2d | BRUSHLIST collision | M | rotation accuracy |
| 6 | Kex QC compat | M | DOTM |
| 7 | Robustness sweep | S | mega-maps |
| 2e | LIGHTGRID | L | (defer) |

Each phase lands independently commit-wise; nothing here touches the netcode paths the
GC campaign just stabilized except `.scale`'s two message functions.
