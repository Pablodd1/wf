const { getClient } = require('./_lib/supabase');

// ─── Currency conversion (read-time for legacy DB records) ───────────────────
const HKD_RATE = 0.128;
const CURRENCY_RATES = {
  HKD: 0.128, EUR: 1.08, GBP: 1.27, CHF: 1.13,
  AED: 0.272, SGD: 0.74, JPY: 0.0066, CNY: 0.138,
};

function convertLegacyPrices(rows) {
  return (rows || []).map(r => {
    if (!r.price_usd || !r.raw_message) return r;
    // Skip records already converted at extract-time (Pass 2 sets currency='USD')
    if (r.currency && r.currency.toUpperCase() === 'USD') return r;
    const msg = r.raw_message;
    const hasHKD = /hkd|hk\$/i.test(msg);
    const hasK = /\d+[kK]/.test(msg);
    const priceTooLow = r.price_usd > 0 && r.price_usd < 5000;
    if (priceTooLow && hasHKD && !hasK) {
      // Extract the explicit HKD amount adjacent to an HKD token
      const hkdMatch = msg.match(/(\d[\d,]*)\s*hkd|hkd\s*(\d[\d,]*)/i);
      if (hkdMatch) {
        const rawPrice = parseInt((hkdMatch[1] || hkdMatch[2]).replace(/[,k]/gi, ''));
        // Only convert when stored price ≈ the raw HKD figure (i.e. HKD was stored as USD unconverted).
        // A genuine USD price that merely mentions HKD elsewhere won't match its own stored value.
        const storedMatchesRawHKD = Math.abs(rawPrice - r.price_usd) < 5;
        if (!isNaN(rawPrice) && rawPrice > 1000 && storedMatchesRawHKD) {
          return { ...r, price_usd: Math.round(rawPrice * HKD_RATE), _hkdConverted: true };
        }
      }
      // Fallback: HKD present, no explicit regex match. Only convert when the stored
      // value is implausibly small for a luxury watch (< $500) — a true unconverted
      // HKD figure. Genuine USD listings that merely mention HKD in body text are left
      // untouched; the IQR filter downstream handles any residual noise.
      if (r.price_usd < 500) {
        return { ...r, price_usd: Math.round(r.price_usd * HKD_RATE), _hkdConverted: true, _hkdFallback: true };
      }
    }
    return r;
  });
}

// ─── IQR outlier removal ──────────────────────────────────────────────────────
// SANITY_FLOOR guards against the negative-lower-fence problem: on high-variance
// references (e.g. Patek 5711/1A, IQR ~$100K) the IQR lower bound (Q1-1.5*IQR)
// goes negative, so zero low-side filtering happens and junk (unconverted HKD
// remnants, dealer shorthand like "$128") survives into the "clean" set. A real
// luxury watch never trades below $500, so we clamp the effective lower bound.
const SANITY_FLOOR = 500;
function removeOutliers(prices) {
  if (!prices || prices.length < 4) return prices.filter(p => p >= SANITY_FLOOR); // still floor-filter tiny sets
  const sorted = [...prices].sort((a, b) => a - b);
  const q1Idx = Math.floor(sorted.length * 0.25);
  const q3Idx = Math.floor(sorted.length * 0.75);
  const q1 = sorted[q1Idx];
  const q3 = sorted[q3Idx];
  const iqr = q3 - q1;
  const lowerBound = Math.max(q1 - 1.5 * iqr, SANITY_FLOOR);
  const upperBound = q3 + 1.5 * iqr;
  return sorted.filter(p => p >= lowerBound && p <= upperBound);
}

// ─── Median + quartile computation ───────────────────────────────────────────
function computeStats(prices) {
  if (!prices || prices.length === 0) return null;
  const sorted = [...prices].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
  const q1Idx = Math.floor(sorted.length * 0.25);
  const q3Idx = Math.floor(sorted.length * 0.75);
  const q1 = sorted[q1Idx];
  const q3 = sorted[q3Idx];
  const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
  return {
    count: prices.length,
    avg,
    median,
    q1,
    q3,
    iqr: q3 - q1,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    range: sorted[sorted.length - 1] - sorted[0],
  };
}

// ─── Min-5 filter for aggregation buckets ────────────────────────────────────
const MIN_BUCKET_SIZE = 5;

