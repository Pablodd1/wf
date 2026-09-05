/**
 * MARKETPLACE SCRAPER ENDPOINT — POST/GET /api/scrape-marketplace
 *
 * Scrapes public listings from marketplaces that don't block scrapers
 * (Jomashop, etc.) and feeds them through the existing ingest pipeline
 * → Supabase live_ingest table.
 *
 * POST body:
 *   {
 *     source: 'jomashop',
 *     brand: 'rolex',                  // optional filter
 *     limit: 20,                       // max listings to scrape
 *     model: 'submariner'              // optional
 *   }
 *
 * Returns: { scraped: number, ingested: number, errors: string[] }
 *
 * Environment variables required:
 *   SUPABASE_URL              – Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY – service-role JWT
 *
 * GET /api/scrape-marketplace — returns scraping stats + last runs
 */

const JOMASHOP_BASE = 'https://www.jomashop.com';
const { requireServiceToken } = require('./_lib/require-service-token.cjs');

// Map jomashop brand URL slugs
const JOMASHOP_BRANDS = {
  rolex: '/rolex.html',
  patek: '/patek-philippe-watches.html',
  ap:    '/audemars-piguet.html',
  rm:    '/richard-mille.html',
  omega: '/omega-watches.html',
  cartier: '/cartier-watches.html',
  Tudor: '/tudor-watches.html',
  iwc:   '/iwc-watches.html',
  hublot:'/hublot-watches.html',
  panerai:'/panerai-watches.html',
  breitling:'/breitling-watches.html',
  jlc:   '/jaeger-lecoultre.html',
  vc:    '/vacheron-constantin.html',
};

function buildUrl(source, brand, model) {
  if (source === 'jomashop') {
    let slug = JOMASHOP_BRANDS[brand?.toLowerCase()] || '';
    if (!slug) return null;
    return JOMASHOP_BASE + slug;
  }
  return null;
}

// ── Parse a jomashop product page → ingest record ──
function parseJomaProduct(html, sourceUrl) {
  const record = {
    rawMessage: '',
    brand: null,
    reference: null,
    dialColor: null,
    price: null,
    currency: 'USD',
    condition: 'New',
    year: null,
    confidence: 0,
    source: 'jomashop',
  };

  // Title pattern: "Rolex Submariner Date 116610LN Black Dial Stainless Steel..."
  const titleMatch = html.match(/<h1[^>]*class="[^"]*product-name[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)
                  || html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i);
  if (titleMatch) {
    const title = titleMatch[1].replace(/<[^>]+>/g, '').trim();
    record.rawMessage = title;

    // Brand
    const brandM = title.match(/\b(Rolex|Patek Philippe|Audemars Piguet|Richard Mille|Omega|Cartier|Tudor|IWC|Hublot|Panerai|Breitling|Jaeger[-\s]LeCoultre|Vacheron Constantin|Lange|Blancpain|Breguet|Glashütte|Chopard|Tag Heuer)\b/i);
    if (brandM) {
      const b = brandM[1].toLowerCase();
      const brandMap = {
        'patek philippe': 'Patek Philippe', 'rolex': 'Rolex',
        'audemars piguet': 'Audemars Piguet', 'richard mille': 'Richard Mille',
        'omega': 'Omega', 'cartier': 'Cartier', 'tudor': 'Tudor', 'iwc': 'IWC',
        'hublot': 'Hublot', 'panerai': 'Panerai', 'breitling': 'Breitling',
        'jaeger lecoultre': 'Jaeger-LeCoultre', 'jaeger-lecoultre': 'Jaeger-LeCoultre',
        'vacheron constantin': 'Vacheron Constantin',
      };
      record.brand = brandMap[b] || brandM[1];
    }

    // Reference (e.g., "116610LN", "5711/1A", "15500ST")
    const refM = title.match(/\b(\d{4,6}[A-Z]{0,4}|\d{4,6}\/[\w\-]+)\b/);
    if (refM) record.reference = refM[1].toUpperCase();

    // Dial color
    const dialM = title.match(/\b(Blue|Black|Green|White|Brown|Grey|Gray|Silver|Pink|Purple|Red|Orange|Yellow|Champagne|Tiffany|Mother of Pearl|MOP|Meteorite)\b/i);
    if (dialM) record.dialColor = dialM[1].replace('MOP', 'Mother of Pearl');

    // Confidence based on extracted fields
    if (record.brand) record.confidence += 30;
    if (record.reference) record.confidence += 40;
    if (record.dialColor) record.confidence += 15;
  }

  // Price pattern (Jomashop uses "$12,500.00")
  const priceMatch = html.match(/<span[^>]+class="[^"]*price[^"]*"[^>]*>\s*\$([\d,]+\.?\d*)/i)
                  || html.match(/<meta[^>]+property="product:price:amount"[^>]+content="([\d.]+)"/i);
  if (priceMatch) {
    record.price = parseFloat(priceMatch[1].replace(/,/g, ''));
    record.currency = 'USD';
    record.confidence += 15;
  }

  return record;
}

