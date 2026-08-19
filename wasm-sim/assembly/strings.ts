// QC string heap + ftos/vtos — port of src/engine/pr.ts (state.strings, getString,
// compareStrings, newString, tempString) and pf.ts #26 ftos / #27 vtos. Also
// compiled standalone for its parity test.
//
// A QC string value is an offset into this heap, not a linear-memory address.
// The heap is stored as u8: pr.ts types state.strings as number[], but every real
// producer only writes byte values — a deliberate narrowing.
//
// ftos/vtos formatting is a HOST IMPORT: AS's dtoa is not V8-compatible (0 ->
// "0.0" vs JS "0") and AS's stdlib has no toFixed, so the host runs the real
// toString()/toFixed(1) and writes the ASCII bytes into SCRATCH; the sim only
// consumes the resulting heap offset.

// --- Heap storage (module-private, linear memory) -------------------------------
const STRINGS_MAX: i32 = 1 << 21; // 2MB (immortal's block ~938KB + zoned + temp ring)
const STRINGS: usize = memory.data(STRINGS_MAX);

// Rotating temp-string ring at the TOP of the heap (FTE PR_MakeTempString model):
// string-RETURNING builtins build results in the next slot, round-robin. The JS
// reference newString-appends forever (growable array + per-map reset), which would
// overflow a fixed heap. Block + zoned strings live below TEMP_POOL_BASE; strzone
// (persistent) still newString-appends into the lower region.
const TEMP_SLOTS: i32 = 128;
const TEMP_SLOT_SIZE: i32 = 512; // max temp-string length (511 + NUL); truncates past it
const TEMP_POOL_SIZE: i32 = TEMP_SLOTS * TEMP_SLOT_SIZE; // 64KB reserved at the top of STRINGS
const TEMP_POOL_BASE: i32 = STRINGS_MAX - TEMP_POOL_SIZE;
let tempRing: i32 = 0;    // next ring slot
let tempCursor: i32 = 0;  // write cursor (heap offset) within the current slot

// SCRATCH: JS stages input bytes here before newString/tempString; ftos/vtos host
// imports write formatted output here too. Sized so a whole progs.dat string lump
// can be staged in one shot for loadStringBlock.
const SCRATCH_MAX: i32 = 1 << 21;
const SCRATCH: usize = memory.data(SCRATCH_MAX);

let heapTop: i32 = 0;    // mirrors state.strings.length (next free heap offset)
let stringTemp: i32 = 0; // mirrors state.string_temp (set by initStringTemp)

export function maxStrings(): i32 { return STRINGS_MAX; }
export function scratchPtr(): usize { return SCRATCH; }
export function maxScratch(): i32 { return SCRATCH_MAX; }
export function heapLength(): i32 { return heapTop; }
export function stringTempOfs(): i32 { return stringTemp; }

@inline function loadC(idx: i32): i32 { return load<u8>(STRINGS + <usize>idx); }
@inline function storeC(idx: i32, v: i32): void { store<u8>(STRINGS + <usize>idx, v); }

// pr.ts's `s[a++] || 0`: out-of-range (including negative) reads as NUL. Unwritten
// wasm memory is zero-init; the explicit bound covers idx outside STRINGS_MAX.
@inline function readByteOrNul(idx: i32): i32 {
  if (idx < 0 || idx >= STRINGS_MAX) return 0;
  return loadC(idx);
}

// pf_strings.ts qTolower (ASCII A-Z -> a-z only).
@inline function qTolower(c: i32): i32 { return (c >= 0x41 && c <= 0x5a) ? c + 0x20 : c; }

// strlen over the heap (up to the NUL), for the s1ofs clamp below.
@inline function heapStrLen(ofs: i32): i32 { let i = 0; while (readByteOrNul(ofs + i) != 0) i++; return i; }

