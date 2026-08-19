// stuffcmd (#21) is varargs (FTE PF_stuffcmd), but the sim's dispatch hands the host only PARM1,
// so wasmServer.ts host_stuffcmd joins PARM1.. itself. This pins that join over the real remaster
// progs, with the two argument kinds the JS-side string heap cannot resolve:
//   - an ftos() result, written in place into the sim's single temp slot (below heapLength, so
//     syncStringsOut's [syncedStringLen, heapLength) copy misses it), and
//   - a temp-ring string, above the JS heap entirely and so never mirrored.
// Only the WASM string reader brings them back intact; pr.getString reads stale/empty.
//
// Needs a remaster pak at <repo>/mg1/pak0.pak or mg3/pak0.pak; skips (passing) without one.

import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadWasm, Check } from './lib.mjs';
import { loadProgs } from './progsLoader.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

// --- pak0.pak reader (dir offset/length at 4/8; 64-byte entries) ------------------
function pakFile(pakPath, want) {
  const b = readFileSync(pakPath);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const dirOfs = dv.getUint32(4, true), dirLen = dv.getUint32(8, true);
  for (let i = 0; i < dirLen / 64; i++) {
    const o = dirOfs + i * 64;
    let name = '';
    for (let j = 0; j < 56; j++) { const c = b[o + j]; if (c === 0) break; name += String.fromCharCode(c); }
    if (name.toLowerCase() === want) return b.subarray(dv.getUint32(o + 56, true), dv.getUint32(o + 56, true) + dv.getUint32(o + 60, true));
  }
  return null;
}

// Offset of a literal inside the progs string lump (the mod's own constant).
function progsStringOfs(progs, literal) {
  const view = new DataView(progs.buffer, progs.byteOffset, progs.byteLength);
  const ofs = view.getUint32(8 + 4 * 8, true), num = view.getUint32(8 + 4 * 8 + 4, true);
  for (let i = 0; i < num; i++) {
    let ok = true;
    for (let j = 0; j < literal.length; j++) if (progs[ofs + i + j] !== literal.charCodeAt(j)) { ok = false; break; }
    if (ok && progs[ofs + i + literal.length] === 0) return i;
  }
  return -1;
}

const OP = { DONE: 0, STORE_F: 31, CALL0: 51 };
const PARM = (i) => 4 + i * 3;   // OFS_PARM0=4, 3 apart
const BI_FTOS = 26, BI_STUFFCMD = 21;

const results = [];
let ran = 0;

