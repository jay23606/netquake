/**
 * File: m_gladiator.ts
 * Source: Quake II original / game/m_gladiator.h and game/m_gladiator.c
 * Purpose: Port of the generated gladiator model frame constants and monster_gladiator gameplay behavior.
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
 * - This file keeps the header constants and C behavior together as the principal attachment point for `m_gladiator`.
 */

import { AngleVectors, ATTN_IDLE, ATTN_NORM, CHAN_AUTO, CHAN_VOICE, CHAN_WEAPON, type vec3_t } from "../../qcommon/src/index.js";
import {
  AI_STAND_GROUND,
  DEAD_DEAD,
  GIB_ORGANIC,
  MELEE_DISTANCE,
  MOVETYPE_STEP,
  MOVETYPE_TOSS,
  SOLID_BBOX,
  SVF_DEADMONSTER,
  damage_t,
  random
} from "./g_local.js";
import { ai_charge, ai_move, ai_run, ai_stand, ai_walk } from "./g_ai.js";
import { monster_fire_railgun, walkmonster_start } from "./g_monster.js";
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

export const FRAME_stand1 = 0;
export const FRAME_stand2 = 1;
export const FRAME_stand3 = 2;
export const FRAME_stand4 = 3;
export const FRAME_stand5 = 4;
export const FRAME_stand6 = 5;
export const FRAME_stand7 = 6;
export const FRAME_walk1 = 7;
export const FRAME_walk2 = 8;
export const FRAME_walk3 = 9;
export const FRAME_walk4 = 10;
export const FRAME_walk5 = 11;
export const FRAME_walk6 = 12;
export const FRAME_walk7 = 13;
export const FRAME_walk8 = 14;
export const FRAME_walk9 = 15;
export const FRAME_walk10 = 16;
export const FRAME_walk11 = 17;
export const FRAME_walk12 = 18;
export const FRAME_walk13 = 19;
export const FRAME_walk14 = 20;
export const FRAME_walk15 = 21;
export const FRAME_walk16 = 22;
export const FRAME_run1 = 23;
export const FRAME_run2 = 24;
export const FRAME_run3 = 25;
export const FRAME_run4 = 26;
export const FRAME_run5 = 27;
export const FRAME_run6 = 28;
export const FRAME_melee1 = 29;
export const FRAME_melee2 = 30;
export const FRAME_melee3 = 31;
export const FRAME_melee4 = 32;
export const FRAME_melee5 = 33;
export const FRAME_melee6 = 34;
export const FRAME_melee7 = 35;
export const FRAME_melee8 = 36;
export const FRAME_melee9 = 37;
export const FRAME_melee10 = 38;
export const FRAME_melee11 = 39;
export const FRAME_melee12 = 40;
export const FRAME_melee13 = 41;
export const FRAME_melee14 = 42;
export const FRAME_melee15 = 43;
export const FRAME_melee16 = 44;
export const FRAME_melee17 = 45;
export const FRAME_attack1 = 46;
export const FRAME_attack2 = 47;
export const FRAME_attack3 = 48;
export const FRAME_attack4 = 49;
export const FRAME_attack5 = 50;
export const FRAME_attack6 = 51;
export const FRAME_attack7 = 52;
export const FRAME_attack8 = 53;
export const FRAME_attack9 = 54;
export const FRAME_pain1 = 55;
export const FRAME_pain2 = 56;
export const FRAME_pain3 = 57;
export const FRAME_pain4 = 58;
export const FRAME_pain5 = 59;
export const FRAME_pain6 = 60;
export const FRAME_death1 = 61;
export const FRAME_death2 = 62;
export const FRAME_death3 = 63;
export const FRAME_death4 = 64;
export const FRAME_death5 = 65;
export const FRAME_death6 = 66;
export const FRAME_death7 = 67;
export const FRAME_death8 = 68;
export const FRAME_death9 = 69;
export const FRAME_death10 = 70;
export const FRAME_death11 = 71;
export const FRAME_death12 = 72;
export const FRAME_death13 = 73;
export const FRAME_death14 = 74;
export const FRAME_death15 = 75;
export const FRAME_death16 = 76;
export const FRAME_death17 = 77;
export const FRAME_death18 = 78;
export const FRAME_death19 = 79;
export const FRAME_death20 = 80;
export const FRAME_death21 = 81;
export const FRAME_death22 = 82;
export const FRAME_painup1 = 83;
export const FRAME_painup2 = 84;
export const FRAME_painup3 = 85;
export const FRAME_painup4 = 86;
export const FRAME_painup5 = 87;
export const FRAME_painup6 = 88;
export const FRAME_painup7 = 89;

