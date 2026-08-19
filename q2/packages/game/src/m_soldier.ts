/**
 * File: m_soldier.ts
 * Source: Quake II original / game/m_soldier.h and game/m_soldier.c
 * Purpose: Port of the generated soldier model frame constants and monster_soldier gameplay behavior.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses the explicit gameplay runtime and asset helpers instead of `gi.*`.
 * - The shared `GameEntityDie` callback receives the original C impact `point` after the explicit runtime argument.
 *
 * Notes:
 * - This file keeps the header constants and C behavior together as the principal attachment point for `m_soldier`.
 */

import { AngleVectors, ATTN_IDLE, ATTN_NORM, CHAN_VOICE, CHAN_WEAPON, EF_BLASTER, type vec3_t } from "../../qcommon/src/index.js";
import {
  AI_DUCKED,
  AI_HOLD_FRAME,
  AI_STAND_GROUND,
  DEAD_DEAD,
  DEFAULT_BULLET_HSPREAD,
  DEFAULT_BULLET_VSPREAD,
  DEFAULT_SHOTGUN_COUNT,
  DEFAULT_SHOTGUN_HSPREAD,
  DEFAULT_SHOTGUN_VSPREAD,
  FRAMETIME,
  GIB_ORGANIC,
  MOVETYPE_STEP,
  MOVETYPE_TOSS,
  RANGE_MID,
  RANGE_MELEE,
  SOLID_BBOX,
  SVF_DEADMONSTER,
  crandom,
  damage_t,
  random
} from "./g_local.js";
import { ai_charge, ai_move, ai_run, ai_stand, ai_walk, range } from "./g_ai.js";
import { monster_fire_blaster, monster_fire_bullet, monster_fire_shotgun, walkmonster_start } from "./g_monster.js";
import { ThrowGib, ThrowHead } from "./g_misc.js";
import { G_FreeEdict, G_ProjectSource, vectoangles } from "./g_utils.js";
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
export const FRAME_attak201 = 12;
export const FRAME_attak202 = 13;
export const FRAME_attak203 = 14;
export const FRAME_attak204 = 15;
export const FRAME_attak205 = 16;
export const FRAME_attak206 = 17;
export const FRAME_attak207 = 18;
export const FRAME_attak208 = 19;
export const FRAME_attak209 = 20;
export const FRAME_attak210 = 21;
export const FRAME_attak211 = 22;
export const FRAME_attak212 = 23;
export const FRAME_attak213 = 24;
export const FRAME_attak214 = 25;
export const FRAME_attak215 = 26;
export const FRAME_attak216 = 27;
export const FRAME_attak217 = 28;
export const FRAME_attak218 = 29;
export const FRAME_attak301 = 30;
export const FRAME_attak302 = 31;
export const FRAME_attak303 = 32;
export const FRAME_attak304 = 33;
export const FRAME_attak305 = 34;
export const FRAME_attak306 = 35;
export const FRAME_attak307 = 36;
export const FRAME_attak308 = 37;
export const FRAME_attak309 = 38;
export const FRAME_attak401 = 39;
export const FRAME_attak402 = 40;
export const FRAME_attak403 = 41;
export const FRAME_attak404 = 42;
export const FRAME_attak405 = 43;
export const FRAME_attak406 = 44;
export const FRAME_duck01 = 45;
export const FRAME_duck02 = 46;
export const FRAME_duck03 = 47;
export const FRAME_duck04 = 48;
export const FRAME_duck05 = 49;
export const FRAME_pain101 = 50;
export const FRAME_pain102 = 51;
export const FRAME_pain103 = 52;
export const FRAME_pain104 = 53;
export const FRAME_pain105 = 54;
export const FRAME_pain201 = 55;
export const FRAME_pain202 = 56;
export const FRAME_pain203 = 57;
export const FRAME_pain204 = 58;
export const FRAME_pain205 = 59;
export const FRAME_pain206 = 60;
export const FRAME_pain207 = 61;
export const FRAME_pain301 = 62;
export const FRAME_pain302 = 63;
export const FRAME_pain303 = 64;
export const FRAME_pain304 = 65;
export const FRAME_pain305 = 66;
export const FRAME_pain306 = 67;
export const FRAME_pain307 = 68;
export const FRAME_pain308 = 69;
export const FRAME_pain309 = 70;
export const FRAME_pain310 = 71;
export const FRAME_pain311 = 72;
export const FRAME_pain312 = 73;
export const FRAME_pain313 = 74;
export const FRAME_pain314 = 75;
export const FRAME_pain315 = 76;
export const FRAME_pain316 = 77;
export const FRAME_pain317 = 78;
export const FRAME_pain318 = 79;
export const FRAME_pain401 = 80;
export const FRAME_pain402 = 81;
export const FRAME_pain403 = 82;
export const FRAME_pain404 = 83;
export const FRAME_pain405 = 84;
export const FRAME_pain406 = 85;
export const FRAME_pain407 = 86;
export const FRAME_pain408 = 87;
export const FRAME_pain409 = 88;
export const FRAME_pain410 = 89;
export const FRAME_pain411 = 90;
export const FRAME_pain412 = 91;
export const FRAME_pain413 = 92;
export const FRAME_pain414 = 93;
export const FRAME_pain415 = 94;
export const FRAME_pain416 = 95;
export const FRAME_pain417 = 96;
export const FRAME_run01 = 97;
export const FRAME_run02 = 98;
export const FRAME_run03 = 99;
export const FRAME_run04 = 100;
export const FRAME_run05 = 101;
export const FRAME_run06 = 102;
export const FRAME_run07 = 103;
export const FRAME_run08 = 104;
export const FRAME_run09 = 105;
export const FRAME_run10 = 106;
export const FRAME_run11 = 107;
export const FRAME_run12 = 108;
export const FRAME_runs01 = 109;
export const FRAME_runs02 = 110;
export const FRAME_runs03 = 111;
export const FRAME_runs04 = 112;
export const FRAME_runs05 = 113;
export const FRAME_runs06 = 114;
export const FRAME_runs07 = 115;
export const FRAME_runs08 = 116;
export const FRAME_runs09 = 117;
export const FRAME_runs10 = 118;
export const FRAME_runs11 = 119;
export const FRAME_runs12 = 120;
export const FRAME_runs13 = 121;
export const FRAME_runs14 = 122;
export const FRAME_runs15 = 123;
export const FRAME_runs16 = 124;
export const FRAME_runs17 = 125;
export const FRAME_runs18 = 126;
export const FRAME_runt01 = 127;
export const FRAME_runt02 = 128;
export const FRAME_runt03 = 129;
export const FRAME_runt04 = 130;
export const FRAME_runt05 = 131;
export const FRAME_runt06 = 132;
export const FRAME_runt07 = 133;
export const FRAME_runt08 = 134;
export const FRAME_runt09 = 135;
export const FRAME_runt10 = 136;
export const FRAME_runt11 = 137;
export const FRAME_runt12 = 138;
export const FRAME_runt13 = 139;
export const FRAME_runt14 = 140;
export const FRAME_runt15 = 141;
export const FRAME_runt16 = 142;
export const FRAME_runt17 = 143;
export const FRAME_runt18 = 144;
export const FRAME_runt19 = 145;
export const FRAME_stand101 = 146;
export const FRAME_stand102 = 147;
export const FRAME_stand103 = 148;
export const FRAME_stand104 = 149;
export const FRAME_stand105 = 150;
export const FRAME_stand106 = 151;
export const FRAME_stand107 = 152;
export const FRAME_stand108 = 153;
export const FRAME_stand109 = 154;
export const FRAME_stand110 = 155;
export const FRAME_stand111 = 156;
export const FRAME_stand112 = 157;
export const FRAME_stand113 = 158;
export const FRAME_stand114 = 159;
export const FRAME_stand115 = 160;
export const FRAME_stand116 = 161;
export const FRAME_stand117 = 162;
export const FRAME_stand118 = 163;
export const FRAME_stand119 = 164;
export const FRAME_stand120 = 165;
export const FRAME_stand121 = 166;
export const FRAME_stand122 = 167;
export const FRAME_stand123 = 168;
export const FRAME_stand124 = 169;
export const FRAME_stand125 = 170;
export const FRAME_stand126 = 171;
export const FRAME_stand127 = 172;
export const FRAME_stand128 = 173;
export const FRAME_stand129 = 174;
export const FRAME_stand130 = 175;
export const FRAME_stand301 = 176;
export const FRAME_stand302 = 177;
export const FRAME_stand303 = 178;
export const FRAME_stand304 = 179;
export const FRAME_stand305 = 180;
export const FRAME_stand306 = 181;
export const FRAME_stand307 = 182;
export const FRAME_stand308 = 183;
export const FRAME_stand309 = 184;
export const FRAME_stand310 = 185;
export const FRAME_stand311 = 186;
export const FRAME_stand312 = 187;
export const FRAME_stand313 = 188;
export const FRAME_stand314 = 189;
export const FRAME_stand315 = 190;
export const FRAME_stand316 = 191;
export const FRAME_stand317 = 192;
export const FRAME_stand318 = 193;
export const FRAME_stand319 = 194;
export const FRAME_stand320 = 195;
export const FRAME_stand321 = 196;
export const FRAME_stand322 = 197;
export const FRAME_stand323 = 198;
export const FRAME_stand324 = 199;
export const FRAME_stand325 = 200;
export const FRAME_stand326 = 201;
export const FRAME_stand327 = 202;
export const FRAME_stand328 = 203;
export const FRAME_stand329 = 204;
export const FRAME_stand330 = 205;
export const FRAME_stand331 = 206;
export const FRAME_stand332 = 207;
export const FRAME_stand333 = 208;
export const FRAME_stand334 = 209;
export const FRAME_stand335 = 210;
export const FRAME_stand336 = 211;
export const FRAME_stand337 = 212;
export const FRAME_stand338 = 213;
export const FRAME_stand339 = 214;
export const FRAME_walk101 = 215;
export const FRAME_walk102 = 216;
export const FRAME_walk103 = 217;
export const FRAME_walk104 = 218;
export const FRAME_walk105 = 219;
export const FRAME_walk106 = 220;
export const FRAME_walk107 = 221;
export const FRAME_walk108 = 222;
export const FRAME_walk109 = 223;
export const FRAME_walk110 = 224;
export const FRAME_walk111 = 225;
export const FRAME_walk112 = 226;
export const FRAME_walk113 = 227;
export const FRAME_walk114 = 228;
export const FRAME_walk115 = 229;
export const FRAME_walk116 = 230;
export const FRAME_walk117 = 231;
export const FRAME_walk118 = 232;
export const FRAME_walk119 = 233;
export const FRAME_walk120 = 234;
export const FRAME_walk121 = 235;
export const FRAME_walk122 = 236;
export const FRAME_walk123 = 237;
export const FRAME_walk124 = 238;
export const FRAME_walk125 = 239;
export const FRAME_walk126 = 240;
export const FRAME_walk127 = 241;
export const FRAME_walk128 = 242;
export const FRAME_walk129 = 243;
export const FRAME_walk130 = 244;
export const FRAME_walk131 = 245;
export const FRAME_walk132 = 246;
export const FRAME_walk133 = 247;
export const FRAME_walk201 = 248;
export const FRAME_walk202 = 249;
export const FRAME_walk203 = 250;
export const FRAME_walk204 = 251;
export const FRAME_walk205 = 252;
export const FRAME_walk206 = 253;
export const FRAME_walk207 = 254;
export const FRAME_walk208 = 255;
export const FRAME_walk209 = 256;
export const FRAME_walk210 = 257;
export const FRAME_walk211 = 258;
export const FRAME_walk212 = 259;
export const FRAME_walk213 = 260;
export const FRAME_walk214 = 261;
export const FRAME_walk215 = 262;
export const FRAME_walk216 = 263;
export const FRAME_walk217 = 264;
export const FRAME_walk218 = 265;
export const FRAME_walk219 = 266;
export const FRAME_walk220 = 267;
export const FRAME_walk221 = 268;
export const FRAME_walk222 = 269;
export const FRAME_walk223 = 270;
export const FRAME_walk224 = 271;
export const FRAME_death101 = 272;
export const FRAME_death102 = 273;
export const FRAME_death103 = 274;
export const FRAME_death104 = 275;
export const FRAME_death105 = 276;
export const FRAME_death106 = 277;
export const FRAME_death107 = 278;
export const FRAME_death108 = 279;
export const FRAME_death109 = 280;
export const FRAME_death110 = 281;
export const FRAME_death111 = 282;
export const FRAME_death112 = 283;
export const FRAME_death113 = 284;
export const FRAME_death114 = 285;
export const FRAME_death115 = 286;
export const FRAME_death116 = 287;
export const FRAME_death117 = 288;
export const FRAME_death118 = 289;
export const FRAME_death119 = 290;
export const FRAME_death120 = 291;
export const FRAME_death121 = 292;
export const FRAME_death122 = 293;
export const FRAME_death123 = 294;
export const FRAME_death124 = 295;
export const FRAME_death125 = 296;
export const FRAME_death126 = 297;
export const FRAME_death127 = 298;
export const FRAME_death128 = 299;
export const FRAME_death129 = 300;
export const FRAME_death130 = 301;
export const FRAME_death131 = 302;
export const FRAME_death132 = 303;
export const FRAME_death133 = 304;
export const FRAME_death134 = 305;
export const FRAME_death135 = 306;
export const FRAME_death136 = 307;
export const FRAME_death201 = 308;
export const FRAME_death202 = 309;
export const FRAME_death203 = 310;
export const FRAME_death204 = 311;
export const FRAME_death205 = 312;
export const FRAME_death206 = 313;
export const FRAME_death207 = 314;
export const FRAME_death208 = 315;
export const FRAME_death209 = 316;
export const FRAME_death210 = 317;
export const FRAME_death211 = 318;
export const FRAME_death212 = 319;
export const FRAME_death213 = 320;
export const FRAME_death214 = 321;
export const FRAME_death215 = 322;
export const FRAME_death216 = 323;
export const FRAME_death217 = 324;
export const FRAME_death218 = 325;
export const FRAME_death219 = 326;
export const FRAME_death220 = 327;
export const FRAME_death221 = 328;
export const FRAME_death222 = 329;
export const FRAME_death223 = 330;
export const FRAME_death224 = 331;
export const FRAME_death225 = 332;
export const FRAME_death226 = 333;
export const FRAME_death227 = 334;
export const FRAME_death228 = 335;
export const FRAME_death229 = 336;
export const FRAME_death230 = 337;
export const FRAME_death231 = 338;
export const FRAME_death232 = 339;
export const FRAME_death233 = 340;
export const FRAME_death234 = 341;
export const FRAME_death235 = 342;
export const FRAME_death301 = 343;
export const FRAME_death302 = 344;
export const FRAME_death303 = 345;
export const FRAME_death304 = 346;
export const FRAME_death305 = 347;
export const FRAME_death306 = 348;
export const FRAME_death307 = 349;
export const FRAME_death308 = 350;
export const FRAME_death309 = 351;
export const FRAME_death310 = 352;
export const FRAME_death311 = 353;
export const FRAME_death312 = 354;
export const FRAME_death313 = 355;
export const FRAME_death314 = 356;
export const FRAME_death315 = 357;
export const FRAME_death316 = 358;
export const FRAME_death317 = 359;
export const FRAME_death318 = 360;
export const FRAME_death319 = 361;
export const FRAME_death320 = 362;
export const FRAME_death321 = 363;
export const FRAME_death322 = 364;
export const FRAME_death323 = 365;
export const FRAME_death324 = 366;
export const FRAME_death325 = 367;
export const FRAME_death326 = 368;
export const FRAME_death327 = 369;
export const FRAME_death328 = 370;
export const FRAME_death329 = 371;
export const FRAME_death330 = 372;
export const FRAME_death331 = 373;
export const FRAME_death332 = 374;
export const FRAME_death333 = 375;
export const FRAME_death334 = 376;
export const FRAME_death335 = 377;
export const FRAME_death336 = 378;
export const FRAME_death337 = 379;
export const FRAME_death338 = 380;
export const FRAME_death339 = 381;
export const FRAME_death340 = 382;
export const FRAME_death341 = 383;
export const FRAME_death342 = 384;
export const FRAME_death343 = 385;
export const FRAME_death344 = 386;
export const FRAME_death345 = 387;
export const FRAME_death401 = 388;
export const FRAME_death402 = 389;
export const FRAME_death403 = 390;
export const FRAME_death404 = 391;
export const FRAME_death405 = 392;
export const FRAME_death406 = 393;
export const FRAME_death407 = 394;
export const FRAME_death408 = 395;
export const FRAME_death409 = 396;
export const FRAME_death410 = 397;
export const FRAME_death411 = 398;
export const FRAME_death412 = 399;
export const FRAME_death413 = 400;
export const FRAME_death414 = 401;
export const FRAME_death415 = 402;
export const FRAME_death416 = 403;
export const FRAME_death417 = 404;
export const FRAME_death418 = 405;
export const FRAME_death419 = 406;
export const FRAME_death420 = 407;
export const FRAME_death421 = 408;
export const FRAME_death422 = 409;
export const FRAME_death423 = 410;
export const FRAME_death424 = 411;
export const FRAME_death425 = 412;
export const FRAME_death426 = 413;
export const FRAME_death427 = 414;
export const FRAME_death428 = 415;
export const FRAME_death429 = 416;
export const FRAME_death430 = 417;
export const FRAME_death431 = 418;
export const FRAME_death432 = 419;
export const FRAME_death433 = 420;
export const FRAME_death434 = 421;
export const FRAME_death435 = 422;
export const FRAME_death436 = 423;
export const FRAME_death437 = 424;
export const FRAME_death438 = 425;
export const FRAME_death439 = 426;
export const FRAME_death440 = 427;
export const FRAME_death441 = 428;
export const FRAME_death442 = 429;
export const FRAME_death443 = 430;
export const FRAME_death444 = 431;
export const FRAME_death445 = 432;
export const FRAME_death446 = 433;
export const FRAME_death447 = 434;
export const FRAME_death448 = 435;
export const FRAME_death449 = 436;
export const FRAME_death450 = 437;
export const FRAME_death451 = 438;
export const FRAME_death452 = 439;
export const FRAME_death453 = 440;
export const FRAME_death501 = 441;
export const FRAME_death502 = 442;
export const FRAME_death503 = 443;
export const FRAME_death504 = 444;
export const FRAME_death505 = 445;
export const FRAME_death506 = 446;
export const FRAME_death507 = 447;
export const FRAME_death508 = 448;
export const FRAME_death509 = 449;
export const FRAME_death510 = 450;
export const FRAME_death511 = 451;
export const FRAME_death512 = 452;
export const FRAME_death513 = 453;
export const FRAME_death514 = 454;
export const FRAME_death515 = 455;
export const FRAME_death516 = 456;
export const FRAME_death517 = 457;
export const FRAME_death518 = 458;
export const FRAME_death519 = 459;
export const FRAME_death520 = 460;
export const FRAME_death521 = 461;
export const FRAME_death522 = 462;
export const FRAME_death523 = 463;
export const FRAME_death524 = 464;
export const FRAME_death601 = 465;
export const FRAME_death602 = 466;
export const FRAME_death603 = 467;
export const FRAME_death604 = 468;
export const FRAME_death605 = 469;
export const FRAME_death606 = 470;
export const FRAME_death607 = 471;
export const FRAME_death608 = 472;
export const FRAME_death609 = 473;
export const FRAME_death610 = 474;

