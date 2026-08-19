export type PackedFile = {
  name: string,
  filepos: number,
  filelen: number
}

export type PakData = {
  name: string,
  data: ArrayBuffer,
  type: string,
  contents: PackedFile[]
}

export type SearchPath = {
  dir: string
  // type: string
  packs: PakData[]
} 