/**
 * File: runtime.ts
 * Purpose: Provide a first gameplay entity runtime for BSP-spawned Quake II entities and delayed target dispatch.
 *
 * This file is not a direct source port.
 * It is a runtime support layer that keeps entity data close to Quake II gameplay conventions.
 *
 * Dependencies:
 * - packages/formats
 * - packages/game/src/g_utils.ts
 */

import type { BspEntity, BspMap } from "../../formats/src/qfiles.js";
import {
  CM_BoxTrace,
  CM_InlineModel,
  CM_PointContents,
  CM_TransformedBoxTrace,
  CM_TransformedPointContents,
  CS_IMAGES,
  CS_MODELS,
  CS_SOUNDS,
  AREA_SOLID,
  AREA_TRIGGERS,
  DF_MODELTEAMS,
  DF_NO_FRIENDLY_FIRE,
  DF_SKINTEAMS,
  MASK_SOLID,
  MAX_ITEMS,
  SPLASH_BLUE_WATER,
  SPLASH_BROWN_WATER,
  SPLASH_BLOOD,
  SPLASH_LAVA,
  SPLASH_SLIME,
  SPLASH_SPARKS,
  SPLASH_UNKNOWN,
  createEntityState,
  createPlayerState,
  createCollisionWorld,
  multicast_t,
  temp_event_t,
  type CollisionWorld,
  type entity_state_t,
  type player_state_t,
  type pmove_state_t,
  type trace_t,
  type vec3_t
} from "../../qcommon/src/index.js";
import { G_UseTargets } from "./g_utils.js";
import type { GameItemDefinition } from "./g_items.js";

/**
 * Original name: AREA_* / DF_* / SPLASH_*
 * Source: game/q_shared.h
 * Category: Adapter
 * Fidelity level: Strict
 *
 * Behavior:
 * - Re-exports shared qcommon constants used by gameplay runtime modules.
 *
 * Porting notes:
 * - The canonical owners remain in `packages/qcommon/src/q_shared.ts`; this file only exposes
 *   the game-runtime import surface expected by existing ports.
 */
export {
  AREA_SOLID,
  AREA_TRIGGERS,
  DF_MODELTEAMS,
  DF_NO_FRIENDLY_FIRE,
  DF_SKINTEAMS,
  SPLASH_BLUE_WATER,
  SPLASH_BROWN_WATER,
  SPLASH_BLOOD,
  SPLASH_LAVA,
  SPLASH_SLIME,
  SPLASH_SPARKS,
  SPLASH_UNKNOWN
};

/**
 * Original name: weaponstate_t
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines the player weapon-state enum used by `p_weapon.c`.
 */
export enum weaponstate_t {
  WEAPON_READY,
  WEAPON_ACTIVATING,
  WEAPON_DROPPING,
  WEAPON_FIRING
}

/**
 * Original name: ammo_t
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines the canonical ammo tags stored on weapon and ammo items.
 */
export enum ammo_t {
  AMMO_BULLETS,
  AMMO_SHELLS,
  AMMO_ROCKETS,
  AMMO_GRENADES,
  AMMO_CELLS,
  AMMO_SLUGS
}

/**
 * Original name: WEAP_*
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines the weapon-model ids referenced by `gitem_t->weapmodel`.
 */
export const WEAP_BLASTER = 1;
export const WEAP_SHOTGUN = 2;
export const WEAP_SUPERSHOTGUN = 3;
export const WEAP_MACHINEGUN = 4;
export const WEAP_CHAINGUN = 5;
export const WEAP_GRENADES = 6;
export const WEAP_GRENADELAUNCHER = 7;
export const WEAP_ROCKETLAUNCHER = 8;
export const WEAP_HYPERBLASTER = 9;
export const WEAP_RAILGUN = 10;
export const WEAP_BFG = 11;

/**
 * Original name: RIGHT_HANDED / LEFT_HANDED / CENTER_HANDED
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines the handedness values used by player weapon projection and HUD state.
 */
export const RIGHT_HANDED = 0;
export const LEFT_HANDED = 1;
export const CENTER_HANDED = 2;

/**
 * Original name: MOD_*
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines means-of-death ids consumed by combat, weapon and obituary logic.
 */
export const MOD_SHOTGUN = 2;
export const MOD_SSHOTGUN = 3;
export const MOD_MACHINEGUN = 4;
export const MOD_CHAINGUN = 5;
export const MOD_BLASTER = 1;
export const MOD_HYPERBLASTER = 10;
export const MOD_RAILGUN = 11;
export const MOD_HIT = 32;
export const MOD_GRENADE = 6;
export const MOD_G_SPLASH = 7;
export const MOD_ROCKET = 8;
export const MOD_R_SPLASH = 9;
export const MOD_BFG_LASER = 12;
export const MOD_BFG_BLAST = 13;
export const MOD_BFG_EFFECT = 14;
export const MOD_HANDGRENADE = 15;
export const MOD_HG_SPLASH = 16;
export const MOD_HELD_GRENADE = 24;
export const MOD_FRIENDLY_FIRE = 0x8000000;

/**
 * Original name: DAMAGE_* / DEFAULT_* / DAMAGE_TIME
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines damage flags, weapon spread defaults and the view-damage feedback duration.
 */
export const DAMAGE_RADIUS = 0x00000001;
export const DAMAGE_NO_ARMOR = 0x00000002;
export const DAMAGE_ENERGY = 0x00000004;
export const DAMAGE_NO_KNOCKBACK = 0x00000008;
export const DAMAGE_BULLET = 0x00000010;
export const DAMAGE_NO_PROTECTION = 0x00000020;
export const DEFAULT_BULLET_HSPREAD = 300;
export const DEFAULT_BULLET_VSPREAD = 500;
export const DEFAULT_SHOTGUN_HSPREAD = 1000;
export const DEFAULT_SHOTGUN_VSPREAD = 500;
export const DEFAULT_DEATHMATCH_SHOTGUN_COUNT = 12;
export const DEFAULT_SHOTGUN_COUNT = 12;
export const DEFAULT_SSHOTGUN_COUNT = 20;
export const DAMAGE_TIME = 0.5;

/**
 * Original name: ANIM_*
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines client animation priority values used by player view and weapon code.
 */
export const ANIM_BASIC = 0;
export const ANIM_WAVE = 1;
export const ANIM_JUMP = 2;
export const ANIM_PAIN = 3;
export const ANIM_ATTACK = 4;
export const ANIM_DEATH = 5;
export const ANIM_REVERSE = 6;

/**
 * Original name: DEAD_*
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines entity death-state flags consumed by combat, client and monster logic.
 */
export const DEAD_NO = 0;
export const DEAD_DYING = 1;
export const DEAD_DEAD = 2;
export const DEAD_RESPAWNABLE = 3;

/**
 * Original name: client_persistant_t
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Preserves the player state that survives level changes, including userinfo, health, inventory,
 *   weapon pointers, help counters and spectator status.
 *
 * Porting notes:
 * - Fixed C buffers are represented as strings, and `gitem_t *` fields reference item definitions.
 */
export interface GameClientPersistant {
  userinfo: string;
  netname: string;
  hand: number;
  connected: boolean;
  health: number;
  max_health: number;
  savedFlags: number;
  inventory: number[];
  weapon: GameItemDefinition | null;
  lastweapon: GameItemDefinition | null;
  selected_item: number;
  max_bullets: number;
  max_shells: number;
  max_rockets: number;
  max_grenades: number;
  max_cells: number;
  max_slugs: number;
  power_cubes: number;
  score: number;
  game_helpchanged: number;
  helpchanged: number;
  spectator: boolean;
}

/**
 * Original name: client_respawn_t
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Preserves the respawn-state block that survives deathmatch respawns.
 * - Carries the coop persistent snapshot, entry frame, score, latest command angles and spectator state.
 */
export interface GameClientRespawn {
  spectator: boolean;
  score: number;
  enterframe: number;
  cmd_angles: vec3_t;
  coop_respawn: GameClientPersistant;
}

/**
 * Original name: gclient_s
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Preserves the per-client gameplay block embedded behind `edict_t.client`, including the server-visible
 *   `player_state_t`/`ping` prefix, persistent/respawn state, input latches, HUD toggles, weapon state and
 *   frame-accumulated damage feedback.
 *
 * Porting notes:
 * - C pointers such as `gitem_t *newweapon` are represented as nullable item definitions.
 */
