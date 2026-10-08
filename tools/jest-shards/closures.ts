import { cruise } from 'dependency-cruiser';
import extractTSConfig from 'dependency-cruiser/config-utl/extract-ts-config';
import { createHash } from 'node:crypto';
import { accessSync, constants, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ShardOptions } from './buckets.ts';
import { classifyWorkspaceImport, workspaceOwnership } from './ownership.ts';

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
  labels: Map<string, string> = new Map(),
): Promise<Map<string, Set<string>>> {
  const ownership = workspaceOwnership(workspaceRoot);
  const label = (root: string) => labels.get(root) ?? root;
  const fail = (root: string, importer: string, specifier: string, classification: string) => {
    throw new Error(
      `jest-shards: project/config ${label(root)}: ${importer}: '${specifier}' (${classification}); cannot resolve or read workspace import`,
    );
  };
  const availability = new Map<string, boolean>();
  const available = (file: string) => {
    if (!availability.has(file)) {
      try {
        accessSync(join(workspaceRoot, file), constants.R_OK);
        availability.set(file, statSync(join(workspaceRoot, file)).isFile());
      } catch {
        availability.set(file, false);
      }
    }
    return availability.get(file)!;
  };
  for (const root of roots) if (!available(root)) fail(root, root, root, 'graph-entrypoint');
  const alias = Object.fromEntries(
    Object.entries(resolve.alias ?? {}).map(([key, target]) => [key, join(workspaceRoot, target)]),
  );
  const tsConfig = resolve.tsConfig ? extractTSConfig(join(workspaceRoot, resolve.tsConfig)) : null;
  const policy = createHash('sha256')
    .update(JSON.stringify(['ownership-v1', ownership.fingerprint, resolve, tsConfig]))
    .digest('hex');
  const { output } = await cruise(
    roots,
    {
      baseDir: workspaceRoot,
      doNotFollow: { path: 'node_modules' },
      // Only the module graph is needed; this halves a cold run at 21k tests.
      skipAnalysisNotInRules: true,
      // Manifests and resolution policy get a separate namespace. Content
      // validation also catches unavailable files and uncommitted source edits.
      cache: { folder: join(workspaceRoot, '.nx/depcruise', policy), strategy: 'content' },
      preserveSymlinks: false,
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
  const edges = new Map<string, { file: string; specifier: string }[]>();
  const unresolved = new Map<string, { specifier: string; classification: string }[]>();
  for (const module of output.modules) {
    const followed: { file: string; specifier: string }[] = [];
    const missing: { specifier: string; classification: string }[] = [];
    for (const dep of module.dependencies) {
      const classification = classifyWorkspaceImport(dep.module, ownership, prefixes);
      if (dep.couldNotResolve) {
        if (classification) missing.push({ specifier: dep.module, classification });
      } else if (!dep.coreModule && !dep.resolved.includes('node_modules/')) {
        followed.push({ file: dep.resolved, specifier: dep.module });
      }
    }
    edges.set(module.source, followed);
    unresolved.set(module.source, missing);
  }

  const closures = new Map<string, Set<string>>();
  for (const root of roots) {
    const seen = new Set<string>([root]);
    const queue = [root];
    for (const file of queue) {
      if (!edges.has(file) || !available(file)) fail(root, file, file, 'workspace-file');
      for (const missing of unresolved.get(file) ?? [])
        fail(root, file, missing.specifier, missing.classification);
      for (const next of edges.get(file)!) {
        if (!available(next.file) || !edges.has(next.file))
          fail(root, file, next.specifier, 'workspace-file');
        if (seen.has(next.file)) continue;
        seen.add(next.file);
        queue.push(next.file);
      }
    }
    seen.delete(root);
    closures.set(root, seen);
  }
  return closures;
}
