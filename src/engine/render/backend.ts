// Render backend selection (see docs/render-backend-interface.md).
//
// A canvas is either a WebGL2 context OR a WebGPU device per frame — never both — so the
// backend is chosen once, up front. WebGPU is preferred when available (it enables the
// GPU-driven world path); WebGL2 is the universal fallback. This module only decides and
// constructs; it holds no render state.

import * as com from '../com'

export type BackendKind = 'webgpu' | 'webgl2'

// Why the last webgpuAvailable() probe answered as it did. Read by vid.init and folded into GL.init's
// failure diagnostics: when BOTH APIs fail (the production "Unable to initialize WebGL" report), the
// WebGPU half of the story is what distinguishes a dead/blocked GPU stack from a browser that simply
// predates WebGPU. 'unprobed' until webgpuAvailable() runs.
export const state: { webgpuProbe: string } = { webgpuProbe: 'unprobed' }

// True only when the runtime exposes WebGPU AND an adapter is actually obtainable. Presence of
// `navigator.gpu` is not enough — some environments expose the object but fail requestAdapter.
export const webgpuAvailable = async (): Promise<boolean> => {
  try {
    const gpu = navigator.gpu
    if (gpu == null) { state.webgpuProbe = 'no-navigator-gpu'; return false }
    if (typeof gpu.requestAdapter !== 'function') { state.webgpuProbe = 'no-requestAdapter'; return false }
    const adapter = await gpu.requestAdapter()
    state.webgpuProbe = adapter != null ? 'adapter-ok' : 'adapter-null'
    return adapter != null
  } catch (e: any) {
    state.webgpuProbe = 'threw:' + (e?.message || String(e))
    return false
  }
}

// The WebGL2 safety hatch: `-webgl` or `-nowebgpu` (aliases) force the fallback backend even
// where WebGPU works. `-webgpu` is accepted as an explicit opt-in but is redundant now that
// WebGPU is the default. vid.init is the only caller — it owns the actual construction.
// checkParm returns the arg INDEX (0 = absent), so coerce rather than returning it.
export const forceWebGL = (): boolean => !!com.checkParm('-webgl') || !!com.checkParm('-nowebgpu')
