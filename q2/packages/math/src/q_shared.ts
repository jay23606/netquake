/**
 * File: q_shared.ts
 * Purpose: Provide the shared vector and scalar math helpers required by strict Quake II ports.
 *
 * This file is not a direct source port.
 * It gathers low-level helpers that support multiple runtime modules while preserving Quake-style naming.
 *
 * Dependencies:
 * - None
 */

/**
 * Original name: vec3_origin
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Provides the canonical zero vector shared by Quake II math call sites.
 */
export const vec3_origin: [number, number, number] = [0, 0, 0];

/**
 * Original name: N/A
 * Source: N/A (local tuple helper)
 * Category: New
 * Purpose: Clone a Quake-style vec3 tuple.
 *
 * Constraints:
 * - Must preserve tuple ordering and numeric values exactly.
 */
export function cloneVec3(vector: [number, number, number]): [number, number, number] {
  return [vector[0], vector[1], vector[2]];
}

/**
 * Original name: VectorClear
 * Source: game/q_shared.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Clears all vector components to zero.
 *
 * Porting notes:
 * - Mutates the provided tuple to mirror the original macro behavior.
 */
export function VectorClear(vector: [number, number, number]): void {
  vector[0] = 0;
  vector[1] = 0;
  vector[2] = 0;
}

/**
 * Original name: VectorNegate
 * Source: game/q_shared.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Negates three vector components from `input` into `output`.
 *
 * Porting notes:
 * - Mutates the explicit output tuple to mirror the original macro.
 */
export function VectorNegate(
  input: [number, number, number],
  output: [number, number, number]
): void {
  output[0] = -input[0];
  output[1] = -input[1];
  output[2] = -input[2];
}

/**
 * Original name: VectorSet
 * Source: game/q_shared.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Assigns three scalar components into one vector tuple.
 */
export function VectorSet(
  vector: [number, number, number],
  x: number,
  y: number,
  z: number
): void {
  vector[0] = x;
  vector[1] = y;
  vector[2] = z;
}

/**
 * Original name: VectorCopy
 * Source: game/q_shared.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Copies three vector components from `input` to `output`.
 *
 * Porting notes:
 * - Preserves in-place mutation semantics used throughout the original codebase.
 */
export function VectorCopy(
  input: [number, number, number],
  output: [number, number, number]
): void {
  output[0] = input[0];
  output[1] = input[1];
  output[2] = input[2];
}

/**
 * Original name: VectorAdd
 * Source: game/q_shared.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Adds two vectors component-wise into `output`.
 *
 * Porting notes:
 * - Keeps the original mutable output style instead of returning a new tuple.
 */
export function VectorAdd(
  left: [number, number, number],
  right: [number, number, number],
  output: [number, number, number]
): void {
  output[0] = left[0] + right[0];
  output[1] = left[1] + right[1];
  output[2] = left[2] + right[2];
}

/**
 * Original name: VectorSubtract
 * Source: game/q_shared.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Subtracts `right` from `left` component-wise into `output`.
 */
export function VectorSubtract(
  left: [number, number, number],
  right: [number, number, number],
  output: [number, number, number]
): void {
  output[0] = left[0] - right[0];
  output[1] = left[1] - right[1];
  output[2] = left[2] - right[2];
}

/**
 * Original name: VectorScale
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Scales a vector by `scale` into `output`.
 */
export function VectorScale(
  input: [number, number, number],
  scale: number,
  output: [number, number, number]
): void {
  output[0] = input[0] * scale;
  output[1] = input[1] * scale;
  output[2] = input[2] * scale;
}

/**
 * Original name: Q_fabs
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Clears the sign bit of one 32-bit float and returns the resulting absolute value.
 *
 * Porting notes:
 * - Uses explicit float32 reinterpretation to mirror the original integer mask implementation.
 */
export function Q_fabs(value: number): number {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setFloat32(0, value, true);
  view.setUint32(0, view.getUint32(0, true) & 0x7fffffff, true);
  return view.getFloat32(0, true);
}

/**
 * Original name: VectorMA
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Computes `output = vector + scale * addend`.
 */
export function VectorMA(
  vector: [number, number, number],
  scale: number,
  addend: [number, number, number],
  output: [number, number, number]
): void {
  output[0] = vector[0] + scale * addend[0];
  output[1] = vector[1] + scale * addend[1];
  output[2] = vector[2] + scale * addend[2];
}

/**
 * Original name: DotProduct
 * Source: game/q_shared.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the dot product of two vectors.
 */
export function DotProduct(left: [number, number, number], right: [number, number, number]): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

