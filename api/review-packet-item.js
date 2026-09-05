'use strict';

const { authorizeDealer } = require('./_lib/dealer-auth.cjs');
const { redactPublicSource } = require('./_lib/source-redaction.cjs');
const { maskName, maskPhone, sha256, validId } = require('./_lib/review-packets.cjs');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await authorizeDealer(req, res, new Set(['reviewer', 'admin']));
  if (auth.error) return res.status(auth.status).json({ error: auth.error });
  const itemId = validId(req.query?.itemId);
  if (!itemId) return res.status(400).json({ error: 'Valid itemId required' });

  try {
    const { data: item, error: itemError } = await auth.client
      .from('normalization_review_packet_items')
      .select('id,packet_id,ordinal,source_record_id,normalization_version,status,frozen_proposal,proposal_sha256,raw_message_sha256')
      .eq('id', itemId)
      .maybeSingle();
    if (itemError) throw itemError;
    if (!item) return res.status(404).json({ error: 'Review packet item not found' });

    const [{ data: packet, error: packetError }, { data: source, error: sourceError }, { data: decision, error: decisionError }] = await Promise.all([
      auth.client.from('normalization_review_packets')
        .select('reason,status').eq('id', item.packet_id).maybeSingle(),
      auth.client.from('watch_records')
        .select('id,raw_message,brand,reference,dial_color,condition,price_raw,price_usd,currency,listing_type,listing_date,created_at,source,source_type,image_urls,thumbnail_url,seller_name,seller_phone')
        .eq('id', item.source_record_id).maybeSingle(),
      auth.client.from('normalization_review_packet_decisions')
        .select('id,decision,correction_fields,rationale,evidence_hashes,created_at')
        .eq('packet_item_id', item.id).maybeSingle(),
    ]);
    if (packetError || sourceError || decisionError) throw packetError || sourceError || decisionError;
    if (!packet || !source) return res.status(409).json({ error: 'Packet source evidence is unavailable' });

    const { data: stagingRows, error: stagingError } = await auth.client
      .from('watch_staging')
      .select('id')
      .eq('field_confidence->>source_record_id', item.source_record_id)
      .limit(2);
    if (stagingError) throw stagingError;
    const stagingId = stagingRows?.length === 1 ? stagingRows[0].id : null;
    const currentRawHash = sha256(source.raw_message || '');
    const contactAvailable = Boolean(source.seller_name || source.seller_phone);

    return res.status(200).json({
      status: 'ok',
      item: {
        id: item.id,
        packetId: item.packet_id,
        ordinal: item.ordinal,
        reason: packet.reason,
        normalizationVersion: item.normalization_version,
        status: item.status,
        currentStatus: decision?.decision || item.status,
        proposal: item.frozen_proposal,
        proposalHash: item.proposal_sha256,
        rawEvidenceHash: item.raw_message_sha256,
        sourceEvidence: {
          rawMessage: redactPublicSource(source.raw_message || ''),
          brand: source.brand || null,
          reference: source.reference || null,
          dialColor: source.dial_color || null,
          condition: source.condition || null,
          priceRaw: source.price_raw ?? null,
          priceUsd: source.price_usd ?? null,
          currency: source.currency || null,
          listingType: source.listing_type || null,
          listingDate: source.listing_date || source.created_at || null,
          source: source.source || null,
          sourceType: source.source_type || null,
          imageUrls: Array.isArray(source.image_urls) ? source.image_urls : [],
          thumbnailUrl: source.thumbnail_url || null,
        },
        evidenceFresh: currentRawHash === item.raw_message_sha256,
        contact: {
          sellerNameMasked: maskName(source.seller_name),
          sellerPhoneMasked: maskPhone(source.seller_phone),
          available: contactAvailable,
          reveal: contactAvailable && stagingId
            ? { endpoint: '/api/reviewer-contact-reveal', stagingId }
            : null,
        },
        decision: decision ? {
          id: decision.id,
          status: decision.decision,
          fields: decision.correction_fields,
          rationale: decision.rationale,
          evidenceHashes: decision.evidence_hashes,
          createdAt: decision.created_at,
        } : null,
      },
    });
  } catch (error) {
    console.error('[review-packet-item]', error);
    return res.status(500).json({ status: 'unavailable', error: 'Review packet evidence is unavailable' });
  }
};
