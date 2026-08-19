/**
 * File: q_shared.ts
 * Original name: q_shared.h declarations
 * Source: Quake-2-master/game/q_shared.h
 * Category: Ported
 * Purpose: Port the shared Quake II constants and data structures used across runtime modules.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses TypeScript tuples and interfaces instead of C arrays and structs.
 * - Uses JavaScript numbers for scalar C numeric types.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

export type byte = number;
export type qboolean = boolean;
export type vec_t = number;
export type vec3_t = [number, number, number];
export type vec5_t = [number, number, number, number, number];
export type fixed4_t = number;
export type fixed8_t = number;
export type fixed16_t = number;

export const M_PI = 3.14159265358979323846;
export const nanmask = 255 << 23;

/**
 * Original name: IS_NAN
 * Source: game/q_shared.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Tests whether a numeric value is a NaN value.
 *
 * Porting notes:
 * - JavaScript does not expose the original C float aliasing macro, so this uses the native NaN check.
 */
export function IS_NAN(value: number): boolean {
  return Number.isNaN(value);
}

/**
 * Original name: Q_ftol
 * Source: game/q_shared.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Converts a floating-point value to a C `long` by truncating toward zero.
 */
export function Q_ftol(value: number): number {
  return Math.trunc(value);
}

export const PITCH = 0;
export const YAW = 1;
export const ROLL = 2;

export const MAX_STRING_CHARS = 1024;
export const MAX_STRING_TOKENS = 80;
export const MAX_TOKEN_CHARS = 128;
export const MAX_QPATH = 64;
export const MAX_OSPATH = 128;
export const MAX_CLIENTS = 256;
export const MAX_EDICTS = 1024;
export const MAX_LIGHTSTYLES = 256;
export const MAX_MODELS = 256;
export const MAX_SOUNDS = 256;
export const MAX_IMAGES = 256;
export const MAX_ITEMS = 256;
export const MAX_GENERAL = MAX_CLIENTS * 2;

/**
 * Original name: MAX_MAP_AREAS
 * Source: qcommon/qfiles.h
 * Category: Adapter
 * Fidelity level: Strict
 *
 * Behavior:
 * - Mirrors the BSP area limit used to size shared client and server areabits buffers.
 *
 * Porting notes:
 * - The qfiles owner remains packages/formats/src/qfiles.ts; this duplicate keeps qcommon free of a formats dependency.
 */
export const MAX_MAP_AREAS = 256;

export const PRINT_LOW = 0;
export const PRINT_MEDIUM = 1;
export const PRINT_HIGH = 2;
export const PRINT_CHAT = 3;
export const ERR_FATAL = 0;
export const ERR_DROP = 1;
export const ERR_DISCONNECT = 2;

/**
 * Original names: PRINT_ALL, PRINT_DEVELOPER
 * Source: qcommon/qcommon.h and game/q_shared.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines the common print routing levels used by qcommon, ref_gl and renderer adapters.
 *
 * Porting notes:
 * - Kept with the shared print constants because the C headers duplicate these values.
 */
export const PRINT_ALL = 0;
export const PRINT_DEVELOPER = 1;
export const PRINT_ALERT = 2;

export enum multicast_t {
  MULTICAST_ALL,
  MULTICAST_PHS,
  MULTICAST_PVS,
  MULTICAST_ALL_R,
  MULTICAST_PHS_R,
  MULTICAST_PVS_R
}

export const MAX_INFO_KEY = 64;
export const MAX_INFO_VALUE = 64;
export const MAX_INFO_STRING = 512;

export const SFF_ARCH = 0x01;
export const SFF_HIDDEN = 0x02;
export const SFF_RDONLY = 0x04;
export const SFF_SUBDIR = 0x08;
export const SFF_SYSTEM = 0x10;

export const CONTENTS_SOLID = 1;
export const CONTENTS_WINDOW = 2;
export const CONTENTS_AUX = 4;
export const CONTENTS_LAVA = 8;
export const CONTENTS_SLIME = 16;
export const CONTENTS_WATER = 32;
export const CONTENTS_MIST = 64;
export const LAST_VISIBLE_CONTENTS = 64;
export const CONTENTS_AREAPORTAL = 0x8000;
export const CONTENTS_PLAYERCLIP = 0x10000;
export const CONTENTS_MONSTERCLIP = 0x20000;
export const CONTENTS_CURRENT_0 = 0x40000;
export const CONTENTS_CURRENT_90 = 0x80000;
export const CONTENTS_CURRENT_180 = 0x100000;
export const CONTENTS_CURRENT_270 = 0x200000;
export const CONTENTS_CURRENT_UP = 0x400000;
export const CONTENTS_CURRENT_DOWN = 0x800000;
export const CONTENTS_ORIGIN = 0x1000000;
export const CONTENTS_MONSTER = 0x2000000;
export const CONTENTS_DEADMONSTER = 0x4000000;
export const CONTENTS_DETAIL = 0x8000000;
export const CONTENTS_TRANSLUCENT = 0x10000000;
export const CONTENTS_LADDER = 0x20000000;

