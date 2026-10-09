// One source file, imported by three projects that each map `@acme/flavor` differently.
module.exports = { resolved: require.resolve('@acme/flavor'), flavor: require('@acme/flavor') };
