/**
 * File: precache.ts
 * Source: Quake II original / client/cl_main.c
 * Purpose: Port the first client precache and autodownload traversal routines used before entering a map.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses injected hooks for local file access, map checksum queries and refresh/audio preparation.
 * - Keeps resumable precache counters inside the explicit client runtime instead of file-static globals.
 *
 * Notes:
 * - This file is intended to stay conceptually close to the original C source.
 */

import { parseMd2 } from "../../formats/src/index.js";
import {
  Cmd_Argc,
  Cmd_Argv,
  CS_IMAGES,
  CS_MAPCHECKSUM,
  CS_MODELS,
  CS_PLAYERSKINS,
  CS_SKY,
  CS_SOUNDS,
  MAX_CLIENTS,
  MAX_IMAGES,
  MAX_MODELS,
  MAX_QPATH,
  MAX_SOUNDS
} from "../../qcommon/src/index.js";
import type { CommandRuntime } from "../../qcommon/src/index.js";
import { CL_CheckOrDownloadFile, type ClientDownloadHooks } from "./download.js";
import { CL_WriteStringCmd } from "./cl_parse.js";
import { connstate_t, type ClientRuntime } from "./client.js";

/**
 * Original name: PLAYER_MULT
 * Source declaree: Quake-2-master/client/cl_main.c
 * Category: Ported
 */
export const PLAYER_MULT = 5;

/**
 * Original name: ENV_CNT
 * Source declaree: Quake-2-master/client/cl_main.c
 * Category: Ported
 */
export const ENV_CNT = CS_PLAYERSKINS + MAX_CLIENTS * PLAYER_MULT;

/**
 * Original name: TEXTURE_CNT
 * Source declaree: Quake-2-master/client/cl_main.c
 * Category: Ported
 */
export const TEXTURE_CNT = ENV_CNT + 13;

/**
 * Original name: env_suf
 * Source declaree: Quake-2-master/client/cl_main.c
 * Category: Ported
 */
export const env_suf = ["rt", "bk", "lf", "ft", "up", "dn"] as const;

/**
 * Original name: N/A
 * Source declaree: N/A (client precache hook contract)
 * Category: New
 * Purpose: Describe the host-side services needed by the partial client precache port.
 *
 * Constraints:
 * - Must keep the traversal deterministic even when map, filesystem or refresh backends are still partial.
 */
export interface ClientPrecacheHooks extends ClientDownloadHooks {
  allowDownload?: boolean;
  allowDownloadMaps?: boolean;
  allowDownloadModels?: boolean;
  allowDownloadPlayers?: boolean;
  allowDownloadSounds?: boolean;
  loadBinaryFile?: (filename: string) => Uint8Array | null;
  getMapInfo?: (mapPath: string) => { checksum: number | null; textureNames: string[] } | null;
  onPrepRefresh?: () => void;
  onRegisterSounds?: () => void;
  onBegin?: (spawncount: number) => void;
}

/**
 * Original name: CL_RequestNextDownload
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Advances the client precache traversal and queues exactly one missing download at a time.
 *
 * Porting notes:
 * - Reuses the partially ported `CL_CheckOrDownloadFile` helper.
 * - Uses hook-driven MD2/map loading until the filesystem and collision layers are fully integrated here.
 */
