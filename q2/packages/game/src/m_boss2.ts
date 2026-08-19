/**
 * File: m_boss2.ts
 * Source: Quake II original / game/m_boss2.h and game/m_boss2.c
 * Purpose: Port of the generated boss2 model frame constants and monster_boss2 gameplay behavior.
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
 * - This file keeps the header constants and C behavior together as the principal attachment point for `m_boss2`.
 */

import {
  AngleVectors,
  ATTN_NONE,
  CHAN_VOICE,
  type vec3_t
} from "../../qcommon/src/q_shared.js";
import { CONTENTS_LAVA, CONTENTS_MONSTER, CONTENTS_SLIME, CONTENTS_SOLID } from "../../qcommon/src/q_shared.js";
import {
  AI_STAND_GROUND,
  AS_MELEE,
  AS_MISSILE,
  AS_SLIDING,
  AS_STRAIGHT,
  DEAD_DEAD,
  DEFAULT_BULLET_HSPREAD,
  DEFAULT_BULLET_VSPREAD,
  FL_FLY,
  FL_IMMUNE_LASER,
  MOVETYPE_STEP,
  MOVETYPE_TOSS,
  RANGE_FAR,
  RANGE_MELEE,
  RANGE_MID,
  RANGE_NEAR,
  SOLID_BBOX,
  SVF_DEADMONSTER,
  damage_t,
  random
} from "./g_local.js";
import { ai_charge, ai_move, ai_run, ai_stand, ai_walk, infront, range } from "./g_ai.js";
import { flymonster_start, monster_fire_bullet, monster_fire_rocket } from "./g_monster.js";
import { G_FreeEdict, G_ProjectSource, vectoyaw } from "./g_utils.js";
import { getMonsterFlashOffset } from "./m_flash.js";
import { BossExplode } from "./m_supertank.js";
import {
  emitRegisteredGameSound,
  linkGameEntity,
  registerGameModel,
  registerGameSound,
  type GameEntity,
  type GameMonsterFrame,
  type GameMonsterMove,
  type GameRuntime
} from "./runtime.js";

