/**
 * File: g_cmds.ts
 * Source: Quake II original / game/g_cmds.c
 * Purpose: Port of player-issued game commands, inventory selection, chat and cheat helpers.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Engine imports (`gi.*`) are carried by an explicit command context.
 * - Item use/drop dispatch maps string-backed item callbacks onto the already ported TypeScript functions.
 * - `sv_cheats`, flood-protection and dedicated-server cvars are read from optional explicit cvar handles.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

import {
  DF_MODELTEAMS,
  DF_SKINTEAMS,
  MAX_ITEMS,
  PMF_DUCKED,
  PRINT_CHAT,
  PRINT_HIGH,
  Q_stricmp,
  STAT_FRAGS
} from "../../qcommon/src/index.js";
import { Info_ValueForKey } from "../../qcommon/src/common.js";
import type { cvar_t } from "../../qcommon/src/index.js";
import {
  ANIM_WAVE,
  FL_GODMODE,
  FL_NOTARGET,
  ITEM_INDEX,
  IT_AMMO,
  IT_ARMOR,
  IT_POWERUP,
  IT_WEAPON,
  MOD_SUICIDE,
  MOVETYPE_NOCLIP,
  MOVETYPE_WALK,
  svc_inventory
} from "./g_local.js";
import {
  FRAME_flip01,
  FRAME_flip12,
  FRAME_point01,
  FRAME_point12,
  FRAME_salute01,
  FRAME_salute11,
  FRAME_taunt01,
  FRAME_taunt17,
  FRAME_wave01,
  FRAME_wave11
} from "./m_player.js";
import { ChaseNext, ChasePrev } from "./g_chase.js";
import {
  Add_Ammo,
  Drop_Ammo,
  Drop_General,
  Drop_PowerArmor,
  FindItem,
  GetArmorInfoByItem,
  GetGameItems,
  GetItemByIndex,
  SpawnItem,
  Touch_Item,
  Use_Breather,
  Use_Envirosuit,
  Use_Invulnerability,
  Use_PowerArmor,
  Use_Quad,
  Use_Silencer
} from "./g_items.js";
import { G_FreeEdict, G_Spawn } from "./g_utils.js";
import { Cmd_Help_f, Cmd_Score_f, type GameHudHelpComputerData, type GameHudHooks } from "./p_hud.js";
import { player_die, type GamePlayerClientHooks } from "./p_client.js";
import { Drop_Weapon, Use_Weapon, type GameWeaponHooks } from "./p_weapon.js";
import type { game_import_t } from "./game.js";
import type { GameEntity, GameRuntime } from "./runtime.js";
import type { GameItemDefinition } from "./g_items.js";

/**
 * Original name: N/A
 * Source declaree: N/A (explicit TS runtime context)
 * Category: New
 * Purpose: Carry the global cvars that `g_cmds.c` read directly in the original game DLL.
 */
export interface GameCommandCvars {
  sv_cheats?: cvar_t | null;
  dedicated?: cvar_t | null;
  flood_msgs?: cvar_t | null;
  flood_persecond?: cvar_t | null;
  flood_waitdelay?: cvar_t | null;
  skill?: cvar_t | null;
}

/**
 * Original name: N/A
 * Source declaree: N/A (explicit TS runtime context)
 * Category: New
 * Purpose: Group optional side-effect hooks shared with HUD/player/weapon command paths.
 */
export interface GameCommandHooks extends GameHudHooks, GamePlayerClientHooks, GameWeaponHooks {}

/**
 * Original name: N/A
 * Source declaree: N/A (explicit TS runtime context)
 * Category: New
 * Purpose: Provide the explicit runtime and engine import surface used by the command dispatcher.
 */
export interface GameCommandContext {
  gi: Pick<
    game_import_t,
    "argc" | "argv" | "args" | "cprintf" | "WriteByte" | "WriteShort" | "unicast"
  >;
  runtime: GameRuntime;
  cvars?: GameCommandCvars;
  hooks?: GameCommandHooks;
  helpData?: Partial<GameHudHelpComputerData>;
}

/**
 * Original name: ClientTeam
 * Source: game/g_cmds.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Extract the client skin team string, using the model prefix when DF_MODELTEAMS is active and the skin suffix otherwise.
 * Porting notes: Mirrors the original static-buffer return value as an immutable string and reads dmflags from the explicit runtime.
 */
export function ClientTeam(ent: GameEntity, runtime: GameRuntime): string {
  if (!ent.client) {
    return "";
  }

  const value = Info_ValueForKey(ent.client.pers.userinfo, "skin");
  const slash = value.indexOf("/");
  if (slash < 0) {
    return value;
  }

  if ((runtime.dmflags & DF_MODELTEAMS) !== 0) {
    return value.slice(0, slash);
  }

  return value.slice(slash + 1);
}

