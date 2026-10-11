import type { CreateNodesContext, TargetConfiguration } from '@nx/devkit';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { resetWorkspaceContext } from 'nx/src/devkit-internals.js';
import { normalizeOptions, planShards, type ShardOptions } from './buckets.ts';
import { JestProjects } from './jest-context.ts';
import { createNodes } from './plugin.ts';
import { classifyWorkspaceImport, hashableFiles, workspaceOwnership } from './ownership.ts';
import StableShardSequencer from './sequencer.ts';

process.env.NX_DAEMON = 'false'; // the daemon's glob ignores these throwaway workspace roots

const WS = '{workspaceRoot}/';
const require = createRequire(import.meta.url);
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
  'jest.preset.js':
    "module.exports = { testMatch: ['**/*.test.js'], setupFiles: [__dirname + '/tools/setup.js'], " +
    "moduleNameMapper: { '^@lib/(.*)$': __dirname + '/packages/lib/src/$1' } };\n",
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

/** Links a workspace package into the root `node_modules`, as a package manager does. */
function link(root: string, name: string, target: string) {
  mkdirSync(dirname(join(root, 'node_modules', name)), { recursive: true });
  symlinkSync(join(root, target), join(root, 'node_modules', name));
}

const baseOptions: Partial<ShardOptions> = {
  testsPerShard: 1,
  sharedInputs: [{ env: 'WORK' }],
};

/** Nx starts each command from the files on disk; so does each build here. */
async function ownership(root: string) {
  resetWorkspaceContext();
  return workspaceOwnership(root, await hashableFiles(root));
}

const withMapper = (mapper: Record<string, string>) =>
  `module.exports = { preset: '../../jest.preset.js', moduleNameMapper: ${JSON.stringify(mapper)} };\n`;

function commit(root: string) {
  for (const args of [
    ['init', '-q'],
    ['add', '.'],
    [
      '-c',
      'user.name=fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-qm',
      'Fixture',
    ],
  ]) {
    execFileSync('git', args, { cwd: root });
  }
}

