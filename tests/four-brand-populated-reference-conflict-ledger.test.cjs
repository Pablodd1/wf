'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildConflictLedger,
  conflictForRecord,
  fetchBrand,
  sha256,
} = require('../tools/audit/build-four-brand-populated-reference-conflict-ledger.cjs');

const catalog = [
  { brand: 'Tudor', reference: '28400', model: 'Royal' },
  { brand: 'Tudor', reference: '79360N', model: 'Black Bay Chrono' },
  { brand: 'Omega', reference: '3510.50.00', model: 'Speedmaster' },
  { brand: 'Omega', reference: '310.30.42.50.01.001', model: 'Speedmaster' },
  { brand: 'Cartier', reference: 'WSSA0009', model: 'Santos' },
  { brand: 'Cartier', reference: 'WSSA0037', model: 'Santos' },
  { brand: 'Zenith', reference: '03.2522.400', model: 'El Primero' },
  { brand: 'Zenith', reference: '97.9100.9004/02', model: 'Defy' },
  { brand: 'Zenith', reference: '97.9100.9004/02.I001', model: 'Defy' },
];

function row(overrides = {}) {
  const raw = overrides.raw_message || '16078 - Omega Speedmaster 3510.50.00 used USD 3,800';
  return {
    id: '11111111-1111-4111-8111-111111111111',
    source_record_id: 'source-16078',
    raw_message_version_id: 'version-16078',
    source_hash: sha256(raw),
    brand: 'Omega',
    reference: '16078',
    raw_message: raw,
    ...overrides,
  };
}

test('source/list identifier stored as reference becomes a deterministic unapplied candidate', () => {
  const conflict = conflictForRecord(row(), catalog);
  assert.equal(conflict.reason, 'CURRENT_REFERENCE_IS_SOURCE_OR_LIST_IDENTIFIER');
  assert.equal(conflict.current_value, '16078');
  assert.equal(conflict.candidate_value, '3510.50.00');
  assert.equal(conflict.deterministic_candidate, true);
  assert.equal(conflict.decision, 'DETERMINISTIC_CORRECTION_CANDIDATE_NOT_APPLIED');
  assert.equal(conflict.source_hash_matches_raw, true);
  assert.equal(conflict.writes, 0);
});

test('year range stored as reference is detected when an explicit catalog reference is present', () => {
  const raw = 'WTB Tudor 79360N 2025/2026 exact';
  const conflict = conflictForRecord(row({
    id: 'tudor-year', brand: 'Tudor', reference: '2025/2026', raw_message: raw, source_hash: sha256(raw),
  }), catalog);
  assert.equal(conflict.reason, 'CURRENT_REFERENCE_IS_YEAR_TOKEN');
  assert.equal(conflict.candidate_value, '79360N');
  assert.equal(conflict.bundle_risk, false);
});

test('dimension token stored as reference is detected without interpreting it as a watch reference', () => {
  const raw = 'Cartier Santos reference WSSA0009 41mm blue dial';
  const conflict = conflictForRecord(row({
    id: 'cartier-size', brand: 'Cartier', reference: '41MM', raw_message: raw, source_hash: sha256(raw),
  }), catalog);
  assert.equal(conflict.reason, 'CURRENT_REFERENCE_IS_DIMENSION_TOKEN');
  assert.equal(conflict.candidate_value, 'WSSA0009');
});

test('two catalog references require human review and never propose a correction', () => {
  const raw = 'Cartier WSSA0009 or WSSA0037 available as a package';
  const conflict = conflictForRecord(row({
    id: 'cartier-bundle', brand: 'Cartier', reference: 'WSSA0009', raw_message: raw,
  }), catalog);
  assert.equal(conflict.reason, 'MULTIPLE_CATALOG_REFERENCE_IDENTITY_CONFLICT');
  assert.equal(conflict.candidate_value, null);
  assert.equal(conflict.deterministic_candidate, false);
  assert.equal(conflict.decision, 'HUMAN_REVIEW_REQUIRED');
});

test('catalog absence alone never makes an alternative raw reference deterministic', () => {
  const raw = 'NTQ Cartier WSTA0135 or WSSA0009 pre-owned';
  const conflict = conflictForRecord(row({
    id: 'cartier-incomplete-catalog', brand: 'Cartier', reference: 'WSTA0135', raw_message: raw,
  }), catalog);
  assert.equal(conflict.reason, 'CURRENT_REFERENCE_NOT_IN_BRAND_CATALOG_WITH_EXPLICIT_RAW_REFERENCE');
  assert.equal(conflict.candidate_value, null);
  assert.equal(conflict.deterministic_candidate, false);
  assert.equal(conflict.candidate_references[0], 'WSSA0009');
});

test('valid populated reference with no conflicting exact catalog token is omitted', () => {
  const result = conflictForRecord(row({
    id: 'zenith-valid', brand: 'Zenith', reference: '03.2522.400',
    raw_message: 'Zenith El Primero 03.2522.400 used USD 8,000',
  }), catalog);
  assert.equal(result, null);
});

test('a shorter catalog prefix inside the current full reference is not a conflict', () => {
  const result = conflictForRecord(row({
    id: 'zenith-prefix', brand: 'Zenith', reference: '97.9100.9004/02.I001',
    raw_message: 'Zenith Defy 97.9100.9004/02.I001 titanium used USD 8,000',
  }), catalog);
  assert.equal(result, null);
});

test('ledger is four-brand-only, reconciles IDs, hashes evidence, and rejects duplicates', () => {
  const omega = row();
  const ignored = row({ id: 'rolex', brand: 'Rolex', reference: '2025', raw_message: 'Rolex 116500LN' });
  const ledger = buildConflictLedger([omega, ignored], catalog);
  assert.deepEqual(ledger.scope, ['Tudor', 'Omega', 'Cartier', 'Zenith']);
  assert.equal(ledger.input_unique_listings, 1);
  assert.equal(ledger.conflict_count, 1);
  assert.equal(ledger.writes, 0);
  assert.equal(ledger.conflicts[0].raw_message_sha256, sha256(omega.raw_message));
  assert.throws(() => buildConflictLedger([omega, omega], catalog), /Duplicate listing ID/);
});

test('cursor crawl is bounded, deduplicated, and follows nextCursor', async () => {
  const pages = [
    { records: [row()], hasMore: true, nextCursor: 'next' },
    { records: [row(), row({ id: 'omega-2', reference: '3510.50.00' })], hasMore: false },
  ];
  const seen = [];
  const records = await fetchBrand('https://example.test', 'Omega', async url => {
    seen.push(String(url));
    return { ok: true, json: async () => pages.shift() };
  });
  assert.equal(records.length, 2);
  assert.match(seen[0], /pagination=cursor/);
  assert.match(seen[1], /cursor=next/);
});