export const FRAME_stand30 = 0;
export const FRAME_stand31 = 1;
export const FRAME_stand32 = 2;
export const FRAME_stand33 = 3;
export const FRAME_stand34 = 4;
export const FRAME_stand35 = 5;
export const FRAME_stand36 = 6;
export const FRAME_stand37 = 7;
export const FRAME_stand38 = 8;
export const FRAME_stand39 = 9;
export const FRAME_stand40 = 10;
export const FRAME_stand41 = 11;
export const FRAME_stand42 = 12;
export const FRAME_stand43 = 13;
export const FRAME_stand44 = 14;
export const FRAME_stand45 = 15;
export const FRAME_stand46 = 16;
export const FRAME_stand47 = 17;
export const FRAME_stand48 = 18;
export const FRAME_stand49 = 19;
export const FRAME_stand50 = 20;
export const FRAME_stand1 = 21;
export const FRAME_stand2 = 22;
export const FRAME_stand3 = 23;
export const FRAME_stand4 = 24;
export const FRAME_stand5 = 25;
export const FRAME_stand6 = 26;
export const FRAME_stand7 = 27;
export const FRAME_stand8 = 28;
export const FRAME_stand9 = 29;
export const FRAME_stand10 = 30;
export const FRAME_stand11 = 31;
export const FRAME_stand12 = 32;
export const FRAME_stand13 = 33;
export const FRAME_stand14 = 34;
export const FRAME_stand15 = 35;
export const FRAME_stand16 = 36;
export const FRAME_stand17 = 37;
export const FRAME_stand18 = 38;
export const FRAME_stand19 = 39;
export const FRAME_stand20 = 40;
export const FRAME_stand21 = 41;
export const FRAME_stand22 = 42;
export const FRAME_stand23 = 43;
export const FRAME_stand24 = 44;
export const FRAME_stand25 = 45;
export const FRAME_stand26 = 46;
export const FRAME_stand27 = 47;
export const FRAME_stand28 = 48;
export const FRAME_stand29 = 49;
export const FRAME_walk1 = 50;
export const FRAME_walk2 = 51;
export const FRAME_walk3 = 52;
export const FRAME_walk4 = 53;
export const FRAME_walk5 = 54;
export const FRAME_walk6 = 55;
export const FRAME_walk7 = 56;
export const FRAME_walk8 = 57;
export const FRAME_walk9 = 58;
export const FRAME_walk10 = 59;
export const FRAME_walk11 = 60;
export const FRAME_walk12 = 61;
export const FRAME_walk13 = 62;
export const FRAME_walk14 = 63;
export const FRAME_walk15 = 64;
export const FRAME_walk16 = 65;
export const FRAME_walk17 = 66;
export const FRAME_walk18 = 67;
export const FRAME_walk19 = 68;
export const FRAME_walk20 = 69;
export const FRAME_attack1 = 70;
export const FRAME_attack2 = 71;
export const FRAME_attack3 = 72;
export const FRAME_attack4 = 73;
export const FRAME_attack5 = 74;
export const FRAME_attack6 = 75;
export const FRAME_attack7 = 76;
export const FRAME_attack8 = 77;
export const FRAME_attack9 = 78;
export const FRAME_attack10 = 79;
export const FRAME_attack11 = 80;
export const FRAME_attack12 = 81;
export const FRAME_attack13 = 82;
export const FRAME_attack14 = 83;
export const FRAME_attack15 = 84;
export const FRAME_attack16 = 85;
export const FRAME_attack17 = 86;
export const FRAME_attack18 = 87;
export const FRAME_attack19 = 88;
export const FRAME_attack20 = 89;
export const FRAME_attack21 = 90;
export const FRAME_attack22 = 91;
export const FRAME_attack23 = 92;
export const FRAME_attack24 = 93;
export const FRAME_attack25 = 94;
export const FRAME_attack26 = 95;
export const FRAME_attack27 = 96;
export const FRAME_attack28 = 97;
export const FRAME_attack29 = 98;
export const FRAME_attack30 = 99;
export const FRAME_attack31 = 100;
export const FRAME_attack32 = 101;
export const FRAME_attack33 = 102;
export const FRAME_attack34 = 103;
export const FRAME_attack35 = 104;
export const FRAME_attack36 = 105;
export const FRAME_attack37 = 106;
export const FRAME_attack38 = 107;
export const FRAME_attack39 = 108;
export const FRAME_attack40 = 109;
export const FRAME_pain2 = 110;
export const FRAME_pain3 = 111;
export const FRAME_pain4 = 112;
export const FRAME_pain5 = 113;
export const FRAME_pain6 = 114;
export const FRAME_pain7 = 115;
export const FRAME_pain8 = 116;
export const FRAME_pain9 = 117;
export const FRAME_pain10 = 118;
export const FRAME_pain11 = 119;
export const FRAME_pain12 = 120;
export const FRAME_pain13 = 121;
export const FRAME_pain14 = 122;
export const FRAME_pain15 = 123;
export const FRAME_pain16 = 124;
export const FRAME_pain17 = 125;
export const FRAME_pain18 = 126;
export const FRAME_pain19 = 127;
export const FRAME_pain20 = 128;
export const FRAME_pain21 = 129;
export const FRAME_pain22 = 130;
export const FRAME_pain23 = 131;
export const FRAME_death2 = 132;
export const FRAME_death3 = 133;
export const FRAME_death4 = 134;
export const FRAME_death5 = 135;
export const FRAME_death6 = 136;
export const FRAME_death7 = 137;
export const FRAME_death8 = 138;
export const FRAME_death9 = 139;
export const FRAME_death10 = 140;
export const FRAME_death11 = 141;
export const FRAME_death12 = 142;
export const FRAME_death13 = 143;
export const FRAME_death14 = 144;
export const FRAME_death15 = 145;
export const FRAME_death16 = 146;
export const FRAME_death17 = 147;
export const FRAME_death18 = 148;
export const FRAME_death19 = 149;
export const FRAME_death20 = 150;
export const FRAME_death21 = 151;
export const FRAME_death22 = 152;
export const FRAME_death23 = 153;
export const FRAME_death24 = 154;
export const FRAME_death25 = 155;
export const FRAME_death26 = 156;
export const FRAME_death27 = 157;
export const FRAME_death28 = 158;
export const FRAME_death29 = 159;
export const FRAME_death30 = 160;
export const FRAME_death31 = 161;
export const FRAME_death32 = 162;
export const FRAME_death33 = 163;
export const FRAME_death34 = 164;
export const FRAME_death35 = 165;
export const FRAME_death36 = 166;
export const FRAME_death37 = 167;
export const FRAME_death38 = 168;
export const FRAME_death39 = 169;
export const FRAME_death40 = 170;
export const FRAME_death41 = 171;
export const FRAME_death42 = 172;
export const FRAME_death43 = 173;
export const FRAME_death44 = 174;
export const FRAME_death45 = 175;
export const FRAME_death46 = 176;
export const FRAME_death47 = 177;
export const FRAME_death48 = 178;
export const FRAME_death49 = 179;
export const FRAME_death50 = 180;

