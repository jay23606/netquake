/**
 * File: m_brain.ts
 * Source: Quake II original / game/m_brain.h and game/m_brain.c
 * Purpose: Port of the generated brain model frame constants and monster_brain gameplay behavior.
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
 * - This file keeps the header constants and C behavior together as the principal attachment point for `m_brain`.
 */

import { ATTN_IDLE, ATTN_NORM, CHAN_AUTO, CHAN_BODY, CHAN_VOICE, CHAN_WEAPON, type vec3_t } from "../../qcommon/src/index.js";
import {
  AI_DUCKED,
  AI_HOLD_FRAME,
  AI_STAND_GROUND,
  DEAD_DEAD,
  GIB_ORGANIC,
  MELEE_DISTANCE,
  MOVETYPE_STEP,
  MOVETYPE_TOSS,
  POWER_ARMOR_NONE,
  POWER_ARMOR_SCREEN,
  SOLID_BBOX,
  SVF_DEADMONSTER,
  damage_t,
  random
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

export const FRAME_walk101 = 0;
export const FRAME_walk102 = 1;
export const FRAME_walk103 = 2;
export const FRAME_walk104 = 3;
export const FRAME_walk105 = 4;
export const FRAME_walk106 = 5;
export const FRAME_walk107 = 6;
export const FRAME_walk108 = 7;
export const FRAME_walk109 = 8;
export const FRAME_walk110 = 9;
export const FRAME_walk111 = 10;
export const FRAME_walk112 = 11;
export const FRAME_walk113 = 12;
export const FRAME_walk201 = 13;
export const FRAME_walk202 = 14;
export const FRAME_walk203 = 15;
export const FRAME_walk204 = 16;
export const FRAME_walk205 = 17;
export const FRAME_walk206 = 18;
export const FRAME_walk207 = 19;
export const FRAME_walk208 = 20;
export const FRAME_walk209 = 21;
export const FRAME_walk210 = 22;
export const FRAME_walk211 = 23;
export const FRAME_walk212 = 24;
export const FRAME_walk213 = 25;
export const FRAME_walk214 = 26;
export const FRAME_walk215 = 27;
export const FRAME_walk216 = 28;
export const FRAME_walk217 = 29;
export const FRAME_walk218 = 30;
export const FRAME_walk219 = 31;
export const FRAME_walk220 = 32;
export const FRAME_walk221 = 33;
export const FRAME_walk222 = 34;
export const FRAME_walk223 = 35;
export const FRAME_walk224 = 36;
export const FRAME_walk225 = 37;
export const FRAME_walk226 = 38;
export const FRAME_walk227 = 39;
export const FRAME_walk228 = 40;
export const FRAME_walk229 = 41;
export const FRAME_walk230 = 42;
export const FRAME_walk231 = 43;
export const FRAME_walk232 = 44;
export const FRAME_walk233 = 45;
export const FRAME_walk234 = 46;
export const FRAME_walk235 = 47;
export const FRAME_walk236 = 48;
export const FRAME_walk237 = 49;
export const FRAME_walk238 = 50;
export const FRAME_walk239 = 51;
export const FRAME_walk240 = 52;
export const FRAME_attak101 = 53;
export const FRAME_attak102 = 54;
export const FRAME_attak103 = 55;
export const FRAME_attak104 = 56;
export const FRAME_attak105 = 57;
export const FRAME_attak106 = 58;
export const FRAME_attak107 = 59;
export const FRAME_attak108 = 60;
export const FRAME_attak109 = 61;
export const FRAME_attak110 = 62;
export const FRAME_attak111 = 63;
export const FRAME_attak112 = 64;
export const FRAME_attak113 = 65;
export const FRAME_attak114 = 66;
export const FRAME_attak115 = 67;
export const FRAME_attak116 = 68;
export const FRAME_attak117 = 69;
export const FRAME_attak118 = 70;
export const FRAME_attak201 = 71;
export const FRAME_attak202 = 72;
export const FRAME_attak203 = 73;
export const FRAME_attak204 = 74;
export const FRAME_attak205 = 75;
export const FRAME_attak206 = 76;
export const FRAME_attak207 = 77;
export const FRAME_attak208 = 78;
export const FRAME_attak209 = 79;
export const FRAME_attak210 = 80;
export const FRAME_attak211 = 81;
export const FRAME_attak212 = 82;
export const FRAME_attak213 = 83;
export const FRAME_attak214 = 84;
export const FRAME_attak215 = 85;
export const FRAME_attak216 = 86;
export const FRAME_attak217 = 87;
export const FRAME_pain101 = 88;
export const FRAME_pain102 = 89;
export const FRAME_pain103 = 90;
export const FRAME_pain104 = 91;
export const FRAME_pain105 = 92;
export const FRAME_pain106 = 93;
export const FRAME_pain107 = 94;
export const FRAME_pain108 = 95;
export const FRAME_pain109 = 96;
export const FRAME_pain110 = 97;
export const FRAME_pain111 = 98;
export const FRAME_pain112 = 99;
export const FRAME_pain113 = 100;
export const FRAME_pain114 = 101;
export const FRAME_pain115 = 102;
export const FRAME_pain116 = 103;
export const FRAME_pain117 = 104;
export const FRAME_pain118 = 105;
export const FRAME_pain119 = 106;
export const FRAME_pain120 = 107;
export const FRAME_pain121 = 108;
export const FRAME_pain201 = 109;
export const FRAME_pain202 = 110;
export const FRAME_pain203 = 111;
export const FRAME_pain204 = 112;
export const FRAME_pain205 = 113;
export const FRAME_pain206 = 114;
export const FRAME_pain207 = 115;
export const FRAME_pain208 = 116;
export const FRAME_pain301 = 117;
export const FRAME_pain302 = 118;
export const FRAME_pain303 = 119;
export const FRAME_pain304 = 120;
export const FRAME_pain305 = 121;
export const FRAME_pain306 = 122;
export const FRAME_death101 = 123;
export const FRAME_death102 = 124;
export const FRAME_death103 = 125;
export const FRAME_death104 = 126;
export const FRAME_death105 = 127;
export const FRAME_death106 = 128;
export const FRAME_death107 = 129;
export const FRAME_death108 = 130;
export const FRAME_death109 = 131;
export const FRAME_death110 = 132;
export const FRAME_death111 = 133;
export const FRAME_death112 = 134;
export const FRAME_death113 = 135;
export const FRAME_death114 = 136;
export const FRAME_death115 = 137;
export const FRAME_death116 = 138;
export const FRAME_death117 = 139;
export const FRAME_death118 = 140;
export const FRAME_death201 = 141;
export const FRAME_death202 = 142;
export const FRAME_death203 = 143;
export const FRAME_death204 = 144;
export const FRAME_death205 = 145;
export const FRAME_duck01 = 146;
export const FRAME_duck02 = 147;
export const FRAME_duck03 = 148;
export const FRAME_duck04 = 149;
export const FRAME_duck05 = 150;
export const FRAME_duck06 = 151;
export const FRAME_duck07 = 152;
export const FRAME_duck08 = 153;
export const FRAME_defens01 = 154;
export const FRAME_defens02 = 155;
export const FRAME_defens03 = 156;
export const FRAME_defens04 = 157;
export const FRAME_defens05 = 158;
export const FRAME_defens06 = 159;
export const FRAME_defens07 = 160;
export const FRAME_defens08 = 161;
export const FRAME_stand01 = 162;
export const FRAME_stand02 = 163;
export const FRAME_stand03 = 164;
export const FRAME_stand04 = 165;
export const FRAME_stand05 = 166;
export const FRAME_stand06 = 167;
export const FRAME_stand07 = 168;
export const FRAME_stand08 = 169;
export const FRAME_stand09 = 170;
export const FRAME_stand10 = 171;
export const FRAME_stand11 = 172;
export const FRAME_stand12 = 173;
export const FRAME_stand13 = 174;
export const FRAME_stand14 = 175;
export const FRAME_stand15 = 176;
export const FRAME_stand16 = 177;
export const FRAME_stand17 = 178;
export const FRAME_stand18 = 179;
export const FRAME_stand19 = 180;
export const FRAME_stand20 = 181;
export const FRAME_stand21 = 182;
export const FRAME_stand22 = 183;
export const FRAME_stand23 = 184;
export const FRAME_stand24 = 185;
export const FRAME_stand25 = 186;
export const FRAME_stand26 = 187;
export const FRAME_stand27 = 188;
export const FRAME_stand28 = 189;
export const FRAME_stand29 = 190;
export const FRAME_stand30 = 191;
export const FRAME_stand31 = 192;
export const FRAME_stand32 = 193;
export const FRAME_stand33 = 194;
export const FRAME_stand34 = 195;
export const FRAME_stand35 = 196;
export const FRAME_stand36 = 197;
export const FRAME_stand37 = 198;
export const FRAME_stand38 = 199;
export const FRAME_stand39 = 200;
export const FRAME_stand40 = 201;
export const FRAME_stand41 = 202;
export const FRAME_stand42 = 203;
export const FRAME_stand43 = 204;
export const FRAME_stand44 = 205;
export const FRAME_stand45 = 206;
export const FRAME_stand46 = 207;
export const FRAME_stand47 = 208;
export const FRAME_stand48 = 209;
export const FRAME_stand49 = 210;
export const FRAME_stand50 = 211;
export const FRAME_stand51 = 212;
export const FRAME_stand52 = 213;
export const FRAME_stand53 = 214;
export const FRAME_stand54 = 215;
export const FRAME_stand55 = 216;
export const FRAME_stand56 = 217;
export const FRAME_stand57 = 218;
export const FRAME_stand58 = 219;
export const FRAME_stand59 = 220;
export const FRAME_stand60 = 221;

export const MODEL_SCALE = 1.0;

// Original name: N/A
// Source: N/A (named local constant for C magic spawnflag)
// Category: New
const BRAIN_TENTACLE_REATTACK = 65536;

const SOUND_CHEST_OPEN = "brain/brnatck1.wav";
const SOUND_TENTACLES_EXTEND = "brain/brnatck2.wav";
const SOUND_TENTACLES_RETRACT = "brain/brnatck3.wav";
const SOUND_DEATH = "brain/brndeth1.wav";
const SOUND_IDLE1 = "brain/brnidle1.wav";
const SOUND_IDLE2 = "brain/brnidle2.wav";
const SOUND_IDLE3 = "brain/brnlens1.wav";
const SOUND_PAIN1 = "brain/brnpain1.wav";
const SOUND_PAIN2 = "brain/brnpain2.wav";
const SOUND_SIGHT = "brain/brnsght1.wav";
const SOUND_SEARCH = "brain/brnsrch1.wav";
const SOUND_MELEE1 = "brain/melee1.wav";
const SOUND_MELEE2 = "brain/melee2.wav";
const SOUND_MELEE3 = "brain/melee3.wav";

// Original name: N/A
// Source: N/A (runtime sound handles)
// Category: New
let sound_chest_open = 0;
let sound_tentacles_extend = 0;
let sound_tentacles_retract = 0;
let sound_death = 0;
let sound_idle1 = 0;
let sound_idle2 = 0;
let sound_idle3 = 0;
let sound_pain1 = 0;
let sound_pain2 = 0;
let sound_sight = 0;
let sound_search = 0;
let sound_melee1 = 0;
let sound_melee2 = 0;
let sound_melee3 = 0;

/**
 * Original name: brain_sight
 * Source: game/m_brain.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Plays the brain sight voice sound on the monster entity.
 * Porting notes: Uses the runtime sound-event adapter instead of direct `gi.sound`.
 */
export function brain_sight(self: GameEntity, _other: GameEntity | null, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_sight, SOUND_SIGHT, soundOptions(CHAN_VOICE));
}

