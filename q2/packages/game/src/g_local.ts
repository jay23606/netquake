/**
 * File: g_local.ts
 * Source: Quake II original / game/g_local.h
 * Purpose: Port of the mixed gameplay header declarations shared across the Quake II game module.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Pointer offsets and address macros are modeled as field-name helpers instead of raw numeric offsets.
 * - Mutable globals are modeled as explicit runtime-owned structures and constructors.
 *
 * Notes:
 * - This file serves as the principal attachment point for `game/g_local.h`.
 */

import { MAX_ITEMS, type cvar_t, type qboolean, type vec3_t } from "../../qcommon/src/index.js";
import type { GameItemArmorInfo, GameItemDefinition } from "./g_items.js";
import type { edict_t, gclient_t, game_export_t, game_import_t } from "./game.js";
import {
  ANIM_ATTACK,
  ANIM_BASIC,
  ANIM_DEATH,
  ANIM_JUMP,
  ANIM_PAIN,
  ANIM_REVERSE,
  ANIM_WAVE,
  CENTER_HANDED,
  DAMAGE_BULLET,
  DAMAGE_ENERGY,
  DAMAGE_NO_ARMOR,
  DAMAGE_NO_KNOCKBACK,
  DAMAGE_NO_PROTECTION,
  DAMAGE_RADIUS,
  DAMAGE_TIME,
  DEAD_DEAD,
  DEAD_DYING,
  DEAD_NO,
  DEAD_RESPAWNABLE,
  DEFAULT_BULLET_HSPREAD,
  DEFAULT_BULLET_VSPREAD,
  DEFAULT_DEATHMATCH_SHOTGUN_COUNT,
  DEFAULT_SHOTGUN_COUNT,
  DEFAULT_SHOTGUN_HSPREAD,
  DEFAULT_SHOTGUN_VSPREAD,
  DEFAULT_SSHOTGUN_COUNT,
  DROPPED_ITEM,
  DROPPED_PLAYER_ITEM,
  FL_GODMODE,
  FL_IMMUNE_LASER,
  FL_NO_KNOCKBACK,
  FL_NOTARGET,
  FL_POWER_ARMOR,
  FL_RESPAWN,
  FL_TEAMSLAVE,
  FRAMETIME,
  LEFT_HANDED,
  MOD_BFG_BLAST,
  MOD_BFG_EFFECT,
  MOD_BFG_LASER,
  MOD_BLASTER,
  MOD_CHAINGUN,
  MOD_FRIENDLY_FIRE,
  MOD_G_SPLASH,
  MOD_GRENADE,
  MOD_HANDGRENADE,
  MOD_HELD_GRENADE,
  MOD_HG_SPLASH,
  MOD_HIT,
  MOD_HYPERBLASTER,
  MOD_MACHINEGUN,
  MOD_R_SPLASH,
  MOD_RAILGUN,
  MOD_ROCKET,
  MOD_SHOTGUN,
  MOD_SSHOTGUN,
  POWER_ARMOR_NONE,
  POWER_ARMOR_SCREEN,
  POWER_ARMOR_SHIELD,
  RIGHT_HANDED,
  SOLID_BBOX,
  SOLID_BSP,
  SOLID_NOT,
  SOLID_TRIGGER,
  SVF_DEADMONSTER,
  SVF_MONSTER,
  SVF_NOCLIENT,
  WEAP_BFG,
  WEAP_BLASTER,
  WEAP_CHAINGUN,
  WEAP_GRENADELAUNCHER,
  WEAP_GRENADES,
  WEAP_HYPERBLASTER,
  WEAP_MACHINEGUN,
  WEAP_RAILGUN,
  WEAP_ROCKETLAUNCHER,
  WEAP_SHOTGUN,
  WEAP_SUPERSHOTGUN,
  ammo_t,
  createGameClient,
  createGameClientPersistant,
  createGameClientRespawn,
  createMonsterInfo,
  type GameClient,
  type GameClientPersistant,
  type GameClientRespawn,
  type GameEntity,
  type GameMoveInfo,
  type GameMonsterFrame,
  type GameMonsterInfo,
  type GameMonsterMove,
  weaponstate_t
} from "./runtime.js";

