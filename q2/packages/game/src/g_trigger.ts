/**
 * File: g_trigger.ts
 * Source: Quake II original / game/g_trigger.c
 * Purpose: Port of the Quake II trigger entities and their shared activation flow.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Print feedback is journaled through runtime log entries instead of engine print callbacks.
 * - Sound playback is queued through the runtime sound-event bridge instead of `gi.sound`.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

import {
  AngleVectors,
  DotProduct,
  VectorCompare,
  YAW,
  vec3_origin
} from "../../qcommon/src/index.js";
import { T_Damage } from "./g_combat.js";
import {
  DAMAGE_NO_PROTECTION,
  FL_FLY,
  FL_SWIM,
  ITEM_INDEX,
  MOD_TRIGGER_HURT
} from "./g_local.js";
import { FindItemByClassname } from "./g_items.js";
import {
  FRAMETIME,
  MOVETYPE_NONE,
  SOLID_NOT,
  SOLID_TRIGGER,
  SVF_DEADMONSTER,
  SVF_MONSTER,
  SVF_NOCLIENT,
  emitGameSound,
  freeGameEntity,
  linkGameEntity,
  registerGameSound,
  setGameEntityModel
} from "./runtime.js";
import { G_SetMovedir, G_UseTargets, vtos } from "./g_utils.js";
import type { GameEntity, GameRuntime } from "./runtime.js";

/**
 * Original name: PUSH_ONCE
 * Source: game/g_trigger.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Mirrors the original trigger_push spawnflag macro.
 */
const PUSH_ONCE = 1;

/**
 * Original name: N/A
 * Source declaree: N/A (local spawnflag aliases)
 * Category: New
 * Purpose: Name the documented trigger_multiple spawnflag bits used inline in the C source.
 */
const TRIGGER_MULTIPLE_MONSTER = 1;
const TRIGGER_MULTIPLE_NOT_PLAYER = 2;
const TRIGGER_MULTIPLE_TRIGGERED = 4;

/**
 * Original name: N/A
 * Source declaree: N/A (local spawnflag aliases)
 * Category: New
 * Purpose: Name the documented trigger_hurt spawnflag bits used inline in the C source.
 */
const TRIGGER_HURT_START_OFF = 1;
const TRIGGER_HURT_TOGGLE = 2;
const TRIGGER_HURT_SILENT = 4;
const TRIGGER_HURT_NO_PROTECTION = 8;
const TRIGGER_HURT_SLOW = 16;

/**
 * Original name: InitTrigger
 * Source: game/g_trigger.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes the shared trigger baseline used by push, hurt, gravity and monster-jump entities.
 */
export function InitTrigger(self: GameEntity, runtime: GameRuntime): void {
  if (!VectorCompare(self.s.angles, vec3_origin)) {
    G_SetMovedir(self.s.angles, self.movedir);
    self.angles = [...self.s.angles];
  }

  self.solid = SOLID_TRIGGER;
  self.movetype = MOVETYPE_NONE;
  self.svflags = SVF_NOCLIENT;
  setEntityModel(self, runtime);
}

/**
 * Original name: multi_wait
 * Source: game/g_trigger.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Clears the trigger cooldown so a repeatable trigger can fire again.
 */
export function multi_wait(ent: GameEntity, _runtime: GameRuntime): void {
  ent.nextthink = 0;
}

/**
 * Original name: multi_trigger
 * Source: game/g_trigger.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Fires one trigger, rearms it after `wait`, or removes it on the next frame for one-shot variants.
 */
export function multi_trigger(ent: GameEntity, runtime: GameRuntime): void {
  if (ent.nextthink) {
    return;
  }

  G_UseTargets(runtime, ent, ent.activator);

  if (ent.wait > 0) {
    ent.think = multi_wait;
    ent.nextthink = runtime.time + ent.wait;
    return;
  }

  ent.touch = undefined;
  ent.nextthink = runtime.time + FRAMETIME;
  ent.think = freeTriggerEntity;
}

/**
 * Original name: Use_Multi
 * Source: game/g_trigger.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Activates one multi trigger through its `use` path.
 */
export function Use_Multi(ent: GameEntity, _other: GameEntity | null, activator: GameEntity | null, runtime: GameRuntime): void {
  ent.activator = activator;
  multi_trigger(ent, runtime);
}

