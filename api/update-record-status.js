/**
 * API: Update Record Status
 * Approve or reject a normalized record
 */

const { createClient } = require('@supabase/supabase-js');

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { record_id, status, notes } = req.body;

  if (!record_id || !status) {
    return res.status(400).json({ error: 'record_id and status are required' });
  }

  if (!['APPROVED', 'REJECTED', 'PENDING'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    );

    // Update the record
    const { data, error } = await supabase
      .from('normalized_records')
      .update({
        status,
        reviewed_at: new Date().toISOString(),
        review_notes: notes || null
      })
      .eq('id', record_id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    // Log the review action
    await supabase
      .from('review_log')
      .insert([{
        record_id,
        action: status,
        notes,
        reviewed_at: new Date().toISOString()
      }]);

    return res.status(200).json({
      success: true,
      record: data
    });

  } catch (error) {
    console.error('Error updating record:', error);
    return res.status(500).json({ 
      error: 'Failed to update record',
      details: error.message 
    });
  }
}

module.exports = handler;
