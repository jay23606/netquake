/**
 * File: cl_scrn.ts
 * Source: Quake II original / client/cl_scrn.c
 * Purpose: Port the first client-side screen and HUD state logic, starting with center prints and screen-facing HUD snapshots.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Emits structured screen state instead of issuing immediate renderer draw calls.
 * - Keeps only the first logical HUD/state layer while later renderer/UI adapters remain separate.
 *
 * Notes:
 * - This file is intended to stay conceptually close to the original screen-management logic.
 */

import {
  Cmd_AddCommand,
  Cmd_Argc,
  Cmd_Argv,
  CS_ITEMS,
  CS_IMAGES,
  CS_STATUSBAR,
  CVAR_ARCHIVE,
  Cvar_Get,
  Cvar_SetValue,
  MAX_CONFIGSTRINGS,
  MAX_IMAGES,
  STAT_AMMO,
  STAT_AMMO_ICON,
  STAT_ARMOR,
  STAT_ARMOR_ICON,
  STAT_FLASHES,
  STAT_FRAGS,
  STAT_HEALTH,
  STAT_HEALTH_ICON,
  STAT_LAYOUTS,
  STAT_PICKUP_ICON,
  STAT_PICKUP_STRING,
  STAT_SELECTED_ICON,
  STAT_SELECTED_ITEM,
  STAT_SPECTATOR,
  STAT_TIMER,
  STAT_TIMER_ICON,
  type CommandRuntime,
  type CvarRuntime,
  type cvar_t
} from "../../qcommon/src/index.js";
import type {
  HudBounds,
  HudDrawCommand,
  HudFillCommand,
  HudNumberCommand,
  HudPictureCommand,
  HudTextCommand
} from "./render-contracts.js";
import {
  SCR_DrawCinematic as SCR_DrawCinematic_Impl,
  SCR_DrawCinematicRef as SCR_DrawCinematicRef_Impl,
  SCR_FinishCinematic as SCR_FinishCinematic_Impl,
  SCR_PlayCinematic as SCR_PlayCinematic_Impl,
  SCR_RunCinematic as SCR_RunCinematic_Impl,
  SCR_StopCinematic as SCR_StopCinematic_Impl,
  type ClientCinematicSnapshot,
  type ClientScreenHooks
} from "./cl_cin.js";
import {
  CL_DrawInventory,
  CL_DrawInventoryRef,
  Inv_DrawString,
  Inv_DrawStringRef,
  SetStringHighBit,
  type ClientInventoryBindingMap
} from "./cl_inv.js";
import type { refexport_t } from "./ref.js";
import { createRefDef, type refdef_t } from "./ref.js";
import { connstate_t, type ClientRuntime } from "./client.js";

export type {
  ClientCinematicSnapshot,
  ClientScreenHooks
} from "./cl_cin.js";
export {
  CL_DrawInventory,
  CL_DrawInventoryRef,
  Inv_DrawString,
  Inv_DrawStringRef,
  SetStringHighBit
} from "./cl_inv.js";
export type {
  ClientInventoryBindingMap
} from "./cl_inv.js";

/**
 * Original name: STAT_MINUS
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Strict
 */
const STAT_MINUS = 10;

/**
 * Original name: CHAR_WIDTH
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Strict
 */
const CHAR_WIDTH = 16;

/**
 * Original name: sb_nums
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Strict
 */
const sb_nums = [
  ["num_0", "num_1", "num_2", "num_3", "num_4", "num_5", "num_6", "num_7", "num_8", "num_9", "num_minus"],
  ["anum_0", "anum_1", "anum_2", "anum_3", "anum_4", "anum_5", "anum_6", "anum_7", "anum_8", "anum_9", "anum_minus"]
] as const;

/**
 * Original name: N/A
 * Source: N/A (renderer-neutral screen DTO)
 * Category: New
 * Purpose: Describe one 2D HUD draw rectangle in pixel coordinates.
 *
 * Constraints:
 * - Must preserve Quake II pixel-space placement semantics.
 */
export type ClientHudBounds = HudBounds;

/**
 * Original name: N/A
 * Source: N/A (renderer-neutral screen DTO)
 * Category: New
 * Purpose: Describe one image draw request emitted by the ported HUD logic.
 *
 * Constraints:
 * - Must carry the Quake II pic name unchanged.
 */
export type ClientHudPictureCommand = HudPictureCommand;

/**
 * Original name: N/A
 * Source: N/A (renderer-neutral screen DTO)
 * Category: New
 * Purpose: Describe one text draw request emitted by the ported HUD logic.
 *
 * Constraints:
 * - Must preserve the original string payload and XOR/high-bit behavior.
 */
export type ClientHudTextCommand = HudTextCommand;

/**
 * Original name: N/A
 * Source: N/A (renderer-neutral screen DTO)
 * Category: New
 * Purpose: Describe one number-field draw request emitted by `SCR_DrawField`.
 *
 * Constraints:
 * - Must preserve width clamp, color bank and digit pic mapping.
 */
export type ClientHudNumberCommand = HudNumberCommand;

/**
 * Original name: N/A
 * Source: N/A (renderer-neutral screen DTO)
 * Category: New
 * Purpose: Reserve one fill-style HUD draw request for later layout tokens and debug overlays.
 *
 * Constraints:
 * - Must stay backend-agnostic.
 */
export type ClientHudFillCommand = HudFillCommand;

/**
 * Original name: N/A
 * Source: N/A (renderer-neutral screen DTO)
 * Category: New
 * Purpose: Union the current HUD draw primitives produced by the screen port.
 */
export type ClientHudDrawCommand = HudDrawCommand | ClientTileClearCommand;

/**
 * Original name: N/A
 * Source: N/A (renderer-neutral screen DTO)
 * Category: New
 * Fidelity level: Close
 *
 * Behavior:
 * - Describes one tiled `backtile` clear rectangle emitted outside the active 3D view.
 *
 * Porting notes:
 * - Kept as a command for snapshot consumers and mirrored by `SCR_TileClearRef` for `refexport_t`.
 */
export interface ClientTileClearCommand {
  type: "tileClear";
  x: number;
  y: number;
  width: number;
  height: number;
  pic: string;
  bounds: ClientHudBounds;
}

/**
 * Original name: N/A
 * Source: N/A (renderer-neutral screen DTO)
 * Category: New
 * Fidelity level: Close
 *
 * Behavior:
 * - Captures the console branch selected by screen state before the console module performs drawing.
 *
 * Porting notes:
 * - `Con_DrawConsole`, `Con_DrawNotify` and `Con_CheckResize` stay owned by `console.c`; this function owns the `cl_scrn.c` orchestration.
 */
export interface ClientScreenConsolePlan {
  mode: "full" | "half" | "scroll" | "notify" | "none";
  frac: number;
  fill: ClientHudFillCommand | null;
  drawNotify: boolean;
}

/**
 * Original name: N/A
 * Source: N/A (renderer-neutral screen DTO)
 * Category: New
 * Purpose: Describe the pixel footprint of one HUD string using Quake II sizing rules.
 *
 * Constraints:
 * - Must preserve embedded newline handling.
 */
export interface ClientHudStringMeasure {
  width: number;
  height: number;
  lines: number;
}

/**
 * Original name: N/A
 * Source: N/A (renderer-neutral screen DTO)
 * Category: New
 * Purpose: Carry the screen dimensions and runtime gating needed to interpret Quake II HUD layout strings.
 *
 * Constraints:
 * - Must stay explicit so layout execution remains deterministic and testable.
 */
export interface ClientHudLayoutContext {
  viewportWidth: number;
  viewportHeight: number;
  active: boolean;
  refreshPrepped: boolean;
}

/**
 * Original name: N/A
 * Source: N/A (renderer-neutral screen DTO)
 * Category: New
 * Purpose: Describe the active center-print text block tracked by the client screen layer.
 *
 * Constraints:
 * - Must preserve the original text and remaining display time.
 */
export interface ClientCenterPrintState {
  text: string;
  lines: number;
  remainingMs: number;
  startedAt: number;
}

/**
 * Original name: N/A
 * Source: N/A (renderer-neutral screen DTO)
 * Category: New
 * Purpose: Describe the loading-plaque state exposed by the client screen layer.
 *
 * Constraints:
 * - Must keep the original draw flag and disable-screen relationship explicit.
 */
export interface ClientLoadingOverlayState {
  visible: boolean;
  drawFlag: number;
  disableScreen: boolean;
}

/**
 * Original name: N/A
 * Source: N/A (screen entrypoint options)
 * Category: New
 * Purpose: Carry host state and callbacks needed by the ported loading-plaque entrypoint.
 *
 * Constraints:
 * - Must keep `SCR_BeginLoadingPlaque` ownership in `cl_scrn.c` while external systems own keys, audio and frame flushing.
 */
export interface ClientLoadingPlaqueOptions {
  developer?: boolean;
  keyDest?: "game" | "console" | "message" | "menu";
  onStopAllSounds?: () => void;
  onCDAudioStop?: () => void;
  onUpdateScreen?: () => void;
}

/**
 * Original name: N/A
 * Source: N/A (renderer-neutral screen DTO)
 * Category: New
 * Purpose: Describe the pause-overlay state exposed by the client screen layer.
 *
 * Constraints:
 * - Must remain data-only and not depend on any renderer API.
 */
export interface ClientPauseOverlayState {
  visible: boolean;
}

/**
 * Original name: N/A
 * Source: N/A (renderer-neutral screen DTO)
 * Category: New
 * Purpose: Describe the network warning overlay state used by `SCR_DrawNet`.
 *
 * Constraints:
 * - Must preserve the original backlog threshold rule when sequencing data is available.
 */
export interface ClientNetOverlayState {
  visible: boolean;
  backlog: number;
  threshold: number;
}

/**
 * Original name: N/A
 * Source: N/A (screen snapshot build options)
 * Category: New
 * Purpose: Carry host/runtime inputs needed to build the full screen snapshot without coupling `screen.ts` to unrelated subsystems.
 *
 * Constraints:
 * - Must stay optional so partial client stages can still build a deterministic HUD snapshot.
 */
export interface ClientScreenBuildOptions {
  paused?: boolean;
  outgoingSequence?: number;
  incomingAcknowledged?: number;
  commandBackup?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  keyDest?: "game" | "console" | "message" | "menu";
  disableScreenMs?: number;
  currentTimeMs?: number;
  consoleInitialized?: boolean;
  cl_stereo?: number;
  cl_stereo_separation?: number;
  ref?: refexport_t;
  renderFrame?: (cameraSeparation: number) => refdef_t;
}

/**
 * Original name: vrect_t
 * Source: client/vid.h and client/screen.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Stores the screen-space rectangle used by the Quake II refresh view.
 *
 * Porting notes:
 * - The C tag is `vrect_s`; TypeScript exposes the public typedef name `vrect_t` and `vid.ts` reexports it.
 */