export const SURF_LIGHT = 0x1;
export const SURF_SLICK = 0x2;
export const SURF_SKY = 0x4;
export const SURF_WARP = 0x8;
export const SURF_TRANS33 = 0x10;
export const SURF_TRANS66 = 0x20;
export const SURF_FLOWING = 0x40;
export const SURF_NODRAW = 0x80;

export const MASK_ALL = -1;
export const MASK_SOLID = CONTENTS_SOLID | CONTENTS_WINDOW;
export const MASK_PLAYERSOLID = CONTENTS_SOLID | CONTENTS_PLAYERCLIP | CONTENTS_WINDOW | CONTENTS_MONSTER;
export const MASK_DEADSOLID = CONTENTS_SOLID | CONTENTS_PLAYERCLIP | CONTENTS_WINDOW;
export const MASK_MONSTERSOLID = CONTENTS_SOLID | CONTENTS_MONSTERCLIP | CONTENTS_WINDOW | CONTENTS_MONSTER;
export const MASK_WATER = CONTENTS_WATER | CONTENTS_LAVA | CONTENTS_SLIME;
export const MASK_OPAQUE = CONTENTS_SOLID | CONTENTS_SLIME | CONTENTS_LAVA;
export const MASK_SHOT = CONTENTS_SOLID | CONTENTS_MONSTER | CONTENTS_WINDOW | CONTENTS_DEADMONSTER;
export const MASK_CURRENT =
  CONTENTS_CURRENT_0 |
  CONTENTS_CURRENT_90 |
  CONTENTS_CURRENT_180 |
  CONTENTS_CURRENT_270 |
  CONTENTS_CURRENT_UP |
  CONTENTS_CURRENT_DOWN;

export const AREA_SOLID = 1;
export const AREA_TRIGGERS = 2;

export interface cplane_t {
  normal: vec3_t;
  dist: number;
  type: byte;
  signbits: byte;
  pad: [byte, byte];
}

export const CPLANE_NORMAL_X = 0;
export const CPLANE_NORMAL_Y = 4;
export const CPLANE_NORMAL_Z = 8;
export const CPLANE_DIST = 12;
export const CPLANE_TYPE = 16;
export const CPLANE_SIGNBITS = 17;
export const CPLANE_PAD0 = 18;
export const CPLANE_PAD1 = 19;

export interface cmodel_t {
  mins: vec3_t;
  maxs: vec3_t;
  origin: vec3_t;
  headnode: number;
}

export interface csurface_t {
  name: string;
  flags: number;
  value: number;
}

export interface mapsurface_t {
  c: csurface_t;
  rname: string;
}

export interface trace_t {
  allsolid: qboolean;
  startsolid: qboolean;
  fraction: number;
  endpos: vec3_t;
  plane: cplane_t;
  surface: csurface_t | null;
  contents: number;
  ent: unknown;
}

export enum pmtype_t {
  PM_NORMAL,
  PM_SPECTATOR,
  PM_DEAD,
  PM_GIB,
  PM_FREEZE
}

export const PMF_DUCKED = 1;
export const PMF_JUMP_HELD = 2;
export const PMF_ON_GROUND = 4;
export const PMF_TIME_WATERJUMP = 8;
export const PMF_TIME_LAND = 16;
export const PMF_TIME_TELEPORT = 32;
export const PMF_NO_PREDICTION = 64;

export interface pmove_state_t {
  pm_type: pmtype_t;
  origin: [number, number, number];
  velocity: [number, number, number];
  pm_flags: byte;
  pm_time: byte;
  gravity: number;
  delta_angles: [number, number, number];
}

export const BUTTON_ATTACK = 1;
export const BUTTON_USE = 2;
export const BUTTON_ANY = 128;

export interface usercmd_t {
  msec: byte;
  buttons: byte;
  angles: [number, number, number];
  forwardmove: number;
  sidemove: number;
  upmove: number;
  impulse: byte;
  lightlevel: byte;
}

