/**
 * File: files.ts
 * Source: Quake II original / qcommon/files.c
 * Purpose: Port the Quake II virtual filesystem search path logic over mounted in-memory directories and PAK archives.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Uses in-memory mounted directories instead of direct host filesystem access.
 * - Exposes listing helpers as return values instead of printing directly.
 *
 * Notes:
 * - This file is intended to stay conceptually close to the original C source.
 */

import { findPakEntry, parsePak, readPakEntryData } from "../../formats/src/pak.js";
import type { PakArchive, PakEntry } from "../../formats/src/pak.js";

const FS_SFF_SUBDIR = 0x08;
const FS_CVAR_SERVERINFO = 4;
const FS_CVAR_NOSET = 8;
const FS_CVAR_LATCH = 16;
const FS_BASEDIRNAME = "baseq2";

/**
 * Original name: MAX_READ
 * Source: qcommon/files.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Caps `FS_Read` chunks to 64 KiB, matching the original progress-read loop.
 */
export const MAX_READ = 0x10000;

/**
 * Original name: N/A
 * Source: N/A (virtual filesystem model)
 * Category: New
 * Purpose: Represent one mounted in-memory directory searched by the virtual filesystem.
 *
 * Constraints:
 * - File lookups must remain case-insensitive and slash-normalized.
 */
export interface MountedDirectory {
  path: string;
  files: Map<string, MountedDirectoryFile>;
}

/**
 * Original name: N/A
 * Source: N/A (virtual filesystem model)
 * Category: New
 * Purpose: Preserve one mounted loose file and its original logical path.
 *
 * Constraints:
 * - Must keep the original path for listing and diagnostics.
 */
export interface MountedDirectoryFile {
  path: string;
  bytes: Uint8Array;
}

/**
 * Original name: pack_s
 * Source: qcommon/files.c
 * Category: Ported
 * Fidelity level: Close
 * Purpose: Represent a mounted PAK in virtual search path order.
 *
 * Constraints:
 * - Later mounts must take precedence over earlier mounts.
 */
export interface MountedPak {
  archive: PakArchive;
}

/**
 * Original name: filelink_s
 * Source: qcommon/files.c
 * Category: Ported
 * Fidelity level: Strict
 * Purpose: Represent one `link` entry from the original Quake II filesystem.
 *
 * Constraints:
 * - Prefix matching must be case-insensitive after normalization.
 */
export interface FileLink {
  from: string;
  fromlength: number;
  to: string;
}

/**
 * Original name: searchpath_s
 * Source: qcommon/files.c
 * Category: Ported
 * Fidelity level: Close
 * Purpose: Track one Quake II search path entry, either a directory or a PAK archive.
 *
 * Constraints:
 * - Search order must match list order, with the first entry taking precedence.
 */
export interface SearchPath {
  filename: string;
  pack?: MountedPak;
  directory?: MountedDirectory;
}

/**
 * Original name: N/A
 * Source: N/A (virtual filesystem model)
 * Category: New
 * Purpose: Describe a resolved file inside the virtual filesystem.
 *
 * Constraints:
 * - Must preserve the resolved search path source for future tooling and diagnostics.
 */
export interface MountedVirtualFile {
  search: SearchPath;
  pak?: MountedPak;
  entry?: PakEntry;
  path: string;
  bytes: Uint8Array;
}

/**
 * Original name: N/A
 * Source: N/A (virtual filesystem model)
 * Category: New
 * Purpose: Store mounted search paths for future Quake II filesystem lookups.
 *
 * Constraints:
 * - Search order must mimic Quake II override behavior.
 */
export interface VirtualFilesystem {
  packs: MountedPak[];
  searchPaths: SearchPath[];
  fs_links: FileLink[];
  fs_gamedir: string;
  fs_base_searchpaths: SearchPath[];
}

