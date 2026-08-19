/**
 * File: m_insane.ts
 * Source: Quake II original / game/m_insane.h and game/m_insane.c
 * Purpose: Port of the generated insane model frame constants and misc_insane gameplay behavior.
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
 * - This file keeps the header constants and C behavior together as the principal attachment point for `m_insane`.
 */

import { ATTN_IDLE, CHAN_VOICE } from "../../qcommon/src/index.js";
import {
  AI_GOOD_GUY,
  AI_STAND_GROUND,
  DEAD_DEAD,
  FL_FLY,
  FL_NO_KNOCKBACK,
  GIB_ORGANIC,
  MOVETYPE_STEP,
  MOVETYPE_TOSS,
  SOLID_BBOX,
  SVF_DEADMONSTER,
  damage_t,
  random
} from "./g_local.js";
import { ai_move, ai_stand, ai_walk } from "./g_ai.js";
import { ThrowGib, ThrowHead } from "./g_misc.js";
import { flymonster_start, walkmonster_start } from "./g_monster.js";
import { G_FreeEdict } from "./g_utils.js";
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

export const FRAME_stand1 = 0;
export const FRAME_stand2 = 1;
export const FRAME_stand3 = 2;
export const FRAME_stand4 = 3;
export const FRAME_stand5 = 4;
export const FRAME_stand6 = 5;
export const FRAME_stand7 = 6;
export const FRAME_stand8 = 7;
export const FRAME_stand9 = 8;
export const FRAME_stand10 = 9;
export const FRAME_stand11 = 10;
export const FRAME_stand12 = 11;
export const FRAME_stand13 = 12;
export const FRAME_stand14 = 13;
export const FRAME_stand15 = 14;
export const FRAME_stand16 = 15;
export const FRAME_stand17 = 16;
export const FRAME_stand18 = 17;
export const FRAME_stand19 = 18;
export const FRAME_stand20 = 19;
export const FRAME_stand21 = 20;
export const FRAME_stand22 = 21;
export const FRAME_stand23 = 22;
export const FRAME_stand24 = 23;
export const FRAME_stand25 = 24;
export const FRAME_stand26 = 25;
export const FRAME_stand27 = 26;
export const FRAME_stand28 = 27;
export const FRAME_stand29 = 28;
export const FRAME_stand30 = 29;
export const FRAME_stand31 = 30;
export const FRAME_stand32 = 31;
export const FRAME_stand33 = 32;
export const FRAME_stand34 = 33;
export const FRAME_stand35 = 34;
export const FRAME_stand36 = 35;
export const FRAME_stand37 = 36;
export const FRAME_stand38 = 37;
export const FRAME_stand39 = 38;
export const FRAME_stand40 = 39;
export const FRAME_stand41 = 40;
export const FRAME_stand42 = 41;
export const FRAME_stand43 = 42;
export const FRAME_stand44 = 43;
export const FRAME_stand45 = 44;
export const FRAME_stand46 = 45;
export const FRAME_stand47 = 46;
export const FRAME_stand48 = 47;
export const FRAME_stand49 = 48;
export const FRAME_stand50 = 49;
export const FRAME_stand51 = 50;
export const FRAME_stand52 = 51;
export const FRAME_stand53 = 52;
export const FRAME_stand54 = 53;
export const FRAME_stand55 = 54;
export const FRAME_stand56 = 55;
export const FRAME_stand57 = 56;
export const FRAME_stand58 = 57;
export const FRAME_stand59 = 58;
export const FRAME_stand60 = 59;
export const FRAME_stand61 = 60;
export const FRAME_stand62 = 61;
export const FRAME_stand63 = 62;
export const FRAME_stand64 = 63;
export const FRAME_stand65 = 64;
export const FRAME_stand66 = 65;
export const FRAME_stand67 = 66;
export const FRAME_stand68 = 67;
export const FRAME_stand69 = 68;
export const FRAME_stand70 = 69;
export const FRAME_stand71 = 70;
export const FRAME_stand72 = 71;
export const FRAME_stand73 = 72;
export const FRAME_stand74 = 73;
export const FRAME_stand75 = 74;
export const FRAME_stand76 = 75;
export const FRAME_stand77 = 76;
export const FRAME_stand78 = 77;
export const FRAME_stand79 = 78;
export const FRAME_stand80 = 79;
export const FRAME_stand81 = 80;
export const FRAME_stand82 = 81;
export const FRAME_stand83 = 82;
export const FRAME_stand84 = 83;
export const FRAME_stand85 = 84;
export const FRAME_stand86 = 85;
export const FRAME_stand87 = 86;
export const FRAME_stand88 = 87;
export const FRAME_stand89 = 88;
export const FRAME_stand90 = 89;
export const FRAME_stand91 = 90;
export const FRAME_stand92 = 91;
export const FRAME_stand93 = 92;
export const FRAME_stand94 = 93;
export const FRAME_stand95 = 94;
export const FRAME_stand96 = 95;
export const FRAME_stand97 = 96;
export const FRAME_stand98 = 97;
export const FRAME_stand99 = 98;
export const FRAME_stand100 = 99;
export const FRAME_stand101 = 100;
export const FRAME_stand102 = 101;
export const FRAME_stand103 = 102;
export const FRAME_stand104 = 103;
export const FRAME_stand105 = 104;
export const FRAME_stand106 = 105;
export const FRAME_stand107 = 106;
export const FRAME_stand108 = 107;
export const FRAME_stand109 = 108;
export const FRAME_stand110 = 109;
export const FRAME_stand111 = 110;
export const FRAME_stand112 = 111;
export const FRAME_stand113 = 112;
export const FRAME_stand114 = 113;
export const FRAME_stand115 = 114;
export const FRAME_stand116 = 115;
export const FRAME_stand117 = 116;
export const FRAME_stand118 = 117;
export const FRAME_stand119 = 118;
export const FRAME_stand120 = 119;
export const FRAME_stand121 = 120;
export const FRAME_stand122 = 121;
export const FRAME_stand123 = 122;
export const FRAME_stand124 = 123;
export const FRAME_stand125 = 124;
export const FRAME_stand126 = 125;
export const FRAME_stand127 = 126;
export const FRAME_stand128 = 127;
export const FRAME_stand129 = 128;
export const FRAME_stand130 = 129;
export const FRAME_stand131 = 130;
export const FRAME_stand132 = 131;
export const FRAME_stand133 = 132;
export const FRAME_stand134 = 133;
export const FRAME_stand135 = 134;
export const FRAME_stand136 = 135;
export const FRAME_stand137 = 136;
export const FRAME_stand138 = 137;
export const FRAME_stand139 = 138;
export const FRAME_stand140 = 139;
export const FRAME_stand141 = 140;
export const FRAME_stand142 = 141;
export const FRAME_stand143 = 142;
export const FRAME_stand144 = 143;
export const FRAME_stand145 = 144;
export const FRAME_stand146 = 145;
export const FRAME_stand147 = 146;
export const FRAME_stand148 = 147;
export const FRAME_stand149 = 148;
export const FRAME_stand150 = 149;
export const FRAME_stand151 = 150;
export const FRAME_stand152 = 151;
export const FRAME_stand153 = 152;
export const FRAME_stand154 = 153;
export const FRAME_stand155 = 154;
export const FRAME_stand156 = 155;
export const FRAME_stand157 = 156;
export const FRAME_stand158 = 157;
export const FRAME_stand159 = 158;
export const FRAME_stand160 = 159;
export const FRAME_walk27 = 160;
export const FRAME_walk28 = 161;
export const FRAME_walk29 = 162;
export const FRAME_walk30 = 163;
export const FRAME_walk31 = 164;
export const FRAME_walk32 = 165;
export const FRAME_walk33 = 166;
export const FRAME_walk34 = 167;
export const FRAME_walk35 = 168;
export const FRAME_walk36 = 169;
export const FRAME_walk37 = 170;
export const FRAME_walk38 = 171;
export const FRAME_walk39 = 172;
export const FRAME_walk1 = 173;
export const FRAME_walk2 = 174;
export const FRAME_walk3 = 175;
export const FRAME_walk4 = 176;
export const FRAME_walk5 = 177;
export const FRAME_walk6 = 178;
export const FRAME_walk7 = 179;
export const FRAME_walk8 = 180;
export const FRAME_walk9 = 181;
export const FRAME_walk10 = 182;
export const FRAME_walk11 = 183;
export const FRAME_walk12 = 184;
export const FRAME_walk13 = 185;
export const FRAME_walk14 = 186;
export const FRAME_walk15 = 187;
export const FRAME_walk16 = 188;
export const FRAME_walk17 = 189;
export const FRAME_walk18 = 190;
export const FRAME_walk19 = 191;
export const FRAME_walk20 = 192;
export const FRAME_walk21 = 193;
export const FRAME_walk22 = 194;
export const FRAME_walk23 = 195;
export const FRAME_walk24 = 196;
export const FRAME_walk25 = 197;
export const FRAME_walk26 = 198;
export const FRAME_st_pain2 = 199;
export const FRAME_st_pain3 = 200;
export const FRAME_st_pain4 = 201;
export const FRAME_st_pain5 = 202;
export const FRAME_st_pain6 = 203;
export const FRAME_st_pain7 = 204;
export const FRAME_st_pain8 = 205;
export const FRAME_st_pain9 = 206;
export const FRAME_st_pain10 = 207;
export const FRAME_st_pain11 = 208;
export const FRAME_st_pain12 = 209;
export const FRAME_st_death2 = 210;
export const FRAME_st_death3 = 211;
export const FRAME_st_death4 = 212;
export const FRAME_st_death5 = 213;
export const FRAME_st_death6 = 214;
export const FRAME_st_death7 = 215;
export const FRAME_st_death8 = 216;
export const FRAME_st_death9 = 217;
export const FRAME_st_death10 = 218;
export const FRAME_st_death11 = 219;
export const FRAME_st_death12 = 220;
export const FRAME_st_death13 = 221;
export const FRAME_st_death14 = 222;
export const FRAME_st_death15 = 223;
export const FRAME_st_death16 = 224;
export const FRAME_st_death17 = 225;
export const FRAME_st_death18 = 226;
export const FRAME_crawl1 = 227;
export const FRAME_crawl2 = 228;
export const FRAME_crawl3 = 229;
export const FRAME_crawl4 = 230;
export const FRAME_crawl5 = 231;
export const FRAME_crawl6 = 232;
export const FRAME_crawl7 = 233;
export const FRAME_crawl8 = 234;
export const FRAME_crawl9 = 235;
export const FRAME_cr_pain2 = 236;
export const FRAME_cr_pain3 = 237;
export const FRAME_cr_pain4 = 238;
export const FRAME_cr_pain5 = 239;
export const FRAME_cr_pain6 = 240;
export const FRAME_cr_pain7 = 241;
export const FRAME_cr_pain8 = 242;
export const FRAME_cr_pain9 = 243;
export const FRAME_cr_pain10 = 244;
export const FRAME_cr_death10 = 245;
export const FRAME_cr_death11 = 246;
export const FRAME_cr_death12 = 247;
export const FRAME_cr_death13 = 248;
export const FRAME_cr_death14 = 249;
export const FRAME_cr_death15 = 250;
export const FRAME_cr_death16 = 251;
export const FRAME_cross1 = 252;
export const FRAME_cross2 = 253;
export const FRAME_cross3 = 254;
export const FRAME_cross4 = 255;
export const FRAME_cross5 = 256;
export const FRAME_cross6 = 257;
export const FRAME_cross7 = 258;
export const FRAME_cross8 = 259;
export const FRAME_cross9 = 260;
export const FRAME_cross10 = 261;
export const FRAME_cross11 = 262;
export const FRAME_cross12 = 263;
export const FRAME_cross13 = 264;
export const FRAME_cross14 = 265;
export const FRAME_cross15 = 266;
export const FRAME_cross16 = 267;
export const FRAME_cross17 = 268;
export const FRAME_cross18 = 269;
export const FRAME_cross19 = 270;
export const FRAME_cross20 = 271;
export const FRAME_cross21 = 272;
export const FRAME_cross22 = 273;
export const FRAME_cross23 = 274;
export const FRAME_cross24 = 275;
export const FRAME_cross25 = 276;
export const FRAME_cross26 = 277;
export const FRAME_cross27 = 278;
export const FRAME_cross28 = 279;
export const FRAME_cross29 = 280;
export const FRAME_cross30 = 281;