/**
 * Original name: OnSameTeam
 * Source: game/g_cmds.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Return true only when teamplay flags are enabled and both players resolve to the same ClientTeam value.
 * Porting notes: Keeps the original DF_MODELTEAMS precedence through ClientTeam while avoiding C string buffers.
 */
export function OnSameTeam(ent1: GameEntity, ent2: GameEntity, runtime: GameRuntime): boolean {
  if ((runtime.dmflags & (DF_MODELTEAMS | DF_SKINTEAMS)) === 0) {
    return false;
  }

  return ClientTeam(ent1, runtime) === ClientTeam(ent2, runtime);
}

/**
 * Original name: SelectNextItem
 * Source: game/g_cmds.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Advance the client's selected inventory slot to the next usable item matching `itflags`, or chase the next target while spectating.
 * Porting notes: Preserves the MAX_ITEMS wraparound scan and uses the explicit runtime only for the ChaseNext side effect.
 */
export function SelectNextItem(ent: GameEntity, itflags: number, runtime: GameRuntime): void {
  const cl = ent.client;
  if (!cl) {
    return;
  }

  if (cl.chase_target) {
    ChaseNext(ent, runtime);
    return;
  }

  for (let i = 1; i <= MAX_ITEMS; i += 1) {
    const index = positiveModulo(cl.pers.selected_item + i, MAX_ITEMS);
    if (!cl.pers.inventory[index]) {
      continue;
    }

    const it = GetItemByIndex(index);
    if (!it?.use) {
      continue;
    }
    if ((it.flags & itflags) === 0) {
      continue;
    }

    cl.pers.selected_item = index;
    return;
  }

  cl.pers.selected_item = -1;
}

/**
 * Original name: SelectPrevItem
 * Source: game/g_cmds.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Move the client's selected inventory slot to the previous usable item matching `itflags`, or chase the previous target while spectating.
 * Porting notes: Preserves the reverse MAX_ITEMS wraparound scan and uses the explicit runtime only for the ChasePrev side effect.
 */
export function SelectPrevItem(ent: GameEntity, itflags: number, runtime: GameRuntime): void {
  const cl = ent.client;
  if (!cl) {
    return;
  }

  if (cl.chase_target) {
    ChasePrev(ent, runtime);
    return;
  }

  for (let i = 1; i <= MAX_ITEMS; i += 1) {
    const index = positiveModulo(cl.pers.selected_item + MAX_ITEMS - i, MAX_ITEMS);
    if (!cl.pers.inventory[index]) {
      continue;
    }

    const it = GetItemByIndex(index);
    if (!it?.use) {
      continue;
    }
    if ((it.flags & itflags) === 0) {
      continue;
    }

    cl.pers.selected_item = index;
    return;
  }

  cl.pers.selected_item = -1;
}

/**
 * Original name: ValidateSelectedItem
 * Source: game/g_cmds.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Keep the current selected inventory slot when it still has an item, otherwise select the next usable item.
 * Porting notes: The explicit non-negative guard avoids a JavaScript negative array lookup while keeping the intended fallback to SelectNextItem.
 */
export function ValidateSelectedItem(ent: GameEntity, runtime: GameRuntime): void {
  const cl = ent.client;
  if (!cl) {
    return;
  }

  if (cl.pers.selected_item >= 0 && cl.pers.inventory[cl.pers.selected_item]) {
    return;
  }

  SelectNextItem(ent, -1, runtime);
}

/**
 * Original name: Cmd_Give_f
 * Source: game/g_cmds.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Grants health, weapons, ammo, armor, power shield or a named pickup through the original cheat command flow.
 *
 * Porting notes:
 * - Preserves command argument checks and item side effects while routing globals and gi calls through GameCommandContext.
 */
