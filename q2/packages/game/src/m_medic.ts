/**
 * File: m_medic.ts
 * Source: Quake II original / game/m_medic.h and game/m_medic.c
 * Purpose: Port of the generated medic model frame constants and monster_medic gameplay behavior.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses the explicit gameplay runtime and structured temp-entity event queue instead of `gi.*` writes.
 * - None.
 *
 * Notes:
 * - This file keeps the header constants and C behavior together as the principal attachment point for `m_medic`.
 */

import {
  AngleVectors,
  ATTN_IDLE,
  ATTN_NORM,
  CHAN_AUTO,
  CHAN_VOICE,
  CHAN_WEAPON,
  EF_BLASTER,
  EF_HYPERBLASTER,
  MASK_SHOT,
  PITCH,
  multicast_t,
  temp_event_t,
  type vec3_t
} from "../../qcommon/src/index.js";
import {
  AI_DUCKED,
  AI_GOOD_GUY,
  AI_HOLD_FRAME,
  AI_MEDIC,
  AI_RESURRECTING,
  AI_STAND_GROUND,
  DEAD_DEAD,
  GIB_ORGANIC,
  MOVETYPE_STEP,
  MOVETYPE_TOSS,
  SOLID_BBOX,
  SVF_DEADMONSTER,
  SVF_MONSTER,
  damage_t,
  random
} from "./g_local.js";
import { ai_charge, ai_move, ai_run, ai_stand, ai_walk, FoundTarget, M_CheckAttack, visible } from "./g_ai.js";
import { monster_fire_blaster, walkmonster_start } from "./g_monster.js";
import { ThrowGib, ThrowHead } from "./g_misc.js";
import { ED_CallSpawn } from "./g_spawn.js";
import { G_FreeEdict, G_ProjectSource, vectoangles } from "./g_utils.js";
import { getMonsterFlashOffset } from "./m_flash.js";
import {
  emitGameSound,
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

export const FRAME_walk1 = 0;
export const FRAME_walk2 = 1;
export const FRAME_walk3 = 2;
export const FRAME_walk4 = 3;
export const FRAME_walk5 = 4;
export const FRAME_walk6 = 5;
export const FRAME_walk7 = 6;
export const FRAME_walk8 = 7;
export const FRAME_walk9 = 8;
export const FRAME_walk10 = 9;
export const FRAME_walk11 = 10;
export const FRAME_walk12 = 11;
export const FRAME_wait1 = 12;
export const FRAME_wait2 = 13;
export const FRAME_wait3 = 14;
export const FRAME_wait4 = 15;
export const FRAME_wait5 = 16;
export const FRAME_wait6 = 17;
export const FRAME_wait7 = 18;
export const FRAME_wait8 = 19;
export const FRAME_wait9 = 20;
export const FRAME_wait10 = 21;
export const FRAME_wait11 = 22;
export const FRAME_wait12 = 23;
export const FRAME_wait13 = 24;
export const FRAME_wait14 = 25;
export const FRAME_wait15 = 26;
export const FRAME_wait16 = 27;
export const FRAME_wait17 = 28;
export const FRAME_wait18 = 29;
export const FRAME_wait19 = 30;
export const FRAME_wait20 = 31;
export const FRAME_wait21 = 32;
export const FRAME_wait22 = 33;
export const FRAME_wait23 = 34;
export const FRAME_wait24 = 35;
export const FRAME_wait25 = 36;
export const FRAME_wait26 = 37;
export const FRAME_wait27 = 38;
export const FRAME_wait28 = 39;
export const FRAME_wait29 = 40;
export const FRAME_wait30 = 41;
export const FRAME_wait31 = 42;
export const FRAME_wait32 = 43;
export const FRAME_wait33 = 44;
export const FRAME_wait34 = 45;
export const FRAME_wait35 = 46;
export const FRAME_wait36 = 47;
export const FRAME_wait37 = 48;
export const FRAME_wait38 = 49;
export const FRAME_wait39 = 50;
export const FRAME_wait40 = 51;
export const FRAME_wait41 = 52;
export const FRAME_wait42 = 53;
export const FRAME_wait43 = 54;
export const FRAME_wait44 = 55;
export const FRAME_wait45 = 56;
export const FRAME_wait46 = 57;
export const FRAME_wait47 = 58;
export const FRAME_wait48 = 59;
export const FRAME_wait49 = 60;
export const FRAME_wait50 = 61;
export const FRAME_wait51 = 62;
export const FRAME_wait52 = 63;
export const FRAME_wait53 = 64;
export const FRAME_wait54 = 65;
export const FRAME_wait55 = 66;
export const FRAME_wait56 = 67;
export const FRAME_wait57 = 68;
export const FRAME_wait58 = 69;
export const FRAME_wait59 = 70;
export const FRAME_wait60 = 71;
export const FRAME_wait61 = 72;
export const FRAME_wait62 = 73;
export const FRAME_wait63 = 74;
export const FRAME_wait64 = 75;
export const FRAME_wait65 = 76;
export const FRAME_wait66 = 77;
export const FRAME_wait67 = 78;
export const FRAME_wait68 = 79;
export const FRAME_wait69 = 80;
export const FRAME_wait70 = 81;
export const FRAME_wait71 = 82;
export const FRAME_wait72 = 83;
export const FRAME_wait73 = 84;
export const FRAME_wait74 = 85;
export const FRAME_wait75 = 86;
export const FRAME_wait76 = 87;
export const FRAME_wait77 = 88;
export const FRAME_wait78 = 89;
export const FRAME_wait79 = 90;
export const FRAME_wait80 = 91;
export const FRAME_wait81 = 92;
export const FRAME_wait82 = 93;
export const FRAME_wait83 = 94;
export const FRAME_wait84 = 95;
export const FRAME_wait85 = 96;
export const FRAME_wait86 = 97;
export const FRAME_wait87 = 98;
export const FRAME_wait88 = 99;
export const FRAME_wait89 = 100;
export const FRAME_wait90 = 101;
export const FRAME_run1 = 102;
export const FRAME_run2 = 103;
export const FRAME_run3 = 104;
export const FRAME_run4 = 105;
export const FRAME_run5 = 106;
export const FRAME_run6 = 107;
export const FRAME_paina1 = 108;
export const FRAME_paina2 = 109;
export const FRAME_paina3 = 110;
export const FRAME_paina4 = 111;
export const FRAME_paina5 = 112;
export const FRAME_paina6 = 113;
export const FRAME_paina7 = 114;
export const FRAME_paina8 = 115;
export const FRAME_painb1 = 116;
export const FRAME_painb2 = 117;
export const FRAME_painb3 = 118;
export const FRAME_painb4 = 119;
export const FRAME_painb5 = 120;
export const FRAME_painb6 = 121;
export const FRAME_painb7 = 122;
export const FRAME_painb8 = 123;
export const FRAME_painb9 = 124;
export const FRAME_painb10 = 125;
export const FRAME_painb11 = 126;
export const FRAME_painb12 = 127;
export const FRAME_painb13 = 128;
export const FRAME_painb14 = 129;
export const FRAME_painb15 = 130;
export const FRAME_duck1 = 131;
export const FRAME_duck2 = 132;
export const FRAME_duck3 = 133;
export const FRAME_duck4 = 134;
export const FRAME_duck5 = 135;
export const FRAME_duck6 = 136;
export const FRAME_duck7 = 137;
export const FRAME_duck8 = 138;
export const FRAME_duck9 = 139;
export const FRAME_duck10 = 140;
export const FRAME_duck11 = 141;
export const FRAME_duck12 = 142;
export const FRAME_duck13 = 143;
export const FRAME_duck14 = 144;
export const FRAME_duck15 = 145;
export const FRAME_duck16 = 146;
export const FRAME_death1 = 147;
export const FRAME_death2 = 148;
export const FRAME_death3 = 149;
export const FRAME_death4 = 150;
export const FRAME_death5 = 151;
export const FRAME_death6 = 152;
export const FRAME_death7 = 153;
export const FRAME_death8 = 154;
export const FRAME_death9 = 155;
export const FRAME_death10 = 156;
export const FRAME_death11 = 157;
export const FRAME_death12 = 158;
export const FRAME_death13 = 159;
export const FRAME_death14 = 160;
export const FRAME_death15 = 161;
export const FRAME_death16 = 162;
export const FRAME_death17 = 163;
export const FRAME_death18 = 164;
export const FRAME_death19 = 165;
export const FRAME_death20 = 166;
export const FRAME_death21 = 167;
export const FRAME_death22 = 168;
export const FRAME_death23 = 169;
export const FRAME_death24 = 170;
export const FRAME_death25 = 171;
export const FRAME_death26 = 172;
export const FRAME_death27 = 173;
export const FRAME_death28 = 174;
export const FRAME_death29 = 175;
export const FRAME_death30 = 176;
export const FRAME_attack1 = 177;
export const FRAME_attack2 = 178;
export const FRAME_attack3 = 179;
export const FRAME_attack4 = 180;
export const FRAME_attack5 = 181;
export const FRAME_attack6 = 182;
export const FRAME_attack7 = 183;
export const FRAME_attack8 = 184;
export const FRAME_attack9 = 185;
export const FRAME_attack10 = 186;
export const FRAME_attack11 = 187;
export const FRAME_attack12 = 188;
export const FRAME_attack13 = 189;
export const FRAME_attack14 = 190;
export const FRAME_attack15 = 191;
export const FRAME_attack16 = 192;
export const FRAME_attack17 = 193;
export const FRAME_attack18 = 194;
export const FRAME_attack19 = 195;
export const FRAME_attack20 = 196;
export const FRAME_attack21 = 197;
export const FRAME_attack22 = 198;
export const FRAME_attack23 = 199;
export const FRAME_attack24 = 200;
export const FRAME_attack25 = 201;
export const FRAME_attack26 = 202;
export const FRAME_attack27 = 203;
export const FRAME_attack28 = 204;
export const FRAME_attack29 = 205;
export const FRAME_attack30 = 206;
export const FRAME_attack31 = 207;
export const FRAME_attack32 = 208;
export const FRAME_attack33 = 209;
export const FRAME_attack34 = 210;
export const FRAME_attack35 = 211;
export const FRAME_attack36 = 212;
export const FRAME_attack37 = 213;
export const FRAME_attack38 = 214;
export const FRAME_attack39 = 215;
export const FRAME_attack40 = 216;
export const FRAME_attack41 = 217;
export const FRAME_attack42 = 218;
export const FRAME_attack43 = 219;
export const FRAME_attack44 = 220;
export const FRAME_attack45 = 221;
export const FRAME_attack46 = 222;
export const FRAME_attack47 = 223;
export const FRAME_attack48 = 224;
export const FRAME_attack49 = 225;
export const FRAME_attack50 = 226;
export const FRAME_attack51 = 227;
export const FRAME_attack52 = 228;
export const FRAME_attack53 = 229;
export const FRAME_attack54 = 230;
export const FRAME_attack55 = 231;
export const FRAME_attack56 = 232;
export const FRAME_attack57 = 233;
export const FRAME_attack58 = 234;
export const FRAME_attack59 = 235;
export const FRAME_attack60 = 236;

export const MODEL_SCALE = 1.0;

/**
 * Original name: N/A
 * Source declaree: N/A (local muzzle flash alias)
 * Category: New
 * Purpose: Keep the medic-specific muzzle flash id next to its firing code while using the shared flash table.
 */
export const MZ2_MEDIC_BLASTER_1 = 60;

/**
 * Original name: sound_*
 * Source: Quake-2-master/game/m_medic.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Preserve the medic sound precache paths used by the original sound globals.
 */
const SOUND_IDLE1 = "medic/idle.wav";
const SOUND_PAIN1 = "medic/medpain1.wav";
const SOUND_PAIN2 = "medic/medpain2.wav";
const SOUND_DIE = "medic/meddeth1.wav";
const SOUND_SIGHT = "medic/medsght1.wav";
const SOUND_SEARCH = "medic/medsrch1.wav";
const SOUND_HOOK_LAUNCH = "medic/medatck2.wav";
const SOUND_HOOK_HIT = "medic/medatck3.wav";
const SOUND_HOOK_HEAL = "medic/medatck4.wav";
const SOUND_HOOK_RETRACT = "medic/medatck5.wav";

/**
 * Original name: N/A
 * Source declaree: N/A (runtime sound cache handles)
 * Category: New
 * Purpose: Store registered sound IDs returned by the explicit TypeScript runtime.
 */
let sound_idle1 = 0;
let sound_pain1 = 0;
let sound_pain2 = 0;
let sound_die = 0;
let sound_sight = 0;
let sound_search = 0;
let sound_hook_launch = 0;
let sound_hook_hit = 0;
let sound_hook_heal = 0;
let sound_hook_retract = 0;

/**
 * Original name: medic_FindDeadMonster
 * Source: Quake-2-master/game/m_medic.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Finds the best visible dead monster within medic revive range.
 * Porting notes: Uses runtime entity iteration plus the ported visibility helper instead of `findradius`.
 */
export function medic_FindDeadMonster(self: GameEntity, runtime: GameRuntime): GameEntity | null {
  let best: GameEntity | null = null;

  for (const ent of runtime.entities) {
    if (!ent) {
      continue;
    }
    if (ent === self) {
      continue;
    }
    if ((ent.svflags & SVF_MONSTER) === 0) {
      continue;
    }
    if ((ent.monsterinfo.aiflags & AI_GOOD_GUY) !== 0) {
      continue;
    }
    if (ent.owner) {
      continue;
    }
    if (ent.health > 0) {
      continue;
    }
    if (ent.nextthink) {
      continue;
    }
    if (vec3Distance(ent.s.origin, self.s.origin) > 1024) {
      continue;
    }
    if (!visible(self, ent, runtime)) {
      continue;
    }
    if (!best || ent.max_health > best.max_health) {
      best = ent;
    }
  }

  return best;
}

/**
 * Original name: medic_idle
 * Source: Quake-2-master/game/m_medic.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Plays the idle sound and opportunistically targets a dead monster for revival.
 */
export function medic_idle(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_idle1, SOUND_IDLE1, soundOptions(CHAN_VOICE, ATTN_IDLE));

  const ent = medic_FindDeadMonster(self, runtime);
  if (ent) {
    self.enemy = ent;
    self.enemy.owner = self;
    self.monsterinfo.aiflags |= AI_MEDIC;
    FoundTarget(self, runtime);
  }
}