/**
 * Original name: brain_search
 * Source: game/m_brain.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Plays the brain search voice sound on the monster entity.
 * Porting notes: Uses the runtime sound-event adapter instead of direct `gi.sound`.
 */
export function brain_search(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_search, SOUND_SEARCH, soundOptions(CHAN_VOICE));
}

const brain_frames_stand = makeFrames(ai_stand, new Array<number>(30).fill(0));
export const brain_move_stand: GameMonsterMove = {
  firstframe: FRAME_stand01,
  lastframe: FRAME_stand30,
  frame: brain_frames_stand,
  endfunc: undefined
};

/**
 * Original name: brain_stand
 * Source: game/m_brain.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Switches the monster to the standing animation move.
 * Porting notes: Preserves the original currentmove assignment.
 */
export function brain_stand(self: GameEntity): void {
  self.monsterinfo.currentmove = brain_move_stand;
}

const brain_frames_idle = makeFrames(ai_stand, new Array<number>(30).fill(0));
export const brain_move_idle: GameMonsterMove = {
  firstframe: FRAME_stand31,
  lastframe: FRAME_stand60,
  frame: brain_frames_idle,
  endfunc: brain_stand
};

/**
 * Original name: brain_idle
 * Source: game/m_brain.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Plays the idle lens sound and switches to the idle animation move.
 * Porting notes: Uses registered runtime sound output in place of direct `gi.sound`.
 */