export const MODEL_SCALE = 1.2;

/**
 * Original name: N/A
 * Source: N/A (local muzzle flash aliases)
 * Category: New
 * Purpose: Local numeric aliases for soldier muzzle flash ids used by the ported fire tables.
 */
export const MZ2_SOLDIER_BLASTER_1 = 39;
export const MZ2_SOLDIER_BLASTER_2 = 40;
export const MZ2_SOLDIER_SHOTGUN_1 = 41;
export const MZ2_SOLDIER_SHOTGUN_2 = 42;
export const MZ2_SOLDIER_MACHINEGUN_1 = 43;
export const MZ2_SOLDIER_MACHINEGUN_2 = 44;
export const MZ2_SOLDIER_BLASTER_3 = 83;
export const MZ2_SOLDIER_SHOTGUN_3 = 84;
export const MZ2_SOLDIER_MACHINEGUN_3 = 85;
export const MZ2_SOLDIER_BLASTER_4 = 86;
export const MZ2_SOLDIER_SHOTGUN_4 = 87;
export const MZ2_SOLDIER_MACHINEGUN_4 = 88;
export const MZ2_SOLDIER_BLASTER_5 = 89;
export const MZ2_SOLDIER_SHOTGUN_5 = 90;
export const MZ2_SOLDIER_MACHINEGUN_5 = 91;
export const MZ2_SOLDIER_BLASTER_6 = 92;
export const MZ2_SOLDIER_SHOTGUN_6 = 93;
export const MZ2_SOLDIER_MACHINEGUN_6 = 94;
export const MZ2_SOLDIER_BLASTER_7 = 95;
export const MZ2_SOLDIER_SHOTGUN_7 = 96;
export const MZ2_SOLDIER_MACHINEGUN_7 = 97;
export const MZ2_SOLDIER_BLASTER_8 = 98;
export const MZ2_SOLDIER_SHOTGUN_8 = 99;
export const MZ2_SOLDIER_MACHINEGUN_8 = 100;

