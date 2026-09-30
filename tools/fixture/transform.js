// Minimal Jest transformer for the fixture's TypeScript tests.
const ts = require('typescript');

module.exports = {
  process: (source, fileName) => ({
    code: ts.transpileModule(source, {
      fileName,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  }),
};
