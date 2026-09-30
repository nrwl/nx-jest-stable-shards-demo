// Prints the comma-separated, sorted names of every `test-ci--*` target, for
// `nx affected -t` and `nx start-ci-run --stop-agents-after`.
import { createProjectGraphAsync } from '@nx/devkit';

const graph = await createProjectGraphAsync({ exitOnError: true });
const names = new Set<string>();
for (const node of Object.values(graph.nodes)) {
  for (const target of Object.keys(node.data.targets ?? {})) {
    if (target.startsWith('test-ci--')) names.add(target);
  }
}
if (names.size === 0) {
  // Nx Cloud treats a blank stop condition as unset, so an empty list must fail.
  console.error('shard-targets: the project graph has no test-ci--* targets');
  process.exit(1);
}
console.log([...names].sort().join(','));
