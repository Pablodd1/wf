'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

test('Trading Floor and Luxury Research share the same dealer evidence renderer', () => {
  const floor = read('src/pages/TradingFloor.tsx');
  const luxury = read('src/pages/LuxuryResearch.tsx');
  assert.match(floor, /<ListingDealerEvidence/);
  assert.match(luxury, /<ListingDealerEvidence/);
});

test('dealer evidence never invents a numeric rating and protects private contacts', () => {
  const evidence = read('src/components/ListingDealerEvidence.tsx');
  assert.match(evidence, /ratingEvidenceStatus === 'SOURCE_SUPPLIED'/);
  assert.match(evidence, /ratingEvidenceStatus === 'SOURCE_FEEDBACK_COUNT'/);
  assert.match(evidence, /Number\.isFinite\(rating\) && rating > 0 && hasReviews/);
  assert.match(evidence, />Not rated<\/span>/);
  assert.match(evidence, /contactPublicationApproved \?/);
  assert.match(evidence, /publishedGroupCount > 0/);
  assert.match(evidence, /Reference Check profile/);
  assert.doesNotMatch(evidence, /watchfacts\.com/i);
});
