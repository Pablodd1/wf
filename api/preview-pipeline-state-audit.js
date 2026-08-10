'use strict';

const { runAudit } = require('../scripts/read_only_pipeline_state_audit.cjs');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (process.env.VERCEL_ENV !== 'preview') return res.status(404).json({ error: 'Not found' });

  try {
    return res.status(200).json(await runAudit(process.env));
  } catch (error) {
    console.error('[preview-pipeline-state-audit] error:', error.message);
    return res.status(503).json({
      audit_mode: 'READ_ONLY_AGGREGATES',
      error: 'Pipeline state is temporarily unavailable',
    });
  }
};
