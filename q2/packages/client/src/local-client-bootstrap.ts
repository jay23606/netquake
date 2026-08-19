/**
 * File: local-client-bootstrap.ts
 * Purpose: Hold the runtime-side local client bootstrap data used by the standalone browser loop without keeping it in a web adapter.
 *
 * This file is not a direct source port.
 * It is a runtime bootstrap helper for the current standalone client flow.
 *
 * Dependencies:
 * - packages/client/src/client.ts
 */

import {
  CS_IMAGES,
  CS_ITEMS,
  CS_STATUSBAR,
  STAT_AMMO,
  STAT_AMMO_ICON,
  STAT_ARMOR,
  STAT_ARMOR_ICON,
  STAT_FRAGS,
  STAT_HEALTH,
  STAT_HEALTH_ICON,
  STAT_LAYOUTS,
  STAT_PICKUP_ICON,
  STAT_PICKUP_STRING,
  STAT_SELECTED_ICON,
  STAT_SELECTED_ITEM,
  STAT_TIMER,
  STAT_TIMER_ICON
} from "../../qcommon/src/index.js";
import type { ClientRuntime } from "./client.js";

/**
 * Original name: N/A
 * Source: N/A (local client HUD bootstrap)
 * Category: New
 * Purpose: Define the minimal statusbar layout used by the standalone local client before server-authored layout configstrings exist.
 */
const LOCAL_SINGLE_STATUSBAR =
  "yb -24 "
  + "xv 0 "
  + "hnum "
  + "xv 50 "
  + "pic 0 "
  + "if 2 "
  + " xv 100 "
  + " anum "
  + " xv 150 "
  + " pic 2 "
  + "endif "
  + "if 4 "
  + " xv 200 "
  + " rnum "
  + " xv 250 "
  + " pic 4 "
  + "endif "
  + "if 6 "
  + " xv 296 "
  + " pic 6 "
  + "endif "
  + "yb -50 "
  + "if 7 "
  + " xv 0 "
  + " pic 7 "
  + " xv 26 "
  + " yb -42 "
  + " stat_string 8 "
  + " yb -50 "
  + "endif "
  + "if 9 "
  + " xv 262 "
  + " num 2 10 "
  + " xv 296 "
  + " pic 9 "
  + "endif "
  + "if 11 "
  + " xv 148 "
  + " pic 11 "
  + "endif ";

/**
 * Original name: N/A
 * Source: N/A (local client HUD bootstrap)
 * Category: New
 * Purpose: Define the minimal scoreboard layout used by the standalone local client bootstrap.
 */
const LOCAL_SCOREBOARD_LAYOUT =
  "xv 0 yv 32 picn inventory "
  + "client 0 32 0 7 32 5 "
  + "client 0 64 1 3 48 3 ";

/**
 * Original name: N/A
 * Source: N/A (local client HUD bootstrap)
 * Category: New
 * Purpose: Describe one local item-string entry used to seed `CS_ITEMS`.
 */
export interface LocalClientItemStringEntry {
  index: number;
  pickupName: string;
}

/**
 * Original name: N/A
 * Source: N/A (local client HUD bootstrap)
 * Category: New
 * Purpose: Describe one local inventory entry used to seed the standalone client mirror.
 */
export interface LocalClientInventoryEntry {
  index: number;
  count: number;
}

/**
 * Original name: N/A
 * Source: N/A (local client HUD bootstrap)
 * Category: New
 * Purpose: Carry the runtime-only local HUD bootstrap data needed to seed the standalone client state.
 */
export interface LocalClientHudBootstrapData {
  imageNames: string[];
  itemStrings: LocalClientItemStringEntry[];
  inventory: LocalClientInventoryEntry[];
  selectedWeaponIndex: number;
  selectedWeaponIcon: string | null;
  selectedAmmoIndex: number;
  selectedAmmoIcon: string | null;
  selectedAmmoCount: number;
}

/**
 * Original name: N/A
 * Source: N/A (local client HUD bootstrap)
 * Category: New
 * Purpose: Find one local client image index from the current configstring table without creating a duplicate registration path.
 *
 * Constraints:
 * - Must return `0` when the image name is absent.
 */
export function findClientImageIndex(runtime: ClientRuntime, imageName: string): number {
  for (let index = 1; index < 256; index += 1) {
    if (runtime.cl.configstrings[CS_IMAGES + index] === imageName) {
      return index;
    }
  }

  return 0;
}