export const GAMEVERSION = "baseq2";
export const svc_muzzleflash = 1;
export const svc_muzzleflash2 = 2;
export const svc_temp_entity = 3;
export const svc_layout = 4;
export const svc_inventory = 5;
export const svc_stufftext = 11;
export const FALL_TIME = 0.3;
export const SPAWNFLAG_NOT_EASY = 0x00000100;
export const SPAWNFLAG_NOT_MEDIUM = 0x00000200;
export const SPAWNFLAG_NOT_HARD = 0x00000400;
export const SPAWNFLAG_NOT_DEATHMATCH = 0x00000800;
export const SPAWNFLAG_NOT_COOP = 0x00001000;
export const FL_FLY = 0x00000001;
export const FL_SWIM = 0x00000002;
export const FL_INWATER = 0x00000008;
export const FL_IMMUNE_SLIME = 0x00000040;
export const FL_IMMUNE_LAVA = 0x00000080;
export const FL_PARTIALGROUND = 0x00000100; // not all corners are valid
export const FL_WATERJUMP = 0x00000200; // player jumping out of water
export const TAG_GAME = 765;
export const TAG_LEVEL = 766;
export const MELEE_DISTANCE = 80;
export const BODY_QUEUE_SIZE = 8;
export const RANGE_MELEE = 0;
export const RANGE_NEAR = 1;
export const RANGE_MID = 2;
export const RANGE_FAR = 3;
export const GIB_ORGANIC = 0;
export const GIB_METALLIC = 1;
export const AI_STAND_GROUND = 0x00000001;
export const AI_TEMP_STAND_GROUND = 0x00000002;
export const AI_SOUND_TARGET = 0x00000004;
export const AI_LOST_SIGHT = 0x00000008;
export const AI_PURSUIT_LAST_SEEN = 0x00000010;
export const AI_PURSUE_NEXT = 0x00000020;
export const AI_PURSUE_TEMP = 0x00000040;
export const AI_HOLD_FRAME = 0x00000080;
export const AI_GOOD_GUY = 0x00000100;
export const AI_BRUTAL = 0x00000200;
export const AI_NOSTEP = 0x00000400;
export const AI_DUCKED = 0x00000800;
export const AI_COMBAT_POINT = 0x00001000;
export const AI_MEDIC = 0x00002000;
export const AI_RESURRECTING = 0x00004000;
export const AS_STRAIGHT = 1;
export const AS_SLIDING = 2;
export const AS_MELEE = 3;
export const AS_MISSILE = 4;
export const ARMOR_NONE = 0;
export const ARMOR_JACKET = 1;
export const ARMOR_COMBAT = 2;
export const ARMOR_BODY = 3;
export const ARMOR_SHARD = 4;
export const SFL_CROSS_TRIGGER_1 = 0x00000001;
export const SFL_CROSS_TRIGGER_2 = 0x00000002;
export const SFL_CROSS_TRIGGER_3 = 0x00000004;
export const SFL_CROSS_TRIGGER_4 = 0x00000008;
export const SFL_CROSS_TRIGGER_5 = 0x00000010;
export const SFL_CROSS_TRIGGER_6 = 0x00000020;
export const SFL_CROSS_TRIGGER_7 = 0x00000040;
export const SFL_CROSS_TRIGGER_8 = 0x00000080;
export const SFL_CROSS_TRIGGER_MASK = 0x000000ff;
export const PNOISE_SELF = 0;
export const PNOISE_WEAPON = 1;
export const PNOISE_IMPACT = 2;
export const IT_WEAPON = 1;
export const IT_AMMO = 2;
export const IT_ARMOR = 4;
export const IT_STAY_COOP = 8;
export const IT_KEY = 16;
export const IT_POWERUP = 32;
export const ITEM_TRIGGER_SPAWN = 0x00000001;
export const ITEM_NO_TOUCH = 0x00000002;
export const ITEM_TARGETS_USED = 0x00040000;
export const FFL_SPAWNTEMP = 1;
export const FFL_NOSPAWN = 2;
export const MOD_UNKNOWN = 0;
export const MOD_WATER = 17;
export const MOD_SLIME = 18;
export const MOD_LAVA = 19;
export const MOD_CRUSH = 20;
export const MOD_TELEFRAG = 21;
export const MOD_FALLING = 22;
export const MOD_SUICIDE = 23;
export const MOD_EXPLOSIVE = 25;
export const MOD_BARREL = 26;
export const MOD_BOMB = 27;
export const MOD_EXIT = 28;
export const MOD_SPLASH = 29;
export const MOD_TARGET_LASER = 30;
export const MOD_TRIGGER_HURT = 31;
export const MOD_TARGET_BLASTER = 33;

