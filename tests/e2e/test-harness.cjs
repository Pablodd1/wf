'use strict';

const assert = require('node:assert/strict');

const testRegistry = [];
let currentTier = 'Default Tier';

function setTier(name) {
  currentTier = name;
}

function test(name, fn) {
  testRegistry.push({
    tier: currentTier,
    name,
    fn,
  });
}

function getTestRegistry() {
  return testRegistry;
}

function clearRegistry() {
  testRegistry.length = 0;
  currentTier = 'Default Tier';
}

module.exports = {
  assert,
  setTier,
  test,
  getTestRegistry,
  clearRegistry,
};
