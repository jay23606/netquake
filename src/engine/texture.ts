import {state as comState} from './com'
import { d_8to24table, d_8to24table_fbright_fence, d_8to24table_fbright,
  d_8to24table_conchars, d_8to24table_nobright, d_8to24table_nobright_fence,
  d_8to24table_skin, setPalette
} from './palette'
import * as defs from './def'
import * as GL from './GL'
import * as con from './console'
import * as cmd from './cmd'
import * as com from './com'
import * as cvar from './cvar'
import * as render from './render'
import { Model, TexChain, Texture } from './types/Model'

type GLMode = 'GL_NEAREST' | 'GL_LINEAR' | 'GL_NEAREST_MIPMAP_NEAREST' | 'GL_LINEAR_MIPMAP_NEAREST' | 'GL_NEAREST_MIPMAP_LINEAR' | 'GL_LINEAR_MIPMAP_LINEAR'
type GLModeDef = [GLMode, number, number]
export type GLTexture = {
  owner: Model
  texnum: WebGLTexture
  identifier: string
  width: number
  height: number
}

type TextureState = {
  maxtexturesize: number
  activetexture: number
  currenttextures: WebGLTexture[],
  filter_max: number
  filter_min: number
  textures: GLTexture[],
  notexture_mip: Texture | null,
  solidskytexture: WebGLTexture | null,
  alphaskytexture: WebGLTexture | null,
  lightmap_textures: GLTexture[],
  lightmap_style_textures: (GLTexture | null)[][],
  black_texture: WebGLTexture | null,
  lightstyle_texture: WebGLTexture | null,
  null_texture: WebGLTexture | null,
  fullbright_texture: WebGLTexture | null,
  modes: GLModeDef[]
}


export const createNoTexture = (gl: WebGL2RenderingContext): Texture => ({
  name: 'notexture',
  width: 16,
  height: 16,
  texturenum: gl.createTexture(),
  texturechains: {[TexChain.world]: null, [TexChain.model]: null},
  sky: false,
  turbulent: false,
  anims: [],
  alternate_anims: [],
  anim_base: 0,
  anim_frame: 0
})

export const state: TextureState = {
  maxtexturesize: -1,
  activetexture: -1,
  currenttextures: [],
  filter_max: -1,
  filter_min: -1,
  textures: [],
  notexture_mip: null,
  solidskytexture: null,
  alphaskytexture: null,
  lightmap_textures: [],
  lightmap_style_textures: [],
  black_texture: null,
  lightstyle_texture: null,
  null_texture: null,
  fullbright_texture: null,
  modes: []
}

let gl: any = null

export type Pic = {
  width: number
  height: number
  data: Uint8Array
  texnum: WebGLTexture
  translate: WebGLTexture
  // Expanded RGBA of the uploaded (power-of-two-scaled) image, retained only when the WebGPU backend
  // is active (see loadPicTexture) so the WebGPU renderer can build a GPUTexture. Never set under
  // WebGL — the fields stay undefined and cost nothing.
  rgba?: Uint8Array
  rgbaW?: number
  rgbaH?: number
  // Square index buffer (palette bytes) the colormap-translate mask is built from (m.ts menuplyr setup).
  // Retained so the WebGPU backend can CPU-remap the pic for drawPicTranslate (the WebGL path uses a
  // fragment shader + a separate `translate` mask texture instead). Only set on menuplyr.
  translateData?: Uint8Array
}
export const getContext = () => {
  return gl
}

export const cvr = {

} as any

export const textureMode_f = function()
{
  const gl = GL.getContext();
  var i;
  if (cmd.state.argv.length <= 1)
  {
    for (i = 0; i < state.modes.length; ++i)
    {
      if (state.filter_min === state.modes[i][1])
      {
        con.print(state.modes[i][0] + '\n');
        return;
      }
    }
    con.print('current filter is unknown???\n');
    return;
  }
  var name = cmd.state.argv[1].toUpperCase();
  for (i = 0; i < state.modes.length; ++i)
  {
    if (state.modes[i][0] === name)
      break;
  }
  if (i === state.modes.length)
  {
    con.print('bad filter name\n');
    return;
  }
  state.filter_min = state.modes[i][1];
  state.filter_max = state.modes[i][2];
  for (i = 0; i < state.textures.length; ++i)
  {
    bind(0, state.textures[i].texnum);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, state.filter_min);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, state.filter_max);
  }
};

