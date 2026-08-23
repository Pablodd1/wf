/**
 * CATALOG REFERENCES — /api/catalog-references?brand=Rolex&model=Submariner
 *
 * Returns deterministic catalog reference identities for model browsing.
 * Catalog presence never implies a market observation or analytics readiness;
 * exact approved evidence is resolved by /api/price-research after selection.
 */
const { getClient } = require('./_lib/supabase');
const { listCanonicalCatalogReferences, listEquivalentReferences, lookupCatalog } = require('./_lib/catalog');
const { isPublicationBrandAllowed } = require('./_lib/publication-brands.cjs');
const {
  loadReviewedWorkbookBrandRows,
  isReviewedWorkbookBrowseBrand,
  summarizeReviewedWorkbookReferences,
} = require('./_lib/reviewed-workbook-browse.cjs');
const {
  MIN_RELEASE_CONFIDENCE,
  REVIEWED_PANERAI_RECORD_IDS,
  REVIEWED_PANERAI_SOURCE,
  REVIEWED_ZENITH_RECORD_END,
  REVIEWED_ZENITH_RECORD_START,
  REVIEWED_ZENITH_SOURCE,
  isPublicationReferenceAllowed,
  isReleaseListingEligible,
} = require('./_lib/publication-references.cjs');
const { normalizeMarketRow } = require('./_lib/market-row-normalization.cjs');
const { classifyResearchEligibility } = require('./_lib/price-research-eligibility.cjs');
const { deduplicateReposts } = require('./_lib/repost-deduplication.cjs');
const { buildReleaseBrowseIndex } = require('./_lib/release-catalog-browse.cjs');

const _cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const REFERENCE_SAMPLE_LIMIT = 1000;
const MINIMUM_ANALYTICS_SAMPLE = 5;
const LOOKUP_CONCURRENCY = 8;
const ZENITH_REFERENCE_ONLY_MODEL = 'Reference-only listings';
const PANERAI_REFERENCE_ONLY_MODEL = 'Reference-only listings';
const FOREIGN_ZENITH_MODEL = /\b(?:Audemars Piguet|Cartier|IWC|Omega|Patek Philippe|Piaget|Rolex|Tudor|Vacheron Constantin)\b/i;

