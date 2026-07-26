/**
 * PRICE RESEARCH API — /api/price-research
 * Returns per-reference market analytics from the production DB.
 * Query: GET /api/price-research?reference=52506&brand=Rolex
 *        GET /api/price-research?reference=52506           (brand auto-resolved)
 */
const { getClient } = require('./_lib/supabase');
const { normRef, inferBrand: sharedInferBrand } = require('./_lib/resolve');
const { listEquivalentReferences, lookupCatalog } = require('./_lib/catalog');
const {
  buildComparableCohorts,
  buildDialGroups,
  classifyPrice,
  marketPlausibilityFloor,
  summarizePrices,
} = require('./_lib/market-stats.cjs');
const { normalizeMarketRow } = require('./_lib/market-row-normalization.cjs');
const { normalizeDialValue } = require('./_lib/dial-normalization.cjs');
const { classifyDemandEligibility, classifyResearchEligibility } = require('./_lib/price-research-eligibility.cjs');
const { partitionExcludedEvidence } = require('./_lib/exclusion-summary.cjs');
const { deduplicateReposts } = require('./_lib/repost-deduplication.cjs');
const { bundleCandidateCount, loadShadowBundleParentIds } = require('./_lib/unsplit-bundle-filter.cjs');
const { buildMarketForecast } = require('./_lib/market-forecast.cjs');
const { authClient, resolveSession, userRole } = require('./_lib/dealer-auth.cjs');

// Look up a human model name for a reference from the PROVEN file catalog
// (catalog.json + enriched_refs.json via _lib/catalog.js) — same path used live
// by /api/catalog-lookup. The Supabase cached_price_guide_watches table is empty
// for most brands, so we do NOT use it. Decoration only — never affects existence.
function lookupModel(reference, brand) {
  try {
    const hit = lookupCatalog(reference, brand || null);
    return hit && hit.found ? (hit.model || null) : null;
  } catch { return null; }
}

// Pull real liquidity indicators for a reference. Wrapped in try/catch because
// market_reference_indicators_current has never been queried by live code — if
// column names differ, we fall back to a live-derived count. REAL DATA ONLY:
// no invented seller/buyer numbers.
function normalizeConditionFilter(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'new') return 'New';
  if (normalized === 'used') return 'Used';
  if (normalized === 'all' || normalized === 'all conditions' || !normalized) return 'All';
  return 'Unspecified';
}

function matchesSelection(row, selection) {
  const dial = String(row.dial_color || '').trim().toLowerCase();
  if (!dial || (selection.dial && dial !== String(selection.dial).toLowerCase())) return false;
  return selection.condition === 'All' || normalizeConditionFilter(row.condition) === selection.condition;
}

async function lookupLiquidity(client, reference, listingCount, demand, selection) {
  // Reference-level indicators are not valid evidence for a dial/condition
  // selection. Use scoped live counts instead of displaying stale aggregates.
  if (selection?.dial || selection?.condition !== 'All') {
    return { source: 'live_fallback', listing_count: listingCount, ...demand };
  }
  try {
    const { data, error } = await client
      .from('market_reference_indicators_current')
      .select('liquidity_score, sale_count, search_count, demand_score, supply_score, wtb_fs_ratio')
      .eq('normalized_reference', normRef(reference))
      .eq('region', 'global')
      .limit(1);
    if (!error && data && data.length) {
      const d = data[0];
      return {
        source: 'indicators',
        liquidity_score: d.liquidity_score,
        sale_count: d.sale_count,
        search_count: d.search_count,
        demand_score: d.demand_score,
        supply_score: d.supply_score,
        wtb_fs_ratio: d.wtb_fs_ratio,
        listing_count: listingCount,
        ...demand,
      };
    }
  } catch { /* fall through to live count */ }
  return { source: 'live_fallback', listing_count: listingCount, ...demand };
}

