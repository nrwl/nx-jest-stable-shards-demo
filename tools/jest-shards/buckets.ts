import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

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
}

export const PLUGIN_PATH = './tools/jest-shards/plugin.ts';

export function normalizeOptions(raw: Partial<ShardOptions> = {}): ShardOptions {
  const defaults: ShardOptions = {
    testsPerShard: 25,
    overrides: {},
    isolate: [],
    sharedInputs: [],
    maxClosureInputs: 1000,
  };
  const allowed = Object.keys(defaults);
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) {
      throw new Error(`jest-shards: unknown option '${key}'; allowed keys: ${allowed.join(', ')}`);
    }
  }
  const options: ShardOptions = { ...defaults, ...raw };
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

const JEST_CONFIGS = ['js', 'cjs', 'mjs', 'ts', 'cts', 'mts'].map((ext) => `jest.config.${ext}`);

/**
 * The Nx project root that owns a Jest `rootDir`: the nearest directory at or
 * above it that holds a Jest config. Jest's `rootDir` may be a subdirectory
 * (`rootDir: 'src'`), while shard plans are keyed by the project root.
 */
export function projectRootOf(rootDir: string, workspaceRoot: string): string {
  for (let dir = rootDir; ; dir = dirname(dir)) {
    if (JEST_CONFIGS.some((name) => existsSync(join(dir, name)))) return dir;
    if (dir === workspaceRoot || dirname(dir) === dir) {
      throw new Error(`jest-shards: no Jest config at or above the rootDir ${rootDir}`);
    }
  }
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
