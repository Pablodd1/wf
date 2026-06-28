/**
 * PRICE RESEARCH API — /api/price-research
 * 
 * NOW POWERED BY SUPABASE — queries 117K+ records dynamically.
 * Works for ANY reference, not just 6 hardcoded ones.
 *
 * GET /api/price-research?reference=126334
 * Returns: brand, model, dial colors, pricing stats, chart, listings, forecast
 */

const { toUSD, inferBrandFromRef, RATES } = require('./_lib/parser');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Thin wrapper — price-research uses inferBrand() name locally
function inferBrand(ref) {
  return inferBrandFromRef(ref) || 'Unknown';
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

  const limitVal = parseInt(url.searchParams.get('limit') || '1000', 10);
  const limit = Math.min(10000, Math.max(1, isNaN(limitVal) ? 1000 : limitVal));

  let activeRef = reference;
  let resolvedModel = null;
  let resolvedBrand = null;

  // Resolve reference from catalog.json if it represents a model/brand name
  try {
    const fs = require('fs');
    const path = require('path');
    const catalogPath = path.resolve(process.cwd(), 'public', 'catalog.json');
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

    const queryClean = reference.trim().toLowerCase();
    
    // 1. Try exact or fuzzy reference match first
    const refMatch = catalog.find(c => c.reference && c.reference.toLowerCase() === queryClean);
    if (refMatch) {
      activeRef = refMatch.reference;
      resolvedModel = refMatch.model;
      resolvedBrand = refMatch.brand;
    } else {
      // 2. Try match on model name or brand + model
      const modelMatch = catalog.find(c => 
        c.model && (
          c.model.toLowerCase() === queryClean ||
          c.model.toLowerCase().includes(queryClean) ||
          `${c.brand} ${c.model}`.toLowerCase().includes(queryClean)
        )
      );
      if (modelMatch) {
        activeRef = modelMatch.reference;
        resolvedModel = modelMatch.model;
        resolvedBrand = modelMatch.brand;
      }
    }
  } catch (e) { /* ignore */ }

  try {
    const headers = {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    };

    // Query watch_records for activeRef
    let supaResp = await fetch(
      `${SUPABASE_URL}/rest/v1/watch_records?reference=eq.${encodeURIComponent(activeRef)}&limit=${limit}&order=created_at.desc`,
      { headers }
    );
    let rows = supaResp.ok ? await supaResp.json() : [];

    // If no exact match, try fuzzy search
    if (!rows || rows.length === 0) {
      const cleanRef = activeRef.replace(/[\s\-\/]/g, '');
      supaResp = await fetch(
        `${SUPABASE_URL}/rest/v1/watch_records?reference=ilike.*${encodeURIComponent(cleanRef)}*&limit=${limit}&order=created_at.desc`,
        { headers }
      );
      rows = supaResp.ok ? await supaResp.json() : [];
    }

    // Still no match? Try just the numeric portion
    if ((!rows || rows.length === 0) && /^\d{4,6}/.test(activeRef)) {
      const numPart = activeRef.match(/^\d{4,6}/)[0];
      supaResp = await fetch(
        `${SUPABASE_URL}/rest/v1/watch_records?reference=ilike.${encodeURIComponent(numPart)}*&limit=${limit}&order=created_at.desc`,
        { headers }
      );
      rows = supaResp.ok ? await supaResp.json() : [];
    }

    // Fallback: check market_prices_seed.json for current price data
    if (!rows || rows.length === 0) {
      try {
        const { readFileSync } = require('fs');
        const { resolve } = require('path');
        const seedPath = resolve(process.cwd(), 'public', 'market_prices_seed.json');
        const seedData = JSON.parse(readFileSync(seedPath, 'utf8'));
        const refUpper = activeRef.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const seedMatch = seedData.find(s => {
          const sRef = (s.reference || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
          return sRef === refUpper || sRef.startsWith(refUpper) || refUpper.startsWith(sRef);
        });
        if (seedMatch) {
          return res.status(200).json({
            success: true,
            reference: activeRef,
            brand: resolvedBrand || seedMatch.brand,
            model: resolvedModel || seedMatch.model,
            primaryDial: 'Unknown',
            dialColors: [],
            liquidity: { fsCount: seedMatch.listings_count || 0 },
            pricing: {
              current: {
                min: seedMatch.current_min_usd,
                avg: seedMatch.current_avg_usd,
                max: seedMatch.current_max_usd,
                count: seedMatch.listings_count || 0,
              },
              drift: seedMatch.trend === 'up' ? 5 : seedMatch.trend === 'down' ? -5 : 0,
              previousAvg: seedMatch.current_avg_usd,
            },
            chart: [],
            listings: [],
            totalListings: seedMatch.listings_count || 0,
            outliers: 0, duplicates: 0,
            source: seedMatch.source,
            note: 'Market reference data — upload listings to see full chart',
          });
        }
      } catch (seedErr) { /* seed fallback failed, continue */ }

      return res.status(200).json({
        success: false,
        reference: activeRef,
        error: `No data found for reference "${activeRef}". Try: 126334, 5711/1A, 116610LV, RM07-01`,
      });
    }

    // Transform rows into listings
    const brand = resolvedBrand || (rows[0] ? rows[0].brand : null) || inferBrand(activeRef);
    let model = resolvedModel;
    let catalogImageUrl = null;
    if (!model) {
      try {
        const fs = require('fs');
        const path = require('path');
        const catalogPath = path.resolve(process.cwd(), 'public', 'catalog.json');
        const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
        const catMatch = catalog.find(c => c.reference === activeRef);
        if (catMatch) {
          if (catMatch.model) model = catMatch.model;
          if (catMatch.imageUrl) catalogImageUrl = catMatch.imageUrl;
        }
      } catch (e) { /* ignore */ }
    }
    if (!model) {
      model = `${brand} ${activeRef}`;
    }
    const listings = rows.map(r => {
      const priceUSD = r.price_usd || toUSD(r.price_raw || 0, r.currency);
      // Parse flags if it's a string, or use directly if it's an object
      let parsedFlags = {};
      try {
        parsedFlags = typeof r.flags === 'string' ? JSON.parse(r.flags) : (r.flags || {});
      } catch (e) { /* fallback */ }
      
      const media_assets = parsedFlags.media_assets || [];
      const imageUrl = media_assets.length > 0 ? media_assets[0] : (r.image_url || null);

      // Build a clean normalized title from parsed fields instead of raw message
      const titleParts = [r.brand, r.reference, r.dial_color, r.condition, r.year]
        .filter(v => v && v !== 'Unknown' && v !== 'UNKNOWN' && v !== null);
      const normalizedTitle = titleParts.length > 0 ? titleParts.join(' · ') : null;

      return {
        id: r.id || r.message_hash || `ref_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        title: normalizedTitle || r.raw_message || '',
        normalizedTitle,
        rawMessage: r.raw_message || '',
        price: r.price_raw || 0,
        currency: r.currency || 'USD',
        priceUSD,
        dial: r.dial_color || 'Unknown',
        date: (r.created_at || '').substring(0, 10),
        year: r.year,
        condition: r.condition || 'Unknown',
        confidence: r.confidence || 0,
        verdict: r.verdict || 'UNKNOWN',
        imageUrl,
        media_assets,
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

    // Build monthly chart from created_at date (more reliable than sparse year field)
    const monthMap = {};
    validListings.forEach(l => {
      const d = l.date; // "YYYY-MM-DD" from created_at
      if (!d || d.length < 7) return;
      const monthKey = d.substring(0, 7); // "YYYY-MM"
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

    // Compute buyer/seller counts from raw_message WTB/WTS patterns
    let buyers = 0;
    let sellers = 0;
    for (const l of validListings) {
      const title = (l.title || '').toUpperCase();
      // Detect WTB: "WTB", "Want to Buy", "Looking for", "ISO" (In Search Of), "NTQ" (Need to Quote)
      if (/\bWTB\b|\bWANT\s+TO\s+BUY\b|\bLOOKING\s+FOR\b|\bISO\b|\bNTQ\b|\bBUY(?:ER|ING)?\b.*\bSEEK\b|\bIN\s+SEARCH\s+OF\b/i.test(title)) {
        buyers++;
      } else {
        sellers++;
      }
    }
    const total = buyers + sellers;
    const buyerSellerRatio = sellers > 0 ? parseFloat((buyers / sellers).toFixed(2)) : 0;

    return res.status(200).json({
      success: true,
      reference: activeRef,
      brand,
      model: model,
      catalogImageUrl,
      dialColors: dialSet.length > 0 ? dialSet : ['Unknown'],
      primaryDial: dialSet[0] || 'Unknown',
      liquidity: {
        fsCount: validListings.length,
        buyers,
        sellers,
        buyerSellerRatio,
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
      listings: url.searchParams.get('all') === 'true' ? validListings : validListings.slice(0, 50),
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
