// Writes the synthetic workspace under packages/ from fixtures/topology.json.
// Usage: node scripts/generate-fixture.ts --preset smoke|full
// Everything under packages/ is replaced. Imports are synthetic: they follow the
// recorded project edges and a fixed within-project pattern, not real source.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

interface Topology {
  projects: { id: string; root: string; type: 'app' | 'lib' }[];
  edges: [string, string][];
  tests: { project: string; path: string; durationMs: number }[];
}

// Smoke keeps every project and edge but samples tests. project-001 sits
// exactly on a bucket boundary (100 tests / 25 per shard = 4 buckets), so one
// added test doubles its buckets; project-047 has room to add tests.
const SMOKE_SIZES: Record<string, number> = { 'project-001': 100, 'project-047': 60 };
const SMOKE_DEFAULT = 6;

const preset = process.argv[process.argv.indexOf('--preset') + 1];
if (preset !== 'smoke' && preset !== 'full') {
  console.error('usage: node scripts/generate-fixture.ts --preset smoke|full');
  process.exit(1);
}
const topology: Topology = JSON.parse(readFileSync('fixtures/topology.json', 'utf8'));

const testsOf = new Map<string, Topology['tests']>();
for (const test of topology.tests) {
  testsOf.set(test.project, [...(testsOf.get(test.project) ?? []), test]);
}
const rootOf = new Map(topology.projects.map((p) => [p.id, p.root]));
const upstreamOf = new Map<string, string[]>();
for (const [source, target] of topology.edges) {
  upstreamOf.set(source, [...(upstreamOf.get(source) ?? []), target]);
}

rmSync('packages', { recursive: true, force: true });
const write = (file: string, content: string) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
};
const rel = (from: string, to: string) => {
  const path = relative(dirname(from), to);
  return path.startsWith('.') ? path : './' + path;
};

let testCount = 0;
for (const project of topology.projects) {
  const { id, root } = project;
  const all = [...(testsOf.get(id) ?? [])].sort((a, b) => a.path.localeCompare(b.path));
  const tests = preset === 'full' ? all : sample(all, SMOKE_SIZES[id] ?? SMOKE_DEFAULT);
  testCount += tests.length;

  write(
    join(root, 'project.json'),
    JSON.stringify(
      { name: id, projectType: project.type === 'lib' ? 'library' : 'application' },
      null,
      2,
    ) + '\n',
  );
  write(
    join(root, 'package.json'),
    JSON.stringify({ name: `@fixture/${id}`, private: true }, null, 2) + '\n',
  );
  write(join(root, 'api/one.js'), `module.exports = { name: '${id}', one: () => 1 };\n`);
  write(join(root, 'api/two.js'), `module.exports = { two: () => 2 };\n`);
  write(
    join(root, 'index.js'),
    `module.exports = { ...require('./api/one'), ...require('./api/two') };\n`,
  );
  const deps = (upstreamOf.get(id) ?? []).map(
    (up) => `  require('${rel(join(root, 'deps.js'), join(rootOf.get(up)!, 'api/one.js'))}'),`,
  );
  write(
    join(root, 'deps.js'),
    `// One import per recorded project edge.\nmodule.exports = [\n${deps.join('\n')}\n];\n`,
  );
  if (tests.length === 0) continue;

  const nested = topology.projects.find((p) => p.root.startsWith(root + '/') && testsOf.has(p.id));
  if (nested) throw new Error(`${id} would need testPathIgnorePatterns for ${nested.root}`);
  const config = join(root, 'jest.config.js');
  write(join(root, 'api/__mocks__/two.js'), `module.exports = { two: () => 'mocked' };\n`);
  write(
    config,
    `module.exports = {\n` +
      `  displayName: '${id}',\n` +
      `  preset: '${rel(config, 'jest.preset.js')}',\n` +
      `  testSequencer: require.resolve('${rel(config, 'tools/jest-shards/sequencer.ts')}'),\n` +
      `};\n`,
  );

  tests.forEach((test, i) => {
    const file = join(root, test.path);
    const dir = dirname(file);
    const name = basename(file).replace(/\.test\.[jt]s$/, '');
    const typed = file.endsWith('.ts') ? ': string' : '';
    write(join(dir, 'shared.js'), `module.exports = { dir: '${relative(root, dir)}' };\n`);
    write(
      join(dir, `${name}.leaf.js`),
      `const shared = require('./shared');\nmodule.exports = { value: '${name}', shared };\n`,
    );
    // The first test of each project also goes through the project's barrel
    // (via the @packages alias), its mocked module, a snapshot and its edges.
    const entry = i === 0;
    write(
      file,
      (entry ? `jest.mock('${rel(file, join(root, 'api/two'))}');\n` : '') +
        `const leaf = require('./${name}.leaf');\n` +
        (entry ? `const api = require('@packages/${relative('packages', root)}');\n` : '') +
        (entry ? `const deps = require('${rel(file, join(root, 'deps'))}');\n` : '') +
        `\ntest('${name}', () => {\n` +
        `  const expected${typed} = '${name}';\n` +
        `  burn(${test.durationMs});\n` +
        `  expect(leaf.value).toBe(expected);\n` +
        (entry ? `  expect(api.two()).toBe('mocked');\n` : '') +
        (entry ? `  expect(deps).toHaveLength(${deps.length});\n` : '') +
        (entry ? `  expect(api.name).toMatchSnapshot();\n` : '') +
        `});\n`,
    );
    if (entry) {
      write(
        join(dir, '__snapshots__', `${basename(file)}.snap`),
        `// Jest Snapshot v1, https://goo.gl/fbAQLP\n\nexports[\`${name} 1\`] = \`"${id}"\`;\n`,
      );
    }
  });
}
console.log(
  `${preset}: ${topology.projects.length} projects, ${topology.edges.length} edges, ${testCount} tests`,
);

/** Evenly spaced, deterministic sample that keeps nested directories represented. */
function sample<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  return Array.from({ length: count }, (_, i) => items[Math.floor((i * items.length) / count)]);
}
