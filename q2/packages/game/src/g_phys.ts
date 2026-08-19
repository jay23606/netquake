/**
 * File: g_phys.ts
 * Source: Quake II original / game/g_phys.c
 * Purpose: Port of gameplay physics dispatch, pusher movement and toss/step motion.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Sound emissions use the gameplay runtime event queue instead of `gi.sound` / `gi.positioned_sound`.
 * - Touch callbacks still use the simplified local runtime signature without plane/surface payloads.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

import {
  MOVETYPE_BOUNCE,
  MOVETYPE_FLY,
  MOVETYPE_FLYMISSILE,
  MOVETYPE_NOCLIP,
  MOVETYPE_NONE,
  MOVETYPE_PUSH,
  MOVETYPE_STEP,
  MOVETYPE_STOP,
  MOVETYPE_TOSS,
  SOLID_BSP,
  SOLID_NOT,
  SVF_MONSTER,
  FL_TEAMSLAVE,
  FRAMETIME,
  emitGameSound,
  emitRegisteredGameSound,
  getRuntimeEntityLabel,
  linkGameEntity,
  registerGameSound
} from "./runtime.js";
import type { GameEntity, GameRuntime } from "./runtime.js";
import { M_CheckBottom } from "./m_move.js";
import { M_CheckGround } from "./g_monster.js";
import { touchTriggerEntities } from "./touch.js";
import { FL_FLY, FL_SWIM } from "./g_local.js";
import {
  AngleVectors,
  ATTN_NORM,
  CHAN_AUTO,
  MASK_MONSTERSOLID,
  MASK_SOLID,
  MASK_WATER,
  type trace_t,
  type vec3_t
} from "../../qcommon/src/index.js";
import { DotProduct } from "../../math/src/q_shared.js";

const STOP_EPSILON = 0.1;
const MAX_CLIP_PLANES = 5;
const SV_MAXVELOCITY = 2000;
const SV_GRAVITY = 800;
const SV_STOPSPEED = 100;
const SV_FRICTION = 6;
const SV_WATERFRICTION = 1;

/**
 * Original name: N/A
 * Source declaree: N/A (local rollback helper)
 * Category: New
 * Purpose: Preserve the rollback state recorded for each entity moved during one pusher step.
 *
 * Constraints:
 * - Must capture enough state to restore failed pushes deterministically.
 */
interface pushed_t {
  ent: GameEntity;
  origin: [number, number, number];
  angles: [number, number, number];
  groundentity: GameEntity | null;
  groundentity_linkcount: number;
  deltaYaw: number | null;
}

let obstacle: GameEntity | null = null;

/**
 * Original name: SV_TestEntityPosition
 * Source: game/g_phys.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Tests whether one entity currently starts inside any blocking solid.
 *
 * Porting notes:
 * - Returns the runtime worldspawn entity when blocked, matching the original sentinel-style usage.
 */
export function SV_TestEntityPosition(ent: GameEntity, runtime: GameRuntime): GameEntity | null {
  ensureCollision(runtime, "SV_TestEntityPosition");

  const mask = ent.clipmask || MASK_SOLID;
  const trace = runtime.collision!.trace(ent.origin, ent.mins, ent.maxs, ent.origin, ent, mask);

  if (trace.startsolid) {
    return runtime.entities[0] ?? ent;
  }

  return null;
}

/**
 * Original name: SV_CheckVelocity
 * Source: game/g_phys.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Clamps one entity velocity to the Quake II maximum speed cvar bounds.
 *
 * Porting notes:
 * - Runtime physics call sites pass the current `sv_maxvelocity` value through explicitly.
 */
export function SV_CheckVelocity(ent: GameEntity, maxVelocity = SV_MAXVELOCITY): void {
  for (let index = 0; index < 3; index += 1) {
    if (ent.velocity[index] > maxVelocity) {
      ent.velocity[index] = maxVelocity;
    } else if (ent.velocity[index] < -maxVelocity) {
      ent.velocity[index] = -maxVelocity;
    }
  }
}

