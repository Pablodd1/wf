/**
 * PRICE RESEARCH API — /api/price-research
 * 
 * NOW POWERED BY SUPABASE — queries 117K+ records dynamically.
 * Works for ANY reference, not just 6 hardcoded ones.
 *
 * GET /api/price-research?reference=126334
 * Returns: brand, model, dial colors, pricing stats, chart, listings, forecast
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const RATES = {
  USD: 1.0, USDT: 1.0, HKD: 0.128, EUR: 1.08,
  GBP: 1.27, CHF: 1.13, SGD: 0.74, AUD: 0.65,
  CAD: 0.73, JPY: 0.0066, CNY: 0.138, RMB: 0.138,
};

function toUSD(amount, currency) {
  const rate = RATES[(currency || 'USD').toUpperCase()] || 1.0;
  return Math.round(amount * rate);
}

// Brand inference from reference
function inferBrand(ref) {
  if (!ref) return 'Unknown';
  const r = ref.toUpperCase();
  if (/^RM\d{2}/.test(r)) return 'Richard Mille';
  if (/^[345]\d{3}/.test(r)) return 'Patek Philippe';
  if (/^\d{5}[A-Z]{2,5}/.test(r)) return 'Audemars Piguet';
  if (/^\d{6}[A-Z]{0,5}/.test(r)) return 'Rolex';
  if (/^PAM\d/.test(r)) return 'Panerai';
  if (/^IW\d{6}/.test(r)) return 'IWC';
  if (/^RDDB/.test(r) || /^WHCH/.test(r)) return 'Cartier';
  if (/^\d{3}\.\d{3}/.test(r)) return 'A. Lange & Söhne';
  return 'Unknown';
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = new URL(req.url, `http://${req.headers.host}`);
  const reference = url.searchParams.get('reference');
  if (!reference) return res.status(400).json({ error: 'reference required' });
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  try {
    const headers = {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    };

    // Query watch_records for this reference
    const supaResp = await fetch(
      `${SUPABASE_URL}/rest/v1/watch_records?reference=eq.${encodeURIComponent(reference)}&limit=1000&order=created_at.desc`,
      { headers }
    );

    if (!supaResp.ok) {
      return res.status(500).json({ error: 'Database query failed', status: supaResp.status });
    }

    const rows = await supaResp.json();

    if (!rows || rows.length === 0) {
      return res.status(200).json({
        success: false,
        reference,
        error: `No data found for reference "${reference}". Try: 126334, 5711/1A, 116610LV, RM07-01`,
      });
    }

    // Transform rows into listings
    const brand = rows[0].brand || inferBrand(reference);
    const listings = rows.map(r => {
      const priceUSD = r.price_usd || toUSD(r.price_raw || 0, r.currency);
      return {
        title: r.raw_message || '',
        price: r.price_raw || 0,
        currency: r.currency || 'USD',
        priceUSD,
        dial: r.dial_color || 'Unknown',
        date: (r.created_at || '').substring(0, 10),
        year: r.year,
        condition: r.condition || 'Unknown',
        confidence: r.confidence || 0,
        verdict: r.verdict || 'UNKNOWN',
      };
    });

    // Filter to APPROVED + HUMAN verdicts (exclude RECYCLE)
    const validListings = listings.filter(l => l.verdict !== 'RECYCLE' && l.priceUSD > 0);

    if (validListings.length === 0) {
      return res.status(200).json({
        success: false,
        reference,
        brand,
        error: `Reference "${reference}" exists but has no valid price data.`,
      });
    }

    // Compute price stats with IQR outlier removal
    const prices = validListings.map(l => l.priceUSD).sort((a, b) => a - b);
    const q1 = prices[Math.floor(prices.length * 0.25)];
    const q3 = prices[Math.floor(prices.length * 0.75)];
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;
    const filteredPrices = prices.filter(p => p >= lowerBound && p <= upperBound);
    const outlierPrices = prices.filter(p => p < lowerBound || p > upperBound);

    // Dial colors
    const dialSet = [...new Set(validListings.map(l => l.dial))].filter(d => d && d !== 'Unknown');

    // Build monthly chart from year field
    const monthMap = {};
    validListings.forEach(l => {
      const y = l.year;
      if (!y) return;
      const monthKey = String(y);
      if (!monthMap[monthKey]) monthMap[monthKey] = [];
      monthMap[monthKey].push(l.priceUSD);
    });

    const chart = Object.keys(monthMap).sort().map(month => {
      const ps = monthMap[month].sort((a, b) => a - b);
      return {
        month,
        min: ps[0],
        avg: Math.round(ps.reduce((a, b) => a + b, 0) / ps.length),
        max: ps[ps.length - 1],
        count: ps.length,
      };
    });

    // Compute forecast (linear regression)
    const forecast = chart.length >= 2 ? computeForecast(chart) : null;

    // Detect duplicates
    const priceCounts = {};
    prices.forEach(p => { priceCounts[p] = (priceCounts[p] || 0) + 1; });
    const dupCount = Object.values(priceCounts).filter(c => c > 1).length;

    // Confidence scoring
    const avgConfidence = Math.round(
      validListings.reduce((s, l) => s + (l.confidence || 0), 0) / validListings.length
    );

    return res.status(200).json({
      success: true,
      reference,
      brand,
      model: `${brand} ${reference}`,
      dialColors: dialSet.length > 0 ? dialSet : ['Unknown'],
      primaryDial: dialSet[0] || 'Unknown',
      liquidity: {
        fsCount: validListings.length,
        buyers: 0,
        sellers: validListings.length,
        buyerSellerRatio: 0,
      },
      pricing: {
        current: {
          min: filteredPrices[0] || prices[0],
          avg: filteredPrices.length > 0
            ? Math.round(filteredPrices.reduce((a, b) => a + b, 0) / filteredPrices.length)
            : Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
          max: filteredPrices[filteredPrices.length - 1] || prices[prices.length - 1],
          count: filteredPrices.length || prices.length,
        },
      },
      chart: chart.length > 0 ? chart : [{ month: 'N/A', min: 0, avg: 0, max: 0, count: 0 }],
      forecast,
      listings: validListings.slice(0, 50),
      statsBefore: {
        min: prices[0],
        avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
        max: prices[prices.length - 1],
        count: prices.length,
      },
      statsAfter: {
        min: filteredPrices[0] || prices[0],
        avg: filteredPrices.length > 0
          ? Math.round(filteredPrices.reduce((a, b) => a + b, 0) / filteredPrices.length)
          : Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
        max: filteredPrices[filteredPrices.length - 1] || prices[prices.length - 1],
        count: filteredPrices.length || prices.length,
      },
      duplicates: dupCount,
      outliers: outlierPrices.length,
      avgConfidence,
      totalListings: rows.length,
      dataSource: 'supabase',
    });

  } catch (e) {
    return res.status(500).json({ error: 'Internal error', detail: e.message });
  }
}

function computeForecast(chart) {
  const n = chart.length;
  if (n < 2) return null;

  const x = chart.map((_, i) => i);
  const y = chart.map(p => p.avg);

  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((s, xi, i) => s + xi * y[i], 0);
  const sumXX = x.reduce((s, xi) => s + xi * xi, 0);

  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const residuals = y.map((yi, i) => yi - (slope * x[i] + intercept));
  const mse = residuals.reduce((s, r) => s + r * r, 0) / Math.max(1, n - 2);
  const stdError = Math.sqrt(mse);

  const lastPrice = chart[chart.length - 1].avg;
  const forecasts = [];
  for (let i = 1; i <= 3; i++) {
    const xi = n + i - 1;
    const forecastAvg = Math.round(slope * xi + intercept);
    const changePct = lastPrice > 0 ? ((forecastAvg - lastPrice) / lastPrice * 100) : 0;
    const margin = Math.round(1.96 * stdError);
    forecasts.push({
      month: `+${i}m`,
      avg: forecastAvg,
      min: Math.max(0, forecastAvg - margin),
      max: forecastAvg + margin,
      change: parseFloat(changePct.toFixed(1)),
      direction: changePct >= 0 ? 'up' : 'down',
      confidenceInterval: margin,
    });
  }

  const avgForecast = Math.round(forecasts.reduce((s, f) => s + f.avg, 0) / 3);
  const totalChange = lastPrice > 0 ? ((avgForecast - lastPrice) / lastPrice * 100) : 0;

  return {
    method: 'linear_regression',
    months: 3,
    forecasts,
    trend: {
      direction: totalChange >= 0 ? 'up' : 'down',
      percent: parseFloat(totalChange.toFixed(1)),
      slope: parseFloat(slope.toFixed(2)),
    },
    confidence: { level: 0.95, stdError: parseFloat(stdError.toFixed(2)) },
    disclaimer: 'This forecast is based on historical trend analysis and is NOT guaranteed. Market conditions can significantly affect actual prices.',
  };
}
