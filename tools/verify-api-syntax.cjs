#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const apiDirectory = path.join(root, 'api');
const conflictMarker = /^(?:<{7}|={7}|>{7})(?:\s|$)/m;
const failures = [];

for (const entry of fs.readdirSync(apiDirectory, { withFileTypes: true })) {
  if (!entry.isFile() || path.extname(entry.name) !== '.js') continue;
  const file = path.join(apiDirectory, entry.name);
  const source = fs.readFileSync(file, 'utf8');
  if (conflictMarker.test(source)) failures.push(`${entry.name}: unresolved merge-conflict marker`);

  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failures.push(`${entry.name}: ${String(result.stderr || result.stdout).trim()}`);
  }
}

if (failures.length) {
  process.stderr.write(`API verification failed:\n${failures.join('\n')}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('API syntax and merge-marker verification passed.\n');
}
