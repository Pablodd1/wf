'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Railway keeps the existing worker default and permits an isolated service override', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'railway.json'), 'utf8'));
  assert.match(config.deploy.startCommand, /WF_START_COMMAND/);
  assert.match(config.deploy.startCommand, /tools\/shadow-reprocess\/railway-worker\.cjs/);
  assert.doesNotMatch(config.deploy.startCommand, /mariadb-live/);
});
