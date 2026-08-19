/**
 * File: m_parasite.ts
 * Source: Quake II original / game/m_parasite.h and game/m_parasite.c
 * Purpose: Port of the generated parasite model frame constants and monster_parasite gameplay behavior.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses the explicit gameplay runtime and structured temp-entity event queue instead of `gi.*` writes.
 *
 * Notes:
 * - This file keeps the header constants and C behavior together as the principal attachment point for `m_parasite`.
 */

import {
  AngleVectors,
  ATTN_IDLE,
  ATTN_NORM,
  CHAN_AUTO,
  CHAN_VOICE,
  CHAN_WEAPON,
  MASK_SHOT,
  PITCH,
  multicast_t,
  temp_event_t,
  type vec3_t
} from "../../qcommon/src/index.js";
import {
  AI_STAND_GROUND,
  DEAD_DEAD,
  DAMAGE_NO_KNOCKBACK,
  GIB_ORGANIC,
  MOD_UNKNOWN,
  MOVETYPE_STEP,
  MOVETYPE_TOSS,
  random,
  SOLID_BBOX,
  SVF_DEADMONSTER,
  damage_t
} from "./g_local.js";
import { ai_charge, ai_move, ai_run, ai_stand, ai_walk } from "./g_ai.js";
import { T_Damage } from "./g_combat.js";
import { walkmonster_start } from "./g_monster.js";
import { ThrowGib, ThrowHead } from "./g_misc.js";
import { G_FreeEdict, G_ProjectSource, vectoangles } from "./g_utils.js";
import {
  emitGameSound,
  emitGameTempEntity,
  emitRegisteredGameSound,
  linkGameEntity,
  registerGameModel,
  registerGameSound,
  type GameEntity,
  type GameMonsterFrame,
  type GameMonsterMove,
  type GameRuntime
} from "./runtime.js";

