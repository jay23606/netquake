# Arcane Dimensions — Engine Feature Gaps

AD targets QuakeSpasm 0.93+ / QuakeSpasm-Spiked (readme: "designed to work with the
QS-Spike Engine; other engines offer partial support of features"). It probes engine
capabilities at runtime via the `checkextension` builtin and degrades gracefully when
a feature is absent — nothing below is load-bearing, but each gap costs visuals or
map-specific behavior.

Sources: extension-name strings extracted from AD 1.80p1 `progs.dat`, `ad_v1_80_readme.txt`,
`ad_v1_80_documentation.txt`, and an audit of `src/engine` (2026-07-15).

## Extensions AD probes via `checkextension`

We currently advertise only `DP_SV_SETCOLOR`, `KRIMZON_SV_PARSECLIENTCOMMAND`, `FRIK_FILE`
(`pf.ts` `extensions` table). AD probes all of the following:

| Extension | Status | Notes |
|---|---|---|
| `DP_GFX_FOG` | **Deliberately not advertised** | Advertising it made AD's QC emit DarkPlaces' 9-arg `fog` syntax (help-text spam on map load). QSS-M doesn't advertise it either; fog works via the QuakeSpasm path (worldspawn key + `fog` command + svc). |
| `DP_QC_SPRINTF` | **Done** (2026-07-15) | Advertised; `sprintf` builtin #627 (`pf_sprintf.ts`). |
| `FTE_STRINGS` | **Done** (2026-07-15) | Full family ported to `pf_strings.ts` (#221-230) and advertised. |
| `DP_SV_POINTPARTICLES` | **Done** (2026-07-15) | Full effectinfo.txt system in `pscript.ts`: parser + registry, SoA particle pool, instanced textured renderer (particlefont atlas, 3 blend modes), builtins #335-337, svcdp 54/60/61/62 wire. `r_fteparticles` cvar. |
| `FTE_SV_POINTPARTICLES` | **Done** (2026-07-15) | Same implementation, advertised. |
| `FTE_PART_NAMESPACE_EFFECTINFO` | **Done** (2026-07-15) | `effectinfo.` namespace resolution in `findParticleType`. FTE-native `particles/*.cfg` dialect still unsupported. |
| `DP_TE_PARTICLERAIN` / `DP_TE_PARTICLESNOW` | **Done** (2026-07-15) | Builtins #409/#410 → TE 55/56 wire → `runParticleWeather` box spawns. Plus the full FTE surface-emitted weather system (`particles/*.cfg` native dialect, worldspawn `_texpart_*` keys, skytris emission, rain-splash cliptype impacts, `r_part_rain`). Note: ad_akalakha's `_texpart_sky_seprain` key is a mapper typo (no such texture) — silent no-op in QSS-M too; ad_sepulcher is the map where surface rain actually fires. |
| `DP_SV_ROTATINGBMODEL` | **Done** (2026-07-15) | `pushMoveAngles` in sv.ts (QSS-M SV_PushMoveAngles port), always enabled, advertised. |
| `DP_QC_GETSURFACE` | **Done** (2026-07-15) | Builtins #434-439 in pf.ts, advertised. |
| `FTE_ENT_SKIN_CONTENTS` | **Done** (2026-07-16) | Negative `.skin` SOLID_BSP entities report skin as contents (`skinContentsAt`/`pointContentsAllBsps` in sv.ts), skipped by ordinary collision; player waterlevel probes consult them and FTESKIN ladders drive native `onladder` climb movement. Advertised (QSS-M does, unconditionally). |
| `DP_SV_SETCOLOR`, `KRIMZON_SV_PARSECLIENTCOMMAND`, `FRIK_FILE` | **Advertised** | Already in the table. |

## Renderer features (QuakeSpasm 0.93 baseline)

| Feature | Status | Notes |
|---|---|---|
| Lightmapped ("lit") water | **Done** (2026-07-15) | `r_litwater` (default 1): lit turb surfaces route through the Brush pipeline with in-shader UV warp (`uWarp`/`uTime`); unlit turb and `r_litwater 0` keep the classic path. |
| Entity alpha on alias models | **Done (pending commit)** | Pass-split + `uAlpha` in Alias/Player shaders. Brush alpha already worked. |
| Fence textures (`{` alpha-test) | Done | `uUseAlphaTest` path in brush/turbulent shaders. |
| `.lit` colored lighting | Done | `mod.ts` / `lightmap.ts`. |
| Fog + skyfog | Done | `fog.ts`, `r_skyfog`. |
| Skybox (`sky` worldspawn key + command) | Done | modern-sky work, cubemap + TGA/PCX/PNG/JPG. |
| Overbright / fullbright masks | Done | `uUseOverbright`, `uUseFullbrightTex`. |
| Model/movement interpolation | Done | FitzQuake pose + movestep lerp incl. `U_LERPFINISH` (fixed 2026-07-15). |
| DP dynamic shadows (`SHADOW` spawnflag on misc_model) | Not planned | Darkplaces-only; QuakeSpasm doesn't do it either. |

## Protocol / limits

| Feature | Status | Notes |
|---|---|---|
| Protocol 666 (FitzQuake) | Done | Incl. `svc_spawnstatic2`/`spawnbaseline2`, model2/frame2, alpha, lerpfinish. |
| Protocol 999 (RMQ) | **Done** (2026-07-16) | Real `PRFL_*` bits end to end: server defaults `INT32COORD\|SHORTANGLE` (QSS-M's non-PEXT2 choice), per-flag coord/angle codecs in msg.ts, flags long on serverinfo both ways. 16-bit angles fix AD cinematic camera stepping. |
| BSP2, large coords (float coords flag) | Done | |
| Raised limits (edicts 32k lazy-grown, 2 MB messages, 2048 lightmaps, big signon) | Done | |

## Suggested order of attack

1. **Advertise what already works**: add `DP_GFX_FOG` and `DP_QC_SPRINTF` to the
   `extensions` table — one-line changes that unlock existing AD QC paths.
2. **Lit water** — self-contained renderer work, high visual payoff on most AD maps.
3. **Rotating brush models** (`SV_PushRotate` port + advertise `DP_SV_ROTATINGBMODEL`) —
   enables AD's rotating decorations/traps.
4. **effectinfo particle system** (`pointparticles` family) — biggest single feature;
   transforms AD's look but is a substantial subsystem (parser + renderer + builtins).
5. `FTE_STRINGS` completion, `DP_QC_GETSURFACE`, `FTE_ENT_SKIN_CONTENTS`, RMQ 999
   flags — lower payoff, do opportunistically.
