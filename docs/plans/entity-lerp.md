# Entity Animation Interpolation Plan

Goal: FitzQuake-style interpolation of alias-model animation (pose blending) and
MOVETYPE_STEP entity movement (origin/angle smoothing), so monsters animate and move
smoothly at any framerate instead of snapping at the server's 10 Hz think rate.

Reference implementation: **Ironwail** (`C:\source\ironwail\Quake`). Read these before
starting — the port must match their semantics exactly:

- `r_alias.c` — `R_SetupAliasFrame`, `R_SetupEntityTransform` (the core algorithm)
- `render.h:42-93` — `LERP_*` flags and `entity_t` lerp fields
- `cl_parse.c` (`CL_ParseUpdate`, ~line 493-660) — where lerpflags get set from the net
- `cl_main.c` (`CL_RelinkEntities`, ~line 546-640) — slot reuse, teleports, muzzleflash
- `view.c` (~line 841-852) — view weapon lerp handoff

Ironwail renders pose blending on the GPU: per-instance `Pose1`/`Pose2`/`Blend` in an
SSBO, `mix(pose1.pos, pose2.pos, Blend)` in the vertex shader (`gl_shaders.h:1142-1161`).
WebGL has no SSBOs, but our vertex layout gives an equivalent trick for free: every pose
is already a contiguous `(pos3f, normal3f)` block in the model's `cmds` VBO at a known
byte offset (`frame.cmdofs`, built in `mod.ts` `loadAliasModel`). So we bind the **same
buffer twice at two offsets** (aPosition/aNormal at pose1, aPosition2/aNormal2 at pose2)
plus a `uBlend` uniform. Zero data-format changes, zero CPU vertex work, two extra
attribute pointers and one uniform per alias draw.

A lot of plumbing already exists in this repo — do not re-add it:

- `r.ts:34` — `LERP` flag constants (movestep/resetanim/resetanim2/resetmove/finish)
- `Entity` type already has `lerpflags`, `lerpfinish`; `newEntity` initializes them
- `cl.ts parseUpdate:1934` — `U.lerpfinish` read sets/clears `LERP.finish`
- `cl.ts parseStatic:2085` — static entities get `resetanim|resetmove`
- `sv.ts:426` — server sets `U.nolerp` (= Fitz `U_STEP`, bit 32) for MOVETYPE_STEP
- `sv.ts:456,512` and `sv.ts:921-931` — `sendinterval`/`U.lerpfinish` write side

The server side is therefore **complete**; this plan is client + renderer only.

Execute phases **in order**. Each phase is a separate commit, verified before moving on.

---

## Non-goals (do NOT do these)

- No instanced/batched alias rendering, no draw-call restructuring. One draw per entity
  stays. (Batching is a separate future effort.)
- No IQM/MD3/skeletal support, no `futurepose` 3-point blending.
- No changes to brush model rendering, culling logic, or the BSP walk. (Lesson learned:
  unrelated rendering/culling changes on BSP2 maps caused surface blinking.)
- No demo-rewind support (`cls.demospeed < 0` handling in Ironwail) — this port has no
  demo speed control.
- No changes to `sv.ts` — the write side is already done.
- Do not change how `cullBox` is fed: keep culling on `e.origin` exactly as today.
  FitzQuake also culls on the un-lerped origin; the lerped position only affects
  uniforms. This keeps the non-lerped code path bit-identical.

## Hard rules

1. After every phase: `npx tsc --noEmit -p tsconfig.app.json` and `npm run build` must
   pass. Commit per phase, message `entity lerp phase N: <summary>`. No
   `Co-Authored-By` trailer.
2. **Zero per-frame allocations** in `drawAliasModel`, `relinkEntities`, `parseUpdate`,
   and the new setup functions. No `[x,y,z]` literals, no object literals, no closures.
   Frame-local vectors come from `vec.scratch()`; results that must persist across
   frames live in fields created once at entity construction. Multi-value returns from
   the new setup functions are written into a persistent object on `r.state`, never
   returned as a fresh object.
