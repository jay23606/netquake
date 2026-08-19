/**
 * File: local-gameplay-sync.ts
 * Purpose: Hold the standalone synchronization helpers that bridge the local gameplay runtime into the client runtime without living in a web adapter.
 *
 * This file is not a direct source port.
 * It is a runtime-side bridge for the current local standalone loop.
 *
 * Dependencies:
 * - packages/client/src/client.ts
 * - packages/game
 * - packages/qcommon
 */

import {
  CM_InlineModel,
  CS_CDTRACK,
  CS_LIGHTS,
  CS_ITEMS,
  CS_IMAGES,
  CS_MODELS,
  CS_SOUNDS,
  CS_SKY,
  CS_SKYAXIS,
  CS_SKYROTATE,
  BYTE_DIRS,
  DotProduct,
  MAX_EDICTS,
  MAX_LIGHTSTYLES,
  MZ_SILENCED,
  PMF_DUCKED,
  PMF_ON_GROUND,
  PITCH,
  STAT_AMMO,
  STAT_AMMO_ICON,
  STAT_HEALTH,
  STAT_HEALTH_ICON,
  STAT_PICKUP_ICON,
  STAT_PICKUP_STRING,
  STAT_SELECTED_ICON,
  STAT_SELECTED_ITEM,
  STAT_FLASHES,
  YAW,
  createEntityState,
  pmtype_t,
  type entity_state_t,
  type vec3_t
} from "../../qcommon/src/index.js";
import {
  DAMAGE_TIME,
  FRAMETIME,
  ClientBeginServerFrame,
  ClientThink,
  drainGameConfigstringUpdates,
  drainMonsterMuzzleFlashEvents,
  drainPlayerMuzzleFlashEvents,
  drainGameTempEntityEvents,
  GetAmmoItemForWeapon,
  GetGameItems,
  G_RunFrame,
  LOCAL_GAME_WEAPON_HOOKS,
  linkGameEntity,
  refreshEntitySpatialState,
  touchTriggerEntities,
  SVF_NOCLIENT,
  emitRegisteredGameSound,
  registerGameSound,
  type GameEntity,
  type GameRuntime
} from "../../game/src/index.js";
import { CL_SetLightstyle } from "./cl_fx.js";
import type { BspMap } from "../../formats/src/index.js";
import { findClientImageIndex, type LocalClientHudBootstrapData } from "./local-client-bootstrap.js";
import {
  CL_AllocDlight,
  CL_BuildMuzzleFlash2Effects,
  CL_BuildMuzzleFlashEffects,
  CL_BuildTempEntityEffects,
  CL_LogoutEffect,
  CL_ParticleEffect,
  type ClientActionEffect
} from "./cl_fx.js";
import { CL_ExecuteTempEntityEffects } from "./cl_fx.js";
import { CL_AddTEntPacket, CL_SmokeAndFlash } from "./cl_tent.js";
import { getPredictedViewheight } from "./local-loop.js";
import type { ClientTempEntityPacket } from "./cl_parse.js";
import { connstate_t, type ClientRuntime } from "./client.js";

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Define the local player trigger hull used when mirroring predicted client movement into gameplay triggers.
 */
const PLAYER_TRIGGER_MINS: vec3_t = [-16, -16, -24];

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Define the local standing player trigger hull used when mirroring predicted client movement into gameplay triggers.
 */
const PLAYER_TRIGGER_MAXS: vec3_t = [16, 16, 32];

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Define the local ducked player trigger hull used when mirroring predicted client movement into gameplay triggers.
 */
const PLAYER_DUCKED_MAXS: vec3_t = [16, 16, 4];

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Define the local gib player hull used when prediction reports `PM_GIB`.
 */
const PLAYER_GIB_MINS: vec3_t = [-16, -16, 0];

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Define the local gib player hull used when prediction reports `PM_GIB`.
 */
const PLAYER_GIB_MAXS: vec3_t = [16, 16, 16];

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Define the initial local standing viewheight before prediction supplies a runtime value.
 */
const PLAYER_STAND_VIEWHEIGHT = 22;

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Define the visual easing speed for local crouch and stand viewheight transitions.
 */
