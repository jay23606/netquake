/**
 * File: p_hud.ts
 * Source: Quake II original / game/p_hud.c
 * Purpose: Port of the first player HUD stat assembly helpers required by spectator chase mode.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses the gameplay runtime asset registry instead of `gi.imageindex`.
 * - Layout emission is routed through explicit hooks instead of direct `gi.Write*` calls.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

import {
  CS_PLAYERSKINS,
  RDF_UNDERWATER,
  STAT_AMMO,
  STAT_AMMO_ICON,
  STAT_ARMOR,
  STAT_ARMOR_ICON,
  STAT_CHASE,
  STAT_FRAGS,
  STAT_HEALTH,
  STAT_HEALTH_ICON,
  STAT_HELPICON,
  STAT_LAYOUTS,
  STAT_PICKUP_ICON,
  STAT_PICKUP_STRING,
  STAT_SELECTED_ICON,
  STAT_SELECTED_ITEM,
  STAT_SPECTATOR,
  STAT_TIMER,
  STAT_TIMER_ICON,
  pmtype_t
} from "../../qcommon/src/index.js";
import { CENTER_HANDED, FL_POWER_ARMOR, ITEM_INDEX, IT_KEY, SOLID_NOT } from "./g_local.js";
import { FindItem, GetItemByIndex, ArmorIndex, PowerArmorType } from "./g_items.js";
import { G_Find } from "./g_utils.js";
import { respawn } from "./p_client.js";
import { emitGameSound, registerGameImage } from "./runtime.js";
import type { GameEntity, GameRuntime } from "./runtime.js";

/**
 * Original name: N/A
 * Source: N/A (local HUD hook contract)
 * Category: New
 * Purpose: Keep the remaining unported intermission-side effects explicit.
 */
export interface GameHudHooks {
  emitLayout?: (ent: GameEntity, layout: string, runtime: GameRuntime) => void;
}

/**
 * Original name: N/A
 * Source: N/A (local help-computer data contract)
 * Category: New
 * Purpose: Carry the global gameplay state that the original help-computer layout pulled from `game` and `level`.
 */
export interface GameHudHelpComputerData {
  skill: number;
  level_name: string;
  helpmessage1: string;
  helpmessage2: string;
  killed_monsters: number;
  total_monsters: number;
  found_goals: number;
  total_goals: number;
  found_secrets: number;
  total_secrets: number;
}

/**
 * Original name: MoveClientToIntermission
 * Source: game/p_hud.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Freezes one client at the intermission point and clears transient combat presentation state.
 */
export function MoveClientToIntermission(ent: GameEntity, runtime: GameRuntime, hooks: GameHudHooks = {}): void {
  const client = ent.client;
  if (!client) {
    return;
  }

  if (runtime.deathmatch || runtime.coop) {
    client.showscores = true;
  }

  ent.s.origin = [...runtime.intermission_origin];
  client.ps.pmove.origin = [
    Math.trunc(runtime.intermission_origin[0] * 8),
    Math.trunc(runtime.intermission_origin[1] * 8),
    Math.trunc(runtime.intermission_origin[2] * 8)
  ];
  client.ps.viewangles = [...runtime.intermission_angle];
  client.ps.pmove.pm_type = pmtype_t.PM_FREEZE;
  client.ps.gunindex = 0;
  client.ps.blend[3] = 0;
  client.ps.rdflags &= ~RDF_UNDERWATER;

  client.quad_framenum = 0;
  client.invincible_framenum = 0;
  client.breather_framenum = 0;
  client.enviro_framenum = 0;
  client.grenade_blew_up = false;
  client.grenade_time = 0;

  ent.viewheight = 0;
  ent.s.modelindex = 0;
  ent.s.modelindex2 = 0;
  ent.s.modelindex3 = 0;
  ent.s.effects = 0;
  ent.s.sound = 0;
  ent.solid = SOLID_NOT;

  if (runtime.deathmatch || runtime.coop) {
    DeathmatchScoreboard(ent, runtime, hooks);
  }
}