/**
 * Original name: VEC_UP
 * Source: Quake-2-master/game/g_utils.c
 * Category: Adapter
 * Fidelity level: Strict
 *
 * Behavior:
 * - Re-exposes the original `G_SetMovedir` upward-angle sentinel from the `g_local` public attachment point.
 *
 * Porting notes:
 * - The owning port used by `G_SetMovedir` remains the local mirror in `packages/game/src/g_utils.ts`.
 */
export const VEC_UP: vec3_t = [0, -1, 0];

/**
 * Original name: MOVEDIR_UP
 * Source: Quake-2-master/game/g_utils.c
 * Category: Adapter
 * Fidelity level: Strict
 *
 * Behavior:
 * - Re-exposes the original upward movement direction paired with `VEC_UP`.
 *
 * Porting notes:
 * - The owning port used by `G_SetMovedir` remains the local mirror in `packages/game/src/g_utils.ts`.
 */
export const MOVEDIR_UP: vec3_t = [0, 0, 1];

/**
 * Original name: VEC_DOWN
 * Source: Quake-2-master/game/g_utils.c
 * Category: Adapter
 * Fidelity level: Strict
 *
 * Behavior:
 * - Re-exposes the original `G_SetMovedir` downward-angle sentinel from the `g_local` public attachment point.
 *
 * Porting notes:
 * - The owning port used by `G_SetMovedir` remains the local mirror in `packages/game/src/g_utils.ts`.
 */
export const VEC_DOWN: vec3_t = [0, -2, 0];

/**
 * Original name: MOVEDIR_DOWN
 * Source: Quake-2-master/game/g_utils.c
 * Category: Adapter
 * Fidelity level: Strict
 *
 * Behavior:
 * - Re-exposes the original downward movement direction paired with `VEC_DOWN`.
 *
 * Porting notes:
 * - The owning port used by `G_SetMovedir` remains the local mirror in `packages/game/src/g_utils.ts`.
 */
export const MOVEDIR_DOWN: vec3_t = [0, 0, -1];

/**
 * Original name: damage_t
 * Source: Quake-2-master/game/g_local.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines the canonical gameplay damageability enum used by entities.
 */
export enum damage_t {
  DAMAGE_NO,
  DAMAGE_YES,
  DAMAGE_AIM
}

/**
 * Original name: movetype_t
 * Source: Quake-2-master/game/g_local.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Preserves the canonical gameplay movement-type enum values.
 */
export enum movetype_t {
  MOVETYPE_NONE = 0,
  MOVETYPE_NOCLIP = 1,
  MOVETYPE_PUSH = 2,
  MOVETYPE_STOP = 3,
  MOVETYPE_WALK = 4,
  MOVETYPE_STEP = 5,
  MOVETYPE_FLY = 6,
  MOVETYPE_TOSS = 7,
  MOVETYPE_FLYMISSILE = 8,
  MOVETYPE_BOUNCE = 9
}

export const MOVETYPE_NONE = movetype_t.MOVETYPE_NONE;
export const MOVETYPE_NOCLIP = movetype_t.MOVETYPE_NOCLIP;
export const MOVETYPE_PUSH = movetype_t.MOVETYPE_PUSH;
export const MOVETYPE_STOP = movetype_t.MOVETYPE_STOP;
export const MOVETYPE_WALK = movetype_t.MOVETYPE_WALK;
export const MOVETYPE_STEP = movetype_t.MOVETYPE_STEP;
export const MOVETYPE_FLY = movetype_t.MOVETYPE_FLY;
export const MOVETYPE_TOSS = movetype_t.MOVETYPE_TOSS;
export const MOVETYPE_FLYMISSILE = movetype_t.MOVETYPE_FLYMISSILE;
export const MOVETYPE_BOUNCE = movetype_t.MOVETYPE_BOUNCE;

/**
 * Original name: fieldtype_t
 * Source: Quake-2-master/game/g_local.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines the field encoding tags used by savegame/spawn metadata.
 */
export enum fieldtype_t {
  F_INT,
  F_FLOAT,
  F_LSTRING,
  F_GSTRING,
  F_VECTOR,
  F_ANGLEHACK,
  F_EDICT,
  F_ITEM,
  F_CLIENT,
  F_FUNCTION,
  F_MMOVE,
  F_IGNORE
}

export type gitem_t = GameItemDefinition;
export type gitem_armor_t = GameItemArmorInfo;
export type client_persistant_t = GameClientPersistant;
export type client_respawn_t = GameClientRespawn;
export type mframe_t = GameMonsterFrame;
export type mmove_t = GameMonsterMove;
export type monsterinfo_t = GameMonsterInfo;
export type moveinfo_t = GameMoveInfo;

