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

Both engines are confirmed playing peer-to-peer between two browsers: anonymous
sign-in, hosting and joining, SDP and ICE crossing a Supabase broadcast channel,
a data channel opening, and the full Quake connection handshake completing over
it — `getchallenge`, `connect`, configstrings, baselines, `entered the game`.

### Known issues

- **Quake 2**: after dying and respawning, the joining player has no weapon and
  cannot shoot. Under investigation.
- Quake 2 still logs diagnostics (`[q2-render]`, `[q2-touch]`, and a filtered
  mirror of the engine console) that should be removed.
- STUN only. Peers behind symmetric NAT will not connect; a TURN relay goes in
  `VITE_ICE_SERVERS` if that matters.

## Architecture

| Layer | Technology |
|---|---|
| Hosting | GitHub Pages (static) |
| Lobby, rooms, chat, profiles | Supabase Postgres (tables prefixed `nq_`) |
| Auth | Supabase Auth (anonymous sign-in) |
| Signaling — SDP/ICE only | Supabase Realtime broadcast |
| Game traffic | WebRTC data channel, peer to peer |
| Game server | The host player's browser |

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

Two normal windows of one browser share a session and count as the same player;
use a private window, another browser, or the **change name** control.

### Not carried over from upstream

- A custom/Quaddicted map picker. The index it used has no equivalent here, and
  the index is not CORS-readable, so it would need a proxy.
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

Retail data is never included. Quake 1's `pak1.pak` and Quake 2's retail
`pak0.pak` are added by players who own the games, and stay in their browser.

The Quake 2 demo data contains **no player models at all**, so a request for a
missing player model falls back to a monster model the demo pak does contain.
Opponents are visible but wear the wrong body; retail data resolves to the real
models. Upstream fills this gap with loose player skins named `brianna`,
`doomgal` and `cobalt` — retail and mission-pack content, which is why they are
not copied here.

## Running locally

Requires Node 22+.

```bash
npm install
npx vite build
```

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

id Software released both engines under GPL-2.0; the game data is not covered
by that licence and remains theirs.
