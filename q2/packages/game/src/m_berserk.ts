/**
 * File: m_berserk.ts
 * Source: Quake-2-master/game/m_berserk.h and Quake-2-master/game/m_berserk.c
 * Purpose: Port of the generated berserk model frame constants and monster_berserk gameplay behavior.
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
 * - This file keeps the header constants and C behavior together as the principal attachment point for `m_berserk`.
 */

import { ATTN_IDLE, ATTN_NORM, CHAN_VOICE, CHAN_WEAPON, type vec3_t } from "../../qcommon/src/index.js";
import {
  AI_STAND_GROUND,
  DEAD_DEAD,
  GIB_ORGANIC,
  MELEE_DISTANCE,
  MOVETYPE_STEP,
  MOVETYPE_TOSS,
  SOLID_BBOX,
  SVF_DEADMONSTER,
  random,
  damage_t
} from "./g_local.js";
import { ai_charge, ai_move, ai_run, ai_stand, ai_walk } from "./g_ai.js";
import { walkmonster_start } from "./g_monster.js";
import { ThrowGib, ThrowHead } from "./g_misc.js";
import { G_FreeEdict } from "./g_utils.js";
import { fire_hit } from "./g_weapon.js";
import {
  emitGameSound,
  emitRegisteredGameSound,
  linkGameEntity,
  registerGameModel,
  registerGameSound,
  type GameEntity,
  type GameMonsterFrame,
  type GameMonsterMove,
  type GameRuntime
} from "./runtime.js";

/**
 * Original name: FRAME_* and MODEL_SCALE
 * Source: Quake-2-master/game/m_berserk.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - ModelGen frame macros for the berserk MD2 model, kept as numeric constants.
 */