const LOCAL_VIEWHEIGHT_SMOOTH_SPEED = 120;

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Preserve the minimal local view-motion state required to feed the current first-person weapon bob and delta-angle formulas.
 *
 * Constraints:
 * - Must remain data-only so adapters can store it without owning the behavior.
 */
export interface LocalViewMotionState {
  bobtime: number;
  oldviewangles: vec3_t;
  viewheight: number;
}

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Preserve the previous and current brush-model poses required to interpolate moving BSP submodels across fixed local gameplay frames.
 *
 * Constraints:
 * - Must keep timestamps aligned with fixed Quake II server frames.
 */
export interface BrushModelInterpolationState<TSnapshot> {
  previousSnapshots: TSnapshot[];
  currentSnapshots: TSnapshot[];
  previousTime: number;
  currentTime: number;
}

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Create the initial local view-motion state for the standalone prediction/gameplay bridge.
 */
export function createLocalViewMotionState(spawnYaw: number): LocalViewMotionState {
  return {
    bobtime: 0,
    oldviewangles: [0, spawnYaw, 0],
    viewheight: PLAYER_STAND_VIEWHEIGHT
  };
}

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Advance the local gameplay runtime on fixed Quake II frame boundaries while preserving interpolation snapshots.
 *
 * Constraints:
 * - Must run `G_RunFrame` using the original `FRAMETIME`.
 */
export function advanceLocalGameplayRuntime<TSnapshot>(
  gameplayRuntime: GameRuntime,
  realtimeMs: number,
  interpolationState: BrushModelInterpolationState<TSnapshot>,
  buildSnapshots: (runtime: GameRuntime) => TSnapshot[],
  cloneSnapshots: (snapshots: TSnapshot[]) => TSnapshot[],
  beforeFrame?: (runtime: GameRuntime) => void
): void {
  const timeSeconds = realtimeMs / 1000;

  while ((gameplayRuntime.time + FRAMETIME) <= (timeSeconds + 0.0001)) {
    interpolationState.previousSnapshots = cloneSnapshots(interpolationState.currentSnapshots);
    interpolationState.previousTime = interpolationState.currentTime;
    beforeFrame?.(gameplayRuntime);
    G_RunFrame(gameplayRuntime);
    interpolationState.currentSnapshots = buildSnapshots(gameplayRuntime);
    interpolationState.currentTime = gameplayRuntime.time;
  }
}

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Keep the local gameplay player entity aligned with predicted movement and mirror the resulting weapon-facing state back into the client runtime.
 *
 * Constraints:
 * - Must update trigger touches after the authoritative pusher frame advance already happened.
 * - Must preserve the existing standalone weapon-motion adaptation until `p_view.c` is ported.
 */
export function updateLocalGameplayPlayer(
  gameplayRuntime: GameRuntime,
  gameplayPlayer: GameEntity,
  runtime: ClientRuntime,
  localViewMotion: LocalViewMotionState
): void {
  gameplayPlayer.origin = [...runtime.cl.predicted_origin];
  gameplayPlayer.s.origin = [...runtime.cl.predicted_origin];
  gameplayPlayer.s.old_origin = [...runtime.cl.predicted_origin];
  gameplayPlayer.viewheight = getPredictedViewheight(runtime);
  applyPredictedGameplayHull(gameplayPlayer, runtime);
  refreshEntitySpatialState(gameplayPlayer);
  linkGameEntity(gameplayRuntime, gameplayPlayer);

  const gameplayClient = gameplayPlayer.client;
  if (gameplayClient) {
    gameplayClient.v_angle = [...runtime.cl.predicted_angles];
    gameplayClient.ps.viewoffset = [0, 0, gameplayPlayer.viewheight];
    gameplayClient.ps.pmove = {
      ...gameplayClient.ps.pmove,
      pm_type: runtime.cl.predicted_pmove.pm_type,
      origin: [...runtime.cl.predicted_pmove.origin],
      velocity: [...runtime.cl.predicted_pmove.velocity],
      pm_flags: runtime.cl.predicted_pmove.pm_flags,
      pm_time: runtime.cl.predicted_pmove.pm_time,
      gravity: runtime.cl.predicted_pmove.gravity,
      delta_angles: [...runtime.cl.predicted_pmove.delta_angles]
    };
    ClientThink(gameplayPlayer, runtime.cl.cmd, gameplayRuntime, LOCAL_GAME_WEAPON_HOOKS);
    updateLocalViewWeaponMotion(gameplayRuntime, gameplayPlayer, gameplayClient, runtime, localViewMotion);
  }

  touchTriggerEntities(gameplayRuntime, gameplayPlayer);
  syncLocalWeaponPlayerState(runtime, gameplayPlayer);
}

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Serialize the current local gameplay visual state into the client frame buffers consumed by the Quake II refresh path.
 *
 * Constraints:
 * - Must preserve stable entity numbering from the gameplay runtime.
 * - Must only expose entities that are currently client-visible.
 */
