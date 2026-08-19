/**
 * File: gl_mesh.ts
 * Source: Quake II original / ref_gl/gl_mesh.c
 * Purpose: Port alias-model shading and helper logic from the original GL mesh renderer.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Exposes pure helper functions so the adapter-driven renderer can consume original behavior explicitly.
 *
 * Notes:
 * - This file is the principal attachment point for `ref_gl/gl_mesh.c` in the current renderer-three tranche.
 */

import {
  AngleVectors,
  DotProduct,
  RDF_IRGOGGLES,
  RF_FULLBRIGHT,
  RF_GLOW,
  RF_IR_VISIBLE,
  RF_MINLIGHT,
  RF_SHELL_BLUE,
  RF_SHELL_DOUBLE,
  RF_SHELL_GREEN,
  RF_SHELL_HALF_DAM,
  RF_SHELL_RED,
  VectorNormalize,
  type cplane_t,
  type vec3_t
} from "../../qcommon/src/index.js";
import { SHADEDOT_QUANT, getAliasShadedots } from "./anormtab.js";
import type { Md2Model } from "../../formats/src/index.js";

export const NUMVERTEXNORMALS = 162;
/**
 * Original name: N/A
 * Source: N/A (local RF_GLOW tuning constant)
 * Category: New
 * Purpose: Preserve the glow modulation scale used by the extracted alias lighting helper.
 */
const RF_GLOW_SCALE = 0.1;

/**
 * Original name: N/A
 * Source: N/A (local RF_GLOW tuning constant)
 * Category: New
 * Purpose: Preserve the glow modulation frequency used by the extracted alias lighting helper.
 */
const RF_GLOW_RATE = 7;

/**
 * Original name: N/A
 * Source: N/A (alias shading option shape)
 * Category: New
 * Purpose: Describe the inputs used to compute alias-model shadelight in the `R_DrawAliasModel` style.
 */
export interface AliasShadeLightOptions {
  flags: number;
  rdflags: number;
  timeSeconds: number;
  baseShadeLight: vec3_t;
  monoLightmapMode?: string;
}

/**
 * Original name: N/A
 * Source: N/A (alias culling state shape)
 * Category: New
 * Purpose: Describe the alias entity transform/frame state required by `R_CullAliasModel`.
 */
export interface AliasCullEntityState {
  origin: vec3_t;
  angles: vec3_t;
  frame: number;
  oldframe: number;
}

/**
 * Original name: N/A
 * Source: N/A (alias frame-pair result shape)
 * Category: New
 * Purpose: Report the sanitized alias frame pair used by `R_DrawAliasModel` / `R_CullAliasModel` style guards.
 */
export interface AliasFramePair {
  frame: number;
  oldframe: number;
  corrected: boolean;
}

/**
 * Original name: shell flag checks in R_DrawAliasModel / GL_DrawAliasFrameLerp
 * Source: ref_gl/gl_mesh.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function aliasEntityHasShell(flags: number): boolean {
  return (flags & (RF_SHELL_RED | RF_SHELL_GREEN | RF_SHELL_BLUE | RF_SHELL_DOUBLE | RF_SHELL_HALF_DAM)) !== 0;
}

/**
 * Original name: shell-light branch in R_DrawAliasModel
 * Source: ref_gl/gl_mesh.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Computes shell shadelight overrides for red/green/blue/double/half-damage combinations.
 */
export function buildAliasShellShadeLight(flags: number): vec3_t | null {
  if (!aliasEntityHasShell(flags)) {
    return null;
  }

  const shadelight: vec3_t = [0, 0, 0];

  if ((flags & RF_SHELL_RED) !== 0 && (flags & RF_SHELL_BLUE) !== 0 && (flags & RF_SHELL_GREEN) !== 0) {
    shadelight[0] = 1;
    shadelight[1] = 1;
    shadelight[2] = 1;
    return shadelight;
  }

  if ((flags & (RF_SHELL_RED | RF_SHELL_BLUE | RF_SHELL_DOUBLE)) !== 0) {
    if ((flags & RF_SHELL_RED) !== 0) {
      shadelight[0] = 1;
      if ((flags & (RF_SHELL_BLUE | RF_SHELL_DOUBLE)) !== 0) {
        shadelight[2] = 1;
      }
    } else if ((flags & RF_SHELL_BLUE) !== 0) {
      if ((flags & RF_SHELL_DOUBLE) !== 0) {
        shadelight[1] = 1;
        shadelight[2] = 1;
      } else {
        shadelight[2] = 1;
      }
    } else if ((flags & RF_SHELL_DOUBLE) !== 0) {
      shadelight[0] = 0.9;
      shadelight[1] = 0.7;
    }
  } else if ((flags & (RF_SHELL_HALF_DAM | RF_SHELL_GREEN)) !== 0) {
    if ((flags & RF_SHELL_HALF_DAM) !== 0) {
      shadelight[0] = 0.56;
      shadelight[1] = 0.59;
      shadelight[2] = 0.45;
    }
    if ((flags & RF_SHELL_GREEN) !== 0) {
      shadelight[1] = 1;
    }
  }

  return shadelight;
}

