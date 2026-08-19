// Active-renderer accessor (see docs/render-backend-interface.md).
//
// The engine holds exactly one live IRenderer for the session (a canvas is a WebGL2 context OR a
// WebGPU device — never both, chosen once up front). The backend-agnostic scene layer reaches the
// live backend through getRenderer(); it is installed once during video init via setRenderer().
// This module holds only the pointer, no render state.

import { IRenderer } from './IRenderer'

export const state: { active: IRenderer | null } = { active: null }

export const setRenderer = (renderer: IRenderer): void => {
  state.active = renderer
}

export const getRenderer = (): IRenderer => {
  if (state.active == null)
    throw new Error('getRenderer: no active renderer (setRenderer not called during video init)')
  return state.active
}