/**
 * Original name: CrossProduct
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Computes the cross product of `left` and `right` into `output`.
 */
export function CrossProduct(
  left: [number, number, number],
  right: [number, number, number],
  output: [number, number, number]
): void {
  output[0] = left[1] * right[2] - left[2] * right[1];
  output[1] = left[2] * right[0] - left[0] * right[2];
  output[2] = left[0] * right[1] - left[1] * right[0];
}

/**
 * Original name: VectorLength
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the Euclidean length of a vec3.
 */
export function VectorLength(vector: [number, number, number]): number {
  return Math.sqrt(DotProduct(vector, vector));
}

/**
 * Original name: VectorNormalize
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Normalizes the vector in place and returns the original length.
 *
 * Porting notes:
 * - Keeps the original in-place mutation contract.
 */
export function VectorNormalize(vector: [number, number, number]): number {
  const length = VectorLength(vector);
  if (length === 0) {
    return 0;
  }

  const inverseLength = 1 / length;
  vector[0] *= inverseLength;
  vector[1] *= inverseLength;
  vector[2] *= inverseLength;
  return length;
}

/**
 * Original name: _DotProduct
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Function-form alias of `DotProduct`.
 */
export function _DotProduct(left: [number, number, number], right: [number, number, number]): number {
  return DotProduct(left, right);
}

/**
 * Original name: _VectorSubtract
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Function-form alias of `VectorSubtract`.
 */
export function _VectorSubtract(
  left: [number, number, number],
  right: [number, number, number],
  output: [number, number, number]
): void {
  VectorSubtract(left, right, output);
}

/**
 * Original name: _VectorAdd
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Function-form alias of `VectorAdd`.
 */
export function _VectorAdd(
  left: [number, number, number],
  right: [number, number, number],
  output: [number, number, number]
): void {
  VectorAdd(left, right, output);
}

/**
 * Original name: _VectorCopy
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Function-form alias of `VectorCopy`.
 */
export function _VectorCopy(input: [number, number, number], output: [number, number, number]): void {
  VectorCopy(input, output);
}

/**
 * Original name: ClearBounds
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Initializes one mins/maxs pair to the canonical empty bounds state.
 */
export function ClearBounds(mins: [number, number, number], maxs: [number, number, number]): void {
  mins[0] = mins[1] = mins[2] = 99999;
  maxs[0] = maxs[1] = maxs[2] = -99999;
}

/**
 * Original name: AddPointToBounds
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Expands one mins/maxs pair to include the provided point.
 */
export function AddPointToBounds(
  point: [number, number, number],
  mins: [number, number, number],
  maxs: [number, number, number]
): void {
  for (let axis = 0; axis < 3; axis += 1) {
    const value = point[axis];
    if (value < mins[axis]) {
      mins[axis] = value;
    }
    if (value > maxs[axis]) {
      maxs[axis] = value;
    }
  }
}

/**
 * Original name: VectorCompare
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns `1` when all three vector components match exactly, else `0`.
 */
export function VectorCompare(left: [number, number, number], right: [number, number, number]): number {
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2] ? 1 : 0;
}

/**
 * Original name: VectorNormalize2
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Normalizes `input` into `output` and returns the original length.
 */
export function VectorNormalize2(
  input: [number, number, number],
  output: [number, number, number]
): number {
  const length = VectorLength(input);
  if (length === 0) {
    return 0;
  }

  const inverseLength = 1 / length;
  output[0] = input[0] * inverseLength;
  output[1] = input[1] * inverseLength;
  output[2] = input[2] * inverseLength;
  return length;
}

/**
 * Original name: VectorInverse
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Negates all three components in place.
 */
export function VectorInverse(vector: [number, number, number]): void {
  vector[0] = -vector[0];
  vector[1] = -vector[1];
  vector[2] = -vector[2];
}

/**
 * Original name: Q_log2
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the integer base-2 log obtained by repeated right shifts.
 */
export function Q_log2(value: number): number {
  let answer = 0;
  let remaining = value;
  while ((remaining >>= 1) !== 0) {
    answer += 1;
  }
  return answer;
}

/**
 * Original name: N/A
 * Source: N/A (local plane shape interface)
 * Category: New
 * Purpose: Describe the minimal plane shape consumed by the q_shared math helpers.
 *
 * Constraints:
 * - Must remain structurally compatible with `cplane_t` without introducing a package cycle.
 */
export interface PlaneLike {
  normal: [number, number, number];
  dist: number;
  type: number;
  signbits: number;
}

/**
 * Original name: R_ConcatRotations
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Concatenates two 3x3 rotation matrices into `output`.
 */
