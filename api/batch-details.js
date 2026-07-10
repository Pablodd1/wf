/**
 * API: Get Batch Details
 * Returns batch info with all normalized records
 */

const { createClient } = require('@supabase/supabase-js');

async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { batch_id } = req.query;

  if (!batch_id) {
    return res.status(400).json({ error: 'batch_id is required' });
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Get batch details
    const { data: batch, error: batchError } = await supabase
      .from('batches')
      .select('*')
      .eq('id', batch_id)
      .single();

    if (batchError) {
      throw batchError;
    }

    // Get all normalized records for this batch
    const { data: records, error: recordsError } = await supabase
      .from('normalized_records')
      .select(`
        *,
        watch_records (
          id,
          raw_message,
          received_at,
          source
        )
      `)
      .eq('batch_id', batch_id)
      .order('created_at', { ascending: true });

    if (recordsError) {
      throw recordsError;
    }

    // Calculate stats
    const stats = {
      total: records.length,
      approved: records.filter(r => r.status === 'APPROVED').length,
      rejected: records.filter(r => r.status === 'REJECTED').length,
      pending: records.filter(r => r.status === 'PENDING').length,
      avg_confidence: records.reduce((sum, r) => sum + (r.confidence_score || 0), 0) / records.length
    };

    return res.status(200).json({
      batch: { ...batch, stats },
      records
    });

  } catch (error) {
    console.error('Error fetching batch:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch batch',
      details: error.message 
    });
  }
}

module.exports = handler;
