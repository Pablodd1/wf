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
    // Verify batch is ready
    const { data: batch, error: batchError } = await client
      .from('batch_jobs')
      .select('*')
      .eq('id', batch_id)
      .single();

    if (batchError || !batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    if (batch.status !== 'ready') {
      return res.status(400).json({
        error: `Batch status is "${batch.status}". Must be "ready" to publish.`
      });
    }

    // Fetch APPROVED records from staging
    const { data: approvedRecords, error: fetchError } = await client
      .from('watch_staging')
      .select('*')
      .eq('batch_id', batch_id)
      .eq('verdict', 'APPROVED');

    if (fetchError) throw fetchError;

    // Move to live watch_records table
    const liveRecords = approvedRecords.map(r => ({
      id: r.id,  // Preserve UUID from staging
      brand: r.brand,
      reference: r.reference,
      dial_color: r.dial_color,
      condition: r.condition,
      year: r.year,
      price_raw: r.price_raw,
      price_usd: r.price_usd,
      currency: r.currency,
      source: r.source,
      raw_message: r.raw_message,
      confidence: r.confidence,
      verdict: 'APPROVED',
      created_at: r.created_at,
      processed_at: new Date().toISOString(),
      parser_version: r.parser_version,
      listing_type: r.listing_type || 'WTS'
    }));

    // Insert in chunks
    const chunkSize = 1000;
    let inserted = 0;
    for (let i = 0; i < liveRecords.length; i += chunkSize) {
      const chunk = liveRecords.slice(i, i + chunkSize);
      const { error: insertError } = await client
        .from('watch_records')
        .insert(chunk);
      if (insertError) throw insertError;
      inserted += chunk.length;
    }

    // Update batch status to published
    await client
      .from('batch_jobs')
      .update({
        status: 'published',
        published_at: new Date().toISOString(),
        published_count: inserted
      })
      .eq('id', batch_id);

    res.status(200).json({
      success: true,
      batch_id,
      status: 'published',
      records_published: inserted,
      message: `${inserted} records moved to live site.`
    });
  } catch (err) {
    console.error('Batch publish error:', err);
    res.status(500).json({ error: err.message });
  }
};
