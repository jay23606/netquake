# NetQuake

Quake 1 in the browser, hosted entirely on **GitHub Pages** with **Supabase**
for the lobby, and **peer-to-peer WebRTC** for multiplayer.

**▶ Play: https://jay23606.github.io/netquake/**

**Multiplayer lobby: https://jay23606.github.io/netquake/#/mp**

Episode 1 plays immediately — the shareware data ships with the site. Own
Quake? Upload your own `pak1.pak` in Setup to unlock all four episodes; it is
stored locally in IndexedDB and never uploaded anywhere.

## Status

| Feature | State |
|---|---|
| Single player (shareware episode 1) | working |
| Single player (full game, your own `pak1.pak`) | working |
| Static hosting on GitHub Pages | working |
| Supabase schema, auth and lobby | working |
| Live room list (Realtime) | working |
| Peer-to-peer game connection | working |
| WASM server sim | working |

Multiplayer is confirmed end to end between two browsers: anonymous sign-in,
room creation and joining, the Realtime room list, SDP/ICE crossing a Supabase
broadcast channel, ICE reaching `connected`, and the joining player loading the
map over the DataChannel while the host logs `player entered the game`.

Note that STUN alone will not connect peers behind symmetric NAT; a TURN relay
goes in `VITE_ICE_SERVERS` if that turns out to matter.

### Not carried over from upstream

The lobby is deliberately minimal. Upstream's room flow, which ran against a
server this build does not have, additionally offered:

- a synchronised launch: the host started the match and every peer entered
  together, rather than each player pressing Start for themselves
- lobby chat, with join/leave/kick/timeout events
- a player list with host controls (kick, ban) and player colours
- game settings: game type, frag limit, time limit, skill, game directory
- a custom/Quaddicted map picker, and sharing map-download progress with the
  room so the host can see who is still fetching assets
- a server browser fed by a master server

## Architecture

There is no game server to run. A player's browser hosts the match.

| Layer | Technology |
|---|---|
| Hosting | GitHub Pages (static) |
| Lobby, rooms, profiles | Supabase Postgres (tables prefixed `nq_`) |
| Auth | Supabase Auth (anonymous sign-in) |
| Signaling — SDP/ICE only | Supabase Realtime broadcast |
| Game traffic | WebRTC DataChannel, peer-to-peer |
| Game server | The host player's browser (WASM/worker sim) |

**Game traffic never passes through Supabase.** Quake sends roughly 20 server
snapshots per second per player; relaying that through a WebSocket service
would add well over 100 ms of latency and burn message quota for no benefit.
Supabase brokers the connection, then gets out of the way.

## Running locally

Requires Node 18+.

```bash
npm install
npm run start:dev
```

For a production build:

```bash
npx vite build
npx http-server dist/app -p 8099 -c-1
```

### Supabase setup

Only needed for multiplayer. Copy `.env.example` to `.env.local` and fill in
your project URL and anon key (Dashboard → Settings → API), then run
`supabase/schema.sql` in the SQL Editor and enable anonymous sign-ins under
Authentication → Providers.

## Credits and licence

GPL-2.0. This is a fork of [netquake.io](https://gitlab.com/joe.lukacovic/netquake.io)
by Joe Lukacovic, itself based on [WebQuake](https://github.com/Triang3l/WebQuake)
by Triang3l, itself a port of id Software's GLQuake. See `GNU.md`.

Quake and its game data are property of id Software. Only the shareware data,
which id distributed freely, is included here; the retail `pak1.pak` is not
and never will be.
