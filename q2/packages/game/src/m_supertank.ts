/**
 * File: m_supertank.ts
 * Source: Quake II original / game/m_supertank.h and game/m_supertank.c
 * Purpose: Port of the generated supertank model frame constants and monster_supertank gameplay behavior.
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
 * - This file keeps the header constants and C behavior together as the principal attachment point for `m_supertank`.
 */

import { AngleVectors, ATTN_NORM, CHAN_VOICE, multicast_t, temp_event_t, type vec3_t } from "../../qcommon/src/index.js";
import {
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
import { monster_fire_bullet, monster_fire_rocket, walkmonster_start } from "./g_monster.js";
import { ThrowGib, ThrowHead } from "./g_misc.js";
import { G_FreeEdict, G_ProjectSource } from "./g_utils.js";
import { getMonsterFlashOffset } from "./m_flash.js";
import {
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

export const FRAME_attak1_1 = 0;
export const FRAME_attak1_2 = 1;
export const FRAME_attak1_3 = 2;
export const FRAME_attak1_4 = 3;
export const FRAME_attak1_5 = 4;
export const FRAME_attak1_6 = 5;
export const FRAME_attak1_7 = 6;
export const FRAME_attak1_8 = 7;
export const FRAME_attak1_9 = 8;
export const FRAME_attak1_10 = 9;
export const FRAME_attak1_11 = 10;
export const FRAME_attak1_12 = 11;
export const FRAME_attak1_13 = 12;
export const FRAME_attak1_14 = 13;
export const FRAME_attak1_15 = 14;
export const FRAME_attak1_16 = 15;
export const FRAME_attak1_17 = 16;
export const FRAME_attak1_18 = 17;
export const FRAME_attak1_19 = 18;
export const FRAME_attak1_20 = 19;
export const FRAME_attak2_1 = 20;
export const FRAME_attak2_2 = 21;
export const FRAME_attak2_3 = 22;
export const FRAME_attak2_4 = 23;
export const FRAME_attak2_5 = 24;
export const FRAME_attak2_6 = 25;
export const FRAME_attak2_7 = 26;
export const FRAME_attak2_8 = 27;
export const FRAME_attak2_9 = 28;
export const FRAME_attak2_10 = 29;
export const FRAME_attak2_11 = 30;
export const FRAME_attak2_12 = 31;
export const FRAME_attak2_13 = 32;
export const FRAME_attak2_14 = 33;
export const FRAME_attak2_15 = 34;
export const FRAME_attak2_16 = 35;
export const FRAME_attak2_17 = 36;
export const FRAME_attak2_18 = 37;
export const FRAME_attak2_19 = 38;
export const FRAME_attak2_20 = 39;
export const FRAME_attak2_21 = 40;
export const FRAME_attak2_22 = 41;
export const FRAME_attak2_23 = 42;
export const FRAME_attak2_24 = 43;
export const FRAME_attak2_25 = 44;
export const FRAME_attak2_26 = 45;
export const FRAME_attak2_27 = 46;
export const FRAME_attak3_1 = 47;
export const FRAME_attak3_2 = 48;
export const FRAME_attak3_3 = 49;
export const FRAME_attak3_4 = 50;
export const FRAME_attak3_5 = 51;
export const FRAME_attak3_6 = 52;
export const FRAME_attak3_7 = 53;
export const FRAME_attak3_8 = 54;
export const FRAME_attak3_9 = 55;
export const FRAME_attak3_10 = 56;
export const FRAME_attak3_11 = 57;
export const FRAME_attak3_12 = 58;
export const FRAME_attak3_13 = 59;
export const FRAME_attak3_14 = 60;
export const FRAME_attak3_15 = 61;
export const FRAME_attak3_16 = 62;
export const FRAME_attak3_17 = 63;
export const FRAME_attak3_18 = 64;
export const FRAME_attak3_19 = 65;
export const FRAME_attak3_20 = 66;
export const FRAME_attak3_21 = 67;
export const FRAME_attak3_22 = 68;
export const FRAME_attak3_23 = 69;
export const FRAME_attak3_24 = 70;
export const FRAME_attak3_25 = 71;
export const FRAME_attak3_26 = 72;
export const FRAME_attak3_27 = 73;
export const FRAME_attak4_1 = 74;
export const FRAME_attak4_2 = 75;
export const FRAME_attak4_3 = 76;
export const FRAME_attak4_4 = 77;
export const FRAME_attak4_5 = 78;
export const FRAME_attak4_6 = 79;
export const FRAME_backwd_1 = 80;
export const FRAME_backwd_2 = 81;
export const FRAME_backwd_3 = 82;
export const FRAME_backwd_4 = 83;
export const FRAME_backwd_5 = 84;
export const FRAME_backwd_6 = 85;
export const FRAME_backwd_7 = 86;
export const FRAME_backwd_8 = 87;
export const FRAME_backwd_9 = 88;
export const FRAME_backwd_10 = 89;
export const FRAME_backwd_11 = 90;
export const FRAME_backwd_12 = 91;
export const FRAME_backwd_13 = 92;
export const FRAME_backwd_14 = 93;
export const FRAME_backwd_15 = 94;
export const FRAME_backwd_16 = 95;
export const FRAME_backwd_17 = 96;
export const FRAME_backwd_18 = 97;
export const FRAME_death_1 = 98;
export const FRAME_death_2 = 99;
export const FRAME_death_3 = 100;
export const FRAME_death_4 = 101;
export const FRAME_death_5 = 102;
export const FRAME_death_6 = 103;
export const FRAME_death_7 = 104;
export const FRAME_death_8 = 105;
export const FRAME_death_9 = 106;
export const FRAME_death_10 = 107;
export const FRAME_death_11 = 108;
export const FRAME_death_12 = 109;
export const FRAME_death_13 = 110;
export const FRAME_death_14 = 111;
export const FRAME_death_15 = 112;
export const FRAME_death_16 = 113;
export const FRAME_death_17 = 114;
export const FRAME_death_18 = 115;
export const FRAME_death_19 = 116;
export const FRAME_death_20 = 117;
export const FRAME_death_21 = 118;
export const FRAME_death_22 = 119;
export const FRAME_death_23 = 120;
export const FRAME_death_24 = 121;
export const FRAME_death_31 = 122;
export const FRAME_death_32 = 123;
export const FRAME_death_33 = 124;
export const FRAME_death_45 = 125;
export const FRAME_death_46 = 126;
export const FRAME_death_47 = 127;
export const FRAME_forwrd_1 = 128;
export const FRAME_forwrd_2 = 129;
export const FRAME_forwrd_3 = 130;
export const FRAME_forwrd_4 = 131;
export const FRAME_forwrd_5 = 132;
export const FRAME_forwrd_6 = 133;
export const FRAME_forwrd_7 = 134;
export const FRAME_forwrd_8 = 135;
export const FRAME_forwrd_9 = 136;
export const FRAME_forwrd_10 = 137;
export const FRAME_forwrd_11 = 138;
export const FRAME_forwrd_12 = 139;
export const FRAME_forwrd_13 = 140;
export const FRAME_forwrd_14 = 141;
export const FRAME_forwrd_15 = 142;
export const FRAME_forwrd_16 = 143;
export const FRAME_forwrd_17 = 144;
export const FRAME_forwrd_18 = 145;
export const FRAME_left_1 = 146;
export const FRAME_left_2 = 147;
export const FRAME_left_3 = 148;
export const FRAME_left_4 = 149;
export const FRAME_left_5 = 150;
export const FRAME_left_6 = 151;
export const FRAME_left_7 = 152;
export const FRAME_left_8 = 153;
export const FRAME_left_9 = 154;
export const FRAME_left_10 = 155;
export const FRAME_left_11 = 156;
export const FRAME_left_12 = 157;
export const FRAME_left_13 = 158;
export const FRAME_left_14 = 159;
export const FRAME_left_15 = 160;
export const FRAME_left_16 = 161;
export const FRAME_left_17 = 162;
export const FRAME_left_18 = 163;
export const FRAME_pain1_1 = 164;
export const FRAME_pain1_2 = 165;
export const FRAME_pain1_3 = 166;
export const FRAME_pain1_4 = 167;
export const FRAME_pain2_5 = 168;
export const FRAME_pain2_6 = 169;
export const FRAME_pain2_7 = 170;
export const FRAME_pain2_8 = 171;
export const FRAME_pain3_9 = 172;
export const FRAME_pain3_10 = 173;
export const FRAME_pain3_11 = 174;
export const FRAME_pain3_12 = 175;
export const FRAME_right_1 = 176;
export const FRAME_right_2 = 177;
export const FRAME_right_3 = 178;
export const FRAME_right_4 = 179;
export const FRAME_right_5 = 180;
export const FRAME_right_6 = 181;
export const FRAME_right_7 = 182;
export const FRAME_right_8 = 183;
export const FRAME_right_9 = 184;
export const FRAME_right_10 = 185;
export const FRAME_right_11 = 186;
export const FRAME_right_12 = 187;
export const FRAME_right_13 = 188;
export const FRAME_right_14 = 189;
export const FRAME_right_15 = 190;
export const FRAME_right_16 = 191;
export const FRAME_right_17 = 192;
export const FRAME_right_18 = 193;
export const FRAME_stand_1 = 194;
export const FRAME_stand_2 = 195;
export const FRAME_stand_3 = 196;
export const FRAME_stand_4 = 197;
export const FRAME_stand_5 = 198;
export const FRAME_stand_6 = 199;
export const FRAME_stand_7 = 200;
export const FRAME_stand_8 = 201;
export const FRAME_stand_9 = 202;
export const FRAME_stand_10 = 203;
export const FRAME_stand_11 = 204;
export const FRAME_stand_12 = 205;
export const FRAME_stand_13 = 206;
export const FRAME_stand_14 = 207;
export const FRAME_stand_15 = 208;
export const FRAME_stand_16 = 209;
export const FRAME_stand_17 = 210;
export const FRAME_stand_18 = 211;
export const FRAME_stand_19 = 212;
export const FRAME_stand_20 = 213;
export const FRAME_stand_21 = 214;
export const FRAME_stand_22 = 215;
export const FRAME_stand_23 = 216;
export const FRAME_stand_24 = 217;
export const FRAME_stand_25 = 218;
export const FRAME_stand_26 = 219;
export const FRAME_stand_27 = 220;
export const FRAME_stand_28 = 221;
export const FRAME_stand_29 = 222;
export const FRAME_stand_30 = 223;
export const FRAME_stand_31 = 224;
export const FRAME_stand_32 = 225;
export const FRAME_stand_33 = 226;
export const FRAME_stand_34 = 227;
export const FRAME_stand_35 = 228;
export const FRAME_stand_36 = 229;
export const FRAME_stand_37 = 230;
export const FRAME_stand_38 = 231;
export const FRAME_stand_39 = 232;
export const FRAME_stand_40 = 233;
export const FRAME_stand_41 = 234;
export const FRAME_stand_42 = 235;
export const FRAME_stand_43 = 236;
export const FRAME_stand_44 = 237;
export const FRAME_stand_45 = 238;
export const FRAME_stand_46 = 239;
export const FRAME_stand_47 = 240;
export const FRAME_stand_48 = 241;
export const FRAME_stand_49 = 242;
export const FRAME_stand_50 = 243;
export const FRAME_stand_51 = 244;
export const FRAME_stand_52 = 245;
export const FRAME_stand_53 = 246;
export const FRAME_stand_54 = 247;
export const FRAME_stand_55 = 248;
export const FRAME_stand_56 = 249;
export const FRAME_stand_57 = 250;
export const FRAME_stand_58 = 251;
export const FRAME_stand_59 = 252;
export const FRAME_stand_60 = 253;

export const MODEL_SCALE = 1.0;

/**
 * Original name: N/A
 * Source: N/A (local q_shared flash id aliases)
 * Category: New
 * Fidelity level: Strict
 *
 * Behavior:
 * - Keeps the supertank muzzle flash ids local to this monster module.
 *
 * Porting notes:
 * - Mirrors the `MZ2_SUPERTANK_*` values from `q_shared.h`; `m_supertank.ts`
 *   is not the owner of the shared flash-id port.
 */
export const MZ2_SUPERTANK_MACHINEGUN_1 = 64;
export const MZ2_SUPERTANK_MACHINEGUN_2 = 65;
export const MZ2_SUPERTANK_MACHINEGUN_3 = 66;
export const MZ2_SUPERTANK_MACHINEGUN_4 = 67;
export const MZ2_SUPERTANK_MACHINEGUN_5 = 68;
export const MZ2_SUPERTANK_MACHINEGUN_6 = 69;
export const MZ2_SUPERTANK_ROCKET_1 = 70;
export const MZ2_SUPERTANK_ROCKET_2 = 71;
export const MZ2_SUPERTANK_ROCKET_3 = 72;

const SOUND_PAIN1 = "bosstank/btkpain1.wav";
const SOUND_PAIN2 = "bosstank/btkpain2.wav";
const SOUND_PAIN3 = "bosstank/btkpain3.wav";
const SOUND_DEATH = "bosstank/btkdeth1.wav";
const SOUND_SEARCH1 = "bosstank/btkunqv1.wav";
const SOUND_SEARCH2 = "bosstank/btkunqv2.wav";

/**
 * Original name: N/A
 * Source: N/A (local asset path constant)
 * Category: New
 * Fidelity level: Strict
 *
 * Behavior:
 * - Names the tread sound path registered for supertank engine movement.
 */
const SOUND_TREAD = "bosstank/btkengn1.wav";

/**
 * Original name: N/A
 * Source: N/A (runtime sound handles)
 * Category: New
 * Fidelity level: Strict
 *
 * Behavior:
 * - Caches runtime sound indices produced during supertank asset precache.
 */
let sound_pain1 = 0;
let sound_pain2 = 0;
let sound_pain3 = 0;
let sound_death = 0;
let sound_search1 = 0;
let sound_search2 = 0;

let tread_sound = 0;

/**
 * Original name: TreadSound
 * Source: game/m_supertank.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the registered supertank tread/engine sound on CHAN_VOICE.
 *
 * Porting notes:
 * - Uses the structured game sound event queue instead of direct `gi.sound`.
 */
export function TreadSound(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, tread_sound, SOUND_TREAD, soundOptions(CHAN_VOICE));
}

/**
 * Original name: supertank_search
 * Source: game/m_supertank.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Randomly plays one of the two original supertank search sounds.
 *
 * Porting notes:
 * - Preserves `random() < 0.5` through `g_local.random`.
 */
export function supertank_search(self: GameEntity, runtime: GameRuntime): void {
  if (random() < 0.5) {
    emitRegisteredGameSound(runtime, self, sound_search1, SOUND_SEARCH1, soundOptions(CHAN_VOICE));
  } else {
    emitRegisteredGameSound(runtime, self, sound_search2, SOUND_SEARCH2, soundOptions(CHAN_VOICE));
  }
}

export const supertank_frames_stand = makeFrames(ai_stand, new Array<number>(60).fill(0));
export const supertank_move_stand: GameMonsterMove = {
  firstframe: FRAME_stand_1,
  lastframe: FRAME_stand_60,
  frame: supertank_frames_stand,
  endfunc: undefined
};

/**
 * Original name: supertank_stand
 * Source: game/m_supertank.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Selects `supertank_move_stand` as the current monster move.
 */
export function supertank_stand(self: GameEntity): void {
  self.monsterinfo.currentmove = supertank_move_stand;
}

export const supertank_frames_run = makeFrames(
  ai_run,
  new Array<number>(18).fill(12),
  indexedThinks(18, [[0, TreadSound]])
);
export const supertank_move_run: GameMonsterMove = {
  firstframe: FRAME_forwrd_1,
  lastframe: FRAME_forwrd_18,
  frame: supertank_frames_run,
  endfunc: undefined
};

export const supertank_frames_forward = makeFrames(
  ai_walk,
  new Array<number>(18).fill(4),
  indexedThinks(18, [[0, TreadSound]])
);
export const supertank_move_forward: GameMonsterMove = {
  firstframe: FRAME_forwrd_1,
  lastframe: FRAME_forwrd_18,
  frame: supertank_frames_forward,
  endfunc: undefined
};

/**
 * Original name: supertank_forward
 * Source: game/m_supertank.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Selects `supertank_move_forward` as the current monster move.
 */
export function supertank_forward(self: GameEntity): void {
  self.monsterinfo.currentmove = supertank_move_forward;
}

/**
 * Original name: supertank_walk
 * Source: game/m_supertank.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Selects `supertank_move_forward`, matching the original walk callback.
 */
export function supertank_walk(self: GameEntity): void {
  self.monsterinfo.currentmove = supertank_move_forward;
}

/**
 * Original name: supertank_run
 * Source: game/m_supertank.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Uses the stand move while `AI_STAND_GROUND` is set; otherwise uses the run move.
 */
export function supertank_run(self: GameEntity): void {
  if (self.monsterinfo.aiflags & AI_STAND_GROUND) {
    self.monsterinfo.currentmove = supertank_move_stand;
  } else {
    self.monsterinfo.currentmove = supertank_move_run;
  }
}

export const supertank_frames_turn_right = makeFrames(
  ai_move,
  new Array<number>(18).fill(0),
  indexedThinks(18, [[0, TreadSound]])
);
export const supertank_move_turn_right: GameMonsterMove = {
  firstframe: FRAME_right_1,
  lastframe: FRAME_right_18,
  frame: supertank_frames_turn_right,
  endfunc: supertank_run
};

export const supertank_frames_turn_left = makeFrames(
  ai_move,
  new Array<number>(18).fill(0),
  indexedThinks(18, [[0, TreadSound]])
);
export const supertank_move_turn_left: GameMonsterMove = {
  firstframe: FRAME_left_1,
  lastframe: FRAME_left_18,
  frame: supertank_frames_turn_left,
  endfunc: supertank_run
};

export const supertank_frames_pain3 = makeFrames(ai_move, new Array<number>(4).fill(0));
export const supertank_move_pain3: GameMonsterMove = {
  firstframe: FRAME_pain3_9,
  lastframe: FRAME_pain3_12,
  frame: supertank_frames_pain3,
  endfunc: supertank_run
};

export const supertank_frames_pain2 = makeFrames(ai_move, new Array<number>(4).fill(0));
export const supertank_move_pain2: GameMonsterMove = {
  firstframe: FRAME_pain2_5,
  lastframe: FRAME_pain2_8,
  frame: supertank_frames_pain2,
  endfunc: supertank_run
};

export const supertank_frames_pain1 = makeFrames(ai_move, new Array<number>(4).fill(0));
export const supertank_move_pain1: GameMonsterMove = {
  firstframe: FRAME_pain1_1,
  lastframe: FRAME_pain1_4,
  frame: supertank_frames_pain1,
  endfunc: supertank_run
};

export const supertank_frames_death1 = makeFrames(
  ai_move,
  new Array<number>(24).fill(0),
  indexedThinks(24, [[23, BossExplode]])
);
export const supertank_move_death: GameMonsterMove = {
  firstframe: FRAME_death_1,
  lastframe: FRAME_death_24,
  frame: supertank_frames_death1,
  endfunc: supertank_dead
};

export const supertank_frames_backward = makeFrames(
  ai_walk,
  new Array<number>(18).fill(0),
  indexedThinks(18, [[0, TreadSound]])
);
export const supertank_move_backward: GameMonsterMove = {
  firstframe: FRAME_backwd_1,
  lastframe: FRAME_backwd_18,
  frame: supertank_frames_backward,
  endfunc: undefined
};

export const supertank_frames_attack4 = makeFrames(ai_move, new Array<number>(6).fill(0));
export const supertank_move_attack4: GameMonsterMove = {
  firstframe: FRAME_attak4_1,
  lastframe: FRAME_attak4_6,
  frame: supertank_frames_attack4,
  endfunc: supertank_run
};

export const supertank_frames_attack3 = makeFrames(ai_move, new Array<number>(27).fill(0));
export const supertank_move_attack3: GameMonsterMove = {
  firstframe: FRAME_attak3_1,
  lastframe: FRAME_attak3_27,
  frame: supertank_frames_attack3,
  endfunc: supertank_run
};

export const supertank_frames_attack2 = [
  ...makeFrames(ai_charge, new Array<number>(8).fill(0), indexedThinks(8, [[7, supertankRocket]])),
  ...makeFrames(ai_move, new Array<number>(19).fill(0), indexedThinks(19, [[2, supertankRocket], [5, supertankRocket]]))
];
export const supertank_move_attack2: GameMonsterMove = {
  firstframe: FRAME_attak2_1,
  lastframe: FRAME_attak2_27,
  frame: supertank_frames_attack2,
  endfunc: supertank_run
};

export const supertank_frames_attack1 = makeFrames(
  ai_charge,
  new Array<number>(6).fill(0),
  new Array<GameMonsterFrame["thinkfunc"]>(6).fill(supertankMachineGun)
);
export const supertank_move_attack1: GameMonsterMove = {
  firstframe: FRAME_attak1_1,
  lastframe: FRAME_attak1_6,
  frame: supertank_frames_attack1,
  endfunc: supertank_reattack1
};

export const supertank_frames_end_attack1 = makeFrames(ai_move, new Array<number>(14).fill(0));
export const supertank_move_end_attack1: GameMonsterMove = {
  firstframe: FRAME_attak1_7,
  lastframe: FRAME_attak1_20,
  frame: supertank_frames_end_attack1,
  endfunc: supertank_run
};

/**
 * Original name: supertank_reattack1
 * Source: game/m_supertank.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Continues chaingun fire 90% of the time while the enemy remains visible.
 * - Otherwise transitions to the end-attack move.
 *
 * Porting notes:
 * - Guards the nullable TS `enemy` reference before the original visibility check.
 */
export function supertank_reattack1(self: GameEntity, runtime: GameRuntime): void {
  if (self.enemy && visible(self, self.enemy, runtime)) {
    if (random() < 0.9) {
      self.monsterinfo.currentmove = supertank_move_attack1;
    } else {
      self.monsterinfo.currentmove = supertank_move_end_attack1;
    }
  } else {
    self.monsterinfo.currentmove = supertank_move_end_attack1;
  }
}

/**
 * Original name: supertank_pain
 * Source: game/m_supertank.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Updates the damaged skin, applies debounce and random pain suppression,
 *   skips rocket-firing pain on hard skills, and selects the original pain move by damage.
 *
 * Porting notes:
 * - Reads `level.time` and `skill->value` from the explicit `GameRuntime`.
 */
export function supertank_pain(
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

  if (damage <= 25 && random() < 0.2) {
    return;
  }

  if (runtime.skill >= 2 && self.s.frame >= FRAME_attak2_1 && self.s.frame <= FRAME_attak2_14) {
    return;
  }

  self.pain_debounce_time = runtime.time + 3;

  if (runtime.skill === 3) {
    return;
  }

  if (damage <= 10) {
    emitRegisteredGameSound(runtime, self, sound_pain1, SOUND_PAIN1, soundOptions(CHAN_VOICE));
    self.monsterinfo.currentmove = supertank_move_pain1;
  } else if (damage <= 25) {
    emitRegisteredGameSound(runtime, self, sound_pain3, SOUND_PAIN3, soundOptions(CHAN_VOICE));
    self.monsterinfo.currentmove = supertank_move_pain2;
  } else {
    emitRegisteredGameSound(runtime, self, sound_pain2, SOUND_PAIN2, soundOptions(CHAN_VOICE));
    self.monsterinfo.currentmove = supertank_move_pain3;
  }
}

/**
 * Original name: supertankRocket
 * Source: game/m_supertank.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Selects the rocket muzzle flash from the current attack frame.
 * - Projects the muzzle start and fires a monster rocket at the enemy view height.
 *
 * Porting notes:
 * - Guards the nullable TS `enemy` reference; source runtime only calls this while an enemy exists.
 */
export function supertankRocket(self: GameEntity, runtime: GameRuntime): void {
  if (!self.enemy) {
    return;
  }

  let flash_number: number;

  if (self.s.frame === FRAME_attak2_8) {
    flash_number = MZ2_SUPERTANK_ROCKET_1;
  } else if (self.s.frame === FRAME_attak2_11) {
    flash_number = MZ2_SUPERTANK_ROCKET_2;
  } else {
    flash_number = MZ2_SUPERTANK_ROCKET_3;
  }

  const { forward, right } = AngleVectors(self.s.angles);
  const start = G_ProjectSource(self.s.origin, supertankFlashOffset(flash_number), forward, right);
  const vec: vec3_t = [...self.enemy.s.origin];
  vec[2] += self.enemy.viewheight;
  const dir = normalizeVec3(subtractVec3(vec, start));

  monster_fire_rocket(self, start, dir, 50, 500, flash_number, runtime);
}

/**
 * Original name: supertankMachineGun
 * Source: game/m_supertank.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Derives the supertank machinegun muzzle flash from the current attack frame.
 * - Fires a monster bullet with the original damage, kick and spread values.
 *
 * Porting notes:
 * - Keeps the original yaw-only FIXME aiming base and falls back to it when no enemy is attached.
 */
export function supertankMachineGun(self: GameEntity, runtime: GameRuntime): void {
  const flash_number = MZ2_SUPERTANK_MACHINEGUN_1 + (self.s.frame - FRAME_attak1_1);
  const dirAngles: vec3_t = [0, self.s.angles[1], 0];
  const { forward, right } = AngleVectors(dirAngles);
  const start = G_ProjectSource(self.s.origin, supertankFlashOffset(flash_number), forward, right);
  let aim = forward;

  if (self.enemy) {
    const vec: vec3_t = [...self.enemy.s.origin];
    vec[2] += self.enemy.viewheight;
    aim = normalizeVec3(subtractVec3(vec, start));
  }

  monster_fire_bullet(
    self,
    start,
    aim,
    6,
    4,
    DEFAULT_BULLET_HSPREAD,
    DEFAULT_BULLET_VSPREAD,
    flash_number,
    runtime
  );
}

/**
 * Original name: supertank_attack
 * Source: game/m_supertank.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Chooses chaingun at close range and randomly prefers rockets at distance.
 *
 * Porting notes:
 * - Guards the nullable TS `enemy` reference before matching the original range logic.
 */
export function supertank_attack(self: GameEntity): void {
  if (!self.enemy) {
    return;
  }

  const vec = subtractVec3(self.enemy.s.origin, self.s.origin);
  const range = Math.hypot(vec[0], vec[1], vec[2]);

  if (range <= 160) {
    self.monsterinfo.currentmove = supertank_move_attack1;
  } else if (random() < 0.3) {
    self.monsterinfo.currentmove = supertank_move_attack1;
  } else {
    self.monsterinfo.currentmove = supertank_move_attack2;
  }
}

/**
 * Original name: supertank_dead
 * Source: game/m_supertank.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Shrinks the dead monster bounds, switches to toss movement, marks `SVF_DEADMONSTER`,
 *   clears future thinking and relinks the entity.
 */
export function supertank_dead(self: GameEntity, runtime: GameRuntime): void {
  setVec3(self.mins, -60, -60, 0);
  setVec3(self.maxs, 60, 60, 72);
  self.movetype = MOVETYPE_TOSS;
  self.svflags |= SVF_DEADMONSTER;
  self.nextthink = 0;
  linkGameEntity(runtime, self);
}

/**
 * Original name: BossExplode
 * Source: game/m_supertank.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the staged `TE_EXPLOSION1` boss death explosions.
 * - On the final stage clears looping sound, throws original gib models and marks the boss dead.
 *
 * Porting notes:
 * - Emits structured temp-entity events and game gibs instead of direct `gi.Write*`/`gi.multicast`.
 */
export function BossExplode(self: GameEntity, runtime: GameRuntime): void {
  const org: vec3_t = [...self.s.origin];
  let n: number;

  self.think = BossExplode;
  org[2] += 24 + (randomInt(32768) & 15);

  switch (self.count++) {
    case 0:
      org[0] -= 24;
      org[1] -= 24;
      break;
    case 1:
      org[0] += 24;
      org[1] += 24;
      break;
    case 2:
      org[0] += 24;
      org[1] -= 24;
      break;
    case 3:
      org[0] -= 24;
      org[1] += 24;
      break;
    case 4:
      org[0] -= 48;
      org[1] -= 48;
      break;
    case 5:
      org[0] += 48;
      org[1] += 48;
      break;
    case 6:
      org[0] -= 48;
      org[1] += 48;
      break;
    case 7:
      org[0] += 48;
      org[1] -= 48;
      break;
    case 8:
      self.s.sound = 0;
      for (n = 0; n < 4; n += 1) {
        ThrowGib(self, "models/objects/gibs/sm_meat/tris.md2", 500, GIB_ORGANIC, runtime);
      }
      for (n = 0; n < 8; n += 1) {
        ThrowGib(self, "models/objects/gibs/sm_metal/tris.md2", 500, GIB_METALLIC, runtime);
      }
      ThrowGib(self, "models/objects/gibs/chest/tris.md2", 500, GIB_ORGANIC, runtime);
      ThrowHead(self, "models/objects/gibs/gear/tris.md2", 500, GIB_METALLIC, runtime);
      self.deadflag = DEAD_DEAD;
      return;
  }

  emitGameTempEntity(runtime, temp_event_t.TE_EXPLOSION1, org, multicast_t.MULTICAST_PVS, {
    source: "BossExplode"
  });

  self.nextthink = runtime.time + 0.1;
}

/**
 * Original name: supertank_die
 * Source: game/m_supertank.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Plays the death sound, marks the boss dead and starts the death animation move.
 */
export function supertank_die(
  self: GameEntity,
  _inflictor: GameEntity | null,
  _attacker: GameEntity | null,
  _damage: number,
  runtime: GameRuntime
): void {
  emitRegisteredGameSound(runtime, self, sound_death, SOUND_DEATH, soundOptions(CHAN_VOICE));
  self.deadflag = DEAD_DEAD;
  self.takedamage = damage_t.DAMAGE_NO;
  self.count = 0;
  self.monsterinfo.currentmove = supertank_move_death;
}

/**
 * Original name: SP_monster_supertank
 * Source: game/m_supertank.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns monster_supertank, precaches assets and initializes walking monster callbacks.
 */
export function SP_monster_supertank(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  precacheSupertankAssets(runtime);

  self.movetype = MOVETYPE_STEP;
  self.solid = SOLID_BBOX;
  self.s.modelindex = registerGameModel(runtime, "models/monsters/boss1/tris.md2");
  setVec3(self.mins, -64, -64, 0);
  setVec3(self.maxs, 64, 64, 112);

  self.health = 1500;
  self.gib_health = -500;
  self.mass = 800;

  self.pain = supertank_pain;
  self.die = supertank_die;
  self.monsterinfo.stand = supertank_stand;
  self.monsterinfo.walk = supertank_walk;
  self.monsterinfo.run = supertank_run;
  self.monsterinfo.dodge = undefined;
  self.monsterinfo.attack = supertank_attack;
  self.monsterinfo.search = supertank_search;
  self.monsterinfo.melee = undefined;
  self.monsterinfo.sight = undefined;

  linkGameEntity(runtime, self);

  self.monsterinfo.currentmove = supertank_move_stand;
  self.monsterinfo.scale = MODEL_SCALE;

  walkmonster_start(self, runtime);
}

/**
 * Original name: N/A
 * Source: N/A (local monster frame builder)
 * Category: New
 * Fidelity level: Strict
 *
 * Behavior:
 * - Builds declarative monster frame entries from distances and optional callbacks.
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
 * Behavior:
 * - Places sparse frame callbacks at their original C table indexes.
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
 * Behavior:
 * - Registers supertank sound assets in the same order as `SP_monster_supertank`.
 */
function precacheSupertankAssets(runtime: GameRuntime): void {
  sound_pain1 = registerGameSound(runtime, SOUND_PAIN1);
  sound_pain2 = registerGameSound(runtime, SOUND_PAIN2);
  sound_pain3 = registerGameSound(runtime, SOUND_PAIN3);
  sound_death = registerGameSound(runtime, SOUND_DEATH);
  sound_search1 = registerGameSound(runtime, SOUND_SEARCH1);
  sound_search2 = registerGameSound(runtime, SOUND_SEARCH2);
  tread_sound = registerGameSound(runtime, SOUND_TREAD);
}

/**
 * Original name: N/A
 * Source: N/A (local sound options helper)
 * Category: New
 * Fidelity level: Strict
 *
 * Behavior:
 * - Builds the structured sound options used by supertank sound emissions.
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
 * Behavior:
 * - Resolves a supertank muzzle flash id to the shared monster flash offset table.
 */
function supertankFlashOffset(flashNumber: number): vec3_t {
  return getMonsterFlashOffset(flashNumber);
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Fidelity level: Strict
 *
 * Behavior:
 * - Mutates an existing vector with three component values.
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
 * Behavior:
 * - Returns `left - right` as a new vector.
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
 * Behavior:
 * - Normalizes a vector and preserves the zero-vector guard used by the TS runtime.
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
 * Source: N/A (local random integer helper)
 * Category: New
 * Fidelity level: Strict
 *
 * Behavior:
 * - Produces an integer bucket matching the local `rand() & 15` source call site.
 */
function randomInt(maxExclusive: number): number {
  return Math.trunc(Math.random() * maxExclusive);
}
