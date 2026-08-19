// Golden parity test: world.ts (recursiveHullCheck / hullPointContents / pointContents)
// vs the BSP clip-hull trace in src/engine/sv.ts. The JS reference below is a direct
// transliteration of sv.ts hullPointContents/recursiveHullCheck/pointContents,
// operating on a plain-object hull (clipnodes[]/planes[]) instead of the Hull/ClipNode/
// Plane types, so it is a 1:1 mirror of the real functions' control flow and arithmetic.
//
// world.ts compiles standalone (not part of index.ts/sim.wasm), so this test loads
// build/world.wasm directly instead of using lib.mjs's loadWasm().
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { rng, Check } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORLD_WASM = join(HERE, '..', 'build', 'world.wasm');

async function loadWorldWasm() {
  const bytes = readFileSync(WORLD_WASM);
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: { abort: (msg, file, line, col) => { throw new Error(`world.wasm abort @${line}:${col}`); } },
    // DEFAULT-NS: full host-import namespace defaults (later keys in this literal override).
    vm: { isServerLoading: () => 0, hostError: () => {} },
    strings: { host_tostring: () => 0, host_tofixed1: () => 0 },
    host: new Proxy({ host_pow: Math.pow }, { get: (t, k) => (k in t ? t[k] : () => 0) }),
    builtins_move: { host_random: () => 0, host_sin: Math.sin, host_cos: Math.cos },
    builtins_math: { host_sin: Math.sin, host_cos: Math.cos, host_atan2: Math.atan2 },
    builtins_math2: { host_sin: Math.sin, host_cos: Math.cos },
    svphysics: { host_watersplash: () => {}, host_hitsound: () => {} },
    svpusher: { host_sin: Math.sin, host_cos: Math.cos },
    svclient: { host_sin: Math.sin, host_cos: Math.cos },
  });
  return instance.exports;
}

const x = await loadWorldWasm();