export function brain_idle(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_idle3, SOUND_IDLE3, {
    channel: CHAN_AUTO,
    volume: 1,
    attenuation: ATTN_IDLE,
    timeofs: 0
  });
  self.monsterinfo.currentmove = brain_move_idle;
}

const brain_frames_walk1 = makeFrames(ai_walk, [7, 2, 3, 3, 1, 0, 0, 9, -4, -1, 2]);
export const brain_move_walk1: GameMonsterMove = {
  firstframe: FRAME_walk101,
  lastframe: FRAME_walk111,
  frame: brain_frames_walk1,
  endfunc: undefined
};

/**
 * Original name: brain_walk
 * Source: game/m_brain.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Selects the first walk animation move; the disabled C walk2 branch remains omitted.
 * Porting notes: Preserves the active C path and keeps the `#if 0` walk2 code out of runtime.
 */
export function brain_walk(self: GameEntity): void {
  self.monsterinfo.currentmove = brain_move_walk1;
}

const brain_frames_defense = makeFrames(ai_move, new Array<number>(9).fill(0));
export const brain_move_defense: GameMonsterMove = {
  firstframe: FRAME_defens01,
  lastframe: FRAME_defens08,
  frame: brain_frames_defense,
  endfunc: undefined
};

const brain_frames_pain3 = makeFrames(ai_move, [-2, 2, 1, 3, 0, -4]);
export const brain_move_pain3: GameMonsterMove = {
  firstframe: FRAME_pain301,
  lastframe: FRAME_pain306,
  frame: brain_frames_pain3,
  endfunc: brain_run
};

