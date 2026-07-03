/**
 * GET /api/confidence-stats
 * Live verdict counts using estimated counts (Postgres planner statistics).
 * Fast — no full table scan, safe on 2.4M rows.
 * Falls back to cached static file if DB is unreachable.
 */
const fs = require('fs');
const path = require('path');
const { getClient } = require('./_lib/supabase');

const STATS_PATH = path.join(__dirname, '..', 'public', 'watchfacts-stats.json');
const VERDICTS = ['APPROVED', 'REVIEW', 'HUMAN', 'RECYCLE'];

// In-memory cache (per lambda instance) — refresh at most every 60s
let cache = null;
let cacheAt = 0;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  if (cache && Date.now() - cacheAt < 60_000) {
    return res.status(200).json(cache);
  }

  try {
    const client = getClient();
    const counts = {};
    let total = 0;

    await Promise.all(
      VERDICTS.map(async (v) => {
        const { count, error } = await client
          .from('watch_records')
          .select('id', { count: 'estimated', head: true })
          .eq('verdict', v);
        if (error) throw error;
        counts[v] = count || 0;
      })
    );

    total = VERDICTS.reduce((s, v) => s + counts[v], 0);

    const payload = {
      updatedAt: new Date().toISOString(),
      live: true,
      total,
      totalRecords: total,
      verdictCounts: counts,
    };

    cache = payload;
    cacheAt = Date.now();
    return res.status(200).json(payload);
  } catch (err) {
    // Fallback: static export file, marked as stale
    try {
      const stats = JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
      return res.status(200).json({ ...stats, live: false, stale: true });
    } catch {
      return res.status(200).json({
        live: false,
        stale: true,
        total: 2392784,
        totalRecords: 2392784,
        verdictCounts: { APPROVED: 1645727, REVIEW: 215409, HUMAN: 264315, RECYCLE: 267905 },
      });
    }
  }
};