/**
 * Original name: medic_search
 * Source: Quake-2-master/game/m_medic.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Plays the search sound and, when not already tracking an old enemy, acquires a revive target.
 */
export function medic_search(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_search, SOUND_SEARCH, soundOptions(CHAN_VOICE, ATTN_IDLE));

  if (!self.oldenemy) {
    const ent = medic_FindDeadMonster(self, runtime);
    if (ent) {
      self.oldenemy = self.enemy;
      self.enemy = ent;
      self.enemy.owner = self;
      self.monsterinfo.aiflags |= AI_MEDIC;
      FoundTarget(self, runtime);
    }
  }
}

/**
 * Original name: medic_sight
 * Source: Quake-2-master/game/m_medic.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Plays the sight sound when the medic sees an enemy.
 */
export function medic_sight(self: GameEntity, _other: GameEntity | null, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_sight, SOUND_SIGHT, soundOptions(CHAN_VOICE));
}

const medic_frames_stand = makeFrames(ai_stand, new Array<number>(90).fill(0), indexedThinks(90, [[0, medic_idle]]));
export const medic_move_stand: GameMonsterMove = {
  firstframe: FRAME_wait1,
  lastframe: FRAME_wait90,
  frame: medic_frames_stand,
  endfunc: undefined
};

/**
 * Original name: medic_stand
 * Source: Quake-2-master/game/m_medic.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Selects the medic standing move.
 */