function aggregateWithMin5(rows, keyFn, labelKey) {
  const buckets = {};
  rows.forEach(r => {
    const key = keyFn(r);
    if (!key) return;
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(r);
  });

  return Object.entries(buckets)
    .filter(([, items]) => items.length >= MIN_BUCKET_SIZE)
    .map(([key, items]) => {
      const prices = items.map(r => r.price_usd).filter(p => p != null && p > 0);
      const cleaned = removeOutliers(prices);
      const stats = computeStats(cleaned);
      return {
        [labelKey]: key,
        count: items.length,
        cleaned_count: cleaned.length,
        avg_price: stats?.avg || 0,
        median_price: stats?.median || 0,
        q1: stats?.q1 || 0,
        q3: stats?.q3 || 0,
        min_price: stats?.min || 0,
        max_price: stats?.max || 0,
      };
    })
    .sort((a, b) => (b.count || 0) - (a.count || 0));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { brand, reference } = req.query;
  if (!brand || !reference) {
    return res.status(400).json({ error: 'brand and reference required' });
  }

  try {
    const client = getClient();

    // 1. Pull ALL records for this brand+reference (no verdict filter — analytics filters client-side)
    const { data: rows, error } = await client
      .from('price_research_verified_source')
      .select('price_usd, currency, created_at, condition, source, dial_color, raw_message, listing_type, verdict')
      .eq('brand', brand)
      .eq('reference', reference)
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!rows || rows.length === 0) {
      return res.status(200).json({
        brand,
        reference,
        count: 0,
        prices: [],
        monthly: [],
        dial_colors: [],
        conditions: [],
        buyers_sellers: { buyers: 0, sellers: 0 },
        stats: null,
        message: 'No records found'
      });
    }

    // 2. Convert legacy HKD prices
    const cleanRows = convertLegacyPrices(rows);

    // 3. Extract all prices + IQR outlier removal
    const allPrices = cleanRows.map(r => r.price_usd).filter(p => p != null && p > 0);
    const outlierRemoved = removeOutliers(allPrices);
    const outliersRemoved = allPrices.length - outlierRemoved.length;
    const stats = computeStats(outlierRemoved);

    // 4. Monthly aggregation with min-5 gate
    const monthlyMap = {};
    cleanRows.forEach(r => {
      if (!r.created_at || !r.price_usd) return;
      const d = new Date(r.created_at);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyMap[key]) monthlyMap[key] = { month: key, count: 0, prices: [], items: [] };
      monthlyMap[key].count++;
      monthlyMap[key].prices.push(r.price_usd);
      monthlyMap[key].items.push(r);
    });

    const monthly = Object.entries(monthlyMap)
      .filter(([, m]) => m.count >= MIN_BUCKET_SIZE)
      .map(([key, m]) => {
        const cleaned = removeOutliers(m.prices);
        const s = computeStats(cleaned);
        return {
          month: key,
          count: m.count,
          cleaned_count: cleaned.length,
          avg_price: s?.avg || 0,
          median_price: s?.median || 0,
          q1: s?.q1 || 0,
          q3: s?.q3 || 0,
          min_price: s?.min || 0,
          max_price: s?.max || 0,
        };
      })
      .sort((a, b) => a.month.localeCompare(b.month));

    // 5. Dial color aggregation with min-5 gate
    const dial_colors = aggregateWithMin5(cleanRows, r => r.dial_color, 'dial_color');

    // 6. Condition aggregation with min-5 gate
    const conditions = aggregateWithMin5(cleanRows, r => r.condition, 'condition');

    // 7. Buyers / Sellers split
    let buyers = 0, sellers = 0;
    cleanRows.forEach(r => {
      const lt = (r.listing_type || '').toUpperCase();
      const verdict = (r.verdict || '').toUpperCase();
      const msg = (r.raw_message || '').toLowerCase();
      if (lt === 'WTB' || msg.includes('wtb') || msg.includes('want to buy') || msg.includes('looking for')) {
        buyers++;
      } else {
        sellers++;
      }
    });

    // 8. Individual listings (max 200 for UI)
    const listings = cleanRows.slice(0, 200).map(r => ({
      price_usd: r.price_usd,
      created_at: r.created_at,
      dial_color: r.dial_color,
      raw_message: r.raw_message,
      condition: r.condition,
      source: r.source,
      verdict: r.verdict,
      listing_type: r.listing_type,
    }));

    res.status(200).json({
      brand,
      reference,
      count: cleanRows.length,
      filtered_count: outlierRemoved.length,
      outliers_removed: outliersRemoved,
      prices: outlierRemoved,
      monthly,
      dial_colors,
      conditions,
      buyers_sellers: { buyers, sellers },
      rows: listings,
      stats,
      meta: {
        min_bucket_size: MIN_BUCKET_SIZE,
        iqr_filter: true,
        currency_conversion: true,
      }
    });
  } catch (err) {
    console.error('Price research error:', err);
    res.status(500).json({ error: 'Failed to fetch from database', detail: err.message });
  }
};
