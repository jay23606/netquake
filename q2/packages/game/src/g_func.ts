/**
 * File: g_func.ts
 * Source: Quake II original / game/g_func.c
 * Purpose: Port Quake II brush entity movement and use lifecycles from `game/g_func.c`.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Spawns trigger helper entities through the local runtime instead of the live server edict pool.
 * - Journals/link updates/sound registration through runtime services in place of direct `gi.*` calls.
 *
 * Notes:
 * - This file is intended to stay close to the original brush-entity state flow.
 */

import {
  AngleVectors,
  ATTN_NORM,
  CHAN_AUTO,
  ATTN_STATIC,
  CHAN_NO_PHS_ADD,
  CHAN_VOICE,
  CM_SetAreaPortalState,
  EF_ANIM01,
  EF_ANIM23,
  EF_ANIM_ALL,
  EF_ANIM_ALLFAST,
  entity_event_t,
  type vec3_t
} from "../../qcommon/src/index.js";
import { T_Damage } from "./g_combat.js";
import { crandom, damage_t, MOD_CRUSH } from "./g_local.js";
import { BecomeExplosion1 } from "./g_misc.js";
import { G_Find, G_PickTarget, G_SetMovedir, G_UseTargets, KillBox, vtos } from "./g_utils.js";
import {
  DOOR_CRUSHER,
  DOOR_NOMONSTER,
  DOOR_REVERSE,
  DOOR_START_OPEN,
  DOOR_TOGGLE,
  DOOR_X_AXIS,
  DOOR_Y_AXIS,
  FL_TEAMSLAVE,
  FRAMETIME,
  MOVETYPE_NONE,
  MOVETYPE_PUSH,
  MOVETYPE_STOP,
  PLAT_LOW_TRIGGER,
  SOLID_BSP,
  SOLID_TRIGGER,
  STATE_BOTTOM,
  STATE_DOWN,
  STATE_TOP,
  STATE_UP,
  SVF_MONSTER,
  SVF_NOCLIENT,
  emitGameCenterprint,
  emitRegisteredGameSound,
  getRuntimeEntityLabel,
  linkGameEntity,
  refreshEntitySpatialState,
  registerGameSound,
  setGameEntityModel,
  spawnGameEntity
} from "./runtime.js";
import type { GameEntity, GameRuntime } from "./runtime.js";

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 *
 * Purpose:
 * - Names the division-by-two factor used by the `AccelerationDistance` macro port.
 */
const ACCELERATION_DISTANCE_SCALE = 0.5;

/**
 * Original name: TRAIN_START_ON
 * Source: Quake-2-master/game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 */
const TRAIN_START_ON = 1;

/**
 * Original name: TRAIN_TOGGLE
 * Source: Quake-2-master/game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 */
const TRAIN_TOGGLE = 2;

/**
 * Original name: TRAIN_BLOCK_STOPS
 * Source: Quake-2-master/game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 */
const TRAIN_BLOCK_STOPS = 4;

/**
 * Original name: SECRET_ALWAYS_SHOOT
 * Source: Quake-2-master/game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 */
const SECRET_ALWAYS_SHOOT = 1;

/**
 * Original name: SECRET_1ST_LEFT
 * Source: Quake-2-master/game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 */
const SECRET_1ST_LEFT = 2;

/**
 * Original name: SECRET_1ST_DOWN
 * Source: Quake-2-master/game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 */
const SECRET_1ST_DOWN = 4;

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 *
 * Purpose:
 * - Names the repeated mover sound channel expression from `game/g_func.c`.
 */
const MOVE_SOUND_CHANNEL = CHAN_NO_PHS_ADD + CHAN_VOICE;

/**
 * Original name: Move_Done
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Stops linear movement and fires the registered move end callback.
 */
export function Move_Done(ent: GameEntity, runtime: GameRuntime): void {
  ent.velocity = [0, 0, 0];
  ent.moveinfo.endfunc?.(ent, runtime);
}

/**
 * Original name: Move_Final
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies the last fractional frame of a linear pusher movement.
 */
export function Move_Final(ent: GameEntity, runtime: GameRuntime): void {
  if (ent.moveinfo.remaining_distance === 0) {
    Move_Done(ent, runtime);
    return;
  }

  const scale = ent.moveinfo.remaining_distance / FRAMETIME;
  ent.velocity = scaleVec3(ent.moveinfo.dir, scale);
  ent.think = Move_Done;
  ent.nextthink = runtime.time + FRAMETIME;
}

/**
 * Original name: Move_Begin
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Starts the constant-speed linear movement branch for one brush model.
 */
export function Move_Begin(ent: GameEntity, runtime: GameRuntime): void {
  if ((ent.moveinfo.speed * FRAMETIME) >= ent.moveinfo.remaining_distance) {
    Move_Final(ent, runtime);
    return;
  }

  ent.velocity = scaleVec3(ent.moveinfo.dir, ent.moveinfo.speed);
  const frames = Math.floor((ent.moveinfo.remaining_distance / ent.moveinfo.speed) / FRAMETIME);
  ent.moveinfo.remaining_distance -= frames * ent.moveinfo.speed * FRAMETIME;
  ent.nextthink = runtime.time + (frames * FRAMETIME);
  ent.think = Move_Final;
}

/**
 * Original name: plat_CalcAcceleratedMove
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Computes the accelerated move profile used by platforms and configurable doors.
 */
export function plat_CalcAcceleratedMove(moveinfo: GameEntity["moveinfo"]): void {
  moveinfo.move_speed = moveinfo.speed;

  if (moveinfo.remaining_distance < moveinfo.accel) {
    moveinfo.current_speed = moveinfo.remaining_distance;
    return;
  }

  const accel_dist = accelerationDistance(moveinfo.speed, moveinfo.accel);
  let decel_dist = accelerationDistance(moveinfo.speed, moveinfo.decel);

  if ((moveinfo.remaining_distance - accel_dist - decel_dist) < 0) {
    const f = (moveinfo.accel + moveinfo.decel) / (moveinfo.accel * moveinfo.decel);
    moveinfo.move_speed = (-2 + Math.sqrt(4 - 4 * f * (-2 * moveinfo.remaining_distance))) / (2 * f);
    decel_dist = accelerationDistance(moveinfo.move_speed, moveinfo.decel);
  }

  moveinfo.decel_distance = decel_dist;
}

/**
 * Original name: plat_Accelerate
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Advances one accelerated movement profile by one server frame.
 */
export function plat_Accelerate(moveinfo: GameEntity["moveinfo"]): void {
  if (moveinfo.remaining_distance <= moveinfo.decel_distance) {
    if (moveinfo.remaining_distance < moveinfo.decel_distance) {
      if (moveinfo.next_speed) {
        moveinfo.current_speed = moveinfo.next_speed;
        moveinfo.next_speed = 0;
        return;
      }
      if (moveinfo.current_speed > moveinfo.decel) {
        moveinfo.current_speed -= moveinfo.decel;
      }
    }
    return;
  }

  if (moveinfo.current_speed === moveinfo.move_speed) {
    if ((moveinfo.remaining_distance - moveinfo.current_speed) < moveinfo.decel_distance) {
      const p1_distance = moveinfo.remaining_distance - moveinfo.decel_distance;
      const p2_distance = moveinfo.move_speed * (1.0 - (p1_distance / moveinfo.move_speed));
      const distance = p1_distance + p2_distance;
      moveinfo.current_speed = moveinfo.move_speed;
      moveinfo.next_speed = moveinfo.move_speed - moveinfo.decel * (p2_distance / distance);
      return;
    }
  }

  if (moveinfo.current_speed < moveinfo.speed) {
    const old_speed = moveinfo.current_speed;
    moveinfo.current_speed += moveinfo.accel;
    if (moveinfo.current_speed > moveinfo.speed) {
      moveinfo.current_speed = moveinfo.speed;
    }

    if ((moveinfo.remaining_distance - moveinfo.current_speed) >= moveinfo.decel_distance) {
      return;
    }

    const p1_distance = moveinfo.remaining_distance - moveinfo.decel_distance;
    const p1_speed = (old_speed + moveinfo.move_speed) / 2.0;
    const p2_distance = moveinfo.move_speed * (1.0 - (p1_distance / p1_speed));
    const distance = p1_distance + p2_distance;
    moveinfo.current_speed = (p1_speed * (p1_distance / distance)) + (moveinfo.move_speed * (p2_distance / distance));
    moveinfo.next_speed = moveinfo.move_speed - moveinfo.decel * (p2_distance / distance);
  }
}

/**
 * Original name: Think_AccelMove
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Updates one accelerated pusher movement for the next server frame.
 */
export function Think_AccelMove(ent: GameEntity, runtime: GameRuntime): void {
  ent.moveinfo.remaining_distance -= ent.moveinfo.current_speed;

  if (ent.moveinfo.current_speed === 0) {
    plat_CalcAcceleratedMove(ent.moveinfo);
  }

  plat_Accelerate(ent.moveinfo);

  if (ent.moveinfo.remaining_distance <= ent.moveinfo.current_speed) {
    Move_Final(ent, runtime);
    return;
  }

  ent.velocity = scaleVec3(ent.moveinfo.dir, ent.moveinfo.current_speed * 10);
  ent.nextthink = runtime.time + FRAMETIME;
  ent.think = Think_AccelMove;
}

/**
 * Original name: Move_Calc
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Prepares one linear brush move toward the requested destination.
 */
export function Move_Calc(ent: GameEntity, dest: [number, number, number], func: (entity: GameEntity, runtime: GameRuntime) => void, runtime: GameRuntime): void {
  ent.velocity = [0, 0, 0];
  ent.moveinfo.dir = [
    dest[0] - ent.origin[0],
    dest[1] - ent.origin[1],
    dest[2] - ent.origin[2]
  ];
  ent.moveinfo.remaining_distance = normalizeVec3(ent.moveinfo.dir);
  ent.moveinfo.endfunc = func;

  if (ent.moveinfo.speed === ent.moveinfo.accel && ent.moveinfo.speed === ent.moveinfo.decel) {
    const currentMover = ((ent.flags & FL_TEAMSLAVE) !== 0 ? ent.teammaster : ent);
    if (runtime.current_entity === currentMover) {
      Move_Begin(ent, runtime);
    } else {
      ent.nextthink = runtime.time + FRAMETIME;
      ent.think = Move_Begin;
    }
  } else {
    ent.moveinfo.current_speed = 0;
    ent.think = Think_AccelMove;
    ent.nextthink = runtime.time + FRAMETIME;
  }
}

