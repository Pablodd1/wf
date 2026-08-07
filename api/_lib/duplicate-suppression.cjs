'use strict';

const RPC_BATCH_SIZE = 1000;
const DIRECT_BATCH_SIZE = 100;
const MAX_CONCURRENCY = 3;
const SUPPRESSION_UNAVAILABLE = 'DUPLICATE_SUPPRESSION_UNAVAILABLE';

function unavailable() {
  const error = new Error('Duplicate suppression lookup unavailable');
  error.code = SUPPRESSION_UNAVAILABLE;
  return error;
}

function uniqueIds(values) {
  return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))];
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
        results[index] = await task(values[index], index);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

function isMissingBatchRpc(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || error || '');
  return code === 'PGRST202'
    || code === '42883'
    || /could not find (?:the )?function|function .* does not exist/i.test(message);
}

function idsFromResults(results) {
  return new Set(
    results
      .flatMap(result => result?.data || [])
      .map(row => String(row.duplicate_id || '').trim())
      .filter(Boolean)
  );
}

async function loadDirect(client, cohortIds) {
  const batches = chunks(cohortIds, DIRECT_BATCH_SIZE);
  const results = await mapWithConcurrency(batches, MAX_CONCURRENCY, batch => client
    .from('duplicate_review_candidates')
    .select('duplicate_id')
    .eq('status', 'SUPPRESSED')
    .in('duplicate_id', batch));
  if (results.some(result => result?.error)) throw unavailable();
  return idsFromResults(results);
}

async function loadAnalyticsSuppressedIds(client, cohortIdValues) {
  const cohortIds = uniqueIds(cohortIdValues);
  if (!cohortIds.length) return new Set();

  try {
    const batches = chunks(cohortIds, RPC_BATCH_SIZE);
    if (typeof client?.rpc === 'function') {
      const first = await client.rpc('reviewed_suppressed_duplicate_ids', {
        p_duplicate_ids: batches[0],
      });
      if (!first?.error) {
        const remaining = await mapWithConcurrency(
          batches.slice(1),
          MAX_CONCURRENCY,
          batch => client.rpc('reviewed_suppressed_duplicate_ids', { p_duplicate_ids: batch })
        );
        const results = [first, ...remaining];
        if (results.some(result => result?.error)) throw unavailable();
        return idsFromResults(results);
      }
      if (!isMissingBatchRpc(first.error)) throw unavailable();
    }

    // Before the batch RPC migration is deployed, retain the same graceful
    // behavior with bounded PostgREST queries. Every query is still restricted
    // to IDs already present in the current Price Research cohort.
    return await loadDirect(client, cohortIds);
  } catch (error) {
    console.warn('[duplicate-suppression] duplicate suppression lookup unavailable, returning empty set:', error.message);
    return new Set();
  }
}

module.exports = {
  DIRECT_BATCH_SIZE,
  MAX_CONCURRENCY,
  RPC_BATCH_SIZE,
  SUPPRESSION_UNAVAILABLE,
  loadAnalyticsSuppressedIds,
};
