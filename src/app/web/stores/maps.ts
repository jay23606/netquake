import axios from 'axios'
import JSZip from '@progress/jszip-esm'
import * as indexedDb from '../../../shared/indexeddb'
import {any, tail, find, prop} from 'ramda'
import {QuaddictedMap} from '../types/QuaddictedMap'
import { defineStore } from 'pinia'
import { useGameStore } from './game'
import { getMapFilenames, readPackFile } from '../helpers/assetChecker'
import type { PackageMeta, PackageMetaSeed } from '../../../shared/types/Store'
import type { SourceId } from '../../../shared/types/Source'
import { isMap } from '../helpers/map'

var mapListingPromise: Promise<void> | null = null
// De-dupes concurrent installs per sourceId — used both for top-level
// loadMap calls and for `depends` base packages, so two maps sharing a base
// can never run two installs of it in parallel.
var inflightLoads: Map<SourceId, Promise<PackageMeta>> = new Map()

// Cancellation token scoped to a whole loadMap run (metadata fetches,
// depends install, download, unzip, save). cancelLoad flips `cancelled`;
// every phase boundary checks it, so a cancel at any point unwinds through
// the partial-package cleanup instead of letting the install finish.
type LoadCancelToken = {
  cancelled: boolean
  // Aborts the network request currently in flight, if any.
  abort: (() => void) | null
}
// One token per active load, keyed by top-level sourceId. The progress UI is
// shared across loads, so the cancel button means "stop installing" and
// cancelLoad cancels every active token.
var activeTokens: Map<SourceId, LoadCancelToken> = new Map()

const throwIfCancelled = (token: LoadCancelToken) => {
  if (token.cancelled) {
    throw new DOMException('Load cancelled', 'AbortError')
  }
}

const dedupeLoad = (sourceId: SourceId, start: () => Promise<PackageMeta>): Promise<PackageMeta> => {
  const existing = inflightLoads.get(sourceId)
  if (existing) return existing
  const load = start().finally(() => inflightLoads.delete(sourceId))
  inflightLoads.set(sourceId, load)
  return load
}

// Shared install contract for every package source (download, zip import,
// file import): write the row as complete:false, run the asset writes, and
// only then flip it to complete. On any failure or cancel the partial
// package is removed, so a committed row can never claim to be installed
// while missing assets.
const installPackageAssets = async (
  pkg: PackageMetaSeed,
  saveAssets: (packageId: number) => Promise<void>
): Promise<PackageMeta> => {
  const packageId = await indexedDb.savePackage(pkg)
  try {
    await saveAssets(packageId)
    await indexedDb.markPackageComplete(packageId)
  } catch (error) {
    await indexedDb.removePackage(packageId).catch(e =>
      console.error(`[maps] failed to clean up partial package ${packageId}:`, e))
    throw error
  }
  return { packageId, ...pkg, complete: true }
}

const quaddictedMapsUrl = '/api/maps'
// const quaddictedMapsUrl = 'http://localhost:3000/api/maps'

type MapLoadState = 'loading' | 'idle' | 'error'
// Phase is the typed source of truth for what the loaded/total numbers mean:
// bytes while downloading, files while unzipping. Components must not infer
// it from the display message.
type LoadPhase = 'idle' | 'download' | 'unzip'
type LoadProgress = {
  phase: LoadPhase
  loaded: number
  total: number
  message: string
}

interface State {
  mapListing: QuaddictedMap[]
  mapLoadState: MapLoadState
  mapLoadProgress: LoadProgress
}

