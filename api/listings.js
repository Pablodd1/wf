/**
 * GET /api/listings
 * Queries Supabase directly with efficient, targeted filters.
 * IMPORTANT: never does count=exact or unfiltered created_at range scans
 * on the full 2.39M-row table — those trigger Supabase statement timeouts
 * (confirmed via direct testing: 8.3s -> error 57014). Always require at
 * least one selective filter (brand/reference/verdict) OR a small limit.
 *
 * Query params: page, limit, brand, reference, verdict, search
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bptrvfncppbjnchsaxtb.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJwdHJ2Zm5jcHBiam5jaHNheHRiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU2MjYzMSwiZXhwIjoyMDk3MTM4NjMxfQ.x1KpnBCtgcn02hiBJfuNkm3FYq6elHv3Gnys62nu8SU';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { page = '1', limit = '50', brand, reference, verdict, search } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    // Cap limit — this is a live query, not a static file. Large limits
    // (5000+) are fine for brand/reference-filtered queries since those
    // hit an index; unfiltered large limits risk timeouts.
    const limitNum = Math.min(5000, Math.max(1, parseInt(limit) || 50));
    const offset = (pageNum - 1) * limitNum;

    let query = `${SUPABASE_URL}/rest/v1/watch_records?select=id,brand,reference,dial_color,condition,price_usd,confidence,verdict,source,created_at,raw_message,human_edited`;

    if (brand) query += `&brand=eq.${encodeURIComponent(brand)}`;
    if (reference) query += `&reference=eq.${encodeURIComponent(reference)}`;
    if (verdict) query += `&verdict=eq.${encodeURIComponent(verdict)}`;
    if (search) {
      const s = encodeURIComponent(search);
      query += `&or=(brand.ilike.*${s}*,reference.ilike.*${s}*,raw_message.ilike.*${s}*)`;
    }

    query += `&order=created_at.desc&limit=${limitNum}&offset=${offset}`;

    const resp = await fetch(query, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
      },
    });

    if (!resp.ok) {
      const errBody = await resp.text();
      return res.status(200).json({ rows: [], total: 0, error: `Supabase ${resp.status}: ${errBody.substring(0, 200)}`, demo: true });
    }

    const rows = await resp.json();
    res.status(200).json({ rows: Array.isArray(rows) ? rows : [], total: Array.isArray(rows) ? rows.length : 0, page: pageNum, limit: limitNum });
  } catch (err) {
    res.status(200).json({ rows: [], total: 0, error: err.message, demo: true });
  }
};
