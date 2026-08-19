/**
 * File: p_client.ts
 * Source: Quake II original / game/p_client.c
 * Purpose: Port of the first player-client state and frame helpers required by spectator chase control.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Engine import side effects such as broadcast prints, configstrings and multicast effects are exposed through explicit hooks or runtime event queues.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

import {
  BUTTON_ANY,
  BUTTON_ATTACK,
  DF_FORCE_RESPAWN,
  DF_FIXED_FOV,
  DF_SPAWN_FARTHEST,
  DF_QUAD_DROP,
  EF_GIB,
  MASK_DEADSOLID,
  MASK_PLAYERSOLID,
  MZ_LOGIN,
  MZ_LOGOUT,
  PMF_DUCKED,
  PMF_TIME_TELEPORT,
  PMF_JUMP_HELD,
  PMF_NO_PREDICTION,
  SHORT2ANGLE,
  ANGLE2SHORT,
  M_PI,
  PITCH,
  PRINT_HIGH,
  PRINT_MEDIUM,
  Q_stricmp,
  ROLL,
  YAW,
  Pmove,
  createPmoveContext,
  entity_event_t,
  pmtype_t,
  type pmove_t,
  type usercmd_t
} from "../../qcommon/src/index.js";
import { Info_SetValueForKey, Info_Validate, Info_ValueForKey } from "../../qcommon/src/common.js";
import { visible } from "./g_ai.js";
import { ChaseNext, GetChaseTarget, UpdateChaseCam } from "./g_chase.js";
import {
  ANIM_DEATH,
  BODY_QUEUE_SIZE,
  DEAD_DEAD,
  DEAD_NO,
  FL_GODMODE,
  FL_NOTARGET,
  FL_POWER_ARMOR,
  FL_NO_KNOCKBACK,
  GIB_ORGANIC,
  ITEM_INDEX,
  IT_KEY,
  MOD_BARREL,
  MOD_BFG_BLAST,
  MOD_BFG_EFFECT,
  MOD_BFG_LASER,
  MOD_BLASTER,
  MOD_BOMB,
  MOD_CHAINGUN,
  MOD_CRUSH,
  MOD_EXIT,
  MOD_EXPLOSIVE,
  MOD_FALLING,
  MOD_FRIENDLY_FIRE,
  MOD_G_SPLASH,
  MOD_GRENADE,
  MOD_HANDGRENADE,
  MOD_HELD_GRENADE,
  MOD_HG_SPLASH,
  MOD_HIT,
  MOD_HYPERBLASTER,
  MOD_LAVA,
  MOD_MACHINEGUN,
  MOD_R_SPLASH,
  MOD_RAILGUN,
  MOD_ROCKET,
  MOD_SHOTGUN,
  MOD_SLIME,
  MOD_SPLASH,
  MOD_SSHOTGUN,
  MOD_SUICIDE,
  MOD_TARGET_BLASTER,
  MOD_TARGET_LASER,
  MOD_TELEFRAG,
  MOD_TRIGGER_HURT,
  MOD_WATER,
  MOVETYPE_NOCLIP,
  MOVETYPE_BOUNCE,
  MOVETYPE_TOSS,
  MOVETYPE_WALK,
  PNOISE_SELF,
  DROPPED_PLAYER_ITEM,
  FRAMETIME,
  SOLID_BBOX,
  SOLID_NOT,
  SVF_DEADMONSTER,
  SVF_NOCLIENT,
  damage_t,
  crandom,
  random,
  weaponstate_t
} from "./g_local.js";
import {
  FRAME_crdeath1,
  FRAME_crdeath5,
  FRAME_death101,
  FRAME_death106,
  FRAME_death201,
  FRAME_death206,
  FRAME_death301,
  FRAME_death308
} from "./m_player.js";
import { MoveClientToIntermission } from "./p_hud.js";
import { Drop_Item, FindItem, FindItemByClassname, GetItemByIndex, InitItems, Touch_Item } from "./g_items.js";
import { cloneGameClientPersistant, emitGameSound, linkGameEntity, registerGameModel, spawnGameEntity } from "./runtime.js";
import { ChangeWeapon, PlayerNoise, Think_Weapon, type GameWeaponHooks } from "./p_weapon.js";
import { PlayerTrail_Add, PlayerTrail_LastSpot } from "./p_trail.js";
import { touchTriggerEntities } from "./touch.js";
import { G_Find, G_FreeEdict, G_InitEdict, G_Spawn, KillBox } from "./g_utils.js";
import { SP_misc_teleporter_dest, ThrowGib } from "./g_misc.js";
import type { GameClient, GameClientPersistant, GameEntity, GameRuntime } from "./runtime.js";

/**
 * Original name: N/A
 * Source: N/A (local player spawn constants)
 * Category: New
 */
const PLAYER_MINS: [number, number, number] = [-16, -16, -24];
/**
 * Original name: N/A
 * Source: N/A (local player spawn constants)
 * Category: New
 */
const PLAYER_MAXS: [number, number, number] = [16, 16, 32];
/**
 * Original name: N/A
 * Source: N/A (local player spawn constants)
 * Category: New
 */
const PLAYER_VIEWHEIGHT = 22;
/**
 * Original name: N/A
 * Source: N/A (local player spawn constants)
 * Category: New
 */
const PLAYER_MASS = 200;

/**
 * Original name: N/A
 * Source: N/A (runtime hook interface)
 * Category: New
 * Purpose: Hold the still-external callbacks required by the current `p_client.c` state/lifecycle port.
 *
 * Constraints:
 * - Must keep unported engine/game side effects explicit.
 */
export interface GamePlayerClientHooks extends GameWeaponHooks {
  SelectSpawnPoint?: (ent: GameEntity, runtime: GameRuntime) => { origin: [number, number, number]; angles: [number, number, number]; };
  KillBox?: (ent: GameEntity, runtime: GameRuntime) => boolean;
  playerPain?: (self: GameEntity, other: GameEntity | null, kick: number, damage: number, runtime: GameRuntime) => void;
  playerDie?: (self: GameEntity, inflictor: GameEntity | null, attacker: GameEntity | null, damage: number, runtime: GameRuntime) => void;
  onLoginEffect?: (ent: GameEntity, runtime: GameRuntime) => void;
  onConfigstringPlayer?: (playernum: number, value: string, runtime: GameRuntime) => void;
  onDisconnectEffect?: (ent: GameEntity, runtime: GameRuntime) => void;
  onUnlinkEntity?: (ent: GameEntity, runtime: GameRuntime) => void;
  onPrint?: (printLevel: number, message: string, ent: GameEntity | null, runtime: GameRuntime) => void;
  onBodyQueueCopy?: (source: GameEntity, body: GameEntity, runtime: GameRuntime) => void;
  TossClientWeapon?: (self: GameEntity, runtime: GameRuntime) => void;
  onDeathGib?: (self: GameEntity, damage: number, runtime: GameRuntime) => void;
  onDeathSound?: (self: GameEntity, sound: string, runtime: GameRuntime) => void;
  onShowScores?: (ent: GameEntity, runtime: GameRuntime) => void;
  onJump?: (ent: GameEntity, runtime: GameRuntime) => void;
  isIntermission?: (runtime: GameRuntime) => boolean;
  MoveClientToIntermission?: (ent: GameEntity, runtime: GameRuntime) => void;
  onSpectatorRespawnValidation?: (ent: GameEntity, runtime: GameRuntime) => { accepted: boolean; message?: string; spectatorValue?: boolean; };
  validateConnect?: (ent: GameEntity, userinfo: string, runtime: GameRuntime) => { accepted: boolean; reason?: string; };
}

/**
 * Original name: N/A
 * Source: N/A (local coop fixup data)
 * Category: New
 */
const COOP_FIXUP_MAPS = new Set([
  "jail2",
  "jail4",
  "mine1",
  "mine2",
  "mine3",
  "mine4",
  "lab",
  "boss1",
  "fact3",
  "biggun",
  "space",
  "command",
  "power2",
  "strike"
]);

/**
 * Original name: InitClientPersistant
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Reinitializes the persistent client state to the canonical Quake II spawn defaults.
 */
export function InitClientPersistant(client: GameClient): void {
  const pers = client.pers;
  resetPersistantState(pers);

  const item = FindItem("Blaster");
  if (item) {
    pers.selected_item = ITEM_INDEX(item);
    pers.inventory[pers.selected_item] = 1;
    pers.weapon = item;
  }

  pers.health = 100;
  pers.max_health = 100;
  pers.max_bullets = 200;
  pers.max_shells = 100;
  pers.max_rockets = 50;
  pers.max_grenades = 50;
  pers.max_cells = 200;
  pers.max_slugs = 50;
  pers.connected = true;
}

/**
 * Original name: InitClientResp
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Resets the respawn-state block and snapshots the current persistent state for coop restores.
 */
