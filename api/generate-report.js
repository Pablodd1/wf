/**
 * /api/generate-report.js
 * =======================
 * v4.3: Production WTS/WTB report generator.
 *
 * Pulls watch_records from Supabase (never from local CSV), groups by
 * brand + verdict taxonomy, and returns structured JSON suitable for
 * Excel/TSV export. Runs serverlessly — no local machine dependency.
 *
 * Endpoints:
 *   POST /api/generate-report         → WTS summary (APPROVED + REVIEW + HUMAN)
 *   POST /api/generate-report?mode=wtb  → WTB summary (WTB signal records)
 *   POST /api/generate-report?mode=export&brand=Rolex → full export for one brand
 *
 * Cron-friendly: Deploy as a Vercel cron job for scheduled daily reports.
 *   Cron schedule: 0 2 * * * (2 AM daily — after overnight ingestion window)
 *   Cron path: /api/generate-report (POST, auto-run by Vercel cron)
 *
 * Query parameters:
 *   ?mode=summary  → grouped counts + price stats per brand (default)
 *   ?mode=wtb      → WTB-only signals, grouped by brand
 *   ?mode=export&brand=<BrandName> → full record dump for one brand (TSV-ready)
 *   ?mode=taxonomy → v4.3 verdict taxonomy distribution (NEEDS_MANUAL_REVIEW etc.)
 *   &limit=1000    → pagination cap (default 5000, max 10000)
 *   &offset=0      → pagination offset
 */
'use strict';

const { withRateLimit } = require('./_lib/rate-limiter');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ─── QUERY HELPERS ──────────────────────────────────────────────────────────
async function supabaseQuery(table, query, select = '*') {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  url.search = query;
  url.searchParams.set('select', select);
  
  const res = await fetch(url.toString(), {
    headers: { ...HEADERS, 'Prefer': 'return=representation' },
  });
  if (!res.ok) throw new Error(`Supabase query failed: ${res.status}`);
  return res.json();
}

/**
 * WTS summary: approved/review/human records, grouped by brand with counts + price stats.
 */
async function getWTSSummary(limit = 5000, offset = 0) {
  const url = `${SUPABASE_URL}/rest/v1/watch_records`;

  // Brand counts
  const brandRes = await fetch(
    `${url}?select=brand,verdict,price_usd,reference,confidence&verdict=in.(APPROVED,REVIEW,HUMAN)&listing_type=neq.WTB` +
    `&limit=${limit}&offset=${offset}&order=created_at.desc`,
    { headers: HEADERS }
  );
  if (!brandRes.ok) throw new Error(`Brand query failed: ${brandRes.status}`);
  const rows = await brandRes.json();

  // Group by brand
  const byBrand = {};
  const taxonomy = {};
  for (const row of rows) {
    const brand = row.brand || 'Unknown';
    if (!byBrand[brand]) byBrand[brand] = { count: 0, prices: [], records: [] };
    byBrand[brand].count++;
    if (row.price_usd != null) byBrand[brand].prices.push(row.price_usd);
    byBrand[brand].records.push(row);
    
    taxonomy[row.verdict] = (taxonomy[row.verdict] || 0) + 1;
  }

  // Build brand summaries with price stats
  const brandSummaries = Object.entries(byBrand)
    .map(([brand, data]) => {
      const prices = data.prices;
      const sorted = [...prices].sort((a, b) => a - b);
      return {
        brand,
        count: data.count,
        avgPrice: prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null,
        medianPrice: prices.length > 0 ? sorted[Math.floor(sorted.length / 2)] : null,
        minPrice: prices.length > 0 ? sorted[0] : null,
        maxPrice: prices.length > 0 ? sorted[sorted.length - 1] : null,
      };
    })
    .sort((a, b) => b.count - a.count);

  return {
    total: rows.length,
    brands: brandSummaries.length,
    taxonomy,
    byBrand: brandSummaries,
  };
}

/**
 * v4.3 taxonomy distribution — NEEDS_MANUAL_REVIEW, MULTI_WATCH_STOCK_LIST, etc.
 */
async function getTaxonomyDistribution(limit = 5000) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/watch_records?select=verdict` +
    `&verdict=in.(NEEDS_MANUAL_REVIEW,MULTI_WATCH_STOCK_LIST,ACCESSORY_NOT_WATCH,WRONG_BRAND_SUSPECT,NON_WATCH_OR_WRONG_CATEGORY,REVIEW,HUMAN,RECYCLE)` +
    `&limit=${limit}`,
    { headers: { ...HEADERS, 'Prefer': 'count=exact' } }
  );
  const data = await res.json();
  const counts = {};
  for (const row of data) {
    counts[row.verdict] = (counts[row.verdict] || 0) + 1;
  }
  return { total: data.length, counts };
}

/**
 * Full export for one brand — returns all records TSV-ready.
 */
async function getBrandExport(brand, limit = 5000, offset = 0) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/watch_records?select=id,raw_message,brand,reference,dial_color,condition,year,price_usd,currency,confidence,verdict,review_reason,listing_type,created_at` +
    `&brand=eq.${encodeURIComponent(brand)}&limit=${limit}&offset=${offset}&order=created_at.desc`,
    { headers: HEADERS }
  );
  if (!res.ok) throw new Error(`Export query failed: ${res.status}`);
  return res.json();
}

// ─── MAIN HANDLER ──────────────────────────────────────────────────────────
const handler = async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'POST or GET only' });
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const mode = url.searchParams.get('mode') || 'summary';
  const brand = url.searchParams.get('brand');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '5000'), 10000);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  try {
    if (mode === 'taxonomy') {
      const taxonomy = await getTaxonomyDistribution(limit);
      return res.status(200).json({
        generated_at: new Date().toISOString(),
        parser_version: 'v4.3',
        mode: 'taxonomy',
        ...taxonomy,
      });
    }

    if (mode === 'wtb') {
      // WTB signals — separate patterns (built later per Jasmel's instruction)
      return res.status(200).json({
        generated_at: new Date().toISOString(),
        parser_version: 'v4.3',
        mode: 'wtb',
        status: 'pending',
        note: 'WTB report patterns being finalized — will follow after WTS reports complete.',
      });
    }

    if (mode === 'export' && brand) {
      const records = await getBrandExport(brand, limit, offset);
      return res.status(200).json({
        generated_at: new Date().toISOString(),
        parser_version: 'v4.3',
        mode: 'export',
        brand,
        count: records.length,
        records,
      });
    }

    // Default: WTS summary
    const summary = await getWTSSummary(limit, offset);
    return res.status(200).json({
      generated_at: new Date().toISOString(),
      parser_version: 'v4.3',
      mode: 'summary',
      ...summary,
    });

  } catch (e) {
    console.error('[generate-report] Error:', e.message);
    return res.status(500).json({
      generated_at: new Date().toISOString(),
      parser_version: 'v4.3',
      error: e.message,
    });
  }
};

module.exports = withRateLimit('/api/generate-report', handler);
