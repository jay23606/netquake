import type { SourceId } from '../../../shared/types/Source'

export type QuaddictedMap = {
  // Absent on listing payloads generated before multi-source support.
  sourceId?: SourceId,
  name: string,
  title: string,
  author: string,
  id: string,
  downloadLink: string,
  fileName: string,
  size: number,
  detailLink: string,
  date: Date,
  rating: number,
  userRating: number
  mapList: string[]
  depends: string | null
  requirements: string[]
  gameDir: string
  byteLength: number
  // Per-file zip-entry -> gameDir-relative destination mapping computed by
  // server-side zip inspection (slipseer maps). Non-empty means
  // authoritative: install exactly these entries, skip anything unlisted.
  // Empty/absent means the client's own layout heuristics apply.
  extractionHints?: Record<string, string>
}