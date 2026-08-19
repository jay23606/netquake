/**
 * File: web-save-storage.ts
 * Purpose: Persist logical Quake II savegame files for the browser web-app host.
 *
 * This file is not a direct source port.
 * It is a web adapter for `baseq2/save/...` logical files used by `sv_ccmds.ts`.
 *
 * Dependencies:
 * - packages/client menu slot shape
 */

import { MAX_SAVEGAMES, type ClientMenuSaveSlot } from "../../../packages/client/src/menu-types.js";

/**
 * Original name: N/A
 * Source declaree: N/A (web save storage namespace)
 * Category: New
 * Purpose: Prefix logical save-file paths stored in the browser backend.
 */
const STORAGE_PREFIX = "quake2js:save:";

/**
 * Original name: N/A
 * Source declaree: N/A (web save storage encoding)
 * Category: New
 * Purpose: Tag browser storage entries that contain text save payloads.
 */
const TEXT_PREFIX = "txt:";

/**
 * Original name: N/A
 * Source declaree: N/A (web save storage encoding)
 * Category: New
 * Purpose: Tag browser storage entries that contain base64 binary save payloads.
 */
const BINARY_PREFIX = "b64:";

/**
 * Original name: N/A
 * Source declaree: N/A (web save adapter contract)
 * Category: New
 * Purpose: Expose logical savegame file persistence without leaking browser APIs into engine packages.
 */
export interface WebSaveStorage {
  readBinary: (path: string) => Uint8Array | null;
  writeBinary: (path: string, data: Uint8Array) => boolean;
  readText: (path: string) => string | null;
  writeText: (path: string, contents: string) => boolean;
  remove: (path: string) => void;
  exists: (path: string) => boolean;
  listFiles: (pattern: string) => string[];
  createPath: (path: string) => void;
  wipeSavegame: (gamedir: string, savename: string) => void;
  copySaveGame: (gamedir: string, src: string, dst: string) => void;
  getSaveSlots: (gamedir: string) => Array<ClientMenuSaveSlot | null>;
}

/**
 * Original name: N/A
 * Source declaree: N/A (browser storage adapter)
 * Category: New
 * Purpose: Keep the localStorage-compatible backend replaceable for tests and future web storage backends.
 */
export interface WebSaveStorageBackend {
  readonly length: number;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  key: (index: number) => string | null;
}

/**
 * Original name: N/A
 * Source declaree: N/A (web save adapter)
 * Category: New
 * Purpose: Build a browser-backed logical save storage adapter for apps/web and server callbacks.
 */
export function createWebSaveStorage(storage: WebSaveStorageBackend | null = getDefaultStorage()): WebSaveStorage {
  const readRaw = (path: string): string | null => storage?.getItem(toSaveStorageKey(path)) ?? null;
  const writeRaw = (path: string, value: string): boolean => {
    if (!storage) {
      return false;
    }

    try {
      storage.setItem(toSaveStorageKey(path), value);
      return true;
    } catch {
      return false;
    }
  };

  return {
    readBinary: (path) => {
      const raw = readRaw(path);
      if (raw === null) {
        return null;
      }

      if (raw.startsWith(BINARY_PREFIX)) {
        return base64ToBytes(raw.slice(BINARY_PREFIX.length));
      }

      if (raw.startsWith(TEXT_PREFIX)) {
        return new TextEncoder().encode(raw.slice(TEXT_PREFIX.length));
      }

      return null;
    },
    writeBinary: (path, data) => writeRaw(path, `${BINARY_PREFIX}${bytesToBase64(data)}`),
    readText: (path) => {
      const raw = readRaw(path);
      if (raw === null) {
        return null;
      }

      if (raw.startsWith(TEXT_PREFIX)) {
        return raw.slice(TEXT_PREFIX.length);
      }

      if (raw.startsWith(BINARY_PREFIX)) {
        return new TextDecoder().decode(base64ToBytes(raw.slice(BINARY_PREFIX.length)));
      }

      return null;
    },
    writeText: (path, contents) => writeRaw(path, `${TEXT_PREFIX}${contents}`),
    remove: (path) => {
      storage?.removeItem(toSaveStorageKey(path));
    },
    exists: (path) => readRaw(path) !== null,
    listFiles: (pattern) => {
      if (!storage) {
        return [];
      }

      const matcher = wildcardToRegExp(normalizeSavePath(pattern));
      const found: string[] = [];
      for (const path of listLogicalPaths(storage)) {
        if (matcher.test(path)) {
          found.push(path);
        }
      }
      return found.sort();
    },
    createPath: () => undefined,
    wipeSavegame: (gamedir, savename) => {
      if (!storage) {
        return;
      }

      const prefix = `${normalizeSavePath(gamedir)}/save/${normalizeSavePath(savename)}/`;
      for (const path of listLogicalPaths(storage)) {
        if (path.startsWith(prefix)) {
          storage.removeItem(toSaveStorageKey(path));
        }
      }
    },
    copySaveGame: (gamedir, src, dst) => {
      if (!storage) {
        return;
      }

      const normalizedGamedir = normalizeSavePath(gamedir);
      const srcPrefix = `${normalizedGamedir}/save/${normalizeSavePath(src)}/`;
      const dstPrefix = `${normalizedGamedir}/save/${normalizeSavePath(dst)}/`;
      const copies: Array<{ path: string; value: string }> = [];

      for (const path of listLogicalPaths(storage)) {
        if (!path.startsWith(srcPrefix)) {
          continue;
        }

        const value = storage.getItem(toSaveStorageKey(path));
        if (value !== null) {
          copies.push({ path: `${dstPrefix}${path.slice(srcPrefix.length)}`, value });
        }
      }

      for (const path of listLogicalPaths(storage)) {
        if (path.startsWith(dstPrefix)) {
          storage.removeItem(toSaveStorageKey(path));
        }
      }

      for (const copy of copies) {
        storage.setItem(toSaveStorageKey(copy.path), copy.value);
      }
    },
    getSaveSlots: (gamedir) => {
      const normalizedGamedir = normalizeSavePath(gamedir);
      const slots = Array.from({ length: MAX_SAVEGAMES }, () => null as ClientMenuSaveSlot | null);

      for (let i = 0; i < MAX_SAVEGAMES; i += 1) {
        const serverFile = `${normalizedGamedir}/save/save${i}/server.ssv`;
        const bytes = readRaw(serverFile);
        if (bytes === null) {
          continue;
        }

        const data = bytes.startsWith(BINARY_PREFIX)
          ? base64ToBytes(bytes.slice(BINARY_PREFIX.length))
          : new TextEncoder().encode(bytes.startsWith(TEXT_PREFIX) ? bytes.slice(TEXT_PREFIX.length) : bytes);
        const label = readFixedAscii(data, 0, 32) || `save${i}`;
        slots[i] = { label, valid: true };
      }

      return slots;
    }
  };
}

