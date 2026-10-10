// Independent ignored workspace, preserving the committed smoke fixture.
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function generateDeepHub(root: string, nodeModules = resolve('node_modules')) {
  mkdirSync(root, { recursive: true });
  const write = (file: string, content: string) => {
    mkdirSync(join(root, dirname(file)), { recursive: true });
    writeFileSync(join(root, file), content);
  };
  const requireFrom = (from: string, to: string) => {
    const path = relative(dirname(from), to);
    return `require('${path.startsWith('.') ? path : './' + path}')`;
  };
  write(
    'nx.json',
    JSON.stringify({
      plugins: [
        {
          plugin: './tools/jest-shards/plugin.ts',
          options: {
            testsPerShard: 4,
            sharedInputs: ['{workspaceRoot}/setup.js'],
          },
        },
      ],
    }),
  );
  write('package.json', '{"name":"@acme/synthetic-hubs","private":true}');
  write('setup.js', "require('./shared');\n");
  write('shared.js', 'module.exports = 1;\n');
  const roots = ['packages/outer', 'packages/outer/nested/inner', 'packages/small'];
  roots.forEach((projectRoot, index) => {
    write(`${projectRoot}/project.json`, JSON.stringify({ name: `synthetic-${index}` }));
    write(
      `${projectRoot}/package.json`,
      JSON.stringify({ name: `@acme/synthetic-${index}`, private: true }),
    );
    write(
      `${projectRoot}/jest.config.js`,
      `module.exports = { testMatch: ['tests/*.test.js'] };\n`,
    );
  });
  const deep = Array.from(
    { length: 1100 },
    (_, i) => `packages/outer/nested/inner/src/a/b/c/d/e/f/g/h/part-${i}/leaf.js`,
  );
  deep.forEach((file, index) => {
    write(
      file,
      `module.exports = [${requireFrom(file, deep[(index + 1) % deep.length])}, ${requireFrom(file, 'shared.js')}];\n`,
    );
    write(`${dirname(file)}/extra.js`, 'module.exports = 0;\n');
  });
  const wide = Array.from(
    { length: 1200 },
    (_, i) => `packages/outer/src/group-${i % 20}/leaf-${i}.js`,
  );
  wide.forEach((file) => write(file, `module.exports = ${requireFrom(file, 'shared.js')};\n`));
  const hub = 'packages/outer/src/hub.js';
  write(hub, `module.exports = [${wide.map((f) => requireFrom(hub, f)).join(',')}];\n`);
  write('packages/small/src/leaf.js', 'module.exports = 1;\n');
  roots.forEach((projectRoot, index) => {
    for (let i = 0; i < 8; i++) {
      const file = `${projectRoot}/tests/case-${i}.test.js`;
      const source = index === 2 ? 'packages/small/src/leaf.js' : i % 2 ? hub : deep[0];
      write(
        file,
        `const value = ${requireFrom(file, source)};\ntest('synthetic', () => expect(value).toBeDefined());\n`,
      );
    }
  });
  symlinkSync(nodeModules, join(root, 'node_modules'), 'dir');
  mkdirSync(join(root, 'tools'), { recursive: true });
  symlinkSync(resolve('tools/jest-shards'), join(root, 'tools/jest-shards'), 'dir');
  return root;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve('.nx/deep-hub');
  rmSync(root, { recursive: true, force: true });
  generateDeepHub(root);
  console.log('Synthetic deep-hub workspace written to .nx/deep-hub');
}
