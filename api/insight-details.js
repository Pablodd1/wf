/**
 * /api/insight-details.js
 *
 * Vercel serverless endpoint for outlier detection & duplicate analysis.
 * Full data pipeline: fetch records, detect duplicates, remove them,
 * detect outliers with IQR method, calculate stats at each stage.
 *
 * GET /api/insight-details?reference=52508&month=2026-03&dial=White
 *   Returns: { original, duplicates, filtered, outliers, records }
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

// ═══════════════════════════════════════════════════════════════════════════════
// DEMO DATA GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

function generateDemoRecords(reference, month, dial) {
  const brands = {
    '52508': 'Patek Philippe',
    '5711': 'Patek Philippe',
    '5167': 'Patek Philippe',
    '126710': 'Rolex',
    '116500': 'Rolex',
    '228238': 'Rolex',
    '15210': 'Audemars Piguet',
    '15500': 'Audemars Piguet',
  };
  const brand = brands[reference] || 'Patek Philippe';
  const basePrice = reference.startsWith('5') ? 45000 :
                     reference.startsWith('6') ? 350000 :
                     reference.startsWith('RM') ? 180000 :
                     reference.startsWith('152') || reference.startsWith('155') ? 35000 :
                     25000;
  const conditions = ['New', 'Like New', 'Excellent', 'Good'];
  const records = [];

  // Generate ~25 records with some intentional duplicates and outliers
  for (let i = 0; i < 25; i++) {
    const isDuplicate = i >= 20; // Last 5 are duplicates
    const isOutlier = i === 15 || i === 16; // 2 outliers

    let price = basePrice + (Math.random() - 0.5) * basePrice * 0.15;
    if (isDuplicate) {
      price = basePrice; // Same price for duplicates
    }
    if (isOutlier) {
      price = basePrice * (i === 15 ? 2.5 : 0.3); // Extreme outlier
    }

    records.push({
      id: `demo-${i}`,
      brand,
      reference,
      dial_color: dial || 'Black',
      condition: conditions[i % conditions.length],
      price_usd: Math.round(price),
      received_at: `${month}-01T00:00:00Z`,
      source: 'demo',
    });
  }

  return records;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DUPLICATE DETECTION ALGORITHM
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detect duplicates by grouping records with the same reference,
 * price (rounded to $100), and condition.
 * @param {Array} records
 * @returns {{ unique: Array, duplicates: Array }}
 */
function detectDuplicates(records) {
  const seen = new Map();
  const unique = [];
  const duplicates = [];

  for (const record of records) {
    const priceRounded = Math.round((record.price_usd || 0) / 100) * 100;
    const condition = record.condition || 'Unknown';
    const key = `${record.reference}-${priceRounded}-${condition}`;

    if (seen.has(key)) {
      duplicates.push(record);
    } else {
      seen.set(key, record);
      unique.push(record);
    }
  }

  return { unique, duplicates };
}

// ═══════════════════════════════════════════════════════════════════════════════
// OUTLIER DETECTION (IQR METHOD)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detect outliers using the Interquartile Range (IQR) method.
 * Values below Q1 - 1.5*IQR or above Q3 + 1.5*IQR are outliers.
 * @param {Array} records
 * @returns {{ clean: Array, outliers: Array }}
 */
function detectOutliers(records) {
  const prices = records
    .map(r => r.price_usd)
    .filter(p => typeof p === 'number' && p > 0)
    .sort((a, b) => a - b);

  if (prices.length < 4) {
    return { clean: records, outliers: [] };
  }

  const q1Idx = Math.floor(prices.length * 0.25);
  const q3Idx = Math.floor(prices.length * 0.75);
  const q1 = prices[q1Idx];
  const q3 = prices[q3Idx];
  const iqr = q3 - q1;
  const lower = Math.max(0, q1 - 1.5 * iqr);
  const upper = q3 + 1.5 * iqr;

  const clean = [];
  const outliers = [];

  for (const record of records) {
    const price = record.price_usd || 0;
    if (price >= lower && price <= upper) {
      clean.push(record);
    } else {
      outliers.push(record);
    }
  }

  return { clean, outliers };
}

// ═══════════════════════════════════════════════════════════════════════════════
// STATISTICS HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate statistics (count, min, avg, max) for a set of records.
 * @param {Array} records
 * @returns {{ count: number, min: number, avg: number, max: number }}
 */
