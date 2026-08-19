/**
 * File: m_tank.ts
 * Source: Quake II original / game/m_tank.h and game/m_tank.c
 * Purpose: Port of the generated tank model frame constants and monster_tank gameplay behavior.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses the explicit gameplay runtime and asset helpers instead of `gi.*`.
 * - None.
 *
 * Notes:
 * - This file keeps the header constants and C behavior together as the principal attachment point for `m_tank`.
 */

import { AngleVectors, ATTN_IDLE, ATTN_NORM, CHAN_BODY, CHAN_VOICE, CHAN_WEAPON, EF_BLASTER, type vec3_t } from "../../qcommon/src/index.js";
import {
  AI_BRUTAL,
  AI_STAND_GROUND,
  DEAD_DEAD,
  DEFAULT_BULLET_HSPREAD,
  DEFAULT_BULLET_VSPREAD,
  GIB_METALLIC,
  GIB_ORGANIC,
  MOVETYPE_STEP,
  MOVETYPE_TOSS,
  SOLID_BBOX,
  SVF_DEADMONSTER,
  damage_t,
  random
} from "./g_local.js";
import { ai_charge, ai_move, ai_run, ai_stand, ai_walk, visible } from "./g_ai.js";
import { monster_fire_blaster, monster_fire_bullet, monster_fire_rocket, walkmonster_start } from "./g_monster.js";
import { ThrowGib, ThrowHead } from "./g_misc.js";
import { G_FreeEdict, G_ProjectSource, vectoangles } from "./g_utils.js";
import { getMonsterFlashOffset } from "./m_flash.js";
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

