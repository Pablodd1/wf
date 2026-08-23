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

  assert.match(floor, /priceRating\.label/);
  assert.match(floor, /loadPriceResearchBatchSummaries\(batch, controller\.signal\)/);
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

test('exact dealer profiles connect Trading Floor and Price Research to Reference Check', () => {
  const floor = read('src/pages/TradingFloor.tsx');
  const research = read('src/pages/PriceResearch.tsx');

  assert.match(floor, /listing\.dealer_profile_path \? \(/);
  assert.match(research, /row\.dealer_profile_path &&/);
  assert.match(research, /Check this dealer in Reference Check/);
  assert.doesNotMatch(research, /No exact directory match/);
});

test('Virtual Authenticator is absent from customer navigation', () => {
  const header = read('src/components/MarketHeader.tsx');
  const footer = read('src/components/Footer.tsx');

  assert.doesNotMatch(header, /VIRTUAL AUTHENTICATOR|VIRTUAL_AUTHENTICATOR_URL/);
  assert.doesNotMatch(footer, /VIRTUAL AUTHENTICATOR|VIRTUAL_AUTHENTICATOR_URL/);
});
