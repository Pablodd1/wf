/**
 * GET /api/catalog-summary
 * Returns brand → reference → dial_color → { avg_price, count, min_year, max_year }
 * v4.10: rewritten from MySQL db.query to Supabase client (MySQL john@% 500 fix).
 * Uses cursor-based pagination on id to avoid timeouts.
 * Caches for 5 minutes in-memory.
 */
const { getClient } = require('./_lib/supabase');
const { setCorsHeaders } = require('./_lib/cors');


// In-memory cache
let cache = null;
let cacheAt = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const BATCH_SIZE = 1000;

module.exports = async function handler(req, res) {
  if (setCorsHeaders(res, req)) return;
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  // Return cached response if fresh
  if (cache && Date.now() - cacheAt < CACHE_TTL) {
    return res.status(200).json(cache);
  }

  try {
    const client = getClient();
    if (!client) {
      return res.status(500).json({ error: 'Database client not available' });
    }

    // Step 1: Get total count + id range
    const { count, error: countErr } = await client
      .from('watch_records')
      .select('id', { count: 'exact', head: true });

    if (countErr) throw countErr;
    const total = count || 0;

    if (total === 0) {
      return res.status(200).json({
        generated_at: new Date().toISOString(),
        total_records: 0,
        summary: [],
      });
    }

    // Step 2: Cursor-based pagination
    const aggregation = {};
    let cursor = 0;
    let batchesProcessed = 0;
    const MAX_BATCHES = 2500;

    while (batchesProcessed < MAX_BATCHES) {
      const { data: batch, error: batchErr } = await client
        .from('watch_records')
        .select('id, brand, reference, dial_color, price_usd, year')
        .gt('id', cursor)
        .not('brand', 'is', null)
        .not('reference', 'is', null)
        .order('id', { ascending: true })
        .limit(BATCH_SIZE);

      if (batchErr) throw batchErr;
      if (!batch || batch.length === 0) break;

      for (const row of batch) {
        const dial = row.dial_color || 'Unknown';
        const key = `${row.brand}||${row.reference}||${dial}`;

        if (!aggregation[key]) {
          aggregation[key] = {
            brand: row.brand,
            reference: row.reference,
            dial_color: dial,
            sum_price: 0,
            count: 0,
            min_year: Infinity,
            max_year: -Infinity,
          };
        }

        const acc = aggregation[key];
        if (row.price_usd != null && row.price_usd > 0) {
          acc.sum_price += row.price_usd;
        }
        acc.count += 1;

        if (row.year != null) {
          const yr = parseInt(row.year, 10);
          if (!isNaN(yr)) {
            if (yr < acc.min_year) acc.min_year = yr;
            if (yr > acc.max_year) acc.max_year = yr;
          }
        }
      }

      // Advance cursor to last id in this batch
      cursor = batch[batch.length - 1].id;
      batchesProcessed++;

      // If we got fewer than BATCH_SIZE rows, we've reached the end
      if (batch.length < BATCH_SIZE) break;
    }

    // Step 3: Build summary array
    const summary = Object.values(aggregation).map((a) => ({
      brand: a.brand,
      reference: a.reference,
      dial_color: a.dial_color,
      avg_price: a.count > 0 ? Math.round(a.sum_price / a.count) : 0,
      count: a.count,
      min_year: a.min_year === Infinity ? null : a.min_year,
      max_year: a.max_year === -Infinity ? null : a.max_year,
    }));

    // Sort: brand asc → reference asc → dial_color asc
    summary.sort((a, b) => {
      const brandCmp = a.brand.localeCompare(b.brand);
      if (brandCmp !== 0) return brandCmp;
      const refCmp = a.reference.localeCompare(b.reference);
      if (refCmp !== 0) return refCmp;
      return a.dial_color.localeCompare(b.dial_color);
    });

    const payload = {
      generated_at: new Date().toISOString(),
      total_records: total,
      batches_processed: batchesProcessed,
      summary_count: summary.length,
      summary,
    };

    // Cache
    cache = payload;
    cacheAt = Date.now();

    return res.status(200).json(payload);
  } catch (err) {
    console.error('Catalog summary error:', err.message);
    res.setHeader('Cache-Control', 'no-cache');
    return res.status(500).json({ error: err.message });
  }
};