export const FRAME_stand01 = 0;
export const FRAME_stand02 = 1;
export const FRAME_stand03 = 2;
export const FRAME_stand04 = 3;
export const FRAME_stand05 = 4;
export const FRAME_stand06 = 5;
export const FRAME_stand07 = 6;
export const FRAME_stand08 = 7;
export const FRAME_stand09 = 8;
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
export const FRAME_walk01 = 30;
export const FRAME_walk02 = 31;
export const FRAME_walk03 = 32;
export const FRAME_walk04 = 33;
export const FRAME_walk05 = 34;
export const FRAME_walk06 = 35;
export const FRAME_walk07 = 36;
export const FRAME_walk08 = 37;
export const FRAME_walk09 = 38;
export const FRAME_walk10 = 39;
export const FRAME_walk11 = 40;
export const FRAME_walk12 = 41;
export const FRAME_walk13 = 42;
export const FRAME_walk14 = 43;
export const FRAME_walk15 = 44;
export const FRAME_walk16 = 45;
export const FRAME_walk17 = 46;
export const FRAME_walk18 = 47;
export const FRAME_walk19 = 48;
export const FRAME_walk20 = 49;
export const FRAME_walk21 = 50;
export const FRAME_walk22 = 51;
export const FRAME_walk23 = 52;
export const FRAME_walk24 = 53;
export const FRAME_walk25 = 54;
export const FRAME_attak101 = 55;
export const FRAME_attak102 = 56;
export const FRAME_attak103 = 57;
export const FRAME_attak104 = 58;
export const FRAME_attak105 = 59;
export const FRAME_attak106 = 60;
export const FRAME_attak107 = 61;
export const FRAME_attak108 = 62;
export const FRAME_attak109 = 63;
export const FRAME_attak110 = 64;
export const FRAME_attak111 = 65;
export const FRAME_attak112 = 66;
export const FRAME_attak113 = 67;
export const FRAME_attak114 = 68;
export const FRAME_attak115 = 69;
export const FRAME_attak116 = 70;
export const FRAME_attak117 = 71;
export const FRAME_attak118 = 72;
export const FRAME_attak119 = 73;
export const FRAME_attak120 = 74;
export const FRAME_attak121 = 75;
export const FRAME_attak122 = 76;
export const FRAME_attak201 = 77;
export const FRAME_attak202 = 78;
export const FRAME_attak203 = 79;
export const FRAME_attak204 = 80;
export const FRAME_attak205 = 81;
export const FRAME_attak206 = 82;
export const FRAME_attak207 = 83;
export const FRAME_attak208 = 84;
export const FRAME_attak209 = 85;
export const FRAME_attak210 = 86;
export const FRAME_attak211 = 87;
export const FRAME_attak212 = 88;
export const FRAME_attak213 = 89;
export const FRAME_attak214 = 90;
export const FRAME_attak215 = 91;
export const FRAME_attak216 = 92;
export const FRAME_attak217 = 93;
export const FRAME_attak218 = 94;
export const FRAME_attak219 = 95;
export const FRAME_attak220 = 96;
export const FRAME_attak221 = 97;
export const FRAME_attak222 = 98;
export const FRAME_attak223 = 99;
export const FRAME_attak224 = 100;
export const FRAME_attak225 = 101;
export const FRAME_attak226 = 102;
export const FRAME_attak227 = 103;
export const FRAME_attak228 = 104;
export const FRAME_attak229 = 105;
export const FRAME_attak230 = 106;
export const FRAME_attak231 = 107;
export const FRAME_attak232 = 108;
export const FRAME_attak233 = 109;
export const FRAME_attak234 = 110;
export const FRAME_attak235 = 111;
export const FRAME_attak236 = 112;
export const FRAME_attak237 = 113;
export const FRAME_attak238 = 114;
export const FRAME_attak301 = 115;
export const FRAME_attak302 = 116;
export const FRAME_attak303 = 117;
export const FRAME_attak304 = 118;
export const FRAME_attak305 = 119;
export const FRAME_attak306 = 120;
export const FRAME_attak307 = 121;
export const FRAME_attak308 = 122;
export const FRAME_attak309 = 123;
export const FRAME_attak310 = 124;
export const FRAME_attak311 = 125;
export const FRAME_attak312 = 126;
export const FRAME_attak313 = 127;
export const FRAME_attak314 = 128;
export const FRAME_attak315 = 129;
export const FRAME_attak316 = 130;
export const FRAME_attak317 = 131;
export const FRAME_attak318 = 132;
export const FRAME_attak319 = 133;
export const FRAME_attak320 = 134;
export const FRAME_attak321 = 135;
export const FRAME_attak322 = 136;
export const FRAME_attak323 = 137;
export const FRAME_attak324 = 138;
export const FRAME_attak325 = 139;
export const FRAME_attak326 = 140;
export const FRAME_attak327 = 141;
export const FRAME_attak328 = 142;
export const FRAME_attak329 = 143;
export const FRAME_attak330 = 144;
export const FRAME_attak331 = 145;
export const FRAME_attak332 = 146;
export const FRAME_attak333 = 147;
export const FRAME_attak334 = 148;
export const FRAME_attak335 = 149;
export const FRAME_attak336 = 150;
export const FRAME_attak337 = 151;
export const FRAME_attak338 = 152;
export const FRAME_attak339 = 153;
export const FRAME_attak340 = 154;
export const FRAME_attak341 = 155;
export const FRAME_attak342 = 156;
export const FRAME_attak343 = 157;
export const FRAME_attak344 = 158;
export const FRAME_attak345 = 159;
export const FRAME_attak346 = 160;
export const FRAME_attak347 = 161;
export const FRAME_attak348 = 162;
export const FRAME_attak349 = 163;
export const FRAME_attak350 = 164;
export const FRAME_attak351 = 165;
export const FRAME_attak352 = 166;
export const FRAME_attak353 = 167;
export const FRAME_attak401 = 168;
export const FRAME_attak402 = 169;
export const FRAME_attak403 = 170;
export const FRAME_attak404 = 171;
export const FRAME_attak405 = 172;
export const FRAME_attak406 = 173;
export const FRAME_attak407 = 174;
export const FRAME_attak408 = 175;
export const FRAME_attak409 = 176;
export const FRAME_attak410 = 177;
export const FRAME_attak411 = 178;
export const FRAME_attak412 = 179;
export const FRAME_attak413 = 180;
export const FRAME_attak414 = 181;
export const FRAME_attak415 = 182;
export const FRAME_attak416 = 183;
export const FRAME_attak417 = 184;
export const FRAME_attak418 = 185;
export const FRAME_attak419 = 186;
export const FRAME_attak420 = 187;
export const FRAME_attak421 = 188;
export const FRAME_attak422 = 189;
export const FRAME_attak423 = 190;
export const FRAME_attak424 = 191;
export const FRAME_attak425 = 192;
export const FRAME_attak426 = 193;
export const FRAME_attak427 = 194;
export const FRAME_attak428 = 195;
export const FRAME_attak429 = 196;
export const FRAME_pain101 = 197;
export const FRAME_pain102 = 198;
export const FRAME_pain103 = 199;
export const FRAME_pain104 = 200;
export const FRAME_pain201 = 201;
export const FRAME_pain202 = 202;
export const FRAME_pain203 = 203;
export const FRAME_pain204 = 204;
export const FRAME_pain205 = 205;
export const FRAME_pain301 = 206;
export const FRAME_pain302 = 207;
export const FRAME_pain303 = 208;
export const FRAME_pain304 = 209;
export const FRAME_pain305 = 210;
export const FRAME_pain306 = 211;
export const FRAME_pain307 = 212;
export const FRAME_pain308 = 213;
export const FRAME_pain309 = 214;
export const FRAME_pain310 = 215;
export const FRAME_pain311 = 216;
export const FRAME_pain312 = 217;
export const FRAME_pain313 = 218;
export const FRAME_pain314 = 219;
export const FRAME_pain315 = 220;
export const FRAME_pain316 = 221;
export const FRAME_death101 = 222;
export const FRAME_death102 = 223;
export const FRAME_death103 = 224;
export const FRAME_death104 = 225;
export const FRAME_death105 = 226;
export const FRAME_death106 = 227;
export const FRAME_death107 = 228;
export const FRAME_death108 = 229;
export const FRAME_death109 = 230;
export const FRAME_death110 = 231;
export const FRAME_death111 = 232;
export const FRAME_death112 = 233;
export const FRAME_death113 = 234;
export const FRAME_death114 = 235;
export const FRAME_death115 = 236;
export const FRAME_death116 = 237;
export const FRAME_death117 = 238;
export const FRAME_death118 = 239;
export const FRAME_death119 = 240;
export const FRAME_death120 = 241;
export const FRAME_death121 = 242;
export const FRAME_death122 = 243;
export const FRAME_death123 = 244;
export const FRAME_death124 = 245;
export const FRAME_death125 = 246;
export const FRAME_death126 = 247;
export const FRAME_death127 = 248;
export const FRAME_death128 = 249;
export const FRAME_death129 = 250;
export const FRAME_death130 = 251;
export const FRAME_death131 = 252;
export const FRAME_death132 = 253;
export const FRAME_recln101 = 254;
export const FRAME_recln102 = 255;
export const FRAME_recln103 = 256;
export const FRAME_recln104 = 257;
export const FRAME_recln105 = 258;
export const FRAME_recln106 = 259;
export const FRAME_recln107 = 260;
export const FRAME_recln108 = 261;
export const FRAME_recln109 = 262;
export const FRAME_recln110 = 263;
export const FRAME_recln111 = 264;
export const FRAME_recln112 = 265;
export const FRAME_recln113 = 266;
export const FRAME_recln114 = 267;
export const FRAME_recln115 = 268;
export const FRAME_recln116 = 269;
export const FRAME_recln117 = 270;
export const FRAME_recln118 = 271;
export const FRAME_recln119 = 272;
export const FRAME_recln120 = 273;
export const FRAME_recln121 = 274;
export const FRAME_recln122 = 275;
export const FRAME_recln123 = 276;
export const FRAME_recln124 = 277;
export const FRAME_recln125 = 278;
export const FRAME_recln126 = 279;
export const FRAME_recln127 = 280;
export const FRAME_recln128 = 281;
export const FRAME_recln129 = 282;
export const FRAME_recln130 = 283;
export const FRAME_recln131 = 284;
export const FRAME_recln132 = 285;
export const FRAME_recln133 = 286;
export const FRAME_recln134 = 287;
export const FRAME_recln135 = 288;
export const FRAME_recln136 = 289;
export const FRAME_recln137 = 290;
export const FRAME_recln138 = 291;
export const FRAME_recln139 = 292;
export const FRAME_recln140 = 293;