export const MODEL_SCALE = 1.0;

/**
 * Original name: N/A
 * Source: N/A (local asset constants)
 * Category: New
 *
 * Purpose:
 * - Keep misc_insane sound paths centralized for runtime registration and playback.
 *
 * Symbols: INSANE_SOUND_FIST, INSANE_SOUND_SHAKE, INSANE_SOUND_MOAN, INSANE_SOUND_SCREAMS
 */
const INSANE_SOUND_FIST = "insane/insane11.wav";
const INSANE_SOUND_SHAKE = "insane/insane5.wav";
const INSANE_SOUND_MOAN = "insane/insane7.wav";
const INSANE_SOUND_SCREAMS = [
  "insane/insane1.wav",
  "insane/insane2.wav",
  "insane/insane3.wav",
  "insane/insane4.wav",
  "insane/insane6.wav",
  "insane/insane8.wav",
  "insane/insane9.wav",
  "insane/insane10.wav"
] as const;

let sound_fist = 0;
let sound_shake = 0;
let sound_moan = 0;
const sound_scream = new Array<number>(8).fill(0);

/**
 * Original name: insane_fist
 * Source: game/m_insane.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Plays the idle fist impact voice sample.
 */
export function insane_fist(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_fist, INSANE_SOUND_FIST, {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_IDLE,
    timeofs: 0
  });
}

