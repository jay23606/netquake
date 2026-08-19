/**
 * File: m_boss31.ts
 * Source: Quake II original / game/m_boss31.h and game/m_boss31.c
 * Purpose: Port of the generated boss31 model frame constants and monster_jorg gameplay behavior.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses the explicit gameplay runtime and asset helpers instead of `gi.*`.
 *
 * Notes:
 * - This file keeps the header constants and C behavior together as the principal attachment point for `m_boss31`.
 * - Makron handoff behavior is imported from the `m_boss32.c` port.
 */

import { AngleVectors, ATTN_NORM, CHAN_BODY, CHAN_VOICE, type vec3_t } from "../../qcommon/src/q_shared.js";
import { CONTENTS_LAVA, CONTENTS_MONSTER, CONTENTS_SLIME, CONTENTS_SOLID } from "../../qcommon/src/q_shared.js";
import {
  AI_STAND_GROUND,
  AS_MELEE,
  AS_MISSILE,
  AS_SLIDING,
  AS_STRAIGHT,
  DEAD_DEAD,
  DEFAULT_BULLET_HSPREAD,
  DEFAULT_BULLET_VSPREAD,
  FL_FLY,
  MOVETYPE_STEP,
  RANGE_FAR,
  RANGE_MELEE,
  RANGE_MID,
  RANGE_NEAR,
  SOLID_BBOX,
  damage_t,
  random
} from "./g_local.js";
import { ai_charge, ai_move, ai_run, ai_stand, ai_walk, range, visible } from "./g_ai.js";
import { monster_fire_bfg, monster_fire_bullet, walkmonster_start } from "./g_monster.js";
import { G_FreeEdict, G_ProjectSource, vectoyaw } from "./g_utils.js";
import { getMonsterFlashOffset } from "./m_flash.js";
import { MakronPrecache, MakronToss } from "./m_boss32.js";
import { BossExplode } from "./m_supertank.js";
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

