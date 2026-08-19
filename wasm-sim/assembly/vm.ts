// Full QC bytecode interpreter (src/engine/pr.ts executeProgram + enterFunction/
// leaveFunction). Also compiled standalone for its parity test.
//
// Memory model: GLOBALS (from abi.ts) + private memory.data regions for
// STATEMENTS ({op,a,b,c} i32 quads), FUNCTIONS (flat records), LOCALSTACK
// (pr.ts localstack_size) and the parallel call-stack arrays.

import { gf, gi, setf, seti, GLOBALS } from "./abi";
// Compile-time bindings (direct calls, no JS round-trip), aliased to the
// original stub names so the opcode call sites are unchanged.
import { edLoadInt as edictLoadInt, edStoreInt as edictStoreInt } from "./ed";
import { stringsEqual, stringIsEmpty } from "./strings";
// host.ts owns the builtin dispatch; it does not import vm.ts (no cycle).
import { callBuiltin } from "./host";

// ============================================================================
// HOST IMPORTS (the ABI surface this module still needs from the embedder)
// ============================================================================

// OP.address: guards "assignment to world entity" unless the server is loading.
declare function isServerLoading(): bool;

// Fatal VM errors (pr.ts runError). This module aborts the current execute()
// after invoking it; the exact partial state a JS exception would unwind through
// is not replicated (these paths aren't exercised by valid QC).
declare function hostError(code: i32): void;

export const ERR_NULL_FUNCTION: i32 = 1;
export const ERR_RUNAWAY_LOOP: i32 = 2;
export const ERR_BAD_OPCODE: i32 = 3;
export const ERR_LOCALS_OVERFLOW: i32 = 4;
export const ERR_LOCALS_UNDERFLOW: i32 = 5;
export const ERR_STACK_UNDERFLOW: i32 = 6;
export const ERR_WORLD_ASSIGN: i32 = 7;
export const ERR_NULL_CALL: i32 = 8;
export const ERR_STACK_OVERFLOW: i32 = 9;

function fail(code: i32): void {
  hostError(code);
  trapped = true;
}

// ============================================================================
// Opcodes (pr.ts OP table — numeric values must match progs.dat exactly)
// ============================================================================

const OP_DONE: i32 = 0;
const OP_MUL_F: i32 = 1, OP_MUL_V: i32 = 2, OP_MUL_FV: i32 = 3, OP_MUL_VF: i32 = 4;
const OP_DIV_F: i32 = 5;
const OP_ADD_F: i32 = 6, OP_ADD_V: i32 = 7;
const OP_SUB_F: i32 = 8, OP_SUB_V: i32 = 9;
const OP_EQ_F: i32 = 10, OP_EQ_V: i32 = 11, OP_EQ_S: i32 = 12, OP_EQ_E: i32 = 13, OP_EQ_FNC: i32 = 14;
const OP_NE_F: i32 = 15, OP_NE_V: i32 = 16, OP_NE_S: i32 = 17, OP_NE_E: i32 = 18, OP_NE_FNC: i32 = 19;
const OP_LE: i32 = 20, OP_GE: i32 = 21, OP_LT: i32 = 22, OP_GT: i32 = 23;
const OP_LOAD_F: i32 = 24, OP_LOAD_V: i32 = 25, OP_LOAD_S: i32 = 26, OP_LOAD_ENT: i32 = 27, OP_LOAD_FLD: i32 = 28, OP_LOAD_FNC: i32 = 29;
const OP_ADDRESS: i32 = 30;
const OP_STORE_F: i32 = 31, OP_STORE_V: i32 = 32, OP_STORE_S: i32 = 33, OP_STORE_ENT: i32 = 34, OP_STORE_FLD: i32 = 35, OP_STORE_FNC: i32 = 36;
const OP_STOREP_F: i32 = 37, OP_STOREP_V: i32 = 38, OP_STOREP_S: i32 = 39, OP_STOREP_ENT: i32 = 40, OP_STOREP_FLD: i32 = 41, OP_STOREP_FNC: i32 = 42;
const OP_RET: i32 = 43;
const OP_NOT_F: i32 = 44, OP_NOT_V: i32 = 45, OP_NOT_S: i32 = 46, OP_NOT_ENT: i32 = 47, OP_NOT_FNC: i32 = 48;
const OP_JNZ: i32 = 49, OP_JZ: i32 = 50; // "IF" / "IFNOT"
const OP_CALL0: i32 = 51; // CALL0..CALL8 = 51..59
const OP_CALL8: i32 = 59;
const OP_STATE: i32 = 60;
const OP_JUMP: i32 = 61;
const OP_AND: i32 = 62, OP_OR: i32 = 63;
const OP_BITAND: i32 = 64, OP_BITOR: i32 = 65;

