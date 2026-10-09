import type { Config } from '@jest/types';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

// The consumer's own Jest packages (CommonJS). This file is the only place
// that touches them, and it is written against 29.x: `readConfig` and
// `readInitialOptions` from jest-config, `Runtime.createResolver` (the factory
// Jest's runtime builds its resolver with), `ModuleMap.create` and the
// `Resolver` methods `isCoreModule`, `resolveModule`, `findNodeModule` and
// `clearDefaultResolverCache`.
const require = createRequire(import.meta.url);
const SUPPORTED_JEST = '29.';
for (const name of ['jest-config', 'jest-runtime', 'jest-resolve', 'jest-haste-map']) {
  const { version } = require(`${name}/package.json`);
  if (!version.startsWith(SUPPORTED_JEST)) {
    throw new Error(
      `jest-shards: the resolution adapter supports ${name} ${SUPPORTED_JEST}x, found ${version}`,
    );
  }
}
const { readConfig, readInitialOptions, replaceRootDirInPath } =
  require('jest-config') as typeof import('jest-config');
const Runtime = require('jest-runtime').default as typeof import('jest-runtime').default;
const { ModuleMap } = require('jest-haste-map') as typeof import('jest-haste-map');
const Resolver = require('jest-resolve').default as typeof import('jest-resolve').default;
type JestResolver = InstanceType<typeof Resolver>;

/**
 * A file path relative to the workspace root, a Node core module, a file Jest
 * resolves to that Nx cannot hash, or why Jest could not resolve.
 */
export type Resolution =
  | { kind: 'workspace'; file: string }
  | { kind: 'external' }
  | { kind: 'core' }
  | { kind: 'unhashable'; message: string }
  | { kind: 'error'; message: string };

/**
 * Resolves specifiers the way one Jest configuration does. Projects whose
 * resolution settings are identical share one context, and with it the
 * resolution memo and the closures built from it.
 */
export class ResolutionContext {
  readonly key: string;
  readonly #workspaceRoot: string;
  readonly #resolver: JestResolver;
  /** One set per way the importer may be loaded; a Jest context has exactly one. */
  readonly #conditions: string[][];
  readonly #mappers: RegExp[];
  readonly #memo = new Map<string, Resolution[]>();

  constructor(
    key: string,
    workspaceRoot: string,
    resolver: JestResolver,
    conditions: string[][],
    mappers: RegExp[] = [],
  ) {
    this.key = key;
    this.#workspaceRoot = workspaceRoot;
    this.#resolver = resolver;
    this.#conditions = conditions;
    this.#mappers = mappers;
  }

  /** Whether a `moduleNameMapper` pattern claims the specifier, resolved or not. */
  maps(specifier: string): boolean {
    return this.#mappers.some((pattern) => pattern.test(specifier));
  }

  /**
   * `importer` is workspace-relative. Every file the specifier can load is
   * returned: one per condition set, without repeats. A condition set that
   * does not resolve is an error only when none does; one that resolves to a
   * file Nx cannot hash is always returned.
   */
  resolve(importer: string, specifier: string): Resolution[] {
    // Jest resolves against the importer's directory, so that is the memo key.
    const memoKey = `${dirname(importer)}\0${specifier}`;
    let resolutions = this.#memo.get(memoKey);
    if (!resolutions) {
      resolutions = this.#resolve(join(this.#workspaceRoot, importer), specifier);
      this.#memo.set(memoKey, resolutions);
    }
    return resolutions;
  }

  #resolve(importer: string, specifier: string): Resolution[] {
    // The runtime's order: a core module unless a mapper claims the name
    // (`isCoreModule` checks that), then mappers, then node resolution.
    if (this.#resolver.isCoreModule(specifier)) return [{ kind: 'core' }];
    const found = new Map<string, Resolution>();
    const errors: Resolution[] = [];
    for (const conditions of this.#conditions) {
      let resolution: Resolution;
      try {
        resolution = classify(
          this.#workspaceRoot,
          this.#resolver.resolveModule(importer, specifier, { conditions }),
        );
      } catch (error) {
        resolution = { kind: 'error', message: firstLines(error) };
      }
      if (resolution.kind === 'error') errors.push(resolution);
      else found.set(identity(resolution), resolution);
    }
    return found.size > 0 ? [...found.values()] : errors.slice(0, 1);
  }
}

