/**
 * File: pak-storage.ts
 * Purpose: Keep player-supplied Quake II pak files in the browser and mount
 * them alongside the demo data.
 *
 * This is not a source port. The demo pak ships with the site; retail data is
 * the player's own and is stored locally, never uploaded anywhere.
 */

const DB_NAME = "quake2js-paks";
const STORE = "paks";
const DB_VERSION = 1;

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB open failed"));
  });

const withStore = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> => {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("indexedDB request failed"));
    });
  } finally {
    db.close();
  }
};

/** A pak header is "PACK" plus a 64-byte-per-entry directory. */
export interface PakSummary {
  entries: number;
  bytes: number;
}

export function inspectPak(bytes: Uint8Array): PakSummary | null {
  if (bytes.length < 12) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (magic !== "PACK") return null;
  return { entries: view.getUint32(8, true) >> 6, bytes: bytes.length };
}

export async function saveUploadedPak(name: string, bytes: Uint8Array): Promise<void> {
  await withStore("readwrite", (store) => store.put(bytes, name) as IDBRequest<unknown>);
}

export async function listUploadedPaks(): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  try {
    const keys = await withStore("readonly", (store) => store.getAllKeys());
    const values = await withStore("readonly", (store) => store.getAll());
    keys.forEach((key, index) => {
      const value = values[index];
      if (typeof key === "string" && value instanceof Uint8Array) out.set(key, value);
    });
  } catch {
    // No stored paks, or storage unavailable (private mode): play the demo.
  }
  return out;
}

export async function clearUploadedPaks(): Promise<void> {
  await withStore("readwrite", (store) => store.clear() as IDBRequest<unknown>);
}
