/**
 * File: m_gunner.ts
 * Source: Quake II original / game/m_gunner.h and game/m_gunner.c
 * Purpose: Port of the generated gunner model frame constants and monster_gunner gameplay behavior.
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
 * - This file keeps the header constants and C behavior together as the principal attachment point for `m_gunner`.
 */

import { AngleVectors, ATTN_IDLE, ATTN_NORM, CHAN_VOICE, type vec3_t } from "../../qcommon/src/index.js";
import {
  AI_DUCKED,
  AI_HOLD_FRAME,
  AI_STAND_GROUND,
  DEAD_DEAD,
  DEFAULT_BULLET_HSPREAD,
  DEFAULT_BULLET_VSPREAD,
  GIB_ORGANIC,
  MOVETYPE_STEP,
  MOVETYPE_TOSS,
  RANGE_MELEE,
  SOLID_BBOX,
  SVF_DEADMONSTER,
  damage_t,
  random
} from "./g_local.js";
import { ai_charge, ai_move, ai_run, ai_stand, ai_walk, range, visible } from "./g_ai.js";
import { monster_fire_bullet, monster_fire_grenade, walkmonster_start } from "./g_monster.js";
import { ThrowGib, ThrowHead } from "./g_misc.js";
import { G_FreeEdict, G_ProjectSource } from "./g_utils.js";
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
export const FRAME_walk01 = 70;
export const FRAME_walk02 = 71;
export const FRAME_walk03 = 72;
export const FRAME_walk04 = 73;
export const FRAME_walk05 = 74;
export const FRAME_walk06 = 75;
export const FRAME_walk07 = 76;
export const FRAME_walk08 = 77;
export const FRAME_walk09 = 78;
export const FRAME_walk10 = 79;
export const FRAME_walk11 = 80;
export const FRAME_walk12 = 81;
export const FRAME_walk13 = 82;
export const FRAME_walk14 = 83;
export const FRAME_walk15 = 84;
export const FRAME_walk16 = 85;
export const FRAME_walk17 = 86;
export const FRAME_walk18 = 87;
export const FRAME_walk19 = 88;
export const FRAME_walk20 = 89;
export const FRAME_walk21 = 90;
export const FRAME_walk22 = 91;
export const FRAME_walk23 = 92;
export const FRAME_walk24 = 93;
export const FRAME_run01 = 94;
export const FRAME_run02 = 95;
export const FRAME_run03 = 96;
export const FRAME_run04 = 97;
export const FRAME_run05 = 98;
export const FRAME_run06 = 99;
export const FRAME_run07 = 100;
export const FRAME_run08 = 101;
export const FRAME_runs01 = 102;
export const FRAME_runs02 = 103;
export const FRAME_runs03 = 104;
export const FRAME_runs04 = 105;
export const FRAME_runs05 = 106;
export const FRAME_runs06 = 107;
export const FRAME_attak101 = 108;
export const FRAME_attak102 = 109;
export const FRAME_attak103 = 110;
export const FRAME_attak104 = 111;
export const FRAME_attak105 = 112;
export const FRAME_attak106 = 113;
export const FRAME_attak107 = 114;
export const FRAME_attak108 = 115;
export const FRAME_attak109 = 116;
export const FRAME_attak110 = 117;
export const FRAME_attak111 = 118;
export const FRAME_attak112 = 119;
export const FRAME_attak113 = 120;
export const FRAME_attak114 = 121;
export const FRAME_attak115 = 122;
export const FRAME_attak116 = 123;
export const FRAME_attak117 = 124;
export const FRAME_attak118 = 125;
export const FRAME_attak119 = 126;
export const FRAME_attak120 = 127;
export const FRAME_attak121 = 128;
export const FRAME_attak201 = 129;
export const FRAME_attak202 = 130;
export const FRAME_attak203 = 131;
export const FRAME_attak204 = 132;
export const FRAME_attak205 = 133;
export const FRAME_attak206 = 134;
export const FRAME_attak207 = 135;
export const FRAME_attak208 = 136;
export const FRAME_attak209 = 137;
export const FRAME_attak210 = 138;
export const FRAME_attak211 = 139;
export const FRAME_attak212 = 140;
export const FRAME_attak213 = 141;
export const FRAME_attak214 = 142;
export const FRAME_attak215 = 143;
export const FRAME_attak216 = 144;
export const FRAME_attak217 = 145;
export const FRAME_attak218 = 146;
export const FRAME_attak219 = 147;
export const FRAME_attak220 = 148;
export const FRAME_attak221 = 149;
export const FRAME_attak222 = 150;
export const FRAME_attak223 = 151;
export const FRAME_attak224 = 152;
export const FRAME_attak225 = 153;
export const FRAME_attak226 = 154;
export const FRAME_attak227 = 155;
export const FRAME_attak228 = 156;
export const FRAME_attak229 = 157;
export const FRAME_attak230 = 158;
export const FRAME_pain101 = 159;
export const FRAME_pain102 = 160;
export const FRAME_pain103 = 161;
export const FRAME_pain104 = 162;
export const FRAME_pain105 = 163;
export const FRAME_pain106 = 164;
export const FRAME_pain107 = 165;
export const FRAME_pain108 = 166;
export const FRAME_pain109 = 167;
export const FRAME_pain110 = 168;
export const FRAME_pain111 = 169;
export const FRAME_pain112 = 170;
export const FRAME_pain113 = 171;
export const FRAME_pain114 = 172;
export const FRAME_pain115 = 173;
export const FRAME_pain116 = 174;
export const FRAME_pain117 = 175;
export const FRAME_pain118 = 176;
export const FRAME_pain201 = 177;
export const FRAME_pain202 = 178;
export const FRAME_pain203 = 179;
export const FRAME_pain204 = 180;
export const FRAME_pain205 = 181;
export const FRAME_pain206 = 182;
export const FRAME_pain207 = 183;
export const FRAME_pain208 = 184;
export const FRAME_pain301 = 185;
export const FRAME_pain302 = 186;
export const FRAME_pain303 = 187;
export const FRAME_pain304 = 188;
export const FRAME_pain305 = 189;
export const FRAME_death01 = 190;
export const FRAME_death02 = 191;
export const FRAME_death03 = 192;
export const FRAME_death04 = 193;
export const FRAME_death05 = 194;
export const FRAME_death06 = 195;
export const FRAME_death07 = 196;
export const FRAME_death08 = 197;
export const FRAME_death09 = 198;
export const FRAME_death10 = 199;
export const FRAME_death11 = 200;
export const FRAME_duck01 = 201;
export const FRAME_duck02 = 202;
export const FRAME_duck03 = 203;
export const FRAME_duck04 = 204;
export const FRAME_duck05 = 205;
export const FRAME_duck06 = 206;
export const FRAME_duck07 = 207;
export const FRAME_duck08 = 208;

