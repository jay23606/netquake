# Weather Particles (FTE surface-emitted rain/snow + DP TEs) — Implementation Plan

Goal: AD weather parity with QSS-M. ad_akalakha's worldspawn has
`"_texpart_sky_seprain" "fte_weather.tex_skyrainlit"` — sky surfaces emit rain via
FTE's native particle config dialect (`particles/fte_weather.cfg` in AD pak0). Plus the
`DP_TE_PARTICLERAIN`/`DP_TE_PARTICLESNOW` QC builtins. Branch `weather-particles`, one
commit per phase, `npm run build` green after each.

Reference (QSS-M `C:\source\QSS-M\Quake\r_part_fte.c` unless noted):
- FTE-native `r_part NAME {}` config parser: `P_LoadParticleSet` ~3784, per-key handlers
  ~1800-2930 (`!strcmp(var, ...)` chain), auto-load of a namespace's config on demand in
  `PScript_FindParticleType` ~1206 (`P_LoadParticleSet(cfg, true, true)`).
- Worldspawn `_texpart_TEX` key parsing + implicit `tex_<texname>` lookup + per-surface
  registration: ~3660-3730; skytris construction `PScript_EmitSkyEffectTris` ~4030;
  per-frame emission over the skytris list ~3917-3988 (budgeted, `r_part_rain` /
  `r_part_rain_quantity` cvars).
- TE builtins: `pr_ext.c` `PF_sv_te_particlerain`/`snow` ~3150, table #409/#410,
  extensions `DP_TE_PARTICLERAIN`/`SNOW` gated on `PR_Can_Particles` (~9234).
- Our existing scripted-particle system: `src/engine/pscript.ts` (Phases A-C of
  docs/plans/effectinfo-particles.md — descriptor model, finishEffect, pool, renderer,
  svcdp wire). The weather work EXTENDS this module.

Scope guards:
- Parse only the keys `fte_weather.cfg` actually uses plus the common core (texture,
  count, alpha, rgb, die, veladd, scale, stretchfactor, type, cliptype, clipbounce,
  clipcount, flurry, gravity, friction, randomvel, spawnmode) — warn-and-skip the rest
  (developer-only), same graceful-degradation policy as effectinfo.
- Emission only for the worldmodel (QSS-M note: same restriction in spirit; brush
  entities with weather textures are out of scope).
- Deferred/out of scope: `_texpart_` on non-sky liquids beyond what AD uses, FTE spawn
  modes beyond what fte_weather.cfg needs, decals.

## Phase 1 — FTE-native particle config parser (agent)
`r_part NAME { key value... }` blocks → our `EffectDescriptor`s, in a per-config
namespace (`fte_weather.te_rain` etc.); `findParticleType("cfg.name")` triggers lazy
load of `particles/cfg.cfg`. Key semantic differences from the effectinfo importer to
get right (verify in C): native defaults come straight from `P_ResetToDefaults`
(stretch 0.05, scalefactor default — read it), `FinishParticleType` still applies
(scalefactor consumption only when >1), `texture <name>` resolves named font regions
via `P_LoadTexture` (read how 'ball' etc. map to the particlefont), alpha/die/scale
are direct values (not the /256 + rand encoding effectinfo uses). `cliptype`/`clipbounce`/
`clipcount` parse into new descriptor fields (consumed in Phase 2). `flurry` too.

## Phase 2 — Surface-emitted weather + impact sub-effects (agent)
- At world load: parse worldspawn `_texpart_TEX effectname` keys, plus implicit
  `tex_<texturename>` effect lookups for every world texture; for each matching
  surface build the skytris list (triangle fan area table like EmitSkyEffectTris).
- Per frame (gated `r_part_rain` default 1, budget `r_part_rain_quantity` default 1):
  emit the associated effect from random points on the skytris area, following the
  QSS-M emission loop's rate math.
- Impact handling: particles whose descriptor has `cliptype` spawn that named effect
  on world impact (`clipcount` scaling, `clipbounce` behavior) — this is what makes
  rain splash. Extends the existing bounce trace path in the sim; budget-guard traces.
- `flurry` sideways drift for snow.

## Phase 3 — DP TEs + advertise + invmod fix (agent, then orchestrator)
- Builtins `te_particlerain` #409 / `te_particlesnow` #410 (box min/max, vel, count,
  color) + whatever wire QSS-M emits for them (read PF_sv_te_particlerain) + client
  parse → spawn via the Phase 1/2 machinery.
- invmod fade fix from the particle batch's known-residual: fold particle alpha into
  the invmod darkening factor (one fragment-shader uniform/branch) so fading
  blood/decals ease out instead of popping.
- Orchestrator: advertise `DP_TE_PARTICLERAIN`/`DP_TE_PARTICLESNOW` (QSS-M advertises
  both — verified pr_ext.c:9234), update `docs/ad-engine-features.md`.

## Verification
Phase 1: parse fte_weather.cfg from AD pak0 standalone, report effect/key coverage.
Phase 2: ad_akalakha sky should rain (compare QSS-M); `r_part_rain 0` kills it.
Phase 3: dev-command or QC test for TEs. Final: user smoke test, then merge to master.