export interface vrect_t {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Original name: N/A
 * Source: N/A (screen runtime context)
 * Category: New
 * Purpose: Group the client runtime with the command and cvar runtimes needed by the `cl_scrn.c` header-visible paths.
 *
 * Constraints:
 * - Must keep screen-related cvar references explicit.
 */
export interface ClientScreenContext {
  client: ClientRuntime;
  cmd: CommandRuntime;
  cvar: CvarRuntime;
  scr_viewsize: cvar_t | null;
  scr_conspeed: cvar_t | null;
  scr_showturtle: cvar_t | null;
  scr_showpause: cvar_t | null;
  scr_centertime: cvar_t | null;
  scr_printspeed: cvar_t | null;
  scr_netgraph: cvar_t | null;
  scr_drawall: cvar_t | null;
  scr_timegraph: cvar_t | null;
  scr_debuggraph: cvar_t | null;
  scr_graphheight: cvar_t | null;
  scr_graphscale: cvar_t | null;
  scr_graphshift: cvar_t | null;
  crosshair: cvar_t | null;
}

/**
 * Original name: N/A
 * Source: N/A (renderer-neutral screen DTO)
 * Category: New
 * Purpose: Describe the output of the current partial `SCR_UpdateScreen` port without binding it to one renderer backend.
 *
 * Constraints:
 * - Must keep the refresh rectangle and ordered HUD commands explicit.
 */
export interface ClientScreenFrame {
  vrect: vrect_t;
  commands: ClientHudDrawCommand[];
  screenState: ClientScreenHudState;
  cinematic: ClientCinematicSnapshot | null;
}
/**
 * Original name: N/A
 * Source: N/A (renderer-neutral screen DTO)
 * Category: New
 * Purpose: Describe the first HUD-facing snapshot extracted from client screen state.
 *
 * Constraints:
 * - Must keep raw layout and player-state-derived HUD values explicit for later UI adapters.
 */
export interface ClientScreenHudState {
  layout: string;
  layoutBits: number;
  statusbar: string;
  inventory: number[];
  stats: number[];
  centerPrint: ClientCenterPrintState | null;
  loading: ClientLoadingOverlayState;
  pause: ClientPauseOverlayState;
  net: ClientNetOverlayState;
  showScores: boolean;
  showInventory: boolean;
  health: number;
  healthIcon: string | null;
  ammo: number;
  ammoIcon: string | null;
  armor: number;
  armorIcon: string | null;
  selectedItem: number;
  selectedItemName: string | null;
  selectedIcon: string | null;
  pickupString: string | null;
  pickupIcon: string | null;
  timer: number;
  timerIcon: string | null;
  frags: number;
  flashes: number;
  spectator: boolean;
}

/**
 * Original name: N/A
 * Source: N/A (screen runtime context factory)
 * Category: New
 * Purpose: Create the composite context used by the current `screen.h` / `cl_scrn.c` port stage.
 *
 * Constraints:
 * - Must start with unresolved screen cvars before `SCR_Init`.
 */
export function createClientScreenContext(client: ClientRuntime, cmd: CommandRuntime, cvar: CvarRuntime): ClientScreenContext {
  return {
    client,
    cmd,
    cvar,
    scr_viewsize: null,
    scr_conspeed: null,
    scr_showturtle: null,
    scr_showpause: null,
    scr_centertime: null,
    scr_printspeed: null,
    scr_netgraph: null,
    scr_drawall: null,
    scr_timegraph: null,
    scr_debuggraph: null,
    scr_graphheight: null,
    scr_graphscale: null,
    scr_graphshift: null,
    crosshair: null
  };
}

/**
 * Original name: SizeHUDString
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Measures one HUD string while honoring embedded newlines.
 */
export function SizeHUDString(text: string): ClientHudStringMeasure {
  let lines = 1;
  let width = 0;
  let current = 0;

  for (const char of text) {
    if (char === "\n") {
      lines += 1;
      current = 0;
      continue;
    }

    current += 1;
    if (current > width) {
      width = current;
    }
  }

  return {
    width: width * 8,
    height: lines * 8,
    lines
  };
}

/**
 * Original name: DrawHUDString
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Expands one HUD string into line-oriented text draw commands with optional centering and XOR masking.
 *
 * Porting notes:
 * - Emits data commands instead of drawing characters immediately.
 */
export function DrawHUDString(text: string, x: number, y: number, centerWidth: number, xorMask: number): ClientHudTextCommand[] {
  const commands: ClientHudTextCommand[] = [];
  const margin = x;
  const lines = text.split("\n");
  let currentY = y;

  for (const line of lines) {
    const drawX = centerWidth !== 0 ? margin + (centerWidth - line.length * 8) / 2 : margin;
    commands.push({
      type: "text",
      x: drawX,
      y: currentY,
      text: applyHudXor(line, xorMask),
      xorMask,
      centerWidth,
      variant: xorMask === 0 ? "normal" : "alt",
      bounds: {
        x: drawX,
        y: currentY,
        width: line.length * 8,
        height: 8
      }
    });
    currentY += 8;
  }

  return commands;
}

/**
 * Original name: DrawHUDString
 * Source: client/cl_scrn.c
 * Category: Adapter
 * Fidelity level: Adapter
 *
 * Behavior:
 * - Draws one HUD string through the renderer export table with Quake-style centering and XOR masking.
 */
export function DrawHUDStringRef(ref: refexport_t, text: string, x: number, y: number, centerWidth: number, xorMask: number): void {
  const margin = x;
  const lines = text.split("\n");
  let currentY = y;

  for (const line of lines) {
    const drawX = centerWidth !== 0 ? margin + (centerWidth - line.length * 8) / 2 : margin;
    const output = applyHudXor(line, xorMask);
    for (let index = 0; index < output.length; index += 1) {
      ref.DrawChar(drawX + index * 8, currentY, output.charCodeAt(index) & 0xff);
    }
    currentY += 8;
  }
}

/**
 * Original name: SCR_DrawField
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Builds the digit picture sequence used by Quake II number fields.
 *
 * Porting notes:
 * - Returns a structured number command instead of issuing `DrawPic` calls.
 */
export function SCR_DrawField(x: number, y: number, color: number, width: number, value: number): ClientHudNumberCommand | null {
  if (width < 1) {
    return null;
  }

  const clampedWidth = Math.min(width, 5);
  const numText = `${Math.trunc(value)}`;
  const visibleLength = Math.min(numText.length, clampedWidth);
  const visibleText = visibleLength < numText.length ? numText.slice(0, visibleLength) : numText;
  const digits = Array.from(visibleText, mapHudDigitToPic(color));

  return {
    type: "number",
    x: x + 2 + CHAR_WIDTH * (clampedWidth - visibleLength),
    y,
    color,
    width: clampedWidth,
    value: Math.trunc(value),
    digits,
    bounds: {
      x,
      y,
      width: clampedWidth * CHAR_WIDTH + 2,
      height: 23
    }
  };
}

/**
 * Original name: SCR_DrawField
 * Source: client/cl_scrn.c
 * Category: Adapter
 * Fidelity level: Adapter
 *
 * Behavior:
 * - Draws the Quake II number field digit pictures through `refexport_t`.
 */
export function SCR_DrawFieldRef(ref: refexport_t, x: number, y: number, color: number, width: number, value: number): void {
  if (width < 1) {
    return;
  }

  const clampedWidth = Math.min(width, 5);
  const numText = `${Math.trunc(value)}`;
  const visibleLength = Math.min(numText.length, clampedWidth);
  const visibleText = visibleLength < numText.length ? numText.slice(0, visibleLength) : numText;
  const drawX = x + 2 + CHAR_WIDTH * (clampedWidth - visibleLength);
  const mapDigit = mapHudDigitToPic(color);

  for (let index = 0; index < visibleText.length; index += 1) {
    ref.DrawPic(drawX + index * CHAR_WIDTH, y, mapDigit(visibleText[index]));
  }
}

/**
 * Original name: SCR_TouchPics
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Enumerates the HUD pictures that the original renderer pre-registers for status bar drawing.
 *
 * Porting notes:
 * - Current stage focuses on status bar digits and optional crosshair pic naming.
 */
export function SCR_TouchPics(
  crosshairValue = 0,
  options: {
    runtime?: ClientRuntime;
    getPicSize?: (pic: string) => { width: number; height: number };
  } = {}
): string[] {
  const pics = new Set<string>();

  for (const bank of sb_nums) {
    for (const pic of bank) {
      pics.add(pic);
    }
  }

  if (crosshairValue !== 0) {
    const rawCrosshair = Math.trunc(crosshairValue);
    const clampedCrosshair = rawCrosshair > 3 || rawCrosshair < 0 ? 3 : rawCrosshair;
    const crosshairPic = `ch${clampedCrosshair}`;
    pics.add(crosshairPic);

    if (options.runtime) {
      const size = options.getPicSize?.(crosshairPic) ?? { width: 0, height: 0 };
      options.runtime.cl.screen.crosshair_pic = size.width === 0 ? "" : crosshairPic;
      options.runtime.cl.screen.crosshair_width = size.width;
      options.runtime.cl.screen.crosshair_height = size.height;
    }
  } else if (options.runtime) {
    options.runtime.cl.screen.crosshair_pic = "";
    options.runtime.cl.screen.crosshair_width = 0;
    options.runtime.cl.screen.crosshair_height = 0;
  }

  return [...pics];
}

/**
 * Original name: SCR_Init
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Registers the screen-facing cvars and console commands needed by the current screen port.
 *
 * Porting notes:
 * - Limits command bindings to the header-visible subset already ported in this module.
 */
export function SCR_Init(context: ClientScreenContext): void {
  context.scr_viewsize = Cvar_Get(context.cvar, "viewsize", "100", CVAR_ARCHIVE);
  context.scr_conspeed = Cvar_Get(context.cvar, "scr_conspeed", "3", 0);
  context.scr_showturtle = Cvar_Get(context.cvar, "scr_showturtle", "0", 0);
  context.scr_showpause = Cvar_Get(context.cvar, "scr_showpause", "1", 0);
  context.scr_centertime = Cvar_Get(context.cvar, "scr_centertime", "2.5", 0);
  context.scr_printspeed = Cvar_Get(context.cvar, "scr_printspeed", "8", 0);
  context.scr_netgraph = Cvar_Get(context.cvar, "netgraph", "0", 0);
  context.scr_drawall = Cvar_Get(context.cvar, "scr_drawall", "0", 0);
  context.scr_timegraph = Cvar_Get(context.cvar, "timegraph", "0", 0);
  context.scr_debuggraph = Cvar_Get(context.cvar, "debuggraph", "0", 0);
  context.scr_graphheight = Cvar_Get(context.cvar, "graphheight", "32", 0);
  context.scr_graphscale = Cvar_Get(context.cvar, "graphscale", "1", 0);
  context.scr_graphshift = Cvar_Get(context.cvar, "graphshift", "0", 0);
  context.crosshair = Cvar_Get(context.cvar, "crosshair", "0", CVAR_ARCHIVE);
  context.client.cl.screen.scr_initialized = true;

  Cmd_AddCommand(context.cmd, "sizeup", () => {
    SCR_SizeUp(context);
  });
  Cmd_AddCommand(context.cmd, "sizedown", () => {
    SCR_SizeDown(context);
  });
  Cmd_AddCommand(context.cmd, "loading", () => {
    SCR_Loading_f(context.client);
  });
  Cmd_AddCommand(context.cmd, "timerefresh", () => {
    SCR_TimeRefresh_f(context);
  });
  Cmd_AddCommand(context.cmd, "sky", () => {
    SCR_Sky_f(context);
  });
}

/**
 * Original name: SCR_SizeUp_f
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Increments the viewsize cvar by ten.
 */
export function SCR_SizeUp(context: ClientScreenContext): void {
  Cvar_SetValue(context.cvar, "viewsize", (context.scr_viewsize?.value ?? 100) + 10);
}

/**
 * Original name: SCR_SizeDown_f
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Decrements the viewsize cvar by ten.
 */
export function SCR_SizeDown(context: ClientScreenContext): void {
  Cvar_SetValue(context.cvar, "viewsize", (context.scr_viewsize?.value ?? 100) - 10);
}

/**
 * Original name: SCR_ExecuteLayoutString
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Interprets the Quake II HUD mini-language and emits ordered 2D draw commands.
 *
 * Porting notes:
 * - Current stage covers the priority token subset used by the standard status bar and early overlays, including `client` and `ctf` blocks.
 * - Keeps output as backend-agnostic draw commands instead of immediate renderer calls.
 */
export function SCR_ExecuteLayoutString(
  runtime: ClientRuntime,
  layout: string,
  context: ClientHudLayoutContext
): ClientHudDrawCommand[] {
  if (!context.active || !context.refreshPrepped || layout.length === 0) {
    return [];
  }

  const commands: ClientHudDrawCommand[] = [];
  const tokens = tokenizeLayoutString(layout);
  const state = {
    x: 0,
    y: 0,
    width: 3
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    switch (token) {
      case "xl":
        state.x = Number.parseInt(tokens[++index] ?? "0", 10);
        break;
      case "xr":
        state.x = context.viewportWidth + Number.parseInt(tokens[++index] ?? "0", 10);
        break;
      case "xv":
        state.x = context.viewportWidth / 2 - 160 + Number.parseInt(tokens[++index] ?? "0", 10);
        break;
      case "yt":
        state.y = Number.parseInt(tokens[++index] ?? "0", 10);
        break;
      case "yb":
        state.y = context.viewportHeight + Number.parseInt(tokens[++index] ?? "0", 10);
        break;
      case "yv":
        state.y = context.viewportHeight / 2 - 120 + Number.parseInt(tokens[++index] ?? "0", 10);
        break;
      case "pic": {
        const statIndex = Number.parseInt(tokens[++index] ?? "0", 10);
        const value = runtime.cl.frame.playerstate.stats[statIndex] ?? 0;
        if (value < 0 || value >= MAX_IMAGES) {
          throw new Error(`Pic >= MAX_IMAGES (${value})`);
        }

        const pic = resolveConfigstring(runtime, CS_IMAGES + value);
        if (pic) {
          commands.push(createPictureCommand(state.x, state.y, pic));
        }
        break;
      }
      case "picn": {
        const pic = tokens[++index] ?? "";
        if (pic.length > 0) {
          commands.push(createPictureCommand(state.x, state.y, pic));
        }
        break;
      }
      case "num": {
        state.width = Number.parseInt(tokens[++index] ?? "3", 10);
        const statIndex = Number.parseInt(tokens[++index] ?? "0", 10);
        const value = runtime.cl.frame.playerstate.stats[statIndex] ?? 0;
        const number = SCR_DrawField(state.x, state.y, 0, state.width, value);
        if (number) {
          commands.push(number);
        }
        break;
      }
      case "hnum": {
        const value = runtime.cl.frame.playerstate.stats[STAT_HEALTH] ?? 0;
        const color = value > 25 ? 0 : value > 0 ? (runtime.cl.frame.serverframe >> 2) & 1 : 1;
        if (((runtime.cl.frame.playerstate.stats[STAT_FLASHES] ?? 0) & 1) !== 0) {
          commands.push(createPictureCommand(state.x, state.y, "field_3"));
        }
        const number = SCR_DrawField(state.x, state.y, color, 3, value);
        if (number) {
          commands.push(number);
        }
        break;
      }
      case "anum": {
        const value = runtime.cl.frame.playerstate.stats[STAT_AMMO] ?? 0;
        if (value < 0) {
          break;
        }

        const color = value > 5 ? 0 : (runtime.cl.frame.serverframe >> 2) & 1;
        if (((runtime.cl.frame.playerstate.stats[STAT_FLASHES] ?? 0) & 4) !== 0) {
          commands.push(createPictureCommand(state.x, state.y, "field_3"));
        }
        const number = SCR_DrawField(state.x, state.y, color, 3, value);
        if (number) {
          commands.push(number);
        }
        break;
      }
      case "rnum": {
        const value = runtime.cl.frame.playerstate.stats[STAT_ARMOR] ?? 0;
        if (value < 1) {
          break;
        }

        if (((runtime.cl.frame.playerstate.stats[STAT_FLASHES] ?? 0) & 2) !== 0) {
          commands.push(createPictureCommand(state.x, state.y, "field_3"));
        }
        const number = SCR_DrawField(state.x, state.y, 0, 3, value);
        if (number) {
          commands.push(number);
        }
        break;
      }
      case "stat_string": {
        const statIndex = Number.parseInt(tokens[++index] ?? "0", 10);
        const configIndex = runtime.cl.frame.playerstate.stats[statIndex] ?? -1;
        if (configIndex < 0 || configIndex >= MAX_CONFIGSTRINGS) {
          throw new Error(`Bad stat_string index (${configIndex})`);
        }

        const value = runtime.cl.configstrings[configIndex] ?? "";
        if (value.length > 0) {
          commands.push(Inv_DrawString(state.x, state.y, value));
        }
        break;
      }
      case "cstring": {
        const text = tokens[++index] ?? "";
        commands.push(...DrawHUDString(text, state.x, state.y, 320, 0));
        break;
      }
      case "string": {
        const text = tokens[++index] ?? "";
        commands.push(Inv_DrawString(state.x, state.y, text));
        break;
      }
      case "cstring2": {
        const text = tokens[++index] ?? "";
        commands.push(...DrawHUDString(text, state.x, state.y, 320, 0x80));
        break;
      }
      case "string2": {
        const text = tokens[++index] ?? "";
        commands.push(Inv_DrawString(state.x, state.y, SetStringHighBit(text)));
        break;
      }
      case "if": {
        const statIndex = Number.parseInt(tokens[++index] ?? "0", 10);
        const value = runtime.cl.frame.playerstate.stats[statIndex] ?? 0;
        if (value === 0) {
          index = skipToEndif(tokens, index);
        }
        break;
      }
      case "endif":
        break;
      case "client":
        index = executeClientLayoutBlock(runtime, context, commands, tokens, index);
        break;
      case "ctf":
        index = executeCtfLayoutBlock(runtime, context, commands, tokens, index);
        break;
      default:
        break;
    }
  }

  return commands;
}

/**
 * Original name: SCR_DrawStats
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Executes the current status bar layout string and returns the resulting HUD draw commands.
 */
export function SCR_DrawStats(runtime: ClientRuntime, context: ClientHudLayoutContext): ClientHudDrawCommand[] {
  return SCR_ExecuteLayoutString(runtime, runtime.cl.configstrings[CS_STATUSBAR] ?? "", context);
}

/**
 * Original name: SCR_DrawLayout
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Executes the current overlay layout when `STAT_LAYOUTS` requests it.
 */
export function SCR_DrawLayout(runtime: ClientRuntime, context: ClientHudLayoutContext): ClientHudDrawCommand[] {
  if ((runtime.cl.frame.playerstate.stats[STAT_LAYOUTS] ?? 0) === 0) {
    return [];
  }

  return SCR_ExecuteLayoutString(runtime, runtime.cl.layout, context);
}

/**
 * Original name: SCR_ExecuteLayoutString
 * Source: client/cl_scrn.c
 * Category: Adapter
 * Fidelity level: Adapter
 *
 * Behavior:
 * - Interprets the Quake II HUD mini-language and draws through `refexport_t`.
 */
export function SCR_ExecuteLayoutStringRef(
  runtime: ClientRuntime,
  ref: refexport_t,
  layout: string,
  context: ClientHudLayoutContext
): void {
  if (!context.active || !context.refreshPrepped || layout.length === 0) {
    return;
  }

  const tokens = tokenizeLayoutString(layout);
  const state = {
    x: 0,
    y: 0,
    width: 3
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    switch (token) {
      case "xl":
        state.x = Number.parseInt(tokens[++index] ?? "0", 10);
        break;
      case "xr":
        state.x = context.viewportWidth + Number.parseInt(tokens[++index] ?? "0", 10);
        break;
      case "xv":
        state.x = context.viewportWidth / 2 - 160 + Number.parseInt(tokens[++index] ?? "0", 10);
        break;
      case "yt":
        state.y = Number.parseInt(tokens[++index] ?? "0", 10);
        break;
      case "yb":
        state.y = context.viewportHeight + Number.parseInt(tokens[++index] ?? "0", 10);
        break;
      case "yv":
        state.y = context.viewportHeight / 2 - 120 + Number.parseInt(tokens[++index] ?? "0", 10);
        break;
      case "pic": {
        const statIndex = Number.parseInt(tokens[++index] ?? "0", 10);
        const value = runtime.cl.frame.playerstate.stats[statIndex] ?? 0;
        if (value < 0 || value >= MAX_IMAGES) {
          throw new Error(`Pic >= MAX_IMAGES (${value})`);
        }

        const pic = resolveConfigstring(runtime, CS_IMAGES + value);
        if (pic) {
          ref.DrawPic(state.x, state.y, pic);
        }
        break;
      }
      case "picn": {
        const pic = tokens[++index] ?? "";
        if (pic.length > 0) {
          ref.DrawPic(state.x, state.y, pic);
        }
        break;
      }
      case "num": {
        state.width = Number.parseInt(tokens[++index] ?? "3", 10);
        const statIndex = Number.parseInt(tokens[++index] ?? "0", 10);
        const value = runtime.cl.frame.playerstate.stats[statIndex] ?? 0;
        SCR_DrawFieldRef(ref, state.x, state.y, 0, state.width, value);
        break;
      }
      case "hnum": {
        const value = runtime.cl.frame.playerstate.stats[STAT_HEALTH] ?? 0;
        const color = value > 25 ? 0 : value > 0 ? (runtime.cl.frame.serverframe >> 2) & 1 : 1;
        if (((runtime.cl.frame.playerstate.stats[STAT_FLASHES] ?? 0) & 1) !== 0) {
          ref.DrawPic(state.x, state.y, "field_3");
        }
        SCR_DrawFieldRef(ref, state.x, state.y, color, 3, value);
        break;
      }
      case "anum": {
        const value = runtime.cl.frame.playerstate.stats[STAT_AMMO] ?? 0;
        if (value < 0) {
          break;
        }

        const color = value > 5 ? 0 : (runtime.cl.frame.serverframe >> 2) & 1;
        if (((runtime.cl.frame.playerstate.stats[STAT_FLASHES] ?? 0) & 4) !== 0) {
          ref.DrawPic(state.x, state.y, "field_3");
        }
        SCR_DrawFieldRef(ref, state.x, state.y, color, 3, value);
        break;
      }
      case "rnum": {
        const value = runtime.cl.frame.playerstate.stats[STAT_ARMOR] ?? 0;
        if (value < 1) {
          break;
        }

        if (((runtime.cl.frame.playerstate.stats[STAT_FLASHES] ?? 0) & 2) !== 0) {
          ref.DrawPic(state.x, state.y, "field_3");
        }
        SCR_DrawFieldRef(ref, state.x, state.y, 0, 3, value);
        break;
      }
      case "stat_string": {
        const statIndex = Number.parseInt(tokens[++index] ?? "0", 10);
        const configIndex = runtime.cl.frame.playerstate.stats[statIndex] ?? -1;
        if (configIndex < 0 || configIndex >= MAX_CONFIGSTRINGS) {
          throw new Error(`Bad stat_string index (${configIndex})`);
        }

        const value = runtime.cl.configstrings[configIndex] ?? "";
        if (value.length > 0) {
          Inv_DrawStringRef(ref, state.x, state.y, value);
        }
        break;
      }
      case "cstring": {
        const text = tokens[++index] ?? "";
        DrawHUDStringRef(ref, text, state.x, state.y, 320, 0);
        break;
      }
      case "string": {
        const text = tokens[++index] ?? "";
        Inv_DrawStringRef(ref, state.x, state.y, text);
        break;
      }
      case "cstring2": {
        const text = tokens[++index] ?? "";
        DrawHUDStringRef(ref, text, state.x, state.y, 320, 0x80);
        break;
      }
      case "string2": {
        const text = tokens[++index] ?? "";
        Inv_DrawStringRef(ref, state.x, state.y, SetStringHighBit(text));
        break;
      }
      case "if": {
        const statIndex = Number.parseInt(tokens[++index] ?? "0", 10);
        const value = runtime.cl.frame.playerstate.stats[statIndex] ?? 0;
        if (value === 0) {
          index = skipToEndif(tokens, index);
        }
        break;
      }
      case "endif":
        break;
      case "client":
        index = executeClientLayoutBlockRef(runtime, ref, context, tokens, index);
        break;
      case "ctf":
        index = executeCtfLayoutBlockRef(runtime, ref, context, tokens, index);
        break;
      default:
        break;
    }
  }
}

/**
 * Original name: SCR_DrawStats
 * Source: client/cl_scrn.c
 * Category: Adapter
 * Fidelity level: Adapter
 */
export function SCR_DrawStatsRef(runtime: ClientRuntime, ref: refexport_t, context: ClientHudLayoutContext): void {
  SCR_ExecuteLayoutStringRef(runtime, ref, runtime.cl.configstrings[CS_STATUSBAR] ?? "", context);
}

/**
 * Original name: SCR_DrawLayout
 * Source: client/cl_scrn.c
 * Category: Adapter
 * Fidelity level: Adapter
 */
export function SCR_DrawLayoutRef(runtime: ClientRuntime, ref: refexport_t, context: ClientHudLayoutContext): void {
  if ((runtime.cl.frame.playerstate.stats[STAT_LAYOUTS] ?? 0) === 0) {
    return;
  }

  SCR_ExecuteLayoutStringRef(runtime, ref, runtime.cl.layout, context);
}

/**
 * Original name: N/A
 * Source: N/A (screen draw-command composer)
 * Category: New
 * Purpose: Compose the current Quake II HUD overlays in the same high-level order as `SCR_UpdateScreen`.
 *
 * Constraints:
 * - Must preserve status bar, layout and inventory ordering before center/pause/loading overlays.
 */
export function SCR_BuildHudDrawCommands(
  runtime: ClientRuntime,
  context: ClientHudLayoutContext,
  options: {
    bindings?: ClientInventoryBindingMap;
    screenState?: ClientScreenHudState;
    showPause?: boolean;
  } = {}
): ClientHudDrawCommand[] {
  const commands: ClientHudDrawCommand[] = [];
  const screenState = options.screenState ?? SCR_BuildScreenState(runtime);
  commands.push(...SCR_DrawStats(runtime, context));

  if (((runtime.cl.frame.playerstate.stats[STAT_LAYOUTS] ?? 0) & 1) !== 0) {
    commands.push(...SCR_DrawLayout(runtime, context));
  }

  if (((runtime.cl.frame.playerstate.stats[STAT_LAYOUTS] ?? 0) & 2) !== 0) {
    commands.push(...CL_DrawInventory(runtime, context, options.bindings));
  }

  const netCommand = SCR_DrawNet(runtime);
  if (netCommand) {
    commands.push(netCommand);
  }

  if (screenState.centerPrint) {
    const centerY = screenState.centerPrint.lines <= 4 ? context.viewportHeight * 0.35 : 48;
    commands.push(...DrawHUDString(screenState.centerPrint.text, 0, centerY, context.viewportWidth, 0));
  }

  const pauseCommand = SCR_DrawPause({
    paused: screenState.pause.visible,
    showPause: options.showPause ?? true,
    viewportHeight: context.viewportHeight
  });
  if (pauseCommand) {
    commands.push(pauseCommand);
  }

  const loadingCommand = SCR_DrawLoading(runtime);
  if (loadingCommand) {
    commands.push(loadingCommand);
  }

  return commands;
}

/**
 * Original name: N/A
 * Source: N/A (renderer adapter)
 * Category: New
 * Purpose: Draw the current Quake II HUD overlays through the original renderer export table order.
 *
 * Constraints:
 * - Must preserve status bar, layout and inventory ordering before center/pause/loading overlays.
 * - Kept beside `SCR_BuildHudDrawCommands` until all legacy command consumers are removed.
 */
export function SCR_DrawHudRef(
  runtime: ClientRuntime,
  ref: refexport_t,
  context: ClientHudLayoutContext,
  options: {
    bindings?: ClientInventoryBindingMap;
    crosshairValue?: number;
    screenState?: ClientScreenHudState;
    showPause?: boolean;
  } = {}
): void {
  const screenState = options.screenState ?? SCR_BuildScreenState(runtime);
  SCR_DrawStatsRef(runtime, ref, context);

  if (((runtime.cl.frame.playerstate.stats[STAT_LAYOUTS] ?? 0) & 1) !== 0) {
    SCR_DrawLayoutRef(runtime, ref, context);
  }

  if (((runtime.cl.frame.playerstate.stats[STAT_LAYOUTS] ?? 0) & 2) !== 0) {
    CL_DrawInventoryRef(runtime, ref, context, options.bindings);
  }

  const netCommand = SCR_DrawNet(runtime);
  if (netCommand) {
    drawPictureCommandRef(ref, netCommand, context.viewportWidth, context.viewportHeight);
  }

  if (screenState.centerPrint) {
    const centerY = screenState.centerPrint.lines <= 4 ? context.viewportHeight * 0.35 : 48;
    DrawHUDStringRef(ref, screenState.centerPrint.text, 0, centerY, context.viewportWidth, 0);
  }

  const pauseCommand = SCR_DrawPause({
    paused: screenState.pause.visible,
    showPause: options.showPause ?? true,
    viewportHeight: context.viewportHeight
  });
  if (pauseCommand) {
    drawPictureCommandRef(ref, pauseCommand, context.viewportWidth, context.viewportHeight);
  }

  const loadingCommand = SCR_DrawLoading(runtime);
  if (loadingCommand) {
    drawPictureCommandRef(ref, loadingCommand, context.viewportWidth, context.viewportHeight);
  }

  SCR_DrawCrosshairRef(runtime, ref, context, options.crosshairValue ?? 0);
}

/**
 * Original name: SCR_DrawCrosshair
 * Source: client/cl_view.c
 * Category: Adapter
 * Fidelity level: Close
 *
 * Behavior:
 * - Draws the selected crosshair picture centered in the current rendered viewport.
 *
 * Porting notes:
 * - Proprietary port lives in `packages/client/src/cl_view.ts`; this helper adapts it for the HUD/ref path.
 */
export function SCR_DrawCrosshairRef(
  runtime: ClientRuntime,
  ref: refexport_t,
  context: ClientHudLayoutContext,
  crosshairValue: number
): void {
  if (crosshairValue === 0) {
    SCR_TouchPics(0, { runtime });
    return;
  }

  SCR_TouchPics(crosshairValue, {
    runtime,
    getPicSize: ref.DrawGetPicSize
  });

  const pic = runtime.cl.screen.crosshair_pic;
  if (!pic || runtime.cl.screen.crosshair_width <= 0 || runtime.cl.screen.crosshair_height <= 0) {
    return;
  }

  const x = (context.viewportWidth - runtime.cl.screen.crosshair_width) >> 1;
  const y = (context.viewportHeight - runtime.cl.screen.crosshair_height) >> 1;
  ref.DrawPic(x, y, pic);
}

/**
 * Original name: CL_AddNetgraph
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Emits dropped, suppressed and latency samples into the screen debug-graph ring buffer.
 *
 * Porting notes:
 * - Reads the debug-graph cvar state from the explicit screen context.
 */
export function CL_AddNetgraph(context: ClientScreenContext): void {
  if ((context.scr_debuggraph?.value ?? 0) !== 0 || (context.scr_timegraph?.value ?? 0) !== 0) {
    return;
  }

  for (let index = 0; index < context.client.cls.netchan.dropped; index += 1) {
    SCR_DebugGraph(context.client, 30, 0x40);
  }

  for (let index = 0; index < context.client.cl.surpressCount; index += 1) {
    SCR_DebugGraph(context.client, 30, 0xdf);
  }

  const incomingAcknowledged = context.client.cls.netchan.incoming_acknowledged & 63;
  let ping = context.client.cls.realtime - (context.client.cl.cmd_time[incomingAcknowledged] ?? 0);
  ping = Math.trunc(ping / 30);
  if (ping > 30) {
    ping = 30;
  }
  SCR_DebugGraph(context.client, ping, 0xd0);
}

/**
 * Original name: SCR_DebugGraph
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Stores one scrolling debug-graph sample in the ring buffer used by the screen module.
 */
export function SCR_DebugGraph(runtime: ClientRuntime, value: number, color: number): void {
  runtime.cl.screen.graph_values[runtime.cl.screen.graph_current & 1023] = {
    value,
    color
  };
  runtime.cl.screen.graph_current += 1;
}

/**
 * Original name: SCR_DrawDebugGraph
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Expands the stored debug-graph ring buffer into fill commands in screen pixel space.
 *
 * Porting notes:
 * - Emits renderer-agnostic fill commands instead of immediate `DrawFill` calls.
 */
export function SCR_DrawDebugGraph(
  runtime: ClientRuntime,
  options: {
    graphheight: number;
    graphscale: number;
    graphshift: number;
  }
): ClientHudDrawCommand[] {
  const commands: ClientHudDrawCommand[] = [];
  const w = runtime.cl.screen.scr_vrect.width;
  const x = runtime.cl.screen.scr_vrect.x;
  const y = runtime.cl.screen.scr_vrect.y + runtime.cl.screen.scr_vrect.height;
  const graphHeight = Math.max(1, Math.trunc(options.graphheight));

  commands.push({
    type: "fill",
    x,
    y: y - graphHeight,
    width: w,
    height: graphHeight,
    color: 8,
    bounds: {
      x,
      y: y - graphHeight,
      width: w,
      height: graphHeight
    }
  });

  for (let a = 0; a < w; a += 1) {
    const i = (runtime.cl.screen.graph_current - 1 - a + 1024) & 1023;
    const sample = runtime.cl.screen.graph_values[i];
    let v = sample.value;
    v = v * options.graphscale + options.graphshift;

    if (v < 0) {
      v += graphHeight * (1 + Math.trunc(-v / graphHeight));
    }

    const h = Math.trunc(v) % graphHeight;
    if (h <= 0) {
      continue;
    }

    commands.push({
      type: "fill",
      x: x + w - 1 - a,
      y: y - h,
      width: 1,
      height: h,
      color: sample.color,
      bounds: {
        x: x + w - 1 - a,
        y: y - h,
        width: 1,
        height: h
      }
    });
  }

  return commands;
}

/**
 * Original name: SCR_CenterPrint
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Stores a center-print string and resets its display timer.
 *
 * Porting notes:
 * - Preserves line counting and timing state.
 * - Leaves console echoing to host hooks or later adapters.
 */
export function SCR_CenterPrint(runtime: ClientRuntime, text: string, centertimeSeconds = 2.5): void {
  runtime.cl.screen.scr_centerstring = text;
  runtime.cl.screen.scr_centertime_off = centertimeSeconds * 1000;
  runtime.cl.screen.scr_centertime_start = runtime.cl.time;
  runtime.cl.screen.scr_center_lines = countCenterLines(text);
}

/**
 * Original name: SCR_CheckDrawCenterString
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Advances center-print timing and returns the active center-print descriptor when visible.
 *
 * Porting notes:
 * - Uses `cls.frametime` in milliseconds for the current port stage.
 */
export function SCR_CheckDrawCenterString(runtime: ClientRuntime): ClientCenterPrintState | null {
  runtime.cl.screen.scr_centertime_off -= runtime.cls.frametime;
  if (runtime.cl.screen.scr_centertime_off <= 0 || runtime.cl.screen.scr_centerstring.length === 0) {
    return null;
  }

  return {
    text: runtime.cl.screen.scr_centerstring,
    lines: runtime.cl.screen.scr_center_lines,
    remainingMs: runtime.cl.screen.scr_centertime_off,
    startedAt: runtime.cl.screen.scr_centertime_start
  };
}

/**
 * Original name: SCR_BeginLoadingPlaque
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Stops transient audio, applies the original early-out guards, then flags the loading plaque as active.
 *
 * Porting notes:
 * - Receives `developer`, key destination and host callbacks explicitly because those globals live in other TS modules.
 */
export function SCR_BeginLoadingPlaque(runtime: ClientRuntime, options: ClientLoadingPlaqueOptions = {}): void {
  options.onStopAllSounds?.();
  runtime.cl.sound_prepped = false;
  options.onCDAudioStop?.();

  if (runtime.cls.disable_screen !== 0) {
    return;
  }
  if (options.developer === true) {
    return;
  }
  if (runtime.cls.state === connstate_t.ca_disconnected) {
    return;
  }
  if (options.keyDest === "console") {
    return;
  }

  runtime.cl.screen.scr_draw_loading = runtime.cl.cinematic.cinematictime > 0 ? 2 : 1;
  options.onUpdateScreen?.();
  runtime.cls.disable_screen = Math.max(1, runtime.cls.realtime);
  runtime.cls.disable_servercount = runtime.cl.servercount;
}

/**
 * Original name: SCR_EndLoadingPlaque
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Clears the loading plaque state.
 */
export function SCR_EndLoadingPlaque(runtime: ClientRuntime): void {
  runtime.cl.screen.scr_draw_loading = 0;
  runtime.cls.disable_screen = 0;
}

/**
 * Original name: SCR_Loading_f
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Console-command wrapper around `SCR_BeginLoadingPlaque`.
 */
export function SCR_Loading_f(runtime: ClientRuntime): void {
  SCR_BeginLoadingPlaque(runtime);
}

/**
 * Original name: SCR_RunConsole
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Advances the animated console height toward the current target exposure.
 *
 * Porting notes:
 * - Receives the key destination explicitly instead of reading global client input state.
 */
export function SCR_RunConsole(
  runtime: ClientRuntime,
  options: {
    keyDest?: "game" | "console" | "message" | "menu";
    scr_conspeed?: number;
  } = {}
): number {
  runtime.cl.screen.scr_conlines = options.keyDest === "console" ? 0.5 : 0;

  const scrConspeed = options.scr_conspeed ?? 3;
  if (runtime.cl.screen.scr_conlines < runtime.cl.screen.scr_con_current) {
    runtime.cl.screen.scr_con_current -= scrConspeed * runtime.cls.frametime;
    if (runtime.cl.screen.scr_conlines > runtime.cl.screen.scr_con_current) {
      runtime.cl.screen.scr_con_current = runtime.cl.screen.scr_conlines;
    }
  } else if (runtime.cl.screen.scr_conlines > runtime.cl.screen.scr_con_current) {
    runtime.cl.screen.scr_con_current += scrConspeed * runtime.cls.frametime;
    if (runtime.cl.screen.scr_conlines < runtime.cl.screen.scr_con_current) {
      runtime.cl.screen.scr_con_current = runtime.cl.screen.scr_conlines;
    }
  }

  return runtime.cl.screen.scr_con_current;
}

/**
 * Original name: SCR_DrawNet
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Reports the lag-warning overlay when the outgoing command backlog reaches `CMD_BACKUP - 1`.
 */
export function SCR_DrawNet(
  runtime: ClientRuntime,
  options: {
    outgoingSequence?: number;
    incomingAcknowledged?: number;
    commandBackup?: number;
  } = {}
): ClientHudPictureCommand | null {
  const commandBackup = options.commandBackup ?? 64;
  const outgoingSequence = options.outgoingSequence ?? runtime.cls.netchan.outgoing_sequence;
  const incomingAcknowledged = options.incomingAcknowledged ?? runtime.cls.netchan.incoming_acknowledged;

  if ((outgoingSequence - incomingAcknowledged) < commandBackup - 1) {
    return null;
  }

  return createAutosizedPictureCommand(runtime.cl.screen.scr_vrect.x + 64, runtime.cl.screen.scr_vrect.y, "net");
}

/**
 * Original name: SCR_DrawPause
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Reports the pause overlay only when the pause cvar and paused state are both active.
 */
export function SCR_DrawPause(options: {
  paused: boolean;
  showPause: boolean;
  viewportHeight: number;
}): ClientHudPictureCommand | null {
  if (!options.showPause || !options.paused) {
    return null;
  }

  return createAutosizedPictureCommand(-1, options.viewportHeight / 2 + 8, "pause");
}

/**
 * Original name: SCR_DrawLoading
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Reports the loading overlay once and consumes the draw flag like the original code.
 */
export function SCR_DrawLoading(runtime: ClientRuntime): ClientHudPictureCommand | null {
  if (runtime.cl.screen.scr_draw_loading === 0) {
    return null;
  }

  runtime.cl.screen.scr_draw_loading = 0;
  return createAutosizedPictureCommand(-1, -1, "loading");
}

/**
 * Original name: SCR_AddDirtyPoint
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Expands the current dirty rectangle so tile-clearing logic can track disturbed pixels.
 */
export function SCR_AddDirtyPoint(runtime: ClientRuntime, x: number, y: number): void {
  if (x < runtime.cl.screen.scr_dirty.x1) {
    runtime.cl.screen.scr_dirty.x1 = x;
  }
  if (x > runtime.cl.screen.scr_dirty.x2) {
    runtime.cl.screen.scr_dirty.x2 = x;
  }
  if (y < runtime.cl.screen.scr_dirty.y1) {
    runtime.cl.screen.scr_dirty.y1 = y;
  }
  if (y > runtime.cl.screen.scr_dirty.y2) {
    runtime.cl.screen.scr_dirty.y2 = y;
  }
}

/**
 * Original name: SCR_DirtyScreen
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Marks the full screen as dirty using the current viewport dimensions.
 */
export function SCR_DirtyScreen(runtime: ClientRuntime, viewportWidth: number, viewportHeight: number): void {
  SCR_AddDirtyPoint(runtime, 0, 0);
  SCR_AddDirtyPoint(runtime, viewportWidth - 1, viewportHeight - 1);
}

/**
 * Original name: SCR_TileClear
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Clears disturbed `backtile` regions outside the rendered view when the view is smaller than full screen.
 * - Preserves dirty-rectangle unioning across the current and two previous frames for page-flip safety.
 *
 * Porting notes:
 * - Emits tile-clear commands; `SCR_TileClearRef` applies the same commands through `refexport_t`.
 */
export function SCR_TileClear(
  runtime: ClientRuntime,
  options: {
    viewportWidth: number;
    viewportHeight: number;
    scr_drawall?: number;
    scr_viewsize?: number;
  }
): ClientTileClearCommand[] {
  if ((options.scr_drawall ?? 0) !== 0) {
    SCR_DirtyScreen(runtime, options.viewportWidth, options.viewportHeight);
  }

  if (runtime.cl.screen.scr_con_current === 1.0) {
    return [];
  }
  if ((options.scr_viewsize ?? 100) === 100) {
    return [];
  }
  if (runtime.cl.cinematic.cinematictime > 0) {
    return [];
  }

  const clear = { ...runtime.cl.screen.scr_dirty };
  for (let index = 0; index < 2; index += 1) {
    const oldDirty = runtime.cl.screen.scr_old_dirty[index];
    if (oldDirty.x1 < clear.x1) {
      clear.x1 = oldDirty.x1;
    }
    if (oldDirty.x2 > clear.x2) {
      clear.x2 = oldDirty.x2;
    }
    if (oldDirty.y1 < clear.y1) {
      clear.y1 = oldDirty.y1;
    }
    if (oldDirty.y2 > clear.y2) {
      clear.y2 = oldDirty.y2;
    }
  }

  runtime.cl.screen.scr_old_dirty[1] = { ...runtime.cl.screen.scr_old_dirty[0] };
  runtime.cl.screen.scr_old_dirty[0] = { ...runtime.cl.screen.scr_dirty };
  runtime.cl.screen.scr_dirty = { x1: 9999, y1: 9999, x2: -9999, y2: -9999 };

  let clearX1 = clear.x1;
  let clearY1 = clear.y1;
  let clearX2 = clear.x2;
  let clearY2 = clear.y2;
  const consoleTop = runtime.cl.screen.scr_con_current * options.viewportHeight;
  if (consoleTop >= clearY1) {
    clearY1 = consoleTop;
  }
  if (clearY2 <= clearY1) {
    return [];
  }

  const viewTop = runtime.cl.screen.scr_vrect.y;
  const viewBottom = viewTop + runtime.cl.screen.scr_vrect.height - 1;
  const viewLeft = runtime.cl.screen.scr_vrect.x;
  const viewRight = viewLeft + runtime.cl.screen.scr_vrect.width - 1;
  const commands: ClientTileClearCommand[] = [];
  const pushClear = (x: number, y: number, width: number, height: number): void => {
    if (width <= 0 || height <= 0) {
      return;
    }
    commands.push({
      type: "tileClear",
      x,
      y,
      width,
      height,
      pic: "backtile",
      bounds: { x, y, width, height }
    });
  };

  if (clearY1 < viewTop) {
    const i = clearY2 < viewTop - 1 ? clearY2 : viewTop - 1;
    pushClear(clearX1, clearY1, clearX2 - clearX1 + 1, i - clearY1 + 1);
    clearY1 = viewTop;
  }
  if (clearY2 > viewBottom) {
    const i = clearY1 > viewBottom + 1 ? clearY1 : viewBottom + 1;
    pushClear(clearX1, i, clearX2 - clearX1 + 1, clearY2 - i + 1);
    clearY2 = viewBottom;
  }
  if (clearX1 < viewLeft) {
    const i = clearX2 < viewLeft - 1 ? clearX2 : viewLeft - 1;
    pushClear(clearX1, clearY1, i - clearX1 + 1, clearY2 - clearY1 + 1);
    clearX1 = viewLeft;
  }
  if (clearX2 > viewRight) {
    const i = clearX1 > viewRight + 1 ? clearX1 : viewRight + 1;
    pushClear(i, clearY1, clearX2 - i + 1, clearY2 - clearY1 + 1);
  }

  return commands;
}

/**
 * Original name: SCR_TileClear
 * Source: client/cl_scrn.c
 * Category: Adapter
 * Fidelity level: Close
 *
 * Behavior:
 * - Applies the tiled clear rectangles through the renderer export table.
 */
export function SCR_TileClearRef(
  runtime: ClientRuntime,
  ref: refexport_t,
  options: {
    viewportWidth: number;
    viewportHeight: number;
    scr_drawall?: number;
    scr_viewsize?: number;
  }
): ClientTileClearCommand[] {
  const commands = SCR_TileClear(runtime, options);
  for (const command of commands) {
    ref.DrawTileClear(command.x, command.y, command.width, command.height, command.pic);
  }
  return commands;
}

/**
 * Original name: SCR_DrawConsole
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Selects full, half, scrolling, notify or no console draw according to connection and key state.
 *
 * Porting notes:
 * - The console module owns the actual `Con_*` rendering; this mirrors the screen module's branch logic for adapters.
 */
export function SCR_DrawConsole(
  runtime: ClientRuntime,
  options: {
    keyDest?: "game" | "console" | "message" | "menu";
    viewportWidth?: number;
    viewportHeight?: number;
  } = {}
): ClientScreenConsolePlan {
  const viewportWidth = options.viewportWidth ?? 320;
  const viewportHeight = options.viewportHeight ?? 240;

  if (runtime.cls.state === connstate_t.ca_disconnected || runtime.cls.state === connstate_t.ca_connecting) {
    return { mode: "full", frac: 1.0, fill: null, drawNotify: false };
  }

  if (runtime.cls.state !== connstate_t.ca_active || !runtime.cl.refresh_prepped) {
    return {
      mode: "half",
      frac: 0.5,
      fill: {
        type: "fill",
        x: 0,
        y: viewportHeight / 2,
        width: viewportWidth,
        height: viewportHeight / 2,
        color: 0,
        bounds: {
          x: 0,
          y: viewportHeight / 2,
          width: viewportWidth,
          height: viewportHeight / 2
        }
      },
      drawNotify: false
    };
  }

  if (runtime.cl.screen.scr_con_current !== 0) {
    return { mode: "scroll", frac: runtime.cl.screen.scr_con_current, fill: null, drawNotify: false };
  }

  const drawNotify = options.keyDest === "game" || options.keyDest === "message";
  return {
    mode: drawNotify ? "notify" : "none",
    frac: 0,
    fill: null,
    drawNotify
  };
}

/**
 * Original name: N/A
 * Source: N/A (screen snapshot builder)
 * Category: New
 * Purpose: Build the first renderer-agnostic client HUD/screen snapshot.
 *
 * Constraints:
 * - Must preserve the raw layout string and core statusbar-derived values.
 */
export function SCR_BuildScreenState(runtime: ClientRuntime, options: ClientScreenBuildOptions = {}): ClientScreenHudState {
  const stats = [...runtime.cl.frame.playerstate.stats];
  const layoutBits = stats[STAT_LAYOUTS] ?? 0;

  return {
    layout: runtime.cl.layout,
    layoutBits,
    statusbar: runtime.cl.configstrings[CS_STATUSBAR] ?? "",
    inventory: [...runtime.cl.inventory],
    stats,
    centerPrint: buildCenterPrintSnapshot(runtime),
    loading: buildLoadingSnapshot(runtime),
    pause: buildPauseSnapshot(options),
    net: buildNetSnapshot(options),
    showScores: (layoutBits & 1) !== 0,
    showInventory: (layoutBits & 2) !== 0,
    health: stats[STAT_HEALTH] ?? 0,
    healthIcon: resolveImageStat(runtime, stats[STAT_HEALTH_ICON]),
    ammo: stats[STAT_AMMO] ?? 0,
    ammoIcon: resolveImageStat(runtime, stats[STAT_AMMO_ICON]),
    armor: stats[STAT_ARMOR] ?? 0,
    armorIcon: resolveImageStat(runtime, stats[STAT_ARMOR_ICON]),
    selectedItem: stats[STAT_SELECTED_ITEM] ?? 0,
    selectedItemName: resolveSelectedItemName(runtime, stats[STAT_SELECTED_ITEM]),
    selectedIcon: resolveImageStat(runtime, stats[STAT_SELECTED_ICON]),
    pickupString: resolveConfigstring(runtime, stats[STAT_PICKUP_STRING]),
    pickupIcon: resolveImageStat(runtime, stats[STAT_PICKUP_ICON]),
    timer: stats[STAT_TIMER] ?? 0,
    timerIcon: resolveImageStat(runtime, stats[STAT_TIMER_ICON]),
    frags: stats[STAT_FRAGS] ?? 0,
    flashes: stats[STAT_FLASHES] ?? 0,
    spectator: (stats[STAT_SPECTATOR] ?? 0) !== 0
  };
}

/**
 * Original name: SCR_UpdateScreen
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Builds the current screen snapshot in the same high-level order as the original screen loop.
 *
 * Porting notes:
 * - Can either emit a renderer-neutral snapshot or drive a supplied `refexport_t` for the legacy frame boundaries.
 * - Returns `null` while the loading plaque disable timer is active, mirroring the original early return.
 */
export function SCR_UpdateScreen(
  context: ClientScreenContext,
  options: ClientScreenBuildOptions = {},
  hooks: ClientScreenHooks = {}
): ClientScreenFrame | null {
  const viewportWidth = options.viewportWidth ?? 320;
  const viewportHeight = options.viewportHeight ?? 240;
  const currentTimeMs = options.currentTimeMs ?? 0;

  if (context.client.cls.disable_screen !== 0 && context.client.cl.screen.scr_draw_loading === 0) {
    if ((currentTimeMs - context.client.cls.disable_screen) > 120000) {
      context.client.cls.disable_screen = 0;
    } else {
      return null;
    }
  }

  if (!context.client.cl.screen.scr_initialized || options.consoleInitialized === false) {
    return null;
  }

  let stereoSeparation = Math.max(0, Math.min(1, options.cl_stereo_separation ?? 0));
  const numframes = (options.cl_stereo ?? 0) !== 0 ? 2 : 1;
  const separations = numframes === 2 ? [-stereoSeparation / 2, stereoSeparation / 2] : [0];
  const beginFrame = (separation: number): void => {
    options.ref?.BeginFrame(separation);
  };
  const renderFrame = (separation: number): void => {
    if (!options.ref || !options.renderFrame) {
      return;
    }
    options.ref.RenderFrame(options.renderFrame(separation));
  };
  const endFrame = (): void => {
    options.ref?.EndFrame();
  };

  if (context.client.cl.screen.scr_draw_loading === 2) {
    for (const separation of separations) {
      beginFrame(separation);
    }
    const loadingCommand = SCR_DrawLoading(context.client);
    endFrame();
    return {
      vrect: context.client.cl.screen.scr_vrect,
      commands: loadingCommand ? [loadingCommand] : [],
      screenState: SCR_BuildScreenState(context.client, {
        ...options,
        viewportWidth,
        viewportHeight
      }),
      cinematic: null
    };
  }

  if (context.client.cl.cinematic.cinematictime > 0) {
    for (const separation of separations) {
      beginFrame(separation);
      renderFrame(separation);
    }
    const frame = buildActiveCinematicScreenFrame(context.client, options, viewportWidth, viewportHeight);
    endFrame();
    return frame;
  }

  const vrect = SCR_CalcVrect(context.client, viewportWidth, viewportHeight, context.scr_viewsize?.value ?? 100);
  const consoleOptions: {
    keyDest?: "game" | "console" | "message" | "menu";
    scr_conspeed?: number;
  } = {
    scr_conspeed: context.scr_conspeed?.value ?? 3
  };
  if (options.keyDest !== undefined) {
    consoleOptions.keyDest = options.keyDest;
  }
  SCR_RunConsole(context.client, consoleOptions);

  const screenState = SCR_BuildScreenState(context.client, {
    ...options,
    viewportWidth,
    viewportHeight
  });
  const commands: ClientHudDrawCommand[] = [];
  for (const separation of separations) {
    beginFrame(separation);
    if (options.ref) {
      SCR_TileClearRef(context.client, options.ref, {
        viewportWidth,
        viewportHeight,
        scr_drawall: context.scr_drawall?.value ?? 0,
        scr_viewsize: context.scr_viewsize?.value ?? 100
      });
    } else {
      commands.push(...SCR_TileClear(context.client, {
        viewportWidth,
        viewportHeight,
        scr_drawall: context.scr_drawall?.value ?? 0,
        scr_viewsize: context.scr_viewsize?.value ?? 100
      }));
    }
    renderFrame(separation);
  }

  if (options.ref) {
    SCR_DrawHudRef(context.client, options.ref, {
      viewportWidth,
      viewportHeight,
      active: context.client.cls.state === connstate_t.ca_active,
      refreshPrepped: context.client.cl.refresh_prepped
    }, {
      screenState,
      showPause: (context.scr_showpause?.value ?? 1) !== 0
    });
  } else {
    commands.push(...SCR_BuildHudDrawCommands(context.client, {
      viewportWidth,
      viewportHeight,
      active: context.client.cls.state === connstate_t.ca_active,
      refreshPrepped: context.client.cl.refresh_prepped
    }, {
      screenState,
      showPause: (context.scr_showpause?.value ?? 1) !== 0
    }));
  }

  if ((context.scr_timegraph?.value ?? 0) !== 0) {
    SCR_DebugGraph(context.client, context.client.cls.frametime * 300, 0);
  }

  if ((context.scr_debuggraph?.value ?? 0) !== 0 || (context.scr_timegraph?.value ?? 0) !== 0 || (context.scr_netgraph?.value ?? 0) !== 0) {
    commands.push(...SCR_DrawDebugGraph(context.client, {
      graphheight: context.scr_graphheight?.value ?? 32,
      graphscale: context.scr_graphscale?.value ?? 1,
      graphshift: context.scr_graphshift?.value ?? 0
    }));
  }

  endFrame();

  return {
    vrect,
    commands,
    screenState,
    cinematic: null
  };
}

/**
 * Original name: N/A
 * Source: N/A (screen cinematic snapshot helper)
 * Category: New
 * Purpose: Build the screen-frame snapshot for the dedicated cinematic path of `SCR_UpdateScreen`.
 *
 * Constraints:
 * - Must preserve the original early cinematic short-circuit before normal HUD/view drawing.
 */
function buildActiveCinematicScreenFrame(
  runtime: ClientRuntime,
  options: ClientScreenBuildOptions,
  viewportWidth: number,
  viewportHeight: number
): ClientScreenFrame {
  const cinematicOptions: {
    viewportWidth: number;
    viewportHeight: number;
    keyDest?: "game" | "console" | "message" | "menu";
  } = {
    viewportWidth,
    viewportHeight
  };

  if (options.keyDest !== undefined) {
    cinematicOptions.keyDest = options.keyDest;
  }

  const cinematicCommands = SCR_DrawCinematic(runtime, cinematicOptions);

  return {
    vrect: runtime.cl.screen.scr_vrect,
    commands: cinematicCommands.commands,
    screenState: SCR_BuildScreenState(runtime, {
      ...options,
      viewportWidth,
      viewportHeight
    }),
    cinematic: cinematicCommands.cinematic
  };
}

/**
 * Original name: SCR_TimeRefresh_f
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Samples a 128-step yaw sweep and returns the elapsed timing summary.
 *
 * Porting notes:
 * - Reports the timing numbers to the caller instead of driving the renderer directly.
 */
export function SCR_TimeRefresh_f(
  context: ClientScreenContext,
  options: {
    ref?: refexport_t;
    nowMs?: () => number;
    buildRefdef?: (yawDegrees: number) => refdef_t;
  } = {}
): { seconds: number; fps: number } | null {
  if (context.client.cls.state !== connstate_t.ca_active) {
    return null;
  }

  const hasClock = options.nowMs !== undefined;
  const start = options.nowMs?.() ?? 0;
  const makeRefdef = options.buildRefdef ?? ((yawDegrees: number): refdef_t => {
    const refdef = createRefDef();
    refdef.viewangles[1] = yawDegrees;
    return refdef;
  });

  if (options.ref) {
    if (Cmd_Argc(context.cmd) === 2) {
      options.ref.BeginFrame(0);
      for (let index = 0; index < 128; index += 1) {
        options.ref.RenderFrame(makeRefdef(index / 128.0 * 360.0));
      }
      options.ref.EndFrame();
    } else {
      for (let index = 0; index < 128; index += 1) {
        options.ref.BeginFrame(0);
        options.ref.RenderFrame(makeRefdef(index / 128.0 * 360.0));
        options.ref.EndFrame();
      }
    }
  }

  const stop = options.nowMs?.() ?? (start + 128 / 60 * 1000);
  const seconds = hasClock ? Math.max((stop - start) / 1000.0, Number.EPSILON) : 128 / 60;
  return {
    seconds,
    fps: 128 / seconds
  };
}

/**
 * Original name: SCR_Sky_f
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Parses the `sky` console command and stores the resulting sky state in the client runtime.
 */
export function SCR_Sky_f(context: ClientScreenContext): boolean {
  if (Cmd_Argc(context.cmd) < 2) {
    return false;
  }

  context.client.cl.sky.name = Cmd_Argv(context.cmd, 1);
  context.client.cl.sky.rotate = Cmd_Argc(context.cmd) > 2 ? Number.parseFloat(Cmd_Argv(context.cmd, 2)) || 0 : 0;

  if (Cmd_Argc(context.cmd) === 6) {
    context.client.cl.sky.axis = [
      Number.parseFloat(Cmd_Argv(context.cmd, 3)) || 0,
      Number.parseFloat(Cmd_Argv(context.cmd, 4)) || 0,
      Number.parseFloat(Cmd_Argv(context.cmd, 5)) || 0
    ];
  } else {
    context.client.cl.sky.axis = [0, 0, 1];
  }

  return true;
}

/**
 * Original name: SCR_StopCinematic
 * Source: client/screen.h
 * Category: Adapter
 * Fidelity level: Close
 *
 * Behavior:
 * - Clears the active cinematic state and returns the client to non-cinematic drawing.
 *
 * Porting notes:
 * - Facade for the public `screen.h` API; behavioral ownership stays in `cl_cin.ts`.
 * - Defers sound backend restart side effects to host hooks.
 */
export function SCR_StopCinematic(runtime: ClientRuntime, hooks: ClientScreenHooks = {}): void {
  SCR_StopCinematic_Impl(runtime, hooks);
}

/**
 * Original name: SCR_FinishCinematic
 * Source: client/screen.h
 * Category: Adapter
 * Fidelity level: Strict
 *
 * Behavior:
 * - Queues the original `nextserver` string command so the server can advance after a cinematic.
 *
 * Porting notes:
 * - Facade for the public `screen.h` API; behavioral ownership stays in `cl_cin.ts`.
 */
export function SCR_FinishCinematic(runtime: ClientRuntime): void {
  SCR_FinishCinematic_Impl(runtime);
}

/**
 * Original name: SCR_RunCinematic
 * Source: client/screen.h
 * Category: Adapter
 * Fidelity level: Close
 *
 * Behavior:
 * - Advances the active cinematic timeline for static `.pcx` and streamed `.cin` cinematics.
 *
 * Porting notes:
 * - Facade for the public `screen.h` API; behavioral ownership stays in `cl_cin.ts`.
 * - Static PCX cinematics intentionally remain on screen until replaced or stopped, matching `cinematicframe == -1`.
 */
export function SCR_RunCinematic(
  runtime: ClientRuntime,
  options: {
    keyDest?: "game" | "console" | "message" | "menu";
    currentTimeMs?: number;
  } = {},
  hooks: ClientScreenHooks = {}
): void {
  SCR_RunCinematic_Impl(runtime, { SCR_BeginLoadingPlaque, SCR_EndLoadingPlaque }, options, hooks);
}

/**
 * Original name: SCR_DrawCinematic
 * Source: client/screen.h
 * Category: Adapter
 * Fidelity level: Close
 *
 * Behavior:
 * - Reports whether a cinematic is active and emits the current full-screen image draw command when available.
 *
 * Porting notes:
 * - Facade for the public `screen.h` API; behavioral ownership stays in `cl_cin.ts`.
 * - Returns indexed-pixel snapshots so renderer adapters can upload static and streamed cinematic frames.
 */
export function SCR_DrawCinematic(
  runtime: ClientRuntime,
  options: {
    viewportWidth: number;
    viewportHeight: number;
    keyDest?: "game" | "console" | "message" | "menu";
  }
): { active: boolean; commands: ClientHudDrawCommand[]; cinematic: ClientCinematicSnapshot | null } {
  return SCR_DrawCinematic_Impl(runtime, options);
}

/**
 * Original name: N/A
 * Source: N/A (screen refexport_t cinematic facade)
 * Category: Adapter
 * Adapts: SCR_DrawCinematicRef from packages/client/src/cl_cin.ts
 * Fidelity level: Close
 *
 * Behavior:
 * - Draws the active cinematic frame through `refexport_t`.
 */
export function SCR_DrawCinematicRef(
  runtime: ClientRuntime,
  ref: refexport_t,
  options: {
    viewportWidth: number;
    viewportHeight: number;
    keyDest?: "game" | "console" | "message" | "menu";
  }
): boolean {
  return SCR_DrawCinematicRef_Impl(runtime, ref, options);
}

/**
 * Original name: SCR_PlayCinematic
 * Source: client/screen.h
 * Category: Adapter
 * Fidelity level: Close
 *
 * Behavior:
 * - Starts one cinematic through the dedicated `cinematic.ts` port while preserving the `screen.h`-facing API.
 *
 * Porting notes:
 * - `screen.ts` stays a facade so the public screen module remains stable while `cl_cin.c` logic lives in its own file.
 */
export function SCR_PlayCinematic(runtime: ClientRuntime, arg: string, hooks: ClientScreenHooks = {}): boolean {
  return SCR_PlayCinematic_Impl(runtime, { SCR_BeginLoadingPlaque, SCR_EndLoadingPlaque }, arg, hooks);
}

/**
 * Original name: N/A
 * Source: N/A (screen snapshot helper)
 * Category: New
 * Purpose: Build the currently visible center-print snapshot without mutating timer state.
 */
function buildCenterPrintSnapshot(runtime: ClientRuntime): ClientCenterPrintState | null {
  if (runtime.cl.screen.scr_centertime_off <= 0 || runtime.cl.screen.scr_centerstring.length === 0) {
    return null;
  }

  return {
    text: runtime.cl.screen.scr_centerstring,
    lines: runtime.cl.screen.scr_center_lines,
    remainingMs: runtime.cl.screen.scr_centertime_off,
    startedAt: runtime.cl.screen.scr_centertime_start
  };
}

/**
 * Original name: N/A
 * Source: N/A (screen snapshot helper)
 * Category: New
 * Purpose: Build the loading-plaque snapshot corresponding to `SCR_DrawLoading`.
 */
function buildLoadingSnapshot(runtime: ClientRuntime): ClientLoadingOverlayState {
  return {
    visible: runtime.cl.screen.scr_draw_loading !== 0,
    drawFlag: runtime.cl.screen.scr_draw_loading,
    disableScreen: runtime.cls.disable_screen !== 0
  };
}

/**
 * Original name: N/A
 * Source: N/A (screen snapshot helper)
 * Category: New
 * Purpose: Build the pause-overlay snapshot corresponding to `SCR_DrawPause`.
 */
function buildPauseSnapshot(options: ClientScreenBuildOptions): ClientPauseOverlayState {
  return {
    visible: options.paused === true
  };
}

/**
 * Original name: SCR_CalcVrect
 * Source: client/cl_scrn.c
 * Category: Ported
 * Fidelity level: Close
 * Purpose: Compute the Quake II refresh rectangle from the current viewsize and viewport dimensions.
 *
 * Constraints:
 * - Must preserve the original clamping and alignment rules.
 */
function SCR_CalcVrect(runtime: ClientRuntime, viewportWidth: number, viewportHeight: number, viewsize: number): vrect_t {
  let size = viewsize;
  if (size < 40) {
    size = 40;
  }
  if (size > 100) {
    size = 100;
  }

  const width = (Math.trunc(viewportWidth * size / 100)) & ~7;
  const height = (Math.trunc(viewportHeight * size / 100)) & ~1;
  const vrect = {
    width,
    height,
    x: Math.trunc((viewportWidth - width) / 2),
    y: Math.trunc((viewportHeight - height) / 2)
  };

  runtime.cl.screen.scr_vrect = vrect;
  runtime.cl.screen.sb_lines = size === 100 ? 0 : 24;
  return vrect;
}

/**
 * Original name: N/A
 * Source: N/A (screen snapshot helper)
 * Category: New
 * Purpose: Build the net-warning snapshot corresponding to `SCR_DrawNet`.
 */
function buildNetSnapshot(options: ClientScreenBuildOptions): ClientNetOverlayState {
  const threshold = Math.max(1, (options.commandBackup ?? 64) - 1);
  const outgoingSequence = options.outgoingSequence;
  const incomingAcknowledged = options.incomingAcknowledged;
  const backlog =
    outgoingSequence !== undefined && incomingAcknowledged !== undefined
      ? outgoingSequence - incomingAcknowledged
      : 0;

  return {
    visible: backlog >= threshold,
    backlog,
    threshold
  };
}

/**
 * Original name: N/A
 * Source: N/A (screen snapshot helper)
 * Category: New
 * Purpose: Count the display lines of a center-print string using Quake-style newline rules.
 */
function countCenterLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  let lines = 1;
  for (const char of text) {
    if (char === "\n") {
      lines += 1;
    }
  }
  return lines;
}

