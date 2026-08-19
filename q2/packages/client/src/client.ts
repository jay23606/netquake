/**
 * File: client.ts
 * Source: Quake II original / client/client.h
 * Purpose: Port the core Quake II client runtime structures used by client parsing, baselines and frame state.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses arrays and typed objects instead of raw C fixed-size buffers.
 * - Leaves renderer, sound and file handles as `unknown` placeholders for later adapter work.
 * - Keeps `keydest_t` in `keys.ts`, which remains the canonical TypeScript target for the `cls.key_dest` surface from `client.h`.
 *
 * Notes:
 * - This file is intended to stay conceptually close to the original C source.
 */

import { createSizeBuffer, type sizebuf_t } from "../../memory/src/index.js";
import {
  createNetchan,
  createEntityState,
  createPlayerState,
  MAX_CLIENTS,
  MAX_CONFIGSTRINGS,
  MAX_EDICTS,
  MAX_IMAGES,
  MAX_ITEMS,
  MAX_LIGHTSTYLES,
  MAX_MAP_AREAS,
  MAX_MODELS,
  MAX_QPATH,
  MAX_SOUNDS,
  netsrc_t,
  VIDREF_GL,
  type entity_state_t,
  type netchan_t,
  type player_state_t,
  type usercmd_t,
  type vec3_t
} from "../../qcommon/src/index.js";
import { UPDATE_BACKUP } from "../../qcommon/src/index.js";

/**
 * Original name: MAX_PARSE_ENTITIES
 * Source: client/client.h
 * Category: Ported
 */
export const MAX_PARSE_ENTITIES = 1024;

/**
 * Original name: CMD_BACKUP
 * Source: client/client.h
 * Category: Ported
 */
export const CMD_BACKUP = 64;

/**
 * Original name: MAX_CLIENTWEAPONMODELS
 * Source: client/client.h
 * Category: Ported
 */
export const MAX_CLIENTWEAPONMODELS = 20;

/**
 * Original name: MAX_EXPLOSIONS
 * Source: client/cl_tent.c
 * Category: Ported
 */
export const MAX_EXPLOSIONS = 32;

/**
 * Original name: MAX_BEAMS
 * Source: client/cl_tent.c
 * Category: Ported
 */
export const MAX_BEAMS = 32;

/**
 * Original name: MAX_LASERS
 * Source: client/cl_tent.c
 * Category: Ported
 */
export const MAX_LASERS = 32;

/**
 * Original name: MAX_SUSTAINS
 * Source: client/client.h
 * Category: Ported
 */
export const MAX_SUSTAINS = 32;

/**
 * Original name: MAX_DLIGHTS
 * Source: client/ref.h
 * Category: Adapter
 */
export const MAX_DLIGHTS = 32;

/**
 * Original name: MAX_PARTICLES
 * Source: client/ref.h
 * Category: Adapter
 */
export const MAX_PARTICLES = 4096;

/**
 * Original name: INSTANT_PARTICLE
 * Source: client/client.h
 * Category: Ported
 */
export const INSTANT_PARTICLE = -10000.0;

/**
 * Original name: clightstyle_t
 * Source: client/cl_fx.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Stores one animated Quake II lightstyle string plus its current RGB value.
 *
 * Porting notes:
 * - Uses a number array for `map` instead of a fixed C buffer.
 */
export interface client_lightstyle_t {
  length: number;
  value: [number, number, number];
  map: number[];
}

/**
 * Original name: cdlight_t
 * Source: client/client.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Stores one client-side dynamic light entry keyed by entity or temporary effect id.
 *
 * Porting notes:
 * - Preserves the original timing, decay and contribution fields.
 * - Uses the TypeScript name `client_dlight_t` to avoid colliding with the renderer-facing `dlight_t` from `client/ref.h`.
 */
export interface client_dlight_t {
  key: number;
  color: vec3_t;
  origin: vec3_t;
  radius: number;
  die: number;
  decay: number;
  minlight: number;
}

/**
 * Original name: particle_s
 * Source: client/client.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Stores one client particle entry linked through the active/free particle lists.
 *
 * Porting notes:
 * - Uses an integer `next` index instead of a raw pointer.
 */
