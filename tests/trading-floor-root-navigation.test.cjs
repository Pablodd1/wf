'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

test('root and unknown routes resolve to the Trading Floor without loading LandingPage', () => {
  const app = read('src/App.tsx');
  assert.doesNotMatch(app, /import\(['"]@\/pages\/LandingPage['"]\)/);
  assert.match(app, /<Route path="\/" element=\{<Navigate to="\/trading" replace \/>\} \/>/);
  assert.match(app, /<Route path="\*" element=\{<Navigate to="\/trading" replace \/>\} \/>/);
});

test('primary and recovery navigation returns to the Trading Floor', () => {
  const header = read('src/components/MarketHeader.tsx');
  const boundary = read('src/components/RouteLoadBoundary.tsx');
  const navigation = read('src/components/MarketNav.tsx');
  assert.doesNotMatch(header, /LANDING PAGE/);
  assert.match(header, /<Link to="\/trading" aria-label="Curated Luxury Trading Floor"/);
  assert.match(boundary, /href="\/#\/trading"/);
  assert.match(boundary, /Return to Trading Floor/);
  assert.match(navigation, /location\.pathname !== '\/trading'/);
});

test('Trading Floor total does not describe the single-watch summary as all postings', () => {
  const floor = read('src/pages/TradingFloor.tsx');
  assert.match(floor, /released single-watch listings · approved multi-item posts counted separately/);
  assert.doesNotMatch(floor, /watches in the Trading Floor · live database total/);
});
