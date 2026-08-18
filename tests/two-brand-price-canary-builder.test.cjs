'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { sourceRecord } = require('../tools/mariadb-live/lib.cjs');
const { buildCanary, buildCorrectionPage, correctionRecord } = require('../tools/mariadb-live/build-two-brand-price-canary.cjs');

const fx = {
  observed_at: '2026-08-11T00:00:00Z',
  source: 'TEST_DATED_RATE',
  usd_per_unit: { HKD: 0.128205, CNY: 0.138, JPY: 0.0068 },
};

function row(id, title, brand, reference) {
  const raw = sourceRecord({ id, type: 'sale', title, brand, reference });
  return {
    listing_id: `00000000-0000-0000-0000-${String(id).padStart(12, '0')}`,
    source_record_id: raw.source_record_id,
    source_hash: raw.raw_sha256,
    canonical_brand: brand,
    normalized_reference: reference,
    raw_payload: raw,
  };
}

test('builds a raw-free correction record from exact immutable lineage', () => {
  const record = correctionRecord(row('1', 'Rolex 116688 $37k', 'Rolex', '116688'), fx);
  assert.equal(record.candidate.price.amount_usd, 37000);
  assert.equal(record.candidate.price.conversion_source, 'USD_DEFAULTED_BY_POLICY');
  assert.equal(Object.hasOwn(record, 'raw_payload'), false);
  assert.equal(JSON.stringify(record).includes('from_number'), false);
});

test('full page accounts for every scanned row and advances a deterministic cursor', () => {
  const rows = [
    row('11', 'Rolex 116688 $37k', 'Rolex', '116688'),
    row('12', 'Patek 5712 and Rolex 116688 bundle $100000', 'Patek Philippe', '5712'),
  ];
  rows[1].source_hash = 'f'.repeat(64);
  const result = buildCorrectionPage(rows, fx, {
    runKey: 'existing-run', correctionRunKey: 'price-policy-v1', previousCursor: null,
  });
  assert.equal(result.scanned_rows, 2);
  assert.equal(result.corrected_rows, 1);
  assert.equal(result.skipped_rows, 1);
  assert.equal(result.corrected_rows + result.skipped_rows, result.scanned_rows);
  assert.equal(result.next_cursor, rows[1].listing_id);
  assert.match(result.batch_token, /^[0-9a-f]{64}$/);
});

test('builds exactly the requested bounded canary and deduplicates source IDs', () => {
  const rows = [
    row('1', 'Rolex 116688 $37k', 'Rolex', '116688'),
    row('1', 'Rolex 116688 $37k', 'Rolex', '116688'),
    row('2', 'Patek Philippe 5712/1A 298000 HKD', 'Patek Philippe', '5712/1A'),
  ];
  const result = buildCanary(rows, fx, { runKey: 'existing-run', targetRows: 2 });
  assert.equal(result.input_rows, 2);
  assert.match(result.batch_token, /^[0-9a-f]{64}$/);
  assert.equal(new Set(result.records.map(item => item.source_record_id)).size, 2);
});

test('fails closed when exact eligible rows do not reach the target', () => {
  assert.throws(() => buildCanary([
    row('3', 'Rolex 116688 and Patek 5712 bundle $100000', 'Rolex', '116688'),
  ], fx, { runKey: 'existing-run', targetRows: 1 }), /0\/1 exact eligible rows/);
});

test('rejects raw/version lineage mismatches and non-target brands', () => {
  const mismatch = row('4', 'Rolex 116688 $37k', 'Rolex', '116688');
  mismatch.source_hash = 'f'.repeat(64);
  assert.equal(correctionRecord(mismatch, fx), null);
  assert.equal(correctionRecord(row('5', 'Omega 31030425001002 $7k', 'Omega', '31030425001002'), fx), null);
});
