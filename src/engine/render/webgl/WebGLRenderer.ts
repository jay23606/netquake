// WebGL2 backend (see docs/render-backend-interface.md).
//
// Owns all gl.* submission, extracted from r.ts/draw.ts/sky.ts/pscript.ts/texture.ts; the
// backend-agnostic CPU scene logic (visibility, chains, entity lists) stays in those modules.

import {
  IRenderer, FrameGlobals, SceneSetup, FaceVis, SurfacePass, RTexture, RBuffer,
} from '../IRenderer'
import { Entity } from '../../types/Entity'
import { Model, TexChain, Texture, SpriteFrame, SpriteFrameGroup, BrushPrecomputeGL, BrushPrecomputeGLSlot } from '../../types/Model'
import { V3 } from '../../types/Vector'
import * as GL from '../../GL'
import * as r from '../../r'
import { Color } from '../../r'
import * as scr from '../../scr'
import * as vid from '../../vid'
import * as host from '../../host'
import * as tx from '../../texture'
import * as cl from '../../cl'
import * as def from '../../def'
import * as pr from '../../pr'
import * as fog from '../../fog'
import * as sky from '../../sky'
import * as lm from '../../lightmap'
import * as mod from '../../mod'
import * as chase from '../../chase'
import * as con from '../../console'
import * as vec from '../../vec'
import * as v from '../../v'
import * as pscript from '../../pscript'
import * as cvar from '../../cvar'
import * as batchRender from './batchRender'
import * as draw from '../../draw'

const NOT_EXTRACTED = (name: string): never => {
  throw new Error('WebGLRenderer.' + name + ': not yet extracted (Phase 1)')
}

// ← r.perspective() (render phase3 slice): compute the view matrix and broadcast the view basis,
// projection, and gamma to every WebGL program's uniforms. WebGL-only — WebGPU consumes the same values
// via FrameGlobals instead. The scene data (r.state.perspective/vpn/viewMatrix/refdef) and the CPU
// r.computeViewMatrix helper stay in r.ts; only this per-program GL uniform push lives here.
const perspective = () => {
  const gl = GL.getContext()
  const viewMatrix = r.state.viewMatrix
  r.computeViewMatrix(viewMatrix)

  // Scene-wide fog (QSS-M Fog_SetupFrame, gl_rmain.c:2362): every 3D program declaring
  // uFogDensity gets the same density/color, so they agree at their shared edges. uFogDensity
  // is the marker, not uFogColor — SkyCube declares that for its separate r_skyfog blend.
  const fogDensity = fog.getDensity()
  const fogColor = fog.getColor()

  GL.unbindProgram()
  var i, program
  for (i = 0; i < GL.state.programs.length; ++i) {
    program = GL.state.programs[i]
    gl.useProgram(program.program)
    if (program.uniforms.uViewOrigin != null)
      gl.uniform3fv(program.uniforms.uViewOrigin, r.state.refdef.vieworg)
    if (program.uniforms.uViewAngles != null)
      gl.uniformMatrix3fv(program.uniforms.uViewAngles, false, viewMatrix)
    if (program.uniforms.uPerspective != null)
      gl.uniformMatrix4fv(program.uniforms.uPerspective, false, r.state.perspective)
    if (program.uniforms.uGamma != null)
      gl.uniform1f(program.uniforms.uGamma, v.cvr.gamma.value)
    if (program.uniforms.uVpn != null)
      gl.uniform3fv(program.uniforms.uVpn, r.state.vpn)
    if (program.uniforms.uFogDensity != null) {
      gl.uniform1f(program.uniforms.uFogDensity, fogDensity / 64)
      gl.uniform4f(program.uniforms.uFogColor, fogColor[0], fogColor[1], fogColor[2], fogColor[3])
    }
  }
}

// Local copy of r.ts's private clamp (used by the classic/cubemap sky fog math below). Trivial and
// byte-identical; kept local rather than widening r.ts's export surface for a one-liner.
const clamp = (min: number, v: number, max: number) => v < min ? min : (v > max ? max : v)

// ─── world-surface + sky submission (moved verbatim from r.ts, render phase1 slice) ───
// These module-private workers are the exact bodies of r.drawTextureChains{,_litwater,_water} and
// r.drawSkyBox. Only reference remapping changed: r.ts module state/cvars/CPU helpers are reached
// through `r.*` imports (r.state, r.cvr, r.textureAnimation, r.waterAlphaForFlags,
// r.waterAlphaForEntitySurface, r.isLitWaterFlags) exactly as the pilot reads r.state.warptexture;
// the pure gl-submission helpers (applyWaterAlpha / bindFullbrightTexture / bindLightmapPageTextures)
// moved here alongside them. No draw order, gl state, batching, or math changed.

// Blend state toggle when a water surface's alpha differs from the bound one.
const applyWaterAlpha = (gl: WebGL2RenderingContext, program: GL.GLProgram, newalpha: number) => {
  if (newalpha < 1)
  {
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  } else {
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
  gl.uniform1f(program.uniforms.uAlpha, newalpha);
}

// TMU 2 = FullbrightTex: additive luma companion for split fullbright textures (see mod.loadTextures)
const bindFullbrightTexture = (gl: WebGL2RenderingContext, program: ReturnType<typeof GL.useProgram>, texture: Texture) => {
  if (r.cvr.fullbrights.value && texture.fullbright) {
    tx.bind(2, texture.fullbright)
    gl.uniform1i(program.uniforms.uUseFullbrightTex, 1)
  } else {
    tx.bind(2, tx.state.null_texture)
    gl.uniform1i(program.uniforms.uUseFullbrightTex, 0)
  }
}

// Bind all 4 lightmap style units (1,3,4,5) for a page. Shared by the solid and lit-water Brush passes.
const bindLightmapPageTextures = (gl: WebGL2RenderingContext, page: number) => {
  const pageSlots = tx.state.lightmap_style_textures[page]
  const black = tx.state.black_texture
  tx.bind(1, pageSlots && pageSlots[0] ? pageSlots[0].texnum : black)
  tx.bind(3, pageSlots && pageSlots[1] ? pageSlots[1].texnum : black)
  tx.bind(4, pageSlots && pageSlots[2] ? pageSlots[2].texnum : black)
  tx.bind(5, pageSlots && pageSlots[3] ? pageSlots[3].texnum : black)
}

// Faces the precompute excludes — the solid pass skips these too (sky/tiled/notexture), so the image is
// unchanged. Water/turb (drawtub) never reaches here: r.buildBrushPrecompute only marks pure-solid
// submodels eligible.
const PRECOMPUTE_GL_SKIP = def.SURF.drawtiled | def.SURF.notexture | def.SURF.drawsky

// Build the WebGL2 static precompute for one eligible brush submodel: concatenate every drawable face's
// prebuilt fan indices (model.surfIndexData) into a single STATIC_DRAW element buffer, ordered so each
// (base texture, fence, lightmap page) group is a contiguous range → one drawElements per group with a
// single bound lightmap page. Cold path (first draw of a submodel per map); the string keys/Maps here
// never run per frame. Returns null if the submodel has no drawable faces.
const buildBrushPrecomputeGL = (gl: WebGL2RenderingContext, model: Model): BrushPrecomputeGL | null => {
  const faces = model.faces, first = model.firstface, num = model.numfaces
  const texinfo = model.texinfo
  const idxOfs = model.surfIndexOfs, idxCnt = model.surfIndexCount, idxData = model.surfIndexData
  const lmPage = model.surfLightmapPage

  // Pass 1: total each (texture, fence, lmpage) group's index count.
  const counts = new Map<string, number>()
  var total = 0
  for (var i = 0; i < num; i++) {
    const fi = first + i, surf = faces[fi]
    if (surf.flags & PRECOMPUTE_GL_SKIP)
      continue
    const key = texinfo[surf.texinfo].texture + ':' + ((surf.flags & def.SURF.drawfence) ? 1 : 0) + ':' + lmPage[fi]
    counts.set(key, (counts.get(key) || 0) + idxCnt[fi])
    total += idxCnt[fi]
  }
  if (total === 0)
    return null

  // Prefix-sum each group into a contiguous range; build the slot list + write cursors.
  const indexData = new Uint32Array(total)
  const slots: BrushPrecomputeGLSlot[] = []
  const groupFirst = new Map<string, number>()
  var running = 0
  counts.forEach((c, key) => {
    groupFirst.set(key, running)
    const p = key.split(':')
    slots.push({ textureIndex: +p[0], isFence: p[1] === '1', lmpage: +p[2], first: running, count: c })
    running += c
  })

  // Pass 2: copy each drawable face's fan indices into its group's range.
  for (var i = 0; i < num; i++) {
    const fi = first + i, surf = faces[fi]
    if (surf.flags & PRECOMPUTE_GL_SKIP)
      continue
    const key = texinfo[surf.texinfo].texture + ':' + ((surf.flags & def.SURF.drawfence) ? 1 : 0) + ':' + lmPage[fi]
    var cur = groupFirst.get(key) as number
    const so = idxOfs[fi], cc = idxCnt[fi]
    for (var e = 0; e < cc; e++)
      indexData[cur++] = idxData[so + e]
    groupFirst.set(key, cur)
  }

  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexData, gl.STATIC_DRAW)
  return { buffer, slots, worldVbo: r.state.model_vbo }
}

