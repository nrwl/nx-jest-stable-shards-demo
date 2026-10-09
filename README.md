# Stable Jest shards with Nx

This repository shows one way to run a large Jest suite on Nx with tasks that are small, stable and selective. Each project's tests are split into hash buckets. Each bucket is a `test-ci--kk` target on the owning project, and its inputs are exactly the files its tests can read. So:

- `nx affected` selects only the shards a change can reach.
- Adding or deleting a test changes one shard's inputs. The other shards of the project stay cache hits.
- The mapping from test file to shard is a pure function of the file's path, so anyone can recompute it.

The workspace is a synthetic fixture: 77 projects, the dependency edges and the test paths of a real monorepo, anonymized. Test bodies and imports are synthetic.

Everything runs on `nx@23.3.0-beta.7` with `NX_LEGACY_AFFECTED=false`, which turns on task-based affected selection.

## Run the smoke fixture locally

Use Node 24.21.0 (see `.node-version`) and pnpm 12.8.1. The committed fixture has 476 tests in 64 shards; the default work scale is zero, so local checks do not spend time simulating recorded durations.

```sh
pnpm install --frozen-lockfile
pnpm typecheck && pnpm format:check && pnpm test:unit
export NX_LEGACY_AFFECTED=false
node scripts/parity.ts
node scripts/mapper-fixture.ts
SHARD_TARGETS=$(node scripts/shard-targets.ts)
test -n "$SHARD_TARGETS"
pnpm exec nx run-many -t "$SHARD_TARGETS" --parallel=3
```

Expect `PARITY OK`, `46/46 rows pass` from the mapper fixture and 64 successful tasks. `nx.json` points to the demo's Nx Cloud staging workspace; local checks need no CI token. To generate all 21,093 tests, run `node scripts/generate-fixture.ts --preset full`; this replaces `packages/`, so do it in a disposable checkout. Generate `--preset smoke` there to restore the smoke fixture.

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
- Nothing else per project. Imports resolve through each project's own Jest configuration (`moduleNameMapper`, `<rootDir>`, module directories), and the config's setup files, transformers and preset become inputs on their own. What Jest reads outside imports and outside its config (`__mocks__`, snapshots from a custom resolver, runtime file reads) is declared once in the plugin's `sharedInputs`.

See the shards of one project, their commands and their inputs:

```sh
pnpm exec nx show project project-001 --json
```

Each `test-ci--kk` target runs `jest -c jest.config.js --shard=k/shardCount --runInBand --coverage=false --watch=false` in the project root. The command never names tests; membership lives only in `inputs`:

1. the member tests;
2. each member's `__snapshots__/<file>.snap`;
3. the project's `jest.config.js` and `package.json`;
4. the shared inputs from `nx.json`, plus what the project's Jest config loads for every test (preset, setup files, transformers) and whatever those import;
5. every file the member tests import, transitively: dependency-cruiser reads each file's specifiers and the project's own Jest resolver resolves them.

`nx graph` shows the same 77 projects and 455 edges as the source monorepo. The shards add no projects.

### Imports resolve the way each project's Jest config resolves them

The plugin has no alias option. It loads every `jest.config.*` with Jest's own loader and resolves each import with that project's Jest resolver, so `moduleNameMapper`, `<rootDir>`, module directories and package export conditions apply exactly as they do when the test runs. One shared file imported by two projects can therefore have two closures. A workspace import Jest cannot resolve fails the graph with the project and config, the importer, the specifier and why the workspace owns it (a relative path, a workspace package or scope, a name a mapper claims). So does a file Nx does not hash, whether a test imports it or the config loads it: the plugin checks every input against Nx's own file inventory, so `.nxignore`, nested ignore files and tracked files that match an ignore rule are all caught.

Each graph build evaluates a config once and starts from empty resolver caches, so a long-lived graph process sees a changed manifest or a newly created file. The files Node loads itself (the config, its preset, transformers) can reach a package that exports different files to `import` and `require`; both are inputs.

`fixtures/mappers` is a small workspace of its own with three projects and seventeen resolution cases: one specifier mapped differently by three configs, overlapping patterns in both orders, capture groups, a replacement array, replacements that name a linked workspace package and a third-party package, a mapped mock with a nested import, a `rootDir` below the project root, `modulePaths`, export conditions, and a package whose `main` is an absent, gitignored build output. `fixtures/mappers/cases.json` records the file each case must resolve to. `pnpm mappers` copies the fixture to a throwaway workspace and checks, with real Nx and Jest:

