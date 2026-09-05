'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyRow } = require('../tools/multilisting/audit-slash-date-references.cjs');
const { selectCanary } = require('../tools/multilisting/build-slash-date-lineage-canary.cjs');

test('finds the Patek reference and price but keeps an unconfirmed catalog row in review', () => {
  const result = classifyRow({
    listing_id: 'child-1',
    source_record_id: 'parent-1',
    candidate_index: '0',
    brand: 'Patek Philippe',
    reference: '2024/5',
    raw_line: 'NEW PP5269R Blue 2024/5 HKD449k',
    price_raw: '5',
    price_currency: 'HKD',
    price_usd: '1',
  });
  assert.equal(result.decision, 'REVIEW_CATALOG_UNCONFIRMED');
  assert.equal(result.proposed_reference, '5269R');
  assert.equal(result.proposed_price_raw, 449000);
  assert.equal(result.proposed_currency, 'HKD');
  assert.equal(result.production_approved, false);
});

test('catalog-confirms a known Patek reference candidate', () => {
  const result = classifyRow({
    brand: 'Patek Philippe',
    reference: '2024/5',
    raw_line: 'Patek 5712/1A blue 2024/5 HKD 700k',
  });
  assert.equal(result.decision, 'CATALOG_CONFIRMED_CANDIDATE');
  assert.equal(result.proposed_reference, '5712/1A');
  assert.equal(result.catalog_confirmed, true);
});

test('keeps a date-only row out of automatic correction', () => {
  const result = classifyRow({
    reference: '2026/02',
    raw_line: '2026/02/24',
  });
  assert.equal(result.decision, 'NO_RECOVERABLE_REFERENCE');
  assert.equal(result.proposed_reference, null);
});

test('selects a bounded priority-brand canary without duplicate rows', () => {
  const rows = [
    ...Array.from({ length: 45 }, (_, index) => ({
      decision: 'CATALOG_CONFIRMED_CANDIDATE', brand: 'Patek Philippe',
      input_file: 'batch.csv', listing_id: `p-${index}`,
    })),
    ...Array.from({ length: 45 }, (_, index) => ({
      decision: 'CATALOG_CONFIRMED_CANDIDATE', brand: 'Rolex',
      input_file: 'batch.csv', listing_id: `r-${index}`,
    })),
    ...Array.from({ length: 20 }, (_, index) => ({
      decision: 'CATALOG_CONFIRMED_CANDIDATE', brand: 'Cartier',
      input_file: 'batch.csv', listing_id: `c-${index}`,
    })),
  ];
  const selected = selectCanary(rows, 100);
  assert.equal(selected.length, 100);
  assert.equal(new Set(selected.map(row => row.listing_id)).size, 100);
  assert.equal(selected.filter(row => row.brand === 'Patek Philippe').length, 40);
  assert.equal(selected.filter(row => row.brand === 'Rolex').length, 40);
});
