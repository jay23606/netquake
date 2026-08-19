/**
 * File: local-session.ts
 * Purpose: Hold the standalone local session bootstrap and fixed-step orchestration that should not live inside a browser adapter.
 *
 * This file is not a direct source port.
 * It is a runtime-side coordinator for the current standalone local client/gameplay loop.
 *
 * Dependencies:
 * - packages/client/src/local-loop.ts
 * - packages/client/src/local-gameplay-sync.ts
 * - packages/client/src/local-client-bootstrap.ts
 * - packages/game
 * - packages/qcommon
 * - packages/formats
 */

import type { BspMap, BspSpawnPoint } from "../../formats/src/index.js";
import {
  initializeDoorPlanEntities,
  buildLocalWeaponBootstrapData,
  ClientBeginServerFrame,
  createLocalGameplayPlayer,
  createGameRuntimeFromBspMap,
  LOCAL_GAME_WEAPON_HOOKS,
  refillLocalDemoInventory,
  type GameEntity,
  type GameRuntime
} from "../../game/src/index.js";
import {
  CS_AIRACCEL,
  type usercmd_t,
  type vec3_t
} from "../../qcommon/src/index.js";
import {
  advanceLocalGameplayRuntime,
  syncLocalGameplayFrame,
  updateLocalGameplayPlayer,
  initializeLocalSkyState,
  createLocalViewMotionState,
  toLocalClientHudBootstrap,
  type BrushModelInterpolationState,
  type LocalViewMotionState
} from "./local-gameplay-sync.js";
import {
  applyLocalMovementMode,
  cloneLocalUsercmd as cloneStandaloneUsercmd,
  initializeLocalSpawnPrediction,
  promoteLocalPredictedState,
  type LocalClientCollisionAdapter
} from "./local-loop.js";
import { createClientPredictionCollisionSource } from "./cl_pred.js";
import {
  initializeLocalHudState,
} from "./local-client-bootstrap.js";
import {
  setLocalButtonHeld,
  syncLocalMovementButtons
} from "./local-input.js";
import type { ClientInputContext } from "./cl_input.js";
import { connstate_t, type ClientRuntime } from "./client.js";

/**
 * Original name: N/A
 * Source: N/A (local session default)
 * Category: New
 * Purpose: Lift standalone local-session spawns enough to match the expected player hull placement.
 */
const DEFAULT_SPAWN_LIFT = 24;

/**
 * Original name: N/A
 * Source: N/A (local session default)
 * Category: New
 * Purpose: Seed the standalone local-session view height before regular prediction owns the field.
 */
const DEFAULT_VIEWHEIGHT = 22;

/**
 * Original name: N/A
 * Source: N/A (local session coordinator)
 * Category: New
 * Purpose: Preserve the runtime-side state that drives the standalone local prediction/gameplay loop.
 *
 * Constraints:
 * - Must remain browser-agnostic so adapters own DOM and camera wiring.
 */
export interface LocalClientSessionState<TSnapshot> {
  gameplayRuntime: GameRuntime;
  gameplayPlayer: GameEntity;
  brushModelInterpolation: BrushModelInterpolationState<TSnapshot>;
  localViewMotion: LocalViewMotionState;
  realtimeMs: number;
  nextCommandSequence: number;
  ghostMode: boolean;
  refillDemoInventoryEachFrame: boolean;
}

/**
 * Original name: N/A
 * Source: N/A (local session coordinator)
 * Category: New
 * Purpose: Describe the movement/attack input snapshot consumed by the standalone local session step.
 *
 * Constraints:
 * - Must stay renderer- and browser-agnostic.
 */
export interface LocalClientSessionInputState {
  pressedKeys: Record<string, boolean>;
  attackPressed: boolean;
  useBoundInput?: boolean;
}

/**
 * Original name: N/A
 * Source: N/A (local session coordinator)
 * Category: New
 * Purpose: Describe the snapshot callbacks required to keep moving BSP submodels interpolated outside the adapter.
 *
 * Constraints:
 * - Must stay generic so the client runtime does not depend on one renderer package.
 */
export interface LocalClientSessionSnapshotHooks<TSnapshot> {
  buildSnapshots: (runtime: GameRuntime) => TSnapshot[];
  cloneSnapshots: (snapshots: TSnapshot[]) => TSnapshot[];
}