/**
 * Original name: N/A
 * Source: N/A (local client HUD bootstrap)
 * Category: New
 * Purpose: Seed the standalone client runtime with a minimal HUD bootstrap that still uses the real screen snapshot path.
 *
 * Constraints:
 * - Must keep all values data-only and renderer-agnostic.
 * - Must only touch local bootstrap state until authoritative server stats exist.
 */
export function initializeLocalHudState(runtime: ClientRuntime, bootstrap: LocalClientHudBootstrapData): void {
  runtime.cl.configstrings[CS_STATUSBAR] = LOCAL_SINGLE_STATUSBAR;
  bootstrap.imageNames.forEach((imageName, offset) => {
    runtime.cl.configstrings[CS_IMAGES + offset + 1] = imageName;
  });

  for (const entry of bootstrap.itemStrings) {
    runtime.cl.configstrings[CS_ITEMS + entry.index] = entry.pickupName;
  }

  for (const entry of bootstrap.inventory) {
    runtime.cl.inventory[entry.index] = entry.count;
  }

  runtime.cl.layout = LOCAL_SCOREBOARD_LAYOUT;
  runtime.cl.playernum = 0;
  runtime.cl.clientinfo[0].name = "Player";
  runtime.cl.clientinfo[0].iconname = "players/male/grunt_i.pcx";
  runtime.cl.clientinfo[1].name = "Bitterman";
  runtime.cl.clientinfo[1].iconname = "players/male/major_i.pcx";
  runtime.cl.baseclientinfo.name = "Player";
  runtime.cl.baseclientinfo.iconname = "players/male/grunt_i.pcx";

  runtime.cl.frame.playerstate.stats[STAT_HEALTH_ICON] = 1;
  runtime.cl.frame.playerstate.stats[STAT_HEALTH] = 100;
  runtime.cl.frame.playerstate.stats[STAT_AMMO_ICON] = bootstrap.selectedAmmoIcon
    ? findClientImageIndex(runtime, bootstrap.selectedAmmoIcon)
    : 0;
  runtime.cl.frame.playerstate.stats[STAT_AMMO] = bootstrap.selectedAmmoCount;
  runtime.cl.frame.playerstate.stats[STAT_ARMOR_ICON] = findClientImageIndex(runtime, "i_combatarmor");
  runtime.cl.frame.playerstate.stats[STAT_ARMOR] = 50;
  runtime.cl.frame.playerstate.stats[STAT_SELECTED_ICON] = bootstrap.selectedWeaponIcon
    ? findClientImageIndex(runtime, bootstrap.selectedWeaponIcon)
    : 0;
  runtime.cl.frame.playerstate.stats[STAT_SELECTED_ITEM] = bootstrap.selectedWeaponIndex;
  runtime.cl.frame.playerstate.stats[STAT_PICKUP_ICON] = 0;
  runtime.cl.frame.playerstate.stats[STAT_PICKUP_STRING] = 0;
  runtime.cl.frame.playerstate.stats[STAT_TIMER_ICON] = 0;
  runtime.cl.frame.playerstate.stats[STAT_TIMER] = 0;
  runtime.cl.frame.playerstate.stats[STAT_FRAGS] = 0;
  runtime.cl.frame.playerstate.stats[STAT_LAYOUTS] = 0;
}

/**
 * Original name: N/A
 * Source: N/A (local client HUD bootstrap)
 * Category: New
 * Purpose: Set or clear one `STAT_LAYOUTS` bit inside the standalone local client player-state stats.
 *
 * Constraints:
 * - Must preserve the original Quake II bitfield semantics.
 */
export function setLocalLayoutBit(runtime: ClientRuntime, bitMask: number, enabled: boolean): void {
  const current = runtime.cl.frame.playerstate.stats[STAT_LAYOUTS] ?? 0;
  runtime.cl.frame.playerstate.stats[STAT_LAYOUTS] = enabled ? (current | bitMask) : (current & ~bitMask);
}

/**
 * Original name: N/A
 * Source: N/A (local client HUD bootstrap)
 * Category: New
 * Purpose: Toggle one `STAT_LAYOUTS` bit inside the standalone local client player-state stats.
 *
 * Constraints:
 * - Must preserve the original Quake II bitfield semantics.
 */
export function toggleLocalLayoutBit(runtime: ClientRuntime, bitMask: number): void {
  const current = runtime.cl.frame.playerstate.stats[STAT_LAYOUTS] ?? 0;
  runtime.cl.frame.playerstate.stats[STAT_LAYOUTS] = current ^ bitMask;
}
