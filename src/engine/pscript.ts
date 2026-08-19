// Scripted-particle system: effectinfo.txt (DarkPlaces dialect) + FTE-native
// `r_part NAME {}` config parsers, particle-font atlas, effect-type registry,
// simulation and instanced rendering. Ports of QSS-M's r_part_fte.c:
// P_ImportEffectInfo ~3023, PScript_ParseParticleEffectFile ~1544 (native dialect),
// PScript_FindParticleType ~1121 (namespace resolution + lazy per-config load).
// Parsing/loading is cold path (map/mod load) — allocation is fine there.
import * as con from './console'
import * as com from './com'
import * as GL from './GL'
import * as cvar from './cvar'
import * as cmd from './cmd'
import * as vec from './vec'
import * as cl from './cl'
import * as sv from './sv'
import * as mod from './mod'
import * as r from './r'
import * as q from './q'
import * as tx from './texture'
import * as vid from './vid'
import * as render from './render'
import { loadImage } from './image'

export type Vec3 = [number, number, number]

// Resolved render/blend hints. QSS-M's "type"/"blend"/"orientation" keys all mutate the
// same two underlying fields (looks.type, looks.blendmode/premul) as they're encountered,
// so later keys in a block override earlier ones — we mirror that by mutating the same
// descriptor fields in file order rather than modelling each key as independent state.
export type RenderType = 'normal' | 'spark' | 'beam' | 'cdecal' | 'udecal'
export type BlendMode = 'alpha' | 'add' | 'invmod'

export type EffectDescriptor = {
  name: string                   // name after the 'effect' token, e.g. 'TE_EXPLOSION'
  config: string                 // namespace: 'effectinfo' or a native config's file base ('fte_weather')
  assoc: number                  // index of the next chained sub-effect (same name reused), -1 = none
  rawType: string                // literal 'type' token value ('' if never given), kept for Phase B/debug
  count: number                  // 'count': particles per spawn call (fractional accumulator)
  countAbsolute: number          // 'countabsolute': absolute particle count override
  renderType: RenderType
  blendMode: BlendMode
  texFirst: number               // atlas cell index; 'tex <first> <last>' picks randomly in [texFirst, texFirst+texCount)
  texCount: number
  sizeStart: number               // 'size s1 s2': spawn size is sizeStart + random()*sizeRand
  sizeRand: number
  sizeIncrease: number            // 'sizeincrease': per-second size delta
  alphaStart: number              // 0..1, spawn alpha is alphaStart + random()*alphaRand
  alphaRand: number
  alphaChange: number             // per-second alpha delta (usually negative = fade out)
  color1: Vec3                    // 0..1 rgb; spawn color lerps randomly between color1/color2
  color2: Vec3
  originJitter: Vec3
  originOffset: Vec3
  velocityJitter: Vec3
  velocityOffset: Vec3
  velocityMultiplier: number      // 'velocitymultiplier': scales inherited velocity
  gravity: number                 // world units/s^2 ('gravity 1' == 800)
  bounce: number                  // 'bounce': clip bounce factor; -2 = blood's implicit decal-on-impact (no bounce)
  airFriction: number
  trailSpacing: number            // world units between trail particles; 0 = not a trail effect
  dieMin: number                  // seconds; resolved from 'time' key, or derived from alpha fade if unspecified
  dieMax: number
  stretchFactor: number
  underwater: boolean              // only spawn when the origin is underwater
  notUnderwater: boolean           // only spawn when the origin is NOT underwater
  rotationStartMin: number         // radians
  rotationStartRand: number
  rotationMin: number
  rotationRand: number
  lightRadius: number
  lightRadiusFade: number
  lightColor: Vec3
  lightTime: number
  lightShadow: boolean
  lightCubemapNum: number
  lightCoronaIntensity: number
  lightCoronaScale: number

  // FTE-native dialect fields, parsed in Phase 1 of docs/plans/weather-particles.md and
  // consumed by Phase 2 (surface emission, impact sub-effects, flurry drift). The native
  // 'bounce'/'clipbounce' keys land HERE, not in `bounce` above (that field is the
  // effectinfo importer's clipbounce equivalent, already consumed by the current sim).
  texName: string                // native 'texture <name>'; '' = particlefont cells via texFirst
  clipType: string               // effect name (within `config`) spawned on world impact; '' = none
  clipBounce: number             // impact bounce factor (default 0.8); 0 = settle, <0 = die+decal
  clipCount: number              // impact sub-effect count scale (default 1)
  flurry: number                 // snow sideways-drift amplitude
  rainFrequency: number          // surface-emission rate multiplier (default 1)
  countRand: number              // native 'count <n> <rand>' second arg
  scaleFactor: number            // residual looks.scalefactor after the >1 consumption (see finish fns)
  minStretch: number             // spark min-length factor (looks.minstretch; 0.5 for effectinfo types)
  spawnMode: string              // native 'spawnmode' (box/ball/circle/...), default 'box'
  spawnParam1: number
  spawnParam2: number
  areaSpread: number             // native 'spawnorg <radius> [vert]'
  areaSpreadVert: number
  spawnVel: number               // native 'spawnvel <radial> [vert]'
  spawnVelVert: number
  fluidMask: string[]            // contents names for underwater/notunderwater (default ['fluid'])

  // clipType resolution cache, filled on first spawn (cold): -2 = unresolved, -1 = none
  clipIdx: number
  clipSpawnCount: number         // clipCount / cliptype-effect's own count (C 7606's division)
}

export type AtlasCell = { s1: number, s2: number, t1: number, t2: number }

export const state = {
  effects: [] as EffectDescriptor[],
  effectsByName: new Map<string, number>(),  // lowercase 'config.name' -> index of the chain head
  loaded: false,                             // effectinfo.txt parse attempted (found or not)
  loadPromise: null as Promise<void> | null,
  // bumped by reset(): async loads capture it at entry and discard their results if a
  // map change happened mid-fetch (else a stale resolve re-sets loaded=true with the
  // OLD map's effects and the new map's registry never loads)
  loadGen: 0,
  configPromises: new Map<string, Promise<void>>(),  // per native config ('fte_weather') lazy loads
  atlasTexture: null as WebGLTexture | null,
  atlasCells: [] as AtlasCell[],              // 256 UV rects: 8x8-grid defaults + particlefont.txt overrides
  fontLoaded: false,

  // Phase B: particle pool (SoA, preallocated to pCapacity in init(); live cap is
  // min(pCapacity, r_fteparticles_max) so a cvar change can only shrink usage, never
  // force a reallocation of the hot arrays).
  pCapacity: 0,
  pNumActive: 0,
  pOrg: new Float32Array(0),
  pVel: new Float32Array(0),
  pColor: new Float32Array(0),          // resolved color1/color2 lerp, constant for the particle's life
  pSpawnTime: new Float32Array(0),
  pDieTime: new Float32Array(0),
  pSize: new Float32Array(0),
  pSizeIncrease: new Float32Array(0),
  pAlpha: new Float32Array(0),
  pAlphaChange: new Float32Array(0),
  pAtlasCell: new Uint16Array(0),      // 0-255 = font cells, BALL_CELL = procedural ball
  pBlendMode: new Uint8Array(0),        // 0=alpha,1=add,2=invmod -- doubles as the draw-bucket index
  pOrientation: new Uint8Array(0),      // 0=billboard, 1=spark/beam (velocity-stretched), 2=oriented flat quad
  pRotation: new Float32Array(0),
  pRotationSpeed: new Float32Array(0),
  pGravity: new Float32Array(0),
  pBounce: new Float32Array(0),
  pAirFriction: new Float32Array(0),
  pStretch: new Float32Array(0),        // stretchfactor: >0 = velocity multiplier, <0 = fixed streak length
  pMinStretch: new Float32Array(0),     // spark min-length factor (length floor = size*0.5*minStretch)
  pFlurry: new Float32Array(0),         // snow sideways-wander amplitude
  pClipMode: new Uint8Array(0),         // 0=none, 1=die on impact, 2=self-bounce, 3=die+spawn cliptype
  pClipIdx: new Int32Array(0),          // resolved cliptype effect index (mode 3)
  pClipBounce: new Float32Array(0),
  pClipSpawnCount: new Float32Array(0),
  pOldOrg: new Float32Array(0),         // org at last clip trace -- accumulates movement to throttle traces

  spawnAccum: [] as number[],           // per-descriptor fractional particle-count carry (runParticleEffect)

  // Phase 2 weather: skytris emission table (SoA, rebuilt per map by loadWorldWeather).
  // Each entry is one triangle of a weather-textured world surface's fan: org + two edge
  // vectors, the QSS-M parallelogram area, the (planeback-corrected) surface normal, the
  // per-tri next-emission timestamp on the skyTime axis, and the effect to emit.
  skyTriCount: 0,
  skyTriOrg: new Float32Array(0),
  skyTriX: new Float32Array(0),
  skyTriY: new Float32Array(0),
  skyTriNormal: new Float32Array(0),
  skyTriArea: new Float32Array(0),
  skyTriNext: new Float64Array(0),
  skyTriEffect: new Int32Array(0),
  skyTime: 0,
  weatherGen: 0,                        // async-load guard across map changes
  flurryTime: 0,                        // countdown to the next shared flurry kick (7036-7043)

  // GL instanced-draw resources: one instance buffer per blend bucket (alpha/add/invmod),
  // filled fresh every drawPScriptParticles() call, plus the shared unit-quad corner buffer.
  cornerBuffer: null as WebGLBuffer | null,
  instanceBuffers: [null, null, null] as WebGLBuffer[],
  instanceData: [null, null, null] as ArrayBuffer[],
  instanceFloats: [null, null, null] as Float32Array[],
  instanceBytes: [null, null, null] as Uint8Array[],
  instanceCounts: [0, 0, 0],

  // Reused every bounce trace this frame; recursiveHullCheck mutates endpos/plane.normal
  // in place (see chase.ts), so the nested arrays must stay real arrays, never replaced.
  bounceTrace: {
    fraction: 1, allsolid: true, startsolid: false, inopen: false, inwater: false,
    endpos: [0, 0, 0], plane: { normal: [0, 0, 0], dist: 0, type: 0, signbits: 0 }, ent: null
  } as any,
  // Persistent trace/spawn temporaries: recursiveHullCheck reads p1/p2 without mutating
  // them (chase.ts passes the live view origin as p1), and runParticleEffect copies org/
  // dir before returning. Persistent instead of vec.scratch() because the sim can trace
  // hundreds of clip particles per frame -- 2 scratch each would exhaust the frame pool.
  traceStart: [0, 0, 0] as Vec3,
  traceEnd: [0, 0, 0] as Vec3,
  clipOrg: [0, 0, 0] as Vec3,
  clipDir: [0, 0, 0] as Vec3,
}

export const cvr: cvar.CVars = {}

// sentinel for an unspecified 'time' key, matches r_part_fte.c's ptype->die==9999 check
const DIE_UNSET = 9999
// atlas cell index of the procedural radial-gradient ball (composited below the font)
const BALL_CELL = 256
const BALL_SIZE = 64
const RAD = Math.PI / 180

const newDescriptor = (config: string, name: string): EffectDescriptor => ({
  name,
  config,
  assoc: -1,
  rawType: '',
  count: 0,
  countAbsolute: 0,
  renderType: 'normal',
  blendMode: 'alpha',
  texFirst: 63,          // default cell (r_part_fte.c: i = 63 "default texture is 63")
  texCount: 1,
  sizeStart: 1,
  sizeRand: 0,
  sizeIncrease: 0,
  alphaStart: 0,
  alphaRand: 1,
  alphaChange: -1,
  color1: [1, 1, 1],
  color2: [1, 1, 1],
  originJitter: [0, 0, 0],
  originOffset: [0, 0, 0],
  velocityJitter: [0, 0, 0],
  velocityOffset: [0, 0, 0],
  velocityMultiplier: 0,
  gravity: 0,
  bounce: 0,
  airFriction: 0,
  trailSpacing: 0,
  dieMin: DIE_UNSET,
  dieMax: DIE_UNSET,
  stretchFactor: 1,
  underwater: false,
  notUnderwater: false,
  rotationStartMin: 0,
  rotationStartRand: 0,
  rotationMin: 0,
  rotationRand: 0,
  lightRadius: 0,
  lightRadiusFade: 0,
  lightColor: [0, 0, 0],
  lightTime: 0,
  lightShadow: true,
  lightCubemapNum: 0,
  lightCoronaIntensity: 0,
  lightCoronaScale: 0,

  // P_ResetToDefaults values shared by both dialects, plus effectinfo-net residuals
  texName: '',
  clipType: '',
  clipBounce: 0.8,
  clipCount: 1,
  flurry: 0,
  rainFrequency: 1,
  countRand: 0,
  scaleFactor: 1,        // effectinfo net: import inits 2, FinishParticleType consumes it into size
  minStretch: 0.5,       // FinishEffectinfoParticleType (3020) fixes 0.5 for all effectinfo types
  spawnMode: 'box',      // SM_BOX == 0 == the memset default
  spawnParam1: 0,
  spawnParam2: 0,
  areaSpread: 0,
  areaSpreadVert: 0,
  spawnVel: 0,
  spawnVelVert: 0,
  fluidMask: ['fluid'],
  clipIdx: -2,
  clipSpawnCount: 0,
})

