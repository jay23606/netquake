import * as cmd from './cmd'
import * as con from './console'
import * as sys from './sys'
import * as cvar from './cvar'
import IAssetStore from './interfaces/store/IAssetStore'
import { PakData, SearchPath } from './types/Com'

var swaptest = new ArrayBuffer(2);
var swaptestview = new Uint8Array(swaptest);
swaptestview[0] = 1;
swaptestview[1] = 0;

export type ComState = {
  standard_quake: boolean
  argv: string[]
  searchpaths: SearchPath[]
  token: string
  modified: boolean
  assetStore: IAssetStore
  rogue: boolean
  hipnotic: boolean
  gamedir: SearchPath[],
  cmdline: string
  littleLong: (i: number) => number,
  bigendien: boolean
}
export let state: ComState = {
  standard_quake: true,
  argv: [],
  searchpaths: [],
  token: '',
  modified: false,
  assetStore: null,
  rogue: false,
  hipnotic: false,
  gamedir: [],
  cmdline: '',
  littleLong: (function(l) {return l;}),
  bigendien: ((new Uint16Array(swaptest))[0] !== 1)
}

export const longSwap = (l: number) => {
	return	((l>>24)&0x000000ff)|
			((l>> 8)&0x0000ff00)|
			((l<< 8)&0x00ff0000)|
			((l<<24)&0xff000000);
}

export const cvr: cvar.CVars = {
}

export const uuidv4 = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  })
}

const checkRegistered = async function() {
  var h = await state.assetStore.loadFile('gfx/pop.lmp');
  if (!h)
  {
    con.print('Playing shareware version.\n');
    if (state.modified === true) {
      try {
        await sys.requestPak()
        state.searchpaths = state.searchpaths.filter(sp => sp.dir !== 'id1')
        state.searchpaths.unshift({
          dir: 'id1',
          packs: await getGamePacks('id1')
        })
        h = await state.assetStore.loadFile('gfx/pop.lmp');
        if (!h) {
          throw new Error('Still no registered asset')
        }
      } catch (e) {
        sys.error('You must have the registered version to use modified games');;
      }
    }
    return;
  }
  var check = new Uint8Array(h);
  var pop =
  [
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x66, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x66, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x66, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x67, 0x00, 0x00,
    0x00, 0x00, 0x66, 0x65, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x65, 0x66, 0x00,
    0x00, 0x63, 0x65, 0x61, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x61, 0x65, 0x63,
    0x00, 0x64, 0x65, 0x61, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x61, 0x65, 0x64,
    0x00, 0x64, 0x65, 0x64, 0x00, 0x00, 0x64, 0x69, 0x69, 0x69, 0x64, 0x00, 0x00, 0x64, 0x65, 0x64,
    0x00, 0x63, 0x65, 0x68, 0x62, 0x00, 0x00, 0x64, 0x68, 0x64, 0x00, 0x00, 0x62, 0x68, 0x65, 0x63,
    0x00, 0x00, 0x65, 0x67, 0x69, 0x63, 0x00, 0x64, 0x67, 0x64, 0x00, 0x63, 0x69, 0x67, 0x65, 0x00,
    0x00, 0x00, 0x62, 0x66, 0x67, 0x69, 0x6A, 0x68, 0x67, 0x68, 0x6A, 0x69, 0x67, 0x66, 0x62, 0x00,
    0x00, 0x00, 0x00, 0x62, 0x65, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x66, 0x65, 0x62, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x62, 0x63, 0x64, 0x66, 0x64, 0x63, 0x62, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x62, 0x66, 0x62, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x61, 0x66, 0x61, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x65, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
  ];
  var i;
  for (i = 0; i < 256; ++i)
  {
    if (check[i] !== pop[i])
      sys.error('Corrupted data file.');
  }
  cvar.set('registered', '1');
  con.print('Playing registered version.\n');
};

const path_f = function()
{
  con.print('Current search path:\n');
  var i = state.searchpaths.length, j, s;
  for (i = state.searchpaths.length - 1; i >= 0; --i)
  {
    s = state.searchpaths[i];
    for (j = s.packs.length - 1; j >= 0; --j)
      con.print(s.dir + '/' + 'pak' + j + '.pak (' + s.packs[j].contents.length + ' files)\n');
    con.print(s.dir + '\n');
  }
};

const getGamePacks = async (game: string): Promise<PakData[]> => {
  var i = 0, packs = [], pak
  for (;;)
  {
    pak = await state.assetStore.loadPackFile(game, 'pak' + i + '.pak');
    if (pak == null)
      break;
    packs.push(pak)
    ++i;
  }
  return packs
}

const addGameDirectory = async function(game: string) {
  state.searchpaths[state.searchpaths.length] = {
    dir: game,
    packs: await getGamePacks(game)
  };
};

const initFilesystem = async function()
{
  var i, search;
  
  i = checkParm('-basedir');
  if (i != null)
    search = state.argv[i + 1];
  if (search != null)
    await addGameDirectory(search);
  else 
    await addGameDirectory('id1');

  if (state.rogue === true)
    await addGameDirectory('rogue');
  else if (state.hipnotic === true)
    await addGameDirectory('hipnotic');
    
  i = checkParm('-game');
  if (i != null)
  {
    search = state.argv[i + 1];
    if (search != null)
    {
      await addGameDirectory(search);
      cvar.set('game', search)
    }
  }

  i = checkParm('-mod');
  if (i != null)
  {
    search = state.argv[i + 1];
    if (search != null)
    {
      await addGameDirectory(search);
      cvar.set('game', search)
    }
  }
  state.gamedir = [state.searchpaths[state.searchpaths.length - 1]];

  if (state.assetStore.preloadResidentFiles)
    await state.assetStore.preloadResidentFiles();
};