/**
 * Original name: AngleMove_Done
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Stops angular movement and fires the registered move end callback.
 */
export function AngleMove_Done(ent: GameEntity, runtime: GameRuntime): void {
  ent.avelocity = [0, 0, 0];
  ent.moveinfo.endfunc?.(ent, runtime);
}

/**
 * Original name: AngleMove_Final
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies the last angular frame for a rotating brush model.
 */
export function AngleMove_Final(ent: GameEntity, runtime: GameRuntime): void {
  const move = ent.moveinfo.state === STATE_UP
    ? subtractVec3(ent.moveinfo.end_angles, ent.angles)
    : subtractVec3(ent.moveinfo.start_angles, ent.angles);

  if (isZeroVec3(move)) {
    AngleMove_Done(ent, runtime);
    return;
  }

  ent.avelocity = scaleVec3(move, 1.0 / FRAMETIME);
  ent.think = AngleMove_Done;
  ent.nextthink = runtime.time + FRAMETIME;
}

/**
 * Original name: AngleMove_Begin
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Starts the constant-speed angular movement branch for rotating doors.
 */
export function AngleMove_Begin(ent: GameEntity, runtime: GameRuntime): void {
  const destdelta = ent.moveinfo.state === STATE_UP
    ? subtractVec3(ent.moveinfo.end_angles, ent.angles)
    : subtractVec3(ent.moveinfo.start_angles, ent.angles);
  const len = vec3Length(destdelta);
  const traveltime = len / ent.moveinfo.speed;

  if (traveltime < FRAMETIME) {
    AngleMove_Final(ent, runtime);
    return;
  }

  const frames = Math.floor(traveltime / FRAMETIME);
  ent.avelocity = scaleVec3(destdelta, 1.0 / traveltime);
  ent.nextthink = runtime.time + frames * FRAMETIME;
  ent.think = AngleMove_Final;
}

/**
 * Original name: AngleMove_Calc
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Prepares one angular brush move and starts it immediately for the active mover.
 */
export function AngleMove_Calc(ent: GameEntity, func: (entity: GameEntity, runtime: GameRuntime) => void, runtime: GameRuntime): void {
  ent.avelocity = [0, 0, 0];
  ent.moveinfo.endfunc = func;
  const currentMover = ((ent.flags & FL_TEAMSLAVE) !== 0 ? ent.teammaster : ent);
  if (runtime.current_entity === currentMover) {
    AngleMove_Begin(ent, runtime);
  } else {
    ent.nextthink = runtime.time + FRAMETIME;
    ent.think = AngleMove_Begin;
  }
}

/**
 * Original name: door_use_areaportals
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Resolves linked `func_areaportal` entities targeted by the door and toggles their logical open state.
 *
 * Porting notes:
 * - The original `gi.SetAreaPortalState` call is mapped to `CM_SetAreaPortalState` through the runtime collision world.
 * - Harness runtimes without collision keep only the log side effect.
 */
export function door_use_areaportals(self: GameEntity, open: boolean, runtime: GameRuntime): void {
  if (!self.target) {
    return;
  }

  let entity: GameEntity | null = null;
  while ((entity = G_Find(runtime, entity, "targetname", self.target)) !== null) {
    if (entity.classname !== "func_areaportal") {
      continue;
    }

    if (runtime.collision) {
      CM_SetAreaPortalState(runtime.collision.world, entity.style, open);
    }
    runtime.log({
      kind: "use",
      message: `${getRuntimeEntityLabel(self)} areaportal ${open ? "open" : "close"} -> ${getRuntimeEntityLabel(entity)}`,
      entityIndex: self.index,
      entityClassname: self.classname,
      otherIndex: entity.index,
      otherClassname: entity.classname
    });
  }
}

/**
 * Original name: door_hit_top
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Marks the door as fully open and schedules the return trip when appropriate.
 */
export function door_hit_top(self: GameEntity, runtime: GameRuntime): void {
  stopMoverLoop(self, runtime);
  self.moveinfo.state = STATE_TOP;
  runtime.log({
    kind: "think",
    message: `${getRuntimeEntityLabel(self)} hit top`,
    entityIndex: self.index,
    entityClassname: self.classname
  });

  if ((self.spawnflags & DOOR_TOGGLE) !== 0) {
    return;
  }

  if (self.moveinfo.wait >= 0) {
    self.think = door_go_down;
    self.nextthink = runtime.time + self.moveinfo.wait;
  }
}

/**
 * Original name: door_hit_bottom
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Marks the door as fully closed and closes linked area portals.
 */
export function door_hit_bottom(self: GameEntity, runtime: GameRuntime): void {
  stopMoverLoop(self, runtime);
  self.moveinfo.state = STATE_BOTTOM;
  runtime.log({
    kind: "think",
    message: `${getRuntimeEntityLabel(self)} hit bottom`,
    entityIndex: self.index,
    entityClassname: self.classname
  });
  door_use_areaportals(self, false, runtime);
}

/**
 * Original name: door_go_down
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Starts the closing phase of one door.
 */
export function door_go_down(self: GameEntity, runtime: GameRuntime): void {
  startMoverLoop(self, runtime);
  if (self.max_health > 0) {
    self.takedamage = damage_t.DAMAGE_YES;
    self.health = self.max_health;
  }

  self.moveinfo.state = STATE_DOWN;
  if (self.classname === "func_door") {
    Move_Calc(self, self.moveinfo.start_origin, door_hit_bottom, runtime);
  } else if (self.classname === "func_door_rotating") {
    AngleMove_Calc(self, door_hit_bottom, runtime);
  }
}

/**
 * Original name: door_go_up
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Starts the opening phase of one door and fires its linked targets.
 */
export function door_go_up(self: GameEntity, activator: GameEntity | null, runtime: GameRuntime): void {
  if (self.moveinfo.state === STATE_UP) {
    return;
  }

  if (self.moveinfo.state === STATE_TOP) {
    if (self.moveinfo.wait >= 0) {
      self.nextthink = runtime.time + self.moveinfo.wait;
    }
    return;
  }

  startMoverLoop(self, runtime);
  self.moveinfo.state = STATE_UP;
  if (self.classname === "func_door") {
    Move_Calc(self, self.moveinfo.end_origin, door_hit_top, runtime);
  } else if (self.classname === "func_door_rotating") {
    AngleMove_Calc(self, door_hit_top, runtime);
  }
  G_UseTargets(runtime, self, activator);
  door_use_areaportals(self, true, runtime);
}

/**
 * Original name: door_use
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Activates one door team, handling toggle semantics and propagating to all team members.
 */
export function door_use(self: GameEntity, _other: GameEntity | null, activator: GameEntity | null, runtime: GameRuntime): void {
  if ((self.flags & FL_TEAMSLAVE) !== 0) {
    return;
  }

  if ((self.spawnflags & DOOR_TOGGLE) !== 0 && (self.moveinfo.state === STATE_UP || self.moveinfo.state === STATE_TOP)) {
    forEachDoorTeam(self, (entity) => {
      entity.message = undefined;
      entity.touch = undefined;
      door_go_down(entity, runtime);
    });
    return;
  }

  forEachDoorTeam(self, (entity) => {
    entity.message = undefined;
    entity.touch = undefined;
    door_go_up(entity, activator, runtime);
  });
}

/**
 * Original name: Touch_DoorTrigger
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Opens the owning door when an eligible player or monster touches its trigger helper.
 */
export function Touch_DoorTrigger(self: GameEntity, other: GameEntity, runtime: GameRuntime): void {
  if (other.health <= 0) {
    return;
  }

  if ((other.svflags & SVF_MONSTER) === 0 && !other.client) {
    return;
  }

  if (self.owner && (self.owner.spawnflags & DOOR_NOMONSTER) !== 0 && (other.svflags & SVF_MONSTER) !== 0) {
    return;
  }

  if (runtime.time < self.touch_debounce_time) {
    return;
  }

  self.touch_debounce_time = runtime.time + 1.0;
  if (self.owner) {
    door_use(self.owner, other, other, runtime);
  }
}

/**
 * Original name: Think_CalcMoveSpeed
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Harmonizes per-door movement speed across one team so they complete together.
 *
 * Porting notes:
 * - Retains the team-speed adjustment logic even though brush movement is still time-simulated.
 */
export function Think_CalcMoveSpeed(self: GameEntity, runtime: GameRuntime): void {
  if ((self.flags & FL_TEAMSLAVE) !== 0) {
    return;
  }

  let min = Math.abs(self.moveinfo.distance);
  let entity = self.teamchain;
  while (entity) {
    const distance = Math.abs(entity.moveinfo.distance);
    if (distance < min) {
      min = distance;
    }
    entity = entity.teamchain;
  }

  const time = min / self.moveinfo.speed;

  forEachDoorTeam(self, (member) => {
    const newspeed = Math.abs(member.moveinfo.distance) / time;
    const ratio = newspeed / member.moveinfo.speed;

    if (member.moveinfo.accel === member.moveinfo.speed) {
      member.moveinfo.accel = newspeed;
    } else {
      member.moveinfo.accel *= ratio;
    }

    if (member.moveinfo.decel === member.moveinfo.speed) {
      member.moveinfo.decel = newspeed;
    } else {
      member.moveinfo.decel *= ratio;
    }

    member.moveinfo.speed = newspeed;
  });

  runtime.log({
    kind: "think",
    message: `${getRuntimeEntityLabel(self)} calc move speed`,
    entityIndex: self.index,
    entityClassname: self.classname
  });
}

/**
 * Original name: Think_SpawnDoorTrigger
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns the touch trigger helper used by untargeted doors.
 *
 * Porting notes:
 * - Uses the runtime entity adapter for the C `G_Spawn`/`gi.linkentity` pair.
 */
