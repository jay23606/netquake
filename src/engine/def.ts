export const webquake_version = 74;
export const timedate = 'Exe: 14:30:00 Aug 6 2026\n';

export const max_edicts = 32000; // hard cap (QuakeSpasm/Ironwail MAX_EDICTS) — huge modern maps
export const initial_edicts = 8192; // pre-allocated per map; sv.alloc grows lazily up to max_edicts
export const max_vis_edicts = 4096;
// Reliable/signon buffers must hold a whole map's baselines + precache lists; huge
// modern maps (Immortal Lock) blow past the classic ~64KB. The netchan fragments
// reliable messages for transmission, so a large buffer is safe. cursize tracks
// actual use, so the extra capacity on per-frame datagram buffers costs only memory.
export const max_message = 2097152

export const STAT = {
  health: 0,
  frags: 1,
  weapon: 2,
  ammo: 3,
  armor: 4,
  weaponframe: 5,
  shells: 6,
  nails: 7,
  rockets: 8,
  cells: 9,
  activeweapon: 10,
  totalsecrets: 11,
  totalmonsters: 12,
  secrets: 13,
  monsters: 14
};

export const IT = {
  shotgun: 1,
  super_shotgun: 2,
  nailgun: 4,
  super_nailgun: 8,
  grenade_launcher: 16,
  rocket_launcher: 32,
  lightning: 64,
  super_lightning: 128,
  shells: 256,
  nails: 512,
  rockets: 1024,
  cells: 2048,
  axe: 4096,
  armor1: 8192,
  armor2: 16384,
  armor3: 32768,
  superhealth: 65536,
  key1: 131072,
  key2: 262144,
  invisibility: 524288,
  invulnerability: 1048576,
  suit: 2097152,
  quad: 4194304
};

export const RIT = {
  shells: 128,
  nails: 256,
  rockets: 512,
  cells: 1024,
  axe: 2048,
  lava_nailgun: 4096,
  lava_super_nailgun: 8192,
  multi_grenade: 16384,
  multi_rocket: 32768,
  plasma_gun: 65536,
  armor1: 8388608,
  armor2: 16777216,
  armor3: 33554432,
  lava_nails: 67108864,
  plasma_ammo: 134217728,
  multi_rockets: 268435456,
  shield: 536870912,
  antigrav: 1073741824,
  superhealth: 2147483648
};

export const HIT = {
  proximity_gun_bit: 16,
  mjolnir_bit: 7,
  laser_cannon_bit: 23,
  proximity_gun: 65536,
  mjolnir: 128,
  laser_cannon: 8388608,
  wetsuit: 33554432,
  empathy_shields: 67108864
};

export const SURF = {
  planeback: 2,
  drawsky: 4,
  drawsprite: 8,
  drawtub: 0x10,
  drawtiled: 0x20,
  drawbackground: 0x40,
  underwater: 0x80,
  notexture: 0x100,
  drawfence: 0x200,
  drawlava: 0x400,
  drawslime: 0x800,
  drawtele: 0x1000,
  drawwater: 0x2000
}

export const PLANE = {
  x: 0,
  y: 1,
  z: 2
}

export const TEX = {
  special: 1,		// sky or slime, no lightmap or 256 subdivision
  missing: 2		// johnfitz -- this texinfo does not have a textur
}

export const VERTEXSIZE =	11
// floats per vertex in a Model.polyVertData staging buffer (xyz + diffuse st +
// lightmap st); the VBO adds 4 style indices to reach VERTEXSIZE
export const POLY_VERT_STRIDE = 7

export const TEXPREF = {
  none: 0x000,
  mipmap: 0x0001,     // generate mipmaps
  // TEXPREF_NEAREST and TEXPREF_LINEAR aren't supposed to be ORed with TEX_MIPMAP
  linear: 0x0002,	    // force linear
  nearest: 0x0004,	  // force nearest
  alpha: 0x0008,	    // allow alpha
  pad: 0x0010,	      // allow padding
  persist: 0x0020,    // never free
  overwrite: 0x0040,  // overwrite existing same-name texture
  nopicmip: 0x0080,   // always load full-sized
  fullbright: 0x0100, // use fullbright mask palette
  nobright: 0x0200,   // use nobright mask palette
  conchars: 0x0400,   //use conchars palette
  warpimage: 0x0800,   // resize this texture when warpimagesize changes
  skin: 0x1000        // alias skin: fullbright indices get alpha 0 (shader lighting mask)
}

export const MOD = {
  mf_honey: 1 << 14, // MarkV/QSS -- make index 255 transparent on mdl's
  nolerp: 1 << 8,
  noshadow: 1 << 9,
  fbrighthack: 1 << 10
}