import { Face, Model } from "../../types/Model"
import * as GL from "../../GL"

const MAX_BATCH_SIZE = 65536

export type BatchRenderState = {
  vbo_indices: Uint32Array,
  num_vbo_indices: number,
  vbo_buffer: WebGLBuffer
}
const state: BatchRenderState = {
  vbo_indices: new Uint32Array(new ArrayBuffer(MAX_BATCH_SIZE * 4)),
  num_vbo_indices: 0,
  vbo_buffer: null
}

export const init = (gl: WebGLRenderingContext) => {
  state.vbo_buffer = gl.createBuffer()
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, state.vbo_buffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, MAX_BATCH_SIZE * 4, gl.DYNAMIC_DRAW)
}
/*
================
R_ClearBatch
================
*/
export const clearBatch = () => {
	state.num_vbo_indices = 0;
}

/*
================
R_FlushBatch

Draw the current batch if non-empty and clears it, ready for more R_BatchSurface
calls. Orphans the GL buffer (fresh allocation) before writing, same anti-stall
pattern as GL.streamGetSpace — avoids bufferSubData blocking on a draw from a
prior frame that may still be in flight on this buffer.
================
*/
export const flushBatch = (gl: WebGLRenderingContext) => {
	if (state.num_vbo_indices > 0)
	{
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, state.vbo_buffer);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, state.vbo_indices.byteLength, gl.DYNAMIC_DRAW);
		// WebGL2's 5-arg overload uploads a prefix without allocating a
		// subarray view per flush; WebGL1 keeps the view fallback.
		if (GL.state.isWebGL2)
			(gl as WebGL2RenderingContext).bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0,
				state.vbo_indices, 0, state.num_vbo_indices);
		else
			gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0,
				state.vbo_indices.subarray(0, state.num_vbo_indices));
    	gl.drawElements (gl.TRIANGLES, state.num_vbo_indices, gl.UNSIGNED_INT, null);

		state.num_vbo_indices = 0;
	}
}

/*
================
R_BatchSurfaceRange

Add a face's prebuilt fan indices (model.surfIndexData, built once at load/VBO-build
time) to the current batch, flushing first if they wouldn't fit. Manual copy loop
instead of dst.set(src.subarray(...)) — subarray allocates a view object per call,
which per-frame hot-path code must avoid.
================
*/
export const batchSurfaceRange = (gl: WebGL2RenderingContext, model: Model, faceNum: number) => {
	var ofs = model.surfIndexOfs[faceNum], count = model.surfIndexCount[faceNum]

	if (state.num_vbo_indices + count > MAX_BATCH_SIZE)
		flushBatch(gl)

	var src = model.surfIndexData, dst = state.vbo_indices
	var n = state.num_vbo_indices
	for (var k = 0; k < count; k++)
		dst[n++] = src[ofs + k]
	state.num_vbo_indices = n
}

// Face-based wrapper for the entity/submodel path, which still walks linked
// texturechains rather than the flat world-chain arrays.
export const batchSurface = (gl: WebGL2RenderingContext, model: Model, s: Face) => {
	batchSurfaceRange(gl, model, s.num)
}