function calcStats(records) {
  const prices = records
    .map(r => r.price_usd)
    .filter(p => typeof p === 'number' && p > 0);

  if (prices.length === 0) {
    return { count: 0, min: 0, avg: 0, max: 0 };
  }

  const sum = prices.reduce((a, b) => a + b, 0);
  return {
    count: prices.length,
    min: Math.min(...prices),
    avg: Math.round(sum / prices.length),
    max: Math.max(...prices),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CORS
// ═══════════════════════════════════════════════════════════════════════════════

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = async function handler(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const { reference, month, dial } = req.query;

  if (!reference || !month) {
    return res.status(400).json({
      error: 'Missing required params',
      required: ['reference', 'month'],
      received: { reference, month, dial },
    });
  }

  // ─── Validate month format (YYYY-MM) ────────────────────────────────────────
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: 'Invalid month format. Use YYYY-MM' });
  }

  let records = [];

  // ─── Demo data mode ─────────────────────────────────────────────────────────
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.warn('[insight-details] Supabase not configured — returning demo data');
    records = generateDemoRecords(reference, month, dial);
  } else {
    // ─── Fetch from Supabase ──────────────────────────────────────────────────
    try {
      const startDate = `${month}-01T00:00:00.000Z`;
      const endMonth = parseInt(month.slice(5, 7), 10);
      const endYear = parseInt(month.slice(0, 4), 10);
      const nextMonth = endMonth === 12
        ? `${endYear + 1}-01-01T00:00:00.000Z`
        : `${endYear}-${String(endMonth + 1).padStart(2, '0')}-01T00:00:00.000Z`;

      const dialFilter = dial ? `&dial_color=ilike.*${encodeURIComponent(dial)}*` : '';
      const url = `${SUPABASE_URL}/rest/v1/watch_records?select=id,brand,reference,dial_color,condition,price_usd,received_at,source,raw_message&reference=ilike.*${encodeURIComponent(reference)}*${dialFilter}&received_at=gte.${encodeURIComponent(startDate)}&received_at=lt.${encodeURIComponent(nextMonth)}&price_usd=gt.0&order=price_usd.asc`;

      const response = await fetch(url, { headers: HEADERS });

      if (!response.ok) {
        const errText = await response.text();
        console.error('[insight-details] Supabase error:', response.status, errText);
        return res.status(500).json({ error: 'Failed to fetch from database', detail: errText });
      }

      records = await response.json();

    } catch (err) {
      console.error('[insight-details] Fatal error:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // DATA PIPELINE
  // ═══════════════════════════════════════════════════════════════════════════════
  // Order: Original → Remove Duplicates → Remove Outliers → Filtered Stats
  // Outliers are REMOVED from the calculation but REPORTED separately

  // 1. Original stats (all records)
  const original = calcStats(records);

  // 2. Detect & remove duplicates
  const { unique: deduped, duplicates } = detectDuplicates(records);

  // 3. Detect outliers ON THE DEDUPED records
  const { clean, outliers } = detectOutliers(deduped);

  // 4. Filtered stats = calculated on CLEAN data (outliers EXCLUDED)
  const filtered = calcStats(clean);

  // 5. Also calculate "after duplicate removal, before outlier removal"
  //    for the pipeline visualization (not used for final stats)
  const dedupedStats = calcStats(deduped);

  // Format duplicate prices for display
  const dupPrices = duplicates.map(r => ({
    id: r.id,
    price_usd: r.price_usd,
    condition: r.condition,
    reference: r.reference,
  }));

  // Format outlier prices for display
  const outlierPrices = outliers.map(r => ({
    id: r.id,
    price_usd: r.price_usd,
    condition: r.condition,
    reference: r.reference,
  }));

  return res.status(200).json({
    original,
    duplicates: {
      count: duplicates.length,
      prices: dupPrices,
    },
    filtered,           // ← stats calculated on CLEAN data (no outliers)
    outliers: {
      count: outliers.length,
      prices: outlierPrices,
    },
    dedupedStats,       // ← stats after duplicate removal, before outlier removal
    cleanCount: clean.length,
    records,
    meta: {
      reference,
      month,
      dial: dial || null,
      total_records: records.length,
      clean_records: clean.length,
      demo: !SUPABASE_URL || !SUPABASE_KEY,
    },
  });
};
