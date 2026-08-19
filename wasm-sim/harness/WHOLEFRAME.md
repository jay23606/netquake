# Whole-frame validation — WASM VM vs. the live JS engine (ground truth)

Two independent validations back the WASM QuakeC VM:

1. **Node differential** (`progs_smoke.test.mjs`, autonomous, in `run.mjs`): loads real
   `id1_progs.dat` and runs 629 builtin-free vanilla functions through both the WASM VM
   and a JS transliteration of the interpreter — **~904M bit-exact comparisons, 0
   mismatches**.
2. **Browser whole-frame** (this doc): captures real `executeProgram` I/O — including
   entity state — from the *live engine* on a running map, replays it through the WASM
   VM, and diffs bit-exact against ground truth. **Result: 15/22 functions bit-exact
   (globals + all edict fields); every divergence explained by an un-wired host builtin
   (`cvar`, `find`, `checkclient`, `movetogoal`), zero VM bugs.**

The browser path is manual (needs a live game + a foregrounded, pointer-locked tab).
Steps to reproduce:

## 1. Temporary capture hook in `src/engine/pr.ts`

Inside `executeProgram(fnum)`, right after `var exitdepth = state.depth;` (before
`enterFunction`), snapshot globals + edicts in; and at the top-level return
(`if (state.depth === exitdepth)`), snapshot out and push a record. Flag-guarded, so
it is a no-op unless `globalThis.__qccap` is armed. **Remove after capturing** — it
does a `globalThis` read per QC call, which is not free in the hot path.

```ts
// entry (before enterFunction):
const __cap: any = (globalThis as any).__qccap;
const __capOn: boolean = !!(__cap && __cap.on && __cap.records.length < __cap.max);
const __capGi: Int32Array | null = __capOn ? state.globals_int.slice(0) : null;
let __capEi: Int32Array | null = null, __capNe = 0, __capEf = 0;
if (__capOn) {
  __capNe = sv.state.server.num_edicts;
  __capEf = sv.state.server.edicts[0].v_int.length;
  __capEi = new Int32Array(__capNe * __capEf);
  for (let __i = 0; __i < __capNe; __i++) __capEi.set(sv.state.server.edicts[__i].v_int, __i * __capEf);
}
// at top-level return (state.depth === exitdepth), before `return;`:
if (__capOn) {
  const __neo = sv.state.server.num_edicts;
  const __eo = new Int32Array(__neo * __capEf);
  for (let __i = 0; __i < __neo; __i++) __eo.set(sv.state.server.edicts[__i].v_int, __i * __capEf);
  __cap.records.push({ fnum, gi: __capGi, go: state.globals_int.slice(0), ei: __capEi, eo: __eo, ne: __capNe, neo: __neo, ef: __capEf });
}
```

## 2. Arm + capture (browser console, in a live in-game map)

```js
window.__qccap = { on: true, records: [], max: 60 };
// play for a moment so the server ticks; records fill to max.
```

## 3. Replay in-browser (the dev server serves the build artifacts)

Paste `wholeframe_replay.js` into the console. It fetches `build/sim.wasm` +
`build/id1_progs.dat`, loads the progs via `progsLoader.mjs`, then for each record:
sets globals-in, populates the WASM `ed` store from `ei`, `execute(fnum)`, and diffs
globals-out vs `go` and edict-out vs `eo`. Un-wired host builtins (via the `host`
import namespace) are the only expected source of divergence.
