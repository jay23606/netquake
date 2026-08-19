// Pure vector/plane math — ports of src/engine/vec.ts. No host imports, no
// linear-memory access (operands passed by value); the simplest parity pattern.

// vec.ts anglemod
export function anglemod(a: f64): f64 {
  return (a % 360.0 + 360.0) % 360.0;
}

// vec.ts boxOnPlaneSide. Plane passed as scalars so this stays pure. Returns 1|2|3
// (bitfield of sides). Arithmetic in f64 (dist1/dist2 are f64 in JS).
export function boxOnPlaneSide(
  minx: f64, miny: f64, minz: f64,
  maxx: f64, maxy: f64, maxz: f64,
  nx: f64, ny: f64, nz: f64,
  dist: f64, ptype: i32, signbits: i32,
): i32 {
  if (ptype <= 2) {
    // axial: compare against the box extent on that axis
    const emin = ptype == 0 ? minx : (ptype == 1 ? miny : minz);
    const emax = ptype == 0 ? maxx : (ptype == 1 ? maxy : maxz);
    if (dist <= emin) return 1;
    if (dist >= emax) return 2;
    return 3;
  }
  let dist1: f64 = 0, dist2: f64 = 0;
  switch (signbits) {
    case 0:
      dist1 = nx * maxx + ny * maxy + nz * maxz;
      dist2 = nx * minx + ny * miny + nz * minz;
      break;
    case 1:
      dist1 = nx * minx + ny * maxy + nz * maxz;
      dist2 = nx * maxx + ny * miny + nz * minz;
      break;
    case 2:
      dist1 = nx * maxx + ny * miny + nz * maxz;
      dist2 = nx * minx + ny * maxy + nz * minz;
      break;
    case 3:
      dist1 = nx * minx + ny * miny + nz * maxz;
      dist2 = nx * maxx + ny * maxy + nz * minz;
      break;
    case 4:
      dist1 = nx * maxx + ny * maxy + nz * minz;
      dist2 = nx * minx + ny * miny + nz * maxz;
      break;
    case 5:
      dist1 = nx * minx + ny * maxy + nz * minz;
      dist2 = nx * maxx + ny * miny + nz * maxz;
      break;
    case 6:
      dist1 = nx * maxx + ny * miny + nz * minz;
      dist2 = nx * minx + ny * maxy + nz * maxz;
      break;
    case 7:
      dist1 = nx * minx + ny * miny + nz * minz;
      dist2 = nx * maxx + ny * maxy + nz * maxz;
      break;
    default:
      unreachable();
  }
  let sides: i32 = 0;
  if (dist1 >= dist) sides = 1;
  if (dist2 < dist) sides |= 2;
  return sides;
}
