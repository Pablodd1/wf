'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(fetchMock) {
  const source = fs.readFileSync(require.resolve('../src/utils/priceResearchBatchSummary.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('exports', 'fetch', code)(exports, fetchMock);
  return exports;
}
test('card rating cache and API request isolate condition and dial cohorts', async () => {
  const requests = [];
  const lib = load(async path => {
    const url = new URL(path, 'https://synthetic.invalid'); requests.push(url);
    const p = url.searchParams;
    return { ok: true, json: async () => ({ success: true,
      selected_cohort: { brand: p.get('brand'), reference: p.get('reference'), dial_color: p.get('dial'), condition: p.get('condition') },
      count: 3, analytics_ready: true, stats: { median: 1200, avg: 1200, min: 1000, max: 1400 },
      totalListings: 4, wts_count: 3, wtb_count: 1 }) };
  });
  const a = { brand: 'Synthetic', reference: 'A', dial: 'Blue', condition: 'Mint' };
  const b = { ...a, condition: 'Unworn' };
  assert.notEqual(lib.priceResearchSummaryKey(a), lib.priceResearchSummaryKey(b));
  assert.notEqual(lib.priceResearchSummaryKey(a), lib.priceResearchSummaryKey({ ...a, condition: 'Mint+' }));
  assert.notEqual(lib.priceResearchSummaryKey({ ...a, dial: 'Blue/Green' }), lib.priceResearchSummaryKey({ ...a, dial: 'Blue Green' }));
  const summaries = await lib.loadPriceResearchBatchSummaries([a, b]);
  assert.equal(summaries.length, 2);
  assert.ok(requests.every(url => url.pathname === '/api/canary/price-research' && url.searchParams.get('pageSize') === '1'));
  assert.deepEqual(new Set(requests.map(url => url.searchParams.get('condition'))), new Set(['Mint', 'Unworn']));
  assert.ok(summaries.every(row => row.analytics_ready && row.reference_stats === null && row.source_scope === 'CANONICAL_V2_RELEASE'));
});
test('missing dial/condition never falls back to a broad cohort; wrong returned identity fails closed', async () => {
  let calls = 0;
  const lib = load(async () => { calls++; return { ok: true, json: async () => ({ success: true, selected_cohort: { brand: 'Wrong' } }) }; });
  assert.deepEqual(await lib.loadPriceResearchBatchSummaries([{ brand: 'Synthetic', reference: 'A', dial: null, condition: 'Mint' }]), []);
  assert.equal(calls, 0);
  await assert.rejects(lib.loadPriceResearchBatchSummaries([{ brand: 'Synthetic', reference: 'A', dial: 'Blue', condition: 'Mint' }]), /Mismatched exact market cohort/);
});
