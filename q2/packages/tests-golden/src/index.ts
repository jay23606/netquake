/**
 * File: q_shared.ts
 * Purpose: Expose golden-test snapshot helpers used to compare current port output against recorded expectations.
 *
 * This file is not a direct source port.
 * It is a package entry point for golden-test helpers and fixtures.
 *
 * Dependencies:
 * - packages/tests-golden/src/snapshots.ts
 */

export {
  assertGoldenSnapshot,
  createPakSummarySnapshot
} from "./snapshots.js";

export type { GoldenPakSummarySnapshot } from "./snapshots.js";