async function targets(root: string, options: Partial<ShardOptions> = {}) {
  resetWorkspaceContext();
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
    assert.ok(b.includes(WS + 'packages/lib/src/util.js'), 'resolved by moduleNameMapper');

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

  test('a workspace import Jest cannot resolve fails the graph with what Jest said', async () => {
    const relative = workspace({ 'packages/app/src/a.test.js': "require('./missing');\n" });
    await assert.rejects(
      targets(relative),
      /project\/config packages\/app \(packages\/app\/jest\.config\.js\): packages\/app\/src\/a\.test\.js: '\.\/missing' \(relative\): Cannot find module/,
    );
    // A name no workspace package, scope or mapper claims is third-party code
    // that is not installed: the lockfile changes when it is.
    await targets(workspace({ 'packages/lib/src/util.js': "require('not-installed');\n" }));
  });

  test('one shared file resolves per project, and a mapped file brings its own imports', async () => {
    const mapper = (target: string) =>
      `module.exports = { preset: '../../jest.preset.js', moduleNameMapper: { '^@acme/thing$': '<rootDir>/${target}' } };\n`;
    const byProject = await targets(
      workspace({
        'shared/uses-thing.js': "require('@acme/thing');\n",
        'packages/app/jest.config.js': mapper('src/thing.js'),
        'packages/app/src/a.test.js': "require('../../../shared/uses-thing');\n",
        'packages/app/src/thing.js': "require('./thing-dep');\n",
        'packages/app/src/thing-dep.js': '',
        'packages/lib/jest.config.js': mapper('src/other-thing.js'),
        'packages/lib/src/util.test.js': "require('../../../shared/uses-thing');\n",
        'packages/lib/src/other-thing.js': '',
      }),
    );
    const app = shardWith(byProject, 'packages/app', 'packages/app/src/a.test.js');
    const lib = shardWith(byProject, 'packages/lib', 'packages/lib/src/util.test.js');
    for (const inputs of [app, lib]) assert.ok(inputs.includes(WS + 'shared/uses-thing.js'));
    assert.ok(app.includes(WS + 'packages/app/src/thing.js'));
    assert.ok(app.includes(WS + 'packages/app/src/thing-dep.js'), "the mapped file's own import");
    assert.ok(!app.includes(WS + 'packages/lib/src/other-thing.js'));
    assert.ok(lib.includes(WS + 'packages/lib/src/other-thing.js'));
    assert.ok(!lib.includes(WS + 'packages/app/src/thing.js'));
  });

  test('what a config loads is an input of its own project only', async () => {
    const byProject = await targets(
      workspace({
        'packages/lib/jest.config.js':
          "module.exports = { ...require('./jest.base'), transform: { '\\\\.js$': '<rootDir>/transform.js' } };\n",
        'packages/lib/jest.base.js': "module.exports = { preset: '../../jest.preset.js' };\n",
        'packages/lib/transform.js':
          "require('./transform-helper');\nmodule.exports = { process: (code) => ({ code }) };\n",
        'packages/lib/transform-helper.js': '',
      }),
    );
    const lib = shardWith(byProject, 'packages/lib', 'packages/lib/src/util.test.js');
    const app = shardWith(byProject, 'packages/app', 'packages/app/src/a.test.js');
    for (const file of ['jest.base.js', 'transform.js', 'transform-helper.js']) {
      assert.ok(lib.includes(WS + 'packages/lib/' + file), file);
      assert.ok(!app.includes(WS + 'packages/lib/' + file), `${file} is not an input of app`);
    }
    for (const inputs of [lib, app]) assert.ok(inputs.includes(WS + 'jest.preset.js'), 'preset');
  });

  test('a second build in the same process sees what changed on disk', async () => {
    const root = workspace({
      'packages/app/jest.config.js':
        "module.exports = { preset: '../../jest.preset.js', moduleNameMapper: " +
        "{ '^@acme/first$': ['<rootDir>/src/preferred.js', '<rootDir>/src/fallback.js'] } };\n",
      'packages/app/src/a.test.js': "require('@acme/pkg');\nrequire('@acme/first');\n",
      'packages/app/src/fallback.js': '',
      'packages/pkg/package.json': '{ "name": "@acme/pkg", "main": "a.js" }',
      'packages/pkg/a.js': '',
      'packages/pkg/b.js': '',
    });
    link(root, '@acme/pkg', 'packages/pkg');
    const test = 'packages/app/src/a.test.js';
    const before = shardWith(await targets(root), 'packages/app', test);
    assert.ok(before.includes(WS + 'packages/pkg/a.js'));
    assert.ok(before.includes(WS + 'packages/app/src/fallback.js'));

    writeFileSync(
      join(root, 'packages/pkg/package.json'),
      '{ "name": "@acme/pkg", "main": "b.js" }',
    );
    writeFileSync(join(root, 'packages/app/src/preferred.js'), '');
    const after = shardWith(await targets(root), 'packages/app', test);
    assert.ok(after.includes(WS + 'packages/pkg/b.js'), 'the new `main`');
    assert.ok(!after.includes(WS + 'packages/pkg/a.js'), 'the old `main`');
    assert.ok(after.includes(WS + 'packages/app/src/preferred.js'), 'the earlier replacement');
    assert.ok(!after.includes(WS + 'packages/app/src/fallback.js'), 'the later replacement');
  });

  test('a package with import and require exports gives both to what Node loads', async () => {
    const root = workspace({
      'packages/lib/jest.config.js':
        "require('@acme/dual');\nmodule.exports = { preset: '../../jest.preset.js', " +
        "transform: { '\\\\.js$': '<rootDir>/transform.js' } };\n",
      'packages/lib/transform.js':
        "require('@acme/dual/tool');\nmodule.exports = { process: (code) => ({ code }) };\n",
      'packages/dual/package.json': JSON.stringify({
        name: '@acme/dual',
        exports: {
          '.': { import: './index.mjs', require: './index.cjs' },
          './tool': { import: './tool.mjs', require: './tool.cjs' },
        },
      }),
      'packages/dual/index.mjs': '',
      'packages/dual/index.cjs': "require('./cjs-only.cjs');\n",
      'packages/dual/cjs-only.cjs': '',
      'packages/dual/tool.mjs': '',
      'packages/dual/tool.cjs': '',
    });
    link(root, '@acme/dual', 'packages/dual');
    const byProject = await targets(root);
    const lib = shardWith(byProject, 'packages/lib', 'packages/lib/src/util.test.js');
    const app = shardWith(byProject, 'packages/app', 'packages/app/src/a.test.js');
    for (const file of ['index.mjs', 'index.cjs', 'cjs-only.cjs', 'tool.mjs', 'tool.cjs']) {
      assert.ok(lib.includes(WS + 'packages/dual/' + file), file);
      assert.ok(!app.includes(WS + 'packages/dual/' + file), `${file} is not an input of app`);
    }
  });

  test('a file Nx does not hash fails the graph, whether imported or loaded by the config', async () => {
    const setup = {
      'packages/lib/jest.config.js':
        "module.exports = { preset: '../../jest.preset.js', setupFiles: ['<rootDir>/local/setup.js'] };\n",
      'packages/lib/local/setup.js': 'global.x = 1;\n',
    };
    const imported = {
      'packages/lib/src/util.js': "require('../local/built');\n",
      'packages/lib/local/built.js': '',
    };
    const unhashed = (file: string) =>
      new RegExp(`packages/lib/local/${file} is loaded or imported, but Nx does not hash it`);
    // A setup file with no imports: nothing reaches it, it is only a root.
    for (const [overrides, pattern] of [
      [setup, unhashed('setup\\.js')],
      [imported, unhashed('built\\.js')],
    ] as const) {
      const ignoring: Record<string, string>[] = [
        { '.gitignore': 'local/\n' },
        { '.nxignore': 'packages/lib/local\n' },
        { 'packages/lib/.gitignore': '/local/*.js\n' },
      ];
      for (const rules of ignoring) {
        await assert.rejects(targets(workspace({ ...rules, ...overrides })), pattern);
      }
      // Git still tracks a file committed before a rule matched it; Nx leaves it out all the same.
      const tracked = workspace(overrides);
      commit(tracked);
      await targets(tracked);
      writeFileSync(join(tracked, '.gitignore'), 'local/\n');
      assert.match(
        execFileSync('git', ['ls-files', 'packages/lib/local'], { cwd: tracked, encoding: 'utf8' }),
        /packages\/lib\/local\//,
      );
      await assert.rejects(targets(tracked), pattern);
    }
    await targets(workspace({ '.gitignore': 'local/\n', '.nxignore': 'elsewhere\n' }));
  });

  test('a config is evaluated once per load', async () => {
    const root = workspace({
      'packages/lib/jest.config.js':
        "module.exports = async () => {\n  require('node:fs').appendFileSync(__dirname + '/calls', 'x');\n" +
        "  return { preset: '../../jest.preset.js' };\n};\n",
    });
    const project = await new JestProjects(root).load('packages/lib/jest.config.js');
    assert.equal(readFileSync(join(root, 'packages/lib/calls'), 'utf8'), 'x');
    assert.equal(project.rootDir, join(root, 'packages/lib'));
    assert.deepEqual(project.jestLoaded, ['tools/setup.js'], 'the preset still applies');
  });

  test('config cache eviction preserves unrelated module state and reloads changed helpers', async () => {
    const root = workspace({
      'tools/state.cjs': 'module.exports = { value: 0 };\n',
      'packages/app/config-helper.cjs': "module.exports = './leaf-a2';\n",
      'packages/app/jest.config.js':
        "module.exports = { preset: '../../jest.preset.js', moduleNameMapper: { '^local$': '<rootDir>/src/' + require('./config-helper.cjs') } };\n",
      'packages/app/src/a.test.js': "require('local');\n",
    });
    const state = require(join(root, 'tools/state.cjs'));
    state.value = 7;
    const first = shardWith(await targets(root), 'packages/app', 'packages/app/src/a.test.js');
    assert.ok(first.includes(WS + 'packages/app/src/leaf-a2.js'));
    writeFileSync(join(root, 'packages/app/config-helper.cjs'), "module.exports = './leaf-odd';\n");
    const second = shardWith(await targets(root), 'packages/app', 'packages/app/src/a.test.js');
    assert.ok(second.includes(WS + 'packages/app/src/leaf-odd.js'));
    assert.ok(!second.includes(WS + 'packages/app/src/leaf-a2.js'));
    assert.equal(require(join(root, 'tools/state.cjs')), state);
    assert.equal(require(join(root, 'tools/state.cjs')).value, 7);
  });

  test('workspace reporters and results processors are project-shared inputs', async () => {
    const root = workspace({
      'packages/app/jest.config.js':
        "module.exports = { preset: '../../jest.preset.js', reporters: ['default', 'summary', 'github-actions', ['<rootDir>/reporter.cjs', {}], 'external-reporter'], testResultsProcessor: '<rootDir>/processor.cjs' };\n",
      'packages/app/reporter.cjs': "require('./reporter-helper.cjs'); module.exports = class {};\n",
      'packages/app/reporter-helper.cjs': 'module.exports = 1;\n',
      'packages/app/processor.cjs': "require('./processor-helper.cjs'); module.exports = r => r;\n",
      'packages/app/processor-helper.cjs': 'module.exports = 1;\n',
      'node_modules/external-reporter/package.json': '{ "main": "index.cjs" }',
      'node_modules/external-reporter/index.cjs': 'module.exports = class {};\n',
    });
    const project = await new JestProjects(root).load('packages/app/jest.config.js');
    assert.ok(project.nodeLoaded.includes('packages/app/reporter.cjs'));
    assert.ok(project.nodeLoaded.includes('packages/app/processor.cjs'));
    assert.ok(project.nodeLoaded.every((file) => !file.includes('node_modules')));
    for (const builtin of ['default', 'summary', 'github-actions']) {
      assert.ok(!project.nodeLoaded.includes(builtin));
    }
    const byProject = await targets(root);
    for (const file of [
      'reporter.cjs',
      'reporter-helper.cjs',
      'processor.cjs',
      'processor-helper.cjs',
    ]) {
      for (const target of Object.values(byProject['packages/app'])) {
        assert.ok(target.inputs!.includes(WS + 'packages/app/' + file), file);
      }
      for (const target of Object.values(byProject['packages/lib'])) {
        assert.ok(!target.inputs!.includes(WS + 'packages/app/' + file), file);
      }
    }
  });

  test('unknown plugin options fail graph construction with the allowed keys', async () => {
    for (const key of ['resolve', 'testsPerShar']) {
      await assert.rejects(targets(workspace(), { [key]: {} }), (error: Error) => {
        assert.match(error.message, new RegExp(`unknown option '${key}'`));
        assert.match(
          error.message,
          /allowed keys: testsPerShard, overrides, isolate, sharedInputs, maxClosureInputs/,
        );
        return true;
      });
    }
    await targets(workspace(), {
      testsPerShard: 1,
      overrides: { 'packages/app': { testsPerShard: 2, maxClosureInputs: 100 } },
      isolate: ['packages/app/src/a.test.js'],
      sharedInputs: [{ env: 'WORK' }],
      maxClosureInputs: 1000,
    });
  });

  test('an environment with unknown export conditions fails unless the config declares them', async () => {
    const config = (extra: string) =>
      `module.exports = { preset: '../../jest.preset.js', testEnvironment: '<rootDir>/env.js'${extra} };\n`;
    const env = 'module.exports = class {};\n';
    await assert.rejects(
      targets(workspace({ 'packages/lib/jest.config.js': config(''), 'packages/lib/env.js': env })),
      /packages\/lib\/jest\.config\.js: cannot tell which package export conditions/,
    );
    const byProject = await targets(
      workspace({
        'packages/lib/jest.config.js': config(
          ", testEnvironmentOptions: { customExportConditions: ['node'] }",
        ),
        'packages/lib/env.js': env,
      }),
    );
    const lib = shardWith(byProject, 'packages/lib', 'packages/lib/src/util.test.js');
    assert.ok(lib.includes(WS + 'packages/lib/env.js'), 'the environment is a project input');
  });

  test('a rootDir outside the project fails the graph', async () => {
    const root = workspace({
      'packages/lib/jest.config.js':
        "module.exports = { rootDir: '../app', preset: '../../jest.preset.js' };\n",
    });
    await assert.rejects(targets(root), /packages\/lib\/jest\.config\.js sets rootDir/);
  });

  test('all unresolved imports across roots are reported together with the resolver hint', async () => {
    const root = workspace({
      'packages/app/src/a.test.js': "require('./missing-a');\nrequire('@acme/typo');\n",
      'packages/lib/src/util.test.js': "require('./missing-b');\n",
      'packages/no-tests/package.json': '{ "name": "@acme/local" }',
    });
    await assert.rejects(targets(root), (error: Error) => {
      for (const message of [
        "a.test.js: './missing-a' (relative)",
        "a.test.js: '@acme/typo' (workspace-scope)",
        "util.test.js: './missing-b' (relative)",
        'project/config packages/app (packages/app/jest.config.js)',
        'project/config packages/lib (packages/lib/jest.config.js)',
        "fix the import or the project's moduleNameMapper",
      ])
        assert.ok(error.message.includes(message), message);
      return true;
    });
  });

  test('ignored build outputs, coverage and checkout copies do not enter workspace inventory', async () => {
    const root = workspace({
      '.gitignore': 'node_modules\n.nx\ndist/\ncoverage/\n.sandbox/worktrees/\n',
      'dist/package.json': '{ "name": "app" }',
      'coverage/package.json': '{ "name": "app" }',
      '.sandbox/worktrees/copy/packages/app/package.json': '{ "name": "app" }',
      'node_modules/external/package.json': '{',
      '.nx/cache/package.json': '{',
    });
    assert.deepEqual([...(await ownership(root)).packages], [['app', 'packages/app']]);
    await targets(root);
  });

  test('nested Git repositories and worktrees are excluded by their Git marker', async () => {
    const root = workspace({
      '.sandbox/worktrees/copy/.git': 'gitdir: /unused/path\n',
      '.sandbox/worktrees/copy/packages/app/package.json': '{ "name": "app" }',
      'checkouts/copy/.git/config': '',
      'checkouts/copy/package.json': '{',
    });
    assert.deepEqual([...(await ownership(root)).packages], [['app', 'packages/app']]);
    await targets(root);
  });

  test('nested ignore rules exclude invalid fixtures and honor manifest negations', async () => {
    const root = workspace({
      'packages/no-tests/.gitignore': 'fixtures/\n*.json\n!package.json\n',
      'packages/no-tests/package.json': '{ "name": "@acme/local" }',
      'packages/no-tests/fixtures/package.json': '{',
      '.nxignore': 'tools/fixtures/\n',
      'tools/fixtures/package.json': '{',
    });
    assert.equal((await ownership(root)).packages.get('@acme/local'), 'packages/no-tests');
    await targets(root);
  });

  test('duplicate source package names report both manifest paths', async () => {
    const root = workspace({ 'packages/copy/package.json': '{ "name": "app" }' });
    await assert.rejects(
      () => ownership(root),
      (error: Error) => {
        for (const message of [
          "duplicate workspace package 'app'",
          'packages/app/package.json',
          'packages/copy/package.json',
        ])
          assert.ok(error.message.includes(message), message);
        return true;
      },
    );
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
    assert.ok(!(await ownership(root)).packages.has('@acme/published'));
  });

  test('a mapped mock of an undeclared workspace-scoped package succeeds', async () => {
    const root = workspace({
      'packages/app/src/a.test.js': "require('@acme/virtual');\n",
      'packages/no-tests/package.json': '{ "name": "@acme/local" }',
      'packages/app/jest.config.js': withMapper({
        '^@acme/virtual$': '<rootDir>/../../tools/mocks/virtual.js',
      }),
      'tools/mocks/virtual.js': "require('./helper');\n",
      'tools/mocks/helper.js': '',
    });
    const byProject = await targets(root);
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

  test('a package linked to a directory outside the workspace fails, whatever its name', async () => {
    const offsite = realpathSync(mkdtempSync(join(tmpdir(), 'jest-shards-offsite-')));
    roots.push(offsite);
    writeFileSync(join(offsite, 'package.json'), '{ "main": "index.js" }');
    writeFileSync(join(offsite, 'index.js'), 'module.exports = 1;\n');
    const escaped = offsite.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Neither name is a workspace package, and `@other` is not a workspace scope.
    for (const name of ['offsite-util', '@other/offsite']) {
      const root = workspace({ 'packages/app/src/a.test.js': `require('${name}');\n` });
      mkdirSync(dirname(join(root, 'node_modules', name)), { recursive: true });
      symlinkSync(offsite, join(root, 'node_modules', name), 'dir');
      await assert.rejects(
        targets(root),
        new RegExp(
          `project/config packages/app \\(packages/app/jest.config.js\\): packages/app/src/a.test.js: ` +
            `'${name}' \\(unhashable\\): resolves to ${escaped}/index.js, outside the workspace`,
        ),
      );
    }
    // The same name with nothing installed is an optional external, as before.
    await targets(workspace({ 'packages/app/src/a.test.js': "require('offsite-util');\n" }));
    // What the config loads is held to the same rule.
    writeFileSync(join(offsite, 'setup.js'), 'global.x = 1;\n');
    await assert.rejects(
      targets(
        workspace({
          'packages/lib/jest.config.js': `module.exports = { preset: '../../jest.preset.js', setupFiles: [${JSON.stringify(join(offsite, 'setup.js'))}] };\n`,
        }),
      ),
      new RegExp(`packages/lib/jest.config.js: loads ${escaped}/setup.js: .*outside the workspace`),
    );
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

  test('a Git workspace sees warm source deletion and manifest inventory changes', async () => {
    const root = workspace({ '.gitignore': '.nx\nnode_modules\n' });
    commit(root);
    await targets(root);
    rmSync(join(root, 'packages/app/src/leaf-a2.js'));
    await assert.rejects(targets(root), /leaf-a.js: '\.\/leaf-a2' \(relative\)/);
    writeFileSync(join(root, 'packages/app/src/leaf-a2.js'), '');
    writeFileSync(join(root, 'packages/app/src/a.test.js'), "require('@acme/unknown');\n");
    await targets(root);
    mkdirSync(join(root, 'packages/no-tests'), { recursive: true });
    writeFileSync(join(root, 'packages/no-tests/package.json'), '{ "name": "@acme/local" }');
    await assert.rejects(targets(root), /@acme\/unknown.*workspace-scope/);
  });

  test('ignore-file edits update ownership after warm inference', async () => {
    const root = workspace({
      '.gitignore': 'packages/no-tests/\n',
      'packages/no-tests/package.json': '{ "name": "@acme/local" }',
      'packages/app/src/a.test.js': "require('@acme/unknown');\n",
    });
    await targets(root);
    writeFileSync(join(root, '.gitignore'), '');
    await assert.rejects(targets(root), /@acme\/unknown.*workspace-scope/);
    writeFileSync(join(root, '.gitignore'), 'packages/no-tests/\n');
    await targets(root);
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
    const root = workspace({
      'packages/app/src/a.test.js': "require('virtual-mock');\n",
      'packages/app/jest.config.js': withMapper({
        '^virtual-mock$': '<rootDir>/../../tools/missing.js',
      }),
    });
    await assert.rejects(
      targets(root),
      /virtual-mock' \(mapper-owned\): .*Could not locate module/,
    );
  });

  test('a mapper change recomputes a warm closure', async () => {
    const root = workspace({ 'packages/lib/other.js': '' });
    await targets(root);
    writeFileSync(
      join(root, 'packages/app/jest.config.js'),
      withMapper({ '^@lib/util$': '<rootDir>/../lib/other.js' }),
    );
    const byProject = await targets(root);
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

  test('a malformed Jest config fails graph construction', async () => {
    await assert.rejects(
      targets(workspace({ 'packages/lib/jest.config.js': 'module.exports = {' })),
    );
  });

  test('a manifest that is not an object fails inventory with its path', async () => {
    await assert.rejects(
      targets(workspace({ 'packages/no-tests/package.json': 'null' })),
      /invalid workspace manifest packages\/no-tests\/package.json/,
    );
  });

  test('a package linked after a failed build resolves on the next one', async () => {
    const root = workspace({
      'packages/app/src/a.test.js': "require('@acme/local');\n",
      'packages/no-tests/package.json': '{ "name": "@acme/local", "main": "index.js" }',
      'packages/no-tests/index.js': '',
    });
    await assert.rejects(targets(root), /'@acme\/local' \(workspace-package\)/);
    // Only node_modules changes: no manifest or source file does.
    link(root, '@acme/local', 'packages/no-tests');
    const a = shardWith(await targets(root), 'packages/app', 'packages/app/src/a.test.js');
    assert.ok(a.includes(WS + 'packages/no-tests/index.js'));
  });

  test('classification uses manifest names, subpaths, scopes and mappers independently', async () => {
    const owned = await ownership(
      workspace({
        'packages/no-tests/package.json': '{ "name": "@acme/local" }',
        'packages/app/child/package.json': '{ "name": "nested-local" }',
      }),
    );
    assert.equal(owned.packages.get('nested-local'), 'packages/app/child');
    for (const [specifier, expected] of [
      ['@acme/local', 'workspace-package'],
      ['@acme/local/subpath', 'workspace-package'],
      ['nested-local/subpath', 'workspace-package'],
      ['@acme/typo', 'workspace-scope'],
      ['@alias/path', 'mapper-owned'],
      ['./file', 'relative'],
      ['/file', 'absolute'],
      ['@other/external', undefined],
      ['nested-local-other', undefined],
    ])
      assert.equal(
        classifyWorkspaceImport(specifier!, owned, (name) => name.startsWith('@alias/')),
        expected,
      );
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

  test('plans by the project root when rootDir is below it', () => {
    const root = workspace();
    const projectRoot = join(root, 'packages/lib');
    const tests = names(30).map((path) => ({
      path: join(projectRoot, path),
      context: { config: { rootDir: join(projectRoot, 'src') } },
    }));
    const plan = planShards('packages/lib', names(30), normalizeOptions());
    const kept = new StableShardSequencer()
      .shard(tests as never, { shardIndex: 1, shardCount: plan.shardCount })
      .map((t) => t.path);
    const expected = names(30).filter((path) => plan.shardOf.get(path) === 1);
    assert.deepEqual(
      kept,
      expected.map((path) => join(projectRoot, path)),
    );
  });
});
