/**
 * File: p_weapon.ts
 * Source: Quake II original / game/p_weapon.c
 * Purpose: Port the player-weapon management routines and all player-fired weapon paths.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Keeps optional override hooks for tests and adapters, but the default gameplay path is now fully wired to the local `g_items.ts`, `g_weapon.ts` and runtime event queues.
 * - Player muzzle flashes and one-shot weapon sounds are journaled through runtime queues instead of a live Quake II server import table.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

import {
  AngleVectors,
  CHAN_AUTO,
  CHAN_ITEM,
  CHAN_VOICE,
  BUTTON_ATTACK,
  CHAN_WEAPON,
  MZ_BFG,
  EF_HYPERBLASTER,
  EF_BLASTER,
  MZ_CHAINGUN1,
  MZ_CHAINGUN2,
  MZ_CHAINGUN3,
  PMF_DUCKED,
  PITCH,
  PRINT_HIGH,
  DF_INFINITE_AMMO,
  DF_WEAPONS_STAY,
  MZ_BLASTER,
  MZ_GRENADE,
  MZ_HYPERBLASTER,
  MZ_MACHINEGUN,
  MZ_RAILGUN,
  MZ_ROCKET,
  MZ_SILENCED,
  MZ_SHOTGUN,
  MZ_SSHOTGUN,
  ROLL,
  temp_event_t,
  YAW,
  type vec3_t
} from "../../qcommon/src/index.js";
import {
  DAMAGE_TIME,
  DEFAULT_BULLET_HSPREAD,
  DEFAULT_BULLET_VSPREAD,
  DEFAULT_DEATHMATCH_SHOTGUN_COUNT,
  DEFAULT_SHOTGUN_COUNT,
  DEFAULT_SHOTGUN_HSPREAD,
  DEFAULT_SHOTGUN_VSPREAD,
  DEFAULT_SSHOTGUN_COUNT,
  DROPPED_ITEM,
  DROPPED_PLAYER_ITEM,
  FL_NOTARGET,
  FL_RESPAWN,
  LEFT_HANDED,
  MOD_CHAINGUN,
  MOD_MACHINEGUN,
  MOD_SHOTGUN,
  MOD_SSHOTGUN,
  CENTER_HANDED,
  ANIM_ATTACK,
  ANIM_PAIN,
  ANIM_REVERSE,
  DEAD_NO,
  SVF_NOCLIENT,
  emitGameSound,
  emitPlayerMuzzleFlash,
  linkGameEntity,
  spawnGameEntity,
  weaponstate_t,
  registerGameModel,
  registerGameSound,
  type GameClient,
  type GameEntity,
  type GameRuntime
} from "./runtime.js";
import { IT_AMMO, PNOISE_SELF, PNOISE_WEAPON, crandom, random } from "./g_local.js";
import { fire_bfg, fire_blaster, fire_bullet, fire_grenade, fire_grenade2, fire_rail, fire_rocket, fire_shotgun } from "./g_weapon.js";
import { Add_Ammo, Drop_Item, FindItem, SetRespawn, type GameItemDefinition, type GameItemWeaponThinkKind } from "./g_items.js";

const FRAME_attack1 = 46;
const FRAME_attack8 = 53;
const FRAME_wave01 = 112;
const FRAME_wave08 = 119;
const FRAME_pain301 = 62;
const FRAME_pain304 = 65;
const FRAME_crattak1 = 160;
const FRAME_crattak3 = 162;
const FRAME_crattak9 = 168;
const FRAME_crpain1 = 169;
const FRAME_crpain4 = 172;
const GRENADE_TIMER = 3.0;
const GRENADE_MINSPEED = 400;
const GRENADE_MAXSPEED = 800;
/**
 * Original name: N/A
 * Source: N/A (local hook interface)
 * Category: New
 * Purpose: Preserve the still-external callbacks required by the first `p_weapon.c` port.
 *
 * Constraints:
 * - Must keep unported engine/game-import paths explicit.
 */
export interface GameWeaponHooks {
  Add_Ammo?: (ent: GameEntity, item: GameItemDefinition, count: number, runtime: GameRuntime) => boolean;
  Drop_Item?: (ent: GameEntity, item: GameItemDefinition, runtime: GameRuntime) => GameEntity | null;
  SetRespawn?: (ent: GameEntity, delaySeconds: number, runtime: GameRuntime) => void;
  emitPlayerMuzzleFlash?: (ent: GameEntity, weapon: number, runtime: GameRuntime) => void;
  emitTempEntity?: (event: temp_event_t, payload: Record<string, unknown>, runtime: GameRuntime) => void;
  playWeaponSound?: (ent: GameEntity, soundPath: string, channel: number, runtime: GameRuntime) => void;
  fire_bfg?: (
    ent: GameEntity,
    start: vec3_t,
    dir: vec3_t,
    damage: number,
    speed: number,
    damageRadius: number,
    runtime: GameRuntime
  ) => void;
  fire_blaster?: (
    ent: GameEntity,
    start: vec3_t,
    dir: vec3_t,
    damage: number,
    speed: number,
    effect: number,
    hyper: boolean,
    runtime: GameRuntime
  ) => void;
  fire_bullet?: (
    ent: GameEntity,
    start: vec3_t,
    aimdir: vec3_t,
    damage: number,
    kick: number,
    hspread: number,
    vspread: number,
    mod: number,
    runtime: GameRuntime
  ) => void;
  fire_grenade?: (
    ent: GameEntity,
    start: vec3_t,
    dir: vec3_t,
    damage: number,
    speed: number,
    timer: number,
    damageRadius: number,
    runtime: GameRuntime
  ) => void;
  fire_grenade2?: (
    ent: GameEntity,
    start: vec3_t,
    dir: vec3_t,
    damage: number,
    speed: number,
    timer: number,
    damageRadius: number,
    held: boolean,
    runtime: GameRuntime
  ) => void;
  fire_rail?: (
    ent: GameEntity,
    start: vec3_t,
    dir: vec3_t,
    damage: number,
    kick: number,
    runtime: GameRuntime
  ) => void;
  fire_rocket?: (
    ent: GameEntity,
    start: vec3_t,
    dir: vec3_t,
    damage: number,
    speed: number,
    damageRadius: number,
    radiusDamage: number,
    runtime: GameRuntime
  ) => void;
  fire_shotgun?: (
    ent: GameEntity,
    start: vec3_t,
    aimdir: vec3_t,
    damage: number,
    kick: number,
    hspread: number,
    vspread: number,
    count: number,
    mod: number,
    runtime: GameRuntime
  ) => void;
  weaponThink?: Partial<Record<GameItemWeaponThinkKind, (ent: GameEntity, runtime: GameRuntime, hooks: GameWeaponHooks) => void>>;
}

/**
 * Original name: P_ProjectSource
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Projects one weapon muzzle source from a point using handedness-adjusted local offsets.
 */
export function P_ProjectSource(
  client: GameClient,
  point: vec3_t,
  distance: vec3_t,
  forward: vec3_t,
  right: vec3_t
): vec3_t {
  const projectedDistance: vec3_t = [...distance];
  if (client.pers.hand === LEFT_HANDED) {
    projectedDistance[1] *= -1;
  } else if (client.pers.hand === CENTER_HANDED) {
    projectedDistance[1] = 0;
  }

  return [
    point[0] + (forward[0] * projectedDistance[0]) + (right[0] * projectedDistance[1]),
    point[1] + (forward[1] * projectedDistance[0]) + (right[1] * projectedDistance[1]),
    point[2] + (forward[2] * projectedDistance[0]) + (right[2] * projectedDistance[1]) + projectedDistance[2]
  ];
}

/**
 * Original name: PlayerNoise
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Updates the player's personal or impact noise entities for monster hearing.
 *
 * Porting notes:
 * - Reuses the local gameplay runtime entity allocator until the full AI/noise pipeline is ported.
 */