/**
 * Original name: N/A
 * Source declaree: N/A (web save storage key)
 * Category: New
 * Purpose: Map a logical Quake save path to the browser storage namespace.
 */
export function toSaveStorageKey(path: string): string {
  return `${STORAGE_PREFIX}${normalizeSavePath(path)}`;
}

/**
 * Original name: N/A
 * Source declaree: N/A (web save path helper)
 * Category: New
 * Purpose: Normalize browser-facing logical save paths before storage lookup.
 */
function normalizeSavePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+/g, "/").toLowerCase();
}

/**
 * Original name: N/A
 * Source declaree: N/A (web save storage listing)
 * Category: New
 * Purpose: Enumerate logical save paths from the browser storage namespace.
 */
function listLogicalPaths(storage: WebSaveStorageBackend): string[] {
  const paths: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key?.startsWith(STORAGE_PREFIX)) {
      paths.push(key.slice(STORAGE_PREFIX.length));
    }
  }
  return paths;
}

/**
 * Original name: N/A
 * Source declaree: N/A (web save path matcher)
 * Category: New
 * Purpose: Convert Quake-style single-segment wildcard save patterns into regular expressions.
 */
function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^/]*");
  return new RegExp(`^${escaped}$`);
}

/**
 * Original name: N/A
 * Source declaree: N/A (web save slot helper)
 * Category: New
 * Purpose: Read null-terminated fixed-width ASCII save comments from server save payloads.
 */
function readFixedAscii(bytes: Uint8Array, offset: number, length: number): string {
  let end = offset;
  const limit = Math.min(bytes.length, offset + length);
  while (end < limit && bytes[end] !== 0) {
    end += 1;
  }
  return new TextDecoder("ascii").decode(bytes.subarray(offset, end)).trimEnd();
}

/**
 * Original name: N/A
 * Source declaree: N/A (web save binary codec)
 * Category: New
 * Purpose: Encode save payload bytes for browser string storage and Node-based tests.
 */
function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  return Buffer.from(bytes).toString("base64");
}

/**
 * Original name: N/A
 * Source declaree: N/A (web save binary codec)
 * Category: New
 * Purpose: Decode browser string storage payloads back into save bytes.
 */
function base64ToBytes(value: string): Uint8Array {
  if (typeof atob === "function") {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  return new Uint8Array(Buffer.from(value, "base64"));
}

/**
 * Original name: N/A
 * Source declaree: N/A (browser storage adapter)
 * Category: New
 * Purpose: Access browser localStorage behind a replaceable adapter boundary.
 */
function getDefaultStorage(): WebSaveStorageBackend | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
