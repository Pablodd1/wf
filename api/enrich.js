/**
 * STRUCTURED ENRICHMENT — /api/enrich
 *
 * Purpose: enrich a parsed watch with structured data from multiple sources:
 *   1. Local catalog (enriched_refs.json) — instant
 *   2. DuckDuckGo web search — price hints, availability
 *   3. Per-brand structured endpoints (best-effort):
 *      - Chrono24 search page scrape (price range, image)
 *      - WatchCharts (market data)
 *      - Brand official sites (validation)
 *
 * Returns: unified enrichment object with marketPrice, imageUrl,
 * officialUrl, productionStatus, etc.
 *
 * CommonJS for Vercel serverless.
 */

const fs = require('fs');
const path = require('path');

/* ── catalog ────────────────────────────────────────────────────────────────────────── */
let REFS_CATALOG = [];
try {
  const catalogPath = path.join(__dirname, '..', 'dist', 'enriched_refs.json');
  if (fs.existsSync(catalogPath)) {
    REFS_CATALOG = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
  }
} catch (e) {
  console.error('Failed to load enriched_refs.json:', e.message);
}

const REF_INDEX = {};
for (const entry of REFS_CATALOG) {
  const ref = (entry.reference || '').toUpperCase().replace(/[-\s]/g, '');
  REF_INDEX[ref] = entry;
  const alt = (entry.reference || '').toUpperCase().replace(/\s+/g, '');
  if (alt !== ref) REF_INDEX[alt] = entry;
}

function normalizeRef(r) {
  return r.toUpperCase().replace(/[-\s]/g, '');
}

/* ── helpers ────────────────────────────────────────────────────────────────────────── */

async function fetchWithTimeout(url, opts = {}, ms = 6000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(id);
    return res;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

async function searchDuckDuckGo(query) {
  try {
    const res = await fetchWithTimeout('https://html.duckduckgo.com/html/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: new URLSearchParams({ q: query }).toString(),
    }, 5000);
    if (!res.ok) return [];
    const html = await res.text();
    const results = [];
    const reTitle = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = reTitle.exec(html)) !== null) {
      results.push({ url: m[1], title: m[2].replace(/<[^>]+>/g, '').trim() });
      if (results.length >= 5) break;
    }
    const reSnip = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    const snippets = [];
    while ((m = reSnip.exec(html)) !== null) {
      snippets.push(m[1].replace(/<[^>]+>/g, '').trim());
    }
    for (let i = 0; i < results.length && i < snippets.length; i++) {
      results[i].snippet = snippets[i];
    }
    return results;
  } catch (e) {
    return [];
  }
}

/* Chrono24 — search page scrape for price range + image */
async function enrichChrono24(ref, brand) {
  try {
    const q = encodeURIComponent(`${brand || ''} ${ref}`.trim());
    const url = `https://www.chrono24.com/search/index.htm?query=${q}&dosearch=true`;
    const res = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    }, 6000);
    if (!res.ok) return null;
    const html = await res.text();

    // Extract prices from result cards
    const prices = [];
    const priceRe = /(?:\$|USD|EUR|€|\u00a5)\s*([\d,]+(?:\.\d{2})?)/g;
    let pm;
    while ((pm = priceRe.exec(html)) !== null) {
      const val = parseFloat(pm[1].replace(/,/g, ''));
      if (val > 1000 && val < 5000000) prices.push(val);
    }
    // Also match "42,500" near currency words
    const altRe = /([\d,]+(?:\.\d{2})?)\s*(?:USD|EUR|€)/g;
    while ((pm = altRe.exec(html)) !== null) {
      const val = parseFloat(pm[1].replace(/,/g, ''));
      if (val > 1000 && val < 5000000) prices.push(val);
    }

    // Extract first image
    let imageUrl = null;
    const imgRe = /<img[^>]*data-src="([^"]+)"[^>]*class="[^"]*article-item-image[^"]*"|<img[^>]*src="([^"]+)"[^>]*class="[^"]*article-item-image[^"]*"/i;
    const imgM = imgRe.exec(html);
    if (imgM) imageUrl = imgM[1] || imgM[2];
    if (!imageUrl) {
      // fallback: any img with article in class
      const fallbackRe = /<img[^>]*src="([^"]+)"[^>]*class="[^"]*article[^"]*"/i;
      const fm = fallbackRe.exec(html);
      if (fm) imageUrl = fm[1];
    }

    // Extract listing count
    let listingCount = null;
    const countRe = /(\d+(?:,\d{3})*)\s*results/i;
    const cm = countRe.exec(html);
    if (cm) listingCount = parseInt(cm[1].replace(/,/g, ''));

    if (prices.length === 0 && !imageUrl && !listingCount) return null;

    prices.sort((a, b) => a - b);
    const mid = Math.floor(prices.length / 2);
    const median = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;

    return {
      source: 'chrono24',
      url: url.replace(/&/g, '&amp;'),
      listingCount,
      priceRange: prices.length ? { low: prices[0], high: prices[prices.length - 1], median: Math.round(median) } : null,
      imageUrl,
    };
  } catch (e) {
    return null;
  }
}