/*
================
R_DrawTextureChains_Water -- johnfitz
================
*/
const drawTextureChains_water = (gl: WebGL2RenderingContext, model: Model, ent: Entity | null, chain: TexChain) => {

  // No water chained for this model? Skip before touching the program —
  // most brush entities have no water, and switching Turbulent<->Brush per
  // entity forces the driver to revalidate the heavyweight Brush program.
  var anyWater = false
  var usedTex = model.usedTextures
  for (var ui = 0; ui < usedTex.length; ui++) {
    var t = model.textures[usedTex[ui]];
    if (t && t.texturechains && t.texturechains[chain]
      && (t.texturechains[chain].flags & def.SURF.drawtub)) {
      anyWater = true
      break
    }
  }
  if (!anyWater)
    return

  // Lit turb surfaces draw via drawTextureChains_litwater instead — skip
  // them here so they aren't drawn twice.
  var litwaterActive = r.cvr.litwater.value !== 0 && cl.clState.worldmodel.haslitwater

  // World chains hold every PVS-visible surface regardless of facing;
  // backface + frustum culling for them is the surfVisibleFrame stamp from
  // markWorldFrustum. Entity chains (drawBrushModel) are built by walking
  // only front-facing surfaces in the first place, so nothing further to
  // check here.
  var isWorld = model === cl.clState.worldmodel && chain === TexChain.world
  var visibleStamp = model.surfVisibleFrame, stampFrame = r.state.frustumFrame

  const turbulentProgram = GL.useProgram('Turbulent')

  // Bind the buffers
  gl.bindBuffer(gl.ARRAY_BUFFER, r.state.model_vbo);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null)// indices come from client memory!

  gl.vertexAttribPointer(turbulentProgram.attributeMap.aPosition.location, 3, gl.FLOAT, false, def.VERTEXSIZE * 4, 0);
  gl.vertexAttribPointer(turbulentProgram.attributeMap.aTexCoord.location, 2, gl.FLOAT, false, def.VERTEXSIZE * 4, 4 * 3);

  // set uniforms
  gl.uniform1i(turbulentProgram.uniforms.uUseOverbright, r.cvr.overbright.value);
  gl.uniform1i(turbulentProgram.uniforms.uUseAlphaTest, 0);

  gl.uniform3f(turbulentProgram.uniforms.uOrigin, 0.0, 0.0, 0.0);
  gl.uniformMatrix3fv(turbulentProgram.uniforms.uAngles, false, GL.identity);
  gl.uniform1f(turbulentProgram.uniforms.uTime, host.state.realtime % (Math.PI * 2.0))

  // World scans every texture slot (worldChainOfs/Count are indexed by
  // absolute texture index); entities scan only their own usedTextures.
  var texCount = isWorld ? model.textures.length : usedTex.length
  for (var ti = 0; ti < texCount; ti++) {
    var i = isWorld ? ti : usedTex[ti]
    var t = model.textures[i];
    if (!t || !t.texturechains || !t.texturechains[chain] || !(t.texturechains[chain].flags & def.SURF.drawtub))
      continue;
    var animatedTexture = r.textureAnimation(r.state.cl_worldmodel, t, ent != null ? ent.frame : 0)
    batchRender.clearBatch();
    var bound = false;
    var entalpha = 0

    if (isWorld) {
      // ent is always null for the world chain, so newalpha is always
      // waterAlphaForFlags(flags) — no entity-alpha branch needed.
      var ofs = model.worldChainOfs[i], count = model.worldChainCount[i]
      var chainFaces = model.worldChainFaces, flagsArr = model.surfFlags
      for (var ci = 0; ci < count; ci++) {
        var f = chainFaces[ofs + ci]
        if (visibleStamp[f] !== stampFrame)
          continue
        if (litwaterActive && r.isLitWaterFlags(flagsArr[f]))
          continue
        if (!bound) {
          tx.bind(0, animatedTexture.texturenum);
          bound = true;
        }
        var newalpha = r.waterAlphaForFlags(flagsArr[f]);
        if (newalpha !== entalpha)
          applyWaterAlpha(gl, turbulentProgram, newalpha);
        entalpha = newalpha
        batchRender.batchSurfaceRange(gl, model, f);
      }
    } else {
      for (var s = t.texturechains[chain]; s; s = s.texturechain) {
        if (litwaterActive && r.isLitWaterFlags(s.flags))
          continue
        if (!bound) //only bind once we are sure we need this texture
        {
          tx.bind(0, animatedTexture.texturenum);
          bound = true;
        }

        var	newalpha = r.waterAlphaForEntitySurface (ent, s);
        if (newalpha !== entalpha)
          applyWaterAlpha(gl, turbulentProgram, newalpha);
        entalpha = newalpha

        batchRender.batchSurface(gl, model, s);
      }
    }

    //R_EndTransparentDrawing (entalpha);
    batchRender.flushBatch(gl)

    if (entalpha < 1)
    {
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
  }


  GL.unbindProgram()
}

/*
================
R_DrawTextureChains_LitWater -- r_litwater

Turb surfaces with real lightmap samples (isLitWaterFlags) draw through the
Brush pipeline instead of Turbulent, so they pick up lightstyles/dlights/fog
like solid brushes. The diffuse UV is warped in-shader (uWarp) with the same
formula as fshTurbulent; lightmap UVs are sampled unwarped. Per-surface alpha
and blend state mirror drawTextureChains_water exactly.
================
*/
const drawTextureChains_litwater = (gl: WebGL2RenderingContext, model: Model, ent: Entity | null, chain: TexChain) => {
  if (!r.cvr.litwater.value || !cl.clState.worldmodel.haslitwater)
    return

  // No water chained for this model? Skip before touching the program, same
  // as drawTextureChains_water — the per-face isLitWaterFlags check below
  // decides which of those water surfaces actually belong to this pass.
  var anyWater = false
  var usedTex = model.usedTextures
  for (var ui = 0; ui < usedTex.length; ui++) {
    var t = model.textures[usedTex[ui]];
    if (t && t.texturechains && t.texturechains[chain]
      && (t.texturechains[chain].flags & def.SURF.drawtub)) {
      anyWater = true
      break
    }
  }
  if (!anyWater)
    return

  var isWorld = model === cl.clState.worldmodel && chain === TexChain.world
  var visibleStamp = model.surfVisibleFrame, stampFrame = r.state.frustumFrame

  const brushProgram = GL.useProgram('Brush')
  const fogColor = fog.getColor()
  const fogDensity = fog.getDensity()

  // Bind the buffers
  gl.bindBuffer(gl.ARRAY_BUFFER, r.state.model_vbo);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null) // indices come from client memory!

  gl.vertexAttribPointer(brushProgram.attributeMap.Vert.location, 3, gl.FLOAT, false, def.VERTEXSIZE * 4, 0);
  gl.vertexAttribPointer(brushProgram.attributeMap.TexCoords.location, 2, gl.FLOAT, false, def.VERTEXSIZE * 4, 4 * 3);
  gl.vertexAttribPointer(brushProgram.attributeMap.LMCoords.location, 2, gl.FLOAT, false, def.VERTEXSIZE * 4, 4 * 5);
  gl.vertexAttribPointer(brushProgram.attributeMap.LMStyles.location, 4, gl.FLOAT, false, def.VERTEXSIZE * 4, 4 * 7);

  // Same dirty-flag guard as drawTextureChains — cheap no-op if the solid
  // pass already uploaded this frame's lightstyle weights.
  if (lm.state.lightstyle_uniform_dirty) {
    const stylesUniform = lm.state.lightstyle_uniform
    for (var j = 0; j < lm.MAX_LIGHTSTYLES; j++)
      stylesUniform[j] = lm.state.lightstylevalue[j] / 128.0
    stylesUniform[64] = 0.0 // unused slot weight is always zero
    gl.uniform1fv(brushProgram.uniforms['uLightStyles[0]'], stylesUniform)
    lm.state.lightstyle_uniform_dirty = false
  }

  // set uniforms
  gl.uniform1i(brushProgram.uniforms.uUseFullbrightTex, 0);
  gl.uniform1i(brushProgram.uniforms.uUseOverbright, r.cvr.overbright.value);
  gl.uniform1i(brushProgram.uniforms.uUseAlphaTest, 0);
  gl.uniform1i(brushProgram.uniforms.uWarp, 1);
  gl.uniform1f(brushProgram.uniforms.uTime, host.state.realtime % (Math.PI * 2.0));
  gl.uniform1f(brushProgram.uniforms.uFogDensity, fogDensity / 64)
  gl.uniform4f(brushProgram.uniforms.uFogColor, fogColor[0], fogColor[1], fogColor[2], fogColor[3])
  tx.bind(2, tx.state.null_texture) // FullbrightTex unused on water (uUseFullbrightTex = 0)

  // GPU dlights: same once-per-frame guard as drawTextureChains.
  if (r.state.dlightUniformFrame !== r.state.framecount) {
    r.state.dlightUniformFrame = r.state.framecount;
    gl.uniform1i(brushProgram.uniforms.uNumDlights, r.state.numShaderDlights);
    gl.uniform4fv(brushProgram.uniforms['uDlightPosRadius[0]'], r.state.dlightPosRadius);
    gl.uniform4fv(brushProgram.uniforms['uDlightColor[0]'], r.state.dlightColor);
  }

  if (ent !== null) {
    var viewMatrix = GL.rotationMatrix(ent.angles[0], ent.angles[1], ent.angles[2]);

    gl.uniform3fv(brushProgram.uniforms.uOrigin, ent.origin);
    gl.uniformMatrix3fv(brushProgram.uniforms.uAngles, false, viewMatrix);

  } else {
    gl.uniform3f(brushProgram.uniforms.uOrigin, 0.0, 0.0, 0.0);
    gl.uniformMatrix3fv(brushProgram.uniforms.uAngles, false, GL.identity);
  }

  // World scans every texture slot (worldChainOfs/Count are indexed by
  // absolute texture index); entities scan only their own usedTextures.
  var texCount = isWorld ? model.textures.length : usedTex.length
  for (var ti = 0; ti < texCount; ti++) {
    var i = isWorld ? ti : usedTex[ti]
    var t = model.textures[i];
    if (!t || !t.texturechains || !t.texturechains[chain] || !(t.texturechains[chain].flags & def.SURF.drawtub))
      continue;

    var animatedTexture = r.textureAnimation(model, t, ent != null ? ent.frame : 0)
    batchRender.clearBatch();
    var bound = false;
    var lastlightmap = -1;
    var entalpha = 0

    if (isWorld) {
      var ofs = model.worldChainOfs[i], count = model.worldChainCount[i]
      var chainFaces = model.worldChainFaces, flagsArr = model.surfFlags, lmPage = model.surfLightmapPage
      for (var ci = 0; ci < count; ci++) {
        var f = chainFaces[ofs + ci]
        if (visibleStamp[f] !== stampFrame)
          continue
        if (!r.isLitWaterFlags(flagsArr[f]))
          continue
        if (!bound) {
          tx.bind(0, animatedTexture.texturenum);
          bound = true;
          lastlightmap = lmPage[f];
          bindLightmapPageTextures(gl, lastlightmap);
        }
        if (lmPage[f] !== lastlightmap) {
          batchRender.flushBatch(gl);
          bindLightmapPageTextures(gl, lmPage[f]);
          lastlightmap = lmPage[f];
        }
        var newalpha = r.waterAlphaForFlags(flagsArr[f]);
        if (newalpha !== entalpha)
          applyWaterAlpha(gl, brushProgram, newalpha);
        entalpha = newalpha
        batchRender.batchSurfaceRange(gl, model, f);
      }
    } else {
      for (var s = t.texturechains[chain]; s; s = s.texturechain) {
        if (!r.isLitWaterFlags(s.flags))
          continue
        if (!bound) {
          tx.bind(0, animatedTexture.texturenum);
          bound = true;
          lastlightmap = s.lightmaptexturenum;
          bindLightmapPageTextures(gl, lastlightmap);
        }
        if (s.lightmaptexturenum !== lastlightmap) {
          batchRender.flushBatch(gl);
          bindLightmapPageTextures(gl, s.lightmaptexturenum);
          lastlightmap = s.lightmaptexturenum;
        }
        var newalpha = r.waterAlphaForEntitySurface(ent, s);
        if (newalpha !== entalpha)
          applyWaterAlpha(gl, brushProgram, newalpha);
        entalpha = newalpha
        batchRender.batchSurface(gl, model, s);
      }
    }

    batchRender.flushBatch(gl)

    if (entalpha < 1)
    {
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
  }

  GL.unbindProgram()
}