export const FRAME_attak101 = 0;
export const FRAME_attak102 = 1;
export const FRAME_attak103 = 2;
export const FRAME_attak104 = 3;
export const FRAME_attak105 = 4;
export const FRAME_attak106 = 5;
export const FRAME_attak107 = 6;
export const FRAME_attak108 = 7;
export const FRAME_attak109 = 8;
export const FRAME_attak110 = 9;
export const FRAME_attak111 = 10;
export const FRAME_attak112 = 11;
export const FRAME_attak113 = 12;
export const FRAME_attak114 = 13;
export const FRAME_attak115 = 14;
export const FRAME_attak116 = 15;
export const FRAME_attak117 = 16;
export const FRAME_attak118 = 17;
export const FRAME_attak201 = 18;
export const FRAME_attak202 = 19;
export const FRAME_attak203 = 20;
export const FRAME_attak204 = 21;
export const FRAME_attak205 = 22;
export const FRAME_attak206 = 23;
export const FRAME_attak207 = 24;
export const FRAME_attak208 = 25;
export const FRAME_attak209 = 26;
export const FRAME_attak210 = 27;
export const FRAME_attak211 = 28;
export const FRAME_attak212 = 29;
export const FRAME_attak213 = 30;
export const FRAME_death01 = 31;
export const FRAME_death02 = 32;
export const FRAME_death03 = 33;
export const FRAME_death04 = 34;
export const FRAME_death05 = 35;
export const FRAME_death06 = 36;
export const FRAME_death07 = 37;
export const FRAME_death08 = 38;
export const FRAME_death09 = 39;
export const FRAME_death10 = 40;
export const FRAME_death11 = 41;
export const FRAME_death12 = 42;
export const FRAME_death13 = 43;
export const FRAME_death14 = 44;
export const FRAME_death15 = 45;
export const FRAME_death16 = 46;
export const FRAME_death17 = 47;
export const FRAME_death18 = 48;
export const FRAME_death19 = 49;
export const FRAME_death20 = 50;
export const FRAME_death21 = 51;
export const FRAME_death22 = 52;
export const FRAME_death23 = 53;
export const FRAME_death24 = 54;
export const FRAME_death25 = 55;
export const FRAME_death26 = 56;
export const FRAME_death27 = 57;
export const FRAME_death28 = 58;
export const FRAME_death29 = 59;
export const FRAME_death30 = 60;
export const FRAME_death31 = 61;
export const FRAME_death32 = 62;
export const FRAME_death33 = 63;
export const FRAME_death34 = 64;
export const FRAME_death35 = 65;
export const FRAME_death36 = 66;
export const FRAME_death37 = 67;
export const FRAME_death38 = 68;
export const FRAME_death39 = 69;
export const FRAME_death40 = 70;
export const FRAME_death41 = 71;
export const FRAME_death42 = 72;
export const FRAME_death43 = 73;
export const FRAME_death44 = 74;
export const FRAME_death45 = 75;
export const FRAME_death46 = 76;
export const FRAME_death47 = 77;
export const FRAME_death48 = 78;
export const FRAME_death49 = 79;
export const FRAME_death50 = 80;
export const FRAME_pain101 = 81;
export const FRAME_pain102 = 82;
export const FRAME_pain103 = 83;
export const FRAME_pain201 = 84;
export const FRAME_pain202 = 85;
export const FRAME_pain203 = 86;
export const FRAME_pain301 = 87;
export const FRAME_pain302 = 88;
export const FRAME_pain303 = 89;
export const FRAME_pain304 = 90;
export const FRAME_pain305 = 91;
export const FRAME_pain306 = 92;
export const FRAME_pain307 = 93;
export const FRAME_pain308 = 94;
export const FRAME_pain309 = 95;
export const FRAME_pain310 = 96;
export const FRAME_pain311 = 97;
export const FRAME_pain312 = 98;
export const FRAME_pain313 = 99;
export const FRAME_pain314 = 100;
export const FRAME_pain315 = 101;
export const FRAME_pain316 = 102;
export const FRAME_pain317 = 103;
export const FRAME_pain318 = 104;
export const FRAME_pain319 = 105;
export const FRAME_pain320 = 106;
export const FRAME_pain321 = 107;
export const FRAME_pain322 = 108;
export const FRAME_pain323 = 109;
export const FRAME_pain324 = 110;
export const FRAME_pain325 = 111;
export const FRAME_stand01 = 112;
export const FRAME_stand02 = 113;
export const FRAME_stand03 = 114;
export const FRAME_stand04 = 115;
export const FRAME_stand05 = 116;
export const FRAME_stand06 = 117;
export const FRAME_stand07 = 118;
export const FRAME_stand08 = 119;
export const FRAME_stand09 = 120;
export const FRAME_stand10 = 121;
export const FRAME_stand11 = 122;
export const FRAME_stand12 = 123;
export const FRAME_stand13 = 124;
export const FRAME_stand14 = 125;
export const FRAME_stand15 = 126;
export const FRAME_stand16 = 127;
export const FRAME_stand17 = 128;
export const FRAME_stand18 = 129;
export const FRAME_stand19 = 130;
export const FRAME_stand20 = 131;
export const FRAME_stand21 = 132;
export const FRAME_stand22 = 133;
export const FRAME_stand23 = 134;
export const FRAME_stand24 = 135;
export const FRAME_stand25 = 136;
export const FRAME_stand26 = 137;
export const FRAME_stand27 = 138;
export const FRAME_stand28 = 139;
export const FRAME_stand29 = 140;
export const FRAME_stand30 = 141;
export const FRAME_stand31 = 142;
export const FRAME_stand32 = 143;
export const FRAME_stand33 = 144;
export const FRAME_stand34 = 145;
export const FRAME_stand35 = 146;
export const FRAME_stand36 = 147;
export const FRAME_stand37 = 148;
export const FRAME_stand38 = 149;
export const FRAME_stand39 = 150;
export const FRAME_stand40 = 151;
export const FRAME_stand41 = 152;
export const FRAME_stand42 = 153;
export const FRAME_stand43 = 154;
export const FRAME_stand44 = 155;
export const FRAME_stand45 = 156;
export const FRAME_stand46 = 157;
export const FRAME_stand47 = 158;
export const FRAME_stand48 = 159;
export const FRAME_stand49 = 160;
export const FRAME_stand50 = 161;
export const FRAME_stand51 = 162;
export const FRAME_walk01 = 163;
export const FRAME_walk02 = 164;
export const FRAME_walk03 = 165;
export const FRAME_walk04 = 166;
export const FRAME_walk05 = 167;
export const FRAME_walk06 = 168;
export const FRAME_walk07 = 169;
export const FRAME_walk08 = 170;
export const FRAME_walk09 = 171;
export const FRAME_walk10 = 172;
export const FRAME_walk11 = 173;
export const FRAME_walk12 = 174;
export const FRAME_walk13 = 175;
export const FRAME_walk14 = 176;
export const FRAME_walk15 = 177;
export const FRAME_walk16 = 178;
export const FRAME_walk17 = 179;
export const FRAME_walk18 = 180;
export const FRAME_walk19 = 181;
export const FRAME_walk20 = 182;
export const FRAME_walk21 = 183;
export const FRAME_walk22 = 184;
export const FRAME_walk23 = 185;
export const FRAME_walk24 = 186;
export const FRAME_walk25 = 187;

