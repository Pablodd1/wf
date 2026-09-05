'use strict';

const WATCH_RECORD_BATCH_SIZE = 100;
const WATCH_RECORD_PAGE_SIZE = 500;
const MAX_BATCH_CONCURRENCY = 3;

function clean(value) {
  const text = String(value || '').trim();
  return text || null;
}

function exactReferenceVariants(values) {
  return [...new Set((values || []).flatMap(value => {
    const reference = clean(value);
    return reference ? [reference, reference.toUpperCase(), reference.toLowerCase()] : [];
  }))];
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function mapWithConcurrency(values, concurrency, task) {
  const results = new Array(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await task(values[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function loadVerifiedDemandIdentityRows(client, {
  brand,
  referenceVariants,
  limit = 2500,
  watchColumns,
}) {
  const normalizedBrand = clean(brand);
  const references = exactReferenceVariants(referenceVariants);
  const boundedLimit = Math.min(5000, Math.max(1, Number(limit) || 2500));
  if (!normalizedBrand || !references.length) return { rows: [], sampleCapped: false };

  // Page the exact-reference WTB lane first. Sampling identity reviews first
  // is biased toward WTS because both intents share the same canonical index.
  // Fetch one row beyond the ceiling so the API can disclose truncation.
  const candidateRows = [];
  for (let offset = 0; offset <= boundedLimit; offset += WATCH_RECORD_PAGE_SIZE) {
    const end = Math.min(offset + WATCH_RECORD_PAGE_SIZE - 1, boundedLimit);
    const { data, error } = await client
      .from('watch_records')
      .select(watchColumns)
      .eq('brand', normalizedBrand)
      .in('reference', references)
      .in('listing_type', ['WTB', 'NTQ'])
      .or('listing_status.is.null,listing_status.not.in.(HIDDEN,REJECTED,DELETED)')
      .order('id', { ascending: false })
      .range(offset, end);
    if (error) throw error;
    const page = data || [];
    candidateRows.push(...page);
    if (page.length < (end - offset + 1)) break;
  }

  const sampleCapped = candidateRows.length > boundedLimit;
  const records = candidateRows.slice(0, boundedLimit);
  const recordIds = [...new Set(records.map(row => clean(row.id)).filter(Boolean))];
  if (!recordIds.length) return { rows: [], sampleCapped };

  const batches = chunks(recordIds, WATCH_RECORD_BATCH_SIZE);
  const reviewResults = await mapWithConcurrency(batches, MAX_BATCH_CONCURRENCY, batch => client
    .from('listing_identity_reviews')
    .select('record_id,canonical_brand,canonical_model,canonical_reference,canonical_dial_color,status')
    .in('record_id', batch)
    .eq('canonical_brand', normalizedBrand)
    .in('canonical_reference', references)
    .in('status', ['CATALOG_CONFIRMED', 'HUMAN_APPROVED']));
  const reviewError = reviewResults.find(result => result?.error)?.error;
  if (reviewError) throw reviewError;

  const reviewsById = new Map(reviewResults
    .flatMap(result => result?.data || [])
    .map(review => [String(review.record_id), review]));
  const rows = records.flatMap(row => {
    const review = reviewsById.get(String(row.id));
    if (!review) return [];
    return [{
      ...row,
      brand: clean(review.canonical_brand) || row.brand,
      model: clean(review.canonical_model) || row.model,
      reference: clean(review.canonical_reference) || row.reference,
      dial_color: clean(review.canonical_dial_color) || row.dial_color,
      owner_reviewed_identity: true,
      identity_review_status: review.status,
    }];
  });

  return { rows, sampleCapped };
}

module.exports = {
  MAX_BATCH_CONCURRENCY,
  WATCH_RECORD_BATCH_SIZE,
  WATCH_RECORD_PAGE_SIZE,
  exactReferenceVariants,
  loadVerifiedDemandIdentityRows,
};
