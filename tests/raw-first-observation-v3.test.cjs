'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyRawPost } = require('../tools/audit/raw-first-rolex-patek-lib.cjs');
const { enrichParent, normalizeStructuralText, occurrenceSummary } = require('../tools/audit/raw-first-observation-v3-lib.cjs');

function source(rawText, rawData = {}) {
  return {
    id: '20000000-0000-4000-8000-000000000001',
    raw_message_id: '10000000-0000-4000-8000-000000000001',
    source_record_id: 'source-1', source_hash: 'a'.repeat(64), raw_text: rawText,
    raw_data: { brand: 'Rolex', type: 'sale', is_bundle: true, ...rawData },
  };
}

function artifact(count) {
  return { children: Array.from({ length: count }, () => ({
    qualified_pr: true, dealer_linked: false, image_linked: false,
    country_resolved: false, image_status: 'SOURCE_IMAGE_UNAVAILABLE',
  })) };
}

test('identical normalized offer blocks share one observation but retain occurrences', () => {
  const classified = classifyRawPost(source('Rolex WTS\n116500LN white USD 25,000\n• 116500LN   white USD 25,000'));
  const rows = enrichParent(classified, artifact(2));
  assert.deepEqual(rows.map(row => row.classification), [
    'UNIQUE_MARKET_OBSERVATION', 'REPEATED_IDENTICAL_OFFER',
  ]);
  assert.equal(rows[0].unique_observation_key, rows[1].unique_observation_key);
  assert.notEqual(rows[0].raw_occurrence_key, rows[1].raw_occurrence_key);
  assert.equal(occurrenceSummary(rows).unique_market_observations, 1);
});

test('same reference with material evidence remains separate', () => {
  const classified = classifyRawPost(source('Rolex WTS\n116500LN white USD 25,000\n116500LN black USD 27,000'));
  const rows = enrichParent(classified, artifact(2));
  assert.ok(rows.every(row => row.classification === 'UNIQUE_MARKET_OBSERVATION'));
  assert.notEqual(rows[0].unique_observation_key, rows[1].unique_observation_key);
});

test('reference-only parser artifact fails closed', () => {
  const classified = classifyRawPost(source('Rolex WTS\n116500LN'));
  const rows = enrichParent(classified, artifact(1));
  assert.equal(rows[0].classification, 'FIELD_ONLY_FRAGMENT');
  assert.equal(rows[0].unique_observation_key, null);
});

test('explicit quantity is preserved as evidence without inventing physical watches', () => {
  const classified = classifyRawPost(source('Rolex WTS\n116500LN white USD 25,000 qty 2'));
  const rows = enrichParent(classified, artifact(1));
  assert.equal(rows[0].classification, 'UNIQUE_MARKET_OBSERVATION');
  assert.equal(rows[0].quantity_marker.count, 2);
  assert.equal(occurrenceSummary(rows).explicit_quantity_observations, 1);
});

test('repeated identical quantity block remains one observation with repeated lineage', () => {
  const classified = classifyRawPost(source('Rolex WTS\n116500LN white USD 25,000 qty 2\n116500LN white USD 25,000 qty 2'));
  const rows = enrichParent(classified, artifact(2));
  assert.deepEqual(rows.map(row => row.classification), [
    'UNIQUE_MARKET_OBSERVATION', 'REPEATED_IDENTICAL_OFFER',
  ]);
  assert.equal(rows[0].quantity_marker.count, 2);
});

test('structural normalization removes formatting but preserves material tokens', () => {
  assert.equal(normalizeStructuralText('• 116500LN   WHITE, USD 25,000'), '116500ln white usd 25000');
  assert.notEqual(normalizeStructuralText('116500LN white USD 25,000'),
    normalizeStructuralText('116500LN black USD 27,000'));
});