export const MODEL_SCALE = 1.15;

export const MZ2_GUNNER_MACHINEGUN_1 = 45;
export const MZ2_GUNNER_MACHINEGUN_2 = 46;
export const MZ2_GUNNER_MACHINEGUN_3 = 47;
export const MZ2_GUNNER_MACHINEGUN_4 = 48;
export const MZ2_GUNNER_MACHINEGUN_5 = 49;
export const MZ2_GUNNER_MACHINEGUN_6 = 50;
export const MZ2_GUNNER_MACHINEGUN_7 = 51;
export const MZ2_GUNNER_MACHINEGUN_8 = 52;
export const MZ2_GUNNER_GRENADE_1 = 53;
export const MZ2_GUNNER_GRENADE_2 = 54;
export const MZ2_GUNNER_GRENADE_3 = 55;
export const MZ2_GUNNER_GRENADE_4 = 56;

const SOUND_PAIN = "gunner/gunpain2.wav";
const SOUND_PAIN2 = "gunner/gunpain1.wav";
const SOUND_DEATH = "gunner/death1.wav";
const SOUND_IDLE = "gunner/gunidle1.wav";
const SOUND_OPEN = "gunner/gunatck1.wav";
const SOUND_SEARCH = "gunner/gunsrch1.wav";
const SOUND_SIGHT = "gunner/sight1.wav";