export const MODEL_SCALE = 1.0;

/**
 * Symbols: MZ2_GLADIATOR_RAILGUN_1
 * Original name: N/A
 * Source: N/A (local muzzle flash alias)
 * Source declaree: N/A (local muzzle flash alias)
 * Category: New
 * Purpose: Keep the gladiator-specific muzzle flash name close to the monster code while delegating offsets to the shared flash table.
 */
export const MZ2_GLADIATOR_RAILGUN_1 = 61;

const SOUND_PAIN1 = "gladiator/pain.wav";
const SOUND_PAIN2 = "gladiator/gldpain2.wav";
const SOUND_DIE = "gladiator/glddeth2.wav";
const SOUND_GUN = "gladiator/railgun.wav";
const SOUND_CLEAVER_SWING = "gladiator/melee1.wav";
const SOUND_CLEAVER_HIT = "gladiator/melee2.wav";
const SOUND_CLEAVER_MISS = "gladiator/melee3.wav";
const SOUND_IDLE = "gladiator/gldidle1.wav";
const SOUND_SEARCH = "gladiator/gldsrch1.wav";
const SOUND_SIGHT = "gladiator/sight.wav";

/**
 * Symbols: sound_pain1, sound_pain2, sound_die, sound_gun, sound_cleaver_swing, sound_cleaver_hit, sound_cleaver_miss, sound_idle, sound_search, sound_sight
 * Original name: N/A
 * Source: N/A (runtime sound cache handles)
 * Source declaree: N/A (runtime sound cache handles)
 * Category: New
 * Purpose: Store registered sound IDs for the runtime sound adapter.
 */
let sound_pain1 = 0;
let sound_pain2 = 0;
let sound_die = 0;
let sound_gun = 0;
let sound_cleaver_swing = 0;
let sound_cleaver_hit = 0;
let sound_cleaver_miss = 0;
let sound_idle = 0;
let sound_search = 0;
let sound_sight = 0;

/**
 * Original name: gladiator_idle
 * Source: game/m_gladiator.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Plays the gladiator idle sound with the original idle attenuation.
 */
export function gladiator_idle(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_idle, SOUND_IDLE, {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_IDLE,
    timeofs: 0
  });
}

/**
 * Original name: gladiator_sight
 * Source: game/m_gladiator.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Plays the gladiator sight sound on target acquisition.
 */
