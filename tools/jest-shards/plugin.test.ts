import type { CreateNodesContext, TargetConfiguration } from '@nx/devkit';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { normalizeOptions, planShards, type ShardOptions } from './buckets.ts';
import { createNodes } from './plugin.ts';
import { classifyWorkspaceImport, workspaceOwnership } from './ownership.ts';
import StableShardSequencer from './sequencer.ts';

process.env.NX_DAEMON = 'false'; // the daemon's glob ignores these throwaway workspace roots

const WS = '{workspaceRoot}/';
const names = (n: number, prefix = 't') =>
  Array.from({ length: n }, (_, i) => `src/${prefix}${i}.test.js`);

describe('bucket policy', () => {
  const options = normalizeOptions();

  test('bucketCount is the smallest power of two keeping the target maximum average tests per bucket', () => {
    const count = (n: number) => planShards('p', names(n), options).bucketCount;
    assert.deepEqual(
      [count(1), count(25), count(26), count(50), count(100), count(101)],
      [1, 1, 2, 2, 4, 8],
    );
    const override = normalizeOptions({ overrides: { p: { testsPerShard: 10 } } });
    assert.equal(planShards('p', names(25), override).bucketCount, 4);
  });

  test('adding or deleting a test moves no other test while bucketCount is unchanged', () => {
    const base = planShards('p', names(60), options);
    const added = planShards('p', [...names(60), 'src/new.test.js'], options);
    const deleted = planShards('p', names(60).slice(1), options);
    assert.equal(added.bucketCount, base.bucketCount);
    for (const test of names(60)) assert.equal(added.shardOf.get(test), base.shardOf.get(test));
    for (const test of names(60).slice(1))
      assert.equal(deleted.shardOf.get(test), base.shardOf.get(test));
  });

  test('isolated tests take the shards after the buckets and do not count toward sizing', () => {
    const tests = names(26);
    const plan = planShards(
      'p',
      tests,
      normalizeOptions({ isolate: ['p/src/t7.test.js', 'p/src/t3.test.js'] }),
    );
    assert.equal(plan.bucketCount, 1);
    assert.equal(plan.shardCount, 3);
    assert.equal(plan.shardOf.get('src/t3.test.js'), 2);
    assert.equal(plan.shardOf.get('src/t7.test.js'), 3);
  });

  test('invalid sizes and caps fail', () => {
    assert.throws(
      () => normalizeOptions({ testsPerShard: -1 }),
      /testsPerShard must be a positive/,
    );
    assert.throws(() => normalizeOptions({ testsPerShard: 0 }), /testsPerShard must be a positive/);
    assert.throws(
      () => normalizeOptions({ overrides: { p: { testsPerShard: Infinity } } }),
      /overrides\.p\.testsPerShard must be a positive/,
    );
    assert.throws(() => normalizeOptions({ maxClosureInputs: 1.5 }), /nonnegative integer/);
    assert.throws(() => normalizeOptions({ maxClosureInputs: -1 }), /nonnegative integer/);
    assert.doesNotThrow(() => normalizeOptions({ maxClosureInputs: 0 }));
  });

  test('a duplicate isolate entry fails', () => {
    assert.throws(() => normalizeOptions({ isolate: ['a.test.js', 'a.test.js'] }), /twice/);
  });
});

