/**
 * POST /api/bulk-action
 * Body: { ids: ['1','2'], action: 'approve'|'recycle'|'review'|'human' }
 * Bulk change verdicts — SUPABASE
 */
const { bulkUpdateVerdicts } = require('./_lib/supabase');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { ids, action } = req.body;
    if (!ids || !Array.isArray(ids) || !action) {
      return res.status(400).json({ error: 'ids (array) and action required' });
    }

    const verdictMap = { approve: 'APPROVED', recycle: 'RECYCLE', review: 'REVIEW', human: 'HUMAN' };
    const verdict = verdictMap[action.toLowerCase()];
    if (!verdict) return res.status(400).json({ error: 'Invalid action' });

    const updated = await bulkUpdateVerdicts(ids, verdict);

    res.status(200).json({ success: true, updated, verdict });
  } catch (err) {
    console.error('Bulk action error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