function identity(resolution: Resolution): string {
  if (resolution.kind === 'workspace') return resolution.file;
  if (resolution.kind === 'unhashable') return `\0${resolution.message}`;
  return resolution.kind;
}

/**
 * A workspace package linked into `node_modules` is workspace code, so the
 * real location decides, not the path the resolver walked. The same goes for
 * a link that leaves the workspace: Jest runs that file, and Nx has no hash
 * for it.
 */
function classify(workspaceRoot: string, resolved: string): Resolution {
  let real: string;
  try {
    real = realpathSync(resolved);
  } catch {
    return { kind: 'unhashable', message: `resolves to ${resolved}, which cannot be read` };
  }
  if (real.split(sep).includes('node_modules')) return { kind: 'external' };
  const file = relative(workspaceRoot, real);
  if (file.startsWith('..') || isAbsolute(file)) {
    return {
      kind: 'unhashable',
      message: `resolves to ${real}, outside the workspace, which Nx cannot hash`,
    };
  }
  return { kind: 'workspace', file };
}

function firstLines(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Jest's mapper failure explains itself over several lines; keep the facts.
  return message
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
    .join(' ');
}

export interface JestProject {
  /** Workspace-relative. */
  configFile: string;
  /** Jest's normalized `rootDir`, absolute. */
  rootDir: string;
  context: ResolutionContext;
  /**
   * Workspace files Node loads for every test of the project, outside Jest's
   * module system: the config, its preset, transformers, a custom resolver,
   * the environment, the sequencer and the like.
   */
  nodeLoaded: string[];
  /** Workspace files Jest's module system loads for every test: setup files and serializers. */
  jestLoaded: string[];
}

export class JestProjects {
  readonly #workspaceRoot: string;
  readonly #contexts = new Map<string, ResolutionContext>();
  /** For what Node itself loads: no mappers, default settings. */
  readonly node: ResolutionContext;

  constructor(workspaceRoot: string) {
    this.#workspaceRoot = workspaceRoot;
    // A graph process outlives a build, and what was read for the last one
    // may have changed since: configs in Node's module cache, and the file
    // checks, real paths and package manifests jest-resolve keeps for the
    // whole process.
    for (const file of Object.keys(require.cache)) {
      if (classify(workspaceRoot, file).kind === 'workspace') delete require.cache[file];
    }
    Resolver.clearDefaultResolverCache();
    this.node = new ResolutionContext(
      'node',
      workspaceRoot,
      new Resolver(ModuleMap.create(workspaceRoot), {
        extensions: ['.js', '.cjs', '.mjs', '.json', '.node', '.ts', '.cts', '.mts'],
        hasCoreModules: true,
        moduleDirectories: ['node_modules'],
        rootDir: workspaceRoot,
      }),
      // Node picks a package export by how the importer loads it, and that
      // is not known here: a TypeScript config's `import` may run as a
      // `require`. Both branches are inputs, so the one Node runs is among them.
      [
        [...NODE_CONDITIONS, 'require'],
        [...NODE_CONDITIONS, 'import'],
      ],
    );
  }