// A throwaway workspace: `app` with a nested child root it owns tests under,
// `lib` imported across projects directly and through an alias, and a setup
// file whose helper no test imports.
const files: Record<string, string> = {
  'nx.json': JSON.stringify({
    plugins: [{ plugin: './tools/jest-shards/plugin.ts', options: {} }],
  }),
  'jest.preset.js': "module.exports = { testMatch: ['**/*.test.js'] };\n",
  'tools/setup.js': "require('./helper');\n",
  'tools/helper.js': 'module.exports = 1;\n',
  'packages/app/project.json': '{ "name": "app" }',
  'packages/app/package.json': '{ "name": "app" }',
  'packages/app/jest.config.js': "module.exports = { preset: '../../jest.preset.js' };\n",
  'packages/app/src/a.test.js': "require('./leaf-a');\n",
  'packages/app/src/leaf-a.js': "require('./leaf-a2');\nrequire('../../lib/src/util');\n",
  'packages/app/src/leaf-a2.js': '',
  'packages/app/src/b.test.js': "require('@lib/util');\n",
  'packages/app/src/odd (1).test.js': "require('./leaf-odd');\n",
  'packages/app/src/leaf-odd.js': '',
  'packages/app/src/x[1].test.js': '',
  'packages/app/child/project.json': '{ "name": "child" }',
  'packages/app/child/c.test.js': "require('./leaf-c');\n",
  'packages/app/child/leaf-c.js': '',
  'packages/lib/project.json': '{ "name": "lib" }',
  'packages/lib/jest.config.js': "module.exports = { preset: '../../jest.preset.js' };\n",
  'packages/lib/src/util.js': '',
  'packages/lib/src/util.test.js': "require('./util');\n",
};
const roots: string[] = [];
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

function workspace(overrides: Record<string, string | null> = {}): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'jest-shards-')));
  roots.push(root);
  for (const [file, content] of Object.entries({ ...files, ...overrides })) {
    if (content === null) continue;
    mkdirSync(join(root, dirname(file)), { recursive: true });
    writeFileSync(join(root, file), content);
  }
  return root;
}

const baseOptions: Partial<ShardOptions> = {
  testsPerShard: 1,
  sharedInputs: ['{workspaceRoot}/tools/setup.js', { env: 'WORK' }],
  resolve: { alias: { '@lib': 'packages/lib/src' } },
};

async function targets(root: string, options: Partial<ShardOptions> = {}) {
  const context = { workspaceRoot: root, nxJsonConfiguration: {} } as unknown as CreateNodesContext;
  const configs = ['packages/app/jest.config.js', 'packages/lib/jest.config.js'];
  // The stock plugin resolves test paths against the working directory.
  const cwd = process.cwd();
  process.chdir(root);
  let results;
  try {
    results = await createNodes[1](configs, { ...baseOptions, ...options }, context);
  } finally {
    process.chdir(cwd);
  }
  const byProject: Record<string, Record<string, TargetConfiguration>> = {};
  for (const [, result] of results) {
    for (const [projectRoot, project] of Object.entries(result.projects ?? {})) {
      byProject[projectRoot] = (
        project as { targets: Record<string, TargetConfiguration> }
      ).targets;
    }
  }
  return byProject;
}
/** The shard of `projectRoot` whose inputs list `file` exactly. */
function shardWith(
  byProject: Record<string, Record<string, TargetConfiguration>>,
  projectRoot: string,
  file: string,
) {
  const found = Object.values(byProject[projectRoot]).filter((t) => t.inputs!.includes(WS + file));
  assert.equal(found.length, 1, `${file} is a member of exactly one shard`);
  return found[0].inputs as unknown[];
}

