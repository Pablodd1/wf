'use strict';

const { authorizeDealer } = require('./_lib/dealer-auth.cjs');

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  try { return new URL(origin).host === host; } catch { return false; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Invalid request origin' });

  const auth = await authorizeDealer(req, res, new Set(['reviewer', 'admin']));
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const stagingId = String(req.body?.stagingId || '').trim();
  const reason = String(req.body?.reason || '').trim().slice(0, 500);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stagingId)) {
    return res.status(400).json({ error: 'Valid stagingId required' });
  }
  if (reason.length < 10) return res.status(400).json({ error: 'Reveal reason required' });

  const { data: staged, error: stageError } = await auth.client
    .from('watch_staging').select('id,field_confidence').eq('id', stagingId).maybeSingle();
  if (stageError || !staged) return res.status(404).json({ error: 'Staged listing not found' });

  const sourceRecordId = String(staged.field_confidence?.source_record_id || '').trim();
  if (!sourceRecordId) return res.status(409).json({ error: 'Exact seller lineage is unavailable' });

  const { data: sellers, error: sellerError } = await auth.client
    .from('seller_listing_lineage_staging')
    .select('source_identity,observed_name,source_posted_at,match_status')
    .eq('source_record_id', sourceRecordId).eq('match_status', 'MATCH_READY').limit(2);
  if (sellerError) return res.status(500).json({ error: 'Seller lineage lookup failed' });
  if (sellers?.length !== 1) return res.status(409).json({ error: 'Seller lineage is missing or ambiguous' });

  const { error: auditError } = await auth.client.from('reviewer_contact_access_audit').insert({
    reviewer_id: auth.user.id,
    reviewer_email: auth.user.email || null,
    reviewer_role: auth.role,
    staging_id: stagingId,
    source_record_id: sourceRecordId,
    reason,
  });
  if (auditError) return res.status(503).json({ error: 'Contact access audit is unavailable' });

  return res.status(200).json({
    status: 'ok',
    contact: {
      seller_name: sellers[0].observed_name || null,
      seller_phone: sellers[0].source_identity,
      original_posted_at: sellers[0].source_posted_at || null,
    },
  });
};