export const MODEL_SCALE = 1.0;

// Original name: N/A
// Source: N/A (local muzzle flash aliases)
// Category: New
export const MZ2_JORG_MACHINEGUN_L1 = 120;
export const MZ2_JORG_MACHINEGUN_L2 = 121;
export const MZ2_JORG_MACHINEGUN_L3 = 122;
export const MZ2_JORG_MACHINEGUN_L4 = 123;
export const MZ2_JORG_MACHINEGUN_L5 = 124;
export const MZ2_JORG_MACHINEGUN_L6 = 125;
export const MZ2_JORG_MACHINEGUN_R1 = 126;
export const MZ2_JORG_MACHINEGUN_R2 = 127;
export const MZ2_JORG_MACHINEGUN_R3 = 128;
export const MZ2_JORG_MACHINEGUN_R4 = 129;
export const MZ2_JORG_MACHINEGUN_R5 = 130;
export const MZ2_JORG_MACHINEGUN_R6 = 131;
export const MZ2_JORG_BFG_1 = 132;

// Original name: N/A
// Source: N/A (named local trace mask)
// Category: New
const JORG_ATTACK_TRACE_MASK = CONTENTS_SOLID | CONTENTS_MONSTER | CONTENTS_SLIME | CONTENTS_LAVA;
const SOUND_PAIN1 = "boss3/bs3pain1.wav";
const SOUND_PAIN2 = "boss3/bs3pain2.wav";
const SOUND_PAIN3 = "boss3/bs3pain3.wav";
const SOUND_DEATH = "boss3/bs3deth1.wav";
const SOUND_ATTACK1 = "boss3/bs3atck1.wav";
const SOUND_ATTACK2 = "boss3/bs3atck2.wav";
const SOUND_SEARCH1 = "boss3/bs3srch1.wav";
const SOUND_SEARCH2 = "boss3/bs3srch2.wav";
const SOUND_SEARCH3 = "boss3/bs3srch3.wav";
const SOUND_IDLE = "boss3/bs3idle1.wav";
const SOUND_STEP_LEFT = "boss3/step1.wav";
const SOUND_STEP_RIGHT = "boss3/step2.wav";
const SOUND_FIREGUN = "boss3/xfire.wav";
const SOUND_DEATH_HIT = "boss3/d_hit.wav";

// Original name: N/A
// Source: N/A (named local sound path)
// Category: New
const SOUND_W_LOOP = "boss3/w_loop.wav";

// Original name: N/A
// Source: N/A (runtime sound handle cache)
// Category: New
let sound_pain1 = 0;
let sound_pain2 = 0;
let sound_pain3 = 0;
let sound_idle = 0;
let sound_death = 0;
let sound_search1 = 0;
let sound_search2 = 0;
let sound_search3 = 0;
let sound_attack1 = 0;
let sound_attack2 = 0;
let sound_step_left = 0;
let sound_step_right = 0;
let sound_firegun = 0;
let sound_death_hit = 0;

/**
 * Original name: jorg_search
 * Source: game/m_boss31.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Selects one of Jorg's three search sounds using the `random()` thresholds from the original.
 */
export function jorg_search(self: GameEntity, runtime: GameRuntime): void {
  const r = random();

  if (r <= 0.3) {
    emitRegisteredGameSound(runtime, self, sound_search1, SOUND_SEARCH1, soundOptions(CHAN_VOICE));
  } else if (r <= 0.6) {
    emitRegisteredGameSound(runtime, self, sound_search2, SOUND_SEARCH2, soundOptions(CHAN_VOICE));
  } else {
    emitRegisteredGameSound(runtime, self, sound_search3, SOUND_SEARCH3, soundOptions(CHAN_VOICE));
  }
}

