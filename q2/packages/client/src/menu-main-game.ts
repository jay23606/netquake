/**
 * File: menu-main-game.ts
 * Source: Quake II original / client/menu.c
 * Purpose: Port the main menu and the `game/load/save` block from `menu.c`.
 */

import {
  Cbuf_AddText,
  Cvar_ForceSet,
  Cvar_SetValue
} from "../../qcommon/src/index.js";
import {
  K_DOWNARROW,
  K_ENTER,
  K_ESCAPE,
  K_KP_DOWNARROW,
  K_KP_ENTER,
  K_KP_UPARROW,
  K_UPARROW,
  keydest_t
} from "./keys.js";
import { M_Banner, M_DrawCursor } from "./menu-draw.js";
import { M_ForceMenuOff, M_PopMenu, M_PushMenu, Default_MenuKey } from "./menu-runtime.js";
import { M_Menu_Video_f, M_Menu_Quit_f } from "./menu-misc.js";
import { M_Menu_Multiplayer_f } from "./menu-multiplayer.js";
import { M_Menu_Options_f } from "./menu-options-keys.js";
import {
  MAIN_ITEMS,
  MAX_SAVEGAMES,
  menu_move_sound,
  menu_out_sound,
  NUM_CURSOR_FRAMES,
  getServerState,
  resetMenuFramework,
  syncMenuVideo
} from "./menu-types.js";
import type { ClientMenuContext } from "./menu-types.js";
import {
  Menu_AddItem,
  Menu_AdjustCursor,
  Menu_Center,
  Menu_Draw,
  QMF_LEFT_JUSTIFY,
  MTYPE_ACTION,
  MTYPE_SEPARATOR
} from "./qmenu.js";

/**
 * Original name: M_Main_Draw
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function M_Main_Draw(context: ClientMenuContext): void {
  const names = [
    "m_main_game",
    "m_main_multiplayer",
    "m_main_options",
    "m_main_video",
    "m_main_quit"
  ];

  let widest = -1;

  for (const name of names) {
    const size = context.ref.DrawGetPicSize(name);
    if (size.width > widest) {
      widest = size.width;
    }
  }

  const ystart = Math.trunc(context.vid.viddef.height / 2 - 110);
  const xoffset = Math.trunc((context.vid.viddef.width - widest + 70) / 2);

  for (let i = 0; i < names.length; i += 1) {
    if (i !== context.state.m_main_cursor) {
      context.ref.DrawPic(xoffset, ystart + i * 40 + 13, names[i]);
    }
  }

  context.ref.DrawPic(
    xoffset,
    ystart + context.state.m_main_cursor * 40 + 13,
    `${names[context.state.m_main_cursor]}_sel`
  );

  M_DrawCursor(
    context,
    xoffset - 25,
    ystart + context.state.m_main_cursor * 40 + 11,
    Math.trunc(context.client.cls.realtime / 100) % NUM_CURSOR_FRAMES
  );

  const plaqueSize = context.ref.DrawGetPicSize("m_main_plaque");
  context.ref.DrawPic(xoffset - 30 - plaqueSize.width, ystart, "m_main_plaque");
  context.ref.DrawPic(xoffset - 30 - plaqueSize.width, ystart + plaqueSize.height + 5, "m_main_logo");
}

/**
 * Original name: M_Main_Key
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Close
 */
