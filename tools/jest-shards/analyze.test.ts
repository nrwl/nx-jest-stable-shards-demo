import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { Minimatch } from 'minimatch';
import { generateDeepHub } from '../../scripts/generate-deep-hub.ts';
import { normalizeOptions, planShards } from './buckets.ts';

process.env.NX_DAEMON = 'false';
const { analyze } = await import('./analyze.ts');
const { importClosures } = await import('./closures.ts');
const { JestProjects } = await import('./jest-context.ts');
const { hashableFiles, workspaceOwnership } = await import('./ownership.ts');
const root = mkdtempSync(join(tmpdir(), 'closure-diagnostics-'));
generateDeepHub(root);
after(() => rmSync(root, { recursive: true, force: true }));

const reports = new Map<number | 'uncapped', Awaited<ReturnType<typeof analyze>>>();

test('deep cyclic and shared hubs terminate, cap stages differ, and every mode covers the exact closure', async () => {
  for (const cap of [1000, 5000, 'uncapped', 0] as const) {
    const report = await analyze(root, { cap, raw: true });
    reports.set(cap, report);
    assert.equal(report.summary.projectCount, 3);
    assert.equal(report.summary.shardCount, 6);
    assert.equal(
      report.shards.reduce((n, s) => n + s.memberCount, 0),
      24,
    );
    for (const shard of report.shards) {
      const matchers = shard.patterns!.map(
        (p) => new Minimatch(p.slice('{workspaceRoot}/'.length), { dot: true }),
      );
      for (const file of shard.exactClosure!) {
        assert.ok(
          matchers.some((m) => m.match(file)),
          `${cap}: missing ${file}`,
        );
      }
      assert.ok(shard.extraCoveredFiles >= 0);
      assert.equal(shard.unresolvedCount, 0);
      assert.equal(shard.unsupportedCount, 0);
      if (cap === 'uncapped' || cap === 5000) {
        assert.equal(shard.stage, 'exact');
        assert.equal(shard.extraCoveredFiles, 0);
      }
    }
  }
  const capped = reports.get(1000)!;
  assert.ok(capped.summary.stages.roots.count > 0);
  assert.ok(capped.summary.stages.exact.count > 0);
  assert.ok(
    capped.shards.some(
      (s: { exactClosureBeforeShared: number; exactClosureAfterShared: number }) =>
        s.exactClosureBeforeShared > s.exactClosureAfterShared,
    ),
  );
  // The shared module has over 2,300 importers; it must not hide source hubs.
  for (const shard of capped.shards) {
    assert.equal(shard.hubFanIn, shard.exactClosure!.some((f) => f.includes('/part-0/')) ? 9 : 8);
  }
  assert.ok(capped.shards.some((s) => s.exactClosure!.includes('packages/outer/src/hub.js')));
  for (const shard of capped.shards) {
    const exact = reports.get('uncapped')!.shards.find((s: { id: string }) => s.id === shard.id);
    assert.ok(exact);
    assert.deepEqual(shard.exactClosure, exact.exactClosure, 'cap does not change traversal');
  }
});

test('project cap override does not change bucket sizing, and comparison cap overrides it', async () => {
  const path = join(root, 'nx.json');
  const original = readFileSync(path, 'utf8');
  const config = JSON.parse(original);
  config.plugins[0].options.overrides = { 'packages/outer': { maxClosureInputs: 5000 } };
  writeFileSync(path, JSON.stringify(config));
  try {
    const report = await analyze(root);
    assert.ok(
      report.shards.filter((s) => s.projectId === 'p0001').every((s) => s.stage === 'exact'),
    );
    assert.ok(report.shards.some((s) => s.stage === 'roots'));
    assert.ok(
      (await analyze(root, { cap: 1000 })).shards.some(
        (s) => s.projectId === 'p0001' && s.stage === 'roots',
      ),
    );
    assert.equal(
      planShards(
        'packages/outer',
        ['a', 'b'],
        normalizeOptions({ overrides: { 'packages/outer': { maxClosureInputs: 5 } } }),
      ).bucketCount,
      1,
    );
    assert.throws(
      () => normalizeOptions({ overrides: { p: { maxClosureInputs: -1 } } }),
      /nonnegative integer/,
    );
  } finally {
    writeFileSync(path, original);
  }
});

