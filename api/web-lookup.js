/**
 * Web lookup for watch verification — searches local enriched reference
 * catalog (enriched_refs.json) + DuckDuckGo web search fallback.
 * Returns enrichment data (model, case metal, price hints, etc.)
 * CommonJS for Vercel serverless — maxDuration: 30
 */

const fs = require('fs');
const path = require('path');

// Load enriched refs catalog at startup (included in deployment)
let REFS_CATALOG = [];
try {
  const catalogPath = path.join(__dirname, '..', 'dist', 'enriched_refs.json');
  if (fs.existsSync(catalogPath)) {
    REFS_CATALOG = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
  }
} catch (e) {
  console.error('Failed to load enriched_refs.json:', e.message);
}

// Build lookup index
const REF_INDEX = {};
for (const entry of REFS_CATALOG) {
  const ref = (entry.reference || '').toUpperCase().replace(/[-\s]/g, '');
  REF_INDEX[ref] = entry;
  // Also index without space variants
  const alt = (entry.reference || '').toUpperCase().replace(/\s+/g, '');
  if (alt !== ref) REF_INDEX[alt] = entry;
}

function normalizeRef(r) {
  return r.toUpperCase().replace(/[-\s]/g, '');
}

async function searchDuckDuckGo(query) {
  const params = new URLSearchParams({ q: query });
  const res = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    body: params.toString(),
  });
  if (!res.ok) return [];
  const html = await res.text();
  const results = [];
  const regex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = regex.exec(html)) !== null) {
    results.push({ url: m[1], title: m[2].replace(/<[^>]+>/g, '').trim() });
    if (results.length >= 5) break;
  }
  const snippets = [];
  const sRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  while ((m = sRegex.exec(html)) !== null) {
    snippets.push(m[1].replace(/<[^>]+>/g, '').trim());
  }
  for (let i = 0; i < results.length && i < snippets.length; i++) {
    results[i].snippet = snippets[i];
  }
  return results;
}

// Bing search fallback (works from serverless IPs where DDG gets blocked)
async function searchBing(query) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) return [];
  const html = await res.text();
  const results = [];
  // Bing uses <li class="b_algo"> for organic results
  const algoRegex = /<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = algoRegex.exec(html)) !== null) {
    const block = m[1];
    // Title: <h2><a href="URL">TITLE</a></h2>
    const titleMatch = block.match(/<h2>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;
    const url2 = titleMatch[1];
    const title = titleMatch[2].replace(/<[^>]+>/g, '').trim();
    // Snippet: <p class="b_paractl"> or <p>
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    results.push({ url: url2, title, snippet: snippet.slice(0, 300) });
    if (results.length >= 5) break;
  }
  return results;
}

function extractPrice(text) {
  const prices = {};
  const usdM = text.match(/\$[\s,]*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:USD|usd)?/);
  const hkdM = text.match(/(?:HK\$|HKD)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/i);
  const kM = text.match(/(\d{1,4}(?:\.\d)?)\s*[kK]\s*(USD|HKD|usd|hkd)/);
  if (usdM) prices.usd = parseFloat(usdM[1].replace(/,/g, ''));
  if (hkdM) prices.hkd = parseFloat(hkdM[1].replace(/,/g, ''));
  if (kM) {
    const val = parseFloat(kM[1]) * 1000;
    const cur = kM[2].toUpperCase();
    if (cur === 'USD') prices.usd = val;
    else if (cur === 'HKD') prices.hkd = val;
  }
  return prices;
}

