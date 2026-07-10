const { getClient } = require('./_lib/supabase');
const { setCorsHeaders } = require('./_lib/cors');


module.exports = async function handler(req, res) {
  if (setCorsHeaders(res, req)) return;
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { ids, updates, admin_key } = req.body;

  if (admin_key !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Invalid admin key' });
  }

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array required' });
  }

  try {
    const client = getClient();
    const { error } = await client
      .from('watch_staging')
      .update({
        ...updates,
        human_edited: true,
        processed_at: new Date().toISOString()
      })
      .in('id', ids);

    if (error) throw error;

    res.status(200).json({ success: true, updated: ids.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
