// Modern skybox support: cubemap textures loaded from gfx/env/<name><suffix>, driven by
// the worldspawn `sky` key and the `sky` console command. fog.ts is the shape template.
import * as com from './com'
import * as cl from './cl'
import * as con from './console'
import * as q from './q'
import * as cmd from './cmd'
import * as cvar from './cvar'
import * as GL from './GL'
import { getRenderer } from './render'
import { RGBAImage, loadImage } from './image'

// gfx/env/<name><suffix> file order (Ironwail gl_sky.c:408)
const SUFFIXES = ['rt', 'bk', 'lf', 'ft', 'up', 'dn']
// index into SUFFIXES for the +X,-X,+Y,-Y,+Z,-Z cubemap faces (Ironwail gl_sky.c:472 cubemap_order)
const CUBEMAP_ORDER = [3, 1, 4, 5, 0, 2]

export const state = {
  name: '',                              // current skybox name, '' = classic sky
  texture: null as WebGLTexture | null,  // cubemap; null = classic sky
  generation: 0,                         // async guard
  skyfog: 0.5,                           // worldspawn skyfog override storage

  // WebGPU backend only (additive, backend-gated): the 6 cubemap faces' RGBA retained in cube-layer
  // order (+X,-X,+Y,-Y,+Z,-Z — i.e. already remapped through CUBEMAP_ORDER + resized to `cubeSize`),
  // so WebGPURenderer can build its own cube GPUTexture. A fresh array per skybox load → the renderer
  // keys its cube-texture cache off this array's identity (a new skybox re-uploads); null = no cubemap.
  cubeFaces: null as (Uint8Array[] | null),
  cubeSize: 0,                           // cube face edge length (square)

  // _skyroom (QSS gl_sky.c / gl_rmain.c): sky surfaces show a live second render of
  // the world from skyroom_origin instead of the skybox. Persistent buffers — never
  // reallocated (CLAUDE.md rule 8).
  skyroom_enabled: false,                       // a valid _skyroom key was parsed this map
  skyroom_origin: new Float32Array(4),          // x,y,z, [3]=parallax scale of the main vieworg
  skyroom_orientation: new Float32Array(4),     // axis x,y,z, [3]=spin speed (parsed; spin not applied)
  skyroom_drawing: false,                       // true only while rendering the skyroom sub-view
  skyroom_drawn: false,                         // set after the sub-view drew; main pass composites through sky windows
  // Sky-visible gate (QSS R_SkyroomWasVisible, 1-frame lag): only pay for the second
  // pass on frames where a sky surface was actually on screen the previous frame.
  skyVisibleThisFrame: false,
  skyVisibleLastFrame: false,
}

export const cvr: cvar.CVars = {}

// OffscreenCanvas where available, matching image.ts's decodeRaster fallback.
const makeCanvas = (width: number, height: number): any => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return c
}

// cubemaps require square, equal-size faces; mismatched faces are stretched to `size` (cold path)
const resizeFace = (img: RGBAImage, size: number): RGBAImage => {
  if (img.width === size && img.height === size) return img
  const src = makeCanvas(img.width, img.height)
  src.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0)
  const dst = makeCanvas(size, size)
  const dctx = dst.getContext('2d')
  dctx.drawImage(src, 0, 0, size, size)
  const out = dctx.getImageData(0, 0, size, size)
  return { width: size, height: size, data: new Uint8Array(out.data) }
}

const installCubemap = (gl: WebGL2RenderingContext, faces: RGBAImage[]): WebGLTexture => {
  const size = Math.max(...faces.map(f => Math.max(f.width, f.height)))
  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture)
  // WebGPU: collect the resized faces in cube-layer order for the renderer's cube GPUTexture upload.
  const cubeFaces: Uint8Array[] | null = getRenderer().backend === 'webgpu' ? [] : null
  for (let i = 0; i < 6; i++) {
    const face = resizeFace(faces[CUBEMAP_ORDER[i]], size)
    gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X + i, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, face.data)
    if (cubeFaces != null) cubeFaces.push(face.data)
  }
  state.cubeFaces = cubeFaces
  state.cubeSize = size
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  if ((gl as any).TEXTURE_WRAP_R !== undefined)
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, (gl as any).TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, null)
  return texture
}

// Port of Sky_LoadSkyBox (gl_sky.c:409-511), browser-adapted: async face fetch + generation guard.
export const loadSkyBox = async (name: string) => {
  if (name === state.name)
    return // no change

  if (name === '') {
    state.generation++ // cancel any in-flight load
    if (state.texture) {
      GL.getContext().deleteTexture(state.texture)
      state.texture = null
    }
    state.cubeFaces = null   // WebGPU: drop the retained faces so the renderer's cube cache invalidates
    state.cubeSize = 0
    state.name = ''
    return
  }

  state.generation++
  const generation = state.generation

  const faces = await Promise.all(SUFFIXES.map(suf => loadImage('gfx/env/' + name + suf)))

  if (state.generation !== generation)
    return // superseded by a newer load/reset while awaiting

  if (faces.some(f => f === null)) {
    con.print(`Couldn't load skybox "${name}"\n`)
    return // keep classic sky (require all 6 faces)
  }

  const gl = GL.getContext()
  const texture = installCubemap(gl, faces as RGBAImage[])

  if (state.texture)
    gl.deleteTexture(state.texture)
  state.texture = texture
  state.name = name
}

