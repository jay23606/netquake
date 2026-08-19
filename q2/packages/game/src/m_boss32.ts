/**
 * File: m_boss32.ts
 * Source: Quake II original / game/m_boss32.h and game/m_boss32.c
 * Purpose: Port of the generated boss32 model frame constants and Makron final boss gameplay behavior.
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
 * - This file keeps the header constants and C behavior together as the principal attachment point for `m_boss32`.
 */

import {
  AngleVectors,
  ATTN_NONE,
  ATTN_NORM,
  CHAN_AUTO,
  CHAN_BODY,
  CHAN_VOICE,
  CHAN_WEAPON,
  EF_BLASTER,
  YAW,
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
  FL_FLY,
  FRAMETIME,
  GIB_METALLIC,
  GIB_ORGANIC,
  MOVETYPE_NONE,
  MOVETYPE_STEP,
  MOVETYPE_TOSS,
  RANGE_FAR,
  RANGE_MELEE,
  RANGE_MID,
  RANGE_NEAR,
  SOLID_BBOX,
  SOLID_NOT,
  SVF_DEADMONSTER,
  damage_t,
  random
} from "./g_local.js";
import { ai_charge, ai_move, ai_run, ai_stand, ai_walk, range } from "./g_ai.js";
import { monster_fire_bfg, monster_fire_blaster, monster_fire_railgun, walkmonster_start } from "./g_monster.js";
import { ThrowGib, ThrowHead } from "./g_misc.js";
import { G_FreeEdict, G_ProjectSource, G_Spawn, vectoangles, vectoyaw } from "./g_utils.js";
import { getMonsterFlashOffset } from "./m_flash.js";
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

