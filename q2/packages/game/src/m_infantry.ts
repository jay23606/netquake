/**
 * File: m_infantry.ts
 * Source: Quake II original / game/m_infantry.h and game/m_infantry.c
 * Purpose: Port of the generated infantry model frame constants and monster_infantry gameplay behavior.
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
 * - This file keeps the header constants and C behavior together as the principal attachment point for `m_infantry`.
 */

import { AngleVectors, ATTN_IDLE, ATTN_NORM, CHAN_BODY, CHAN_VOICE, CHAN_WEAPON, type vec3_t } from "../../qcommon/src/index.js";
import {
  AI_DUCKED,
  AI_HOLD_FRAME,
  AI_STAND_GROUND,
  DEAD_DEAD,
  DEFAULT_BULLET_HSPREAD,
  DEFAULT_BULLET_VSPREAD,
  FRAMETIME,
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
import { ai_charge, ai_move, ai_run, ai_stand, ai_walk, range } from "./g_ai.js";
import { M_FlyCheck, monster_fire_bullet, walkmonster_start } from "./g_monster.js";
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

export const FRAME_gun02 = 0;
export const FRAME_stand01 = 1;
export const FRAME_stand02 = 2;
export const FRAME_stand03 = 3;
export const FRAME_stand04 = 4;
export const FRAME_stand05 = 5;
export const FRAME_stand06 = 6;
export const FRAME_stand07 = 7;
export const FRAME_stand08 = 8;
export const FRAME_stand09 = 9;
export const FRAME_stand10 = 10;
export const FRAME_stand11 = 11;
export const FRAME_stand12 = 12;
export const FRAME_stand13 = 13;
export const FRAME_stand14 = 14;
export const FRAME_stand15 = 15;
export const FRAME_stand16 = 16;
export const FRAME_stand17 = 17;
export const FRAME_stand18 = 18;
export const FRAME_stand19 = 19;
export const FRAME_stand20 = 20;
export const FRAME_stand21 = 21;
export const FRAME_stand22 = 22;
export const FRAME_stand23 = 23;
export const FRAME_stand24 = 24;
export const FRAME_stand25 = 25;
export const FRAME_stand26 = 26;
export const FRAME_stand27 = 27;
export const FRAME_stand28 = 28;
export const FRAME_stand29 = 29;
export const FRAME_stand30 = 30;
export const FRAME_stand31 = 31;
export const FRAME_stand32 = 32;
export const FRAME_stand33 = 33;
export const FRAME_stand34 = 34;
export const FRAME_stand35 = 35;
export const FRAME_stand36 = 36;
export const FRAME_stand37 = 37;
export const FRAME_stand38 = 38;
export const FRAME_stand39 = 39;
export const FRAME_stand40 = 40;
export const FRAME_stand41 = 41;
export const FRAME_stand42 = 42;
export const FRAME_stand43 = 43;
export const FRAME_stand44 = 44;
export const FRAME_stand45 = 45;
export const FRAME_stand46 = 46;
export const FRAME_stand47 = 47;
export const FRAME_stand48 = 48;
export const FRAME_stand49 = 49;
export const FRAME_stand50 = 50;
export const FRAME_stand51 = 51;
export const FRAME_stand52 = 52;
export const FRAME_stand53 = 53;
export const FRAME_stand54 = 54;
export const FRAME_stand55 = 55;
export const FRAME_stand56 = 56;
export const FRAME_stand57 = 57;
export const FRAME_stand58 = 58;
export const FRAME_stand59 = 59;
export const FRAME_stand60 = 60;
export const FRAME_stand61 = 61;
export const FRAME_stand62 = 62;
export const FRAME_stand63 = 63;
export const FRAME_stand64 = 64;
export const FRAME_stand65 = 65;
export const FRAME_stand66 = 66;
export const FRAME_stand67 = 67;
export const FRAME_stand68 = 68;
export const FRAME_stand69 = 69;
export const FRAME_stand70 = 70;
export const FRAME_stand71 = 71;
export const FRAME_walk01 = 72;
export const FRAME_walk02 = 73;
export const FRAME_walk03 = 74;
export const FRAME_walk04 = 75;
export const FRAME_walk05 = 76;
export const FRAME_walk06 = 77;
export const FRAME_walk07 = 78;
export const FRAME_walk08 = 79;
export const FRAME_walk09 = 80;
export const FRAME_walk10 = 81;
export const FRAME_walk11 = 82;
export const FRAME_walk12 = 83;
export const FRAME_walk13 = 84;
export const FRAME_walk14 = 85;
export const FRAME_walk15 = 86;
export const FRAME_walk16 = 87;
export const FRAME_walk17 = 88;
export const FRAME_walk18 = 89;
export const FRAME_walk19 = 90;
export const FRAME_walk20 = 91;
export const FRAME_run01 = 92;
export const FRAME_run02 = 93;
export const FRAME_run03 = 94;
export const FRAME_run04 = 95;
export const FRAME_run05 = 96;
export const FRAME_run06 = 97;
export const FRAME_run07 = 98;
export const FRAME_run08 = 99;
export const FRAME_pain101 = 100;
export const FRAME_pain102 = 101;
export const FRAME_pain103 = 102;
export const FRAME_pain104 = 103;
export const FRAME_pain105 = 104;
export const FRAME_pain106 = 105;
export const FRAME_pain107 = 106;
export const FRAME_pain108 = 107;
export const FRAME_pain109 = 108;
export const FRAME_pain110 = 109;
export const FRAME_pain201 = 110;
export const FRAME_pain202 = 111;
export const FRAME_pain203 = 112;
export const FRAME_pain204 = 113;
export const FRAME_pain205 = 114;
export const FRAME_pain206 = 115;
export const FRAME_pain207 = 116;
export const FRAME_pain208 = 117;
export const FRAME_pain209 = 118;
export const FRAME_pain210 = 119;
export const FRAME_duck01 = 120;
export const FRAME_duck02 = 121;
export const FRAME_duck03 = 122;
export const FRAME_duck04 = 123;
export const FRAME_duck05 = 124;
export const FRAME_death101 = 125;
export const FRAME_death102 = 126;
export const FRAME_death103 = 127;
export const FRAME_death104 = 128;
export const FRAME_death105 = 129;
export const FRAME_death106 = 130;
export const FRAME_death107 = 131;
export const FRAME_death108 = 132;
export const FRAME_death109 = 133;
export const FRAME_death110 = 134;
export const FRAME_death111 = 135;
export const FRAME_death112 = 136;
export const FRAME_death113 = 137;
export const FRAME_death114 = 138;
export const FRAME_death115 = 139;
export const FRAME_death116 = 140;
export const FRAME_death117 = 141;
export const FRAME_death118 = 142;
export const FRAME_death119 = 143;
export const FRAME_death120 = 144;
export const FRAME_death201 = 145;
export const FRAME_death202 = 146;
export const FRAME_death203 = 147;
export const FRAME_death204 = 148;
export const FRAME_death205 = 149;
export const FRAME_death206 = 150;
export const FRAME_death207 = 151;
export const FRAME_death208 = 152;
export const FRAME_death209 = 153;
export const FRAME_death210 = 154;
export const FRAME_death211 = 155;
export const FRAME_death212 = 156;
export const FRAME_death213 = 157;
export const FRAME_death214 = 158;
export const FRAME_death215 = 159;
export const FRAME_death216 = 160;
export const FRAME_death217 = 161;
export const FRAME_death218 = 162;
export const FRAME_death219 = 163;
export const FRAME_death220 = 164;
export const FRAME_death221 = 165;
export const FRAME_death222 = 166;
export const FRAME_death223 = 167;
export const FRAME_death224 = 168;
export const FRAME_death225 = 169;
export const FRAME_death301 = 170;
export const FRAME_death302 = 171;
export const FRAME_death303 = 172;
export const FRAME_death304 = 173;
export const FRAME_death305 = 174;
export const FRAME_death306 = 175;
export const FRAME_death307 = 176;
export const FRAME_death308 = 177;
export const FRAME_death309 = 178;
export const FRAME_block01 = 179;
export const FRAME_block02 = 180;
export const FRAME_block03 = 181;
export const FRAME_block04 = 182;
export const FRAME_block05 = 183;
export const FRAME_attak101 = 184;
export const FRAME_attak102 = 185;
export const FRAME_attak103 = 186;
export const FRAME_attak104 = 187;
export const FRAME_attak105 = 188;
export const FRAME_attak106 = 189;
export const FRAME_attak107 = 190;
export const FRAME_attak108 = 191;
export const FRAME_attak109 = 192;
export const FRAME_attak110 = 193;
export const FRAME_attak111 = 194;
export const FRAME_attak112 = 195;
export const FRAME_attak113 = 196;
export const FRAME_attak114 = 197;
export const FRAME_attak115 = 198;
export const FRAME_attak201 = 199;
export const FRAME_attak202 = 200;
export const FRAME_attak203 = 201;
export const FRAME_attak204 = 202;
export const FRAME_attak205 = 203;
export const FRAME_attak206 = 204;
export const FRAME_attak207 = 205;
export const FRAME_attak208 = 206;

export const MODEL_SCALE = 1.0;

export const MZ2_INFANTRY_MACHINEGUN_1 = 26;
export const MZ2_INFANTRY_MACHINEGUN_2 = 27;
export const MZ2_INFANTRY_MACHINEGUN_3 = 28;
export const MZ2_INFANTRY_MACHINEGUN_4 = 29;
export const MZ2_INFANTRY_MACHINEGUN_5 = 30;
export const MZ2_INFANTRY_MACHINEGUN_6 = 31;
export const MZ2_INFANTRY_MACHINEGUN_7 = 32;
export const MZ2_INFANTRY_MACHINEGUN_8 = 33;
export const MZ2_INFANTRY_MACHINEGUN_9 = 34;
export const MZ2_INFANTRY_MACHINEGUN_10 = 35;
export const MZ2_INFANTRY_MACHINEGUN_11 = 36;
export const MZ2_INFANTRY_MACHINEGUN_12 = 37;
export const MZ2_INFANTRY_MACHINEGUN_13 = 38;

const aimangles: readonly vec3_t[] = [
  [0.0, 5.0, 0.0],
  [10.0, 15.0, 0.0],
  [20.0, 25.0, 0.0],
  [25.0, 35.0, 0.0],
  [30.0, 40.0, 0.0],
  [30.0, 45.0, 0.0],
  [25.0, 50.0, 0.0],
  [20.0, 40.0, 0.0],
  [15.0, 35.0, 0.0],
  [40.0, 35.0, 0.0],
  [70.0, 35.0, 0.0],
  [90.0, 35.0, 0.0]
];

const SOUND_PAIN1 = "infantry/infpain1.wav";
const SOUND_PAIN2 = "infantry/infpain2.wav";
const SOUND_DIE1 = "infantry/infdeth1.wav";
const SOUND_DIE2 = "infantry/infdeth2.wav";
const SOUND_GUNSHOT = "infantry/infatck1.wav";
const SOUND_WEAPON_COCK = "infantry/infatck3.wav";
const SOUND_PUNCH_SWING = "infantry/infatck2.wav";
const SOUND_PUNCH_HIT = "infantry/melee2.wav";
const SOUND_SIGHT = "infantry/infsght1.wav";
const SOUND_SEARCH = "infantry/infsrch1.wav";
const SOUND_IDLE = "infantry/infidle1.wav";

/**
 * Original name: N/A
 * Source: N/A (runtime sound handle cache)
 * Category: New
 * Purpose: Stores runtime sound indexes produced from the ported infantry sound paths.
 */
let sound_pain1 = 0;
let sound_pain2 = 0;
let sound_die1 = 0;
let sound_die2 = 0;
let sound_gunshot = 0;
let sound_weapon_cock = 0;
let sound_punch_swing = 0;
let sound_punch_hit = 0;
let sound_sight = 0;
let sound_search = 0;
let sound_idle = 0;

const infantry_frames_stand = makeFrames(ai_stand, new Array<number>(22).fill(0));
export const infantry_move_stand: GameMonsterMove = {
  firstframe: FRAME_stand50,
  lastframe: FRAME_stand71,
  frame: infantry_frames_stand,
  endfunc: undefined
};

/**
 * Original name: infantry_stand
 * Source: game/m_infantry.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Selects `infantry_move_stand` as the active monster move.
 * Porting notes: The C move pointer assignment is represented by the explicit `GameMonsterMove` object.
 */
export function infantry_stand(self: GameEntity): void {
  self.monsterinfo.currentmove = infantry_move_stand;
}

const infantry_frames_fidget = makeFrames(ai_stand, [
  1, 0, 1, 3, 6, 3, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 1, 0, -2, 1, 1,
  1, -1, 0, 0, -1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, -1, -1, 0, -3, -2, -3, -3, -2
]);
export const infantry_move_fidget: GameMonsterMove = {
  firstframe: FRAME_stand01,
  lastframe: FRAME_stand49,
  frame: infantry_frames_fidget,
  endfunc: infantry_stand
};

/**
 * Original name: infantry_fidget
 * Source: game/m_infantry.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Selects `infantry_move_fidget` and emits the idle voice sound.
 * Porting notes: `gi.sound` is routed through the gameplay runtime sound queue with the precached sound index.
 */
export function infantry_fidget(self: GameEntity, runtime: GameRuntime): void {
  self.monsterinfo.currentmove = infantry_move_fidget;
  emitRegisteredGameSound(runtime, self, sound_idle, SOUND_IDLE, {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_IDLE,
    timeofs: 0
  });
}

const infantry_frames_walk = makeFrames(ai_walk, [5, 4, 4, 5, 4, 5, 6, 4, 4, 4, 4, 5]);
export const infantry_move_walk: GameMonsterMove = {
  firstframe: FRAME_walk03,
  lastframe: FRAME_walk14,
  frame: infantry_frames_walk,
  endfunc: undefined
};

/**
 * Original name: infantry_walk
 * Source: game/m_infantry.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Selects `infantry_move_walk` as the active monster move.
 * Porting notes: The C move pointer assignment is represented by the explicit `GameMonsterMove` object.
 */
export function infantry_walk(self: GameEntity): void {
  self.monsterinfo.currentmove = infantry_move_walk;
}

const infantry_frames_run = makeFrames(ai_run, [10, 20, 5, 7, 30, 35, 2, 6]);
export const infantry_move_run: GameMonsterMove = {
  firstframe: FRAME_run01,
  lastframe: FRAME_run08,
  frame: infantry_frames_run,
  endfunc: undefined
};

/**
 * Original name: infantry_run
 * Source: game/m_infantry.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Keeps standing when `AI_STAND_GROUND` is set, otherwise selects `infantry_move_run`.
 * Porting notes: The original bit test is preserved against `monsterinfo.aiflags`.
 */
export function infantry_run(self: GameEntity): void {
  if ((self.monsterinfo.aiflags & AI_STAND_GROUND) !== 0) {
    self.monsterinfo.currentmove = infantry_move_stand;
  } else {
    self.monsterinfo.currentmove = infantry_move_run;
  }
}

const infantry_frames_pain1 = makeFrames(ai_move, [-3, -2, -1, -2, -1, 1, -1, 1, 6, 2]);
export const infantry_move_pain1: GameMonsterMove = {
  firstframe: FRAME_pain101,
  lastframe: FRAME_pain110,
  frame: infantry_frames_pain1,
  endfunc: infantry_run
};

const infantry_frames_pain2 = makeFrames(ai_move, [-3, -3, 0, -1, -2, 0, 0, 2, 5, 2]);
export const infantry_move_pain2: GameMonsterMove = {
  firstframe: FRAME_pain201,
  lastframe: FRAME_pain210,
  frame: infantry_frames_pain2,
  endfunc: infantry_run
};

/**
 * Original name: infantry_pain
 * Source: game/m_infantry.c
 * Category: Ported
 * Fidelity level: Close
 */
export function infantry_pain(
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

  if (randomInt(2) === 0) {
    self.monsterinfo.currentmove = infantry_move_pain1;
    emitRegisteredGameSound(runtime, self, sound_pain1, SOUND_PAIN1, soundOptions(CHAN_VOICE));
  } else {
    self.monsterinfo.currentmove = infantry_move_pain2;
    emitRegisteredGameSound(runtime, self, sound_pain2, SOUND_PAIN2, soundOptions(CHAN_VOICE));
  }
}

/**
 * Original name: InfantryMachineGun
 * Source: game/m_infantry.c
 * Category: Ported
 * Fidelity level: Close
 */
export function InfantryMachineGun(self: GameEntity, runtime: GameRuntime): void {
  let forward: vec3_t;
  let right: vec3_t;
  let start: vec3_t;
  let flash_number: number;

  if (self.s.frame === FRAME_attak111) {
    flash_number = MZ2_INFANTRY_MACHINEGUN_1;
    ({ forward, right } = AngleVectors(self.s.angles));
    start = G_ProjectSource(self.s.origin, infantryFlashOffset(flash_number), forward, right);

    if (self.enemy) {
      const target = addVec3(self.enemy.s.origin, scaleVec3(self.enemy.velocity, -0.2));
      target[2] += self.enemy.viewheight;
      forward = normalizeVec3(subtractVec3(target, start));
    } else {
      forward = AngleVectors(self.s.angles).forward;
    }
  } else {
    flash_number = MZ2_INFANTRY_MACHINEGUN_2 + (self.s.frame - FRAME_death211);
    ({ forward, right } = AngleVectors(self.s.angles));
    start = G_ProjectSource(self.s.origin, infantryFlashOffset(flash_number), forward, right);

    const aim = aimangles[flash_number - MZ2_INFANTRY_MACHINEGUN_2] ?? [0, 0, 0];
    forward = AngleVectors(subtractVec3(self.s.angles, aim)).forward;
  }

  monster_fire_bullet(
    self,
    start,
    forward,
    3,
    4,
    DEFAULT_BULLET_HSPREAD,
    DEFAULT_BULLET_VSPREAD,
    flash_number,
    runtime
  );
}

/**
 * Original name: infantry_sight
 * Source: game/m_infantry.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Emits the infantry sight sound on the body channel.
 */
export function infantry_sight(self: GameEntity, _other: GameEntity | null, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_sight, SOUND_SIGHT, soundOptions(CHAN_BODY));
}

