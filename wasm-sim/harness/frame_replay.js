// Frame-level replay — paste into the dev-server browser console AFTER capturing real
// server frames into window.__frcap (see FRAMES.md). Loads sim.wasm + the same progs via
// the runtime, installs the captured 3-hull world model, and replays each captured frame
// through the WASM physicsFrame, diffing every non-client/non-mover edict field bit-exact
// vs what the live engine actually computed. Movers are neutralized (SOLID_BSP non-world
// -> SOLID_NOT) to sidestep the un-ported bmodel-hull trap; they + the client are excluded.
(async () => {
  const { createSim } = await import('/wasm-sim/runtime/simhost.mjs?v=' + Date.now());
  const wasmBytes = await fetch('/wasm-sim/build/sim.wasm').then(r => r.arrayBuffer());
  const progsBytes = new Uint8Array(await fetch('/wasm-sim/build/id1_progs.dat').then(r => r.arrayBuffer()));
  const sim = await createSim(wasmBytes, { random: () => 0 });
  sim.loadProgs(progsBytes);
  const x = sim.exports, ef = 195, w = window.__frcap.worldhull;
  for (let i = 0; i < w.planes.length; i++) { const p = w.planes[i]; x.setPlane(i, p.normal[0], p.normal[1], p.normal[2], p.dist, p.type); }
  for (let i = w.hull0.firstclipnode; i <= w.hull0.lastclipnode; i++) { const c = w.hull0.clipnodes[i]; x.setClipNode(i, c.planenum, c.children[0], c.children[1]); }
  for (const h of [w.hull1, w.hull2]) for (let i = h.firstclipnode; i <= h.lastclipnode; i++) { const c = h.clipnodes[i]; x.setClipNode12(i, c.planenum, c.children[0], c.children[1]); }
  x.installHull1(w.hull1.firstclipnode, w.hull1.lastclipnode, w.hull1.clip_mins[0], w.hull1.clip_mins[1], w.hull1.clip_mins[2]);
  x.installHull2(w.hull2.firstclipnode, w.hull2.lastclipnode, w.hull2.clip_mins[0], w.hull2.clip_mins[1], w.hull2.clip_mins[2]);
  x.setMaxVelocity(2000); x.setGravityCvar(800); x.setGravityFieldIdx(-1);
  const recs = window.__frcap.records, mem = () => x.memory.buffer, G = x.globalsPtr(), EB = x.edictsBase();
  let match = 0, mismatch = 0, movers = 0, clients = 0, framesRun = 0, traps = 0;
  for (let f = 0; f < recs.length - 1; f++) {
    const rec = recs[f], ne = rec.ne, mc = rec.maxclients, frametime = recs[f + 1].time - rec.time;
    x.initAreaTree(-4096, -4096, -4096, 4096, 4096, 4096, 1024); x.initEntState(mc, ne); x.setNumEdicts(ne);
    new Int32Array(mem(), G, rec.gi.length).set(rec.gi);
    new Int32Array(mem(), EB, ne * ef).set(rec.ei.subarray(0, ne * ef));
    const neutral = new Set();
    for (let e = 0; e < ne; e++) { x.setEdictFree(e, 0); if (e !== 0 && x.edLoadFloat(e, 9) === 4) { x.edStoreFloat(e, 9, 0); x.edStoreFloat(e, 8, 0); neutral.add(e); } }
    try { x.physicsFrame(rec.time, frametime); } catch (e) { traps++; continue; }
    const wed = new Int32Array(mem(), EB, ne * ef); framesRun++;
    for (let e = 0; e < ne; e++) {
      if (e > 0 && e <= mc) { clients++; continue; }
      if (neutral.has(e)) { movers++; continue; }
      let mm = 0; for (let k = 0; k < ef; k++) if (wed[e * ef + k] !== rec.eo[e * ef + k]) mm++;
      if (mm === 0) match++; else mismatch++;
    }
  }
  console.log(`frames=${framesRun} traps=${traps} | entities bit-exact vs live engine: ${match}/${match + mismatch} (${(100 * match / (match + mismatch)).toFixed(1)}%) | excluded: ${movers} movers, ${clients} clients`);
  return { framesRun, match, mismatch, movers, clients, traps };
})();
