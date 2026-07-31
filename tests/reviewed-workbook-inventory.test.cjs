'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20260731120000_reviewed_workbook_live_review.sql'),
  'utf8',
);
const importer = fs.readFileSync(
  path.join(root, 'tools/intake/import-reviewed-workbook-inventory.cjs'),
  'utf8',
);
const api = require('../api/reviewed-workbook-inventory.js');
const intake = require('../tools/intake/import-reviewed-workbook-inventory.cjs');

test('workbook inventory schema is service-only and separated from production records', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.reviewed_workbook_inventory/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL ON public\.reviewed_workbook_inventory[\s\S]*anon, authenticated/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE ON public\.reviewed_workbook_inventory[\s\S]*service_role/);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+public\.watch_records/i);
  assert.doesNotMatch(migration, /UPDATE\s+public\.watch_records/i);
});

test('importer is fail-closed to the allowlisted review table', () => {
  assert.equal(intake.INVENTORY_TABLE, 'reviewed_workbook_inventory');
  assert.match(importer, /REVIEWED_WORKBOOK_INVENTORY_TABLE/);
  assert.match(importer, /APPLY_REVIEWED_WORKBOOK_IMPORT === 'true'/);
  assert.match(importer, /error\.code === '40P01'/);
  assert.match(importer, /\.upsert\(unique, \{ onConflict: 'id', ignoreDuplicates: true \}\)/);
  assert.doesNotMatch(importer, /\.from\(['"]watch_records['"]\)/);
});

test('row conversion preserves raw evidence and holds non-USD Price Research admission', () => {
  const row = intake.rowForImport({
    source: {
      'Auction ID': 'example_001',
      'Posting Date': '2026-01-02T00:00:00Z',
      'Posted By': 'Example Dealer',
      raw_line: '15202BC salmon used full set 855k HKD',
      'Phone Number': '+1 555 0100',
      'Intent / Type': 'WTS',
      Brand: 'Audemars Piguet',
      Model: '15202BC',
      'Raw Reference': '15202BC',
      'Normalized Reference': '15202BC',
      'Catalog Reference': '',
      'Catalog Model': '',
      'Dial Color': 'Salmon',
      'Catalog Dial': '',
      Condition: 'Used',
      'Price ($ USD)': '109615',
      'Verification Tier': 'Tier 4 - Human Review',
      'Confidence %': '30',
      'Verification Status': 'Human Review',
      'User Image URL': 'https://example.test/exact.jpg',
      'Catalog Image URL': '',
      'Final Image URL': 'https://example.test/exact.jpg',
    },
    fileName: 'Audemars Piguet all 1.xlsx',
    fileSha256: 'a'.repeat(64),
    worksheet: 'Sheet1',
    rowNumber: 2,
    runId: 'test',
  });
  assert.equal(row.raw_message, '15202BC salmon used full set 855k HKD');
  assert.equal(row.dial_color, 'Salmon');
  assert.equal(row.source_currency, 'HKD');
  assert.equal(row.price_evidence_status, 'DATED_FX_PROVENANCE_REQUIRED');
  assert.equal(row.display_image_url, 'https://example.test/exact.jpg');
  assert.equal(row.posted_by, 'Example Dealer');
  assert.equal(row.phone_number, '+1 555 0100');
});

test('public API normalizes exact-reference filters without broad wildcards', () => {
  assert.equal(api.normalizeReference(' 5712/1a-001 '), '5712/1A001');
  assert.equal(api.cleanFilter('Rolex,*', 80), 'Rolex  ');
});

test('public API uses reconciled totals for unfiltered and brand review pages', () => {
  const summary = {
    canonical_listings: 100,
    brands: [{ brand: 'Rolex', canonical_listings: 40 }],
  };
  const common = {
    count: 999,
    summary,
    reference: '',
    sourceFile: '',
    imagesOnly: false,
  };
  assert.equal(api.resolveTotal({ ...common, brand: '' }), 100);
  assert.equal(api.resolveTotal({ ...common, brand: 'Rolex' }), 40);
  assert.equal(api.resolveTotal({ ...common, brand: '', imagesOnly: true }), 999);
});

test('public API reads deep exact pages from the nearest end of the index', () => {
  assert.deepEqual(api.resolvePageWindow({
    page: 1,
    pageSize: 48,
    total: 8_532_220,
    canReverse: true,
  }), {
    reverse: false,
    empty: false,
    start: 0,
    end: 47,
    requestedStart: 0,
  });
  assert.deepEqual(api.resolvePageWindow({
    page: 177_755,
    pageSize: 48,
    total: 8_532_220,
    canReverse: true,
  }), {
    reverse: true,
    empty: false,
    start: 0,
    end: 27,
    requestedStart: 8_532_192,
  });
});
