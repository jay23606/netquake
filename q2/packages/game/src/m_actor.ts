/**
 * File: m_actor.ts
 * Source: Quake-2-master/game/m_actor.h and Quake-2-master/game/m_actor.c
 * Purpose: Port of the generated actor model frame constants and misc_actor gameplay behavior.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses the explicit gameplay runtime and asset helpers instead of `gi.*`.
 * - Actor chat messages are queued as runtime `cprintf` events before server/client flushing.
 * - Monster muzzle-flash networking is represented as a gameplay runtime event and drained by client bridges.
 *
 * Notes:
 * - This file keeps the header constants and C behavior together as the principal attachment point for `m_actor`.
 */

import {
  ATTN_NORM,
  AngleVectors,
  CHAN_VOICE,
  PRINT_CHAT,
  YAW,
  type cplane_t,
  type csurface_t,
  type vec3_t
} from "../../qcommon/src/index.js";
import {
  AI_BRUTAL,
  AI_GOOD_GUY,
  AI_HOLD_FRAME,
  AI_STAND_GROUND,
  DEAD_DEAD,
  DEFAULT_BULLET_HSPREAD,
  DEFAULT_BULLET_VSPREAD,
  FRAMETIME,
  GIB_ORGANIC,
  MOVETYPE_STEP,
  MOVETYPE_TOSS,
  SOLID_BBOX,
  SOLID_TRIGGER,
  SVF_DEADMONSTER,
  SVF_NOCLIENT,
  damage_t,
  random
} from "./g_local.js";
import { ai_charge, ai_move, ai_run, ai_stand, ai_turn, ai_walk } from "./g_ai.js";
import { ThrowGib, ThrowHead } from "./g_misc.js";
import { monster_fire_bullet, walkmonster_start } from "./g_monster.js";
import { G_FreeEdict, G_PickTarget, G_ProjectSource, G_SetMovedir, G_UseTargets, vectoyaw, vtos } from "./g_utils.js";
import { getMonsterFlashOffset } from "./m_flash.js";
import {
  emitRegisteredGameSound,
  emitGameCprintf,
  linkGameEntity,
  registerGameModel,
  registerGameSound,
  type GameEntity,
  type GameMonsterFrame,
  type GameMonsterMove,
  type GameRuntime
} from "./runtime.js";

