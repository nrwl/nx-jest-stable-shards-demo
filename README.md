# Stable Jest shards with Nx

This repository shows one way to run a large Jest suite on Nx with tasks that are small, stable and selective. Each project's tests are split into hash buckets. Each bucket is a `test-ci--kk` target on the owning project, and its inputs are exactly the files its tests can read. So:

- `nx affected` selects only the shards a change can reach.
- Adding or deleting a test changes one shard's inputs. The other shards of the project stay cache hits.
- The mapping from test file to shard is a pure function of the file's path, so anyone can recompute it.

The workspace is a synthetic fixture: 77 projects, the dependency edges and the test paths of a real monorepo, anonymized. Test bodies and imports are synthetic.

Everything runs on `nx@23.3.0-beta.7` with `NX_LEGACY_AFFECTED=false`, which turns on task-based affected selection.

## 1. The problem

With 21,093 test files there are three stock shapes:

| Shape                                          | Tasks                                                                     | Trade-off                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| One task per project (`@nx/jest/plugin`)       | 57                                                                        | The two largest projects are single tasks of 5,935 and 4,583 test files |
| One task per file (`ciTargetName` atomization) | 21,093                                                                    | Every task has project-wide inputs, and each pays its own Jest startup  |
| Stable shards (this repo)                      | 1,067 (1,066 regular buckets plus one isolated test), about 20 tests each | Small tasks, per-shard inputs, one Jest process per shard               |

Jest's own `--shard=k/n` slices a sorted list, so adding one test moves tests between shards and invalidates every shard's cache. The custom test sequencer here replaces that slicing with the stable buckets.

Which shape is fastest on 30 agents is a measurement, not a claim; see item 7.

## 2. What adoption takes for a test owner

- A conventional `jest.config.*` whose `testMatch` is relative to the project root (`**/*.test.js`) or comes from the preset.
- One line in that config: `testSequencer: require.resolve('<relative path>/tools/jest-shards/sequencer.ts')`.
- Nothing else per project. What Jest reads outside imports (setup files, transformers, `__mocks__`, snapshots from a custom resolver) is declared once in the plugin's `sharedInputs`, and aliases once in its `resolve` option.

See the shards of one project, their commands and their inputs:

```sh
NX_DAEMON=false NX_NO_CLOUD=true pnpm exec nx show project project-001 --json
```

Each `test-ci--kk` target runs `jest -c jest.config.js --shard=k/shardCount --runInBand --coverage=false --watch=false` in the project root. The command never names tests; membership lives only in `inputs`:

1. the member tests;
2. each member's `__snapshots__/<file>.snap`;
3. the project's `jest.config.js` and `package.json`;
4. the shared inputs from `nx.json`, plus whatever the setup file and preset import;
5. every file the member tests import, transitively, as computed by dependency-cruiser.

`nx graph` shows the same 77 projects and 455 edges as the source monorepo. The shards add no projects.

## 3. Membership equals Jest

The plugin decides membership at graph time; Jest decides it at run time through the sequencer. `scripts/parity.ts` checks that they agree:

- for every shard, the tests in its inputs equal `jest --listTests --shard=k/shardCount`;
- for every project, the union of its shards equals `jest --listTests`, with no duplicates;
- every config uses the stable sequencer;
- every `jest.config.*` on disk produced shards.

```sh
NX_DAEMON=false NX_NO_CLOUD=true node scripts/parity.ts
```

```text
...
project-001: testSequencer=tools/jest-shards/sequencer.ts OK
project-001:test-ci--02 graph=23 jest=23 OK
project-001:test-ci--01 graph=28 jest=28 OK
project-001:test-ci--03 graph=28 jest=28 OK
project-001:test-ci--04 graph=21 jest=21 OK
project-001: union of 4 shards=100 listTests=100 duplicates=0 OK
inventory: 57 Jest configs on disk, 57 with shards OK
PARITY OK
```

On the full fixture (all 21,093 tests), generated with `node scripts/generate-fixture.ts --preset full`, the same check passes for 1,067 shards: 1,066 hash buckets plus the one isolated test, across all 57 configs.