const drawTextureChains = (gl: WebGL2RenderingContext, model: Model, ent: Entity | null, chain: TexChain) => {
  var entalpha = ent ? pr.decodeAlpha(ent.alpha) : 1

  // See drawTextureChains_water for why only the world chain needs the
  // per-surface visibility check.
  var isWorld = model === cl.clState.worldmodel && chain === TexChain.world
  var visibleStamp = model.surfVisibleFrame, stampFrame = r.state.frustumFrame

  // Nothing lightmapped/solid chained for this model? Skip entirely — avoids
  // a Brush program bind per brush entity that has nothing for this pass.
  var anySolid = false
  var usedTex = model.usedTextures
  for (var ui = 0; ui < usedTex.length; ui++) {
    var t = model.textures[usedTex[ui]];
    if (t && t.texturechains && t.texturechains[chain]
      && !(t.texturechains[chain].flags & (def.SURF.drawtiled | def.SURF.notexture | def.SURF.drawtub))) {
      anySolid = true
      break
    }
  }
  if (!anySolid)
    return

  // R_BeginTransparentDrawing (entalpha);

  // TODO: Missing texture support.
  // R_DrawTextureChains_NoTexture (model, chain);


  // R_EndTransparentDrawing (entalpha);

  // enable blending / disable depth writes
  if (entalpha < 1) {
    gl.depthMask(false);
    gl.enable(gl.BLEND);
  }

  const brushProgram = GL.useProgram('Brush')
  const fogColor = fog.getColor()
  const fogDensity = fog.getDensity()

  // Bind the buffers
  gl.bindBuffer(gl.ARRAY_BUFFER, r.state.model_vbo);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null) // indices come from client memory!

  gl.vertexAttribPointer(brushProgram.attributeMap.Vert.location, 3, gl.FLOAT, false, def.VERTEXSIZE * 4, 0);
  gl.vertexAttribPointer(brushProgram.attributeMap.TexCoords.location, 2, gl.FLOAT, false, def.VERTEXSIZE * 4, 4 * 3);
  gl.vertexAttribPointer(brushProgram.attributeMap.LMCoords.location, 2, gl.FLOAT, false, def.VERTEXSIZE * 4, 4 * 5);
  gl.vertexAttribPointer(brushProgram.attributeMap.LMStyles.location, 4, gl.FLOAT, false, def.VERTEXSIZE * 4, 4 * 7);

  // Upload lightstyle weights only when a style value changed (10Hz ticks);
  // uniform values persist on the program object across binds.
  if (lm.state.lightstyle_uniform_dirty) {
    const stylesUniform = lm.state.lightstyle_uniform
    for (var j = 0; j < lm.MAX_LIGHTSTYLES; j++)
      stylesUniform[j] = lm.state.lightstylevalue[j] / 128.0
    stylesUniform[64] = 0.0 // unused slot weight is always zero
    gl.uniform1fv(brushProgram.uniforms['uLightStyles[0]'], stylesUniform)
    lm.state.lightstyle_uniform_dirty = false
  }

  // set uniforms
  gl.uniform1i(brushProgram.uniforms.uUseFullbrightTex, 0);
  gl.uniform1i(brushProgram.uniforms.uUseOverbright, r.cvr.overbright.value);
  gl.uniform1i(brushProgram.uniforms.uUseAlphaTest, 0);
  // This pass never draws turb surfaces (excluded below), so warp stays off —
  // drawTextureChains_litwater is the only caller that turns it on.
  gl.uniform1i(brushProgram.uniforms.uWarp, 0);
  gl.uniform1f(brushProgram.uniforms.uAlpha, entalpha);
  gl.uniform1f(brushProgram.uniforms.uFogDensity, fogDensity / 64)
  gl.uniform4f(brushProgram.uniforms.uFogColor, fogColor[0], fogColor[1], fogColor[2], fogColor[3])

  // GPU dlights: packed once per frame in gatherDlights(); uniform values
  // persist on the program object across binds, so upload once per frame
  // even though drawTextureChains runs again for every brush entity.
  if (r.state.dlightUniformFrame !== r.state.framecount) {
    r.state.dlightUniformFrame = r.state.framecount;
    gl.uniform1i(brushProgram.uniforms.uNumDlights, r.state.numShaderDlights);
    gl.uniform4fv(brushProgram.uniforms['uDlightPosRadius[0]'], r.state.dlightPosRadius);
    gl.uniform4fv(brushProgram.uniforms['uDlightColor[0]'], r.state.dlightColor);
  }

  if (ent !== null) {
    var viewMatrix = GL.rotationMatrix(ent.angles[0], ent.angles[1], ent.angles[2]);

    gl.uniform3fv(brushProgram.uniforms.uOrigin, ent.origin);
    gl.uniformMatrix3fv(brushProgram.uniforms.uAngles, false, viewMatrix);

  } else {
    gl.uniform3f(brushProgram.uniforms.uOrigin, 0.0, 0.0, 0.0);
    gl.uniformMatrix3fv(brushProgram.uniforms.uAngles, false, GL.identity);
  }

  // World scans every texture slot (worldChainOfs/Count are indexed by
  // absolute texture index); entities scan only their own usedTextures.
  var texCount = isWorld ? model.textures.length : usedTex.length
  for (var ti = 0; ti < texCount; ti++) {
    var i = isWorld ? ti : usedTex[ti]
    var t = model.textures[i];

    if (!t || !t.texturechains || !t.texturechains[chain] || t.texturechains[chain].flags & (def.SURF.drawtiled | def.SURF.notexture | def.SURF.drawtub))
      continue;

    var animatedTexture = r.textureAnimation(model, t, ent != null ? ent.frame : 0)

    batchRender.clearBatch();

    var bound = false;
    var lastlightmap = -1;

    if (isWorld) {
      var ofs = model.worldChainOfs[i], count = model.worldChainCount[i]
      var chainFaces = model.worldChainFaces, lmPage = model.surfLightmapPage
      for (var ci = 0; ci < count; ci++) {
        var f = chainFaces[ofs + ci]
        if (visibleStamp[f] !== stampFrame)
          continue
        if (!bound) //only bind once we are sure we need this texture
        {
          tx.bind(0, animatedTexture.texturenum);
          bindFullbrightTexture(gl, brushProgram, animatedTexture);

          if (t.texturechains[chain].flags & def.SURF.drawfence)
            gl.uniform1i(brushProgram.uniforms.uUseAlphaTest, 1);

          bound = true;
          lastlightmap = lmPage[f];
          bindLightmapPageTextures(gl, lastlightmap);
        }

        if (lmPage[f] !== lastlightmap) {
          batchRender.flushBatch(gl);
          bindLightmapPageTextures(gl, lmPage[f]);
          lastlightmap = lmPage[f];
        }

        batchRender.batchSurfaceRange(gl, model, f);

        // rs_brushpasses++; // stats
      }
    } else {
      for (var s = t.texturechains[chain]; !!s; s = s.texturechain) {
        if (!bound) //only bind once we are sure we need this texture
        {
          tx.bind(0, animatedTexture.texturenum);
          bindFullbrightTexture(gl, brushProgram, animatedTexture);

          if (t.texturechains[chain].flags & def.SURF.drawfence)
            gl.uniform1i(brushProgram.uniforms.uUseAlphaTest, 1);

          bound = true;
          lastlightmap = s.lightmaptexturenum;
          bindLightmapPageTextures(gl, s.lightmaptexturenum);
        }

        if (s.lightmaptexturenum !== lastlightmap) {
          batchRender.flushBatch(gl);
          bindLightmapPageTextures(gl, s.lightmaptexturenum);
          lastlightmap = s.lightmaptexturenum;
        }

        batchRender.batchSurface(gl, model, s);

        // rs_brushpasses++; // stats
      }
    }

    batchRender.flushBatch(gl);

    if (bound && t.texturechains[chain].flags & def.SURF.drawfence)
      gl.uniform1i(brushProgram.uniforms.uUseAlphaTest, 0); // Flip alpha test back off
  }

  GL.unbindProgram()

  if (entalpha < 1) {
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
}

// Body of r.drawSkyBox: three sub-paths — (1) skyroom depth-only colorMask trick, (2) cubemap
// SkyCube, (3) classic scrolling dome (SkyChain depth mask + Sky octant draws). Byte-identical.
const drawSkyBox = () => {
  const gl = GL.getContext()
  if (r.state.drawsky !== true)
    return;

  // A skyroom was drawn underneath this frame: write sky-surface DEPTH only (no color)
  // so world geometry behind the windows can't overdraw the skyroom, while the windows
  // keep the skyroom color composited earlier. Replaces the cubemap/classic sky here
  // (QSS gl_sky.c:1179 Sky_DrawSky skyroom_drawn branch).
  if (sky.state.skyroom_drawn) {
    var clmodel = cl.clState.worldmodel;
    var visibleStamp = clmodel.surfVisibleFrame, stampFrame = r.state.frustumFrame;
    var chainFaces = clmodel.worldChainFaces;
    gl.colorMask(false, false, false, false);
    var depthProgram = GL.useProgram('SkyChain', false);
    gl.bindBuffer(gl.ARRAY_BUFFER, r.state.model_vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null)
    gl.vertexAttribPointer(depthProgram.attributeMap.aPosition.location, 3, gl.FLOAT, false, def.VERTEXSIZE * 4, 0);
    for (var i = 0; i < clmodel.textures.length; i++) {
      var t = clmodel.textures[i];
      if (!t || !t.texturechains || !t.texturechains[TexChain.world] || !(t.texturechains[TexChain.world].flags & def.SURF.drawsky))
        continue;
      var ofs = clmodel.worldChainOfs[i], count = clmodel.worldChainCount[i]
      for (var ci = 0; ci < count; ci++) {
        var f = chainFaces[ofs + ci]
        if (visibleStamp[f] === stampFrame) {
          sky.state.skyVisibleThisFrame = true; // keep the skyroom alive next frame
          batchRender.batchSurfaceRange(gl, clmodel, f);
        }
      }
    }
    batchRender.flushBatch(gl);
    gl.colorMask(true, true, true, true);
    return;
  }

  if (sky.state.texture !== null) {
    var clmodel = cl.clState.worldmodel;
    var cubeProgram = GL.useProgram('SkyCube', false);
    gl.bindBuffer(gl.ARRAY_BUFFER, r.state.model_vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null)
    gl.vertexAttribPointer(cubeProgram.attributeMap.aPosition.location, 3, gl.FLOAT, false, def.VERTEXSIZE * 4, 0);

    // tx.bind only handles TEXTURE_2D; bind the cubemap manually and mirror
    // the state into tx's per-unit cache so a later tx.bind on this unit
    // doesn't wrongly skip its own gl.activeTexture/gl.bindTexture calls.
    var skyUnit = cubeProgram.textures.tSky;
    gl.activeTexture(gl.TEXTURE0 + skyUnit);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, sky.state.texture);
    tx.state.activetexture = skyUnit;
    tx.state.currenttextures[skyUnit] = sky.state.texture;

    var fogDensity = fog.getDensity();
    var fogColor = fog.getColor();
    var skyFog = fogDensity <= 0 ? 0 : clamp(0, sky.state.skyfog, 1);
    gl.uniform1f(cubeProgram.uniforms.uSkyFog, skyFog);
    gl.uniform3f(cubeProgram.uniforms.uFogColor, fogColor[0], fogColor[1], fogColor[2]);

    var visibleStamp = clmodel.surfVisibleFrame, stampFrame = r.state.frustumFrame;
    var chainFaces = clmodel.worldChainFaces;
    for (var i = 0; i < clmodel.textures.length; i++) {
      var t = clmodel.textures[i];
      if (!t || !t.texturechains || !t.texturechains[TexChain.world] || !(t.texturechains[TexChain.world].flags & def.SURF.drawsky))
        continue;
      var ofs = clmodel.worldChainOfs[i], count = clmodel.worldChainCount[i]
      for (var ci = 0; ci < count; ci++) {
        var f = chainFaces[ofs + ci]
        if (visibleStamp[f] === stampFrame) {
          sky.state.skyVisibleThisFrame = true;
          batchRender.batchSurfaceRange(gl, clmodel, f);
        }
      }
    }
    batchRender.flushBatch(gl);
    return;
  }

  gl.colorMask(false, false, false, false);
  var clmodel = cl.clState.worldmodel;
  var program = GL.useProgram('SkyChain', false);
  gl.bindBuffer(gl.ARRAY_BUFFER,  r.state.model_vbo);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null)
  gl.vertexAttribPointer(program.attributeMap.aPosition.location, 3, gl.FLOAT, false, def.VERTEXSIZE * 4, 0);
  var visibleStamp = clmodel.surfVisibleFrame, stampFrame = r.state.frustumFrame;
  var chainFaces = clmodel.worldChainFaces;
  for (var i = 0; i < clmodel.textures.length; i++) {
    var t = clmodel.textures[i];
    if (!t || !t.texturechains || !t.texturechains[TexChain.world] || !(t.texturechains[TexChain.world].flags & def.SURF.drawsky))
      continue;
    var ofs = clmodel.worldChainOfs[i], count = clmodel.worldChainCount[i]
    for (var ci = 0; ci < count; ci++) {
      var f = chainFaces[ofs + ci]
      if (visibleStamp[f] === stampFrame) {
        sky.state.skyVisibleThisFrame = true;
        batchRender.batchSurfaceRange(gl, clmodel, f);
      }
    }
  }
  batchRender.flushBatch(gl);

  gl.colorMask(true, true, true, true);

  gl.depthFunc(gl.GREATER);
  gl.depthMask(false);
  gl.disable(gl.CULL_FACE);

  program = GL.useProgram('Sky', false);
  gl.uniform2f(program.uniforms.uTime, (host.state.realtime * 0.125) % 1.0, (host.state.realtime * 0.03125) % 1.0);
  tx.bind(program.textures.tSolid, r.state.solidskytexture, false);
  tx.bind(program.textures.tAlpha, r.state.alphaskytexture, false);
  gl.bindBuffer(gl.ARRAY_BUFFER, r.state.skyvecs);
  gl.vertexAttribPointer(program.attributeMap.aPosition.location, 3, gl.FLOAT, false, 12, 0);

  gl.uniform3f(program.uniforms.uScale, 2.0, -2.0, 1.0);
  gl.drawArrays(gl.TRIANGLES, 0, 180);
  gl.uniform3f(program.uniforms.uScale, 2.0, -2.0, -1.0);
  gl.drawArrays(gl.TRIANGLES, 0, 180);

  gl.uniform3f(program.uniforms.uScale, 2.0, 2.0, 1.0);
  gl.drawArrays(gl.TRIANGLES, 0, 180);
  gl.uniform3f(program.uniforms.uScale, 2.0, 2.0, -1.0);
  gl.drawArrays(gl.TRIANGLES, 0, 180);

  gl.uniform3f(program.uniforms.uScale, -2.0, -2.0, 1.0);
  gl.drawArrays(gl.TRIANGLES, 0, 180);
  gl.uniform3f(program.uniforms.uScale, -2.0, -2.0, -1.0);
  gl.drawArrays(gl.TRIANGLES, 0, 180);

  gl.uniform3f(program.uniforms.uScale, -2.0, 2.0, 1.0);
  gl.drawArrays(gl.TRIANGLES, 0, 180);
  gl.uniform3f(program.uniforms.uScale, -2.0, 2.0, -1.0);
  gl.drawArrays(gl.TRIANGLES, 0, 180);

  gl.enable(gl.CULL_FACE);
  gl.depthMask(true);
  gl.depthFunc(gl.LESS);
}

