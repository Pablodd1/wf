'use strict';

const { authorizeDealer } = require('./_lib/dealer-auth.cjs');
const { sameOrigin, sha256 } = require('./_lib/review-packets.cjs');
const { MIN_RELEASE_CONFIDENCE, isReleaseListingEligible } = require('./_lib/publication-references.cjs');

const QUEUE_FIELDS = [
  'source_object_key',
  'public_url',
  'record_id',
  'brand',
  'model',
  'reference',
  'dial_color',
  'raw_message',
  'image_status',
  'identity_status',
  'evidence',
].join(',');
const VERIFIED_IDENTITY_STATUSES = ['CATALOG_CONFIRMED', 'HUMAN_APPROVED'];
const RPC_DECISIONS = {
  MATCH: 'VISUALLY_VERIFIED',
  NO_MATCH: 'REJECTED',
};

function validateDecisionBody(body) {
  const sourceObjectKey = String(body?.sourceObjectKey || '').trim();
  const recordId = String(body?.recordId || '').trim();
  const visualMatch = String(body?.visualMatch || '').trim().toUpperCase();
  const reason = String(body?.reason || '').trim();
  if (!sourceObjectKey || sourceObjectKey.length > 1024) return { error: 'Valid sourceObjectKey required' };
  if (!recordId || recordId.length > 200) return { error: 'Valid recordId required' };
  if (!RPC_DECISIONS[visualMatch]) return { error: 'visualMatch must be MATCH or NO_MATCH' };
  if (reason.length < 12 || reason.length > 1000) {
    return { error: 'reason must contain 12 to 1000 characters' };
  }
  return { value: { sourceObjectKey, recordId, visualMatch, reason } };
}

function text(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function exactIdentitySnapshot(queueRow, identity) {
  if (!identity || !VERIFIED_IDENTITY_STATUSES.includes(identity.status)) {
    throw new Error('VERIFIED_IDENTITY_REQUIRED');
  }
  const snapshot = {
    brand: text(identity.canonical_brand) || text(queueRow.brand),
    model: text(identity.canonical_model) || text(queueRow.model),
    reference: text(identity.canonical_reference) || text(queueRow.reference),
    dial_color: text(identity.canonical_dial_color) || text(queueRow.dial_color),
  };
  if (Object.values(snapshot).some(value => !value)) throw new Error('COMPLETE_IDENTITY_REQUIRED');
  return snapshot;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!sameOrigin(req)) return res.status(403).json({ error: 'Invalid request origin' });

  const auth = await authorizeDealer(req, res, new Set(['reviewer', 'admin']));
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const validation = validateDecisionBody(req.body);
  if (validation.error) return res.status(400).json({ error: validation.error });

  const { sourceObjectKey, recordId, visualMatch, reason } = validation.value;
  try {
    const { data: queueRow, error: queueError } = await auth.client
      .from('image_identity_review_queue')
      .select(QUEUE_FIELDS)
      .eq('source_object_key', sourceObjectKey)
      .eq('record_id', recordId)
      .eq('image_status', 'SOURCE_LINKED')
      .in('identity_status', VERIFIED_IDENTITY_STATUSES)
      .maybeSingle();
    if (queueError) throw queueError;
    if (!queueRow) {
      return res.status(409).json({ error: 'Image review item changed or is no longer pending; reload the queue' });
    }

    const { data: identity, error: identityError } = await auth.client
      .from('listing_identity_reviews')
      .select('record_id,status,canonical_brand,canonical_model,canonical_reference,canonical_dial_color')
      .eq('record_id', recordId)
      .in('status', VERIFIED_IDENTITY_STATUSES)
      .maybeSingle();
    if (identityError) throw identityError;
    const identitySnapshot = exactIdentitySnapshot(queueRow, identity);
    const { data: releaseListing, error: releaseListingError } = await auth.client
      .from('price_research_verified_source')
      .select('id,verdict,confidence')
      .eq('id', recordId)
      .eq('verdict', 'APPROVED')
      .gte('confidence', MIN_RELEASE_CONFIDENCE)
      .maybeSingle();
    if (releaseListingError) throw releaseListingError;
    if (!isReleaseListingEligible({
      ...releaseListing,
      brand: identitySnapshot.brand,
      reference: identitySnapshot.reference,
    })) {
      return res.status(409).json({ error: 'Listing is outside the configured reviewed publication release' });
    }
    if (!text(queueRow.public_url) || !text(queueRow.raw_message)) {
      return res.status(409).json({ error: 'Image review evidence is incomplete; correct the structural evidence first' });
    }

    const operatorId = auth.user.email || auth.user.id;
    if (!operatorId) return res.status(403).json({ error: 'Authenticated operator identity required' });
    const evidence = {
      visual_match: visualMatch,
      review_surface: 'image_identity_review_queue',
      source_object_key: sourceObjectKey,
      record_id: recordId,
      public_url: queueRow.public_url,
      raw_message_sha256: sha256(queueRow.raw_message),
      image_status: queueRow.image_status,
      identity_status: identity.status,
      prior_image_evidence: queueRow.evidence || {},
      reviewer_role: auth.role,
    };
    const { data: result, error: rpcError } = await auth.client.rpc('apply_listing_image_review', {
      p_source_object_key: sourceObjectKey,
      p_record_id: recordId,
      p_decision: RPC_DECISIONS[visualMatch],
      p_operator_id: operatorId,
      p_reason: reason,
      p_identity_snapshot: identitySnapshot,
      p_evidence: evidence,
    });
    if (rpcError) throw rpcError;
    return res.status(200).json({ status: 'ok', result });
  } catch (error) {
    const message = String(error?.message || '');
    console.error('[image-review-decision]', error);
    if (/IDENTITY_REQUIRED|Manifest ownership|identity snapshot|not found|visual_match/i.test(message)) {
      return res.status(409).json({ error: 'Image or identity evidence changed; reload before deciding' });
    }
    return res.status(500).json({ error: 'Image review decision failed' });
  }
};

module.exports.exactIdentitySnapshot = exactIdentitySnapshot;
module.exports.validateDecisionBody = validateDecisionBody;