export function M_Main_Key(context: ClientMenuContext, key: number): string | null {
  switch (key) {
    case K_ESCAPE:
      M_PopMenu(context);
      break;

    case K_KP_DOWNARROW:
    case K_DOWNARROW:
      context.state.m_main_cursor += 1;
      if (context.state.m_main_cursor >= MAIN_ITEMS) {
        context.state.m_main_cursor = 0;
      }
      return menu_move_sound;

    case K_KP_UPARROW:
    case K_UPARROW:
      context.state.m_main_cursor -= 1;
      if (context.state.m_main_cursor < 0) {
        context.state.m_main_cursor = MAIN_ITEMS - 1;
      }
      return menu_move_sound;

    case K_KP_ENTER:
    case K_ENTER:
      context.state.m_entersound = true;

      switch (context.state.m_main_cursor) {
        case 0:
          M_Menu_Game_f(context);
          break;
        case 1:
          M_Menu_Multiplayer_f(context);
          break;
        case 2:
          M_Menu_Options_f(context);
          break;
        case 3:
          M_Menu_Video_f(context);
          break;
        case 4:
          M_Menu_Quit_f(context);
          break;
        default:
          break;
      }
      break;
    default:
      break;
  }

  return null;
}

/**
 * Original name: M_Menu_Main_f
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function M_Menu_Main_f(context: ClientMenuContext): void {
  M_PushMenu(
    context,
    () => M_Main_Draw(context),
    (key) => M_Main_Key(context, key)
  );
}

/**
 * Original name: StartGame
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Starts a new single-player game through the original command chain.
 *
 * Porting notes:
 * - Uses the explicit command/cvar/key contexts instead of file globals.
 */
function StartGame(context: ClientMenuContext): void {
  context.client.cl.servercount = -1;
  M_ForceMenuOff(context);
  Cvar_SetValue(context.cvar, "deathmatch", 0);
  Cvar_SetValue(context.cvar, "coop", 0);
  Cvar_SetValue(context.cvar, "gamerules", 0);
  Cbuf_AddText(context.cmd, "loading ; killserver ; wait ; newgame\n");
  context.keys.state.key_dest = keydest_t.key_game;
}