export function Cmd_Give_f(ent: GameEntity, context: GameCommandContext): void {
  const client = ent.client;
  if (!client) {
    return;
  }
  if (!cheatsAllowed(ent, context)) {
    return;
  }

  let name = context.gi.args();
  const give_all = qstricmp(name, "all");

  if (give_all || qstricmp(context.gi.argv(1), "health")) {
    ent.health = context.gi.argc() === 3 ? atoi(context.gi.argv(2)) : ent.max_health;
    if (!give_all) {
      return;
    }
  }

  if (give_all || qstricmp(name, "weapons")) {
    for (const it of GetGameItems()) {
      if (!it.pickup || (it.flags & IT_WEAPON) === 0) {
        continue;
      }
      client.pers.inventory[ITEM_INDEX(it)] += 1;
    }
    if (!give_all) {
      return;
    }
  }

  if (give_all || qstricmp(name, "ammo")) {
    for (const it of GetGameItems()) {
      if (!it.pickup || (it.flags & IT_AMMO) === 0) {
        continue;
      }
      Add_Ammo(ent, it, 1000, context.runtime);
    }
    if (!give_all) {
      return;
    }
  }

  if (give_all || qstricmp(name, "armor")) {
    const jacket = FindItem("Jacket Armor");
    const combat = FindItem("Combat Armor");
    const body = FindItem("Body Armor");
    if (jacket) {
      client.pers.inventory[ITEM_INDEX(jacket)] = 0;
    }
    if (combat) {
      client.pers.inventory[ITEM_INDEX(combat)] = 0;
    }
    if (body) {
      client.pers.inventory[ITEM_INDEX(body)] = GetArmorInfoByItem(body)?.max_count ?? client.pers.inventory[ITEM_INDEX(body)];
    }
    if (!give_all) {
      return;
    }
  }

  if (give_all || qstricmp(name, "Power Shield")) {
    const item = FindItem("Power Shield");
    if (item) {
      giveSpawnedItem(ent, item, context.runtime);
    }
    if (!give_all) {
      return;
    }
  }

  if (give_all) {
    for (const it of GetGameItems()) {
      if (!it.pickup || (it.flags & (IT_ARMOR | IT_WEAPON | IT_AMMO)) !== 0) {
        continue;
      }
      client.pers.inventory[ITEM_INDEX(it)] = 1;
    }
    return;
  }

  let it = FindItem(name);
  if (!it) {
    name = context.gi.argv(1);
    it = FindItem(name);
    if (!it) {
      cprintf(context, ent, PRINT_HIGH, "unknown item\n");
      return;
    }
  }

  if (!it.pickup) {
    cprintf(context, ent, PRINT_HIGH, "non-pickup item\n");
    return;
  }

  const index = ITEM_INDEX(it);
  if ((it.flags & IT_AMMO) !== 0) {
    client.pers.inventory[index] = context.gi.argc() === 3
      ? atoi(context.gi.argv(2))
      : client.pers.inventory[index] + it.quantity;
    return;
  }

  giveSpawnedItem(ent, it, context.runtime);
}

/**
 * Original name: Cmd_God_f
 * Source: game/g_cmds.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function Cmd_God_f(ent: GameEntity, context: GameCommandContext): void {
  if (!cheatsAllowed(ent, context)) {
    return;
  }
  ent.flags ^= FL_GODMODE;
  cprintf(context, ent, PRINT_HIGH, (ent.flags & FL_GODMODE) === 0 ? "godmode OFF\n" : "godmode ON\n");
}

/**
 * Original name: Cmd_Notarget_f
 * Source: game/g_cmds.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function Cmd_Notarget_f(ent: GameEntity, context: GameCommandContext): void {
  if (!cheatsAllowed(ent, context)) {
    return;
  }
  ent.flags ^= FL_NOTARGET;
  cprintf(context, ent, PRINT_HIGH, (ent.flags & FL_NOTARGET) === 0 ? "notarget OFF\n" : "notarget ON\n");
}

/**
 * Original name: Cmd_Noclip_f
 * Source: game/g_cmds.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function Cmd_Noclip_f(ent: GameEntity, context: GameCommandContext): void {
  if (!cheatsAllowed(ent, context)) {
    return;
  }
  if (ent.movetype === MOVETYPE_NOCLIP) {
    ent.movetype = MOVETYPE_WALK;
    cprintf(context, ent, PRINT_HIGH, "noclip OFF\n");
  } else {
    ent.movetype = MOVETYPE_NOCLIP;
    cprintf(context, ent, PRINT_HIGH, "noclip ON\n");
  }
}

/**
 * Original name: Cmd_Use_f
 * Source: game/g_cmds.c
 * Category: Ported
 * Fidelity level: Close
 */
export function Cmd_Use_f(ent: GameEntity, context: GameCommandContext): void {
  const s = context.gi.args();
  const it = FindItem(s);
  if (!it) {
    cprintf(context, ent, PRINT_HIGH, `unknown item: ${s}\n`);
    return;
  }
  if (!it.use) {
    cprintf(context, ent, PRINT_HIGH, "Item is not usable.\n");
    return;
  }
  if (!ent.client?.pers.inventory[ITEM_INDEX(it)]) {
    cprintf(context, ent, PRINT_HIGH, `Out of item: ${s}\n`);
    return;
  }
  callItemUse(ent, it, context.runtime);
}

/**
 * Original name: Cmd_Drop_f
 * Source: game/g_cmds.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Resolve the requested inventory item, reject missing/non-dropable/out-of-stock cases, then dispatch the item drop callback.
 * Porting notes: `ITEM_INDEX(it)` remains inline for the inventory check; string-backed item callbacks are routed through `callItemDrop`.
 */