// ─── entity / alias / sprite / viewmodel submission (moved verbatim from r.ts, render phase1 slice) ───
// These module-private workers are the exact bodies of r.drawSpriteModel / drawAliasModel /
// drawEntitiesOnList / drawViewModel. Only reference remapping changed: r.ts module state/cvars and the
// backend-agnostic CPU helpers are reached through `r.*` (r.state, r.cvr, r.cullBox,
// r.setupEntityTransform, r.setupAliasFrame, r.lightPoint, r.drawBrushModel). No draw order, gl state,
// attribute binding, batching, or math changed.

// Local copy of r.ts's private negX constant (light direction basis for the alias shade vector).
// Trivial and byte-identical; kept local rather than widening r.ts's export surface for a one-liner.
const negX: V3 = [-1.0, 0.0, 0.0]

const drawSpriteModel = (e: Entity) => {
  var program = GL.useProgram('Sprite', true);
  var num = e.frame;
  if ((num >= e.model.numframes) || (num < 0)) {
    con.dPrint('R.DrawSpriteModel: no such frame ' + num + '\n');
    num = 0;
  }
  var frame = e.model.frames[num] as SpriteFrame | SpriteFrameGroup;
  if (frame.group === true) {
    var fullinterval, targettime, i, time = cl.clState.time + e.syncbase;
    num = frame.frames.length - 1;
    fullinterval = frame.frames[num].interval;
    targettime = time - Math.floor(time / fullinterval) * fullinterval;
    for (i = 0; i < num; ++i) {
      if (frame.frames[i].interval > targettime)
        break;
    }
    frame = frame.frames[i];
  }

  tx.bind(program.textures.tTexture, frame.texturenum, true);
  // local billboard right/up vectors; renamed from r/u in r.ts so they don't shadow the `r` module
  // import used for r.state.vright/vup below (behavior identical).
  var sr = vec.scratch(), su = vec.scratch()
  if (e.model.oriented === true) {
    vec.angleVectors(e.angles, null, sr, su);
  }
  else {
    sr = r.state.vright;
    su = r.state.vup;
  }
  var p = e.origin;
  // entity .scale grows the sprite quad about its origin, matching Ironwail/QSS r_sprite.c
  // (VectorMA of frame extents * ENTSCALE_DECODE(e->scale)).
  var ss = pr.decodeScale(e.scale);
  var x1 = frame.origin[0] * ss, y1 = frame.origin[1] * ss, x2 = x1 + frame.width * ss, y2 = y1 + frame.height * ss;

  GL.streamGetSpace(6);
  GL.streamWriteFloat3(
    p[0] + x1 * sr[0] + y1 * su[0],
    p[1] + x1 * sr[1] + y1 * su[1],
    p[2] + x1 * sr[2] + y1 * su[2]);
  GL.streamWriteFloat2(0.0, 1.0);
  GL.streamWriteFloat3(
    p[0] + x1 * sr[0] + y2 * su[0],
    p[1] + x1 * sr[1] + y2 * su[1],
    p[2] + x1 * sr[2] + y2 * su[2]);
  GL.streamWriteFloat2(0.0, 0.0);
  GL.streamWriteFloat3(
    p[0] + x2 * sr[0] + y1 * su[0],
    p[1] + x2 * sr[1] + y1 * su[1],
    p[2] + x2 * sr[2] + y1 * su[2]);
  GL.streamWriteFloat2(1.0, 1.0);
  GL.streamWriteFloat3(
    p[0] + x2 * sr[0] + y1 * su[0],
    p[1] + x2 * sr[1] + y1 * su[1],
    p[2] + x2 * sr[2] + y1 * su[2]);
  GL.streamWriteFloat2(1.0, 1.0);
  GL.streamWriteFloat3(
    p[0] + x1 * sr[0] + y2 * su[0],
    p[1] + x1 * sr[1] + y2 * su[1],
    p[2] + x1 * sr[2] + y2 * su[2]);
  GL.streamWriteFloat2(0.0, 0.0);
  GL.streamWriteFloat3(
    p[0] + x2 * sr[0] + y2 * su[0],
    p[1] + x2 * sr[1] + y2 * su[1],
    p[2] + x2 * sr[2] + y2 * su[2]);
  GL.streamWriteFloat2(1.0, 0.0);
}

