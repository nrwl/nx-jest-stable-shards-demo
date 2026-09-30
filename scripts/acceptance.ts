// Runs the acceptance matrix (plan Section 3.6) on the committed smoke fixture
// and prints one markdown table row per change. Selection comes from
// `nx affected --files=... --graph=stdout`, cache behavior from a following
// `nx run-many`. Needs a clean working tree: every row is undone with
// `git reset --hard` plus `git clean` under packages/.
// Usage: node scripts/acceptance.ts
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

const env = {
  ...process.env,
  NX_NO_CLOUD: 'true',
  NX_DAEMON: 'false',
  NX_LEGACY_AFFECTED: 'false',
};
const WS = '{workspaceRoot}/';

function exec(cmd: string, args: string[]) {
  return spawnSync(cmd, args, { env, encoding: 'utf8', maxBuffer: 1 << 30 });
}
function nx(args: string[]): string {
  const result = exec('node_modules/.bin/nx', [...args]);
  if (result.status !== 0)
    throw new Error(`nx ${args[0]} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
function git(args: string[]): string {
  return exec('git', args).stdout;
}

/** Shard task id to its string inputs. */
type Shards = Map<string, string[]>;
function shards(): Shards {
  nx(['graph', '--file=.nx/acceptance-graph.json']);
  const { graph } = JSON.parse(readFileSync('.nx/acceptance-graph.json', 'utf8'));
  const result: Shards = new Map();
  for (const node of Object.values<any>(graph.nodes)) {
    for (const [name, target] of Object.entries<any>(node.data.targets ?? {})) {
      if (!name.startsWith('test-ci--')) continue;
      result.set(
        `${node.name}:${name}`,
        target.inputs.filter((i: unknown) => typeof i === 'string'),
      );
    }
  }
  return result;
}
function shardTargets(): string {
  const result = exec('node', ['scripts/shard-targets.ts']);
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
function select(files: string[]): string[] {
  const out = nx([
    'affected',
    '-t',
    shardTargets(),
    `--files=${files.join(',')}`,
    '--graph=stdout',
  ]);
  return Object.keys(JSON.parse(out).tasks.tasks).sort();
}
let lastRun = '';
function executed(): string[] {
  lastRun = nx(['run-many', '-t', shardTargets(), '--output-style=static']);
  return [...lastRun.matchAll(/^> nx run (\S+)(.*)$/gm)]
    .filter((m) => !m[2].includes('cache'))
    .map((m) => m[1])
    .sort();
}
function reset() {
  git(['reset', '-q', '--hard']);
  git(['clean', '-fdq', '--', 'packages', 'README.md']);
}

const before = shards();
const all = [...before.keys()].sort();
const shardOf = (s: Shards, file: string) =>
  [...s].filter(([, inputs]) => inputs.includes(WS + file)).map(([id]) => id);
const owner = (s: Shards, project: string) =>
  [...s.keys()].filter((id) => id.startsWith(project + ':')).sort();
const unique = (ids: string[]) => [...new Set(ids)].sort();
const append = (file: string, text = '\n// edited\n') => appendFileSync(file, text);
const testsOf = (root: string) =>
  git(['ls-files', '--', `${root}/**/*.test.js`, `${root}/**/*.test.ts`])
    .split('\n')
    .filter(Boolean)
    .sort();
const entryOf = (root: string) =>
  testsOf(root).find((f) => readFileSync(f, 'utf8').includes('jest.mock('))!;
const leafOf = (test: string) => test.replace(/\.test\.[jt]s$/, '.leaf.js');
const describe = (ids: string[]) => {
  if (ids.length === 0) return 'none';
  if (ids.length === all.length && ids.every((id, i) => id === all[i])) return `all ${ids.length}`;
  if (ids.length <= 8) return ids.join(', ');
  return `${ids.length} shards: ${ids.slice(0, 3).join(', ')}, ...`;
};

// Fixture picks. project-001 has 4 buckets and sits on the 100-test boundary;
// project-047 has 4 buckets plus one isolated test (shard 5).
const P1 = 'packages/project-001';
const P47 = 'packages/project-047';
const entry1 = entryOf(P1);
const plain1 = testsOf(P1).find((f) => f !== entry1 && !f.includes('/project-0', P1.length))!;
const childRoot1 = testsOf(P1).find((f) => f.includes('/project-0', P1.length))!;
const isolated = JSON.parse(readFileSync('nx.json', 'utf8')).plugins[0].options.isolate[0];
const plain47 = testsOf(P47).filter((f) => f !== entryOf(P47) && f !== isolated);
const topology = JSON.parse(readFileSync('fixtures/topology.json', 'utf8'));
const rootOf = new Map<string, string>(topology.projects.map((p: any) => [p.id, p.root]));
const hasTests = (id: string) => before.has(`${id}:test-ci--01`) || owner(before, id).length > 0;
const [, upstream] = topology.edges.find(
  ([d, u]: string[]) => d === 'project-001' && hasTests(u) && !rootOf.get(u)!.startsWith(P1),
);
const crossModule = `${rootOf.get(upstream)}/api/one.js`;
const crossExpected = unique([
  ...shardOf(before, entryOf(rootOf.get(upstream)!)),
  ...topology.edges
    .filter(([d, u]: string[]) => u === upstream && hasTests(d))
    .flatMap(([d]: string[]) => shardOf(before, entryOf(rootOf.get(d)!))),
]);

interface Row {
  change: string;
  expectSelect: string;
  expectCache: string;
  apply: () => string[];
  /** Returns [expected selection, expected cache misses]; `after` is the graph with the change. */
  expect: (after: Shards) => [string[], string[]];
}
const same = (ids: string[]) => (): [string[], string[]] => [ids, ids];
const rows: Row[] = [
  {
    change: `Edit one existing test (\`${relative(P1, plain1)}\` in project-001)`,
    expectSelect: 'its shard only',
    expectCache: 'that shard misses, all others hit',
    apply: () => (append(plain1), [plain1]),
    expect: same(shardOf(before, plain1)),
  },
  {
    change: 'Edit a leaf module imported by one test',
    expectSelect: "that test's shard only",
    expectCache: 'same',
    apply: () => (append(leafOf(plain1)), [leafOf(plain1)]),
    expect: same(shardOf(before, plain1)),
  },
  {
    change: 'Edit a barrel (`packages/project-001/index.js`)',
    expectSelect: 'every shard with a test behind the barrel',
    expectCache: 'same',
    apply: () => (append(`${P1}/index.js`), [`${P1}/index.js`]),
    expect: same(shardOf(before, entry1)),
  },
  {
    change: `Edit a cross-project module (\`${crossModule}\`)`,
    expectSelect:
      "the upstream project's shard holding the test that imports it, plus downstream shards whose tests import it",
    expectCache: 'same',
    apply: () => (append(crossModule), [crossModule]),
    expect: same(crossExpected),
  },
  {
    change: 'Add a module imported by nothing',
    expectSelect: 'nothing',
    expectCache: 'all hit',
    apply: () => (writeFileSync(`${P1}/unused.js`, 'module.exports = 1;\n'), [`${P1}/unused.js`]),
    expect: same([]),
  },
  ...[
    'jest.preset.js',
    'tools/fixture/setup.js',
    'tools/fixture/transform.js',
    `${P1}/api/__mocks__/two.js`,
  ].map((file) => ({
    change: `Edit a shared file (\`${file}\`)`,
    expectSelect: 'every shard',
    expectCache: 'all miss',
    apply: () => (append(file), [file]),
    expect: same(all),
  })),
  ...['jest.config.js', 'package.json', 'project.json'].map((name) => ({
    change: `Edit project-047's \`${name}\``,
    expectSelect: 'all shards of that owner',
    expectCache: 'those miss',
    apply: () => {
      const file = `${P47}/${name}`;
      if (name.endsWith('.json'))
        writeFileSync(
          file,
          readFileSync(file, 'utf8').replace(/\n}\n$/, ',\n  "tags": ["edited"]\n}\n'),
        );
      else append(file);
      return [file];
    },
    expect: same(owner(before, 'project-047')),
  })),
  {
    change: "Edit only a member's `.snap` file",
    expectSelect: "that member's shard only",
    expectCache: 'that shard misses',
    apply: () => {
      const snap = join(dirname(entry1), '__snapshots__', basename(entry1) + '.snap');
      append(snap, '\n');
      return [snap];
    },
    expect: same(shardOf(before, entry1)),
  },
  {
    change: 'Edit only a helper imported by the setup file (`tools/fixture/work.js`)',
    expectSelect: 'every shard',
    expectCache: 'all miss',
    apply: () => (append('tools/fixture/work.js'), ['tools/fixture/work.js']),
    expect: same(all),
  },
  {
    change: 'Add a test to project-047, bucket count unchanged',
    expectSelect: 'the new shard k only; other memberships unchanged',
    expectCache: 'shard k misses, siblings hit',
    apply: () => [addTest(dirname(plain47[0]), 'added-1')],
    expect: (after) => [
      shardOf(after, join(dirname(plain47[0]), 'added-1.test.js')),
      shardOf(after, join(dirname(plain47[0]), 'added-1.test.js')),
    ],
  },
  {
    change: 'Add one test to project-001 across the 100-test boundary (4 to 8 buckets)',
    expectSelect: 'only the new shard holding the added test; redistributed tests are not selected',
    expectCache: 'all shards of project-001 miss once',
    apply: () => [addTest(dirname(plain1), 'added-2')],
    expect: (after) => [
      shardOf(after, join(dirname(plain1), 'added-2.test.js')),
      owner(after, 'project-001'),
    ],
  },
  {
    change: 'Delete a test (delete-only diff)',
    expectSelect: 'nothing (documented)',
    expectCache: "that shard's hash changed; siblings hit",
    apply: () => (rmSync(plain47[1]), [plain47[1]]),
    expect: () => [[], shardOf(before, plain47[1])],
  },
  {
    change: 'Rename a test across buckets',
    expectSelect: "the new bucket's shard",
    expectCache: 'both shards miss',
    apply: () => [renameAcrossBuckets(plain47[2])],
    expect: (after) => {
      const moved = renamed!;
      return [
        shardOf(after, moved),
        unique([...shardOf(before, plain47[2]), ...shardOf(after, moved)]),
      ];
    },
  },
  {
    change: 'Edit the isolated test',
    expectSelect: 'its own shard (`--shard=5/5`)',
    expectCache: 'same',
    apply: () => (append(isolated), [isolated]),
    expect: same(shardOf(before, isolated)),
  },
  {
    change: 'Unrelated change (`README.md`, and `index.js` of project-054, which has no tests)',
    expectSelect: 'nothing',
    expectCache: 'all hit',
    apply: () => {
      append('README.md', '\nedited\n');
      append('packages/project-054/index.js');
      return ['README.md', 'packages/project-054/index.js'];
    },
    expect: same([]),
  },
  {
    change: 'Lockfile change (one package integrity)',
    expectSelect: 'every shard',
    expectCache: 'all miss',
    apply: () => {
      const lock = readFileSync('pnpm-lock.yaml', 'utf8');
      writeFileSync('pnpm-lock.yaml', lock.replace(/integrity: sha512-A/, 'integrity: sha512-B'));
      return ['pnpm-lock.yaml'];
    },
    expect: same(all),
  },
  {
    change: "Add a test at an odd path (`app/odd dir/it's (1).test.js` in project-047)",
    expectSelect: 'its shard only; Jest executes it',
    expectCache: 'same',
    apply: () => [addTest(`${P47}/app/odd dir`, "it's (1)")],
    expect: (after) => [
      shardOf(after, `${P47}/app/odd dir/it's ?1?.test.js`),
      shardOf(after, `${P47}/app/odd dir/it's ?1?.test.js`),
    ],
  },
  {
    change:
      'Edit an alias target (`@packages/project-047` resolves to `packages/project-047/index.js`)',
    expectSelect: "the importing test's shard",
    expectCache: 'that shard misses',
    apply: () => (append(`${P47}/index.js`), [`${P47}/index.js`]),
    expect: same(shardOf(before, entryOf(P47))),
  },
];