export const MODEL_SCALE = 1.0;

/**
 * Original name: N/A
 * Source: N/A (local q_shared flash id alias)
 * Category: New
 * Fidelity level: Strict
 *
 * Purpose:
 * - Keep the tank weapon flash indexes local to the tank gameplay port while
 *   delegating offset data lookup to `m_flash`.
 */
export const MZ2_TANK_BLASTER_1 = 1;
export const MZ2_TANK_BLASTER_2 = 2;
export const MZ2_TANK_BLASTER_3 = 3;
export const MZ2_TANK_MACHINEGUN_1 = 4;
export const MZ2_TANK_MACHINEGUN_2 = 5;
export const MZ2_TANK_MACHINEGUN_3 = 6;
export const MZ2_TANK_MACHINEGUN_4 = 7;
export const MZ2_TANK_MACHINEGUN_5 = 8;
export const MZ2_TANK_MACHINEGUN_6 = 9;
export const MZ2_TANK_MACHINEGUN_7 = 10;
export const MZ2_TANK_MACHINEGUN_8 = 11;
export const MZ2_TANK_MACHINEGUN_9 = 12;
export const MZ2_TANK_MACHINEGUN_10 = 13;
export const MZ2_TANK_MACHINEGUN_11 = 14;
export const MZ2_TANK_MACHINEGUN_12 = 15;
export const MZ2_TANK_MACHINEGUN_13 = 16;
export const MZ2_TANK_MACHINEGUN_14 = 17;
export const MZ2_TANK_MACHINEGUN_15 = 18;
export const MZ2_TANK_MACHINEGUN_16 = 19;
export const MZ2_TANK_MACHINEGUN_17 = 20;
export const MZ2_TANK_MACHINEGUN_18 = 21;
export const MZ2_TANK_MACHINEGUN_19 = 22;
export const MZ2_TANK_ROCKET_1 = 23;
export const MZ2_TANK_ROCKET_2 = 24;
export const MZ2_TANK_ROCKET_3 = 25;

const SOUND_PAIN = "tank/tnkpain2.wav";
const SOUND_THUD = "tank/tnkdeth2.wav";
const SOUND_IDLE = "tank/tnkidle1.wav";
const SOUND_DIE = "tank/death.wav";
const SOUND_STEP = "tank/step.wav";
const SOUND_WINDUP = "tank/tnkatck4.wav";
const SOUND_STRIKE = "tank/tnkatck5.wav";
const SOUND_SIGHT = "tank/sight1.wav";

/**
 * Original name: N/A
 * Source: N/A (runtime sound handle cache)
 * Category: New
 * Fidelity level: Strict
 *
 * Purpose:
 * - Store registered runtime sound indexes for the tank sound path constants.
 */
let sound_thud = 0;
let sound_pain = 0;
let sound_idle = 0;
let sound_die = 0;
let sound_step = 0;
let sound_sight = 0;
let sound_windup = 0;
let sound_strike = 0;

/**
 * Original name: tank_sight
 * Source: game/m_tank.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Plays the tank sight voice sound on `CHAN_VOICE` with normal attenuation.
 */
export function tank_sight(self: GameEntity, _other: GameEntity | null, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_sight, SOUND_SIGHT, soundOptions(CHAN_VOICE));
}