/**
 * Original name: BeginIntermission
 * Source: game/p_hud.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Switches the level into intermission, respawns dead clients and moves all active clients to the chosen intermission spot.
 */
export function BeginIntermission(targ: GameEntity, runtime: GameRuntime, hooks: GameHudHooks = {}): void {
  if (runtime.intermissiontime) {
    return;
  }

  runtime.autosaved = false;

  for (let i = 1; i <= runtime.maxclients; i += 1) {
    const clientEnt = runtime.entities[i] ?? null;
    if (!clientEnt?.inuse) {
      continue;
    }
    if (clientEnt.health <= 0) {
      respawn(clientEnt, runtime);
    }
  }

  runtime.intermissiontime = runtime.time;
  runtime.changemap = targ.map ?? null;

  if (runtime.changemap?.includes("*")) {
    if (runtime.coop) {
      for (let i = 1; i <= runtime.maxclients; i += 1) {
        const clientEnt = runtime.entities[i] ?? null;
        const client = clientEnt?.client;
        if (!clientEnt?.inuse || !client) {
          continue;
        }
        for (let itemIndex = 1; itemIndex < client.pers.inventory.length; itemIndex += 1) {
          const item = GetItemByIndex(itemIndex);
          if (item && (item.flags & IT_KEY) !== 0) {
            client.pers.inventory[itemIndex] = 0;
          }
        }
      }
    }
  } else if (!runtime.deathmatch) {
    runtime.exitintermission = 1;
    return;
  }

  runtime.exitintermission = 0;

  let spot = G_Find(runtime, null, "classname", "info_player_intermission");
  if (!spot) {
    spot = G_Find(runtime, null, "classname", "info_player_start")
      ?? G_Find(runtime, null, "classname", "info_player_deathmatch");
  } else {
    let count = (Math.trunc(Math.random() * 0x7fffffff) & 3);
    while (count > 0) {
      spot = G_Find(runtime, spot, "classname", "info_player_intermission")
        ?? G_Find(runtime, null, "classname", "info_player_intermission")
        ?? spot;
      count -= 1;
    }
  }

  if (!spot) {
    return;
  }

  runtime.intermission_origin = [...spot.s.origin];
  runtime.intermission_angle = [...spot.s.angles];

  for (let i = 1; i <= runtime.maxclients; i += 1) {
    const clientEnt = runtime.entities[i] ?? null;
    if (!clientEnt?.inuse) {
      continue;
    }
    MoveClientToIntermission(clientEnt, runtime, hooks);
  }
}

/**
 * Original name: DeathmatchScoreboardMessage
 * Source: game/p_hud.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Builds the scoreboard layout string for the top non-spectator clients sorted by score.
 */
export function DeathmatchScoreboardMessage(ent: GameEntity, killer: GameEntity | null, runtime: GameRuntime): string {
  const sorted: number[] = [];
  const sortedScores: number[] = [];

  for (let i = 0; i < runtime.maxclients; i += 1) {
    const clientEnt = runtime.entities[1 + i] ?? null;
    const client = clientEnt?.client;
    if (!clientEnt?.inuse || !client || client.resp.spectator) {
      continue;
    }

    const score = client.resp.score;
    let insertAt = 0;
    while (insertAt < sorted.length && score <= sortedScores[insertAt]!) {
      insertAt += 1;
    }

    sorted.splice(insertAt, 0, i);
    sortedScores.splice(insertAt, 0, score);
  }

  let layout = "";
  const total = Math.min(sorted.length, 12);

  for (let i = 0; i < total; i += 1) {
    const clientIndex = sorted[i]!;
    const cl = runtime.entities[1 + clientIndex]?.client;
    const clEnt = runtime.entities[1 + clientIndex] ?? null;
    if (!cl || !clEnt) {
      continue;
    }

    const x = i >= 6 ? 160 : 0;
    const y = 32 + 32 * (i % 6);
    let entry = "";

    if (clEnt === ent) {
      entry += `xv ${x + 32} yv ${y} picn tag1 `;
    } else if (clEnt === killer) {
      entry += `xv ${x + 32} yv ${y} picn tag2 `;
    }

    entry += `client ${x} ${y} ${clientIndex} ${cl.resp.score} ${cl.ping} ${Math.trunc((runtime.framenum - cl.resp.enterframe) / 600)} `;
    if ((layout.length + entry.length) > 1024) {
      break;
    }
    layout += entry;
  }

  return layout;
}

