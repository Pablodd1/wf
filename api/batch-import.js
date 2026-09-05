'use strict';

const { requireServiceToken } = require('./_lib/require-service-token.cjs');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (!requireServiceToken(req, res)) return;
  return res.status(410).json({
    error: 'Legacy direct import retired',
    reason: 'It inferred missing currency and could publish imported rows without the evidence-first review pipeline.',
    replacement: 'Use the checkpointed raw-message migration and normalization shadow workflow.',
  });
};