export const resampleTexture = function(data: Uint8Array, inwidth: number, inheight: number, outwidth: number, outheight: number)
{
  var outdata = new ArrayBuffer(outwidth * outheight);
  var out = new Uint8Array(outdata);
  var xstep = inwidth / outwidth, ystep = inheight / outheight;
  var src, dest = 0, y;
  var i, j;
  for (i = 0; i < outheight; ++i)
  {
    src = Math.floor(i * ystep) * inwidth;
    for (j = 0; j < outwidth; ++j)
      out[dest + j] = data[src + Math.floor(j * xstep)];
    [src + Math.floor(j * xstep)];
    dest += outwidth;
  }
  return out;
}

export const loadSky = (gl: WebGLRenderingContext, src: Uint8Array) => {
	var i, j, p;
	var trans = new ArrayBuffer(65536);
	var trans32 = new Uint32Array(trans);

	for (i = 0; i < 128; ++i)
	{
		for (j = 0; j < 128; ++j)
			trans32[(i << 7) + j] = comState.littleLong(d_8to24table[src[(i << 8) + j + 128]]);
	}
  bind(0, state.solidskytexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 128, 128, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(trans));
  gl.generateMipmap(gl.TEXTURE_2D);

  for (i = 0; i < 128; ++i)
  {
    for (j = 0; j < 128; ++j)
    {
      p = (i << 8) + j;
      if (src[p] !== 0)
        trans32[(i << 7) + j] = comState.littleLong(d_8to24table[src[p]]);
      else
        trans32[(i << 7) + j] = 0;
    }
  }
  bind(0, state.alphaskytexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 128, 128, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(trans));
  gl.generateMipmap(gl.TEXTURE_2D);
}

