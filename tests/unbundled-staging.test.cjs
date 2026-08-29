'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { childPriceEvidenceScope, stagingRow } = require('../tools/multilisting/prepare-unbundled-staging.cjs');
const { partitionWritableRows } = require('../tools/multilisting/stage-unbundled-manifest.cjs');
const { serializeJsonLine } = require('../tools/multilisting/json-line.cjs');

test('creates a stable pending staging UUID while preserving the child audit key', () => {
  const source = {
    listing_id: 'source-parent_000', source_record_id: 'source-parent', child_index: 0,
    raw_line: '116500LN White 283K HKD', brand: 'Rolex', reference: '116500LN',
    dial_color: 'White', condition: 'New', price_raw: 283000, price_usd: 36282,
    price_currency: 'HKD', listing_type: 'WTS', parser_version: 'manual-unbundle-full-v4',
    review_bucket: 'review-ready', exact_raw_lineage: true, catalog_confirmed: true,
    catalog_dial_confirmed: true, blockers: [], review_reasons: [],
    currency_evidence: 'explicit_line_currency',
  };
  const lineage = { source_created_at: '2026-07-01T00:00:00Z' };
  const first = stagingRow(source, lineage, 'f94506b0-17a9-4656-9b51-9e81ed052ab8');
  const second = stagingRow(source, lineage, 'f94506b0-17a9-4656-9b51-9e81ed052ab8');
  assert.equal(first.id, second.id);
  assert.match(first.id, /^[0-9a-f-]{36}$/i);
  assert.equal(first.field_confidence.source_child_id, source.listing_id);
  assert.equal(first.parent_source_id, source.source_record_id);
  assert.equal(first.source_child_id, source.listing_id);
  assert.equal(first.source_child_index, 0);
  assert.equal(first.raw_child_line, source.raw_line);
  assert.equal(first.price_evidence_scope, 'EXPLICIT_CHILD_LINE');
  assert.equal(first.verdict, 'PENDING');
  assert.equal(first.confidence, 0);
  assert.equal(first.has_images, false);
});

test('does not inherit a collapsed parent price when child price evidence is absent', () => {
  const row = stagingRow({
    listing_id: 'source-parent_002', source_record_id: 'source-parent', child_index: 2,
    raw_line: '5712/1A blue', brand: 'Patek Philippe', reference: '5712/1A',
    listing_type: 'WTS', parser_version: 'manual-unbundle-full-v4', review_bucket: 'review-ready',
    exact_raw_lineage: true, catalog_confirmed: true, blockers: [], review_reasons: [],
  }, {}, 'f94506b0-17a9-4656-9b51-9e81ed052ab8');
  assert.equal(row.price_raw, undefined);
  assert.equal(row.price_usd, undefined);
  assert.equal(row.currency, undefined);
  assert.equal(row.price_evidence_scope, 'NO_PRICE_EVIDENCE');
});

test('price evidence classification fails closed', () => {
  assert.equal(childPriceEvidenceScope({ price_raw: 100, currency_evidence: 'section_currency' }), 'INHERITED_SECTION_CONTEXT');
  assert.equal(childPriceEvidenceScope({ price_raw: 100, currency_evidence: 'source_record_currency' }), 'REVIEW_REQUIRED');
  assert.equal(childPriceEvidenceScope({}), 'NO_PRICE_EVIDENCE');
});

test('marks absent dealer attribution instead of inventing contact data', () => {
  const row = stagingRow({
    listing_id: 'source-parent_001', source_record_id: 'source-parent', child_index: 1,
    raw_line: 'WTB 5712/1A Blue', brand: 'Patek Philippe', reference: '5712/1A',
    listing_type: 'WTB', parser_version: 'manual-unbundle-full-v4', review_bucket: 'review-ready',
    exact_raw_lineage: true, catalog_confirmed: true, blockers: [], review_reasons: [],
  }, {}, 'f94506b0-17a9-4656-9b51-9e81ed052ab8');
  assert.ok(row.flags.includes('DEALER_ATTRIBUTION_MISSING'));
  assert.equal(row.field_confidence.seller_phone, null);
  assert.equal(row.field_confidence.dealer_id, null);
});

test('preserves the actual unbundled source batch label', () => {
  const row = stagingRow({
    listing_id: 'source-005_000', source_record_id: 'source-005', child_index: 0,
    raw_line: '5712/1A blue 2024 full set HKD 700k', brand: 'Patek Philippe',
    reference: '5712/1A', listing_type: 'WTS', parser_version: 'manual-unbundle-full-v4',
    review_bucket: 'review-ready', exact_raw_lineage: true, catalog_confirmed: true,
    blockers: [], review_reasons: [],
  }, {}, 'f94506b0-17a9-4656-9b51-9e81ed052ab8', 'MANUAL_UNBUNDLE_BATCH_005');

  assert.equal(row.source, 'MANUAL_UNBUNDLE_BATCH_005');
});

test('unbundled approval migration keeps correction rows blocked and caps approval at 100', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260720190000_unbundled_staging_review.sql'), 'utf8');
  assert.match(sql, /v_review_bucket\s*<>\s*'review-ready'/);
  assert.match(sql, /confidence,\s*verdict[\s\S]*100,\s*'APPROVED'/);
  assert.match(sql, /CASE WHEN p_decision = 'APPROVED' THEN 100 ELSE 0 END/);
  assert.match(sql, /exact_raw_lineage/);
  assert.match(sql, /catalog_confirmed/);
  assert.match(sql, /p_duplicate_reviewed IS NOT TRUE/);
  assert.match(sql, /duplicate_reviewed/);
  assert.doesNotMatch(sql, /confidence\s*=\s*1000/);
});

test('staging refresh never overwrites completed human decisions', () => {
  const rows = [{ id: 'pending' }, { id: 'approved' }, { id: 'rejected' }, { id: 'new' }];
  const decisions = new Map([
    ['pending', 'PENDING'],
    ['approved', 'APPROVED'],
    ['rejected', 'REJECTED'],
  ]);
  const result = partitionWritableRows(rows, decisions);
  assert.deepEqual(result.writable.map(row => row.id), ['pending', 'new']);
  assert.deepEqual(result.protectedRows, [
    { id: 'approved', verdict: 'APPROVED' },
    { id: 'rejected', verdict: 'REJECTED' },
  ]);
});

test('JSONL serialization preserves Unicode separators without splitting records', () => {
  const source = { raw_line: '126283 green jub\u2028hkd 220000\u2029126503 black' };
  const serialized = serializeJsonLine(source);
  assert.equal(serialized.split('\n').length, 1);
  assert.equal(JSON.parse(serialized).raw_line, source.raw_line);
  assert.match(serialized, /\\u2028/);
  assert.match(serialized, /\\u2029/);
});