- the plugin puts the recorded file (and what it imports) in the inputs of the importing test's shard;
- Jest resolves the same file: every fixture test compares `require.resolve` with the record;
- editing each resolved file makes exactly the dependent shards miss the cache;
- changing only a mapper in a Jest config changes the closure;
- cold and warm graph builds produce the same targets;
- ten broken variants (an unmapped package with a missing `main`, the same with a gitignored build present, a gitignored setup file that nothing imports, a setup file `.nxignore` excludes, a setup file Git tracks and `.gitignore` matches, an unresolvable specifier, a mapper to missing files, a missing relative file, a missing shared file, a `rootDir` outside the project) fail graph construction and name the cause.

## 3. Membership equals Jest

The plugin decides membership at graph time; Jest decides it at run time through the sequencer. `scripts/parity.ts` checks that they agree:

- for every shard, the tests in its inputs equal `jest --listTests --shard=k/shardCount`;
- for every project, the union of its shards equals `jest --listTests`, with no duplicates;
- every config uses the stable sequencer;
- every `jest.config.*` on disk produced shards.

```sh
node scripts/parity.ts
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

Each case also has an open pull request against `main`. The PR's `dte.yml` run is the case: `nx affected` between the PR's base and head, on three agents, on `nx@23.3.0-beta.7`. "Expected" was computed locally before CI. The legacy column is the project-grained set that legacy affected (`NX_LEGACY_AFFECTED=true`) would select, for comparison.

<!-- prettier-ignore -->
| PR | Case | Expected on beta.7 | Actual in CI | Result | Legacy project-grained set | GitHub Actions | Nx Cloud timeline |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [#2](https://github.com/nrwl/nx-jest-stable-shards-demo/pull/2) | Edit one test | `project-001:test-ci--04` | `project-001:test-ci--04` | green | 4 shards | [run](https://github.com/nrwl/nx-jest-stable-shards-demo/actions/runs/36784285231) | [timeline](https://staging.nx.app/cipes/6abd8995a07d320545909272/timeline?runGroup=36784285231-1) |
| [#3](https://github.com/nrwl/nx-jest-stable-shards-demo/pull/3) | Edit a leaf module | `project-001:test-ci--04` | `project-001:test-ci--04` | green | 4 shards | [run](https://github.com/nrwl/nx-jest-stable-shards-demo/actions/runs/36784291006) | [timeline](https://staging.nx.app/cipes/6abd89b2a07d3205459092a2/timeline?runGroup=36784291006-1) |
| [#4](https://github.com/nrwl/nx-jest-stable-shards-demo/pull/4) | Edit a barrel | `project-001:test-ci--02` | `project-001:test-ci--02` | green | 4 shards | [run](https://github.com/nrwl/nx-jest-stable-shards-demo/actions/runs/36784302894) | [timeline](https://staging.nx.app/cipes/6abd89a4a07d320545909286/timeline?runGroup=36784302894-1) |
| [#5](https://github.com/nrwl/nx-jest-stable-shards-demo/pull/5) | Edit a cross-project module | 55 shards | the same 55 shards | green | 63 shards | [run](https://github.com/nrwl/nx-jest-stable-shards-demo/actions/runs/36784304066) | [timeline](https://staging.nx.app/cipes/6abd89a0a07d32054590927c/timeline?runGroup=36784304066-1) |
| [#6](https://github.com/nrwl/nx-jest-stable-shards-demo/pull/6) | Add one test and delete another (combined) | `project-047:test-ci--04` | `project-047:test-ci--04` | green | 5 shards | [run](https://github.com/nrwl/nx-jest-stable-shards-demo/actions/runs/36784313443) | [timeline](https://staging.nx.app/cipes/6abd89b4a07d3205459092af/timeline?runGroup=36784313443-1) |
| [#7](https://github.com/nrwl/nx-jest-stable-shards-demo/pull/7) | Cross a bucket boundary (4 to 8) | `project-001:test-ci--06` | `project-001:test-ci--06` | green | 8 shards | [run](https://github.com/nrwl/nx-jest-stable-shards-demo/actions/runs/36784322248) | [timeline](https://staging.nx.app/cipes/6abd89af8ed7801d8447a736/timeline?runGroup=36784322248-1) |
| [#8](https://github.com/nrwl/nx-jest-stable-shards-demo/pull/8) | Unrelated change (a project without tests) | none | none; all three agents exited on their own | green | none | [run](https://github.com/nrwl/nx-jest-stable-shards-demo/actions/runs/36784327343) | [timeline](https://staging.nx.app/cipes/6abd89b0a07d320545909294/timeline?runGroup=36784327343-1) |
| [#9](https://github.com/nrwl/nx-jest-stable-shards-demo/pull/9) | One failing test | `project-008:test-ci--01`, failing | `project-008:test-ci--01` failed; main job red | red, as intended | 1 shard | [run](https://github.com/nrwl/nx-jest-stable-shards-demo/actions/runs/36784337595) | [timeline](https://staging.nx.app/cipes/6abd89b78ed7801d8447a783/timeline?runGroup=36784337595-1) |

In every PR run, all tasks ran on the agents and none on the main job. Each agent exited right after its last shard, or as soon as it had nothing to run, and the main job went on to `complete-ci-run` and its summary. Every job finished in under 2.5 minutes, against its 15-minute timeout.

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
| Unresolved mapper-owned static workspace import | graph fails naming project/config, importer, specifier and classification; no green cached result | graph failed: `project/config packages/project-001 (packages/project-001/jest.config.js): packages/project-001/app/dir-00104/dir-00105/dir-00106/__tests__/test-00060.test.js: '@packages/project-001/missing' (mapper-owned)`; affected and run-many exit nonzero | | | pass |
| Membership parity per config | union of shards equals `jest --listTests`, no duplicates; per-shard lists match `--shard=k/shardCount`; every config on disk produced shards | inventory: 57 Jest configs on disk, 57 with shards OK; 178 checks; PARITY OK | | | pass |

The ownership guard also has named unit checks in `tools/jest-shards/plugin.test.ts`:

<!-- prettier-ignore -->
| Guard case | Required behavior |
| --- | --- |
| Unresolved package no mapper claims under an existing workspace scope, including a nonexistent package name | Fail graph construction before creating targets; name project/config, importer, specifier and classification |
| Unresolved unscoped local package or local package subpath | Fail using the manifest inventory, including packages without tests and nested roots |
| Published sibling under a workspace scope | Succeed when it resolves from `node_modules` |
| Mapped mock | Succeed when it resolves to a file; include its transitive imports |
| Workspace package reached through a `node_modules` symlink | Include its real source files and transitive imports in the closure |
| Missing graph entrypoint or removed traversed workspace file | Fail graph construction |
| Manifest inventory, ignore rules, a mapper or `node_modules` links changed after a build in the same process | Recompute ownership and resolution; nothing is cached between builds |
| Ignored build output, copied checkout or invalid fixture manifest | Exclude it: the inventory is the `package.json` files Nx hashes; nested Git checkouts are excluded by their `.git` marker |
| Duplicate nonignored source package name | Fail naming both manifest paths |
| Multiple unresolved workspace imports | Report all failures with project/config, importer, specifier, classification, Jest's message and the resolver hint |
| Unresolved name nothing in the workspace claims | Succeed with a warning; not an input |
| Loaded or imported file excluded by `.gitignore`, a nested `.gitignore` or `.nxignore`, tracked or not | Fail graph construction naming the file |

Notes on the results:

- A test deletion selects nothing. The deleted path matches no current task's inputs, and no test imports another test, so no remaining test can observe the deletion. The next full run refreshes that shard's cache entry.
- At a power-of-two boundary, affected selects only the shard that holds the added test. Tests redistributed into other shards have unchanged sources and are not rerun until the next full run on `main`, which misses every shard of that project once.
- An edit to the owner's `project.json` selects all of its shards, with no input listing it. The matrix row edits `tags`, which Nx hashes, so the shards also miss. An edit to a field Nx does not hash, such as `description`, still selects them, but they stay cache hits because no task definition changed.
- Under the closure cap, a shard's source inputs widen to directory or project-root globs. Selection then includes sibling shards whose tests live in the same directories or roots. Member tests stay exact, so parity is unaffected.

Rerun the matrix with a clean working tree; it reverts every change it makes:

```sh
node scripts/acceptance.ts
```

## 6. CI runs

The 3-agent smoke uses manual distribution in [`.github/workflows/dte.yml`](.github/workflows/dte.yml). Its [cold main run](https://github.com/nrwl/nx-jest-stable-shards-demo/actions/runs/36767862871/attempts/1) executed all 64 shards on the agents, with zero cache hits, in 178.1 s for the `run-many` step (204 s for the main job). The [warm rerun at the same SHA](https://github.com/nrwl/nx-jest-stable-shards-demo/actions/runs/36767862871/attempts/2) had 64 cache hits and took 16.7 s for `run-many` (41 s for the main job).

The eight PRs in item 5 cover selective, empty and failing executions. All tasks ran on agents. With no selected tasks, all three agents exited on their own; with the failing shard, the main job stayed red and still completed the CI run. No job reached its timeout.

The table links each affected demonstration to its GitHub Actions `dte` run and matching Nx Cloud timeline. These demo timelines are publicly accessible. Nx Cloud's bot comments can link a separate `verify` run, which executes the whole smoke fixture; use the table links to inspect the affected case.

## 7. Full fixture validation

The results and workflow options below come from `demo/full-simulation` ([PR #10](https://github.com/nrwl/nx-jest-stable-shards-demo/pull/10)). The workflow changes remain on that branch; select it when reproducing these runs.

<!-- prettier-ignore -->
| PR | GitHub Actions | Nx Cloud timeline |
| --- | --- | --- |
| [#10](https://github.com/nrwl/nx-jest-stable-shards-demo/pull/10) | [Full uncached run](https://github.com/nrwl/nx-jest-stable-shards-demo/actions/runs/36926585672) | [timeline](https://staging.nx.app/cipes/6abecc06682b8e820e47b461/timeline?runGroup=36926585672-1) |

The [October 1 full run](https://github.com/nrwl/nx-jest-stable-shards-demo/actions/runs/36926585672) at `997ad13` passed with **1,067 executed shard tasks, zero cached tasks and zero failures**. Agent logs contain 1,067 unique shard executions, no duplicates, and **21,093 passing Jest suites**. The test step took **10m00s**; the complete workflow took **11m26s**. All 30 agents executed shards, and all 31 jobs succeeded and stopped, including CI completion and coordinator daemon cleanup.

The full validation uses a synthetic fixture matching the full recorded test population, on 30 standard `ubuntu-latest` agents with `--parallel=2` and `FIXTURE_WORK_SCALE=0.2`. On the validation branch, the full and smoke distribution workflows set `NX_CLOUD_CONTINUOUS_ASSIGNMENT=true` on the coordinator and agents to enable continuous task distribution.

The measured run used `daemon=true` and the fresh cache key `continuous-cold-20261001T210739655Z-24f670d1`. All 30 agent logs show the V4 execution path. Total job time was 345 runner-minutes (372 after rounding each job up separately); these are duration totals, not an invoice.

[The validation branch’s full workflow](https://github.com/nrwl/nx-jest-stable-shards-demo/blob/demo/full-simulation/.github/workflows/full.yml) is manual-only: dispatch `mode=sharded` on `demo/full-simulation` ([PR #10](https://github.com/nrwl/nx-jest-stable-shards-demo/pull/10)) with `daemon=true` and a new `cache_key` for a cold run. That key is a declared input to every shard, identical on the coordinator and agents. Reuse the key, scale and SHA for a warm comparison. Jobs are capped at 25 minutes, and the test step at 20 minutes to leave time for setup and cleanup. A run counts as cold only if its main log shows zero cached tasks. Per-file mode remains available for a separately requested comparison; `cache_key` applies to sharded mode.

Dispatch `mode=daemon-probe` to compare graph creation with and without the daemon on one standard runner, without Jest or Nx Cloud. The probe checks task parity and actual daemon use and reports cold, repeated and fresh-daemon/warm-disk timings. Its job is capped at 10 minutes. Full runs accept `daemon=true` to enable the daemon on the coordinator only; it is stopped during cleanup. Agents retain the CI default.

The [single-runner Linux probe](https://github.com/nrwl/nx-jest-stable-shards-demo/actions/runs/36919508636) averaged 53.4 seconds for target discovery plus graph/hash planning with a fresh daemon and warm disk caches, versus 58.9 seconds with the daemon off (two samples each). Task parity and daemon cleanup passed. This modest startup saving supports the optional coordinator daemon; it does not establish a full-pipeline speedup.

Synthetic test-body durations come from one recorded run (6,403 of 21,093 tests measured, the rest estimated from medians). Scaling shortens the synthetic test bodies but leaves Jest startup and distribution overhead intact. This validates the full task population; it does not predict performance on the source infrastructure.

## 8. Adopt it

1. Copy `tools/jest-shards/`, `scripts/shard-targets.ts` and `scripts/parity.ts` (with `scripts/package.json`).
2. Install what they import, on Node 24 or later:
   - `nx`, `@nx/devkit` and `@nx/jest` at one version that has task-based affected (`23.3.0-beta.7` here);
   - `jest` and `@jest/test-sequencer` at the same version (`29.7.0` here);
   - `dependency-cruiser` (`^18.4.0`) and `minimatch` (`^10`);
   - `typescript`, if tests are TypeScript;
   - `jest-config`, `jest-runtime`, `jest-resolve` and `jest-haste-map` at your Jest 29 version, so the plugin loads configs and resolves imports with Jest's own code.
3. Add the plugin entry to `nx.json` and remove any `@nx/jest/plugin` entry. Options are in [tools/jest-shards/README.md](tools/jest-shards/README.md).
4. Add the `testSequencer` line to every `jest.config.*`.
5. Run `node scripts/parity.ts` until it prints `PARITY OK`.
6. In CI, set `NX_LEGACY_AFFECTED=false` and `NX_CLOUD_CONTINUOUS_ASSIGNMENT=true` (continuous task distribution) on the coordinator and every agent. Restore `.nx/workspace-data` from a cache keyed on the base branch on each machine. On the coordinator, compute the target list and start the run:

   ```sh
   SHARD_TARGETS=$(node scripts/shard-targets.ts)
   test -n "$SHARD_TARGETS"
   npx nx start-ci-run --distribute-on=manual --stop-agents-after="$SHARD_TARGETS"
   npx nx affected -t "$SHARD_TARGETS" --parallel=2
   ```

   Agents run `npx nx start-agent`. Run exactly one Nx command against the shard targets per CI run: the stop condition is met when the first such command ends. Add an always-run coordinator cleanup step calling `npx nx complete-ci-run`, including when setup or tests fail.

It works with any CI that supplies Git refs; `.github/workflows/dte.yml` is the GitHub Actions version.

What you maintain afterwards:

| Item                                                                                 | Notes                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tools/jest-shards/`                                                                 | Plugin, bucket policy, sequencer, closures and their tests                                                                                                                                                                          |
| One `testSequencer` line per Jest config                                             | The sequencer fails the run if the graph is stale                                                                                                                                                                                   |
| The `nx.json` plugin entry                                                           | Changing a count or isolating a test rebalances that project once                                                                                                                                                                   |
| `scripts/shard-targets.ts`, `scripts/parity.ts` and the CI step that calls the first | Replaces any hand-maintained target list                                                                                                                                                                                            |
| CI env and cache restore on every machine                                            | Must be identical on the main job and agents                                                                                                                                                                                        |
| The Nx version                                                                       | Rerun parity and the acceptance matrix on every move                                                                                                                                                                                |
| Rules                                                                                | Tests do not import tests; `sharedInputs` lists what Jest reads outside imports; computed requires and runtime file reads need declared inputs; a workspace import Jest cannot resolve, or a file Nx does not hash, fails the graph |