// Original name: N/A
// Source: N/A (runtime sound handle cache)
// Category: New
let sound_pain = 0;
let sound_pain2 = 0;
let sound_death = 0;
let sound_idle = 0;
let sound_open = 0;
let sound_search = 0;
let sound_sight = 0;

export function gunner_idlesound(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_idle, SOUND_IDLE, soundOptions(CHAN_VOICE, ATTN_IDLE));
}

export function gunner_sight(self: GameEntity, _other: GameEntity | null, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_sight, SOUND_SIGHT, soundOptions(CHAN_VOICE));
}

export function gunner_search(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_search, SOUND_SEARCH, soundOptions(CHAN_VOICE));
}

const gunner_frames_fidget = makeFrames(
  ai_stand,
  new Array<number>(49).fill(0),
  indexedThinks(49, [[7, gunner_idlesound]])
);
export const gunner_move_fidget: GameMonsterMove = {
  firstframe: FRAME_stand31,
  lastframe: FRAME_stand70,
  frame: gunner_frames_fidget,
  endfunc: gunner_stand
};

/**
 * Original name: gunner_fidget
 * Source: Quake-2-master/game/m_gunner.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Occasionally switches a non-stand-ground gunner into the fidget move.
 * Porting notes: Uses `g_local.random` for the source `random()` macro.
 */
export function gunner_fidget(self: GameEntity): void {
  if ((self.monsterinfo.aiflags & AI_STAND_GROUND) !== 0) {
    return;
  }
  if (random() <= 0.05) {
    self.monsterinfo.currentmove = gunner_move_fidget;
  }
}

const gunner_frames_stand = makeFrames(
  ai_stand,
  new Array<number>(30).fill(0),
  indexedThinks(30, [
    [9, gunner_fidget],
    [19, gunner_fidget],
    [29, gunner_fidget]
  ])
);
export const gunner_move_stand: GameMonsterMove = {
  firstframe: FRAME_stand01,
  lastframe: FRAME_stand30,
  frame: gunner_frames_stand,
  endfunc: undefined
};

export function gunner_stand(self: GameEntity): void {
  self.monsterinfo.currentmove = gunner_move_stand;
}

const gunner_frames_walk = makeFrames(ai_walk, [0, 3, 4, 5, 7, 2, 6, 4, 2, 7, 5, 7, 4]);
export const gunner_move_walk: GameMonsterMove = {
  firstframe: FRAME_walk07,
  lastframe: FRAME_walk19,
  frame: gunner_frames_walk,
  endfunc: undefined
};

export function gunner_walk(self: GameEntity): void {
  self.monsterinfo.currentmove = gunner_move_walk;
}

const gunner_frames_run = makeFrames(ai_run, [26, 9, 9, 9, 15, 10, 13, 6]);
export const gunner_move_run: GameMonsterMove = {
  firstframe: FRAME_run01,
  lastframe: FRAME_run08,
  frame: gunner_frames_run,
  endfunc: undefined
};

export function gunner_run(self: GameEntity): void {
  if ((self.monsterinfo.aiflags & AI_STAND_GROUND) !== 0) {
    self.monsterinfo.currentmove = gunner_move_stand;
  } else {
    self.monsterinfo.currentmove = gunner_move_run;
  }
}

const gunner_frames_runandshoot = makeFrames(ai_run, [32, 15, 10, 18, 8, 20]);
export const gunner_move_runandshoot: GameMonsterMove = {
  firstframe: FRAME_runs01,
  lastframe: FRAME_runs06,
  frame: gunner_frames_runandshoot,
  endfunc: undefined
};

export function gunner_runandshoot(self: GameEntity): void {
  self.monsterinfo.currentmove = gunner_move_runandshoot;
}

const gunner_frames_pain3 = makeFrames(ai_move, [-3, 1, 1, 0, 1]);
export const gunner_move_pain3: GameMonsterMove = {
  firstframe: FRAME_pain301,
  lastframe: FRAME_pain305,
  frame: gunner_frames_pain3,
  endfunc: gunner_run
};

