/**
 * File: m_mutant.ts
 * Source: Quake II original / game/m_mutant.h and game/m_mutant.c
 * Purpose: Port of the generated mutant model frame constants and monster_mutant gameplay behavior.
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
 * - This file keeps the header constants and C behavior together as the principal attachment point for `m_mutant`.
 */

import { AngleVectors, ATTN_IDLE, ATTN_NORM, CHAN_VOICE, CHAN_WEAPON, type vec3_t } from "../../qcommon/src/index.js";
import {
  AI_DUCKED,
  AI_STAND_GROUND,
  AS_MELEE,
  AS_MISSILE,
  DEAD_DEAD,
  GIB_ORGANIC,
  MELEE_DISTANCE,
  MOD_UNKNOWN,
  MOVETYPE_STEP,
  MOVETYPE_TOSS,
  RANGE_MELEE,
  SOLID_BBOX,
  SVF_DEADMONSTER,
  damage_t,
  random
} from "./g_local.js";
import { ai_charge, ai_move, ai_run, ai_stand, ai_walk, range } from "./g_ai.js";
import { T_Damage } from "./g_combat.js";
import { M_FlyCheck, walkmonster_start } from "./g_monster.js";
import { ThrowGib, ThrowHead } from "./g_misc.js";
import { G_FreeEdict } from "./g_utils.js";
import { M_CheckBottom } from "./m_move.js";
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