/**
 * Original name: DeathmatchScoreboard
 * Source: game/p_hud.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the current scoreboard layout for one client.
 */
export function DeathmatchScoreboard(ent: GameEntity, runtime: GameRuntime, hooks: GameHudHooks = {}): string {
  const layout = DeathmatchScoreboardMessage(ent, ent.enemy ?? null, runtime);
  hooks.emitLayout?.(ent, layout, runtime);
  return layout;
}

/**
 * Original name: Cmd_Score_f
 * Source: game/p_hud.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Toggles the scoreboard overlay and emits it immediately when becoming visible.
 */
export function Cmd_Score_f(ent: GameEntity, runtime: GameRuntime, hooks: GameHudHooks = {}): void {
  const client = ent.client;
  if (!client) {
    return;
  }

  client.showinventory = false;
  client.showhelp = false;

  if (!runtime.deathmatch && !runtime.coop) {
    return;
  }

  if (client.showscores) {
    client.showscores = false;
    return;
  }

  client.showscores = true;
  DeathmatchScoreboard(ent, runtime, hooks);
}

/**
 * Original name: HelpComputer
 * Source: game/p_hud.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Builds and emits the single-player help-computer overlay.
 */
export function HelpComputer(
  ent: GameEntity,
  runtime: GameRuntime,
  data: GameHudHelpComputerData,
  hooks: GameHudHooks = {}
): string {
  const skillLabel = data.skill === 0 ? "easy" : data.skill === 1 ? "medium" : data.skill === 2 ? "hard" : "hard+";
  const layout =
    `xv 32 yv 8 picn help ` +
    `xv 202 yv 12 string2 "${layoutQuote(skillLabel)}" ` +
    `xv 0 yv 24 cstring2 "${layoutQuote(data.level_name)}" ` +
    `xv 0 yv 54 cstring2 "${layoutQuote(data.helpmessage1)}" ` +
    `xv 0 yv 110 cstring2 "${layoutQuote(data.helpmessage2)}" ` +
    `xv 50 yv 164 string2 " kills     goals    secrets" ` +
    `xv 50 yv 172 string2 "${pad3(data.killed_monsters)}/${pad3(data.total_monsters)}     ${data.found_goals}/${data.total_goals}       ${data.found_secrets}/${data.total_secrets}" `;
  hooks.emitLayout?.(ent, layout, runtime);
  return layout;
}

/**
 * Original name: Cmd_Help_f
 * Source: game/p_hud.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Toggles the help overlay, or forwards to the scoreboard in deathmatch.
 */
export function Cmd_Help_f(
  ent: GameEntity,
  runtime: GameRuntime,
  data: GameHudHelpComputerData,
  hooks: GameHudHooks = {}
): void {
  const client = ent.client;
  if (!client) {
    return;
  }

  if (runtime.deathmatch) {
    Cmd_Score_f(ent, runtime, hooks);
    return;
  }

  client.showinventory = false;
  client.showscores = false;

  if (client.showhelp && client.pers.game_helpchanged === runtime.helpchanged) {
    client.showhelp = false;
    return;
  }

  client.showhelp = true;
  client.pers.helpchanged = 0;
  HelpComputer(ent, runtime, data, hooks);
}

/**
 * Original name: G_SetStats
 * Source: game/p_hud.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Populates the core HUD stats array for one player entity.
 */
