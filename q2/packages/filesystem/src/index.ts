/**
 * File: q_shared.ts
 * Purpose: Expose the Quake II virtual filesystem helpers used to mount and query pack archives.
 *
 * This file is not a direct source port.
 * It is a package entry point for filesystem modules.
 *
 * Dependencies:
 * - packages/filesystem/src/files.ts
 */

export {
  Developer_searchpath,
  createVirtualFilesystem,
  FS_Dir_f,
  FS_AddGameDirectory,
  FS_ExecAutoexec,
  FS_FreeFile,
  FS_Gamedir,
  FS_InitFilesystem,
  FS_Link,
  FS_Link_f,
  FS_ListFiles,
  FS_LoadFile,
  FS_LoadPackFile,
  FS_NextPath,
  FS_Path_f,
  FS_Read,
  FS_SetGamedir,
  MAX_READ,
  markBaseSearchPaths,
  mountDirectory,
  mountPak,
  readMountedFile,
  readMountedTextFile
} from "./files.js";

export type {
  FileLink,
  FilesystemCvar,
  FSInitCommandAdapter,
  FSInitCvarAdapter,
  FSInitFilesystemOptions,
  MountedDirectory,
  MountedDirectoryFile,
  MountedDirectoryInput,
  MountedPak,
  MountedVirtualFile,
  SearchPath,
  VirtualFilesystem
} from "./files.js";