for (const game of ['mg1', 'mg3']) {
  const pak = join(ROOT, game, 'pak0.pak');
  if (!existsSync(pak)) continue;
  const progs = pakFile(pak, 'progs.dat');
  if (progs == null) continue;
  ran++;

  const chk = new Check(`stuffcmd varargs: ${game}/pak0.pak progs.dat`);
  let x;
  // Host stub = the wasmServer.ts bridge, verbatim in miniature.
  const readWasmString = (ofs) => {
    const len = x.readStringToScratch(ofs, x.maxScratch());
    const u8 = new Uint8Array(x.memory.buffer, x.scratchPtr(), len);
    let s = ''; for (let i = 0; i < len; i++) s += String.fromCharCode(u8[i]);
    return s;
  };
  const wasmVarString = (first) => {
    const g = new Int32Array(x.memory.buffer, x.globalsPtr(), 128);
    let s = '';
    for (let i = first; i < x.getArgc(); i++) s += readWasmString(g[PARM(i)]);
    return s;
  };
  const writeAscii = (str, ptr) => {
    const u8 = new Uint8Array(x.memory.buffer, ptr, str.length);
    for (let i = 0; i < str.length; i++) u8[i] = str.charCodeAt(i) & 0xff;
    return str.length;
  };
  const stuffed = [];
  x = await loadWasm({
    host: new Proxy({
      host_pow: Math.pow,
      host_stuffcmd: (ent, strOfs) => stuffed.push({
        ent,
        argc: x.getArgc(),
        varargs: wasmVarString(1),           // the fix
        firstArgOnly: readWasmString(strOfs), // what the single-string bridge sent
      }),
    }, { get: (t, k) => (k in t ? t[k] : () => 0) }),
    // Real formatters (lib.mjs stubs return 0 => every ftos would be empty).
    strings: {
      host_tostring: (v, p) => writeAscii(String(v), p),
      host_tofixed1: (v, p) => writeAscii(Number(v).toFixed(1), p),
    },
  });

  const p = loadProgs(x, progs, 64);
  x.initStringTemp();   // ftos/vtos temp slot (pr.ts string_temp) — wasmServer.loadMap does this

  const fnOfBuiltin = (n) => p.functions.findIndex((f) => f.first_statement === -n);
  const iFtos = fnOfBuiltin(BI_FTOS), iStuff = fnOfBuiltin(BI_STUFFCMD);
  chk.intEq(iFtos > 0 && iStuff > 0 ? 1 : 0, 1, 'ftos + stuffcmd builtins present');

  // Argument 1: the mod's OWN "\nfog " constant (mg3 SetFog stuffs exactly this).
  const fogOfs = progsStringOfs(progs, '\nfog ');
  const spaceOfs = progsStringOfs(progs, ' ');
  chk.intEq(fogOfs > 0 && spaceOfs > 0 ? 1 : 0, 1, 'progs string constants found');
  // Argument 4: a temp-ring string, what a bridged string builtin returns.
  const RING = '0.3 0.3 0.3';
  const ringOfs = x.tempStringFromScratch(writeAscii(RING, x.scratchPtr()));

  // Synthetic caller appended past the progs' own statements/functions/globals:
  //   PARM0 = 0.5; CALL1 ftos; PARM2 = RETURN; PARM0 = client 1; CALL5 stuffcmd
  // (PARM1/PARM3/PARM4 preset below — a QC compiler emits STOREs for those the same way.)
  const s0 = p.statements.length, fnSlot = p.functions.length, gBase = p.numGlobals;
  const gFtos = gBase, gStuff = gBase + 1, gEnt = gBase + 2;
  x.writeGlobalInt(gFtos, iFtos);
  x.writeGlobalInt(gStuff, iStuff);
  x.writeGlobalInt(gEnt, 1);                     // client edict number
  x.installStatement(s0 + 0, OP.CALL0 + 1, gFtos, 0, 0);
  x.installStatement(s0 + 1, OP.STORE_F, 1 /* RETURN */, PARM(2), 0);
  x.installStatement(s0 + 2, OP.STORE_F, gEnt, PARM(0), 0);
  x.installStatement(s0 + 3, OP.CALL0 + 5, gStuff, 0, 0);
  x.installStatement(s0 + 4, OP.DONE, 0, 0, 0);
  x.installFunction(fnSlot, s0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  x.setNumFunctions(fnSlot + 1);

  x.writeGlobalFloat(PARM(0), 0.5);        // ftos arg
  x.writeGlobalInt(PARM(1), fogOfs);
  x.writeGlobalInt(PARM(3), spaceOfs);
  x.writeGlobalInt(PARM(4), ringOfs);
  x.execute(fnSlot);

  chk.intEq(x.wasTrapped() ? 1 : 0, 0, 'no VM trap');
  chk.intEq(stuffed.length, 1, 'stuffcmd fired once');
  const got = stuffed[0] || {};
  chk.intEq(got.ent | 0, 1, 'client entnum');
  chk.intEq(got.argc | 0, 5, 'argc reaches the bridge');
  // The deliverable: a fog command carrying four numeric parameters, not a bare `fog`.
  const want = '\nfog 0.5 ' + RING;
  chk.intEq(got.varargs === want ? 1 : 0, 1, `joined command ${JSON.stringify(got.varargs)} == ${JSON.stringify(want)}`);
  chk.intEq((got.varargs || '').trim().split(/\s+/).length, 5, 'command + 4 parameters');
  // Negative control: the single-string bridge sent the format fragment alone.
  chk.intEq(got.firstArgOnly === '\nfog ' ? 1 : 0, 1, `single-arg read ${JSON.stringify(got.firstArgOnly)} == "\\nfog "`);

  // Backward compatibility: a 2-arg stuffcmd is still exactly its one argument.
  stuffed.length = 0;
  x.installStatement(s0 + 0, OP.STORE_F, gEnt, PARM(0), 0);
  x.installStatement(s0 + 1, OP.CALL0 + 2, gStuff, 0, 0);
  x.installStatement(s0 + 2, OP.DONE, 0, 0, 0);
  x.writeGlobalInt(PARM(1), fogOfs);
  x.execute(fnSlot);
  chk.intEq(stuffed.length, 1, 'single-arg stuffcmd fired');
  chk.intEq((stuffed[0] || {}).varargs === '\nfog ' ? 1 : 0, 1, 'single-arg stuffcmd unchanged');

  results.push(chk.report());
}

if (ran === 0) console.log('[SKIP] stuffcmd varargs: no mg1/mg3 pak0.pak in the repo root');
process.exit(results.every(Boolean) ? 0 : 1);