export const FRAME_attak101 = 0;
export const FRAME_attak102 = 1;
export const FRAME_attak103 = 2;
export const FRAME_attak104 = 3;
export const FRAME_attak105 = 4;
export const FRAME_attak106 = 5;
export const FRAME_attak107 = 6;
export const FRAME_attak108 = 7;
export const FRAME_attak109 = 8;
export const FRAME_attak110 = 9;
export const FRAME_attak111 = 10;
export const FRAME_attak112 = 11;
export const FRAME_attak113 = 12;
export const FRAME_attak114 = 13;
export const FRAME_attak115 = 14;
export const FRAME_attak116 = 15;
export const FRAME_attak117 = 16;
export const FRAME_attak118 = 17;
export const FRAME_attak201 = 18;
export const FRAME_attak202 = 19;
export const FRAME_attak203 = 20;
export const FRAME_attak204 = 21;
export const FRAME_attak205 = 22;
export const FRAME_attak206 = 23;
export const FRAME_attak207 = 24;
export const FRAME_attak208 = 25;
export const FRAME_attak209 = 26;
export const FRAME_attak210 = 27;
export const FRAME_attak211 = 28;
export const FRAME_attak212 = 29;
export const FRAME_attak213 = 30;
export const FRAME_death01 = 31;
export const FRAME_death02 = 32;
export const FRAME_death03 = 33;
export const FRAME_death04 = 34;
export const FRAME_death05 = 35;
export const FRAME_death06 = 36;
export const FRAME_death07 = 37;
export const FRAME_death08 = 38;
export const FRAME_death09 = 39;
export const FRAME_death10 = 40;
export const FRAME_death11 = 41;
export const FRAME_death12 = 42;
export const FRAME_death13 = 43;
export const FRAME_death14 = 44;
export const FRAME_death15 = 45;
export const FRAME_death16 = 46;
export const FRAME_death17 = 47;
export const FRAME_death18 = 48;
export const FRAME_death19 = 49;
export const FRAME_death20 = 50;
export const FRAME_death21 = 51;
export const FRAME_death22 = 52;
export const FRAME_death23 = 53;
export const FRAME_death24 = 54;
export const FRAME_death25 = 55;
export const FRAME_death26 = 56;
export const FRAME_death27 = 57;
export const FRAME_death28 = 58;
export const FRAME_death29 = 59;
export const FRAME_death30 = 60;
export const FRAME_death31 = 61;
export const FRAME_death32 = 62;
export const FRAME_death33 = 63;
export const FRAME_death34 = 64;
export const FRAME_death35 = 65;
export const FRAME_death36 = 66;
export const FRAME_death37 = 67;
export const FRAME_death38 = 68;
export const FRAME_death39 = 69;
export const FRAME_death40 = 70;
export const FRAME_death41 = 71;
export const FRAME_death42 = 72;
export const FRAME_death43 = 73;
export const FRAME_death44 = 74;
export const FRAME_death45 = 75;
export const FRAME_death46 = 76;
export const FRAME_death47 = 77;
export const FRAME_death48 = 78;
export const FRAME_death49 = 79;
export const FRAME_death50 = 80;
export const FRAME_pain101 = 81;
export const FRAME_pain102 = 82;
export const FRAME_pain103 = 83;
export const FRAME_pain201 = 84;
export const FRAME_pain202 = 85;
export const FRAME_pain203 = 86;
export const FRAME_pain301 = 87;
export const FRAME_pain302 = 88;
export const FRAME_pain303 = 89;
export const FRAME_pain304 = 90;
export const FRAME_pain305 = 91;
export const FRAME_pain306 = 92;
export const FRAME_pain307 = 93;
export const FRAME_pain308 = 94;
export const FRAME_pain309 = 95;
export const FRAME_pain310 = 96;
export const FRAME_pain311 = 97;
export const FRAME_pain312 = 98;
export const FRAME_pain313 = 99;
export const FRAME_pain314 = 100;
export const FRAME_pain315 = 101;
export const FRAME_pain316 = 102;
export const FRAME_pain317 = 103;
export const FRAME_pain318 = 104;
export const FRAME_pain319 = 105;
export const FRAME_pain320 = 106;
export const FRAME_pain321 = 107;
export const FRAME_pain322 = 108;
export const FRAME_pain323 = 109;
export const FRAME_pain324 = 110;
export const FRAME_pain325 = 111;
export const FRAME_stand01 = 112;
export const FRAME_stand02 = 113;
export const FRAME_stand03 = 114;
export const FRAME_stand04 = 115;
export const FRAME_stand05 = 116;
export const FRAME_stand06 = 117;
export const FRAME_stand07 = 118;
export const FRAME_stand08 = 119;
export const FRAME_stand09 = 120;
export const FRAME_stand10 = 121;
export const FRAME_stand11 = 122;
export const FRAME_stand12 = 123;
export const FRAME_stand13 = 124;
export const FRAME_stand14 = 125;
export const FRAME_stand15 = 126;
export const FRAME_stand16 = 127;
export const FRAME_stand17 = 128;
export const FRAME_stand18 = 129;
export const FRAME_stand19 = 130;
export const FRAME_stand20 = 131;
export const FRAME_stand21 = 132;
export const FRAME_stand22 = 133;
export const FRAME_stand23 = 134;
export const FRAME_stand24 = 135;
export const FRAME_stand25 = 136;
export const FRAME_stand26 = 137;
export const FRAME_stand27 = 138;
export const FRAME_stand28 = 139;
export const FRAME_stand29 = 140;
export const FRAME_stand30 = 141;
export const FRAME_stand31 = 142;
export const FRAME_stand32 = 143;
export const FRAME_stand33 = 144;
export const FRAME_stand34 = 145;
export const FRAME_stand35 = 146;
export const FRAME_stand36 = 147;
export const FRAME_stand37 = 148;
export const FRAME_stand38 = 149;
export const FRAME_stand39 = 150;
export const FRAME_stand40 = 151;
export const FRAME_stand41 = 152;
export const FRAME_stand42 = 153;
export const FRAME_stand43 = 154;
export const FRAME_stand44 = 155;
export const FRAME_stand45 = 156;
export const FRAME_stand46 = 157;
export const FRAME_stand47 = 158;
export const FRAME_stand48 = 159;
export const FRAME_stand49 = 160;
export const FRAME_stand50 = 161;
export const FRAME_stand51 = 162;
export const FRAME_walk01 = 163;
export const FRAME_walk02 = 164;
export const FRAME_walk03 = 165;
export const FRAME_walk04 = 166;
export const FRAME_walk05 = 167;
export const FRAME_walk06 = 168;
export const FRAME_walk07 = 169;
export const FRAME_walk08 = 170;
export const FRAME_walk09 = 171;
export const FRAME_walk10 = 172;
export const FRAME_walk11 = 173;
export const FRAME_walk12 = 174;
export const FRAME_walk13 = 175;
export const FRAME_walk14 = 176;
export const FRAME_walk15 = 177;
export const FRAME_walk16 = 178;
export const FRAME_walk17 = 179;
export const FRAME_walk18 = 180;
export const FRAME_walk19 = 181;
export const FRAME_walk20 = 182;
export const FRAME_walk21 = 183;
export const FRAME_walk22 = 184;
export const FRAME_walk23 = 185;
export const FRAME_walk24 = 186;
export const FRAME_walk25 = 187;
export const FRAME_active01 = 188;
export const FRAME_active02 = 189;
export const FRAME_active03 = 190;
export const FRAME_active04 = 191;
export const FRAME_active05 = 192;
export const FRAME_active06 = 193;
export const FRAME_active07 = 194;
export const FRAME_active08 = 195;
export const FRAME_active09 = 196;
export const FRAME_active10 = 197;
export const FRAME_active11 = 198;
export const FRAME_active12 = 199;
export const FRAME_active13 = 200;
export const FRAME_attak301 = 201;
export const FRAME_attak302 = 202;
export const FRAME_attak303 = 203;
export const FRAME_attak304 = 204;
export const FRAME_attak305 = 205;
export const FRAME_attak306 = 206;
export const FRAME_attak307 = 207;
export const FRAME_attak308 = 208;
export const FRAME_attak401 = 209;
export const FRAME_attak402 = 210;
export const FRAME_attak403 = 211;
export const FRAME_attak404 = 212;
export const FRAME_attak405 = 213;
export const FRAME_attak406 = 214;
export const FRAME_attak407 = 215;
export const FRAME_attak408 = 216;
export const FRAME_attak409 = 217;
export const FRAME_attak410 = 218;
export const FRAME_attak411 = 219;
export const FRAME_attak412 = 220;
export const FRAME_attak413 = 221;
export const FRAME_attak414 = 222;
export const FRAME_attak415 = 223;
export const FRAME_attak416 = 224;
export const FRAME_attak417 = 225;
export const FRAME_attak418 = 226;
export const FRAME_attak419 = 227;
export const FRAME_attak420 = 228;
export const FRAME_attak421 = 229;
export const FRAME_attak422 = 230;
export const FRAME_attak423 = 231;
export const FRAME_attak424 = 232;
export const FRAME_attak425 = 233;
export const FRAME_attak426 = 234;
export const FRAME_attak501 = 235;
export const FRAME_attak502 = 236;
export const FRAME_attak503 = 237;
export const FRAME_attak504 = 238;
export const FRAME_attak505 = 239;
export const FRAME_attak506 = 240;
export const FRAME_attak507 = 241;
export const FRAME_attak508 = 242;
export const FRAME_attak509 = 243;
export const FRAME_attak510 = 244;
export const FRAME_attak511 = 245;
export const FRAME_attak512 = 246;
export const FRAME_attak513 = 247;
export const FRAME_attak514 = 248;
export const FRAME_attak515 = 249;
export const FRAME_attak516 = 250;
export const FRAME_death201 = 251;
export const FRAME_death202 = 252;
export const FRAME_death203 = 253;
export const FRAME_death204 = 254;
export const FRAME_death205 = 255;
export const FRAME_death206 = 256;
export const FRAME_death207 = 257;
export const FRAME_death208 = 258;
export const FRAME_death209 = 259;
export const FRAME_death210 = 260;
export const FRAME_death211 = 261;
export const FRAME_death212 = 262;
export const FRAME_death213 = 263;
export const FRAME_death214 = 264;
export const FRAME_death215 = 265;
export const FRAME_death216 = 266;
export const FRAME_death217 = 267;
export const FRAME_death218 = 268;
export const FRAME_death219 = 269;
export const FRAME_death220 = 270;
export const FRAME_death221 = 271;
export const FRAME_death222 = 272;
export const FRAME_death223 = 273;
export const FRAME_death224 = 274;
export const FRAME_death225 = 275;
export const FRAME_death226 = 276;
export const FRAME_death227 = 277;
export const FRAME_death228 = 278;
export const FRAME_death229 = 279;
export const FRAME_death230 = 280;
export const FRAME_death231 = 281;
export const FRAME_death232 = 282;
export const FRAME_death233 = 283;
export const FRAME_death234 = 284;
export const FRAME_death235 = 285;
export const FRAME_death236 = 286;
export const FRAME_death237 = 287;
export const FRAME_death238 = 288;
export const FRAME_death239 = 289;
export const FRAME_death240 = 290;
export const FRAME_death241 = 291;
export const FRAME_death242 = 292;
export const FRAME_death243 = 293;
export const FRAME_death244 = 294;
export const FRAME_death245 = 295;
export const FRAME_death246 = 296;
export const FRAME_death247 = 297;
export const FRAME_death248 = 298;
export const FRAME_death249 = 299;
export const FRAME_death250 = 300;
export const FRAME_death251 = 301;
export const FRAME_death252 = 302;
export const FRAME_death253 = 303;
export const FRAME_death254 = 304;
export const FRAME_death255 = 305;
export const FRAME_death256 = 306;
export const FRAME_death257 = 307;
export const FRAME_death258 = 308;
export const FRAME_death259 = 309;
export const FRAME_death260 = 310;
export const FRAME_death261 = 311;
export const FRAME_death262 = 312;
export const FRAME_death263 = 313;
export const FRAME_death264 = 314;
export const FRAME_death265 = 315;
export const FRAME_death266 = 316;
export const FRAME_death267 = 317;
export const FRAME_death268 = 318;
export const FRAME_death269 = 319;
export const FRAME_death270 = 320;
export const FRAME_death271 = 321;
export const FRAME_death272 = 322;
export const FRAME_death273 = 323;
export const FRAME_death274 = 324;
export const FRAME_death275 = 325;
export const FRAME_death276 = 326;
export const FRAME_death277 = 327;
export const FRAME_death278 = 328;
export const FRAME_death279 = 329;
export const FRAME_death280 = 330;
export const FRAME_death281 = 331;
export const FRAME_death282 = 332;
export const FRAME_death283 = 333;
export const FRAME_death284 = 334;
export const FRAME_death285 = 335;
export const FRAME_death286 = 336;
export const FRAME_death287 = 337;
export const FRAME_death288 = 338;
export const FRAME_death289 = 339;
export const FRAME_death290 = 340;
export const FRAME_death291 = 341;
export const FRAME_death292 = 342;
export const FRAME_death293 = 343;
export const FRAME_death294 = 344;
export const FRAME_death295 = 345;
export const FRAME_death301 = 346;
export const FRAME_death302 = 347;
export const FRAME_death303 = 348;
export const FRAME_death304 = 349;
export const FRAME_death305 = 350;
export const FRAME_death306 = 351;
export const FRAME_death307 = 352;
export const FRAME_death308 = 353;
export const FRAME_death309 = 354;
export const FRAME_death310 = 355;
export const FRAME_death311 = 356;
export const FRAME_death312 = 357;
export const FRAME_death313 = 358;
export const FRAME_death314 = 359;
export const FRAME_death315 = 360;
export const FRAME_death316 = 361;
export const FRAME_death317 = 362;
export const FRAME_death318 = 363;
export const FRAME_death319 = 364;
export const FRAME_death320 = 365;
export const FRAME_jump01 = 366;
export const FRAME_jump02 = 367;
export const FRAME_jump03 = 368;
export const FRAME_jump04 = 369;
export const FRAME_jump05 = 370;
export const FRAME_jump06 = 371;
export const FRAME_jump07 = 372;
export const FRAME_jump08 = 373;
export const FRAME_jump09 = 374;
export const FRAME_jump10 = 375;
export const FRAME_jump11 = 376;
export const FRAME_jump12 = 377;
export const FRAME_jump13 = 378;
export const FRAME_pain401 = 379;
export const FRAME_pain402 = 380;
export const FRAME_pain403 = 381;
export const FRAME_pain404 = 382;
export const FRAME_pain501 = 383;
export const FRAME_pain502 = 384;
export const FRAME_pain503 = 385;
export const FRAME_pain504 = 386;
export const FRAME_pain601 = 387;
export const FRAME_pain602 = 388;
export const FRAME_pain603 = 389;
export const FRAME_pain604 = 390;
export const FRAME_pain605 = 391;
export const FRAME_pain606 = 392;
export const FRAME_pain607 = 393;
export const FRAME_pain608 = 394;
export const FRAME_pain609 = 395;
export const FRAME_pain610 = 396;
export const FRAME_pain611 = 397;
export const FRAME_pain612 = 398;
export const FRAME_pain613 = 399;
export const FRAME_pain614 = 400;
export const FRAME_pain615 = 401;
export const FRAME_pain616 = 402;
export const FRAME_pain617 = 403;
export const FRAME_pain618 = 404;
export const FRAME_pain619 = 405;
export const FRAME_pain620 = 406;
export const FRAME_pain621 = 407;
export const FRAME_pain622 = 408;
export const FRAME_pain623 = 409;
export const FRAME_pain624 = 410;
export const FRAME_pain625 = 411;
export const FRAME_pain626 = 412;
export const FRAME_pain627 = 413;
export const FRAME_stand201 = 414;
export const FRAME_stand202 = 415;
export const FRAME_stand203 = 416;
export const FRAME_stand204 = 417;
export const FRAME_stand205 = 418;
export const FRAME_stand206 = 419;
export const FRAME_stand207 = 420;
export const FRAME_stand208 = 421;
export const FRAME_stand209 = 422;
export const FRAME_stand210 = 423;
export const FRAME_stand211 = 424;
export const FRAME_stand212 = 425;
export const FRAME_stand213 = 426;
export const FRAME_stand214 = 427;
export const FRAME_stand215 = 428;
export const FRAME_stand216 = 429;
export const FRAME_stand217 = 430;
export const FRAME_stand218 = 431;
export const FRAME_stand219 = 432;
export const FRAME_stand220 = 433;
export const FRAME_stand221 = 434;
export const FRAME_stand222 = 435;
export const FRAME_stand223 = 436;
export const FRAME_stand224 = 437;
export const FRAME_stand225 = 438;
export const FRAME_stand226 = 439;
export const FRAME_stand227 = 440;
export const FRAME_stand228 = 441;
export const FRAME_stand229 = 442;
export const FRAME_stand230 = 443;
export const FRAME_stand231 = 444;
export const FRAME_stand232 = 445;
export const FRAME_stand233 = 446;
export const FRAME_stand234 = 447;
export const FRAME_stand235 = 448;
export const FRAME_stand236 = 449;
export const FRAME_stand237 = 450;
export const FRAME_stand238 = 451;
export const FRAME_stand239 = 452;
export const FRAME_stand240 = 453;
export const FRAME_stand241 = 454;
export const FRAME_stand242 = 455;
export const FRAME_stand243 = 456;
export const FRAME_stand244 = 457;
export const FRAME_stand245 = 458;
export const FRAME_stand246 = 459;
export const FRAME_stand247 = 460;
export const FRAME_stand248 = 461;
export const FRAME_stand249 = 462;
export const FRAME_stand250 = 463;
export const FRAME_stand251 = 464;
export const FRAME_stand252 = 465;
export const FRAME_stand253 = 466;
export const FRAME_stand254 = 467;
export const FRAME_stand255 = 468;
export const FRAME_stand256 = 469;
export const FRAME_stand257 = 470;
export const FRAME_stand258 = 471;
export const FRAME_stand259 = 472;
export const FRAME_stand260 = 473;
export const FRAME_walk201 = 474;
export const FRAME_walk202 = 475;
export const FRAME_walk203 = 476;
export const FRAME_walk204 = 477;
export const FRAME_walk205 = 478;
export const FRAME_walk206 = 479;
export const FRAME_walk207 = 480;
export const FRAME_walk208 = 481;
export const FRAME_walk209 = 482;
export const FRAME_walk210 = 483;
export const FRAME_walk211 = 484;
export const FRAME_walk212 = 485;
export const FRAME_walk213 = 486;
export const FRAME_walk214 = 487;
export const FRAME_walk215 = 488;
export const FRAME_walk216 = 489;
export const FRAME_walk217 = 490;