// Fixed global indices (pr.ts globalvars — standard Quake globals layout).
const GLOBAL_SELF: i32 = 28;
const GLOBAL_TIME: i32 = 31;

// Fixed field indices (pr.ts entvars — standard entvars_t layout), used by OP.state.
const FIELD_FRAME: i32 = 30;
const FIELD_THINK: i32 = 44;
const FIELD_NEXTTHINK: i32 = 46;

// ============================================================================
// Static memory regions (private to this module)
// ============================================================================

const STMT_SIZE: usize = 16;            // op,a,b,c : i32 x4
const MAX_STATEMENTS: i32 = 1 << 18;    // 262144 statements (4MB) -- AD progs_dump scale (id1 ~2600)
const STATEMENTS: usize = memory.data(MAX_STATEMENTS * <i32>STMT_SIZE);

const FUNC_RECORD_SIZE: usize = 24;     // first_statement,parm_start,locals,numparms : i32 x4 (16) + parm_size[8] : u8 x8
const MAX_FUNCTIONS: i32 = 1 << 14;     // 16384 functions -- AD progs_dump scale
const FUNCTIONS: usize = memory.data(MAX_FUNCTIONS * <i32>FUNC_RECORD_SIZE);

const LOCALSTACK_SIZE: i32 = 2048;      // pr.ts localstack_size
const LOCALSTACK: usize = memory.data(LOCALSTACK_SIZE << 2);

// pr.ts grows its call stack unboundedly; fixed linear memory can't, so MAX_DEPTH
// is a backstop far above real QC depth (vanilla C used 32). enterFunction fails
// ERR_STACK_OVERFLOW instead of silently corrupting adjacent static memory.
const MAX_DEPTH: i32 = 1024;
const STACK_STMT: usize = memory.data(MAX_DEPTH << 2);
const STACK_FUNC: usize = memory.data(MAX_DEPTH << 2);

// ============================================================================
// Record accessors
// ============================================================================

@inline function stmtBase(s: i32): usize { return STATEMENTS + (<usize>s * STMT_SIZE); }
@inline function stmtOp(s: i32): i32 { return load<i32>(stmtBase(s)); }
@inline function stmtA(s: i32): i32 { return load<i32>(stmtBase(s) + 4); }
@inline function stmtB(s: i32): i32 { return load<i32>(stmtBase(s) + 8); }
@inline function stmtC(s: i32): i32 { return load<i32>(stmtBase(s) + 12); }

@inline function funcBase(idx: i32): usize { return FUNCTIONS + (<usize>idx * FUNC_RECORD_SIZE); }
@inline function fnFirstStatement(idx: i32): i32 { return load<i32>(funcBase(idx)); }
@inline function fnParmStart(idx: i32): i32 { return load<i32>(funcBase(idx) + 4); }
@inline function fnLocals(idx: i32): i32 { return load<i32>(funcBase(idx) + 8); }
@inline function fnNumParms(idx: i32): i32 { return load<i32>(funcBase(idx) + 12); }
@inline function fnParmSize(idx: i32, p: i32): i32 { return <i32>load<u8>(funcBase(idx) + 16 + <usize>p); }

// ============================================================================
// JS-callable setup (harness loads a program with these)
// ============================================================================

