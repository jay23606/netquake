/**
 * File: server-host.ts
 * Purpose: Wire the ported local server runtime into the browser web-app command host.
 *
 * This file is not a direct source port.
 * It is a web adapter that keeps server command behavior inside `packages/server`.
 *
 * Dependencies:
 * - packages/filesystem
 * - packages/game
 * - packages/qcommon
 * - packages/server
 */

import { readMountedFile, type VirtualFilesystem } from "../../../packages/filesystem/src/index.js";
import { CL_ParseServerMessage, type ClientParseHooks } from "../../../packages/client/src/cl_parse.js";
import { connstate_t, type ClientRuntime } from "../../../packages/client/src/client.js";
import { createSizeBuffer, MSG_BeginReading, SZ_Clear, SZ_Write } from "../../../packages/memory/src/index.js";
import {
  GetGameApiFunction,
  createGameRuntimeFromBspEntities,
  createRuntimeEntity,
  type GameCollisionBridge,
  type game_export_t,
  type game_import_t
} from "../../../packages/game/src/index.js";
import { createGameClient } from "../../../packages/game/src/runtime.js";
import {
  Cbuf_CopyToDefer,
  Cvar_Get,
  Netchan_Init,
  CM_ReadPortalState,
  CM_WritePortalState,
  CS_IMAGES,
  CS_MODELS,
  CS_PLAYERSKINS,
  CS_SOUNDS,
  MAX_CLIENTS,
  MAX_CONFIGSTRINGS,
  MAX_MODELS,
  MAX_MSGLEN,
  MAX_QPATH,
  MAX_SOUNDS,
  MAX_IMAGES,
  PROTOCOL_VERSION,
  createCollisionModelRuntime,
  createNetAdr,
  createQcommonNetRuntime,
  type CommandRuntime,
  type CollisionModelRuntime,
  type CollisionWorld,
  type CvarRuntime,
  type QcommonNetRuntime,
  type cvar_t,
  type usercmd_t
} from "../../../packages/qcommon/src/index.js";
import {
  createServerRuntimeFacade,
  createServerState,
  createServerStatic,
  client_state_t,
  server_state_t,
  type client_t,
  type ServerRuntimeFacade
} from "../../../packages/server/src/index.js";
import { createWebSaveStorage, type WebSaveStorage } from "./web-save-storage.js";

/**
 * Original name: N/A
 * Source: N/A (web server host adapter)
 * Category: New
 * Purpose: Expose the browser-local server host facade backed by the ported server runtime.
 */
export interface WebAppServerHost {
  facade: ServerRuntimeFacade;
  collisionWorld: CollisionWorld;
  currentMapRequest: string | null;
  hasActiveServer: () => boolean;
  hasActiveGameMap: () => boolean;
  hasActiveServerMedia: () => boolean;
  hasActiveAttractLoop: () => boolean;
  frame: (milliseconds: number) => void;
  writeLocalClientFrame: (client: ClientRuntime, hooks?: ClientParseHooks) => boolean;
  getLocalClientLastCommand: () => usercmd_t | null;
  shutdown: () => void;
}

interface WebAppDemoFileHandle {
  bytes: Uint8Array;
  offset: number;
}

/**
 * Original name: N/A
 * Source: N/A (web server host adapter)
 * Category: New
 * Purpose: Describe dependencies needed to wire the ported server runtime into the browser host.
 */
export interface WebAppServerHostOptions {
  cmd: CommandRuntime;
  cvar: CvarRuntime;
  filesystem: VirtualFilesystem;
  getGameDir: () => string;
  saveStorage?: WebSaveStorage;
  qnet?: QcommonNetRuntime;
  host_speeds?: cvar_t | null;
  setTimeBeforeGame?: (milliseconds: number) => void;
  setTimeAfterGame?: (milliseconds: number) => void;
  onPrint: (message: string) => void;
  onBeginLoading: () => void;
}

/**
 * Original name: N/A
 * Source: N/A (web server host adapter)
 * Category: New
 * Purpose: Create the browser-local server host that delegates frame, game API and snapshot work to ported packages.
 */
