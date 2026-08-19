import * as con from './console'
import * as q from './q'

// BSPX ("BSP eXtension") is an id1-adjacent convention (ericw-tools/QSS) for
// tacking extra lumps onto a .bsp without touching the standard 15-lump
// directory. Layout, immediately after the last standard lump, 4-byte
// aligned:
//   header: char id[4] = 'BSPX'; uint32 numlumps
//   numlumps * { char name[24]; uint32 fileofs; uint32 filelen }
// Ref: QSS gl_model.c Q1BSPX_Setup/Q1BSPX_FindLump (Ironwail carries no BSPX
// support at all, so QSS is the only local precedent).

const HEADER_SIZE = 8   // id[4] + numlumps[4]
const LUMP_SIZE = 32    // name[24] + fileofs[4] + filelen[4]
const NAME_SIZE = 24

export type BspxDirectory = { [name: string]: { fileofs: number, filelen: number } }

// lastLumpEnd: end (fileofs + filelen) of the highest standard BSP lump,
// unaligned - caller derives this from the shared v29/BSP2 15-lump
// directory. Returns null when no BSPX header is present or it fails
// validation; never throws (garbage trailing a classic map is normal).
export const parse = (buffer: ArrayBuffer, lastLumpEnd: number): BspxDirectory | null =>
{
  var offs = (lastLumpEnd + 3) & ~3;
  if (offs + HEADER_SIZE > buffer.byteLength)
    return null; // no room for a header - ordinary map

  if (q.memstr(new Uint8Array(buffer, offs, 4)) !== 'BSPX')
    return null;

  var view = new DataView(buffer);
  var numlumps = view.getInt32(offs + 4, true);
  var lumpBase = offs + HEADER_SIZE;
  if (numlumps < 0 || lumpBase + LUMP_SIZE * numlumps > buffer.byteLength)
    return null; // bad count - matches QSS Q1BSPX_Setup silently bailing

  var dir: BspxDirectory = {};
  for (var i = 0; i < numlumps; i++)
  {
    var entryOfs = lumpBase + i * LUMP_SIZE;
    var name = q.memstr(new Uint8Array(buffer, entryOfs, NAME_SIZE));
    var fileofs = view.getUint32(entryOfs + NAME_SIZE, true);
    var filelen = view.getUint32(entryOfs + NAME_SIZE + 4, true);
    if (fileofs + filelen > buffer.byteLength)
      return null; // one bad lump voids the whole directory (matches QSS)
    if (fileofs & 3)
      con.dPrint(`bspx: lump ${name} misaligned\n`);
    dir[name] = { fileofs, filelen };
  }
  return dir;
};

// Zero-copy view onto a lump's bytes, or null if absent (either no BSPX
// directory at all, or this name wasn't in it - both are normal).
export const findLump = (dir: BspxDirectory | null, buffer: ArrayBuffer, name: string): Uint8Array | null =>
{
  if (dir === null || !(name in dir))
    return null;
  var lump = dir[name];
  return new Uint8Array(buffer, lump.fileofs, lump.filelen);
};
