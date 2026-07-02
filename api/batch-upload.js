const { getClient } = require('./_lib/supabase');
const crypto = require('crypto');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { records, source = 'batch_upload', admin_key } = req.body;

  // Simple admin gate — can be replaced with JWT later
  if (admin_key !== process.env.ADMIN_KEY) {
    return res.status(403).json({ error: 'Invalid admin key' });
  }

  if (!records || !Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records array required' });
  }

  if (records.length > 10000) {
    return res.status(400).json({ error: 'Max 10,000 records per batch' });
  }

  const batchId = crypto.randomUUID();
  const client = getClient();

  try {
    // Create batch job record
    const { error: batchError } = await client
      .from('batch_jobs')
      .insert({
        id: batchId,
        status: 'pending',
        record_count: records.length,
        source,
        created_at: new Date().toISOString()
      });

    if (batchError) throw batchError;

    // Insert into staging with batch_id
    const stagingRecords = records.map(r => ({
      batch_id: batchId,
      raw_message: r.raw_message || r.message || JSON.stringify(r),
      brand: r.brand || null,
      reference: r.reference || null,
      dial_color: r.dial_color || null,
      condition: r.condition || null,
      year: r.year || null,
      price_raw: r.price_raw || r.price || null,
      price_usd: r.price_usd || null,
      currency: r.currency || null,
      source: r.source || source,
      confidence: r.confidence || 0,
      verdict: 'PENDING',
      created_at: new Date().toISOString(),
      parser_version: 'batch_v1'
    }));

    // Insert in chunks of 1000 to avoid payload limits
    const chunkSize = 1000;
    for (let i = 0; i < stagingRecords.length; i += chunkSize) {
      const chunk = stagingRecords.slice(i, i + chunkSize);
      const { error: insertError } = await client
        .from('watch_staging')
        .insert(chunk);
      if (insertError) throw insertError;
    }

    res.status(200).json({
      success: true,
      batch_id: batchId,
      records_received: records.length,
      status: 'pending',
      message: 'Batch uploaded. Run /api/batch-normalize to process.'
    });
  } catch (err) {
    console.error('Batch upload error:', err);
    res.status(500).json({ error: err.message });
  }
};