export const MODEL_SCALE = 1.0;

export const MZ2_BOSS2_MACHINEGUN_L1 = 73;
export const MZ2_BOSS2_MACHINEGUN_L2 = 74;
export const MZ2_BOSS2_MACHINEGUN_L3 = 75;
export const MZ2_BOSS2_MACHINEGUN_L4 = 76;
export const MZ2_BOSS2_MACHINEGUN_L5 = 77;
export const MZ2_BOSS2_ROCKET_1 = 78;
export const MZ2_BOSS2_ROCKET_2 = 79;
export const MZ2_BOSS2_ROCKET_3 = 80;
export const MZ2_BOSS2_ROCKET_4 = 81;
export const MZ2_BOSS2_MACHINEGUN_R1 = 133;
export const MZ2_BOSS2_MACHINEGUN_R2 = 134;
export const MZ2_BOSS2_MACHINEGUN_R3 = 135;
export const MZ2_BOSS2_MACHINEGUN_R4 = 136;
export const MZ2_BOSS2_MACHINEGUN_R5 = 137;

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Name the boss2 check-attack trace mask assembled inline in the C source.
 */
const BOSS2_ATTACK_TRACE_MASK = CONTENTS_SOLID | CONTENTS_MONSTER | CONTENTS_SLIME | CONTENTS_LAVA;
const SOUND_PAIN1 = "bosshovr/bhvpain1.wav";
const SOUND_PAIN2 = "bosshovr/bhvpain2.wav";
const SOUND_PAIN3 = "bosshovr/bhvpain3.wav";
const SOUND_DEATH = "bosshovr/bhvdeth1.wav";
const SOUND_SEARCH1 = "bosshovr/bhvunqv1.wav";
/**
 * Original name: N/A
 * Source: N/A (asset path constant)
 * Category: New
 * Purpose: Name the boss2 engine loop path registered by `SP_monster_boss2`.
 */
const SOUND_ENGINE = "bosshovr/bhvengn1.wav";

/**
 * Original name: N/A
 * Source: N/A (runtime sound handle cache)
 * Category: New
 * Purpose: Cache the registered runtime handle for `SOUND_PAIN1`.
 */
let sound_pain1 = 0;
/**
 * Original name: N/A
 * Source: N/A (runtime sound handle cache)
 * Category: New
 * Purpose: Cache the registered runtime handle for `SOUND_PAIN2`.
 */
let sound_pain2 = 0;
/**
 * Original name: N/A
 * Source: N/A (runtime sound handle cache)
 * Category: New
 * Purpose: Cache the registered runtime handle for `SOUND_PAIN3`.
 */
let sound_pain3 = 0;
/**
 * Original name: N/A
 * Source: N/A (runtime sound handle cache)
 * Category: New
 * Purpose: Cache the registered runtime handle for `SOUND_DEATH`.
 */
let sound_death = 0;
/**
 * Original name: N/A
 * Source: N/A (runtime sound handle cache)
 * Category: New
 * Purpose: Cache the registered runtime handle for `SOUND_SEARCH1`.
 */
let sound_search1 = 0;

