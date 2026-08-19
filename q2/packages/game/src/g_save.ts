/**
 * File: g_save.ts
 * Source: Quake II original / game/g_save.c
 * Purpose: Port of gameplay save/load field metadata and first structured persistence pass.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses a structured JSON snapshot through injected host file hooks instead of C `FILE *` binary blocks.
 * - Function pointers are persisted by explicit registry name instead of native code-segment offsets.
 * - `mmove_t` pointers are persisted by explicit registry name instead of native data-segment offsets.
 * - Entity/client pointers are persisted as edict/client/item indexes, matching the intent of `WriteField1`.
 *
 * Notes:
 * - This file is intended to stay close to the original C source while the TypeScript runtime is still object-based.
 */

import type { qboolean, vec3_t } from "../../qcommon/src/index.js";
import type { GameMainContext } from "./g_main.js";
import { SaveClientData } from "./p_client.js";
import { GetItemByIndex } from "./g_items.js";
import * as gAiExports from "./g_ai.js";
import * as gFuncExports from "./g_func.js";
import * as gItemsExports from "./g_items.js";
import * as gMiscExports from "./g_misc.js";
import * as gMonsterExports from "./g_monster.js";
import * as gTargetExports from "./g_target.js";
import * as gTriggerExports from "./g_trigger.js";
import * as gTurretExports from "./g_turret.js";
import * as gUtilsExports from "./g_utils.js";
import * as gWeaponExports from "./g_weapon.js";
import * as mBerserkExports from "./m_berserk.js";
import * as mBoss2Exports from "./m_boss2.js";
import * as mBoss3Exports from "./m_boss3.js";
import * as mBoss31Exports from "./m_boss31.js";
import * as mBoss32Exports from "./m_boss32.js";
import * as mBrainExports from "./m_brain.js";
import * as mChickExports from "./m_chick.js";
import * as mFlipperExports from "./m_flipper.js";
import * as mFloatExports from "./m_float.js";
import * as mFlyerExports from "./m_flyer.js";
import * as mGladiatorExports from "./m_gladiator.js";
import * as mGunnerExports from "./m_gunner.js";
import * as mHoverExports from "./m_hover.js";
import * as mInfantryExports from "./m_infantry.js";
import * as mMedicExports from "./m_medic.js";
import * as mMutantExports from "./m_mutant.js";
import * as mParasiteExports from "./m_parasite.js";
import * as mSoldierExports from "./m_soldier.js";
import * as mSupertankExports from "./m_supertank.js";
import * as mTankExports from "./m_tank.js";
import * as pClientExports from "./p_client.js";
import * as pTrailExports from "./p_trail.js";
import {
  CLOFS,
  FFL_NOSPAWN,
  FFL_SPAWNTEMP,
  FOFS,
  LLOFS,
  STOFS,
  TAG_GAME,
  TAG_LEVEL,
  ITEM_INDEX,
  fieldtype_t,
  type field_t
} from "./g_local.js";
import {
  attachGameClient,
  createRuntimeEntity,
  linkGameEntity,
  type GameClient,
  type GameEntity,
  type GameMonsterMove,
  type GameMoveInfo,
  type GameRuntime
} from "./runtime.js";

/**
 * Original name: N/A
 * Source declaree: N/A (local structured save marker)
 * Category: New
 * Purpose: Replace the C `__DATE__` save compatibility string with a stable TS save marker.
 */
const SAVEGAME_DATE = "Quake2JS g_save phase1";

/**
 * Original name: N/A
 * Source declaree: N/A (local structured save marker)
 * Category: New
 * Purpose: Identify the JSON save payload shape used by this TypeScript port.
 */
const SAVEGAME_FORMAT = "quake2js.g_save.structured.v1";

/**
 * Original name: N/A
 * Source declaree: N/A (local structured save note)
 * Category: New
 * Purpose: Document save payload limitations that differ from native C pointer relocation.
 */
const UNRESTORED_CALLBACK_NOTE = "closure-only callbacks and unregistered mmove objects cannot be restored";

export const mmove_reloc = {};

/**
 * Original name: N/A
 * Source declaree: N/A (local callback registry type)
 * Category: New
 * Purpose: Type runtime callbacks registered for symbolic savegame restoration.
 */
type SaveCallback = (...args: any[]) => unknown;

/**
 * Original name: N/A
 * Source declaree: N/A (local callback registry)
 * Category: New
 * Purpose: Map saved callback names back to live runtime functions.
 */
const saveFunctionByName = new Map<string, SaveCallback>();

/**
 * Original name: N/A
 * Source declaree: N/A (local callback registry)
 * Category: New
 * Purpose: Map live runtime functions to stable saved callback names.
 */
const saveFunctionNameByRef = new WeakMap<SaveCallback, string>();

/**
 * Original name: N/A
 * Source declaree: N/A (local mmove registry)
 * Category: New
 * Purpose: Map saved monster move names back to live runtime move descriptors.
 */
const saveMoveByName = new Map<string, GameMonsterMove>();

/**
 * Original name: N/A
 * Source declaree: N/A (local mmove registry)
 * Category: New
 * Purpose: Map live runtime move descriptors to stable saved names.
 */
const saveMoveNameByRef = new WeakMap<GameMonsterMove, string>();

