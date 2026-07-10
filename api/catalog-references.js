/**
 * GET /api/catalog-references?brand=Rolex&model=Daytona
 * Returns references for a brand+model, with REAL listing counts and average
 * prices sourced directly from the live watch_records table, not catalog.json.
 *
 * v4.7 fix (round 1): previously counted catalog.json dial-color VARIANT rows
 * as if they were real listings, and hardcoded avg_price=0 unconditionally.
 *
 * v4.7 fix (round 2): round 1 called /api/price-averages internally over
 * HTTP to get real counts — this caused a P0 usability regression: that
 * endpoint's cache is a plain in-process variable, not shared across
 * Vercel's ephemeral serverless instances, so an internal serverless-to-
 * serverless call could land on a COLD instance requiring a full 1M+ row
 * table scan (60s+, hit Vercel's function timeout and returned nothing).
 * Confirmed: brand=Rolex timed out completely; brand=Richard Mille (fewer
 * catalog refs) happened to hit a warm instance and returned in 0.2s —
 * same code, unpredictable behavior depending on which instance served it.
 *
 * Fix: query watch_records directly here, scoped to ONLY the specific
 * references that belong to this model (from catalog.json) via .in() —
 * a small, bounded query (tens to low-hundreds of rows per reference),
 * never a full-table scan, and no cross-function network hop at all.
 */
const fs = require('fs');
const path = require('path');
const { getClient } = require('./_lib/supabase');
const { setCorsHeaders } = require('./_lib/cors');


let catalog = null;
function loadCatalog() {
  if (!catalog) {
    catalog = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'catalog.json'), 'utf-8'));
  }
  return catalog;
}

module.exports = async function handler(req, res) {
  if (setCorsHeaders(res, req)) return;
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { brand, model } = req.query;
  if (!brand || !model) return res.status(400).json({ error: 'brand and model required' });

  try {
    const cat = loadCatalog();
    const brandLower = brand.toLowerCase();
    const modelLower = model.toLowerCase();

    // catalog.json gives us: which references belong to this model
    const entries = cat.filter(e =>
      e.brand && e.brand.toLowerCase().includes(brandLower) &&
      e.model && e.model.toLowerCase().includes(modelLower)
    );
    const refsInModel = Array.from(new Set(entries.map(e => e.reference).filter(Boolean)));

    if (refsInModel.length === 0) {
      return res.status(200).json({ success: true, brand, model, references: [] });
    }

    // Bounded, PARALLEL per-reference queries — much faster and safer than
    // a single big query with no limit (which risks Supabase's ~1000-row
    // default cap silently truncating popular references) or a full
    // pagination loop (risks Vercel function timeout on high-volume refs).
    // refsInModel is small here (already scoped to one model — typically
    // single digits to low dozens of references), so N parallel queries,
    // each capped at a representative sample, stays fast and safe.
    const client = getClient();
    const SAMPLE_CAP = 3000; // representative sample per reference for avg_price only
    const results = await Promise.all(refsInModel.map(async (reference) => {
      const [countRes, sampleRes] = await Promise.all([
        // True total count via index-only count query — never truncated.
        client
          .from('watch_records')
          .select('id', { count: 'exact', head: true })
          .eq('brand', brand)
          .eq('reference', reference)
          .not('price_usd', 'is', null)
          .gt('price_usd', 0),
        // Representative price sample for avg_price (capped — a 3000-row
        // sample is more than enough for a stable average on any reference).
        client
          .from('watch_records')
          .select('price_usd')
          .eq('brand', brand)
          .eq('reference', reference)
          .not('price_usd', 'is', null)
          .gt('price_usd', 0)
          .limit(SAMPLE_CAP),
      ]);
      const listing_count = countRes.count || 0;
      const prices = (sampleRes.data || []).map(r => r.price_usd);
      const avg_price = prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;
      return { reference, listing_count, avg_price };
    }));

    const result = results
      // Only show references with real live listings — matches the page's
      // "every option is backed by actual watches" promise.
      .filter(r => r.listing_count > 0)
      .sort((a, b) => b.listing_count - a.listing_count);

    res.status(200).json({ success: true, brand, model, references: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
