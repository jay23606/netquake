// Everyday store operations for the asset database. Schema definition,
// versioning and upgrade/migration logic live in indexeddb.schema.ts.
import type { AssetMeta, PackageMeta } from './types/Store';
import type {SourceId} from './types/Source'
import {
  open,
  metaStoreName,
  assetStoreName,
  packageStoreName,
  packageSourceIdIndex,
  gameAndFileIndex,
  gameIndex
} from './indexeddb.schema'
import type { DbAssetMeta } from './indexeddb.schema'

// Re-export so consumers keep a single entry point (live binding: updates
// made during a reset are visible through this re-export).
export { wasReset } from './indexeddb.schema'

// SHA-256 hex of a buffer, or null when crypto.subtle is unavailable
// (non-secure context, e.g. a plain-http dev origin).
export const sha256Hex = async (data: ArrayBuffer): Promise<string | null> => {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return null
  const digest = await subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

const promiseMe = <T>(request: IDBRequest): Promise<T> => {
  return new Promise((resolve, reject) =>  {
    request.onerror = function(e) {
      console.log(e);
      reject(e);
    };
    request.onsuccess = function(event) {
      resolve(request.result as T);
    };
  })
}

const dbOperation = async <T>(storeName: string, fn: (db: IDBObjectStore) => IDBRequest): Promise<T> => {
  const db = await open()
  const store = db
    .transaction([storeName], 'readwrite')
    .objectStore(storeName); 

  return promiseMe<T>(fn(store))
}

// Unfiltered read of every asset meta row, including rows belonging to
// packages whose install never finished. Only cleanup paths and per-package
// queries should use this; user-facing reads go through getAllMeta.
const getAllMetaRaw = async (): Promise<Array<AssetMeta>> => {
  const db = await open()

  var transaction = db.transaction(['meta'], 'readonly');
  var meta = transaction.objectStore('meta');

  // Select the first matching record, if any exists, assume game exists
  const allKeys = await promiseMe<string[]>(meta.getAllKeys())

  return Promise.all(allKeys.map(async key => {
    const metaObj = await promiseMe<DbAssetMeta>(meta.get(key))

    return {
      ...metaObj,
      assetId: key
    }
  }))
}

const getIncompletePackageIds = async (): Promise<Set<number>> => {
  const pkgs = await getAllPackagesRaw()
  return new Set(pkgs.filter(p => p.complete === false).map(p => p.packageId))
}

// Public reads hide the assets of packages whose install never finished
// (complete:false), so the UI and engine can never enumerate a partial
// install. Cleanup (removePackage) uses the raw variant so it can still
// find those assets to delete them.
export const getAllMeta = async (): Promise<Array<AssetMeta>> => {
  const [assetMetas, incomplete] = await Promise.all([getAllMetaRaw(), getIncompletePackageIds()])
  if (incomplete.size === 0) return assetMetas
  return assetMetas.filter(meta => meta.packageId == null || !incomplete.has(meta.packageId))
}


export const getAllMetaPerGame = async (game: string): Promise<AssetMeta[]> => {
  const assetMetas = await getAllMeta()
  return assetMetas.filter(meta => meta.game === game.toLowerCase())
}

// Deliberately unfiltered: callers query a specific package they already
// hold a row for, and removePackage must see a partial install's assets.
export const getAllMetaPerPackageId = async (packageId: number) => {
  const assetMetas = await getAllMetaRaw()
  return assetMetas.filter(meta => meta.packageId === packageId)
}

export const getAllAssets = async () => {
  return dbOperation(assetStoreName, store => store.getAll())
}

export const getAllAssetsPerGame = async (game: string) => {
  const assetMetas = await getAllMetaPerGame(game)
  
  return Promise.all(assetMetas.map(async assetMeta => {
    const asset = await dbOperation<{data: ArrayBuffer}>(assetStoreName, store => store.get(assetMeta.assetId))
    return {
      ...assetMeta,
      ...asset
    }
  }))
}


export const getAsset = async (game: string, fileName : string) => {
  const db = await open()
  const range = IDBKeyRange.only([game.toLowerCase(), fileName.toLowerCase()])

  // Tx 1: meta lookup. Issue both requests synchronously so the txn stays
  // alive until both complete (Chrome auto-commits at the first await if
  // there are no pending requests).
  const metaTx = db.transaction([metaStoreName], 'readonly')
  const metaIdx = metaTx.objectStore(metaStoreName).index(gameAndFileIndex)
  const metaReq = metaIdx.get(range)
  const keyReq = metaIdx.getKey(range)
  const [assetMeta, assetId] = await Promise.all([
    promiseMe<DbAssetMeta | undefined>(metaReq),
    promiseMe<number | undefined>(keyReq),
  ])
  if (!assetMeta || assetId == null) return null

  // Tx 2: payload lookup in a fresh txn.
  const assetRec = await dbOperation<{ data: ArrayBuffer, assetId: number } | undefined>(
    assetStoreName, store => store.get(assetId)
  )
  if (!assetRec) {
    // Orphan meta record (saveAsset historically used two txns; a crash
    // between them could leave meta with no payload). Clean up so we
    // re-download instead of looping.
    console.warn(`[indexeddb] orphan meta for ${game}/${fileName} (assetId=${assetId}) — removing`)
    try {
      await dbOperation(metaStoreName, store => store.delete(assetId))
    } catch (e) {
      console.warn('[indexeddb] failed to clean orphan meta:', e)
    }
    return null
  }
  return { ...assetMeta, ...assetRec }
}

export const saveAsset = async (game: string, fileName: string, fileCount: number, blob: ArrayBuffer, packageId: number | null) => {
  if (!game || !fileName) {
    throw new Error('Missing data while trying to save asset')
  }
  const gameLc = game.toLowerCase()
  const fileNameLc = fileName.toLowerCase()
  // Hash before opening the transaction — awaiting a non-IDB promise inside
  // an open transaction lets it auto-commit out from under us.
  const sha256 = fileNameLc.endsWith('.pak') ? await sha256Hex(blob) : null
  const metaObj: DbAssetMeta = {
    game: gameLc,
    fileName: fileNameLc,
    fileCount,
    fileSize: blob.byteLength,
    ...(packageId && { packageId }),
    ...(sha256 && { sha256 })
  }
  try {
    // Atomic write across both stores so we never produce orphan meta records.
    const db = await open()
    const tx = db.transaction([metaStoreName, assetStoreName], 'readwrite')
    const metaStore = tx.objectStore(metaStoreName)
    const assetStore = tx.objectStore(assetStoreName)

    // The (game, fileName) index is unique, so writes must be idempotent:
    // reuse the existing row's key when the file is already present instead of
    // inserting a duplicate, which throws ConstraintError and aborts the whole
    // install. This covers a re-install, a package overlapping another in the
    // same gameDir, and a zip whose entries resolve to the same destination —
    // last write wins, matching Quake's later-pak-overrides-earlier order.
    const existingKey = await promiseMe<number | undefined>(
      metaStore.index(gameAndFileIndex).getKey(IDBKeyRange.only([gameLc, fileNameLc]))
    )
    let assetId: number
    if (existingKey != null) {
      await promiseMe(metaStore.put(metaObj, existingKey))
      assetId = existingKey
    } else {
      assetId = await promiseMe<number>(metaStore.put(metaObj))
    }
    await promiseMe(assetStore.put({ data: blob, assetId }))
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
    return assetId
  }
  catch(e) {
    console.log(`failed trying to save ${game} ${fileName}`)
    throw e
  }
}

export const updateAssetFileName = async (assetId: string, newFileName: string): Promise<void> => {
  const db = await open()
  const transaction = db.transaction([metaStoreName], 'readwrite')
  const metaStore = transaction.objectStore(metaStoreName)
  
  const existingMeta = await promiseMe<DbAssetMeta>(metaStore.get(assetId))
  if (!existingMeta) {
    throw new Error(`Asset with ID ${assetId} not found`)
  }
  
  const updatedMeta: DbAssetMeta = {
    ...existingMeta,
    fileName: newFileName.toLowerCase()
  }
  
  await promiseMe(metaStore.put(updatedMeta, assetId))
}

export const updateAssetChecksum = async (assetId: string, sha256: string): Promise<void> => {
  const id = parseInt(assetId)
  const db = await open()
  const transaction = db.transaction([metaStoreName], 'readwrite')
  const metaStore = transaction.objectStore(metaStoreName)

  const existingMeta = await promiseMe<DbAssetMeta>(metaStore.get(id))
  if (!existingMeta) {
    throw new Error(`Asset with ID ${assetId} not found`)
  }

  await promiseMe(metaStore.put({ ...existingMeta, sha256 }, id))
}

export const removeAsset = async (assetId: string): Promise<void> => {
  const id = parseInt(assetId)
  await dbOperation(metaStoreName, store => store.delete(id))
  return await dbOperation(assetStoreName, store => store.delete(id))
}

export const hasGame = async (game: string) => {
  const db = await open()

  var transaction = db.transaction(['meta'], 'readonly');
  var meta = transaction.objectStore('meta');
  var index = meta.index(gameIndex);

  // Select the first matching record, if any exists, assume game exists
  const assetMeta = await promiseMe<DbAssetMeta>(index.get(IDBKeyRange.only(game.toLowerCase())))
  return !!assetMeta
}

export const removeGame = async (game: string) => {
  const db = await open()

  var transaction = db.transaction([metaStoreName, assetStoreName], 'readwrite')
  var metas = transaction.objectStore(metaStoreName)
  var assets = transaction.objectStore(assetStoreName)
  var metaGameIndex = metas.index(gameIndex)

  const assetMetaKeys = await promiseMe<number[]>(metaGameIndex.getAllKeys(IDBKeyRange.only(game.toLowerCase())))

  return Promise.all(assetMetaKeys.map((key: number) =>
    Promise.all([
      promiseMe(assets.delete(key)),
      promiseMe(metas.delete(key))
    ])
  ))
}

export const savePackage = async (packageObj: Omit<PackageMeta, 'packageId'>): Promise<number> => {
  return dbOperation<number>(packageStoreName, store => store.put(packageObj))
}

// Read-modify-write of a package row inside a single readwrite transaction,
// so a concurrent update can't slip between the read and the write.
export const updatePackage = async (packageId: number, patch: Partial<Omit<PackageMeta, 'packageId'>>): Promise<void> => {
  const db = await open()
  const store = db
    .transaction([packageStoreName], 'readwrite')
    .objectStore(packageStoreName)
  const pkg = await promiseMe<Omit<PackageMeta, 'packageId'> | undefined>(store.get(packageId))
  if (!pkg) throw new Error(`Package ${packageId} not found`)
  await promiseMe(store.put({ ...pkg, ...patch }, packageId))
}

export const updatePackageName = (packageId: number, name: string): Promise<void> =>
  updatePackage(packageId, { name })

// Final step of an install: flips the package row from complete:false to
// complete:true once every asset has been written. Readers treat a row left
// at false as an interrupted install (see maps store).
export const markPackageComplete = (packageId: number): Promise<void> =>
  updatePackage(packageId, { complete: true })

export const getPackageBySourceId = async (sourceId: SourceId): Promise<PackageMeta | null> => {
  const db = await open()
  const transaction = db.transaction([packageStoreName], 'readonly')
  const packageStore = transaction.objectStore(packageStoreName)
  const index = packageStore.index(packageSourceIdIndex)

  // The package store uses out-of-line keys, so the record itself doesn't
  // carry its packageId — fetch key and value together (both requests issued
  // synchronously so the transaction stays alive until both complete).
  const dataReq = index.get(sourceId)
  const keyReq = index.getKey(sourceId)
  const [packageData, packageId] = await Promise.all([
    promiseMe<Omit<PackageMeta, 'packageId'> | undefined>(dataReq),
    promiseMe<number | undefined>(keyReq)
  ])
  if (!packageData || packageId == null) return null
  return { ...packageData, packageId }
}

export const getPackage = async (packageId: number): Promise<PackageMeta | null> => {
  try {
    const packageData = await dbOperation<PackageMeta>(packageStoreName, store => store.get(packageId))
    return packageData || null
  } catch {
    return null
  }
}

const getAllPackagesRaw = async (): Promise<PackageMeta[]> => {
  const db = await open()
  const transaction = db.transaction([packageStoreName], 'readonly')
  const packageStore = transaction.objectStore(packageStoreName)

  const allKeys = await promiseMe<number[]>(packageStore.getAllKeys())

  return Promise.all(allKeys.map(async key => {
    const packageObj = await promiseMe<Omit<PackageMeta, 'packageId'>>(packageStore.get(key))
    return {
      ...packageObj,
      packageId: key
    }
  }))
}

// Interrupted installs (complete:false) are hidden from listings; they are
// cleaned up when their sourceId is next loaded (maps store loadPackageMeta).
export const getAllPackages = async (): Promise<PackageMeta[]> => {
  const pkgs = await getAllPackagesRaw()
  return pkgs.filter(pkg => pkg.complete !== false)
}

export const removePackage = async (packageId: number): Promise<void> => {
  // Guard: getAllMetaPerPackageId(undefined) would match assets that have no
  // packageId at all — i.e. the base game paks — and delete them.
  if (packageId == null) {
    throw new Error('removePackage called without a packageId')
  }
  // Fetch the asset IDs in a separate read-only transaction first
  const assets = await getAllMetaPerPackageId(packageId)

  // Delete each asset's meta and data rows, then delete the package row
  await Promise.all(
    assets.map(asset => {
      const id = parseInt(asset.assetId)
      return Promise.all([
        dbOperation(metaStoreName, store => store.delete(id)),
        dbOperation(assetStoreName, store => store.delete(id)),
      ])
    })
  )
  await dbOperation(packageStoreName, store => store.delete(packageId))
}