const brain_frames_pain2 = makeFrames(ai_move, [-2, 0, 0, 0, 0, 3, 1, -2]);
export const brain_move_pain2: GameMonsterMove = {
  firstframe: FRAME_pain201,
  lastframe: FRAME_pain208,
  frame: brain_frames_pain2,
  endfunc: brain_run
};

const brain_frames_pain1 = makeFrames(ai_move, [-6, -2, -6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 2, 1, 7, 0, 3, -1]);
export const brain_move_pain1: GameMonsterMove = {
  firstframe: FRAME_pain101,
  lastframe: FRAME_pain121,
  frame: brain_frames_pain1,
  endfunc: brain_run
};

/**
 * Original name: brain_duck_down
 * Source: game/m_brain.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Enters the ducked state, lowers the collision max Z, enables damage and relinks the entity.
 */
export function brain_duck_down(self: GameEntity, runtime: GameRuntime): void {
  if ((self.monsterinfo.aiflags & AI_DUCKED) !== 0) {
    return;
  }
  self.monsterinfo.aiflags |= AI_DUCKED;
  self.maxs[2] -= 32;
  self.takedamage = damage_t.DAMAGE_YES;
  linkGameEntity(runtime, self);
}

/**
 * Original name: brain_duck_hold
 * Source: game/m_brain.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Holds or releases the current duck frame based on `monsterinfo.pausetime`.
 */
export function brain_duck_hold(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.time >= self.monsterinfo.pausetime) {
    self.monsterinfo.aiflags &= ~AI_HOLD_FRAME;
  } else {
    self.monsterinfo.aiflags |= AI_HOLD_FRAME;
  }
}

/**
 * Original name: brain_duck_up
 * Source: game/m_brain.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Leaves the ducked state, restores the collision max Z, restores aim damage and relinks the entity.
 */
export function brain_duck_up(self: GameEntity, runtime: GameRuntime): void {
  self.monsterinfo.aiflags &= ~AI_DUCKED;
  self.maxs[2] += 32;
  self.takedamage = damage_t.DAMAGE_AIM;
  linkGameEntity(runtime, self);
}

const brain_frames_duck = makeFrames(ai_move, [0, -2, 17, -3, -1, -5, -6, -6], [
  undefined,
  brain_duck_down,
  brain_duck_hold,
  undefined,
  brain_duck_up,
  undefined,
  undefined,
  undefined
]);
export const brain_move_duck: GameMonsterMove = {
  firstframe: FRAME_duck01,
  lastframe: FRAME_duck08,
  frame: brain_frames_duck,
  endfunc: brain_run
};