/**
 * Original name: insane_shake
 * Source: game/m_insane.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Plays the idle shake voice sample.
 */
export function insane_shake(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_shake, INSANE_SOUND_SHAKE, {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_IDLE,
    timeofs: 0
  });
}

/**
 * Original name: insane_moan
 * Source: game/m_insane.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Plays the idle moan voice sample.
 */
export function insane_moan(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_moan, INSANE_SOUND_MOAN, {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_IDLE,
    timeofs: 0
  });
}

/**
 * Original name: insane_scream
 * Source: game/m_insane.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Plays one of the eight randomized scream samples.
 */
export function insane_scream(self: GameEntity, runtime: GameRuntime): void {
  const index = randomInt(8);
  emitRegisteredGameSound(runtime, self, sound_scream[index], INSANE_SOUND_SCREAMS[index], {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_IDLE,
    timeofs: 0
  });
}

const insane_frames_stand_normal = makeFrames(ai_stand, [0, 0, 0, 0, 0, 0], [undefined, undefined, undefined, undefined, undefined, insane_checkdown]);
export const insane_move_stand_normal: GameMonsterMove = {
  firstframe: FRAME_stand60,
  lastframe: FRAME_stand65,
  frame: insane_frames_stand_normal,
  endfunc: insane_stand
};

