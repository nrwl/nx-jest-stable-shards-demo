import { cruise } from 'dependency-cruiser';
import extractTSConfig from 'dependency-cruiser/config-utl/extract-ts-config';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ShardOptions } from './buckets.ts';

export interface ClosureMeasurements {
  resolutionMs: number;
  traversalMs: number;
  fanIn: Map<string, number>;
  unresolved: Map<string, number>;
  unsupported: Set<string>;
}

/**
 * Runs dependency-cruiser once over `roots` (workspace-relative files) and
 * returns each root's transitive import closure, excluding the root itself.
 * A static workspace import it cannot resolve fails the graph: a silently
 * smaller closure would let a shard keep a stale cache hit.
 */
export async function importClosures(
  workspaceRoot: string,
  roots: string[],
  resolve: ShardOptions['resolve'],
  measurements?: ClosureMeasurements,
): Promise<Map<string, Set<string>>> {
  const started = performance.now();
  for (const root of roots) {
    if (!existsSync(join(workspaceRoot, root))) {
      throw new Error(`jest-shards: unresolved closure root ${root}`);
    }
  }
  const alias = Object.fromEntries(
    Object.entries(resolve.alias ?? {}).map(([key, target]) => [key, join(workspaceRoot, target)]),
  );
  const tsConfig = resolve.tsConfig ? extractTSConfig(join(workspaceRoot, resolve.tsConfig)) : null;
  const { output } = await cruise(
    roots,
    {
      baseDir: workspaceRoot,
      doNotFollow: { path: 'node_modules' },
      // Only the module graph is needed; this halves a cold run at 21k tests.
      skipAnalysisNotInRules: true,
      // `metadata` asks git what changed instead of hashing every file (an
      // unknown cached commit, as in a shallow clone, means a full run); it
      // needs a git repository, so anything else hashes contents.
      cache: {
        folder: join(workspaceRoot, '.nx/depcruise'),
        strategy: existsSync(join(workspaceRoot, '.git')) ? 'metadata' : 'content',
      },
      ...(resolve.tsConfig ? { tsConfig: { fileName: resolve.tsConfig } } : {}),
    },
    { alias },
    tsConfig ? { tsConfig } : undefined,
  );
  if (typeof output === 'string')
    throw new Error('jest-shards: unexpected dependency-cruiser output');

  const prefixes = [
    ...Object.keys(alias),
    ...Object.keys(tsConfig?.options?.paths ?? {}).map((p) => p.replace(/\*$/, '')),
  ];
  const isWorkspaceSpecifier = (specifier: string) =>
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    prefixes.some((p) => specifier === p || specifier.startsWith(p.endsWith('/') ? p : p + '/'));

  const edges = new Map<string, string[]>();
  const unresolved: string[] = [];
  for (const module of output.modules) {
    const followed: string[] = [];
    for (const dep of module.dependencies) {
      if (dep.couldNotResolve) {
        if (isWorkspaceSpecifier(dep.module)) unresolved.push(`${module.source}: '${dep.module}'`);
      } else if (!dep.coreModule && !dep.resolved.includes('node_modules/')) {
        followed.push(dep.resolved);
      }
    }
    edges.set(module.source, followed);
    if (measurements) {
      measurements.unresolved.set(
        module.source,
        module.dependencies.filter((d) => d.couldNotResolve).length,
      );
      if (
        module.followable === false &&
        !module.coreModule &&
        !module.couldNotResolve &&
        !module.source.includes('node_modules/') &&
        !module.source.endsWith('.json')
      ) {
        measurements.unsupported.add(module.source);
      }
      for (const dep of new Set(followed)) {
        measurements.fanIn.set(dep, (measurements.fanIn.get(dep) ?? 0) + 1);
      }
    }
  }
  if (unresolved.length > 0) {
    throw new Error(
      'jest-shards: dependency-cruiser cannot resolve these workspace imports. Match ' +
        "the plugin's resolve options to Jest's moduleNameMapper, or fix the import:\n  " +
        unresolved.join('\n  '),
    );
  }

  for (const root of roots) {
    if (!edges.has(root)) throw new Error(`jest-shards: unresolved closure root ${root}`);
  }
  const traversalStarted = performance.now();
  if (measurements) measurements.resolutionMs = traversalStarted - started;
  const closures = new Map<string, Set<string>>();
  for (const root of roots) {
    const seen = new Set<string>([root]);
    const queue = [root];
    for (const file of queue) {
      for (const next of edges.get(file) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    seen.delete(root);
    closures.set(root, seen);
  }
  if (measurements) measurements.traversalMs = performance.now() - traversalStarted;
  return closures;
}