// FTE-native `r_part` blocks get P_ResetToDefaults (1430-1517) RAW — none of the
// effectinfo import init's overrides (scale=1/alpha=0..1 rand/white rgb/stretch=1/
// scalefactor=2/cell-63 premul defaults) apply.
const newNativeDescriptor = (config: string, name: string): EffectDescriptor => {
  const d = newDescriptor(config, name)
  d.sizeStart = 0          // 'scale' unset (memset)
  d.alphaStart = 1
  d.alphaRand = 0
  d.alphaChange = 1        // pre-fixup sentinel; finishNativeEffect rescales unless 'alphadelta' was given
  d.color1 = [0, 0, 0]     // native default rgb is black
  d.color2 = [0, 0, 0]
  d.dieMin = 0             // 'die' unset -> 0-second life (C divides by it; we guard)
  d.dieMax = 0
  d.stretchFactor = 0.05   // looks.stretch
  d.minStretch = 0
  d.scaleFactor = 0        // memset; residual invscalefactor semantics are Phase 2's concern
  d.rotationStartMin = -Math.PI  // random full-circle start angle
  d.rotationStartRand = 2 * Math.PI
  return d
}

// strtoul(str, NULL, 0) equivalent for '0x...' / plain-decimal color literals (the only
// forms effectinfo.txt files use in practice).
const parseCNumber = (s: string): number => /^0[xX]/.test(s) ? parseInt(s, 16) : parseInt(s, 10)

// strips /* ... */ block comments (which may span lines) before line splitting; '//' line
// comments are handled per-line in tokenizeLine since they don't cross newlines.
const stripBlockComments = (text: string): string => {
  let out = ''
  let i = 0
  while (i < text.length) {
    if (text[i] === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/'))
        out += text[i++] === '\n' ? '\n' : ' '
      i += 2
    } else {
      out += text[i++]
    }
  }
  return out
}

const tokenizeLine = (line: string): string[] => {
  const args: string[] = []
  let i = 0
  while (i < line.length) {
    while (i < line.length && line.charCodeAt(i) <= 32) i++
    if (i >= line.length) break
    if (line[i] === '/' && line[i + 1] === '/') break
    if (line[i] === '"') {
      i++
      let tok = ''
      while (i < line.length && line[i] !== '"') tok += line[i++]
      i++
      args.push(tok)
    } else {
      let tok = ''
      while (i < line.length && line.charCodeAt(i) > 32) tok += line[i++]
      args.push(tok)
    }
  }
  return args
}

type ParseCtx = { d: EffectDescriptor, bloodDecalOnImpact: boolean }

const applyType = (ctx: ParseCtx, val: string, warn: (s: string) => void) => {
  const d = ctx.d
  d.rawType = val
  switch (val) {
    case 'decal': case 'cdecal': d.renderType = 'cdecal'; d.blendMode = 'invmod'; break
    case 'udecal': d.renderType = 'udecal'; d.blendMode = 'invmod'; break
    case 'alphastatic': d.renderType = 'normal'; d.blendMode = 'alpha'; break
    case 'static': case 'smoke': case 'bubble': d.renderType = 'normal'; d.blendMode = 'add'; break
    case 'snow': d.renderType = 'normal'; d.blendMode = 'add'; d.flurry = 32; break  // r_part_fte.c:3250
    case 'spark': d.renderType = 'spark'; d.blendMode = 'add'; break
    case 'blood': d.renderType = 'normal'; d.blendMode = 'invmod'; d.gravity = 800; ctx.bloodDecalOnImpact = true; break
    case 'beam': d.renderType = 'beam'; d.blendMode = 'add'; break
    default: warn(`effectinfo type ${val} not supported\n`)
  }
}

const applyBlend = (d: EffectDescriptor, val: string, warn: (s: string) => void) => {
  if (val === 'invmod') d.blendMode = 'invmod'
  else if (val === 'alpha') d.blendMode = 'alpha'
  else if (val === 'add') d.blendMode = 'add'
  else warn(`effectinfo 'blend ${val}' not supported\n`)
}

const applyOrientation = (d: EffectDescriptor, val: string, warn: (s: string) => void) => {
  if (val === 'billboard') d.renderType = 'normal'
  else if (val === 'spark') d.renderType = 'spark'
  else if (val === 'oriented') { if (d.renderType !== 'cdecal') d.renderType = 'udecal' }
  else if (val === 'beam') d.renderType = 'beam'
  else warn(`effectinfo 'orientation ${val}' not supported\n`)
}

// Mirrors the big if/else-if chain in P_ImportEffectInfo: a recognised key with the wrong
// arg count falls through to the same "not recognised" warning as a truly unknown token.
const applyKey = (ctx: ParseCtx, args: string[], warn: (s: string) => void) => {
  const d = ctx.d
  const key = args[0]
  const n = args.length
  if (key === 'countabsolute' && n === 2) d.countAbsolute = parseFloat(args[1])
  else if (key === 'count' && n === 2) d.count = parseFloat(args[1])
  else if (key === 'type' && n === 2) applyType(ctx, args[1], warn)
  else if (key === 'tex' && n === 3) {
    const mini = parseInt(args[1], 10), maxi = parseInt(args[2], 10)
    d.texFirst = mini
    d.texCount = Math.max(1, maxi - mini)
  }
  else if (key === 'size' && n === 3) {
    const s1 = parseFloat(args[1]), s2 = parseFloat(args[2])
    d.sizeStart = s1
    d.sizeRand = s2 - s1
  }
  else if (key === 'sizeincrease' && n === 2) d.sizeIncrease = parseFloat(args[1])
  else if (key === 'color' && n === 3) {
    const rgb1 = parseCNumber(args[1]), rgb2 = parseCNumber(args[2])
    d.color1 = [((rgb1 >> 16) & 0xff) / 255, ((rgb1 >> 8) & 0xff) / 255, (rgb1 & 0xff) / 255]
    d.color2 = [((rgb2 >> 16) & 0xff) / 255, ((rgb2 >> 8) & 0xff) / 255, (rgb2 & 0xff) / 255]
  }
  else if (key === 'alpha' && n === 4) {
    const a1 = parseFloat(args[1]), a2 = parseFloat(args[2]), f = parseFloat(args[3])
    d.alphaStart = Math.min(a1, a2) / 256
    d.alphaRand = Math.abs(a2 - a1) / 256
    d.alphaChange = -f / 256
  }
  else if (key === 'velocityoffset' && n === 4) d.velocityOffset = [parseFloat(args[1]), parseFloat(args[2]), parseFloat(args[3])]
  else if (key === 'velocityjitter' && n === 4) d.velocityJitter = [parseFloat(args[1]), parseFloat(args[2]), parseFloat(args[3])]
  else if (key === 'originoffset' && n === 4) d.originOffset = [parseFloat(args[1]), parseFloat(args[2]), parseFloat(args[3])]
  else if (key === 'originjitter' && n === 4) d.originJitter = [parseFloat(args[1]), parseFloat(args[2]), parseFloat(args[3])]
  else if (key === 'gravity' && n === 2) d.gravity = 800 * parseFloat(args[1])
  else if (key === 'bounce' && n === 2) d.bounce = parseFloat(args[1])
  else if (key === 'airfriction' && n === 2) d.airFriction = parseFloat(args[1])
  else if (key === 'liquidfriction' && n === 2) { /* DP key; QSS-M parses and discards it too */ }
  else if (key === 'underwater' && n === 1) d.underwater = true
  else if (key === 'notunderwater' && n === 1) d.notUnderwater = true
  else if (key === 'velocitymultiplier' && n === 2) d.velocityMultiplier = parseFloat(args[1])
  else if (key === 'trailspacing' && n === 2) {
    d.trailSpacing = parseFloat(args[1])
    if (d.trailSpacing > 0) d.count = 1 / d.trailSpacing
  }
  else if (key === 'time' && n === 3) {
    const a1 = parseFloat(args[1]), a2 = parseFloat(args[2])
    d.dieMin = Math.min(a1, a2)
    d.dieMax = Math.max(a1, a2)
  }
  else if (key === 'stretchfactor' && n === 2) d.stretchFactor = parseFloat(args[1])
  else if (key === 'blend' && n === 2) applyBlend(d, args[1], warn)
  else if (key === 'orientation' && n === 2) applyOrientation(d, args[1], warn)
  else if (key === 'lightradius' && n === 2) d.lightRadius = parseFloat(args[1])
  else if (key === 'lightradiusfade' && n === 2) d.lightRadiusFade = parseFloat(args[1])
  else if (key === 'lightcolor' && n === 4) d.lightColor = [parseFloat(args[1]), parseFloat(args[2]), parseFloat(args[3])]
  else if (key === 'lighttime' && n === 2) d.lightTime = parseFloat(args[1])
  else if (key === 'lightshadow' && n === 2) d.lightShadow = parseInt(args[1], 10) !== 0
  else if (key === 'lightcubemapnum' && n === 2) d.lightCubemapNum = parseInt(args[1], 10)
  else if (key === 'lightcorona' && n === 3) { d.lightCoronaIntensity = parseFloat(args[1]) * 0.25; d.lightCoronaScale = parseFloat(args[2]) }
  else if ((key === 'staincolor' || key === 'stainalpha' || key === 'stainsize' || key === 'staintex') && n === 3)
    warn(`Particle effect token ${key} not supported\n`)
  else if (key === 'stainless' && n === 2)
    warn(`Particle effect token ${key} not supported\n`)
  else if (key === 'rotate' && n === 5) {
    const rsMin = parseFloat(args[1]), rsRand = parseFloat(args[2]) - rsMin
    const rMin = parseFloat(args[3]), rRand = parseFloat(args[4]) - rMin
    // r_part_fte.c adds a constant pi/4 bias to the start angle after the deg->rad conversion
    d.rotationStartMin = rsMin * RAD + Math.PI / 4
    d.rotationStartRand = rsRand * RAD
    d.rotationMin = rMin * RAD
    d.rotationRand = rRand * RAD
  }
  else
    warn(`Particle effect token not recognised, or invalid args: ${args.slice(0, 6).join(' ')}\n`)
}

