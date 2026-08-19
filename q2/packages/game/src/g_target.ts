/**
 * File: g_target.ts
 * Source: Quake II original / game/g_target.c
 * Purpose: Port of Quake II target entities and their activation behaviors.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - `gi.WriteByte` / `gi.multicast` temp-entity side effects are queued as structured runtime events.
 * - `gi.configstring` updates are recorded in the gameplay runtime configstring map.
 * - Sound calls are queued through the runtime sound-event bridge with source sound indices preserved on entities.
 *
 * Notes:
 * - This file is intended to stay close to the original C source.
 */

import {
  ATTN_NONE,
  ATTN_NORM,
  CHAN_AUTO,
  CHAN_RELIABLE,
  CHAN_VOICE,
  CS_CDTRACK,
  CS_LIGHTS,
  DF_ALLOW_EXIT,
  MAX_QPATH,
  Q_stricmp,
  EF_BLASTER,
  EF_HYPERBLASTER,
  RF_BEAM,
  RF_TRANSLUCENT,
  multicast_t,
  temp_event_t,
  vec3_origin,
  type vec3_t
} from "../../qcommon/src/index.js";
import {
  CONTENTS_DEADMONSTER,
  CONTENTS_MONSTER,
  CONTENTS_SOLID
} from "../../qcommon/src/q_shared.js";
import {
  DAMAGE_ENERGY,
  FL_IMMUNE_LASER,
  MOD_EXIT,
  MOD_EXPLOSIVE,
  MOD_SPLASH,
  MOD_TARGET_LASER,
  SFL_CROSS_TRIGGER_MASK,
  crandom
} from "./g_local.js";
import {
  FRAMETIME,
  MOVETYPE_NONE,
  SOLID_NOT,
  SVF_MONSTER,
  SVF_NOCLIENT,
  emitRegisteredGameSound,
  emitGameTempEntity,
  freeGameEntity,
  linkGameEntity,
  registerGameSound,
  setGameConfigstring
} from "./runtime.js";
import { T_Damage, T_RadiusDamage } from "./g_combat.js";
import { fire_blaster } from "./g_weapon.js";
import { ED_CallSpawn } from "./g_spawn.js";
import { G_Find, G_FreeEdict, G_SetMovedir, G_Spawn, G_UseTargets, KillBox, vtos } from "./g_utils.js";
import { BeginIntermission } from "./p_hud.js";
import type { GameEntity, GameRuntime } from "./runtime.js";

/**
 * Original name: N/A
 * Source declaree: N/A (local constants)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose:
 * - Names the original target_speaker spawnflag bit values used inline in `game/g_target.c`.
 */
const TARGET_SPEAKER_LOOPED_ON = 1;
const TARGET_SPEAKER_LOOPED_OFF = 2;
const TARGET_SPEAKER_RELIABLE = 4;

/**
 * Original name: N/A
 * Source declaree: N/A (local constants)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose:
 * - Names the original target_laser spawnflag bit values used inline in `game/g_target.c`.
 */
const TARGET_LASER_START_ON = 1;
const TARGET_LASER_RED = 2;
const TARGET_LASER_GREEN = 4;
const TARGET_LASER_BLUE = 8;
const TARGET_LASER_YELLOW = 16;
const TARGET_LASER_ORANGE = 32;
const TARGET_LASER_FAT = 64;
const TARGET_LASER_SPARKS = 0x80000000;

/**
 * Original name: N/A
 * Source declaree: N/A (local constants)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose:
 * - Mirrors the fixed `strncpy(..., sizeof(helpmessage*) - 1)` copy limit.
 */
const TARGET_HELP_MESSAGE_COPY_LENGTH = 511;

/**
 * Original name: Use_Target_Tent
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits one origin-based temporary entity event to clients in the PVS.
 */
export function Use_Target_Tent(ent: GameEntity, _other: GameEntity | null, _activator: GameEntity | null, runtime: GameRuntime): void {
  emitGameTempEntity(runtime, ent.style as temp_event_t, ent.s.origin, multicast_t.MULTICAST_PVS, {
    style: ent.style
  });
}

/**
 * Original name: SP_target_temp_entity
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function SP_target_temp_entity(ent: GameEntity, _runtime: GameRuntime): void {
  ent.use = Use_Target_Tent;
}

/**
 * Original name: Use_Target_Speaker
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Toggles looped speaker sounds through `s.sound`, or emits a positioned one-shot sound.
 *
 * Porting notes:
 * - Queues the original `gi.positioned_sound` call through the runtime sound-event bridge.
 */
