'use strict';

const ALLOWED_BRANDS = new Map([
  ['ROLEX', 'Rolex'],
  ['PATEKPHILIPPE', 'Patek Philippe'],
]);

const WATCH_SELECT_FIELDS = [
  'id',
  'brand',
  'model',
  'reference',
  'dial_color',
  'condition',
  'year',
  'price_raw',
  'price_usd',
  'currency',
  'listing_type',
  'verdict',
  'confidence',
  'raw_message',
  'source',
  'source_type',
  'listing_date',
  'created_at',
  'seller_name',
  'seller_phone',
  'dealer_id',
  'thumbnail_url',
  'image_urls',
  'has_images',
  'flags',
  'listing_status',
].join(',');

const IDENTITY_SELECT_FIELDS = [
  'record_id',
  'status',
  'canonical_brand',
  'canonical_model',
  'canonical_reference',
  'canonical_dial_color',
  'evidence',
].join(',');

function normalizedFlags(value) {
  if (Array.isArray(value)) return value.map(String);
  if (value && typeof value === 'object') return Object.keys(value);
  return [];
}

function canonicalBrand(value) {
  const key = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return ALLOWED_BRANDS.get(key) || null;
}

function passesStaticReleaseGates(row) {
  if (!String(row?.raw_message || '').trim()) return false;
  if (String(row?.verdict || '').toUpperCase() !== 'APPROVED') return false;
  const confidence = Number(row?.confidence);
  if (!Number.isFinite(confidence) || confidence < 90) return false;
  const listingType = String(row?.listing_type || '').toUpperCase();
  if (!['WTS', 'WTB', 'NTQ'].includes(listingType)) return false;
  if (normalizedFlags(row?.flags).includes('BUNDLE_SPLIT_REQUIRED')) return false;
  if (String(row?.record_id || row?.id || '').startsWith('preview_demo_')) return false;
  return true;
}

function composeIdentityRow(watchRow, review = null) {
  const identityStatus = String(review?.status || 'UNVERIFIED').trim().toUpperCase();
  const brand = canonicalBrand(review?.canonical_brand) || canonicalBrand(watchRow?.brand);
  return {
    ...watchRow,
    record_id: watchRow.id,
    identity_status: identityStatus,
    brand,
    model: String(review?.canonical_model || '').trim() || watchRow.model || null,
    reference: String(review?.canonical_reference || '').trim() || watchRow.reference || null,
    dial_color: String(review?.canonical_dial_color || '').trim() || watchRow.dial_color || null,
    prior_identity_evidence: review?.evidence || {},
  };
}

async function loadIdentityReviews(client, ids) {
  if (!ids.length) return new Map();
  const { data, error } = await client
    .from('listing_identity_reviews')
    .select(IDENTITY_SELECT_FIELDS)
    .in('record_id', ids);
  if (error) throw error;
  return new Map((data || []).map(row => [row.record_id, row]));
}

async function enrichIdentityRows(client, watchRows) {
  const reviews = await loadIdentityReviews(client, watchRows.map(row => row.id));
  return watchRows.map(row => composeIdentityRow(row, reviews.get(row.id)));
}

async function loadIdentityRow(client, recordId) {
  const [watchResult, reviewResult] = await Promise.all([
    client.from('watch_records').select(WATCH_SELECT_FIELDS).eq('id', recordId).maybeSingle(),
    client.from('listing_identity_reviews').select(IDENTITY_SELECT_FIELDS).eq('record_id', recordId).maybeSingle(),
  ]);
  if (watchResult.error) throw watchResult.error;
  if (reviewResult.error) throw reviewResult.error;
  return watchResult.data ? composeIdentityRow(watchResult.data, reviewResult.data) : null;
}

async function loadLedgerBlocks(client, rows) {
  const ids = rows.map(row => row.record_id);
  if (!ids.length) return { bundleIds: new Set(), duplicateIds: new Set() };
  const [shadowResult, duplicateResult] = await Promise.all([
    client
      .from('normalization_shadow_v4')
      .select('source_record_id,candidate_count,change_flags')
      .in('source_record_id', ids),
    client
      .from('duplicate_review_candidates')
      .select('duplicate_id')
      .eq('status', 'SUPPRESSED')
      .in('duplicate_id', ids),
  ]);
  if (shadowResult.error) throw shadowResult.error;
  if (duplicateResult.error) throw duplicateResult.error;
  const bundleIds = new Set((shadowResult.data || [])
    .filter(row => Number(row.candidate_count) > 1
      || normalizedFlags(row.change_flags).includes('BUNDLE_SPLIT_REQUIRED'))
    .map(row => row.source_record_id));
  const duplicateIds = new Set((duplicateResult.data || []).map(row => row.duplicate_id));
  return { bundleIds, duplicateIds };
}

function unresolvedIdentity(row) {
  return ['UNVERIFIED', 'CONFLICT'].includes(row?.identity_status) && Boolean(row?.brand);
}

module.exports = {
  ALLOWED_BRANDS,
  IDENTITY_SELECT_FIELDS,
  WATCH_SELECT_FIELDS,
  canonicalBrand,
  composeIdentityRow,
  enrichIdentityRows,
  loadIdentityReviews,
  loadIdentityRow,
  loadLedgerBlocks,
  normalizedFlags,
  passesStaticReleaseGates,
  unresolvedIdentity,
};