const drawAliasModel = (e: Entity) => {
  const gl = GL.getContext()
  var clmodel = e.model;

  // entity .scale (16 = 1.0) grows the cull sphere too, or big-scaled models pop at the
  // screen edge -- Ironwail R_GetEntityBounds scales bounds by ENTSCALE_DECODE(e->scale).
  var scalefactor = pr.decodeScale(e.scale);
  var cullRadius = clmodel.boundingradius * scalefactor;
  var cullMins = r.state.cullMins, cullMaxs = r.state.cullMaxs;
  cullMins[0] = e.origin[0] - cullRadius;
  cullMins[1] = e.origin[1] - cullRadius;
  cullMins[2] = e.origin[2] - cullRadius;
  cullMaxs[0] = e.origin[0] + cullRadius;
  cullMaxs[1] = e.origin[1] + cullRadius;
  cullMaxs[2] = e.origin[2] + cullRadius;
  if (r.cullBox(cullMins, cullMaxs) === true)
    return;

  // Culling above stays on e.origin (un-lerped) per Ironwail; only uniforms below use
  // the movestep-lerped transform.
  var lerpOrigin: V3 = vec.scratch(), lerpAngles: V3 = vec.scratch();
  r.setupEntityTransform(e, lerpOrigin, lerpAngles);

  var program;
  if ((e.colormap !== 0) && (clmodel.player === true) && (r.cvr.nocolors.value === 0)) {
    program = GL.useProgram('Player');
    var top = (cl.clState.scores[e.colormap - 1].colors & 0xf0) + 4;
    var bottom = ((cl.clState.scores[e.colormap - 1].colors & 0xf) << 4) + 4;
    if (top <= 127)
      top += 7;
    if (bottom <= 127)
      bottom += 7;
    top = vid.d_8to24table[top];
    bottom = vid.d_8to24table[bottom];
    gl.uniform3f(program.uniforms.uTop, top & 0xff, (top >> 8) & 0xff, top >> 16);
    gl.uniform3f(program.uniforms.uBottom, bottom & 0xff, (bottom >> 8) & 0xff, bottom >> 16);
  }
  else
    program = GL.useProgram('Alias');

  var entalpha = pr.decodeAlpha(e.alpha);
  if (entalpha === 0)
    return;
  gl.uniform1f(program.uniforms.uAlpha, entalpha);
  if (entalpha < 1) {
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  gl.uniform3fv(program.uniforms.uOrigin, lerpOrigin);
  gl.uniformMatrix3fv(program.uniforms.uAngles, false, GL.rotationMatrix(lerpAngles[0], lerpAngles[1], lerpAngles[2], scalefactor));

  var ambientlight = r.lightPoint(e.origin, e.lightcache, e.model != null ? e.model.maxs[2] * 0.5 : 0);

  if (e === cl.clState.viewent)  {
    add = 72 - (ambientlight[0] + ambientlight[1] + ambientlight[2])
    if (add > 0) {
      ambientlight[0] += add / 3
      ambientlight[1] += add / 3
      ambientlight[2] += add / 3
    }
  }
  var i, dl, add;
  var dx, dy, dz, distSq;
  for (i = 0; i < r.state.numActiveDlights; ++i) {
    dl = cl.state.dlights[r.state.activeDlights[i]];
    dx = e.origin[0] - dl.origin[0];
    dy = e.origin[1] - dl.origin[1];
    dz = e.origin[2] - dl.origin[2];
    distSq = dx * dx + dy * dy + dz * dz;
    if (dl.radius * dl.radius <= distSq)
      continue;
    add = dl.radius - Math.sqrt(distSq);
    vec.vectorMA(ambientlight, add, dl.color, ambientlight)
  }

  var shadelight: Color = vec.scratch() as unknown as Color
  vec.copy(ambientlight, shadelight)

  ambientlight[0] = ambientlight[0] > 128.0 ? 128.0 : ambientlight[0]
  ambientlight[1] = ambientlight[1] > 128.0 ? 128.0 : ambientlight[1]
  ambientlight[2] = ambientlight[2] > 128.0 ? 128.0 : ambientlight[2]

  shadelight[0] = ambientlight[0] + shadelight[0] > 192.0 ? 192.0 - ambientlight[0] : shadelight[0]
  shadelight[1] = ambientlight[1] + shadelight[1] > 192.0 ? 192.0 - ambientlight[1] : shadelight[1]
  shadelight[2] = ambientlight[2] + shadelight[2] > 192.0 ? 192.0 - ambientlight[2] : shadelight[2]

  // minimum light value on players (8)
  if ((e.num >= 1) && (e.num <= cl.clState.maxclients)) {
    add = 24.0 - (ambientlight[0] + ambientlight[1] + ambientlight[2]);
    if (add > 0.0) {
      ambientlight[0] += add / 3.0
      ambientlight[1] += add / 3.0
      ambientlight[2] += add / 3.0
      vec.copy(ambientlight, shadelight)
    }
  }
  gl.uniform3fv(program.uniforms.uAmbientLight, vec.scale(ambientlight, 0.0078125, vec.scratch()));
  gl.uniform3fv(program.uniforms.uShadeLight, vec.scale(shadelight, 0.0078125, vec.scratch()));
  gl.uniform1i(program.uniforms.uUseOverbright, r.cvr.overbright.value);
  gl.uniform1i(program.uniforms.uUseFullbrights, r.cvr.fullbrights.value);

  var forward:V3 = vec.scratch(), right:V3 = vec.scratch(), up:V3 = vec.scratch();
  vec.angleVectors(lerpAngles, forward, right, up);
  var lightVec = vec.scratch();
  lightVec[0] = vec.dotProductV3(negX, forward);
  lightVec[1] = -vec.dotProductV3(negX, right);
  lightVec[2] = vec.dotProductV3(negX, up);
  gl.uniform3fv(program.uniforms.uLightVec, lightVec);

  r.state.c_alias_polys += clmodel.numtris;

  r.setupAliasFrame(e, clmodel);
  var lerp = r.state.aliasLerp;
  gl.bindBuffer(gl.ARRAY_BUFFER, clmodel.cmds);
  gl.vertexAttribPointer(program.attributeMap.aPosition.location, 3, gl.FLOAT, false, 24, lerp.pose1ofs);
  gl.vertexAttribPointer(program.attributeMap.aNormal.location, 3, gl.FLOAT, false, 24, lerp.pose1ofs + 12);
  gl.vertexAttribPointer(program.attributeMap.aPosition2.location, 3, gl.FLOAT, false, 24, lerp.pose2ofs);
  gl.vertexAttribPointer(program.attributeMap.aNormal2.location, 3, gl.FLOAT, false, 24, lerp.pose2ofs + 12);
  gl.vertexAttribPointer(program.attributeMap.aTexCoord.location, 2, gl.FLOAT, false, 0, 0);
  gl.uniform1f(program.uniforms.uBlend, lerp.blend);

  if (clmodel.surfaces !== undefined) {
    // md3: each surface has its own external skin(s) and vertex range in the shared
    // pose VBO; draw them one at a time (drawArrays first/count offsets every attribute
    // uniformly, so the texcoord/pose pointers set above stay correct per surface).
    var sf, ssi;
    for (var s = 0; s < clmodel.surfaces.length; ++s) {
      sf = clmodel.surfaces[s];
      ssi = e.skinnum;
      if ((ssi < 0) || (ssi >= sf.skins.length))
        ssi = 0;
      tx.bind(program.textures.tTexture, sf.skins[ssi].texnum);
      gl.drawArrays(gl.TRIANGLES, sf.first, sf.count);
    }
  }
  else {
    var num, fullinterval, targettime, i;
    var time = cl.clState.time + e.syncbase;
    num = e.skinnum;
    if ((num >= clmodel.numskins) || (num < 0)) {
      con.dPrint('R.DrawAliasModel: no such skin # ' + num + '\n');
      num = 0;
    }
    var skin = clmodel.skins[num];
    if (skin.group === true) {
      num = skin.skins.length - 1;
      fullinterval = skin.skins[num].interval;
      targettime = time - Math.floor(time / fullinterval) * fullinterval;
      for (i = 0; i < num; ++i) {
        if (skin.skins[i].interval > targettime)
          break;
      }
      skin = skin.skins[i];
    }
    tx.bind(program.textures.tTexture, skin.texturenum.texnum);
    if ((e.colormap !== 0) && (clmodel.player === true) && (r.cvr.nocolors.value === 0))
      tx.bind(program.textures.tPlayer, skin.playertexture);

    gl.drawArrays(gl.TRIANGLES, 0, clmodel.numtris * 3);
  }

  if (entalpha < 1) {
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }
}

const drawEntitiesOnList = (alphaPass: boolean) => {
  const gl = GL.getContext()

  if (r.cvr.drawentities.value === 0)
    return;
  var i, ent, entalpha
  for (i = 0; i < cl.state.numvisedicts; ++i) {
    ent = cl.state.visedicts[i];
    entalpha = pr.decodeAlpha(ent.alpha);
    // johnfitz -- opaque entities in the first pass, translucent in the alpha pass
    if (ent.model == null || (entalpha === 1) === alphaPass)
      continue;
    switch (ent.model.type) {
      case mod.TYPE.alias:
        drawAliasModel(ent);
        continue;
      case mod.TYPE.brush:
        r.drawBrushModel(ent);
    }
  }

  if (!alphaPass) {
    GL.streamFlush();
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    for (i = 0; i < cl.state.numvisedicts; ++i) {
      ent = cl.state.visedicts[i];
      if (ent.model == null)
        continue;
      if (ent.model.type === mod.TYPE.sprite)
        drawSpriteModel(ent);
    }
    GL.streamFlush();
    gl.disable(gl.BLEND);
    gl.depthMask(true);
  }
}

// Body of r.drawViewModel. renderScene passes cl.clState.viewent as `ent`; the two original
// cl.clState.viewent references (model-null guard + drawAliasModel call) now read the param — the
// same object, so behavior is identical, and drawAliasModel's `e === cl.clState.viewent` viewmodel
// light-boost still matches. The depthRange squash + perspective narrowing stay byte-identical.
const drawViewModel = (ent: Entity) => {
  const gl = GL.getContext()
  if (sky.state.skyroom_drawing)
    return; // no viewmodel inside the skyroom (QSS r_alias.c:1124)
  if (r.cvr.drawviewmodel.value === 0)
    return;
  if (chase.cvr.active.value !== 0)
    return;
  if (r.cvr.drawentities.value === 0)
    return;
  if ((cl.clState.items & def.IT.invisibility) !== 0)
    return;
  if (cl.clState.stats[def.STAT.health] <= 0)
    return;
  if (ent.model == null)
    return;

  gl.depthRange(0.0, 0.3);

  var ymax = 4.0 * Math.tan(scr.cvr.fov.value * 0.82 * Math.PI / 360.0);
  r.state.perspective[0] = 4.0 / (ymax * r.state.refdef.vrect.width / r.state.refdef.vrect.height);
  r.state.perspective[5] = 4.0 / ymax;
  var program = GL.useProgram('Alias');
  gl.uniformMatrix4fv(program.uniforms.uPerspective, false, r.state.perspective);

  drawAliasModel(ent);

  ymax = 4.0 * Math.tan(r.state.refdef.fov_y * Math.PI / 360.0);
  r.state.perspective[0] = 4.0 / (ymax * r.state.refdef.vrect.width / r.state.refdef.vrect.height);
  r.state.perspective[5] = 4.0 / ymax;
  program = GL.useProgram('Alias');
  gl.uniformMatrix4fv(program.uniforms.uPerspective, false, r.state.perspective);

  gl.depthRange(0.0, 1.0);
}

// ─── particle + flashblend-dlight (effects) submission (moved verbatim from r.ts / pscript.ts, render phase1 slice) ───
// These module-private workers are the exact bodies of r.renderDlights, r.drawParticles (+ its
// drawParticlesStream WebGL1 fallback and the particleCoords corner table) and pscript.drawPScriptParticles
// (+ its drawBucket helper). Only reference remapping changed: the r.ts / pscript.ts module state, cvars and
// the backend-agnostic CPU particle sim/packing (r.runParticles, pscript.runPScriptParticles,
// pscript.fillInstanceBuffers) stay single-sourced there and are reached through r.* / pscript.*. No draw
// order, gl state, instancing, blend-bucket or divisor logic changed.

const drawFlashblendDlights = () => {
  const gl = GL.getContext()
  if (r.cvr.flashblend.value === 0)
    return;
  gl.enable(gl.BLEND);
  var program = GL.useProgram('Dlight'), l, a;
  gl.bindBuffer(gl.ARRAY_BUFFER, r.state.dlightvecs);
  gl.vertexAttribPointer(program.attributeMap.aPosition.location, 3, gl.FLOAT, false, 0, 0); // TODO: is this fixed now?
  for (var i = 0; i <= 31; ++i) {
    l = cl.state.dlights[i];
    if ((l.die < cl.clState.time) || (l.radius === 0.0))
      continue;
    if (vec.length([l.origin[0] - r.state.refdef.vieworg[0], l.origin[1] - r.state.refdef.vieworg[1], l.origin[2] - r.state.refdef.vieworg[2]]) < (l.radius * 0.35)) {
      a = l.radius * 0.0003;
      v.blend[3] += a * (1.0 - v.blend[3]);
      a /= v.blend[3];
      v.blend[0] = v.blend[1] * (1.0 - a) + (255.0 * a);
      v.blend[1] = v.blend[1] * (1.0 - a) + (127.5 * a);
      v.blend[2] *= 1.0 - a;
      continue;
    }
    gl.uniform3fv(program.uniforms.uOrigin, l.origin);
    gl.uniform1f(program.uniforms.uRadius, l.radius);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 18);
  }
  gl.disable(gl.BLEND);
}

// Quad corners as two CCW triangles, matching the instanced TRIANGLE_STRIP coverage.
const particleCoords = [-1.0, -1.0, -1.0, 1.0, 1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0];

// Streams two triangles per particle through the shared stream buffer using the same Particle program
// (aCorner/aOrigin/aColor per vertex). Only used when instancing is unavailable (WebGL1 without
// ANGLE_instanced_arrays).
const drawParticlesStream = () => {
  const gl = GL.getContext()
  GL.streamFlush();
  GL.useProgram('Particle');
  gl.depthMask(false);
  gl.enable(gl.BLEND);
  var coords = particleCoords;
  for (var i = 0; i < r.state.numActiveParticles; ++i) {
    var i3 = i * 3;
    var ox = r.state.particleOrg[i3], oy = r.state.particleOrg[i3 + 1], oz = r.state.particleOrg[i3 + 2];
    var color = vid.d_8to24table[r.state.particleColor[i]];
    var cr = color & 0xff, cg = (color >> 8) & 0xff, cb = color >> 16;
    GL.streamGetSpace(6);
    for (var j = 0; j < 6; ++j) {
      GL.streamWriteFloat2(coords[j * 2], coords[j * 2 + 1]);
      GL.streamWriteFloat3(ox, oy, oz);
      GL.streamWriteUByte4(cr, cg, cb, 255);
    }
  }
  GL.streamFlush();
  gl.disable(gl.BLEND);
  gl.depthMask(true);
}