async function lookupDemand(client, sourceTable, brand, referenceVariants, catalog, selection) {
  const { data, error } = await client
    .from(sourceTable)
    .select('id,brand,reference,dial_color,condition,listing_type,verdict,raw_message,flags')
    .eq('brand', brand)
    .in('reference', referenceVariants)
    .in('listing_type', ['WTB', 'NTQ'])
    .in('verdict', ['APPROVED', 'HUMAN'])
    .or('listing_status.is.null,listing_status.not.in.(HIDDEN,REJECTED,DELETED)')
    .limit(5000);
  if (error) return { demand_count: 0, demand_cohorts: [], demand_sample_capped: false };

  const shadowBundleIds = await loadShadowBundleParentIds(client, data || []);
  const eligible = (data || [])
    .map(row => ({ ...row, bundle_candidate_count: bundleCandidateCount(row, shadowBundleIds) }))
    .filter(row => !classifyDemandEligibility(row, catalog));
  const grouped = new Map();
  for (const row of eligible.filter(row => matchesSelection({
    ...row,
    dial_color: normalizeDialValue(row.dial_color).known ? normalizeDialValue(row.dial_color).value : '',
  }, selection))) {
    const normalizedDial = normalizeDialValue(row.dial_color);
    const dial = normalizedDial.known ? normalizedDial.value : '';
    const key = dial.toLowerCase();
    if (!key) continue;
    const current = grouped.get(key) || { dial_color: dial, count: 0 };
    current.count += 1;
    grouped.set(key, current);
  }
  const demandCohorts = [...grouped.values()]
    .filter(cohort => cohort.count >= 5)
    .sort((a, b) => b.count - a.count);
  return {
    demand_count: demandCohorts.reduce((sum, cohort) => sum + cohort.count, 0),
    demand_cohorts: demandCohorts,
    demand_sample_capped: (data || []).length >= 5000,
  };
}

function inferBrand(ref) {
  return sharedInferBrand(ref);
}

