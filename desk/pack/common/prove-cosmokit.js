#!/usr/bin/env node
// Require cosmokit the same way ego-browser/schemastery does.
// File existence is not enough: a dest without this resolve dies at boot.
'use strict';
const path = require('path');
const dir = process.argv[2];
if (!dir) {
  console.error('usage: prove-cosmokit.js <ego-node_modules>');
  process.exit(2);
}
const from = path.join(dir, 'schemastery', 'lib', 'index.cjs');
require('module').createRequire(from)('cosmokit');
console.log('EGO_COSMOKIT_REQUIRE=1');