function referenceKey(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function mergeVacheronReleaseReferences(catalogEntries, observedRows) {
  const byKey = new Map((catalogEntries || []).map(entry => [referenceKey(entry.reference), {
    reference: entry.reference,
    listing_count: 0,
    wts_observation_count: 0,
    wtb_observation_count: 0,
    priced_wts_observation_count: 0,
    eligible_observation_count: 0,
    analytics_ready: false,
    sample_capped: false,
    avg_price: null,
    dial_colors: [],
    identity_source: 'PREAGGREGATED_CATALOG_INDEX',
    evidence_resolution: 'EXACT_RELEASE_MANIFEST_ON_SELECTION',
  }]));
  let unresolvedReferenceListingCount = 0;
  let unresolvedReferencePricedWtsCount = 0;
  for (const row of observedRows || []) {
    if (!row?.reference) {
      unresolvedReferenceListingCount += Number(row?.listing_count || 0);
      unresolvedReferencePricedWtsCount += Number(row?.priced_wts_count || 0);
      continue;
    }
    const key = referenceKey(row.reference);
    const current = byKey.get(key) || {
      reference: String(row.reference),
      eligible_observation_count: 0,
      analytics_ready: false,
      sample_capped: false,
      avg_price: null,
      dial_colors: [],
      identity_source: 'SOURCE_PROVEN_RELEASE_REFERENCE',
      evidence_resolution: 'EXACT_RELEASE_MANIFEST_ON_SELECTION',
    };
    byKey.set(key, {
      ...current,
      listing_count: Number(current.listing_count || 0) + Number(row.listing_count || 0),
      wts_observation_count: Number(current.wts_observation_count || 0) + Number(row.wts_count || 0),
      wtb_observation_count: Number(current.wtb_observation_count || 0) + Number(row.wtb_count || 0),
      priced_wts_observation_count: Number(current.priced_wts_observation_count || 0)
        + Number(row.priced_wts_count || 0),
      identity_source: row.catalog_reference_confirmed === true
        ? 'CATALOG_AND_RELEASE_MANIFEST'
        : current.identity_source,
    });
  }
  return {
    references: [...byKey.values()].sort((left, right) => (
      Number(right.listing_count || 0) - Number(left.listing_count || 0)
      || left.reference.localeCompare(right.reference)
    )),
    unresolvedReferenceListingCount,
    unresolvedReferencePricedWtsCount,
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function loadReferenceEvidence(client, brand, entry) {
  const { data, error } = await client
    .from('price_research_verified_source')
    .select('id,brand,reference,price_raw,price_usd,currency,dial_color,condition,raw_message,flags,confidence,verdict,dealer_id')
    .eq('brand', brand)
    .eq('reference', entry.reference)
    .eq('verdict', 'APPROVED')
    .gte('confidence', MIN_RELEASE_CONFIDENCE)
    .eq('listing_type', 'WTS')
    .or('listing_status.is.null,listing_status.not.in.(HIDDEN,REJECTED,DELETED)')
    .gt('price_usd', 0)
    .limit(REFERENCE_SAMPLE_LIMIT);
  if (error) throw error;
  if (!data?.length) return null;

  const catalog = lookupCatalog(entry.reference, brand);
  const eligible = data
    .filter(row => isReleaseListingEligible(row))
    .map(row => {
      const normalized = normalizeMarketRow(
        row,
        listEquivalentReferences(entry.reference, brand),
      );
      return {
        ...normalized,
        price_usd: normalized.analytics_price_usd,
        bundle_candidate_count: 1,
      };
    })
    .filter(row => !classifyResearchEligibility(row, catalog));
  const { uniqueRows: qualified } = deduplicateReposts(eligible);
  const dials = new Map();
  let sum = 0;
  for (const row of qualified) {
    sum += Number(row.price_usd);
    const dial = row.dial_color || 'Unspecified';
    dials.set(dial, (dials.get(dial) || 0) + 1);
  }
  return {
    reference: entry.reference,
    listing_count: qualified.length,
    analytics_ready: qualified.length >= MINIMUM_ANALYTICS_SAMPLE,
    sample_capped: data.length >= REFERENCE_SAMPLE_LIMIT,
    avg_price: qualified.length >= MINIMUM_ANALYTICS_SAMPLE ? Math.round(sum / qualified.length) : null,
    dial_colors: [...dials.entries()]
      .map(([dial_color, count]) => ({ dial_color, count }))
      .sort((a, b) => b.count - a.count),
  };
}

function reviewedPaneraiModel(row) {
  const catalog = lookupCatalog(row.reference, 'Panerai');
  return catalog?.found && catalog.model
    ? String(catalog.model).trim()
    : String(row.model || '').trim() || PANERAI_REFERENCE_ONLY_MODEL;
}

function reviewedZenithModel(row) {
  const catalog = lookupCatalog(row.reference, 'Zenith');
  if (catalog?.found && catalog.model) return String(catalog.model).trim();
  const claimed = String(row.model || '').trim();
  return claimed && !FOREIGN_ZENITH_MODEL.test(claimed)
    ? claimed
    : ZENITH_REFERENCE_ONLY_MODEL;
}

async function loadReviewedPaneraiReferences(client, requestedModel) {
  const { data, error } = await client
    .from('price_research_verified_source')
    .select('id,brand,model,reference,price_raw,price_usd,currency,dial_color,condition,raw_message,flags,confidence,verdict,dealer_id,source,listing_type,listing_status')
    .in('id', REVIEWED_PANERAI_RECORD_IDS)
    .eq('brand', 'Panerai')
    .eq('source', REVIEWED_PANERAI_SOURCE)
    .eq('verdict', 'APPROVED')
    .gte('confidence', MIN_RELEASE_CONFIDENCE)
    .eq('listing_type', 'WTS');
  if (error) throw error;

  const grouped = new Map();
  for (const row of (data || []).filter(row => (
    isReleaseListingEligible(row)
    && row.reference
    && reviewedPaneraiModel(row) === requestedModel
  ))) {
    const members = grouped.get(row.reference) || [];
    members.push(row);
    grouped.set(row.reference, members);
  }

  return [...grouped.entries()].map(([reference, members]) => {
    const catalog = lookupCatalog(reference, 'Panerai');
    const eligible = members
      .map(row => {
        const normalized = normalizeMarketRow(
          row,
          listEquivalentReferences(reference, 'Panerai'),
        );
        return {
          ...normalized,
          owner_reviewed_identity: true,
          price_usd: normalized.analytics_price_usd,
          bundle_candidate_count: 1,
        };
      })
      .filter(row => !classifyResearchEligibility(row, catalog));
    const { uniqueRows: qualified } = deduplicateReposts(eligible);
    const { uniqueRows: uniqueMembers } = deduplicateReposts(members);
    const dialCounts = new Map();
    for (const row of uniqueMembers) {
      const dial = String(row.dial_color || '').trim();
      if (dial) dialCounts.set(dial, (dialCounts.get(dial) || 0) + 1);
    }
    const sum = qualified.reduce((total, row) => total + Number(row.price_usd), 0);
    return {
      reference,
      listing_count: uniqueMembers.length,
      eligible_observation_count: qualified.length,
      analytics_ready: qualified.length >= MINIMUM_ANALYTICS_SAMPLE,
      sample_capped: false,
      avg_price: qualified.length >= MINIMUM_ANALYTICS_SAMPLE
        ? Math.round(sum / qualified.length)
        : null,
      dial_colors: [...dialCounts.entries()]
        .map(([dial_color, count]) => ({ dial_color, count }))
        .sort((a, b) => b.count - a.count),
      identity_source: catalog?.found ? 'CATALOG_OR_OWNER_REVIEWED' : 'OWNER_REVIEWED_WORKBOOK',
    };
  }).sort((a, b) => b.listing_count - a.listing_count || a.reference.localeCompare(b.reference));
}

async function loadReviewedZenithReferences(client, requestedModel) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from('price_research_verified_source')
      .select('id,brand,model,reference,price_raw,price_usd,currency,dial_color,condition,raw_message,flags,confidence,verdict,dealer_id,source,listing_type,listing_status')
      .gte('id', REVIEWED_ZENITH_RECORD_START)
      .lt('id', REVIEWED_ZENITH_RECORD_END)
      .eq('brand', 'Zenith')
      .eq('source', REVIEWED_ZENITH_SOURCE)
      .eq('verdict', 'APPROVED')
      .gte('confidence', MIN_RELEASE_CONFIDENCE)
      .eq('listing_type', 'WTS')
      .order('id', { ascending: true })
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const modelRows = rows.filter(row => (
    reviewedZenithModel(row) === requestedModel
    && row.reference
  ));
  const grouped = new Map();
  for (const row of modelRows) {
    const members = grouped.get(row.reference) || [];
    members.push(row);
    grouped.set(row.reference, members);
  }
  return [...grouped.entries()].map(([reference, members]) => {
    const catalog = lookupCatalog(reference, 'Zenith');
    const eligible = members
      .filter(row => isReleaseListingEligible(row))
      .map(row => {
        const normalized = normalizeMarketRow(
          row,
          listEquivalentReferences(reference, 'Zenith'),
        );
        return {
          ...normalized,
          owner_reviewed_identity: true,
          price_usd: normalized.analytics_price_usd,
          bundle_candidate_count: 1,
        };
      })
      .filter(row => !classifyResearchEligibility(row, catalog));
    const { uniqueRows: qualified } = deduplicateReposts(eligible);
    const dialCounts = new Map();
    for (const row of members) {
      const dial = String(row.dial_color || '').trim();
      if (dial) dialCounts.set(dial, (dialCounts.get(dial) || 0) + 1);
    }
    const sum = qualified.reduce((total, row) => total + Number(row.price_usd), 0);
    return {
      reference,
      listing_count: members.length,
      eligible_observation_count: qualified.length,
      analytics_ready: qualified.length >= MINIMUM_ANALYTICS_SAMPLE,
      sample_capped: false,
      avg_price: qualified.length >= MINIMUM_ANALYTICS_SAMPLE
        ? Math.round(sum / qualified.length)
        : null,
      dial_colors: [...dialCounts.entries()]
        .map(([dial_color, count]) => ({ dial_color, count }))
        .sort((a, b) => b.count - a.count),
      identity_source: catalog?.found ? 'CATALOG_OR_OWNER_REVIEWED' : 'OWNER_REVIEWED_WORKBOOK',
    };
  }).sort((a, b) => b.listing_count - a.listing_count || a.reference.localeCompare(b.reference));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const brand = (req.query.brand || '').trim();
  const model = (req.query.model || '').trim();
  if (!brand || !model) return res.status(400).json({ error: 'brand and model required' });

  const cacheKey = `${brand}|${model}`;
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return res.status(200).json({ ...cached.payload, cached: true });
  }

  try {
    const client = getClient();
    if (brand.toLowerCase() === 'vacheron constantin' && model.toLowerCase() === 'overseas') {
      const { data: observedRows, error: observedError } = await client
        .rpc('qnsa_vacheron_overseas_reference_index');
      if (observedError) throw observedError;
      const merged = mergeVacheronReleaseReferences(
        listCanonicalCatalogReferences('Vacheron Constantin', 'Overseas'),
        observedRows,
      );
      const out = merged.references;
      const payload = {
        success: true,
        brand: 'Vacheron Constantin',
        model: 'Overseas',
        reference_count: out.length,
        observed_listing_count: out.reduce((sum, item) => sum + Number(item.listing_count || 0), 0),
        unresolved_reference_listing_count: merged.unresolvedReferenceListingCount,
        unresolved_reference_priced_wts_count: merged.unresolvedReferencePricedWtsCount,
        references: out,
        identity_source: 'CATALOG_PLUS_EXACT_RELEASE_MANIFEST',
        evidence_resolution: 'EXACT_RELEASE_MANIFEST_ON_SELECTION',
        sample_capped: false,
      };
      _cache.set(cacheKey, { at: Date.now(), payload });
      return res.status(200).json(payload);
    }
    if (['omega', 'cartier', 'tudor'].includes(brand.toLowerCase())) {
      const canonicalBrand = brand.toLowerCase() === 'cartier' ? 'Cartier'
        : brand.toLowerCase() === 'tudor' ? 'Tudor' : 'Omega';
      const releaseIndexRpc = canonicalBrand === 'Cartier'
        ? 'qnsa_cartier_reference_index'
        : canonicalBrand === 'Tudor' ? 'qnsa_tudor_reference_index' : 'qnsa_omega_reference_index';
      const { data: observedRows, error: observedError } = await client.rpc(releaseIndexRpc);
      if (observedError) throw observedError;
      const browse = buildReleaseBrowseIndex(canonicalBrand, observedRows || []);
      const references = browse.references.filter(row => row.model.toLowerCase() === model.toLowerCase());
      const canonicalModel = references[0]?.model || model;
      const unresolved = browse.unresolvedByModel[canonicalModel] || { listing_count: 0, priced_wts_count: 0 };
      const payload = {
        success: true,
        brand: canonicalBrand,
        model,
        reference_count: references.length,
        observed_listing_count: references.reduce((sum, item) => sum + Number(item.listing_count || 0), 0),
        unresolved_reference_listing_count: unresolved.listing_count,
        unresolved_reference_priced_wts_count: unresolved.priced_wts_count,
        references,
        identity_source: 'CATALOG_PLUS_EXACT_RELEASE_MANIFEST',
        evidence_resolution: 'EXACT_RELEASE_MANIFEST_ON_SELECTION',
        sample_capped: false,
        suppressed_model_conflict_count: browse.modelConflicts.length,
      };
      _cache.set(cacheKey, { at: Date.now(), payload });
      return res.status(200).json(payload);
    }
    if (isReviewedWorkbookBrowseBrand(brand)) {
      const { rows, truncated } = await loadReviewedWorkbookBrandRows(client, brand);
      if (!rows.length && brand.toLowerCase() !== 'tag heuer') {
        return res.status(404).json({ error: 'Brand has no published reviewed listings' });
      }
      if (truncated) return res.status(503).json({ error: 'Brand inventory is too large for safe reference browsing' });
      let out = summarizeReviewedWorkbookReferences(rows, model, false);
      if (brand.toLowerCase() === 'tag heuer') {
        const merged = new Map(listCanonicalCatalogReferences('TAG Heuer', model).map(entry => [
          referenceKey(entry.reference),
          {
            reference: entry.reference,
            listing_count: 0,
            eligible_observation_count: 0,
            analytics_ready: false,
            sample_capped: false,
            avg_price: null,
            dial_colors: [],
            identity_source: 'PREAGGREGATED_CATALOG_INDEX',
            evidence_resolution: 'EXACT_REFERENCE_ON_SELECTION',
          },
        ]));
        for (const item of out) merged.set(referenceKey(item.reference), item);
        out = [...merged.values()].sort((left, right) => (
          Number(right.listing_count || 0) - Number(left.listing_count || 0)
          || left.reference.localeCompare(right.reference)
        ));
      }
      const payload = {
        success: true,
        brand,
        model,
        reference_count: out.length,
        observed_listing_count: out.reduce((sum, item) => sum + item.listing_count, 0),
        eligible_observation_count: out.reduce((sum, item) => sum + item.eligible_observation_count, 0),
        references: out,
        identity_source: brand.toLowerCase() === 'tag heuer'
          ? 'CATALOG_PLUS_POSITIVE_OWNER_REVIEWED_WORKBOOK'
          : 'OWNER_REVIEWED_WORKBOOK',
        evidence_resolution: 'EXACT_REFERENCE_ON_SELECTION',
        sample_capped: false,
      };
      _cache.set(cacheKey, { at: Date.now(), payload });
      return res.status(200).json(payload);
    }
    if (!isPublicationBrandAllowed(brand)) {
      const { rows, truncated } = await loadReviewedWorkbookBrandRows(client, brand);
      if (!rows.length) return res.status(404).json({ error: 'Brand has no published reviewed listings' });
      if (truncated) return res.status(503).json({ error: 'Brand inventory is too large for safe reference browsing' });
      const out = summarizeReviewedWorkbookReferences(rows, model, false);
      const payload = {
        success: true,
        brand,
        model,
        reference_count: out.length,
        references: out,
        identity_source: 'OWNER_REVIEWED_WORKBOOK',
        sample_capped: false,
      };
      _cache.set(cacheKey, { at: Date.now(), payload });
      return res.status(200).json(payload);
    }
    if (brand.toLowerCase() === 'panerai') {
      const out = await loadReviewedPaneraiReferences(client, model);
      const payload = {
        success: true,
        brand: 'Panerai',
        model,
        reference_count: out.length,
        references: out,
        identity_source: 'OWNER_REVIEWED_WORKBOOK',
      };
      _cache.set(cacheKey, { at: Date.now(), payload });
      return res.status(200).json(payload);
    }
    if (brand.toLowerCase() === 'zenith') {
      // Browse identity comes from the canonical catalog. Market counts and
      // analytics are resolved only after an exact reference is selected, via
      // the bounded QNSA release RPC; never reuse the retired text-ID workbook
      // range or present catalog metadata as live market evidence.
      const out = listCanonicalCatalogReferences('Zenith', model).map(entry => ({
        reference: entry.reference,
        listing_count: 0,
        eligible_observation_count: 0,
        analytics_ready: false,
        sample_capped: false,
        avg_price: null,
        dial_colors: [],
        identity_source: 'PREAGGREGATED_CATALOG_INDEX',
        evidence_resolution: 'EXACT_REFERENCE_ON_SELECTION',
      }));
      const payload = {
        success: true,
        brand: 'Zenith',
        model,
        reference_count: out.length,
        references: out,
        identity_source: 'PREAGGREGATED_CATALOG_INDEX',
        evidence_resolution: 'EXACT_REFERENCE_ON_SELECTION',
        sample_capped: false,
      };
      _cache.set(cacheKey, { at: Date.now(), payload });
      return res.status(200).json(payload);
    }
    const catalogReferences = listCanonicalCatalogReferences(brand, model)
      .filter(entry => isPublicationReferenceAllowed(brand, entry.reference));

    // Catalog identity is metadata. Exact market evidence is resolved only
    // after selection; never manufacture one observation from catalog presence.
    const out = catalogReferences.map(entry => {
      return {
        reference: entry.reference,
        listing_count: 0,
        eligible_observation_count: 0,
        analytics_ready: false,
        sample_capped: false,
        avg_price: null,
        dial_colors: [],
        identity_source: 'PREAGGREGATED_CATALOG_INDEX',
        evidence_resolution: 'EXACT_REFERENCE_ON_SELECTION',
      };
    });

    const payload = {
      success: true,
      brand,
      model,
      reference_count: out.length,
      references: out,
      identity_source: 'PREAGGREGATED_CATALOG_INDEX',
      evidence_resolution: 'EXACT_REFERENCE_ON_SELECTION',
      sample_capped: false,
    };
    _cache.set(cacheKey, { at: Date.now(), payload });
    return res.status(200).json(payload);
  } catch (err) {
    console.error('[catalog-references] error:', err.message);
    return res.status(500).json({ error: 'Failed to load references', detail: err.message });
  }
};

module.exports.mergeVacheronReleaseReferences = mergeVacheronReleaseReferences;
