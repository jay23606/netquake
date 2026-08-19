/**
 * File: m_chick.ts
 * Source: Quake II original / game/m_chick.h and game/m_chick.c
 * Purpose: Port of the generated chick model frame constants and monster_chick gameplay behavior.
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
 * - This file keeps the header constants and C behavior together as the principal attachment point for `m_chick`.
 */

import { AngleVectors, ATTN_IDLE, ATTN_NORM, CHAN_VOICE, CHAN_WEAPON, type vec3_t } from "../../qcommon/src/index.js";
import {
  AI_DUCKED,
  AI_HOLD_FRAME,
  AI_STAND_GROUND,
  DEAD_DEAD,
  GIB_ORGANIC,
  MELEE_DISTANCE,
  MOVETYPE_STEP,
  MOVETYPE_TOSS,
  RANGE_MELEE,
  SOLID_BBOX,
  SVF_DEADMONSTER,
  damage_t,
  random
} from "./g_local.js";
import { ai_charge, ai_move, ai_run, ai_stand, ai_walk, range, visible } from "./g_ai.js";
import { monster_fire_rocket, walkmonster_start } from "./g_monster.js";
import { ThrowGib, ThrowHead } from "./g_misc.js";
import { G_FreeEdict, G_ProjectSource } from "./g_utils.js";
import { getMonsterFlashOffset } from "./m_flash.js";
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
export const FRAME_attak119 = 18;
export const FRAME_attak120 = 19;
export const FRAME_attak121 = 20;
export const FRAME_attak122 = 21;
export const FRAME_attak123 = 22;
export const FRAME_attak124 = 23;
export const FRAME_attak125 = 24;
export const FRAME_attak126 = 25;
export const FRAME_attak127 = 26;
export const FRAME_attak128 = 27;
export const FRAME_attak129 = 28;
export const FRAME_attak130 = 29;
export const FRAME_attak131 = 30;
export const FRAME_attak132 = 31;
export const FRAME_attak201 = 32;
export const FRAME_attak202 = 33;
export const FRAME_attak203 = 34;
export const FRAME_attak204 = 35;
export const FRAME_attak205 = 36;
export const FRAME_attak206 = 37;
export const FRAME_attak207 = 38;
export const FRAME_attak208 = 39;
export const FRAME_attak209 = 40;
export const FRAME_attak210 = 41;
export const FRAME_attak211 = 42;
export const FRAME_attak212 = 43;
export const FRAME_attak213 = 44;
export const FRAME_attak214 = 45;
export const FRAME_attak215 = 46;
export const FRAME_attak216 = 47;
export const FRAME_death101 = 48;
export const FRAME_death102 = 49;
export const FRAME_death103 = 50;
export const FRAME_death104 = 51;
export const FRAME_death105 = 52;
export const FRAME_death106 = 53;
export const FRAME_death107 = 54;
export const FRAME_death108 = 55;
export const FRAME_death109 = 56;
export const FRAME_death110 = 57;
export const FRAME_death111 = 58;
export const FRAME_death112 = 59;
export const FRAME_death201 = 60;
export const FRAME_death202 = 61;
export const FRAME_death203 = 62;
export const FRAME_death204 = 63;
export const FRAME_death205 = 64;
export const FRAME_death206 = 65;
export const FRAME_death207 = 66;
export const FRAME_death208 = 67;
export const FRAME_death209 = 68;
export const FRAME_death210 = 69;
export const FRAME_death211 = 70;
export const FRAME_death212 = 71;
export const FRAME_death213 = 72;
export const FRAME_death214 = 73;
export const FRAME_death215 = 74;
export const FRAME_death216 = 75;
export const FRAME_death217 = 76;
export const FRAME_death218 = 77;
export const FRAME_death219 = 78;
export const FRAME_death220 = 79;
export const FRAME_death221 = 80;
export const FRAME_death222 = 81;
export const FRAME_death223 = 82;
export const FRAME_duck01 = 83;
export const FRAME_duck02 = 84;
export const FRAME_duck03 = 85;
export const FRAME_duck04 = 86;
export const FRAME_duck05 = 87;
export const FRAME_duck06 = 88;
export const FRAME_duck07 = 89;
export const FRAME_pain101 = 90;
export const FRAME_pain102 = 91;
export const FRAME_pain103 = 92;
export const FRAME_pain104 = 93;
export const FRAME_pain105 = 94;
export const FRAME_pain201 = 95;
export const FRAME_pain202 = 96;
export const FRAME_pain203 = 97;
export const FRAME_pain204 = 98;
export const FRAME_pain205 = 99;
export const FRAME_pain301 = 100;
export const FRAME_pain302 = 101;
export const FRAME_pain303 = 102;
export const FRAME_pain304 = 103;
export const FRAME_pain305 = 104;
export const FRAME_pain306 = 105;
export const FRAME_pain307 = 106;
export const FRAME_pain308 = 107;
export const FRAME_pain309 = 108;
export const FRAME_pain310 = 109;
export const FRAME_pain311 = 110;
export const FRAME_pain312 = 111;
export const FRAME_pain313 = 112;
export const FRAME_pain314 = 113;
export const FRAME_pain315 = 114;
export const FRAME_pain316 = 115;
export const FRAME_pain317 = 116;
export const FRAME_pain318 = 117;
export const FRAME_pain319 = 118;
export const FRAME_pain320 = 119;
export const FRAME_pain321 = 120;
export const FRAME_stand101 = 121;
export const FRAME_stand102 = 122;
export const FRAME_stand103 = 123;
export const FRAME_stand104 = 124;
export const FRAME_stand105 = 125;
export const FRAME_stand106 = 126;
export const FRAME_stand107 = 127;
export const FRAME_stand108 = 128;
export const FRAME_stand109 = 129;
export const FRAME_stand110 = 130;
export const FRAME_stand111 = 131;
export const FRAME_stand112 = 132;
export const FRAME_stand113 = 133;
export const FRAME_stand114 = 134;
export const FRAME_stand115 = 135;
export const FRAME_stand116 = 136;
export const FRAME_stand117 = 137;
export const FRAME_stand118 = 138;
export const FRAME_stand119 = 139;
export const FRAME_stand120 = 140;
export const FRAME_stand121 = 141;
export const FRAME_stand122 = 142;
export const FRAME_stand123 = 143;
export const FRAME_stand124 = 144;
export const FRAME_stand125 = 145;
export const FRAME_stand126 = 146;
export const FRAME_stand127 = 147;
export const FRAME_stand128 = 148;
export const FRAME_stand129 = 149;
export const FRAME_stand130 = 150;
export const FRAME_stand201 = 151;
export const FRAME_stand202 = 152;
export const FRAME_stand203 = 153;
export const FRAME_stand204 = 154;
export const FRAME_stand205 = 155;
export const FRAME_stand206 = 156;
export const FRAME_stand207 = 157;
export const FRAME_stand208 = 158;
export const FRAME_stand209 = 159;
export const FRAME_stand210 = 160;
export const FRAME_stand211 = 161;
export const FRAME_stand212 = 162;
export const FRAME_stand213 = 163;
export const FRAME_stand214 = 164;
export const FRAME_stand215 = 165;
export const FRAME_stand216 = 166;
export const FRAME_stand217 = 167;
export const FRAME_stand218 = 168;
export const FRAME_stand219 = 169;
export const FRAME_stand220 = 170;
export const FRAME_stand221 = 171;
export const FRAME_stand222 = 172;
export const FRAME_stand223 = 173;
export const FRAME_stand224 = 174;
export const FRAME_stand225 = 175;
export const FRAME_stand226 = 176;
export const FRAME_stand227 = 177;
export const FRAME_stand228 = 178;
export const FRAME_stand229 = 179;
export const FRAME_stand230 = 180;
export const FRAME_walk01 = 181;
export const FRAME_walk02 = 182;
export const FRAME_walk03 = 183;
export const FRAME_walk04 = 184;
export const FRAME_walk05 = 185;
export const FRAME_walk06 = 186;
export const FRAME_walk07 = 187;
export const FRAME_walk08 = 188;
export const FRAME_walk09 = 189;
export const FRAME_walk10 = 190;
export const FRAME_walk11 = 191;
export const FRAME_walk12 = 192;
export const FRAME_walk13 = 193;
export const FRAME_walk14 = 194;
export const FRAME_walk15 = 195;
export const FRAME_walk16 = 196;
export const FRAME_walk17 = 197;
export const FRAME_walk18 = 198;
export const FRAME_walk19 = 199;
export const FRAME_walk20 = 200;
export const FRAME_walk21 = 201;
export const FRAME_walk22 = 202;
export const FRAME_walk23 = 203;
export const FRAME_walk24 = 204;
export const FRAME_walk25 = 205;
export const FRAME_walk26 = 206;
export const FRAME_walk27 = 207;
export const FRAME_recln201 = 208;
export const FRAME_recln202 = 209;
export const FRAME_recln203 = 210;
export const FRAME_recln204 = 211;
export const FRAME_recln205 = 212;
export const FRAME_recln206 = 213;
export const FRAME_recln207 = 214;
export const FRAME_recln208 = 215;
export const FRAME_recln209 = 216;
export const FRAME_recln210 = 217;
export const FRAME_recln211 = 218;
export const FRAME_recln212 = 219;
export const FRAME_recln213 = 220;
export const FRAME_recln214 = 221;
export const FRAME_recln215 = 222;
export const FRAME_recln216 = 223;
export const FRAME_recln217 = 224;
export const FRAME_recln218 = 225;
export const FRAME_recln219 = 226;
export const FRAME_recln220 = 227;
export const FRAME_recln221 = 228;
export const FRAME_recln222 = 229;
export const FRAME_recln223 = 230;
export const FRAME_recln224 = 231;
export const FRAME_recln225 = 232;
export const FRAME_recln226 = 233;
export const FRAME_recln227 = 234;
export const FRAME_recln228 = 235;
export const FRAME_recln229 = 236;
export const FRAME_recln230 = 237;
export const FRAME_recln231 = 238;
export const FRAME_recln232 = 239;
export const FRAME_recln233 = 240;
export const FRAME_recln234 = 241;
export const FRAME_recln235 = 242;
export const FRAME_recln236 = 243;
export const FRAME_recln237 = 244;
export const FRAME_recln238 = 245;
export const FRAME_recln239 = 246;
export const FRAME_recln240 = 247;
export const FRAME_recln101 = 248;
export const FRAME_recln102 = 249;
export const FRAME_recln103 = 250;
export const FRAME_recln104 = 251;
export const FRAME_recln105 = 252;
export const FRAME_recln106 = 253;
export const FRAME_recln107 = 254;
export const FRAME_recln108 = 255;
export const FRAME_recln109 = 256;
export const FRAME_recln110 = 257;
export const FRAME_recln111 = 258;
export const FRAME_recln112 = 259;
export const FRAME_recln113 = 260;
export const FRAME_recln114 = 261;
export const FRAME_recln115 = 262;
export const FRAME_recln116 = 263;
export const FRAME_recln117 = 264;
export const FRAME_recln118 = 265;
export const FRAME_recln119 = 266;
export const FRAME_recln120 = 267;
export const FRAME_recln121 = 268;
export const FRAME_recln122 = 269;
export const FRAME_recln123 = 270;
export const FRAME_recln124 = 271;
export const FRAME_recln125 = 272;
export const FRAME_recln126 = 273;
export const FRAME_recln127 = 274;
export const FRAME_recln128 = 275;
export const FRAME_recln129 = 276;
export const FRAME_recln130 = 277;
export const FRAME_recln131 = 278;
export const FRAME_recln132 = 279;
export const FRAME_recln133 = 280;
export const FRAME_recln134 = 281;
export const FRAME_recln135 = 282;
export const FRAME_recln136 = 283;
export const FRAME_recln137 = 284;
export const FRAME_recln138 = 285;
export const FRAME_recln139 = 286;
export const FRAME_recln140 = 287;