/**
 * Original name: brain_dodge
 * Source: game/m_brain.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Uses the C random macro bucket, adopts the attacker if needed and starts the duck move.
 * Porting notes: `runtime.time` replaces `level.time`; `random()` is the game macro wrapper, not `Math.random` directly.
 */
export function brain_dodge(self: GameEntity, attacker: GameEntity | null, eta: number, runtime: GameRuntime): void {
  if (random() > 0.25) {
    return;
  }

  if (!self.enemy) {
    self.enemy = attacker;
  }

  self.monsterinfo.pausetime = runtime.time + eta + 0.5;
  self.monsterinfo.currentmove = brain_move_duck;
}

const brain_frames_death2 = makeFrames(ai_move, [0, 0, 0, 9, 0]);
export const brain_move_death2: GameMonsterMove = {
  firstframe: FRAME_death201,
  lastframe: FRAME_death205,
  frame: brain_frames_death2,
  endfunc: brain_dead
};

const brain_frames_death1 = makeFrames(ai_move, [0, 0, -2, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
export const brain_move_death1: GameMonsterMove = {
  firstframe: FRAME_death101,
  lastframe: FRAME_death118,
  frame: brain_frames_death1,
  endfunc: brain_dead
};

/**
 * Original name: brain_swing_right
 * Source: game/m_brain.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Emits the right swing body sound.
 */
export function brain_swing_right(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_melee1, SOUND_MELEE1, soundOptions(CHAN_BODY));
}

/**
 * Original name: brain_hit_right
 * Source: game/m_brain.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Fires the right melee hit trace using `self.maxs[0]` and emits the hit sound on success.
 * Porting notes: Preserves the C `rand() % 5` integer damage bucket through `randomInt(5)`.
 */
export function brain_hit_right(self: GameEntity, runtime: GameRuntime): void {
  const aim: vec3_t = [MELEE_DISTANCE, self.maxs[0], 8];
  if (fire_hit(self, aim, 15 + randomInt(5), 40, runtime)) {
    emitRegisteredGameSound(runtime, self, sound_melee3, SOUND_MELEE3, soundOptions(CHAN_WEAPON));
  }
}

/**
 * Original name: brain_swing_left
 * Source: game/m_brain.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Emits the left swing body sound.
 */
export function brain_swing_left(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_melee2, SOUND_MELEE2, soundOptions(CHAN_BODY));
}

/**
 * Original name: brain_hit_left
 * Source: game/m_brain.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Fires the left melee hit trace using `self.mins[0]` and emits the hit sound on success.
 * Porting notes: Preserves the C `rand() % 5` integer damage bucket through `randomInt(5)`.
 */
export function brain_hit_left(self: GameEntity, runtime: GameRuntime): void {
  const aim: vec3_t = [MELEE_DISTANCE, self.mins[0], 8];
  if (fire_hit(self, aim, 15 + randomInt(5), 40, runtime)) {
    emitRegisteredGameSound(runtime, self, sound_melee3, SOUND_MELEE3, soundOptions(CHAN_WEAPON));
  }
}

const brain_frames_attack1 = makeFrames(
  ai_charge,
  [8, 3, 5, 0, -3, 0, -5, -7, 0, 6, 1, 2, -3, 6, -1, -3, 2, -11],
  indexedThinks(18, [
    [4, brain_swing_right],
    [7, brain_hit_right],
    [9, brain_swing_left],
    [11, brain_hit_left]
  ])
);
export const brain_move_attack1: GameMonsterMove = {
  firstframe: FRAME_attak101,
  lastframe: FRAME_attak118,
  frame: brain_frames_attack1,
  endfunc: brain_run
};

/**
 * Original name: brain_chest_open
 * Source: game/m_brain.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Clears the reattack flag, drops power armor and emits the chest-open attack sound.
 * Porting notes: The C magic spawnflag `65536` is named `BRAIN_TENTACLE_REATTACK`.
 */
export function brain_chest_open(self: GameEntity, runtime: GameRuntime): void {
  self.spawnflags &= ~BRAIN_TENTACLE_REATTACK;
  self.monsterinfo.power_armor_type = POWER_ARMOR_NONE;
  emitRegisteredGameSound(runtime, self, sound_chest_open, SOUND_CHEST_OPEN, soundOptions(CHAN_BODY));
}

