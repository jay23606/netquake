/**
 * File: p_view.ts
 * Source: Quake II original / game/p_view.c
 * Purpose: Port of the first end-of-frame player presentation helpers.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Sound indices are registered through the gameplay asset registry instead of `gi.soundindex`.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

import {
  AngleVectors,
  DF_NO_FALLING,
  EF_COLOR_SHELL,
  EF_PENT,
  EF_POWERSCREEN,
  EF_QUAD,
  PMF_DUCKED,
  PITCH,
  RDF_UNDERWATER,
  RF_SHELL_BLUE,
  RF_SHELL_GREEN,
  RF_SHELL_RED,
  ROLL,
  STAT_FLASHES,
  YAW,
  entity_event_t,
  type vec3_t
} from "../../qcommon/src/q_shared.js";
import { CONTENTS_LAVA, CONTENTS_SLIME, CONTENTS_SOLID, CONTENTS_WATER } from "../../qcommon/src/q_shared.js";
import {
  ANIM_PAIN,
  ANIM_BASIC,
  DAMAGE_TIME,
  ANIM_DEATH,
  ANIM_JUMP,
  ANIM_REVERSE,
  ANIM_WAVE,
  DAMAGE_NO_ARMOR,
  FALL_TIME,
  FL_INWATER,
  FL_GODMODE,
  MOD_FALLING,
  MOD_LAVA,
  MOD_SLIME,
  MOD_WATER,
  MOVETYPE_NOCLIP,
  PNOISE_SELF,
  POWER_ARMOR_SCREEN,
  POWER_ARMOR_SHIELD
} from "./g_local.js";
import { T_Damage } from "./g_combat.js";
import { PowerArmorType } from "./g_items.js";
import {
  FRAME_crpain1,
  FRAME_crpain4,
  FRAME_crstnd01,
  FRAME_crstnd19,
  FRAME_crwalk1,
  FRAME_crwalk6,
  FRAME_jump1,
  FRAME_jump2,
  FRAME_jump3,
  FRAME_jump6,
  FRAME_pain101,
  FRAME_pain104,
  FRAME_pain201,
  FRAME_pain204,
  FRAME_pain301,
  FRAME_pain304,
  FRAME_run1,
  FRAME_run6,
  FRAME_stand01,
  FRAME_stand40
} from "./m_player.js";
import { G_CheckChaseStats, G_SetSpectatorStats, G_SetStats } from "./p_hud.js";
import { PlayerNoise } from "./p_weapon.js";
import { emitGameSound, registerGameSound, type GameClient, type GameEntity, type GameRuntime } from "./runtime.js";

/**
 * Original name: N/A
 * Source: N/A (local frame-state adapter)
 * Category: New
 * Purpose: Preserve the temporary per-frame bob state that originally lived in `p_view.c` file statics.
 */
export interface PlayerViewFrameState {
  forward: vec3_t;
  right: vec3_t;
  up: vec3_t;
  xyspeed: number;
  bobmove: number;
  bobcycle: number;
  bobfracsin: number;
}

/**
 * Original name: i
 * Source: game/p_view.c (`P_DamageFeedback` function-local static)
 * Category: Adapter
 * Purpose: Preserve the C function-local static pain animation cycle in module scope.
 */
let painAnimationCycle = 0;

/**
 * Original name: SV_CalcRoll
 * Source: Quake-2-master/game/p_view.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Computes the lateral view roll induced by sideways velocity.
 */
export function SV_CalcRoll(
  right: vec3_t,
  velocity: vec3_t,
  sv_rollangle: number,
  sv_rollspeed: number
): number {
  let side = dotProduct(velocity, right);
  const sign = side < 0 ? -1 : 1;
  side = Math.abs(side);

  if (side < sv_rollspeed) {
    side = side * sv_rollangle / sv_rollspeed;
  } else {
    side = sv_rollangle;
  }

  return side * sign;
}

/**
 * Original name: G_SetClientEffects
 * Source: Quake-2-master/game/p_view.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Updates the public player render effects for power armor, quad, invulnerability and god mode.
 */