/**
 * Original name: N/A
 * Source: N/A (virtual filesystem input)
 * Category: New
 * Purpose: Describe one initial mounted file passed while creating or mounting a directory.
 *
 * Constraints:
 * - File keys are logical Quake paths relative to the mounted directory.
 */
export type MountedDirectoryInput = Record<string, Uint8Array> | Iterable<[string, Uint8Array]>;

/**
 * Original name: N/A
 * Source: N/A (filesystem cvar adapter)
 * Category: New
 * Purpose: Represent the minimal cvar value shape needed by filesystem initialization.
 */
export interface FilesystemCvar {
  string: string;
}

/**
 * Original name: N/A
 * Source: N/A (filesystem command adapter)
 * Category: New
 * Purpose: Provide command registration and argv access without coupling filesystem code to qcommon.
 */
export interface FSInitCommandAdapter {
  addCommand: (name: string, callback: () => void) => void;
  argc?: () => number;
  argv?: (index: number) => string;
  print?: (line: string) => void;
}

/**
 * Original name: N/A
 * Source: N/A (filesystem cvar adapter)
 * Category: New
 * Purpose: Provide cvar creation without coupling filesystem code to qcommon.
 */
export interface FSInitCvarAdapter {
  get: (name: string, value: string, flags: number) => FilesystemCvar | null;
}

/**
 * Original name: N/A
 * Source: N/A (filesystem initialization adapter)
 * Category: New
 * Purpose: Bundle host adapters used by the ported `FS_InitFilesystem` flow.
 */
export interface FSInitFilesystemOptions {
  commands?: FSInitCommandAdapter;
  cvars?: FSInitCvarAdapter;
  resolveDirectoryFiles?: (path: string) => MountedDirectoryInput | undefined;
}

/**
 * Original name: N/A
 * Source: N/A (virtual filesystem factory)
 * Category: New
 * Purpose: Create an empty virtual filesystem.
 *
 * Constraints:
 * - Mount order must be preserved after creation.
 */
export function createVirtualFilesystem(initialGameDir = "baseq2"): VirtualFilesystem {
  return {
    packs: [],
    searchPaths: [],
    fs_links: [],
    fs_gamedir: normalizeDirectoryPath(initialGameDir),
    fs_base_searchpaths: []
  };
}

/**
 * Original name: FS_InitFilesystem
 * Source: qcommon/files.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Registers the `path`, `link` and `dir` filesystem commands.
 * - Creates `basedir`, `cddir` and `game` cvars with the original flags.
 * - Mounts optional CD content, mounts `baseq2`, marks base search paths, then applies a latched game override.
 *
 * Porting notes:
 * - Uses injected command and cvar adapters to avoid coupling this filesystem package to qcommon runtimes.
 * - Host directory probing is represented by `resolveDirectoryFiles`, which supplies mounted in-memory contents.
 */
export function FS_InitFilesystem(filesystem: VirtualFilesystem, options: FSInitFilesystemOptions = {}): void {
  registerFilesystemCommands(filesystem, options.commands);

  const fs_basedir = getFilesystemCvar(options.cvars, "basedir", ".", FS_CVAR_NOSET);
  const fs_cddir = getFilesystemCvar(options.cvars, "cddir", "", FS_CVAR_NOSET);

  if (fs_cddir.string.length > 0) {
    const cddirPath = joinGameDirectory(fs_cddir.string, FS_BASEDIRNAME);
    FS_AddGameDirectory(filesystem, cddirPath, options.resolveDirectoryFiles?.(cddirPath));
  }

  const basedirPath = joinGameDirectory(fs_basedir.string, FS_BASEDIRNAME);
  FS_AddGameDirectory(filesystem, basedirPath, options.resolveDirectoryFiles?.(basedirPath));
  markBaseSearchPaths(filesystem);

  const fs_gamedirvar = getFilesystemCvar(options.cvars, "game", "", FS_CVAR_LATCH | FS_CVAR_SERVERINFO);
  if (fs_gamedirvar.string.length > 0) {
    const gamePath = normalizeDirectoryPath(fs_gamedirvar.string);
    FS_SetGamedir(filesystem, fs_gamedirvar.string, options.resolveDirectoryFiles?.(gamePath));
  }
}

