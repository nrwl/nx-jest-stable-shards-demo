// Checks per-project Jest resolution on fixtures/mappers, a small workspace
// whose three projects resolve the same specifiers differently. The fixture is
// copied to a throwaway workspace with this repository's plugin, and real Nx
// and Jest run there. fixtures/mappers/cases.json records, per case, the file
// the specifier must resolve to; the script checks the plugin against it, and
// the fixture's own tests check Jest against it. Prints one markdown table row
// per check.
// Usage: node scripts/mapper-fixture.ts (KEEP_MAPPER_FIXTURE=1 keeps the workspace)
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface Case {
  test: string;
  importer: string;
  specifier: string;
  /** Workspace-relative, or null when the specifier resolves to a third-party package. */
  resolved: string | null;
  /** Files the resolved file imports in turn. */
  leaves: string[];
  variation: string;
}

const repo = process.cwd();
const ws = realpathSync(mkdtempSync(join(tmpdir(), 'mapper-fixture-')));
if (process.env.KEEP_MAPPER_FIXTURE) console.error(`workspace: ${ws}`);
else process.on('exit', () => rmSync(ws, { recursive: true, force: true }));
cpSync(join(repo, 'fixtures/mappers'), ws, { recursive: true });
cpSync(join(repo, 'tools/jest-shards'), join(ws, 'tools/jest-shards'), { recursive: true });
// The repository's packages, plus the fixture's own packages linked the way a
// package manager links workspace packages.
mkdirSync(join(ws, 'node_modules/@acme'), { recursive: true });
for (const entry of readdirSync(join(repo, 'node_modules'))) {
  symlinkSync(join(repo, 'node_modules', entry), join(ws, 'node_modules', entry));
}
for (const name of readdirSync(join(ws, 'pkgs'))) {
  symlinkSync(join('../../pkgs', name), join(ws, 'node_modules/@acme', name));
}

const env = {
  ...process.env,
  NX_DAEMON: 'false',
  NX_LEGACY_AFFECTED: 'false',
  NX_NO_CLOUD: 'true',
  NX_CACHE_DIRECTORY: join(ws, '.nx/cache'),
  NX_WORKSPACE_DATA_DIRECTORY: join(ws, '.nx/workspace-data'),
};
const WS = '{workspaceRoot}/';

