// Schema definition, versioning and upgrade/migration logic for the asset
// database. Everything that runs inside a versionchange transaction lives
// here; everyday store operations live in indexeddb.ts.

export type DbAssetMeta = {
  fileCount: number
  fileSize?: number
  fileName: string
  game: string
  packageId?: number
  // SHA-256 hex of the file contents; only present for .pak files.
  sha256?: string
}

export const dbName = 'webQuakeAssets',
  metaStoreName = 'meta',
  assetStoreName = 'asset',
  packageStoreName = 'package',
  dbVersion = 6;

// globalThis.indexedDB resolves on both the main thread (window) and inside a
// Web Worker (self) — the server Worker imports this module via assetStore.
const indexedDb: IDBFactory = globalThis.indexedDB
export const packageSourceIdIndex = "sourceId"
export const gameAndFileIndex = "game, filename"
export const gameIndex = "game"

const requiredStores = [metaStoreName, assetStoreName, packageStoreName]

export let wasReset = false

export function open (): Promise<IDBDatabase> {
  return openInternal(true)
}

// allowReset guards against unbounded recursion: after one reset attempt the
// database must open cleanly or the error is surfaced to the caller.
function openInternal (allowReset: boolean): Promise<IDBDatabase> {
  return new Promise(function(resolve, reject){
    var openReq: IDBOpenDBRequest = indexedDb.open(dbName, dbVersion);
    let upgradeFailed = false
    openReq.onupgradeneeded = function(event: any) {
      var db = event.target.result as IDBDatabase;
      var trans = openReq.transaction;
      if (event.oldVersion < 4) {
        db.createObjectStore("meta", { autoIncrement: true });
        db.createObjectStore("assets", { keyPath: 'assetId' });
      }
      if (event.oldVersion < 5) {
        var metaStore = trans.objectStore("meta");
        metaStore.createIndex(gameIndex, "game", { unique: false });
        metaStore.createIndex(gameAndFileIndex, ["game", "fileName"], { unique: false });
      }
      if (event.oldVersion < 6) {
        // Deliberately not awaited: onupgradeneeded must return
        // synchronously or the versionchange transaction can auto-commit
        // half way through. The migration keeps the transaction alive by
        // always having a request in flight; if it fails we abort the
        // transaction so the version bump and any partial schema change
        // roll back together instead of committing an inconsistent db.
        migrateToVersion6(db, trans).catch(function(error) {
          console.error('[indexeddb] v6 migration failed, rolling back upgrade:', error)
          upgradeFailed = true
          try { trans.abort() } catch (e) { /* transaction already finished */ }
        })
      }
    };
    openReq.onblocked = function() {
      console.warn('[indexeddb] open blocked by another tab holding an old connection')
    };
    openReq.onerror = function() {
      const error = openReq.error
      // An aborted upgrade leaves the db at the old version, so retrying
      // would fail the same way forever. Reset to a clean, empty database
      // instead — consistent-but-empty beats half-migrated.
      if (allowReset && (upgradeFailed || (error && error.name === 'AbortError'))) {
        resetDatabase().then(resolve, reject)
        return
      }
      reject(error || new Error('Failed to open IndexedDB'))
    };
    openReq.onsuccess = function(event: any){
      const db = event.target.result as IDBDatabase;
      // Connections are opened per-operation and never closed; release this
      // one when an upgrade or reset needs the database so it can't block
      // them forever.
      db.onversionchange = () => db.close()
      const missing = requiredStores.some(s => !db.objectStoreNames.contains(s));
      if (missing) {
        db.close();
        if (allowReset) {
          resetDatabase().then(resolve, reject)
        } else {
          reject(new Error('Database is missing required stores after reset'))
        }
        return;
      }
      resolve(db);
    };
  });
}

function resetDatabase (): Promise<IDBDatabase> {
  return new Promise(function(resolve, reject) {
    const deleteReq = indexedDb.deleteDatabase(dbName)
    deleteReq.onblocked = function() {
      console.warn('[indexeddb] reset blocked by another tab holding an old connection')
    }
    deleteReq.onsuccess = function() {
      wasReset = true
      openInternal(false).then(resolve, reject)
    }
    deleteReq.onerror = function() {
      reject(new Error('Failed to reset corrupted database'))
    }
  })
}

