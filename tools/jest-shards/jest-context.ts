import type { Config } from '@jest/types';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

// The consumer's own Jest packages (CommonJS). This file is the only place
// that touches them, and it is written against 29.x: `readConfig` and
// `readInitialOptions` from jest-config, `Runtime.createResolver` (the factory
// Jest's runtime builds its resolver with), `ModuleMap.create` and the
// `Resolver` methods `isCoreModule`, `resolveModule` and `findNodeModule`.
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

/** A file path relative to the workspace root, a Node core module, or why Jest could not resolve. */
export type Resolution =
  | { kind: 'workspace'; file: string }
  | { kind: 'external' }
  | { kind: 'core' }
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
  readonly #conditions: string[];
  readonly #memo = new Map<string, Resolution>();

  constructor(key: string, workspaceRoot: string, resolver: JestResolver, conditions: string[]) {
    this.key = key;
    this.#workspaceRoot = workspaceRoot;
    this.#resolver = resolver;
    this.#conditions = conditions;
  }

  /** `importer` is workspace-relative. */
  resolve(importer: string, specifier: string): Resolution {
    // Jest resolves against the importer's directory, so that is the memo key.
    const memoKey = `${dirname(importer)}\0${specifier}`;
    let resolution = this.#memo.get(memoKey);
    if (!resolution) {
      resolution = this.#resolve(join(this.#workspaceRoot, importer), specifier);
      this.#memo.set(memoKey, resolution);
    }
    return resolution;
  }

  #resolve(importer: string, specifier: string): Resolution {
    // The runtime's order: a core module unless a mapper claims the name
    // (`isCoreModule` checks that), then mappers, then node resolution.
    if (this.#resolver.isCoreModule(specifier)) return { kind: 'core' };
    let resolved: string;
    try {
      resolved = this.#resolver.resolveModule(importer, specifier, {
        conditions: this.#conditions,
      });
    } catch (error) {
      return { kind: 'error', message: firstLines(error) };
    }
    return classify(this.#workspaceRoot, resolved);
  }
}

/**
 * A workspace package linked into `node_modules` is workspace code, so the
 * real location decides, not the path the resolver walked.
 */
function classify(workspaceRoot: string, resolved: string): Resolution {
  let real: string;
  try {
    real = realpathSync(resolved);
  } catch {
    return { kind: 'error', message: `resolves to ${resolved}, which cannot be read` };
  }
  if (real.split(sep).includes('node_modules')) return { kind: 'external' };
  const file = relative(workspaceRoot, real);
  if (file.startsWith('..') || isAbsolute(file)) {
    return {
      kind: 'error',
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
    // A config edited since the last graph build in this process must be read again.
    for (const file of Object.keys(require.cache)) {
      if (classify(workspaceRoot, file).kind === 'workspace') delete require.cache[file];
    }
    this.node = new ResolutionContext(
      'node',
      workspaceRoot,
      new Resolver(ModuleMap.create(workspaceRoot), {
        extensions: ['.js', '.cjs', '.mjs', '.json', '.node', '.ts', '.cts', '.mts'],
        hasCoreModules: true,
        moduleDirectories: ['node_modules'],
        rootDir: workspaceRoot,
      }),
      ['node', 'require', 'default'],
    );
  }

  /** Loads one config with Jest's loader: presets, async and TypeScript configs included. */
  async load(configFile: string): Promise<JestProject> {
    const path = join(this.#workspaceRoot, configFile);
    const fail = (message: string): never => {
      throw new Error(`jest-shards: ${configFile}: ${message}`);
    };
    const { config: initial } = await readInitialOptions(path);
    if (initial.projects) fail('multi-project (`projects:`) configs are not supported');
    const { projectConfig, globalConfig } = await readConfig({ _: [], $0: '' }, path);

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
        conditions,
      );
      this.#contexts.set(key, context);
    }

    return {
      configFile,
      rootDir: projectConfig.rootDir,
      context,
      nodeLoaded: this.#workspaceFiles([
        path,
        presetFile(initial, projectConfig.rootDir),
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
      jestLoaded: this.#workspaceFiles([
        ...projectConfig.setupFiles,
        ...projectConfig.setupFilesAfterEnv,
        ...projectConfig.snapshotSerializers,
      ]),
    };
  }

  #workspaceFiles(paths: (string | null | undefined)[]): string[] {
    const files = new Set<string>();
    for (const path of paths) {
      if (!path || !isAbsolute(path)) continue;
      const resolution = classify(this.#workspaceRoot, path);
      if (resolution.kind === 'workspace') files.add(resolution.file);
    }
    return [...files];
  }
}

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
function presetFile(initial: Config.InitialOptions, rootDir: string): string | null {
  if (!initial.preset) return null;
  const preset = replaceRootDirInPath(rootDir, initial.preset);
  return Resolver.findNodeModule(preset.startsWith('.') ? preset : join(preset, 'jest-preset'), {
    basedir: rootDir,
    extensions: ['.json', '.js', '.cjs', '.mjs'],
  });
}
