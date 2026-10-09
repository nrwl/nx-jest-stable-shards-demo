import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { globWithWorkspaceContext } from 'nx/src/devkit-internals.js';

export interface WorkspaceOwnership {
  /** Package name to its workspace-relative directory. */
  packages: Map<string, string>;
  scopes: Set<string>;
}

/**
 * The files Nx can hash: its own file inventory, which leaves out what
 * `.gitignore` and `.nxignore` exclude at any depth, tracked or not, and
 * Nx's built-in exclusions. A file missing from it contributes nothing to a
 * task hash, however it is named in `inputs`.
 */
export async function hashableFiles(workspaceRoot: string): Promise<Set<string>> {
  return new Set(await globWithWorkspaceContext(workspaceRoot, ['**/*']));
}

/** Inventory hashable source manifests independently of Jest discovery. */
export function workspaceOwnership(
  workspaceRoot: string,
  hashable: Iterable<string>,
): WorkspaceOwnership {
  const packages = new Map<string, string>();
  const scopes = new Set<string>();
  // A nested checkout owns its own manifests, whether .git is a directory or a worktree file.
  const nested = new Map<string, boolean>();
  const inNestedCheckout = (dir: string): boolean => {
    if (dir === '.') return false;
    let known = nested.get(dir);
    if (known === undefined) {
      known = existsSync(join(workspaceRoot, dir, '.git')) || inNestedCheckout(dirname(dir));
      nested.set(dir, known);
    }
    return known;
  };
  const manifests = [...hashable]
    .filter((file) => file === 'package.json' || file.endsWith('/package.json'))
    .sort();
  for (const path of manifests) {
    const dir = dirname(path);
    if (inNestedCheckout(dir)) continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(workspaceRoot, path), 'utf8'));
    } catch {
      manifest = null;
    }
    if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest))
      throw new Error(`jest-shards: invalid workspace manifest ${path}`);
    if (typeof manifest.name !== 'string') continue;
    if (packages.has(manifest.name))
      throw new Error(
        `jest-shards: duplicate workspace package '${manifest.name}' in ` +
          `${join(packages.get(manifest.name)!, 'package.json')} and ${path}`,
      );
    packages.set(manifest.name, dir);
    if (manifest.name.startsWith('@')) scopes.add(manifest.name.split('/')[0]);
  }
  return { packages, scopes };
}

/**
 * Why an import Jest could not resolve is workspace code, or undefined when
 * nothing says it is. Scope ownership is conservative only for failures;
 * resolved published siblings are external.
 */
export function classifyWorkspaceImport(
  specifier: string,
  ownership: WorkspaceOwnership,
  mapperOwned: (specifier: string) => boolean,
): string | undefined {
  if (specifier.startsWith('.')) return 'relative';
  if (specifier.startsWith('/')) return 'absolute';
  const name = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
  if (ownership.packages.has(name)) return 'workspace-package';
  if (mapperOwned(specifier)) return 'mapper-owned';
  if (ownership.scopes.has(specifier.split('/')[0])) return 'workspace-scope';
  return undefined;
}