  /** Loads one config with Jest's loader: presets, async and TypeScript configs included. */
  async load(configFile: string): Promise<JestProject> {
    const path = join(this.#workspaceRoot, configFile);
    const fail = (message: string): never => {
      throw new Error(`jest-shards: ${configFile}: ${message}`);
    };
    // The one evaluation of the config file. Normalizing the options it
    // returned, instead of the path, keeps an async config from running twice.
    const { config: initial } = await readInitialOptions(path);
    if (initial.projects) fail('multi-project (`projects:`) configs are not supported');
    const preset = initial.preset;
    const { projectConfig, globalConfig } = await readConfig(
      { _: [], $0: '' },
      initial,
      false,
      dirname(path),
    );

    const conditions = exportConditions(projectConfig) ?? fail(UNKNOWN_ENVIRONMENT);
    // Everything Jest's resolver reads. `rootDir` is already substituted into
    // these, and it only matters on its own to a custom resolver.
    const key = JSON.stringify([
      projectConfig.moduleNameMapper,
      projectConfig.moduleDirectories,
      projectConfig.modulePaths,
      projectConfig.moduleFileExtensions,
      projectConfig.haste.defaultPlatform,
      projectConfig.haste.platforms,
      projectConfig.resolver ? [projectConfig.resolver, projectConfig.rootDir] : null,
      conditions,
    ]);
    let context = this.#contexts.get(key);
    if (!context) {
      context = new ResolutionContext(
        key,
        this.#workspaceRoot,
        Runtime.createResolver(projectConfig, ModuleMap.create(projectConfig.rootDir)),
        [conditions],
        (projectConfig.moduleNameMapper ?? []).map(([pattern]) => new RegExp(pattern)),
      );
      this.#contexts.set(key, context);
    }

    return {
      configFile,
      rootDir: projectConfig.rootDir,
      context,
      nodeLoaded: this.#workspaceFiles(fail, [
        path,
        presetFile(preset, projectConfig.rootDir),
        ...projectConfig.transform.map(([, transformer]) => transformer),
        projectConfig.resolver,
        projectConfig.testEnvironment,
        projectConfig.testRunner,
        projectConfig.runner,
        projectConfig.globalSetup,
        projectConfig.globalTeardown,
        projectConfig.snapshotResolver,
        projectConfig.dependencyExtractor,
        globalConfig.testSequencer,
      ]),
      jestLoaded: this.#workspaceFiles(fail, [
        ...projectConfig.setupFiles,
        ...projectConfig.setupFilesAfterEnv,
        ...projectConfig.snapshotSerializers,
      ]),
    };
  }

  #workspaceFiles(
    fail: (message: string) => never,
    paths: (string | null | undefined)[],
  ): string[] {
    const files = new Set<string>();
    for (const path of paths) {
      if (!path || !isAbsolute(path)) continue;
      const resolution = classify(this.#workspaceRoot, path);
      if (resolution.kind === 'workspace') files.add(resolution.file);
      else if (resolution.kind === 'unhashable') fail(`loads ${path}: ${resolution.message}`);
    }
    return [...files];
  }
}

const NODE_CONDITIONS = ['node', 'node-addons', 'default'];

const UNKNOWN_ENVIRONMENT =
  'cannot tell which package export conditions its testEnvironment uses; ' +
  'set testEnvironmentOptions.customExportConditions';

/**
 * Jest asks the environment instance for these. Building one per project is
 * too costly at graph time, so this reads the option the stock environments
 * honor and otherwise knows only their defaults.
 */
function exportConditions(config: Config.ProjectConfig): string[] | undefined {
  const custom = config.testEnvironmentOptions.customExportConditions;
  let environment: string[];
  if (Array.isArray(custom) && custom.every((c) => typeof c === 'string')) environment = custom;
  else if (/[\\/]jest-environment-node[\\/]/.test(config.testEnvironment))
    environment = ['node', 'node-addons'];
  else if (/[\\/]jest-environment-jsdom[\\/]/.test(config.testEnvironment))
    environment = ['browser'];
  else return undefined;
  return ['require', 'default', ...environment];
}

/** The preset module, found the way jest-config's `setupPreset` finds it. */
function presetFile(declared: string | null | undefined, rootDir: string): string | null {
  if (!declared) return null;
  const preset = replaceRootDirInPath(rootDir, declared);
  return Resolver.findNodeModule(preset.startsWith('.') ? preset : join(preset, 'jest-preset'), {
    basedir: rootDir,
    extensions: ['.json', '.js', '.cjs', '.mjs'],
  });
}
