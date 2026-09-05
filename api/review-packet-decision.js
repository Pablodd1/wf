'use strict';

const { authorizeDealer } = require('./_lib/dealer-auth.cjs');
const { sameOrigin, validId, validateCorrection } = require('./_lib/review-packets.cjs');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Invalid request origin' });

  const auth = await authorizeDealer(req, res, new Set(['reviewer', 'admin']));
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const itemId = validId(req.body?.itemId);
  if (!itemId) return res.status(400).json({ error: 'Valid itemId required' });
  const validation = validateCorrection(req.body);
  if (validation.error) return res.status(400).json({ error: validation.error });

  try {
    const correction = validation.value;
    const { data, error } = await auth.client.rpc('propose_normalization_review_correction', {
      p_packet_item_id: itemId,
      p_correction_fields: correction.fields,
      p_rationale: correction.rationale,
      p_expected_raw_sha256: correction.expectedRawSha256,
      p_expected_proposal_sha256: correction.expectedProposalSha256,
      p_evidence_hashes: correction.evidenceHashes,
      p_reviewer_id: auth.user.id,
      p_reviewer_email: auth.user.email || null,
      p_reviewer_role: auth.role,
    });
    if (error) throw error;
    return res.status(200).json({
      status: 'ok',
      decision: {
        id: data?.decision_id || null,
        itemId,
        status: 'CORRECTION_PROPOSED',
        createdAt: data?.created_at || null,
      },
      watchRecordsMutated: false,
    });
  } catch (error) {
    const message = String(error?.message || '');
    console.error('[review-packet-decision]', error);
    if (/STALE_|CORRECTION_ALREADY_PROPOSED|not found/i.test(message)) {
      return res.status(409).json({ error: 'Packet evidence changed or already has a correction proposal; reload before continuing' });
    }
    return res.status(500).json({ error: 'Correction proposal could not be recorded' });
  }
};
