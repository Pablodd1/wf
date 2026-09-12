'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { enforceListingDisplayContract } = require('../shared/listing-display-contract.cjs');

const base = {
  listing_id: 'synthetic-fx-contract', source_id: 'synthetic-fx-contract',
  source_hash: createHash('sha256').update('synthetic-fx-contract').digest('hex'),
  raw_message_text: '[SYNTHETIC FIXTURE]\nWTS watch EUR 1000\nOriginal spacing  preserved.',
  intent: 'WTS', original_price_currency: 'EUR', original_price_amount: 1000,
  price_usd: 1100, price_research_eligible: true, included_in_statistics: true,
};

test('a verified label cannot replace any missing FX evidence', () => {
  for (const price_evidence_status of ['DATED_VERIFIED_FX', 'EXPLICIT_SOURCE_FX_CONVERTED', 'SOURCE_EXPLICIT_USD_MATCH']) {
    for (const missing of ['fx_rate', 'fx_source', 'fx_date']) {
      const input = { ...base, fx_rate: 1.1, fx_source: 'synthetic fixture', fx_date: '2026-09-05', price_evidence_status };
      delete input[missing];
      const row = enforceListingDisplayContract(input);
      assert.equal(row.price_display_verified, false, `${price_evidence_status}, missing ${missing}`);
      assert.equal(row.price_research_eligible, false);
      assert.equal(row.included_in_statistics, false);
      assert.equal(row.raw_message_text, input.raw_message_text);
    }
  }
});

test('explicit USD and converted FX labels cannot contradict the currency path', () => {
  for (const input of [
    { ...base, fx_rate: 1.1, fx_source: 'synthetic fixture', fx_date: '2026-09-05', price_evidence_status: 'SOURCE_EXPLICIT_USD_MATCH' },
    { ...base, original_price_currency: 'USD', price_evidence_status: 'DATED_VERIFIED_FX' },
  ]) {
    const row = enforceListingDisplayContract(input);
    assert.equal(row.price_display_verified, false);
    assert.equal(row.price_research_eligible, false);
    assert.equal(row.included_in_statistics, false);
  }
});

test('supported source USD and dated FX remain displayable; WTB remains outside asking-price statistics', () => {
  for (const input of [
    { ...base, original_price_currency: 'USD', original_price_amount: 1100, price_evidence_status: 'SOURCE_EXPLICIT_USD_MATCH' },
    { ...base, fx_rate: 1.1, fx_source: 'synthetic fixture', fx_date: '2026-09-05', price_evidence_status: 'DATED_VERIFIED_FX' },
  ]) {
    const row = enforceListingDisplayContract(input);
    assert.equal(row.price_display_verified, true);
    assert.equal(row.price_research_eligible, true);
    assert.equal(row.raw_message_text, base.raw_message_text);
    const demand = enforceListingDisplayContract({ ...input, intent: 'WTB' });
    assert.equal(demand.price_display_verified, true);
    assert.equal(demand.price_research_eligible, false);
    assert.equal(demand.included_in_statistics, false);
  }
});

test('an explicit unresolved evidence status also excludes statistics and Price Research', () => {
  const row = enforceListingDisplayContract({ ...base, original_price_currency: 'USD', price_evidence_status: 'REVIEW_REQUIRED' });
  assert.equal(row.price_display_verified, false);
  assert.equal(row.price_research_eligible, false);
  assert.equal(row.included_in_statistics, false);
});
