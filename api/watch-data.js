/**
 * WATCH DATA API — /api/watch-data
 *
 * Replaces the 20MB parsedWatches.json download.
 * Serves data from Supabase in paginated chunks.
 *
 * GET /api/watch-data?page=1&limit=500&brand=Patek+Philippe&verdict=APPROVED
 * GET /api/watch-data?stats=true  (returns only aggregate stats, no rows)
 *
 * The frontend calls this instead of fetch('/parsedWatches.json')
 * for a 50x faster initial load.
 */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(503).json({ error: 'Supabase not configured' });
  }

  const { stats, page = '1', limit = '500', brand, verdict, reference, dial_color, search, order = 'created_at', ascending = 'false' } = req.query;

  const headers = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
  };

  try {
    // === STATS ONLY MODE ===
    if (stats === 'true') {
      // Get total count
      const countRes = await fetch(`${supabaseUrl}/rest/v1/watch_records?select=*`, {
        headers: { ...headers, 'Prefer': 'count=exact', 'Range': '0-0' }
      });
      const countRange = countRes.headers.get('content-range') || '0/0';
      const total = parseInt(countRange.split('/')[1] || '0');

      // Get verdict breakdown
      const verdictsRes = await fetch(`${supabaseUrl}/rest/v1/rpc/upsert_watch_records`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify([])
      }).catch(() => null);

      // Get brand breakdown via select
      const brandRes = await fetch(`${supabaseUrl}/rest/v1/watch_records?select=brand&limit=100000`, {
        headers
      });
      const brandRows = await brandRes.json();
      const brandCounts = {};
      for (const r of brandRows) {
        brandCounts[r.brand] = (brandCounts[r.brand] || 0) + 1;
      }

      // Get verdict breakdown
      const verdictRes = await fetch(`${supabaseUrl}/rest/v1/watch_records?select=verdict&limit=100000`, {
        headers
      });
      const verdictRows = await verdictRes.json();
      const verdictCounts = {};
      for (const r of verdictRows) {
        verdictCounts[r.verdict] = (verdictCounts[r.verdict] || 0) + 1;
      }

      return res.status(200).json({
        total,
        brands: brandCounts,
        verdicts: verdictCounts,
        cached_at: new Date().toISOString(),
      });
    }

    // === PAGINATED DATA MODE ===
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(1000, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;
    const endRange = offset + limitNum - 1;

    // Build query
    let query = `${supabaseUrl}/rest/v1/watch_records?select=*&order=${order}.${ascending === 'true' ? 'asc' : 'desc'}`;

    // Filters
    const filters = [];
    if (brand) filters.push(`brand=eq.${encodeURIComponent(brand)}`);
    if (verdict) filters.push(`verdict=eq.${encodeURIComponent(verdict)}`);
    if (reference) filters.push(`reference=eq.${encodeURIComponent(reference)}`);
    if (dial_color) filters.push(`dial_color=eq.${encodeURIComponent(dial_color)}`);
    if (search) filters.push(`reference=ilike.%${encodeURIComponent(search)}%`);

    if (filters.length > 0) {
      query += '&' + filters.join('&');
    }

    // Add range header for pagination
    const dataRes = await fetch(`${query}`, {
      headers: { ...headers, 'Range': `${offset}-${endRange}`, 'Prefer': 'count=exact' }
    });

    if (!dataRes.ok) {
      const errBody = await dataRes.text();
      return res.status(dataRes.status).json({ error: 'Supabase error', detail: errBody.substring(0, 200) });
    }

    const data = await dataRes.json();
    const contentRange = dataRes.headers.get('content-range') || `${offset}-${endRange}/${data.length}`;
    const total = parseInt(contentRange.split('/')[1] || '0');

    return res.status(200).json({
      data,
      page: pageNum,
      limit: limitNum,
      total,
      pages: Math.ceil(total / limitNum),
    });

  } catch (e) {
    return res.status(500).json({ error: 'Internal error', detail: e.message });
  }
}