/**
 * Original name: brain_tentacle_attack
 * Source: game/m_brain.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Performs the tentacle melee hit, optionally arms a reattack on skill > 0, then emits retract sound.
 * Porting notes: Preserves the C `rand() % 5` integer damage bucket through `randomInt(5)`.
 */
export function brain_tentacle_attack(self: GameEntity, runtime: GameRuntime): void {
  const aim: vec3_t = [MELEE_DISTANCE, 0, 8];
  if (fire_hit(self, aim, 10 + randomInt(5), -600, runtime) && runtime.skill > 0) {
    self.spawnflags |= BRAIN_TENTACLE_REATTACK;
  }
  emitRegisteredGameSound(runtime, self, sound_tentacles_retract, SOUND_TENTACLES_RETRACT, soundOptions(CHAN_WEAPON));
}

/**
 * Original name: brain_chest_closed
 * Source: game/m_brain.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Restores screen armor and loops into attack1 when the tentacle reattack flag is set.
 * Porting notes: The C magic spawnflag `65536` is named `BRAIN_TENTACLE_REATTACK`.
 */
export function brain_chest_closed(self: GameEntity): void {
  self.monsterinfo.power_armor_type = POWER_ARMOR_SCREEN;
  if ((self.spawnflags & BRAIN_TENTACLE_REATTACK) !== 0) {
    self.spawnflags &= ~BRAIN_TENTACLE_REATTACK;
    self.monsterinfo.currentmove = brain_move_attack1;
  }
}

const brain_frames_attack2 = makeFrames(
  ai_charge,
  [5, -4, -4, -3, 0, 0, 13, 0, 2, 0, -9, 0, 4, 3, 2, -3, -6],
  indexedThinks(17, [
    [4, brain_chest_open],
    [6, brain_tentacle_attack],
    [10, brain_chest_closed]
  ])
);
export const brain_move_attack2: GameMonsterMove = {
  firstframe: FRAME_attak201,
  lastframe: FRAME_attak217,
  frame: brain_frames_attack2,
  endfunc: brain_run
};

/**
 * Original name: brain_melee
 * Source: game/m_brain.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Randomly selects the claw combo or tentacle attack move.
 * Porting notes: Uses the game `random()` macro wrapper to preserve the C threshold behavior.
 */
export function brain_melee(self: GameEntity): void {
  if (random() <= 0.5) {
    self.monsterinfo.currentmove = brain_move_attack1;
  } else {
    self.monsterinfo.currentmove = brain_move_attack2;
  }
}

const brain_frames_run = makeFrames(ai_run, [9, 2, 3, 3, 1, 0, 0, 10, -4, -1, 2]);
export const brain_move_run: GameMonsterMove = {
  firstframe: FRAME_walk101,
  lastframe: FRAME_walk111,
  frame: brain_frames_run,
  endfunc: undefined
};

/**
 * Original name: brain_run
 * Source: game/m_brain.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Restores brain power armor and selects stand-ground or run movement.
 * Porting notes: Preserves the original AI_STAND_GROUND branch.
 */
export function brain_run(self: GameEntity): void {
  self.monsterinfo.power_armor_type = POWER_ARMOR_SCREEN;
  if ((self.monsterinfo.aiflags & AI_STAND_GROUND) !== 0) {
    self.monsterinfo.currentmove = brain_move_stand;
  } else {
    self.monsterinfo.currentmove = brain_move_run;
  }
}

/**
 * Original name: brain_pain
 * Source: game/m_brain.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Updates damaged skin, debounces pain, suppresses nightmare animations and selects a pain move.
 * Porting notes: `runtime.time` and `runtime.skill` replace `level.time` and `skill->value`.
 */
export function brain_pain(
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
    self.monsterinfo.currentmove = brain_move_pain1;
  } else if (r < 0.66) {
    emitRegisteredGameSound(runtime, self, sound_pain2, SOUND_PAIN2, soundOptions(CHAN_VOICE));
    self.monsterinfo.currentmove = brain_move_pain2;
  } else {
    emitRegisteredGameSound(runtime, self, sound_pain1, SOUND_PAIN1, soundOptions(CHAN_VOICE));
    self.monsterinfo.currentmove = brain_move_pain3;
  }
}

/**
 * Original name: brain_dead
 * Source: game/m_brain.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Shrinks the dead bounding box, switches to toss movement, marks deadmonster and relinks.
 */