export function G_SetClientEffects(ent: GameEntity, runtime: GameRuntime): void {
  const client = ent.client;
  if (!client) {
    return;
  }

  ent.s.effects = 0;
  ent.s.renderfx = 0;

  if (ent.health <= 0 || runtime.intermissiontime !== 0) {
    return;
  }

  if (ent.powerarmor_time > runtime.time) {
    const paType = PowerArmorType(ent);
    if (paType === POWER_ARMOR_SCREEN) {
      ent.s.effects |= EF_POWERSCREEN;
    } else if (paType === POWER_ARMOR_SHIELD) {
      ent.s.effects |= EF_COLOR_SHELL;
      ent.s.renderfx |= RF_SHELL_GREEN;
    }
  }

  if (client.quad_framenum > runtime.framenum) {
    const remaining = client.quad_framenum - runtime.framenum;
    if (remaining > 30 || (remaining & 4) !== 0) {
      ent.s.effects |= EF_QUAD;
    }
  }

  if (client.invincible_framenum > runtime.framenum) {
    const remaining = client.invincible_framenum - runtime.framenum;
    if (remaining > 30 || (remaining & 4) !== 0) {
      ent.s.effects |= EF_PENT;
    }
  }

  if ((ent.flags & FL_GODMODE) !== 0) {
    ent.s.effects |= EF_COLOR_SHELL;
    ent.s.renderfx |= RF_SHELL_RED | RF_SHELL_GREEN | RF_SHELL_BLUE;
  }
}

/**
 * Original name: G_SetClientEvent
 * Source: Quake-2-master/game/p_view.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits a footstep event when the player is grounded and crosses a bob-cycle boundary at running speed.
 */
export function G_SetClientEvent(ent: GameEntity, frame: PlayerViewFrameState): void {
  if (ent.s.event !== 0) {
    return;
  }

  if (ent.groundentity && frame.xyspeed > 225) {
    if (Math.trunc((ent.client?.bobtime ?? 0) + frame.bobmove) !== frame.bobcycle) {
      ent.s.event = entity_event_t.EV_FOOTSTEP;
    }
  }
}

/**
 * Original name: G_SetClientSound
 * Source: Quake-2-master/game/p_view.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Updates the looped player sound slot for world sizzle, weapon hum and explicit weapon sounds.
 */
export function G_SetClientSound(ent: GameEntity, runtime: GameRuntime): void {
  const client = ent.client;
  if (!client) {
    return;
  }

  if (client.pers.game_helpchanged !== runtime.helpchanged) {
    client.pers.game_helpchanged = runtime.helpchanged;
    client.pers.helpchanged = 1;
  }

  if (client.pers.helpchanged !== 0 && client.pers.helpchanged <= 3 && (runtime.framenum & 63) === 0) {
    client.pers.helpchanged += 1;
    emitGameSound(runtime, ent, "misc/pc_up.wav");
  }

  const weaponClassname = client.pers.weapon?.classname ?? "";

  if (ent.waterlevel !== 0 && (ent.watertype & (CONTENTS_LAVA | CONTENTS_SLIME)) !== 0) {
    ent.s.sound = runtime.snd_fry || registerGameSound(runtime, "player/fry.wav");
  } else if (weaponClassname === "weapon_railgun") {
    ent.s.sound = registerGameSound(runtime, "weapons/rg_hum.wav");
  } else if (weaponClassname === "weapon_bfg") {
    ent.s.sound = registerGameSound(runtime, "weapons/bfg_hum.wav");
  } else if (client.weapon_sound !== 0) {
    ent.s.sound = client.weapon_sound;
  } else {
    ent.s.sound = 0;
  }
}

/**
 * Original name: G_SetClientFrame
 * Source: Quake-2-master/game/p_view.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Advances or resets the visible player animation frame based on ducking, movement and jump state.
 */
export function G_SetClientFrame(ent: GameEntity, frame: PlayerViewFrameState): void {
  const client = ent.client;
  if (!client || ent.s.modelindex !== 255) {
    return;
  }

  const duck = (client.ps.pmove.pm_flags & PMF_DUCKED) !== 0;
  const run = frame.xyspeed !== 0;

  if (duck !== client.anim_duck && client.anim_priority < ANIM_DEATH) {
    setClientBaseAnimation(ent, client, duck, run);
    return;
  }
  if (run !== client.anim_run && client.anim_priority === ANIM_BASIC) {
    setClientBaseAnimation(ent, client, duck, run);
    return;
  }
  if (!ent.groundentity && client.anim_priority <= ANIM_WAVE) {
    setClientBaseAnimation(ent, client, duck, run);
    return;
  }

  if (client.anim_priority === ANIM_REVERSE) {
    if (ent.s.frame > client.anim_end) {
      ent.s.frame -= 1;
      return;
    }
  } else if (ent.s.frame < client.anim_end) {
    ent.s.frame += 1;
    return;
  }

  if (client.anim_priority === ANIM_DEATH) {
    return;
  }
  if (client.anim_priority === ANIM_JUMP) {
    if (!ent.groundentity) {
      return;
    }
    client.anim_priority = ANIM_WAVE;
    ent.s.frame = FRAME_jump3;
    client.anim_end = FRAME_jump6;
    return;
  }

  setClientBaseAnimation(ent, client, duck, run);
}