export function syncLocalGameplayFrame(runtime: ClientRuntime, gameplayRuntime: GameRuntime): void {
  runtime.cls.state = connstate_t.ca_active;
  runtime.cl.refresh_prepped = true;

  syncLocalGameplayConfigstrings(runtime, gameplayRuntime);
  syncLocalGameplayAssetConfigstrings(runtime, gameplayRuntime);
  syncLocalGameplayModelClip(runtime, gameplayRuntime);

  const currentFrameServerframe = runtime.cl.frame.serverframe;
  const previousFrameServerframe = currentFrameServerframe - 1;
  const parseEntityMask = runtime.cl_parse_entities.length - 1;
  const visibleStates = collectVisibleGameplayEntityStates(gameplayRuntime);

  runtime.cl.frame.parse_entities = runtime.cl.parse_entities;
  runtime.cl.frame.num_entities = 0;

  for (const state of visibleStates) {
    const entity = runtime.cl_entities[state.number];
    const storedState = runtime.cl_parse_entities[runtime.cl.parse_entities & parseEntityMask];
    runtime.cl.parse_entities += 1;
    runtime.cl.frame.num_entities += 1;

    const needsNoLerpReset =
      state.modelindex !== entity.current.modelindex ||
      state.modelindex2 !== entity.current.modelindex2 ||
      state.modelindex3 !== entity.current.modelindex3 ||
      state.modelindex4 !== entity.current.modelindex4 ||
      Math.abs(state.origin[0] - entity.current.origin[0]) > 512 ||
      Math.abs(state.origin[1] - entity.current.origin[1]) > 512 ||
      Math.abs(state.origin[2] - entity.current.origin[2]) > 512;

    copyEntityState(state, storedState);

    if (needsNoLerpReset) {
      entity.serverframe = -99;
    }

    if (entity.serverframe === currentFrameServerframe) {
      copyEntityState(entity.current, entity.prev);
    } else if (entity.serverframe !== previousFrameServerframe) {
      entity.trailcount = 1024;
      copyEntityState(storedState, entity.prev);
      entity.prev.origin = [...storedState.old_origin];
      entity.lerp_origin = [...storedState.old_origin];
    } else {
      copyEntityState(entity.current, entity.prev);
    }

    entity.serverframe = currentFrameServerframe;
    copyEntityState(storedState, entity.current);
    entity.current.event = 0;
  }

  syncLocalGameplayTransientEffects(runtime, gameplayRuntime);
}

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Apply gameplay-originated configstring updates to the standalone local client.
 *
 * Constraints:
 * - Must reparse lightstyle configstrings so renderer-facing refresh frames see toggled map lights.
 */
function syncLocalGameplayConfigstrings(runtime: ClientRuntime, gameplayRuntime: GameRuntime): void {
  for (const update of drainGameConfigstringUpdates(gameplayRuntime)) {
    runtime.cl.configstrings[update.index] = update.value;

    if (update.index >= CS_LIGHTS && update.index < CS_LIGHTS + MAX_LIGHTSTYLES) {
      CL_SetLightstyle(runtime, update.index - CS_LIGHTS);
      runtime.cl.last_lightstyle_ofs = -1;
    }
  }
}

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Seed the local client sky configstrings from BSP worldspawn metadata.
 *
 * Constraints:
 * - Must keep the structured client sky state aligned with the raw configstring slots.
 * - Must tolerate maps that omit sky rotation or axis fields.
 */