/**
 * Original name: N/A
 * Source: N/A (manual mount adapter)
 * Category: Adapter
 * Purpose: Mount loose in-memory files without automatically mounting embedded PAK archives.
 *
 * Constraints:
 * - Keeps manual mount order available for browser/bootstrap tests that provide PAKs separately.
 */
export function mountDirectory(
  filesystem: VirtualFilesystem,
  path: string,
  files?: MountedDirectoryInput
): MountedDirectory {
  const directory = createMountedDirectory(path, files);
  const search: SearchPath = {
    filename: directory.path,
    directory
  };

  filesystem.fs_gamedir = directory.path;
  filesystem.searchPaths.unshift(search);
  return directory;
}

/**
 * Original name: FS_AddGameDirectory
 * Source: qcommon/files.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Sets `fs_gamedir`, adds a directory search path, then loads `pak0.pak` through `pak9.pak`.
 *
 * Porting notes:
 * - Scans the provided in-memory directory contents instead of the host filesystem.
 * - Preserves the original search order: later PAK search paths are inserted ahead of the directory.
 */
export function FS_AddGameDirectory(
  filesystem: VirtualFilesystem,
  path: string,
  files?: MountedDirectoryInput
): { directory: MountedDirectory; packs: MountedPak[] } {
  const directory = mountDirectory(filesystem, path, files);
  const mountedPaks: MountedPak[] = [];

  for (let i = 0; i < 10; i += 1) {
    const pakfile = `pak${i}.pak`;
    const file = directory.files.get(pakfile);
    if (!file) {
      continue;
    }

    mountedPaks.push(FS_LoadPackFile(filesystem, file.bytes, `${directory.path}/${pakfile}`));
  }

  return { directory, packs: mountedPaks };
}

/**
 * Original name: N/A
 * Source: N/A (manual mount adapter)
 * Category: Adapter
 * Fidelity level: Adapter
 *
 * Purpose:
 * - Preserve the earlier TypeScript helper name for callers that mount PAK bytes directly.
 *
 * Porting notes:
 * - The owning port of `FS_LoadPackFile` is `FS_LoadPackFile` below.
 */
export function mountPak(filesystem: VirtualFilesystem, bytes: Uint8Array, path?: string): MountedPak {
  const pak = {
    archive: parsePak(bytes, path)
  };

  const search: SearchPath = {
    filename: path ?? "<memory-pak>",
    pack: pak
  };

  filesystem.packs.unshift(pak);
  filesystem.searchPaths.unshift(search);
  return pak;
}

/**
 * Original name: FS_LoadPackFile
 * Source: qcommon/files.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Loads and mounts one Quake II PAK archive into the virtual search path.
 *
 * Porting notes:
 * - Reuses the already parsed in-memory PAK path instead of reopening a host file.
 */
export function FS_LoadPackFile(filesystem: VirtualFilesystem, bytes: Uint8Array, path?: string): MountedPak {
  return mountPak(filesystem, bytes, path);
}

/**
 * Original name: FS_Link_f
 * Source: qcommon/files.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Adds, replaces or removes one prefix link entry.
 * - Returns the original usage string when the command arguments are missing.
 *
 * Porting notes:
 * - Accepts normalized string arguments directly instead of reading command argv; filesystem command registration is owned by `FS_InitFilesystem`.
 */