export function Use_Target_Speaker(ent: GameEntity, _other: GameEntity | null, _activator: GameEntity | null, runtime: GameRuntime): void {
  if ((ent.spawnflags & (TARGET_SPEAKER_LOOPED_ON | TARGET_SPEAKER_LOOPED_OFF)) !== 0) {
    ent.s.sound = ent.s.sound ? 0 : ent.noise_index;
    return;
  }

  const channel = (ent.spawnflags & TARGET_SPEAKER_RELIABLE) !== 0
    ? CHAN_VOICE | CHAN_RELIABLE
    : CHAN_VOICE;
  emitRegisteredSound(runtime, ent, ent.noise_index, {
    origin: ent.s.origin,
    channel,
    volume: ent.volume,
    attenuation: ent.attenuation,
    timeofs: 0
  });
}

/**
 * Original name: SP_target_speaker
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Precaches the configured noise, applies volume/attenuation defaults, prestarts looped sounds, and links the entity.
 *
 * Porting notes:
 * - Uses `ent.properties.noise` for the original map spawn temp value `st.noise`.
 * - Keeps the original fixed `MAX_QPATH` stack buffer limit before registering the sound.
 */
export function SP_target_speaker(ent: GameEntity, runtime: GameRuntime): void {
  const noise = ent.properties.noise;
  if (!noise) {
    runtime.log({
      kind: "warning",
      message: `target_speaker with no noise set at ${vtos(ent.s.origin)}`,
      entityIndex: ent.index,
      entityClassname: ent.classname
    });
    return;
  }

  const soundPath = truncateCString(noise.includes(".wav") ? noise : `${noise}.wav`, MAX_QPATH - 1);
  ent.noise_index = registerGameSound(runtime, soundPath);
  if (!ent.volume) {
    ent.volume = 1.0;
  }
  if (!ent.attenuation) {
    ent.attenuation = 1.0;
  } else if (ent.attenuation === -1) {
    ent.attenuation = 0;
  }

  if ((ent.spawnflags & TARGET_SPEAKER_LOOPED_ON) !== 0) {
    ent.s.sound = ent.noise_index;
  }

  ent.use = Use_Target_Speaker;
  linkGameEntity(runtime, ent);
}

/**
 * Original name: Use_Target_Help
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Copies the entity message into the selected fixed-size help buffer and increments `helpchanged`.
 *
 * Porting notes:
 * - Mirrors the original `strncpy(..., sizeof(game.helpmessage*) - 1)` limit with an explicit string slice.
 */
export function Use_Target_Help(ent: GameEntity, _other: GameEntity | null, _activator: GameEntity | null, runtime: GameRuntime): void {
  const message = truncateCString(ent.message ?? "", TARGET_HELP_MESSAGE_COPY_LENGTH);
  if ((ent.spawnflags & 1) !== 0) {
    runtime.helpmessage1 = message;
  } else {
    runtime.helpmessage2 = message;
  }
  runtime.helpchanged += 1;
}

/**
 * Original name: SP_target_help
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Removes itself in deathmatch, rejects missing messages, otherwise installs `Use_Target_Help`.
 */
export function SP_target_help(ent: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    freeGameEntity(runtime, ent);
    return;
  }

  if (!ent.message) {
    runtime.log({
      kind: "warning",
      message: `${ent.classname} with no message at ${vtos(ent.s.origin)}`,
      entityIndex: ent.index,
      entityClassname: ent.classname
    });
    freeGameEntity(runtime, ent);
    return;
  }

  ent.use = Use_Target_Help;
}

/**
 * Original name: use_target_secret
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Plays the registered secret sound on `CHAN_VOICE`, increments the found-secret counter, fires the target chain, then frees the single-use entity.
 *
 * Porting notes:
 * - `gi.sound` is represented by a queued runtime sound event drained by the game main adapter.
 */