/**
 * Original name: shadelight path from R_DrawAliasModel
 * Source: ref_gl/gl_mesh.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies shell/fullbright/minlight/glow/IR overrides on top of the base alias light sample.
 */
export function computeAliasShadeLight(options: AliasShadeLightOptions): vec3_t {
  const shellShade = buildAliasShellShadeLight(options.flags);
  const isFullbright = (options.flags & RF_FULLBRIGHT) !== 0;
  const shadelight = shellShade ?? (
    isFullbright
      ? ([1, 1, 1] as vec3_t)
      : ([options.baseShadeLight[0], options.baseShadeLight[1], options.baseShadeLight[2]] as vec3_t)
  );

  if (!shellShade && !isFullbright && shouldApplyAliasMonoLightmap(options.monoLightmapMode)) {
    applyAliasMonoLightmap(shadelight);
  }

  if ((options.flags & RF_MINLIGHT) !== 0) {
    if (shadelight[0] <= 0.1 && shadelight[1] <= 0.1 && shadelight[2] <= 0.1) {
      shadelight[0] = 0.1;
      shadelight[1] = 0.1;
      shadelight[2] = 0.1;
    }
  }

  if ((options.flags & RF_GLOW) !== 0) {
    const scale = RF_GLOW_SCALE * Math.sin(options.timeSeconds * RF_GLOW_RATE);
    for (let index = 0; index < 3; index += 1) {
      const min = shadelight[index] * 0.8;
      shadelight[index] += scale;
      if (shadelight[index] < min) {
        shadelight[index] = min;
      }
    }
  }

  if ((options.rdflags & RDF_IRGOGGLES) !== 0 && (options.flags & RF_IR_VISIBLE) !== 0) {
    shadelight[0] = 1;
    shadelight[1] = 0;
    shadelight[2] = 0;
  }

  return shadelight;
}

/**
 * Original name: weapon-model lightlevel hack in R_DrawAliasModel
 * Source: ref_gl/gl_mesh.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the `r_lightlevel` scalar (`150 * max_component`) used by weapon models to communicate lighting to the server.
 */
export function computeAliasWeaponLightLevel(shadelight: vec3_t): number {
  const maxComponent = Math.max(shadelight[0], shadelight[1], shadelight[2]);
  return 150 * maxComponent;
}

/**
 * Original name: per-vertex shadedots color path in GL_DrawAliasFrameLerp
 * Source: ref_gl/gl_mesh.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Computes alias per-vertex RGB colors from `shadedots[lightnormalindex] * shadelight`.
 *
 * Porting notes:
 * - Emits colors in draw-vertex order (`vertexIndices`) used by the Three.js MD2 geometry adapter.
 */
export function buildAliasVertexColors(
  model: Md2Model,
  frameIndex: number,
  vertexIndices: Uint32Array,
  yawDegrees: number,
  shadelight: vec3_t,
  out: Float32Array = new Float32Array(vertexIndices.length * 3)
): Float32Array {
  const frame = model.frames[frameIndex] ?? model.frames[0];
  if (!frame) {
    out.fill(0);
    return out;
  }

  const shadedots = getAliasShadedotsForYaw(yawDegrees);
  let writeOffset = 0;

  for (const sourceVertexIndex of vertexIndices) {
    const lightnormalindex = frame.verts[sourceVertexIndex]?.lightnormalindex ?? 0;
    const l = shadedots[lightnormalindex] ?? 0;

    out[writeOffset] = l * shadelight[0];
    out[writeOffset + 1] = l * shadelight[1];
    out[writeOffset + 2] = l * shadelight[2];
    writeOffset += 3;
  }

  return out;
}