export function G_SetStats(ent: GameEntity, runtime: GameRuntime): void {
  const client = ent.client;
  if (!client) {
    return;
  }

  client.ps.stats[STAT_HEALTH_ICON] = runtime.pic_health || imageIndex(runtime, "i_health");
  client.ps.stats[STAT_HEALTH] = ent.health;

  if (!client.ammo_index) {
    client.ps.stats[STAT_AMMO_ICON] = 0;
    client.ps.stats[STAT_AMMO] = 0;
  } else {
    const item = GetItemByIndex(client.ammo_index);
    client.ps.stats[STAT_AMMO_ICON] = item?.icon ? imageIndex(runtime, item.icon) : 0;
    client.ps.stats[STAT_AMMO] = client.pers.inventory[client.ammo_index] ?? 0;
  }

  let powerArmorType = PowerArmorType(ent);
  let cells = 0;
  if (powerArmorType) {
    const cellsItem = FindItem("Cells");
    cells = cellsItem ? client.pers.inventory[ITEM_INDEX(cellsItem)] ?? 0 : 0;
    if (cells === 0) {
      ent.flags &= ~FL_POWER_ARMOR;
      emitGameSound(runtime, ent, "misc/power2.wav");
      powerArmorType = 0;
    }
  }

  const armorIndex = ArmorIndex(ent);
  if (powerArmorType && (!armorIndex || (runtime.framenum & 8) !== 0)) {
    client.ps.stats[STAT_ARMOR_ICON] = imageIndex(runtime, "i_powershield");
    client.ps.stats[STAT_ARMOR] = cells;
  } else if (armorIndex) {
    const item = GetItemByIndex(armorIndex);
    client.ps.stats[STAT_ARMOR_ICON] = item?.icon ? imageIndex(runtime, item.icon) : 0;
    client.ps.stats[STAT_ARMOR] = client.pers.inventory[armorIndex] ?? 0;
  } else {
    client.ps.stats[STAT_ARMOR_ICON] = 0;
    client.ps.stats[STAT_ARMOR] = 0;
  }

  if (runtime.time > client.pickup_msg_time) {
    client.ps.stats[STAT_PICKUP_ICON] = 0;
    client.ps.stats[STAT_PICKUP_STRING] = 0;
  }

  if (client.quad_framenum > runtime.framenum) {
    client.ps.stats[STAT_TIMER_ICON] = imageIndex(runtime, "p_quad");
    client.ps.stats[STAT_TIMER] = Math.trunc((client.quad_framenum - runtime.framenum) / 10);
  } else if (client.invincible_framenum > runtime.framenum) {
    client.ps.stats[STAT_TIMER_ICON] = imageIndex(runtime, "p_invulnerability");
    client.ps.stats[STAT_TIMER] = Math.trunc((client.invincible_framenum - runtime.framenum) / 10);
  } else if (client.enviro_framenum > runtime.framenum) {
    client.ps.stats[STAT_TIMER_ICON] = imageIndex(runtime, "p_envirosuit");
    client.ps.stats[STAT_TIMER] = Math.trunc((client.enviro_framenum - runtime.framenum) / 10);
  } else if (client.breather_framenum > runtime.framenum) {
    client.ps.stats[STAT_TIMER_ICON] = imageIndex(runtime, "p_rebreather");
    client.ps.stats[STAT_TIMER] = Math.trunc((client.breather_framenum - runtime.framenum) / 10);
  } else {
    client.ps.stats[STAT_TIMER_ICON] = 0;
    client.ps.stats[STAT_TIMER] = 0;
  }

  if (client.pers.selected_item === -1) {
    client.ps.stats[STAT_SELECTED_ICON] = 0;
  } else {
    const item = GetItemByIndex(client.pers.selected_item);
    client.ps.stats[STAT_SELECTED_ICON] = item?.icon ? imageIndex(runtime, item.icon) : 0;
  }

  client.ps.stats[STAT_SELECTED_ITEM] = client.pers.selected_item;
  client.ps.stats[STAT_LAYOUTS] = 0;

  if (runtime.deathmatch) {
    if (client.pers.health <= 0 || runtime.intermissiontime !== 0 || client.showscores) {
      client.ps.stats[STAT_LAYOUTS] |= 1;
    }
    if (client.showinventory && client.pers.health > 0) {
      client.ps.stats[STAT_LAYOUTS] |= 2;
    }
  } else {
    if (client.showscores || client.showhelp) {
      client.ps.stats[STAT_LAYOUTS] |= 1;
    }
    if (client.showinventory && client.pers.health > 0) {
      client.ps.stats[STAT_LAYOUTS] |= 2;
    }
  }

  client.ps.stats[STAT_FRAGS] = client.resp.score;

  if (client.pers.helpchanged && (runtime.framenum & 8) !== 0) {
    client.ps.stats[STAT_HELPICON] = imageIndex(runtime, "i_help");
  } else if ((client.pers.hand === CENTER_HANDED || client.ps.fov > 91) && client.pers.weapon?.icon) {
    client.ps.stats[STAT_HELPICON] = imageIndex(runtime, client.pers.weapon.icon);
  } else {
    client.ps.stats[STAT_HELPICON] = 0;
  }

  client.ps.stats[STAT_SPECTATOR] = 0;
}

