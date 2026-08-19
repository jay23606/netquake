/**
 * File: m_flyer.ts
 * Source: Quake II original / game/m_flyer.h and game/m_flyer.c
 * Purpose: Port of the generated flyer model frame constants and monster_flyer gameplay behavior.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - None.
 *
 * Notes:
 * - This file keeps the header constants and C behavior together as the principal attachment point for `m_flyer`.
 */

import { AngleVectors, ATTN_IDLE, ATTN_NORM, CHAN_VOICE, CHAN_WEAPON, EF_HYPERBLASTER, Q_stricmp, type vec3_t } from "../../qcommon/src/index.js";
import {
  AI_STAND_GROUND,
  MELEE_DISTANCE,
  MOVETYPE_STEP,
  random,
  RANGE_MELEE,
  SOLID_BBOX
} from "./g_local.js";
import { ai_charge, ai_move, ai_run, ai_stand, ai_walk, range } from "./g_ai.js";
import { flymonster_start, monster_fire_blaster } from "./g_monster.js";
import { BecomeExplosion1 } from "./g_misc.js";
import { G_FreeEdict, G_ProjectSource } from "./g_utils.js";
import { getMonsterFlashOffset } from "./m_flash.js";
import { fire_hit } from "./g_weapon.js";
import {
  emitRegisteredGameSound,
  linkGameEntity,
  registerGameModel,
  registerGameSound,
  type GameEntity,
  type GameMonsterFrame,
  type GameMonsterMove,
  type GameRuntime
} from "./runtime.js";

export const ACTION_nothing = 0;
export const ACTION_attack1 = 1;
export const ACTION_attack2 = 2;
export const ACTION_run = 3;
export const ACTION_walk = 4;

