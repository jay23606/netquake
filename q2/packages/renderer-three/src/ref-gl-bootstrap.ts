/**
 * File: ref-gl-bootstrap.ts
 * Purpose: Compose the ported `gl_rmain.c` runtime with the ported `qgl.h` bootstrap helpers.
 *
 * This file is not a direct source port.
 * It is a small integration layer that packages the classic `ref_gl` bootstrap path for host runtimes.
 *
 * Dependencies:
 * - packages/renderer-three/src/gl_rmain.ts
 * - packages/renderer-three/src/qgl.ts
 */

import { createGlRmainRuntime, type GlRmainHooks, type GlRmainRuntime } from "./gl_rmain.js";
import {
  createQglBootstrapHooks,
  createQglRuntime,
  createQwglRuntime,
  type QglRuntime,
  type QglSymbolProvider,
  type QwglRuntime
} from "./qgl.js";

/**
 * Original name: N/A
 * Source: N/A (renderer ref_gl bootstrap)
 * Category: New
 * Purpose: Describe the `gl_rmain` hooks still supplied by the host after QGL bootstrap hooks are wired here.
 */
type RefGlBootstrapRuntimeHooks = Omit<GlRmainHooks, "qglInit" | "qglShutdown" | "resolveBackendProc" | "getGlStrings">;

/**
 * Original name: N/A
 * Source: N/A (renderer ref_gl bootstrap)
 * Category: New
 * Purpose: Describe injectable host providers used to assemble one ref_gl bootstrap runtime.
 */
export interface RefGlBootstrapOptions {
  hooks?: RefGlBootstrapRuntimeHooks;
  qglRuntime?: QglRuntime;
  qwglRuntime?: QwglRuntime;
  createQglProvider: (driver: string) => QglSymbolProvider | null;
  createQwglProvider?: () => QglSymbolProvider | null;
}

/**
 * Original name: N/A
 * Source: N/A (renderer ref_gl bootstrap)
 * Category: New
 * Purpose: Return the assembled renderer runtime together with the QGL runtimes it owns.
 */
export interface RefGlBootstrap {
  runtime: GlRmainRuntime;
  qglRuntime: QglRuntime;
  qwglRuntime?: QwglRuntime;
}

/**
 * Original name: N/A
 * Source: N/A (renderer ref_gl bootstrap)
 * Category: New
 * Purpose: Build one `gl_rmain` runtime already wired to the ported `QGL` / `QWGL` bootstrap flow.
 *
 * Constraints:
 * - Must keep the host-facing backend provider injection explicit.
 * - Must only create a `QWGL` runtime when the host also exposes a Win32-style provider.
 */
export function createRefGlBootstrap(options: RefGlBootstrapOptions): RefGlBootstrap {
  const qglRuntime = options.qglRuntime ?? createQglRuntime();
  const qwglRuntime = options.qwglRuntime ?? (options.createQwglProvider ? createQwglRuntime() : undefined);

  const runtime = createGlRmainRuntime({
    ...options.hooks,
    ...createQglBootstrapHooks({
      qglRuntime,
      createQglProvider: options.createQglProvider,
      ...(qwglRuntime ? { qwglRuntime } : {}),
      ...(options.createQwglProvider ? { createQwglProvider: options.createQwglProvider } : {})
    })
  });

  return {
    runtime,
    qglRuntime,
    ...(qwglRuntime ? { qwglRuntime } : {})
  };
}
