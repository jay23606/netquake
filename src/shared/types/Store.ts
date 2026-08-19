import { SourceId } from "./Source";

export type PackageType = 'map' | 'mod';

// Describes a package that has been loaded and is available.
export type PackageMeta = {
  packageId: number
  sourceId: SourceId,
  name: string
  gameDir: string
  depends: string | null// map id
  // false while the package's assets are still being written; set to true as
  // the final step of an install. A row left at false is an interrupted
  // install and gets cleaned up on the next load. Absent on rows written
  // before this flag existed — treat those as complete.
  complete?: boolean
}

export type PackageMetaSeed = Omit<PackageMeta, 'packageId'>

export type AssetMeta = {
  game: string
  assetId: string
  fileName: string
  fileCount: number
  fileSize?: number
  packageId?: number
  // SHA-256 hex of the file contents; computed for .pak files at save time
  // (backfilled lazily for paks saved before this field existed).
  sha256?: string
}

export type Asset = AssetMeta & {
  data: ArrayBuffer
}
