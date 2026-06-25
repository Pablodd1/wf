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

      // Use count=exact per verdict via parallel HEAD requests (no row downloads)
      const verdictList = ['APPROVED','REVIEW','HUMAN','RECYCLE'];
      const verdictCounts = {};
      await Promise.all(verdictList.map(async (v) => {
        const r = await fetch(`${supabaseUrl}/rest/v1/watch_records?select=count&verdict=eq.${v}`, {
          headers: { ...headers, 'Prefer': 'count=exact' }
        });
        const cr = r.headers.get('content-range') || '0/0';
        verdictCounts[v] = parseInt(cr.split('/')[1] || '0');
      }));

      // Brand breakdown via count queries for top brands (no full row download)
      const topBrands = ['Rolex','Patek Philippe','Audemars Piguet','Richard Mille','Cartier',
        'Vacheron Constantin','Omega','A. Lange & Sohne','Tudor','F.P. Journe',
        'Hublot','Panerai','Jaeger-LeCoultre','Breitling','IWC'];
      const brandCounts = {};
      await Promise.all(topBrands.map(async (b) => {
        const r = await fetch(
          `${supabaseUrl}/rest/v1/watch_records?select=count&brand=eq.${encodeURIComponent(b)}`,
          { headers: { ...headers, 'Prefer': 'count=exact' } }
        );
        const cr = r.headers.get('content-range') || '0/0';
        const cnt = parseInt(cr.split('/')[1] || '0');
        if (cnt > 0) brandCounts[b] = cnt;
      }));

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
