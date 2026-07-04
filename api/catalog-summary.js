/**
 * GET /api/catalog-summary
 * Returns brand → reference → dial_color → { avg_price, count, min_year, max_year }
 * Uses cursor-based pagination on id to avoid Supabase/MySQL 57014 timeouts.
 * Processes in batches of 1000, aggregates client-side, caches for 5 minutes.
 */
const db = require('./_lib/db');

// In-memory cache
let cache = null;
let cacheAt = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const BATCH_SIZE = 1000;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  // Return cached response if fresh
  if (cache && Date.now() - cacheAt < CACHE_TTL) {
    return res.status(200).json(cache);
  }

  try {
    // Step 1: Get min/max id to know the range
    const rangeRows = await db.query(`
      SELECT MIN(id) as min_id, MAX(id) as max_id, COUNT(*) as total
      FROM watch_records
    `);
    const { min_id, max_id, total } = rangeRows[0];

    if (!min_id || !max_id) {
      return res.status(200).json({
        generated_at: new Date().toISOString(),
        total_records: 0,
        summary: [],
      });
    }

    // Step 2: Cursor-based pagination — iterate through id ranges
    const aggregation = {}; // key: "brand||ref||dial" → accumulator

    let cursor = min_id;
    let batchesProcessed = 0;

    while (cursor <= max_id) {
      const batchEnd = cursor + BATCH_SIZE - 1;

      const rows = await db.query(
        `SELECT id, brand, reference, dial_color, price_usd, year
         FROM watch_records
         WHERE id >= ? AND id <= ?
           AND brand IS NOT NULL
           AND reference IS NOT NULL
         ORDER BY id`,
        [cursor, batchEnd]
      );

      for (const row of rows) {
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

      cursor = batchEnd + 1;
      batchesProcessed++;

      // Safety: cap at 2500 batches (2.5M rows with 1000 batch size)
      if (batchesProcessed > 2500) break;
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