const insane_frames_stand_insane = makeFrames(
  ai_stand,
  new Array<number>(30).fill(0),
  [insane_shake, ...new Array<undefined>(28).fill(undefined), insane_checkdown]
);
export const insane_move_stand_insane: GameMonsterMove = {
  firstframe: FRAME_stand65,
  lastframe: FRAME_stand94,
  frame: insane_frames_stand_insane,
  endfunc: insane_stand
};

const insane_frames_uptodown = makeFrames(
  ai_move,
  [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    2.7, 4.1, 6, 7.6, 3.6, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0
  ],
  indexedThinks(40, [
    [7, insane_moan],
    [27, insane_fist],
    [33, insane_fist]
  ])
);
export const insane_move_uptodown: GameMonsterMove = {
  firstframe: FRAME_stand1,
  lastframe: FRAME_stand40,
  frame: insane_frames_uptodown,
  endfunc: insane_onground
};

const insane_frames_downtoup = makeFrames(ai_move, [
  -0.7, -1.2, -1.5, -4.5, -3.5, -0.2, 0, -1.3, -3, -2,
  0, 0, 0, -3.3, -1.6, -0.3, 0, 0, 0
]);
export const insane_move_downtoup: GameMonsterMove = {
  firstframe: FRAME_stand41,
  lastframe: FRAME_stand59,
  frame: insane_frames_downtoup,
  endfunc: insane_stand
};

