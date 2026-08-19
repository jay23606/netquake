// Candidate-stream parity for MOVETYPE_PUSH: sv.ts's area-tree gatherPushCandidates
// must produce EXACTLY the sequence QSS-M's SV_PushMove visits.
//
// QSS-M sv_phys.c:783 `for (e=1 ; e<qcvm->num_edicts ; e++, check = NEXT_EDICT(check))`
// (and the rotating variant at sv_phys.c:568) is ONE ascending pass over the edict
// array: every edict is visited AT MOST ONCE, in edict-number order. Order is
// load-bearing — SV_PushEntity runs touch/impact QC, the first blocked entity fires
// blocked() and aborts the whole push, and crushing a corpse changes the test for
// later edicts. The wasm sim (assembly/svpusher.ts) keeps that literal full scan;
// sv.ts replaces it with an area-tree query for speed, so the query's output stream
// is what has to be proven equivalent.
//
// REGRESSION: sv.ts gathered from two sources — the area chains AND a link-time
// registry of SOLID_NOT pushables — and stamped its pushStamp dedup only AFTER
// pulling from both. QC that demotes an entity to SOLID_NOT by assigning .solid
// alone never relinks it (only setorigin/setsize/setmodel do), so such an edict sits
// in an area chain AND in the registry: it entered the candidate list TWICE, giving
// two moved[] slots and two pushEntity calls (double displacement, double touch QC)
// in a single pushMove. Vanilla/QSS-M can never do that.
//
// Pure JS (no wasm): the gather has no wasm counterpart to compare against — the
// reference is QSS-M's scan itself, transliterated below as jsFullScanCandidates.
import { strict as assert } from 'assert';

// --- entvars field indices (src/engine/pr.ts entvars, vanilla layout) ---------
const F = { ABSMIN: 1, ABSMAX: 4, MOVETYPE: 8, SOLID: 9,
  ORIGIN: 10, VELOCITY: 16, MINS: 33, MAXS: 36, GROUNDENTITY: 47, FLAGS: 76 };
const SOLID_NOT = 0, SOLID_TRIGGER = 1, SOLID_BSP = 4;
const MT = { none: 0, walk: 3, step: 4, toss: 6, push: 7, noclip: 8 };
const FL_ONGROUND = 512;

// --- edict model ------------------------------------------------------------
const MAX_EDICTS = 32;
const mk = () => ({ num: 0, free: false, v: new Float32Array(100), gnd: 0,
  pushStamp: 0, solidNotListed: false, area: null });
const edicts = [];
for (let i = 0; i < MAX_EDICTS; i++) { const e = mk(); e.num = i; edicts.push(e); }
let num_edicts = MAX_EDICTS;

const setBox = (e, ox, oy, oz, hx, hy, hz, solid, movetype) => {
  e.v[F.ORIGIN] = ox; e.v[F.ORIGIN + 1] = oy; e.v[F.ORIGIN + 2] = oz;
  e.v[F.MINS] = -hx; e.v[F.MINS + 1] = -hy; e.v[F.MINS + 2] = -hz;
  e.v[F.MAXS] = hx; e.v[F.MAXS + 1] = hy; e.v[F.MAXS + 2] = hz;
  e.v[F.SOLID] = solid; e.v[F.MOVETYPE] = movetype;
};

// --- src/engine/sv.ts areanode tree + linkEdict, transliterated --------------
const makeLink = () => { const l = { prev: null, next: null, ent: null }; l.prev = l.next = l; return l; };
const areanodes = [];
const createAreaNode = (depth, mins, maxs) => {
  const anode = { trigger_edicts: makeLink(), solid_edicts: makeLink(), axis: -1, dist: 0, children: [] };
  areanodes.push(anode);
  if (depth === 4) return anode;
  anode.axis = (maxs[0] - mins[0]) > (maxs[1] - mins[1]) ? 0 : 1;
  anode.dist = 0.5 * (maxs[anode.axis] + mins[anode.axis]);
  const maxs1 = maxs.slice(), mins2 = mins.slice();
  maxs1[anode.axis] = mins2[anode.axis] = anode.dist;
  anode.children = [createAreaNode(depth + 1, mins2, maxs), createAreaNode(depth + 1, mins, maxs1)];
  return anode;
};
createAreaNode(0, [-2048, -2048, -2048], [2048, 2048, 2048]);

