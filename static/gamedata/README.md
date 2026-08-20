# Game data

Served statically to the browser, which caches it into IndexedDB on first run.

- `id1.json` — manifest of what is available for the `id1` game dir. The engine
  checks this before attempting a fetch, so a pak absent here is never requested.
- `id1/pak0.pak` — Quake shareware data, which id Software distributed freely.
  Verified unmodified: `PACK` magic, 18,689,235 bytes, 339 entries (the engine
  itself flags any other count as modified).
  sha256 `35a9c55e5e5a284a159ad2a62e0e8def23d829561fe2f54eb402dbc0a9a946af`
  Sourced from the Internet Archive's copy of the original shareware release.

`pak1.pak` (the registered/retail data) is deliberately never distributed here.
Its absence is expected and handled: the engine 404s on it and ends the pak
loop. Players who own Quake upload their own copy through Setup, which stores
it in IndexedDB locally and never transmits it anywhere.

## LibreQuake deathmatch maps

`id1/maps/lq_e0m*.bsp` — eight original levels from the LibreQuake project,
release v0.09-beta, taken from its `lite` build. They are not remakes: the
geometry and art are new work, sharing only the handful of texture *names*
Quake keys behaviour off (`trigger`, `clip`, `*water0`, `+0basebtn`).

Shipped as loose `.bsp` files rather than a second game dir, because Quake
embeds a map's textures in the BSP itself, so each map is self-contained and
costs ~1-2 MB instead of the 42 MB full pak.

Only the maps are taken. LibreQuake's art assets are BSD-3-Clause; its QuakeC,
`progs.dat` and `pop.lmp` are GPL-2 and are deliberately not distributed here,
so this directory carries no GPL obligation. The BSD-3 notice is reproduced in
full in `LIBREQUAKE-COPYING.txt`, as that licence requires.

**Deathmatch only.** These maps place hell knights, whose model ships in pak1
(the registered data). Quake removes monsters before precaching them only when
`deathmatch` is set, so under coop or single-player the map fails to load with
`Mod.LoadModel: progs/hknight.mdl not found`. The lobby therefore offers them
only when the game type is deathmatch.

Source: https://github.com/lavenderdotpet/LibreQuake

## LibreQuartz deathmatch maps

`id1/maps/{am1,box,bunkers,house,nsa,office,void1..void6}.bsp` — twelve levels
from LibreQuartz, a second libre Quake project, also BSD-3-Clause. Its notice is
reproduced in `LIBREQUARTZ-COPYING.txt`. Only the `.bsp` files are taken, on the
same reasoning as LibreQuake: the maps carry their own textures, so nothing else
from the project is needed and no GPL-licensed QuakeC comes with them.

Screened before inclusion: all are BSP29 (the format this engine reads -- the
extended BSP2 that many modern community maps use would not load), all carry
deathmatch spawn points (4 to 24 each), and every entity they place resolves
against the shareware progs and models. `light_globe` and `trigger_hurt` look
foreign only because id's episode 1 never used them; both are stock.

`vtest` and LibreQuartz's own `start` are deliberately not included -- the first
is a test map, the second would collide with id's `start`.

Grouped with the LibreQuake maps under the same deathmatch-only gate, because
`box` places hell knights and shalraths whose models ship in pak1.

Source: https://github.com/scaryguy334/LibreQuartz