const SOUND_IDLE = "soldier/solidle1.wav";
const SOUND_SIGHT1 = "soldier/solsght1.wav";
const SOUND_SIGHT2 = "soldier/solsrch1.wav";
const SOUND_PAIN_LIGHT = "soldier/solpain2.wav";
const SOUND_PAIN = "soldier/solpain1.wav";
const SOUND_PAIN_SS = "soldier/solpain3.wav";
const SOUND_DEATH_LIGHT = "soldier/soldeth2.wav";
const SOUND_DEATH = "soldier/soldeth1.wav";
const SOUND_DEATH_SS = "soldier/soldeth3.wav";
const SOUND_COCK = "infantry/infatck3.wav";

/**
 * Original name: N/A
 * Source: N/A (runtime sound cache)
 * Category: New
 * Purpose: Stores registered sound handles returned by the explicit TS runtime.
 */
let sound_idle = 0;
let sound_sight1 = 0;
let sound_sight2 = 0;
let sound_pain_light = 0;
let sound_pain = 0;
let sound_pain_ss = 0;
let sound_death_light = 0;
let sound_death = 0;
let sound_death_ss = 0;
let sound_cock = 0;

const blaster_flash = [
  MZ2_SOLDIER_BLASTER_1, MZ2_SOLDIER_BLASTER_2, MZ2_SOLDIER_BLASTER_3, MZ2_SOLDIER_BLASTER_4,
  MZ2_SOLDIER_BLASTER_5, MZ2_SOLDIER_BLASTER_6, MZ2_SOLDIER_BLASTER_7, MZ2_SOLDIER_BLASTER_8
];
const shotgun_flash = [
  MZ2_SOLDIER_SHOTGUN_1, MZ2_SOLDIER_SHOTGUN_2, MZ2_SOLDIER_SHOTGUN_3, MZ2_SOLDIER_SHOTGUN_4,
  MZ2_SOLDIER_SHOTGUN_5, MZ2_SOLDIER_SHOTGUN_6, MZ2_SOLDIER_SHOTGUN_7, MZ2_SOLDIER_SHOTGUN_8
];
const machinegun_flash = [
  MZ2_SOLDIER_MACHINEGUN_1, MZ2_SOLDIER_MACHINEGUN_2, MZ2_SOLDIER_MACHINEGUN_3, MZ2_SOLDIER_MACHINEGUN_4,
  MZ2_SOLDIER_MACHINEGUN_5, MZ2_SOLDIER_MACHINEGUN_6, MZ2_SOLDIER_MACHINEGUN_7, MZ2_SOLDIER_MACHINEGUN_8
];