export interface cparticle_t {
  time: number;
  org: vec3_t;
  vel: vec3_t;
  accel: vec3_t;
  color: number;
  colorvel: number;
  alpha: number;
  alphavel: number;
  next: number;
}

/**
 * Original name: kbutton_t
 * Source: client/client.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Tracks the pressed keys and timing state backing one continuous Quake II input action.
 *
 * Porting notes:
 * - Preserves the original bit-packed `state` semantics.
 */
export interface kbutton_t {
  down: [number, number];
  downtime: number;
  msec: number;
  state: number;
}

/**
 * Original name: frame_t
 * Source: client/client.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Stores one parsed server frame along with player state and packet entities metadata.
 *
 * Porting notes:
 * - Uses a Uint8Array for `areabits` instead of a fixed C byte array.
 */
export interface frame_t {
  valid: boolean;
  serverframe: number;
  servertime: number;
  deltaframe: number;
  areabits: Uint8Array;
  playerstate: player_state_t;
  num_entities: number;
  parse_entities: number;
}

/**
 * Original name: centity_t
 * Source: client/client.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Stores baseline, current and previous render-facing entity state for one edict number.
 *
 * Porting notes:
 * - Preserves the original field names and interpolation-related state.
 */
export interface centity_t {
  baseline: entity_state_t;
  current: entity_state_t;
  prev: entity_state_t;
  serverframe: number;
  trailcount: number;
  lerp_origin: vec3_t;
  fly_stoptime: number;
}

/**
 * Original name: clientinfo_t
 * Source: client/client.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Stores one parsed player skin/model identity plus the registered renderer handles.
 *
 * Porting notes:
 * - Uses strings for fixed char buffers and `unknown` placeholders for renderer-owned handles.
 * - Adds parsed filename/cache metadata so clientinfo registration can stay deterministic before a renderer adapter is present.
 */
export interface clientinfo_t {
  name: string;
  cinfo: string;
  model_name: string;
  skin_name: string;
  model_filename: string;
  skin_filename: string;
  skin: unknown;
  icon: unknown;
  iconname: string;
  model: unknown;
  weaponmodel: unknown[];
  weaponmodel_paths: string[];
  valid: boolean;
}

/**
 * Original name: beam_t
 * Source: client/cl_tent.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Purpose: Preserve one client-side temporary beam slot modeled after `beam_t`.
 *
 * Constraints:
 * - Must retain entity binding, timing and endpoints for later refresh reconstruction.
 */
export interface client_beam_t {
  entity: number;
  dest_entity: number;
  model: string | null;
  endtime: number;
  offset: vec3_t;
  start: vec3_t;
  end: vec3_t;
}

/**
 * Original name: entity_t
 * Source: client/ref.h
 * Category: Adapter
 * Fidelity level: Adapter
 *
 * Purpose: Preserve the render-facing `entity_t` subset embedded inside `explosion_t` and `laser_t`.
 *
 * Constraints:
 * - Must retain the original `entity_t` field grouping used by `cl_tent.c`.
 */
export interface client_tent_entity_t {
  model: string | null;
  origin: vec3_t;
  oldorigin: vec3_t;
  angles: vec3_t;
  frame: number;
  oldframe: number;
  backlerp: number;
  flags: number;
  alpha: number;
  skinnum: number;
}

/**
 * Original name: explosion_t
 * Source: client/cl_tent.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Purpose: Preserve one client-side temporary explosion slot modeled after `explosion_t`.
 *
 * Constraints:
 * - Must retain animation timing, model identity and dynamic light metadata.
 */
export interface client_explosion_t {
  type: "free" | "explosion" | "misc" | "flash" | "mflash" | "poly" | "poly2";
  ent: client_tent_entity_t;
  frames: number;
  light: number;
  lightcolor: [number, number, number];
  start: number;
  baseframe: number;
}

/**
 * Original name: laser_t
 * Source: client/cl_tent.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Purpose: Preserve one client-side temporary laser slot modeled after `laser_t`.
 *
 * Constraints:
 * - Must retain beam endpoints, render flags and timeout.
 */