/**
 * Original name: SV_RunThink
 * Source: game/g_phys.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Runs one entity `think` callback if it is due for the current frame time.
 */
export function SV_RunThink(ent: GameEntity, runtime: GameRuntime): boolean {
  const thinktime = ent.nextthink;
  if (thinktime <= 0) {
    return true;
  }
  if (thinktime > runtime.time + 0.001) {
    return true;
  }

  ent.nextthink = 0;
  const think = ent.think;
  if (!think) {
    throw new Error(`SV_RunThink: NULL ent.think for ${getRuntimeEntityLabel(ent)}`);
  }

  runtime.log({
    kind: "think",
    message: `${getRuntimeEntityLabel(ent)} think`,
    entityIndex: ent.index,
    entityClassname: ent.classname
  });
  think(ent, runtime);

  return false;
}

/**
 * Original name: SV_Impact
 * Source: game/g_phys.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Dispatches touch callbacks for both entities involved in one blocking trace.
 */
export function SV_Impact(e1: GameEntity, trace: trace_t, runtime: GameRuntime): void {
  const e2 = asGameEntity(trace.ent);
  if (!e2) {
    return;
  }

  if (e1.touch && e1.solid !== SOLID_NOT) {
    e1.touch(e1, e2, runtime, trace.plane, trace.surface);
  }

  if (e2.touch && e2.solid !== SOLID_NOT) {
    e2.touch(e2, e1, runtime, null, null);
  }
}

/**
 * Original name: ClipVelocity
 * Source: game/g_phys.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Slides one velocity vector off one impact plane and returns the Quake blocked flags.
 */
export function ClipVelocity(
  inVector: vec3_t,
  normal: vec3_t,
  outVector: vec3_t,
  overbounce: number
): number {
  let blocked = 0;
  if (normal[2] > 0) {
    blocked |= 1;
  }
  if (normal[2] === 0) {
    blocked |= 2;
  }

  const backoff = DotProduct(inVector, normal) * overbounce;
  for (let index = 0; index < 3; index += 1) {
    const change = normal[index] * backoff;
    outVector[index] = inVector[index] - change;
    if (outVector[index] > -STOP_EPSILON && outVector[index] < STOP_EPSILON) {
      outVector[index] = 0;
    }
  }

  return blocked;
}

/**
 * Original name: SV_FlyMove
 * Source: game/g_phys.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Performs the Quake II multi-plane sliding clip used by toss and step movement.
 */