export const MODEL_SCALE = 1.0;

/**
 * Original name: N/A
 * Source: N/A (local q_shared flash id alias)
 * Category: New
 * Fidelity level: Strict
 *
 * Purpose:
 * - Keep the Chick rocket flash index local to the Chick gameplay port while
 *   delegating offset data lookup to `m_flash`.
 */
export const MZ2_CHICK_ROCKET_1 = 57;

const SOUND_MISSILE_PRELAUNCH = "chick/chkatck1.wav";
const SOUND_MISSILE_LAUNCH = "chick/chkatck2.wav";
const SOUND_MELEE_SWING = "chick/chkatck3.wav";
const SOUND_MELEE_HIT = "chick/chkatck4.wav";
const SOUND_MISSILE_RELOAD = "chick/chkatck5.wav";
const SOUND_DEATH1 = "chick/chkdeth1.wav";
const SOUND_DEATH2 = "chick/chkdeth2.wav";
const SOUND_FALL_DOWN = "chick/chkfall1.wav";
const SOUND_IDLE1 = "chick/chkidle1.wav";
const SOUND_IDLE2 = "chick/chkidle2.wav";
const SOUND_PAIN1 = "chick/chkpain1.wav";
const SOUND_PAIN2 = "chick/chkpain2.wav";
const SOUND_PAIN3 = "chick/chkpain3.wav";
const SOUND_SIGHT = "chick/chksght1.wav";
const SOUND_SEARCH = "chick/chksrch1.wav";

