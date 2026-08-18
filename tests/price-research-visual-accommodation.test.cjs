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

test('Price Research shows full-width paginated WTS evidence followed by pageable WTB cards', () => {
  const page = read('src/pages/PriceResearch.tsx');
  assert.match(page, /<DemandSignalsSection/);
  assert.match(page, /filter\(row => !\['WTB', 'BUY'\]\.includes/);
  assert.match(page, /All available WTS evidence is accessible page by page/);
  assert.match(page, /Previous WTS/);
  assert.match(page, /Next WTB/);
  assert.match(page, /width: '100%'/);
  assert.match(page, /grid-cols-\[60px_minmax\(0,1fr\)\] sm:!flex/);
  assert.match(page, /line-clamp-1 sm:line-clamp-2/);
  assert.match(page, /WTB \/ WTS ratio/);
  assert.match(page, /wtbDemandCount\.toLocaleString\(\)/);
});

test('Price Research uses more desktop width while retaining responsive gutters', () => {
  const page = read('src/pages/PriceResearch.tsx');
  const wideShells = page.match(/max-w-\[1440px\]/g) || [];
  assert.equal(wideShells.length, 2);
  assert.doesNotMatch(page, /max-w-6xl/);
  assert.match(page, /px-4 sm:px-6 lg:px-8/);
  assert.match(page, /overflow-x-hidden/);
});
