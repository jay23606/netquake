# NetQuake

**Quake 1 and Quake 2 in the browser**, hosted entirely on **GitHub Pages**,
with **Supabase** for the lobby and **peer-to-peer WebRTC** for multiplayer.

There is no game server anywhere. Supabase introduces two browsers to each
other; after that the game traffic goes directly between them.

| | |
|---|---|
| ▶ Play | https://jay23606.github.io/netquake/ |
| Multiplayer lobby (both games) | https://jay23606.github.io/netquake/#/mp |
| Quake 2 | https://jay23606.github.io/netquake/q2/ |

Both games are playable immediately: Quake 1 ships the shareware episode, Quake
2 the demo data. Own the retail games? Add your own pak files — Quake 1 under
**Q1 Setup**, Quake 2 with **Add Quake II data** on the `/q2/` page. Both are
kept in IndexedDB in your browser and never uploaded anywhere.

## Status

| | Quake 1 | Quake 2 |
|---|---|---|
| Single player | working | working |
| Your own retail data | working (`pak1.pak`) | working (`pak0.pak`) |
| Peer-to-peer multiplayer | working | working |
| Shared lobby | working | working |
| Deathmatch maps | 29 (9 shareware + 20 added) | 3 (demo) |
| Voice chat | working | working |
| Leaderboard | working | — |
| End-of-match map vote | working | — |

Both engines are confirmed playing peer-to-peer between two browsers: anonymous
sign-in, hosting and joining, SDP and ICE crossing a Supabase broadcast channel,
a data channel opening, and the full Quake connection handshake completing over
it — `getchallenge`, `connect`, configstrings, baselines, `entered the game`.

### Known issues

- STUN only. Peers behind symmetric NAT will not connect; a TURN relay goes in
  `VITE_ICE_SERVERS` if that matters.
- The added Quake 1 maps are deathmatch only — see **Game data** for why.
- Quake 2 on demo data draws opponents with a monster model, since the demo
  pak has no player models at all.

## Architecture

