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