/**
 * Original name: N/A
 * Source: N/A (runtime sound handle cache)
 * Category: New
 * Fidelity level: Strict
 *
 * Purpose:
 * - Store registered runtime sound indexes for the Chick sound path constants.
 */
let sound_missile_prelaunch = 0;
let sound_missile_launch = 0;
let sound_melee_swing = 0;
let sound_melee_hit = 0;
let sound_missile_reload = 0;
let sound_death1 = 0;
let sound_death2 = 0;
let sound_fall_down = 0;
let sound_idle1 = 0;
let sound_idle2 = 0;
let sound_pain1 = 0;
let sound_pain2 = 0;
let sound_pain3 = 0;
let sound_sight = 0;
let sound_search = 0;

/**
 * Original name: ChickMoan
 * Source: game/m_chick.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Randomly plays one of the two idle voice sounds on the voice channel with idle attenuation.
 *
 * Porting notes:
 * - Uses the runtime sound adapter while preserving the original `random()` split and sound options.
 */
export function ChickMoan(self: GameEntity, runtime: GameRuntime): void {
  if (random() < 0.5) {
    emitRegisteredGameSound(runtime, self, sound_idle1, SOUND_IDLE1, soundOptions(CHAN_VOICE, ATTN_IDLE));
  } else {
    emitRegisteredGameSound(runtime, self, sound_idle2, SOUND_IDLE2, soundOptions(CHAN_VOICE, ATTN_IDLE));
  }
}

