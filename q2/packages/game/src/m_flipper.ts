/**
 * File: m_flipper.ts
 * Source: Quake II original / game/m_flipper.h and game/m_flipper.c
 * Purpose: Port of the generated flipper model frame constants and monster_flipper gameplay behavior.
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
 * - This file keeps the header constants and C behavior together as the principal attachment point for `m_flipper`.
 */

import { ATTN_NORM, CHAN_VOICE, CHAN_WEAPON, type vec3_t } from "../../qcommon/src/index.js";
import {
  DEAD_DEAD,
  GIB_ORGANIC,
  MELEE_DISTANCE,
  MOVETYPE_STEP,
  MOVETYPE_TOSS,
  SOLID_BBOX,
  SVF_DEADMONSTER,
  damage_t
} from "./g_local.js";
import { ai_charge, ai_move, ai_run, ai_stand, ai_walk } from "./g_ai.js";
import { swimmonster_start } from "./g_monster.js";
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

export const FRAME_flpbit01 = 0;
export const FRAME_flpbit02 = 1;
export const FRAME_flpbit03 = 2;
export const FRAME_flpbit04 = 3;
export const FRAME_flpbit05 = 4;
export const FRAME_flpbit06 = 5;
export const FRAME_flpbit07 = 6;
export const FRAME_flpbit08 = 7;
export const FRAME_flpbit09 = 8;
export const FRAME_flpbit10 = 9;
export const FRAME_flpbit11 = 10;
export const FRAME_flpbit12 = 11;
export const FRAME_flpbit13 = 12;
export const FRAME_flpbit14 = 13;
export const FRAME_flpbit15 = 14;
export const FRAME_flpbit16 = 15;
export const FRAME_flpbit17 = 16;
export const FRAME_flpbit18 = 17;
export const FRAME_flpbit19 = 18;
export const FRAME_flpbit20 = 19;
export const FRAME_flptal01 = 20;
export const FRAME_flptal02 = 21;
export const FRAME_flptal03 = 22;
export const FRAME_flptal04 = 23;
export const FRAME_flptal05 = 24;
export const FRAME_flptal06 = 25;
export const FRAME_flptal07 = 26;
export const FRAME_flptal08 = 27;
export const FRAME_flptal09 = 28;
export const FRAME_flptal10 = 29;
export const FRAME_flptal11 = 30;
export const FRAME_flptal12 = 31;
export const FRAME_flptal13 = 32;
export const FRAME_flptal14 = 33;
export const FRAME_flptal15 = 34;
export const FRAME_flptal16 = 35;
export const FRAME_flptal17 = 36;
export const FRAME_flptal18 = 37;
export const FRAME_flptal19 = 38;
export const FRAME_flptal20 = 39;
export const FRAME_flptal21 = 40;
export const FRAME_flphor01 = 41;
export const FRAME_flphor02 = 42;
export const FRAME_flphor03 = 43;
export const FRAME_flphor04 = 44;
export const FRAME_flphor05 = 45;
export const FRAME_flphor06 = 46;
export const FRAME_flphor07 = 47;
export const FRAME_flphor08 = 48;
export const FRAME_flphor09 = 49;
export const FRAME_flphor10 = 50;
export const FRAME_flphor11 = 51;
export const FRAME_flphor12 = 52;
export const FRAME_flphor13 = 53;
export const FRAME_flphor14 = 54;
export const FRAME_flphor15 = 55;
export const FRAME_flphor16 = 56;
export const FRAME_flphor17 = 57;
export const FRAME_flphor18 = 58;
export const FRAME_flphor19 = 59;
export const FRAME_flphor20 = 60;
export const FRAME_flphor21 = 61;
export const FRAME_flphor22 = 62;
export const FRAME_flphor23 = 63;
export const FRAME_flphor24 = 64;
export const FRAME_flpver01 = 65;
export const FRAME_flpver02 = 66;
export const FRAME_flpver03 = 67;
export const FRAME_flpver04 = 68;
export const FRAME_flpver05 = 69;
export const FRAME_flpver06 = 70;
export const FRAME_flpver07 = 71;
export const FRAME_flpver08 = 72;
export const FRAME_flpver09 = 73;
export const FRAME_flpver10 = 74;
export const FRAME_flpver11 = 75;
export const FRAME_flpver12 = 76;
export const FRAME_flpver13 = 77;
export const FRAME_flpver14 = 78;
export const FRAME_flpver15 = 79;
export const FRAME_flpver16 = 80;
export const FRAME_flpver17 = 81;
export const FRAME_flpver18 = 82;
export const FRAME_flpver19 = 83;
export const FRAME_flpver20 = 84;
export const FRAME_flpver21 = 85;
export const FRAME_flpver22 = 86;
export const FRAME_flpver23 = 87;
export const FRAME_flpver24 = 88;
export const FRAME_flpver25 = 89;
export const FRAME_flpver26 = 90;
export const FRAME_flpver27 = 91;
export const FRAME_flpver28 = 92;
export const FRAME_flpver29 = 93;
export const FRAME_flppn101 = 94;
export const FRAME_flppn102 = 95;
export const FRAME_flppn103 = 96;
export const FRAME_flppn104 = 97;
export const FRAME_flppn105 = 98;
export const FRAME_flppn201 = 99;
export const FRAME_flppn202 = 100;
export const FRAME_flppn203 = 101;
export const FRAME_flppn204 = 102;
export const FRAME_flppn205 = 103;
export const FRAME_flpdth01 = 104;
export const FRAME_flpdth02 = 105;
export const FRAME_flpdth03 = 106;
export const FRAME_flpdth04 = 107;
export const FRAME_flpdth05 = 108;
export const FRAME_flpdth06 = 109;
export const FRAME_flpdth07 = 110;
export const FRAME_flpdth08 = 111;
export const FRAME_flpdth09 = 112;
export const FRAME_flpdth10 = 113;
export const FRAME_flpdth11 = 114;
export const FRAME_flpdth12 = 115;
export const FRAME_flpdth13 = 116;
export const FRAME_flpdth14 = 117;
export const FRAME_flpdth15 = 118;
export const FRAME_flpdth16 = 119;
export const FRAME_flpdth17 = 120;
export const FRAME_flpdth18 = 121;
export const FRAME_flpdth19 = 122;
export const FRAME_flpdth20 = 123;
export const FRAME_flpdth21 = 124;
export const FRAME_flpdth22 = 125;
export const FRAME_flpdth23 = 126;
export const FRAME_flpdth24 = 127;
export const FRAME_flpdth25 = 128;
export const FRAME_flpdth26 = 129;
export const FRAME_flpdth27 = 130;
export const FRAME_flpdth28 = 131;
export const FRAME_flpdth29 = 132;
export const FRAME_flpdth30 = 133;
export const FRAME_flpdth31 = 134;
export const FRAME_flpdth32 = 135;
export const FRAME_flpdth33 = 136;
export const FRAME_flpdth34 = 137;
export const FRAME_flpdth35 = 138;
export const FRAME_flpdth36 = 139;
export const FRAME_flpdth37 = 140;
export const FRAME_flpdth38 = 141;
export const FRAME_flpdth39 = 142;
export const FRAME_flpdth40 = 143;
export const FRAME_flpdth41 = 144;
export const FRAME_flpdth42 = 145;
export const FRAME_flpdth43 = 146;
export const FRAME_flpdth44 = 147;
export const FRAME_flpdth45 = 148;
export const FRAME_flpdth46 = 149;
export const FRAME_flpdth47 = 150;
export const FRAME_flpdth48 = 151;
export const FRAME_flpdth49 = 152;
export const FRAME_flpdth50 = 153;
export const FRAME_flpdth51 = 154;
export const FRAME_flpdth52 = 155;
export const FRAME_flpdth53 = 156;
export const FRAME_flpdth54 = 157;
export const FRAME_flpdth55 = 158;
export const FRAME_flpdth56 = 159;

