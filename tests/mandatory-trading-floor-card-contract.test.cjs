'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const floor = fs.readFileSync(path.join(root, 'src', 'pages', 'TradingFloor.tsx'), 'utf8');
const dealer = fs.readFileSync(path.join(root, 'src', 'components', 'ListingDealerEvidence.tsx'), 'utf8');
const card = floor.slice(floor.indexOf('function ListingCard'), floor.indexOf('function ListingDetails'));

test('every Trading Floor card keeps mandatory evidence areas visible', () => {
  assert.match(card, /!cardHasImage[\s\S]*NO IMAGE/);
  assert.match(floor, /sourcePrice \|\| ambiguousPriceDisplay/);
  assert.match(card, /Open for rating/);
  assert.match(card, /Posting identity requires review/);
  assert.match(card, /Posting date requires review/);
  assert.match(dealer, />Not rated<\/span>/);
  assert.match(card, /customerIntentLabel\(listing\.listing_type\)/);
  assert.match(floor, /Original message requires review/);
  assert.match(card, /LATEST OBSERVED · CHECK AVAILABILITY/);
  assert.match(card, /CONFIRMED CURRENT/);
});

test('mandatory fallbacks never fabricate evidence', () => {
  assert.doesNotMatch(card, /catalog image|reference image/i);
  assert.doesNotMatch(floor, /OWNER_ASSUMED_USD/);
  assert.doesNotMatch(dealer, /rating \|\| [1-9]/);
});