export const FRAME_break01 = 0;
export const FRAME_break02 = 1;
export const FRAME_break03 = 2;
export const FRAME_break04 = 3;
export const FRAME_break05 = 4;
export const FRAME_break06 = 5;
export const FRAME_break07 = 6;
export const FRAME_break08 = 7;
export const FRAME_break09 = 8;
export const FRAME_break10 = 9;
export const FRAME_break11 = 10;
export const FRAME_break12 = 11;
export const FRAME_break13 = 12;
export const FRAME_break14 = 13;
export const FRAME_break15 = 14;
export const FRAME_break16 = 15;
export const FRAME_break17 = 16;
export const FRAME_break18 = 17;
export const FRAME_break19 = 18;
export const FRAME_break20 = 19;
export const FRAME_break21 = 20;
export const FRAME_break22 = 21;
export const FRAME_break23 = 22;
export const FRAME_break24 = 23;
export const FRAME_break25 = 24;
export const FRAME_break26 = 25;
export const FRAME_break27 = 26;
export const FRAME_break28 = 27;
export const FRAME_break29 = 28;
export const FRAME_break30 = 29;
export const FRAME_break31 = 30;
export const FRAME_break32 = 31;
export const FRAME_death101 = 32;
export const FRAME_death102 = 33;
export const FRAME_death103 = 34;
export const FRAME_death104 = 35;
export const FRAME_death105 = 36;
export const FRAME_death106 = 37;
export const FRAME_death107 = 38;
export const FRAME_drain01 = 39;
export const FRAME_drain02 = 40;
export const FRAME_drain03 = 41;
export const FRAME_drain04 = 42;
export const FRAME_drain05 = 43;
export const FRAME_drain06 = 44;
export const FRAME_drain07 = 45;
export const FRAME_drain08 = 46;
export const FRAME_drain09 = 47;
export const FRAME_drain10 = 48;
export const FRAME_drain11 = 49;
export const FRAME_drain12 = 50;
export const FRAME_drain13 = 51;
export const FRAME_drain14 = 52;
export const FRAME_drain15 = 53;
export const FRAME_drain16 = 54;
export const FRAME_drain17 = 55;
export const FRAME_drain18 = 56;
export const FRAME_pain101 = 57;
export const FRAME_pain102 = 58;
export const FRAME_pain103 = 59;
export const FRAME_pain104 = 60;
export const FRAME_pain105 = 61;
export const FRAME_pain106 = 62;
export const FRAME_pain107 = 63;
export const FRAME_pain108 = 64;
export const FRAME_pain109 = 65;
export const FRAME_pain110 = 66;
export const FRAME_pain111 = 67;
export const FRAME_run01 = 68;
export const FRAME_run02 = 69;
export const FRAME_run03 = 70;
export const FRAME_run04 = 71;
export const FRAME_run05 = 72;
export const FRAME_run06 = 73;
export const FRAME_run07 = 74;
export const FRAME_run08 = 75;
export const FRAME_run09 = 76;
export const FRAME_run10 = 77;
export const FRAME_run11 = 78;
export const FRAME_run12 = 79;
export const FRAME_run13 = 80;
export const FRAME_run14 = 81;
export const FRAME_run15 = 82;
export const FRAME_stand01 = 83;
export const FRAME_stand02 = 84;
export const FRAME_stand03 = 85;
export const FRAME_stand04 = 86;
export const FRAME_stand05 = 87;
export const FRAME_stand06 = 88;
export const FRAME_stand07 = 89;
export const FRAME_stand08 = 90;
export const FRAME_stand09 = 91;
export const FRAME_stand10 = 92;
export const FRAME_stand11 = 93;
export const FRAME_stand12 = 94;
export const FRAME_stand13 = 95;
export const FRAME_stand14 = 96;
export const FRAME_stand15 = 97;
export const FRAME_stand16 = 98;
export const FRAME_stand17 = 99;
export const FRAME_stand18 = 100;
export const FRAME_stand19 = 101;
export const FRAME_stand20 = 102;
export const FRAME_stand21 = 103;
export const FRAME_stand22 = 104;
export const FRAME_stand23 = 105;
export const FRAME_stand24 = 106;
export const FRAME_stand25 = 107;
export const FRAME_stand26 = 108;
export const FRAME_stand27 = 109;
export const FRAME_stand28 = 110;
export const FRAME_stand29 = 111;
export const FRAME_stand30 = 112;
export const FRAME_stand31 = 113;
export const FRAME_stand32 = 114;
export const FRAME_stand33 = 115;
export const FRAME_stand34 = 116;
export const FRAME_stand35 = 117;

export const MODEL_SCALE = 1.0;

const SOUND_PAIN1 = "parasite/parpain1.wav";
const SOUND_PAIN2 = "parasite/parpain2.wav";
const SOUND_DIE = "parasite/pardeth1.wav";
const SOUND_LAUNCH = "parasite/paratck1.wav";
const SOUND_IMPACT = "parasite/paratck2.wav";
const SOUND_SUCK = "parasite/paratck3.wav";
const SOUND_REELIN = "parasite/paratck4.wav";
const SOUND_SIGHT = "parasite/parsght1.wav";
const SOUND_TAP = "parasite/paridle1.wav";
const SOUND_SCRATCH = "parasite/paridle2.wav";
const SOUND_SEARCH = "parasite/parsrch1.wav";

/**
 * Original name: N/A
 * Source: N/A (runtime sound cache)
 * Category: New
 */
let sound_pain1 = 0;
/**
 * Original name: N/A
 * Source: N/A (runtime sound cache)
 * Category: New
 */
let sound_pain2 = 0;
/**
 * Original name: N/A
 * Source: N/A (runtime sound cache)
 * Category: New
 */
let sound_die = 0;
/**
 * Original name: N/A
 * Source: N/A (runtime sound cache)
 * Category: New
 */
let sound_launch = 0;
/**
 * Original name: N/A
 * Source: N/A (runtime sound cache)
 * Category: New
 */
let sound_impact = 0;
/**
 * Original name: N/A
 * Source: N/A (runtime sound cache)
 * Category: New
 */
let sound_suck = 0;
/**
 * Original name: N/A
 * Source: N/A (runtime sound cache)
 * Category: New
 */
let sound_reelin = 0;
/**
 * Original name: N/A
 * Source: N/A (runtime sound cache)
 * Category: New
 */
