import type TestSequencer from '@jest/test-sequencer';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { planShards, projectRootOf, readOptions } from './buckets.ts';

// CommonJS with `exports.default`: an ESM default import would get the module object.
const Sequencer: typeof TestSequencer = createRequire(import.meta.url)(
  '@jest/test-sequencer',
).default;

type Test = Parameters<TestSequencer['shard']>[0][number];
type JestShard = Parameters<TestSequencer['shard']>[1];

/**
 * Replaces Jest's own `--shard` slicing, which moves tests between shards
 * whenever any test is added or deleted, with the plugin's stable buckets.
 */
export default class StableShardSequencer extends Sequencer {
  override shard(tests: Test[], { shardIndex, shardCount }: JestShard): Test[] {
    if (tests.length === 0) return tests;
    const workspaceRoot = findWorkspaceRoot(tests[0].context.config.rootDir);
    // The plugin plans per Nx project root, which Jest's rootDir may sit below.
    const projectRoot = projectRootOf(tests[0].context.config.rootDir, workspaceRoot);
    const paths = tests.map((t) => relative(projectRoot, t.path));
    const plan = planShards(
      relative(workspaceRoot, projectRoot),
      paths,
      readOptions(workspaceRoot),
    );
    if (plan.shardCount !== shardCount) {
      throw new Error(
        `jest-shards: ${projectRoot} has ${plan.shardCount} shards, but Jest was given ` +
          `--shard=${shardIndex}/${shardCount}. The project graph is stale; recompute it.`,
      );
    }
    return tests.filter((_, i) => plan.shardOf.get(paths[i]) === shardIndex);
  }
}

function findWorkspaceRoot(dir: string): string {
  while (!existsSync(join(dir, 'nx.json'))) {
    if (dirname(dir) === dir) throw new Error('jest-shards: no nx.json above ' + dir);
    dir = dirname(dir);
  }
  return dir;
}