export function PlayerNoise(who: GameEntity, where: vec3_t, type: number, runtime: GameRuntime): void {
  const client = requireClient(who, "PlayerNoise");

  if (type === PNOISE_WEAPON) {
    if (client.silencer_shots) {
      client.silencer_shots--;
      return;
    }
  }

  if (runtime.deathmatch) {
    return;
  }

  if ((who.flags & FL_NOTARGET) !== 0) {
    return;
  }

  if (!who.mynoise) {
    who.mynoise = createPlayerNoiseEntity(who, runtime);
    who.mynoise2 = createPlayerNoiseEntity(who, runtime);
  }

  let noise: GameEntity | null = who.mynoise;
  if (type === PNOISE_SELF || type === PNOISE_WEAPON) {
    runtime.sound_entity = noise;
    runtime.sound_entity_framenum = runtime.framenum;
  } else {
    noise = who.mynoise2;
    runtime.sound2_entity = noise;
    runtime.sound2_entity_framenum = runtime.framenum;
  }

  if (!noise) {
    return;
  }

  noise.origin = [...where];
  noise.s.origin = [...where];
  noise.absmin = [where[0] - noise.maxs[0], where[1] - noise.maxs[1], where[2] - noise.maxs[2]];
  noise.absmax = [where[0] + noise.maxs[0], where[1] + noise.maxs[1], where[2] + noise.maxs[2]];
  noise.teleport_time = runtime.time;
  linkGameEntity(runtime, noise);
}

/**
 * Original name: Pickup_Weapon
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Handles weapon pickup inventory, ammo grant and default weapon switch rules.
 *
 * Porting notes:
 * - Uses local `g_items.ts` functions by default, while keeping optional overrides for targeted tests.
 */
export function Pickup_Weapon(
  ent: GameEntity,
  other: GameEntity,
  item: GameItemDefinition,
  runtime: GameRuntime,
  hooks: GameWeaponHooks = {}
): boolean {
  const client = requireClient(other, "Pickup_Weapon");
  const index = ITEM_INDEX(item);

  if ((((runtime.dmflags & DF_WEAPONS_STAY) !== 0) || runtime.coop) && client.pers.inventory[index] > 0) {
    if ((ent.spawnflags & (DROPPED_ITEM | DROPPED_PLAYER_ITEM)) === 0) {
      return false;
    }
  }

  client.pers.inventory[index]++;

  if ((ent.spawnflags & DROPPED_ITEM) === 0) {
    const ammo = item.ammo ? FindItem(item.ammo) : null;
    if (ammo) {
      const addAmmo = hooks.Add_Ammo ?? Add_Ammo;
      if ((runtime.dmflags & DF_INFINITE_AMMO) !== 0) {
        addAmmo(other, ammo, 1000, runtime);
      } else {
        addAmmo(other, ammo, ammo.quantity, runtime);
      }
    }

    if ((ent.spawnflags & DROPPED_PLAYER_ITEM) === 0) {
      if (runtime.deathmatch) {
        if ((runtime.dmflags & DF_WEAPONS_STAY) !== 0) {
          ent.flags |= FL_RESPAWN;
        } else {
          (hooks.SetRespawn ?? SetRespawn)(ent, 30, runtime);
        }
      }
      if (runtime.coop) {
        ent.flags |= FL_RESPAWN;
      }
    }
  }

  if (
    client.pers.weapon !== item &&
    client.pers.inventory[index] === 1 &&
    (!runtime.deathmatch || client.pers.weapon === FindItem("blaster"))
  ) {
    client.newweapon = item;
  }

  return true;
}

/**
 * Original name: ChangeWeapon
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Drops the previous weapon completely and activates `client->newweapon`.
 *
 * Porting notes:
 * - Preserves the original held-grenade flush during weapon change by reusing the same local weapon fire path.
 */
export function ChangeWeapon(ent: GameEntity, runtime: GameRuntime, hooks: GameWeaponHooks = {}): void {
  const client = requireClient(ent, "ChangeWeapon");

  if (client.grenade_time) {
    client.grenade_time = runtime.time;
    client.weapon_sound = 0;
    weapon_grenade_fire(ent, false, runtime, hooks);
    client.grenade_time = 0;
  }

  client.pers.lastweapon = client.pers.weapon;
  client.pers.weapon = client.newweapon;
  client.newweapon = null;
  client.machinegun_shots = 0;

  if (ent.s.modelindex === 255) {
    const visibleWeapon = client.pers.weapon ? ((client.pers.weapon.weapmodel & 0xff) << 8) : 0;
    ent.s.skinnum = Math.max(0, ent.index - 1) | visibleWeapon;
  }

  client.ammo_index = client.pers.weapon?.ammo ? ITEM_INDEX(FindItem(client.pers.weapon.ammo)) : 0;

  if (!client.pers.weapon) {
    client.ps.gunindex = 0;
    return;
  }

  client.weaponstate = weaponstate_t.WEAPON_ACTIVATING;
  client.ps.gunframe = 0;
  client.ps.gunindex = client.pers.weapon.viewModel ? registerGameModel(runtime, client.pers.weapon.viewModel) : 0;

  client.anim_priority = ANIM_PAIN;
  if ((client.ps.pmove.pm_flags & PMF_DUCKED) !== 0) {
    ent.s.frame = FRAME_crpain1;
    client.anim_end = FRAME_crpain4;
  } else {
    ent.s.frame = FRAME_pain301;
    client.anim_end = FRAME_pain304;
  }
}

/**
 * Original name: NoAmmoWeaponChange
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Selects the next fallback weapon in the original priority order when ammo runs out.
 */
export function NoAmmoWeaponChange(ent: GameEntity): void {
  const client = requireClient(ent, "NoAmmoWeaponChange");

  if (hasInventoryWeapon(client, "slugs", "railgun")) {
    client.newweapon = FindItem("railgun");
    return;
  }
  if (hasInventoryWeapon(client, "cells", "hyperblaster")) {
    client.newweapon = FindItem("hyperblaster");
    return;
  }
  if (hasInventoryWeapon(client, "bullets", "chaingun")) {
    client.newweapon = FindItem("chaingun");
    return;
  }
  if (hasInventoryWeapon(client, "bullets", "machinegun")) {
    client.newweapon = FindItem("machinegun");
    return;
  }
  if (getInventoryCount(client, "shells") > 1 && getInventoryCount(client, "super shotgun") > 0) {
    client.newweapon = FindItem("super shotgun");
    return;
  }
  if (hasInventoryWeapon(client, "shells", "shotgun")) {
    client.newweapon = FindItem("shotgun");
    return;
  }

  client.newweapon = FindItem("blaster");
}

/**
 * Original name: Think_Weapon
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Dispatches the active weapon think routine once per player frame.
 *
 * Porting notes:
 * - Falls back to the local `p_weapon.ts` dispatch table and keeps overrides only for targeted tests/adapters.
 */
export function Think_Weapon(ent: GameEntity, runtime: GameRuntime, hooks: GameWeaponHooks = {}): void {
  const client = requireClient(ent, "Think_Weapon");

  if (ent.health < 1) {
    client.newweapon = null;
    ChangeWeapon(ent, runtime, hooks);
  }

  const weaponThinkKind = client.pers.weapon?.weaponThink;
  if (!weaponThinkKind) {
    return;
  }

  const thinker = hooks.weaponThink?.[weaponThinkKind] ?? getDefaultWeaponThink(weaponThinkKind);
  if (!thinker) {
    runtime.log({
      kind: "warning",
      message: `Weapon think not ported yet: ${weaponThinkKind}`,
      entityIndex: ent.index,
      entityClassname: ent.classname
    });
    return;
  }

  thinker(ent, runtime, hooks);
}

/**
 * Original name: Use_Weapon
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Requests a weapon switch when ammo requirements are satisfied.
 */
export function Use_Weapon(ent: GameEntity, item: GameItemDefinition, runtime: GameRuntime): void {
  const client = requireClient(ent, "Use_Weapon");

  if (item === client.pers.weapon) {
    return;
  }

  if (item.ammo && !runtime.g_select_empty && (item.flags & IT_AMMO) === 0) {
    const ammoItem = FindItem(item.ammo);
    const ammoIndex = ITEM_INDEX(ammoItem);

    if (!ammoItem || !client.pers.inventory[ammoIndex]) {
      printWeaponMessage(runtime, ent, `No ${ammoItem?.pickupName ?? item.ammo} for ${item.pickupName}.`);
      return;
    }

    if (client.pers.inventory[ammoIndex] < item.quantity) {
      printWeaponMessage(runtime, ent, `Not enough ${ammoItem.pickupName} for ${item.pickupName}.`);
      return;
    }
  }

  client.newweapon = item;
}