export const FRAME_attak01 = 0;
export const FRAME_attak02 = 1;
export const FRAME_attak03 = 2;
export const FRAME_attak04 = 3;
export const FRAME_death101 = 4;
export const FRAME_death102 = 5;
export const FRAME_death103 = 6;
export const FRAME_death104 = 7;
export const FRAME_death105 = 8;
export const FRAME_death106 = 9;
export const FRAME_death107 = 10;
export const FRAME_death201 = 11;
export const FRAME_death202 = 12;
export const FRAME_death203 = 13;
export const FRAME_death204 = 14;
export const FRAME_death205 = 15;
export const FRAME_death206 = 16;
export const FRAME_death207 = 17;
export const FRAME_death208 = 18;
export const FRAME_death209 = 19;
export const FRAME_death210 = 20;
export const FRAME_death211 = 21;
export const FRAME_death212 = 22;
export const FRAME_death213 = 23;
export const FRAME_death301 = 24;
export const FRAME_death302 = 25;
export const FRAME_death303 = 26;
export const FRAME_death304 = 27;
export const FRAME_death305 = 28;
export const FRAME_death306 = 29;
export const FRAME_death307 = 30;
export const FRAME_death308 = 31;
export const FRAME_death309 = 32;
export const FRAME_death310 = 33;
export const FRAME_death311 = 34;
export const FRAME_death312 = 35;
export const FRAME_death313 = 36;
export const FRAME_death314 = 37;
export const FRAME_death315 = 38;
export const FRAME_flip01 = 39;
export const FRAME_flip02 = 40;
export const FRAME_flip03 = 41;
export const FRAME_flip04 = 42;
export const FRAME_flip05 = 43;
export const FRAME_flip06 = 44;
export const FRAME_flip07 = 45;
export const FRAME_flip08 = 46;
export const FRAME_flip09 = 47;
export const FRAME_flip10 = 48;
export const FRAME_flip11 = 49;
export const FRAME_flip12 = 50;
export const FRAME_flip13 = 51;
export const FRAME_flip14 = 52;
export const FRAME_grenad01 = 53;
export const FRAME_grenad02 = 54;
export const FRAME_grenad03 = 55;
export const FRAME_grenad04 = 56;
export const FRAME_grenad05 = 57;
export const FRAME_grenad06 = 58;
export const FRAME_grenad07 = 59;
export const FRAME_grenad08 = 60;
export const FRAME_grenad09 = 61;
export const FRAME_grenad10 = 62;
export const FRAME_grenad11 = 63;
export const FRAME_grenad12 = 64;
export const FRAME_grenad13 = 65;
export const FRAME_grenad14 = 66;
export const FRAME_grenad15 = 67;
export const FRAME_jump01 = 68;
export const FRAME_jump02 = 69;
export const FRAME_jump03 = 70;
export const FRAME_jump04 = 71;
export const FRAME_jump05 = 72;
export const FRAME_jump06 = 73;
export const FRAME_pain101 = 74;
export const FRAME_pain102 = 75;
export const FRAME_pain103 = 76;
export const FRAME_pain201 = 77;
export const FRAME_pain202 = 78;
export const FRAME_pain203 = 79;
export const FRAME_pain301 = 80;
export const FRAME_pain302 = 81;
export const FRAME_pain303 = 82;
export const FRAME_push01 = 83;
export const FRAME_push02 = 84;
export const FRAME_push03 = 85;
export const FRAME_push04 = 86;
export const FRAME_push05 = 87;
export const FRAME_push06 = 88;
export const FRAME_push07 = 89;
export const FRAME_push08 = 90;
export const FRAME_push09 = 91;
export const FRAME_run01 = 92;
export const FRAME_run02 = 93;
export const FRAME_run03 = 94;
export const FRAME_run04 = 95;
export const FRAME_run05 = 96;
export const FRAME_run06 = 97;
export const FRAME_run07 = 98;
export const FRAME_run08 = 99;
export const FRAME_run09 = 100;
export const FRAME_run10 = 101;
export const FRAME_run11 = 102;
export const FRAME_run12 = 103;
export const FRAME_runs01 = 104;
export const FRAME_runs02 = 105;
export const FRAME_runs03 = 106;
export const FRAME_runs04 = 107;
export const FRAME_runs05 = 108;
export const FRAME_runs06 = 109;
export const FRAME_runs07 = 110;
export const FRAME_runs08 = 111;
export const FRAME_runs09 = 112;
export const FRAME_runs10 = 113;
export const FRAME_runs11 = 114;
export const FRAME_runs12 = 115;
export const FRAME_salute01 = 116;
export const FRAME_salute02 = 117;
export const FRAME_salute03 = 118;
export const FRAME_salute04 = 119;
export const FRAME_salute05 = 120;
export const FRAME_salute06 = 121;
export const FRAME_salute07 = 122;
export const FRAME_salute08 = 123;
export const FRAME_salute09 = 124;
export const FRAME_salute10 = 125;
export const FRAME_salute11 = 126;
export const FRAME_salute12 = 127;
export const FRAME_stand101 = 128;
export const FRAME_stand102 = 129;
export const FRAME_stand103 = 130;
export const FRAME_stand104 = 131;
export const FRAME_stand105 = 132;
export const FRAME_stand106 = 133;
export const FRAME_stand107 = 134;
export const FRAME_stand108 = 135;
export const FRAME_stand109 = 136;
export const FRAME_stand110 = 137;
export const FRAME_stand111 = 138;
export const FRAME_stand112 = 139;
export const FRAME_stand113 = 140;
export const FRAME_stand114 = 141;
export const FRAME_stand115 = 142;
export const FRAME_stand116 = 143;
export const FRAME_stand117 = 144;
export const FRAME_stand118 = 145;
export const FRAME_stand119 = 146;
export const FRAME_stand120 = 147;
export const FRAME_stand121 = 148;
export const FRAME_stand122 = 149;
export const FRAME_stand123 = 150;
export const FRAME_stand124 = 151;
export const FRAME_stand125 = 152;
export const FRAME_stand126 = 153;
export const FRAME_stand127 = 154;
export const FRAME_stand128 = 155;
export const FRAME_stand129 = 156;
export const FRAME_stand130 = 157;
export const FRAME_stand131 = 158;
export const FRAME_stand132 = 159;
export const FRAME_stand133 = 160;
export const FRAME_stand134 = 161;
export const FRAME_stand135 = 162;
export const FRAME_stand136 = 163;
export const FRAME_stand137 = 164;
export const FRAME_stand138 = 165;
export const FRAME_stand139 = 166;
export const FRAME_stand140 = 167;
export const FRAME_stand201 = 168;
export const FRAME_stand202 = 169;
export const FRAME_stand203 = 170;
export const FRAME_stand204 = 171;
export const FRAME_stand205 = 172;
export const FRAME_stand206 = 173;
export const FRAME_stand207 = 174;
export const FRAME_stand208 = 175;
export const FRAME_stand209 = 176;
export const FRAME_stand210 = 177;
export const FRAME_stand211 = 178;
export const FRAME_stand212 = 179;
export const FRAME_stand213 = 180;
export const FRAME_stand214 = 181;
export const FRAME_stand215 = 182;
export const FRAME_stand216 = 183;
export const FRAME_stand217 = 184;
export const FRAME_stand218 = 185;
export const FRAME_stand219 = 186;
export const FRAME_stand220 = 187;
export const FRAME_stand221 = 188;
export const FRAME_stand222 = 189;
export const FRAME_stand223 = 190;
export const FRAME_swim01 = 191;
export const FRAME_swim02 = 192;
export const FRAME_swim03 = 193;
export const FRAME_swim04 = 194;
export const FRAME_swim05 = 195;
export const FRAME_swim06 = 196;
export const FRAME_swim07 = 197;
export const FRAME_swim08 = 198;
export const FRAME_swim09 = 199;
export const FRAME_swim10 = 200;
export const FRAME_swim11 = 201;
export const FRAME_swim12 = 202;
export const FRAME_sw_atk01 = 203;
export const FRAME_sw_atk02 = 204;
export const FRAME_sw_atk03 = 205;
export const FRAME_sw_atk04 = 206;
export const FRAME_sw_atk05 = 207;
export const FRAME_sw_atk06 = 208;
export const FRAME_sw_pan01 = 209;
export const FRAME_sw_pan02 = 210;
export const FRAME_sw_pan03 = 211;
export const FRAME_sw_pan04 = 212;
export const FRAME_sw_pan05 = 213;
export const FRAME_sw_std01 = 214;
export const FRAME_sw_std02 = 215;
export const FRAME_sw_std03 = 216;
export const FRAME_sw_std04 = 217;
export const FRAME_sw_std05 = 218;
export const FRAME_sw_std06 = 219;
export const FRAME_sw_std07 = 220;
export const FRAME_sw_std08 = 221;
export const FRAME_sw_std09 = 222;
export const FRAME_sw_std10 = 223;
export const FRAME_sw_std11 = 224;
export const FRAME_sw_std12 = 225;
export const FRAME_sw_std13 = 226;
export const FRAME_sw_std14 = 227;
export const FRAME_sw_std15 = 228;
export const FRAME_sw_std16 = 229;
export const FRAME_sw_std17 = 230;
export const FRAME_sw_std18 = 231;
export const FRAME_sw_std19 = 232;
export const FRAME_sw_std20 = 233;
export const FRAME_taunt01 = 234;
export const FRAME_taunt02 = 235;
export const FRAME_taunt03 = 236;
export const FRAME_taunt04 = 237;
export const FRAME_taunt05 = 238;
export const FRAME_taunt06 = 239;
export const FRAME_taunt07 = 240;
export const FRAME_taunt08 = 241;
export const FRAME_taunt09 = 242;
export const FRAME_taunt10 = 243;
export const FRAME_taunt11 = 244;
export const FRAME_taunt12 = 245;
export const FRAME_taunt13 = 246;
export const FRAME_taunt14 = 247;
export const FRAME_taunt15 = 248;
export const FRAME_taunt16 = 249;
export const FRAME_taunt17 = 250;
export const FRAME_walk01 = 251;
export const FRAME_walk02 = 252;
export const FRAME_walk03 = 253;
export const FRAME_walk04 = 254;
export const FRAME_walk05 = 255;
export const FRAME_walk06 = 256;
export const FRAME_walk07 = 257;
export const FRAME_walk08 = 258;
export const FRAME_walk09 = 259;
export const FRAME_walk10 = 260;
export const FRAME_walk11 = 261;
export const FRAME_wave01 = 262;
export const FRAME_wave02 = 263;
export const FRAME_wave03 = 264;
export const FRAME_wave04 = 265;
export const FRAME_wave05 = 266;
export const FRAME_wave06 = 267;
export const FRAME_wave07 = 268;
export const FRAME_wave08 = 269;
export const FRAME_wave09 = 270;
export const FRAME_wave10 = 271;
export const FRAME_wave11 = 272;
export const FRAME_wave12 = 273;
export const FRAME_wave13 = 274;
export const FRAME_wave14 = 275;
export const FRAME_wave15 = 276;
export const FRAME_wave16 = 277;
export const FRAME_wave17 = 278;
export const FRAME_wave18 = 279;
export const FRAME_wave19 = 280;
export const FRAME_wave20 = 281;
export const FRAME_wave21 = 282;
export const FRAME_bl_atk01 = 283;
export const FRAME_bl_atk02 = 284;
export const FRAME_bl_atk03 = 285;
export const FRAME_bl_atk04 = 286;
export const FRAME_bl_atk05 = 287;
export const FRAME_bl_atk06 = 288;
export const FRAME_bl_flp01 = 289;
export const FRAME_bl_flp02 = 290;
export const FRAME_bl_flp13 = 291;
export const FRAME_bl_flp14 = 292;
export const FRAME_bl_flp15 = 293;
export const FRAME_bl_jmp01 = 294;
export const FRAME_bl_jmp02 = 295;
export const FRAME_bl_jmp03 = 296;
export const FRAME_bl_jmp04 = 297;
export const FRAME_bl_jmp05 = 298;
export const FRAME_bl_jmp06 = 299;
export const FRAME_bl_pn101 = 300;
export const FRAME_bl_pn102 = 301;
export const FRAME_bl_pn103 = 302;
export const FRAME_bl_pn201 = 303;
export const FRAME_bl_pn202 = 304;
export const FRAME_bl_pn203 = 305;
export const FRAME_bl_pn301 = 306;
export const FRAME_bl_pn302 = 307;
export const FRAME_bl_pn303 = 308;
export const FRAME_bl_psh08 = 309;
export const FRAME_bl_psh09 = 310;
export const FRAME_bl_run01 = 311;
export const FRAME_bl_run02 = 312;
export const FRAME_bl_run03 = 313;
export const FRAME_bl_run04 = 314;
export const FRAME_bl_run05 = 315;
export const FRAME_bl_run06 = 316;
export const FRAME_bl_run07 = 317;
export const FRAME_bl_run08 = 318;
export const FRAME_bl_run09 = 319;
export const FRAME_bl_run10 = 320;
export const FRAME_bl_run11 = 321;
export const FRAME_bl_run12 = 322;
export const FRAME_bl_rns03 = 323;
export const FRAME_bl_rns04 = 324;
export const FRAME_bl_rns05 = 325;
export const FRAME_bl_rns06 = 326;
export const FRAME_bl_rns07 = 327;
export const FRAME_bl_rns08 = 328;
export const FRAME_bl_rns09 = 329;
export const FRAME_bl_sal10 = 330;
export const FRAME_bl_sal11 = 331;
export const FRAME_bl_sal12 = 332;
export const FRAME_bl_std01 = 333;
export const FRAME_bl_std02 = 334;
export const FRAME_bl_std03 = 335;
export const FRAME_bl_std04 = 336;
export const FRAME_bl_std05 = 337;
export const FRAME_bl_std06 = 338;
export const FRAME_bl_std07 = 339;
export const FRAME_bl_std08 = 340;
export const FRAME_bl_std09 = 341;
export const FRAME_bl_std10 = 342;
export const FRAME_bl_std11 = 343;
export const FRAME_bl_std12 = 344;
export const FRAME_bl_std13 = 345;
export const FRAME_bl_std14 = 346;
export const FRAME_bl_std15 = 347;
export const FRAME_bl_std16 = 348;
export const FRAME_bl_std17 = 349;
export const FRAME_bl_std18 = 350;
export const FRAME_bl_std19 = 351;
export const FRAME_bl_std20 = 352;
export const FRAME_bl_std21 = 353;
export const FRAME_bl_std22 = 354;
export const FRAME_bl_std23 = 355;
export const FRAME_bl_std24 = 356;
export const FRAME_bl_std25 = 357;
export const FRAME_bl_std26 = 358;
export const FRAME_bl_std27 = 359;
export const FRAME_bl_std28 = 360;
export const FRAME_bl_std29 = 361;
export const FRAME_bl_std30 = 362;
export const FRAME_bl_std31 = 363;
export const FRAME_bl_std32 = 364;
export const FRAME_bl_std33 = 365;
export const FRAME_bl_std34 = 366;
export const FRAME_bl_std35 = 367;
export const FRAME_bl_std36 = 368;
export const FRAME_bl_std37 = 369;
export const FRAME_bl_std38 = 370;
export const FRAME_bl_std39 = 371;
export const FRAME_bl_std40 = 372;
export const FRAME_bl_swm01 = 373;
export const FRAME_bl_swm02 = 374;
export const FRAME_bl_swm03 = 375;
export const FRAME_bl_swm04 = 376;
export const FRAME_bl_swm05 = 377;
export const FRAME_bl_swm06 = 378;
export const FRAME_bl_swm07 = 379;
export const FRAME_bl_swm08 = 380;
export const FRAME_bl_swm09 = 381;
export const FRAME_bl_swm10 = 382;
export const FRAME_bl_swm11 = 383;
export const FRAME_bl_swm12 = 384;
export const FRAME_bl_swk01 = 385;
export const FRAME_bl_swk02 = 386;
export const FRAME_bl_swk03 = 387;
export const FRAME_bl_swk04 = 388;
export const FRAME_bl_swk05 = 389;
export const FRAME_bl_swk06 = 390;
export const FRAME_bl_swp01 = 391;
export const FRAME_bl_swp02 = 392;
export const FRAME_bl_swp03 = 393;
export const FRAME_bl_swp04 = 394;
export const FRAME_bl_swp05 = 395;
export const FRAME_bl_sws01 = 396;
export const FRAME_bl_sws02 = 397;
export const FRAME_bl_sws03 = 398;
export const FRAME_bl_sws04 = 399;
export const FRAME_bl_sws05 = 400;
export const FRAME_bl_sws06 = 401;
export const FRAME_bl_sws07 = 402;
export const FRAME_bl_sws08 = 403;
export const FRAME_bl_sws09 = 404;
export const FRAME_bl_sws10 = 405;
export const FRAME_bl_sws11 = 406;
export const FRAME_bl_sws12 = 407;
export const FRAME_bl_sws13 = 408;
export const FRAME_bl_sws14 = 409;
export const FRAME_bl_tau14 = 410;
export const FRAME_bl_tau15 = 411;
export const FRAME_bl_tau16 = 412;
export const FRAME_bl_tau17 = 413;
export const FRAME_bl_wlk01 = 414;
export const FRAME_bl_wlk02 = 415;
export const FRAME_bl_wlk03 = 416;
export const FRAME_bl_wlk04 = 417;
export const FRAME_bl_wlk05 = 418;
export const FRAME_bl_wlk06 = 419;
export const FRAME_bl_wlk07 = 420;
export const FRAME_bl_wlk08 = 421;
export const FRAME_bl_wlk09 = 422;
export const FRAME_bl_wlk10 = 423;
export const FRAME_bl_wlk11 = 424;
export const FRAME_bl_wav19 = 425;
export const FRAME_bl_wav20 = 426;
export const FRAME_bl_wav21 = 427;
export const FRAME_cr_atk01 = 428;
export const FRAME_cr_atk02 = 429;
export const FRAME_cr_atk03 = 430;
export const FRAME_cr_atk04 = 431;
export const FRAME_cr_atk05 = 432;
export const FRAME_cr_atk06 = 433;
export const FRAME_cr_atk07 = 434;
export const FRAME_cr_atk08 = 435;
export const FRAME_cr_pan01 = 436;
export const FRAME_cr_pan02 = 437;
export const FRAME_cr_pan03 = 438;
export const FRAME_cr_pan04 = 439;
export const FRAME_cr_std01 = 440;
export const FRAME_cr_std02 = 441;
export const FRAME_cr_std03 = 442;
export const FRAME_cr_std04 = 443;
export const FRAME_cr_std05 = 444;
export const FRAME_cr_std06 = 445;
export const FRAME_cr_std07 = 446;
export const FRAME_cr_std08 = 447;
export const FRAME_cr_wlk01 = 448;
export const FRAME_cr_wlk02 = 449;
export const FRAME_cr_wlk03 = 450;
export const FRAME_cr_wlk04 = 451;
export const FRAME_cr_wlk05 = 452;
export const FRAME_cr_wlk06 = 453;
export const FRAME_cr_wlk07 = 454;
export const FRAME_crbl_a01 = 455;
export const FRAME_crbl_a02 = 456;
export const FRAME_crbl_a03 = 457;
export const FRAME_crbl_a04 = 458;
export const FRAME_crbl_a05 = 459;
export const FRAME_crbl_a06 = 460;
export const FRAME_crbl_a07 = 461;
export const FRAME_crbl_p01 = 462;
export const FRAME_crbl_p02 = 463;
export const FRAME_crbl_p03 = 464;
export const FRAME_crbl_p04 = 465;
export const FRAME_crbl_s01 = 466;
export const FRAME_crbl_s02 = 467;
export const FRAME_crbl_s03 = 468;
export const FRAME_crbl_s04 = 469;
export const FRAME_crbl_s05 = 470;
export const FRAME_crbl_s06 = 471;
export const FRAME_crbl_s07 = 472;
export const FRAME_crbl_s08 = 473;
export const FRAME_crbl_w01 = 474;
export const FRAME_crbl_w02 = 475;
export const FRAME_crbl_w03 = 476;
export const FRAME_crbl_w04 = 477;
export const FRAME_crbl_w05 = 478;
export const FRAME_crbl_w06 = 479;
export const FRAME_crbl_w07 = 480;