export const FRAME_stand1 = 0;
export const FRAME_stand2 = 1;
export const FRAME_stand3 = 2;
export const FRAME_stand4 = 3;
export const FRAME_stand5 = 4;
export const FRAME_standb1 = 5;
export const FRAME_standb2 = 6;
export const FRAME_standb3 = 7;
export const FRAME_standb4 = 8;
export const FRAME_standb5 = 9;
export const FRAME_standb6 = 10;
export const FRAME_standb7 = 11;
export const FRAME_standb8 = 12;
export const FRAME_standb9 = 13;
export const FRAME_standb10 = 14;
export const FRAME_standb11 = 15;
export const FRAME_standb12 = 16;
export const FRAME_standb13 = 17;
export const FRAME_standb14 = 18;
export const FRAME_standb15 = 19;
export const FRAME_standb16 = 20;
export const FRAME_standb17 = 21;
export const FRAME_standb18 = 22;
export const FRAME_standb19 = 23;
export const FRAME_standb20 = 24;
export const FRAME_walkc1 = 25;
export const FRAME_walkc2 = 26;
export const FRAME_walkc3 = 27;
export const FRAME_walkc4 = 28;
export const FRAME_walkc5 = 29;
export const FRAME_walkc6 = 30;
export const FRAME_walkc7 = 31;
export const FRAME_walkc8 = 32;
export const FRAME_walkc9 = 33;
export const FRAME_walkc10 = 34;
export const FRAME_walkc11 = 35;
export const FRAME_run1 = 36;
export const FRAME_run2 = 37;
export const FRAME_run3 = 38;
export const FRAME_run4 = 39;
export const FRAME_run5 = 40;
export const FRAME_run6 = 41;
export const FRAME_att_a1 = 42;
export const FRAME_att_a2 = 43;
export const FRAME_att_a3 = 44;
export const FRAME_att_a4 = 45;
export const FRAME_att_a5 = 46;
export const FRAME_att_a6 = 47;
export const FRAME_att_a7 = 48;
export const FRAME_att_a8 = 49;
export const FRAME_att_a9 = 50;
export const FRAME_att_a10 = 51;
export const FRAME_att_a11 = 52;
export const FRAME_att_a12 = 53;
export const FRAME_att_a13 = 54;
export const FRAME_att_b1 = 55;
export const FRAME_att_b2 = 56;
export const FRAME_att_b3 = 57;
export const FRAME_att_b4 = 58;
export const FRAME_att_b5 = 59;
export const FRAME_att_b6 = 60;
export const FRAME_att_b7 = 61;
export const FRAME_att_b8 = 62;
export const FRAME_att_b9 = 63;
export const FRAME_att_b10 = 64;
export const FRAME_att_b11 = 65;
export const FRAME_att_b12 = 66;
export const FRAME_att_b13 = 67;
export const FRAME_att_b14 = 68;
export const FRAME_att_b15 = 69;
export const FRAME_att_b16 = 70;
export const FRAME_att_b17 = 71;
export const FRAME_att_b18 = 72;
export const FRAME_att_b19 = 73;
export const FRAME_att_b20 = 74;
export const FRAME_att_b21 = 75;
export const FRAME_att_c1 = 76;
export const FRAME_att_c2 = 77;
export const FRAME_att_c3 = 78;
export const FRAME_att_c4 = 79;
export const FRAME_att_c5 = 80;
export const FRAME_att_c6 = 81;
export const FRAME_att_c7 = 82;
export const FRAME_att_c8 = 83;
export const FRAME_att_c9 = 84;
export const FRAME_att_c10 = 85;
export const FRAME_att_c11 = 86;
export const FRAME_att_c12 = 87;
export const FRAME_att_c13 = 88;
export const FRAME_att_c14 = 89;
export const FRAME_att_c15 = 90;
export const FRAME_att_c16 = 91;
export const FRAME_att_c17 = 92;
export const FRAME_att_c18 = 93;
export const FRAME_att_c19 = 94;
export const FRAME_att_c20 = 95;
export const FRAME_att_c21 = 96;
export const FRAME_att_c22 = 97;
export const FRAME_att_c23 = 98;
export const FRAME_att_c24 = 99;
export const FRAME_att_c25 = 100;
export const FRAME_att_c26 = 101;
export const FRAME_att_c27 = 102;
export const FRAME_att_c28 = 103;
export const FRAME_att_c29 = 104;
export const FRAME_att_c30 = 105;
export const FRAME_att_c31 = 106;
export const FRAME_att_c32 = 107;
export const FRAME_att_c33 = 108;
export const FRAME_att_c34 = 109;
export const FRAME_r_att1 = 110;
export const FRAME_r_att2 = 111;
export const FRAME_r_att3 = 112;
export const FRAME_r_att4 = 113;
export const FRAME_r_att5 = 114;
export const FRAME_r_att6 = 115;
export const FRAME_r_att7 = 116;
export const FRAME_r_att8 = 117;
export const FRAME_r_att9 = 118;
export const FRAME_r_att10 = 119;
export const FRAME_r_att11 = 120;
export const FRAME_r_att12 = 121;
export const FRAME_r_att13 = 122;
export const FRAME_r_att14 = 123;
export const FRAME_r_att15 = 124;
export const FRAME_r_att16 = 125;
export const FRAME_r_att17 = 126;
export const FRAME_r_att18 = 127;
export const FRAME_r_attb1 = 128;
export const FRAME_r_attb2 = 129;
export const FRAME_r_attb3 = 130;
export const FRAME_r_attb4 = 131;
export const FRAME_r_attb5 = 132;
export const FRAME_r_attb6 = 133;
export const FRAME_r_attb7 = 134;
export const FRAME_r_attb8 = 135;
export const FRAME_r_attb9 = 136;
export const FRAME_r_attb10 = 137;
export const FRAME_r_attb11 = 138;
export const FRAME_r_attb12 = 139;
export const FRAME_r_attb13 = 140;
export const FRAME_r_attb14 = 141;
export const FRAME_r_attb15 = 142;
export const FRAME_r_attb16 = 143;
export const FRAME_r_attb17 = 144;
export const FRAME_r_attb18 = 145;
export const FRAME_slam1 = 146;
export const FRAME_slam2 = 147;
export const FRAME_slam3 = 148;
export const FRAME_slam4 = 149;
export const FRAME_slam5 = 150;
export const FRAME_slam6 = 151;
export const FRAME_slam7 = 152;
export const FRAME_slam8 = 153;
export const FRAME_slam9 = 154;
export const FRAME_slam10 = 155;
export const FRAME_slam11 = 156;
export const FRAME_slam12 = 157;
export const FRAME_slam13 = 158;
export const FRAME_slam14 = 159;
export const FRAME_slam15 = 160;
export const FRAME_slam16 = 161;
export const FRAME_slam17 = 162;
export const FRAME_slam18 = 163;
export const FRAME_slam19 = 164;
export const FRAME_slam20 = 165;
export const FRAME_slam21 = 166;
export const FRAME_slam22 = 167;
export const FRAME_slam23 = 168;
export const FRAME_duck1 = 169;
export const FRAME_duck2 = 170;
export const FRAME_duck3 = 171;
export const FRAME_duck4 = 172;
export const FRAME_duck5 = 173;
export const FRAME_duck6 = 174;
export const FRAME_duck7 = 175;
export const FRAME_duck8 = 176;
export const FRAME_duck9 = 177;
export const FRAME_duck10 = 178;
export const FRAME_fall1 = 179;
export const FRAME_fall2 = 180;
export const FRAME_fall3 = 181;
export const FRAME_fall4 = 182;
export const FRAME_fall5 = 183;
export const FRAME_fall6 = 184;
export const FRAME_fall7 = 185;
export const FRAME_fall8 = 186;
export const FRAME_fall9 = 187;
export const FRAME_fall10 = 188;
export const FRAME_fall11 = 189;
export const FRAME_fall12 = 190;
export const FRAME_fall13 = 191;
export const FRAME_fall14 = 192;
export const FRAME_fall15 = 193;
export const FRAME_fall16 = 194;
export const FRAME_fall17 = 195;
export const FRAME_fall18 = 196;
export const FRAME_fall19 = 197;
export const FRAME_fall20 = 198;
export const FRAME_painc1 = 199;
export const FRAME_painc2 = 200;
export const FRAME_painc3 = 201;
export const FRAME_painc4 = 202;
export const FRAME_painb1 = 203;
export const FRAME_painb2 = 204;
export const FRAME_painb3 = 205;
export const FRAME_painb4 = 206;
export const FRAME_painb5 = 207;
export const FRAME_painb6 = 208;
export const FRAME_painb7 = 209;
export const FRAME_painb8 = 210;
export const FRAME_painb9 = 211;
export const FRAME_painb10 = 212;
export const FRAME_painb11 = 213;
export const FRAME_painb12 = 214;
export const FRAME_painb13 = 215;
export const FRAME_painb14 = 216;
export const FRAME_painb15 = 217;
export const FRAME_painb16 = 218;
export const FRAME_painb17 = 219;
export const FRAME_painb18 = 220;
export const FRAME_painb19 = 221;
export const FRAME_painb20 = 222;
export const FRAME_death1 = 223;
export const FRAME_death2 = 224;
export const FRAME_death3 = 225;
export const FRAME_death4 = 226;
export const FRAME_death5 = 227;
export const FRAME_death6 = 228;
export const FRAME_death7 = 229;
export const FRAME_death8 = 230;
export const FRAME_death9 = 231;
export const FRAME_death10 = 232;
export const FRAME_death11 = 233;
export const FRAME_death12 = 234;
export const FRAME_death13 = 235;
export const FRAME_deathc1 = 236;
export const FRAME_deathc2 = 237;
export const FRAME_deathc3 = 238;
export const FRAME_deathc4 = 239;
export const FRAME_deathc5 = 240;
export const FRAME_deathc6 = 241;
export const FRAME_deathc7 = 242;
export const FRAME_deathc8 = 243;

