# NetQuake

Quake 1 in the browser, hosted entirely on **GitHub Pages** with **Supabase**
for the lobby, and **peer-to-peer WebRTC** for multiplayer.

**▶ Play: https://jay23606.github.io/netquake/**

Episode 1 plays immediately — the shareware data ships with the site. Own
Quake? Upload your own `pak1.pak` in Setup to unlock all four episodes; it is
stored locally in IndexedDB and never uploaded anywhere.

## Status

| Feature | State |
|---|---|
| Single player (shareware episode 1) | working |
| Single player (full game, your own `pak1.pak`) | working |
| Static hosting on GitHub Pages | working |
| Supabase schema + signaling broker | written, not yet wired |
| Peer-to-peer multiplayer | **not working yet** |

Multiplayer is the current work in progress: `SupabaseBroker` is implemented
but `webrtc.ts` still constructs the legacy `RoomBroker`.

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
