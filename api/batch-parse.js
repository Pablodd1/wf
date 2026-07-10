const { getClient } = require('./_lib/supabase');
const { setCorsHeaders } = require('./_lib/cors');


module.exports = async function handler(req, res) {
  if (setCorsHeaders(res, req)) return;
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { data: records, error } = await getClient()
      .from('watch_records')
      .select('*')
      .eq('verdict', 'REVIEW')
      .limit(50);

    if (error) throw error;
    res.status(200).json({ success: true, count: records.length, records });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
