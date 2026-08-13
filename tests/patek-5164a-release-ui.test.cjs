'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'TradingFloor.tsx'), 'utf8');

test('5164A cards fail closed on legacy HKD-magnitude dollar values', () => {
  assert.match(source, /function isReferencePricePlausible\(listing: ListingRecord, price: number \| null\)/);
  assert.match(source, /brand === 'PATEK PHILIPPE' && reference\.startsWith\('5164A'\)/);
  assert.match(source, /price! >= 20_000 && price! <= 200_000/);
  assert.match(source, /verifiedPlausible = isReferencePricePlausible\(listing, verifiedUsd\)/);
  assert.match(source, /workbookPlausible = isReferencePricePlausible\(listing, reviewedWorkbookUsd\)/);
});

test('raw source evidence remains available while the card withholds an implausible display price', () => {
  assert.match(source, /Original raw message/);
  assert.match(source, /verifiedPlausible \? formatUsdPrice\(verifiedUsd\) : 'Price under review'/);
});