export const init = async () => {
  const gl = GL.getContext()

  // A remounted game view gives GL.init a fresh canvas => a new WebGL context,
  // but this module's state is an ES-module singleton that outlives the old
  // context. Drop every stale handle: the identifier cache would otherwise hand
  // back a dead-context texture on the next map ("does not belong to this
  // context"), and the redundant-bind cache would mis-skip binds. Singletons
  // below are recreated further down; per-map textures reload with the cache
  // cleared. Old handles die with the old context, so no gl.deleteTexture here.
  state.textures = []
  state.lightmap_textures = []
  state.lightmap_style_textures = []
  state.currenttextures = []
  state.activetexture = -1
  state.solidskytexture = null
  state.alphaskytexture = null
  state.lightstyle_texture = null
  state.fullbright_texture = null
  state.null_texture = null
  state.black_texture = null
  state.notexture_mip = null

  state.modes = [
    ['GL_NEAREST', gl.NEAREST, gl.NEAREST],
    ['GL_LINEAR', gl.LINEAR, gl.LINEAR],
    ['GL_NEAREST_MIPMAP_NEAREST', gl.NEAREST_MIPMAP_NEAREST, gl.NEAREST],
    ['GL_LINEAR_MIPMAP_NEAREST', gl.LINEAR_MIPMAP_NEAREST, gl.LINEAR],
    ['GL_NEAREST_MIPMAP_LINEAR', gl.NEAREST_MIPMAP_LINEAR, gl.NEAREST],
    ['GL_LINEAR_MIPMAP_LINEAR', gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR]
  ];
  state.filter_min = gl.LINEAR_MIPMAP_NEAREST;
  state.filter_max = gl.LINEAR;

  cvr.picmip = cvar.registerVariable('gl_picmip', '0', true);
  cvr.glTexturemode = cvar.registerVariable('gl_texturemode', 'GL_LINEAR_MIPMAP_NEAREST', true);
  cvar.registerChangedEvent('gl_texturemode', textureMode_f);

  state.maxtexturesize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
	var data = new Uint8Array(new ArrayBuffer(256));
	var i, j;
	for (i = 0; i < 8; ++i)
	{
		for (j = 0; j < 8; ++j)
		{
			data[(i << 4) + j] = data[136 + (i << 4) + j] = 255;
			data[8 + (i << 4) + j] = data[128 + (i << 4) + j] = 0;
		}
  }
  
  await setPalette();
  
	state.notexture_mip = createNoTexture(gl);
	bind(0, state.notexture_mip.texturenum);
  upload(data, 16, 16);
  
	state.solidskytexture = gl.createTexture();
	bind(0, state.solidskytexture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  
	state.alphaskytexture = gl.createTexture();
	bind(0, state.alphaskytexture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  state.lightmap_textures = []
  for (i = 0; i < 4; i++) {
    // TODO - does this change break?
    // state.lightmap_textures[i] = gl.createTexture();
    // bind(0, state.lightmap_textures[i]);
    // Above changed to:
    bind(0, gl.createTexture());

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    
  }
	state.lightstyle_texture = gl.createTexture();
	bind(0, state.lightstyle_texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);


	state.fullbright_texture = gl.createTexture();
	bind(0, state.fullbright_texture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 0, 0, 0]));
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  
	state.null_texture = gl.createTexture();
	bind(0, state.null_texture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
}

export const bind = (target: number, texnum: WebGLTexture, flushStream = false) => {
  const gl = GL.getContext()
  if (state.currenttextures[target] !== texnum)
  {
    if (flushStream)
      GL.streamFlush();

    if (state.activetexture !== target)
    {
      state.activetexture = target;
      gl.activeTexture(gl.TEXTURE0 + target);
    }
    state.currenttextures[target] = texnum;
    gl.bindTexture(gl.TEXTURE_2D, texnum);
  }
}

export const loadLmp = async (path: string): Promise<Pic | null> => {
  const buf = await com.loadFile(path);
  if (buf == null) return null;
  const view = new DataView(buf, 0, 8);
  const width = view.getUint32(0, true);
  const height = view.getUint32(4, true);
  const pic: Pic = { width, height, data: new Uint8Array(buf, 8, width * height), texnum: null, translate: null };
  pic.texnum = loadPicTexture(pic);
  return pic;
};

export const loadPicTexture = function(pic: Pic)
{
  const gl = GL.getContext()
  var data = pic.data, scaled_width = pic.width, scaled_height = pic.height;
  if (((pic.width & (pic.width - 1)) !== 0) || ((pic.height & (pic.height - 1)) !== 0))
  {
    --scaled_width ;
    scaled_width |= (scaled_width >> 1);
    scaled_width |= (scaled_width >> 2);
    scaled_width |= (scaled_width >> 4);
    scaled_width |= (scaled_width >> 8);
    scaled_width |= (scaled_width >> 16);
    ++scaled_width;
    --scaled_height;
    scaled_height |= (scaled_height >> 1);
    scaled_height |= (scaled_height >> 2);
    scaled_height |= (scaled_height >> 4);
    scaled_height |= (scaled_height >> 8);
    scaled_height |= (scaled_height >> 16);
    ++scaled_height;
  }
  if (scaled_width > state.maxtexturesize)
    scaled_width = state.maxtexturesize;
  if (scaled_height > state.maxtexturesize)
    scaled_height = state.maxtexturesize;
  if ((scaled_width !== pic.width) || (scaled_height !== pic.height))
    data = resampleTexture(data, pic.width, pic.height, scaled_width, scaled_height);

  var texnum = gl.createTexture();
  bind(0, texnum);
  var trans = new ArrayBuffer((scaled_width * scaled_height) << 2)
  var trans32 = new Uint32Array(trans);
  var i;
  for (i = scaled_width * scaled_height - 1; i >= 0; --i)
  {
    if (data[i] !== 255)
      trans32[i] = com.state.littleLong(d_8to24table[data[i]] + 0xff000000);
  }
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, scaled_width, scaled_height, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(trans));
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  // WebGPU backend: retain the expanded RGBA so the WebGPU renderer can upload its own GPUTexture.
  // Additive + backend-gated — under WebGL these fields are never set (pixel-identical).
  if (render.state.active != null && render.state.active.backend === 'webgpu') {
    pic.rgba = new Uint8Array(trans);
    pic.rgbaW = scaled_width;
    pic.rgbaH = scaled_height;
  }
  return texnum;
};