const drawClassicParticles = () => {
  if (r.state.numActiveParticles === 0)
    return;

  if (GL.state.instancingSupported !== true) {
    drawParticlesStream();
    return;
  }

  const gl = GL.getContext()
  GL.streamFlush();

  var program = GL.useProgram('Particle');
  gl.depthMask(false);
  gl.enable(gl.BLEND);

  var floats = r.state.particleInstanceFloats;
  var bytes = r.state.particleInstanceBytes;
  for (var i = 0; i < r.state.numActiveParticles; ++i) {
    var fBase = i * 4, bBase = i * 16, i3 = i * 3;
    floats[fBase] = r.state.particleOrg[i3];
    floats[fBase + 1] = r.state.particleOrg[i3 + 1];
    floats[fBase + 2] = r.state.particleOrg[i3 + 2];
    var color = vid.d_8to24table[r.state.particleColor[i]];
    bytes[bBase + 12] = color & 0xff;
    bytes[bBase + 13] = (color >> 8) & 0xff;
    bytes[bBase + 14] = color >> 16;
    bytes[bBase + 15] = 255;
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, r.state.particleInstanceBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, r.state.particleInstanceData.byteLength, gl.DYNAMIC_DRAW);
  // WebGL2's 5-arg overload uploads a prefix without allocating a subarray
  // view; the view fallback only runs on WebGL1-with-ANGLE contexts.
  if (GL.state.isWebGL2)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, bytes, 0, r.state.numActiveParticles * 16);
  else
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, bytes.subarray(0, r.state.numActiveParticles * 16));

  var aCorner = program.attributeMap.aCorner;
  var aOrigin = program.attributeMap.aOrigin;
  var aColor = program.attributeMap.aColor;

  gl.bindBuffer(gl.ARRAY_BUFFER, r.state.particleCornerBuffer);
  gl.vertexAttribPointer(aCorner.location, 2, gl.FLOAT, false, 0, 0);
  GL.state.vertexAttribDivisor(aCorner.location, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, r.state.particleInstanceBuffer);
  gl.vertexAttribPointer(aOrigin.location, 3, gl.FLOAT, false, 16, 0);
  gl.vertexAttribPointer(aColor.location, 4, gl.UNSIGNED_BYTE, true, 16, 12);
  GL.state.vertexAttribDivisor(aOrigin.location, 1);
  GL.state.vertexAttribDivisor(aColor.location, 1);

  GL.state.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, r.state.numActiveParticles);

  GL.state.vertexAttribDivisor(aOrigin.location, 0);
  GL.state.vertexAttribDivisor(aColor.location, 0);

  gl.disable(gl.BLEND);
  gl.depthMask(true);
}

// Uploads one bucket's instance data and issues its instanced draw call. Attribute divisors are reset to 0
// afterward so the next bucket (or the next program entirely) doesn't inherit per-instance stepping on
// shared attribute locations. Exact body of pscript.drawBucket, reading pscript.state / pscript.INSTANCE_STRIDE.
const drawBucket = (gl: WebGL2RenderingContext, program: GL.GLProgram, bucket: number, src: number, dst: number) => {
  const count = pscript.state.instanceCounts[bucket]
  if (count === 0) return
  gl.blendFunc(src, dst)

  gl.bindBuffer(gl.ARRAY_BUFFER, pscript.state.instanceBuffers[bucket])
  const bytes = pscript.state.instanceBytes[bucket]
  if (GL.state.isWebGL2)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, bytes, 0, count * pscript.INSTANCE_STRIDE)
  else
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, bytes.subarray(0, count * pscript.INSTANCE_STRIDE))

  const a = program.attributeMap
  gl.vertexAttribPointer(a.aOrigin.location, 3, gl.FLOAT, false, pscript.INSTANCE_STRIDE, 0)
  gl.vertexAttribPointer(a.aVelocity.location, 3, gl.FLOAT, false, pscript.INSTANCE_STRIDE, 12)
  gl.vertexAttribPointer(a.aSize.location, 1, gl.FLOAT, false, pscript.INSTANCE_STRIDE, 24)
  gl.vertexAttribPointer(a.aRotation.location, 1, gl.FLOAT, false, pscript.INSTANCE_STRIDE, 28)
  gl.vertexAttribPointer(a.aUV.location, 4, gl.FLOAT, false, pscript.INSTANCE_STRIDE, 32)
  gl.vertexAttribPointer(a.aOrientation.location, 1, gl.FLOAT, false, pscript.INSTANCE_STRIDE, 48)
  gl.vertexAttribPointer(a.aColor.location, 4, gl.UNSIGNED_BYTE, true, pscript.INSTANCE_STRIDE, 52)

  GL.state.vertexAttribDivisor(a.aOrigin.location, 1)
  GL.state.vertexAttribDivisor(a.aVelocity.location, 1)
  GL.state.vertexAttribDivisor(a.aSize.location, 1)
  GL.state.vertexAttribDivisor(a.aRotation.location, 1)
  GL.state.vertexAttribDivisor(a.aUV.location, 1)
  GL.state.vertexAttribDivisor(a.aOrientation.location, 1)
  GL.state.vertexAttribDivisor(a.aColor.location, 1)

  GL.state.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count)

  GL.state.vertexAttribDivisor(a.aOrigin.location, 0)
  GL.state.vertexAttribDivisor(a.aVelocity.location, 0)
  GL.state.vertexAttribDivisor(a.aSize.location, 0)
  GL.state.vertexAttribDivisor(a.aRotation.location, 0)
  GL.state.vertexAttribDivisor(a.aUV.location, 0)
  GL.state.vertexAttribDivisor(a.aOrientation.location, 0)
  GL.state.vertexAttribDivisor(a.aColor.location, 0)
}

