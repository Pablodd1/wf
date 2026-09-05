/**
 * CORRECTIONS API — /api/corrections
 *
 * GET  /api/corrections?raw=<message>  — check if a raw message has a stored correction
 * POST /api/corrections                — save a new correction (from admin)
 *
 * POST body: { pattern, brand?, reference?, dial_color? }
 * Response: { matched: true, brand, reference, dial_color } or { matched: false }
 */
const { getClient } = require('./_lib/supabase');
const { authorizeMutation } = require('./_lib/authorize-mutation.cjs');

let _cache = null;
let _cacheAt = 0;

async function loadCache(client) {
  const now = Date.now();
  if (_cache && now - _cacheAt < 60_000) return;
  try {
    const { data } = await client.from('corrections')
      .select('pattern, brand, reference, dial_color')
      .order('created_at', { ascending: false });
    _cache = data || [];
    _cacheAt = now;
  } catch { /* non-critical */ }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const client = getClient();
  await loadCache(client);

  if (req.method === 'GET') {
    const raw = (req.query.raw || '').trim();
    if (!raw) return res.status(400).json({ error: 'raw query param required' });

    const lower = raw.toLowerCase();
    for (const c of _cache || []) {
      if (lower.includes(c.pattern.toLowerCase())) {
        return res.status(200).json({
          matched: true,
          brand: c.brand || undefined,
          reference: c.reference || undefined,
          dial_color: c.dial_color || undefined,
        });
      }
    }
    return res.status(200).json({ matched: false });
  }

  if (req.method === 'POST') {
    if (!await authorizeMutation(req, res, new Set(['admin']))) return;
    const { pattern, brand, reference, dial_color } = req.body || {};
    if (!pattern) return res.status(400).json({ error: 'pattern required' });

    try {
      const { error } = await client.from('corrections').insert({
        pattern,
        brand: brand || null,
        reference: reference || null,
        dial_color: dial_color || null,
      });
      if (error) throw error;
      _cache = null; // invalidate
      return res.status(200).json({ success: true, saved: true });
    } catch (e) {
      return res.status(500).json({ error: 'Failed to save correction', detail: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