const gunner_frames_pain2 = makeFrames(ai_move, [-2, 11, 6, 2, -1, -7, -2, -7]);
export const gunner_move_pain2: GameMonsterMove = {
  firstframe: FRAME_pain201,
  lastframe: FRAME_pain208,
  frame: gunner_frames_pain2,
  endfunc: gunner_run
};

const gunner_frames_pain1 = makeFrames(ai_move, [2, 0, -5, 3, -1, 0, 0, 0, 0, 1, 1, 2, 1, 0, -2, -2, 0, 0]);
export const gunner_move_pain1: GameMonsterMove = {
  firstframe: FRAME_pain101,
  lastframe: FRAME_pain118,
  frame: gunner_frames_pain1,
  endfunc: gunner_run
};

export function gunner_pain(
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

  if (randomInt(2) === 1) {
    emitRegisteredGameSound(runtime, self, sound_pain, SOUND_PAIN, soundOptions(CHAN_VOICE));
  } else {
    emitRegisteredGameSound(runtime, self, sound_pain2, SOUND_PAIN2, soundOptions(CHAN_VOICE));
  }

  if (runtime.skill === 3) {
    return;
  }

  if (damage <= 10) {
    self.monsterinfo.currentmove = gunner_move_pain3;
  } else if (damage <= 25) {
    self.monsterinfo.currentmove = gunner_move_pain2;
  } else {
    self.monsterinfo.currentmove = gunner_move_pain1;
  }
}

export function gunner_dead(self: GameEntity, runtime: GameRuntime): void {
  setVec3(self.mins, -16, -16, -24);
  setVec3(self.maxs, 16, 16, -8);
  self.movetype = MOVETYPE_TOSS;
  self.svflags |= SVF_DEADMONSTER;
  self.nextthink = 0;
  linkGameEntity(runtime, self);
}

const gunner_frames_death = makeFrames(ai_move, [0, 0, 0, -7, -3, -5, 8, 6, 0, 0, 0]);
export const gunner_move_death: GameMonsterMove = {
  firstframe: FRAME_death01,
  lastframe: FRAME_death11,
  frame: gunner_frames_death,
  endfunc: gunner_dead
};

export function gunner_die(
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
  self.monsterinfo.currentmove = gunner_move_death;
}

/**
 * Original name: gunner_duck_down
 * Source: Quake-2-master/game/m_gunner.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Enters the duck state and, on hard/nightmare skill, may fire a grenade while ducking.
 * Porting notes: Uses `g_local.random` for the source `random()` macro.
 */
export function gunner_duck_down(self: GameEntity, runtime: GameRuntime): void {
  if ((self.monsterinfo.aiflags & AI_DUCKED) !== 0) {
    return;
  }
  self.monsterinfo.aiflags |= AI_DUCKED;
  if (runtime.skill >= 2 && random() > 0.5) {
    GunnerGrenade(self, runtime);
  }

  self.maxs[2] -= 32;
  self.takedamage = damage_t.DAMAGE_YES;
  self.monsterinfo.pausetime = runtime.time + 1;
  linkGameEntity(runtime, self);
}

export function gunner_duck_hold(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.time >= self.monsterinfo.pausetime) {
    self.monsterinfo.aiflags &= ~AI_HOLD_FRAME;
  } else {
    self.monsterinfo.aiflags |= AI_HOLD_FRAME;
  }
}

export function gunner_duck_up(self: GameEntity, runtime: GameRuntime): void {
  self.monsterinfo.aiflags &= ~AI_DUCKED;
  self.maxs[2] += 32;
  self.takedamage = damage_t.DAMAGE_AIM;
  linkGameEntity(runtime, self);
}

const gunner_frames_duck = makeFrames(ai_move, [1, 1, 1, 0, -1, -1, 0, -1], [
  gunner_duck_down,
  undefined,
  gunner_duck_hold,
  undefined,
  undefined,
  undefined,
  gunner_duck_up,
  undefined
]);
export const gunner_move_duck: GameMonsterMove = {
  firstframe: FRAME_duck01,
  lastframe: FRAME_duck08,
  frame: gunner_frames_duck,
  endfunc: gunner_run
};

