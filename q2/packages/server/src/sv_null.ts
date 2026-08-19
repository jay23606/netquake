/**
 * File: sv_null.ts
 * Source: Quake II original / server/sv_null.c
 * Purpose: Null server-system stubs used by pure net-only clients.
 *
 * Porting policy:
 * - Preserve original behavior first.
 * - Preserve original names whenever possible.
 * - Avoid structural refactors unless documented.
 *
 * Deviations:
 * - Function signatures are typed explicitly for TypeScript.
 *
 * Notes:
 * - This file intentionally stays as a no-op stub, matching the original C source.
 */

/**
 * Original name: SV_Init
 * Source: server/sv_null.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Initializes the server system in null-server builds.
 *
 * Porting notes:
 * - The original implementation is empty and must remain a no-op.
 */
export function SV_Init(): void {
}

/**
 * Original name: SV_Shutdown
 * Source: server/sv_null.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Shuts down the server system in null-server builds.
 *
 * Porting notes:
 * - The original implementation ignores both parameters and performs no work.
 */
export function SV_Shutdown(finalmsg: string, reconnect: boolean): void {
  void finalmsg;
  void reconnect;
}

/**
 * Original name: SV_Frame
 * Source: server/sv_null.c
 * Category: Ported
 * Fidelity level: Strict
 *
 * Behavior:
 * - Advances one null-server frame in pure net-only client builds.
 *
 * Porting notes:
 * - The original implementation is empty and must remain a no-op.
 */
export function SV_Frame(time: number): void {
  void time;
}