export function Think_SpawnDoorTrigger(ent: GameEntity, runtime: GameRuntime): void {
  if ((ent.flags & FL_TEAMSLAVE) !== 0) {
    return;
  }

  const other = spawnGameEntity(runtime);
  other.classname = "door_trigger";
  other.owner = ent;
  other.solid = SOLID_TRIGGER;
  other.movetype = MOVETYPE_NONE;
  other.touch = Touch_DoorTrigger;
  const triggerBounds = computeDoorTriggerBounds(ent);
  other.origin = [0, 0, 0];
  other.mins = [...triggerBounds.mins];
  other.maxs = [...triggerBounds.maxs];
  refreshEntitySpatialState(other);
  linkGameEntity(runtime, other);

  runtime.log({
    kind: "think",
    message: `${getRuntimeEntityLabel(ent)} spawned door trigger #${other.index}`,
    entityIndex: ent.index,
    entityClassname: ent.classname,
    otherIndex: other.index,
    otherClassname: other.classname
  });

  if ((ent.spawnflags & DOOR_START_OPEN) !== 0) {
    door_use_areaportals(ent, true, runtime);
  }

  Think_CalcMoveSpeed(ent, runtime);
}

/**
 * Original name: door_blocked
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Damages or explodes a door blocker, then reverses the owning door team unless the door is a crusher.
 */
export function door_blocked(self: GameEntity, other: GameEntity, runtime: GameRuntime): void {
  runtime.log({
    kind: "warning",
    message: `${getRuntimeEntityLabel(self)} blocked by ${getRuntimeEntityLabel(other)}`,
    entityIndex: self.index,
    entityClassname: self.classname,
    otherIndex: other.index,
    otherClassname: other.classname
  });

  if ((other.svflags & SVF_MONSTER) === 0 && !other.client) {
    T_Damage(other, self, self, [0, 0, 0], other.s.origin, [0, 0, 0], 100000, 1, 0, MOD_CRUSH, runtime);
    if (other.inuse) {
      BecomeExplosion1(other, runtime);
    }
    return;
  }

  T_Damage(other, self, self, [0, 0, 0], other.s.origin, [0, 0, 0], self.dmg, 1, 0, MOD_CRUSH, runtime);

  if ((self.spawnflags & DOOR_CRUSHER) !== 0) {
    return;
  }

  if (self.moveinfo.wait >= 0) {
    const teammaster = self.teammaster ?? self;
    if (self.moveinfo.state === STATE_DOWN) {
      forEachDoorTeam(teammaster, (entity) => {
        door_go_up(entity, entity.activator, runtime);
      });
    } else {
      forEachDoorTeam(teammaster, (entity) => {
        door_go_down(entity, runtime);
      });
    }
  }
}

/**
 * Original name: door_killed
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Resets shootable door health, disables further damage, and opens the team when destroyed.
 */
export function door_killed(self: GameEntity, _inflictor: GameEntity | null, attacker: GameEntity | null, _damage: number, runtime: GameRuntime): void {
  const teammaster = self.teammaster ?? self;
  forEachDoorTeam(teammaster, (entity) => {
    entity.health = entity.max_health;
    entity.takedamage = damage_t.DAMAGE_NO;
  });
  door_use(teammaster, attacker, attacker, runtime);
}

/**
 * Original name: door_touch
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the locked/remote door message when a player touches the door directly.
 *
 * Porting notes:
 * - Queues the centerprint and sound through the local runtime adapters.
 */