/**
 * Original name: boss2_search
 * Source: Quake-2-master/game/m_boss2.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Randomly plays the boss2 search voice on the same 50 percent branch as the original.
 */
export function boss2_search(self: GameEntity, runtime: GameRuntime): void {
  if (random() < 0.5) {
    emitRegisteredGameSound(runtime, self, sound_search1, SOUND_SEARCH1, soundOptions(CHAN_VOICE, ATTN_NONE));
  }
}

/**
 * Original name: Boss2Rocket
 * Source: Quake-2-master/game/m_boss2.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Fires the four boss2 rockets from the original muzzle offsets toward the enemy view origin.
 *
 * Porting notes:
 * - Uses a local helper to avoid duplicating the four identical C blocks while preserving their flash ids.
 */
export function Boss2Rocket(self: GameEntity, runtime: GameRuntime): void {
  if (!self.enemy) {
    return;
  }

  const { forward, right } = AngleVectors(self.s.angles);
  fireBoss2Rocket(self, MZ2_BOSS2_ROCKET_1, forward, right, runtime);
  fireBoss2Rocket(self, MZ2_BOSS2_ROCKET_2, forward, right, runtime);
  fireBoss2Rocket(self, MZ2_BOSS2_ROCKET_3, forward, right, runtime);
  fireBoss2Rocket(self, MZ2_BOSS2_ROCKET_4, forward, right, runtime);
}

/**
 * Original name: boss2_firebullet_right
 * Source: Quake-2-master/game/m_boss2.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Fires one right-side boss2 machinegun bullet using the original R1 muzzle offset.
 */
export function boss2_firebullet_right(self: GameEntity, runtime: GameRuntime): void {
  fireBoss2Machinegun(self, MZ2_BOSS2_MACHINEGUN_R1, runtime);
}

/**
 * Original name: boss2_firebullet_left
 * Source: Quake-2-master/game/m_boss2.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Fires one left-side boss2 machinegun bullet using the original L1 muzzle offset.
 */
export function boss2_firebullet_left(self: GameEntity, runtime: GameRuntime): void {
  fireBoss2Machinegun(self, MZ2_BOSS2_MACHINEGUN_L1, runtime);
}

/**
 * Original name: Boss2MachineGun
 * Source: Quake-2-master/game/m_boss2.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Preserves the compiled C path: fire the left machinegun bullet, then the right one.
 *
 * Porting notes:
 * - The inactive commented-out single-flash C block is intentionally not implemented.
 */
export function Boss2MachineGun(self: GameEntity, runtime: GameRuntime): void {
  boss2_firebullet_left(self, runtime);
  boss2_firebullet_right(self, runtime);
}

export const boss2_frames_stand = makeFrames(ai_stand, new Array<number>(21).fill(0));
export const boss2_move_stand: GameMonsterMove = {
  firstframe: FRAME_stand30,
  lastframe: FRAME_stand50,
  frame: boss2_frames_stand,
  endfunc: undefined
};

export const boss2_frames_fidget = makeFrames(ai_stand, new Array<number>(30).fill(0));
export const boss2_move_fidget: GameMonsterMove = {
  firstframe: FRAME_stand1,
  lastframe: FRAME_stand30,
  frame: boss2_frames_fidget,
  endfunc: undefined
};

export const boss2_frames_walk = makeFrames(ai_walk, new Array<number>(20).fill(8));
export const boss2_move_walk: GameMonsterMove = {
  firstframe: FRAME_walk1,
  lastframe: FRAME_walk20,
  frame: boss2_frames_walk,
  endfunc: undefined
};

export const boss2_frames_run = makeFrames(ai_run, new Array<number>(20).fill(8));
export const boss2_move_run: GameMonsterMove = {
  firstframe: FRAME_walk1,
  lastframe: FRAME_walk20,
  frame: boss2_frames_run,
  endfunc: undefined
};

export const boss2_frames_attack_pre_mg = makeFrames(
  ai_charge,
  new Array<number>(9).fill(1),
  indexedThinks(9, [[8, boss2_attack_mg]])
);
export const boss2_move_attack_pre_mg: GameMonsterMove = {
  firstframe: FRAME_attack1,
  lastframe: FRAME_attack9,
  frame: boss2_frames_attack_pre_mg,
  endfunc: undefined
};