/**
 * Original name: game_locals_t
 * Source: Quake-2-master/game/g_local.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Holds the cross-level game state that survives map changes and is persisted in game save files.
 *
 * Porting notes:
 * - Fixed C buffers such as `helpmessage1`, `helpmessage2` and `spawnpoint` are represented as strings.
 * - `clients` keeps explicit client records instead of a tagged C allocation.
 */
export interface game_locals_t {
  helpmessage1: string;
  helpmessage2: string;
  helpchanged: number;
  clients: gclient_t[];
  spawnpoint: string;
  maxclients: number;
  maxentities: number;
  serverflags: number;
  num_items: number;
  autosaved: qboolean;
}

/**
 * Original name: level_locals_t
 * Source: Quake-2-master/game/g_local.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Holds the per-level state reset on map load and persisted in level save files.
 *
 * Porting notes:
 * - C fixed buffers are represented as strings, and edict pointers remain object references.
 * - Active frame/time values are mirrored from `GameRuntime` during frame execution.
 */
export interface level_locals_t {
  framenum: number;
  time: number;
  level_name: string;
  mapname: string;
  nextmap: string;
  intermissiontime: number;
  changemap: string | null;
  exitintermission: number;
  intermission_origin: vec3_t;
  intermission_angle: vec3_t;
  sight_client: edict_t | null;
  sight_entity: edict_t | null;
  sight_entity_framenum: number;
  sound_entity: edict_t | null;
  sound_entity_framenum: number;
  sound2_entity: edict_t | null;
  sound2_entity_framenum: number;
  pic_health: number;
  total_secrets: number;
  found_secrets: number;
  total_goals: number;
  found_goals: number;
  total_monsters: number;
  killed_monsters: number;
  current_entity: edict_t | null;
  body_que: number;
  power_cubes: number;
}

/**
 * Original name: spawn_temp_t
 * Source: Quake-2-master/game/g_local.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Holds editor-only spawn fields parsed from entity text before spawn functions consume them.
 *
 * Porting notes:
 * - C string pointers are represented as nullable strings; vector storage remains a mutable vec3 tuple.
 */
export interface spawn_temp_t {
  sky: string | null;
  skyrotate: number;
  skyaxis: vec3_t;
  nextmap: string | null;
  lip: number;
  distance: number;
  height: number;
  noise: string | null;
  pausetime: number;
  item: string | null;
  gravity: string | null;
  minyaw: number;
  maxyaw: number;
  minpitch: number;
  maxpitch: number;
}

/**
 * Original name: field_t
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Describes one spawn/save field entry using symbolic TS selectors instead of C byte offsets.
 */
export interface field_t {
  name: string;
  ofs: string;
  type: fieldtype_t;
  flags: number;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local zero-initializer)
 * Category: New
 * Fidelity level: Close
 *
 * Behavior:
 * - Creates the zero-initialized `game_locals_t` block used by gameplay code.
 */
export function createGameLocals(): game_locals_t {
  return {
    helpmessage1: "",
    helpmessage2: "",
    helpchanged: 0,
    clients: [],
    spawnpoint: "",
    maxclients: 0,
    maxentities: 0,
    serverflags: 0,
    num_items: 0,
    autosaved: false
  };
}

/**
 * Original name: N/A
 * Source declaree: N/A (local zero-initializer)
 * Category: New
 * Fidelity level: Close
 *
 * Behavior:
 * - Creates the zero-initialized `level_locals_t` block used by gameplay code.
 */
export function createLevelLocals(): level_locals_t {
  return {
    framenum: 0,
    time: 0,
    level_name: "",
    mapname: "",
    nextmap: "",
    intermissiontime: 0,
    changemap: null,
    exitintermission: 0,
    intermission_origin: [0, 0, 0],
    intermission_angle: [0, 0, 0],
    sight_client: null,
    sight_entity: null,
    sight_entity_framenum: 0,
    sound_entity: null,
    sound_entity_framenum: 0,
    sound2_entity: null,
    sound2_entity_framenum: 0,
    pic_health: 0,
    total_secrets: 0,
    found_secrets: 0,
    total_goals: 0,
    found_goals: 0,
    total_monsters: 0,
    killed_monsters: 0,
    current_entity: null,
    body_que: 0,
    power_cubes: 0
  };
}

