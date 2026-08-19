// Background savegame edict serializer (Ironwail Host_BackgroundSave / SaveData_Fill design):
// the main thread snapshots each edict's field buffer and the pr string heap into transferable
// typed arrays, and this module turns the snapshot into savegame text off the main thread.
// No imports from other engine modules -- must be safe to bundle standalone as a worker and
// to import from host.ts for the synchronous (no-worker) fallback.

export type SaveEdictsJob = {
  seq: number;
  numEdicts: number;
  entityFields: number;
  edicts: ArrayBuffer;      // numEdicts * entityFields int32s, snapshot of each edict's v buffer
  free: Uint8Array;         // 1 = free edict
  strings: Uint16Array;     // snapshot of the pr string heap (char codes, 0-terminated strings)
  fielddefs: { name: string; type: number; ofs: number }[]; // ALL fielddefs from index 0, names pre-resolved
  functionNames: string[];  // function index -> name, pre-resolved
};

// pr.ETYPE, duplicated locally (this file must not import pr.ts).
const EV_VOID = 0;
const EV_STRING = 1;
const EV_FLOAT = 2;
const EV_VECTOR = 3;
const EV_ENTITY = 4;
const EV_FIELD = 5;
const EV_FUNCTION = 6;

// pr.getString, reading from the snapshotted string heap instead of pr.state.strings.
const getString = function (strings: Uint16Array, num: number)
{
  var string = [], c;
  for (; num < strings.length; ++num)
  {
    if (strings[num] === 0)
      break;
    string[string.length] = String.fromCharCode(strings[num]);
  }
  return string.join('');
};

// ed.fieldAtOfs, scanning the pre-resolved fielddefs snapshot instead of pr.state.fielddefs.
const fieldNameAtOfs = function (fielddefs: SaveEdictsJob['fielddefs'], ofs: number)
{
  var i;
  for (i = 0; i < fielddefs.length; ++i)
  {
    if (fielddefs[i].ofs === ofs)
      return fielddefs[i].name;
  }
  return '';
};

// pr.uglyValueString, operating on the snapshot views/arrays instead of live engine state.
const uglyValueString = function (job: SaveEdictsJob, val_int: Int32Array, val_float: Float32Array, type: number, ofs: number)
{
  switch (type)
  {
    case EV_STRING:
      return getString(job.strings, val_int[ofs]);
    case EV_ENTITY:
      return val_int[ofs].toString();
    case EV_FUNCTION:
      // Original code does getString(state.functions[idx].name), which throws on a bad
      // index; falling back to '' here is a hardening, not a vanilla-matched behavior.
      return job.functionNames[val_int[ofs]] ?? '';
    case EV_FIELD:
      var name = fieldNameAtOfs(job.fielddefs, val_int[ofs]);
      return name;
    case EV_VOID:
      return 'void';
    case EV_FLOAT:
      return val_float[ofs].toFixed(6);
    case EV_VECTOR:
      return val_float[ofs].toFixed(6) +
        ' ' + val_float[ofs + 1].toFixed(6) +
        ' ' + val_float[ofs + 2].toFixed(6);
  }
  return 'bad type ' + type;
};

// The slow part of savegame_f (host.ts), moved off the main thread. Mirrors the deleted
// inline loop byte-for-byte: same skip rules, same toFixed(6), same quoting/newlines.
export const serializeEdicts = function (job: SaveEdictsJob): string
{
  var val_int = new Int32Array(job.edicts);
  var val_float = new Float32Array(job.edicts);
  var entityFields = job.entityFields;
  var fielddefs = job.fielddefs;

  var parts: string[] = [];
  var i, j, def, name, type, base;
  for (i = 0; i < job.numEdicts; ++i)
  {
    if (job.free[i] === 1)
    {
      parts[parts.length] = '{\n}\n';
      continue;
    }
    parts[parts.length] = '{\n';
    for (j = 1; j < fielddefs.length; ++j)
    {
      def = fielddefs[j];
      name = def.name;
      if (name.charCodeAt(name.length - 2) === 95)
        continue;
      type = def.type & 0x7fff;
      base = i * entityFields + def.ofs;
      if (val_int[base] === 0)
      {
        if (type === EV_VECTOR)
        {
          if ((val_int[base + 1] === 0) && (val_int[base + 2] === 0))
            continue;
        }
        else
          continue;
      }
      parts[parts.length] = '"' + name + '" "' + uglyValueString(job, val_int, val_float, type, base) + '"\n';
    }
    parts[parts.length] = '}\n';
  }
  return parts.join('');
};

// Worker glue: only runs inside an actual worker. Importing this file on the main thread
// (or under Node for the dedicated-server tsc build) must stay side-effect-free.
declare const importScripts: unknown;
if (typeof self !== 'undefined' && typeof importScripts === 'function')
{
  (self as any).onmessage = function (e: MessageEvent<SaveEdictsJob>)
  {
    (self as any).postMessage({ seq: e.data.seq, data: serializeEdicts(e.data) });
  };
}