/**
 * Original name: Touch_Multi
 * Source: game/g_trigger.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Activates one multi trigger when touched by an allowed player or monster.
 */
export function Touch_Multi(self: GameEntity, other: GameEntity, runtime: GameRuntime): void {
  if (other.client) {
    if ((self.spawnflags & TRIGGER_MULTIPLE_NOT_PLAYER) !== 0) {
      return;
    }
  } else if ((other.svflags & SVF_MONSTER) !== 0) {
    if ((self.spawnflags & TRIGGER_MULTIPLE_MONSTER) === 0) {
      return;
    }
  } else {
    return;
  }

  if (!VectorCompare(self.movedir, vec3_origin)) {
    const { forward } = AngleVectors(other.s.angles);
    if (DotProduct(forward, self.movedir) < 0) {
      return;
    }
  }

  self.activator = other;
  multi_trigger(self, runtime);
}

/**
 * Original name: trigger_enable
 * Source: game/g_trigger.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Enables a previously disabled trigger and relinks it into trigger collision queries.
 */
export function trigger_enable(self: GameEntity, _other: GameEntity | null, _activator: GameEntity | null, runtime: GameRuntime): void {
  self.solid = SOLID_TRIGGER;
  self.use = Use_Multi;
  linkGameEntity(runtime, self);
}

/**
 * Original name: SP_trigger_multiple
 * Source: game/g_trigger.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes one repeatable trigger volume from BSP entity properties.
 */
export function SP_trigger_multiple(ent: GameEntity, runtime: GameRuntime): void {
  if (ent.sounds === 1) {
    ent.noise_index = registerGameSound(runtime, "misc/secret.wav");
  } else if (ent.sounds === 2) {
    ent.noise_index = registerGameSound(runtime, "misc/talk.wav");
  } else if (ent.sounds === 3) {
    ent.noise_index = registerGameSound(runtime, "misc/trigger1.wav");
  }

  if (!ent.wait) {
    ent.wait = 0.2;
  }

  ent.touch = Touch_Multi;
  ent.movetype = MOVETYPE_NONE;
  ent.svflags |= SVF_NOCLIENT;

  if ((ent.spawnflags & TRIGGER_MULTIPLE_TRIGGERED) !== 0) {
    ent.solid = SOLID_NOT;
    ent.use = trigger_enable;
  } else {
    ent.solid = SOLID_TRIGGER;
    ent.use = Use_Multi;
  }

  if (!VectorCompare(ent.s.angles, vec3_origin)) {
    G_SetMovedir(ent.s.angles, ent.movedir);
    ent.angles = [...ent.s.angles];
  }

  setEntityModel(ent, runtime);
  linkGameEntity(runtime, ent);
}

/**
 * Original name: SP_trigger_once
 * Source: game/g_trigger.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes a single-use trigger by reusing `SP_trigger_multiple` with `wait = -1`.
 */
export function SP_trigger_once(ent: GameEntity, runtime: GameRuntime): void {
  if ((ent.spawnflags & 1) !== 0) {
    ent.spawnflags &= ~1;
    ent.spawnflags |= TRIGGER_MULTIPLE_TRIGGERED;
    runtime.log({
      kind: "warning",
      message: `fixed TRIGGERED flag on ${ent.classname} at ${vtos(getTriggerCenter(ent))}`,
      entityIndex: ent.index,
      entityClassname: ent.classname
    });
  }

  ent.wait = -1;
  SP_trigger_multiple(ent, runtime);
}

/**
 * Original name: trigger_relay_use
 * Source: game/g_trigger.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Forwards activation directly to the relay's linked targets.
 */
export function trigger_relay_use(self: GameEntity, _other: GameEntity | null, activator: GameEntity | null, runtime: GameRuntime): void {
  G_UseTargets(runtime, self, activator);
}

/**
 * Original name: SP_trigger_relay
 * Source: game/g_trigger.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Initializes a relay trigger that can only be activated through `use`.
 */
export function SP_trigger_relay(self: GameEntity, _runtime: GameRuntime): void {
  self.use = trigger_relay_use;
  self.solid = SOLID_NOT;
}

/**
 * Original name: trigger_key_use
 * Source: game/g_trigger.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Fires targets only if the activating player owns the configured key item.
 */
