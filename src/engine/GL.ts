import * as sys from './sys'
import * as vid from './vid'
import * as scr from './scr'
import * as shaders from './render/webgl/shaders'
import { trackEvent } from '../shared/errorReporting'

// @ts-ignore - debug.js is excluded from TypeScript compilation
import * as WebGLDebugUtils from './debug.js'

let gl: WebGL2RenderingContext = null

type GLAttribute = {
  name: string,
  location: number,
  type: number,
  components: number,
  normalized: boolean,
  offset: number
}

type GLAttributeParam = {
  name: string,
  type: number,
  components: number,
  normalized: boolean,
}
export type GLProgram = {
  identifier: string,
  program: WebGLProgram,
  attribs: GLAttribute[],
  vertexSize: number, 
  attribBits: number,
  textures: Record<string, number>
  uniforms: Record<string, WebGLUniformLocation>
  attributeMap: Record<string, GLAttribute>
}
  

type GLState = {
  programs: GLProgram[]
  streamArray: ArrayBuffer
  streamArrayBytes: Uint8Array
  streamArrayPosition: number
  streamArrayVertexCount: number
  streamArrayView: DataView
  streamBuffers: WebGLBuffer[]
  streamBufferIndex: number
  streamBufferPosition: number
  currentProgram: GLProgram
  // rotationMatrix() output — consumed immediately by the caller (gl.uniformMatrix3fv);
  // never held across more than one rotationMatrix() call.
  rotationMatrixOut: number[]
  instancingSupported: boolean
  // True on a real WebGL2 context (instancingSupported can also be true via
  // ANGLE_instanced_arrays on WebGL1); gates WebGL2-only overloads.
  isWebGL2: boolean
  glRenderer: string
  // Set by vid.init before each GL.init call: which backend branch asked for this context and why
  // (e.g. 'webgpu-unavailable:adapter-null'). Only read by GL.init's context-failure diagnostics, so a
  // production error report says WHY WebGL was being created, not just that it failed.
  initReason: string
  vertexAttribDivisor: (location: number, divisor: number) => void
  drawArraysInstanced: (mode: number, first: number, count: number, primcount: number) => void
}

export const createAttribParam = (name: string, type: number, components: number, normalized: boolean = false): GLAttributeParam => ({
  name,
  type,
  components,
  normalized
})

export const getContext = () => {
  return gl
}