// Applies the per-block deferred fixups r_part_fte.c does in FinishEffectinfoParticleType
// (2977-3021): blood's decal-on-impact overrides bounce, an unspecified 'time' derives its
// die time from the alpha fade rate (or 15s if alpha never changes), and per-type scale/
// stretch adjustments. Every imported effect additionally gets scale/scalerand (NOT
// scaledelta) x2 from FinishParticleType's looks.scalefactor pass — P_ImportEffectInfo
// inits scalefactor=2/invscalefactor=0 (3161-3162), nothing in the effectinfo dialect can
// change it, and FinishEffectinfoParticleType ends by calling FinishParticleType (3021,
// block at 2941-2947). The multipliers below are the net of {per-type finish, x2
// scalefactor, FTE's per-type renderer factor} restated for our convention where size is
// the on-screen TEXTURE SIDE of an axis-aligned quad (shader half-extent = size*0.5).
// FTE draws diamonds — vertices at circumradius R along right/up, texture corners at the
// vertices — so the drawn texture's side is R*sqrt2 and that is what must match ours:
//   normal (R_AddTexturedParticle, R = p->scale*0.25):
//     R = (dp*2stretch*2)*0.25 = dp*stretch      -> side sqrt2*dp*stretch
//     Rdelta = (dp_d*4stretch)*0.25 = dp_d*stretch -> growth sqrt2*dp_d*stretch /s
//   udecal (R_AddUnclippedDecal, R = p->scale):
//     R = dp*(stretch/sqrt2)*2 = sqrt2*dp*stretch -> side 2*dp*stretch
//     Rdelta = dp_d*stretch/sqrt2                 -> growth dp_d*stretch /s
//   spark/beam (R_AddTSparkParticle, rendered WIDTH = p->scale, no diamond):
//     width = dp*2, width growth = dp_d /s (scaledelta never scaled for sparks);
//     stretch *= 0.04 with FTE's negative-stretch = fixed length collapsing to the same
//     epsilon the C uses (beams reuse the spark render fallback); the min-length floor
//     halfscale*minstretch = p->scale*0.25 matches our size*0.25 once size is doubled
const finishEffect = (ctx: ParseCtx) => {
  const d = ctx.d
  if (ctx.bloodDecalOnImpact) d.bounce = -2
  if (d.dieMin === DIE_UNSET) {
    d.dieMin = d.dieMax = d.alphaChange !== 0 ? (d.alphaStart + d.alphaRand) / -d.alphaChange : 15
  }
  if (d.renderType === 'normal') {
    const m = Math.SQRT2 * d.stretchFactor
    d.sizeStart *= m
    d.sizeRand *= m
    d.sizeIncrease *= m
    d.stretchFactor = 1
  } else if (d.renderType === 'udecal') {
    d.sizeStart *= 2 * d.stretchFactor
    d.sizeRand *= 2 * d.stretchFactor
    d.sizeIncrease *= d.stretchFactor
    d.stretchFactor = 1
  } else if (d.renderType === 'spark' || d.renderType === 'beam') {
    d.sizeStart *= 2
    d.sizeRand *= 2
    d.stretchFactor *= 0.04
    if (d.stretchFactor < 0) d.stretchFactor = 0.000001
    else if (d.stretchFactor === 0) d.stretchFactor = 0.05  // FinishParticleType's "old default" for stretchless sparks
  }
}

// Pure parser: no engine module dependencies, so it's independently testable (see the
// Phase A verification script). Warnings are returned rather than printed so callers
// decide how/whether to surface them.
export const parseEffectInfoText = (text: string): { effects: EffectDescriptor[], warnings: string[] } => {
  const warnings: string[] = []
  const warn = (s: string) => warnings.push(s)
  const effects: EffectDescriptor[] = []
  const headIndex = new Map<string, number>() // lowercase name -> first descriptor with that name

  const lines = stripBlockComments(text).split('\n')
  let ctx: ParseCtx | null = null

  for (const rawLine of lines) {
    const args = tokenizeLine(rawLine)
    if (args.length === 0) continue
    const key = args[0]
    if (key === 'effect') {
      if (ctx) finishEffect(ctx)
      const name = args[1] ?? ''
      const d = newDescriptor('effectinfo', name)
      const idx = effects.length
      effects.push(d)
      const lower = name.toLowerCase()
      const head = headIndex.get(lower)
      if (head === undefined) {
        headIndex.set(lower, idx)
      } else {
        // walk the existing assoc chain to its tail and link this duplicate block as next
        let tail = head
        while (effects[tail].assoc !== -1) tail = effects[tail].assoc
        effects[tail].assoc = idx
      }
      ctx = { d, bloodDecalOnImpact: false }
    } else if (!ctx) {
      warn('Bad effectinfo file\n')
      break
    } else {
      applyKey(ctx, args, warn)
    }
  }
  if (ctx) finishEffect(ctx)

  return { effects, warnings }
}

// Appends parsed descriptors to the global registry, shifting their local assoc indices
// and registering '<config>.<name>' keys (first block of a name is the chain head; later
// same-name blocks are reachable only through assoc, so first-wins is correct).
const registerEffects = (effects: EffectDescriptor[]) => {
  const base = state.effects.length
  for (const d of effects) {
    if (d.assoc !== -1) d.assoc += base
    state.effects.push(d)
    const key = `${d.config.toLowerCase()}.${d.name.toLowerCase()}`
    if (!state.effectsByName.has(key)) state.effectsByName.set(key, state.effects.length - 1)
  }
}

// Loads+parses effectinfo.txt from the current gamedir. Tolerant of a missing file (mods
// without scripted particles are the common case) — registry just stays empty, no warning.
// Appends (never rebuilds) so indices of native configs loaded first stay valid.
export const loadEffects = async (): Promise<void> => {
  const gen = state.loadGen
  const text = await com.loadTextFile('effectinfo.txt')
  if (gen !== state.loadGen) return  // map changed mid-fetch: stale result, discard
  if (text != null) {
    const { effects, warnings } = parseEffectInfoText(text)
    registerEffects(effects)
    // developer-only: known-unsupported keys (stain*, etc.) would otherwise spam every load
    for (const w of warnings) con.dPrint(w)
    con.print(`pscript: ${effects.length} effectinfo particle types\n`)
  }
  state.loaded = true
}

// ---------------------------------------------------------------------------------
// FTE-native `r_part NAME { key value }` dialect (weather-particles Phase 1). Port of
// PScript_ParseParticleEffectFile (1544-2811). Key semantics differ from effectinfo:
// alpha/scale/die/gravity are direct values (no /256, no x800), rgb is bytes, and
// defaults come from P_ResetToDefaults raw (see newNativeDescriptor). clipType/
// clipBounce/clipCount/flurry/rainFrequency/spawnMode/areaSpread are parsed+stored here
// and consumed by Phase 2 (surface emission, impact splashes, flurry drift).

type NativeCtx = { d: EffectDescriptor, setType: boolean, setAlphaDelta: boolean }

// native 'type' values (2457-2479). All spark variants (untextured spark/linespark,
// sparkfan/trianglefan, texturedspark) collapse onto our textured-spark renderType —
// we have no line/fan primitives, and QSS-M itself degrades between them via cvars.
const applyNativeType = (ctx: NativeCtx, val: string, warn: (s: string) => void) => {
  const d = ctx.d
  d.rawType = val
  ctx.setType = true
  switch (val) {
    case 'beam': d.renderType = 'beam'; break
    case 'spark': case 'linespark': case 'sparkfan': case 'trianglefan': case 'texturedspark':
      d.renderType = 'spark'; break
    case 'decal': case 'cdecal': d.renderType = 'cdecal'; break
    case 'udecal': d.renderType = 'udecal'; break
    case 'normal': d.renderType = 'normal'; break
    default:
      warn(`${d.config}.${d.name}: uses unknown render type '${val}', assuming 'normal'\n`)
      d.renderType = 'normal'
  }
}

// native 'blend' values (2377-2415) folded onto our three buckets
const applyNativeBlend = (d: EffectDescriptor, val: string, warn: (s: string) => void) => {
  switch (val) {
    case 'add': case 'adda': case 'addc': case 'premul_add': d.blendMode = 'add'; break
    case 'subtract': case 'invmod': case 'invmoda': case 'invmodc': case 'premul_subtract': d.blendMode = 'invmod'; break
    case 'blend': case 'blendalpha': case 'blendcolour': case 'blendcolor': case 'premul_blend': d.blendMode = 'alpha'; break
    default:
      warn(`${d.config}.${d.name}: uses unknown blend type '${val}', assuming legacy 'blendalpha'\n`)
      d.blendMode = 'alpha'
  }
}

const NATIVE_SPAWN_MODES = ['box', 'circle', 'ball', 'spiral', 'tracer', 'telebox', 'lavasplash', 'uniformcircle', 'syncfield', 'distball']

// underwater/notunderwater contents list (2053-2097); both-flags conflict clears underwater
const applyNativeFluid = (d: EffectDescriptor, args: string[], under: boolean, warn: (s: string) => void) => {
  if (under) d.underwater = true
  else d.notUnderwater = true
  if (d.underwater && d.notUnderwater) {
    d.underwater = false
    warn(`${d.config}.${d.name}: both over and under water\n`)
  }
  d.fluidMask = args.length > 1 ? args.slice(1) : ['fluid']
}

// the per-key handler chain (1777-2771), restricted to fte_weather.cfg's keys plus the
// common core per the plan's scope guard; everything else dPrints and is skipped
const applyNativeKey = (ctx: NativeCtx, args: string[], warn: (s: string) => void) => {
  const d = ctx.d
  const key = args[0]
  const n = args.length
  const f = (i: number) => parseFloat(args[i])
  if ((key === 'texture' || key === 'linear_texture' || key === 'nearest_texture' || key === 'nearesttexture') && n >= 2)
    d.texName = args[1]
  else if (key === 'scale' && n >= 2) { d.sizeStart = f(1); d.sizeRand = n > 2 ? f(2) - d.sizeStart : 0 }
  else if (key === 'scalerand' && n >= 2) d.sizeRand = f(1)
  else if (key === 'scalefactor' && n >= 2) d.scaleFactor = f(1)
  else if (key === 'scaledelta' && n >= 2) d.sizeIncrease = f(1)
  else if (key === 'stretchfactor' && n >= 2) { d.stretchFactor = f(1); d.minStretch = n > 2 ? f(2) : 0 }
  else if (key === 'count' && n >= 2) {
    d.trailSpacing = 0
    d.count = f(1)
    if (n > 2) d.countRand = f(2)
    if (n > 3) d.countAbsolute = f(3)  // countextra
  }
  else if (key === 'step' && n >= 2) {
    d.trailSpacing = f(1)
    d.count = 1 / f(1)
    if (n > 3) d.countAbsolute = f(3)
  }
  else if (key === 'rainfrequency' && n >= 2) d.rainFrequency = f(1)
  else if (key === 'alpha' && n >= 2) d.alphaStart = f(1)          // direct 0-1, unlike effectinfo's /256
  else if (key === 'alpharand' && n >= 2) d.alphaRand = f(1)
  else if (key === 'alphadelta' && n >= 2) { d.alphaChange = f(1); ctx.setAlphaDelta = true }
  else if (key === 'alphachange' && n >= 2) d.alphaChange = f(1)   // deprecated form: still gets the die rescale
  else if (key === 'die' && n >= 2) {
    if (n > 2) { const a = f(1), b = f(2); d.dieMin = Math.min(a, b); d.dieMax = Math.max(a, b) }
    else d.dieMin = d.dieMax = f(1)
  }
  else if (key === 'veladd' && n >= 2) {
    d.velocityMultiplier = f(1)
    if (n > 2) warn(`${d.config}.${d.name}: veladd random range not supported\n`)
  }
  else if (key === 'randomvel' && n >= 2) {
    // shortcut for velwrand + z velbias (1956-1978)
    const h = f(1)
    d.velocityJitter[0] = d.velocityJitter[1] = h
    d.velocityOffset[0] = d.velocityOffset[1] = 0
    if (n > 3) {
      // zmin/zmax form: z rand is +/-, so recentre the range onto the bias
      d.velocityOffset[2] = f(2)
      const half = (f(3) - d.velocityOffset[2]) / 2
      d.velocityJitter[2] = half
      d.velocityOffset[2] += half
    } else if (n > 2) { d.velocityJitter[2] = f(2); d.velocityOffset[2] = 0 }
    else { d.velocityJitter[2] = h; d.velocityOffset[2] = 0 }
  }
  else if (key === 'velbias' && n >= 4) { d.velocityOffset[0] = f(1); d.velocityOffset[1] = f(2); d.velocityOffset[2] = f(3) }
  else if (key === 'velwrand' && n >= 4) { d.velocityJitter[0] = f(1); d.velocityJitter[1] = f(2); d.velocityJitter[2] = f(3) }
  else if (key === 'orgbias' && n >= 4) { d.originOffset[0] = f(1); d.originOffset[1] = f(2); d.originOffset[2] = f(3) }
  else if (key === 'orgwrand' && n >= 4) { d.originJitter[0] = f(1); d.originJitter[1] = f(2); d.originJitter[2] = f(3) }
  else if (key === 'friction' && n >= 2) {
    d.airFriction = f(1)
    if (n > 2) warn(`${d.config}.${d.name}: per-axis friction not supported, using ${args[1]} for all axes\n`)
  }
  else if (key === 'gravity' && n >= 2) d.gravity = f(1)           // direct units/s^2, unlike effectinfo's x800
  else if (key === 'flurry' && n >= 2) d.flurry = f(1)
  else if (key === 'cliptype' && n >= 2) d.clipType = args[1]      // resolved within d.config at spawn (Phase 2)
  else if (key === 'clipcount' && n >= 2) d.clipCount = f(1)
  else if (key === 'clipbounce' && n >= 2) {
    d.clipBounce = f(1)
    if (d.clipBounce < 0 && d.clipType === '') d.clipType = d.name  // C points cliptype at self (2514)
  }
  else if (key === 'bounce' && n >= 2) {
    // native 'bounce' = self-clipping shorthand (2517-2521); nothing to do with the
    // effectinfo importer's 'bounce' key (d.bounce)
    d.clipType = d.name
    d.clipBounce = f(1)
  }
  else if (key === 'rgb' && n >= 2) {
    // byte version: rgb v -> all channels, rgb r g b -> per channel
    const r0 = f(1) / 255
    const g0 = n > 3 ? f(2) / 255 : r0
    const b0 = n > 3 ? f(3) / 255 : r0
    d.color1 = [r0, g0, b0]; d.color2 = [r0, g0, b0]
  }
  else if (key === 'rgbf' && n >= 2) {
    const r0 = f(1), g0 = n > 3 ? f(2) : r0, b0 = n > 3 ? f(3) : r0
    d.color1 = [r0, g0, b0]; d.color2 = [r0, g0, b0]
  }
  else if (key === 'red' && n >= 2) { d.color1[0] = d.color2[0] = f(1) / 255 }
  else if (key === 'green' && n >= 2) { d.color1[1] = d.color2[1] = f(1) / 255 }
  else if (key === 'blue' && n >= 2) { d.color1[2] = d.color2[2] = f(1) / 255 }
  else if (key === 'rgbrand' && n >= 2) {
    // random add per channel; our color model lerps color1..color2 with ONE shared roll,
    // vs FTE's independent per-channel rolls (rgbrandsync defaults 0) -- close enough
    const r0 = f(1) / 255, g0 = n > 3 ? f(2) / 255 : r0, b0 = n > 3 ? f(3) / 255 : r0
    d.color2 = [d.color1[0] + r0, d.color1[1] + g0, d.color1[2] + b0]
  }
  else if (key === 'blend' && n >= 2) applyNativeBlend(d, args[1], warn)
  else if (key === 'type' && n >= 2) applyNativeType(ctx, args[1], warn)
  else if (key === 'spawnmode' && n >= 2) {
    if (NATIVE_SPAWN_MODES.indexOf(args[1]) >= 0) d.spawnMode = args[1]
    else {
      warn(`${d.config}.${d.name}: uses unknown spawn type '${args[1]}', assuming 'box'\n`)
      d.spawnMode = 'box'
    }
    if (n > 2) d.spawnParam1 = f(2)
    if (n > 3) d.spawnParam2 = f(3)
  }
  else if (key === 'spawnorg' && n >= 2) { d.areaSpread = f(1); d.areaSpreadVert = n > 2 ? f(2) : f(1) }
  else if (key === 'spawnvel' && n >= 2) { d.spawnVel = f(1); d.spawnVelVert = n > 2 ? f(2) : f(1) }
  else if (key === 'underwater') applyNativeFluid(d, args, true, warn)
  else if (key === 'notunderwater') applyNativeFluid(d, args, false, warn)
  else if (key === 'rotationstart' && n >= 2) {
    d.rotationStartMin = f(1) * RAD
    d.rotationStartRand = n > 2 ? f(2) * RAD - d.rotationStartMin : 0
  }
  else if (key === 'rotationspeed' && n >= 2) {
    d.rotationMin = f(1) * RAD
    d.rotationRand = n > 2 ? f(2) * RAD - d.rotationMin : 0
  }
  else if (key === 'rotation' && n >= 4) {
    d.rotationStartMin = f(1) * RAD
    d.rotationStartRand = n > 2 ? f(2) * RAD - d.rotationStartMin : 0
    d.rotationMin = f(3) * RAD
    d.rotationRand = n > 4 ? f(4) * RAD - d.rotationMin : 0
  }
  else
    warn(`${d.config}.${d.name}: ${key} is not a recognised particle type field\n`)
}

