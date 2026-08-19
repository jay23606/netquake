/**
 * File: g_items.ts
 * Source: Quake II original / game/g_items.c
 * Purpose: Port the Quake II base-game item definitions plus the shared pickup / use / drop / respawn logic.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - `droptofloor` keeps the original delayed spawn structure but uses the local gameplay collision bridge instead of `gi.trace`.
 * - Engine-side `configstring`, print and sound-emission side effects are modeled through runtime tables, logs and queued sound events.
 * - Invalid item spawnflags are normalized without reproducing the original `gi.dprintf` diagnostic side effect.
 *
 * Notes:
 * - This file is intended to stay close to the original item spawn path.
 */

import {
  AngleVectors,
  CS_ITEMS,
  DF_INFINITE_AMMO,
  DF_INSTANT_ITEMS,
  DF_NO_ARMOR,
  DF_NO_HEALTH,
  DF_NO_ITEMS,
  EF_GIB,
  EF_ROTATE,
  MAX_QPATH,
  MASK_SOLID,
  PRINT_HIGH,
  Q_stricmp,
  RF_GLOW,
  STAT_PICKUP_ICON,
  STAT_PICKUP_STRING,
  STAT_SELECTED_ITEM
} from "../../qcommon/src/index.js";
import { CONTENTS_SOLID } from "../../qcommon/src/q_shared.js";
import { entity_event_t } from "../../qcommon/src/index.js";
import {
  WEAP_BLASTER,
  WEAP_BFG,
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
  FRAMETIME,
  MOVETYPE_TOSS,
  SOLID_BBOX,
  SOLID_NOT,
  SOLID_TRIGGER,
  FL_POWER_ARMOR,
  FL_TEAMSLAVE,
  FL_RESPAWN,
  POWER_ARMOR_NONE,
  POWER_ARMOR_SCREEN,
  POWER_ARMOR_SHIELD,
  SVF_NOCLIENT,
  DROPPED_ITEM,
  DROPPED_PLAYER_ITEM,
  emitGameSound,
  linkGameEntity,
  spawnGameEntity,
  refreshEntitySpatialState,
  registerGameImage,
  registerGameModel,
  registerGameSound,
  type GameEntity,
  type GameRuntime
} from "./runtime.js";
import {
  ARMOR_BODY,
  ARMOR_COMBAT,
  ARMOR_JACKET,
  ARMOR_SHARD,
  ITEM_NO_TOUCH,
  ITEM_TARGETS_USED,
  ITEM_TRIGGER_SPAWN,
  IT_AMMO,
  IT_ARMOR,
  IT_KEY,
  IT_POWERUP,
  IT_STAY_COOP,
  IT_WEAPON
} from "./g_local.js";
import { ValidateSelectedItem } from "./g_cmds.js";
import { G_FreeEdict, G_UseTargets, G_ProjectSource } from "./g_utils.js";
import { Pickup_Weapon, Use_Weapon } from "./p_weapon.js";

/**
 * Original name: HEALTH_IGNORE_MAX
 * Source: Quake-2-master/game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 */
const HEALTH_IGNORE_MAX = 1;

/**
 * Original name: HEALTH_TIMED
 * Source: Quake-2-master/game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 */
const HEALTH_TIMED = 2;

/**
 * Original name: jacket_armor_index
 * Source: Quake-2-master/game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 */
let jacket_armor_index = 0;

/**
 * Original name: combat_armor_index
 * Source: Quake-2-master/game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 */
let combat_armor_index = 0;

/**
 * Original name: body_armor_index
 * Source: Quake-2-master/game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 */
let body_armor_index = 0;

/**
 * Original name: power_screen_index
 * Source: Quake-2-master/game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 */
let power_screen_index = 0;

/**
 * Original name: power_shield_index
 * Source: Quake-2-master/game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 */
let power_shield_index = 0;

/**
 * Original name: quad_drop_timeout_hack
 * Source: Quake-2-master/game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 */
let quad_drop_timeout_hack = 0;

/**
 * Original name: N/A
 * Source declaree: N/A (local cache helper)
 * Category: New
 * Purpose: Populate the module-local item index caches that replace C static globals initialized by `SetItemNames`.
 */
function cacheItemIndices(): void {
  if (jacket_armor_index !== 0) {
    return;
  }

  jacket_armor_index = itemlist.find((item) => item.pickupName === "Jacket Armor")?.index ?? 0;
  combat_armor_index = itemlist.find((item) => item.pickupName === "Combat Armor")?.index ?? 0;
  body_armor_index = itemlist.find((item) => item.pickupName === "Body Armor")?.index ?? 0;
  power_screen_index = itemlist.find((item) => item.pickupName === "Power Screen")?.index ?? 0;
  power_shield_index = itemlist.find((item) => item.pickupName === "Power Shield")?.index ?? 0;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local dispatch helper)
 * Category: New
 * Purpose: Name the supported `gitem_t.pickup` callbacks without storing JS function pointers in item definitions.
 */
export type GameItemPickupKind =
  | "Pickup_Armor"
  | "Pickup_PowerArmor"
  | "Pickup_Weapon"
  | "Pickup_Ammo"
  | "Pickup_Powerup"
  | "Pickup_AncientHead"
  | "Pickup_Adrenaline"
  | "Pickup_Bandolier"
  | "Pickup_Pack"
  | "Pickup_Key"
  | "Pickup_Health";

/**
 * Original name: N/A
 * Source declaree: N/A (local dispatch helper)
 * Category: New
 * Purpose: Name the supported `gitem_t.use` callbacks without storing JS function pointers in item definitions.
 */
export type GameItemUseKind =
  | "Use_Weapon"
  | "Use_PowerArmor"
  | "Use_Quad"
  | "Use_Invulnerability"
  | "Use_Silencer"
  | "Use_Breather"
  | "Use_Envirosuit";

/**
 * Original name: N/A
 * Source declaree: N/A (local dispatch helper)
 * Category: New
 * Purpose: Name the supported `gitem_t.drop` callbacks without storing JS function pointers in item definitions.
 */
export type GameItemDropKind =
  | "Drop_Weapon"
  | "Drop_Ammo"
  | "Drop_General"
  | "Drop_PowerArmor";

/**
 * Original name: N/A
 * Source declaree: N/A (local dispatch helper)
 * Category: New
 * Purpose: Name the supported `gitem_t.weaponthink` callbacks delegated to `p_weapon.ts`.
 */
export type GameItemWeaponThinkKind =
  | "Weapon_Blaster"
  | "Weapon_Shotgun"
  | "Weapon_SuperShotgun"
  | "Weapon_Machinegun"
  | "Weapon_Chaingun"
  | "Weapon_Grenade"
  | "Weapon_GrenadeLauncher"
  | "Weapon_RocketLauncher"
  | "Weapon_HyperBlaster"
  | "Weapon_Railgun"
  | "Weapon_BFG";

/**
 * Original name: gitem_s
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Describes one Quake II item definition with spawn classname, callbacks, pickup audio,
 *   world/view models, render flags, HUD metadata, inventory tags and precache tokens.
 *
 * Porting notes:
 * - C function pointers are represented by stable callback-kind strings resolved by the item runtime.
 * - C NULL strings are represented by `null` for optional fields and `""` only for the original health sentinel.
 */
export interface GameItemDefinition {
  index: number;
  classname: string;
  pickup: GameItemPickupKind | null;
  use: GameItemUseKind | null;
  drop: GameItemDropKind | null;
  weaponThink: GameItemWeaponThinkKind | null;
  pickupName: string;
  pickupSound: string | null;
  worldModel: string;
  worldModelFlags: number;
  viewModel: string | null;
  icon: string | null;
  countWidth: number;
  quantity: number;
  ammo: string | null;
  flags: number;
  weapmodel: number;
  tag: number;
  precaches: string;
}

/**
 * Original name: gitem_armor_t
 * Source: game/g_local.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Describes one Quake II armor family with its base count, cap and protection ratios.
 */
export interface GameItemArmorInfo {
  base_count: number;
  max_count: number;
  normal_protection: number;
  energy_protection: number;
  armor: number;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local itemlist construction helper)
 * Category: New
 * Purpose: Represent raw C `itemlist` rows before assigning the TypeScript-side stable item index.
 */
interface RawGameItemDefinition extends Omit<GameItemDefinition, "index"> {}

/**
 * Original name: itemlist
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Preserves the original base-game `gitem_t itemlist[]` order after the C null slot 0.
 * - Keeps health as the single generic `Health` item; the `SP_item_health*` functions provide the map classname, model, count and style variants.
 *
 * Porting notes:
 * - The C null sentinel at slot 0 and end-of-list marker are represented by index translation in `GetItemByIndex` and `InitItems`.
 */
