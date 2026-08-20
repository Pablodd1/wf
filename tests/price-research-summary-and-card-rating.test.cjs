'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const batchApi = require('../api/price-research-batch-summary.js');
const fullPriceResearchApi = require('../api/price-research.js');
const research = fs.readFileSync(path.join(root, 'src', 'pages', 'PriceResearch.tsx'), 'utf8');
const floor = fs.readFileSync(path.join(root, 'src', 'pages', 'TradingFloor.tsx'), 'utf8');
const client = fs.readFileSync(path.join(root, 'src', 'utils', 'priceResearchBatchSummary.ts'), 'utf8');

function row(id, reference, dial, price, type = 'WTS', image = null) {
  return {
    id, brand: 'Cartier', reference, dial_color: dial, condition: 'New', listing_type: type,
    price_usd: price, price_raw: price, analytics_currency_status: price ? 'VERIFIED' : 'CURRENCY_UNVERIFIED',
    owner_reviewed_identity: true, raw_message: `${id} ${reference} ${price || ''}`, created_at: `2026-08-${String(Number(id.replace(/\D/g, '')) || 1).padStart(2, '0')}`,
    has_images: Boolean(image), thumbnail_url: image,
  };
}

test('Cartier summaries separate all-reference counts from selected-dial analytics and exact images', () => {
  const pairs = batchApi.normalizePairs([
    { brand: 'Cartier', reference: 'WSSA0032' },
    { brand: 'Cartier', reference: 'WSSA0032', dial: 'Silver' },
    { brand: 'Cartier', reference: 'WSSA0048', dial: 'Blue' },
  ]);
  const rows = [
    row('a1', 'WSSA0032', 'Silver', 22000, 'WTS', 'https://images.example/wssa0032.jpg'),
    row('a2', 'WSSA0032', 'Silver', 24000), row('a3', 'WSSA0032', 'Silver', 26000),
    row('a4', 'WSSA0032', 'Silver', null, 'WTB'), row('b1', 'WSSA0048', 'Blue', 12000), row('b2', 'WSSA0048', 'Blue', 14000),
  ];
  const [allReference, selectedDial, otherReference] = batchApi.buildBatchSummaries(pairs, rows);
  assert.equal(allReference.source_observation_count, 4);
  assert.equal(allReference.wts_observation_count, 3);
  assert.equal(allReference.wtb_observation_count, 1);
  assert.equal(allReference.reference_qualified_wts_count, 3);
  assert.equal(allReference.reference_stats.median, 24000);
  assert.equal(allReference.selected_dial_qualified_count, 0);
  assert.equal(allReference.analytics_ready, false);
  assert.equal(allReference.stats, null);
  assert.equal(allReference.reference_analytics_ready, true);
  assert.equal(allReference.representative_image_url, 'https://images.example/wssa0032.jpg');
  assert.equal(selectedDial.selected_dial_qualified_count, 3);
  assert.equal(selectedDial.analytics_ready, true);
  assert.equal(selectedDial.stats.median, 24000);
  assert.equal(otherReference.source_observation_count, 2);
  assert.equal(otherReference.stats.median, 13000);
});

test('canonical QNSA evidence prevents Hong Kong bare-dollar inflation while preserving verified recovery', () => {
  const shared = {
    brand: 'Cartier', reference: 'WSSA0032', dial_color: 'Silver', listing_type: 'WTS',
    owner_reviewed_identity: true, canonical_qnsa_price_evidence_checked: true,
  };
  const bareDollar = fullPriceResearchApi.normalizeAnalyticsPriceRow({
    ...shared,
    id: 'live-shape-bare-dollar',
    raw_message: 'Used WSSA0032 2021 / card and watch / no box $42000 4-7 days arrive HK + shipping labels',
    price_usd: null,
  }, { usingQnsaReviewedSource: true, referenceVariants: ['WSSA0032'] });
  assert.equal(bareDollar.analytics_price_usd, null);
  assert.equal(bareDollar.analytics_currency_status, 'MISSING_PRICE');
  assert.notEqual(bareDollar.price_normalization, 'USD_DEFAULTED_BY_POLICY');

  const explicitVerified = fullPriceResearchApi.normalizeAnalyticsPriceRow({
    ...shared,
    id: 'live-shape-explicit-usd',
    raw_message: 'Cartier WSSA0032 HKD 42000 // USD 5400',
    price_usd: 5400,
  }, { usingQnsaReviewedSource: true, referenceVariants: ['WSSA0032'] });
  assert.equal(explicitVerified.analytics_price_usd, 5400);
  assert.equal(explicitVerified.analytics_currency_status, 'VERIFIED');
  assert.equal(explicitVerified.price_normalization, 'CANONICAL_QNSA_VERIFIED_USD');

  const datedRuntimeRecovery = fullPriceResearchApi.normalizeAnalyticsPriceRow({
    ...shared,
    id: 'live-shape-dated-hkd',
    raw_message: 'WSSA0032 2023y Used HKD 40000',
    price_usd: 5128,
    runtime_price_recovery_applied: true,
    analytics_fx_date: '2026-08-11',
    analytics_fx_source: 'ECB',
  }, { usingQnsaReviewedSource: true, referenceVariants: ['WSSA0032'] });
  assert.equal(datedRuntimeRecovery.analytics_price_usd, 5128);
  assert.equal(datedRuntimeRecovery.analytics_currency_status, 'VERIFIED');
  assert.equal(datedRuntimeRecovery.price_normalization, 'DATED_RUNTIME_SOURCE_RECOVERY');
});

