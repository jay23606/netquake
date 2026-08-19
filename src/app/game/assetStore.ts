import * as draw from '../../engine/draw'
import * as q from '../../engine/q'
import * as crc from '../../engine/crc'
import * as com from '../../engine/com'
import * as sys from '../../engine/sys'
import * as con from '../../engine/console'
import * as indexeddb from '../../shared/indexeddb'
import axios from 'axios'
import { FileMode } from '../../engine/interfaces/store/IAssetStore'
import { PackedFile, PakData, SearchPath } from '../../engine/types/Com'

// Small text files (config.cfg / autoexec.cfg / legacy save shadows) live in
// localStorage on the main thread. The server Worker has no localStorage, and
// doesn't need to persist config — an in-memory fallback lets it read defaults
// and no-op writes without crashing. globalThis.localStorage is used so both
// realms resolve identically.
const kvStore: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> =
  (typeof globalThis !== 'undefined' && (globalThis as any).localStorage)
    ? (globalThis as any).localStorage
    : (() => {
        const m = new Map<string, string>()
        return {
          getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
          setItem: (k: string, v: string) => { m.set(k, v) },
          removeItem: (k: string) => { m.delete(k) },
        }
      })()

const keepItToId1 = ['config.cfg', 'autoexec.cfg']
const remoteIndexes: Record<string, {fileName: string}[]> = {}

// Loose files (IndexedDB / network) copied into memory so loadFileSync can
// serve them. Keyed `${dir}/${filename}`, lowercase. Pak contents are not
// cached here — pak data is already memory-resident and sliced on demand.
const residentFiles: Map<string, ArrayBuffer> = new Map()

// Names of every loose (non-pak) asset per game dir, INCLUDING ones too big to hold
// resident. loadFileSync consults this so it can tell "this dir doesn't have the file"
// apart from "this dir has it but not in memory" — without it, a non-resident loose file
// makes the sync lookup fall through to a LOWER-priority dir's pak and silently return a
// different file of the same name (id1's maps/start.bsp instead of a mod's).
const looseIndex: Map<string, Set<string>> = new Map()

const noteLoose = (dir: string, filename: string) => {
  let set = looseIndex.get(dir)
  if (set == null) { set = new Set(); looseIndex.set(dir, set) }
  set.add(filename.toLowerCase())
}

const makeResident = (dir: string, filename: string, data: ArrayBuffer) => {
  residentFiles.set(dir + '/' + filename.toLowerCase(), data)
  noteLoose(dir, filename)
}

type ProgressCallback = (current: number, total: number) => void
const checkRemoteFileList = async function (game: string, fileName: string) : Promise<boolean> {
  if (!remoteIndexes[game]) {
    try {
      remoteIndexes[game] = (await axios.get(`${import.meta.env.BASE_URL}gamedata/${game}.json`)).data
    } catch (err) {
      sys.print('Error getting asset index from server: '+ err.message + '\n')
      remoteIndexes[game] = []
    }
  }
  return remoteIndexes[game].some(f => f.fileName === fileName)
}

function getBinarySize (url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    var xhr = new XMLHttpRequest();
    xhr.open("HEAD", url, true); // Notice "HEAD" instead of "GET",
                                 //  to get only the header
    xhr.onreadystatechange = function() {
      if (this.readyState == this.DONE) {
        return xhr.status === 200
          ? resolve(+xhr.getResponseHeader("Content-Length"))
          : reject(new Error(`HEAD ${url} failed: status ${xhr.status}`))
      }
    };
    // Reject with an Error, not the raw ProgressEvent: an Event carries no message and serializes to
    // {"isTrusted":true} in error reports (see errorReporting.describeReason), losing the URL entirely.
    xhr.onerror = () => reject(new Error(`HEAD ${url} failed: network error`))
    xhr.send();
  })
}

const getFileWithProgress = (url: string, progress: ProgressCallback) : Promise<any> => {
  return getBinarySize(url)
    .then((total: number) => {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.overrideMimeType('text\/plain; charset=x-user-defined')
        xhr.open('GET', url)
        xhr.onload = () => {
          return xhr.status === 200
            ? resolve(q.strmem(xhr.responseText))
            : reject(new Error(`GET ${url} failed: status ${xhr.status}`))

        }
        xhr.onerror = () => reject(new Error(`GET ${url} failed: network error`))
        xhr.addEventListener('progress', e => {
          progress(e.loaded, total)
        });
        xhr.send()
      })
    })
}