/**
 * Original name: soldier_idle
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Randomly plays the soldier idle voice sound on the original idle channel/attenuation.
 * Porting notes: Uses the gameplay runtime sound event bridge instead of direct `gi.sound`.
 */
export function soldier_idle(self: GameEntity, runtime: GameRuntime): void {
  if (random() > 0.8) {
    emitRegisteredGameSound(runtime, self, sound_idle, SOUND_IDLE, soundOptions(CHAN_VOICE, ATTN_IDLE));
  }
}

/**
 * Original name: soldier_cock
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Plays the cocking sound with idle attenuation on FRAME_stand322 and normal attenuation otherwise.
 * Porting notes: Uses the gameplay runtime sound event bridge instead of direct `gi.sound`.
 */
export function soldier_cock(self: GameEntity, runtime: GameRuntime): void {
  emitRegisteredGameSound(
    runtime,
    self,
    sound_cock,
    SOUND_COCK,
    soundOptions(CHAN_WEAPON, self.s.frame === FRAME_stand322 ? ATTN_IDLE : ATTN_NORM)
  );
}

const soldier_frames_stand1 = makeFrames(ai_stand, new Array<number>(30).fill(0), indexedThinks(30, [[0, soldier_idle]]));
export const soldier_move_stand1: GameMonsterMove = {
  firstframe: FRAME_stand101,
  lastframe: FRAME_stand130,
  frame: soldier_frames_stand1,
  endfunc: soldier_stand
};

const soldier_frames_stand3 = makeFrames(ai_stand, new Array<number>(39).fill(0), indexedThinks(39, [[21, soldier_cock]]));
export const soldier_move_stand3: GameMonsterMove = {
  firstframe: FRAME_stand301,
  lastframe: FRAME_stand339,
  frame: soldier_frames_stand3,
  endfunc: soldier_stand
};

/**
 * Original name: soldier_stand
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Alternates between the short and long stand loops with the original random threshold.
 * Porting notes: C move pointers are represented by shared `GameMonsterMove` object identity.
 */
export function soldier_stand(self: GameEntity): void {
  if (self.monsterinfo.currentmove === soldier_move_stand3 || random() < 0.8) {
    self.monsterinfo.currentmove = soldier_move_stand1;
  } else {
    self.monsterinfo.currentmove = soldier_move_stand3;
  }
}

/**
 * Original name: soldier_walk1_random
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Randomly loops the long walk animation back to `FRAME_walk101` using the original 0.1 threshold.
 * Porting notes: Writes `monsterinfo.nextframe` directly like the C callback.
 */
export function soldier_walk1_random(self: GameEntity): void {
  if (random() > 0.1) {
    self.monsterinfo.nextframe = FRAME_walk101;
  }
}

