/**
 * POST /api/bulk-action
 * Body: { ids: ['1','2'], action: 'approve'|'recycle'|'review'|'human' }
 * Bulk change verdicts for review workflow
 */
const { getPool } = require('./_lib/db');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { ids, action } = req.body;
    if (!ids || !Array.isArray(ids) || !action) {
      return res.status(400).json({ error: 'ids (array) and action required' });
    }

    const verdictMap = {
      approve: 'APPROVED',
      recycle: 'RECYCLE',
      review: 'REVIEW',
      human: 'HUMAN',
    };

    const verdict = verdictMap[action.toLowerCase()];
    if (!verdict) return res.status(400).json({ error: 'Invalid action' });

    const pool = getPool();
    const placeholders = ids.map(() => '?').join(',');
    
    const [result] = await pool.execute(
      `UPDATE watch_records SET verdict = ?, updated_at = NOW() WHERE id IN (${placeholders})`,
      [verdict, ...ids]
    );

    res.status(200).json({
      success: true,
      updated: result.affectedRows,
      verdict,
    });
  } catch (err) {
    console.error('Bulk action error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