/**
 * Original name: P_DamageFeedback
 * Source: Quake-2-master/game/p_view.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Resolves HUD damage flashes, pain animation, blend color and view kick from the per-frame damage accumulators.
 */
export function P_DamageFeedback(
  player: GameEntity,
  runtime: GameRuntime,
  frame: Pick<PlayerViewFrameState, "forward" | "right">
): void {
  const client = player.client;
  if (!client) {
    return;
  }

  client.ps.stats[STAT_FLASHES] = 0;
  if (client.damage_blood !== 0) {
    client.ps.stats[STAT_FLASHES] |= 1;
  }
  if (
    client.damage_armor !== 0 &&
    (player.flags & FL_GODMODE) === 0 &&
    client.invincible_framenum <= runtime.framenum
  ) {
    client.ps.stats[STAT_FLASHES] |= 2;
  }

  let count = client.damage_blood + client.damage_armor + client.damage_parmor;
  if (count === 0) {
    return;
  }

  if (client.anim_priority < ANIM_PAIN && player.s.modelindex === 255) {
    client.anim_priority = ANIM_PAIN;
    if ((client.ps.pmove.pm_flags & PMF_DUCKED) !== 0) {
      player.s.frame = FRAME_crpain1 - 1;
      client.anim_end = FRAME_crpain4;
    } else {
      painAnimationCycle = (painAnimationCycle + 1) % 3;
      switch (painAnimationCycle) {
        case 0:
          player.s.frame = FRAME_pain101 - 1;
          client.anim_end = FRAME_pain104;
          break;
        case 1:
          player.s.frame = FRAME_pain201 - 1;
          client.anim_end = FRAME_pain204;
          break;
        default:
          player.s.frame = FRAME_pain301 - 1;
          client.anim_end = FRAME_pain304;
          break;
      }
    }
  }

  const realcount = count;
  if (count < 10) {
    count = 10;
  }

  if (runtime.time > player.pain_debounce_time && (player.flags & FL_GODMODE) === 0 && client.invincible_framenum <= runtime.framenum) {
    player.pain_debounce_time = runtime.time + 0.7;
    const healthBucket = player.health < 25 ? 25 : player.health < 50 ? 50 : player.health < 75 ? 75 : 100;
    const variant = 1 + randomInt(2);
    emitGameSound(runtime, player, `*pain${healthBucket}_${variant}.wav`);
  }

  if (client.damage_alpha < 0) {
    client.damage_alpha = 0;
  }
  client.damage_alpha += count * 0.01;
  if (client.damage_alpha < 0.2) {
    client.damage_alpha = 0.2;
  }
  if (client.damage_alpha > 0.6) {
    client.damage_alpha = 0.6;
  }

  const blend: vec3_t = [0, 0, 0];
  if (client.damage_parmor !== 0) {
    vectorMA(blend, client.damage_parmor / realcount, [0, 1, 0], blend);
  }
  if (client.damage_armor !== 0) {
    vectorMA(blend, client.damage_armor / realcount, [1, 1, 1], blend);
  }
  if (client.damage_blood !== 0) {
    vectorMA(blend, client.damage_blood / realcount, [1, 0, 0], blend);
  }
  client.damage_blend = blend;

  let kick = Math.abs(client.damage_knockback);
  if (kick !== 0 && player.health > 0) {
    kick = kick * 100 / player.health;
    if (kick < count * 0.5) {
      kick = count * 0.5;
    }
    if (kick > 50) {
      kick = 50;
    }

    const from = normalizeVec3(subtractVec3(client.damage_from, player.s.origin));
    let side = dotProduct(from, frame.right);
    client.v_dmg_roll = kick * side * 0.3;

    side = -dotProduct(from, frame.forward);
    client.v_dmg_pitch = kick * side * 0.3;
    client.v_dmg_time = runtime.time + DAMAGE_TIME;
  }

  client.damage_blood = 0;
  client.damage_armor = 0;
  client.damage_parmor = 0;
  client.damage_knockback = 0;
}

/**
 * Original name: P_FallingDamage
 * Source: Quake-2-master/game/p_view.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Detects landing severity from vertical velocity deltas, raises the proper event and applies falling damage.
 */