export const FRAME_attack01 = 0;
export const FRAME_attack02 = 1;
export const FRAME_attack03 = 2;
export const FRAME_attack04 = 3;
export const FRAME_attack05 = 4;
export const FRAME_attack06 = 5;
export const FRAME_attack07 = 6;
export const FRAME_attack08 = 7;
export const FRAME_attack09 = 8;
export const FRAME_attack10 = 9;
export const FRAME_attack11 = 10;
export const FRAME_attack12 = 11;
export const FRAME_attack13 = 12;
export const FRAME_attack14 = 13;
export const FRAME_attack15 = 14;
export const FRAME_death101 = 15;
export const FRAME_death102 = 16;
export const FRAME_death103 = 17;
export const FRAME_death104 = 18;
export const FRAME_death105 = 19;
export const FRAME_death106 = 20;
export const FRAME_death107 = 21;
export const FRAME_death108 = 22;
export const FRAME_death109 = 23;
export const FRAME_death201 = 24;
export const FRAME_death202 = 25;
export const FRAME_death203 = 26;
export const FRAME_death204 = 27;
export const FRAME_death205 = 28;
export const FRAME_death206 = 29;
export const FRAME_death207 = 30;
export const FRAME_death208 = 31;
export const FRAME_death209 = 32;
export const FRAME_death210 = 33;
export const FRAME_pain101 = 34;
export const FRAME_pain102 = 35;
export const FRAME_pain103 = 36;
export const FRAME_pain104 = 37;
export const FRAME_pain105 = 38;
export const FRAME_pain201 = 39;
export const FRAME_pain202 = 40;
export const FRAME_pain203 = 41;
export const FRAME_pain204 = 42;
export const FRAME_pain205 = 43;
export const FRAME_pain206 = 44;
export const FRAME_pain301 = 45;
export const FRAME_pain302 = 46;
export const FRAME_pain303 = 47;
export const FRAME_pain304 = 48;
export const FRAME_pain305 = 49;
export const FRAME_pain306 = 50;
export const FRAME_pain307 = 51;
export const FRAME_pain308 = 52;
export const FRAME_pain309 = 53;
export const FRAME_pain310 = 54;
export const FRAME_pain311 = 55;
export const FRAME_run03 = 56;
export const FRAME_run04 = 57;
export const FRAME_run05 = 58;
export const FRAME_run06 = 59;
export const FRAME_run07 = 60;
export const FRAME_run08 = 61;
export const FRAME_stand101 = 62;
export const FRAME_stand102 = 63;
export const FRAME_stand103 = 64;
export const FRAME_stand104 = 65;
export const FRAME_stand105 = 66;
export const FRAME_stand106 = 67;
export const FRAME_stand107 = 68;
export const FRAME_stand108 = 69;
export const FRAME_stand109 = 70;
export const FRAME_stand110 = 71;
export const FRAME_stand111 = 72;
export const FRAME_stand112 = 73;
export const FRAME_stand113 = 74;
export const FRAME_stand114 = 75;
export const FRAME_stand115 = 76;
export const FRAME_stand116 = 77;
export const FRAME_stand117 = 78;
export const FRAME_stand118 = 79;
export const FRAME_stand119 = 80;
export const FRAME_stand120 = 81;
export const FRAME_stand121 = 82;
export const FRAME_stand122 = 83;
export const FRAME_stand123 = 84;
export const FRAME_stand124 = 85;
export const FRAME_stand125 = 86;
export const FRAME_stand126 = 87;
export const FRAME_stand127 = 88;
export const FRAME_stand128 = 89;
export const FRAME_stand129 = 90;
export const FRAME_stand130 = 91;
export const FRAME_stand131 = 92;
export const FRAME_stand132 = 93;
export const FRAME_stand133 = 94;
export const FRAME_stand134 = 95;
export const FRAME_stand135 = 96;
export const FRAME_stand136 = 97;
export const FRAME_stand137 = 98;
export const FRAME_stand138 = 99;
export const FRAME_stand139 = 100;
export const FRAME_stand140 = 101;
export const FRAME_stand141 = 102;
export const FRAME_stand142 = 103;
export const FRAME_stand143 = 104;
export const FRAME_stand144 = 105;
export const FRAME_stand145 = 106;
export const FRAME_stand146 = 107;
export const FRAME_stand147 = 108;
export const FRAME_stand148 = 109;
export const FRAME_stand149 = 110;
export const FRAME_stand150 = 111;
export const FRAME_stand151 = 112;
export const FRAME_stand152 = 113;
export const FRAME_stand153 = 114;
export const FRAME_stand154 = 115;
export const FRAME_stand155 = 116;
export const FRAME_stand156 = 117;
export const FRAME_stand157 = 118;
export const FRAME_stand158 = 119;
export const FRAME_stand159 = 120;
export const FRAME_stand160 = 121;
export const FRAME_stand161 = 122;
export const FRAME_stand162 = 123;
export const FRAME_stand163 = 124;
export const FRAME_stand164 = 125;
export const FRAME_walk01 = 126;
export const FRAME_walk02 = 127;
export const FRAME_walk03 = 128;
export const FRAME_walk04 = 129;
export const FRAME_walk05 = 130;
export const FRAME_walk06 = 131;
export const FRAME_walk07 = 132;
export const FRAME_walk08 = 133;
export const FRAME_walk09 = 134;
export const FRAME_walk10 = 135;
export const FRAME_walk11 = 136;
export const FRAME_walk12 = 137;
export const FRAME_walk13 = 138;
export const FRAME_walk14 = 139;
export const FRAME_walk15 = 140;
export const FRAME_walk16 = 141;
export const FRAME_walk17 = 142;
export const FRAME_walk18 = 143;
export const FRAME_walk19 = 144;
export const FRAME_walk20 = 145;
export const FRAME_walk21 = 146;
export const FRAME_walk22 = 147;
export const FRAME_walk23 = 148;

export const MODEL_SCALE = 1.0;

/**
 * Symbols: SOUND_SWING, SOUND_HIT, SOUND_HIT2, SOUND_DEATH, SOUND_IDLE, SOUND_PAIN1, SOUND_PAIN2, SOUND_SIGHT, SOUND_SEARCH, SOUND_STEP1, SOUND_STEP2, SOUND_STEP3, SOUND_THUD
 * Original name: sound_swing, sound_hit, sound_hit2, sound_death, sound_idle, sound_pain1, sound_pain2, sound_sight, sound_search, sound_step1, sound_step2, sound_step3, sound_thud
 * Source: Quake-2-master/game/m_mutant.c
 * Source declaree: Quake-2-master/game/m_mutant.c
 * Category: Ported
 * Fidelity level: Strict
 * Purpose: Name the source mutant sound globals as asset paths before runtime precache assigns sound IDs.
 */