const soldier_frames_walk1 = makeFrames(
  ai_walk,
  [3, 6, 2, 2, 2, 1, 6, 5, 3, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  indexedThinks(33, [[9, soldier_walk1_random]])
);
export const soldier_move_walk1: GameMonsterMove = {
  firstframe: FRAME_walk101,
  lastframe: FRAME_walk133,
  frame: soldier_frames_walk1,
  endfunc: undefined
};

const soldier_frames_walk2 = makeFrames(ai_walk, [4, 4, 9, 8, 5, 1, 3, 7, 6, 7]);
export const soldier_move_walk2: GameMonsterMove = {
  firstframe: FRAME_walk209,
  lastframe: FRAME_walk218,
  frame: soldier_frames_walk2,
  endfunc: undefined
};

/**
 * Original name: soldier_walk
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Chooses between the two walk moves using the original 50/50 random branch.
 */
export function soldier_walk(self: GameEntity): void {
  self.monsterinfo.currentmove = random() < 0.5 ? soldier_move_walk1 : soldier_move_walk2;
}

const soldier_frames_start_run = makeFrames(ai_run, [7, 5]);
export const soldier_move_start_run: GameMonsterMove = {
  firstframe: FRAME_run01,
  lastframe: FRAME_run02,
  frame: soldier_frames_start_run,
  endfunc: soldier_run
};

const soldier_frames_run = makeFrames(ai_run, [10, 11, 11, 16, 10, 15]);
export const soldier_move_run: GameMonsterMove = {
  firstframe: FRAME_run03,
  lastframe: FRAME_run08,
  frame: soldier_frames_run,
  endfunc: undefined
};

/**
 * Original name: soldier_run
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Honors `AI_STAND_GROUND`, transitions walk/start-run into the run loop, otherwise starts the run animation.
 */
export function soldier_run(self: GameEntity): void {
  if ((self.monsterinfo.aiflags & AI_STAND_GROUND) !== 0) {
    self.monsterinfo.currentmove = soldier_move_stand1;
    return;
  }

  if (
    self.monsterinfo.currentmove === soldier_move_walk1 ||
    self.monsterinfo.currentmove === soldier_move_walk2 ||
    self.monsterinfo.currentmove === soldier_move_start_run
  ) {
    self.monsterinfo.currentmove = soldier_move_run;
  } else {
    self.monsterinfo.currentmove = soldier_move_start_run;
  }
}

const soldier_frames_pain1 = makeFrames(ai_move, [-3, 4, 1, 1, 0]);
export const soldier_move_pain1: GameMonsterMove = {
  firstframe: FRAME_pain101,
  lastframe: FRAME_pain105,
  frame: soldier_frames_pain1,
  endfunc: soldier_run
};

const soldier_frames_pain2 = makeFrames(ai_move, [-13, -1, 2, 4, 2, 3, 2]);
export const soldier_move_pain2: GameMonsterMove = {
  firstframe: FRAME_pain201,
  lastframe: FRAME_pain207,
  frame: soldier_frames_pain2,
  endfunc: soldier_run
};

const soldier_frames_pain3 = makeFrames(ai_move, [-8, 10, -4, -1, -3, 0, 3, 0, 0, 0, 0, 1, 0, 1, 2, 4, 3, 2]);
export const soldier_move_pain3: GameMonsterMove = {
  firstframe: FRAME_pain301,
  lastframe: FRAME_pain318,
  frame: soldier_frames_pain3,
  endfunc: soldier_run
};

const soldier_frames_pain4 = makeFrames(ai_move, [0, 0, 0, -10, -6, 8, 4, 1, 0, 2, 5, 2, -1, -1, 3, 2, 0]);
export const soldier_move_pain4: GameMonsterMove = {
  firstframe: FRAME_pain401,
  lastframe: FRAME_pain417,
  frame: soldier_frames_pain4,
  endfunc: soldier_run
};

/**
 * Original name: soldier_pain
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Updates damaged skin, debounces pain, selects pain sounds/moves, preserves airborne pain4 and nightmare no-pain animation rules.
 * Porting notes: Uses runtime time/skill in place of `level.time` and `skill->value`.
 */
export function soldier_pain(self: GameEntity, _other: GameEntity | null, _kick: number, _damage: number, runtime: GameRuntime): void {
  if (self.health < self.max_health / 2) {
    self.s.skinnum |= 1;
  }

  if (runtime.time < self.pain_debounce_time) {
    if (
      self.velocity[2] > 100 &&
      (self.monsterinfo.currentmove === soldier_move_pain1 ||
        self.monsterinfo.currentmove === soldier_move_pain2 ||
        self.monsterinfo.currentmove === soldier_move_pain3)
    ) {
      self.monsterinfo.currentmove = soldier_move_pain4;
    }
    return;
  }

  self.pain_debounce_time = runtime.time + 3;
  const n = self.s.skinnum | 1;
  if (n === 1) {
    emitRegisteredGameSound(runtime, self, sound_pain_light, SOUND_PAIN_LIGHT, soundOptions(CHAN_VOICE));
  } else if (n === 3) {
    emitRegisteredGameSound(runtime, self, sound_pain, SOUND_PAIN, soundOptions(CHAN_VOICE));
  } else {
    emitRegisteredGameSound(runtime, self, sound_pain_ss, SOUND_PAIN_SS, soundOptions(CHAN_VOICE));
  }

  if (self.velocity[2] > 100) {
    self.monsterinfo.currentmove = soldier_move_pain4;
    return;
  }
  if (runtime.skill === 3) {
    return;
  }

  const r = random();
  if (r < 0.33) {
    self.monsterinfo.currentmove = soldier_move_pain1;
  } else if (r < 0.66) {
    self.monsterinfo.currentmove = soldier_move_pain2;
  } else {
    self.monsterinfo.currentmove = soldier_move_pain3;
  }
}

/**
 * Original name: soldier_fire
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Selects the weapon muzzle table from skin, projects the source, aims at the enemy with original spread, and fires blaster/shotgun/machinegun variants.
 * Porting notes: The TS guard for a missing enemy falls back to forward aim to keep runtime robust; normal attack paths provide `self.enemy` like C.
 */
export function soldier_fire(self: GameEntity, flash_number: number, runtime: GameRuntime): void {
  let flash_index: number;
  if (self.s.skinnum < 2) {
    flash_index = blaster_flash[flash_number];
  } else if (self.s.skinnum < 4) {
    flash_index = shotgun_flash[flash_number];
  } else {
    flash_index = machinegun_flash[flash_number];
  }

  const basis = AngleVectors(self.s.angles);
  const start = G_ProjectSource(self.s.origin, getMonsterFlashOffset(flash_index), basis.forward, basis.right);
  let aim: vec3_t;

  if (flash_number === 5 || flash_number === 6 || !self.enemy) {
    aim = [...basis.forward];
  } else {
    const end: vec3_t = [...self.enemy.s.origin];
    end[2] += self.enemy.viewheight;
    const dir = vectoangles(subtractVec3(end, start));
    const aimBasis = AngleVectors(dir);
    let projected = addVec3(start, scaleVec3(aimBasis.forward, 8192));
    projected = addVec3(projected, scaleVec3(aimBasis.right, crandom() * 1000));
    projected = addVec3(projected, scaleVec3(aimBasis.up, crandom() * 500));
    aim = normalizeVec3(subtractVec3(projected, start));
  }

  if (self.s.skinnum <= 1) {
    monster_fire_blaster(self, start, aim, 5, 600, flash_index, EF_BLASTER, runtime);
  } else if (self.s.skinnum <= 3) {
    monster_fire_shotgun(
      self,
      start,
      aim,
      2,
      1,
      DEFAULT_SHOTGUN_HSPREAD,
      DEFAULT_SHOTGUN_VSPREAD,
      DEFAULT_SHOTGUN_COUNT,
      flash_index,
      runtime
    );
  } else {
    if ((self.monsterinfo.aiflags & AI_HOLD_FRAME) === 0) {
      self.monsterinfo.pausetime = runtime.time + (3 + randomInt(8)) * FRAMETIME;
    }
    monster_fire_bullet(self, start, aim, 2, 4, DEFAULT_BULLET_HSPREAD, DEFAULT_BULLET_VSPREAD, flash_index, runtime);
    if (runtime.time >= self.monsterinfo.pausetime) {
      self.monsterinfo.aiflags &= ~AI_HOLD_FRAME;
    } else {
      self.monsterinfo.aiflags |= AI_HOLD_FRAME;
    }
  }
}

/**
 * Original name: soldier_fire1
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Attack1 wrapper that fires muzzle slot 0.
 */
export function soldier_fire1(self: GameEntity, runtime: GameRuntime): void { soldier_fire(self, 0, runtime); }

/**
 * Original name: soldier_fire2
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Attack2 wrapper that fires muzzle slot 1.
 */
export function soldier_fire2(self: GameEntity, runtime: GameRuntime): void { soldier_fire(self, 1, runtime); }

/**
 * Original name: soldier_fire4
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Attack4 wrapper that fires muzzle slot 3.
 */
export function soldier_fire4(self: GameEntity, runtime: GameRuntime): void { soldier_fire(self, 3, runtime); }

/**
 * Original name: soldier_fire8
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Attack6 wrapper that fires muzzle slot 7.
 */
export function soldier_fire8(self: GameEntity, runtime: GameRuntime): void { soldier_fire(self, 7, runtime); }

/**
 * Original name: soldier_fire6
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Death animation wrapper that fires muzzle slot 5 with forward aim.
 */
export function soldier_fire6(self: GameEntity, runtime: GameRuntime): void { soldier_fire(self, 5, runtime); }

/**
 * Original name: soldier_fire7
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Death animation wrapper that fires muzzle slot 6 with forward aim.
 */
export function soldier_fire7(self: GameEntity, runtime: GameRuntime): void { soldier_fire(self, 6, runtime); }

/**
 * Original name: soldier_attack1_refire1
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Refires or skips the blaster attack based on skin, enemy health, nightmare random chance, and melee range.
 * Porting notes: Checks `self.enemy` before dereferencing it; normal C attack flow has an enemy.
 */
export function soldier_attack1_refire1(self: GameEntity, runtime: GameRuntime): void {
  if (self.s.skinnum > 1 || !self.enemy || self.enemy.health <= 0) {
    return;
  }
  self.monsterinfo.nextframe = ((runtime.skill === 3 && random() < 0.5) || range(self, self.enemy) === RANGE_MELEE)
    ? FRAME_attak102
    : FRAME_attak110;
}

/**
 * Original name: soldier_attack1_refire2
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Shotgun-side attack1 refire gate using the original skin/enemy/skill/range branches.
 */
export function soldier_attack1_refire2(self: GameEntity, runtime: GameRuntime): void {
  if (self.s.skinnum < 2 || !self.enemy || self.enemy.health <= 0) {
    return;
  }
  if ((runtime.skill === 3 && random() < 0.5) || range(self, self.enemy) === RANGE_MELEE) {
    self.monsterinfo.nextframe = FRAME_attak102;
  }
}

const soldier_frames_attack1 = makeFrames(ai_charge, new Array<number>(12).fill(0), indexedThinks(12, [
  [2, soldier_fire1],
  [5, soldier_attack1_refire1],
  [7, soldier_cock],
  [8, soldier_attack1_refire2]
]));
export const soldier_move_attack1: GameMonsterMove = {
  firstframe: FRAME_attak101,
  lastframe: FRAME_attak112,
  frame: soldier_frames_attack1,
  endfunc: soldier_run
};

/**
 * Original name: soldier_attack2_refire1
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Refires or skips the second blaster attack using the original frame targets and branch conditions.
 */
export function soldier_attack2_refire1(self: GameEntity, runtime: GameRuntime): void {
  if (self.s.skinnum > 1 || !self.enemy || self.enemy.health <= 0) {
    return;
  }
  self.monsterinfo.nextframe = ((runtime.skill === 3 && random() < 0.5) || range(self, self.enemy) === RANGE_MELEE)
    ? FRAME_attak204
    : FRAME_attak216;
}

/**
 * Original name: soldier_attack2_refire2
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Shotgun-side attack2 refire gate using the original skin/enemy/skill/range branches.
 */
export function soldier_attack2_refire2(self: GameEntity, runtime: GameRuntime): void {
  if (self.s.skinnum < 2 || !self.enemy || self.enemy.health <= 0) {
    return;
  }
  if ((runtime.skill === 3 && random() < 0.5) || range(self, self.enemy) === RANGE_MELEE) {
    self.monsterinfo.nextframe = FRAME_attak204;
  }
}

const soldier_frames_attack2 = makeFrames(ai_charge, new Array<number>(18).fill(0), indexedThinks(18, [
  [4, soldier_fire2],
  [7, soldier_attack2_refire1],
  [12, soldier_cock],
  [14, soldier_attack2_refire2]
]));
export const soldier_move_attack2: GameMonsterMove = {
  firstframe: FRAME_attak201,
  lastframe: FRAME_attak218,
  frame: soldier_frames_attack2,
  endfunc: soldier_run
};

/**
 * Original name: soldier_duck_down
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Enters the ducked state, shrinks the bbox, enables damage, sets pause time, and relinks the entity.
 */
export function soldier_duck_down(self: GameEntity, runtime: GameRuntime): void {
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
 * Original name: soldier_duck_up
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Leaves the ducked state, restores bbox/damage mode, and relinks the entity.
 */
export function soldier_duck_up(self: GameEntity, runtime: GameRuntime): void {
  self.monsterinfo.aiflags &= ~AI_DUCKED;
  self.maxs[2] += 32;
  self.takedamage = damage_t.DAMAGE_AIM;
  linkGameEntity(runtime, self);
}

/**
 * Original name: soldier_fire3
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Ducks first, then fires muzzle slot 2.
 */
export function soldier_fire3(self: GameEntity, runtime: GameRuntime): void {
  soldier_duck_down(self, runtime);
  soldier_fire(self, 2, runtime);
}

/**
 * Original name: soldier_attack3_refire
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Holds the duck-and-shoot loop while pause time is still more than 0.4 seconds away.
 */
export function soldier_attack3_refire(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.time + 0.4 < self.monsterinfo.pausetime) {
    self.monsterinfo.nextframe = FRAME_attak303;
  }
}

const soldier_frames_attack3 = makeFrames(ai_charge, new Array<number>(9).fill(0), indexedThinks(9, [
  [2, soldier_fire3],
  [5, soldier_attack3_refire],
  [6, soldier_duck_up]
]));
export const soldier_move_attack3: GameMonsterMove = {
  firstframe: FRAME_attak301,
  lastframe: FRAME_attak309,
  frame: soldier_frames_attack3,
  endfunc: soldier_run
};

const soldier_frames_attack4 = makeFrames(ai_charge, new Array<number>(6).fill(0), indexedThinks(6, [[2, soldier_fire4]]));
export const soldier_move_attack4: GameMonsterMove = {
  firstframe: FRAME_attak401,
  lastframe: FRAME_attak406,
  frame: soldier_frames_attack4,
  endfunc: soldier_run
};

/**
 * Original name: soldier_attack6_refire
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: In nightmare skill, loops the run-and-shoot move for live enemies at mid-or-far range.
 */
export function soldier_attack6_refire(self: GameEntity, runtime: GameRuntime): void {
  if (!self.enemy || self.enemy.health <= 0) {
    return;
  }
  if (range(self, self.enemy) < RANGE_MID) {
    return;
  }
  if (runtime.skill === 3) {
    self.monsterinfo.nextframe = FRAME_runs03;
  }
}

const soldier_frames_attack6 = makeFrames(
  ai_charge,
  [10, 4, 12, 11, 13, 18, 15, 14, 11, 8, 11, 12, 12, 17],
  indexedThinks(14, [
    [3, soldier_fire8],
    [13, soldier_attack6_refire]
  ])
);
export const soldier_move_attack6: GameMonsterMove = {
  firstframe: FRAME_runs01,
  lastframe: FRAME_runs14,
  frame: soldier_frames_attack6,
  endfunc: soldier_run
};

/**
 * Original name: soldier_attack
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Chooses attack1/attack2 for light and shotgun soldiers, and attack4 for machinegun soldiers.
 */
export function soldier_attack(self: GameEntity): void {
  if (self.s.skinnum < 4) {
    self.monsterinfo.currentmove = random() < 0.5 ? soldier_move_attack1 : soldier_move_attack2;
  } else {
    self.monsterinfo.currentmove = soldier_move_attack4;
  }
}

/**
 * Original name: soldier_sight
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Close
 * Behavior: Plays one of the two sight sounds and may switch to attack6 at nonzero skill and mid-or-far range.
 * Porting notes: Uses the runtime skill value and sound event bridge; requires `self.enemy` before range checks.
 */
export function soldier_sight(self: GameEntity, _other: GameEntity | null, runtime: GameRuntime): void {
  if (random() < 0.5) {
    emitRegisteredGameSound(runtime, self, sound_sight1, SOUND_SIGHT1, soundOptions(CHAN_VOICE));
  } else {
    emitRegisteredGameSound(runtime, self, sound_sight2, SOUND_SIGHT2, soundOptions(CHAN_VOICE));
  }

  if (runtime.skill > 0 && self.enemy && range(self, self.enemy) >= RANGE_MID && random() > 0.5) {
    self.monsterinfo.currentmove = soldier_move_attack6;
  }
}

/**
 * Original name: soldier_duck_hold
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Sets or clears `AI_HOLD_FRAME` according to pause time.
 */
export function soldier_duck_hold(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.time >= self.monsterinfo.pausetime) {
    self.monsterinfo.aiflags &= ~AI_HOLD_FRAME;
  } else {
    self.monsterinfo.aiflags |= AI_HOLD_FRAME;
  }
}

