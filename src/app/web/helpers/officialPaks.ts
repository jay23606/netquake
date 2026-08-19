// Fingerprints of the official id1 pak files (registered v1.06; pak0 is
// byte-identical to the shareware 1.06 release). Hashes verified against the
// documented v1.06 MD5s (pak0 5906e599…, pak1 d76b3e56…) — a pak that doesn't
// match renders/collides differently than other players' copies, which shows
// up in multiplayer as falling into stairs and walking through walls.
export type OfficialPak = { size: number, sha256: string, label: string }

export const OFFICIAL_ID1_PAKS: Record<string, OfficialPak> = {
  'pak0.pak': {
    size: 18689235,
    sha256: '35a9c55e5e5a284a159ad2a62e0e8def23d829561fe2f54eb402dbc0a9a946af',
    label: 'v1.06'
  },
  'pak1.pak': {
    size: 34257856,
    sha256: '94e355836ec42bc464e4cbe794cfb7b5163c6efa1bcc575622bb36475bf1cf30',
    label: 'v1.06'
  }
}

// 'unknown' = no reference for this file, or its hash hasn't been computed yet
export type PakVerdict = 'official' | 'nonstandard' | 'unknown'

export const pakVerdict = (fileName: string, sha256?: string): PakVerdict => {
  const official = OFFICIAL_ID1_PAKS[fileName.toLowerCase()]
  if (!official || !sha256) return 'unknown'
  return sha256 === official.sha256 ? 'official' : 'nonstandard'
}