export const FRAME_start01 = 0;
export const FRAME_start02 = 1;
export const FRAME_start03 = 2;
export const FRAME_start04 = 3;
export const FRAME_start05 = 4;
export const FRAME_start06 = 5;
export const FRAME_stop01 = 6;
export const FRAME_stop02 = 7;
export const FRAME_stop03 = 8;
export const FRAME_stop04 = 9;
export const FRAME_stop05 = 10;
export const FRAME_stop06 = 11;
export const FRAME_stop07 = 12;
export const FRAME_stand01 = 13;
export const FRAME_stand02 = 14;
export const FRAME_stand03 = 15;
export const FRAME_stand04 = 16;
export const FRAME_stand05 = 17;
export const FRAME_stand06 = 18;
export const FRAME_stand07 = 19;
export const FRAME_stand08 = 20;
export const FRAME_stand09 = 21;
export const FRAME_stand10 = 22;
export const FRAME_stand11 = 23;
export const FRAME_stand12 = 24;
export const FRAME_stand13 = 25;
export const FRAME_stand14 = 26;
export const FRAME_stand15 = 27;
export const FRAME_stand16 = 28;
export const FRAME_stand17 = 29;
export const FRAME_stand18 = 30;
export const FRAME_stand19 = 31;
export const FRAME_stand20 = 32;
export const FRAME_stand21 = 33;
export const FRAME_stand22 = 34;
export const FRAME_stand23 = 35;
export const FRAME_stand24 = 36;
export const FRAME_stand25 = 37;
export const FRAME_stand26 = 38;
export const FRAME_stand27 = 39;
export const FRAME_stand28 = 40;
export const FRAME_stand29 = 41;
export const FRAME_stand30 = 42;
export const FRAME_stand31 = 43;
export const FRAME_stand32 = 44;
export const FRAME_stand33 = 45;
export const FRAME_stand34 = 46;
export const FRAME_stand35 = 47;
export const FRAME_stand36 = 48;
export const FRAME_stand37 = 49;
export const FRAME_stand38 = 50;
export const FRAME_stand39 = 51;
export const FRAME_stand40 = 52;
export const FRAME_stand41 = 53;
export const FRAME_stand42 = 54;
export const FRAME_stand43 = 55;
export const FRAME_stand44 = 56;
export const FRAME_stand45 = 57;
export const FRAME_attak101 = 58;
export const FRAME_attak102 = 59;
export const FRAME_attak103 = 60;
export const FRAME_attak104 = 61;
export const FRAME_attak105 = 62;
export const FRAME_attak106 = 63;
export const FRAME_attak107 = 64;
export const FRAME_attak108 = 65;
export const FRAME_attak109 = 66;
export const FRAME_attak110 = 67;
export const FRAME_attak111 = 68;
export const FRAME_attak112 = 69;
export const FRAME_attak113 = 70;
export const FRAME_attak114 = 71;
export const FRAME_attak115 = 72;
export const FRAME_attak116 = 73;
export const FRAME_attak117 = 74;
export const FRAME_attak118 = 75;
export const FRAME_attak119 = 76;
export const FRAME_attak120 = 77;
export const FRAME_attak121 = 78;
export const FRAME_attak201 = 79;
export const FRAME_attak202 = 80;
export const FRAME_attak203 = 81;
export const FRAME_attak204 = 82;
export const FRAME_attak205 = 83;
export const FRAME_attak206 = 84;
export const FRAME_attak207 = 85;
export const FRAME_attak208 = 86;
export const FRAME_attak209 = 87;
export const FRAME_attak210 = 88;
export const FRAME_attak211 = 89;
export const FRAME_attak212 = 90;
export const FRAME_attak213 = 91;
export const FRAME_attak214 = 92;
export const FRAME_attak215 = 93;
export const FRAME_attak216 = 94;
export const FRAME_attak217 = 95;
export const FRAME_bankl01 = 96;
export const FRAME_bankl02 = 97;
export const FRAME_bankl03 = 98;
export const FRAME_bankl04 = 99;
export const FRAME_bankl05 = 100;
export const FRAME_bankl06 = 101;
export const FRAME_bankl07 = 102;
export const FRAME_bankr01 = 103;
export const FRAME_bankr02 = 104;
export const FRAME_bankr03 = 105;
export const FRAME_bankr04 = 106;
export const FRAME_bankr05 = 107;
export const FRAME_bankr06 = 108;
export const FRAME_bankr07 = 109;
export const FRAME_rollf01 = 110;
export const FRAME_rollf02 = 111;
export const FRAME_rollf03 = 112;
export const FRAME_rollf04 = 113;
export const FRAME_rollf05 = 114;
export const FRAME_rollf06 = 115;
export const FRAME_rollf07 = 116;
export const FRAME_rollf08 = 117;
export const FRAME_rollf09 = 118;
export const FRAME_rollr01 = 119;
export const FRAME_rollr02 = 120;
export const FRAME_rollr03 = 121;
export const FRAME_rollr04 = 122;
export const FRAME_rollr05 = 123;
export const FRAME_rollr06 = 124;
export const FRAME_rollr07 = 125;
export const FRAME_rollr08 = 126;
export const FRAME_rollr09 = 127;
export const FRAME_defens01 = 128;
export const FRAME_defens02 = 129;
export const FRAME_defens03 = 130;
export const FRAME_defens04 = 131;
export const FRAME_defens05 = 132;
export const FRAME_defens06 = 133;
export const FRAME_pain101 = 134;
export const FRAME_pain102 = 135;
export const FRAME_pain103 = 136;
export const FRAME_pain104 = 137;
export const FRAME_pain105 = 138;
export const FRAME_pain106 = 139;
export const FRAME_pain107 = 140;
export const FRAME_pain108 = 141;
export const FRAME_pain109 = 142;
export const FRAME_pain201 = 143;
export const FRAME_pain202 = 144;
export const FRAME_pain203 = 145;
export const FRAME_pain204 = 146;
export const FRAME_pain301 = 147;
export const FRAME_pain302 = 148;
export const FRAME_pain303 = 149;
export const FRAME_pain304 = 150;

export const MODEL_SCALE = 1.0;

/**
 * Symbols: MZ2_FLYER_BLASTER_1, MZ2_FLYER_BLASTER_2
 * Original name: N/A
 * Source: N/A (local muzzle flash aliases)
 * Source declaree: N/A (local muzzle flash aliases)
 * Category: New
 * Purpose: Keep flyer-specific names close to the monster code while delegating offsets to the shared flash table.
 */