export const MAXTOUCH = 32;

export interface pmove_t {
  s: pmove_state_t;
  cmd: usercmd_t;
  snapinitial: qboolean;
  numtouch: number;
  touchents: unknown[];
  viewangles: vec3_t;
  viewheight: number;
  mins: vec3_t;
  maxs: vec3_t;
  groundentity: unknown;
  watertype: number;
  waterlevel: number;
  trace: ((start: vec3_t, mins: vec3_t, maxs: vec3_t, end: vec3_t) => trace_t) | null;
  pointcontents: ((point: vec3_t) => number) | null;
}

export const EF_ROTATE = 0x00000001;
export const EF_GIB = 0x00000002;
export const EF_BLASTER = 0x00000008;
export const EF_ROCKET = 0x00000010;
export const EF_GRENADE = 0x00000020;
export const EF_HYPERBLASTER = 0x00000040;
export const EF_BFG = 0x00000080;
export const EF_COLOR_SHELL = 0x00000100;
export const EF_POWERSCREEN = 0x00000200;
export const EF_ANIM01 = 0x00000400;
export const EF_ANIM23 = 0x00000800;
export const EF_ANIM_ALL = 0x00001000;
export const EF_ANIM_ALLFAST = 0x00002000;
export const EF_FLIES = 0x00004000;
export const EF_QUAD = 0x00008000;
export const EF_PENT = 0x00010000;
export const EF_TELEPORTER = 0x00020000;
export const EF_FLAG1 = 0x00040000;
export const EF_FLAG2 = 0x00080000;
export const EF_IONRIPPER = 0x00100000;
export const EF_GREENGIB = 0x00200000;
export const EF_BLUEHYPERBLASTER = 0x00400000;
export const EF_SPINNINGLIGHTS = 0x00800000;
export const EF_PLASMA = 0x01000000;
export const EF_TRAP = 0x02000000;
export const EF_TRACKER = 0x04000000;
export const EF_DOUBLE = 0x08000000;
export const EF_SPHERETRANS = 0x10000000;
export const EF_TAGTRAIL = 0x20000000;
export const EF_HALF_DAMAGE = 0x40000000;
export const EF_TRACKERTRAIL = 0x80000000;

export const RF_MINLIGHT = 1;
export const RF_VIEWERMODEL = 2;
export const RF_WEAPONMODEL = 4;
export const RF_FULLBRIGHT = 8;
export const RF_DEPTHHACK = 16;
export const RF_TRANSLUCENT = 32;
export const RF_FRAMELERP = 64;
export const RF_BEAM = 128;
export const RF_CUSTOMSKIN = 256;
export const RF_GLOW = 512;
export const RF_SHELL_RED = 1024;
export const RF_SHELL_GREEN = 2048;
export const RF_SHELL_BLUE = 4096;
export const RF_IR_VISIBLE = 0x00008000;
export const RF_SHELL_DOUBLE = 0x00010000;
export const RF_SHELL_HALF_DAM = 0x00020000;
export const RF_USE_DISGUISE = 0x00040000;

export const RDF_UNDERWATER = 1;
export const RDF_NOWORLDMODEL = 2;
export const RDF_IRGOGGLES = 4;
export const RDF_UVGOGGLES = 8;

/**
 * Original name: MZ_*
 * Source: game/q_shared.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines the player muzzle-flash ids carried by `svc_muzzleflash`.
 *
 * Porting notes:
 * - Preserves the original numeric values, including reserved gaps and `MZ_SILENCED` bit usage.
 */
export const MZ_BLASTER = 0;
export const MZ_MACHINEGUN = 1;
export const MZ_SHOTGUN = 2;
export const MZ_CHAINGUN1 = 3;
export const MZ_CHAINGUN2 = 4;
export const MZ_CHAINGUN3 = 5;
export const MZ_RAILGUN = 6;
export const MZ_ROCKET = 7;
export const MZ_GRENADE = 8;
export const MZ_LOGIN = 9;
export const MZ_LOGOUT = 10;
export const MZ_RESPAWN = 11;
export const MZ_BFG = 12;
export const MZ_SSHOTGUN = 13;
export const MZ_HYPERBLASTER = 14;
export const MZ_ITEMRESPAWN = 15;
export const MZ_IONRIPPER = 16;
export const MZ_BLUEHYPERBLASTER = 17;
export const MZ_PHALANX = 18;
export const MZ_ETF_RIFLE = 30;
export const MZ_UNUSED = 31;
export const MZ_SHOTGUN2 = 32;
export const MZ_HEATBEAM = 33;
export const MZ_BLASTER2 = 34;
export const MZ_TRACKER = 35;
export const MZ_NUKE1 = 36;
export const MZ_NUKE2 = 37;
export const MZ_NUKE4 = 38;
export const MZ_NUKE8 = 39;
export const MZ_SILENCED = 128;