export function CL_RequestNextDownload(runtime: ClientRuntime, hooks: ClientPrecacheHooks = {}): void {
  if (runtime.cls.state !== connstate_t.ca_connected) {
    return;
  }

  const allowDownload = hooks.allowDownload ?? true;
  const allowDownloadMaps = hooks.allowDownloadMaps ?? true;
  const allowDownloadModels = hooks.allowDownloadModels ?? true;
  const allowDownloadPlayers = hooks.allowDownloadPlayers ?? true;
  const allowDownloadSounds = hooks.allowDownloadSounds ?? true;
  const precache = runtime.cls.precache;
  let loadedMapInfo: { checksum: number | null; textureNames: string[] } | null | undefined;

  if (!allowDownload && precache.precache_check < ENV_CNT) {
    precache.precache_check = ENV_CNT;
  }

  if (precache.precache_check === CS_MODELS) {
    precache.precache_check = CS_MODELS + 2;
    if (allowDownloadMaps) {
      const mapPath = runtime.cl.configstrings[CS_MODELS + 1];
      if (mapPath.length > 0 && !CL_CheckOrDownloadFile(runtime, mapPath, hooks)) {
        return;
      }
    }
  }

  if (precache.precache_check >= CS_MODELS && precache.precache_check < CS_MODELS + MAX_MODELS) {
    if (allowDownloadModels) {
      while (
        precache.precache_check < CS_MODELS + MAX_MODELS &&
        runtime.cl.configstrings[precache.precache_check].length > 0
      ) {
        const modelPath = runtime.cl.configstrings[precache.precache_check];
        if (modelPath.startsWith("*") || modelPath.startsWith("#")) {
          precache.precache_check += 1;
          continue;
        }

        if (precache.precache_model_skin === 0) {
          if (!CL_CheckOrDownloadFile(runtime, modelPath, hooks)) {
            precache.precache_model_skin = 1;
            return;
          }
          precache.precache_model_skin = 1;
        }

        const bytes = hooks.loadBinaryFile?.(modelPath) ?? null;
        if (bytes === null) {
          precache.precache_model_skin = 0;
          precache.precache_check += 1;
          continue;
        }

        const model = tryParseMd2(bytes, modelPath);
        if (model === null) {
          precache.precache_model_skin = 0;
          precache.precache_check += 1;
          continue;
        }

        while (precache.precache_model_skin - 1 < model.header.num_skins) {
          const skinIndex = precache.precache_model_skin - 1;
          const skinPath = model.skins[skinIndex] ?? "";
          if (skinPath.length > 0 && !CL_CheckOrDownloadFile(runtime, skinPath, hooks)) {
            precache.precache_model_skin += 1;
            return;
          }
          precache.precache_model_skin += 1;
        }

        precache.precache_model_skin = 0;
        precache.precache_check += 1;
      }
    }

    precache.precache_check = CS_SOUNDS;
  }

  if (precache.precache_check >= CS_SOUNDS && precache.precache_check < CS_SOUNDS + MAX_SOUNDS) {
    if (allowDownloadSounds) {
      if (precache.precache_check === CS_SOUNDS) {
        precache.precache_check += 1;
      }

      while (
        precache.precache_check < CS_SOUNDS + MAX_SOUNDS &&
        runtime.cl.configstrings[precache.precache_check].length > 0
      ) {
        const soundName = runtime.cl.configstrings[precache.precache_check];
        precache.precache_check += 1;

        if (soundName.startsWith("*")) {
          continue;
        }

        if (!CL_CheckOrDownloadFile(runtime, `sound/${soundName}`, hooks)) {
          return;
        }
      }
    }

    precache.precache_check = CS_IMAGES;
  }

  if (precache.precache_check >= CS_IMAGES && precache.precache_check < CS_IMAGES + MAX_IMAGES) {
    if (precache.precache_check === CS_IMAGES) {
      precache.precache_check += 1;
    }

    while (
      precache.precache_check < CS_IMAGES + MAX_IMAGES &&
      runtime.cl.configstrings[precache.precache_check].length > 0
    ) {
      const imageName = runtime.cl.configstrings[precache.precache_check];
      precache.precache_check += 1;
      if (!CL_CheckOrDownloadFile(runtime, `pics/${imageName}.pcx`, hooks)) {
        return;
      }
    }

    precache.precache_check = CS_PLAYERSKINS;
  }

  if (precache.precache_check >= CS_PLAYERSKINS && precache.precache_check < CS_PLAYERSKINS + MAX_CLIENTS * PLAYER_MULT) {
    if (allowDownloadPlayers) {
      while (precache.precache_check < CS_PLAYERSKINS + MAX_CLIENTS * PLAYER_MULT) {
        const playerIndex = Math.floor((precache.precache_check - CS_PLAYERSKINS) / PLAYER_MULT);
        const phase = (precache.precache_check - CS_PLAYERSKINS) % PLAYER_MULT;
        const clientSkin = runtime.cl.configstrings[CS_PLAYERSKINS + playerIndex];

        if (clientSkin.length === 0) {
          precache.precache_check = CS_PLAYERSKINS + (playerIndex + 1) * PLAYER_MULT;
          continue;
        }

        const parsed = parsePlayerSkin(clientSkin);
        const requests = [
          `players/${parsed.model}/tris.md2`,
          `players/${parsed.model}/weapon.md2`,
          `players/${parsed.model}/weapon.pcx`,
          `players/${parsed.model}/${parsed.skin}.pcx`,
          `players/${parsed.model}/${parsed.skin}_i.pcx`
        ];

        let advanced = false;
        for (let requestIndex = phase; requestIndex < requests.length; requestIndex += 1) {
          if (!CL_CheckOrDownloadFile(runtime, requests[requestIndex], hooks)) {
            precache.precache_check = CS_PLAYERSKINS + playerIndex * PLAYER_MULT + requestIndex + 1;
            return;
          }
          advanced = true;
        }

        if (advanced) {
          precache.precache_check = CS_PLAYERSKINS + (playerIndex + 1) * PLAYER_MULT;
        }
      }
    }

    precache.precache_check = ENV_CNT;
  }

  if (precache.precache_check === ENV_CNT) {
    precache.precache_check = ENV_CNT + 1;

    const mapPath = runtime.cl.configstrings[CS_MODELS + 1];
    const mapInfo = hooks.getMapInfo?.(mapPath) ?? null;
    loadedMapInfo = mapInfo;
    const expectedChecksum = Number.parseInt(runtime.cl.configstrings[CS_MAPCHECKSUM] ?? "", 10);
    if (
      mapInfo !== null &&
      mapInfo.checksum !== null &&
      Number.isFinite(expectedChecksum) &&
      mapInfo.checksum !== expectedChecksum
    ) {
      throw new Error(`Local map version differs from server: ${mapInfo.checksum} != '${runtime.cl.configstrings[CS_MAPCHECKSUM]}'`);
    }
  }

  if (precache.precache_check > ENV_CNT && precache.precache_check < TEXTURE_CNT) {
    if (allowDownload && allowDownloadMaps) {
      while (precache.precache_check < TEXTURE_CNT) {
        const index = precache.precache_check - ENV_CNT - 1;
        precache.precache_check += 1;
        const suffix = env_suf[Math.floor(index / 2)];
        const extension = (index & 1) !== 0 ? "pcx" : "tga";
        const envPath = `env/${runtime.cl.configstrings[CS_SKY]}${suffix}.${extension}`;
        if (!CL_CheckOrDownloadFile(runtime, envPath, hooks)) {
          return;
        }
      }
    }

    precache.precache_check = TEXTURE_CNT;
  }

  if (precache.precache_check === TEXTURE_CNT) {
    precache.precache_check = TEXTURE_CNT + 1;
    precache.precache_tex = 0;
  }

  if (precache.precache_check === TEXTURE_CNT + 1) {
    const mapPath = runtime.cl.configstrings[CS_MODELS + 1];
    const mapInfo = loadedMapInfo ?? hooks.getMapInfo?.(mapPath) ?? null;
    const textureNames = mapInfo?.textureNames ?? [];

    if (allowDownload && allowDownloadMaps) {
      while (precache.precache_tex < textureNames.length) {
        const texturePath = `textures/${textureNames[precache.precache_tex]}.wal`;
        precache.precache_tex += 1;
        if (!CL_CheckOrDownloadFile(runtime, texturePath, hooks)) {
          return;
        }
      }
    }

    precache.precache_check = TEXTURE_CNT + 999;
  }

  hooks.onRegisterSounds?.();
  hooks.onPrepRefresh?.();
  CL_WriteStringCmd(runtime, `begin ${precache.precache_spawncount}\n`);
  hooks.onBegin?.(precache.precache_spawncount);
}

