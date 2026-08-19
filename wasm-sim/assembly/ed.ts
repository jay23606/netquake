// Contiguous edict field storage (sv.ts makeEdict / pr.ts OP.storep_*/OP.address).
// The JS gives each Edict its own ArrayBuffer with v_float/v_int views (int/float
// union); here it's ONE block: edict i's fields at base + i*edictSizeWords*4, each
// field read/written as i32 or f32 over the same bytes.
// edictSizeWords (== pr.state.entityfields) and maxEdicts are dynamic per
// progs.dat, so the block is heap.alloc'd at runtime in initEdicts.
// edict_size (pr.ts) = 96 + entityfields*4 is the QC POINTER-SPACE size in bytes
// (96-byte legacy header); it NEVER indexes this block.
// Float stores round ONCE to f32 from an f64 result (edStoreFloat).

const HEADER_BYTES: i32 = 96; // QC pointer-space header (pr.ts edict_size = 96 + entityfields*4)

let base: usize = 0;
let maxEdictsG: i32 = 0;
let edictSizeWordsG: i32 = 0;  // == pr.state.entityfields
let edictSizeBytesQC: i32 = 0; // == pr.state.edict_size (QC pointer space only, never indexes our block)

// Allocates the block for `maxEdicts` edicts of `edictSizeWords` fields each.
// Call once per progs/map load.
export function initEdicts(maxEdicts: i32, edictSizeWords: i32): void {
  maxEdictsG = maxEdicts;
  edictSizeWordsG = edictSizeWords;
  edictSizeBytesQC = HEADER_BYTES + (edictSizeWords << 2);
  const totalBytes: usize = <usize>maxEdicts * <usize>edictSizeWords * 4;
  base = heap.alloc(totalBytes);
  // heap.alloc does NOT guarantee zeroed memory (TLSF can return stale bytes) —
  // fill explicitly so fresh edict storage reads as 0 like a fresh JS ArrayBuffer.
  memory.fill(base, 0, totalBytes);
  // QSS-M edict_t oldthinktime/oldframe/sendinterval (U_LERPFINISH): C-struct side
  // fields, not entvars — captured by runThink, recomputed per entity in svframe.
  oldThinkTimeBase = heap.alloc(<usize>maxEdicts << 3);
  oldFrameBase = heap.alloc(<usize>maxEdicts << 3);
  sendIntervalBase = heap.alloc(<usize>maxEdicts);
  memory.fill(oldThinkTimeBase, 0, <usize>maxEdicts << 3);
  memory.fill(oldFrameBase, 0, <usize>maxEdicts << 3);
  memory.fill(sendIntervalBase, 0, <usize>maxEdicts);
}

// --- QSS-M sendinterval side-state (see initEdicts note) ------------------------
let oldThinkTimeBase: usize = 0;
let oldFrameBase: usize = 0;
let sendIntervalBase: usize = 0;

// SV_RunThink's capture: `ent->oldthinktime = thinktime; ent->oldframe = ent->v.frame`.
export function setThinkCapture(entNum: i32, thinktime: f64, frame: f64): void {
  store<f64>(oldThinkTimeBase + (<usize>entNum << 3), thinktime);
  store<f64>(oldFrameBase + (<usize>entNum << 3), frame);
}
export function getOldThinkTime(entNum: i32): f64 { return load<f64>(oldThinkTimeBase + (<usize>entNum << 3)); }
export function getOldFrame(entNum: i32): f64 { return load<f64>(oldFrameBase + (<usize>entNum << 3)); }
export function setSendInterval(entNum: i32, v: i32): void { store<u8>(sendIntervalBase + <usize>entNum, v ? 1 : 0); }
export function sendIntervalPtr(): usize { return sendIntervalBase; }

export function edictsBase(): usize { return base; }
export function getMaxEdicts(): i32 { return maxEdictsG; }
export function getEdictSizeWords(): i32 { return edictSizeWordsG; }
export function getEdictSizeBytesQC(): i32 { return edictSizeBytesQC; }

// Byte address of field `fieldIdx` (word index) within edict `entNum`'s field array.
@inline
export function edFieldPtr(entNum: i32, fieldIdx: i32): usize {
  return base + (<usize>entNum * <usize>edictSizeWordsG + <usize>fieldIdx) * 4;
}

// --- Field accessors (raw 32-bit patterns; int/float alias the same bytes,
// exactly like JS v_int/v_float over one ArrayBuffer) --------------------------

export function edLoadInt(entNum: i32, fieldIdx: i32): i32 {
  return load<i32>(edFieldPtr(entNum, fieldIdx));
}

export function edStoreInt(entNum: i32, fieldIdx: i32, bits: i32): void {
  store<i32>(edFieldPtr(entNum, fieldIdx), bits);
}

export function edLoadFloat(entNum: i32, fieldIdx: i32): f32 {
  return load<f32>(edFieldPtr(entNum, fieldIdx));
}

// Rounds the f64 result ONCE to f32 on store (abi.ts setf pattern).
export function edStoreFloat(entNum: i32, fieldIdx: i32, v: f64): void {
  store<f32>(edFieldPtr(entNum, fieldIdx), <f32>v);
}

// ed.ts clearEdict: zero every field word (ed.free reset is host-side state).
export function clearEdict(entNum: i32): void {
  const p = edFieldPtr(entNum, 0);
  const n = edictSizeWordsG;
  for (let i: i32 = 0; i < n; i++) {
    store<i32>(p + (<usize>i << 2), 0);
  }
}

// --- QC pointer <-> entNum/fieldIdx (pr.ts OP.storep_*/OP.load_*/OP.address) ---
// A QC "pointer" is a byte offset into the legacy edict_t[] array (stride
// edict_size), NOT an offset into our block. Valid QC never produces a negative
// pointer, so i32 truncating `/` and `%` match JS Math.floor/% over that domain.

export function ptrToEntNum(ptr: i32): i32 {
  return ptr / edictSizeBytesQC; // pr.ts: Math.floor(ptr / state.edict_size)
}

export function ptrToFieldIdx(ptr: i32): i32 {
  return (ptr % edictSizeBytesQC - HEADER_BYTES) >> 2; // pr.ts: ((ptr % state.edict_size) - 96) >> 2
}

export function entFieldToPtr(entNum: i32, fieldIdx: i32): i32 {
  return entNum * edictSizeBytesQC + HEADER_BYTES + (fieldIdx << 2); // pr.ts OP.address: edictNum*edict_size + 96 + (fieldOfs<<2)
}