export function SV_FlyMove(ent: GameEntity, time: number, mask: number, runtime: GameRuntime): number {
  ensureCollision(runtime, "SV_FlyMove");

  const numbumps = 4;
  let blocked = 0;
  const original_velocity: vec3_t = [...ent.velocity];
  const primal_velocity: vec3_t = [...ent.velocity];
  const planes: vec3_t[] = [];
  let time_left = time;

  ent.groundentity = null;

  for (let bumpcount = 0; bumpcount < numbumps; bumpcount += 1) {
    const end: vec3_t = [
      ent.origin[0] + time_left * ent.velocity[0],
      ent.origin[1] + time_left * ent.velocity[1],
      ent.origin[2] + time_left * ent.velocity[2]
    ];

    const trace = runtime.collision!.trace(ent.origin, ent.mins, ent.maxs, end, ent, mask);

    if (trace.allsolid) {
      ent.velocity = [0, 0, 0];
      syncEntityOrigin(ent, ent.origin);
      return 3;
    }

    if (trace.fraction > 0) {
      setEntityOrigin(ent, trace.endpos);
      copyVec3(ent.velocity, original_velocity);
      planes.length = 0;
    }

    if (trace.fraction === 1) {
      break;
    }

    const hit = asGameEntity(trace.ent);

    if (trace.plane.normal[2] > 0.7) {
      blocked |= 1;
      if (hit?.solid === SOLID_BSP) {
        ent.groundentity = hit;
        ent.groundentity_linkcount = hit.linkcount;
      }
    }

    if (trace.plane.normal[2] === 0) {
      blocked |= 2;
    }

    SV_Impact(ent, trace, runtime);
    if (!ent.inuse) {
      break;
    }

    time_left -= time_left * trace.fraction;

    if (planes.length >= MAX_CLIP_PLANES) {
      ent.velocity = [0, 0, 0];
      syncEntityOrigin(ent, ent.origin);
      return 3;
    }

    planes.push([...trace.plane.normal]);

    let appliedPlane = false;
    for (let planeIndex = 0; planeIndex < planes.length; planeIndex += 1) {
      const newVelocity: vec3_t = [0, 0, 0];
      ClipVelocity(original_velocity, planes[planeIndex], newVelocity, 1);

      let candidateOk = true;
      for (let otherIndex = 0; otherIndex < planes.length; otherIndex += 1) {
        if (otherIndex === planeIndex) {
          continue;
        }

        if (vectorCompare(planes[planeIndex], planes[otherIndex])) {
          continue;
        }

        if (DotProduct(newVelocity, planes[otherIndex]) < 0) {
          candidateOk = false;
          break;
        }
      }

      if (candidateOk) {
        ent.velocity = [...newVelocity];
        appliedPlane = true;
        break;
      }
    }

    if (!appliedPlane) {
      if (planes.length !== 2) {
        ent.velocity = [0, 0, 0];
        syncEntityOrigin(ent, ent.origin);
        return 7;
      }

      const dir = crossProduct(planes[0], planes[1]);
      const d = DotProduct(dir, ent.velocity);
      ent.velocity = scaleVec3(dir, d);
    }

    if (DotProduct(ent.velocity, primal_velocity) <= 0) {
      ent.velocity = [0, 0, 0];
      syncEntityOrigin(ent, ent.origin);
      return blocked;
    }
  }

  syncEntityOrigin(ent, ent.origin);
  return blocked;
}

/**
 * Original name: SV_AddGravity
 * Source: game/g_phys.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Applies Quake II gravity for one frame to the vertical velocity of one entity.
 *
 * Porting notes:
 * - Callers pass the current `sv_gravity` runtime value; direct calls keep the
 *   original default cvar value.
 */
export function SV_AddGravity(ent: GameEntity, gravity = SV_GRAVITY): void {
  ent.velocity[2] -= ent.gravity * gravity * FRAMETIME;
}

/**
 * Original name: SV_PushEntity
 * Source: game/g_phys.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Moves one entity through the gameplay collision bridge without mutating its velocity.
 */
export function SV_PushEntity(ent: GameEntity, push: vec3_t, runtime: GameRuntime): trace_t {
  ensureCollision(runtime, "SV_PushEntity");

  const start: vec3_t = [...ent.origin];
  const end: vec3_t = addVec3(start, push);

  for (;;) {
    const mask = ent.clipmask || MASK_SOLID;
    const trace = runtime.collision!.trace(start, ent.mins, ent.maxs, end, ent, mask);

    setEntityOrigin(ent, trace.endpos);
    linkGameEntity(runtime, ent);

    if (trace.fraction !== 1.0) {
      SV_Impact(ent, trace, runtime);

      const impacted = asGameEntity(trace.ent);
      if (impacted && !impacted.inuse && ent.inuse) {
        setEntityOrigin(ent, start);
        linkGameEntity(runtime, ent);
        continue;
      }
    }

    if (ent.inuse) {
      touchTriggerEntities(runtime, ent);
    }

    return trace;
  }
}

/**
 * Original name: SV_Push
 * Source: game/g_phys.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies one pusher translation/rotation step and rolls everything back on blockage.
 *
 * Porting notes:
 * - Uses `clampPushAxis` for the C local `temp` rounding and accepts a shared pushed stack for team pushers.
 */