/**
 * Original name: shadedots selection in R_DrawAliasModel
 * Source: ref_gl/gl_mesh.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function getAliasShadedotsForYaw(yawDegrees: number): readonly number[] {
  const quantizedIndex = (Math.trunc(yawDegrees * (SHADEDOT_QUANT / 360.0))) & (SHADEDOT_QUANT - 1);
  return getAliasShadedots(quantizedIndex);
}

/**
 * Original name: shadevector setup in R_DrawAliasModel
 * Source: ref_gl/gl_mesh.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function buildAliasShadeVector(yawDegrees: number): vec3_t {
  const an = (yawDegrees / 180) * Math.PI;
  const shadevector: vec3_t = [Math.cos(-an), Math.sin(-an), 1];
  VectorNormalize(shadevector);
  return shadevector;
}

/**
 * Original name: frame/oldframe validation in R_DrawAliasModel / R_CullAliasModel
 * Source: ref_gl/gl_mesh.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - If either frame index is invalid, resets both `frame` and `oldframe` to zero.
 */
export function sanitizeAliasFramePair(frame: number, oldframe: number, numFrames: number): AliasFramePair {
  if (numFrames <= 0) {
    return { frame: 0, oldframe: 0, corrected: true };
  }

  const frameInvalid = frame < 0 || frame >= numFrames;
  const oldframeInvalid = oldframe < 0 || oldframe >= numFrames;
  if (frameInvalid || oldframeInvalid) {
    return { frame: 0, oldframe: 0, corrected: true };
  }

  return { frame, oldframe, corrected: false };
}

/**
 * Original name: R_CullAliasModel
 * Source: ref_gl/gl_mesh.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Builds the interpolated-frame alias bounding box, rotates/translates it into world space, and applies the original 4-plane aggregate frustum mask test.
 */
export function R_CullAliasModel(
  model: Md2Model,
  entity: AliasCullEntityState,
  frustum: readonly [cplane_t, cplane_t, cplane_t, cplane_t]
): { culled: boolean; bbox: vec3_t[] } {
  const framePair = sanitizeAliasCullFramePair(entity.frame, entity.oldframe, model.frames.length);
  const frame = model.frames[framePair.frame] ?? model.frames[0];
  const oldframe = model.frames[framePair.oldframe] ?? model.frames[0];
  if (!frame || !oldframe) {
    return { culled: false, bbox: [] };
  }

  const mins: vec3_t = [0, 0, 0];
  const maxs: vec3_t = [0, 0, 0];
  computeAliasFrameBounds(frame, oldframe, mins, maxs);

  const bbox = buildAliasBoundingBox(mins, maxs);
  rotateAndTranslateAliasBoundingBox(bbox, entity.angles, entity.origin);
  return { culled: isAliasBoundingBoxCulled(bbox, frustum), bbox };
}

/**
 * Original name: N/A
 * Source: N/A (local alias cull helper)
 * Category: New
 * Purpose: Clamp culling frame indices independently while preserving the extracted public guard behavior.
 */
function sanitizeAliasCullFramePair(frame: number, oldframe: number, numFrames: number): AliasFramePair {
  if (numFrames <= 0) {
    return { frame: 0, oldframe: 0, corrected: true };
  }

  const correctedFrame = frame < 0 || frame >= numFrames ? 0 : frame;
  const correctedOldFrame = oldframe < 0 || oldframe >= numFrames ? 0 : oldframe;
  return {
    frame: correctedFrame,
    oldframe: correctedOldFrame,
    corrected: correctedFrame !== frame || correctedOldFrame !== oldframe
  };
}

/**
 * Original name: N/A
 * Source: N/A (local alias cull helper)
 * Category: New
 * Purpose: Compute the merged alias frame bounds used before frustum testing.
 */
function computeAliasFrameBounds(
  frame: Md2Model["frames"][number],
  oldframe: Md2Model["frames"][number],
  mins: vec3_t,
  maxs: vec3_t
): void {
  if (frame === oldframe) {
    for (let index = 0; index < 3; index += 1) {
      mins[index] = frame.translate[index];
      maxs[index] = mins[index] + frame.scale[index] * 255;
    }
    return;
  }

  for (let index = 0; index < 3; index += 1) {
    const thisMin = frame.translate[index];
    const thisMax = thisMin + frame.scale[index] * 255;
    const oldMin = oldframe.translate[index];
    const oldMax = oldMin + oldframe.scale[index] * 255;

    mins[index] = thisMin < oldMin ? thisMin : oldMin;
    maxs[index] = thisMax > oldMax ? thisMax : oldMax;
  }
}