/**
 * Original name: jorg_idle
 * Source: game/m_boss31.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits Jorg's idle voice sound using the original channel, volume and attenuation.
 */
export function jorg_idle(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_idle, SOUND_IDLE, soundOptions(CHAN_VOICE));
}

/**
 * Original name: jorg_death_hit
 * Source: game/m_boss31.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits Jorg's body impact sound used during the death sequence.
 */
export function jorg_death_hit(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_death_hit, SOUND_DEATH_HIT, soundOptions(CHAN_BODY));
}

/**
 * Original name: jorg_step_left
 * Source: game/m_boss31.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits Jorg's left step body sound.
 */
export function jorg_step_left(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_step_left, SOUND_STEP_LEFT, soundOptions(CHAN_BODY));
}

/**
 * Original name: jorg_step_right
 * Source: game/m_boss31.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits Jorg's right step body sound.
 */
export function jorg_step_right(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_step_right, SOUND_STEP_RIGHT, soundOptions(CHAN_BODY));
}

export const jorg_frames_stand = makeFrames(
  ai_stand,
  [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    19, 11, 0, 0, 6, 9, 0, 0, 0, 0, 0, 0, 0, -2, -17, 0, -12, -14
  ],
  indexedThinks(51, [[0, jorg_idle], [34, jorg_step_left], [38, jorg_step_right], [47, jorg_step_left], [50, jorg_step_right]])
);
export const jorg_move_stand: GameMonsterMove = {
  firstframe: FRAME_stand01,
  lastframe: FRAME_stand51,
  frame: jorg_frames_stand,
  endfunc: undefined
};

/**
 * Original name: jorg_stand
 * Source: game/m_boss31.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Switches Jorg back to the 51-frame stand move.
 */
export function jorg_stand(self: GameEntity): void {
  self.monsterinfo.currentmove = jorg_move_stand;
}

export const jorg_frames_run = makeFrames(
  ai_run,
  [17, 0, 0, 0, 12, 8, 10, 33, 0, 0, 0, 9, 9, 9],
  indexedThinks(14, [[0, jorg_step_left], [7, jorg_step_right]])
);
export const jorg_move_run: GameMonsterMove = {
  firstframe: FRAME_walk06,
  lastframe: FRAME_walk19,
  frame: jorg_frames_run,
  endfunc: undefined
};

export const jorg_frames_start_walk = makeFrames(ai_walk, [5, 6, 7, 9, 15]);
export const jorg_move_start_walk: GameMonsterMove = {
  firstframe: FRAME_walk01,
  lastframe: FRAME_walk05,
  frame: jorg_frames_start_walk,
  endfunc: undefined
};

export const jorg_frames_walk = makeFrames(ai_walk, [17, 0, 0, 0, 12, 8, 10, 33, 0, 0, 0, 9, 9, 9]);
export const jorg_move_walk: GameMonsterMove = {
  firstframe: FRAME_walk06,
  lastframe: FRAME_walk19,
  frame: jorg_frames_walk,
  endfunc: undefined
};

export const jorg_frames_end_walk = makeFrames(ai_walk, [11, 0, 0, 0, 8, -8]);
export const jorg_move_end_walk: GameMonsterMove = {
  firstframe: FRAME_walk20,
  lastframe: FRAME_walk25,
  frame: jorg_frames_end_walk,
  endfunc: undefined
};

/**
 * Original name: jorg_walk
 * Source: game/m_boss31.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Switches Jorg to the looping walk move.
 */
export function jorg_walk(self: GameEntity): void {
  self.monsterinfo.currentmove = jorg_move_walk;
}

/**
 * Original name: jorg_run
 * Source: game/m_boss31.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Uses the stand move while `AI_STAND_GROUND` is set; otherwise uses the run move.
 */
export function jorg_run(self: GameEntity): void {
  if ((self.monsterinfo.aiflags & AI_STAND_GROUND) !== 0) {
    self.monsterinfo.currentmove = jorg_move_stand;
  } else {
    self.monsterinfo.currentmove = jorg_move_run;
  }
}