export function createWebAppServerHost(options: WebAppServerHostOptions): WebAppServerHost {
  const sv = createServerState();
  const svs = createServerStatic();
  const ge = createPlaceholderGameExports();
  const qnet = options.qnet ?? createQcommonNetRuntime();
  Netchan_Init(qnet, options.cvar);
  const collision = createCollisionModelRuntime();
  const collisionWorld = createDynamicCollisionWorld(collision);
  const saveStorage = options.saveStorage ?? createWebSaveStorage(null);
  let facade!: ServerRuntimeFacade;
  let currentMapRequest: string | null = null;
  let localClientBegunFor: client_t | null = null;

  facade = createServerRuntimeFacade({
    sv,
    svs,
    ge,
    collisionWorld,
    collisionModelRuntime: collision,
    qnet,
    cmd: options.cmd,
    cvar: options.cvar,
    maxclients: Cvar_Get(options.cvar, "maxclients", "1", 0),
    hostname: Cvar_Get(options.cvar, "hostname", "quake2js", 0),
    rcon_password: Cvar_Get(options.cvar, "rcon_password", "", 0),
    timeout: Cvar_Get(options.cvar, "timeout", "125", 0),
    zombietime: Cvar_Get(options.cvar, "zombietime", "2", 0),
    sv_paused: Cvar_Get(options.cvar, "paused", "0", 0),
    sv_timedemo: Cvar_Get(options.cvar, "timedemo", "0", 0),
    sv_showclamp: Cvar_Get(options.cvar, "showclamp", "0", 0),
    sv_enforcetime: Cvar_Get(options.cvar, "sv_enforcetime", "0", 0),
    sv_noreload: Cvar_Get(options.cvar, "sv_noreload", "0", 0),
    sv_airaccelerate: Cvar_Get(options.cvar, "sv_airaccelerate", "0", 0),
    allow_download: Cvar_Get(options.cvar, "allow_download", "1", 0),
    allow_download_players: Cvar_Get(options.cvar, "allow_download_players", "1", 0),
    allow_download_models: Cvar_Get(options.cvar, "allow_download_models", "1", 0),
    allow_download_sounds: Cvar_Get(options.cvar, "allow_download_sounds", "1", 0),
    allow_download_maps: Cvar_Get(options.cvar, "allow_download_maps", "1", 0),
    sv_reconnect_limit: Cvar_Get(options.cvar, "sv_reconnect_limit", "3", 0),
    dedicated: Cvar_Get(options.cvar, "dedicated", "0", 0),
    public_server: Cvar_Get(options.cvar, "public", "0", 0),
    host_speeds: options.host_speeds ?? null,
    master_adr: [createNetAdr()],
    getGameApi: (imports) => createCollisionTolerantGameApi(GetGameApiFunction(imports, {
      runtime: createServerBackedGameRuntime(collisionWorld, imports),
      hooks: {
        readFile: (path) => saveStorage.readText(path) ?? saveStorage.readBinary(path),
        writeFile: (path, contents) => saveStorage.writeText(path, contents)
      }
    }), options.onPrint),
    onPrintf: options.onPrint,
    onDPrintf: options.onPrint,
    nowMs: () => performance.now(),
    ...(options.setTimeBeforeGame ? { setTimeBeforeGame: options.setTimeBeforeGame } : {}),
    ...(options.setTimeAfterGame ? { setTimeAfterGame: options.setTimeAfterGame } : {}),
    randomInt: () => Math.trunc(Math.random() * 0x7fffffff),
    loadMapFile: (name) => readMountedFile(options.filesystem, name)?.bytes,
    openDemoFile: (path) => {
      const bytes = readMountedFile(options.filesystem, path)?.bytes ?? null;
      return bytes ? { bytes, offset: 0 } satisfies WebAppDemoFileHandle : null;
    },
    readDemoMessage: (demofile) => readDemoMessage(demofile),
    closeDemoFile: () => undefined,
    loadDownloadFile: (path) => {
      const file = readMountedFile(options.filesystem, path);
      return file ? { data: file.bytes, fromPak: file.pak !== undefined } : null;
    },
    fileFromPak: () => false,
    FS_Gamedir: options.getGameDir,
    Cbuf_CopyToDefer: () => {
      Cbuf_CopyToDefer(options.cmd);
    },
    SCR_BeginLoadingPlaque: options.onBeginLoading,
    SV_Shutdown: (finalmsg, reconnect) => {
      facade.main.SV_Shutdown(finalmsg, reconnect);
      if (!reconnect) {
        currentMapRequest = null;
      }
    },
    SV_WipeSavegame: (savename) => saveStorage.wipeSavegame(options.getGameDir(), savename),
    SV_CopySaveGame: (src, dst) => saveStorage.copySaveGame(options.getGameDir(), src, dst),
    SV_WriteLevelFile: () => {
      const path = buildSavePath(options.getGameDir(), "current", `${sv.name}.sv2`);
      options.onPrint("SV_WriteLevelFile()\n");
      const chunks = [encodeConfigStrings(sv.configstrings)];
      if (collision.world) {
        chunks.push(CM_WritePortalState(collision.world));
      }
      if (!saveStorage.writeBinary(path, concatBytes(chunks))) {
        options.onPrint(`Failed to open ${path}\n`);
        return;
      }
      ge.WriteLevel(buildSavePath(options.getGameDir(), "current", `${sv.name}.sav`));
    },
    SV_ReadLevelFile: () => {
      const path = buildSavePath(options.getGameDir(), "current", `${sv.name}.sv2`);
      options.onPrint("SV_ReadLevelFile()\n");
      const bytes = saveStorage.readBinary(path);
      if (!bytes) {
        options.onPrint(`Failed to open ${path}\n`);
        return;
      }

      const configSize = MAX_CONFIGSTRINGS * MAX_QPATH;
      decodeConfigStrings(sv.configstrings, bytes.subarray(0, configSize));
      const portal = bytes.subarray(configSize);
      if (collision.world && portal.length > 0) {
        CM_ReadPortalState(collision.world, portal);
      }
      ge.ReadLevel(buildSavePath(options.getGameDir(), "current", `${sv.name}.sav`));
    },
    savegameExists: (path) => saveStorage.exists(path),
    readBinaryFile: (path) => saveStorage.readBinary(path),
    writeBinaryFile: (path, data) => saveStorage.writeBinary(path, data),
    removeFile: (path) => saveStorage.remove(path),
    listFiles: (pattern) => saveStorage.listFiles(pattern),
    createPath: (path) => saveStorage.createPath(path),
    setPmAiraccelerate: () => undefined,
    setServerState: () => undefined,
    debugGraph: () => undefined
  });

  facade.console.SV_InitOperatorCommands();

  return {
    facade,
    collisionWorld,
    get currentMapRequest() {
      return currentMapRequest ?? (sv.state === server_state_t.ss_game && sv.name ? sv.name : null);
    },
    hasActiveServer: () => svs.initialized && sv.state !== server_state_t.ss_dead && sv.name.length > 0,
    hasActiveGameMap: () => sv.state === server_state_t.ss_game && sv.name.length > 0,
    hasActiveServerMedia: () => hasActiveServerMedia(),
    hasActiveAttractLoop: () => sv.attractloop && hasActiveServerMedia(),
    frame: (milliseconds) => {
      if (!svs.initialized || sv.state === server_state_t.ss_dead) {
        return;
      }

      facade.main.SV_Frame(Math.max(0, Math.trunc(milliseconds)));
      if (sv.state === server_state_t.ss_game && sv.name) {
        currentMapRequest = sv.name;
      }
    },
    writeLocalClientFrame: (client, hooks = {}) => {
      const serverClient = ensureLocalServerClient();
      if (!serverClient) {
        return false;
      }

      syncClientConnectionState(client);
      facade.ents.SV_BuildClientFrame(serverClient);

      const msg = createSizeBuffer(MAX_MSGLEN, true);
      facade.ents.SV_WriteFrameToClient(serverClient, msg);

      if (serverClient.datagram.overflowed) {
        options.onPrint(`WARNING: datagram overflowed for ${serverClient.name}\n`);
      } else {
        SZ_Write(msg, serverClient.datagram.data.subarray(0, serverClient.datagram.cursize));
      }
      SZ_Clear(serverClient.datagram);

      if (msg.overflowed) {
        options.onPrint(`WARNING: msg overflowed for ${serverClient.name}\n`);
        SZ_Clear(msg);
        return false;
      }

      client.net_message.data.set(msg.data.subarray(0, msg.cursize), 0);
      client.net_message.cursize = msg.cursize;
      client.net_message.overflowed = false;
      MSG_BeginReading(client.net_message);
      CL_ParseServerMessage(client, hooks);
      serverClient.lastframe = sv.framenum;
      return client.cl.frame.valid;
    },
    getLocalClientLastCommand: () => {
      const command = svs.clients[0]?.lastcmd ?? null;
      return command ? cloneUsercmd(command) : null;
    },
    shutdown: () => {
      if (svs.initialized) {
        facade.main.SV_Shutdown("Server shutdown.\n", false);
      }
      currentMapRequest = null;
      localClientBegunFor = null;
    }
  };

  function hasActiveServerMedia(): boolean {
    return (
      sv.state === server_state_t.ss_cinematic ||
      sv.state === server_state_t.ss_demo ||
      sv.state === server_state_t.ss_pic
    );
  }

  function ensureLocalServerClient(): client_t | null {
    if (!svs.initialized || sv.state !== server_state_t.ss_game || !sv.name) {
      return null;
    }

    const serverClient = svs.clients[0] ?? null;
    const ent = ge.edicts[1] ?? null;
    if (!serverClient || !ent) {
      return null;
    }

    const userinfo = "\\name\\Player\\skin\\male/grunt\\hand\\0\\fov\\90";
    serverClient.edict = ent;
    serverClient.userinfo = serverClient.userinfo || userinfo;
    serverClient.name = serverClient.name || "Player";
    serverClient.rate = serverClient.rate || 25000;
    serverClient.state = client_state_t.cs_spawned;

    if (localClientBegunFor !== serverClient) {
      // Snapshot-only legacy verifiers can still ask the host for a synthetic
      // local client frame. The active web-app path reaches ClientBegin via
      // the normal loopback handshake, so this helper avoids a duplicate begin.
      localClientBegunFor = serverClient;
      serverClient.lastframe = -1;
    }

    return serverClient;
  }

  function syncClientConnectionState(client: ClientRuntime): void {
    client.cls.state = connstate_t.ca_connected;
    client.cls.serverProtocol = PROTOCOL_VERSION;
    client.cl.servercount = svs.spawncount;
    client.cl.playernum = 0;
    client.cl.gamedir = options.getGameDir();
    client.cl.configstrings.splice(0, client.cl.configstrings.length, ...sv.configstrings);

    for (let i = 0; i < MAX_CLIENTS; i += 1) {
      client.cl.configstrings[CS_PLAYERSKINS + i] = sv.configstrings[CS_PLAYERSKINS + i] ?? "";
    }
    for (let i = 0; i < MAX_MODELS; i += 1) {
      client.cl.model_draw[i] = sv.configstrings[CS_MODELS + i] || null;
    }
    for (let i = 0; i < MAX_SOUNDS; i += 1) {
      const path = sv.configstrings[CS_SOUNDS + i] || "";
      client.cl.sound_precache[i] = path ? preserveSoundPrecacheHandle(client.cl.sound_precache[i], path) : null;
    }
    for (let i = 0; i < MAX_IMAGES; i += 1) {
      client.cl.image_precache[i] = sv.configstrings[CS_IMAGES + i] || null;
    }
  }
}