| Layer | Technology |
|---|---|
| Hosting | GitHub Pages (static) |
| Lobby, rooms, chat, profiles | Supabase Postgres (tables prefixed `nq_`) |
| Auth | Supabase Auth (anonymous sign-in) |
| Signaling — SDP/ICE only | Supabase Realtime broadcast |
| Game traffic | WebRTC data channel, peer to peer |
| Game server | The host player's browser |
| Voice chat | A second WebRTC mesh, via [foyer](https://github.com/jay23606/foyer) |

**Game traffic never passes through Supabase.** Quake sends roughly 20 server
snapshots per second per player; relaying that through a WebSocket service
would add well over 100 ms of latency and burn message quota for no benefit.
Supabase brokers the connection, then gets out of the way.

Data channels are unordered with no retransmits. Quake's own netchan handles
sequencing and reliability, and an ordered channel would head-of-line block —
adding exactly the latency the protocol exists to avoid.

### Two engines, one site

The two clients cannot share a build: Quake 1 is Vite 4 with Vue 3, Quake 2 is
Vite 8 with three.js and TypeScript 6. They are separate builds emitting into
one tree — Quake 1 at `/`, Quake 2 at `/q2/` — which sidesteps the version
clash entirely. The Supabase lobby and signaling code is framework-free and
shared by both rather than duplicated, aliased into the Quake 2 build as `@nq`.

`nq_rooms.game` records which engine a room belongs to, so one room list serves
both. Launching a Quake 2 room leaves the Vue router and hands the session over
in the URL, which is what brings up signaling on the other side.

## The lobby

Sign in with a name, then host or join. The room list is live — rooms and
players appear and leave over Realtime, with no refresh.

- **Synchronised launch.** The host presses Start once and everyone enters
  together, rather than each player launching for themselves.
- Chat, with join and leave notices.
- Player list with colours, host controls (kick, and ban that blocks re-joining
  through RLS), and asset-download progress.
- Match settings the host edits and everyone sees: map, deathmatch or co-op,
  frag limit, time limit, skill. These reach the engine as `+deathmatch`,
  `+coop`, `+skill`, `+fraglimit` and `+timelimit`.
- Quitting a match returns to the room, so a group can play another round.
- **Voice chat**, with a microphone toggle in both games and `M` as the
  keybind. Quake takes pointer lock while playing, so the button cannot be
  clicked mid-match — it is the status readout and the key does the work.
- **A map vote when a match ends.** Four candidates rather than all
  twenty-nine, derived from the room and the map just played so every player
  computes the same ballot without anyone publishing it.
- **A leaderboard.** Finished matches are recorded, so a result outlives the
  session that produced it.

Two normal windows of one browser share a session and count as the same player;
use a private window, another browser, or the **change name** control.

### Not carried over from upstream

- A custom/Quaddicted map picker. The browser itself is still in the tree, but
  it pointed at the old room server’s `/api/maps`. The upstream archive is
  still up, and its map downloads send no `Access-Control-Allow-Origin`, so a
  browser on this origin cannot fetch them without a proxy — which would mean
  running a server.
- A server browser fed by a master server — Supabase rooms replace it.

## Game data

Only freely distributable data ships with this repository, and each pak was
checked rather than taken on trust:

- **Quake 1** — the shareware `pak0.pak`: `PACK` magic, 18,689,235 bytes, 339
  entries, which is the same count the engine itself uses to decide whether a
  pak has been modified.
- **Quake 2** — the demo `pak0.pak`: `PACK` magic, 49,951,322 bytes, 1106
  entries, holding exactly three maps (`demo1`, `demo2`, `demo3`) and none of
  the roughly forty retail map names.

### Added deathmatch maps

Twenty more Quake 1 maps ship as loose `.bsp` files, all BSD-3-Clause:

- **[LibreQuake](https://github.com/lavenderdotpet/LibreQuake)** — `lq_e0m1`–`lq_e0m8`.
- **[LibreQuartz](https://github.com/scaryguy334/LibreQuartz)** — `am1`, `box`,
  `bunkers`, `house`, `nsa`, `office`, `void1`–`void6`.

With the nine shareware maps that is 29 in the deathmatch rotation. They are
original levels rather than remakes — new geometry and new art, sharing only the
handful of texture *names* Quake keys behaviour off (`trigger`, `clip`,
`*water0`, `+0basebtn`). `void2` has 24 deathmatch spawn points, more than
twice what any shareware map offers.

They are loose files rather than a second game dir because Quake embeds a map’s
textures in the BSP itself, so each map is self-contained at 1–2 MB instead of
pulling in a 42 MB pak.

Each was screened before inclusion rather than taken on trust:

- **BSP29**, which is what this engine reads. The extended **BSP2** format that
  much modern community mapping uses would not load at all.
- **Deathmatch spawn points present** — between 4 and 24 each.
- **Every entity resolves** against the shareware progs and models.
  `light_globe`, `trigger_hurt`, `trigger_push` and `func_illusionary` look
  foreign only because id’s episode 1 never used them; all are stock, and
  `progs/s_light.spr` that `light_globe` needs does ship in `pak0`.

They are **deathmatch only**. Some place monsters — hell knights, shalraths —
whose models ship in retail `pak1`, and Quake removes monsters *before*
precaching them only when `deathmatch` is set. Under co-op the map would die on
a missing `progs/hknight.mdl`, so the lobby offers these maps for deathmatch
only, and a room switched to co-op afterwards has its map reset rather than
being left unloadable.

Only the `.bsp` files are taken. Both projects’ art is BSD-3-Clause while their
QuakeC and `progs.dat` are GPL-2, so leaving those behind keeps this data free
of any GPL obligation. Both notices are reproduced in full under
`static/gamedata/`, as that licence requires.

Retail data is never included. Quake 1's `pak1.pak` and Quake 2's retail
`pak0.pak` are added by players who own the games, and stay in their browser.

The Quake 2 demo data contains **no player models at all**, so a request for a
missing player model falls back to a monster model the demo pak does contain.
Opponents are visible but wear the wrong body; retail data resolves to the real
models. Upstream fills this gap with loose player skins named `brianna`,
`doomgal` and `cobalt` — retail and mission-pack content, which is why they are
not copied here.

The substitute carries its own animation table, so the player frame numbers the
server sends are remapped onto its equivalents. Without that a dead player lands
on whatever pose happens to sit at that index — a mid-stride walk, in the
soldier’s case — and corpses stand around looking alive. Ranges are scaled so
the last player frame lands on the last substitute frame, because a death
animation holds its final frame and that is the pose a corpse keeps.

## Running locally

Requires Node 22+.

```bash
npm install
npm run build
```

Voice, and the lobby behind it, come from
[foyer](https://github.com/jay23606/foyer), installed from npm as
`@jay23606/foyer`. It was extracted from this repository after the same
peer-to-peer plumbing had been written here a fourth time, and netquake is its
first consumer.

The range is `^0.6.0`, which below version 1.0 means patch releases only: npm
treats a minor bump before 1.0 as breaking, so 0.6 and later arrive by widening
the range deliberately rather than on their own.

Quake 2 is a separate workspace and builds into the same output tree, after
Quake 1, whose build empties it:

```bash
cd q2 && npm install && npm run build
```

Then serve the combined site:

```bash
npx http-server dist/app -p 8099 -c-1
```

`npm run start:dev` runs the Quake 1 client alone with hot reload.

### Supabase setup

Only needed for multiplayer. Copy `.env.example` to `.env.local` and fill in
your project URL and anon key (Dashboard → Settings → API), run the SQL files
in `supabase/` in order, and enable anonymous sign-ins under Authentication →
Providers. The anon key is public by design — Row Level Security is what
protects the data — so it also lives in the committed `.env.production`.

## Credits and licence

GPL-2.0.

- **Quake 1** — a fork of [netquake.io](https://gitlab.com/joe.lukacovic/netquake.io)
  by Joe Lukacovic, based on [WebQuake](https://github.com/Triang3l/WebQuake) by
  Triang3l, a port of id Software's GLQuake. See `GNU.md`.
- **Quake 2** — vendored from [Quake-2-JS](https://github.com/Karlos-fr/Quake-2-JS)
  by Karlos-fr, a TypeScript port of id Software's Quake II source. See
  `q2/VENDORED.md` for what was changed and left out.

- **Voice chat** — [foyer](https://github.com/jay23606/foyer), MIT, which was
  extracted from this repository after the same peer-to-peer plumbing had been
  written here a fourth time. netquake is its first consumer.

id Software released both engines under GPL-2.0; the game data is not covered
by that licence and remains theirs.