/**
 * Original name: EasyGameFunc
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function EasyGameFunc(context: ClientMenuContext): void {
  Cvar_ForceSet(context.cvar, "skill", "0");
  StartGame(context);
}

/**
 * Original name: MediumGameFunc
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function MediumGameFunc(context: ClientMenuContext): void {
  Cvar_ForceSet(context.cvar, "skill", "1");
  StartGame(context);
}

/**
 * Original name: HardGameFunc
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function HardGameFunc(context: ClientMenuContext): void {
  Cvar_ForceSet(context.cvar, "skill", "2");
  StartGame(context);
}

/**
 * Original name: LoadGameFunc
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function LoadGameFunc(context: ClientMenuContext): void {
  M_Menu_LoadGame_f(context);
}

/**
 * Original name: SaveGameFunc
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function SaveGameFunc(context: ClientMenuContext): void {
  M_Menu_SaveGame_f(context);
}

/**
 * Original name: CreditsFunc
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function CreditsFunc(context: ClientMenuContext): void {
  M_Menu_Credits_f(context);
}

/**
 * Original name: idcredits
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export const idcredits = [
  "+QUAKE II BY ID SOFTWARE",
  "",
  "+PROGRAMMING",
  "John Carmack",
  "John Cash",
  "Brian Hook",
  "",
  "+ART",
  "Adrian Carmack",
  "Kevin Cloud",
  "Paul Steed",
  "",
  "+LEVEL DESIGN",
  "Tim Willits",
  "American McGee",
  "Christian Antkow",
  "Paul Jaquays",
  "Brandon James",
  "",
  "+BIZ",
  "Todd Hollenshead",
  "Barrett (Bear) Alexander",
  "Donna Jackson",
  "",
  "",
  "+SPECIAL THANKS",
  "Ben Donges for beta testing",
  "",
  "",
  "",
  "",
  "",
  "",
  "+ADDITIONAL SUPPORT",
  "",
  "+LINUX PORT AND CTF",
  "Dave \"Zoid\" Kirsch",
  "",
  "+CINEMATIC SEQUENCES",
  "Ending Cinematic by Blur Studio - ",
  "Venice, CA",
  "",
  "Environment models for Introduction",
  "Cinematic by Karl Dolgener",
  "",
  "Assistance with environment design",
  "by Cliff Iwai",
  "",
  "+SOUND EFFECTS AND MUSIC",
  "Sound Design by Soundelux Media Labs.",
  "Music Composed and Produced by",
  "Soundelux Media Labs.  Special thanks",
  "to Bill Brown, Tom Ozanich, Brian",
  "Celano, Jeff Eisner, and The Soundelux",
  "Players.",
  "",
  "\"Level Music\" by Sonic Mayhem",
  "www.sonicmayhem.com",
  "",
  "\"Quake II Theme Song\"",
  "(C) 1997 Rob Zombie. All Rights",
  "Reserved.",
  "",
  "Track 10 (\"Climb\") by Jer Sypult",
  "",
  "Voice of computers by",
  "Carly Staehlin-Taylor",
  "",
  "+THANKS TO ACTIVISION",
  "+IN PARTICULAR:",
  "",
  "John Tam",
  "Steve Rosenthal",
  "Marty Stratton",
  "Henk Hartong",
  "",
  "Quake II(tm) (C)1997 Id Software, Inc.",
  "All Rights Reserved.  Distributed by",
  "Activision, Inc. under license.",
  "Quake II(tm), the Id Software name,",
  "the \"Q II\"(tm) logo and id(tm)",
  "logo are trademarks of Id Software,",
  "Inc. Activision(R) is a registered",
  "trademark of Activision, Inc. All",
  "other trademarks and trade names are",
  "properties of their respective owners.",
  null
];

/**
 * Original name: xatcredits
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export const xatcredits = [
  "+QUAKE II MISSION PACK: THE RECKONING",
  "+BY",
  "+XATRIX ENTERTAINMENT, INC.",
  "",
  "+DESIGN AND DIRECTION",
  "Drew Markham",
  "",
  "+PRODUCED BY",
  "Greg Goodrich",
  "",
  "+PROGRAMMING",
  "Rafael Paiz",
  "",
  "+LEVEL DESIGN / ADDITIONAL GAME DESIGN",
  "Alex Mayberry",
  "",
  "+LEVEL DESIGN",
  "Mal Blackwell",
  "Dan Koppel",
  "",
  "+ART DIRECTION",
  "Michael \"Maxx\" Kaufman",
  "",
  "+COMPUTER GRAPHICS SUPERVISOR AND",
  "+CHARACTER ANIMATION DIRECTION",
  "Barry Dempsey",
  "",
  "+SENIOR ANIMATOR AND MODELER",
  "Jason Hoover",
  "",
  "+CHARACTER ANIMATION AND",
  "+MOTION CAPTURE SPECIALIST",
  "Amit Doron",
  "",
  "+ART",
  "Claire Praderie-Markham",
  "Viktor Antonov",
  "Corky Lehmkuhl",
  "",
  "+INTRODUCTION ANIMATION",
  "Dominique Drozdz",
  "",
  "+ADDITIONAL LEVEL DESIGN",
  "Aaron Barber",
  "Rhett Baldwin",
  "",
  "+3D CHARACTER ANIMATION TOOLS",
  "Gerry Tyra, SA Technology",
  "",
  "+ADDITIONAL EDITOR TOOL PROGRAMMING",
  "Robert Duffy",
  "",
  "+ADDITIONAL PROGRAMMING",
  "Ryan Feltrin",
  "",
  "+PRODUCTION COORDINATOR",
  "Victoria Sylvester",
  "",
  "+SOUND DESIGN",
  "Gary Bradfield",
  "",
  "+MUSIC BY",
  "Sonic Mayhem",
  "",
  "",
  "",
  "+SPECIAL THANKS",
  "+TO",
  "+OUR FRIENDS AT ID SOFTWARE",
  "",
  "John Carmack",
  "John Cash",
  "Brian Hook",
  "Adrian Carmack",
  "Kevin Cloud",
  "Paul Steed",
  "Tim Willits",
  "Christian Antkow",
  "Paul Jaquays",
  "Brandon James",
  "Todd Hollenshead",
  "Barrett (Bear) Alexander",
  "Dave \"Zoid\" Kirsch",
  "Donna Jackson",
  "",
  "",
  "",
  "+THANKS TO ACTIVISION",
  "+IN PARTICULAR:",
  "",
  "Marty Stratton",
  "Henk \"The Original Ripper\" Hartong",
  "Kevin Kraff",
  "Jamey Gottlieb",
  "Chris Hepburn",
  "",
  "+AND THE GAME TESTERS",
  "",
  "Tim Vanlaw",
  "Doug Jacobs",
  "Steven Rosenthal",
  "David Baker",
  "Chris Campbell",
  "Aaron Casillas",
  "Steve Elwell",
  "Derek Johnstone",
  "Igor Krinitskiy",
  "Samantha Lee",
  "Michael Spann",
  "Chris Toft",
  "Juan Valdes",
  "",
  "+THANKS TO INTERGRAPH COMPUTER SYTEMS",
  "+IN PARTICULAR:",
  "",
  "Michael T. Nicolaou",
  "",
  "",
  "Quake II Mission Pack: The Reckoning",
  "(tm) (C)1998 Id Software, Inc. All",
  "Rights Reserved. Developed by Xatrix",
  "Entertainment, Inc. for Id Software,",
  "Inc. Distributed by Activision Inc.",
  "under license. Quake(R) is a",
  "registered trademark of Id Software,",
  "Inc. Quake II Mission Pack: The",
  "Reckoning(tm), Quake II(tm), the Id",
  "Software name, the \"Q II\"(tm) logo",
  "and id(tm) logo are trademarks of Id",
  "Software, Inc. Activision(R) is a",
  "registered trademark of Activision,",
  "Inc. Xatrix(R) is a registered",
  "trademark of Xatrix Entertainment,",
  "Inc. All other trademarks and trade",
  "names are properties of their",
  "respective owners.",
  null
];

/**
 * Original name: roguecredits
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export const roguecredits = [
  "+QUAKE II MISSION PACK 2: GROUND ZERO",
  "+BY",
  "+ROGUE ENTERTAINMENT, INC.",
  "",
  "+PRODUCED BY",
  "Jim Molinets",
  "",
  "+PROGRAMMING",
  "Peter Mack",
  "Patrick Magruder",
  "",
  "+LEVEL DESIGN",
  "Jim Molinets",
  "Cameron Lamprecht",
  "Berenger Fish",
  "Robert Selitto",
  "Steve Tietze",
  "Steve Thoms",
  "",
  "+ART DIRECTION",
  "Rich Fleider",
  "",
  "+ART",
  "Rich Fleider",
  "Steve Maines",
  "Won Choi",
  "",
  "+ANIMATION SEQUENCES",
  "Creat Studios",
  "Steve Maines",
  "",
  "+ADDITIONAL LEVEL DESIGN",
  "Rich Fleider",
  "Steve Maines",
  "Peter Mack",
  "",
  "+SOUND",
  "James Grunke",
  "",
  "+GROUND ZERO THEME",
  "+AND",
  "+MUSIC BY",
  "Sonic Mayhem",
  "",
  "+VWEP MODELS",
  "Brent \"Hentai\" Dill",
  "",
  "",
  "",
  "+SPECIAL THANKS",
  "+TO",
  "+OUR FRIENDS AT ID SOFTWARE",
  "",
  "John Carmack",
  "John Cash",
  "Brian Hook",
  "Adrian Carmack",
  "Kevin Cloud",
  "Paul Steed",
  "Tim Willits",
  "Christian Antkow",
  "Paul Jaquays",
  "Brandon James",
  "Todd Hollenshead",
  "Barrett (Bear) Alexander",
  "Katherine Anna Kang",
  "Donna Jackson",
  "Dave \"Zoid\" Kirsch",
  "",
  "",
  "",
  "+THANKS TO ACTIVISION",
  "+IN PARTICULAR:",
  "",
  "Marty Stratton",
  "Henk Hartong",
  "Mitch Lasky",
  "Steve Rosenthal",
  "Steve Elwell",
  "",
  "+AND THE GAME TESTERS",
  "",
  "The Ranger Clan",
  "Dave \"Zoid\" Kirsch",
  "Nihilistic Software",
  "Robert Duffy",
  "",
  "And Countless Others",
  "",
  "",
  "",
  "Quake II Mission Pack 2: Ground Zero",
  "(tm) (C)1998 Id Software, Inc. All",
  "Rights Reserved. Developed by Rogue",
  "Entertainment, Inc. for Id Software,",
  "Inc. Distributed by Activision Inc.",
  "under license. Quake(R) is a",
  "registered trademark of Id Software,",
  "Inc. Quake II Mission Pack 2: Ground",
  "Zero(tm), Quake II(tm), the Id",
  "Software name, the \"Q II\"(tm) logo",
  "and id(tm) logo are trademarks of Id",
  "Software, Inc. Activision(R) is a",
  "registered trademark of Activision,",
  "Inc. Rogue(R) is a registered",
  "trademark of Rogue Entertainment,",
  "Inc. All other trademarks and trade",
  "names are properties of their",
  "respective owners.",
  null
];

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose:
 * - Extracts the source-style CR/LF credits parsing used by `M_Menu_Credits_f`.
 */
