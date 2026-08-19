// Whole-frame replay — paste into the dev-server browser console AFTER capturing
// real executeProgram I/O into window.__qccap (see WHOLEFRAME.md). Loads the WASM
// sim + the same vanilla progs, replays each captured call with the engine's real
// edict state populated, and diffs globals + edict fields bit-exact vs the live
// engine. Divergences are attributed to the host builtins each function called.
(async () => {
  const wasmBytes = await fetch('/wasm-sim/build/sim.wasm').then(r => r.arrayBuffer());
  const progsBytes = new Uint8Array(await fetch('/wasm-sim/build/id1_progs.dat').then(r => r.arrayBuffer()));
  let inst; const mem = () => inst.exports.memory;
  const wa = (str, p) => { const s = String(str); const u8 = new Uint8Array(mem().buffer, p, s.length); for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i) & 0xff; return s.length; };
  let calls = [];
  const hostNS = new Proxy({}, { get: (t, k) => (...a) => { calls.push(k === 'host_unimplemented' ? 'builtin#' + a[0] : k); return 0; } });
  const imports = {
    env: { abort: (m, f, l, c) => { throw new Error('abort@' + l); } },
    vm: { isServerLoading: () => 0, hostError: (code) => { throw new Error('hostError:' + code); } },
    strings: { host_tostring: (v, p) => wa(v, p), host_tofixed1: (v, p) => wa(Number(v).toFixed(1), p) },
    host: hostNS,
  };
  inst = (await WebAssembly.instantiate(wasmBytes, imports)).instance;
  const x = inst.exports;
  const { loadProgs } = await import('/wasm-sim/harness/progsLoader.mjs');
  const progs = loadProgs(x, progsBytes);
  const ef = progs.entityfields, maxE = progs.maxEdicts;
  const wi = new Int32Array(mem().buffer, x.globalsPtr(), 11471);
  const wed = new Int32Array(mem().buffer, x.edictsBase(), maxE * ef);
  const perFn = {};
  for (const rec of window.__qccap.records) {
    wi.set(rec.gi); wed.fill(0); wed.set(rec.ei); calls = [];
    let trapped = false;
    try { x.execute(rec.fnum); } catch (e) { trapped = true; }
    let g = 0; for (let k = 0; k < 11471; k++) if (wi[k] !== rec.go[k]) g++;
    const eLen = Math.min(rec.ne, rec.neo) * ef; let e = 0; for (let k = 0; k < eLen; k++) if (wed[k] !== rec.eo[k]) e++;
    const s = perFn[rec.fnum] || (perFn[rec.fnum] = { n: 0, full: 0, trap: 0, host: new Set() });
    s.n++; if (trapped) s.trap++; else if (g === 0 && e === 0) s.full++;
    calls.forEach(c => s.host.add(c));
  }
  const sum = Object.entries(perFn).map(([fn, s]) => ({ fn: +fn, n: s.n, full: s.full, trap: s.trap, hostCalls: [...s.host] })).sort((a, b) => b.full - a.full);
  const clean = sum.filter(s => s.full === s.n && s.trap === 0);
  console.table(sum);
  console.log(`bit-exact functions (globals+edicts): ${clean.length}/${sum.length}; diverging functions all call a host builtin: ${sum.filter(s => s.full < s.n).every(s => s.hostCalls.length > 0)}`);
  return { clean: clean.length, total: sum.length, sum };
})();