export const MODEL_SCALE = 1.0;

export const MZ2_MAKRON_BFG = 101;
export const MZ2_MAKRON_BLASTER_1 = 102;
export const MZ2_MAKRON_BLASTER_2 = 103;
export const MZ2_MAKRON_BLASTER_3 = 104;
export const MZ2_MAKRON_BLASTER_4 = 105;
export const MZ2_MAKRON_BLASTER_5 = 106;
export const MZ2_MAKRON_BLASTER_6 = 107;
export const MZ2_MAKRON_BLASTER_7 = 108;
export const MZ2_MAKRON_BLASTER_8 = 109;
export const MZ2_MAKRON_BLASTER_9 = 110;
export const MZ2_MAKRON_BLASTER_10 = 111;
export const MZ2_MAKRON_BLASTER_11 = 112;
export const MZ2_MAKRON_BLASTER_12 = 113;
export const MZ2_MAKRON_BLASTER_13 = 114;
export const MZ2_MAKRON_BLASTER_14 = 115;
export const MZ2_MAKRON_BLASTER_15 = 116;
export const MZ2_MAKRON_BLASTER_16 = 117;
export const MZ2_MAKRON_BLASTER_17 = 118;
export const MZ2_MAKRON_RAILGUN_1 = 119;

// Original name: N/A
// Source: N/A (local trace mask)
// Category: New
const MAKRON_ATTACK_TRACE_MASK = CONTENTS_SOLID | CONTENTS_MONSTER | CONTENTS_SLIME | CONTENTS_LAVA;
const SOUND_PAIN4 = "makron/pain3.wav";
const SOUND_PAIN5 = "makron/pain2.wav";
const SOUND_PAIN6 = "makron/pain1.wav";
const SOUND_DEATH = "makron/death.wav";
const SOUND_STEP_LEFT = "makron/step1.wav";
const SOUND_STEP_RIGHT = "makron/step2.wav";
const SOUND_ATTACK_BFG = "makron/bfg_fire.wav";
const SOUND_BRAINSPLORCH = "makron/brain1.wav";
const SOUND_PRERAILGUN = "makron/rail_up.wav";
const SOUND_POPUP = "makron/popup.wav";
const SOUND_TAUNT1 = "makron/voice4.wav";
const SOUND_TAUNT2 = "makron/voice3.wav";
const SOUND_TAUNT3 = "makron/voice.wav";
const SOUND_HIT = "makron/bhit.wav";