/**
 * Original name: N/A
 * Source: N/A (HUD configstring helper)
 * Category: New
 * Purpose: Resolve one configstring-backed HUD reference safely.
 */
function resolveConfigstring(runtime: ClientRuntime, index: number | undefined): string | null {
  if (index === undefined || index <= 0 || index >= runtime.cl.configstrings.length) {
    return null;
  }

  const value = runtime.cl.configstrings[index];
  return value.length > 0 ? value : null;
}

/**
 * Original name: N/A
 * Source: N/A (HUD configstring helper)
 * Category: New
 * Purpose: Resolve one image-backed stat through the Quake II `CS_IMAGES` configstring range.
 */
function resolveImageStat(runtime: ClientRuntime, imageIndex: number | undefined): string | null {
  if (imageIndex === undefined || imageIndex <= 0) {
    return null;
  }

  return resolveConfigstring(runtime, CS_IMAGES + imageIndex);
}

/**
 * Original name: N/A
 * Source: N/A (HUD configstring helper)
 * Category: New
 * Purpose: Resolve the currently selected inventory item name through the `CS_ITEMS` configstring range.
 */
function resolveSelectedItemName(runtime: ClientRuntime, selectedItem: number | undefined): string | null {
  if (selectedItem === undefined || selectedItem < 0) {
    return null;
  }

  return resolveConfigstring(runtime, CS_ITEMS + selectedItem);
}