export function FS_Link_f(filesystem: VirtualFilesystem, from?: string, to?: string): string | void {
  if (from === undefined || to === undefined) {
    return "USAGE: link <from> <to>";
  }

  const normalizedFrom = normalizeVirtualPath(from);
  const existing = filesystem.fs_links.find((link) => link.from === normalizedFrom);

  if (existing) {
    if (to.length === 0) {
      filesystem.fs_links = filesystem.fs_links.filter((link) => link !== existing);
      return;
    }

    existing.to = normalizeVirtualPath(to);
    return;
  }

  filesystem.fs_links.unshift({
    from: normalizedFrom,
    fromlength: normalizedFrom.length,
    to: normalizeVirtualPath(to)
  });
}

/**
 * Original name: N/A
 * Source: N/A (compatibility adapter for the ported `FS_Link_f`)
 * Category: Adapter
 * Fidelity level: Adapter
 *
 * Purpose:
 * - Preserve the earlier TypeScript helper name while the official source entity keeps `FS_Link_f`.
 */
export function FS_Link(filesystem: VirtualFilesystem, from: string, to: string): void {
  FS_Link_f(filesystem, from, to);
}

/**
 * Original name: FS_SetGamedir
 * Source: qcommon/files.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Switches the logical game directory used by future writes, directory enumeration and lookup.
 *
 * Porting notes:
 * - Resets mounted mod search paths to the marked base set, then mounts the requested in-memory mod directory.
 * - Host `basedir`/`cddir` probing is intentionally supplied by the caller as optional mounted contents.
 * - Rejects path-like values using the same safety checks as the original code.
 */
export function FS_SetGamedir(
  filesystem: VirtualFilesystem,
  dir: string,
  files?: MountedDirectoryInput
): boolean {
  if (dir.includes("..") || dir.includes("/") || dir.includes("\\") || dir.includes(":")) {
    return false;
  }

  if (filesystem.fs_base_searchpaths.length > 0) {
    filesystem.searchPaths = [...filesystem.fs_base_searchpaths];
    filesystem.packs = filesystem.searchPaths
      .filter((search): search is SearchPath & { pack: MountedPak } => search.pack !== undefined)
      .map((search) => search.pack);
  }

  if (dir.length === 0 || dir === "baseq2") {
    filesystem.fs_gamedir = "baseq2";
    return true;
  }

  FS_AddGameDirectory(filesystem, dir, files);
  return true;
}

/**
 * Original name: FS_Gamedir
 * Source: qcommon/files.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Returns the current logical game directory.
 *
 * Porting notes:
 * - Reads from the explicit filesystem object instead of file-static globals.
 */
export function FS_Gamedir(filesystem: VirtualFilesystem): string {
  return filesystem.fs_gamedir;
}

/**
 * Original name: N/A
 * Source: N/A (filesystem state helper)
 * Category: New
 * Purpose: Mark the current search paths as the base search path set retained across gamedir changes.
 *
 * Constraints:
 * - Must snapshot the current logical search path objects by reference order.
 */
export function markBaseSearchPaths(filesystem: VirtualFilesystem): void {
  filesystem.fs_base_searchpaths = [...filesystem.searchPaths];
}

/**
 * Original name: FS_FOpenFile
 * Source: qcommon/files.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Resolves one file through links, mounted directories and mounted PAK archives in search order.
 *
 * Porting notes:
 * - Returns an in-memory file descriptor object instead of an open FILE pointer.
 * - Preserves the original link short-circuit: a matching link whose target is
 *   missing stops the lookup instead of falling back to normal search paths.
 */
export function readMountedFile(filesystem: VirtualFilesystem, filename: string): MountedVirtualFile | undefined {
  const normalizedFilename = normalizeVirtualPath(filename);
  const linked = resolveLinkedFilename(filesystem, normalizedFilename);

  if (linked) {
    return readDirectoryLinkedFile(filesystem, linked);
  }

  for (const search of filesystem.searchPaths) {
    if (search.pack) {
      const entry = findPakEntry(search.pack.archive, normalizedFilename);
      if (!entry) {
        continue;
      }

      return {
        search,
        pak: search.pack,
        entry,
        path: entry.name,
        bytes: readPakEntryData(search.pack.archive, entry)
      };
    }

    if (!search.directory) {
      continue;
    }

    const resolvedDirectoryFile = search.directory.files.get(normalizedFilename);
    if (!resolvedDirectoryFile) {
      continue;
    }

    return {
      search,
      path: resolvedDirectoryFile.path,
      bytes: resolvedDirectoryFile.bytes
    };
  }

  return undefined;
}