const insane_frames_jumpdown = makeFrames(ai_move, [0.2, 11.5, 5.1, 7.1, 0]);
export const insane_move_jumpdown: GameMonsterMove = {
  firstframe: FRAME_stand96,
  lastframe: FRAME_stand100,
  frame: insane_frames_jumpdown,
  endfunc: insane_onground
};

const insane_frames_down = makeFrames(
  ai_move,
  [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, -1.7, -1.6, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0.5, 0, -0.2, 0, 0.2, 0.4, 0.6, 0.8, 0.7, 0
  ],
  indexedThinks(61, [
    [16, insane_fist],
    [33, insane_moan],
    [53, insane_scream],
    [60, insane_checkup]
  ])
);
export const insane_move_down: GameMonsterMove = {
  firstframe: FRAME_stand100,
  lastframe: FRAME_stand160,
  frame: insane_frames_down,
  endfunc: insane_onground
};

const insane_frames_walk_normal = makeFrames(
  ai_walk,
  [0, 2.5, 3.5, 1.7, 2.3, 2.4, 2.2, 4.2, 5.6, 3.3, 2.4, 0.9, 0],
  indexedThinks(13, [[0, insane_scream]])
);
export const insane_move_walk_normal: GameMonsterMove = {
  firstframe: FRAME_walk27,
  lastframe: FRAME_walk39,
  frame: insane_frames_walk_normal,
  endfunc: insane_walk
};
export const insane_move_run_normal: GameMonsterMove = {
  firstframe: FRAME_walk27,
  lastframe: FRAME_walk39,
  frame: insane_frames_walk_normal,
  endfunc: insane_run
};

const insane_frames_walk_insane = makeFrames(
  ai_walk,
  [
    0, 3.4, 3.6, 2.9, 2.2, 2.6, 0, 0.7, 4.8, 5.3, 1.1, 2, 0.5,
    0, 0, 4.9, 6.7, 3.8, 2, 0.2, 0, 3.4, 6.4, 5, 1.8, 0
  ],
  indexedThinks(26, [[0, insane_scream]])
);
export const insane_move_walk_insane: GameMonsterMove = {
  firstframe: FRAME_walk1,
  lastframe: FRAME_walk26,
  frame: insane_frames_walk_insane,
  endfunc: insane_walk
};
export const insane_move_run_insane: GameMonsterMove = {
  firstframe: FRAME_walk1,
  lastframe: FRAME_walk26,
  frame: insane_frames_walk_insane,
  endfunc: insane_run
};

const insane_frames_stand_pain = makeFrames(ai_move, new Array<number>(11).fill(0));
export const insane_move_stand_pain: GameMonsterMove = {
  firstframe: FRAME_st_pain2,
  lastframe: FRAME_st_pain12,
  frame: insane_frames_stand_pain,
  endfunc: insane_run
};

const insane_frames_stand_death = makeFrames(ai_move, new Array<number>(17).fill(0));
export const insane_move_stand_death: GameMonsterMove = {
  firstframe: FRAME_st_death2,
  lastframe: FRAME_st_death18,
  frame: insane_frames_stand_death,
  endfunc: insane_dead
};

