'use strict';

const FLAGS = new Set([
  'BUNDLE_SPLIT_REQUIRED',
  'NO_CANDIDATE',
  'REFERENCE_CHANGED',
  'INTENT_CHANGED',
  'PRICE_CHANGED',
  'BRAND_CHANGED',
  'CURRENCY_CHANGED',
  'CURRENCY_AMBIGUOUS',
  'PRICE_PARSE_FAILED',
  'EMOJI_PRICE_AMBIGUOUS',
]);

async function rest(baseUrl, key, path) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!response.ok) throw new Error(`Supabase ${response.status}`);
  return response.json();
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const runToken = process.env.SHADOW_RUN_TOKEN;
  if (!runToken || req.headers['x-shadow-token'] !== runToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const baseUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !key) return res.status(503).json({ error: 'Supabase server configuration missing' });

  const requestedFlag = String(req.query?.flag || '').trim().toUpperCase();
  if (requestedFlag && !FLAGS.has(requestedFlag)) {
    return res.status(400).json({ error: 'Unknown shadow flag' });
  }
  const limit = Math.max(1, Math.min(Number(req.query?.limit || 10), 20));
  const params = new URLSearchParams({
    select: [
      'source_record_id',
      'source_brand',
      'source_reference',
      'source_price_raw',
      'source_price_usd',
      'source_currency',
      'source_listing_type',
      'candidate_count',
      'proposed_candidates',
      'change_flags',
      'review_status',
      'analyzed_at',
    ].join(','),
    order: 'analyzed_at.desc',
    limit: String(limit),
  });
  if (requestedFlag) params.set('change_flags', `cs.{${requestedFlag}}`);

  try {
    const samples = await rest(baseUrl, key, `normalization_shadow_v4?${params.toString()}`);
    const sourceIds = samples.map(sample => sample.source_record_id).filter(Boolean);
    const rawMessagesById = new Map();
    if (sourceIds.length) {
      const sourceParams = new URLSearchParams({
        select: 'id,raw_message',
        id: `in.(${sourceIds.join(',')})`,
      });
      const sourceRows = await rest(baseUrl, key, `watch_records?${sourceParams.toString()}`);
      sourceRows.forEach(row => {
        rawMessagesById.set(row.id, String(row.raw_message || '').slice(0, 4000));
      });
    }
    return res.status(200).json({
      status: 'ok',
      flag: requestedFlag || null,
      count: samples.length,
      // This endpoint is protected by the temporary shadow-review token.
      // Keeping original text here gives reviewers enough evidence to judge
      // parser corrections without exposing raw dealer content publicly.
      samples: samples.map(sample => ({
        ...sample,
        source_raw_message: rawMessagesById.get(sample.source_record_id) || null,
      })),
    });
  } catch (error) {
    console.error('[shadow-samples]', error);
    return res.status(500).json({ error: 'Shadow sample retrieval failed' });
  }
};