// Original name: N/A
// Source: N/A (local asset path constants)
// Category: New
const SOUND_SPINE = "makron/spine.wav";
const SOUND_UDEATH = "misc/udeath.wav";
const MODEL_RIDER = "models/monsters/boss3/rider/tris.md2";

// Original name: N/A
// Source: N/A (runtime sound handles)
// Category: New
let sound_pain4 = 0;
let sound_pain5 = 0;
let sound_pain6 = 0;
let sound_death = 0;
let sound_step_left = 0;
let sound_step_right = 0;
let sound_attack_bfg = 0;
let sound_brainsplorch = 0;
let sound_prerailgun = 0;
let sound_popup = 0;
let sound_taunt1 = 0;
let sound_taunt2 = 0;
let sound_taunt3 = 0;
let sound_hit = 0;

/**
 * Original name: makron_taunt
 * Source: game/m_boss32.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Plays one of the three Makron taunt sounds from the same source thresholds.
 *
 * Porting notes:
 * - Uses `g_local.random()` for the original `random()` macro.
 */
export function makron_taunt(self: GameEntity, runtime: GameRuntime): void {
  const r = random();

  if (r <= 0.3) {
    emitRegisteredGameSound(runtime, self, sound_taunt1, SOUND_TAUNT1, soundOptions(CHAN_AUTO, ATTN_NONE));
  } else if (r <= 0.6) {
    emitRegisteredGameSound(runtime, self, sound_taunt2, SOUND_TAUNT2, soundOptions(CHAN_AUTO, ATTN_NONE));
  } else {
    emitRegisteredGameSound(runtime, self, sound_taunt3, SOUND_TAUNT3, soundOptions(CHAN_AUTO, ATTN_NONE));
  }
}

