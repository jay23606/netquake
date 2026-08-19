/**
 * File: m_hover.ts
 * Source: Quake II original / game/m_hover.h and game/m_hover.c
 * Purpose: Port of the generated hover model frame constants and monster_hover gameplay behavior.
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
 * - This file keeps the header constants and C behavior together as the principal attachment point for `m_hover`.
 */

import { AngleVectors, ATTN_NORM, CHAN_VOICE, EF_HYPERBLASTER, type vec3_t } from "../../qcommon/src/index.js";
import {
  AI_STAND_GROUND,
  DEAD_DEAD,
  FRAMETIME,
  GIB_ORGANIC,
  MOVETYPE_STEP,
  MOVETYPE_TOSS,
  SOLID_BBOX,
  damage_t,
  random
} from "./g_local.js";
import { ai_charge, ai_move, ai_run, ai_stand, ai_walk, visible } from "./g_ai.js";
import { flymonster_start, monster_fire_blaster } from "./g_monster.js";
import { BecomeExplosion1, ThrowGib, ThrowHead } from "./g_misc.js";
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
export const FRAME_forwrd01 = 30;
export const FRAME_forwrd02 = 31;
export const FRAME_forwrd03 = 32;
export const FRAME_forwrd04 = 33;
export const FRAME_forwrd05 = 34;
export const FRAME_forwrd06 = 35;
export const FRAME_forwrd07 = 36;
export const FRAME_forwrd08 = 37;
export const FRAME_forwrd09 = 38;
export const FRAME_forwrd10 = 39;
export const FRAME_forwrd11 = 40;
export const FRAME_forwrd12 = 41;
export const FRAME_forwrd13 = 42;
export const FRAME_forwrd14 = 43;
export const FRAME_forwrd15 = 44;
export const FRAME_forwrd16 = 45;
export const FRAME_forwrd17 = 46;
export const FRAME_forwrd18 = 47;
export const FRAME_forwrd19 = 48;
export const FRAME_forwrd20 = 49;
export const FRAME_forwrd21 = 50;
export const FRAME_forwrd22 = 51;
export const FRAME_forwrd23 = 52;
export const FRAME_forwrd24 = 53;
export const FRAME_forwrd25 = 54;
export const FRAME_forwrd26 = 55;
export const FRAME_forwrd27 = 56;
export const FRAME_forwrd28 = 57;
export const FRAME_forwrd29 = 58;
export const FRAME_forwrd30 = 59;
export const FRAME_forwrd31 = 60;
export const FRAME_forwrd32 = 61;
export const FRAME_forwrd33 = 62;
export const FRAME_forwrd34 = 63;
export const FRAME_forwrd35 = 64;
export const FRAME_stop101 = 65;
export const FRAME_stop102 = 66;
export const FRAME_stop103 = 67;
export const FRAME_stop104 = 68;
export const FRAME_stop105 = 69;
export const FRAME_stop106 = 70;
export const FRAME_stop107 = 71;
export const FRAME_stop108 = 72;
export const FRAME_stop109 = 73;
export const FRAME_stop201 = 74;
export const FRAME_stop202 = 75;
export const FRAME_stop203 = 76;
export const FRAME_stop204 = 77;
export const FRAME_stop205 = 78;
export const FRAME_stop206 = 79;
export const FRAME_stop207 = 80;
export const FRAME_stop208 = 81;
export const FRAME_takeof01 = 82;
export const FRAME_takeof02 = 83;
export const FRAME_takeof03 = 84;
export const FRAME_takeof04 = 85;
export const FRAME_takeof05 = 86;
export const FRAME_takeof06 = 87;
export const FRAME_takeof07 = 88;
export const FRAME_takeof08 = 89;
export const FRAME_takeof09 = 90;
export const FRAME_takeof10 = 91;
export const FRAME_takeof11 = 92;
export const FRAME_takeof12 = 93;
export const FRAME_takeof13 = 94;
export const FRAME_takeof14 = 95;
export const FRAME_takeof15 = 96;
export const FRAME_takeof16 = 97;
export const FRAME_takeof17 = 98;
export const FRAME_takeof18 = 99;
export const FRAME_takeof19 = 100;
export const FRAME_takeof20 = 101;
export const FRAME_takeof21 = 102;
export const FRAME_takeof22 = 103;
export const FRAME_takeof23 = 104;
export const FRAME_takeof24 = 105;
export const FRAME_takeof25 = 106;
export const FRAME_takeof26 = 107;
export const FRAME_takeof27 = 108;
export const FRAME_takeof28 = 109;
export const FRAME_takeof29 = 110;
export const FRAME_takeof30 = 111;
export const FRAME_land01 = 112;
export const FRAME_pain101 = 113;
export const FRAME_pain102 = 114;
export const FRAME_pain103 = 115;
export const FRAME_pain104 = 116;
export const FRAME_pain105 = 117;
export const FRAME_pain106 = 118;
export const FRAME_pain107 = 119;
export const FRAME_pain108 = 120;
export const FRAME_pain109 = 121;
export const FRAME_pain110 = 122;
export const FRAME_pain111 = 123;
export const FRAME_pain112 = 124;
export const FRAME_pain113 = 125;
export const FRAME_pain114 = 126;
export const FRAME_pain115 = 127;
export const FRAME_pain116 = 128;
export const FRAME_pain117 = 129;
export const FRAME_pain118 = 130;
export const FRAME_pain119 = 131;
export const FRAME_pain120 = 132;
export const FRAME_pain121 = 133;
export const FRAME_pain122 = 134;
export const FRAME_pain123 = 135;
export const FRAME_pain124 = 136;
export const FRAME_pain125 = 137;
export const FRAME_pain126 = 138;
export const FRAME_pain127 = 139;
export const FRAME_pain128 = 140;
export const FRAME_pain201 = 141;
export const FRAME_pain202 = 142;
export const FRAME_pain203 = 143;
export const FRAME_pain204 = 144;
export const FRAME_pain205 = 145;
export const FRAME_pain206 = 146;
export const FRAME_pain207 = 147;
export const FRAME_pain208 = 148;
export const FRAME_pain209 = 149;
export const FRAME_pain210 = 150;
export const FRAME_pain211 = 151;
export const FRAME_pain212 = 152;
export const FRAME_pain301 = 153;
export const FRAME_pain302 = 154;
export const FRAME_pain303 = 155;
export const FRAME_pain304 = 156;
export const FRAME_pain305 = 157;
export const FRAME_pain306 = 158;
export const FRAME_pain307 = 159;
export const FRAME_pain308 = 160;
export const FRAME_pain309 = 161;
export const FRAME_death101 = 162;
export const FRAME_death102 = 163;
export const FRAME_death103 = 164;
export const FRAME_death104 = 165;
export const FRAME_death105 = 166;
export const FRAME_death106 = 167;
export const FRAME_death107 = 168;
export const FRAME_death108 = 169;
export const FRAME_death109 = 170;
export const FRAME_death110 = 171;
export const FRAME_death111 = 172;
export const FRAME_backwd01 = 173;
export const FRAME_backwd02 = 174;
export const FRAME_backwd03 = 175;
export const FRAME_backwd04 = 176;
export const FRAME_backwd05 = 177;
export const FRAME_backwd06 = 178;
export const FRAME_backwd07 = 179;
export const FRAME_backwd08 = 180;
export const FRAME_backwd09 = 181;
export const FRAME_backwd10 = 182;
export const FRAME_backwd11 = 183;
export const FRAME_backwd12 = 184;
export const FRAME_backwd13 = 185;
export const FRAME_backwd14 = 186;
export const FRAME_backwd15 = 187;
export const FRAME_backwd16 = 188;
export const FRAME_backwd17 = 189;
export const FRAME_backwd18 = 190;
export const FRAME_backwd19 = 191;
export const FRAME_backwd20 = 192;
export const FRAME_backwd21 = 193;
export const FRAME_backwd22 = 194;
export const FRAME_backwd23 = 195;
export const FRAME_backwd24 = 196;
export const FRAME_attak101 = 197;
export const FRAME_attak102 = 198;
export const FRAME_attak103 = 199;
export const FRAME_attak104 = 200;
export const FRAME_attak105 = 201;
export const FRAME_attak106 = 202;
export const FRAME_attak107 = 203;
export const FRAME_attak108 = 204;