function exec(cmd: string, args: string[]) {
  return spawnSync(cmd, args, { cwd: ws, env, encoding: 'utf8', maxBuffer: 1 << 30 });
}
function git(args: string[]): string {
  const result = exec('git', args);
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  return result.stdout;
}
function nx(args: string[]): string {
  const result = exec('node_modules/.bin/nx', args);
  if (result.status !== 0)
    throw new Error(`nx ${args[0]} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

/** Shard task id to its whole target, as the graph has it. */
type Plan = Map<string, { inputs: unknown[]; options: unknown }>;
function plan(): Plan {
  // `nx graph` exits 0 with a partial graph when a plugin fails.
  const output = nx(['graph', '--file=.nx/mapper-graph.json']);
  if (/error occurred/i.test(output)) throw new Error(`nx graph failed:\n${output}`);
  const { graph } = JSON.parse(readFileSync(join(ws, '.nx/mapper-graph.json'), 'utf8'));
  const result: Plan = new Map();
  for (const node of Object.values<any>(graph.nodes)) {
    for (const [name, target] of Object.entries<any>(node.data.targets ?? {})) {
      if (name.startsWith('test-ci--')) result.set(`${node.name}:${name}`, target);
    }
  }
  return new Map([...result].sort(([a], [b]) => a.localeCompare(b)));
}
const shardsWith = (p: Plan, file: string) =>
  [...p].filter(([, target]) => target.inputs.includes(WS + file)).map(([id]) => id);
const targetNames = (p: Plan) => [...new Set([...p.keys()].map((id) => id.split(':')[1]))].join();
let lastRun = '';
/** Runs every shard and returns the ones that missed the cache. */
function executed(p: Plan): string[] {
  lastRun = nx(['run-many', '-t', targetNames(p), '--output-style=static']).replace(
    /\x1b\[[0-9;]*m/g,
    '',
  );
  return [...lastRun.matchAll(/^> nx run (\S+)(.*)$/gm)]
    .filter((m) => !m[2].includes('cache'))
    .map((m) => m[1])
    .sort();
}
/** The graph must fail, and its error must name every part. */
function graphFails(parts: string[]): string {
  const result = exec('node_modules/.bin/nx', ['run-many', '-t', 'test-ci--01']);
  const output = (result.stdout + result.stderr).replace(/\x1b\[[0-9;]*m/g, '');
  if (result.status === 0) return 'the graph was built and tasks ran';
  const absent = parts.filter((part) => !output.includes(part));
  return absent.length === 0 ? '' : `the error does not name ${absent.join(', ')}`;
}
function reset() {
  git(['reset', '-q', '--hard']);
  git(['clean', '-fdq', '--', 'apps', 'pkgs', 'shared']);
}
function edit(file: string, from: string | RegExp, to: string) {
  const before = readFileSync(join(ws, file), 'utf8');
  const after = before.replace(from, () => to);
  if (after === before) throw new Error(`${file}: nothing to replace`);
  writeFileSync(join(ws, file), after);
}
const eq = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const unique = (ids: string[]) => [...new Set(ids)].sort();

git(['init', '-q']);
git(['add', '-A']);
git([
  '-c',
  'user.name=fixture',
  '-c',
  'user.email=fixture@example.com',
  'commit',
  '-qm',
  'fixture',
]);

const cases: Record<string, Case> = JSON.parse(readFileSync(join(ws, 'cases.json'), 'utf8'));
const table: string[] = [];
let failures = 0;
const row = (check: string, expected: string, actual: string, ok: boolean) => {
  if (!ok) failures++;
  table.push(`| ${check} | ${expected} | ${actual} | ${ok ? 'pass' : '**MISMATCH**'} |`);
};
const attempt = (check: string, expected: string, run: () => [string, boolean]) => {
  console.error(check);
  try {
    row(check, expected, ...run());
  } catch (error) {
    row(check, expected, `error: ${String(error).split('\n').slice(0, 3).join(' ')}`, false);
  } finally {
    reset();
  }
};

// 1. The plugin resolves every case to the file the manifest records.
console.error('cold graph');
const cold = plan();
for (const [id, c] of Object.entries(cases)) {
  const [shard, ...others] = shardsWith(cold, c.test);
  const inputs = (cold.get(shard)?.inputs ?? []).filter((i) => typeof i === 'string');
  const wanted = c.resolved ? [c.resolved, ...c.leaves] : [];
  const absent = wanted.filter((file) => !inputs.includes(WS + file));
  const thirdParty = inputs.filter((i) => i.includes('node_modules'));
  const ok = !!shard && others.length === 0 && absent.length === 0 && thirdParty.length === 0;
  row(
    `\`${id}\`: ${c.variation}`,
    `\`${c.specifier}\` in \`${c.importer}\` resolves to ${c.resolved ? `\`${c.resolved}\`` : 'a third-party package'}${c.leaves.length ? ` and on to ${c.leaves.map((l) => `\`${l}\``).join(', ')}` : ''}`,
    ok
      ? `in the inputs of \`${shard}\``
      : `shards ${[shard, ...others].join(', ') || 'none'}; missing ${absent.join(', ') || 'nothing'}; third-party inputs ${thirdParty.join(', ') || 'none'}`,
    ok,
  );
}

// 2. Jest resolves every case to the same file: each fixture test compares
// `require.resolve` under its own project with the manifest.
attempt(
  'Every shard runs under Jest',
  'every test passes: Jest resolves each case to the recorded file',
  () => {
    const ran = executed(cold);
    const passed = [...lastRun.matchAll(/Tests:\s+(\d+) passed, (\d+) total/g)];
    const tests = passed.reduce((sum, m) => sum + Number(m[1]), 0);
    const total = passed.reduce((sum, m) => sum + Number(m[2]), 0);
    return [
      `${ran.length} of ${cold.size} shards ran; ${tests} of ${total} tests passed`,
      eq(ran, [...cold.keys()]) && tests === total && tests >= Object.keys(cases).length,
    ];
  },
);

attempt(
  'Membership parity (`scripts/parity.ts`), including the project whose rootDir is `src`',
  'PARITY OK',
  () => {
    const result = exec('node', [join(repo, 'scripts/parity.ts')]);
    const lines = result.stdout.trim().split('\n');
    return [`${lines.length - 1} checks; ${lines.at(-1)}`, result.status === 0];
  },
);

// 3. Cold and warm graph construction produce the same plan.
attempt('Cold and warm graph construction', 'the same targets, inputs and commands', () => {
  const warm = plan();
  rmSync(join(ws, '.nx/workspace-data'), { recursive: true, force: true });
  const coldAgain = plan();
  const [a, b, c] = [cold, warm, coldAgain].map((p) => JSON.stringify([...p]));
  return [
    `${cold.size} shards; cold, warm and a second cold build are ${a === b && a === c ? 'identical' : 'different'}`,
    a === b && a === c,
  ];
});