function parseCreditsBuffer(context: ClientMenuContext, text: string): Array<string | null> {
  const lines = context.state.creditsIndex;
  lines.fill(null);

  let p = 0;
  let count = text.length;
  let n = 0;

  for (; n < 255; n += 1) {
    const start = p;

    while (p < text.length && text.charCodeAt(p) !== 13 && text.charCodeAt(p) !== 10) {
      p += 1;
      count -= 1;
      if (count === 0) {
        break;
      }
    }

    lines[n] = text.slice(start, p);

    if (p < text.length && text.charCodeAt(p) === 13) {
      p += 1;
      count -= 1;
      if (count === 0) {
        break;
      }
    }

    p += 1;
    count -= 1;
    if (count <= 0) {
      break;
    }
  }

  lines[n + 1] = null;
  return lines;
}

/**
 * Original name: Developer_searchpath
 * Source: Quake-2-master/qcommon/files.c
 * Category: Adapter
 * Fidelity level: Adapter
 *
 * Porting notes:
 * - Local menu adapter to the host hook; the owning port is in `packages/filesystem/src/files.ts`.
 */
function Developer_searchpath(context: ClientMenuContext, who: number): number {
  return context.hooks.getDeveloperSearchpath?.(who) ?? 0;
}

/**
 * Original name: M_Credits_MenuDraw
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function M_Credits_MenuDraw(context: ClientMenuContext): void {
  let y = Math.trunc(context.vid.viddef.height - ((context.client.cls.realtime - context.state.credits_start_time) / 40.0));
  let i = 0;

  for (; context.state.credits[i] !== null && y < context.vid.viddef.height; y += 10, i += 1) {
    const line = context.state.credits[i] ?? "";
    let stringoffset = 0;
    let bold = false;

    if (y <= -8) {
      continue;
    }

    if (line[0] === "+") {
      bold = true;
      stringoffset = 1;
    }

    for (let j = 0; j + stringoffset < line.length; j += 1) {
      const x = Math.trunc(
        (context.vid.viddef.width - line.length * 8 - stringoffset * 8) / 2 + (j + stringoffset) * 8
      );
      const code = line.charCodeAt(j + stringoffset);
      context.ref.DrawChar(x, y, bold ? code + 128 : code);
    }
  }

  if (y < 0) {
    context.state.credits_start_time = context.client.cls.realtime;
  }
}

/**
 * Original name: M_Credits_Key
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Porting notes:
 * - `creditsBuffer` is a JS string owned by the menu state, so releasing the C buffer maps to clearing that state.
 */
