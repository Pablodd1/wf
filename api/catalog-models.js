/**
 * GET /api/catalog-models?brand=Rolex
 * Returns models for a brand, with REAL listing counts sourced from the live
 * watch_records database (via /api/price-averages), not catalog.json.
 *
 * v4.7 fix: previously counted catalog.json dial-color VARIANT rows as
 * "listings" per model (massively wrong for brands like Richard Mille, where
 * catalog.model === catalog.reference, producing 141 near-duplicate
 * "1 listing" model entries that are actually single references, not model
 * families). catalog.json is now used ONLY for the reference -> model name
 * mapping; all counts come from live data, and models with zero real
 * listings are dropped instead of cluttering the picker.
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

  const { brand } = req.query;
  if (!brand) return res.status(400).json({ error: 'brand required' });

  try {
    const cat = loadCatalog();
    const brandLower = brand.toLowerCase();

    // catalog.json gives us: reference -> model name mapping
    const entries = cat.filter(e => e.brand && e.brand.toLowerCase().includes(brandLower));
    const refToModel = new Map();
    for (const e of entries) {
      if (e.reference && e.model && !refToModel.has(e.reference)) {
        refToModel.set(e.reference, e.model);
      }
    }

    // Live data gives us: real listing_count per reference
    let averages = {};
    try {
      const pa = await getPriceAverages(req);
      averages = pa.averages || {};
    } catch (e) {
      console.error('catalog-models: price-averages fetch failed:', e.message);
    }

    // Group live-listed references by their catalog model name
    const models = new Map();
    for (const [reference, model] of refToModel.entries()) {
      const key = `${brand}|${reference}`;
      const live = averages[key];
      if (!live || !live.count) continue; // skip refs with zero real listings
      if (!models.has(model)) {
        models.set(model, { model, listing_count: 0, reference_count: 0, refs: new Set() });
      }
      const m = models.get(model);
      m.listing_count += live.count;
      m.refs.add(reference);
      m.reference_count = m.refs.size;
    }

    const result = Array.from(models.values())
      .map(({ refs, ...m }) => m)
      .sort((a, b) => b.listing_count - a.listing_count);

    res.status(200).json({ success: true, brand, models: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
