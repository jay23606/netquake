/**
 * File: m_float.ts
 * Source: Quake II original / game/m_float.h and game/m_float.c
 * Purpose: Port of the generated float model frame constants and monster_floater gameplay behavior.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses the explicit gameplay runtime and asset helpers instead of `gi.*`.
 * - Keeps `FLOAT_ZAP_OFFSET` local because `game/m_float.c` uses a manual zap offset and comments out `monster_flash_offset`.
 *
 * Notes:
 * - This file keeps the header constants and C behavior together as the principal attachment point for `m_float`.
 */

import {
  AngleVectors,
  ATTN_IDLE,
  ATTN_NORM,
  CHAN_VOICE,
  CHAN_WEAPON,
  EF_HYPERBLASTER,
  multicast_t,
  temp_event_t,
  type vec3_t
} from "../../qcommon/src/index.js";
import {
  AI_STAND_GROUND,
  DAMAGE_ENERGY,
  MELEE_DISTANCE,
  MOD_UNKNOWN,
  MOVETYPE_STEP,
  MOVETYPE_TOSS,
  random,
  SOLID_BBOX,
  SVF_DEADMONSTER
} from "./g_local.js";
import { ai_charge, ai_move, ai_run, ai_stand, ai_walk } from "./g_ai.js";
import { T_Damage } from "./g_combat.js";
import { flymonster_start, monster_fire_blaster } from "./g_monster.js";
import { BecomeExplosion1 } from "./g_misc.js";
import { G_FreeEdict, G_ProjectSource } from "./g_utils.js";
import { getMonsterFlashOffset } from "./m_flash.js";
import { fire_hit } from "./g_weapon.js";
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