/**
 * Original name: N/A
 * Source: N/A (HUD text helper)
 * Category: New
 * Purpose: Apply the Quake II HUD XOR/high-bit transform to one string payload.
 */
function applyHudXor(text: string, xorMask: number): string {
  if (xorMask === 0) {
    return text;
  }

  let result = "";
  for (const char of text) {
    result += String.fromCharCode(char.charCodeAt(0) ^ xorMask);
  }
  return result;
}

/**
 * Original name: N/A
 * Source: N/A (HUD number helper)
 * Category: New
 * Purpose: Resolve one number-field digit to the corresponding Quake II HUD picture name.
 */
function mapHudDigitToPic(color: number): (char: string) => string {
  const colorIndex = color === 1 ? 1 : 0;
  const picBank = sb_nums[colorIndex];

  return (char: string): string => {
    const frame = char === "-" ? STAT_MINUS : Math.max(0, Math.min(9, char.charCodeAt(0) - 48));
    return picBank[frame];
  };
}

/**
 * Original name: N/A
 * Source: N/A (HUD layout parser)
 * Category: New
 * Purpose: Tokenize one Quake II HUD layout string while preserving quoted substrings.
 */
function tokenizeLayoutString(layout: string): string[] {
  const tokens: string[] = [];
  let index = 0;

  while (index < layout.length) {
    while (index < layout.length && /\s/.test(layout[index])) {
      index += 1;
    }

    if (index >= layout.length) {
      break;
    }

    if (layout[index] === "\"") {
      index += 1;
      let token = "";
      while (index < layout.length && layout[index] !== "\"") {
        token += layout[index];
        index += 1;
      }
      if (index < layout.length && layout[index] === "\"") {
        index += 1;
      }
      tokens.push(token);
      continue;
    }

    let token = "";
    while (index < layout.length && !/\s/.test(layout[index])) {
      token += layout[index];
      index += 1;
    }
    tokens.push(token);
  }

  return tokens;
}