export const fields: field_t[] = [
  { name: "classname", ofs: FOFS("classname"), type: fieldtype_t.F_LSTRING, flags: 0 },
  { name: "model", ofs: FOFS("model"), type: fieldtype_t.F_LSTRING, flags: 0 },
  { name: "spawnflags", ofs: FOFS("spawnflags"), type: fieldtype_t.F_INT, flags: 0 },
  { name: "speed", ofs: FOFS("speed"), type: fieldtype_t.F_FLOAT, flags: 0 },
  { name: "accel", ofs: FOFS("accel"), type: fieldtype_t.F_FLOAT, flags: 0 },
  { name: "decel", ofs: FOFS("decel"), type: fieldtype_t.F_FLOAT, flags: 0 },
  { name: "target", ofs: FOFS("target"), type: fieldtype_t.F_LSTRING, flags: 0 },
  { name: "targetname", ofs: FOFS("targetname"), type: fieldtype_t.F_LSTRING, flags: 0 },
  { name: "pathtarget", ofs: FOFS("pathtarget"), type: fieldtype_t.F_LSTRING, flags: 0 },
  { name: "deathtarget", ofs: FOFS("deathtarget"), type: fieldtype_t.F_LSTRING, flags: 0 },
  { name: "killtarget", ofs: FOFS("killtarget"), type: fieldtype_t.F_LSTRING, flags: 0 },
  { name: "combattarget", ofs: FOFS("combattarget"), type: fieldtype_t.F_LSTRING, flags: 0 },
  { name: "message", ofs: FOFS("message"), type: fieldtype_t.F_LSTRING, flags: 0 },
  { name: "team", ofs: FOFS("team"), type: fieldtype_t.F_LSTRING, flags: 0 },
  { name: "wait", ofs: FOFS("wait"), type: fieldtype_t.F_FLOAT, flags: 0 },
  { name: "delay", ofs: FOFS("delay"), type: fieldtype_t.F_FLOAT, flags: 0 },
  { name: "random", ofs: FOFS("random"), type: fieldtype_t.F_FLOAT, flags: 0 },
  { name: "move_origin", ofs: FOFS("move_origin"), type: fieldtype_t.F_VECTOR, flags: 0 },
  { name: "move_angles", ofs: FOFS("move_angles"), type: fieldtype_t.F_VECTOR, flags: 0 },
  { name: "style", ofs: FOFS("style"), type: fieldtype_t.F_INT, flags: 0 },
  { name: "count", ofs: FOFS("count"), type: fieldtype_t.F_INT, flags: 0 },
  { name: "health", ofs: FOFS("health"), type: fieldtype_t.F_INT, flags: 0 },
  { name: "sounds", ofs: FOFS("sounds"), type: fieldtype_t.F_INT, flags: 0 },
  { name: "light", ofs: "", type: fieldtype_t.F_IGNORE, flags: 0 },
  { name: "dmg", ofs: FOFS("dmg"), type: fieldtype_t.F_INT, flags: 0 },
  { name: "mass", ofs: FOFS("mass"), type: fieldtype_t.F_INT, flags: 0 },
  { name: "volume", ofs: FOFS("volume"), type: fieldtype_t.F_FLOAT, flags: 0 },
  { name: "attenuation", ofs: FOFS("attenuation"), type: fieldtype_t.F_FLOAT, flags: 0 },
  { name: "map", ofs: FOFS("map"), type: fieldtype_t.F_LSTRING, flags: 0 },
  { name: "origin", ofs: "s.origin", type: fieldtype_t.F_VECTOR, flags: 0 },
  { name: "angles", ofs: "s.angles", type: fieldtype_t.F_VECTOR, flags: 0 },
  { name: "angle", ofs: "s.angles", type: fieldtype_t.F_ANGLEHACK, flags: 0 },
  { name: "goalentity", ofs: FOFS("goalentity"), type: fieldtype_t.F_EDICT, flags: FFL_NOSPAWN },
  { name: "movetarget", ofs: FOFS("movetarget"), type: fieldtype_t.F_EDICT, flags: FFL_NOSPAWN },
  { name: "enemy", ofs: FOFS("enemy"), type: fieldtype_t.F_EDICT, flags: FFL_NOSPAWN },
  { name: "oldenemy", ofs: FOFS("oldenemy"), type: fieldtype_t.F_EDICT, flags: FFL_NOSPAWN },
  { name: "activator", ofs: FOFS("activator"), type: fieldtype_t.F_EDICT, flags: FFL_NOSPAWN },
  { name: "groundentity", ofs: FOFS("groundentity"), type: fieldtype_t.F_EDICT, flags: FFL_NOSPAWN },
  { name: "teamchain", ofs: FOFS("teamchain"), type: fieldtype_t.F_EDICT, flags: FFL_NOSPAWN },
  { name: "teammaster", ofs: FOFS("teammaster"), type: fieldtype_t.F_EDICT, flags: FFL_NOSPAWN },
  { name: "owner", ofs: FOFS("owner"), type: fieldtype_t.F_EDICT, flags: FFL_NOSPAWN },
  { name: "mynoise", ofs: FOFS("mynoise"), type: fieldtype_t.F_EDICT, flags: FFL_NOSPAWN },
  { name: "mynoise2", ofs: FOFS("mynoise2"), type: fieldtype_t.F_EDICT, flags: FFL_NOSPAWN },
  { name: "target_ent", ofs: FOFS("target_ent"), type: fieldtype_t.F_EDICT, flags: FFL_NOSPAWN },
  { name: "chain", ofs: FOFS("chain"), type: fieldtype_t.F_EDICT, flags: FFL_NOSPAWN },
  { name: "prethink", ofs: FOFS("prethink"), type: fieldtype_t.F_FUNCTION, flags: FFL_NOSPAWN },
  { name: "think", ofs: FOFS("think"), type: fieldtype_t.F_FUNCTION, flags: FFL_NOSPAWN },
  { name: "blocked", ofs: FOFS("blocked"), type: fieldtype_t.F_FUNCTION, flags: FFL_NOSPAWN },
  { name: "touch", ofs: FOFS("touch"), type: fieldtype_t.F_FUNCTION, flags: FFL_NOSPAWN },
  { name: "use", ofs: FOFS("use"), type: fieldtype_t.F_FUNCTION, flags: FFL_NOSPAWN },
  { name: "pain", ofs: FOFS("pain"), type: fieldtype_t.F_FUNCTION, flags: FFL_NOSPAWN },
  { name: "die", ofs: FOFS("die"), type: fieldtype_t.F_FUNCTION, flags: FFL_NOSPAWN },
  { name: "stand", ofs: "monsterinfo.stand", type: fieldtype_t.F_FUNCTION, flags: FFL_NOSPAWN },
  { name: "idle", ofs: "monsterinfo.idle", type: fieldtype_t.F_FUNCTION, flags: FFL_NOSPAWN },
  { name: "search", ofs: "monsterinfo.search", type: fieldtype_t.F_FUNCTION, flags: FFL_NOSPAWN },
  { name: "walk", ofs: "monsterinfo.walk", type: fieldtype_t.F_FUNCTION, flags: FFL_NOSPAWN },
  { name: "run", ofs: "monsterinfo.run", type: fieldtype_t.F_FUNCTION, flags: FFL_NOSPAWN },
  { name: "dodge", ofs: "monsterinfo.dodge", type: fieldtype_t.F_FUNCTION, flags: FFL_NOSPAWN },
  { name: "attack", ofs: "monsterinfo.attack", type: fieldtype_t.F_FUNCTION, flags: FFL_NOSPAWN },
  { name: "melee", ofs: "monsterinfo.melee", type: fieldtype_t.F_FUNCTION, flags: FFL_NOSPAWN },
  { name: "sight", ofs: "monsterinfo.sight", type: fieldtype_t.F_FUNCTION, flags: FFL_NOSPAWN },
  { name: "checkattack", ofs: "monsterinfo.checkattack", type: fieldtype_t.F_FUNCTION, flags: FFL_NOSPAWN },
  { name: "currentmove", ofs: "monsterinfo.currentmove", type: fieldtype_t.F_MMOVE, flags: FFL_NOSPAWN },
  { name: "endfunc", ofs: "moveinfo.endfunc", type: fieldtype_t.F_FUNCTION, flags: FFL_NOSPAWN },
  { name: "lip", ofs: STOFS("lip"), type: fieldtype_t.F_INT, flags: FFL_SPAWNTEMP },
  { name: "distance", ofs: STOFS("distance"), type: fieldtype_t.F_INT, flags: FFL_SPAWNTEMP },
  { name: "height", ofs: STOFS("height"), type: fieldtype_t.F_INT, flags: FFL_SPAWNTEMP },
  { name: "noise", ofs: STOFS("noise"), type: fieldtype_t.F_LSTRING, flags: FFL_SPAWNTEMP },
  { name: "pausetime", ofs: STOFS("pausetime"), type: fieldtype_t.F_FLOAT, flags: FFL_SPAWNTEMP },
  { name: "item", ofs: STOFS("item"), type: fieldtype_t.F_LSTRING, flags: FFL_SPAWNTEMP },
  { name: "item", ofs: FOFS("item"), type: fieldtype_t.F_ITEM, flags: 0 },
  { name: "gravity", ofs: STOFS("gravity"), type: fieldtype_t.F_LSTRING, flags: FFL_SPAWNTEMP },
  { name: "sky", ofs: STOFS("sky"), type: fieldtype_t.F_LSTRING, flags: FFL_SPAWNTEMP },
  { name: "skyrotate", ofs: STOFS("skyrotate"), type: fieldtype_t.F_FLOAT, flags: FFL_SPAWNTEMP },
  { name: "skyaxis", ofs: STOFS("skyaxis"), type: fieldtype_t.F_VECTOR, flags: FFL_SPAWNTEMP },
  { name: "minyaw", ofs: STOFS("minyaw"), type: fieldtype_t.F_FLOAT, flags: FFL_SPAWNTEMP },
  { name: "maxyaw", ofs: STOFS("maxyaw"), type: fieldtype_t.F_FLOAT, flags: FFL_SPAWNTEMP },
  { name: "minpitch", ofs: STOFS("minpitch"), type: fieldtype_t.F_FLOAT, flags: FFL_SPAWNTEMP },
  { name: "maxpitch", ofs: STOFS("maxpitch"), type: fieldtype_t.F_FLOAT, flags: FFL_SPAWNTEMP },
  { name: "nextmap", ofs: STOFS("nextmap"), type: fieldtype_t.F_LSTRING, flags: FFL_SPAWNTEMP }
];