/**
 * Original name: tank_footstep
 * Source: game/m_tank.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Plays one tank step sound on `CHAN_BODY`.
 */
export function tank_footstep(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_step, SOUND_STEP, soundOptions(CHAN_BODY));
}

/**
 * Original name: tank_thud
 * Source: game/m_tank.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Plays the tank death thud sound on `CHAN_BODY`.
 */
export function tank_thud(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_thud, SOUND_THUD, soundOptions(CHAN_BODY));
}

/**
 * Original name: tank_windup
 * Source: game/m_tank.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Plays the tank weapon windup sound on `CHAN_WEAPON`.
 */
export function tank_windup(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_windup, SOUND_WINDUP, soundOptions(CHAN_WEAPON));
}

/**
 * Original name: tank_idle
 * Source: game/m_tank.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Plays the idle voice sound on `CHAN_VOICE` with idle attenuation.
 */
export function tank_idle(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_idle, SOUND_IDLE, soundOptions(CHAN_VOICE, ATTN_IDLE));
}

export const tank_frames_stand = makeFrames(ai_stand, new Array<number>(30).fill(0));
export const tank_move_stand: GameMonsterMove = {
  firstframe: FRAME_stand01,
  lastframe: FRAME_stand30,
  frame: tank_frames_stand,
  endfunc: undefined
};

/**
 * Original name: tank_stand
 * Source: game/m_tank.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Selects `tank_move_stand` as the current monster move.
 */
export function tank_stand(self: GameEntity): void {
  self.monsterinfo.currentmove = tank_move_stand;
}

export const tank_frames_start_walk = makeFrames(ai_walk, [0, 6, 6, 11], indexedThinks(4, [[3, tank_footstep]]));
export const tank_move_start_walk: GameMonsterMove = {
  firstframe: FRAME_walk01,
  lastframe: FRAME_walk04,
  frame: tank_frames_start_walk,
  endfunc: tank_walk
};

export const tank_frames_walk = makeFrames(
  ai_walk,
  [4, 5, 3, 2, 5, 5, 4, 4, 3, 5, 4, 5, 7, 7, 6, 6],
  indexedThinks(16, [[7, tank_footstep], [15, tank_footstep]])
);
export const tank_move_walk: GameMonsterMove = {
  firstframe: FRAME_walk05,
  lastframe: FRAME_walk20,
  frame: tank_frames_walk,
  endfunc: undefined
};

export const tank_frames_stop_walk = makeFrames(ai_walk, [3, 3, 2, 2, 4], indexedThinks(5, [[4, tank_footstep]]));
export const tank_move_stop_walk: GameMonsterMove = {
  firstframe: FRAME_walk21,
  lastframe: FRAME_walk25,
  frame: tank_frames_stop_walk,
  endfunc: tank_stand
};

/**
 * Original name: tank_walk
 * Source: game/m_tank.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Selects the continuous walk move after the tank walk start frames.
 */
export function tank_walk(self: GameEntity): void {
  self.monsterinfo.currentmove = tank_move_walk;
}

export const tank_frames_start_run = makeFrames(ai_run, [0, 6, 6, 11], indexedThinks(4, [[3, tank_footstep]]));
export const tank_move_start_run: GameMonsterMove = {
  firstframe: FRAME_walk01,
  lastframe: FRAME_walk04,
  frame: tank_frames_start_run,
  endfunc: tank_run
};

export const tank_frames_run = makeFrames(
  ai_run,
  [4, 5, 3, 2, 5, 5, 4, 4, 3, 5, 4, 5, 7, 7, 6, 6],
  indexedThinks(16, [[7, tank_footstep], [15, tank_footstep]])
);
export const tank_move_run: GameMonsterMove = {
  firstframe: FRAME_walk05,
  lastframe: FRAME_walk20,
  frame: tank_frames_run,
  endfunc: undefined
};

export const tank_frames_stop_run = makeFrames(ai_run, [3, 3, 2, 2, 4], indexedThinks(5, [[4, tank_footstep]]));
export const tank_move_stop_run: GameMonsterMove = {
  firstframe: FRAME_walk21,
  lastframe: FRAME_walk25,
  frame: tank_frames_stop_run,
  endfunc: tank_walk
};

/**
 * Original name: tank_run
 * Source: game/m_tank.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Toggles `AI_BRUTAL` for client enemies, honors `AI_STAND_GROUND`, and selects the start/run move.
 */
export function tank_run(self: GameEntity): void {
  if (self.enemy?.client) {
    self.monsterinfo.aiflags |= AI_BRUTAL;
  } else {
    self.monsterinfo.aiflags &= ~AI_BRUTAL;
  }

  if ((self.monsterinfo.aiflags & AI_STAND_GROUND) !== 0) {
    self.monsterinfo.currentmove = tank_move_stand;
    return;
  }

  if (self.monsterinfo.currentmove === tank_move_walk || self.monsterinfo.currentmove === tank_move_start_run) {
    self.monsterinfo.currentmove = tank_move_run;
  } else {
    self.monsterinfo.currentmove = tank_move_start_run;
  }
}

export const tank_frames_pain1 = makeFrames(ai_move, [0, 0, 0, 0]);
export const tank_move_pain1: GameMonsterMove = {
  firstframe: FRAME_pain101,
  lastframe: FRAME_pain104,
  frame: tank_frames_pain1,
  endfunc: tank_run
};

