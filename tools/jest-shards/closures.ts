import { cruise } from 'dependency-cruiser';
import extractTSConfig from 'dependency-cruiser/config-utl/extract-ts-config';
import { join } from 'node:path';
import type { ShardOptions } from './buckets.ts';

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
): Promise<Map<string, Set<string>>> {
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
      cache: { folder: join(workspaceRoot, '.nx/depcruise'), strategy: 'content' },
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
  }
  if (unresolved.length > 0) {
    throw new Error(
      'jest-shards: dependency-cruiser cannot resolve these workspace imports. Match ' +
        "the plugin's resolve options to Jest's moduleNameMapper, or fix the import:\n  " +
        unresolved.join('\n  '),
    );
  }

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
  return closures;
}
