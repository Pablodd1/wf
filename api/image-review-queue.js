'use strict';

const { authorizeDealer } = require('./_lib/dealer-auth.cjs');
const { boundedInteger } = require('./_lib/review-packets.cjs');
const { publicationBrands } = require('./_lib/publication-brands.cjs');
const { publicationReferences } = require('./_lib/publication-references.cjs');

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

function cursorValue(value) {
  if (value === undefined || value === null || value === '') return null;
  const cursor = String(value).trim();
  return cursor && cursor.length <= 1024 ? cursor : null;
}

function text(value) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function reviewItem(row, identity) {
  const item = {
    source_object_key: row.source_object_key,
    public_url: text(row.public_url),
    record_id: row.record_id,
    brand: text(identity?.canonical_brand) || text(row.brand),
    model: text(identity?.canonical_model) || text(row.model),
    reference: text(identity?.canonical_reference) || text(row.reference),
    dial_color: text(identity?.canonical_dial_color) || text(row.dial_color),
    raw_message: text(row.raw_message),
    image_status: row.image_status,
    identity_status: identity?.status || row.identity_status,
    evidence: row.evidence || {},
  };
  const required = [
    'source_object_key',
    'public_url',
    'record_id',
    'brand',
    'model',
    'reference',
    'dial_color',
    'raw_message',
  ];
  const review_blockers = required.filter(field => !item[field]).map(field => `MISSING_${field.toUpperCase()}`);
  if (!identity) review_blockers.push('CURRENT_IDENTITY_NOT_FOUND');
  return {
    ...item,
    review_blocked: review_blockers.length > 0,
    review_blockers,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await authorizeDealer(req, res, new Set(['reviewer', 'admin']));
  if (auth.error) return res.status(auth.status).json({ error: auth.error });

  const limit = boundedInteger(req.query?.limit, 50, 1, 50);
  const after = cursorValue(req.query?.after);
  const releaseOnly = String(req.query?.release || '').toLowerCase() === 'true';
  if (req.query?.after && !after) return res.status(400).json({ error: 'Valid after cursor required' });

  try {
    let pageQuery = auth.client
      .from('image_identity_review_queue')
      .select(QUEUE_FIELDS)
      .eq('image_status', 'SOURCE_LINKED')
      .in('identity_status', VERIFIED_IDENTITY_STATUSES)
      .order('source_object_key', { ascending: true })
      .limit(limit + 1);
    let countQuery = auth.client
      .from('image_identity_review_queue')
      .select('source_object_key', { count: 'exact', head: true })
      .eq('image_status', 'SOURCE_LINKED')
      .in('identity_status', VERIFIED_IDENTITY_STATUSES);
    if (releaseOnly) {
      const brands = publicationBrands();
      const references = [...new Set(publicationReferences().map(entry => entry.reference))];
      if (brands.length) {
        pageQuery = pageQuery.in('brand', brands);
        countQuery = countQuery.in('brand', brands);
      }
      if (references.length) {
        pageQuery = pageQuery.in('reference', references);
        countQuery = countQuery.in('reference', references);
      }
    }
    if (after) pageQuery = pageQuery.gt('source_object_key', after);

    const [
      { data: rows, error: pageError },
      { count, error: countError },
    ] = await Promise.all([pageQuery, countQuery]);
    if (pageError) throw pageError;
    if (countError) throw countError;

    const page = (rows || []).slice(0, limit);
    const recordIds = [...new Set(page.map(row => row.record_id).filter(Boolean))];
    let identityByRecord = new Map();
    if (recordIds.length) {
      const { data: identities, error: identityError } = await auth.client
        .from('listing_identity_reviews')
        .select('record_id,status,canonical_brand,canonical_model,canonical_reference,canonical_dial_color')
        .in('record_id', recordIds)
        .in('status', VERIFIED_IDENTITY_STATUSES);
      if (identityError) throw identityError;
      identityByRecord = new Map((identities || []).map(identity => [identity.record_id, identity]));
    }

    return res.status(200).json({
      status: 'ok',
      items: page.map(row => reviewItem(row, identityByRecord.get(row.record_id))),
      total: count || 0,
      releaseOnly,
      nextCursor: (rows || []).length > limit ? page.at(-1)?.source_object_key || null : null,
    });
  } catch (error) {
    console.error('[image-review-queue]', error);
    return res.status(500).json({
      status: 'unavailable',
      error: 'Image review queue is unavailable',
      items: [],
      total: 0,
    });
  }
};

module.exports.cursorValue = cursorValue;
module.exports.reviewItem = reviewItem;
