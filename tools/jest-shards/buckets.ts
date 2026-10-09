import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ShardOptions {
  /** Target maximum average of regular (non-isolated) tests per hash bucket. */
  testsPerShard: number;
  /** Per-project sizing and closure budget, keyed by project root. */
  overrides: Record<string, { testsPerShard?: number; maxClosureInputs?: number }>;
  /** Workspace-relative test paths that each get a shard of their own. */
  isolate: string[];
  /** Inputs every shard gets; exact JS/TS files among them are cruised too. */
  sharedInputs: (string | { env: string })[];
  /** Budget for one shard's source closure before it collapses to globs. */
  maxClosureInputs: number;
  /** dependency-cruiser resolution; must match Jest's moduleNameMapper. */
  resolve: { alias?: Record<string, string>; tsConfig?: string };
}

export const PLUGIN_PATH = './tools/jest-shards/plugin.ts';

export function normalizeOptions(raw: Partial<ShardOptions> = {}): ShardOptions {
  const options: ShardOptions = {
    testsPerShard: 25,
    overrides: {},
    isolate: [],
    sharedInputs: [],
    maxClosureInputs: 1000,
    resolve: {},
    ...raw,
  };
  const duplicate = options.isolate.find((path, i) => options.isolate.indexOf(path) !== i);
  if (duplicate) throw new Error(`jest-shards: isolate lists ${duplicate} twice`);
  // A non-positive or non-finite size would never let bucketCount settle.
  const sizes: [string, number][] = [
    ['testsPerShard', options.testsPerShard],
    ...Object.entries(options.overrides)
      .filter(([, o]) => o.testsPerShard !== undefined)
      .map(([root, o]): [string, number] => [`overrides.${root}.testsPerShard`, o.testsPerShard!]),
  ];
  for (const [name, value] of sizes) {
    if (!(Number.isFinite(value) && value > 0)) {
      throw new Error(`jest-shards: ${name} must be a positive number, got ${value}`);
    }
  }
  for (const [name, cap] of [
    ['maxClosureInputs', options.maxClosureInputs],
    ...Object.entries(options.overrides)
      .filter(([, o]) => o.maxClosureInputs !== undefined)
      .map(([root, o]) => [`overrides.${root}.maxClosureInputs`, o.maxClosureInputs!]),
  ] as [string, number][]) {
    if (!(Number.isInteger(cap) && cap >= 0)) {
      throw new Error(`jest-shards: ${name} must be a nonnegative integer, got ${cap}`);
    }
  }
  return options;
}

/** The Jest process has no Nx context, so the sequencer reads the same nx.json entry. */
export function readOptions(workspaceRoot: string): ShardOptions {
  const nxJson = JSON.parse(readFileSync(join(workspaceRoot, 'nx.json'), 'utf8'));
  const entry = nxJson.plugins?.find(
    (p: unknown) => typeof p === 'object' && (p as { plugin: string }).plugin === PLUGIN_PATH,
  );
  if (!entry) throw new Error(`jest-shards: nx.json has no plugin entry for ${PLUGIN_PATH}`);
  return normalizeOptions(entry.options);
}

export interface ShardPlan {
  bucketCount: number;
  /** Jest's `--shard` denominator: bucketCount plus one per isolated test. */
  shardCount: number;
  /** Project-relative test path to its 1-based shard index. */
  shardOf: Map<string, number>;
}

/** Stable assignment: a test only moves when it is renamed or bucketCount changes. */
export function planShards(projectRoot: string, tests: string[], options: ShardOptions): ShardPlan {
  const isolate = new Set(options.isolate);
  const isolated = tests.filter((t) => isolate.has(join(projectRoot, t))).sort();
  const regular = tests.filter((t) => !isolate.has(join(projectRoot, t)));
  const testsPerShard = options.overrides[projectRoot]?.testsPerShard ?? options.testsPerShard;

  let bucketCount = 1;
  while (regular.length / bucketCount > testsPerShard) bucketCount *= 2;

  const shardOf = new Map<string, number>();
  for (const test of regular) shardOf.set(test, (hash(test) % bucketCount) + 1);
  isolated.forEach((test, i) => shardOf.set(test, bucketCount + i + 1));
  return { bucketCount, shardCount: bucketCount + isolated.length, shardOf };
}

function hash(path: string): number {
  return createHash('sha256').update(path).digest().readUInt32BE(0);
}