/**
 * Original name: N/A
 * Source: N/A (local session coordinator)
 * Category: New
 * Purpose: Keep standalone-demo conveniences explicit instead of making every local session inherit them.
 */
export interface LocalClientSessionOptions {
  demoInventory?: boolean;
  ghostMode?: boolean;
  refillDemoInventoryEachFrame?: boolean;
}

/**
 * Original name: N/A
 * Source: N/A (local session coordinator)
 * Category: New
 * Purpose: Build the standalone local client/gameplay session state for one BSP map without leaving the bootstrap in a web adapter.
 *
 * Constraints:
 * - Must only depend on runtime/gameplay abstractions plus collision callbacks.
 */
export function initializeLocalClientSession<TSnapshot>(
  runtime: ClientRuntime,
  map: BspMap,
  spawn: BspSpawnPoint | null,
  createCollisionAdapter: (gameplayRuntime: GameRuntime, gameplayPlayer: GameEntity) => LocalClientCollisionAdapter,
  snapshotHooks: LocalClientSessionSnapshotHooks<TSnapshot>,
  options: LocalClientSessionOptions = {}
): LocalClientSessionState<TSnapshot> {
  const demoInventory = options.demoInventory ?? true;
  const gameplayRuntime = createGameRuntimeFromBspMap(map);
  initializeDoorPlanEntities(gameplayRuntime);
  const gameplayPlayer = createLocalGameplayPlayer(gameplayRuntime, { seedDemoInventory: demoInventory });
  const localWeaponBootstrap = buildLocalWeaponBootstrapData();
  const collision = createCollisionAdapter(gameplayRuntime, gameplayPlayer);

  const spawnOrigin: vec3_t = spawn
    ? [spawn.origin[0], spawn.origin[1], spawn.origin[2] + DEFAULT_SPAWN_LIFT]
    : [0, 0, DEFAULT_SPAWN_LIFT];
  const spawnYaw = spawn?.angle ?? 0;

  runtime.cls.state = connstate_t.ca_active;
  runtime.cl.frame.valid = true;
  runtime.cl.frame.serverframe = 0;
  runtime.cl.frame.servertime = 0;
  runtime.cl.frame.playerstate.pmove.pm_type = 0;
  runtime.cl.frame.playerstate.pmove.origin = [
    Math.trunc(spawnOrigin[0] * 8),
    Math.trunc(spawnOrigin[1] * 8),
    Math.trunc(spawnOrigin[2] * 8)
  ];
  runtime.cl.frame.playerstate.pmove.velocity = [0, 0, 0];
  runtime.cl.frame.playerstate.pmove.gravity = 800;
  runtime.cl.frame.playerstate.pmove.delta_angles = [0, 0, 0];
  runtime.cl.frame.playerstate.viewoffset = [0, 0, DEFAULT_VIEWHEIGHT];
  runtime.cl.frame.playerstate.viewangles = [0, spawnYaw, 0];
  runtime.cl.viewangles = [0, spawnYaw, 0];
  runtime.cl.predicted_viewheight = DEFAULT_VIEWHEIGHT;
  runtime.cl.predicted_origin = [...spawnOrigin];
  runtime.cl.predicted_angles = [0, spawnYaw, 0];
  runtime.cl.configstrings[CS_AIRACCEL] = "0";

  initializeLocalSpawnPrediction(runtime, collision, spawnOrigin);
  initializeLocalHudState(runtime, toLocalClientHudBootstrap(localWeaponBootstrap));
  initializeLocalSkyState(runtime, map);
  syncLocalGameplayFrame(runtime, gameplayRuntime);

  const initialSnapshots = snapshotHooks.buildSnapshots(gameplayRuntime);
  const brushModelInterpolation: BrushModelInterpolationState<TSnapshot> = {
    previousSnapshots: snapshotHooks.cloneSnapshots(initialSnapshots),
    currentSnapshots: snapshotHooks.cloneSnapshots(initialSnapshots),
    previousTime: gameplayRuntime.time,
    currentTime: gameplayRuntime.time
  };

  return {
    gameplayRuntime,
    gameplayPlayer,
    brushModelInterpolation,
    localViewMotion: createLocalViewMotionState(spawnYaw),
    realtimeMs: 0,
    nextCommandSequence: 1,
    ghostMode: options.ghostMode ?? true,
    refillDemoInventoryEachFrame: options.refillDemoInventoryEachFrame ?? demoInventory
  };
}

