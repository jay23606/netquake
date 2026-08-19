/**
 * File: m_flash.ts
 * Source: Quake II original / game/m_flash.c
 * Purpose: Port of monster muzzle-flash offsets shared by gameplay and client effects.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Exposes the original table as readonly TypeScript vectors.
 *
 * Notes:
 * - This file is the principal runtime attachment point for `game/m_flash.c`.
 */

import type { vec3_t } from "../../qcommon/src/index.js";

export const MZ2_CARRIER_MACHINEGUN_L1 = 138;
export const MZ2_CARRIER_MACHINEGUN_R1 = 139;
export const MZ2_CARRIER_GRENADE = 140;
export const MZ2_TURRET_MACHINEGUN = 141;
export const MZ2_TURRET_ROCKET = 142;
export const MZ2_TURRET_BLASTER = 143;
export const MZ2_STALKER_BLASTER = 144;
export const MZ2_DAEDALUS_BLASTER = 145;
export const MZ2_MEDIC_BLASTER_2 = 146;
export const MZ2_CARRIER_RAILGUN = 147;
export const MZ2_WIDOW_DISRUPTOR = 148;
export const MZ2_WIDOW_BLASTER = 149;
export const MZ2_WIDOW_RAIL = 150;
export const MZ2_WIDOW_PLASMABEAM = 151;
export const MZ2_CARRIER_MACHINEGUN_L2 = 152;
export const MZ2_CARRIER_MACHINEGUN_R2 = 153;
export const MZ2_WIDOW_RAIL_LEFT = 154;
export const MZ2_WIDOW_RAIL_RIGHT = 155;
export const MZ2_WIDOW_BLASTER_SWEEP1 = 156;
export const MZ2_WIDOW_BLASTER_SWEEP2 = 157;
export const MZ2_WIDOW_BLASTER_SWEEP3 = 158;
export const MZ2_WIDOW_BLASTER_SWEEP4 = 159;
export const MZ2_WIDOW_BLASTER_SWEEP5 = 160;
export const MZ2_WIDOW_BLASTER_SWEEP6 = 161;
export const MZ2_WIDOW_BLASTER_SWEEP7 = 162;
export const MZ2_WIDOW_BLASTER_SWEEP8 = 163;
export const MZ2_WIDOW_BLASTER_SWEEP9 = 164;
export const MZ2_WIDOW_BLASTER_100 = 165;
export const MZ2_WIDOW_BLASTER_90 = 166;
export const MZ2_WIDOW_BLASTER_80 = 167;
export const MZ2_WIDOW_BLASTER_70 = 168;
export const MZ2_WIDOW_BLASTER_60 = 169;
export const MZ2_WIDOW_BLASTER_50 = 170;
export const MZ2_WIDOW_BLASTER_40 = 171;
export const MZ2_WIDOW_BLASTER_30 = 172;
export const MZ2_WIDOW_BLASTER_20 = 173;
export const MZ2_WIDOW_BLASTER_10 = 174;
export const MZ2_WIDOW_BLASTER_0 = 175;
export const MZ2_WIDOW_BLASTER_10L = 176;
export const MZ2_WIDOW_BLASTER_20L = 177;
export const MZ2_WIDOW_BLASTER_30L = 178;
export const MZ2_WIDOW_BLASTER_40L = 179;
export const MZ2_WIDOW_BLASTER_50L = 180;
export const MZ2_WIDOW_BLASTER_60L = 181;
export const MZ2_WIDOW_BLASTER_70L = 182;
export const MZ2_WIDOW_RUN_1 = 183;
export const MZ2_WIDOW_RUN_2 = 184;
export const MZ2_WIDOW_RUN_3 = 185;
export const MZ2_WIDOW_RUN_4 = 186;
export const MZ2_WIDOW_RUN_5 = 187;
export const MZ2_WIDOW_RUN_6 = 188;
export const MZ2_WIDOW_RUN_7 = 189;
export const MZ2_WIDOW_RUN_8 = 190;
export const MZ2_CARRIER_ROCKET_1 = 191;
export const MZ2_CARRIER_ROCKET_2 = 192;
export const MZ2_CARRIER_ROCKET_3 = 193;
export const MZ2_CARRIER_ROCKET_4 = 194;
export const MZ2_WIDOW2_BEAMER_1 = 195;
export const MZ2_WIDOW2_BEAMER_2 = 196;
export const MZ2_WIDOW2_BEAMER_3 = 197;
export const MZ2_WIDOW2_BEAMER_4 = 198;
export const MZ2_WIDOW2_BEAMER_5 = 199;
export const MZ2_WIDOW2_BEAM_SWEEP_1 = 200;
export const MZ2_WIDOW2_BEAM_SWEEP_2 = 201;
export const MZ2_WIDOW2_BEAM_SWEEP_3 = 202;
export const MZ2_WIDOW2_BEAM_SWEEP_4 = 203;
export const MZ2_WIDOW2_BEAM_SWEEP_5 = 204;
export const MZ2_WIDOW2_BEAM_SWEEP_6 = 205;
export const MZ2_WIDOW2_BEAM_SWEEP_7 = 206;
export const MZ2_WIDOW2_BEAM_SWEEP_8 = 207;
export const MZ2_WIDOW2_BEAM_SWEEP_9 = 208;
export const MZ2_WIDOW2_BEAM_SWEEP_10 = 209;
export const MZ2_WIDOW2_BEAM_SWEEP_11 = 210;

