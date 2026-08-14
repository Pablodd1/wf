'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const inventory = require('../api/reviewed-market-inventory.js');
const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations',
  '20260814114000_qnsa_later_brand_stable_pagination.sql'), 'utf8');
const candidateMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations',
  '20260814114500_qnsa_later_brand_candidate_cursor.sql'), 'utf8');
const strideMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations',
  '20260814115000_qnsa_later_brand_bounded_candidate_stride.sql'), 'utf8');
const lowLatencyMigration = fs.readFileSync(path.join(root, 'supabase', 'migrations',
  '20260814123000_qnsa_rm_low_latency_stride.sql'), 'utf8');
const inventorySource = fs.readFileSync(path.join(root, 'api', 'reviewed-market-inventory.js'), 'utf8');

function traverseBoundedSource(rows, presentationFilter = () => true, pageSize = 50) {
  let offset = 0;
  const displayed = [];
  const consumed = [];
  while (offset < rows.length) {
    const sourceWindow = rows.slice(offset, offset + pageSize + 1);
    const rawRows = sourceWindow.slice(0, pageSize);
    consumed.push(...rawRows.map(row => row.id));
    displayed.push(...rawRows.filter(presentationFilter).map(row => row.id));
    offset += inventory.sourceCursorAdvance(rawRows);
    if (sourceWindow.length <= pageSize) break;
  }
  return { consumed, displayed };
}

test('cursor advances by the consumed source window rather than the rendered card count', () => {
  const rows = Array.from({ length: 94 }, (_, index) => ({
    id: `rm11-03-${String(index + 1).padStart(3, '0')}`,
    rating: index % 7 === 0 ? 5 : null,
  }));
  const result = traverseBoundedSource(rows, row => row.rating === 5);

  assert.equal(result.consumed.length, 94);
  assert.equal(new Set(result.consumed).size, 94);
  assert.deepEqual(result.displayed, rows.filter(row => row.rating === 5).map(row => row.id));
});