## 4. Stable means stable

Add a test to a project whose bucket count does not change: only the shard that receives it misses the cache, and no other test changes shard. The acceptance matrix below shows this for project-047. Two things reshard a project on purpose, once: crossing a power of two in the test count, and changing `testsPerShard`, `overrides` or `isolate`.

## 5. Per-file selection

Task-based affected matches each changed file against each task's inputs. The acceptance matrix records every case locally on `23.3.0-beta.7`. Each row applies one change to the committed smoke fixture, asks `nx affected -t "$SHARD_TARGETS" --files=<changed files> --graph=stdout` which shards it selects, and then runs `nx run-many -t "$SHARD_TARGETS"` to see which shards miss the cache.

The eight demo pull requests, one per case with its own CI run, come with the staging setup.

Results on `nx@23.3.0-beta.7`, run locally on the smoke fixture (476 tests in 64 shards) on Sep 30, 2026. "Expected" is the plan's rule followed by the task IDs the rule names for this fixture; the result compares them exactly.

<!-- prettier-ignore -->
| Change | Expected selection | Actual selection | Expected cache | Actual cache misses | Result |
| --- | --- | --- | --- | --- | --- |
| Edit one existing test (`app/dir-00104/dir-00105/dir-00106/__tests__/test-00060.test.js` in project-001) | its shard only: project-001:test-ci--04 | project-001:test-ci--04 | that shard misses, all others hit: project-001:test-ci--04 | project-001:test-ci--04 | pass |
| Edit a leaf module imported by one test | that test's shard only: project-001:test-ci--04 | project-001:test-ci--04 | same: project-001:test-ci--04 | project-001:test-ci--04 | pass |
| Edit a barrel (`packages/project-001/index.js`) | every shard with a test behind the barrel: project-001:test-ci--02 | project-001:test-ci--02 | same: project-001:test-ci--02 | project-001:test-ci--02 | pass |
| Edit a cross-project module (`packages/project-029/api/one.js`) | the upstream project's shard holding the test that imports it, plus downstream shards whose tests import it: 55 shards: project-001:test-ci--02, project-008:test-ci--01, project-009:test-ci--01, ... | 55 shards: project-001:test-ci--02, project-008:test-ci--01, project-009:test-ci--01, ... | same: 55 shards: project-001:test-ci--02, project-008:test-ci--01, project-009:test-ci--01, ... | 55 shards: project-001:test-ci--02, project-008:test-ci--01, project-009:test-ci--01, ... | pass |
| Add a module imported by nothing | nothing: none | none | all hit: none | none | pass |
| Edit a shared file (`jest.preset.js`) | every shard: all 64 | all 64 | all miss: all 64 | all 64 | pass |
| Edit a shared file (`tools/fixture/setup.js`) | every shard: all 64 | all 64 | all miss: all 64 | all 64 | pass |
| Edit a shared file (`tools/fixture/transform.js`) | every shard: all 64 | all 64 | all miss: all 64 | all 64 | pass |
| Edit a shared file (`packages/project-001/api/__mocks__/two.js`) | every shard: all 64 | all 64 | all miss: all 64 | all 64 | pass |
| Edit project-047's `jest.config.js` | all shards of that owner: project-047:test-ci--01, project-047:test-ci--02, project-047:test-ci--03, project-047:test-ci--04, project-047:test-ci--05 | project-047:test-ci--01, project-047:test-ci--02, project-047:test-ci--03, project-047:test-ci--04, project-047:test-ci--05 | those miss: project-047:test-ci--01, project-047:test-ci--02, project-047:test-ci--03, project-047:test-ci--04, project-047:test-ci--05 | project-047:test-ci--01, project-047:test-ci--02, project-047:test-ci--03, project-047:test-ci--04, project-047:test-ci--05 | pass |
| Edit project-047's `package.json` | all shards of that owner: project-047:test-ci--01, project-047:test-ci--02, project-047:test-ci--03, project-047:test-ci--04, project-047:test-ci--05 | project-047:test-ci--01, project-047:test-ci--02, project-047:test-ci--03, project-047:test-ci--04, project-047:test-ci--05 | those miss: project-047:test-ci--01, project-047:test-ci--02, project-047:test-ci--03, project-047:test-ci--04, project-047:test-ci--05 | project-047:test-ci--01, project-047:test-ci--02, project-047:test-ci--03, project-047:test-ci--04, project-047:test-ci--05 | pass |
| Edit project-047's `project.json` | all shards of that owner: project-047:test-ci--01, project-047:test-ci--02, project-047:test-ci--03, project-047:test-ci--04, project-047:test-ci--05 | project-047:test-ci--01, project-047:test-ci--02, project-047:test-ci--03, project-047:test-ci--04, project-047:test-ci--05 | those miss: project-047:test-ci--01, project-047:test-ci--02, project-047:test-ci--03, project-047:test-ci--04, project-047:test-ci--05 | project-047:test-ci--01, project-047:test-ci--02, project-047:test-ci--03, project-047:test-ci--04, project-047:test-ci--05 | pass |
| Edit only a member's `.snap` file | that member's shard only: project-001:test-ci--02 | project-001:test-ci--02 | that shard misses: project-001:test-ci--02 | project-001:test-ci--02 | pass |
| Edit only a helper imported by the setup file (`tools/fixture/work.js`) | every shard: all 64 | all 64 | all miss: all 64 | all 64 | pass |
| Add a test to project-047, bucket count unchanged | the new shard k only; other memberships unchanged: project-047:test-ci--01 | project-047:test-ci--01 | shard k misses, siblings hit: project-047:test-ci--01 | project-047:test-ci--01 | pass |
| Add one test to project-001 across the 100-test boundary (4 to 8 buckets) | only the new shard holding the added test; redistributed tests are not selected: project-001:test-ci--03 | project-001:test-ci--03 | all shards of project-001 miss once: project-001:test-ci--01, project-001:test-ci--02, project-001:test-ci--03, project-001:test-ci--04, project-001:test-ci--05, project-001:test-ci--06, project-001:test-ci--07, project-001:test-ci--08 | project-001:test-ci--01, project-001:test-ci--02, project-001:test-ci--03, project-001:test-ci--04, project-001:test-ci--05, project-001:test-ci--06, project-001:test-ci--07, project-001:test-ci--08 | pass |
| Delete a test (delete-only diff) | nothing (documented): none | none | that shard's hash changed; siblings hit: project-047:test-ci--03 | project-047:test-ci--03 | pass |
| Rename a test across buckets | the new bucket's shard: project-047:test-ci--03 | project-047:test-ci--03 | both shards miss: project-047:test-ci--01, project-047:test-ci--03 | project-047:test-ci--01, project-047:test-ci--03 | pass |
| Edit the isolated test | its own shard (`--shard=5/5`): project-047:test-ci--05 | project-047:test-ci--05 | same: project-047:test-ci--05 | project-047:test-ci--05 | pass |
| Unrelated change (`README.md`, and `index.js` of project-054, which has no tests) | nothing: none | none | all hit: none | none | pass |
| Lockfile change (one package integrity) | every shard: all 64 | all 64 | all miss: all 64 | all 64 | pass |
| Add a test at an odd path (`app/odd dir/it's (1).test.js` in project-047) | its shard only; Jest executes it: project-047:test-ci--03 | project-047:test-ci--03 | same: project-047:test-ci--03 | project-047:test-ci--03 | pass |
| Edit an alias target (`@packages/project-047` resolves to `packages/project-047/index.js`) | the importing test's shard: project-047:test-ci--02 | project-047:test-ci--02 | that shard misses: project-047:test-ci--02 | project-047:test-ci--02 | pass |
| Cap stage 2 forced (`maxClosureInputs: 40`): edit a member test, a child-root file, a cross-project module | each selects the owning shard; siblings in the same directory may join | misses equal the selection; coverage assertion passes; parity OK | `packages/project-001/app/dir-00104/dir-00105/dir-00106/__tests__/test-00060.test.js`: selected project-001:test-ci--04; ran project-001:test-ci--04<br>`packages/project-001/project-004/app/dir-05541/dir-05566/dir-05567/__tests__/test-05461.leaf.js`: selected project-001:test-ci--04; ran project-001:test-ci--04<br>`packages/project-029/api/one.js`: selected 55 shards: project-001:test-ci--02, project-008:test-ci--01, project-009:test-ci--01, ...; ran 55 shards: project-001:test-ci--02, project-008:test-ci--01, project-009:test-ci--01, ...<br>parity OK | | pass |
| Cap stage 3 forced (`maxClosureInputs: 1`): edit a member test, a child-root file, a cross-project module | each selects the owning shard; siblings in the same root may join | misses equal the selection; coverage assertion passes; parity OK | `packages/project-001/app/dir-00104/dir-00105/dir-00106/__tests__/test-00060.test.js`: selected project-001:test-ci--01, project-001:test-ci--02, project-001:test-ci--03, project-001:test-ci--04; ran project-001:test-ci--01, project-001:test-ci--02, project-001:test-ci--03, project-001:test-ci--04<br>`packages/project-001/project-004/app/dir-05541/dir-05566/dir-05567/__tests__/test-05461.leaf.js`: selected project-001:test-ci--01, project-001:test-ci--02, project-001:test-ci--03, project-001:test-ci--04; ran project-001:test-ci--01, project-001:test-ci--02, project-001:test-ci--03, project-001:test-ci--04<br>`packages/project-029/api/one.js`: selected 55 shards: project-001:test-ci--02, project-008:test-ci--01, project-009:test-ci--01, ...; ran 55 shards: project-001:test-ci--02, project-008:test-ci--01, project-009:test-ci--01, ...<br>parity OK | | pass |
| Unresolved static workspace import | graph fails naming the file and specifier; no green cached result | graph failed: `packages/project-001/app/dir-00104/dir-00105/dir-00106/__tests__/test-00060.test.js: '@packages/project-001/missing'`; affected and run-many exit nonzero | | | pass |
| Membership parity per config | union of shards equals `jest --listTests`, no duplicates; per-shard lists match `--shard=k/shardCount`; every config on disk produced shards | inventory: 57 Jest configs on disk, 57 with shards OK; 178 checks; PARITY OK | | | pass |