export const MODEL_SCALE = 1.0;

/**
 * Symbols: MZ2_HOVER_BLASTER_1
 * Original name: N/A
 * Source: N/A (local muzzle flash alias)
 * Source declaree: N/A (local muzzle flash alias)
 * Category: New
 * Purpose: Keep the hover-specific flash id close to the monster code while using the shared flash table.
 */
export const MZ2_HOVER_BLASTER_1 = 62;

const SOUND_PAIN1 = "hover/hovpain1.wav";
const SOUND_PAIN2 = "hover/hovpain2.wav";
const SOUND_DEATH1 = "hover/hovdeth1.wav";
const SOUND_DEATH2 = "hover/hovdeth2.wav";
const SOUND_SIGHT = "hover/hovsght1.wav";
const SOUND_SEARCH1 = "hover/hovsrch1.wav";
const SOUND_SEARCH2 = "hover/hovsrch2.wav";

/**
 * Symbols: SOUND_ATTACK, SOUND_IDLE
 * Original name: N/A
 * Source: N/A (local asset path constants)
 * Source declaree: N/A (local asset path constants)
 * Category: New
 * Purpose: Name source string literals that are precached or assigned during hover spawn setup.
 */
const SOUND_ATTACK = "hover/hovatck1.wav";
const SOUND_IDLE = "hover/hovidle1.wav";