const rawItemlist: readonly RawGameItemDefinition[] = [
  { classname: "item_armor_body", pickup: "Pickup_Armor", use: null, drop: null, weaponThink: null, pickupName: "Body Armor", pickupSound: "misc/ar1_pkup.wav", worldModel: "models/items/armor/body/tris.md2", worldModelFlags: EF_ROTATE, viewModel: null, icon: "i_bodyarmor", countWidth: 3, quantity: 0, ammo: null, flags: IT_ARMOR, weapmodel: 0, tag: ARMOR_BODY, precaches: "" },
  { classname: "item_armor_combat", pickup: "Pickup_Armor", use: null, drop: null, weaponThink: null, pickupName: "Combat Armor", pickupSound: "misc/ar1_pkup.wav", worldModel: "models/items/armor/combat/tris.md2", worldModelFlags: EF_ROTATE, viewModel: null, icon: "i_combatarmor", countWidth: 3, quantity: 0, ammo: null, flags: IT_ARMOR, weapmodel: 0, tag: ARMOR_COMBAT, precaches: "" },
  { classname: "item_armor_jacket", pickup: "Pickup_Armor", use: null, drop: null, weaponThink: null, pickupName: "Jacket Armor", pickupSound: "misc/ar1_pkup.wav", worldModel: "models/items/armor/jacket/tris.md2", worldModelFlags: EF_ROTATE, viewModel: null, icon: "i_jacketarmor", countWidth: 3, quantity: 0, ammo: null, flags: IT_ARMOR, weapmodel: 0, tag: ARMOR_JACKET, precaches: "" },
  { classname: "item_armor_shard", pickup: "Pickup_Armor", use: null, drop: null, weaponThink: null, pickupName: "Armor Shard", pickupSound: "misc/ar2_pkup.wav", worldModel: "models/items/armor/shard/tris.md2", worldModelFlags: EF_ROTATE, viewModel: null, icon: "i_jacketarmor", countWidth: 3, quantity: 0, ammo: null, flags: IT_ARMOR, weapmodel: 0, tag: ARMOR_SHARD, precaches: "" },
  { classname: "item_power_screen", pickup: "Pickup_PowerArmor", use: "Use_PowerArmor", drop: "Drop_PowerArmor", weaponThink: null, pickupName: "Power Screen", pickupSound: "misc/ar3_pkup.wav", worldModel: "models/items/armor/screen/tris.md2", worldModelFlags: EF_ROTATE, viewModel: null, icon: "i_powerscreen", countWidth: 0, quantity: 60, ammo: null, flags: IT_ARMOR, weapmodel: 0, tag: 0, precaches: "" },
  { classname: "item_power_shield", pickup: "Pickup_PowerArmor", use: "Use_PowerArmor", drop: "Drop_PowerArmor", weaponThink: null, pickupName: "Power Shield", pickupSound: "misc/ar3_pkup.wav", worldModel: "models/items/armor/shield/tris.md2", worldModelFlags: EF_ROTATE, viewModel: null, icon: "i_powershield", countWidth: 0, quantity: 60, ammo: null, flags: IT_ARMOR, weapmodel: 0, tag: 0, precaches: "misc/power2.wav misc/power1.wav" },
  { classname: "weapon_blaster", pickup: null, use: "Use_Weapon", drop: null, weaponThink: "Weapon_Blaster", pickupName: "Blaster", pickupSound: "misc/w_pkup.wav", worldModel: "", worldModelFlags: 0, viewModel: "models/weapons/v_blast/tris.md2", icon: "w_blaster", countWidth: 0, quantity: 0, ammo: null, flags: IT_WEAPON | IT_STAY_COOP, weapmodel: WEAP_BLASTER, tag: 0, precaches: "weapons/blastf1a.wav misc/lasfly.wav" },
  { classname: "weapon_shotgun", pickup: "Pickup_Weapon", use: "Use_Weapon", drop: "Drop_Weapon", weaponThink: "Weapon_Shotgun", pickupName: "Shotgun", pickupSound: "misc/w_pkup.wav", worldModel: "models/weapons/g_shotg/tris.md2", worldModelFlags: EF_ROTATE, viewModel: "models/weapons/v_shotg/tris.md2", icon: "w_shotgun", countWidth: 0, quantity: 1, ammo: "Shells", flags: IT_WEAPON | IT_STAY_COOP, weapmodel: WEAP_SHOTGUN, tag: 0, precaches: "weapons/shotgf1b.wav weapons/shotgr1b.wav" },
  { classname: "weapon_supershotgun", pickup: "Pickup_Weapon", use: "Use_Weapon", drop: "Drop_Weapon", weaponThink: "Weapon_SuperShotgun", pickupName: "Super Shotgun", pickupSound: "misc/w_pkup.wav", worldModel: "models/weapons/g_shotg2/tris.md2", worldModelFlags: EF_ROTATE, viewModel: "models/weapons/v_shotg2/tris.md2", icon: "w_sshotgun", countWidth: 0, quantity: 2, ammo: "Shells", flags: IT_WEAPON | IT_STAY_COOP, weapmodel: WEAP_SUPERSHOTGUN, tag: 0, precaches: "weapons/sshotf1b.wav" },
  { classname: "weapon_machinegun", pickup: "Pickup_Weapon", use: "Use_Weapon", drop: "Drop_Weapon", weaponThink: "Weapon_Machinegun", pickupName: "Machinegun", pickupSound: "misc/w_pkup.wav", worldModel: "models/weapons/g_machn/tris.md2", worldModelFlags: EF_ROTATE, viewModel: "models/weapons/v_machn/tris.md2", icon: "w_machinegun", countWidth: 0, quantity: 1, ammo: "Bullets", flags: IT_WEAPON | IT_STAY_COOP, weapmodel: WEAP_MACHINEGUN, tag: 0, precaches: "weapons/machgf1b.wav weapons/machgf2b.wav weapons/machgf3b.wav weapons/machgf4b.wav weapons/machgf5b.wav" },
  { classname: "weapon_chaingun", pickup: "Pickup_Weapon", use: "Use_Weapon", drop: "Drop_Weapon", weaponThink: "Weapon_Chaingun", pickupName: "Chaingun", pickupSound: "misc/w_pkup.wav", worldModel: "models/weapons/g_chain/tris.md2", worldModelFlags: EF_ROTATE, viewModel: "models/weapons/v_chain/tris.md2", icon: "w_chaingun", countWidth: 0, quantity: 1, ammo: "Bullets", flags: IT_WEAPON | IT_STAY_COOP, weapmodel: WEAP_CHAINGUN, tag: 0, precaches: "weapons/chngnu1a.wav weapons/chngnl1a.wav weapons/machgf3b.wav weapons/chngnd1a.wav" },
  { classname: "ammo_grenades", pickup: "Pickup_Ammo", use: "Use_Weapon", drop: "Drop_Ammo", weaponThink: "Weapon_Grenade", pickupName: "Grenades", pickupSound: "misc/am_pkup.wav", worldModel: "models/items/ammo/grenades/medium/tris.md2", worldModelFlags: 0, viewModel: "models/weapons/v_handgr/tris.md2", icon: "a_grenades", countWidth: 3, quantity: 5, ammo: "grenades", flags: IT_AMMO | IT_WEAPON, weapmodel: WEAP_GRENADES, tag: ammo_t.AMMO_GRENADES, precaches: "weapons/hgrent1a.wav weapons/hgrena1b.wav weapons/hgrenc1b.wav weapons/hgrenb1a.wav weapons/hgrenb2a.wav" },
  { classname: "weapon_grenadelauncher", pickup: "Pickup_Weapon", use: "Use_Weapon", drop: "Drop_Weapon", weaponThink: "Weapon_GrenadeLauncher", pickupName: "Grenade Launcher", pickupSound: "misc/w_pkup.wav", worldModel: "models/weapons/g_launch/tris.md2", worldModelFlags: EF_ROTATE, viewModel: "models/weapons/v_launch/tris.md2", icon: "w_glauncher", countWidth: 0, quantity: 1, ammo: "Grenades", flags: IT_WEAPON | IT_STAY_COOP, weapmodel: WEAP_GRENADELAUNCHER, tag: 0, precaches: "models/objects/grenade/tris.md2 weapons/grenlf1a.wav weapons/grenlr1b.wav weapons/grenlb1b.wav" },
  { classname: "weapon_rocketlauncher", pickup: "Pickup_Weapon", use: "Use_Weapon", drop: "Drop_Weapon", weaponThink: "Weapon_RocketLauncher", pickupName: "Rocket Launcher", pickupSound: "misc/w_pkup.wav", worldModel: "models/weapons/g_rocket/tris.md2", worldModelFlags: EF_ROTATE, viewModel: "models/weapons/v_rocket/tris.md2", icon: "w_rlauncher", countWidth: 0, quantity: 1, ammo: "Rockets", flags: IT_WEAPON | IT_STAY_COOP, weapmodel: WEAP_ROCKETLAUNCHER, tag: 0, precaches: "models/objects/rocket/tris.md2 weapons/rockfly.wav weapons/rocklf1a.wav weapons/rocklr1b.wav models/objects/debris2/tris.md2" },
  { classname: "weapon_hyperblaster", pickup: "Pickup_Weapon", use: "Use_Weapon", drop: "Drop_Weapon", weaponThink: "Weapon_HyperBlaster", pickupName: "HyperBlaster", pickupSound: "misc/w_pkup.wav", worldModel: "models/weapons/g_hyperb/tris.md2", worldModelFlags: EF_ROTATE, viewModel: "models/weapons/v_hyperb/tris.md2", icon: "w_hyperblaster", countWidth: 0, quantity: 1, ammo: "Cells", flags: IT_WEAPON | IT_STAY_COOP, weapmodel: WEAP_HYPERBLASTER, tag: 0, precaches: "weapons/hyprbu1a.wav weapons/hyprbl1a.wav weapons/hyprbf1a.wav weapons/hyprbd1a.wav misc/lasfly.wav" },
  { classname: "weapon_railgun", pickup: "Pickup_Weapon", use: "Use_Weapon", drop: "Drop_Weapon", weaponThink: "Weapon_Railgun", pickupName: "Railgun", pickupSound: "misc/w_pkup.wav", worldModel: "models/weapons/g_rail/tris.md2", worldModelFlags: EF_ROTATE, viewModel: "models/weapons/v_rail/tris.md2", icon: "w_railgun", countWidth: 0, quantity: 1, ammo: "Slugs", flags: IT_WEAPON | IT_STAY_COOP, weapmodel: WEAP_RAILGUN, tag: 0, precaches: "weapons/rg_hum.wav" },
  { classname: "weapon_bfg", pickup: "Pickup_Weapon", use: "Use_Weapon", drop: "Drop_Weapon", weaponThink: "Weapon_BFG", pickupName: "BFG10K", pickupSound: "misc/w_pkup.wav", worldModel: "models/weapons/g_bfg/tris.md2", worldModelFlags: EF_ROTATE, viewModel: "models/weapons/v_bfg/tris.md2", icon: "w_bfg", countWidth: 0, quantity: 50, ammo: "Cells", flags: IT_WEAPON | IT_STAY_COOP, weapmodel: WEAP_BFG, tag: 0, precaches: "sprites/s_bfg1.sp2 sprites/s_bfg2.sp2 sprites/s_bfg3.sp2 weapons/bfg__f1y.wav weapons/bfg__l1a.wav weapons/bfg__x1b.wav weapons/bfg_hum.wav" },
  { classname: "ammo_shells", pickup: "Pickup_Ammo", use: null, drop: "Drop_Ammo", weaponThink: null, pickupName: "Shells", pickupSound: "misc/am_pkup.wav", worldModel: "models/items/ammo/shells/medium/tris.md2", worldModelFlags: 0, viewModel: null, icon: "a_shells", countWidth: 3, quantity: 10, ammo: null, flags: IT_AMMO, weapmodel: 0, tag: ammo_t.AMMO_SHELLS, precaches: "" },
  { classname: "ammo_bullets", pickup: "Pickup_Ammo", use: null, drop: "Drop_Ammo", weaponThink: null, pickupName: "Bullets", pickupSound: "misc/am_pkup.wav", worldModel: "models/items/ammo/bullets/medium/tris.md2", worldModelFlags: 0, viewModel: null, icon: "a_bullets", countWidth: 3, quantity: 50, ammo: null, flags: IT_AMMO, weapmodel: 0, tag: ammo_t.AMMO_BULLETS, precaches: "" },
  { classname: "ammo_cells", pickup: "Pickup_Ammo", use: null, drop: "Drop_Ammo", weaponThink: null, pickupName: "Cells", pickupSound: "misc/am_pkup.wav", worldModel: "models/items/ammo/cells/medium/tris.md2", worldModelFlags: 0, viewModel: null, icon: "a_cells", countWidth: 3, quantity: 50, ammo: null, flags: IT_AMMO, weapmodel: 0, tag: ammo_t.AMMO_CELLS, precaches: "" },
  { classname: "ammo_rockets", pickup: "Pickup_Ammo", use: null, drop: "Drop_Ammo", weaponThink: null, pickupName: "Rockets", pickupSound: "misc/am_pkup.wav", worldModel: "models/items/ammo/rockets/medium/tris.md2", worldModelFlags: 0, viewModel: null, icon: "a_rockets", countWidth: 3, quantity: 5, ammo: null, flags: IT_AMMO, weapmodel: 0, tag: ammo_t.AMMO_ROCKETS, precaches: "" },
  { classname: "ammo_slugs", pickup: "Pickup_Ammo", use: null, drop: "Drop_Ammo", weaponThink: null, pickupName: "Slugs", pickupSound: "misc/am_pkup.wav", worldModel: "models/items/ammo/slugs/medium/tris.md2", worldModelFlags: 0, viewModel: null, icon: "a_slugs", countWidth: 3, quantity: 10, ammo: null, flags: IT_AMMO, weapmodel: 0, tag: ammo_t.AMMO_SLUGS, precaches: "" },
  { classname: "item_quad", pickup: "Pickup_Powerup", use: "Use_Quad", drop: "Drop_General", weaponThink: null, pickupName: "Quad Damage", pickupSound: "items/pkup.wav", worldModel: "models/items/quaddama/tris.md2", worldModelFlags: EF_ROTATE, viewModel: null, icon: "p_quad", countWidth: 2, quantity: 60, ammo: null, flags: IT_POWERUP, weapmodel: 0, tag: 0, precaches: "items/damage.wav items/damage2.wav items/damage3.wav" },
  { classname: "item_invulnerability", pickup: "Pickup_Powerup", use: "Use_Invulnerability", drop: "Drop_General", weaponThink: null, pickupName: "Invulnerability", pickupSound: "items/pkup.wav", worldModel: "models/items/invulner/tris.md2", worldModelFlags: EF_ROTATE, viewModel: null, icon: "p_invulnerability", countWidth: 2, quantity: 300, ammo: null, flags: IT_POWERUP, weapmodel: 0, tag: 0, precaches: "items/protect.wav items/protect2.wav items/protect4.wav" },
  { classname: "item_silencer", pickup: "Pickup_Powerup", use: "Use_Silencer", drop: "Drop_General", weaponThink: null, pickupName: "Silencer", pickupSound: "items/pkup.wav", worldModel: "models/items/silencer/tris.md2", worldModelFlags: EF_ROTATE, viewModel: null, icon: "p_silencer", countWidth: 2, quantity: 60, ammo: null, flags: IT_POWERUP, weapmodel: 0, tag: 0, precaches: "" },
  { classname: "item_breather", pickup: "Pickup_Powerup", use: "Use_Breather", drop: "Drop_General", weaponThink: null, pickupName: "Rebreather", pickupSound: "items/pkup.wav", worldModel: "models/items/breather/tris.md2", worldModelFlags: EF_ROTATE, viewModel: null, icon: "p_rebreather", countWidth: 2, quantity: 60, ammo: null, flags: IT_STAY_COOP | IT_POWERUP, weapmodel: 0, tag: 0, precaches: "items/airout.wav" },
  { classname: "item_enviro", pickup: "Pickup_Powerup", use: "Use_Envirosuit", drop: "Drop_General", weaponThink: null, pickupName: "Environment Suit", pickupSound: "items/pkup.wav", worldModel: "models/items/enviro/tris.md2", worldModelFlags: EF_ROTATE, viewModel: null, icon: "p_envirosuit", countWidth: 2, quantity: 60, ammo: null, flags: IT_STAY_COOP | IT_POWERUP, weapmodel: 0, tag: 0, precaches: "items/airout.wav" },
  { classname: "item_ancient_head", pickup: "Pickup_AncientHead", use: null, drop: null, weaponThink: null, pickupName: "Ancient Head", pickupSound: "items/pkup.wav", worldModel: "models/items/c_head/tris.md2", worldModelFlags: EF_ROTATE, viewModel: null, icon: "i_fixme", countWidth: 2, quantity: 60, ammo: null, flags: 0, weapmodel: 0, tag: 0, precaches: "" },
  { classname: "item_adrenaline", pickup: "Pickup_Adrenaline", use: null, drop: null, weaponThink: null, pickupName: "Adrenaline", pickupSound: "items/pkup.wav", worldModel: "models/items/adrenal/tris.md2", worldModelFlags: EF_ROTATE, viewModel: null, icon: "p_adrenaline", countWidth: 2, quantity: 60, ammo: null, flags: 0, weapmodel: 0, tag: 0, precaches: "" },
  { classname: "item_bandolier", pickup: "Pickup_Bandolier", use: null, drop: null, weaponThink: null, pickupName: "Bandolier", pickupSound: "items/pkup.wav", worldModel: "models/items/band/tris.md2", worldModelFlags: EF_ROTATE, viewModel: null, icon: "p_bandolier", countWidth: 2, quantity: 60, ammo: null, flags: 0, weapmodel: 0, tag: 0, precaches: "" },
  { classname: "item_pack", pickup: "Pickup_Pack", use: null, drop: null, weaponThink: null, pickupName: "Ammo Pack", pickupSound: "items/pkup.wav", worldModel: "models/items/pack/tris.md2", worldModelFlags: EF_ROTATE, viewModel: null, icon: "i_pack", countWidth: 2, quantity: 180, ammo: null, flags: 0, weapmodel: 0, tag: 0, precaches: "" },
  { classname: "key_data_cd", pickup: "Pickup_Key", use: null, drop: "Drop_General", weaponThink: null, pickupName: "Data CD", pickupSound: "items/pkup.wav", worldModel: "models/items/keys/data_cd/tris.md2", worldModelFlags: EF_ROTATE, viewModel: null, icon: "k_datacd", countWidth: 2, quantity: 0, ammo: null, flags: IT_STAY_COOP | IT_KEY, weapmodel: 0, tag: 0, precaches: "" },
  { classname: "key_power_cube", pickup: "Pickup_Key", use: null, drop: "Drop_General", weaponThink: null, pickupName: "Power Cube", pickupSound: "items/pkup.wav", worldModel: "models/items/keys/power/tris.md2", worldModelFlags: EF_ROTATE, viewModel: null, icon: "k_powercube", countWidth: 2, quantity: 0, ammo: null, flags: IT_STAY_COOP | IT_KEY, weapmodel: 0, tag: 0, precaches: "" },
  { classname: "key_pyramid", pickup: "Pickup_Key", use: null, drop: "Drop_General", weaponThink: null, pickupName: "Pyramid Key", pickupSound: "items/pkup.wav", worldModel: "models/items/keys/pyramid/tris.md2", worldModelFlags: EF_ROTATE, viewModel: null, icon: "k_pyramid", countWidth: 2, quantity: 0, ammo: null, flags: IT_STAY_COOP | IT_KEY, weapmodel: 0, tag: 0, precaches: "" },
  { classname: "key_data_spinner", pickup: "Pickup_Key", use: null, drop: "Drop_General", weaponThink: null, pickupName: "Data Spinner", pickupSound: "items/pkup.wav", worldModel: "models/items/keys/spinner/tris.md2", worldModelFlags: EF_ROTATE, viewModel: null, icon: "k_dataspin", countWidth: 2, quantity: 0, ammo: null, flags: IT_STAY_COOP | IT_KEY, weapmodel: 0, tag: 0, precaches: "" },
  { classname: "key_pass", pickup: "Pickup_Key", use: null, drop: "Drop_General", weaponThink: null, pickupName: "Security Pass", pickupSound: "items/pkup.wav", worldModel: "models/items/keys/pass/tris.md2", worldModelFlags: EF_ROTATE, viewModel: null, icon: "k_security", countWidth: 2, quantity: 0, ammo: null, flags: IT_STAY_COOP | IT_KEY, weapmodel: 0, tag: 0, precaches: "" },
  { classname: "key_blue_key", pickup: "Pickup_Key", use: null, drop: "Drop_General", weaponThink: null, pickupName: "Blue Key", pickupSound: "items/pkup.wav", worldModel: "models/items/keys/key/tris.md2", worldModelFlags: EF_ROTATE, viewModel: null, icon: "k_bluekey", countWidth: 2, quantity: 0, ammo: null, flags: IT_STAY_COOP | IT_KEY, weapmodel: 0, tag: 0, precaches: "" },
  { classname: "key_red_key", pickup: "Pickup_Key", use: null, drop: "Drop_General", weaponThink: null, pickupName: "Red Key", pickupSound: "items/pkup.wav", worldModel: "models/items/keys/red_key/tris.md2", worldModelFlags: EF_ROTATE, viewModel: null, icon: "k_redkey", countWidth: 2, quantity: 0, ammo: null, flags: IT_STAY_COOP | IT_KEY, weapmodel: 0, tag: 0, precaches: "" },
  { classname: "key_commander_head", pickup: "Pickup_Key", use: null, drop: "Drop_General", weaponThink: null, pickupName: "Commander's Head", pickupSound: "items/pkup.wav", worldModel: "models/monsters/commandr/head/tris.md2", worldModelFlags: EF_GIB, viewModel: null, icon: "k_comhead", countWidth: 2, quantity: 0, ammo: null, flags: IT_STAY_COOP | IT_KEY, weapmodel: 0, tag: 0, precaches: "" },
  { classname: "key_airstrike_target", pickup: "Pickup_Key", use: null, drop: "Drop_General", weaponThink: null, pickupName: "Airstrike Marker", pickupSound: "items/pkup.wav", worldModel: "models/items/keys/target/tris.md2", worldModelFlags: EF_ROTATE, viewModel: null, icon: "i_airstrike", countWidth: 2, quantity: 0, ammo: null, flags: IT_STAY_COOP | IT_KEY, weapmodel: 0, tag: 0, precaches: "" },
  { classname: "", pickup: "Pickup_Health", use: null, drop: null, weaponThink: null, pickupName: "Health", pickupSound: "items/pkup.wav", worldModel: "", worldModelFlags: 0, viewModel: null, icon: "i_health", countWidth: 3, quantity: 0, ammo: null, flags: 0, weapmodel: 0, tag: 0, precaches: "items/s_health.wav items/n_health.wav items/l_health.wav items/m_health.wav" }
] as const;