Notes on the results:

- A test deletion selects nothing. The deleted path matches no current task's inputs, and no test imports another test, so no remaining test can observe the deletion. The next full run refreshes that shard's cache entry.
- At a power-of-two boundary, affected selects only the shard that holds the added test. Tests redistributed into other shards have unchanged sources and are not rerun until the next full run on `main`, which misses every shard of that project once.
- An edit to the owner's `project.json` selects all of its shards, with no input listing it. The matrix row edits `tags`, which Nx hashes, so the shards also miss. An edit to a field Nx does not hash, such as `description`, still selects them, but they stay cache hits because no task definition changed.
- Under the closure cap, a shard's source inputs widen to directory or project-root globs. Selection then includes sibling shards whose tests live in the same directories or roots. Member tests stay exact, so parity is unaffected.

Rerun the matrix with a clean working tree; it reverts every change it makes:

```sh
node scripts/acceptance.ts
```

## 6. Staging runs

TODO: the 3-agent smoke on Nx Cloud manual DTE (`.github/workflows/dte.yml`): task counts, agent placement, agents released after the last shard, the empty-selection and failing-shard cases.

## 7. Simulation numbers

TODO: `.github/workflows/full.yml`, 30 agents times `--parallel=3` on the full fixture, per-file tasks against stable shards, cold and warm: task count, wall time, graph creation time, longest task, agent utilization. Durations come from one recorded run (6,403 of 21,093 tests measured, the rest estimated from medians), so the simulation approximates the source suite, not its infrastructure.

