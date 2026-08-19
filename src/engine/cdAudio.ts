import * as s from './s'
import * as cmd from './cmd'
import * as con from './console'
import * as com from './com'
import * as q from './q'
import * as cvar from './cvar'

const EXTENSIONS = ['.ogg', '.mp3', '.wav', '.flac'];
const MIME_TYPES: Record<string, string> = {
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
};

// Cache of track number or filename → blob URL; null = confirmed miss. A full miss
// probes up to 8 candidate paths through the asset store (IndexedDB reads that queue
// behind package-install writes, plus a remote file-list fetch), so misses must not be
// re-paid on every map load. Miss entries are retried when the searchpath/pak set
// changes (package install, gamedir switch); hits keep their blob URLs.
const trackCache: Record<string, string | null> = {};

const state = {

} as any;

const searchpathEpoch = () => {
  let e = '';
  for (const s of com.state.searchpaths)
    e += s.dir + ':' + (s.packs != null ? s.packs.length : 0) + ',';
  return e;
};

const findAudioFile = async (basePath: string): Promise<string | null> => {
  const epoch = searchpathEpoch();
  if (epoch !== state.trackCacheEpoch) {
    state.trackCacheEpoch = epoch;
    for (const k in trackCache) {
      if (trackCache[k] == null)
        delete trackCache[k];
    }
  }
  if (basePath in trackCache) return trackCache[basePath];
  for (const ext of EXTENSIONS) {
    const data = await com.loadFile(basePath + ext);
    if (data) {
      const blob = new Blob([data], { type: MIME_TYPES[ext] });
      const url = URL.createObjectURL(blob);
      trackCache[basePath] = url;
      return url;
    }
  }
  trackCache[basePath] = null;
  return null;
};

// QuakeSpasm convention (music/track02.ogg) first — what paks/mods ship —
// then the legacy hosted path (media/quake02.ogg).
const findTrack = async (trackNum: number): Promise<string | null> => {
  const padded = (trackNum <= 9 ? '0' : '') + trackNum;
  return await findAudioFile('music/track' + padded)
    ?? findAudioFile('media/quake' + padded);
};

export const play = async function(track: number, looping: boolean)
{
  if ((state.initialized !== true) || (state.enabled !== true))
    return;
  if (track <= 0)
    return;
  if (state.playTrack === track)
  {
    if (state.cd != null)
    {
      state.cd.loop = looping;
      if ((looping === true) && (state.cd.paused === true))
        await state.cd.play().catch(() => {});
    }
    return;
  }
  // QSS-M BGM_PlayCDtrack stops the current music BEFORE trying the new track, so a map change
  // whose track is missing goes silent instead of carrying the previous map's song. stop() also
  // bumps playSeq, superseding any older play() still in its async lookup; capture ours after it.
  stop();
  var seq = state.playSeq;
  var url = await findTrack(track);
  if (seq !== state.playSeq)
    return;
  if (url == null)
  {
    if (track > 1)
      con.dPrint('CDAudio.Play: track ' + track + ' not found\n');
    return;
  }
  state.playTrack = track;
  state.cd = new Audio(url);
  state.cd.loop = looping;
  state.cd.volume = state.cdvolume;
  await state.cd.play().catch(() => {});
};

export const stop = function()
{
  if ((state.initialized !== true) || (state.enabled !== true))
    return;
  state.playSeq = (state.playSeq | 0) + 1;  // supersede any play() still in its lookup
  if (state.cd != null)
    state.cd.pause();
  state.playTrack = null;
  state.cd = null;
};

export const pause = function()
{
  if ((state.initialized !== true) || (state.enabled !== true))
    return;
  if (state.cd != null)
    state.cd.pause();
};

export const resume = async function()
{
  if ((state.initialized !== true) || (state.enabled !== true))
    return;
  if (state.cd != null)
    await state.cd.play().catch(() => {});
};

const music_f = async function()
{
  if (cmd.state.argv.length < 2)
    return;
  var filename = cmd.state.argv[1];
  // Strip quotes if present
  if (filename.startsWith('"') && filename.endsWith('"'))
    filename = filename.slice(1, -1);
  var url = await findAudioFile(filename);
  if (url == null && !filename.startsWith('music/'))
    url = await findAudioFile('music/' + filename);
  if (url == null && !filename.startsWith('media/'))
    url = await findAudioFile('media/' + filename);
  if (url == null)
  {
    con.dPrint('music: ' + filename + ' not found\n');
    return;
  }
  stop();
  state.playTrack = -1;
  state.cd = new Audio(url);
  state.cd.loop = true;
  state.cd.volume = state.cdvolume;
  await state.cd.play().catch(() => {});
};

export const cd_f = async function()
{
  if ((state.initialized !== true) || (cmd.state.argv.length <= 1))
    return;
  var command = cmd.state.argv[1].toLowerCase();
  switch (command)
  {
  case 'on':
    state.enabled = true;
    return;
  case 'off':
    stop();
    state.enabled = false;
    return;
  case 'play':
    await play(q.atoi(cmd.state.argv[2]), false);
    return;
  case 'loop':
    await play(q.atoi(cmd.state.argv[2]), true);
    return;
  case 'stop':
    stop();
    return;
  case 'pause':
    pause();
    return;
  case 'resume':
    await resume();
    return;
  case 'info':
    if (state.cd != null)
    {
      if (state.cd.paused !== true)
        con.print('Currently ' + (state.cd.loop === true ? 'looping' : 'playing') + ' track ' + state.playTrack + '\n');
    }
    con.print('Volume is ' + state.cdvolume + '\n');
    return;
  }
};

export const update = function()
{
  if ((state.initialized !== true) || (state.enabled !== true))
    return;
  if (s.cvr.bgmvolume.value === state.cdvolume)
    return;
  if (s.cvr.bgmvolume.value < 0.0)
    cvar.setValue('bgmvolume', 0.0);
  else if (s.cvr.bgmvolume.value > 1.0)
    cvar.setValue('bgmvolume', 1.0);
  state.cdvolume = s.cvr.bgmvolume.value;
  if (state.cd != null)
    state.cd.volume = state.cdvolume;
};

export const init = async function()
{
  cmd.addCommand('cd', cd_f);
  cmd.addCommand('music', music_f);
  if (com.checkParm('-nocdaudio') != null)
    return;
  state.initialized = state.enabled = true;
  update();
  con.print('CD Audio Initialized\n');
};