// Human-readable GPU/driver string for the live WebGL2 context, via WEBGL_debug_renderer_info's
// UNMASKED_RENDERER_WEBGL (e.g. "ANGLE (Intel, Intel(R) UHD Graphics ...)"). Some browsers mask it for
// privacy → falls back to the generic RENDERER, then 'unknown'. Best-effort; used only for the init log.
export const rendererName = (): string => {
  if (gl == null) return 'unknown'
  try {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    const name = dbg ? gl.getParameter((dbg as any).UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
    return (typeof name === 'string' && name.length > 0) ? name : 'unknown'
  } catch {
    return 'unknown'
  }
}

export const state: GLState = {
  programs: [],
  streamArray: null,
  streamArrayBytes: null,
  streamArrayPosition: 0,
  streamArrayVertexCount: 0,
  streamArrayView: null,
  streamBuffers: [],
  streamBufferIndex: 0,
  streamBufferPosition: 0,
  currentProgram: null,
  rotationMatrixOut: [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
  instancingSupported: false,
  isWebGL2: false,
  glRenderer: '',
  initReason: '',
  vertexAttribDivisor: () => {},
  drawArraysInstanced: () => {}
}

export const ortho = [
  0.0, 0.0, 0.0, 0.0,
  0.0, 0.0, 0.0, 0.0,
  0.0, 0.0, 0.00001, 0.0,
  -1.0, 1.0, 0.0, 1.0
]

export const identity = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]

export const set2D = function()
{
  gl.viewport(0, 0, (vid.state.width * scr.state.devicePixelRatio) >> 0, (vid.state.height * scr.state.devicePixelRatio) >> 0);
  unbindProgram();
  var i, program;
  for (i = 0; i < state.programs.length; ++i)
  {
    program = state.programs[i];
    if (program.uniforms.uOrtho == null)
      continue;
    gl.useProgram(program.program);
    gl.uniformMatrix4fv(program.uniforms.uOrtho, false, ortho);
  }
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
};

export const createProgram = function(identifier: string, uniforms: string[], attribs: GLAttributeParam[], textures: string[])
{
  var p = gl.createProgram();
  var program: GLProgram =
  {
    identifier: identifier,
    program: p,
    attribs: [],
    vertexSize: 0,
    attribBits: 0,
    textures: {},
    uniforms: {},
    attributeMap: {}
  };

  var vsh = gl.createShader(gl.VERTEX_SHADER);
  // @ts-ignore
  gl.shaderSource(vsh, shaders['vsh' + identifier]);
  gl.compileShader(vsh);
  if (gl.getShaderParameter(vsh, gl.COMPILE_STATUS) !== true)
    sys.error('Error compiling shader: ' + gl.getShaderInfoLog(vsh));

  var fsh = gl.createShader(gl.FRAGMENT_SHADER);
  // @ts-ignore
  gl.shaderSource(fsh, shaders['fsh' + identifier]);
  gl.compileShader(fsh);
  if (gl.getShaderParameter(fsh, gl.COMPILE_STATUS) !== true)
    sys.error('Error compiling shader: ' + gl.getShaderInfoLog(fsh));

  gl.attachShader(p, vsh);
  gl.attachShader(p, fsh);

  gl.linkProgram(p);
  if (gl.getProgramParameter(p, gl.LINK_STATUS) !== true)
    sys.error('Error linking program: ' + gl.getProgramInfoLog(p));

  gl.useProgram(p);

  for (var i = 0; i < uniforms.length; ++i)
    program.uniforms[uniforms[i]] = gl.getUniformLocation(p, uniforms[i]);

  program.vertexSize = 0;
  program.attribBits = 0;
  for (var i = 0; i < attribs.length; ++i)
  {
    var attribParameters = attribs[i];
    var attrib: GLAttribute = {
      ...attribParameters,
      offset: program.vertexSize,
      location: gl.getAttribLocation(p, attribParameters.name),
    }
    program.attribs[i] = attrib;
    program.attributeMap[attrib.name] = attrib;
    if (attrib.type === gl.FLOAT)
      program.vertexSize += attrib.components * 4;
    else if (attrib.type === gl.BYTE || attrib.type === gl.UNSIGNED_BYTE)
      program.vertexSize += 4;
    else
      sys.error('Unknown vertex attribute type');
    program.attribBits |= 1 << attrib.location;
  }

  for (var i = 0; i < textures.length; ++i)
  {
    program.textures[textures[i]] = i;
    gl.uniform1i(gl.getUniformLocation(p, textures[i]), i);
  }

  state.programs[state.programs.length] = program;
  return program;
};

export const useProgram = function(identifier: string, flushStream = false)
{
  var currentProgram = state.currentProgram;
  if (currentProgram != null)
  {
    if (currentProgram.identifier === identifier)
      return currentProgram;
    if (flushStream === true)
      streamFlush();
  }

  var program = null;
  for (var i = 0; i < state.programs.length; ++i)
  {
    if (state.programs[i].identifier === identifier)
    {
      program = state.programs[i];
      break;
    }
  }
  if (program == null)
    return null;

  var enableAttribs = program.attribBits, disableAttribs = 0;
  if (currentProgram != null)
  {
    enableAttribs &= ~currentProgram.attribBits;
    disableAttribs = currentProgram.attribBits & ~program.attribBits;
  }
  state.currentProgram = program;
  gl.useProgram(program.program);
  for (var attrib = 0; enableAttribs !== 0 || disableAttribs !== 0; ++attrib)
  {
    var mask = 1 << attrib;
    if ((enableAttribs & mask) !== 0)
      gl.enableVertexAttribArray(attrib);
    else if ((disableAttribs & mask) !== 0)
      gl.disableVertexAttribArray(attrib);
    enableAttribs &= ~mask;
    disableAttribs &= ~mask;
  }

  return program;
};

export const unbindProgram = function()
{
  if (state.currentProgram == null)
    return;
  streamFlush();
  var i;
  for (i = 0; i < state.currentProgram.attribs.length; ++i)
    gl.disableVertexAttribArray(state.currentProgram.attribs[i].location);
  state.currentProgram = null;
};


// scale (default 1) folds a uniform entity .scale into the rotation columns in place,
// exactly as Ironwail R_EntityMatrix multiplies each basis vector by ENTSCALE_DECODE(e->scale)
// (gl_rmain.c). The shader does uAngles*pos + uOrigin, so scaling the 3x3 scales verts about
// the entity origin. rotationMatrixOut is consumed immediately, so the write stays in place.
export const rotationMatrix = function(pitch: number, yaw: number, roll: number, scale: number = 1.0)
{
  pitch *= Math.PI / -180.0;
  yaw *= Math.PI / 180.0;
  roll *= Math.PI / 180.0;
  var sp = Math.sin(pitch);
  var cp = Math.cos(pitch);
  var sy = Math.sin(yaw);
  var cy = Math.cos(yaw);
  var sr = Math.sin(roll);
  var cr = Math.cos(roll);
  var out = state.rotationMatrixOut;
  out[0] = cy * cp;                out[1] = sy * cp;               out[2] = -sp;
  out[3] = -sy * cr + cy * sp * sr; out[4] = cy * cr + sy * sp * sr; out[5] = cp * sr;
  out[6] = -sy * -sr + cy * sp * cr; out[7] = cy * -sr + sy * sp * cr; out[8] = cp * cr;
  if (scale !== 1.0) {
    out[0] *= scale; out[1] *= scale; out[2] *= scale;
    out[3] *= scale; out[4] *= scale; out[5] *= scale;
    out[6] *= scale; out[7] *= scale; out[8] *= scale;
  }
  return out;
};

// Advance to the next pooled buffer and orphan it (fresh GPU allocation) so this
// frame's writes never alias storage the GPU may still be reading from a prior
// frame's draws. Call once per rendered frame, before any stream writes.
export const streamBeginFrame = function()
{
  // Guard against running between freePrograms() and a re-init: % 0 would
  // index the pool with NaN and bindBuffer(undefined) throws.
  if (state.streamBuffers.length === 0)
    return;
  state.streamBufferIndex = (state.streamBufferIndex + 1) % state.streamBuffers.length;
  state.streamBufferPosition = 0;
  gl.bindBuffer(gl.ARRAY_BUFFER, state.streamBuffers[state.streamBufferIndex]);
  gl.bufferData(gl.ARRAY_BUFFER, state.streamArray.byteLength, gl.DYNAMIC_DRAW);
}

export const streamFlush = function()
{
  if (state.streamArrayVertexCount === 0)
    return;
  var program = state.currentProgram;
  if (program != null)
  {
    gl.bindBuffer(gl.ARRAY_BUFFER, state.streamBuffers[state.streamBufferIndex]);
    gl.bufferSubData(gl.ARRAY_BUFFER, state.streamBufferPosition,
      state.streamArrayBytes.subarray(0, state.streamArrayPosition));
    var attribs = program.attribs;
    for (var i = 0; i < attribs.length; ++i)
    {
      var attrib = attribs[i];
      gl.vertexAttribPointer(attrib.location,
        attrib.components, attrib.type, attrib.normalized,
        program.vertexSize, state.streamBufferPosition + attrib.offset);
    }
    gl.drawArrays(gl.TRIANGLES, 0, state.streamArrayVertexCount);
    state.streamBufferPosition += state.streamArrayPosition;
  }
  state.streamArrayPosition = 0;
  state.streamArrayVertexCount = 0;
}

export const streamGetSpace = function(vertexCount: number)
{
  var program = state.currentProgram;
  if (program == null)
    return;
  var length = vertexCount * program.vertexSize;
  if ((state.streamBufferPosition + state.streamArrayPosition + length) > state.streamArray.byteLength)
  {
    streamFlush();
    // Orphan the current buffer instead of reusing it from offset 0: gives a fresh
    // allocation so pending GPU reads of the old storage from draws earlier this
    // frame aren't affected.
    gl.bindBuffer(gl.ARRAY_BUFFER, state.streamBuffers[state.streamBufferIndex]);
    gl.bufferData(gl.ARRAY_BUFFER, state.streamArray.byteLength, gl.DYNAMIC_DRAW);
    state.streamBufferPosition = 0;
  }
  state.streamArrayVertexCount += vertexCount;
}

export const streamWriteFloat = function(x: number)
{
  state.streamArrayView.setFloat32(state.streamArrayPosition, x, true);
  state.streamArrayPosition += 4;
}

export const streamWriteFloat2 = function(x: number, y: number)
{
  var view = state.streamArrayView;
  var position = state.streamArrayPosition;
  view.setFloat32(position, x, true);
  view.setFloat32(position + 4, y, true);
  state.streamArrayPosition += 8;
}

export const streamWriteFloat3 = function(x: number, y: number, z: number)
{
  var view = state.streamArrayView;
  var position = state.streamArrayPosition;
  view.setFloat32(position, x, true);
  view.setFloat32(position + 4, y, true);
  view.setFloat32(position + 8, z, true);
  state.streamArrayPosition += 12;
}

export const streamWriteFloat4 = function(x: number, y: number, z: number, w: number)
{
  var view = state.streamArrayView;
  var position = state.streamArrayPosition;
  view.setFloat32(position, x, true);
  view.setFloat32(position + 4, y, true);
  view.setFloat32(position + 8, z, true);
  view.setFloat32(position + 12, w, true);
  state.streamArrayPosition += 16;
}

export const streamWriteUByte4 = function(x: number, y: number, z: number, w: number)
{
  var view = state.streamArrayView;
  var position = state.streamArrayPosition;
  view.setUint8(position, x);
  view.setUint8(position + 1, y);
  view.setUint8(position + 2, z);
  view.setUint8(position + 3, w);
  state.streamArrayPosition += 4;
}

export const streamDrawTexturedQuad = function(x: number, y: number, w: number, h: number, u: number, v: number, u2: number, v2: number)
{
  var x2 = x + w, y2 = y + h;
  streamGetSpace(6);
  streamWriteFloat4(x, y, u, v);
  streamWriteFloat4(x, y2, u, v2);
  streamWriteFloat4(x2, y, u2, v);
  streamWriteFloat4(x2, y, u2, v);
  streamWriteFloat4(x, y2, u, v2);
  streamWriteFloat4(x2, y2, u2, v2);
}

export const streamDrawColoredQuad = function(x: number, y: number, w: number, h: number, r: number, g: number, b: number, a: number)
{
  var x2 = x + w, y2 = y + h;
  streamGetSpace(6);
  streamWriteFloat2(x, y);
  streamWriteUByte4(r, g, b, a);
  streamWriteFloat2(x, y2);
  streamWriteUByte4(r, g, b, a);
  streamWriteFloat2(x2, y);
  streamWriteUByte4(r, g, b, a);
  streamWriteFloat2(x2, y);
  streamWriteUByte4(r, g, b, a);
  streamWriteFloat2(x, y2);
  streamWriteUByte4(r, g, b, a);
  streamWriteFloat2(x2, y2);
  streamWriteUByte4(r, g, b, a);
}

export const freePrograms = () => {
  for (var i = state.programs.length -1; i >=0; i--) {
    const program = state.programs[i]
    gl.deleteProgram(program.program)
    state.programs.splice(i, 1)
  }
  var numTextureUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
  for (var unit = 0; unit < numTextureUnits; ++unit) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
  }
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  var numAttributes = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
  for (var attrib = 0; attrib < numAttributes; ++attrib) {
    gl.vertexAttribPointer(attrib, 1, gl.FLOAT, false, 0, 0);
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  for (var j = 0; j < state.streamBuffers.length; ++j)
    gl.deleteBuffer(state.streamBuffers[j]);
  state.streamBuffers = [];
}


export const init = function(glCanvas?: HTMLCanvasElement) {
  state.programs = []

  vid.state.mainwindow = document.getElementById('mainwindow') as HTMLCanvasElement;
  // The WebGL2 context is created on glCanvas when provided (WebGPU mode passes an offscreen canvas
  // so existing texture/VBO creation keeps working while WebGPU owns the visible mainwindow); by
  // default it is created on the visible mainwindow as before. vid.state.mainwindow always stays the
  // visible canvas (input, sizing, WebGPU).
  const glTarget = glCanvas || vid.state.mainwindow;
  const webGlOptions: WebGLContextAttributes = {
    powerPreference: 'high-performance'
  }
  // const onError = (err,fnName, args) => {
  //   debugger
  // }
  // Try each context type independently and RECORD the outcome. Previously all three were chained with
  // `||` inside one try whose catch was a bare `debugger` — so a getContext that THREW (what WebGL
  // blockers and privacy shields typically do) skipped the remaining types AND discarded the reason,
  // leaving production error reports with only the generic message below and no way to act on them.
  const tried: string[] = []
  let ctxError = ''
  let context: RenderingContext | null = null
  for (const kind of ['webgl2', 'webgl', 'experimental-webgl']) {
    try {
      context = glTarget.getContext(kind, webGlOptions)
      tried.push(kind + (context != null ? '=ok' : '=null'))
      if (context != null) break
    } catch (e: any) {
      tried.push(kind + '=threw')
      if (ctxError === '') ctxError = e?.message || String(e)
    }
  }
  //gl = WebGLDebugUtils.default.makeDebugContext( context, onError, null, null);
  gl = context as WebGL2RenderingContext

  if (gl == null) {
    // A canvas serves ONE context type for life: if this canvas already handed out a WebGPU (or 2d)
    // context, every later getContext('webgl*') returns null forever. Probing 2d separates that from a
    // genuinely WebGL-less browser — 'fresh' means the canvas was unbound, so WebGL really is
    // unavailable. Safe only here: we throw immediately after, so binding 2d costs nothing.
    let canvasState = 'unknown'
    try { canvasState = glTarget.getContext('2d') != null ? 'fresh' : 'already-bound' } catch { /* ignore */ }
    const detail = `tried=${tried.join(',')} canvas=${canvasState} reason=${state.initReason || 'unset'}`
      + (ctxError !== '' ? ` err=${ctxError}` : '')
    // Report BEFORE throwing: every other render_backend event fires only after a successful GL.init, so
    // this path reached error reporting as a bare stack with no context at all.
    trackEvent('render_init_failed', {
      tried: tried.join(','), canvas: canvasState, reason: state.initReason || 'unset', err: ctxError,
    })
    sys.error('Unable to initialize WebGL — it may be unsupported, disabled, or blocked by the browser. [' + detail + ']');
  }

  // Which GPU the browser actually gave us (powerPreference is only a request;
  // OS per-app graphics settings can override it). Vanilla VID_Init prints
  // GL_RENDERER the same way.
  // Use the standard RENDERER parameter (log-only; glRenderer isn't read for any decision),
  // NOT the WEBGL_debug_renderer_info extension — that extension is deprecated (fingerprinting
  // surface) and merely calling getExtension for it emits a console deprecation warning.
  try {
    state.glRenderer = String(gl.getParameter(gl.RENDERER));
    console.log('GL_RENDERER: ' + state.glRenderer);
  } catch (e) { state.glRenderer = 'unknown'; }

  if (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext) {
    state.isWebGL2 = true;
    state.instancingSupported = true;
    state.vertexAttribDivisor = (location, divisor) => gl.vertexAttribDivisor(location, divisor);
    state.drawArraysInstanced = (mode, first, count, primcount) => gl.drawArraysInstanced(mode, first, count, primcount);
  }
  else {
    const ext = gl.getExtension('ANGLE_instanced_arrays');
    if (ext != null) {
      state.instancingSupported = true;
      state.vertexAttribDivisor = (location, divisor) => ext.vertexAttribDivisorANGLE(location, divisor);
      state.drawArraysInstanced = (mode, first, count, primcount) => ext.drawArraysInstancedANGLE(mode, first, count, primcount);
    }
  }

  gl.clearColor(0.0, 0.0, 0.0, 0.0);
  gl.cullFace(gl.FRONT);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE);

  // Pool of buffers rotated per frame (streamBeginFrame) and orphaned on wrap
  // (streamGetSpace): avoids bufferSubData aliasing storage the GPU may still be
  // reading from earlier draws, which forces a sync stall on tiled GPUs.
  const STREAM_BUFFER_SIZE = 65536;
  state.streamArray = new ArrayBuffer(STREAM_BUFFER_SIZE);
  state.streamArrayBytes = new Uint8Array(state.streamArray);
  state.streamArrayPosition = 0;
  state.streamArrayVertexCount = 0;
  state.streamArrayView = new DataView(state.streamArray);
  state.streamBuffers = [];
  for (var i = 0; i < 3; ++i)
  {
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, STREAM_BUFFER_SIZE, gl.DYNAMIC_DRAW);
    state.streamBuffers.push(buffer);
  }
  state.streamBufferIndex = 0;
  state.streamBufferPosition = 0;

  vid.state.mainwindow.style.display = 'inline-block';
};