export function medic_stand(self: GameEntity): void {
  self.monsterinfo.currentmove = medic_move_stand;
}

const medic_frames_walk = makeFrames(ai_walk, [6.2, 18.1, 1, 9, 10, 9, 11, 11.6, 2, 9.9, 14, 9.3]);
export const medic_move_walk: GameMonsterMove = {
  firstframe: FRAME_walk1,
  lastframe: FRAME_walk12,
  frame: medic_frames_walk,
  endfunc: undefined
};

/**
 * Original name: medic_walk
 * Source: Quake-2-master/game/m_medic.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Selects the medic walking move.
 */
export function medic_walk(self: GameEntity): void {
  self.monsterinfo.currentmove = medic_move_walk;
}

const medic_frames_run = makeFrames(ai_run, [18, 22.5, 25.4, 23.4, 24, 35.6]);
export const medic_move_run: GameMonsterMove = {
  firstframe: FRAME_run1,
  lastframe: FRAME_run6,
  frame: medic_frames_run,
  endfunc: undefined
};

/**
 * Original name: medic_run
 * Source: Quake-2-master/game/m_medic.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Searches for revive targets unless already in medic mode, then selects stand or run movement.
 */
export function medic_run(self: GameEntity, runtime: GameRuntime): void {
  if ((self.monsterinfo.aiflags & AI_MEDIC) === 0) {
    const ent = medic_FindDeadMonster(self, runtime);
    if (ent) {
      self.oldenemy = self.enemy;
      self.enemy = ent;
      self.enemy.owner = self;
      self.monsterinfo.aiflags |= AI_MEDIC;
      FoundTarget(self, runtime);
      return;
    }
  }

  if ((self.monsterinfo.aiflags & AI_STAND_GROUND) !== 0) {
    self.monsterinfo.currentmove = medic_move_stand;
  } else {
    self.monsterinfo.currentmove = medic_move_run;
  }
}