export const boss2_frames_attack_mg = makeFrames(
  ai_charge,
  new Array<number>(6).fill(1),
  [Boss2MachineGun, Boss2MachineGun, Boss2MachineGun, Boss2MachineGun, Boss2MachineGun, boss2_reattack_mg]
);
export const boss2_move_attack_mg: GameMonsterMove = {
  firstframe: FRAME_attack10,
  lastframe: FRAME_attack15,
  frame: boss2_frames_attack_mg,
  endfunc: undefined
};

export const boss2_frames_attack_post_mg = makeFrames(ai_charge, new Array<number>(4).fill(1));
export const boss2_move_attack_post_mg: GameMonsterMove = {
  firstframe: FRAME_attack16,
  lastframe: FRAME_attack19,
  frame: boss2_frames_attack_post_mg,
  endfunc: boss2_run
};

export const boss2_frames_attack_rocket = makeIndexedFrames(
  (index) => (index === 12 ? ai_move : ai_charge),
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -20, 1, 1, 1, 1, 1, 1, 1, 1],
  indexedThinks(21, [[12, Boss2Rocket]])
);
export const boss2_move_attack_rocket: GameMonsterMove = {
  firstframe: FRAME_attack20,
  lastframe: FRAME_attack40,
  frame: boss2_frames_attack_rocket,
  endfunc: boss2_run
};

export const boss2_frames_pain_heavy = makeFrames(ai_move, new Array<number>(18).fill(0));
export const boss2_move_pain_heavy: GameMonsterMove = {
  firstframe: FRAME_pain2,
  lastframe: FRAME_pain19,
  frame: boss2_frames_pain_heavy,
  endfunc: boss2_run
};

export const boss2_frames_pain_light = makeFrames(ai_move, new Array<number>(4).fill(0));
export const boss2_move_pain_light: GameMonsterMove = {
  firstframe: FRAME_pain20,
  lastframe: FRAME_pain23,
  frame: boss2_frames_pain_light,
  endfunc: boss2_run
};

export const boss2_frames_death = makeFrames(
  ai_move,
  new Array<number>(49).fill(0),
  indexedThinks(49, [[48, BossExplode]])
);
export const boss2_move_death: GameMonsterMove = {
  firstframe: FRAME_death2,
  lastframe: FRAME_death50,
  frame: boss2_frames_death,
  endfunc: boss2_dead
};

/**
 * Original name: boss2_stand
 * Source: Quake-2-master/game/m_boss2.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Restores the boss2 standing move.
 */
export function boss2_stand(self: GameEntity): void {
  self.monsterinfo.currentmove = boss2_move_stand;
}

/**
 * Original name: boss2_run
 * Source: Quake-2-master/game/m_boss2.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Selects the standing move when `AI_STAND_GROUND` is set, otherwise selects the running move.
 */
export function boss2_run(self: GameEntity): void {
  if ((self.monsterinfo.aiflags & AI_STAND_GROUND) !== 0) {
    self.monsterinfo.currentmove = boss2_move_stand;
  } else {
    self.monsterinfo.currentmove = boss2_move_run;
  }
}

/**
 * Original name: boss2_walk
 * Source: Quake-2-master/game/m_boss2.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Selects the boss2 walking move.
 */
export function boss2_walk(self: GameEntity): void {
  self.monsterinfo.currentmove = boss2_move_walk;
}

/**
 * Original name: boss2_attack
 * Source: Quake-2-master/game/m_boss2.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Chooses the machinegun windup at close range or on the original 60 percent random branch.
 * - Chooses the rocket attack only for farther targets when the random branch misses.
 *
 * Porting notes:
 * - Keeps a defensive missing-enemy guard; normal runtime reaches this through monster AI with an enemy.
 */
export function boss2_attack(self: GameEntity): void {
  if (!self.enemy) {
    return;
  }

  const distance = lengthVec3(subtractVec3(self.enemy.s.origin, self.s.origin));
  if (distance <= 125 || random() <= 0.6) {
    self.monsterinfo.currentmove = boss2_move_attack_pre_mg;
  } else {
    self.monsterinfo.currentmove = boss2_move_attack_rocket;
  }
}