export function R_ConcatRotations(
  left: number[][],
  right: number[][],
  output: number[][]
): void {
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      output[row][column] =
        left[row][0] * right[0][column] +
        left[row][1] * right[1][column] +
        left[row][2] * right[2][column];
    }
  }
}

/**
 * Original name: R_ConcatTransforms
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Concatenates two 3x4 transform matrices into `output`.
 */
export function R_ConcatTransforms(
  left: number[][],
  right: number[][],
  output: number[][]
): void {
  for (let row = 0; row < 3; row += 1) {
    output[row][0] =
      left[row][0] * right[0][0] +
      left[row][1] * right[1][0] +
      left[row][2] * right[2][0];
    output[row][1] =
      left[row][0] * right[0][1] +
      left[row][1] * right[1][1] +
      left[row][2] * right[2][1];
    output[row][2] =
      left[row][0] * right[0][2] +
      left[row][1] * right[1][2] +
      left[row][2] * right[2][2];
    output[row][3] =
      left[row][0] * right[0][3] +
      left[row][1] * right[1][3] +
      left[row][2] * right[2][3] +
      left[row][3];
  }
}

/**
 * Original name: anglemod
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Wraps one angle into the Quake II 0..360 packed-angle range.
 */
export function anglemod(value: number): number {
  return (360.0 / 65536) * ((Math.trunc(value * (65536 / 360.0)) & 65535) >>> 0);
}

/**
 * Original name: ProjectPointOnPlane
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Projects one point onto the plane orthogonal to `normal`.
 */
export function ProjectPointOnPlane(
  output: [number, number, number],
  point: [number, number, number],
  normal: [number, number, number]
): void {
  const inverseDenominator = 1 / DotProduct(normal, normal);
  const distance = DotProduct(normal, point) * inverseDenominator;
  output[0] = point[0] - distance * normal[0] * inverseDenominator;
  output[1] = point[1] - distance * normal[1] * inverseDenominator;
  output[2] = point[2] - distance * normal[2] * inverseDenominator;
}

/**
 * Original name: PerpendicularVector
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Builds one normalized vector perpendicular to the normalized `source`.
 */
export function PerpendicularVector(
  output: [number, number, number],
  source: [number, number, number]
): void {
  let position = 0;
  let minimum = 1.0;

  for (let axis = 0; axis < 3; axis += 1) {
    const magnitude = Math.abs(source[axis]);
    if (magnitude < minimum) {
      minimum = magnitude;
      position = axis;
    }
  }

  const temp: [number, number, number] = [0, 0, 0];
  temp[position] = 1.0;
  ProjectPointOnPlane(output, temp, source);
  VectorNormalize(output);
}

/**
 * Original name: RotatePointAroundVector
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Rotates one point around the axis `dir` by `degrees`.
 *
 * Porting notes:
 * - Uses mutable JavaScript matrices while preserving the original computation order.
 */
export function RotatePointAroundVector(
  output: [number, number, number],
  dir: [number, number, number],
  point: [number, number, number],
  degrees: number
): void {
  const vr: [number, number, number] = [0, 0, 0];
  const vup: [number, number, number] = [0, 0, 0];
  const vf: [number, number, number] = [dir[0], dir[1], dir[2]];
  const m = createMatrix3x3();
  const im = createMatrix3x3();
  const zrot = createMatrix3x3();
  const tmpmat = createMatrix3x3();
  const rot = createMatrix3x3();

  PerpendicularVector(vr, dir);
  CrossProduct(vr, vf, vup);

  m[0][0] = vr[0];
  m[1][0] = vr[1];
  m[2][0] = vr[2];
  m[0][1] = vup[0];
  m[1][1] = vup[1];
  m[2][1] = vup[2];
  m[0][2] = vf[0];
  m[1][2] = vf[1];
  m[2][2] = vf[2];

  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      im[row][column] = m[column][row];
    }
  }

  zrot[0][0] = zrot[1][1] = zrot[2][2] = 1.0;
  const radians = (degrees * Math.PI) / 180.0;
  zrot[0][0] = Math.cos(radians);
  zrot[0][1] = Math.sin(radians);
  zrot[1][0] = -Math.sin(radians);
  zrot[1][1] = Math.cos(radians);

  R_ConcatRotations(m, zrot, tmpmat);
  R_ConcatRotations(tmpmat, im, rot);

  for (let index = 0; index < 3; index += 1) {
    output[index] = rot[index][0] * point[0] + rot[index][1] * point[1] + rot[index][2] * point[2];
  }
}

