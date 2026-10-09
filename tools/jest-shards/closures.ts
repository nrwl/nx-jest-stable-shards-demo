import { cruise } from 'dependency-cruiser';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import type { ResolutionContext } from './jest-context.ts';
import { classifyWorkspaceImport, type WorkspaceOwnership } from './ownership.ts';

/** A file whose imports are followed under one project's resolution. */
export interface ClosureRoot {
  /** Workspace-relative. */
  file: string;
  context: ResolutionContext;
  /** Names the project and its Jest config in errors. */
  config: string;
}

export interface Workspace {
  /** The files Nx can hash, workspace-relative. */
  hashable: Set<string>;
  ownership: WorkspaceOwnership;
}

/** Files dependency-cruiser reads specifiers from; anything else Jest resolves is a leaf. */
const SCANNED = /\.[cm]?[jt]sx?$/;

/**
 * Builds the import graph under every root's own resolution context.
 * dependency-cruiser only extracts each file's static specifiers; the
 * context's Jest resolver decides what they mean, and every workspace file
 * it names is extracted and traversed in turn. A root that cannot be read,
 * a file Nx cannot hash, or a workspace import Jest cannot resolve, fails the
 * graph: a silently smaller closure would let a shard keep a stale cache
 * hit. Jest's own failure is not trusted to mean "external": the raw
 * specifier is classified against the workspace's packages, scopes and the
 * project's mappers. Only a name nothing claims is left out, and reported in
 * `external`.
 */
export async function importClosures(
  workspaceRoot: string,
  roots: ClosureRoot[],
  { hashable, ownership }: Workspace,
): Promise<{
  closureOf: (context: ResolutionContext, file: string) => Set<string>;
  /** Unresolved imports of names the workspace does not own: `importer: 'specifier'`. */
  external: string[];
}> {
  /** Context key, then importer, to the workspace files it resolves to. */
  const edges = new Map<string, Map<string, string[]>>();
  const specifiersOf = new Map<string, string[]>();
  const parsed = new Map<string, string[]>();
  const manifests = new Map<string, string | null>();
  const problems = new Set<string>();
  const external = new Set<string>();
  const entrypoints = new Set(roots);

  const queued = new Set<string>();
  let wave: ClosureRoot[] = [];
  const enqueue = (root: ClosureRoot, into: ClosureRoot[]) => {
    const id = `${root.context.key}\0${root.file}`;
    if (queued.has(id)) return;
    queued.add(id);
    into.push(root);
  };
  for (const root of roots) enqueue(root, wave);

  while (wave.length > 0) {
    const unread = await extract(
      workspaceRoot,
      [...new Set(wave.map((entry) => entry.file))].filter((file) => !specifiersOf.has(file)),
      parsed,
      specifiersOf,
    );
    const next: ClosureRoot[] = [];
    for (const entry of wave) {
      const { file, context, config } = entry;
      if (unread.has(file)) {
        const classification = entrypoints.has(entry) ? 'graph-entrypoint' : 'workspace-file';
        problems.add(`project/config ${config}: ${file}: '${file}' (${classification})`);
        continue;
      }
      const followed = new Set<string>();
      for (const specifier of specifiersOf.get(file)!) {
        for (const resolution of context.resolve(file, specifier)) {
          if (resolution.kind === 'error') {
            const classification = classifyWorkspaceImport(specifier, ownership, (name) =>
              context.maps(name),
            );
            if (!classification) external.add(`${file}: '${specifier}'`);
            else
              problems.add(
                `project/config ${config}: ${file}: '${specifier}' (${classification}): ` +
                  resolution.message,
              );
          } else if (resolution.kind === 'workspace') {
            followed.add(resolution.file);
            enqueue({ file: resolution.file, context, config }, next);
            // A package name resolves through its manifest (`main`, `exports`).
            if (!/^[./]/.test(specifier)) {
              const manifest = nearestManifest(workspaceRoot, resolution.file, manifests);
              if (manifest) followed.add(manifest);
            }
          }
        }
      }
      let contextEdges = edges.get(context.key);
      if (!contextEdges) edges.set(context.key, (contextEdges = new Map()));
      contextEdges.set(file, [...followed]);
    }
    wave = next;
  }

  // Roots count as well as what they reach: a setup file with no imports is
  // an input all the same.
  const inputs = new Set<string>();
  for (const contextEdges of edges.values()) {
    for (const [file, targets] of contextEdges) {
      inputs.add(file);
      for (const target of targets) inputs.add(target);
    }
  }
  for (const file of [...inputs].sort()) {
    if (hashable.has(file)) continue;
    problems.add(
      `${file} is loaded or imported, but Nx does not hash it: .gitignore or .nxignore ` +
        'excludes it. Stop ignoring it, or map the import to hashed source or a mock in ' +
        'moduleNameMapper',
    );
  }
  if (problems.size > 0) {
    const shown = [...problems].slice(0, 50);
    if (problems.size > shown.length) shown.push(`and ${problems.size - shown.length} more`);
    throw new Error(
      'jest-shards: cannot resolve or read these workspace imports. Jest resolves them the ' +
        "same way: fix the import or the project's moduleNameMapper:\n  " +
        shown.join('\n  '),
    );
  }

  const closureOf = (context: ResolutionContext, root: string) => {
    const contextEdges = edges.get(context.key);
    const seen = new Set<string>([root]);
    const queue = [root];
    for (const file of queue) {
      for (const target of contextEdges?.get(file) ?? []) {
        if (seen.has(target)) continue;
        seen.add(target);
        queue.push(target);
      }
    }
    seen.delete(root);
    return seen;
  };
  return { closureOf, external: [...external].sort() };
}

