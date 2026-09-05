'use strict';

function cleanText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function isExactHttpUrl(value) {
  const text = cleanText(value);
  if (!text) return false;
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function sameIdentityValue(left, right) {
  const a = cleanText(left)?.toLowerCase() || null;
  const b = cleanText(right)?.toLowerCase() || null;
  return a === b;
}

function imageReviewMatchesListing(review, listing) {
  const snapshot = review?.identity_snapshot;
  if (!snapshot || Array.isArray(snapshot) || typeof snapshot !== 'object') return false;
  return sameIdentityValue(snapshot.brand, listing?.brand)
    && sameIdentityValue(snapshot.model, listing?.model)
    && sameIdentityValue(snapshot.reference, listing?.reference)
    && sameIdentityValue(snapshot.dial_color, listing?.dial_color);
}

function mergeVerifiedImages(listing, reviews, manifestRows) {
  const manifestByKey = new Map((manifestRows || []).map(row => [String(row.source_object_key), row]));
  const exactUrls = [];

  for (const review of reviews || []) {
    if (String(review?.record_id) !== String(listing?.id)) continue;
    if (!imageReviewMatchesListing(review, listing)) continue;
    const media = manifestByKey.get(String(review.source_object_key));
    if (!media || String(media.matched_record_id) !== String(listing.id)) continue;
    if (!isExactHttpUrl(media.public_url)) continue;
    exactUrls.push(cleanText(media.public_url));
  }

  const existingUrls = [listing?.thumbnail_url, ...(Array.isArray(listing?.image_urls) ? listing.image_urls : [])]
    .filter(isExactHttpUrl)
    .map(cleanText);
  const imageUrls = [...new Set([...existingUrls, ...exactUrls])];
  return {
    ...listing,
    has_images: imageUrls.length > 0,
    thumbnail_url: imageUrls[0] || null,
    image_urls: imageUrls,
  };
}

async function loadVerifiedListingRows(client, ids) {
  const uniqueIds = [...new Set((ids || []).map(String).filter(Boolean))];
  if (!uniqueIds.length) return new Map();

  const batches = [];
  for (let index = 0; index < uniqueIds.length; index += 100) {
    batches.push(uniqueIds.slice(index, index + 100));
  }
  const results = await Promise.all(batches.map(batch => client
    .from('trading_floor_verified_listings')
    .select('id,brand,model,reference,dial_color,has_images,thumbnail_url,image_urls')
    .in('id', batch)));
  const error = results.find(result => result.error)?.error;
  if (error) throw error;

  const verifiedRows = results
    .flatMap(result => result.data || [])
    .map(row => ({ ...row, id: String(row.id) }));
  const verifiedById = new Map(verifiedRows.map(row => [row.id, row]));
  if (!verifiedRows.length) return verifiedById;

  // The publication view intentionally exposes a single thumbnail. Recover
  // additional images only from the existing, exact visual-review ledger:
  // review.record_id must match the listing, the immutable manifest must still
  // belong to the same record, and the reviewed identity snapshot must match
  // the currently published canonical identity. Any lookup failure keeps the
  // already-safe single-image view response instead of widening publication.
  try {
    const reviews = [];
    for (const batch of batches) {
      const result = await client
        .from('listing_image_reviews')
        .select('source_object_key,record_id,identity_snapshot,reviewed_at')
        .in('record_id', batch)
        .eq('status', 'VISUALLY_VERIFIED')
        .order('reviewed_at', { ascending: false, nullsFirst: false });
      if (result.error) throw result.error;
      reviews.push(...(result.data || []));
    }

    const sourceKeys = [...new Set(reviews.map(row => cleanText(row.source_object_key)).filter(Boolean))];
    if (!sourceKeys.length) return verifiedById;

    const manifestRows = [];
    for (let index = 0; index < sourceKeys.length; index += 100) {
      const result = await client
        .from('media_manifest')
        .select('source_object_key,matched_record_id,public_url')
        .in('source_object_key', sourceKeys.slice(index, index + 100));
      if (result.error) throw result.error;
      manifestRows.push(...(result.data || []));
    }

    const reviewsByRecord = new Map();
    for (const review of reviews) {
      const recordId = String(review.record_id || '');
      if (!reviewsByRecord.has(recordId)) reviewsByRecord.set(recordId, []);
      reviewsByRecord.get(recordId).push(review);
    }
    for (const listing of verifiedRows) {
      verifiedById.set(listing.id, mergeVerifiedImages(
        listing,
        reviewsByRecord.get(listing.id) || [],
        manifestRows,
      ));
    }
  } catch (error) {
    console.warn('[verified-listing-media] multi-image enrichment unavailable; retaining verified thumbnail:', error.message);
  }

  return verifiedById;
}

module.exports = {
  imageReviewMatchesListing,
  loadVerifiedListingRows,
  mergeVerifiedImages,
};
