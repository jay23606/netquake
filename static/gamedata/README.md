# Game data

Served statically to the browser, which caches it into IndexedDB on first run.

- `id1.json` — manifest of what is available for the `id1` game dir. The engine
  checks this before attempting a fetch, so a pak absent here is never requested.
- `id1/pak0.pak` — **not committed.** Quake's shareware data file. Drop it here
  to make episode 1 playable out of the box; see the repo README.

`pak1.pak` (the registered/retail data) is deliberately never distributed here.
Players who own Quake upload their own copy through Setup, which stores it in
IndexedDB locally and never transmits it anywhere.