test('batch input is deduplicated and capped, preventing page fan-out', () => {
  const many = Array.from({ length: 40 }, (_, index) => ({ brand: 'Cartier', reference: `WSSA${String(index).padStart(4, '0')}` }));
  assert.equal(batchApi.normalizePairs(many).length, 24);
  assert.equal(batchApi.normalizePairs([many[0], many[0]]).length, 1);
  assert.equal(batchApi.normalizePairs([{ brand: 'Cartier', reference: 'bad ref with spaces' }]).length, 0);
});

test('per-pair loading is cap-fair and server work never exceeds two concurrent pairs', async () => {
  const pairs = batchApi.normalizePairs(Array.from({ length: 6 }, (_, index) => ({ brand: 'Cartier', reference: `WSSA00${index + 30}` })));
  let active = 0;
  let maximumActive = 0;
  const source = await batchApi.loadSourceRows({}, pairs, {
    loadPair: async pair => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise(resolve => setTimeout(resolve, 5));
      active -= 1;
      return { pair, rows: [row(pair.reference, pair.reference, 'Silver', 20000)], capped: true };
    },
  });
  assert.equal(maximumActive, 2);
  assert.equal(source.rows.length, pairs.length);
  assert.equal(source.capped.size, pairs.length);
  assert.deepEqual(new Set(source.rows.map(item => item.reference)), new Set(pairs.map(pair => pair.reference)));
});

test('one failed pair is withheld without blanking successful reference summaries', async () => {
  const pairs = batchApi.normalizePairs([
    { brand: 'Cartier', reference: 'WSSA0032' },
    { brand: 'Cartier', reference: 'WSSA0048' },
  ]);
  const source = await batchApi.loadSourceRows({}, pairs, {
    loadPair: async pair => {
      if (pair.reference === 'WSSA0048') throw new Error('temporary timeout');
      return { pair, rows: [row('ok', pair.reference, 'Silver', 5000)], capped: false };
    },
  });
  assert.equal(source.rows.length, 1);
  assert.deepEqual(source.withheld, [{ key: pairs[1].key, reason: 'SOURCE_UNAVAILABLE' }]);
});

test('nested canonical database loaders themselves never exceed two active operations', async () => {
  const pairs = batchApi.normalizePairs([
    { brand: 'Cartier', reference: 'WSSA0032' },
    { brand: 'Zenith', reference: '10.9001.9004/99.R941' },
  ]);
  let active = 0;
  let maximumActive = 0;
  let calls = 0;
  const boundedLoader = async () => {
    calls += 1;
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise(resolve => setTimeout(resolve, 3));
    active -= 1;
    return [];
  };
  await batchApi.loadSourceRows({}, pairs, {
    pairOverrides: {
      configuredSource: 'qnsa_rolex_patek_price_research_source',
      loadQnsaVerifiedTradingPrices: boundedLoader,
      loadQnsaTradingDemand: boundedLoader,
      loadRuntimePriceRecoveryRows: boundedLoader,
      loadApprovedDirectSubmissionRows: boundedLoader,
    },
  });
  assert.equal(calls, 10);
  assert.equal(maximumActive, 2);
});

test('canonical family loading retains 5712 child variants under the requested base family', async () => {
  const [pair] = batchApi.normalizePairs([{ brand: 'Patek Philippe', reference: '5712' }]);
  let receivedVariants;
  let receivedFamily;
  const result = await batchApi.loadCanonicalPairRows({}, pair, {
    configuredSource: 'qnsa_rolex_patek_price_research_source',
    loadQnsaVerifiedTradingPrices: async (_client, args) => {
      receivedVariants = args.referenceVariants;
      receivedFamily = args.familyPrefix;
      return [{ ...row('family-1', '5712/1A', 'Blue', 90000), brand: 'Patek Philippe' }];
    },
    loadQnsaTradingDemand: async () => [],
    loadRuntimePriceRecoveryRows: async () => [],
    loadApprovedDirectSubmissionRows: async () => [],
  });
  assert.ok(receivedVariants.some(reference => reference === '5712'));
  assert.equal(receivedFamily, '5712');
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].batch_pair_identity, 'patek philippe|5712');
  const [summary] = batchApi.buildBatchSummaries([pair], result.rows);
  assert.equal(summary.source_observation_count, 1);
});