// End-of-block fixups: the native parser's own epilogue (2773-2809) + FinishParticleType
// (2927-2973) + our size-convention conversion. Unlike finishEffect, NONE of the
// effectinfo import factors (scalefactor 2, stretch 1, sqrt2*stretch bake) apply here.
const finishNativeEffect = (ctx: NativeCtx, warn: (s: string) => void) => {
  const d = ctx.d
  if (d.clipCount < 1) d.clipCount = 1

  // named textures resolve to external images or procedural blobs in QSS-M
  // (P_LoadTexture 1242-1428: 'ball'/'glow' and texturedsparks get a radial-gradient
  // circle); we composite that gradient into atlas padding at font load (BALL_CELL).
  // The old cell-63 fallback was invisible on AD: its particlefont.txt maps cell 63
  // to a near-empty region (avg alpha 15/255) -- rain rendered as nothing.
  if (d.texName !== '') {
    d.texFirst = BALL_CELL
    d.texCount = 1
  }

  if (!ctx.setType && d.renderType === 'normal' && d.texName === '') {
    // C picks procedural SPARK/SPARKFAN; our nearest equivalent is the textured spark
    d.renderType = 'spark'
    warn(`${d.config}.${d.name}: effect lacks a texture. assuming type spark.\n`)
  }

  // "old behavior": without an explicit alphadelta, alphachange is a fade FRACTION over
  // the particle's life, rescaled to a per-second delta (2802-2803). C divides by die
  // (inf when die is unset); we clamp to instant-expiry particles never fading up.
  if (!ctx.setAlphaDelta)
    d.alphaChange = d.dieMax > 0 ? (-d.alphaChange / d.dieMax) * d.alphaStart : 0

  // FinishParticleType: scalefactor>1 (with invscalefactor still 0 at parse time) is
  // consumed into scale/scalerand -- NOT scaledelta (2941-2947)
  if (d.scaleFactor > 1) {
    d.sizeStart *= d.scaleFactor
    d.sizeRand *= d.scaleFactor
    d.scaleFactor = 1
  }
  // PT_TEXTUREDSPARK with no stretch gets the old 0.05 default (2950-2951)
  if ((d.renderType === 'spark' || d.renderType === 'beam') && d.stretchFactor === 0)
    d.stretchFactor = 0.05

  // FTE-radius -> our size-is-texture-side convention (same derivation as finishEffect's
  // comment block). Sparks: rendered width IS p->scale, so no factor; stretchFactor stays
  // RAW -- negative means a fixed streak length in world units (R_AddTSparkParticle
  // 6584-6592), which Phase 2's renderer consumes (the current fill treats pStretch as a
  // velocity multiplier only, so native negative-stretch sparks mis-render until then).
  if (d.renderType === 'normal') {
    const m = 0.25 * Math.SQRT2   // R = scale*0.25, drawn texture side = R*sqrt2
    d.sizeStart *= m; d.sizeRand *= m; d.sizeIncrease *= m
  } else if (d.renderType === 'udecal' || d.renderType === 'cdecal') {
    const m = Math.SQRT2          // R = scale, side = R*sqrt2
    d.sizeStart *= m; d.sizeRand *= m; d.sizeIncrease *= m
  }
}

// Pure line-oriented parser for one native config file (no engine deps -- independently
// testable like parseEffectInfoText). `config` names the namespace; a rare mid-file
// `r_part namespace X` directive rebinds it. Returned descriptors use local assoc
// indices; registerEffects shifts them.
export const parseNativeConfigText = (config: string, text: string): { effects: EffectDescriptor[], warnings: string[] } => {
  const warnings: string[] = []
  const warn = (s: string) => warnings.push(s)
  const effects: EffectDescriptor[] = []
  const heads = new Map<string, number>()  // '<config>.<name>' lower -> local head index
  const lines = text.split('\n')
  let i = 0

  while (i < lines.length) {
    const args = tokenizeLine(lines[i]); i++
    if (args.length === 0) continue
    const command = args[0]
    if (command === 'r_effect' || command === 'r_trail' || command === 'r_partredirect') {
      warn(`pscript: '${command}' not supported, skipped\n`)
      continue
    }
    if (command !== 'r_part') {
      warn(`Unknown particle command "${command}"\n`)
      continue
    }
    if (args.length !== 2) {
      if (args[1] === 'namespace' && args.length >= 3) { config = args[2]; continue }
      warn('No name for particle effect\n')
      continue
    }
    // the C requires '{' to open the very next line (1608-1617); anything else reparses
    // that line as a new top-level command
    if (i >= lines.length) break
    const opener = tokenizeLine(lines[i])
    if (opener.length === 0 || opener[0][0] !== '{') {
      warn('This is a multiline command and should be used within config files\n')
      continue
    }
    i++

    // '+name' chains onto the existing effect's assoc tail (1649-1674); a bare-name
    // redefinition replaces the earlier block in place (C resets it; its old '+' chain
    // entries stay in the array but become unreachable)
    let name = args[1]
    const plus = name[0] === '+'
    if (plus) name = name.slice(1)
    const headKey = `${config.toLowerCase()}.${name.toLowerCase()}`
    const existing = heads.get(headKey)
    const d = newNativeDescriptor(config, name)
    if (plus && existing !== undefined) {
      let tail = existing
      while (effects[tail].assoc !== -1) tail = effects[tail].assoc
      effects[tail].assoc = effects.length
      effects.push(d)
    } else if (!plus && existing !== undefined) {
      effects[existing] = d
    } else {
      heads.set(headKey, effects.length)
      effects.push(d)
    }

    const ctx: NativeCtx = { d, setType: false, setAlphaDelta: false }
    let closed = false
    while (i < lines.length) {
      const line = lines[i]; i++
      const kargs = tokenizeLine(line)
      if (kargs.length === 0) continue
      if (kargs[0][0] === '}') { closed = true; break }
      if (kargs[0] === 'shader') {
        // unsupported; skip its optional nested brace block (1729-1776)
        warn(`${d.config}.${d.name}: shaders are not supported\n`)
        if (i < lines.length) {
          const peek = tokenizeLine(lines[i])
          if (peek.length > 0 && peek[0][0] === '{') {
            i++
            let nest = 1
            while (i < lines.length && nest > 0) {
              const t = lines[i].trim()
              if (t[0] === '}') nest--
              else if (t[0] === '{') nest++
              i++
            }
          }
        }
        continue
      }
      applyNativeKey(ctx, kargs, warn)
    }
    if (!closed) warn(`Unexpected end of buffer with effect ${d.name}\n`)
    // C skips the fixups on EOF (the type stays unloaded); we finish anyway so a
    // truncated file never leaves the alphaChange sentinel (+1 = fade-in) live
    finishNativeEffect(ctx, warn)
  }

  return { effects, warnings }
}

// Loads particles/<config>.cfg (falling back to <config>.cfg like P_LoadParticleSet
// 3821-3823) into the registry. Missing file is developer-noise only -- lookups of
// unknown namespaces are common (QSS-M warns once per session too).
const loadNativeConfig = async (config: string): Promise<void> => {
  const gen = state.loadGen
  let text = await com.loadTextFile(`particles/${config}.cfg`)
  if (text == null) text = await com.loadTextFile(`${config}.cfg`)
  if (gen !== state.loadGen) return  // map changed mid-fetch: stale result, discard
  if (text == null) {
    con.dPrint(`pscript: couldn't find particle description ${config}\n`)
    return
  }
  const { effects, warnings } = parseNativeConfigText(config, text)
  registerEffects(effects)
  for (const w of warnings) con.dPrint(w)
  con.print(`pscript: ${effects.length} particle types from particles/${config}.cfg\n`)
}

// Kicks off (or joins) the lazy load of one config namespace. Same async compromise as
// ensureEffectsLoaded: findParticleType fires this in the background and returns -1
// until it resolves; callers needing a guaranteed answer await this then re-resolve.
export const ensureConfigLoaded = (config: string): Promise<void> => {
  const key = config.toLowerCase()
  if (key === 'effectinfo') return ensureEffectsLoaded()
  let p = state.configPromises.get(key)
  if (!p) {
    p = loadNativeConfig(key)
    state.configPromises.set(key, p)
  }
  return p
}

