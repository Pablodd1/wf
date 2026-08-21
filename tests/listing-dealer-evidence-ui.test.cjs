'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

test('Trading Floor, Price Research, and Luxury Research share the same dealer evidence renderer', () => {
  const floor = read('src/pages/TradingFloor.tsx');
  const priceResearch = read('src/pages/PriceResearch.tsx');
  const luxury = read('src/pages/LuxuryResearch.tsx');
  assert.match(floor, /<ListingDealerEvidence/);
  assert.doesNotMatch(floor, /seller_review_count \|\| 0\} reviews/);
  assert.doesNotMatch(floor, /Multiple released watch brands use repeated URL filters/);
  assert.match(priceResearch, /<ListingDealerEvidence/);
  assert.match(luxury, /<ListingDealerEvidence/);
});

test('dealer evidence never invents a numeric rating and protects private contacts', () => {
  const evidence = read('src/components/ListingDealerEvidence.tsx');
  assert.match(evidence, /ratingEvidenceStatus === 'SOURCE_SUPPLIED'/);
  assert.match(evidence, /ratingEvidenceStatus === 'SOURCE_FEEDBACK_COUNT'/);
  assert.match(evidence, /Number\.isFinite\(rating\) && rating > 0 && hasReviews/);
  assert.match(evidence, />Dealer rating not available<\/span>/);
  assert.match(evidence, /contactPublicationApproved && sellerPhone/);
  assert.match(evidence, /publishedGroupCount > 0/);
  assert.match(evidence, /Reference Check profile/);
  assert.doesNotMatch(evidence, /watchfacts\.com/i);
});
