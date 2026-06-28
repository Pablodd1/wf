/**
 * /api/price-research.js
 *
 * Vercel serverless endpoint for monthly price aggregation.
 * Returns monthly aggregated price data for charts.
 *
 * GET /api/price-research?reference=52508&dial=White&months=6
 *   Returns: { data: [{ month, count, avg_price, min_price, max_price }] }
 *
 * Supports demo data mode for development when Supabase is not configured.
 */

'use strict';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const HEADERS = {
  'apikey': SUPABASE_KEY || '',
  'Authorization': `Bearer ${SUPABASE_KEY || ''}`,
  'Content-Type': 'application/json',
};

// ─── DEMO DATA ────────────────────────────────────────────────────────────────

function generateDemoData(reference, dial, months) {
  const data = [];
  const now = new Date();
  const monthCount = parseInt(months, 10) || 6;
  const basePrice = reference.startsWith('5') ? 45000 :
                     reference.startsWith('6') ? 350000 :
                     reference.startsWith('RM') ? 180000 :
                     reference.startsWith('152') || reference.startsWith('155') ? 35000 :
                     25000;

  for (let i = monthCount - 1; i >= 0; i--) {
    const month = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const count = Math.floor(Math.random() * 20) + 5;
    const seasonality = Math.sin((month.getMonth() / 12) * Math.PI * 2) * 0.05;
    const trend = (monthCount - i) * basePrice * 0.005;
    const avgPrice = Math.round(basePrice + trend + seasonality * basePrice + (Math.random() - 0.5) * basePrice * 0.1);
    const minPrice = Math.round(avgPrice * (0.85 + Math.random() * 0.1));
    const maxPrice = Math.round(avgPrice * (1.1 + Math.random() * 0.15));

    data.push({
      month: month.toISOString().slice(0, 7) + '-01T00:00:00Z',
      count,
      avg_price: avgPrice,
      min_price: minPrice,
      max_price: maxPrice,
    });
  }

  return data;
}

// ─── CORS ─────────────────────────────────────────────────────────────────────

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ─── HANDLER ──────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const { reference, dial, months = '6' } = req.query;

  if (!reference) {
    return res.status(400).json({ error: 'Missing required param: reference' });
  }

  // Demo data mode: Supabase not configured
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('[price-research] Supabase not configured — returning demo data');
    return res.status(200).json({
      data: generateDemoData(reference, dial, months),
      demo: true,
    });
  }

  // Calculate date range
  const now = new Date();
  const startDate = new Date();
  startDate.setMonth(now.getMonth() - parseInt(months, 10));
  const startDateStr = startDate.toISOString();

  try {
    // Build the query — use Supabase REST with ilike filters
    // We fetch raw records and aggregate client-side to avoid RPC dependency
    const dialFilter = dial ? `&dial_color=ilike.*${encodeURIComponent(dial)}*` : '';
    const url = `${SUPABASE_URL}/rest/v1/watch_records?select=price_usd,received_at&reference=ilike.*${encodeURIComponent(reference)}*${dialFilter}&received_at=gte.${encodeURIComponent(startDateStr)}&price_usd=gt.0&order=received_at.asc`;

    const response = await fetch(url, { headers: HEADERS });

    if (!response.ok) {
      const errText = await response.text();
      console.error('[price-research] Supabase error:', response.status, errText);
      return res.status(500).json({ error: 'Failed to fetch from database', detail: errText });
    }

    const records = await response.json();

    // ─── Monthly aggregation (client-side grouping) ────────────────────────────
    const monthlyMap = new Map();

    for (const record of records) {
      if (!record.received_at || !record.price_usd || record.price_usd <= 0) continue;

      const monthKey = record.received_at.slice(0, 7); // 'YYYY-MM'
      if (!monthlyMap.has(monthKey)) {
        monthlyMap.set(monthKey, {
          month: monthKey + '-01T00:00:00Z',
          prices: [],
          count: 0,
        });
      }

      const bucket = monthlyMap.get(monthKey);
      bucket.prices.push(record.price_usd);
      bucket.count++;
    }

    // Sort by month and compute stats
    const sortedKeys = Array.from(monthlyMap.keys()).sort();
    const data = sortedKeys.map(key => {
      const bucket = monthlyMap.get(key);
      const prices = bucket.prices;
      const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

      return {
        month: bucket.month,
        count: bucket.count,
        avg_price: Math.round(avg),
        min_price: Math.min(...prices),
        max_price: Math.max(...prices),
      };
    });

    return res.status(200).json({
      data,
      meta: {
        reference,
        dial: dial || null,
        months: parseInt(months, 10),
        total_records: records.length,
      },
    });

  } catch (err) {
    console.error('[price-research] Fatal error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