export function initializeLocalSkyState(runtime: ClientRuntime, map: BspMap): void {
  const worldspawn = map.parsedEntities[0]?.properties ?? {};
  const skyName = worldspawn.sky ?? "";
  const skyRotate = worldspawn.skyrotate ?? "";
  const skyAxis = worldspawn.skyaxis ?? "";
  const cdTrack = worldspawn.sounds ?? "0";

  runtime.cl.configstrings[CS_SKY] = skyName;
  runtime.cl.configstrings[CS_SKYROTATE] = skyRotate;
  runtime.cl.configstrings[CS_SKYAXIS] = skyAxis;
  runtime.cl.configstrings[CS_CDTRACK] = cdTrack;
  runtime.cl.sky.name = skyName;
  runtime.cl.sky.rotate = parseLocalSkyRotate(skyRotate);
  runtime.cl.sky.axis = parseLocalSkyAxis(skyAxis);
}

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Convert the gameplay-side weapon bootstrap payload into the runtime-only client HUD bootstrap contract.
 *
 * Constraints:
 * - Must preserve image, inventory and item-string ordering/value semantics.
 */
export function toLocalClientHudBootstrap(bootstrap: {
  imageNames: string[];
  itemStrings: LocalClientHudBootstrapData["itemStrings"];
  inventory: LocalClientHudBootstrapData["inventory"];
  selectedWeaponIndex: number;
  selectedWeaponIcon: string | null;
  selectedAmmoIndex: number;
  selectedAmmoIcon: string | null;
  selectedAmmoCount: number;
}): LocalClientHudBootstrapData {
  return {
    imageNames: bootstrap.imageNames,
    itemStrings: bootstrap.itemStrings,
    inventory: bootstrap.inventory,
    selectedWeaponIndex: bootstrap.selectedWeaponIndex,
    selectedWeaponIcon: bootstrap.selectedWeaponIcon,
    selectedAmmoIndex: bootstrap.selectedAmmoIndex,
    selectedAmmoIcon: bootstrap.selectedAmmoIcon,
    selectedAmmoCount: bootstrap.selectedAmmoCount
  };
}

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Mirror the local gameplay player's weapon-facing `player_state_t` subset into the client frame.
 */
function syncLocalWeaponPlayerState(runtime: ClientRuntime, gameplayPlayer: GameEntity): void {
  const gameplayClient = gameplayPlayer.client;
  if (!gameplayClient) {
    return;
  }

  runtime.cl.frame.playerstate.gunindex = gameplayClient.ps.gunindex;
  runtime.cl.frame.playerstate.gunframe = gameplayClient.ps.gunframe;
  runtime.cl.frame.playerstate.gunoffset = [...gameplayClient.ps.gunoffset];
  runtime.cl.frame.playerstate.gunangles = [...gameplayClient.ps.gunangles];
  runtime.cl.frame.playerstate.kick_angles = [...gameplayClient.ps.kick_angles];
  runtime.cl.frame.playerstate.viewoffset = [...gameplayClient.ps.viewoffset];
  runtime.cl.frame.playerstate.blend = [...gameplayClient.ps.blend];
  runtime.cl.frame.playerstate.rdflags = gameplayClient.ps.rdflags;

  const selectedWeapon = gameplayClient.pers.weapon;
  const selectedAmmo = GetAmmoItemForWeapon(selectedWeapon);
  runtime.cl.inventory = [...gameplayClient.pers.inventory];
  runtime.cl.frame.playerstate.stats[STAT_HEALTH_ICON] = findClientImageIndex(runtime, "i_health");
  runtime.cl.frame.playerstate.stats[STAT_HEALTH] = gameplayPlayer.health;
  runtime.cl.frame.playerstate.stats[STAT_SELECTED_ITEM] = selectedWeapon?.index ?? 0;
  runtime.cl.frame.playerstate.stats[STAT_SELECTED_ICON] = selectedWeapon?.icon ? findClientImageIndex(runtime, selectedWeapon.icon) : 0;
  runtime.cl.frame.playerstate.stats[STAT_AMMO] = selectedAmmo ? gameplayClient.pers.inventory[selectedAmmo.index] ?? 0 : 0;
  runtime.cl.frame.playerstate.stats[STAT_AMMO_ICON] = selectedAmmo?.icon ? findClientImageIndex(runtime, selectedAmmo.icon) : 0;
  runtime.cl.frame.playerstate.stats[STAT_FLASHES] = gameplayClient.ps.stats[STAT_FLASHES] ?? 0;
  runtime.cl.frame.playerstate.stats[STAT_PICKUP_ICON] = gameplayClient.ps.stats[STAT_PICKUP_ICON] ?? 0;
  runtime.cl.frame.playerstate.stats[STAT_PICKUP_STRING] = gameplayClient.ps.stats[STAT_PICKUP_STRING] ?? 0;
}

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Reproduce the current standalone first-person weapon bob, sway and kick transfer written into `player_state_t`.
 */