export const tank_frames_pain2 = makeFrames(ai_move, [0, 0, 0, 0, 0]);
export const tank_move_pain2: GameMonsterMove = {
  firstframe: FRAME_pain201,
  lastframe: FRAME_pain205,
  frame: tank_frames_pain2,
  endfunc: tank_run
};

export const tank_frames_pain3 = makeFrames(
  ai_move,
  [-7, 0, 0, 0, 2, 0, 0, 3, 0, 2, 0, 0, 0, 0, 0, 0],
  indexedThinks(16, [[15, tank_footstep]])
);
export const tank_move_pain3: GameMonsterMove = {
  firstframe: FRAME_pain301,
  lastframe: FRAME_pain316,
  frame: tank_frames_pain3,
  endfunc: tank_run
};

/**
 * Original name: tank_pain
 * Source: game/m_tank.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Applies the damaged skin, honors pain debounce and skill gates, plays the pain sound, and selects the matching pain move.
 */
export function tank_pain(
  self: GameEntity,
  _other: GameEntity | null,
  _kick: number,
  damage: number,
  runtime: GameRuntime
): void {
  if (self.health < self.max_health / 2) {
    self.s.skinnum |= 1;
  }

  if (damage <= 10) {
    return;
  }

  if (runtime.time < self.pain_debounce_time) {
    return;
  }

  if (damage <= 30 && random() > 0.2) {
    return;
  }

  if (runtime.skill >= 2) {
    if (self.s.frame >= FRAME_attak301 && self.s.frame <= FRAME_attak330) {
      return;
    }
    if (self.s.frame >= FRAME_attak101 && self.s.frame <= FRAME_attak116) {
      return;
    }
  }

  self.pain_debounce_time = runtime.time + 3;
  emitRegisteredGameSound(runtime, self, sound_pain, SOUND_PAIN, soundOptions(CHAN_VOICE));

  if (runtime.skill === 3) {
    return;
  }

  if (damage <= 30) {
    self.monsterinfo.currentmove = tank_move_pain1;
  } else if (damage <= 60) {
    self.monsterinfo.currentmove = tank_move_pain2;
  } else {
    self.monsterinfo.currentmove = tank_move_pain3;
  }
}

/**
 * Original name: TankBlaster
 * Source: game/m_tank.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Chooses the blaster muzzle from the current animation frame and fires at the enemy viewheight.
 * Porting notes:
 * - Returns early when no enemy is attached so partial harness entities cannot throw.
 */
export function TankBlaster(self: GameEntity, runtime: GameRuntime): void {
  if (!self.enemy) {
    return;
  }

  let flash_number: number;
  if (self.s.frame === FRAME_attak110) {
    flash_number = MZ2_TANK_BLASTER_1;
  } else if (self.s.frame === FRAME_attak113) {
    flash_number = MZ2_TANK_BLASTER_2;
  } else {
    flash_number = MZ2_TANK_BLASTER_3;
  }

  const { forward, right } = AngleVectors(self.s.angles);
  const start = G_ProjectSource(self.s.origin, tankFlashOffset(flash_number), forward, right);
  const end: vec3_t = [...self.enemy.s.origin];
  end[2] += self.enemy.viewheight;
  const dir = subtractVec3(end, start);

  monster_fire_blaster(self, start, dir, 30, 800, flash_number, EF_BLASTER, runtime);
}

/**
 * Original name: TankStrike
 * Source: game/m_tank.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Plays the melee strike sound on the weapon channel.
 */
export function TankStrike(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_strike, SOUND_STRIKE, soundOptions(CHAN_WEAPON));
}

/**
 * Original name: TankRocket
 * Source: game/m_tank.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Chooses the rocket muzzle from the current animation frame and fires a normalized rocket direction at the enemy viewheight.
 * Porting notes:
 * - Returns early when no enemy is attached so partial harness entities cannot throw.
 */
export function TankRocket(self: GameEntity, runtime: GameRuntime): void {
  if (!self.enemy) {
    return;
  }

  let flash_number: number;
  if (self.s.frame === FRAME_attak324) {
    flash_number = MZ2_TANK_ROCKET_1;
  } else if (self.s.frame === FRAME_attak327) {
    flash_number = MZ2_TANK_ROCKET_2;
  } else {
    flash_number = MZ2_TANK_ROCKET_3;
  }

  const { forward, right } = AngleVectors(self.s.angles);
  const start = G_ProjectSource(self.s.origin, tankFlashOffset(flash_number), forward, right);
  const vec: vec3_t = [...self.enemy.s.origin];
  vec[2] += self.enemy.viewheight;
  const dir = normalizeVec3(subtractVec3(vec, start));

  monster_fire_rocket(self, start, dir, 50, 550, flash_number, runtime);
}

/**
 * Original name: TankMachineGun
 * Source: game/m_tank.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Sweeps tank machinegun muzzle flashes across attack frames and fires bullets with the original damage/spread.
 */