## 8. Adopt it

1. Copy `tools/jest-shards/`, `scripts/shard-targets.ts` and `scripts/parity.ts` (with `scripts/package.json`).
2. Install what they import, on Node 24 or later:
   - `nx`, `@nx/devkit` and `@nx/jest` at one version that has task-based affected (`23.3.0-beta.7` here);
   - `jest` and `@jest/test-sequencer` at the same version (`29.7.0` here);
   - `dependency-cruiser` (`^18.4.0`) and `minimatch` (`^10`);
   - `typescript`, if tests are TypeScript or `resolve.tsConfig` is set.
3. Add the plugin entry to `nx.json` and remove any `@nx/jest/plugin` entry. Options are in [tools/jest-shards/README.md](tools/jest-shards/README.md).
4. Add the `testSequencer` line to every `jest.config.*`.
5. Run `node scripts/parity.ts` until it prints `PARITY OK`.
6. In CI, on the main job and every agent: set `NX_LEGACY_AFFECTED=false` and `NX_DAEMON=false`, restore `.nx/depcruise` and `.nx/workspace-data` from a cache keyed on the base branch, and compute the target list:

   ```sh
   SHARD_TARGETS=$(node scripts/shard-targets.ts)
   test -n "$SHARD_TARGETS"
   npx nx start-ci-run --distribute-on=manual --stop-agents-after="$SHARD_TARGETS"
   npx nx affected -t "$SHARD_TARGETS" --parallel=3
   ```

   Agents run `npx nx start-agent`. Run exactly one Nx command against the shard targets per CI run: the stop condition is met when the first such command ends.