export const MODEL_SCALE = 1.0;

export const MAX_ACTOR_NAMES = 8;
export const MZ2_ACTOR_MACHINEGUN_1 = 63;
/**
 * Original name: N/A
 * Source: N/A (local gameplay sentinel)
 * Category: New
 * Purpose: Large pause duration used to mirror the original indefinite actor wait.
 */
const MONSTER_PAUSE_FOREVER = 100000000;

export const actor_names = [
  "Hellrot",
  "Tokay",
  "Killme",
  "Disruptor",
  "Adrianator",
  "Rambear",
  "Titus",
  "Bitterman"
] as const;

export const messages = [
  "Watch it",
  "#$@*&",
  "Idiot",
  "Check your targets"
] as const;

export const actor_frames_stand = makeFrames(ai_stand, new Array<number>(40).fill(0));
export const actor_move_stand: GameMonsterMove = {
  firstframe: FRAME_stand101,
  lastframe: FRAME_stand140,
  frame: actor_frames_stand,
  endfunc: undefined
};

export const actor_frames_walk = makeFrames(ai_walk, [0, 6, 10, 3, 2, 7, 10, 1, 4, 0, 0]);
export const actor_move_walk: GameMonsterMove = {
  firstframe: FRAME_walk01,
  lastframe: FRAME_walk08,
  frame: actor_frames_walk,
  endfunc: undefined
};