export interface client_laser_t {
  start: vec3_t;
  end: vec3_t;
  endtime: number;
  flags: number;
  alpha: number;
  skinnum: number;
  frame: number;
}

/**
 * Original name: cl_sustain
 * Source: client/client.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Preserves one client-side sustain slot used by Rogue temp-entity thinkers.
 *
 * Porting notes:
 * - Renamed to `client_sustain_t` to follow the client runtime state naming used by temp entities.
 * - Stores the C function pointer as a stable thinker identity.
 */
export interface client_sustain_t {
  id: number;
  type: "none" | "steam" | "widow" | "nuke";
  thinker: "none" | "CL_ParticleSteamEffect2" | "CL_Widowbeamout" | "CL_Nukeblast";
  endtime: number;
  nextthink: number;
  thinkinterval: number;
  org: vec3_t;
  dir: vec3_t;
  color: number;
  count: number;
  magnitude: number;
}

/**
 * Original name: N/A
 * Source: N/A (local runtime state)
 * Category: New
 * Purpose: Preserve one transient temp light event such as `CL_Flashlight`.
 *
 * Constraints:
 * - Must retain origin, color, intensity and timeout for later refresh reconstruction.
 */
export interface client_temp_light_t {
  origin: vec3_t;
  color: [number, number, number];
  intensity: number;
  minlight: number;
  endtime: number;
  entity: number;
  kind: "flashlight";
}

/**
 * Original name: N/A
 * Source: N/A (local runtime state)
 * Category: New
 * Purpose: Preserve one transient force-wall effect segment.
 *
 * Constraints:
 * - Must retain endpoints, color and timeout for later renderer adapters.
 */
export interface client_force_wall_t {
  start: vec3_t;
  end: vec3_t;
  color: number;
  endtime: number;
}

/**
 * Original name: N/A
 * Source: N/A (local runtime state)
 * Category: New
 * Purpose: Group the persistent temporary-entity arrays ported from `cl_tent.c`.
 *
 * Constraints:
 * - Must keep each family in fixed-size slot arrays close to the original layout.
 */
export interface client_tent_state_t {
  beams: client_beam_t[];
  playerbeams: client_beam_t[];
  explosions: client_explosion_t[];
  lasers: client_laser_t[];
  sustains: client_sustain_t[];
  tempLights: client_temp_light_t[];
  forceWalls: client_force_wall_t[];
  registeredModels: string[];
  registeredPics: string[];
  registeredSounds: string[];
}

/**
 * Original name: N/A
 * Source: N/A (local runtime state)
 * Category: New
 * Purpose: Preserve the client-side screen and HUD transient state used by `cl_scrn.c`.
 *
 * Constraints:
 * - Must keep center-print and loading-plaque state explicit for later UI adapters.
 */
export interface client_screen_state_t {
  scr_initialized: boolean;
  scr_con_current: number;
  scr_conlines: number;
  scr_centerstring: string;
  scr_centertime_start: number;
  scr_centertime_off: number;
  scr_center_lines: number;
  scr_erase_center: number;
  scr_draw_loading: number;
  sb_lines: number;
  scr_vrect: { x: number; y: number; width: number; height: number };
  scr_dirty: { x1: number; y1: number; x2: number; y2: number };
  scr_old_dirty: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  crosshair_pic: string;
  crosshair_width: number;
  crosshair_height: number;
  graph_current: number;
  graph_values: Array<{ value: number; color: number }>;
}

/**
 * Original name: N/A
 * Source: N/A (local runtime state)
 * Category: New
 * Purpose: Store the active Quake II sky configstrings in a structured client state block.
 *
 * Constraints:
 * - Must stay directly derivable from `CS_SKY`, `CS_SKYROTATE` and `CS_SKYAXIS`.
 * - Must preserve level-scoped reset behavior.
 */
export interface client_sky_t {
  name: string;
  rotate: number;
  axis: vec3_t;
}

/**
 * Original name: cinematics_t
 * Source: client/cl_cin.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Preserves the active cinematic decoder, palette, image and audio stream state.
 *
 * Porting notes:
 * - Stores the original global `cin` block inside explicit client runtime state.
 * - Uses typed arrays and a loaded byte buffer instead of C-owned file pointers.
 */