const chick_frames_fidget = makeFrames(
  ai_stand,
  new Array<number>(30).fill(0),
  indexedThinks(30, [[8, ChickMoan]])
);
export const chick_move_fidget: GameMonsterMove = {
  firstframe: FRAME_stand201,
  lastframe: FRAME_stand230,
  frame: chick_frames_fidget,
  endfunc: chick_stand
};

/**
 * Original name: chick_fidget
 * Source: game/m_chick.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Leaves standing-ground monsters unchanged.
 * - Otherwise starts the fidget move with the original 30 percent chance.
 *
 * Porting notes:
 * - Preserves the direct currentmove assignment used by the original callback.
 * - Uses the shared `g_local.random()` helper for the original macro call.
 */
export function chick_fidget(self: GameEntity): void {
  if ((self.monsterinfo.aiflags & AI_STAND_GROUND) !== 0) {
    return;
  }
  if (random() <= 0.3) {
    self.monsterinfo.currentmove = chick_move_fidget;
  }
}

const chick_frames_stand = makeFrames(
  ai_stand,
  new Array<number>(30).fill(0),
  indexedThinks(30, [[29, chick_fidget]])
);
export const chick_move_stand: GameMonsterMove = {
  firstframe: FRAME_stand101,
  lastframe: FRAME_stand130,
  frame: chick_frames_stand,
  endfunc: undefined
};

/**
 * Original name: chick_stand
 * Source: game/m_chick.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Selects the Chick standing move table.
 *
 * Porting notes:
 * - Preserve the direct currentmove assignment used by the original callback.
 */
export function chick_stand(self: GameEntity): void {
  self.monsterinfo.currentmove = chick_move_stand;
}

const chick_frames_start_run = makeFrames(ai_run, [1, 0, 0, -1, -1, 0, 1, 3, 6, 3]);
export const chick_move_start_run: GameMonsterMove = {
  firstframe: FRAME_walk01,
  lastframe: FRAME_walk10,
  frame: chick_frames_start_run,
  endfunc: chick_run
};

const chick_frames_run = makeFrames(ai_run, [6, 8, 13, 5, 7, 4, 11, 5, 9, 7]);
export const chick_move_run: GameMonsterMove = {
  firstframe: FRAME_walk11,
  lastframe: FRAME_walk20,
  frame: chick_frames_run,
  endfunc: undefined
};

const chick_frames_walk = makeFrames(ai_walk, [6, 8, 13, 5, 7, 4, 11, 5, 9, 7]);
export const chick_move_walk: GameMonsterMove = {
  firstframe: FRAME_walk11,
  lastframe: FRAME_walk20,
  frame: chick_frames_walk,
  endfunc: undefined
};

/**
 * Original name: chick_walk
 * Source: game/m_chick.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Selects the Chick walking move table.
 *
 * Porting notes:
 * - Preserve the direct currentmove assignment used by the original callback.
 */
export function chick_walk(self: GameEntity): void {
  self.monsterinfo.currentmove = chick_move_walk;
}

/**
 * Original name: chick_run
 * Source: game/m_chick.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Selects standing, running, or run-start move tables from the current AI state.
 *
 * Porting notes:
 * - Preserve the original branch order and currentmove transitions.
 */
export function chick_run(self: GameEntity): void {
  if ((self.monsterinfo.aiflags & AI_STAND_GROUND) !== 0) {
    self.monsterinfo.currentmove = chick_move_stand;
    return;
  }

  if (self.monsterinfo.currentmove === chick_move_walk || self.monsterinfo.currentmove === chick_move_start_run) {
    self.monsterinfo.currentmove = chick_move_run;
  } else {
    self.monsterinfo.currentmove = chick_move_start_run;
  }
}

const chick_frames_pain1 = makeFrames(ai_move, [0, 0, 0, 0, 0]);
export const chick_move_pain1: GameMonsterMove = {
  firstframe: FRAME_pain101,
  lastframe: FRAME_pain105,
  frame: chick_frames_pain1,
  endfunc: chick_run
};

const chick_frames_pain2 = makeFrames(ai_move, [0, 0, 0, 0, 0]);
export const chick_move_pain2: GameMonsterMove = {
  firstframe: FRAME_pain201,
  lastframe: FRAME_pain205,
  frame: chick_frames_pain2,
  endfunc: chick_run
};