/**
 * Original name: N/A
 * Source declaree: N/A (local zero-initializer)
 * Category: New
 * Fidelity level: Close
 *
 * Behavior:
 * - Creates the zero-initialized `spawn_temp_t` block used while parsing entity fields.
 */
export function createSpawnTemp(): spawn_temp_t {
  return {
    sky: null,
    skyrotate: 0,
    skyaxis: [0, 0, 0],
    nextmap: null,
    lip: 0,
    distance: 0,
    height: 0,
    noise: null,
    pausetime: 0,
    item: null,
    gravity: null,
    minyaw: 0,
    maxyaw: 0,
    minpitch: 0,
    maxpitch: 0
  };
}

/**
 * Original name: ITEM_INDEX
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns the stable Quake II item index carried by one `gitem_t`.
 */
export function ITEM_INDEX(item: gitem_t): number {
  return item.index;
}

/**
 * Original name: world
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns the worldspawn edict stored at slot zero.
 */
export function world(g_edicts: edict_t[]): edict_t | null {
  return g_edicts[0] ?? null;
}

/**
 * Original name: FOFS
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Represents one `edict_t` field selector used by spawn/search metadata.
 */
export function FOFS(field: keyof edict_t): keyof edict_t {
  return field;
}

/**
 * Original name: STOFS
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Represents one `spawn_temp_t` field selector used by spawn metadata.
 */
export function STOFS(field: keyof spawn_temp_t): keyof spawn_temp_t {
  return field;
}

/**
 * Original name: LLOFS
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Represents one `level_locals_t` field selector used by savegame metadata.
 */
export function LLOFS(field: keyof level_locals_t): keyof level_locals_t {
  return field;
}

/**
 * Original name: CLOFS
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Represents one `gclient_t` field selector used by savegame metadata.
 */
export function CLOFS(field: keyof gclient_t): keyof gclient_t {
  return field;
}

/**
 * Original name: random
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Mirrors `((rand() & 0x7fff) / ((float)0x7fff))` as a floating value in [0, 1].
 *
 * Porting notes:
 * - JavaScript has no C `rand`; this derives the same 15-bit range from `Math.random`.
 */
export function random(): number {
  return Math.floor(Math.random() * 0x8000) / 0x7fff;
}

/**
 * Original name: crandom
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Mirrors `2.0 * (random() - 0.5)` as a centered floating value in [-1, 1].
 */
export function crandom(): number {
  return 2.0 * (random() - 0.5);
}

export {
  AMMO_BULLETS,
  AMMO_CELLS,
  AMMO_GRENADES,
  AMMO_ROCKETS,
  AMMO_SHELLS,
  AMMO_SLUGS,
  ammo_t,
  ANIM_ATTACK,
  ANIM_BASIC,
  ANIM_DEATH,
  ANIM_JUMP,
  ANIM_PAIN,
  ANIM_REVERSE,
  ANIM_WAVE,
  CENTER_HANDED,
  createGameClient,
  createGameClientPersistant,
  createGameClientRespawn,
  createMonsterInfo,
  DAMAGE_BULLET,
  DAMAGE_ENERGY,
  DAMAGE_NO_ARMOR,
  DAMAGE_NO_KNOCKBACK,
  DAMAGE_NO_PROTECTION,
  DAMAGE_RADIUS,
  DAMAGE_TIME,
  DEAD_DEAD,
  DEAD_DYING,
  DEAD_NO,
  DEAD_RESPAWNABLE,
  DEFAULT_BULLET_HSPREAD,
  DEFAULT_BULLET_VSPREAD,
  DEFAULT_DEATHMATCH_SHOTGUN_COUNT,
  DEFAULT_SHOTGUN_COUNT,
  DEFAULT_SHOTGUN_HSPREAD,
  DEFAULT_SHOTGUN_VSPREAD,
  DEFAULT_SSHOTGUN_COUNT,
  DROPPED_ITEM,
  DROPPED_PLAYER_ITEM,
  FL_GODMODE,
  FL_IMMUNE_LASER,
  FL_NO_KNOCKBACK,
  FL_NOTARGET,
  FL_POWER_ARMOR,
  FL_RESPAWN,
  FL_TEAMSLAVE,
  FRAMETIME,
  LEFT_HANDED,
  MAX_ITEMS,
  MOD_BFG_BLAST,
  MOD_BFG_EFFECT,
  MOD_BFG_LASER,
  MOD_BLASTER,
  MOD_CHAINGUN,
  MOD_FRIENDLY_FIRE,
  MOD_G_SPLASH,
  MOD_GRENADE,
  MOD_HANDGRENADE,
  MOD_HELD_GRENADE,
  MOD_HG_SPLASH,
  MOD_HIT,
  MOD_HYPERBLASTER,
  MOD_MACHINEGUN,
  MOD_R_SPLASH,
  MOD_RAILGUN,
  MOD_ROCKET,
  MOD_SHOTGUN,
  MOD_SSHOTGUN,
  POWER_ARMOR_NONE,
  POWER_ARMOR_SCREEN,
  POWER_ARMOR_SHIELD,
  RIGHT_HANDED,
  SOLID_BBOX,
  SOLID_BSP,
  SOLID_NOT,
  SOLID_TRIGGER,
  SVF_DEADMONSTER,
  SVF_MONSTER,
  SVF_NOCLIENT,
  WEAP_BFG,
  WEAP_BLASTER,
  WEAP_CHAINGUN,
  WEAP_GRENADELAUNCHER,
  WEAP_GRENADES,
  WEAP_HYPERBLASTER,
  WEAP_MACHINEGUN,
  WEAP_RAILGUN,
  WEAP_ROCKETLAUNCHER,
  WEAP_SHOTGUN,
  WEAP_SUPERSHOTGUN,
  weaponstate_t
};