export const FRAME_actvat01 = 0;
export const FRAME_actvat02 = 1;
export const FRAME_actvat03 = 2;
export const FRAME_actvat04 = 3;
export const FRAME_actvat05 = 4;
export const FRAME_actvat06 = 5;
export const FRAME_actvat07 = 6;
export const FRAME_actvat08 = 7;
export const FRAME_actvat09 = 8;
export const FRAME_actvat10 = 9;
export const FRAME_actvat11 = 10;
export const FRAME_actvat12 = 11;
export const FRAME_actvat13 = 12;
export const FRAME_actvat14 = 13;
export const FRAME_actvat15 = 14;
export const FRAME_actvat16 = 15;
export const FRAME_actvat17 = 16;
export const FRAME_actvat18 = 17;
export const FRAME_actvat19 = 18;
export const FRAME_actvat20 = 19;
export const FRAME_actvat21 = 20;
export const FRAME_actvat22 = 21;
export const FRAME_actvat23 = 22;
export const FRAME_actvat24 = 23;
export const FRAME_actvat25 = 24;
export const FRAME_actvat26 = 25;
export const FRAME_actvat27 = 26;
export const FRAME_actvat28 = 27;
export const FRAME_actvat29 = 28;
export const FRAME_actvat30 = 29;
export const FRAME_actvat31 = 30;
export const FRAME_attak101 = 31;
export const FRAME_attak102 = 32;
export const FRAME_attak103 = 33;
export const FRAME_attak104 = 34;
export const FRAME_attak105 = 35;
export const FRAME_attak106 = 36;
export const FRAME_attak107 = 37;
export const FRAME_attak108 = 38;
export const FRAME_attak109 = 39;
export const FRAME_attak110 = 40;
export const FRAME_attak111 = 41;
export const FRAME_attak112 = 42;
export const FRAME_attak113 = 43;
export const FRAME_attak114 = 44;
export const FRAME_attak201 = 45;
export const FRAME_attak202 = 46;
export const FRAME_attak203 = 47;
export const FRAME_attak204 = 48;
export const FRAME_attak205 = 49;
export const FRAME_attak206 = 50;
export const FRAME_attak207 = 51;
export const FRAME_attak208 = 52;
export const FRAME_attak209 = 53;
export const FRAME_attak210 = 54;
export const FRAME_attak211 = 55;
export const FRAME_attak212 = 56;
export const FRAME_attak213 = 57;
export const FRAME_attak214 = 58;
export const FRAME_attak215 = 59;
export const FRAME_attak216 = 60;
export const FRAME_attak217 = 61;
export const FRAME_attak218 = 62;
export const FRAME_attak219 = 63;
export const FRAME_attak220 = 64;
export const FRAME_attak221 = 65;
export const FRAME_attak222 = 66;
export const FRAME_attak223 = 67;
export const FRAME_attak224 = 68;
export const FRAME_attak225 = 69;
export const FRAME_attak301 = 70;
export const FRAME_attak302 = 71;
export const FRAME_attak303 = 72;
export const FRAME_attak304 = 73;
export const FRAME_attak305 = 74;
export const FRAME_attak306 = 75;
export const FRAME_attak307 = 76;
export const FRAME_attak308 = 77;
export const FRAME_attak309 = 78;
export const FRAME_attak310 = 79;
export const FRAME_attak311 = 80;
export const FRAME_attak312 = 81;
export const FRAME_attak313 = 82;
export const FRAME_attak314 = 83;
export const FRAME_attak315 = 84;
export const FRAME_attak316 = 85;
export const FRAME_attak317 = 86;
export const FRAME_attak318 = 87;
export const FRAME_attak319 = 88;
export const FRAME_attak320 = 89;
export const FRAME_attak321 = 90;
export const FRAME_attak322 = 91;
export const FRAME_attak323 = 92;
export const FRAME_attak324 = 93;
export const FRAME_attak325 = 94;
export const FRAME_attak326 = 95;
export const FRAME_attak327 = 96;
export const FRAME_attak328 = 97;
export const FRAME_attak329 = 98;
export const FRAME_attak330 = 99;
export const FRAME_attak331 = 100;
export const FRAME_attak332 = 101;
export const FRAME_attak333 = 102;
export const FRAME_attak334 = 103;
export const FRAME_death01 = 104;
export const FRAME_death02 = 105;
export const FRAME_death03 = 106;
export const FRAME_death04 = 107;
export const FRAME_death05 = 108;
export const FRAME_death06 = 109;
export const FRAME_death07 = 110;
export const FRAME_death08 = 111;
export const FRAME_death09 = 112;
export const FRAME_death10 = 113;
export const FRAME_death11 = 114;
export const FRAME_death12 = 115;
export const FRAME_death13 = 116;
export const FRAME_pain101 = 117;
export const FRAME_pain102 = 118;
export const FRAME_pain103 = 119;
export const FRAME_pain104 = 120;
export const FRAME_pain105 = 121;
export const FRAME_pain106 = 122;
export const FRAME_pain107 = 123;
export const FRAME_pain201 = 124;
export const FRAME_pain202 = 125;
export const FRAME_pain203 = 126;
export const FRAME_pain204 = 127;
export const FRAME_pain205 = 128;
export const FRAME_pain206 = 129;
export const FRAME_pain207 = 130;
export const FRAME_pain208 = 131;
export const FRAME_pain301 = 132;
export const FRAME_pain302 = 133;
export const FRAME_pain303 = 134;
export const FRAME_pain304 = 135;
export const FRAME_pain305 = 136;
export const FRAME_pain306 = 137;
export const FRAME_pain307 = 138;
export const FRAME_pain308 = 139;
export const FRAME_pain309 = 140;
export const FRAME_pain310 = 141;
export const FRAME_pain311 = 142;
export const FRAME_pain312 = 143;
export const FRAME_stand101 = 144;
export const FRAME_stand102 = 145;
export const FRAME_stand103 = 146;
export const FRAME_stand104 = 147;
export const FRAME_stand105 = 148;
export const FRAME_stand106 = 149;
export const FRAME_stand107 = 150;
export const FRAME_stand108 = 151;
export const FRAME_stand109 = 152;
export const FRAME_stand110 = 153;
export const FRAME_stand111 = 154;
export const FRAME_stand112 = 155;
export const FRAME_stand113 = 156;
export const FRAME_stand114 = 157;
export const FRAME_stand115 = 158;
export const FRAME_stand116 = 159;
export const FRAME_stand117 = 160;
export const FRAME_stand118 = 161;
export const FRAME_stand119 = 162;
export const FRAME_stand120 = 163;
export const FRAME_stand121 = 164;
export const FRAME_stand122 = 165;
export const FRAME_stand123 = 166;
export const FRAME_stand124 = 167;
export const FRAME_stand125 = 168;
export const FRAME_stand126 = 169;
export const FRAME_stand127 = 170;
export const FRAME_stand128 = 171;
export const FRAME_stand129 = 172;
export const FRAME_stand130 = 173;
export const FRAME_stand131 = 174;
export const FRAME_stand132 = 175;
export const FRAME_stand133 = 176;
export const FRAME_stand134 = 177;
export const FRAME_stand135 = 178;
export const FRAME_stand136 = 179;
export const FRAME_stand137 = 180;
export const FRAME_stand138 = 181;
export const FRAME_stand139 = 182;
export const FRAME_stand140 = 183;
export const FRAME_stand141 = 184;
export const FRAME_stand142 = 185;
export const FRAME_stand143 = 186;
export const FRAME_stand144 = 187;
export const FRAME_stand145 = 188;
export const FRAME_stand146 = 189;
export const FRAME_stand147 = 190;
export const FRAME_stand148 = 191;
export const FRAME_stand149 = 192;
export const FRAME_stand150 = 193;
export const FRAME_stand151 = 194;
export const FRAME_stand152 = 195;
export const FRAME_stand201 = 196;
export const FRAME_stand202 = 197;
export const FRAME_stand203 = 198;
export const FRAME_stand204 = 199;
export const FRAME_stand205 = 200;
export const FRAME_stand206 = 201;
export const FRAME_stand207 = 202;
export const FRAME_stand208 = 203;
export const FRAME_stand209 = 204;
export const FRAME_stand210 = 205;
export const FRAME_stand211 = 206;
export const FRAME_stand212 = 207;
export const FRAME_stand213 = 208;
export const FRAME_stand214 = 209;
export const FRAME_stand215 = 210;
export const FRAME_stand216 = 211;
export const FRAME_stand217 = 212;
export const FRAME_stand218 = 213;
export const FRAME_stand219 = 214;
export const FRAME_stand220 = 215;
export const FRAME_stand221 = 216;
export const FRAME_stand222 = 217;
export const FRAME_stand223 = 218;
export const FRAME_stand224 = 219;
export const FRAME_stand225 = 220;
export const FRAME_stand226 = 221;
export const FRAME_stand227 = 222;
export const FRAME_stand228 = 223;
export const FRAME_stand229 = 224;
export const FRAME_stand230 = 225;
export const FRAME_stand231 = 226;
export const FRAME_stand232 = 227;
export const FRAME_stand233 = 228;
export const FRAME_stand234 = 229;
export const FRAME_stand235 = 230;
export const FRAME_stand236 = 231;
export const FRAME_stand237 = 232;
export const FRAME_stand238 = 233;
export const FRAME_stand239 = 234;
export const FRAME_stand240 = 235;
export const FRAME_stand241 = 236;
export const FRAME_stand242 = 237;
export const FRAME_stand243 = 238;
export const FRAME_stand244 = 239;
export const FRAME_stand245 = 240;
export const FRAME_stand246 = 241;
export const FRAME_stand247 = 242;
export const FRAME_stand248 = 243;
export const FRAME_stand249 = 244;
export const FRAME_stand250 = 245;
export const FRAME_stand251 = 246;
export const FRAME_stand252 = 247;

