/**
 * WATCH DATA API — /api/watch-data
 *
 * GET /api/watch-data?page=1&limit=500&brand=Patek+Philippe&verdict=APPROVED
 * GET /api/watch-data?stats=true  — aggregate stats only
 *
 * Resilient against Supabase statement timeouts:
 * - Stats uses lightweight sample-based counts with fallback
 * - Data queries order by id (indexed) not created_at
 * - Verdict filter handled server-side with timeout protection
 *
 * IMAGE ENRICHMENT: Automatically merges imageUrl from catalog.json
 * into every returned record based on reference matching.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Statistics Cache Globals ──
let cachedStats = null;
let cachedStatsTime = 0;
const STATS_CACHE_TTL = 30 * 1000; // 30 seconds

// ── Catalog image lookup (lazy-loaded singleton) ──
let _catalogByRef = null;
function loadCatalogImages() {
  if (_catalogByRef) return _catalogByRef;
  _catalogByRef = new Map();
  try {
    const catalogPath = resolve(process.cwd(), 'public', 'catalog.json');
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
    for (const entry of catalog) {
      if (entry.imageUrl && entry.reference) {
        const ref = entry.reference.toUpperCase().replace(/[^A-Z0-9\/\-]/g, '');
        _catalogByRef.set(ref, entry.imageUrl);
      }
      // Also handle snake_case image_url field
      if (entry.image_url && entry.reference) {
        const ref = entry.reference.toUpperCase().replace(/[^A-Z0-9\/\-]/g, '');
        if (!_catalogByRef.has(ref)) {
          _catalogByRef.set(ref, entry.image_url);
        }
      }
    }
    console.log(`[catalog] Loaded ${_catalogByRef.size} image URLs for catalog enrichment`);
  } catch (e) {
    console.error('[catalog] Failed to load catalog.json:', e.message);
  }
  return _catalogByRef;
}

/** Normalize a reference for catalog lookup (matches catalog-lookup.js logic) */
function normalizeRef(ref) {
  return String(ref || '').toUpperCase().replace(/[^A-Z0-9\/\-]/g, '');
}