/**
 * Original name: infantry_dead
 * Source: game/m_infantry.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Shrinks the corpse bbox, switches to toss movement, marks the corpse as dead monster and relinks it.
 * Porting notes: Keeps the fly check used by the original death cleanup.
 */
export function infantry_dead(self: GameEntity, runtime: GameRuntime): void {
  setVec3(self.mins, -16, -16, -24);
  setVec3(self.maxs, 16, 16, -8);
  self.movetype = MOVETYPE_TOSS;
  self.svflags |= SVF_DEADMONSTER;
  linkGameEntity(runtime, self);
  M_FlyCheck(self, runtime);
}

const infantry_frames_death1 = makeFrames(ai_move, [-4, 0, 0, -1, -4, 0, 0, 0, -1, 3, 1, 1, -2, 2, 2, 9, 9, 5, -3, -3]);
export const infantry_move_death1: GameMonsterMove = {
  firstframe: FRAME_death101,
  lastframe: FRAME_death120,
  frame: infantry_frames_death1,
  endfunc: infantry_dead
};

const infantry_frames_death2 = makeFrames(
  ai_move,
  [0, 1, 5, -1, 0, 1, 1, 4, 3, 0, -2, -2, -3, -1, -2, 0, 2, 2, 3, -10, -7, -8, -6, 4, 0],
  indexedThinks(25, [
    [10, InfantryMachineGun],
    [11, InfantryMachineGun],
    [12, InfantryMachineGun],
    [13, InfantryMachineGun],
    [14, InfantryMachineGun],
    [15, InfantryMachineGun],
    [16, InfantryMachineGun],
    [17, InfantryMachineGun],
    [18, InfantryMachineGun],
    [19, InfantryMachineGun],
    [20, InfantryMachineGun],
    [21, InfantryMachineGun]
  ])
);
export const infantry_move_death2: GameMonsterMove = {
  firstframe: FRAME_death201,
  lastframe: FRAME_death225,
  frame: infantry_frames_death2,
  endfunc: infantry_dead
};