/**
 * Original name: N/A
 * Source: N/A (HUD layout parser)
 * Category: New
 * Purpose: Skip one simple `if ... endif` branch using the same flat matching style as the original code path.
 */
function skipToEndif(tokens: string[], currentIndex: number): number {
  let index = currentIndex;
  while (index + 1 < tokens.length) {
    index += 1;
    if (tokens[index] === "endif") {
      return index;
    }
  }
  return tokens.length - 1;
}

/**
 * Original name: N/A
 * Source: N/A (HUD layout command helper)
 * Category: New
 * Purpose: Emit the draw commands corresponding to one `client` layout block.
 */
function executeClientLayoutBlock(
  runtime: ClientRuntime,
  context: ClientHudLayoutContext,
  commands: ClientHudDrawCommand[],
  tokens: string[],
  currentIndex: number
): number {
  let index = currentIndex;
  const x = context.viewportWidth / 2 - 160 + Number.parseInt(tokens[++index] ?? "0", 10);
  const y = context.viewportHeight / 2 - 120 + Number.parseInt(tokens[++index] ?? "0", 10);
  const clientIndex = Number.parseInt(tokens[++index] ?? "0", 10);
  const score = Number.parseInt(tokens[++index] ?? "0", 10);
  const ping = Number.parseInt(tokens[++index] ?? "0", 10);
  const time = Number.parseInt(tokens[++index] ?? "0", 10);

  if (clientIndex < 0 || clientIndex >= runtime.cl.clientinfo.length) {
    throw new Error(`client >= MAX_CLIENTS (${clientIndex})`);
  }

  let clientInfo = runtime.cl.clientinfo[clientIndex];
  if (!clientInfo.iconname) {
    clientInfo = runtime.cl.baseclientinfo;
  }

  if (clientInfo.iconname.length > 0) {
    commands.push(createPictureCommand(x, y, clientInfo.iconname));
  }

  commands.push(createTextCommand(x + 32, y, clientInfo.name, "alt"));
  commands.push(createTextCommand(x + 32, y + 8, "Score: ", "normal"));
  commands.push(createTextCommand(x + 32 + 7 * 8, y + 8, `${score}`, "alt"));
  commands.push(createTextCommand(x + 32, y + 16, `Ping:  ${ping}`, "normal"));
  commands.push(createTextCommand(x + 32, y + 24, `Time:  ${time}`, "normal"));

  return index;
}