// Instanced quads (camera-facing billboards, velocity-stretched spark/beam, flat velocity-normal oriented),
// one draw call per blend bucket (alpha/add/invmod). Sort is not required, matching QSS-M's default.
// Exact body of pscript.drawPScriptParticles; the CPU packing (pscript.fillInstanceBuffers) stays in pscript.
const drawScriptParticles = () => {
  if (pscript.cvr.fteparticles.value === 0) return
  if (pscript.state.pNumActive === 0) return
  if (pscript.state.atlasTexture == null) return
  if (GL.state.instancingSupported !== true) return  // no WebGL1-stream fallback this phase

  const gl = GL.getContext()
  GL.streamFlush()
  const program = GL.useProgram('PScript')
  if (program == null) return

  gl.uniform3fv(program.uniforms.uVright, r.state.vright)
  gl.uniform3fv(program.uniforms.uVup, r.state.vup)
  // world half-width of one screen pixel at distance 1 (sparks clamp to >=1px wide)
  gl.uniform1f(program.uniforms.uPixelWidth,
    Math.tan(r.state.refdef.fov_y * Math.PI / 360) / Math.max(1, r.state.refdef.vrect.height))
  tx.bind(program.textures.tTexture, pscript.state.atlasTexture, true)

  pscript.fillInstanceBuffers()

  gl.bindBuffer(gl.ARRAY_BUFFER, pscript.state.cornerBuffer)
  gl.vertexAttribPointer(program.attributeMap.aCorner.location, 2, gl.FLOAT, false, 0, 0)
  GL.state.vertexAttribDivisor(program.attributeMap.aCorner.location, 0)

  gl.depthMask(false)
  gl.enable(gl.BLEND)

  drawBucket(gl, program, pscript.BLEND_ALPHA, gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  drawBucket(gl, program, pscript.BLEND_ADD, gl.SRC_ALPHA, gl.ONE)
  drawBucket(gl, program, pscript.BLEND_INVMOD, gl.ZERO, gl.ONE_MINUS_SRC_COLOR)

  // GL.ts sets (SRC_ALPHA, ONE_MINUS_SRC_ALPHA) once at context init as the app-wide
  // ambient blend func; classic drawParticles/GL.set2D lean on that default without
  // setting it themselves. Restore it so the add/invmod buckets above don't leak a
  // different func into whatever draws next (2D UI, next frame's alpha-blended geometry).
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  gl.disable(gl.BLEND)
  gl.depthMask(true)
}

export class WebGLRenderer implements IRenderer {
  readonly backend = 'webgl2' as const

  async init(_canvas: HTMLCanvasElement): Promise<void> { NOT_EXTRACTED('init') }
  resize(_width: number, _height: number): void { NOT_EXTRACTED('resize') }

  // ← r.init's WebGL resource creation (phase5): the index batcher, the eight 3D shader programs, the
  // underwater warp FBO (+ depth renderbuffer), and the flashblend dlight geometry VBO. Moved verbatim;
  // only state.* → r.state.* and createAttribParam → GL.createAttribParam. The cvar/command registration
  // and the texture/particle/sky factory setup stay in r.init (shared / retained-for-WebGPU). r.state
  // keeps ownership of warp*/dlightvecs (backend resource handles, read by beginScene/drawTextureChains).
  initResources(): void {
    const gl = GL.getContext()
    batchRender.init(gl)

    GL.createProgram('Alias',
      ['uOrigin', 'uAngles', 'uViewOrigin', 'uViewAngles', 'uPerspective', 'uLightVec', 'uGamma', 'uAmbientLight', 'uShadeLight', 'uUseOverbright', 'uUseFullbrights', 'uBlend', 'uAlpha', 'uFogDensity', 'uFogColor'],
      [
        GL.createAttribParam('aPosition', gl.FLOAT, 3),
        GL.createAttribParam('aNormal', gl.FLOAT, 3),
        GL.createAttribParam('aTexCoord', gl.FLOAT, 2),
        GL.createAttribParam('aPosition2', gl.FLOAT, 3),
        GL.createAttribParam('aNormal2', gl.FLOAT, 3)
      ],
      ['tTexture']);

    GL.createProgram(
      'Brush',
      ['uUseFullbrightTex', 'uUseOverbright', 'uUseAlphaTest',
        'uAlpha', 'uPerspective', 'uViewAngles', 'uViewOrigin',
        'uOrigin', 'uAngles', 'uFogDensity', 'uFogColor', 'uGamma',
        'uLightStyles[0]', 'uNumDlights', 'uDlightPosRadius[0]', 'uDlightColor[0]',
        'uWarp', 'uTime'],
      [
        GL.createAttribParam('Vert', gl.FLOAT, 3, false),
        GL.createAttribParam('TexCoords', gl.FLOAT, 2, false),
        GL.createAttribParam('LMCoords', gl.FLOAT, 2, false),
        GL.createAttribParam('LMStyles', gl.FLOAT, 4, false),
      ],
      ['Tex', 'LMTex0', 'FullbrightTex', 'LMTex1', 'LMTex2', 'LMTex3'])
    GL.createProgram('Dlight',
      ['uOrigin', 'uViewOrigin', 'uViewAngles', 'uPerspective', 'uRadius', 'uGamma'],
      [
        GL.createAttribParam('aPosition', gl.FLOAT, 3)
      ],
      []);
    GL.createProgram('Player',
      ['uOrigin', 'uAngles', 'uViewOrigin', 'uViewAngles', 'uPerspective', 'uLightVec', 'uGamma', 'uAmbientLight', 'uShadeLight', 'uUseOverbright', 'uUseFullbrights', 'uTop', 'uBottom', 'uBlend', 'uAlpha', 'uFogDensity', 'uFogColor'],
      [
        GL.createAttribParam('aPosition', gl.FLOAT, 3),
        GL.createAttribParam('aNormal', gl.FLOAT, 3),
        GL.createAttribParam('aTexCoord', gl.FLOAT, 2),
        GL.createAttribParam('aPosition2', gl.FLOAT, 3),
        GL.createAttribParam('aNormal2', gl.FLOAT, 3)
      ],
      ['tTexture', 'tPlayer']);
    GL.createProgram('Sprite',
      ['uViewOrigin', 'uViewAngles', 'uPerspective', 'uGamma', 'uFogDensity', 'uFogColor'],
      [
        GL.createAttribParam('aPosition', gl.FLOAT, 3),
        GL.createAttribParam('aTexCoord', gl.FLOAT, 2)
      ],
      ['tTexture']);
    GL.createProgram('Turbulent',
      ['uOrigin', 'uAngles', 'uViewOrigin', 'uViewAngles', 'uPerspective', 'uGamma', 'uTime', 'uAlpha', 'uFogDensity', 'uFogColor'],
      [
        GL.createAttribParam('aPosition', gl.FLOAT, 3),
        GL.createAttribParam('aTexCoord', gl.FLOAT, 2)
      ],
      ['tTexture']);
    GL.createProgram('Warp',
      ['uOrtho', 'uTime'],
      [
        GL.createAttribParam('aPosition', gl.FLOAT, 2),
        GL.createAttribParam('aTexCoord', gl.FLOAT, 2)
      ],
      ['tTexture']);
    GL.createProgram('PScript',
      ['uViewOrigin', 'uViewAngles', 'uPerspective', 'uGamma', 'uVright', 'uVup', 'uPixelWidth'],
      [
        GL.createAttribParam('aCorner', gl.FLOAT, 2),
        GL.createAttribParam('aOrigin', gl.FLOAT, 3),
        GL.createAttribParam('aVelocity', gl.FLOAT, 3),
        GL.createAttribParam('aSize', gl.FLOAT, 1),
        GL.createAttribParam('aRotation', gl.FLOAT, 1),
        GL.createAttribParam('aUV', gl.FLOAT, 4),
        GL.createAttribParam('aOrientation', gl.FLOAT, 1),
        GL.createAttribParam('aColor', gl.UNSIGNED_BYTE, 4, true)
      ],
      ['tTexture']);

    r.state.warpbuffer = gl.createFramebuffer();
    r.state.warptexture = gl.createTexture();
    tx.bind(0, r.state.warptexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // WEBGL_depth_stencil is universally supported on Android (Adreno/Mali) and
    // produces a complete FBO when combined with an RGBA colour texture, whereas
    // DEPTH_COMPONENT16 silently produces an incomplete FBO on many mobile GPUs.
    const depthStencilExt = gl.getExtension('WEBGL_depth_stencil');
    r.state.warpDepthFormat     = depthStencilExt ? (gl as any).DEPTH_STENCIL           : gl.DEPTH_COMPONENT16;
    r.state.warpDepthAttachment = depthStencilExt ? (gl as any).DEPTH_STENCIL_ATTACHMENT : gl.DEPTH_ATTACHMENT;
    r.state.warpSupported = true;
    r.state.oldwarpwidth = 0;
    r.state.oldwarpheight = 0;
    r.state.warprenderbuffer = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, r.state.warprenderbuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, r.state.warpDepthFormat, 0, 0);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, r.state.warpbuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, r.state.warptexture, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, r.state.warpDepthAttachment, gl.RENDERBUFFER, r.state.warprenderbuffer);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    r.state.dlightvecs = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, r.state.dlightvecs);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      0.0, -1.0, 0.0,
      0.0, 0.0, 1.0,
      -0.382683, 0.0, 0.92388,
      -0.707107, 0.0, 0.707107,
      -0.92388, 0.0, 0.382683,
      -1.0, 0.0, 0.0,
      -0.92388, 0.0, -0.382683,
      -0.707107, 0.0, -0.707107,
      -0.382683, 0.0, -0.92388,
      0.0, 0.0, -1.0,
      0.382683, 0.0, -0.92388,
      0.707107, 0.0, -0.707107,
      0.92388, 0.0, -0.382683,
      1.0, 0.0, 0.0,
      0.92388, 0.0, 0.382683,
      0.707107, 0.0, 0.707107,
      0.382683, 0.0, 0.92388,
      0.0, 0.0, 1.0
    ]), gl.STATIC_DRAW);
  }

  // ← scr.calcRefdef's warp-FBO resize (phase5): reallocate the warp color texture + depth renderbuffer
  // to r.state.warpwidth/warpheight when they change, and re-check FBO completeness (a bad 0×0 first frame
  // must not permanently disable warp). warpwidth/warpheight are still computed in scr.calcRefdef (beginScene
  // reads them for the warp viewport); only this GL reallocation moved here.
  resizeWarp(): void {
    if ((r.state.oldwarpwidth === r.state.warpwidth) && (r.state.oldwarpheight === r.state.warpheight))
      return
    const gl = GL.getContext()
    r.state.oldwarpwidth = r.state.warpwidth
    r.state.oldwarpheight = r.state.warpheight
    tx.bind(0, r.state.warptexture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, r.state.warpwidth, r.state.warpheight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.bindRenderbuffer(gl.RENDERBUFFER, r.state.warprenderbuffer)
    gl.renderbufferStorage(gl.RENDERBUFFER, r.state.warpDepthFormat, r.state.warpwidth, r.state.warpheight)
    gl.bindRenderbuffer(gl.RENDERBUFFER, null)
    // Verify the FBO is complete now that it has real dimensions.
    gl.bindFramebuffer(gl.FRAMEBUFFER, r.state.warpbuffer)
    const warpStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER)
    r.state.warpSupported = (warpStatus === gl.FRAMEBUFFER_COMPLETE)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  // ← GL.streamBeginFrame(). `globals` (view basis / perspective / gamma broadcast) is ignored
  // for now; that broadcast still runs inside beginScene via r.perspective(). TODO(phase1): move
  // the perspective() uniform push here and consume FrameGlobals.
  beginFrame(_globals?: FrameGlobals): void {
    GL.streamBeginFrame()
  }

  // ← GL.streamFlush() + the gl.disable(BLEND) that followed it in scr.updateScreen.
  endFrame(): void {
    GL.streamFlush()
    const gl = GL.getContext()
    gl.disable(gl.BLEND)
  }

  // ← scr.updateScreen's gl.finish() before a screenshot's toDataURL read.
  finishFrame(): void {
    GL.getContext().finish()
  }

  // WebGL2 has no GPU compute cull — the CPU markSurfaces/markWorldFrustum walk always runs.
  gpuCullActive(): boolean { return false }

  // ← r.renderView's gl.clear calls (phase4): the main frame clear (color+depth) before the scene, and
  // the skyroom depth-reset (depth only) between the skyroom and main passes.
  clearFrame(color: boolean, depth: boolean): void {
    const gl = GL.getContext()
    var bits = 0
    if (color) bits |= gl.COLOR_BUFFER_BIT
    if (depth) bits |= gl.DEPTH_BUFFER_BIT
    if (bits !== 0)
      gl.clear(bits)
  }

  // ← the body of r.setupGL: warp-FBO redirect when scene.dowarp, else the view-rect viewport,
  // the per-program view/perspective broadcast (local perspective(), phase3), and depth-test enable.
  // The warp render target and its dimensions stay owned by r.state (backend resource, not yet extracted).
  beginScene(scene: SceneSetup, _globals?: FrameGlobals): void {
    const gl = GL.getContext()
    if (scene.dowarp === true) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, r.state.warpbuffer)
      gl.clear(gl.COLOR_BUFFER_BIT + gl.DEPTH_BUFFER_BIT)
      gl.viewport(0, 0, r.state.warpwidth, r.state.warpheight)
    }
    else {
      const pixelRatio = scr.state.devicePixelRatio
      gl.viewport((scene.x * pixelRatio) >> 0, ((vid.state.height - scene.height - scene.y) * pixelRatio) >> 0, (scene.width * pixelRatio) >> 0, (scene.height * pixelRatio) >> 0)
    }
    perspective()
    gl.enable(gl.DEPTH_TEST)
  }

  // ← the body of r.drawSkyBox (all three sub-paths). `faces` is unused: the classic/cubemap/skyroom
  // paths read the sky chains + visibility stamp straight off cl.clState.worldmodel and r.state, as
  // the original did. The dowarp/state.drawsky guards stay inside.
  drawSky(_faces?: FaceVis): void {
    // Enable back-face culling for the whole opaque world/entity group that follows in renderScene
    // (was r.renderScene's gl.enable(CULL_FACE), phase4). Must run BEFORE drawSkyBox's drawsky
    // early-return, or a map with no sky would draw the world unceulled.
    const gl = GL.getContext()
    gl.enable(gl.CULL_FACE)
    drawSkyBox()
  }

  // ← the body of r.drawViewModel (viewmodel alias draw with the depthRange 0..0.3 squash and the
  // narrowed FOV perspective push/restore). renderScene passes cl.clState.viewent.
  drawViewModel(ent: Entity): void {
    drawViewModel(ent)
  }

  // ← the bodies of r.drawTextureChains{,_litwater,_water}. `pass` picks the worker; the world/model
  // chain is derived from ent (null ⇒ world, else model) exactly as the two original call sites split
  // it. `faces` is unused: each worker reads model.worldChain*/surfVisibleFrame + r.state.frustumFrame
  // directly, identical to the originals.
  drawWorldSurfaces(model: Model, ent: Entity | null, pass: SurfacePass, _faces?: FaceVis): void {
    const gl = GL.getContext()
    const chain = ent === null ? TexChain.world : TexChain.model
    if (pass === 'solid')
      drawTextureChains(gl, model, ent, chain)
    else if (pass === 'litwater')
      drawTextureChains_litwater(gl, model, ent, chain)
    else
      drawTextureChains_water(gl, model, ent, chain)
  }

  // Opaque brush-entity fast path (r.drawBrushModel gates on model.brushPrecomputeEligible + alpha==1):
  // draw the submodel from a lazily-built static index buffer, one drawElements per (texture, fence,
  // lightmap page) group, skipping the per-frame per-face backface walk + re-chain + batchRender copy.
  // Draws every drawable face; GL back-face culling (enabled in drawSky, correct winding since the
  // world renders with it) removes the back-facing triangles the per-face loop would have plane-culled →
  // image-identical for closed opaque models. Uniform/transform/attrib setup mirrors drawTextureChains'
  // solid pass exactly (entalpha fixed at 1).
  // The instanced brush-entity batch is WebGPU-only (it needs a storage-buffer transform array indexed
  // by instance_index); WebGL keeps the precompute + chain paths.
  batchBrushEnt(_ent: Entity): boolean { return false }

  drawBrushEntPrecomputed(ent: Entity): void {
    const gl = GL.getContext()
    const model = ent.model

    // Lazy build + map-change invalidation: the static index buffer references the world VBO, so a new
    // map (fresh model_vbo) means the cached buffer's indices are stale → drop it and rebuild.
    var pc = model.brushPrecomputeGL
    if (pc != null && pc.worldVbo !== r.state.model_vbo) {
      gl.deleteBuffer(pc.buffer)
      pc = model.brushPrecomputeGL = null
    }
    if (pc === undefined || pc === null) {
      pc = buildBrushPrecomputeGL(gl, model)
      model.brushPrecomputeGL = pc
      if (pc === null)
        return
    }

    const brushProgram = GL.useProgram('Brush')
    const fogColor = fog.getColor()
    const fogDensity = fog.getDensity()

    gl.bindBuffer(gl.ARRAY_BUFFER, r.state.model_vbo)
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, pc.buffer)
    gl.vertexAttribPointer(brushProgram.attributeMap.Vert.location, 3, gl.FLOAT, false, def.VERTEXSIZE * 4, 0)
    gl.vertexAttribPointer(brushProgram.attributeMap.TexCoords.location, 2, gl.FLOAT, false, def.VERTEXSIZE * 4, 4 * 3)
    gl.vertexAttribPointer(brushProgram.attributeMap.LMCoords.location, 2, gl.FLOAT, false, def.VERTEXSIZE * 4, 4 * 5)
    gl.vertexAttribPointer(brushProgram.attributeMap.LMStyles.location, 4, gl.FLOAT, false, def.VERTEXSIZE * 4, 4 * 7)

    // Lightstyle weights: upload only on a style change (same 10Hz gate as drawTextureChains).
    if (lm.state.lightstyle_uniform_dirty) {
      const stylesUniform = lm.state.lightstyle_uniform
      for (var j = 0; j < lm.MAX_LIGHTSTYLES; j++)
        stylesUniform[j] = lm.state.lightstylevalue[j] / 128.0
      stylesUniform[64] = 0.0
      gl.uniform1fv(brushProgram.uniforms['uLightStyles[0]'], stylesUniform)
      lm.state.lightstyle_uniform_dirty = false
    }

    gl.uniform1i(brushProgram.uniforms.uUseFullbrightTex, 0)
    gl.uniform1i(brushProgram.uniforms.uUseOverbright, r.cvr.overbright.value)
    gl.uniform1i(brushProgram.uniforms.uUseAlphaTest, 0)
    gl.uniform1i(brushProgram.uniforms.uWarp, 0)
    gl.uniform1f(brushProgram.uniforms.uAlpha, 1.0)
    gl.uniform1f(brushProgram.uniforms.uFogDensity, fogDensity / 64)
    gl.uniform4f(brushProgram.uniforms.uFogColor, fogColor[0], fogColor[1], fogColor[2], fogColor[3])

    if (r.state.dlightUniformFrame !== r.state.framecount) {
      r.state.dlightUniformFrame = r.state.framecount
      gl.uniform1i(brushProgram.uniforms.uNumDlights, r.state.numShaderDlights)
      gl.uniform4fv(brushProgram.uniforms['uDlightPosRadius[0]'], r.state.dlightPosRadius)
      gl.uniform4fv(brushProgram.uniforms['uDlightColor[0]'], r.state.dlightColor)
    }

    const viewMatrix = GL.rotationMatrix(ent.angles[0], ent.angles[1], ent.angles[2])
    gl.uniform3fv(brushProgram.uniforms.uOrigin, ent.origin)
    gl.uniformMatrix3fv(brushProgram.uniforms.uAngles, false, viewMatrix)

    const slots = pc.slots, textures = model.textures
    var alphaTestOn = false
    for (var s = 0; s < slots.length; s++) {
      const slot = slots[s]
      const t = textures[slot.textureIndex]
      if (!t)
        continue
      const animated = r.textureAnimation(model, t, ent.frame)
      tx.bind(0, animated.texturenum)
      bindFullbrightTexture(gl, brushProgram, animated)
      if (slot.isFence !== alphaTestOn) {
        gl.uniform1i(brushProgram.uniforms.uUseAlphaTest, slot.isFence ? 1 : 0)
        alphaTestOn = slot.isFence
      }
      bindLightmapPageTextures(gl, slot.lmpage)
      gl.drawElements(gl.TRIANGLES, slot.count, gl.UNSIGNED_INT, slot.first * 4)
    }
    if (alphaTestOn)
      gl.uniform1i(brushProgram.uniforms.uUseAlphaTest, 0)

    GL.unbindProgram()
  }

  // ← the body of r.drawEntitiesOnList: the visedict loop (opaque/alpha filter + alias/brush type
  // switch) then, on the opaque pass only, the separate sprite sub-pass bracketed by streamFlush +
  // BLEND/depthMask toggles. Brush-type entities dispatch back to r.drawBrushModel (unchanged).
  drawEntities(alphaPass: boolean): void {
    drawEntitiesOnList(alphaPass)
  }
  // ← the body of r.renderDlights: the flashblend glow-ball fan (Dlight program, TRIANGLE_FAN per
  // light) plus the near-light v.blend accumulation and the BLEND enable/disable bracket. gl_flashblend
  // gate stays inside. The CPU dlight gather (r.gatherDlights) is unchanged and stays in r.ts.
  drawFlashblendDlights(): void {
    // Close the back-face-culling bracket opened in drawSky before the billboarded flashblend/particle
    // draws that follow (was r.renderScene's gl.disable(CULL_FACE), phase4).
    const gl = GL.getContext()
    gl.disable(gl.CULL_FACE)
    drawFlashblendDlights()
  }
  // ← the body of r.drawParticles (instanced path: particleCornerBuffer + particleInstanceBuffer
  // orphan/subData, divisor set/reset, drawArraysInstanced) and its drawParticlesStream WebGL1 fallback,
  // selected by GL.state.instancingSupported. The particle sim/pool (r.runParticles) is unchanged in r.ts.
  drawClassicParticles(): void {
    drawClassicParticles()
  }
  // ← the body of pscript.drawPScriptParticles: the 3 blend-bucket instanced draws (per-bucket blendFunc,
  // 56B-stride instance attribs + divisors via drawBucket) then the app-wide SRC_ALPHA/ONE_MINUS_SRC_ALPHA
  // restore. The instance packing (pscript.fillInstanceBuffers) and sim (pscript.runPScriptParticles) stay
  // single-sourced in pscript.ts.
  drawScriptParticles(): void {
    drawScriptParticles()
  }

  // ← the body of r.warpScreen: resolve the underwater warp render target with the distortion
  // blit to the default framebuffer. Call site keeps the `dowarp` guard.
  endScene(): void {
    const gl = GL.getContext()
    GL.streamFlush()
    gl.flush() // ensure all FBO commands reach the GPU before switching framebuffers
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindRenderbuffer(gl.RENDERBUFFER, null)
    // The warp quad is a fullscreen 2D blit — depth testing is irrelevant and can
    // silently discard the quad on some Android drivers if the depth buffer holds
    // stale values from a previous frame.
    gl.disable(gl.DEPTH_TEST)
    const program = GL.useProgram('Warp')
    tx.bind(program.textures.tTexture, r.state.warptexture)
    gl.uniform1f(program.uniforms.uTime, host.state.realtime % (Math.PI * 2.0))
    const vrect = r.state.refdef.vrect
    GL.streamDrawTexturedQuad(vrect.x, vrect.y, vrect.width, vrect.height, 0.0, 1.0, 1.0, 0.0)
    GL.streamFlush()
  }

  // ← GL.set2D(). `ortho` is ignored for now (set2D uses GL's own ortho matrix).
  // TODO(phase1): pass the ortho matrix through instead of reaching GL's module const.
  begin2D(_ortho?: Float32Array): void {
    GL.set2D()
  }

  // ← the body of r.polyBlend. `rgba` is the persistent v.blend array (number[]); the gl_polyblend
  // cvar gate and the view rect stay read from r.ts state.
  polyBlend(rgba: number[]): void {
    if (r.cvr.polyblend.value === 0)
      return
    if (rgba[3] === 0.0)
      return
    GL.useProgram('Fill', true)
    const vrect = r.state.refdef.vrect
    GL.streamDrawColoredQuad(vrect.x, vrect.y, vrect.width, vrect.height,
      rgba[0], rgba[1], rgba[2], rgba[3] * 255.0)
  }

  // ─── 2D / HUD primitive submission (moved verbatim from draw.ts, render phase2 slice) ───
  // Each method holds the exact gl-submission body of its draw.ts counterpart; only the char-atlas
  // UV math (now in draw.char) and string iteration (draw.string/stringWhite) stayed behind, plus the
  // char_texture/conback CREATION in draw.init. draw.state.char_texture/conback are read here the same
  // way the originals reached their module state; no program, texture, uniform, or stream-quad changed.

  // ← the body of draw.character (useProgram Pic + tx.bind char_texture) + draw.char's streamDrawTexturedQuad,
  // with the glyph UVs computed by the caller (draw.char). Repeated binds in the string loops are the same
  // cached no-ops the original single up-front bind relied on, so flush timing is identical.
  drawCharacter(x: number, y: number, size: number, u1: number, v1: number, u2: number, v2: number): void {
    const program = GL.useProgram('Pic', true)
    tx.bind(program.textures.tTexture, draw.state.char_texture, true)
    GL.streamDrawTexturedQuad(x, y, size, size, u1, v1, u2, v2)
  }

  // ← the body of draw.pic.
  drawPic(x: number, y: number, pic: tx.Pic, scale = 1): void {
    const program = GL.useProgram('Pic', true)
    tx.bind(program.textures.tTexture, pic.texnum, true)
    GL.streamDrawTexturedQuad(x, y, pic.width * scale, pic.height * scale, 0.0, 0.0, 1.0, 1.0)
  }

  // ← the body of draw.picTranslate (PicTranslate program + tTexture/tTrans binds + uTop/uBottom
  // palette-scaled uniforms, bracketed by streamFlush).
  drawPicTranslate(x: number, y: number, pic: tx.Pic, top: number, bottom: number, scale = 1): void {
    const gl = GL.getContext()
    GL.streamFlush()
    const program = GL.useProgram('PicTranslate')
    tx.bind(program.textures.tTexture, pic.texnum)
    tx.bind(program.textures.tTrans, pic.translate)

    var p = vid.d_8to24table[top]
    var _scale = 1.0 / 191.25
    gl.uniform3f(program.uniforms.uTop, (p & 0xff) * _scale, ((p >> 8) & 0xff) * _scale, (p >> 16) * _scale)
    p = vid.d_8to24table[bottom]
    gl.uniform3f(program.uniforms.uBottom, (p & 0xff) * _scale, ((p >> 8) & 0xff) * _scale, (p >> 16) * _scale)

    GL.streamDrawTexturedQuad(x, y, pic.width * scale, pic.height * scale, 0.0, 0.0, 1.0, 1.0)

    GL.streamFlush()
  }

  // ← the body of draw.consoleBackground.
  drawConsoleBackground(lines: number): void {
    const program = GL.useProgram('Pic', true)
    tx.bind(program.textures.tTexture, draw.state.conback.texnum, true)
    GL.streamDrawTexturedQuad(0, lines - vid.state.height, vid.state.width, vid.state.height, 0.0, 0.0, 1.0, 1.0)
  }

  // ← the body of draw.fill (palette index → rgba + Fill program colored quad).
  drawFill(x: number, y: number, w: number, h: number, c: number): void {
    GL.useProgram('Fill', true)
    var color = vid.d_8to24table[c]
    GL.streamDrawColoredQuad(x, y, w, h, color & 0xff, (color >> 8) & 0xff, color >> 16, 255)
  }

  // ← the body of draw.fadeScreen (full-screen translucent black Fill quad).
  fadeScreen(): void {
    GL.useProgram('Fill', true)
    GL.streamDrawColoredQuad(0, 0, vid.state.width, vid.state.height, 0, 0, 0, 204)
  }

  createTexture(_desc: unknown): RTexture { return NOT_EXTRACTED('createTexture') }
  createStaticBuffer(_data: ArrayBufferView): RBuffer { return NOT_EXTRACTED('createStaticBuffer') }
  createDynamicBuffer(_byteLength: number): RBuffer { return NOT_EXTRACTED('createDynamicBuffer') }
}