/**
 * Original name: N/A
 * Source declaree: N/A (local indexed itemlist view)
 * Category: New
 * Purpose: Attach stable 1-based Quake II item indices to the raw item definitions.
 */
const itemlist: readonly GameItemDefinition[] = rawItemlist.map((item, index) => ({
  index: index + 1,
  ...item
}));

/**
 * Original name: jacketarmor_info
 * Source: Quake-2-master/game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 */
const jacketarmor_info: GameItemArmorInfo = { base_count: 25, max_count: 50, normal_protection: 0.30, energy_protection: 0.00, armor: ARMOR_JACKET };

/**
 * Original name: combatarmor_info
 * Source: Quake-2-master/game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 */
const combatarmor_info: GameItemArmorInfo = { base_count: 50, max_count: 100, normal_protection: 0.60, energy_protection: 0.30, armor: ARMOR_COMBAT };

/**
 * Original name: bodyarmor_info
 * Source: Quake-2-master/game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 */
const bodyarmor_info: GameItemArmorInfo = { base_count: 100, max_count: 200, normal_protection: 0.80, energy_protection: 0.60, armor: ARMOR_BODY };

/**
 * Original name: FindItemByClassname
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Finds one item definition by its entity classname, using the original case-insensitive comparison.
 *
 * Porting notes:
 * - The C NULL classname sentinel is represented as an empty string in the TS item table and is skipped here.
 */