export function installStatement(idx: i32, op: i32, a: i32, b: i32, c: i32): void {
  const p = stmtBase(idx);
  store<i32>(p, op);
  store<i32>(p + 4, a);
  store<i32>(p + 8, b);
  store<i32>(p + 12, c);
}

export function installFunction(
  idx: i32, first_statement: i32, parm_start: i32, locals: i32, numparms: i32,
  ps0: i32, ps1: i32, ps2: i32, ps3: i32, ps4: i32, ps5: i32, ps6: i32, ps7: i32
): void {
  const b = funcBase(idx);
  store<i32>(b, first_statement);
  store<i32>(b + 4, parm_start);
  store<i32>(b + 8, locals);
  store<i32>(b + 12, numparms);
  store<u8>(b + 16, ps0); store<u8>(b + 17, ps1); store<u8>(b + 18, ps2); store<u8>(b + 19, ps3);
  store<u8>(b + 20, ps4); store<u8>(b + 21, ps5); store<u8>(b + 22, ps6); store<u8>(b + 23, ps7);
}

export function setNumFunctions(n: i32): void { numFunctions = n; }
export function setEdictSize(bytes: i32): void { edictSize = bytes; }

export function writeGlobalInt(idx: i32, v: i32): void { seti(GLOBALS, idx, v); }
export function readGlobalInt(idx: i32): i32 { return gi(GLOBALS, idx); }
export function writeGlobalFloat(idx: i32, v: f32): void { setf(GLOBALS, idx, <f64>v); }
export function readGlobalFloat(idx: i32): f32 { return <f32>gf(GLOBALS, idx); }

export function globalsPtr(): usize { return GLOBALS; }
export function statementsPtr(): usize { return STATEMENTS; }
export function functionsPtr(): usize { return FUNCTIONS; }

export function getDepth(): i32 { return depth; }
export function getArgc(): i32 { return argc; }
export function getXStatement(): i32 { return xstatementVar; }
export function getLocalstackUsed(): i32 { return localstackUsed; }
export function wasTrapped(): bool { return trapped; }

export function resetVm(): void {
  depth = 0;
  xfunction = -1;
  localstackUsed = 0;
  argc = 0;
  xstatementVar = 0;
  trapped = false;
}

// ============================================================================
// VM machine state (pr.ts PrState "Machine" section)
// ============================================================================

let numFunctions: i32 = 0;
let edictSize: i32 = 0;

let depth: i32 = 0;
let xfunction: i32 = -1;
let xstatementVar: i32 = 0;
let localstackUsed: i32 = 0;
let argc: i32 = 0;
let trapped: bool = false;

// pr.ts enterFunction
function enterFunction(fIdx: i32): i32 {
  if (depth >= MAX_DEPTH) {                 // vanilla PR_EnterFunction stack-overflow guard
    fail(ERR_STACK_OVERFLOW);
    return fnFirstStatement(fIdx) - 1;
  }
  store<i32>(STACK_STMT + (<usize>depth << 2), xstatementVar);
  store<i32>(STACK_FUNC + (<usize>depth << 2), xfunction);
  depth++;

  const locals = fnLocals(fIdx);
  if ((localstackUsed + locals) > LOCALSTACK_SIZE) {
    fail(ERR_LOCALS_OVERFLOW);
    return fnFirstStatement(fIdx) - 1;
  }
  const parmStart = fnParmStart(fIdx);
  for (let i: i32 = 0; i < locals; i++) {
    store<i32>(LOCALSTACK + (<usize>(localstackUsed + i) << 2), gi(GLOBALS, parmStart + i));
  }
  localstackUsed += locals;

  let o = parmStart;
  const numparms = fnNumParms(fIdx);
  for (let i: i32 = 0; i < numparms; i++) {
    const psize = fnParmSize(fIdx, i);
    for (let j: i32 = 0; j < psize; j++) {
      seti(GLOBALS, o, gi(GLOBALS, 4 + i * 3 + j));
      o++;
    }
  }
  xfunction = fIdx;
  return fnFirstStatement(fIdx) - 1;
}

