'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  DIRECT_BATCH_SIZE,
  MAX_CONCURRENCY,
  RPC_BATCH_SIZE,
  loadAnalyticsSuppressedIds,
} = require('../api/_lib/duplicate-suppression.cjs');

const priceResearchSource = fs.readFileSync(
  path.join(__dirname, '..', 'api', 'price-research.js'),
  'utf8'
);
const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260726140000_exclude_reviewed_duplicates_from_publication.sql'),
  'utf8'
);

test('queries only current cohort IDs regardless of global suppression volume', async () => {
  const cohortIds = Array.from({ length: RPC_BATCH_SIZE * 2 + 17 }, (_, index) => `cohort-${index}`);
  const globalSuppressedIds = new Set(
    Array.from({ length: 25_050 }, (_, index) => `global-${index}`)
  );
  globalSuppressedIds.add('cohort-2001');
  const queried = [];
  let active = 0;
  let maxActive = 0;
  const client = {
    async rpc(name, payload) {
      assert.equal(name, 'reviewed_suppressed_duplicate_ids');
      active += 1;
      maxActive = Math.max(maxActive, active);
      queried.push(...payload.p_duplicate_ids);
      await new Promise(resolve => setTimeout(resolve, 2));
      active -= 1;
      return {
        data: payload.p_duplicate_ids
          .filter(id => globalSuppressedIds.has(id))
          .map(duplicate_id => ({ duplicate_id })),
        error: null,
      };
    },
  };

  assert.ok(globalSuppressedIds.size > 20_000);
  const result = await loadAnalyticsSuppressedIds(client, cohortIds);

  assert.deepEqual([...result], ['cohort-2001']);
  assert.deepEqual(new Set(queried), new Set(cohortIds));
  assert.equal(queried.length, cohortIds.length);
  assert.equal(maxActive <= MAX_CONCURRENCY, true);
});

test('uses bounded cohort-only direct queries before the RPC migration exists', async () => {
  const cohortIds = Array.from({ length: DIRECT_BATCH_SIZE * 2 + 5 }, (_, index) => `fallback-${index}`);
  const batches = [];
  let active = 0;
  let maxActive = 0;
  const client = {
    async rpc() {
      return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
    },
    from(table) {
      assert.equal(table, 'duplicate_review_candidates');
      const query = {
        select(column) {
          assert.equal(column, 'duplicate_id');
          return query;
        },
        eq(column, value) {
          assert.equal(column, 'status');
          assert.equal(value, 'SUPPRESSED');
          return query;
        },
        async in(column, ids) {
          assert.equal(column, 'duplicate_id');
          assert.equal(ids.length <= DIRECT_BATCH_SIZE, true);
          batches.push(ids);
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise(resolve => setTimeout(resolve, 2));
          active -= 1;
          return {
            data: ids.includes('fallback-204') ? [{ duplicate_id: 'fallback-204' }] : [],
            error: null,
          };
        },
      };
      return query;
    },
  };

  const result = await loadAnalyticsSuppressedIds(client, cohortIds);
  assert.deepEqual([...result], ['fallback-204']);
  assert.deepEqual(new Set(batches.flat()), new Set(cohortIds));
  assert.equal(batches.length, 3);
  assert.equal(maxActive <= MAX_CONCURRENCY, true);
});

test('has no global 20,000-ID cap or unbounded fallback query', () => {
  assert.match(priceResearchSource, /loadAnalyticsSuppressedIds\(client, normalizedRows\.map\(row => row\.id\)\)/);
  assert.match(priceResearchSource, /sourceTable === 'price_research_verified_source'[\s\S]*\? new Set\(\)/);
  assert.doesNotMatch(priceResearchSource, /limit\(20_000\)|limit\(20000\)/);
  assert.match(migration, /reviewed_suppressed_duplicate_ids\(p_duplicate_ids TEXT\[\]\)/);
  assert.match(migration, /cardinality\(COALESCE\(p_duplicate_ids[\s\S]*BETWEEN 1 AND 1000/);
  assert.match(migration, /d\.duplicate_id = ANY\(COALESCE\(p_duplicate_ids/);
  assert.doesNotMatch(migration, /LIMIT\s+20_?000/i);
});

test('returns an empty set when pre-migration duplicate infrastructure is unavailable', async () => {
  const client = {
    async rpc() {
      return { data: null, error: { code: 'PGRST202' } };
    },
    from() {
      throw new Error('duplicate table unavailable');
    },
  };
  assert.deepEqual(await loadAnalyticsSuppressedIds(client, ['current-cohort-id']), new Set());
});