/**
 * Original name: G_CheckChaseStats
 * Source: game/p_hud.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Mirrors one chased player's stats onto all spectators currently following them.
 */
export function G_CheckChaseStats(ent: GameEntity, runtime: GameRuntime): void {
  for (let i = 1; i <= runtime.maxclients; i += 1) {
    const spectator = runtime.entities[i] ?? null;
    const cl = spectator?.client;
    if (!spectator?.inuse || !cl || cl.chase_target !== ent) {
      continue;
    }

    cl.ps.stats = ent.client ? ent.client.ps.stats.slice() : cl.ps.stats.slice();
    G_SetSpectatorStats(spectator, runtime);
  }
}

/**
 * Original name: G_SetSpectatorStats
 * Source: game/p_hud.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Marks one client as spectator in the HUD and shows the chased player's skin slot when available.
 */
export function G_SetSpectatorStats(ent: GameEntity, runtime: GameRuntime): void {
  const cl = ent.client;
  if (!cl) {
    return;
  }

  if (!cl.chase_target) {
    G_SetStats(ent, runtime);
  }

  cl.ps.stats[STAT_SPECTATOR] = 1;
  cl.ps.stats[STAT_LAYOUTS] = 0;

  if (cl.pers.health <= 0 || runtime.intermissiontime !== 0 || cl.showscores) {
    cl.ps.stats[STAT_LAYOUTS] |= 1;
  }
  if (cl.showinventory && cl.pers.health > 0) {
    cl.ps.stats[STAT_LAYOUTS] |= 2;
  }

  if (cl.chase_target?.inuse) {
    cl.ps.stats[STAT_CHASE] = CS_PLAYERSKINS + cl.chase_target.index - 1;
  } else {
    cl.ps.stats[STAT_CHASE] = 0;
  }
}

/**
 * Original name: N/A
 * Source: N/A (local HUD image adapter)
 * Category: New
 * Purpose: Route HUD image lookups through the gameplay runtime asset registry.
 */
function imageIndex(runtime: GameRuntime, icon: string): number {
  return registerGameImage(runtime, icon);
}

/**
 * Original name: N/A
 * Source: N/A (local layout string helper)
 * Category: New
 * Purpose: Keep generated layout strings safe for Quake II quoted fields.
 */
function layoutQuote(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "'");
}

/**
 * Original name: N/A
 * Source: N/A (local layout formatting helper)
 * Category: New
 * Purpose: Match the fixed-width counter fields used by the original help layout.
 */
function pad3(value: number): string {
  return value.toString().padStart(3, " ");
}