/**
 * Original name: N/A
 * Source: N/A (local session coordinator)
 * Category: New
 * Purpose: Advance one standalone local client/gameplay frame without involving any browser or renderer objects.
 *
 * Constraints:
 * - Must preserve the current local prediction, gameplay and refresh-frame ordering.
 */
export function stepLocalClientSession<TSnapshot>(
  runtime: ClientRuntime,
  inputContext: ClientInputContext,
  session: LocalClientSessionState<TSnapshot>,
  inputState: LocalClientSessionInputState,
  collision: LocalClientCollisionAdapter,
  createCmd: (context: ClientInputContext, options: { anykeydown: boolean; key_game_active: boolean; }) => usercmd_t,
  predictMovement: (
    runtime: ClientRuntime,
    options: {
      predictMovement: boolean;
      paused: boolean;
      incomingAcknowledged: number;
      outgoingSequence: number;
      predictionCollision?: ReturnType<typeof createClientPredictionCollisionSource>;
      trace?: LocalClientCollisionAdapter["trace"];
      pointcontents?: LocalClientCollisionAdapter["pointcontents"];
    }
  ) => void,
  snapshotHooks: LocalClientSessionSnapshotHooks<TSnapshot>
): void {
  session.realtimeMs += runtime.cls.frametime * 1000;
  runtime.cls.realtime = session.realtimeMs;
  runtime.cl.time = session.realtimeMs;
  runtime.cl.frame.serverframe = session.nextCommandSequence;
  runtime.cl.frame.servertime = session.realtimeMs;

  applyLocalMovementMode(runtime, session.ghostMode);
  if (session.refillDemoInventoryEachFrame) {
    refillLocalDemoInventory(session.gameplayPlayer, session.gameplayRuntime);
  }
  advanceLocalGameplayRuntime(
    session.gameplayRuntime,
    session.realtimeMs,
    session.brushModelInterpolation,
    snapshotHooks.buildSnapshots,
    snapshotHooks.cloneSnapshots,
    (gameplayRuntime) => {
      ClientBeginServerFrame(session.gameplayPlayer, gameplayRuntime, LOCAL_GAME_WEAPON_HOOKS);
    }
  );

  if (!inputState.useBoundInput) {
    syncLocalMovementButtons(inputContext, inputState.pressedKeys, session.realtimeMs);
    setLocalButtonHeld(inputContext.in_attack, inputState.attackPressed, session.realtimeMs);
  }

  const cmd = createCmd(inputContext, {
    anykeydown: Object.values(inputState.pressedKeys).some(Boolean),
    key_game_active: true
  });

  const frameIndex = session.nextCommandSequence & 63;
  runtime.cl.cmd = cmd;
  runtime.cl.cmds[frameIndex] = cloneStandaloneUsercmd(cmd);
  runtime.cl.cmd_time[frameIndex] = session.realtimeMs;

  // Keep the parsed client-side entity snapshot aligned with the latest gameplay
  // frame before building the `cl_pred.c`-style collision source.
  syncLocalGameplayFrame(runtime, session.gameplayRuntime);

  const predictionCollision =
    session.gameplayRuntime.collision
      ? createClientPredictionCollisionSource(runtime, session.gameplayRuntime.collision.world)
      : undefined;

  predictMovement(runtime, {
    predictMovement: true,
    paused: false,
    incomingAcknowledged: session.nextCommandSequence - 1,
    outgoingSequence: session.nextCommandSequence + 1,
    ...(predictionCollision
      ? { predictionCollision }
      : {
          trace: collision.trace,
          pointcontents: collision.pointcontents
        })
  });

  promoteLocalPredictedState(runtime, session.realtimeMs);
  updateLocalGameplayPlayer(session.gameplayRuntime, session.gameplayPlayer, runtime, session.localViewMotion);
  syncLocalGameplayFrame(runtime, session.gameplayRuntime);
  session.nextCommandSequence += 1;
}