const chick_frames_pain3 = makeFrames(ai_move, [0, 0, -6, 3, 11, 3, 0, 0, 4, 1, 0, -3, -4, 5, 7, -2, 3, -5, -2, -8, 2]);
export const chick_move_pain3: GameMonsterMove = {
  firstframe: FRAME_pain301,
  lastframe: FRAME_pain321,
  frame: chick_frames_pain3,
  endfunc: chick_run
};

/**
 * Original name: chick_pain
 * Source: game/m_chick.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Applies the wounded skin, debounces pain reactions, emits one pain voice sound,
 *   and selects a pain animation by damage amount unless nightmare skill suppresses it.
 *
 * Porting notes:
 * - Uses the runtime skill/time and registered game sound bridge in place of `skill->value`,
 *   `level.time`, and `gi.sound`.
 * - Uses the shared `g_local.random()` helper for the original macro call.
 */
export function chick_pain(
  self: GameEntity,
  _other: GameEntity | null,
  _kick: number,
  damage: number,
  runtime: GameRuntime
): void {
  if (self.health < self.max_health / 2) {
    self.s.skinnum = 1;
  }

  if (runtime.time < self.pain_debounce_time) {
    return;
  }

  self.pain_debounce_time = runtime.time + 3;

  const r = random();
  if (r < 0.33) {
    emitRegisteredGameSound(runtime, self, sound_pain1, SOUND_PAIN1, soundOptions(CHAN_VOICE));
  } else if (r < 0.66) {
    emitRegisteredGameSound(runtime, self, sound_pain2, SOUND_PAIN2, soundOptions(CHAN_VOICE));
  } else {
    emitRegisteredGameSound(runtime, self, sound_pain3, SOUND_PAIN3, soundOptions(CHAN_VOICE));
  }

  if (runtime.skill === 3) {
    return;
  }

  if (damage <= 10) {
    self.monsterinfo.currentmove = chick_move_pain1;
  } else if (damage <= 25) {
    self.monsterinfo.currentmove = chick_move_pain2;
  } else {
    self.monsterinfo.currentmove = chick_move_pain3;
  }
}

/**
 * Original name: chick_dead
 * Source: game/m_chick.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Finalizes the Chick corpse bbox, movement type, dead-monster server flag and relinks the entity.
 *
 * Porting notes:
 * - Preserve the original corpse bbox and linkentity side effect because the visible death pose and collision hull depend on it.
 */
export function chick_dead(self: GameEntity, runtime: GameRuntime): void {
  setVec3(self.mins, -16, -16, 0);
  setVec3(self.maxs, 16, 16, 16);
  self.movetype = MOVETYPE_TOSS;
  self.svflags |= SVF_DEADMONSTER;
  self.nextthink = 0;
  linkGameEntity(runtime, self);
}

const chick_frames_death2 = makeFrames(ai_move, [-6, 0, -1, -5, 0, -1, -2, 1, 10, 2, 3, 1, 2, 0, 3, 3, 1, -3, -5, 4, 15, 14, 1]);
export const chick_move_death2: GameMonsterMove = {
  firstframe: FRAME_death201,
  lastframe: FRAME_death223,
  frame: chick_frames_death2,
  endfunc: chick_dead
};

const chick_frames_death1 = makeFrames(ai_move, [0, 0, -7, 4, 11, 0, 0, 0, 0, 0, 0, 0]);
export const chick_move_death1: GameMonsterMove = {
  firstframe: FRAME_death101,
  lastframe: FRAME_death112,
  frame: chick_frames_death1,
  endfunc: chick_dead
};

/**
 * Original name: chick_die
 * Source: game/m_chick.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Handles gib death, duplicate-death guard, regular death sounds and death animation selection.
 *
 * Porting notes:
 * - Uses runtime sound/entity helpers in place of `gi.*` while preserving branch order and side effects.
 * - `rand() % 2` is represented by `randomInt(2)` to keep the local death-table choice explicit.
 */
export function chick_die(
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

  self.deadflag = DEAD_DEAD;
  self.takedamage = damage_t.DAMAGE_YES;

  if (randomInt(2) === 0) {
    self.monsterinfo.currentmove = chick_move_death1;
    emitRegisteredGameSound(runtime, self, sound_death1, SOUND_DEATH1, soundOptions(CHAN_VOICE));
  } else {
    self.monsterinfo.currentmove = chick_move_death2;
    emitRegisteredGameSound(runtime, self, sound_death2, SOUND_DEATH2, soundOptions(CHAN_VOICE));
  }
}

/**
 * Original name: chick_duck_down
 * Source: game/m_chick.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Enters the Chick duck state, shrinks the bbox height, enables damage and links the entity.
 *
 * Porting notes:
 * - Uses `runtime.time` and `linkGameEntity` in place of `level.time` and `gi.linkentity`.
 */
