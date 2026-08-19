/**
 * File: monster-flash.ts
 * Purpose: Client-facing re-export of the gameplay `game/m_flash.c` port.
 *
 * This file is not a direct source port.
 * It keeps existing client imports stable while the principal source attachment
 * lives in `packages/game/src/m_flash.ts`.
 */

export { getMonsterFlashOffset, monster_flash_offset } from "../../game/src/m_flash.js";