/* WatchCharts — market data (best-effort, may block serverless IPs) */
async function enrichWatchCharts(ref, brand) {
  try {
    const q = encodeURIComponent(`${brand || ''} ${ref}`.trim());
    const url = `https://www.watchcharts.com/search?query=${q}`;
    const res = await fetchWithTimeout(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
    }, 5000);
    if (!res.ok) return null;
    const html = await res.text();

    // Try to extract market price from search results
    const prices = [];
    const priceRe = /\$([\d,]+(?:\.\d{2})?)/g;
    let pm;
    while ((pm = priceRe.exec(html)) !== null) {
      const val = parseFloat(pm[1].replace(/,/g, ''));
      if (val > 1000 && val < 5000000) prices.push(val);
    }

    // Extract first result link
    let resultUrl = null;
    const linkRe = /<a[^>]*href="(\/watch\/[^"]*)"[^>]*>/;
    const lm = linkRe.exec(html);
    if (lm) resultUrl = 'https://www.watchcharts.com' + lm[1];

    if (prices.length === 0 && !resultUrl) return null;

    prices.sort((a, b) => a - b);
    return {
      source: 'watchcharts',
      url: resultUrl || url,
      priceRange: prices.length ? { low: prices[0], high: prices[prices.length - 1] } : null,
    };
  } catch (e) {
    return null;
  }
}

/* Brand official site validation */
function getBrandUrl(ref, brand) {
  const b = (brand || '').toLowerCase();
  if (b.includes('patek')) return `https://www.patek.com/en/collection/all-models?search=${encodeURIComponent(ref)}`;
  if (b.includes('rolex')) return `https://www.rolex.com/watches?search=${encodeURIComponent(ref)}`;
  if (b.includes('audemars') || b.includes('ap')) return `https://www.audemarspiguet.com/en/watch-finder.html?search=${encodeURIComponent(ref)}`;
  if (b.includes('vacheron')) return `https://www.vacheron-constantin.com/en/watches.html?search=${encodeURIComponent(ref)}`;
  if (b.includes('omega')) return `https://www.omegawatches.com/en-us/watchfinder.html?search=${encodeURIComponent(ref)}`;
  return null;
}

/* ── main handler ────────────────────────────────────────────────────────────────────────── */

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { reference, brand, raw } = req.query;
    if (!reference && !raw) {
      return res.status(400).json({ success: false, error: 'Need reference or raw text' });
    }

    const lookupRef = reference || (raw ? (raw.match(/(\d{3,4}\/[A-Z0-9]+[A-Za-z]?|\b[A-Z]{1,2}\d{3,4}[A-Z]?\b)/i) || [])[1] : null);
    const nRef = lookupRef ? normalizeRef(lookupRef) : null;
    const catalogMatch = nRef ? REF_INDEX[nRef] || null : null;

    // Parallel enrichment calls
    const [ddgResults, chrono, watchcharts] = await Promise.allSettled([
      lookupRef ? searchDuckDuckGo(`${lookupRef} ${brand || ''} watch price`) : Promise.resolve([]),
      lookupRef ? enrichChrono24(lookupRef, brand) : Promise.resolve(null),
      lookupRef ? enrichWatchCharts(lookupRef, brand) : Promise.resolve(null),
    ]);

    const ddg = ddgResults.status === 'fulfilled' ? ddgResults.value : [];
    const chronoData = chrono.status === 'fulfilled' ? chrono.value : null;
    const wcData = watchcharts.status === 'fulfilled' ? watchcharts.value : null;

    // Build unified enrichment
    const enrichment = {
      reference: lookupRef,
      catalog: catalogMatch ? {
        model: catalogMatch.model || null,
        collection: catalogMatch.collection || null,
        caseMetal: catalogMatch.case_metal || null,
        productionYears: catalogMatch.production_years || null,
        status: catalogMatch.status || null,
        liquidityScore: catalogMatch.liquidity_score || null,
        buyerRatio: catalogMatch.buyer_ratio || null,
        sellerRatio: catalogMatch.seller_ratio || null,
      } : null,
      market: {
        chrono24: chronoData,
        watchcharts: wcData,
        ddgTopResult: ddg[0] ? {
          title: ddg[0].title,
          url: ddg[0].url,
          snippet: (ddg[0].snippet || '').slice(0, 200),
        } : null,
      },
      officialUrl: getBrandUrl(lookupRef, brand),
      confidenceBoost: (catalogMatch ? 10 : 0) + (chronoData ? 8 : 0) + (wcData ? 5 : 0) + (ddg.length >= 2 ? 3 : 0),
    };

    return res.status(200).json({ success: true, enrichment });
  } catch (err) {
    console.error('enrich error:', err.message);
    return res.status(200).json({ success: true, enrichment: null, error: err.message });
  }
};
