// Build + run every parity test. THE verify loop: an agent that ports a module
// adds it to MODULES + writes harness/<mod>.test.mjs, then runs `node wasm-sim/run.mjs`
// and must see all-PASS before finishing.
//
// Each module is compiled STANDALONE to build/<mod>.wasm (its test loads that), and
// the unified assembly/index.ts is compiled to build/sim.wasm as a link-together
// sanity check (and to serve tests that load sim.wasm, e.g. math).
import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const HERE = dirname(fileURLToPath(import.meta.url));
const root = join(HERE, '..');
const sh = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });
const ascFlags = '-O3 --exportRuntime --runtime incremental';

// Standalone-buildable modules (each has harness/<mod>.test.mjs, loading build/<mod>.wasm).
// vm is no longer built standalone (it now imports host->builtins->everything; its
// test drives the unified sim.wasm). host is built standalone for host.test.
const MODULES = ['math', 'world', 'builtins_math', 'ed', 'strings', 'svmove', 'builtins_world', 'svphysics', 'host', 'builtins_edict', 'builtins_math2', 'builtins_move', 'svframe', 'svpusher', 'builtins_model', 'svclient'];

console.log('== compile unified assembly/index.ts -> build/sim.wasm (link check) ==');
sh(`npx asc wasm-sim/assembly/index.ts --outFile wasm-sim/build/sim.wasm --textFile wasm-sim/build/sim.wat ${ascFlags}`);

// Smoke: the unified module must instantiate. Modules declare host imports (vm's
// edict/string/builtin stubs, strings' formatters, ...); stub ANY import namespace
// via a Proxy so this stays valid as more modules land (parity is proven per-module;
// this only checks the unified module links + loads).
{
  const { readFileSync } = await import('fs');
  const stubNs = new Proxy({}, { get: () => () => 0 });
  const imports = new Proxy(
    { env: { abort: () => { throw new Error('sim.wasm abort'); } } },
    { get: (t, k) => k in t ? t[k] : stubNs, has: () => true },
  );
  await WebAssembly.instantiate(readFileSync(join(root, 'wasm-sim', 'build', 'sim.wasm')), imports);
  console.log('   sim.wasm instantiates OK (stubbed imports)');
}

for (const m of MODULES) {
  console.log(`== compile assembly/${m}.ts -> build/${m}.wasm ==`);
  sh(`npx asc wasm-sim/assembly/${m}.ts --outFile wasm-sim/build/${m}.wasm --textFile wasm-sim/build/${m}.wat ${ascFlags}`);
}

const tests = readdirSync(join(HERE, 'harness')).filter(f => f.endsWith('.test.mjs')).sort();
let failed = 0;
for (const t of tests) {
  console.log(`\n== ${t} ==`);
  try { sh(`node ${join('wasm-sim', 'harness', t)}`); }
  catch { failed++; }
}
console.log(`\n${failed === 0 ? 'ALL PARITY TESTS PASS' : failed + ' TEST FILE(S) FAILED'}`);
process.exit(failed === 0 ? 0 : 1);