export function InitClientResp(client: GameClient, runtime: GameRuntime): void {
  client.resp.spectator = false;
  client.resp.score = 0;
  client.resp.enterframe = runtime.framenum;
  client.resp.cmd_angles = [0, 0, 0];
  client.resp.coop_respawn = cloneGameClientPersistant(client.pers);
}

/**
 * Original name: SaveClientData
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Mirrors entity-owned player state back into the persistent client blocks before entity teardown/reload paths.
 */
export function SaveClientData(runtime: GameRuntime): void {
  for (let i = 1; i <= runtime.maxclients; i += 1) {
    const ent = runtime.entities[i] ?? null;
    const client = ent?.client;
    if (!ent?.inuse || !client) {
      continue;
    }

    client.pers.health = ent.health;
    client.pers.max_health = ent.max_health;
    client.pers.savedFlags = ent.flags & (FL_GODMODE | FL_NOTARGET | FL_POWER_ARMOR);

    if (runtime.coop) {
      client.pers.score = client.resp.score;
    }
  }
}

/**
 * Original name: FetchClientEntData
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Mirrors persistent health and flag state from one client block back into its gameplay entity.
 */
export function FetchClientEntData(ent: GameEntity, runtime: GameRuntime): void {
  const client = ent.client;
  if (!client) {
    return;
  }

  ent.health = client.pers.health;
  ent.max_health = client.pers.max_health;
  ent.flags |= client.pers.savedFlags;

  if (runtime.coop) {
    client.resp.score = client.pers.score;
  }
}

/**
 * Original name: LookAtKiller
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Computes the yaw the dead player should face toward their killer or inflictor.
 */
export function LookAtKiller(self: GameEntity, inflictor: GameEntity | null, attacker: GameEntity | null): void {
  const client = self.client;
  if (!client) {
    return;
  }

  const dir: [number, number, number] = [0, 0, 0];

  if (attacker && attacker !== self) {
    dir[0] = attacker.s.origin[0] - self.s.origin[0];
    dir[1] = attacker.s.origin[1] - self.s.origin[1];
    dir[2] = attacker.s.origin[2] - self.s.origin[2];
  } else if (inflictor && inflictor !== self) {
    dir[0] = inflictor.s.origin[0] - self.s.origin[0];
    dir[1] = inflictor.s.origin[1] - self.s.origin[1];
    dir[2] = inflictor.s.origin[2] - self.s.origin[2];
  } else {
    client.killer_yaw = self.s.angles[YAW];
    return;
  }

  if (dir[0] !== 0) {
    client.killer_yaw = (180 / M_PI) * Math.atan2(dir[1], dir[0]);
  } else {
    client.killer_yaw = 0;
    if (dir[1] > 0) {
      client.killer_yaw = 90;
    } else if (dir[1] < 0) {
      client.killer_yaw = -90;
    }
  }

  if (client.killer_yaw < 0) {
    client.killer_yaw += 360;
  }
}

/**
 * Original name: IsFemale
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function IsFemale(ent: GameEntity): boolean {
  const info = ent.client ? Info_ValueForKey(ent.client.pers.userinfo, "gender") : "";
  return info[0] === "f" || info[0] === "F";
}

/**
 * Original name: IsNeutral
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function IsNeutral(ent: GameEntity): boolean {
  const info = ent.client ? Info_ValueForKey(ent.client.pers.userinfo, "gender") : "";
  return info[0] !== "f" && info[0] !== "F" && info[0] !== "m" && info[0] !== "M";
}

/**
 * Original name: player_pain
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Intentionally does nothing because player pain feedback is handled later in the frame.
 */
export function player_pain(
  self: GameEntity,
  other: GameEntity | null,
  kick: number,
  damage: number,
  runtime: GameRuntime
): void {
  void self;
  void other;
  void kick;
  void damage;
  void runtime;
}

/**
 * Original name: SP_FixCoopSpots
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Fixes malformed coop spawn targetnames by copying the nearest named single-player start target within the original radius.
 */
export function SP_FixCoopSpots(self: GameEntity, runtime: GameRuntime): void {
  let spot: GameEntity | null = null;

  while (true) {
    spot = G_Find(runtime, spot, "classname", "info_player_start");
    if (!spot) {
      return;
    }
    if (!spot.targetname) {
      continue;
    }

    const dx = self.s.origin[0] - spot.s.origin[0];
    const dy = self.s.origin[1] - spot.s.origin[1];
    const dz = self.s.origin[2] - spot.s.origin[2];
    if (Math.hypot(dx, dy, dz) < 384) {
      if (!self.targetname || !equalsIgnoreCase(self.targetname, spot.targetname)) {
        self.targetname = spot.targetname;
      }
      return;
    }
  }
}

/**
 * Original name: SP_CreateCoopSpots
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Creates the hard-coded coop spawn spots required by the original `security` map workaround.
 */
export function SP_CreateCoopSpots(self: GameEntity, runtime: GameRuntime): void {
  void self;

  if (!equalsIgnoreCase(runtime.mapname, "security")) {
    return;
  }

  spawnCoopSpot([188 - 64, -164, 80], "jail3", 90, runtime);
  spawnCoopSpot([188 + 64, -164, 80], "jail3", 90, runtime);
  spawnCoopSpot([188 + 128, -164, 80], "jail3", 90, runtime);
}

/**
 * Original name: SP_info_player_start
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Close
 */
export function SP_info_player_start(self: GameEntity, runtime: GameRuntime): void {
  if (!runtime.coop) {
    return;
  }

  if (equalsIgnoreCase(runtime.mapname, "security")) {
    self.think = (ent, rt) => SP_CreateCoopSpots(ent, rt);
    self.nextthink = runtime.time + FRAMETIME;
  }
}

/**
 * Original name: SP_info_player_deathmatch
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Close
 */