export const MZ2_FLYER_BLASTER_1 = 58;
export const MZ2_FLYER_BLASTER_2 = 59;

const SOUND_SIGHT = "flyer/flysght1.wav";
const SOUND_IDLE = "flyer/flysrch1.wav";
const SOUND_PAIN1 = "flyer/flypain1.wav";
const SOUND_PAIN2 = "flyer/flypain2.wav";
const SOUND_SLASH = "flyer/flyatck2.wav";
const SOUND_SPROING = "flyer/flyatck1.wav";
const SOUND_DIE = "flyer/flydeth1.wav";

/**
 * Symbols: SOUND_ATTACK3, SOUND_LOOP_IDLE
 * Original name: N/A
 * Source: N/A (local asset path constants)
 * Source declaree: N/A (local asset path constants)
 * Category: New
 * Purpose: Name source string literals that are precached or assigned during flyer spawn setup.
 */
const SOUND_ATTACK3 = "flyer/flyatck3.wav";
const SOUND_LOOP_IDLE = "flyer/flyidle1.wav";

let nextmove = ACTION_nothing;

/**
 * Symbols: sound_sight, sound_idle, sound_pain1, sound_pain2, sound_slash, sound_sproing, sound_die
 * Original name: N/A
 * Source: N/A (runtime sound cache handles)
 * Source declaree: N/A (runtime sound cache handles)
 * Category: New
 * Purpose: Store registered sound IDs for the runtime sound adapter.
 */
let sound_sight = 0;
let sound_idle = 0;
let sound_pain1 = 0;
let sound_pain2 = 0;
let sound_slash = 0;
let sound_sproing = 0;
let sound_die = 0;

const flyer_frames_stand = makeFrames(ai_stand, new Array<number>(45).fill(0));
export const flyer_move_stand: GameMonsterMove = {
  firstframe: FRAME_stand01,
  lastframe: FRAME_stand45,
  frame: flyer_frames_stand,
  endfunc: undefined
};

const flyer_frames_walk = makeFrames(ai_walk, new Array<number>(45).fill(5));
export const flyer_move_walk: GameMonsterMove = {
  firstframe: FRAME_stand01,
  lastframe: FRAME_stand45,
  frame: flyer_frames_walk,
  endfunc: undefined
};

const flyer_frames_run = makeFrames(ai_run, new Array<number>(45).fill(10));
export const flyer_move_run: GameMonsterMove = {
  firstframe: FRAME_stand01,
  lastframe: FRAME_stand45,
  frame: flyer_frames_run,
  endfunc: undefined
};

const flyer_frames_start = makeFrames(ai_move, new Array<number>(6).fill(0), indexedThinks(6, [[5, flyer_nextmove]]));
export const flyer_move_start: GameMonsterMove = {
  firstframe: FRAME_start01,
  lastframe: FRAME_start06,
  frame: flyer_frames_start,
  endfunc: undefined
};

const flyer_frames_stop = makeFrames(ai_move, new Array<number>(7).fill(0), indexedThinks(7, [[6, flyer_nextmove]]));
export const flyer_move_stop: GameMonsterMove = {
  firstframe: FRAME_stop01,
  lastframe: FRAME_stop07,
  frame: flyer_frames_stop,
  endfunc: undefined
};

const flyer_frames_rollright = makeFrames(ai_move, new Array<number>(9).fill(0));
export const flyer_move_rollright: GameMonsterMove = {
  firstframe: FRAME_rollr01,
  lastframe: FRAME_rollr09,
  frame: flyer_frames_rollright,
  endfunc: undefined
};

const flyer_frames_rollleft = makeFrames(ai_move, new Array<number>(9).fill(0));
export const flyer_move_rollleft: GameMonsterMove = {
  firstframe: FRAME_rollf01,
  lastframe: FRAME_rollf09,
  frame: flyer_frames_rollleft,
  endfunc: undefined
};

const flyer_frames_pain3 = makeFrames(ai_move, new Array<number>(4).fill(0));
export const flyer_move_pain3: GameMonsterMove = {
  firstframe: FRAME_pain301,
  lastframe: FRAME_pain304,
  frame: flyer_frames_pain3,
  endfunc: flyer_run
};