function updateLocalViewWeaponMotion(
  gameplayRuntime: GameRuntime,
  gameplayPlayer: GameEntity,
  gameplayClient: NonNullable<GameEntity["client"]>,
  runtime: ClientRuntime,
  localViewMotion: LocalViewMotionState
): void {
  const xyspeed = Math.hypot(
    runtime.cl.predicted_pmove.velocity[0] * 0.125,
    runtime.cl.predicted_pmove.velocity[1] * 0.125
  );

  let bobmove = 0;
  if (xyspeed < 5) {
    localViewMotion.bobtime = 0;
  } else if ((runtime.cl.predicted_pmove.pm_flags & PMF_ON_GROUND) !== 0) {
    if (xyspeed > 210) {
      bobmove = 0.25;
    } else if (xyspeed > 100) {
      bobmove = 0.125;
    } else {
      bobmove = 0.0625;
    }
  }

  localViewMotion.bobtime += bobmove;
  let bobtime = localViewMotion.bobtime;
  if ((runtime.cl.predicted_pmove.pm_flags & PMF_DUCKED) !== 0) {
    bobtime *= 4;
  }

  const bobcycle = Math.trunc(bobtime);
  const bobfracsin = Math.abs(Math.sin(bobtime * Math.PI));

  const kickAngles: vec3_t = [...gameplayClient.kick_angles];
  const damageRatio = (gameplayClient.v_dmg_time - gameplayRuntime.time) / DAMAGE_TIME;
  if (damageRatio > 0) {
    kickAngles[PITCH] += damageRatio * gameplayClient.v_dmg_pitch;
    kickAngles[2] += damageRatio * gameplayClient.v_dmg_roll;
  }
  gameplayClient.ps.kick_angles = kickAngles;

  const visualViewheight = approachValue(
    localViewMotion.viewheight,
    gameplayPlayer.viewheight,
    Math.max(0, runtime.cls.frametime) * LOCAL_VIEWHEIGHT_SMOOTH_SPEED
  );
  localViewMotion.viewheight = visualViewheight;

  const viewoffset: vec3_t = [0, 0, visualViewheight];
  viewoffset[0] += gameplayClient.kick_origin[0];
  viewoffset[1] += gameplayClient.kick_origin[1];
  viewoffset[2] += gameplayClient.kick_origin[2];
  gameplayClient.ps.viewoffset = [
    clamp(viewoffset[0], -14, 14),
    clamp(viewoffset[1], -14, 14),
    clamp(viewoffset[2], -22, 30)
  ];

  const gunangles: vec3_t = [
    xyspeed * bobfracsin * 0.005,
    xyspeed * bobfracsin * 0.01,
    xyspeed * bobfracsin * 0.005
  ];
  if ((bobcycle & 1) !== 0) {
    gunangles[2] = -gunangles[2];
    gunangles[YAW] = -gunangles[YAW];
  }

  for (let index = 0; index < 3; index += 1) {
    let delta = localViewMotion.oldviewangles[index] - runtime.cl.predicted_angles[index];
    if (delta > 180) {
      delta -= 360;
    }
    if (delta < -180) {
      delta += 360;
    }
    delta = clamp(delta, -45, 45);
    if (index === YAW) {
      gunangles[2] += 0.1 * delta;
    }
    gunangles[index] += 0.2 * delta;
  }

  gameplayClient.ps.gunangles = gunangles;
  gameplayClient.ps.gunoffset = [0, 0, 0];
  localViewMotion.oldviewangles = [...runtime.cl.predicted_angles];
  gameplayClient.kick_origin = [0, 0, 0];
  gameplayClient.kick_angles = [0, 0, 0];
}

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Mirror the local gameplay asset registries into the client configstring slots consumed by refresh-side model resolution.
 */