export function TankMachineGun(self: GameEntity, runtime: GameRuntime): void {
  const flash_number = MZ2_TANK_MACHINEGUN_1 + (self.s.frame - FRAME_attak406);
  const { forward, right } = AngleVectors(self.s.angles);
  const start = G_ProjectSource(self.s.origin, tankFlashOffset(flash_number), forward, right);
  const dir: vec3_t = [0, 0, 0];

  if (self.enemy) {
    const vec: vec3_t = [...self.enemy.s.origin];
    vec[2] += self.enemy.viewheight;
    const angles = vectoangles(subtractVec3(vec, start));
    dir[0] = angles[0];
  }

  if (self.s.frame <= FRAME_attak415) {
    dir[1] = self.s.angles[1] - 8 * (self.s.frame - FRAME_attak411);
  } else {
    dir[1] = self.s.angles[1] + 8 * (self.s.frame - FRAME_attak419);
  }

  const aim = AngleVectors(dir).forward;
  monster_fire_bullet(
    self,
    start,
    aim,
    20,
    4,
    DEFAULT_BULLET_HSPREAD,
    DEFAULT_BULLET_VSPREAD,
    flash_number,
    runtime
  );
}

export const tank_frames_attack_blast = makeFrames(
  ai_charge,
  [0, 0, 0, 0, -1, -2, -1, -1, 0, 0, 0, 0, 0, 0, 0, 0],
  indexedThinks(16, [[9, TankBlaster], [12, TankBlaster], [15, TankBlaster]])
);
export const tank_move_attack_blast: GameMonsterMove = {
  firstframe: FRAME_attak101,
  lastframe: FRAME_attak116,
  frame: tank_frames_attack_blast,
  endfunc: tank_reattack_blaster
};

export const tank_frames_reattack_blast = makeFrames(
  ai_charge,
  [0, 0, 0, 0, 0, 0],
  indexedThinks(6, [[2, TankBlaster], [5, TankBlaster]])
);
export const tank_move_reattack_blast: GameMonsterMove = {
  firstframe: FRAME_attak111,
  lastframe: FRAME_attak116,
  frame: tank_frames_reattack_blast,
  endfunc: tank_reattack_blaster
};

export const tank_frames_attack_post_blast = makeFrames(ai_move, [0, 0, 2, 3, 2, -2], indexedThinks(6, [[5, tank_footstep]]));
export const tank_move_attack_post_blast: GameMonsterMove = {
  firstframe: FRAME_attak117,
  lastframe: FRAME_attak122,
  frame: tank_frames_attack_post_blast,
  endfunc: tank_run
};

/**
 * Original name: tank_reattack_blaster
 * Source: game/m_tank.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - On hard/nightmare, may loop the blaster attack while the enemy is visible and alive; otherwise exits to post-blast frames.
 * Porting notes:
 * - Adds an enemy null guard for runtime robustness; the normal monster attack path provides one.
 */
export function tank_reattack_blaster(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.skill >= 2 && self.enemy && visible(self, self.enemy, runtime) && self.enemy.health > 0 && random() <= 0.6) {
    self.monsterinfo.currentmove = tank_move_reattack_blast;
    return;
  }

  self.monsterinfo.currentmove = tank_move_attack_post_blast;
}

/**
 * Original name: tank_poststrike
 * Source: game/m_tank.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Clears the brutal strike enemy and resumes the normal run selection.
 */
export function tank_poststrike(self: GameEntity): void {
  self.enemy = null;
  tank_run(self);
}

export const tank_frames_attack_strike = makeFrames(
  ai_move,
  [3, 2, 2, 1, 6, 7, 9, 2, 1, 2, 2, 2, 0, 0, 0, 0, -2, -2, 0, 0, 0, 0, 0, 0, 0, 0, 0, -1, -1, -1, -1, -1, -3, -10, -10, -2, -3, -2],
  indexedThinks(38, [[6, tank_footstep], [10, tank_footstep], [18, tank_windup], [25, TankStrike], [37, tank_footstep]])
);
export const tank_move_attack_strike: GameMonsterMove = {
  firstframe: FRAME_attak201,
  lastframe: FRAME_attak238,
  frame: tank_frames_attack_strike,
  endfunc: tank_poststrike
};

export const tank_frames_attack_pre_rocket = makeFrames(
  ai_charge,
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 7, 7, 7, 0, 0, 0, 0, -3],
  indexedThinks(21, [[15, tank_footstep]])
);
export const tank_move_attack_pre_rocket: GameMonsterMove = {
  firstframe: FRAME_attak301,
  lastframe: FRAME_attak321,
  frame: tank_frames_attack_pre_rocket,
  endfunc: tank_doattack_rocket
};

export const tank_frames_attack_fire_rocket = makeFrames(
  ai_charge,
  [-3, 0, 0, 0, 0, 0, 0, 0, -1],
  indexedThinks(9, [[2, TankRocket], [5, TankRocket], [8, TankRocket]])
);
export const tank_move_attack_fire_rocket: GameMonsterMove = {
  firstframe: FRAME_attak322,
  lastframe: FRAME_attak330,
  frame: tank_frames_attack_fire_rocket,
  endfunc: tank_refire_rocket
};