export enum temp_event_t {
  TE_GUNSHOT,
  TE_BLOOD,
  TE_BLASTER,
  TE_RAILTRAIL,
  TE_SHOTGUN,
  TE_EXPLOSION1,
  TE_EXPLOSION2,
  TE_ROCKET_EXPLOSION,
  TE_GRENADE_EXPLOSION,
  TE_SPARKS,
  TE_SPLASH,
  TE_BUBBLETRAIL,
  TE_SCREEN_SPARKS,
  TE_SHIELD_SPARKS,
  TE_BULLET_SPARKS,
  TE_LASER_SPARKS,
  TE_PARASITE_ATTACK,
  TE_ROCKET_EXPLOSION_WATER,
  TE_GRENADE_EXPLOSION_WATER,
  TE_MEDIC_CABLE_ATTACK,
  TE_BFG_EXPLOSION,
  TE_BFG_BIGEXPLOSION,
  TE_BOSSTPORT,
  TE_BFG_LASER,
  TE_GRAPPLE_CABLE,
  TE_WELDING_SPARKS,
  TE_GREENBLOOD,
  TE_BLUEHYPERBLASTER,
  TE_PLASMA_EXPLOSION,
  TE_TUNNEL_SPARKS,
  TE_BLASTER2,
  TE_RAILTRAIL2,
  TE_FLAME,
  TE_LIGHTNING,
  TE_DEBUGTRAIL,
  TE_PLAIN_EXPLOSION,
  TE_FLASHLIGHT,
  TE_FORCEWALL,
  TE_HEATBEAM,
  TE_MONSTER_HEATBEAM,
  TE_STEAM,
  TE_BUBBLETRAIL2,
  TE_MOREBLOOD,
  TE_HEATBEAM_SPARKS,
  TE_HEATBEAM_STEAM,
  TE_CHAINFIST_SMOKE,
  TE_ELECTRIC_SPARKS,
  TE_TRACKER_EXPLOSION,
  TE_TELEPORT_EFFECT,
  TE_DBALL_GOAL,
  TE_WIDOWBEAMOUT,
  TE_NUKEBLAST,
  TE_WIDOWSPLASH,
  TE_EXPLOSION1_BIG,
  TE_EXPLOSION1_NP,
  TE_FLECHETTE
}

export const CHAN_AUTO = 0;
export const CHAN_WEAPON = 1;
export const CHAN_VOICE = 2;
export const CHAN_ITEM = 3;
export const CHAN_BODY = 4;
export const CHAN_NO_PHS_ADD = 8;
export const CHAN_RELIABLE = 16;

export const ATTN_NONE = 0;
export const ATTN_NORM = 1;
export const ATTN_IDLE = 2;
export const ATTN_STATIC = 3;

export const SPLASH_UNKNOWN = 0;
export const SPLASH_SPARKS = 1;
export const SPLASH_BLUE_WATER = 2;
export const SPLASH_BROWN_WATER = 3;
export const SPLASH_SLIME = 4;
export const SPLASH_LAVA = 5;
export const SPLASH_BLOOD = 6;

export const STAT_HEALTH_ICON = 0;
export const STAT_HEALTH = 1;
export const STAT_AMMO_ICON = 2;
export const STAT_AMMO = 3;
export const STAT_ARMOR_ICON = 4;
export const STAT_ARMOR = 5;
export const STAT_SELECTED_ICON = 6;
export const STAT_PICKUP_ICON = 7;
export const STAT_PICKUP_STRING = 8;
export const STAT_TIMER_ICON = 9;
export const STAT_TIMER = 10;
export const STAT_HELPICON = 11;
export const STAT_SELECTED_ITEM = 12;
export const STAT_LAYOUTS = 13;
export const STAT_FRAGS = 14;
export const STAT_FLASHES = 15;
export const STAT_CHASE = 16;
export const STAT_SPECTATOR = 17;
export const MAX_STATS = 32;

