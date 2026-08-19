/**
 * File: g_main.ts
 * Source: Quake II original / game/g_main.c
 * Purpose: Port of the main gameplay module entry points and exported game API wiring.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - The original file-scope globals are grouped into an explicit `GameMainContext`.
 * - Persistence entry points are delegated to the `game/g_save.c` port in `g_save.ts`.
 * - `SpawnEntities` is owned by the split `game/g_spawn.c` port in `g_spawn.ts`.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

import {
  CVAR_ARCHIVE,
  CVAR_LATCH,
  CVAR_NOSET,
  CVAR_SERVERINFO,
  CVAR_USERINFO,
  CS_PLAYERSKINS,
  DF_SAME_LEVEL,
  MZ_LOGIN,
  MZ_LOGOUT,
  PRINT_HIGH,
  Q_stricmp,
  multicast_t,
  temp_event_t,
  type cvar_t,
  type qboolean,
  type usercmd_t,
  type vec3_t
} from "../../qcommon/src/index.js";
import { Info_ValueForKey } from "../../qcommon/src/common.js";
import { GAME_API_VERSION, type edict_t, type game_export_t, type game_import_t } from "./game.js";
import {
  FL_FLY,
  FL_SWIM,
  FRAMETIME,
  GAMEVERSION,
  SVF_MONSTER,
  svc_layout,
  svc_muzzleflash,
  svc_muzzleflash2,
  svc_stufftext,
  svc_temp_entity,
  TAG_GAME,
  TAG_LEVEL,
  createGameLocals,
  createLevelLocals,
  type game_locals_t,
  type level_locals_t
} from "./g_local.js";
import { AI_SetSightClient } from "./g_ai.js";
import { InitItems } from "./g_items.js";
import { G_RunEntity } from "./g_phys.js";
import { M_CheckGround } from "./g_monster.js";
import type { GameHudHooks } from "./p_hud.js";
import { BeginIntermission } from "./p_hud.js";
import type { GamePlayerClientHooks } from "./p_client.js";
import {
  ClientBegin,
  ClientBeginServerFrame,
  ClientConnect,
  ClientDisconnect,
  ClientThink,
  ClientUserinfoChanged
} from "./p_client.js";
import { ClientEndServerFrame } from "./p_view.js";
import { ClientCommand as ClientCommand_Cmds } from "./g_cmds.js";
import { SpawnEntities } from "./g_spawn.js";
import { G_Find, G_Spawn } from "./g_utils.js";
import {
  createGameRuntimeFromBspEntities,
  drainGameConfigstringUpdates,
  drainGameCprintfEvents,
  drainMonsterMuzzleFlashEvents,
  drainPlayerMuzzleFlashEvents,
  drainGameSoundEvents,
  drainGameTempEntityEvents,
  emitGameTempEntity,
  type GameEntity,
  type GameRuntime
} from "./runtime.js";
import {
  SV_FilterPacket,
  ServerCommand as ServerCommand_Svcmds,
  createGameServerCommandState,
  type GameServerCommandState
} from "./g_svcmds.js";
import {
  ReadGame as ReadGame_Save,
  ReadLevel as ReadLevel_Save,
  WriteGame as WriteGame_Save,
  WriteLevel as WriteLevel_Save
} from "./g_save.js";

/**
 * Original name: N/A
 * Source declaree: N/A (explicit TS context for grouped cvars)
 * Category: New
 * Purpose: Group the Quake II gameplay cvars touched directly by the first `g_main.c` port.
 */
export interface GameMainCvars {
  deathmatch: cvar_t | null;
  coop: cvar_t | null;
  dmflags: cvar_t | null;
  skill: cvar_t | null;
  fraglimit: cvar_t | null;
  timelimit: cvar_t | null;
  password: cvar_t | null;
  spectator_password: cvar_t | null;
  maxclients: cvar_t | null;
  maxspectators: cvar_t | null;
  maxentities: cvar_t | null;
  g_select_empty: cvar_t | null;
  dedicated: cvar_t | null;
  sv_cheats: cvar_t | null;
  flood_msgs: cvar_t | null;
  flood_persecond: cvar_t | null;
  flood_waitdelay: cvar_t | null;
  filterban: cvar_t | null;
  sv_gravity: cvar_t | null;
  sv_maxvelocity: cvar_t | null;
  sv_rollspeed: cvar_t | null;
  sv_rollangle: cvar_t | null;
  gun_x: cvar_t | null;
  gun_y: cvar_t | null;
  gun_z: cvar_t | null;
  run_pitch: cvar_t | null;
  run_roll: cvar_t | null;
  bob_up: cvar_t | null;
  bob_pitch: cvar_t | null;
  bob_roll: cvar_t | null;
  sv_maplist: cvar_t | null;
}

/**
 * Original name: N/A
 * Source declaree: N/A (explicit TS context replacing file-scope globals)
 * Category: New
 * Purpose: Carry the explicit gameplay-module context that replaces the original `g_main.c` globals.
 */
export interface GameMainContext {
  gi: game_import_t;
  runtime: GameRuntime;
  game: game_locals_t;
  level: level_locals_t;
  serverCommands: GameServerCommandState;
  cvars: GameMainCvars;
  hooks: GameMainHooks;
  lastClientConnectRejectMessage: string;
}

/**
 * Original name: N/A
 * Source declaree: N/A (TS callback surface for host integration)
 * Category: New
 * Purpose: Group the still-external callbacks used by the first `g_main.c` port.
 */
export interface GameMainHooks extends GamePlayerClientHooks, GameHudHooks {
  readFile?: (path: string) => string | Uint8Array | null | undefined;
  writeFile?: (path: string, contents: string) => boolean;
  onClientCommand?: (ent: GameEntity, runtime: GameRuntime) => void;
}