export function gladiator_sight(self: GameEntity, _other: GameEntity | null, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_sight, SOUND_SIGHT, {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
}

/**
 * Original name: gladiator_search
 * Source: game/m_gladiator.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Plays the gladiator search sound.
 */
export function gladiator_search(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_search, SOUND_SEARCH, {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
}

/**
 * Original name: gladiator_cleaver_swing
 * Source: game/m_gladiator.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Plays the cleaver swing sound on the original melee animation frames.
 */
export function gladiator_cleaver_swing(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_cleaver_swing, SOUND_CLEAVER_SWING, {
    channel: CHAN_WEAPON,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
}

const gladiator_frames_stand = makeFrames(ai_stand, new Array<number>(7).fill(0));
export const gladiator_move_stand: GameMonsterMove = {
  firstframe: FRAME_stand1,
  lastframe: FRAME_stand7,
  frame: gladiator_frames_stand,
  endfunc: undefined
};

/**
 * Original name: gladiator_stand
 * Source: game/m_gladiator.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Starts the gladiator standing loop.
 */
export function gladiator_stand(self: GameEntity): void {
  self.monsterinfo.currentmove = gladiator_move_stand;
}

const gladiator_frames_walk = makeFrames(ai_walk, [15, 7, 6, 5, 2, 0, 2, 8, 12, 8, 5, 5, 2, 2, 1, 8]);
export const gladiator_move_walk: GameMonsterMove = {
  firstframe: FRAME_walk1,
  lastframe: FRAME_walk16,
  frame: gladiator_frames_walk,
  endfunc: undefined
};

/**
 * Original name: gladiator_walk
 * Source: game/m_gladiator.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Starts the gladiator walking loop.
 */
export function gladiator_walk(self: GameEntity): void {
  self.monsterinfo.currentmove = gladiator_move_walk;
}

const gladiator_frames_run = makeFrames(ai_run, [23, 14, 14, 21, 12, 13]);
export const gladiator_move_run: GameMonsterMove = {
  firstframe: FRAME_run1,
  lastframe: FRAME_run6,
  frame: gladiator_frames_run,
  endfunc: undefined
};

/**
 * Original name: gladiator_run
 * Source: game/m_gladiator.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Uses stand animation while holding ground, otherwise enters the run loop.
 */
export function gladiator_run(self: GameEntity): void {
  if ((self.monsterinfo.aiflags & AI_STAND_GROUND) !== 0) {
    self.monsterinfo.currentmove = gladiator_move_stand;
  } else {
    self.monsterinfo.currentmove = gladiator_move_run;
  }
}

/**
 * Original name: GaldiatorMelee
 * Source: game/m_gladiator.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Performs the cleaver melee hit test and plays hit or miss feedback.
 */
export function GaldiatorMelee(self: GameEntity, runtime: GameRuntime): void {
  const aim: vec3_t = [MELEE_DISTANCE, self.mins[0], -4];
  const hit = fire_hit(self, aim, 20 + randomInt(5), 300, runtime);
  emitRegisteredGameSound(runtime, self, hit ? sound_cleaver_hit : sound_cleaver_miss, hit ? SOUND_CLEAVER_HIT : SOUND_CLEAVER_MISS, {
    channel: CHAN_AUTO,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
}

const gladiator_frames_attack_melee = makeFrames(
  ai_charge,
  new Array<number>(17).fill(0),
  indexedThinks(17, [
    [4, gladiator_cleaver_swing],
    [6, GaldiatorMelee],
    [10, gladiator_cleaver_swing],
    [13, GaldiatorMelee]
  ])
);
export const gladiator_move_attack_melee: GameMonsterMove = {
  firstframe: FRAME_melee1,
  lastframe: FRAME_melee17,
  frame: gladiator_frames_attack_melee,
  endfunc: gladiator_run
};

/**
 * Original name: gladiator_melee
 * Source: game/m_gladiator.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Starts the gladiator cleaver attack.
 */
export function gladiator_melee(self: GameEntity): void {
  self.monsterinfo.currentmove = gladiator_move_attack_melee;
}

/**
 * Original name: GladiatorGun
 * Source: game/m_gladiator.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Projects the railgun muzzle and fires at the target point captured when the attack started.
 */
export function GladiatorGun(self: GameEntity, runtime: GameRuntime): void {
  const { forward, right } = AngleVectors(self.s.angles);
  const start = G_ProjectSource(self.s.origin, getMonsterFlashOffset(MZ2_GLADIATOR_RAILGUN_1), forward, right);
  const dir = normalizeVec3(subtractVec3(self.pos1, start));

  monster_fire_railgun(self, start, dir, 50, 100, MZ2_GLADIATOR_RAILGUN_1, runtime);
}

const gladiator_frames_attack_gun = makeFrames(
  ai_charge,
  new Array<number>(9).fill(0),
  indexedThinks(9, [[3, GladiatorGun]])
);
export const gladiator_move_attack_gun: GameMonsterMove = {
  firstframe: FRAME_attack1,
  lastframe: FRAME_attack9,
  frame: gladiator_frames_attack_gun,
  endfunc: gladiator_run
};

/**
 * Original name: gladiator_attack
 * Source: game/m_gladiator.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Skips ranged fire inside the original safe zone, otherwise charges and aims the railgun.
 */
export function gladiator_attack(self: GameEntity, runtime: GameRuntime): void {
  if (!self.enemy) {
    return;
  }

  const range = vec3Length(subtractVec3(self.s.origin, self.enemy.s.origin));
  if (range <= MELEE_DISTANCE + 32) {
    return;
  }

  emitRegisteredGameSound(runtime, self, sound_gun, SOUND_GUN, {
    channel: CHAN_WEAPON,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
  self.pos1 = [...self.enemy.s.origin];
  self.pos1[2] += self.enemy.viewheight;
  self.monsterinfo.currentmove = gladiator_move_attack_gun;
}

const gladiator_frames_pain = makeFrames(ai_move, new Array<number>(6).fill(0));
export const gladiator_move_pain: GameMonsterMove = {
  firstframe: FRAME_pain1,
  lastframe: FRAME_pain6,
  frame: gladiator_frames_pain,
  endfunc: gladiator_run
};

const gladiator_frames_pain_air = makeFrames(ai_move, new Array<number>(7).fill(0));
export const gladiator_move_pain_air: GameMonsterMove = {
  firstframe: FRAME_painup1,
  lastframe: FRAME_painup7,
  frame: gladiator_frames_pain_air,
  endfunc: gladiator_run
};

/**
 * Original name: gladiator_pain
 * Source: game/m_gladiator.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies damaged skin, pain debounce, air-pain transition and nightmare suppression.
 *
 * Porting notes:
 * - The source `random() < 0.5` sound branch uses `g_local.random`, not raw `Math.random`.
 */
export function gladiator_pain(
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
    if (self.velocity[2] > 100 && self.monsterinfo.currentmove === gladiator_move_pain) {
      self.monsterinfo.currentmove = gladiator_move_pain_air;
    }
    return;
  }

  self.pain_debounce_time = runtime.time + 3;

  if (random() < 0.5) {
    emitRegisteredGameSound(runtime, self, sound_pain1, SOUND_PAIN1, {
      channel: CHAN_VOICE,
      volume: 1,
      attenuation: ATTN_NORM,
      timeofs: 0
    });
  } else {
    emitRegisteredGameSound(runtime, self, sound_pain2, SOUND_PAIN2, {
      channel: CHAN_VOICE,
      volume: 1,
      attenuation: ATTN_NORM,
      timeofs: 0
    });
  }

  if (runtime.skill === 3) {
    return;
  }

  if (self.velocity[2] > 100) {
    self.monsterinfo.currentmove = gladiator_move_pain_air;
  } else {
    self.monsterinfo.currentmove = gladiator_move_pain;
  }
}

/**
 * Original name: gladiator_dead
 * Source: game/m_gladiator.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Finalizes the gladiator corpse bbox, movetype, dead-monster flag and link state.
 */
export function gladiator_dead(self: GameEntity, runtime: GameRuntime): void {
  setVec3(self.mins, -16, -16, -24);
  setVec3(self.maxs, 16, 16, -8);
  self.movetype = MOVETYPE_TOSS;
  self.svflags |= SVF_DEADMONSTER;
  self.nextthink = 0;
  linkGameEntity(runtime, self);
}

const gladiator_frames_death = makeFrames(ai_move, new Array<number>(22).fill(0));
export const gladiator_move_death: GameMonsterMove = {
  firstframe: FRAME_death1,
  lastframe: FRAME_death22,
  frame: gladiator_frames_death,
  endfunc: gladiator_dead
};

/**
 * Original name: gladiator_die
 * Source: game/m_gladiator.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Handles gib death, ordinary death sound and death animation selection.
 */
export function gladiator_die(
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

  emitRegisteredGameSound(runtime, self, sound_die, SOUND_DIE, {
    channel: CHAN_VOICE,
    volume: 1,
    attenuation: ATTN_NORM,
    timeofs: 0
  });
  self.deadflag = DEAD_DEAD;
  self.takedamage = damage_t.DAMAGE_YES;
  self.monsterinfo.currentmove = gladiator_move_death;
}

/**
 * Original name: SP_monster_gladiator
 * Source: game/m_gladiator.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns monster_gladiator, precaches assets and initializes walking monster callbacks.
 */
export function SP_monster_gladiator(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  precacheGladiatorAssets(runtime);

  self.movetype = MOVETYPE_STEP;
  self.solid = SOLID_BBOX;
  self.s.modelindex = registerGameModel(runtime, "models/monsters/gladiatr/tris.md2");
  setVec3(self.mins, -32, -32, -24);
  setVec3(self.maxs, 32, 32, 64);

  self.health = 400;
  self.gib_health = -175;
  self.mass = 400;

  self.pain = gladiator_pain;
  self.die = gladiator_die;

  self.monsterinfo.stand = gladiator_stand;
  self.monsterinfo.walk = gladiator_walk;
  self.monsterinfo.run = gladiator_run;
  self.monsterinfo.dodge = undefined;
  self.monsterinfo.attack = gladiator_attack;
  self.monsterinfo.melee = gladiator_melee;
  self.monsterinfo.sight = gladiator_sight;
  self.monsterinfo.idle = gladiator_idle;
  self.monsterinfo.search = gladiator_search;

  linkGameEntity(runtime, self);
  self.monsterinfo.currentmove = gladiator_move_stand;
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
 * Symbols: precacheGladiatorAssets
 * Original name: N/A
 * Source: N/A (local precache helper)
 * Source declaree: N/A (local precache helper)
 * Category: New
 * Purpose: Centralize gladiator sound registration while preserving source precache order.
 */
function precacheGladiatorAssets(runtime: GameRuntime): void {
  sound_pain1 = registerGameSound(runtime, SOUND_PAIN1);
  sound_pain2 = registerGameSound(runtime, SOUND_PAIN2);
  sound_die = registerGameSound(runtime, SOUND_DIE);
  sound_gun = registerGameSound(runtime, SOUND_GUN);
  sound_cleaver_swing = registerGameSound(runtime, SOUND_CLEAVER_SWING);
  sound_cleaver_hit = registerGameSound(runtime, SOUND_CLEAVER_HIT);
  sound_cleaver_miss = registerGameSound(runtime, SOUND_CLEAVER_MISS);
  sound_idle = registerGameSound(runtime, SOUND_IDLE);
  sound_search = registerGameSound(runtime, SOUND_SEARCH);
  sound_sight = registerGameSound(runtime, SOUND_SIGHT);
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
 * Symbols: subtractVec3
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Build range and aim vectors used by gladiator ranged attack logic.
 */
function subtractVec3(left: vec3_t, right: vec3_t): vec3_t {
  return [
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2]
  ];
}

/**
 * Symbols: normalizeVec3
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Normalize the railgun aim vector produced by the runtime vector helpers.
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
 * Purpose: Measure range for the gladiator railgun safe-zone check.
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
 * Purpose: Preserve the integer rand-style melee damage variation used by the source behavior.
 */
function randomInt(maxExclusive: number): number {
  return Math.trunc(Math.random() * maxExclusive);
}