export const upload = function(data: Uint8Array, width: number, height: number, flags = 0)
{
  const gl = GL.getContext()
  var scaled_width = width, scaled_height = height;
  if (((width & (width - 1)) !== 0) || ((height & (height - 1)) !== 0))
  {
    --scaled_width;
    scaled_width |= (scaled_width >> 1);
    scaled_width |= (scaled_width >> 2);
    scaled_width |= (scaled_width >> 4);
    scaled_width |= (scaled_width >> 8);
    scaled_width |= (scaled_width >> 16);
    ++scaled_width;
    --scaled_height;
    scaled_height |= (scaled_height >> 1);
    scaled_height |= (scaled_height >> 2);
    scaled_height |= (scaled_height >> 4);
    scaled_height |= (scaled_height >> 8);
    scaled_height |= (scaled_height >> 16);
    ++scaled_height;
  }
  if (scaled_width > state.maxtexturesize)
    scaled_width = state.maxtexturesize;
  if (scaled_height > state.maxtexturesize)
    scaled_height = state.maxtexturesize;
  if ((scaled_width !== width) || (scaled_height !== height))
    data = resampleTexture(data, width, height, scaled_width, scaled_height);
  var trans = new ArrayBuffer((scaled_width * scaled_height) << 2)
  var trans32 = new Uint32Array(trans);
  var pal = d_8to24table
  var padbyte = 255

	// choose palette and padbyte
	if (flags & defs.TEXPREF.fullbright)
	{
		if (flags & defs.TEXPREF.alpha)
			pal = d_8to24table_fbright_fence;
		else
      pal = d_8to24table_fbright;
		padbyte = 0;
	}
	else if (flags & defs.TEXPREF.nobright)
	{
		if (flags & defs.TEXPREF.alpha)
			pal = d_8to24table_nobright_fence;
		else
			pal = d_8to24table_nobright;
		padbyte = 0;
	}
	else if (flags & defs.TEXPREF.conchars)
	{
		pal = d_8to24table_conchars;
		padbyte = 0;
  }
	else if (flags & defs.TEXPREF.skin)
	{
		pal = d_8to24table_skin;
	}

  for (var i = scaled_width * scaled_height - 1; i >= 0; --i)
  {
    trans32[i] = comState.littleLong(pal[data[i]]);
  }

  const rgba = new Uint8Array(trans)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, scaled_width, scaled_height, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, state.filter_min);
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, state.filter_max);
  // The expanded RGBA + its final (power-of-two) dimensions, so callers can retain them for the
  // WebGPU backend. Under WebGL2 the return value is simply ignored.
  return { rgba, width: scaled_width, height: scaled_height }
}


export const loadTexture = (owner: Model, identifier: string, width: number, height: number, data: Uint8Array, flags = 0): GLTexture => {
  var glt, i;
  const gl = GL.getContext()
  if (identifier.length !== 0)
  {
    for (i = 0; i < state.textures.length; ++i)
    {
      glt = state.textures[i];
      if (glt.identifier === identifier)
      {
        if ((width !== glt.width) || (height !== glt.height))
          con.print('TX.LoadTexture: cache mismatch\n')
        return glt
      }
    }
  }
  
  var scaled_width = width, scaled_height = height;
  if (((width & (width - 1)) !== 0) || ((height & (height - 1)) !== 0))
  {
    --scaled_width ;
    scaled_width |= (scaled_width >> 1);
    scaled_width |= (scaled_width >> 2);
    scaled_width |= (scaled_width >> 4);
    scaled_width |= (scaled_width >> 8);
    scaled_width |= (scaled_width >> 16);
    ++scaled_width;
    --scaled_height;
    scaled_height |= (scaled_height >> 1);
    scaled_height |= (scaled_height >> 2);
    scaled_height |= (scaled_height >> 4);
    scaled_height |= (scaled_height >> 8);
    scaled_height |= (scaled_height >> 16);
    ++scaled_height;
  }
  if (scaled_width > state.maxtexturesize)
    scaled_width = state.maxtexturesize;
  if (scaled_height > state.maxtexturesize)
    scaled_height = state.maxtexturesize;
  scaled_width >>= 0 // TODO cvr.picmip.value;
  if (scaled_width === 0)
    scaled_width = 1;
  scaled_height >>= 0  // TODO cvr.picmip.value;
  if (scaled_height === 0)
    scaled_height = 1;
  if ((scaled_width !== width) || (scaled_height !== height))
    data = resampleTexture(data, width, height, scaled_width, scaled_height);

  glt = {owner, texnum: gl.createTexture(), identifier: identifier, width: width, height: height};
  bind(0, glt.texnum);
  const uploaded = upload(data, scaled_width, scaled_height, flags);
  // WebGPU backend: retain the expanded RGBA on the WebGLTexture handle itself (the object the world
  // draw uses as its diffuse key, mirroring draw.ts's char_texture retention). Additive + backend-
  // gated — under WebGL2 these fields are never set, so that path stays pixel-identical.
  if (render.state.active != null && render.state.active.backend === 'webgpu') {
    (glt.texnum as any).rgba = uploaded.rgba;
    (glt.texnum as any).rgbaW = uploaded.width;
    (glt.texnum as any).rgbaH = uploaded.height;
  }
  state.textures[state.textures.length] = glt;
  return glt;
}