/**
 * Original name: CL_Precache_f
 * Source: client/cl_main.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Starts or resumes the client precache/autodownload sequence before entering the level.
 *
 * Porting notes:
 * - Reads command args from the injected command runtime.
 * - Uses hook callbacks in place of direct refresh and sound registration calls.
 */
export function CL_Precache_f(
  runtime: ClientRuntime,
  cmd: CommandRuntime,
  hooks: ClientPrecacheHooks = {}
): void {
  if (Cmd_Argc(cmd) < 2) {
    hooks.getMapInfo?.(runtime.cl.configstrings[CS_MODELS + 1]);
    hooks.onRegisterSounds?.();
    hooks.onPrepRefresh?.();
    return;
  }

  runtime.cls.precache.precache_check = CS_MODELS;
  runtime.cls.precache.precache_spawncount = Number.parseInt(Cmd_Argv(cmd, 1), 10) || 0;
  runtime.cls.precache.precache_tex = 0;
  runtime.cls.precache.precache_model_skin = 0;

  CL_RequestNextDownload(runtime, hooks);
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Parse the Quake II `playerskins` configstring into model/skin components.
 */
function parsePlayerSkin(value: string): { model: string; skin: string } {
  const slashIndex = value.indexOf("\\");
  const raw = slashIndex >= 0 ? value.slice(slashIndex + 1) : value;
  const normalized = raw.replaceAll("\\", "/");
  const separatorIndex = normalized.indexOf("/");

  if (separatorIndex === -1) {
    return {
      model: truncateQPath(normalized || "male"),
      skin: "grunt"
    };
  }

  return {
    model: truncateQPath(normalized.slice(0, separatorIndex) || "male"),
    skin: truncateQPath(normalized.slice(separatorIndex + 1) || "grunt")
  };
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Parse one MD2 model defensively for precache skin enumeration.
 */
function tryParseMd2(bytes: Uint8Array, path: string): ReturnType<typeof parseMd2> | null {
  try {
    return parseMd2(bytes, path);
  } catch {
    return null;
  }
}

/**
 * Original name: N/A
 * Source declaree: N/A (local helper)
 * Category: New
 * Purpose: Clamp one model/skin token to Quake-style path expectations.
 */
function truncateQPath(value: string): string {
  return value.slice(0, MAX_QPATH);
}
