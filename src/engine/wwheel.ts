import * as com from './com'
import * as con from './console'
import * as q from './q'

// One `slot N { ... }` block of a 2021-rerelease wwheel.txt, reduced to the fields the status
// bar consumes.
export type WeaponSlot = {
  impulse: number
  // `weaponnum`: the .items bitmask this weapon occupies.
  weaponBit: number
  // Unselected / selected HUD pics, full paths to .lmp files (e.g. gfx/weapons/foo_1.lmp).
  icon: string
  iconSel: string
}

type WWheelState = {
  slots: WeaponSlot[]
}

export const state: WWheelState = {
  slots: []
};

// Keys FTE understands but we have no use for; listed so genuinely unknown keys still warn.
const IGNORED_KEYS = ['ammoicon', 'entvaroffs', 'ammostat', 'ammomin', 'viewmodel', 'shortname'];

// FTE IN_RegisterWeapon: slots are unique by impulse, a repeated impulse replaces.
const registerWeapon = function(slot: WeaponSlot)
{
  if ((slot.impulse <= 0) || (slot.impulse > 255))
    return;
  for (var i = 0; i < state.slots.length; ++i)
  {
    if (state.slots[i].impulse === slot.impulse)
    {
      state.slots[i] = slot;
      return;
    }
  }
  state.slots[state.slots.length] = slot;
};

// Port of FTE IN_RegisterWeapon_Reset (cl_input.c:374). A missing file — every non-rerelease mod
// — is a silent no-op; FTE's hardcoded id1 fallback set exists only to drive its weapon wheel,
// which we don't have.
export const load = async function()
{
  state.slots.length = 0;
  const text = await com.loadTextFile('wwheel.txt');
  if (text == null)
    return;
  const lines = text.split('\n');
  var n = 0;
  while (n < lines.length)
  {
    com.parse(lines[n++]);
    const head: string = com.state.token;
    if (head !== 'slot')
    {
      if (head.length !== 0)
        con.dPrint('Unexpected line in wwheel.txt: ' + lines[n - 1] + '\n');
      continue;
    }
    // `slot N` — FTE ignores the index and assumes the blocks are ordered; so do we.
    if (n >= lines.length)
      break;
    com.parse(lines[n++]);
    const open: string = com.state.token;
    if (open !== '{')
    {
      con.dPrint('missing block, found: ' + lines[n - 1] + '\n');
      break;
    }
    const slot: WeaponSlot = { impulse: 0, weaponBit: 0, icon: '', iconSel: '' };
    while (n < lines.length)
    {
      const rest = com.parse(lines[n++]);
      const key: string = com.state.token;
      if (key === '}')
      {
        registerWeapon(slot);
        break;
      }
      com.parse(rest != null ? rest : '');
      const value: string = com.state.token;
      switch (key)
      {
      case 'impulse':
        slot.impulse = q.atoi(value);
        continue;
      case 'weaponnum':
        slot.weaponBit = q.atoi(value);
        continue;
      case 'icon':
        slot.icon = value;
        continue;
      case 'icon_sel':
        slot.iconSel = value;
        continue;
      }
      if ((key.length !== 0) && (IGNORED_KEYS.indexOf(key) < 0))
        con.dPrint('Unexpected line in wwheel.txt: ' + lines[n - 1] + '\n');
    }
  }
};
