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
  assert.ok(capped.shards.some((s: { hubFanIn: number }) => s.hubFanIn >= 8));
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
  await assert.rejects(
    importClosures(root, ['missing.test.js'], {}),
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