export function chick_duck_down(self: GameEntity, runtime: GameRuntime): void {
  if ((self.monsterinfo.aiflags & AI_DUCKED) !== 0) {
    return;
  }
  self.monsterinfo.aiflags |= AI_DUCKED;
  self.maxs[2] -= 32;
  self.takedamage = damage_t.DAMAGE_YES;
  self.monsterinfo.pausetime = runtime.time + 1;
  linkGameEntity(runtime, self);
}

/**
 * Original name: chick_duck_hold
 * Source: game/m_chick.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Holds or releases the current animation frame according to the duck pausetime.
 */
export function chick_duck_hold(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.time >= self.monsterinfo.pausetime) {
    self.monsterinfo.aiflags &= ~AI_HOLD_FRAME;
  } else {
    self.monsterinfo.aiflags |= AI_HOLD_FRAME;
  }
}

/**
 * Original name: chick_duck_up
 * Source: game/m_chick.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Leaves the Chick duck state, restores bbox height and aim damage, then links the entity.
 *
 * Porting notes:
 * - Uses `linkGameEntity` in place of `gi.linkentity`.
 */
export function chick_duck_up(self: GameEntity, runtime: GameRuntime): void {
  self.monsterinfo.aiflags &= ~AI_DUCKED;
  self.maxs[2] += 32;
  self.takedamage = damage_t.DAMAGE_AIM;
  linkGameEntity(runtime, self);
}

const chick_frames_duck = makeFrames(ai_move, [0, 1, 4, -4, -5, 3, 1], [
  chick_duck_down,
  undefined,
  chick_duck_hold,
  undefined,
  chick_duck_up,
  undefined,
  undefined
]);
export const chick_move_duck: GameMonsterMove = {
  firstframe: FRAME_duck01,
  lastframe: FRAME_duck07,
  frame: chick_frames_duck,
  endfunc: chick_run
};

/**
 * Original name: chick_dodge
 * Source: game/m_chick.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Randomly chooses the duck move in response to incoming fire and records the attacker as enemy if needed.
 *
 * Porting notes:
 * - Uses the shared `g_local.random()` helper for the original macro call.
 */
export function chick_dodge(self: GameEntity, attacker: GameEntity | null, _eta: number): void {
  if (random() > 0.25) {
    return;
  }

  if (!self.enemy) {
    self.enemy = attacker;
  }

  self.monsterinfo.currentmove = chick_move_duck;
}

/**
 * Original name: ChickSlash
 * Source: game/m_chick.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Plays the melee swing sound and applies the original slash hit trace/damage.
 *
 * Porting notes:
 * - Uses `emitRegisteredGameSound` and the explicit runtime in place of `gi.sound`.
 */
export function ChickSlash(self: GameEntity, runtime: GameRuntime): void {
  const aim: vec3_t = [MELEE_DISTANCE, self.mins[0], 10];
  emitRegisteredGameSound(runtime, self, sound_melee_swing, SOUND_MELEE_SWING, soundOptions(CHAN_WEAPON));
  if (fire_hit(self, aim, 10 + randomInt(6), 100, runtime)) {
    void sound_melee_hit;
  }
}

/**
 * Original name: ChickRocket
 * Source: game/m_chick.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Projects the Chick rocket muzzle origin, aims at the enemy view height and fires one rocket.
 *
 * Porting notes:
 * - Preserves `MZ2_CHICK_ROCKET_1`, damage, speed and projectile direction math.
 * - The TypeScript port guards nullable enemy references before applying the original enemy-origin math.
 */
export function ChickRocket(self: GameEntity, runtime: GameRuntime): void {
  if (!self.enemy) {
    return;
  }

  const { forward, right } = AngleVectors(self.s.angles);
  const start = G_ProjectSource(self.s.origin, getMonsterFlashOffset(MZ2_CHICK_ROCKET_1), forward, right);
  const vec: vec3_t = [...self.enemy.s.origin];
  vec[2] += self.enemy.viewheight;
  const dir = normalizeVec3(subtractVec3(vec, start));

  monster_fire_rocket(self, start, dir, 50, 500, MZ2_CHICK_ROCKET_1, runtime);
}

/**
 * Original name: Chick_PreAttack1
 * Source: game/m_chick.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Plays the missile prelaunch voice sound at the first startup attack frame.
 *
 * Porting notes:
 * - Uses `emitRegisteredGameSound` and the explicit runtime in place of `gi.sound`.
 */
export function Chick_PreAttack1(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_missile_prelaunch, SOUND_MISSILE_PRELAUNCH, soundOptions(CHAN_VOICE));
}

