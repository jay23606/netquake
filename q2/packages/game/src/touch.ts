/**
 * File: touch.ts
 * Source: Quake II original / game/g_utils.c
 * Purpose: Port the trigger-touch helper routines used by gameplay physics and trigger entities.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses the current runtime `BoxEdicts` layer instead of the original engine import table.
 * - Runtime overlap helpers call touches without plane/surface when no collision trace produced them.
 *
 * Notes:
 * - This file is intended to stay close to the original `G_TouchTriggers` / `G_TouchSolids` behavior.
 */

import { AREA_SOLID, AREA_TRIGGERS, BoxEdicts, SVF_MONSTER } from "./runtime.js";
import type { GameEntity, GameRuntime } from "./runtime.js";

/**
 * Original name: G_TouchTriggers
 * Source: game/g_utils.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Invokes trigger touches for every trigger volume overlapping one entity's absolute bounds.
 *
 * Constraints:
 * - Dead clients and monsters must not activate triggers.
 * - Must preserve runtime query order.
 */
export function G_TouchTriggers(runtime: GameRuntime, actor: GameEntity): void {
  if ((actor.client || (actor.svflags & SVF_MONSTER) !== 0) && actor.health <= 0) {
    return;
  }

  const actorBounds = getActorBounds(actor);
  if (!actorBounds) {
    return;
  }

  const touch = BoxEdicts(runtime, actorBounds.mins, actorBounds.maxs, AREA_TRIGGERS);
  for (const entity of touch) {
    if (!entity.inuse) {
      continue;
    }

    if (!entity.touch) {
      continue;
    }

    entity.touch(entity, actor, runtime);
  }
}

/**
 * Original name: G_TouchSolids
 * Source: game/g_utils.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Invokes one trigger's touch callback against every solid overlapping it after the trigger is linked.
 *
 * Constraints:
 * - Must preserve runtime query order.
 * - Must only call the provided trigger's `touch`.
 *
 * Porting notes:
 * - Preserves the original C argument order: `trigger.touch(solid, trigger, ...)`.
 * - Uses the runtime `BoxEdicts` adapter for `AREA_SOLID` queries.
 */
export function G_TouchSolids(runtime: GameRuntime, trigger: GameEntity): void {
  const triggerBounds = getActorBounds(trigger);
  if (!triggerBounds) {
    return;
  }

  const touch = BoxEdicts(runtime, triggerBounds.mins, triggerBounds.maxs, AREA_SOLID);
  for (const entity of touch) {
    if (!entity.inuse) {
      continue;
    }

    const touchCallback = trigger.touch;
    if (touchCallback) {
      touchCallback(entity, trigger, runtime);
    }

    if (!trigger.inuse) {
      break;
    }
  }
}

/**
 * Original name: N/A
 * Source: N/A (local compatibility wrapper)
 * Category: New
 * Purpose: Preserve the existing helper name while routing through the strict `G_TouchTriggers` port.
 */
export function touchTriggerEntities(runtime: GameRuntime, actor: GameEntity): void {
  G_TouchTriggers(runtime, actor);
}

/**
 * Original name: N/A
 * Source: N/A (local bounds helper)
 * Category: New
 * Purpose: Convert one actor entity into absolute world bounds using the runtime spatial fields.
 */
function getActorBounds(actor: GameEntity): { mins: [number, number, number]; maxs: [number, number, number] } | null {
  if (!hasNonZeroExtents(actor.absmin, actor.absmax)) {
    return null;
  }

  return {
    mins: [...actor.absmin],
    maxs: [...actor.absmax]
  };
}

/**
 * Original name: N/A
 * Source: N/A (local bounds helper)
 * Category: New
 * Purpose: Reject empty placeholder bounds so only meaningful trigger volumes participate.
 */
function hasNonZeroExtents(mins: [number, number, number], maxs: [number, number, number]): boolean {
  return mins[0] !== maxs[0] || mins[1] !== maxs[1] || mins[2] !== maxs[2];
}