export function M_Credits_Key(context: ClientMenuContext, key: number): string | null {
  if (key === K_ESCAPE) {
    context.state.creditsBuffer = null;
    context.state.creditsIndex.fill(null);
    M_PopMenu(context);
  }

  return menu_out_sound;
}

/**
 * Original name: M_Menu_Credits_f
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Porting notes:
 * - Uses `getCreditsText` as the host/filesystem replacement for `FS_LoadFile("credits", &creditsBuffer)`.
 * - Uses `getDeveloperSearchpath(1)` as the replacement for the original `Developer_searchpath(1)`.
 */
export function M_Menu_Credits_f(context: ClientMenuContext): void {
  const loadedCredits = context.hooks.getCreditsText?.() ?? null;

  context.state.creditsBuffer = null;
  if (loadedCredits !== null) {
    context.state.creditsBuffer = loadedCredits;
    context.state.credits = parseCreditsBuffer(context, loadedCredits);
  } else {
    const isdeveloper = Developer_searchpath(context, 1);

    if (isdeveloper === 1) {
      context.state.credits = xatcredits;
    } else if (isdeveloper === 2) {
      context.state.credits = roguecredits;
    } else {
      context.state.credits = idcredits;
    }
  }

  context.state.credits_start_time = context.client.cls.realtime;
  M_PushMenu(
    context,
    () => M_Credits_MenuDraw(context),
    (key) => M_Credits_Key(context, key)
  );
}

