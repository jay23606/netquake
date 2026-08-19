# AD Final Features — RMQ 999 PRFL flags + FTE_ENT_SKIN_CONTENTS

The last two items from `docs/ad-engine-features.md`. Branch `ad-final-features`,
one commit per phase, `npm run build` green after each. References: QSS-M at
`C:\source\QSS-M\Quake` (protocol.h PRFL_* at lines 43-50, sv/cl coord+angle
read/write per flags), Ironwail at `C:\source\ironwail\Quake` as a second opinion.

## Current state (verified)
- `sv.ts` spawnServer already sets `protocol = 999` and `protocolFlags = FLAGS.FLOAT_COORDS
  (=1)` — a PRIVATE bit value that collides with nothing standard: real RMQ float coords
  are `PRFL_FLOATCOORD = 1<<4`. Wire is self-consistent for our own client but
  non-compliant for interop, and angles are ALWAYS single bytes (`msg.writeAngle`),
  which makes AD's scripted cinematic cameras step visibly (~1.4° increments).
- `msg.ts` has `writeAngle16`/`readAngle16` already (used ad-hoc by the FTE-negotiation
  client path) and coord functions take a `flags` param throughout.

## Phase 1 — RMQ-compliant protocol 999 (agent)
- `protocol.ts`: real `PRFL` constants (SHORTANGLE 2, FLOATANGLE 4, 24BITCOORD 8,
  FLOATCOORD 16, EDICTSCALE 32, ALPHASANITY 64, INT32COORD 128). Retire the private
  `FLAGS.FLOAT_COORDS=1` in favor of `PRFL.FLOATCOORD` everywhere (grep every use).
- Server: pick the same default flags QSS-M selects for sv_protocol 999 (read their
  SV_SpawnServer / host defaults — likely `PRFL_INT32COORD|PRFL_SHORTANGLE`; whatever
  the C does, mirror it) and write the flags long after the protocol long in
  svc_serverinfo for 999 (verify our sendServerinfo already does/doesn't).
- `msg.ts`: `writeCoord`/`readCoord` honor 24BIT/FLOAT/INT32 variants per flags
  (QSS-M MSG_WriteCoord/MSG_ReadCoord); `writeAngle`/`readAngle` gain a required
  `flags` param honoring SHORTANGLE/FLOATANGLE (byte default). EVERY call site updated
  (sv.ts entities/baselines/statics, cl.ts parsing, pf.ts, fog/te writers — grep all).
- Client `parseServerInfo`: for 999 read the flags long into clState.protocolFlags
  (verify existing path), reject unknown flag bits with a console warning like QSS-M.
- EDICTSCALE/U_SCALE and ALPHASANITY: do NOT set the flags; parse-side tolerance only
  if trivial (QSS-M rejects unsupported bits — copy that).
- Savegames/demos: protocolFlags must flow through any demo-record path that stamps
  protocol (grep for demo writers); saves don't persist wire flags — verify.
- Verify: `npm run build`; loopback smoke logic-trace: baseline+update angle round-trip
  through SHORTANGLE producing 16-bit precision.

## Phase 2 — FTE_ENT_SKIN_CONTENTS (agent, after Phase 1 review)
- Reference: QSS-M's skin-contents support — search `skin` handling in world.c /
  sv_phys.c / pmove (negative `.skin` on SOLID_BSP entities → that bmodel's volume
  reports CONTENTS water(-3)/slime(-4)/lava(-5)/ladder per the value; find the exact
  mapping + where point-contents consults entities rather than just the world).
- Ours: `sv.ts` pointContents/hull selection for SOLID_BSP entities; waterlevel
  checks in player/monster physics; ladder support = whatever AD's FTESKIN
  trigger_ladder expects (engine ladder movement may be QC-visible via contents only —
  verify what AD QC does when FTE_ENT_SKIN_CONTENTS is advertised before implementing
  player-physics changes; scope to what AD actually consumes).
- Advertise `FTE_ENT_SKIN_CONTENTS` only after the behavior matches (fog lesson:
  verify QSS-M advertises it — check pr_ext.c — and what QC paths flip on it).
- Verify: build + AD map with FTESKIN ladders or movable liquid if one is identified;
  otherwise dev-level verification with a test QC/map documented in the report.

## Phase 3 — docs + gap-list closure (orchestrator)
Update `docs/ad-engine-features.md`; final smoke test; merge.
