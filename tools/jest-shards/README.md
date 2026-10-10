# jest-shards

An Nx plugin that splits each project's Jest tests into stable shards. Each shard is a `test-ci--kk` target on the owning project. Its inputs are the shard's tests plus everything those tests import, so `nx affected` selects only the shards a change can reach, and untouched shards stay cache hits.

| File              | Role                                                                           |
| ----------------- | ------------------------------------------------------------------------------ |
| `plugin.ts`       | `createNodes`: discovery, shard targets, inputs, closure cap                   |
| `buckets.ts`      | Options and the bucket policy, shared by the plugin and the sequencer          |
| `sequencer.ts`    | Jest `testSequencer` that runs one bucket per `--shard=k/shardCount`           |
| `jest-context.ts` | Loads each Jest config and resolves specifiers with that project's resolver    |
| `closures.ts`     | Extracts specifiers with dependency-cruiser and builds the per-project closure |
| `plugin.test.ts`  | Unit tests (`node --test`)                                                     |

## Register

In `nx.json`:

```json
{
  "plugins": [
    {
      "plugin": "./tools/jest-shards/plugin.ts",
      "options": {
        "testsPerShard": 25,
        "overrides": { "packages/big-app": { "testsPerShard": 15 } },
        "isolate": ["packages/big-app/src/slow.test.js"],
        "sharedInputs": [
          "{workspaceRoot}/**/__mocks__/**/*",
          "{workspaceRoot}/tools/jest-shards/**/*"
        ],
        "maxClosureInputs": 1000
      }
    }
  ]
}
```

Do not also register `@nx/jest/plugin`; this plugin calls it for discovery.

Every `jest.config.*` needs one line, with the path relative to that config:

```js
testSequencer: require.resolve('../../tools/jest-shards/sequencer.ts'),
```

A config that already sets a different `testSequencer` is not changed; `scripts/parity.ts` reports it and fails.

Node 24 or later runs the TypeScript directly. The directory's `package.json` marks the files as ES modules.

## Options

| Option             | Default | Meaning                                                                                                                                         |
| ------------------ | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `testsPerShard`    | 25      | Target maximum average tests per hash bucket                                                                                                    |
| `overrides`        | `{}`    | Per-project `testsPerShard` and/or `maxClosureInputs`, keyed by project root                                                                    |
| `isolate`          | `[]`    | Workspace-relative test paths that each get a shard of their own                                                                                |
| `sharedInputs`     | `[]`    | Inputs every shard of every project gets. Exact JS/TS files listed here are followed too (as Node resolves), so their imports are shared inputs |
| `maxClosureInputs` | 1000    | Per-shard budget for the import closure before it widens to globs                                                                               |

There is no resolution option. Imports resolve through each project's own Jest configuration.

Unknown option keys fail graph construction, naming the key and the allowed keys.

## How tests are assigned

- `bucketCount` is the smallest power of two that keeps (non-isolated tests) / `bucketCount` at or under `testsPerShard`.
- A test's bucket is the first 32 bits of `sha256(project-relative path)` modulo `bucketCount`.
- Isolated tests take shards `bucketCount + 1` onward, in path order. `shardCount` is `bucketCount` plus the number of isolated tests, and it is the Jest `--shard` denominator.
- Empty buckets get no target. A project with no tests gets none.

Membership moves only when:

- a test is renamed, which moves only that test;
- the test count crosses a power of two, or a bucket becomes empty or nonempty. The project's targets change, so every shard of that project misses the cache once. `nx affected` then selects only the shards whose current inputs contain the changed files; the tests that moved are not rerun until the next full run;
- `testsPerShard`, `overrides` or `isolate` changes.

Adding or deleting a test otherwise changes only its own shard's inputs.

## What a shard's inputs contain

In order:

1. Its member tests, as exact files.
2. Each member's default snapshot, `__snapshots__/<test file>.snap`. A custom `snapshotResolver` needs a `sharedInputs` glob instead.
3. The owner's `jest.config.*` and `package.json`. The owner's `project.json` needs no input: Nx selects all of a project's tasks when it changes.
4. `sharedInputs`, plus the import closure of every exact JS/TS file in them.
5. What the project's Jest config loads for every test, with each file's own imports: the config's imports, its preset, setup files, transformers, snapshot serializers and resolver, a custom resolver, environment, runner or global setup, and the test sequencer. Only workspace files count.
6. The members' import closures, minus the files above, subject to the cap.

The root `package.json`, `nx.json` and the lockfile are part of every task hash already.

## How imports are resolved

Each project's imports resolve the way that project's Jest configuration resolves them. Nothing has to be kept in step with `moduleNameMapper` by hand.

1. Each `jest.config.*` is loaded once per graph build with Jest's own loader (`jest-config`), so presets, async configs and `<rootDir>` are already applied.
2. dependency-cruiser reads the static specifiers of each file (`require`, `import`, `export from`, `import()` with a literal). It resolves nothing.
3. The project's Jest resolver, built by the factory Jest's runtime uses, resolves each specifier: `moduleNameMapper` patterns in order with their capture groups and replacement arrays, `moduleDirectories`, `modulePaths`, `moduleFileExtensions`, package `exports` under the environment's conditions, and a custom `resolver` if one is set.
4. Every workspace file a specifier resolves to is read and traversed in turn, so a mapped file or mock brings its own imports.

Closures are keyed by resolution settings and importer. One shared source file can have different closures in two projects. Projects whose resolution settings are identical share the work. Parsing is memoised by file content and resolution by project, for one graph build; nothing is cached on disk.

What a resolved path means:

- A file under `node_modules`, after following symlinks, is third-party: no input. The lockfile already covers it.
- A workspace package linked into `node_modules` is followed to its real location and is an input like any other source file.
- A package name that resolves into the workspace also adds that package's `package.json`, because its `main` and `exports` decide the result.
- A file with another extension (`.json`, `.css`) is an input with no imports of its own.

The graph fails, listing every failure with the project and its Jest config, the importer, the specifier and a classification, when:

- Jest cannot resolve a static import that the workspace owns. The raw specifier decides that, not Jest's failure: it is relative (`relative`) or absolute (`absolute`), it names a workspace package or a subpath of one (`workspace-package`), a `moduleNameMapper` pattern of the project matches it (`mapper-owned`), or its scope is the scope of a workspace package (`workspace-scope`). This includes a package whose `main` points at a build output that does not exist: map the name to hashed source or to a mock in `moduleNameMapper`. The plugin never guesses a source file. There is no ignore-unresolved switch.
- A file that is loaded or imported is not among the files Nx hashes: `.gitignore` or `.nxignore` excludes it at any depth, whether or not Git tracks it (a build output that happens to exist locally, a setup file kept out of the repository). Naming such a file in `inputs` adds nothing to the hash, so the shard could keep a stale cache hit. The check asks Nx for its file inventory instead of asking Git.
- A specifier resolves outside the workspace and outside `node_modules` (`unhashable`): a package linked from `node_modules` to a sibling directory, for example. Jest runs that file and Nx has no hash for it, so this fails whoever owns the name, including a name nothing in the workspace claims. A setup file or another file the config loads from such a place fails the same way.
- A test or a declared shared file cannot be read (`graph-entrypoint`), or a traversed file cannot (`workspace-file`).

An import Jest itself cannot resolve, of a name that nothing in the workspace claims (an optional third-party `require` inside a `try`, a package that is not installed) does not fail the graph and is not an input. The plugin logs one warning with the count and the first five. Installing the package changes the lockfile, which is part of every hash.

`scripts/mapper-fixture.ts` runs seventeen such cases on `fixtures/mappers` and checks the plugin and Jest against the same recorded results.