let sound_sight = 0;
/**
 * Original name: N/A
 * Source: N/A (runtime sound cache)
 * Category: New
 */
let sound_tap = 0;
/**
 * Original name: N/A
 * Source: N/A (runtime sound cache)
 * Category: New
 */
let sound_scratch = 0;
/**
 * Original name: N/A
 * Source: N/A (runtime sound cache)
 * Category: New
 */
let sound_search = 0;

/**
 * Original name: parasite_launch
 * Source: game/m_parasite.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Plays the parasite launch sound on `CHAN_WEAPON` with normal attenuation.
 */
export function parasite_launch(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_launch, SOUND_LAUNCH, { channel: CHAN_WEAPON, volume: 1, attenuation: ATTN_NORM, timeofs: 0 });
}

/**
 * Original name: parasite_reel_in
 * Source: game/m_parasite.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Plays the parasite reel-in sound on `CHAN_WEAPON` with normal attenuation.
 */
export function parasite_reel_in(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_reelin, SOUND_REELIN, { channel: CHAN_WEAPON, volume: 1, attenuation: ATTN_NORM, timeofs: 0 });
}

/**
 * Original name: parasite_sight
 * Source: game/m_parasite.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Plays the sight sound when the monster sight callback fires.
 */
export function parasite_sight(self: GameEntity, _other: GameEntity | null, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_sight, SOUND_SIGHT, { channel: CHAN_WEAPON, volume: 1, attenuation: ATTN_NORM, timeofs: 0 });
}

/**
 * Original name: parasite_tap
 * Source: game/m_parasite.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Plays the idle tap sound on the weapon channel with idle attenuation.
 */
export function parasite_tap(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_tap, SOUND_TAP, { channel: CHAN_WEAPON, volume: 1, attenuation: ATTN_IDLE, timeofs: 0 });
}

/**
 * Original name: parasite_scratch
 * Source: game/m_parasite.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Plays the idle scratch sound on the weapon channel with idle attenuation.
 */
export function parasite_scratch(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_scratch, SOUND_SCRATCH, { channel: CHAN_WEAPON, volume: 1, attenuation: ATTN_IDLE, timeofs: 0 });
}

/**
 * Original name: parasite_search
 * Source: game/m_parasite.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Plays the parasite search sound on the weapon channel with idle attenuation.
 */
export function parasite_search(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_search, SOUND_SEARCH, { channel: CHAN_WEAPON, volume: 1, attenuation: ATTN_IDLE, timeofs: 0 });
}

const parasite_frames_start_fidget = makeFrames(ai_stand, [0, 0, 0, 0]);
export const parasite_move_start_fidget: GameMonsterMove = {
  firstframe: FRAME_stand18,
  lastframe: FRAME_stand21,
  frame: parasite_frames_start_fidget,
  endfunc: parasite_do_fidget
};

const parasite_frames_fidget = makeFrames(ai_stand, [0, 0, 0, 0, 0, 0], indexedThinks(6, [[0, parasite_scratch], [3, parasite_scratch]]));
export const parasite_move_fidget: GameMonsterMove = {
  firstframe: FRAME_stand22,
  lastframe: FRAME_stand27,
  frame: parasite_frames_fidget,
  endfunc: parasite_refidget
};

const parasite_frames_end_fidget = makeFrames(ai_stand, [0, 0, 0, 0, 0, 0, 0, 0], indexedThinks(8, [[0, parasite_scratch]]));
export const parasite_move_end_fidget: GameMonsterMove = {
  firstframe: FRAME_stand28,
  lastframe: FRAME_stand35,
  frame: parasite_frames_end_fidget,
  endfunc: parasite_stand
};

/**
 * Original name: parasite_end_fidget
 * Source: game/m_parasite.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Switches the monster to the end-fidget move table.
 */
export function parasite_end_fidget(self: GameEntity): void {
  self.monsterinfo.currentmove = parasite_move_end_fidget;
}

/**
 * Original name: parasite_do_fidget
 * Source: game/m_parasite.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Switches the monster to the fidget loop move table.
 */
export function parasite_do_fidget(self: GameEntity): void {
  self.monsterinfo.currentmove = parasite_move_fidget;
}