const solidNotPushables = [];
const unlinkEdict = (ent) => {
  const a = ent.area; if (a == null) return;
  a.prev.next = a.next; a.next.prev = a.prev; ent.area = null;
};
const linkEdict = (ent) => {
  if (ent.num === 0 || ent.free) return;
  unlinkEdict(ent);
  for (let i = 0; i < 3; i++) {
    ent.v[F.ABSMIN + i] = ent.v[F.ORIGIN + i] + ent.v[F.MINS + i] - 1.0;
    ent.v[F.ABSMAX + i] = ent.v[F.ORIGIN + i] + ent.v[F.MAXS + i] + 1.0;
  }
  if (ent.v[F.SOLID] === SOLID_NOT) {
    const mt = ent.v[F.MOVETYPE];
    if (!ent.solidNotListed && mt !== MT.none && mt !== MT.push && mt !== MT.noclip) {
      ent.solidNotListed = true; solidNotPushables.push(ent);
    }
    return;
  }
  let node = areanodes[0];
  for (;;) {
    if (node.axis === -1) break;
    if (ent.v[F.ABSMIN + node.axis] > node.dist) node = node.children[0];
    else if (ent.v[F.ABSMAX + node.axis] < node.dist) node = node.children[1];
    else break;
  }
  const before = (ent.v[F.SOLID] === SOLID_TRIGGER) ? node.trigger_edicts : node.solid_edicts;
  const a = { prev: before.prev, next: before, ent };
  before.prev.next = a; before.prev = a; ent.area = a;
};

// --- src/engine/sv.ts collectPushCandidates / gatherPushCandidates -----------
const overlapsQuery = (c, mins, maxs) => !(c.v[F.ABSMIN] >= maxs[0] || c.v[F.ABSMIN + 1] >= maxs[1] ||
  c.v[F.ABSMIN + 2] >= maxs[2] || c.v[F.ABSMAX] <= mins[0] || c.v[F.ABSMAX + 1] <= mins[1] ||
  c.v[F.ABSMAX + 2] <= mins[2]);
const collectPushCandidates = (node, mins, maxs, list) => {
  for (const head of [node.solid_edicts, node.trigger_edicts])
    for (let l = head.next; l !== head; l = l.next)
      if (overlapsQuery(l.ent, mins, maxs)) list.push(l.ent);
  if (node.axis === -1) return;
  if (maxs[node.axis] > node.dist) collectPushCandidates(node.children[0], mins, maxs, list);
  if (mins[node.axis] < node.dist) collectPushCandidates(node.children[1], mins, maxs, list);
};

let pushGatherSeq = 0;
// stampMode 'insert' = sv.ts as fixed; 'after' = the pre-fix code, kept ONLY as the
// negative control that proves this test would have caught the double-processing.
const gatherPushCandidates = (pusher, mins, maxs, move, stampMode) => {
  const list = [];
  const qmins = [0, 0, 0], qmaxs = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    qmins[i] = mins[i] - (move[i] > 0 ? move[i] : 0) - 1;
    qmaxs[i] = maxs[i] - (move[i] < 0 ? move[i] : 0) + 1;
  }
  const seq = ++pushGatherSeq;
  collectPushCandidates(areanodes[0], qmins, qmaxs, list);
  if (stampMode === 'insert') for (let i = 0; i < list.length; i++) list[i].pushStamp = seq;
  for (let i = 0; i < solidNotPushables.length; i++) {
    const nl = solidNotPushables[i];
    if (stampMode === 'insert' && nl.pushStamp === seq) continue;
    if (nl.free) continue;
    if (nl.v[F.SOLID] === SOLID_NOT) { nl.pushStamp = seq; list.push(nl); }
  }
  if (stampMode === 'after') for (let i = 0; i < list.length; i++) list[i].pushStamp = seq;
  for (let i = 1; i < num_edicts; i++) {
    const ed = edicts[i];
    if (ed.pushStamp === seq || ed.free) continue;
    if ((ed.v[F.FLAGS] & FL_ONGROUND) !== 0 && ed.gnd === pusher.num) { ed.pushStamp = seq; list.push(ed); }
  }
  list.sort((a, b) => a.num - b.num);
  return list;
};

// --- QSS-M SV_PushMove's own scan, transliterated (the reference) ------------
// sv_phys.c:783-815, minus SV_TestEntityPosition (a per-edict trace that can reject
// but never reorder or duplicate — this test is about set/order/multiplicity).
const pushGate = (check, pusher, mins, maxs) => {
  if (check.free) return false;
  const mt = check.v[F.MOVETYPE];
  if (mt === MT.push || mt === MT.none || mt === MT.noclip) return false;
  if ((check.v[F.FLAGS] & FL_ONGROUND) !== 0 && check.gnd === pusher.num) return true;
  return overlapsQuery(check, mins, maxs);
};
const jsFullScanCandidates = (pusher, mins, maxs) => {
  const out = [];
  for (let e = 1; e < num_edicts; e++) if (pushGate(edicts[e], pusher, mins, maxs)) out.push(edicts[e]);
  return out;
};

