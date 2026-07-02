const { getClient } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { ids, action } = req.body;
  if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'Invalid IDs' });

  try {
    let updateData = { human_edited: true, processed_at: new Date().toISOString() };
    if (action === 'approve') updateData.verdict = 'APPROVED';
    if (action === 'recycle') updateData.verdict = 'RECYCLE';

    const { error } = await getClient()
      .from('watch_records')
      .update(updateData)
      .in('id', ids);

    if (error) throw error;
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