test('missing exact roots and unresolved imports are errors', async () => {
  const hashable = await hashableFiles(root);
  await assert.rejects(
    importClosures(
      root,
      [{ file: 'missing.test.js', context: new JestProjects(root).node, config: 'missing' }],
      { hashable, ownership: workspaceOwnership(root, hashable) },
    ),
    /missing.test.js.*graph-entrypoint/,
  );
  const missing = join(root, 'packages/small/tests/case-0.test.js');
  const original = readFileSync(missing, 'utf8');
  writeFileSync(missing, "require('./missing');\n");
  try {
    // Each supported command invocation is a new process, including warm runs.
    const result = spawnSync(
      process.execPath,
      [resolve('tools/jest-shards/analyze.ts'), '--workspace', root, '--cap', 'uncapped', '--raw'],
      { env: { ...process.env, NX_DAEMON: 'false' }, encoding: 'utf8', timeout: 60000 },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /cannot resolve/);
  } finally {
    writeFileSync(missing, original);
  }
});

test('CLI output is private, executes no Jest, performs no network IO, and changes only ignored cache files', () => {
  const guard = join(root, 'offline-guard.cjs');
  const audit = join(root, 'offline-audit.txt');
  // Fail and record attempts, including attempts an imported config might catch.
  writeFileSync(
    guard,
    `
    const fs = require('node:fs');
    const reject = () => { fs.appendFileSync(${JSON.stringify(audit)}, 'attempt\\n'); throw new Error('Offline guard'); };
    for (const name of ['node:http', 'node:https']) {
      const mod = require(name); mod.request = reject; mod.get = reject;
    }
    const net = require('node:net'); net.connect = reject; net.createConnection = reject; net.Socket.prototype.connect = reject;
    const tls = require('node:tls'); tls.connect = reject;
    const dns = require('node:dns'); dns.lookup = reject; dns.resolve = reject;
    global.fetch = reject;
    const child = require('node:child_process');
    for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
      const original = child[method];
      child[method] = function(command, ...args) {
        if (/jest|nx-cloud/.test(String(command)) || (Array.isArray(args[0]) && args[0].some(a => /(?:jest\\/(?:bin|build)|nx-cloud)/.test(String(a))))) reject();
        return original.call(this, command, ...args);
      };
    }
    require('node:module').syncBuiltinESMExports();
  `,
  );
  const snapshot = () =>
    Object.fromEntries(
      globSync('**/*', {
        cwd: root,
        withFileTypes: true,
        exclude: ['**/node_modules/**', '**/.nx/**'],
      })
        .filter((f) => f.isFile())
        .map((f) => {
          const path = join(f.parentPath, f.name);
          return [path, readFileSync(path, 'utf8')];
        }),
    );
  const before = snapshot();
  const result = spawnSync(
    process.execPath,
    [
      '--require',
      guard,
      resolve('tools/jest-shards/analyze.ts'),
      '--workspace',
      root,
      '--cap',
      '1000',
    ],
    {
      env: { ...process.env, NX_DAEMON: 'false', NX_NO_CLOUD: 'true' },
      encoding: 'utf8',
      timeout: 60000,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const report = JSON.parse(result.stdout);
  assert.equal(report.summary.shardCount, 6);
  for (const name of [
    root,
    'packages',
    '@acme',
    'synthetic',
    'case-',
    'part-',
    'leaf.js',
    'shared.js',
    'hub.js',
  ]) {
    assert.ok(!result.stdout.includes(name), `private name leaked: ${name}`);
  }
  assert.deepEqual(snapshot(), before);
  assert.equal(globSync('offline-audit.txt', { cwd: root }).length, 0);

  const missing = join(root, 'setup.js');
  const original = readFileSync(missing, 'utf8');
  rmSync(missing);
  try {
    const failure = spawnSync(
      process.execPath,
      [resolve('tools/jest-shards/analyze.ts'), '--workspace', root, '--cap', 'uncapped'],
      { env: { ...process.env, NX_DAEMON: 'false' }, encoding: 'utf8', timeout: 60000 },
    );
    assert.equal(failure.status, 1);
    assert.equal(failure.stdout, '');
    assert.ok(!failure.stderr.includes(root));
    assert.ok(!failure.stderr.includes('setup.js'));
  } finally {
    writeFileSync(missing, original);
  }
});

test('unresolved external and observed unsupported module counts come from the actual graph', async () => {
  const countsRoot = mkdtempSync(join(tmpdir(), 'closure-counts-'));
  try {
    mkdirSync(join(countsRoot, 'app'));
    writeFileSync(
      join(countsRoot, 'nx.json'),
      JSON.stringify({ plugins: [{ plugin: './tools/jest-shards/plugin.ts' }] }),
    );
    writeFileSync(join(countsRoot, 'package.json'), '{"private":true}');
    writeFileSync(join(countsRoot, 'app/project.json'), '{"name":"opaque-counts"}');
    writeFileSync(
      join(countsRoot, 'app/jest.config.js'),
      "module.exports = { testMatch: ['*.test.js'] };\n",
    );
    writeFileSync(
      join(countsRoot, 'app/a.test.js'),
      "require('./style.css'); require('unavailable-external');\n",
    );
    writeFileSync(join(countsRoot, 'app/style.css'), 'body { color: red; }');
    symlinkSync(resolve('node_modules'), join(countsRoot, 'node_modules'), 'dir');
    const report = await analyze(countsRoot);
    assert.equal(report.shards.length, 1);
    assert.equal(report.shards[0].unresolvedCount, 1);
    assert.equal(report.shards[0].unsupportedCount, 1);
    assert.equal(report.projects[0].unresolvedCount, 1);
    assert.equal(report.projects[0].unsupportedCount, 1);
  } finally {
    rmSync(countsRoot, { recursive: true, force: true });
  }
});

test('coverage and discovery honor Nx ignore rules and imported ignored files fail', async () => {
  const ignoredRoot = mkdtempSync(join(tmpdir(), 'closure-ignores-'));
  const write = (file: string, content: string) => {
    mkdirSync(join(ignoredRoot, file, '..'), { recursive: true });
    writeFileSync(join(ignoredRoot, file), content);
  };
  try {
    write('nx.json', JSON.stringify({ plugins: [{ plugin: './tools/jest-shards/plugin.ts' }] }));
    write('package.json', '{"private":true}');
    write('.gitignore', 'dist/\ncoverage/\n**/src/ignored.js\n');
    write('.nxignore', 'app/generated/\n');
    write('app/project.json', '{"name":"ignore-fixture"}');
    write('app/package.json', '{"private":true}');
    write('app/jest.config.js', "module.exports = { testMatch: ['*.test.js'] };\n");
    write('app/a.test.js', "require('./src/leaf');\n");
    write('app/src/leaf.js', 'module.exports = 1;');
    write('app/src/ignored.js', 'module.exports = 2;');
    write('app/src/.gitignore', '*.log\n!kept.log\n');
    write('app/src/kept.log', 'included');
    write('app/src/dropped.log', 'ignored');
    for (const dir of ['dist', 'coverage', 'generated']) {
      write(`app/${dir}/output.js`, 'ignored');
      write(`app/${dir}/jest.config.js`, "throw new Error('Ignored config was loaded');");
    }
    symlinkSync(resolve('node_modules'), join(ignoredRoot, 'node_modules'), 'dir');
    const widened = await analyze(ignoredRoot, { cap: 0 });
    assert.equal(widened.summary.projectCount, 1);
    assert.equal(widened.summary.shardCount, 1);
    assert.equal(widened.shards[0].stage, 'roots');
    assert.equal(widened.shards[0].exactClosureAfterShared, 1);
    assert.equal(widened.shards[0].hashableExactClosureAfterShared, 1);
    assert.equal(widened.shards[0].coveredFileCount, 7);
    assert.equal(widened.shards[0].extraCoveredFiles, 6);
    assert.equal(widened.projects[0].extraCoveredFiles, 6);
    const exact = await analyze(ignoredRoot, { cap: 'uncapped' });
    assert.equal(exact.shards[0].exactClosureAfterShared, 1);
    assert.equal(exact.shards[0].coveredFileCount, 1);
    assert.equal(exact.shards[0].extraCoveredFiles, 0);
    assert.equal(exact.projects[0].hashableExactClosureAfterShared, 1);
    write('app/a.test.js', "require('./src/leaf'); require('./src/ignored');\n");
    await assert.rejects(analyze(ignoredRoot, { cap: 'uncapped' }), /Nx does not hash it/);
  } finally {
    rmSync(ignoredRoot, { recursive: true, force: true });
  }
});

test('usage errors give fixed instructions without exposing arbitrary arguments', () => {
  for (const args of [
    ['--cap=1000'],
    ['--cap'],
    ['--cap', 'private-package'],
    ['--unknown-private-path'],
  ]) {
    const result = spawnSync(process.execPath, [resolve('tools/jest-shards/analyze.ts'), ...args], {
      encoding: 'utf8',
      timeout: 60000,
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Usage:|Invalid cap/);
    assert.ok(!result.stderr.includes('private'));
    assert.ok(!result.stderr.includes('--raw for details'));
  }
});

test('measurements follow each project mapper and remove its configured setup closure', async () => {
  const ws = mkdtempSync(join(tmpdir(), 'closure-contexts-'));
  const write = (file: string, content: string) => {
    mkdirSync(join(ws, file, '..'), { recursive: true });
    writeFileSync(join(ws, file), content);
  };
  try {
    write('nx.json', JSON.stringify({ plugins: [{ plugin: './tools/jest-shards/plugin.ts' }] }));
    write('package.json', '{"private":true}');
    write('shared/importer.js', "require('flavor');\n");
    for (const project of ['alpha', 'beta']) {
      write(`${project}/project.json`, JSON.stringify({ name: project }));
      write(
        `${project}/jest.config.js`,
        `module.exports = {
        testMatch: ['*.test.js'],
        moduleNameMapper: { '^flavor$': '<rootDir>/flavor.js' },
        setupFiles: ['<rootDir>/setup.js'],
      };\n`,
      );
      write(`${project}/a.test.js`, "require('../shared/importer'); require('./setup');\n");
      write(`${project}/setup.js`, "require('./setup-leaf');\n");
      write(`${project}/setup-leaf.js`, 'module.exports = 1;');
    }
    write('alpha/flavor.js', "require('unavailable-external'); require('./style.css');\n");
    write('alpha/style.css', 'body { color: red; }');
    write('beta/flavor.js', 'module.exports = 1;');
    symlinkSync(resolve('node_modules'), join(ws, 'node_modules'), 'dir');
    const report = await analyze(ws, { raw: true, cap: 'uncapped' });
    const alpha = report.shards.find((s) => s.root === 'alpha')!;
    const beta = report.shards.find((s) => s.root === 'beta')!;
    assert.equal(alpha.unresolvedCount, 1);
    assert.equal(alpha.unsupportedCount, 1);
    assert.equal(beta.unresolvedCount, 0);
    assert.equal(beta.unsupportedCount, 0);
    assert.deepEqual(alpha.exactClosure, [
      'alpha/flavor.js',
      'alpha/style.css',
      'shared/importer.js',
    ]);
    assert.deepEqual(beta.exactClosure, ['beta/flavor.js', 'shared/importer.js']);
    assert.equal(alpha.exactClosureBeforeShared - alpha.exactClosureAfterShared, 2);
    assert.equal(beta.exactClosureBeforeShared - beta.exactClosureAfterShared, 2);
    assert.equal(alpha.hubFanIn, 1);
    assert.equal(beta.hubFanIn, 1);
    assert.equal(report.projects[0].unresolvedCount, 1);
    assert.equal(report.projects[1].unresolvedCount, 0);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