export function P_FallingDamage(ent: GameEntity, runtime: GameRuntime): void {
  const client = ent.client;
  if (!client || ent.s.modelindex !== 255) {
    return;
  }
  if (ent.movetype === MOVETYPE_NOCLIP) {
    return;
  }

  let delta: number;
  if (client.oldvelocity[2] < 0 && ent.velocity[2] > client.oldvelocity[2] && !ent.groundentity) {
    delta = client.oldvelocity[2];
  } else {
    if (!ent.groundentity) {
      return;
    }
    delta = ent.velocity[2] - client.oldvelocity[2];
  }

  delta = delta * delta * 0.0001;

  if (ent.waterlevel === 3) {
    return;
  }
  if (ent.waterlevel === 2) {
    delta *= 0.25;
  }
  if (ent.waterlevel === 1) {
    delta *= 0.5;
  }

  if (delta < 1) {
    return;
  }

  if (delta < 15) {
    ent.s.event = entity_event_t.EV_FOOTSTEP;
    return;
  }

  client.fall_value = delta * 0.5;
  if (client.fall_value > 40) {
    client.fall_value = 40;
  }
  client.fall_time = runtime.time + FALL_TIME;

  if (delta > 30) {
    if (ent.health > 0) {
      ent.s.event = delta >= 55 ? entity_event_t.EV_FALLFAR : entity_event_t.EV_FALL;
    }
    ent.pain_debounce_time = runtime.time;

    let damage = Math.trunc((delta - 30) / 2);
    if (damage < 1) {
      damage = 1;
    }

    if (!runtime.deathmatch || (runtime.dmflags & DF_NO_FALLING) === 0) {
      const world = runtime.entities[0] ?? ent;
      T_Damage(ent, world, world, [0, 0, 1], ent.s.origin, [0, 0, 0], damage, 0, 0, MOD_FALLING, runtime);
    }
  } else {
    ent.s.event = entity_event_t.EV_FALLSHORT;
  }
}

/**
 * Original name: P_WorldEffects
 * Source: Quake-2-master/game/p_view.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies entry/exit water sounds, breathing timers, drowning damage and lava/slime world damage.
 */
export function P_WorldEffects(ent: GameEntity, runtime: GameRuntime): void {
  const client = ent.client;
  if (!client) {
    return;
  }

  if (ent.movetype === MOVETYPE_NOCLIP) {
    ent.air_finished = runtime.time + 12;
    return;
  }

  const waterlevel = ent.waterlevel;
  const oldWaterlevel = client.old_waterlevel;
  client.old_waterlevel = waterlevel;

  const breather = client.breather_framenum > runtime.framenum;
  const envirosuit = client.enviro_framenum > runtime.framenum;
  const world = runtime.entities[0] ?? ent;

  if (oldWaterlevel === 0 && waterlevel !== 0) {
    PlayerNoise(ent, ent.s.origin, PNOISE_SELF, runtime);
    if ((ent.watertype & CONTENTS_LAVA) !== 0) {
      emitGameSound(runtime, ent, "player/lava_in.wav");
    } else if ((ent.watertype & (CONTENTS_SLIME | CONTENTS_WATER)) !== 0) {
      emitGameSound(runtime, ent, "player/watr_in.wav");
    }
    ent.flags |= FL_INWATER;
    ent.damage_debounce_time = runtime.time - 1;
  }

  if (oldWaterlevel !== 0 && waterlevel === 0) {
    PlayerNoise(ent, ent.s.origin, PNOISE_SELF, runtime);
    emitGameSound(runtime, ent, "player/watr_out.wav");
    ent.flags &= ~FL_INWATER;
  }

  if (oldWaterlevel !== 3 && waterlevel === 3) {
    emitGameSound(runtime, ent, "player/watr_un.wav");
  }

  if (oldWaterlevel === 3 && waterlevel !== 3) {
    if (ent.air_finished < runtime.time) {
      emitGameSound(runtime, ent, "player/gasp1.wav");
      PlayerNoise(ent, ent.s.origin, PNOISE_SELF, runtime);
    } else if (ent.air_finished < runtime.time + 11) {
      emitGameSound(runtime, ent, "player/gasp2.wav");
    }
  }

  if (waterlevel === 3) {
    if (breather || envirosuit) {
      ent.air_finished = runtime.time + 10;

      if ((Math.trunc(client.breather_framenum - runtime.framenum) % 25) === 0) {
        emitGameSound(runtime, ent, client.breather_sound === 0 ? "player/u_breath1.wav" : "player/u_breath2.wav");
        client.breather_sound ^= 1;
        PlayerNoise(ent, ent.s.origin, PNOISE_SELF, runtime);
      }
    }

    if (ent.air_finished < runtime.time) {
      if (client.next_drown_time < runtime.time && ent.health > 0) {
        client.next_drown_time = runtime.time + 1;
        ent.dmg += 2;
        if (ent.dmg > 15) {
          ent.dmg = 15;
        }

        if (ent.health <= ent.dmg) {
          emitGameSound(runtime, ent, "player/drown1.wav");
        } else if ((randomInt(2) & 1) !== 0) {
          emitGameSound(runtime, ent, "*gurp1.wav");
        } else {
          emitGameSound(runtime, ent, "*gurp2.wav");
        }

        ent.pain_debounce_time = runtime.time;
        T_Damage(ent, world, world, [0, 0, 0], ent.s.origin, [0, 0, 0], ent.dmg, 0, DAMAGE_NO_ARMOR, MOD_WATER, runtime);
      }
    }
  } else {
    ent.air_finished = runtime.time + 12;
    ent.dmg = 2;
  }

  if (waterlevel !== 0 && (ent.watertype & (CONTENTS_LAVA | CONTENTS_SLIME)) !== 0) {
    if ((ent.watertype & CONTENTS_LAVA) !== 0) {
      if (ent.health > 0 && ent.pain_debounce_time <= runtime.time && client.invincible_framenum < runtime.framenum) {
        emitGameSound(runtime, ent, (randomInt(2) & 1) !== 0 ? "player/burn1.wav" : "player/burn2.wav");
        ent.pain_debounce_time = runtime.time + 1;
      }

      T_Damage(
        ent,
        world,
        world,
        [0, 0, 0],
        ent.s.origin,
        [0, 0, 0],
        (envirosuit ? 1 : 3) * waterlevel,
        0,
        0,
        MOD_LAVA,
        runtime
      );
    }

    if ((ent.watertype & CONTENTS_SLIME) !== 0) {
      if (!envirosuit) {
        T_Damage(ent, world, world, [0, 0, 0], ent.s.origin, [0, 0, 0], waterlevel, 0, 0, MOD_SLIME, runtime);
      }
    }
  }
}