/**
 * Original name: Drop_Weapon
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Drops one weapon item when the current rules allow it.
 *
 * Porting notes:
 * - Uses the ported `Drop_Item` path by default while preserving hook injection for tests/adapters.
 */
export function Drop_Weapon(ent: GameEntity, item: GameItemDefinition, runtime: GameRuntime, hooks: GameWeaponHooks = {}): void {
  const client = requireClient(ent, "Drop_Weapon");

  if ((runtime.dmflags & DF_WEAPONS_STAY) !== 0) {
    return;
  }

  const index = ITEM_INDEX(item);
  if ((item === client.pers.weapon || item === client.newweapon) && client.pers.inventory[index] === 1) {
    printWeaponMessage(runtime, ent, "Can't drop current weapon");
    return;
  }

  (hooks.Drop_Item ?? Drop_Item)(ent, item, runtime);
  client.pers.inventory[index]--;
}

/**
 * Original name: Weapon_Generic
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Drives the common activate / ready / firing / deactivate state machine for weapons.
 *
 * Porting notes:
 * - Preserves frame transitions and no-ammo behavior exactly, while using one callback for the concrete fire path.
 */
export function Weapon_Generic(
  ent: GameEntity,
  runtime: GameRuntime,
  hooks: GameWeaponHooks,
  FRAME_ACTIVATE_LAST: number,
  FRAME_FIRE_LAST: number,
  FRAME_IDLE_LAST: number,
  FRAME_DEACTIVATE_LAST: number,
  pause_frames: readonly number[] | null,
  fire_frames: readonly number[],
  fire: (ent: GameEntity, runtime: GameRuntime, hooks: GameWeaponHooks) => void
): void {
  const client = requireClient(ent, "Weapon_Generic");
  const FRAME_FIRE_FIRST = FRAME_ACTIVATE_LAST + 1;
  const FRAME_IDLE_FIRST = FRAME_FIRE_LAST + 1;
  const FRAME_DEACTIVATE_FIRST = FRAME_IDLE_LAST + 1;

  if (ent.deadflag !== DEAD_NO || ent.s.modelindex !== 255) {
    return;
  }

  if (client.weaponstate === weaponstate_t.WEAPON_DROPPING) {
    if (client.ps.gunframe === FRAME_DEACTIVATE_LAST) {
      ChangeWeapon(ent, runtime, hooks);
      return;
    }

    if ((FRAME_DEACTIVATE_LAST - client.ps.gunframe) === 4) {
      client.anim_priority = ANIM_REVERSE;
      if ((client.ps.pmove.pm_flags & PMF_DUCKED) !== 0) {
        ent.s.frame = FRAME_crpain4 + 1;
        client.anim_end = FRAME_crpain1;
      } else {
        ent.s.frame = FRAME_pain304 + 1;
        client.anim_end = FRAME_pain301;
      }
    }

    client.ps.gunframe++;
    return;
  }

  if (client.weaponstate === weaponstate_t.WEAPON_ACTIVATING) {
    if (client.ps.gunframe === FRAME_ACTIVATE_LAST) {
      client.weaponstate = weaponstate_t.WEAPON_READY;
      client.ps.gunframe = FRAME_IDLE_FIRST;
      return;
    }

    client.ps.gunframe++;
    return;
  }

  if (client.newweapon && client.weaponstate !== weaponstate_t.WEAPON_FIRING) {
    client.weaponstate = weaponstate_t.WEAPON_DROPPING;
    client.ps.gunframe = FRAME_DEACTIVATE_FIRST;

    if ((FRAME_DEACTIVATE_LAST - FRAME_DEACTIVATE_FIRST) < 4) {
      client.anim_priority = ANIM_REVERSE;
      if ((client.ps.pmove.pm_flags & PMF_DUCKED) !== 0) {
        ent.s.frame = FRAME_crpain4 + 1;
        client.anim_end = FRAME_crpain1;
      } else {
        ent.s.frame = FRAME_pain304 + 1;
        client.anim_end = FRAME_pain301;
      }
    }
    return;
  }

  if (client.weaponstate === weaponstate_t.WEAPON_READY) {
    if (((client.latched_buttons | client.buttons) & BUTTON_ATTACK) !== 0) {
      client.latched_buttons &= ~BUTTON_ATTACK;
      if (client.ammo_index === 0 || client.pers.inventory[client.ammo_index] >= (client.pers.weapon?.quantity ?? 0)) {
        client.ps.gunframe = FRAME_FIRE_FIRST;
        client.weaponstate = weaponstate_t.WEAPON_FIRING;
        client.anim_priority = ANIM_ATTACK;
        if ((client.ps.pmove.pm_flags & PMF_DUCKED) !== 0) {
          ent.s.frame = FRAME_crattak1 - 1;
          client.anim_end = FRAME_crattak9;
        } else {
          ent.s.frame = FRAME_attack1 - 1;
          client.anim_end = FRAME_attack8;
        }
      } else {
        if (runtime.time >= ent.pain_debounce_time) {
          playWeaponOneShot(ent, "weapons/noammo.wav", CHAN_VOICE, runtime, hooks);
          ent.pain_debounce_time = runtime.time + 1;
        }
        NoAmmoWeaponChange(ent);
      }
    } else {
      if (client.ps.gunframe === FRAME_IDLE_LAST) {
        client.ps.gunframe = FRAME_IDLE_FIRST;
        return;
      }

      if (pause_frames) {
        for (const pauseFrame of pause_frames) {
          if (pauseFrame === 0) {
            break;
          }
          if (client.ps.gunframe === pauseFrame && ((Math.floor(Math.random() * 0x7fffffff) & 15) !== 0)) {
            return;
          }
        }
      }

      client.ps.gunframe++;
      return;
    }
  }

  if (client.weaponstate === weaponstate_t.WEAPON_FIRING) {
    let matched = false;
    for (const fireFrame of fire_frames) {
      if (fireFrame === 0) {
        break;
      }
      if (client.ps.gunframe === fireFrame) {
        matched = true;
        if (client.quad_framenum > runtime.framenum) {
          playWeaponOneShot(ent, "items/damage3.wav", CHAN_ITEM, runtime, hooks);
        }
        fire(ent, runtime, hooks);
        break;
      }
    }

    if (!matched) {
      client.ps.gunframe++;
    }

    if (client.ps.gunframe === FRAME_IDLE_FIRST + 1) {
      client.weaponstate = weaponstate_t.WEAPON_READY;
    }
  }
}

/**
 * Original name: Blaster_Fire
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Fires one blaster or hyperblaster shot from the player weapon muzzle.
 *
 * Porting notes:
 * - Delegates the actual projectile spawn and muzzleflash packet emission to explicit hooks.
 */
export function Blaster_Fire(
  ent: GameEntity,
  g_offset: vec3_t,
  damage: number,
  hyper: boolean,
  effect: number,
  runtime: GameRuntime,
  hooks: GameWeaponHooks = {}
): void {
  const client = requireClient(ent, "Blaster_Fire");

  if (client.quad_framenum > runtime.framenum) {
    damage *= 4;
  }

  const vectors = AngleVectors(client.v_angle);
  const offset: vec3_t = [24 + g_offset[0], 8 + g_offset[1], ent.viewheight - 8 + g_offset[2]];
  const start = P_ProjectSource(client, ent.s.origin, offset, vectors.forward, vectors.right);

  client.kick_origin = [vectors.forward[0] * -2, vectors.forward[1] * -2, vectors.forward[2] * -2];
  client.kick_angles[0] = -1;

  resolveFireBlaster(hooks)(ent, start, vectors.forward, damage, 1000, effect, hyper, runtime);
  queuePlayerMuzzleFlash(ent, (hyper ? MZ_HYPERBLASTER : MZ_BLASTER) | getSilencedMuzzleBits(client), runtime, hooks);
  PlayerNoise(ent, start, PNOISE_WEAPON, runtime);
}