export function trigger_key_use(self: GameEntity, _other: GameEntity | null, activator: GameEntity | null, runtime: GameRuntime): void {
  if (!self.item || !activator?.client) {
    return;
  }

  const index = ITEM_INDEX(self.item);
  if (!activator.client.pers.inventory[index]) {
    if (runtime.time < self.touch_debounce_time) {
      return;
    }

    self.touch_debounce_time = runtime.time + 5.0;
    runtime.log({
      kind: "message",
      message: `You need the ${self.item.pickupName}`,
      entityIndex: self.index,
      entityClassname: self.classname,
      otherIndex: activator.index,
      otherClassname: activator.classname
    });
    emitGameSound(runtime, activator, "misc/keytry.wav");
    return;
  }

  emitGameSound(runtime, activator, "misc/keyuse.wav");

  if (runtime.coop) {
    if (self.item.classname === "key_power_cube") {
      let cube = 0;
      for (; cube < 8; cube += 1) {
        if ((activator.client.pers.power_cubes & (1 << cube)) !== 0) {
          break;
        }
      }

      for (let player = 1; player <= runtime.maxclients; player += 1) {
        const ent = runtime.entities[player];
        if (!ent?.inuse || !ent.client) {
          continue;
        }
        if ((ent.client.pers.power_cubes & (1 << cube)) !== 0) {
          ent.client.pers.inventory[index] -= 1;
          ent.client.pers.power_cubes &= ~(1 << cube);
        }
      }
    } else {
      for (let player = 1; player <= runtime.maxclients; player += 1) {
        const ent = runtime.entities[player];
        if (!ent?.inuse || !ent.client) {
          continue;
        }
        ent.client.pers.inventory[index] = 0;
      }
    }
  } else {
    activator.client.pers.inventory[index] -= 1;
  }

  G_UseTargets(runtime, self, activator);
  self.use = undefined;
}

/**
 * Original name: SP_trigger_key
 * Source: game/g_trigger.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes a key-gated relay trigger from the BSP `item` property.
 */
export function SP_trigger_key(self: GameEntity, runtime: GameRuntime): void {
  const itemClassname = self.properties.item;
  if (!itemClassname) {
    runtime.log({
      kind: "warning",
      message: `no key item for trigger_key at ${vtos(self.s.origin)}`,
      entityIndex: self.index,
      entityClassname: self.classname
    });
    return;
  }

  self.item = FindItemByClassname(itemClassname);
  if (!self.item) {
    runtime.log({
      kind: "warning",
      message: `item ${itemClassname} not found for trigger_key at ${vtos(self.s.origin)}`,
      entityIndex: self.index,
      entityClassname: self.classname
    });
    return;
  }

  if (!self.target) {
    runtime.log({
      kind: "warning",
      message: `${self.classname} at ${vtos(self.s.origin)} has no target`,
      entityIndex: self.index,
      entityClassname: self.classname
    });
    return;
  }

  registerGameSound(runtime, "misc/keytry.wav");
  registerGameSound(runtime, "misc/keyuse.wav");
  self.use = trigger_key_use;
}

/**
 * Original name: trigger_counter_use
 * Source: game/g_trigger.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Counts down repeated activations before finally firing the trigger targets.
 */
export function trigger_counter_use(self: GameEntity, _other: GameEntity | null, activator: GameEntity | null, runtime: GameRuntime): void {
  if (self.count === 0) {
    return;
  }

  self.count -= 1;

  if (self.count) {
    if ((self.spawnflags & 1) === 0 && activator) {
      runtime.log({
        kind: "message",
        message: `${self.count} more to go...`,
        entityIndex: self.index,
        entityClassname: self.classname,
        otherIndex: activator.index,
        otherClassname: activator.classname
      });
      emitGameSound(runtime, activator, "misc/talk1.wav");
    }
    return;
  }

  if ((self.spawnflags & 1) === 0 && activator) {
    runtime.log({
      kind: "message",
      message: "Sequence completed!",
      entityIndex: self.index,
      entityClassname: self.classname,
      otherIndex: activator.index,
      otherClassname: activator.classname
    });
    emitGameSound(runtime, activator, "misc/talk1.wav");
  }

  self.activator = activator;
  multi_trigger(self, runtime);
}

/**
 * Original name: SP_trigger_counter
 * Source: game/g_trigger.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Initializes a counter trigger with the original default count of two activations.
 */