const SOUND_SWING = "mutant/mutatck1.wav";
const SOUND_HIT = "mutant/mutatck2.wav";
const SOUND_HIT2 = "mutant/mutatck3.wav";
const SOUND_DEATH = "mutant/mutdeth1.wav";
const SOUND_IDLE = "mutant/mutidle1.wav";
const SOUND_PAIN1 = "mutant/mutpain1.wav";
const SOUND_PAIN2 = "mutant/mutpain2.wav";
const SOUND_SIGHT = "mutant/mutsght1.wav";
const SOUND_SEARCH = "mutant/mutsrch1.wav";
const SOUND_STEP1 = "mutant/step1.wav";
const SOUND_STEP2 = "mutant/step2.wav";
const SOUND_STEP3 = "mutant/step3.wav";
const SOUND_THUD = "mutant/thud1.wav";

/**
 * Symbols: sound_swing, sound_hit, sound_hit2, sound_death, sound_idle, sound_pain1, sound_pain2, sound_sight, sound_search, sound_step1, sound_step2, sound_step3, sound_thud
 * Original name: N/A
 * Source: N/A (runtime sound cache handles)
 * Source declaree: N/A (runtime sound cache handles)
 * Category: New
 * Purpose: Store registered sound IDs for the runtime sound adapter.
 */
let sound_swing = 0;
let sound_hit = 0;
let sound_hit2 = 0;
let sound_death = 0;
let sound_idle = 0;
let sound_pain1 = 0;
let sound_pain2 = 0;
let sound_sight = 0;
let sound_search = 0;
let sound_step1 = 0;
let sound_step2 = 0;
let sound_step3 = 0;
let sound_thud = 0;

/**
 * Original name: mutant_step
 * Source: game/m_mutant.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits one of the three original mutant footstep sounds on the voice channel.
 *
 * Porting notes:
 * - Uses `randomInt(3)` for the C `(rand() + 1) % 3` integer branch; the sound set and channel are preserved.
 */
export function mutant_step(self: GameEntity, runtime: GameRuntime): void {
  const n = randomInt(3);
  if (n === 0) {
    emitRegisteredGameSound(runtime, self, sound_step1, SOUND_STEP1, soundOptions(CHAN_VOICE));
  } else if (n === 1) {
    emitRegisteredGameSound(runtime, self, sound_step2, SOUND_STEP2, soundOptions(CHAN_VOICE));
  } else {
    emitRegisteredGameSound(runtime, self, sound_step3, SOUND_STEP3, soundOptions(CHAN_VOICE));
  }
}

/**
 * Original name: mutant_sight
 * Source: game/m_mutant.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits the mutant sight sound on the voice channel.
 */
export function mutant_sight(self: GameEntity, _other: GameEntity | null, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_sight, SOUND_SIGHT, soundOptions(CHAN_VOICE));
}

/**
 * Original name: mutant_search
 * Source: game/m_mutant.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits the mutant search sound on the voice channel.
 */
export function mutant_search(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_search, SOUND_SEARCH, soundOptions(CHAN_VOICE));
}

/**
 * Original name: mutant_swing
 * Source: game/m_mutant.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits the mutant melee swing sound on the voice channel.
 */
export function mutant_swing(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_swing, SOUND_SWING, soundOptions(CHAN_VOICE));
}

const mutant_frames_stand = makeFrames(ai_stand, new Array<number>(51).fill(0));
export const mutant_move_stand: GameMonsterMove = {
  firstframe: FRAME_stand101,
  lastframe: FRAME_stand151,
  frame: mutant_frames_stand,
  endfunc: undefined
};

/**
 * Original name: mutant_stand
 * Source: game/m_mutant.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Switches the monster to the original stand move.
 */
export function mutant_stand(self: GameEntity): void {
  self.monsterinfo.currentmove = mutant_move_stand;
}