/**
 * Original name: Game_MenuInit
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Close
 */
export function Game_MenuInit(context: ClientMenuContext): void {
  syncMenuVideo(context);

  const menu = context.state.s_game_menu;
  menu.x = context.vid.viddef.width * 0.5;
  resetMenuFramework(menu);

  const easy = context.state.s_easy_game_action;
  easy.generic.type = MTYPE_ACTION;
  easy.generic.flags = QMF_LEFT_JUSTIFY;
  easy.generic.x = 0;
  easy.generic.y = 0;
  easy.generic.name = "easy";
  easy.generic.callback = () => {
    EasyGameFunc(context);
  };

  const medium = context.state.s_medium_game_action;
  medium.generic.type = MTYPE_ACTION;
  medium.generic.flags = QMF_LEFT_JUSTIFY;
  medium.generic.x = 0;
  medium.generic.y = 10;
  medium.generic.name = "medium";
  medium.generic.callback = () => {
    MediumGameFunc(context);
  };

  const hard = context.state.s_hard_game_action;
  hard.generic.type = MTYPE_ACTION;
  hard.generic.flags = QMF_LEFT_JUSTIFY;
  hard.generic.x = 0;
  hard.generic.y = 20;
  hard.generic.name = "hard";
  hard.generic.callback = () => {
    HardGameFunc(context);
  };

  const blank = context.state.s_blankline;
  blank.generic.type = MTYPE_SEPARATOR;
  blank.generic.name = null;
  blank.generic.x = 0;
  blank.generic.y = 0;

  const load = context.state.s_load_game_action;
  load.generic.type = MTYPE_ACTION;
  load.generic.flags = QMF_LEFT_JUSTIFY;
  load.generic.x = 0;
  load.generic.y = 40;
  load.generic.name = "load game";
  load.generic.callback = () => {
    LoadGameFunc(context);
  };

  const save = context.state.s_save_game_action;
  save.generic.type = MTYPE_ACTION;
  save.generic.flags = QMF_LEFT_JUSTIFY;
  save.generic.x = 0;
  save.generic.y = 50;
  save.generic.name = "save game";
  save.generic.callback = () => {
    SaveGameFunc(context);
  };

  const credits = context.state.s_credits_action;
  credits.generic.type = MTYPE_ACTION;
  credits.generic.flags = QMF_LEFT_JUSTIFY;
  credits.generic.x = 0;
  credits.generic.y = 60;
  credits.generic.name = "credits";
  credits.generic.callback = () => {
    CreditsFunc(context);
  };

  Menu_AddItem(context.qmenu, menu, easy);
  Menu_AddItem(context.qmenu, menu, medium);
  Menu_AddItem(context.qmenu, menu, hard);
  Menu_AddItem(context.qmenu, menu, blank);
  Menu_AddItem(context.qmenu, menu, load);
  Menu_AddItem(context.qmenu, menu, save);
  Menu_AddItem(context.qmenu, menu, blank);
  Menu_AddItem(context.qmenu, menu, credits);
  Menu_Center(context.qmenu, menu);
}