export const levelfields: field_t[] = [
  { name: "changemap", ofs: LLOFS("changemap"), type: fieldtype_t.F_LSTRING, flags: 0 },
  { name: "sight_client", ofs: LLOFS("sight_client"), type: fieldtype_t.F_EDICT, flags: 0 },
  { name: "sight_entity", ofs: LLOFS("sight_entity"), type: fieldtype_t.F_EDICT, flags: 0 },
  { name: "sound_entity", ofs: LLOFS("sound_entity"), type: fieldtype_t.F_EDICT, flags: 0 },
  { name: "sound2_entity", ofs: LLOFS("sound2_entity"), type: fieldtype_t.F_EDICT, flags: 0 }
];

export const clientfields: field_t[] = [
  { name: "pers.weapon", ofs: "pers.weapon", type: fieldtype_t.F_ITEM, flags: 0 },
  { name: "pers.lastweapon", ofs: "pers.lastweapon", type: fieldtype_t.F_ITEM, flags: 0 },
  { name: "newweapon", ofs: CLOFS("newweapon"), type: fieldtype_t.F_ITEM, flags: 0 }
];

for (const moduleExports of [
  gAiExports,
  gFuncExports,
  gItemsExports,
  gMiscExports,
  gMonsterExports,
  gTargetExports,
  gTriggerExports,
  gTurretExports,
  gUtilsExports,
  gWeaponExports,
  mBerserkExports,
  mBoss2Exports,
  mBoss3Exports,
  mBoss31Exports,
  mBoss32Exports,
  mBrainExports,
  mChickExports,
  mFlipperExports,
  mFloatExports,
  mFlyerExports,
  mGladiatorExports,
  mGunnerExports,
  mHoverExports,
  mInfantryExports,
  mMedicExports,
  mMutantExports,
  mParasiteExports,
  mSoldierExports,
  mSupertankExports,
  mTankExports,
  pClientExports,
  pTrailExports
]) {
  registerGameSaveFunctions(moduleExports);
  registerGameSaveMoves(moduleExports);
}

/**
 * Original name: Function
 * Source: game/g_save.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Registers a TypeScript callback under a stable source-style name for savegame restore.
 *
 * Porting notes:
 * - Replaces native pointer offsets relative to `InitGame` with explicit symbolic names.
 */
export function registerGameSaveFunction(name: string, callback: SaveCallback): void {
  saveFunctionByName.set(name, callback);
  saveFunctionNameByRef.set(callback, name);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local callback registry helper)
 * Category: New
 * Purpose: Register all named function exports from one gameplay module for save/load callback restoration.
 */