export function door_touch(self: GameEntity, other: GameEntity, runtime: GameRuntime): void {
  if (!other.client) {
    return;
  }

  if (runtime.time < self.touch_debounce_time) {
    return;
  }

  self.touch_debounce_time = runtime.time + 5.0;
  emitGameCenterprint(runtime, other, self.message ?? "");
  emitRegisteredGameSound(runtime, other, registerGameSound(runtime, "misc/talk1.wav"), "misc/talk1.wav", {
    channel: CHAN_AUTO,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
}

/**
 * Original name: SP_func_door
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes one translating brush door from BSP entity properties.
 *
 * Porting notes:
 * - Uses `G_SetMovedir` and runtime deathmatch state in place of the original spawn-time globals.
 * - Computes travel distance from inline model bounds already attached to the runtime entity.
 * - Defers true pusher movement to the later movement phases.
 */
export function SP_func_door(ent: GameEntity, runtime: GameRuntime): void {
  G_SetMovedir(ent.angles, ent.movedir);
  ent.movetype = MOVETYPE_PUSH;
  ent.solid = SOLID_BSP;
  if (ent.model) {
    setGameEntityModel(runtime, ent, ent.model);
  }
  ent.blocked = door_blocked;
  ent.use = door_use;

  if (ent.sounds !== 1) {
    ent.moveinfo.sound_start = registerGameSound(runtime, "doors/dr1_strt.wav");
    ent.moveinfo.sound_middle = registerGameSound(runtime, "doors/dr1_mid.wav");
    ent.moveinfo.sound_end = registerGameSound(runtime, "doors/dr1_end.wav");
  }

  if (!ent.speed) {
    ent.speed = 100;
  }
  if (runtime.deathmatch) {
    ent.speed *= 2;
  }
  if (!ent.accel) {
    ent.accel = ent.speed;
  }
  if (!ent.decel) {
    ent.decel = ent.speed;
  }
  if (!ent.wait) {
    ent.wait = 3;
  }
  if (!ent.dmg) {
    ent.dmg = 2;
  }

  ent.pos1 = [...ent.origin];
  ent.moveinfo.distance = computeDoorDistance(ent);
  ent.pos2 = [
    ent.origin[0] + ent.movedir[0] * ent.moveinfo.distance,
    ent.origin[1] + ent.movedir[1] * ent.moveinfo.distance,
    ent.origin[2] + ent.movedir[2] * ent.moveinfo.distance
  ];

  if ((ent.spawnflags & DOOR_START_OPEN) !== 0) {
    ent.origin = [...ent.pos2];
    ent.pos2 = [...ent.pos1];
    ent.pos1 = [...ent.origin];
  }

  ent.moveinfo.state = STATE_BOTTOM;

  if (ent.health > 0) {
    ent.takedamage = damage_t.DAMAGE_YES;
    ent.die = door_killed;
    ent.max_health = ent.health;
  } else if (ent.targetname && ent.message) {
    registerGameSound(runtime, "misc/talk.wav");
    ent.touch = door_touch;
  }

  ent.moveinfo.speed = ent.speed;
  ent.moveinfo.accel = ent.accel;
  ent.moveinfo.decel = ent.decel;
  ent.moveinfo.wait = ent.wait;
  ent.moveinfo.start_origin = [...ent.pos1];
  ent.moveinfo.end_origin = [...ent.pos2];
  ent.moveinfo.start_angles = [...ent.angles];
  ent.moveinfo.end_angles = [...ent.angles];

  if ((ent.spawnflags & 16) !== 0) {
    ent.s.effects |= EF_ANIM_ALL;
  }
  if ((ent.spawnflags & 64) !== 0) {
    ent.s.effects |= EF_ANIM_ALLFAST;
  }

  if (!ent.team) {
    ent.teammaster = ent;
  }

  refreshEntitySpatialState(ent);
  linkGameEntity(runtime, ent);

  ent.nextthink = runtime.time + FRAMETIME;
  ent.think = ent.health > 0 || Boolean(ent.targetname) ? Think_CalcMoveSpeed : Think_SpawnDoorTrigger;
}

/**
 * Original name: SP_func_door_rotating
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Initializes one rotating brush door from BSP entity properties.
 *
 * Porting notes:
 * - Uses runtime sound/model/link adapters for the original `gi.*` calls.
 * - Angular movement is handled by the shared AngleMove callbacks ported from this file.
 */
export function SP_func_door_rotating(ent: GameEntity, runtime: GameRuntime): void {
  ent.angles = [0, 0, 0];
  ent.movetype = MOVETYPE_PUSH;
  ent.solid = SOLID_BSP;
  if (ent.model) {
    setGameEntityModel(runtime, ent, ent.model);
  }
  ent.blocked = door_blocked;
  ent.use = door_use;

  if (!ent.speed) {
    ent.speed = 100;
  }
  if (!ent.accel) {
    ent.accel = ent.speed;
  }
  if (!ent.decel) {
    ent.decel = ent.speed;
  }
  if (!ent.wait) {
    ent.wait = 3;
  }
  if (!ent.dmg) {
    ent.dmg = 2;
  }

  if (ent.sounds !== 1) {
    ent.moveinfo.sound_start = registerGameSound(runtime, "doors/dr1_strt.wav");
    ent.moveinfo.sound_middle = registerGameSound(runtime, "doors/dr1_mid.wav");
    ent.moveinfo.sound_end = registerGameSound(runtime, "doors/dr1_end.wav");
  }

  const distance = parseDistance(ent.properties.distance, 0) || 90;
  ent.pos1 = [...ent.angles];

  if ((ent.spawnflags & DOOR_X_AXIS) !== 0) {
    ent.movedir = [0, 0, 1];
  } else if ((ent.spawnflags & DOOR_Y_AXIS) !== 0) {
    ent.movedir = [1, 0, 0];
  } else {
    ent.movedir = [0, 1, 0];
  }

  if ((ent.spawnflags & DOOR_REVERSE) !== 0) {
    ent.movedir = [-ent.movedir[0], -ent.movedir[1], -ent.movedir[2]];
  }

  ent.pos2 = [
    ent.angles[0] + ent.movedir[0] * distance,
    ent.angles[1] + ent.movedir[1] * distance,
    ent.angles[2] + ent.movedir[2] * distance
  ];
  ent.moveinfo.distance = distance;

  if ((ent.spawnflags & DOOR_START_OPEN) !== 0) {
    ent.angles = [...ent.pos2];
    ent.pos2 = [...ent.pos1];
    ent.pos1 = [...ent.angles];
    ent.movedir = [-ent.movedir[0], -ent.movedir[1], -ent.movedir[2]];
  }

  if (ent.health > 0) {
    ent.takedamage = damage_t.DAMAGE_YES;
    ent.die = door_killed;
    ent.max_health = ent.health;
  }
  if (ent.targetname && ent.message) {
    registerGameSound(runtime, "misc/talk.wav");
    ent.touch = door_touch;
  }

  ent.moveinfo.state = STATE_BOTTOM;
  ent.moveinfo.speed = ent.speed;
  ent.moveinfo.accel = ent.accel;
  ent.moveinfo.decel = ent.decel;
  ent.moveinfo.wait = ent.wait;
  ent.moveinfo.start_origin = [...ent.origin];
  ent.moveinfo.end_origin = [...ent.origin];
  ent.moveinfo.start_angles = [...ent.pos1];
  ent.moveinfo.end_angles = [...ent.pos2];

  if ((ent.spawnflags & 16) !== 0) {
    ent.s.effects |= EF_ANIM_ALL;
  }

  if (!ent.team) {
    ent.teammaster = ent;
  }

  refreshEntitySpatialState(ent);
  linkGameEntity(runtime, ent);

  ent.nextthink = runtime.time + FRAMETIME;
  ent.think = ent.health > 0 || Boolean(ent.targetname) ? Think_CalcMoveSpeed : Think_SpawnDoorTrigger;
}

/**
 * Original name: plat_hit_top
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Marks one platform as fully raised and schedules the return trip after the original delay.
 */
export function plat_hit_top(self: GameEntity, runtime: GameRuntime): void {
  stopMoverLoop(self, runtime);
  self.moveinfo.state = STATE_TOP;
  runtime.log({
    kind: "think",
    message: `${getRuntimeEntityLabel(self)} plat hit top`,
    entityIndex: self.index,
    entityClassname: self.classname
  });

  self.think = plat_go_down;
  self.nextthink = runtime.time + 3;
}

/**
 * Original name: plat_hit_bottom
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Marks one platform as fully lowered.
 */
export function plat_hit_bottom(self: GameEntity, runtime: GameRuntime): void {
  stopMoverLoop(self, runtime);
  self.moveinfo.state = STATE_BOTTOM;
  runtime.log({
    kind: "think",
    message: `${getRuntimeEntityLabel(self)} plat hit bottom`,
    entityIndex: self.index,
    entityClassname: self.classname
  });
}

/**
 * Original name: plat_go_down
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Starts the lowering phase of one platform toward `moveinfo.end_origin`.
 */
export function plat_go_down(self: GameEntity, runtime: GameRuntime): void {
  startMoverLoop(self, runtime);
  self.moveinfo.state = STATE_DOWN;
  Move_Calc(self, self.moveinfo.end_origin, plat_hit_bottom, runtime);
}

/**
 * Original name: plat_go_up
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Starts the raising phase of one platform toward `moveinfo.start_origin`.
 */
export function plat_go_up(self: GameEntity, runtime: GameRuntime): void {
  startMoverLoop(self, runtime);
  self.moveinfo.state = STATE_UP;
  Move_Calc(self, self.moveinfo.start_origin, plat_hit_top, runtime);
}

/**
 * Original name: plat_blocked
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Damages or explodes a platform blocker, then reverses the platform while moving.
 */
export function plat_blocked(self: GameEntity, other: GameEntity, runtime: GameRuntime): void {
  if ((other.svflags & SVF_MONSTER) === 0 && !other.client) {
    T_Damage(other, self, self, [0, 0, 0], other.s.origin, [0, 0, 0], 100000, 1, 0, MOD_CRUSH, runtime);
    if (other.inuse) {
      BecomeExplosion1(other, runtime);
    }
    return;
  }

  T_Damage(other, self, self, [0, 0, 0], other.s.origin, [0, 0, 0], self.dmg, 1, 0, MOD_CRUSH, runtime);

  if (self.moveinfo.state === STATE_UP) {
    plat_go_down(self, runtime);
  } else if (self.moveinfo.state === STATE_DOWN) {
    plat_go_up(self, runtime);
  }
}

/**
 * Original name: Use_Plat
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Lowers one targeted platform when externally activated.
 */
export function Use_Plat(self: GameEntity, _other: GameEntity | null, _activator: GameEntity | null, runtime: GameRuntime): void {
  if (self.think) {
    return;
  }

  plat_go_down(self, runtime);
}

/**
 * Original name: Touch_Plat_Center
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Raises one platform when a living player touches its center trigger and delays descent while occupied.
 */
export function Touch_Plat_Center(self: GameEntity, other: GameEntity, runtime: GameRuntime): void {
  if (!other.client) {
    return;
  }

  if (other.health <= 0) {
    return;
  }

  const plat = self.enemy;
  if (!plat) {
    return;
  }

  if (plat.moveinfo.state === STATE_BOTTOM) {
    plat_go_up(plat, runtime);
  } else if (plat.moveinfo.state === STATE_TOP) {
    plat.nextthink = runtime.time + 1;
  }
}

/**
 * Original name: plat_spawn_inside_trigger
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns the internal center trigger used by platform lifts.
 */
export function plat_spawn_inside_trigger(ent: GameEntity, runtime: GameRuntime): void {
  const trigger = spawnGameEntity(runtime);
  trigger.classname = "plat_trigger";
  trigger.touch = Touch_Plat_Center;
  trigger.movetype = MOVETYPE_NONE;
  trigger.solid = SOLID_TRIGGER;
  trigger.enemy = ent;
  trigger.origin = [0, 0, 0];

  const lip = parseDistance(ent.properties.lip, 8);
  const mins: [number, number, number] = [
    ent.mins[0] + 25,
    ent.mins[1] + 25,
    ent.mins[2]
  ];
  const maxs: [number, number, number] = [
    ent.maxs[0] - 25,
    ent.maxs[1] - 25,
    ent.maxs[2] + 8
  ];

  mins[2] = maxs[2] - (ent.pos1[2] - ent.pos2[2] + lip);
  if ((ent.spawnflags & PLAT_LOW_TRIGGER) !== 0) {
    maxs[2] = mins[2] + 8;
  }

  if (maxs[0] - mins[0] <= 0) {
    mins[0] = (ent.mins[0] + ent.maxs[0]) * 0.5;
    maxs[0] = mins[0] + 1;
  }
  if (maxs[1] - mins[1] <= 0) {
    mins[1] = (ent.mins[1] + ent.maxs[1]) * 0.5;
    maxs[1] = mins[1] + 1;
  }

  trigger.mins = mins;
  trigger.maxs = maxs;
  refreshEntitySpatialState(trigger);
  linkGameEntity(runtime, trigger);

  runtime.log({
    kind: "think",
    message: `${getRuntimeEntityLabel(ent)} spawned plat trigger #${trigger.index}`,
    entityIndex: ent.index,
    entityClassname: ent.classname,
    otherIndex: trigger.index,
    otherClassname: trigger.classname
  });
}

/**
 * Original name: SP_func_plat
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes one Quake II platform lift and its center trigger from BSP entity properties.
 *
 * Porting notes:
 * - Preserves the original top/bottom origin setup while still using timed arrival simulation until pusher physics lands.
 */
export function SP_func_plat(ent: GameEntity, runtime: GameRuntime): void {
  ent.angles = [0, 0, 0];
  ent.solid = SOLID_BSP;
  ent.movetype = MOVETYPE_PUSH;
  if (ent.model) {
    setGameEntityModel(runtime, ent, ent.model);
  }
  ent.blocked = plat_blocked;

  if (!ent.speed) {
    ent.speed = 20;
  } else {
    ent.speed *= 0.1;
  }

  if (!ent.accel) {
    ent.accel = 5;
  } else {
    ent.accel *= 0.1;
  }

  if (!ent.decel) {
    ent.decel = 5;
  } else {
    ent.decel *= 0.1;
  }

  if (!ent.dmg) {
    ent.dmg = 2;
  }

  const lip = parseDistance(ent.properties.lip, 8);
  const height = parseDistance(ent.properties.height, 0);

  ent.pos1 = [...ent.origin];
  ent.pos2 = [...ent.origin];
  if (height > 0) {
    ent.pos2[2] -= height;
  } else {
    ent.pos2[2] -= (ent.maxs[2] - ent.mins[2]) - lip;
  }

  ent.use = Use_Plat;
  plat_spawn_inside_trigger(ent, runtime);

  if (ent.targetname) {
    ent.moveinfo.state = STATE_UP;
  } else {
    ent.origin = [...ent.pos2];
    ent.moveinfo.state = STATE_BOTTOM;
  }
  refreshEntitySpatialState(ent);
  linkGameEntity(runtime, ent);

  ent.moveinfo.speed = ent.speed;
  ent.moveinfo.accel = ent.accel;
  ent.moveinfo.decel = ent.decel;
  ent.moveinfo.wait = ent.wait;
  ent.moveinfo.distance = Math.abs(ent.pos1[2] - ent.pos2[2]);
  ent.moveinfo.start_origin = [...ent.pos1];
  ent.moveinfo.start_angles = [...ent.angles];
  ent.moveinfo.end_origin = [...ent.pos2];
  ent.moveinfo.end_angles = [...ent.angles];
  ent.moveinfo.sound_start = registerGameSound(runtime, "plats/pt1_strt.wav");
  ent.moveinfo.sound_middle = registerGameSound(runtime, "plats/pt1_mid.wav");
  ent.moveinfo.sound_end = registerGameSound(runtime, "plats/pt1_end.wav");
}

/**
 * Original name: rotating_blocked
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Damages anything blocking one `func_rotating`.
 */
export function rotating_blocked(self: GameEntity, other: GameEntity, runtime: GameRuntime): void {
  T_Damage(other, self, self, [0, 0, 0], other.s.origin, [0, 0, 0], self.dmg, 1, 0, MOD_CRUSH, runtime);
}

/**
 * Original name: rotating_touch
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Damages touchers only while the brush is rotating.
 */
export function rotating_touch(self: GameEntity, other: GameEntity, runtime: GameRuntime): void {
  if (self.avelocity[0] !== 0 || self.avelocity[1] !== 0 || self.avelocity[2] !== 0) {
    T_Damage(other, self, self, [0, 0, 0], other.s.origin, [0, 0, 0], self.dmg, 1, 0, MOD_CRUSH, runtime);
  }
}

/**
 * Original name: rotating_use
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Toggles one rotating brush on and off.
 */
export function rotating_use(self: GameEntity, _other: GameEntity | null, _activator: GameEntity | null, _runtime: GameRuntime): void {
  if (!isZeroVec3(self.avelocity)) {
    self.s.sound = 0;
    self.avelocity = [0, 0, 0];
    self.touch = undefined;
    return;
  }

  self.s.sound = self.moveinfo.sound_middle;
  self.avelocity = scaleVec3(self.movedir, self.speed);
  if ((self.spawnflags & 16) !== 0) {
    self.touch = rotating_touch;
  }
}

/**
 * Original name: SP_func_rotating
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes one rotating brush model.
 */
export function SP_func_rotating(ent: GameEntity, runtime: GameRuntime): void {
  ent.solid = SOLID_BSP;
  ent.movetype = (ent.spawnflags & 32) !== 0 ? MOVETYPE_STOP : MOVETYPE_PUSH;
  if (ent.model) {
    setGameEntityModel(runtime, ent, ent.model);
  }
  ent.movedir = [0, 0, 0];
  if ((ent.spawnflags & 4) !== 0) {
    ent.movedir[2] = 1;
  } else if ((ent.spawnflags & 8) !== 0) {
    ent.movedir[0] = 1;
  } else {
    ent.movedir[1] = 1;
  }
  if ((ent.spawnflags & DOOR_REVERSE) !== 0) {
    ent.movedir = scaleVec3(ent.movedir, -1);
  }
  if (!ent.speed) {
    ent.speed = 100;
  }
  if (!ent.dmg) {
    ent.dmg = 2;
  }

  ent.use = rotating_use;
  if (ent.dmg) {
    ent.blocked = rotating_blocked;
  }
  if ((ent.spawnflags & 1) !== 0) {
    rotating_use(ent, null, null, runtime);
  }
  if ((ent.spawnflags & 64) !== 0) {
    ent.s.effects |= EF_ANIM_ALL;
  }
  if ((ent.spawnflags & 128) !== 0) {
    ent.s.effects |= EF_ANIM_ALLFAST;
  }
  refreshEntitySpatialState(ent);
  linkGameEntity(runtime, ent);
}

/**
 * Original name: button_done
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Restores a returned `func_button` to its idle animation/state.
 */
export function button_done(self: GameEntity, _runtime: GameRuntime): void {
  self.moveinfo.state = STATE_BOTTOM;
  self.s.effects &= ~EF_ANIM23;
  self.s.effects |= EF_ANIM01;
}

/**
 * Original name: button_return
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Starts a `func_button` returning to `moveinfo.start_origin`.
 * - Resets the visible frame and re-enables damage for shootable buttons.
 */
export function button_return(self: GameEntity, runtime: GameRuntime): void {
  self.moveinfo.state = STATE_DOWN;
  Move_Calc(self, self.moveinfo.start_origin, button_done, runtime);
  self.s.frame = 0;
  if (self.health) {
    self.takedamage = damage_t.DAMAGE_YES;
  }
}

/**
 * Original name: button_wait
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Marks a `func_button` as fully pressed, fires its targets, and schedules the return think when wait is non-negative.
 */
export function button_wait(self: GameEntity, runtime: GameRuntime): void {
  self.moveinfo.state = STATE_TOP;
  self.s.effects &= ~EF_ANIM01;
  self.s.effects |= EF_ANIM23;
  G_UseTargets(runtime, self, self.activator);
  self.s.frame = 1;
  if (self.moveinfo.wait >= 0) {
    self.nextthink = runtime.time + self.moveinfo.wait;
    self.think = button_return;
  }
}

/**
 * Original name: button_fire
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Ignores buttons already moving up or held at the top.
 * - Starts the upward press motion, plays the start sound for non-team slaves, and finishes with `button_wait`.
 */
export function button_fire(self: GameEntity, runtime: GameRuntime): void {
  if (self.moveinfo.state === STATE_UP || self.moveinfo.state === STATE_TOP) {
    return;
  }
  self.moveinfo.state = STATE_UP;
  if ((self.flags & FL_TEAMSLAVE) === 0) {
    emitMoverSound(runtime, self, self.moveinfo.sound_start);
  }
  Move_Calc(self, self.moveinfo.end_origin, button_wait, runtime);
}

/**
 * Original name: button_use
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Records the triggering activator and delegates the press transition to `button_fire`.
 */
export function button_use(self: GameEntity, _other: GameEntity | null, activator: GameEntity | null, runtime: GameRuntime): void {
  self.activator = activator;
  button_fire(self, runtime);
}

/**
 * Original name: button_touch
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Ignores non-client and dead client touchers.
 * - Records the touching client as activator and delegates the press transition to `button_fire`.
 */
export function button_touch(self: GameEntity, other: GameEntity, runtime: GameRuntime): void {
  if (!other.client || other.health <= 0) {
    return;
  }
  self.activator = other;
  button_fire(self, runtime);
}

/**
 * Original name: button_killed
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Converts a shootable button hit into one button press.
 * - Records the attacker as activator, restores button health, disables damage while moving and delegates to `button_fire`.
 */
export function button_killed(self: GameEntity, _inflictor: GameEntity | null, attacker: GameEntity | null, _damage: number, runtime: GameRuntime): void {
  self.activator = attacker;
  self.health = self.max_health;
  self.takedamage = damage_t.DAMAGE_NO;
  button_fire(self, runtime);
}

/**
 * Original name: SP_func_button
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Initializes one pressable or shootable brush button, including movement endpoints, callbacks, default sounds/timing, and BSP linking.
 *
 * Porting notes:
 * - The original `st.lip` spawn temp is read from the entity property bag; model and sound registration go through the runtime adapters.
 */
export function SP_func_button(ent: GameEntity, runtime: GameRuntime): void {
  G_SetMovedir(ent.s.angles, ent.movedir);
  ent.angles = [...ent.s.angles];
  ent.movetype = MOVETYPE_STOP;
  ent.solid = SOLID_BSP;
  if (ent.model) {
    setGameEntityModel(runtime, ent, ent.model);
  }
  if (ent.sounds !== 1) {
    ent.moveinfo.sound_start = registerGameSound(runtime, "switches/butn2.wav");
  }
  if (!ent.speed) {
    ent.speed = 40;
  }
  if (!ent.accel) {
    ent.accel = ent.speed;
  }
  if (!ent.decel) {
    ent.decel = ent.speed;
  }
  if (!ent.wait) {
    ent.wait = 3;
  }

  const lip = parseDistance(ent.properties.lip, 4);
  const absMovedir = absVec3(ent.movedir);
  const dist = absMovedir[0] * ent.size[0] + absMovedir[1] * ent.size[1] + absMovedir[2] * ent.size[2] - lip;
  ent.pos1 = [...ent.origin];
  ent.pos2 = addVec3(ent.pos1, scaleVec3(ent.movedir, dist));
  ent.use = button_use;
  ent.moveinfo.state = STATE_BOTTOM;
  ent.moveinfo.speed = ent.speed;
  ent.moveinfo.accel = ent.accel;
  ent.moveinfo.decel = ent.decel;
  ent.moveinfo.wait = ent.wait;
  ent.moveinfo.start_origin = [...ent.pos1];
  ent.moveinfo.end_origin = [...ent.pos2];
  ent.moveinfo.start_angles = [...ent.angles];
  ent.moveinfo.end_angles = [...ent.angles];
  if (ent.health) {
    ent.max_health = ent.health;
    ent.takedamage = damage_t.DAMAGE_YES;
    ent.die = button_killed;
  } else if (!ent.targetname) {
    ent.touch = button_touch;
  }
  ent.s.effects |= EF_ANIM01;
  refreshEntitySpatialState(ent);
  linkGameEntity(runtime, ent);
}

/**
 * Original name: SP_func_water
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes one moveable water brush using the same door movement callbacks.
 *
 * Porting notes:
 * - Reads `lip` from the parsed entity properties in place of the original spawn-temp `st.lip`.
 * - Model and sound registration go through the runtime adapters before the brush is linked.
 */
export function SP_func_water(self: GameEntity, runtime: GameRuntime): void {
  G_SetMovedir(self.angles, self.movedir);
  self.movetype = MOVETYPE_PUSH;
  self.solid = SOLID_BSP;
  if (self.model) {
    setGameEntityModel(runtime, self, self.model);
  }
  if (self.sounds === 1 || self.sounds === 2) {
    self.moveinfo.sound_start = registerGameSound(runtime, "world/mov_watr.wav");
    self.moveinfo.sound_end = registerGameSound(runtime, "world/stp_watr.wav");
  }
  self.pos1 = [...self.origin];
  const absMovedir = absVec3(self.movedir);
  self.moveinfo.distance = absMovedir[0] * self.size[0] + absMovedir[1] * self.size[1] + absMovedir[2] * self.size[2] - parseDistance(self.properties.lip, 0);
  self.pos2 = addVec3(self.pos1, scaleVec3(self.movedir, self.moveinfo.distance));
  if ((self.spawnflags & DOOR_START_OPEN) !== 0) {
    self.origin = [...self.pos2];
    self.pos2 = [...self.pos1];
    self.pos1 = [...self.origin];
  }
  self.moveinfo.start_origin = [...self.pos1];
  self.moveinfo.start_angles = [...self.angles];
  self.moveinfo.end_origin = [...self.pos2];
  self.moveinfo.end_angles = [...self.angles];
  self.moveinfo.state = STATE_BOTTOM;
  if (!self.speed) {
    self.speed = 25;
  }
  self.moveinfo.speed = self.speed;
  self.moveinfo.accel = self.speed;
  self.moveinfo.decel = self.speed;
  if (!self.wait) {
    self.wait = -1;
  }
  self.moveinfo.wait = self.wait;
  self.use = door_use;
  if (self.wait === -1) {
    self.spawnflags |= DOOR_TOGGLE;
  }
  self.classname = "func_door";
  refreshEntitySpatialState(self);
  linkGameEntity(runtime, self);
}

/**
 * Original name: train_blocked
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Crushes non-monster/non-client blockers and turns surviving debris into an explosion.
 * - Applies debounced crush damage to monsters and clients.
 *
 * Porting notes:
 * - The original `level.time` and temp-entity side effects are routed through `GameRuntime`.
 */
export function train_blocked(self: GameEntity, other: GameEntity, runtime: GameRuntime): void {
  if ((other.svflags & SVF_MONSTER) === 0 && !other.client) {
    T_Damage(other, self, self, [0, 0, 0], other.s.origin, [0, 0, 0], 100000, 1, 0, MOD_CRUSH, runtime);
    if (other.inuse) {
      BecomeExplosion1(other, runtime);
    }
    return;
  }
  if (runtime.time < self.touch_debounce_time || !self.dmg) {
    return;
  }
  self.touch_debounce_time = runtime.time + 0.5;
  T_Damage(other, self, self, [0, 0, 0], other.s.origin, [0, 0, 0], self.dmg, 1, 0, MOD_CRUSH, runtime);
}

/**
 * Original name: train_wait
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Fires a reached path corner's `pathtarget` while preserving its original target.
 * - Schedules the next train movement, handles toggle trains with negative waits, and stops end sounds.
 */
export function train_wait(self: GameEntity, runtime: GameRuntime): void {
  if (self.target_ent?.pathtarget) {
    const ent = self.target_ent;
    const savetarget = ent.target;
    ent.target = ent.pathtarget;
    G_UseTargets(runtime, ent, self.activator);
    ent.target = savetarget;
    if (!self.inuse) {
      return;
    }
  }
  if (self.moveinfo.wait) {
    if (self.moveinfo.wait > 0) {
      self.nextthink = runtime.time + self.moveinfo.wait;
      self.think = train_next;
    } else if ((self.spawnflags & TRAIN_TOGGLE) !== 0) {
      train_next(self, runtime);
      self.spawnflags &= ~TRAIN_START_ON;
      self.velocity = [0, 0, 0];
      self.nextthink = 0;
    }
    if ((self.flags & FL_TEAMSLAVE) === 0) {
      emitMoverSound(runtime, self, self.moveinfo.sound_end);
      self.s.sound = 0;
    }
  } else {
    train_next(self, runtime);
  }
}

/**
 * Original name: train_next
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Advances a `func_train` to the next `path_corner`, handling one teleport corner first.
 * - Starts mover sound state, records movement endpoints, and schedules `train_wait`.
 *
 * Porting notes:
 * - `G_PickTarget`, logging, linking, and `Move_Calc` are routed through the TypeScript runtime adapter.
 */
export function train_next(self: GameEntity, runtime: GameRuntime): void {
  let first = true;
  while (true) {
    if (!self.target) {
      return;
    }
    const ent = G_PickTarget(runtime, self.target);
    if (!ent) {
      runtime.log({ kind: "warning", message: `train_next: bad target ${self.target}`, entityIndex: self.index, entityClassname: self.classname });
      return;
    }
    self.target = ent.target;
    if ((ent.spawnflags & 1) !== 0) {
      if (!first) {
        runtime.log({ kind: "warning", message: `connected teleport path_corners, see ${ent.classname} at ${vtos(ent.s.origin)}`, entityIndex: self.index, entityClassname: self.classname });
        return;
      }
      first = false;
      setEntityOrigin(self, subtractVec3(ent.s.origin, self.mins));
      self.s.old_origin = [...self.s.origin];
      self.s.event = entity_event_t.EV_OTHER_TELEPORT;
      linkGameEntity(runtime, self);
      continue;
    }
    self.moveinfo.wait = ent.wait;
    self.target_ent = ent;
    if ((self.flags & FL_TEAMSLAVE) === 0) {
      emitMoverSound(runtime, self, self.moveinfo.sound_start);
      self.s.sound = self.moveinfo.sound_middle;
    }
    const dest = subtractVec3(ent.s.origin, self.mins);
    self.moveinfo.state = STATE_TOP;
    self.moveinfo.start_origin = [...self.origin];
    self.moveinfo.end_origin = [...dest];
    Move_Calc(self, dest, train_wait, runtime);
    self.spawnflags |= TRAIN_START_ON;
    return;
  }
}

/**
 * Original name: train_resume
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Resumes a stopped `func_train` toward its current `target_ent` path corner.
 * - Rebuilds movement endpoints from the current origin and schedules `train_wait`.
 *
 * Porting notes:
 * - `Move_Calc` receives the explicit runtime adapter used by the TypeScript movement loop.
 */
export function train_resume(self: GameEntity, runtime: GameRuntime): void {
  const ent = self.target_ent;
  if (!ent) {
    return;
  }
  const dest = subtractVec3(ent.s.origin, self.mins);
  self.moveinfo.state = STATE_TOP;
  self.moveinfo.start_origin = [...self.origin];
  self.moveinfo.end_origin = [...dest];
  Move_Calc(self, dest, train_wait, runtime);
  self.spawnflags |= TRAIN_START_ON;
}

/**
 * Original name: func_train_find
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Resolves the first `path_corner` for a spawned `func_train`, moves the brush to it, and links it.
 * - Auto-starts untargeted trains by scheduling `train_next`; targeted trains wait for `train_use`.
 *
 * Porting notes:
 * - `G_PickTarget`, warning output, origin updates, and `gi.linkentity` are routed through runtime adapters.
 */
export function func_train_find(self: GameEntity, runtime: GameRuntime): void {
  if (!self.target) {
    runtime.log({ kind: "warning", message: "train_find: no target", entityIndex: self.index, entityClassname: self.classname });
    return;
  }
  const ent = G_PickTarget(runtime, self.target);
  if (!ent) {
    runtime.log({ kind: "warning", message: `train_find: target ${self.target} not found`, entityIndex: self.index, entityClassname: self.classname });
    return;
  }
  self.target = ent.target;
  setEntityOrigin(self, subtractVec3(ent.s.origin, self.mins));
  linkGameEntity(runtime, self);
  if (!self.targetname) {
    self.spawnflags |= TRAIN_START_ON;
  }
  if ((self.spawnflags & TRAIN_START_ON) !== 0) {
    self.nextthink = runtime.time + FRAMETIME;
    self.think = train_next;
    self.activator = self;
  }
}

/**
 * Original name: train_use
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Handles trigger/use activation for trains, including toggle stop, resume toward `target_ent`, or first `train_next`.
 * - Stores the activator exactly like the C callback before deciding whether movement changes.
 *
 * Porting notes:
 * - The explicit runtime parameter replaces the implicit global engine context used by `train_next`/`train_resume`.
 */
export function train_use(self: GameEntity, _other: GameEntity | null, activator: GameEntity | null, runtime: GameRuntime): void {
  self.activator = activator;
  if ((self.spawnflags & TRAIN_START_ON) !== 0) {
    if ((self.spawnflags & TRAIN_TOGGLE) === 0) {
      return;
    }
    self.spawnflags &= ~TRAIN_START_ON;
    self.velocity = [0, 0, 0];
    self.nextthink = 0;
  } else if (self.target_ent) {
    train_resume(self, runtime);
  } else {
    train_next(self, runtime);
  }
}

/**
 * Original name: SP_func_train
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Spawns a moving brush train with pusher physics, model, damage, loop sound, use and blocked callbacks.
 * - Schedules `func_train_find` on the next frame when a first `path_corner` target is configured.
 *
 * Porting notes:
 * - `setGameEntityModel`, `registerGameSound` and `linkGameEntity` adapt the original `gi.*` calls.
 */
export function SP_func_train(self: GameEntity, runtime: GameRuntime): void {
  self.movetype = MOVETYPE_PUSH;
  self.angles = [0, 0, 0];
  self.s.angles = [0, 0, 0];
  self.blocked = train_blocked;
  self.dmg = (self.spawnflags & TRAIN_BLOCK_STOPS) !== 0 ? 0 : (self.dmg || 100);
  self.solid = SOLID_BSP;
  if (self.model) {
    setGameEntityModel(runtime, self, self.model);
  }
  const noise = self.properties.noise;
  if (noise) {
    self.moveinfo.sound_middle = registerGameSound(runtime, noise);
  }
  if (!self.speed) {
    self.speed = 100;
  }
  self.moveinfo.speed = self.speed;
  self.moveinfo.accel = self.speed;
  self.moveinfo.decel = self.speed;
  self.use = train_use;
  refreshEntitySpatialState(self);
  linkGameEntity(runtime, self);
  if (self.target) {
    self.nextthink = runtime.time + FRAMETIME;
    self.think = func_train_find;
  } else {
    runtime.log({ kind: "warning", message: `func_train without a target at ${vtos(self.absmin)}`, entityIndex: self.index, entityClassname: self.classname });
  }
}

/**
 * Original name: trigger_elevator_use
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Uses the caller's `pathtarget` to select a path corner for the elevator train, then resumes that train.
 * - Ignores use while the target train already has a pending think.
 *
 * Porting notes:
 * - Runtime logs replace `gi.dprintf`; the nullable guards only protect malformed adapter calls.
 */
export function trigger_elevator_use(self: GameEntity, other: GameEntity | null, _activator: GameEntity | null, runtime: GameRuntime): void {
  if (self.movetarget?.nextthink) {
    return;
  }
  if (!other?.pathtarget) {
    runtime.log({ kind: "warning", message: "elevator used with no pathtarget", entityIndex: self.index, entityClassname: self.classname });
    return;
  }
  const target = G_PickTarget(runtime, other.pathtarget);
  if (!target) {
    runtime.log({ kind: "warning", message: `elevator used with bad pathtarget: ${other.pathtarget}`, entityIndex: self.index, entityClassname: self.classname });
    return;
  }
  if (self.movetarget) {
    self.movetarget.target_ent = target;
    train_resume(self.movetarget, runtime);
  }
}

/**
 * Original name: trigger_elevator_init
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Resolves the configured elevator target, verifies that it points at a `func_train`,
 *   then installs `trigger_elevator_use` and hides the trigger from clients.
 *
 * Porting notes:
 * - Uses runtime warning logs in place of `gi.dprintf`.
 */
export function trigger_elevator_init(self: GameEntity, runtime: GameRuntime): void {
  if (!self.target) {
    runtime.log({ kind: "warning", message: "trigger_elevator has no target", entityIndex: self.index, entityClassname: self.classname });
    return;
  }
  self.movetarget = G_PickTarget(runtime, self.target);
  if (!self.movetarget) {
    runtime.log({ kind: "warning", message: `trigger_elevator unable to find target ${self.target}`, entityIndex: self.index, entityClassname: self.classname });
    return;
  }
  if (self.movetarget.classname !== "func_train") {
    runtime.log({ kind: "warning", message: `trigger_elevator target ${self.target} is not a train`, entityIndex: self.index, entityClassname: self.classname });
    return;
  }
  self.use = trigger_elevator_use;
  self.svflags = SVF_NOCLIENT;
}

/**
 * Original name: SP_trigger_elevator
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defers elevator trigger initialization by one frame so target trains have spawned.
 */
export function SP_trigger_elevator(self: GameEntity, runtime: GameRuntime): void {
  self.think = trigger_elevator_init;
  self.nextthink = runtime.time + FRAMETIME;
}

/**
 * Original name: func_timer_think
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Fires the timer targets with the stored activator, then schedules the next
 *   firing at `wait + crandom() * random`.
 */
export function func_timer_think(self: GameEntity, runtime: GameRuntime): void {
  G_UseTargets(runtime, self, self.activator);
  self.nextthink = runtime.time + self.wait + crandom() * self.random;
  self.think = func_timer_think;
}

/**
 * Original name: func_timer_use
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Stores the activator, toggles an active timer off by clearing `nextthink`,
 *   or starts it with `delay` before the first fire.
 *
 * Porting notes:
 * - The nullable activator type reflects the TypeScript callback adapter; normal
 *   game use still passes the trigger activator.
 */
export function func_timer_use(self: GameEntity, _other: GameEntity | null, activator: GameEntity | null, runtime: GameRuntime): void {
  self.activator = activator;
  if (self.nextthink) {
    self.nextthink = 0;
    return;
  }
  if (self.delay) {
    self.nextthink = runtime.time + self.delay;
    self.think = func_timer_think;
  } else {
    func_timer_think(self, runtime);
  }
}

/**
 * Original name: SP_func_timer
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Initializes a no-client timer trigger with default wait, use/think
 *   callbacks, random clamping, and optional START_ON scheduling.
 *
 * Porting notes:
 * - Runtime warning logs replace `gi.dprintf`; `st.pausetime` is read from the
 *   parsed spawn properties.
 */
export function SP_func_timer(self: GameEntity, runtime: GameRuntime): void {
  if (!self.wait) {
    self.wait = 1;
  }
  self.use = func_timer_use;
  self.think = func_timer_think;
  if (self.random >= self.wait) {
    self.random = self.wait - FRAMETIME;
    runtime.log({ kind: "warning", message: `func_timer at ${vtos(self.s.origin)} has random >= wait`, entityIndex: self.index, entityClassname: self.classname });
  }
  if ((self.spawnflags & 1) !== 0) {
    const pausetime = parseDistance(self.properties.pausetime, 0);
    self.nextthink = runtime.time + 1 + pausetime + self.delay + self.wait + crandom() * self.random;
    self.think = func_timer_think;
    self.activator = self;
  }
  self.svflags = SVF_NOCLIENT;
}

/**
 * Original name: func_conveyor_use
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Toggles a conveyor between stored speed and stopped state, then clears the
 *   stored speed for one-shot conveyors that do not have TOGGLE set.
 */
export function func_conveyor_use(self: GameEntity, _other: GameEntity | null, _activator: GameEntity | null, _runtime: GameRuntime): void {
  if ((self.spawnflags & 1) !== 0) {
    self.speed = 0;
    self.spawnflags &= ~1;
  } else {
    self.speed = self.count;
    self.spawnflags |= 1;
  }
  if ((self.spawnflags & 2) === 0) {
    self.count = 0;
  }
}

/**
 * Original name: SP_func_conveyor
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Initializes a stationary BSP conveyor, stores the speed when not START_ON,
 *   installs the use callback, assigns the inline model, and links it.
 *
 * Porting notes:
 * - `setGameEntityModel` and `linkGameEntity` adapt `gi.setmodel` and
 *   `gi.linkentity` to the TypeScript runtime.
 */
export function SP_func_conveyor(self: GameEntity, runtime: GameRuntime): void {
  if (!self.speed) {
    self.speed = 100;
  }
  if ((self.spawnflags & 1) === 0) {
    self.count = self.speed;
    self.speed = 0;
  }
  self.use = func_conveyor_use;
  self.solid = SOLID_BSP;
  if (self.model) {
    setGameEntityModel(runtime, self, self.model);
  }
  refreshEntitySpatialState(self);
  linkGameEntity(runtime, self);
}

/**
 * Original name: door_secret_use
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Ignores activator state, refuses to restart while the secret door is away from the origin,
 *   starts the first slide toward `pos1`, and opens linked area portals.
 */
export function door_secret_use(self: GameEntity, _other: GameEntity | null, _activator: GameEntity | null, runtime: GameRuntime): void {
  if (!isZeroVec3(self.origin)) {
    return;
  }
  Move_Calc(self, self.pos1, door_secret_move1, runtime);
  door_use_areaportals(self, true, runtime);
}

/**
 * Original name: door_secret_move1
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Waits one second after the first secret-door slide, then schedules the second move.
 */
export function door_secret_move1(self: GameEntity, runtime: GameRuntime): void {
  self.nextthink = runtime.time + 1;
  self.think = door_secret_move2;
}

/**
 * Original name: door_secret_move2
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Starts the second secret-door slide toward `pos2`, then chains into the wait phase.
 */
export function door_secret_move2(self: GameEntity, runtime: GameRuntime): void {
  Move_Calc(self, self.pos2, door_secret_move3, runtime);
}

/**
 * Original name: door_secret_move3
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Leaves one-shot secret doors open when `wait == -1`.
 * - Otherwise schedules the return sequence after the configured wait delay.
 */
export function door_secret_move3(self: GameEntity, runtime: GameRuntime): void {
  if (self.wait === -1) {
    return;
  }
  self.nextthink = runtime.time + self.wait;
  self.think = door_secret_move4;
}

/**
 * Original name: door_secret_move4
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Starts the return movement of a secret door from its lateral/open offset back to `pos1`.
 */
export function door_secret_move4(self: GameEntity, runtime: GameRuntime): void {
  Move_Calc(self, self.pos1, door_secret_move5, runtime);
}

/**
 * Original name: door_secret_move5
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Schedules the final one-second delay before the secret door returns to its origin.
 */
export function door_secret_move5(self: GameEntity, runtime: GameRuntime): void {
  self.nextthink = runtime.time + 1;
  self.think = door_secret_move6;
}

/**
 * Original name: door_secret_move6
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Starts the final secret-door return movement back to the world origin.
 */
export function door_secret_move6(self: GameEntity, runtime: GameRuntime): void {
  Move_Calc(self, [0, 0, 0], door_secret_done, runtime);
}

/**
 * Original name: door_secret_done
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Restores shootability for untargeted or always-shoot secret doors after they close.
 * - Closes linked area portals when the secret door is fully back at its origin.
 */
export function door_secret_done(self: GameEntity, runtime: GameRuntime): void {
  if (!self.targetname || (self.spawnflags & SECRET_ALWAYS_SHOOT) !== 0) {
    self.health = 0;
    self.takedamage = damage_t.DAMAGE_YES;
  }
  door_use_areaportals(self, false, runtime);
}

/**
 * Original name: door_secret_blocked
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Crushes debris/non-clients for lethal damage and explodes them if still present.
 * - Debounces monster/client crush damage and applies the door's configured damage.
 *
 * Porting notes:
 * - `other.inuse` mirrors the C `if (other)` post-damage survivor check.
 */
export function door_secret_blocked(self: GameEntity, other: GameEntity, runtime: GameRuntime): void {
  if ((other.svflags & SVF_MONSTER) === 0 && !other.client) {
    T_Damage(other, self, self, [0, 0, 0], other.s.origin, [0, 0, 0], 100000, 1, 0, MOD_CRUSH, runtime);
    if (other.inuse) {
      BecomeExplosion1(other, runtime);
    }
    return;
  }
  if (runtime.time < self.touch_debounce_time) {
    return;
  }
  self.touch_debounce_time = runtime.time + 0.5;
  T_Damage(other, self, self, [0, 0, 0], other.s.origin, [0, 0, 0], self.dmg, 1, 0, MOD_CRUSH, runtime);
}

/**
 * Original name: door_secret_die
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Makes the secret door temporarily non-shootable.
 * - Reuses the normal secret-door activation path with the attacker as caller.
 */
export function door_secret_die(self: GameEntity, _inflictor: GameEntity | null, attacker: GameEntity | null, _damage: number, runtime: GameRuntime): void {
  self.takedamage = damage_t.DAMAGE_NO;
  door_secret_use(self, attacker, attacker, runtime);
}

/**
 * Original name: SP_func_door_secret
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Spawns a secret brush door with Quake II's fixed sounds, movement speed, damage and wait defaults.
 * - Computes the back/side movement positions from `angle`, `SECRET_1ST_LEFT` and `SECRET_1ST_DOWN`.
 * - Exposes the entity as `func_door` after spawn, matching the original class rewrite.
 *
 * Porting notes:
 * - `setGameEntityModel` and `linkGameEntity` adapt `gi.setmodel`/`gi.linkentity`.
 */
export function SP_func_door_secret(ent: GameEntity, runtime: GameRuntime): void {
  ent.moveinfo.sound_start = registerGameSound(runtime, "doors/dr1_strt.wav");
  ent.moveinfo.sound_middle = registerGameSound(runtime, "doors/dr1_mid.wav");
  ent.moveinfo.sound_end = registerGameSound(runtime, "doors/dr1_end.wav");
  ent.movetype = MOVETYPE_PUSH;
  ent.solid = SOLID_BSP;
  if (ent.model) {
    setGameEntityModel(runtime, ent, ent.model);
  }
  ent.blocked = door_secret_blocked;
  ent.use = door_secret_use;
  if (!ent.targetname || (ent.spawnflags & SECRET_ALWAYS_SHOOT) !== 0) {
    ent.health = 0;
    ent.takedamage = damage_t.DAMAGE_YES;
    ent.die = door_secret_die;
  }
  if (!ent.dmg) {
    ent.dmg = 2;
  }
  if (!ent.wait) {
    ent.wait = 5;
  }
  ent.moveinfo.accel = 50;
  ent.moveinfo.decel = 50;
  ent.moveinfo.speed = 50;

  const { forward, right, up } = AngleVectors(ent.s.angles);
  ent.angles = [0, 0, 0];
  ent.s.angles = [0, 0, 0];
  const side = 1.0 - (ent.spawnflags & SECRET_1ST_LEFT);
  const width = (ent.spawnflags & SECRET_1ST_DOWN) !== 0 ? Math.abs(dotProduct(up, ent.size)) : Math.abs(dotProduct(right, ent.size));
  const length = Math.abs(dotProduct(forward, ent.size));
  ent.pos1 = (ent.spawnflags & SECRET_1ST_DOWN) !== 0
    ? addVec3(ent.origin, scaleVec3(up, -width))
    : addVec3(ent.origin, scaleVec3(right, side * width));
  ent.pos2 = addVec3(ent.pos1, scaleVec3(forward, length));
  if (ent.health) {
    ent.takedamage = damage_t.DAMAGE_YES;
    ent.die = door_killed;
    ent.max_health = ent.health;
  } else if (ent.targetname && ent.message) {
    registerGameSound(runtime, "misc/talk.wav");
    ent.touch = door_touch;
  }
  ent.classname = "func_door";
  refreshEntitySpatialState(ent);
  linkGameEntity(runtime, ent);
}

/**
 * Original name: use_killbox
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Telefrags every entity currently inside the hidden `func_killbox` brush when it is fired.
 *
 * Porting notes:
 * - `other` and `activator` are intentionally unused, matching the original callback body.
 */
export function use_killbox(self: GameEntity, _other: GameEntity | null, _activator: GameEntity | null, runtime: GameRuntime): void {
  KillBox(runtime, self);
}

/**
 * Original name: SP_func_killbox
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Registers the inline BSP model, installs `use_killbox`, and hides the brush from clients.
 *
 * Porting notes:
 * - `setGameEntityModel` and `linkGameEntity` adapt the original `gi.setmodel` import for runtime collision queries.
 */
export function SP_func_killbox(ent: GameEntity, runtime: GameRuntime): void {
  ent.use = use_killbox;
  ent.svflags = SVF_NOCLIENT;
  if (ent.model) {
    setGameEntityModel(runtime, ent, ent.model);
  }
  refreshEntitySpatialState(ent);
  linkGameEntity(runtime, ent);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose:
 * - Centralize the repeated `gi.sound` mover call used by doors, plats, trains, and water.
 */
function emitMoverSound(runtime: GameRuntime, self: GameEntity, soundIndex: number): void {
  if (!soundIndex) {
    return;
  }

  const soundPath = runtime.assets.soundPaths[soundIndex - 1];
  if (!soundPath) {
    return;
  }

  emitRegisteredGameSound(runtime, self, soundIndex, soundPath, {
    channel: MOVE_SOUND_CHANNEL,
    volume: 1,
    attenuation: ATTN_STATIC,
    timeofs: 0
  });
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose:
 * - Preserve the source mover start pattern: skip team slaves, play `sound_start`, then set `s.sound`.
 */
function startMoverLoop(self: GameEntity, runtime: GameRuntime): void {
  if ((self.flags & FL_TEAMSLAVE) !== 0) {
    return;
  }

  emitMoverSound(runtime, self, self.moveinfo.sound_start);
  self.s.sound = self.moveinfo.sound_middle;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose:
 * - Preserve the source mover stop pattern: skip team slaves, play `sound_end`, then clear `s.sound`.
 */
function stopMoverLoop(self: GameEntity, runtime: GameRuntime): void {
  if ((self.flags & FL_TEAMSLAVE) !== 0) {
    return;
  }

  emitMoverSound(runtime, self, self.moveinfo.sound_end);
  self.s.sound = 0;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose: Derive the linear translation distance of one door from its movedir and brush bounds.
 *
 * Constraints:
 * - Must keep the classic Quake lip subtraction behavior.
 */
function computeDoorDistance(entity: GameEntity): number {
  const lip = parseDistance(entity.properties.lip, 8);
  entity.movedir = parseDoorMovedir(entity.properties);

  const absMovedir = [Math.abs(entity.movedir[0]), Math.abs(entity.movedir[1]), Math.abs(entity.movedir[2])] as const;
  const distance = absMovedir[0] * entity.size[0] + absMovedir[1] * entity.size[1] + absMovedir[2] * entity.size[2] - lip;
  return distance > 0 ? distance : 64;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose: Decode the first Quake-style movedir semantics used by translating doors.
 *
 * Constraints:
 * - Must support up/down sentinels and regular yaw angles.
 */
function parseDoorMovedir(properties: Record<string, string>): [number, number, number] {
  const angle = Number.parseFloat(properties.angle ?? "0");
  if (angle === -1) {
    return [0, 0, 1];
  }
  if (angle === -2) {
    return [0, 0, -1];
  }

  const radians = (Number.isFinite(angle) ? angle : 0) * (Math.PI / 180);
  return [Math.cos(radians), Math.sin(radians), 0];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose: Parse one numeric distance-like key with a fallback.
 */
function parseDistance(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose: Add two vec3 values without mutating the inputs.
 */
function addVec3(left: vec3_t, right: vec3_t): [number, number, number] {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose: Return the component-wise absolute value used by mover distance calculations.
 */
function absVec3(vector: vec3_t): [number, number, number] {
  return [Math.abs(vector[0]), Math.abs(vector[1]), Math.abs(vector[2])];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose: Compute a vec3 dot product for translated vector macro use.
 */
function dotProduct(left: vec3_t, right: vec3_t): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose: Keep entity origin aliases in sync after translated spawn-position updates.
 */
function setEntityOrigin(entity: GameEntity, origin: vec3_t): void {
  entity.origin = [...origin];
  entity.s.origin = [...origin];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose: Reproduce the first door-trigger bounds expansion used by Quake II touch doors.
 *
 * Constraints:
 * - Must cover the full door team bounds.
 * - Must expand by 60 units on X/Y like the original `Think_SpawnDoorTrigger`.
 */
function computeDoorTriggerBounds(entity: GameEntity): { mins: [number, number, number]; maxs: [number, number, number] } {
  const bounds = getAbsoluteEntityBounds(entity);
  const mins: [number, number, number] = [...bounds.mins];
  const maxs: [number, number, number] = [...bounds.maxs];

  let member = entity.teamchain;
  while (member) {
    const memberBounds = getAbsoluteEntityBounds(member);
    mins[0] = Math.min(mins[0], memberBounds.mins[0]);
    mins[1] = Math.min(mins[1], memberBounds.mins[1]);
    mins[2] = Math.min(mins[2], memberBounds.mins[2]);
    maxs[0] = Math.max(maxs[0], memberBounds.maxs[0]);
    maxs[1] = Math.max(maxs[1], memberBounds.maxs[1]);
    maxs[2] = Math.max(maxs[2], memberBounds.maxs[2]);
    member = member.teamchain;
  }

  mins[0] -= 60;
  mins[1] -= 60;
  maxs[0] += 60;
  maxs[1] += 60;

  return { mins, maxs };
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose: Resolve absolute world bounds for one brush entity using inline-model bounds when available.
 */
function getAbsoluteEntityBounds(entity: GameEntity): { mins: [number, number, number]; maxs: [number, number, number] } {
  if (entity.model?.startsWith("*")) {
    return {
      mins: [...entity.mins],
      maxs: [...entity.maxs]
    };
  }

  return {
    mins: [
      entity.origin[0] + entity.mins[0],
      entity.origin[1] + entity.mins[1],
      entity.origin[2] + entity.mins[2]
    ],
    maxs: [
      entity.origin[0] + entity.maxs[0],
      entity.origin[1] + entity.maxs[1],
      entity.origin[2] + entity.maxs[2]
    ]
  };
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose: Iterate the linked members of one door team starting from the team master.
 *
 * Constraints:
 * - Must preserve the original teamchain order.
 */
function forEachDoorTeam(self: GameEntity, callback: (entity: GameEntity) => void): void {
  let entity: GameEntity | null = self;
  while (entity) {
    callback(entity);
    entity = entity.teamchain;
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose: Compute the original Quake acceleration distance helper.
 */
function accelerationDistance(target: number, rate: number): number {
  return target * ((target / rate) + 1) * ACCELERATION_DISTANCE_SCALE;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose: Normalize one vector in place and return its original length.
 */
function normalizeVec3(vector: [number, number, number]): number {
  const length = vec3Length(vector);
  if (length === 0) {
    vector[0] = 0;
    vector[1] = 0;
    vector[2] = 0;
    return 0;
  }

  vector[0] /= length;
  vector[1] /= length;
  vector[2] /= length;
  return length;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose: Multiply one vector by a scalar without mutating the source.
 */
function scaleVec3(vector: [number, number, number], scalar: number): [number, number, number] {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose: Subtract two vectors without mutating the inputs.
 */
function subtractVec3(left: [number, number, number], right: [number, number, number]): [number, number, number] {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose: Compute one vector Euclidean length.
 */
function vec3Length(vector: [number, number, number]): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose: Detect a zero vector for movement completion checks.
 */
function isZeroVec3(vector: [number, number, number]): boolean {
  return vector[0] === 0 && vector[1] === 0 && vector[2] === 0;
}