/**
 * Original name: mutant_idle_loop
 * Source: game/m_mutant.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Repeats the scratch idle loop with the original probability split.
 *
 * Porting notes:
 * - Uses `g_local.random()` for the C macro `random()`.
 */
export function mutant_idle_loop(self: GameEntity): void {
  if (random() < 0.75) {
    self.monsterinfo.nextframe = FRAME_stand155;
  }
}

const mutant_frames_idle = makeFrames(ai_stand, new Array<number>(13).fill(0), indexedThinks(13, [[6, mutant_idle_loop]]));
export const mutant_move_idle: GameMonsterMove = {
  firstframe: FRAME_stand152,
  lastframe: FRAME_stand164,
  frame: mutant_frames_idle,
  endfunc: mutant_stand
};

/**
 * Original name: mutant_idle
 * Source: game/m_mutant.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Switches the monster to the scratch idle move and emits the original idle sound with idle attenuation.
 */
export function mutant_idle(self: GameEntity, runtime: GameRuntime): void {
  self.monsterinfo.currentmove = mutant_move_idle;
  emitRegisteredGameSound(runtime, self, sound_idle, SOUND_IDLE, {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_IDLE,
    timeofs: 0
  });
}

const mutant_frames_walk = makeFrames(ai_walk, [3, 1, 5, 10, 13, 10, 0, 5, 6, 16, 15, 6]);
export const mutant_move_walk: GameMonsterMove = {
  firstframe: FRAME_walk05,
  lastframe: FRAME_walk16,
  frame: mutant_frames_walk,
  endfunc: undefined
};

/**
 * Original name: mutant_walk_loop
 * Source: game/m_mutant.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Switches from the walk startup move to the repeating walk move.
 */
export function mutant_walk_loop(self: GameEntity): void {
  self.monsterinfo.currentmove = mutant_move_walk;
}

const mutant_frames_start_walk = makeFrames(ai_walk, [5, 5, -2, 1]);
export const mutant_move_start_walk: GameMonsterMove = {
  firstframe: FRAME_walk01,
  lastframe: FRAME_walk04,
  frame: mutant_frames_start_walk,
  endfunc: mutant_walk_loop
};

/**
 * Original name: mutant_walk
 * Source: game/m_mutant.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Starts the original four-frame walk startup move.
 */
export function mutant_walk(self: GameEntity): void {
  self.monsterinfo.currentmove = mutant_move_start_walk;
}

const mutant_frames_run = makeFrames(ai_run, [40, 40, 24, 5, 17, 10], indexedThinks(6, [
  [1, mutant_step],
  [3, mutant_step]
]));
export const mutant_move_run: GameMonsterMove = {
  firstframe: FRAME_run03,
  lastframe: FRAME_run08,
  frame: mutant_frames_run,
  endfunc: undefined
};

/**
 * Original name: mutant_run
 * Source: game/m_mutant.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Uses stand-ground AI to stay on the stand move, otherwise switches to the original run move.
 */
export function mutant_run(self: GameEntity): void {
  if ((self.monsterinfo.aiflags & AI_STAND_GROUND) !== 0) {
    self.monsterinfo.currentmove = mutant_move_stand;
  } else {
    self.monsterinfo.currentmove = mutant_move_run;
  }
}

/**
 * Original name: mutant_hit_left
 * Source: game/m_mutant.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Performs the left melee trace with the original aim vector, damage range and hit/swing sounds.
 *
 * Porting notes:
 * - Uses `randomInt(5)` for the C `rand() % 5` integer damage branch.
 */
export function mutant_hit_left(self: GameEntity, runtime: GameRuntime): void {
  const aim: vec3_t = [MELEE_DISTANCE, self.mins[0], 8];
  if (fire_hit(self, aim, 10 + randomInt(5), 100, runtime)) {
    emitRegisteredGameSound(runtime, self, sound_hit, SOUND_HIT, soundOptions(CHAN_WEAPON));
  } else {
    emitRegisteredGameSound(runtime, self, sound_swing, SOUND_SWING, soundOptions(CHAN_WEAPON));
  }
}

