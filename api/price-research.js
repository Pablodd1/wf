/**
 * PRICE RESEARCH API — /api/price-research
 * Returns per-reference market analytics from the production DB.
 * Query: GET /api/price-research?reference=52506&brand=Rolex
 *        GET /api/price-research?reference=52506           (brand auto-resolved)
 */
const { getClient } = require('./_lib/supabase');
const { normRef, inferBrand: sharedInferBrand } = require('./_lib/resolve');
const { lookupCatalog } = require('./_lib/catalog');
const { buildComparableCohorts, classifyPrice, summarizePrices } = require('./_lib/market-stats.cjs');
const { normalizeMarketRow } = require('./_lib/market-row-normalization.cjs');

// Look up a human model name for a reference from the PROVEN file catalog
// (catalog.json + enriched_refs.json via _lib/catalog.js) — same path used live
// by /api/catalog-lookup. The Supabase cached_price_guide_watches table is empty
// for most brands, so we do NOT use it. Decoration only — never affects existence.
function lookupModel(reference, brand) {
  try {
    const hit = lookupCatalog(reference, brand || null);
    if (!hit || !hit.found) return null;
    const model = String(hit.model || '').trim();
    if (model && !/^(unknown|n\/a|unspecified|null)$/i.test(model)) return model;
    const collection = String(hit.collection || '').trim();
    if (collection && !/^(unknown|n\/a|unspecified|null)$/i.test(collection)) return collection;
    return null;
  } catch { return null; }
}

// Pull real liquidity indicators for a reference. Wrapped in try/catch because
// market_reference_indicators_current has never been queried by live code — if
// column names differ, we fall back to a live-derived count. REAL DATA ONLY:
// no invented seller/buyer numbers.
async function lookupLiquidity(client, reference, brand, listingCount) {
  const supplyDemand = await lookupSupplyDemand(client, reference, brand);
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
        supply_count: supplyDemand.supply_count,
        demand_count: supplyDemand.demand_count,
      };
    }
  } catch { /* fall through to live count */ }
  return {
    source: 'live_fallback',
    listing_count: listingCount,
    supply_count: supplyDemand.supply_count,
    demand_count: supplyDemand.demand_count,
    wtb_fs_ratio: supplyDemand.wtb_fs_ratio,
  };
}

// Counts are the most transparent supply/demand fallback: approved WTS rows
// are supply and approved WTB/NTQ rows are demand. Head/count avoids shipping
// records and keeps the query bounded to the exact reference.
async function lookupSupplyDemand(client, reference, brand) {
  try {
    const [supply, demand] = await Promise.all([
      client
        .from('watch_records')
        .select('id', { count: 'estimated', head: true })
        .eq('brand', brand)
        .eq('reference', reference)
        .eq('verdict', 'APPROVED')
        .eq('listing_type', 'WTS'),
      client
        .from('watch_records')
        .select('id', { count: 'estimated', head: true })
        .eq('brand', brand)
        .eq('reference', reference)
        .eq('verdict', 'APPROVED')
        .in('listing_type', ['WTB', 'NTQ']),
    ]);
    if (supply.error || demand.error) return { supply_count: null, demand_count: null, wtb_fs_ratio: null };
    const supplyCount = Number.isFinite(supply.count) ? supply.count : null;
    const demandCount = Number.isFinite(demand.count) ? demand.count : null;
    return {
      supply_count: supplyCount,
      demand_count: demandCount,
      wtb_fs_ratio: supplyCount != null && demandCount != null && supplyCount > 0
        ? Math.round((demandCount / supplyCount) * 100) / 100
        : null,
    };
  } catch {
    return { supply_count: null, demand_count: null, wtb_fs_ratio: null };
  }
}

