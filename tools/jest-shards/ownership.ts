import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createGitIgnoreChecker, FsTree } from 'nx/src/devkit-internals.js';

export interface WorkspaceOwnership {
  packages: Map<string, string>;
  scopes: Set<string>;
  fingerprint: string;
}

/** Inventory nonignored source manifests independently of Jest discovery. */
export function workspaceOwnership(workspaceRoot: string): WorkspaceOwnership {
  const packages = new Map<string, string>();
  const scopes = new Set<string>();
  const hash = createHash('sha256');
  const ignored = createGitIgnoreChecker(new FsTree(workspaceRoot, false));
  function visit(dir: string) {
    // A nested checkout owns its own manifests, whether .git is a directory or a worktree file.
    if (dir && existsSync(join(workspaceRoot, dir, '.git'))) return;
    const entries = readdirSync(join(workspaceRoot, dir), { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && !ignored.isIgnoredDirectory(path)) visit(path);
      else if (entry.isFile() && entry.name === 'package.json' && !ignored.isIgnoredFile(path)) {
        const content = readFileSync(join(workspaceRoot, path), 'utf8');
        hash.update(JSON.stringify([path, content]));
        let manifest;
        try {
          manifest = JSON.parse(content);
        } catch {
          throw new Error(`jest-shards: invalid workspace manifest ${path}`);
        }
        if (typeof manifest.name !== 'string') continue;
        if (packages.has(manifest.name))
          throw new Error(
            `jest-shards: duplicate workspace package '${manifest.name}' in ` +
              `${join(packages.get(manifest.name)!, 'package.json')} and ${path}`,
          );
        packages.set(manifest.name, dir || '.');
        if (manifest.name.startsWith('@')) scopes.add(manifest.name.split('/')[0]);
      }
    }
  }
  visit('');
  return { packages, scopes, fingerprint: hash.digest('hex') };
}

/** Scope ownership is conservative only for failures; resolved published siblings are external. */
export function classifyWorkspaceImport(
  specifier: string,
  ownership: WorkspaceOwnership,
  prefixes: string[],
): string | undefined {
  if (specifier.startsWith('.')) return 'relative';
  if (specifier.startsWith('/')) return 'absolute';
  const name = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
  if (ownership.packages.has(name)) return 'workspace-package';
  if (prefixes.some((p) => specifier === p || specifier.startsWith(p.endsWith('/') ? p : p + '/')))
    return 'alias-owned';
  if (ownership.scopes.has(specifier.split('/')[0])) return 'workspace-scope';
  return undefined;
}