const insane_frames_crawl = makeFrames(
  ai_walk,
  [0, 1.5, 2.1, 3.6, 2, 0.9, 3, 3.4, 2.4],
  indexedThinks(9, [[0, insane_scream]])
);
export const insane_move_crawl: GameMonsterMove = {
  firstframe: FRAME_crawl1,
  lastframe: FRAME_crawl9,
  frame: insane_frames_crawl,
  endfunc: undefined
};
export const insane_move_runcrawl: GameMonsterMove = {
  firstframe: FRAME_crawl1,
  lastframe: FRAME_crawl9,
  frame: insane_frames_crawl,
  endfunc: undefined
};

const insane_frames_crawl_pain = makeFrames(ai_move, new Array<number>(9).fill(0));
export const insane_move_crawl_pain: GameMonsterMove = {
  firstframe: FRAME_cr_pain2,
  lastframe: FRAME_cr_pain10,
  frame: insane_frames_crawl_pain,
  endfunc: insane_run
};

const insane_frames_crawl_death = makeFrames(ai_move, new Array<number>(7).fill(0));
export const insane_move_crawl_death: GameMonsterMove = {
  firstframe: FRAME_cr_death10,
  lastframe: FRAME_cr_death16,
  frame: insane_frames_crawl_death,
  endfunc: insane_dead
};

const insane_frames_cross = makeFrames(ai_move, new Array<number>(15).fill(0), indexedThinks(15, [[0, insane_moan]]));
export const insane_move_cross: GameMonsterMove = {
  firstframe: FRAME_cross1,
  lastframe: FRAME_cross15,
  frame: insane_frames_cross,
  endfunc: insane_cross
};

const insane_frames_struggle_cross = makeFrames(
  ai_move,
  new Array<number>(15).fill(0),
  indexedThinks(15, [[0, insane_scream]])
);
export const insane_move_struggle_cross: GameMonsterMove = {
  firstframe: FRAME_cross16,
  lastframe: FRAME_cross30,
  frame: insane_frames_struggle_cross,
  endfunc: insane_cross
};

/**
 * Original name: insane_cross
 * Source: game/m_insane.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Alternates crucified idle loops with the original probability split.
 *
 * Porting notes:
 * - Uses `g_local.random()` for the C macro `random()`.
 */
export function insane_cross(self: GameEntity): void {
  self.monsterinfo.currentmove = random() < 0.8 ? insane_move_cross : insane_move_struggle_cross;
}

/**
 * Original name: insane_walk
 * Source: game/m_insane.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Picks the walking/crawling animation state according to spawn flags.
 *
 * Porting notes:
 * - Uses `g_local.random()` for the C macro `random()`.
 */
export function insane_walk(self: GameEntity): void {
  if ((self.spawnflags & 16) !== 0 && self.s.frame === FRAME_cr_pain10) {
    self.monsterinfo.currentmove = insane_move_down;
    return;
  }

  if ((self.spawnflags & 4) !== 0) {
    self.monsterinfo.currentmove = insane_move_crawl;
  } else if (random() <= 0.5) {
    self.monsterinfo.currentmove = insane_move_walk_normal;
  } else {
    self.monsterinfo.currentmove = insane_move_walk_insane;
  }
}

/**
 * Original name: insane_run
 * Source: game/m_insane.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Picks the running/crawling animation state according to spawn flags.
 *
 * Porting notes:
 * - Uses `g_local.random()` for the C macro `random()`.
 */
export function insane_run(self: GameEntity): void {
  if ((self.spawnflags & 16) !== 0 && self.s.frame === FRAME_cr_pain10) {
    self.monsterinfo.currentmove = insane_move_down;
    return;
  }

  if ((self.spawnflags & 4) !== 0) {
    self.monsterinfo.currentmove = insane_move_runcrawl;
  } else if (random() <= 0.5) {
    self.monsterinfo.currentmove = insane_move_run_normal;
  } else {
    self.monsterinfo.currentmove = insane_move_run_insane;
  }
}

/**
 * Original name: insane_pain
 * Source: game/m_insane.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies pain debounce, emits the player pain voice sample, and chooses the pain move.
 */