export const DF_NO_HEALTH = 0x00000001;
export const DF_NO_ITEMS = 0x00000002;
export const DF_WEAPONS_STAY = 0x00000004;
export const DF_NO_FALLING = 0x00000008;
export const DF_INSTANT_ITEMS = 0x00000010;
export const DF_SAME_LEVEL = 0x00000020;
export const DF_SKINTEAMS = 0x00000040;
export const DF_MODELTEAMS = 0x00000080;
export const DF_NO_FRIENDLY_FIRE = 0x00000100;
export const DF_SPAWN_FARTHEST = 0x00000200;
export const DF_FORCE_RESPAWN = 0x00000400;
export const DF_NO_ARMOR = 0x00000800;
export const DF_ALLOW_EXIT = 0x00001000;
export const DF_INFINITE_AMMO = 0x00002000;
export const DF_QUAD_DROP = 0x00004000;
export const DF_FIXED_FOV = 0x00008000;
export const DF_QUADFIRE_DROP = 0x00010000;
export const DF_NO_MINES = 0x00020000;
export const DF_NO_STACK_DOUBLE = 0x00040000;
export const DF_NO_NUKES = 0x00080000;
export const DF_NO_SPHERES = 0x00100000;

export const ROGUE_VERSION_ID = 1278;
export const ROGUE_VERSION_STRING = "08/21/1998 Beta 2 for Ensemble";

export const ANGLE2SHORT_SCALE = 65536 / 360;
export const SHORT2ANGLE_SCALE = 360 / 65536;

export const CS_NAME = 0;
export const CS_CDTRACK = 1;
export const CS_SKY = 2;
export const CS_SKYAXIS = 3;
export const CS_SKYROTATE = 4;
export const CS_STATUSBAR = 5;
export const CS_AIRACCEL = 29;
export const CS_MAXCLIENTS = 30;
export const CS_MAPCHECKSUM = 31;
export const CS_MODELS = 32;
export const CS_SOUNDS = CS_MODELS + MAX_MODELS;
export const CS_IMAGES = CS_SOUNDS + MAX_SOUNDS;
export const CS_LIGHTS = CS_IMAGES + MAX_IMAGES;
export const CS_ITEMS = CS_LIGHTS + MAX_LIGHTSTYLES;
export const CS_PLAYERSKINS = CS_ITEMS + MAX_ITEMS;
export const CS_GENERAL = CS_PLAYERSKINS + MAX_CLIENTS;
export const MAX_CONFIGSTRINGS = CS_GENERAL + MAX_GENERAL;

/**
 * Original names: VIDREF_GL, VIDREF_SOFT, VIDREF_OTHER
 * Source: game/q_shared.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Identifies the active renderer family for client-side effects that branch on GL or software rendering.
 */
export const VIDREF_GL = 1;
export const VIDREF_SOFT = 2;
export const VIDREF_OTHER = 3;

/**
 * Original name: entity_event_t
 * Source: game/q_shared.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defines one-frame impulse events attached to entity_state_t updates.
 */
export enum entity_event_t {
  EV_NONE,
  EV_ITEM_RESPAWN,
  EV_FOOTSTEP,
  EV_FALLSHORT,
  EV_FALL,
  EV_FALLFAR,
  EV_PLAYER_TELEPORT,
  EV_OTHER_TELEPORT
}

/**
 * Original name: entity_state_t
 * Source: game/q_shared.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Carries server-to-client entity state needed for rendering and prediction.
 *
 * Porting notes:
 * - C source declares `struct entity_state_s` and typedefs it to `entity_state_t`; the TypeScript owner is the typedef name.
 */
export interface entity_state_t {
  number: number;
  origin: vec3_t;
  angles: vec3_t;
  old_origin: vec3_t;
  modelindex: number;
  modelindex2: number;
  modelindex3: number;
  modelindex4: number;
  frame: number;
  skinnum: number;
  effects: number;
  renderfx: number;
  solid: number;
  sound: number;
  event: number;
}

/**
 * Original name: player_state_t
 * Source: game/q_shared.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Carries view, weapon, blend, prediction and status state sent from server to client.
 */
export interface player_state_t {
  pmove: pmove_state_t;
  viewangles: vec3_t;
  viewoffset: vec3_t;
  kick_angles: vec3_t;
  gunangles: vec3_t;
  gunoffset: vec3_t;
  gunindex: number;
  gunframe: number;
  blend: [number, number, number, number];
  fov: number;
  rdflags: number;
  stats: number[];
}

