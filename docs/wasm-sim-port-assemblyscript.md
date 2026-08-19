# WASM sim port — AssemblyScript execution plan & porting guide

Companion to `wasm-sim-port.md` (the C-readiness assessment / ABI). That doc's
analysis stands; this doc records the **decision to use AssemblyScript** as the
WASM vehicle and is the working guide agents follow.

## Why AssemblyScript

- Zero external toolchain — `npm i -D assemblyscript`, `npx asc`. No emsdk, no
  admin, no per-shell env sourcing. (There is no C/WASM compiler on this box.)
- The sim is already TypeScript, so a port is TS→AS (a strict TS subset), not a
  rewrite — the mechanical bulk is delegable.
- Self-contained verify loop: `asc` compiles, Node instantiates, the harness
  diffs WASM output against the JS sim bit-for-bit.
- Output runs ~1.1–1.5× of hand-C for this typed-array/loop profile, i.e. it
  captures essentially all the WASM upside (see the perf analysis: the win is the
  sim tick + jitter-free frames, NOT render fps, which the worker split already
  banked).

## THE parity rule (read this first — it is the whole game)

The JS sim is the reference. A port is correct **only if bit-identical**. The JS
VM reads f32 from `Float32Array`, computes in **f64** (all JS numbers are f64),
and rounds to f32 **once**, on the store. AssemblyScript does NOT do this
implicitly — `f32 * f32` computes in f32 and diverges. So:

> **Every arithmetic op: widen f32 operands to f64, compute in f64, store f32 once.
> Preserve the JS accumulation order (a dot product is one f64 expression, one
> store — never three rounded partials).**

Use the `abi.ts` helpers, which bake this in:

```ts
import { gf, gi, setf, seti } from "./abi";
setf(g, c, gf(g, a) * gf(g, b));   // gf() returns f64; setf() rounds once to f32
```

`gf` reads `<f64>load<f32>(...)`; `setf` does `store<f32>(..., <f32>value)`. If you
hand-write memory access, mirror this exactly. Add/sub of two f32 always match
regardless; mul/div/dot are where a naive f32 port diverges by up to 1 ulp.

## Layout

```
wasm-sim/
  assembly/            # the AS source (compiles to build/sim.wasm)
    abi.ts             # memory layout + parity helpers (gf/gi/setf/seti) — SHARED, treat read-only
    index.ts           # re-exports every module; add `export * from "./<mod>"` when you land one
    math.ts            # DONE: pure vec math (boxOnPlaneSide, anglemod)
    vmcore.ts          # DONE: VM arithmetic opcode slice (the globals-union pattern)
    <yours>.ts         # new modules go here
  harness/
    lib.mjs            # loadWasm(), rng() (deterministic), Check (bit-exact float/int asserts)
    *.test.mjs         # one golden test per module; the JS reference is transliterated inline
  run.mjs              # `node wasm-sim/run.mjs` = compile + run ALL tests. Must be all-PASS.
  asconfig.json
```

## How to port a module (the loop)

1. Read the JS source in `src/engine/<x>.ts`. Identify pure vs host-dependent
   (see the builtin split in `wasm-sim-port.md`). Host-dependent calls become
   `declare function` imports — stub them for now and note them.
2. Write `assembly/<x>.ts`. Follow the parity rule. Use `abi.ts` helpers for any
   globals/edict-field access. QC pointers are byte offsets; a global index is
   `offset >> 2`.
3. Add `export * from "./<x>";` to `assembly/index.ts`.
4. Write `harness/<x>.test.mjs`: transliterate the JS reference inline, drive both
   with `rng()` inputs (thousands of cases), assert with `Check` (bit-exact via
   Float32 bit patterns, not `===`). Copy `math.test.mjs` as the template.
5. `node wasm-sim/run.mjs` → all PASS. Never finish red.

### AS gotchas (TS that doesn't carry over)