export function FindItemByClassname(classname: string): GameItemDefinition | null {
  for (const item of itemlist) {
    if (!item.classname) {
      continue;
    }
    if (Q_stricmp(item.classname, classname) === 0) {
      return item;
    }
  }

  return null;
}

/**
 * Original name: GetItemByIndex
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns one item definition from the stable Quake II itemlist index space.
 *
 * Porting notes:
 * - The C itemlist slot 0 and end marker are hidden from the TS array, so indices are translated by one.
 */
export function GetItemByIndex(index: number): GameItemDefinition | null {
  if (index <= 0 || index > itemlist.length) {
    return null;
  }

  return itemlist[index - 1] ?? null;
}

/**
 * Original name: FindItem
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Finds one item definition by pickup name using the original case-insensitive comparison.
 *
 * Porting notes:
 * - The C null slot and end marker are hidden from the TS item table, so the loop visits only real items.
 */
export function FindItem(pickupName: string): GameItemDefinition | null {
  for (const item of itemlist) {
    if (Q_stricmp(item.pickupName, pickupName) === 0) {
      return item;
    }
  }

  return null;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local itemlist accessor)
 * Category: New
 * Purpose: Expose the stable Quake II itemlist to later integration helpers without duplicating item metadata.
 *
 * Constraints:
 * - Must preserve the original item ordering and index values.
 */
export function GetGameItems(): readonly GameItemDefinition[] {
  return itemlist;
}

/**
 * Original name: ArmorIndex
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the currently active armor item index from the client inventory using the original priority order.
 */
export function ArmorIndex(ent: GameEntity): number {
  cacheItemIndices();
  if (!ent.client) {
    return 0;
  }

  if (ent.client.pers.inventory[jacket_armor_index] > 0) {
    return jacket_armor_index;
  }

  if (ent.client.pers.inventory[combat_armor_index] > 0) {
    return combat_armor_index;
  }

  if (ent.client.pers.inventory[body_armor_index] > 0) {
    return body_armor_index;
  }

  return 0;
}

/**
 * Original name: PowerArmorType
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the active power-armor type for one client entity using the original flag and inventory checks.
 */
export function PowerArmorType(ent: GameEntity): number {
  cacheItemIndices();
  const client = ent.client;
  if (!client) {
    return POWER_ARMOR_NONE;
  }

  if ((ent.flags & FL_POWER_ARMOR) === 0) {
    return POWER_ARMOR_NONE;
  }

  if (client.pers.inventory[power_shield_index] > 0) {
    return POWER_ARMOR_SHIELD;
  }

  if (client.pers.inventory[power_screen_index] > 0) {
    return POWER_ARMOR_SCREEN;
  }

  return POWER_ARMOR_NONE;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local armor info resolver)
 * Category: New
 * Purpose: Resolve the strict armor-info record associated with one base-game armor item.
 */