export interface client_cinematic_t {
  cinematictime: number;
  cinematicframe: number;
  restart_sound: boolean;
  cinematicpalette_active: boolean;
  cinematicpalette: Uint8Array;
  width: number;
  height: number;
  pic: Uint8Array | null;
  pic_pending: Uint8Array | null;
  kind: "none" | "pcx-static" | "cinematic";
  name: string;
  file: Uint8Array | null;
  file_position: number;
  s_rate: number;
  s_width: number;
  s_channels: number;
  hnodes1: Int32Array | null;
  numhnodes1: Int32Array;
}

/**
 * Original name: N/A
 * Source: N/A (local runtime state)
 * Category: New
 * Purpose: Preserve the client-side precache traversal state used by `CL_RequestNextDownload`.
 *
 * Constraints:
 * - Must keep the original counters explicit so the precache loop can resume after each download.
 */
export interface client_precache_state_t {
  precache_check: number;
  precache_spawncount: number;
  precache_tex: number;
  precache_model_skin: number;
}

/**
 * Original name: client_state_t
 * Source: client/client.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Stores level-scoped client runtime state cleared on server map change.
 *
 * Porting notes:
 * - Keeps renderer-facing fields as placeholders until later phases.
 */
export interface client_state_t {
  timeoutcount: number;
  timedemo_frames: number;
  timedemo_start: number;
  refresh_prepped: boolean;
  sound_prepped: boolean;
  force_refdef: boolean;
  parse_entities: number;
  cmd: usercmd_t;
  cmds: usercmd_t[];
  cmd_time: number[];
  predicted_origins: number[][];
  predicted_pmove: player_state_t["pmove"];
  predicted_viewheight: number;
  predicted_step: number;
  predicted_step_time: number;
  predicted_origin: vec3_t;
  predicted_angles: vec3_t;
  prediction_error: vec3_t;
  frame: frame_t;
  surpressCount: number;
  frames: frame_t[];
  viewangles: vec3_t;
  time: number;
  lerpfrac: number;
  cl_footsteps: boolean;
  hand: number;
  layout: string;
  inventory: number[];
  attractloop: boolean;
  servercount: number;
  gamedir: string;
  playernum: number;
  configstrings: string[];
  sky: client_sky_t;
  cinematic: client_cinematic_t;
  model_draw: unknown[];
  model_clip: unknown[];
  sound_precache: unknown[];
  image_precache: unknown[];
  lightstyles: client_lightstyle_t[];
  last_lightstyle_ofs: number;
  dlights: client_dlight_t[];
  particles: cparticle_t[];
  active_particles: number;
  free_particles: number;
  cl_numparticles: number;
  vidref_val: number;
  cl_weaponmodels: string[];
  num_cl_weaponmodels: number;
  clientinfo: clientinfo_t[];
  baseclientinfo: clientinfo_t;
  tents: client_tent_state_t;
  screen: client_screen_state_t;
}

/**
 * Original name: connstate_t
 * Source: client/client.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Describes the client connection lifecycle state.
 *
 * Porting notes:
 * - Preserves original enum ordering.
 */
export enum connstate_t {
  ca_uninitialized,
  ca_disconnected,
  ca_connecting,
  ca_connected,
  ca_active
}

/**
 * Original name: dltype_t
 * Source: client/client.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Describes which asset family the current server download belongs to.
 *
 * Porting notes:
 * - Preserves original enum ordering.
 */
export enum dltype_t {
  dl_none,
  dl_model,
  dl_sound,
  dl_skin,
  dl_single
}

/**
 * Original name: client_static_t
 * Source: client/client.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Preserves persistent client connection, timing, download, netchan and demo state across server connections.
 *
 * Porting notes:
 * - `key_dest` remains owned by `keys.ts` to keep the keyboard state cluster grouped with `keys.c`.
 * - File handles stay abstract as `unknown`; `precache` is the TypeScript-owned resumable download traversal adapter.
 */