/**
 * Original name: mutant_hit_right
 * Source: game/m_mutant.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Performs the right melee trace with the original aim vector, damage range and hit/swing sounds.
 *
 * Porting notes:
 * - Uses `randomInt(5)` for the C `rand() % 5` integer damage branch.
 */
export function mutant_hit_right(self: GameEntity, runtime: GameRuntime): void {
  const aim: vec3_t = [MELEE_DISTANCE, self.maxs[0], 8];
  if (fire_hit(self, aim, 10 + randomInt(5), 100, runtime)) {
    emitRegisteredGameSound(runtime, self, sound_hit2, SOUND_HIT2, soundOptions(CHAN_WEAPON));
  } else {
    emitRegisteredGameSound(runtime, self, sound_swing, SOUND_SWING, soundOptions(CHAN_WEAPON));
  }
}

/**
 * Original name: mutant_check_refire
 * Source: game/m_mutant.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Repeats melee attacks while valid, always in melee range and probabilistically on nightmare skill.
 *
 * Porting notes:
 * - Uses `g_local.random()` for the C macro `random()`.
 */
export function mutant_check_refire(self: GameEntity, runtime: GameRuntime): void {
  if (!self.enemy || !self.enemy.inuse || self.enemy.health <= 0) {
    return;
  }

  if ((runtime.skill === 3 && random() < 0.5) || range(self, self.enemy) === RANGE_MELEE) {
    self.monsterinfo.nextframe = FRAME_attack09;
  }
}

const mutant_frames_attack = makeFrames(ai_charge, [0, 0, 0, 0, 0, 0, 0], indexedThinks(7, [
  [2, mutant_hit_left],
  [5, mutant_hit_right],
  [6, mutant_check_refire]
]));
export const mutant_move_attack: GameMonsterMove = {
  firstframe: FRAME_attack09,
  lastframe: FRAME_attack15,
  frame: mutant_frames_attack,
  endfunc: mutant_run
};

/**
 * Original name: mutant_melee
 * Source: game/m_mutant.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Switches the monster to the original melee attack move.
 */
export function mutant_melee(self: GameEntity): void {
  self.monsterinfo.currentmove = mutant_move_attack;
}

/**
 * Original name: mutant_jump_touch
 * Source: game/m_mutant.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Applies the mutant jump impact damage and clears the touch callback once the landing branch completes.
 *
 * Porting notes:
 * - Uses `g_local.random()` for the C macro `random()` in the jump damage expression.
 */
export function mutant_jump_touch(self: GameEntity, other: GameEntity, runtime: GameRuntime): void {
  if (self.health <= 0) {
    self.touch = undefined;
    return;
  }

  if (other.takedamage !== 0 && vec3Length(self.velocity) > 400) {
    const normal = normalizeVec3(self.velocity);
    const point = addVec3(self.s.origin, scaleVec3(normal, self.maxs[0]));
    const damage = Math.trunc(40 + 10 * random());
    T_Damage(other, self, self, self.velocity, point, normal, damage, damage, 0, MOD_UNKNOWN, runtime);
  }

  if (!M_CheckBottom(self, runtime)) {
    if (self.groundentity) {
      self.monsterinfo.nextframe = FRAME_attack02;
      self.touch = undefined;
    }
    return;
  }

  self.touch = undefined;
}

/**
 * Original name: mutant_jump_takeoff
 * Source: game/m_mutant.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits the sight sound, launches the mutant forward/upward, starts the ducked airborne state and arms touch damage.
 */
export function mutant_jump_takeoff(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_sight, SOUND_SIGHT, soundOptions(CHAN_VOICE));
  const { forward } = AngleVectors(self.s.angles);
  self.s.origin[2] += 1;
  self.origin[2] = self.s.origin[2];
  self.velocity = scaleVec3(forward, 600) as [number, number, number];
  self.velocity[2] = 250;
  self.groundentity = null;
  self.monsterinfo.aiflags |= AI_DUCKED;
  self.monsterinfo.attack_finished = runtime.time + 3;
  self.touch = mutant_jump_touch;
}

