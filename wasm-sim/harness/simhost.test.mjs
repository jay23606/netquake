// Wiring smoke for the sim runtime (runtime/simhost.mjs): instantiate the unified
// sim.wasm through the runtime (all host imports bridged), load real vanilla progs,
// and advance one frame that moves an entity — proving the glue + frame API work
// end-to-end. Frame CORRECTNESS is proven bit-exact by svframe.test/svpusher.test;
// this only checks the runtime wiring holds together. Skips without the Quake pak.
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Check } from './lib.mjs';
import { createSim } from '../runtime/simhost.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROGS = join(HERE, '..', 'build', 'id1_progs.dat');
if (!existsSync(PROGS)) {
  console.log('[SKIP] simhost.wiring: build/id1_progs.dat not found (run extract_progs.mjs).');
  process.exit(0);
}

const chk = new Check('simhost.wiring');
const printed = [];
const sim = await createSim(readFileSync(join(HERE, '..', 'build', 'sim.wasm')), {
  print: (lvl, ent, s) => printed.push([lvl, ent, s]),   // e.g. QC dprint routes here
  random: () => 0.0,
});

// Load real vanilla progs, then hand-set the physics tuning + an open-space world.
sim.loadProgs(readFileSync(PROGS));
sim.exports.setMaxVelocity(2000);
sim.exports.setGravityCvar(800);
sim.exports.setGravityFieldIdx(-1);           // vanilla id1 has no per-entity .gravity
// All-empty world hull (open space): any trace returns fraction 1, no solid.
sim.setWorldHull(0, 0, [{ normal: [1, 0, 0], dist: 0, type: 0 }], [{ planenum: 0, children: [-1, -1] }]);

// World (0) + one moving entity (1) + one free (2).
sim.initAreaTree(-4096, -4096, -4096, 4096, 4096, 4096, 8);
sim.initEntState(1, 3);
sim.setEdictFree(0, false); sim.setEdictFree(1, false); sim.setEdictFree(2, true);
const F_MOVETYPE = 8, F_SOLID = 9, F_ORIGIN = 10, F_VELOCITY = 16;
const MOVETYPE_TOSS = 6, SOLID_NOT = 0;
sim.edStoreFloat(1, F_MOVETYPE, MOVETYPE_TOSS);   // movetype is a QC .float field
sim.edStoreFloat(1, F_SOLID, SOLID_NOT);
for (let k = 0; k < 3; k++) { sim.edStoreFloat(1, F_ORIGIN + k, 0); sim.edStoreFloat(1, F_VELOCITY + k, 0); }
sim.edStoreFloat(1, F_VELOCITY, 100);          // +100 u/s along X

// Advance one 0.1s server frame.
sim.tick(0.0, 0.1);

const x = sim.edLoadFloat(1, F_ORIGIN);        // should have moved ~+10 (100 * 0.1)
chk.floatEq(x, Math.fround(10), 'toss entity advanced by velocity*frametime');
chk.intEq(sim.getNumEdicts(), 3, 'num_edicts preserved');
chk.intEq(sim.getSvTime() > 0 ? 1 : 0, 1, 'server time advanced past the frame');

process.exit(chk.report() ? 0 : 1);
