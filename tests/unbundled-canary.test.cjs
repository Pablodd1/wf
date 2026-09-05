'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildCanary, buildCanaryRow, explicitChildIntent, resolveIntent } = require('../tools/multilisting/build-unbundled-canary.cjs');

test('inherits WTB parent context when the child line has no explicit intent', () => {
  const result = resolveIntent({ raw_line: '5712/1A blue' }, { listing_type: 'WTB' });
  assert.deepEqual(result, { value: 'WTB', evidence: 'inherited_parent_context', blocker: null });
});

test('explicit child intent overrides parent context', () => {
  assert.equal(explicitChildIntent('WTS 126500LN White 283k HKD'), 'WTS');
  const result = resolveIntent({ raw_line: 'WTS 126500LN White 283k HKD' }, { listing_type: 'WTB' });
  assert.equal(result.value, 'WTS');
  assert.equal(result.evidence, 'explicit_child_text');
});

test('blocks unusable parent context rather than defaulting to WTS', () => {
  const result = resolveIntent({ raw_line: '5712/1A blue' }, { listing_type: 'GARBAGE' });
  assert.equal(result.value, null);
  assert.equal(result.blocker, 'PARENT_INTENT_UNUSABLE');
});

test('prefers explicit adjacent raw dial and requires review on export conflict', () => {
  const row = buildCanaryRow({
    listing_id: 'source-1_000',
    source_record_id: 'source-1',
    candidate_index: '0',
    raw_line: '15202BC salmon 2019 used full set 855k hkd',
    brand: 'Audemars Piguet',
    reference: '15202BC',
    model: '15202BC',
    listing_type: 'WTS',
    dial_color: 'Black',
    price_raw: '855000',
    price_currency: 'HKD',
    price_usd: '109615',
  }, {
    raw_message: 'Audemars Piguet\n15202BC salmon 2019 used full set 855k hkd',
    listing_type: 'WTS',
  });
  assert.equal(row.dial_color, 'Salmon');
  assert.equal(row.exact_raw_lineage, true);
  assert.ok(row.review_reasons.includes('DIAL_RAW_SOURCE_CONFLICT'));
  assert.equal(row.production_approved, false);
});

test('writes review-ready and held artifacts separately', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-unbundle-canary-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const listingsPath = path.join(directory, 'listings.csv');
  const parentsPath = path.join(directory, 'parents.csv');
  const outputDir = path.join(directory, 'output');
  fs.writeFileSync(listingsPath, [
    'listing_id,source_record_id,candidate_index,brand,reference,model,raw_line,listing_type,dial_color,price_raw,price_currency,price_usd',
    'source-1_000,source-1,0,Rolex,116500LN,Daytona,116500LN White 28000 USD,WTS,White,28000,USD,28000',
    'source-2_000,source-2,0,Unknown,NOREF,Unknown,NOREF 1000 USD,WTS,Black,1000,USD,1000',
  ].join('\n'));
  fs.writeFileSync(parentsPath, [
    'source_record_id,raw_message,listing_type,created_at',
    'source-1,116500LN White 28000 USD,WTS,2026-07-01T00:00:00Z',
    'source-2,NOREF 1000 USD,WTS,2026-07-01T00:00:00Z',
  ].join('\n'));

  const { report } = await buildCanary({ listingsPath, parentsPath, outputDir, limit: 2 });
  assert.equal(report.rows, 2);
  assert.ok(fs.existsSync(path.join(outputDir, 'review-ready.jsonl')));
  assert.ok(fs.existsSync(path.join(outputDir, 'held.jsonl')));
  assert.equal(fs.readFileSync(path.join(outputDir, 'held.jsonl'), 'utf8').trim().split('\n').length, 1);
});

test('blocks bare-dollar WTS prices without raw-message currency evidence', () => {
  const row = buildCanaryRow({
    listing_id: 'source-3_000',
    source_record_id: 'source-3',
    candidate_index: '0',
    raw_line: '116500LN White $283000',
    brand: 'Rolex',
    reference: '116500LN',
    listing_type: 'WTS',
    dial_color: 'White',
    price_raw: '283000',
    price_currency: 'HKD',
    price_usd: '36282',
  }, {
    raw_message: 'Rolex inventory\n116500LN White $283000',
    listing_type: 'WTS',
  });
  assert.equal(row.review_status, 'BLOCKED_PRICE_CURRENCY');
  assert.ok(row.blockers.includes('CURRENCY_AMBIGUOUS'));
  assert.ok(row.blockers.includes('PRICE_PARSE_FAILED'));
  assert.equal(row.price_currency, 'HKD');
});

test('inherits explicit HKD section context from the preserved parent message', () => {
  const row = buildCanaryRow({
    listing_id: 'source-5_000',
    source_record_id: 'source-5',
    candidate_index: '0',
    raw_line: '116500LN White $283000',
    brand: 'Rolex',
    reference: '116500LN',
    listing_type: 'WTS',
    dial_color: 'White',
    price_raw: '283000',
    price_currency: 'HKD',
    price_usd: '36282',
  }, {
    raw_message: 'HKD inventory\n116500LN White $283000',
    listing_type: 'WTS',
  });
  assert.equal(row.parsed_price_raw, 283000);
  assert.equal(row.parsed_price_currency, 'HKD');
  assert.ok(!row.blockers.includes('CURRENCY_AMBIGUOUS'));
  assert.ok(!row.blockers.includes('PRICE_PARSE_FAILED'));
});

test('uses explicit HKD price evidence while preserving exported values for audit', () => {
  const row = buildCanaryRow({
    listing_id: 'source-4_000',
    source_record_id: 'source-4',
    candidate_index: '0',
    raw_line: '116500LN White 283K HKD',
    brand: 'Rolex',
    reference: '116500LN',
    listing_type: 'WTS',
    dial_color: 'White',
    price_raw: '283',
    price_currency: 'USD',
    price_usd: '283',
  }, {
    raw_message: '116500LN White 283K HKD',
    listing_type: 'WTS',
  });
  assert.equal(row.price_raw, 283000);
  assert.equal(row.price_currency, 'HKD');
  assert.equal(row.price_raw_exported, 283);
  assert.ok(row.review_reasons.includes('PRICE_RAW_SOURCE_CONFLICT'));
  assert.ok(row.review_reasons.includes('CURRENCY_RAW_SOURCE_CONFLICT'));
});

test('repairs a slash date exported as the Patek reference and price', () => {
  const row = buildCanaryRow({
    listing_id: 'source-patek_000',
    source_record_id: 'source-patek',
    candidate_index: '0',
    raw_line: 'NEW PP5269R Blue 2024/5 HKD449k',
    brand: 'Patek Philippe',
    reference: '2024/5',
    listing_type: 'WTS',
    dial_color: 'Salmon',
    price_raw: '5',
    price_currency: 'HKD',
    price_usd: '1',
  }, {
    raw_message: 'PP HK NEW\nNEW PP5269R Blue 2024/5 HKD449k',
    listing_type: 'WTS',
  });
  assert.equal(row.reference, '5269R');
  assert.equal(row.reference_exported, '2024/5');
  assert.equal(row.price_raw, 449000);
  assert.equal(row.price_currency, 'HKD');
  assert.ok(row.review_reasons.includes('REFERENCE_CORRECTION_AVAILABLE'));
  assert.ok(row.review_reasons.includes('PRICE_RAW_SOURCE_CONFLICT'));
});
