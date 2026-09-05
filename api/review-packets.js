'use strict';

const { authorizeDealer } = require('./_lib/dealer-auth.cjs');
const { boundedInteger, validId } = require('./_lib/review-packets.cjs');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await authorizeDealer(req, res, new Set(['reviewer', 'admin']));
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const limit = boundedInteger(req.query?.limit, 50, 1, 100);
  const packetId = req.query?.packetId ? validId(req.query.packetId) : null;
  if (req.query?.packetId && !packetId) return res.status(400).json({ error: 'Valid packetId required' });

  try {
    if (!packetId) {
      const after = req.query?.after ? validId(req.query.after) : null;
      if (req.query?.after && !after) return res.status(400).json({ error: 'Valid after cursor required' });
      let query = auth.client
        .from('normalization_review_packets')
        .select('id,reason,normalization_version,status,item_count,created_at')
        .order('id', { ascending: true })
        .limit(limit + 1);
      if (after) query = query.gt('id', after);
      const { data, error } = await query;
      if (error) throw error;
      const rows = data || [];
      const page = rows.slice(0, limit);
      return res.status(200).json({
        status: 'ok',
        mode: 'summaries',
        limit,
        nextCursor: rows.length > limit ? page.at(-1)?.id || null : null,
        items: page.map(row => ({
          id: row.id,
          reason: row.reason,
          normalizationVersion: row.normalization_version,
          status: row.status,
          itemCount: row.item_count,
          createdAt: row.created_at,
        })),
      });
    }

    const afterOrdinal = boundedInteger(req.query?.afterOrdinal, 0, 0, Number.MAX_SAFE_INTEGER);
    const { data: packet, error: packetError } = await auth.client
      .from('normalization_review_packets')
      .select('id,reason,normalization_version,status,item_count,created_at')
      .eq('id', packetId)
      .maybeSingle();
    if (packetError) throw packetError;
    if (!packet) return res.status(404).json({ error: 'Review packet not found' });

    const { data, error } = await auth.client
      .from('normalization_review_packet_item_compact')
      .select('id,ordinal,source_record_id,normalization_version,status,proposal_summary,proposal_sha256,raw_message_sha256')
      .eq('packet_id', packetId)
      .gt('ordinal', afterOrdinal)
      .order('ordinal', { ascending: true })
      .limit(limit + 1);
    if (error) throw error;
    const rows = data || [];
    const page = rows.slice(0, limit);
    const itemIds = page.map(row => row.id);
    let proposed = new Set();
    if (itemIds.length) {
      const { data: decisions, error: decisionError } = await auth.client
        .from('normalization_review_packet_decisions')
        .select('packet_item_id')
        .in('packet_item_id', itemIds);
      if (decisionError) throw decisionError;
      proposed = new Set((decisions || []).map(row => row.packet_item_id));
    }
    return res.status(200).json({
      status: 'ok',
      mode: 'items',
      packet: {
        id: packet.id,
        reason: packet.reason,
        normalizationVersion: packet.normalization_version,
        status: packet.status,
        itemCount: packet.item_count,
        createdAt: packet.created_at,
      },
      limit,
      afterOrdinal,
      nextOrdinal: rows.length > limit ? page.at(-1)?.ordinal || null : null,
      items: page.map(row => ({
        id: row.id,
        ordinal: row.ordinal,
        sourceRecordId: row.source_record_id,
        normalizationVersion: row.normalization_version,
        status: row.status,
        proposalHash: row.proposal_sha256,
        rawEvidenceHash: row.raw_message_sha256,
        summary: row.proposal_summary || {},
        correctionProposed: proposed.has(row.id),
      })),
    });
  } catch (error) {
    console.error('[review-packets]', error);
    return res.status(500).json({ status: 'unavailable', error: 'Normalization review packets are unavailable', items: [] });
  }
};
