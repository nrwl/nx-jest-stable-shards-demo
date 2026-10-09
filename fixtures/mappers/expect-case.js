const { realpathSync } = require('node:fs');
const { relative, sep } = require('node:path');
const cases = require('./cases.json');

/**
 * Registers a test that passes when Jest resolved the case's specifier to the
 * file `cases.json` records. `resolved` is `require.resolve(specifier)` as
 * evaluated in the importer, under the running project's configuration.
 */
module.exports = function expectCase(id, resolved) {
  test(id, () => {
    const real = realpathSync(resolved);
    const actual = real.split(sep).includes('node_modules') ? null : relative(__dirname, real);
    expect(actual).toBe(cases[id].resolved);
  });
};