export function SV_Push(
  pusher: GameEntity,
  move: vec3_t,
  amove: vec3_t,
  runtime: GameRuntime,
  pushed: pushed_t[] = []
): boolean {
  const clampedMove = clampPushMove(move);
  const mins: vec3_t = [
    pusher.absmin[0] + clampedMove[0],
    pusher.absmin[1] + clampedMove[1],
    pusher.absmin[2] + clampedMove[2]
  ];
  const maxs: vec3_t = [
    pusher.absmax[0] + clampedMove[0],
    pusher.absmax[1] + clampedMove[1],
    pusher.absmax[2] + clampedMove[2]
  ];

  const inverseAmove: vec3_t = [-amove[0], -amove[1], -amove[2]];
  const rotationBasis = AngleVectors(inverseAmove);

  obstacle = null;
  pushed.push(capturePushedState(pusher));

  setEntityPose(pusher, addVec3(pusher.origin, clampedMove), addVec3(pusher.angles, amove));
  linkGameEntity(runtime, pusher);

  for (const check of runtime.entities) {
    if (!check.inuse || check === pusher) {
      continue;
    }

    if (
      check.movetype === MOVETYPE_PUSH ||
      check.movetype === MOVETYPE_STOP ||
      check.movetype === MOVETYPE_NONE ||
      check.movetype === MOVETYPE_NOCLIP
    ) {
      continue;
    }

    if (!check.linked) {
      continue;
    }

    if (check.groundentity !== pusher) {
      if (
        check.absmin[0] >= maxs[0] ||
        check.absmin[1] >= maxs[1] ||
        check.absmin[2] >= maxs[2] ||
        check.absmax[0] <= mins[0] ||
        check.absmax[1] <= mins[1] ||
        check.absmax[2] <= mins[2]
      ) {
        continue;
      }

      if (!SV_TestEntityPosition(check, runtime)) {
        continue;
      }
    }

    if (pusher.movetype === MOVETYPE_PUSH || check.groundentity === pusher) {
      pushed.push(capturePushedState(check));

      setEntityOrigin(check, addVec3(check.origin, clampedMove));
      if (check.client) {
        check.client.ps.pmove.delta_angles[1] += amove[1];
      }

      const move2 = rotateEntityByPusher(check, pusher, rotationBasis.forward, rotationBasis.right, rotationBasis.up);
      setEntityOrigin(check, addVec3(check.origin, move2));

      if (check.groundentity !== pusher) {
        check.groundentity = null;
      }

      let block = SV_TestEntityPosition(check, runtime);
      if (!block) {
        linkGameEntity(runtime, check);
        continue;
      }

      setEntityOrigin(check, subtractVec3(check.origin, clampedMove));
      block = SV_TestEntityPosition(check, runtime);
      if (!block) {
        pushed.pop();
        continue;
      }
    }

    obstacle = check;
    rollbackPush(pushed, runtime);
    return false;
  }

  for (let index = pushed.length - 1; index >= 0; index -= 1) {
    touchTriggerEntities(runtime, pushed[index].ent);
  }

  return true;
}

/**
 * Original name: SV_Physics_Pusher
 * Source: game/g_phys.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Advances one pusher entity or pusher team for the current server frame and then runs due thinks.
 */
export function SV_Physics_Pusher(ent: GameEntity, runtime: GameRuntime): void {
  if ((ent.flags & FL_TEAMSLAVE) !== 0) {
    return;
  }

  let part: GameEntity | null = ent;
  const pushed: pushed_t[] = [];
  for (; part; part = part.teamchain) {
    if (!hasMovement(part)) {
      continue;
    }

    const move = scaleVec3(part.velocity, FRAMETIME);
    const amove = scaleVec3(part.avelocity, FRAMETIME);
    if (!SV_Push(part, move, amove, runtime, pushed)) {
      break;
    }
  }

  if (part) {
    for (let member: GameEntity | null = ent; member; member = member.teamchain) {
      if (member.nextthink > 0) {
        member.nextthink += FRAMETIME;
      }
    }

    if (obstacle) {
      part.blocked?.(part, obstacle, runtime);
    }
    return;
  }

  for (let member: GameEntity | null = ent; member; member = member.teamchain) {
    SV_RunThink(member, runtime);
  }
}

/**
 * Original name: SV_Physics_None
 * Source: game/g_phys.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Runs only the regular think path for non-moving entities.
 */
export function SV_Physics_None(ent: GameEntity, runtime: GameRuntime): void {
  SV_RunThink(ent, runtime);
}