export function SP_info_player_deathmatch(self: GameEntity, runtime: GameRuntime): void {
  if (!runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  SP_misc_teleporter_dest(self, runtime);
}

/**
 * Original name: SP_info_player_coop
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Close
 */
export function SP_info_player_coop(self: GameEntity, runtime: GameRuntime): void {
  if (!runtime.coop) {
    G_FreeEdict(runtime, self);
    return;
  }

  if (COOP_FIXUP_MAPS.has(runtime.mapname.toLowerCase())) {
    self.think = (ent, rt) => SP_FixCoopSpots(ent, rt);
    self.nextthink = runtime.time + FRAMETIME;
  }
}

/**
 * Original name: SP_info_player_intermission
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function SP_info_player_intermission(self: GameEntity, runtime: GameRuntime): void {
  void self;
  void runtime;
}

/**
 * Original name: ClientObituary
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Resolves the original Quake II death message and score side effects from `meansOfDeath`.
 *
 * Porting notes:
 * - Uses `runtime.meansOfDeath` instead of the original module global.
 */
export function ClientObituary(
  self: GameEntity,
  inflictor: GameEntity | null,
  attacker: GameEntity | null,
  runtime: GameRuntime,
  hooks: GamePlayerClientHooks = {}
): void {
  const client = self.client;
  if (!client) {
    return;
  }

  let meansOfDeath = runtime.meansOfDeath;
  if (runtime.coop && attacker?.client) {
    meansOfDeath |= MOD_FRIENDLY_FIRE;
  }

  if (runtime.deathmatch || runtime.coop) {
    const ff = (meansOfDeath & MOD_FRIENDLY_FIRE) !== 0;
    const mod = meansOfDeath & ~MOD_FRIENDLY_FIRE;
    let message: string | null = null;
    let message2 = "";

    switch (mod) {
      case MOD_SUICIDE:
        message = "suicides";
        break;
      case MOD_FALLING:
        message = "cratered";
        break;
      case MOD_CRUSH:
        message = "was squished";
        break;
      case MOD_WATER:
        message = "sank like a rock";
        break;
      case MOD_SLIME:
        message = "melted";
        break;
      case MOD_LAVA:
        message = "does a back flip into the lava";
        break;
      case MOD_EXPLOSIVE:
      case MOD_BARREL:
        message = "blew up";
        break;
      case MOD_EXIT:
        message = "found a way out";
        break;
      case MOD_TARGET_LASER:
        message = "saw the light";
        break;
      case MOD_TARGET_BLASTER:
        message = "got blasted";
        break;
      case MOD_BOMB:
      case MOD_SPLASH:
      case MOD_TRIGGER_HURT:
        message = "was in the wrong place";
        break;
      default:
        break;
    }

    if (attacker === self) {
      switch (mod) {
        case MOD_HELD_GRENADE:
          message = "tried to put the pin back in";
          break;
        case MOD_HG_SPLASH:
        case MOD_G_SPLASH:
          if (IsNeutral(self)) {
            message = "tripped on its own grenade";
          } else if (IsFemale(self)) {
            message = "tripped on her own grenade";
          } else {
            message = "tripped on his own grenade";
          }
          break;
        case MOD_R_SPLASH:
          if (IsNeutral(self)) {
            message = "blew itself up";
          } else if (IsFemale(self)) {
            message = "blew herself up";
          } else {
            message = "blew himself up";
          }
          break;
        case MOD_BFG_BLAST:
          message = "should have used a smaller gun";
          break;
        default:
          if (IsNeutral(self)) {
            message = "killed itself";
          } else if (IsFemale(self)) {
            message = "killed herself";
          } else {
            message = "killed himself";
          }
          break;
      }
    }

    if (message) {
      hooks.onPrint?.(PRINT_MEDIUM, `${client.pers.netname} ${message}.\n`, null, runtime);
      if (runtime.deathmatch) {
        client.resp.score -= 1;
      }
      self.enemy = null;
      return;
    }

    self.enemy = attacker;
    if (attacker?.client) {
      switch (mod) {
        case MOD_BLASTER:
          message = "was blasted by";
          break;
        case MOD_SHOTGUN:
          message = "was gunned down by";
          break;
        case MOD_SSHOTGUN:
          message = "was blown away by";
          message2 = "'s super shotgun";
          break;
        case MOD_MACHINEGUN:
          message = "was machinegunned by";
          break;
        case MOD_CHAINGUN:
          message = "was cut in half by";
          message2 = "'s chaingun";
          break;
        case MOD_GRENADE:
          message = "was popped by";
          message2 = "'s grenade";
          break;
        case MOD_G_SPLASH:
          message = "was shredded by";
          message2 = "'s shrapnel";
          break;
        case MOD_ROCKET:
          message = "ate";
          message2 = "'s rocket";
          break;
        case MOD_R_SPLASH:
          message = "almost dodged";
          message2 = "'s rocket";
          break;
        case MOD_HYPERBLASTER:
          message = "was melted by";
          message2 = "'s hyperblaster";
          break;
        case MOD_RAILGUN:
          message = "was railed by";
          break;
        case MOD_BFG_LASER:
          message = "saw the pretty lights from";
          message2 = "'s BFG";
          break;
        case MOD_BFG_BLAST:
          message = "was disintegrated by";
          message2 = "'s BFG blast";
          break;
        case MOD_BFG_EFFECT:
          message = "couldn't hide from";
          message2 = "'s BFG";
          break;
        case MOD_HANDGRENADE:
          message = "caught";
          message2 = "'s handgrenade";
          break;
        case MOD_HG_SPLASH:
          message = "didn't see";
          message2 = "'s handgrenade";
          break;
        case MOD_HELD_GRENADE:
          message = "feels";
          message2 = "'s pain";
          break;
        case MOD_TELEFRAG:
          message = "tried to invade";
          message2 = "'s personal space";
          break;
        default:
          break;
      }

      if (message) {
        hooks.onPrint?.(
          PRINT_MEDIUM,
          `${client.pers.netname} ${message} ${attacker.client.pers.netname}${message2}\n`,
          null,
          runtime
        );
        if (runtime.deathmatch) {
          attacker.client.resp.score += ff ? -1 : 1;
        }
        return;
      }
    }
  }

  hooks.onPrint?.(PRINT_MEDIUM, `${client.pers.netname} died.\n`, null, runtime);
  if (runtime.deathmatch) {
    client.resp.score -= 1;
  }
}

/**
 * Original name: SelectSpawnPoint
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Chooses a spawn point using the currently available subset of Quake II player spawns.
 *
 * Porting notes:
 * - Currently falls back to the first `info_player_start`, then `info_player_deathmatch`, then world origin.
 */
export function SelectSpawnPoint(ent: GameEntity, runtime: GameRuntime): { origin: [number, number, number]; angles: [number, number, number]; } {
  let spot: GameEntity | null = null;

  if (runtime.deathmatch) {
    spot = SelectDeathmatchSpawnPoint(runtime);
  } else if (runtime.coop) {
    spot = SelectCoopSpawnPoint(ent, runtime);
  }

  if (!spot) {
    while ((spot = G_Find(runtime, spot, "classname", "info_player_start")) !== null) {
      if (!runtime.spawnpoint && !spot.targetname) {
        break;
      }

      if (!runtime.spawnpoint || !spot.targetname) {
        continue;
      }

      if (equalsIgnoreCase(runtime.spawnpoint, spot.targetname)) {
        break;
      }
    }

    if (!spot && !runtime.spawnpoint) {
      spot = G_Find(runtime, null, "classname", "info_player_start");
    }
  }

  if (!spot) {
    spot = G_Find(runtime, null, "classname", "info_player_deathmatch");
  }

  if (!spot) {
    return {
      origin: [0, 0, 9],
      angles: [0, 0, 0]
    };
  }

  return {
    origin: [spot.s.origin[0], spot.s.origin[1], spot.s.origin[2] + 9],
    angles: [...spot.s.angles]
  };
}

/**
 * Original name: PlayersRangeFromSpot
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the distance from one spawn spot to the nearest living player.
 */
export function PlayersRangeFromSpot(spot: GameEntity, runtime: GameRuntime): number {
  let bestPlayerDistance = 9_999_999;

  for (let i = 1; i <= runtime.maxclients; i += 1) {
    const player = runtime.entities[i] ?? null;
    if (!player?.inuse || player.health <= 0) {
      continue;
    }

    const dx = spot.s.origin[0] - player.s.origin[0];
    const dy = spot.s.origin[1] - player.s.origin[1];
    const dz = spot.s.origin[2] - player.s.origin[2];
    const playerDistance = Math.hypot(dx, dy, dz);
    if (playerDistance < bestPlayerDistance) {
      bestPlayerDistance = playerDistance;
    }
  }

  return bestPlayerDistance;
}

/**
 * Original name: SelectRandomDeathmatchSpawnPoint
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Chooses a random deathmatch spawn while excluding the two spots nearest to other players when possible.
 */
export function SelectRandomDeathmatchSpawnPoint(runtime: GameRuntime): GameEntity | null {
  let spot: GameEntity | null = null;
  let spot1: GameEntity | null = null;
  let spot2: GameEntity | null = null;
  let count = 0;
  let range1 = 99_999;
  let range2 = 99_999;

  while ((spot = G_Find(runtime, spot, "classname", "info_player_deathmatch")) !== null) {
    count += 1;
    const range = PlayersRangeFromSpot(spot, runtime);
    if (range < range1) {
      range1 = range;
      spot1 = spot;
    } else if (range < range2) {
      range2 = range;
      spot2 = spot;
    }
  }

  if (!count) {
    return null;
  }

  if (count <= 2) {
    spot1 = null;
    spot2 = null;
  } else {
    count -= 2;
  }

  let selection = Math.trunc(Math.random() * count);
  spot = null;
  do {
    spot = G_Find(runtime, spot, "classname", "info_player_deathmatch");
    if (spot === spot1 || spot === spot2) {
      selection += 1;
    }
  } while (selection-- && spot);

  return spot;
}

/**
 * Original name: SelectFarthestDeathmatchSpawnPoint
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Chooses the deathmatch spawn farthest from the nearest living player.
 */
export function SelectFarthestDeathmatchSpawnPoint(runtime: GameRuntime): GameEntity | null {
  let spot: GameEntity | null = null;
  let bestSpot: GameEntity | null = null;
  let bestDistance = 0;

  while ((spot = G_Find(runtime, spot, "classname", "info_player_deathmatch")) !== null) {
    const bestPlayerDistance = PlayersRangeFromSpot(spot, runtime);
    if (bestPlayerDistance > bestDistance) {
      bestSpot = spot;
      bestDistance = bestPlayerDistance;
    }
  }

  if (bestSpot) {
    return bestSpot;
  }

  return G_Find(runtime, null, "classname", "info_player_deathmatch");
}

/**
 * Original name: SelectDeathmatchSpawnPoint
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function SelectDeathmatchSpawnPoint(runtime: GameRuntime): GameEntity | null {
  if ((runtime.dmflags & DF_SPAWN_FARTHEST) !== 0) {
    return SelectFarthestDeathmatchSpawnPoint(runtime);
  }
  return SelectRandomDeathmatchSpawnPoint(runtime);
}

/**
 * Original name: SelectCoopSpawnPoint
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Finds the coop slot corresponding to the current client index and active spawnpoint targetname.
 */
export function SelectCoopSpawnPoint(ent: GameEntity, runtime: GameRuntime): GameEntity | null {
  let index = ent.index - 1;
  if (!index) {
    return null;
  }

  let spot: GameEntity | null = null;
  while (true) {
    spot = G_Find(runtime, spot, "classname", "info_player_coop");
    if (!spot) {
      return null;
    }

    const target = spot.targetname ?? "";
    if (equalsIgnoreCase(runtime.spawnpoint, target)) {
      index -= 1;
      if (!index) {
        return spot;
      }
    }
  }
}

/**
 * Original name: PutClientInServer
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Reinitializes one player entity at a spawn point using the Quake II player defaults.
 *
 * Porting notes:
 * - Uses explicit hooks only for overridable policy/engine side effects; core spawn behavior is locally wired.
 */
export function PutClientInServer(
  ent: GameEntity,
  runtime: GameRuntime,
  hooks: GamePlayerClientHooks = {}
): void {
  const client = ent.client;
  if (!client) {
    return;
  }

  const spawn = hooks.SelectSpawnPoint?.(ent, runtime) ?? SelectSpawnPoint(ent, runtime);

  const saved = cloneGameClientPersistant(client.pers);
  const resp = {
    spectator: client.resp.spectator,
    score: client.resp.score,
    enterframe: client.resp.enterframe,
    cmd_angles: [...client.resp.cmd_angles] as [number, number, number],
    coop_respawn: cloneGameClientPersistant(client.resp.coop_respawn)
  };

  resetClientTransientState(client);
  client.pers = saved;
  if (client.pers.health <= 0) {
    InitClientPersistant(client);
  }
  client.resp = resp;

  FetchClientEntData(ent, runtime);

  ent.groundentity = null;
  ent.takedamage = damage_t.DAMAGE_AIM;
  ent.movetype = MOVETYPE_WALK;
  ent.viewheight = PLAYER_VIEWHEIGHT;
  ent.inuse = true;
  ent.classname = "player";
  ent.mass = PLAYER_MASS;
  ent.solid = SOLID_BBOX;
  ent.deadflag = DEAD_NO;
  ent.air_finished = runtime.time + 12;
  ent.clipmask = MASK_PLAYERSOLID;
  ent.model = "players/male/tris.md2";
  ent.pain = hooks.playerPain
    ? ((self, other, kick, damage, rt) => hooks.playerPain?.(self, other, kick, damage, rt))
    : ((self, other, kick, damage, rt) => player_pain(self, other, kick, damage, rt));
  ent.die = (self, inflictor, attacker, damage, rt) => {
    if (hooks.playerDie) {
      hooks.playerDie(self, inflictor, attacker, damage, rt);
      return;
    }
    player_die(self, inflictor, attacker, damage, rt, hooks);
  };
  ent.waterlevel = 0;
  ent.watertype = 0;
  ent.flags &= ~FL_NO_KNOCKBACK;
  ent.svflags &= ~SVF_DEADMONSTER;
  ent.mins = [...PLAYER_MINS];
  ent.maxs = [...PLAYER_MAXS];
  ent.velocity = [0, 0, 0];

  client.ps = {
    ...client.ps,
    pmove: {
      pm_type: pmtype_t.PM_NORMAL,
      origin: [
        Math.trunc(spawn.origin[0] * 8),
        Math.trunc(spawn.origin[1] * 8),
        Math.trunc(spawn.origin[2] * 8)
      ],
      velocity: [0, 0, 0],
      pm_flags: 0,
      pm_time: 0,
      gravity: client.ps.pmove.gravity,
      delta_angles: [0, 0, 0]
    },
    viewangles: [0, 0, 0],
    viewoffset: [0, 0, 0],
    kick_angles: [0, 0, 0],
    gunangles: [0, 0, 0],
    gunoffset: [0, 0, 0],
    gunindex: 0,
    gunframe: 0,
    blend: [0, 0, 0, 0],
    fov: clampFov(readUserinfoNumber(client.pers.userinfo, "fov", 90), runtime),
    rdflags: 0,
    stats: new Array<number>(client.ps.stats.length).fill(0)
  };

  if (client.pers.weapon?.viewModel) {
    client.ps.gunindex = registerGameModel(runtime, client.pers.weapon.viewModel);
  }

  ent.s.effects = 0;
  ent.s.modelindex = 255;
  ent.s.modelindex2 = 255;
  ent.s.skinnum = Math.max(0, ent.index - 1);
  ent.s.frame = 0;
  ent.s.origin = [...spawn.origin];
  ent.s.origin[2] += 1;
  ent.s.old_origin = [...ent.s.origin];
  ent.origin = [...ent.s.origin];

  for (let i = 0; i < 3; i += 1) {
    client.ps.pmove.delta_angles[i] = ANGLE2SHORT(spawn.angles[i] - client.resp.cmd_angles[i]);
  }

  ent.s.angles[PITCH] = 0;
  ent.s.angles[YAW] = spawn.angles[YAW];
  ent.s.angles[ROLL] = 0;
  ent.angles = [...ent.s.angles];
  client.ps.viewangles = [...ent.s.angles];
  client.v_angle = [...ent.s.angles];

  if (client.pers.spectator) {
    client.chase_target = null;
    client.resp.spectator = true;
    ent.movetype = MOVETYPE_NOCLIP;
    ent.solid = SOLID_NOT;
    ent.svflags |= SVF_NOCLIENT;
    client.ps.gunindex = 0;
    linkGameEntity(runtime, ent);
    return;
  }

  client.resp.spectator = false;

  (hooks.KillBox ?? ((target, localRuntime) => KillBox(localRuntime, target)))(ent, runtime);
  linkGameEntity(runtime, ent);

  client.newweapon = client.pers.weapon;
  ChangeWeapon(ent, runtime, hooks);
}

/**
 * Original name: InitBodyQue
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Preallocates the body queue entities used by deathmatch and coop respawns.
 */
export function InitBodyQue(runtime: GameRuntime): void {
  runtime.body_que = 0;
  for (let i = 0; i < BODY_QUEUE_SIZE; i += 1) {
    const ent = spawnGameEntity(runtime);
    ent.classname = "bodyque";
  }
}

/**
 * Original name: body_die
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Handles gibbing for queued player corpses after respawn.
 */
export function body_die(
  self: GameEntity,
  inflictor: GameEntity | null,
  attacker: GameEntity | null,
  damage: number,
  runtime: GameRuntime
): void {
  void inflictor;
  void attacker;

  if (self.health < -40) {
    emitGameSound(runtime, self, "misc/udeath.wav");
    for (let index = 0; index < 4; index += 1) {
      ThrowGib(self, "models/objects/gibs/sm_meat/tris.md2", damage, GIB_ORGANIC, runtime);
    }
    self.s.origin[2] -= 48;
    ThrowClientHead(self, damage, runtime);
    self.takedamage = damage_t.DAMAGE_NO;
  }
}

/**
 * Original name: N/A
 * Source: N/A (local death animation state)
 * Category: New
 */
let deathAnimationIndex = 0;

/**
 * Original name: TossClientWeapon
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Drops the player's current weapon and optionally an expiring quad damage pickup on deathmatch death.
 *
 * Porting notes:
 * - Uses the ported `Drop_Item` path by default while preserving hook injection for tests/adapters.
 */
export function TossClientWeapon(self: GameEntity, runtime: GameRuntime, hooks: GamePlayerClientHooks = {}): void {
  const client = self.client;
  if (!client || !runtime.deathmatch) {
    return;
  }

  let item = client.pers.weapon;
  if (!client.pers.inventory[client.ammo_index]) {
    item = null;
  }
  if (item?.pickupName === "Blaster") {
    item = null;
  }

  const quad = (runtime.dmflags & DF_QUAD_DROP) !== 0 && client.quad_framenum > (runtime.framenum + 10);
  const spread = item && quad ? 22.5 : 0.0;

  if (item) {
    client.v_angle[YAW] -= spread;
    const drop = (hooks.Drop_Item ?? Drop_Item)(self, item, runtime);
    client.v_angle[YAW] += spread;
    if (drop) {
      drop.spawnflags = DROPPED_PLAYER_ITEM;
    }
  }

  if (quad) {
    const quadItem = FindItemByClassname("item_quad");
    if (!quadItem) {
      return;
    }

    client.v_angle[YAW] += spread;
    const drop = (hooks.Drop_Item ?? Drop_Item)(self, quadItem, runtime);
    client.v_angle[YAW] -= spread;

    if (!drop) {
      return;
    }

    drop.spawnflags |= DROPPED_PLAYER_ITEM;
    drop.touch = Touch_Item;
    drop.nextthink = runtime.time + (client.quad_framenum - runtime.framenum) * FRAMETIME;
    drop.think = (ent, rt) => G_FreeEdict(rt, ent);
  }
}

/**
 * Original name: player_die
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies the core player death transition, obituary, inventory clearing and death animation selection.
 *
 * Porting notes:
 * - Broadcast/UI side effects remain overridable through hooks; gameplay drops, sounds and gib spawning have local defaults.
 */
export function player_die(
  self: GameEntity,
  inflictor: GameEntity | null,
  attacker: GameEntity | null,
  damage: number,
  runtime: GameRuntime,
  hooks: GamePlayerClientHooks = {}
): void {
  const client = self.client;
  if (!client) {
    return;
  }

  self.avelocity = [0, 0, 0];
  self.takedamage = damage_t.DAMAGE_YES;
  self.movetype = MOVETYPE_TOSS;
  self.s.modelindex2 = 0;
  self.s.angles[PITCH] = 0;
  self.s.angles[ROLL] = 0;
  self.s.sound = 0;
  client.weapon_sound = 0;
  self.maxs[2] = -8;
  self.svflags |= SVF_DEADMONSTER;

  if (!self.deadflag) {
    client.respawn_time = runtime.time + 1.0;
    LookAtKiller(self, inflictor, attacker);
    client.ps.pmove.pm_type = pmtype_t.PM_DEAD;
    ClientObituary(self, inflictor, attacker, runtime, hooks);
    if (hooks.TossClientWeapon) {
      hooks.TossClientWeapon(self, runtime);
    } else {
      TossClientWeapon(self, runtime, hooks);
    }

    if (runtime.deathmatch) {
      client.showscores = true;
      hooks.onShowScores?.(self, runtime);
    }

    for (let itemIndex = 1; itemIndex <= InitItems(); itemIndex += 1) {
      const item = GetItemByIndex(itemIndex);
      if (runtime.coop && item && (item.flags & IT_KEY) !== 0) {
        client.resp.coop_respawn.inventory[itemIndex] = client.pers.inventory[itemIndex];
      }
      client.pers.inventory[itemIndex] = 0;
    }
  }

  client.quad_framenum = 0;
  client.invincible_framenum = 0;
  client.breather_framenum = 0;
  client.enviro_framenum = 0;
  self.flags &= ~FL_POWER_ARMOR;

  if (self.health < -40) {
    emitDeathSound(self, "misc/udeath.wav", runtime, hooks);
    if (hooks.onDeathGib) {
      hooks.onDeathGib(self, damage, runtime);
    } else {
      throwPlayerGibs(self, damage, runtime);
    }
    self.takedamage = damage_t.DAMAGE_NO;
  } else if (!self.deadflag) {
    deathAnimationIndex = (deathAnimationIndex + 1) % 3;
    client.anim_priority = ANIM_DEATH;

    if ((client.ps.pmove.pm_flags & PMF_DUCKED) !== 0) {
      self.s.frame = FRAME_crdeath1 - 1;
      client.anim_end = FRAME_crdeath5;
    } else if (deathAnimationIndex === 0) {
      self.s.frame = FRAME_death101 - 1;
      client.anim_end = FRAME_death106;
    } else if (deathAnimationIndex === 1) {
      self.s.frame = FRAME_death201 - 1;
      client.anim_end = FRAME_death206;
    } else {
      self.s.frame = FRAME_death301 - 1;
      client.anim_end = FRAME_death308;
    }

    emitDeathSound(self, `*death${Math.trunc(Math.random() * 4) + 1}.wav`, runtime, hooks);
  }

  self.deadflag = DEAD_DEAD;
  linkGameEntity(runtime, self);
}

/**
 * Original name: ThrowClientHead
 * Source: Quake-2-master/game/g_misc.c
 * Category: Adapter
 * Fidelity level: Close
 *
 * Behavior:
 * - Converts the player or queued body entity into the flying client head/skull gib.
 */
export function ThrowClientHead(self: GameEntity, damage: number, runtime: GameRuntime): void {
  const usePlayerHead = (Math.trunc(Math.random() * 0x7fffffff) & 1) !== 0;
  const gibname = usePlayerHead
    ? "models/objects/gibs/head2/tris.md2"
    : "models/objects/gibs/skull/tris.md2";

  self.s.skinnum = usePlayerHead ? 1 : 0;
  self.s.origin[2] += 32;
  self.origin = [...self.s.origin];
  self.s.frame = 0;
  self.model = gibname;
  self.s.modelindex = registerGameModel(runtime, gibname);
  self.mins = [-16, -16, 0];
  self.maxs = [16, 16, 16];
  self.takedamage = damage_t.DAMAGE_NO;
  self.solid = SOLID_NOT;
  self.s.effects = EF_GIB;
  self.s.sound = 0;
  self.flags |= FL_NO_KNOCKBACK;
  self.movetype = MOVETYPE_BOUNCE;
  self.velocity = addVec3(self.velocity, velocityForDamage(damage));

  if (self.client) {
    self.client.anim_priority = ANIM_DEATH;
    self.client.anim_end = self.s.frame;
  } else {
    self.think = undefined;
    self.nextthink = 0;
  }

  linkGameEntity(runtime, self);
}

/**
 * Original name: CopyToBodyQue
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Copies one player entity into the rotating body queue used by respawn logic.
 */
export function CopyToBodyQue(ent: GameEntity, runtime: GameRuntime, hooks: GamePlayerClientHooks = {}): void {
  const bodyIndex = runtime.maxclients + runtime.body_que + 1;
  const body = runtime.entities[bodyIndex] ?? null;
  runtime.body_que = (runtime.body_que + 1) % BODY_QUEUE_SIZE;

  if (!body) {
    return;
  }

  body.inuse = true;
  body.classname = "bodyque";
  body.s = {
    ...ent.s,
    number: body.index,
    origin: [...ent.s.origin],
    angles: [...ent.s.angles],
    old_origin: [...ent.s.old_origin]
  };
  body.svflags = ent.svflags;
  body.origin = [...ent.s.origin];
  body.angles = [...ent.s.angles];
  body.mins = [...ent.mins];
  body.maxs = [...ent.maxs];
  body.absmin = [...ent.absmin];
  body.absmax = [...ent.absmax];
  body.size = [...ent.size];
  body.solid = ent.solid;
  body.clipmask = ent.clipmask;
  body.owner = ent.owner;
  body.movetype = ent.movetype;
  body.die = (self, inflictor, attacker, damage, rt) => body_die(self, inflictor, attacker, damage, rt);
  body.takedamage = damage_t.DAMAGE_YES;

  linkGameEntity(runtime, body);
  hooks.onBodyQueueCopy?.(ent, body, runtime);
}

/**
 * Original name: respawn
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Respawns one player in deathmatch/coop and applies the short teleport freeze.
 */
export function respawn(ent: GameEntity, runtime: GameRuntime, hooks: GamePlayerClientHooks = {}): void {
  const client = ent.client;
  if (!client) {
    return;
  }

  if (runtime.deathmatch || runtime.coop) {
    if (ent.movetype !== MOVETYPE_NOCLIP) {
      CopyToBodyQue(ent, runtime, hooks);
    }

    ent.svflags &= ~SVF_NOCLIENT;
    PutClientInServer(ent, runtime, hooks);
    ent.s.event = entity_event_t.EV_PLAYER_TELEPORT;
    client.ps.pmove.pm_flags = PMF_TIME_TELEPORT;
    client.ps.pmove.pm_time = 14;
    client.respawn_time = runtime.time;
  }
}

/**
 * Original name: spectator_respawn
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies the spectator-side respawn path when the player's spectator mode toggles.
 *
 * Porting notes:
 * - Passwords and server spectator-limit policies are delegated to one validation hook; the `g_main.c`
 *   export adapter supplies the default original policy for server frames.
 */
export function spectator_respawn(ent: GameEntity, runtime: GameRuntime, hooks: GamePlayerClientHooks = {}): void {
  const client = ent.client;
  if (!client) {
    return;
  }

  const validation = hooks.onSpectatorRespawnValidation?.(ent, runtime);
  if (validation && !validation.accepted) {
    if (typeof validation.spectatorValue === "boolean") {
      client.pers.spectator = validation.spectatorValue;
    }
    if (validation.message) {
      hooks.onPrint?.(PRINT_HIGH, validation.message, ent, runtime);
    }
    return;
  }

  client.pers.score = 0;
  client.resp.score = 0;

  ent.svflags &= ~SVF_NOCLIENT;
  PutClientInServer(ent, runtime, hooks);

  if (!client.pers.spectator) {
    hooks.onLoginEffect?.(ent, runtime);
    client.ps.pmove.pm_flags = PMF_TIME_TELEPORT;
    client.ps.pmove.pm_time = 14;
  }

  client.respawn_time = runtime.time;

  if (client.pers.spectator) {
    hooks.onPrint?.(PRINT_HIGH, `${client.pers.netname} has moved to the sidelines\n`, null, runtime);
  } else {
    hooks.onPrint?.(PRINT_HIGH, `${client.pers.netname} joined the game\n`, null, runtime);
  }
}

/**
 * Original name: ClientUserinfoChanged
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies name, spectator, skin, fov and handedness updates from one Quake II userinfo string.
 */
export function ClientUserinfoChanged(
  ent: GameEntity,
  userinfo: string,
  runtime: GameRuntime,
  hooks: GamePlayerClientHooks = {}
): string {
  const client = ent.client;
  if (!client) {
    return userinfo;
  }

  let normalizedUserinfo = userinfo;
  if (!Info_Validate(normalizedUserinfo)) {
    normalizedUserinfo = "\\name\\badinfo\\skin\\male/grunt";
  }

  const name = Info_ValueForKey(normalizedUserinfo, "name");
  client.pers.netname = name;

  const spectatorValue = Info_ValueForKey(normalizedUserinfo, "spectator");
  client.pers.spectator = runtime.deathmatch && spectatorValue.length > 0 && spectatorValue !== "0";

  const skin = Info_ValueForKey(normalizedUserinfo, "skin");
  const playernum = Math.max(0, ent.index - 1);
  hooks.onConfigstringPlayer?.(playernum, `${client.pers.netname}\\${skin}`, runtime);

  client.ps.fov = clampFov(readUserinfoNumber(normalizedUserinfo, "fov", 90), runtime);

  const hand = Info_ValueForKey(normalizedUserinfo, "hand");
  if (hand.length > 0) {
    client.pers.hand = readUserinfoNumber(normalizedUserinfo, "hand", 0);
  }

  client.pers.userinfo = normalizedUserinfo;
  return normalizedUserinfo;
}

/**
 * Original name: ClientConnect
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes the client slot on connect and applies the first valid userinfo payload.
 *
 * Porting notes:
 * - External policy checks such as passwords, bans and spectator limits are delegated to hooks; the `g_main.c`
 *   export adapter supplies the default original policy for runtime connects.
 */
export function ClientConnect(
  ent: GameEntity,
  userinfo: string,
  runtime: GameRuntime,
  hooks: GamePlayerClientHooks = {}
): boolean {
  const client = ent.client;
  if (!client) {
    return false;
  }

  const validation = hooks.validateConnect?.(ent, userinfo, runtime);
  if (validation && !validation.accepted) {
    void validation.reason;
    return false;
  }

  if (!ent.inuse) {
    InitClientResp(client, runtime);
    if (!runtime.autosaved || !client.pers.weapon) {
      InitClientPersistant(client);
    }
  }

  const normalizedUserinfo = ClientUserinfoChanged(ent, userinfo, runtime, hooks);

  if (runtime.maxclients > 1) {
    hooks.onPrint?.(PRINT_HIGH, `${client.pers.netname} connected\n`, null, runtime);
  }

  client.pers.connected = true;
  client.pers.userinfo = normalizedUserinfo;
  return true;
}

/**
 * Original name: ClientDisconnect
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Broadcasts the disconnect, unlinks the entity, clears its server-visible state and clears the public skin slot.
 *
 * Porting notes:
 * - Engine writes/multicast and unlinking are surfaced through hooks so the `g_main.c` export can attach `gi`.
 */
export function ClientDisconnect(
  ent: GameEntity,
  runtime: GameRuntime,
  hooks: GamePlayerClientHooks = {}
): void {
  const client = ent.client;
  if (!client) {
    return;
  }

  hooks.onPrint?.(PRINT_HIGH, `${client.pers.netname} disconnected\n`, null, runtime);
  hooks.onDisconnectEffect?.(ent, runtime);
  hooks.onUnlinkEntity?.(ent, runtime);

  ent.s.modelindex = 0;
  ent.solid = SOLID_NOT;
  ent.inuse = false;
  ent.classname = "disconnected";
  client.pers.connected = false;

  const playernum = Math.max(0, ent.index - 1);
  hooks.onConfigstringPlayer?.(playernum, "", runtime);
  void MZ_LOGOUT;
}

/**
 * Original name: ClientBeginDeathmatch
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Reinitializes one client slot for a fresh deathmatch entry, emits the login effect and finalizes the first frame state.
 */
export function ClientBeginDeathmatch(
  ent: GameEntity,
  runtime: GameRuntime,
  hooks: GamePlayerClientHooks = {}
): void {
  const client = ent.client;
  if (!client) {
    return;
  }

  G_InitEdict(ent);
  ent.client = client;

  InitClientResp(client, runtime);
  PutClientInServer(ent, runtime, hooks);

  hooks.onLoginEffect?.(ent, runtime);
  hooks.onPrint?.(PRINT_HIGH, `${client.pers.netname} entered the game\n`, null, runtime);

  ClientBeginServerFrame(ent, runtime, hooks);
}

/**
 * Original name: ClientBegin
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Places one connected client into the current level, preserving loadgame state when the entity is already active.
 *
 * Porting notes:
 * - Defaults to the local `MoveClientToIntermission` port, while still allowing explicit override hooks.
 */
export function ClientBegin(
  ent: GameEntity,
  runtime: GameRuntime,
  hooks: GamePlayerClientHooks = {}
): void {
  const client = ent.client;
  if (!client) {
    return;
  }

  if (runtime.deathmatch) {
    ClientBeginDeathmatch(ent, runtime, hooks);
    return;
  }

  if (ent.inuse) {
    for (let i = 0; i < 3; i += 1) {
      client.ps.pmove.delta_angles[i] = ANGLE2SHORT(client.ps.viewangles[i]);
    }
  } else {
    G_InitEdict(ent);
    ent.client = client;
    ent.classname = "player";
    InitClientResp(client, runtime);
    PutClientInServer(ent, runtime, hooks);
  }

  if (hooks.isIntermission?.(runtime)) {
    (hooks.MoveClientToIntermission ?? MoveClientToIntermission)(ent, runtime);
  } else if (runtime.maxclients > 1) {
    hooks.onLoginEffect?.(ent, runtime);
    hooks.onPrint?.(PRINT_HIGH, `${client.pers.netname} entered the game\n`, null, runtime);
  }

  ClientBeginServerFrame(ent, runtime, hooks);
}

/**
 * Original name: ClientThink
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Processes the per-command player move, chase mode, weapon firing and follower updates.
 *
 * Porting notes:
 * - Runs the authoritative `Pmove` path when `runtime.collision` is available; local prediction callers may pre-sync movement before the post-move logic.
 */
export function ClientThink(
  ent: GameEntity,
  ucmd: usercmd_t,
  runtime: GameRuntime,
  hooks: GamePlayerClientHooks = {}
): void {
  const client = ent.client;
  if (!client) {
    return;
  }

  runtime.current_entity = ent;

  if (runtime.intermissiontime) {
    client.ps.pmove.pm_type = pmtype_t.PM_FREEZE;
    if (runtime.time > runtime.intermissiontime + 5.0 && (ucmd.buttons & BUTTON_ANY) !== 0) {
      runtime.exitintermission = 1;
    }
    return;
  }

  if (client.chase_target) {
    client.resp.cmd_angles[0] = SHORT2ANGLE(ucmd.angles[0]);
    client.resp.cmd_angles[1] = SHORT2ANGLE(ucmd.angles[1]);
    client.resp.cmd_angles[2] = SHORT2ANGLE(ucmd.angles[2]);
  } else if (runtime.collision) {
    const pm = buildClientPmove(ent, ucmd, runtime);
    const hadGroundentity = ent.groundentity;

    Pmove(createPmoveContext(pm));

    client.ps.pmove = clonePmoveState(pm.s);
    client.old_pmove = clonePmoveState(pm.s);

    for (let i = 0; i < 3; i += 1) {
      ent.s.origin[i] = pm.s.origin[i] * 0.125;
      ent.velocity[i] = pm.s.velocity[i] * 0.125;
    }
    ent.origin = [...ent.s.origin];

    ent.mins = [...pm.mins];
    ent.maxs = [...pm.maxs];

    client.resp.cmd_angles[0] = SHORT2ANGLE(ucmd.angles[0]);
    client.resp.cmd_angles[1] = SHORT2ANGLE(ucmd.angles[1]);
    client.resp.cmd_angles[2] = SHORT2ANGLE(ucmd.angles[2]);

    if (hadGroundentity && !pm.groundentity && pm.cmd.upmove >= 10 && pm.waterlevel === 0) {
      if (hooks.onJump) {
        hooks.onJump(ent, runtime);
      } else {
        emitGameSound(runtime, ent, "*jump1.wav");
        PlayerNoise(ent, ent.s.origin, PNOISE_SELF, runtime);
      }
    }

    ent.viewheight = pm.viewheight;
    ent.waterlevel = pm.waterlevel;
    ent.watertype = pm.watertype;
    ent.groundentity = (pm.groundentity as GameEntity | null) ?? null;
    if (ent.groundentity) {
      ent.groundentity_linkcount = ent.groundentity.linkcount;
    }

    if (ent.deadflag) {
      client.ps.viewangles[ROLL] = 40;
      client.ps.viewangles[PITCH] = -15;
      client.ps.viewangles[YAW] = client.killer_yaw;
    } else {
      client.v_angle = [...pm.viewangles];
      client.ps.viewangles = [...pm.viewangles];
    }

    linkGameEntity(runtime, ent);

    if (ent.movetype !== MOVETYPE_NOCLIP) {
      touchTriggerEntities(runtime, ent);
    }

    touchPmoveEntities(pm, ent, runtime);
  }

  client.oldbuttons = client.buttons;
  client.buttons = ucmd.buttons;
  client.latched_buttons |= client.buttons & ~client.oldbuttons;

  ent.light_level = ucmd.lightlevel;

  if ((client.latched_buttons & BUTTON_ATTACK) !== 0) {
    if (client.resp.spectator) {
      client.latched_buttons = 0;

      if (client.chase_target) {
        client.chase_target = null;
        client.ps.pmove.pm_flags &= ~PMF_NO_PREDICTION;
      } else {
        GetChaseTarget(ent, runtime);
      }
    } else if (!client.weapon_thunk) {
      client.weapon_thunk = true;
      Think_Weapon(ent, runtime, hooks);
    }
  }

  if (client.resp.spectator) {
    if (ucmd.upmove >= 10) {
      if ((client.ps.pmove.pm_flags & PMF_JUMP_HELD) === 0) {
        client.ps.pmove.pm_flags |= PMF_JUMP_HELD;
        if (client.chase_target) {
          ChaseNext(ent, runtime);
        } else {
          GetChaseTarget(ent, runtime);
        }
      }
    } else {
      client.ps.pmove.pm_flags &= ~PMF_JUMP_HELD;
    }
  }

  UpdateChaseFollowers(ent, runtime);
}

/**
 * Original name: ClientBeginServerFrame
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Runs the first server-frame-side player upkeep already needed by the current gameplay runtime.
 *
 * Porting notes:
 * - Mirrors the source intermission early-out, spectator transition, weapon thunk, respawn and player-trail paths.
 */
export function ClientBeginServerFrame(
  ent: GameEntity,
  runtime: GameRuntime,
  hooks: GamePlayerClientHooks = {}
): void {
  const client = ent.client;
  if (!client) {
    return;
  }

  if (runtime.intermissiontime) {
    return;
  }

  if (runtime.deathmatch && client.pers.spectator !== client.resp.spectator && (runtime.time - client.respawn_time) >= 5) {
    spectator_respawn(ent, runtime, hooks);
    return;
  }

  if (!client.weapon_thunk && !client.resp.spectator) {
    Think_Weapon(ent, runtime, hooks);
  } else {
    client.weapon_thunk = false;
  }

  if (ent.deadflag) {
    if (runtime.time > client.respawn_time) {
      const buttonMask = runtime.deathmatch ? BUTTON_ATTACK : -1;
      if ((client.latched_buttons & buttonMask) !== 0 || (runtime.deathmatch && (runtime.dmflags & DF_FORCE_RESPAWN) !== 0)) {
        respawn(ent, runtime, hooks);
        client.latched_buttons = 0;
      }
    }
    return;
  }

  if (!runtime.deathmatch) {
    const lastSpot = PlayerTrail_LastSpot(runtime);
    if (lastSpot && !visible(ent, lastSpot, runtime)) {
      PlayerTrail_Add(runtime, [...ent.s.old_origin]);
    }
  }

  client.latched_buttons = 0;
}

/**
 * Original name: UpdateChaseCam call loop in ClientThink
 * Source: Quake-2-master/game/p_client.c
 * Category: Adapter
 * Fidelity level: Strict
 *
 * Behavior:
 * - Refreshes all spectator chase cameras currently following one target entity.
 */
export function UpdateChaseFollowers(ent: GameEntity, runtime: GameRuntime): void {
  for (let i = 1; i <= runtime.maxclients; i += 1) {
    const other = runtime.entities[i] ?? null;
    if (other?.inuse && other.client?.chase_target === ent) {
      UpdateChaseCam(other, runtime);
    }
  }
}

/**
 * Original name: N/A
 * Source: N/A (local persistent-state helper)
 * Category: New
 */
function resetPersistantState(pers: GameClientPersistant): void {
  pers.userinfo = "";
  pers.netname = "";
  pers.hand = 0;
  pers.connected = false;
  pers.health = 0;
  pers.max_health = 0;
  pers.savedFlags = 0;
  pers.inventory.fill(0);
  pers.weapon = null;
  pers.lastweapon = null;
  pers.selected_item = -1;
  pers.max_bullets = 0;
  pers.max_shells = 0;
  pers.max_rockets = 0;
  pers.max_grenades = 0;
  pers.max_cells = 0;
  pers.max_slugs = 0;
  pers.power_cubes = 0;
  pers.score = 0;
  pers.game_helpchanged = 0;
  pers.helpchanged = 0;
  pers.spectator = false;
}

/**
 * Original name: N/A
 * Source: N/A (local sound hook helper)
 * Category: New
 */
function emitDeathSound(
  self: GameEntity,
  soundPath: string,
  runtime: GameRuntime,
  hooks: GamePlayerClientHooks
): void {
  if (hooks.onDeathSound) {
    hooks.onDeathSound(self, soundPath, runtime);
    return;
  }

  emitGameSound(runtime, self, soundPath);
}

/**
 * Original name: N/A
 * Source: N/A (local player gib helper)
 * Category: New
 */
function throwPlayerGibs(self: GameEntity, damage: number, runtime: GameRuntime): void {
  for (let index = 0; index < 4; index += 1) {
    ThrowGib(self, "models/objects/gibs/sm_meat/tris.md2", damage, GIB_ORGANIC, runtime);
  }
  ThrowClientHead(self, damage, runtime);
}

/**
 * Original name: VelocityForDamage
 * Source: Quake-2-master/game/g_misc.c
 * Category: Adapter
 * Fidelity level: Strict
 *
 * Behavior:
 * - Builds the randomized client-head launch velocity and scales it by the source damage threshold.
 *
 * Porting notes:
 * - Duplicated locally because `ThrowClientHead` remains in the `p_client.ts` player lifecycle path.
 */
function velocityForDamage(damage: number): [number, number, number] {
  const velocity: [number, number, number] = [
    100 * crandom(),
    100 * crandom(),
    200 + (100 * random())
  ];
  const scale = damage < 50 ? 0.7 : 1.2;
  return [velocity[0] * scale, velocity[1] * scale, velocity[2] * scale];
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 */
function addVec3(left: [number, number, number], right: [number, number, number]): [number, number, number] {
  return [
    left[0] + right[0],
    left[1] + right[1],
    left[2] + right[2]
  ];
}

/**
 * Original name: N/A
 * Source: N/A (local client reset helper)
 * Category: New
 */
function resetClientTransientState(client: GameClient): void {
  const preservedPers = client.pers;
  const preservedResp = client.resp;
  const reset = {
    ...client,
    showscores: false,
    showinventory: false,
    showhelp: false,
    showhelpicon: false,
    kick_angles: [0, 0, 0] as [number, number, number],
    kick_origin: [0, 0, 0] as [number, number, number],
    v_angle: [0, 0, 0] as [number, number, number],
    v_dmg_roll: 0,
    v_dmg_pitch: 0,
    v_dmg_time: 0,
    ammo_index: 0,
    buttons: 0,
    oldbuttons: 0,
    latched_buttons: 0,
    weapon_thunk: false,
    newweapon: null,
    weaponstate: weaponstate_t.WEAPON_READY,
    killer_yaw: 0,
    machinegun_shots: 0,
    fall_time: 0,
    fall_value: 0,
    damage_alpha: 0,
    bonus_alpha: 0,
    damage_blend: [0, 0, 0] as [number, number, number],
    bobtime: 0,
    oldviewangles: [0, 0, 0] as [number, number, number],
    oldvelocity: [0, 0, 0] as [number, number, number],
    next_drown_time: 0,
    old_waterlevel: 0,
    breather_sound: 0,
    anim_end: 0,
    anim_priority: 0,
    anim_duck: false,
    anim_run: false,
    grenade_blew_up: false,
    grenade_time: 0,
    silencer_shots: 0,
    breather_framenum: 0,
    enviro_framenum: 0,
    invincible_framenum: 0,
    damage_parmor: 0,
    damage_armor: 0,
    damage_blood: 0,
    damage_knockback: 0,
    damage_from: [0, 0, 0] as [number, number, number],
    weapon_sound: 0,
    quad_framenum: 0,
    pickup_msg_time: 0,
    flood_locktill: 0,
    flood_when: new Array<number>(client.flood_when.length).fill(0),
    flood_whenhead: 0,
    respawn_time: 0,
    chase_target: null,
    update_chase: false
  };

  Object.assign(client, reset);
  client.pers = preservedPers;
  client.resp = preservedResp;
}

/**
 * Original name: N/A
 * Source: N/A (local userinfo helper)
 * Category: New
 */
function clampFov(fov: number, runtime: GameRuntime): number {
  if (runtime.deathmatch && (runtime.dmflags & DF_FIXED_FOV) !== 0) {
    return 90;
  }
  if (fov < 1) {
    return 90;
  }
  if (fov > 160) {
    return 160;
  }
  return fov;
}

/**
 * Original name: N/A
 * Source: N/A (local pmove bridge helper)
 * Category: New
 */
function buildClientPmove(ent: GameEntity, ucmd: usercmd_t, runtime: GameRuntime): pmove_t {
  const client = ent.client!;

  if (ent.movetype === MOVETYPE_NOCLIP) {
    client.ps.pmove.pm_type = pmtype_t.PM_SPECTATOR;
  } else if (ent.s.modelindex !== 255) {
    client.ps.pmove.pm_type = pmtype_t.PM_GIB;
  } else if (ent.deadflag) {
    client.ps.pmove.pm_type = pmtype_t.PM_DEAD;
  } else {
    client.ps.pmove.pm_type = pmtype_t.PM_NORMAL;
  }

  client.ps.pmove.gravity = runtime.gravity;

  const pmState = clonePmoveState(client.ps.pmove);
  for (let i = 0; i < 3; i += 1) {
    pmState.origin[i] = Math.trunc(ent.s.origin[i] * 8);
    pmState.velocity[i] = Math.trunc(ent.velocity[i] * 8);
  }

  return {
    s: pmState,
    cmd: {
      ...ucmd,
      angles: [...ucmd.angles]
    },
    snapinitial: !samePmoveState(client.old_pmove, pmState),
    numtouch: 0,
    touchents: [],
    viewangles: [0, 0, 0],
    viewheight: 0,
    mins: [0, 0, 0],
    maxs: [0, 0, 0],
    groundentity: null,
    watertype: 0,
    waterlevel: 0,
    trace: (start, mins, maxs, end) => PM_trace(start, mins, maxs, end, ent, runtime),
    pointcontents: (point) => PMpointcontents(point, ent, runtime)
  };
}

/**
 * Original name: PM_trace
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Wraps gameplay collision for `pmove`, selecting `MASK_PLAYERSOLID` or `MASK_DEADSOLID` from the player's health state.
 */
export function PM_trace(
  start: [number, number, number],
  mins: [number, number, number],
  maxs: [number, number, number],
  end: [number, number, number],
  passent: GameEntity,
  runtime: GameRuntime
) {
  const mask = passent.health > 0 ? MASK_PLAYERSOLID : MASK_DEADSOLID;
  return runtime.collision!.trace(start, mins, maxs, end, passent, mask);
}

/**
 * Original name: N/A
 * Source: N/A (local pmove callback)
 * Category: New
 * Purpose: Keep the `pmove` point-contents callback explicit beside `PM_trace`.
 */
export function PMpointcontents(
  point: [number, number, number],
  passent: GameEntity,
  runtime: GameRuntime
): number {
  return runtime.collision!.pointcontents(point, passent);
}

/**
 * Original name: CheckBlock
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Produces the same byte-sum checksum used by the original temporary `PrintPmove` debug helper.
 */
export function CheckBlock(bytes: ArrayLike<number>, count: number = bytes.length): number {
  let value = 0;
  const limit = Math.min(count, bytes.length);
  for (let i = 0; i < limit; i += 1) {
    value += bytes[i] ?? 0;
  }
  return value >>> 0;
}

/**
 * Original name: PrintPmove
 * Source: Quake-2-master/game/p_client.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Formats the original temporary pmove checksum line for diagnostics.
 */
export function PrintPmove(pm: pmove_t): string {
  const stateBytes = encodePackedPmoveState(pm.s);
  const cmdBytes = encodePackedUsercmd(pm.cmd);
  const c1 = CheckBlock(stateBytes);
  const c2 = CheckBlock(cmdBytes);
  return `sv ${pm.cmd.impulse.toString().padStart(3, " ")}:${c1} ${c2}\n`;
}

/**
 * Original name: N/A
 * Source: N/A (local pmove touch helper)
 * Category: New
 */
function touchPmoveEntities(pm: pmove_t, ent: GameEntity, runtime: GameRuntime): void {
  for (let i = 0; i < pm.numtouch; i += 1) {
    const other = (pm.touchents[i] as GameEntity | null) ?? null;
    if (!other) {
      continue;
    }

    let duplicated = false;
    for (let j = 0; j < i; j += 1) {
      if (pm.touchents[j] === other) {
        duplicated = true;
        break;
      }
    }

    if (duplicated || !other.touch) {
      continue;
    }

    other.touch(other, ent, runtime);
  }
}

/**
 * Original name: N/A
 * Source: N/A (local pmove serialization helper)
 * Category: New
 */
function clonePmoveState(state: GameClient["ps"]["pmove"]): GameClient["ps"]["pmove"] {
  return {
    pm_type: state.pm_type,
    origin: [...state.origin],
    velocity: [...state.velocity],
    pm_flags: state.pm_flags,
    pm_time: state.pm_time,
    gravity: state.gravity,
    delta_angles: [...state.delta_angles]
  };
}

/**
 * Original name: N/A
 * Source: N/A (local pmove serialization helper)
 * Category: New
 */
function samePmoveState(left: GameClient["old_pmove"], right: GameClient["old_pmove"]): boolean {
  return (
    left.pm_type === right.pm_type &&
    left.pm_flags === right.pm_flags &&
    left.pm_time === right.pm_time &&
    left.gravity === right.gravity &&
    left.origin[0] === right.origin[0] &&
    left.origin[1] === right.origin[1] &&
    left.origin[2] === right.origin[2] &&
    left.velocity[0] === right.velocity[0] &&
    left.velocity[1] === right.velocity[1] &&
    left.velocity[2] === right.velocity[2] &&
    left.delta_angles[0] === right.delta_angles[0] &&
    left.delta_angles[1] === right.delta_angles[1] &&
    left.delta_angles[2] === right.delta_angles[2]
  );
}

/**
 * Original name: N/A
 * Source: N/A (local pmove debug helper)
 * Category: New
 */
function encodePackedPmoveState(state: GameClient["ps"]["pmove"]): number[] {
  return [
    state.pm_type & 0xff,
    ...encodeShort(state.origin[0]),
    ...encodeShort(state.origin[1]),
    ...encodeShort(state.origin[2]),
    ...encodeShort(state.velocity[0]),
    ...encodeShort(state.velocity[1]),
    ...encodeShort(state.velocity[2]),
    state.pm_flags & 0xff,
    state.pm_time & 0xff,
    ...encodeShort(state.gravity),
    ...encodeShort(state.delta_angles[0]),
    ...encodeShort(state.delta_angles[1]),
    ...encodeShort(state.delta_angles[2])
  ];
}

/**
 * Original name: N/A
 * Source: N/A (local pmove debug helper)
 * Category: New
 */
function encodePackedUsercmd(cmd: usercmd_t): number[] {
  return [
    ...encodeShort(cmd.msec),
    ...encodeShort(cmd.buttons),
    ...encodeShort(cmd.angles[0]),
    ...encodeShort(cmd.angles[1]),
    ...encodeShort(cmd.angles[2]),
    ...encodeShort(cmd.forwardmove),
    ...encodeShort(cmd.sidemove),
    ...encodeShort(cmd.upmove),
    cmd.impulse & 0xff,
    cmd.lightlevel & 0xff
  ];
}

/**
 * Original name: N/A
 * Source: N/A (local binary encoding helper)
 * Category: New
 */
function encodeShort(value: number): [number, number] {
  const normalized = value & 0xffff;
  return [normalized & 0xff, (normalized >> 8) & 0xff];
}

/**
 * Original name: N/A
 * Source: N/A (local coop spawn helper)
 * Category: New
 */
function spawnCoopSpot(
  origin: [number, number, number],
  targetname: string,
  yaw: number,
  runtime: GameRuntime
): void {
  const spot = G_Spawn(runtime);
  spot.classname = "info_player_coop";
  spot.s.origin = [...origin];
  spot.origin = [...origin];
  spot.targetname = targetname;
  spot.s.angles[YAW] = yaw;
  spot.angles[YAW] = yaw;
}

/**
 * Original name: N/A
 * Source: N/A (local userinfo helper)
 * Category: New
 */
function readUserinfoNumber(userinfo: string, key: string, fallback: number): number {
  const value = Info_ValueForKey(userinfo, key);
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Original name: N/A
 * Source: N/A (local string helper)
 * Category: New
 */
function equalsIgnoreCase(left: string, right: string): boolean {
  return Q_stricmp(left, right) === 0;
}
