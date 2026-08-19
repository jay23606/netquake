import type { Model } from "./Model";
import type { V3 } from "./Vector";

// surf === 0: invalid, needs re-walk. surf === -1: walked, no lit surface hit.
// surf > 0: worldmodel.faces index + 1, ds/dt are the lightmap sample coords.
export type LightCache = {
    surf: number,
    ds: number,
    dt: number,
    pos: Float32Array
}

export type Entity = {
    alpha: number,
    scale: number,
    update_type: number,
    syncbase: number,
    num: number,
    free: boolean,
    area: any,
    leafnums: number[],
    baseline: {
      alpha: number,
      scale: number,
      origin: V3,
      angles: V3,
      modelindex: number,
      frame: number,
      colormap: number,
      skin: number,
      effects: number
    },
    freetime: number,
    v: ArrayBuffer;
    v_float: Float32Array
    v_int: Int32Array
    sendinterval?: boolean
    visframe: number
    angles: V3
    origin: V3
    model?: Model
    frame: number
    lerpflags: number
    lerpfinish: number
    lerpstart: number       // anim lerp: cl.time when current pose transition began
    lerptime: number        // anim lerp: expected interval between poses (0.1 or framegroup spacing)
    previouspose: number    // cmdofs of the pose being blended from (-1 = none)
    currentpose: number     // cmdofs of the pose being blended to
    movelerpstart: number   // transform lerp: cl.time when origin/angles last changed
    previousorigin: V3
    currentorigin: V3
    previousangles: V3
    currentangles: V3
    skinnum: number
    effects: number
    colormap: number
    msgtime: number
    forcelink: boolean
    msg_origins: V3[]
    msg_angles: V3[]
    dlightframe: number,
    dlightbits: number[]
    lightcache: LightCache
  }