/**
 * Original name: N/A
 * Source: N/A (local alias cull helper)
 * Category: New
 * Purpose: Expand min/max alias bounds into the original eight-point culling box.
 */
function buildAliasBoundingBox(mins: vec3_t, maxs: vec3_t): vec3_t[] {
  const bbox: vec3_t[] = [];
  for (let index = 0; index < 8; index += 1) {
    bbox.push([
      (index & 1) !== 0 ? mins[0] : maxs[0],
      (index & 2) !== 0 ? mins[1] : maxs[1],
      (index & 4) !== 0 ? mins[2] : maxs[2]
    ]);
  }

  return bbox;
}

/**
 * Original name: N/A
 * Source: N/A (local alias cull helper)
 * Category: New
 * Purpose: Apply the alias entity transform to the eight-point culling box.
 */
function rotateAndTranslateAliasBoundingBox(bbox: vec3_t[], entityAngles: vec3_t, entityOrigin: vec3_t): void {
  const angles: vec3_t = [entityAngles[0], -entityAngles[1], entityAngles[2]];
  const vectors = AngleVectors(angles);

  for (const point of bbox) {
    const tmp: vec3_t = [point[0], point[1], point[2]];
    point[0] = DotProduct(vectors.forward, tmp);
    point[1] = -DotProduct(vectors.right, tmp);
    point[2] = DotProduct(vectors.up, tmp);
    point[0] += entityOrigin[0];
    point[1] += entityOrigin[1];
    point[2] += entityOrigin[2];
  }
}

/**
 * Original name: N/A
 * Source: N/A (local alias cull helper)
 * Category: New
 * Purpose: Evaluate the original aggregate frustum mask over the transformed alias bounds.
 */
function isAliasBoundingBoxCulled(
  bbox: vec3_t[],
  frustum: readonly [cplane_t, cplane_t, cplane_t, cplane_t]
): boolean {
  let aggregateMask = ~0;

  for (const point of bbox) {
    let mask = 0;
    for (let planeIndex = 0; planeIndex < 4; planeIndex += 1) {
      const plane = frustum[planeIndex];
      const dp = DotProduct(plane.normal, point);
      if ((dp - plane.dist) < 0) {
        mask |= (1 << planeIndex);
      }
    }
    aggregateMask &= mask;
  }

  return aggregateMask !== 0;
}

/**
 * Original name: N/A
 * Source: N/A (local alias lighting helper)
 * Category: New
 * Purpose: Detect mono-lightmap modes for extracted alias model lighting.
 */
function shouldApplyAliasMonoLightmap(mode?: string): boolean {
  if (!mode || mode.length === 0) {
    return false;
  }

  return mode[0] !== "0";
}

/**
 * Original name: N/A
 * Source: N/A (local alias lighting helper)
 * Category: New
 * Purpose: Collapse alias shadelight to the max component for mono-lightmap modes.
 */
function applyAliasMonoLightmap(shadelight: vec3_t): void {
  const mono = Math.max(shadelight[0], shadelight[1], shadelight[2]);
  shadelight[0] = mono;
  shadelight[1] = mono;
  shadelight[2] = mono;
}

/**
 * Original name: GL_DrawAliasShadow
 * Source: ref_gl/gl_mesh.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Projects the currently lerped alias vertices along `shadevector` onto a constant shadow plane derived from `lheight`.
 *
 * Porting notes:
 * - Works on a flattened xyz float array instead of immediate-mode GL submission.
 */
export function GL_DrawAliasShadow(
  lerpedPositions: Float32Array,
  shadevector: vec3_t,
  lheight: number,
  out: Float32Array = new Float32Array(lerpedPositions.length)
): Float32Array {
  const height = -lheight + 1;

  for (let index = 0; index < lerpedPositions.length; index += 3) {
    const x = lerpedPositions[index];
    const y = lerpedPositions[index + 1];
    const z = lerpedPositions[index + 2];
    const scale = z + lheight;

    out[index] = x - shadevector[0] * scale;
    out[index + 1] = y - shadevector[1] * scale;
    out[index + 2] = height;
  }

  return out;
}