export const checkParm = function(parm: string)
{
  var i;
  for (i = 1; i < state.argv.length; ++i)
  {
    if (state.argv[i] === parm)
      return i;
  }
};

export const getCmdDeclaration = (varName: string) => {
  return checkParm(`-${varName}`) ? true : false
}
export const getCmdParam = (varName: string) => {
  const i = checkParm(`-${varName}`);
  return i ? state.argv[i + 1] : null;
}

export const defaultExtension = function(path: string, extension: string)
{
  var i, src;
  for (i = path.length - 1; i >= 0; --i)
  {
    src = path.charCodeAt(i);
    if (src === 47)
      break;
    if (src === 46)
      return path;
  }
  return path + extension;
};

export const removeExtension = (fileName: string) => {
  const splits = fileName.split('.')
  if (splits.length === 1) {
    return fileName
  }
  return splits.slice(0, splits.length - 1).join('')
}

export const loadFile = (fileName: string): Promise<ArrayBuffer> => {
  return state.assetStore.loadFile(fileName.replace(/^\//, ''))
}

export const evictFile = (fileName: string): void => {
  state.assetStore.evictResidentFile?.(fileName.replace(/^\//, ''))
}

export const loadFileSync = (fileName: string): ArrayBuffer | null => {
  return state.assetStore.loadFileSync(fileName.replace(/^\//, ''))
}

export const writeTextFile = function(filename: string, data: string)
{
  return state.assetStore.writeTextFile(filename, data)
};
export const eraseFile = function(filename: string)
{
  return state.assetStore.deleteFile(filename)
};
export const writeFile = (filename: string, data: Uint8Array, len: number) => {
  return state.assetStore.writeTextFile(filename, Buffer.from(data.subarray(0, len)).toString('base64'))
}
export const loadTextFile = async function(filename: string)
{
  var buf = await state.assetStore.loadFile(filename);
  if (buf == null)
    return;
  var bufview = new Uint8Array(buf);
  var f = [];
  var i;
  for (i = 0; i < bufview.length; ++i)
  {
    if (bufview[i] !== 13)
      f[f.length] = String.fromCharCode(bufview[i]);
  }
  return f.join('');
};

export const initArgv = function(argv: string[])
{
  state.argv = []
  state.cmdline = (argv.join(' ') + ' ').substring(0, 256);
  var i;
  for (i = 0; i < argv.length; ++i)
    state.argv[i] = argv[i];  
  if (checkParm('-safe') != null)
  {
    state.argv[state.argv.length] = '-nosound';
    state.argv[state.argv.length] = '-nocdaudio';
    state.argv[state.argv.length] = '-nomouse';
  }
  if (checkParm('-rogue') != null)
  {
    state.rogue = true;
    state.standard_quake = false;
  }
  else if (checkParm('-hipnotic') != null)
  {
    state.hipnotic = true;
    state.standard_quake = false;
  }
};

export const parse = function(data: string)
{
  state.token = '';
  var i = 0, c;
  if (data.length === 0)
    return;
    
  var skipwhite = true;
  for (;;)
  {
    if (skipwhite !== true)
      break;
    skipwhite = false;
    for (;;)
    {
      if (i >= data.length)
        return;
      c = data.charCodeAt(i);
      if (c > 32)
        break;
      ++i;
    }
    if ((c === 47) && (data.charCodeAt(i + 1) == 47))
    {
      for (;;)
      {
        if ((i >= data.length) || (data.charCodeAt(i) === 10))
          break;
        ++i;
      }
      skipwhite = true;
    }
  }

  if (c === 34)
  {
    ++i;
    for (;;)
    {
      c = data.charCodeAt(i);
      ++i;
      if ((i >= data.length) || (c === 34))
        return data.substring(i);
      state.token += String.fromCharCode(c);
    }
  }

  for (;;)
  {
    if ((i >= data.length) || (c <= 32))
      break;
    state.token += String.fromCharCode(c);
    ++i;
    c = data.charCodeAt(i);
  }

  return data.substring(i);
};
 
export const init = async function(assetStore: IAssetStore)
{
  state.standard_quake = true
  state.searchpaths = []
  state.token = ''
  state.modified = false
  state.assetStore = assetStore
  var swaptest = new ArrayBuffer(2);
  var swaptestview = new Uint8Array(swaptest);
  swaptestview[0] = 1;
  swaptestview[1] = 0;
  if ((new Uint16Array(swaptest))[0] === 1)
    state.littleLong = (function(l) {return l;});
  else
    state.littleLong = (function(l) {return (l >>> 24) + ((l & 0xff0000) >>> 8) + (((l & 0xff00) << 8) >>> 0) + ((l << 24) >>> 0);});

  cvr.registered = cvar.registerVariable('registered', '0');
  cvar.registerVariable('cmdline', state.cmdline, false, true);
  cvr.game = cvar.registerVariable('game', 'id1', false, true);

  cmd.addCommand('path', path_f);

  await initFilesystem();
  await checkRegistered();
};