// Upload a truecolor RGBA image straight to GL (external md3/skybox skins are already
// decoded to RGBA by image.ts, so they skip the palette conversion loadTexture does).
// WebGL2 allows NPOT textures with mipmaps + REPEAT, so no power-of-two resample needed.
// Deduped by identifier like loadTexture.
export const loadRGBATexture = (owner: Model, identifier: string, width: number, height: number, rgba: Uint8Array): GLTexture => {
  const gl = GL.getContext()
  if (identifier.length !== 0) {
    for (var i = 0; i < state.textures.length; ++i) {
      if (state.textures[i].identifier === identifier)
        return state.textures[i]
    }
  }
  const glt: GLTexture = { owner, texnum: gl.createTexture(), identifier, width, height }
  bind(0, glt.texnum)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba)
  gl.generateMipmap(gl.TEXTURE_2D)
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, state.filter_min)
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, state.filter_max)
  // WebGPU backend: retain the truecolor RGBA on the WebGLTexture handle (the object the alias draw
  // keys its skin bind groups off), mirroring loadTexture's retention. External md3/skybox skins are
  // already RGBA; their alpha carries any fullbright/blend mask exactly as fshAlias reads it. Additive
  // + backend-gated — under WebGL2 these fields are never set (pixel-identical).
  if (render.state.active != null && render.state.active.backend === 'webgpu') {
    (glt.texnum as any).rgba = rgba;
    (glt.texnum as any).rgbaW = width;
    (glt.texnum as any).rgbaH = height;
  }
  state.textures[state.textures.length] = glt
  return glt
}

export const loadLightmapTexture = (gl: WebGLRenderingContext, lmNum: number, name: string, width: number, height: number, data: Uint8Array) => {
  const glt: GLTexture = {
    texnum: gl.createTexture(), 
    identifier: name, 
    width: width, 
    height: height,
    owner: null
  };
  bind(0, glt.texnum);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  state.lightmap_textures[lmNum] = glt
  return glt
}

export const loadLightmapTextureSlot = (gl: WebGLRenderingContext, page: number, slot: number, name: string, width: number, height: number, data: Uint8Array) => {
  const glt: GLTexture = {
    texnum: gl.createTexture(),
    identifier: name,
    width: width,
    height: height,
    owner: null
  };
  bind(0, glt.texnum);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  // WebGPU backend: retain the slot RGBA on the WebGLTexture handle (the object the world draw keys
  // its lightmap-page bind groups off), mirroring the world-diffuse retention in loadTexture. The
  // page's staging is dropped after buildLightmaps, so this retained copy is what WebGPU uploads.
  // Additive + backend-gated — under WebGL2 these fields are never set (path stays pixel-identical).
  if (render.state.active != null && render.state.active.backend === 'webgpu') {
    // SNAPSHOT (data.slice), not a live reference: texImage2D copies the bytes at call time, so the GL
    // texture is immutable — but `data` is lightmap.ts's mutable page STAGING, which later surfaces
    // (frontier page, subsequent models) keep writing into and buildLightmaps eventually drops/reshuffles.
    // Retaining the live reference let the WebGPU lightmap-array build (first draw) read bytes that had
    // diverged from what GL got — the "third room corrupt on WebGPU, WebGL fine" bug. A copy makes the
    // retained source byte-identical to the GL upload by construction.
    (glt.texnum as any).rgba = data.slice();
    (glt.texnum as any).rgbaW = width;
    (glt.texnum as any).rgbaH = height;
  }
  if (!state.lightmap_style_textures[page])
    state.lightmap_style_textures[page] = [];
  state.lightmap_style_textures[page][slot] = glt;
  return glt;
}

export const createBlackTexture = (gl: WebGLRenderingContext): WebGLTexture => {
  const texnum = gl.createTexture();
  bind(0, texnum);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  state.black_texture = texnum;
  return texnum;
}

export const freeTexture = (glt: GLTexture) => {
  const gl = GL.getContext()
  gl.deleteTexture(glt.texnum)
}

export const freeTextureForOwner = (owner: Model) => {
  for(var i = state.textures.length - 1; i >= 0; i--) {
    const texture = state.textures[i]
    if (texture.owner === owner) {
      freeTexture(texture)
      state.textures.splice(i, 1)
    }
  }
}

export const freeTextures = () => {
  for(var i = state.textures.length - 1; i >= 0; i--) {
    const texture = state.textures[i]
    freeTexture(texture)
    state.textures.splice(i, 1)
  }
}