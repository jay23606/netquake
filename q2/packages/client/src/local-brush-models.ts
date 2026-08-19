/**
 * File: local-brush-models.ts
 * Purpose: Hold the standalone brush-model snapshot and interpolation helpers used by the local gameplay/client loop.
 *
 * This file is not a direct source port.
 * It is a runtime-side helper layer for moving BSP submodel interpolation.
 *
 * Dependencies:
 * - packages/game
 * - packages/qcommon
 */

import { EF_ANIM01, EF_ANIM23, EF_ANIM_ALL, EF_ANIM_ALLFAST, LerpAngle } from "../../qcommon/src/index.js";
import { SOLID_TRIGGER, SVF_NOCLIENT, type GameRuntime } from "../../game/src/index.js";
import type { BrushModelInterpolationState } from "./local-gameplay-sync.js";

/**
 * Original name: N/A
 * Source: N/A (local brush-model helper)
 * Category: New
 * Purpose: Describe one gameplay-owned inline model transform snapshot.
 *
 * Constraints:
 * - Must use the original Quake II `*N` model naming convention.
 * - Must carry the renderer frame used by animated brush textures.
 * - Must stay renderer-neutral so runtime code never imports renderer adapters.
 */
export interface BrushModelSnapshot {
  model: string | undefined;
  origin: [number, number, number];
  angles: [number, number, number];
  frame?: number;
  flags?: number;
}

/**
 * Original name: N/A
 * Source: N/A (local brush-model helper)
 * Category: New
 * Purpose: Extract the current inline brush model transforms from the local gameplay runtime.
 *
 * Constraints:
 * - Must only include active entities backed by BSP inline models.
 */
export function buildBrushModelSnapshots(runtime: GameRuntime): BrushModelSnapshot[] {
  const snapshots: BrushModelSnapshot[] = [];

  for (const entity of runtime.entities) {
    if (!entity.inuse || !entity.model?.startsWith("*")) {
      continue;
    }

    if ((entity.svflags & SVF_NOCLIENT) !== 0) {
      continue;
    }

    if (entity.solid === SOLID_TRIGGER) {
      continue;
    }

    snapshots.push({
      model: entity.model,
      origin: [...entity.origin],
      angles: [...entity.angles],
      frame: resolveBrushModelFrame(runtime.time, entity.s.frame, entity.s.effects),
      flags: entity.s.renderfx
    });
  }

  return snapshots;
}

/**
 * Original name: N/A
 * Source: N/A (local brush-model helper)
 * Category: New
 * Purpose: Create the initial brush-model interpolation state from the current gameplay runtime pose.
 *
 * Constraints:
 * - Must start with identical previous and current poses to avoid bootstrap pops.
 */
export function createBrushModelInterpolationState(runtime: GameRuntime): BrushModelInterpolationState<BrushModelSnapshot> {
  const snapshots = buildBrushModelSnapshots(runtime);

  return {
    previousSnapshots: cloneBrushModelSnapshots(snapshots),
    currentSnapshots: cloneBrushModelSnapshots(snapshots),
    previousTime: runtime.time,
    currentTime: runtime.time
  };
}

/**
 * Original name: N/A
 * Source: N/A (local brush-model helper)
 * Category: New
 * Purpose: Interpolate the current brush-model render pose from the last two gameplay snapshots like the original Quake II client entity path.
 *
 * Constraints:
 * - Must linearly interpolate origins.
 * - Must use `LerpAngle` for angular interpolation.
 */
