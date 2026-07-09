/**
 * GET /api/catalog-references?brand=Rolex&model=Daytona
 * Returns references for a brand+model, with REAL listing counts and average
 * prices sourced from the live watch_records database (via /api/price-averages),
 * not the static catalog.json.
 *
 * v4.7 fix: previously counted catalog.json dial-color VARIANT rows as
 * "listings" (e.g. 124300 showed "6 listings" — actually 6 catalog dial
 * entries — when the live DB has 1,000+ real records) and hardcoded
 * avg_price=0 unconditionally. catalog.json is now used ONLY for the
 * reference -> model name mapping; all counts/prices come from live data.
 */
const fs = require('fs');
const path = require('path');

let catalog = null;
function loadCatalog() {
  if (!catalog) {
    catalog = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'catalog.json'), 'utf-8'));
  }
  return catalog;
}

async function getPriceAverages(req) {
  // Reuse the already-cached /api/price-averages aggregation instead of
  // re-scanning watch_records here — keeps this endpoint fast (cache hit
  // is <200ms; cold start is the price-averages endpoint's own concern).
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const url = `${proto}://${host}/api/price-averages`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`price-averages fetch failed: ${r.status}`);
  return r.json();
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
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
    const refsInModel = new Set(entries.map(e => e.reference).filter(Boolean));

    // Live data gives us: real listing_count + avg_price per reference
    let averages = {};
    try {
      const pa = await getPriceAverages(req);
      averages = pa.averages || {};
    } catch (e) {
      console.error('catalog-references: price-averages fetch failed, falling back to catalog-only counts:', e.message);
    }

    const result = Array.from(refsInModel)
      .map(reference => {
        const key = `${brand}|${reference}`;
        const live = averages[key];
        return {
          reference,
          listing_count: live?.count ?? 0,
          avg_price: live?.avg ?? 0,
        };
      })
      // Only show references with real live listings — matches the page's
      // "every option is backed by actual watches" promise.
      .filter(r => r.listing_count > 0)
      .sort((a, b) => b.listing_count - a.listing_count);

    res.status(200).json({ success: true, brand, model, references: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
