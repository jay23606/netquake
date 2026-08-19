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

## Game data

`apps/web/public/baseq2/pak0.pak` is the Quake II **demo** data pack, which id
distributed freely. Upstream says so, and that claim was checked rather than
taken on trust: the pak directory holds exactly three maps, `demo1`, `demo2` and
`demo3`, and none of the ~40 retail map names (`base1`, `jail1`, `city1`, and so
on). `PACK` magic, 49,951,322 bytes, 1106 entries.

Retail Quake II data is not included and should not be added here.

## What else was left out

- `node_modules/`, `dist/`, `.git/`, `audit-portage/`

## Local changes

- `apps/web/vite.config.ts`: `base` is relative, so the build works mounted at
  `<pages-site>/q2/` instead of assuming its own repository name.