function summarizeComparableRows(rows) {
  const validPrices = rows
    .map(row => Number(row.price_usd))
    .filter(value => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  const marketPriceFloorUsd = marketPlausibilityFloor(validPrices);
  const summary = summarizePrices(validPrices.filter(value => value >= marketPriceFloorUsd));
  return { marketPriceFloorUsd, summary };
}

async function loadAnalyticsSuppressedIds(client) {
  try {
    const { data, error } = await client
      .from('duplicate_review_candidates')
      .select('duplicate_id')
      .eq('status', 'SUPPRESSED')
      .limit(20_000);
    if (error) return new Set();
    return new Set((data || []).map(row => String(row.duplicate_id || '')).filter(Boolean));
  } catch {
    // Keep analytics available before the duplicate-review migration is deployed.
    return new Set();
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let canReviewExcludedEvidence = false;
  try {
    const sessionClient = authClient();
    const sessionUser = sessionClient ? await resolveSession(sessionClient, req, res) : null;
    canReviewExcludedEvidence = ['admin', 'reviewer'].includes(userRole(sessionUser));
  } catch {
    // Public research remains available when optional session resolution fails.
  }

  const rawRef = (req.query.reference || '').trim();
  let brand = (req.query.brand || '').trim();
  const evidencePage = Math.max(1, Number.parseInt(String(req.query.evidencePage || '1'), 10) || 1);
  const evidencePageSize = Math.min(100, Math.max(25, Number.parseInt(String(req.query.evidencePageSize || '100'), 10) || 100));

  if (!rawRef) return res.status(400).json({ error: 'reference required' });

  // Auto-resolve brand if not provided
  if (!brand) {
    brand = inferBrand(rawRef);
    if (!brand) {
      return res.status(400).json({
        error: 'Brand could not be identified for this reference. Select a brand and reference from Browse by Model.',
        hint: 'Brand auto-resolution failed. Provide the brand explicitly.'
      });
    }
  }

  try {
    const client = getClient();
    const sourceTable = process.env.STRICT_VERIFIED_PUBLICATION === 'true'
      ? 'price_research_verified_source'
      : 'watch_records';

    // Resolve reference — support prefix matching (3712 -> 3712/1A)
    let targetRef = rawRef;
    let referenceVariants = [rawRef];
    if (rawRef.length >= 3) {
      // Resolve exact references case-insensitively first. Historical imports
      // contain casing variants (for example 116500LN and 116500ln); keep all
      // equivalent stored spellings so the market query aggregates them.
      const equivalentReferences = listEquivalentReferences(rawRef, brand);
      referenceVariants = equivalentReferences;
      const exactRefResults = await Promise.all(equivalentReferences.map(reference => client
        .from(sourceTable)
        .select('reference')
        .eq('brand', brand)
        .eq('verdict', 'APPROVED')
        .ilike('reference', reference)
        .limit(50)));
      const exactRefError = exactRefResults.every(result => result.error)
        ? exactRefResults.find(result => result.error)?.error || null
        : null;
      const exactRefs = exactRefResults
        .filter(result => !result.error)
        .flatMap(result => result.data || []);

      let refs = exactRefs;
      let refError = exactRefError;
      if (!exactRefError && (!exactRefs || exactRefs.length === 0)) {
        const prefixResult = await client
          .from(sourceTable)
          .select('reference')
          .eq('brand', brand)
          .eq('verdict', 'APPROVED')
          .ilike('reference', `${rawRef}%`)
          .limit(50);
        refs = prefixResult.data;
        refError = prefixResult.error;
      }

      if (!refError && refs && refs.length > 0) {
        const foundRefs = [...new Set(refs.map(r => r.reference))];
        const equivalentKeys = new Set(equivalentReferences.map(normRef));
        const exactVariants = foundRefs.filter(r => equivalentKeys.has(normRef(r)));
        const exact = exactVariants[0];
        if (exact) {
          const catalogHit = lookupCatalog(rawRef, brand || null);
          targetRef = catalogHit?.found && catalogHit.reference ? catalogHit.reference : exact;
          referenceVariants = [...new Set([...equivalentReferences, ...exactVariants])];
        }
        else if (foundRefs.length === 1) {
          targetRef = foundRefs[0];
          referenceVariants = [foundRefs[0]];
        }
        else {
          return res.status(200).json({
            success: false,
            error: 'Multiple references match. Select an exact reference.',
            requires_resolution: true,
            candidates: foundRefs.slice(0, 50),
          });
        }
      }
    }

    // PostgREST caps each response at 1,000 rows. Page explicitly so a busy
    // reference does not produce a chart made only from its newest day.
    const pageSize = 1000;
    const sampleLimit = 5000;
    const columns = 'id,brand,reference,price_raw,price_usd,currency,raw_message,flags,created_at,listing_date,condition,source,dial_color,year,listing_type,dealer_id';
    const buildRowsQuery = (from, to) => client
      .from(sourceTable)
      .select(columns)
      .eq('brand', brand)
      .in('reference', referenceVariants)
      .eq('verdict', 'APPROVED')
      .eq('listing_type', 'WTS')
      .or('listing_status.is.null,listing_status.not.in.(HIDDEN,REJECTED,DELETED)')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to);

    // Avoid a filtered COUNT over the multi-million-row table. Fetch bounded,
    // deterministic pages in parallel and report whether the sample hit its cap.
    const sampledPages = await Promise.all(
      Array.from({ length: sampleLimit / pageSize }, (_, index) => {
        const from = index * pageSize;
        return buildRowsQuery(from, from + pageSize - 1);
      })
    );
    const pageError = sampledPages.find(page => page.error)?.error;
    if (pageError) throw pageError;
    let rows = sampledPages.flatMap(page => page.data || []);
    const baseSampleCount = rows.length;

    if (!rows || rows.length === 0) {
      return res.status(200).json({
        success: true, brand, reference: rawRef,
        resolvedRef: targetRef !== rawRef ? targetRef : null,
        model: null, dialColors: null,
        dial_analysis: [],
        totalListings: 0, sampledListings: 0, sampleCapped: false, count: 0,
        analytics_ready: false, listing_count: 0,
        sample_quality: 'observational',
        selected_cohort: { condition: 'Unspecified', dial_color: 'Unspecified', count: 0 },
        cohorts: [], outliers: [], outlier_rows: [], outliersRemoved: 0, excludedEvidenceCount: 0, rawCount: 0,
        methodology: { method: 'IQR_1_5', minimum_sample: 5, included_count: 0, excluded_count: 0 },
        stats: null, liquidity: null, monthly: [], prices: [], rows: [],
        forecast: { ready: false, reasons: ['NO_ELIGIBLE_OBSERVATIONS'] }
      });
    }

    // Exclude synthetic/test sources. mysql_auction_watches is historical market
    // evidence and must not be discarded from analytics.
    const excludedSources = new Set(['bulk_test_100', 'test_run', 'mysql_market_refs']);
    let catalogHit = lookupCatalog(targetRef, brand || null);
    // Historical Patek listings commonly omit the catalog's terminal variant
    // suffix (for example 5712/1A vs 5712/1A-001). An image-only enrichment
    // record must not block the modeled canonical family used for validation.
    if ((!catalogHit?.found || !catalogHit.model)
      && /^\d{4}\/1A$/i.test(targetRef)
      && String(brand || '').toUpperCase() === 'PATEK PHILIPPE') {
      const canonicalVariant = lookupCatalog(`${targetRef}-001`, brand);
      if (canonicalVariant?.found && canonicalVariant.model) catalogHit = canonicalVariant;
    }
    if (catalogHit?.found && catalogHit.dialColors != null && !Array.isArray(catalogHit.dialColors)) {
      catalogHit = { ...catalogHit, dialColors: [catalogHit.dialColors] };
    }

    // A newest-first cap can hide a valid dial when one high-volume variant
    // occupies all 5,000 sampled rows. Supplement only missing catalog dials
    // with a bounded query, then de-duplicate by immutable source ID.
    const observedDialCounts = rows.reduce((counts, row) => {
      const dial = normalizeDialValue(row.dial_color);
      if (dial.known) counts.set(dial.value.toLowerCase(), (counts.get(dial.value.toLowerCase()) || 0) + 1);
      return counts;
    }, new Map());
    const supplementalCatalogDials = (catalogHit?.dialColors || [])
      .map(value => normalizeDialValue(value))
      .filter(dial => dial.known && (
        !observedDialCounts.has(dial.value.toLowerCase())
        || (baseSampleCount >= sampleLimit && observedDialCounts.get(dial.value.toLowerCase()) < 1000)
      ))
      .map(dial => dial.value);
    if (supplementalCatalogDials.length) {
      const supplementalPages = await Promise.all(supplementalCatalogDials.map(dial => client
        .from(sourceTable)
        .select(columns)
        .eq('brand', brand)
        .in('reference', referenceVariants)
        .eq('verdict', 'APPROVED')
        .eq('listing_type', 'WTS')
        .or('listing_status.is.null,listing_status.not.in.(HIDDEN,REJECTED,DELETED)')
        .ilike('dial_color', dial)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(1000)));
      const supplementalError = supplementalPages.find(page => page.error)?.error;
      if (supplementalError) throw supplementalError;
      const rowsById = new Map(rows.map(row => [row.id, row]));
      for (const row of supplementalPages.flatMap(page => page.data || [])) rowsById.set(row.id, row);
      rows = [...rowsById.values()];
    }
    const shadowBundleIds = await loadShadowBundleParentIds(client, rows);

    const normalizedRows = rows
      .filter(r => !excludedSources.has(r.source))
      .map(row => {
        const normalized = normalizeMarketRow(row, referenceVariants);
        const normalizedDial = normalizeDialValue(normalized.dial_color);
        return {
          ...normalized,
          bundle_candidate_count: bundleCandidateCount(row, shadowBundleIds),
          dial_color: normalizedDial.known ? normalizedDial.value : normalized.dial_color,
          stored_price_usd: row.price_usd,
          price_usd: normalized.analytics_price_usd,
        };
      });
    const analyticsSuppressedIds = await loadAnalyticsSuppressedIds(client);
    const duplicateSuppressedRows = normalizedRows.filter(row => analyticsSuppressedIds.has(String(row.id)));
    const analyticsRows = normalizedRows.filter(row => !analyticsSuppressedIds.has(String(row.id)));
    const bundleParentExcludedCount = analyticsRows.filter(row => row.bundle_candidate_count > 1).length;
    const totalListings = analyticsRows.length - bundleParentExcludedCount;
    const requiredFieldExclusions = analyticsRows
      .map(row => ({ row, reason: classifyResearchEligibility(row, catalogHit) }))
      .filter(item => item.reason)
      .map(({ row, reason }) => ({ ...row, is_outlier: true, outlier_reason: reason }));
    const eligibleMarketRows = analyticsRows.filter(row => !classifyResearchEligibility(row, catalogHit));
    // Reposts remain immutable evidence, but the same dealer repeatedly offering
    // the same configuration at the same price is one market observation.
    const { uniqueRows: marketRows, repostRows } = deduplicateReposts(eligibleMarketRows);
    const isUnknownDial = value => {
      const normalized = String(value || '').trim().toUpperCase();
      return !normalized || ['UNKNOWN', 'UNSPECIFIED', 'N/A', 'NA', 'NONE', 'NULL', '-'].includes(normalized);
    };
    const unknownDialCount = analyticsRows.filter(row => isUnknownDial(row.dial_color)).length;

    const cohorts = buildComparableCohorts(marketRows);
    const dialGroups = buildDialGroups(marketRows);
    const requestedCondition = String(req.query.condition || '').trim().toLowerCase();
    const requestedDial = String(req.query.dial || '').trim().toLowerCase();
    const selectedDialGroup = dialGroups.find(group =>
      !requestedDial || group.dial_color.toLowerCase() === requestedDial
    ) || dialGroups[0] || { dial_color: 'Unspecified', rows: [], count: 0, condition_counts: {} };
    const selectedCondition = normalizeConditionFilter(requestedCondition);
    const selection = { dial: selectedDialGroup.dial_color, condition: selectedCondition };
    const selectedRows = selectedDialGroup.rows.filter(row => matchesSelection(row, selection));
    const selectedCohort = {
      condition: selectedCondition === 'All' ? 'All conditions' : selectedCondition,
      dial_color: selectedDialGroup.dial_color,
      rows: selectedRows,
      count: selectedRows.length,
    };
    const listedRows = selectedCohort.rows;
    const currencyCorrections = listedRows.filter(row => row.price_normalization).length;

    // A deterministic safety floor runs before IQR. Otherwise a malformed low-
    // price cluster can make the IQR lower fence negative and contaminate every
    // market statistic. Catalog-relative bands are the next refinement.
    const selectedSummary = summarizeComparableRows(listedRows);
    const marketPriceFloorUsd = selectedSummary.marketPriceFloorUsd;
    const validPriceRows = listedRows.filter(r => Number.isFinite(Number(r.price_usd)) && Number(r.price_usd) > 0);
    const summary = selectedSummary.summary;
    const prices = summary.included;
    const classifiedRows = listedRows.map(row => {
      const classification = classifyPrice(row.price_usd, summary.stats, { minimumPrice: marketPriceFloorUsd });
      return { ...row, is_outlier: !classification.included, outlier_reason: classification.reason };
    });
    const includedRows = classifiedRows.filter(row => !row.is_outlier && row.price_usd > 0);
    const {
      statisticalOutlierRows,
      allExcludedRows: outlierRows,
    } = partitionExcludedEvidence(
      requiredFieldExclusions.filter(row => matchesSelection(row, selection)),
      repostRows.filter(row => matchesSelection(row, selection)),
      classifiedRows
    );

    // Monthly aggregation
    const monthlyMap = {};
    includedRows.forEach(r => {
      const observedAt = r.listing_date;
      if (!observedAt) return;
      const d = new Date(observedAt);
      if (isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyMap[key]) monthlyMap[key] = { month: key, count: 0, sum: 0, min: Infinity, max: 0 };
      monthlyMap[key].count++;
      monthlyMap[key].sum += r.price_usd;
      monthlyMap[key].min = Math.min(monthlyMap[key].min, r.price_usd);
      monthlyMap[key].max = Math.max(monthlyMap[key].max, r.price_usd);
    });

    const monthly = Object.values(monthlyMap)
      .map(m => ({ month: m.month, count: m.count, avg_price: Math.round(m.sum / m.count), min_price: m.min, max_price: m.max }))
      .sort((a, b) => a.month.localeCompare(b.month));

    // Forecasts are more restrictive than descriptive analytics. A condition
    // must be selected so New, Used, and unstated inventory never share a
    // trend line. The helper also enforces sample, identity, recency, and
    // rolling-backtest gates before returning any future values.
    const forecastsDisabled = process.env.ENABLE_PRICE_FORECASTS !== 'true';
    const forecastCandidate = forecastsDisabled
      ? {
          ready: false,
          reasons: ['FEATURE_NOT_RELEASED'],
          offer_count: includedRows.length,
          verified_dealer_count: new Set(includedRows.map(row => row.dealer_id).filter(Boolean)).size,
        }
      : selectedCondition !== 'All'
        ? buildMarketForecast(includedRows)
        : {
            ready: false,
            reasons: ['CONDITION_REQUIRED'],
            offer_count: includedRows.length,
            verified_dealer_count: new Set(includedRows.map(row => row.dealer_id).filter(Boolean)).size,
          };
    const forecast = forecastCandidate;

    // ── Dial analysis: EVERY dial color found in real listings (rule: all must show) ──
    const dialMap = {};
    const dialAnalysisRows = selectedCondition === 'All'
      ? marketRows
      : marketRows.filter(row => normalizeConditionFilter(row.condition) === selectedCondition);
    dialAnalysisRows.forEach(r => {
      const dial = r.dial_color || 'Unspecified';
      const key = String(dial).trim().toLowerCase();
      if (!dialMap[key]) dialMap[key] = { dial_color: String(dial).trim(), rows: [] };
      dialMap[key].rows.push(r);
    });
    const dial_analysis = Object.values(dialMap)
      .map(d => {
        const dialSummary = summarizeComparableRows(d.rows).summary;
        if (!dialSummary.analytics_ready || !dialSummary.stats) return null;
        return {
          dial_color: d.dial_color,
          count: dialSummary.included.length,
          avg_price: dialSummary.stats.avg,
          min_price: dialSummary.stats.min,
          max_price: dialSummary.stats.max,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.count - a.count);
    const dialColors = dial_analysis.map(d => d.dial_color);

    // ── Real model name (catalog decoration) + real liquidity (indicators, no phantom numbers) ──
    const model = catalogHit?.found ? (catalogHit.model || null) : lookupModel(targetRef, brand);
    const demand = await lookupDemand(client, sourceTable, brand, referenceVariants, catalogHit, selection);
    const liquidity = await lookupLiquidity(client, targetRef, listedRows.length, demand, selection);

    const outlierEvidenceLimit = 100;
    const serializedOutliers = outlierRows.slice(0, outlierEvidenceLimit);
    const comparableOffset = (evidencePage - 1) * evidencePageSize;
    const serializedComparables = includedRows.slice(comparableOffset, comparableOffset + evidencePageSize);

    res.status(200).json({
      success: true, brand, reference: rawRef,
      resolvedRef: targetRef !== rawRef ? targetRef : null,
      model, dialColors,
      dial_analysis,
      dial_data_quality: {
        known_count: analyticsRows.length - unknownDialCount,
        unknown_count: unknownDialCount,
        completeness_percent: analyticsRows.length
          ? Math.round(((analyticsRows.length - unknownDialCount) / analyticsRows.length) * 1000) / 10
          : 0,
        status: unknownDialCount === 0 ? 'complete' : 'incomplete',
      },
      duplicate_data_quality: {
        suppressed_from_analytics: duplicateSuppressedRows.length,
        status: duplicateSuppressedRows.length ? 'reviewed_duplicates_excluded' : 'no_reviewed_duplicates_excluded',
      },
      currency_data_quality: {
        corrected_count: currencyCorrections,
        status: currencyCorrections ? 'corrected_for_analytics' : 'as_stored',
      },
      bundle_data_quality: {
        unsplit_parent_excluded_count: bundleParentExcludedCount,
        status: bundleParentExcludedCount ? 'excluded_from_analytics' : 'clean',
      },
      totalListings: listedRows.length,
      reference_listing_count: totalListings,
      listing_count: listedRows.length,
      eligible_observation_count: listedRows.length,
      unique_offer_count: listedRows.length,
      repost_count: repostRows.filter(row => matchesSelection(row, selection)).length,
      sampledListings: rows.length,
      sampleCapped: baseSampleCount >= sampleLimit,
      count: prices.length,
      rawCount: validPriceRows.length,
      outliersRemoved: statisticalOutlierRows.length,
      excludedEvidenceCount: outlierRows.length,
      outliers: canReviewExcludedEvidence ? statisticalOutlierRows.map(row => row.price_usd) : [],
      outlier_rows: canReviewExcludedEvidence ? serializedOutliers.map(r => ({
        id: r.id,
        price_usd: r.price_usd, created_at: r.created_at, listing_date: r.listing_date,
        dial_color: r.dial_color, condition: r.condition,
        source: r.source, year: r.year, is_outlier: true, outlier_reason: r.outlier_reason,
        stored_price_usd: r.stored_price_usd, price_normalization: r.price_normalization,
      })) : [],
      analytics_ready: summary.analytics_ready,
      sample_quality: summary.sample_quality,
      stats: summary.analytics_ready ? summary.stats : null,
      selected_cohort: {
        condition: selectedCohort.condition,
        dial_color: selectedCohort.dial_color,
        count: selectedCohort.count,
      },
      cohorts: cohorts.map(cohort => {
        const cohortSummary = summarizeComparableRows(cohort.rows).summary;
        return {
          condition: cohort.condition,
          dial_color: cohort.dial_color,
          count: cohort.count,
          avg_price: cohortSummary.analytics_ready ? (cohortSummary.stats?.avg ?? null) : null,
          min_price: cohortSummary.analytics_ready ? (cohortSummary.stats?.min ?? null) : null,
          max_price: cohortSummary.analytics_ready ? (cohortSummary.stats?.max ?? null) : null,
        };
      }),
      dial_groups: dialGroups.map(group => {
        const groupSummary = summarizeComparableRows(group.rows).summary;
        return {
          dial_color: group.dial_color,
          count: group.count,
          condition_counts: group.condition_counts,
          avg_price: groupSummary.analytics_ready ? (groupSummary.stats?.avg ?? null) : null,
          min_price: groupSummary.analytics_ready ? (groupSummary.stats?.min ?? null) : null,
          max_price: groupSummary.analytics_ready ? (groupSummary.stats?.max ?? null) : null,
        };
      }),
      methodology: {
        method: 'PLAUSIBILITY_FLOOR_THEN_IQR_1_5',
        minimum_sample: 5,
        included_count: includedRows.length,
        excluded_count: outlierRows.length,
        statistical_outlier_count: statisticalOutlierRows.length,
        required_field_excluded_count: requiredFieldExclusions.length,
        repost_excluded_count: repostRows.length,
        duplicate_suppressed_count: duplicateSuppressedRows.length,
        unsplit_bundle_excluded_count: bundleParentExcludedCount,
        plausibility_floor_usd: marketPriceFloorUsd,
        plausibility_excluded_count: outlierRows.filter(row => row.outlier_reason === 'BELOW_MARKET_PLAUSIBILITY_FLOOR').length,
        lower_fence: summary.stats?.lower_fence ?? null,
        upper_fence: summary.stats?.upper_fence ?? null,
      },
      evidence: {
        comparable_returned: serializedComparables.length,
        comparable_total: includedRows.length,
        comparable_page: evidencePage,
        comparable_page_size: evidencePageSize,
        comparable_pages: Math.max(1, Math.ceil(includedRows.length / evidencePageSize)),
        outliers_returned: serializedOutliers.length,
        outliers_total: outlierRows.length,
        truncated: includedRows.length > evidencePageSize || outlierRows.length > outlierEvidenceLimit,
      },
      liquidity,
      monthly, prices, forecast,
      rows: serializedComparables.map(r => ({
        id: r.id,
        price_usd: r.price_usd, created_at: r.created_at, listing_date: r.listing_date,
        dial_color: r.dial_color, condition: r.condition,
        source: r.source, year: r.year,
        stored_price_usd: r.stored_price_usd, price_normalization: r.price_normalization,
        is_outlier: r.is_outlier, outlier_reason: r.outlier_reason,
      })),
    });
  } catch (err) {
    console.error('[price-research] error:', err.message, err.stack?.split('\n').slice(0, 3).join(' '));
    res.status(500).json({ error: 'Failed to fetch from database', detail: err.message });
  }
};