// Like the operations-side promiseMe, but calls preventDefault on failure so
// a failed request doesn't abort the surrounding transaction. Used during
// migration, where per-record failures are handled explicitly and must not
// tear down the whole versionchange transaction as a side effect.
const softRequest = <T>(request: IDBRequest): Promise<T> => {
  return new Promise((resolve, reject) => {
    request.onerror = function(e) {
      e.preventDefault();
      reject(request.error);
    };
    request.onsuccess = function() {
      resolve(request.result as T);
    };
  })
}

/*
New Schema (v6):
package: (autoIncrement)
  packageId
  name
  game
  type: 'map' | 'mod'
meta: (autoIncrement)
  packageId
  fileName
  game
asset: (keyPath: assetId)
  assetId
  data
*/
const migrateToVersion6 = async (db: IDBDatabase, trans: IDBTransaction) => {
  const getAssetV5 = async (fileName: string): Promise<DbAssetMeta & {data: ArrayBuffer} | null> => {
    try {
      var meta = trans.objectStore('meta');
      var assets = trans.objectStore('assets');
      var index = meta.index(gameAndFileIndex);
      const range = IDBKeyRange.only(['id1', fileName.toLowerCase()])

      // Select the first matching record
      const [assetMeta, assetId] = await Promise.all([
        softRequest<DbAssetMeta | undefined>(index.get(range)),
        softRequest<number | undefined>(index.getKey(range))
      ])
      if (!assetMeta || assetId == null)
        return null
      const asset = await softRequest<{data: ArrayBuffer} | undefined>(assets.get(assetId))
      if (!asset || !asset.data)
        return null
      return { ...assetMeta, ...asset }
    } catch (error) {
      // Best effort: losing a cached pak is recoverable (the user can
      // re-add it), so a bad record must not fail the schema upgrade.
      console.error(`[indexeddb] could not read ${fileName} from v5 database:`, error)
      return null
    }
  }

  // 1. Read the assets worth keeping out of the old stores. getAssetV5
  // never rejects, so this cannot abort the upgrade.
  const id1AssetsToRetain = ['pak0.pak', 'pak1.pak']
  const id1Assets = await Promise.all(id1AssetsToRetain.map(getAssetV5))

  // 2. Recreate the schema. This block is synchronous: it either completes
  // in full or throws, which aborts the upgrade transaction and rolls the
  // database back to v5 (handled by the caller).
  db.deleteObjectStore('meta')
  db.deleteObjectStore('assets')

  var metaStore = db.createObjectStore("meta", { autoIncrement: true })
  metaStore.createIndex(gameIndex, "game", { unique: false });
  metaStore.createIndex(gameAndFileIndex, ["game", "fileName"], { unique: true });

  const assetStore = db.createObjectStore("asset", { keyPath: 'assetId' })
  const packageStore = db.createObjectStore("package", { autoIncrement: true });
  packageStore.createIndex(gameIndex, "game", { unique: false });
  packageStore.createIndex(packageSourceIdIndex, "sourceId", { unique: true });

  // 3. Copy the retained assets into the new stores, keeping meta/asset
  // rows paired: if the payload write fails, the meta row is removed again
  // so the committed database never references a missing asset.
  for (const asset of id1Assets) {
    if (!asset || !asset.game || !asset.fileName)
      continue
    const metaObj: DbAssetMeta = {
      game: asset.game.toLowerCase(),
      fileName: asset.fileName.toLowerCase(),
      fileCount: asset.fileCount
    }
    let assetId: number | null = null
    try {
      assetId = await softRequest<number>(metaStore.put(metaObj))
      await softRequest(assetStore.put({data: asset.data, assetId}))
    } catch (error) {
      console.error(`[indexeddb] could not migrate ${asset.fileName} to v6:`, error)
      if (assetId != null) {
        try { await softRequest(metaStore.delete(assetId)) } catch (e) { /* best effort */ }
      }
    }
  }
}
