// progs.dat loader — parses a vanilla QuakeC progs.dat (dprograms_t + its six
// lumps) and installs it into a WASM VM instance's exports (sim.wasm's `x`, or
// any instance exposing the same installStatement/installFunction/setNumFunctions/
// setEdictSize/initEdicts/writeGlobalInt/scratchPtr/maxScratch/loadStringBlock
// surface — see assembly/vm.ts, assembly/ed.ts, assembly/strings.ts).
//
// Struct layouts transliterated from src/engine/pr.ts loadProgs (the JS engine's
// own progs.dat parser) — see that function for the byte-for-byte reference:
//   dprograms_t header: u32 version, u32 crc, then 6x{u32 ofs, u32 num} for
//     [statements, globaldefs, fielddefs, functions, strings, globals], then
//     u32 entityfields at offset 56.
//   dstatement_t (8 bytes): u16 op, u16 a, u16 b, u16 c (pr.ts reads these as
//     UNSIGNED 16-bit -- vm.ts's OP.jz/jnz/jump sign-extend a/b/c themselves at
//     the use site via `(x<<16)>>16`, so the raw unsigned pattern is what must
//     be installed here, matching pr.ts exactly).
//   dfunction_t (36 bytes): i32 first_statement, u32 parm_start, u32 locals,
//     u32 profile, u32 s_name, u32 s_file, u32 numparms, u8 parm_size[8].
//   globals lump: num x 4 raw bytes, loaded as i32 (pr.ts: getInt32).
//   strings lump: num raw bytes, a NUL-separated char heap (string_t values are
//     byte offsets into it) -- loaded verbatim at heap offset 0 (pr.ts: a
//     getUint8 loop into state.strings[0..num)).
//
// Works in Node AND browser: only touches `progsBytes` (a Uint8Array/ArrayBuffer
// the caller supplies) and the wasm instance's own exports/memory -- no Node-only
// APIs (no `fs`, no Buffer).

const HEADER_LUMP_OFS = 8; // first {ofs,num} pair starts right after version+crc

function readLump(view, index) {
  const base = HEADER_LUMP_OFS + index * 8;
  return { ofs: view.getUint32(base, true), num: view.getUint32(base + 4, true) };
}