/**
 * Original name: SV_CalcViewOffset
 * Source: game/p_view.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Builds the player's camera kick angles and bounded view offset from fall, bob and velocity feedback.
 */
export function SV_CalcViewOffset(
  ent: GameEntity,
  runtime: GameRuntime,
  frame: Pick<PlayerViewFrameState, "forward" | "right" | "xyspeed" | "bobfracsin" | "bobcycle">,
  options: {
    run_pitch?: number;
    run_roll?: number;
    bob_up?: number;
    bob_pitch?: number;
    bob_roll?: number;
  } = {}
): void {
  const client = ent.client;
  if (!client) {
    return;
  }

  const angles = client.ps.kick_angles;
  const runPitch = options.run_pitch ?? 0.002;
  const runRoll = options.run_roll ?? 0.005;
  const bobUp = options.bob_up ?? 0.005;
  const bobPitch = options.bob_pitch ?? 0.002;
  const bobRoll = options.bob_roll ?? 0.002;

  if (ent.deadflag !== 0) {
    clearVec3(angles);
    client.ps.viewangles[ROLL] = 40;
    client.ps.viewangles[PITCH] = -15;
    client.ps.viewangles[YAW] = client.killer_yaw;
  } else {
    copyVec3(client.kick_angles, angles);

    let ratio = (client.v_dmg_time - runtime.time) / DAMAGE_TIME;
    if (ratio < 0) {
      ratio = 0;
      client.v_dmg_pitch = 0;
      client.v_dmg_roll = 0;
    }
    angles[PITCH] += ratio * client.v_dmg_pitch;
    angles[ROLL] += ratio * client.v_dmg_roll;

    ratio = (client.fall_time - runtime.time) / FALL_TIME;
    if (ratio < 0) {
      ratio = 0;
    }
    angles[PITCH] += ratio * client.fall_value;

    let delta = dotProduct(ent.velocity, frame.forward);
    angles[PITCH] += delta * runPitch;

    delta = dotProduct(ent.velocity, frame.right);
    angles[ROLL] += delta * runRoll;

    delta = frame.bobfracsin * bobPitch * frame.xyspeed;
    if ((client.ps.pmove.pm_flags & PMF_DUCKED) !== 0) {
      delta *= 6;
    }
    angles[PITCH] += delta;

    delta = frame.bobfracsin * bobRoll * frame.xyspeed;
    if ((client.ps.pmove.pm_flags & PMF_DUCKED) !== 0) {
      delta *= 6;
    }
    if ((frame.bobcycle & 1) !== 0) {
      delta = -delta;
    }
    angles[ROLL] += delta;
  }

  const view: vec3_t = [0, 0, 0];
  view[2] += ent.viewheight;

  let ratio = (client.fall_time - runtime.time) / FALL_TIME;
  if (ratio < 0) {
    ratio = 0;
  }
  view[2] -= ratio * client.fall_value * 0.4;

  let bob = frame.bobfracsin * frame.xyspeed * bobUp;
  if (bob > 6) {
    bob = 6;
  }
  view[2] += bob;

  addVec3Into(view, client.kick_origin);

  view[0] = clamp(view[0], -14, 14);
  view[1] = clamp(view[1], -14, 14);
  view[2] = clamp(view[2], -22, 30);

  client.ps.viewoffset = view;
}

