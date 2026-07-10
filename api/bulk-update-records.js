/**
 * API: Bulk Update Records
 * Approve or reject multiple records at once
 */

const { createClient } = require('@supabase/supabase-js');

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { batch_id, status, filter } = req.body;

  if (!batch_id || !status) {
    return res.status(400).json({ error: 'batch_id and status are required' });
  }

  if (!['APPROVED', 'REJECTED'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Build query
    let query = supabase
      .from('normalized_records')
      .update({
        status,
        reviewed_at: new Date().toISOString()
      })
      .eq('batch_id', batch_id);

    // Apply filter if provided
    if (filter === 'pending') {
      query = query.eq('status', 'PENDING');
    } else if (filter === 'flagged') {
      query = query.eq('validation_status', 'flagged');
    }

    const { data, error } = await query.select();

    if (error) {
      throw error;
    }

    // Log bulk action
    await supabase
      .from('review_log')
      .insert([{
        batch_id,
        action: `BULK_${status}`,
        filter,
        records_affected: data.length,
        reviewed_at: new Date().toISOString()
      }]);

    return res.status(200).json({
      success: true,
      updated_count: data.length,
      records: data
    });

  } catch (error) {
    console.error('Error bulk updating records:', error);
    return res.status(500).json({ 
      error: 'Failed to bulk update records',
      details: error.message 
    });
  }
}

module.exports = handler;