// pf_strings.ts strCaseCmp / strNCaseCmp over the STRINGS heap. Return 0 when equal,
// else the case-folded char diff (the ==0 gate drives progs_dump's surface "sky"
// check). aStart = the s1ofs arg, clamped to strlen(a) exactly like PF_strncasecmp.
export function heapStrCaseCmp(aOfs: i32, bOfs: i32): i32 {
  let i = 0, c1 = 0, c2 = 0;
  do {
    c1 = qTolower(readByteOrNul(aOfs + i)); c2 = qTolower(readByteOrNul(bOfs + i));
    i++;
    if (c1 == 0) break;
  } while (c1 == c2);
  return c1 - c2;
}
export function heapStrNCaseCmp(aOfs: i32, aStart: i32, bOfs: i32, n: i32): i32 {
  if (n <= 0) return 0;
  if (aStart < 0 || (aStart != 0 && aStart > heapStrLen(aOfs))) aStart = heapStrLen(aOfs);
  const a = aOfs + aStart;
  let i = 0, c1 = 0, c2 = 0;
  do {
    c1 = qTolower(readByteOrNul(a + i)); c2 = qTolower(readByteOrNul(bOfs + i));
    i++;
    if (c1 == 0 || c1 != c2) break;
  } while (--n > 0);
  return c1 - c2;
}

// --- temp-string ring builder (the string-RETURNING builtins build results here) --
export function tempBegin(): void { tempCursor = TEMP_POOL_BASE + tempRing * TEMP_SLOT_SIZE; }
export function tempPutc(c: i32): void {
  const slotEnd = TEMP_POOL_BASE + tempRing * TEMP_SLOT_SIZE + TEMP_SLOT_SIZE - 1;
  if (tempCursor < slotEnd) { storeC(tempCursor, c & 0xff); tempCursor++; }
}
export function tempPutHeapStr(ofs: i32): void {
  let i = 0, c = readByteOrNul(ofs);
  while (c != 0) { tempPutc(c); i++; c = readByteOrNul(ofs + i); }
}
export function tempEnd(): i32 {
  storeC(tempCursor, 0);
  const start = TEMP_POOL_BASE + tempRing * TEMP_SLOT_SIZE;
  tempRing = (tempRing + 1) % TEMP_SLOTS;
  return start;
}

// Embedder-facing: stage `len` bytes from SCRATCH into the temp ring, return the
// offset. Used by string-RETURNING bridged builtins (the JS and WASM string heaps
// don't share offsets).
export function tempStringFromScratch(len: i32): i32 {
  tempBegin();
  for (let i = 0; i < len; i++) tempPutc(load<u8>(SCRATCH + <usize>i));
  return tempEnd();
}

// --- public read helpers (native string builtins; see host.ts dispatch) -----------
export function heapStrlen(ofs: i32): i32 { return heapStrLen(ofs); } // #114 strlen

// #228 strncmp (fold=false) / #229 strcasecmp (fold=true, n<0). 0 if equal else char diff.
export function heapStrCmpN(aOfs: i32, aStart: i32, bOfs: i32, n: i32, fold: bool): i32 {
  if (n == 0) return 0;
  if (aStart < 0 || (aStart != 0 && aStart > heapStrLen(aOfs))) aStart = heapStrLen(aOfs);
  const a = aOfs + aStart;
  let i = 0, c1 = 0, c2 = 0;
  do {
    c1 = readByteOrNul(a + i); c2 = readByteOrNul(bOfs + i);
    if (fold) { c1 = qTolower(c1); c2 = qTolower(c2); }
    i++;
    if (c1 == 0 || c1 != c2) break;
  } while (n < 0 || --n > 0);
  return c1 - c2;
}

// #221 strstrofs: index of `sub` in `s` at/after start, or -1 (JS String.indexOf).
export function heapStrOfs(sOfs: i32, subOfs: i32, start: i32): i32 {
  const slen = heapStrLen(sOfs), sublen = heapStrLen(subOfs);
  if (sublen == 0) return start <= slen ? start : slen;
  for (let i = start; i + sublen <= slen; i++) {
    let m = true;
    for (let j = 0; j < sublen; j++) { if (readByteOrNul(sOfs + i + j) != readByteOrNul(subOfs + j)) { m = false; break; } }
    if (m) return i;
  }
  return -1;
}