// ── Fetch with retries + UA ──
async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ── Supabase upsert ──
async function supabaseUpsert(record, supabaseUrl, serviceKey) {
  const row = {
    id: `scrape_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    raw_message: record.rawMessage,
    brand: record.brand || 'Unknown',
    reference: record.reference || null,
    dial_color: record.dialColor || null,
    condition: record.condition || null,
    year: record.year || null,
    price_raw: record.price || null,
    price_usd: record.price || null,
    currency: record.currency || null,
    confidence: record.confidence,
    // External extraction is evidence for review, never approval by itself.
    verdict: 'PENDING',
    source: record.source,
    channel_id: record.source,
    llm_used: false,
    received_at: new Date().toISOString(),
  };
  const resp = await fetch(`${supabaseUrl}/rest/v1/live_ingest`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': serviceKey,
      'Authorization': `Bearer ${serviceKey}`,
      'Prefer': 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify([row]),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Supabase: ${err}`);
  }
  return row;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

  if (req.method === 'GET') {
    return res.status(200).json({
      status: 'ok',
      sources: ['jomashop'],
      supported_brands: Object.keys(JOMASHOP_BRANDS),
      supabase_configured: !!(supabaseUrl && serviceKey),
      usage: 'POST { source: "jomashop", brand: "rolex", limit: 10 }',
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  if (!requireServiceToken(req, res)) return;

  const { source = 'jomashop', brand, limit = 10 } = req.body || {};

  if (source !== 'jomashop') {
    return res.status(400).json({ error: `Unsupported source: ${source}. Use 'jomashop'.` });
  }

  const listUrl = buildUrl(source, brand);
  if (!listUrl) {
    return res.status(400).json({
      error: `Unknown brand: ${brand}`,
      supported: Object.keys(JOMASHOP_BRANDS),
    });
  }

  try {
    // 1. Fetch the listing page
    const html = await fetchPage(listUrl);

    // 2. Extract product URLs (joma links look like /rolex-submariner-116610ln.html)
    const linkRe = /href="(\/[^"]+\.html)"[^>]*>([^<]+)</g;
    const products = [];
    let m;
    while ((m = linkRe.exec(html)) !== null) {
      const href = m[1];
      const name = m[2].trim();
      // Filter: must have watch keyword + reference
      if (name.length < 10) continue;
      if (!/\d{4,6}/.test(name)) continue;
      if (!/watch|rolex|patek|audemars|omega|cartier|tudor|iwc|hublot|panerai|breitling|jaeger|vacheron/i.test(name)) continue;
      products.push({ url: JOMASHOP_BASE + href, name });
      if (products.length >= limit) break;
    }

    if (products.length === 0) {
      return res.status(200).json({
        source,
        brand,
        scraped: 0,
        ingested: 0,
        message: 'No products found in listing page',
        sample: html.slice(0, 500),
      });
    }

    // 3. Fetch each product page and parse
    const errors = [];
    let ingested = 0;
    for (const p of products) {
      try {
        const pHtml = await fetchPage(p.url);
        const record = parseJomaProduct(pHtml, p.url);
        if (!record.rawMessage || !record.brand) {
          errors.push(`Skipped ${p.url}: could not extract brand/title`);
          continue;
        }
        if (supabaseUrl && serviceKey) {
          await supabaseUpsert(record, supabaseUrl, serviceKey);
          ingested++;
        }
      } catch (e) {
        errors.push(`${p.url}: ${e.message}`);
      }
    }

    return res.status(200).json({
      success: true,
      source,
      brand,
      scraped: products.length,
      ingested,
      errors,
      sample: products.slice(0, 3).map(p => p.name),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