/**
 * Original name: gunner_dodge
 * Source: Quake-2-master/game/m_gunner.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Randomly chooses whether the gunner ducks in response to incoming fire.
 * Porting notes: Uses `g_local.random` for the source `random()` macro.
 */
export function gunner_dodge(self: GameEntity, attacker: GameEntity | null, _eta: number): void {
  if (random() > 0.25) {
    return;
  }

  if (!self.enemy) {
    self.enemy = attacker;
  }

  self.monsterinfo.currentmove = gunner_move_duck;
}

export function gunner_opengun(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_open, SOUND_OPEN, soundOptions(CHAN_VOICE, ATTN_IDLE));
}

export function GunnerFire(self: GameEntity, runtime: GameRuntime): void {
  if (!self.enemy) {
    return;
  }

  const flash_number = MZ2_GUNNER_MACHINEGUN_1 + (self.s.frame - FRAME_attak216);
  const { forward, right } = AngleVectors(self.s.angles);
  const start = G_ProjectSource(self.s.origin, gunnerFlashOffset(flash_number), forward, right);

  const target = addVec3(self.enemy.s.origin, scaleVec3(self.enemy.velocity, -0.2));
  target[2] += self.enemy.viewheight;

  const aim = normalizeVec3(subtractVec3(target, start));
  monster_fire_bullet(
    self,
    start,
    aim,
    3,
    4,
    DEFAULT_BULLET_HSPREAD,
    DEFAULT_BULLET_VSPREAD,
    flash_number,
    runtime
  );
}

export function GunnerGrenade(self: GameEntity, runtime: GameRuntime): void {
  let flash_number: number;

  if (self.s.frame === FRAME_attak105) {
    flash_number = MZ2_GUNNER_GRENADE_1;
  } else if (self.s.frame === FRAME_attak108) {
    flash_number = MZ2_GUNNER_GRENADE_2;
  } else if (self.s.frame === FRAME_attak111) {
    flash_number = MZ2_GUNNER_GRENADE_3;
  } else {
    flash_number = MZ2_GUNNER_GRENADE_4;
  }

  const { forward, right } = AngleVectors(self.s.angles);
  const start = G_ProjectSource(self.s.origin, gunnerFlashOffset(flash_number), forward, right);
  monster_fire_grenade(self, start, forward, 50, 600, flash_number, runtime);
}

const gunner_frames_attack_chain = makeFrames(
  ai_charge,
  new Array<number>(7).fill(0),
  indexedThinks(7, [[0, gunner_opengun]])
);
export const gunner_move_attack_chain: GameMonsterMove = {
  firstframe: FRAME_attak209,
  lastframe: FRAME_attak215,
  frame: gunner_frames_attack_chain,
  endfunc: gunner_fire_chain
};

const gunner_frames_fire_chain = makeFrames(
  ai_charge,
  new Array<number>(8).fill(0),
  new Array<GameMonsterFrame["thinkfunc"]>(8).fill(GunnerFire)
);
export const gunner_move_fire_chain: GameMonsterMove = {
  firstframe: FRAME_attak216,
  lastframe: FRAME_attak223,
  frame: gunner_frames_fire_chain,
  endfunc: gunner_refire_chain
};

const gunner_frames_endfire_chain = makeFrames(ai_charge, new Array<number>(7).fill(0));
export const gunner_move_endfire_chain: GameMonsterMove = {
  firstframe: FRAME_attak224,
  lastframe: FRAME_attak230,
  frame: gunner_frames_endfire_chain,
  endfunc: gunner_run
};

const gunner_frames_attack_grenade = makeFrames(
  ai_charge,
  new Array<number>(21).fill(0),
  indexedThinks(21, [
    [4, GunnerGrenade],
    [7, GunnerGrenade],
    [10, GunnerGrenade],
    [13, GunnerGrenade]
  ])
);
export const gunner_move_attack_grenade: GameMonsterMove = {
  firstframe: FRAME_attak101,
  lastframe: FRAME_attak121,
  frame: gunner_frames_attack_grenade,
  endfunc: gunner_run
};