// #222 str2chr: char at index (negative counts from end); 0 if out of range.
export function heapCharAt(ofs: i32, idx: i32): i32 {
  const len = heapStrLen(ofs);
  if (idx < 0) idx = len + idx;
  if (idx != 0 && (idx < 0 || idx > len)) return 0;
  return idx < len ? readByteOrNul(ofs + idx) : 0;
}

// #116 substring: s[start..start+length) into a temp string. Negative start counts from the
// end; length<0 (or beyond) runs to the end. Mirrors QSS-M PF_substring's clamps.
export function heapSubstring(sOfs: i32, start: i32, length: i32): i32 {
  const slen = heapStrLen(sOfs);
  if (start < 0) { start = slen + start; if (start < 0) start = 0; }
  if (start > slen) start = slen;
  let end = length < 0 ? slen : start + length;
  if (end > slen) end = slen;
  tempBegin();
  for (let i = start; i < end; i++) tempPutc(readByteOrNul(sOfs + i));
  return tempEnd();
}

// #118 strzone: copy `s` into the PERSISTENT (lower) heap and return its offset. strunzone is
// a no-op (a linear heap can't free mid-region; the per-map instance reset bounds the leak).
export function heapStrzone(sOfs: i32): i32 {
  const start = heapTop;
  let i = 0, c = readByteOrNul(sOfs);
  while (c != 0 && heapTop < TEMP_POOL_BASE - 1) { storeC(heapTop, c); heapTop++; i++; c = readByteOrNul(sOfs + i); }
  storeC(heapTop, 0); heapTop++;
  return start;
}

// --- pr.ts newString(s, length) --------------------------------------------------
// `s` is read from SCRATCH[0..srcLen); appends onto the heap (heapTop), returns
// the starting offset. s.length >= length: writes (length-1) chars + NUL
// (truncating). s.length < length: writes all of s + NUL-pads to `length` bytes.
export function newString(srcLen: i32, length: i32): i32 {
  const ofs = heapTop;
  if (srcLen >= length) {
    for (let i = 0; i < length - 1; i++) {
      storeC(heapTop, load<u8>(SCRATCH + <usize>i));
      heapTop++;
    }
    storeC(heapTop, 0);
    heapTop++;
    return ofs;
  }
  for (let i = 0; i < srcLen; i++) {
    storeC(heapTop, load<u8>(SCRATCH + <usize>i));
    heapTop++;
  }
  const remain = length - srcLen;
  for (let i = 0; i < remain; i++) {
    storeC(heapTop, 0);
    heapTop++;
  }
  return ofs;
}

// --- pr.ts tempString(str) --------------------------------------------------------
// Truncates to 127 chars, writes str + NUL at the fixed string_temp offset
// (bounded in-place write -- does NOT advance heapTop, matching pr.ts).
export function tempString(srcLen: i32): void {
  const len = srcLen > 127 ? 127 : srcLen;
  for (let i = 0; i < len; i++) {
    storeC(stringTemp + i, load<u8>(SCRATCH + <usize>i));
  }
  storeC(stringTemp + len, 0);
}

// --- progs.dat string-lump bulk loader (pr.ts loadProgs strings block) ----------
// Raw lump bytes must land at heap offsets [0..len) unchanged (progs string_t
// values are byte offsets into this block). Sets heapTop = len so later
// newString/tempString calls append right after, matching pr.ts's call order.
export function loadStringBlock(len: i32): void {
  memory.copy(STRINGS, SCRATCH, <usize>len);
  heapTop = len;
}

// --- incremental JS<->WASM heap reconciliation ----------------------------------
// loadStringBlock is a ONE-SHOT map-load copy, but BOTH heaps keep bump-allocating
// out of a SHARED offset space afterwards (JS pr.newString; wasm strzone/newString
// below). Unsynced, the same offset means different bytes on the two sides and the
// two allocators hand out the same next offset. The host reconciles at every call
// boundary via these three (wasmServer syncStringsIn/syncStringsOut).

// Highest offset the persistent (lower) region may reach — the temp ring owns
// everything above it.
export function stringsHeapCapacity(): i32 { return TEMP_POOL_BASE; }