/**
 * Original name: parasite_refidget
 * Source: game/m_parasite.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Repeats the fidget loop when the original `random() <= 0.8` macro test passes.
 */
export function parasite_refidget(self: GameEntity): void {
  if (random() <= 0.8) {
    self.monsterinfo.currentmove = parasite_move_fidget;
  } else {
    self.monsterinfo.currentmove = parasite_move_end_fidget;
  }
}

/**
 * Original name: parasite_idle
 * Source: game/m_parasite.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Starts the parasite fidget sequence from the idle callback.
 */
export function parasite_idle(self: GameEntity): void {
  self.monsterinfo.currentmove = parasite_move_start_fidget;
}

const parasite_frames_stand = makeFrames(
  ai_stand,
  new Array<number>(17).fill(0),
  indexedThinks(17, [[2, parasite_tap], [4, parasite_tap], [8, parasite_tap], [10, parasite_tap], [14, parasite_tap], [16, parasite_tap]])
);
export const parasite_move_stand: GameMonsterMove = {
  firstframe: FRAME_stand01,
  lastframe: FRAME_stand17,
  frame: parasite_frames_stand,
  endfunc: parasite_stand
};

/**
 * Original name: parasite_stand
 * Source: game/m_parasite.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Switches the monster to its looping stand move.
 */
export function parasite_stand(self: GameEntity): void {
  self.monsterinfo.currentmove = parasite_move_stand;
}

const parasite_frames_run = makeFrames(ai_run, [30, 30, 22, 19, 24, 28, 25]);
export const parasite_move_run: GameMonsterMove = {
  firstframe: FRAME_run03,
  lastframe: FRAME_run09,
  frame: parasite_frames_run,
  endfunc: undefined
};

const parasite_frames_start_run = makeFrames(ai_run, [0, 30]);
export const parasite_move_start_run: GameMonsterMove = {
  firstframe: FRAME_run01,
  lastframe: FRAME_run02,
  frame: parasite_frames_start_run,
  endfunc: parasite_run
};

const parasite_frames_stop_run = makeFrames(ai_run, [20, 20, 12, 10, 0, 0]);
export const parasite_move_stop_run: GameMonsterMove = {
  firstframe: FRAME_run10,
  lastframe: FRAME_run15,
  frame: parasite_frames_stop_run,
  endfunc: undefined
};

/**
 * Original name: parasite_start_run
 * Source: game/m_parasite.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Starts the run transition unless `AI_STAND_GROUND` forces the stand move.
 */
export function parasite_start_run(self: GameEntity): void {
  if ((self.monsterinfo.aiflags & AI_STAND_GROUND) !== 0) {
    self.monsterinfo.currentmove = parasite_move_stand;
  } else {
    self.monsterinfo.currentmove = parasite_move_start_run;
  }
}

/**
 * Original name: parasite_run
 * Source: game/m_parasite.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Switches to the looping run move unless `AI_STAND_GROUND` forces standing.
 */
export function parasite_run(self: GameEntity): void {
  if ((self.monsterinfo.aiflags & AI_STAND_GROUND) !== 0) {
    self.monsterinfo.currentmove = parasite_move_stand;
  } else {
    self.monsterinfo.currentmove = parasite_move_run;
  }
}

const parasite_frames_walk = makeFrames(ai_walk, [30, 30, 22, 19, 24, 28, 25]);
export const parasite_move_walk: GameMonsterMove = {
  firstframe: FRAME_run03,
  lastframe: FRAME_run09,
  frame: parasite_frames_walk,
  endfunc: parasite_walk
};

const parasite_frames_start_walk = makeFrames(ai_walk, [0, 30], indexedThinks(2, [[1, parasite_walk]]));
export const parasite_move_start_walk: GameMonsterMove = {
  firstframe: FRAME_run01,
  lastframe: FRAME_run02,
  frame: parasite_frames_start_walk,
  endfunc: undefined
};

const parasite_frames_stop_walk = makeFrames(ai_walk, [20, 20, 12, 10, 0, 0]);
export const parasite_move_stop_walk: GameMonsterMove = {
  firstframe: FRAME_run10,
  lastframe: FRAME_run15,
  frame: parasite_frames_stop_walk,
  endfunc: undefined
};