export const tank_frames_attack_post_rocket = makeFrames(
  ai_charge,
  [0, -1, -1, 0, 2, 3, 4, 2, 0, 0, 0, -9, -8, -7, -1, -1, 0, 0, 0, 0, 0, 0, 0],
  indexedThinks(23, [[15, tank_footstep]])
);
export const tank_move_attack_post_rocket: GameMonsterMove = {
  firstframe: FRAME_attak331,
  lastframe: FRAME_attak353,
  frame: tank_frames_attack_post_rocket,
  endfunc: tank_run
};

export const tank_frames_attack_chain: GameMonsterFrame[] = [
  ...makeFrames(ai_charge, [0, 0, 0, 0, 0]),
  ...makeFrames(undefined, new Array<number>(19).fill(0), new Array<GameMonsterFrame["thinkfunc"]>(19).fill(TankMachineGun)),
  ...makeFrames(ai_charge, [0, 0, 0, 0, 0])
];
export const tank_move_attack_chain: GameMonsterMove = {
  firstframe: FRAME_attak401,
  lastframe: FRAME_attak429,
  frame: tank_frames_attack_chain,
  endfunc: tank_run
};

/**
 * Original name: tank_refire_rocket
 * Source: game/m_tank.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - On hard/nightmare, may loop the rocket fire move while the enemy is visible and alive; otherwise exits to post-rocket frames.
 * Porting notes:
 * - Adds an enemy null guard for runtime robustness; the normal monster attack path provides one.
 */
export function tank_refire_rocket(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.skill >= 2 && self.enemy && self.enemy.health > 0 && visible(self, self.enemy, runtime) && random() <= 0.4) {
    self.monsterinfo.currentmove = tank_move_attack_fire_rocket;
    return;
  }

  self.monsterinfo.currentmove = tank_move_attack_post_rocket;
}

/**
 * Original name: tank_doattack_rocket
 * Source: game/m_tank.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Transitions from rocket windup to the rocket fire loop.
 */
export function tank_doattack_rocket(self: GameEntity): void {
  self.monsterinfo.currentmove = tank_move_attack_fire_rocket;
}

/**
 * Original name: tank_attack
 * Source: game/m_tank.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Chooses chain gun, blaster, rocket windup, or brutal strike according to enemy health, range and random thresholds.
 * Porting notes:
 * - Returns early when no enemy is attached so partial harness entities cannot throw.
 */
export function tank_attack(self: GameEntity, runtime: GameRuntime): void {
  if (!self.enemy) {
    return;
  }

  if (self.enemy.health < 0) {
    self.monsterinfo.currentmove = tank_move_attack_strike;
    self.monsterinfo.aiflags &= ~AI_BRUTAL;
    return;
  }

  const vec = subtractVec3(self.enemy.s.origin, self.s.origin);
  const range = Math.hypot(vec[0], vec[1], vec[2]);
  const r = random();

  if (range <= 125) {
    self.monsterinfo.currentmove = r < 0.4 ? tank_move_attack_chain : tank_move_attack_blast;
  } else if (range <= 250) {
    self.monsterinfo.currentmove = r < 0.5 ? tank_move_attack_chain : tank_move_attack_blast;
  } else if (r < 0.33) {
    self.monsterinfo.currentmove = tank_move_attack_chain;
  } else if (r < 0.66) {
    self.monsterinfo.currentmove = tank_move_attack_pre_rocket;
    self.pain_debounce_time = runtime.time + 5;
  } else {
    self.monsterinfo.currentmove = tank_move_attack_blast;
  }
}

/**
 * Original name: tank_dead
 * Source: game/m_tank.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Converts the corpse to a toss dead monster bbox and relinks it.
 */
export function tank_dead(self: GameEntity, runtime: GameRuntime): void {
  setVec3(self.mins, -16, -16, -16);
  setVec3(self.maxs, 16, 16, 0);
  self.movetype = MOVETYPE_TOSS;
  self.svflags |= SVF_DEADMONSTER;
  self.nextthink = 0;
  linkGameEntity(runtime, self);
}

export const tank_frames_death1 = makeFrames(
  ai_move,
  [-7, -2, -2, 1, 3, 6, 1, 1, 2, 0, 0, 0, -2, 0, 0, -3, 0, 0, 0, 0, 0, 0, -4, -6, -4, -5, -7, -15, -5, 0, 0, 0],
  indexedThinks(32, [[27, tank_thud]])
);
export const tank_move_death: GameMonsterMove = {
  firstframe: FRAME_death101,
  lastframe: FRAME_death132,
  frame: tank_frames_death1,
  endfunc: tank_dead
};

/**
 * Original name: tank_die
 * Source: game/m_tank.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Handles gib death, ignores duplicate deaths, otherwise plays the death sound and starts the tank death move.
 */
export function tank_die(
  self: GameEntity,
  _inflictor: GameEntity | null,
  _attacker: GameEntity | null,
  damage: number,
  runtime: GameRuntime
): void {
  if (self.health <= self.gib_health) {
    emitGameSound(runtime, self, "misc/udeath.wav");
    for (let n = 0; n < 1; n += 1) {
      ThrowGib(self, "models/objects/gibs/sm_meat/tris.md2", damage, GIB_ORGANIC, runtime);
    }
    for (let n = 0; n < 4; n += 1) {
      ThrowGib(self, "models/objects/gibs/sm_metal/tris.md2", damage, GIB_METALLIC, runtime);
    }
    ThrowGib(self, "models/objects/gibs/chest/tris.md2", damage, GIB_ORGANIC, runtime);
    ThrowHead(self, "models/objects/gibs/gear/tris.md2", damage, GIB_METALLIC, runtime);
    self.deadflag = DEAD_DEAD;
    return;
  }

  if (self.deadflag === DEAD_DEAD) {
    return;
  }

  emitRegisteredGameSound(runtime, self, sound_die, SOUND_DIE, soundOptions(CHAN_VOICE));
  self.deadflag = DEAD_DEAD;
  self.takedamage = damage_t.DAMAGE_YES;
  self.monsterinfo.currentmove = tank_move_death;
}