/**
 * Original name: mutant_check_landing
 * Source: game/m_mutant.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Clears the airborne duck state on landing, or loops the jump frames while still airborne.
 */
export function mutant_check_landing(self: GameEntity, runtime: GameRuntime): void {
  if (self.groundentity) {
    emitRegisteredGameSound(runtime, self, sound_thud, SOUND_THUD, soundOptions(CHAN_WEAPON));
    self.monsterinfo.attack_finished = 0;
    self.monsterinfo.aiflags &= ~AI_DUCKED;
    return;
  }

  if (runtime.time > self.monsterinfo.attack_finished) {
    self.monsterinfo.nextframe = FRAME_attack02;
  } else {
    self.monsterinfo.nextframe = FRAME_attack05;
  }
}

const mutant_frames_jump = makeFrames(ai_charge, [0, 17, 15, 15, 15, 0, 3, 0], indexedThinks(8, [
  [2, mutant_jump_takeoff],
  [4, mutant_check_landing]
]));
export const mutant_move_jump: GameMonsterMove = {
  firstframe: FRAME_attack01,
  lastframe: FRAME_attack08,
  frame: mutant_frames_jump,
  endfunc: mutant_run
};

/**
 * Original name: mutant_jump
 * Source: game/m_mutant.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Switches the monster to the original jump attack move.
 */
export function mutant_jump(self: GameEntity): void {
  self.monsterinfo.currentmove = mutant_move_jump;
}

/**
 * Original name: mutant_check_melee
 * Source: game/m_mutant.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Allows melee attacks only when the enemy is in the original melee range.
 */
export function mutant_check_melee(self: GameEntity): boolean {
  return !!self.enemy && range(self, self.enemy) === RANGE_MELEE;
}

/**
 * Original name: mutant_check_jump
 * Source: game/m_mutant.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Checks vertical overlap, distance and the original random rejection chance for jump attacks.
 *
 * Porting notes:
 * - Uses `g_local.random()` for the C macro `random()`.
 */
export function mutant_check_jump(self: GameEntity): boolean {
  if (!self.enemy) {
    return false;
  }

  if (self.absmin[2] > self.enemy.absmin[2] + 0.75 * self.enemy.size[2]) {
    return false;
  }

  if (self.absmax[2] < self.enemy.absmin[2] + 0.25 * self.enemy.size[2]) {
    return false;
  }

  const v: vec3_t = [
    self.s.origin[0] - self.enemy.s.origin[0],
    self.s.origin[1] - self.enemy.s.origin[1],
    0
  ];
  const distance = vec3Length(v);

  if (distance < 100) {
    return false;
  }
  if (distance > 100 && random() < 0.9) {
    return false;
  }

  return true;
}

/**
 * Original name: mutant_checkattack
 * Source: game/m_mutant.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Selects melee or missile attack state through the original mutant melee and jump checks.
 */
export function mutant_checkattack(self: GameEntity): boolean {
  if (!self.enemy || self.enemy.health <= 0) {
    return false;
  }

  if (mutant_check_melee(self)) {
    self.monsterinfo.attack_state = AS_MELEE;
    return true;
  }

  if (mutant_check_jump(self)) {
    self.monsterinfo.attack_state = AS_MISSILE;
    return true;
  }

  return false;
}

const mutant_frames_pain1 = makeFrames(ai_move, [4, -3, -8, 2, 5]);
export const mutant_move_pain1: GameMonsterMove = {
  firstframe: FRAME_pain101,
  lastframe: FRAME_pain105,
  frame: mutant_frames_pain1,
  endfunc: mutant_run
};

const mutant_frames_pain2 = makeFrames(ai_move, [-24, 11, 5, -2, 6, 4]);
export const mutant_move_pain2: GameMonsterMove = {
  firstframe: FRAME_pain201,
  lastframe: FRAME_pain206,
  frame: mutant_frames_pain2,
  endfunc: mutant_run
};