export function brain_dead(self: GameEntity, runtime: GameRuntime): void {
  setVec3(self.mins, -16, -16, -24);
  setVec3(self.maxs, 16, 16, -8);
  self.movetype = MOVETYPE_TOSS;
  self.svflags |= SVF_DEADMONSTER;
  self.nextthink = 0;
  linkGameEntity(runtime, self);
}

/**
 * Original name: brain_die
 * Source: game/m_brain.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Clears armor/effects, handles gib death, otherwise plays death sound and selects a death move.
 * Porting notes: Gib spawning uses the shared TS `ThrowGib`/`ThrowHead` helpers and preserves counts/models.
 */
export function brain_die(
  self: GameEntity,
  _inflictor: GameEntity | null,
  _attacker: GameEntity | null,
  damage: number,
  runtime: GameRuntime
): void {
  self.s.effects = 0;
  self.monsterinfo.power_armor_type = POWER_ARMOR_NONE;

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
  if (random() <= 0.5) {
    self.monsterinfo.currentmove = brain_move_death1;
  } else {
    self.monsterinfo.currentmove = brain_move_death2;
  }
}

/**
 * Original name: SP_monster_brain
 * Source: game/m_brain.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Precaches assets, initializes monster_brain stats/callbacks/model and starts walkmonster setup.
 * Porting notes: Uses runtime registration/link helpers in place of `gi.soundindex`, `gi.modelindex` and `gi.linkentity`.
 */
export function SP_monster_brain(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  precacheBrainAssets(runtime);

  self.movetype = MOVETYPE_STEP;
  self.solid = SOLID_BBOX;
  self.s.modelindex = registerGameModel(runtime, "models/monsters/brain/tris.md2");
  setVec3(self.mins, -16, -16, -24);
  setVec3(self.maxs, 16, 16, 32);

  self.health = 300;
  self.gib_health = -150;
  self.mass = 400;

  self.pain = brain_pain;
  self.die = brain_die;

  self.monsterinfo.stand = brain_stand;
  self.monsterinfo.walk = brain_walk;
  self.monsterinfo.run = brain_run;
  self.monsterinfo.dodge = brain_dodge;
  self.monsterinfo.attack = undefined;
  self.monsterinfo.melee = brain_melee;
  self.monsterinfo.sight = brain_sight;
  self.monsterinfo.search = brain_search;
  self.monsterinfo.idle = brain_idle;

  self.monsterinfo.power_armor_type = POWER_ARMOR_SCREEN;
  self.monsterinfo.power_armor_power = 100;

  linkGameEntity(runtime, self);
  self.monsterinfo.currentmove = brain_move_stand;
  self.monsterinfo.scale = MODEL_SCALE;

  walkmonster_start(self, runtime);
}

/**
 * Original name: N/A
 * Source: N/A (local monster frame helper)
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
 * Source: N/A (local monster frame helper)
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
function precacheBrainAssets(runtime: GameRuntime): void {
  sound_chest_open = registerGameSound(runtime, SOUND_CHEST_OPEN);
  sound_tentacles_extend = registerGameSound(runtime, SOUND_TENTACLES_EXTEND);
  sound_tentacles_retract = registerGameSound(runtime, SOUND_TENTACLES_RETRACT);
  sound_death = registerGameSound(runtime, SOUND_DEATH);
  sound_idle1 = registerGameSound(runtime, SOUND_IDLE1);
  sound_idle2 = registerGameSound(runtime, SOUND_IDLE2);
  sound_idle3 = registerGameSound(runtime, SOUND_IDLE3);
  sound_pain1 = registerGameSound(runtime, SOUND_PAIN1);
  sound_pain2 = registerGameSound(runtime, SOUND_PAIN2);
  sound_sight = registerGameSound(runtime, SOUND_SIGHT);
  sound_search = registerGameSound(runtime, SOUND_SEARCH);
  sound_melee1 = registerGameSound(runtime, SOUND_MELEE1);
  sound_melee2 = registerGameSound(runtime, SOUND_MELEE2);
  sound_melee3 = registerGameSound(runtime, SOUND_MELEE3);
  void sound_tentacles_extend;
  void sound_idle1;
  void sound_idle2;
}

/**
 * Original name: N/A
 * Source: N/A (local sound options helper)
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
 * Source: N/A (local random integer helper)
 * Category: New
 */
function randomInt(maxExclusive: number): number {
  return Math.trunc(Math.random() * maxExclusive);
}