// --- bit-exact f64 checker -----------------------------------------------------
// Trace.fraction/endpos/plane in the JS sim are plain (never-f32-quantized)
// numbers (see world.ts header comment), so parity here means exact f64 equality,
// not f32-rounded equality -- this is a STRICTER check than Check.floatEq, not a
// weaker one. Object.is (not ===) so -0/NaN mismatches are caught, same spirit as
// Check.floatEq's bit-pattern comparison.
class CheckF64 {
  constructor(name) { this.name = name; this.n = 0; this.fails = 0; this.samples = []; }
  eq(w, j, ctx = '') {
    this.n++;
    if (!Object.is(w, j)) { this.fails++; if (this.samples.length < 8) this.samples.push(`${ctx} wasm=${w} js=${j}`); }
  }
  report() {
    const ok = this.fails === 0;
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${this.name}: ${this.n - this.fails}/${this.n} bit-exact`);
    for (const s of this.samples) console.log('   ', s);
    return ok;
  }
}

// --- JS reference: transliterated from src/engine/sv.ts -------------------------
// CONTENTS_* (mod.ts): empty=-1 solid=-2 water=-3 slime=-4 lava=-5 sky=-6 origin=-7
// clip=-8 current_0=-9 .. current_down=-14 ladder=-16.
const CONTENTS_EMPTY = -1, CONTENTS_SOLID = -2, CONTENTS_WATER = -3;
const CONTENTS_CURRENT_0 = -9, CONTENTS_CURRENT_DOWN = -14;

function jsHullPointContents(hull, num, p) {
  while (num >= 0) {
    if (num < hull.firstclipnode || num > hull.lastclipnode) throw new Error('bad node number');
    const node = hull.clipnodes[num];
    const plane = hull.planes[node.planenum];
    let d;
    if (plane.type <= 2) d = p[plane.type] - plane.dist;
    else d = plane.normal[0] * p[0] + plane.normal[1] * p[1] + plane.normal[2] * p[2] - plane.dist;
    if (d >= 0.0) num = node.children[0];
    else num = node.children[1];
  }
  return num;
}

function jsPointContents(hull, p) {
  const cont = jsHullPointContents(hull, 0, p);
  if (cont <= CONTENTS_CURRENT_0 && cont >= CONTENTS_CURRENT_DOWN) return CONTENTS_WATER;
  return cont;
}

function jsRecursiveHullCheck(hull, num, p1f, p2f, p1, p2, trace) {
  if (num < 0) {
    if (num !== CONTENTS_SOLID) {
      trace.allsolid = false;
      if (num === CONTENTS_EMPTY) trace.inopen = true;
      else trace.inwater = true;
    } else {
      trace.startsolid = true;
    }
    return true;
  }
  if (num < hull.firstclipnode || num > hull.lastclipnode) throw new Error('bad node number');

  const node = hull.clipnodes[num];
  const plane = hull.planes[node.planenum];
  const child0 = node.children[0], child1 = node.children[1];
  let t1, t2;
  if (plane.type <= 2) {
    t1 = p1[plane.type] - plane.dist;
    t2 = p2[plane.type] - plane.dist;
  } else {
    t1 = plane.normal[0] * p1[0] + plane.normal[1] * p1[1] + plane.normal[2] * p1[2] - plane.dist;
    t2 = plane.normal[0] * p2[0] + plane.normal[1] * p2[1] + plane.normal[2] * p2[2] - plane.dist;
  }

  if (t1 >= 0.0 && t2 >= 0.0) return jsRecursiveHullCheck(hull, child0, p1f, p2f, p1, p2, trace);
  if (t1 < 0.0 && t2 < 0.0) return jsRecursiveHullCheck(hull, child1, p1f, p2f, p1, p2, trace);

  let frac = (t1 + (t1 < 0.0 ? 0.03125 : -0.03125)) / (t1 - t2);
  if (frac < 0.0) frac = 0.0;
  else if (frac > 1.0) frac = 1.0;
  const midf = p1f + (p2f - p1f) * frac;
  const mid = [p1[0] + frac * (p2[0] - p1[0]), p1[1] + frac * (p2[1] - p1[1]), p1[2] + frac * (p2[2] - p1[2])];
  const side = t1 < 0.0 ? 1 : 0;

  if (jsRecursiveHullCheck(hull, side === 0 ? child0 : child1, p1f, midf, p1, mid, trace) !== true)
    return false;

  if (jsHullPointContents(hull, side === 0 ? child1 : child0, mid) !== CONTENTS_SOLID)
    return jsRecursiveHullCheck(hull, side === 0 ? child1 : child0, midf, p2f, mid, p2, trace);

  if (trace.allsolid === true) return false;

  if (side === 0) {
    trace.plane.normal = [plane.normal[0], plane.normal[1], plane.normal[2]];
    trace.plane.dist = plane.dist;
  } else {
    trace.plane.normal = [-plane.normal[0], -plane.normal[1], -plane.normal[2]];
    trace.plane.dist = -plane.dist;
  }

  // backup loop reuses THIS call's own p1f/p2f/p1/p2 -- matches sv.ts exactly.
  let f2 = frac, m = mid.slice(), mf = midf;
  while (jsHullPointContents(hull, hull.firstclipnode, m) === CONTENTS_SOLID) {
    f2 -= 0.1;
    if (f2 < 0.0) {
      trace.fraction = mf;
      trace.endpos = m.slice();
      return false;
    }
    mf = p1f + (p2f - p1f) * f2;
    m = [p1[0] + f2 * (p2[0] - p1[0]), p1[1] + f2 * (p2[1] - p1[1]), p1[2] + f2 * (p2[2] - p1[2])];
  }
  trace.fraction = mf;
  trace.endpos = m.slice();
  return false;
}

function jsTrace(hull, sx, sy, sz, ex, ey, ez) {
  const trace = {
    fraction: 1.0, allsolid: true, startsolid: false, inopen: false, inwater: false,
    endpos: [ex, ey, ez], plane: { normal: [0.0, 0.0, 0.0], dist: 0.0 },
  };
  jsRecursiveHullCheck(hull, hull.firstclipnode, 0.0, 1.0, [sx, sy, sz], [ex, ey, ez], trace);
  return trace;
}

// --- Hull fixtures ---------------------------------------------------------------

// The vanilla box hull (sv.ts initBoxHull, with hullForEntity's dist assignment
// folded in directly): 6 axial planes/clipnodes, solid inside [lo,hi), empty outside.
function makeBoxHull(lo, hi) {
  const dist = [hi[0], lo[0], hi[1], lo[1], hi[2], lo[2]];
  const clipnodes = [], planes = [];
  for (let i = 0; i <= 5; i++) {
    const node = { planenum: i, children: [0, 0] };
    node.children[i & 1] = CONTENTS_EMPTY;
    node.children[1 - (i & 1)] = (i !== 5) ? i + 1 : CONTENTS_SOLID;
    clipnodes[i] = node;
    const normal = [0.0, 0.0, 0.0];
    normal[i >> 1] = 1.0;
    planes[i] = { type: i >> 1, normal, dist: dist[i] };
  }
  return { clipnodes, planes, firstclipnode: 0, lastclipnode: 5 };
}

// Random acyclic clip tree: child pointers either land on a strictly-later node
// index (guaranteeing termination, no cycles -- real BSPs are acyclic too, just
// not necessarily index-monotonic) or a leaf CONTENTS_* value. Mixes axial (type
// 0-2) and generic (type>=3, arbitrary unit normal) planes.
const LEAF_KINDS = [-1, -2, -3, -4, -5, -6, -7, -8, -9, -10, -11, -12, -13, -14, -16];

function pickChild(i, numNodes, r) {
  if (i + 1 >= numNodes || r.int(10) < 4) {
    // Bias toward CONTENTS_SOLID (index 1) so deeper/larger random trees still
    // produce plenty of genuine solid impacts (the split + backup-loop path),
    // not just the LEAF_KINDS uniform pick which makes solid rare at 1-in-15.
    return r.int(3) === 0 ? LEAF_KINDS[r.int(LEAF_KINDS.length)] : CONTENTS_SOLID;
  }
  return i + 1 + r.int(numNodes - i - 1);
}

function buildRandomHull(r, numNodes, range) {
  const clipnodes = [], planes = [];
  for (let i = 0; i < numNodes; i++) {
    let type, normal;
    if (r.int(2) === 0) {
      type = r.int(3);
      normal = [0.0, 0.0, 0.0];
      normal[type] = 1.0;
    } else {
      type = 3 + r.int(3); // 3/4/5, all take the generic dot-product path
      let nx = r.f32(1) || 0.3, ny = r.f32(1), nz = r.f32(1);
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      normal = [Math.fround(nx / len), Math.fround(ny / len), Math.fround(nz / len)];
    }
    const dist = r.f32(range);
    planes.push({ type, normal, dist });
    clipnodes.push({ planenum: i, children: [pickChild(i, numNodes, r), pickChild(i, numNodes, r)] });
  }
  return { clipnodes, planes, firstclipnode: 0, lastclipnode: numNodes - 1 };
}

function loadHullToWasm(hull) {
  x.setHullMeta(hull.firstclipnode, hull.lastclipnode);
  for (let i = 0; i < hull.planes.length; i++) {
    const p = hull.planes[i];
    x.setPlane(i, p.normal[0], p.normal[1], p.normal[2], p.dist, p.type);
  }
  for (let i = hull.firstclipnode; i <= hull.lastclipnode; i++) {
    const n = hull.clipnodes[i];
    x.setClipNode(i, n.planenum, n.children[0], n.children[1]);
  }
}

function wasmTrace(sx, sy, sz, ex, ey, ez) {
  x.trace(sx, sy, sz, ex, ey, ez);
  return {
    fraction: x.traceFraction(),
    endpos: [x.traceEndX(), x.traceEndY(), x.traceEndZ()],
    plane: { normal: [x.tracePlaneNX(), x.tracePlaneNY(), x.tracePlaneNZ()], dist: x.tracePlaneDist() },
    allsolid: x.traceAllSolid() !== 0,
    startsolid: x.traceStartSolid() !== 0,
    inopen: x.traceInOpen() !== 0,
    inwater: x.traceInWater() !== 0,
  };
}

function checkTrace(chk, w, j, ctx) {
  chk.frac.eq(w.fraction, j.fraction, ctx);
  chk.end.eq(w.endpos[0], j.endpos[0], ctx + ' endpos.x');
  chk.end.eq(w.endpos[1], j.endpos[1], ctx + ' endpos.y');
  chk.end.eq(w.endpos[2], j.endpos[2], ctx + ' endpos.z');
  chk.plane.eq(w.plane.normal[0], j.plane.normal[0], ctx + ' plane.normal.x');
  chk.plane.eq(w.plane.normal[1], j.plane.normal[1], ctx + ' plane.normal.y');
  chk.plane.eq(w.plane.normal[2], j.plane.normal[2], ctx + ' plane.normal.z');
  chk.plane.eq(w.plane.dist, j.plane.dist, ctx + ' plane.dist');
  chk.flags.intEq(w.allsolid ? 1 : 0, j.allsolid ? 1 : 0, ctx + ' allsolid');
  chk.flags.intEq(w.startsolid ? 1 : 0, j.startsolid ? 1 : 0, ctx + ' startsolid');
  chk.flags.intEq(w.inopen ? 1 : 0, j.inopen ? 1 : 0, ctx + ' inopen');
  chk.flags.intEq(w.inwater ? 1 : 0, j.inwater ? 1 : 0, ctx + ' inwater');
}

const results = [];

// === Test 1: single box hull, thousands of random rays, many box configs ========
{
  const chk = { frac: new CheckF64('box.fraction'), end: new CheckF64('box.endpos'), plane: new CheckF64('box.plane'), flags: new Check('box.flags') };
  const r = rng(0xB0B1);
  let backupLoopHits = 0, splitHits = 0;
  for (let iter = 0; iter < 20000; iter++) {
    const cx = r.f32(400), cy = r.f32(400), cz = r.f32(400);
    const hx = Math.abs(r.f32(200)) + 4, hy = Math.abs(r.f32(200)) + 4, hz = Math.abs(r.f32(200)) + 4;
    const lo = [cx - hx, cy - hy, cz - hz], hi = [cx + hx, cy + hy, cz + hz];
    const hull = makeBoxHull(lo, hi);
    loadHullToWasm(hull);

    let sx, sy, sz, ex, ey, ez;
    const mode = r.int(5);
    if (mode === 0) {
      // guaranteed fully inside
      sx = cx + r.f32(hx * 0.5); sy = cy + r.f32(hy * 0.5); sz = cz + r.f32(hz * 0.5);
      ex = cx + r.f32(hx * 0.5); ey = cy + r.f32(hy * 0.5); ez = cz + r.f32(hz * 0.5);
    } else if (mode === 1) {
      // guaranteed fully outside (well beyond on X)
      sx = hi[0] + hx * 3 + Math.abs(r.f32(50)); sy = r.f32(400); sz = r.f32(400);
      ex = hi[0] + hx * 4 + Math.abs(r.f32(50)); ey = r.f32(400); ez = r.f32(400);
    } else if (mode === 2) {
      // snapped exactly to a face coordinate (grazing/epsilon stress)
      const axis = r.int(3);
      const p = [r.f32(600), r.f32(600), r.f32(600)];
      p[axis] = r.int(2) === 0 ? lo[axis] : hi[axis];
      sx = p[0]; sy = p[1]; sz = p[2];
      ex = r.f32(600); ey = r.f32(600); ez = r.f32(600);
    } else {
      // broad random -- the main source of boundary-crossing coverage
      sx = r.f32(600); sy = r.f32(600); sz = r.f32(600);
      ex = r.f32(600); ey = r.f32(600); ez = r.f32(600);
    }

    const j = jsTrace(hull, sx, sy, sz, ex, ey, ez);
    const w = wasmTrace(sx, sy, sz, ex, ey, ez);
    if (j.fraction > 0 && j.fraction < 1) splitHits++;
    checkTrace(chk, w, j, `box#${iter} mode=${mode}`);

    // also exercise pointContents at a handful of sample points per iteration
    for (const p of [[sx, sy, sz], [ex, ey, ez], [cx, cy, cz]]) {
      chk.flags.intEq(x.pointContents(p[0], p[1], p[2]), jsPointContents(hull, p), `box#${iter} pointContents`);
    }
  }
  console.log(`   (box hull: ${splitHits} rays crossed a face)`);
  results.push(chk.frac.report(), chk.end.report(), chk.plane.report(), chk.flags.report());
}

