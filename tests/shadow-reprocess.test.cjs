'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeRecord } = require('../tools/shadow-reprocess/shadow-reprocess.cjs');

test('flags collapsed bundles without modifying the source record', () => {
  const source = {
    id: 'source-1',
    raw_message: 'RM07-01 New USDT 350k\nRM67-01 New HKD 1.84m',
    brand: 'Richard Mille', reference: 'RM07-01', currency: 'USDT',
    price_raw: 350000, listing_type: 'WTS', parser_version: 'v3.2',
  };
  const result = analyzeRecord(source);
  assert.equal(result.candidate_count, 2);
  assert.ok(result.change_flags.includes('BUNDLE_SPLIT_REQUIRED'));
  assert.equal(source.reference, 'RM07-01');
});

test('flags brand and reference corrections in shadow output', () => {
  const result = analyzeRecord({
    id: 'source-2', raw_message: '4300V/000R-B509 Used 2022 HKD 900k',
    brand: 'Patek Philippe', reference: '900000', currency: 'HKD',
    price_raw: 900000, listing_type: 'WTS', parser_version: 'v3.1',
  });
  assert.ok(result.change_flags.includes('BRAND_CHANGED'));
  assert.ok(result.change_flags.includes('REFERENCE_CHANGED'));
  assert.equal(result.proposed_candidates[0].brand, 'Vacheron Constantin');
});

test('preserves bare-dollar evidence for review without defaulting USD', () => {
  const result = analyzeRecord({
    id: 'source-3',
    raw_message: '126500LN White $283000',
    brand: 'Rolex',
    reference: '126500LN',
    currency: null,
    price_raw: 283000,
    listing_type: 'WTS',
  });
  const candidate = result.proposed_candidates[0];
  assert.equal(candidate.currency, null);
  assert.equal(candidate.price_usd, null);
  assert.equal(candidate.price_candidates[0].amount_original, 283000);
  assert.equal(candidate.price_candidates[0].currency_original, null);
  assert.equal(candidate.price_candidates[0].review_reason, 'CURRENCY_AMBIGUOUS');
  assert.ok(result.change_flags.includes('PRICE_REVIEW_REQUIRED'));
  assert.ok(!result.change_flags.includes('PRICE_PARSE_FAILED'));
});

test('uses a structured source currency with the amount parsed from raw text', () => {
  const result = analyzeRecord({
    id: 'source-5',
    raw_message: '79833MN fabric 2022 fullset $16000',
    brand: 'Tudor',
    reference: '79833MN',
    currency: 'USD',
    price_raw: 160,
    price_usd: 160,
    listing_type: 'WTS',
  });
  const candidate = result.proposed_candidates[0];
  assert.equal(candidate.price_raw, 16000);
  assert.equal(candidate.price_usd, 16000);
  assert.equal(candidate.currency, 'USD');
  assert.equal(candidate.currency_evidence, 'source_record_currency');
  assert.ok(!result.change_flags.includes('CURRENCY_AMBIGUOUS'));
  assert.ok(result.change_flags.includes('PRICE_CHANGED'));
});

test('uses source HKD only as currency evidence for a bare-dollar text amount', () => {
  const result = analyzeRecord({
    id: 'source-6',
    raw_message: '126500 White N5/26 $283000',
    brand: 'Rolex',
    reference: '126500',
    currency: 'HKD',
    price_raw: 283000,
    price_usd: 36282,
    listing_type: 'WTS',
  }, {
    fxSnapshot: {
      observed_at: '2026-08-11T00:00:00Z',
      source: 'TEST_DATED_RATE',
      usd_per_unit: { HKD: 36282 / 283000 },
    },
  });
  const candidate = result.proposed_candidates[0];
  assert.equal(candidate.price_raw, 283000);
  assert.equal(candidate.price_usd, 36282);
  assert.equal(candidate.currency, 'HKD');
  assert.equal(candidate.currency_evidence, 'source_record_currency');
  assert.equal(candidate.prices[0].conversion_timestamp, '2026-08-11T00:00:00Z');
  assert.equal(candidate.prices[0].conversion_source, 'TEST_DATED_RATE');
  assert.ok(!result.change_flags.includes('CURRENCY_AMBIGUOUS'));
});

test('retains an existing structured source price when a marketplace title has no price text', () => {
  const result = analyzeRecord({
    id: 'source-4',
    raw_message: 'Rolex Yacht-Master 16628 18k Solid Yellow Gold Automatic Mens Watch 40mm',
    brand: 'Rolex',
    reference: '16628',
    currency: 'USD',
    price_raw: 18000,
    price_usd: 18000,
    listing_type: 'WTS',
  });
  assert.equal(result.proposed_candidates[0].price_raw, 18000);
  assert.equal(result.proposed_candidates[0].prices[0].currency_evidence, 'source_record');
  assert.ok(!result.change_flags.includes('PRICE_PARSE_FAILED'));
  assert.equal(result.review_status, 'NO_CHANGE');
});