test('RM11-03 and WSSA0018 cursor pages contain no repeated IDs at the 50-row boundary', () => {
  for (const [prefix, count] of [['rm11-03', 94], ['wssa0018', 103]]) {
    const rows = Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index + 1}` }));
    const result = traverseBoundedSource(rows);
    assert.equal(result.displayed.length, count);
    assert.equal(new Set(result.displayed).size, count);
  }
});

test('later-brand SQL stays inside one proven bounded source window', () => {
  assert.match(migration, /qnsa_later_brand_page_rows\(\s*p_brand,\s*51,/);
  assert.match(migration, /normalized\.reference_key ~ '\^RM/);
  assert.match(migration, /normalized\.reference_key ~ '\^W/);
  assert.match(migration, /LIMIT LEAST\(GREATEST\(COALESCE\(p_limit, 51\), 1\), 51\)/);
  assert.doesNotMatch(migration, /WITH eligible_ids AS MATERIALIZED/);
  assert.doesNotMatch(migration, /CREATE\s+INDEX/i);
  assert.doesNotMatch(migration, /INSERT INTO staging\.listings|UPDATE staging\.listings|DELETE FROM staging\.listings/);
});

test('direct-submission merge preserves the non-skipping cursor behavior', () => {
  const rawRows = Array.from({ length: 50 }, (_, index) => ({ id: String(index) }));
  assert.equal(inventory.sourceCursorAdvance(rawRows), 50);
  assert.equal(inventory.sourceCursorAdvance(rawRows, 3, 47), 47);
});

test('candidate RPC exposes an exact bounded stride and raw lookahead hasMore contract', () => {
  assert.match(candidateMigration, /LIMIT v_scan_limit \+ 1 OFFSET v_offset/);
  assert.match(candidateMigration, /candidate_position <= v_scan_limit/);
  assert.match(candidateMigration, /'next_offset', v_offset \+ CASE/);
  assert.match(candidateMigration, /metrics\.selected_last_position/);
  assert.match(candidateMigration, /'has_more', CASE/);
  assert.match(candidateMigration, /metrics\.candidate_lookahead/);
  assert.match(candidateMigration, /v_scan_limit INTEGER := LEAST\(GREATEST[\s\S]*500\)/);
  assert.match(candidateMigration, /reference_normalized >= 'RM'[\s\S]*reference_normalized < 'RN'/);
  assert.match(candidateMigration, /reference_normalized >= 'W'[\s\S]*reference_normalized < 'X'/);
  assert.doesNotMatch(candidateMigration, /CREATE\s+(?:UNIQUE\s+)?INDEX/i);
});

test('broad later-brand API trusts candidate metadata instead of rendered row count', () => {
  assert.match(inventorySource, /qnsa_later_brand_candidate_stride_page/);
  assert.doesNotMatch(inventorySource, /p_scan_limit:\s*500/);
  assert.match(inventorySource, /qnsaCandidateCursorMeta\.hasMore/);
  assert.match(inventorySource, /qnsaCandidateCursorMeta\.nextOffset/);
  assert.match(inventorySource, /qnsa_later_brand_page_rows_strict/,
    'the prior publication-safe RPC remains a deploy-order fallback');
});

test('forward wrapper clamps expensive candidate evaluation to one 50-row stride', () => {
  assert.match(strideMigration,
    /qnsa_later_brand_candidate_page\([\s\S]*p_brand,[\s\S]*50,[\s\S]*p_listing_type/);
  assert.doesNotMatch(strideMigration,
    /qnsa_later_brand_candidate_page\([\s\S]*?,\s*500\s*,\s*p_listing_type/);
  assert.doesNotMatch(strideMigration,
    /CREATE\s+(?:UNIQUE\s+)?INDEX|INSERT\s+INTO\s+staging\.listings|UPDATE\s+staging\.listings|DELETE\s+FROM\s+staging\.listings/i);
});

test('Richard Mille uses a low-latency stride without weakening cursor accounting', () => {
  assert.match(lowLatencyMigration, /p_brand = 'Richard Mille' THEN 12 ELSE 50/);
  assert.match(lowLatencyMigration, /GREATEST\(COALESCE\(p_scan_limit, 500\), 1\)/);
  assert.match(lowLatencyMigration, /Expected candidate scan-limit clamp was not found/);
  assert.doesNotMatch(lowLatencyMigration,
    /INSERT\s+INTO\s+staging\.listings|UPDATE\s+staging\.listings|DELETE\s+FROM\s+staging\.listings/i);
});

test('an empty bounded stride advances by its envelope instead of entering the legacy magic-offset fallback', () => {
  assert.match(inventorySource,
    /laterReviewedBrand\s*&&\s*pageRows\.length === 0\s*&&\s*!candidateEnvelope/);
});

test('candidate RPC retries the prior strict RPC on deploy gaps and transient failures', () => {
  for (const status of [400, 404, 408, 500, 502, 503, 504, 599]) {
    assert.equal(inventory.shouldFallbackLaterBrandCandidate(status), true, `status ${status}`);
  }

  for (const status of [200, 401, 403, 409, 422, 429]) {
    assert.equal(inventory.shouldFallbackLaterBrandCandidate(status), false, `status ${status}`);
  }

  assert.match(inventorySource,
    /laterReviewedBrand\s*&&\s*shouldFallbackLaterBrandCandidate\(pageRowsRes\.status\)/);
  assert.match(inventorySource, /rpc\/qnsa_later_brand_page_rows_strict/);
});

test('exact-reference presentation sorting never pulls the lookahead into the visible page', () => {
  const rows = [
    { id: 'priced-a', price: 10 },
    { id: 'unpriced-boundary', price: 0 },
    { id: 'priced-lookahead', price: 20 },
  ];
  const sorted = inventory.sortPageWithoutMovingLookahead(
    rows,
    2,
    (left, right) => right.price - left.price,
  );
  assert.deepEqual(sorted.map(row => row.id), [
    'priced-a',
    'unpriced-boundary',
    'priced-lookahead',
  ]);
  assert.equal(sorted[2], rows[2], 'the source lookahead stays outside the visible page');
});