const medic_frames_pain1 = makeFrames(ai_move, new Array<number>(8).fill(0));
export const medic_move_pain1: GameMonsterMove = {
  firstframe: FRAME_paina1,
  lastframe: FRAME_paina8,
  frame: medic_frames_pain1,
  endfunc: medic_run
};

const medic_frames_pain2 = makeFrames(ai_move, new Array<number>(15).fill(0));
export const medic_move_pain2: GameMonsterMove = {
  firstframe: FRAME_painb1,
  lastframe: FRAME_painb15,
  frame: medic_frames_pain2,
  endfunc: medic_run
};

/**
 * Original name: medic_pain
 * Source: Quake-2-master/game/m_medic.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Applies medic pain skin/debounce, skips pain animations in nightmare, then chooses pain animation and sound with `random() < 0.5`.
 * Porting notes: Uses the shared `g_local.random()` helper so the macro C 15-bit float semantics stay centralized.
 */
export function medic_pain(
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

  if (random() < 0.5) {
    self.monsterinfo.currentmove = medic_move_pain1;
    emitRegisteredGameSound(runtime, self, sound_pain1, SOUND_PAIN1, soundOptions(CHAN_VOICE));
  } else {
    self.monsterinfo.currentmove = medic_move_pain2;
    emitRegisteredGameSound(runtime, self, sound_pain2, SOUND_PAIN2, soundOptions(CHAN_VOICE));
  }
}