export function GetArmorInfoByItem(item: GameItemDefinition | null): GameItemArmorInfo | null {
  if (!item) {
    return null;
  }

  switch (item.classname) {
    case "item_armor_jacket":
      return jacketarmor_info;
    case "item_armor_combat":
      return combatarmor_info;
    case "item_armor_body":
      return bodyarmor_info;
    default:
      return null;
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (local ammo resolver)
 * Category: New
 * Purpose: Resolve the ammo item definition referenced by one weapon item definition.
 *
 * Constraints:
 * - Must return `null` when the weapon has no ammo item in the original definitions.
 */
export function GetAmmoItemForWeapon(item: GameItemDefinition | null): GameItemDefinition | null {
  if (!item?.ammo) {
    return null;
  }

  return FindItem(item.ammo);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local weapon lookup helper)
 * Category: New
 * Purpose: Resolve one weapon item definition by its `weaponThink` identifier.
 *
 * Constraints:
 * - Must only search within the original base-game itemlist.
 */
export function FindWeaponItemByThink(kind: GameItemWeaponThinkKind): GameItemDefinition | null {
  for (const item of itemlist) {
    if (item.weaponThink === kind) {
      return item;
    }
  }

  return null;
}

/**
 * Original name: InitItems
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns the Quake II item count excluding the null sentinel entry.
 */
export function InitItems(): number {
  cacheItemIndices();
  return itemlist.length;
}

/**
 * Original name: SetItemNames
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Exposes the pickup-name list in original itemlist order for later configstring wiring.
 */
export function SetItemNames(): string[] {
  cacheItemIndices();
  return itemlist.map((item) => item.pickupName);
}

/**
 * Original name: PrecacheItem
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Registers pickup, world, view, icon, ammo and space-separated precache assets for one item definition.
 *
 * Porting notes:
 * - Preserves the original ammo recursion guard and `MAX_QPATH` / minimum token validation.
 */
export function PrecacheItem(runtime: GameRuntime, item: GameItemDefinition | null): void {
  if (!item) {
    return;
  }

  if (item.pickupSound) {
    registerGameSound(runtime, item.pickupSound);
  }

  if (item.worldModel) {
    registerGameModel(runtime, item.worldModel);
  }

  if (item.viewModel) {
    registerGameModel(runtime, item.viewModel);
  }

  if (item.icon) {
    registerGameImage(runtime, item.icon);
  }

  if (item.ammo) {
    const ammo = FindItem(item.ammo);
    if (ammo !== item) {
      PrecacheItem(runtime, ammo);
    }
  }

  if (!item.precaches) {
    return;
  }

  for (const assetPath of item.precaches.split(" ").filter((value) => value.length > 0)) {
    const len = assetPath.length;
    if (len >= MAX_QPATH || len < 5) {
      throw new Error(`PrecacheItem: ${item.classname} has bad precache string`);
    }

    const extension = assetPath.slice(len - 3);
    if (extension === "md2" || extension === "sp2") {
      registerGameModel(runtime, assetPath);
      continue;
    }
    if (extension === "wav") {
      registerGameSound(runtime, assetPath);
      continue;
    }
    if (extension === "pcx") {
      registerGameImage(runtime, assetPath);
    }
  }
}

/**
 * Original name: DoRespawn
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Makes one hidden respawning item visible and touchable again, choosing a random team slave when needed.
 */
export function DoRespawn(ent: GameEntity, runtime: GameRuntime): void {
  if (ent.team) {
    const master = ent.teammaster ?? ent;
    const choices: GameEntity[] = [];
    for (let candidate: GameEntity | null = master; candidate; candidate = candidate.chain) {
      choices.push(candidate);
    }

    const choice = Math.floor(Math.random() * choices.length);
    ent = choices[choice] ?? ent;
  }

  ent.svflags &= ~SVF_NOCLIENT;
  ent.solid = SOLID_TRIGGER;
  linkGameEntity(runtime, ent);
  ent.s.event = entity_event_t.EV_ITEM_RESPAWN;
}

/**
 * Original name: SetRespawn
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Arms one item for delayed respawn by hiding it and scheduling `DoRespawn`.
 */
export function SetRespawn(ent: GameEntity, delaySeconds: number, runtime: GameRuntime): void {
  ent.flags |= FL_RESPAWN;
  ent.svflags |= SVF_NOCLIENT;
  ent.solid = SOLID_NOT;
  ent.nextthink = runtime.time + delaySeconds;
  ent.think = DoRespawn;
  linkGameEntity(runtime, ent);
}

/**
 * Original name: droptofloor
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Finalizes one item entity after the original delayed spawn window, traces it down to the floor, and arms normal, no-touch, trigger-spawn or team respawn state.
 *
 * Porting notes:
 * - Uses the local collision bridge for the original `gi.trace(..., MASK_SOLID)` floor probe.
 */
export function droptofloor(ent: GameEntity, runtime: GameRuntime): void {
  ent.mins = [-15, -15, -15];
  ent.maxs = [15, 15, 15];

  const modelPath = ent.model ?? ent.itemWorldModel ?? ent.item?.worldModel;
  if (modelPath) {
    ent.s.modelindex = registerGameModel(runtime, modelPath);
  }

  ent.solid = SOLID_TRIGGER;
  ent.movetype = MOVETYPE_TOSS;
  ent.touch = Touch_Item;

  if (runtime.collision) {
    const dest: [number, number, number] = [ent.origin[0], ent.origin[1], ent.origin[2] - 128];
    const trace = runtime.collision.trace(ent.origin, ent.mins, ent.maxs, dest, ent, MASK_SOLID);
    if (trace.startsolid) {
      G_FreeEdict(runtime, ent);
      return;
    }

    ent.origin = [...trace.endpos];
    ent.s.origin = [...trace.endpos];
  }

  if (ent.team) {
    ent.flags &= ~FL_TEAMSLAVE;
    ent.chain = ent.teamchain;
    ent.teamchain = null;

    ent.svflags |= SVF_NOCLIENT;
    ent.solid = SOLID_NOT;
    if (ent.teammaster === ent) {
      ent.nextthink = runtime.time + FRAMETIME;
      ent.think = DoRespawn;
    }
  }

  if ((ent.spawnflags & ITEM_NO_TOUCH) !== 0) {
    ent.solid = SOLID_BBOX;
    ent.touch = undefined;
    ent.s.effects &= ~EF_ROTATE;
    ent.s.renderfx &= ~RF_GLOW;
  }

  if ((ent.spawnflags & ITEM_TRIGGER_SPAWN) !== 0) {
    ent.solid = SOLID_NOT;
    ent.svflags |= SVF_NOCLIENT;
    ent.use = Use_Item;
  }

  refreshEntitySpatialState(ent);
  linkGameEntity(runtime, ent);
}

/**
 * Original name: Pickup_Powerup
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Grants one powerup item, applies the original skill/coop limits, and auto-uses instant items in deathmatch.
 */
export function Pickup_Powerup(ent: GameEntity, other: GameEntity, runtime: GameRuntime): boolean {
  const client = requireClient(other, "Pickup_Powerup");
  const item = ent.item;
  if (!item) {
    return false;
  }

  const index = ITEM_INDEX(item);
  const quantity = client.pers.inventory[index];
  if ((runtime.skill === 1 && quantity >= 2) || (runtime.skill >= 2 && quantity >= 1)) {
    return false;
  }

  if (runtime.coop && (item.flags & IT_STAY_COOP) !== 0 && quantity > 0) {
    return false;
  }

  client.pers.inventory[index] += 1;

  if (runtime.deathmatch) {
    if ((ent.spawnflags & DROPPED_ITEM) === 0) {
      SetRespawn(ent, item.quantity, runtime);
    }

    if ((runtime.dmflags & DF_INSTANT_ITEMS) !== 0 || (item.use === "Use_Quad" && (ent.spawnflags & DROPPED_PLAYER_ITEM) !== 0)) {
      if (item.use === "Use_Quad" && (ent.spawnflags & DROPPED_PLAYER_ITEM) !== 0) {
        quad_drop_timeout_hack = Math.trunc((ent.nextthink - runtime.time) / FRAMETIME);
      }

      callItemUse(other, item, runtime);
    }
  }

  return true;
}

/**
 * Original name: Drop_General
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Drops one general inventory item and validates the current selection.
 */
export function Drop_General(ent: GameEntity, item: GameItemDefinition, runtime: GameRuntime): void {
  const client = requireClient(ent, "Drop_General");
  Drop_Item(ent, item, runtime);
  client.pers.inventory[ITEM_INDEX(item)] -= 1;
  ValidateSelectedItem(ent, runtime);
}

/**
 * Original name: Pickup_Adrenaline
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - In single-player, raises the player's max health by one.
 * - Tops current health up to max health, then schedules deathmatch map-item respawn.
 *
 * Porting notes:
 * - Uses the runtime deathmatch flag instead of the original cvar pointer.
 */
export function Pickup_Adrenaline(ent: GameEntity, other: GameEntity, runtime: GameRuntime): boolean {
  if (!runtime.deathmatch) {
    other.max_health += 1;
  }

  if (other.health < other.max_health) {
    other.health = other.max_health;
  }

  if ((ent.spawnflags & DROPPED_ITEM) === 0 && runtime.deathmatch) {
    SetRespawn(ent, ent.item?.quantity ?? 0, runtime);
  }

  return true;
}

/**
 * Original name: Pickup_AncientHead
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Raises the player's max health by two without topping up current health.
 * - Schedules deathmatch map-item respawn for non-dropped Ancient Head items.
 *
 * Porting notes:
 * - Uses the runtime deathmatch flag instead of the original cvar pointer.
 */
export function Pickup_AncientHead(ent: GameEntity, other: GameEntity, runtime: GameRuntime): boolean {
  other.max_health += 2;

  if ((ent.spawnflags & DROPPED_ITEM) === 0 && runtime.deathmatch) {
    SetRespawn(ent, ent.item?.quantity ?? 0, runtime);
  }

  return true;
}

/**
 * Original name: Pickup_Bandolier
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Raises bullet/shell/cell/slug ammo capacities to the original
 * bandolier minimums, grants the C table quantities for Bullets and Shells,
 * then schedules map-item deathmatch respawn.
 * Porting notes: The repeated C local `gitem_t *item` lookups are factored
 * through `grantAmmoPickup`, which still resolves by pickup name and clamps to
 * the matching per-client ammo max.
 */
export function Pickup_Bandolier(ent: GameEntity, other: GameEntity, runtime: GameRuntime): boolean {
  const client = requireClient(other, "Pickup_Bandolier");
  client.pers.max_bullets = Math.max(client.pers.max_bullets, 250);
  client.pers.max_shells = Math.max(client.pers.max_shells, 150);
  client.pers.max_cells = Math.max(client.pers.max_cells, 250);
  client.pers.max_slugs = Math.max(client.pers.max_slugs, 75);

  grantAmmoPickup(client, "Bullets");
  grantAmmoPickup(client, "Shells");

  if ((ent.spawnflags & DROPPED_ITEM) === 0 && runtime.deathmatch) {
    SetRespawn(ent, ent.item?.quantity ?? 0, runtime);
  }

  return true;
}

/**
 * Original name: Pickup_Pack
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Raises all ammo capacities to the original ammo-pack minimums,
 * grants the C table quantities for Bullets, Shells, Cells, Grenades,
 * Rockets and Slugs, then schedules map-item deathmatch respawn.
 * Porting notes: The repeated C `item` and `index` locals are factored
 * through `grantAmmoPickup`, which still resolves each pickup name with
 * `FindItem`, uses `ITEM_INDEX`, and clamps against the matching ammo max.
 */
export function Pickup_Pack(ent: GameEntity, other: GameEntity, runtime: GameRuntime): boolean {
  const client = requireClient(other, "Pickup_Pack");
  client.pers.max_bullets = Math.max(client.pers.max_bullets, 300);
  client.pers.max_shells = Math.max(client.pers.max_shells, 200);
  client.pers.max_rockets = Math.max(client.pers.max_rockets, 100);
  client.pers.max_grenades = Math.max(client.pers.max_grenades, 100);
  client.pers.max_cells = Math.max(client.pers.max_cells, 300);
  client.pers.max_slugs = Math.max(client.pers.max_slugs, 100);

  grantAmmoPickup(client, "Bullets");
  grantAmmoPickup(client, "Shells");
  grantAmmoPickup(client, "Cells");
  grantAmmoPickup(client, "Grenades");
  grantAmmoPickup(client, "Rockets");
  grantAmmoPickup(client, "Slugs");

  if ((ent.spawnflags & DROPPED_ITEM) === 0 && runtime.deathmatch) {
    SetRespawn(ent, ent.item?.quantity ?? 0, runtime);
  }

  return true;
}

/**
 * Original name: Use_Quad
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Consume one Quad Damage inventory slot, validate the selected item, extend or start `quad_framenum`, then play `items/damage.wav`.
 * Porting notes: The original `quad_drop_timeout_hack` global is preserved so deathmatch dropped Quads keep their remaining timeout when auto-used.
 */
export function Use_Quad(ent: GameEntity, item: GameItemDefinition, runtime: GameRuntime): void {
  const client = requireClient(ent, "Use_Quad");
  client.pers.inventory[ITEM_INDEX(item)] -= 1;
  ValidateSelectedItem(ent, runtime);

  const timeout = quad_drop_timeout_hack || 300;
  quad_drop_timeout_hack = 0;
  if (client.quad_framenum > runtime.framenum) {
    client.quad_framenum += timeout;
  } else {
    client.quad_framenum = runtime.framenum + timeout;
  }

  emitGameSound(runtime, ent, "items/damage.wav");
}

/**
 * Original name: Use_Breather
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Consume one Rebreather inventory slot, validate the selected item, then extend or start `breather_framenum` by the original 300 frames.
 * Porting notes: The original activation sound call is commented out in C, so the port intentionally emits no use sound here.
 */
export function Use_Breather(ent: GameEntity, item: GameItemDefinition, runtime: GameRuntime): void {
  const client = requireClient(ent, "Use_Breather");
  client.pers.inventory[ITEM_INDEX(item)] -= 1;
  ValidateSelectedItem(ent, runtime);
  client.breather_framenum = client.breather_framenum > runtime.framenum ? client.breather_framenum + 300 : runtime.framenum + 300;
}

/**
 * Original name: Use_Envirosuit
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Consume one Environment Suit inventory slot, validate the selected item, then extend or start `enviro_framenum` by the original 300 frames.
 * Porting notes: The original activation sound call is commented out in C; the port intentionally does not emit a use sound here.
 */
export function Use_Envirosuit(ent: GameEntity, item: GameItemDefinition, runtime: GameRuntime): void {
  const client = requireClient(ent, "Use_Envirosuit");
  client.pers.inventory[ITEM_INDEX(item)] -= 1;
  ValidateSelectedItem(ent, runtime);
  client.enviro_framenum = client.enviro_framenum > runtime.framenum ? client.enviro_framenum + 300 : runtime.framenum + 300;
}

/**
 * Original name: Use_Invulnerability
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Consume one Invulnerability inventory slot, validate the selected item, then extend or start `invincible_framenum` by the original 300 frames.
 * Porting notes: The original `gi.sound` activation call is emitted through the runtime sound queue.
 */
export function Use_Invulnerability(ent: GameEntity, item: GameItemDefinition, runtime: GameRuntime): void {
  const client = requireClient(ent, "Use_Invulnerability");
  client.pers.inventory[ITEM_INDEX(item)] -= 1;
  ValidateSelectedItem(ent, runtime);
  client.invincible_framenum = client.invincible_framenum > runtime.framenum ? client.invincible_framenum + 300 : runtime.framenum + 300;
  emitGameSound(runtime, ent, "items/protect.wav");
}

/**
 * Original name: Use_Silencer
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior: Consume one Silencer inventory slot, validate the selected item, then add the original 30 suppressed weapon-noise shots.
 *
 * Porting notes: The activation sound remains absent because the original `gi.sound` call is commented out.
 */
export function Use_Silencer(ent: GameEntity, item: GameItemDefinition, runtime: GameRuntime): void {
  const client = requireClient(ent, "Use_Silencer");
  client.pers.inventory[ITEM_INDEX(item)] -= 1;
  ValidateSelectedItem(ent, runtime);
  client.silencer_shots += 30;
}

/**
 * Original name: Pickup_Key
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior: In coop, reject duplicate normal keys, track `key_power_cube` ownership through the spawnflag bitmask, and otherwise add one key inventory slot.
 *
 * Porting notes: The extra missing-item guard keeps malformed TS harness entities from throwing where the original map item path always supplied `ent->item`.
 */
export function Pickup_Key(ent: GameEntity, other: GameEntity, runtime: GameRuntime): boolean {
  const client = requireClient(other, "Pickup_Key");
  const item = ent.item;
  if (!item) {
    return false;
  }

  const index = ITEM_INDEX(item);
  if (runtime.coop) {
    if (ent.classname === "key_power_cube") {
      const cubeMask = (ent.spawnflags & 0x0000ff00) >> 8;
      if ((client.pers.power_cubes & cubeMask) !== 0) {
        return false;
      }
      client.pers.inventory[index] += 1;
      client.pers.power_cubes |= cubeMask;
    } else {
      if (client.pers.inventory[index] !== 0) {
        return false;
      }
      client.pers.inventory[index] = 1;
    }
    return true;
  }

  client.pers.inventory[index] += 1;
  return true;
}

/**
 * Original name: Add_Ammo
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Adds ammo to the inventory slot for the item's ammo tag, rejects non-clients, unknown ammo tags and already-full ammo, and clamps to the client's current max.
 * Porting notes: The C if/else tag chain is expressed through `getAmmoMax`; `runtime` is accepted for callback signature consistency but is not used by this routine.
 */
export function Add_Ammo(ent: GameEntity, item: GameItemDefinition, count: number, runtime: GameRuntime): boolean {
  void runtime;
  const client = ent.client;
  if (!client) {
    return false;
  }

  const max = getAmmoMax(client, item.tag);
  if (max <= 0) {
    return false;
  }

  const index = ITEM_INDEX(item);
  if (client.pers.inventory[index] === max) {
    return false;
  }

  client.pers.inventory[index] += count;
  if (client.pers.inventory[index] > max) {
    client.pers.inventory[index] = max;
  }

  return true;
}

/**
 * Original name: Pickup_Ammo
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Choose pickup count from infinite-ammo weapon rules, entity count, or item quantity; add ammo, optionally auto-select newly gained grenade weapons, and schedule deathmatch map-item respawn.
 * Porting notes: Keeps the original `oldcount` auto-switch gate while using runtime flags instead of C globals.
 */
export function Pickup_Ammo(ent: GameEntity, other: GameEntity, runtime: GameRuntime): boolean {
  const client = requireClient(other, "Pickup_Ammo");
  const item = ent.item;
  if (!item) {
    return false;
  }

  const weapon = (item.flags & IT_WEAPON) !== 0;
  const count = weapon && (runtime.dmflags & DF_INFINITE_AMMO) !== 0
    ? 1000
    : ent.count || item.quantity;
  const oldcount = client.pers.inventory[ITEM_INDEX(item)];

  if (!Add_Ammo(other, item, count, runtime)) {
    return false;
  }

  if (weapon && !oldcount) {
    if (client.pers.weapon !== item && (!runtime.deathmatch || client.pers.weapon === FindItem("blaster"))) {
      client.newweapon = item;
    }
  }

  if ((ent.spawnflags & (DROPPED_ITEM | DROPPED_PLAYER_ITEM)) === 0 && runtime.deathmatch) {
    SetRespawn(ent, 30, runtime);
  }
  return true;
}

/**
 * Original name: Drop_Ammo
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Drop at most one ammo item quantity from the player's inventory, using the `ITEM_INDEX(item)` slot.
 * Porting notes: The current-grenade guard preserves the C refusal path and frees the transient dropped entity.
 */
export function Drop_Ammo(ent: GameEntity, item: GameItemDefinition, runtime: GameRuntime): void {
  const client = requireClient(ent, "Drop_Ammo");
  const index = ITEM_INDEX(item);
  const dropped = Drop_Item(ent, item, runtime);
  dropped.count = client.pers.inventory[index] >= item.quantity ? item.quantity : client.pers.inventory[index];

  if (
    client.pers.weapon &&
    client.pers.weapon.tag === ammo_t.AMMO_GRENADES &&
    item.tag === ammo_t.AMMO_GRENADES &&
    client.pers.inventory[index] - dropped.count <= 0
  ) {
    runtime.log({
      kind: "message",
      message: `PRINT_${PRINT_HIGH}: Can't drop current weapon`,
      entityIndex: ent.index,
      entityClassname: ent.classname
    });
    G_FreeEdict(runtime, dropped);
    return;
  }

  client.pers.inventory[index] -= dropped.count;
  ValidateSelectedItem(ent, runtime);
}

/**
 * Original name: MegaHealth_think
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Drains one point per second while the pickup owner remains above `max_health`.
 * - Respawns non-dropped deathmatch mega health after the drain completes, otherwise frees the entity.
 *
 * Porting notes:
 * - Reinstalls the think callback after each drain tick because the TS scheduler clears it before invocation.
 */
export function MegaHealth_think(self: GameEntity, runtime: GameRuntime): void {
  if (self.owner && self.owner.health > self.owner.max_health) {
    self.nextthink = runtime.time + 1;
    self.think = MegaHealth_think;
    self.owner.health -= 1;
    return;
  }

  if ((self.spawnflags & DROPPED_ITEM) === 0 && runtime.deathmatch) {
    SetRespawn(self, 20, runtime);
  } else {
    G_FreeEdict(runtime, self);
  }
}

/**
 * Original name: Pickup_Health
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Rejects normal health at `max_health`, clamps non-ignore-max pickups, and lets timed mega health exceed the cap.
 * - Timed health hides the item, records the owner and schedules `MegaHealth_think`; non-timed map health respawns in deathmatch.
 *
 * Porting notes:
 * - Variant spawn functions provide the original `style` bits, count and model while sharing the generic `Health` item definition.
 */
export function Pickup_Health(ent: GameEntity, other: GameEntity, runtime: GameRuntime): boolean {
  if ((ent.style & HEALTH_IGNORE_MAX) === 0 && other.health >= other.max_health) {
    return false;
  }

  other.health += ent.count;
  if ((ent.style & HEALTH_IGNORE_MAX) === 0 && other.health > other.max_health) {
    other.health = other.max_health;
  }

  if ((ent.style & HEALTH_TIMED) !== 0) {
    ent.think = MegaHealth_think;
    ent.nextthink = runtime.time + 5;
    ent.owner = other;
    ent.flags |= FL_RESPAWN;
    ent.svflags |= SVF_NOCLIENT;
    ent.solid = SOLID_NOT;
  } else if ((ent.spawnflags & DROPPED_ITEM) === 0 && runtime.deathmatch) {
    SetRespawn(ent, 30, runtime);
  }

  return true;
}

/**
 * Original name: Pickup_Armor
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies standard armor pickup rules, including armor shards, better-armor conversion, weaker-armor salvage and deathmatch respawn.
 *
 * Porting notes:
 * - Uses `Math.trunc` where the C code assigns float salvage products to integer counters.
 */
export function Pickup_Armor(ent: GameEntity, other: GameEntity, runtime: GameRuntime): boolean {
  cacheItemIndices();
  const client = requireClient(other, "Pickup_Armor");
  const item = ent.item;
  if (!item) {
    return false;
  }

  const newinfo = GetArmorInfoByItem(item);
  const old_armor_index = ArmorIndex(other);

  if (item.tag === ARMOR_SHARD) {
    if (!old_armor_index) {
      client.pers.inventory[jacket_armor_index] = 2;
    } else {
      client.pers.inventory[old_armor_index] += 2;
    }
  } else if (!newinfo) {
    return false;
  } else if (!old_armor_index) {
    client.pers.inventory[ITEM_INDEX(item)] = newinfo.base_count;
  } else {
    const oldinfo = getArmorInfoByIndex(old_armor_index);
    if (!oldinfo) {
      return false;
    }

    if (newinfo.normal_protection > oldinfo.normal_protection) {
      const salvage = oldinfo.normal_protection / newinfo.normal_protection;
      const salvagecount = Math.trunc(salvage * client.pers.inventory[old_armor_index]);
      let newcount = newinfo.base_count + salvagecount;
      if (newcount > newinfo.max_count) {
        newcount = newinfo.max_count;
      }

      client.pers.inventory[old_armor_index] = 0;
      client.pers.inventory[ITEM_INDEX(item)] = newcount;
    } else {
      const salvage = newinfo.normal_protection / oldinfo.normal_protection;
      const salvagecount = Math.trunc(salvage * newinfo.base_count);
      let newcount = client.pers.inventory[old_armor_index] + salvagecount;
      if (newcount > oldinfo.max_count) {
        newcount = oldinfo.max_count;
      }

      if (client.pers.inventory[old_armor_index] >= newcount) {
        return false;
      }

      client.pers.inventory[old_armor_index] = newcount;
    }
  }

  if ((ent.spawnflags & DROPPED_ITEM) === 0 && runtime.deathmatch) {
    SetRespawn(ent, 20, runtime);
  }

  return true;
}

/**
 * Original name: Use_PowerArmor
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Toggles `FL_POWER_ARMOR`, requiring at least one cell before activation and emitting the original power on/off sounds.
 *
 * Porting notes:
 * - Engine `gi.cprintf` is represented by a runtime log entry at `PRINT_HIGH` severity.
 */
export function Use_PowerArmor(ent: GameEntity, item: GameItemDefinition, runtime: GameRuntime): void {
  const client = requireClient(ent, "Use_PowerArmor");

  if ((ent.flags & FL_POWER_ARMOR) !== 0) {
    ent.flags &= ~FL_POWER_ARMOR;
    emitGameSound(runtime, ent, "misc/power2.wav");
    return;
  }

  const cells = FindItem("cells");
  const index = ITEM_INDEX(cells);
  if (!cells || !client.pers.inventory[index]) {
    runtime.log({
      kind: "message",
      message: "PRINT_2: No cells for power armor.",
      entityIndex: ent.index,
      entityClassname: ent.classname
    });
    return;
  }

  ent.flags |= FL_POWER_ARMOR;
  emitGameSound(runtime, ent, "misc/power1.wav");
  void item;
}

/**
 * Original name: Pickup_PowerArmor
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Adds one power armor item, schedules deathmatch respawn for map items, and auto-uses the first pickup in deathmatch.
 */
export function Pickup_PowerArmor(ent: GameEntity, other: GameEntity, runtime: GameRuntime): boolean {
  const client = requireClient(other, "Pickup_PowerArmor");
  const item = ent.item;
  if (!item) {
    return false;
  }

  const index = ITEM_INDEX(item);
  const quantity = client.pers.inventory[index];
  client.pers.inventory[index] += 1;

  if (runtime.deathmatch) {
    if ((ent.spawnflags & DROPPED_ITEM) === 0) {
      SetRespawn(ent, item.quantity, runtime);
    }
    if (!quantity) {
      Use_PowerArmor(other, item, runtime);
    }
  }

  return true;
}

/**
 * Original name: Drop_PowerArmor
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Turns power armor off before dropping the last carried unit, then delegates to the shared drop path.
 */
export function Drop_PowerArmor(ent: GameEntity, item: GameItemDefinition, runtime: GameRuntime): void {
  const client = requireClient(ent, "Drop_PowerArmor");
  if ((ent.flags & FL_POWER_ARMOR) !== 0 && client.pers.inventory[ITEM_INDEX(item)] === 1) {
    Use_PowerArmor(ent, item, runtime);
  }
  Drop_General(ent, item, runtime);
}

/**
 * Original name: Touch_Item
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Preserves the original item touch gates, pickup dispatch, HUD feedback, target firing, coop-stay handling and cleanup/respawn decisions.
 * - Uses the count-specific health pickup sounds and changes the selected item only for usable pickups.
 */
export function Touch_Item(ent: GameEntity, other: GameEntity, runtime: GameRuntime): void {
  if (!other.client) {
    return;
  }
  if (other.health < 1) {
    return;
  }
  if (!ent.item?.pickup) {
    return;
  }

  const taken = callItemPickup(ent, other, runtime);

  if (taken) {
    const itemIndex = ITEM_INDEX(ent.item);
    other.client.bonus_alpha = 0.25;
    other.client.ps.stats[STAT_PICKUP_ICON] = ent.item.icon ? registerGameImage(runtime, ent.item.icon) : 0;
    other.client.ps.stats[STAT_PICKUP_STRING] = CS_ITEMS + itemIndex;
    other.client.pickup_msg_time = runtime.time + 3.0;

    if (ent.item.use) {
      other.client.pers.selected_item = itemIndex;
      other.client.ps.stats[STAT_SELECTED_ITEM] = itemIndex;
    }

    if (ent.item.pickup === "Pickup_Health") {
      if (ent.count === 2) {
        emitGameSound(runtime, other, "items/s_health.wav");
      } else if (ent.count === 10) {
        emitGameSound(runtime, other, "items/n_health.wav");
      } else if (ent.count === 25) {
        emitGameSound(runtime, other, "items/l_health.wav");
      } else {
        emitGameSound(runtime, other, "items/m_health.wav");
      }
    } else if (ent.item.pickupSound) {
      emitGameSound(runtime, other, ent.item.pickupSound);
    }
  }

  if ((ent.spawnflags & ITEM_TARGETS_USED) === 0) {
    G_UseTargets(runtime, ent, other);
    ent.spawnflags |= ITEM_TARGETS_USED;
  }

  if (!taken) {
    return;
  }

  if (!((runtime.coop && (ent.item.flags & IT_STAY_COOP) !== 0)) || (ent.spawnflags & (DROPPED_ITEM | DROPPED_PLAYER_ITEM)) !== 0) {
    if ((ent.flags & FL_RESPAWN) !== 0) {
      ent.flags &= ~FL_RESPAWN;
    } else {
      G_FreeEdict(runtime, ent);
    }
  }
}

/**
 * Original name: drop_temp_touch
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Keeps a freshly dropped item untouchable by its owner, then delegates normal pickup touches to `Touch_Item`.
 */
function drop_temp_touch(ent: GameEntity, other: GameEntity, runtime: GameRuntime): void {
  if (other === ent.owner) {
    return;
  }

  Touch_Item(ent, other, runtime);
}

/**
 * Original name: drop_make_touchable
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Restores the normal item touch callback after the one-second owner grace period.
 * - In deathmatch, schedules the original delayed `G_FreeEdict` cleanup 29 seconds later.
 *
 * Porting notes:
 * - The direct C function pointer to `G_FreeEdict` is represented by a small runtime adapter preserving argument order.
 */
function drop_make_touchable(ent: GameEntity, runtime: GameRuntime): void {
  ent.touch = Touch_Item;
  if (runtime.deathmatch) {
    ent.nextthink = runtime.time + 29;
    ent.think = (self, localRuntime) => G_FreeEdict(localRuntime, self);
  }
}

/**
 * Original name: Drop_Item
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Spawns a tossed item entity with the original world model, glow, owner guard and delayed touch restoration.
 * - For client owners, projects the drop point from view angles and clamps it through the gameplay collision trace.
 * - For non-client owners, starts the drop at the owner's origin while using entity angles only for velocity.
 *
 * Porting notes:
 * - `gi.setmodel` is represented by `registerGameModel`; `gi.trace(..., CONTENTS_SOLID)` is routed through the runtime collision bridge when available.
 */
export function Drop_Item(ent: GameEntity, item: GameItemDefinition, runtime: GameRuntime): GameEntity {
  const dropped = spawnGameEntity(runtime);
  dropped.classname = item.classname;
  dropped.item = item;
  dropped.spawnflags = DROPPED_ITEM;
  dropped.s.effects = item.worldModelFlags;
  dropped.s.renderfx = RF_GLOW;
  dropped.mins = [-15, -15, -15];
  dropped.maxs = [15, 15, 15];
  dropped.solid = SOLID_TRIGGER;
  dropped.movetype = MOVETYPE_TOSS;
  dropped.touch = drop_temp_touch;
  dropped.owner = ent;

  if (item.worldModel) {
    dropped.s.modelindex = registerGameModel(runtime, item.worldModel);
  }

  const { forward, right } = AngleVectors(ent.client ? ent.client.v_angle : ent.s.angles);
  let origin = ent.s.origin;
  if (ent.client) {
    const offset: [number, number, number] = [24, 0, -16];
    const projectedOrigin = G_ProjectSource(ent.s.origin, offset, forward, right);
    origin = runtime.collision
      ? runtime.collision.trace(ent.s.origin, dropped.mins, dropped.maxs, projectedOrigin, ent, CONTENTS_SOLID).endpos
      : projectedOrigin;
  }

  dropped.origin = [...origin];
  dropped.s.origin = [...origin];
  dropped.velocity = [forward[0] * 100, forward[1] * 100, 300];

  dropped.think = drop_make_touchable;
  dropped.nextthink = runtime.time + 1;
  linkGameEntity(runtime, dropped);
  return dropped;
}

/**
 * Original name: Use_Item
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Reveals a trigger-spawned item, clears its use callback, then arms either bbox/no-touch or trigger/touch pickup state before relinking.
 */
export function Use_Item(ent: GameEntity, _other: GameEntity | null, _activator: GameEntity | null, runtime: GameRuntime): void {
  ent.svflags &= ~SVF_NOCLIENT;
  ent.use = undefined;

  if ((ent.spawnflags & ITEM_NO_TOUCH) !== 0) {
    ent.solid = SOLID_BBOX;
    ent.touch = undefined;
  } else {
    ent.solid = SOLID_TRIGGER;
    ent.touch = Touch_Item;
  }

  linkGameEntity(runtime, ent);
}

/**
 * Original name: SpawnItem
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Precaches, applies deathmatch/coop spawn rules, then schedules delayed floor placement.
 *
 * Porting notes:
 * - The original invalid-spawnflags diagnostic is represented only by clearing the flags; see file deviations.
 */
export function SpawnItem(ent: GameEntity, item: GameItemDefinition, runtime: GameRuntime): void {
  PrecacheItem(runtime, item);

  if (ent.spawnflags !== 0 && ent.classname !== "key_power_cube") {
    ent.spawnflags = 0;
  }

  if (runtime.deathmatch) {
    if ((runtime.dmflags & DF_NO_ARMOR) !== 0) {
      if (item.pickup === "Pickup_Armor" || item.pickup === "Pickup_PowerArmor") {
        G_FreeEdict(runtime, ent);
        return;
      }
    }
    if ((runtime.dmflags & DF_NO_ITEMS) !== 0) {
      if (item.pickup === "Pickup_Powerup") {
        G_FreeEdict(runtime, ent);
        return;
      }
    }
    if ((runtime.dmflags & DF_NO_HEALTH) !== 0) {
      if (item.pickup === "Pickup_Health" || item.pickup === "Pickup_Adrenaline" || item.pickup === "Pickup_AncientHead") {
        G_FreeEdict(runtime, ent);
        return;
      }
    }
    if ((runtime.dmflags & DF_INFINITE_AMMO) !== 0) {
      if (item.flags === IT_AMMO || ent.classname === "weapon_bfg") {
        G_FreeEdict(runtime, ent);
        return;
      }
    }
  }

  if (runtime.coop && ent.classname === "key_power_cube") {
    ent.spawnflags |= (1 << (8 + runtime.power_cubes));
    runtime.power_cubes += 1;
  }

  if (runtime.coop && (item.flags & IT_STAY_COOP) !== 0) {
    item = { ...item, drop: null };
  }

  ent.item = item;
  ent.itemIndex = item.index;
  ent.itemClassname = item.classname;
  ent.itemPickupName = item.pickupName;
  ent.itemWorldModel = ent.model ?? item.worldModel;
  ent.itemWorldModelFlags = item.worldModelFlags;
  ent.nextthink = runtime.time + 2 * FRAMETIME;
  ent.think = droptofloor;
  ent.s.effects = item.worldModelFlags;
  ent.s.renderfx = RF_GLOW;

  if (ent.model) {
    registerGameModel(runtime, ent.model);
  }
}

/**
 * Original name: SP_item_health
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns the medium health pickup.
 */
export function SP_item_health(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch && (runtime.dmflags & DF_NO_HEALTH) !== 0) {
    G_FreeEdict(runtime, self);
    return;
  }

  self.model = "models/items/healing/medium/tris.md2";
  self.count = 10;
  const item = FindItem("Health");
  if (item) {
    SpawnItem(self, item, runtime);
  }
  registerGameSound(runtime, "items/n_health.wav");
}

/**
 * Original name: SP_item_health_small
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns the small stimpack health pickup.
 */
export function SP_item_health_small(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch && (runtime.dmflags & DF_NO_HEALTH) !== 0) {
    G_FreeEdict(runtime, self);
    return;
  }

  self.model = "models/items/healing/stimpack/tris.md2";
  self.count = 2;
  const item = FindItem("Health");
  if (item) {
    SpawnItem(self, item, runtime);
  }
  self.style = HEALTH_IGNORE_MAX;
  registerGameSound(runtime, "items/s_health.wav");
}

