const { getClient } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { batch_id, admin_key } = req.body;

  if (admin_key !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Invalid admin key' });
  }

  if (!batch_id) return res.status(400).json({ error: 'batch_id required' });

  const client = getClient();

  try {
    // Update batch status to rejected
    await client
      .from('batch_jobs')
      .update({ status: 'rejected', rejected_at: new Date().toISOString() })
      .eq('id', batch_id);

    // Mark all staging records as rejected
    await client
      .from('watch_staging')
      .update({ verdict: 'REJECTED' })
      .eq('batch_id', batch_id);

    res.status(200).json({
      success: true,
      batch_id,
      status: 'rejected',
      message: 'Batch rejected. Records remain in staging for review.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