// Copy `len` staged SCRATCH bytes to `dstOfs`, carrying heapTop past them so a
// wasm-side alloc can never reuse an offset the JS side already owns. False when
// the write would run into the temp ring (host warns; heap untouched).
export function writeStringsFromScratch(dstOfs: i32, len: i32): bool {
  if (dstOfs < 0 || len < 0 || dstOfs + len > TEMP_POOL_BASE) return false;
  memory.copy(STRINGS + <usize>dstOfs, SCRATCH, <usize>len);
  if (dstOfs + len > heapTop) heapTop = dstOfs + len;
  return true;
}

// The mirror, for the host to append wasm-allocated bytes onto the JS heap. RAW,
// not NUL-bounded (readStringToScratch is the single-string reader): one sync
// window can span several NUL-separated strzone results.
export function readStringsToScratch(srcOfs: i32, len: i32): i32 {
  if (srcOfs < 0 || len <= 0 || srcOfs >= STRINGS_MAX) return 0;
  if (len > SCRATCH_MAX) len = SCRATCH_MAX;
  if (srcOfs + len > STRINGS_MAX) len = STRINGS_MAX - srcOfs;
  memory.copy(SCRATCH, STRINGS + <usize>srcOfs, <usize>len);
  return len;
}

// pr.ts loadProgram: `state.string_temp = newString('', 128)`, after the string
// block is installed.
export function initStringTemp(): i32 {
  stringTemp = newString(0, 128);
  return stringTemp;
}

// --- pr.ts getString(num) readback (JS-callable helpers for the test) ------------
export function readStringLen(ofs: i32): i32 {
  let n = ofs;
  // Bound by STRINGS_MAX, not heapTop: the temp ring lives ABOVE heapTop, so a
  // heapTop bound reads every temp string as empty. Unwritten heap is zero-init.
  while (n < STRINGS_MAX) {
    if (loadC(n) == 0) break;
    n++;
  }
  return n - ofs;
}

// Copies up to maxLen bytes of the string at `ofs` into SCRATCH; returns the
// number of bytes copied so JS can read SCRATCH[0..len) back into a JS string.
export function readStringToScratch(ofs: i32, maxLen: i32): i32 {
  let len = readStringLen(ofs);
  if (len > maxLen) len = maxLen;
  for (let i = 0; i < len; i++) {
    store<u8>(SCRATCH + <usize>i, loadC(ofs + i));
  }
  return len;
}

// --- pr.ts compareStrings(a, b) / OP.not_s -------------------------------------
// Signatures match vm.ts's declared imports exactly.
export function stringsEqual(a: i32, b: i32): bool {
  if (a == b) return true;
  let pa = a, pb = b;
  while (true) {
    const ca = readByteOrNul(pa); pa++;
    const cb = readByteOrNul(pb); pb++;
    if (ca != cb) return false;
    if (ca == 0) return true;
  }
  return false; // unreachable -- satisfies AS's return-path analysis
}

export function stringIsEmpty(strOfs: i32): bool {
  return readByteOrNul(strOfs) == 0;
}

// --- pf.ts ftos (#26) / vtos (#27) — host imports (see file header). Host writes
// ASCII at outPtr (a SCRATCH address) and returns the byte length, no NUL —
// tempString NUL-terminates.
declare function host_tostring(v: f64, outPtr: usize): i32;
declare function host_tofixed1(v: f64, outPtr: usize): i32;

// pf.ts: `v === Math.floor(v) ? v.toString() : v.toFixed(1)`, through tempString.
export function ftos(v: f64): i32 {
  const len: i32 = v == Math.floor(v) ? host_tostring(v, SCRATCH) : host_tofixed1(v, SCRATCH);
  tempString(len);
  return stringTemp;
}

// pf.ts: three toFixed(1) components joined with single spaces, through tempString.
export function vtos(x: f64, y: f64, z: f64): i32 {
  let p: i32 = 0;
  p += host_tofixed1(x, SCRATCH + <usize>p);
  store<u8>(SCRATCH + <usize>p, 0x20);
  p++;
  p += host_tofixed1(y, SCRATCH + <usize>p);
  store<u8>(SCRATCH + <usize>p, 0x20);
  p++;
  p += host_tofixed1(z, SCRATCH + <usize>p);
  tempString(p);
  return stringTemp;
}
