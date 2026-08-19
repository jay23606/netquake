/**
 * File: web-config-storage.ts
 * Purpose: Persist logical Quake II config files in the browser without exposing localStorage to engine packages.
 *
 * This file is not a direct source port.
 * It is a web adapter for logical files such as `baseq2/config.cfg`.
 *
 * Dependencies:
 * - packages/filesystem
 */

import {
  FS_Gamedir,
  readMountedTextFile,
  type VirtualFilesystem
} from "../../../packages/filesystem/src/index.js";

/**
 * Original name: N/A
 * Source declaree: N/A (web storage namespace)
 * Category: New
 * Purpose: Prefix logical config-file paths stored in the browser backend.
 */
const STORAGE_PREFIX = "quake2js:fs:";

/**
 * Original name: N/A
 * Source declaree: N/A (web adapter contract)
 * Category: New
 * Purpose: Expose logical text-file persistence without leaking browser APIs into engine packages.
 */
export interface WebConfigStorage {
  readText: (path: string) => string | null;
  writeText: (path: string, contents: string) => boolean;
  remove: (path: string) => void;
}

/**
 * Original name: N/A
 * Source declaree: N/A (browser storage adapter)
 * Category: New
 * Purpose: Keep the localStorage-compatible backend replaceable for tests and future web storage backends.
 */
export interface WebStorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

/**
 * Original name: N/A
 * Source declaree: N/A (web storage adapter)
 * Category: New
 * Purpose: Build a browser-backed logical config storage adapter for apps/web.
 */
export function createWebConfigStorage(storage: WebStorageLike | null = getDefaultStorage()): WebConfigStorage {
  return {
    readText: (path) => {
      if (!storage) {
        return null;
      }

      return storage.getItem(toConfigStorageKey(path));
    },
    writeText: (path, contents) => {
      if (!storage) {
        return false;
      }

      try {
        storage.setItem(toConfigStorageKey(path), contents);
        return true;
      } catch {
        return false;
      }
    },
    remove: (path) => {
      storage?.removeItem(toConfigStorageKey(path));
    }
  };
}

/**
 * Original name: N/A
 * Source declaree: N/A (web config overlay)
 * Category: New
 * Purpose: Resolve logical config text through browser persistence before falling back to mounted files.
 */
export function readWebConfigOrMountedText(
  storage: WebConfigStorage,
  filesystem: VirtualFilesystem,
  path: string
): string | null {
  const normalized = normalizeConfigPath(path);
  const gamedir = normalizeConfigPath(FS_Gamedir(filesystem));
  const candidates = buildConfigReadCandidates(normalized, gamedir);

  for (const candidate of candidates.storage) {
    const stored = storage.readText(candidate);
    if (stored !== null) {
      return stored;
    }
  }

  for (const candidate of candidates.mounted) {
    const mounted = readMountedTextFile(filesystem, candidate);
    if (mounted !== undefined) {
      return mounted;
    }
  }

  return null;
}

/**
 * Original name: N/A
 * Source declaree: N/A (web storage key)
 * Category: New
 * Purpose: Map a logical Quake file path to the browser storage namespace.
 */
export function toConfigStorageKey(path: string): string {
  return `${STORAGE_PREFIX}${normalizeConfigPath(path)}`;
}

/**
 * Original name: N/A
 * Source declaree: N/A (web config lookup helper)
 * Category: New
 * Purpose: Build storage and mounted-file candidates for current gamedir-aware config lookup.
 */
function buildConfigReadCandidates(path: string, gamedir: string): { storage: string[]; mounted: string[] } {
  const storage = path.includes("/")
    ? [path]
    : [`${gamedir}/${path}`, path];
  const mounted = path.startsWith(`${gamedir}/`)
    ? [path.slice(gamedir.length + 1), path]
    : [path];

  return {
    storage: unique(storage),
    mounted: unique(mounted)
  };
}

/**
 * Original name: N/A
 * Source declaree: N/A (web path helper)
 * Category: New
 * Purpose: Normalize browser-facing logical config paths before storage and VFS lookup.
 */
function normalizeConfigPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+/g, "/").toLowerCase();
}

/**
 * Original name: N/A
 * Source declaree: N/A (local collection helper)
 * Category: New
 * Purpose: Preserve first candidate order while removing empty values and duplicates.
 */
function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

/**
 * Original name: N/A
 * Source declaree: N/A (browser storage adapter)
 * Category: New
 * Purpose: Access browser localStorage behind a replaceable adapter boundary.
 */
function getDefaultStorage(): WebStorageLike | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