/**
 * Original name: N/A
 * Source: N/A (HUD refexport_t layout helper)
 * Category: New
 * Purpose: Draw the contents of one `client` layout block through `refexport_t`.
 */
function executeClientLayoutBlockRef(
  runtime: ClientRuntime,
  ref: refexport_t,
  context: ClientHudLayoutContext,
  tokens: string[],
  currentIndex: number
): number {
  let index = currentIndex;
  const x = context.viewportWidth / 2 - 160 + Number.parseInt(tokens[++index] ?? "0", 10);
  const y = context.viewportHeight / 2 - 120 + Number.parseInt(tokens[++index] ?? "0", 10);
  const clientIndex = Number.parseInt(tokens[++index] ?? "0", 10);
  const score = Number.parseInt(tokens[++index] ?? "0", 10);
  const ping = Number.parseInt(tokens[++index] ?? "0", 10);
  const time = Number.parseInt(tokens[++index] ?? "0", 10);

  if (clientIndex < 0 || clientIndex >= runtime.cl.clientinfo.length) {
    throw new Error(`client >= MAX_CLIENTS (${clientIndex})`);
  }

  let clientInfo = runtime.cl.clientinfo[clientIndex];
  if (!clientInfo.iconname) {
    clientInfo = runtime.cl.baseclientinfo;
  }

  if (clientInfo.iconname.length > 0) {
    ref.DrawPic(x, y, clientInfo.iconname);
  }

  drawInlineStringRef(ref, x + 32, y, SetStringHighBit(clientInfo.name));
  drawInlineStringRef(ref, x + 32, y + 8, "Score: ");
  drawInlineStringRef(ref, x + 32 + 7 * 8, y + 8, SetStringHighBit(`${score}`));
  drawInlineStringRef(ref, x + 32, y + 16, `Ping:  ${ping}`);
  drawInlineStringRef(ref, x + 32, y + 24, `Time:  ${time}`);

  return index;
}

