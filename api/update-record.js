const { getClient } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { id, ...updates } = req.body;
  if (!id) return res.status(400).json({ error: 'Missing ID' });

  try {
    const { data, error } = await getClient()
      .from('watch_records')
      .update({ ...updates, processed_at: new Date().toISOString() })
      .eq('id', id)
      .select();

    if (error) throw error;
    res.status(200).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
