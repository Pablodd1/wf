/**
 * GET /api/catalog-models?brand=Rolex
 * Returns models for a brand, with REAL listing counts sourced directly from
 * the live watch_records table, not catalog.json.
 *
 * v4.7 fix (round 1): previously counted catalog.json dial-color VARIANT rows
 * as "listings" per model (massively wrong for brands like Richard Mille,
 * where catalog.model === catalog.reference).
 *
 * v4.7 fix (round 2): round 1 called /api/price-averages internally over
 * HTTP — caused a P0 usability regression (that endpoint's cache isn't
 * shared across Vercel's ephemeral instances, so a cold-instance hit meant
 * a full 1M+ row scan and a hard timeout — confirmed brand=Rolex hung
 * completely while brand=Richard Mille happened to hit a warm instance).
 *
 * Fix: query watch_records directly, scoped to ONLY the specific references
 * that exist for this brand in catalog.json via .in() — bounded, no
 * cross-function network hop, no full-table scan.
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
    const allRefs = Array.from(refToModel.keys());

    if (allRefs.length === 0) {
      return res.status(200).json({ success: true, brand, models: [] });
    }

    // Bounded, PARALLEL per-reference count queries — much faster than
    // paginating through the full brand+reference row set (which for
    // high-volume brands like Rolex/Datejust could mean dozens of
    // sequential round-trips and risk hitting Vercel's function timeout).
    // count(exact, head:true) only asks Postgres for a row count via the
    // (brand, reference) index — it never transfers row data.
    const client = getClient();
    const countByRef = {};
    const CONCURRENCY = 20;
    for (let i = 0; i < allRefs.length; i += CONCURRENCY) {
      const batch = allRefs.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(async (reference) => {
        const { count, error } = await client
          .from('watch_records')
          .select('id', { count: 'exact', head: true })
          .eq('brand', brand)
          .eq('reference', reference)
          .not('price_usd', 'is', null)
          .gt('price_usd', 0);
        if (error) return { reference, count: 0 };
        return { reference, count: count || 0 };
      }));
      for (const { reference, count } of results) {
        if (count > 0) countByRef[reference] = count;
      }
    }

    const models = new Map();
    for (const [reference, model] of refToModel.entries()) {
      const count = countByRef[reference] || 0;
      if (count === 0) continue; // skip refs with zero real listings
      if (!models.has(model)) {
        models.set(model, { model, listing_count: 0, reference_count: 0, refs: new Set() });
      }
      const m = models.get(model);
      m.listing_count += count;
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