export const MODEL_SCALE = 1.0;

/**
 * Original name: N/A
 * Source: N/A (local q_shared flash id alias)
 * Category: New
 * Fidelity level: Strict
 *
 * Behavior:
 * - Keeps the floater blaster muzzle id local to this monster module.
 *
 * Porting notes:
 * - Mirrors `MZ2_FLOAT_BLASTER_1` from `q_shared.h`; `m_float.ts` is not the owner of the shared flash-id port.
 */
export const MZ2_FLOAT_BLASTER_1 = 82;

/**
 * Original name: N/A
 * Source: N/A (local zap offset)
 * Category: New
 * Fidelity level: Strict
 *
 * Behavior:
 * - Stores the manual floater zap offset used by the original `floater_zap` body.
 */
const FLOAT_ZAP_OFFSET: vec3_t = [18.5, -0.9, 10];

/**
 * Original name: N/A
 * Source: N/A (local asset path constants)
 * Category: New
 * Fidelity level: Strict
 *
 * Behavior:
 * - Names the sound paths precached or emitted by `SP_monster_floater` and floater callbacks.
 */
const SOUND_ATTACK1 = "floater/fltatck1.wav";
const SOUND_ATTACK2 = "floater/fltatck2.wav";
const SOUND_ATTACK3 = "floater/fltatck3.wav";
const SOUND_DEATH1 = "floater/fltdeth1.wav";
const SOUND_IDLE = "floater/fltidle1.wav";
const SOUND_PAIN1 = "floater/fltpain1.wav";
const SOUND_PAIN2 = "floater/fltpain2.wav";
const SOUND_SEARCH = "floater/fltsrch1.wav";
const SOUND_SIGHT = "floater/fltsght1.wav";