function extractYear(text) {
  const m = text.match(/\b(20[0-2]\d)\b/);
  return m ? parseInt(m[1]) : null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { reference, brand, year, raw } = req.query;
    if (!reference && !raw) {
      return res.status(400).json({ success: false, error: 'Need reference or raw text' });
    }

    // 1. Local catalog lookup (instant, always available)
    let catalogMatch = null;
    let lookupRef = null;
    if (reference) {
      const nRef = normalizeRef(reference);
      catalogMatch = REF_INDEX[nRef] || null;
      lookupRef = reference;
    } else if (raw) {
      // Try to extract reference from raw text
      const m = raw.match(/(\d{3,4}\/[A-Z0-9]+[A-Za-z]?|\b[A-Z]{1,2}\d{3,4}[A-Z]?\b)/i);
      if (m) {
        lookupRef = m[1];
        const nRef = normalizeRef(lookupRef);
        catalogMatch = REF_INDEX[nRef] || null;
      }
    }

    // Build enrichment from catalog (includes price ranges when available)
    const catalogEnrichment = catalogMatch ? {
      model: catalogMatch.model || null,
      collection: catalogMatch.collection || null,
      caseMetal: catalogMatch.case_metal || null,
      productionYears: catalogMatch.production_years || null,
      status: catalogMatch.status || null,
      totalMentions: catalogMatch.total_mentions || 0,
      buyerRatio: catalogMatch.buyer_ratio || null,
      sellerRatio: catalogMatch.seller_ratio || null,
      liquidityScore: catalogMatch.liquidity_score || null,
      // Price data from the historical dataset
      avgPrice: catalogMatch.avg_price || null,
      minPrice: catalogMatch.min_price || null,
      maxPrice: catalogMatch.max_price || null,
      topDial: catalogMatch.dial_colors || null,
      inCatalog: true,
    } : null;

    // 2. Web search (best-effort, may fail from serverless IPs)
    let webResults = [];
    let webSnippets = '';
    let webError = null;
    const queries = [];
    if (lookupRef) {
      if (brand) queries.push(`${lookupRef} ${brand} watch for sale price`);
      queries.push(`${lookupRef} watch`);
    }
    if (raw && (!queries.length || queries[0].length < 15)) {
      const words = raw.replace(/[^\w\s]/g, ' ').trim().split(/\s+/).filter(w => w.length > 2);
      const keyTerms = words.slice(0, 6).join(' ');
      if (keyTerms.length > 10) queries.push(`${keyTerms} watch`);
    }
    if (queries.length) {
      try {
        // Try DDG first
        webResults = await searchDuckDuckGo(queries[0]);
        // If DDG returned nothing (blocked from serverless IP), fall back to Bing
        if (webResults.length === 0) {
          try {
            webResults = await searchBing(queries[0]);
          } catch (bingErr) {
            webError = `DDG blocked, Bing failed: ${bingErr.message}`;
          }
        }
        webSnippets = webResults.map(r => r.snippet || '').filter(Boolean).join(' ');
      } catch (e) {
        webError = e.message;
        // Web search failed silently — catalog data is still returned
      }
    }

    // 3. Combined enrichment
    const priceFromWeb = extractPrice(webSnippets);
    const yearFromWeb = extractYear(webSnippets);

    // Confidence boost — prioritize catalog, web is bonus
    let confidenceBoost = 0;
    if (catalogMatch) confidenceBoost += 20;  // Strong catalog hit
    if (webResults.length >= 2) confidenceBoost += 5;
    if (priceFromWeb.usd || priceFromWeb.hkd) confidenceBoost += 5;

    return res.status(200).json({
      success: true,
      reference: lookupRef,
      catalogEnrichment,
      webEnrichment: {
        price: priceFromWeb,
        year: yearFromWeb,
        resultCount: webResults.length,
        topResult: webResults[0] ? {
          title: webResults[0].title,
          url: webResults[0].url,
          snippet: (webResults[0].snippet || '').slice(0, 200),
        } : null,
        error: webError,
      },
      confidenceBoost: Math.min(confidenceBoost, 30),
      results: webResults.slice(0, 3).map(r => ({
        title: r.title, url: r.url, snippet: (r.snippet || '').slice(0, 200),
      })),
      primarySource: catalogMatch ? 'catalog' : (webResults.length ? 'web' : 'none'),
    });
  } catch (err) {
    console.error('web-lookup error:', err.message);
    return res.status(200).json({
      success: true,
      reference: null,
      catalogEnrichment: null,
      webEnrichment: null,
      confidenceBoost: 0,
      results: [],
    });
  }
};
