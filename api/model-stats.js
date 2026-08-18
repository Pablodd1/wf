/**
 * GET /api/model-stats?brand=Rolex&model=Datejust
 *
 * Per-model market stats for Price Research drill-down:
 *   - total listings, WTS count, WTB count
 *   - avg / median / min / max price (IQR-filtered, min-2 gate)
 *   - date range covered (first_seen → last_seen)
 *   - per-reference breakdown (only refs with >= 2 priced listings exposed)
 *
 * "min-2 exposure": any aggregate bucket (model or reference) is only
 * returned when backed by >= 2 real priced listings — matches the
 * Price Research min-bucket rule so no stat is shown on thin data.
 */
const { getClient } = require('./_lib/supabase');
const { setCorsHeaders } = require('./_lib/cors');
const { listCatalogReferences } = require('./_lib/catalog');
const {
  isReviewedWorkbookBrowseBrand,
  loadReviewedWorkbookBrandRows,
  rowModel,
} = require('./_lib/reviewed-workbook-browse.cjs');

const MIN_BUCKET = 2;
const SANITY_FLOOR = 500;

function stats(prices) {
  if (!prices.length) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
  const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
  return { avg, median, min: sorted[0], max: sorted[sorted.length - 1] };
}

function iqrFilter(prices) {
  if (prices.length < 4) return prices.filter(p => p >= SANITY_FLOOR);
  const sorted = [...prices].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lo = Math.max(q1 - 3.0 * iqr, SANITY_FLOOR);
  const hi = q3 + 3.0 * iqr;
  return sorted.filter(p => p >= lo && p <= hi);
}

function workbookModelStats(rows, model) {
  const modelRows = rows.filter(row => rowModel(row) === model);
  let wts = 0;
  let wtb = 0;
  const priced = [];
  for (const row of modelRows) {
    const listingType = String(row.listing_type || '').toUpperCase();
    if (listingType === 'WTB') {
      wtb += 1;
      continue;
    }
    if (listingType !== 'WTS') continue;
    wts += 1;
    const price = Number(row.verified_price_usd);
    const verified = row.has_verified_usd_price === true
      || ['SOURCE_EXPLICIT_USD_MATCH', 'EXPLICIT_SOURCE_FX_CONVERTED'].includes(row.price_evidence_status);
    if (verified && Number.isFinite(price) && price > 0) priced.push(price);
  }
  const cleaned = iqrFilter(priced);
  const dates = modelRows.map(row => row.posting_date).filter(Boolean).sort();
  return {
    success: true,
    total: modelRows.length,
    wts,
    wtb,
    priced_count: priced.length,
    stats: cleaned.length >= MIN_BUCKET ? stats(cleaned) : null,
    first_seen: dates[0] || null,
    last_seen: dates[dates.length - 1] || null,
    references: [],
    meta: {
      min_bucket: MIN_BUCKET,
      iqr_filter: true,
      iqr_multiplier: 3,
      identity_source: 'OWNER_REVIEWED_WORKBOOK',
    },
  };
}

module.exports = async function handler(req, res) {
  if (setCorsHeaders(res, req)) return;
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { brand, model } = req.query;
  if (!brand || !model) return res.status(400).json({ error: 'brand and model required' });

  try {
    const client = getClient();
    if (isReviewedWorkbookBrowseBrand(brand)) {
      const { rows, truncated } = await loadReviewedWorkbookBrandRows(client, brand);
      if (truncated) return res.status(503).json({ error: 'Brand inventory is too large for safe model statistics' });
      return res.status(200).json({ brand, model, ...workbookModelStats(rows, model) });
    }

    // ponytail: was fs.readFileSync(process.cwd()/public/catalog.json) —
    // crashed in the Vercel lambda (FUNCTION_INVOCATION_FAILED) because the
    // asset isn't reliably traced per-function. Route through _lib/catalog,
    // the same loader the (working) catalog-models endpoint uses.
    const modelLower = model.toLowerCase();
    const refs = listCatalogReferences(brand)
      .filter(e => e.model && e.model.toLowerCase() === modelLower)
      .map(e => e.reference);

    if (refs.length === 0) {
      return res.status(200).json({ success: true, brand, model, total: 0, references: [] });
    }

    // Pull priced rows for these refs in chunks (.in() has URL length limits)
    const CHUNK = 50;
    const rows = [];
    for (let i = 0; i < refs.length; i += CHUNK) {
      const chunk = refs.slice(i, i + CHUNK);
      const { data, error } = await client
        .from('watch_records')
        .select('reference, price_usd, created_at, listing_type, verdict')
        .eq('brand', brand)
        .in('reference', chunk)
        .not('verdict', 'eq', 'RECYCLE')
        .order('created_at', { ascending: true })
        .limit(20000);
      if (error) throw error;
      if (data) rows.push(...data);
    }

    if (rows.length === 0) {
      return res.status(200).json({ success: true, brand, model, total: 0, references: [] });
    }

    // Split WTS / WTB
    let wts = 0, wtb = 0;
    for (const r of rows) {
      if ((r.listing_type || '').toUpperCase() === 'WTB') wtb++;
      else wts++;
    }

    // Model-level price stats (WTS priced rows only, IQR-filtered)
    const priced = rows.filter(r => (r.listing_type || '').toUpperCase() !== 'WTB'
                                 && r.price_usd != null && r.price_usd > 0);
    const modelPrices = iqrFilter(priced.map(r => r.price_usd));
    const modelStats = modelPrices.length >= MIN_BUCKET ? stats(modelPrices) : null;

    // Date range
    const dates = rows.map(r => r.created_at).filter(Boolean).sort();
    const first_seen = dates[0] || null;
    const last_seen = dates[dates.length - 1] || null;

    // Per-reference breakdown with min-2 gate
    const byRef = {};
    for (const r of priced) {
      if (!byRef[r.reference]) byRef[r.reference] = { prices: [], dates: [] };
      byRef[r.reference].prices.push(r.price_usd);
      if (r.created_at) byRef[r.reference].dates.push(r.created_at);
    }
    const references = Object.entries(byRef)
      .filter(([, v]) => v.prices.length >= MIN_BUCKET)
      .map(([reference, v]) => {
        const cleaned = iqrFilter(v.prices);
        const s = stats(cleaned);
        const ds = v.dates.sort();
        return {
          reference,
          count: v.prices.length,
          avg_price: s?.avg || 0,
          median_price: s?.median || 0,
          min_price: s?.min || 0,
          max_price: s?.max || 0,
          first_seen: ds[0] || null,
          last_seen: ds[ds.length - 1] || null,
        };
      })
      .sort((a, b) => b.count - a.count);

    res.status(200).json({
      success: true,
      brand,
      model,
      total: rows.length,
      wts,
      wtb,
      priced_count: priced.length,
      stats: modelStats,
      first_seen,
      last_seen,
      references,
      meta: { min_bucket: MIN_BUCKET, iqr_filter: true },
    });
  } catch (err) {
    console.error('model-stats error:', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports.workbookModelStats = workbookModelStats;