export const jorg_frames_pain3 = makeFrames(
  ai_move,
  [-28, -6, -3, -9, 0, 0, 0, 0, -7, 1, -11, -4, 0, 0, 10, 11, 0, 10, 3, 10, 7, 17, 0, 0, 0],
  indexedThinks(25, [[2, jorg_step_left], [4, jorg_step_right], [20, jorg_step_left], [24, jorg_step_right]])
);
export const jorg_move_pain3: GameMonsterMove = {
  firstframe: FRAME_pain301,
  lastframe: FRAME_pain325,
  frame: jorg_frames_pain3,
  endfunc: jorg_run
};

export const jorg_frames_pain2 = makeFrames(ai_move, [0, 0, 0]);
export const jorg_move_pain2: GameMonsterMove = {
  firstframe: FRAME_pain201,
  lastframe: FRAME_pain203,
  frame: jorg_frames_pain2,
  endfunc: jorg_run
};

export const jorg_frames_pain1 = makeFrames(ai_move, [0, 0, 0]);
export const jorg_move_pain1: GameMonsterMove = {
  firstframe: FRAME_pain101,
  lastframe: FRAME_pain103,
  frame: jorg_frames_pain1,
  endfunc: jorg_run
};

export const jorg_frames_death1 = makeFrames(
  ai_move,
  new Array<number>(50).fill(0),
  indexedThinks(50, [[48, MakronToss], [49, BossExplode]])
);
export const jorg_move_death: GameMonsterMove = {
  firstframe: FRAME_death01,
  lastframe: FRAME_death50,
  frame: jorg_frames_death1,
  endfunc: jorg_dead
};

export const jorg_frames_attack2 = [
  ...makeFrames(ai_charge, new Array<number>(7).fill(0), indexedThinks(7, [[6, jorgBFG]])),
  ...makeFrames(ai_move, new Array<number>(6).fill(0))
];
export const jorg_move_attack2: GameMonsterMove = {
  firstframe: FRAME_attak201,
  lastframe: FRAME_attak213,
  frame: jorg_frames_attack2,
  endfunc: jorg_run
};

export const jorg_frames_start_attack1 = makeFrames(ai_charge, new Array<number>(8).fill(0));
export const jorg_move_start_attack1: GameMonsterMove = {
  firstframe: FRAME_attak101,
  lastframe: FRAME_attak108,
  frame: jorg_frames_start_attack1,
  endfunc: jorg_attack1
};

export const jorg_frames_attack1 = makeFrames(
  ai_charge,
  new Array<number>(6).fill(0),
  new Array<GameMonsterFrame["thinkfunc"]>(6).fill(jorg_firebullet)
);
export const jorg_move_attack1: GameMonsterMove = {
  firstframe: FRAME_attak109,
  lastframe: FRAME_attak114,
  frame: jorg_frames_attack1,
  endfunc: jorg_reattack1
};

export const jorg_frames_end_attack1 = makeFrames(ai_move, new Array<number>(4).fill(0));
export const jorg_move_end_attack1: GameMonsterMove = {
  firstframe: FRAME_attak115,
  lastframe: FRAME_attak118,
  frame: jorg_frames_end_attack1,
  endfunc: jorg_run
};

/**
 * Original name: jorg_reattack1
 * Source: game/m_boss31.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Continues the machinegun loop while the enemy is visible and the C `random() < 0.9` check passes.
 */
export function jorg_reattack1(self: GameEntity, runtime: GameRuntime): void {
  if (self.enemy && visible(self, self.enemy, runtime)) {
    if (random() < 0.9) {
      self.monsterinfo.currentmove = jorg_move_attack1;
    } else {
      self.s.sound = 0;
      self.monsterinfo.currentmove = jorg_move_end_attack1;
    }
  } else {
    self.s.sound = 0;
    self.monsterinfo.currentmove = jorg_move_end_attack1;
  }
}

/**
 * Original name: jorg_attack1
 * Source: game/m_boss31.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Enters the looping machinegun attack move after the attack1 startup move.
 */
export function jorg_attack1(self: GameEntity): void {
  self.monsterinfo.currentmove = jorg_move_attack1;
}

/**
 * Original name: jorg_pain
 * Source: game/m_boss31.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies Jorg pain debounce, skin change and random pain suppression/animation choices.
 *
 * Porting notes:
 * - Uses `g_local.random()` for the original C `random()` macro checks.
 */