export function insane_pain(
  self: GameEntity,
  _other: GameEntity | null,
  _kick: number,
  _damage: number,
  runtime: GameRuntime
): void {
  if (runtime.time < self.pain_debounce_time) {
    return;
  }

  self.pain_debounce_time = runtime.time + 3;

  const r = 1 + (randomInt(2) & 1);
  let l: number;
  if (self.health < 25) {
    l = 25;
  } else if (self.health < 50) {
    l = 50;
  } else if (self.health < 75) {
    l = 75;
  } else {
    l = 100;
  }

  emitGameSound(runtime, self, `player/male/pain${l}_${r}.wav`);

  if (runtime.skill === 3) {
    return;
  }

  if ((self.spawnflags & 8) !== 0) {
    self.monsterinfo.currentmove = insane_move_struggle_cross;
    return;
  }

  if (isCrawlingFrame(self)) {
    self.monsterinfo.currentmove = insane_move_crawl_pain;
  } else {
    self.monsterinfo.currentmove = insane_move_stand_pain;
  }
}

/**
 * Original name: insane_onground
 * Source: game/m_insane.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the monster to the down/crawling idle loop.
 */
export function insane_onground(self: GameEntity): void {
  self.monsterinfo.currentmove = insane_move_down;
}

/**
 * Original name: insane_checkdown
 * Source: game/m_insane.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Randomly moves a standing insane monster down unless it must always stand.
 *
 * Porting notes:
 * - Uses `g_local.random()` for the C macro `random()`.
 */
export function insane_checkdown(self: GameEntity): void {
  if ((self.spawnflags & 32) !== 0) {
    return;
  }
  if (random() < 0.3) {
    self.monsterinfo.currentmove = random() < 0.5 ? insane_move_uptodown : insane_move_jumpdown;
  }
}

/**
 * Original name: insane_checkup
 * Source: game/m_insane.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Randomly rises from the down/crawling idle loop unless held down by spawn flags.
 *
 * Porting notes:
 * - Uses `g_local.random()` for the C macro `random()`.
 */
export function insane_checkup(self: GameEntity): void {
  if ((self.spawnflags & 4) !== 0 && (self.spawnflags & 16) !== 0) {
    return;
  }
  if (random() < 0.5) {
    self.monsterinfo.currentmove = insane_move_downtoup;
  }
}

/**
 * Original name: insane_stand
 * Source: game/m_insane.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Chooses the next standing, crucified, or forced crawling state.
 *
 * Porting notes:
 * - Uses `g_local.random()` for the C macro `random()`.
 */
export function insane_stand(self: GameEntity): void {
  if ((self.spawnflags & 8) !== 0) {
    self.monsterinfo.currentmove = insane_move_cross;
    self.monsterinfo.aiflags |= AI_STAND_GROUND;
  } else if ((self.spawnflags & 4) !== 0 && (self.spawnflags & 16) !== 0) {
    self.monsterinfo.currentmove = insane_move_down;
  } else if (random() < 0.5) {
    self.monsterinfo.currentmove = insane_move_stand_normal;
  } else {
    self.monsterinfo.currentmove = insane_move_stand_insane;
  }
}

/**
 * Original name: insane_dead
 * Source: game/m_insane.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Finalizes the corpse bbox, flags and link state.
 */
export function insane_dead(self: GameEntity, runtime: GameRuntime): void {
  if ((self.spawnflags & 8) !== 0) {
    self.flags |= FL_FLY;
  } else {
    setVec3(self.mins, -16, -16, -24);
    setVec3(self.maxs, 16, 16, -8);
    self.movetype = MOVETYPE_TOSS;
  }
  self.svflags |= SVF_DEADMONSTER;
  self.nextthink = 0;
  linkGameEntity(runtime, self);
}

/**
 * Original name: insane_die
 * Source: game/m_insane.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Handles gib death, ordinary death sounds, and death animation selection.
 */
export function insane_die(
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

  emitGameSound(runtime, self, `player/male/death${randomInt(4) + 1}.wav`);
  self.deadflag = DEAD_DEAD;
  self.takedamage = damage_t.DAMAGE_YES;

  if ((self.spawnflags & 8) !== 0) {
    insane_dead(self, runtime);
  } else if (isCrawlingFrame(self)) {
    self.monsterinfo.currentmove = insane_move_crawl_death;
  } else {
    self.monsterinfo.currentmove = insane_move_stand_death;
  }
}