export const useMapsStore = defineStore('maps', {
  state: (): State => ({
    mapListing: [],
    mapLoadState: 'idle',
    mapLoadProgress: {
      phase: 'idle',
      loaded: 0,
      total: 0,
      message: ''
    }
  }),
  getters: {
    getMapListing: (state: State) => state.mapListing,
    getMapLoadProgress: (state: State) => state.mapLoadProgress,
    // Single monotonic 0-100 value spanning download (0-90) and unzip
    // (90-100); null when nothing is loading. This is what gets forwarded to
    // other players, whose UI only understands a ratio.
    getOverallLoadPercent: (state: State): number | null => {
      const { phase, loaded, total } = state.mapLoadProgress
      if (phase === 'idle' || !total) return null
      const frac = Math.min(1, loaded / total)
      return Math.round(phase === 'unzip' ? 90 + frac * 10 : frac * 90)
    },
    getMapFromId: (state: State) => (id: string): QuaddictedMap => find<QuaddictedMap>(map => map.id === id, state.mapListing)!
  },
  actions: {
    setMapLoadState (mapLoadState: MapLoadState) {
      this.mapLoadState = mapLoadState
    },
    setMapListing (mapListing: QuaddictedMap[])  {
      this.mapListing = mapListing
    },
    setMapLoadProgress ({loaded, total, message, phase}: {loaded?: number, total?: number, message?: string, phase?: LoadPhase}) {
      this.mapLoadProgress.loaded = loaded || loaded === 0 ? loaded : this.mapLoadProgress.loaded
      this.mapLoadProgress.total = total || total === 0 ? total : this.mapLoadProgress.total
      this.mapLoadProgress.message = message || message === '' ? message : this.mapLoadProgress.message
      if (phase) this.mapLoadProgress.phase = phase
    },
    async getMapListForPackage (packageId: number) {
      const assets = await indexedDb.getAllMetaPerPackageId(packageId)
      
      // Get map names from .bsp files
      const bspMaps = assets.filter(a => isMap(a.fileName))
        .map(a => a.fileName.replace(/^maps\//, '').replace(/\.bsp$/, ''))
      
      // Get map names from .pak files
      const pakAssets = assets.filter(a => a.fileName.toLowerCase().endsWith('.pak'))
      const pakMapPromises = pakAssets.map(async (pakAsset) => {
        const asset = await indexedDb.getAsset(pakAsset.game, pakAsset.fileName)
        if (asset && asset.data) {
          return getMapFilenames(asset.data)
        }
        return []
      })
      
      const pakMaps = (await Promise.all(pakMapPromises)).flat()
      // Combine and deduplicate map names
      const allMaps = [...new Set([...bspMaps, ...pakMaps])]
      return allMaps
    },
    // Returns the package only if its install finished. A row still marked
    // complete:false is a leftover from an interrupted install (e.g. the tab
    // was closed mid-save) — remove it so it gets re-downloaded cleanly.
    // Rows from before the flag existed have no `complete` field and are
    // trusted as-is.
    async loadPackageMeta (sourceId: SourceId): Promise<PackageMeta | null> {
      const pkg = await indexedDb.getPackageBySourceId(sourceId)
      if (!pkg) return null
      if (pkg.complete === false) {
        console.warn(`[maps] removing interrupted install of ${sourceId} (packageId=${pkg.packageId})`)
        await indexedDb.removePackage(pkg.packageId)
        return null
      }
      return pkg
    },
    loadMapListing () { 
      if (!mapListingPromise) {
        mapListingPromise = axios.get<QuaddictedMap[]>(quaddictedMapsUrl)
          .then(response => this.setMapListing(response.data))
      }
      return mapListingPromise
    },
    loadMap (sourceId: SourceId): Promise<PackageMeta> {
      return dedupeLoad(sourceId, () => this.loadMapInternal(sourceId))
    },
    async loadMapInternal (sourceId: SourceId): Promise<PackageMeta> {
      const gameStore = useGameStore()
      let packageMeta = await this.loadPackageMeta(sourceId);
      if (!packageMeta) {
        const token: LoadCancelToken = { cancelled: false, abort: null }
        activeTokens.set(sourceId, token)
        try {
          this.mapLoadState = 'loading'
          const mapsMeta = await this.downloadSourceMetadata(sourceId)
          throwIfCancelled(token)
          let gameDir = mapsMeta.gameDir || 'id1'
          if (mapsMeta.depends){
            const baseSourceId: SourceId = `quaddicted:${mapsMeta.depends}`
            let dependsPackageMeta = await this.loadPackageMeta(baseSourceId)
            throwIfCancelled(token)
            if (!dependsPackageMeta) {
              const basePkg = await this.installDependency(baseSourceId, token)
              gameDir = basePkg.gameDir // Use the dependent package as the gamedir.
            } else {
              // The map must land in its base package's gameDir even when the
              // base was installed earlier.
              gameDir = dependsPackageMeta.gameDir
            }
          }
          packageMeta = await this.downloadPackage(sourceId, mapsMeta, gameDir, token)

          gameStore.loadAssets()
        } finally {
          if (activeTokens.get(sourceId) === token) activeTokens.delete(sourceId)
          this.mapLoadState = 'idle'
          this.setMapLoadProgress({ loaded: 0, total: 0, message: '', phase: 'idle' })
        }
      }
      return packageMeta
    },
    // Base packages go through the same per-sourceId dedupe as loadMap, so
    // two maps sharing a `depends` can't both install the base (its sourceId
    // has a unique index). The second caller just awaits the first install.
    installDependency (baseSourceId: SourceId, token: LoadCancelToken): Promise<PackageMeta> {
      return dedupeLoad(baseSourceId, async () => {
        const baseMeta = await this.downloadSourceMetadata(baseSourceId)
        throwIfCancelled(token)
        return this.downloadPackage(baseSourceId, baseMeta, undefined, token)
      })
    },
    async downloadSourceMetadata (sourceId: SourceId) {
      const [source, mapID] = sourceId.split(':')

      const baseUrl = source === 'quaddicted' || source === 'slipseer'
      ? quaddictedMapsUrl
      : ''

      if (!baseUrl) throw new Error('Unknown source ' + source)

      const url = baseUrl + '/' + mapID
      return prop('data', await axios.get(url)) as QuaddictedMap
    },
    cancelLoad () {
      for (const token of activeTokens.values()) {
        token.cancelled = true
        token.abort?.()
      }
      activeTokens.clear()
      this.mapLoadState = 'idle'
      this.setMapLoadProgress({ loaded: 0, total: 0, message: '', phase: 'idle' })
    },
    async importFiles (name: string, files: { path: string; file: File }[], gameDir?: string): Promise<PackageMeta> {
      const gameStore = useGameStore()
      const resolvedGameDir = gameDir ?? randomSlug()
      const paths = files.map(f => f.path)
      const fixedPaths = fixBaseDir(paths) as string[]
      const sourceId: SourceId = `custom:${Math.random().toString(36).substring(2, 15)}`
      const pkg: PackageMetaSeed = { sourceId, name, gameDir: resolvedGameDir, depends: null, complete: false }
      // Sequential so a failure can't race in-flight writes against cleanup.
      const packageMeta = await installPackageAssets(pkg, async (packageId) => {
        for (let idx = 0; idx < files.length; ++idx) {
          const buf = await files[idx].file.arrayBuffer()
          await saveToIndexedDb(resolvedGameDir, fixedPaths[idx], buf, packageId)
        }
      })
      await gameStore.loadAssets()
      return packageMeta
    },
    async importZipFile (file: File): Promise<PackageMeta> {
      const gameStore = useGameStore()
      const buf = await file.arrayBuffer()

      // @ts-ignore
      const zip = new JSZip()
      await zip.loadAsync(buf)

      const files = Object.keys(zip.files).filter(f => !zip.files[f].dir)
      if (files.length === 0) {
        throw new Error(`${file.name} contains no files`)
      }

      const rootFolder = detectRootFolder(files)
      const gameDir = rootFolder ?? randomSlug()

      // Strip the root folder prefix before fixing paths
      const strippedFiles = rootFolder
        ? files.map(f => f.slice(rootFolder.length + 1))
        : files
      const fixedPaths = fixBaseDir(strippedFiles) as string[]

      const name = file.name.replace(/\.zip$/i, '')
      const sourceId: SourceId = `custom:${Math.random().toString(36).substring(2, 15)}`
      const pkg: PackageMetaSeed = { sourceId, name, gameDir, depends: null, complete: false }

      // Sequential so a failure can't race in-flight writes against cleanup.
      const packageMeta = await installPackageAssets(pkg, async (packageId) => {
        for (let idx = 0; idx < files.length; ++idx) {
          const entry = zip.file(files[idx])
          if (!entry) continue
          const buffer: ArrayBuffer = await entry.async('arraybuffer')
          await saveToIndexedDb(gameDir, fixedPaths[idx], buffer, packageId)
        }
      })

      await gameStore.loadAssets()
      return packageMeta
    },
    async downloadPackage (sourceId: SourceId, mapsMeta: QuaddictedMap, gameDir: string | undefined, token: LoadCancelToken): Promise<PackageMeta> {
      // Cancellation is honoured in every phase: during download it aborts
      // the request, afterwards the token checks stop the install before the
      // package row is written, mid-unzip, or before it is marked complete —
      // in each case the partial package gets cleaned up below.
      const { promise, abort } = getBinaryData(mapsMeta.downloadLink, mapsMeta.byteLength, (loaded, total) => {
        if (!token.cancelled)
          this.setMapLoadProgress({loaded, total, message: `Downloading ${mapsMeta.fileName}...`, phase: 'download'})
      })
      token.abort = abort
      try {
        const arrayBuf = await promise
        throwIfCancelled(token)

        // @ts-ignore
        const zip = new JSZip()
        await zip.loadAsync(arrayBuf)

        // Server-side zip inspection is authoritative when present: install
        // exactly the listed entries at their given destinations, skipping
        // anything unlisted (junk files never make it into the hints).
        // Without hints, fall back to client-side layout heuristics.
        const hints = mapsMeta.extractionHints
        let useHints = !!hints && Object.keys(hints).length > 0

        // Ignore entries marked as directories
        const allFiles = Object.keys(zip.files).filter(f => !zip.files[f].dir)
        let files = useHints ? allFiles.filter(f => !!hints![f]) : allFiles
        if (useHints && files.length === 0) {
          // Hints that match no zip entry at all are malformed (e.g. legacy
          // prefix-style extractmapping from an older server build) — fall
          // back to the layout heuristics rather than failing the install.
          console.warn(`[maps] extractionHints matched no entries in ${mapsMeta.fileName}; using layout heuristics instead`)
          useHints = false
          files = allFiles
        }
        if (files.length === 0) {
          // Never install an asset-less package — it would be trusted as a
          // finished install forever and the map would simply not exist.
          throw new Error(`Archive ${mapsMeta.fileName} contains no files`)
        }

        const fixedFilePaths = useHints ? files.map(f => hints![f]) : fixBaseDir(files)
        const pkg: PackageMetaSeed = {
          sourceId,
          depends: mapsMeta.depends,
          gameDir: gameDir || mapsMeta.gameDir || 'id1',
          name: mapsMeta.title || mapsMeta.name,
          // The row is written before its assets; it only becomes trusted
          // once markPackageComplete flips this after the last asset lands.
          complete: false
        }

        // Don't write the package row at all if the user cancelled during
        // the zip parse.
        throwIfCancelled(token)
        this.setMapLoadProgress({ loaded: 0, total: files.length, message: `Unzipping ${mapsMeta.fileName}...`, phase: 'unzip' })
        // Unzip and save sequentially: memory stays bounded to one
        // decompressed file at a time, progress is monotonic, and a failure
        // can't race in-flight writes against the partial-install cleanup.
        return await installPackageAssets(pkg, async (packageId) => {
          let done = 0
          for (let idx = 0; idx < files.length; ++idx) {
            throwIfCancelled(token)
            const file = zip.file(files[idx])
            if (!file) { ++done; continue }
            // Quantize to whole per-file percents — JSZip fires the callback
            // per decompressed chunk, which is far too chatty for reactive
            // state that gets forwarded to the room server.
            let lastPct = -1
            const buffer: ArrayBuffer = await file.async('arraybuffer', (meta: { percent: number }) => {
              const pct = Math.floor(meta.percent)
              if (pct !== lastPct && !token.cancelled) {
                lastPct = pct
                this.setMapLoadProgress({ loaded: done + pct / 100, total: files.length })
              }
            })
            await saveToIndexedDb(pkg.gameDir, fixedFilePaths[idx], buffer, packageId)
            ++done
            if (!token.cancelled)
              this.setMapLoadProgress({ loaded: done, total: files.length })
          }
          // A cancel that lands after the last file must still discard the
          // install rather than complete it.
          throwIfCancelled(token)
        })
      } finally {
        token.abort = null
      }
    }
  }
})

const getBinaryData = (url: string, total: number, progress: (loaded: number, total: number) => void): { promise: Promise<ArrayBuffer>, abort: () => void } => {
  const xhr = new XMLHttpRequest()
  const promise = new Promise<ArrayBuffer>((resolve, reject) => {
    xhr.open('GET', url)
    xhr.responseType = 'arraybuffer'
    xhr.onload = () => {
      // Guard against handing an error page to the unzipper.
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as ArrayBuffer)
      } else {
        reject(new Error(`Download failed: HTTP ${xhr.status} for ${url}`))
      }
    }
    xhr.onerror = () => reject(new Error(`Download failed: network error for ${url}`))
    xhr.onabort = () => reject(new DOMException('Download cancelled', 'AbortError'))
    xhr.addEventListener('progress', e => progress(e.loaded, total))
    xhr.send()
  })
  return { promise, abort: () => xhr.abort() }
}