const getFile = async function(file: string) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.overrideMimeType('text\/plain; charset=x-user-defined');
    xhr.open('GET', file);
    xhr.onload = () => {
      resolve({
        status: xhr.status,
        responseText: xhr.responseText
      });
    }
    xhr.onerror = () => reject(new Error(`GET ${file} failed: network error`))
    xhr.send();
  });
};

export const openFile = (filename: string, mode: FileMode) => {
  return Promise.resolve(true)
}
export const readFile = (filename: string) => {
	throw new Error('Not Implemented')
}
export const writeFile = (filename: string, data: Uint8Array, len: number) =>
{
  filename = filename.toLowerCase();
  var dest: string[] = [], i;
  for (i = 0; i < len; ++i)
    dest[i] = String.fromCharCode(data[i]);
  try
  {
    kvStore.setItem('Quake.' + com.state.searchpaths[com.state.searchpaths.length - 1].dir + '/' + filename, dest.join(''));
  }
  catch (e)
  {
    sys.print('COM.WriteFile: failed on ' + filename + '\n');
    return Promise.resolve(false);
  }
  sys.print('COM.WriteFile: ' + filename + '\n');
  return Promise.resolve(true);
};

export const writeTextFile = async (filename: string, data: string): Promise<boolean> =>
{
  filename = filename.toLowerCase();
  const dir = keepItToId1.indexOf(filename) > -1
    ? 'id1'
    : com.state.searchpaths[com.state.searchpaths.length - 1].dir

  // Savegames go to IndexedDB: multi-MB .sav files blow the ~5MB localStorage
  // quota (a swallowed QuotaExceededError here used to leave the previous save
  // in place while reporting success). saveAsset appends a new row per call, so
  // replace any existing row or getAsset would keep returning the oldest one.
  if (filename.endsWith('.sav'))
  {
    try
    {
      const buf = q.strmem(data)
      const existing = await indexeddb.getAsset(dir, filename)
      if (existing != null)
        await indexeddb.removeAsset(String(existing.assetId))
      await indexeddb.saveAsset(dir, filename, 1, buf, null)
      makeResident(dir, filename, buf)
      // drop any pre-migration localStorage copy so it can't shadow this save
      kvStore.removeItem('Quake.' + dir + '/' + filename)
    }
    catch (e)
    {
      sys.print('COM.WriteTextFile: failed on ' + filename + '\n');
      return false;
    }
    sys.print('COM.WriteTextFile: ' + filename + '\n');
    return true;
  }

  try
  {
    kvStore.setItem('Quake.' + dir + '/' + filename, data);
  }
  catch (e)
  {
    sys.print('COM.WriteTextFile: failed on ' + filename + '\n');
    return false;
  }
  sys.print('COM.WriteTextFile: ' + filename + '\n');
  return true;
};

export const deleteFile = async (filename: string): Promise<void> =>
{
  filename = filename.toLowerCase();
  for (var i = com.state.searchpaths.length - 1; i >= 0; --i)
  {
    const dir = com.state.searchpaths[i].dir
    kvStore.removeItem('Quake.' + dir + '/' + filename)
    residentFiles.delete(dir + '/' + filename)
    const existing = await indexeddb.getAsset(dir, filename)
    if (existing != null)
      await indexeddb.removeAsset(String(existing.assetId))
  }
};

