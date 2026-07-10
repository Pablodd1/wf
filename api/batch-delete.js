const { getClient } = require('./_lib/supabase');
const { setCorsHeaders } = require('./_lib/cors');


module.exports = async function handler(req, res) {
  if (setCorsHeaders(res, req)) return;
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { batch_id, admin_key } = req.body;

  if (admin_key !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Invalid admin key' });
  }

  if (!batch_id) return res.status(400).json({ error: 'batch_id required' });

  const client = getClient();

  try {
    // Delete from staging
    const { error: stagingError } = await client
      .from('watch_staging')
      .delete()
      .eq('batch_id', batch_id);

    if (stagingError) throw stagingError;

    // Delete batch job
    const { error: batchError } = await client
      .from('batch_jobs')
      .delete()
      .eq('id', batch_id);

    if (batchError) throw batchError;

    res.status(200).json({
      success: true,
      batch_id,
      message: 'Batch and all staging records deleted.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