export const actor_frames_run = makeFrames(ai_run, [4, 15, 15, 8, 20, 15, 8, 17, 12, -2, -2, -1]);
export const actor_move_run: GameMonsterMove = {
  firstframe: FRAME_run02,
  lastframe: FRAME_run07,
  frame: actor_frames_run,
  endfunc: undefined
};

export const actor_frames_pain1 = makeFrames(ai_move, [-5, 4, 1]);
export const actor_move_pain1: GameMonsterMove = {
  firstframe: FRAME_pain101,
  lastframe: FRAME_pain103,
  frame: actor_frames_pain1,
  endfunc: actor_run
};

export const actor_frames_pain2 = makeFrames(ai_move, [-4, 4, 0]);
export const actor_move_pain2: GameMonsterMove = {
  firstframe: FRAME_pain201,
  lastframe: FRAME_pain203,
  frame: actor_frames_pain2,
  endfunc: actor_run
};

export const actor_frames_pain3 = makeFrames(ai_move, [-1, 1, 0]);
export const actor_move_pain3: GameMonsterMove = {
  firstframe: FRAME_pain301,
  lastframe: FRAME_pain303,
  frame: actor_frames_pain3,
  endfunc: actor_run
};

export const actor_frames_flipoff = makeFrames(ai_turn, new Array<number>(14).fill(0));
export const actor_move_flipoff: GameMonsterMove = {
  firstframe: FRAME_flip01,
  lastframe: FRAME_flip14,
  frame: actor_frames_flipoff,
  endfunc: actor_run
};

