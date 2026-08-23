'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { BATCH_SIZE, DEFAULT_BRANDS, groupSummary, loadBatchAdaptive, referenceKey, requireCompleteBatch } = require('../tools/audit/seven-brand-price-research-coverage-live.cjs');

test('seven-brand audit stays within the deployed batch contract', () => {
  assert.equal(BATCH_SIZE, 4);
  assert.deepEqual(DEFAULT_BRANDS, [
    'Tudor', 'Cartier', 'TAG Heuer', 'Patek Philippe', 'Rolex', 'Zenith', 'Omega',
  ]);
});

test('failed census batches subdivide until only the failing reference remains', async () => {
  const completed = [];
  const failed = [];
  let attempts = 0;
  const rows = ['A', 'B', 'C', 'D'].map(key => ({ key }));
  await loadBatchAdaptive(rows, async batch => {
    if (batch.some(row => row.key === 'C')) throw new Error('timeout');
    return { summaries: batch };
  }, {
    canAttempt: () => attempts < 20,
    onAttempt: () => { attempts += 1; },
    onSuccess: batch => completed.push(...batch.map(row => row.key)),
    onFailure: batch => failed.push(...batch.map(row => row.key)),
  });
  assert.deepEqual(completed.sort(), ['A', 'B', 'D']);
  assert.deepEqual(failed, ['C']);
  assert.ok(attempts > 1);
});

test('a missing batch summary remains a retryable failure', () => {
  const batch = [
    { key: referenceKey('Rolex', 'A'), brand: 'Rolex', reference: 'A' },
    { key: referenceKey('Rolex', 'B'), brand: 'Rolex', reference: 'B' },
  ];
  assert.throws(() => requireCompleteBatch({
    summaries: [{ brand: 'Rolex', reference: 'A' }],
  }, batch), /SUMMARY_NOT_RETURNED.*ROLEX\|B/);
});

test('reference identity ignores punctuation but preserves brand scope', () => {
  assert.equal(referenceKey('Patek Philippe', '5712/1A-001'), 'PATEK PHILIPPE|57121A001');
  assert.notEqual(referenceKey('Patek Philippe', '5712/1A-001'), referenceKey('Rolex', '5712/1A-001'));
});

test('coverage summaries separate observed, qualified, ready, missing, capped and failed references', () => {
  const summary = groupSummary([
    { brand: 'Zenith', model: 'Defy', source_observation_count: 3, wts_observation_count: 2, wtb_observation_count: 1, reference_qualified_wts_count: 2, reference_analytics_ready: true, sample_capped: true },
    { brand: 'Zenith', model: 'Defy', source_observation_count: 0, wts_observation_count: 0, wtb_observation_count: 0, reference_qualified_wts_count: 0, reference_analytics_ready: false },
    { brand: 'Zenith', model: 'Defy', error: 'SOURCE_UNAVAILABLE' },
  ], 'model')[0];
  assert.deepEqual(summary, {
    brand: 'Zenith',
    model: 'Defy',
    catalog_references: 3,
    references_with_observations: 1,
    references_with_wts: 1,
    references_with_qualified_wts: 1,
    references_analytics_ready: 1,
    references_without_observations: 1,
    bounded_source_observations: 3,
    bounded_wts_observations: 2,
    bounded_wtb_observations: 1,
    capped_references: 1,
    failed_references: 1,
  });
});

test('authoritative checkpoints reset on catalog ownership changes and never label incomplete work complete', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'tools/audit/seven-brand-price-research-coverage-live.cjs'), 'utf8');
  assert.match(source, /`\$\{row\.key\}\|\$\{row\.model \|\| ''\}`/);
  assert.match(source, /const resumePrevious = !catalogChanged && previous\.snapshot_complete !== true/);
  assert.match(source, /observed_at: new Date\(\)\.toISOString\(\)/);
  assert.match(source, /report\.snapshot_complete \? 'seven_brand_coverage_complete' : 'seven_brand_coverage_incomplete'/);
});