3. Module state goes on the existing exported `state`/`cvr` objects (CLAUDE.md rule) —
   no standalone module-level variables.
4. Behavior-preserving when disabled: with `r_lerpmodels 0` and `r_lerpmove 0` the
   engine must render exactly as before (pose1 == pose2, blend == 1, origin/angles
   passed through untouched).
5. Comments: terse, on interface/type declarations only. No narrative at call sites.

---

## Phase 0 — cvars, entity fields, model nolerp flag

**`r.ts`** — register in the same block as the other cvars (~line 1162):

```ts
cvr.lerpmodels = cvar.registerVariable('r_lerpmodels', '1')
cvr.lerpmove   = cvar.registerVariable('r_lerpmove', '1')
```

**`types/Entity.ts`** — add fields (mirror Ironwail `render.h:77-87`):

```ts
lerpstart: number       // anim lerp: cl.time when current pose transition began
lerptime: number        // anim lerp: expected interval between poses (0.1 or framegroup spacing)
previouspose: number    // cmdofs of the pose being blended from (-1 = none)
currentpose: number     // cmdofs of the pose being blended to
movelerpstart: number   // transform lerp: cl.time when origin/angles last changed
previousorigin: V3
currentorigin: V3
previousangles: V3
currentangles: V3
```

Pose identity is the **`cmdofs` byte offset** into the model's `cmds` VBO — unique per
pose within a model, and directly what the renderer needs to bind. Model changes set
`LERP.resetanim`, so stale offsets from a previous model are never compared meaningfully.

**`cl.ts` `newEntity`** (~line 500) — initialize: numbers to `0`, poses to `-1`, the four
vectors as fresh persistent arrays (`[0.0, 0.0, 0.0]`). Construction is a cold path;
allocation here is correct. This covers world entities, statics, and `viewent`.

**`mod.ts` + `types/Model.ts`** — add `nolerp: boolean` to the alias `Model` type. At the
end of alias model load, set it by name match against Ironwail's `r_nolerp_list`
(`gl_rmain.c:112`): `progs/flame.mdl, progs/flame2.mdl, progs/braztall.mdl,
progs/brazshrt.mdl, progs/longtrch.mdl, progs/flame_pyre.mdl, progs/v_saw.mdl,
progs/v_xfist.mdl, progs/h2stuff/newfire.mdl`. A static list constant is fine (no cvar
needed). Load time — allocation OK.

---

## Phase 1 — client bookkeeping (`cl.ts`, `v.ts`)

Port the lerpflag transitions from Ironwail. Every rule below cites its source line —
match the semantics exactly.

### `parseUpdate` (cl.ts:1885)

1. After computing `forcelink` (line 1902), add the missed-think reset
   (`cl_parse.c:499`):
   ```ts
   if (ent.msgtime + 0.2 < clState.mtime[0])
     ent.lerpflags |= r.LERP.resetanim
   ```
   (must be checked **before** `ent.msgtime = clState.mtime[0]` overwrites it)
2. Replace the `U.nolerp` handling (line 1951) with Fitz `U_STEP` semantics
   (`cl_parse.c:579-585`):
   ```ts
   if ((bits & protocol.U.nolerp) !== 0) {
     ent.lerpflags |= r.LERP.movestep
     ent.forcelink = true
   } else
     ent.lerpflags &= ~r.LERP.movestep
   ```
3. In the model-change block (line 1942 `if (model !== ent.model)`), add
   `ent.lerpflags |= r.LERP.resetanim` (`cl_parse.c:657`).

### `relinkEntities` (cl.ts:1250)

1. Slot vacated (line 1281, `ent.model = null`): add
   `ent.lerpflags |= r.LERP.resetmove | r.LERP.resetanim` (`cl_main.c:562`).
2. Teleport detection (line 1300, `f = 1.0`): add
   `ent.lerpflags |= r.LERP.resetmove` (`cl_main.c:581`).
