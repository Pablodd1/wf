'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canonicalSummaryFromPayload,
  loadCanonicalSummaries,
  loadCanonicalSummaryResults,
} = require('../api/price-research-batch-summary.js');

test('batch summary preserves canonical Price Research count semantics', () => {
  const pair = { key: 'rolex|116500LN|', brand: 'Rolex', reference: '116500LN', dial: null };
  const summary = canonicalSummaryFromPayload(pair, {
    total_tracked_listings: 12,
    wtb_demand_count: 2,
    reference_qualified_wts_count: 4,
    reference_analytics_ready: true,
    reference_stats: { avg: 25000, min: 24000, max: 26000 },
    reconciliation: { wts_loaded_count: 10 },
    analytics_source: 'canonical-test',
  });
  assert.equal(summary.source_observation_count, 12);
  assert.equal(summary.wts_observation_count, 10);
  assert.equal(summary.wtb_observation_count, 2);
  assert.equal(summary.reference_qualified_wts_count, 4);
  assert.equal(summary.reference_stats.avg, 25000);
});

test('one canonical pair failure does not blank successful card summaries', async () => {
  const handler = async (req, res) => {
    if (req.query.reference === 'B') return res.status(503).json({ success: false, error: 'temporary' });
    return res.status(200).json({
      success: true,
      total_tracked_listings: 2,
      reference_qualified_wts_count: 1,
      reconciliation: { wts_loaded_count: 2 },
    });
  };
  const result = await loadCanonicalSummaryResults([
    { key: 'rolex|A|', brand: 'Rolex', reference: 'A', dial: null },
    { key: 'rolex|B|', brand: 'Rolex', reference: 'B', dial: null },
  ], { handler });
  assert.deepEqual(result.summaries.map(row => row.reference), ['A']);
  assert.deepEqual(result.withheld.map(row => row.reference), ['B']);
});

test('WTB sample caps propagate to the exact-reference batch summary', () => {
  const pair = { key: 'omega|A|', brand: 'Omega', reference: 'A', dial: null };
  const summary = canonicalSummaryFromPayload(pair, {
    total_tracked_listings: 1,
    demand_evidence: { sample_capped: true },
    reconciliation: { wts_loaded_count: 0 },
  });
  assert.equal(summary.sample_capped, true);
});

test('batch loader obtains each summary from the canonical endpoint response', async () => {
  const handler = async (req, res) => res.status(200).json({
    success: true,
    total_tracked_listings: req.query.reference === 'A' ? 3 : 7,
    wtb_demand_count: 0,
    reference_qualified_wts_count: req.query.reference === 'A' ? 1 : 2,
    reference_analytics_ready: false,
    reference_stats: null,
    reconciliation: { wts_loaded_count: req.query.reference === 'A' ? 3 : 7 },
  });
  const pairs = [
    { key: 'x|A|', brand: 'Rolex', reference: 'A', dial: null },
    { key: 'x|B|', brand: 'Rolex', reference: 'B', dial: null },
  ];
  const summaries = await loadCanonicalSummaries(pairs, { handler });
  assert.deepEqual(summaries.map(row => row.source_observation_count), [3, 7]);
  assert.deepEqual(summaries.map(row => row.reference_qualified_wts_count), [1, 2]);
});
