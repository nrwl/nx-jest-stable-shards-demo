// A mapped mock is an ordinary module: its own imports are part of the closure.
module.exports = { service: 'double', data: require('./service-data') };
