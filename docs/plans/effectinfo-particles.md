# effectinfo Particle System (pointparticles) — Implementation Plan

Goal: DP_SV_POINTPARTICLES / FTE_SV_POINTPARTICLES / FTE_PART_NAMESPACE_EFFECTINFO so
Arcane Dimensions (and other DP/QSS-targeting mods) get scripted textured particles
instead of the classic pixel-sprite fallback. Branch `effectinfo-particles`, one commit
per phase, `npm run build` green after each.

Reference: `C:\source\QSS-M\Quake\r_part_fte.c` (particle script system: effectinfo
parser ~line 3150-3450, `PScript_FindParticleType` ~1121, spawn/run
`PScript_RunParticleEffectState` ~4883, simulation + rendering throughout);
`C:\source\QSS-M\Quake\pr_ext.c` ~5100-5220 (`PF_sv_particleeffectnum`,
`PF_sv_pointparticles`, `PF_sv_trailparticles`, `svcdp_*` message writers);
`C:\source\QSS-M\Quake\cl_parse.c` (svcdp_trailparticles 60 / pointparticles 61 /
pointparticles1 62 client parsing). AD assets: `effectinfo.txt`,
`particles/particlefont.tga` in AD pak0.

Scope guards:
- effectinfo.txt (DP dialect) only; FTE-native `particles/*.cfg` namespaces are out of
  scope this pass (QSS parses both; AD's main path is effectinfo).
- Unsupported effect types are skipped with a console note, exactly like QSS-M
  ("effectinfo type %s not supported") — parity of graceful degradation, not
  feature-completeness. Decals out of scope.
- The classic particle system (instanced dots) stays untouched and remains the path
  for all vanilla effects; scripted effects only run where QC explicitly calls the
  new builtins (plus svc parsing).

## Phase A — Assets + parser + registry (agent)
- Load `particles/particlefont.tga` through the asset store into a GL texture
  (32-bit TGA with alpha; image.ts already decodes TGA for skyboxes).
- Parse `effectinfo.txt` (com.loadFile at map/mod load, lazy on first
  `particleeffectnum`) into typed effect descriptors: name, count/countabsolute,
  type (spark/static/smoke/blood/beam...), tex range (atlas cell min/max — DP
  particlefont is an 8x8 grid of 64 cells), size (+delta), alpha start/end/fade,
  color1/color2, originjitter/velocityjitter/originoffset/velocityoffset,
  velocitymultiplier, gravity, bounce, airfriction, time min/max, blend
  (alpha/add/invmod), orientation, stains/lightradius/lightcolor/lighttime,
  trailspacing, assoc-chained sub-effects (multiple blocks same name).
- `findParticleType(name)` registry with the `effectinfo.` namespace prefix rules
  from PScript_FindParticleType.
- New module `src/engine/pscript.ts` holding `state` (descriptors, atlas texture,
  live particles) per house style. No rendering yet; a dev console command
  `pointparticles <effectname>` spawning at the player's aim point for testing later.

## Phase B — Simulation + renderer (agent)
- Particle pools (persistent, no per-frame allocation: preallocated typed arrays /
  free lists like our classic instanced system in r.ts — read `initParticles`/
  `runParticles`/`drawParticles` first and mirror the architecture).
- Spawn logic per descriptor (count scaling, jitter, offsets, velocity inherit).
- Per-frame sim: gravity, airfriction, bounce (trace against world via the existing
  hull trace only when the descriptor has bounce, budgeted), life/alpha/size ramps,
  color lerp c1→c2.
- Renderer: one instanced draw per blend mode (alpha, additive) with atlas UVs per
  particle, billboard orientation (camera-facing; spark = velocity-stretched quads),
  gamma + fog consistent with existing particle shader. New GL program `PScript`.
- Budget guard: hard cap on live scripted particles (cvar `r_fteparticles_max`
  default a few thousand) with oldest-first recycling.
- cvar `r_fteparticles` default 1; 0 disables spawn+draw entirely.

## Phase C — Builtins + network + advertise (agent, then orchestrator review)
- Server: `particleeffectnum` (precache list on `sv.state.server`, names sent to the
  client the way QSS-M does — read PF_sv_particleeffectnum for the exact transport:
  precache stufftext vs svc — and replicate), `pointparticles` (svcdp 61, or 62 for
  the count==1/vel==0 compact form), `trailparticles` (svcdp 60). Multicast handling
  matching QSS-M (sv.multicast → datagram).
- Client: parse svcdp_trailparticles/pointparticles/pointparticles1 in cl.ts
  parseServerMessage, resolve effect index → descriptor, spawn via Phase B.
- Effect-index precache table client-side, reset on serverinfo like model/sound
  precaches.
- Orchestrator (not agent) then advertises `DP_SV_POINTPARTICLES`,
  `FTE_SV_POINTPARTICLES`, `FTE_PART_NAMESPACE_EFFECTINFO` in pf.ts and updates
  `docs/ad-engine-features.md`.

## Phase D (stretch, separate decision) — DP_TE_PARTICLERAIN / DP_TE_PARTICLESNOW
Temp-entity rain/snow on top of the Phase B renderer. Only start after A-C are
smoke-tested on AD maps.

## Verification per phase
`npm run build` green; Phase B+ testable in-game via the dev `pointparticles` command
before any QC integration exists; final smoke test = AD map with visible scripted
effects (torch smoke/flames on ad_test maps, explosion effects) and zero change with
`r_fteparticles 0`.
