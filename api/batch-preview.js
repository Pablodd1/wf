const { getClient } = require('./_lib/supabase');
const { setCorsHeaders } = require('./_lib/cors');


module.exports = async function handler(req, res) {
  if (setCorsHeaders(res, req)) return;
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { batch_id, admin_key, verdict } = req.query;

  if (admin_key !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Invalid admin key' });
  }

  if (!batch_id) return res.status(400).json({ error: 'batch_id required' });

  try {
    const client = getClient();
    let query = client
      .from('watch_staging')
      .select('*')
      .eq('batch_id', batch_id)
      .limit(20);

    if (verdict) query = query.eq('verdict', verdict);

    const { data, error } = await query;
    if (error) throw error;

    res.status(200).json({
      batch_id,
      preview_count: data?.length || 0,
      records: data || []
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
