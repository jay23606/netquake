// Pure vector/trig QuakeC builtins — pf.ts makevectors (#1), normalize (#9),
// vlen (#12), vectoyaw (#13), vectoangles (#51), plus vec.ts angleVectors.
// Operates on the QC globals union at pr.ts's fixed engine-reserved indices
// (identical across every progs.dat).
//
// PARITY: reads widen f32->f64 via abi.gf, compute in f64, single f32 store via
// abi.setf — docs/wasm-sim-port-assemblyscript.md. sqrt is IEEE-754-exact and
// used natively; sin/cos/atan2 go through the host imports below.
//
// ftos/vtos (#26/#27) need the QC string heap and live with its owner, not here.

import { gf, setf, GLOBALS } from "./abi";

// Host-bridged transcendentals: AssemblyScript's own Math.sin/cos/atan2 can differ from the
// JS engine's by 1 f64 ulp on rare inputs, which crosses f32 store boundaries and forks the
// sims. Import namespace = this file's name.
declare function host_sin(x: f64): f64;
declare function host_cos(x: f64): f64;
declare function host_atan2(y: f64, x: f64): f64;

export function globalsPtr(): usize { return GLOBALS; }

// QC call-ABI / engine-reserved global indices (src/engine/pf.ts, pr.ts globalvars).
const PARM0: i32 = 4;     // first builtin arg (vector or float)
const RETURN: i32 = 1;    // builtin return (float, or vector's [1..3])
const V_FORWARD: i32 = 59;
const V_UP: i32 = 62;
const V_RIGHT: i32 = 65;

const PI: f64 = Math.PI;

// vec.ts angleVectors. Degree->radian MUST stay `angle * PI / 180.0`, NOT
// `angle * (PI/180)` — the groupings round differently in f64.
function angleVectors(g: usize, anglesBase: i32, fwdBase: i32, rightBase: i32, upBase: i32): void {
  const pitchRad: f64 = gf(g, anglesBase) * PI / 180.0;
  const sp: f64 = host_sin(pitchRad), cp: f64 = host_cos(pitchRad);
  const yawRad: f64 = gf(g, anglesBase + 1) * PI / 180.0;
  const sy: f64 = host_sin(yawRad), cy: f64 = host_cos(yawRad);
  const rollRad: f64 = gf(g, anglesBase + 2) * PI / 180.0;
  const sr: f64 = host_sin(rollRad), cr: f64 = host_cos(rollRad);

  setf(g, fwdBase,     cp * cy);
  setf(g, fwdBase + 1, cp * sy);
  setf(g, fwdBase + 2, -sp);

  setf(g, rightBase,     cr * sy - sr * sp * cy);
  setf(g, rightBase + 1, -sr * sp * sy - cr * cy);
  setf(g, rightBase + 2, -sr * cp);

  setf(g, upBase,     cr * sp * cy + sr * sy);
  setf(g, upBase + 1, cr * sp * sy - sr * cy);
  setf(g, upBase + 2, cr * cp);
}

// #1 void(entity e) makevectors — angles at PARM0 -> v_forward/v_right/v_up.
export function makevectors(g: usize): void {
  angleVectors(g, PARM0, V_FORWARD, V_RIGHT, V_UP);
}

// #9 vector(vector v) normalize
export function normalize(g: usize): void {
  const x: f64 = gf(g, PARM0), y: f64 = gf(g, PARM0 + 1), z: f64 = gf(g, PARM0 + 2);
  const len: f64 = Math.sqrt(x * x + y * y + z * z);
  if (len == 0.0) {
    setf(g, RETURN, 0.0);
    setf(g, RETURN + 1, 0.0);
    setf(g, RETURN + 2, 0.0);
    return;
  }
  setf(g, RETURN,     x / len);
  setf(g, RETURN + 1, y / len);
  setf(g, RETURN + 2, z / len);
}

// #12 float(vector v) vlen
export function vlen(g: usize): void {
  const x: f64 = gf(g, PARM0), y: f64 = gf(g, PARM0 + 1), z: f64 = gf(g, PARM0 + 2);
  setf(g, RETURN, Math.sqrt(x * x + y * y + z * z));
}

// #13 float(vector v) vectoyaw. Truncates to int BEFORE the <0 -> +360
// correction (pf.ts `>> 0`; |yaw| <= 180 so a bare i32 cast is safe).
export function vectoyaw(g: usize): void {
  const value1: f64 = gf(g, PARM0), value2: f64 = gf(g, PARM0 + 1);
  if (value1 == 0.0 && value2 == 0.0) {
    setf(g, RETURN, 0.0);
    return;
  }
  let yaw: i32 = <i32>(host_atan2(value2, value1) * 180.0 / PI);
  if (yaw < 0) yaw += 360;
  setf(g, RETURN, <f64>yaw);
}

// #51 vector(vector v) vectoangles — pf.ts binds the float-precision variant,
// NOT the classic int-truncating one.
export function vectoangles(g: usize): void {
  setf(g, RETURN + 2, 0.0); // roll always 0
  const x: f64 = gf(g, PARM0), y: f64 = gf(g, PARM0 + 1), z: f64 = gf(g, PARM0 + 2);
  if (x == 0.0 && y == 0.0) {
    setf(g, RETURN, z > 0.0 ? 90.0 : 270.0);
    setf(g, RETURN + 1, 0.0);
    return;
  }
  let yaw: f64 = host_atan2(y, x) * 180.0 / PI;
  if (yaw < 0.0) yaw += 360.0;
  let pitch: f64 = host_atan2(z, Math.sqrt(x * x + y * y)) * 180.0 / PI;
  if (pitch < 0.0) pitch += 360.0;
  setf(g, RETURN, pitch);
  setf(g, RETURN + 1, yaw);
}