export function SP_trigger_counter(self: GameEntity, _runtime: GameRuntime): void {
  self.wait = -1;
  if (!self.count) {
    self.count = 2;
  }

  self.use = trigger_counter_use;
}

/**
 * Original name: SP_trigger_always
 * Source: game/g_trigger.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Immediately schedules the trigger's target chain from worldspawn.
 */
export function SP_trigger_always(ent: GameEntity, runtime: GameRuntime): void {
  if (ent.delay < 0.2) {
    ent.delay = 0.2;
  }
  G_UseTargets(runtime, ent, ent);
}

/**
 * Original name: trigger_push_touch
 * Source: game/g_trigger.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Accelerates touching grenades or living actors in the trigger's movedir.
 */
export function trigger_push_touch(self: GameEntity, other: GameEntity, runtime: GameRuntime): void {
  if (other.classname === "grenade") {
    setScaledVelocity(other, self.movedir, self.speed * 10);
  } else if (other.health > 0) {
    setScaledVelocity(other, self.movedir, self.speed * 10);

    if (other.client) {
      other.client.oldvelocity = [...other.velocity];
      if (other.fly_sound_debounce_time < runtime.time) {
        other.fly_sound_debounce_time = runtime.time + 1.5;
        emitRegisteredSound(runtime, other, self.noise_index, "misc/windfly.wav");
      }
    }
  }

  if ((self.spawnflags & PUSH_ONCE) !== 0) {
    freeGameEntity(runtime, self);
  }
}

/**
 * Original name: SP_trigger_push
 * Source: game/g_trigger.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes a push trigger with its default launch speed and wind-fly sound.
 */
export function SP_trigger_push(self: GameEntity, runtime: GameRuntime): void {
  InitTrigger(self, runtime);
  self.noise_index = registerGameSound(runtime, "misc/windfly.wav");
  self.touch = trigger_push_touch;
  if (!self.speed) {
    self.speed = 1000;
  }
  linkGameEntity(runtime, self);
}

/**
 * Original name: hurt_use
 * Source: game/g_trigger.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Toggles a hurt trigger on or off and optionally disables further manual toggles.
 */
export function hurt_use(self: GameEntity, _other: GameEntity | null, _activator: GameEntity | null, runtime: GameRuntime): void {
  self.solid = self.solid === SOLID_NOT ? SOLID_TRIGGER : SOLID_NOT;
  linkGameEntity(runtime, self);

  if ((self.spawnflags & TRIGGER_HURT_TOGGLE) === 0) {
    self.use = undefined;
  }
}

/**
 * Original name: hurt_touch
 * Source: game/g_trigger.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Damages each valid touching entity at the original trigger-hurt cadence.
 */
export function hurt_touch(self: GameEntity, other: GameEntity, runtime: GameRuntime): void {
  if (!other.takedamage) {
    return;
  }

  if (self.timestamp > runtime.time) {
    return;
  }

  if ((self.spawnflags & TRIGGER_HURT_SLOW) !== 0) {
    self.timestamp = runtime.time + 1;
  } else {
    self.timestamp = runtime.time + FRAMETIME;
  }

  if ((self.spawnflags & TRIGGER_HURT_SILENT) === 0 && (runtime.framenum % 10) === 0) {
    emitRegisteredSound(runtime, other, self.noise_index, "world/electro.wav");
  }

  const dflags = (self.spawnflags & TRIGGER_HURT_NO_PROTECTION) !== 0 ? DAMAGE_NO_PROTECTION : 0;
  T_Damage(other, self, self, vec3_origin, other.s.origin, vec3_origin, self.dmg, self.dmg, dflags, MOD_TRIGGER_HURT, runtime);
}

/**
 * Original name: SP_trigger_hurt
 * Source: game/g_trigger.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes a damaging trigger volume with its default damage and toggle rules.
 */
export function SP_trigger_hurt(self: GameEntity, runtime: GameRuntime): void {
  InitTrigger(self, runtime);
  self.noise_index = registerGameSound(runtime, "world/electro.wav");
  self.touch = hurt_touch;

  if (!self.dmg) {
    self.dmg = 5;
  }

  self.solid = (self.spawnflags & TRIGGER_HURT_START_OFF) !== 0 ? SOLID_NOT : SOLID_TRIGGER;
  if ((self.spawnflags & TRIGGER_HURT_TOGGLE) !== 0) {
    self.use = hurt_use;
  }

  linkGameEntity(runtime, self);
}