/**
 * Original name: Weapon_Blaster_Fire
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Executes one blaster firing frame with original deathmatch damage selection.
 */
export function Weapon_Blaster_Fire(ent: GameEntity, runtime: GameRuntime, hooks: GameWeaponHooks = {}): void {
  const client = requireClient(ent, "Weapon_Blaster_Fire");
  const damage = runtime.deathmatch ? 15 : 10;
  Blaster_Fire(ent, [0, 0, 0], damage, false, EF_BLASTER, runtime, hooks);
  client.ps.gunframe++;
}

/**
 * Original name: Weapon_Blaster
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Runs the generic state machine for the blaster weapon.
 */
export function Weapon_Blaster(ent: GameEntity, runtime: GameRuntime, hooks: GameWeaponHooks = {}): void {
  Weapon_Generic(ent, runtime, hooks, 4, 8, 52, 55, [19, 32, 0], [5, 0], Weapon_Blaster_Fire);
}

/**
 * Original name: weapon_shotgun_fire
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Executes one shotgun firing frame, including the two-frame fire quirk from the original code.
 *
 * Porting notes:
 * - Delegates pellet simulation and muzzleflash packet emission to explicit hooks.
 */
export function weapon_shotgun_fire(ent: GameEntity, runtime: GameRuntime, hooks: GameWeaponHooks = {}): void {
  const client = requireClient(ent, "weapon_shotgun_fire");
  let damage = 4;
  let kick = 8;

  if (client.ps.gunframe === 9) {
    client.ps.gunframe++;
    return;
  }

  const vectors = AngleVectors(client.v_angle);
  client.kick_origin = [vectors.forward[0] * -2, vectors.forward[1] * -2, vectors.forward[2] * -2];
  client.kick_angles[0] = -2;

  const start = P_ProjectSource(client, ent.s.origin, [0, 8, ent.viewheight - 8], vectors.forward, vectors.right);

  if (client.quad_framenum > runtime.framenum) {
    damage *= 4;
    kick *= 4;
  }

  resolveFireShotgun(hooks)(
    ent,
    start,
    vectors.forward,
    damage,
    kick,
    500,
    500,
    runtime.deathmatch ? DEFAULT_DEATHMATCH_SHOTGUN_COUNT : DEFAULT_SHOTGUN_COUNT,
    MOD_SHOTGUN,
    runtime
  );
  queuePlayerMuzzleFlash(ent, MZ_SHOTGUN | getSilencedMuzzleBits(client), runtime, hooks);

  client.ps.gunframe++;
  PlayerNoise(ent, start, PNOISE_WEAPON, runtime);

  if ((runtime.dmflags & DF_INFINITE_AMMO) === 0) {
    client.pers.inventory[client.ammo_index]--;
  }
}

/**
 * Original name: Weapon_Shotgun
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Runs the generic state machine for the shotgun weapon.
 */
export function Weapon_Shotgun(ent: GameEntity, runtime: GameRuntime, hooks: GameWeaponHooks = {}): void {
  Weapon_Generic(ent, runtime, hooks, 7, 18, 36, 39, [22, 28, 34, 0], [8, 9, 0], weapon_shotgun_fire);
}

/**
 * Original name: weapon_supershotgun_fire
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Executes one super-shotgun blast as two offset shotgun traces.
 *
 * Porting notes:
 * - Delegates pellet simulation and muzzleflash packet emission to explicit hooks.
 */
export function weapon_supershotgun_fire(ent: GameEntity, runtime: GameRuntime, hooks: GameWeaponHooks = {}): void {
  const client = requireClient(ent, "weapon_supershotgun_fire");
  let damage = 6;
  let kick = 12;

  const baseVectors = AngleVectors(client.v_angle);
  client.kick_origin = [baseVectors.forward[0] * -2, baseVectors.forward[1] * -2, baseVectors.forward[2] * -2];
  client.kick_angles[0] = -2;

  const start = P_ProjectSource(client, ent.s.origin, [0, 8, ent.viewheight - 8], baseVectors.forward, baseVectors.right);

  if (client.quad_framenum > runtime.framenum) {
    damage *= 4;
    kick *= 4;
  }

  const v: vec3_t = [client.v_angle[PITCH], client.v_angle[YAW] - 5, client.v_angle[ROLL]];
  let forward = AngleVectors(v).forward;
  resolveFireShotgun(hooks)(
    ent,
    start,
    forward,
    damage,
    kick,
    DEFAULT_SHOTGUN_HSPREAD,
    DEFAULT_SHOTGUN_VSPREAD,
    DEFAULT_SSHOTGUN_COUNT / 2,
    MOD_SSHOTGUN,
    runtime
  );

  v[YAW] = client.v_angle[YAW] + 5;
  forward = AngleVectors(v).forward;
  resolveFireShotgun(hooks)(
    ent,
    start,
    forward,
    damage,
    kick,
    DEFAULT_SHOTGUN_HSPREAD,
    DEFAULT_SHOTGUN_VSPREAD,
    DEFAULT_SSHOTGUN_COUNT / 2,
    MOD_SSHOTGUN,
    runtime
  );

  queuePlayerMuzzleFlash(ent, MZ_SSHOTGUN | getSilencedMuzzleBits(client), runtime, hooks);

  client.ps.gunframe++;
  PlayerNoise(ent, start, PNOISE_WEAPON, runtime);

  if ((runtime.dmflags & DF_INFINITE_AMMO) === 0) {
    client.pers.inventory[client.ammo_index] -= 2;
  }
}

/**
 * Original name: Weapon_SuperShotgun
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Runs the generic state machine for the super shotgun.
 */
export function Weapon_SuperShotgun(ent: GameEntity, runtime: GameRuntime, hooks: GameWeaponHooks = {}): void {
  Weapon_Generic(ent, runtime, hooks, 6, 17, 57, 61, [29, 42, 57, 0], [7, 0], weapon_supershotgun_fire);
}

/**
 * Original name: Weapon_HyperBlaster_Fire
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Handles the hyperblaster spin loop, circular offset pattern and repeated fire frames.
 *
 * Porting notes:
 * - Keeps continuous weapon hum state in `client.weapon_sound` while delegating projectile spawn and explicit one-shot audio.
 */
export function Weapon_HyperBlaster_Fire(ent: GameEntity, runtime: GameRuntime, hooks: GameWeaponHooks = {}): void {
  const client = requireClient(ent, "Weapon_HyperBlaster_Fire");
  let damage: number;
  let effect: number;

  client.weapon_sound = registerGameSound(runtime, "weapons/hyprbl1a.wav");

  if ((client.buttons & BUTTON_ATTACK) === 0) {
    client.ps.gunframe++;
  } else {
    if (client.pers.inventory[client.ammo_index] === 0) {
      if (runtime.time >= ent.pain_debounce_time) {
        playWeaponOneShot(ent, "weapons/noammo.wav", CHAN_VOICE, runtime, hooks);
        ent.pain_debounce_time = runtime.time + 1;
      }
      NoAmmoWeaponChange(ent);
    } else {
      const rotation = (client.ps.gunframe - 5) * 2 * Math.PI / 6;
      const offset: vec3_t = [-4 * Math.sin(rotation), 0, 4 * Math.cos(rotation)];
      effect = (client.ps.gunframe === 6 || client.ps.gunframe === 9) ? EF_HYPERBLASTER : 0;
      damage = runtime.deathmatch ? 15 : 20;
      Blaster_Fire(ent, offset, damage, true, effect, runtime, hooks);

      if ((runtime.dmflags & DF_INFINITE_AMMO) === 0) {
        client.pers.inventory[client.ammo_index]--;
      }

      client.anim_priority = ANIM_ATTACK;
      if ((client.ps.pmove.pm_flags & PMF_DUCKED) !== 0) {
        ent.s.frame = FRAME_crattak1 - 1;
        client.anim_end = FRAME_crattak9;
      } else {
        ent.s.frame = FRAME_attack1 - 1;
        client.anim_end = FRAME_attack8;
      }
    }

    client.ps.gunframe++;
    if (client.ps.gunframe === 12 && client.pers.inventory[client.ammo_index] > 0) {
      client.ps.gunframe = 6;
    }
  }

  if (client.ps.gunframe === 12) {
    playWeaponOneShot(ent, "weapons/hyprbd1a.wav", CHAN_AUTO, runtime, hooks);
    client.weapon_sound = 0;
  }
}