/**
 * Original name: SP_item_health_large
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns the large health pickup.
 */
export function SP_item_health_large(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch && (runtime.dmflags & DF_NO_HEALTH) !== 0) {
    G_FreeEdict(runtime, self);
    return;
  }

  self.model = "models/items/healing/large/tris.md2";
  self.count = 25;
  const item = FindItem("Health");
  if (item) {
    SpawnItem(self, item, runtime);
  }
  registerGameSound(runtime, "items/l_health.wav");
}

/**
 * Original name: SP_item_health_mega
 * Source: game/g_items.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns the mega-health pickup.
 */
export function SP_item_health_mega(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch && (runtime.dmflags & DF_NO_HEALTH) !== 0) {
    G_FreeEdict(runtime, self);
    return;
  }

  self.model = "models/items/mega_h/tris.md2";
  self.count = 100;
  const item = FindItem("Health");
  if (item) {
    SpawnItem(self, item, runtime);
  }
  registerGameSound(runtime, "items/m_health.wav");
  self.style = HEALTH_IGNORE_MAX | HEALTH_TIMED;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local index helper)
 * Category: New
 * Purpose: Return the stable itemlist index for nullable item references inside this port.
 */
function ITEM_INDEX(item: GameItemDefinition | null): number {
  return item?.index ?? 0;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local client guard)
 * Category: New
 * Purpose: Narrow gameplay entities to entities with client state before mutating player inventory or timers.
 */