/**
 * Original name: boss2_attack_mg
 * Source: Quake-2-master/game/m_boss2.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Enters the looping boss2 machinegun move.
 */
export function boss2_attack_mg(self: GameEntity): void {
  self.monsterinfo.currentmove = boss2_move_attack_mg;
}

/**
 * Original name: boss2_reattack_mg
 * Source: Quake-2-master/game/m_boss2.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Continues the machinegun loop only when the enemy remains in front and the original 70 percent random branch succeeds.
 * - Otherwise exits through the post-machinegun move.
 *
 * Porting notes:
 * - Keeps a defensive missing-enemy guard; normal runtime reaches this through monster AI with an enemy.
 */
export function boss2_reattack_mg(self: GameEntity): void {
  if (self.enemy && infront(self, self.enemy) && random() <= 0.7) {
    self.monsterinfo.currentmove = boss2_move_attack_mg;
  } else {
    self.monsterinfo.currentmove = boss2_move_attack_post_mg;
  }
}

/**
 * Original name: boss2_pain
 * Source: Quake-2-master/game/m_boss2.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Switches to the damaged skin below half health, debounces pain for three seconds, and selects the
 *   original light/heavy pain moves and no-attenuation pain sounds by damage threshold.
 *
 * Porting notes:
 * - Unlike most Quake II monster pain callbacks, the original boss2 code has no nightmare-skill animation skip.
 */
export function boss2_pain(
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
  if (damage < 10) {
    emitRegisteredGameSound(runtime, self, sound_pain3, SOUND_PAIN3, soundOptions(CHAN_VOICE, ATTN_NONE));
    self.monsterinfo.currentmove = boss2_move_pain_light;
  } else if (damage < 30) {
    emitRegisteredGameSound(runtime, self, sound_pain1, SOUND_PAIN1, soundOptions(CHAN_VOICE, ATTN_NONE));
    self.monsterinfo.currentmove = boss2_move_pain_light;
  } else {
    emitRegisteredGameSound(runtime, self, sound_pain2, SOUND_PAIN2, soundOptions(CHAN_VOICE, ATTN_NONE));
    self.monsterinfo.currentmove = boss2_move_pain_heavy;
  }
}

/**
 * Original name: boss2_dead
 * Source: Quake-2-master/game/m_boss2.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Finalizes the boss2 corpse bounds, toss movement, dead-monster flag and relink state.
 */
export function boss2_dead(self: GameEntity, runtime: GameRuntime): void {
  setVec3(self.mins, -56, -56, 0);
  setVec3(self.maxs, 56, 56, 80);
  self.movetype = MOVETYPE_TOSS;
  self.svflags |= SVF_DEADMONSTER;
  self.nextthink = 0;
  linkGameEntity(runtime, self);
}

/**
 * Original name: boss2_die
 * Source: Quake-2-master/game/m_boss2.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Plays the death sound, locks the boss2 into dead/no-damage state and starts the death move.
 */
export function boss2_die(
  self: GameEntity,
  _inflictor: GameEntity | null,
  _attacker: GameEntity | null,
  _damage: number,
  runtime: GameRuntime
): void {
  emitRegisteredGameSound(runtime, self, sound_death, SOUND_DEATH, soundOptions(CHAN_VOICE, ATTN_NONE));
  self.deadflag = DEAD_DEAD;
  self.takedamage = damage_t.DAMAGE_NO;
  self.count = 0;
  self.monsterinfo.currentmove = boss2_move_death;
}

/**
 * Original name: Boss2_CheckAttack
 * Source: Quake-2-master/game/m_boss2.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Checks the clear shot trace, updates ideal yaw, then selects melee or missile attack state using the
 *   boss2-specific 0.8 near/mid missile chance and flying slide fallback.
 *
 * Porting notes:
 * - Uses the shared `g_local.random()` helper for the original C `random()` macro.
 * - The C local `enemy_infront` is assigned but not consumed by the compiled function; the port preserves
 *   the resulting behavior without keeping an unused local.
 */