/**
 * Original name: Weapon_HyperBlaster
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Runs the generic state machine for the hyperblaster.
 */
export function Weapon_HyperBlaster(ent: GameEntity, runtime: GameRuntime, hooks: GameWeaponHooks = {}): void {
  Weapon_Generic(ent, runtime, hooks, 5, 20, 49, 53, [0], [6, 7, 8, 9, 10, 11, 0], Weapon_HyperBlaster_Fire);
}

/**
 * Original name: Machinegun_Fire
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Executes the machinegun fire loop, recoil accumulation and ammo consumption.
 *
 * Porting notes:
 * - Delegates the actual bullet trace/spawn and muzzleflash packet emission to explicit hooks.
 */
export function Machinegun_Fire(ent: GameEntity, runtime: GameRuntime, hooks: GameWeaponHooks = {}): void {
  const client = requireClient(ent, "Machinegun_Fire");
  let damage = 8;
  let kick = 2;

  if ((client.buttons & BUTTON_ATTACK) === 0) {
    client.machinegun_shots = 0;
    client.ps.gunframe++;
    return;
  }

  client.ps.gunframe = client.ps.gunframe === 5 ? 4 : 5;

  if (client.pers.inventory[client.ammo_index] < 1) {
    client.ps.gunframe = 6;
    if (runtime.time >= ent.pain_debounce_time) {
      playWeaponOneShot(ent, "weapons/noammo.wav", CHAN_VOICE, runtime, hooks);
      ent.pain_debounce_time = runtime.time + 1;
    }
    NoAmmoWeaponChange(ent);
    return;
  }

  if (client.quad_framenum > runtime.framenum) {
    damage *= 4;
    kick *= 4;
  }

  for (let i = 1; i < 3; i += 1) {
    client.kick_origin[i] = crandom() * 0.35;
    client.kick_angles[i] = crandom() * 0.7;
  }
  client.kick_origin[0] = crandom() * 0.35;
  client.kick_angles[0] = client.machinegun_shots * -1.5;

  if (!runtime.deathmatch) {
    client.machinegun_shots++;
    if (client.machinegun_shots > 9) {
      client.machinegun_shots = 9;
    }
  }

  const angles: vec3_t = [
    client.v_angle[0] + client.kick_angles[0],
    client.v_angle[1] + client.kick_angles[1],
    client.v_angle[2] + client.kick_angles[2]
  ];
  const vectors = AngleVectors(angles);
  const start = P_ProjectSource(client, ent.s.origin, [0, 8, ent.viewheight - 8], vectors.forward, vectors.right);

  resolveFireBullet(hooks)(
    ent,
    start,
    vectors.forward,
    damage,
    kick,
    DEFAULT_BULLET_HSPREAD,
    DEFAULT_BULLET_VSPREAD,
    MOD_MACHINEGUN,
    runtime
  );
  queuePlayerMuzzleFlash(ent, MZ_MACHINEGUN | getSilencedMuzzleBits(client), runtime, hooks);
  PlayerNoise(ent, start, PNOISE_WEAPON, runtime);

  if ((runtime.dmflags & DF_INFINITE_AMMO) === 0) {
    client.pers.inventory[client.ammo_index]--;
  }

  client.anim_priority = ANIM_ATTACK;
  if ((client.ps.pmove.pm_flags & PMF_DUCKED) !== 0) {
    ent.s.frame = FRAME_crattak1 - randomIntFromFloat();
    client.anim_end = FRAME_crattak9;
  } else {
    ent.s.frame = FRAME_attack1 - randomIntFromFloat();
    client.anim_end = FRAME_attack8;
  }
}

/**
 * Original name: Weapon_Machinegun
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Runs the generic state machine for the machinegun.
 */
export function Weapon_Machinegun(ent: GameEntity, runtime: GameRuntime, hooks: GameWeaponHooks = {}): void {
  Weapon_Generic(ent, runtime, hooks, 3, 5, 45, 49, [23, 45, 0], [4, 5, 0], Machinegun_Fire);
}

/**
 * Original name: Chaingun_Fire
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Handles chaingun windup, variable bullet count, loop sound state and ammo consumption.
 *
 * Porting notes:
 * - Delegates bullet simulation, muzzleflash packet emission and explicit one-shot sounds to hooks.
 */
export function Chaingun_Fire(ent: GameEntity, runtime: GameRuntime, hooks: GameWeaponHooks = {}): void {
  const client = requireClient(ent, "Chaingun_Fire");
  let damage = runtime.deathmatch ? 6 : 8;
  let kick = 2;

  if (client.ps.gunframe === 5) {
    playWeaponOneShot(ent, "weapons/chngnu1a.wav", CHAN_AUTO, runtime, hooks);
  }

  if (client.ps.gunframe === 14 && (client.buttons & BUTTON_ATTACK) === 0) {
    client.ps.gunframe = 32;
    client.weapon_sound = 0;
    return;
  }
  if (client.ps.gunframe === 21 && (client.buttons & BUTTON_ATTACK) !== 0 && client.pers.inventory[client.ammo_index] > 0) {
    client.ps.gunframe = 15;
  } else {
    client.ps.gunframe++;
  }

  if (client.ps.gunframe === 22) {
    client.weapon_sound = 0;
    playWeaponOneShot(ent, "weapons/chngnd1a.wav", CHAN_AUTO, runtime, hooks);
  } else {
    client.weapon_sound = registerGameSound(runtime, "weapons/chngnl1a.wav");
  }

  client.anim_priority = ANIM_ATTACK;
  if ((client.ps.pmove.pm_flags & PMF_DUCKED) !== 0) {
    ent.s.frame = FRAME_crattak1 - (client.ps.gunframe & 1);
    client.anim_end = FRAME_crattak9;
  } else {
    ent.s.frame = FRAME_attack1 - (client.ps.gunframe & 1);
    client.anim_end = FRAME_attack8;
  }

  let shots: number;
  if (client.ps.gunframe <= 9) {
    shots = 1;
  } else if (client.ps.gunframe <= 14) {
    shots = (client.buttons & BUTTON_ATTACK) !== 0 ? 2 : 1;
  } else {
    shots = 3;
  }

  if (client.pers.inventory[client.ammo_index] < shots) {
    shots = client.pers.inventory[client.ammo_index];
  }

  if (!shots) {
    if (runtime.time >= ent.pain_debounce_time) {
      playWeaponOneShot(ent, "weapons/noammo.wav", CHAN_VOICE, runtime, hooks);
      ent.pain_debounce_time = runtime.time + 1;
    }
    NoAmmoWeaponChange(ent);
    return;
  }

  if (client.quad_framenum > runtime.framenum) {
    damage *= 4;
    kick *= 4;
  }

  for (let i = 0; i < 3; i += 1) {
    client.kick_origin[i] = crandom() * 0.35;
    client.kick_angles[i] = crandom() * 0.7;
  }

  let lastStart: vec3_t = [...ent.s.origin];
  for (let i = 0; i < shots; i += 1) {
    const vectors = AngleVectors(client.v_angle);
    const r = 7 + crandom() * 4;
    const u = crandom() * 4;
    lastStart = P_ProjectSource(client, ent.s.origin, [0, r, u + ent.viewheight - 8], vectors.forward, vectors.right);
    resolveFireBullet(hooks)(
      ent,
      lastStart,
      vectors.forward,
      damage,
      kick,
      DEFAULT_BULLET_HSPREAD,
      DEFAULT_BULLET_VSPREAD,
      MOD_CHAINGUN,
      runtime
    );
  }

  const muzzleWeapon = (MZ_CHAINGUN1 + shots - 1) | getSilencedMuzzleBits(client);
  queuePlayerMuzzleFlash(ent, muzzleWeapon, runtime, hooks);
  PlayerNoise(ent, lastStart, PNOISE_WEAPON, runtime);

  if ((runtime.dmflags & DF_INFINITE_AMMO) === 0) {
    client.pers.inventory[client.ammo_index] -= shots;
  }
}