/**
 * Original name: medic_fire_blaster
 * Source: Quake-2-master/game/m_medic.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Projects the medic muzzle flash from `MZ2_MEDIC_BLASTER_1`, aims at the enemy viewheight, and selects the C blaster/hyperblaster effect by attack frame.
 * Porting notes: The source assumes `self->enemy` is valid when attack frames call this function; the TS port returns early if an invalid runtime callback reaches it without an enemy.
 */
export function medic_fire_blaster(self: GameEntity, runtime: GameRuntime): void {
  if (!self.enemy) {
    return;
  }

  let effect = 0;
  if (self.s.frame === FRAME_attack9 || self.s.frame === FRAME_attack12) {
    effect = EF_BLASTER;
  } else if (
    self.s.frame === FRAME_attack19 ||
    self.s.frame === FRAME_attack22 ||
    self.s.frame === FRAME_attack25 ||
    self.s.frame === FRAME_attack28
  ) {
    effect = EF_HYPERBLASTER;
  }

  const { forward, right } = AngleVectors(self.s.angles);
  const start = G_ProjectSource(self.s.origin, getMonsterFlashOffset(MZ2_MEDIC_BLASTER_1), forward, right);
  const end: vec3_t = [...self.enemy.s.origin];
  end[2] += self.enemy.viewheight;
  const dir = subtractVec3(end, start);

  monster_fire_blaster(self, start, dir, 2, 1000, MZ2_MEDIC_BLASTER_1, effect, runtime);
}

/**
 * Original name: medic_dead
 * Source: Quake-2-master/game/m_medic.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Shrinks the medic corpse bounds, switches to toss movement, marks it as a dead monster, clears thinking and relinks it.
 */
export function medic_dead(self: GameEntity, runtime: GameRuntime): void {
  setVec3(self.mins, -16, -16, -24);
  setVec3(self.maxs, 16, 16, -8);
  self.movetype = MOVETYPE_TOSS;
  self.svflags |= SVF_DEADMONSTER;
  self.nextthink = 0;
  linkGameEntity(runtime, self);
}

const medic_frames_death = makeFrames(ai_move, new Array<number>(30).fill(0));
export const medic_move_death: GameMonsterMove = {
  firstframe: FRAME_death1,
  lastframe: FRAME_death30,
  frame: medic_frames_death,
  endfunc: medic_dead
};

/**
 * Original name: medic_die
 * Source: Quake-2-master/game/m_medic.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Releases a pending patient, handles gib death with the original gib counts/models, otherwise starts the regular death move.
 * Porting notes: The local C loop counter `n` is represented by scoped TypeScript loop variables.
 */
export function medic_die(
  self: GameEntity,
  _inflictor: GameEntity | null,
  _attacker: GameEntity | null,
  damage: number,
  runtime: GameRuntime
): void {
  if (self.enemy && self.enemy.owner === self) {
    self.enemy.owner = null;
  }

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

  emitRegisteredGameSound(runtime, self, sound_die, SOUND_DIE, soundOptions(CHAN_VOICE));
  self.deadflag = DEAD_DEAD;
  self.takedamage = damage_t.DAMAGE_YES;
  self.monsterinfo.currentmove = medic_move_death;
}

/**
 * Original name: medic_duck_down
 * Source: Quake-2-master/game/m_medic.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Enters ducked state once, lowers the collision top by 32 units, enables damage, sets pause time and relinks.
 */
export function medic_duck_down(self: GameEntity, runtime: GameRuntime): void {
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
 * Original name: medic_duck_hold
 * Source: Quake-2-master/game/m_medic.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Holds or releases the current animation frame according to the duck pause time.
 */
export function medic_duck_hold(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.time >= self.monsterinfo.pausetime) {
    self.monsterinfo.aiflags &= ~AI_HOLD_FRAME;
  } else {
    self.monsterinfo.aiflags |= AI_HOLD_FRAME;
  }
}

