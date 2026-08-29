'use strict';

const { getClient } = require('./_lib/supabase');
const { listEquivalentReferences, lookupCatalog } = require('./_lib/catalog');
const { comparisonKey, normalizeDialValue } = require('./_lib/dial-normalization.cjs');
const { classifyDemandEligibility, classifyResearchEligibility } = require('./_lib/price-research-eligibility.cjs');
const { deduplicateReposts } = require('./_lib/repost-deduplication.cjs');
const { marketPlausibilityFloor, summarizePrices } = require('./_lib/market-stats.cjs');
const { loadReviewedWorkbookEvidenceRows } = require('./_lib/reviewed-workbook-analytics.cjs');
const { isReviewedWorkbookBrowseBrand } = require('./_lib/reviewed-workbook-browse.cjs');
const { isPublicationBrandAllowed } = require('./_lib/publication-brands.cjs');
const { isPublicationReferenceAllowed } = require('./_lib/publication-references.cjs');
const canonicalPriceResearch = require('./price-research.js');
const { normRef } = require('./_lib/resolve');

const MAX_PAIRS = 24;
const PER_PAIR_LIMIT = 1000;
const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 100;
const cache = new Map();
const SAFE_REFERENCE = /^[A-Za-z0-9._/-]{1,64}$/;
const SAFE_DIAL = /^[^,()]{1,80}$/;

function clean(value) {
  return String(value || '').trim();
}