/**
 * Original name: parasite_start_walk
 * Source: game/m_parasite.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Starts the walk transition move.
 */
export function parasite_start_walk(self: GameEntity): void {
  self.monsterinfo.currentmove = parasite_move_start_walk;
}

/**
 * Original name: parasite_walk
 * Source: game/m_parasite.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Switches the monster to its looping walk move.
 */
export function parasite_walk(self: GameEntity): void {
  self.monsterinfo.currentmove = parasite_move_walk;
}

const parasite_frames_pain1 = makeFrames(ai_move, [0, 0, 0, 0, 0, 0, 6, 16, -6, -7, 0]);
export const parasite_move_pain1: GameMonsterMove = {
  firstframe: FRAME_pain101,
  lastframe: FRAME_pain111,
  frame: parasite_frames_pain1,
  endfunc: parasite_start_run
};

/**
 * Original name: parasite_pain
 * Source: game/m_parasite.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Applies the skin, debounce and nightmare checks from the C function.
 * - Chooses pain sound 1 or 2 with the original `random() < 0.5` macro threshold.
 */
export function parasite_pain(
  self: GameEntity,
  _other: GameEntity | null,
  _kick: number,
  _damage: number,
  runtime: GameRuntime
): void {
  if (self.health < (self.max_health / 2)) {
    self.s.skinnum = 1;
  }

  if (runtime.time < self.pain_debounce_time) {
    return;
  }

  self.pain_debounce_time = runtime.time + 3;

  if (runtime.skill === 3) {
    return;
  }

  if (random() < 0.5) {
    emitRegisteredGameSound(runtime, self, sound_pain1, SOUND_PAIN1, { channel: CHAN_VOICE, volume: 1, attenuation: ATTN_NORM, timeofs: 0 });
  } else {
    emitRegisteredGameSound(runtime, self, sound_pain2, SOUND_PAIN2, { channel: CHAN_VOICE, volume: 1, attenuation: ATTN_NORM, timeofs: 0 });
  }

  self.monsterinfo.currentmove = parasite_move_pain1;
}

/**
 * Original name: parasite_drain_attack_ok
 * Source: game/m_parasite.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Preserves the original parasite tongue distance and pitch acceptance checks.
 */
export function parasite_drain_attack_ok(start: vec3_t, end: vec3_t): boolean {
  const dir = subtractVec3(start, end);
  if (vec3Length(dir) > 256) {
    return false;
  }

  const angles = vectoangles(dir);
  if (angles[PITCH] < -180) {
    angles[PITCH] += 360;
  }
  if (Math.abs(angles[PITCH]) > 30) {
    return false;
  }

  return true;
}

/**
 * Original name: parasite_drain_attack
 * Source: game/m_parasite.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Projects the attack start point, validates enemy aim points, traces line of sight, emits the parasite temp entity and applies drain damage.
 *
 * Porting notes:
 * - Uses the structured temp-entity queue instead of direct `gi.Write*`/`gi.multicast` calls.
 */
export function parasite_drain_attack(self: GameEntity, runtime: GameRuntime): void {
  if (!self.enemy) {
    return;
  }

  const { forward, right } = AngleVectors(self.s.angles);
  const start = G_ProjectSource(self.s.origin, [24, 0, 6], forward, right);
  let end: vec3_t = [...self.enemy.s.origin];

  if (!parasite_drain_attack_ok(start, end)) {
    end[2] = self.enemy.s.origin[2] + self.enemy.maxs[2] - 8;
    if (!parasite_drain_attack_ok(start, end)) {
      end[2] = self.enemy.s.origin[2] + self.enemy.mins[2] + 8;
      if (!parasite_drain_attack_ok(start, end)) {
        return;
      }
    }
  }

  end = [...self.enemy.s.origin];
  const trace = runtime.collision?.trace(start, [0, 0, 0], [0, 0, 0], end, self, MASK_SHOT);
  if (trace && trace.ent !== self.enemy) {
    return;
  }

  let damage: number;
  if (self.s.frame === FRAME_drain03) {
    damage = 5;
    emitRegisteredGameSound(runtime, self.enemy, sound_impact, SOUND_IMPACT, { channel: CHAN_AUTO, volume: 1, attenuation: ATTN_NORM, timeofs: 0 });
  } else {
    if (self.s.frame === FRAME_drain04) {
      emitRegisteredGameSound(runtime, self, sound_suck, SOUND_SUCK, { channel: CHAN_WEAPON, volume: 1, attenuation: ATTN_NORM, timeofs: 0 });
    }
    damage = 2;
  }

  emitGameTempEntity(runtime, temp_event_t.TE_PARASITE_ATTACK, self.s.origin, multicast_t.MULTICAST_PVS, {
    entityIndex: self.index,
    start: [...start],
    end: [...end]
  });

  T_Damage(self.enemy, self, self, subtractVec3(start, end), self.enemy.s.origin, [0, 0, 0], damage, 0, DAMAGE_NO_KNOCKBACK, MOD_UNKNOWN, runtime);
}