/**
 * Original name: Weapon_Chaingun
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Runs the generic state machine for the chaingun.
 */
export function Weapon_Chaingun(ent: GameEntity, runtime: GameRuntime, hooks: GameWeaponHooks = {}): void {
  Weapon_Generic(
    ent,
    runtime,
    hooks,
    4,
    31,
    61,
    64,
    [38, 43, 51, 61, 0],
    [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 0],
    Chaingun_Fire
  );
}

/**
 * Original name: weapon_grenade_fire
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Releases one hand grenade using the held timer to derive throw speed and fuse.
 *
 * Porting notes:
 * - Delegates grenade entity spawn to an explicit hook.
 */
export function weapon_grenade_fire(ent: GameEntity, held: boolean, runtime: GameRuntime, hooks: GameWeaponHooks = {}): void {
  const client = requireClient(ent, "weapon_grenade_fire");
  let damage = 125;
  const radius = damage + 40;

  if (client.quad_framenum > runtime.framenum) {
    damage *= 4;
  }

  const vectors = AngleVectors(client.v_angle);
  const start = P_ProjectSource(client, ent.s.origin, [8, 8, ent.viewheight - 8], vectors.forward, vectors.right);
  const timer = client.grenade_time - runtime.time;
  const speed = GRENADE_MINSPEED + (GRENADE_TIMER - timer) * ((GRENADE_MAXSPEED - GRENADE_MINSPEED) / GRENADE_TIMER);

  resolveFireGrenade2(hooks)(ent, start, vectors.forward, damage, speed, timer, radius, held, runtime);

  if ((runtime.dmflags & DF_INFINITE_AMMO) === 0) {
    client.pers.inventory[client.ammo_index]--;
  }

  client.grenade_time = runtime.time + 1.0;

  if (ent.deadflag !== DEAD_NO || ent.s.modelindex !== 255) {
    return;
  }
  if (ent.health <= 0) {
    return;
  }

  if ((client.ps.pmove.pm_flags & PMF_DUCKED) !== 0) {
    client.anim_priority = ANIM_ATTACK;
    ent.s.frame = FRAME_crattak1 - 1;
    client.anim_end = FRAME_crattak3;
  } else {
    client.anim_priority = ANIM_REVERSE;
    ent.s.frame = FRAME_wave08;
    client.anim_end = FRAME_wave01;
  }
}

/**
 * Original name: Weapon_Grenade
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Drives the hand-grenade state machine including hold-to-cook timing.
 */
export function Weapon_Grenade(ent: GameEntity, runtime: GameRuntime, hooks: GameWeaponHooks = {}): void {
  const client = requireClient(ent, "Weapon_Grenade");

  if (client.newweapon && client.weaponstate === weaponstate_t.WEAPON_READY) {
    ChangeWeapon(ent, runtime, hooks);
    return;
  }

  if (client.weaponstate === weaponstate_t.WEAPON_ACTIVATING) {
    client.weaponstate = weaponstate_t.WEAPON_READY;
    client.ps.gunframe = 16;
    return;
  }

  if (client.weaponstate === weaponstate_t.WEAPON_READY) {
    if (((client.latched_buttons | client.buttons) & BUTTON_ATTACK) !== 0) {
      client.latched_buttons &= ~BUTTON_ATTACK;
      if (client.pers.inventory[client.ammo_index] > 0) {
        client.ps.gunframe = 1;
        client.weaponstate = weaponstate_t.WEAPON_FIRING;
        client.grenade_time = 0;
      } else {
        if (runtime.time >= ent.pain_debounce_time) {
          playWeaponOneShot(ent, "weapons/noammo.wav", CHAN_VOICE, runtime, hooks);
          ent.pain_debounce_time = runtime.time + 1;
        }
        NoAmmoWeaponChange(ent);
      }
      return;
    }

    if ((client.ps.gunframe === 29 || client.ps.gunframe === 34 || client.ps.gunframe === 39 || client.ps.gunframe === 48) && randomPause()) {
      return;
    }

    client.ps.gunframe++;
    if (client.ps.gunframe > 48) {
      client.ps.gunframe = 16;
    }
    return;
  }

  if (client.weaponstate === weaponstate_t.WEAPON_FIRING) {
    if (client.ps.gunframe === 5) {
      playWeaponOneShot(ent, "weapons/hgrena1b.wav", CHAN_WEAPON, runtime, hooks);
    }

    if (client.ps.gunframe === 11) {
      if (!client.grenade_time) {
        client.grenade_time = runtime.time + GRENADE_TIMER + 0.2;
        client.weapon_sound = registerGameSound(runtime, "weapons/hgrenc1b.wav");
      }

      if (!client.grenade_blew_up && runtime.time >= client.grenade_time) {
        client.weapon_sound = 0;
        weapon_grenade_fire(ent, true, runtime, hooks);
        client.grenade_blew_up = true;
      }

      if ((client.buttons & BUTTON_ATTACK) !== 0) {
        return;
      }

      if (client.grenade_blew_up) {
        if (runtime.time >= client.grenade_time) {
          client.ps.gunframe = 15;
          client.grenade_blew_up = false;
        } else {
          return;
        }
      }
    }

    if (client.ps.gunframe === 12) {
      client.weapon_sound = 0;
      weapon_grenade_fire(ent, false, runtime, hooks);
    }

    if (client.ps.gunframe === 15 && runtime.time < client.grenade_time) {
      return;
    }

    client.ps.gunframe++;
    if (client.ps.gunframe === 16) {
      client.grenade_time = 0;
      client.weaponstate = weaponstate_t.WEAPON_READY;
    }
  }
}

/**
 * Original name: weapon_grenadelauncher_fire
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Fires one launched grenade projectile and advances the weapon frame.
 */
export function weapon_grenadelauncher_fire(ent: GameEntity, runtime: GameRuntime, hooks: GameWeaponHooks = {}): void {
  const client = requireClient(ent, "weapon_grenadelauncher_fire");
  let damage = 120;
  const radius = damage + 40;

  if (client.quad_framenum > runtime.framenum) {
    damage *= 4;
  }

  const vectors = AngleVectors(client.v_angle);
  const start = P_ProjectSource(client, ent.s.origin, [8, 8, ent.viewheight - 8], vectors.forward, vectors.right);
  client.kick_origin = [vectors.forward[0] * -2, vectors.forward[1] * -2, vectors.forward[2] * -2];
  client.kick_angles[0] = -1;

  resolveFireGrenade(hooks)(ent, start, vectors.forward, damage, 600, 2.5, radius, runtime);
  queuePlayerMuzzleFlash(ent, MZ_GRENADE | getSilencedMuzzleBits(client), runtime, hooks);

  client.ps.gunframe++;
  PlayerNoise(ent, start, PNOISE_WEAPON, runtime);

  if ((runtime.dmflags & DF_INFINITE_AMMO) === 0) {
    client.pers.inventory[client.ammo_index]--;
  }
}

/**
 * Original name: Weapon_GrenadeLauncher
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Runs the generic state machine for the grenade launcher.
 */
export function Weapon_GrenadeLauncher(ent: GameEntity, runtime: GameRuntime, hooks: GameWeaponHooks = {}): void {
  Weapon_Generic(ent, runtime, hooks, 5, 16, 59, 64, [34, 51, 59, 0], [6, 0], weapon_grenadelauncher_fire);
}

/**
 * Original name: Weapon_RocketLauncher_Fire
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Fires one rocket projectile with the original damage and splash values.
 */