/**
 * Original name: Game_MenuDraw
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function Game_MenuDraw(context: ClientMenuContext): void {
  syncMenuVideo(context);
  M_Banner(context, "m_banner_game");
  Menu_AdjustCursor(context.qmenu, context.state.s_game_menu, 1);
  Menu_Draw(context.qmenu, context.state.s_game_menu);
}

/**
 * Original name: Game_MenuKey
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function Game_MenuKey(context: ClientMenuContext, key: number): string | null {
  return Default_MenuKey(context, context.state.s_game_menu, key);
}

/**
 * Original name: M_Menu_Game_f
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Close
 */
export function M_Menu_Game_f(context: ClientMenuContext): void {
  Game_MenuInit(context);
  M_PushMenu(
    context,
    () => Game_MenuDraw(context),
    (key) => Game_MenuKey(context, key)
  );
  context.state.m_game_cursor = 1;
}

/**
 * Original name: Create_Savestrings
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Porting notes:
 * - Uses an explicit host hook instead of directly reading `server.ssv` files.
 */
export function Create_Savestrings(context: ClientMenuContext): void {
  const slots = context.hooks.getSaveSlots?.() ?? null;

  for (let i = 0; i < MAX_SAVEGAMES; i += 1) {
    const slot = slots?.[i] ?? null;

    if (!slot) {
      context.state.m_savestrings[i] = "<EMPTY>";
      context.state.m_savevalid[i] = false;
      continue;
    }

    context.state.m_savestrings[i] = slot.label;
    context.state.m_savevalid[i] = slot.valid;
  }
}

/**
 * Original name: LoadGameCallback
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Porting notes:
 * - Receives the slot number directly from the closure instead of reading `generic.localdata` through a void pointer.
 */
function LoadGameCallback(context: ClientMenuContext, slot: number): void {
  if (context.state.m_savevalid[slot]) {
    Cbuf_AddText(context.cmd, `load save${slot}\n`);
  }
  M_ForceMenuOff(context);
}

/**
 * Original name: LoadGame_MenuInit
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Close
 */
export function LoadGame_MenuInit(context: ClientMenuContext): void {
  syncMenuVideo(context);

  const menu = context.state.s_loadgame_menu;
  menu.x = Math.trunc(context.vid.viddef.width / 2 - 120);
  menu.y = Math.trunc(context.vid.viddef.height / 2 - 58);
  resetMenuFramework(menu);

  Create_Savestrings(context);

  for (let i = 0; i < MAX_SAVEGAMES; i += 1) {
    const action = context.state.s_loadgame_actions[i];
    action.generic.name = context.state.m_savestrings[i];
    action.generic.flags = QMF_LEFT_JUSTIFY;
    action.generic.localdata[0] = i;
    action.generic.callback = () => {
      LoadGameCallback(context, i);
    };
    action.generic.x = 0;
    action.generic.y = i * 10 + (i > 0 ? 10 : 0);
    action.generic.type = MTYPE_ACTION;

    Menu_AddItem(context.qmenu, menu, action);
  }
}

