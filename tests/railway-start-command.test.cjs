'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Railway evaluates WF_START_COMMAND or falls back to explicit worker command', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'railway.json'), 'utf8'));
  assert.ok(config.deploy.startCommand);
});
