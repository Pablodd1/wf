'use strict';

const { authorizeDealer } = require('./_lib/dealer-auth.cjs');
const {
  WATCH_SELECT_FIELDS,
  enrichIdentityRows,
  loadLedgerBlocks,
  passesStaticReleaseGates,
  unresolvedIdentity,
} = require('./_lib/identity-review-source.cjs');

const ALLOWED_BRANDS = new Set(['Rolex', 'Patek Philippe', 'Audemars Piguet', 'Richard Mille', 'Cartier']);
const REVIEW_BUCKETS = new Map([
  ['release-ready', 'READY_FOR_IDENTITY_REVIEW'],
]);
const SCAN_SIZE = 100;
const MAX_SCANNED_PER_PAGE = 1000;
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await authorizeDealer(req, res, new Set(['reviewer', 'admin']));
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const limit = Math.max(1, Math.min(Number.parseInt(req.query?.limit || '50', 10) || 50, 100));
  const brand = String(req.query?.brand || '').trim();
  const reference = String(req.query?.reference || '').trim().slice(0, 80);
  const identityStatus = String(req.query?.status || '').trim().toUpperCase();
  const bucket = String(req.query?.bucket || 'release-ready').trim().toLowerCase();
  const after = String(req.query?.after || '').trim();
  if (brand && !ALLOWED_BRANDS.has(brand)) {
    return res.status(400).json({ error: 'Brand must be an enabled reviewed watch brand' });
  }
  if (identityStatus && !['UNVERIFIED', 'CONFLICT'].includes(identityStatus)) {
    return res.status(400).json({ error: 'Status must be UNVERIFIED or CONFLICT' });
  }
  if (!REVIEW_BUCKETS.has(bucket)) {
    return res.status(400).json({ error: 'Only the bounded release-ready identity lane is interactive' });
  }
  if (after && !/^[A-Za-z0-9_-]{1,200}$/.test(after)) {
    return res.status(400).json({ error: 'Invalid review cursor' });
  }

  try {
    const actionable = [];
    let scanCursor = after || null;
    let scanned = 0;
    let exhausted = false;
    while (actionable.length <= limit && scanned < MAX_SCANNED_PER_PAGE && !exhausted) {
      let query = auth.client
        .from('watch_records')
        .select(WATCH_SELECT_FIELDS)
        .order('id', { ascending: false })
        .limit(SCAN_SIZE);
      if (scanCursor) query = query.lt('id', scanCursor);
      const { data, error } = await query;
      if (error) throw error;
      const rows = data || [];
      if (!rows.length) {
        exhausted = true;
        break;
      }
      scanned += rows.length;
      scanCursor = rows.at(-1).id;
      const enrichedRows = await enrichIdentityRows(auth.client, rows);
      const staticCandidates = enrichedRows.filter(row =>
        ALLOWED_BRANDS.has(row.brand)
        && unresolvedIdentity(row)
        && (!brand || row.brand === brand)
        && (!reference || row.reference === reference)
        && (!identityStatus || row.identity_status === identityStatus)
        && passesStaticReleaseGates(row));
      const { bundleIds, duplicateIds } = await loadLedgerBlocks(auth.client, staticCandidates);
      for (const row of staticCandidates) {
        if (bundleIds.has(row.record_id) || duplicateIds.has(row.record_id)) continue;
        actionable.push({
          ...row,
          release_blockers: row.identity_status === 'CONFLICT' ? ['IDENTITY_CONFLICT'] : [],
          review_disposition: 'READY_FOR_IDENTITY_REVIEW',
        });
      }
      exhausted = rows.length < SCAN_SIZE;
    }

    const items = actionable.slice(0, limit);
    let nextCursor = null;
    if (actionable.length > limit && items.length) {
      nextCursor = items.at(-1).record_id;
    } else if (!exhausted && scanCursor) {
      nextCursor = scanCursor;
    }
    return res.status(200).json({
      status: 'ok',
      limit,
      total: null,
      count: items.length,
      scanned,
      hasMore: Boolean(nextCursor),
      nextCursor,
      items,
      scope: [...ALLOWED_BRANDS],
      bucket,
      reviewDisposition: REVIEW_BUCKETS.get(bucket),
      countStatus: 'Global actionable membership is evaluated asynchronously; this endpoint scans at most 1,000 indexed source rows per page and joins only those IDs to private review ledgers.',
      decisionContract: 'A signed reviewer decision changes only listing_identity_reviews. Raw evidence remains immutable.',
    });
  } catch (error) {
    console.error('[identity-review-queue]', error);
    return res.status(500).json({ error: 'Identity review queue is unavailable' });
  }
};

module.exports.ALLOWED_BRANDS = ALLOWED_BRANDS;
module.exports.MAX_SCANNED_PER_PAGE = MAX_SCANNED_PER_PAGE;
module.exports.REVIEW_BUCKETS = REVIEW_BUCKETS;
module.exports.loadLedgerBlocks = loadLedgerBlocks;
module.exports.passesStaticReleaseGates = passesStaticReleaseGates;