const flyer_frames_pain2 = makeFrames(ai_move, new Array<number>(4).fill(0));
export const flyer_move_pain2: GameMonsterMove = {
  firstframe: FRAME_pain201,
  lastframe: FRAME_pain204,
  frame: flyer_frames_pain2,
  endfunc: flyer_run
};

const flyer_frames_pain1 = makeFrames(ai_move, new Array<number>(9).fill(0));
export const flyer_move_pain1: GameMonsterMove = {
  firstframe: FRAME_pain101,
  lastframe: FRAME_pain109,
  frame: flyer_frames_pain1,
  endfunc: flyer_run
};

const flyer_frames_defense = makeFrames(ai_move, new Array<number>(6).fill(0));
export const flyer_move_defense: GameMonsterMove = {
  firstframe: FRAME_defens01,
  lastframe: FRAME_defens06,
  frame: flyer_frames_defense,
  endfunc: undefined
};

const flyer_frames_bankright = makeFrames(ai_move, new Array<number>(7).fill(0));
export const flyer_move_bankright: GameMonsterMove = {
  firstframe: FRAME_bankr01,
  lastframe: FRAME_bankr07,
  frame: flyer_frames_bankright,
  endfunc: undefined
};

const flyer_frames_bankleft = makeFrames(ai_move, new Array<number>(7).fill(0));
export const flyer_move_bankleft: GameMonsterMove = {
  firstframe: FRAME_bankl01,
  lastframe: FRAME_bankl07,
  frame: flyer_frames_bankleft,
  endfunc: undefined
};

const flyer_frames_attack2 = makeFrames(
  ai_charge,
  [0, 0, 0, -10, -10, -10, -10, -10, -10, -10, -10, 0, 0, 0, 0, 0, 0],
  indexedThinks(17, [
    [3, flyer_fireleft],
    [4, flyer_fireright],
    [5, flyer_fireleft],
    [6, flyer_fireright],
    [7, flyer_fireleft],
    [8, flyer_fireright],
    [9, flyer_fireleft],
    [10, flyer_fireright]
  ])
);
export const flyer_move_attack2: GameMonsterMove = {
  firstframe: FRAME_attak201,
  lastframe: FRAME_attak217,
  frame: flyer_frames_attack2,
  endfunc: flyer_run
};

const flyer_frames_start_melee = makeFrames(
  ai_charge,
  new Array<number>(6).fill(0),
  indexedThinks(6, [[0, flyer_pop_blades]])
);
export const flyer_move_start_melee: GameMonsterMove = {
  firstframe: FRAME_attak101,
  lastframe: FRAME_attak106,
  frame: flyer_frames_start_melee,
  endfunc: flyer_loop_melee
};

const flyer_frames_end_melee = makeFrames(ai_charge, new Array<number>(3).fill(0));
export const flyer_move_end_melee: GameMonsterMove = {
  firstframe: FRAME_attak119,
  lastframe: FRAME_attak121,
  frame: flyer_frames_end_melee,
  endfunc: flyer_run
};

const flyer_frames_loop_melee = makeFrames(
  ai_charge,
  new Array<number>(12).fill(0),
  indexedThinks(12, [
    [2, flyer_slash_left],
    [7, flyer_slash_right]
  ])
);
export const flyer_move_loop_melee: GameMonsterMove = {
  firstframe: FRAME_attak107,
  lastframe: FRAME_attak118,
  frame: flyer_frames_loop_melee,
  endfunc: flyer_check_melee
};

/**
 * Original name: flyer_sight
 * Source: game/m_flyer.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Plays the flyer sight sound on target acquisition.
 */
export function flyer_sight(self: GameEntity, _other: GameEntity | null, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_sight, SOUND_SIGHT, {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
}

/**
 * Original name: flyer_idle
 * Source: game/m_flyer.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Plays the flyer search/idle voice sound.
 */
export function flyer_idle(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_idle, SOUND_IDLE, {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_IDLE,
    timeofs: 0
  });
}

/**
 * Original name: flyer_pop_blades
 * Source: game/m_flyer.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Plays the melee blade-open sound.
 */
