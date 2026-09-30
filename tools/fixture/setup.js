// Jest loads this before every test file; no test imports it or work.js.
globalThis.burn = require('./work.js').burn;
