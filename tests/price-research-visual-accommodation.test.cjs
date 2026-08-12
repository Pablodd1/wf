'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('featured research renders only the controlled Rolex and Patek samples', () => {
  const shortcuts = read('src/components/PriorityReferenceShortcuts.tsx');
  const cohorts = read('src/data/priorityReferenceCohorts.ts');
  assert.match(shortcuts, /PRIORITY_REFERENCE_COHORTS\.slice\(0, 2\)/);
  assert.match(cohorts, /Rolex Daytona 116500LN/);
  assert.match(cohorts, /Patek Philippe Nautilus 5712/);
});

test('Price Research shows compact full-width WTS evidence and keeps WTB aggregate-only', () => {
  const page = read('src/pages/PriceResearch.tsx');
  assert.doesNotMatch(page, /<DemandSignalsSection data=\{data\}/);
  assert.match(page, /filter\(row => !\['WTB', 'BUY'\]\.includes/);
  assert.match(page, /Compact, full-width WTS source evidence only/);
  assert.match(page, /width: '100%'/);
  assert.match(page, /WTB \/ WTS ratio/);
  assert.match(page, /wtbDemandCount\.toLocaleString\(\)/);
});