/**
 * Original name: SV_CalcGunOffset
 * Source: game/p_view.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Rebuilds the first-person weapon sway angles and development gun offset.
 */
export function SV_CalcGunOffset(
  ent: GameEntity,
  frame: Pick<PlayerViewFrameState, "forward" | "right" | "up" | "xyspeed" | "bobfracsin" | "bobcycle">,
  options: {
    gun_x?: number;
    gun_y?: number;
    gun_z?: number;
  } = {}
): void {
  const client = ent.client;
  if (!client) {
    return;
  }

  const gunAngles = client.ps.gunangles;
  gunAngles[ROLL] = frame.xyspeed * frame.bobfracsin * 0.005;
  gunAngles[YAW] = frame.xyspeed * frame.bobfracsin * 0.01;
  if ((frame.bobcycle & 1) !== 0) {
    gunAngles[ROLL] = -gunAngles[ROLL];
    gunAngles[YAW] = -gunAngles[YAW];
  }
  gunAngles[PITCH] = frame.xyspeed * frame.bobfracsin * 0.005;

  for (let axis = 0; axis < 3; axis += 1) {
    let delta = client.oldviewangles[axis] - client.ps.viewangles[axis];
    if (delta > 180) {
      delta -= 360;
    }
    if (delta < -180) {
      delta += 360;
    }
    delta = clamp(delta, -45, 45);
    if (axis === YAW) {
      gunAngles[ROLL] += 0.1 * delta;
    }
    gunAngles[axis] += 0.2 * delta;
  }

  const gunOffset: vec3_t = [0, 0, 0];
  const gunX = options.gun_x ?? 0;
  const gunY = options.gun_y ?? 0;
  const gunZ = options.gun_z ?? 0;
  for (let axis = 0; axis < 3; axis += 1) {
    gunOffset[axis] += frame.forward[axis] * gunY;
    gunOffset[axis] += frame.right[axis] * gunX;
    gunOffset[axis] += frame.up[axis] * -gunZ;
  }
  client.ps.gunoffset = gunOffset;
}

/**
 * Original name: SV_AddBlend
 * Source: game/p_view.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Merges one RGBA screen blend contribution into the player state blend accumulator.
 */
export function SV_AddBlend(
  r: number,
  g: number,
  b: number,
  a: number,
  blend: [number, number, number, number]
): void {
  if (a <= 0) {
    return;
  }

  const a2 = blend[3] + (1 - blend[3]) * a;
  const a3 = blend[3] / a2;
  blend[0] = blend[0] * a3 + r * (1 - a3);
  blend[1] = blend[1] * a3 + g * (1 - a3);
  blend[2] = blend[2] * a3 + b * (1 - a3);
  blend[3] = a2;
}

/**
 * Original name: SV_CalcBlend
 * Source: game/p_view.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Recomputes full-screen view blending from contents, active powerups, damage and bonus flashes.
 */
export function SV_CalcBlend(ent: GameEntity, runtime: GameRuntime): void {
  const client = ent.client;
  if (!client) {
    return;
  }

  client.ps.blend = [0, 0, 0, 0];

  const vieworg = addVec3(ent.s.origin, client.ps.viewoffset);
  const contents = runtime.collision?.pointcontents(vieworg, ent) ?? 0;
  if ((contents & (CONTENTS_LAVA | CONTENTS_SLIME | CONTENTS_WATER)) !== 0) {
    client.ps.rdflags |= RDF_UNDERWATER;
  } else {
    client.ps.rdflags &= ~RDF_UNDERWATER;
  }

  if ((contents & (CONTENTS_SOLID | CONTENTS_LAVA)) !== 0) {
    SV_AddBlend(1.0, 0.3, 0.0, 0.6, client.ps.blend);
  } else if ((contents & CONTENTS_SLIME) !== 0) {
    SV_AddBlend(0.0, 0.1, 0.05, 0.6, client.ps.blend);
  } else if ((contents & CONTENTS_WATER) !== 0) {
    SV_AddBlend(0.5, 0.3, 0.2, 0.4, client.ps.blend);
  }

  if (client.quad_framenum > runtime.framenum) {
    const remaining = client.quad_framenum - runtime.framenum;
    if (remaining === 30) {
      emitGameSound(runtime, ent, "items/damage2.wav");
    }
    if (remaining > 30 || (remaining & 4) !== 0) {
      SV_AddBlend(0, 0, 1, 0.08, client.ps.blend);
    }
  } else if (client.invincible_framenum > runtime.framenum) {
    const remaining = client.invincible_framenum - runtime.framenum;
    if (remaining === 30) {
      emitGameSound(runtime, ent, "items/protect2.wav");
    }
    if (remaining > 30 || (remaining & 4) !== 0) {
      SV_AddBlend(1, 1, 0, 0.08, client.ps.blend);
    }
  } else if (client.enviro_framenum > runtime.framenum) {
    const remaining = client.enviro_framenum - runtime.framenum;
    if (remaining === 30) {
      emitGameSound(runtime, ent, "items/airout.wav");
    }
    if (remaining > 30 || (remaining & 4) !== 0) {
      SV_AddBlend(0, 1, 0, 0.08, client.ps.blend);
    }
  } else if (client.breather_framenum > runtime.framenum) {
    const remaining = client.breather_framenum - runtime.framenum;
    if (remaining === 30) {
      emitGameSound(runtime, ent, "items/airout.wav");
    }
    if (remaining > 30 || (remaining & 4) !== 0) {
      SV_AddBlend(0.4, 1, 0.4, 0.04, client.ps.blend);
    }
  }

  if (client.damage_alpha > 0) {
    SV_AddBlend(
      client.damage_blend[0],
      client.damage_blend[1],
      client.damage_blend[2],
      client.damage_alpha,
      client.ps.blend
    );
  }

  if (client.bonus_alpha > 0) {
    SV_AddBlend(0.85, 0.7, 0.3, client.bonus_alpha, client.ps.blend);
  }

  client.damage_alpha -= 0.06;
  if (client.damage_alpha < 0) {
    client.damage_alpha = 0;
  }

  client.bonus_alpha -= 0.1;
  if (client.bonus_alpha < 0) {
    client.bonus_alpha = 0;
  }
}