/**
 * Original name: AMMO_BULLETS
 * Source: game/g_local.h
 * Category: Adapter
 * Fidelity level: Strict
 *
 * Behavior:
 * - Re-exposes the canonical `ammo_t.AMMO_BULLETS` value from the `g_local.h` attachment point.
 *
 * Porting notes:
 * - The owner of the enum port is `packages/game/src/runtime.ts`; this numeric alias avoids runtime import-cycle hazards.
 */
const AMMO_BULLETS = 0;

/**
 * Original name: AMMO_SHELLS
 * Source: game/g_local.h
 * Category: Adapter
 * Fidelity level: Strict
 *
 * Behavior:
 * - Re-exposes the canonical `ammo_t.AMMO_SHELLS` value from the `g_local.h` attachment point.
 *
 * Porting notes:
 * - The owner of the enum port is `packages/game/src/runtime.ts`; this numeric alias avoids runtime import-cycle hazards.
 */
const AMMO_SHELLS = 1;

/**
 * Original name: AMMO_ROCKETS
 * Source: game/g_local.h
 * Category: Adapter
 * Fidelity level: Strict
 *
 * Behavior:
 * - Re-exposes the canonical `ammo_t.AMMO_ROCKETS` value from the `g_local.h` attachment point.
 *
 * Porting notes:
 * - The owner of the enum port is `packages/game/src/runtime.ts`; this numeric alias avoids runtime import-cycle hazards.
 */
const AMMO_ROCKETS = 2;

/**
 * Original name: AMMO_GRENADES
 * Source: game/g_local.h
 * Category: Adapter
 * Fidelity level: Strict
 *
 * Behavior:
 * - Re-exposes the canonical `ammo_t.AMMO_GRENADES` value from the `g_local.h` attachment point.
 *
 * Porting notes:
 * - The owner of the enum port is `packages/game/src/runtime.ts`; this numeric alias avoids runtime import-cycle hazards.
 */
const AMMO_GRENADES = 3;

/**
 * Original name: AMMO_CELLS
 * Source: game/g_local.h
 * Category: Adapter
 * Fidelity level: Strict
 *
 * Behavior:
 * - Re-exposes the canonical `ammo_t.AMMO_CELLS` value from the `g_local.h` attachment point.
 *
 * Porting notes:
 * - The owner of the enum port is `packages/game/src/runtime.ts`; this numeric alias avoids runtime import-cycle hazards.
 */
const AMMO_CELLS = 4;

/**
 * Original name: AMMO_SLUGS
 * Source: game/g_local.h
 * Category: Adapter
 * Fidelity level: Strict
 *
 * Behavior:
 * - Re-exposes the canonical `ammo_t.AMMO_SLUGS` value from the `g_local.h` attachment point.
 *
 * Porting notes:
 * - The owner of the enum port is `packages/game/src/runtime.ts`; this numeric alias avoids runtime import-cycle hazards.
 */
const AMMO_SLUGS = 5;

export type {
  GameClient,
  GameClientPersistant,
  GameClientRespawn,
  GameEntity,
  GameMonsterFrame,
  GameMonsterInfo,
  GameMonsterMove,
  game_export_t,
  game_import_t
};