/**
 * Original name: ChickReload
 * Source: game/m_chick.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Plays the missile reload voice sound during the rocket attack loop.
 *
 * Porting notes:
 * - Uses `emitRegisteredGameSound` and the explicit runtime in place of `gi.sound`.
 */
export function ChickReload(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_missile_reload, SOUND_MISSILE_RELOAD, soundOptions(CHAN_VOICE));
}

const chick_frames_start_attack1 = makeFrames(
  ai_charge,
  [0, 0, 0, 4, 0, -3, 3, 5, 7, 0, 0, 0, 0],
  indexedThinks(13, [[0, Chick_PreAttack1], [12, chick_attack1]])
);
export const chick_move_start_attack1: GameMonsterMove = {
  firstframe: FRAME_attak101,
  lastframe: FRAME_attak113,
  frame: chick_frames_start_attack1,
  endfunc: undefined
};

const chick_frames_attack1 = makeFrames(
  ai_charge,
  [19, -6, -5, -2, -7, 0, 1, 10, 4, 5, 6, 6, 4, 3],
  indexedThinks(14, [[0, ChickRocket], [7, ChickReload], [13, chick_rerocket]])
);
export const chick_move_attack1: GameMonsterMove = {
  firstframe: FRAME_attak114,
  lastframe: FRAME_attak127,
  frame: chick_frames_attack1,
  endfunc: undefined
};

const chick_frames_end_attack1 = makeFrames(ai_charge, [-3, 0, -6, -4, -2]);
export const chick_move_end_attack1: GameMonsterMove = {
  firstframe: FRAME_attak128,
  lastframe: FRAME_attak132,
  frame: chick_frames_end_attack1,
  endfunc: chick_run
};

/**
 * Original name: chick_rerocket
 * Source: game/m_chick.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Repeats the rocket attack when the enemy is alive, visible, outside melee range, and the random check passes.
 * - Otherwise selects the rocket attack ending move table.
 *
 * Porting notes:
 * - Preserve the original branch conditions and 0.6 random threshold.
 * - Uses the shared `g_local.random()` helper for the original macro call.
 * - The TypeScript port guards nullable enemy references before applying the original enemy checks.
 */
export function chick_rerocket(self: GameEntity, runtime: GameRuntime): void {
  if (
    self.enemy &&
    self.enemy.health > 0 &&
    range(self, self.enemy) > RANGE_MELEE &&
    visible(self, self.enemy, runtime) &&
    random() <= 0.6
  ) {
    self.monsterinfo.currentmove = chick_move_attack1;
    return;
  }

  self.monsterinfo.currentmove = chick_move_end_attack1;
}

/**
 * Original name: chick_attack1
 * Source: game/m_chick.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Selects the Chick rocket attack loop move table.
 *
 * Porting notes:
 * - Preserve the direct currentmove assignment used by the original callback.
 */
export function chick_attack1(self: GameEntity): void {
  self.monsterinfo.currentmove = chick_move_attack1;
}

const chick_frames_slash = makeFrames(
  ai_charge,
  [1, 7, -7, 1, -1, 1, 0, 1, -2],
  indexedThinks(9, [[1, ChickSlash], [8, chick_reslash]])
);
export const chick_move_slash: GameMonsterMove = {
  firstframe: FRAME_attak204,
  lastframe: FRAME_attak212,
  frame: chick_frames_slash,
  endfunc: undefined
};

const chick_frames_end_slash = makeFrames(ai_charge, [-6, -1, -6, 0]);
export const chick_move_end_slash: GameMonsterMove = {
  firstframe: FRAME_attak213,
  lastframe: FRAME_attak216,
  frame: chick_frames_end_slash,
  endfunc: chick_run
};

/**
 * Original name: chick_reslash
 * Source: game/m_chick.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Repeats the slash attack when the enemy is alive, in melee range, and the random check passes.
 * - Otherwise selects the slash ending move table.
 *
 * Porting notes:
 * - Preserve the original branch conditions and 0.9 random threshold.
 * - Uses the shared `g_local.random()` helper for the original macro call.
 * - The TypeScript port guards nullable enemy references before applying the original enemy checks.
 */
export function chick_reslash(self: GameEntity): void {
  if (self.enemy && self.enemy.health > 0 && range(self, self.enemy) === RANGE_MELEE) {
    if (random() <= 0.9) {
      self.monsterinfo.currentmove = chick_move_slash;
      return;
    }

    self.monsterinfo.currentmove = chick_move_end_slash;
    return;
  }

  self.monsterinfo.currentmove = chick_move_end_slash;
}

/**
 * Original name: chick_slash
 * Source: game/m_chick.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Selects the Chick melee slash move table.
 *
 * Porting notes:
 * - Preserve the direct currentmove assignment used by the original callback.
 */
export function chick_slash(self: GameEntity): void {
  self.monsterinfo.currentmove = chick_move_slash;
}

