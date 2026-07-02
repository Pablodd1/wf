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
    // Update batch status to normalizing
    await client
      .from('batch_jobs')
      .update({ status: 'normalizing', started_at: new Date().toISOString() })
      .eq('id', batch_id);

    // Fetch pending records for this batch
    const { data: records, error: fetchError } = await client
      .from('watch_staging')
      .select('*')
      .eq('batch_id', batch_id)
      .eq('verdict', 'PENDING');

    if (fetchError) throw fetchError;

    let approved = 0;
    let review = 0;
    let recycle = 0;

    // Simple normalization rules (replace with AI later)
    for (const record of records) {
      let verdict = 'REVIEW';
      let confidence = 50;

      const hasBrand = record.brand && record.brand.length > 1;
      const hasRef = record.reference && record.reference.length > 3;
      const hasPrice = record.price_usd && record.price_usd > 100;

      if (hasBrand && hasRef && hasPrice) {
        verdict = 'APPROVED';
        confidence = 85;
      } else if (!hasBrand && !hasRef) {
        verdict = 'RECYCLE';
        confidence = 20;
      }

      const { error: updateError } = await client
        .from('watch_staging')
        .update({
          verdict,
          confidence,
          normalized_at: new Date().toISOString()
        })
        .eq('id', record.id);

      if (!updateError) {
        if (verdict === 'APPROVED') approved++;
        else if (verdict === 'REVIEW') review++;
        else recycle++;
      }
    }

    // Update batch status to ready
    await client
      .from('batch_jobs')
      .update({
        status: 'ready',
        completed_at: new Date().toISOString(),
        approved_count: approved,
        review_count: review,
        recycle_count: recycle
      })
      .eq('id', batch_id);

    res.status(200).json({
      success: true,
      batch_id,
      status: 'ready',
      breakdown: { approved, review, recycle, total: records.length },
      message: 'Batch normalized. Run /api/batch-publish to move APPROVED to live.'
    });
  } catch (err) {
    console.error('Batch normalize error:', err);
    res.status(500).json({ error: err.message });
  }
};