describe('plugin', () => {
  test('shard inputs are members, snapshots, owner config, shared inputs and the import closure', async () => {
    const byProject = await targets(workspace());
    const a = shardWith(byProject, 'packages/app', 'packages/app/src/a.test.js');
    for (const input of [
      'packages/app/src/__snapshots__/a.test.js.snap',
      'packages/app/jest.config.js',
      'packages/app/package.json',
      'tools/setup.js',
      'tools/helper.js',
      'packages/app/src/leaf-a.js',
      'packages/lib/src/util.js',
    ]) {
      assert.ok(a.includes(WS + input), input);
    }
    assert.ok(a.some((i) => typeof i === 'object' && (i as { env: string }).env === 'WORK'));
    assert.ok(!a.includes(WS + 'packages/app/src/b.test.js'), 'no other member');
    assert.ok(!a.includes(WS + 'packages/app/src/leaf-odd.js'), "no other member's closure");

    const b = shardWith(byProject, 'packages/app', 'packages/app/src/b.test.js');
    assert.ok(b.includes(WS + 'packages/lib/src/util.js'), 'alias resolved like moduleNameMapper');

    const c = shardWith(byProject, 'packages/app', 'packages/app/child/c.test.js');
    assert.ok(
      c.includes(WS + 'packages/app/child/leaf-c.js'),
      'parent-owned test under a nested root',
    );

    const command = Object.values(byProject['packages/lib'])[0].options.command;
    assert.match(command, /^jest -c jest\.config\.js --shard=1\/1 /);
  });

  test('paths are escaped for Nx globs', async () => {
    const byProject = await targets(workspace());
    shardWith(byProject, 'packages/app', 'packages/app/src/odd ?1?.test.js');
    shardWith(byProject, 'packages/app', 'packages/app/src/x\\[1\\].test.js');
  });

  test('the cap widens the closure to directory, then project-root globs', async () => {
    const root = workspace();
    const stage2 = shardWith(
      await targets(root, { maxClosureInputs: 2 }),
      'packages/app',
      'packages/app/src/a.test.js',
    );
    assert.ok(
      stage2.includes(WS + 'packages/app/src/*') && stage2.includes(WS + 'packages/lib/src/*'),
    );
    const stage3 = shardWith(
      await targets(root, { maxClosureInputs: 1 }),
      'packages/app',
      'packages/app/src/a.test.js',
    );
    assert.ok(
      stage3.includes(WS + 'packages/app/**/*') && stage3.includes(WS + 'packages/lib/**/*'),
    );
    assert.ok(stage3.includes(WS + 'tools/helper.js'), 'shared closure is never capped');
    const c = shardWith(
      await targets(root, { maxClosureInputs: 0 }),
      'packages/app',
      'packages/app/child/c.test.js',
    );
    assert.ok(c.includes(WS + 'packages/app/child/**/*'), 'a child-root file keeps its own root');
  });

  test('an unresolved static workspace import fails the graph, naming file and specifier', async () => {
    const root = workspace({ 'packages/app/src/a.test.js': "require('./missing');\n" });
    await assert.rejects(targets(root), /packages\/app\/src\/a\.test\.js: '\.\/missing'/);
  });

  test('an unresolved package under an existing workspace scope fails without an alias', async () => {
    const root = workspace({
      'packages/app/src/a.test.js': "require('@acme/undeclared');\n",
      'packages/no-tests/package.json': '{ "name": "@acme/no-tests" }',
    });
    await assert.rejects(targets(root), /@acme\/undeclared/);
  });

  test('an unresolved unscoped local package with no tests fails', async () => {
    const root = workspace({
      'packages/app/src/a.test.js': "require('local-util');\n",
      'packages/no-tests/package.json': '{ "name": "local-util", "main": "missing.js" }',
    });
    await assert.rejects(targets(root), /local-util.*workspace-package/);
  });

  test('an unresolved subpath of a nested local package fails', async () => {
    const root = workspace({
      'packages/app/src/a.test.js': "require('local-util/missing');\n",
      'packages/app/child/package.json': '{ "name": "local-util" }',
    });
    await assert.rejects(targets(root), /local-util\/missing.*workspace-package/);
  });

  test('a nonexistent package inside a local scope names project, importer, specifier and classification', async () => {
    const root = workspace({
      'packages/app/src/leaf-a.js': "require('@acme/typo');\n",
      'packages/app/child/package.json': '{ "name": "@acme/child" }',
    });
    await assert.rejects(
      targets(root),
      /project\/config packages\/app \(packages\/app\/jest.config.js\): packages\/app\/src\/leaf-a.js: '@acme\/typo' \(workspace-scope\)/,
    );
  });

  test('a third-party package sharing a local scope resolves from node_modules', async () => {
    const root = workspace({
      'packages/app/src/a.test.js': "require('@acme/published');\n",
      'packages/no-tests/package.json': '{ "name": "@acme/local" }',
      'node_modules/@acme/published/package.json':
        '{ "name": "@acme/published", "main": "index.js" }',
      'node_modules/@acme/published/index.js': "require('./external');\n",
    });
    const a = shardWith(await targets(root), 'packages/app', 'packages/app/src/a.test.js');
    assert.ok(!a.some((i) => typeof i === 'string' && i.includes('node_modules/')));
    const ownership = workspaceOwnership(root);
    assert.ok(!ownership.packages.has('@acme/published'));
  });

  test('a mapped mock of an undeclared workspace-scoped package succeeds', async () => {
    const root = workspace({
      'packages/app/src/a.test.js': "require('@acme/virtual');\n",
      'packages/no-tests/package.json': '{ "name": "@acme/local" }',
      'tools/mocks/virtual.js': "require('./helper');\n",
      'tools/mocks/helper.js': '',
    });
    const byProject = await targets(root, {
      resolve: { alias: { '@lib': 'packages/lib/src', '@acme/virtual': 'tools/mocks/virtual.js' } },
    });
    const a = shardWith(byProject, 'packages/app', 'packages/app/src/a.test.js');
    assert.ok(a.includes(WS + 'tools/mocks/virtual.js'));
    assert.ok(a.includes(WS + 'tools/mocks/helper.js'));
  });

  test('a workspace package reached through a node_modules symlink stays in the closure', async () => {
    const root = workspace({
      'packages/app/src/a.test.js': "require('@acme/local');\n",
      'packages/no-tests/package.json': '{ "name": "@acme/local", "main": "index.js" }',
      'packages/no-tests/index.js': "require('./helper');\n",
      'packages/no-tests/helper.js': '',
    });
    mkdirSync(join(root, 'node_modules/@acme'), { recursive: true });
    symlinkSync(join(root, 'packages/no-tests'), join(root, 'node_modules/@acme/local'), 'dir');
    const a = shardWith(await targets(root), 'packages/app', 'packages/app/src/a.test.js');
    assert.ok(a.includes(WS + 'packages/no-tests/index.js'));
    assert.ok(a.includes(WS + 'packages/no-tests/helper.js'));
  });

  test('an absent shared graph entrypoint fails before target creation', async () => {
    await assert.rejects(
      targets(workspace(), { sharedInputs: ['{workspaceRoot}/tools/missing.js'] }),
      /shared input tools\/missing.js.*'tools\/missing.js' \(graph-entrypoint\)/,
    );
  });

  test('a traversed workspace file removed after a warm inference fails', async () => {
    const root = workspace();
    await targets(root);
    rmSync(join(root, 'packages/app/src/leaf-a2.js'));
    await assert.rejects(targets(root), /leaf-a.js: '\.\/leaf-a2' \(relative\)/);
  });

  test('manifest additions and deletions invalidate warm workspace ownership', async () => {
    const root = workspace({ 'packages/app/src/a.test.js': "require('@acme/unknown');\n" });
    await targets(root);
    mkdirSync(join(root, 'packages/no-tests'), { recursive: true });
    writeFileSync(join(root, 'packages/no-tests/package.json'), '{ "name": "@acme/local" }');
    await assert.rejects(targets(root), /@acme\/unknown.*workspace-scope/);
    rmSync(join(root, 'packages/no-tests'), { recursive: true });
    await targets(root);
  });

  test('manifest main changes invalidate warm symlink resolution', async () => {
    const root = workspace({
      'packages/app/src/a.test.js': "require('local-util');\n",
      'packages/no-tests/package.json': '{ "name": "local-util", "main": "index.js" }',
      'packages/no-tests/index.js': '',
      'packages/no-tests/other.js': '',
    });
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    symlinkSync(join(root, 'packages/no-tests'), join(root, 'node_modules/local-util'), 'dir');
    await targets(root);
    writeFileSync(
      join(root, 'packages/no-tests/package.json'),
      '{ "name": "local-util", "main": "other.js" }',
    );
    const a = shardWith(await targets(root), 'packages/app', 'packages/app/src/a.test.js');
    assert.ok(a.includes(WS + 'packages/no-tests/other.js'));
    assert.ok(!a.includes(WS + 'packages/no-tests/index.js'));
  });

  test('a failed mapper is rejected even for an otherwise external name', async () => {
    const root = workspace({ 'packages/app/src/a.test.js': "require('virtual-mock');\n" });
    await assert.rejects(
      targets(root, {
        resolve: { alias: { '@lib': 'packages/lib/src', 'virtual-mock': 'tools/missing.js' } },
      }),
      /virtual-mock.*alias-owned/,
    );
  });

  test('resolution option changes invalidate a warm closure', async () => {
    const root = workspace({ 'packages/lib/other.js': '' });
    await targets(root);
    const byProject = await targets(root, {
      resolve: { alias: { '@lib/util': 'packages/lib/other.js' } },
    });
    const b = shardWith(byProject, 'packages/app', 'packages/app/src/b.test.js');
    assert.ok(b.includes(WS + 'packages/lib/other.js'));
    assert.ok(!b.includes(WS + 'packages/lib/src/util.js'));
  });

  test('malformed workspace manifests fail inventory', async () => {
    await assert.rejects(
      targets(workspace({ 'packages/no-tests/package.json': '{' })),
      /invalid workspace manifest packages\/no-tests\/package.json/,
    );
  });

  test('malformed resolution config fails graph construction', async () => {
    await assert.rejects(
      targets(workspace({ 'tsconfig.json': '{' }), { resolve: { tsConfig: 'tsconfig.json' } }),
    );
  });

  test('classification uses manifest names, subpaths, scopes and configured prefixes independently', () => {
    const ownership = workspaceOwnership(
      workspace({
        'packages/no-tests/package.json': '{ "name": "@acme/local" }',
        'packages/app/child/package.json': '{ "name": "nested-local" }',
      }),
    );
    assert.equal(ownership.packages.get('nested-local'), 'packages/app/child');
    for (const [specifier, expected] of [
      ['@acme/local', 'workspace-package'],
      ['@acme/local/subpath', 'workspace-package'],
      ['nested-local/subpath', 'workspace-package'],
      ['@acme/typo', 'workspace-scope'],
      ['@alias/path', 'alias-owned'],
      ['./file', 'relative'],
      ['/file', 'absolute'],
      ['@other/external', undefined],
      ['nested-local-other', undefined],
    ])
      assert.equal(classifyWorkspaceImport(specifier!, ownership, ['@alias/']), expected);
  });

  test('a test importing a test fails', async () => {
    const root = workspace({ 'packages/app/src/a.test.js': "require('./b.test.js');\n" });
    await assert.rejects(targets(root), /imports the test packages\/app\/src\/b\.test\.js/);
  });

  test('an isolate entry Jest does not discover fails', async () => {
    await assert.rejects(
      targets(workspace(), { isolate: ['packages/app/src/gone.test.js'] }),
      /gone\.test\.js/,
    );
  });
});

describe('sequencer', () => {
  test('keeps shard k of the plan and rejects a stale shard count', () => {
    const root = workspace();
    const rootDir = join(root, 'packages/lib');
    const tests = names(30).map((path) => ({
      path: join(rootDir, path),
      context: { config: { rootDir } },
    }));
    const plan = planShards('packages/lib', names(30), normalizeOptions());
    const sequencer = new StableShardSequencer();
    const shard = (shardIndex: number, shardCount: number) =>
      sequencer.shard(tests as never, { shardIndex, shardCount }).map((t) => t.path);
    const union = [1, 2].flatMap((k) => shard(k, plan.shardCount));
    assert.equal(plan.shardCount, 2);
    assert.deepEqual(union.sort(), tests.map((t) => t.path).sort());
    assert.throws(() => shard(1, 4), /2 shards, but Jest was given --shard=1\/4/);
  });
});