const parasite_frames_drain = makeFrames(
  ai_charge,
  [0, 0, 15, 0, 0, 0, 0, -2, -2, -3, -2, 0, -1, 0, -2, -2, -3, 0],
  indexedThinks(18, [
    [0, parasite_launch],
    [2, parasite_drain_attack],
    [3, parasite_drain_attack],
    [4, parasite_drain_attack],
    [5, parasite_drain_attack],
    [6, parasite_drain_attack],
    [7, parasite_drain_attack],
    [8, parasite_drain_attack],
    [9, parasite_drain_attack],
    [10, parasite_drain_attack],
    [11, parasite_drain_attack],
    [12, parasite_drain_attack],
    [13, parasite_reel_in]
  ])
);
export const parasite_move_drain: GameMonsterMove = {
  firstframe: FRAME_drain01,
  lastframe: FRAME_drain18,
  frame: parasite_frames_drain,
  endfunc: parasite_start_run
};

const parasite_frames_break = makeFrames(
  ai_charge,
  [0, -3, 1, 2, -3, 1, 1, 3, 0, -18, 3, 9, 6, 0, -18, 0, 8, 9, 0, -18, 0, 0, 0, 0, 0, 0, 0, 4, 11, -2, -5, 1]
);
export const parasite_move_break: GameMonsterMove = {
  firstframe: FRAME_break01,
  lastframe: FRAME_break32,
  frame: parasite_frames_break,
  endfunc: parasite_start_run
};

/**
 * Original name: parasite_attack
 * Source: game/m_parasite.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Selects the active parasite attack move; the random break branch remains source-commented in the original.
 */
export function parasite_attack(self: GameEntity): void {
  self.monsterinfo.currentmove = parasite_move_drain;
}

/**
 * Original name: parasite_dead
 * Source: game/m_parasite.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Shrinks the corpse bounds, switches to toss movement, marks the entity as a dead monster and relinks it.
 */
export function parasite_dead(self: GameEntity, runtime: GameRuntime): void {
  setVec3(self.mins, -16, -16, -24);
  setVec3(self.maxs, 16, 16, -8);
  self.movetype = MOVETYPE_TOSS;
  self.svflags |= SVF_DEADMONSTER;
  self.nextthink = 0;
  linkGameEntity(runtime, self);
}

const parasite_frames_death = makeFrames(ai_move, [0, 0, 0, 0, 0, 0, 0]);
export const parasite_move_death: GameMonsterMove = {
  firstframe: FRAME_death101,
  lastframe: FRAME_death107,
  frame: parasite_frames_death,
  endfunc: parasite_dead
};

/**
 * Original name: parasite_die
 * Source: game/m_parasite.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Preserves gib death, repeat-death guard and regular death transition behavior.
 */
