// An async config: the plugin loads it with Jest's own loader.
module.exports = async () => ({
  displayName: 'beta',
  preset: '../../jest.preset.js',
  testSequencer: require.resolve('../../tools/jest-shards/sequencer.ts'),
  moduleNameMapper: {
    '^@acme/flavor$': '<rootDir>/src/flavors/beta.js',
    // The same two patterns as alpha, in the other order: here the general one wins.
    '^@acme/ui/(.*)$': '<rootDir>/src/ui/generic/$1.js',
    '^@acme/ui/button$': '<rootDir>/src/ui/special-button.js',
    '^@acme/built$': '<rootDir>/test-doubles/built.js',
  },
  modulePaths: ['<rootDir>/modules'],
  testEnvironmentOptions: { customExportConditions: ['browser'] },
});