function referenceKey(value) {
  return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizePairs(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const pairs = [];
  for (const raw of input.slice(0, MAX_PAIRS)) {
    const brand = clean(raw?.brand);
    const reference = clean(raw?.reference);
    const dial = clean(raw?.dial) || null;
    if (!brand || !isPublicationBrandAllowed(brand) || canonicalPriceResearch.isPendingQnsaBrandRelease(brand)
      || !SAFE_REFERENCE.test(reference) || (dial && !SAFE_DIAL.test(dial))) continue;
    const key = `${brand.toLowerCase()}|${referenceKey(reference)}|${comparisonKey(dial || '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ brand, reference, dial, key });
  }
  return pairs;
}

function exactPairKey(brand, reference) {
  return `${clean(brand).toLowerCase()}|${referenceKey(reference)}`;
}

function summarizeDialRows(rows) {
  const prices = rows.map(row => Number(row.price_usd)).filter(price => Number.isFinite(price) && price > 0);
  const floor = marketPlausibilityFloor(prices);
  return summarizePrices(prices.filter(price => price >= floor));
}

function exactRepresentativeImage(row) {
  if (row?.has_images !== true || row?.multi_listing === true || row?.is_unbundled_child === true) return null;
  const evidence = clean(row?.image_evidence_type).toUpperCase();
  if (evidence && !['SOURCE_LISTING_IMAGE', 'SOURCE_LINKED_IMAGE'].includes(evidence)) return null;
  const url = clean(row?.thumbnail_url);
  return /^https?:\/\/[^\s]+$/i.test(url) ? url : null;
}

function buildBatchSummaries(pairs, rows, sampleCapped = false) {
  const byReference = new Map();
  for (const row of rows) {
    const key = row.batch_pair_identity || exactPairKey(row.brand, row.reference);
    const members = byReference.get(key) || [];
    members.push(row);
    byReference.set(key, members);
  }

  return pairs.map(pair => {
    const members = byReference.get(exactPairKey(pair.brand, pair.reference)) || [];
    const wtsMembers = members.filter(row => clean(row.listing_type).toUpperCase() === 'WTS');
    const wtbMembers = members.filter(row => ['WTB', 'NTQ'].includes(clean(row.listing_type).toUpperCase()));
    const catalog = lookupCatalog(pair.reference, pair.brand);
    const eligible = wtsMembers
      .map(row => ({ ...row, bundle_candidate_count: 1 }))
      .filter(row => !classifyResearchEligibility(row, catalog));
    const { uniqueRows } = deduplicateReposts(eligible);
    const { uniqueRows: uniqueDemandRows } = deduplicateReposts(wtbMembers
      .map(row => ({ ...row, bundle_candidate_count: Number(row.bundle_candidate_count || 1) }))
      .filter(row => !classifyDemandEligibility(row, catalog)));
    const dialGroups = new Map();
    for (const row of uniqueRows) {
      const normalized = normalizeDialValue(row.dial_color);
      if (!normalized.known) continue;
      const key = comparisonKey(normalized.value);
      const values = dialGroups.get(key) || [];
      values.push({ ...row, dial_color: normalized.value });
      dialGroups.set(key, values);
    }
    // A reference-level benchmark is deliberately separate from the
    // dial-specific cohort below. Zenith cards use this exact-reference
    // benchmark when a listing has no usable dial, or its dial cohort is too
    // small to rate on its own. It never includes WTB or ineligible offers.
    const referenceSummary = summarizeDialRows(uniqueRows);

    const selectedDialKey = pair.dial ? comparisonKey(normalizeDialValue(pair.dial).value) : '';
    const selectedDialRows = selectedDialKey ? dialGroups.get(selectedDialKey) || [] : [];
    const selectedSummary = selectedDialKey ? summarizeDialRows(selectedDialRows) : null;
    const representativeImage = members.map(exactRepresentativeImage).find(Boolean) || null;
    return {
      key: pair.key,
      brand: pair.brand,
      reference: pair.reference,
      source_observation_count: wtsMembers.length + uniqueDemandRows.length,
      wts_observation_count: wtsMembers.length,
      wtb_observation_count: uniqueDemandRows.length,
      reference_qualified_wts_count: referenceSummary.included_count,
      reference_analytics_ready: referenceSummary.analytics_ready,
      reference_stats: referenceSummary.analytics_ready ? referenceSummary.stats : null,
      selected_dial: pair.dial,
      selected_dial_qualified_count: selectedSummary?.included_count || 0,
      analytics_ready: Boolean(pair.dial && selectedSummary?.analytics_ready),
      stats: pair.dial && selectedSummary?.analytics_ready ? selectedSummary.stats : null,
      representative_image_url: representativeImage,
      source_scope: members.some(row => row.batch_source_scope === 'CANONICAL_QNSA_RELEASE')
        ? 'CANONICAL_QNSA_RELEASE'
        : 'BOUNDED_ANALYTICS_SOURCE',
      sample_capped: sampleCapped instanceof Set
        ? sampleCapped.has(exactPairKey(pair.brand, pair.reference))
        : sampleCapped,
      count_semantics: {
        source_observation_count: 'Rows returned by the canonical bounded source for this exact brand and reference; this is not an uncapped inventory total.',
        wts_observation_count: 'Published WTS rows returned for this exact brand and reference, including rows withheld from price analytics.',
        wtb_observation_count: 'Deduplicated published WTB demand rows returned for this exact brand and reference.',
        reference_qualified_wts_count: 'Outlier-clean, deduplicated WTS rows passing identity, price, currency and dial gates across all dials.',
        reference_stats: 'Outlier-clean exact-reference WTS statistics across all qualified dials. Zenith card ratings use this only when its selected dial cohort is unavailable.',
        selected_dial_qualified_count: 'Outlier-clean qualified WTS rows for the explicitly requested dial only.',
      },
    };
  });
}

function pairFilter(rows, pairs) {
  const allowed = new Set(pairs.map(pair => exactPairKey(pair.brand, pair.reference)));
  return rows.filter(row => allowed.has(exactPairKey(row.brand, row.reference)));
}

function normalizeCanonicalRow(row) {
  const price = Number(row?.price_usd);
  return {
    ...row,
    owner_reviewed_identity: true,
    analytics_currency_status: Number.isFinite(price) && price > 0 ? 'VERIFIED' : 'CURRENCY_UNVERIFIED',
  };
}

function mergeRows(...groups) {
  const rows = new Map();
  for (const row of groups.flat()) {
    if (row?.id != null) rows.set(String(row.id), normalizeCanonicalRow(row));
  }
  return [...rows.values()];
}

async function mapWithConcurrency(values, concurrency, task) {
  const results = new Array(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function loadCanonicalPairRows(client, pair, overrides = {}) {
  const loaders = {
    loadReviewedWorkbookEvidenceRows,
    loadApprovedDirectSubmissionRows: canonicalPriceResearch.loadApprovedDirectSubmissionRows,
    loadQnsaVerifiedTradingPrices: canonicalPriceResearch.loadQnsaVerifiedTradingPrices,
    loadQnsaTradingDemand: canonicalPriceResearch.loadQnsaTradingDemand,
    loadRuntimePriceRecoveryRows: canonicalPriceResearch.loadRuntimePriceRecoveryRows,
    ...overrides,
  };
  loaders.loadReviewedWorkbookEvidenceRows = overrides.loadReviewedWorkbookEvidenceRows
    || overrides.loadReviewedWorkbookAnalyticsRows
    || loadReviewedWorkbookEvidenceRows;
  const referenceVariants = [...new Set([
    pair.reference,
    ...listEquivalentReferences(pair.reference, pair.brand),
  ])];
  const familyPrefix = (overrides.reviewedFamilyPrefix || canonicalPriceResearch.reviewedFamilyPrefix)(pair.brand, pair.reference);
  const configuredSource = Object.hasOwn(overrides, 'configuredSource')
    ? overrides.configuredSource
    : canonicalPriceResearch.configuredReviewedPriceSource(pair.brand);
  const catalog = lookupCatalog(pair.reference, pair.brand);
  const exactKnownReference = Boolean(catalog?.found && catalog.matchType !== 'partial' && catalog.reference);
  const publicationAllowed = isPublicationReferenceAllowed(pair.brand, pair.reference);
  if (!configuredSource && !isReviewedWorkbookBrowseBrand(pair.brand) && !exactKnownReference && !publicationAllowed) {
    return { pair, rows: [], capped: false, withheld: 'REFERENCE_NOT_RELEASED' };
  }

  let wts = [];
  let wtb = [];
  let recovery = [];
  if (configuredSource) {
    wts = await loaders.loadQnsaVerifiedTradingPrices(client, {
      brand: pair.brand, referenceVariants, familyPrefix, limit: PER_PAIR_LIMIT,
    });
    wtb = await loaders.loadQnsaTradingDemand(client, {
      brand: pair.brand, referenceVariants, familyPrefix, limit: PER_PAIR_LIMIT,
    });
    recovery = await loaders.loadRuntimePriceRecoveryRows(client, { brand: pair.brand, referenceVariants });
  } else {
    const workbookEvidence = await loaders.loadReviewedWorkbookEvidenceRows(client, {
      brand: pair.brand, references: referenceVariants, limit: PER_PAIR_LIMIT,
    });
    wts = workbookEvidence.filter(row => clean(row.listing_type).toUpperCase() === 'WTS');
    wtb = workbookEvidence.filter(row => ['WTB', 'NTQ'].includes(clean(row.listing_type).toUpperCase()));
    if (!workbookEvidence.length && !exactKnownReference && !publicationAllowed) {
      return { pair, rows: [], capped: false, withheld: 'REFERENCE_NOT_RELEASED' };
    }
  }
  const directWts = await loaders.loadApprovedDirectSubmissionRows(client, {
    brand: pair.brand, referenceVariants, intent: 'WTS', limit: PER_PAIR_LIMIT,
  });
  const directWtb = await loaders.loadApprovedDirectSubmissionRows(client, {
    brand: pair.brand, referenceVariants, intent: 'WTB', limit: PER_PAIR_LIMIT,
  });
  const mergedRows = mergeRows(wts, wtb, recovery, directWts, directWtb);
  const exactIdentity = exactPairKey(pair.brand, pair.reference);
  const rows = (familyPrefix
    ? mergedRows.filter(row => clean(row.brand).toLowerCase() === pair.brand.toLowerCase()
      && normRef(row.reference).startsWith(normRef(familyPrefix)))
    : pairFilter(mergedRows, [pair]))
    .map(row => ({
      ...row,
      batch_pair_identity: exactIdentity,
      batch_source_scope: configuredSource ? 'CANONICAL_QNSA_RELEASE' : 'BOUNDED_ANALYTICS_SOURCE',
    }));
  return {
    pair,
    rows,
    capped: [wts, wtb, directWts, directWtb].some(group => group.sampleCapped === true || group.length >= PER_PAIR_LIMIT
      || group.some(row => row.exact_evidence_recovery_capped === true)),
    referenceVariants,
    familyPrefix,
  };
}

function getOrCreateCachedValue(key, factory, now = Date.now()) {
  const cached = cache.get(key);
  if (cached && now - cached.createdAt < CACHE_TTL_MS) return { value: cached.value, cached: true };
  if (cached) cache.delete(key);
  const value = Promise.resolve().then(factory);
  cache.set(key, { createdAt: now, value });
  if (cache.size > CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
  void value.catch(() => {
    if (cache.get(key)?.value === value) cache.delete(key);
  });
  return { value, cached: false };
}

async function loadSourceRows(client, pairs, options = {}) {
  const identityPairs = [...new Map(pairs.map(pair => [exactPairKey(pair.brand, pair.reference), pair])).values()];
  const loadPair = options.loadPair || ((pair) => loadCanonicalPairRows(client, pair, options.pairOverrides));
  const results = await mapWithConcurrency(identityPairs, 2, async pair => {
    try {
      return await loadPair(pair);
    } catch (error) {
      console.warn('[price-research-batch-summary] pair unavailable:', pair.brand, pair.reference, error?.message || error);
      return { pair, rows: [], capped: false, withheld: 'SOURCE_UNAVAILABLE' };
    }
  });
  return {
    rows: results.flatMap(result => result.rows),
    capped: new Set(results.filter(result => result.capped).map(result => exactPairKey(result.pair.brand, result.pair.reference))),
    withheld: results.filter(result => result.withheld).map(result => ({ key: result.pair.key, reason: result.withheld })),
  };
}

function canonicalSummaryFromPayload(pair, payload) {
  const reconciliation = payload?.reconciliation || {};
  return {
    key: pair.key,
    brand: pair.brand,
    reference: pair.reference,
    source_observation_count: Number(payload?.total_tracked_listings || 0),
    wts_observation_count: Number(reconciliation.wts_loaded_count ?? payload?.market_listings_count ?? 0),
    wtb_observation_count: Number(payload?.wtb_demand_count || 0),
    reference_qualified_wts_count: Number(payload?.reference_qualified_wts_count || 0),
    reference_analytics_ready: payload?.reference_analytics_ready === true,
    reference_stats: payload?.reference_stats || null,
    selected_dial: pair.dial,
    selected_dial_qualified_count: pair.dial ? Number(payload?.count || 0) : 0,
    analytics_ready: Boolean(pair.dial && payload?.analytics_ready === true),
    stats: pair.dial && payload?.analytics_ready === true ? payload.stats : null,
    representative_image_url: null,
    source_scope: payload?.analytics_source || 'CANONICAL_PRICE_RESEARCH_ENDPOINT',
    sample_capped: payload?.sampleCapped === true || payload?.demand_evidence?.sample_capped === true,
    count_semantics: {
      source_observation_count: 'Exact-reference tracked listings reported by the canonical customer Price Research endpoint.',
      wts_observation_count: 'Exact-reference WTS rows loaded by the canonical customer Price Research endpoint.',
      wtb_observation_count: 'Deduplicated exact-reference WTB demand reported by the canonical customer Price Research endpoint.',
      reference_qualified_wts_count: 'Canonical exact-reference WTS rows passing identity, price, currency, bundle and repost gates.',
      reference_stats: 'Canonical exact-reference market statistics across all qualified dials.',
      selected_dial_qualified_count: 'Canonical qualified WTS rows for the explicitly requested dial only.',
    },
  };
}

async function invokeCanonicalPriceResearch(pair, handler = canonicalPriceResearch) {
  let statusCode = 200;
  let body;
  const req = {
    method: 'GET',
    query: {
      brand: pair.brand,
      reference: pair.reference,
      ...(pair.dial ? { dial: pair.dial } : {}),
      evidence_page: '1',
      evidence_page_size: '1',
      demand_page: '1',
      demand_page_size: '1',
    },
    headers: {},
  };
  const res = {
    setHeader() {},
    status(value) { statusCode = value; return this; },
    json(value) { body = value; return this; },
    end() { return this; },
  };
  await handler(req, res);
  if (statusCode < 200 || statusCode >= 300 || !body?.success) {
    const error = new Error(body?.error || `Canonical Price Research returned HTTP ${statusCode}`);
    error.statusCode = statusCode;
    throw error;
  }
  return body;
}

async function loadCanonicalSummaries(pairs, options = {}) {
  const handler = options.handler || canonicalPriceResearch;
  return mapWithConcurrency(pairs, 2, async pair => {
    const payload = await invokeCanonicalPriceResearch(pair, handler);
    return canonicalSummaryFromPayload(pair, payload);
  });
}

async function loadCanonicalSummaryResults(pairs, options = {}) {
  const handler = options.handler || canonicalPriceResearch;
  const results = await mapWithConcurrency(pairs, 2, async pair => {
    try {
      const payload = await invokeCanonicalPriceResearch(pair, handler);
      return { summary: canonicalSummaryFromPayload(pair, payload), withheld: null };
    } catch (error) {
      console.warn('[price-research-batch-summary] canonical pair withheld:', pair.brand, pair.reference, error.message);
      return {
        summary: null,
        withheld: { key: pair.key, brand: pair.brand, reference: pair.reference, reason: 'CANONICAL_PAIR_UNAVAILABLE' },
      };
    }
  });
  return {
    summaries: results.map(result => result.summary).filter(Boolean),
    withheld: results.map(result => result.withheld).filter(Boolean),
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=30');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const pairs = normalizePairs(req.body?.pairs);
  if (!pairs.length) return res.status(400).json({ error: 'One valid brand/reference pair is required' });

  const cacheKey = pairs.map(pair => pair.key).sort().join('\u001e');
  const cachedResult = getOrCreateCachedValue(cacheKey, async () => {
    const canonical = await loadCanonicalSummaryResults(pairs);
    const summaries = canonical.summaries;
    return {
      success: true,
      summaries,
      requested_pair_count: pairs.length,
      source_row_count: summaries.reduce((sum, summary) => sum + summary.source_observation_count, 0),
      source_sample_capped: summaries.some(summary => summary.sample_capped),
      capped_pair_count: summaries.filter(summary => summary.sample_capped).length,
      withheld: canonical.withheld,
      cache_ttl_seconds: CACHE_TTL_MS / 1000,
    };
  });
  try {
    return res.status(200).json({ ...(await cachedResult.value), cached: cachedResult.cached });
  } catch (error) {
    cache.delete(cacheKey);
    console.error('[price-research-batch-summary] error:', error.message || error);
    return res.status(503).json({ error: 'Batch market summaries are temporarily unavailable' });
  }
};

module.exports.buildBatchSummaries = buildBatchSummaries;
module.exports.exactRepresentativeImage = exactRepresentativeImage;
module.exports.loadSourceRows = loadSourceRows;
module.exports.canonicalSummaryFromPayload = canonicalSummaryFromPayload;
module.exports.invokeCanonicalPriceResearch = invokeCanonicalPriceResearch;
module.exports.loadCanonicalSummaries = loadCanonicalSummaries;
module.exports.loadCanonicalSummaryResults = loadCanonicalSummaryResults;
module.exports.loadCanonicalPairRows = loadCanonicalPairRows;
module.exports.mapWithConcurrency = mapWithConcurrency;
module.exports.normalizePairs = normalizePairs;
module.exports.getOrCreateCachedValue = getOrCreateCachedValue;
module.exports._cache = cache;
module.exports.CACHE_TTL_MS = CACHE_TTL_MS;
module.exports.MAX_PAIRS = MAX_PAIRS;
