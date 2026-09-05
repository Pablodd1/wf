'use strict';

const crypto = require('node:crypto');
const { getClient } = require('./supabase');

function clientAddress(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || String(req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown');
}

function clientHash(req) {
  const secret = process.env.AI_RATE_LIMIT_SECRET
    || process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error('AI quota secret is not configured');
  return crypto.createHmac('sha256', secret).update(clientAddress(req)).digest('hex');
}

async function consumeAiQuota(req, { route, limit, windowSeconds = 60 }) {
  try {
    const client = getClient();
    const { data, error } = await client.rpc('consume_ai_api_quota', {
      p_route: route,
      p_client_hash: clientHash(req),
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) throw error;
    return data || { allowed: false, reason: 'quota_unavailable' };
  } catch (error) {
    console.error('[ai-quota]', error.message);
    return { allowed: false, reason: 'quota_unavailable' };
  }
}

function rejectForQuota(res, quota) {
  if (quota?.reason === 'quota_unavailable') {
    res.status(503).json({ error: 'AI service temporarily unavailable' });
  } else {
    res.setHeader('Retry-After', String(quota?.retry_after_seconds || 60));
    res.status(429).json({ error: 'AI request limit reached. Please retry shortly.' });
  }
}

module.exports = { clientAddress, clientHash, consumeAiQuota, rejectForQuota };