// Builds the 256-entry UV table exactly like r_part_fte.c's teximages[] init (3031-3075):
// every entry defaults to the 8x8-grid formula (for i>=64 columns wrap via i&7 while rows
// keep growing via i>>3 past the texture — mods using those cells are expected to override
// them), then each `index s1 t1 s2 t2` line of particles/particlefont.txt replaces one
// entry. Exported for the standalone verification script; tolerant of a missing/garbled
// txt (any line that doesn't yield 5 finite numbers is skipped, like the C's if(line) check).
export const buildAtlasCells = (fontTxt: string | null): AtlasCell[] => {
  const cells: AtlasCell[] = []
  for (let i = 0; i < 256; i++) {
    const col = i & 7, row = i >> 3
    // t1/t2 intentionally swapped vs. row order (matches r_part_fte.c's default teximages[])
    cells.push({ s1: col / 8, s2: (col + 1) / 8, t1: (row + 1) / 8, t2: row / 8 })
  }
  if (fontTxt != null) {
    for (const line of fontTxt.split('\n')) {
      const args = tokenizeLine(line)
      if (args.length < 5) continue
      const i = parseInt(args[0], 10)
      const s1 = parseFloat(args[1]), t1 = parseFloat(args[2]), s2 = parseFloat(args[3]), t2 = parseFloat(args[4])
      if (!(i >= 0 && i < 256) || !isFinite(s1) || !isFinite(t1) || !isFinite(s2) || !isFinite(t2)) continue
      // QSS-M stores the file's t values swapped (teximages[2]=t2, [3]=t1) and reads
      // ptype->t1/t2 from slots [2]/[3] — so our t1 is the file's t2 and vice versa,
      // consistent with the default-formula rows above.
      cells[i] = { s1, s2, t1: t2, t2: t1 }
    }
  }
  return cells
}

// QSS-M P_LoadTexture's procedural fallback (soft radial gradient) for 'ball'/'glow'/
// spark texture names. Composited into padding rows below the font image so the
// single-atlas renderer addresses it as cell BALL_CELL.
const writeBall = (dst: Uint8Array, width: number, x0: number, y0: number) => {
  // exact QSS-M P_LoadTexture ball formula (r_part_fte.c ~1375): alpha = 256*(1 - r^2),
  // white rgb -- much fatter than a linear/squared falloff, which read as barely-visible rain
  for (let y = 0; y < BALL_SIZE; y++) {
    const dy = (y - 0.5 * BALL_SIZE) / (BALL_SIZE * 0.5 - 1)
    for (let x = 0; x < BALL_SIZE; x++) {
      const dx = (x - 0.5 * BALL_SIZE) / (BALL_SIZE * 0.5 - 1)
      let d = 256 * (1 - (dx * dx + dy * dy))
      if (d < 0) d = 0; else if (d > 255) d = 255
      const o = ((y0 + y) * width + x0 + x) * 4
      dst[o] = 255; dst[o + 1] = 255; dst[o + 2] = 255; dst[o + 3] = d | 0
    }
  }
}

// particles/particlefont.tga (the atlas image) + particles/particlefont.txt (optional
// custom cell layout, e.g. AD's — without it only the default 8x8 cells 0-63 are usable).
// The uploaded texture is the font plus a BALL_SIZE padding strip holding the procedural
// ball; the font cells' t coords are rescaled into the padded height.
export const loadParticleFont = async (): Promise<void> => {
  const gen = state.loadGen
  const [img, fontTxt] = await Promise.all([
    loadImage('particles/particlefont'),
    com.loadTextFile('particles/particlefont.txt'),
  ])
  if (gen !== state.loadGen) return  // map changed mid-fetch: stale result, discard
  state.atlasCells = buildAtlasCells(fontTxt ?? null)
  if (img == null)
    con.dPrint("particles/particlefont not found (procedural ball only)\n")

  const fw = img ? img.width : BALL_SIZE
  const fh = img ? img.height : 0
  const H = fh + BALL_SIZE
  const pixels = new Uint8Array(fw * H * 4)
  if (img) {
    const src = img.data as Uint8Array
    pixels.set(new Uint8Array(src.buffer, src.byteOffset, fw * fh * 4))
  }
  writeBall(pixels, fw, 0, fh)

  const tScale = fh / H
  for (const c of state.atlasCells) { c.t1 *= tScale; c.t2 *= tScale }
  // half-texel inset so linear filtering doesn't bleed the font's bottom row into the ball
  state.atlasCells[BALL_CELL] = {
    s1: 0.5 / fw, s2: (BALL_SIZE - 0.5) / fw,
    t1: (fh + 0.5) / H, t2: (fh + BALL_SIZE - 0.5) / H
  }

  const gl = GL.getContext()
  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fw, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.bindTexture(gl.TEXTURE_2D, null)

  if (state.atlasTexture) gl.deleteTexture(state.atlasTexture)
  state.atlasTexture = texture

  // WebGPU-only: retain the expanded RGBA + dims on the texture handle so the WebGPU backend can upload
  // its own GPUTexture (the WebGL context here is an offscreen resource factory in that mode). Keyed by
  // the rgba identity in the backend cache, so a font reload re-uploads. Harmless no-op under WebGL2.
  if (render.state.active != null && render.state.active.backend === 'webgpu') {
    (texture as any).rgba = pixels;
    (texture as any).rgbaW = fw;
    (texture as any).rgbaH = H;
  }
  state.fontLoaded = true
}

// Kicks off (or joins) a single combined load of both the effect registry and the atlas.
// QSS-M loads effectinfo.txt synchronously at particle-system init, so FindParticleType
// never races a load; com.loadFile is async here, so we can't match that exactly. The
// compromise: findParticleType() triggers this in the background and returns -1 until it
// resolves; a caller that needs a guaranteed answer (Phase C's precache handling, resolving
// server-sent effect names) should await ensureEffectsLoaded() once and then call
// findParticleType() again.
export const ensureEffectsLoaded = (): Promise<void> => {
  if (!state.loadPromise)
    state.loadPromise = Promise.all([loadEffects(), loadParticleFont()]).then(() => {})
  return state.loadPromise
}

// Namespace resolution per PScript_FindParticleType (1121-1210): '<cfg>.NAME' looks up
// within that config, triggering its lazy load on a miss (the C calls
// P_LoadParticleSet(cfg,...) synchronously and retries at 1205-1207; ours is async so
// the first lookup can return -1 -- callers await ensureConfigLoaded and re-resolve).
// A bare NAME resolves within effectinfo, as it has since Phase A (QSS-M's
// any-namespace bare scan is out of scope; effectinfo is our only wire-visible source).
// Note a name may contain further dots ('fte_weather.weather.rainsplash') -- only the
// FIRST dot splits the namespace, the rest is the effect name verbatim.
export const findParticleType = (name: string): number => {
  if (!state.loaded && !state.loadPromise) ensureEffectsLoaded()

  let cfg = 'effectinfo', bare = name
  const dot = name.indexOf('.')
  if (dot >= 0) {
    cfg = name.slice(0, dot).toLowerCase()
    bare = name.slice(dot + 1)
  }

  const idx = state.effectsByName.get(`${cfg}.${bare.toLowerCase()}`)
  if (idx !== undefined) return idx
  if (cfg !== 'effectinfo') ensureConfigLoaded(cfg)
  return -1
}

// Clears the registry and pending-load state; called on new server/map (effectinfo.txt and
// particlefont.txt can differ per mod dir). The current atlas texture/cells stay valid for
// any still-live particles; clearing loadPromise means the next lookup re-runs
// ensureEffectsLoaded, which reloads both the registry and the font (loadParticleFont
// replaces the texture and cell table in place).
export const reset = () => {
  state.loadGen++  // orphan any in-flight loads so stale resolves can't repopulate
  state.effects = []
  state.effectsByName.clear()
  state.loaded = false
  state.loadPromise = null
  state.configPromises.clear()
  state.spawnAccum = []
  state.skyTriCount = 0  // effect indices die with the registry; loadWorldWeather rebuilds
}

// ---------------------------------------------------------------------------------
// Phase B: simulation + instanced textured rendering.
// Architecture mirrors r.ts's classic particle system (initParticles/runParticles/
// drawParticles): a preallocated SoA pool with dense-active-prefix + swap-compaction
// on death, and a Float32Array/Uint8Array dual-view instance buffer streamed once per
// frame. Differences from the classic system: (1) three instance buffers, one per
// blend mode, since QSS-M's effectinfo dialect needs alpha/add/invmod batches instead
// of the classic system's single additive-only draw; (2) oldest-first recycling on
// pool overflow instead of dropping the spawn, per the Phase B budget-guard spec.
//
// Alpha/size ramps are integrated CPU-side in runPScriptParticles() (not in the
// shader): position integration already requires a per-particle loop every frame for
// gravity/friction/bounce, so folding two more scalar adds into that same pass is
// free, whereas a shader-side ramp would need 4 more per-instance attributes
// (spawn/die time, alpha/size delta) purely to duplicate work the CPU loop is doing
// anyway. This matches the classic system, which also resolves final color CPU-side.

// weather saturates 4096 easily (rain + splash churn ~2600/s); when the pool pegs,
// oldest-first recycling kills exactly the drops nearest the ground. QSS-M defaults
// r_part_maxparticles to 65536; 16384 keeps rain landing with 1/4 the buffer memory.
const DEFAULT_MAX_PARTICLES = 16384
export const INSTANCE_STRIDE = 56  // 13 floats (origin3+vel3+size+rotation+uv4+orientation) + rgba8

// exported for WebGLRenderer.drawScriptParticles (render phase1 particle/flashblend slice)
export const BLEND_ALPHA = 0, BLEND_ADD = 1, BLEND_INVMOD = 2

const blendModeIndex = (m: BlendMode): number =>
  m === 'add' ? BLEND_ADD : m === 'invmod' ? BLEND_INVMOD : BLEND_ALPHA

const clampByte = (v: number): number => v < 0 ? 0 : v > 255 ? 255 : v | 0

// Reserves a pool slot. Dense active particles live in [0, pNumActive); once the live
// cap is reached the single oldest (lowest spawn time) active particle is recycled in
// place rather than dropping the new spawn -- an O(live) scan, but only paid while the
// pool is actually saturated.
const allocPscriptParticle = (): number => {
  const cap = Math.min(state.pCapacity, Math.max(1, cvr.fteparticlesMax.value | 0))
  if (cap <= 0) return -1
  if (state.pNumActive < cap) return state.pNumActive++
  let oldest = 0, oldestTime = state.pSpawnTime[0]
  for (let i = 1; i < state.pNumActive; i++) {
    if (state.pSpawnTime[i] < oldestTime) { oldestTime = state.pSpawnTime[i]; oldest = i }
  }
  return oldest
}

// Moves all SoA fields of `src` into `dst` -- used only to compact the dense active
// prefix when a particle in the middle of the range dies (swap-with-last).
const copyParticleSlot = (src: number, dst: number) => {
  const s3 = src * 3, d3 = dst * 3
  state.pOrg[d3] = state.pOrg[s3]; state.pOrg[d3 + 1] = state.pOrg[s3 + 1]; state.pOrg[d3 + 2] = state.pOrg[s3 + 2]
  state.pVel[d3] = state.pVel[s3]; state.pVel[d3 + 1] = state.pVel[s3 + 1]; state.pVel[d3 + 2] = state.pVel[s3 + 2]
  state.pColor[d3] = state.pColor[s3]; state.pColor[d3 + 1] = state.pColor[s3 + 1]; state.pColor[d3 + 2] = state.pColor[s3 + 2]
  state.pSpawnTime[dst] = state.pSpawnTime[src]
  state.pDieTime[dst] = state.pDieTime[src]
  state.pSize[dst] = state.pSize[src]
  state.pSizeIncrease[dst] = state.pSizeIncrease[src]
  state.pAlpha[dst] = state.pAlpha[src]
  state.pAlphaChange[dst] = state.pAlphaChange[src]
  state.pAtlasCell[dst] = state.pAtlasCell[src]
  state.pBlendMode[dst] = state.pBlendMode[src]
  state.pOrientation[dst] = state.pOrientation[src]
  state.pRotation[dst] = state.pRotation[src]
  state.pRotationSpeed[dst] = state.pRotationSpeed[src]
  state.pGravity[dst] = state.pGravity[src]
  state.pBounce[dst] = state.pBounce[src]
  state.pAirFriction[dst] = state.pAirFriction[src]
  state.pStretch[dst] = state.pStretch[src]
  state.pMinStretch[dst] = state.pMinStretch[src]
  state.pFlurry[dst] = state.pFlurry[src]
  state.pClipMode[dst] = state.pClipMode[src]
  state.pClipIdx[dst] = state.pClipIdx[src]
  state.pClipBounce[dst] = state.pClipBounce[src]
  state.pClipSpawnCount[dst] = state.pClipSpawnCount[src]
  state.pOldOrg[d3] = state.pOldOrg[s3]; state.pOldOrg[d3 + 1] = state.pOldOrg[s3 + 1]; state.pOldOrg[d3 + 2] = state.pOldOrg[s3 + 2]
}

