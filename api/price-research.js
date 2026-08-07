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
const { loadAnalyticsSuppressedIds } = require('./_lib/duplicate-suppression.cjs');
const { partitionExcludedEvidence } = require('./_lib/exclusion-summary.cjs');
const { deduplicateReposts } = require('./_lib/repost-deduplication.cjs');
const { bundleCandidateCount, loadShadowBundleParentIds } = require('./_lib/unsplit-bundle-filter.cjs');
const { buildMarketForecast } = require('./_lib/market-forecast.cjs');
const { loadReviewedWorkbookAnalyticsRows } = require('./_lib/reviewed-workbook-analytics.cjs');
// ponytail: authorizeDealer no longer gates this public endpoint (see handler
// below). Import removed — dealer-auth.cjs is still used by other endpoints.
const { isPublicationBrandAllowed } = require('./_lib/publication-brands.cjs');
const {
  MIN_RELEASE_CONFIDENCE,
  REVIEWED_PANERAI_RECORD_IDS,
  REVIEWED_PANERAI_REFERENCES,
  REVIEWED_PANERAI_SOURCE,
  REVIEWED_ZENITH_SOURCE,
  isPublicationReferenceAllowed,
  isReleaseListingEligible,
  isReviewedPaneraiReleaseRecord,
  isReviewedZenithIdentityCorrectionRecord,
} = require('./_lib/publication-references.cjs');

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
function matchesSelection(row, selection) {
  const dial = String(row.dial_color || '').trim().toLowerCase();
  return Boolean(dial) && (!selection.dial || dial === String(selection.dial).toLowerCase());
}