export function Cmd_Drop_f(ent: GameEntity, context: GameCommandContext): void {
  const s = context.gi.args();
  const it = FindItem(s);
  if (!it) {
    cprintf(context, ent, PRINT_HIGH, `unknown item: ${s}\n`);
    return;
  }
  if (!it.drop) {
    cprintf(context, ent, PRINT_HIGH, "Item is not dropable.\n");
    return;
  }
  if (!ent.client?.pers.inventory[ITEM_INDEX(it)]) {
    cprintf(context, ent, PRINT_HIGH, `Out of item: ${s}\n`);
    return;
  }
  callItemDrop(ent, it, context);
}

/**
 * Original name: Cmd_Inven_f
 * Source: game/g_cmds.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Hides score/help overlays, toggles the inventory overlay, and sends the current inventory counts when opening it.
 *
 * Porting notes:
 * - Keeps the original `MAX_ITEMS` short serialization order; the local C `i` remains a loop index.
 */
export function Cmd_Inven_f(ent: GameEntity, context: GameCommandContext): void {
  const cl = ent.client;
  if (!cl) {
    return;
  }

  cl.showscores = false;
  cl.showhelp = false;
  if (cl.showinventory) {
    cl.showinventory = false;
    return;
  }

  cl.showinventory = true;
  context.gi.WriteByte(svc_inventory);
  for (let i = 0; i < MAX_ITEMS; i += 1) {
    context.gi.WriteShort(cl.pers.inventory[i] ?? 0);
  }
  context.gi.unicast(ent, true);
}

/**
 * Original name: Cmd_InvUse_f
 * Source: game/g_cmds.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Revalidates the selected inventory slot, rejects empty/non-usable selections, then dispatches the item use callback.
 *
 * Porting notes:
 * - The local C `it` pointer is represented by `GetItemByIndex(selected)` and callback dispatch goes through `callItemUse`.
 */
export function Cmd_InvUse_f(ent: GameEntity, context: GameCommandContext): void {
  ValidateSelectedItem(ent, context.runtime);
  const selected = ent.client?.pers.selected_item ?? -1;
  if (selected === -1) {
    cprintf(context, ent, PRINT_HIGH, "No item to use.\n");
    return;
  }
  const it = GetItemByIndex(selected);
  if (!it?.use) {
    cprintf(context, ent, PRINT_HIGH, "Item is not usable.\n");
    return;
  }
  callItemUse(ent, it, context.runtime);
}

/**
 * Original name: Cmd_WeapPrev_f
 * Source: game/g_cmds.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Scans forward from the current `pers.weapon` item index and invokes the first usable weapon in inventory.
 *
 * Porting notes:
 * - Preserves Quake II's original `weapprev` scan direction through the shared `scanWeapon` helper.
 */
export function Cmd_WeapPrev_f(ent: GameEntity, runtime: GameRuntime): void {
  scanWeapon(ent, runtime, 1);
}

/**
 * Original name: Cmd_WeapNext_f
 * Source: game/g_cmds.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Scans backward from the current `pers.weapon` item index and invokes usable weapons until the scan succeeds.
 *
 * Porting notes:
 * - Preserves Quake II's original `weapnext` scan direction through the shared `scanWeapon` helper.
 * - The success check intentionally follows C by testing `pers.weapon == it` after `Use_Weapon`, not `newweapon`.
 */
export function Cmd_WeapNext_f(ent: GameEntity, runtime: GameRuntime): void {
  scanWeapon(ent, runtime, -1);
}

/**
 * Original name: Cmd_WeapLast_f
 * Source: game/g_cmds.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior:
 * - Switches back to `pers.lastweapon` only when the current weapon exists, the last weapon is in inventory,
 *   has a use callback, and is flagged as a weapon.
 * Porting notes:
 * - Preserves Quake II's `index` and `it` checks before invoking the item use callback.
 */
export function Cmd_WeapLast_f(ent: GameEntity, runtime: GameRuntime): void {
  const cl = ent.client;
  if (!cl?.pers.weapon || !cl.pers.lastweapon) {
    return;
  }
  const index = ITEM_INDEX(cl.pers.lastweapon);
  const it = GetItemByIndex(index);
  if (!cl.pers.inventory[index] || !it?.use || (it.flags & IT_WEAPON) === 0) {
    return;
  }
  callItemUse(ent, it, runtime);
}

/**
 * Original name: Cmd_InvDrop_f
 * Source: game/g_cmds.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Revalidates the selected inventory slot, rejects empty/non-dropable selections, then dispatches the item drop callback.
 *
 * Porting notes:
 * - The local C `it` pointer is represented by `GetItemByIndex(selected)` and callback dispatch goes through `callItemDrop`.
 */
export function Cmd_InvDrop_f(ent: GameEntity, context: GameCommandContext): void {
  ValidateSelectedItem(ent, context.runtime);
  const selected = ent.client?.pers.selected_item ?? -1;
  if (selected === -1) {
    cprintf(context, ent, PRINT_HIGH, "No item to drop.\n");
    return;
  }
  const it = GetItemByIndex(selected);
  if (!it?.drop) {
    cprintf(context, ent, PRINT_HIGH, "Item is not dropable.\n");
    return;
  }
  callItemDrop(ent, it, context);
}