function inferBrand(ref) {
  return sharedInferBrand(ref);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const rawRef = (req.query.reference || '').trim();
  let brand = (req.query.brand || '').trim();

  if (!rawRef) return res.status(400).json({ error: 'reference required' });

  // Auto-resolve brand if not provided
  if (!brand) {
    brand = inferBrand(rawRef);
    if (!brand) {
      return res.status(400).json({
        error: 'brand not found. Provide ?reference=52506&brand=Rolex',
        hint: 'Brand auto-resolve failed. Provide &brand= explicitly.'
      });
    }
  }

  try {
    const client = getClient();

    // Resolve reference — support prefix matching (3712 -> 3712/1A)
    let targetRef = rawRef;
    if (rawRef.length >= 3) {
      // Exact indexed lookup first. Prefix ILIKE over millions of rows is only
      // a fallback for genuinely partial references.
      const { data: exactRefs, error: exactRefError } = await client
        .from('watch_records')
        .select('reference')
        .eq('brand', brand)
        .eq('verdict', 'APPROVED')
        .eq('reference', rawRef)
        .limit(1);

      let refs = exactRefs;
      let refError = exactRefError;
      if (!exactRefError && (!exactRefs || exactRefs.length === 0)) {
        const prefixResult = await client
          .from('watch_records')
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
        const exact = foundRefs.find(r => normRef(r) === normRef(rawRef));
        if (exact) targetRef = exact;
        else if (foundRefs.length === 1) targetRef = foundRefs[0];
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
    const columns = 'id,price_raw,price_usd,currency,raw_message,created_at,listing_date,condition,source,dial_color,year,listing_type';
    const buildRowsQuery = (from, to) => client
      .from('watch_records')
      .select(columns)
      .eq('brand', brand)
      .eq('reference', targetRef)
      .eq('verdict', 'APPROVED')
      .eq('listing_type', 'WTS')
      .order('created_at', { ascending: false })
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
    const rows = sampledPages.flatMap(page => page.data || []);
    const totalListings = rows.length;

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
        cohorts: [], outliers: [], outlier_rows: [], outliersRemoved: 0, rawCount: 0,
        methodology: { method: 'IQR_1_5', minimum_sample: 5, included_count: 0, excluded_count: 0 },
        stats: null, liquidity: null, monthly: [], prices: [], rows: []
      });
    }

    // Exclude synthetic/test sources. mysql_auction_watches is historical market
    // evidence and must not be discarded from analytics.
    const excludedSources = new Set(['bulk_test_100', 'test_run', 'mysql_market_refs']);
    const marketRows = rows
      .filter(r => !excludedSources.has(r.source))
      .map(row => {
        const normalized = normalizeMarketRow(row, targetRef);
        return { ...normalized, stored_price_usd: row.price_usd, price_usd: normalized.analytics_price_usd };
      });
    const currencyCorrections = marketRows.filter(row => row.price_normalization).length;
    const isUnknownDial = value => {
      const normalized = String(value || '').trim().toUpperCase();
      return !normalized || ['UNKNOWN', 'UNSPECIFIED', 'N/A', 'NA', 'NONE', 'NULL', '-'].includes(normalized);
    };
    const unknownDialCount = marketRows.filter(row => isUnknownDial(row.dial_color)).length;

    const cohorts = buildComparableCohorts(marketRows);
    const requestedCondition = String(req.query.condition || '').trim().toLowerCase();
    const requestedDial = String(req.query.dial || '').trim().toLowerCase();
    const selectedCohort = cohorts.find(cohort =>
      (!requestedCondition || cohort.condition.toLowerCase() === requestedCondition)
      && (!requestedDial || cohort.dial_color.toLowerCase() === requestedDial)
    ) || cohorts[0] || { condition: 'Unspecified', dial_color: 'Unspecified', rows: [], count: 0 };
    const listedRows = selectedCohort.rows;

    // A deterministic safety floor runs before IQR. Otherwise a malformed low-
    // price cluster can make the IQR lower fence negative and contaminate every
    // market statistic. Catalog-relative bands are the next refinement.
    const preliminaryPrices = listedRows
      .map(row => Number(row.price_usd))
      .filter(value => Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);
    const preliminaryMedian = preliminaryPrices.length
      ? preliminaryPrices[Math.floor(preliminaryPrices.length / 2)]
      : 0;
    const marketPriceFloorUsd = Math.max(1000, Math.round(preliminaryMedian * 0.1));
    const validPriceRows = listedRows.filter(r => Number.isFinite(Number(r.price_usd)) && Number(r.price_usd) > 0);
    const rawPrices = validPriceRows
      .filter(r => Number(r.price_usd) >= marketPriceFloorUsd)
      .map(r => r.price_usd);
    const summary = summarizePrices(rawPrices);
    const prices = summary.included;
    const classifiedRows = listedRows.map(row => {
      const classification = classifyPrice(row.price_usd, summary.stats, { minimumPrice: marketPriceFloorUsd });
      return { ...row, is_outlier: !classification.included, outlier_reason: classification.reason };
    });
    const includedRows = classifiedRows.filter(row => !row.is_outlier && row.price_usd > 0);
    const outlierRows = classifiedRows.filter(row => row.is_outlier && row.outlier_reason !== 'INVALID_PRICE');

    // Monthly aggregation
    const monthlyMap = {};
    includedRows.forEach(r => {
      const observedAt = r.listing_date || r.created_at;
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

    // ── Dial analysis: EVERY dial color found in real listings (rule: all must show) ──
    const dialMap = {};
    includedRows.forEach(r => {
      const dial = r.dial_color || 'Unspecified';
      if (!dialMap[dial]) dialMap[dial] = { dial_color: dial, count: 0, sum: 0, min: Infinity, max: 0 };
      const d = dialMap[dial];
      d.count++; d.sum += r.price_usd;
      d.min = Math.min(d.min, r.price_usd);
      d.max = Math.max(d.max, r.price_usd);
    });
    const dial_analysis = Object.values(dialMap)
      .map(d => ({ dial_color: d.dial_color, count: d.count, avg_price: Math.round(d.sum / d.count), min_price: d.min, max_price: d.max }))
      .sort((a, b) => b.count - a.count);
    const dialColors = dial_analysis.map(d => d.dial_color);

    // ── Real model name (catalog decoration) + real liquidity (indicators, no phantom numbers) ──
    const model = lookupModel(targetRef, brand);
    const liquidity = await lookupLiquidity(client, targetRef, brand, marketRows.length);

    res.status(200).json({
      success: true, brand, reference: rawRef,
      resolvedRef: targetRef !== rawRef ? targetRef : null,
      model, dialColors,
      dial_analysis,
      dial_data_quality: {
        known_count: marketRows.length - unknownDialCount,
        unknown_count: unknownDialCount,
        completeness_percent: marketRows.length
          ? Math.round(((marketRows.length - unknownDialCount) / marketRows.length) * 1000) / 10
          : 0,
        status: unknownDialCount === 0 ? 'complete' : 'incomplete',
      },
      currency_data_quality: {
        corrected_count: currencyCorrections,
        status: currencyCorrections ? 'corrected_for_analytics' : 'as_stored',
      },
      totalListings,
      listing_count: marketRows.length,
      sampledListings: rows.length,
      sampleCapped: rows.length >= sampleLimit,
      count: prices.length,
      rawCount: validPriceRows.length,
      outliersRemoved: outlierRows.length,
      outliers: outlierRows.map(row => row.price_usd),
      outlier_rows: outlierRows.map(r => ({
        id: r.id, price_usd: r.price_usd, created_at: r.created_at, listing_date: r.listing_date,
        price_raw: r.price_raw, currency: r.currency, raw_price_text: r.price_evidence, raw_message: r.raw_message,
        dial_color: r.dial_color, condition: r.condition,
        source: r.source, year: r.year, is_outlier: true, outlier_reason: r.outlier_reason,
        stored_price_usd: r.stored_price_usd, price_normalization: r.price_normalization,
      })),
      analytics_ready: summary.analytics_ready,
      sample_quality: summary.sample_quality,
      stats: summary.stats,
      selected_cohort: {
        condition: selectedCohort.condition,
        dial_color: selectedCohort.dial_color,
        count: selectedCohort.count,
      },
      cohorts: cohorts.map(cohort => ({
        condition: cohort.condition,
        dial_color: cohort.dial_color,
        count: cohort.count,
      })),
      methodology: {
        method: 'PLAUSIBILITY_FLOOR_THEN_IQR_1_5',
        minimum_sample: 5,
        included_count: includedRows.length,
        excluded_count: outlierRows.length,
        plausibility_floor_usd: marketPriceFloorUsd,
        plausibility_excluded_count: outlierRows.filter(row => row.outlier_reason === 'BELOW_MARKET_PLAUSIBILITY_FLOOR').length,
        lower_fence: summary.stats?.lower_fence ?? null,
        upper_fence: summary.stats?.upper_fence ?? null,
      },
      liquidity,
      monthly, prices,
      rows: classifiedRows.map(r => ({
        id: r.id, price_usd: r.price_usd, created_at: r.created_at, listing_date: r.listing_date,
        price_raw: r.price_raw, currency: r.currency, raw_price_text: r.price_evidence, raw_message: r.raw_message,
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