/**
 * Original name: N/A
 * Source: N/A (HUD layout command helper)
 * Category: New
 * Purpose: Emit the draw commands corresponding to one `ctf` layout block.
 */
function executeCtfLayoutBlock(
  runtime: ClientRuntime,
  context: ClientHudLayoutContext,
  commands: ClientHudDrawCommand[],
  tokens: string[],
  currentIndex: number
): number {
  let index = currentIndex;
  const x = context.viewportWidth / 2 - 160 + Number.parseInt(tokens[++index] ?? "0", 10);
  const y = context.viewportHeight / 2 - 120 + Number.parseInt(tokens[++index] ?? "0", 10);
  const clientIndex = Number.parseInt(tokens[++index] ?? "0", 10);
  const score = Number.parseInt(tokens[++index] ?? "0", 10);
  const ping = Math.min(999, Number.parseInt(tokens[++index] ?? "0", 10));

  if (clientIndex < 0 || clientIndex >= runtime.cl.clientinfo.length) {
    throw new Error(`client >= MAX_CLIENTS (${clientIndex})`);
  }

  const clientInfo = runtime.cl.clientinfo[clientIndex];
  const block = `${`${score}`.padStart(3, " ")} ${`${ping}`.padStart(3, " ")} ${clientInfo.name.padEnd(12, " ").slice(0, 12)}`;
  commands.push(createTextCommand(x, y, block, clientIndex === runtime.cl.playernum ? "alt" : "normal"));

  return index;
}