export const MODEL_SCALE = 1.0;

const FLIPPER_RUN_SPEED = 24;

const SOUND_PAIN1 = "flipper/flppain1.wav";
const SOUND_PAIN2 = "flipper/flppain2.wav";
const SOUND_DEATH = "flipper/flpdeth1.wav";
const SOUND_CHOMP = "flipper/flpatck1.wav";
const SOUND_ATTACK = "flipper/flpatck2.wav";
const SOUND_IDLE = "flipper/flpidle1.wav";
const SOUND_SEARCH = "flipper/flpsrch1.wav";
const SOUND_SIGHT = "flipper/flpsght1.wav";

/**
 * Original name: N/A
 * Source: N/A (runtime sound handle cache)
 * Category: New
 * Purpose: Store registered runtime sound indexes for the flipper sound path constants.
 */
let sound_chomp = 0;
let sound_attack = 0;
let sound_pain1 = 0;
let sound_pain2 = 0;
let sound_death = 0;
let sound_idle = 0;
let sound_search = 0;
let sound_sight = 0;

const flipper_frames_stand = makeFrames(ai_stand, [0]);
export const flipper_move_stand: GameMonsterMove = {
  firstframe: FRAME_flphor01,
  lastframe: FRAME_flphor01,
  frame: flipper_frames_stand,
  endfunc: undefined
};