const soldier_frames_duck = makeFrames(ai_move, [5, -1, 1, 0, 5], [
  soldier_duck_down,
  soldier_duck_hold,
  undefined,
  soldier_duck_up,
  undefined
]);
export const soldier_move_duck: GameMonsterMove = {
  firstframe: FRAME_duck01,
  lastframe: FRAME_duck05,
  frame: soldier_frames_duck,
  endfunc: soldier_run
};

/**
 * Original name: soldier_dodge
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Randomly ducks or switches to duck-and-shoot depending on skill, eta, and the original random thresholds.
 */
export function soldier_dodge(self: GameEntity, attacker: GameEntity | null, eta: number, runtime: GameRuntime): void {
  if (random() > 0.25) {
    return;
  }
  if (!self.enemy) {
    self.enemy = attacker;
  }
  if (runtime.skill === 0) {
    self.monsterinfo.currentmove = soldier_move_duck;
    return;
  }

  self.monsterinfo.pausetime = runtime.time + eta + 0.3;
  const r = random();
  if (runtime.skill === 1) {
    self.monsterinfo.currentmove = r > 0.33 ? soldier_move_duck : soldier_move_attack3;
    return;
  }
  if (runtime.skill >= 2) {
    self.monsterinfo.currentmove = r > 0.66 ? soldier_move_duck : soldier_move_attack3;
    return;
  }
  self.monsterinfo.currentmove = soldier_move_attack3;
}

