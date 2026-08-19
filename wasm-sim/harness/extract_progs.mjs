import { readFileSync, writeFileSync } from 'fs';
const pak = readFileSync('id1/pak0.pak');
const dirofs = pak.readInt32LE(4), dirlen = pak.readInt32LE(8);
let progs = null;
for (let i = 0; i < dirlen; i += 64) {
  const p = dirofs + i;
  const name = pak.toString('ascii', p, p + 56).replace(/\0.*$/, '');
  if (name.toLowerCase() === 'progs.dat') progs = { filepos: pak.readInt32LE(p + 56), filelen: pak.readInt32LE(p + 60) };
}
if (!progs) { console.log('no progs.dat'); process.exit(1); }
const buf = pak.subarray(progs.filepos, progs.filepos + progs.filelen);
writeFileSync('wasm-sim/build/id1_progs.dat', buf);
const version = buf.readInt32LE(0), crc = buf.readInt32LE(4);
const L = (i) => ({ ofs: buf.readInt32LE(8 + i*8), num: buf.readInt32LE(12 + i*8) });
const [st, gd, fd, fn, str, gl] = [0,1,2,3,4,5].map(L);
const entityfields = buf.readInt32LE(8 + 6*8);
console.log(`progs len=${progs.filelen} version=${version} crc=${crc}`);
console.log(`statements=${st.num} globaldefs=${gd.num} fielddefs=${fd.num} functions=${fn.num} stringsLen=${str.num} globals=${gl.num} entityfields=${entityfields}`);
console.log('wrote wasm-sim/build/id1_progs.dat');