/**
 * Original name: ClientEndServerFrame
 * Source: game/p_view.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Finalizes the visible player state at the end of one server frame using the currently ported presentation subset.
 *
 * Porting notes:
 * - Uses the runtime-carried `helpchanged` mirror in place of the original file-scope `game` global.
 */
export function ClientEndServerFrame(
  ent: GameEntity,
  runtime: GameRuntime,
  options: {
    sv_rollangle?: number;
    sv_rollspeed?: number;
    run_pitch?: number;
    run_roll?: number;
    bob_up?: number;
    bob_pitch?: number;
    bob_roll?: number;
    gun_x?: number;
    gun_y?: number;
    gun_z?: number;
  } = {}
): void {
  const client = ent.client;
  if (!client) {
    return;
  }

  const frame = createPlayerViewFrameState();

  for (let axis = 0; axis < 3; axis += 1) {
    client.ps.pmove.origin[axis] = Math.trunc(ent.s.origin[axis] * 8);
    client.ps.pmove.velocity[axis] = Math.trunc(ent.velocity[axis] * 8);
  }

  if (runtime.intermissiontime !== 0) {
    client.ps.blend[3] = 0;
    client.ps.fov = 90;
    G_SetStats(ent, runtime);
    return;
  }

  const basis = AngleVectors(client.v_angle);
  frame.forward = basis.forward;
  frame.right = basis.right;
  frame.up = basis.up;

  P_WorldEffects(ent, runtime);

  if (client.v_angle[PITCH] > 180) {
    ent.s.angles[PITCH] = (-360 + client.v_angle[PITCH]) / 3;
  } else {
    ent.s.angles[PITCH] = client.v_angle[PITCH] / 3;
  }
  ent.s.angles[YAW] = client.v_angle[YAW];
  ent.s.angles[ROLL] = SV_CalcRoll(
    frame.right,
    ent.velocity,
    options.sv_rollangle ?? 2,
    options.sv_rollspeed ?? 200
  ) * 4;

  frame.xyspeed = Math.hypot(ent.velocity[0], ent.velocity[1]);
  if (frame.xyspeed < 5) {
    frame.bobmove = 0;
    client.bobtime = 0;
  } else if (ent.groundentity) {
    if (frame.xyspeed > 210) {
      frame.bobmove = 0.25;
    } else if (frame.xyspeed > 100) {
      frame.bobmove = 0.125;
    } else {
      frame.bobmove = 0.0625;
    }
  }

  let bobtime = (client.bobtime += frame.bobmove);
  if ((client.ps.pmove.pm_flags & PMF_DUCKED) !== 0) {
    bobtime *= 4;
  }

  frame.bobcycle = Math.trunc(bobtime);
  frame.bobfracsin = Math.abs(Math.sin(bobtime * Math.PI));

  P_FallingDamage(ent, runtime);
  P_DamageFeedback(ent, runtime, frame);
  SV_CalcViewOffset(ent, runtime, frame, options);
  SV_CalcGunOffset(ent, frame, options);
  SV_CalcBlend(ent, runtime);

  if (client.resp.spectator) {
    G_SetSpectatorStats(ent, runtime);
  } else {
    G_SetStats(ent, runtime);
  }
  G_CheckChaseStats(ent, runtime);

  G_SetClientEvent(ent, frame);
  G_SetClientEffects(ent, runtime);
  G_SetClientSound(ent, runtime);
  G_SetClientFrame(ent, frame);

  client.oldvelocity = [...ent.velocity];
  client.oldviewangles = [...client.ps.viewangles];
  client.kick_origin = [0, 0, 0];
  client.kick_angles = [0, 0, 0];
}

