import * as sys from './sys'
import type { V3, V4, M3, Plane } from './types'

export const origin: V3 = [0.0, 0.0, 0.0];
// Persistent allocation, for load-time/one-shot initialization only — never call
// from a per-frame path (use vec.scratch() there instead).
export const emptyV3 = (): V3 => [0.0, 0.0, 0.0]
export const emptyV4 = (): V4 => [0.0, 0.0, 0.0, 0.0]

type VecState = {
	pool: V3[]
	cursor: number
	highWater: number
	warned: boolean
	// module-local scratch for rotatePointAroundVector / concatRotations, which
	// are only ever called from that single call path.
	rotM: M3
	rotIm: M3
	rotZrot: M3
	rotTmp1: M3
	rotTmp2: M3
}

export let state: VecState = {
	pool: Array.from({ length: 4096 }, (): V3 => [0.0, 0.0, 0.0]),
	cursor: 0,
	highWater: 0,
	warned: false,
	rotM: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
	rotIm: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
	rotZrot: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
	rotTmp1: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
	rotTmp2: [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
}

// Valid only until the next resetScratch() (called once per host frame). Never
// store a scratch vector into an object, closure, or state that outlives the
// local computation — vec.copy it into a persistent array instead.
export const scratch = (): V3 => {
	if (state.cursor >= state.pool.length)
	{
		if (!state.warned)
		{
			console.warn('vec.scratch: pool exhausted, growing (this is a bug signal, not a crash)');
			state.warned = true;
		}
		state.pool.push([0.0, 0.0, 0.0]);
	}
	return state.pool[state.cursor++];
}

export const resetScratch = (): void => {
	if (state.cursor > state.highWater)
		state.highWater = state.cursor;
	state.cursor = 0;
}

export const perpendicular = function(v: V3, out: V3): V3
{
	let pos = 0;
	let minelem = 1;
	if (Math.abs(v[0]) < minelem)
	{
		pos = 0;
		minelem = Math.abs(v[0]);
	}
	if (Math.abs(v[1]) < minelem)
	{
		pos = 1;
		minelem = Math.abs(v[1]);
	}
	if (Math.abs(v[2]) < minelem)
	{
		pos = 2;
		minelem = Math.abs(v[2]);
	}
	const tempvec = [0.0, 0.0, 0.0];
	tempvec[pos] = 1.0;
	const inv_denom = 1.0 / (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
	const d = (tempvec[0] * v[0] + tempvec[1] * v[1] + tempvec[2] * v[2]) * inv_denom;
	out[0] = tempvec[0] - d * v[0] * inv_denom;
	out[1] = tempvec[1] - d * v[1] * inv_denom;
	out[2] = tempvec[2] - d * v[2] * inv_denom;
	normalize(out);
	return out;
};

export const rotatePointAroundVector = function(dir: V3, point: V3, degrees: number, out: V3): V3
{
	const r = perpendicular(dir, scratch());
	const up = crossProduct(r, dir, scratch());
	const m = state.rotM;
	m[0][0] = r[0]; m[0][1] = up[0]; m[0][2] = dir[0];
	m[1][0] = r[1]; m[1][1] = up[1]; m[1][2] = dir[1];
	m[2][0] = r[2]; m[2][1] = up[2]; m[2][2] = dir[2];
	const im = state.rotIm;
	im[0][0] = m[0][0]; im[0][1] = m[1][0]; im[0][2] = m[2][0];
	im[1][0] = m[0][1]; im[1][1] = m[1][1]; im[1][2] = m[2][1];
	im[2][0] = m[0][2]; im[2][1] = m[1][2]; im[2][2] = m[2][2];
	const s = Math.sin(degrees * Math.PI / 180.0);
	const c = Math.cos(degrees * Math.PI / 180.0);
	const zrot = state.rotZrot;
	zrot[0][0] = c; zrot[0][1] = s; zrot[0][2] = 0;
	zrot[1][0] = -s; zrot[1][1] = c; zrot[1][2] = 0;
	zrot[2][0] = 0; zrot[2][1] = 0; zrot[2][2] = 1;
	const rot = concatRotations(concatRotations(m, zrot, state.rotTmp1), im, state.rotTmp2);
	out[0] = rot[0][0] * point[0] + rot[0][1] * point[1] + rot[0][2] * point[2];
	out[1] = rot[1][0] * point[0] + rot[1][1] * point[1] + rot[1][2] * point[2];
	out[2] = rot[2][0] * point[0] + rot[2][1] * point[1] + rot[2][2] * point[2];
	return out;
};

export const anglemod = function(a: number)
{
	return (a % 360.0 + 360.0) % 360.0;
};

export const boxOnPlaneSide = function(emins: V3, emaxs:V3, p: Plane)
{
	if (p.type <= 2)
	{
		if (p.dist <= emins[p.type])
			return 1;
		if (p.dist >= emaxs[p.type])
			return 2;
		return 3;
	}
	let dist1: number, dist2: number;
	switch (p.signbits)
	{
	case 0:
		dist1 = p.normal[0] * emaxs[0] + p.normal[1] * emaxs[1] + p.normal[2] * emaxs[2];
		dist2 = p.normal[0] * emins[0] + p.normal[1] * emins[1] + p.normal[2] * emins[2];
		break;
	case 1:
		dist1 = p.normal[0] * emins[0] + p.normal[1] * emaxs[1] + p.normal[2] * emaxs[2];
		dist2 = p.normal[0] * emaxs[0] + p.normal[1] * emins[1] + p.normal[2] * emins[2];
		break;
	case 2:
		dist1 = p.normal[0] * emaxs[0] + p.normal[1] * emins[1] + p.normal[2] * emaxs[2];
		dist2 = p.normal[0] * emins[0] + p.normal[1] * emaxs[1] + p.normal[2] * emins[2];
		break;
	case 3:
		dist1 = p.normal[0] * emins[0] + p.normal[1] * emins[1] + p.normal[2] * emaxs[2];
		dist2 = p.normal[0] * emaxs[0] + p.normal[1] * emaxs[1] + p.normal[2] * emins[2];
		break;
	case 4:
		dist1 = p.normal[0] * emaxs[0] + p.normal[1] * emaxs[1] + p.normal[2] * emins[2];
		dist2 = p.normal[0] * emins[0] + p.normal[1] * emins[1] + p.normal[2] * emaxs[2];
		break;
	case 5:
		dist1 = p.normal[0] * emins[0] + p.normal[1] * emaxs[1] + p.normal[2] * emins[2];
		dist2 = p.normal[0] * emaxs[0] + p.normal[1] * emins[1] + p.normal[2] * emaxs[2];
		break;
	case 6:
		dist1 = p.normal[0] * emaxs[0] + p.normal[1] * emins[1] + p.normal[2] * emins[2];
		dist2 = p.normal[0] * emins[0] + p.normal[1] * emaxs[1] + p.normal[2] * emaxs[2];
		break;
	case 7:
		dist1 = p.normal[0] * emins[0] + p.normal[1] * emins[1] + p.normal[2] * emins[2];
		dist2 = p.normal[0] * emaxs[0] + p.normal[1] * emaxs[1] + p.normal[2] * emaxs[2];
		break;
	default:
		sys.error('Vec.BoxOnPlaneSide: Bad signbits');
	}
	let sides = 0;
	if (dist1 >= p.dist)
		sides = 1;
	if (dist2 < p.dist)
		sides += 2;
	return sides;
};

export const angleVectors = function(angles: V3, forward:V3 = null, right:V3 = null, up:V3 = null)
{
	let angle: number;
	
	angle = angles[0] * Math.PI / 180.0;
	const sp = Math.sin(angle);
	const cp = Math.cos(angle);
	angle = angles[1] * Math.PI / 180.0;
	const sy = Math.sin(angle);
	const cy = Math.cos(angle);
	angle = angles[2] * Math.PI / 180.0;
	const sr = Math.sin(angle);
	const cr = Math.cos(angle);

	if (forward != null)
	{
		forward[0] = cp * cy;
		forward[1] = cp * sy;
		forward[2] = -sp;
	}
	if (right != null)
	{
		right[0] = cr * sy - sr * sp * cy;
		right[1] = -sr * sp * sy - cr * cy;
		right[2] = -sr * cp;
	}
	if (up != null)
	{
		up[0] = cr * sp * cy + sr * sy;
		up[1] = cr * sp * sy - sr * cy;
		up[2] = cr * cp;
	}
};

export const dotProductV3 = function(v1: V3 | V4, v2: V3 | V4)
{
	return v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
};

export const copy = function(v1: V3, v2: V3)
{
	v2[0] = v1[0];
	v2[1] = v1[1];
	v2[2] = v1[2];
};

export const subtract = (v1: V3, v2: V3, out: V3): V3 => {
	out[0] = v1[0]-v2[0]
	out[1] = v1[1]-v2[1]
	out[2] = v1[2]-v2[2]
	return out
}
export const add = (v1: V3, v2: V3, out: V3): V3 => {
	out[0] = v1[0]+v2[0]
	out[1] = v1[1]+v2[1]
	out[2] = v1[2]+v2[2]
	return out
}
export const multiply = (v1: V3, v2: V3, out: V3): V3 => {
	out[0] = v1[0]*v2[0]
	out[1] = v1[1]*v2[1]
	out[2] = v1[2]*v2[2]
	return out
}
export const scale = (v1: V3, scaler: number, out: V3): V3 => {
	out[0] = v1[0]*scaler
	out[1] = v1[1]*scaler
	out[2] = v1[2]*scaler
	return out
}


export const crossProduct = function(v1: V3, v2: V3, out: V3): V3
{
	const x = v1[1] * v2[2] - v1[2] * v2[1];
	const y = v1[2] * v2[0] - v1[0] * v2[2];
	const z = v1[0] * v2[1] - v1[1] * v2[0];
	out[0] = x;
	out[1] = y;
	out[2] = z;
	return out;
};


export const vectorMA = (veca: V3, scale: number, vecb: V3, out: V3): V3 => {
	out[0] = veca[0] + scale*vecb[0]
	out[1] = veca[1] + scale*vecb[1]
	out[2] = veca[2] + scale*vecb[2]
	return out
}

export const length = function(v: V3)
{
	return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
};

export const normalize = function(v: V3)
{
	const length = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
	if (length === 0.0)
	{
		v[0] = v[1] = v[2] = 0.0;
		return 0.0;
	}
	v[0] /= length;
	v[1] /= length;
	v[2] /= length;
	return length;
};

// Only used from the rotatePointAroundVector call path; out must not alias m1/m2.
export const concatRotations = function(m1: M3, m2: M3, out: M3): M3
{
	out[0][0] = m1[0][0] * m2[0][0] + m1[0][1] * m2[1][0] + m1[0][2] * m2[2][0];
	out[0][1] = m1[0][0] * m2[0][1] + m1[0][1] * m2[1][1] + m1[0][2] * m2[2][1];
	out[0][2] = m1[0][0] * m2[0][2] + m1[0][1] * m2[1][2] + m1[0][2] * m2[2][2];
	out[1][0] = m1[1][0] * m2[0][0] + m1[1][1] * m2[1][0] + m1[1][2] * m2[2][0];
	out[1][1] = m1[1][0] * m2[0][1] + m1[1][1] * m2[1][1] + m1[1][2] * m2[2][1];
	out[1][2] = m1[1][0] * m2[0][2] + m1[1][1] * m2[1][2] + m1[1][2] * m2[2][2];
	out[2][0] = m1[2][0] * m2[0][0] + m1[2][1] * m2[1][0] + m1[2][2] * m2[2][0];
	out[2][1] = m1[2][0] * m2[0][1] + m1[2][1] * m2[1][1] + m1[2][2] * m2[2][1];
	out[2][2] = m1[2][0] * m2[0][2] + m1[2][1] * m2[1][2] + m1[2][2] * m2[2][2];
	return out;
};