export function jorg_pain(
  self: GameEntity,
  _other: GameEntity | null,
  _kick: number,
  damage: number,
  runtime: GameRuntime
): void {
  if (self.health < self.max_health / 2) {
    self.s.skinnum = 1;
  }

  self.s.sound = 0;

  if (runtime.time < self.pain_debounce_time) {
    return;
  }

  if (damage <= 40 && random() <= 0.6) {
    return;
  }

  if (self.s.frame >= FRAME_attak101 && self.s.frame <= FRAME_attak108 && random() <= 0.005) {
    return;
  }

  if (self.s.frame >= FRAME_attak109 && self.s.frame <= FRAME_attak114 && random() <= 0.00005) {
    return;
  }

  if (self.s.frame >= FRAME_attak201 && self.s.frame <= FRAME_attak208 && random() <= 0.005) {
    return;
  }

  self.pain_debounce_time = runtime.time + 3;

  if (runtime.skill === 3) {
    return;
  }

  if (damage <= 50) {
    emitRegisteredGameSound(runtime, self, sound_pain1, SOUND_PAIN1, soundOptions(CHAN_VOICE));
    self.monsterinfo.currentmove = jorg_move_pain1;
  } else if (damage <= 100) {
    emitRegisteredGameSound(runtime, self, sound_pain2, SOUND_PAIN2, soundOptions(CHAN_VOICE));
    self.monsterinfo.currentmove = jorg_move_pain2;
  } else if (random() <= 0.3) {
    emitRegisteredGameSound(runtime, self, sound_pain3, SOUND_PAIN3, soundOptions(CHAN_VOICE));
    self.monsterinfo.currentmove = jorg_move_pain3;
  }
}

/**
 * Original name: jorgBFG
 * Source: game/m_boss31.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Fires Jorg's BFG from the original muzzle offset with damage, speed and splash values preserved.
 */
export function jorgBFG(self: GameEntity, runtime: GameRuntime): void {
  if (!self.enemy) {
    return;
  }

  const { forward, right } = AngleVectors(self.s.angles);
  const start = G_ProjectSource(self.s.origin, jorgFlashOffset(MZ2_JORG_BFG_1), forward, right);
  const vec: vec3_t = [...self.enemy.s.origin];
  vec[2] += self.enemy.viewheight;
  const dir = normalizeVec3(subtractVec3(vec, start));

  emitRegisteredGameSound(runtime, self, sound_attack2, SOUND_ATTACK2, soundOptions(CHAN_VOICE));
  monster_fire_bfg(self, start, dir, 50, 300, 100, 200, MZ2_JORG_BFG_1, runtime);
}

/**
 * Original name: jorg_firebullet_right
 * Source: game/m_boss31.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Fires one right-side machinegun bullet from `MZ2_JORG_MACHINEGUN_R1` toward the predicted enemy position.
 */
export function jorg_firebullet_right(self: GameEntity, runtime: GameRuntime): void {
  fireJorgMachinegun(self, MZ2_JORG_MACHINEGUN_R1, runtime);
}

/**
 * Original name: jorg_firebullet_left
 * Source: game/m_boss31.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Fires one left-side machinegun bullet from `MZ2_JORG_MACHINEGUN_L1` toward the predicted enemy position.
 */
export function jorg_firebullet_left(self: GameEntity, runtime: GameRuntime): void {
  fireJorgMachinegun(self, MZ2_JORG_MACHINEGUN_L1, runtime);
}

/**
 * Original name: jorg_firebullet
 * Source: game/m_boss31.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Fires the left machinegun muzzle first, then the right muzzle, matching the source call order.
 */
export function jorg_firebullet(self: GameEntity, runtime: GameRuntime): void {
  jorg_firebullet_left(self, runtime);
  jorg_firebullet_right(self, runtime);
}

/**
 * Original name: N/A
 * Source: N/A (compatibility adapter for the forward-only `jorgMachineGun` declaration in game/m_boss31.c)
 * Category: Adapter
 *
 * Purpose:
 * - Preserve an exported callback name used by older audit/save surfaces while delegating to the validated machinegun port.
 */
export function jorgMachineGun(self: GameEntity, runtime: GameRuntime): void {
  jorg_firebullet(self, runtime);
}

/**
 * Original name: jorg_attack
 * Source: game/m_boss31.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Chooses between Jorg's machinegun and BFG attack moves using the original `random() <= 0.75` split.
 */
