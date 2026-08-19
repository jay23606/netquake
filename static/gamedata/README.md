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
