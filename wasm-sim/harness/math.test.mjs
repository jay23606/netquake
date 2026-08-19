// Golden parity test: math.ts (boxOnPlaneSide, anglemod) vs src/engine/vec.ts.
import { loadWasm, rng, Check } from './lib.mjs';

const x = await loadWasm({}, 'math.wasm');
const r = rng(0xB0B0F);

// --- JS reference, transliterated from vec.ts boxOnPlaneSide -----------------
function jsBoxOnPlaneSide(mins, maxs, n, dist, type, signbits) {
  if (type <= 2) {
    if (dist <= mins[type]) return 1;
    if (dist >= maxs[type]) return 2;
    return 3;
  }
  let d1, d2;
  switch (signbits) {
    case 0: d1 = n[0]*maxs[0]+n[1]*maxs[1]+n[2]*maxs[2]; d2 = n[0]*mins[0]+n[1]*mins[1]+n[2]*mins[2]; break;
    case 1: d1 = n[0]*mins[0]+n[1]*maxs[1]+n[2]*maxs[2]; d2 = n[0]*maxs[0]+n[1]*mins[1]+n[2]*mins[2]; break;
    case 2: d1 = n[0]*maxs[0]+n[1]*mins[1]+n[2]*maxs[2]; d2 = n[0]*mins[0]+n[1]*maxs[1]+n[2]*mins[2]; break;
    case 3: d1 = n[0]*mins[0]+n[1]*mins[1]+n[2]*maxs[2]; d2 = n[0]*maxs[0]+n[1]*maxs[1]+n[2]*mins[2]; break;
    case 4: d1 = n[0]*maxs[0]+n[1]*maxs[1]+n[2]*mins[2]; d2 = n[0]*mins[0]+n[1]*mins[1]+n[2]*maxs[2]; break;
    case 5: d1 = n[0]*mins[0]+n[1]*maxs[1]+n[2]*mins[2]; d2 = n[0]*maxs[0]+n[1]*mins[1]+n[2]*maxs[2]; break;
    case 6: d1 = n[0]*maxs[0]+n[1]*mins[1]+n[2]*mins[2]; d2 = n[0]*mins[0]+n[1]*maxs[1]+n[2]*maxs[2]; break;
    case 7: d1 = n[0]*mins[0]+n[1]*mins[1]+n[2]*mins[2]; d2 = n[0]*maxs[0]+n[1]*maxs[1]+n[2]*maxs[2]; break;
  }
  let sides = 0;
  if (d1 >= dist) sides = 1;
  if (d2 < dist) sides |= 2;
  return sides;
}

const box = new Check('boxOnPlaneSide');
for (let i = 0; i < 200000; i++) {
  const mins = [r.f32(500), r.f32(500), r.f32(500)];
  const maxs = [mins[0] + r.f32(0) + 500, mins[1] + 500, mins[2] + 500].map(Math.fround);
  const n = [r.f32(1), r.f32(1), r.f32(1)];
  const dist = r.f32(500);
  const type = r.int(4);       // exercise both axial (<=2) and general (3) paths
  const signbits = r.int(8);
  const w = x.boxOnPlaneSide(mins[0],mins[1],mins[2], maxs[0],maxs[1],maxs[2], n[0],n[1],n[2], dist, type, signbits);
  const j = jsBoxOnPlaneSide(mins, maxs, n, dist, type, signbits);
  box.intEq(w, j, `i=${i}`);
}

const ang = new Check('anglemod');
for (let i = 0; i < 100000; i++) {
  const a = r.f32(100000);
  // anglemod is f64-valued in both; require exact f64 equality (Object.is catches -0)
  const w = x.anglemod(a), j = (a % 360 + 360) % 360;
  ang.n++; if (!Object.is(w, j)) { ang.fails++; if (ang.samples.length < 5) ang.samples.push(`a=${a} wasm=${w} js=${j}`); }
}

const ok = [box.report(), ang.report()].every(Boolean);
process.exit(ok ? 0 : 1);
