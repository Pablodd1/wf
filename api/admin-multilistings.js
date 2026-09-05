'use strict';

const { authorizeDealer } = require('./_lib/dealer-auth.cjs');

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const authorization = await authorizeDealer(req, res, new Set(['admin']));
  if (authorization.error) return res.status(authorization.status).json({ error: authorization.error });

  const page = boundedInteger(req.query?.page, 1, 1, 1000000);
  const pageSize = boundedInteger(req.query?.pageSize, 25, 1, 100);
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  try {
    const { data: shadowRows, count, error } = await authorization.client
      .from('normalization_shadow_v4')
      .select('source_record_id,candidate_count,proposed_candidates,change_flags,review_status,analyzed_at', { count: 'planned' })
      .contains('change_flags', ['BUNDLE_SPLIT_REQUIRED'])
      .order('source_record_id', { ascending: true })
      .range(from, to);
    if (error) throw error;

    const sourceIds = (shadowRows || []).map(row => row.source_record_id);
    const { data: sources, error: sourceError } = sourceIds.length
      ? await authorization.client.from('watch_records')
        .select('id,raw_message,brand,reference,listing_type,created_at,source,seller_name,seller_phone')
        .in('id', sourceIds)
      : { data: [], error: null };
    if (sourceError) throw sourceError;
    const sourceById = new Map((sources || []).map(row => [row.id, row]));

    return res.status(200).json({
      success: true,
      page,
      pageSize,
      total: count || 0,
      records: (shadowRows || []).map(row => ({
        ...row,
        source: sourceById.get(row.source_record_id) || null,
      })),
      policy: {
        parent_immutable: true,
        candidates_review_only: true,
        suppress_parent_after_approval: true,
        deduplicate_after_split: true,
      },
    });
  } catch (error) {
    console.error('[admin-multilistings]', error.message);
    return res.status(500).json({ error: 'Unable to load multi-listing review queue.' });
  }
};