/**
 * Original name: SV_SendClientMessages demo read block
 * Source: server/sv_send.c
 * Category: Adapter
 * Purpose: Read one length-prefixed `.dm2` payload for the browser server host.
 */
function readDemoMessage(demofile: unknown): Uint8Array | null {
  if (!isDemoFileHandle(demofile)) {
    return null;
  }

  if (demofile.offset + 4 > demofile.bytes.length) {
    return null;
  }

  const view = new DataView(demofile.bytes.buffer, demofile.bytes.byteOffset, demofile.bytes.byteLength);
  const length = view.getInt32(demofile.offset, true);
  demofile.offset += 4;

  if (length === -1) {
    return null;
  }
  if (length < 0 || demofile.offset + length > demofile.bytes.length) {
    return null;
  }

  const payload = demofile.bytes.slice(demofile.offset, demofile.offset + length);
  demofile.offset += length;
  return payload;
}

function isDemoFileHandle(value: unknown): value is WebAppDemoFileHandle {
  return typeof value === "object"
    && value !== null
    && "bytes" in value
    && "offset" in value
    && (value as { bytes?: unknown }).bytes instanceof Uint8Array
    && typeof (value as { offset?: unknown }).offset === "number";
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Keep an existing registered sound backend handle when it still matches the server configstring path.
 */
function preserveSoundPrecacheHandle(current: unknown, path: string): unknown {
  if (typeof current === "string") {
    return current === path ? current : path;
  }

  if (typeof current === "object" && current !== null && "name" in current) {
    const name = (current as { name?: unknown }).name;
    if (typeof name === "string" && name === path) {
      return current;
    }
  }

  return path;
}

/**
 * Original name: N/A
 * Source: N/A (web server host bootstrap)
 * Category: New
 * Purpose: Provide temporary game exports until the ported game API is installed by the server facade.
 */
function createPlaceholderGameExports(): game_export_t {
  const worldspawn = createRuntimeEntity({}, 0);
  worldspawn.inuse = true;
  const player = createRuntimeEntity({}, 1);
  player.inuse = true;
  player.client = createGameClient();

  return {
    apiversion: 3,
    Init: () => undefined,
    Shutdown: () => undefined,
    SpawnEntities: () => undefined,
    WriteGame: () => undefined,
    ReadGame: () => undefined,
    WriteLevel: () => undefined,
    ReadLevel: () => undefined,
    ClientConnect: () => true,
    ClientConnectRejectMessage: () => "",
    ClientBegin: () => undefined,
    ClientUserinfoChanged: () => undefined,
    ClientDisconnect: () => undefined,
    ClientCommand: () => undefined,
    ClientThink: () => undefined,
    RunFrame: () => undefined,
    ServerCommand: () => undefined,
    edicts: [worldspawn, player],
    edict_size: 0,
    num_edicts: 2,
    max_edicts: 1024
  };
}

/**
 * Original name: N/A
 * Source: N/A (local helper)
 * Category: New
 * Purpose: Copy a local-client command snapshot without aliasing its angle tuple.
 */
function cloneUsercmd(cmd: usercmd_t): usercmd_t {
  return {
    msec: cmd.msec,
    buttons: cmd.buttons,
    angles: [cmd.angles[0], cmd.angles[1], cmd.angles[2]],
    forwardmove: cmd.forwardmove,
    sidemove: cmd.sidemove,
    upmove: cmd.upmove,
    impulse: cmd.impulse,
    lightlevel: cmd.lightlevel
  };
}

/**
 * Original name: N/A
 * Source: N/A (web save adapter helper)
 * Category: New
 * Purpose: Build normalized browser save-storage paths for server host callbacks.
 */
function buildSavePath(gamedir: string, savename: string, file: string): string {
  return `${gamedir}/save/${savename}/${file}`.replaceAll("\\", "/").replace(/\/+/g, "/").toLowerCase();
}

/**
 * Original name: N/A
 * Source: N/A (web save adapter helper)
 * Category: New
 * Purpose: Serialize server configstrings into the browser save-slot level payload.
 */
function encodeConfigStrings(configstrings: string[]): Uint8Array {
  const bytes = new Uint8Array(MAX_CONFIGSTRINGS * MAX_QPATH);
  for (let i = 0; i < MAX_CONFIGSTRINGS; i += 1) {
    writeFixedString(bytes, i * MAX_QPATH, MAX_QPATH, configstrings[i] ?? "");
  }
  return bytes;
}

/**
 * Original name: N/A
 * Source: N/A (web save adapter helper)
 * Category: New
 * Purpose: Restore server configstrings from the browser save-slot level payload.
 */
function decodeConfigStrings(configstrings: string[], payload: Uint8Array): void {
  for (let i = 0; i < MAX_CONFIGSTRINGS; i += 1) {
    configstrings[i] = readFixedString(payload, i * MAX_QPATH, MAX_QPATH);
  }
}

/**
 * Original name: N/A
 * Source: N/A (web save adapter helper)
 * Category: New
 * Purpose: Write one null-terminated fixed-width configstring into a binary save payload.
 */
function writeFixedString(target: Uint8Array, offset: number, length: number, value: string): void {
  const encoded = new TextEncoder().encode(value);
  target.fill(0, offset, offset + length);
  target.set(encoded.subarray(0, Math.max(0, length - 1)), offset);
}

/**
 * Original name: N/A
 * Source: N/A (web save adapter helper)
 * Category: New
 * Purpose: Read one null-terminated fixed-width configstring from a binary save payload.
 */
function readFixedString(source: Uint8Array, offset: number, length: number): string {
  let end = offset;
  const limit = Math.min(source.length, offset + length);
  while (end < limit && source[end] !== 0) {
    end += 1;
  }
  return new TextDecoder().decode(source.subarray(offset, end));
}

/**
 * Original name: N/A
 * Source: N/A (web save adapter helper)
 * Category: New
 * Purpose: Join binary save payload chunks before writing through browser storage.
 */
function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/**
 * Original name: N/A
 * Source: N/A (web server host adapter)
 * Category: New
 * Purpose: Expose the collision world loaded by the server facade through a stable adapter reference.
 */
function createDynamicCollisionWorld(runtime: CollisionModelRuntime): CollisionWorld {
  return new Proxy({} as CollisionWorld, {
    get: (_target, property) => {
      const world = runtime.world as unknown as Record<PropertyKey, unknown> | null;
      return world?.[property];
    },
    set: (_target, property, value) => {
      const world = runtime.world as unknown as Record<PropertyKey, unknown> | null;
      if (!world) {
        return false;
      }

      world[property] = value;
      return true;
    },
    has: (_target, property) => {
      const world = runtime.world as unknown as Record<PropertyKey, unknown> | null;
      return world ? property in world : false;
    },
    ownKeys: () => {
      const world = runtime.world as unknown as Record<PropertyKey, unknown> | null;
      return world ? Reflect.ownKeys(world) : [];
    },
    getOwnPropertyDescriptor: (_target, property) => {
      const world = runtime.world as unknown as Record<PropertyKey, unknown> | null;
      if (!world || !(property in world)) {
        return undefined;
      }

      return {
        configurable: true,
        enumerable: true,
        writable: true,
        value: world[property]
      };
    }
  });
}

/**
 * Original name: N/A
 * Source: N/A (web server host adapter)
 * Category: New
 * Purpose: Create a game runtime whose collision and engine callbacks are backed by the local server facade.
 */
function createServerBackedGameRuntime(world: CollisionWorld, imports: game_import_t) {
  const runtime = createGameRuntimeFromBspEntities([{ properties: { classname: "worldspawn" } }]);
  const bridge: GameCollisionBridge = {
    world,
    trace: (start, mins, maxs, end, passent, contentmask) =>
      imports.trace(start, mins, maxs, end, passent, contentmask),
    pointcontents: (point) => imports.pointcontents(point)
  };
  runtime.collision = bridge;
  runtime.engineLinkEntity = (entity) => {
    imports.linkentity(entity);
  };
  runtime.engineUnlinkEntity = (entity) => {
    imports.unlinkentity(entity);
  };
  runtime.engineImageIndex = (path) => imports.imageindex(path);
  return runtime;
}

/**
 * Original name: N/A
 * Source: N/A (web server host adapter)
 * Category: New
 * Purpose: Wrap game exports so early local frames tolerate missing collision during bootstrap only.
 */
function createCollisionTolerantGameApi(source: game_export_t, onPrint: (message: string) => void): game_export_t {
  const descriptors = Object.getOwnPropertyDescriptors(source);
  const wrapped = Object.create(Object.getPrototypeOf(source)) as game_export_t;
  Object.defineProperties(wrapped, descriptors);
  let reportedMissingCollision = false;

  wrapped.RunFrame = () => {
    try {
      source.RunFrame();
    } catch (error) {
      const message = error instanceof Error ? error.message : `${error}`;
      if (!message.includes("requires runtime collision bridge")) {
        throw error;
      }

      if (!reportedMissingCollision) {
        onPrint(`serveur local: frame gameplay ignoree (${message}).`);
        reportedMissingCollision = true;
      }
    }
  };

  return wrapped;
}