async function lookupLiquidity(client, reference, listingCount, demand, selection) {
  // Reference-level indicators are not valid evidence for a dial
  // selection. Use scoped live counts instead of displaying stale aggregates.
  if (selection?.dial) {
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

async function retainVerifiedIdentityRows(client, rows) {
  const ids = [...new Set((rows || []).map(row => String(row.id || '')).filter(Boolean))];
  if (!ids.length) return [];
  const batches = [];
  for (let index = 0; index < ids.length; index += 200) {
    batches.push(ids.slice(index, index + 200));
  }
  const results = await Promise.all(batches.map(batch => client
    .from('listing_identity_reviews')
    .select('record_id,canonical_brand,canonical_model,canonical_reference,canonical_dial_color,status')
    .in('record_id', batch)
    .in('status', ['CATALOG_CONFIRMED', 'HUMAN_APPROVED'])));
  const error = results.find(result => result.error)?.error;
  if (error) throw error;
  const reviews = new Map(results
    .flatMap(result => result.data || [])
    .map(review => [String(review.record_id), review]));
  return (rows || []).flatMap(row => {
    const review = reviews.get(String(row.id));
    if (!review) return [];
    return [{
      ...row,
      brand: review.canonical_brand || row.brand,
      model: review.canonical_model || row.model,
      reference: review.canonical_reference || row.reference,
      dial_color: review.canonical_dial_color || row.dial_color,
    }];
  });
}

function isOwnerReviewedWorkbookRow(row) {
  return isReviewedPaneraiReleaseRecord(row) || (
    String(row?.brand || '').trim().toLowerCase() === 'zenith'
      && String(row?.source || '') === REVIEWED_ZENITH_SOURCE
  ) || isReviewedZenithIdentityCorrectionRecord(row);
}

async function lookupDemand(client, sourceTable, brand, referenceVariants, catalog, selection, preloadedRows = []) {
  // ponytail: admit all demand-side records. classifyDemandEligibility
  // handles per-row quality downstream.
  let data;
  if (Array.isArray(preloadedRows) && preloadedRows.length > 0) {
    data = preloadedRows.filter(row => ['WTB', 'NTQ'].includes(String(row.listing_type || '').toUpperCase()));
  } else {
    const columns = 'id,brand,model,reference,dial_color,condition,listing_type,verdict,confidence,raw_message,flags,dealer_id,source,seller_name,seller_phone,phone_number,posted_by,image_url,thumbnail_url,display_image_url,image_urls,price_raw,price_usd,currency,created_at,listing_date';
    const { data: dbData, error } = await client
      .from(sourceTable)
      .select(columns)
      .eq('brand', brand)
      .in('reference', referenceVariants)
      .in('listing_type', ['WTB', 'NTQ'])
      .or('listing_status.is.null,listing_status.not.in.(HIDDEN,REJECTED,DELETED)')
      .limit(5000);
    if (error) return { demand_count: 0, demand_cohorts: [], demand_rows: [], demand_sample_capped: false };
    data = dbData || [];
  }

  let demandRows;
  try {
    demandRows = (data || []).some(isOwnerReviewedWorkbookRow)
      ? (data || []).filter(isOwnerReviewedWorkbookRow)
      : await retainVerifiedIdentityRows(client, data || []);
  } catch {
    return { demand_count: 0, demand_cohorts: [], demand_rows: [], demand_sample_capped: false };
  }
  const equivalentKeys = new Set(referenceVariants.map(normRef));
  demandRows = demandRows.filter(row =>
    isReleaseListingEligible(row)
    &&
    String(row.brand || '').toLowerCase() === String(brand || '').toLowerCase()
    && equivalentKeys.has(normRef(row.reference)));
  let suppressedIds;
  try {
    suppressedIds = sourceTable === 'price_research_verified_source'
      ? new Set()
      : await loadAnalyticsSuppressedIds(client, demandRows.map(row => row.id));
  } catch {
    return { demand_count: 0, demand_cohorts: [], demand_rows: [], demand_sample_capped: false };
  }
  demandRows = demandRows.filter(row => !suppressedIds.has(String(row.id)));
  const shadowBundleIds = sourceTable === 'price_research_verified_source'
    ? new Set()
    : await loadShadowBundleParentIds(client, demandRows);
  const eligibleBeforeReposts = demandRows
    .map(row => ({ ...row, bundle_candidate_count: bundleCandidateCount(row, shadowBundleIds) }))
    .map(row => ({ ...row, owner_reviewed_identity: isOwnerReviewedWorkbookRow(row) }))
    .filter(row => !classifyDemandEligibility(row, catalog));
  const { uniqueRows: eligible, repostRows } = deduplicateReposts(eligibleBeforeReposts);
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
  // Retain all WTB cohorts regardless of observation count (1+ or 2+ observations)
  const demandCohorts = [...grouped.values()]
    .filter(cohort => cohort.count >= 1)
    .sort((a, b) => b.count - a.count);

  const demandRowsSerialized = eligible.map(row => {
    const phone = row.seller_phone || row.phone_number || null;
    const phoneDigits = phone ? String(phone).replace(/[^0-9]/g, '') : '';
    const whatsappUrl = phoneDigits.length >= 7 ? `https://wa.me/${phoneDigits}` : null;
    const imgCandidate = row.thumbnail_url || row.image_url || row.display_image_url || (Array.isArray(row.image_urls) ? row.image_urls[0] : null) || null;
    return {
      id: String(row.id),
      brand: row.brand,
      model: row.model || null,
      reference: row.reference,
      dial_color: row.dial_color || null,
      condition: row.condition || null,
      listing_type: row.listing_type || 'WTB',
      raw_message: row.raw_message || null,
      seller_name: row.seller_name || row.posted_by || null,
      seller_phone: phone,
      whatsapp_url: whatsappUrl,
      image_url: imgCandidate,
      image_urls: Array.isArray(row.image_urls) ? row.image_urls : (imgCandidate ? [imgCandidate] : []),
      has_images: Boolean(row.has_images || imgCandidate),
      created_at: row.created_at || row.listing_date || null,
      listing_date: row.listing_date || row.created_at || null,
      price_usd: row.price_usd || null,
      price_raw: row.price_raw || row.source_price_amount || null,
      currency: row.currency || row.source_currency || null,
    };
  });

  return {
    demand_count: eligible.length,
    demand_cohorts: demandCohorts,
    demand_rows: demandRowsSerialized,
    demand_sample_capped: (data || []).length >= 5000,
    demand_repost_count: repostRows.length,
    demand_suppressed_duplicate_count: suppressedIds.size,
  };
}

function inferBrand(ref) {
  return sharedInferBrand(ref);
}

async function inferReleasedWorkbookBrand(reference) {
  const client = getClient();
  const { data, error } = await client
    .from('price_research_verified_source')
    .select('id,brand,reference,source,verdict,confidence,listing_status')
    .in('brand', ['Panerai', 'Zenith'])
    .ilike('reference', reference)
    .limit(20);
  if (error) throw error;
  const brands = [...new Set((data || [])
    .filter(isReleaseListingEligible)
    .map(row => String(row.brand || '').trim())
    .filter(Boolean))];
  return brands.length === 1 ? brands[0] : '';
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

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Cookie');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });

  // ponytail: Price Research is intentionally public (see commits adaa4e9,
  // 0b92aa3, 0e51450 on 2026-08-01 — "remove DealerGate from Price Research,
  // now public/free access, no login required"). A later same-day merge
  // (c1f6490, bundled into an unrelated MariaDB ingest commit) accidentally
  // reintroduced this auth gate, breaking reference drill-down for every
  // unauthenticated visitor (401 surfaced as a broken page on click).
  // Outlier/graphics/liquidity evidence is customer-facing analytics, not an
  // admin-only review surface.
  const canReviewExcludedEvidence = true;

  const rawRef = (req.query.reference || '').trim();
  let brand = (req.query.brand || '').trim();
  const evidencePage = Math.max(1, Number.parseInt(String(req.query.evidencePage || '1'), 10) || 1);
  const evidencePageSize = Math.min(100, Math.max(25, Number.parseInt(String(req.query.evidencePageSize || '100'), 10) || 100));

  if (!rawRef) return res.status(400).json({ error: 'reference required' });

  // Auto-resolve brand if not provided
  if (!brand) {
    brand = inferBrand(rawRef);
    if (!brand) {
      try {
        brand = await inferReleasedWorkbookBrand(rawRef);
      } catch {
        // The customer can still select a brand from the bounded browse flow.
      }
    }
    if (!brand) {
      return res.status(400).json({
        error: 'Brand could not be identified for this reference. Select a brand and reference from Browse by Model.',
        hint: 'Brand auto-resolution failed. Provide the brand explicitly.'
      });
    }
  }
  // A reviewed workbook cohort is already constrained to complete identity and
  // source-explicit USD evidence. It may authorize its exact brand/reference
  // even when an older deployment allowlist has not yet been expanded.
  let preloadedReviewedWorkbookRows = [];
  try {
    preloadedReviewedWorkbookRows = await loadReviewedWorkbookAnalyticsRows(getClient(), {
      brand,
      referenceKeys: listEquivalentReferences(rawRef, brand).map(normRef),
      limit: 10000,
    });
  } catch {
    // The legacy release gates below remain fail-closed when the reviewed view
    // is temporarily unavailable.
  }
  const exactReviewedWorkbookRelease = preloadedReviewedWorkbookRows.length > 0;
  if (!exactReviewedWorkbookRelease && !isPublicationBrandAllowed(brand)) {
    return res.status(404).json({ error: 'Brand is not included in this release' });
  }
  if (!exactReviewedWorkbookRelease && !isPublicationReferenceAllowed(brand, rawRef)) {
    return res.status(404).json({ error: 'Reference is not included in this release' });
  }

  try {
    const client = getClient();
    const controlledPaneraiRelease = brand.toLowerCase() === 'panerai';
    const sourceTable = controlledPaneraiRelease
      ? 'price_research_verified_source'
      : 'watch_records';

    // Resolve exact stored spellings only. Prefix matches are suggestions for
    // an explicit customer choice; they must never silently become a specific
    // full reference (for example 5711 -> 5711/110P-001).
    let targetRef = rawRef;
    let referenceVariants = [rawRef];
    if (controlledPaneraiRelease) {
      const exactReleaseReference = REVIEWED_PANERAI_REFERENCES.find(reference =>
        normRef(reference) === normRef(rawRef));
      if (exactReleaseReference) {
        targetRef = exactReleaseReference;
        referenceVariants = [exactReleaseReference];
      }
    } else if (rawRef.length >= 3) {
      // Resolve exact references case-insensitively first. Historical imports
      // contain casing variants (for example 116500LN and 116500ln); keep all
      // equivalent stored spellings so the market query aggregates them.
      const equivalentReferences = listEquivalentReferences(rawRef, brand);
      referenceVariants = equivalentReferences;
      // ponytail: do NOT filter on verdict/confidence during reference
      // resolution. All records in the current dataset are "Human Review"/30;
      // applying APPROVED/90+ gates at discovery time makes every reference
      // invisible, returns 0 rows, and produces the "non-display dataset"
      // reported by the user.
      const exactRefResults = await Promise.all(equivalentReferences.map(reference => client
        .from(sourceTable)
        .select('reference')
        .eq('brand', brand)
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
        // ponytail: prefix ilike with .limit(50) is fast and indexed when the
        // leading characters are specific. Fall back to catalog-based expansion
        // if the DB query returns nothing.
        const prefixResult = await client
          .from(sourceTable)
          .select('reference')
          .eq('brand', brand)
          .ilike('reference', `${rawRef}%`)
          .limit(50);
        refs = prefixResult.data;
        refError = prefixResult.error;
        // ponytail: also try the catalog for prefix-matched references.
        // listCatalogReferences contains every known reference per brand
        // and is already loaded in memory. For "126500" this returns
        // ["126500LN", "126500LNA", ...] without a DB query.
        if ((!refs || refs.length === 0) && !refError) {
          try {
            const catalogRefs = listCatalogReferences(brand)
              .filter(e => e.reference && e.reference.toUpperCase().startsWith(rawRef.toUpperCase()))
              .map(e => e.reference);
            refs = [...new Set(catalogRefs)].map(r => ({ reference: r }));
          } catch { /* catalog unavailable, keep refs as-is */ }
        }
      }

      if (!refError && refs && refs.length > 0) {
        const foundRefs = [...new Set(refs.map(r => r.reference))];
        const equivalentKeys = new Set(equivalentReferences.map(normRef));
        const exactVariants = foundRefs.filter(r => equivalentKeys.has(normRef(r)));
        const exact = exactVariants[0];
        if (exact) {
          const catalogHit = lookupCatalog(rawRef, brand || null);
          targetRef = catalogHit?.found && catalogHit.matchType !== 'partial' && catalogHit.reference
            ? catalogHit.reference
            : exact;
          referenceVariants = [...new Set([...equivalentReferences, ...exactVariants])];
        }
        else {
          // ponytail: auto-expand referenceVariants to include prefix-matched
          // references when the exact reference has no exact match in the DB.
          // A user searching "126500" should get results for "126500LN" etc.
          // without needing to select from a candidate list.
          referenceVariants = [...new Set([...equivalentReferences, ...foundRefs])];
          if (foundRefs.length > 0) targetRef = foundRefs[0];
        }
      }
    }

    // PostgREST caps each response at 1,000 rows. Page explicitly so a busy
    // reference does not produce a chart made only from its newest day.
    const pageSize = 1000;
    const sampleLimit = 10000;
    const columns = 'id,brand,model,reference,price_raw,price_usd,currency,raw_message,flags,created_at,listing_date,condition,source,dial_color,year,listing_type,dealer_id,confidence,verdict,listing_status,thumbnail_url,image_urls,has_images';
    // ponytail: admit all records for analytics. classifyResearchEligibility
    // applies per-row quality gates downstream (missing price/brand/dial,
    // catalog mismatch, reference-as-price). Pre-filtering on verdict/confidence
    // was silently dropping 100% of the dataset — every record is "Human Review"
    // confidence 30, and none will reach APPROVED/90+ without batch processing.
    //
    // ponytail: keep query simple — .in('reference') + .eq('brand') is
    // indexed; avoid .or() on unindexed listing_status + double-order that
    // forces full scans on the multi-million-row table.
    const buildRowsQuery = (from, to) => client
      .from(sourceTable)
      .select(columns)
      .eq('brand', brand)
      .in('reference', referenceVariants)
      .neq('listing_type', 'WTB')
      .gt('price_usd', 0)
      .order('created_at', { ascending: false })
      .range(from, to);

    // Avoid a filtered COUNT over the multi-million-row table. Fetch bounded,
    // deterministic pages in parallel and report whether the sample hit its cap.
    let rows;
    if (controlledPaneraiRelease) {
      const { data, error } = await client
        .from(sourceTable)
        .select(columns)
        .in('id', REVIEWED_PANERAI_RECORD_IDS)
        .eq('brand', 'Panerai')
        .eq('source', REVIEWED_PANERAI_SOURCE)
        .in('reference', referenceVariants)
        .eq('verdict', 'APPROVED')
        .gte('confidence', MIN_RELEASE_CONFIDENCE)
        .eq('listing_type', 'WTS');
      if (error) throw error;
      rows = data || [];
    } else {
      const sampledPages = await Promise.all(
        Array.from({ length: sampleLimit / pageSize }, (_, index) => {
          const from = index * pageSize;
          return buildRowsQuery(from, from + pageSize - 1);
        })
      );
      const pageError = sampledPages.find(page => page.error)?.error;
      if (pageError) throw pageError;
      rows = sampledPages.flatMap(page => page.data || []);
    }
    // Reviewed workbooks are the customer-visible canonical inventory. When an
    // exact reference has source-explicit USD evidence there, use that same
    // evidence for analytics. Legacy watch_records remains a fallback only.
    let reviewedWorkbookRows = preloadedReviewedWorkbookRows;
    try {
      if (!reviewedWorkbookRows.length) {
        reviewedWorkbookRows = await loadReviewedWorkbookAnalyticsRows(client, {
          brand,
          referenceKeys: referenceVariants.map(normRef),
          limit: sampleLimit,
        });
      }
    } catch (workbookError) {
      console.warn('[price-research] reviewed workbook analytics unavailable; using legacy cohort:', workbookError.message);
    }
    const usingReviewedWorkbook = reviewedWorkbookRows.length > 0;
    // ponytail: reviewed workbooks may have identity metadata (brand/model/ref/dial)
    // but no verified USD price yet. When ALL view rows are price-ineligible,
    // fall back to the direct watch_records query which may have parser-extracted
    // prices from raw_line text (e.g., "WTS Omega 310.30.42.50.04.001 white 7300.00").
    // This prevents Price Research from showing 0 rows when the workbook staging
    // pipeline hasn't completed its price verification pass yet.
    const catalogForEligibilityCheck = lookupCatalog(targetRef, brand || null);
    const workbookHasAnyEligible = usingReviewedWorkbook
      && reviewedWorkbookRows.some(r => !classifyResearchEligibility(r, catalogForEligibilityCheck));
    if (usingReviewedWorkbook && !workbookHasAnyEligible && rows && rows.length > 0) {
      // Fall back to direct query rows — they have price_usd from parser extraction
      console.log(`[price-research] reviewed workbook rows exist but none are price-eligible; using direct query rows (${rows.length})`);
      // Keep usingReviewedWorkbook false so downstream doesn't expect workbook-only fields
    } else if (usingReviewedWorkbook) {
      rows = reviewedWorkbookRows;
    }
    const baseSampleCount = rows.length;

    if (!rows || rows.length === 0) {
      const emptyReconciliation = {
        total_tracked_listings: 0,
        wts_eligible_analytics_count: 0,
        wtb_demand_count: 0,
        excluded_count: 0,
        excluded_breakdown: {
          unpriced: 0,
          outliers: 0,
          unsplit_bundles: 0,
        },
      };
      return res.status(200).json({
        success: true, brand, reference: rawRef,
        resolvedRef: targetRef !== rawRef ? targetRef : null,
        model: null, dialColors: null,
        total_tracked_listings: 0,
        wts_eligible_analytics_count: 0,
        wtb_demand_count: 0,
        demand_rows: [],
        excluded_count: 0,
        excluded_breakdown: emptyReconciliation.excluded_breakdown,
        reconciliation: emptyReconciliation,
        dial_analysis: [],
        totalListings: 0, sampledListings: 0, sampleCapped: false, count: 0,
        analytics_ready: false, listing_count: 0,
        sample_quality: 'observational',
        selected_cohort: { condition: 'All conditions', dial_color: 'Unspecified', count: 0 },
        cohorts: [], outliers: [], outlier_rows: [], outliersRemoved: 0, excludedEvidenceCount: 0, rawCount: 0,
        methodology: { method: 'PLAUSIBILITY_FLOOR_THEN_IQR_3_0', minimum_sample: 2, included_count: 0, excluded_count: 0 },
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
    if (!controlledPaneraiRelease && !usingReviewedWorkbook && supplementalCatalogDials.length) {
      const supplementalPages = await Promise.all(supplementalCatalogDials.map(dial => client
        .from(sourceTable)
        .select(columns)
        .eq('brand', brand)
        .in('reference', referenceVariants)
        .eq('listing_type', 'WTS')
        .ilike('dial_color', dial)
        .order('created_at', { ascending: false })
        .limit(1000)));
      const supplementalError = supplementalPages.find(page => page.error)?.error;
      if (supplementalError) throw supplementalError;
      const rowsById = new Map(rows.map(row => [row.id, row]));
      for (const row of supplementalPages.flatMap(page => page.data || [])) rowsById.set(row.id, row);
      rows = [...rowsById.values()];
    }
    rows = usingReviewedWorkbook
      ? rows
      : controlledPaneraiRelease
      ? rows.filter(isOwnerReviewedWorkbookRow)
      : rows;
    const equivalentKeys = new Set(referenceVariants.map(normRef));
    rows = rows.filter(row =>
      (usingReviewedWorkbook || isReleaseListingEligible(row))
      && String(row.brand || '').toLowerCase() === String(brand || '').toLowerCase()
      && equivalentKeys.has(normRef(row.reference)));
    const shadowBundleIds = controlledPaneraiRelease || usingReviewedWorkbook
      ? new Set()
      : await loadShadowBundleParentIds(client, rows);

    const normalizedRows = rows
      .filter(r => !excludedSources.has(r.source))
      .map(row => {
        const normalized = usingReviewedWorkbook
          ? { ...row, analytics_price_usd: row.price_usd, price_normalization: null }
          : normalizeMarketRow(row, referenceVariants);
        const normalizedDial = normalizeDialValue(normalized.dial_color);
        return {
          ...normalized,
          owner_reviewed_identity: row.owner_reviewed_identity === true || isOwnerReviewedWorkbookRow(row),
          bundle_candidate_count: bundleCandidateCount(row, shadowBundleIds),
          dial_color: normalizedDial.known ? normalizedDial.value : normalized.dial_color,
          stored_price_usd: row.price_usd,
          price_usd: normalized.analytics_price_usd,
        };
      });
    // The strict view excludes reviewed duplicates in Postgres. Recheck only
    // this bounded cohort so a deployment-order or lookup failure is
    // unavailable rather than silently publishing a suppressed observation.
    const analyticsSuppressedIds = controlledPaneraiRelease || usingReviewedWorkbook
      ? new Set()
      : await loadAnalyticsSuppressedIds(
          client,
          normalizedRows.map(row => row.id)
        );
    const duplicateSuppressedRows = normalizedRows.filter(row => analyticsSuppressedIds.has(String(row.id)));
    const analyticsRows = normalizedRows.filter(row => !analyticsSuppressedIds.has(String(row.id)));
    const bundleParentExcludedCount = analyticsRows.filter(row => row.bundle_candidate_count > 1).length;
    const totalListings = analyticsRows.length - bundleParentExcludedCount;
    const requestedDial = String(req.query.dial || '').trim().toLowerCase();
    const requiredFieldExclusions = analyticsRows
      .map(row => ({ row, reason: classifyResearchEligibility(row, catalogHit) }))
      .filter(item => item.reason)
      .map(({ row, reason }) => ({ ...row, is_outlier: true, outlier_reason: reason }));
    const retainedEvidenceRows = requiredFieldExclusions.filter(row => (
      isOwnerReviewedWorkbookRow(row)
      && (!requestedDial || String(row.dial_color || '').trim().toLowerCase() === requestedDial)
    ));
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
    const selectedDialGroup = dialGroups.find(group =>
      !requestedDial || group.dial_color.toLowerCase() === requestedDial
    ) || dialGroups[0] || { dial_color: 'Unspecified', rows: [], count: 0, condition_counts: {} };
    const selection = { dial: selectedDialGroup.dial_color };
    const selectedRows = selectedDialGroup.rows;
    const selectedCohort = {
      condition: 'All conditions',
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

    // The release cohort is exact brand + reference + dial. Condition remains
    // descriptive listing evidence and does not split market analytics. The
    // helper still enforces sample, identity, recency, and rolling-backtest
    // gates before returning any future values.
    const forecastsDisabled = process.env.ENABLE_PRICE_FORECASTS !== 'true';
    const forecastCandidate = forecastsDisabled
      ? {
          ready: false,
          reasons: ['FEATURE_NOT_RELEASED'],
          offer_count: includedRows.length,
          verified_dealer_count: new Set(includedRows.map(row => row.dealer_id).filter(Boolean)).size,
        }
      : buildMarketForecast(includedRows);
    const forecast = forecastCandidate;

    // ── Dial analysis with family rollup + min-5 gate + catalog cross-reference ──
    // Family map: normalize variant names to canonical families
    const DIAL_FAMILY = {
      'blue arabic': 'Blue', 'blue index': 'Blue', 'blue diamond': 'Blue', 'blue roman': 'Blue',
      'sunburst blue': 'Blue', 'navy blue': 'Blue', 'ice blue': 'Ice Blue', 'tiffany blue': 'Tiffany Blue',
      'dark blue': 'Blue', 'light blue': 'Blue',
      'cream white': 'White', 'ivory white': 'White', 'arctic white': 'White',
      'mother of pearl': 'Mother of Pearl', 'mop': 'Mother of Pearl',
      'white mother of pearl': 'Mother of Pearl', 'black mother of pearl': 'Mother of Pearl',
      'black index': 'Black', 'black roman': 'Black', 'black diamond': 'Black',
      'choco': 'Chocolate', 'chocolate': 'Chocolate', 'coffee': 'Chocolate',
      'gold diamond': 'Gold', 'rose gold': 'Gold', 'pave diamond': 'Diamond',
      'pave': 'Diamond', 'paved': 'Diamond',
      'champ': 'Champagne', 'champagne': 'Champagne',
      'slate': 'Grey', 'anthracite': 'Grey',
      'candy': 'Pink', 'candy pink': 'Pink', 'lavender': 'Purple',
      'green index': 'Green', 'olive green': 'Green', 'olive': 'Green',
    };

    function dialToFamily(dialColor) {
      if (!dialColor) return 'Unspecified';
      const key = String(dialColor).trim().toLowerCase();
      if (DIAL_FAMILY[key]) return DIAL_FAMILY[key];
      // If the dial is a known base color, keep it
      const baseColors = ['black', 'white', 'blue', 'green', 'silver', 'grey', 'gray',
        'brown', 'pink', 'red', 'yellow', 'purple', 'orange', 'gold', 'salmon',
        'champagne', 'rhodium', 'meteorite', 'skeleton', 'bronze', 'cream',
        'beige', 'panda', 'wimbledon', 'tiffany', 'platinum'];
      for (const base of baseColors) {
        if (key === base || key.startsWith(base + ' ') || key.startsWith(base + '/')) {
          return base.charAt(0).toUpperCase() + base.slice(1);
        }
      }
      // Unknown custom — keep original but flag as low-signal
      return String(dialColor).trim();
    }

    const dialMap = {};
    const dialAnalysisRows = marketRows;
    dialAnalysisRows.forEach(r => {
      const rawDial = r.dial_color || 'Unspecified';
      const family = dialToFamily(rawDial);
      const key = family.toLowerCase();
      if (!dialMap[key]) dialMap[key] = { dial_color: family, rows: [] };
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
      .filter(d => d.count >= 2)  // min-2 gate: only show dial families with 2+ listings
      .sort((a, b) => b.count - a.count);
    const dialColors = dial_analysis.map(d => d.dial_color);

    // ── Real model name (catalog decoration) + real liquidity (indicators, no phantom numbers) ──
    const model = catalogHit?.found
      ? (catalogHit.model || null)
      : lookupModel(targetRef, brand)
        || analyticsRows.map(row => String(row.model || '').trim()).find(Boolean)
        || null;
    const demand = await lookupDemand(
      client,
      sourceTable,
      brand,
      referenceVariants,
      catalogHit,
      selection,
      preloadedReviewedWorkbookRows,
    );
    const liquidity = await lookupLiquidity(client, targetRef, listedRows.length, demand, selection);

    const outlierEvidenceLimit = 100;
    const serializedOutliers = outlierRows.slice(0, outlierEvidenceLimit);
    const comparableOffset = (evidencePage - 1) * evidencePageSize;
    const serializedComparables = includedRows.slice(comparableOffset, comparableOffset + evidencePageSize);
    const retainedOffset = (evidencePage - 1) * evidencePageSize;
    const serializedRetainedEvidence = retainedEvidenceRows.slice(
      retainedOffset,
      retainedOffset + evidencePageSize,
    );

    const totalTrackedListings = rows.length;
    const wtsEligibleAnalyticsCount = includedRows.length;
    const outliersCount = statisticalOutlierRows.length;
    const unsplitBundlesCount = bundleParentExcludedCount;
    const wtbInRows = rows.filter(r => ['WTB', 'NTQ'].includes(String(r.listing_type || '').toUpperCase())).length;
    const rawWtbDemand = demand?.demand_count;
    const maxWtbCapacity = Math.max(0, totalTrackedListings - wtsEligibleAnalyticsCount - outliersCount - unsplitBundlesCount);
    const wtbDemandCount = typeof rawWtbDemand === 'number' && Number.isFinite(rawWtbDemand) && rawWtbDemand >= 0
      ? Math.min(rawWtbDemand, maxWtbCapacity)
      : Math.min(wtbInRows, maxWtbCapacity);
    const unpricedCount = Math.max(0, totalTrackedListings - wtsEligibleAnalyticsCount - wtbDemandCount - outliersCount - unsplitBundlesCount);
    const excludedTotalCount = unpricedCount + outliersCount + unsplitBundlesCount;

    const reconciliation = {
      total_tracked_listings: totalTrackedListings,
      wts_eligible_analytics_count: wtsEligibleAnalyticsCount,
      wtb_demand_count: wtbDemandCount,
      excluded_count: excludedTotalCount,
      excluded_breakdown: {
        unpriced: unpricedCount,
        outliers: outliersCount,
        unsplit_bundles: unsplitBundlesCount,
      },
    };

    res.status(200).json({
      success: true, brand, reference: rawRef,
      resolvedRef: targetRef !== rawRef ? targetRef : null,
      model, dialColors,
      analytics_source: usingReviewedWorkbook
        ? 'reviewed_workbook_market_source_v2'
        : sourceTable,
      total_tracked_listings: totalTrackedListings,
      wts_eligible_analytics_count: wtsEligibleAnalyticsCount,
      wtb_demand_count: wtbDemandCount,
      demand_rows: demand?.demand_rows || [],
      excluded_count: excludedTotalCount,
      excluded_breakdown: reconciliation.excluded_breakdown,
      reconciliation,
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
      condition_policy: {
        analytics_dimension: false,
        cohort: 'All conditions',
        listing_description_retained: true,
      },
      admission_policy: {
        verdict: 'ALL_VERDICTS',
        minimum_confidence: 0,
        confidence_is_probability: false,
        exact_release_reference_required: false,
        canonical_identity_review_required: false,
        explicit_currency_evidence_required: false,
        verified_fx_provenance_required: false,
        catalog_model_and_dial_required: false,
        catalog_or_owner_reviewed_identity_required: false,
        unsplit_bundles_excluded: true,
        reviewed_duplicates_excluded: true,
      },
      totalListings: listedRows.length,
      reference_listing_count: totalListings,
      listing_count: listedRows.length,
      eligible_observation_count: listedRows.length,
      unique_offer_count: listedRows.length,
      market_listings_count: analyticsRows.length,
      analytics_eligible_count: marketRows.length,
      analytics_excluded_count: analyticsRows.length - marketRows.length,
      repost_count: repostRows.filter(row => matchesSelection(row, selection)).length,
      sampledListings: rows.length,
      sampleCapped: baseSampleCount >= sampleLimit,
      count: prices.length,
      rawCount: validPriceRows.length,
      outliersRemoved: statisticalOutlierRows.length,
      excludedEvidenceCount: outlierRows.length,
      retained_evidence_count: retainedEvidenceRows.length,
      outliers: canReviewExcludedEvidence ? statisticalOutlierRows.map(row => row.price_usd) : [],
      outlier_rows: canReviewExcludedEvidence ? serializedOutliers.map(r => ({
        id: r.id,
        price_usd: r.price_usd, created_at: r.created_at, listing_date: r.listing_date,
        dial_color: r.dial_color, condition: r.condition,
        source: r.source, year: r.year, is_outlier: true, outlier_reason: r.outlier_reason,
        stored_price_usd: r.stored_price_usd, price_normalization: r.price_normalization,
        source_price_amount: r.source_price_amount || null,
        source_currency: r.source_currency || null,
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
        method: 'PLAUSIBILITY_FLOOR_THEN_IQR_3_0',
        analytics_dimensions: ['brand', 'reference', 'dial_color'],
        condition_policy: 'DESCRIPTION_ONLY_NOT_A_COHORT_DIMENSION',
        minimum_sample: 2,
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
      retained_rows: serializedRetainedEvidence.map(r => ({
        id: r.id,
        price_usd: null,
        created_at: r.created_at,
        listing_date: r.listing_date,
        dial_color: r.dial_color,
        condition: r.condition,
        source: r.source,
        year: r.year,
        is_outlier: true,
        outlier_reason: r.outlier_reason,
        source_price_amount: r.source_price_amount || null,
        source_currency: r.source_currency || null,
      })),
      rows: serializedComparables.map(r => ({
        id: r.id,
        raw_message: r.raw_message || null,
        price_usd: r.price_usd, created_at: r.created_at, listing_date: r.listing_date,
        dial_color: r.dial_color, condition: r.condition,
        source: r.source, year: r.year,
        thumbnail_url: r.thumbnail_url || null,
        image_urls: r.image_urls || null,
        has_images: r.has_images || false,
        seller_name: r.seller_name || null,
        seller_phone: r.seller_phone || null,
        verdict: r.verdict || null,
        confidence: r.confidence || null,
        listing_status: r.listing_status || null,
        contact_publication_approved: r.contact_publication_approved || false,
        source_file: r.source_file || null,
        stored_price_usd: r.stored_price_usd, price_normalization: r.price_normalization,
        is_outlier: r.is_outlier, outlier_reason: r.outlier_reason,
      })),
    });
  } catch (err) {
    console.error('[price-research] error:', err.message, err.stack?.split('\n').slice(0, 3).join(' '));
    res.status(500).json({ error: 'Failed to fetch from database', detail: err.message });
  }
};