test('canonical exact loader receives catalog-equivalent alias spellings', async () => {
  const [pair] = batchApi.normalizePairs([{ brand: 'Rolex', reference: '116500ln' }]);
  let receivedVariants = [];
  const result = await batchApi.loadCanonicalPairRows({}, pair, {
    configuredSource: 'qnsa_rolex_patek_price_research_source',
    loadQnsaVerifiedTradingPrices: async (_client, args) => {
      receivedVariants = args.referenceVariants;
      return [{ ...row('alias', '116500LN', 'Black', 28000), brand: 'Rolex' }];
    },
    loadQnsaTradingDemand: async () => [],
    loadRuntimePriceRecoveryRows: async () => [],
    loadApprovedDirectSubmissionRows: async () => [],
  });
  assert.ok(receivedVariants.some(reference => reference.toUpperCase() === '116500LN'));
  assert.equal(result.rows.length, 1);
});

test('workbook exact loader preserves the displayed dotted reference alongside catalog aliases', async () => {
  const [pair] = batchApi.normalizePairs([{ brand: 'Jacob & Co', reference: 'AT900.10.AC.MT.AAAAA' }]);
  let receivedVariants = [];
  await batchApi.loadCanonicalPairRows({}, pair, {
    configuredSource: null,
    loadReviewedWorkbookEvidenceRows: async (_client, args) => {
      receivedVariants = args.references;
      return [];
    },
    loadApprovedDirectSubmissionRows: async () => [],
  });
  assert.ok(receivedVariants.includes('AT900.10.AC.MT.AAAAA'));
  assert.ok(receivedVariants.includes('AT90010ACMTAAAAA'));
});

test('canonical pair loader includes approved direct WTS and WTB submissions', async () => {
  const [pair] = batchApi.normalizePairs([{ brand: 'Cartier', reference: 'WSSA0032' }]);
  const result = await batchApi.loadCanonicalPairRows({}, pair, {
    configuredSource: null,
    loadReviewedWorkbookAnalyticsRows: async () => [row('workbook', 'WSSA0032', 'Silver', 22000)],
    loadApprovedDirectSubmissionRows: async (_client, args) => args.intent === 'WTS'
      ? [row('direct-sale', 'WSSA0032', 'Silver', 23000)]
      : [row('direct-demand', 'WSSA0032', 'Silver', null, 'WTB')],
  });
  assert.deepEqual(new Set(result.rows.map(item => item.id)), new Set(['workbook', 'direct-sale', 'direct-demand']));
});

test('direct submission truncation marks only that reference cohort as capped', async () => {
  const [pair] = batchApi.normalizePairs([{ brand: 'Cartier', reference: 'WSSA0032' }]);
  const directRows = [row('direct-capped', 'WSSA0032', 'Silver', 23000)];
  directRows.sampleCapped = true;
  const result = await batchApi.loadCanonicalPairRows({}, pair, {
    configuredSource: null,
    loadReviewedWorkbookAnalyticsRows: async () => [row('workbook-cap', 'WSSA0032', 'Silver', 22000)],
    loadApprovedDirectSubmissionRows: async (_client, args) => args.intent === 'WTS' ? directRows : [],
  });
  assert.equal(result.capped, true);
});

test('Zenith uses the canonical QNSA exact loader and not the workbook shortcut', async () => {
  const [pair] = batchApi.normalizePairs([{ brand: 'Zenith', reference: '10.9001.9004/99.R941' }]);
  let qnsaCalls = 0;
  let workbookCalls = 0;
  const result = await batchApi.loadCanonicalPairRows({}, pair, {
    configuredSource: 'qnsa_rolex_patek_price_research_source',
    loadQnsaVerifiedTradingPrices: async () => {
      qnsaCalls += 1;
      return [{ ...row('zenith', '10.9001.9004/99.R941', 'Skeleton', 10063), brand: 'Zenith' }];
    },
    loadQnsaTradingDemand: async () => [],
    loadRuntimePriceRecoveryRows: async () => [],
    loadApprovedDirectSubmissionRows: async () => [],
    loadReviewedWorkbookAnalyticsRows: async () => { workbookCalls += 1; return []; },
  });
  assert.equal(qnsaCalls, 1);
  assert.equal(workbookCalls, 0);
  assert.equal(result.rows.length, 1);
});