// --- fixture ----------------------------------------------------------------
// PUSHER: a plat moving up. CORPSE: a gib that spawned SOLID_NOT (-> registry),
// was promoted to SOLID_TRIGGER and relinked (-> area chain), then demoted back to
// SOLID_NOT by a bare .solid assignment (NO relink) — present in BOTH sources.
const PUSHER = 1, RIDER = 2, CORPSE = 3, BYSTANDER = 4;
setBox(edicts[PUSHER], 0, 0, 0, 64, 64, 8, SOLID_BSP, MT.push);
edicts[PUSHER].v[F.VELOCITY + 2] = 100;
setBox(edicts[RIDER], 10, 10, 32, 16, 16, 24, 3 /*SOLID_SLIDEBOX*/, MT.step);
edicts[RIDER].v[F.FLAGS] = FL_ONGROUND; edicts[RIDER].gnd = PUSHER;
setBox(edicts[BYSTANDER], -20, -20, 20, 16, 16, 16, 3, MT.toss);
setBox(edicts[CORPSE], 20, 20, 16, 8, 8, 8, SOLID_NOT, MT.toss);
for (const e of [PUSHER, RIDER, BYSTANDER, CORPSE]) linkEdict(edicts[e]);
edicts[CORPSE].v[F.SOLID] = SOLID_TRIGGER; linkEdict(edicts[CORPSE]);
edicts[CORPSE].v[F.SOLID] = SOLID_NOT;            // bare assignment: no relink
for (let i = 5; i < num_edicts; i++) edicts[i].free = true;

assert.ok(edicts[CORPSE].area !== null, 'fixture: corpse must still be in an area chain');
assert.ok(solidNotPushables.includes(edicts[CORPSE]), 'fixture: corpse must be in the SOLID_NOT registry');

const move = [0, 0, 100 * 0.05];
const mins = [], maxs = [];
for (let i = 0; i < 3; i++) {
  mins[i] = edicts[PUSHER].v[F.ABSMIN + i] + move[i];
  maxs[i] = edicts[PUSHER].v[F.ABSMAX + i] + move[i];
}

const results = [];
const check = (name, cond, extra) => {
  results.push(cond);
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '   ' + (extra ?? '')}`);
};
const nums = (l) => l.map(e => e.num);
const dupes = (l) => nums(l).filter((n, i, a) => a.indexOf(n) !== i);

// 1. negative control: the pre-fix stamp placement double-lists the corpse.
{
  const old = gatherPushCandidates(edicts[PUSHER], mins, maxs, move, 'after');
  check('pre-fix gather DOES duplicate the demoted-SOLID_NOT edict (negative control)',
    dupes(old).length === 1 && dupes(old)[0] === CORPSE, `dupes=${dupes(old)}`);
}

// 2. the fix: each edict at most once.
const got = gatherPushCandidates(edicts[PUSHER], mins, maxs, move, 'insert');
check('gather visits every edict at most once', dupes(got).length === 0, `dupes=${dupes(got)}`);
check('the demoted-SOLID_NOT edict appears exactly once',
  nums(got).filter(n => n === CORPSE).length === 1, `list=${nums(got)}`);

// 3. edict-number order, like QSS-M's ascending scan.
check('gather is ordered by edict number',
  nums(got).every((n, i, a) => i === 0 || a[i - 1] < n), `list=${nums(got)}`);

// 4. the stream pushMove actually processes == QSS-M's scan, element for element.
{
  const processed = nums(got.filter(e => pushGate(e, edicts[PUSHER], mins, maxs)));
  const reference = nums(jsFullScanCandidates(edicts[PUSHER], mins, maxs));
  check('processed stream is identical to QSS-M SV_PushMove\'s scan',
    JSON.stringify(processed) === JSON.stringify(reference),
    `got=${processed} want=${reference}`);
}

// 5. the gather must never DROP something QSS-M would consider (superset property).
{
  const have = new Set(nums(got));
  const missing = nums(jsFullScanCandidates(edicts[PUSHER], mins, maxs)).filter(n => !have.has(n));
  check('gather is a superset of QSS-M\'s candidate set', missing.length === 0, `missing=${missing}`);
}

const ok = results.every(Boolean);
console.log(ok ? '\nALL PUSH-GATHER PARITY TESTS PASS' : '\nPUSH-GATHER PARITY FAILURES');
process.exit(ok ? 0 : 1);