export function parasite_die(
  self: GameEntity,
  _inflictor: GameEntity | null,
  _attacker: GameEntity | null,
  damage: number,
  runtime: GameRuntime
): void {
  if (self.health <= self.gib_health) {
    emitGameSound(runtime, self, "misc/udeath.wav");
    for (let n = 0; n < 2; n += 1) {
      ThrowGib(self, "models/objects/gibs/bone/tris.md2", damage, GIB_ORGANIC, runtime);
    }
    for (let n = 0; n < 4; n += 1) {
      ThrowGib(self, "models/objects/gibs/sm_meat/tris.md2", damage, GIB_ORGANIC, runtime);
    }
    ThrowHead(self, "models/objects/gibs/head2/tris.md2", damage, GIB_ORGANIC, runtime);
    self.deadflag = DEAD_DEAD;
    return;
  }

  if (self.deadflag === DEAD_DEAD) {
    return;
  }

  emitRegisteredGameSound(runtime, self, sound_die, SOUND_DIE, { channel: CHAN_VOICE, volume: 1, attenuation: ATTN_NORM, timeofs: 0 });
  self.deadflag = DEAD_DEAD;
  self.takedamage = damage_t.DAMAGE_YES;
  self.monsterinfo.currentmove = parasite_move_death;
}

/**
 * Original name: SP_monster_parasite
 * Source: game/m_parasite.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Precaches parasite assets, initializes bbox/health/callbacks/current move and starts the walking monster runtime.
 */
export function SP_monster_parasite(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  precacheParasiteAssets(runtime);

  self.s.modelindex = registerGameModel(runtime, "models/monsters/parasite/tris.md2");
  setVec3(self.mins, -16, -16, -24);
  setVec3(self.maxs, 16, 16, 24);
  self.movetype = MOVETYPE_STEP;
  self.solid = SOLID_BBOX;

  self.health = 175;
  self.gib_health = -50;
  self.mass = 250;

  self.pain = parasite_pain;
  self.die = parasite_die;

  self.monsterinfo.stand = parasite_stand;
  self.monsterinfo.walk = parasite_start_walk;
  self.monsterinfo.run = parasite_start_run;
  self.monsterinfo.attack = parasite_attack;
  self.monsterinfo.sight = parasite_sight;
  self.monsterinfo.idle = parasite_idle;

  linkGameEntity(runtime, self);

  self.monsterinfo.currentmove = parasite_move_stand;
  self.monsterinfo.scale = MODEL_SCALE;

  walkmonster_start(self, runtime);
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 */
function makeFrames(
  aifunc: GameMonsterFrame["aifunc"],
  distances: number[],
  thinks: GameMonsterFrame["thinkfunc"][] = []
): GameMonsterFrame[] {
  return distances.map((dist, index) => ({
    aifunc,
    dist,
    thinkfunc: thinks[index]
  }));
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 */
function indexedThinks(
  count: number,
  entries: Array<[index: number, thinkfunc: GameMonsterFrame["thinkfunc"]]>
): GameMonsterFrame["thinkfunc"][] {
  const thinks = new Array<GameMonsterFrame["thinkfunc"]>(count).fill(undefined);
  for (const [index, thinkfunc] of entries) {
    thinks[index] = thinkfunc;
  }
  return thinks;
}

/**
 * Original name: N/A
 * Source: N/A (runtime precache helper)
 * Category: New
 */
function precacheParasiteAssets(runtime: GameRuntime): void {
  sound_pain1 = registerGameSound(runtime, SOUND_PAIN1);
  sound_pain2 = registerGameSound(runtime, SOUND_PAIN2);
  sound_die = registerGameSound(runtime, SOUND_DIE);
  sound_launch = registerGameSound(runtime, SOUND_LAUNCH);
  sound_impact = registerGameSound(runtime, SOUND_IMPACT);
  sound_suck = registerGameSound(runtime, SOUND_SUCK);
  sound_reelin = registerGameSound(runtime, SOUND_REELIN);
  sound_sight = registerGameSound(runtime, SOUND_SIGHT);
  sound_tap = registerGameSound(runtime, SOUND_TAP);
  sound_scratch = registerGameSound(runtime, SOUND_SCRATCH);
  sound_search = registerGameSound(runtime, SOUND_SEARCH);
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 */
function setVec3(vector: [number, number, number], x: number, y: number, z: number): void {
  vector[0] = x;
  vector[1] = y;
  vector[2] = z;
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 */
function subtractVec3(left: vec3_t, right: vec3_t): vec3_t {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 */
function vec3Length(vector: vec3_t): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}