function syncLocalGameplayAssetConfigstrings(runtime: ClientRuntime, gameplayRuntime: GameRuntime): void {
  for (let index = 1; index < runtime.cl.model_draw.length; index += 1) {
    runtime.cl.configstrings[CS_MODELS + index] = gameplayRuntime.assets.modelPaths[index - 1] ?? "";
    runtime.cl.model_draw[index] = runtime.cl.configstrings[CS_MODELS + index] || null;
  }

  for (let index = 1; index < runtime.cl.sound_precache.length; index += 1) {
    runtime.cl.configstrings[CS_SOUNDS + index] = gameplayRuntime.assets.soundPaths[index - 1] ?? "";
    runtime.cl.sound_precache[index] = runtime.cl.configstrings[CS_SOUNDS + index] || null;
  }

  for (let index = 1; index < runtime.cl.image_precache.length; index += 1) {
    runtime.cl.configstrings[CS_IMAGES + index] = gameplayRuntime.assets.imagePaths[index - 1] ?? runtime.cl.configstrings[CS_IMAGES + index] ?? "";
    runtime.cl.image_precache[index] = runtime.cl.configstrings[CS_IMAGES + index] || null;
  }

  for (const item of GetGameItems()) {
    runtime.cl.configstrings[CS_ITEMS + item.index] = item.pickupName;
  }
}

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Mirror the current inline BSP model clip registry into the client-side `model_clip` slots used by `cl_pred.c`.
 *
 * Constraints:
 * - Must only resolve Quake-style inline model names such as `*1`.
 * - Must clear stale clip entries when a configstring no longer references an inline model.
 */
function syncLocalGameplayModelClip(runtime: ClientRuntime, gameplayRuntime: GameRuntime): void {
  const world = gameplayRuntime.collision?.world ?? null;

  for (let index = 0; index < runtime.cl.model_clip.length; index += 1) {
    const modelPath = runtime.cl.configstrings[CS_MODELS + index] ?? "";
    if (!world || !modelPath.startsWith("*")) {
      runtime.cl.model_clip[index] = null;
      continue;
    }

    runtime.cl.model_clip[index] = CM_InlineModel(world, modelPath);
  }
}

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Convert local gameplay one-shot visual events into the client effect pools consumed by refresh adapters.
 *
 * Constraints:
 * - Must keep renderer packages as consumers of `ClientRefreshFrame`, not direct consumers of `GameRuntime`.
 * - Must preserve the original `CL_ParseMuzzleFlash` visual path for locally generated player weapon events.
 */
function syncLocalGameplayTransientEffects(runtime: ClientRuntime, gameplayRuntime: GameRuntime): void {
  for (const event of drainGameTempEntityEvents(gameplayRuntime)) {
    const packet = buildLocalTempEntityPacket(event);
    CL_AddTEntPacket(runtime, packet);
    CL_ExecuteTempEntityEffects(runtime, packet);
    queueLocalGameplayActionSounds(gameplayRuntime, CL_BuildTempEntityEffects(packet));
  }

  for (const event of drainPlayerMuzzleFlashEvents(gameplayRuntime)) {
    const effects = CL_BuildMuzzleFlashEffects({
      entity: event.entityIndex,
      weapon: event.weapon,
      silenced: (event.weapon & MZ_SILENCED) !== 0
    }, runtime);

    applyLocalGameplayActionEffects(runtime, effects);
    queueLocalGameplayActionSounds(gameplayRuntime, effects);
  }

  for (const event of drainMonsterMuzzleFlashEvents(gameplayRuntime)) {
    const effects = CL_BuildMuzzleFlash2Effects({
      entity: event.entityIndex,
      flashNumber: event.flashNumber
    }, runtime);

    applyLocalGameplayActionEffects(runtime, effects);
    queueLocalGameplayActionSounds(gameplayRuntime, effects);
  }
}

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Convert one gameplay temp-entity event into the client packet shape consumed by temp-entity parsers.
 */