/**
 * Original name: Cmd_Kill_f
 * Source: game/g_cmds.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Ignores fresh respawns, clears godmode, marks suicide damage and runs the player death path.
 *
 * Porting notes:
 * - The original `level.time` and `meansOfDeath` globals are carried by the explicit game runtime.
 */
export function Cmd_Kill_f(ent: GameEntity, context: GameCommandContext): void {
  if (!ent.client || context.runtime.time - ent.client.respawn_time < 5) {
    return;
  }
  ent.flags &= ~FL_GODMODE;
  ent.health = 0;
  context.runtime.meansOfDeath = MOD_SUICIDE;
  player_die(ent, ent, ent, 100000, context.runtime, context.hooks);
}

/**
 * Original name: Cmd_PutAway_f
 * Source: game/g_cmds.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Closes every player overlay controlled by the game command layer: scores, help and inventory.
 *
 * Porting notes:
 * - The C function assumes a valid client. The TypeScript port keeps a defensive null guard for runtime adapters.
 */
export function Cmd_PutAway_f(ent: GameEntity): void {
  const cl = ent.client;
  if (!cl) {
    return;
  }
  cl.showscores = false;
  cl.showhelp = false;
  cl.showinventory = false;
}

/**
 * Original name: PlayerSort
 * Source: game/g_cmds.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Compare client indexes by STAT_FRAGS in ascending order, matching the original qsort callback.
 *
 * Porting notes:
 * - The C callback receives pointers to int entries in Cmd_Players_f's local index array; the TS port takes
 *   the indexes directly and reads the same client stat from the runtime entity table.
 */
export function PlayerSort(left: number, right: number, runtime: GameRuntime): number {
  const anum = runtime.entities[left + 1]?.client?.ps.stats[STAT_FRAGS] ?? 0;
  const bnum = runtime.entities[right + 1]?.client?.ps.stats[STAT_FRAGS] ?? 0;
  return anum < bnum ? -1 : anum > bnum ? 1 : 0;
}

/**
 * Original name: Cmd_Players_f
 * Source: game/g_cmds.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Build the connected-player index list, sort it with PlayerSort, and print a bounded frag/name list.
 *
 * Porting notes:
 * - Local C buffers are represented by strings while preserving the 1280-byte packet guard and summary count.
 */
export function Cmd_Players_f(ent: GameEntity, context: GameCommandContext): void {
  const index: number[] = [];
  for (let i = 0; i < context.runtime.maxclients; i += 1) {
    if (context.runtime.entities[i + 1]?.client?.pers.connected) {
      index.push(i);
    }
  }
  index.sort((a, b) => PlayerSort(a, b, context.runtime));

  let large = "";
  for (const clientIndex of index) {
    const cl = context.runtime.entities[clientIndex + 1]?.client;
    if (!cl) {
      continue;
    }
    const small = `${padLeft(cl.ps.stats[STAT_FRAGS] ?? 0, 3)} ${cl.pers.netname}\n`;
    if (small.length + large.length > 1280 - 100) {
      large += "...\n";
      break;
    }
    large += small;
  }

  cprintf(context, ent, PRINT_HIGH, `${large}\n${index.length} players\n`);
}

/**
 * Original name: Cmd_Wave_f
 * Source: game/g_cmds.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Rejects ducked players and higher-priority animations before selecting one player gesture.
 * - Preserves the original numeric gesture mapping, printed labels, start frames and animation end frames.
 *
 * Porting notes:
 * - Reads `gi.argv(1)` through the explicit command context instead of the global game import table.
 */
export function Cmd_Wave_f(ent: GameEntity, context: GameCommandContext): void {
  const cl = ent.client;
  if (!cl) {
    return;
  }
  const i = atoi(context.gi.argv(1));
  if ((cl.ps.pmove.pm_flags & PMF_DUCKED) !== 0) {
    return;
  }
  if (cl.anim_priority > ANIM_WAVE) {
    return;
  }

  cl.anim_priority = ANIM_WAVE;
  switch (i) {
    case 0:
      cprintf(context, ent, PRINT_HIGH, "flipoff\n");
      ent.s.frame = FRAME_flip01 - 1;
      cl.anim_end = FRAME_flip12;
      break;
    case 1:
      cprintf(context, ent, PRINT_HIGH, "salute\n");
      ent.s.frame = FRAME_salute01 - 1;
      cl.anim_end = FRAME_salute11;
      break;
    case 2:
      cprintf(context, ent, PRINT_HIGH, "taunt\n");
      ent.s.frame = FRAME_taunt01 - 1;
      cl.anim_end = FRAME_taunt17;
      break;
    case 3:
      cprintf(context, ent, PRINT_HIGH, "wave\n");
      ent.s.frame = FRAME_wave01 - 1;
      cl.anim_end = FRAME_wave11;
      break;
    case 4:
    default:
      cprintf(context, ent, PRINT_HIGH, "point\n");
      ent.s.frame = FRAME_point01 - 1;
      cl.anim_end = FRAME_point12;
      break;
  }
}