/**
 * Original name: medic_duck_up
 * Source: Quake-2-master/game/m_medic.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Leaves ducked state, restores the collision top by 32 units, restores aim damage and relinks.
 */
export function medic_duck_up(self: GameEntity, runtime: GameRuntime): void {
  self.monsterinfo.aiflags &= ~AI_DUCKED;
  self.maxs[2] += 32;
  self.takedamage = damage_t.DAMAGE_AIM;
  linkGameEntity(runtime, self);
}

const medic_frames_duck = makeFrames(
  ai_move,
  [-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1],
  indexedThinks(16, [
    [2, medic_duck_down],
    [3, medic_duck_hold],
    [6, medic_duck_up]
  ])
);
export const medic_move_duck: GameMonsterMove = {
  firstframe: FRAME_duck1,
  lastframe: FRAME_duck16,
  frame: medic_frames_duck,
  endfunc: medic_run
};

/**
 * Original name: medic_dodge
 * Source: Quake-2-master/game/m_medic.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Gives the medic a 25% chance to duck, adopting the attacker as enemy when needed.
 * Porting notes: Uses the shared `g_local.random()` helper for the original macro threshold.
 */
export function medic_dodge(self: GameEntity, attacker: GameEntity | null, _eta: number): void {
  if (random() > 0.25) {
    return;
  }

  if (!self.enemy) {
    self.enemy = attacker;
  }

  self.monsterinfo.currentmove = medic_move_duck;
}

const medic_frames_attackHyperBlaster = makeFrames(
  ai_charge,
  new Array<number>(16).fill(0),
  indexedThinks(16, [
    [4, medic_fire_blaster],
    [5, medic_fire_blaster],
    [6, medic_fire_blaster],
    [7, medic_fire_blaster],
    [8, medic_fire_blaster],
    [9, medic_fire_blaster],
    [10, medic_fire_blaster],
    [11, medic_fire_blaster],
    [12, medic_fire_blaster],
    [13, medic_fire_blaster],
    [14, medic_fire_blaster],
    [15, medic_fire_blaster]
  ])
);
export const medic_move_attackHyperBlaster: GameMonsterMove = {
  firstframe: FRAME_attack15,
  lastframe: FRAME_attack30,
  frame: medic_frames_attackHyperBlaster,
  endfunc: medic_run
};

/**
 * Original name: medic_continue
 * Source: Quake-2-master/game/m_medic.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Continues a visible blaster attack into the hyperblaster move with the original 95% random chance.
 * Porting notes: Keeps the C visibility gate and centralizes the macro `random()` call through `g_local.random()`.
 */
export function medic_continue(self: GameEntity, runtime: GameRuntime): void {
  if (self.enemy && visible(self, self.enemy, runtime) && random() <= 0.95) {
    self.monsterinfo.currentmove = medic_move_attackHyperBlaster;
  }
}

const medic_frames_attackBlaster = makeFrames(
  ai_charge,
  [0, 5, 5, 3, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  indexedThinks(14, [
    [8, medic_fire_blaster],
    [11, medic_fire_blaster],
    [13, medic_continue]
  ])
);
export const medic_move_attackBlaster: GameMonsterMove = {
  firstframe: FRAME_attack1,
  lastframe: FRAME_attack14,
  frame: medic_frames_attackBlaster,
  endfunc: medic_run
};

/**
 * Original name: medic_hook_launch
 * Source: Quake-2-master/game/m_medic.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Plays the medic cable launch sound on the weapon channel.
 */
export function medic_hook_launch(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_hook_launch, SOUND_HOOK_LAUNCH, soundOptions(CHAN_WEAPON));
}

const medic_cable_offsets: readonly vec3_t[] = [
  [45.0, -9.2, 15.5],
  [48.4, -9.7, 15.2],
  [47.8, -9.8, 15.8],
  [47.3, -9.3, 14.3],
  [45.4, -10.1, 13.1],
  [41.9, -12.7, 12.0],
  [37.8, -15.8, 11.2],
  [34.3, -18.4, 10.7],
  [32.7, -19.7, 10.4],
  [32.7, -19.7, 10.4]
];

/**
 * Original name: medic_cable_attack
 * Source: Quake-2-master/game/m_medic.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Maintains the medic resurrection cable, including range/pitch/trace guards, hit/heal sounds,
 *   respawn of the dead monster, and the visible cable temp entity.
 *
 * Porting notes:
 * - Uses the explicit collision adapter and structured temp-entity queue instead of `gi.trace`
 *   and direct network writes.
 */