// Parse a "_skyroom" / "skyroom <args>" value: "X Y Z [parallax] [speed ax ay az]".
// Mirrors QSS gl_sky.c:358-378 token order (origin[0..3], orientation[3,0,1,2]).
const setupSkyRoom = (value: string) => {
  const t = value.trim().split(/\s+/)
  state.skyroom_origin[0] = q.atof(t[0] || '0')
  state.skyroom_origin[1] = q.atof(t[1] || '0')
  state.skyroom_origin[2] = q.atof(t[2] || '0')
  state.skyroom_origin[3] = q.atof(t[3] || '0')       // parallax scale
  state.skyroom_orientation[3] = q.atof(t[4] || '0')  // spin speed (parsed, not yet applied)
  state.skyroom_orientation[0] = q.atof(t[5] || '0')
  state.skyroom_orientation[1] = q.atof(t[6] || '0')
  state.skyroom_orientation[2] = q.atof(t[7] || '0')
  state.skyroom_enabled = true
}

// same worldspawn walk as fog.parseWorldspawn (fog.ts:136-183)
export const parseWorldspawn = () => {
  // skyfog seeds from r_skyfog each map load; a worldspawn skyfog key overwrites it
  // (Ironwail gl_sky.c:562,598). No multiply — the render pass uses this value directly.
  state.skyfog = cvr.skyfog.value

  // reset skyroom each map load (fog.ts pattern) — a stale enabled/origin must not
  // carry a previous map's skyroom into a map that has none
  state.skyroom_enabled = false
  state.skyroom_drawn = false
  state.skyVisibleLastFrame = false

  var key, value, data, foundSky = false;

  data = com.parse(cl.clState.worldmodel.entities);
  if (!data)
    return; // error
  if (com.state.token[0] != '{')
    return; // error
  while (1)
  {
    data = com.parse(data);
    if (!data)
      return; // error
    // @ts-ignore - side effects mean this happens.
    if (com.state.token[0] == '}')
      break; // end of worldspawn
    // @ts-ignore - side effects mean this happens.
    if (com.state.token[0] == '_')
      key = com.state.token.substr(1)
    else
      key = com.state.token

    key = key.trim()

    data = com.parse(data);
    if (!data)
      return; // error

    value = com.state.token

    if (key === 'sky' || key === 'skyname' /* Half-Life */ || key === 'qlsky' /* Quake Live */) {
      foundSky = true
      loadSkyBox(value)
    } else if (key === 'skyfog') {
      state.skyfog = q.atof(value)
    } else if (key === 'skyroom') {
      // key was stripped of a leading '_' above, so this matches "_skyroom"
      // (QSS pr_edict.c:999) — bare "skyroom" is a mapper typo QSS also accepts
      setupSkyRoom(value)
    }
  }

  if (!foundSky)
    loadSkyBox('') // map has no sky key: clear any previous map's skybox
}

export const skyCommand_f = () => {
  switch (cmd.state.argv.length)
  {
  case 1:
    con.print(`"sky" is "${state.name}"\n`)
    break;
  case 2:
    loadSkyBox(cmd.state.argv[1]);
    break;
  default:
    con.print('usage: sky <skyname>\n');
  }
}

// QSS gl_sky.c:411 Sky_SkyRoomCommand_f — live setup / echo, handy for testing.
export const skyRoomCommand_f = () => {
  const argv = cmd.state.argv
  if (argv.length === 1) {
    if (state.skyroom_enabled) {
      const o = state.skyroom_origin, r = state.skyroom_orientation
      con.print(`"skyroom" is "${o[0]} ${o[1]} ${o[2]} ${o[3]} ${r[3]} ${r[0]} ${r[1]} ${r[2]}"\n`)
    } else
      con.print('"skyroom" is ""\n')
    return
  }
  if (argv.length >= 4) {
    // join the numeric args and reuse the worldspawn parser
    setupSkyRoom(argv.slice(1).join(' '))
    // all-zero origin with no parallax = disable (QSS gl_sky.c:1913)
    if (!state.skyroom_origin[0] && !state.skyroom_origin[1] && !state.skyroom_origin[2] && !state.skyroom_origin[3])
      state.skyroom_enabled = false
    return
  }
  con.print('usage: skyroom origin_x origin_y origin_z paralax_scale speed axis_x axis_y axis_z\n')
}

export const init = () => {
  // Remounted game view => fresh GL context (texture.ts init() follows the same
  // pattern): any cubemap handle here belongs to the dead context, don't delete it.
  state.generation++
  state.texture = null
  state.cubeFaces = null
  state.cubeSize = 0
  state.name = ''
  state.skyroom_enabled = false
  state.skyroom_drawn = false
  state.skyVisibleLastFrame = false
  cmd.addCommand('sky', skyCommand_f)
  cmd.addCommand('skyroom', skyRoomCommand_f)
  cvr.skyfog = cvar.registerVariable('r_skyfog', '0.5')
  // live r_skyfog change overwrites the current (possibly worldspawn) value (gl_sky.c:638)
  cvar.registerChangedEvent('r_skyfog', () => { state.skyfog = cvr.skyfog.value })
}