/**
 * Fills `specifiersOf` for `files` and returns those it could not read.
 * Parsing is memoised by content, so identical files are parsed once per
 * graph build.
 */
async function extract(
  workspaceRoot: string,
  files: string[],
  parsed: Map<string, string[]>,
  specifiersOf: Map<string, string[]>,
): Promise<Set<string>> {
  const unread = new Set<string>();
  /** Content key to the files waiting on it; the first one is parsed. */
  const waiting = new Map<string, string[]>();
  for (const file of files) {
    if (!SCANNED.test(file)) {
      specifiersOf.set(file, []);
      if (!existsSync(join(workspaceRoot, file))) unread.add(file);
      continue;
    }
    let content: Buffer;
    try {
      content = readFileSync(join(workspaceRoot, file));
    } catch {
      unread.add(file);
      continue;
    }
    // The extension picks the parser, so it is part of the identity.
    const key = createHash('sha1').update(extname(file)).update('\0').update(content).digest('hex');
    const known = parsed.get(key);
    if (known) specifiersOf.set(file, known);
    else waiting.set(key, [...(waiting.get(key) ?? []), file]);
  }
  if (waiting.size === 0) return unread;

  const representatives = new Map([...waiting].map(([key, [first]]) => [first, key]));
  const modules = await cruiseSpecifiers(workspaceRoot, [...representatives.keys()]);
  for (const [file, key] of representatives) {
    const specifiers = modules.get(file);
    if (!specifiers) throw new Error(`jest-shards: dependency-cruiser did not read ${file}`);
    parsed.set(key, specifiers);
    for (const waiter of waiting.get(key)!) specifiersOf.set(waiter, specifiers);
  }
  return unread;
}

/** The raw static specifiers of exactly `files`: nothing is resolved for us or followed. */
async function cruiseSpecifiers(
  workspaceRoot: string,
  files: string[],
): Promise<Map<string, string[]>> {
  const { output } = await cruise(files, {
    baseDir: workspaceRoot,
    // Read the listed files only. Without `doNotFollow`, a file that is both
    // listed and imported by an earlier one would come back with no imports.
    maxDepth: 1,
    doNotFollow: { path: '.' },
    // Only the specifiers are needed; this halves a cold run at 21k tests.
    skipAnalysisNotInRules: true,
  });
  if (typeof output === 'string')
    throw new Error('jest-shards: unexpected dependency-cruiser output');
  const result = new Map<string, string[]>();
  for (const module of output.modules) {
    // An import target that was not followed is listed too, as a stub.
    if ('followable' in module) continue;
    result.set(
      module.source,
      module.dependencies.map((dependency) => dependency.module),
    );
  }
  return result;
}

function nearestManifest(
  workspaceRoot: string,
  file: string,
  memo: Map<string, string | null>,
): string | null {
  const dir = dirname(file);
  if (dir === '.') return null;
  let manifest = memo.get(dir);
  if (manifest === undefined) {
    manifest = existsSync(join(workspaceRoot, dir, 'package.json'))
      ? join(dir, 'package.json')
      : nearestManifest(workspaceRoot, dir, memo);
    memo.set(dir, manifest);
  }
  return manifest;
}