/**
 * Original name: N/A
 * Source: N/A (runtime sound handles)
 * Category: New
 * Fidelity level: Strict
 *
 * Behavior:
 * - Caches runtime sound indices produced during floater asset precache.
 */
let sound_attack2 = 0;
let sound_attack3 = 0;
let sound_death1 = 0;
let sound_idle = 0;
let sound_pain1 = 0;
let sound_pain2 = 0;
let sound_sight = 0;

/**
 * Original name: floater_sight
 * Source: game/m_float.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Plays the floater sight sound on target acquisition.
 */
export function floater_sight(self: GameEntity, _other: GameEntity | null, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_sight, SOUND_SIGHT, {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
}

/**
 * Original name: floater_idle
 * Source: game/m_float.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Plays the floater idle sound with the original idle attenuation.
 */
export function floater_idle(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_idle, SOUND_IDLE, {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_IDLE,
    timeofs: 0
  });
}

/**
 * Original name: floater_fire_blaster
 * Source: game/m_float.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Projects the floater blaster muzzle and fires one low-damage fast blaster bolt toward the enemy view height.
 */
export function floater_fire_blaster(self: GameEntity, runtime: GameRuntime): void {
  if (!self.enemy) {
    return;
  }

  const effect = (self.s.frame === FRAME_attak104 || self.s.frame === FRAME_attak107) ? EF_HYPERBLASTER : 0;
  const { forward, right } = AngleVectors(self.s.angles);
  const start = G_ProjectSource(self.s.origin, getMonsterFlashOffset(MZ2_FLOAT_BLASTER_1), forward, right);
  const end: vec3_t = [...self.enemy.s.origin];
  end[2] += self.enemy.viewheight;
  const dir = subtractVec3(end, start);

  monster_fire_blaster(self, start, dir, 1, 1000, MZ2_FLOAT_BLASTER_1, effect, runtime);
}

const floater_frames_stand1 = makeFrames(ai_stand, new Array<number>(52).fill(0));
export const floater_move_stand1: GameMonsterMove = {
  firstframe: FRAME_stand101,
  lastframe: FRAME_stand152,
  frame: floater_frames_stand1,
  endfunc: undefined
};