const infantry_frames_death3 = makeFrames(ai_move, [0, 0, 0, -6, -11, -3, -11, 0, 0]);
export const infantry_move_death3: GameMonsterMove = {
  firstframe: FRAME_death301,
  lastframe: FRAME_death309,
  frame: infantry_frames_death3,
  endfunc: infantry_dead
};

/**
 * Original name: infantry_die
 * Source: game/m_infantry.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Handles gib death, regular death animation selection, dead flags, damage state and death sounds.
 * Porting notes: Uses `randomInt(3)` for the original `rand() % 3` branch.
 */
export function infantry_die(
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

  const n = randomInt(3);
  if (n === 0) {
    self.monsterinfo.currentmove = infantry_move_death1;
    emitRegisteredGameSound(runtime, self, sound_die2, SOUND_DIE2, soundOptions(CHAN_VOICE));
  } else if (n === 1) {
    self.monsterinfo.currentmove = infantry_move_death2;
    emitRegisteredGameSound(runtime, self, sound_die1, SOUND_DIE1, soundOptions(CHAN_VOICE));
  } else {
    self.monsterinfo.currentmove = infantry_move_death3;
    emitRegisteredGameSound(runtime, self, sound_die2, SOUND_DIE2, soundOptions(CHAN_VOICE));
  }
}