export const MODEL_SCALE = 1.0;

/**
 * Original name: sound_pain/sound_die/sound_idle/sound_punch/sound_search/sound_sight
 * Source: Quake-2-master/game/m_berserk.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Sound asset names registered by `SP_monster_berserk`, separated from runtime handles for web-safe sound routing.
 */
const SOUND_PAIN = "berserk/berpain2.wav";
const SOUND_DIE = "berserk/berdeth2.wav";
const SOUND_IDLE = "berserk/beridle1.wav";
const SOUND_PUNCH = "berserk/attack.wav";
const SOUND_SEARCH = "berserk/bersrch1.wav";
const SOUND_SIGHT = "berserk/sight.wav";

/**
 * Original name: N/A
 * Source: N/A (runtime sound handles)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose:
 * - Store registered sound indices returned by the TypeScript runtime.
 */
let sound_pain = 0;
let sound_die = 0;
let sound_idle = 0;
let sound_punch = 0;
let sound_sight = 0;
let sound_search = 0;

/**
 * Original name: berserk_sight
 * Source: Quake-2-master/game/m_berserk.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Plays the berserk sight sound on target acquisition.
 */
export function berserk_sight(self: GameEntity, _other: GameEntity | null, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_sight, SOUND_SIGHT, {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
}

/**
 * Original name: berserk_search
 * Source: Quake-2-master/game/m_berserk.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Plays the berserk search sound while looking for a target.
 */
export function berserk_search(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_search, SOUND_SEARCH, {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
}

const berserk_frames_stand = makeFrames(
  ai_stand,
  new Array<number>(5).fill(0),
  indexedThinks(5, [[0, berserk_fidget]])
);
export const berserk_move_stand: GameMonsterMove = {
  firstframe: FRAME_stand1,
  lastframe: FRAME_stand5,
  frame: berserk_frames_stand,
  endfunc: undefined
};

/**
 * Original name: berserk_stand
 * Source: Quake-2-master/game/m_berserk.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Sets the berserk to its standing loop.
 */
export function berserk_stand(self: GameEntity): void {
  self.monsterinfo.currentmove = berserk_move_stand;
}

const berserk_frames_stand_fidget = makeFrames(ai_stand, new Array<number>(20).fill(0));
export const berserk_move_stand_fidget: GameMonsterMove = {
  firstframe: FRAME_standb1,
  lastframe: FRAME_standb20,
  frame: berserk_frames_stand_fidget,
  endfunc: berserk_stand
};

/**
 * Original name: berserk_fidget
 * Source: Quake-2-master/game/m_berserk.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Randomly switches from stand to the fidget animation unless standing ground.
 *
 * Porting notes:
 * - Uses `g_local.random()` to preserve the C macro's 15-bit quantization.
 */
export function berserk_fidget(self: GameEntity, runtime: GameRuntime): void {
  if ((self.monsterinfo.aiflags & AI_STAND_GROUND) !== 0) {
    return;
  }
  if (random() > 0.15) {
    return;
  }

  self.monsterinfo.currentmove = berserk_move_stand_fidget;
  emitRegisteredGameSound(runtime, self, sound_idle, SOUND_IDLE, {
    channel: CHAN_WEAPON,
    volume: 1,
    attenuation: ATTN_IDLE,
    timeofs: 0
  });
}

const berserk_frames_walk = makeFrames(ai_walk, [
  9.1, 6.3, 4.9, 6.7, 6.0, 8.2, 7.2, 6.1, 4.9, 4.7, 4.7, 4.8
]);
export const berserk_move_walk: GameMonsterMove = {
  firstframe: FRAME_walkc1,
  lastframe: FRAME_walkc11,
  frame: berserk_frames_walk,
  endfunc: undefined
};

/**
 * Original name: berserk_walk
 * Source: Quake-2-master/game/m_berserk.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Starts the berserk walk loop.
 */
export function berserk_walk(self: GameEntity): void {
  self.monsterinfo.currentmove = berserk_move_walk;
}

const berserk_frames_run1 = makeFrames(ai_run, [21, 11, 21, 25, 18, 19]);
export const berserk_move_run1: GameMonsterMove = {
  firstframe: FRAME_run1,
  lastframe: FRAME_run6,
  frame: berserk_frames_run1,
  endfunc: undefined
};

/**
 * Original name: berserk_run
 * Source: Quake-2-master/game/m_berserk.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Uses stand animation while holding ground, otherwise enters the run loop.
 */
export function berserk_run(self: GameEntity): void {
  if ((self.monsterinfo.aiflags & AI_STAND_GROUND) !== 0) {
    self.monsterinfo.currentmove = berserk_move_stand;
  } else {
    self.monsterinfo.currentmove = berserk_move_run1;
  }
}

/**
 * Original name: berserk_attack_spike
 * Source: Quake-2-master/game/m_berserk.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Performs the fast upward melee hit with original damage range and kick.
 *
 * Porting notes:
 * - `rand() % 6` is represented by `randomInt(6)` while preserving the source damage range.
 */
export function berserk_attack_spike(self: GameEntity, runtime: GameRuntime): void {
  const aim: vec3_t = [MELEE_DISTANCE, 0, -24];
  fire_hit(self, aim, 15 + randomInt(6), 400, runtime);
}

/**
 * Original name: berserk_swing
 * Source: Quake-2-master/game/m_berserk.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Queues the berserk punch swing sound with the original channel and attenuation.
 */
export function berserk_swing(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_punch, SOUND_PUNCH, {
    channel: CHAN_WEAPON,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
}

const berserk_frames_attack_spike = makeFrames(
  ai_charge,
  new Array<number>(8).fill(0),
  indexedThinks(8, [
    [2, berserk_swing],
    [3, berserk_attack_spike]
  ])
);
export const berserk_move_attack_spike: GameMonsterMove = {
  firstframe: FRAME_att_c1,
  lastframe: FRAME_att_c8,
  frame: berserk_frames_attack_spike,
  endfunc: berserk_run
};

/**
 * Original name: berserk_attack_club
 * Source: Quake-2-master/game/m_berserk.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Performs the slower club melee hit with original damage range and kick.
 */
export function berserk_attack_club(self: GameEntity, runtime: GameRuntime): void {
  const aim: vec3_t = [MELEE_DISTANCE, self.mins[0], -4];
  fire_hit(self, aim, 5 + randomInt(6), 400, runtime);
}

const berserk_frames_attack_club = makeFrames(
  ai_charge,
  new Array<number>(12).fill(0),
  indexedThinks(12, [
    [4, berserk_swing],
    [8, berserk_attack_club]
  ])
);
export const berserk_move_attack_club: GameMonsterMove = {
  firstframe: FRAME_att_c9,
  lastframe: FRAME_att_c20,
  frame: berserk_frames_attack_club,
  endfunc: berserk_run
};

/**
 * Original name: berserk_strike
 * Source: Quake-2-master/game/m_berserk.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Placeholder matching the original empty FIXME impact-sound hook.
 */
export function berserk_strike(_self: GameEntity): void {
}

const berserk_frames_attack_strike = makeFrames(
  ai_move,
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 9.7, 13.6],
  indexedThinks(14, [
    [3, berserk_swing],
    [7, berserk_strike]
  ])
);
export const berserk_move_attack_strike: GameMonsterMove = {
  firstframe: FRAME_att_c21,
  lastframe: FRAME_att_c34,
  frame: berserk_frames_attack_strike,
  endfunc: berserk_run
};

/**
 * Original name: berserk_melee
 * Source: Quake-2-master/game/m_berserk.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Randomly starts either the spike or club melee animation.
 */
export function berserk_melee(self: GameEntity): void {
  if (randomInt(2) === 0) {
    self.monsterinfo.currentmove = berserk_move_attack_spike;
  } else {
    self.monsterinfo.currentmove = berserk_move_attack_club;
  }
}

const berserk_frames_pain1 = makeFrames(ai_move, new Array<number>(4).fill(0));
export const berserk_move_pain1: GameMonsterMove = {
  firstframe: FRAME_painc1,
  lastframe: FRAME_painc4,
  frame: berserk_frames_pain1,
  endfunc: berserk_run
};

const berserk_frames_pain2 = makeFrames(ai_move, new Array<number>(20).fill(0));
export const berserk_move_pain2: GameMonsterMove = {
  firstframe: FRAME_painb1,
  lastframe: FRAME_painb20,
  frame: berserk_frames_pain2,
  endfunc: berserk_run
};

/**
 * Original name: berserk_pain
 * Source: Quake-2-master/game/m_berserk.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies damaged skin, pain debounce, nightmare suppression and damage/random pain move selection.
 *
 * Porting notes:
 * - Uses `g_local.random()` to preserve the C macro's 15-bit quantization.
 */
export function berserk_pain(
  self: GameEntity,
  _other: GameEntity | null,
  _kick: number,
  damage: number,
  runtime: GameRuntime
): void {
  if (self.health < (self.max_health / 2)) {
    self.s.skinnum = 1;
  }

  if (runtime.time < self.pain_debounce_time) {
    return;
  }

  self.pain_debounce_time = runtime.time + 3;
  emitRegisteredGameSound(runtime, self, sound_pain, SOUND_PAIN, {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });

  if (runtime.skill === 3) {
    return;
  }

  if (damage < 20 || random() < 0.5) {
    self.monsterinfo.currentmove = berserk_move_pain1;
  } else {
    self.monsterinfo.currentmove = berserk_move_pain2;
  }
}

/**
 * Original name: berserk_dead
 * Source: Quake-2-master/game/m_berserk.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Finalizes the berserk corpse bbox, movetype, dead-monster flag and link state.
 */
export function berserk_dead(self: GameEntity, runtime: GameRuntime): void {
  setVec3(self.mins, -16, -16, -24);
  setVec3(self.maxs, 16, 16, -8);
  self.movetype = MOVETYPE_TOSS;
  self.svflags |= SVF_DEADMONSTER;
  self.nextthink = 0;
  linkGameEntity(runtime, self);
}

const berserk_frames_death1 = makeFrames(ai_move, new Array<number>(13).fill(0));
export const berserk_move_death1: GameMonsterMove = {
  firstframe: FRAME_death1,
  lastframe: FRAME_death13,
  frame: berserk_frames_death1,
  endfunc: berserk_dead
};

const berserk_frames_death2 = makeFrames(ai_move, new Array<number>(8).fill(0));
export const berserk_move_death2: GameMonsterMove = {
  firstframe: FRAME_deathc1,
  lastframe: FRAME_deathc8,
  frame: berserk_frames_death2,
  endfunc: berserk_dead
};

/**
 * Original name: berserk_die
 * Source: Quake-2-master/game/m_berserk.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Handles gib death, ordinary death sound and damage-sized death animation selection.
 */
export function berserk_die(
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

  emitRegisteredGameSound(runtime, self, sound_die, SOUND_DIE, {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
  self.deadflag = DEAD_DEAD;
  self.takedamage = damage_t.DAMAGE_YES;

  if (damage >= 50) {
    self.monsterinfo.currentmove = berserk_move_death1;
  } else {
    self.monsterinfo.currentmove = berserk_move_death2;
  }
}

/**
 * Original name: SP_monster_berserk
 * Source: Quake-2-master/game/m_berserk.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns monster_berserk, precaches assets and initializes walking monster callbacks.
 */
export function SP_monster_berserk(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  precacheBerserkAssets(runtime);

  self.s.modelindex = registerGameModel(runtime, "models/monsters/berserk/tris.md2");
  setVec3(self.mins, -16, -16, -24);
  setVec3(self.maxs, 16, 16, 32);
  self.movetype = MOVETYPE_STEP;
  self.solid = SOLID_BBOX;

  self.health = 240;
  self.gib_health = -60;
  self.mass = 250;

  self.pain = berserk_pain;
  self.die = berserk_die;

  self.monsterinfo.stand = berserk_stand;
  self.monsterinfo.walk = berserk_walk;
  self.monsterinfo.run = berserk_run;
  self.monsterinfo.dodge = undefined;
  self.monsterinfo.attack = undefined;
  self.monsterinfo.melee = berserk_melee;
  self.monsterinfo.sight = berserk_sight;
  self.monsterinfo.search = berserk_search;

  self.monsterinfo.currentmove = berserk_move_stand;
  self.monsterinfo.scale = MODEL_SCALE;

  linkGameEntity(runtime, self);

  walkmonster_start(self, runtime);
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose:
 * - Build TypeScript `mframe_t` equivalents from compact distance and callback tables.
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
 * Fidelity level: NewTooling
 *
 * Purpose:
 * - Place sparse think callbacks into frame-indexed arrays.
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
 * Source: N/A (local helper)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose:
 * - Register berserk assets through the explicit runtime instead of `gi.soundindex`.
 */
function precacheBerserkAssets(runtime: GameRuntime): void {
  sound_pain = registerGameSound(runtime, SOUND_PAIN);
  sound_die = registerGameSound(runtime, SOUND_DIE);
  sound_idle = registerGameSound(runtime, SOUND_IDLE);
  sound_punch = registerGameSound(runtime, SOUND_PUNCH);
  sound_search = registerGameSound(runtime, SOUND_SEARCH);
  sound_sight = registerGameSound(runtime, SOUND_SIGHT);
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose:
 * - Local equivalent of `VectorSet` for mutable tuple fields.
 */
function setVec3(vector: [number, number, number], x: number, y: number, z: number): void {
  vector[0] = x;
  vector[1] = y;
  vector[2] = z;
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose:
 * - Express local `rand() % n` choices where exact libc RNG state is not shared.
 */
function randomInt(maxExclusive: number): number {
  return Math.trunc(Math.random() * maxExclusive);
}