// 4. Editing a resolved file reruns the shards whose tests reach it, and no other.
const leaves = unique(
  Object.values(cases).flatMap((c) => (c.resolved ? [c.resolved, ...c.leaves] : [])),
);
executed(cold);
for (const leaf of leaves) {
  attempt(`Edit \`${leaf}\``, 'only the shards of the cases that reach it miss the cache', () => {
    const want = unique(
      Object.values(cases)
        .filter((c) => c.resolved === leaf || c.leaves.includes(leaf))
        .flatMap((c) => shardsWith(cold, c.test)),
    );
    appendFileSync(join(ws, leaf), '\n// edited\n');
    const selected = Object.keys(
      JSON.parse(nx(['affected', '-t', targetNames(cold), `--files=${leaf}`, '--graph=stdout']))
        .tasks.tasks,
    ).sort();
    const missed = executed(cold);
    return [
      `expected ${want.join(', ')}; selected ${selected.join(', ')}; missed ${missed.join(', ')}`,
      want.length > 0 && eq(selected, want) && eq(missed, want),
    ];
  });
}

// 5. A change to a mapper alone recomputes the closure on a warm graph cache.
attempt(
  "Change only alpha's mapper for `@acme/ui/button`, on a warm graph cache",
  "the importing shard's inputs follow the mapper to `apps/alpha/src/ui/generic/button.js`",
  () => {
    const test = cases['alpha/ui-button'].test;
    edit(
      'apps/alpha/jest.config.js',
      "'^@acme/ui/button$': '<rootDir>/src/ui/special-button.js'",
      "'^@acme/ui/button$': '<rootDir>/src/ui/generic/button.js'",
    );
    const after = plan();
    const [shard] = shardsWith(after, test);
    const inputs = after.get(shard)!.inputs;
    const ok =
      inputs.includes(WS + 'apps/alpha/src/ui/generic/button.js') &&
      !inputs.includes(WS + 'apps/alpha/src/ui/special-button.js');
    return [
      `\`${shard}\` ${ok ? 'now lists the new target and not the old one' : 'did not follow the mapper'}`,
      ok,
    ];
  },
);

// 6. Nothing unresolved is dropped: each of these must fail graph construction.
const failing: [string, string[], () => void][] = [
  [
    'Remove the mapper for `@acme/built`, whose `main` (`lib/index.js`) is absent',
    ['apps/alpha/jest.config.js', 'apps/alpha/src/built.test.js', "'@acme/built'"],
    () => edit('apps/alpha/jest.config.js', /\n.*'\^@acme\/built\$'.*\n/, '\n'),
  ],
  [
    'Remove that mapper with `lib/index.js` built locally (gitignored)',
    ['pkgs/built/lib/index.js', 'ignored by git'],
    () => {
      edit('apps/alpha/jest.config.js', /\n.*'\^@acme\/built\$'.*\n/, '\n');
      mkdirSync(join(ws, 'pkgs/built/lib'));
      writeFileSync(join(ws, 'pkgs/built/lib/index.js'), "module.exports = 'built output';\n");
    },
  ],
  [
    'Import a specifier no config maps, from the shared importer',
    ['apps/alpha/jest.config.js', 'shared/uses-flavor.js', "'@acme/nowhere'"],
    () => appendFileSync(join(ws, 'shared/uses-flavor.js'), "require('@acme/nowhere');\n"),
  ],
  [
    'Map a specifier to files that do not exist',
    ['apps/alpha/jest.config.js', 'apps/alpha/src/fallback.test.js', "'@acme/fallback'"],
    () => rmSync(join(ws, 'apps/alpha/src/fallback.js')),
  ],
  [
    'Import a relative file that does not exist',
    ['apps/beta/jest.config.js', 'apps/beta/src/built.test.js', "'./gone'"],
    () => appendFileSync(join(ws, 'apps/beta/src/built.test.js'), "require('./gone');\n"),
  ],
  [
    'Declare a shared input file that does not exist',
    ['sharedInputs', 'tools/gone.js', 'cannot be read'],
    () =>
      edit('nx.json', '"sharedInputs": [', '"sharedInputs": ["{workspaceRoot}/tools/gone.js", '),
  ],
  [
    "Set gamma's `rootDir` outside its project",
    ['apps/gamma/jest.config.js', 'rootDir'],
    () => {
      edit('apps/gamma/jest.config.js', "rootDir: 'src'", "rootDir: '../beta'");
      edit('apps/gamma/jest.config.js', '../../../jest.preset.js', '../../jest.preset.js');
    },
  ],
];
for (const [check, parts, apply] of failing) {
  attempt(check, `graph construction fails, naming ${parts.join(', ')}`, () => {
    apply();
    const problem = graphFails(parts);
    return [problem || 'failed as expected', problem === ''];
  });
}

console.log('| Check | Expected | Actual | Result |');
console.log('| --- | --- | --- | --- |');
for (const line of table) console.log(line);
console.log(`\n${table.length - failures}/${table.length} rows pass`);
if (failures > 0) process.exitCode = 1;
