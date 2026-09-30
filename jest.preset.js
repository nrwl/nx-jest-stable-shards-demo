const { join } = require('node:path');

// Shared by every fixture project's jest.config.js.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/*.test.[jt]s'],
  transform: { '\\.ts$': join(__dirname, 'tools/fixture/transform.js') },
  setupFiles: [join(__dirname, 'tools/fixture/setup.js')],
  moduleNameMapper: { '^@packages/(.*)$': join(__dirname, 'packages/$1') },
};
