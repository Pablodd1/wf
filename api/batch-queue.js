const { getClient } = require('./_lib/supabase');
const { setCorsHeaders } = require('./_lib/cors');


module.exports = async function handler(req, res) {
  if (setCorsHeaders(res, req)) return;
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { status, admin_key } = req.query;

  if (admin_key !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Invalid admin key' });
  }

  try {
    const client = getClient();
    let query = client
      .from('batch_jobs')
      .select('*')
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error } = await query.limit(50);
    if (error) throw error;

    res.status(200).json({
      batches: data || [],
      count: data?.length || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