/**
 * Original name: Cmd_Say_f
 * Source: game/g_cmds.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Formats player chat, applies team filtering and flood protection, mirrors dedicated-server echo, and emits PRINT_CHAT messages through gi.cprintf.
 * Porting notes: C string buffers and Com_sprintf/strcat are represented with bounded TypeScript string assembly before the same 150-character payload clamp.
 */
export function Cmd_Say_f(ent: GameEntity, team: boolean, arg0: boolean, context: GameCommandContext): void {
  const client = ent.client;
  if (!client) {
    return;
  }
  if (context.gi.argc() < 2 && !arg0) {
    return;
  }
  if ((context.runtime.dmflags & (DF_MODELTEAMS | DF_SKINTEAMS)) === 0) {
    team = false;
  }

  let text = team ? `(${client.pers.netname}): ` : `${client.pers.netname}: `;
  if (arg0) {
    text += `${context.gi.argv(0)} ${context.gi.args()}`;
  } else {
    let p = context.gi.args();
    if (p.startsWith("\"")) {
      p = p.slice(1, -1);
    }
    text += p;
  }

  if (text.length > 150) {
    text = text.slice(0, 150);
  }
  text += "\n";

  if (isFloodBlocked(ent, context)) {
    return;
  }

  if ((context.cvars?.dedicated?.value ?? 0) !== 0) {
    cprintf(context, null, PRINT_CHAT, text);
  }

  for (let j = 1; j <= context.runtime.maxclients; j += 1) {
    const other = context.runtime.entities[j] ?? null;
    if (!other?.inuse || !other.client) {
      continue;
    }
    if (team && !OnSameTeam(ent, other, context.runtime)) {
      continue;
    }
    cprintf(context, other, PRINT_CHAT, text);
  }
}

/**
 * Original name: Cmd_PlayerList_f
 * Source: game/g_cmds.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Print one line per in-use client with connect time, ping, score, name and spectator suffix, truncating the buffer with `And more...`.
 * Porting notes: Uses immutable string assembly for the C `st` and `text` buffers while preserving the maxclients scan and 1400-byte guard.
 */
export function Cmd_PlayerList_f(ent: GameEntity, context: GameCommandContext): void {
  let text = "";
  for (let i = 0; i < context.runtime.maxclients; i += 1) {
    const e2 = context.runtime.entities[i + 1] ?? null;
    const cl = e2?.client;
    if (!e2?.inuse || !cl) {
      continue;
    }

    const frames = context.runtime.framenum - cl.resp.enterframe;
    const st =
      `${pad2(Math.trunc(frames / 600))}:${pad2(Math.trunc((frames % 600) / 10))} ` +
      `${padLeft(cl.ping, 4)} ${padLeft(cl.resp.score, 3)} ${cl.pers.netname}${cl.resp.spectator ? " (spectator)" : ""}\n`;
    if (text.length + st.length > 1400 - 50) {
      text += "And more...\n";
      cprintf(context, ent, PRINT_HIGH, text);
      return;
    }
    text += st;
  }
  cprintf(context, ent, PRINT_HIGH, text);
}

/**
 * Original name: ClientCommand
 * Source: game/g_cmds.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Reads the command name from `gi.argv(0)`, preserves the original always-allowed command group, then
 *   blocks gameplay commands during intermission.
 * - Dispatches inventory, item, cheat, weapon, suicide, overlay and player-list commands in the same order
 *   as the C `else if` chain, with unknown commands falling back to chat.
 *
 * Porting notes:
 * - `cmd` is represented by an immutable string from the explicit command context instead of the global
 *   `gi.argv` table.
 */