3. After the teleport loop, before the origin/angle interpolation loop: don't
   double-lerp movestep entities (`cl_main.c:586`):
   ```ts
   if (r.cvr.lerpmove.value !== 0 && (ent.lerpflags & r.LERP.movestep) !== 0)
     f = 1.0
   ```
4. Muzzleflash block (line 1319): after the dlight setup, add the anti-smear reset
   (`cl_main.c:629-635`) — muzzle flare frames look bad when blended:
   ```ts
   if (r.cvr.lerpmodels.value !== 2) {
     if (i === clState.viewentity)
       clState.viewent.lerpflags |= r.LERP.resetanim | r.LERP.resetanim2
     else
       ent.lerpflags |= r.LERP.resetanim | r.LERP.resetanim2
   }
   ```

### `calcRefdef` (v.ts, ~line 358-378)

Before `view.model = ...` (line 377), port `view.c:841-847` plus the weapon-switch reset
(`cl_parse.c:883`): copy `LERP.finish` + `lerpfinish` from the player entity (`ent`,
already in scope) to `view`, clearing when absent; and if the precache model about to be
assigned differs from `view.model`, set `view.lerpflags |= r.LERP.resetanim`.

Phase 1 is observable-behavior-neutral (nothing reads the flags yet) except the
`U.nolerp` change, which preserves the existing `forcelink = true` effect.

---

## Phase 2 — renderer (`r.ts`, `shaders.ts`)

### Shaders

`vshAlias` (shaders.ts:1) and `vshPlayer` (shaders.ts:179) get identical changes:

```glsl
attribute vec3 aPosition2;
attribute vec3 aNormal2;
uniform float uBlend;
...
vec3 lerpedPos = mix(aPosition, aPosition2, uBlend);
vec3 position = uViewAngles * (uAngles * lerpedPos + uOrigin - uViewOrigin);
vLightDot = mix(dot(aNormal, uLightVec), dot(aNormal2, uLightVec), uBlend);
```

Blending the two lighting dots (not the normals) matches Ironwail
(`gl_shaders.h:1156-1158`). Fragment shaders unchanged. Update both `GL.createProgram`
calls (`'Alias'` r.ts:1186, `'Player'` r.ts:1214): add `'uBlend'` to uniforms and
`createAttribParam('aPosition2', gl.FLOAT, 3)`, `createAttribParam('aNormal2', gl.FLOAT, 3)`
to the attribute lists.

### Setup state

Add one persistent result container to `r.state` (created once in state init, mutated in
place):

```ts
aliasLerp: { pose1ofs: 0, pose2ofs: 0, blend: 1.0 }
```

Lerped origin/angles use `vec.scratch()` inside `drawAliasModel` — frame-local, never
stored.

### `setupAliasFrame(e, clmodel)` — new function in r.ts

Port of `R_SetupAliasFrame` (`r_alias.c:84-149`), writing into `state.aliasLerp`.

1. Pose selection: reuse the existing frame/framegroup logic from `drawAliasModel`
   (r.ts:851-868) **unchanged** — same `time = cl.clState.time + e.syncbase`, same
   cumulative-interval subframe loop. Outputs: the selected `AliasFrame`'s `cmdofs`
   as the candidate pose, plus:
   - single frame: `e.lerptime = 0.1`
   - framegroup: `e.lerptime = group.frames[0].interval` (the spacing — our intervals
     are cumulative, Quake-style, and Fitz assumes uniform spacing, so the first
     cumulative value *is* the spacing)
2. Bookkeeping, exactly `r_alias.c:106-128`: `resetanim` → snap both poses to
   candidate, clear flag, `lerpstart = 0`; pose changed + `resetanim2` → snap, clear
   flag; pose changed → `lerpstart = cl.time`, shift current→previous, set current.
