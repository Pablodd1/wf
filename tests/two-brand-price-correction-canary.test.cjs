'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { applyCorrection, correctionRecord } = require('../tools/mariadb-live/apply-two-brand-price-correction.cjs');

test('correction record admits only exact single Rolex/Patek priced evidence', () => {
  const source = { source_record_id: 'mysql_1', raw_sha256: 'a'.repeat(64), raw_message: 'Rolex 116500LN $23,995', source_created_on: '2026-01-01' };
  const proposal = {
    source_hash: source.raw_sha256, bundle_status: 'SINGLE_CANDIDATE', review_disposition: 'HUMAN_REVIEW', review_reasons: [],
    normalization: { normalization_version: 'test', proposed_candidates: [{ brand: 'Rolex', reference: '116500LN', listing_type: 'WTS', dial_color: 'Black', prices: [{ amount_original: 23995, amount_usd: 23995, currency_original: 'USD', currency_evidence: 'usd_defaulted_by_policy', conversion_rate: 1, conversion_source: 'USD_DEFAULTED_BY_POLICY', is_primary: true }] }] },
    catalog_confirmation: { confirmed: true },
  };
  const record = correctionRecord(source, proposal);
  assert.equal(record.candidate.brand, 'Rolex');
  assert.equal(record.candidate.price.amount_usd, 23995);
  assert.equal(correctionRecord(source, { ...proposal, bundle_status: 'BUNDLE_SPLIT_REQUIRED' }), null);
});

test('RPC payload is bounded and deterministic', async () => {
  const records = [{ source_record_id: 'mysql_1', source_hash: 'a'.repeat(64), candidate: { brand: 'Rolex', reference: '116500LN', price: { amount_original: 1, amount_usd: 1, currency_original: 'USD', conversion_rate: 1, conversion_source: 'SOURCE_USD_OR_USDT' } } }];
  let request;
  const fetchImpl = async (url, init) => { request = { url, init }; return { ok: true, text: async () => JSON.stringify({ corrected_rows: 1, duplicate_staging_rows_created: 0 }) }; };
  const result = await applyCorrection({ url: 'https://example.supabase.co', serviceKey: 'secret', runKey: 'run-1', records, fetchImpl });
  assert.match(request.url, /apply_mariadb_two_brand_price_policy_batch/);
  assert.equal(JSON.parse(request.init.body).p_records.length, 1);
  assert.equal(result.result.corrected_rows, 1);
});

test('workflow requires exact 100-row reconciliation and zero staging growth', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/qnsa-two-brand-price-correction-canary.yml'), 'utf8');
  assert.match(workflow, /APPLY_100_PRICE_CORRECTIONS/);
  assert.match(workflow, /MARIADB_CORRECTION_LIMIT: '100'/);
  assert.match(workflow, /duplicate_staging_rows_created/);
  assert.match(workflow, /STAGING_ROWS_BEFORE/);
  assert.match(workflow, /mariadb_price_policy_correction_audit/);
});