/**
 * Symbols: sound_pain1, sound_pain2, sound_death1, sound_death2, sound_sight, sound_search1, sound_search2
 * Original name: N/A
 * Source: N/A (runtime sound cache handles)
 * Source declaree: N/A (runtime sound cache handles)
 * Category: New
 * Purpose: Store registered sound IDs for the runtime sound adapter.
 */
let sound_pain1 = 0;
let sound_pain2 = 0;
let sound_death1 = 0;
let sound_death2 = 0;
let sound_sight = 0;
let sound_search1 = 0;
let sound_search2 = 0;

/**
 * Original name: hover_sight
 * Source: game/m_hover.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Plays the hover sight sound on target acquisition.
 */
export function hover_sight(self: GameEntity, _other: GameEntity | null, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_sight, SOUND_SIGHT, {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
}

/**
 * Original name: hover_search
 * Source: game/m_hover.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Randomly plays one of the two hover search sounds.
 *
 * Porting notes:
 * - Uses `g_local.random()` to preserve the source macro's 15-bit bucket behavior.
 */
export function hover_search(self: GameEntity, runtime: GameRuntime): void {
  const soundIndex = random() < 0.5 ? sound_search1 : sound_search2;
  const soundPath = soundIndex === sound_search1 ? SOUND_SEARCH1 : SOUND_SEARCH2;
  emitRegisteredGameSound(runtime, self, soundIndex, soundPath, {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
}

const hover_frames_stand = makeFrames(ai_stand, new Array<number>(30).fill(0));
export const hover_move_stand: GameMonsterMove = {
  firstframe: FRAME_stand01,
  lastframe: FRAME_stand30,
  frame: hover_frames_stand,
  endfunc: undefined
};

const hover_frames_stop1 = makeFrames(ai_move, new Array<number>(9).fill(0));
export const hover_move_stop1: GameMonsterMove = {
  firstframe: FRAME_stop101,
  lastframe: FRAME_stop109,
  frame: hover_frames_stop1,
  endfunc: undefined
};

const hover_frames_stop2 = makeFrames(ai_move, new Array<number>(8).fill(0));
export const hover_move_stop2: GameMonsterMove = {
  firstframe: FRAME_stop201,
  lastframe: FRAME_stop208,
  frame: hover_frames_stop2,
  endfunc: undefined
};

const hover_frames_takeoff = makeFrames(ai_move, [
  0, -2, 5, -1, 1, 0, 0, -1, -1, -1,
  0, 2, 2, 1, 1, -6, -9, 1, 0, 2,
  2, 1, 1, 1, 2, 0, 2, 3, 2, 0
]);
export const hover_move_takeoff: GameMonsterMove = {
  firstframe: FRAME_takeof01,
  lastframe: FRAME_takeof30,
  frame: hover_frames_takeoff,
  endfunc: undefined
};

const hover_frames_pain3 = makeFrames(ai_move, new Array<number>(9).fill(0));
export const hover_move_pain3: GameMonsterMove = {
  firstframe: FRAME_pain301,
  lastframe: FRAME_pain309,
  frame: hover_frames_pain3,
  endfunc: hover_run
};

const hover_frames_pain2 = makeFrames(ai_move, new Array<number>(12).fill(0));
export const hover_move_pain2: GameMonsterMove = {
  firstframe: FRAME_pain201,
  lastframe: FRAME_pain212,
  frame: hover_frames_pain2,
  endfunc: hover_run
};

const hover_frames_pain1 = makeFrames(ai_move, [
  0, 0, 2, -8, -4, -6, -4, -3, 1, 0, 0, 0, 3, 1,
  0, 2, 3, 2, 7, 1, 0, 0, 2, 0, 0, 5, 3, 4
]);
export const hover_move_pain1: GameMonsterMove = {
  firstframe: FRAME_pain101,
  lastframe: FRAME_pain128,
  frame: hover_frames_pain1,
  endfunc: hover_run
};

const hover_frames_land = makeFrames(ai_move, [0]);
export const hover_move_land: GameMonsterMove = {
  firstframe: FRAME_land01,
  lastframe: FRAME_land01,
  frame: hover_frames_land,
  endfunc: undefined
};

const hover_frames_forward = makeFrames(ai_move, new Array<number>(35).fill(0));
export const hover_move_forward: GameMonsterMove = {
  firstframe: FRAME_forwrd01,
  lastframe: FRAME_forwrd35,
  frame: hover_frames_forward,
  endfunc: undefined
};

const hover_frames_walk = makeFrames(ai_walk, new Array<number>(35).fill(4));
export const hover_move_walk: GameMonsterMove = {
  firstframe: FRAME_forwrd01,
  lastframe: FRAME_forwrd35,
  frame: hover_frames_walk,
  endfunc: undefined
};

const hover_frames_run = makeFrames(ai_run, new Array<number>(35).fill(10));
export const hover_move_run: GameMonsterMove = {
  firstframe: FRAME_forwrd01,
  lastframe: FRAME_forwrd35,
  frame: hover_frames_run,
  endfunc: undefined
};

const hover_frames_death1 = makeFrames(ai_move, [0, 0, 0, 0, 0, 0, -10, 3, 5, 4, 7]);
export const hover_move_death1: GameMonsterMove = {
  firstframe: FRAME_death101,
  lastframe: FRAME_death111,
  frame: hover_frames_death1,
  endfunc: hover_dead
};

const hover_frames_backward = makeFrames(ai_move, new Array<number>(24).fill(0));
export const hover_move_backward: GameMonsterMove = {
  firstframe: FRAME_backwd01,
  lastframe: FRAME_backwd24,
  frame: hover_frames_backward,
  endfunc: undefined
};

const hover_frames_start_attack = makeFrames(ai_charge, [1, 1, 1]);
export const hover_move_start_attack: GameMonsterMove = {
  firstframe: FRAME_attak101,
  lastframe: FRAME_attak103,
  frame: hover_frames_start_attack,
  endfunc: hover_attack
};

const hover_frames_attack1 = makeFrames(
  ai_charge,
  [-10, -10, 0],
  [hover_fire_blaster, hover_fire_blaster, hover_reattack]
);
export const hover_move_attack1: GameMonsterMove = {
  firstframe: FRAME_attak104,
  lastframe: FRAME_attak106,
  frame: hover_frames_attack1,
  endfunc: undefined
};

const hover_frames_end_attack = makeFrames(ai_charge, [1, 1]);
export const hover_move_end_attack: GameMonsterMove = {
  firstframe: FRAME_attak107,
  lastframe: FRAME_attak108,
  frame: hover_frames_end_attack,
  endfunc: hover_run
};

/**
 * Original name: hover_reattack
 * Source: game/m_hover.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Continues the blaster attack while the enemy is alive, visible and the random reattack check succeeds.
 *
 * Porting notes:
 * - Uses `g_local.random()` to preserve the source macro's 15-bit bucket behavior.
 */
export function hover_reattack(self: GameEntity, runtime: GameRuntime): void {
  if (self.enemy && self.enemy.health > 0 && visible(self, self.enemy, runtime) && random() <= 0.6) {
    self.monsterinfo.currentmove = hover_move_attack1;
    return;
  }
  self.monsterinfo.currentmove = hover_move_end_attack;
}

/**
 * Original name: hover_fire_blaster
 * Source: game/m_hover.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Projects the hover blaster muzzle and fires one low-damage fast blaster bolt toward the enemy view height.
 */
export function hover_fire_blaster(self: GameEntity, runtime: GameRuntime): void {
  if (!self.enemy) {
    return;
  }

  const effect = self.s.frame === FRAME_attak104 ? EF_HYPERBLASTER : 0;
  const { forward, right } = AngleVectors(self.s.angles);
  const start = G_ProjectSource(self.s.origin, getMonsterFlashOffset(MZ2_HOVER_BLASTER_1), forward, right);
  const end: vec3_t = [...self.enemy.s.origin];
  end[2] += self.enemy.viewheight;
  const dir = subtractVec3(end, start);

  monster_fire_blaster(self, start, dir, 1, 1000, MZ2_HOVER_BLASTER_1, effect, runtime);
}

/**
 * Original name: hover_stand
 * Source: game/m_hover.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Sets the hover to its standing loop.
 */
export function hover_stand(self: GameEntity): void {
  self.monsterinfo.currentmove = hover_move_stand;
}

/**
 * Original name: hover_run
 * Source: game/m_hover.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Uses stand animation while holding ground, otherwise enters the forward run loop.
 */
export function hover_run(self: GameEntity): void {
  if ((self.monsterinfo.aiflags & AI_STAND_GROUND) !== 0) {
    self.monsterinfo.currentmove = hover_move_stand;
  } else {
    self.monsterinfo.currentmove = hover_move_run;
  }
}

/**
 * Original name: hover_walk
 * Source: game/m_hover.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Starts the hover walk loop.
 */
export function hover_walk(self: GameEntity): void {
  self.monsterinfo.currentmove = hover_move_walk;
}

/**
 * Original name: hover_start_attack
 * Source: game/m_hover.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Starts the hover attack windup.
 */
export function hover_start_attack(self: GameEntity): void {
  self.monsterinfo.currentmove = hover_move_start_attack;
}

/**
 * Original name: hover_attack
 * Source: game/m_hover.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Enters the repeated hover blaster firing sequence.
 */
export function hover_attack(self: GameEntity): void {
  self.monsterinfo.currentmove = hover_move_attack1;
}

/**
 * Original name: hover_pain
 * Source: game/m_hover.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies damaged skin, pain debounce, nightmare suppression and damage-sized pain move selection.
 *
 * Porting notes:
 * - Uses `g_local.random()` to preserve the source macro's 15-bit bucket behavior.
 */
export function hover_pain(
  self: GameEntity,
  _other: GameEntity | null,
  _kick: number,
  damage: number,
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

  if (damage <= 25) {
    if (random() < 0.5) {
      emitRegisteredGameSound(runtime, self, sound_pain1, SOUND_PAIN1, {
        channel: CHAN_VOICE,
        volume: 1,
        attenuation: ATTN_NORM,
        timeofs: 0
      });
      self.monsterinfo.currentmove = hover_move_pain3;
    } else {
      emitRegisteredGameSound(runtime, self, sound_pain2, SOUND_PAIN2, {
        channel: CHAN_VOICE,
        volume: 1,
        attenuation: ATTN_NORM,
        timeofs: 0
      });
      self.monsterinfo.currentmove = hover_move_pain2;
    }
  } else {
    emitRegisteredGameSound(runtime, self, sound_pain1, SOUND_PAIN1, {
      channel: CHAN_VOICE,
      volume: 1,
      attenuation: ATTN_NORM,
      timeofs: 0
    });
    self.monsterinfo.currentmove = hover_move_pain1;
  }
}

/**
 * Original name: hover_deadthink
 * Source: game/m_hover.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Waits for the dead hover to land or timeout, then becomes a temp explosion and frees itself.
 */
export function hover_deadthink(self: GameEntity, runtime: GameRuntime): void {
  if (!self.groundentity && runtime.time < self.timestamp) {
    self.nextthink = runtime.time + FRAMETIME;
    return;
  }
  BecomeExplosion1(self, runtime);
}

/**
 * Original name: hover_dead
 * Source: game/m_hover.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Finalizes the hover corpse bbox and schedules delayed explosion cleanup.
 */
export function hover_dead(self: GameEntity, runtime: GameRuntime): void {
  setVec3(self.mins, -16, -16, -24);
  setVec3(self.maxs, 16, 16, -8);
  self.movetype = MOVETYPE_TOSS;
  self.think = hover_deadthink;
  self.nextthink = runtime.time + FRAMETIME;
  self.timestamp = runtime.time + 15;
  linkGameEntity(runtime, self);
}

/**
 * Original name: hover_die
 * Source: game/m_hover.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Handles gib death, ordinary randomized death sound and death animation selection.
 *
 * Porting notes:
 * - Uses `g_local.random()` to preserve the source macro's 15-bit bucket behavior.
 */
export function hover_die(
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
    for (let n = 0; n < 2; n += 1) {
      ThrowGib(self, "models/objects/gibs/sm_meat/tris.md2", damage, GIB_ORGANIC, runtime);
    }
    ThrowHead(self, "models/objects/gibs/sm_meat/tris.md2", damage, GIB_ORGANIC, runtime);
    self.deadflag = DEAD_DEAD;
    return;
  }

  if (self.deadflag === DEAD_DEAD) {
    return;
  }

  const soundIndex = random() < 0.5 ? sound_death1 : sound_death2;
  const soundPath = soundIndex === sound_death1 ? SOUND_DEATH1 : SOUND_DEATH2;
  emitRegisteredGameSound(runtime, self, soundIndex, soundPath, {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
  self.deadflag = DEAD_DEAD;
  self.takedamage = damage_t.DAMAGE_YES;
  self.monsterinfo.currentmove = hover_move_death1;
}

/**
 * Original name: SP_monster_hover
 * Source: game/m_hover.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns monster_hover, precaches assets and initializes flying monster callbacks.
 */
export function SP_monster_hover(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  precacheHoverAssets(runtime);

  self.s.sound = registerGameSound(runtime, SOUND_IDLE);
  self.movetype = MOVETYPE_STEP;
  self.solid = SOLID_BBOX;
  self.s.modelindex = registerGameModel(runtime, "models/monsters/hover/tris.md2");
  setVec3(self.mins, -24, -24, -24);
  setVec3(self.maxs, 24, 24, 32);

  self.health = 240;
  self.gib_health = -100;
  self.mass = 150;

  self.pain = hover_pain;
  self.die = hover_die;

  self.monsterinfo.stand = hover_stand;
  self.monsterinfo.walk = hover_walk;
  self.monsterinfo.run = hover_run;
  self.monsterinfo.attack = hover_start_attack;
  self.monsterinfo.sight = hover_sight;
  self.monsterinfo.search = hover_search;

  linkGameEntity(runtime, self);

  self.monsterinfo.currentmove = hover_move_stand;
  self.monsterinfo.scale = MODEL_SCALE;

  flymonster_start(self, runtime);
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
 * Symbols: precacheHoverAssets
 * Original name: N/A
 * Source: N/A (local precache helper)
 * Source declaree: N/A (local precache helper)
 * Category: New
 * Purpose: Centralize hover sound registration while preserving source precache order.
 */
function precacheHoverAssets(runtime: GameRuntime): void {
  sound_pain1 = registerGameSound(runtime, SOUND_PAIN1);
  sound_pain2 = registerGameSound(runtime, SOUND_PAIN2);
  sound_death1 = registerGameSound(runtime, SOUND_DEATH1);
  sound_death2 = registerGameSound(runtime, SOUND_DEATH2);
  sound_sight = registerGameSound(runtime, SOUND_SIGHT);
  sound_search1 = registerGameSound(runtime, SOUND_SEARCH1);
  sound_search2 = registerGameSound(runtime, SOUND_SEARCH2);
  registerGameSound(runtime, SOUND_ATTACK);
}

/**
 * Symbols: setVec3
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Mutate runtime vectors in place for spawn and corpse bounds setup.
 */
function setVec3(vector: [number, number, number], x: number, y: number, z: number): void {
  vector[0] = x;
  vector[1] = y;
  vector[2] = z;
}

/**
 * Symbols: subtractVec3
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Build the projectile aim vector used by hover blaster fire.
 */
function subtractVec3(left: vec3_t, right: vec3_t): vec3_t {
  return [
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2]
  ];
}