let renamed: string | undefined;
function renameAcrossBuckets(test: string): string {
  const bucket = (path: string) =>
    createHash('sha256').update(relative(P47, path)).digest().readUInt32BE(0) % 4;
  for (let n = 1; ; n++) {
    const target = join(dirname(test), `renamed-${n}.test.js`);
    if (bucket(target) === bucket(test)) continue;
    renameSync(test, target);
    return (renamed = target);
  }
}
function addTest(dir: string, name: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${name}.leaf.js`),
    `module.exports = { value: ${JSON.stringify(name)} };\n`,
  );
  const file = join(dir, `${name}.test.js`);
  writeFileSync(
    file,
    `const leaf = require(${JSON.stringify(`./${name}.leaf`)});\n\ntest('added', () => {\n  expect(leaf.value).toBe(${JSON.stringify(name)});\n});\n`,
  );
  return file;
}

if (git(['status', '--porcelain']).trim())
  throw new Error('acceptance: needs a clean working tree');
console.error('warming the cache');
executed();
const table: string[] = [];
const verdict = (ok: boolean) => (ok ? 'pass' : '**MISMATCH**');
const eq = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

for (const row of rows) {
  console.error(`row: ${row.change}`);
  try {
    const files = row.apply();
    const after = shards();
    const [wantSelect, wantCache] = row.expect(after).map(unique);
    const gotSelect = select(files);
    const gotCache = executed();
    let ok = eq(gotSelect, wantSelect) && eq(gotCache, wantCache);
    if (row.change.includes('odd path'))
      ok &&= /PASS .*odd dir\/it's \(1\)\.test\.js/.test(lastRun.replace(/\x1b\[[0-9;]*m/g, ''));
    table.push(
      `| ${row.change} | ${row.expectSelect}: ${describe(wantSelect)} | ${describe(gotSelect)} | ${row.expectCache}: ${describe(wantCache)} | ${describe(gotCache)} | ${verdict(ok)} |`,
    );
  } catch (error) {
    const message = String(error).split('\n')[0];
    table.push(
      `| ${row.change} | ${row.expectSelect} | error: ${message} | ${row.expectCache} | | **ERROR** |`,
    );
  } finally {
    reset();
  }
}

// Closure cap rows (DM1): force a stage with a small maxClosureInputs, then
// edit a member test, a child-root file and a cross-project module.
for (const [stage, max] of [
  [2, 40],
  [3, 1],
] as const) {
  console.error(`cap stage ${stage}`);
  const setCap = () => {
    const nxJson = JSON.parse(readFileSync('nx.json', 'utf8'));
    nxJson.plugins[0].options.maxClosureInputs = max;
    writeFileSync('nx.json', JSON.stringify(nxJson, null, 2) + '\n');
  };
  const edits = [plain1, leafOf(childRoot1), crossModule];
  const results: string[] = [];
  let ok = true;
  try {
    setCap();
    const capped = shards();
    const glob = stage === 2 ? /[^*]\/\*$/ : /\/\*\*\/\*$/;
    ok &&= owner(capped, 'project-001').every((id) =>
      capped
        .get(id)!
        .some((i) => glob.test(i) && !i.includes('__mocks__') && !i.includes('jest-shards')),
    );
    executed();
    for (const file of edits) {
      const want = shardOf(
        before,
        file.endsWith('.leaf.js')
          ? file.replace('.leaf.js', '.test.js')
          : file === crossModule
            ? entry1
            : file,
      );
      append(file);
      const gotSelect = select([file]);
      const gotCache = executed();
      ok &&= want.every((id) => gotSelect.includes(id)) && eq(gotCache, gotSelect);
      results.push(
        `\`${relative('.', file)}\`: selected ${describe(gotSelect)}; ran ${describe(gotCache)}`,
      );
      git(['checkout', '--', file]);
    }
    const parity = exec('node', ['scripts/parity.ts']);
    ok &&= parity.status === 0;
    results.push(`parity ${parity.status === 0 ? 'OK' : 'FAILED'}`);
  } finally {
    reset();
  }
  table.push(
    `| Cap stage ${stage} forced (\`maxClosureInputs: ${max}\`): edit a member test, a child-root file, a cross-project module | each selects the owning shard; siblings in the same ${stage === 2 ? 'directory' : 'root'} may join | misses equal the selection; coverage assertion passes; parity OK | ${results.join('<br>')} | | ${verdict(ok)} |`,
  );
}