/** Look up an image URL from the catalog by reference. Returns null if not found. */
function lookupImageUrl(reference) {
  if (!reference) return null;
  const cat = loadCatalogImages();
  const ref = normalizeRef(reference);
  if (!ref || ref.length < 3) return null;

  // 1. Exact match
  if (cat.has(ref)) return cat.get(ref);

  // 2. Prefix/suffix match (e.g. "5711/1A-010" matches "5711/1A")
  for (const [catalogRef, url] of cat) {
    if (ref.startsWith(catalogRef) || catalogRef.startsWith(ref)) {
      return url;
    }
  }

  // 3. Strip dashes/slashes and try again (e.g. "116610LV" matches "116610-LV")
  const refStripped = ref.replace(/[\-\/]/g, '');
  for (const [catalogRef, url] of cat) {
    const catStripped = catalogRef.replace(/[\-\/]/g, '');
    if (refStripped === catStripped || refStripped.startsWith(catStripped) || catStripped.startsWith(refStripped)) {
      return url;
    }
  }

  // 4. First 4+ character match (for references like "5167A-001" matching "5167A")
  if (ref.length >= 4) {
    const refPrefix = ref.substring(0, Math.min(ref.length, 6));
    for (const [catalogRef, url] of cat) {
      if (catalogRef.startsWith(refPrefix) || refPrefix.startsWith(catalogRef.substring(0, Math.min(catalogRef.length, 6)))) {
        return url;
      }
    }
  }

  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  const headers = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
  };

  // Helper: fetch with timeout
  async function sbFetch(url, opts = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(timer);
      return r;
    } catch(e) {
      clearTimeout(timer);
      if (e.name === 'AbortError') throw new Error('timeout');
      throw e;
    }
  }

  // Helper: count with estimated fallback (exact times out on 1.3M+ rows)
  async function countVerdict(verdict) {
    try {
      const r = await sbFetch(
        `${supabaseUrl}/rest/v1/watch_records?select=id&verdict=eq.${verdict}&limit=0`,
        { headers: { ...headers, 'Prefer': 'count=estimated' } },
        9000
      );
      const cr = r.headers.get('content-range') || '*/0';
      return parseInt(cr.split('/')[1] || '0');
    } catch { return 0; }
  }

  try {
    const { stats, page = '1', limit = '500', brand, verdict,
            reference, dial_color, search, order = 'id', ascending = 'false', last_sync } = req.query;

    // ── STATS MODE ─────────────────────────────────────────────────────────
    if (stats === 'true') {
      const now = Date.now();
      if (cachedStats && (now - cachedStatsTime < STATS_CACHE_TTL)) {
        res.setHeader('X-Cache', 'HIT-Memory');
        return res.status(200).json(cachedStats);
      }

      // Total count
      let total = 0;
      try {
        const cr = await sbFetch(
          `${supabaseUrl}/rest/v1/watch_records?select=id&limit=0`,
          { headers: { ...headers, 'Prefer': 'count=estimated' } },
          9000
        );
        const crh = cr.headers.get('content-range') || '*/0';
        total = parseInt(crh.split('/')[1] || '0');
      } catch { total = 0; }

      // Verdict counts in parallel (each with own timeout)
      const [approved, human, recycle, review] = await Promise.all([
        countVerdict('APPROVED'),
        countVerdict('HUMAN'),
        countVerdict('RECYCLE'),
        countVerdict('REVIEW'),
      ]);

      const verdictCounts = { APPROVED: approved, HUMAN: human, RECYCLE: recycle, REVIEW: review };

      // Use known total if count query timed out
      const derivedTotal = total || (approved + human + recycle + review);

      // Brand counts — top 15 only, parallel with tight timeout
      const topBrands = [
        'Rolex','Patek Philippe','Audemars Piguet','Richard Mille','Cartier',
        'Vacheron Constantin','Omega','Tudor','Hublot','Panerai',
        'A. Lange & Sohne','IWC','Jaeger-LeCoultre','F.P. Journe','Breitling'
      ];
      const brandCounts = {};
      await Promise.all(topBrands.map(async (b) => {
        try {
          const r = await sbFetch(
            `${supabaseUrl}/rest/v1/watch_records?select=count&verdict=eq.APPROVED&brand=eq.${encodeURIComponent(b)}`,
            { headers: { ...headers, 'Prefer': 'count=exact' } },
            8000
          );
          const cr = r.headers.get('content-range') || '0/0';
          const cnt = parseInt(cr.split('/')[1] || '0');
          if (cnt > 0) brandCounts[b] = cnt;
        } catch {}
      }));

      cachedStats = {
        total: derivedTotal,
        brands: brandCounts,
        verdicts: verdictCounts,
        cached_at: new Date().toISOString(),
      };
      cachedStatsTime = now;
      res.setHeader('X-Cache', 'MISS-Memory');

      return res.status(200).json(cachedStats);
    }

    // ── PAGINATED DATA MODE ────────────────────────────────────────────────
    const pageNum  = Math.max(1, parseInt(page));
    const limitNum = Math.min(50000, Math.max(1, parseInt(limit)));
    const offset   = (pageNum - 1) * limitNum;
    const endRange = offset + limitNum - 1;

    // Build query — use id ordering (has index) unless explicitly overridden
    const orderCol = (order === 'created_at') ? 'id' : order;
    let query = `${supabaseUrl}/rest/v1/watch_records?select=*&order=${orderCol}.${ascending === 'true' ? 'asc' : 'desc'}`;

    const filters = [];
    if (brand)      filters.push(`brand=eq.${encodeURIComponent(brand)}`);
    if (verdict)    filters.push(`verdict=eq.${encodeURIComponent(verdict)}`);
    if (reference)  filters.push(`reference=eq.${encodeURIComponent(reference)}`);
    if (dial_color) filters.push(`dial_color=eq.${encodeURIComponent(dial_color)}`);
    if (search)     filters.push(`or=(reference.ilike.%${encodeURIComponent(search)}%,brand.ilike.%${encodeURIComponent(search)}%,raw_message.ilike.%${encodeURIComponent(search)}%)`);
    if (last_sync)  filters.push(`created_at=gt.${encodeURIComponent(last_sync)}`);
    if (filters.length) query += '&' + filters.join('&');

    const dataRes = await sbFetch(query, {
      headers: { ...headers, 'Range': `${offset}-${endRange}`, 'Prefer': 'count=exact' }
    }, 9000);

    if (!dataRes.ok) {
      const errBody = await dataRes.text();
      // If timeout (57014), return empty page with helpful message
      if (errBody.includes('57014') || errBody.includes('timeout')) {
        return res.status(200).json({
          data: [], page: pageNum, limit: limitNum,
          total: 0, pages: 0,
          warning: 'Query timed out — add a verdict index in Supabase dashboard'
        });
      }
      return res.status(dataRes.status).json({ error: 'Supabase error', detail: errBody.substring(0, 200) });
    }

    const data  = await dataRes.json();
    const crh   = dataRes.headers.get('content-range') || `${offset}-${endRange}/${data.length}`;
    const total = parseInt(crh.split('/')[1] || '0');

    // Enrich each record with imageUrl from catalog if available
    // This ensures watch cards show real photos instead of SVG placeholders
    const enrichedData = Array.isArray(data)
      ? data.map(r => ({
          ...r,
          image_url: lookupImageUrl(r.reference),
          // Also check front_image field if it happens to exist
          _front_image: r.front_image || null,
        }))
      : data;

    return res.status(200).json({
      data: enrichedData,
      page:  pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum),
    });

  } catch (err) {
    console.error('[watch-data] error:', err.message);
    return res.status(200).json({
      data: [], total: 0, pages: 0,
      error: err.message,
      warning: 'Supabase temporarily unavailable'
    });
  }
}