// Spawns one particle from a resolved descriptor. org/dir are passed as loose
// components (not a V3) so callers never need a per-particle scratch vector.
// originjitter/velocityjitter share a single rejection-sampled unit-ball random
// vector between origin and velocity, matching r_part_fte.c's PT_WORLDSPACERAND
// block (RunParticleEffectState ~5445); originoffset/velocityoffset are added
// unconditionally, and velocitymultiplier scales the caller's dir exactly like
// QSS-M's `veladd *= VectorLength(dir); vel += veladd*axis[2]` (axis[2]==normalize(dir)).
const spawnOneParticle = (d: EffectDescriptor, dIdx: number, ox: number, oy: number, oz: number, dirx: number, diry: number, dirz: number) => {
  if (d.renderType === 'cdecal') return  // surface-clipped decals out of scope this phase
  const idx = allocPscriptParticle()
  if (idx < 0) return
  if (d.clipIdx === -2) resolveClipType(d)

  let rx: number, ry: number, rz: number
  do { rx = Math.random() * 2 - 1; ry = Math.random() * 2 - 1; rz = Math.random() * 2 - 1 }
  while (rx * rx + ry * ry + rz * rz > 1)

  const o3 = idx * 3
  state.pOrg[o3] = ox + rx * d.originJitter[0] + d.originOffset[0]
  state.pOrg[o3 + 1] = oy + ry * d.originJitter[1] + d.originOffset[1]
  state.pOrg[o3 + 2] = oz + rz * d.originJitter[2] + d.originOffset[2]
  state.pVel[o3] = dirx * d.velocityMultiplier + rx * d.velocityJitter[0] + d.velocityOffset[0]
  state.pVel[o3 + 1] = diry * d.velocityMultiplier + ry * d.velocityJitter[1] + d.velocityOffset[1]
  state.pVel[o3 + 2] = dirz * d.velocityMultiplier + rz * d.velocityJitter[2] + d.velocityOffset[2]

  const now = cl.clState.time
  const life = d.dieMin + Math.random() * (d.dieMax - d.dieMin)
  state.pSpawnTime[idx] = now
  state.pDieTime[idx] = now + life

  state.pSize[idx] = d.sizeStart + Math.random() * d.sizeRand
  state.pSizeIncrease[idx] = d.sizeIncrease
  // die-time-randomized particles spawn as if already (dieMax-life) seconds into their
  // fade (r_part_fte.c ~5198-5205: rgba[3] = alpha + dietemp*alphachange), keeping a
  // burst's fade-outs synchronized; no-op when dieMin==dieMax (the common case).
  state.pAlpha[idx] = d.alphaStart + Math.random() * d.alphaRand
    + (d.dieMax > 0 ? (d.dieMax - life) * d.alphaChange : 0)
  state.pAlphaChange[idx] = d.alphaChange

  // DP's effectinfo color import sets rgbrandsync=1 for all channels, i.e. one shared
  // random fraction lerps r/g/b together rather than three independent rolls.
  const lerpT = Math.random()
  state.pColor[o3] = d.color1[0] + (d.color2[0] - d.color1[0]) * lerpT
  state.pColor[o3 + 1] = d.color1[1] + (d.color2[1] - d.color1[1]) * lerpT
  state.pColor[o3 + 2] = d.color1[2] + (d.color2[2] - d.color1[2]) * lerpT

  // clamp into the cell table (0-255 font cells + BALL_CELL) so a bad `tex` range can't wrap
  const cellIdx = d.texFirst + Math.floor(Math.random() * d.texCount)
  state.pAtlasCell[idx] = cellIdx < 0 ? 0 : cellIdx > BALL_CELL ? BALL_CELL : cellIdx
  state.pBlendMode[idx] = blendModeIndex(d.blendMode)
  state.pOrientation[idx] = (d.renderType === 'spark' || d.renderType === 'beam') ? 1
    : d.renderType === 'udecal' ? 2 : 0

  state.pRotation[idx] = d.rotationStartMin + Math.random() * d.rotationStartRand
  state.pRotationSpeed[idx] = d.rotationMin + Math.random() * d.rotationRand

  state.pGravity[idx] = d.gravity
  state.pBounce[idx] = d.bounce
  state.pAirFriction[idx] = d.airFriction
  state.pStretch[idx] = d.stretchFactor  // finish passes applied the per-type net factor; <0 = fixed length
  state.pMinStretch[idx] = d.minStretch
  state.pFlurry[idx] = d.flurry

  // clip behavior precomputed to a mode byte so the sim loop never compares
  // strings/identities: C 7515-7611 -- clipbounce<0 dies on impact, cliptype==self
  // bounces by clipbounce, any other resolved cliptype dies + spawns it there.
  state.pClipMode[idx] = d.clipIdx < 0 ? 0
    : d.clipBounce < 0 ? 1
    : d.clipIdx === dIdx ? 2 : 3
  state.pClipIdx[idx] = d.clipIdx
  state.pClipBounce[idx] = d.clipBounce
  state.pClipSpawnCount[idx] = d.clipSpawnCount
  state.pOldOrg[o3] = state.pOrg[o3]
  state.pOldOrg[o3 + 1] = state.pOrg[o3 + 1]
  state.pOldOrg[o3 + 2] = state.pOrg[o3 + 2]
}

// Resolves d.clipType within its own config ('weather.rainsplash' inside fte_weather is
// the literal block name -- findParticleType splits only at the FIRST dot) and bakes the
// C's clipcount/part_type[cliptype].count division (7606). Cached per descriptor; runs
// once, cold.
const resolveClipType = (d: EffectDescriptor) => {
  if (d.clipType === '') { d.clipIdx = -1; return }
  d.clipIdx = findParticleType(`${d.config}.${d.clipType}`)
  if (d.clipIdx >= 0) {
    const c = state.effects[d.clipIdx].count
    d.clipSpawnCount = d.clipCount / (c > 0 ? c : 1)
  }
}

// DP_SV_POINTPARTICLES / FTE_SV_POINTPARTICLES equivalent: walks the assoc chain,
// spawning count*descriptor.count + descriptor.countabsolute particles per link with
// fractional-count carry per descriptor (so e.g. count 0.3 called every frame averages
// out instead of always rounding to 0 or always to 1).
export const runParticleEffect = (typenum: number, org: Vec3, dir: Vec3, count: number) => {
  if (cvr.fteparticles.value === 0) return
  if (typenum < 0 || typenum >= state.effects.length) return
  let idx = typenum
  while (idx !== -1) {
    const d = state.effects[idx]
    state.spawnAccum[idx] = (state.spawnAccum[idx] || 0) + (count * d.count + d.countAbsolute)
    const n = Math.floor(state.spawnAccum[idx])
    if (n > 0) {
      state.spawnAccum[idx] -= n
      for (let i = 0; i < n; i++) spawnOneParticle(d, idx, org[0], org[1], org[2], dir[0], dir[1], dir[2])
    }
    idx = d.assoc
  }
}

// DP_SV_TRAILPARTICLES equivalent (Phase C wires the network side). Straight-line
// spacing with per-particle jitter -- QSS-M's real trailstate emit-time carry across
// calls isn't reproduced, matching the plan's "straight-line spacing... is enough".
export const runTrailEffect = (typenum: number, start: Vec3, end: Vec3) => {
  if (cvr.fteparticles.value === 0) return
  if (typenum < 0 || typenum >= state.effects.length) return
  const dx = end[0] - start[0], dy = end[1] - start[1], dz = end[2] - start[2]
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
  const dirx = len > 0 ? dx / len : 0, diry = len > 0 ? dy / len : 0, dirz = len > 0 ? dz / len : 1
  let idx = typenum
  while (idx !== -1) {
    const d = state.effects[idx]
    const spacing = d.trailSpacing > 0 ? d.trailSpacing : (len > 0 ? len : 1)
    const n = Math.max(1, Math.floor(len / spacing))
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n
      spawnOneParticle(d, idx, start[0] + dx * t, start[1] + dy * t, start[2] + dz * t, dirx, diry, dirz)
    }
    idx = d.assoc
  }
}

// DP_TE_PARTICLERAIN/SNOW: spawn `count` particles of te_<efname>_<colour> (fallback
// te_<efname>, with the palette colour baked into the descriptor -- QSS-M's
// PScript_RunParticleWeather ~5824 mutates the type's colorindex just as persistently)
// at random points in the min/max box. Each spawn passes 1/descriptor.count so every
// box point yields exactly one particle regardless of the effect's own count.
export const runParticleWeather = (minb: Vec3, maxb: Vec3, dir: Vec3, count: number, colour: number, efname: string) => {
  if (cvr.fteparticles.value === 0) return
  let typenum = findParticleTypeAnyConfig(`te_${efname}_${colour}`)
  if (typenum < 0) {
    typenum = findParticleTypeAnyConfig(`te_${efname}`)
    if (typenum < 0) {
      // te_rain/te_snow live in fte_weather.cfg; kick its load and drop this message
      // (rain/snow TEs repeat continuously, so the next one lands after the parse).
      ensureConfigLoaded('fte_weather')
      return
    }
    const rgba = vid.d_8to24table[colour & 0xff]
    const d = state.effects[typenum]
    d.color1[0] = d.color2[0] = (rgba & 0xff) / 255
    d.color1[1] = d.color2[1] = ((rgba >> 8) & 0xff) / 255
    d.color1[2] = d.color2[2] = ((rgba >> 16) & 0xff) / 255
  }
  const d = state.effects[typenum]
  const per = d.count > 0 ? d.count : 1
  const total = count * per
  const inv = 1 / per
  const org = vec.scratch()
  // QSS-M bails when free_particles runs dry (r_part_fte.c ~5847); our pool recycles
  // instead of freeing, so the equivalent budget is saturation -- without this a wire
  // count near 65535 x per drives millions of synchronous spawns (frame-stall DoS).
  const cap = Math.min(state.pCapacity, Math.max(1, cvr.fteparticlesMax.value | 0))
  for (let i = 0; i < total; i++) {
    if (state.pNumActive >= cap)
      return
    org[0] = minb[0] + Math.random() * (maxb[0] - minb[0])
    org[1] = minb[1] + Math.random() * (maxb[1] - minb[1])
    org[2] = minb[2] + Math.random() * (maxb[2] - minb[2])
    runParticleEffect(typenum, org as unknown as Vec3, dir, inv)
  }
}

// QSS-M's bare-name lookup scans every loaded config in registration order
// (PScript_FindParticleType); only the weather loader's implicit tex_<name> path needs
// that (cold), so it lives here instead of widening findParticleType's wire-visible
// bare-name==effectinfo rule. Registry keys are '<config>.<name>' where <name> itself
// may contain dots, hence the first-dot split.
const findParticleTypeAnyConfig = (bare: string): number => {
  for (const [key, idx] of state.effectsByName) {
    if (key.slice(key.indexOf('.') + 1) === bare) return idx
  }
  return -1
}