/**
 * Original name: FS_LoadFile
 * Source: qcommon/files.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Loads one file fully into memory from the current search paths.
 *
 * Porting notes:
 * - Copies from the mounted payload into a fresh buffer, matching the original `Z_Malloc` ownership boundary.
 */
export function FS_LoadFile(filesystem: VirtualFilesystem, path: string): Uint8Array | undefined {
  const mounted = readMountedFile(filesystem, path);
  if (!mounted) {
    return undefined;
  }

  const buffer = new Uint8Array(mounted.bytes.byteLength);
  FS_Read(buffer, mounted.bytes.byteLength, mounted.bytes);
  return buffer;
}

/**
 * Original name: FS_Read
 * Source: qcommon/files.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Reads exactly `len` bytes into `buffer` in `MAX_READ` chunks.
 *
 * Porting notes:
 * - Uses a source byte array instead of a `FILE *`; short reads are fatal because browser VFS data is already resident.
 * - CD retry/audio-stop handling is not applicable to the in-memory VFS path.
 */
export function FS_Read(buffer: Uint8Array, len: number, file: Uint8Array, offset = 0): void {
  let remaining = len;
  let inputOffset = offset;
  let outputOffset = 0;

  while (remaining > 0) {
    let block = remaining;
    if (block > MAX_READ) {
      block = MAX_READ;
    }

    const available = Math.max(0, Math.min(block, file.byteLength - inputOffset));
    if (available === 0) {
      throw new Error("FS_Read: 0 bytes read");
    }

    buffer.set(file.subarray(inputOffset, inputOffset + available), outputOffset);
    remaining -= available;
    inputOffset += available;
    outputOffset += available;
  }
}

/**
 * Original name: FS_FreeFile
 * Source: qcommon/files.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Releases one loaded file buffer.
 *
 * Porting notes:
 * - Becomes a no-op because mounted file bytes are owned by the virtual filesystem.
 */
export function FS_FreeFile(_buffer: Uint8Array): void {
  // The in-memory virtual filesystem owns mounted file buffers for the full
  // lifetime of the filesystem, so freeing a loaded view is a no-op.
}

/**
 * Original name: FS_ExecAutoexec
 * Source: qcommon/files.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Returns whether `autoexec.cfg` is available through the current search path.
 *
 * Porting notes:
 * - Reports availability instead of injecting command text directly.
 */
export function FS_ExecAutoexec(filesystem: VirtualFilesystem): boolean {
  return readMountedFile(filesystem, "autoexec.cfg") !== undefined;
}

/**
 * Original name: Developer_searchpath
 * Source: qcommon/files.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Detects whether the current search path contains one mission-pack directory.
 *
 * Porting notes:
 * - Preserves the original return values: `1` for Xatrix, `2` for Rogue, `0` otherwise.
 */
export function Developer_searchpath(filesystem: VirtualFilesystem): number {
  for (const search of filesystem.searchPaths) {
    if (search.filename.includes("xatrix")) {
      return 1;
    }

    if (search.filename.includes("rogue")) {
      return 2;
    }
  }

  return 0;
}

/**
 * Original name: N/A
 * Source: N/A (text decoding helper)
 * Category: New
 * Purpose: Read a mounted file as an ASCII-style text string suitable for Quake config scripts.
 *
 * Constraints:
 * - Must preserve low 8-bit byte values when decoding.
 */
export function readMountedTextFile(filesystem: VirtualFilesystem, filename: string): string | undefined {
  const file = readMountedFile(filesystem, filename);
  if (!file) {
    return undefined;
  }

  return decodeTextBytes(file.bytes);
}