/**
 * Original name: infantry_duck_down
 * Source: game/m_infantry.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Enters duck state, lowers bbox, enables aimed damage and sets the pause window.
 */
export function infantry_duck_down(self: GameEntity, runtime: GameRuntime): void {
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
 * Original name: infantry_duck_hold
 * Source: game/m_infantry.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Holds or releases the duck frame depending on `monsterinfo.pausetime`.
 */
export function infantry_duck_hold(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.time >= self.monsterinfo.pausetime) {
    self.monsterinfo.aiflags &= ~AI_HOLD_FRAME;
  } else {
    self.monsterinfo.aiflags |= AI_HOLD_FRAME;
  }
}

/**
 * Original name: infantry_duck_up
 * Source: game/m_infantry.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Leaves duck state, restores bbox height and returns damage handling to aimed damage.
 */
export function infantry_duck_up(self: GameEntity, runtime: GameRuntime): void {
  self.monsterinfo.aiflags &= ~AI_DUCKED;
  self.maxs[2] += 32;
  self.takedamage = damage_t.DAMAGE_AIM;
  linkGameEntity(runtime, self);
}

const infantry_frames_duck = makeFrames(ai_move, [-2, -5, 3, 4, 0], [
  infantry_duck_down,
  infantry_duck_hold,
  undefined,
  infantry_duck_up,
  undefined
]);
export const infantry_move_duck: GameMonsterMove = {
  firstframe: FRAME_duck01,
  lastframe: FRAME_duck05,
  frame: infantry_frames_duck,
  endfunc: infantry_run
};