// Builds the skytris emission table for the current worldmodel: worldspawn
// `_texpart_TEX effectname` keys plus an implicit `tex_<texturename>` effect lookup per
// world texture, then a triangle fan (with QSS-M's parallelogram-area convention) for
// every world surface using a matched texture. Port of PScript_RecalculateSkyTris
// (3647-3728) + R_Part_SkyTri/PScript_EmitSkyEffectTris (3979-4073), restricted to the
// worldmodel per the plan's scope guard (QSS-M walks every brush model). Texture names
// match exactly (case-insensitive), as in the C -- a key naming a texture the map
// doesn't have is a silent no-op there too. Async (config loads); guarded against map
// changes racing the awaits. Called from r.newMap. Cold path.
export const loadWorldWeather = async (): Promise<void> => {
  const gen = ++state.weatherGen
  state.skyTriCount = 0
  state.skyTime = 0
  state.flurryTime = 0
  const model = cl.clState.worldmodel
  if (model == null) return

  // worldspawn _texpart_* keys (leading '_' stripped like the C's key normalization)
  const explicit = new Map<string, string>()  // lower texture name -> effect name
  let data = com.parse(model.entities)
  if (data && com.state.token[0] === '{') {
    while (true) {
      data = com.parse(data)
      if (!data) break
      // @ts-ignore - com.parse mutates com.state.token
      if (com.state.token[0] === '}') break
      let key: string = com.state.token
      if (key[0] === '_') key = key.substring(1)
      key = key.trim()
      data = com.parse(data)
      if (!data) break
      if (key.toLowerCase().indexOf('texpart_') === 0)
        explicit.set(key.substring(8).toLowerCase(), com.state.token)
    }
  }

  await ensureEffectsLoaded()
  for (const name of explicit.values()) {
    const dot = name.indexOf('.')
    if (dot > 0) await ensureConfigLoaded(name.slice(0, dot))
  }
  if (gen !== state.weatherGen || cl.clState.worldmodel !== model) return

  // per-texture effect: explicit key first, else implicit tex_<name> across every
  // config loaded so far (the implicit path can't trigger a config load -- QSS-M's
  // bare lookup is also restricted to already-loaded sets)
  const texEffect: number[] = []
  let any = false
  for (let t = 0; t < model.textures.length; t++) {
    const tex = model.textures[t]
    let eff = -1
    if (tex) {
      const explicitName = explicit.get(tex.name.toLowerCase())
      if (explicitName !== undefined) eff = findParticleType(explicitName)
      else eff = findParticleTypeAnyConfig(`tex_${tex.name.toLowerCase()}`)
    }
    texEffect[t] = eff
    if (eff >= 0) any = true
  }
  if (!any) return

  // world-only faces: the face lump orders the world's own surfaces first; submodel
  // *1's firstface marks their end (QSS-M's nummodelsurfaces equivalent)
  const numWorldFaces = model.submodels.length > 0 ? model.submodels[0].firstface : model.numfaces
  const org: number[] = [], ex: number[] = [], ey: number[] = [], nrm: number[] = [], area: number[] = [], eff: number[] = []
  const verts: number[][] = []
  for (let fi = 0; fi < numWorldFaces; fi++) {
    const face = model.faces[fi]
    const effIdx = texEffect[face.texture]
    if (effIdx === undefined || effIdx < 0) continue

    verts.length = 0
    for (let k = 0; k < face.numedges; k++) {
      verts.push(mod.surfedgeVertexInto(model, model.surfedges[face.firstedge + k], [0, 0, 0]))
    }

    // SURF_PLANEBACK flip: rain surfaces face DOWN into the world
    const ns = face.side !== 0 ? -1 : 1
    const nx = face.plane.normal[0] * ns, ny = face.plane.normal[1] * ns, nz = face.plane.normal[2] * ns

    for (let v3 = 2; v3 < verts.length; v3++) {
      const a = verts[0], b = verts[v3 - 1], c = verts[v3]
      const x0 = b[0] - a[0], x1 = b[1] - a[1], x2 = b[2] - a[2]
      const y0 = c[0] - a[0], y1 = c[1] - a[1], y2 = c[2] - a[2]
      const xm = Math.sqrt(x0 * x0 + x1 * x1 + x2 * x2)
      const ym = Math.sqrt(y0 * y0 + y1 * y1 + y2 * y2)
      // parallelogram area, exactly like R_Part_SkyTri (the rate math is tuned to it)
      const triArea = Math.sin(Math.acos((x0 * y0 + x1 * y1 + x2 * y2) / (xm * ym))) * xm * ym
      if (!(triArea > 0)) continue
      org.push(a[0], a[1], a[2])
      ex.push(x0, x1, x2)
      ey.push(y0, y1, y2)
      nrm.push(nx, ny, nz)
      area.push(triArea)
      eff.push(effIdx)
    }
  }

  state.skyTriCount = area.length
  state.skyTriOrg = new Float32Array(org)
  state.skyTriX = new Float32Array(ex)
  state.skyTriY = new Float32Array(ey)
  state.skyTriNormal = new Float32Array(nrm)
  state.skyTriArea = new Float32Array(area)
  state.skyTriNext = new Float64Array(area.length)  // all 0 == skyTime, emission starts now
  state.skyTriEffect = new Int32Array(eff)
  if (state.skyTriCount > 0)
    con.dPrint(`pscript: ${state.skyTriCount} weather emitter tris\n`)
}

// Per-frame surface emission (P_AddRainParticles 3907-3977): every skytris accrues
// emissions at area*r_part_rain_quantity*rainfrequency/10000 per second on the shared
// skyTime axis; each emission picks a random point on the triangle, culls by a
// randomized 1024+512 view distance and by solid contents, then spawns the effect with
// the surface normal as dir. QSS-M's additional PVS cull (scenevis) is skipped -- it
// passes scenevis=NULL in the same spirit when there's no viewleaf -- distance is the
// budget that matters. ZERO allocations: two scratch vectors reused for every emission.
const runWeatherEmission = (frametime: number) => {
  if (state.skyTriCount === 0 || frametime <= 0) return
  if (cvr.partRain.value === 0) return
  const quantity = cvr.partRainQuantity.value
  if (quantity <= 0) return
  const worldmodel = cl.clState.worldmodel
  if (worldmodel == null) return

  state.skyTime += frametime

  // hard per-frame budget (QSS-M stops when free_particles runs dry); exhausted budget
  // still burns each tri's timer so no emission debt accumulates
  let budget = Math.min(state.pCapacity, Math.max(1, cvr.fteparticlesMax.value | 0))

  const org = vec.scratch()
  const dir = vec.scratch()
  const view = r.state.refdef.vieworg

  for (let t = 0; t < state.skyTriCount; t++) {
    const effIdx = state.skyTriEffect[t]
    if (effIdx < 0 || effIdx >= state.effects.length) continue
    const d = state.effects[effIdx]
    const t3 = t * 3
    const step = 10000.0 / (state.skyTriArea[t] * quantity * d.rainFrequency)
    if (!(step > 0)) continue  // rainfrequency <= 0 must not spin the timer loop

    while (state.skyTriNext[t] < state.skyTime) {
      state.skyTriNext[t] += step
      if (--budget < 0) continue

      // biased-random point on the triangle (frandom()*frandom() weighting, as in the C)
      const x = Math.random() * Math.random()
      const y = Math.random() * (1 - x)
      org[0] = state.skyTriOrg[t3] + x * state.skyTriX[t3] + y * state.skyTriY[t3] + 0.5 * state.skyTriNormal[t3]
      org[1] = state.skyTriOrg[t3 + 1] + x * state.skyTriX[t3 + 1] + y * state.skyTriY[t3 + 1] + 0.5 * state.skyTriNormal[t3 + 1]
      org[2] = state.skyTriOrg[t3 + 2] + x * state.skyTriX[t3 + 2] + y * state.skyTriY[t3 + 2] + 0.5 * state.skyTriNormal[t3 + 2]

      const dx = org[0] - view[0], dy = org[1] - view[1], dz = org[2] - view[2]
      const maxDist = (1024 + 512) * Math.random()
      if (dx * dx + dy * dy + dz * dz > maxDist * maxDist) continue

      if (worldmodel.leafContents[mod.pointInLeaf(org, worldmodel)] === mod.CONTENTS.solid) continue

      dir[0] = state.skyTriNormal[t3]
      dir[1] = state.skyTriNormal[t3 + 1]
      dir[2] = state.skyTriNormal[t3 + 2]
      runParticleEffect(effIdx, org, dir, 1)
    }
  }
}

// Per-frame integration: gravity, airfriction, life/size/alpha ramps, and a
// world-hull bounce for particles whose descriptor requested one. Position/velocity
// math is copied from r_part_fte.c's particle run loop (~7381-7436): org integrates
// from the OLD velocity, then gravity subtracts from vel.z, then airfriction applies
// as a linear per-frame decay (vel *= 1-airfriction*dt) -- not exponential/pow, that
// is genuinely QSS-M's exact formula, applied isotropically since effectinfo's single
// 'airfriction' key sets all three friction axes equal.
//
// Bounce: QSS-M only performs a real per-frame trace when a *separate* 'cliptype' key
// is set (rare, FTE-native-only in practice -- DP's own 'bounce' key alone leaves
// cliptype unset and the whole trace block dead), so there's no single literal formula
// to "copy" for the common positive-bounce case. Here bounce!=0 always traces against
// the client-loaded worldmodel's point hull (same sv.recursiveHullCheck used by
// chase.ts's camera trace -- no server needed, it's a pure BSP hull walk): bounce<0
// kills the particle on impact (mirrors QSS-M's stick/decal sentinel), bounce>0
// reflects velocity by that factor along the impact plane's normal (QSS-M's
// self-bounce branch: dist = dot(vel,normal)*-bounce; vel += dist*normal).
export const runPScriptParticles = () => {
  if (cvr.fteparticles.value === 0) return
  if (state.pCapacity === 0) return
  let frametime = cl.clState.time - cl.clState.oldtime
  if (frametime < 0) frametime = 0
  if (frametime > 1) frametime = 1  // QSS-M clamps pframetime to [0,1] (7871-7875)

  runWeatherEmission(frametime)

  if (state.pNumActive === 0 || frametime <= 0) return

  const worldmodel = cl.clState.worldmodel
  const hull = worldmodel ? worldmodel.hulls[0] : null

  // flurry kicks fire in shared random 0.1-0.4s intervals, hitting every flurry
  // particle the same frame (7036-7043)
  let doflurry = false
  state.flurryTime -= frametime
  if (state.flurryTime < 0) {
    doflurry = true
    state.flurryTime = 0.1 + Math.random() * 0.3
  }

  let i = 0
  while (i < state.pNumActive) {
    if (state.pDieTime[i] < cl.clState.time) {
      const last = --state.pNumActive
      if (i !== last) copyParticleSlot(last, i)
      continue
    }

    const o3 = i * 3
    const oldX = state.pOrg[o3], oldY = state.pOrg[o3 + 1], oldZ = state.pOrg[o3 + 2]
    let newX = oldX + state.pVel[o3] * frametime
    let newY = oldY + state.pVel[o3 + 1] * frametime
    let newZ = oldZ + state.pVel[o3 + 2] * frametime

    let vx = state.pVel[o3], vy = state.pVel[o3 + 1], vz = state.pVel[o3 + 2]
    vz -= state.pGravity[i] * frametime
    const fric = 1 - state.pAirFriction[i] * frametime
    vx *= fric; vy *= fric; vz *= fric

    if (doflurry && state.pFlurry[i] !== 0) {
      vx += (Math.random() * 2 - 1) * state.pFlurry[i]
      vy += (Math.random() * 2 - 1) * state.pFlurry[i]
    }

    if (state.pBounce[i] !== 0 && hull != null) {
      const start = state.traceStart; start[0] = oldX; start[1] = oldY; start[2] = oldZ
      const end = state.traceEnd; end[0] = newX; end[1] = newY; end[2] = newZ
      const trace = state.bounceTrace
      sv.resetTrace(trace, end)
      sv.recursiveHullCheck(hull, 0, 0.0, 1.0, start, end, trace)
      if (trace.fraction < 1) {
        newX = trace.endpos[0]; newY = trace.endpos[1]; newZ = trace.endpos[2]
        if (state.pBounce[i] < 0) {
          state.pDieTime[i] = cl.clState.time - 1  // expires next pass; still drawn this frame at the impact point
        } else {
          const n0 = trace.plane.normal[0], n1 = trace.plane.normal[1], n2 = trace.plane.normal[2]
          const dist = (vx * n0 + vy * n1 + vz * n2) * -state.pBounce[i]
          vx += dist * n0; vy += dist * n1; vz += dist * n2
        }
      }
    } else if (state.pClipMode[i] !== 0 && hull != null) {
      // cliptype impact handling (C 7515-7614). Traces are throttled: with a nonzero
      // clipbounce, movement accumulates from pOldOrg (last traced position) until it
      // exceeds 10 units, then ONE trace covers the whole accumulated segment; with
      // clipbounce 0 (settling snow) it traces every frame.
      const mx = newX - state.pOldOrg[o3], my = newY - state.pOldOrg[o3 + 1], mz = newZ - state.pOldOrg[o3 + 2]
      if (state.pClipBounce[i] === 0 || mx * mx + my * my + mz * mz > 100) {
        const start = state.traceStart; start[0] = state.pOldOrg[o3]; start[1] = state.pOldOrg[o3 + 1]; start[2] = state.pOldOrg[o3 + 2]
        const end = state.traceEnd; end[0] = newX; end[1] = newY; end[2] = newZ
        const trace = state.bounceTrace
        sv.resetTrace(trace, end)
        sv.recursiveHullCheck(hull, 0, 0.0, 1.0, start, end, trace)
        if (trace.fraction < 1) {
          const ex = trace.endpos[0], ey = trace.endpos[1], ez = trace.endpos[2]
          const n0 = trace.plane.normal[0], n1 = trace.plane.normal[1], n2 = trace.plane.normal[2]
          if (state.pClipMode[i] === 2) {
            // self-bounce: land at the impact point, reflect velocity by clipbounce
            // (clipbounce 0 = velocity kept, particle pinned at the surface = settling)
            newX = ex; newY = ey; newZ = ez
            const dist = (vx * n0 + vy * n1 + vz * n2) * -state.pClipBounce[i]
            vx += dist * n0; vy += dist * n1; vz += dist * n2
            state.pOldOrg[o3] = newX; state.pOldOrg[o3 + 1] = newY; state.pOldOrg[o3 + 2] = newZ
          } else {
            // mode 1 (clipbounce<0) or 3 (foreign cliptype): the particle dies at the
            // impact; mode 3 spawns the cliptype effect there with dir = normal*clipbounce
            // (or normalized velocity when clipbounce is 0), count = clipcount scaled by
            // the target's own count. Compact FIRST so the spawn reuses the freed slot
            // instead of recycling a live one; `continue` reprocesses slot i from scratch.
            const clipIdx = state.pClipIdx[i], clipMode = state.pClipMode[i]
            const cb = state.pClipBounce[i], spawnCount = state.pClipSpawnCount[i]
            const last = --state.pNumActive
            if (i !== last) copyParticleSlot(last, i)
            if (clipMode === 3) {
              const sOrg = state.clipOrg; sOrg[0] = ex; sOrg[1] = ey; sOrg[2] = ez
              const sDir = state.clipDir
              if (cb !== 0) {
                sDir[0] = n0 * cb; sDir[1] = n1 * cb; sDir[2] = n2 * cb
              } else {
                const vl = Math.sqrt(vx * vx + vy * vy + vz * vz)
                const inv = vl > 0.000001 ? 1 / vl : 0
                sDir[0] = vx * inv; sDir[1] = vy * inv; sDir[2] = vz * inv
              }
              runParticleEffect(clipIdx, sOrg, sDir, spawnCount)
            }
            continue
          }
        } else {
          state.pOldOrg[o3] = newX; state.pOldOrg[o3 + 1] = newY; state.pOldOrg[o3 + 2] = newZ
        }
      }
    }

    state.pOrg[o3] = newX; state.pOrg[o3 + 1] = newY; state.pOrg[o3 + 2] = newZ
    state.pVel[o3] = vx; state.pVel[o3 + 1] = vy; state.pVel[o3 + 2] = vz

    state.pSize[i] += state.pSizeIncrease[i] * frametime
    state.pAlpha[i] += state.pAlphaChange[i] * frametime
    state.pRotation[i] += state.pRotationSpeed[i] * frametime

    ++i
  }
}

