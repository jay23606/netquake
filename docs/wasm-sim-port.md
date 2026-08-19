# WASM sim port — C-readiness assessment & prep plan

Speculative. Written to answer: *if we later port the hot server sim to C/WASM
for speed, what makes that easier, and what can we do now to prepare?*

## Scope: only the server sim is a WASM target

The render path stays JS/WebGL. WASM cannot drive WebGL without JS glue, and the
renderer is already fast enough (2.6–17 ms, GPU-bound) — the server-on-worker
split proved render isn't the bottleneck. The thing worth moving to C is the
**server simulation**, which costs ~14–17 ms/frame on extreme maps (Immortal
Lock, 9,521 entities) purely because per-entity dispatch/trace/link in JS is
~15× slower than native.

The WASM module boundary is therefore: `pr` (QuakeC VM), `pf` (builtins),
`sv` (physics/movement/link), `ed` (edict alloc/parse), `world`/trace/move, and
the **collision-only** parts of `mod` (hulls, clipnodes, `pointInLeaf`). Render,
net transport, asset I/O, sound, and the whole client stay in JS.

This boundary already exists: it is exactly the `!host.state.dedicated` gate the
dedicated server and the worker server run behind. The worker split (P0–P3) was,
in effect, step one of a WASM port — it isolated the sim into its own thread with
a byte-serialized message interface. A WASM port replaces the JS sim behind that
same interface with a compiled one.

## The good news: the sim is already ~70% C-shaped

Much of this fell out of the earlier GC-churn / memory-model work — the same
changes that removed per-frame allocation also removed the JS-object indirection
that resists C conversion:

- **QC VM globals** (`pr.ts`): `globals_int: Int32Array` and
  `globals_float: Float32Array` alias the *same* backing buffer — i.e. a union
  over linear memory, exactly Quake C's `pr_globals`. The interpreter is an
  opcode `switch` over these flat arrays. This transliterates to C almost
  literally.
- **Entity fields** (`Edict.v_float` / `v_int`): flat typed-array views over a
  per-edict `v: ArrayBuffer`, accessed by offset (`ed.v_float[entvars.origin]`).
  This mirrors `entvars_t` accessed as a float array. Field offsets
  (`pr.entvars.*`) are computed from the progs field defs at load, like C.
- **QC pointers are byte offsets** already: `edicts[Math.floor(ptr/edict_size)]`,
  `(ptr % edict_size - 96) >> 2`. Pointer arithmetic, not object graphs.
- **QC strings** (`pr.strings`): a flat char-code heap with offset handles
  (`getString(ofs)`, `newString`). This is `pr_strings` — a linear string table.
- **Builtins** (`pf.builtin[]`): an array indexed by builtin number — a
  function-pointer table. C makes it a `switch` or real function-pointer array.
- **Collision data** (`mod`): clipnodes, hulls, and planes already have flat SoA
  mirrors (`hull.flat`, `clipChildren`, `clipPlane`, `nodePacked`) from the
  memory-model + BSP-SoA work. Trace/Clip working structs are pooled.

## The import surface (the "syscalls")

A WASM sim module would import a small set of host functions from JS. Cataloguing
this precisely is the highest-value design artifact — it defines the ABI. First
pass, from the current dedicated/worker gating:

- **time** — the current sim time (host frame clock).
- **asset bytes** — BSP/.lit/progs.dat/precached model file bytes, by name.
  (Already async on the worker; a WASM sim would import a "read file into linear
  memory" callback.)
- **console print** — `sys.print` / `con.dPrint` relay.
- **cvar get/set** — the handful of server-read cvars (already narrowed in P3:
  the server owns `cl_rollangle`/`cl_rollspeed`, deathmatch/skill/etc.).
- **datagram out** — hand finished server→client messages to the transport.
- **rng / misc** — none needed for determinism; `Math.random`/`Date` are already
  banned in the engine and must stay out of the sim.

Everything else the sim does is pure numeric/edict math on linear memory — the
part that gets fast in C.

## Builtin classification (the ABI)

The QC builtin table (`pf.builtin[]`, classic set #1–78 plus the EBFS/DarkPlaces
and Kex-rerelease extension tables) splits cleanly into two groups. This split is
the WASM module's import boundary: **pure** builtins compile into the module and
touch only linear memory; **host-service** builtins become the imports the module
calls out to JS for.

### Pure — port directly into the WASM module (no imports)

Vector/entity/world math on globals + edicts + the collision BSP already in linear
memory. These are the bulk of per-frame cost and the whole point of the port:

- **Vector math:** `makevectors`, `normalize`, `vlen`, `vectoyaw`, `vectoangles`,
  `changeyaw`, `fabs`, `rint`, `floor`, `ceil`.
- **Entity lifecycle / query:** `spawn`, `remove`, `find`, `findradius`, `nextent`,
  `setspawnparms`.
- **World placement + collision (hot path):** `setorigin`, `setsize`, `setmodel`
  (indexes the already-loaded server model table), `traceline`, `pointcontents`,
  `checkbottom`, `droptofloor`, `walkmove`, `movetogoal`, `aim`.
- **String formatting:** `ftos`, `vtos` — pure arithmetic that writes into the QC
  string heap (linear memory); no host call, just sprintf-into-buffer.

### Host-service — become JS imports (grouped = the import list)

- **console/print:** `bprint`, `sprint`, `dprint`, `eprint`, `error`, `objerror`,
  `coredump`, `traceon`, `traceoff`, `breakstatement` → `print(level, strofs)` /
  `error(strofs)`.
- **network message out** (write into the server→client datagram/signon):
  `sound`, `ambientsound`, `particle`, `lightstyle`, `centerprint`, `makestatic`,
  and the `write*` family (`writeByte/Char/Short/Long/Coord/Angle/String/Entity`)
  → a small `msg_write*(dest, …)` import group, or a shared linear-memory write
  buffer the host drains.
- **client command / stuffing:** `stuffcmd`, `localcmd` → `clientCommand(clientnum,
  strofs)` / `localCommand(strofs)`.
- **cvar:** `cvar` (get), `cvar_set` → `cvarGet(strofs)` / `cvarSet(strofs, val)`.
  Already narrowed server-side in P3.
- **asset/precache:** `precache_model`, `precache_sound`, `precache_file` →
  `precache(kind, strofs)` (registers a name + triggers the async fetch the host
  already owns).
- **server control:** `changelevel` → `changeLevel(strofs)`; `checkclient` (PVS +
  client visibility — mostly pure PVS but reads client slots) → host or a hybrid.
- **rng:** `random` → must be a deterministic sim-owned PRNG or a host import;
  never `Math.random`/`rand()` if demos/saves must replay. Decide the seed policy
  as part of the ABI (Quake's `rand()` is nondeterministic across ports — a known
  demo-compat footgun).

`fixme` slots are unimplemented builtins (call the stub); they need no ABI.
The EBFS/DarkPlaces and Kex tables add more entries but follow the same split
(string ops → mostly pure heap work; `find*`/traces → pure; anything touching
messages/cvars/console → host). A full per-entry pass over those two tables is the
natural follow-up once the classic set's ABI shape is agreed.

## Remaining portability blockers (ranked)

Each notes whether fixing it **also** helps the current JS build (dual-benefit
work is worth doing regardless of whether the port ever happens).

1. **Contiguous edict area.** Today each `Edict` has its own `v: ArrayBuffer`.
   C wants one `sv.edicts` block with edict *i* at `i * edict_size`, so a QC
   entity pointer is a single base+offset. *Dual benefit:* one allocation
   instead of N, better cache locality in the physics walk. *Effort:* medium;
   touches every `v_float`/`v_int` access site (all offset-based already, so
   mechanical) plus ed alloc/free. *Needs in-browser verification* (behavioral).

2. **Builtin classification → ABI.** Split `pf.builtin[]` (~2100 lines) into
   (a) *pure* builtins (vector math, edict field ops, trace, PVS — portable to C
   directly) and (b) *host-service* builtins (print, cvar, string formatting,
   precache, network sound/effect messages — must call imports). This is pure
   analysis, **safe to do now**, and it produces the exact import list. *No JS
   benefit, but it's the port's blueprint.*

3. **`any` and closures in the physics hot path.** `sv.ts` has
   `trigger_edicts: any`, `solid_edicts: any`, `fatpvs: any[]`, and
   push/trigger gatherers that **allocate** result arrays
   (`gatherPushCandidates(): Edict[]`, `areaTriggerEdicts(list)`). C needs
   concrete types and caller-provided fixed buffers. *Dual benefit:* narrowing
   the types is runtime-neutral (types erase) and typecheck-guarded — **safe to
   do now**; converting the allocating gatherers to fill a pooled list also cuts
   current GC churn. *Effort:* low (types) to medium (pooling).

4. **String heap as bytes.** `pr.strings` is `number[]`; a `Uint8Array` heap is
   more C-faithful and less GC. The friction point is the *boundary*: `getString`
   returns a JS `string` for host use — in C that stays an offset and only host
   imports materialize it. Audit where the sim itself needs a JS string vs just
   an offset. *Dual benefit:* smaller, faster. *Effort:* low–medium.

5. **Float precision / parity model.** The VM computes in f64 and rounds to f32
   only on the typed-array store; a naive `float` C port would round every op and
   diverge on mul/div/dot products, breaking demo/save parity across the switch.
   The fix is a parity model, not `fround`: port as *double intermediate → float
   store*. See "Float precision" above. *Now:* the audit is done (that section);
   the decision (parity target + double-intermediate rule) is the deliverable.
   *Effort:* audit done; a per-op divergence table is optional follow-up.

6. **Fixed-capacity working storage.** `leafnums: number[]`, localstack growth,
   the areanode lists — C wants bounded pools. Trace/Clip are already pooled;
   extend the pattern. *Dual benefit:* less churn. *Effort:* medium.

## Float precision: JS f64-intermediate vs C float (parity model)

How the VM actually computes (verified in `pr.ts`): reads come from
`globals_float` (a `Float32Array`, so f32), the operation runs in JS number math
(**f64**), and the result rounds to f32 only on the store back into the
`Float32Array`. There is no `Math.fround` anywhere in the sim — the single
round-to-f32 per result comes from the typed-array store. Example (OP_MUL_F):

    globals_float[c] = globals_float[a] * globals_float[b]
    //     f32 store        f32 read     f64 multiply    f32 read

Consequences for a C port:

- **Add/sub of two f32 operands match exactly.** The f64 sum of two f32 values is
  representable, and rounding it to f32 gives the same result a true-f32 add
  would. No divergence.
- **Mul/div can differ by up to 1 ulp** under a naive `float` C port: `f64(a*b)`
  then rounded to f32 is not always equal to `f32(a*b)` (double rounding).
- **Dot products / `mul_v` accumulate worse.** `a*b + a*b + a*b` computed in f64
  and stored once (as the VM does) rounds once; the same expression in pure C
  `float` rounds after every add. Different result, and the order matters.

**The parity model that avoids all of this:** a C port that uses `double` locals
for intermediates and stores results to `float` fields — i.e. mirrors exactly what
JS does with `Float32Array` — is bit-identical to the current JS engine. This is
also historically closer to id's original x87 build (80-bit intermediates, round
on store) than a pure-`float` SSE port would be. So the guidance is concrete:

- Port arithmetic as **double intermediate → float store**, not pure float. Keep
  the VM's accumulation order (notably the single-round dot products).
- Decide the parity target up front: if demos/saves must replay across the JS↔WASM
  switch, the double-intermediate model preserves it; a pure-float port breaks it.
- This also gives a **free port-validation harness**: run the JS and WASM sims on
  the same inputs and diff `globals_float`/edict fields — any mismatch is a
  precision-model bug in the port. (We already saw precision bite once: the
  `vectoangles` builtin truncated angles to int and had to move to float — same
  class of bug, caught late.)

## Recommended prep order

Lead with the zero-risk / dual-benefit items — they improve the current JS build
whether or not a port ever happens, and several need no browser:

1. **(now, safe)** Builtin classification doc + import surface — the ABI (#2).
2. **(now, safe)** Narrow the sim-path `any` types to concrete types (#3, types
   only — runtime-neutral, typecheck-guarded).
3. **(now, safe)** Float32-intermediate audit notes (#5, doc only).
4. **(needs browser verify)** Contiguous edict area (#1) — biggest structural
   step and a real JS locality win.
5. **(needs browser verify)** Pool the push/trigger gatherers + string heap to
   bytes (#3 pooling, #4).

None of this commits us to a port. It's all either documentation or refactoring
that makes the current JS sim leaner and more predictable, with the side effect
of leaving a C transliteration a mechanical exercise rather than a rewrite.