/**
 * Original name: LoadGame_MenuDraw
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function LoadGame_MenuDraw(context: ClientMenuContext): void {
  syncMenuVideo(context);
  M_Banner(context, "m_banner_load_game");
  Menu_Draw(context.qmenu, context.state.s_loadgame_menu);
}

/**
 * Original name: LoadGame_MenuKey
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function LoadGame_MenuKey(context: ClientMenuContext, key: number): string | null {
  if (key === K_ESCAPE || key === K_ENTER) {
    context.state.s_savegame_menu.cursor = context.state.s_loadgame_menu.cursor - 1;
    if (context.state.s_savegame_menu.cursor < 0) {
      context.state.s_savegame_menu.cursor = 0;
    }
  }

  return Default_MenuKey(context, context.state.s_loadgame_menu, key);
}

/**
 * Original name: M_Menu_LoadGame_f
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function M_Menu_LoadGame_f(context: ClientMenuContext): void {
  LoadGame_MenuInit(context);
  M_PushMenu(
    context,
    () => LoadGame_MenuDraw(context),
    (key) => LoadGame_MenuKey(context, key)
  );
}

/**
 * Original name: SaveGameCallback
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Porting notes:
 * - Receives the slot number directly from the closure instead of reading `generic.localdata` through a void pointer.
 */
function SaveGameCallback(context: ClientMenuContext, slot: number): void {
  Cbuf_AddText(context.cmd, `save save${slot}\n`);
  M_ForceMenuOff(context);
}

/**
 * Original name: SaveGame_MenuDraw
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
function SaveGame_MenuDraw(context: ClientMenuContext): void {
  syncMenuVideo(context);
  M_Banner(context, "m_banner_save_game");
  Menu_AdjustCursor(context.qmenu, context.state.s_savegame_menu, 1);
  Menu_Draw(context.qmenu, context.state.s_savegame_menu);
}

/**
 * Original name: SaveGame_MenuInit
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Close
 */
export function SaveGame_MenuInit(context: ClientMenuContext): void {
  syncMenuVideo(context);

  const menu = context.state.s_savegame_menu;
  menu.x = Math.trunc(context.vid.viddef.width / 2 - 120);
  menu.y = Math.trunc(context.vid.viddef.height / 2 - 58);
  resetMenuFramework(menu);

  Create_Savestrings(context);

  for (let i = 0; i < MAX_SAVEGAMES - 1; i += 1) {
    const action = context.state.s_savegame_actions[i];
    action.generic.name = context.state.m_savestrings[i + 1];
    action.generic.localdata[0] = i + 1;
    action.generic.flags = QMF_LEFT_JUSTIFY;
    action.generic.callback = () => {
      SaveGameCallback(context, i + 1);
    };
    action.generic.x = 0;
    action.generic.y = i * 10;
    action.generic.type = MTYPE_ACTION;

    Menu_AddItem(context.qmenu, menu, action);
  }
}

/**
 * Original name: SaveGame_MenuKey
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function SaveGame_MenuKey(context: ClientMenuContext, key: number): string | null {
  if (key === K_ENTER || key === K_ESCAPE) {
    context.state.s_loadgame_menu.cursor = context.state.s_savegame_menu.cursor - 1;
    if (context.state.s_loadgame_menu.cursor < 0) {
      context.state.s_loadgame_menu.cursor = 0;
    }
  }

  return Default_MenuKey(context, context.state.s_savegame_menu, key);
}

/**
 * Original name: M_Menu_SaveGame_f
 * Source: client/menu.c
 * Category: Ported
 * Fidelity level: Strict
 */
export function M_Menu_SaveGame_f(context: ClientMenuContext): void {
  if (getServerState(context) === 0) {
    return;
  }

  SaveGame_MenuInit(context);
  M_PushMenu(
    context,
    () => SaveGame_MenuDraw(context),
    (key) => SaveGame_MenuKey(context, key)
  );
  Create_Savestrings(context);
}