const getLocalStorage = (game: string, filename: string) => {
  const path = game + '/' + filename;
  const data = kvStore.getItem('Quake.' + path);
  if (data != null)
  {
    sys.print('FindFile: ' + path + '\n');
    return q.strmem(data);
  }
  return null
}
const _loadFile = async (filename: string) : Promise<ArrayBuffer | null> => {
  filename = filename.toLowerCase();
  var i, j, search: SearchPath;
  
  for (i = com.state.searchpaths.length - 1; i >= 0; --i)
  {
    search = com.state.searchpaths[i];
    if (keepItToId1.indexOf(filename) > -1 && search.dir !== 'id1') {
      continue
    }

    const data = getLocalStorage(search.dir, filename)
    if (data) {
      return data
    }

    // Higher-numbered paks override lower ones (pak2 beats pak1), matching
    // Quake's COM_FindFile — later paks are searched first. Iterate in reverse.
    for (j = search.packs.length - 1; j >= 0; j--) {
      const pack = search.packs[j]
      if (pack.type === 'indexeddb' && pack.data) {
        const file = pack.contents.find(p => p.name === filename)
        if (!file) {
          continue
        }

        return pack.data.slice(file.filepos, file.filepos + file.filelen);
      }
    }

    // try indexedDb.
    const tryIndexedDb = await indexeddb.getAsset(search.dir, filename)
    if (tryIndexedDb) {
      makeResident(search.dir, filename, tryIndexedDb.data)
      return tryIndexedDb.data
    }
    const netpath = search.dir + '/' + filename;

    // Problem is - if there's a  "game" search path, 
    // we end up searching the server
    // for ALL id1 assets. IS this necessary?
    // It's "only" necessary if the server is serving mods.
    // Ok HOw can we tell?
    // I donno...
    // 
    // Joe - I think I figured it out - just ask the server for a file list..
    if (await checkRemoteFileList(search.dir, netpath)) {
      const gotFile = await getFile('/' + netpath) as any;
      if ((gotFile.status >= 200) && (gotFile.status <= 299))
      {
        sys.print('FindFile: ' + netpath + '\n');
        const buf = q.strmem(gotFile.responseText);
        makeResident(search.dir, filename, buf)
        return buf;
      }
    }
  }

  // As a workaround to the above, lets only search the server if we can't
  // find it in known packs
  // @ts-ignore - VITE_ALLOW_SERVER_DOWNLOADS is a vite env variable
  if (import.meta.env.VITE_ALLOW_SERVER_DOWNLOADS === 'true') {
    for (i = com.state.searchpaths.length - 1; i >= 0; --i) {
      search = com.state.searchpaths[i];
      const netpath = search.dir + '/' + filename;
      const gotFile = await getFile('/' + netpath) as any;
      if ((gotFile.status >= 200) && (gotFile.status <= 299))
      {
        sys.print('FindFile: ' + netpath + '\n');
        const buf = q.strmem(gotFile.responseText);
        makeResident(search.dir, filename, buf)
        return buf;
      }
    }
  }

  sys.print('FindFile: can\'t find ' + filename + '\n');
  return null
};

export const loadFileSync = (filename: string): ArrayBuffer | null => {
  filename = filename.toLowerCase();
  for (var i = com.state.searchpaths.length - 1; i >= 0; --i)
  {
    const search = com.state.searchpaths[i];
    if (keepItToId1.indexOf(filename) > -1 && search.dir !== 'id1') {
      continue
    }

    const data = getLocalStorage(search.dir, filename)
    if (data) {
      return data
    }

    // Higher-numbered paks override lower ones (pak2 beats pak1), matching COM_FindFile
    // and _loadFile above. Iterate in reverse.
    for (var j = search.packs.length - 1; j >= 0; j--) {
      const pack = search.packs[j]
      if (pack.data) {
        const file = pack.contents.find(p => p.name === filename)
        if (file) {
          return pack.data.slice(file.filepos, file.filepos + file.filelen);
        }
      }
    }

    const resident = residentFiles.get(search.dir + '/' + filename)
    if (resident) {
      return resident
    }

    // This dir owns the file as a loose asset but it isn't in memory. Report a MISS
    // rather than continuing to a lower-priority dir, whose pak may hold an unrelated
    // file of the same name. Callers treat null as "fetch it async first" (sv.spawnServer
    // / cl.loadAllPrecaches), which resolves it correctly and makes it resident.
    if (looseIndex.get(search.dir)?.has(filename)) {
      return null
    }
  }
  return null
};

// Loose files at or above this size are not held resident: the eager preload
// skips them and mod.loadBrushModel evicts them after parsing. The async load
// paths (cl.loadAllPrecaches / sv.spawnServer) re-fetch on demand before the
// sync parse path needs them.
const RESIDENT_MAX_EAGER_BYTES = 32 * 1024 * 1024