/**
 * Original name: infantry_dodge
 * Source: game/m_infantry.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Porting notes:
 * - Uses `g_local.random` for the original `random()` macro branch.
 */
export function infantry_dodge(self: GameEntity, attacker: GameEntity | null, _eta: number): void {
  if (random() > 0.25) {
    return;
  }

  if (!self.enemy) {
    self.enemy = attacker;
  }

  self.monsterinfo.currentmove = infantry_move_duck;
}

/**
 * Original name: infantry_cock_gun
 * Source: game/m_infantry.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Plays the weapon cock sound and chooses the machinegun hold duration.
 * Porting notes: Uses `randomInt(16)` for the original `rand() & 15`.
 */
export function infantry_cock_gun(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_weapon_cock, SOUND_WEAPON_COCK, soundOptions(CHAN_WEAPON));
  const n = randomInt(16) + 10;
  self.monsterinfo.pausetime = runtime.time + n * FRAMETIME;
}

/**
 * Original name: infantry_fire
 * Source: game/m_infantry.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Fires the machinegun and holds or releases the attack frame based on the pause window.
 */
export function infantry_fire(self: GameEntity, runtime: GameRuntime): void {
  InfantryMachineGun(self, runtime);

  if (runtime.time >= self.monsterinfo.pausetime) {
    self.monsterinfo.aiflags &= ~AI_HOLD_FRAME;
  } else {
    self.monsterinfo.aiflags |= AI_HOLD_FRAME;
  }
}