export const makron_frames_stand = makeFrames(ai_stand, new Array<number>(60).fill(0));
export const makron_move_stand: GameMonsterMove = {
  firstframe: FRAME_stand201,
  lastframe: FRAME_stand260,
  frame: makron_frames_stand,
  endfunc: undefined
};

/**
 * Original name: makron_stand
 * Source: game/m_boss32.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Switches the monster to the Makron stand move.
 */
export function makron_stand(self: GameEntity): void {
  self.monsterinfo.currentmove = makron_move_stand;
}

export const makron_frames_run = makeFrames(
  ai_run,
  [3, 12, 8, 8, 8, 6, 12, 9, 6, 12],
  indexedThinks(10, [[0, makron_step_left], [4, makron_step_right]])
);
export const makron_move_run: GameMonsterMove = {
  firstframe: FRAME_walk204,
  lastframe: FRAME_walk213,
  frame: makron_frames_run,
  endfunc: undefined
};

/**
 * Original name: makron_hit
 * Source: game/m_boss32.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits the Makron death impact sound on the automatic channel.
 */
export function makron_hit(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_hit, SOUND_HIT, soundOptions(CHAN_AUTO, ATTN_NONE));
}

/**
 * Original name: makron_popup
 * Source: game/m_boss32.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits the Makron popup body sound.
 */
export function makron_popup(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_popup, SOUND_POPUP, soundOptions(CHAN_BODY, ATTN_NONE));
}

/**
 * Original name: makron_step_left
 * Source: game/m_boss32.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the left-foot step sound on the body channel.
 */
export function makron_step_left(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_step_left, SOUND_STEP_LEFT, soundOptions(CHAN_BODY, ATTN_NORM));
}

/**
 * Original name: makron_step_right
 * Source: game/m_boss32.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits the right-foot step sound on the body channel.
 */
export function makron_step_right(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_step_right, SOUND_STEP_RIGHT, soundOptions(CHAN_BODY, ATTN_NORM));
}

/**
 * Original name: makron_brainsplorch
 * Source: game/m_boss32.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits the Makron brain splorch voice sound.
 */
export function makron_brainsplorch(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_brainsplorch, SOUND_BRAINSPLORCH, soundOptions(CHAN_VOICE, ATTN_NORM));
}

/**
 * Original name: makron_prerailgun
 * Source: game/m_boss32.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Emits the railgun wind-up sound on the weapon channel.
 */
export function makron_prerailgun(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(runtime, self, sound_prerailgun, SOUND_PRERAILGUN, soundOptions(CHAN_WEAPON, ATTN_NORM));
}

export const makron_frames_walk = makeFrames(
  ai_walk,
  [3, 12, 8, 8, 8, 6, 12, 9, 6, 12],
  indexedThinks(10, [[0, makron_step_left], [4, makron_step_right]])
);
export const makron_move_walk: GameMonsterMove = {
  firstframe: FRAME_walk204,
  lastframe: FRAME_walk213,
  frame: makron_frames_run,
  endfunc: undefined
};

/**
 * Original name: makron_walk
 * Source: game/m_boss32.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Switches the monster to the Makron walk move.
 *
 * Porting notes:
 * - Preserves the original C quirk: `makron_move_walk` points at `makron_frames_run`,
 *   while `makron_frames_walk` remains declared but unused by that move.
 */
export function makron_walk(self: GameEntity): void {
  self.monsterinfo.currentmove = makron_move_walk;
}

/**
 * Original name: makron_run
 * Source: game/m_boss32.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Uses the stand move while holding ground; otherwise switches to the run move.
 */
export function makron_run(self: GameEntity): void {
  if ((self.monsterinfo.aiflags & AI_STAND_GROUND) !== 0) {
    self.monsterinfo.currentmove = makron_move_stand;
  } else {
    self.monsterinfo.currentmove = makron_move_run;
  }
}

export const makron_frames_pain6 = makeFrames(
  ai_move,
  new Array<number>(27).fill(0),
  indexedThinks(27, [[15, makron_popup], [23, makron_taunt]])
);
export const makron_move_pain6: GameMonsterMove = {
  firstframe: FRAME_pain601,
  lastframe: FRAME_pain627,
  frame: makron_frames_pain6,
  endfunc: makron_run
};

export const makron_frames_pain5 = makeFrames(ai_move, new Array<number>(4).fill(0));
export const makron_move_pain5: GameMonsterMove = {
  firstframe: FRAME_pain501,
  lastframe: FRAME_pain504,
  frame: makron_frames_pain5,
  endfunc: makron_run
};

export const makron_frames_pain4 = makeFrames(ai_move, new Array<number>(4).fill(0));
export const makron_move_pain4: GameMonsterMove = {
  firstframe: FRAME_pain401,
  lastframe: FRAME_pain404,
  frame: makron_frames_pain4,
  endfunc: makron_run
};

export const makron_frames_death2 = makeFrames(
  ai_move,
  [
    -15, 3, -12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 11, 12, 11, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 5, 7, 6, 0, 0, -1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -6, -4, -6, -4, -4, 0, 0, 0, 0,
    -2, -5, -3, -8, -3, -7, -4, -4, -6, -7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, -2, 0, 0,
    2, 0, 27, 26, 0, 0, 0
  ],
  indexedThinks(95, [
    [3, makron_step_left],
    [17, makron_step_right],
    [35, makron_step_left],
    [55, makron_step_right],
    [57, makron_step_left],
    [64, makron_step_right],
    [66, makron_step_left],
    [69, makron_step_right],
    [72, makron_step_left],
    [90, makron_hit],
    [92, makron_brainsplorch]
  ])
);
export const makron_move_death2: GameMonsterMove = {
  firstframe: FRAME_death201,
  lastframe: FRAME_death295,
  frame: makron_frames_death2,
  endfunc: makron_dead
};

export const makron_frames_death3 = makeFrames(ai_move, new Array<number>(20).fill(0));
export const makron_move_death3: GameMonsterMove = {
  firstframe: FRAME_death301,
  lastframe: FRAME_death320,
  frame: makron_frames_death3,
  endfunc: undefined
};