/**
 * Original name: FS_Path_f
 * Source: qcommon/files.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Lists the current search path and filesystem links.
 *
 * Porting notes:
 * - Returns formatted output lines instead of printing directly.
 */
export function FS_Path_f(filesystem: VirtualFilesystem): string[] {
  const lines: string[] = ["Current search path:"];

  for (const search of filesystem.searchPaths) {
    if (filesystem.fs_base_searchpaths.includes(search)) {
      lines.push("----------");
    }

    if (search.pack) {
      lines.push(`${search.pack.archive.path ?? search.filename} (${search.pack.archive.entries.length} files)`);
      continue;
    }

    lines.push(search.filename);
  }

  lines.push("");
  lines.push("Links:");

  for (const link of filesystem.fs_links) {
    lines.push(`${link.from} : ${link.to}`);
  }

  return lines;
}

/**
 * Original name: FS_NextPath
 * Source: qcommon/files.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Iterates mounted directory paths, starting with the current gamedir.
 *
 * Porting notes:
 * - Skips PAK search paths exactly like the original helper.
 */
export function FS_NextPath(filesystem: VirtualFilesystem, prevpath: string | null): string | null {
  if (prevpath === null) {
    return filesystem.fs_gamedir;
  }

  let previous = filesystem.fs_gamedir;
  for (const search of filesystem.searchPaths) {
    if (search.pack) {
      continue;
    }

    if (prevpath === previous && search.filename !== prevpath) {
      return search.filename;
    }

    previous = search.filename;
  }

  return null;
}

/**
 * Original name: FS_ListFiles
 * Source: qcommon/files.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Lists visible loose files or mounted subdirectories matching one Quake-style wildcard.
 *
 * Porting notes:
 * - Operates on mounted in-memory directories only.
 * - Deduplicates filenames across search paths by normalized result path.
 * - Returns a JavaScript array instead of the original NULL-guarded allocation.
 */
export function FS_ListFiles(filesystem: VirtualFilesystem, findname: string, musthave = 0, canthave = 0): string[] {
  const normalizedPattern = normalizeVirtualPath(findname);
  const matches = new Set<string>();
  const wantsSubdirectories = (musthave & FS_SFF_SUBDIR) !== 0;
  const rejectsSubdirectories = (canthave & FS_SFF_SUBDIR) !== 0;

  if (wantsSubdirectories && rejectsSubdirectories) {
    return [];
  }

  for (const search of filesystem.searchPaths) {
    if (!search.directory) {
      continue;
    }

    const candidates = wantsSubdirectories
      ? listMountedSubdirectories(search.directory)
      : listMountedLooseFiles(search.directory);

    for (const candidate of candidates) {
      if (wildcardMatches(candidate, normalizedPattern)) {
        matches.add(candidate);
      }
    }
  }

  return [...matches].sort();
}

/**
 * Original name: FS_Dir_f
 * Source: qcommon/files.c
 * Category: Ported
 * Fidelity level: Close
 *
 * Behavior:
 * - Lists matching files for each mounted directory path.
 *
 * Porting notes:
 * - Returns output lines instead of printing directly.
 */
export function FS_Dir_f(filesystem: VirtualFilesystem, wildcard = "*.*"): string[] {
  const lines: string[] = [];
  let path: string | null = null;

  while ((path = FS_NextPath(filesystem, path)) !== null) {
    const findname = `${normalizeDirectoryPath(path)}/${normalizeVirtualPath(wildcard)}`;
    lines.push(`Directory of ${findname}`);
    lines.push("----");

    const dirnames = FS_ListFiles(filesystem, findname);
    for (const dirname of dirnames) {
      const slashIndex = dirname.lastIndexOf("/");
      lines.push(slashIndex >= 0 ? dirname.slice(slashIndex + 1) : dirname);
    }

    lines.push("");
  }

  return lines;
}