function buildLocalTempEntityPacket(event: ReturnType<typeof drainGameTempEntityEvents>[number]): ClientTempEntityPacket {
  const payload = event.payload;
  const origin = readPayloadVec3(payload, "origin") ?? [...event.origin] as vec3_t;
  const start = readPayloadVec3(payload, "start");
  const end = readPayloadVec3(payload, "end");
  const dir = readPayloadVec3(payload, "dir");

  const packet: ClientTempEntityPacket = {
    type: event.type,
    position: start ?? origin
  };

  if (end) {
    packet.position2 = end;
  }
  if (dir) {
    packet.direction = dir;
    packet.directionByte = directionToByte(dir);
  }

  const count = readPayloadNumber(payload, "count");
  if (count !== null) {
    packet.count = count;
  }

  const color = readPayloadNumber(payload, "color");
  if (color !== null) {
    packet.color = color;
  }

  return packet;
}

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Read one optional vector payload field from a local gameplay temp-entity event.
 */
function readPayloadVec3(payload: Record<string, unknown>, key: string): vec3_t | null {
  const value = payload[key];
  if (!Array.isArray(value) || value.length !== 3) {
    return null;
  }
  if (!value.every((component) => typeof component === "number" && Number.isFinite(component))) {
    return null;
  }
  return [value[0], value[1], value[2]];
}

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Read one optional numeric payload field from a local gameplay temp-entity event.
 */
