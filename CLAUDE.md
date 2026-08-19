# Claude AI Assistant Instructions

## Project Overview
NetQuake.io is an HTML5 WebGL port of the classic Quake game by id Software. This is a TypeScript/JavaScript project that includes:

- **Quake JS Engine**: Core game engine ported to JavaScript
- **NodeJS Server**: Multiplayer game server implementation  
- **Vue Frontend**: Web application for playing Quake in the browser

## Project Structure

```
src/
├── engine/          # Core Quake engine implementation
├── app/             # Vue.js frontend application
│   ├── game/        # Game-specific logic and asset handling
│   └── web/         # Web components, stores, and frontend code
├── server/          # NodeJS server implementation
└── shared/          # Shared utilities and types
```

Key directories:
- `src/engine/` - Core game engine (rendering, networking, game logic)
- `src/app/` - Vue.js frontend application
- `src/app/web/` - Web components, stores, router, and frontend assets
- `src/app/game/` - Game asset management and systems
- `src/server/` - NodeJS multiplayer server

## Technology Stack

- **Frontend**: Vue 3, TypeScript, Vite, SCSS
- **Backend**: Node.js, TypeScript, WebSocket
- **Build**: Vite, TypeScript compiler
- **Styling**: SCSS, Spectre.css
- **State Management**: Pinia

## Build Commands

```bash
# Install dependencies
npm install

# Build everything (frontend + server)
npm run build

# Build server only
npm run build:justserver

# Development server (frontend)
npm run start:dev

# Production server (frontend)
npm run serve:prod

# Game server (multiplayer)
npm run start:gameserver

# Development game server
npm run debug:gameserver
```

## Key Files

- `package.json` - Project dependencies and scripts
- `tsconfig.json` - TypeScript configuration
- `vite.config.js` - Frontend build configuration
- `src/app/web/main.ts` - Frontend application entry point
- `src/server/index.ts` - Server entry point
- `src/engine/` - Game engine library (no single entry point)

## Development Guidelines

1. **Code Style**: Follow existing TypeScript/Vue patterns in the codebase
2. **File Organization**: Keep engine code separate from app/frontend code
3. **Types**: Use TypeScript interfaces defined in `types/` directories
4. **Testing**: Currently no test framework - check with `npm run build` before committing
5. **Assets**: Game assets (PAK files, maps, etc.) are handled through the asset store interface - server uses filesystem, frontend uses IndexedDB
6. **Module state**: Avoid standalone module-level variables. Engine modules expose a `state` object (e.g. `export let state = { ... }`) for all mutable module state. Add new fields to the existing state object rather than declaring separate exported variables.
7. **Vector ops**: `vec.ts` functions that produce a vector take a required `out` param, write into it, and return it (e.g. `vec.subtract(a, b, out)`) — never add a function that allocates and returns a new array. Use `vec.scratch()` for frame-local temporaries; it is valid only until the next `vec.resetScratch()` (called once per frame in `host._frame`) and must never be stored into anything that outlives the current frame.
8. **Per-frame allocations are forbidden in engine hot paths** (render frame, physics/movement, entity relink, view calc): no `[x, y, z]` literals, no `vec.emptyV3()`/`emptyV4()`, no object/array reassignment where an existing persistent container can be mutated in place instead. Allocation is fine in cold paths (model/asset loading, menu, console, connection setup) and at genuine construction time (e.g. a newly spawned particle's own persistent `origin`/`vel`).

## Common Tasks

- **Adding new Vue components**: Create in `src/app/web/components/`
- **Engine modifications**: Work in `src/engine/` 
- **Server features**: Modify `src/server/` or `src/app/game/net/`
- **Styling changes**: Edit SCSS files in `src/app/web/scss/`
- **State management**: Use Pinia stores in `src/app/web/stores/`
- **Frontend logic**: Most Vue app code lives in `src/app/`

## Important Notes

- This is a game engine port - be careful with performance-critical code
- WebGL rendering happens in the engine layer
- Multiplayer networking uses WebSockets
- Asset loading supports Quake PAK files and various game mods
- Asset store system: shared interface with different implementations (server uses filesystem, frontend uses IndexedDB)
- The project serves both single-player and multiplayer Quake gameplay

## Current Status
Based on git status, there are pending changes to:
- `src/app/web/stores/maps.ts`
- `src/app/web/types/QuaddictedMap.ts` 
- `src/engine/com.ts`

Please run the build command to verify changes before committing.