It works with any CI that supplies Git refs; `.github/workflows/dte.yml` is the GitHub Actions version.

What you maintain afterwards:

| Item                                                                                 | Notes                                                                                                                                                                                |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tools/jest-shards/`                                                                 | Plugin, bucket policy, sequencer, closures and their tests                                                                                                                           |
| One `testSequencer` line per Jest config                                             | The sequencer fails the run if the graph is stale                                                                                                                                    |
| The `nx.json` plugin entry                                                           | Changing a count or isolating a test rebalances that project once                                                                                                                    |
| `scripts/shard-targets.ts`, `scripts/parity.ts` and the CI step that calls the first | Replaces any hand-maintained target list                                                                                                                                             |
| CI env and cache restore on every machine                                            | Must be identical on the main job and agents                                                                                                                                         |
| The Nx version                                                                       | Rerun parity and the acceptance matrix on every move                                                                                                                                 |
| Rules                                                                                | Tests do not import tests; `sharedInputs` lists what Jest reads outside imports; computed requires and runtime file reads need declared inputs; `resolve` mirrors `moduleNameMapper` |

## 9. Later: Nx Agents

Nx Agents with I/O snapshots can run the same layout faster and learn each task's real file reads, which would replace the dependency-cruiser step. Snapshots are not available with manual DTE.

## Repository layout

| Path                                                    | What                                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `tools/jest-shards/`                                    | The plugin (customer-maintained)                                                                              |
| `scripts/shard-targets.ts`                              | Prints the shard target list                                                                                  |
| `scripts/parity.ts`                                     | Membership parity check                                                                                       |
| `scripts/acceptance.ts`                                 | The acceptance matrix on the smoke fixture                                                                    |
| `scripts/generate-fixture.ts`, `fixtures/topology.json` | The synthetic workspace (`--preset smoke` is committed under `packages/`; `--preset full` is generated in CI) |
| `jest.preset.js`, `tools/fixture/`                      | The fixture's Jest preset, setup file, work helper and TypeScript transformer                                 |
| `.github/workflows/`                                    | `verify.yml` (no Cloud), `dte.yml` (3-agent smoke), `full.yml` (30-agent simulation)                          |

Local commands, all with Nx Cloud off:

```sh
pnpm install
pnpm typecheck && pnpm format:check && pnpm test:unit
export NX_DAEMON=false NX_NO_CLOUD=true NX_LEGACY_AFFECTED=false
node scripts/parity.ts
SHARD_TARGETS=$(node scripts/shard-targets.ts)
pnpm exec nx run-many -t "$SHARD_TARGETS"
```