export function buildInterpolatedBrushModelSnapshots(
  interpolationState: BrushModelInterpolationState<BrushModelSnapshot>,
  renderTimeSeconds: number
): BrushModelSnapshot[] {
  const currentSnapshots = interpolationState.currentSnapshots;
  const previousByModel = new Map<string, BrushModelSnapshot>();

  for (const snapshot of interpolationState.previousSnapshots) {
    if (snapshot.model) {
      previousByModel.set(snapshot.model, snapshot);
    }
  }

  const lerpFraction = interpolationState.currentTime > interpolationState.previousTime
    ? clamp01((renderTimeSeconds - interpolationState.previousTime) / (interpolationState.currentTime - interpolationState.previousTime))
    : 1;

  return currentSnapshots.map((currentSnapshot) => {
    if (!currentSnapshot.model) {
      return cloneBrushModelSnapshot(currentSnapshot);
    }

    const previousSnapshot = previousByModel.get(currentSnapshot.model);
    if (!previousSnapshot) {
      return cloneBrushModelSnapshot(currentSnapshot);
    }

    const nextSnapshot: BrushModelSnapshot = {
      model: currentSnapshot.model,
      origin: [
        lerpValue(previousSnapshot.origin[0], currentSnapshot.origin[0], lerpFraction),
        lerpValue(previousSnapshot.origin[1], currentSnapshot.origin[1], lerpFraction),
        lerpValue(previousSnapshot.origin[2], currentSnapshot.origin[2], lerpFraction)
      ],
      angles: [
        LerpAngle(previousSnapshot.angles[0], currentSnapshot.angles[0], lerpFraction),
        LerpAngle(previousSnapshot.angles[1], currentSnapshot.angles[1], lerpFraction),
        LerpAngle(previousSnapshot.angles[2], currentSnapshot.angles[2], lerpFraction)
      ]
    };
    if (currentSnapshot.frame !== undefined) {
      nextSnapshot.frame = currentSnapshot.frame;
    }
    if (currentSnapshot.flags !== undefined) {
      nextSnapshot.flags = currentSnapshot.flags;
    }
    return nextSnapshot;
  });
}

/**
 * Original name: N/A
 * Source: N/A (local brush-model helper)
 * Category: New
 * Purpose: Clone one list of brush-model snapshots so interpolation state keeps value semantics across fixed frames.
 */
export function cloneBrushModelSnapshots(snapshots: BrushModelSnapshot[]): BrushModelSnapshot[] {
  return snapshots.map(cloneBrushModelSnapshot);
}

/**
 * Original name: N/A
 * Source: N/A (local brush-model helper)
 * Category: New
 * Purpose: Clone one brush-model snapshot without sharing mutable tuple references.
 */
export function cloneBrushModelSnapshot(snapshot: BrushModelSnapshot): BrushModelSnapshot {
  const clone: BrushModelSnapshot = {
    model: snapshot.model,
    origin: [...snapshot.origin],
    angles: [...snapshot.angles]
  };
  if (snapshot.frame !== undefined) {
    clone.frame = snapshot.frame;
  }
  if (snapshot.flags !== undefined) {
    clone.flags = snapshot.flags;
  }
  return clone;
}

/**
 * Original name: N/A
 * Source: N/A (local brush-model helper)
 * Category: New
 * Purpose: Resolve the client-facing brush-model frame used by ref_gl animated texture selection.
 *
 * Constraints:
 * - Must mirror the EF_ANIM frame overrides from `CL_AddPacketEntities`.
 */
function resolveBrushModelFrame(timeSeconds: number, stateFrame: number, effects: number): number {
  const autoanim = Math.trunc(2 * timeSeconds);

  if ((effects & EF_ANIM01) !== 0) {
    return autoanim & 1;
  }
  if ((effects & EF_ANIM23) !== 0) {
    return 2 + (autoanim & 1);
  }
  if ((effects & EF_ANIM_ALL) !== 0) {
    return autoanim;
  }
  if ((effects & EF_ANIM_ALLFAST) !== 0) {
    return Math.trunc(timeSeconds * 10);
  }

  return stateFrame;
}

/**
 * Original name: N/A
 * Source: N/A (local brush-model helper)
 * Category: New
 * Purpose: Interpolate one scalar with a clamped fraction.
 */
function lerpValue(previous: number, current: number, fraction: number): number {
  return previous + (current - previous) * fraction;
}

/**
 * Original name: N/A
 * Source: N/A (local brush-model helper)
 * Category: New
 * Purpose: Clamp one interpolation fraction to the inclusive `[0, 1]` interval.
 */
function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