const randomSlug = () => 'pkg' + Math.random().toString(36).substring(2, 9)

// Returns the common root folder name if all entries share one, otherwise null.
const detectRootFolder = (files: string[]): string | null => {
  if (!files.length) return null
  const segments = files.map(f => f.split('/'))
  const first = segments[0][0]
  return segments.every(s => s.length > 1 && s[0] === first) ? first : null
}

const anyFirstElementContains = (searchTerm: string) =>
  any((fa: string[]) => fa.length > 0 && fa[0].toLowerCase().indexOf(searchTerm) > -1)

const anyFirstElementIs = (searchTerm: string) =>
  any((fa: string[]) => fa.length > 0 && fa[0].toLowerCase() === searchTerm)

const fixBaseDir = (fileList: string[]) => {
  const hasAMapAtRoot = anyFirstElementContains('.bsp')
  const hasMapDirAtRoot = anyFirstElementIs('maps')
  const hasPakFileAtRoot = anyFirstElementContains('.pak')

  let fileArrays = fileList.map(file => file.split('/'))
  while (true) {
    if (hasAMapAtRoot(fileArrays)) {
      return fileArrays.map(fa => ['maps'].concat(fa).join('/'))
    } else if (hasMapDirAtRoot(fileArrays) || hasPakFileAtRoot(fileArrays)) {
      return fileArrays.map(fa => fa.join('/'))
    } else if (!fileArrays.some(fa => fa.length > 1)) {
      return fileArrays.map(fa => fa.join('/'))
    }
    
    // Remove dir and try again.
    fileArrays = fileArrays.map(fa => fa.length > 1 ? tail(fa) : fa)
  }
}

const saveToIndexedDb = async (gameDir: string, fileName: string, data: ArrayBuffer, packageId?: number) => {
  let fileCount = 0
  if (fileName.toLowerCase().includes('pak')) {
    const pak = readPackFile(data)
    fileCount = pak.length
  }
  return indexedDb.saveAsset(gameDir, fileName, fileCount, data, packageId || null)
}