/**
 * Original name: ANGLE2SHORT
 * Source: game/q_shared.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Converts a floating-point angle in degrees to the packed 16-bit Quake II angle representation.
 *
 * Porting notes:
 * - Preserves the original wrap behavior via a 16-bit mask.
 */
export function ANGLE2SHORT(value: number): number {
  return (Math.trunc(value * ANGLE2SHORT_SCALE) & 65535) >>> 0;
}

/**
 * Original name: SHORT2ANGLE
 * Source: game/q_shared.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Converts a packed 16-bit Quake II angle back to degrees.
 *
 * Porting notes:
 * - Keeps the original floating-point scale factor.
 */
export function SHORT2ANGLE(value: number): number {
  return value * SHORT2ANGLE_SCALE;
}

/**
 * Original name: LerpAngle
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Interpolates between two angles while preserving wrap-around across the 180/-180 seam.
 *
 * Porting notes:
 * - Preserves the original parameter ordering and wrap correction logic.
 */
export function LerpAngle(a2: number, a1: number, frac: number): number {
  let adjustedA1 = a1;
  if (adjustedA1 - a2 > 180) {
    adjustedA1 -= 360;
  }
  if (adjustedA1 - a2 < -180) {
    adjustedA1 += 360;
  }

  return a2 + frac * (adjustedA1 - a2);
}

/**
 * Original name: AngleVectors
 * Source: game/q_shared.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Builds forward, right and up vectors from Quake II pitch/yaw/roll angles in degrees.
 *
 * Porting notes:
 * - Supports nullable output-style mutation and also returns the vectors for existing TypeScript callers.
 */
export function AngleVectors(
  angles: vec3_t,
  forwardOut?: vec3_t | null,
  rightOut?: vec3_t | null,
  upOut?: vec3_t | null
): { forward: vec3_t; right: vec3_t; up: vec3_t } {
  const yaw = angles[YAW] * (Math.PI * 2 / 360);
  const pitch = angles[PITCH] * (Math.PI * 2 / 360);
  const roll = angles[ROLL] * (Math.PI * 2 / 360);

  const sy = Math.sin(yaw);
  const cy = Math.cos(yaw);
  const sp = Math.sin(pitch);
  const cp = Math.cos(pitch);
  const sr = Math.sin(roll);
  const cr = Math.cos(roll);

  const forward: vec3_t = [cp * cy, cp * sy, -sp];
  const right: vec3_t = [
    (-sr * sp * cy) + (-cr * -sy),
    (-sr * sp * sy) + (-cr * cy),
    -sr * cp
  ];
  const up: vec3_t = [
    (cr * sp * cy) + (-sr * -sy),
    (cr * sp * sy) + (-sr * cy),
    cr * cp
  ];

  if (forwardOut) {
    forwardOut[0] = forward[0];
    forwardOut[1] = forward[1];
    forwardOut[2] = forward[2];
  }
  if (rightOut) {
    rightOut[0] = right[0];
    rightOut[1] = right[1];
    rightOut[2] = right[2];
  }
  if (upOut) {
    upOut[0] = up[0];
    upOut[1] = up[1];
    upOut[2] = up[2];
  }

  return { forward, right, up };
}

/**
 * Original name: N/A
 * Source: N/A (zero-initialized q_shared state helper)
 * Category: New
 * Purpose: Create a default entity_state_t value suitable for incremental client and server ports.
 *
 * Constraints:
 * - Must keep defaults aligned with zero-initialized C struct expectations.
 */
export function createEntityState(): entity_state_t {
  return {
    number: 0,
    origin: [0, 0, 0],
    angles: [0, 0, 0],
    old_origin: [0, 0, 0],
    modelindex: 0,
    modelindex2: 0,
    modelindex3: 0,
    modelindex4: 0,
    frame: 0,
    skinnum: 0,
    effects: 0,
    renderfx: 0,
    solid: 0,
    sound: 0,
    event: 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (zero-initialized q_shared state helper)
 * Category: New
 * Purpose: Create a default player_state_t value suitable for incremental client and server ports.
 *
 * Constraints:
 * - Must keep defaults aligned with zero-initialized C struct expectations.
 */
export function createPlayerState(): player_state_t {
  return {
    pmove: {
      pm_type: pmtype_t.PM_NORMAL,
      origin: [0, 0, 0],
      velocity: [0, 0, 0],
      pm_flags: 0,
      pm_time: 0,
      gravity: 0,
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
    fov: 0,
    rdflags: 0,
    stats: new Array<number>(MAX_STATS).fill(0)
  };
}