export function Weapon_RocketLauncher_Fire(ent: GameEntity, runtime: GameRuntime, hooks: GameWeaponHooks = {}): void {
  const client = requireClient(ent, "Weapon_RocketLauncher_Fire");
  let damage = 100 + Math.trunc(random() * 20.0);
  let radiusDamage = 120;
  const damageRadius = 120;

  if (client.quad_framenum > runtime.framenum) {
    damage *= 4;
    radiusDamage *= 4;
  }

  const vectors = AngleVectors(client.v_angle);
  client.kick_origin = [vectors.forward[0] * -2, vectors.forward[1] * -2, vectors.forward[2] * -2];
  client.kick_angles[0] = -1;

  const start = P_ProjectSource(client, ent.s.origin, [8, 8, ent.viewheight - 8], vectors.forward, vectors.right);
  resolveFireRocket(hooks)(ent, start, vectors.forward, damage, 650, damageRadius, radiusDamage, runtime);
  queuePlayerMuzzleFlash(ent, MZ_ROCKET | getSilencedMuzzleBits(client), runtime, hooks);

  client.ps.gunframe++;
  PlayerNoise(ent, start, PNOISE_WEAPON, runtime);

  if ((runtime.dmflags & DF_INFINITE_AMMO) === 0) {
    client.pers.inventory[client.ammo_index]--;
  }
}

/**
 * Original name: Weapon_RocketLauncher
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Runs the generic state machine for the rocket launcher.
 */
export function Weapon_RocketLauncher(ent: GameEntity, runtime: GameRuntime, hooks: GameWeaponHooks = {}): void {
  Weapon_Generic(ent, runtime, hooks, 4, 12, 50, 54, [25, 33, 42, 50, 0], [5, 0], Weapon_RocketLauncher_Fire);
}

/**
 * Original name: weapon_railgun_fire
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Fires one railgun shot with original single-player and deathmatch damage values.
 */
export function weapon_railgun_fire(ent: GameEntity, runtime: GameRuntime, hooks: GameWeaponHooks = {}): void {
  const client = requireClient(ent, "weapon_railgun_fire");
  let damage: number;
  let kick: number;

  if (runtime.deathmatch) {
    damage = 100;
    kick = 200;
  } else {
    damage = 150;
    kick = 250;
  }

  if (client.quad_framenum > runtime.framenum) {
    damage *= 4;
    kick *= 4;
  }

  const vectors = AngleVectors(client.v_angle);
  client.kick_origin = [vectors.forward[0] * -3, vectors.forward[1] * -3, vectors.forward[2] * -3];
  client.kick_angles[0] = -3;

  const start = P_ProjectSource(client, ent.s.origin, [0, 7, ent.viewheight - 8], vectors.forward, vectors.right);
  resolveFireRail(hooks)(ent, start, vectors.forward, damage, kick, runtime);
  queuePlayerMuzzleFlash(ent, MZ_RAILGUN | getSilencedMuzzleBits(client), runtime, hooks);

  client.ps.gunframe++;
  PlayerNoise(ent, start, PNOISE_WEAPON, runtime);

  if ((runtime.dmflags & DF_INFINITE_AMMO) === 0) {
    client.pers.inventory[client.ammo_index]--;
  }
}

/**
 * Original name: Weapon_Railgun
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Runs the generic state machine for the railgun.
 */
export function Weapon_Railgun(ent: GameEntity, runtime: GameRuntime, hooks: GameWeaponHooks = {}): void {
  Weapon_Generic(ent, runtime, hooks, 3, 18, 56, 61, [56, 0], [4, 0], weapon_railgun_fire);
}

/**
 * Original name: weapon_bfg_fire
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Handles the BFG windup, muzzleflash lead frame and final projectile launch.
 */
export function weapon_bfg_fire(ent: GameEntity, runtime: GameRuntime, hooks: GameWeaponHooks = {}): void {
  const client = requireClient(ent, "weapon_bfg_fire");
  let damage = runtime.deathmatch ? 200 : 500;
  const damageRadius = 1000;

  if (client.ps.gunframe === 9) {
    queuePlayerMuzzleFlash(ent, MZ_BFG | getSilencedMuzzleBits(client), runtime, hooks);
    client.ps.gunframe++;
    PlayerNoise(ent, ent.s.origin, PNOISE_WEAPON, runtime);
    return;
  }

  if (client.pers.inventory[client.ammo_index] < 50) {
    client.ps.gunframe++;
    return;
  }

  if (client.quad_framenum > runtime.framenum) {
    damage *= 4;
  }

  const vectors = AngleVectors(client.v_angle);
  client.kick_origin = [vectors.forward[0] * -2, vectors.forward[1] * -2, vectors.forward[2] * -2];
  client.v_dmg_pitch = -40;
  client.v_dmg_roll = crandom() * 8;
  client.v_dmg_time = runtime.time + DAMAGE_TIME;

  const start = P_ProjectSource(client, ent.s.origin, [8, 8, ent.viewheight - 8], vectors.forward, vectors.right);
  resolveFireBfg(hooks)(ent, start, vectors.forward, damage, 400, damageRadius, runtime);

  client.ps.gunframe++;
  PlayerNoise(ent, start, PNOISE_WEAPON, runtime);

  if ((runtime.dmflags & DF_INFINITE_AMMO) === 0) {
    client.pers.inventory[client.ammo_index] -= 50;
  }
}

/**
 * Original name: Weapon_BFG
 * Source: game/p_weapon.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Runs the generic state machine for the BFG10K.
 */
export function Weapon_BFG(ent: GameEntity, runtime: GameRuntime, hooks: GameWeaponHooks = {}): void {
  Weapon_Generic(ent, runtime, hooks, 8, 32, 55, 58, [39, 45, 50, 55, 0], [9, 17, 0], weapon_bfg_fire);
}

/**
 * Original name: N/A
 * Source: N/A (local guard helper)
 * Category: New
 * Purpose: Ensure one entity has an attached gameplay client before weapon logic runs.
 */
function requireClient(ent: GameEntity, caller: string): GameClient {
  if (!ent.client) {
    throw new Error(`${caller}: entity #${ent.index} has no client`);
  }
  return ent.client;
}

/**
 * Category: New
 * Purpose: Resolve the BFG fire callback while preserving default `g_weapon.ts` temp-entity and impact hooks.
 *
 * Constraints:
 * - Must keep override hooks authoritative when tests or adapters provide one.
 * - Must pass the full player weapon hook table into the default world-weapon implementation.
 */
function resolveFireBfg(hooks: GameWeaponHooks): NonNullable<GameWeaponHooks["fire_bfg"]> {
  return hooks.fire_bfg ?? ((ent, start, dir, damage, speed, damageRadius, runtime) =>
    fire_bfg(ent, start, dir, damage, speed, damageRadius, runtime, hooks));
}

/**
 * Category: New
 * Purpose: Resolve the blaster fire callback while preserving default projectile touch and temp-entity hooks.
 *
 * Constraints:
 * - Must keep override hooks authoritative when tests or adapters provide one.
 * - Must pass the full player weapon hook table into the default world-weapon implementation.
 */
function resolveFireBlaster(hooks: GameWeaponHooks): NonNullable<GameWeaponHooks["fire_blaster"]> {
  return hooks.fire_blaster ?? ((ent, start, dir, damage, speed, effect, hyper, runtime) =>
    fire_blaster(ent, start, dir, damage, speed, effect, hyper, runtime, hooks));
}

/**
 * Category: New
 * Purpose: Resolve the bullet fire callback while preserving default impact temp-entity hooks.
 *
 * Constraints:
 * - Must keep override hooks authoritative when tests or adapters provide one.
 * - Must pass the full player weapon hook table into the default world-weapon implementation.
 */
function resolveFireBullet(hooks: GameWeaponHooks): NonNullable<GameWeaponHooks["fire_bullet"]> {
  return hooks.fire_bullet ?? ((ent, start, aimdir, damage, kick, hspread, vspread, mod, runtime) =>
    fire_bullet(ent, start, aimdir, damage, kick, hspread, vspread, mod, runtime, hooks));
}

/**
 * Category: New
 * Purpose: Resolve the grenade-launcher fire callback while preserving default projectile hooks.
 *
 * Constraints:
 * - Must keep override hooks authoritative when tests or adapters provide one.
 * - Must pass the full player weapon hook table into the default world-weapon implementation.
 */
function resolveFireGrenade(hooks: GameWeaponHooks): NonNullable<GameWeaponHooks["fire_grenade"]> {
  return hooks.fire_grenade ?? ((ent, start, dir, damage, speed, timer, damageRadius, runtime) =>
    fire_grenade(ent, start, dir, damage, speed, timer, damageRadius, runtime, hooks));
}