export function Boss2_CheckAttack(self: GameEntity, runtime: GameRuntime): boolean {
  if (!self.enemy) {
    return false;
  }

  if (self.enemy.health > 0) {
    const spot1: vec3_t = [...self.s.origin];
    spot1[2] += self.viewheight;
    const spot2: vec3_t = [...self.enemy.s.origin];
    spot2[2] += self.enemy.viewheight;

    const tr = runtime.collision?.trace(spot1, [0, 0, 0], [0, 0, 0], spot2, self, BOSS2_ATTACK_TRACE_MASK);
    if (!tr) {
      return false;
    }
    if (tr.ent !== self.enemy) {
      return false;
    }
  }

  const enemy_range = range(self, self.enemy);
  const temp = subtractVec3(self.enemy.s.origin, self.s.origin);
  self.ideal_yaw = vectoyaw(temp);

  if (enemy_range === RANGE_MELEE) {
    self.monsterinfo.attack_state = self.monsterinfo.melee ? AS_MELEE : AS_MISSILE;
    return true;
  }

  if (!self.monsterinfo.attack) {
    return false;
  }

  if (runtime.time < self.monsterinfo.attack_finished) {
    return false;
  }

  if (enemy_range === RANGE_FAR) {
    return false;
  }

  let chance: number;
  if ((self.monsterinfo.aiflags & AI_STAND_GROUND) !== 0) {
    chance = 0.4;
  } else if (enemy_range === RANGE_MELEE) {
    chance = 0.8;
  } else if (enemy_range === RANGE_NEAR) {
    chance = 0.8;
  } else if (enemy_range === RANGE_MID) {
    chance = 0.8;
  } else {
    return false;
  }

  if (random() < chance) {
    self.monsterinfo.attack_state = AS_MISSILE;
    self.monsterinfo.attack_finished = runtime.time + 2 * random();
    return true;
  }

  if ((self.flags & FL_FLY) !== 0) {
    self.monsterinfo.attack_state = random() < 0.3 ? AS_SLIDING : AS_STRAIGHT;
  }

  return false;
}

/**
 * Original name: SP_monster_boss2
 * Source: Quake-2-master/game/m_boss2.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns monster_boss2, precaches assets and initializes flying monster callbacks.
 */