export function ClientCommand(context: GameCommandContext, ent: GameEntity): void {
  if (!ent.client) {
    return;
  }

  const cmd = context.gi.argv(0);
  if (qstricmp(cmd, "players")) {
    Cmd_Players_f(ent, context);
    return;
  }
  if (qstricmp(cmd, "say")) {
    Cmd_Say_f(ent, false, false, context);
    return;
  }
  if (qstricmp(cmd, "say_team")) {
    Cmd_Say_f(ent, true, false, context);
    return;
  }
  if (qstricmp(cmd, "score")) {
    Cmd_Score_f(ent, context.runtime, context.hooks);
    return;
  }
  if (qstricmp(cmd, "help")) {
    Cmd_Help_f(ent, context.runtime, buildHelpData(context), context.hooks);
    return;
  }

  if (context.runtime.intermissiontime) {
    return;
  }

  if (qstricmp(cmd, "use")) {
    Cmd_Use_f(ent, context);
  } else if (qstricmp(cmd, "drop")) {
    Cmd_Drop_f(ent, context);
  } else if (qstricmp(cmd, "give")) {
    Cmd_Give_f(ent, context);
  } else if (qstricmp(cmd, "god")) {
    Cmd_God_f(ent, context);
  } else if (qstricmp(cmd, "notarget")) {
    Cmd_Notarget_f(ent, context);
  } else if (qstricmp(cmd, "noclip")) {
    Cmd_Noclip_f(ent, context);
  } else if (qstricmp(cmd, "inven")) {
    Cmd_Inven_f(ent, context);
  } else if (qstricmp(cmd, "invnext")) {
    SelectNextItem(ent, -1, context.runtime);
  } else if (qstricmp(cmd, "invprev")) {
    SelectPrevItem(ent, -1, context.runtime);
  } else if (qstricmp(cmd, "invnextw")) {
    SelectNextItem(ent, IT_WEAPON, context.runtime);
  } else if (qstricmp(cmd, "invprevw")) {
    SelectPrevItem(ent, IT_WEAPON, context.runtime);
  } else if (qstricmp(cmd, "invnextp")) {
    SelectNextItem(ent, IT_POWERUP, context.runtime);
  } else if (qstricmp(cmd, "invprevp")) {
    SelectPrevItem(ent, IT_POWERUP, context.runtime);
  } else if (qstricmp(cmd, "invuse")) {
    Cmd_InvUse_f(ent, context);
  } else if (qstricmp(cmd, "invdrop")) {
    Cmd_InvDrop_f(ent, context);
  } else if (qstricmp(cmd, "weapprev")) {
    Cmd_WeapPrev_f(ent, context.runtime);
  } else if (qstricmp(cmd, "weapnext")) {
    Cmd_WeapNext_f(ent, context.runtime);
  } else if (qstricmp(cmd, "weaplast")) {
    Cmd_WeapLast_f(ent, context.runtime);
  } else if (qstricmp(cmd, "kill")) {
    Cmd_Kill_f(ent, context);
  } else if (qstricmp(cmd, "putaway")) {
    Cmd_PutAway_f(ent);
  } else if (qstricmp(cmd, "wave")) {
    Cmd_Wave_f(ent, context);
  } else if (qstricmp(cmd, "playerlist")) {
    Cmd_PlayerList_f(ent, context);
  } else {
    Cmd_Say_f(ent, false, true, context);
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Share the repeated `deathmatch && !sv_cheats` gate used by the cheat commands in `g_cmds.c`.
 */
function cheatsAllowed(ent: GameEntity, context: GameCommandContext): boolean {
  if (context.runtime.deathmatch && (context.cvars?.sv_cheats?.value ?? 0) === 0) {
    cprintf(context, ent, PRINT_HIGH, "You must run the server with '+set cheats 1' to enable this command.\n");
    return false;
  }
  return true;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Factor the local `it_ent` spawn/touch/free sequence used by `Cmd_Give_f`.
 */
function giveSpawnedItem(ent: GameEntity, item: GameItemDefinition, runtime: GameRuntime): void {
  const it_ent = G_Spawn(runtime);
  it_ent.classname = item.classname;
  SpawnItem(it_ent, item, runtime);
  Touch_Item(it_ent, ent, runtime);
  if (it_ent.inuse) {
    G_FreeEdict(runtime, it_ent);
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Dispatch string-backed item `use` callbacks to their ported TypeScript owners.
 */
function callItemUse(ent: GameEntity, item: GameItemDefinition, runtime: GameRuntime): void {
  switch (item.use) {
    case "Use_PowerArmor":
      Use_PowerArmor(ent, item, runtime);
      break;
    case "Use_Weapon":
      Use_Weapon(ent, item, runtime);
      break;
    case "Use_Quad":
      Use_Quad(ent, item, runtime);
      break;
    case "Use_Invulnerability":
      Use_Invulnerability(ent, item, runtime);
      break;
    case "Use_Silencer":
      Use_Silencer(ent, item, runtime);
      break;
    case "Use_Breather":
      Use_Breather(ent, item, runtime);
      break;
    case "Use_Envirosuit":
      Use_Envirosuit(ent, item, runtime);
      break;
    default:
      break;
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Dispatch string-backed item `drop` callbacks to their ported TypeScript owners.
 */
function callItemDrop(ent: GameEntity, item: GameItemDefinition, context: GameCommandContext): void {
  switch (item.drop) {
    case "Drop_Weapon":
      Drop_Weapon(ent, item, context.runtime, context.hooks);
      break;
    case "Drop_Ammo":
      Drop_Ammo(ent, item, context.runtime);
      break;
    case "Drop_General":
      Drop_General(ent, item, context.runtime);
      break;
    case "Drop_PowerArmor":
      Drop_PowerArmor(ent, item, context.runtime);
      break;
    default:
      break;
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Share the forward/backward weapon inventory scan used by `Cmd_WeapPrev_f` and `Cmd_WeapNext_f`.
 */
function scanWeapon(ent: GameEntity, runtime: GameRuntime, direction: 1 | -1): void {
  const cl = ent.client;
  if (!cl?.pers.weapon) {
    return;
  }
  const selected_weapon = ITEM_INDEX(cl.pers.weapon);
  for (let i = 1; i <= MAX_ITEMS; i += 1) {
    const index = direction === 1
      ? positiveModulo(selected_weapon + i, MAX_ITEMS)
      : positiveModulo(selected_weapon + MAX_ITEMS - i, MAX_ITEMS);
    if (!cl.pers.inventory[index]) {
      continue;
    }
    const it = GetItemByIndex(index);
    if (!it?.use || (it.flags & IT_WEAPON) === 0) {
      continue;
    }
    callItemUse(ent, it, runtime);
    if (cl.pers.weapon === it) {
      return;
    }
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Keep the `Cmd_Say_f` flood-protection block isolated while preserving its client timestamp side effects.
 */
function isFloodBlocked(ent: GameEntity, context: GameCommandContext): boolean {
  const flood_msgs = context.cvars?.flood_msgs?.value ?? 0;
  const client = ent.client;
  if (!client || !flood_msgs) {
    return false;
  }

  if (context.runtime.time < client.flood_locktill) {
    cprintf(context, ent, PRINT_HIGH, `You can't talk for ${Math.trunc(client.flood_locktill - context.runtime.time)} more seconds\n`);
    return true;
  }

  let i = client.flood_whenhead - flood_msgs + 1;
  if (i < 0) {
    i = client.flood_when.length + i;
  }
  if (
    client.flood_when[i] &&
    context.runtime.time - client.flood_when[i] < (context.cvars?.flood_persecond?.value ?? 0)
  ) {
    const delay = context.cvars?.flood_waitdelay?.value ?? 0;
    client.flood_locktill = context.runtime.time + delay;
    cprintf(context, ent, PRINT_CHAT, `Flood protection:  You can't talk for ${Math.trunc(delay)} seconds.\n`);
    return true;
  }

  client.flood_whenhead = (client.flood_whenhead + 1) % client.flood_when.length;
  client.flood_when[client.flood_whenhead] = context.runtime.time;
  return false;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Build the explicit help-computer data object required when `ClientCommand` dispatches `help`.
 */
function buildHelpData(context: GameCommandContext): GameHudHelpComputerData {
  return {
    skill: context.helpData?.skill ?? context.cvars?.skill?.value ?? context.runtime.skill,
    level_name: context.helpData?.level_name ?? context.runtime.mapname,
    helpmessage1: context.helpData?.helpmessage1 ?? context.runtime.helpmessage1,
    helpmessage2: context.helpData?.helpmessage2 ?? context.runtime.helpmessage2,
    killed_monsters: context.helpData?.killed_monsters ?? context.runtime.killed_monsters,
    total_monsters: context.helpData?.total_monsters ?? context.runtime.total_monsters,
    found_goals: context.helpData?.found_goals ?? context.runtime.found_goals,
    total_goals: context.helpData?.total_goals ?? context.runtime.total_goals,
    found_secrets: context.helpData?.found_secrets ?? context.runtime.found_secrets,
    total_secrets: context.helpData?.total_secrets ?? context.runtime.total_secrets
  };
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Preserve the common `gi.cprintf(..., "%s", message)` call shape used throughout `g_cmds.c`.
 */
function cprintf(context: GameCommandContext, ent: GameEntity | null, printlevel: number, message: string): void {
  context.gi.cprintf(ent, printlevel, "%s", message);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Provide a boolean wrapper for original `Q_stricmp(...) == 0` command and item-name checks.
 */
function qstricmp(left: string, right: string): boolean {
  return Q_stricmp(left, right) === 0;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Match C `atoi` fallback semantics for command arguments that are missing or not numeric.
 */
function atoi(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Keep C-style non-negative inventory wraparound explicit for translated modulo scans.
 */
function positiveModulo(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Format integer columns that were produced by fixed-width `sprintf` fields in `g_cmds.c`.
 */
function padLeft(value: number, width: number): string {
  return Math.trunc(value).toString().padStart(width, " ");
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Format two-digit minute/second fields for `Cmd_PlayerList_f`.
 */
function pad2(value: number): string {
  return Math.trunc(value).toString().padStart(2, "0");
}

export { IT_POWERUP, IT_WEAPON };