export function use_target_secret(ent: GameEntity, _other: GameEntity | null, activator: GameEntity | null, runtime: GameRuntime): void {
  emitRegisteredSound(runtime, ent, ent.noise_index, {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
  runtime.found_secrets += 1;
  G_UseTargets(runtime, ent, activator);
  G_FreeEdict(runtime, ent);
}

/**
 * Original name: SP_target_secret
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Auto-removes in deathmatch, installs the single-use callback, precaches `st.noise` or `misc/secret.wav`, hides the entity from clients, increments the total-secret counter, and preserves the original `mine3` map bug hack.
 *
 * Porting notes:
 * - `st.noise` is stored in parsed entity properties before spawn.
 */
export function SP_target_secret(ent: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    freeGameEntity(runtime, ent);
    return;
  }

  ent.use = use_target_secret;
  ent.noise_index = registerGameSound(runtime, ent.properties.noise ?? "misc/secret.wav");
  ent.svflags = SVF_NOCLIENT;
  runtime.total_secrets += 1;

  if (
    stringsEqualIgnoreCase(runtime.mapname, "mine3") &&
    ent.s.origin[0] === 280 &&
    ent.s.origin[1] === -2048 &&
    ent.s.origin[2] === -624
  ) {
    ent.message = "You have found a secret area.";
  }
}

/**
 * Original name: use_target_goal
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior:
 * - Plays the registered goal sound, increments `found_goals`, stops the CD track once all goals are found,
 *   fires chained targets with the original activator and frees the single-use entity.
 * Porting notes:
 * - Uses `GameRuntime` counters/configstring queues in place of the original `level` global and `gi.configstring`.
 */
export function use_target_goal(ent: GameEntity, _other: GameEntity | null, activator: GameEntity | null, runtime: GameRuntime): void {
  emitRegisteredSound(runtime, ent, ent.noise_index, {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
  runtime.found_goals += 1;

  if (runtime.found_goals === runtime.total_goals) {
    setGameConfigstring(runtime, CS_CDTRACK, "0");
  }

  G_UseTargets(runtime, ent, activator);
  G_FreeEdict(runtime, ent);
}

/**
 * Original name: SP_target_goal
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior:
 * - Removes itself in deathmatch, installs `use_target_goal`, registers `st.noise` or `misc/secret.wav`,
 *   hides the server entity from clients and increments `total_goals`.
 * Porting notes:
 * - Reads the original `st.noise` spawn temp from `ent.properties.noise`.
 */
export function SP_target_goal(ent: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    freeGameEntity(runtime, ent);
    return;
  }

  ent.use = use_target_goal;
  ent.noise_index = registerGameSound(runtime, ent.properties.noise ?? "misc/secret.wav");
  ent.svflags = SVF_NOCLIENT;
  runtime.total_goals += 1;
}

/**
 * Original name: target_explosion_explode
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits `TE_EXPLOSION1` at the target origin to `MULTICAST_PHS`, applies radius damage with
 *   `MOD_EXPLOSIVE`, then fires this entity's targets with the stored activator.
 * - Temporarily clears `delay` while firing targets, matching the C local `save`, so the explosion
 *   target itself can have a delay without forcing `G_UseTargets` through `Think_Delay`.
 *
 * Porting notes:
 * - Uses structured runtime temp-entity events instead of direct `gi.Write*` calls.
 * - Falls back to `self` as the radius-damage attacker when no activator is available because the
 *   TypeScript combat path uses a non-null attacker entity.
 */
export function target_explosion_explode(self: GameEntity, runtime: GameRuntime): void {
  emitGameTempEntity(runtime, temp_event_t.TE_EXPLOSION1, self.s.origin, multicast_t.MULTICAST_PHS);
  T_RadiusDamage(self, self.activator ?? self, self.dmg, null, self.dmg + 40, MOD_EXPLOSIVE, runtime);

  const save = self.delay;
  self.delay = 0;
  G_UseTargets(runtime, self, self.activator);
  self.delay = save;
}

/**
 * Original name: use_target_explosion
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Stores the activator, explodes immediately when `delay` is zero, otherwise schedules
 *   `target_explosion_explode` at `level.time + delay`.
 */
export function use_target_explosion(self: GameEntity, _other: GameEntity | null, activator: GameEntity | null, runtime: GameRuntime): void {
  self.activator = activator;
  if (!self.delay) {
    target_explosion_explode(self, runtime);
    return;
  }

  self.think = target_explosion_explode;
  self.nextthink = runtime.time + self.delay;
}

/**
 * Original name: SP_target_explosion
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Installs `use_target_explosion` and hides the target entity from client snapshots with
 *   `SVF_NOCLIENT`.
 */
export function SP_target_explosion(ent: GameEntity, _runtime: GameRuntime): void {
  ent.use = use_target_explosion;
  ent.svflags = SVF_NOCLIENT;
}

/**
 * Original name: use_target_changelevel
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Ignores repeat activations and dead single-player exits.
 * - Applies the deathmatch `noexit` damage rule unless `DF_ALLOW_EXIT` is set.
 * - Announces deathmatch exits, clears cross-level trigger bits for unit transitions, then enters intermission.
 *
 * Porting notes:
 * - `gi.bprintf` is represented as a runtime log message until the server bridge drains gameplay logs.
 */
export function use_target_changelevel(self: GameEntity, other: GameEntity | null, activator: GameEntity | null, runtime: GameRuntime): void {
  if (runtime.intermissiontime) {
    return;
  }

  if (!runtime.deathmatch && !runtime.coop) {
    const player = runtime.entities[1] ?? null;
    if (player && player.health <= 0) {
      return;
    }
  }

  if (runtime.deathmatch && (runtime.dmflags & DF_ALLOW_EXIT) === 0 && other && other !== runtime.entities[0]) {
    T_Damage(other, self, self, vec3_origin, other.s.origin, vec3_origin, 10 * other.max_health, 1000, 0, MOD_EXIT, runtime);
    return;
  }

  if (runtime.deathmatch && activator?.client) {
    runtime.log({
      kind: "message",
      message: `${activator.client.pers.netname} exited the level.`,
      entityIndex: self.index,
      entityClassname: self.classname,
      otherIndex: activator.index,
      otherClassname: activator.classname
    });
  }

  if (self.map?.includes("*")) {
    runtime.serverflags &= ~SFL_CROSS_TRIGGER_MASK;
  }

  BeginIntermission(self, runtime);
}

/**
 * Original name: SP_target_changelevel
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Requires a `map` key, preserving the original warning/free path when it is absent.
 * - Preserves the `fact1` to `fact3$secret1` map hack, installs `use_target_changelevel`,
 *   and hides the trigger entity from client snapshots with `SVF_NOCLIENT`.
 */
export function SP_target_changelevel(ent: GameEntity, runtime: GameRuntime): void {
  if (!ent.map) {
    runtime.log({
      kind: "warning",
      message: `target_changelevel with no map at ${vtos(ent.s.origin)}`,
      entityIndex: ent.index,
      entityClassname: ent.classname
    });
    freeGameEntity(runtime, ent);
    return;
  }

  if (stringsEqualIgnoreCase(runtime.mapname, "fact1") && stringsEqualIgnoreCase(ent.map, "fact3")) {
    ent.map = "fact3$secret1";
  }

  ent.use = use_target_changelevel;
  ent.svflags = SVF_NOCLIENT;
}

/**
 * Original name: use_target_splash
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits a `TE_SPLASH` temp entity with the configured particle count, origin, movedir and splash sound/color type.
 * - Applies optional `MOD_SPLASH` radius damage with the original `dmg + 40` radius.
 *
 * Porting notes:
 * - Runtime temp-entity events preserve the original `gi.Write*`/`MULTICAST_PVS` payload until `G_RunFrame` flushes them.
 * - The attacker falls back to the splash entity if the callback activator is null.
 */
export function use_target_splash(self: GameEntity, _other: GameEntity | null, activator: GameEntity | null, runtime: GameRuntime): void {
  emitGameTempEntity(runtime, temp_event_t.TE_SPLASH, self.s.origin, multicast_t.MULTICAST_PVS, {
    count: self.count,
    dir: [...self.movedir],
    sounds: self.sounds
  });

  if (self.dmg) {
    T_RadiusDamage(self, activator ?? self, self.dmg, null, self.dmg + 40, MOD_SPLASH, runtime);
  }
}

/**
 * Original name: SP_target_splash
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Installs `use_target_splash`, converts `s.angles` to `movedir`, defaults a missing count to 32 and hides the entity from clients.
 */
export function SP_target_splash(self: GameEntity, _runtime: GameRuntime): void {
  self.use = use_target_splash;
  G_SetMovedir(self.s.angles, self.movedir);

  if (!self.count) {
    self.count = 32;
  }
  self.svflags = SVF_NOCLIENT;
}

/**
 * Original name: use_target_spawner
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Allocates one edict, assigns the requested target classname, copies the spawner origin and angles,
 *   calls the normal spawn dispatcher, then telefrags/link-refreshes the spawned entity.
 * - Applies the precomputed launch velocity when the spawner has a non-zero speed.
 *
 * Porting notes:
 * - Uses an empty classname when the original `self->target` is null so `ED_CallSpawn` takes its
 *   `NULL classname` warning branch instead of silently treating it as `noclass`.
 */
export function use_target_spawner(self: GameEntity, _other: GameEntity | null, _activator: GameEntity | null, runtime: GameRuntime): void {
  const ent = G_Spawn(runtime);
  ent.classname = self.target ?? "";
  ent.s.origin = [...self.s.origin];
  ent.origin = [...self.s.origin];
  ent.s.angles = [...self.s.angles];
  ent.angles = [...self.s.angles];
  ED_CallSpawn(ent, runtime);
  if (ent.inuse) {
    // The original unlinks before KillBox. In this runtime, spawn links may be absent or already fresh.
    KillBox(runtime, ent);
    linkGameEntity(runtime, ent);
    if (self.speed) {
      ent.velocity = [...self.movedir];
    }
  }
}

/**
 * Original name: SP_target_spawner
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Installs `use_target_spawner`, hides the controller entity from clients, and precomputes a
 *   scaled movedir vector from `s.angles` when `speed` is provided for launched gibs.
 */
export function SP_target_spawner(self: GameEntity, _runtime: GameRuntime): void {
  self.use = use_target_spawner;
  self.svflags = SVF_NOCLIENT;
  if (self.speed) {
    G_SetMovedir(self.s.angles, self.movedir);
    self.movedir = scaleVec3(self.movedir, self.speed);
  }
}

/**
 * Original name: use_target_blaster
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Computes the original local `effect`, fires a blaster bolt from `s.origin` along `movedir`,
 *   and plays the target blaster sound.
 *
 * Porting notes:
 * - The C source computes `effect` from `NOTRAIL` / `NOEFFECTS` but still passes `EF_BLASTER`
 *   and a truthy final argument to `fire_blaster`; this preserves that behavior exactly.
 */
export function use_target_blaster(self: GameEntity, _other: GameEntity | null, _activator: GameEntity | null, runtime: GameRuntime): void {
  const effect = (self.spawnflags & 2) !== 0 ? 0 : ((self.spawnflags & 1) !== 0 ? EF_HYPERBLASTER : EF_BLASTER);
  void effect;
  fire_blaster(self, self.s.origin, self.movedir, self.dmg, self.speed, EF_BLASTER, true, runtime);
  emitRegisteredSound(runtime, self, self.noise_index, {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
}

/**
 * Original name: SP_target_blaster
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Installs `use_target_blaster`, derives `movedir` from `s.angles`, registers the fire sound,
 *   applies default damage and speed, and hides the controller entity from clients.
 */
export function SP_target_blaster(self: GameEntity, runtime: GameRuntime): void {
  self.use = use_target_blaster;
  G_SetMovedir(self.s.angles, self.movedir);
  self.noise_index = registerGameSound(runtime, "weapons/laser2.wav");

  if (!self.dmg) {
    self.dmg = 15;
  }
  if (!self.speed) {
    self.speed = 1000;
  }
  self.svflags = SVF_NOCLIENT;
}

/**
 * Original name: trigger_crosslevel_trigger_use
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - ORs this cross-level trigger's spawnflag bits into the persistent game serverflags, then frees
 *   the single-use trigger entity.
 *
 * Porting notes:
 * - Uses `runtime.serverflags` for the original `game.serverflags` field persisted by the save layer.
 */
export function trigger_crosslevel_trigger_use(self: GameEntity, _other: GameEntity | null, _activator: GameEntity | null, runtime: GameRuntime): void {
  runtime.serverflags |= self.spawnflags;
  freeGameEntity(runtime, self);
}

/**
 * Original name: SP_target_crosslevel_trigger
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Hides the controller entity from client snapshots and installs `trigger_crosslevel_trigger_use`.
 */
export function SP_target_crosslevel_trigger(self: GameEntity, _runtime: GameRuntime): void {
  self.svflags = SVF_NOCLIENT;
  self.use = trigger_crosslevel_trigger_use;
}

/**
 * Original name: target_crosslevel_target_think
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Checks whether every requested cross-level trigger bit is present in the persistent serverflags.
 * - When all requested bits match, fires this entity's targets with itself as activator, then frees it.
 *
 * Porting notes:
 * - Uses `runtime.serverflags` for the original `game.serverflags` field, masked by
 *   `SFL_CROSS_TRIGGER_MASK` exactly like the C condition.
 */
export function target_crosslevel_target_think(self: GameEntity, runtime: GameRuntime): void {
  if (self.spawnflags === (runtime.serverflags & SFL_CROSS_TRIGGER_MASK & self.spawnflags)) {
    G_UseTargets(runtime, self, self);
    freeGameEntity(runtime, self);
  }
}

/**
 * Original name: SP_target_crosslevel_target
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Defaults `delay` to 1 second, hides the controller from clients, and schedules
 *   `target_crosslevel_target_think` at `level.time + delay`.
 */
export function SP_target_crosslevel_target(self: GameEntity, runtime: GameRuntime): void {
  if (!self.delay) {
    self.delay = 1;
  }
  self.svflags = SVF_NOCLIENT;
  self.think = target_crosslevel_target_think;
  self.nextthink = runtime.time + self.delay;
}

/**
 * Original name: target_laser_think
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Retargets at `enemy` when present, traces the laser beam through damageable actors,
 *   applies energy damage to non-immune hits, emits one `TE_LASER_SPARKS` impact when
 *   the beam endpoint changes, stores the beam endpoint in `s.old_origin`, and schedules
 *   the next frame.
 *
 * Porting notes:
 * - Local C variables `ignore`, `tr` and `count` are represented as scoped values; the
 *   spark `count` is intentionally computed before enemy retargeting, matching the C order.
 */
export function target_laser_think(self: GameEntity, runtime: GameRuntime): void {
  const count = (self.spawnflags & TARGET_LASER_SPARKS) !== 0 ? 8 : 4;

  if (self.enemy) {
    const lastMovedir = [...self.movedir] as vec3_t;
    const point = addVec3(self.enemy.absmin, scaleVec3(self.enemy.size, 0.5));
    self.movedir = normalizeVec3(subtractVec3(point, self.s.origin));
    if (!vec3Equal(self.movedir, lastMovedir)) {
      self.spawnflags |= TARGET_LASER_SPARKS;
    }
  }

  let ignore: GameEntity | null = self;
  let start = [...self.s.origin] as vec3_t;
  const end = addVec3(start, scaleVec3(self.movedir, 2048));
  let endpos = [...end] as vec3_t;

  while (runtime.collision) {
    const tr = runtime.collision.trace(start, [0, 0, 0], [0, 0, 0], end, ignore, CONTENTS_SOLID | CONTENTS_MONSTER | CONTENTS_DEADMONSTER);
    endpos = [...tr.endpos];
    const hit = tr.ent as GameEntity | null;
    if (!hit) {
      break;
    }

    if (hit.takedamage && (hit.flags & FL_IMMUNE_LASER) === 0) {
      T_Damage(hit, self, self.activator ?? self, self.movedir, tr.endpos, vec3_origin, self.dmg, 1, DAMAGE_ENERGY, MOD_TARGET_LASER, runtime);
    }

    if ((hit.svflags & SVF_MONSTER) === 0 && !hit.client) {
      if ((self.spawnflags & TARGET_LASER_SPARKS) !== 0) {
        self.spawnflags &= ~TARGET_LASER_SPARKS;
        emitGameTempEntity(runtime, temp_event_t.TE_LASER_SPARKS, tr.endpos, multicast_t.MULTICAST_PVS, {
          count,
          dir: [...tr.plane.normal],
          color: self.s.skinnum
        });
      }
      break;
    }

    ignore = hit;
    start = [...tr.endpos];
  }

  self.s.old_origin = [...endpos];
  self.nextthink = runtime.time + FRAMETIME;
}

/**
 * Original name: target_laser_on
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Ensures an activator exists, marks the laser as active/sparking,
 *   makes the beam server-visible, then immediately runs the laser think.
 * Porting notes: The C bitmask `0x80000001` is represented by the spark and
 *   start-on constants.
 */
export function target_laser_on(self: GameEntity, runtime: GameRuntime): void {
  if (!self.activator) {
    self.activator = self;
  }
  self.spawnflags |= TARGET_LASER_SPARKS | TARGET_LASER_START_ON;
  self.svflags &= ~SVF_NOCLIENT;
  target_laser_think(self, runtime);
}

/**
 * Original name: target_laser_off
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Clears only the active/start-on bit, hides the laser entity from
 *   clients with `SVF_NOCLIENT`, and cancels the pending think.
 */
export function target_laser_off(self: GameEntity, _runtime: GameRuntime): void {
  self.spawnflags &= ~TARGET_LASER_START_ON;
  self.svflags |= SVF_NOCLIENT;
  self.nextthink = 0;
}

/**
 * Original name: target_laser_use
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Records the triggering activator and toggles the laser through
 *   `target_laser_on` or `target_laser_off` based on the active bit.
 */
export function target_laser_use(self: GameEntity, _other: GameEntity | null, activator: GameEntity | null, runtime: GameRuntime): void {
  self.activator = activator;
  if ((self.spawnflags & TARGET_LASER_START_ON) !== 0) {
    target_laser_off(self, runtime);
  } else {
    target_laser_on(self, runtime);
  }
}

/**
 * Original name: target_laser_start
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Finalizes the delayed laser spawn by configuring the beam entity,
 *   resolving an optional target entity or editor movedir, installing the use
 *   and think callbacks, linking the entity, and starting it on or off.
 * Porting notes: The local C `ent` is represented by a scoped `const ent` from
 *   `G_Find`; runtime warning logs replace `gi.dprintf`.
 */
export function target_laser_start(self: GameEntity, runtime: GameRuntime): void {
  self.movetype = MOVETYPE_NONE;
  self.solid = SOLID_NOT;
  self.s.renderfx |= RF_BEAM | RF_TRANSLUCENT;
  self.s.modelindex = 1;
  self.s.frame = (self.spawnflags & TARGET_LASER_FAT) !== 0 ? 16 : 4;

  if ((self.spawnflags & TARGET_LASER_RED) !== 0) {
    self.s.skinnum = 0xf2f2f0f0;
  } else if ((self.spawnflags & TARGET_LASER_GREEN) !== 0) {
    self.s.skinnum = 0xd0d1d2d3;
  } else if ((self.spawnflags & TARGET_LASER_BLUE) !== 0) {
    self.s.skinnum = 0xf3f3f1f1;
  } else if ((self.spawnflags & TARGET_LASER_YELLOW) !== 0) {
    self.s.skinnum = 0xdcdddedf;
  } else if ((self.spawnflags & TARGET_LASER_ORANGE) !== 0) {
    self.s.skinnum = 0xe0e1e2e3;
  }

  if (!self.enemy) {
    if (self.target) {
      const ent = G_Find(runtime, null, "targetname", self.target);
      if (!ent) {
        runtime.log({
          kind: "warning",
          message: `${self.classname} at ${vtos(self.s.origin)}: ${self.target} is a bad target`,
          entityIndex: self.index,
          entityClassname: self.classname
        });
      }
      self.enemy = ent;
    } else {
      G_SetMovedir(self.s.angles, self.movedir);
    }
  }

  self.use = target_laser_use;
  self.think = target_laser_think;
  if (!self.dmg) {
    self.dmg = 1;
  }
  self.mins = [-8, -8, -8];
  self.maxs = [8, 8, 8];
  linkGameEntity(runtime, self);

  if ((self.spawnflags & TARGET_LASER_START_ON) !== 0) {
    target_laser_on(self, runtime);
  } else {
    target_laser_off(self, runtime);
  }
}

/**
 * Original name: SP_target_laser
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Defers laser initialization for one second so all map entities can
 *   spawn before the laser resolves its optional target.
 */
export function SP_target_laser(self: GameEntity, runtime: GameRuntime): void {
  self.think = target_laser_start;
  self.nextthink = runtime.time + 1;
}

/**
 * Original name: target_lightramp_think
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Writes the next single-character `CS_LIGHTS` style for the targeted
 *   light, reschedules while the ramp is in progress, and swaps direction for
 *   toggle ramps when the ramp completes.
 *
 * Porting notes:
 * - The C locals `style[2]` and `temp` map to a one-character string and a
 *   block-local swap variable.
 * - A defensive missing-enemy guard is retained; normal runtime use resolves
 *   the light target before invoking this think callback.
 */
export function target_lightramp_think(self: GameEntity, runtime: GameRuntime): void {
  if (!self.enemy) {
    return;
  }

  const lightLevel = Math.trunc(self.movedir[0] + ((runtime.time - self.timestamp) / FRAMETIME) * self.movedir[2]);
  setGameConfigstring(runtime, CS_LIGHTS + self.enemy.style, String.fromCharCode("a".charCodeAt(0) + lightLevel));

  if ((runtime.time - self.timestamp) < self.speed) {
    self.nextthink = runtime.time + FRAMETIME;
  } else if ((self.spawnflags & 1) !== 0) {
    const temp = self.movedir[0];
    self.movedir[0] = self.movedir[1];
    self.movedir[1] = temp;
    self.movedir[2] *= -1;
  }
}

/**
 * Original name: target_lightramp_use
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Lazily resolves the targeted `light`, warning for matching non-light
 *   entities and freeing the ramp if no light is found.
 * - Starts the ramp at the current game time and immediately emits the first
 *   lightstyle update through `target_lightramp_think`.
 *
 * Porting notes:
 * - The C local `e` maps to the loop-local `let e` used by `G_Find`.
 */
export function target_lightramp_use(self: GameEntity, _other: GameEntity | null, _activator: GameEntity | null, runtime: GameRuntime): void {
  if (!self.enemy) {
    let e: GameEntity | null = null;
    while ((e = G_Find(runtime, e, "targetname", self.target ?? "")) !== null) {
      if (e.classname !== "light") {
        runtime.log({
          kind: "warning",
          message: `${self.classname} target ${self.target} (${e.classname} at ${vtos(e.s.origin)}) is not a light`,
          entityIndex: self.index,
          entityClassname: self.classname,
          otherIndex: e.index,
          otherClassname: e.classname
        });
      } else {
        self.enemy = e;
      }
    }

    if (!self.enemy) {
      runtime.log({
        kind: "warning",
        message: `${self.classname} target ${self.target} not found at ${vtos(self.s.origin)}`,
        entityIndex: self.index,
        entityClassname: self.classname
      });
      freeGameEntity(runtime, self);
      return;
    }
  }

  self.timestamp = runtime.time;
  target_lightramp_think(self, runtime);
}

/**
 * Original name: SP_target_lightramp
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Rejects invalid two-letter ramps, deathmatch ramps, and ramps without a
 *   target, freeing the entity like the original spawn function.
 * - Installs the use/think callbacks, hides the controller from clients, and
 *   derives the per-frame lightstyle delta from `message` and `speed`.
 */
export function SP_target_lightramp(self: GameEntity, runtime: GameRuntime): void {
  if (!self.message || self.message.length !== 2 || !isLowercaseLetter(self.message[0]) || !isLowercaseLetter(self.message[1]) || self.message[0] === self.message[1]) {
    runtime.log({
      kind: "warning",
      message: `target_lightramp has bad ramp (${self.message ?? ""}) at ${vtos(self.s.origin)}`,
      entityIndex: self.index,
      entityClassname: self.classname
    });
    freeGameEntity(runtime, self);
    return;
  }

  if (runtime.deathmatch) {
    freeGameEntity(runtime, self);
    return;
  }

  if (!self.target) {
    runtime.log({
      kind: "warning",
      message: `${self.classname} with no target at ${vtos(self.s.origin)}`,
      entityIndex: self.index,
      entityClassname: self.classname
    });
    freeGameEntity(runtime, self);
    return;
  }

  self.svflags |= SVF_NOCLIENT;
  self.use = target_lightramp_use;
  self.think = target_lightramp_think;
  self.movedir[0] = self.message.charCodeAt(0) - "a".charCodeAt(0);
  self.movedir[1] = self.message.charCodeAt(1) - "a".charCodeAt(0);
  self.movedir[2] = (self.movedir[1] - self.movedir[0]) / (self.speed / FRAMETIME);
}

/**
 * Original name: target_earthquake_think
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Plays the quake sound every half-second while the quake is active, shakes every in-use grounded client entity, and reschedules itself at `FRAMETIME` until `timestamp`.
 *
 * Porting notes:
 * - The C locals `i` and `e` are represented by the indexed `for` loop and per-iteration `const e`.
 */
export function target_earthquake_think(self: GameEntity, runtime: GameRuntime): void {
  if (self.last_move_time < runtime.time) {
    emitRegisteredSound(runtime, self, self.noise_index, {
      origin: self.s.origin,
      channel: CHAN_AUTO,
      volume: 1,
      attenuation: ATTN_NONE,
      timeofs: 0
    });
    self.last_move_time = runtime.time + 0.5;
  }

  for (let i = 1; i < runtime.entities.length; i += 1) {
    const e = runtime.entities[i];
    if (!e.inuse || !e.client || !e.groundentity) {
      continue;
    }
    e.groundentity = null;
    e.velocity[0] += crandom() * 150;
    e.velocity[1] += crandom() * 150;
    e.velocity[2] = self.speed * (100.0 / e.mass);
  }

  if (runtime.time < self.timestamp) {
    self.nextthink = runtime.time + FRAMETIME;
  }
}

/**
 * Original name: target_earthquake_use
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Starts an earthquake by recording its end timestamp, scheduling the first think,
 * preserving the activator and resetting the sound cadence.
 * Porting notes: The unused C `other` callback argument is kept as `_other` to preserve the
 * target/use callback shape.
 */
export function target_earthquake_use(self: GameEntity, _other: GameEntity | null, activator: GameEntity | null, runtime: GameRuntime): void {
  self.timestamp = runtime.time + self.count;
  self.nextthink = runtime.time + FRAMETIME;
  self.activator = activator;
  self.last_move_time = 0;
}

/**
 * Original name: SP_target_earthquake
 * Source: game/g_target.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Initializes an invisible earthquake target with default duration/speed, installs the
 * think/use callbacks and precaches `world/quake.wav`.
 * Porting notes: `gi.dprintf` is represented by a warning log entry with the same trigger
 * condition as the C source.
 */
export function SP_target_earthquake(self: GameEntity, runtime: GameRuntime): void {
  if (!self.targetname) {
    runtime.log({
      kind: "warning",
      message: `untargeted ${self.classname} at ${vtos(self.s.origin)}`,
      entityIndex: self.index,
      entityClassname: self.classname
    });
  }

  if (!self.count) {
    self.count = 5;
  }
  if (!self.speed) {
    self.speed = 200;
  }

  self.svflags |= SVF_NOCLIENT;
  self.think = target_earthquake_think;
  self.use = target_earthquake_use;
  self.noise_index = registerGameSound(runtime, "world/quake.wav");
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Fidelity level: Adapter
 *
 * Purpose:
 * - Bridges registered sound indices to structured runtime sound events.
 */
function emitRegisteredSound(
  runtime: GameRuntime,
  entity: GameEntity,
  soundIndex: number,
  options: {
    origin?: vec3_t | null;
    channel?: number;
    volume?: number;
    attenuation?: number;
    timeofs?: number;
  } = {}
): void {
  const soundPath = runtime.assets.soundPaths[soundIndex - 1];
  if (soundPath) {
    emitRegisteredGameSound(runtime, entity, soundIndex, soundPath, options);
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose:
 * - Keeps local map-hack comparisons routed through the ported `Q_stricmp`.
 */
function stringsEqualIgnoreCase(left: string, right: string): boolean {
  return Q_stricmp(left, right) === 0;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose:
 * - Expresses the original `message[i] >= 'a' && message[i] <= 'z'` ramp validation.
 */
function isLowercaseLetter(value: string): boolean {
  return value >= "a" && value <= "z";
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose:
 * - Applies explicit C-style bounded string copies for local target fields.
 */
function truncateCString(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose:
 * - Provides local vector comparison for the target_laser retargeting branch.
 */
function vec3Equal(left: vec3_t, right: vec3_t): boolean {
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose:
 * - Provides local vector addition for target entity math.
 */
function addVec3(left: vec3_t, right: vec3_t): vec3_t {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose:
 * - Provides local vector subtraction for target entity math.
 */
function subtractVec3(left: vec3_t, right: vec3_t): vec3_t {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose:
 * - Provides local vector scaling for target entity math.
 */
function scaleVec3(vector: vec3_t, scalar: number): vec3_t {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Fidelity level: Close
 *
 * Purpose:
 * - Provides local vector normalization for target_laser tracking.
 */
function normalizeVec3(vector: vec3_t): vec3_t {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length === 0) {
    return [0, 0, 0];
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}