export function medic_cable_attack(self: GameEntity, runtime: GameRuntime): void {
  if (!self.enemy || !self.enemy.inuse) {
    return;
  }

  const { forward: f, right: r } = AngleVectors(self.s.angles);
  const offset = medic_cable_offsets[self.s.frame - FRAME_attack42] ?? medic_cable_offsets[0];
  let start = G_ProjectSource(self.s.origin, offset, f, r);

  const dir = subtractVec3(start, self.enemy.s.origin);
  if (vec3Length(dir) > 256) {
    return;
  }

  const angles = vectoangles(dir);
  if (angles[PITCH] < -180) {
    angles[PITCH] += 360;
  }
  if (Math.abs(angles[PITCH]) > 45) {
    return;
  }

  const tr = runtime.collision?.trace(start, [0, 0, 0], [0, 0, 0], self.enemy.s.origin, self, MASK_SHOT);
  if (tr && tr.fraction !== 1.0 && tr.ent !== self.enemy) {
    return;
  }

  if (self.s.frame === FRAME_attack43) {
    emitRegisteredGameSound(runtime, self.enemy, sound_hook_hit, SOUND_HOOK_HIT, soundOptions(CHAN_AUTO));
    self.enemy.monsterinfo.aiflags |= AI_RESURRECTING;
  } else if (self.s.frame === FRAME_attack50) {
    self.enemy.spawnflags = 0;
    self.enemy.monsterinfo.aiflags = 0;
    self.enemy.target = undefined;
    self.enemy.targetname = undefined;
    self.enemy.combattarget = undefined;
    self.enemy.deathtarget = undefined;
    self.enemy.owner = self;
    ED_CallSpawn(self.enemy, runtime);
    self.enemy.owner = null;
    if (self.enemy.think) {
      self.enemy.nextthink = runtime.time;
      self.enemy.think(self.enemy, runtime);
    }
    self.enemy.monsterinfo.aiflags |= AI_RESURRECTING;
    if (self.oldenemy?.client) {
      self.enemy.enemy = self.oldenemy;
      FoundTarget(self.enemy, runtime);
    }
  } else if (self.s.frame === FRAME_attack44) {
    emitRegisteredGameSound(runtime, self, sound_hook_heal, SOUND_HOOK_HEAL, soundOptions(CHAN_WEAPON));
  }

  start = vectorMA(start, 8, f);
  const end: vec3_t = [...self.enemy.s.origin];
  end[2] = self.enemy.absmin[2] + self.enemy.size[2] / 2;

  emitGameTempEntity(runtime, temp_event_t.TE_MEDIC_CABLE_ATTACK, self.s.origin, multicast_t.MULTICAST_PVS, {
    entityIndex: self.index,
    start,
    end
  });
}

/**
 * Original name: medic_hook_retract
 * Source: Quake-2-master/game/m_medic.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Plays the cable retract sound and clears the target's resurrection flag.
 */
export function medic_hook_retract(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_hook_retract, SOUND_HOOK_RETRACT, soundOptions(CHAN_WEAPON));
  if (self.enemy) {
    self.enemy.monsterinfo.aiflags &= ~AI_RESURRECTING;
  }
}

const medic_frames_attackCable = makeFrames(
  ai_move,
  [2, 3, 5, 4.4, 4.7, 5, 6, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -15, -1.5, -1.2, -3, -2, 0.3, 0.7, 1.2, 1.3],
  indexedThinks(28, [
    [9, medic_hook_launch],
    [10, medic_cable_attack],
    [11, medic_cable_attack],
    [12, medic_cable_attack],
    [13, medic_cable_attack],
    [14, medic_cable_attack],
    [15, medic_cable_attack],
    [16, medic_cable_attack],
    [17, medic_cable_attack],
    [18, medic_cable_attack],
    [19, medic_hook_retract]
  ])
);
medic_frames_attackCable[4].aifunc = ai_charge;
medic_frames_attackCable[5].aifunc = ai_charge;
medic_frames_attackCable[6].aifunc = ai_charge;
medic_frames_attackCable[7].aifunc = ai_charge;
medic_frames_attackCable[8].aifunc = ai_charge;

export const medic_move_attackCable: GameMonsterMove = {
  firstframe: FRAME_attack33,
  lastframe: FRAME_attack60,
  frame: medic_frames_attackCable,
  endfunc: medic_run
};

/**
 * Original name: medic_attack
 * Source: Quake-2-master/game/m_medic.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Chooses the resurrection cable move while acting as a medic, otherwise the blaster attack.
 */
export function medic_attack(self: GameEntity): void {
  if ((self.monsterinfo.aiflags & AI_MEDIC) !== 0) {
    self.monsterinfo.currentmove = medic_move_attackCable;
  } else {
    self.monsterinfo.currentmove = medic_move_attackBlaster;
  }
}