const infantry_frames_attack1 = makeFrames(
  ai_charge,
  [4, -1, -1, 0, -1, 1, 1, 2, -2, -3, 1, 5, -1, -2, -3],
  indexedThinks(15, [
    [3, infantry_cock_gun],
    [10, infantry_fire]
  ])
);
export const infantry_move_attack1: GameMonsterMove = {
  firstframe: FRAME_attak101,
  lastframe: FRAME_attak115,
  frame: infantry_frames_attack1,
  endfunc: infantry_run
};

/**
 * Original name: infantry_swing
 * Source: game/m_infantry.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Emits the melee swing sound on the weapon channel.
 */
export function infantry_swing(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_punch_swing, SOUND_PUNCH_SWING, soundOptions(CHAN_WEAPON));
}

/**
 * Original name: infantry_smack
 * Source: game/m_infantry.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Performs the melee hit trace and emits the hit sound only on contact.
 * Porting notes: Uses `randomInt(5)` for the original `rand() % 5` damage spread.
 */
export function infantry_smack(self: GameEntity, runtime: GameRuntime): void {
  const aim: vec3_t = [MELEE_DISTANCE, 0, 0];
  if (fire_hit(self, aim, 5 + randomInt(5), 50, runtime)) {
    emitRegisteredGameSound(runtime, self, sound_punch_hit, SOUND_PUNCH_HIT, soundOptions(CHAN_WEAPON));
  }
}

