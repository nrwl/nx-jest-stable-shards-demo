module.exports = {
  displayName: 'gamma',
  // Jest's root is below the Nx project root: <rootDir> is apps/gamma/src, and
  // Jest looks for the preset from there.
  rootDir: 'src',
  preset: '../../../jest.preset.js',
  testSequencer: require.resolve('../../tools/jest-shards/sequencer.ts'),
  moduleNameMapper: {
    '^@acme/flavor$': '<rootDir>/flavor.js',
  },
};