// pr.ts leaveFunction
function leaveFunction(): i32 {
  if (depth <= 0) {
    fail(ERR_STACK_UNDERFLOW);
    return 0;
  }
  let c = fnLocals(xfunction);
  localstackUsed -= c;
  if (localstackUsed < 0) {
    fail(ERR_LOCALS_UNDERFLOW);
  }
  const parmStart = fnParmStart(xfunction);
  for (--c; c >= 0; c--) {
    seti(GLOBALS, parmStart + c, load<i32>(LOCALSTACK + (<usize>(localstackUsed + c) << 2)));
  }
  depth--;
  xfunction = load<i32>(STACK_FUNC + (<usize>depth << 2));
  return load<i32>(STACK_STMT + (<usize>depth << 2));
}

// ============================================================================
// The interpreter loop (pr.ts executeProgram)
// ============================================================================

export function execute(fnum: i32): void {
  if ((fnum === 0) || (fnum >= numFunctions)) {
    fail(ERR_NULL_FUNCTION);
    return;
  }
  let runaway: i32 = 0x1000000;
  const exitdepth = depth;
  let s: i32 = enterFunction(fnum);
  if (trapped) return;

  while (true) {
    s++;
    const op = stmtOp(s);
    const a = stmtA(s);
    const b = stmtB(s);
    const c = stmtC(s);

    runaway--;
    if (runaway === 0) { fail(ERR_RUNAWAY_LOOP); return; }
    xstatementVar = s;

    switch (op) {
      case OP_ADD_F:
        setf(GLOBALS, c, gf(GLOBALS, a) + gf(GLOBALS, b));
        break;
      case OP_ADD_V:
        setf(GLOBALS, c, gf(GLOBALS, a) + gf(GLOBALS, b));
        setf(GLOBALS, c + 1, gf(GLOBALS, a + 1) + gf(GLOBALS, b + 1));
        setf(GLOBALS, c + 2, gf(GLOBALS, a + 2) + gf(GLOBALS, b + 2));
        break;
      case OP_SUB_F:
        setf(GLOBALS, c, gf(GLOBALS, a) - gf(GLOBALS, b));
        break;
      case OP_SUB_V:
        setf(GLOBALS, c, gf(GLOBALS, a) - gf(GLOBALS, b));
        setf(GLOBALS, c + 1, gf(GLOBALS, a + 1) - gf(GLOBALS, b + 1));
        setf(GLOBALS, c + 2, gf(GLOBALS, a + 2) - gf(GLOBALS, b + 2));
        break;
      case OP_MUL_F:
        setf(GLOBALS, c, gf(GLOBALS, a) * gf(GLOBALS, b));
        break;
      case OP_MUL_V:
        setf(GLOBALS, c,
          gf(GLOBALS, a) * gf(GLOBALS, b) +
          gf(GLOBALS, a + 1) * gf(GLOBALS, b + 1) +
          gf(GLOBALS, a + 2) * gf(GLOBALS, b + 2));
        break;
      case OP_MUL_FV:
        setf(GLOBALS, c, gf(GLOBALS, a) * gf(GLOBALS, b));
        setf(GLOBALS, c + 1, gf(GLOBALS, a) * gf(GLOBALS, b + 1));
        setf(GLOBALS, c + 2, gf(GLOBALS, a) * gf(GLOBALS, b + 2));
        break;
      case OP_MUL_VF:
        setf(GLOBALS, c, gf(GLOBALS, b) * gf(GLOBALS, a));
        setf(GLOBALS, c + 1, gf(GLOBALS, b) * gf(GLOBALS, a + 1));
        setf(GLOBALS, c + 2, gf(GLOBALS, b) * gf(GLOBALS, a + 2));
        break;
      case OP_DIV_F:
        setf(GLOBALS, c, gf(GLOBALS, a) / gf(GLOBALS, b));
        break;
      case OP_BITAND:
        setf(GLOBALS, c, <f64>(<i32>gf(GLOBALS, a) & <i32>gf(GLOBALS, b)));
        break;
      case OP_BITOR:
        setf(GLOBALS, c, <f64>(<i32>gf(GLOBALS, a) | <i32>gf(GLOBALS, b)));
        break;
      case OP_GE:
        setf(GLOBALS, c, gf(GLOBALS, a) >= gf(GLOBALS, b) ? 1.0 : 0.0);
        break;
      case OP_LE:
        setf(GLOBALS, c, gf(GLOBALS, a) <= gf(GLOBALS, b) ? 1.0 : 0.0);
        break;
      case OP_GT:
        setf(GLOBALS, c, gf(GLOBALS, a) > gf(GLOBALS, b) ? 1.0 : 0.0);
        break;
      case OP_LT:
        setf(GLOBALS, c, gf(GLOBALS, a) < gf(GLOBALS, b) ? 1.0 : 0.0);
        break;
      case OP_AND:
        setf(GLOBALS, c, (gf(GLOBALS, a) != 0.0 && gf(GLOBALS, b) != 0.0) ? 1.0 : 0.0);
        break;
      case OP_OR:
        setf(GLOBALS, c, (gf(GLOBALS, a) != 0.0 || gf(GLOBALS, b) != 0.0) ? 1.0 : 0.0);
        break;
      case OP_NOT_F:
        setf(GLOBALS, c, gf(GLOBALS, a) == 0.0 ? 1.0 : 0.0);
        break;
      case OP_NOT_V:
        setf(GLOBALS, c, (gf(GLOBALS, a) == 0.0 && gf(GLOBALS, a + 1) == 0.0 && gf(GLOBALS, a + 2) == 0.0) ? 1.0 : 0.0);
        break;
      case OP_NOT_S: {
        const strPtr = gi(GLOBALS, a);
        setf(GLOBALS, c, strPtr !== 0 ? (stringIsEmpty(strPtr) ? 1.0 : 0.0) : 1.0);
        break;
      }
      case OP_NOT_FNC:
      case OP_NOT_ENT:
        setf(GLOBALS, c, gi(GLOBALS, a) === 0 ? 1.0 : 0.0);
        break;
      case OP_EQ_F:
        setf(GLOBALS, c, gf(GLOBALS, a) == gf(GLOBALS, b) ? 1.0 : 0.0);
        break;
      case OP_EQ_V:
        setf(GLOBALS, c, (gf(GLOBALS, a) == gf(GLOBALS, b)
          && gf(GLOBALS, a + 1) == gf(GLOBALS, b + 1)
          && gf(GLOBALS, a + 2) == gf(GLOBALS, b + 2)) ? 1.0 : 0.0);
        break;
      case OP_EQ_S:
        setf(GLOBALS, c, stringsEqual(gi(GLOBALS, a), gi(GLOBALS, b)) ? 1.0 : 0.0);
        break;
      case OP_EQ_E:
      case OP_EQ_FNC:
        setf(GLOBALS, c, gi(GLOBALS, a) === gi(GLOBALS, b) ? 1.0 : 0.0);
        break;
      case OP_NE_F:
        setf(GLOBALS, c, gf(GLOBALS, a) != gf(GLOBALS, b) ? 1.0 : 0.0);
        break;
      case OP_NE_V:
        setf(GLOBALS, c, (gf(GLOBALS, a) != gf(GLOBALS, b)
          || gf(GLOBALS, a + 1) != gf(GLOBALS, b + 1)
          || gf(GLOBALS, a + 2) != gf(GLOBALS, b + 2)) ? 1.0 : 0.0);
        break;
      case OP_NE_S:
        setf(GLOBALS, c, stringsEqual(gi(GLOBALS, a), gi(GLOBALS, b)) ? 0.0 : 1.0);
        break;
      case OP_NE_E:
      case OP_NE_FNC:
        setf(GLOBALS, c, gi(GLOBALS, a) !== gi(GLOBALS, b) ? 1.0 : 0.0);
        break;

      case OP_STORE_F:
      case OP_STORE_ENT:
      case OP_STORE_FLD:
      case OP_STORE_S:
      case OP_STORE_FNC:
        seti(GLOBALS, b, gi(GLOBALS, a));
        break;
      case OP_STORE_V:
        seti(GLOBALS, b, gi(GLOBALS, a));
        seti(GLOBALS, b + 1, gi(GLOBALS, a + 1));
        seti(GLOBALS, b + 2, gi(GLOBALS, a + 2));
        break;

      case OP_STOREP_F:
      case OP_STOREP_ENT:
      case OP_STOREP_FLD:
      case OP_STOREP_S:
      case OP_STOREP_FNC: {
        const ptr = gi(GLOBALS, b);
        const entNum = ptr / edictSize;
        const fieldIdx = (ptr % edictSize - 96) >> 2;
        edictStoreInt(entNum, fieldIdx, gi(GLOBALS, a));
        break;
      }
      case OP_STOREP_V: {
        const ptr = gi(GLOBALS, b);
        const entNum = ptr / edictSize;
        const fieldIdx = (ptr % edictSize - 96) >> 2;
        edictStoreInt(entNum, fieldIdx, gi(GLOBALS, a));
        edictStoreInt(entNum, fieldIdx + 1, gi(GLOBALS, a + 1));
        edictStoreInt(entNum, fieldIdx + 2, gi(GLOBALS, a + 2));
        break;
      }

      case OP_ADDRESS: {
        const entNum = gi(GLOBALS, a);
        if (entNum === 0 && !isServerLoading()) {
          fail(ERR_WORLD_ASSIGN);
          return;
        }
        seti(GLOBALS, c, entNum * edictSize + 96 + (gi(GLOBALS, b) << 2));
        break;
      }

      case OP_LOAD_F:
      case OP_LOAD_FLD:
      case OP_LOAD_ENT:
      case OP_LOAD_S:
      case OP_LOAD_FNC:
        seti(GLOBALS, c, edictLoadInt(gi(GLOBALS, a), gi(GLOBALS, b)));
        break;
      case OP_LOAD_V: {
        const entNum = gi(GLOBALS, a);
        const fieldIdx = gi(GLOBALS, b);
        seti(GLOBALS, c, edictLoadInt(entNum, fieldIdx));
        seti(GLOBALS, c + 1, edictLoadInt(entNum, fieldIdx + 1));
        seti(GLOBALS, c + 2, edictLoadInt(entNum, fieldIdx + 2));
        break;
      }

      case OP_JZ:
        if (gi(GLOBALS, a) === 0) s += ((b << 16) >> 16) - 1;
        break;
      case OP_JNZ:
        if (gi(GLOBALS, a) !== 0) s += ((b << 16) >> 16) - 1;
        break;
      case OP_JUMP:
        s += ((a << 16) >> 16) - 1;
        break;

      case OP_STATE: {
        const self = gi(GLOBALS, GLOBAL_SELF);
        const nextthink = gf(GLOBALS, GLOBAL_TIME) + 0.1;
        edictStoreInt(self, FIELD_NEXTTHINK, reinterpret<i32>(<f32>nextthink));
        edictStoreInt(self, FIELD_FRAME, gi(GLOBALS, a));
        edictStoreInt(self, FIELD_THINK, gi(GLOBALS, b));
        break;
      }

      case OP_DONE:
      case OP_RET:
        seti(GLOBALS, 1, gi(GLOBALS, a));
        seti(GLOBALS, 2, gi(GLOBALS, a + 1));
        seti(GLOBALS, 3, gi(GLOBALS, a + 2));
        s = leaveFunction();
        if (trapped) return;
        if (depth === exitdepth) return;
        break;

      default:
        if (op >= OP_CALL0 && op <= OP_CALL8) {
          argc = op - OP_CALL0;
          const fIdx = gi(GLOBALS, a);
          if (fIdx === 0) { fail(ERR_NULL_CALL); return; }
          const firstStmt = fnFirstStatement(fIdx);
          if (firstStmt < 0) {
            callBuiltin(-firstStmt);
          } else {
            s = enterFunction(fIdx);
            if (trapped) return;
          }
          break;
        }
        fail(ERR_BAD_OPCODE);
        return;
    }
  }
}