/**
 * Original name: N/A
 * Source: N/A (local frame-state adapter)
 * Category: New
 * Purpose: Create the zero-initialized temporary frame state used by `ClientEndServerFrame`.
 */
export function createPlayerViewFrameState(): PlayerViewFrameState {
  return {
    forward: [0, 0, 0],
    right: [0, 0, 0],
    up: [0, 0, 0],
    xyspeed: 0,
    bobmove: 0,
    bobcycle: 0,
    bobfracsin: 0
  };
}

/**
 * Original name: newanim block
 * Source: Quake-2-master/game/p_view.c (`G_SetClientFrame`)
 * Category: Adapter
 * Purpose: Keep the original `G_SetClientFrame` goto target as a local structured helper.
 */
function setClientBaseAnimation(ent: GameEntity, client: GameClient, duck: boolean, run: boolean): void {
  client.anim_priority = ANIM_BASIC;
  client.anim_duck = duck;
  client.anim_run = run;

  if (!ent.groundentity) {
    client.anim_priority = ANIM_JUMP;
    if (ent.s.frame !== FRAME_jump2) {
      ent.s.frame = FRAME_jump1;
    }
    client.anim_end = FRAME_jump2;
    return;
  }

  if (run) {
    if (duck) {
      ent.s.frame = FRAME_crwalk1;
      client.anim_end = FRAME_crwalk6;
    } else {
      ent.s.frame = FRAME_run1;
      client.anim_end = FRAME_run6;
    }
    return;
  }

  if (duck) {
    ent.s.frame = FRAME_crstnd01;
    client.anim_end = FRAME_crstnd19;
  } else {
    ent.s.frame = FRAME_stand01;
    client.anim_end = FRAME_stand40;
  }
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Keep local vector math call sites close to the original p_view.c flow without claiming shared MATHLIB ownership.
 */
function dotProduct(left: vec3_t, right: vec3_t): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Keep local vector math call sites close to the original p_view.c flow without claiming shared MATHLIB ownership.
 */
function addVec3(left: vec3_t, right: vec3_t): vec3_t {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Keep local vector math call sites close to the original p_view.c flow without claiming shared MATHLIB ownership.
 */
function addVec3Into(target: vec3_t, addend: vec3_t): void {
  target[0] += addend[0];
  target[1] += addend[1];
  target[2] += addend[2];
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Keep local vector math call sites close to the original p_view.c flow without claiming shared MATHLIB ownership.
 */
function clearVec3(target: vec3_t): void {
  target[0] = 0;
  target[1] = 0;
  target[2] = 0;
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Keep local vector math call sites close to the original p_view.c flow without claiming shared MATHLIB ownership.
 */
function copyVec3(source: vec3_t, target: vec3_t): void {
  target[0] = source[0];
  target[1] = source[1];
  target[2] = source[2];
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Keep local vector math call sites close to the original p_view.c flow without claiming shared MATHLIB ownership.
 */
function subtractVec3(left: vec3_t, right: vec3_t): vec3_t {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Keep local vector math call sites close to the original p_view.c flow without claiming shared MATHLIB ownership.
 */
function normalizeVec3(value: vec3_t): vec3_t {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length === 0) {
    return [0, 0, 0];
  }
  return [value[0] / length, value[1] / length, value[2] / length];
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Keep local vector math call sites close to the original p_view.c flow without claiming shared MATHLIB ownership.
 */
function vectorMA(target: vec3_t, scale: number, addend: vec3_t, out: vec3_t): void {
  out[0] = target[0] + addend[0] * scale;
  out[1] = target[1] + addend[1] * scale;
  out[2] = target[2] + addend[2] * scale;
}

/**
 * Original name: N/A
 * Source: N/A (local numeric helper)
 * Category: New
 * Purpose: Keep p_view bounds checks compact without claiming a C/H portage entity.
 */
function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

/**
 * Original name: N/A
 * Source: N/A (local random helper)
 * Category: New
 * Purpose: Isolate C `rand() & 1` style branch selection behind a local TS helper.
 */
function randomInt(maxExclusive: number): number {
  return Math.trunc(Math.random() * maxExclusive);
}
