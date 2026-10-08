module.exports = {
  displayName: 'alpha',
  preset: '../../jest.preset.js',
  testSequencer: require.resolve('../../tools/jest-shards/sequencer.ts'),
  // Jest tries these in order, and the first pattern that matches wins.
  moduleNameMapper: {
    '^@acme/flavor$': '<rootDir>/src/flavors/alpha.js',
    '^@acme/ui/button$': '<rootDir>/src/ui/special-button.js',
    '^@acme/ui/(.*)$': '<rootDir>/src/ui/generic/$1.js',
    '^@acme/alias-to-workspace-package$': '@acme/linked',
    '^@acme/alias-to-external-package$': 'minimatch',
    '^@acme/fallback$': ['<rootDir>/src/absent.js', '<rootDir>/src/fallback.js'],
    '^@acme/service$': '<rootDir>/test-doubles/service.js',
    '^@acme/([a-z]+)/internal/(.*)$': '<rootDir>/../../pkgs/$1/src/$2',
    '^@acme/built$': '<rootDir>/../../pkgs/built/src/index.js',
  },
};