## 9. Later: Nx Agents

Nx Agents with I/O snapshots can run the same layout faster and learn each task's real file reads, which would replace the dependency-cruiser step. Snapshots are not available with manual DTE.

## Repository layout

| Path                                                    | What                                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `tools/jest-shards/`                                    | The plugin you maintain                                                                                       |
| `scripts/shard-targets.ts`                              | Prints the shard target list                                                                                  |
| `scripts/parity.ts`                                     | Membership parity check                                                                                       |
| `scripts/acceptance.ts`                                 | The acceptance matrix on the smoke fixture                                                                    |
| `scripts/generate-fixture.ts`, `fixtures/topology.json` | The synthetic workspace (`--preset smoke` is committed under `packages/`; `--preset full` is generated in CI) |
| `jest.preset.js`, `tools/fixture/`                      | The fixture's Jest preset, setup file, work helper and TypeScript transformer                                 |
| `.github/workflows/`                                    | `verify.yml` (no Cloud), `dte.yml` (3-agent smoke), `full.yml` (30-agent simulation)                          |

Local commands:

```sh
pnpm install
pnpm typecheck && pnpm format:check && pnpm test:unit
export NX_LEGACY_AFFECTED=false
node scripts/parity.ts
node scripts/mapper-fixture.ts
SHARD_TARGETS=$(node scripts/shard-targets.ts)
pnpm exec nx run-many -t "$SHARD_TARGETS"
```