## Support boundary

- Jest 29. The adapter in `jest-context.ts` is written against `jest-config`, `jest-runtime`, `jest-resolve` and `jest-haste-map` 29.x and refuses another major version.
- `testMatch` patterns must be relative to the project root (`**/*.test.js`) or come from the preset. The stock matcher joins the project root onto `<rootDir>/...` patterns and finds nothing.
- `testPathIgnorePatterns` and `testRegex` are honored. A config nested inside another project's root needs the parent to ignore it; a test discovered by two configs fails the graph.
- Multi-project (`projects:`) configs fail the graph.
- Jest's `rootDir` may be the config's directory or a directory below it (`rootDir: 'src'`). Anywhere else fails the graph. Shards are still planned per project root.
- Tests must not import other tests; the graph fails if one does.
- Export conditions come from `testEnvironmentOptions.customExportConditions`, or from the defaults of `jest-environment-node` and `jest-environment-jsdom`. Any other environment must set that option, or the graph fails. Imports resolve under the `require` condition; a file Jest runs as native ESM may resolve a dual package differently.
- A custom `resolver` is called by Jest's resolver, so its results are used. The resolver file and its static imports are project inputs. Anything else it reads at run time needs a `sharedInputs` entry.
- A config computed from the environment or the clock is loaded as it is at graph time. Declare the variable in `sharedInputs` (`{ "env": "NAME" }`).
- Computed `require()` calls, `jest.requireActual`, `jest.mock` targets that nothing imports, runtime file reads and `__mocks__` directories (Jest's implicit mock lookup) are invisible to import analysis. Declare them in `sharedInputs`.
- An ESM config (`jest.config.mjs`) is loaded once per process. With the Nx daemon, restart it after editing one.
- Workspace ownership comes from the `package.json` files Nx hashes, including nested packages and packages without tests. Ignore build outputs, copied checkouts and invalid test-fixture manifests in `.gitignore` or `.nxignore`. A directory below the root that holds a `.git` entry (a nested repository, a worktree, a Git submodule) is skipped: its packages are not in the inventory, so an unresolved import of one is only caught when a mapper or a known scope claims the name. A hashed manifest that is not a JSON object fails, and a duplicate package name reports both paths.
- The file inventory and the ignore rules come from `globWithWorkspaceContext` in `nx/src/devkit-internals.js`, which is not public API. Recheck it on every Nx move, starting with 23.3.0 stable.
- A path containing a backslash fails. Nx has no escape for `(`, `)` and `|`, so each becomes `?`, which also matches any other character in that position.

## The closure cap

When a shard's closure exceeds `maxClosureInputs`, the plugin logs one line and widens it:

1. to `{workspaceRoot}/<dir>/*` for each directory holding a closure file;
2. if still over, to `{workspaceRoot}/<root>/**/*` for each project root holding a closure file (a file outside every project keeps its top-level directory).

Member tests, snapshots, owner config and shared inputs are never capped. Every stage is a superset, and the plugin checks that each closure file still matches an emitted pattern. The cost is precision: an edit to any file in a widened directory or root selects and reruns the shard, including edits to other shards' tests.

## Checks

```sh
node --test tools/jest-shards/plugin.test.ts
node scripts/parity.ts
node scripts/mapper-fixture.ts
```

Run the parity check after any change to Jest configs, the plugin, the options or the Nx version. Discovery reads the stock plugin's per-file target names, which is a version-coupled convention.

## Diagnostics

Run `pnpm analyze --cap 1000`, `--cap 5000` or `--cap uncapped` for versioned counts-only JSON. The command uses the inference functions above without running tests or contacting Nx Cloud. Per-project budgets use `overrides.<project root>.maxClosureInputs`; the default remains 1000. See the repository [local diagnostics guide](../../README.md#local-closure-diagnostics) for the independent deep-hub fixture, field definitions, privacy flags and local cache locations.