const mutant_frames_pain3 = makeFrames(ai_move, [-22, 3, 3, 2, 1, 1, 6, 3, 2, 0, 1]);
export const mutant_move_pain3: GameMonsterMove = {
  firstframe: FRAME_pain301,
  lastframe: FRAME_pain311,
  frame: mutant_frames_pain3,
  endfunc: mutant_run
};

/**
 * Original name: mutant_pain
 * Source: game/m_mutant.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Applies pain skin/debounce, emits the original pain sound branch and chooses one of three pain moves.
 *
 * Porting notes:
 * - Uses `g_local.random()` for the C macro `random()`.
 */
export function mutant_pain(
  self: GameEntity,
  _other: GameEntity | null,
  _kick: number,
  _damage: number,
  runtime: GameRuntime
): void {
  if (self.health < self.max_health / 2) {
    self.s.skinnum = 1;
  }

  if (runtime.time < self.pain_debounce_time) {
    return;
  }

  self.pain_debounce_time = runtime.time + 3;

  if (runtime.skill === 3) {
    return;
  }

  const r = random();
  if (r < 0.33) {
    emitRegisteredGameSound(runtime, self, sound_pain1, SOUND_PAIN1, soundOptions(CHAN_VOICE));
    self.monsterinfo.currentmove = mutant_move_pain1;
  } else if (r < 0.66) {
    emitRegisteredGameSound(runtime, self, sound_pain2, SOUND_PAIN2, soundOptions(CHAN_VOICE));
    self.monsterinfo.currentmove = mutant_move_pain2;
  } else {
    emitRegisteredGameSound(runtime, self, sound_pain1, SOUND_PAIN1, soundOptions(CHAN_VOICE));
    self.monsterinfo.currentmove = mutant_move_pain3;
  }
}

/**
 * Original name: mutant_dead
 * Source: game/m_mutant.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Shrinks the corpse bounds, switches to toss physics, links the dead monster, and runs fly cleanup.
 */
export function mutant_dead(self: GameEntity, runtime: GameRuntime): void {
  setVec3(self.mins, -16, -16, -24);
  setVec3(self.maxs, 16, 16, -8);
  self.movetype = MOVETYPE_TOSS;
  self.svflags |= SVF_DEADMONSTER;
  linkGameEntity(runtime, self);
  M_FlyCheck(self, runtime);
}

const mutant_frames_death1 = makeFrames(ai_move, new Array<number>(9).fill(0));
export const mutant_move_death1: GameMonsterMove = {
  firstframe: FRAME_death101,
  lastframe: FRAME_death109,
  frame: mutant_frames_death1,
  endfunc: mutant_dead
};

const mutant_frames_death2 = makeFrames(ai_move, new Array<number>(10).fill(0));
export const mutant_move_death2: GameMonsterMove = {
  firstframe: FRAME_death201,
  lastframe: FRAME_death210,
  frame: mutant_frames_death2,
  endfunc: mutant_dead
};

/**
 * Original name: mutant_die
 * Source: game/m_mutant.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Handles gib death or selects one of the two corpse animation moves.
 *
 * Porting notes:
 * - Uses `g_local.random()` for the C macro `random()` in the non-gib death branch.
 */
export function mutant_die(
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

  emitRegisteredGameSound(runtime, self, sound_death, SOUND_DEATH, soundOptions(CHAN_VOICE));
  self.deadflag = DEAD_DEAD;
  self.takedamage = damage_t.DAMAGE_YES;
  self.s.skinnum = 1;
  self.monsterinfo.currentmove = random() < 0.5 ? mutant_move_death1 : mutant_move_death2;
}

/**
 * Original name: SP_monster_mutant
 * Source: game/m_mutant.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Precaches mutant assets, initializes monster bounds/stats/callbacks, and starts walkmonster setup.
 *
 * Porting notes:
 * - Uses `runtime.deathmatch` and runtime asset registries in place of C globals and `gi.*` imports.
 */