export interface GameClient {
  ps: player_state_t;
  ping: number;
  pers: GameClientPersistant;
  resp: GameClientRespawn;
  old_pmove: pmove_state_t;
  showscores: boolean;
  showinventory: boolean;
  showhelp: boolean;
  showhelpicon: boolean;
  kick_angles: vec3_t;
  kick_origin: vec3_t;
  v_angle: vec3_t;
  v_dmg_roll: number;
  v_dmg_pitch: number;
  v_dmg_time: number;
  ammo_index: number;
  buttons: number;
  oldbuttons: number;
  latched_buttons: number;
  weapon_thunk: boolean;
  newweapon: GameItemDefinition | null;
  killer_yaw: number;
  weaponstate: weaponstate_t;
  machinegun_shots: number;
  fall_time: number;
  fall_value: number;
  damage_alpha: number;
  bonus_alpha: number;
  damage_blend: vec3_t;
  bobtime: number;
  oldviewangles: vec3_t;
  oldvelocity: vec3_t;
  next_drown_time: number;
  old_waterlevel: number;
  breather_sound: number;
  anim_end: number;
  anim_priority: number;
  anim_duck: boolean;
  anim_run: boolean;
  grenade_blew_up: boolean;
  grenade_time: number;
  silencer_shots: number;
  breather_framenum: number;
  enviro_framenum: number;
  invincible_framenum: number;
  damage_parmor: number;
  damage_armor: number;
  damage_blood: number;
  damage_knockback: number;
  damage_from: vec3_t;
  weapon_sound: number;
  quad_framenum: number;
  pickup_msg_time: number;
  flood_locktill: number;
  flood_when: number[];
  flood_whenhead: number;
  respawn_time: number;
  chase_target: GameEntity | null;
  update_chase: boolean;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Name the string-backed entity fields searchable through the first `G_Find` port.
 *
 * Constraints:
 * - Must stay aligned with the BSP-backed entity fields already required by the door plan.
 */
export type GameEntityFieldName =
  | "classname"
  | "target"
  | "targetname"
  | "killtarget"
  | "message"
  | "model";

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Classify gameplay entities by the collision/runtime role they currently occupy.
 *
 * Constraints:
 * - Must distinguish BSP inline models, runtime triggers and dynamic box entities explicitly.
 */
export type GameEntityKind =
  | "other"
  | "inline_bsp"
  | "runtime_trigger"
  | "dynamic_box";

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Preserve the `use` callback shape used by Quake II gameplay entities.
 *
 * Constraints:
 * - Must receive the runtime so delayed dispatch and instrumentation can stay explicit.
 */
export type GameEntityUse = (self: GameEntity, other: GameEntity | null, activator: GameEntity | null, runtime: GameRuntime) => void;

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Preserve the `touch` callback shape used by trigger entities.
 *
 * Constraints:
 * - Must stay close to the Quake II touch calling convention while allowing plane/surface data when physics has it.
 */
export type GameEntityTouch = (self: GameEntity, other: GameEntity, runtime: GameRuntime, plane?: trace_t["plane"] | null, surface?: trace_t["surface"] | null) => void;

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Preserve the `blocked` callback shape used by pushers such as doors and platforms.
 *
 * Constraints:
 * - Must keep the original Quake-style `(self, other)` behavior while receiving the runtime explicitly.
 */
export type GameEntityBlocked = (self: GameEntity, other: GameEntity, runtime: GameRuntime) => void;

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Preserve the `die` callback shape used by shootable brush entities such as doors.
 *
 * Constraints:
 * - Must preserve the Quake-style `(self, inflictor, attacker, damage, point)` flow while receiving the runtime explicitly.
 */
export type GameEntityDie = (
  self: GameEntity,
  inflictor: GameEntity | null,
  attacker: GameEntity | null,
  damage: number,
  runtime: GameRuntime,
  point?: vec3_t
) => void;

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Preserve the `pain` callback shape used by damageable gameplay entities.
 *
 * Constraints:
 * - Must preserve the Quake-style `(self, attacker, knockback, damage)` flow while receiving the runtime explicitly.
 */
export type GameEntityPain = (self: GameEntity, attacker: GameEntity | null, knockback: number, damage: number, runtime: GameRuntime) => void;

/**
 * Original name: moveinfo_t
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Holds the persistent mover endpoints, sounds, timing and active movement state embedded in each edict.
 *
 * Porting notes:
 * - Function pointers are represented as explicit TypeScript callbacks and the original field names are preserved.
 */
export interface GameMoveInfo {
  start_origin: [number, number, number];
  start_angles: [number, number, number];
  end_origin: [number, number, number];
  end_angles: [number, number, number];
  sound_start: number;
  sound_middle: number;
  sound_end: number;
  accel: number;
  speed: number;
  decel: number;
  distance: number;
  wait: number;
  state: number;
  dir: [number, number, number];
  current_speed: number;
  move_speed: number;
  next_speed: number;
  remaining_distance: number;
  decel_distance: number;
  endfunc: GameEntityThink | undefined;
}

/**
 * Original name: mframe_t
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Preserves one monster animation frame record with its AI callback, movement distance and optional think callback.
 *
 * Porting notes:
 * - Function pointers are represented as explicit TypeScript callbacks that receive the runtime adapter.
 */
export interface GameMonsterFrame {
  aifunc: ((self: GameEntity, dist: number, runtime: GameRuntime) => void) | undefined;
  dist: number;
  thinkfunc: GameEntityThink | undefined;
}

/**
 * Original name: mmove_t
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Preserves one monster animation move with first/last frame bounds, frame table pointer and optional end callback.
 *
 * Porting notes:
 * - The C `mframe_t *frame` pointer is represented by a `GameMonsterFrame[]`.
 * - Function pointers are represented as explicit TypeScript callbacks that receive the runtime adapter.
 */
export interface GameMonsterMove {
  firstframe: number;
  lastframe: number;
  frame: GameMonsterFrame[];
  endfunc: GameEntityThink | undefined;
}

/**
 * Original name: monsterinfo_t
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Preserves the monster animation, AI callback and combat state block embedded in each edict.
 *
 * Porting notes:
 * - Function pointers and `mmove_t *currentmove` are represented as TypeScript callback and move references.
 */
export interface GameMonsterInfo {
  currentmove: GameMonsterMove | null;
  aiflags: number;
  nextframe: number;
  scale: number;
  stand: GameEntityThink | undefined;
  idle: GameEntityThink | undefined;
  search: GameEntityThink | undefined;
  walk: GameEntityThink | undefined;
  run: GameEntityThink | undefined;
  dodge: ((self: GameEntity, other: GameEntity | null, eta: number, runtime: GameRuntime) => void) | undefined;
  attack: GameEntityThink | undefined;
  melee: GameEntityThink | undefined;
  sight: ((self: GameEntity, other: GameEntity | null, runtime: GameRuntime) => void) | undefined;
  checkattack: ((self: GameEntity, runtime: GameRuntime) => boolean) | undefined;
  pausetime: number;
  attack_finished: number;
  saved_goal: vec3_t;
  search_time: number;
  trail_time: number;
  last_sighting: vec3_t;
  attack_state: number;
  lefty: number;
  idle_time: number;
  linkcount: number;
  power_armor_type: number;
  power_armor_power: number;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Hold the local asset registration tables used to emulate the original index-based game import API.
 *
 * Constraints:
 * - Index zero must remain the implicit "not set" value.
 * - Indices must stay stable for the lifetime of one runtime.
 */
export interface GameAssetRegistry {
  modelPaths: string[];
  modelIndexByPath: Map<string, number>;
  soundPaths: string[];
  soundIndexByPath: Map<string, number>;
  imagePaths: string[];
  imageIndexByPath: Map<string, number>;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Preserve the `think` callback shape used by delayed gameplay entities.
 *
 * Constraints:
 * - Must receive the runtime so entity allocation and logging stay centralized.
 */
export type GameEntityThink = (self: GameEntity, runtime: GameRuntime) => void;

/**
 * Original name: edict_s
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Represents one mutable gameplay edict, including the server-visible prefix and gameplay-private fields.
 *
 * Porting notes:
 * - C pointers are modeled as nullable object references.
 * - C strings are modeled as strings or `undefined` for NULL-like fields.
 * - The original BSP property bag is retained for spawn-field expansion.
 */
export interface GameEntity {
  index: number;
  inuse: boolean;
  freetime: number;
  properties: Record<string, string>;
  classname: string;
  client: GameClient | null;
  owner: GameEntity | null;
  enemy: GameEntity | null;
  oldenemy: GameEntity | null;
  team: string | undefined;
  teammaster: GameEntity | null;
  teamchain: GameEntity | null;
  target: string | undefined;
  targetname: string | undefined;
  killtarget: string | undefined;
  pathtarget: string | undefined;
  deathtarget: string | undefined;
  combattarget: string | undefined;
  target_ent: GameEntity | null;
  message: string | undefined;
  model: string | undefined;
  spawnflags: number;
  flags: number;
  timestamp: number;
  angle: number;
  wait: number;
  speed: number;
  accel: number;
  decel: number;
  sounds: number;
  noise_index: number;
  noise_index2: number;
  solid: number;
  movetype: number;
  svflags: number;
  linkcount: number;
  area: GameAreaLink;
  num_clusters: number;
  clusternums: Int32Array;
  linked: boolean;
  entityKind: GameEntityKind;
  areanum: number;
  areanum2: number;
  clipmask: number;
  headnode: number;
  health: number;
  takedamage: number;
  max_health: number;
  mass: number;
  air_finished: number;
  gravity: number;
  deadflag: number;
  gib_health: number;
  show_hostile: number;
  dmg: number;
  radius_dmg: number;
  dmg_radius: number;
  pain_debounce_time: number;
  touch_debounce_time: number;
  damage_debounce_time: number;
  fly_sound_debounce_time: number;
  last_move_time: number;
  powerarmor_time: number;
  delay: number;
  random: number;
  nextthink: number;
  activator: GameEntity | null;
  chain: GameEntity | null;
  goalentity: GameEntity | null;
  movetarget: GameEntity | null;
  yaw_speed: number;
  ideal_yaw: number;
  use: GameEntityUse | undefined;
  prethink: GameEntityThink | undefined;
  think: GameEntityThink | undefined;
  touch: GameEntityTouch | undefined;
  blocked: GameEntityBlocked | undefined;
  die: GameEntityDie | undefined;
  pain: GameEntityPain | undefined;
  movedir: [number, number, number];
  velocity: [number, number, number];
  avelocity: [number, number, number];
  origin: [number, number, number];
  angles: [number, number, number];
  pos1: [number, number, number];
  pos2: [number, number, number];
  mins: [number, number, number];
  maxs: [number, number, number];
  absmin: [number, number, number];
  absmax: [number, number, number];
  size: [number, number, number];
  groundentity: GameEntity | null;
  groundentity_linkcount: number;
  moveinfo: GameMoveInfo;
  s: entity_state_t;
  count: number;
  style: number;
  viewheight: number;
  map: string | undefined;
  waterlevel: number;
  watertype: number;
  volume: number;
  attenuation: number;
  light_level: number;
  move_origin: vec3_t;
  move_angles: vec3_t;
  power_armor_type: number;
  power_armor_power: number;
  itemIndex: number;
  item: GameItemDefinition | null;
  itemClassname: string | undefined;
  itemPickupName: string | undefined;
  itemWorldModel: string | undefined;
  itemWorldModelFlags: number;
  mynoise: GameEntity | null;
  mynoise2: GameEntity | null;
  teleport_time: number;
  monsterinfo: GameMonsterInfo;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Expose the collision queries consumed by the gameplay runtime ports in `g_phys`.
 *
 * Constraints:
 * - Must preserve Quake II style `trace(start, mins, maxs, end, passent, mask)` usage.
 * - Must resolve worldspawn, inline BSP models and linked dynamic boxes together.
 */
export interface GameCollisionBridge {
  world: CollisionWorld;
  trace: (
    start: vec3_t,
    mins: vec3_t,
    maxs: vec3_t,
    end: vec3_t,
    passent: GameEntity | null,
    contentmask: number
  ) => trace_t;
  pointcontents: (point: vec3_t, passent?: GameEntity | null) => number;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Describe one runtime instrumentation event emitted while resolving targets.
 *
 * Constraints:
 * - Must be readable enough for the phase-1 verification harness.
 */
export interface GameRuntimeLogEntry {
  time: number;
  kind:
    | "use"
    | "use-targets"
    | "delay-scheduled"
    | "message"
    | "killtarget"
    | "fire-target"
    | "warning"
    | "entity-freed"
    | "think";
  message: string;
  entityIndex?: number | undefined;
  entityClassname?: string | undefined;
  otherIndex?: number | undefined;
  otherClassname?: string | undefined;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Describe one gameplay-side one-shot sound request emitted by the ported game code before a real audio backend is attached.
 *
 * Constraints:
 * - Must preserve the original sound path reference through the stable Quake-style sound index table.
 * - Must keep source entity and frame information explicit for later client/audio bridging.
 */
export interface GameSoundEvent {
  frame: number;
  entity?: GameEntity | null;
  entityIndex: number | null;
  soundIndex: number;
  soundPath: string;
  origin?: vec3_t | null;
  channel?: number;
  volume?: number;
  attenuation?: number;
  timeofs?: number;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Queue one gameplay-side `gi.cprintf` request before the engine/server import is available.
 *
 * Constraints:
 * - Must preserve the target entity, print level and final formatted message text.
 */
export interface GameCprintfEvent {
  frame: number;
  entity?: GameEntity | null;
  entityIndex: number | null;
  printlevel: number;
  message: string;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Queue one gameplay-side `gi.centerprintf` request before the engine/server import is available.
 *
 * Constraints:
 * - Must preserve the target entity and final formatted message text.
 */
export interface GameCenterprintEvent {
  frame: number;
  entity?: GameEntity | null;
  entityIndex: number | null;
  message: string;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Queue one gameplay-side temporary entity event emitted by source ports before server multicast serialization is attached.
 *
 * Constraints:
 * - Must preserve the original temp-event id, payload and multicast visibility class.
 */
export interface GameTempEntityEvent {
  frame: number;
  type: temp_event_t;
  origin: vec3_t;
  multicast: multicast_t;
  payload: Record<string, unknown>;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Describe one gameplay-originated configstring update before it is serialized by the server bridge.
 */
export interface GameConfigstringUpdate {
  index: number;
  value: string;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Queue one gameplay-side player muzzleflash event until a client/demo bridge consumes it.
 *
 * Constraints:
 * - Must preserve the source entity index and the original muzzleflash weapon bits.
 */
export interface GamePlayerMuzzleFlashEvent {
  frame: number;
  entityIndex: number;
  weapon: number;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Queue one gameplay-side monster muzzleflash event until a client/demo bridge consumes it.
 *
 * Constraints:
 * - Must preserve the source entity index and original `MZ2_*` flash number.
 */
export interface GameMonsterMuzzleFlashEvent {
  frame: number;
  entityIndex: number;
  flashNumber: number;
  origin: vec3_t;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Hold the circular player-trail state used by pursuit helpers from `p_trail.c`.
 *
 * Constraints:
 * - Must preserve the fixed trail length and active/head state explicitly on the gameplay runtime.
 */
export interface GamePlayerTrailState {
  trail: GameEntity[];
  trail_head: number;
  trail_active: boolean;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Hold the mutable gameplay entity list plus minimal timing and log state.
 *
 * Constraints:
 * - Entity order must remain stable so future `edict`-style references stay predictable.
 */
export interface GameRuntime {
  entities: GameEntity[];
  time: number;
  framenum: number;
  helpchanged: number;
  gravity: number;
  maxvelocity: number;
  mapname: string;
  spawnpoint: string;
  maxclients: number;
  maxentities: number;
  body_que: number;
  power_cubes: number;
  meansOfDeath: number;
  sm_meat_index: number;
  snd_fry: number;
  autosaved: boolean;
  intermissiontime: number;
  exitintermission: number;
  intermission_origin: vec3_t;
  intermission_angle: vec3_t;
  changemap: string | null;
  pic_health: number;
  serverflags: number;
  helpmessage1: string;
  helpmessage2: string;
  total_secrets: number;
  found_secrets: number;
  total_goals: number;
  found_goals: number;
  total_monsters: number;
  killed_monsters: number;
  deathmatch: boolean;
  coop: boolean;
  dmflags: number;
  skill: number;
  g_select_empty: boolean;
  current_entity: GameEntity | null;
  logEntries: GameRuntimeLogEntry[];
  collision: GameCollisionBridge | null;
  assets: GameAssetRegistry;
  sight_client: GameEntity | null;
  sight_entity: GameEntity | null;
  sight_entity_framenum: number;
  sound_entity: GameEntity | null;
  sound_entity_framenum: number;
  sound2_entity: GameEntity | null;
  sound2_entity_framenum: number;
  soundEvents: GameSoundEvent[];
  cprintfEvents: GameCprintfEvent[];
  centerprintEvents: GameCenterprintEvent[];
  tempEntityEvents: GameTempEntityEvent[];
  configstrings: Map<number, string>;
  playerMuzzleFlashEvents: GamePlayerMuzzleFlashEvent[];
  monsterMuzzleFlashEvents: GameMonsterMuzzleFlashEvent[];
  linkedSolidEntities: GameEntity[];
  linkedTriggerEntities: GameEntity[];
  linkedInlineBspEntities: GameEntity[];
  linkedRuntimeTriggerEntities: GameEntity[];
  linkedDynamicBoxEntities: GameEntity[];
  playerTrail: GamePlayerTrailState;
  engineLinkEntity?: (entity: GameEntity) => void;
  engineUnlinkEntity?: (entity: GameEntity) => void;
  engineImageIndex?: (path: string) => number;
  log: (entry: Omit<GameRuntimeLogEntry, "time">) => void;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Preserve the minimal `link_t` area-link node shape shared by `game.h` and `g_local.h`.
 *
 * Constraints:
 * - Must remain self-referential to mirror the original double-linked list node.
 */
export interface GameAreaLink {
  prev: GameAreaLink | null;
  next: GameAreaLink | null;
}

/**
 * Original name: SOLID_*
 * Source: game/game.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines the game import solid enum used by edict collision and linking.
 */
export const SOLID_NOT = 0;
export const SOLID_TRIGGER = 1;
export const SOLID_BBOX = 2;
export const SOLID_BSP = 3;

/**
 * Original name: MOVETYPE_*
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines gameplay movement modes used by the physics dispatcher.
 */
export const MOVETYPE_NONE = 0;
export const MOVETYPE_NOCLIP = 1;
export const MOVETYPE_PUSH = 2;
export const MOVETYPE_STOP = 3;
export const MOVETYPE_WALK = 4;
export const MOVETYPE_STEP = 5;
export const MOVETYPE_FLY = 6;
export const MOVETYPE_TOSS = 7;
export const MOVETYPE_FLYMISSILE = 8;
export const MOVETYPE_BOUNCE = 9;

/**
 * Original name: FL_*
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines gameplay entity flags used by combat, AI, items and movers.
 */
export const FL_NOTARGET = 0x00000020;
export const FL_IMMUNE_LASER = 0x00000004;
export const FL_GODMODE = 0x00000010;
export const FL_NO_KNOCKBACK = 0x00000800;
export const FL_POWER_ARMOR = 0x00001000;
export const FL_RESPAWN = 0x80000000;
export const FL_TEAMSLAVE = 0x00000400;

/**
 * Original name: POWER_ARMOR_*
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines power-armor mode ids returned by item/combat logic.
 */
export const POWER_ARMOR_NONE = 0;
export const POWER_ARMOR_SCREEN = 1;
export const POWER_ARMOR_SHIELD = 2;

/**
 * Original name: SVF_*
 * Source: game/game.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines server-visible edict flags shared through the game import boundary.
 */
export const SVF_NOCLIENT = 1 << 0;
export const SVF_DEADMONSTER = 1 << 1;
export const SVF_MONSTER = 1 << 2;

/**
 * Original name: FRAMETIME
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines the fixed gameplay frame duration used by movers, items and thinks.
 */
export const FRAMETIME = 0.1;

/**
 * Original name: DROPPED_ITEM / DROPPED_PLAYER_ITEM
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines item spawnflags used by pickup, drop and respawn rules.
 */
export const DROPPED_ITEM = 0x00010000;
export const DROPPED_PLAYER_ITEM = 0x00020000;

/**
 * Original name: STATE_*
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines brush-mover state ids used by plats, buttons and doors.
 */
export const STATE_TOP = 0;
export const STATE_BOTTOM = 1;
export const STATE_UP = 2;
export const STATE_DOWN = 3;

/**
 * Original name: DOOR_*
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines func_door spawnflags used by door setup and callbacks.
 */
export const DOOR_START_OPEN = 1;
export const DOOR_REVERSE = 2;
export const DOOR_CRUSHER = 4;
export const DOOR_NOMONSTER = 8;
export const DOOR_TOGGLE = 32;
export const DOOR_X_AXIS = 64;
export const DOOR_Y_AXIS = 128;

/**
 * Original name: PLAT_LOW_TRIGGER
 * Source: game/g_func.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines the func_plat low-trigger spawnflag used while building the center trigger.
 */
export const PLAT_LOW_TRIGGER = 1;

/**
 * Original name: client_persistant_t zero/default initialization
 * Source: game/g_local.h
 * Category: Adapter
 * Fidelity level: Close
 *
 * Behavior:
 * - Creates the persistent client block with Quake-style field names and a zeroed MAX_ITEMS inventory.
 *
 * Porting notes:
 * - Uses `RIGHT_HANDED` as the startup default before `ClientUserinfoChanged` applies userinfo.
 */
export function createGameClientPersistant(): GameClientPersistant {
  return {
    userinfo: "",
    netname: "",
    hand: RIGHT_HANDED,
    connected: false,
    health: 0,
    max_health: 0,
    savedFlags: 0,
    inventory: new Array<number>(MAX_ITEMS).fill(0),
    weapon: null,
    lastweapon: null,
    selected_item: -1,
    max_bullets: 0,
    max_shells: 0,
    max_rockets: 0,
    max_grenades: 0,
    max_cells: 0,
    max_slugs: 0,
    power_cubes: 0,
    score: 0,
    game_helpchanged: 0,
    helpchanged: 0,
    spectator: false
  };
}

/**
 * Original name: client_respawn_t zero initialization
 * Source: game/g_local.h
 * Category: Adapter
 * Fidelity level: Strict
 *
 * Behavior:
 * - Mirrors C zero initialization of the respawn block and allocates an independent coop snapshot.
 */
export function createGameClientRespawn(): GameClientRespawn {
  return {
    spectator: false,
    score: 0,
    enterframe: 0,
    cmd_angles: [0, 0, 0],
    coop_respawn: createGameClientPersistant()
  };
}

/**
 * Original name: client_persistant_t copy
 * Source: game/g_local.h
 * Category: Adapter
 * Fidelity level: Close
 *
 * Behavior:
 * - Clones the persistent client block and copies inventory by value for coop respawn/save transitions.
 */
export function cloneGameClientPersistant(source: GameClientPersistant): GameClientPersistant {
  return {
    userinfo: source.userinfo,
    netname: source.netname,
    hand: source.hand,
    connected: source.connected,
    health: source.health,
    max_health: source.max_health,
    savedFlags: source.savedFlags,
    inventory: source.inventory.slice(),
    weapon: source.weapon,
    lastweapon: source.lastweapon,
    selected_item: source.selected_item,
    max_bullets: source.max_bullets,
    max_shells: source.max_shells,
    max_rockets: source.max_rockets,
    max_grenades: source.max_grenades,
    max_cells: source.max_cells,
    max_slugs: source.max_slugs,
    power_cubes: source.power_cubes,
    score: source.score,
    game_helpchanged: source.game_helpchanged,
    helpchanged: source.helpchanged,
    spectator: source.spectator
  };
}

/**
 * Original name: gclient_s initialization
 * Source: game/g_local.h
 * Category: Adapter
 * Fidelity level: Close
 *
 * Behavior:
 * - Creates the zero/default-initialized TypeScript equivalent of a freshly allocated `gclient_s` block.
 */
export function createGameClient(): GameClient {
  return {
    ps: createPlayerState(),
    ping: 0,
    pers: createGameClientPersistant(),
    resp: createGameClientRespawn(),
    old_pmove: createPlayerState().pmove,
    showscores: false,
    showinventory: false,
    showhelp: false,
    showhelpicon: false,
    kick_angles: [0, 0, 0],
    kick_origin: [0, 0, 0],
    v_angle: [0, 0, 0],
    v_dmg_roll: 0,
    v_dmg_pitch: 0,
    v_dmg_time: 0,
    ammo_index: 0,
    buttons: 0,
    oldbuttons: 0,
    latched_buttons: 0,
    weapon_thunk: false,
    newweapon: null,
    killer_yaw: 0,
    weaponstate: weaponstate_t.WEAPON_READY,
    machinegun_shots: 0,
    fall_time: 0,
    fall_value: 0,
    damage_alpha: 0,
    bonus_alpha: 0,
    damage_blend: [0, 0, 0],
    bobtime: 0,
    oldviewangles: [0, 0, 0],
    oldvelocity: [0, 0, 0],
    next_drown_time: 0,
    old_waterlevel: 0,
    breather_sound: 0,
    anim_end: 0,
    anim_priority: ANIM_BASIC,
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
    damage_from: [0, 0, 0],
    weapon_sound: 0,
    quad_framenum: 0,
    pickup_msg_time: 0,
    flood_locktill: 0,
    flood_when: new Array<number>(10).fill(0),
    flood_whenhead: 0,
    respawn_time: 0,
    chase_target: null,
    update_chase: false
  };
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Create the zero-initialized `monsterinfo_t` block embedded in gameplay entities.
 */
export function createMonsterInfo(): GameMonsterInfo {
  return {
    currentmove: null,
    aiflags: 0,
    nextframe: 0,
    scale: 0,
    stand: undefined,
    idle: undefined,
    search: undefined,
    walk: undefined,
    run: undefined,
    dodge: undefined,
    attack: undefined,
    melee: undefined,
    sight: undefined,
    checkattack: undefined,
    pausetime: 0,
    attack_finished: 0,
    saved_goal: [0, 0, 0],
    search_time: 0,
    trail_time: 0,
    last_sighting: [0, 0, 0],
    attack_state: 0,
    lefty: 0,
    idle_time: 0,
    linkcount: 0,
    power_armor_type: 0,
    power_armor_power: 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Convert one parsed BSP entity into the mutable runtime shape used by the first gameplay ports.
 *
 * Constraints:
 * - Must preserve source strings exactly while parsing numeric delay values conservatively.
 */
export function createRuntimeEntity(properties: Record<string, string>, index: number): GameEntity {
  const origin = parseEntityVector(properties.origin);
  const angles = parseEntityAngles(properties);
  const state = createEntityState();
  state.number = index;
  state.origin = [...origin];
  state.old_origin = [...origin];
  state.angles = [...angles];

  return {
    index,
    inuse: true,
    freetime: -1,
    properties: { ...properties },
    classname: properties.classname ?? "noclass",
    client: null,
    owner: null,
    enemy: null,
    oldenemy: null,
    team: properties.team,
    teammaster: null,
    teamchain: null,
    target: properties.target,
    targetname: properties.targetname,
    killtarget: properties.killtarget,
    pathtarget: properties.pathtarget,
    deathtarget: properties.deathtarget,
    combattarget: properties.combattarget,
    target_ent: null,
    message: properties.message,
    model: properties.model,
    spawnflags: parseEntityInteger(properties.spawnflags),
    flags: 0,
    timestamp: 0,
    angle: parseEntityFloat(properties.angle),
    wait: parseEntityFloat(properties.wait),
    speed: parseEntityFloat(properties.speed),
    accel: parseEntityFloat(properties.accel),
    decel: parseEntityFloat(properties.decel),
    sounds: parseEntityInteger(properties.sounds),
    noise_index: 0,
    noise_index2: 0,
    solid: SOLID_NOT,
    movetype: MOVETYPE_NONE,
    svflags: 0,
    linkcount: 0,
    area: createAreaLink(),
    num_clusters: 0,
    clusternums: new Int32Array(16),
    linked: false,
    entityKind: "other",
    areanum: 0,
    areanum2: 0,
    clipmask: 0,
    headnode: 0,
    health: parseEntityInteger(properties.health),
    takedamage: 0,
    max_health: 0,
    mass: 0,
    air_finished: 0,
    gravity: properties.gravity ? parseEntityFloat(properties.gravity) : 1,
    deadflag: DEAD_NO,
    gib_health: 0,
    show_hostile: 0,
    dmg: parseEntityInteger(properties.dmg),
    radius_dmg: 0,
    dmg_radius: 0,
    pain_debounce_time: 0,
    touch_debounce_time: 0,
    damage_debounce_time: 0,
    fly_sound_debounce_time: 0,
    last_move_time: 0,
    powerarmor_time: 0,
    delay: parseEntityFloat(properties.delay),
    random: parseEntityFloat(properties.random),
    nextthink: 0,
    activator: null,
    chain: null,
    goalentity: null,
    movetarget: null,
    yaw_speed: 0,
    ideal_yaw: 0,
    use: undefined,
    prethink: undefined,
    think: undefined,
    touch: undefined,
    blocked: undefined,
    die: undefined,
    pain: undefined,
    movedir: [0, 0, 0],
    velocity: [0, 0, 0],
    avelocity: [0, 0, 0],
    origin,
    angles,
    pos1: [...origin],
    pos2: [...origin],
    mins: [0, 0, 0],
    maxs: [0, 0, 0],
    absmin: [0, 0, 0],
    absmax: [0, 0, 0],
    size: [0, 0, 0],
    groundentity: null,
    groundentity_linkcount: 0,
    moveinfo: createMoveInfo(),
    s: state,
    count: parseEntityInteger(properties.count),
    style: parseEntityInteger(properties.style),
    viewheight: 0,
    map: properties.map,
    waterlevel: 0,
    watertype: 0,
    volume: parseEntityFloat(properties.volume),
    attenuation: parseEntityFloat(properties.attenuation),
    light_level: 0,
    move_origin: [0, 0, 0],
    move_angles: [0, 0, 0],
    power_armor_type: POWER_ARMOR_NONE,
    power_armor_power: 0,
    itemIndex: 0,
    item: null,
    itemClassname: undefined,
    itemPickupName: undefined,
    itemWorldModel: undefined,
    itemWorldModelFlags: 0,
    mynoise: null,
    mynoise2: null,
    teleport_time: 0,
    monsterinfo: createMonsterInfo()
  };
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Create the first gameplay runtime from BSP entities while preserving map ordering.
 *
 * Constraints:
 * - Must expose centralized logging for the verification harness.
 */
export function createGameRuntimeFromBspEntities(entities: BspEntity[]): GameRuntime {
  const runtime: GameRuntime = {
    entities: entities.map((entity, index) => createRuntimeEntity(entity.properties, index)),
    time: 0,
    framenum: 0,
    helpchanged: 0,
    gravity: 800,
    maxvelocity: 2000,
    mapname: "",
    spawnpoint: "",
    maxclients: 0,
    maxentities: Number.MAX_SAFE_INTEGER,
    body_que: 0,
    power_cubes: 0,
    meansOfDeath: 0,
    sm_meat_index: 0,
    snd_fry: 0,
    autosaved: false,
    intermissiontime: 0,
    exitintermission: 0,
    intermission_origin: [0, 0, 0],
    intermission_angle: [0, 0, 0],
    changemap: null,
    pic_health: 0,
    serverflags: 0,
    helpmessage1: "",
    helpmessage2: "",
    total_secrets: 0,
    found_secrets: 0,
    total_goals: 0,
    found_goals: 0,
    total_monsters: 0,
    killed_monsters: 0,
    deathmatch: false,
    coop: false,
    dmflags: 0,
    skill: 1,
    g_select_empty: false,
    current_entity: null,
    logEntries: [],
    collision: null,
    assets: createAssetRegistry(),
    sight_client: null,
    sight_entity: null,
    sight_entity_framenum: 0,
    sound_entity: null,
    sound_entity_framenum: 0,
    sound2_entity: null,
    sound2_entity_framenum: 0,
    soundEvents: [],
    cprintfEvents: [],
    centerprintEvents: [],
    tempEntityEvents: [],
    configstrings: new Map<number, string>(),
    playerMuzzleFlashEvents: [],
    monsterMuzzleFlashEvents: [],
    linkedSolidEntities: [],
    linkedTriggerEntities: [],
    linkedInlineBspEntities: [],
    linkedRuntimeTriggerEntities: [],
    linkedDynamicBoxEntities: [],
    playerTrail: createPlayerTrailState(),
    log: (entry) => {
      runtime.logEntries.push({
        ...entry,
        time: runtime.time
      });
    }
  };

  return runtime;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Create a gameplay runtime from one parsed BSP map and enrich brush entities with inline model bounds.
 *
 * Constraints:
 * - Must preserve BSP entity ordering.
 */
export function createGameRuntimeFromBspMap(map: BspMap): GameRuntime {
  const runtime = createGameRuntimeFromBspEntities(map.parsedEntities);
  const worldspawn = runtime.entities[0] ?? null;
  runtime.mapname = worldspawn?.properties.map ?? "";
  runtime.collision = createGameCollisionBridge(map, runtime);

  for (const entity of runtime.entities) {
    applyInlineModelBounds(entity, map);
    if (entity.model?.startsWith("*")) {
      entity.s.modelindex = registerGameModel(runtime, entity.model);
    }
    linkGameEntity(runtime, entity);
  }

  return runtime;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Attach the minimal gameplay client state to one runtime entity.
 *
 * Constraints:
 * - Must preserve existing entity identity and only populate the `client` payload.
 */
export function attachGameClient(entity: GameEntity): GameClient {
  const client = createGameClient();
  entity.client = client;
  entity.s.modelindex = 255;
  return client;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Advance and execute all `think` callbacks scheduled up to one absolute time.
 *
 * Constraints:
 * - Must run in time order to preserve delayed target semantics.
 */
export function runPendingThinks(runtime: GameRuntime, upToTime = Number.POSITIVE_INFINITY): void {
  while (true) {
    const nextEntity = findNextThinkEntity(runtime, upToTime);
    if (!nextEntity || !nextEntity.think) {
      runtime.time = Math.max(runtime.time, Number.isFinite(upToTime) ? upToTime : runtime.time);
      return;
    }

    runtime.time = Math.max(runtime.time, nextEntity.nextthink);
    nextEntity.nextthink = 0;
    const think = nextEntity.think;
    nextEntity.think = undefined;
    runtime.log({
      kind: "think",
      message: `${getRuntimeEntityLabel(nextEntity)} think`,
      entityIndex: nextEntity.index,
      entityClassname: nextEntity.classname
    });
    think(nextEntity, runtime);
  }
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Invoke one entity `use` callback while journaling the activation for verification.
 *
 * Constraints:
 * - Must keep the Quake-style `(self, other, activator)` calling convention.
 */
export function useGameEntity(
  runtime: GameRuntime,
  entity: GameEntity,
  other: GameEntity | null = null,
  activator: GameEntity | null = other
): void {
  runtime.log({
    kind: "use",
    message: `${getRuntimeEntityLabel(entity)} used by ${getRuntimeEntityLabel(activator)}`,
    entityIndex: entity.index,
    entityClassname: entity.classname,
    otherIndex: activator?.index,
    otherClassname: activator?.classname
  });

  entity.use?.(entity, other, activator, runtime);
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Provide a human-readable label for one runtime entity in verification output.
 *
 * Constraints:
 * - Must remain stable across runs for log diffing.
 */
export function getRuntimeEntityLabel(entity: GameEntity | null): string {
  if (!entity) {
    return "null";
  }

  const parts = [`#${entity.index}`, entity.classname];
  if (entity.targetname) {
    parts.push(`targetname=${entity.targetname}`);
  }
  if (entity.target) {
    parts.push(`target=${entity.target}`);
  }
  return parts.join(" ");
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Find all currently active entities with one exact `targetname`.
 *
 * Constraints:
 * - Must preserve runtime order.
 */
export function findRuntimeEntitiesByTargetname(runtime: GameRuntime, targetname: string): GameEntity[] {
  return runtime.entities.filter((entity) => entity.inuse && entity.targetname === targetname);
}

/**
 * Original name: Think_Delay
 * Source: game/g_utils.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Dispatches the delayed entity's copied targets through `G_UseTargets`.
 * - Frees the temporary delayed entity immediately after dispatch.
 *
 * Porting notes:
 * - Receives the runtime explicitly instead of relying on Quake II game globals.
 */
export function Think_Delay(ent: GameEntity, runtime: GameRuntime): void {
  G_UseTargets(runtime, ent, ent.activator);
  freeGameEntity(runtime, ent);
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Allocate one new temporary runtime entity appended after the BSP-spawned entity set.
 *
 * Constraints:
 * - Must preserve stable indices for already existing entities.
 */
export function spawnGameEntity(runtime: GameRuntime): GameEntity {
  const state = createEntityState();
  state.number = runtime.entities.length;
  const entity: GameEntity = {
    index: runtime.entities.length,
    inuse: true,
    freetime: -1,
    properties: {},
    classname: "noclass",
    client: null,
    owner: null,
    enemy: null,
    oldenemy: null,
    team: undefined,
    teammaster: null,
    teamchain: null,
    target: undefined,
    targetname: undefined,
    killtarget: undefined,
    pathtarget: undefined,
    deathtarget: undefined,
    combattarget: undefined,
    target_ent: null,
    message: undefined,
    model: undefined,
    spawnflags: 0,
    flags: 0,
    timestamp: 0,
    angle: 0,
    wait: 0,
    speed: 0,
    accel: 0,
    decel: 0,
    sounds: 0,
    noise_index: 0,
    noise_index2: 0,
    solid: SOLID_NOT,
    movetype: MOVETYPE_NONE,
    svflags: 0,
    linkcount: 0,
    area: createAreaLink(),
    num_clusters: 0,
    clusternums: new Int32Array(16),
    linked: false,
    entityKind: "other",
    areanum: 0,
    areanum2: 0,
    clipmask: 0,
    headnode: 0,
    health: 0,
    takedamage: 0,
    max_health: 0,
    mass: 0,
    air_finished: 0,
    gravity: 1,
    deadflag: DEAD_NO,
    gib_health: 0,
    show_hostile: 0,
    dmg: 0,
    radius_dmg: 0,
    dmg_radius: 0,
    pain_debounce_time: 0,
    touch_debounce_time: 0,
    damage_debounce_time: 0,
    fly_sound_debounce_time: 0,
    last_move_time: 0,
    powerarmor_time: 0,
    delay: 0,
    random: 0,
    nextthink: 0,
    activator: null,
    chain: null,
    goalentity: null,
    movetarget: null,
    yaw_speed: 0,
    ideal_yaw: 0,
    use: undefined,
    prethink: undefined,
    think: undefined,
    touch: undefined,
    blocked: undefined,
    die: undefined,
    pain: undefined,
    movedir: [0, 0, 0],
    velocity: [0, 0, 0],
    avelocity: [0, 0, 0],
    origin: [0, 0, 0],
    angles: [0, 0, 0],
    pos1: [0, 0, 0],
    pos2: [0, 0, 0],
    mins: [0, 0, 0],
    maxs: [0, 0, 0],
    absmin: [0, 0, 0],
    absmax: [0, 0, 0],
    size: [0, 0, 0],
    groundentity: null,
    groundentity_linkcount: 0,
    moveinfo: createMoveInfo(),
    s: state,
    count: 0,
    style: 0,
    viewheight: 0,
    map: undefined,
    waterlevel: 0,
    watertype: 0,
    volume: 0,
    attenuation: 0,
    light_level: 0,
    move_origin: [0, 0, 0],
    move_angles: [0, 0, 0],
    power_armor_type: POWER_ARMOR_NONE,
    power_armor_power: 0,
    itemIndex: 0,
    item: null,
    itemClassname: undefined,
    itemPickupName: undefined,
    itemWorldModel: undefined,
    itemWorldModelFlags: 0,
    mynoise: null,
    mynoise2: null,
    teleport_time: 0,
    monsterinfo: createMonsterInfo()
  };

  refreshEntitySpatialState(entity);
  runtime.entities.push(entity);
  return entity;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Mark one runtime entity as freed while keeping its slot available for log references.
 *
 * Constraints:
 * - Must preserve the entity index and freetime for later diagnostics.
 */
export function freeGameEntity(runtime: GameRuntime, entity: GameEntity): void {
  const freedIndex = entity.index;
  unlinkGameEntity(runtime, entity);
  entity.inuse = false;
  entity.freetime = runtime.time;
  entity.nextthink = 0;
  entity.think = undefined;
  entity.use = undefined;
  entity.activator = null;
  entity.blocked = undefined;
  entity.properties = {};
  entity.classname = "freed";
  entity.client = null;
  entity.owner = null;
  entity.enemy = null;
  entity.oldenemy = null;
  entity.team = undefined;
  entity.teammaster = null;
  entity.teamchain = null;
  entity.target = undefined;
  entity.targetname = undefined;
  entity.killtarget = undefined;
  entity.pathtarget = undefined;
  entity.deathtarget = undefined;
  entity.combattarget = undefined;
  entity.target_ent = null;
  entity.message = undefined;
  entity.model = undefined;
  entity.spawnflags = 0;
  entity.flags = 0;
  entity.timestamp = 0;
  entity.angle = 0;
  entity.wait = 0;
  entity.speed = 0;
  entity.accel = 0;
  entity.decel = 0;
  entity.sounds = 0;
  entity.noise_index = 0;
  entity.noise_index2 = 0;
  entity.solid = SOLID_NOT;
  entity.movetype = MOVETYPE_NONE;
  entity.svflags = 0;
  entity.linkcount = 0;
  entity.area = createAreaLink();
  entity.num_clusters = 0;
  entity.clusternums = new Int32Array(16);
  entity.linked = false;
  entity.entityKind = "other";
  entity.areanum = 0;
  entity.areanum2 = 0;
  entity.clipmask = 0;
  entity.headnode = 0;
  entity.health = 0;
  entity.takedamage = 0;
  entity.max_health = 0;
  entity.mass = 0;
  entity.air_finished = 0;
  entity.gravity = 1;
  entity.deadflag = DEAD_NO;
  entity.gib_health = 0;
  entity.show_hostile = 0;
  entity.dmg = 0;
  entity.radius_dmg = 0;
  entity.dmg_radius = 0;
  entity.pain_debounce_time = 0;
  entity.touch_debounce_time = 0;
  entity.damage_debounce_time = 0;
  entity.fly_sound_debounce_time = 0;
  entity.last_move_time = 0;
  entity.powerarmor_time = 0;
  entity.delay = 0;
  entity.random = 0;
  entity.touch = undefined;
  entity.prethink = undefined;
  entity.die = undefined;
  entity.pain = undefined;
  entity.chain = null;
  entity.goalentity = null;
  entity.movetarget = null;
  entity.yaw_speed = 0;
  entity.ideal_yaw = 0;
  entity.movedir = [0, 0, 0];
  entity.velocity = [0, 0, 0];
  entity.avelocity = [0, 0, 0];
  entity.origin = [0, 0, 0];
  entity.angles = [0, 0, 0];
  entity.pos1 = [0, 0, 0];
  entity.pos2 = [0, 0, 0];
  entity.mins = [0, 0, 0];
  entity.maxs = [0, 0, 0];
  entity.absmin = [0, 0, 0];
  entity.absmax = [0, 0, 0];
  entity.size = [0, 0, 0];
  entity.groundentity = null;
  entity.groundentity_linkcount = 0;
  entity.moveinfo = createMoveInfo();
  entity.s = createEntityState();
  entity.s.number = freedIndex;
  entity.count = 0;
  entity.style = 0;
  entity.viewheight = 0;
  entity.map = undefined;
  entity.waterlevel = 0;
  entity.watertype = 0;
  entity.volume = 0;
  entity.attenuation = 0;
  entity.light_level = 0;
  entity.move_origin = [0, 0, 0];
  entity.move_angles = [0, 0, 0];
  entity.power_armor_type = POWER_ARMOR_NONE;
  entity.power_armor_power = 0;
  entity.itemIndex = 0;
  entity.item = null;
  entity.itemClassname = undefined;
  entity.itemPickupName = undefined;
  entity.itemWorldModel = undefined;
  entity.itemWorldModelFlags = 0;
  entity.mynoise = null;
  entity.mynoise2 = null;
  entity.teleport_time = 0;
  entity.monsterinfo = createMonsterInfo();

  runtime.log({
    kind: "entity-freed",
    message: `#${freedIndex} freed`,
    entityIndex: freedIndex,
    entityClassname: "freed"
  });
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Find the next scheduled thinker to execute up to one absolute time limit.
 *
 * Constraints:
 * - Must preserve deterministic entity order when several thinkers share the same frame time.
 */
function findNextThinkEntity(runtime: GameRuntime, upToTime: number): GameEntity | null {
  let nextEntity: GameEntity | null = null;

  for (const entity of runtime.entities) {
    if (!entity || !entity.inuse || !entity.think || entity.nextthink <= 0 || entity.nextthink > upToTime) {
      continue;
    }

    if (!nextEntity || entity.nextthink < nextEntity.nextthink) {
      nextEntity = entity;
    }
  }

  return nextEntity;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Parse one optional float-like BSP property with a zero fallback.
 */
function parseEntityFloat(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Parse one optional integer-like BSP property with a zero fallback.
 */
function parseEntityInteger(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Create the zero-initialized `moveinfo` block used by early door and plat ports.
 */
function createMoveInfo(): GameMoveInfo {
  return {
    start_origin: [0, 0, 0],
    start_angles: [0, 0, 0],
    end_origin: [0, 0, 0],
    end_angles: [0, 0, 0],
    sound_start: 0,
    sound_middle: 0,
    sound_end: 0,
    accel: 0,
    speed: 0,
    decel: 0,
    distance: 0,
    wait: 0,
    state: STATE_BOTTOM,
    dir: [0, 0, 0],
    current_speed: 0,
    move_speed: 0,
    next_speed: 0,
    remaining_distance: 0,
    decel_distance: 0,
    endfunc: undefined
  };
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Create one detached area-link node mirroring the `link_t` storage embedded in `edict_t`.
 */
function createAreaLink(): GameAreaLink {
  return {
    prev: null,
    next: null
  };
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Create the local asset registry used by the early gameplay runtime ports.
 */
function createAssetRegistry(): GameAssetRegistry {
  return {
    modelPaths: [],
    modelIndexByPath: new Map<string, number>(),
    soundPaths: [],
    soundIndexByPath: new Map<string, number>(),
    imagePaths: [],
    imageIndexByPath: new Map<string, number>()
  };
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Create the zero-initialized player-trail state embedded in the gameplay runtime.
 */
function createPlayerTrailState(): GamePlayerTrailState {
  return {
    trail: [],
    trail_head: 0,
    trail_active: false
  };
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Parse one Quake-style origin vector into a numeric tuple with a safe zero fallback.
 */
function parseEntityVector(value: string | undefined): [number, number, number] {
  if (!value) {
    return [0, 0, 0];
  }

  const parts = value.trim().split(/\s+/).map((part) => Number.parseFloat(part));
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    return [0, 0, 0];
  }

  return [parts[0], parts[1], parts[2]];
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Parse the first Quake entity angle conventions into a three-component angle tuple.
 *
 * Constraints:
 * - Must support both `angles` and the shorthand single `angle` yaw field.
 */
function parseEntityAngles(properties: Record<string, string>): [number, number, number] {
  if (properties.angles) {
    const parts = properties.angles.trim().split(/\s+/).map((part) => Number.parseFloat(part));
    if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
      return [parts[0], parts[1], parts[2]];
    }
  }

  if (properties.angle) {
    const yaw = Number.parseFloat(properties.angle);
    if (Number.isFinite(yaw)) {
      return [0, yaw, 0];
    }
  }

  return [0, 0, 0];
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Attach inline BSP model bounds to one runtime brush entity.
 *
 * Constraints:
 * - Must ignore invalid or non-inline model references without failing runtime creation.
 */
function applyInlineModelBounds(entity: GameEntity, map: BspMap): void {
  const model = entity.model;
  if (!model || !model.startsWith("*")) {
    return;
  }

  const modelIndex = Number.parseInt(model.slice(1), 10);
  if (!Number.isFinite(modelIndex) || modelIndex < 0 || modelIndex >= map.models.length) {
    return;
  }

  const inlineModel = map.models[modelIndex];
  entity.headnode = inlineModel.headnode;
  entity.mins = [...inlineModel.mins];
  entity.maxs = [...inlineModel.maxs];
  entity.size = [
    inlineModel.maxs[0] - inlineModel.mins[0],
    inlineModel.maxs[1] - inlineModel.mins[1],
    inlineModel.maxs[2] - inlineModel.mins[2]
  ];
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Attach server collision inline-model bounds while preserving the original `gi.setmodel` effect for brush entities.
 *
 * Constraints:
 * - Must only expose an inline modelindex once gameplay made the brush solid/renderable.
 * - Must ignore unavailable collision state so pure local runtime tests stay independent from the server package.
 */
function applyInlineModelBoundsFromCollision(runtime: GameRuntime, entity: GameEntity, force = false): void {
  const model = entity.model;
  const world = runtime.collision?.world ?? null;
  if (!model?.startsWith("*") || !world) {
    return;
  }

  if (!force && entity.solid === SOLID_NOT && entity.s.modelindex === 0) {
    return;
  }

  let inlineModel: ReturnType<typeof CM_InlineModel> = null;
  try {
    inlineModel = CM_InlineModel(world, model);
  } catch {
    return;
  }

  if (!inlineModel) {
    return;
  }

  entity.headnode = inlineModel.headnode;
  entity.mins = [...inlineModel.mins];
  entity.maxs = [...inlineModel.maxs];
  entity.size = [
    inlineModel.maxs[0] - inlineModel.mins[0],
    inlineModel.maxs[1] - inlineModel.mins[1],
    inlineModel.maxs[2] - inlineModel.mins[2]
  ];

  if (entity.s.modelindex === 0) {
    const modelIndex = Number.parseInt(model.slice(1), 10);
    if (Number.isFinite(modelIndex)) {
      entity.s.modelindex = modelIndex + 1;
    }
  }
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Keep the exported `entity_state_t` fields aligned with the gameplay entity pose and solidity.
 */
function syncEntityStateFromRuntimeEntity(entity: GameEntity): void {
  entity.s.number = entity.index;
  entity.s.old_origin = [...entity.s.origin];
  entity.s.origin = [...entity.origin];
  entity.s.angles = [...entity.angles];
  entity.s.solid = entity.model?.startsWith("*") ? 31 : entity.solid;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Recompute the canonical spatial bounds fields used by later Quake II collision and linking ports.
 *
 * Constraints:
 * - Inline BSP models keep their BSP mins/maxs in world space.
 * - Box entities derive absolute bounds from `origin + mins/maxs`.
 */
export function refreshEntitySpatialState(entity: GameEntity): void {
  updateEntitySize(entity);
  updateEntityAbsoluteBounds(entity);
  syncEntityStateFromRuntimeEntity(entity);
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Register one model path in the local gameplay runtime and return its stable Quake-style index.
 */
export function registerGameModel(runtime: GameRuntime, path: string): number {
  reserveServerModelConfigstrings(runtime);

  if (path.startsWith("*")) {
    const inlineModelIndex = Number.parseInt(path.slice(1), 10);
    if (Number.isFinite(inlineModelIndex) && inlineModelIndex >= 1) {
      const index = inlineModelIndex + 1;
      runtime.assets.modelPaths[index - 1] = path;
      runtime.assets.modelIndexByPath.set(path, index);
      setGameConfigstring(runtime, CS_MODELS + index, path);
      return index;
    }
  }

  const index = registerAssetPath(runtime.assets.modelPaths, runtime.assets.modelIndexByPath, path);
  setGameConfigstring(runtime, CS_MODELS + index, path);
  return index;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Mirror the server-side model table layout before gameplay registers dynamic alias models.
 *
 * Constraints:
 * - Must reserve the world model at index 1 and inline BSP models at index `N + 1`, matching `SV_SpawnServer`.
 * - Must stay inert for pure unit runtimes that have no loaded collision world.
 */
function reserveServerModelConfigstrings(runtime: GameRuntime): void {
  const world = runtime.collision?.world ?? null;
  if (!world || !Array.isArray(world.map_cmodels)) {
    return;
  }

  const modelCount = world.map_cmodels.length;
  if (modelCount <= 0 || runtime.assets.modelPaths.length >= modelCount) {
    return;
  }

  if (runtime.mapname) {
    reserveModelConfigstring(runtime, 1, `maps/${runtime.mapname}.bsp`);
  }

  for (let index = 1; index < modelCount; index += 1) {
    reserveModelConfigstring(runtime, index + 1, `*${index}`);
  }
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Reserve one model configstring slot while keeping the local model table aligned with server indices.
 */
function reserveModelConfigstring(runtime: GameRuntime, index: number, path: string): void {
  const slot = index - 1;
  const existing = runtime.assets.modelPaths[slot];
  if (existing && existing !== path) {
    return;
  }

  runtime.assets.modelPaths[slot] = path;
  runtime.assets.modelIndexByPath.set(path, index);
  setGameConfigstring(runtime, CS_MODELS + index, path);
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Apply the gameplay equivalent of `gi.setmodel` for brush and alias entities.
 *
 * Constraints:
 * - Must register the model into the Quake-style model table.
 * - Must attach inline BSP bounds before spawn code computes movement distances.
 * - Must mirror the original server import by linking inline models immediately when possible.
 */
export function setGameEntityModel(runtime: GameRuntime, entity: GameEntity, path: string): void {
  if (!path) {
    return;
  }

  entity.model = path;
  entity.s.modelindex = registerGameModel(runtime, path);

  if (!path.startsWith("*")) {
    return;
  }

  applyInlineModelBoundsFromCollision(runtime, entity, true);
  refreshEntitySpatialState(entity);
  if (runtime.collision?.world) {
    linkGameEntity(runtime, entity);
  }
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Register one sound path in the local gameplay runtime and return its stable Quake-style index.
 */
export function registerGameSound(runtime: GameRuntime, path: string): number {
  const index = registerAssetPath(runtime.assets.soundPaths, runtime.assets.soundIndexByPath, path);
  setGameConfigstring(runtime, CS_SOUNDS + index, path);
  return index;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Queue one gameplay-side one-shot sound event while registering its Quake-style sound index.
 *
 * Constraints:
 * - Must preserve emission order within one frame.
 */
export function emitGameSound(runtime: GameRuntime, entity: GameEntity | null, path: string): number {
  const soundIndex = registerGameSound(runtime, path);
  runtime.soundEvents.push({
    frame: runtime.framenum,
    entity,
    entityIndex: entity?.index ?? null,
    soundIndex,
    soundPath: path
  });
  return soundIndex;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Queue one sound event that already has a stable Quake-style sound index and optional server playback metadata.
 */
export function emitRegisteredGameSound(
  runtime: GameRuntime,
  entity: GameEntity | null,
  soundIndex: number,
  soundPath: string,
  options: {
    origin?: vec3_t | null;
    channel?: number;
    volume?: number;
    attenuation?: number;
    timeofs?: number;
  } = {}
): void {
  const event: GameSoundEvent = {
    frame: runtime.framenum,
    entity,
    entityIndex: entity?.index ?? null,
    soundIndex,
    soundPath
  };

  if (options.origin !== undefined) {
    event.origin = options.origin ? [...options.origin] : null;
  }
  if (options.channel !== undefined) {
    event.channel = options.channel;
  }
  if (options.volume !== undefined) {
    event.volume = options.volume;
  }
  if (options.attenuation !== undefined) {
    event.attenuation = options.attenuation;
  }
  if (options.timeofs !== undefined) {
    event.timeofs = options.timeofs;
  }

  runtime.soundEvents.push(event);
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Queue one temp-entity event from gameplay code while preserving multicast metadata for the server bridge.
 */
export function emitGameTempEntity(
  runtime: GameRuntime,
  type: temp_event_t,
  origin: vec3_t,
  multicast: multicast_t,
  payload: Record<string, unknown> = {}
): void {
  runtime.tempEntityEvents.push({
    frame: runtime.framenum,
    type,
    origin: [...origin],
    multicast,
    payload
  });
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Store one gameplay-originated configstring update until a server/client bridge consumes it.
 */
export function setGameConfigstring(runtime: GameRuntime, index: number, value: string): void {
  runtime.configstrings.set(index, value);
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Drain queued gameplay temp-entity events in FIFO order for a server/client bridge.
 */
export function drainGameTempEntityEvents(runtime: GameRuntime): GameTempEntityEvent[] {
  const events = runtime.tempEntityEvents.slice();
  runtime.tempEntityEvents.length = 0;
  return events;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Drain gameplay configstring updates while preserving the latest value per index.
 */
export function drainGameConfigstringUpdates(runtime: GameRuntime): GameConfigstringUpdate[] {
  const updates = Array.from(runtime.configstrings, ([index, value]) => ({ index, value }));
  runtime.configstrings.clear();
  return updates;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Drain the queued gameplay one-shot sound events accumulated since the previous consumer pass.
 *
 * Constraints:
 * - Must preserve FIFO ordering.
 */
export function drainGameSoundEvents(runtime: GameRuntime): GameSoundEvent[] {
  const events = runtime.soundEvents.slice();
  runtime.soundEvents.length = 0;
  return events;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Queue one gameplay-side client print event while preserving the original `gi.cprintf` target semantics.
 */
export function emitGameCprintf(runtime: GameRuntime, entity: GameEntity | null, printlevel: number, message: string): void {
  runtime.cprintfEvents.push({
    frame: runtime.framenum,
    entity,
    entityIndex: entity?.index ?? null,
    printlevel,
    message
  });
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Drain queued gameplay client print events in FIFO order for a server/client bridge.
 */
export function drainGameCprintfEvents(runtime: GameRuntime): GameCprintfEvent[] {
  const events = runtime.cprintfEvents.slice();
  runtime.cprintfEvents.length = 0;
  return events;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Queue one gameplay-side centerprint event while preserving the original `gi.centerprintf` target semantics.
 */
export function emitGameCenterprint(runtime: GameRuntime, entity: GameEntity | null, message: string): void {
  runtime.centerprintEvents.push({
    frame: runtime.framenum,
    entity,
    entityIndex: entity?.index ?? null,
    message
  });
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Drain queued gameplay centerprint events in FIFO order for a server/client bridge.
 */
export function drainGameCenterprintEvents(runtime: GameRuntime): GameCenterprintEvent[] {
  const events = runtime.centerprintEvents.slice();
  runtime.centerprintEvents.length = 0;
  return events;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Queue one gameplay-side player muzzleflash event while preserving the original weapon bitfield.
 *
 * Constraints:
 * - Must preserve emission order within one frame.
 */
export function emitPlayerMuzzleFlash(runtime: GameRuntime, entity: GameEntity, weapon: number): void {
  runtime.playerMuzzleFlashEvents.push({
    frame: runtime.framenum,
    entityIndex: entity.index,
    weapon
  });
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Drain the queued gameplay player muzzleflash events accumulated since the previous consumer pass.
 *
 * Constraints:
 * - Must preserve FIFO ordering.
 */
export function drainPlayerMuzzleFlashEvents(runtime: GameRuntime): GamePlayerMuzzleFlashEvent[] {
  const events = runtime.playerMuzzleFlashEvents.slice();
  runtime.playerMuzzleFlashEvents.length = 0;
  return events;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Queue one gameplay-side monster muzzleflash event while preserving the original `MZ2_*` id.
 *
 * Constraints:
 * - Must preserve emission order within one frame.
 */
export function emitMonsterMuzzleFlash(runtime: GameRuntime, entity: GameEntity, origin: vec3_t, flashNumber: number): void {
  runtime.monsterMuzzleFlashEvents.push({
    frame: runtime.framenum,
    entityIndex: entity.index,
    flashNumber,
    origin: [...origin]
  });
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Drain queued gameplay monster muzzleflash events accumulated since the previous consumer pass.
 *
 * Constraints:
 * - Must preserve FIFO ordering.
 */
export function drainMonsterMuzzleFlashEvents(runtime: GameRuntime): GameMonsterMuzzleFlashEvent[] {
  const events = runtime.monsterMuzzleFlashEvents.slice();
  runtime.monsterMuzzleFlashEvents.length = 0;
  return events;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Register one image path in the local gameplay runtime and return its stable Quake-style index.
 */
export function registerGameImage(runtime: GameRuntime, path: string): number {
  const engineIndex = runtime.engineImageIndex?.(path);
  if (engineIndex && engineIndex > 0) {
    runtime.assets.imagePaths[engineIndex - 1] = path;
    runtime.assets.imageIndexByPath.set(path, engineIndex);
    return engineIndex;
  }

  const index = registerAssetPath(runtime.assets.imagePaths, runtime.assets.imageIndexByPath, path);
  setGameConfigstring(runtime, CS_IMAGES + index, path);
  return index;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Link one gameplay entity into the runtime spatial query lists.
 *
 * Constraints:
 * - Must refresh absolute bounds before exposure to queries.
 * - Must preserve Quake II style `linkcount` updates on each relink.
 */
export function linkGameEntity(runtime: GameRuntime, entity: GameEntity): void {
  unlinkGameEntity(runtime, entity);
  applyInlineModelBoundsFromCollision(runtime, entity);
  refreshEntitySpatialState(entity);
  entity.entityKind = classifyGameEntity(entity);
  entity.linked = true;
  entity.linkcount += 1;

  if (entity.solid === SOLID_TRIGGER) {
    runtime.linkedTriggerEntities.push(entity);
    runtime.linkedRuntimeTriggerEntities.push(entity);
    runtime.engineLinkEntity?.(entity);
    return;
  }

  if (entity.solid !== SOLID_NOT) {
    runtime.linkedSolidEntities.push(entity);
    if (entity.entityKind === "inline_bsp") {
      runtime.linkedInlineBspEntities.push(entity);
      runtime.engineLinkEntity?.(entity);
      return;
    }
    if (entity.entityKind === "dynamic_box") {
      runtime.linkedDynamicBoxEntities.push(entity);
    }
  }

  runtime.engineLinkEntity?.(entity);
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Unlink one gameplay entity from the runtime spatial query lists.
 *
 * Constraints:
 * - Must tolerate repeated unlinks.
 */
export function unlinkGameEntity(runtime: GameRuntime, entity: GameEntity): void {
  removeLinkedEntity(runtime.linkedSolidEntities, entity);
  removeLinkedEntity(runtime.linkedTriggerEntities, entity);
  removeLinkedEntity(runtime.linkedInlineBspEntities, entity);
  removeLinkedEntity(runtime.linkedRuntimeTriggerEntities, entity);
  removeLinkedEntity(runtime.linkedDynamicBoxEntities, entity);
  runtime.engineUnlinkEntity?.(entity);
  entity.linked = false;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Return the currently linked entities overlapping one world-space bounds box.
 *
 * Constraints:
 * - Must preserve runtime link order.
 * - Must support trigger and solid queries with the original area type split.
 */
export function BoxEdicts(
  runtime: GameRuntime,
  mins: [number, number, number],
  maxs: [number, number, number],
  areaType: number
): GameEntity[] {
  const source = areaType === AREA_TRIGGERS ? runtime.linkedTriggerEntities : runtime.linkedSolidEntities;
  const matches: GameEntity[] = [];

  for (const entity of source) {
    if (!entity.inuse || !entity.linked) {
      continue;
    }

    if (!boundsOverlap(mins, maxs, entity.absmin, entity.absmax)) {
      continue;
    }

    matches.push(entity);
  }

  return matches;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Classify one gameplay entity into the runtime collision buckets used by spatial linking.
 */
export function classifyGameEntity(entity: GameEntity): GameEntityKind {
  if (isRuntimeTriggerEntity(entity)) {
    return "runtime_trigger";
  }

  if (isInlineBspEntity(entity)) {
    return "inline_bsp";
  }

  if (isDynamicBoxEntity(entity)) {
    return "dynamic_box";
  }

  return "other";
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Identify one BSP inline model entity from the current runtime shape.
 */
export function isInlineBspEntity(entity: GameEntity): boolean {
  return Boolean(entity.model?.startsWith("*"));
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Identify one runtime trigger entity.
 */
export function isRuntimeTriggerEntity(entity: GameEntity): boolean {
  return entity.solid === SOLID_TRIGGER;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Identify one dynamic box-style entity distinct from BSP brush models and triggers.
 */
export function isDynamicBoxEntity(entity: GameEntity): boolean {
  return entity.solid !== SOLID_NOT && entity.solid !== SOLID_TRIGGER && !isInlineBspEntity(entity);
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Recompute one entity `size` from its current mins and maxs.
 */
function updateEntitySize(entity: GameEntity): void {
  entity.size = [
    entity.maxs[0] - entity.mins[0],
    entity.maxs[1] - entity.mins[1],
    entity.maxs[2] - entity.mins[2]
  ];
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Recompute one entity absolute world bounds from its current runtime shape.
 */
function updateEntityAbsoluteBounds(entity: GameEntity): void {
  entity.absmin = [
    entity.origin[0] + entity.mins[0],
    entity.origin[1] + entity.mins[1],
    entity.origin[2] + entity.mins[2]
  ];
  entity.absmax = [
    entity.origin[0] + entity.maxs[0],
    entity.origin[1] + entity.maxs[1],
    entity.origin[2] + entity.maxs[2]
  ];
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Register one path in a local Quake-style asset table while preserving stable 1-based indices.
 */
function registerAssetPath(paths: string[], indices: Map<string, number>, path: string): number {
  const existing = indices.get(path);
  if (existing !== undefined) {
    return existing;
  }

  const index = paths.length + 1;
  paths.push(path);
  indices.set(path, index);
  return index;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Remove one entity reference from a linked runtime list.
 */
function removeLinkedEntity(list: GameEntity[], entity: GameEntity): void {
  const index = list.indexOf(entity);
  if (index >= 0) {
    list.splice(index, 1);
  }
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Test whether two axis-aligned bounds boxes overlap.
 */
function boundsOverlap(
  leftMins: [number, number, number],
  leftMaxs: [number, number, number],
  rightMins: [number, number, number],
  rightMaxs: [number, number, number]
): boolean {
  return !(
    leftMaxs[0] <= rightMins[0] ||
    leftMins[0] >= rightMaxs[0] ||
    leftMaxs[1] <= rightMins[1] ||
    leftMins[1] >= rightMaxs[1] ||
    leftMaxs[2] <= rightMins[2] ||
    leftMins[2] >= rightMaxs[2]
  );
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Build the gameplay collision bridge consumed by the `g_phys` ports.
 *
 * Constraints:
 * - Must use shared qcommon collision for worldspawn and inline BSP models.
 * - Must supplement it with linked runtime dynamic-box testing.
 */
function createGameCollisionBridge(map: BspMap, runtime: GameRuntime): GameCollisionBridge {
  const world = createCollisionWorld(map);

  return {
    world,
    trace: (start, mins, maxs, end, passent, contentmask) => traceAgainstGameWorld(runtime, world, start, mins, maxs, end, passent, contentmask),
    pointcontents: (point, passent) => pointContentsAgainstGameWorld(runtime, world, point, passent ?? null)
  };
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Resolve one gameplay trace against the world, transformed inline BSP entities and linked dynamic boxes.
 */
function traceAgainstGameWorld(
  runtime: GameRuntime,
  world: CollisionWorld,
  start: vec3_t,
  mins: vec3_t,
  maxs: vec3_t,
  end: vec3_t,
  passent: GameEntity | null,
  contentmask: number
): trace_t {
  const worldspawn = runtime.entities[0] ?? null;
  let bestTrace = CM_BoxTrace(world, start, end, mins, maxs, 0, contentmask);

  if (bestTrace.allsolid || bestTrace.startsolid || bestTrace.fraction < 1) {
    bestTrace.ent = worldspawn;
  } else {
    bestTrace.ent = null;
  }

  for (const entity of runtime.linkedInlineBspEntities) {
    if (!entity.inuse || entity === passent) {
      continue;
    }

    const trace = CM_TransformedBoxTrace(
      world,
      start,
      end,
      mins,
      maxs,
      entity.headnode,
      contentmask,
      entity.origin,
      entity.angles
    );
    trace.ent = entity;
    bestTrace = mergeGameplayTrace(bestTrace, trace);
  }

  for (const entity of runtime.linkedDynamicBoxEntities) {
    if (!entity.inuse || entity === passent) {
      continue;
    }

    const trace = traceAgainstDynamicBox(start, end, mins, maxs, entity);
    if (!trace) {
      continue;
    }

    trace.ent = entity;
    bestTrace = mergeGameplayTrace(bestTrace, trace);
  }

  return bestTrace;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Resolve point contents across the gameplay world and linked transformed inline BSP entities.
 */
function pointContentsAgainstGameWorld(
  runtime: GameRuntime,
  world: CollisionWorld,
  point: vec3_t,
  passent: GameEntity | null
): number {
  let contents = CM_PointContents(world, point, 0);

  for (const entity of runtime.linkedInlineBspEntities) {
    if (!entity.inuse || entity === passent) {
      continue;
    }

    contents |= CM_TransformedPointContents(world, point, entity.headnode, entity.origin, entity.angles);
  }

  for (const entity of runtime.linkedDynamicBoxEntities) {
    if (!entity.inuse || entity === passent) {
      continue;
    }

    if (pointInsideBounds(point, entity.absmin, entity.absmax)) {
      contents |= MASK_SOLID;
    }
  }

  return contents;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Choose the earliest blocking trace while preserving Quake II startsolid propagation.
 */
function mergeGameplayTrace(bestTrace: trace_t, candidate: trace_t): trace_t {
  if (candidate.allsolid || candidate.startsolid || candidate.fraction < bestTrace.fraction) {
    if (bestTrace.startsolid) {
      candidate.startsolid = true;
    }
    return candidate;
  }

  if (candidate.startsolid) {
    bestTrace.startsolid = true;
  }

  return bestTrace;
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Trace one moving AABB against one linked dynamic-box entity using the swept AABB equivalent used by the runtime bridge.
 */
function traceAgainstDynamicBox(
  start: vec3_t,
  end: vec3_t,
  mins: vec3_t,
  maxs: vec3_t,
  entity: GameEntity
): trace_t | null {
  const expandedMins: vec3_t = [
    entity.absmin[0] - maxs[0],
    entity.absmin[1] - maxs[1],
    entity.absmin[2] - maxs[2]
  ];
  const expandedMaxs: vec3_t = [
    entity.absmax[0] - mins[0],
    entity.absmax[1] - mins[1],
    entity.absmax[2] - mins[2]
  ];

  if (pointInsideBounds(start, expandedMins, expandedMaxs)) {
    return {
      allsolid: true,
      startsolid: true,
      fraction: 0,
      endpos: [...start],
      plane: createDefaultTracePlane(),
      surface: null,
      contents: MASK_SOLID,
      ent: entity
    };
  }

  const delta: vec3_t = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
  let enterFraction = 0;
  let leaveFraction = 1;
  let hitAxis = -1;
  let hitNormalSign = 0;

  for (let axis = 0; axis < 3; axis += 1) {
    const startValue = start[axis];
    const endValue = end[axis];
    const minValue = expandedMins[axis];
    const maxValue = expandedMaxs[axis];

    if (delta[axis] === 0) {
      if (startValue < minValue || startValue > maxValue) {
        return null;
      }
      continue;
    }

    const inverseDelta = 1 / delta[axis];
    let near = (minValue - startValue) * inverseDelta;
    let far = (maxValue - startValue) * inverseDelta;
    let nearNormalSign = -1;

    if (near > far) {
      const swap = near;
      near = far;
      far = swap;
      nearNormalSign = 1;
    }

    if (near > enterFraction) {
      enterFraction = near;
      hitAxis = axis;
      hitNormalSign = nearNormalSign;
    }
    leaveFraction = Math.min(leaveFraction, far);

    if (enterFraction > leaveFraction) {
      return null;
    }
  }

  if (hitAxis < 0 || enterFraction < 0 || enterFraction > 1) {
    return null;
  }

  const tracePlane = createDefaultTracePlane();
  tracePlane.normal[hitAxis] = hitNormalSign;

  return {
    allsolid: false,
    startsolid: false,
    fraction: enterFraction,
    endpos: [
      start[0] + delta[0] * enterFraction,
      start[1] + delta[1] * enterFraction,
      start[2] + delta[2] * enterFraction
    ],
    plane: tracePlane,
    surface: null,
    contents: MASK_SOLID,
    ent: entity
  };
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Test whether one point lies inside one inclusive axis-aligned bounds box.
 */
function pointInsideBounds(point: vec3_t, mins: vec3_t, maxs: vec3_t): boolean {
  return (
    point[0] >= mins[0] && point[0] <= maxs[0] &&
    point[1] >= mins[1] && point[1] <= maxs[1] &&
    point[2] >= mins[2] && point[2] <= maxs[2]
  );
}

/**
 * Original name: N/A
 * Source: N/A (game runtime adapter)
 * Category: New
 * Purpose: Build the neutral miss plane used by synthetic dynamic-box traces.
 */
function createDefaultTracePlane(): trace_t["plane"] {
  return {
    normal: [0, 0, 0],
    dist: 0,
    type: 0,
    signbits: 0,
    pad: [0, 0]
  };
}