export const actor_frames_taunt = makeFrames(ai_turn, new Array<number>(17).fill(0));
export const actor_move_taunt: GameMonsterMove = {
  firstframe: FRAME_taunt01,
  lastframe: FRAME_taunt17,
  frame: actor_frames_taunt,
  endfunc: actor_run
};

export const actor_frames_death1 = makeFrames(ai_move, [0, 0, -13, 14, 3, -2, 1]);
export const actor_move_death1: GameMonsterMove = {
  firstframe: FRAME_death101,
  lastframe: FRAME_death107,
  frame: actor_frames_death1,
  endfunc: actor_dead
};

export const actor_frames_death2 = makeFrames(ai_move, [0, 7, -6, -5, 1, 0, -1, -2, -1, -9, -13, -13, 0]);
export const actor_move_death2: GameMonsterMove = {
  firstframe: FRAME_death201,
  lastframe: FRAME_death213,
  frame: actor_frames_death2,
  endfunc: actor_dead
};

export const actor_frames_attack = makeFrames(ai_charge, [-2, -2, 3, 2], [actor_fire]);
export const actor_move_attack: GameMonsterMove = {
  firstframe: FRAME_attak01,
  lastframe: FRAME_attak04,
  frame: actor_frames_attack,
  endfunc: actor_run
};