const chick_frames_start_slash = makeFrames(ai_charge, [1, 8, 3]);
export const chick_move_start_slash: GameMonsterMove = {
  firstframe: FRAME_attak201,
  lastframe: FRAME_attak203,
  frame: chick_frames_start_slash,
  endfunc: chick_slash
};

/**
 * Original name: chick_melee
 * Source: game/m_chick.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Selects the Chick melee startup move table.
 *
 * Porting notes:
 * - Preserve the direct currentmove assignment used by the original callback.
 */
export function chick_melee(self: GameEntity): void {
  self.monsterinfo.currentmove = chick_move_start_slash;
}

/**
 * Original name: chick_attack
 * Source: game/m_chick.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Selects the Chick rocket attack startup move table.
 *
 * Porting notes:
 * - Preserve the direct currentmove assignment used by the original callback.
 */
export function chick_attack(self: GameEntity): void {
  self.monsterinfo.currentmove = chick_move_start_attack1;
}

/**
 * Original name: chick_sight
 * Source: game/m_chick.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Plays the Chick sight voice sound at normal attenuation.
 *
 * Porting notes:
 * - Keeps the unused `other` parameter for callback parity with the original monsterinfo.sight signature.
 */
export function chick_sight(self: GameEntity, _other: GameEntity | null, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_sight, SOUND_SIGHT, soundOptions(CHAN_VOICE));
}

/**
 * Original name: SP_monster_chick
 * Source: game/m_chick.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Frees the spawn in deathmatch, precaches Chick sounds/model, configures bbox, health, mass and monster callbacks.
 * - Links the entity, starts on the standing move table and delegates delayed monster startup to `walkmonster_start`.
 *
 * Porting notes:
 * - Uses runtime asset registration/link helpers in place of the original `gi.soundindex`, `gi.modelindex` and `gi.linkentity`.
 */
export function SP_monster_chick(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  precacheChickAssets(runtime);

  self.movetype = MOVETYPE_STEP;
  self.solid = SOLID_BBOX;
  self.s.modelindex = registerGameModel(runtime, "models/monsters/bitch/tris.md2");
  setVec3(self.mins, -16, -16, 0);
  setVec3(self.maxs, 16, 16, 56);

  self.health = 175;
  self.gib_health = -70;
  self.mass = 200;

  self.pain = chick_pain;
  self.die = chick_die;

  self.monsterinfo.stand = chick_stand;
  self.monsterinfo.walk = chick_walk;
  self.monsterinfo.run = chick_run;
  self.monsterinfo.dodge = chick_dodge;
  self.monsterinfo.attack = chick_attack;
  self.monsterinfo.melee = chick_melee;
  self.monsterinfo.sight = chick_sight;

  linkGameEntity(runtime, self);

  self.monsterinfo.currentmove = chick_move_stand;
  self.monsterinfo.scale = MODEL_SCALE;

  walkmonster_start(self, runtime);
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
 * - Keep the `SP_monster_chick` asset precache sequence in one TS helper.
 */
function precacheChickAssets(runtime: GameRuntime): void {
  sound_missile_prelaunch = registerGameSound(runtime, SOUND_MISSILE_PRELAUNCH);
  sound_missile_launch = registerGameSound(runtime, SOUND_MISSILE_LAUNCH);
  sound_melee_swing = registerGameSound(runtime, SOUND_MELEE_SWING);
  sound_melee_hit = registerGameSound(runtime, SOUND_MELEE_HIT);
  sound_missile_reload = registerGameSound(runtime, SOUND_MISSILE_RELOAD);
  sound_death1 = registerGameSound(runtime, SOUND_DEATH1);
  sound_death2 = registerGameSound(runtime, SOUND_DEATH2);
  sound_fall_down = registerGameSound(runtime, SOUND_FALL_DOWN);
  sound_idle1 = registerGameSound(runtime, SOUND_IDLE1);
  sound_idle2 = registerGameSound(runtime, SOUND_IDLE2);
  sound_pain1 = registerGameSound(runtime, SOUND_PAIN1);
  sound_pain2 = registerGameSound(runtime, SOUND_PAIN2);
  sound_pain3 = registerGameSound(runtime, SOUND_PAIN3);
  sound_sight = registerGameSound(runtime, SOUND_SIGHT);
  sound_search = registerGameSound(runtime, SOUND_SEARCH);
  void sound_missile_launch;
  void sound_fall_down;
  void sound_search;
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
 * - Return the vector difference used by Chick rocket aiming.
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

/**
 * Original name: N/A
 * Source: N/A (local random helper)
 * Category: New
 * Fidelity level: Strict
 *
 * Purpose:
 * - Provide integer random selection for TS branches that mirror `rand() % n`.
 */
function randomInt(maxExclusive: number): number {
  return Math.trunc(Math.random() * maxExclusive);
}