/**
 * Original name: gunner_attack
 * Source: Quake-2-master/game/m_gunner.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Chooses melee-range chaingun directly, otherwise randomly selects grenade or chaingun attack.
 * Porting notes: Uses `g_local.random` for the source `random()` macro.
 */
export function gunner_attack(self: GameEntity): void {
  if (self.enemy && range(self, self.enemy) === RANGE_MELEE) {
    self.monsterinfo.currentmove = gunner_move_attack_chain;
  } else if (random() <= 0.5) {
    self.monsterinfo.currentmove = gunner_move_attack_grenade;
  } else {
    self.monsterinfo.currentmove = gunner_move_attack_chain;
  }
}

export function gunner_fire_chain(self: GameEntity): void {
  self.monsterinfo.currentmove = gunner_move_fire_chain;
}

/**
 * Original name: gunner_refire_chain
 * Source: Quake-2-master/game/m_gunner.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Continues the chaingun loop when the enemy is alive, visible, and the random retry succeeds.
 * Porting notes: Uses `g_local.random` for the source `random()` macro.
 */
export function gunner_refire_chain(self: GameEntity, runtime: GameRuntime): void {
  if (self.enemy && self.enemy.health > 0 && visible(self, self.enemy, runtime) && random() <= 0.5) {
    self.monsterinfo.currentmove = gunner_move_fire_chain;
    return;
  }
  self.monsterinfo.currentmove = gunner_move_endfire_chain;
}

export function SP_monster_gunner(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  precacheGunnerAssets(runtime);

  self.movetype = MOVETYPE_STEP;
  self.solid = SOLID_BBOX;
  self.s.modelindex = registerGameModel(runtime, "models/monsters/gunner/tris.md2");
  setVec3(self.mins, -16, -16, -24);
  setVec3(self.maxs, 16, 16, 32);

  self.health = 175;
  self.gib_health = -70;
  self.mass = 200;

  self.pain = gunner_pain;
  self.die = gunner_die;

  self.monsterinfo.stand = gunner_stand;
  self.monsterinfo.walk = gunner_walk;
  self.monsterinfo.run = gunner_run;
  self.monsterinfo.dodge = gunner_dodge;
  self.monsterinfo.attack = gunner_attack;
  self.monsterinfo.melee = undefined;
  self.monsterinfo.sight = gunner_sight;
  self.monsterinfo.search = gunner_search;

  linkGameEntity(runtime, self);

  self.monsterinfo.currentmove = gunner_move_stand;
  self.monsterinfo.scale = MODEL_SCALE;

  walkmonster_start(self, runtime);
}

/**
 * Original name: N/A
 * Source: N/A (local monster frame builder)
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
 * Source: N/A (local frame callback helper)
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
function precacheGunnerAssets(runtime: GameRuntime): void {
  sound_death = registerGameSound(runtime, SOUND_DEATH);
  sound_pain = registerGameSound(runtime, SOUND_PAIN);
  sound_pain2 = registerGameSound(runtime, SOUND_PAIN2);
  sound_idle = registerGameSound(runtime, SOUND_IDLE);
  sound_open = registerGameSound(runtime, SOUND_OPEN);
  sound_search = registerGameSound(runtime, SOUND_SEARCH);
  sound_sight = registerGameSound(runtime, SOUND_SIGHT);
  registerGameSound(runtime, "gunner/gunatck2.wav");
  registerGameSound(runtime, "gunner/gunatck3.wav");
}

/**
 * Original name: N/A
 * Source: N/A (local sound options helper)
 * Category: New
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
 * Source: N/A (local monster flash adapter)
 * Category: New
 */
function gunnerFlashOffset(flashNumber: number): vec3_t {
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
function addVec3(left: vec3_t, right: vec3_t): vec3_t {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
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
function scaleVec3(vector: vec3_t, scale: number): vec3_t {
  return [vector[0] * scale, vector[1] * scale, vector[2] * scale];
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

/**
 * Original name: N/A
 * Source: N/A (local random integer helper)
 * Category: New
 */
function randomInt(maxExclusive: number): number {
  return Math.trunc(Math.random() * maxExclusive);
}