/**
 * Original name: monster_flash_offset
 * Source: game/m_flash.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Stores the original muzzle offsets used by monsters and turrets for all `MZ2_*` flash ids.
 *
 * Porting notes:
 * - Keeps the original index contract where slot `0` is unused.
 */
export const monster_flash_offset: readonly vec3_t[] = [
  [0.0, 0.0, 0.0],
  [20.7, -18.5, 28.7],
  [16.6, -21.5, 30.1],
  [11.8, -23.9, 32.1],
  [22.9, -0.7, 25.3],
  [22.2, 6.2, 22.3],
  [19.4, 13.1, 18.6],
  [19.4, 18.8, 18.6],
  [17.9, 25.0, 18.6],
  [14.1, 30.5, 20.6],
  [9.3, 35.3, 22.1],
  [4.7, 38.4, 22.1],
  [-1.1, 40.4, 24.1],
  [-6.5, 41.2, 24.1],
  [3.2, 40.1, 24.7],
  [11.7, 36.7, 26.0],
  [18.9, 31.3, 26.0],
  [24.4, 24.4, 26.4],
  [27.1, 17.1, 27.2],
  [28.5, 9.1, 28.0],
  [27.1, 2.2, 28.0],
  [24.9, -2.8, 28.0],
  [21.6, -7.0, 26.4],
  [6.2, 29.1, 49.1],
  [6.9, 23.8, 49.1],
  [8.3, 17.8, 49.5],
  [26.6, 7.1, 13.1],
  [18.2, 7.5, 15.4],
  [17.2, 10.3, 17.9],
  [17.0, 12.8, 20.1],
  [15.1, 14.1, 21.8],
  [11.8, 17.2, 23.1],
  [11.4, 20.2, 21.0],
  [9.0, 23.0, 18.9],
  [13.9, 18.6, 17.7],
  [15.4, 15.6, 15.8],
  [10.2, 15.2, 25.1],
  [-1.9, 15.1, 28.2],
  [-12.4, 13.0, 20.2],
  [10.6 * 1.2, 7.7 * 1.2, 7.8 * 1.2],
  [21.1 * 1.2, 3.6 * 1.2, 19.0 * 1.2],
  [10.6 * 1.2, 7.7 * 1.2, 7.8 * 1.2],
  [21.1 * 1.2, 3.6 * 1.2, 19.0 * 1.2],
  [10.6 * 1.2, 7.7 * 1.2, 7.8 * 1.2],
  [21.1 * 1.2, 3.6 * 1.2, 19.0 * 1.2],
  [30.1 * 1.15, 3.9 * 1.15, 19.6 * 1.15],
  [29.1 * 1.15, 2.5 * 1.15, 20.7 * 1.15],
  [28.2 * 1.15, 2.5 * 1.15, 22.2 * 1.15],
  [28.2 * 1.15, 3.6 * 1.15, 22.0 * 1.15],
  [26.9 * 1.15, 2.0 * 1.15, 23.4 * 1.15],
  [26.5 * 1.15, 0.6 * 1.15, 20.8 * 1.15],
  [26.9 * 1.15, 0.5 * 1.15, 21.5 * 1.15],
  [29.0 * 1.15, 2.4 * 1.15, 19.5 * 1.15],
  [4.6 * 1.15, -16.8 * 1.15, 7.3 * 1.15],
  [4.6 * 1.15, -16.8 * 1.15, 7.3 * 1.15],
  [4.6 * 1.15, -16.8 * 1.15, 7.3 * 1.15],
  [4.6 * 1.15, -16.8 * 1.15, 7.3 * 1.15],
  [24.8, -9.0, 39.0],
  [12.1, 13.4, -14.5],
  [12.1, -7.4, -14.5],
  [12.1, 5.4, 16.5],
  [30.0, 18.0, 28.0],
  [32.5, -0.8, 10.0],
  [18.4, 7.4, 9.6],
  [30.0, 30.0, 88.5],
  [30.0, 30.0, 88.5],
  [30.0, 30.0, 88.5],
  [30.0, 30.0, 88.5],
  [30.0, 30.0, 88.5],
  [30.0, 30.0, 88.5],
  [16.0, -22.5, 91.2],
  [16.0, -33.4, 86.7],
  [16.0, -42.8, 83.3],
  [32, -40, 70],
  [32, -40, 70],
  [32, -40, 70],
  [32, -40, 70],
  [32, -40, 70],
  [22.0, 16.0, 10.0],
  [22.0, 8.0, 10.0],
  [22.0, -8.0, 10.0],
  [22.0, -16.0, 10.0],
  [32.5, -0.8, 10],
  [20.8 * 1.2, 10.1 * 1.2, -2.7 * 1.2],
  [20.8 * 1.2, 10.1 * 1.2, -2.7 * 1.2],
  [20.8 * 1.2, 10.1 * 1.2, -2.7 * 1.2],
  [7.6 * 1.2, 9.3 * 1.2, 0.8 * 1.2],
  [7.6 * 1.2, 9.3 * 1.2, 0.8 * 1.2],
  [7.6 * 1.2, 9.3 * 1.2, 0.8 * 1.2],
  [30.5 * 1.2, 9.9 * 1.2, -18.7 * 1.2],
  [30.5 * 1.2, 9.9 * 1.2, -18.7 * 1.2],
  [30.5 * 1.2, 9.9 * 1.2, -18.7 * 1.2],
  [27.6 * 1.2, 3.4 * 1.2, -10.4 * 1.2],
  [27.6 * 1.2, 3.4 * 1.2, -10.4 * 1.2],
  [27.6 * 1.2, 3.4 * 1.2, -10.4 * 1.2],
  [28.9 * 1.2, 4.6 * 1.2, -8.1 * 1.2],
  [28.9 * 1.2, 4.6 * 1.2, -8.1 * 1.2],
  [28.9 * 1.2, 4.6 * 1.2, -8.1 * 1.2],
  [31.5 * 1.2, 9.6 * 1.2, 10.1 * 1.2],
  [34.5 * 1.2, 9.6 * 1.2, 6.1 * 1.2],
  [34.5 * 1.2, 9.6 * 1.2, 6.1 * 1.2],
  [17, -19.5, 62.9],
  [-3.6, -24.1, 59.5],
  [-1.6, -19.3, 59.5],
  [-0.1, -14.4, 59.5],
  [2.0, -7.6, 59.5],
  [3.4, 1.3, 59.5],
  [3.7, 11.1, 59.5],
  [-0.3, 22.3, 59.5],
  [-6, 33, 59.5],
  [-9.3, 36.4, 59.5],
  [-7, 35, 59.5],
  [-2.1, 29, 59.5],
  [3.9, 17.3, 59.5],
  [6.1, 5.8, 59.5],
  [5.9, -4.4, 59.5],
  [4.2, -14.1, 59.5],
  [2.4, -18.8, 59.5],
  [-1.8, -25.5, 59.5],
  [-17.3, 7.8, 72.4],
  [78.5, -47.1, 96],
  [78.5, -47.1, 96],
  [78.5, -47.1, 96],
  [78.5, -47.1, 96],
  [78.5, -47.1, 96],
  [78.5, -47.1, 96],
  [78.5, 46.7, 96],
  [78.5, 46.7, 96],
  [78.5, 46.7, 96],
  [78.5, 46.7, 96],
  [78.5, 46.7, 96],
  [78.5, 46.7, 96],
  [6.3, -9, 111.2],
  [32, 40, 70],
  [32, 40, 70],
  [32, 40, 70],
  [32, 40, 70],
  [32, 40, 70],
  [56, -32, 32],
  [56, 32, 32],
  [42, 24, 50],
  [16, 0, 0],
  [16, 0, 0],
  [16, 0, 0],
  [24, 0, 6],
  [32.5, -0.8, 10.0],
  [12.1, 5.4, 16.5],
  [32, 0, 6],
  [57.72, 14.50, 88.81],
  [56, 32, 32],
  [62, -20, 84],
  [32, 0, 6],
  [61, -32, 12],
  [61, 32, 12],
  [17, -62, 91],
  [68, 12, 86],
  [47.5, 56, 89],
  [54, 52, 91],
  [58, 40, 91],
  [68, 30, 88],
  [74, 20, 88],
  [73, 11, 87],
  [73, 3, 87],
  [70, -12, 87],
  [67, -20, 90],
  [-20, 76, 90],
  [-8, 74, 90],
  [0, 72, 90],
  [10, 71, 89],
  [23, 70, 87],
  [32, 64, 85],
  [40, 58, 84],
  [48, 50, 83],
  [54, 42, 82],
  [56, 34, 82],
  [58, 26, 82],
  [60, 16, 82],
  [59, 6, 81],
  [58, -2, 80],
  [57, -10, 79],
  [54, -18, 78],
  [42, -32, 80],
  [36, -40, 78],
  [68.4, 10.88, 82.08],
  [68.51, 8.64, 85.14],
  [68.66, 6.38, 88.78],
  [68.73, 5.1, 84.47],
  [68.82, 4.79, 80.52],
  [68.77, 6.11, 85.37],
  [68.67, 7.99, 90.24],
  [68.55, 9.54, 87.36],
  [0, 0, -5],
  [0, 0, -5],
  [0, 0, -5],
  [0, 0, -5],
  [69.00, -17.63, 93.77],
  [69.00, -17.08, 89.82],
  [69.00, -18.40, 90.70],
  [69.00, -18.34, 94.32],
  [69.00, -18.30, 97.98],
  [45.04, -59.02, 92.24],
  [50.68, -54.70, 91.96],
  [56.57, -47.72, 91.65],
  [61.75, -38.75, 91.38],
  [65.55, -28.76, 91.24],
  [67.79, -18.90, 91.22],
  [68.60, -9.52, 91.23],
  [68.08, 0.18, 91.32],
  [66.14, 9.79, 91.44],
  [62.77, 18.91, 91.65],
  [58.29, 27.11, 92.00],
  [0.0, 0.0, 0.0]
];

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the exact monster flash offset vector for one `MZ2_*` id.
 *
 * Porting notes:
 * - Falls back to the unused zero slot when the id is outside the original table.
 */
export function getMonsterFlashOffset(flashNumber: number): vec3_t {
  const offset = monster_flash_offset[flashNumber] ?? monster_flash_offset[0];
  return [offset[0], offset[1], offset[2]];
}