const infantry_frames_attack2 = makeFrames(
  ai_charge,
  [3, 6, 0, 8, 5, 8, 6, 3],
  indexedThinks(8, [
    [2, infantry_swing],
    [5, infantry_smack]
  ])
);
export const infantry_move_attack2: GameMonsterMove = {
  firstframe: FRAME_attak201,
  lastframe: FRAME_attak208,
  frame: infantry_frames_attack2,
  endfunc: infantry_run
};

/**
 * Original name: infantry_attack
 * Source: game/m_infantry.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Selects melee attack in melee range, otherwise selects the machinegun attack.
 */
export function infantry_attack(self: GameEntity): void {
  if (self.enemy && range(self, self.enemy) === RANGE_MELEE) {
    self.monsterinfo.currentmove = infantry_move_attack2;
  } else {
    self.monsterinfo.currentmove = infantry_move_attack1;
  }
}

/**
 * Original name: SP_monster_infantry
 * Source: game/m_infantry.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Precaches infantry assets, initializes monster callbacks/state and starts the walking monster runtime.
 * Porting notes: Deathmatch removal and model/sound registration mirror the original spawn routine.
 */
export function SP_monster_infantry(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  precacheInfantryAssets(runtime);

  self.movetype = MOVETYPE_STEP;
  self.solid = SOLID_BBOX;
  self.s.modelindex = registerGameModel(runtime, "models/monsters/infantry/tris.md2");
  setVec3(self.mins, -16, -16, -24);
  setVec3(self.maxs, 16, 16, 32);

  self.health = 100;
  self.gib_health = -40;
  self.mass = 200;

  self.pain = infantry_pain;
  self.die = infantry_die;

  self.monsterinfo.stand = infantry_stand;
  self.monsterinfo.walk = infantry_walk;
  self.monsterinfo.run = infantry_run;
  self.monsterinfo.dodge = infantry_dodge;
  self.monsterinfo.attack = infantry_attack;
  self.monsterinfo.melee = undefined;
  self.monsterinfo.sight = infantry_sight;
  self.monsterinfo.idle = infantry_fidget;

  linkGameEntity(runtime, self);
  self.monsterinfo.currentmove = infantry_move_stand;
  self.monsterinfo.scale = MODEL_SCALE;

  walkmonster_start(self, runtime);
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Builds runtime monster-frame objects from the compact C frame table data.
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
 * Purpose: Creates sparse frame callback arrays for translated monster move tables.
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
 * Source: N/A (runtime asset helper)
 * Category: New
 * Purpose: Registers the sounds required by the ported infantry spawn routine.
 */
function precacheInfantryAssets(runtime: GameRuntime): void {
  sound_pain1 = registerGameSound(runtime, SOUND_PAIN1);
  sound_pain2 = registerGameSound(runtime, SOUND_PAIN2);
  sound_die1 = registerGameSound(runtime, SOUND_DIE1);
  sound_die2 = registerGameSound(runtime, SOUND_DIE2);
  sound_gunshot = registerGameSound(runtime, SOUND_GUNSHOT);
  sound_weapon_cock = registerGameSound(runtime, SOUND_WEAPON_COCK);
  sound_punch_swing = registerGameSound(runtime, SOUND_PUNCH_SWING);
  sound_punch_hit = registerGameSound(runtime, SOUND_PUNCH_HIT);
  sound_sight = registerGameSound(runtime, SOUND_SIGHT);
  sound_search = registerGameSound(runtime, SOUND_SEARCH);
  sound_idle = registerGameSound(runtime, SOUND_IDLE);
  void sound_gunshot;
  void sound_search;
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Normalizes sound options used by the infantry sound call adapters.
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
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Resolves infantry muzzle flash offsets through the shared monster flash table.
 */
function infantryFlashOffset(flashNumber: number): vec3_t {
  return getMonsterFlashOffset(flashNumber);
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Assigns vector components without depending on C macro mutation semantics.
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
 * Purpose: Returns a new vector containing component-wise addition.
 */
function addVec3(left: vec3_t, right: vec3_t): vec3_t {
  return [
    left[0] + right[0],
    left[1] + right[1],
    left[2] + right[2]
  ];
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Returns a new vector containing component-wise subtraction.
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
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Returns a new vector scaled by a scalar factor.
 */
function scaleVec3(vector: vec3_t, scale: number): vec3_t {
  return [
    vector[0] * scale,
    vector[1] * scale,
    vector[2] * scale
  ];
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Returns a normalized vector with a zero-vector guard.
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
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Implements the small integer random branches used by the ported infantry logic.
 */
function randomInt(maxExclusive: number): number {
  return Math.trunc(Math.random() * maxExclusive);
}