export function flyer_pop_blades(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_sproing, SOUND_SPROING, {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
}

/**
 * Original name: flyer_run
 * Source: game/m_flyer.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Uses stand animation while holding ground, otherwise enters the flyer run loop.
 */
export function flyer_run(self: GameEntity): void {
  if ((self.monsterinfo.aiflags & AI_STAND_GROUND) !== 0) {
    self.monsterinfo.currentmove = flyer_move_stand;
  } else {
    self.monsterinfo.currentmove = flyer_move_run;
  }
}

/**
 * Original name: flyer_walk
 * Source: game/m_flyer.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Starts the flyer walk loop.
 */
export function flyer_walk(self: GameEntity): void {
  self.monsterinfo.currentmove = flyer_move_walk;
}

/**
 * Original name: flyer_stand
 * Source: game/m_flyer.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Sets the flyer to its standing loop.
 */
export function flyer_stand(self: GameEntity): void {
  self.monsterinfo.currentmove = flyer_move_stand;
}

/**
 * Original name: flyer_stop
 * Source: game/m_flyer.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Starts the flyer stop transition.
 */
export function flyer_stop(self: GameEntity): void {
  self.monsterinfo.currentmove = flyer_move_stop;
}

/**
 * Original name: flyer_start
 * Source: game/m_flyer.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Starts the flyer start transition.
 */
export function flyer_start(self: GameEntity): void {
  self.monsterinfo.currentmove = flyer_move_start;
}

/**
 * Original name: flyer_fire
 * Source: game/m_flyer.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Projects the selected flyer blaster muzzle and fires toward the enemy view height.
 */
export function flyer_fire(self: GameEntity, flash_number: number, runtime: GameRuntime): void {
  if (!self.enemy) {
    return;
  }

  const effect =
    self.s.frame === FRAME_attak204 ||
    self.s.frame === FRAME_attak207 ||
    self.s.frame === FRAME_attak210
      ? EF_HYPERBLASTER
      : 0;
  const { forward, right } = AngleVectors(self.s.angles);
  const start = G_ProjectSource(self.s.origin, flyerFlashOffset(flash_number), forward, right);
  const end: vec3_t = [...self.enemy.s.origin];
  end[2] += self.enemy.viewheight;
  const dir = subtractVec3(end, start);

  monster_fire_blaster(self, start, dir, 1, 1000, flash_number, effect, runtime);
}

/**
 * Original name: flyer_fireleft
 * Source: game/m_flyer.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Fires the left flyer blaster.
 */
export function flyer_fireleft(self: GameEntity, runtime: GameRuntime): void {
  flyer_fire(self, MZ2_FLYER_BLASTER_1, runtime);
}

/**
 * Original name: flyer_fireright
 * Source: game/m_flyer.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Fires the right flyer blaster.
 */
export function flyer_fireright(self: GameEntity, runtime: GameRuntime): void {
  flyer_fire(self, MZ2_FLYER_BLASTER_2, runtime);
}

/**
 * Original name: flyer_slash_left
 * Source: game/m_flyer.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Performs the left-wing melee hit and slash sound.
 */
export function flyer_slash_left(self: GameEntity, runtime: GameRuntime): void {
  const aim: vec3_t = [MELEE_DISTANCE, self.mins[0], 0];
  fire_hit(self, aim, 5, 0, runtime);
  emitRegisteredGameSound(runtime, self, sound_slash, SOUND_SLASH, {
    channel: CHAN_WEAPON,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
}

/**
 * Original name: flyer_slash_right
 * Source: game/m_flyer.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Performs the right-wing melee hit and slash sound.
 */
export function flyer_slash_right(self: GameEntity, runtime: GameRuntime): void {
  const aim: vec3_t = [MELEE_DISTANCE, self.maxs[0], 0];
  fire_hit(self, aim, 5, 0, runtime);
  emitRegisteredGameSound(runtime, self, sound_slash, SOUND_SLASH, {
    channel: CHAN_WEAPON,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
}

/**
 * Original name: flyer_loop_melee
 * Source: game/m_flyer.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Enters the repeatable melee loop.
 */
export function flyer_loop_melee(self: GameEntity): void {
  self.monsterinfo.currentmove = flyer_move_loop_melee;
}

/**
 * Original name: flyer_attack
 * Source: game/m_flyer.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Enters the flyer blaster attack sequence.
 */
export function flyer_attack(self: GameEntity): void {
  self.monsterinfo.currentmove = flyer_move_attack2;
}

/**
 * Original name: flyer_setstart
 * Source: game/m_flyer.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Schedules a run transition through the flyer start animation.
 */
export function flyer_setstart(self: GameEntity): void {
  nextmove = ACTION_run;
  self.monsterinfo.currentmove = flyer_move_start;
}

/**
 * Original name: flyer_nextmove
 * Source: game/m_flyer.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Resolves the static next-move selector used by flyer start/stop transitions.
 */
export function flyer_nextmove(self: GameEntity): void {
  if (nextmove === ACTION_attack1) {
    self.monsterinfo.currentmove = flyer_move_start_melee;
  } else if (nextmove === ACTION_attack2) {
    self.monsterinfo.currentmove = flyer_move_attack2;
  } else if (nextmove === ACTION_run) {
    self.monsterinfo.currentmove = flyer_move_run;
  }
}

/**
 * Original name: flyer_melee
 * Source: game/m_flyer.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Starts the flyer melee blade-opening sequence.
 */
export function flyer_melee(self: GameEntity): void {
  self.monsterinfo.currentmove = flyer_move_start_melee;
}

/**
 * Original name: flyer_check_melee
 * Source: game/m_flyer.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Repeats melee 80 percent of the time while the enemy remains in melee range.
 *
 * Porting notes:
 * - Uses the shared `g_local.random()` helper for the original macro threshold.
 */
export function flyer_check_melee(self: GameEntity): void {
  if (self.enemy && range(self, self.enemy) === RANGE_MELEE) {
    if (random() <= 0.8) {
      self.monsterinfo.currentmove = flyer_move_loop_melee;
    } else {
      self.monsterinfo.currentmove = flyer_move_end_melee;
    }
  } else {
    self.monsterinfo.currentmove = flyer_move_end_melee;
  }
}

/**
 * Original name: flyer_pain
 * Source: game/m_flyer.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies damaged skin, pain debounce, nightmare suppression and one of three random pain moves.
 */
export function flyer_pain(
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

  const n = randomInt(0x7fffffff) % 3;
  if (n === 0) {
    emitRegisteredGameSound(runtime, self, sound_pain1, SOUND_PAIN1, {
      channel: CHAN_VOICE,
      volume: 1,
      attenuation: ATTN_NORM,
      timeofs: 0
    });
    self.monsterinfo.currentmove = flyer_move_pain1;
  } else if (n === 1) {
    emitRegisteredGameSound(runtime, self, sound_pain2, SOUND_PAIN2, {
      channel: CHAN_VOICE,
      volume: 1,
      attenuation: ATTN_NORM,
      timeofs: 0
    });
    self.monsterinfo.currentmove = flyer_move_pain2;
  } else {
    emitRegisteredGameSound(runtime, self, sound_pain1, SOUND_PAIN1, {
      channel: CHAN_VOICE,
      volume: 1,
      attenuation: ATTN_NORM,
      timeofs: 0
    });
    self.monsterinfo.currentmove = flyer_move_pain3;
  }
}

/**
 * Original name: flyer_die
 * Source: game/m_flyer.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Plays the death sound, then turns the flyer into an explosion.
 */
export function flyer_die(
  self: GameEntity,
  _inflictor: GameEntity | null,
  _attacker: GameEntity | null,
  _damage: number,
  runtime: GameRuntime
): void {
  emitRegisteredGameSound(runtime, self, sound_die, SOUND_DIE, {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
  BecomeExplosion1(self, runtime);
}

/**
 * Original name: SP_monster_flyer
 * Source: game/m_flyer.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns monster_flyer, precaches assets and initializes flying monster callbacks.
 */
export function SP_monster_flyer(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  if (stringsEqualIgnoreCase(runtime.mapname, "jail5") && self.s.origin[2] === -104) {
    self.targetname = self.target;
    self.target = undefined;
  }

  precacheFlyerAssets(runtime);

  self.s.modelindex = registerGameModel(runtime, "models/monsters/flyer/tris.md2");
  setVec3(self.mins, -16, -16, -24);
  setVec3(self.maxs, 16, 16, 32);
  self.movetype = MOVETYPE_STEP;
  self.solid = SOLID_BBOX;
  self.s.sound = registerGameSound(runtime, SOUND_LOOP_IDLE);

  self.health = 50;
  self.mass = 50;

  self.pain = flyer_pain;
  self.die = flyer_die;

  self.monsterinfo.stand = flyer_stand;
  self.monsterinfo.walk = flyer_walk;
  self.monsterinfo.run = flyer_run;
  self.monsterinfo.attack = flyer_attack;
  self.monsterinfo.melee = flyer_melee;
  self.monsterinfo.sight = flyer_sight;
  self.monsterinfo.idle = flyer_idle;

  linkGameEntity(runtime, self);

  self.monsterinfo.currentmove = flyer_move_stand;
  self.monsterinfo.scale = MODEL_SCALE;

  flymonster_start(self, runtime);
}

/**
 * Symbols: makeFrames
 * Original name: N/A
 * Source: N/A (local frame table helper)
 * Source declaree: N/A (local frame table helper)
 * Category: New
 * Purpose: Convert compact distance/think arrays into runtime monster frame records.
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
 * Symbols: indexedThinks
 * Original name: N/A
 * Source: N/A (local frame table helper)
 * Source declaree: N/A (local frame table helper)
 * Category: New
 * Purpose: Build sparse think callback arrays for declarative monster frame tables.
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
 * Symbols: precacheFlyerAssets
 * Original name: N/A
 * Source: N/A (local precache helper)
 * Source declaree: N/A (local precache helper)
 * Category: New
 * Purpose: Centralize flyer sound registration while preserving source precache order.
 */
function precacheFlyerAssets(runtime: GameRuntime): void {
  sound_sight = registerGameSound(runtime, SOUND_SIGHT);
  sound_idle = registerGameSound(runtime, SOUND_IDLE);
  sound_pain1 = registerGameSound(runtime, SOUND_PAIN1);
  sound_pain2 = registerGameSound(runtime, SOUND_PAIN2);
  sound_slash = registerGameSound(runtime, SOUND_SLASH);
  sound_sproing = registerGameSound(runtime, SOUND_SPROING);
  sound_die = registerGameSound(runtime, SOUND_DIE);
  registerGameSound(runtime, SOUND_ATTACK3);
}

/**
 * Symbols: flyerFlashOffset
 * Original name: N/A
 * Source: N/A (local flash table adapter)
 * Source declaree: N/A (local flash table adapter)
 * Category: New
 * Purpose: Resolve flyer muzzle flash offsets through the shared monster flash table.
 */
function flyerFlashOffset(flashNumber: number): vec3_t {
  return getMonsterFlashOffset(flashNumber);
}

/**
 * Symbols: setVec3
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Mutate runtime vectors in place for spawn bounds setup.
 */
function setVec3(vector: [number, number, number], x: number, y: number, z: number): void {
  vector[0] = x;
  vector[1] = y;
  vector[2] = z;
}

/**
 * Symbols: subtractVec3
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Build the projectile aim vector used by flyer blaster fire.
 */
function subtractVec3(left: vec3_t, right: vec3_t): vec3_t {
  return [
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2]
  ];
}

/**
 * Symbols: randomInt
 * Original name: N/A
 * Source: N/A (local random helper)
 * Source declaree: N/A (local random helper)
 * Category: New
 * Purpose: Preserve the integer rand-style pain branch used by the source behavior.
 */
function randomInt(maxExclusive: number): number {
  return Math.trunc(Math.random() * maxExclusive);
}

/**
 * Symbols: stringsEqualIgnoreCase
 * Original name: N/A
 * Source: N/A (local string helper)
 * Source declaree: N/A (local string helper)
 * Category: New
 * Purpose: Reuse the Quake case-insensitive string comparison for map-specific spawn quirks.
 */
function stringsEqualIgnoreCase(left: string, right: string): boolean {
  return Q_stricmp(left, right) === 0;
}