/**
 * Category: New
 * Purpose: Resolve the hand-grenade fire callback while preserving default projectile hooks.
 *
 * Constraints:
 * - Must keep override hooks authoritative when tests or adapters provide one.
 * - Must pass the full player weapon hook table into the default world-weapon implementation.
 */
function resolveFireGrenade2(hooks: GameWeaponHooks): NonNullable<GameWeaponHooks["fire_grenade2"]> {
  return hooks.fire_grenade2 ?? ((ent, start, dir, damage, speed, timer, damageRadius, held, runtime) =>
    fire_grenade2(ent, start, dir, damage, speed, timer, damageRadius, held, runtime, hooks));
}

/**
 * Category: New
 * Purpose: Resolve the railgun fire callback while preserving default trail temp-entity hooks.
 *
 * Constraints:
 * - Must keep override hooks authoritative when tests or adapters provide one.
 * - Must pass the full player weapon hook table into the default world-weapon implementation.
 */
function resolveFireRail(hooks: GameWeaponHooks): NonNullable<GameWeaponHooks["fire_rail"]> {
  return hooks.fire_rail ?? ((ent, start, dir, damage, kick, runtime) =>
    fire_rail(ent, start, dir, damage, kick, runtime, hooks));
}

/**
 * Category: New
 * Purpose: Resolve the rocket fire callback while preserving default projectile touch and explosion hooks.
 *
 * Constraints:
 * - Must keep override hooks authoritative when tests or adapters provide one.
 * - Must pass the full player weapon hook table into the default world-weapon implementation.
 */
function resolveFireRocket(hooks: GameWeaponHooks): NonNullable<GameWeaponHooks["fire_rocket"]> {
  return hooks.fire_rocket ?? ((ent, start, dir, damage, speed, damageRadius, radiusDamage, runtime) =>
    fire_rocket(ent, start, dir, damage, speed, damageRadius, radiusDamage, runtime, hooks));
}

/**
 * Category: New
 * Purpose: Resolve the shotgun fire callback while preserving default pellet impact temp-entity hooks.
 *
 * Constraints:
 * - Must keep override hooks authoritative when tests or adapters provide one.
 * - Must pass the full player weapon hook table into the default world-weapon implementation.
 */
function resolveFireShotgun(hooks: GameWeaponHooks): NonNullable<GameWeaponHooks["fire_shotgun"]> {
  return hooks.fire_shotgun ?? ((ent, start, aimdir, damage, kick, hspread, vspread, count, mod, runtime) =>
    fire_shotgun(ent, start, aimdir, damage, kick, hspread, vspread, count, mod, runtime, hooks));
}

/**
 * Original name: N/A
 * Source: N/A (local dispatch helper)
 * Category: New
 * Purpose: Resolve one default player-weapon thinker from the local `p_weapon.c` port when no override hook is supplied.
 */
function getDefaultWeaponThink(
  weaponThinkKind: GameItemWeaponThinkKind
): ((ent: GameEntity, runtime: GameRuntime, hooks: GameWeaponHooks) => void) | null {
  switch (weaponThinkKind) {
    case "Weapon_Blaster":
      return Weapon_Blaster;
    case "Weapon_Shotgun":
      return Weapon_Shotgun;
    case "Weapon_SuperShotgun":
      return Weapon_SuperShotgun;
    case "Weapon_Machinegun":
      return Weapon_Machinegun;
    case "Weapon_Chaingun":
      return Weapon_Chaingun;
    case "Weapon_Grenade":
      return Weapon_Grenade;
    case "Weapon_GrenadeLauncher":
      return Weapon_GrenadeLauncher;
    case "Weapon_RocketLauncher":
      return Weapon_RocketLauncher;
    case "Weapon_HyperBlaster":
      return Weapon_HyperBlaster;
    case "Weapon_Railgun":
      return Weapon_Railgun;
    case "Weapon_BFG":
      return Weapon_BFG;
    default:
      return null;
  }
}

/**
 * Original name: N/A
 * Source: N/A (local item-index adapter)
 * Category: New
 * Purpose: Convert one item reference to the original Quake II item index space.
 */
function ITEM_INDEX(item: GameItemDefinition | null): number {
  return item?.index ?? 0;
}

/**
 * Original name: N/A
 * Source: N/A (local muzzleflash helper)
 * Category: New
 * Purpose: Preserve the original `is_silenced` muzzle-flash bit composition from `p_weapon.c`.
 */
function getSilencedMuzzleBits(client: GameClient): number {
  return client.silencer_shots ? MZ_SILENCED : 0;
}

/**
 * Original name: N/A
 * Source: N/A (local runtime event adapter)
 * Category: New
 * Purpose: Route one player muzzleflash through an override hook or the local runtime event queue.
 */
function queuePlayerMuzzleFlash(ent: GameEntity, weapon: number, runtime: GameRuntime, hooks: GameWeaponHooks): void {
  if (hooks.emitPlayerMuzzleFlash) {
    hooks.emitPlayerMuzzleFlash(ent, weapon, runtime);
    return;
  }
  emitPlayerMuzzleFlash(runtime, ent, weapon);
}

/**
 * Original name: N/A
 * Source: N/A (local runtime sound adapter)
 * Category: New
 * Purpose: Route one explicit one-shot weapon sound through an override hook or the local runtime sound queue.
 */
function playWeaponOneShot(
  ent: GameEntity,
  soundPath: string,
  channel: number,
  runtime: GameRuntime,
  hooks: GameWeaponHooks
): void {
  if (hooks.playWeaponSound) {
    hooks.playWeaponSound(ent, soundPath, channel, runtime);
    return;
  }
  emitGameSound(runtime, ent, soundPath);
}

/**
 * Original name: N/A
 * Source: N/A (local helper entity allocator)
 * Category: New
 * Purpose: Allocate one `player_noise` helper entity with the original fixed bounds and no-client flag.
 */
function createPlayerNoiseEntity(owner: GameEntity, runtime: GameRuntime): GameEntity {
  const noise = spawnGameEntity(runtime);
  noise.classname = "player_noise";
  noise.mins = [-8, -8, -8];
  noise.maxs = [8, 8, 8];
  noise.owner = owner;
  noise.svflags = SVF_NOCLIENT;
  return noise;
}

/**
 * Original name: N/A
 * Source: N/A (local random adapter)
 * Category: Adapter
 * Purpose: Mirror the original `(int)(random() + 0.25)` animation-frame expression through `g_local.random`.
 */
function randomIntFromFloat(): number {
  return Math.trunc(random() + 0.25);
}

/**
 * Original name: N/A
 * Source: N/A (local random helper)
 * Category: New
 * Purpose: Mirror the original `rand() & 15` pause-frame gating used by weapon idle loops.
 */
function randomPause(): boolean {
  return (Math.floor(Math.random() * 0x7fffffff) & 15) !== 0;
}

/**
 * Original name: N/A
 * Source: N/A (local inventory helper)
 * Category: New
 * Purpose: Read one inventory count by original pickup name.
 */
function getInventoryCount(client: GameClient, pickupName: string): number {
  const item = FindItem(pickupName);
  return item ? client.pers.inventory[ITEM_INDEX(item)] : 0;
}

/**
 * Original name: N/A
 * Source: N/A (local inventory helper)
 * Category: New
 * Purpose: Test one original ammo/weapon fallback pair against the current inventory.
 */
function hasInventoryWeapon(client: GameClient, ammoName: string, weaponName: string): boolean {
  return getInventoryCount(client, ammoName) > 0 && getInventoryCount(client, weaponName) > 0;
}

/**
 * Original name: N/A
 * Source: N/A (local runtime message adapter)
 * Category: New
 * Purpose: Route one high-priority weapon message to the current runtime diagnostics stream.
 */
function printWeaponMessage(runtime: GameRuntime, ent: GameEntity, message: string): void {
  runtime.log({
    kind: "message",
    message: `PRINT_${PRINT_HIGH}: ${message}`,
    entityIndex: ent.index,
    entityClassname: ent.classname
  });
}