export const makron_frames_sight = makeFrames(ai_move, new Array<number>(13).fill(0));
export const makron_move_sight: GameMonsterMove = {
  firstframe: FRAME_active01,
  lastframe: FRAME_active13,
  frame: makron_frames_sight,
  endfunc: makron_run
};

/**
 * Original name: makronBFG
 * Source: Quake-2-master/game/m_boss32.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Projects the Makron BFG muzzle, aims at the enemy view height, plays the attack voice sound,
 *   and fires the original monster BFG payload.
 *
 * Porting notes:
 * - Keeps the source damage, speed, kick, splash radius and `MZ2_MAKRON_BFG` muzzle id.
 */
export function makronBFG(self: GameEntity, runtime: GameRuntime): void {
  if (!self.enemy) {
    return;
  }

  const { forward, right } = AngleVectors(self.s.angles);
  const start = G_ProjectSource(self.s.origin, makronFlashOffset(MZ2_MAKRON_BFG), forward, right);
  const vec: vec3_t = [...self.enemy.s.origin];
  vec[2] += self.enemy.viewheight;
  const dir = normalizeVec3(subtractVec3(vec, start));

  emitRegisteredGameSound(runtime, self, sound_attack_bfg, SOUND_ATTACK_BFG, soundOptions(CHAN_VOICE, ATTN_NORM));
  monster_fire_bfg(self, start, dir, 50, 300, 100, 300, MZ2_MAKRON_BFG, runtime);
}

export const makron_frames_attack3 = [
  ...makeFrames(ai_charge, new Array<number>(4).fill(0), indexedThinks(4, [[3, makronBFG]])),
  ...makeFrames(ai_move, new Array<number>(4).fill(0))
];
export const makron_move_attack3: GameMonsterMove = {
  firstframe: FRAME_attak301,
  lastframe: FRAME_attak308,
  frame: makron_frames_attack3,
  endfunc: makron_run
};

export const makron_frames_attack4 = [
  ...makeFrames(ai_charge, new Array<number>(4).fill(0)),
  ...makeFrames(ai_move, new Array<number>(17).fill(0), new Array<GameMonsterFrame["thinkfunc"]>(17).fill(MakronHyperblaster)),
  ...makeFrames(ai_move, new Array<number>(5).fill(0))
];
export const makron_move_attack4: GameMonsterMove = {
  firstframe: FRAME_attak401,
  lastframe: FRAME_attak426,
  frame: makron_frames_attack4,
  endfunc: makron_run
};

export const makron_frames_attack5 = [
  ...makeFrames(ai_charge, new Array<number>(8).fill(0), indexedThinks(8, [[0, makron_prerailgun], [7, MakronSaveloc]])),
  ...makeFrames(ai_move, new Array<number>(8).fill(0), indexedThinks(8, [[0, MakronRailgun]]))
];
export const makron_move_attack5: GameMonsterMove = {
  firstframe: FRAME_attak501,
  lastframe: FRAME_attak516,
  frame: makron_frames_attack5,
  endfunc: makron_run
};

/**
 * Original name: MakronSaveloc
 * Source: Quake-2-master/game/m_boss32.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Captures the enemy origin plus view height in `self->pos1` for the delayed railgun shot.
 *
 * Porting notes:
 * - Adds a defensive enemy guard; normal runtime reaches this from attack5 only while Makron has an enemy.
 */
export function MakronSaveloc(self: GameEntity): void {
  if (!self.enemy) {
    return;
  }

  copyVec3(self.pos1, self.enemy.s.origin);
  self.pos1[2] += self.enemy.viewheight;
}

/**
 * Original name: MakronRailgun
 * Source: Quake-2-master/game/m_boss32.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Fires the delayed Makron railgun from the original muzzle id toward the saved `pos1` target.
 *
 * Porting notes:
 * - Preserves the source FIXME behavior: the shot uses the original muzzle Z handling.
 */
export function MakronRailgun(self: GameEntity, runtime: GameRuntime): void {
  const { forward, right } = AngleVectors(self.s.angles);
  const start = G_ProjectSource(self.s.origin, makronFlashOffset(MZ2_MAKRON_RAILGUN_1), forward, right);
  const dir = normalizeVec3(subtractVec3(self.pos1, start));

  monster_fire_railgun(self, start, dir, 50, 100, MZ2_MAKRON_RAILGUN_1, runtime);
}

/**
 * Original name: MakronHyperblaster
 * Source: Quake-2-master/game/m_boss32.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Sweeps the Makron blaster muzzle sequence and fires one blaster bolt per attack4 firing frame.
 *
 * Porting notes:
 * - Preserves the source FIXME behavior and the yaw sweep around frames `FRAME_attak413`/`FRAME_attak421`.
 */
export function MakronHyperblaster(self: GameEntity, runtime: GameRuntime): void {
  const flash_number = MZ2_MAKRON_BLASTER_1 + (self.s.frame - FRAME_attak405);
  const { forward, right } = AngleVectors(self.s.angles);
  const start = G_ProjectSource(self.s.origin, makronFlashOffset(flash_number), forward, right);
  const dir: vec3_t = [0, 0, 0];

  if (self.enemy) {
    const vec: vec3_t = [...self.enemy.s.origin];
    vec[2] += self.enemy.viewheight;
    const angles = vectoangles(subtractVec3(vec, start));
    dir[0] = angles[0];
  }

  if (self.s.frame <= FRAME_attak413) {
    dir[1] = self.s.angles[1] - 10 * (self.s.frame - FRAME_attak413);
  } else {
    dir[1] = self.s.angles[1] + 10 * (self.s.frame - FRAME_attak421);
  }
  dir[2] = 0;

  monster_fire_blaster(self, start, AngleVectors(dir).forward, 15, 1000, MZ2_MAKRON_BLASTER_1, EF_BLASTER, runtime);
}

/**
 * Original name: makron_pain
 * Source: Quake-2-master/game/m_boss32.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Applies the damaged skin below half health, debounces pain, skips pain animations on nightmare,
 *   and selects the C pain4/pain5/pain6 moves and sounds from damage thresholds.
 *
 * Porting notes:
 * - Uses `g_local.random()` for the original `random()` macro.
 * - Preserves the source dangling-else behavior in the pain6 chance block.
 */
