/**
 * File: keymap.ts
 * Purpose: Convert browser keyboard events to Quake II key numbers for web-app input.
 */

import {
  K_ALT,
  K_BACKSPACE,
  K_CTRL,
  K_DEL,
  K_DOWNARROW,
  K_END,
  K_ENTER,
  K_ESCAPE,
  K_F1,
  K_HOME,
  K_INS,
  K_KP_DEL,
  K_KP_DOWNARROW,
  K_KP_END,
  K_KP_ENTER,
  K_KP_HOME,
  K_KP_INS,
  K_KP_LEFTARROW,
  K_KP_MINUS,
  K_KP_PGDN,
  K_KP_PGUP,
  K_KP_PLUS,
  K_KP_RIGHTARROW,
  K_KP_SLASH,
  K_KP_UPARROW,
  K_LEFTARROW,
  K_PAUSE,
  K_PGDN,
  K_PGUP,
  K_RIGHTARROW,
  K_SHIFT,
  K_SPACE,
  K_TAB,
  K_UPARROW
} from "../../../packages/client/src/keys.js";

export interface WebAppKeyboardEventLike {
  key: string;
  code: string;
  location: number;
}

const DOM_KEY_LOCATION_NUMPAD = 3;

export function mapWebAppDomKey(event: WebAppKeyboardEventLike): number | null {
  const functionKey = mapFunctionKey(event.key);
  if (functionKey !== null) {
    return functionKey;
  }

  const topRowDigit = mapTopRowDigitKey(event);
  if (topRowDigit !== null) {
    return topRowDigit;
  }

  switch (event.key) {
    case "Escape": return K_ESCAPE;
    case "Enter": return event.location === DOM_KEY_LOCATION_NUMPAD ? K_KP_ENTER : K_ENTER;
    case "Tab": return K_TAB;
    case "Backspace": return K_BACKSPACE;
    case "Delete": return event.location === DOM_KEY_LOCATION_NUMPAD ? K_KP_DEL : K_DEL;
    case "Home": return event.location === DOM_KEY_LOCATION_NUMPAD ? K_KP_HOME : K_HOME;
    case "End": return event.location === DOM_KEY_LOCATION_NUMPAD ? K_KP_END : K_END;
    case "PageUp": return event.location === DOM_KEY_LOCATION_NUMPAD ? K_KP_PGUP : K_PGUP;
    case "PageDown": return event.location === DOM_KEY_LOCATION_NUMPAD ? K_KP_PGDN : K_PGDN;
    case "Insert": return event.location === DOM_KEY_LOCATION_NUMPAD ? K_KP_INS : K_INS;
    case "Shift": return K_SHIFT;
    case "Control": return K_CTRL;
    case "Alt": return K_ALT;
    case "Pause": return K_PAUSE;
    case " ": return K_SPACE;
    case "ArrowUp": return event.location === DOM_KEY_LOCATION_NUMPAD ? K_KP_UPARROW : K_UPARROW;
    case "ArrowDown": return event.location === DOM_KEY_LOCATION_NUMPAD ? K_KP_DOWNARROW : K_DOWNARROW;
    case "ArrowLeft": return event.location === DOM_KEY_LOCATION_NUMPAD ? K_KP_LEFTARROW : K_LEFTARROW;
    case "ArrowRight": return event.location === DOM_KEY_LOCATION_NUMPAD ? K_KP_RIGHTARROW : K_RIGHTARROW;
    case "/": return event.location === DOM_KEY_LOCATION_NUMPAD ? K_KP_SLASH : "/".charCodeAt(0);
    case "-": return event.location === DOM_KEY_LOCATION_NUMPAD ? K_KP_MINUS : "-".charCodeAt(0);
    case "+": return event.location === DOM_KEY_LOCATION_NUMPAD ? K_KP_PLUS : "+".charCodeAt(0);
    default:
      return mapPrintableDomKey(event);
  }
}

function mapFunctionKey(key: string): number | null {
  const match = /^F(\d{1,2})$/.exec(key);
  if (!match) {
    return null;
  }

  const index = Number.parseInt(match[1], 10);
  return index >= 1 && index <= 12 ? K_F1 + index - 1 : null;
}

function mapTopRowDigitKey(event: WebAppKeyboardEventLike): number | null {
  const digitMatch = /^Digit(\d)$/.exec(event.code);
  return digitMatch ? digitMatch[1]!.charCodeAt(0) : null;
}

function mapPrintableDomKey(event: WebAppKeyboardEventLike): number | null {
  if (event.key.length !== 1) {
    return null;
  }

  const key = event.key.toLowerCase();
  if (key.length !== 1) {
    return null;
  }

  return key.charCodeAt(0);
}