export interface client_static_t {
  state: connstate_t;
  realtime: number;
  frametime: number;
  framecount: number;
  disable_screen: number;
  disable_servercount: number;
  servername: string;
  connect_time: number;
  quakePort: number;
  serverProtocol: number;
  challenge: number;
  download: unknown | null;
  downloadname: string;
  downloadtempname: string;
  downloadnumber: number;
  downloadtype: dltype_t;
  downloadpercent: number;
  demorecording: boolean;
  demowaiting: boolean;
  demofile: unknown | null;
  netchan: netchan_t;
  precache: client_precache_state_t;
}

/**
 * Original name: N/A
 * Source: N/A (local runtime bundle)
 * Category: New
 * Purpose: Expose the minimal client runtime bundle used by early client message parsing.
 *
 * Constraints:
 * - Must keep mutable parsing state explicit for deterministic tests.
 */
export interface ClientRuntime {
  cl: client_state_t;
  cls: client_static_t;
  cl_entities: centity_t[];
  cl_parse_entities: entity_state_t[];
  net_message: sizebuf_t;
  output: string[];
}

/**
 * Original name: N/A
 * Source: N/A (local factory)
 * Category: New
 * Purpose: Create a zero-initialized Quake II frame value.
 *
 * Constraints:
 * - Must preserve C-style zero defaults.
 */