- No `any`, no union types, no closures capturing locals, no structural objects.
  Model structs as either (a) fields in linear memory addressed by offset, or
  (b) an AS `class` with typed fields (has GC overhead — avoid in hot loops).
- Integers are typed: `i32`/`u32`/`i64`/`usize`. Floats: `f32`/`f64`. Casts are
  explicit: `<f64>x`, `<i32>x`. `<i32>` of a float truncates toward zero (JS `| 0`
  / `ToInt32` semantics differ for out-of-range — note any hot bitops on big values).
- `load<T>(ptr)` / `store<T>(ptr, v)` for raw memory. `memory.data(n)` reserves a
  static region and returns a constant pointer (used for GLOBALS in abi.ts).
- Arrays: prefer `StaticArray<T>` / typed views over `Array<T>` in hot paths.
- Exported functions are callable from JS; `@inline` helpers are not exported.

## Port order (dependency-ranked)

Each stage is independently parity-testable, so they can proceed in parallel on
separate module files (only `index.ts` is shared — append, don't rewrite).

1. **math.ts** — DONE. Pattern-setter.
2. **vmcore → vm.ts** — the QC interpreter (`pr.ts executeProgram`, the big opcode
   switch). Highest perf value, most mechanical. Extend the `vmcore.ts` opcode
   slice into the full `execute(fnum)` loop over a flat statement array. Host-side
   ops (OP.call into builtins, string ops) call imports/stubs initially. Test:
   run a real progs.dat program in JS and WASM, diff `globals_float`.
3. **world.ts** — collision/trace (`sv.ts` hull trace / clip / recursiveHullCheck,
   `mod` hull SoA, pointInLeaf). Self-contained given a hull; test with synthetic
   hulls + random rays. Hot path.
4. **builtins-pure.ts** — the PURE builtins from `pf.ts` (vector math, setorigin/
   setsize, traceline, pointcontents, ftos/vtos, find/findradius). ~grunt work,
   many small functions; depends on vm + world for the trace-backed ones.
5. **host.ts** — `declare function` imports for the HOST-SERVICE builtins
   (print, msg_write*, cvar get/set, precache, changelevel). Just the import
   surface + the dispatch that routes builtin numbers to them.
6. **sv physics / movement / link** — integration tier; needs entities + world.
   Port last, test at the whole-frame level once the pieces exist.

## Scope reality

A fully **in-game-verified** port is NOT an overnight deliverable — final bring-up
needs the foreground browser/worker loop (only the user can drive that, per the
server-worker notes). The overnight target is: **compiling, unit-parity-tested**
modules (verified against golden vectors in Node) for stages 1–4, so the hot paths
(VM dispatch + trace) are proven bit-exact and ready for in-browser integration
with the user later.

## STATUS — overnight autonomous run (branch `wasm-sim`)

Every module below compiles standalone AND links into the unified `sim.wasm`, and
is verified BIT-EXACT against a JS reference transliterated from the engine source.
`node wasm-sim/run.mjs` runs the whole suite. **~6M+ bit-exact cases, all green.**

| Module | Ports (engine source) | Notes |
|---|---|---|
| `math.ts` | `vec.ts` boxOnPlaneSide, anglemod | pattern-setter |
| `vm.ts` | `pr.ts` executeProgram — all 66 opcodes + control flow + enter/leaveFunction | host-import stubs for edict/string/builtin (see below) |
| `world.ts` | `sv.ts` recursiveHullCheck, hullPointContents, pointContents | **f64 throughout** (not f32) — this path is never f32-quantized in JS |
| `builtins_math.ts` | `pf.ts` makevectors, normalize, vlen, vectoyaw, vectoangles | **AS native Math.sin/cos/atan2 == V8 bit-for-bit** — no host import needed |
| `ed.ts` | contiguous edict field block (design-doc blocker #1) | **heap.alloc does NOT zero-init in AS** → memory.fill added |
| `strings.ts` | `pr.ts` string heap + `pf.ts` ftos/vtos | **ftos/vtos need host formatter imports** — AS f64.toString renders 0 as "0.0", and AS has no toFixed |
| `svmove.ts` | `sv.ts` areanode tree, LinkEdict, SV_Move (box-entity path) | reuses world.ts's shared clipnode storage (reserved high indices) + restores hull meta |
| `builtins_world.ts` | `pf.ts` traceline, setorigin, setsize, pointcontents, droptofloor | composes svmove + world + ed |

### The host-import ABI surface catalogued so far

These are the JS functions the WASM sim will import (the "syscalls"):
- **module `vm`** (declared in `vm.ts`, to be BOUND to real modules — see below):
  `callBuiltin(n)`, `stringsEqual(a,b)`/`stringIsEmpty(ofs)` (→ `strings.ts`),
  `edictLoadInt(ent,field)`/`edictStoreInt(ent,field,bits)` (→ `ed.ts`),
  `isServerLoading()`, `hostError(code)`.
- **module `strings`**: `host_tostring(v,outPtr)`, `host_tofixed1(v,outPtr)` (JS runs
  the real V8 formatter into wasm memory — byte-exact by construction).

### Two integration gotchas (learned the hard way)

- **Shared mutable world-hull state.** `world.ts`'s hull range + clipnode/plane
  storage is module-global. `svmove.ts` borrows a reserved high-index region
  (`maxClipnodes-6 .. -1`) for its ephemeral box hulls and restores `setHullMeta`
  before returning. Keep world-hull node counts below that region.
- **Export-name collisions.** Several modules export `globalsPtr` /
  `writeGlobalFloat` / `readGlobalInt` (a shared harness convenience), and
  `svmove`/`builtins_world` `export *` their dependencies. So `index.ts` re-exports
  the later modules SELECTIVELY (own symbols only) — a blind `export *` duplicates.

## REMAINING — the assemble-and-run tier (do WITH the user)

The compute + collision + movement core is done and bit-exact. What's left is
plumbing that culminates in whole-frame verification, which needs the worker/browser
loop only the user can drive:

1. **Bind the VM to ed/strings.** Edit `vm.ts` to `import { edLoadInt, edStoreInt }
   from "./ed"` and `{ stringsEqual, stringIsEmpty } from "./strings"` — replacing the
   `declare function` host stubs with direct AS-level compiled calls (NOT JS-round-trip
   imports, which would be slow). Rework `vm.test.mjs` to set up real ed/strings state
   instead of stub imports. Turns the VM into a real QC executor. Deferred overnight
   (fiddly test rework), but low-risk (harness-gated).
2. **`host.ts` import surface + builtin dispatch.** The `callBuiltin(n)` table
   (builtin number → function), routing PURE builtins to the ported functions and the
   HOST-SERVICE builtins (print/sound/msg-write/cvar/precache/changelevel — see the
   PURE/HOST split in `wasm-sim-port.md`) to JS imports.
3. **Physics remainder.** The motion core (SV_FlyMove/PushEntity/Physics_Toss motion,
   `svphysics.ts`) is isolable and parity-testable; the rest of `SV_Physics` (the
   per-movetype dispatch, SV_RunThink's QC think() call, SV_Physics_Pusher/movers,
   touch dispatch via SV_Impact) needs the VM binding (#1) to run QC.
4. **Worker wiring.** Replace the JS sim behind the existing server-worker byte
   interface with the WASM module (the worker split was step one of this). The
   byte-serialized transport buffers can BE the wasm linear memory (no per-frame
   marshaling tax).
5. **Whole-frame parity harness.** Capture golden input→output vectors by running the
   headless Node dedicated server sim, then diff the WASM sim's `globals_float`/edict
   fields against them per frame — the design doc's "free port-validation harness".
6. **Foreground in-game bring-up** — the actual play test. User-driven.