/**
 * Original name: N/A
 * Source: N/A (text decoding helper)
 * Category: New
 * Purpose: Decode low 8-bit file bytes into a JavaScript string without UTF-8 reinterpretation.
 *
 * Constraints:
 * - Must preserve one byte to one code unit semantics.
 */
function decodeTextBytes(bytes: Uint8Array): string {
  let result = "";

  for (let index = 0; index < bytes.length; index += 1) {
    result += String.fromCharCode(bytes[index]);
  }

  return result;
}

/**
 * Original name: N/A
 * Source: N/A (filesystem command adapter)
 * Category: New
 * Purpose: Register the ported filesystem console commands through an injected command adapter.
 */
function registerFilesystemCommands(filesystem: VirtualFilesystem, commands: FSInitCommandAdapter | undefined): void {
  if (!commands) {
    return;
  }

  commands.addCommand("path", () => {
    for (const line of FS_Path_f(filesystem)) {
      commands.print?.(`${line}\n`);
    }
  });

  commands.addCommand("link", () => {
    const from = commands.argv?.(1);
    const to = commands.argv?.(2);
    const output = commands.argc?.() === 3 ? FS_Link_f(filesystem, from, to) : FS_Link_f(filesystem);
    if (output !== undefined) {
      commands.print?.(`${output}\n`);
    }
  });

  commands.addCommand("dir", () => {
    const wildcard = commands.argc?.() === 2 ? commands.argv?.(1) : undefined;
    for (const line of FS_Dir_f(filesystem, wildcard)) {
      commands.print?.(`${line}\n`);
    }
  });
}

/**
 * Original name: N/A
 * Source: N/A (filesystem cvar adapter)
 * Category: New
 * Purpose: Read or synthesize one filesystem cvar during initialization.
 */
function getFilesystemCvar(cvars: FSInitCvarAdapter | undefined, name: string, value: string, flags: number): FilesystemCvar {
  return cvars?.get(name, value, flags) ?? { string: value };
}

/**
 * Original name: N/A
 * Source: N/A (path helper)
 * Category: New
 * Purpose: Join a host root and Quake game directory before VFS normalization.
 */
function joinGameDirectory(root: string, gameDirectory: string): string {
  return normalizeDirectoryPath(`${root}/${gameDirectory}`);
}

/**
 * Original name: N/A
 * Source: N/A (virtual filesystem factory)
 * Category: New
 * Purpose: Build one mounted in-memory directory with normalized file lookup keys.
 *
 * Constraints:
 * - Must preserve the original logical file paths for later listings.
 */
function createMountedDirectory(path: string, files?: MountedDirectoryInput): MountedDirectory {
  const mountedFiles = new Map<string, MountedDirectoryFile>();

  if (files) {
    const entries = Symbol.iterator in Object(files) ? files as Iterable<[string, Uint8Array]> : Object.entries(files);
    for (const [filePath, bytes] of entries) {
      mountedFiles.set(normalizeVirtualPath(filePath), {
        path: normalizeVirtualPath(filePath),
        bytes
      });
    }
  }

  return {
    path: normalizeDirectoryPath(path),
    files: mountedFiles
  };
}

/**
 * Original name: N/A
 * Source: N/A (listing helper)
 * Category: New
 * Purpose: Enumerate loose file paths with the mounted directory prefix used by `FS_ListFiles`.
 *
 * Constraints:
 * - Must not include synthetic directory names; `SFF_SUBDIR` handles those separately.
 */
function listMountedLooseFiles(directory: MountedDirectory): string[] {
  return [...directory.files.values()].map((directoryFile) => `${directory.path}/${normalizeVirtualPath(directoryFile.path)}`);
}

/**
 * Original name: N/A
 * Source: N/A (listing helper)
 * Category: New
 * Purpose: Derive mounted subdirectory names for `FS_ListFiles(..., SFF_SUBDIR, ...)`.
 *
 * Constraints:
 * - Must return immediate directory paths rather than files inside them.
 */