export function registerGameSaveFunctions(moduleExports: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(moduleExports)) {
    if (typeof value === "function") {
      registerGameSaveFunction(name, value as SaveCallback);
    }
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (local callback registry helper)
 * Category: New
 * Purpose: Resolve a saved callback name back into a runtime function.
 */
export function findGameSaveFunction(name: string | null): SaveCallback | undefined {
  return name ? saveFunctionByName.get(name) : undefined;
}

/**
 * Original name: F_MMOVE relocation
 * Source: game/g_save.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Registers one `mmove_t` object under a stable source-style name for savegame restore.
 *
 * Porting notes:
 * - Replaces native data-segment offsets relative to `mmove_reloc` with explicit symbolic names.
 */
export function registerGameSaveMove(name: string, move: GameMonsterMove): void {
  saveMoveByName.set(name, move);
  saveMoveNameByRef.set(move, name);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local mmove registry helper)
 * Category: New
 * Purpose: Register all `mmove_t`-shaped exports from one gameplay module for save/load move restoration.
 */
export function registerGameSaveMoves(moduleExports: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(moduleExports)) {
    if (isGameMonsterMove(value)) {
      registerGameSaveMove(name, value);
    }
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (local mmove registry helper)
 * Category: New
 * Purpose: Resolve a saved `mmove_t` name back into a runtime move descriptor.
 */
export function findGameSaveMove(name: string | null): GameMonsterMove | undefined {
  return name ? saveMoveByName.get(name) : undefined;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local host persistence contract)
 * Category: New
 * Purpose: Describe the host file hooks used instead of C `FILE *` handles.
 */
interface SaveFileHooks {
  readFile?: (path: string) => string | Uint8Array | null | undefined;
  writeFile?: (path: string, contents: string) => boolean | void;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local structured save payload)
 * Category: New
 * Purpose: Shape the cross-level game save payload written by `WriteGame`.
 */
interface GameSaveFile {
  format: typeof SAVEGAME_FORMAT;
  date: string;
  autosave: boolean;
  game: ReturnType<typeof snapshotGame>;
  clients: Array<ReturnType<typeof snapshotClient>>;
  notes: string[];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local structured save payload)
 * Category: New
 * Purpose: Shape the level save payload written by `WriteLevel`.
 */
interface LevelSaveFile {
  format: typeof SAVEGAME_FORMAT;
  date: string;
  edict_size: number;
  function_base: string;
  level: ReturnType<typeof snapshotLevel>;
  entities: Array<{ entnum: number; entity: ReturnType<typeof snapshotEntity> }>;
  notes: string[];
}

/**
 * Original name: WriteGame
 * Source: game/g_save.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Saves cross-level game data and per-client state through the host persistence hook.
 */
export function WriteGame(context: GameMainContext, filename: string, autosave: qboolean): void {
  if (!autosave) {
    SaveClientData(context.runtime);
  }

  context.runtime.autosaved = autosave;
  context.game.autosaved = autosave;
  context.game.serverflags = context.runtime.serverflags;
  const save: GameSaveFile = {
    format: SAVEGAME_FORMAT,
    date: SAVEGAME_DATE,
    autosave,
    game: snapshotGame(context),
    clients: Array.from(
      { length: Math.max(0, Math.trunc(context.game.maxclients)) },
      (_, i) => snapshotClient(clientSlotForSave(context, i), context.runtime)
    ),
    notes: [UNRESTORED_CALLBACK_NOTE]
  };
  context.game.autosaved = false;
  context.runtime.autosaved = false;

  writeSaveFile(context, filename, save);
}

function clientSlotForSave(context: GameMainContext, index: number): GameClient {
  const client = context.game.clients[index]
    ?? context.runtime.entities[index + 1]?.client
    ?? attachGameClient(createRuntimeEntity({ classname: "player" }, index + 1));
  context.game.clients[index] = client;
  return client;
}

/**
 * Original name: ReadGame
 * Source: game/g_save.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Restores cross-level game data and per-client state from the host persistence hook.
 */
export function ReadGame(context: GameMainContext, filename: string): void {
  context.gi.FreeTags(TAG_GAME);
  const save = readSaveFile<GameSaveFile>(context, filename);
  validateSaveFile(context, save);

  context.game.helpmessage1 = save.game.helpmessage1;
  context.game.helpmessage2 = save.game.helpmessage2;
  context.game.helpchanged = save.game.helpchanged;
  context.game.spawnpoint = save.game.spawnpoint;
  context.game.maxclients = save.game.maxclients;
  context.game.maxentities = save.game.maxentities;
  context.game.serverflags = save.game.serverflags;
  context.game.num_items = save.game.num_items;
  context.game.autosaved = save.game.autosaved;
  context.runtime.maxclients = save.game.maxclients;
  context.runtime.maxentities = save.game.maxentities;
  context.runtime.serverflags = save.game.serverflags;
  context.runtime.helpmessage1 = save.game.helpmessage1;
  context.runtime.helpmessage2 = save.game.helpmessage2;
  context.runtime.helpchanged = save.game.helpchanged;
  context.runtime.spawnpoint = save.game.spawnpoint;
  context.runtime.autosaved = save.game.autosaved;
  context.game.clients = save.clients.map((client) => restoreClient(client));
}

/**
 * Original name: WriteLevel
 * Source: game/g_save.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Saves level locals and all in-use edicts, preserving edict indexes.
 */
export function WriteLevel(context: GameMainContext, filename: string): void {
  const save: LevelSaveFile = {
    format: SAVEGAME_FORMAT,
    date: SAVEGAME_DATE,
    edict_size: Object.keys(context.runtime.entities[0] ?? {}).length,
    function_base: "InitGame",
    level: snapshotLevel(context),
    entities: context.runtime.entities
      .filter((entity) => entity.inuse)
      .map((entity) => ({ entnum: entity.index, entity: snapshotEntity(entity, context.runtime) })),
    notes: [UNRESTORED_CALLBACK_NOTE]
  };

  writeSaveFile(context, filename, save);
}

/**
 * Original name: ReadLevel
 * Source: game/g_save.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Restores level locals and in-use edicts, then relinks restored entities through the engine import.
 *
 * Porting notes:
 * - The binary edict-size and function-base guards are represented by structured compatibility markers.
 */
export function ReadLevel(context: GameMainContext, filename: string): void {
  context.gi.FreeTags(TAG_LEVEL);
  const save = readSaveFile<LevelSaveFile>(context, filename);
  validateSaveFile(context, save);
  validateLevelSaveFile(context, save);

  resetRuntimeEntitiesForLevelLoad(context.runtime);

  for (const record of save.entities) {
    while (context.runtime.entities.length <= record.entnum) {
      context.runtime.entities.push(createClearedRuntimeEntity(context.runtime.entities.length));
    }
    context.runtime.entities[record.entnum] = restoreEntity(record.entity, context.runtime);
  }

  resolveEntityReferences(context.runtime, save.entities);
  restoreLevel(context, save.level);
  syncRuntimeFromLevel(context);

  for (const entity of context.runtime.entities) {
    entity.area = { prev: null, next: null };
    if (entity.inuse) {
      linkGameEntity(context.runtime, entity);
      context.gi.linkentity(entity);
    }
  }

  for (let i = 0; i < context.runtime.maxclients; i += 1) {
    const entnum = i + 1;
    const ent = context.runtime.entities[entnum] ?? createClearedRuntimeEntity(entnum);
    context.runtime.entities[entnum] = ent;
    ent.classname = ent.classname === "noclass" ? "player" : ent.classname;
    ent.client = context.game.clients[i] ?? attachGameClient(ent);
    ent.client.pers.connected = false;
  }

  for (const entity of context.runtime.entities) {
    if (entity.inuse && entity.classname === "target_crosslevel_target") {
      entity.nextthink = context.level.time + entity.delay;
    }
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (local structured restore helper)
 * Category: New
 * Purpose: Recreate the cleared edict array state expected before `ReadLevel` materializes saved entities.
 */
function resetRuntimeEntitiesForLevelLoad(runtime: GameRuntime): void {
  runtime.entities.length = 0;
  runtime.entities.push(createClearedRuntimeEntity(0));
  for (let index = 1; index <= runtime.maxclients; index += 1) {
    const ent = createClearedRuntimeEntity(index);
    ent.classname = "player";
    ent.properties.classname = "player";
    runtime.entities.push(ent);
  }

  runtime.current_entity = null;
  runtime.sight_client = null;
  runtime.sight_entity = null;
  runtime.sound_entity = null;
  runtime.sound2_entity = null;
  runtime.linkedSolidEntities = [];
  runtime.linkedTriggerEntities = [];
  runtime.linkedInlineBspEntities = [];
  runtime.linkedRuntimeTriggerEntities = [];
  runtime.linkedDynamicBoxEntities = [];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local structured restore helper)
 * Category: New
 * Purpose: Create one cleared edict slot for the structured `ReadLevel` rebuild.
 */
function createClearedRuntimeEntity(index: number): GameEntity {
  const entity = createRuntimeEntity({ classname: "noclass" }, index);
  entity.inuse = false;
  return entity;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local structured save helper)
 * Category: New
 * Purpose: Snapshot the serializable subset of `game_locals_t` used by `WriteGame`.
 */
function snapshotGame(context: GameMainContext) {
  return {
    helpmessage1: context.game.helpmessage1,
    helpmessage2: context.game.helpmessage2,
    helpchanged: context.game.helpchanged,
    spawnpoint: context.game.spawnpoint,
    maxclients: context.game.maxclients,
    maxentities: context.game.maxentities,
    serverflags: context.game.serverflags,
    num_items: context.game.num_items,
    autosaved: context.game.autosaved
  };
}

/**
 * Original name: WriteLevelLocals
 * Source: game/g_save.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Snapshots `level_locals_t`, preserving scalar/vector state and encoding the
 *   original `levelfields` pointers as stable string payloads or edict indexes.
 *
 * Porting notes:
 * - Replaces the C temporary block plus `field_t` write passes with one
 *   structured JSON object; `restoreLevel` performs the matching edict lookups.
 */
function snapshotLevel(context: GameMainContext) {
  return {
    framenum: context.level.framenum,
    time: context.level.time,
    level_name: context.level.level_name,
    mapname: context.level.mapname,
    nextmap: context.level.nextmap,
    intermissiontime: context.level.intermissiontime,
    changemap: context.level.changemap,
    exitintermission: context.level.exitintermission,
    intermission_origin: copyVec3(context.level.intermission_origin),
    intermission_angle: copyVec3(context.level.intermission_angle),
    sight_client: entityIndex(context.level.sight_client),
    sight_entity: entityIndex(context.level.sight_entity),
    sight_entity_framenum: context.level.sight_entity_framenum,
    sound_entity: entityIndex(context.level.sound_entity),
    sound_entity_framenum: context.level.sound_entity_framenum,
    sound2_entity: entityIndex(context.level.sound2_entity),
    sound2_entity_framenum: context.level.sound2_entity_framenum,
    pic_health: context.level.pic_health,
    total_secrets: context.level.total_secrets,
    found_secrets: context.level.found_secrets,
    total_goals: context.level.total_goals,
    found_goals: context.level.found_goals,
    total_monsters: context.level.total_monsters,
    killed_monsters: context.level.killed_monsters,
    current_entity: entityIndex(context.level.current_entity),
    body_que: context.level.body_que,
    power_cubes: context.level.power_cubes
  };
}

/**
 * Original name: ReadLevelLocals
 * Source: game/g_save.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Restores `level_locals_t` state from the structured level snapshot and rematerializes the original `levelfields`
 *   edict pointers through saved edict indexes.
 *
 * Porting notes:
 * - Replaces the C raw `fread` plus `ReadField` pass with assignments from the JSON save payload; `ReadLevel`
 *   restores the edict array first so level-local edict references can resolve to runtime objects.
 */
function restoreLevel(context: GameMainContext, snapshot: ReturnType<typeof snapshotLevel>): void {
  context.level.framenum = snapshot.framenum;
  context.level.time = snapshot.time;
  context.level.level_name = snapshot.level_name;
  context.level.mapname = snapshot.mapname;
  context.level.nextmap = snapshot.nextmap;
  context.level.intermissiontime = snapshot.intermissiontime;
  context.level.changemap = snapshot.changemap;
  context.level.exitintermission = snapshot.exitintermission;
  context.level.intermission_origin = copyVec3(snapshot.intermission_origin);
  context.level.intermission_angle = copyVec3(snapshot.intermission_angle);
  context.level.sight_client = edictByIndex(context.runtime, snapshot.sight_client);
  context.level.sight_entity = edictByIndex(context.runtime, snapshot.sight_entity);
  context.level.sight_entity_framenum = snapshot.sight_entity_framenum;
  context.level.sound_entity = edictByIndex(context.runtime, snapshot.sound_entity);
  context.level.sound_entity_framenum = snapshot.sound_entity_framenum;
  context.level.sound2_entity = edictByIndex(context.runtime, snapshot.sound2_entity);
  context.level.sound2_entity_framenum = snapshot.sound2_entity_framenum;
  context.level.pic_health = snapshot.pic_health;
  context.level.total_secrets = snapshot.total_secrets;
  context.level.found_secrets = snapshot.found_secrets;
  context.level.total_goals = snapshot.total_goals;
  context.level.found_goals = snapshot.found_goals;
  context.level.total_monsters = snapshot.total_monsters;
  context.level.killed_monsters = snapshot.killed_monsters;
  context.level.current_entity = edictByIndex(context.runtime, snapshot.current_entity);
  context.level.body_que = snapshot.body_que;
  context.level.power_cubes = snapshot.power_cubes;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local runtime mirror helper)
 * Category: New
 * Purpose: Mirror restored `level_locals_t` values into the object-based gameplay runtime.
 */
function syncRuntimeFromLevel(context: GameMainContext): void {
  context.runtime.framenum = context.level.framenum;
  context.runtime.time = context.level.time;
  context.runtime.intermissiontime = context.level.intermissiontime;
  context.runtime.exitintermission = context.level.exitintermission;
  context.runtime.intermission_origin = copyVec3(context.level.intermission_origin);
  context.runtime.intermission_angle = copyVec3(context.level.intermission_angle);
  context.runtime.changemap = context.level.changemap;
  context.runtime.pic_health = context.level.pic_health;
  context.runtime.total_secrets = context.level.total_secrets;
  context.runtime.found_secrets = context.level.found_secrets;
  context.runtime.total_goals = context.level.total_goals;
  context.runtime.found_goals = context.level.found_goals;
  context.runtime.total_monsters = context.level.total_monsters;
  context.runtime.killed_monsters = context.level.killed_monsters;
  context.runtime.current_entity = context.level.current_entity;
  context.runtime.body_que = context.level.body_que;
  context.runtime.power_cubes = context.level.power_cubes;
  context.runtime.sight_client = context.level.sight_client;
  context.runtime.sight_entity = context.level.sight_entity;
  context.runtime.sight_entity_framenum = context.level.sight_entity_framenum;
  context.runtime.sound_entity = context.level.sound_entity;
  context.runtime.sound_entity_framenum = context.level.sound_entity_framenum;
  context.runtime.sound2_entity = context.level.sound2_entity;
  context.runtime.sound2_entity_framenum = context.level.sound2_entity_framenum;
}

/**
 * Original name: WriteClient
 * Source: game/g_save.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Snapshots one `gclient_t`, preserving scalar/vector state and encoding the
 *   original `clientfields` item pointers as stable item indexes.
 *
 * Porting notes:
 * - Replaces the C temporary block plus `field_t` write passes with one
 *   structured JSON object; `restoreClient` performs the matching item lookup.
 */
function snapshotClient(client: GameClient, runtime: GameRuntime) {
  return {
    ...client,
    pers: {
      ...client.pers,
      inventory: client.pers.inventory.slice(),
      weapon: itemIndex(client.pers.weapon),
      lastweapon: itemIndex(client.pers.lastweapon)
    },
    resp: {
      ...client.resp,
      cmd_angles: copyVec3(client.resp.cmd_angles),
      coop_respawn: {
        ...client.resp.coop_respawn,
        inventory: client.resp.coop_respawn.inventory.slice(),
        weapon: itemIndex(client.resp.coop_respawn.weapon),
        lastweapon: itemIndex(client.resp.coop_respawn.lastweapon)
      }
    },
    ps: clonePlain(client.ps),
    old_pmove: clonePlain(client.old_pmove),
    kick_angles: copyVec3(client.kick_angles),
    kick_origin: copyVec3(client.kick_origin),
    v_angle: copyVec3(client.v_angle),
    damage_blend: copyVec3(client.damage_blend),
    oldviewangles: copyVec3(client.oldviewangles),
    oldvelocity: copyVec3(client.oldvelocity),
    damage_from: copyVec3(client.damage_from),
    newweapon: itemIndex(client.newweapon),
    chase_target: entityIndex(client.chase_target)
  };
}

/**
 * Original name: ReadClient
 * Source: game/g_save.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Restores one `gclient_t` from the structured snapshot and resolves the
 *   original `clientfields` item indexes back to item pointers.
 *
 * Porting notes:
 * - Replaces the C `fread` block plus `ReadField` pass with object cloning and
 *   explicit `GetItemByIndex` lookups for `pers.weapon`, `pers.lastweapon` and
 *   `newweapon`.
 */
function restoreClient(snapshot: ReturnType<typeof snapshotClient>): GameClient {
  const client = attachGameClient(createRuntimeEntity({ classname: "player" }, -1));
  Object.assign(client, snapshot);
  client.pers = {
    ...snapshot.pers,
    inventory: snapshot.pers.inventory.slice(),
    weapon: GetItemByIndex(snapshot.pers.weapon),
    lastweapon: GetItemByIndex(snapshot.pers.lastweapon)
  };
  client.resp = {
    ...snapshot.resp,
    cmd_angles: copyVec3(snapshot.resp.cmd_angles),
    coop_respawn: {
      ...snapshot.resp.coop_respawn,
      inventory: snapshot.resp.coop_respawn.inventory.slice(),
      weapon: GetItemByIndex(snapshot.resp.coop_respawn.weapon),
      lastweapon: GetItemByIndex(snapshot.resp.coop_respawn.lastweapon)
    }
  };
  client.newweapon = GetItemByIndex(snapshot.newweapon);
  client.chase_target = null;
  return client;
}

/**
 * Original name: WriteEdict
 * Source: game/g_save.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Captures one edict for `WriteLevel`, preserving scalar/vector fields while encoding pointers and callbacks as stable values.
 *
 * Porting notes:
 * - Replaces the C temporary `edict_t temp` and `WriteField1`/`WriteField2` binary passes with one structured JSON payload.
 */
function snapshotEntity(entity: GameEntity, runtime: GameRuntime) {
  return {
    ...entity,
    callbacks: snapshotEntityCallbacks(entity),
    properties: { ...entity.properties },
    client: entity.client ? snapshotClient(entity.client, runtime) : null,
    owner: entityIndex(entity.owner),
    enemy: entityIndex(entity.enemy),
    oldenemy: entityIndex(entity.oldenemy),
    teammaster: entityIndex(entity.teammaster),
    teamchain: entityIndex(entity.teamchain),
    target_ent: entityIndex(entity.target_ent),
    activator: entityIndex(entity.activator),
    chain: entityIndex(entity.chain),
    goalentity: entityIndex(entity.goalentity),
    movetarget: entityIndex(entity.movetarget),
    groundentity: entityIndex(entity.groundentity),
    mynoise: entityIndex(entity.mynoise),
    mynoise2: entityIndex(entity.mynoise2),
    item: itemIndex(entity.item),
    s: clonePlain(entity.s),
    area: { prev: null, next: null },
    clusternums: Array.from(entity.clusternums),
    origin: copyVec3(entity.origin),
    angles: copyVec3(entity.angles),
    pos1: copyVec3(entity.pos1),
    pos2: copyVec3(entity.pos2),
    mins: copyVec3(entity.mins),
    maxs: copyVec3(entity.maxs),
    absmin: copyVec3(entity.absmin),
    absmax: copyVec3(entity.absmax),
    size: copyVec3(entity.size),
    movedir: copyVec3(entity.movedir),
    velocity: copyVec3(entity.velocity),
    avelocity: copyVec3(entity.avelocity),
    move_origin: copyVec3(entity.move_origin),
    move_angles: copyVec3(entity.move_angles),
    moveinfo: snapshotMoveInfo(entity.moveinfo),
    monsterinfo: {
      ...entity.monsterinfo,
      currentmove: null,
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
      saved_goal: copyVec3(entity.monsterinfo.saved_goal),
      last_sighting: copyVec3(entity.monsterinfo.last_sighting)
    },
    use: undefined,
    prethink: undefined,
    think: undefined,
    touch: undefined,
    blocked: undefined,
    die: undefined,
    pain: undefined
  };
}

/**
 * Original name: ReadEdict
 * Source: game/g_save.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Restores one edict for `ReadLevel`, rebuilding scalar/vector fields and resolving saved pointers, items, callbacks and moves.
 *
 * Porting notes:
 * - Replaces the C `fread` plus `fields`/`ReadField` pass with a structured JSON entity payload.
 */
function restoreEntity(snapshot: ReturnType<typeof snapshotEntity>, runtime: GameRuntime): GameEntity {
  const entity = createRuntimeEntity(snapshot.properties, snapshot.index);
  const { callbacks, ...entitySnapshot } = snapshot;
  Object.assign(entity, entitySnapshot);
  entity.client = snapshot.client ? restoreClient(snapshot.client) : null;
  entity.owner = edictByIndex(runtime, snapshot.owner);
  entity.enemy = edictByIndex(runtime, snapshot.enemy);
  entity.oldenemy = edictByIndex(runtime, snapshot.oldenemy);
  entity.teammaster = edictByIndex(runtime, snapshot.teammaster);
  entity.teamchain = edictByIndex(runtime, snapshot.teamchain);
  entity.target_ent = edictByIndex(runtime, snapshot.target_ent);
  entity.activator = edictByIndex(runtime, snapshot.activator);
  entity.chain = edictByIndex(runtime, snapshot.chain);
  entity.goalentity = edictByIndex(runtime, snapshot.goalentity);
  entity.movetarget = edictByIndex(runtime, snapshot.movetarget);
  entity.groundentity = edictByIndex(runtime, snapshot.groundentity);
  entity.mynoise = edictByIndex(runtime, snapshot.mynoise);
  entity.mynoise2 = edictByIndex(runtime, snapshot.mynoise2);
  entity.item = GetItemByIndex(snapshot.item);
  entity.clusternums = Int32Array.from(snapshot.clusternums);
  entity.area = { prev: null, next: null };
  restoreEntityCallbacks(entity, callbacks);
  return entity;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local structured save helper)
 * Category: New
 * Purpose: Encode edict callback and monster move references as stable registry names.
 */
function snapshotEntityCallbacks(entity: GameEntity) {
  return {
    prethink: callbackName(entity.prethink),
    think: callbackName(entity.think),
    blocked: callbackName(entity.blocked),
    touch: callbackName(entity.touch),
    use: callbackName(entity.use),
    pain: callbackName(entity.pain),
    die: callbackName(entity.die),
    monsterinfo: {
      currentmove: moveName(entity.monsterinfo.currentmove),
      stand: callbackName(entity.monsterinfo.stand),
      idle: callbackName(entity.monsterinfo.idle),
      search: callbackName(entity.monsterinfo.search),
      walk: callbackName(entity.monsterinfo.walk),
      run: callbackName(entity.monsterinfo.run),
      dodge: callbackName(entity.monsterinfo.dodge),
      attack: callbackName(entity.monsterinfo.attack),
      melee: callbackName(entity.monsterinfo.melee),
      sight: callbackName(entity.monsterinfo.sight),
      checkattack: callbackName(entity.monsterinfo.checkattack)
    },
    moveinfo: {
      endfunc: callbackName(entity.moveinfo.endfunc)
    }
  };
}

/**
 * Original name: N/A
 * Source declaree: N/A (local structured restore helper)
 * Category: New
 * Purpose: Resolve saved callback and monster move names back into runtime references.
 */
function restoreEntityCallbacks(entity: GameEntity, callbacks: ReturnType<typeof snapshotEntityCallbacks>): void {
  entity.prethink = findGameSaveFunction(callbacks.prethink) as GameEntity["prethink"];
  entity.think = findGameSaveFunction(callbacks.think) as GameEntity["think"];
  entity.blocked = findGameSaveFunction(callbacks.blocked) as GameEntity["blocked"];
  entity.touch = findGameSaveFunction(callbacks.touch) as GameEntity["touch"];
  entity.use = findGameSaveFunction(callbacks.use) as GameEntity["use"];
  entity.pain = findGameSaveFunction(callbacks.pain) as GameEntity["pain"];
  entity.die = findGameSaveFunction(callbacks.die) as GameEntity["die"];
  entity.monsterinfo.stand = findGameSaveFunction(callbacks.monsterinfo.stand) as GameEntity["monsterinfo"]["stand"];
  entity.monsterinfo.currentmove = findGameSaveMove(callbacks.monsterinfo.currentmove) ?? null;
  entity.monsterinfo.idle = findGameSaveFunction(callbacks.monsterinfo.idle) as GameEntity["monsterinfo"]["idle"];
  entity.monsterinfo.search = findGameSaveFunction(callbacks.monsterinfo.search) as GameEntity["monsterinfo"]["search"];
  entity.monsterinfo.walk = findGameSaveFunction(callbacks.monsterinfo.walk) as GameEntity["monsterinfo"]["walk"];
  entity.monsterinfo.run = findGameSaveFunction(callbacks.monsterinfo.run) as GameEntity["monsterinfo"]["run"];
  entity.monsterinfo.dodge = findGameSaveFunction(callbacks.monsterinfo.dodge) as GameEntity["monsterinfo"]["dodge"];
  entity.monsterinfo.attack = findGameSaveFunction(callbacks.monsterinfo.attack) as GameEntity["monsterinfo"]["attack"];
  entity.monsterinfo.melee = findGameSaveFunction(callbacks.monsterinfo.melee) as GameEntity["monsterinfo"]["melee"];
  entity.monsterinfo.sight = findGameSaveFunction(callbacks.monsterinfo.sight) as GameEntity["monsterinfo"]["sight"];
  entity.monsterinfo.checkattack = findGameSaveFunction(callbacks.monsterinfo.checkattack) as GameEntity["monsterinfo"]["checkattack"];
  entity.moveinfo.endfunc = findGameSaveFunction(callbacks.moveinfo.endfunc) as GameEntity["moveinfo"]["endfunc"];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local structured save helper)
 * Category: New
 * Purpose: Snapshot `moveinfo_t` fields while encoding `endfunc` separately through the callback registry.
 */
function snapshotMoveInfo(moveinfo: GameMoveInfo) {
  return {
    ...moveinfo,
    start_origin: copyVec3(moveinfo.start_origin),
    end_origin: copyVec3(moveinfo.end_origin),
    start_angles: copyVec3(moveinfo.start_angles),
    end_angles: copyVec3(moveinfo.end_angles),
    dir: copyVec3(moveinfo.dir),
    endfunc: undefined
  };
}

/**
 * Original name: N/A
 * Source declaree: N/A (local structured restore helper)
 * Category: New
 * Purpose: Resolve saved edict indexes after all restored entities have been materialized.
 */
function resolveEntityReferences(runtime: GameRuntime, records: LevelSaveFile["entities"]): void {
  for (const record of records) {
    const entity = runtime.entities[record.entnum];
    if (!entity) {
      continue;
    }
    entity.owner = edictByIndex(runtime, record.entity.owner);
    entity.enemy = edictByIndex(runtime, record.entity.enemy);
    entity.oldenemy = edictByIndex(runtime, record.entity.oldenemy);
    entity.teammaster = edictByIndex(runtime, record.entity.teammaster);
    entity.teamchain = edictByIndex(runtime, record.entity.teamchain);
    entity.target_ent = edictByIndex(runtime, record.entity.target_ent);
    entity.activator = edictByIndex(runtime, record.entity.activator);
    entity.chain = edictByIndex(runtime, record.entity.chain);
    entity.goalentity = edictByIndex(runtime, record.entity.goalentity);
    entity.movetarget = edictByIndex(runtime, record.entity.movetarget);
    entity.groundentity = edictByIndex(runtime, record.entity.groundentity);
    entity.mynoise = edictByIndex(runtime, record.entity.mynoise);
    entity.mynoise2 = edictByIndex(runtime, record.entity.mynoise2);
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (local host persistence helper)
 * Category: New
 * Purpose: Write a structured save payload through the injected host file hook.
 */
function writeSaveFile(context: GameMainContext, filename: string, payload: unknown): void {
  const hooks = context.hooks as SaveFileHooks;
  if (!hooks.writeFile) {
    context.gi.error("Couldn't open %s", filename);
    return;
  }

  const result = hooks.writeFile(filename, `${JSON.stringify(payload)}\n`);
  if (result === false) {
    context.gi.error("Couldn't open %s", filename);
  }
}

function readSaveFile<T>(context: GameMainContext, filename: string): T {
  const hooks = context.hooks as SaveFileHooks;
  if (!hooks.readFile) {
    context.gi.error("Couldn't open %s", filename);
    throw new Error(`Couldn't open ${filename}`);
  }

  const contents = hooks.readFile(filename);
  if (contents == null) {
    context.gi.error("Couldn't open %s", filename);
    throw new Error(`Couldn't open ${filename}`);
  }

  const text = typeof contents === "string" ? contents : new TextDecoder().decode(contents);
  return JSON.parse(text) as T;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local structured save helper)
 * Category: New
 * Purpose: Validate the TypeScript structured save format and compatibility marker.
 */
function validateSaveFile(context: GameMainContext, save: { format?: string; date?: string }): void {
  if (save.format !== SAVEGAME_FORMAT || save.date !== SAVEGAME_DATE) {
    context.gi.error("Savegame from an older version.\n");
  }
}

function validateLevelSaveFile(context: GameMainContext, save: LevelSaveFile): void {
  const expectedEdictSize = Object.keys(context.runtime.entities[0] ?? createClearedRuntimeEntity(0)).length;
  if (save.edict_size !== expectedEdictSize) {
    context.gi.error("ReadLevel: mismatched edict size");
  }

  if (save.function_base !== "InitGame") {
    context.gi.error("ReadLevel: function pointers have moved");
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (local structured save helper)
 * Category: New
 * Purpose: Encode nullable edict references as saved edict indexes.
 */
function entityIndex(entity: GameEntity | null | undefined): number {
  return entity ? entity.index : -1;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local structured restore helper)
 * Category: New
 * Purpose: Resolve saved edict indexes back to nullable runtime entity references.
 */
function edictByIndex(runtime: GameRuntime, index: number): GameEntity | null {
  return index === -1 ? null : runtime.entities[index] ?? null;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local structured save helper)
 * Category: New
 * Purpose: Encode nullable item references as saved item indexes.
 */
function itemIndex(item: Parameters<typeof ITEM_INDEX>[0] | null | undefined): number {
  return item ? ITEM_INDEX(item) : -1;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local callback registry helper)
 * Category: New
 * Purpose: Encode nullable callbacks as stable registry names.
 */
function callbackName(callback: unknown): string | null {
  if (typeof callback !== "function") {
    return null;
  }

  return saveFunctionNameByRef.get(callback as SaveCallback) ?? null;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local mmove registry helper)
 * Category: New
 * Purpose: Encode nullable monster move descriptors as stable registry names.
 */
function moveName(move: GameMonsterMove | null | undefined): string | null {
  return move ? saveMoveNameByRef.get(move) ?? null : null;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local mmove registry helper)
 * Category: New
 * Purpose: Detect exported `mmove_t`-shaped objects for automatic save registry setup.
 */
function isGameMonsterMove(value: unknown): value is GameMonsterMove {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<GameMonsterMove>;
  return (
    typeof candidate.firstframe === "number" &&
    typeof candidate.lastframe === "number" &&
    Array.isArray(candidate.frame)
  );
}

function copyVec3<T extends vec3_t>(value: T): T {
  return [value[0], value[1], value[2]] as T;
}

function clonePlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