/**
 * Original name: SV_Physics_Noclip
 * Source: game/g_phys.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Advances one noclip entity by angles and origin without collision response.
 */
export function SV_Physics_Noclip(ent: GameEntity, runtime: GameRuntime): void {
  if (!SV_RunThink(ent, runtime)) {
    return;
  }

  setEntityPose(
    ent,
    addVec3(ent.origin, scaleVec3(ent.velocity, FRAMETIME)),
    addVec3(ent.angles, scaleVec3(ent.avelocity, FRAMETIME))
  );
  linkGameEntity(runtime, ent);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local sound bridge helper)
 * Category: New
 * Purpose: Queue the positioned water-transition sound used by toss physics.
 */
function emitPositionedWaterHit(runtime: GameRuntime, origin: vec3_t): void {
  const soundPath = "misc/h2ohit1.wav";
  emitRegisteredGameSound(runtime, null, registerGameSound(runtime, soundPath), soundPath, {
    origin,
    channel: CHAN_AUTO,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
}

/**
 * Original name: SV_Physics_Toss
 * Source: game/g_phys.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Runs toss, bounce, fly and fly-missile movement including water transitions.
 *
 * Porting notes:
 * - `gi.positioned_sound` water splashes are queued as runtime sound events with explicit origins.
 */
export function SV_Physics_Toss(ent: GameEntity, runtime: GameRuntime): void {
  SV_RunThink(ent, runtime);
  if (!ent.inuse) {
    return;
  }

  if ((ent.flags & FL_TEAMSLAVE) !== 0) {
    return;
  }

  if (ent.velocity[2] > 0) {
    ent.groundentity = null;
  }

  if (ent.groundentity && !ent.groundentity.inuse) {
    ent.groundentity = null;
  }

  if (ent.groundentity) {
    return;
  }

  const old_origin: vec3_t = [...ent.origin];
  SV_CheckVelocity(ent, runtime.maxvelocity);

  if (ent.movetype !== MOVETYPE_FLY && ent.movetype !== MOVETYPE_FLYMISSILE) {
    SV_AddGravity(ent, runtime.gravity);
  }

  setEntityAngles(ent, addVec3(ent.angles, scaleVec3(ent.avelocity, FRAMETIME)));

  const move = scaleVec3(ent.velocity, FRAMETIME);
  const trace = SV_PushEntity(ent, move, runtime);
  if (!ent.inuse) {
    return;
  }

  if (trace.fraction < 1) {
    const backoff = ent.movetype === MOVETYPE_BOUNCE ? 1.5 : 1;
    const newVelocity: vec3_t = [0, 0, 0];
    ClipVelocity(ent.velocity, trace.plane.normal, newVelocity, backoff);
    ent.velocity = newVelocity;

    if (trace.plane.normal[2] > 0.7) {
      if (ent.velocity[2] < 60 || ent.movetype !== MOVETYPE_BOUNCE) {
        const hit = asGameEntity(trace.ent);
        ent.groundentity = hit;
        ent.groundentity_linkcount = hit?.linkcount ?? 0;
        ent.velocity = [0, 0, 0];
        ent.avelocity = [0, 0, 0];
      }
    }
  }

  const wasinwater = (ent.watertype & MASK_WATER) !== 0;
  ent.watertype = runtime.collision?.pointcontents(ent.origin, ent) ?? 0;
  const isinwater = (ent.watertype & MASK_WATER) !== 0;
  ent.waterlevel = isinwater ? 1 : 0;

  if (!wasinwater && isinwater) {
    emitPositionedWaterHit(runtime, old_origin);
  } else if (wasinwater && !isinwater) {
    emitPositionedWaterHit(runtime, ent.origin);
  }

  for (let slave = ent.teamchain; slave; slave = slave.teamchain) {
    setEntityOrigin(slave, ent.origin);
    linkGameEntity(runtime, slave);
  }
}

/**
 * Original name: SV_AddRotationalFriction
 * Source: game/g_phys.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Applies rotational friction to one stepping entity.
 */
export function SV_AddRotationalFriction(ent: GameEntity): void {
  setEntityAngles(ent, addVec3(ent.angles, scaleVec3(ent.avelocity, FRAMETIME)));

  const adjustment = FRAMETIME * SV_STOPSPEED * SV_FRICTION;
  for (let index = 0; index < 3; index += 1) {
    if (ent.avelocity[index] > 0) {
      ent.avelocity[index] -= adjustment;
      if (ent.avelocity[index] < 0) {
        ent.avelocity[index] = 0;
      }
    } else {
      ent.avelocity[index] += adjustment;
      if (ent.avelocity[index] > 0) {
        ent.avelocity[index] = 0;
      }
    }
  }
}

/**
 * Original name: SV_Physics_Step
 * Source: game/g_phys.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Advances one stepping monster-style entity with gravity, friction and discrete slide movement.
 */
export function SV_Physics_Step(ent: GameEntity, runtime: GameRuntime): void {
  ensureCollision(runtime, "SV_Physics_Step");

  if (!ent.groundentity) {
    M_CheckGround(ent, runtime);
  }

  const groundentity = ent.groundentity;
  SV_CheckVelocity(ent, runtime.maxvelocity);
  const wasonground = groundentity !== null;
  let hitsound = false;

  if (!isZeroVec3(ent.avelocity)) {
    SV_AddRotationalFriction(ent);
  }

  if (!wasonground) {
    if ((ent.flags & FL_FLY) === 0) {
      if ((ent.flags & FL_SWIM) === 0 || ent.waterlevel <= 2) {
        if (ent.velocity[2] < runtime.gravity * -0.1) {
          hitsound = true;
        }
        if (ent.waterlevel === 0) {
          SV_AddGravity(ent, runtime.gravity);
        }
      }
    }
  }

  if ((ent.flags & FL_FLY) !== 0 && ent.velocity[2] !== 0) {
    applyVerticalFriction(ent, SV_FRICTION / 3);
  }

  if ((ent.flags & FL_SWIM) !== 0 && ent.velocity[2] !== 0) {
    const speed = Math.abs(ent.velocity[2]);
    const control = speed < SV_STOPSPEED ? SV_STOPSPEED : speed;
    let newspeed = speed - (FRAMETIME * control * SV_WATERFRICTION * ent.waterlevel);
    if (newspeed < 0) {
      newspeed = 0;
    }
    if (speed > 0) {
      ent.velocity[2] *= newspeed / speed;
    }
  }

  if (!isZeroVec3(ent.velocity)) {
    if (wasonground || (ent.flags & (FL_SWIM | FL_FLY)) !== 0) {
      if (!(ent.health <= 0 && !M_CheckBottom(ent, runtime))) {
        const speed = Math.hypot(ent.velocity[0], ent.velocity[1]);
        if (speed > 0) {
          const control = speed < SV_STOPSPEED ? SV_STOPSPEED : speed;
          let newspeed = speed - FRAMETIME * control * SV_FRICTION;
          if (newspeed < 0) {
            newspeed = 0;
          }
          const scale = newspeed / speed;
          ent.velocity[0] *= scale;
          ent.velocity[1] *= scale;
        }
      }
    }

    const mask = (ent.svflags & SVF_MONSTER) !== 0 ? MASK_MONSTERSOLID : MASK_SOLID;
    SV_FlyMove(ent, FRAMETIME, mask, runtime);

    linkGameEntity(runtime, ent);
    touchTriggerEntities(runtime, ent);
    if (!ent.inuse) {
      return;
    }

    if (ent.groundentity && !wasonground && hitsound) {
      emitGameSound(runtime, ent, "world/land.wav");
    }
  }

  SV_RunThink(ent, runtime);
}

/**
 * Original name: G_RunEntity
 * Source: game/g_phys.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Runs `prethink`, then dispatches one active entity to the physics branch matching its current `movetype`.
 *
 * Porting notes:
 * - The TypeScript port returns early if `prethink` frees the entity; the C code falls through with a cleared edict
 *   after `G_FreeEdict`, which is behaviorally equivalent for normal runtime frees.
 */
export function G_RunEntity(ent: GameEntity, runtime: GameRuntime): void {
  ent.prethink?.(ent, runtime);
  if (!ent.inuse) {
    return;
  }

  switch (ent.movetype) {
    case MOVETYPE_PUSH:
    case MOVETYPE_STOP:
      SV_Physics_Pusher(ent, runtime);
      break;
    case MOVETYPE_NONE:
      SV_Physics_None(ent, runtime);
      break;
    case MOVETYPE_NOCLIP:
      SV_Physics_Noclip(ent, runtime);
      break;
    case MOVETYPE_STEP:
      SV_Physics_Step(ent, runtime);
      break;
    case MOVETYPE_TOSS:
    case MOVETYPE_BOUNCE:
    case MOVETYPE_FLY:
    case MOVETYPE_FLYMISSILE:
      SV_Physics_Toss(ent, runtime);
      break;
    default:
      throw new Error(`SV_Physics: bad movetype ${ent.movetype}`);
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (local gameplay frame helper)
 * Category: New
 * Purpose: Advance the local gameplay runtime by one Quake II server frame.
 *
 * Constraints:
 * - Must run all active entities at the new frame time.
 */
export function G_RunFrame(runtime: GameRuntime): void {
  runtime.framenum += 1;
  runtime.time += FRAMETIME;

  for (const ent of runtime.entities) {
    if (!ent.inuse) {
      continue;
    }

    runtime.current_entity = ent;
    G_RunEntity(ent, runtime);
  }

  runtime.current_entity = null;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local gameplay frame helper)
 * Category: New
 * Purpose: Advance the local gameplay runtime up to one target time using fixed Quake II server frames.
 *
 * Constraints:
 * - Must never skip a full frame between executed gameplay physics updates.
 */
export function runGameFrames(runtime: GameRuntime, upToTime: number, beforeFrame?: (runtime: GameRuntime) => void): void {
  while ((runtime.time + FRAMETIME) <= (upToTime + 0.0001)) {
    beforeFrame?.(runtime);
    G_RunFrame(runtime);
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Check whether one entity currently carries linear or angular movement.
 */
function hasMovement(entity: GameEntity): boolean {
  return !isZeroVec3(entity.velocity) || !isZeroVec3(entity.avelocity);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local pusher helper)
 * Category: New
 * Purpose: Clamp one pusher translation to the original 1/8 unit grid.
 */
function clampPushMove(move: vec3_t): vec3_t {
  return [
    clampPushAxis(move[0]),
    clampPushAxis(move[1]),
    clampPushAxis(move[2])
  ];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local pusher helper)
 * Category: New
 * Purpose: Clamp one scalar push component to the Quake II pusher grid.
 */
function clampPushAxis(value: number): number {
  let temp = value * 8.0;
  if (temp > 0) {
    temp += 0.5;
  } else {
    temp -= 0.5;
  }

  return 0.125 * Math.trunc(temp);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local rollback helper)
 * Category: New
 * Purpose: Snapshot one moved entity before a pusher step so failed pushes can roll back.
 */
function capturePushedState(ent: GameEntity): pushed_t {
  return {
    ent,
    origin: [...ent.origin],
    angles: [...ent.angles],
    groundentity: ent.groundentity,
    groundentity_linkcount: ent.groundentity_linkcount,
    deltaYaw: ent.client ? ent.client.ps.pmove.delta_angles[1] : null
  };
}

/**
 * Original name: N/A
 * Source declaree: N/A (local rollback helper)
 * Category: New
 * Purpose: Restore all entities moved during one failed pusher step in reverse order.
 */
function rollbackPush(pushed: pushed_t[], runtime: GameRuntime): void {
  for (let index = pushed.length - 1; index >= 0; index -= 1) {
    const state = pushed[index];
    setEntityPose(state.ent, state.origin, state.angles);
    state.ent.groundentity = state.groundentity;
    state.ent.groundentity_linkcount = state.groundentity_linkcount;
    if (state.ent.client && state.deltaYaw !== null) {
      state.ent.client.ps.pmove.delta_angles[1] = state.deltaYaw;
    }
    linkGameEntity(runtime, state.ent);
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (local pusher helper)
 * Category: New
 * Purpose: Apply the pusher angular compensation used to carry riders around rotating brush models.
 */
function rotateEntityByPusher(
  check: GameEntity,
  pusher: GameEntity,
  forward: vec3_t,
  right: vec3_t,
  up: vec3_t
): vec3_t {
  const org = subtractVec3(check.origin, pusher.origin);
  const org2: vec3_t = [
    DotProduct(org, forward),
    -DotProduct(org, right),
    DotProduct(org, up)
  ];

  return subtractVec3(org2, org);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local physics helper)
 * Category: New
 * Purpose: Apply the lightweight vertical friction path used by flying entities in `SV_Physics_Step`.
 */
function applyVerticalFriction(ent: GameEntity, friction: number): void {
  const speed = Math.abs(ent.velocity[2]);
  const control = speed < SV_STOPSPEED ? SV_STOPSPEED : speed;
  let newspeed = speed - (FRAMETIME * control * friction);
  if (newspeed < 0) {
    newspeed = 0;
  }
  if (speed > 0) {
    ent.velocity[2] *= newspeed / speed;
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (local entity sync helper)
 * Category: New
 * Purpose: Keep `origin` and `s.origin` synchronized after one position update.
 */
function setEntityOrigin(ent: GameEntity, origin: vec3_t): void {
  ent.origin = [...origin];
  syncEntityOrigin(ent, origin);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local entity sync helper)
 * Category: New
 * Purpose: Keep `angles` and `s.angles` synchronized after one rotation update.
 */
function setEntityAngles(ent: GameEntity, angles: vec3_t): void {
  ent.angles = [...angles];
  ent.s.angles = [...angles];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local entity sync helper)
 * Category: New
 * Purpose: Update one entity pose in a single synchronized operation.
 */
function setEntityPose(ent: GameEntity, origin: vec3_t, angles: vec3_t): void {
  setEntityOrigin(ent, origin);
  setEntityAngles(ent, angles);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local entity sync helper)
 * Category: New
 * Purpose: Keep `s.origin` synchronized when the caller already updated `origin`.
 */
function syncEntityOrigin(ent: GameEntity, origin: vec3_t): void {
  ent.s.origin = [...origin];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Multiply one vector by one scalar without mutating the source.
 */
function scaleVec3(vector: vec3_t, scalar: number): vec3_t {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Add two vectors without mutating either input.
 */
function addVec3(left: vec3_t, right: vec3_t): vec3_t {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Subtract two vectors without mutating either input.
 */
function subtractVec3(left: vec3_t, right: vec3_t): vec3_t {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Compute one cross product for the slide-crease resolution path.
 */
function crossProduct(left: vec3_t, right: vec3_t): vec3_t {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0]
  ];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Copy one vector into another mutable target tuple.
 */
function copyVec3(source: vec3_t, target: vec3_t): void {
  target[0] = source[0];
  target[1] = source[1];
  target[2] = source[2];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Compare two vectors with the exact equality used by the original clip-plane loop.
 */
function vectorCompare(left: vec3_t, right: vec3_t): boolean {
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Detect a zero vector for lightweight branch decisions.
 */
function isZeroVec3(vector: vec3_t): boolean {
  return vector[0] === 0 && vector[1] === 0 && vector[2] === 0;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local trace helper)
 * Category: New
 * Purpose: Narrow one trace payload to the gameplay entity runtime shape when possible.
 */
function asGameEntity(value: unknown): GameEntity | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  if (!("inuse" in value) || !("classname" in value)) {
    return null;
  }

  return value as GameEntity;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local runtime assertion helper)
 * Category: New
 * Purpose: Assert that the gameplay collision bridge exists before collision-backed physics work.
 */
function ensureCollision(runtime: GameRuntime, caller: string): void {
  if (!runtime.collision) {
    throw new Error(`${caller} requires runtime collision bridge`);
  }
}
