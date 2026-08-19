/**
 * File: pak.ts
 * Source: Quake II original / qcommon/qfiles.h and qcommon/files.c
 * Purpose: Parse Quake II PAK archives and expose their directory entries.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Parses from Uint8Array buffers instead of FILE pointers.
 * - Uses immutable archive metadata objects for safer web/runtime integration.
 *
 * Notes:
 * - This file is intended to stay close to the original PAK format declarations.
 */

import { getLittleLong } from "../../memory/src/binary-io.js";

/**
 * Original name: IDPAKHEADER
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Four-byte PAK magic used by Quake II archive headers.
 */
export const IDPAKHEADER = (("K".charCodeAt(0) << 24) + ("C".charCodeAt(0) << 16) + ("A".charCodeAt(0) << 8) + "P".charCodeAt(0)) | 0;

/**
 * Original name: MAX_FILES_IN_PACK
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Upper bound for directory entries in one Quake II PAK archive.
 */
export const MAX_FILES_IN_PACK = 4096;

/**
 * Original name: N/A
 * Source: N/A (derived PAK directory entry size)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose:
 * - Keep the fixed `dpackfile_t` byte size explicit for binary parsing.
 */
const DPACKFILE_SIZE = 64;

/**
 * Original name: N/A
 * Source: N/A (derived PAK header size)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose:
 * - Keep the fixed `dpackheader_t` byte size explicit for binary parsing.
 */
const DPACKHEADER_SIZE = 12;

/**
 * Original name: N/A
 * Source: N/A (derived PAK filename field size)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose:
 * - Keep the fixed `dpackfile_t.name` byte width explicit for binary parsing.
 */
const DPACKFILENAME_SIZE = 56;

/**
 * Original name: dpackfile_t
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Describes one fixed-width directory entry in a Quake II PAK archive.
 *
 * Porting notes:
 * - The C `name[56]` field is exposed as a decoded string.
 */
export interface dpackfile_t {
  name: string;
  filepos: number;
  filelen: number;
}

/**
 * Original name: dpackheader_t
 * Source: Quake-2-master/qcommon/qfiles.h
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Stores the Quake II PAK magic and directory offset/length.
 */
export interface dpackheader_t {
  ident: number;
  dirofs: number;
  dirlen: number;
}

/**
 * Original name: packfile_t
 * Source: Quake-2-master/qcommon/files.c
 * Category: Adapter
 * Fidelity level: Close
 *
 * Behavior:
 * - Describes a file entry contained in a Quake II PAK archive.
 *
 * Porting notes:
 * - Extends `dpackfile_t`, the owning qfiles.h directory-entry port.
 * - Adds `normalizedName` to simplify case-insensitive search path behavior.
 */
export interface PakEntry extends dpackfile_t {
  normalizedName: string;
}

/**
 * Original name: N/A
 * Source: N/A (PAK archive parser result)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose: Represent a parsed Quake II PAK archive with raw bytes and indexed directory entries.
 *
 * Constraints:
 * - Must keep a direct link to the raw archive bytes for future streaming and slicing.
 */
export interface PakArchive {
  header: dpackheader_t;
  entries: PakEntry[];
  bytes: Uint8Array;
  path?: string;
}

/**
 * Original name: N/A
 * Source: N/A (PAK archive parser used by FS_LoadPackFile)
 * Category: Adapter
 * Fidelity level: Close
 *
 * Behavior:
 * - Validates and parses the header and directory of a Quake II PAK file.
 *
 * Porting notes:
 * - The owning `FS_LoadPackFile` port remains in `packages/filesystem/src/files.ts`.
 * - Omits checksum validation for now.
 * - Returns a parsed archive object instead of allocating Quake zone memory.
 */
export function parsePak(bytes: Uint8Array, path?: string): PakArchive {
  if (bytes.byteLength < DPACKHEADER_SIZE) {
    throw new Error("parsePak: buffer is too small to contain a PAK header");
  }

  const header: dpackheader_t = {
    ident: getLittleLong(bytes, 0),
    dirofs: getLittleLong(bytes, 4),
    dirlen: getLittleLong(bytes, 8)
  };

  if (header.ident !== IDPAKHEADER) {
    throw new Error(`${path ?? "pak"} is not a packfile`);
  }

  const numpackfiles = header.dirlen / DPACKFILE_SIZE;

  if (!Number.isInteger(numpackfiles)) {
    throw new Error(`${path ?? "pak"} has an invalid directory length`);
  }

  if (numpackfiles > MAX_FILES_IN_PACK) {
    throw new Error(`${path ?? "pak"} has ${numpackfiles} files`);
  }

  if (header.dirofs < 0 || header.dirlen < 0 || header.dirofs + header.dirlen > bytes.byteLength) {
    throw new Error(`${path ?? "pak"} has a directory outside the file bounds`);
  }

  const entries: PakEntry[] = [];

  for (let index = 0; index < numpackfiles; index += 1) {
    const entryOffset = header.dirofs + index * DPACKFILE_SIZE;
    const name = decodePakName(bytes.subarray(entryOffset, entryOffset + DPACKFILENAME_SIZE));
    const filepos = getLittleLong(bytes, entryOffset + DPACKFILENAME_SIZE);
    const filelen = getLittleLong(bytes, entryOffset + DPACKFILENAME_SIZE + 4);

    if (filepos < 0 || filelen < 0 || filepos + filelen > bytes.byteLength) {
      throw new Error(`${path ?? "pak"} contains an out-of-bounds entry: ${name}`);
    }

    entries.push({
      name,
      normalizedName: normalizePakPath(name),
      filepos,
      filelen
    });
  }

  return path === undefined
    ? {
        header,
        entries,
        bytes
      }
    : {
        header,
        entries,
        bytes,
        path
      };
}

/**
 * Original name: N/A
 * Source: N/A (PAK lookup helper)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose: Find a PAK entry using Quake-like case-insensitive path matching.
 *
 * Constraints:
 * - Must normalize slashes and case before comparing names.
 */
export function findPakEntry(archive: PakArchive, filename: string): PakEntry | undefined {
  const normalizedName = normalizePakPath(filename);
  return archive.entries.find((entry) => entry.normalizedName === normalizedName);
}

/**
 * Original name: N/A
 * Source: N/A (PAK data slicing helper)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose: Read the raw byte content of a parsed PAK entry.
 *
 * Constraints:
 * - Must return an exact byte slice for the entry range.
 */
export function readPakEntryData(archive: PakArchive, entry: PakEntry): Uint8Array {
  return archive.bytes.slice(entry.filepos, entry.filepos + entry.filelen);
}

/**
 * Original name: N/A
 * Source: N/A (PAK filename decoder)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose: Decode the fixed-width null-terminated PAK entry name field.
 *
 * Constraints:
 * - Must stop at the first zero byte.
 */
function decodePakName(bytes: Uint8Array): string {
  let end = bytes.indexOf(0);
  if (end === -1) {
    end = bytes.length;
  }

  let result = "";
  for (let index = 0; index < end; index += 1) {
    result += String.fromCharCode(bytes[index]);
  }

  return result;
}

/**
 * Original name: N/A
 * Source: N/A (PAK path normalization helper)
 * Category: New
 * Fidelity level: NewTooling
 *
 * Purpose: Normalize PAK lookup paths so search behavior matches Quake II case-insensitive comparisons.
 *
 * Constraints:
 * - Must normalize slash direction and lowercase the result.
 */
function normalizePakPath(value: string): string {
  return value.replaceAll("\\", "/").toLowerCase();
}