// Installs a full progs.dat into wasm instance exports `x`. `progsBytes` is a
// Uint8Array (or ArrayBuffer) holding the raw file. `maxEdicts` sizes the edict
// table ed.ts allocates (default matches the task spec / typical golden-test scale).
//
// Returns the parsed tables (statements[], functions[], entityfields, etc.) so
// callers (e.g. a differential harness) can inspect the program without
// re-parsing the file.
export function loadProgs(x, progsBytes, maxEdicts = 1024) {
  const bytes = progsBytes instanceof Uint8Array ? progsBytes : new Uint8Array(progsBytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const version = view.getUint32(0, true);
  const crc = view.getUint32(4, true);

  const [stmtLump, globaldefLump, fielddefLump, fnLump, strLump, globalsLump] =
    [0, 1, 2, 3, 4, 5].map((i) => readLump(view, i));
  const entityfields = view.getUint32(56, true);
  const edictSizeBytesQC = 96 + entityfields * 4;

  // --- statements ------------------------------------------------------------
  const statements = new Array(stmtLump.num);
  {
    let ofs = stmtLump.ofs;
    for (let i = 0; i < stmtLump.num; i++) {
      const op = view.getUint16(ofs, true);
      const a = view.getUint16(ofs + 2, true);
      const b = view.getUint16(ofs + 4, true);
      const c = view.getUint16(ofs + 6, true);
      statements[i] = { op, a, b, c };
      x.installStatement(i, op, a, b, c);
      ofs += 8;
    }
  }

  // --- globaldefs / fielddefs --------------------------------------------------
  // Not needed by the VM to execute bytecode (no field-name/global-name resolution
  // happens in the interpreter loop) -- parsed anyway since callers may want them
  // (e.g. to look up a function's globaldef-declared name), but NOT installed into
  // the wasm VM (it has no corresponding install API -- vm.ts doesn't model defs).
  const globaldefs = new Array(globaldefLump.num);
  {
    let ofs = globaldefLump.ofs;
    for (let i = 0; i < globaldefLump.num; i++) {
      globaldefs[i] = {
        type: view.getUint16(ofs, true),
        ofs: view.getUint16(ofs + 2, true),
        name: view.getUint32(ofs + 4, true),
      };
      ofs += 8;
    }
  }
  const fielddefs = new Array(fielddefLump.num);
  {
    let ofs = fielddefLump.ofs;
    for (let i = 0; i < fielddefLump.num; i++) {
      fielddefs[i] = {
        type: view.getUint16(ofs, true),
        ofs: view.getUint16(ofs + 2, true),
        name: view.getUint32(ofs + 4, true),
      };
      ofs += 8;
    }
  }

  // --- functions ---------------------------------------------------------------
  const functions = new Array(fnLump.num);
  {
    let ofs = fnLump.ofs;
    for (let i = 0; i < fnLump.num; i++) {
      const first_statement = view.getInt32(ofs, true);
      const parm_start = view.getUint32(ofs + 4, true);
      const locals = view.getUint32(ofs + 8, true);
      const profile = view.getUint32(ofs + 12, true);
      const s_name = view.getUint32(ofs + 16, true);
      const s_file = view.getUint32(ofs + 20, true);
      const numparms = view.getUint32(ofs + 24, true);
      const parm_size = [
        view.getUint8(ofs + 28), view.getUint8(ofs + 29),
        view.getUint8(ofs + 30), view.getUint8(ofs + 31),
        view.getUint8(ofs + 32), view.getUint8(ofs + 33),
        view.getUint8(ofs + 34), view.getUint8(ofs + 35),
      ];
      functions[i] = { first_statement, parm_start, locals, profile, s_name, s_file, numparms, parm_size };
      x.installFunction(
        i, first_statement, parm_start, locals, numparms,
        parm_size[0], parm_size[1], parm_size[2], parm_size[3],
        parm_size[4], parm_size[5], parm_size[6], parm_size[7],
      );
      ofs += 36;
    }
  }

  x.setNumFunctions(fnLump.num);
  x.setEdictSize(edictSizeBytesQC);
  x.initEdicts(maxEdicts, entityfields); // heap.alloc -- may grow wasm memory, detaching any prior view

  // --- globals -------------------------------------------------------------------
  // Raw int/float union words (pr.ts: `state.globals_int[i] = view.getInt32(...)`).
  {
    let ofs = globalsLump.ofs;
    for (let i = 0; i < globalsLump.num; i++) {
      x.writeGlobalInt(i, view.getInt32(ofs, true));
      ofs += 4;
    }
  }

  // --- strings ---------------------------------------------------------------
  // Stage the lump bytes at the VM's SCRATCH region, then bulk-copy into the
  // string heap at offset 0 in one shot (strings.ts loadStringBlock -- installed
  // by this task). Views into x.memory.buffer are created fresh here, AFTER
  // initEdicts's heap.alloc above, since heap.alloc can grow memory and detach
  // any earlier-captured ArrayBuffer/view (see vm.test.mjs's same precaution).
  {
    if (strLump.num > x.maxScratch()) {
      throw new Error(`progsLoader: strings lump (${strLump.num} bytes) exceeds SCRATCH capacity (${x.maxScratch()})`);
    }
    const scratch = new Uint8Array(x.memory.buffer, x.scratchPtr(), strLump.num);
    scratch.set(bytes.subarray(strLump.ofs, strLump.ofs + strLump.num));
    x.loadStringBlock(strLump.num);
  }

  return {
    version, crc,
    statements, functions, globaldefs, fielddefs,
    entityfields, edictSizeBytesQC,
    numGlobals: globalsLump.num,
    stringsLen: strLump.num,
    maxEdicts,
  };
}
