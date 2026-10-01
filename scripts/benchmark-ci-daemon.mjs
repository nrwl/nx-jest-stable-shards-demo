// One graph-only CI probe. No tests or Nx Cloud calls.
// node scripts/benchmark-ci-daemon.mjs [workspace] > daemon-benchmark.json
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { dirname, join, resolve } from 'node:path';

assert.equal(process.version, 'v24.21.0', 'Use Node 24.21.0 to match CI');
const workspace = resolve(process.argv[2] ?? '.');
const temporary = realpathSync(mkdtempSync('/tmp/nx-daemon-ci-'));
const checkout = join(temporary, 'workspace');
const nx = 'node_modules/nx/dist/bin/nx.js';
const deadline = performance.now() + 8 * 60_000;
const environment = {
  ...process.env,
  PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
  CI: 'true',
  NX_NO_CLOUD: 'true',
  NX_TUI: 'false',
  NX_INTERACTIVE: 'false',
  NX_FORCE_REUSE_CACHED_GRAPH: 'false',
  NX_LEGACY_AFFECTED: 'false',
  FIXTURE_WORK_SCALE: '0',
  FORCE_COLOR: '0',
};
const results = {
  node: process.version,
  platform: `${platform()} ${release()}`,
  cpu: cpus()[0].model,
  logicalCpus: cpus().length,
  samples: [],
  daemons: [],
  checks: [],
};
let activeDaemon;
let expectedPid;
let baseline;

function run(file, args, cwd = checkout, env = environment, cleanup = false) {
  const timeout = cleanup ? 15_000 : Math.min(150_000, deadline - performance.now());
  assert(timeout > 0, 'Eight-minute probe budget exhausted');
  const start = performance.now();
  const result = spawnSync(file, args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: Math.ceil(timeout),
    maxBuffer: 100 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    `${file} ${args[0]} failed: ${result.error ?? ''}\n${result.stderr?.slice(-4000)}\n${result.stdout?.slice(-1000)}`,
  );
  return { stdout: result.stdout, seconds: (performance.now() - start) / 1000 };
}
const node = (args, env, cleanup = false) => run(process.execPath, args, checkout, env, cleanup);
const stateFile = (env) => join(env.NX_WORKSPACE_DATA_DIRECTORY, 'd/server-process.json');
const logFile = (env) => join(env.NX_WORKSPACE_DATA_DIRECTORY, 'd/daemon.log');
const graphRequests = (env) =>
  existsSync(logFile(env))
    ? readFileSync(logFile(env), 'utf8')
        .split('\n')
        .filter((line) => /Handled .* message REQUEST_PROJECT_GRAPH\./.test(line))
    : [];

function daemonState(env) {
  const state = JSON.parse(readFileSync(stateFile(env), 'utf8'));
  assert.equal(state.nxVersion, '23.3.0-beta.7');
  assert(state.socketPath.startsWith(`${env.NX_SOCKET_DIR}/`), 'Unexpected shared daemon socket');
  assert(existsSync(state.socketPath), 'Daemon socket missing');
  process.kill(state.processId, 0);
  if (expectedPid) assert.equal(state.processId, expectedPid, 'Daemon unexpectedly restarted');
  expectedPid = state.processId;
  assert(!existsSync(join(env.NX_WORKSPACE_DATA_DIRECTORY, 'd/disabled')), 'Daemon was disabled');
  assert(
    !existsSync(join(env.NX_WORKSPACE_DATA_DIRECTORY, 'd/daemon-error.log')),
    'Daemon fell back',
  );
  return state;
}

function stopDaemon() {
  if (!activeDaemon || !existsSync(stateFile(activeDaemon))) return;
  const state = JSON.parse(readFileSync(stateFile(activeDaemon), 'utf8'));
  assert(
    state.socketPath.startsWith(`${activeDaemon.NX_SOCKET_DIR}/`),
    'Refusing to stop shared daemon',
  );
  if (expectedPid) assert.equal(state.processId, expectedPid, 'Unexpected daemon during cleanup');
  results.daemons.push({ ...state, graphRequests: graphRequests(activeDaemon) });
  try {
    node([nx, 'reset', '--onlyDaemon'], activeDaemon, true);
  } catch (error) {
    console.error(`Scoped daemon reset failed: ${error.message}`);
    try {
      process.kill(state.processId, 'SIGTERM');
    } catch (stopError) {
      if (stopError.code !== 'ESRCH') throw stopError;
    }
  }
  let alive = true;
  for (let attempt = 0; attempt < 30 && alive; attempt++) {
    try {
      process.kill(state.processId, 0);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
      alive = false;
    }
  }
  assert(!alive, `Owned daemon ${state.processId} failed to stop`);
  results.checks.push(`owned daemon ${state.processId} stopped`);
  activeDaemon = undefined;
  expectedPid = undefined;
}

