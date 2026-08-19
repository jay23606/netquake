# Vendored: Quake2JS

Source: https://github.com/Karlos-fr/Quake-2-JS — a TypeScript port of id
Software's Quake II source release.

Vendored rather than submoduled because this build modifies the engine: the
peer-to-peer transport is added here, against the packet adapter in
`apps/web/src/local-transport.ts`.

## Licence

Quake II's engine source was released by id Software under **GPL-2.0**, so this
port and this copy of it are derivative works governed by GPL-2.0, and are
redistributed here on those terms. Note that the upstream repository declares no
licence file and its sources no longer carry id's original notices; the
obligation stands regardless of that omission.

Upstream Quake II source: https://github.com/id-Software/Quake-2

## What was left out

- `apps/web/public/baseq2/` — the game data pak. Upstream describes it as the
  Quake II demo/shareware pack, but unlike the Quake 1 shareware pak (which can
  be checked against a known size and a 339-entry count the engine itself
  verifies) there is no independent signal confirming that here. It is
  deliberately not redistributed from this repository until that is settled.
- `node_modules/`, `dist/`, `.git/`, `audit-portage/`

## Local changes

- `apps/web/vite.config.ts`: `base` is relative, so the build works mounted at
  `<pages-site>/q2/` instead of assuming its own repository name.
