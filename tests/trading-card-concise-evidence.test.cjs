'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Trading Floor cards use concise price and dealer rating labels globally', () => {
  const floor = read('src/pages/TradingFloor.tsx');
  const dealerEvidence = read('src/components/ListingDealerEvidence.tsx');

  assert.match(floor, /displayedCardPriceRating\.rating\.label/);
  assert.match(dealerEvidence, />Dealer rating not available<\/span>/);
  for (const source of [floor, dealerEvidence]) {
    assert.doesNotMatch(source, /Owner-assumed USD - tracked, excluded from averages unless independently qualified/);
    assert.doesNotMatch(source, /No exact directory match/);
  }
});

test('Cartier and Tudor are present in customer discovery controls', () => {
  const inventory = read('api/reviewed-market-inventory.js');
  const research = read('src/pages/PriceResearch.tsx');

  assert.match(inventory, /'Vacheron Constantin', 'Omega', 'Tudor'/);
  assert.match(research, /const POPULAR_BRANDS = \[[^\]]*'Cartier'[^\]]*'Tudor'/);
});