const floater_frames_stand2 = makeFrames(ai_stand, new Array<number>(52).fill(0));
export const floater_move_stand2: GameMonsterMove = {
  firstframe: FRAME_stand201,
  lastframe: FRAME_stand252,
  frame: floater_frames_stand2,
  endfunc: undefined
};

/**
 * Original name: floater_stand
 * Source: game/m_float.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Randomly selects one of the two floater standing loops.
 */
export function floater_stand(self: GameEntity): void {
  if (random() <= 0.5) {
    self.monsterinfo.currentmove = floater_move_stand1;
  } else {
    self.monsterinfo.currentmove = floater_move_stand2;
  }
}

const floater_frames_activate = makeFrames(ai_move, new Array<number>(30).fill(0));
export const floater_move_activate: GameMonsterMove = {
  firstframe: FRAME_actvat01,
  lastframe: FRAME_actvat31,
  frame: floater_frames_activate,
  endfunc: undefined
};

const floater_frames_attack1 = makeFrames(
  ai_charge,
  new Array<number>(14).fill(0),
  indexedThinks(14, [
    [3, floater_fire_blaster],
    [4, floater_fire_blaster],
    [5, floater_fire_blaster],
    [6, floater_fire_blaster],
    [7, floater_fire_blaster],
    [8, floater_fire_blaster],
    [9, floater_fire_blaster]
  ])
);
export const floater_move_attack1: GameMonsterMove = {
  firstframe: FRAME_attak101,
  lastframe: FRAME_attak114,
  frame: floater_frames_attack1,
  endfunc: floater_run
};

const floater_frames_attack2 = makeFrames(
  ai_charge,
  new Array<number>(25).fill(0),
  indexedThinks(25, [[11, floater_wham]])
);
export const floater_move_attack2: GameMonsterMove = {
  firstframe: FRAME_attak201,
  lastframe: FRAME_attak225,
  frame: floater_frames_attack2,
  endfunc: floater_run
};

const floater_frames_attack3 = makeFrames(
  ai_charge,
  new Array<number>(34).fill(0),
  indexedThinks(34, [[8, floater_zap]])
);
export const floater_move_attack3: GameMonsterMove = {
  firstframe: FRAME_attak301,
  lastframe: FRAME_attak334,
  frame: floater_frames_attack3,
  endfunc: floater_run
};

const floater_frames_death = makeFrames(ai_move, new Array<number>(13).fill(0));
export const floater_move_death: GameMonsterMove = {
  firstframe: FRAME_death01,
  lastframe: FRAME_death13,
  frame: floater_frames_death,
  endfunc: floater_dead
};

const floater_frames_pain1 = makeFrames(ai_move, new Array<number>(7).fill(0));
export const floater_move_pain1: GameMonsterMove = {
  firstframe: FRAME_pain101,
  lastframe: FRAME_pain107,
  frame: floater_frames_pain1,
  endfunc: floater_run
};

const floater_frames_pain2 = makeFrames(ai_move, new Array<number>(8).fill(0));
export const floater_move_pain2: GameMonsterMove = {
  firstframe: FRAME_pain201,
  lastframe: FRAME_pain208,
  frame: floater_frames_pain2,
  endfunc: floater_run
};

const floater_frames_pain3 = makeFrames(ai_move, new Array<number>(12).fill(0));
export const floater_move_pain3: GameMonsterMove = {
  firstframe: FRAME_pain301,
  lastframe: FRAME_pain312,
  frame: floater_frames_pain3,
  endfunc: floater_run
};

const floater_frames_walk = makeFrames(ai_walk, new Array<number>(52).fill(5));
export const floater_move_walk: GameMonsterMove = {
  firstframe: FRAME_stand101,
  lastframe: FRAME_stand152,
  frame: floater_frames_walk,
  endfunc: undefined
};