/**
 * Original name: SP_misc_insane
 * Source: game/m_insane.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns the misc_insane monster/decorative entity and initializes its movement callbacks.
 */
export function SP_misc_insane(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  precacheInsaneSounds(runtime);

  self.movetype = MOVETYPE_STEP;
  self.solid = SOLID_BBOX;
  self.s.modelindex = registerGameModel(runtime, "models/monsters/insane/tris.md2");

  setVec3(self.mins, -16, -16, -24);
  setVec3(self.maxs, 16, 16, 32);

  self.health = 100;
  self.gib_health = -50;
  self.mass = 300;

  self.pain = insane_pain;
  self.die = insane_die;

  self.monsterinfo.stand = insane_stand;
  self.monsterinfo.walk = insane_walk;
  self.monsterinfo.run = insane_run;
  self.monsterinfo.dodge = undefined;
  self.monsterinfo.attack = undefined;
  self.monsterinfo.melee = undefined;
  self.monsterinfo.sight = undefined;
  self.monsterinfo.aiflags |= AI_GOOD_GUY;

  linkGameEntity(runtime, self);

  if ((self.spawnflags & 16) !== 0) {
    self.monsterinfo.aiflags |= AI_STAND_GROUND;
  }

  self.monsterinfo.currentmove = insane_move_stand_normal;
  self.monsterinfo.scale = MODEL_SCALE;

  if ((self.spawnflags & 8) !== 0) {
    setVec3(self.mins, -16, 0, 0);
    setVec3(self.maxs, 16, 8, 32);
    self.flags |= FL_NO_KNOCKBACK;
    flymonster_start(self, runtime);
  } else {
    walkmonster_start(self, runtime);
    self.s.skinnum = randomInt(3);
  }
}

/**
 * Original name: N/A
 * Source: N/A (local table helper)
 * Category: New
 *
 * Purpose:
 * - Convert declarative distance/think arrays into runtime monster frame records.
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
 * Source: N/A (local table helper)
 * Category: New
 *
 * Purpose:
 * - Build sparse think callback arrays for declarative monster frame tables.
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
 * Source: N/A (local precache helper)
 * Category: New
 *
 * Purpose:
 * - Register misc_insane sound assets and store their runtime handles.
 */
function precacheInsaneSounds(runtime: GameRuntime): void {
  sound_fist = registerGameSound(runtime, INSANE_SOUND_FIST);
  sound_shake = registerGameSound(runtime, INSANE_SOUND_SHAKE);
  sound_moan = registerGameSound(runtime, INSANE_SOUND_MOAN);
  for (let i = 0; i < INSANE_SOUND_SCREAMS.length; i += 1) {
    sound_scream[i] = registerGameSound(runtime, INSANE_SOUND_SCREAMS[i]);
  }
}

/**
 * Original name: N/A
 * Source: N/A (local state helper)
 * Category: New
 *
 * Purpose:
 * - Recognize frame ranges that use crawling pain/death behavior.
 */
function isCrawlingFrame(self: GameEntity): boolean {
  return (
    (self.s.frame >= FRAME_crawl1 && self.s.frame <= FRAME_crawl9) ||
    (self.s.frame >= FRAME_stand99 && self.s.frame <= FRAME_stand160)
  );
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 *
 * Purpose:
 * - Mutate fixed-size vectors without allocating temporary arrays.
 */
function setVec3(vector: [number, number, number], x: number, y: number, z: number): void {
  vector[0] = x;
  vector[1] = y;
  vector[2] = z;
}

/**
 * Original name: N/A
 * Source: N/A (local RNG helper)
 * Category: New
 *
 * Purpose:
 * - Express C `rand() % n` style integer choices used by this port.
 */
function randomInt(maxExclusive: number): number {
  return Math.trunc(Math.random() * maxExclusive);
}