/**
 * Original name: BoxOnPlaneSide
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Classifies an AABB against one plane and returns `1`, `2`, or `3`.
 */
export function BoxOnPlaneSide(
  emins: [number, number, number],
  emaxs: [number, number, number],
  plane: PlaneLike
): number {
  if (plane.type < 3) {
    if (plane.dist <= emins[plane.type]) {
      return 1;
    }
    if (plane.dist >= emaxs[plane.type]) {
      return 2;
    }
    return 3;
  }

  let dist1 = 0;
  let dist2 = 0;

  switch (plane.signbits) {
    case 0:
      dist1 = plane.normal[0] * emaxs[0] + plane.normal[1] * emaxs[1] + plane.normal[2] * emaxs[2];
      dist2 = plane.normal[0] * emins[0] + plane.normal[1] * emins[1] + plane.normal[2] * emins[2];
      break;
    case 1:
      dist1 = plane.normal[0] * emins[0] + plane.normal[1] * emaxs[1] + plane.normal[2] * emaxs[2];
      dist2 = plane.normal[0] * emaxs[0] + plane.normal[1] * emins[1] + plane.normal[2] * emins[2];
      break;
    case 2:
      dist1 = plane.normal[0] * emaxs[0] + plane.normal[1] * emins[1] + plane.normal[2] * emaxs[2];
      dist2 = plane.normal[0] * emins[0] + plane.normal[1] * emaxs[1] + plane.normal[2] * emins[2];
      break;
    case 3:
      dist1 = plane.normal[0] * emins[0] + plane.normal[1] * emins[1] + plane.normal[2] * emaxs[2];
      dist2 = plane.normal[0] * emaxs[0] + plane.normal[1] * emaxs[1] + plane.normal[2] * emins[2];
      break;
    case 4:
      dist1 = plane.normal[0] * emaxs[0] + plane.normal[1] * emaxs[1] + plane.normal[2] * emins[2];
      dist2 = plane.normal[0] * emins[0] + plane.normal[1] * emins[1] + plane.normal[2] * emaxs[2];
      break;
    case 5:
      dist1 = plane.normal[0] * emins[0] + plane.normal[1] * emaxs[1] + plane.normal[2] * emins[2];
      dist2 = plane.normal[0] * emaxs[0] + plane.normal[1] * emins[1] + plane.normal[2] * emaxs[2];
      break;
    case 6:
      dist1 = plane.normal[0] * emaxs[0] + plane.normal[1] * emins[1] + plane.normal[2] * emins[2];
      dist2 = plane.normal[0] * emins[0] + plane.normal[1] * emaxs[1] + plane.normal[2] * emaxs[2];
      break;
    case 7:
      dist1 = plane.normal[0] * emins[0] + plane.normal[1] * emins[1] + plane.normal[2] * emins[2];
      dist2 = plane.normal[0] * emaxs[0] + plane.normal[1] * emaxs[1] + plane.normal[2] * emaxs[2];
      break;
    default:
      return 0;
  }

  let sides = 0;
  if (dist1 >= plane.dist) {
    sides = 1;
  }
  if (dist2 < plane.dist) {
    sides |= 2;
  }

  return sides;
}

/**
 * Original name: BoxOnPlaneSide2
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Classifies an AABB against one plane using the slow general corner-selection path.
 */
export function BoxOnPlaneSide2(
  emins: [number, number, number],
  emaxs: [number, number, number],
  plane: PlaneLike
): number {
  const corners: [[number, number, number], [number, number, number]] = [
    [0, 0, 0],
    [0, 0, 0]
  ];

  for (let axis = 0; axis < 3; axis += 1) {
    if (plane.normal[axis] < 0) {
      corners[0][axis] = emins[axis];
      corners[1][axis] = emaxs[axis];
    } else {
      corners[1][axis] = emins[axis];
      corners[0][axis] = emaxs[axis];
    }
  }

  const dist1 = DotProduct(plane.normal, corners[0]) - plane.dist;
  const dist2 = DotProduct(plane.normal, corners[1]) - plane.dist;

  let sides = 0;
  if (dist1 >= 0) {
    sides = 1;
  }
  if (dist2 < 0) {
    sides |= 2;
  }

  return sides;
}

/**
 * Original name: N/A
 * Source: N/A (local matrix scratch helper)
 * Category: New
 * Purpose: Allocate one zeroed 3x3 matrix for rotation helpers.
 *
 * Constraints:
 * - Must stay local to avoid exposing a new public math API.
 */
function createMatrix3x3(): number[][] {
  return [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0]
  ];
}
