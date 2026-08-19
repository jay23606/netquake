# Server-on-Worker (single-player) — design & plan

## Motivation

Profiling Immortal Lock (9,521 simulated entities, 1.7M faces) showed the frame
splits into two roughly independent costs on the **same** main thread:

- **Server physics: ~14–17 ms every frame**, view-independent (9,521 entities ×
  per-entity dispatch/trace/link in JS; native C does this in <1 ms).
- **Render: 2.6 ms (open) → 17 ms (dense views)**, view-dependent.

Because both run on one thread, the render frame rate is *gated* by physics: even
the cheapest render view is stuck at ~50 fps because 15 ms goes to physics first.

Moving the **server simulation onto a Web Worker** decouples them: the render
thread paints as fast as the GPU/draw path allows, while physics runs on its own
core at its own rate. This does **not** make physics faster (WASM would, later) —
it stops physics from blocking render. For 99% of maps this already isn't the
bottleneck; this targets extreme entity-count maps.

## Why it's tractable (scoping verdict)

- The in-page server↔client link is **already a client/server connection over a
  byte-serialized loopback** (`src/app/game/net/loop.ts`). Bytes cross only there.
- A **headless dedicated server already exists** (`src/server/`, `host.init(true, …)`)
  and already skips every renderer/DOM/GL/sound subsystem — it is the Worker
  server template.
- The server sim path (`sv`, `pr`, `pf`, `ed`, world/trace/move, collision-only
  `mod`) touches **no** main-thread-only API; all GL/DOM work is gated behind
  `!host.state.dedicated` / `GL.getContext()`.
- Only **4 narrow direct sv↔cl couplings** bypass the message protocol (all trivial).
- One real structural cost: the parsed `Model` is shared by reference today; a
  Worker split means the BSP is **parsed twice** — collision-only in the worker
  (the existing dedicated gate), render-only on main. Only the BSP **file bytes**
  (an ArrayBuffer) need to reach both sides.

## Transport shape

Today `loop.ts` is synchronous: `sendMessage` writes the framed datagram
(`[type][len:3]+payload`) directly into the peer socket's `receiveMessage` queue;
`getMessage` drains it in the same tick.

Worker version keeps the identical framing but the queue is fed asynchronously:
- main→worker and worker→main move the framed bytes via `postMessage` (transfer
  the ArrayBuffer; or a SharedArrayBuffer ring later for lower latency).
- each side's `onmessage` appends into its own `receiveMessage` queue; `getMessage`
  drains exactly as today. Adds ~1 frame of latency (a ~0-ping local link).

## Coupling fixes (bypass the message protocol — must remove)

1. `sv.ts:3214` `scr.state.centertime_off = 0.0` in spawnServer → drop (client
   resets its own screen on new map) or send as a message.
2. `sv.ts:2189` `v.calcRoll(...)` reads client cvars `cl_rollangle`/`cl_rollspeed`
   → give the server its own cvars / inline the math; drop the `sv→v` import.
3. `cl.ts` reads `sv.state.server.active` at 5 sites (1073, 1131, 1291, 1307, 1798)
   purely as "is there a same-process server" → replace with a client-owned
   `isLocalServer` boolean set from the connection type.

## Phased plan

- **P0 — transport skeleton (no worker yet).** Add a postMessage-style loop driver
  pair behind the `INetworkDriver` interface; unit-shape it against the existing
  synchronous loop so framing/queue behavior is identical. *(reviewable in isolation)*
- **P1 — worker bootstrap.** Worker entry that runs the dedicated host
  (`host.init(true, workerAssetStore, [workerLoop, …])`) + its own async asset
  channel for spawnServer's BSP/.lit fetch and precache_model. Collision-only parse.
- **P2 — wire SP launch through the worker.** Main thread starts the worker,
  connects the client over the worker-loop, renders from received state. Main
  parses the BSP render-only; worker parses collision-only; BSP bytes shipped to both.
- **P3 — remove the 4 couplings; replicate the handful of server-read cvars.**
- **P4 — verify** on id1 + a heavy map (Immortal Lock): correctness (movement,
  triggers, saves), and measure render fps decoupled from physics.

## Status

Branch `server-worker` (local). Launch with the `-worker` flag; the default
in-process `loop.ts` path is untouched.

- **P0–P3 done.** Transport (`workerLoop`/`workerServer`), worker bootstrap
  (`serverWorker`/`workerSys`), SP wired through the worker, and all four sv↔cl
  couplings removed (sv owns `cl_rollangle`/`cl_rollspeed` + inlines `calcRoll`,
  drops the `centertime_off` write; client-owned `cls.isLocalServer`). SP verified
  signon-4 no-error on e1m1 both in-process and `-worker`.
- **P4 partial.** Render-only BSP parse for the worker-mode client (skip
  clipnodes/hull0 behind `modelNeedsCollision`). Decoupling observed: the render
  thread runs ~240 fps while the worker grinds a heavy spawn.

### The double-parse memory risk (open question above) — how it actually played out

The worker's collision parse is cheap; the real problem was the **render-side
`Model` on the main thread**. Immortal Lock retained ~2 GB of JS *objects*
(Face + Node + Leaf), pushing the main isolate over its ~4192 MB cap. Fixed by
converting those to Model-owned typed-array SoA and dropping the objects on the
worker-mode client (it only renders, so it walks the flat arrays):

- Face SoA — `5540c26` (dead bbox), `a3d5aa5` (styles/extents/texturemins).
- Node drop — `fa44c9e` (flat `pointInLeaf`/`recursiveLightPoint`/
  `splitEntityOnNode`; `loadmodel.nodes = []` on the worker client).
- Leaf drop — `2f3d556` (flat `leafVisofs`/`leaf{First,Num}Marksurface`/
  `leafAmbientLevel`/`leafEfrags`; `pointInLeaf` returns a leaf index;
  `loadmodel.leafs = []`). Asserted in `verifyFlatBsp` (`c73306d`).

Result: **Immortal Lock loads and plays in worker mode at ~211 fps** (steady
~2.1 GB, down from 3.25 GB). The flat encoding is validated at load by
`verifyFlatBsp` and the whole branch clears the production build.

### Open

- Foreground visual confirm of the leaf-drop render path (e1m1 + ad_tears
  identical to in-process) — blocked on a foregrounded tab (hidden tabs throttle
  the heavy async load below the automation eval limit).
- The P4 headline metric: measure in-game render fps vs physics decoupling on
  Immortal Lock in worker mode (needs a foreground tab).

## Risks / open questions

- Input latency: client move → worker → sim → state back → render is now async
  (~1 frame). SP prediction is absent today, so this is a small, likely-acceptable
  bump; measure it.
- Save/load and `changelevel` cross the boundary (they run server-side) — the
  existing save system is server-side already; confirm it works headless.
- Double parse memory: collision parse in the worker is cheap (no faces/textures),
  but it's a second copy of nodes/planes/clipnodes/hulls — measure worker heap.
- Fallback: keep the synchronous in-process loop driver available; select
  worker-vs-inprocess at launch so we can A/B and ship behind a flag.