export function jorg_attack(self: GameEntity, runtime: GameRuntime): void {
  if (!self.enemy) {
    return;
  }

  if (random() <= 0.75) {
    emitRegisteredGameSound(runtime, self, sound_attack1, SOUND_ATTACK1, soundOptions(CHAN_VOICE));
    self.s.sound = registerGameSound(runtime, SOUND_W_LOOP);
    self.monsterinfo.currentmove = jorg_move_start_attack1;
  } else {
    emitRegisteredGameSound(runtime, self, sound_attack2, SOUND_ATTACK2, soundOptions(CHAN_VOICE));
    self.monsterinfo.currentmove = jorg_move_attack2;
  }
}

/**
 * Original name: jorg_dead
 * Source: game/m_boss31.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Preserves the original no-op body because the corpse/Makron handoff block is compiled out under `#if 0`.
 */
export function jorg_dead(_self: GameEntity): void {
  // Original body is compiled out under `#if 0`; preserve that no-op behavior.
}

/**
 * Original name: jorg_die
 * Source: game/m_boss31.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the death voice sound, clears looping sound/state and enters the 50-frame death move.
 */
export function jorg_die(
  self: GameEntity,
  _inflictor: GameEntity | null,
  _attacker: GameEntity | null,
  _damage: number,
  runtime: GameRuntime
): void {
  emitRegisteredGameSound(runtime, self, sound_death, SOUND_DEATH, soundOptions(CHAN_VOICE));
  self.deadflag = DEAD_DEAD;
  self.takedamage = damage_t.DAMAGE_NO;
  self.s.sound = 0;
  self.count = 0;
  self.monsterinfo.currentmove = jorg_move_death;
}

/**
 * Original name: Jorg_CheckAttack
 * Source: game/m_boss31.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Checks line of sight/range, then uses the C `random()` missile and flying strafe decisions.
 */
export function Jorg_CheckAttack(self: GameEntity, runtime: GameRuntime): boolean {
  if (!self.enemy) {
    return false;
  }

  if (self.enemy.health > 0) {
    const spot1: vec3_t = [...self.s.origin];
    spot1[2] += self.viewheight;
    const spot2: vec3_t = [...self.enemy.s.origin];
    spot2[2] += self.enemy.viewheight;

    const tr = runtime.collision?.trace(spot1, [0, 0, 0], [0, 0, 0], spot2, self, JORG_ATTACK_TRACE_MASK);
    if (!tr || tr.ent !== self.enemy) {
      return false;
    }
  }

  const enemy_range = range(self, self.enemy);
  const temp = subtractVec3(self.enemy.s.origin, self.s.origin);
  self.ideal_yaw = vectoyaw(temp);

  if (enemy_range === RANGE_MELEE) {
    self.monsterinfo.attack_state = self.monsterinfo.melee ? AS_MELEE : AS_MISSILE;
    return true;
  }

  if (!self.monsterinfo.attack) {
    return false;
  }

  if (runtime.time < self.monsterinfo.attack_finished) {
    return false;
  }

  if (enemy_range === RANGE_FAR) {
    return false;
  }

  let chance: number;
  if ((self.monsterinfo.aiflags & AI_STAND_GROUND) !== 0) {
    chance = 0.4;
  } else if (enemy_range === RANGE_MELEE) {
    chance = 0.8;
  } else if (enemy_range === RANGE_NEAR) {
    chance = 0.4;
  } else if (enemy_range === RANGE_MID) {
    chance = 0.2;
  } else {
    return false;
  }

  if (random() < chance) {
    self.monsterinfo.attack_state = AS_MISSILE;
    self.monsterinfo.attack_finished = runtime.time + 2 * random();
    return true;
  }

  if ((self.flags & FL_FLY) !== 0) {
    self.monsterinfo.attack_state = random() < 0.3 ? AS_SLIDING : AS_STRAIGHT;
  }

  return false;
}

/**
 * Original name: SP_monster_jorg
 * Source: game/m_boss31.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns monster_jorg, precaches Jorg assets and initializes walking monster callbacks.
 *
 * Porting notes:
 * - Keeps the original deathmatch early-free branch and uses explicit runtime asset registration.
 */
