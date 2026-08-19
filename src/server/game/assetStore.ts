import * as q from '../../engine/q'
import * as crc from '../../engine/crc'
import * as com from '../../engine/com'
import * as sys from '../../engine/sys'
import * as con from '../../engine/console'
import {promises as fs} from 'fs'
import * as fsBase from 'fs'
import { FileMode } from '../../engine/interfaces/store/IAssetStore'
import * as path from 'path'
import { PackedFile } from '../../engine/types/Com'

const modeMap = {
	[FileMode.READ]: 'r',
	[FileMode.APPEND]: 'w+',
	[FileMode.WRITE]: 'w'
}

export const openFile = (filename: string, mode: FileMode) => {
	const dir = path.dirname(filename)
	return (dir && dir != '/' ? fs.mkdir(dir): Promise.resolve())
		.then(() => fs.open(filename, modeMap[mode]))
		.then(fd => fd.close())
		.then(() => true)
		.catch(err => {
			sys.print(`Could not open '${filename}': ${err.message}\n`);
			return false
		})
}

export const readFile = (filename: string) => {
	return fs.readFile(filename, 'utf8')
		.then(data => Buffer.from(data))
		.catch((err: Error) => {
			sys.print(`Could not read file : ${err.message}\n`);
			return Buffer.from('')
		})
}

// Create the target's parent directory (e.g. autosave/) before writing
const ensureDir = (filename: string) =>
{
	const dir = path.dirname(filename)
	return (dir && dir !== '.' && dir !== '/' ? fs.mkdir(dir, {recursive: true}) : Promise.resolve(undefined))
}

export const writeFile = (filename: string, data: Uint8Array, len: number) =>
{
	// fs.writeFile on a path truncates; the old fs.open(filename, 'a') appended,
	// so every savegame grew the file and loads parsed the stale head
	return ensureDir(filename)
		.then(() => fs.writeFile(filename, data.slice(0, len)))
		.then(() => true)
		.catch(err => {
			sys.print(`Could not write '${filename}' to filesystem: ${err.message}\n`);
			return false
		})
}

export const writeTextFile = (filename: string, data: string) =>
{
	return ensureDir(filename)
		.then(() => fs.writeFile(filename, data))
		.then(() => true)
		.catch(err => {
			sys.print(`Could not write '${filename}' to filesystem: ${err.message}\n`);
			return false
		})
}

export const deleteFile = (filename: string): Promise<void> =>
{
	return fs.unlink(filename)
		.catch(err => {
			sys.print(`Could not delete '${filename}': ${err.message}\n`);
		})
}


export const loadFileSync = function(filename: string): ArrayBuffer | null
{
	var src, i, j, k, search, pak, file, fd;
	for (i = com.state.searchpaths.length - 1; i >= 0; --i)
	{
		search = com.state.searchpaths[i];
		for (j = search.packs.length - 1; j >= 0; --j)
		{
			pak = search.packs[j];
			for (k = 0; k < pak.contents.length; ++k)
			{
				file = pak.contents[k];
				if (file.name !== filename)
					continue;
				if (file.filelen === 0)
					return new ArrayBuffer(0);
				try
				{
					fd = fsBase.openSync(search.dir + '/pak' + j + '.pak', 'r');
				}
				catch (e)
				{
					break;
				}
				sys.print('PackFile: ' + search.dir + '/pak' + j + '.pak : ' + filename + '\n')
				src = Buffer.alloc(file.filelen);
				fsBase.readSync(fd, src, 0, file.filelen, file.filepos);
				fsBase.closeSync(fd);
				break;
			}
		}
		if (src != null)
			break;
		try
		{
			src = fsBase.readFileSync(search.dir + '/' + filename);
			sys.print('FindFile: ' + search.dir + '/' + filename + '\n');
			break;
		}
		catch (e)
		{
		}
	}
	if (src == null)
	{
		sys.print('FindFile: can\'t find ' + filename + '\n');
		return null;
	}
	var size = src.length;
	var dest = new ArrayBuffer(size), view = new DataView(dest);
	var count = size >> 2;
	if (count !== 0)
	{
		if (com.state.bigendien !== true)
		{
			for (i = 0; i < count; ++i)
				view.setUint32(i << 2, src.readUInt32LE(i << 2), true);
		}
		else
		{
			for (i = 0; i < count; ++i)
				view.setUint32(i << 2, src.readUInt32BE(i << 2));
		}
	}
	count <<= 2;
	switch (size & 3)
	{
	case 1:
		view.setUint8(count, src[count]);
		break;
	case 2:
		view.setUint16(count, src.readUInt16LE(count), true);
		break;
	case 3:
		view.setUint16(count, src.readUInt16LE(count), true);
		view.setUint8(count + 2, src[count + 2]);
	}
	return dest;
};

export const loadFile = async function(filename: string)
{
	return loadFileSync(filename);
};

export const saveDownloadedFile = async (_game: string, _filename: string, _data: ArrayBuffer): Promise<void> => {
}

export const loadPackFile = async (dir: string, packName: string) : Promise<{name: string, data: ArrayBuffer, type: string, contents: PackedFile[]}> => {
	const packfile = dir + '/' + packName
	var fd;
	try
	{
		fd = fsBase.openSync(packfile, 'r');
	}
	catch (e)
	{
		return;
	}

	var buf = Buffer.alloc(12);
	fsBase.readSync(fd, buf, 0, 12, 0);
	if (buf.readUInt32LE(0) !== 0x4b434150)
		sys.error(packfile + ' is not a packfile');
	var dirofs = buf.readUInt32LE(4);
	var dirlen = buf.readUInt32LE(8);
	var numpackfiles = dirlen >> 6;
	if (numpackfiles !== 339)
		com.state.modified = true;
	var pack = [];
	if (numpackfiles !== 0)
	{
		buf = Buffer.alloc(dirlen);
		fsBase.readSync(fd, buf, 0, dirlen, dirofs);
		if (crc.block(buf) !== 32981)
			com.state.modified = true;
		var i;
		for (i = 0; i < numpackfiles; ++i)
		{
			pack[pack.length] =
			{
				name: q.memstr(buf.slice(i << 6, (i << 6) + 56)).toLowerCase(),
				filepos: buf.readUInt32LE((i << 6) + 56),
				filelen: buf.readUInt32LE((i << 6) + 60)
			}
		}
	}
	fsBase.closeSync(fd);
	con.print('Added packfile ' + packfile + ' (' + numpackfiles + ' files)\n');

	return {
		name: packfile,
		data: null,
		type: 'filesystem',
		contents: pack
	}
};