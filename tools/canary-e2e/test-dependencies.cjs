'use strict';
const path = require('node:path');
const { createRequire } = require('node:module');
module.exports = process.env.RC50_TEST_DEPENDENCY_ROOT
  ? createRequire(path.resolve(process.env.RC50_TEST_DEPENDENCY_ROOT, 'package.json')) : require;