function listMountedSubdirectories(directory: MountedDirectory): string[] {
  const subdirectories = new Set<string>();

  for (const directoryFile of directory.files.values()) {
    const normalizedPath = normalizeVirtualPath(directoryFile.path);
    const slashIndex = normalizedPath.lastIndexOf("/");
    if (slashIndex <= 0) {
      continue;
    }

    subdirectories.add(`${directory.path}/${normalizedPath.slice(0, slashIndex)}`);
  }

  return [...subdirectories];
}

/**
 * Original name: N/A
 * Source: N/A (link resolution helper)
 * Category: New
 * Purpose: Resolve the original Quake II filesystem link prefixes before normal search path iteration.
 *
 * Constraints:
 * - Must perform prefix matching on normalized paths.
 */
function resolveLinkedFilename(filesystem: VirtualFilesystem, filename: string): string | null {
  for (const link of filesystem.fs_links) {
    if (!filename.startsWith(link.from)) {
      continue;
    }

    return `${link.to}${filename.slice(link.fromlength)}`.replaceAll("//", "/");
  }

  return null;
}

/**
 * Original name: N/A
 * Source: N/A (link resolution helper)
 * Category: New
 * Purpose: Resolve a linked file against mounted in-memory directories.
 *
 * Constraints:
 * - Must only match mounted directory roots because host IO is intentionally absent.
 */
function readDirectoryLinkedFile(filesystem: VirtualFilesystem, linkedFilename: string): MountedVirtualFile | undefined {
  const normalizedLinkedFilename = normalizeVirtualPath(linkedFilename);

  for (const search of filesystem.searchPaths) {
    if (!search.directory) {
      continue;
    }

    const normalizedRoot = normalizeDirectoryPath(search.directory.path);
    if (!normalizedLinkedFilename.startsWith(`${normalizedRoot}/`)) {
      continue;
    }

    const relativePath = normalizedLinkedFilename.slice(normalizedRoot.length + 1);
    const file = search.directory.files.get(relativePath);
    if (!file) {
      continue;
    }

    return {
      search,
      path: file.path,
      bytes: file.bytes
    };
  }

  return undefined;
}

/**
 * Original name: N/A
 * Source: N/A (path normalization helper)
 * Category: New
 * Purpose: Normalize a Quake virtual file path to forward slashes and lowercase for lookups.
 *
 * Constraints:
 * - Must preserve relative path semantics.
 */
function normalizeVirtualPath(value: string): string {
  return value.replaceAll("\\", "/").replaceAll("//", "/").replace(/^\.\/+/, "").toLowerCase();
}

/**
 * Original name: N/A
 * Source: N/A (path normalization helper)
 * Category: New
 * Purpose: Normalize one mounted directory path while preserving directory-like separators.
 *
 * Constraints:
 * - Must trim trailing slashes except for root-like single slash values.
 */
function normalizeDirectoryPath(value: string): string {
  const normalized = normalizeVirtualPath(value);
  if (normalized.length <= 1) {
    return normalized;
  }

  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

/**
 * Original name: N/A
 * Source: N/A (wildcard helper)
 * Category: New
 * Purpose: Match one path against a Quake-style `*` and `?` wildcard pattern.
 *
 * Constraints:
 * - Must remain case-insensitive after normalization.
 */
function wildcardMatches(value: string, pattern: string): boolean {
  const effectivePattern = pattern.endsWith("/*.*") ? `${pattern.slice(0, -3)}*` : pattern;
  let regexPattern = "^";

  for (const char of effectivePattern) {
    if (char === "*") {
      regexPattern += "[^/]*";
    } else if (char === "?") {
      regexPattern += "[^/]";
    } else {
      regexPattern += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }

  regexPattern += "$";
  return new RegExp(regexPattern, "i").test(value);
}