export function SP_monster_mutant(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  precacheMutantAssets(runtime);

  self.movetype = MOVETYPE_STEP;
  self.solid = SOLID_BBOX;
  self.s.modelindex = registerGameModel(runtime, "models/monsters/mutant/tris.md2");
  setVec3(self.mins, -32, -32, -24);
  setVec3(self.maxs, 32, 32, 48);

  self.health = 300;
  self.gib_health = -120;
  self.mass = 300;

  self.pain = mutant_pain;
  self.die = mutant_die;

  self.monsterinfo.stand = mutant_stand;
  self.monsterinfo.walk = mutant_walk;
  self.monsterinfo.run = mutant_run;
  self.monsterinfo.dodge = undefined;
  self.monsterinfo.attack = mutant_jump;
  self.monsterinfo.melee = mutant_melee;
  self.monsterinfo.sight = mutant_sight;
  self.monsterinfo.search = mutant_search;
  self.monsterinfo.idle = mutant_idle;
  self.monsterinfo.checkattack = mutant_checkattack;

  linkGameEntity(runtime, self);
  self.monsterinfo.currentmove = mutant_move_stand;
  self.monsterinfo.scale = MODEL_SCALE;

  walkmonster_start(self, runtime);
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
 * Symbols: precacheMutantAssets
 * Original name: N/A
 * Source: N/A (local precache helper)
 * Source declaree: N/A (local precache helper)
 * Category: New
 * Purpose: Centralize mutant sound registration while preserving source precache order.
 */
function precacheMutantAssets(runtime: GameRuntime): void {
  sound_swing = registerGameSound(runtime, SOUND_SWING);
  sound_hit = registerGameSound(runtime, SOUND_HIT);
  sound_hit2 = registerGameSound(runtime, SOUND_HIT2);
  sound_death = registerGameSound(runtime, SOUND_DEATH);
  sound_idle = registerGameSound(runtime, SOUND_IDLE);
  sound_pain1 = registerGameSound(runtime, SOUND_PAIN1);
  sound_pain2 = registerGameSound(runtime, SOUND_PAIN2);
  sound_sight = registerGameSound(runtime, SOUND_SIGHT);
  sound_search = registerGameSound(runtime, SOUND_SEARCH);
  sound_step1 = registerGameSound(runtime, SOUND_STEP1);
  sound_step2 = registerGameSound(runtime, SOUND_STEP2);
  sound_step3 = registerGameSound(runtime, SOUND_STEP3);
  sound_thud = registerGameSound(runtime, SOUND_THUD);
}

/**
 * Symbols: soundOptions
 * Original name: N/A
 * Source: N/A (local sound helper)
 * Source declaree: N/A (local sound helper)
 * Category: New
 * Purpose: Build the repeated Quake sound option payload used by mutant callbacks.
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
 * Symbols: setVec3
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Mutate runtime vectors in place for spawn bounds and corpse bounds setup.
 */
function setVec3(vector: [number, number, number], x: number, y: number, z: number): void {
  vector[0] = x;
  vector[1] = y;
  vector[2] = z;
}

/**
 * Symbols: addVec3
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Build the mutant jump impact point from origin and scaled direction vectors.
 */
function addVec3(left: vec3_t, right: vec3_t): vec3_t {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

/**
 * Symbols: scaleVec3
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Scale jump directions and impact normals for local mutant movement math.
 */
function scaleVec3(vector: vec3_t, scale: number): vec3_t {
  return [vector[0] * scale, vector[1] * scale, vector[2] * scale];
}

/**
 * Symbols: normalizeVec3
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Normalize mutant jump velocity before applying impact damage.
 */
function normalizeVec3(vector: vec3_t): vec3_t {
  const length = vec3Length(vector);
  if (length === 0) {
    return [0, 0, 0];
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

/**
 * Symbols: vec3Length
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Measure mutant jump velocity and horizontal jump-check distance.
 */
function vec3Length(vector: vec3_t): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

/**
 * Symbols: randomInt
 * Original name: N/A
 * Source: N/A (local random helper)
 * Source declaree: N/A (local random helper)
 * Category: New
 * Purpose: Preserve the integer rand-style branches used by mutant sound and melee behavior.
 */
function randomInt(maxExclusive: number): number {
  return Math.trunc(Math.random() * maxExclusive);
}