test('blocks unresolved dealer emoji price codes from automatic promotion', () => {
  const result = analyzeRecord({
    id: 'emoji-price-1',
    raw_message: '126500LN White HKD \u{1F525}\u{1F4B0}',
    brand: 'Rolex',
    reference: '126500LN',
    currency: null,
    price_raw: null,
    listing_type: 'WTS',
  });
  assert.ok(result.change_flags.includes('EMOJI_PRICE_AMBIGUOUS'));
  assert.equal(result.proposed_candidates[0].price_raw, null);
  assert.equal(result.review_status, 'PENDING');
});

test('does not copy a collapsed parent price into bundle children without line prices', () => {
  const result = analyzeRecord({
    id: 'bundle-parent-price',
    raw_message: 'RM010Ti open cert full set\nRM67-01 blue dial\nRM35-03 white dial',
    brand: 'Richard Mille',
    reference: 'RM010TI',
    currency: 'USDT',
    price_raw: 1_390_000,
    price_usd: 1_390_000,
    listing_type: 'WTS',
  });

  assert.equal(result.candidate_count, 3);
  assert.ok(result.change_flags.includes('BUNDLE_SPLIT_REQUIRED'));
  for (const candidate of result.proposed_candidates) {
    assert.equal(candidate.price_raw, null);
    assert.equal(candidate.price_usd, null);
    assert.equal(candidate.currency, null);
    assert.deepEqual(candidate.prices, []);
  }
});

test('proposes a catalog-backed dial only for a deterministic single-dial reference', () => {
  const result = analyzeRecord({
    id: 'dial-1',
    raw_message: 'Rolex 52506 full set USD 26000',
    brand: 'Rolex',
    reference: '52506',
    dial_color: 'Unknown',
    currency: 'USD',
    price_raw: 26000,
    price_usd: 26000,
    listing_type: 'WTS',
  });
  assert.equal(result.proposed_candidates[0].source_dial_color, 'Unknown');
  assert.ok(result.change_flags.includes('DIAL_CHANGED'));
  assert.ok(result.proposed_candidates[0].dial_color);
  assert.equal(result.proposed_candidates[0].dial_evidence, 'exact_catalog_single_dial');
});

test('keeps raw panda evidence but proposes catalog white for Rolex 116500LN', () => {
  const result = analyzeRecord({
    id: 'dial-panda',
    raw_message: 'Rolex Daytona 116500LN panda dial full links USD 30000',
    brand: 'Rolex',
    reference: '116500LN',
    dial_color: 'Unknown',
    currency: 'USD',
    price_raw: 30000,
    price_usd: 30000,
    listing_type: 'WTS',
  });
  const candidate = result.proposed_candidates[0];
  assert.equal(result.candidate_count, 1);
  assert.equal(candidate.dial_color, 'White');
  assert.equal(candidate.dial_evidence, 'explicit_raw_text');
  assert.equal(candidate.dial_reason, 'raw_alias_panda_to_white');
  assert.equal(candidate.raw_line, 'Rolex Daytona 116500LN panda dial full links USD 30000');
  assert.ok(result.change_flags.includes('DIAL_CHANGED'));
  assert.ok(!result.change_flags.includes('DIAL_AMBIGUOUS'));
});

test('flags a text and structured dial conflict instead of silently overwriting it', () => {
  const result = analyzeRecord({
    id: 'dial-2',
    raw_message: 'Rolex 126500LN white dial USD 30000',
    brand: 'Rolex',
    reference: '126500LN',
    dial_color: 'Black',
    currency: 'USD',
    price_raw: 30000,
    price_usd: 30000,
    listing_type: 'WTS',
  });
  assert.ok(result.change_flags.includes('DIAL_AMBIGUOUS'));
  assert.ok(result.change_flags.includes('DIAL_CHANGED'));
});

test('inherits authoritative source WTB intent when the message omits a repeated intent token', () => {
  const result = analyzeRecord({
    id: 'source-wtb-fallback',
    raw_message: 'Patek Philippe 5712/1A blue dial full set',
    brand: 'Patek Philippe',
    reference: '5712/1A',
    listing_type: 'WTB',
  });
  assert.equal(result.proposed_candidates[0].listing_type, 'WTB');
  assert.ok(!result.change_flags.includes('INTENT_CHANGED'));
});

test('explicit listing intent overrides a conflicting source-type fallback and is flagged', () => {
  const result = analyzeRecord({
    id: 'explicit-wts-override',
    raw_message: 'WTS Rolex 116500LN white dial USD 28000',
    brand: 'Rolex',
    reference: '116500LN',
    listing_type: 'WTB',
  });
  assert.equal(result.proposed_candidates[0].listing_type, 'WTS');
  assert.ok(result.change_flags.includes('INTENT_CHANGED'));
});

