import {
  logger,
  type CreateNodes,
  type CreateNodesContext,
  type TargetConfiguration,
} from '@nx/devkit';
import { createNodes as stockJest } from '@nx/jest/plugin';
import { Minimatch } from 'minimatch';
import { existsSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { normalizeOptions, planShards, projectRootOf, type ShardOptions } from './buckets.ts';
import { importClosures } from './closures.ts';
import { JestProjects, type JestProject } from './jest-context.ts';
import { hashableFiles, workspaceOwnership } from './ownership.ts';

const WS = '{workspaceRoot}/';
const FILE_TARGET = 'jest-file--';

interface DiscoveredProject {
  configFile: string;
  root: string;
  /** Project-relative, sorted. */
  tests: string[];
}

/**
 * Adds `test-ci--kk` targets to every project with a Jest config. Each target
 * runs one stable hash bucket of the project's tests. Its inputs are its
 * members plus their import closures, so an edit only reaches the shards whose
 * tests can observe it.
 */
export const createNodes: CreateNodes<Partial<ShardOptions>> = [
  stockJest[0],
  async (configFiles, rawOptions, context) => {
    const options = normalizeOptions(rawOptions);
    const projects = await discover(configFiles, context);
    const testFiles = projects.flatMap((p) => p.tests.map((t) => join(p.root, t)));
    checkDiscovery(testFiles, options.isolate);

    const jest = new JestProjects(context.workspaceRoot);
    const loaded = new Map<string, JestProject>();
    for (const project of projects) {
      const jestProject = await jest.load(project.configFile);
      checkRootDir(context.workspaceRoot, project, jestProject);
      loaded.set(project.configFile, jestProject);
    }

    const sharedFiles = options.sharedInputs.flatMap((input) =>
      typeof input === 'string' && /^\{workspaceRoot\}\/[^*?[\]{}!]+\.[cm]?[jt]sx?$/.test(input)
        ? [input.slice(WS.length)]
        : [],
    );
    const hashable = await hashableFiles(context.workspaceRoot);
    const { closureOf, external } = await importClosures(
      context.workspaceRoot,
      [
        ...sharedFiles.map((file) => ({
          file,
          context: jest.node,
          config: `shared input ${file}`,
        })),
        ...projects.flatMap(({ configFile, root, tests }) => {
          const { context, nodeLoaded, jestLoaded } = loaded.get(configFile)!;
          const config = `${root} (${configFile})`;
          return [
            ...nodeLoaded.map((file) => ({ file, context: jest.node, config })),
            ...[...jestLoaded, ...tests.map((t) => join(root, t))].map((file) => ({
              file,
              context,
              config,
            })),
          ];
        }),
      ],
      { hashable, ownership: workspaceOwnership(context.workspaceRoot, hashable) },
    );
    if (external.length > 0) {
      logger.warn(
        `jest-shards: Jest cannot resolve ${external.length} imports of names no workspace ` +
          `package, scope or mapper claims; they are not inputs: ${external.slice(0, 5).join(', ')}` +
          (external.length > 5 ? ', ...' : ''),
      );
    }
    const allTests = new Set(testFiles);

    // Declared shared files are loaded outside any test's imports, so their
    // own imports go to every shard.
    const shared = new Set(sharedFiles.flatMap((file) => [file, ...closureOf(jest.node, file)]));
    const sharedInputs = [
      ...options.sharedInputs,
      ...[...shared]
        .filter((file) => !sharedFiles.includes(file))
        .sort()
        .map(exact),
    ];

    return projects.map(({ configFile, root, tests }) => {
      const plan = planShards(root, tests, options);
      const width = Math.max(2, String(plan.shardCount).length);
      const members = new Map<number, string[]>();
      for (const [test, shard] of plan.shardOf) {
        members.set(shard, [...(members.get(shard) ?? []), join(root, test)]);
      }

      // What Jest loads for every test of this project, found in its config:
      // the config and preset, transformers, a custom resolver, setup files
      // and the like, each with its own imports.
      const { context: resolution, nodeLoaded, jestLoaded } = loaded.get(configFile)!;
      const projectShared = new Set<string>();
      for (const file of nodeLoaded) {
        for (const dep of [file, ...closureOf(jest.node, file)]) projectShared.add(dep);
      }
      for (const file of jestLoaded) {
        for (const dep of [file, ...closureOf(resolution, file)]) projectShared.add(dep);
      }
      const projectSharedInputs = [...projectShared]
        .filter((file) => !shared.has(file) && file !== configFile)
        .sort()
        .map(exact);

      const targets: Record<string, TargetConfiguration> = {};
      for (const shard of [...members.keys()].sort((a, b) => a - b)) {
        const name = `test-ci--${String(shard).padStart(width, '0')}`;
        const files = members.get(shard)!;
        const source = new Set<string>();
        for (const file of files) {
          for (const dep of closureOf(resolution, file)) {
            if (allTests.has(dep)) throw new Error(`jest-shards: ${file} imports the test ${dep}`);
            if (!shared.has(dep) && !projectShared.has(dep)) source.add(dep);
          }
        }
        targets[name] = {
          executor: 'nx:run-commands',
          cache: true,
          inputs: [
            ...files.map(exact),
            ...files.map((f) => exact(`${dirname(f)}/__snapshots__/${basename(f)}.snap`)),
            exact(configFile),
            exact(join(root, 'package.json')),
            ...sharedInputs,
            ...projectSharedInputs,
            ...capClosure(context.workspaceRoot, [...source].sort(), options, `${root}:${name}`),
          ],
          outputs: [],
          options: {
            // Constant per shard: membership lives only in `inputs`, so adding a
            // test changes one shard's hash and leaves the project config alone.
            command:
              `jest -c ${basename(configFile)} --shard=${shard}/${plan.shardCount}` +
              ' --runInBand --coverage=false --watch=false',
            cwd: root,
            forwardAllArgs: false,
          },
          metadata: {
            technologies: ['jest'],
            description: `Jest shard ${shard} of ${plan.shardCount} (stable hash buckets)`,
          },
        };
      }
      return [configFile, { projects: { [root]: { targets } } }] as const;
    });
  },
];

/** Test discovery is the stock @nx/jest fast matcher, read from its per-file target names. */
async function discover(
  configFiles: readonly string[],
  context: CreateNodesContext,
): Promise<DiscoveredProject[]> {
  const stockOptions = { targetName: 'jest', ciTargetName: 'jest-file', disableJestRuntime: true };
  const results = await stockJest[1](configFiles, stockOptions, context);
  return results.flatMap(([configFile, result]) =>
    Object.entries(result.projects ?? {}).map(([root, project]) => ({
      configFile,
      root,
      tests: Object.keys(project.targets ?? {})
        .filter((name) => name.startsWith(FILE_TARGET))
        .map((name) => name.slice(FILE_TARGET.length))
        .sort(),
    })),
  );
}

/**
 * The sequencer only knows Jest's `rootDir`, and finds the project root from
 * it the same way, so the two must agree on which project a test belongs to.
 */
function checkRootDir(workspaceRoot: string, project: DiscoveredProject, jest: JestProject) {
  const root = relative(workspaceRoot, projectRootOf(jest.rootDir, workspaceRoot)) || '.';
  if (root !== project.root) {
    throw new Error(
      `jest-shards: ${project.configFile} sets rootDir to ` +
        `${relative(workspaceRoot, jest.rootDir) || '.'}, which is not inside its project ` +
        `(${project.root}) or belongs to a nested Jest config (${root})`,
    );
  }
}

function checkDiscovery(testFiles: string[], isolate: string[]) {
  const seen = new Set<string>();
  for (const file of testFiles) {
    // A parent config that does not ignore a nested child root runs its tests twice.
    if (seen.has(file)) throw new Error(`jest-shards: ${file} is discovered by two Jest configs`);
    seen.add(file);
  }
  const unknown = isolate.filter((file) => !seen.has(file));
  if (unknown.length > 0) {
    throw new Error(
      `jest-shards: isolate names tests Jest does not discover: ${unknown.join(', ')}`,
    );
  }
}

/**
 * Keeps a shard's source closure within `maxClosureInputs` by widening it to
 * directory globs, then to project-root globs. Every stage is a superset of
 * the exact list, and the assertion below checks that.
 */
function capClosure(
  workspaceRoot: string,
  files: string[],
  { maxClosureInputs: max }: ShardOptions,
  label: string,
): string[] {
  let patterns = files.map(exact);
  if (patterns.length > max) {
    patterns = unique(files.map((f) => WS + globUnder(dirname(f), '*', f)));
    logger.warn(
      `jest-shards: ${label} closure of ${files.length} files exceeds maxClosureInputs ${max}; using ${patterns.length} directory globs`,
    );
  }
  if (patterns.length > max) {
    patterns = unique(files.map((f) => WS + globUnder(ownerDir(workspaceRoot, f), '**/*', f)));
    logger.warn(
      `jest-shards: ${label} still exceeds maxClosureInputs ${max}; using ${patterns.length} project-root globs`,
    );
  }
  // Plain paths match themselves; only globs and escaped paths need a matcher.
  const globs = patterns.map((p) => p.slice(WS.length));
  const plain = new Set(globs.filter((p) => !/[*?[\]{}!\\]/.test(p)));
  const matchers = globs.filter((p) => !plain.has(p)).map((p) => new Minimatch(p, { dot: true }));
  const uncovered = files.find((f) => !plain.has(f) && !matchers.some((m) => m.match(f)));
  if (uncovered) throw new Error(`jest-shards: ${label} inputs do not cover ${uncovered}`);
  return patterns;
}

/** The nearest enclosing project root, or else the file's top-level directory. */
function ownerDir(workspaceRoot: string, file: string): string {
  for (let dir = dirname(file); dir !== '.'; dir = dirname(dir)) {
    const isRoot = ['project.json', 'package.json'].some((f) =>
      existsSync(join(workspaceRoot, dir, f)),
    );
    if (isRoot) return dir;
  }
  return file.split('/')[0];
}

function globUnder(dir: string, glob: string, file: string): string {
  if (dir === '.' || dir === file) return escapeGlob(file);
  return `${escapeGlob(dir)}/${glob}`;
}

function exact(file: string): string {
  return WS + escapeGlob(file);
}

function escapeGlob(path: string): string {
  if (path.includes('\\')) throw new Error(`jest-shards: cannot express ${path} as an Nx input`);
  // Nx reads ( ) | as extglob syntax with no escape; `?` matches the character instead.
  return path.replace(/[*?[\]{}!]/g, '\\$&').replace(/[()|]/g, '?');
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