export function makron_pain(
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

  if (damage <= 25 && random() < 0.2) {
    return;
  }

  self.pain_debounce_time = runtime.time + 3;
  if (runtime.skill === 3) {
    return;
  }

  if (damage <= 40) {
    emitRegisteredGameSound(runtime, self, sound_pain4, SOUND_PAIN4, soundOptions(CHAN_VOICE, ATTN_NONE));
    self.monsterinfo.currentmove = makron_move_pain4;
  } else if (damage <= 110) {
    emitRegisteredGameSound(runtime, self, sound_pain5, SOUND_PAIN5, soundOptions(CHAN_VOICE, ATTN_NONE));
    self.monsterinfo.currentmove = makron_move_pain5;
  } else {
    if (damage <= 150 && random() <= 0.45) {
      emitRegisteredGameSound(runtime, self, sound_pain6, SOUND_PAIN6, soundOptions(CHAN_VOICE, ATTN_NONE));
      self.monsterinfo.currentmove = makron_move_pain6;
    } else if (damage <= 150 && random() <= 0.35) {
      emitRegisteredGameSound(runtime, self, sound_pain6, SOUND_PAIN6, soundOptions(CHAN_VOICE, ATTN_NONE));
      self.monsterinfo.currentmove = makron_move_pain6;
    }
  }
}

/**
 * Original name: makron_sight
 * Source: Quake-2-master/game/m_boss32.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Switches the Makron to its sight/activation move when an enemy is spotted.
 *
 * Porting notes:
 * - The unused C `other` parameter is omitted; the function only mutates `self->monsterinfo.currentmove`.
 */
export function makron_sight(self: GameEntity): void {
  self.monsterinfo.currentmove = makron_move_sight;
}

/**
 * Original name: makron_attack
 * Source: Quake-2-master/game/m_boss32.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Selects Makron BFG, hyperblaster or railgun attack moves using the original random thresholds.
 *
 * Porting notes:
 * - Uses `g_local.random()` for the original `random()` macro.
 * - The C computes distance to the enemy in a local `range` variable but never uses it; TS omits that dead local.
 */
export function makron_attack(self: GameEntity): void {
  if (!self.enemy) {
    return;
  }

  const r = random();
  if (r <= 0.3) {
    self.monsterinfo.currentmove = makron_move_attack3;
  } else if (r <= 0.6) {
    self.monsterinfo.currentmove = makron_move_attack4;
  } else {
    self.monsterinfo.currentmove = makron_move_attack5;
  }
}

/**
 * Original name: makron_torso_think
 * Source: Quake-2-master/game/m_boss32.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Advances the spawned Makron torso model through frames 346..364 and loops it back to 346.
 *
 * Porting notes:
 * - Uses the explicit gameplay runtime time in place of `level.time`.
 */
export function makron_torso_think(self: GameEntity, runtime: GameRuntime): void {
  self.s.frame += 1;
  if (self.s.frame < 365) {
    self.nextthink = runtime.time + FRAMETIME;
  } else {
    self.s.frame = 346;
    self.nextthink = runtime.time + FRAMETIME;
  }
}

/**
 * Original name: makron_torso
 * Source: Quake-2-master/game/m_boss32.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Initializes the detached rider torso as a non-solid looping model with the spine sound.
 *
 * Porting notes:
 * - Routes `gi.modelindex`, `gi.soundindex` and `gi.linkentity` through runtime adapters.
 */
export function makron_torso(ent: GameEntity, runtime: GameRuntime): void {
  ent.movetype = MOVETYPE_NONE;
  ent.solid = SOLID_NOT;
  setVec3(ent.mins, -8, -8, 0);
  setVec3(ent.maxs, 8, 8, 8);
  ent.s.frame = 346;
  ent.s.modelindex = registerGameModel(runtime, MODEL_RIDER);
  ent.think = makron_torso_think;
  ent.nextthink = runtime.time + 2 * FRAMETIME;
  ent.s.sound = registerGameSound(runtime, SOUND_SPINE);
  linkGameEntity(runtime, ent);
}

/**
 * Original name: makron_dead
 * Source: Quake-2-master/game/m_boss32.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Converts the finished Makron death animation into a tossable dead-monster bbox and relinks it.
 *
 * Porting notes:
 * - Routes `gi.linkentity` through the gameplay runtime.
 */
export function makron_dead(self: GameEntity, runtime: GameRuntime): void {
  setVec3(self.mins, -60, -60, 0);
  setVec3(self.maxs, 60, 60, 72);
  self.movetype = MOVETYPE_TOSS;
  self.svflags |= SVF_DEADMONSTER;
  self.nextthink = 0;
  linkGameEntity(runtime, self);
}

/**
 * Original name: makron_die
 * Source: Quake-2-master/game/m_boss32.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Handles Makron gib death or regular death, spawns the detached torso, and starts `makron_move_death2`.
 *
 * Porting notes:
 * - Keeps the source's single organic meat gib plus four metallic gibs before the gear head.
 * - Routes sound, gib and entity allocation side effects through the gameplay runtime.
 */
export function makron_die(
  self: GameEntity,
  _inflictor: GameEntity | null,
  _attacker: GameEntity | null,
  damage: number,
  runtime: GameRuntime
): void {
  self.s.sound = 0;

  if (self.health <= self.gib_health) {
    emitRegisteredGameSound(runtime, self, registerGameSound(runtime, SOUND_UDEATH), SOUND_UDEATH, soundOptions(CHAN_VOICE, ATTN_NORM));
    ThrowGib(self, "models/objects/gibs/sm_meat/tris.md2", damage, GIB_ORGANIC, runtime);
    for (let n = 0; n < 4; n += 1) {
      ThrowGib(self, "models/objects/gibs/sm_metal/tris.md2", damage, GIB_METALLIC, runtime);
    }
    ThrowHead(self, "models/objects/gibs/gear/tris.md2", damage, GIB_METALLIC, runtime);
    self.deadflag = DEAD_DEAD;
    return;
  }

  if (self.deadflag === DEAD_DEAD) {
    return;
  }

  emitRegisteredGameSound(runtime, self, sound_death, SOUND_DEATH, soundOptions(CHAN_VOICE, ATTN_NONE));
  self.deadflag = DEAD_DEAD;
  self.takedamage = damage_t.DAMAGE_YES;

  const tempent = G_Spawn(runtime);
  copyVec3(tempent.s.origin, self.s.origin);
  copyVec3(tempent.origin, self.s.origin);
  copyVec3(tempent.s.angles, self.s.angles);
  copyVec3(tempent.angles, self.s.angles);
  tempent.s.origin[1] -= 84;
  tempent.origin[1] -= 84;
  makron_torso(tempent, runtime);

  self.monsterinfo.currentmove = makron_move_death2;
}