/**
 * Original name: N/A
 * Source declaree: N/A (TS options object for context construction)
 * Category: New
 * Purpose: Configure one `GetGameApi` context build.
 */
export interface GameMainContextOptions {
  runtime?: GameRuntime;
  hooks?: GameMainHooks;
}

/**
 * Original name: ShutdownGame
 * Source: game/g_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the original shutdown banner and releases the game/tag pools through the engine import API.
 */
export function ShutdownGame(context: GameMainContext): void {
  context.gi.dprintf("==== ShutdownGame ====\n");
  context.gi.FreeTags(TAG_LEVEL);
  context.gi.FreeTags(TAG_GAME);
}

/**
 * Original name: ClientEndServerFrames
 * Source: game/g_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Finalizes the player-visible state for all active clients after the main entity frame has run.
 *
 * Porting notes:
 * - Uses a currently reduced `ClientEndServerFrame` implementation until `game/p_view.c` is ported.
 */
export function ClientEndServerFrames(context: GameMainContext): void {
  syncGameHelpState(context);

  for (let index = 0; index < context.runtime.maxclients; index += 1) {
    const ent = context.runtime.entities[1 + index] ?? null;
    if (!ent?.inuse || !ent.client) {
      continue;
    }

    const viewOptions: {
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
    } = {};
    assignCvarValue(viewOptions, "sv_rollangle", context.cvars.sv_rollangle);
    assignCvarValue(viewOptions, "sv_rollspeed", context.cvars.sv_rollspeed);
    assignCvarValue(viewOptions, "run_pitch", context.cvars.run_pitch);
    assignCvarValue(viewOptions, "run_roll", context.cvars.run_roll);
    assignCvarValue(viewOptions, "bob_up", context.cvars.bob_up);
    assignCvarValue(viewOptions, "bob_pitch", context.cvars.bob_pitch);
    assignCvarValue(viewOptions, "bob_roll", context.cvars.bob_roll);
    assignCvarValue(viewOptions, "gun_x", context.cvars.gun_x);
    assignCvarValue(viewOptions, "gun_y", context.cvars.gun_y);
    assignCvarValue(viewOptions, "gun_z", context.cvars.gun_z);
    ClientEndServerFrame(ent, context.runtime, viewOptions);
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (split runtime adapter)
 * Category: Adapter
 * Purpose: Keep the split TS game/runtime help fields equivalent to the original `game_locals_t game` global.
 *
 * Porting notes:
 * - Direct runtime helpers such as `target_help` can mutate the runtime mirror, while save/client-command paths still
 *   own the `game_locals_t` block. The monotonic `helpchanged` counter identifies the newer side.
 */
function syncGameHelpState(context: GameMainContext): void {
  if (context.runtime.helpchanged > context.game.helpchanged) {
    context.game.helpmessage1 = context.runtime.helpmessage1;
    context.game.helpmessage2 = context.runtime.helpmessage2;
    context.game.helpchanged = context.runtime.helpchanged;
    return;
  }

  context.runtime.helpmessage1 = context.game.helpmessage1;
  context.runtime.helpmessage2 = context.game.helpmessage2;
  context.runtime.helpchanged = context.game.helpchanged;
}

/**
 * Original name: InitGame
 * Source: game/g_save.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Initializes the gameplay runtime-facing cvars and the shared item count exposed by the game module.
 */
export function InitGame(context: GameMainContext): void {
  context.gi.dprintf("==== InitGame ====\n");

  context.cvars.deathmatch = context.gi.cvar("deathmatch", "0", CVAR_LATCH);
  context.cvars.coop = context.gi.cvar("coop", "0", CVAR_LATCH);
  context.cvars.dmflags = context.gi.cvar("dmflags", "0", CVAR_SERVERINFO);
  context.cvars.skill = context.gi.cvar("skill", "1", CVAR_LATCH);
  context.cvars.fraglimit = context.gi.cvar("fraglimit", "0", CVAR_SERVERINFO);
  context.cvars.timelimit = context.gi.cvar("timelimit", "0", CVAR_SERVERINFO);
  context.cvars.password = context.gi.cvar("password", "", CVAR_USERINFO);
  context.cvars.spectator_password = context.gi.cvar("spectator_password", "", CVAR_USERINFO);
  context.cvars.maxclients = context.gi.cvar("maxclients", "4", CVAR_SERVERINFO | CVAR_LATCH);
  context.cvars.maxspectators = context.gi.cvar("maxspectators", "4", CVAR_SERVERINFO);
  context.cvars.maxentities = context.gi.cvar("maxentities", "1024", CVAR_LATCH);
  context.cvars.g_select_empty = context.gi.cvar("g_select_empty", "0", CVAR_ARCHIVE);
  context.cvars.dedicated = context.gi.cvar("dedicated", "0", CVAR_NOSET);
  context.cvars.sv_cheats = context.gi.cvar("cheats", "0", CVAR_SERVERINFO | CVAR_LATCH);
  context.gi.cvar("gamename", GAMEVERSION, CVAR_SERVERINFO | CVAR_LATCH);
  context.gi.cvar("gamedate", GAME_BUILD_DATE, CVAR_SERVERINFO | CVAR_LATCH);
  context.cvars.flood_msgs = context.gi.cvar("flood_msgs", "4", 0);
  context.cvars.flood_persecond = context.gi.cvar("flood_persecond", "4", 0);
  context.cvars.flood_waitdelay = context.gi.cvar("flood_waitdelay", "10", 0);
  context.cvars.filterban = context.gi.cvar("filterban", "1", 0);
  context.cvars.sv_gravity = context.gi.cvar("sv_gravity", "800", 0);
  context.cvars.sv_maxvelocity = context.gi.cvar("sv_maxvelocity", "2000", 0);
  context.cvars.sv_rollspeed = context.gi.cvar("sv_rollspeed", "200", 0);
  context.cvars.sv_rollangle = context.gi.cvar("sv_rollangle", "2", 0);
  context.cvars.gun_x = context.gi.cvar("gun_x", "0", 0);
  context.cvars.gun_y = context.gi.cvar("gun_y", "0", 0);
  context.cvars.gun_z = context.gi.cvar("gun_z", "0", 0);
  context.cvars.run_pitch = context.gi.cvar("run_pitch", "0.002", 0);
  context.cvars.run_roll = context.gi.cvar("run_roll", "0.005", 0);
  context.cvars.bob_up = context.gi.cvar("bob_up", "0.005", 0);
  context.cvars.bob_pitch = context.gi.cvar("bob_pitch", "0.002", 0);
  context.cvars.bob_roll = context.gi.cvar("bob_roll", "0.002", 0);
  context.cvars.sv_maplist = context.gi.cvar("sv_maplist", "", 0);

  context.game.num_items = InitItems();
  applyMainCvarsToRuntime(context);
}

/**
 * Original name: G_RunFrame
 * Source: game/g_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Advances the gameplay world by one frame, then finalizes all active client views/HUD state.
 */
export function G_RunFrame(context: GameMainContext): void {
  context.runtime.framenum += 1;
  context.runtime.time = context.runtime.framenum * FRAMETIME;
  syncLevelFromRuntime(context);
  AI_SetSightClient(context.runtime);

  if (context.level.exitintermission) {
    ExitLevel(context);
    return;
  }

  const clientFrameHooks = createClientUserinfoHooks(context);
  for (let index = 0; index < context.runtime.entities.length; index += 1) {
    const ent = context.runtime.entities[index] ?? null;
    if (!ent?.inuse) {
      continue;
    }

    context.runtime.current_entity = ent;
    ent.s.old_origin = [...ent.s.origin];

    if (ent.groundentity && ent.groundentity.linkcount !== ent.groundentity_linkcount) {
      ent.groundentity = null;
      if ((ent.flags & (FL_SWIM | FL_FLY)) === 0 && (ent.svflags & SVF_MONSTER) !== 0) {
        M_CheckGround(ent, context.runtime);
      }
    }

    if (index > 0 && index <= context.runtime.maxclients) {
      ClientBeginServerFrame(ent, context.runtime, clientFrameHooks);
      continue;
    }

    G_RunEntity(ent, context.runtime);
  }

  context.runtime.current_entity = null;
  syncLevelFromRuntime(context);
  CheckDMRules(context);
  ClientEndServerFrames(context);
  flushRuntimeEngineEvents(context);
}

/**
 * Original name: CreateTargetChangeLevel
 * Source: game/g_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Creates a temporary `target_changelevel` entity wired to the chosen destination map.
 */
export function CreateTargetChangeLevel(context: GameMainContext, map: string): GameEntity {
  const ent = G_Spawn(context.runtime);
  ent.classname = "target_changelevel";
  context.level.nextmap = map;
  ent.map = context.level.nextmap;
  return ent;
}

/**
 * Original name: EndDMLevel
 * Source: game/g_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Chooses the next deathmatch map using the original same-level, maplist and target-changelevel precedence.
 */
export function EndDMLevel(context: GameMainContext): void {
  if ((context.runtime.dmflags & DF_SAME_LEVEL) !== 0) {
    BeginIntermission(CreateTargetChangeLevel(context, context.level.mapname), context.runtime, context.hooks);
    syncLevelFromRuntime(context);
    return;
  }

  const maplist = context.cvars.sv_maplist?.string ?? "";
  if (maplist.length > 0) {
    const maps = tokenizeMapList(maplist);
    const currentIndex = maps.findIndex((map) => stringsEqualIgnoreCase(map, context.level.mapname));
    if (currentIndex >= 0) {
      const nextMap = maps[currentIndex + 1] ?? maps[0] ?? context.level.mapname;
      BeginIntermission(CreateTargetChangeLevel(context, nextMap), context.runtime, context.hooks);
      syncLevelFromRuntime(context);
      return;
    }
  }

  if (context.level.nextmap.length > 0) {
    BeginIntermission(CreateTargetChangeLevel(context, context.level.nextmap), context.runtime, context.hooks);
    syncLevelFromRuntime(context);
    return;
  }

  const changelevel = G_Find(context.runtime, null, "classname", "target_changelevel");
  if (!changelevel) {
    BeginIntermission(CreateTargetChangeLevel(context, context.level.mapname), context.runtime, context.hooks);
    syncLevelFromRuntime(context);
    return;
  }

  BeginIntermission(changelevel, context.runtime, context.hooks);
  syncLevelFromRuntime(context);
}

/**
 * Original name: CheckDMRules
 * Source: game/g_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Ends the current deathmatch when the configured time or frag limit is reached.
 */
export function CheckDMRules(context: GameMainContext): void {
  syncLevelFromRuntime(context);

  if (context.level.intermissiontime) {
    return;
  }

  if (!context.runtime.deathmatch) {
    return;
  }

  const timelimit = context.cvars.timelimit?.value ?? 0;
  if (timelimit !== 0 && context.level.time >= (timelimit * 60)) {
    context.gi.bprintf(PRINT_HIGH, "Timelimit hit.\n");
    EndDMLevel(context);
    return;
  }

  const fraglimit = context.cvars.fraglimit?.value ?? 0;
  if (fraglimit === 0) {
    return;
  }

  for (let index = 0; index < context.runtime.maxclients; index += 1) {
    const ent = context.runtime.entities[index + 1] ?? null;
    const client = ent?.client;
    if (!ent?.inuse || !client) {
      continue;
    }

    if (client.resp.score >= fraglimit) {
      context.gi.bprintf(PRINT_HIGH, "Fraglimit hit.\n");
      EndDMLevel(context);
      return;
    }
  }
}

/**
 * Original name: ExitLevel
 * Source: game/g_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Issues the deferred `gamemap` command and clears the intermission state before the next level starts.
 */
export function ExitLevel(context: GameMainContext): void {
  const changemap = context.level.changemap ?? context.runtime.changemap;
  context.gi.AddCommandString(`gamemap "${changemap ?? ""}"\n`);

  context.level.changemap = null;
  context.runtime.changemap = null;
  context.level.exitintermission = 0;
  context.runtime.exitintermission = 0;
  context.level.intermissiontime = 0;
  context.runtime.intermissiontime = 0;

  ClientEndServerFrames(context);

  for (let index = 0; index < context.runtime.maxclients; index += 1) {
    const ent = context.runtime.entities[index + 1] ?? null;
    const client = ent?.client;
    if (!ent?.inuse || !client) {
      continue;
    }

    if (ent.health > client.pers.max_health) {
      ent.health = client.pers.max_health;
    }
  }
}

/**
 * Original name: GetGameAPI
 * Source: game/g_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Builds the gameplay export table expected by the Quake II server and closes it over one explicit TS context.
 *
 * Porting notes:
 * - The original C implementation is named `GetGameAPI`; the exported TS symbol matches the `game.h` declaration spelling.
 */
export function GetGameApi(imports: game_import_t, options: GameMainContextOptions = {}): game_export_t {
  const context = createGameMainContext(imports, options);

  return {
    apiversion: GAME_API_VERSION,
    Init: () => InitGame(context),
    Shutdown: () => ShutdownGame(context),
    SpawnEntities: (mapname, entstring, spawnpoint) => SpawnEntities(context, mapname, entstring, spawnpoint),
    WriteGame: (filename, autosave) => WriteGame(context, filename, autosave),
    ReadGame: (filename) => ReadGame(context, filename),
    WriteLevel: (filename) => WriteLevel(context, filename),
    ReadLevel: (filename) => ReadLevel(context, filename),
    ClientConnect: (ent, userinfo) => ClientConnect(ent, userinfo, context.runtime, createClientConnectHooks(context)),
    ClientConnectRejectMessage: () => context.lastClientConnectRejectMessage,
    ClientBegin: (ent) => ClientBegin(ent, context.runtime, createClientUserinfoHooks(context)),
    ClientUserinfoChanged: (ent, userinfo) => {
      ClientUserinfoChanged(ent, userinfo, context.runtime, createClientUserinfoHooks(context));
    },
    ClientDisconnect: (ent) => ClientDisconnect(ent, context.runtime, createClientUserinfoHooks(context)),
    ClientCommand: (ent) => ClientCommand(context, ent),
    ClientThink: (ent, cmd) => ClientThink(ent, cmd, context.runtime, context.hooks),
    RunFrame: () => G_RunFrame(context),
    ServerCommand: () => {
      const serverContext = context.hooks.writeFile
        ? { gi: context.gi, writeFile: context.hooks.writeFile }
        : { gi: context.gi };
      ServerCommand_Svcmds(context.serverCommands, serverContext);
    },
    get edicts() {
      return context.runtime.entities;
    },
    get edict_size() {
      return Object.keys(context.runtime.entities[0] ?? {}).length;
    },
    get num_edicts() {
      return context.runtime.entities.length;
    },
    get max_edicts() {
      return context.runtime.maxentities;
    }
  };
}

/**
 * Original name: N/A
 * Source declaree: N/A (TS hook adapter for game export wiring)
 * Category: New
 * Purpose: Reattach the default `g_main.c` connection policy before delegating to the `p_client.c` port.
 */
function createClientConnectHooks(context: GameMainContext): GameMainHooks {
  const userValidateConnect = context.hooks.validateConnect;
  return {
    ...createClientUserinfoHooks(context),
    validateConnect: (ent, userinfo, runtime) => {
      context.lastClientConnectRejectMessage = "";
      const validation = validateClientConnect(context, userinfo);
      if (!validation.accepted) {
        context.lastClientConnectRejectMessage = validation.reason ?? "";
        return validation;
      }

      const userValidation = userValidateConnect?.(ent, userinfo, runtime) ?? validation;
      if (!userValidation.accepted) {
        context.lastClientConnectRejectMessage = userValidation.reason ?? "";
      }
      return userValidation;
    }
  };
}

/**
 * Original name: N/A
 * Source declaree: N/A (TS hook adapter for game export wiring)
 * Category: New
 * Purpose: Reattach the `ClientUserinfoChanged`/disconnect engine side effects to the original `gi` callbacks.
 */
function createClientUserinfoHooks(context: GameMainContext): GameMainHooks {
  const userSpectatorRespawnValidation = context.hooks.onSpectatorRespawnValidation;
  return {
    ...context.hooks,
    onPrint: context.hooks.onPrint ?? ((printLevel, message) => {
      context.gi.bprintf(printLevel, "%s", message);
    }),
    onConfigstringPlayer: context.hooks.onConfigstringPlayer ?? ((playernum, value) => {
      context.gi.configstring(CS_PLAYERSKINS + playernum, value);
    }),
    onLoginEffect: context.hooks.onLoginEffect ?? ((ent) => {
      context.gi.WriteByte(svc_muzzleflash);
      context.gi.WriteShort(ent.index);
      context.gi.WriteByte(MZ_LOGIN);
      context.gi.multicast(ent.s.origin, multicast_t.MULTICAST_PVS);
    }),
    onDisconnectEffect: context.hooks.onDisconnectEffect ?? ((ent) => {
      context.gi.WriteByte(svc_muzzleflash);
      context.gi.WriteShort(ent.index);
      context.gi.WriteByte(MZ_LOGOUT);
      context.gi.multicast(ent.s.origin, multicast_t.MULTICAST_PVS);
    }),
    onUnlinkEntity: context.hooks.onUnlinkEntity ?? ((ent) => {
      context.gi.unlinkentity(ent);
    }),
    isIntermission: context.hooks.isIntermission ?? ((runtime) => {
      return runtime.intermissiontime !== 0;
    }),
    onSpectatorRespawnValidation: (ent, runtime) => {
      const validation = validateSpectatorRespawn(context, ent, runtime);
      if (!validation.accepted) {
        return validation;
      }

      return userSpectatorRespawnValidation?.(ent, runtime) ?? validation;
    }
  };
}

/**
 * Original name: ClientConnect connection gates
 * Source: game/p_client.c through the `g_main.c` exported `ClientConnect` slot
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Rejects banned IPs, invalid player passwords, invalid spectator passwords and full spectator slots.
 *
 * Porting notes:
 * - The TS game-export ABI passes userinfo as an immutable string, so rejection text is returned through hooks
 *   instead of mutating `userinfo` with `rejmsg`.
 */
function validateClientConnect(context: GameMainContext, userinfo: string): { accepted: boolean; reason?: string } {
  const ip = Info_ValueForKey(userinfo, "ip");
  if (SV_FilterPacket(context.serverCommands, { gi: context.gi }, ip)) {
    return { accepted: false, reason: "Banned." };
  }

  const spectator = Info_ValueForKey(userinfo, "spectator");
  if (context.runtime.deathmatch && spectator.length > 0 && spectator !== "0") {
    const spectatorPassword = context.cvars.spectator_password?.string ?? "";
    if (spectatorPassword.length > 0 && spectatorPassword !== "none" && spectatorPassword !== spectator) {
      return { accepted: false, reason: "Spectator password required or incorrect." };
    }

    let numspec = 0;
    const maxclients = Math.trunc(context.cvars.maxclients?.value ?? context.runtime.maxclients);
    for (let index = 0; index < maxclients; index += 1) {
      const ent = context.runtime.entities[index + 1];
      if (ent?.inuse && ent.client?.pers.spectator) {
        numspec += 1;
      }
    }

    if (numspec >= (context.cvars.maxspectators?.value ?? 0)) {
      return { accepted: false, reason: "Server spectator limit is full." };
    }

    return { accepted: true };
  }

  const password = context.cvars.password?.string ?? "";
  const value = Info_ValueForKey(userinfo, "password");
  if (password.length > 0 && password !== "none" && password !== value) {
    return { accepted: false, reason: "Password required or incorrect." };
  }

  return { accepted: true };
}

/**
 * Original name: spectator_respawn connection gates
 * Source: game/p_client.c through the `g_main.c` exported frame path
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Enforces the password and spectator capacity checks applied when a connected player toggles spectator mode.
 *
 * Porting notes:
 * - The actual respawn body stays in `p_client.ts`; this adapter attaches the original `gi` print/stufftext
 *   side effects required by the game export runtime.
 */
function validateSpectatorRespawn(
  context: GameMainContext,
  ent: GameEntity,
  runtime: GameRuntime
): { accepted: boolean; spectatorValue?: boolean } {
  const client = ent.client;
  if (!client) {
    return { accepted: true };
  }

  if (client.pers.spectator) {
    const value = Info_ValueForKey(client.pers.userinfo, "spectator");
    const spectatorPassword = context.cvars.spectator_password?.string ?? "";
    if (spectatorPassword.length > 0 && spectatorPassword !== "none" && spectatorPassword !== value) {
      rejectSpectatorRespawn(context, ent, "Spectator password incorrect.\n", "spectator 0\n");
      return { accepted: false, spectatorValue: false };
    }

    let numspec = 0;
    const maxclients = Math.trunc(context.cvars.maxclients?.value ?? runtime.maxclients);
    for (let index = 1; index <= maxclients; index += 1) {
      const spectator = runtime.entities[index];
      if (spectator?.inuse && spectator.client?.pers.spectator) {
        numspec += 1;
      }
    }

    if (numspec >= (context.cvars.maxspectators?.value ?? 0)) {
      rejectSpectatorRespawn(context, ent, "Server spectator limit is full.", "spectator 0\n");
      return { accepted: false, spectatorValue: false };
    }

    return { accepted: true };
  }

  const password = context.cvars.password?.string ?? "";
  const value = Info_ValueForKey(client.pers.userinfo, "password");
  if (password.length > 0 && password !== "none" && password !== value) {
    rejectSpectatorRespawn(context, ent, "Password incorrect.\n", "spectator 1\n");
    return { accepted: false, spectatorValue: true };
  }

  return { accepted: true };
}

function rejectSpectatorRespawn(context: GameMainContext, ent: GameEntity, message: string, command: string): void {
  context.gi.cprintf(ent, PRINT_HIGH, message);
  context.gi.WriteByte(svc_stufftext);
  context.gi.WriteString(command);
  context.gi.unicast(ent, true);
}

/**
 * Original name: N/A
 * Source declaree: N/A (explicit TS context builder)
 * Category: New
 * Purpose: Create the explicit runtime context used by the first `g_main.c` port.
 */
export function createGameMainContext(imports: game_import_t, options: GameMainContextOptions = {}): GameMainContext {
  return {
    gi: imports,
    runtime: options.runtime ?? createGameRuntimeFromBspEntities([{ properties: { classname: "worldspawn" } }]),
    game: createGameLocals(),
    level: createLevelLocals(),
    serverCommands: createGameServerCommandState(),
    cvars: createGameMainCvars(),
    lastClientConnectRejectMessage: "",
    hooks: {
      emitLayout: (ent, layout) => {
        imports.WriteByte(svc_layout);
        imports.WriteString(layout);
        imports.unicast(ent, true);
      },
      emitTempEntity: (event, payload, runtime) => {
        const origin = readTempEntityOrigin(payload) ?? [0, 0, 0];
        emitGameTempEntity(runtime, event, origin, multicast_t.MULTICAST_PVS, payload);
      },
      ...options.hooks
    }
  };
}

/**
 * Original name: ClientCommand
 * Source: game/g_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Preserves the `g_main.c` export slot and relays client command dispatch to the `game/g_cmds.c` port.
 * - Passes the gameplay cvars and help state that the command dispatcher reads through original globals.
 *
 * Porting notes:
 * - Existing integrations may override the slot through `onClientCommand`; the default path stays the ported
 *   `g_cmds.ts` dispatcher.
 */
export function ClientCommand(context: GameMainContext, ent: edict_t): void {
  if (context.hooks.onClientCommand) {
    context.hooks.onClientCommand(ent, context.runtime);
    return;
  }

  syncGameHelpState(context);

  ClientCommand_Cmds({
    gi: context.gi,
    runtime: context.runtime,
    cvars: {
      sv_cheats: context.cvars.sv_cheats,
      dedicated: context.cvars.dedicated,
      flood_msgs: context.cvars.flood_msgs,
      flood_persecond: context.cvars.flood_persecond,
      flood_waitdelay: context.cvars.flood_waitdelay,
      skill: context.cvars.skill
    },
    hooks: context.hooks,
    helpData: {
      skill: context.cvars.skill?.value ?? context.runtime.skill,
      level_name: context.level.level_name,
      helpmessage1: context.runtime.helpmessage1,
      helpmessage2: context.runtime.helpmessage2,
      killed_monsters: context.level.killed_monsters,
      total_monsters: context.level.total_monsters,
      found_goals: context.level.found_goals,
      total_goals: context.level.total_goals,
      found_secrets: context.level.found_secrets,
      total_secrets: context.level.total_secrets
    }
  }, ent);
}

/**
 * Original name: GetGameAPI WriteGame slot
 * Source: game/g_main.c
 * Category: Adapter
 * Fidelity level: Adapter
 *
 * Behavior:
 * - Delegates the savegame export slot to the `g_save.c` TypeScript attachment point.
 */
export function WriteGame(context: GameMainContext, filename: string, autosave: qboolean): void {
  syncGameHelpState(context);
  WriteGame_Save(context, filename, autosave);
}

/**
 * Original name: GetGameAPI ReadGame slot
 * Source: game/g_main.c
 * Category: Adapter
 * Fidelity level: Adapter
 *
 * Behavior:
 * - Delegates the savegame import slot to the `g_save.c` TypeScript attachment point.
 */
export function ReadGame(context: GameMainContext, filename: string): void {
  ReadGame_Save(context, filename);
}

/**
 * Original name: GetGameAPI WriteLevel slot
 * Source: game/g_main.c
 * Category: Adapter
 * Fidelity level: Adapter
 *
 * Behavior:
 * - Delegates the level-save export slot to the `g_save.c` TypeScript attachment point.
 */
export function WriteLevel(context: GameMainContext, filename: string): void {
  WriteLevel_Save(context, filename);
}

/**
 * Original name: GetGameAPI ReadLevel slot
 * Source: game/g_main.c
 * Category: Adapter
 * Fidelity level: Adapter
 *
 * Behavior:
 * - Delegates the level-save import slot to the `g_save.c` TypeScript attachment point.
 */
export function ReadLevel(context: GameMainContext, filename: string): void {
  ReadLevel_Save(context, filename);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Build the nullable cvar handle block before `InitGame` binds engine cvars.
 */
function createGameMainCvars(): GameMainCvars {
  return {
    deathmatch: null,
    coop: null,
    dmflags: null,
    skill: null,
    fraglimit: null,
    timelimit: null,
    password: null,
    spectator_password: null,
    maxclients: null,
    maxspectators: null,
    maxentities: null,
    g_select_empty: null,
    dedicated: null,
    sv_cheats: null,
    flood_msgs: null,
    flood_persecond: null,
    flood_waitdelay: null,
    filterban: null,
    sv_gravity: null,
    sv_maxvelocity: null,
    sv_rollspeed: null,
    sv_rollangle: null,
    gun_x: null,
    gun_y: null,
    gun_z: null,
    run_pitch: null,
    run_roll: null,
    bob_up: null,
    bob_pitch: null,
    bob_roll: null,
    sv_maplist: null
  };
}

function assignCvarValue<T extends Record<string, number | undefined>>(target: T, key: keyof T & string, cvar: cvar_t | null): void {
  if (cvar) {
    target[key] = cvar.value as T[keyof T & string];
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Mirror the `g_main.c` cvars that are consumed through the explicit gameplay runtime.
 */
function applyMainCvarsToRuntime(context: GameMainContext): void {
  context.runtime.deathmatch = Boolean(context.cvars.deathmatch?.value);
  context.runtime.coop = Boolean(context.cvars.coop?.value);
  context.runtime.dmflags = context.cvars.dmflags?.value ?? 0;
  context.runtime.skill = context.cvars.skill?.value ?? 1;
  context.runtime.g_select_empty = Boolean(context.cvars.g_select_empty?.value);
  context.runtime.gravity = context.cvars.sv_gravity?.value ?? context.runtime.gravity;
  context.runtime.maxvelocity = context.cvars.sv_maxvelocity?.value ?? context.runtime.maxvelocity;
  context.runtime.maxclients = Math.max(0, Math.trunc(context.cvars.maxclients?.value ?? context.runtime.maxclients));
  context.runtime.maxentities = Math.max(context.runtime.maxclients + 1, Math.trunc(context.cvars.maxentities?.value ?? context.runtime.maxentities));
  context.game.maxclients = context.runtime.maxclients;
  context.game.maxentities = context.runtime.maxentities;
}

/**
 * Original name: N/A
 * Source declaree: N/A (runtime side-effect bridge)
 * Category: New
 * Purpose: Flush gameplay-runtime engine side effects through the original game import surface.
 *
 * Constraints:
 * - Keeps target/entity ports independent from the server package.
 * - Emits temp entities using the same `gi.Write*` then `gi.multicast` call order as the C source.
 */
function flushRuntimeEngineEvents(context: GameMainContext): void {
  for (const update of drainGameConfigstringUpdates(context.runtime)) {
    context.gi.configstring(update.index, update.value);
  }

  for (const event of drainGameCprintfEvents(context.runtime)) {
    const entity = event.entity ?? (event.entityIndex !== null ? context.runtime.entities[event.entityIndex] ?? null : null);
    context.gi.cprintf(entity, event.printlevel, "%s", event.message);
  }

  for (const sound of drainGameSoundEvents(context.runtime)) {
    const entity = sound.entity ?? (sound.entityIndex !== null ? context.runtime.entities[sound.entityIndex] ?? null : null);
    if (!entity) {
      continue;
    }

    const channel = sound.channel ?? 0;
    const volume = sound.volume ?? 1;
    const attenuation = sound.attenuation ?? 1;
    const timeofs = sound.timeofs ?? 0;
    if (sound.origin) {
      context.gi.positioned_sound(sound.origin, entity, channel, sound.soundIndex, volume, attenuation, timeofs);
    } else {
      context.gi.sound(entity, channel, sound.soundIndex, volume, attenuation, timeofs);
    }
  }

  for (const event of drainPlayerMuzzleFlashEvents(context.runtime)) {
    const entity = context.runtime.entities[event.entityIndex] ?? null;
    if (!entity) {
      continue;
    }

    context.gi.WriteByte(svc_muzzleflash);
    context.gi.WriteShort(event.entityIndex);
    context.gi.WriteByte(event.weapon);
    context.gi.multicast(entity.s.origin, multicast_t.MULTICAST_PVS);
  }

  for (const event of drainMonsterMuzzleFlashEvents(context.runtime)) {
    context.gi.WriteByte(svc_muzzleflash2);
    context.gi.WriteShort(event.entityIndex);
    context.gi.WriteByte(event.flashNumber);
    context.gi.multicast(event.origin, multicast_t.MULTICAST_PVS);
  }

  for (const event of drainGameTempEntityEvents(context.runtime)) {
    context.gi.WriteByte(svc_temp_entity);
    context.gi.WriteByte(event.type);
    writeTempEntityPayload(context, event);
    context.gi.multicast(event.origin, event.multicast);
  }
}

function writeTempEntityPayload(context: GameMainContext, event: ReturnType<typeof drainGameTempEntityEvents>[number]): void {
  switch (event.type) {
    case temp_event_t.TE_SPLASH:
      context.gi.WriteByte(numberPayload(event.payload, "count"));
      context.gi.WritePosition(event.origin);
      context.gi.WriteDir(vectorPayload(event.payload, "dir"));
      context.gi.WriteByte(numberPayloadWithFallback(event.payload, "color", "sounds"));
      return;
    case temp_event_t.TE_LASER_SPARKS:
    case temp_event_t.TE_WELDING_SPARKS:
    case temp_event_t.TE_TUNNEL_SPARKS:
      context.gi.WriteByte(numberPayload(event.payload, "count"));
      context.gi.WritePosition(event.origin);
      context.gi.WriteDir(vectorPayload(event.payload, "dir"));
      context.gi.WriteByte(numberPayload(event.payload, "color"));
      return;
    case temp_event_t.TE_RAILTRAIL:
    case temp_event_t.TE_BLUEHYPERBLASTER:
    case temp_event_t.TE_BFG_LASER:
    case temp_event_t.TE_BUBBLETRAIL:
    case temp_event_t.TE_DEBUGTRAIL:
    case temp_event_t.TE_BUBBLETRAIL2:
      writeTempEntityStartEnd(context, event);
      return;
    case temp_event_t.TE_FORCEWALL:
      writeTempEntityStartEnd(context, event);
      context.gi.WriteByte(numberPayload(event.payload, "color"));
      return;
    case temp_event_t.TE_PARASITE_ATTACK:
    case temp_event_t.TE_MEDIC_CABLE_ATTACK:
      context.gi.WriteShort(numberPayloadWithFallback(event.payload, "entityIndex", "entity"));
      writeTempEntityStartEnd(context, event);
      return;
    case temp_event_t.TE_GRAPPLE_CABLE:
      context.gi.WriteShort(numberPayloadWithFallback(event.payload, "entityIndex", "entity"));
      writeTempEntityStartEnd(context, event);
      context.gi.WritePosition(vectorPayload(event.payload, "offset"));
      return;
    case temp_event_t.TE_HEATBEAM:
    case temp_event_t.TE_MONSTER_HEATBEAM:
      context.gi.WriteShort(numberPayloadWithFallback(event.payload, "entityIndex", "entity"));
      writeTempEntityStartEnd(context, event);
      return;
    case temp_event_t.TE_LIGHTNING:
      context.gi.WriteShort(numberPayloadWithFallback(event.payload, "entityIndex", "entity"));
      context.gi.WriteShort(numberPayloadWithFallback(event.payload, "entity2Index", "entity2"));
      writeTempEntityStartEnd(context, event);
      return;
    default:
      if (tempEntityWritesDirection(event.type)) {
        context.gi.WritePosition(event.origin);
        context.gi.WriteDir(vectorPayload(event.payload, "dir"));
        return;
      }

      context.gi.WritePosition(event.origin);
  }
}

function writeTempEntityStartEnd(
  context: GameMainContext,
  event: ReturnType<typeof drainGameTempEntityEvents>[number]
): void {
  context.gi.WritePosition(vectorPayloadWithFallback(event.payload, "start", event.origin));
  context.gi.WritePosition(vectorPayloadWithFallback(event.payload, "end", event.origin));
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Identify temp-entity opcodes whose C emission writes an origin followed by a direction.
 */
function tempEntityWritesDirection(type: temp_event_t): boolean {
  switch (type) {
    case temp_event_t.TE_BLOOD:
    case temp_event_t.TE_GUNSHOT:
    case temp_event_t.TE_SPARKS:
    case temp_event_t.TE_SHOTGUN:
    case temp_event_t.TE_SCREEN_SPARKS:
    case temp_event_t.TE_SHIELD_SPARKS:
    case temp_event_t.TE_BULLET_SPARKS:
    case temp_event_t.TE_GREENBLOOD:
    case temp_event_t.TE_HEATBEAM_SPARKS:
    case temp_event_t.TE_HEATBEAM_STEAM:
    case temp_event_t.TE_ELECTRIC_SPARKS:
    case temp_event_t.TE_BLASTER:
    case temp_event_t.TE_BLASTER2:
    case temp_event_t.TE_FLECHETTE:
      return true;
    default:
      return false;
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Read one numeric temp-entity payload value with the C-style zero default.
 */
function numberPayload(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  return Number.isFinite(value) ? Number(value) : 0;
}

function numberPayloadWithFallback(payload: Record<string, unknown>, key: string, fallbackKey: string): number {
  const value = payload[key];
  if (Number.isFinite(value)) {
    return Number(value);
  }
  return numberPayload(payload, fallbackKey);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Read one vector temp-entity payload value with the C-style zero vector default.
 */
function vectorPayload(payload: Record<string, unknown>, key: string): [number, number, number] {
  return vectorPayloadWithFallback(payload, key, [0, 0, 0]);
}

function vectorPayloadWithFallback(payload: Record<string, unknown>, key: string, fallback: [number, number, number]): [number, number, number] {
  const value = payload[key];
  if (Array.isArray(value) && value.length === 3) {
    return [
      Number(value[0]) || 0,
      Number(value[1]) || 0,
      Number(value[2]) || 0
    ];
  }

  return [...fallback];
}

function readTempEntityOrigin(payload: Record<string, unknown>): vec3_t | null {
  return vectorPayloadOrNull(payload, "origin")
    ?? vectorPayloadOrNull(payload, "end")
    ?? vectorPayloadOrNull(payload, "start");
}

function vectorPayloadOrNull(payload: Record<string, unknown>, key: string): vec3_t | null {
  const value = payload[key];
  if (Array.isArray(value) && value.length === 3 && value.every((component) => typeof component === "number" && Number.isFinite(component))) {
    return [value[0], value[1], value[2]];
  }

  return null;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local port metadata)
 * Category: New
 * Purpose: Provide the `gamedate` cvar value used by the TS port's `InitGame` wiring.
 */
const GAME_BUILD_DATE = "TypeScript port";

/**
 * Original name: N/A
 * Source declaree: N/A (split runtime adapter)
 * Category: New
 * Purpose: Mirror runtime level state into `level_locals_t` for save, HUD and frame code that still reads it.
 */
function syncLevelFromRuntime(context: GameMainContext): void {
  context.level.framenum = context.runtime.framenum;
  context.level.time = context.runtime.time;
  context.level.intermissiontime = context.runtime.intermissiontime;
  context.level.exitintermission = context.runtime.exitintermission;
  context.level.intermission_origin = [...context.runtime.intermission_origin];
  context.level.intermission_angle = [...context.runtime.intermission_angle];
  context.level.changemap = context.runtime.changemap;
  context.level.pic_health = context.runtime.pic_health;
  context.level.sight_client = context.runtime.sight_client;
  context.level.sight_entity = context.runtime.sight_entity;
  context.level.sight_entity_framenum = context.runtime.sight_entity_framenum;
  context.level.sound_entity = context.runtime.sound_entity;
  context.level.sound_entity_framenum = context.runtime.sound_entity_framenum;
  context.level.sound2_entity = context.runtime.sound2_entity;
  context.level.sound2_entity_framenum = context.runtime.sound2_entity_framenum;
  context.level.total_secrets = context.runtime.total_secrets;
  context.level.found_secrets = context.runtime.found_secrets;
  context.level.total_goals = context.runtime.total_goals;
  context.level.found_goals = context.runtime.found_goals;
  context.level.total_monsters = context.runtime.total_monsters;
  context.level.killed_monsters = context.runtime.killed_monsters;
  context.level.current_entity = context.runtime.current_entity;
  context.level.body_que = context.runtime.body_que;
  context.level.power_cubes = context.runtime.power_cubes;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Tokenize `sv_maplist` using the original `EndDMLevel` separators.
 */
function tokenizeMapList(maplist: string): string[] {
  return maplist
    .split(/[ ,\n\r]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Keep map-list comparisons routed through the Quake II case-insensitive string helper.
 */
function stringsEqualIgnoreCase(left: string, right: string): boolean {
  return Q_stricmp(left, right) === 0;
}