function pair(env, label) {
  const before = graphRequests(env).length;
  const targetResult = node(['scripts/shard-targets.ts'], env);
  const targets = targetResult.stdout.trim().split('\n').at(-1);
  assert.match(targets, /^test-ci--/);
  const afterTargets = graphRequests(env).length;
  if (env.NX_DAEMON === 'true') {
    daemonState(env);
    assert(afterTargets > before, 'Target discovery did not use daemon');
  }
  const graphResult = node([nx, 'run-many', '-t', targets, '--graph=stdout'], env);
  const graph = JSON.parse(graphResult.stdout.slice(graphResult.stdout.indexOf('{')));
  const taskIds = Object.keys(graph.tasks.tasks).sort();
  assert.equal(taskIds.length, 1067, 'Unexpected full-fixture task count');
  const signature = {
    targets,
    taskIds,
    dependencies: Object.entries(graph.tasks.dependencies)
      .sort()
      .map(([id, deps]) => [id, [...deps].sort()]),
  };
  if (baseline) assert.deepEqual(signature, baseline, `${label}: task graph changed`);
  else baseline = signature;
  if (env.NX_DAEMON === 'true') {
    daemonState(env);
    assert(graphRequests(env).length > afterTargets, 'Graph command did not use daemon');
  } else assert(!existsSync(stateFile(env)), 'Daemon started when disabled');
  const round = (number) => +number.toFixed(3);
  const sample = {
    label,
    targetSeconds: round(targetResult.seconds),
    graphSeconds: round(graphResult.seconds),
    totalSeconds: round(targetResult.seconds + graphResult.seconds),
    tasks: taskIds.length,
    daemonPid: env.NX_DAEMON === 'true' ? expectedPid : null,
    daemonRequests: graphRequests(env).length - before,
  };
  results.samples.push(sample);
  console.error(JSON.stringify(sample));
  return sample;
}

try {
  results.commit = run('git', ['rev-parse', 'HEAD'], workspace).stdout.trim();
  run('git', ['worktree', 'add', '--detach', checkout, results.commit], workspace);
  symlinkSync(join(workspace, 'node_modules'), join(checkout, 'node_modules'), 'dir');
  assert.equal(
    JSON.parse(readFileSync(join(checkout, 'node_modules/nx/package.json'))).version,
    '23.3.0-beta.7',
  );
  results.fixture = node(['scripts/generate-fixture.ts', '--preset', 'full'], {
    ...environment,
    NX_DAEMON: 'false',
  }).stdout.trim();
  let off;
  for (const mode of ['false', 'true']) {
    rmSync(join(checkout, '.nx/depcruise'), { recursive: true, force: true });
    const owned = join(temporary, mode);
    const sockets = join(owned, 'sockets');
    mkdirSync(sockets, { mode: 0o700, recursive: true });
    const env = {
      ...environment,
      NX_DAEMON: mode,
      NX_WORKSPACE_DATA_DIRECTORY: join(owned, 'workspace-data'),
      NX_CACHE_DIRECTORY: join(owned, 'task-cache'),
      NX_SOCKET_DIR: sockets,
    };
    if (mode === 'true') activeDaemon = env;
    for (const label of ['cold', 'warm-1', 'warm-2']) pair(env, `daemon-${mode}-${label}`);
    if (mode === 'false') {
      off = env;
      cpSync(env.NX_WORKSPACE_DATA_DIRECTORY, join(temporary, 'warm-data'), { recursive: true });
      cpSync(join(checkout, '.nx/depcruise'), join(temporary, 'warm-depcruise'), {
        recursive: true,
      });
    }
    stopDaemon();
  }
  for (let sample = 1; sample <= 2; sample++) {
    const previous = results.samples.at(-1).totalSeconds;
    if (sample === 2 && deadline - performance.now() < Math.max(30_000, previous * 2000)) {
      results.checks.push('second fresh-daemon sample skipped to preserve eight-minute budget');
      break;
    }
    rmSync(off.NX_WORKSPACE_DATA_DIRECTORY, { recursive: true, force: true });
    cpSync(join(temporary, 'warm-data'), off.NX_WORKSPACE_DATA_DIRECTORY, { recursive: true });
    rmSync(join(checkout, '.nx/depcruise'), { recursive: true, force: true });
    cpSync(join(temporary, 'warm-depcruise'), join(checkout, '.nx/depcruise'), { recursive: true });
    activeDaemon = { ...off, NX_DAEMON: 'true' };
    pair(activeDaemon, `fresh-daemon-warm-disk-${sample}`);
    stopDaemon();
  }
  results.checks.push(
    'all samples have identical target names, 1067 task IDs and task dependencies',
  );
} catch (error) {
  results.error = error.stack;
  process.exitCode = 1;
} finally {
  try {
    stopDaemon();
  } catch (error) {
    results.cleanupError = error.stack;
    process.exitCode = 1;
  } finally {
    try {
      if (existsSync(checkout))
        run('git', ['worktree', 'remove', '--force', checkout], workspace, environment, true);
      rmSync(temporary, { recursive: true, force: true });
    } catch (error) {
      results.cleanupError = error.stack;
      process.exitCode = 1;
    }
  }
  console.log(JSON.stringify(results, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = results.samples
      .map(
        (s) =>
          `| ${s.label} | ${s.targetSeconds} | ${s.graphSeconds} | ${s.totalSeconds} | ${s.tasks} |`,
      )
      .join('\n');
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## Daemon graph-only probe\n\nCommit: ${results.commit}. ${results.platform}, ${results.cpu}, ${results.logicalCpus} CPUs.\n\n| Sample | Targets (s) | Graph/hash (s) | Total (s) | Tasks |\n| --- | ---: | ---: | ---: | ---: |\n${rows}\n\n${results.error || results.cleanupError ? 'FAILED; see JSON output.' : 'Graph parity and daemon service/cleanup checks passed.'} No tests or Nx Cloud execution.\n`,
    );
  }
}