/**
 * Original name: Makron_CheckAttack
 * Source: Quake-2-master/game/m_boss32.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Checks shot clearance, range and attack cooldown before selecting Makron's missile/melee state.
 *
 * Porting notes:
 * - The C local `enemy_infront` is computed but never used; this port preserves the effective behavior.
 * - Uses the ported C `random()` helper for missile chance and flying strafe decisions.
 */
export function Makron_CheckAttack(self: GameEntity, runtime: GameRuntime): boolean {
  if (!self.enemy) {
    return false;
  }

  if (self.enemy.health > 0) {
    const spot1: vec3_t = [...self.s.origin];
    spot1[2] += self.viewheight;
    const spot2: vec3_t = [...self.enemy.s.origin];
    spot2[2] += self.enemy.viewheight;

    const tr = runtime.collision?.trace(spot1, [0, 0, 0], [0, 0, 0], spot2, self, MAKRON_ATTACK_TRACE_MASK);
    if (!tr || tr.ent !== self.enemy) {
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
    chance = 0.4;
  } else if (enemy_range === RANGE_MID) {
    chance = 0.2;
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
 * Original name: MakronPrecache
 * Source: Quake-2-master/game/m_boss32.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Registers the Makron sound handles and rider model in source order.
 */
export function MakronPrecache(runtime: GameRuntime): void {
  sound_pain4 = registerGameSound(runtime, SOUND_PAIN4);
  sound_pain5 = registerGameSound(runtime, SOUND_PAIN5);
  sound_pain6 = registerGameSound(runtime, SOUND_PAIN6);
  sound_death = registerGameSound(runtime, SOUND_DEATH);
  sound_step_left = registerGameSound(runtime, SOUND_STEP_LEFT);
  sound_step_right = registerGameSound(runtime, SOUND_STEP_RIGHT);
  sound_attack_bfg = registerGameSound(runtime, SOUND_ATTACK_BFG);
  sound_brainsplorch = registerGameSound(runtime, SOUND_BRAINSPLORCH);
  sound_prerailgun = registerGameSound(runtime, SOUND_PRERAILGUN);
  sound_popup = registerGameSound(runtime, SOUND_POPUP);
  sound_taunt1 = registerGameSound(runtime, SOUND_TAUNT1);
  sound_taunt2 = registerGameSound(runtime, SOUND_TAUNT2);
  sound_taunt3 = registerGameSound(runtime, SOUND_TAUNT3);
  sound_hit = registerGameSound(runtime, SOUND_HIT);

  registerGameModel(runtime, MODEL_RIDER);
}

/**
 * Original name: SP_monster_makron
 * Source: Quake-2-master/game/m_boss32.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns monster_makron, precaches assets and initializes walking monster callbacks.
 */
export function SP_monster_makron(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  MakronPrecache(runtime);

  self.movetype = MOVETYPE_STEP;
  self.solid = SOLID_BBOX;
  self.s.modelindex = registerGameModel(runtime, MODEL_RIDER);
  setVec3(self.mins, -30, -30, 0);
  setVec3(self.maxs, 30, 30, 90);

  self.health = 3000;
  self.gib_health = -2000;
  self.mass = 500;

  self.pain = makron_pain;
  self.die = makron_die;
  self.monsterinfo.stand = makron_stand;
  self.monsterinfo.walk = makron_walk;
  self.monsterinfo.run = makron_run;
  self.monsterinfo.dodge = undefined;
  self.monsterinfo.attack = makron_attack;
  self.monsterinfo.melee = undefined;
  self.monsterinfo.sight = makron_sight;
  self.monsterinfo.checkattack = Makron_CheckAttack;

  linkGameEntity(runtime, self);

  self.monsterinfo.currentmove = makron_move_sight;
  self.monsterinfo.scale = MODEL_SCALE;

  walkmonster_start(self, runtime);
}

/**
 * Original name: MakronSpawn
 * Source: Quake-2-master/game/m_boss32.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Converts the tossed placeholder into monster_makron, then jumps toward `level.sight_client`.
 */
export function MakronSpawn(self: GameEntity, runtime: GameRuntime): void {
  SP_monster_makron(self, runtime);

  const player = runtime.sight_client;
  if (!player) {
    return;
  }

  const vec = subtractVec3(player.s.origin, self.s.origin);
  self.s.angles[YAW] = vectoyaw(vec);
  self.angles[YAW] = self.s.angles[YAW];
  const normalized = normalizeVec3(vec);
  copyVec3(self.velocity, scaleVec3(normalized, 400));
  self.velocity[2] = 200;
  self.groundentity = null;
}

/**
 * Original name: MakronToss
 * Source: Quake-2-master/game/m_boss32.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns a delayed Makron placeholder at Jorg's origin and schedules `MakronSpawn`.
 */
export function MakronToss(self: GameEntity, runtime: GameRuntime): void {
  const ent = G_Spawn(runtime);
  ent.nextthink = runtime.time + 0.8;
  ent.think = MakronSpawn;
  ent.target = self.target;
  copyVec3(ent.s.origin, self.s.origin);
  copyVec3(ent.origin, self.s.origin);
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
 * Source: N/A (local sound options helper)
 * Category: New
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
 * Source: N/A (local muzzle flash adapter)
 * Category: New
 */
function makronFlashOffset(flashNumber: number): vec3_t {
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
function copyVec3(target: [number, number, number], source: vec3_t): void {
  target[0] = source[0];
  target[1] = source[1];
  target[2] = source[2];
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
