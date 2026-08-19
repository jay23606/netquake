import { V3 } from "./Vector.js";

// Quake's intrusive doubly-linked area list (link_t). trigger_edicts/solid_edicts
// on each AreaNode are circular sentinel heads (ent === null); each edict's `area`
// is a member link whose `ent` back-references its owner. prev/next are null only
// while an edict is unlinked (see sv.unlinkEdict). In a C port this is a bare
// link_t embedded in edict_t.
export type Link = {
    prev: Link | null
    next: Link | null
    ent: Edict | null
}

export type Edict = {
    alpha: number,
    num: number,
    free: boolean,
    // registered in sv.state.solidNotPushables (see sv.linkEdict)
    solidNotListed?: boolean,
    area: Link,
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
    // QSS-M edict_t oldthinktime/oldframe (johnfitz): captured by runThink, read by the
    // sendinterval computation at the physics-loop tail (U_lerpfinish timing).
    oldthinktime: number
    oldframe: number
    visframe: number
    // gatherPushCandidates membership stamp (branchless dedup between the area query,
    // the SOLID_NOT registry, and the vanilla rider-completion scan)
    pushStamp: number
    // FTE_ENT_SKIN_CONTENTS: set each server frame by checkWater when the player's bbox
    // overlaps a SOLID_BSP entity whose skin reports CONTENTS_LADDER. Native-only, like
    // QSS-M's edict_t->onladder -- never exposed to QC.
    onladder: boolean
  }