export function SP_monster_jorg(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  precacheJorgAssets(runtime);
  MakronPrecache(runtime);

  self.movetype = MOVETYPE_STEP;
  self.solid = SOLID_BBOX;
  self.s.modelindex = registerGameModel(runtime, "models/monsters/boss3/rider/tris.md2");
  self.s.modelindex2 = registerGameModel(runtime, "models/monsters/boss3/jorg/tris.md2");
  setVec3(self.mins, -80, -80, 0);
  setVec3(self.maxs, 80, 80, 140);

  self.health = 3000;
  self.gib_health = -2000;
  self.mass = 1000;

  self.pain = jorg_pain;
  self.die = jorg_die;
  self.monsterinfo.stand = jorg_stand;
  self.monsterinfo.walk = jorg_walk;
  self.monsterinfo.run = jorg_run;
  self.monsterinfo.dodge = undefined;
  self.monsterinfo.attack = jorg_attack;
  self.monsterinfo.search = jorg_search;
  self.monsterinfo.melee = undefined;
  self.monsterinfo.sight = undefined;
  self.monsterinfo.checkattack = Jorg_CheckAttack;

  linkGameEntity(runtime, self);

  self.monsterinfo.currentmove = jorg_move_stand;
  self.monsterinfo.scale = MODEL_SCALE;

  walkmonster_start(self, runtime);
}

/**
 * Original name: N/A
 * Source: N/A (local declarative frame helper)
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
 * Source: N/A (local declarative frame helper)
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
 * Source: N/A (runtime asset registration helper)
 * Category: New
 */
function precacheJorgAssets(runtime: GameRuntime): void {
  sound_pain1 = registerGameSound(runtime, SOUND_PAIN1);
  sound_pain2 = registerGameSound(runtime, SOUND_PAIN2);
  sound_pain3 = registerGameSound(runtime, SOUND_PAIN3);
  sound_death = registerGameSound(runtime, SOUND_DEATH);
  sound_attack1 = registerGameSound(runtime, SOUND_ATTACK1);
  sound_attack2 = registerGameSound(runtime, SOUND_ATTACK2);
  sound_search1 = registerGameSound(runtime, SOUND_SEARCH1);
  sound_search2 = registerGameSound(runtime, SOUND_SEARCH2);
  sound_search3 = registerGameSound(runtime, SOUND_SEARCH3);
  sound_idle = registerGameSound(runtime, SOUND_IDLE);
  sound_step_left = registerGameSound(runtime, SOUND_STEP_LEFT);
  sound_step_right = registerGameSound(runtime, SOUND_STEP_RIGHT);
  sound_firegun = registerGameSound(runtime, SOUND_FIREGUN);
  sound_death_hit = registerGameSound(runtime, SOUND_DEATH_HIT);
}

/**
 * Original name: N/A
 * Source: N/A (shared local machinegun helper)
 * Category: New
 */
function fireJorgMachinegun(self: GameEntity, flashNumber: number, runtime: GameRuntime): void {
  if (!self.enemy) {
    return;
  }

  const { forward, right } = AngleVectors(self.s.angles);
  const start = G_ProjectSource(self.s.origin, jorgFlashOffset(flashNumber), forward, right);
  const target = vectorMA(self.enemy.s.origin, -0.2, self.enemy.velocity);
  target[2] += self.enemy.viewheight;
  const aim = normalizeVec3(subtractVec3(target, start));

  monster_fire_bullet(
    self,
    start,
    aim,
    6,
    4,
    DEFAULT_BULLET_HSPREAD,
    DEFAULT_BULLET_VSPREAD,
    flashNumber,
    runtime
  );
}

/**
 * Original name: N/A
 * Source: N/A (local sound option helper)
 * Category: New
 */
function soundOptions(channel: number): { channel: number; volume: number; attenuation: number; timeofs: number } {
  return {
    channel,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (local flash offset adapter)
 * Category: New
 */
function jorgFlashOffset(flashNumber: number): vec3_t {
  return getMonsterFlashOffset(flashNumber);
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
function vectorMA(veca: vec3_t, scale: number, vecb: vec3_t): vec3_t {
  return [veca[0] + scale * vecb[0], veca[1] + scale * vecb[1], veca[2] + scale * vecb[2]];
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 */
function normalizeVec3(vector: vec3_t): vec3_t {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length === 0) {
    return [0, 0, 0];
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}