3. Blend, exactly `r_alias.c:131-148`, gated by
   `cvr.lerpmodels.value !== 0 && !(clmodel.nolerp && cvr.lerpmodels.value !== 2)`:
   - `LERP.finish` set and frame is not a group:
     `blend = clamp((cl.time - e.lerpstart) / (e.lerpfinish - e.lerpstart), 0, 1)`
   - else `blend = clamp((cl.time - e.lerpstart) / e.lerptime, 0, 1)`
   - if `blend === 1`: `e.previouspose = e.currentpose`
   - write pose1ofs = previouspose, pose2ofs = currentpose
   - not lerping: blend = 1, both offsets = candidate pose.

### `setupEntityTransform(e, originOut, anglesOut)` — new function in r.ts

Port of `R_SetupEntityTransform` (`r_alias.c:156-211`), out-params written and returned
(vec.ts convention). `resetmove` → snap previous/current to `e.origin`/`e.angles`,
clear flag; changed (compare with `e.currentorigin`/`e.currentangles`) →
`movelerpstart = cl.time`, shift current→previous, copy in new. Then, gated by
`cvr.lerpmove.value !== 0 && e !== cl.clState.viewent && (e.lerpflags & r.LERP.movestep) !== 0`:

- `LERP.finish`: `blend = clamp((cl.time - e.movelerpstart) / (e.lerpfinish - e.movelerpstart), 0, 1)`
- else: `blend = clamp((cl.time - e.movelerpstart) / 0.1, 0, 1)`
- origin: component-wise `previous + (current - previous) * blend`
- angles: same but wrap each delta into (-180, 180] (`r_alias.c:197-202`)

Not lerping: copy `e.origin`/`e.angles` through.

### `drawAliasModel` (r.ts:758) integration

- Keep the `cullBox` call on `e.origin` exactly as-is (see Non-goals).
- After culling, call `setupEntityTransform` into two scratch vectors; use them for
  `uOrigin` and the `uAngles` rotation matrix (r.ts:788-789) **and** for the
  `angleVectors` light direction basis (r.ts:842). Keep `lightPoint`/dlight
  accumulation on `e.origin` (Ironwail lights from the un-lerped origin,
  `r_alias.c:232`).
- Replace the frame-selection block (r.ts:851-868) with a `setupAliasFrame` call.
- Bind attributes (r.ts:869-872): `aPosition`/`aNormal` at `pose1ofs`,
  `aPosition2`/`aNormal2` at `pose2ofs` (same stride 24), `uBlend = blend`. When not
  lerping both offsets are equal and blend is 1 — one code path, no branching.
- Both the `'Alias'` and `'Player'` program branches get the new uniform/attributes.
- `drawViewModel` needs no changes — anim lerp flows through `drawAliasModel`, and the
  `e !== viewent` gate excludes the gun from movement lerp.

---

## Phase 3 — verification

1. `npx tsc --noEmit -p tsconfig.app.json` and `npm run build` pass.
2. Smoke test via dev server (`npm run start:dev`), start a game on e1m1 or run
   `playdemo demo1`, and verify:
   - Monsters animate smoothly (no 10 Hz frame snapping) — most visible on the
     zombies/knights walking at range.
   - Monsters **glide** rather than stutter-step when walking (movestep lerp).
   - Torches/flames (`progs/flame*.mdl`) still flicker discretely — nolerp list works.
   - Fire the shotgun: view weapon animation is smooth, but the muzzle-flash frame does
     not smear (resetanim2 path), and switching weapons doesn't blend between models.
   - Doors/plats still move smoothly (they are MOVETYPE_PUSH — untouched frac lerp).
   - Rotating pickups (EF_ROTATE) unaffected.
   - `r_lerpmodels 0; r_lerpmove 0` restores exact pre-change appearance.
   - Watch for any brush-surface blinking on a BSP2 map (regression signal — should be
     impossible since the world path is untouched, but check).
3. Multiplayer sanity: connect to the local game server (`npm run debug:gameserver`),
   confirm other-player models animate smoothly and `U.nolerp`-flagged monsters lerp.