function readPayloadNumber(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Convert a local event direction vector into the closest Quake II byte-normal index.
 */
function directionToByte(dir: vec3_t): number {
  let bestd = 0;
  let best = 0;
  for (let index = 0; index < BYTE_DIRS.length; index += 1) {
    const d = DotProduct(dir, BYTE_DIRS[index]!);
    if (d > bestd) {
      bestd = d;
      best = index;
    }
  }
  return best;
}

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Apply client action effects generated by local gameplay events to the client refresh pools.
 */
function applyLocalGameplayActionEffects(runtime: ClientRuntime, effects: ClientActionEffect[]): void {
  for (const effect of effects) {
    if (effect.light && effect.position && effect.entity !== undefined) {
      const dlight = CL_AllocDlight(runtime, effect.entity);
      dlight.origin = [...effect.position];
      dlight.radius = effect.light.radius;
      dlight.minlight = effect.light.minlight ?? 0;
      dlight.die = runtime.cl.time + effect.light.durationMs;
      dlight.decay = 0;
      dlight.color = [...effect.light.color];
    }

    if (
      effect.position &&
      effect.packet &&
      "weapon" in effect.packet &&
      (effect.kind === "login" || effect.kind === "logout" || effect.kind === "respawn")
    ) {
      CL_LogoutEffect(runtime, effect.position, effect.packet.weapon & ~MZ_SILENCED);
    } else if (effect.kind === "particle-effect" && effect.position) {
      CL_ParticleEffect(runtime, effect.position, [0, 0, 0], effect.color ?? 0, effect.count ?? 0);
    } else if (effect.kind === "smoke-and-flash" && effect.position) {
      CL_SmokeAndFlash(runtime, effect.position);
    }
  }
}

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Queue sounds produced by local gameplay visual effects through the gameplay sound-event bridge.
 */
function queueLocalGameplayActionSounds(gameplayRuntime: GameRuntime, effects: ClientActionEffect[]): void {
  for (const effect of effects) {
    if (!effect.sound) {
      continue;
    }

    const soundIndex = registerGameSound(gameplayRuntime, effect.sound.name);
    const entity = effect.entity !== undefined ? gameplayRuntime.entities[effect.entity] ?? null : null;
    const options: Parameters<typeof emitRegisteredGameSound>[4] = {
      origin: effect.position ?? null,
      channel: effect.sound.channel,
      attenuation: effect.sound.attenuation
    };
    if (effect.sound.volume !== undefined) {
      options.volume = effect.sound.volume;
    }
    if (effect.sound.delayMs !== undefined) {
      options.timeofs = effect.sound.delayMs / 1000;
    }

    emitRegisteredGameSound(gameplayRuntime, entity, soundIndex, effect.sound.name, options);
  }
}

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Collect the current gameplay entities that should surface through the client entity snapshot path.
 */
function collectVisibleGameplayEntityStates(gameplayRuntime: GameRuntime): entity_state_t[] {
  const states: entity_state_t[] = [];

  for (const entity of gameplayRuntime.entities) {
    if (!entity.inuse || entity.index >= MAX_EDICTS || (entity.svflags & SVF_NOCLIENT) !== 0) {
      continue;
    }

    const state = entity.s;
    const hasVisualState =
      state.modelindex !== 0 ||
      state.modelindex2 !== 0 ||
      state.modelindex3 !== 0 ||
      state.modelindex4 !== 0 ||
      state.effects !== 0 ||
      state.renderfx !== 0 ||
      state.sound !== 0 ||
      state.event !== 0;

    if (!hasVisualState) {
      continue;
    }

    states.push(cloneEntityState(state));
  }

  states.sort((left, right) => left.number - right.number);
  return states;
}

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Clone one entity state while preserving the exact field set used by Quake II packet entities.
 */
function cloneEntityState(state: entity_state_t): entity_state_t {
  const clone = createEntityState();
  copyEntityState(state, clone);
  return clone;
}

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Copy one entity-state payload field-by-field without sharing tuple references.
 */
function copyEntityState(source: entity_state_t, target: entity_state_t): void {
  target.number = source.number;
  target.origin = [...source.origin];
  target.angles = [...source.angles];
  target.old_origin = [...source.old_origin];
  target.modelindex = source.modelindex;
  target.modelindex2 = source.modelindex2;
  target.modelindex3 = source.modelindex3;
  target.modelindex4 = source.modelindex4;
  target.frame = source.frame;
  target.skinnum = source.skinnum;
  target.effects = source.effects;
  target.renderfx = source.renderfx;
  target.solid = source.solid;
  target.sound = source.sound;
  target.event = source.event;
}

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Apply the predicted Quake II player hull to the local gameplay proxy so runtime collision and triggers use the same crouch state as prediction.
 */
function applyPredictedGameplayHull(gameplayPlayer: GameEntity, runtime: ClientRuntime): void {
  const pmove = runtime.cl.predicted_pmove;
  if (pmove.pm_type === pmtype_t.PM_GIB) {
    gameplayPlayer.mins = [...PLAYER_GIB_MINS];
    gameplayPlayer.maxs = [...PLAYER_GIB_MAXS];
    return;
  }

  gameplayPlayer.mins = [...PLAYER_TRIGGER_MINS];
  gameplayPlayer.maxs = (pmove.pm_flags & PMF_DUCKED) !== 0
    ? [...PLAYER_DUCKED_MAXS]
    : [...PLAYER_TRIGGER_MAXS];
}

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Clamp one numeric value into one closed interval for the current local weapon-motion adaptation.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Move one numeric value toward a target by a bounded step for local visual smoothing.
 */
function approachValue(current: number, target: number, step: number): number {
  if (current < target) {
    return Math.min(current + step, target);
  }

  if (current > target) {
    return Math.max(current - step, target);
  }

  return target;
}

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Parse one local BSP worldspawn `skyrotate` property into the standalone client bootstrap state.
 */
function parseLocalSkyRotate(value: string): number {
  const parsed = Number.parseFloat(value.trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Original name: N/A
 * Source: N/A (local gameplay sync bridge)
 * Category: New
 * Purpose: Parse one local BSP worldspawn `skyaxis` property into a three-component axis tuple.
 */
function parseLocalSkyAxis(value: string): [number, number, number] {
  const parts = value
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => Number.parseFloat(part));

  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return [0, 0, 0];
  }

  return [parts[0], parts[1], parts[2]];
}