/**
 * Original name: flipper_stand
 * Source: game/m_flipper.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Sets the flipper to its one-frame horizontal standing loop.
 */
export function flipper_stand(self: GameEntity): void {
  self.monsterinfo.currentmove = flipper_move_stand;
}

const flipper_frames_run = makeFrames(ai_run, new Array<number>(24).fill(FLIPPER_RUN_SPEED));
export const flipper_move_run_loop: GameMonsterMove = {
  firstframe: FRAME_flpver06,
  lastframe: FRAME_flpver29,
  frame: flipper_frames_run,
  endfunc: undefined
};

/**
 * Original name: flipper_run_loop
 * Source: game/m_flipper.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Switches from the vertical run startup into the continuous swimming run loop.
 */
export function flipper_run_loop(self: GameEntity): void {
  self.monsterinfo.currentmove = flipper_move_run_loop;
}

const flipper_frames_run_start = makeFrames(ai_run, [8, 8, 8, 8, 8, 8]);
export const flipper_move_run_start: GameMonsterMove = {
  firstframe: FRAME_flpver01,
  lastframe: FRAME_flpver06,
  frame: flipper_frames_run_start,
  endfunc: flipper_run_loop
};

/**
 * Original name: flipper_run
 * Source: game/m_flipper.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Starts the vertical swimming run animation.
 */
export function flipper_run(self: GameEntity): void {
  self.monsterinfo.currentmove = flipper_move_run_start;
}

const flipper_frames_walk = makeFrames(ai_walk, new Array<number>(24).fill(4));
export const flipper_move_walk: GameMonsterMove = {
  firstframe: FRAME_flphor01,
  lastframe: FRAME_flphor24,
  frame: flipper_frames_walk,
  endfunc: undefined
};

/**
 * Original name: flipper_walk
 * Source: game/m_flipper.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Starts the standard horizontal swimming walk loop.
 */
export function flipper_walk(self: GameEntity): void {
  self.monsterinfo.currentmove = flipper_move_walk;
}

const flipper_frames_start_run = makeFrames(
  ai_run,
  [8, 8, 8, 8, 8],
  indexedThinks(5, [[4, flipper_run]])
);
export const flipper_move_start_run: GameMonsterMove = {
  firstframe: FRAME_flphor01,
  lastframe: FRAME_flphor05,
  frame: flipper_frames_start_run,
  endfunc: undefined
};

/**
 * Original name: flipper_start_run
 * Source: game/m_flipper.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Begins the horizontal-to-vertical run transition.
 */
export function flipper_start_run(self: GameEntity): void {
  self.monsterinfo.currentmove = flipper_move_start_run;
}

const flipper_frames_pain2 = makeFrames(ai_move, new Array<number>(5).fill(0));
export const flipper_move_pain2: GameMonsterMove = {
  firstframe: FRAME_flppn101,
  lastframe: FRAME_flppn105,
  frame: flipper_frames_pain2,
  endfunc: flipper_run
};

const flipper_frames_pain1 = makeFrames(ai_move, new Array<number>(5).fill(0));
export const flipper_move_pain1: GameMonsterMove = {
  firstframe: FRAME_flppn201,
  lastframe: FRAME_flppn205,
  frame: flipper_frames_pain1,
  endfunc: flipper_run
};

/**
 * Original name: flipper_bite
 * Source: game/m_flipper.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Performs the flipper melee bite hit test with the original damage and kick.
 */
export function flipper_bite(self: GameEntity, runtime: GameRuntime): void {
  const aim: vec3_t = [MELEE_DISTANCE, 0, 0];
  fire_hit(self, aim, 5, 0, runtime);
}

/**
 * Original name: flipper_preattack
 * Source: game/m_flipper.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Plays the chomp sound at the beginning of the bite animation.
 */
