# AD Engine Features — Implementation Plan

Goal: close the gaps documented in `docs/ad-engine-features.md` that have graceful-fallback
cost on Arcane Dimensions maps. Work happens on branch `ad-engine-features`, one commit per
phase, `npm run build` green after each. Reference engines: QSS-M at `C:\source\QSS-M\Quake`,
Ironwail at `C:\source\ironwail\Quake`.

Out of scope this pass: effectinfo/pointparticles particle system (own project),
FTE_ENT_SKIN_CONTENTS, RMQ 999 protocol flags, DP shadows.

## Phase 0 — Advertise existing features (inline, trivial)
Add `DP_GFX_FOG` and `DP_QC_SPRINTF` to the `extensions` table in `pf.ts`.
Both features are fully implemented; AD's QC just needs to see them.

## Phase 1 — Rotating brush models (Sonnet agent, server)
Port QSS-M's rotating pusher support so MOVETYPE_PUSH entities with `avelocity` rotate
and correctly carry/clip riders. Reference: `C:\source\QSS-M\Quake\sv_phys.c` (`SV_PushMove`
/ the `rotatingbmodel` paths near lines 600–850; entity rotation transform of rider origins).
- Files: `src/engine/sv.ts` only (do NOT touch pf.ts — extension advertised in Phase 4).
- The pusher path must rotate rider origins around the pusher origin (angle transform),
  update pusher angles from avelocity * movetime, and unwind on blocked movers,
  matching QSS-M semantics. Always-on (no pext negotiation): QSS-M gates it per-protocol;
  we enable unconditionally like `qcvm->rotatingbmodel = true`.
- Constraints: CLAUDE.md rules — no per-frame allocations in physics (persistent scratch
  on the module `state` object, `vec.ts` out-param convention).

## Phase 2 — Lit water (Sonnet agent, renderer)
Lightmapped liquid surfaces (`r_litwater`, default 1). Reference: Ironwail
`gl_model.c` (`haslitwater` detection at surface load — a DRAWTURB surface with real
`samples`), `r_world.c:556` (route lit turb surfaces through the lightmapped world path;
unlit ones stay on the classic warp path).
- Ours: investigate how `mod.ts` loads turb surfaces and whether `lightmap.ts`
  currently skips them; then either extend the `Turbulent` shader with lightmap
  sampling + lightstyles (matching the `Brush` shader's lightmap inputs) or route lit
  turb surfaces through the Brush pipeline with warped UVs computed in-shader.
- Files: `src/engine/mod.ts`, `src/engine/lightmap.ts`, `src/engine/r.ts`,
  `src/engine/shaders.ts`, possibly `types/Model.ts`.
- Must respect water alpha (`waterAlphaForEntitySurface`) and fog exactly as the
  existing water path does. Maps without lit water data must render identically to today.

## Phase 3 — FTE_STRINGS + DP_QC_GETSURFACE builtins (Sonnet agent, QC VM)
Port from `C:\source\QSS-M\Quake\pr_ext.c`:
- FTE_STRINGS family (builtin numbers in comments there): `strstrofs` 221, `str2chr` 222,
  `chr2str` 223, `strconv` 224, `strpad` 225, `infoadd` 226, `infoget` 227,
  `strncmp` 228, `strcasecmp` 229, `strncasecmp` 230. Some may already exist — audit first.
- DP_QC_GETSURFACE family: `getsurfacenumpoints` 434, `getsurfacepoint` 435,
  `getsurfacenormal` 436, `getsurfacetexture` 437, `getsurfacenearpoint` 438,
  `getsurfaceclippedpoint` 439 — operate on the entity's brush model faces.
- Files: `src/engine/pf.ts` (+ a new `pf_strings.ts` if it keeps pf.ts readable).
  Register in the builtin table with the QSS-M default numbers. Do NOT touch the
  `extensions` table (Phase 4).

## Phase 4 — Advertise + verify (inline)
Add `DP_SV_ROTATINGBMODEL`, `FTE_STRINGS`, `DP_QC_GETSURFACE` to the extensions table
once their phases pass review. Update `docs/ad-engine-features.md` statuses.
User smoke test on AD maps (rotating props, lit water pools, no QC errors), then
merge `ad-engine-features` → master.

## Sequencing
Agents run sequentially on the shared branch (disjoint files reduce risk, but review
and a green build gate each phase). Extension-table edits are all done by the
orchestrator in Phases 0/4 so no two writers ever touch `pf.ts`'s table.
