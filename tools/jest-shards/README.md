# jest-shards

An Nx plugin that splits each project's Jest tests into stable shards. Each shard is a `test-ci--kk` target on the owning project. Its inputs are the shard's tests plus everything those tests import, so `nx affected` selects only the shards a change can reach, and untouched shards stay cache hits.

| File             | Role                                                                  |
| ---------------- | --------------------------------------------------------------------- |
| `plugin.ts`      | `createNodes`: discovery, shard targets, inputs, closure cap          |
| `buckets.ts`     | Options and the bucket policy, shared by the plugin and the sequencer |
| `sequencer.ts`   | Jest `testSequencer` that runs one bucket per `--shard=k/shardCount`  |
| `closures.ts`    | One dependency-cruiser run and the import closure of every test       |
| `plugin.test.ts` | Unit tests (`node --test`)                                            |

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
          "{workspaceRoot}/jest.preset.js",
          "{workspaceRoot}/tools/jest/setup.js",
          "{workspaceRoot}/**/__mocks__/**/*",
          "{workspaceRoot}/tools/jest-shards/**/*"
        ],
        "maxClosureInputs": 1000,
        "resolve": { "alias": { "@acme": "packages" } }
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

| Option             | Default | Meaning                                                                                                           |
| ------------------ | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `testsPerShard`    | 25      | Target maximum average tests per hash bucket                                                                      |
| `overrides`        | `{}`    | Per-project `testsPerShard` and/or `maxClosureInputs`, keyed by project root                                      |
| `isolate`          | `[]`    | Workspace-relative test paths that each get a shard of their own                                                  |
| `sharedInputs`     | `[]`    | Inputs every shard gets. Exact JS/TS files listed here are cruised too, so their imports become shared inputs     |
| `maxClosureInputs` | 1000    | Per-shard budget for the import closure before it widens to globs                                                 |
| `resolve`          | `{}`    | dependency-cruiser resolution: `alias` (prefix to workspace path) and `tsConfig` (a tsconfig whose `paths` apply) |

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
5. The members' import closures, minus the files above, subject to the cap.

The root `package.json`, `nx.json` and the lockfile are part of every task hash already.

## Support boundary

- `testMatch` patterns must be relative to the project root (`**/*.test.js`) or come from the preset. The stock matcher joins the project root onto `<rootDir>/...` patterns and finds nothing.
- `testPathIgnorePatterns` and `testRegex` are honored. A config nested inside another project's root needs the parent to ignore it; a test discovered by two configs fails the graph.
- Multi-project (`projects:`) configs are not supported.
- Jest's `rootDir` must be the config's directory, which is the default.
- Tests must not import other tests; the graph fails if one does.
- dependency-cruiser must resolve what Jest resolves. Mirror every `moduleNameMapper` alias in `resolve`. A static workspace import it cannot resolve fails the graph with the file and the specifier.
- Computed `require()` calls, runtime file reads, setup files, transformers and `__mocks__` are invisible to import analysis. Declare them in `sharedInputs`.
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
```

Run the parity check after any change to Jest configs, the plugin, the options or the Nx version. Discovery reads the stock plugin's per-file target names, which is a version-coupled convention.

## Diagnostics

Run `pnpm analyze --cap 1000`, `--cap 5000` or `--cap uncapped` for versioned counts-only JSON. The command uses the inference functions above without running tests or contacting Nx Cloud. Per-project budgets use `overrides.<project root>.maxClosureInputs`; the default remains 1000. See the repository [local diagnostics guide](../../README.md#local-closure-diagnostics) for the independent deep-hub fixture, field definitions, privacy flags and local cache locations.
