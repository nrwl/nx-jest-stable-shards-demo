import type { CreateNodesContext } from '@nx/devkit';
import { Minimatch } from 'minimatch';
import { globSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PLUGIN_PATH, normalizeOptions } from './buckets.ts';
import { inferShards, createNodes, type InferenceMeasurements } from './plugin.ts';

export interface AnalyzeOptions {
  cap?: number | 'uncapped';
  raw?: boolean;
}

/** Counts only by default. Opaque IDs are ordinal and scoped to one checkout. */
export async function analyze(workspaceRoot: string, options: AnalyzeOptions = {}) {
  const started = performance.now();
  const nxJson = JSON.parse(readFileSync(join(workspaceRoot, 'nx.json'), 'utf8'));
  const entry = nxJson.plugins?.find((p: { plugin?: string }) => p.plugin === PLUGIN_PATH);
  if (!entry) throw new Error('No shard plugin configuration');
  const shardOptions = normalizeOptions(entry.options);
  if (typeof options.cap === 'number') {
    shardOptions.maxClosureInputs = options.cap;
    // A comparison cap applies to every project on this checkout.
    for (const override of Object.values(shardOptions.overrides)) {
      delete override.maxClosureInputs;
    }
    normalizeOptions(shardOptions);
  }
  const measurements: InferenceMeasurements = {
    discoveryMs: 0,
    closures: {
      resolutionMs: 0,
      traversalMs: 0,
      fanIn: new Map(),
      unresolved: new Map(),
      unsupported: new Set(),
    },
    shards: [],
    uncapped: options.cap === 'uncapped',
  };
  const configs = globSync(createNodes[0], {
    cwd: workspaceRoot,
    exclude: ['**/node_modules/**', '**/.nx/**', '**/.git/**', '**/.paperclip/**'],
  }).sort();
  const cwd = process.cwd();
  try {
    process.chdir(workspaceRoot);
    await inferShards(
      configs,
      shardOptions,
      { workspaceRoot, nxJsonConfiguration: nxJson } as CreateNodesContext,
      measurements,
    );
  } finally {
    process.chdir(cwd);
  }
  const scanStarted = performance.now();
  const universe = globSync('**/*', {
    cwd: workspaceRoot,
    withFileTypes: true,
    exclude: ['**/node_modules/**', '**/.nx/**', '**/.git/**', '**/.paperclip/**'],
  })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(workspaceRoot.length + 1));
  const roots = [...new Set(measurements.shards.map((s) => s.root))].sort();
  const projects = roots.map((root, index) => {
    const shards = measurements.shards.filter((s) => s.root === root);
    const before = new Set(shards.flatMap((s) => s.beforeShared));
    const after = new Set(shards.flatMap((s) => s.afterShared));
    return {
      id: `p${String(index + 1).padStart(4, '0')}`,
      memberCount: shards.reduce((n, s) => n + s.members.length, 0),
      shardCount: shards.length,
      exactClosureBeforeShared: before.size,
      exactClosureAfterShared: after.size,
      ...(options.raw ? { root } : {}),
    };
  });
  const coveredByProject = new Map<string, Set<string>>();
  const patternsByProject = new Map<string, Set<string>>();
  const shards = measurements.shards.map((s, index) => {
    const patterns = s.patterns.map((p) => p.slice('{workspaceRoot}/'.length));
    const plain = new Set(patterns.filter((p) => !/[*?[\]{}!\\]/.test(p)));
    const globs = patterns.filter((p) => !plain.has(p)).map((p) => new Minimatch(p, { dot: true }));
    const covered = universe.filter((f) => plain.has(f) || globs.some((m) => m.match(f)));
    const projectCoverage = coveredByProject.get(s.root) ?? new Set<string>();
    for (const file of covered) projectCoverage.add(file);
    coveredByProject.set(s.root, projectCoverage);
    const projectPatterns = patternsByProject.get(s.root) ?? new Set<string>();
    for (const pattern of s.patterns) projectPatterns.add(pattern);
    patternsByProject.set(s.root, projectPatterns);
    const reachable = new Set([...s.members, ...s.beforeShared]);
    return {
      projectId: projects[roots.indexOf(s.root)].id,
      id: `s${String(index + 1).padStart(6, '0')}`,
      memberCount: s.members.length,
      exactClosureBeforeShared: s.beforeShared.length,
      exactClosureAfterShared: s.afterShared.length,
      cap: Number.isFinite(s.cap) ? s.cap : null,
      stage: s.stage,
      outputPatternCount: s.patterns.length,
      coveredFileCount: covered.length,
      extraCoveredFiles: covered.length - s.afterShared.length,
      hubFanIn: s.beforeShared.reduce(
        (max, f) => Math.max(max, measurements.closures.fanIn.get(f) ?? 0),
        0,
      ),
      unresolvedCount: [...reachable].reduce(
        (n, f) => n + (measurements.closures.unresolved.get(f) ?? 0),
        0,
      ),
      unsupportedCount: [...reachable].filter((f) => measurements.closures.unsupported.has(f))
        .length,
      timingsMs: {
        discovery: measurements.discoveryMs,
        resolution: measurements.closures.resolutionMs,
        traversal: measurements.closures.traversalMs,
        inference: s.inferenceMs,
      },
      peakRssBytes: process.resourceUsage().maxRSS * 1024,
      ...(options.raw
        ? {
            root: s.root,
            target: s.name,
            members: s.members,
            exactClosure: s.afterShared,
            patterns: s.patterns,
          }
        : {}),
    };
  });
  const distribution = (values: number[]) => {
    values.sort((a, b) => a - b);
    const percentile = (p: number) =>
      values.length ? values[Math.max(0, Math.ceil(values.length * p) - 1)] : 0;
    return { p50: percentile(0.5), p95: percentile(0.95), max: percentile(1) };
  };
  return {
    version: 1,
    cap: options.cap ?? 'configured',
    projects: projects.map((project, index) => {
      const rows = shards.filter((s) => s.projectId === project.id);
      const reachable = new Set(
        measurements.shards
          .filter((s) => s.root === roots[index])
          .flatMap((s) => [...s.members, ...s.beforeShared]),
      );
      const coveredFileCount = coveredByProject.get(roots[index])?.size ?? 0;
      return {
        ...project,
        stages: Object.fromEntries(
          ['exact', 'directory globs', 'roots'].map((stage) => [
            stage,
            rows.filter((s) => s.stage === stage).length,
          ]),
        ),
        outputPatternCount: patternsByProject.get(roots[index])?.size ?? 0,
        coveredFileCount,
        extraCoveredFiles: coveredFileCount - project.exactClosureAfterShared,
        hubFanIn: rows.reduce((max, s) => Math.max(max, s.hubFanIn), 0),
        unresolvedCount: [...reachable].reduce(
          (n, f) => n + (measurements.closures.unresolved.get(f) ?? 0),
          0,
        ),
        unsupportedCount: [...reachable].filter((f) => measurements.closures.unsupported.has(f))
          .length,
        timingsMs: {
          discovery: measurements.discoveryMs,
          resolution: measurements.closures.resolutionMs,
          traversal: measurements.closures.traversalMs,
          inference: rows.reduce((n, s) => n + s.timingsMs.inference, 0),
        },
        peakRssBytes: process.resourceUsage().maxRSS * 1024,
      };
    }),
    shards,
    summary: {
      projectCount: projects.length,
      shardCount: shards.length,
      stages: Object.fromEntries(
        ['exact', 'directory globs', 'roots'].map((stage) => {
          const count = shards.filter((s) => s.stage === stage).length;
          return [stage, { count, share: shards.length ? count / shards.length : 0 }];
        }),
      ),
      closureBeforeShared: distribution(shards.map((s) => s.exactClosureBeforeShared)),
      closureAfterShared: distribution(shards.map((s) => s.exactClosureAfterShared)),
      extraCoveredFiles: distribution(shards.map((s) => s.extraCoveredFiles)),
      timingsMs: {
        discovery: measurements.discoveryMs,
        resolution: measurements.closures.resolutionMs,
        traversal: measurements.closures.traversalMs,
        inference: measurements.shards.reduce((n, s) => n + s.inferenceMs, 0),
        coverageScan: performance.now() - scanStarted,
        total: performance.now() - started,
      },
      peakRssBytes: process.resourceUsage().maxRSS * 1024,
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // Stock discovery loads local configs. Keep their incidental output local too.
  const stdout = process.stdout.write.bind(process.stdout);
  const stderr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  let raw = false;
  try {
    const args = process.argv.slice(2);
    let workspaceRoot = process.cwd();
    let cap: AnalyzeOptions['cap'];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--raw') raw = true;
      else if (args[i] === '--workspace' && args[i + 1]) workspaceRoot = resolve(args[++i]);
      else if (args[i] === '--cap' && args[i + 1]) {
        const value = args[++i];
        cap = value === 'uncapped' ? value : Number(value);
        if (cap !== 'uncapped' && !(Number.isInteger(cap) && cap >= 0))
          throw new Error('Invalid cap');
      } else throw new Error('Unknown argument');
    }
    const report = await analyze(workspaceRoot, { cap, raw });
    stdout(JSON.stringify(report, null, 2) + '\n');
  } catch (error) {
    stderr(raw ? String(error) + '\n' : 'Analysis failed. Rerun locally with --raw for details.\n');
    process.exitCode = 1;
  } finally {
    process.stdout.write = stdout;
    process.stderr.write = stderr;
  }
}
