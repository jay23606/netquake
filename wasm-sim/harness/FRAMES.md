# Frame-level whole-frame validation — WASM sim vs. the live engine

The strongest ground-truth check: capture a **real server frame** (all edicts + globals +
time + the world model's 3 clip hulls) from the live engine on a running map, replay it
through the WASM `physicsFrame`, and diff bit-exact against what the engine actually
computed.

**Result (e1m1, 39 real frames):** 2,886 / 2,964 entity-frames bit-exact (~97.4%), 0
traps. The ~78 mismatches are all attributable to the known gaps — entities colliding
with the movers we neutralize (bmodel-hull gap), thinks calling still-stubbed host-service
builtins (`sound`/`cvar`), and uncaptured free-flags. Zero VM/physics bugs.

Manual (needs a live, actively-played game — the server only ticks under real input):

## 1. Temporary capture hook in `src/engine/sv.ts` `physics()`

Snapshot around the entity loop (AFTER `executeProgram(StartFrame)`, so the WASM
`physicsFrame` — which excludes StartFrame — starts from the same state), plus a one-time
world-hull dump. Flag-guarded; **remove after capturing** (it's in the server hot path).

```ts
// helpers (module scope):
const __snapEdicts = () => { const ne = state.server.num_edicts, ef = state.server.edicts[0].v_int.length;
  const buf = new Int32Array(ne*ef); for (let i=0;i<ne;i++) buf.set(state.server.edicts[i].v_int, i*ef); return {ne,ef,buf}; };
const __dumpWorldHull = () => { const wm:any = state.server.worldmodel;
  const cn=(a:any)=>a.map((c:any)=>({planenum:c.planenum,children:[c.children[0],c.children[1]]}));
  const hl=(h:any)=>({firstclipnode:h.firstclipnode,lastclipnode:h.lastclipnode,clip_mins:[h.clip_mins[0],h.clip_mins[1],h.clip_mins[2]],clipnodes:cn(h.clipnodes)});
  return {planes:wm.planes.map((p:any)=>({normal:[p.normal[0],p.normal[1],p.normal[2]],dist:p.dist,type:p.type})),hull0:hl(wm.hulls[0]),hull1:hl(wm.hulls[1]),hull2:hl(wm.hulls[2])}; };
// inside physics(), right after executeProgram(StartFrame):
const __fc:any=(globalThis as any).__frcap; const __on=!!(__fc&&__fc.on&&__fc.records.length<__fc.max);
const __fin:any=__on?{gi:pr.state.globals_int.slice(0),maxclients:state.svs.maxclients,time:state.server.time,...__snapEdicts()}:null;
if (__on && !__fc.worldhull) __fc.worldhull=__dumpWorldHull();
// after the entity loop, before force_retouch:
if (__fin) __fc.records.push({gi:__fin.gi,ei:__fin.buf,go:pr.state.globals_int.slice(0),eo:__snapEdicts().buf,ne:__fin.ne,ef:__fin.ef,time:__fin.time,maxclients:__fin.maxclients});
```

## 2. Arm + play (browser console)

```js
window.__frcap = { on: true, records: [], max: 40 };
// click into the game and MOVE CONTINUOUSLY for ~5s so the server ticks.
```

## 3. Replay (`frame_replay.js`, paste into the console)

Loads `sim.wasm` + the same progs via the runtime, installs the captured 3-hull world
model, and for each frame: sets globals+edicts from the IN snapshot, neutralizes movers
(`SOLID_BSP` non-world → `SOLID_NOT`, to avoid the un-ported bmodel-hull trap), runs
`physicsFrame`, and diffs every edict field of the non-client/non-mover entities vs the
engine's OUT snapshot. Reports matched/mismatched. `frametime` per frame = the delta to
the next capture's `time`.

## Closing the residual ~3% (the honest remaining work)
- bmodel/submodel hulls + `setmodel` (stop neutralizing movers → mover-collision matches),
- real `cvar`/`random`/`sound`... host-service values,
- capture free-flags (so dormant edicts aren't processed),
- `SV_Physics_Client` + `StartFrame` (the player).
