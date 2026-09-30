// Membership parity: for every shard target, the tests named in its inputs must
// equal `jest --listTests --shard=k/shardCount`, the shards of a config must
// cover `jest --listTests` exactly once, every config must use the stable
// sequencer, and every Jest config on disk must have produced shards.
import { createProjectGraphAsync, workspaceRoot } from '@nx/devkit';
import { createNodes as stockJest } from '@nx/jest/plugin';
import { Minimatch } from 'minimatch';
import { execFile } from 'node:child_process';
import { globSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const jestBin = join(workspaceRoot, 'node_modules/.bin/jest');
const sequencer = join(workspaceRoot, 'tools/jest-shards/sequencer.ts');
const WS = '{workspaceRoot}/';

async function jest(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run(jestBin, args, { cwd, maxBuffer: 256 * 1024 * 1024 });
  return stdout;
}
async function listTests(cwd: string, args: string[]): Promise<string[]> {
  const out = await jest(cwd, ['--listTests', ...args]);
  return out
    .split('\n')
    .filter(Boolean)
    .map((file) => relative(workspaceRoot, file))
    .sort();
}

const graph = await createProjectGraphAsync({ exitOnError: true });
const failures: string[] = [];
const report = (ok: boolean, line: string) => {
  console.log(`${line} ${ok ? 'OK' : 'MISMATCH'}`);
  if (!ok) failures.push(line);
};
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

const configsWithShards = new Set<string>();
const checks: (() => Promise<void>)[] = [];
for (const node of Object.values(graph.nodes)) {
  const shards = Object.entries(node.data.targets ?? {}).filter(([name]) =>
    name.startsWith('test-ci--'),
  );
  if (shards.length === 0) continue;
  const root = node.data.root;
  const config = shards[0][1].options.command.match(/-c (\S+)/)[1];
  configsWithShards.add(join(root, config));

  checks.push(async () => {
    const resolved = JSON.parse(await jest(root, ['--showConfig', '-c', config]));
    const actual = resolved.globalConfig.testSequencer;
    report(actual === sequencer, `${node.name}: testSequencer=${relative(workspaceRoot, actual)}`);

    const all = await listTests(root, ['-c', config]);
    const byShard = await Promise.all(
      shards.map(async ([name, target]) => {
        const shardArg = target.options.command.match(/--shard=\S+/)[0];
        // Member inputs are exact paths; only escaped odd paths need a glob match.
        const members = (target.inputs as unknown[])
          .filter((i): i is string => typeof i === 'string' && i.startsWith(WS))
          .map((i) => i.slice(WS.length))
          .filter((i) => !/(^|[^\\])\*/.test(i));
        const exact = new Set(members.filter((m) => !/[?[\]{}!\\]/.test(m)));
        const escaped = members.filter((m) => !exact.has(m)).map((m) => new Minimatch(m));
        const graphTests = all.filter((t) => exact.has(t) || escaped.some((m) => m.match(t)));
        const jestTests = await listTests(root, ['-c', config, shardArg]);
        report(
          same(graphTests, jestTests),
          `${node.name}:${name} graph=${graphTests.length} jest=${jestTests.length}`,
        );
        return jestTests;
      }),
    );
    const union = byShard.flat().sort();
    const duplicates = union.length - new Set(union).size;
    report(
      same(union, all) && duplicates === 0,
      `${node.name}: union of ${shards.length} shards=${union.length} listTests=${all.length} duplicates=${duplicates}`,
    );
  });
}

// A config that stock inference skipped would otherwise vanish silently.
const onDisk = globSync(stockJest[0], { cwd: workspaceRoot, exclude: ['**/node_modules/**'] });
const missing = onDisk.filter((config) => !configsWithShards.has(config));
report(
  missing.length === 0,
  `inventory: ${onDisk.length} Jest configs on disk, ${configsWithShards.size} with shards` +
    (missing.length ? ` (none for ${missing.join(', ')})` : ''),
);

const queue = [...checks];
await Promise.all(
  Array.from({ length: availableParallelism() }, async () => {
    for (let check = queue.shift(); check; check = queue.shift()) await check();
  }),
);
console.log(failures.length ? `PARITY FAILED (${failures.length})` : 'PARITY OK');
process.exit(failures.length ? 1 : 0);