test('Zenith and Omega WTB demand remains visible without a dial or catalog-model decoration', () => {
  const pairs = batchApi.normalizePairs([
    { brand: 'Zenith', reference: '03.2522.400' },
    { brand: 'Omega', reference: '210.30.42.20.01.001' },
  ]);
  const rows = [
    { ...row('zenith-wtb', '03.2522.400', null, null, 'WTB'), brand: 'Zenith', model: null },
    { ...row('omega-wtb', '210.30.42.20.01.001', null, null, 'WTB'), brand: 'Omega', model: null },
  ];
  const [zenith, omega] = batchApi.buildBatchSummaries(pairs, rows);
  assert.equal(zenith.wtb_observation_count, 1);
  assert.equal(omega.wtb_observation_count, 1);
});

test('Zenith reference summaries provide an exact-reference benchmark across qualified dials', () => {
  const [pair] = batchApi.normalizePairs([{ brand: 'Zenith', reference: '03.2522.400' }]);
  const [summary] = batchApi.buildBatchSummaries([pair], [
    { ...row('zenith-blue', '03.2522.400', 'Blue', 10000), brand: 'Zenith' },
    { ...row('zenith-black', '03.2522.400', 'Black', 12000), brand: 'Zenith' },
  ]);
  assert.equal(summary.reference_qualified_wts_count, 2);
  assert.equal(summary.reference_analytics_ready, true);
  assert.equal(summary.reference_stats.avg, 11000);
  assert.equal(summary.stats, null);
});

test('server and client use the same canonical selected-dial key', () => {
  const [pair] = batchApi.normalizePairs([{ brand: 'Cartier', reference: 'WSSA0032', dial: 'Silver Dial' }]);
  assert.equal(pair.key, 'cartier|WSSA0032|SILVER DIAL');
  assert.match(client, /function compactDial/);
  assert.match(client, /toUpperCase\(\)\.replace\(\/\[\^A-Z0-9\]\+\/g, ' '\)\.trim\(\)/);
  assert.match(client, /compactDial\(pair\.dial\)/);
});

test('server cache reuses within TTL, refreshes after TTL, and evicts failures for retry', async () => {
  batchApi._cache.clear();
  let calls = 0;
  const first = batchApi.getOrCreateCachedValue('cartier', async () => ++calls, 1000);
  const second = batchApi.getOrCreateCachedValue('cartier', async () => ++calls, 1001);
  assert.equal(await first.value, 1);
  assert.equal(await second.value, 1);
  assert.equal(second.cached, true);
  const expired = batchApi.getOrCreateCachedValue('cartier', async () => ++calls, 1000 + batchApi.CACHE_TTL_MS + 1);
  assert.equal(await expired.value, 2);
  const failure = batchApi.getOrCreateCachedValue('retry', async () => { throw new Error('temporary'); }, 2000);
  await assert.rejects(failure.value, /temporary/);
  await new Promise(resolve => setImmediate(resolve));
  const retry = batchApi.getOrCreateCachedValue('retry', async () => 'recovered', 2001);
  assert.equal(await retry.value, 'recovered');
  assert.equal(retry.cached, false);
});

test('pages make one batch request and client rejects cross-reference summaries', () => {
  assert.doesNotMatch(research, /summaryOnly: 'true'/);
  assert.doesNotMatch(floor, /loadExactMarketSummary/);
  assert.match(research, /loadPriceResearchBatchSummaries\(pending\.map/);
  assert.match(floor, /loadPriceResearchBatchSummaries\(visiblePricePairs\)/);
  assert.match(client, /requested\.has\(summary\.key\)/);
  assert.match(research, /bounded source observations|observed/);
  assert.match(research, /qualified WTS/);
});

test('Trading Floor uses selected-dial evidence by default and the exact reference benchmark for Zenith, Cartier, and Omega', () => {
  assert.match(floor, /Price rating: \{cardPriceRatingLabel\}/);
  assert.match(floor, /Boolean\(listing\.brand && listing\.reference && \(listing\.dial_color \|\| exactReferenceRating\)\)/);
  assert.doesNotMatch(floor, /canRatePrice[\s\S]{0,180}price_research_eligible/);
  assert.match(floor, /selected_dial_qualified_count/);
  assert.match(floor, /usesExactReferencePriceBenchmark/);
  assert.match(floor, /\['zenith', 'cartier', 'omega'\]/);
  assert.match(floor, /reference_qualified_wts_count/);
  assert.match(floor, /reference_stats/);
  assert.match(floor, /Ref avg/);
  assert.match(floor, /Not rated · \$\{availableComparableCount\}\/2 qualified/);
  assert.match(floor, /Not rated · evidence unavailable/);
  assert.match(floor, /No exact directory match/);
  assert.match(floor, /comparableCount >= 2 \? benchmarkStats : null/);
  assert.match(floor, /displayedCardPriceRating\.rating\.code === 'NOT_RATED'/);
  assert.match(floor, /<ListingDealerEvidence/);
});