export function SP_monster_boss2(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  precacheBoss2Assets(runtime);

  self.s.sound = registerGameSound(runtime, SOUND_ENGINE);
  self.movetype = MOVETYPE_STEP;
  self.solid = SOLID_BBOX;
  self.s.modelindex = registerGameModel(runtime, "models/monsters/boss2/tris.md2");
  setVec3(self.mins, -56, -56, 0);
  setVec3(self.maxs, 56, 56, 80);

  self.health = 2000;
  self.gib_health = -200;
  self.mass = 1000;
  self.flags |= FL_IMMUNE_LASER;

  self.pain = boss2_pain;
  self.die = boss2_die;
  self.monsterinfo.stand = boss2_stand;
  self.monsterinfo.walk = boss2_walk;
  self.monsterinfo.run = boss2_run;
  self.monsterinfo.dodge = undefined;
  self.monsterinfo.attack = boss2_attack;
  self.monsterinfo.melee = undefined;
  self.monsterinfo.sight = undefined;
  self.monsterinfo.search = boss2_search;
  self.monsterinfo.checkattack = Boss2_CheckAttack;

  linkGameEntity(runtime, self);

  self.monsterinfo.currentmove = boss2_move_stand;
  self.monsterinfo.scale = MODEL_SCALE;

  flymonster_start(self, runtime);
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Build `mframe_t`-equivalent rows from compact declarative arrays.
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
 * Purpose: Build frame rows when the AI callback varies by frame index.
 */
function makeIndexedFrames(
  aifunc: (index: number) => GameMonsterFrame["aifunc"],
  distances: number[],
  thinks: GameMonsterFrame["thinkfunc"][] = []
): GameMonsterFrame[] {
  return distances.map((dist, index) => ({
    aifunc: aifunc(index),
    dist,
    thinkfunc: thinks[index]
  }));
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Place sparse think callbacks at their original frame indexes.
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
 * Purpose: Keep the spawn precache order aligned with `SP_monster_boss2`.
 */
function precacheBoss2Assets(runtime: GameRuntime): void {
  sound_pain1 = registerGameSound(runtime, SOUND_PAIN1);
  sound_pain2 = registerGameSound(runtime, SOUND_PAIN2);
  sound_pain3 = registerGameSound(runtime, SOUND_PAIN3);
  sound_death = registerGameSound(runtime, SOUND_DEATH);
  sound_search1 = registerGameSound(runtime, SOUND_SEARCH1);
}

/**
 * Original name: N/A
 * Source: N/A (local adapter)
 * Category: Adapter
 * Purpose: Share the four identical `Boss2Rocket` fire blocks while preserving source muzzle ids and projectile parameters.
 */
function fireBoss2Rocket(
  self: GameEntity,
  flashNumber: number,
  forward: vec3_t,
  right: vec3_t,
  runtime: GameRuntime
): void {
  if (!self.enemy) {
    return;
  }

  const start = G_ProjectSource(self.s.origin, boss2FlashOffset(flashNumber), forward, right);
  const vec: vec3_t = [...self.enemy.s.origin];
  vec[2] += self.enemy.viewheight;
  const dir = normalizeVec3(subtractVec3(vec, start));
  monster_fire_rocket(self, start, dir, 50, 500, flashNumber, runtime);
}

/**
 * Original name: N/A
 * Source: N/A (local adapter)
 * Category: Adapter
 * Purpose: Share the duplicated boss2 left/right machinegun C blocks without changing their muzzle ids or shot parameters.
 *
 * Constraints:
 * - Must keep the original `VectorMA(enemy->s.origin, -0.2, enemy->velocity)` lead and 6/4 bullet damage/kick.
 */
function fireBoss2Machinegun(self: GameEntity, flashNumber: number, runtime: GameRuntime): void {
  if (!self.enemy) {
    return;
  }

  const { forward, right } = AngleVectors(self.s.angles);
  const start = G_ProjectSource(self.s.origin, boss2FlashOffset(flashNumber), forward, right);
  const target = vectorMA(self.enemy.s.origin, -0.2, self.enemy.velocity);
  target[2] += self.enemy.viewheight;
  const aim = normalizeVec3(subtractVec3(target, start));

  monster_fire_bullet(
    self,
    start,
    aim,
    6,
    4,
    DEFAULT_BULLET_HSPREAD,
    DEFAULT_BULLET_VSPREAD,
    flashNumber,
    runtime
  );
}

/**
 * Original name: N/A
 * Source: N/A (runtime sound adapter)
 * Category: New
 * Purpose: Convert C `gi.sound` parameters into the runtime sound event option object.
 */
function soundOptions(channel: number, attenuation: number): { channel: number; volume: number; attenuation: number; timeofs: number } {
  return {
    channel,
    volume: 1,
    attenuation,
    timeofs: 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (local adapter)
 * Category: Adapter
 * Purpose: Read boss2 muzzle offsets from the shared `monster_flash_offset` port without owning that table.
 */
function boss2FlashOffset(flashNumber: number): vec3_t {
  return getMonsterFlashOffset(flashNumber);
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Local `VectorSet` equivalent for mutable entity bounds.
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
 * Purpose: Local `VectorSubtract` equivalent for boss2 calculations.
 */
function subtractVec3(left: vec3_t, right: vec3_t): vec3_t {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Local `VectorMA` equivalent used by boss2 machinegun lead.
 */
function vectorMA(veca: vec3_t, scale: number, vecb: vec3_t): vec3_t {
  return [veca[0] + scale * vecb[0], veca[1] + scale * vecb[1], veca[2] + scale * vecb[2]];
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Local `VectorNormalize` equivalent returning a new vector.
 */
function normalizeVec3(vector: vec3_t): vec3_t {
  const length = lengthVec3(vector);
  if (length === 0) {
    return [0, 0, 0];
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Local `VectorLength` equivalent for boss2 attack distance checks.
 */
function lengthVec3(vector: vec3_t): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}
