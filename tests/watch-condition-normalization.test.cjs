'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeWatchConditionFields,
  normalizeWatchDial,
} = require('../api/_lib/watch-condition-normalization.cjs');
const { normalizeDialValue, resolveDial } = require('../api/_lib/dial-normalization.cjs');
const { segmentDealerMessage } = require('../api/_lib/normalization-v4.cjs');
const { mapReviewedRecord } = require('../api/reviewed-market-inventory.js');
const { directSubmissionToMarketRow, qnsaReferenceRowToMarketRow } = require('../api/price-research.js');

test('Daytona mint condition cannot manufacture a Green dial', () => {
  const corrected = normalizeWatchConditionFields({
    dial_color: 'Green',
    condition: 'New',
    raw_message: 'WTS Rolex Daytona 116508 mint full set USD 68,300',
  });
  assert.equal(corrected.condition, 'Used - Like New');
  assert.equal(corrected.dial_color, null);
});

test('explicit Green dial remains Green while mint remains condition', () => {
  const corrected = normalizeWatchConditionFields({
    dial_color: 'Green',
    condition: null,
    raw_message: 'Rolex Daytona 116508 mint, green dial, full set USD 68,300',
  });
  assert.equal(corrected.condition, 'Used - Like New');
  assert.equal(corrected.dial_color, 'Green');
});

test('Mint and Mint Green are rejected as dial values for every brand', () => {
  assert.equal(normalizeDialValue('Mint').known, false);
  assert.equal(normalizeDialValue('Mint Green').known, false);
  assert.equal(normalizeWatchDial('Mint Green', 'Patek 5712 mint condition'), null);
});

test('catalog-supported green is resolved only from independent source text', () => {
  const conditionOnly = resolveDial({
    sourceDial: 'Green',
    rawText: 'Rolex Daytona 116508 mint full set',
    catalogDials: ['Black', 'Green'],
  });
  const explicitDial = resolveDial({
    sourceDial: 'Mint Green',
    rawText: 'Rolex Daytona 116508 mint green dial',
    catalogDials: ['Black', 'Green'],
  });
  assert.equal(conditionOnly.value, null);
  assert.equal(explicitDial.value, 'Green');
});

test('normalization v4 records mint as Like New condition', () => {
  const candidates = segmentDealerMessage('WTS Rolex Daytona 116508 mint full set USD 68,300');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].context.condition_context, 'Used - Like New');
});

test('Trading Floor boundary removes contaminated Daytona dial and corrects condition', () => {
  const record = mapReviewedRecord({
    id: 'daytona-mint',
    supplied_brand: 'Rolex',
    model: 'Daytona',
    normalized_reference: '116508',
    raw_reference: '116508',
    dial_color: 'Green',
    condition: 'New',
    raw_message: 'WTS Rolex Daytona 116508 mint full set USD 68,300',
    item_category: 'WATCH',
    listing_type: 'WTS',
    posting_date: '2026-08-15T00:00:00Z',
    normalization_run_complete: true,
    raw_lineage_verified: true,
  });
  assert.equal(record.dial_color, null);
  assert.equal(record.condition, 'Used - Like New');
  assert.equal(record.has_complete_identity, false);
});

test('Price Research adapter applies the same correction before cohorting', () => {
  const record = qnsaReferenceRowToMarketRow({
    id: 'daytona-mint',
    canonical_brand: 'Rolex',
    catalog_model: 'Daytona',
    normalized_reference: '116508',
    dial_color: 'Green',
    condition: 'New',
    raw_message: 'WTS Rolex Daytona 116508 mint full set USD 68,300',
    listing_type: 'WTS',
  });
  assert.equal(record.dial_color, null);
  assert.equal(record.condition, 'Used - Like New');
});

test('incoming POST IT watch records use mint as condition, not dial', () => {
  const record = directSubmissionToMarketRow({
    id: 'post-mint',
    category: 'WATCH',
    intent: 'WTS',
    review_status: 'APPROVED',
    publication_status: 'PUBLISHED',
    raw_message: 'Rolex Daytona 116508 mint full set USD 68,300',
    claimed_fields: {
      catalog_confirmed: true,
      brand: 'Rolex',
      model: 'Daytona',
      reference: '116508',
      dial_color: 'Green',
      condition: 'New',
      currency: 'USD',
      price_amount: 68300,
    },
  });
  assert.equal(record.dial_color, null);
  assert.equal(record.condition, 'Used - Like New');
});
