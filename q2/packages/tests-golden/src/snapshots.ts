/**
 * File: snapshots.ts
 * Purpose: Define portable golden snapshot structures and comparison helpers.
 *
 * This file is not a direct source port.
 * It is a support module for regression detection across the Quake II port.
 *
 * Dependencies:
 * - packages/formats/src/pak.ts
 */

import type { PakArchive } from "../../formats/src/pak.js";

/**
 * Original name: N/A
 * Source: N/A (golden snapshot test tooling)
 * Category: NewTooling
 * Purpose: Describe a compact but meaningful golden snapshot for a parsed PAK archive.
 *
 * Constraints:
 * - Must stay stable across runs on the same archive.
 * - Must avoid embedding the full archive or every file entry by default.
 */
export interface GoldenPakSummarySnapshot {
  kind: "pak-summary";
  sourcePath: string;
  entryCount: number;
  firstEntries: string[];
  lastEntries: string[];
  sentinelEntries: Record<string, number>;
}

/**
 * Original name: N/A
 * Source: N/A (golden snapshot test tooling)
 * Category: NewTooling
 * Purpose: Build a stable golden summary from a parsed PAK archive.
 *
 * Constraints:
 * - Must sort names deterministically before selecting summary slices.
 */
export function createPakSummarySnapshot(
  archive: PakArchive,
  sourcePath: string,
  sentinelNames: string[]
): GoldenPakSummarySnapshot {
  const sortedNames = archive.entries.map((entry) => entry.normalizedName).sort((left, right) => left.localeCompare(right));
  const sentinelEntries = Object.fromEntries(
    sentinelNames.map((name) => {
      const normalizedName = name.replaceAll("\\", "/").toLowerCase();
      const match = archive.entries.find((entry) => entry.normalizedName === normalizedName);
      return [normalizedName, match?.filelen ?? -1];
    })
  );

  return {
    kind: "pak-summary",
    sourcePath,
    entryCount: archive.entries.length,
    firstEntries: sortedNames.slice(0, 16),
    lastEntries: sortedNames.slice(-16),
    sentinelEntries
  };
}

/**
 * Original name: N/A
 * Source: N/A (golden snapshot test tooling)
 * Category: NewTooling
 * Purpose: Compare an actual golden snapshot with an expected one and throw on mismatch.
 *
 * Constraints:
 * - Must produce a concise diff-friendly error message.
 */
export function assertGoldenSnapshot<T>(actual: T, expected: T, label: string): void {
  const actualJson = JSON.stringify(actual, null, 2);
  const expectedJson = JSON.stringify(expected, null, 2);

  if (actualJson !== expectedJson) {
    throw new Error(`${label} golden snapshot mismatch\n\nExpected:\n${expectedJson}\n\nActual:\n${actualJson}`);
  }
}