// === Test 2: multi-node random hulls (mixed axial + generic planes, full CONTENTS
// range at leaves), several sizes, thousands of rays each =======================
for (const [label, numNodes, range, seed] of [
  ['small', 6, 300, 0xA11CE],
  ['medium', 40, 500, 0xB0B],
  ['large', 250, 800, 0xFEED5],
]) {
  const chk = { frac: new CheckF64(`multi.${label}.fraction`), end: new CheckF64(`multi.${label}.endpos`), plane: new CheckF64(`multi.${label}.plane`), flags: new Check(`multi.${label}.flags`) };
  const r = rng(seed);
  const hull = buildRandomHull(r, numNodes, range);
  loadHullToWasm(hull);

  for (let iter = 0; iter < 15000; iter++) {
    const sx = r.f32(range * 1.2), sy = r.f32(range * 1.2), sz = r.f32(range * 1.2);
    const ex = r.f32(range * 1.2), ey = r.f32(range * 1.2), ez = r.f32(range * 1.2);
    const j = jsTrace(hull, sx, sy, sz, ex, ey, ez);
    const w = wasmTrace(sx, sy, sz, ex, ey, ez);
    checkTrace(chk, w, j, `${label}#${iter}`);
    chk.flags.intEq(x.pointContents(sx, sy, sz), jsPointContents(hull, [sx, sy, sz]), `${label}#${iter} pointContents(start)`);
    chk.flags.intEq(x.pointContents(ex, ey, ez), jsPointContents(hull, [ex, ey, ez]), `${label}#${iter} pointContents(end)`);
  }
  results.push(chk.frac.report(), chk.end.report(), chk.plane.report(), chk.flags.report());
}

const ok = results.every(Boolean);
process.exit(ok ? 0 : 1);