// Clears the live pool -- call on map change (r.newMap) so effects from the previous
// level don't survive into the next one.
export const clearPScriptParticles = () => { state.pNumActive = 0 }

// Fills each blend bucket's instance buffer from the pool. Called once per frame by the backend's
// drawScriptParticles (render phase1 particle/flashblend slice); this is CPU instance-packing and stays
// single-sourced here — exported for the backend that now issues the draws.
export const fillInstanceBuffers = () => {
  state.instanceCounts[0] = 0; state.instanceCounts[1] = 0; state.instanceCounts[2] = 0
  for (let i = 0; i < state.pNumActive; i++) {
    const bucket = state.pBlendMode[i]
    const w = state.instanceCounts[bucket]++
    const floats = state.instanceFloats[bucket]
    const bytes = state.instanceBytes[bucket]
    const fBase = w * 14, bBase = w * INSTANCE_STRIDE
    const o3 = i * 3

    floats[fBase] = state.pOrg[o3]; floats[fBase + 1] = state.pOrg[o3 + 1]; floats[fBase + 2] = state.pOrg[o3 + 2]

    if (state.pOrientation[i] === 1) {
      // Spark/beam: pack velocity direction*length (clamped) into the "velocity" slot
      // so the vertex shader can use it directly as the quad's stretch vector, with no
      // extra attribute needed for length/stretchfactor. Matches r_part_fte.c's
      // R_AddTSparkParticle (6580-6595): positive stretch = velocity multiplier,
      // NEGATIVE stretch = fixed streak length in world units (weather rain, -40);
      // either way floor-clamped to halfscale*minstretch = size*0.5*minStretch.
      const vx = state.pVel[o3], vy = state.pVel[o3 + 1], vz = state.pVel[o3 + 2]
      const velLen = Math.sqrt(vx * vx + vy * vy + vz * vz)
      const size = state.pSize[i] > 0 ? state.pSize[i] : 0
      let length = state.pStretch[i] < 0 ? -state.pStretch[i] : velLen * state.pStretch[i]
      const minLen = size * 0.5 * state.pMinStretch[i]
      if (length < minLen) length = minLen
      if (velLen > 0.000001) {
        const inv = length / velLen
        floats[fBase + 3] = vx * inv; floats[fBase + 4] = vy * inv; floats[fBase + 5] = vz * inv
      } else {
        floats[fBase + 3] = 0; floats[fBase + 4] = 0; floats[fBase + 5] = length
      }
    } else if (state.pOrientation[i] === 2) {
      // Oriented (`orientation oriented`, PT_UDECAL): the velocity slot carries the quad's
      // unit plane normal. QSS-M's R_AddUnclippedDecal hardcodes world-up (its velocity-
      // based orientation is commented out upstream); normalizing the velocity generalizes
      // that and degrades to the same world-up for the common `velocityoffset 0 0 1` idiom.
      const vx = state.pVel[o3], vy = state.pVel[o3 + 1], vz = state.pVel[o3 + 2]
      const velLen = Math.sqrt(vx * vx + vy * vy + vz * vz)
      if (velLen > 0.001) {
        const inv = 1 / velLen
        floats[fBase + 3] = vx * inv; floats[fBase + 4] = vy * inv; floats[fBase + 5] = vz * inv
      } else {
        floats[fBase + 3] = 0; floats[fBase + 4] = 0; floats[fBase + 5] = 1
      }
    } else {
      floats[fBase + 3] = 0; floats[fBase + 4] = 0; floats[fBase + 5] = 0
    }

    floats[fBase + 6] = state.pSize[i] > 0 ? state.pSize[i] : 0
    floats[fBase + 7] = state.pRotation[i]
    const cell = state.atlasCells[state.pAtlasCell[i]]
    if (cell) { floats[fBase + 8] = cell.s1; floats[fBase + 9] = cell.t1; floats[fBase + 10] = cell.s2; floats[fBase + 11] = cell.t2 }
    floats[fBase + 12] = state.pOrientation[i]

    // invmod darkening (ZERO, ONE_MINUS_SRC_COLOR) reads only src.rgb, so the fade must
    // be folded into rgb (QSS-M premul=2 does the same) or dying decals pop instead of easing.
    const cmul = bucket === 2 ? state.pAlpha[i] : 1
    bytes[bBase + 52] = clampByte(state.pColor[o3] * cmul * 255)
    bytes[bBase + 53] = clampByte(state.pColor[o3 + 1] * cmul * 255)
    bytes[bBase + 54] = clampByte(state.pColor[o3 + 2] * cmul * 255)
    bytes[bBase + 55] = clampByte(state.pAlpha[i] * 255)
  }
}

// drawBucket (per-bucket instanced draw) and drawPScriptParticles (the 3 blend-bucket submission +
// app-wide blendFunc restore) bodies moved to WebGLRenderer.drawScriptParticles (render phase1
// particle/flashblend slice). renderScene calls it through getRenderer(); the CPU instance-packing
// (fillInstanceBuffers, above) and sim (runPScriptParticles) stay here, and INSTANCE_STRIDE / the
// BLEND_* bucket ids are exported for the backend.

// Dev command: `pointparticles <effectname> [count]`, spawned ~128 units in front of
// the view along the aim direction. Lets scripted effects be tested without QC/network
// wiring (Phase C). Awaits ensureEffectsLoaded() first since findParticleType()
// otherwise returns -1 until the background load resolves (see its comment).
const pointParticles_f = async () => {
  if (cmd.state.argv.length < 2) { con.print('usage: pointparticles <effectname> [count]\n'); return }
  await ensureEffectsLoaded()
  const name = cmd.state.argv[1]
  const nameDot = name.indexOf('.')
  if (nameDot > 0) await ensureConfigLoaded(name.slice(0, nameDot))  // namespaced effect: load its cfg first
  const idx = findParticleType(name)
  if (idx < 0) { con.print(`pointparticles: unknown effect '${name}'\n`); return }
  const count = cmd.state.argv.length >= 3 ? q.atoi(cmd.state.argv[2]) : 1

  const forward = vec.scratch()
  vec.angleVectors(r.state.refdef.viewangles, forward)
  const org = vec.scratch()
  org[0] = r.state.refdef.vieworg[0] + forward[0] * 128
  org[1] = r.state.refdef.vieworg[1] + forward[1] * 128
  org[2] = r.state.refdef.vieworg[2] + forward[2] * 128
  runParticleEffect(idx, org, forward, count)
}

// Allocates the particle pool + GL buffers and registers cvars/the dev command.
// Called once from r.ts's init() (GL program creation itself lives there, alongside
// the other GL.createProgram calls).
export const init = () => {
  const gl = GL.getContext()

  cvr.fteparticles = cvar.registerVariable('r_fteparticles', '1')
  cvr.fteparticlesMax = cvar.registerVariable('r_fteparticles_max', String(DEFAULT_MAX_PARTICLES))
  cvr.partRain = cvar.registerVariable('r_part_rain', '1')
  cvr.partRainQuantity = cvar.registerVariable('r_part_rain_quantity', '1')

  state.pCapacity = DEFAULT_MAX_PARTICLES
  state.pNumActive = 0
  state.pOrg = new Float32Array(state.pCapacity * 3)
  state.pVel = new Float32Array(state.pCapacity * 3)
  state.pColor = new Float32Array(state.pCapacity * 3)
  state.pSpawnTime = new Float32Array(state.pCapacity)
  state.pDieTime = new Float32Array(state.pCapacity)
  state.pSize = new Float32Array(state.pCapacity)
  state.pSizeIncrease = new Float32Array(state.pCapacity)
  state.pAlpha = new Float32Array(state.pCapacity)
  state.pAlphaChange = new Float32Array(state.pCapacity)
  state.pAtlasCell = new Uint16Array(state.pCapacity)
  state.pBlendMode = new Uint8Array(state.pCapacity)
  state.pOrientation = new Uint8Array(state.pCapacity)
  state.pRotation = new Float32Array(state.pCapacity)
  state.pRotationSpeed = new Float32Array(state.pCapacity)
  state.pGravity = new Float32Array(state.pCapacity)
  state.pBounce = new Float32Array(state.pCapacity)
  state.pAirFriction = new Float32Array(state.pCapacity)
  state.pStretch = new Float32Array(state.pCapacity)
  state.pMinStretch = new Float32Array(state.pCapacity)
  state.pFlurry = new Float32Array(state.pCapacity)
  state.pClipMode = new Uint8Array(state.pCapacity)
  state.pClipIdx = new Int32Array(state.pCapacity)
  state.pClipBounce = new Float32Array(state.pCapacity)
  state.pClipSpawnCount = new Float32Array(state.pCapacity)
  state.pOldOrg = new Float32Array(state.pCapacity * 3)

  for (let b = 0; b < 3; b++) {
    state.instanceData[b] = new ArrayBuffer(state.pCapacity * INSTANCE_STRIDE)
    state.instanceFloats[b] = new Float32Array(state.instanceData[b])
    state.instanceBytes[b] = new Uint8Array(state.instanceData[b])
    state.instanceBuffers[b] = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, state.instanceBuffers[b])
    gl.bufferData(gl.ARRAY_BUFFER, state.instanceData[b].byteLength, gl.DYNAMIC_DRAW)
  }

  state.cornerBuffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, state.cornerBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)

  cmd.addCommand('pointparticles', pointParticles_f)
}