const floater_frames_run = makeFrames(ai_run, new Array<number>(52).fill(13));
export const floater_move_run: GameMonsterMove = {
  firstframe: FRAME_stand101,
  lastframe: FRAME_stand152,
  frame: floater_frames_run,
  endfunc: undefined
};

/**
 * Original name: floater_run
 * Source: game/m_float.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Uses stand animation while holding ground, otherwise enters the run loop.
 */
export function floater_run(self: GameEntity): void {
  if ((self.monsterinfo.aiflags & AI_STAND_GROUND) !== 0) {
    self.monsterinfo.currentmove = floater_move_stand1;
  } else {
    self.monsterinfo.currentmove = floater_move_run;
  }
}

/**
 * Original name: floater_walk
 * Source: game/m_float.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Starts the floater walk loop.
 */
export function floater_walk(self: GameEntity): void {
  self.monsterinfo.currentmove = floater_move_walk;
}

/**
 * Original name: floater_wham
 * Source: game/m_float.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Plays the claw impact sound and performs the original melee hit test.
 */
export function floater_wham(self: GameEntity, runtime: GameRuntime): void {
  const aim: vec3_t = [MELEE_DISTANCE, 0, 0];
  emitRegisteredGameSound(runtime, self, sound_attack3, SOUND_ATTACK3, {
    channel: CHAN_WEAPON,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
  fire_hit(self, aim, 5 + randomInt(6), -50, runtime);
}

/**
 * Original name: floater_zap
 * Source: game/m_float.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the claw zap spark splash and applies direct energy damage to the current enemy.
 */
export function floater_zap(self: GameEntity, runtime: GameRuntime): void {
  if (!self.enemy) {
    return;
  }

  const dir = subtractVec3(self.enemy.s.origin, self.s.origin);
  const { forward, right } = AngleVectors(self.s.angles);
  const origin = G_ProjectSource(self.s.origin, FLOAT_ZAP_OFFSET, forward, right);

  emitRegisteredGameSound(runtime, self, sound_attack2, SOUND_ATTACK2, {
    channel: CHAN_WEAPON,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });

  emitGameTempEntity(runtime, temp_event_t.TE_SPLASH, origin, multicast_t.MULTICAST_PVS, {
    count: 32,
    dir,
    color: 1
  });

  T_Damage(
    self.enemy,
    self,
    self,
    dir,
    self.enemy.s.origin,
    [0, 0, 0],
    5 + randomInt(6),
    -10,
    DAMAGE_ENERGY,
    MOD_UNKNOWN,
    runtime
  );
}

/**
 * Original name: floater_attack
 * Source: game/m_float.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Starts the floater ranged blaster attack.
 */
export function floater_attack(self: GameEntity): void {
  self.monsterinfo.currentmove = floater_move_attack1;
}

/**
 * Original name: floater_melee
 * Source: game/m_float.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Randomly chooses the zap or claw melee attack.
 */
export function floater_melee(self: GameEntity): void {
  if (random() < 0.5) {
    self.monsterinfo.currentmove = floater_move_attack3;
  } else {
    self.monsterinfo.currentmove = floater_move_attack2;
  }
}

/**
 * Original name: floater_pain
 * Source: game/m_float.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies damaged skin, pain debounce, nightmare suppression and one of two used pain moves.
 */
export function floater_pain(
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

  const n = (randomInt(0x7fffffff) + 1) % 3;
  if (n === 0) {
    emitRegisteredGameSound(runtime, self, sound_pain1, SOUND_PAIN1, {
      channel: CHAN_VOICE,
      volume: 1,
      attenuation: ATTN_NORM,
      timeofs: 0
    });
    self.monsterinfo.currentmove = floater_move_pain1;
  } else {
    emitRegisteredGameSound(runtime, self, sound_pain2, SOUND_PAIN2, {
      channel: CHAN_VOICE,
      volume: 1,
      attenuation: ATTN_NORM,
      timeofs: 0
    });
    self.monsterinfo.currentmove = floater_move_pain2;
  }
}

/**
 * Original name: floater_dead
 * Source: game/m_float.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Finalizes the floater corpse bbox, movetype, dead-monster flag and link state.
 */
export function floater_dead(self: GameEntity, runtime: GameRuntime): void {
  setVec3(self.mins, -16, -16, -24);
  setVec3(self.maxs, 16, 16, -8);
  self.movetype = MOVETYPE_TOSS;
  self.svflags |= SVF_DEADMONSTER;
  self.nextthink = 0;
  linkGameEntity(runtime, self);
}

/**
 * Original name: floater_die
 * Source: game/m_float.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Plays the death sound and immediately turns the floater into the original explosion temp entity.
 */
export function floater_die(
  self: GameEntity,
  _inflictor: GameEntity | null,
  _attacker: GameEntity | null,
  _damage: number,
  runtime: GameRuntime
): void {
  emitRegisteredGameSound(runtime, self, sound_death1, SOUND_DEATH1, {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
  BecomeExplosion1(self, runtime);
}

/**
 * Original name: SP_monster_floater
 * Source: game/m_float.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns monster_floater, precaches assets and initializes flying monster callbacks.
 */
export function SP_monster_floater(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  precacheFloaterAssets(runtime);

  self.s.sound = registerGameSound(runtime, SOUND_SEARCH);
  self.movetype = MOVETYPE_STEP;
  self.solid = SOLID_BBOX;
  self.s.modelindex = registerGameModel(runtime, "models/monsters/float/tris.md2");
  setVec3(self.mins, -24, -24, -24);
  setVec3(self.maxs, 24, 24, 32);

  self.health = 200;
  self.gib_health = -80;
  self.mass = 300;

  self.pain = floater_pain;
  self.die = floater_die;

  self.monsterinfo.stand = floater_stand;
  self.monsterinfo.walk = floater_walk;
  self.monsterinfo.run = floater_run;
  self.monsterinfo.attack = floater_attack;
  self.monsterinfo.melee = floater_melee;
  self.monsterinfo.sight = floater_sight;
  self.monsterinfo.idle = floater_idle;

  linkGameEntity(runtime, self);

  if (random() <= 0.5) {
    self.monsterinfo.currentmove = floater_move_stand1;
  } else {
    self.monsterinfo.currentmove = floater_move_stand2;
  }

  self.monsterinfo.scale = MODEL_SCALE;

  flymonster_start(self, runtime);
}

/**
 * Original name: N/A
 * Source: N/A (local monster frame builder)
 * Category: New
 * Fidelity level: Strict
 *
 * Behavior:
 * - Builds declarative monster frame entries from distances and optional think callbacks.
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
 * - Places sparse frame callbacks at their original zero-based table positions.
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
 * - Registers floater sound assets in the same order as `SP_monster_floater`.
 */
function precacheFloaterAssets(runtime: GameRuntime): void {
  sound_attack2 = registerGameSound(runtime, SOUND_ATTACK2);
  sound_attack3 = registerGameSound(runtime, SOUND_ATTACK3);
  sound_death1 = registerGameSound(runtime, SOUND_DEATH1);
  sound_idle = registerGameSound(runtime, SOUND_IDLE);
  sound_pain1 = registerGameSound(runtime, SOUND_PAIN1);
  sound_pain2 = registerGameSound(runtime, SOUND_PAIN2);
  sound_sight = registerGameSound(runtime, SOUND_SIGHT);
  registerGameSound(runtime, SOUND_ATTACK1);
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
  return [
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2]
  ];
}

/**
 * Original name: N/A
 * Source: N/A (local rand helper)
 * Category: New
 * Fidelity level: Strict
 *
 * Behavior:
 * - Produces an integer bucket matching the local `rand() % maxExclusive` call sites.
 */
function randomInt(maxExclusive: number): number {
  return Math.trunc(Math.random() * maxExclusive);
}
