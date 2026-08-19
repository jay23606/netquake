/**
 * File: screen.ts
 * Source: Quake II original / client/screen.h
 * Purpose: Expose the public Quake II client screen API declared by `client/screen.h`.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Reexports implementations from `cl_scrn.ts` because the original header declares that module's public API.
 * - Reexports screen state ownership from the client runtime instead of recreating process globals.
 *
 * Notes:
 * - This file is the principal TypeScript attachment point for `client/screen.h`.
 */

export {
  SCR_AddDirtyPoint,
  SCR_BeginLoadingPlaque,
  SCR_CenterPrint,
  SCR_DebugGraph,
  SCR_DirtyScreen,
  SCR_DrawCinematic,
  SCR_EndLoadingPlaque,
  SCR_FinishCinematic,
  SCR_Init,
  SCR_PlayCinematic,
  SCR_RunCinematic,
  SCR_RunConsole,
  SCR_SizeDown,
  SCR_SizeUp,
  SCR_StopCinematic,
  SCR_TouchPics,
  SCR_UpdateScreen
} from "./cl_scrn.js";

export {
  createClientScreenState
} from "./client.js";

export type {
  client_screen_state_t
} from "./client.js";