function requireClient(ent: GameEntity, caller: string) {
  if (!ent.client) {
    throw new Error(`${caller}: entity #${ent.index} has no client`);
  }

  return ent.client;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local armor info resolver)
 * Category: New
 * Purpose: Resolve the armor-info record from the active inventory index cached by the item initialization path.
 */
function getArmorInfoByIndex(index: number): GameItemArmorInfo | null {
  if (index === jacket_armor_index) {
    return jacketarmor_info;
  }
  if (index === combat_armor_index) {
    return combatarmor_info;
  }
  if (index === body_armor_index) {
    return bodyarmor_info;
  }
  return null;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local ammo max helper)
 * Category: New
 * Purpose: Map an ammo tag to the matching per-client ammo cap.
 */
function getAmmoMax(client: NonNullable<GameEntity["client"]>, tag: number): number {
  switch (tag) {
    case ammo_t.AMMO_BULLETS:
      return client.pers.max_bullets;
    case ammo_t.AMMO_SHELLS:
      return client.pers.max_shells;
    case ammo_t.AMMO_ROCKETS:
      return client.pers.max_rockets;
    case ammo_t.AMMO_GRENADES:
      return client.pers.max_grenades;
    case ammo_t.AMMO_CELLS:
      return client.pers.max_cells;
    case ammo_t.AMMO_SLUGS:
      return client.pers.max_slugs;
    default:
      return 0;
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (local ammo pickup helper)
 * Category: New
 * Purpose: Apply one named ammo pickup while preserving the original item lookup, index and max-ammo clamp.
 */
function grantAmmoPickup(client: NonNullable<GameEntity["client"]>, pickupName: string): void {
  const item = FindItem(pickupName);
  if (!item) {
    return;
  }

  const index = ITEM_INDEX(item);
  client.pers.inventory[index] += item.quantity;
  const max = getAmmoMax(client, item.tag);
  if (client.pers.inventory[index] > max) {
    client.pers.inventory[index] = max;
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (local dispatch helper)
 * Category: New
 * Purpose: Dispatch the callback-kind stored in `GameItemDefinition.pickup` to the matching ported pickup routine.
 */
function callItemPickup(ent: GameEntity, other: GameEntity, runtime: GameRuntime): boolean {
  switch (ent.item?.pickup) {
    case "Pickup_Armor":
      return Pickup_Armor(ent, other, runtime);
    case "Pickup_PowerArmor":
      return Pickup_PowerArmor(ent, other, runtime);
    case "Pickup_Weapon":
      return Pickup_Weapon(ent, other, ent.item, runtime, { Add_Ammo, SetRespawn });
    case "Pickup_Ammo":
      return Pickup_Ammo(ent, other, runtime);
    case "Pickup_Powerup":
      return Pickup_Powerup(ent, other, runtime);
    case "Pickup_AncientHead":
      return Pickup_AncientHead(ent, other, runtime);
    case "Pickup_Adrenaline":
      return Pickup_Adrenaline(ent, other, runtime);
    case "Pickup_Bandolier":
      return Pickup_Bandolier(ent, other, runtime);
    case "Pickup_Pack":
      return Pickup_Pack(ent, other, runtime);
    case "Pickup_Key":
      return Pickup_Key(ent, other, runtime);
    case "Pickup_Health":
      return Pickup_Health(ent, other, runtime);
    default:
      return false;
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (local dispatch helper)
 * Category: New
 * Purpose: Dispatch the callback-kind stored in `GameItemDefinition.use` to the matching ported use routine.
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