// Unresolved static workspace import (DS4): the graph must fail and name it.
{
  console.error('unresolved import');
  try {
    writeFileSync(
      plain1,
      `require('@packages/project-001/missing');\n` + readFileSync(plain1, 'utf8'),
    );
    const result = exec('node_modules/.bin/nx', [
      'affected',
      '-t',
      'test-ci--01',
      `--files=${plain1}`,
      '--graph=stdout',
    ]);
    const run = exec('node_modules/.bin/nx', ['run-many', '-t', 'test-ci--01']);
    const output = result.stdout + result.stderr;
    const ok =
      result.status !== 0 &&
      run.status !== 0 &&
      output.includes(plain1) &&
      output.includes('@packages/project-001/missing');
    table.push(
      `| Unresolved static workspace import | graph fails naming the file and specifier; no green cached result | ${ok ? 'graph failed: `' + plain1 + ": '@packages/project-001/missing'`; affected and run-many exit nonzero" : 'did not fail as expected'} | | | ${verdict(ok)} |`,
    );
  } finally {
    reset();
  }
}

{
  console.error('parity');
  const parity = exec('node', ['scripts/parity.ts']);
  const lines = parity.stdout.trim().split('\n');
  const ok = parity.status === 0;
  table.push(
    `| Membership parity per config | union of shards equals \`jest --listTests\`, no duplicates; per-shard lists match \`--shard=k/shardCount\`; every config on disk produced shards | ${lines.filter((l) => l.startsWith('inventory')).join('')}; ${lines.length - 2} checks; ${lines.at(-1)} | | | ${verdict(ok)} |`,
  );
}

console.log(
  '| Change | Expected selection | Actual selection | Expected cache | Actual cache misses | Result |',
);
console.log('| --- | --- | --- | --- | --- | --- |');
for (const line of table) console.log(line);