/**
 * Original name: SP_monster_tank
 * Source: game/m_tank.c
 * Category: Ported
 * Fidelity level: Close
 */
export function SP_monster_tank(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  precacheTankAssets(runtime);

  self.s.modelindex = registerGameModel(runtime, "models/monsters/tank/tris.md2");
  setVec3(self.mins, -32, -32, -16);
  setVec3(self.maxs, 32, 32, 72);
  self.movetype = MOVETYPE_STEP;
  self.solid = SOLID_BBOX;

  if (self.classname === "monster_tank_commander") {
    self.health = 1000;
    self.gib_health = -225;
  } else {
    self.health = 750;
    self.gib_health = -200;
  }

  self.mass = 500;

  self.pain = tank_pain;
  self.die = tank_die;
  self.monsterinfo.stand = tank_stand;
  self.monsterinfo.walk = tank_walk;
  self.monsterinfo.run = tank_run;
  self.monsterinfo.dodge = undefined;
  self.monsterinfo.attack = tank_attack;
  self.monsterinfo.melee = undefined;
  self.monsterinfo.sight = tank_sight;
  self.monsterinfo.idle = tank_idle;

  linkGameEntity(runtime, self);

  self.monsterinfo.currentmove = tank_move_stand;
  self.monsterinfo.scale = MODEL_SCALE;

  walkmonster_start(self, runtime);

  if (self.classname === "monster_tank_commander") {
    self.s.skinnum = 2;
  }
}

/**
 * Original name: N/A
 * Source: N/A (local monster frame builder)
 * Category: New
 * Fidelity level: Strict
 *
 * Purpose:
 * - Build TS monster frame arrays from compact distance/callback lists.
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
 * Source: N/A (local frame callback helper)
 * Category: New
 * Fidelity level: Strict
 *
 * Purpose:
 * - Place sparse frame callbacks at their source frame indexes.
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
 * Source: N/A (local asset precache helper)
 * Category: New
 * Fidelity level: Strict
 *
 * Purpose:
 * - Keep the `SP_monster_tank` asset precache sequence in one TS helper.
 */
function precacheTankAssets(runtime: GameRuntime): void {
  sound_pain = registerGameSound(runtime, SOUND_PAIN);
  sound_thud = registerGameSound(runtime, SOUND_THUD);
  sound_idle = registerGameSound(runtime, SOUND_IDLE);
  sound_die = registerGameSound(runtime, SOUND_DIE);
  sound_step = registerGameSound(runtime, SOUND_STEP);
  sound_windup = registerGameSound(runtime, SOUND_WINDUP);
  sound_strike = registerGameSound(runtime, SOUND_STRIKE);
  sound_sight = registerGameSound(runtime, SOUND_SIGHT);
  registerGameSound(runtime, "tank/tnkatck1.wav");
  registerGameSound(runtime, "tank/tnkatk2a.wav");
  registerGameSound(runtime, "tank/tnkatk2b.wav");
  registerGameSound(runtime, "tank/tnkatk2c.wav");
  registerGameSound(runtime, "tank/tnkatk2d.wav");
  registerGameSound(runtime, "tank/tnkatk2e.wav");
  registerGameSound(runtime, "tank/tnkatck3.wav");
}

/**
 * Original name: N/A
 * Source: N/A (local sound option helper)
 * Category: New
 * Fidelity level: Strict
 *
 * Purpose:
 * - Adapt original `gi.sound` channel, volume, attenuation and time offset
 *   arguments to the TS runtime sound option object.
 */
function soundOptions(channel: number, attenuation: number = ATTN_NORM): { channel: number; volume: number; attenuation: number; timeofs: number } {
  return {
    channel,
    volume: 1,
    attenuation,
    timeofs: 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (local flash offset helper)
 * Category: New
 * Fidelity level: Strict
 *
 * Purpose:
 * - Route tank-local flash indexes to the shared monster flash offset table.
 */
function tankFlashOffset(flashNumber: number): vec3_t {
  return getMonsterFlashOffset(flashNumber);
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Fidelity level: Strict
 *
 * Purpose:
 * - Local mutable tuple assignment equivalent for entity bounds.
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
 * Fidelity level: Strict
 *
 * Purpose:
 * - Return the vector difference used by tank aiming and range checks.
 */
function subtractVec3(left: vec3_t, right: vec3_t): vec3_t {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Fidelity level: Strict
 *
 * Purpose:
 * - Normalize a vector for rocket direction calculations while keeping zero
 *   vectors stable for harness/runtime safety.
 */
function normalizeVec3(vector: vec3_t): vec3_t {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length === 0) {
    return [0, 0, 0];
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}