export function createFrame(): frame_t {
  return {
    valid: false,
    serverframe: 0,
    servertime: 0,
    deltaframe: 0,
    areabits: new Uint8Array(MAX_MAP_AREAS / 8),
    playerstate: createPlayerState(),
    num_entities: 0,
    parse_entities: 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (local factory)
 * Category: New
 * Purpose: Create a zero-initialized client entity state record.
 *
 * Constraints:
 * - Must preserve the original interpolation fields.
 */
export function createCentity(): centity_t {
  return {
    baseline: createEntityState(),
    current: createEntityState(),
    prev: createEntityState(),
    serverframe: 0,
    trailcount: 0,
    lerp_origin: [0, 0, 0],
    fly_stoptime: 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (local factory)
 * Category: New
 * Purpose: Create a minimal zero-initialized client info record.
 *
 * Constraints:
 * - Must preserve Quake-style empty string defaults.
 */
export function createClientinfo(): clientinfo_t {
  return {
    name: "",
    cinfo: "",
    model_name: "",
    skin_name: "",
    model_filename: "",
    skin_filename: "",
    skin: null,
    icon: null,
    iconname: "",
    model: null,
    weaponmodel: new Array<unknown>(MAX_CLIENTWEAPONMODELS).fill(null),
    weaponmodel_paths: new Array<string>(MAX_CLIENTWEAPONMODELS).fill(""),
    valid: false
  };
}

/**
 * Original name: N/A
 * Source: N/A (local factory)
 * Category: New
 * Purpose: Create one zero-initialized client lightstyle slot.
 *
 * Constraints:
 * - Must preserve the original empty-slot semantics from `CL_ClearLightStyles`.
 */
export function createClientLightstyle(): client_lightstyle_t {
  return {
    length: 0,
    value: [0, 0, 0],
    map: new Array<number>(MAX_QPATH).fill(0)
  };
}

/**
 * Original name: N/A
 * Source: N/A (local factory)
 * Category: New
 * Purpose: Create one zero-initialized client dynamic light slot.
 *
 * Constraints:
 * - Must preserve the original free-slot semantics based on `radius` and `die`.
 */
export function createClientDlight(): client_dlight_t {
  return {
    key: 0,
    color: [0, 0, 0],
    origin: [0, 0, 0],
    radius: 0,
    die: 0,
    decay: 0,
    minlight: 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (local factory)
 * Category: New
 * Purpose: Create one zero-initialized client particle slot.
 *
 * Constraints:
 * - Must preserve the original free-list startup semantics.
 */
export function createCparticle(): cparticle_t {
  return {
    time: 0,
    org: [0, 0, 0],
    vel: [0, 0, 0],
    accel: [0, 0, 0],
    color: 0,
    colorvel: 0,
    alpha: 0,
    alphavel: 0,
    next: -1
  };
}

/**
 * Original name: N/A
 * Source: N/A (local factory)
 * Category: New
 * Purpose: Create one zero-initialized temp beam slot.
 *
 * Constraints:
 * - Must preserve the original empty-slot semantics.
 */
export function createClientBeam(): client_beam_t {
  return {
    entity: 0,
    dest_entity: 0,
    model: null,
    endtime: 0,
    offset: [0, 0, 0],
    start: [0, 0, 0],
    end: [0, 0, 0]
  };
}

/**
 * Original name: N/A
 * Source: N/A (local factory)
 * Category: New
 * Purpose: Create one zero-initialized temp explosion slot.
 *
 * Constraints:
 * - Must preserve the original `ex_free` startup semantics.
 */
export function createClientExplosion(): client_explosion_t {
  return {
    type: "free",
    ent: createClientTentEntity(),
    frames: 0,
    light: 0,
    lightcolor: [0, 0, 0],
    start: 0,
    baseframe: 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (local factory)
 * Category: New
 * Purpose: Create one zero-initialized temp-entity render sub-structure.
 *
 * Constraints:
 * - Must preserve the C-style zeroed `entity_t` startup state used by `cl_tent.c`.
 */
export function createClientTentEntity(): client_tent_entity_t {
  return {
    model: null,
    origin: [0, 0, 0],
    oldorigin: [0, 0, 0],
    angles: [0, 0, 0],
    frame: 0,
    oldframe: 0,
    backlerp: 0,
    flags: 0,
    alpha: 0,
    skinnum: 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (local factory)
 * Category: New
 * Purpose: Create one zero-initialized temp laser slot.
 *
 * Constraints:
 * - Must preserve the original timeout-based free-slot semantics.
 */
export function createClientLaser(): client_laser_t {
  return {
    start: [0, 0, 0],
    end: [0, 0, 0],
    endtime: 0,
    flags: 0,
    alpha: 0,
    skinnum: 0,
    frame: 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (local factory)
 * Category: New
 * Purpose: Create one zero-initialized temp sustain slot.
 *
 * Constraints:
 * - Must preserve the original `id == 0` free-slot convention.
 */
export function createClientSustain(): client_sustain_t {
  return {
    id: 0,
    type: "none",
    thinker: "none",
    endtime: 0,
    nextthink: 0,
    thinkinterval: 0,
    org: [0, 0, 0],
    dir: [0, 0, 0],
    color: 0,
    count: 0,
    magnitude: 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (local factory)
 * Category: New
 * Purpose: Create one zero-initialized transient temp light slot.
 *
 * Constraints:
 * - Must preserve timeout-based free-slot semantics.
 */
export function createClientTempLight(): client_temp_light_t {
  return {
    origin: [0, 0, 0],
    color: [0, 0, 0],
    intensity: 0,
    minlight: 0,
    endtime: 0,
    entity: 0,
    kind: "flashlight"
  };
}

/**
 * Original name: N/A
 * Source: N/A (local factory)
 * Category: New
 * Purpose: Create one zero-initialized transient force-wall slot.
 *
 * Constraints:
 * - Must preserve timeout-based free-slot semantics.
 */
export function createClientForceWall(): client_force_wall_t {
  return {
    start: [0, 0, 0],
    end: [0, 0, 0],
    color: 0,
    endtime: 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (local factory)
 * Category: New
 * Purpose: Create the persistent temp-entity state arrays ported from `cl_tent.c`.
 *
 * Constraints:
 * - Must preserve the original slot counts.
 */
export function createClientTentState(): client_tent_state_t {
  return {
    beams: Array.from({ length: MAX_BEAMS }, () => createClientBeam()),
    playerbeams: Array.from({ length: MAX_BEAMS }, () => createClientBeam()),
    explosions: Array.from({ length: MAX_EXPLOSIONS }, () => createClientExplosion()),
    lasers: Array.from({ length: MAX_LASERS }, () => createClientLaser()),
    sustains: Array.from({ length: MAX_SUSTAINS }, () => createClientSustain()),
    tempLights: Array.from({ length: MAX_EXPLOSIONS }, () => createClientTempLight()),
    forceWalls: Array.from({ length: MAX_EXPLOSIONS }, () => createClientForceWall()),
    registeredModels: [],
    registeredPics: [],
    registeredSounds: []
  };
}

/**
 * Original name: N/A
 * Source: N/A (local factory)
 * Category: New
 * Purpose: Create a zero-initialized client screen state compatible with early `cl_scrn.c` ports.
 *
 * Constraints:
 * - Must preserve the original empty center-print and loading defaults.
 */
export function createClientScreenState(): client_screen_state_t {
  return {
    scr_initialized: false,
    scr_con_current: 0,
    scr_conlines: 0,
    scr_centerstring: "",
    scr_centertime_start: 0,
    scr_centertime_off: 0,
    scr_center_lines: 0,
    scr_erase_center: 0,
    scr_draw_loading: 0,
    sb_lines: 0,
    scr_vrect: {
      x: 0,
      y: 0,
      width: 0,
      height: 0
    },
    scr_dirty: {
      x1: 9999,
      y1: 9999,
      x2: -9999,
      y2: -9999
    },
    scr_old_dirty: [
      { x1: 9999, y1: 9999, x2: -9999, y2: -9999 },
      { x1: 9999, y1: 9999, x2: -9999, y2: -9999 }
    ],
    crosshair_pic: "",
    crosshair_width: 0,
    crosshair_height: 0,
    graph_current: 0,
    graph_values: Array.from({ length: 1024 }, () => ({ value: 0, color: 0 }))
  };
}

/**
 * Original name: N/A
 * Source: N/A (local factory)
 * Category: New
 * Purpose: Create a zero-initialized structured client sky state.
 *
 * Constraints:
 * - Must reflect the empty configstring defaults used before a level is prepared.
 */
export function createClientSkyState(): client_sky_t {
  return {
    name: "",
    rotate: 0,
    axis: [0, 0, 0]
  };
}

/**
 * Original name: N/A
 * Source: N/A (local factory)
 * Category: New
 * Purpose: Create a zero-initialized client cinematic state.
 *
 * Constraints:
 * - Must preserve the original inactive defaults used before a cinematic starts.
 */
export function createClientCinematicState(): client_cinematic_t {
  return {
    cinematictime: 0,
    cinematicframe: 0,
    restart_sound: false,
    cinematicpalette_active: false,
    cinematicpalette: new Uint8Array(768),
    width: 0,
    height: 0,
    pic: null,
    pic_pending: null,
    kind: "none",
    name: "",
    file: null,
    file_position: 0,
    s_rate: 0,
    s_width: 0,
    s_channels: 0,
    hnodes1: null,
    numhnodes1: new Int32Array(256)
  };
}

/**
 * Original name: N/A
 * Source: N/A (local factory)
 * Category: New
 * Purpose: Create a zero-initialized client level state compatible with early parser ports.
 *
 * Constraints:
 * - Must keep fixed-length arrays aligned with original capacities.
 */
export function createClientState(): client_state_t {
  const particles = Array.from({ length: MAX_PARTICLES }, (_, index) => {
    const particle = createCparticle();
    particle.next = index + 1 < MAX_PARTICLES ? index + 1 : -1;
    return particle;
  });
  return {
    timeoutcount: 0,
    timedemo_frames: 0,
    timedemo_start: 0,
    refresh_prepped: false,
    sound_prepped: false,
    force_refdef: false,
    parse_entities: 0,
    cmd: createUsercmd(),
    cmds: Array.from({ length: CMD_BACKUP }, () => createUsercmd()),
    cmd_time: new Array<number>(CMD_BACKUP).fill(0),
    predicted_origins: Array.from({ length: CMD_BACKUP }, () => [0, 0, 0]),
    predicted_pmove: createPlayerState().pmove,
    predicted_viewheight: 0,
    predicted_step: 0,
    predicted_step_time: 0,
    predicted_origin: [0, 0, 0],
    predicted_angles: [0, 0, 0],
    prediction_error: [0, 0, 0],
    frame: createFrame(),
    surpressCount: 0,
    frames: Array.from({ length: UPDATE_BACKUP }, () => createFrame()),
    viewangles: [0, 0, 0],
    time: 0,
    lerpfrac: 0,
    cl_footsteps: true,
    hand: 0,
    layout: "",
    inventory: new Array<number>(MAX_ITEMS).fill(0),
    attractloop: false,
    servercount: 0,
    gamedir: "",
    playernum: 0,
    configstrings: new Array<string>(MAX_CONFIGSTRINGS).fill(""),
    sky: createClientSkyState(),
    cinematic: createClientCinematicState(),
    model_draw: new Array<unknown>(MAX_MODELS).fill(null),
    model_clip: new Array<unknown>(MAX_MODELS).fill(null),
    sound_precache: new Array<unknown>(MAX_SOUNDS).fill(null),
    image_precache: new Array<unknown>(MAX_IMAGES).fill(null),
    lightstyles: Array.from({ length: MAX_LIGHTSTYLES }, () => createClientLightstyle()),
    last_lightstyle_ofs: -1,
    dlights: Array.from({ length: MAX_DLIGHTS }, () => createClientDlight()),
    particles,
    active_particles: -1,
    free_particles: 0,
    cl_numparticles: MAX_PARTICLES,
    vidref_val: VIDREF_GL,
    cl_weaponmodels: ["weapon.md2"],
    num_cl_weaponmodels: 1,
    clientinfo: Array.from({ length: MAX_CLIENTS }, () => createClientinfo()),
    baseclientinfo: createClientinfo(),
    tents: createClientTentState(),
    screen: createClientScreenState()
  };
}

/**
 * Original name: N/A
 * Source: N/A (local factory)
 * Category: New
 * Purpose: Create a zero-initialized persistent client static state.
 *
 * Constraints:
 * - Must preserve the original disconnected startup state.
 */
export function createClientStatic(): client_static_t {
  return {
    state: connstate_t.ca_disconnected,
    realtime: 0,
    frametime: 0,
    framecount: 0,
    disable_screen: 0,
    disable_servercount: 0,
    servername: "",
    connect_time: 0,
    quakePort: 0,
    serverProtocol: 0,
    challenge: 0,
    download: null,
    downloadname: "",
    downloadtempname: "",
    downloadnumber: 0,
    downloadtype: dltype_t.dl_none,
    downloadpercent: 0,
    demorecording: false,
    demowaiting: false,
    demofile: null,
    netchan: createNetchan(netsrc_t.NS_CLIENT),
    precache: createClientPrecacheState()
  };
}

/**
 * Original name: N/A
 * Source: N/A (local factory)
 * Category: New
 * Purpose: Create a zero-initialized client precache traversal state.
 *
 * Constraints:
 * - Must preserve C-style zero defaults for the resumable precache loop.
 */
export function createClientPrecacheState(): client_precache_state_t {
  return {
    precache_check: 0,
    precache_spawncount: 0,
    precache_tex: 0,
    precache_model_skin: 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (local factory)
 * Category: New
 * Purpose: Create the minimal client parsing runtime bundle used by current parser ports.
 *
 * Constraints:
 * - Must provide a mutable network message buffer.
 */
export function createClientRuntime(): ClientRuntime {
  return {
    cl: createClientState(),
    cls: createClientStatic(),
    cl_entities: Array.from({ length: MAX_EDICTS }, () => createCentity()),
    cl_parse_entities: Array.from({ length: MAX_PARSE_ENTITIES }, () => createEntityState()),
    net_message: createSizeBuffer(65536),
    output: []
  };
}

/**
 * Original name: N/A
 * Source: N/A (local factory)
 * Category: New
 * Purpose: Create a zero-initialized Quake II key button state.
 *
 * Constraints:
 * - Must preserve the original dual-key tracking layout.
 */
export function createKbutton(): kbutton_t {
  return {
    down: [0, 0],
    downtime: 0,
    msec: 0,
    state: 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (local factory)
 * Category: New
 * Purpose: Create a zero-initialized user command matching Quake II defaults.
 *
 * Constraints:
 * - Must preserve C-style zero values for all movement fields.
 */
function createUsercmd(): usercmd_t {
  return {
    msec: 0,
    buttons: 0,
    angles: [0, 0, 0],
    forwardmove: 0,
    sidemove: 0,
    upmove: 0,
    impulse: 0,
    lightlevel: 0
  };
}