/**
 * Original name: actor_stand
 * Source: Quake-2-master/game/m_actor.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Enters the standing actor loop and randomizes the initial frame during map startup.
 */
export function actor_stand(self: GameEntity, runtime: GameRuntime): void {
  self.monsterinfo.currentmove = actor_move_stand;

  if (runtime.time < 1.0) {
    const span = actor_move_stand.lastframe - actor_move_stand.firstframe + 1;
    self.s.frame = actor_move_stand.firstframe + randomInt(span);
  }
}

/**
 * Original name: actor_walk
 * Source: Quake-2-master/game/m_actor.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Enters the scripted walking movement.
 */
export function actor_walk(self: GameEntity): void {
  self.monsterinfo.currentmove = actor_move_walk;
}

/**
 * Original name: actor_run
 * Source: Quake-2-master/game/m_actor.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Chooses stand, walk, or run according to pain debounce, target state and stand-ground flags.
 */
export function actor_run(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.time < self.pain_debounce_time && !self.enemy) {
    if (self.movetarget) {
      actor_walk(self);
    } else {
      actor_stand(self, runtime);
    }
    return;
  }

  if ((self.monsterinfo.aiflags & AI_STAND_GROUND) !== 0) {
    actor_stand(self, runtime);
    return;
  }

  self.monsterinfo.currentmove = actor_move_run;
}

/**
 * Original name: actor_pain
 * Source: Quake-2-master/game/m_actor.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies skin changes, pain debounce, player-directed taunts and pain animations.
 *
 * Porting notes:
 * - Uses the shared `g_local.random()` helper for the two original C `random()` macro branches.
 * - Keeps the local integer RNG helper for `rand() % 3` pain/chat selection.
 */
export function actor_pain(
  self: GameEntity,
  other: GameEntity | null,
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

  if (other?.client && random() < 0.4) {
    const v = subtractVec3(other.s.origin, self.s.origin);
    self.ideal_yaw = vectoyaw(v);
    self.monsterinfo.currentmove = random() < 0.5 ? actor_move_flipoff : actor_move_taunt;
    emitGameCprintf(runtime, other, PRINT_CHAT, `${actorNameForEntity(self)}: ${messages[randomInt(3)]}!\n`);
    return;
  }

  const n = randomInt(3);
  if (n === 0) {
    self.monsterinfo.currentmove = actor_move_pain1;
  } else if (n === 1) {
    self.monsterinfo.currentmove = actor_move_pain2;
  } else {
    self.monsterinfo.currentmove = actor_move_pain3;
  }
}

/**
 * Original name: actorMachineGun
 * Source: Quake-2-master/game/m_actor.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Computes the actor machinegun muzzle and fires one bullet toward the current enemy.
 */
export function actorMachineGun(self: GameEntity, runtime: GameRuntime): void {
  let { forward, right } = AngleVectors(self.s.angles);
  const start = G_ProjectSource(self.s.origin, getMonsterFlashOffset(MZ2_ACTOR_MACHINEGUN_1), forward, right);

  if (self.enemy) {
    let target: vec3_t;
    if (self.enemy.health > 0) {
      target = addVec3(self.enemy.s.origin, scaleVec3(self.enemy.velocity, -0.2));
      target[2] += self.enemy.viewheight;
    } else {
      target = [...self.enemy.absmin];
      target[2] += self.enemy.size[2] / 2;
    }
    forward = normalizeVec3(subtractVec3(target, start));
  } else {
    forward = AngleVectors(self.s.angles).forward;
  }

  monster_fire_bullet(
    self,
    start,
    forward,
    3,
    4,
    DEFAULT_BULLET_HSPREAD,
    DEFAULT_BULLET_VSPREAD,
    MZ2_ACTOR_MACHINEGUN_1,
    runtime
  );
}

/**
 * Original name: actor_dead
 * Source: Quake-2-master/game/m_actor.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Finalizes the corpse bbox, toss movement and dead-monster flag.
 */
export function actor_dead(self: GameEntity, runtime: GameRuntime): void {
  setVec3(self.mins, -16, -16, -24);
  setVec3(self.maxs, 16, 16, -8);
  self.movetype = MOVETYPE_TOSS;
  self.svflags |= SVF_DEADMONSTER;
  self.nextthink = 0;
  linkGameEntity(runtime, self);
}