/**
 * Original name: N/A
 * Source: N/A (HUD refexport_t layout helper)
 * Category: New
 * Purpose: Draw the contents of one `ctf` layout block through `refexport_t`.
 */
function executeCtfLayoutBlockRef(
  runtime: ClientRuntime,
  ref: refexport_t,
  context: ClientHudLayoutContext,
  tokens: string[],
  currentIndex: number
): number {
  let index = currentIndex;
  const x = context.viewportWidth / 2 - 160 + Number.parseInt(tokens[++index] ?? "0", 10);
  const y = context.viewportHeight / 2 - 120 + Number.parseInt(tokens[++index] ?? "0", 10);
  const clientIndex = Number.parseInt(tokens[++index] ?? "0", 10);
  const score = Number.parseInt(tokens[++index] ?? "0", 10);
  const ping = Math.min(999, Number.parseInt(tokens[++index] ?? "0", 10));

  if (clientIndex < 0 || clientIndex >= runtime.cl.clientinfo.length) {
    throw new Error(`client >= MAX_CLIENTS (${clientIndex})`);
  }

  const clientInfo = runtime.cl.clientinfo[clientIndex];
  const block = `${`${score}`.padStart(3, " ")} ${`${ping}`.padStart(3, " ")} ${clientInfo.name.padEnd(12, " ").slice(0, 12)}`;
  drawInlineStringRef(ref, x, y, clientIndex === runtime.cl.playernum ? SetStringHighBit(block) : block);

  return index;
}

/**
 * Original name: N/A
 * Source: N/A (HUD refexport_t draw helper)
 * Category: New
 * Purpose: Draw one command-era HUD picture through `refexport_t` while preserving native sizing and centering.
 */
function drawPictureCommandRef(
  ref: refexport_t,
  command: ClientHudPictureCommand,
  viewportWidth: number,
  viewportHeight: number
): void {
  const requestedWidth = command.bounds.width;
  const requestedHeight = command.bounds.height;
  const needsSize = requestedWidth <= 0 || requestedHeight <= 0 || command.x < 0 || command.y < 0;
  const nativeSize = needsSize ? ref.DrawGetPicSize(command.pic) : { width: requestedWidth, height: requestedHeight };
  const width = requestedWidth > 0 ? requestedWidth : nativeSize.width;
  const height = requestedHeight > 0 ? requestedHeight : nativeSize.height;
  const x = command.x < 0 ? (viewportWidth - width) / 2 : command.x;
  const y = command.y < 0 ? (viewportHeight - height) / 2 : command.y;

  if (requestedWidth > 0 && requestedHeight > 0) {
    ref.DrawStretchPic(x, y, requestedWidth, requestedHeight, command.pic);
    return;
  }

  ref.DrawPic(x, y, command.pic);
}

/**
 * Original name: N/A
 * Source: N/A (HUD refexport_t text helper)
 * Category: New
 * Purpose: Draw one single-line string through `DrawChar`.
 */
function drawInlineStringRef(ref: refexport_t, x: number, y: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    ref.DrawChar(x + index * 8, y, text.charCodeAt(index) & 0xff);
  }
}

/**
 * Original name: N/A
 * Source: N/A (HUD draw-command factory)
 * Category: New
 * Purpose: Create one HUD picture command that defers to the original picture's native size.
 *
 * Constraints:
 * - Must preserve the `SCR_ExecuteLayoutString` coordinates exactly.
 * - Must let the renderer resolve the final width and height from the registered pic.
 */
function createPictureCommand(x: number, y: number, pic: string): ClientHudPictureCommand {
  return {
    type: "picture",
    x,
    y,
    pic,
    bounds: {
      x,
      y,
      width: 0,
      height: 0
    }
  };
}

/**
 * Original name: N/A
 * Source: N/A (HUD draw-command factory)
 * Category: New
 * Purpose: Create one HUD picture command that defers size resolution to the final Three.js texture.
 *
 * Constraints:
 * - `x = -1` centers horizontally.
 * - `y = -1` centers vertically.
 */
function createAutosizedPictureCommand(x: number, y: number, pic: string): ClientHudPictureCommand {
  return {
    type: "picture",
    x,
    y,
    pic,
    bounds: {
      x,
      y,
      width: 0,
      height: 0
    }
  };
}

/**
 * Original name: N/A
 * Source: N/A (HUD draw-command factory)
 * Category: New
 * Purpose: Create one plain HUD text command with the requested Quake-style variant.
 */
function createTextCommand(x: number, y: number, text: string, variant: "normal" | "alt"): ClientHudTextCommand {
  return {
    type: "text",
    x,
    y,
    text: variant === "alt" ? SetStringHighBit(text) : text,
    xorMask: variant === "alt" ? 0x80 : 0,
    centerWidth: 0,
    variant,
    bounds: {
      x,
      y,
      width: text.length * 8,
      height: 8
    }
  };
}