export function flipper_preattack(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_chomp, SOUND_CHOMP, {
    channel: CHAN_WEAPON,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
}

const flipper_frames_attack = makeFrames(
  ai_charge,
  new Array<number>(20).fill(0),
  indexedThinks(20, [
    [0, flipper_preattack],
    [13, flipper_bite],
    [18, flipper_bite]
  ])
);
export const flipper_move_attack: GameMonsterMove = {
  firstframe: FRAME_flpbit01,
  lastframe: FRAME_flpbit20,
  frame: flipper_frames_attack,
  endfunc: flipper_run
};

/**
 * Original name: flipper_melee
 * Source: game/m_flipper.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Starts the flipper bite animation.
 */
export function flipper_melee(self: GameEntity): void {
  self.monsterinfo.currentmove = flipper_move_attack;
}

/**
 * Original name: flipper_pain
 * Source: game/m_flipper.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies damaged skin, pain debounce, nightmare suppression and one of two pain moves.
 */
export function flipper_pain(
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

  const n = (randomInt(0x7fffffff) + 1) % 2;
  if (n === 0) {
    emitRegisteredGameSound(runtime, self, sound_pain1, SOUND_PAIN1, {
      channel: CHAN_VOICE,
      volume: 1,
      attenuation: ATTN_NORM,
      timeofs: 0
    });
    self.monsterinfo.currentmove = flipper_move_pain1;
  } else {
    emitRegisteredGameSound(runtime, self, sound_pain2, SOUND_PAIN2, {
      channel: CHAN_VOICE,
      volume: 1,
      attenuation: ATTN_NORM,
      timeofs: 0
    });
    self.monsterinfo.currentmove = flipper_move_pain2;
  }
}

/**
 * Original name: flipper_dead
 * Source: game/m_flipper.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Finalizes the flipper corpse bbox, movetype, dead-monster flag and link state.
 */
export function flipper_dead(self: GameEntity, runtime: GameRuntime): void {
  setVec3(self.mins, -16, -16, -24);
  setVec3(self.maxs, 16, 16, -8);
  self.movetype = MOVETYPE_TOSS;
  self.svflags |= SVF_DEADMONSTER;
  self.nextthink = 0;
  linkGameEntity(runtime, self);
}

const flipper_frames_death = makeFrames(ai_move, new Array<number>(56).fill(0));
export const flipper_move_death: GameMonsterMove = {
  firstframe: FRAME_flpdth01,
  lastframe: FRAME_flpdth56,
  frame: flipper_frames_death,
  endfunc: flipper_dead
};

/**
 * Original name: flipper_sight
 * Source: game/m_flipper.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Plays the flipper sight sound on target acquisition.
 */
export function flipper_sight(self: GameEntity, _other: GameEntity | null, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_sight, SOUND_SIGHT, {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
}

/**
 * Original name: flipper_die
 * Source: game/m_flipper.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Handles gib death, ordinary death sound and death animation selection.
 */
export function flipper_die(
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

  emitRegisteredGameSound(runtime, self, sound_death, SOUND_DEATH, {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
  self.deadflag = DEAD_DEAD;
  self.takedamage = damage_t.DAMAGE_YES;
  self.monsterinfo.currentmove = flipper_move_death;
}

/**
 * Original name: SP_monster_flipper
 * Source: game/m_flipper.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns monster_flipper, precaches assets and initializes swimming monster callbacks.
 */
export function SP_monster_flipper(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  precacheFlipperAssets(runtime);

  self.movetype = MOVETYPE_STEP;
  self.solid = SOLID_BBOX;
  self.s.modelindex = registerGameModel(runtime, "models/monsters/flipper/tris.md2");
  setVec3(self.mins, -16, -16, 0);
  setVec3(self.maxs, 16, 16, 32);

  self.health = 50;
  self.gib_health = -30;
  self.mass = 100;

  self.pain = flipper_pain;
  self.die = flipper_die;

  self.monsterinfo.stand = flipper_stand;
  self.monsterinfo.walk = flipper_walk;
  self.monsterinfo.run = flipper_start_run;
  self.monsterinfo.melee = flipper_melee;
  self.monsterinfo.sight = flipper_sight;

  linkGameEntity(runtime, self);

  self.monsterinfo.currentmove = flipper_move_stand;
  self.monsterinfo.scale = MODEL_SCALE;

  swimmonster_start(self, runtime);
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Build TS monster frame arrays from compact distance/callback lists.
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
 * Purpose: Place sparse frame callbacks at their source frame indexes.
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
 * Purpose: Keep the `SP_monster_flipper` asset precache sequence in one TS helper.
 */
function precacheFlipperAssets(runtime: GameRuntime): void {
  sound_pain1 = registerGameSound(runtime, SOUND_PAIN1);
  sound_pain2 = registerGameSound(runtime, SOUND_PAIN2);
  sound_death = registerGameSound(runtime, SOUND_DEATH);
  sound_chomp = registerGameSound(runtime, SOUND_CHOMP);
  sound_attack = registerGameSound(runtime, SOUND_ATTACK);
  sound_idle = registerGameSound(runtime, SOUND_IDLE);
  sound_search = registerGameSound(runtime, SOUND_SEARCH);
  sound_sight = registerGameSound(runtime, SOUND_SIGHT);
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Local mutable tuple assignment equivalent for entity bounds.
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
 * Purpose: Provide the integer random branch used by flipper pain selection.
 */
function randomInt(maxExclusive: number): number {
  return Math.trunc(Math.random() * maxExclusive);
}

void sound_attack;
void sound_idle;
void sound_search;