/**
 * Original name: medic_checkattack
 * Source: Quake-2-master/game/m_medic.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Forces the cable attack for resurrection targets, otherwise defers to `M_CheckAttack`.
 */
export function medic_checkattack(self: GameEntity, runtime: GameRuntime): boolean {
  if ((self.monsterinfo.aiflags & AI_MEDIC) !== 0) {
    medic_attack(self);
    return true;
  }

  return M_CheckAttack(self, runtime);
}

/**
 * Original name: SP_monster_medic
 * Source: Quake-2-master/game/m_medic.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Precaches medic assets and initializes the monster_medic entity, callbacks, bounds,
 *   health, model and starting move.
 *
 * Porting notes:
 * - Preserves the deathmatch free path and routes linking/startup through the explicit
 *   gameplay runtime.
 */
export function SP_monster_medic(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  precacheMedicAssets(runtime);

  self.movetype = MOVETYPE_STEP;
  self.solid = SOLID_BBOX;
  self.s.modelindex = registerGameModel(runtime, "models/monsters/medic/tris.md2");
  setVec3(self.mins, -24, -24, -24);
  setVec3(self.maxs, 24, 24, 32);

  self.health = 300;
  self.gib_health = -130;
  self.mass = 400;

  self.pain = medic_pain;
  self.die = medic_die;

  self.monsterinfo.stand = medic_stand;
  self.monsterinfo.walk = medic_walk;
  self.monsterinfo.run = medic_run;
  self.monsterinfo.dodge = medic_dodge;
  self.monsterinfo.attack = medic_attack;
  self.monsterinfo.melee = undefined;
  self.monsterinfo.sight = medic_sight;
  self.monsterinfo.idle = medic_idle;
  self.monsterinfo.search = medic_search;
  self.monsterinfo.checkattack = medic_checkattack;

  linkGameEntity(runtime, self);

  self.monsterinfo.currentmove = medic_move_stand;
  self.monsterinfo.scale = MODEL_SCALE;

  walkmonster_start(self, runtime);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local frame table helper)
 * Category: New
 * Purpose: Convert compact distance and think arrays into runtime monster frame records.
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
 * Original name: N/A
 * Source declaree: N/A (local precache helper)
 * Category: New
 * Purpose: Centralize medic sound registration while preserving source precache order.
 */
function precacheMedicAssets(runtime: GameRuntime): void {
  sound_idle1 = registerGameSound(runtime, SOUND_IDLE1);
  sound_pain1 = registerGameSound(runtime, SOUND_PAIN1);
  sound_pain2 = registerGameSound(runtime, SOUND_PAIN2);
  sound_die = registerGameSound(runtime, SOUND_DIE);
  sound_sight = registerGameSound(runtime, SOUND_SIGHT);
  sound_search = registerGameSound(runtime, SOUND_SEARCH);
  sound_hook_launch = registerGameSound(runtime, SOUND_HOOK_LAUNCH);
  sound_hook_hit = registerGameSound(runtime, SOUND_HOOK_HIT);
  sound_hook_heal = registerGameSound(runtime, SOUND_HOOK_HEAL);
  sound_hook_retract = registerGameSound(runtime, SOUND_HOOK_RETRACT);
  registerGameSound(runtime, "medic/medatck1.wav");
}

/**
 * Original name: N/A
 * Source declaree: N/A (local sound helper)
 * Category: New
 * Purpose: Create runtime sound option records matching the original `gi.sound` defaults.
 */
function soundOptions(channel: number, attenuation = ATTN_NORM): { channel: number; volume: number; attenuation: number; timeofs: number } {
  return {
    channel,
    volume: 1,
    attenuation,
    timeofs: 0
  };
}

/**
 * Original name: N/A
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Mutate bbox vectors in place for spawn and corpse bounds setup.
 */
function setVec3(vector: [number, number, number], x: number, y: number, z: number): void {
  vector[0] = x;
  vector[1] = y;
  vector[2] = z;
}

/**
 * Original name: N/A
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Build temporary direction vectors for medic fire and cable checks.
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
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Add a scaled direction vector for the visible medic cable endpoint.
 */
function vectorMA(vector: vec3_t, scale: number, direction: vec3_t): vec3_t {
  return [
    vector[0] + scale * direction[0],
    vector[1] + scale * direction[1],
    vector[2] + scale * direction[2]
  ];
}

/**
 * Original name: N/A
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Measure temporary vectors for medic range checks without mutating entity state.
 */
function vec3Length(vector: vec3_t): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local vector helper)
 * Category: New
 * Purpose: Measure distance between medic and revive candidates using local vector helpers.
 */
function vec3Distance(left: vec3_t, right: vec3_t): number {
  return vec3Length(subtractVec3(left, right));
}