/**
 * Original name: actor_die
 * Source: Quake-2-master/game/m_actor.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Handles gib death and ordinary death animation selection.
 */
export function actor_die(
  self: GameEntity,
  _inflictor: GameEntity | null,
  _attacker: GameEntity | null,
  damage: number,
  runtime: GameRuntime
): void {
  if (self.health <= -80) {
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
  self.monsterinfo.currentmove = randomInt(2) === 0 ? actor_move_death1 : actor_move_death2;
}

/**
 * Original name: actor_fire
 * Source: Quake-2-master/game/m_actor.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Fires the actor machinegun and holds the attack frame until pausetime expires.
 */
export function actor_fire(self: GameEntity, runtime: GameRuntime): void {
  actorMachineGun(self, runtime);

  if (runtime.time >= self.monsterinfo.pausetime) {
    self.monsterinfo.aiflags &= ~AI_HOLD_FRAME;
  } else {
    self.monsterinfo.aiflags |= AI_HOLD_FRAME;
  }
}

/**
 * Original name: actor_attack
 * Source: Quake-2-master/game/m_actor.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Enters the machinegun attack loop and randomizes its duration.
 *
 * Porting notes:
 * - Preserves the original `(rand() & 15) + 10` frame range through the local `Math.random`-backed RNG helper.
 */
export function actor_attack(self: GameEntity, runtime: GameRuntime): void {
  self.monsterinfo.currentmove = actor_move_attack;
  const n = (randomInt(0x1000000) & 15) + 3 + 7;
  self.monsterinfo.pausetime = runtime.time + n * FRAMETIME;
}

/**
 * Original name: actor_use
 * Source: Quake-2-master/game/m_actor.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Starts one dormant actor on its `target_actor` path.
 */
export function actor_use(self: GameEntity, _other: GameEntity | null, _activator: GameEntity | null, runtime: GameRuntime): void {
  self.goalentity = G_PickTarget(runtime, self.target);
  self.movetarget = self.goalentity;

  if (!self.movetarget || self.movetarget.classname !== "target_actor") {
    runtime.log({
      kind: "warning",
      message: `${self.classname} has bad target ${self.target ?? ""} at ${vtos(self.s.origin)}`,
      entityIndex: self.index,
      entityClassname: self.classname
    });
    self.target = undefined;
    self.monsterinfo.pausetime = MONSTER_PAUSE_FOREVER;
    self.monsterinfo.stand?.(self, runtime);
    return;
  }

  const goalentity = self.movetarget;
  const v = subtractVec3(goalentity.s.origin, self.s.origin);
  const yaw = vectoyaw(v);
  self.ideal_yaw = yaw;
  self.s.angles[YAW] = yaw;
  self.angles[YAW] = yaw;
  self.monsterinfo.walk?.(self, runtime);
  self.target = undefined;
}

/**
 * Original name: SP_misc_actor
 * Source: Quake-2-master/game/m_actor.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Spawns a dormant scripted misc_actor and initializes its movement callbacks.
 */
export function SP_misc_actor(self: GameEntity, runtime: GameRuntime): void {
  if (runtime.deathmatch) {
    G_FreeEdict(runtime, self);
    return;
  }

  if (!self.targetname) {
    runtime.log({
      kind: "warning",
      message: `untargeted ${self.classname} at ${vtos(self.s.origin)}`,
      entityIndex: self.index,
      entityClassname: self.classname
    });
    G_FreeEdict(runtime, self);
    return;
  }

  if (!self.target) {
    runtime.log({
      kind: "warning",
      message: `${self.classname} with no target at ${vtos(self.s.origin)}`,
      entityIndex: self.index,
      entityClassname: self.classname
    });
    G_FreeEdict(runtime, self);
    return;
  }

  self.movetype = MOVETYPE_STEP;
  self.solid = SOLID_BBOX;
  self.s.modelindex = registerGameModel(runtime, "players/male/tris.md2");
  setVec3(self.mins, -16, -16, -24);
  setVec3(self.maxs, 16, 16, 32);

  if (!self.health) {
    self.health = 100;
  }
  self.mass = 200;

  self.pain = actor_pain;
  self.die = actor_die;

  self.monsterinfo.stand = actor_stand;
  self.monsterinfo.walk = actor_walk;
  self.monsterinfo.run = actor_run;
  self.monsterinfo.attack = actor_attack;
  self.monsterinfo.melee = undefined;
  self.monsterinfo.sight = undefined;
  self.monsterinfo.aiflags |= AI_GOOD_GUY;

  linkGameEntity(runtime, self);

  self.monsterinfo.currentmove = actor_move_stand;
  self.monsterinfo.scale = MODEL_SCALE;

  walkmonster_start(self, runtime);

  self.use = actor_use;
}

/**
 * Original name: target_actor_touch
 * Source: Quake-2-master/game/m_actor.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Advances one actor path node, dispatching messages, jumps, attacks and pathtargets.
 */
export function target_actor_touch(
  self: GameEntity,
  other: GameEntity,
  runtime: GameRuntime,
  _plane: cplane_t | null = null,
  _surf: csurface_t | null = null
): void {
  if (other.movetarget !== self) {
    return;
  }

  if (other.enemy) {
    return;
  }

  other.goalentity = null;
  other.movetarget = null;

  if (self.message) {
    for (let n = 1; n <= runtime.maxclients; n += 1) {
      const ent = runtime.entities[n];
      if (!ent?.inuse) {
        continue;
      }
      emitGameCprintf(runtime, ent, PRINT_CHAT, `${actorNameForEntity(other)}: ${self.message}\n`);
    }
  }

  if ((self.spawnflags & 1) !== 0) {
    other.velocity[0] = self.movedir[0] * self.speed;
    other.velocity[1] = self.movedir[1] * self.speed;

    if (other.groundentity) {
      other.groundentity = null;
      other.velocity[2] = self.movedir[2];
      const soundIndex = registerGameSound(runtime, "player/male/jump1.wav");
      emitRegisteredGameSound(runtime, other, soundIndex, "player/male/jump1.wav", {
        channel: CHAN_VOICE,
        volume: 1,
        attenuation: ATTN_NORM,
        timeofs: 0
      });
    }
  }

  if ((self.spawnflags & 2) !== 0) {
    // The original SHOOT branch is intentionally empty.
  } else if ((self.spawnflags & 4) !== 0) {
    other.enemy = G_PickTarget(runtime, self.pathtarget);
    if (other.enemy) {
      other.goalentity = other.enemy;
      if ((self.spawnflags & 32) !== 0) {
        other.monsterinfo.aiflags |= AI_BRUTAL;
      }
      if ((self.spawnflags & 16) !== 0) {
        other.monsterinfo.aiflags |= AI_STAND_GROUND;
        actor_stand(other, runtime);
      } else {
        actor_run(other, runtime);
      }
    }
  }

  if ((self.spawnflags & 6) === 0 && self.pathtarget) {
    const savetarget = self.target;
    self.target = self.pathtarget;
    G_UseTargets(runtime, self, other);
    self.target = savetarget;
  }

  other.movetarget = G_PickTarget(runtime, self.target);

  if (!other.goalentity) {
    other.goalentity = other.movetarget;
  }

  if (!other.movetarget && !other.enemy) {
    other.monsterinfo.pausetime = runtime.time + MONSTER_PAUSE_FOREVER;
    other.monsterinfo.stand?.(other, runtime);
  } else if (other.movetarget === other.goalentity && other.movetarget) {
    const v = subtractVec3(other.movetarget.s.origin, other.s.origin);
    other.ideal_yaw = vectoyaw(v);
  }
}

/**
 * Original name: SP_target_actor
 * Source: Quake-2-master/game/m_actor.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Spawns one actor path trigger and configures jump movedir state when needed.
 */
export function SP_target_actor(self: GameEntity, runtime: GameRuntime): void {
  if (!self.targetname) {
    runtime.log({
      kind: "warning",
      message: `${self.classname} with no targetname at ${vtos(self.s.origin)}`,
      entityIndex: self.index,
      entityClassname: self.classname
    });
  }

  self.solid = SOLID_TRIGGER;
  self.touch = target_actor_touch;
  setVec3(self.mins, -8, -8, -8);
  setVec3(self.maxs, 8, 8, 8);
  self.svflags = SVF_NOCLIENT;

  if ((self.spawnflags & 1) !== 0) {
    if (!self.speed) {
      self.speed = 200;
    }

    const height = Number.parseFloat(self.properties.height ?? "");
    if (!Number.isFinite(height) || height === 0) {
      self.properties.height = "200";
    }

    if (self.s.angles[YAW] === 0) {
      self.s.angles[YAW] = 360;
      self.angles[YAW] = 360;
    }
    G_SetMovedir(self.s.angles, self.movedir);
    self.movedir[2] = Number.parseFloat(self.properties.height ?? "200");
  }

  linkGameEntity(runtime, self);
}

/**
 * Original name: N/A
 * Source: N/A (local monster frame builder)
 * Category: New
 * Purpose: Builds typed monster frame arrays from declarative C table data.
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
 * Purpose: Selects the actor chat display name using the original modulo rule.
 */
function actorNameForEntity(entity: GameEntity): string {
  return actor_names[entity.index % MAX_ACTOR_NAMES];
}

/**
 * Original name: N/A
 * Source: N/A (local RNG adapter)
 * Category: New
 * Purpose: Represents C `rand() % n`/bitmask integer branches in actor logic.
 */
function randomInt(max: number): number {
  return Math.trunc(Math.random() * max);
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Mutates a vec3 without depending on broad shared math ownership.
 */
function setVec3(vector: vec3_t, x: number, y: number, z: number): void {
  vector[0] = x;
  vector[1] = y;
  vector[2] = z;
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Local vec3 subtraction for actor aiming and path yaw calculations.
 */
function subtractVec3(left: vec3_t, right: vec3_t): vec3_t {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Local vec3 addition for actor muzzle/target calculations.
 */
function addVec3(left: vec3_t, right: vec3_t): vec3_t {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Local vec3 scaling for actor projectile targeting.
 */
function scaleVec3(vector: vec3_t, scale: number): vec3_t {
  return [vector[0] * scale, vector[1] * scale, vector[2] * scale];
}

/**
 * Original name: N/A
 * Source: N/A (local vector helper)
 * Category: New
 * Purpose: Local vec3 normalization for actor firing direction.
 */
function normalizeVec3(vector: vec3_t): vec3_t {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length === 0) {
    return [0, 0, 0];
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}