/**
 * Original name: trigger_gravity_touch
 * Source: game/g_trigger.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Replaces the touching entity's gravity scalar with the trigger's configured value.
 */
export function trigger_gravity_touch(self: GameEntity, other: GameEntity, _runtime: GameRuntime): void {
  other.gravity = self.gravity;
}

/**
 * Original name: SP_trigger_gravity
 * Source: game/g_trigger.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes one gravity trigger from the BSP `gravity` key.
 */
export function SP_trigger_gravity(self: GameEntity, runtime: GameRuntime): void {
  const gravity = parseIntegerProperty(self.properties.gravity);
  if (gravity === 0) {
    runtime.log({
      kind: "warning",
      message: `trigger_gravity without gravity set at ${vtos(self.s.origin)}`,
      entityIndex: self.index,
      entityClassname: self.classname
    });
    freeGameEntity(runtime, self);
    return;
  }

  InitTrigger(self, runtime);
  self.gravity = gravity;
  self.touch = trigger_gravity_touch;
  linkGameEntity(runtime, self);
}

/**
 * Original name: trigger_monsterjump_touch
 * Source: game/g_trigger.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Applies the configured jump impulse to walking monsters that touch the trigger.
 */
export function trigger_monsterjump_touch(self: GameEntity, other: GameEntity, _runtime: GameRuntime): void {
  if ((other.flags & (FL_FLY | FL_SWIM)) !== 0) {
    return;
  }
  if ((other.svflags & SVF_DEADMONSTER) !== 0) {
    return;
  }
  if ((other.svflags & SVF_MONSTER) === 0) {
    return;
  }

  other.velocity[0] = self.movedir[0] * self.speed;
  other.velocity[1] = self.movedir[1] * self.speed;

  if (!other.groundentity) {
    return;
  }

  other.groundentity = null;
  other.velocity[2] = self.movedir[2];
}

/**
 * Original name: SP_trigger_monsterjump
 * Source: game/g_trigger.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes a walking-monster jump trigger with default speed and height.
 */
export function SP_trigger_monsterjump(self: GameEntity, runtime: GameRuntime): void {
  if (!self.speed) {
    self.speed = 200;
  }

  const height = parseIntegerProperty(self.properties.height) || 200;
  if (self.s.angles[YAW] === 0) {
    self.s.angles[YAW] = 360;
    self.angles[YAW] = 360;
  }

  InitTrigger(self, runtime);
  self.touch = trigger_monsterjump_touch;
  self.movedir[2] = height;
  linkGameEntity(runtime, self);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Free a trigger entity after the deferred one-frame removal used by Quake II touch loops.
 */
function freeTriggerEntity(self: GameEntity, runtime: GameRuntime): void {
  freeGameEntity(runtime, self);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Preserve the C `gi.setmodel(self, self->model)` guard through the runtime model hook.
 */
function setEntityModel(self: GameEntity, runtime: GameRuntime): void {
  if (!self.model) {
    return;
  }

  setGameEntityModel(runtime, self, self.model);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Resolve registered runtime sound indexes while preserving the original fallback sound path.
 */
function emitRegisteredSound(runtime: GameRuntime, entity: GameEntity | null, soundIndex: number, fallbackPath: string): void {
  const soundPath = runtime.assets.soundPaths[soundIndex - 1] ?? fallbackPath;
  emitGameSound(runtime, entity, soundPath);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Port the local `VectorScale(movedir, scale, velocity)` assignments used by push triggers.
 */
function setScaledVelocity(entity: GameEntity, movedir: [number, number, number], scale: number): void {
  entity.velocity = [
    movedir[0] * scale,
    movedir[1] * scale,
    movedir[2] * scale
  ];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Reproduce the integer coercion of BSP string spawn properties such as `gravity` and `height`.
 */
function parseIntegerProperty(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Compute the warning position used by the trigger_once legacy spawnflag fix.
 */
function getTriggerCenter(ent: GameEntity): [number, number, number] {
  return [
    ent.mins[0] + (0.5 * ent.size[0]),
    ent.mins[1] + (0.5 * ent.size[1]),
    ent.mins[2] + (0.5 * ent.size[2])
  ];
}