/**
 * Original name: soldier_dead
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Converts the corpse to toss movement, deadmonster bbox/flags, clears nextthink, and relinks it.
 */
export function soldier_dead(self: GameEntity, runtime: GameRuntime): void {
  setVec3(self.mins, -16, -16, -24);
  setVec3(self.maxs, 16, 16, -8);
  self.movetype = MOVETYPE_TOSS;
  self.svflags |= SVF_DEADMONSTER;
  self.nextthink = 0;
  linkGameEntity(runtime, self);
}

const soldier_frames_death1 = makeFrames(
  ai_move,
  [0, -10, -10, -10, -5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  indexedThinks(36, [
    [21, soldier_fire6],
    [24, soldier_fire7]
  ])
);
export const soldier_move_death1: GameMonsterMove = {
  firstframe: FRAME_death101,
  lastframe: FRAME_death136,
  frame: soldier_frames_death1,
  endfunc: soldier_dead
};

const soldier_frames_death2 = makeFrames(ai_move, [-5, -5, -5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
export const soldier_move_death2: GameMonsterMove = {
  firstframe: FRAME_death201,
  lastframe: FRAME_death235,
  frame: soldier_frames_death2,
  endfunc: soldier_dead
};

const soldier_frames_death3 = makeFrames(ai_move, [-5, -5, -5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
export const soldier_move_death3: GameMonsterMove = {
  firstframe: FRAME_death301,
  lastframe: FRAME_death345,
  frame: soldier_frames_death3,
  endfunc: soldier_dead
};

const soldier_frames_death4 = makeFrames(ai_move, new Array<number>(53).fill(0));
export const soldier_move_death4: GameMonsterMove = {
  firstframe: FRAME_death401,
  lastframe: FRAME_death453,
  frame: soldier_frames_death4,
  endfunc: soldier_dead
};

const soldier_frames_death5 = makeFrames(ai_move, [-5, -5, -5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
export const soldier_move_death5: GameMonsterMove = {
  firstframe: FRAME_death501,
  lastframe: FRAME_death524,
  frame: soldier_frames_death5,
  endfunc: soldier_dead
};

const soldier_frames_death6 = makeFrames(ai_move, new Array<number>(10).fill(0));
export const soldier_move_death6: GameMonsterMove = {
  firstframe: FRAME_death601,
  lastframe: FRAME_death610,
  frame: soldier_frames_death6,
  endfunc: soldier_dead
};

/**
 * Original name: soldier_die
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Handles gib death, dead reentry, death skin/sounds, headshot death, and random regular death moves.
 * Porting notes: Receives the damage point from the TS damage callback adapter so headshot death parity is preserved.
 */
export function soldier_die(
  self: GameEntity,
  _inflictor: GameEntity | null,
  _attacker: GameEntity | null,
  damage: number,
  runtime: GameRuntime,
  point?: vec3_t
): void {
  if (self.health <= self.gib_health) {
    emitGameSound(runtime, self, "misc/udeath.wav");
    for (let n = 0; n < 3; n += 1) {
      ThrowGib(self, "models/objects/gibs/sm_meat/tris.md2", damage, GIB_ORGANIC, runtime);
    }
    ThrowGib(self, "models/objects/gibs/chest/tris.md2", damage, GIB_ORGANIC, runtime);
    ThrowHead(self, "models/objects/gibs/head2/tris.md2", damage, GIB_ORGANIC, runtime);
    self.deadflag = DEAD_DEAD;
    return;
  }

  if (self.deadflag === DEAD_DEAD) {
    return;
  }

  self.deadflag = DEAD_DEAD;
  self.takedamage = damage_t.DAMAGE_YES;
  self.s.skinnum |= 1;

  if (self.s.skinnum === 1) {
    emitRegisteredGameSound(runtime, self, sound_death_light, SOUND_DEATH_LIGHT, soundOptions(CHAN_VOICE));
  } else if (self.s.skinnum === 3) {
    emitRegisteredGameSound(runtime, self, sound_death, SOUND_DEATH, soundOptions(CHAN_VOICE));
  } else {
    emitRegisteredGameSound(runtime, self, sound_death_ss, SOUND_DEATH_SS, soundOptions(CHAN_VOICE));
  }

  if (point && Math.abs(self.s.origin[2] + self.viewheight - point[2]) <= 4) {
    self.monsterinfo.currentmove = soldier_move_death3;
    return;
  }

  const n = randomInt(5);
  if (n === 0) {
    self.monsterinfo.currentmove = soldier_move_death1;
  } else if (n === 1) {
    self.monsterinfo.currentmove = soldier_move_death2;
  } else if (n === 2) {
    self.monsterinfo.currentmove = soldier_move_death4;
  } else if (n === 3) {
    self.monsterinfo.currentmove = soldier_move_death5;
  } else {
    self.monsterinfo.currentmove = soldier_move_death6;
  }
}

/**
 * Original name: SP_monster_soldier_x
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Shared soldier spawn setup for model, bbox, physics, sounds, callbacks, initial stand move, and walkmonster startup.
 */
export function SP_monster_soldier_x(self: GameEntity, runtime: GameRuntime): void {
  self.s.modelindex = registerGameModel(runtime, "models/monsters/soldier/tris.md2");
  self.monsterinfo.scale = MODEL_SCALE;
  setVec3(self.mins, -16, -16, -24);
  setVec3(self.maxs, 16, 16, 32);
  self.movetype = MOVETYPE_STEP;
  self.solid = SOLID_BBOX;

  sound_idle = registerGameSound(runtime, SOUND_IDLE);
  sound_sight1 = registerGameSound(runtime, SOUND_SIGHT1);
  sound_sight2 = registerGameSound(runtime, SOUND_SIGHT2);
  sound_cock = registerGameSound(runtime, SOUND_COCK);

  self.mass = 100;
  self.pain = soldier_pain;
  self.die = soldier_die;
  self.monsterinfo.stand = soldier_stand;
  self.monsterinfo.walk = soldier_walk;
  self.monsterinfo.run = soldier_run;
  self.monsterinfo.dodge = soldier_dodge;
  self.monsterinfo.attack = soldier_attack;
  self.monsterinfo.melee = undefined;
  self.monsterinfo.sight = soldier_sight;

  linkGameEntity(runtime, self);
  soldier_stand(self);
  walkmonster_start(self, runtime);
}

/**
 * Original name: SP_monster_soldier_light
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Deathmatch-free spawn wrapper for the blaster soldier variant with light soldier assets, skin, health, and gib health.
 */
export function SP_monster_soldier_light(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  SP_monster_soldier_x(self, runtime);
  sound_pain_light = registerGameSound(runtime, SOUND_PAIN_LIGHT);
  sound_death_light = registerGameSound(runtime, SOUND_DEATH_LIGHT);
  registerGameModel(runtime, "models/objects/laser/tris.md2");
  registerGameSound(runtime, "misc/lasfly.wav");
  registerGameSound(runtime, "soldier/solatck2.wav");
  self.s.skinnum = 0;
  self.health = 20;
  self.gib_health = -30;
}

/**
 * Original name: SP_monster_soldier
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Deathmatch-free spawn wrapper for the shotgun soldier variant with variant assets, skin, health, and gib health.
 */
export function SP_monster_soldier(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  SP_monster_soldier_x(self, runtime);
  sound_pain = registerGameSound(runtime, SOUND_PAIN);
  sound_death = registerGameSound(runtime, SOUND_DEATH);
  registerGameSound(runtime, "soldier/solatck1.wav");
  self.s.skinnum = 2;
  self.health = 30;
  self.gib_health = -30;
}

/**
 * Original name: SP_monster_soldier_ss
 * Source: game/m_soldier.c
 * Category: Ported
 * Fidelity level: Strict
 * Behavior: Deathmatch-free spawn wrapper for the machinegun soldier variant with variant assets, skin, health, and gib health.
 */
export function SP_monster_soldier_ss(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  SP_monster_soldier_x(self, runtime);
  sound_pain_ss = registerGameSound(runtime, SOUND_PAIN_SS);
  sound_death_ss = registerGameSound(runtime, SOUND_DEATH_SS);
  registerGameSound(runtime, "soldier/solatck3.wav");
  self.s.skinnum = 4;
  self.health = 40;
  self.gib_health = -30;
}

/**
 * Original name: N/A
 * Source: N/A (local frame helper)
 * Category: New
 * Purpose: Builds declarative monster frame records from distance and think arrays.
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
 * Source: N/A (local frame helper)
 * Category: New
 * Purpose: Builds sparse think-function arrays for declarative monster frame tables.
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
 * Source: N/A (local sound helper)
 * Category: New
 * Purpose: Creates runtime sound option records matching the original `gi.sound` defaults.
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
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Mutates bbox vectors in place while keeping the ported code compact.
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
 * Purpose: Adds two temporary aim vectors for soldier firing calculations.
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
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Subtracts temporary aim vectors for soldier firing calculations.
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
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Scales temporary aim vectors for soldier firing calculations.
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
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Normalizes temporary aim vectors without mutating runtime entity state.
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
 * Source: N/A (local random helper)
 * Category: New
 * Purpose: Mirrors C integer random selection for soldier death/attack branches.
 */
function randomInt(maxExclusive: number): number {
  return Math.trunc(Math.random() * maxExclusive);
}