export const preloadResidentFiles = async (): Promise<void> => {
  residentFiles.clear()
  looseIndex.clear()
  for (const search of com.state.searchpaths) {
    const assets = await indexeddb.getAllAssetsPerGame(search.dir)
    for (const asset of assets) {
      if (asset.fileName.toLowerCase().endsWith('.pak'))
        continue
      // Index the name even when the bytes are too big to hold resident — that is
      // exactly the case loadFileSync must not mistake for "this dir doesn't have it".
      noteLoose(search.dir, asset.fileName)
      if (asset.data.byteLength >= RESIDENT_MAX_EAGER_BYTES)
        continue
      makeResident(search.dir, asset.fileName, asset.data)
    }
  }
};

export const evictResidentFile = (filename: string): void => {
  const f = filename.toLowerCase()
  for (const search of com.state.searchpaths)
    residentFiles.delete(search.dir + '/' + f)
};

export const loadFile = async (filename: string) : Promise<ArrayBuffer | null> => {
  draw.beginDisc(filename);

  const data = await _loadFile(filename)
  draw.endDisc();
  return data
}

const getPackFileContents = (game: string, name: string, data: ArrayBuffer): PackedFile[] => {
  var header = new DataView(data);
  if (header.getUint32(0, true) !== 0x4b434150)
    sys.error(game + ':'+ name + ' from indexedDb is not a packfile');
  var dirofs = header.getUint32(4, true);
  var dirlen = header.getUint32(8, true);
  var numpackfiles = dirlen >> 6;
  if (numpackfiles !== 339)
    com.state.modified = true;
  var pack:PackedFile[] = [];
  if (numpackfiles !== 0)
  {
    var info = new DataView(data, dirofs, dirlen);
    if (crc.block(new Uint8Array(data, dirofs, dirlen)) !== 32981)
      com.state.modified = true;
    var i;
    for (i = 0; i < numpackfiles; ++i)
    {
      pack.push({
        name: q.memstr(new Uint8Array(data, dirofs +  (i << 6), 56)).toLowerCase(),
        filepos: info.getUint32((i << 6) + 56, true),
        filelen: info.getUint32((i << 6) + 60, true)
      });
    }

    con.print('Added packfile ' + name + ' (' + numpackfiles + ' files)\n');
  }
  return pack;
}

const loadStorePackFile = async (game: string, packName: string): Promise<PakData | null> => {
  let entry
  try {
    entry = await indexeddb.getAsset(game, packName)

    if (!entry) {
      return null
    }
  } catch{
    return null
  }

  return {
    name: entry.fileName,
    data: entry.data,
    type: 'indexeddb',
    contents: getPackFileContents(game, entry.fileName, entry.data)
  }
}

const loadServerPackFile = async (game: string, packName: string) : Promise<PakData | null> => {
  const packfile = game + '/' + packName

  try {
    // In dev the index comes from production, which cannot know about locally-installed mod dirs;
    // let the fetch answer instead (a miss 404s -> catch -> null, ending the pak0..N loop).
    // @ts-ignore - import.meta.env is a vite-only global (src/app is excluded from tsconfig.node.json)
    if (!import.meta.env.DEV && !await checkRemoteFileList(game, packfile)) {
      return null
    }
    const data = await getFileWithProgress(`${import.meta.env.BASE_URL}gamedata/${packfile}`, (current, total) => {
      // TODO UI Progress
    })
    if (!data) {
      return null
    }
    var dataDv = new DataView(data);
    if (dataDv.getUint32(0, true) !== 0x4b434150){
      con.print(packfile + ' is not a packfile');
      return null
    }
    var dirlen = dataDv.getUint32(8, true);
    var numpackfiles = dirlen >> 6;
    if (numpackfiles !== 339)
      com.state.modified = true;

    await indexeddb.saveAsset(game, packName, numpackfiles, data, null)

    return {
      name: packName,
      data,
      type: 'indexeddb',
      contents: getPackFileContents(game, packName, data)!
    }
  } catch{
    return null
  }
}

export const saveDownloadedFile = async (game: string, filename: string, data: ArrayBuffer): Promise<void> => {
  await indexeddb.saveAsset(game, filename, 0, data, null)
  makeResident(game, filename, data)
}

export const loadPackFile = async (dir: string, packName: string) : Promise<PakData | null> => {
  let entry: PakData | null = await loadStorePackFile(dir, packName)
  if (!entry) {
    entry = await loadServerPackFile(dir, packName)
  }

  return entry
}