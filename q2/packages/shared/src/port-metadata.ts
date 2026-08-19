/**
 * File: port-metadata.ts
 * Purpose: Define shared metadata types that formalize porting categories and fidelity levels.
 *
 * This file is not a direct source port.
 * It is a shared convention layer used across the workspace.
 *
 * Dependencies:
 * - None
 */

/**
 * Original name: N/A
 * Source: N/A (port metadata convention)
 * Category: New
 * Purpose: Enumerate the allowed categories used in file and function port headers.
 *
 * Constraints:
 * - Must stay aligned with the conventions documented in README.md.
 */
export type PortCategory = "Ported" | "New" | "Adapter" | "NewTooling";

/**
 * Original name: N/A
 * Source: N/A (port metadata convention)
 * Category: New
 * Purpose: Enumerate the allowed fidelity levels used for source ports and adapters.
 *
 * Constraints:
 * - Must stay aligned with the conventions documented in README.md.
 */
export type FidelityLevel = "Strict" | "Close" | "Adapter" | "NewTooling";

/**
 * Original name: N/A
 * Source: N/A (port metadata convention)
 * Category: New
 * Purpose: Describe the metadata block that can be attached to ported files or functions.
 *
 * Constraints:
 * - Keeps source linkage explicit.
 * - Makes category and fidelity machine-readable for future tooling.
 */
export interface PortMetadata {
  category: PortCategory;
  fidelity: FidelityLevel;
  originalName?: string;
  sourcePath?: string;
  purpose: string;
}
