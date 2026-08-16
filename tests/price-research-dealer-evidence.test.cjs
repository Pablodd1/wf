'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const evidence = require('../api/_lib/listing-dealer-evidence.cjs');
const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

function mockClient(tableRows, calls, errors = {}) {
  return { from(table) {
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      in(column, values) {
        calls.push({ table, column, size: values.length });
        return Promise.resolve({ data: tableRows[table] || [], error: errors[table] || null });
      },
    };
    return chain;
  } };
}

test('exact applied listing linkage adds only source-backed Reference Check evidence', async () => {
  const linkedId = '11111111-1111-4111-8111-111111111111';
  const unlinkedId = '22222222-2222-4222-8222-222222222222';
  const calls = [];
  const client = mockClient({
    dealer_listing_links: [{ listing_id: linkedId, dealer_id: 'dealer-1', link_method: 'AUTHENTICATED_SUBMISSION' }],
    dealers: [{ id: 'dealer-1', status: 'VERIFIED', rating: null,
      review_count: 22, whatsapp_group_count: 5 }],
  }, calls);
  const [linked, unlinked] = await evidence.enrichRowsWithExactDealerEvidence(client, [
    { id: linkedId, seller_name: 'Observed poster', seller_phone: null },
    { id: unlinkedId, seller_name: 'Another poster', seller_phone: null },
  ]);

  assert.equal(linked.dealer_id, 'dealer-1');
  assert.equal(linked.dealer_profile_path, '/reference-check/dealer-1');
  assert.equal(linked.seller_rating, null);
  assert.equal(linked.seller_review_count, 22);
  assert.equal(linked.seller_rating_evidence_status, 'SOURCE_FEEDBACK_COUNT');
  assert.equal(linked.seller_group_count, 5);
  assert.equal(linked.dealer_directory_link_method, 'AUTHENTICATED_SUBMISSION');
  assert.equal(linked.seller_name, 'Observed poster');
  assert.equal(linked.seller_phone, null);
  assert.equal(unlinked.dealer_id, undefined);
  assert.equal(unlinked.dealer_profile_path, undefined);
  assert.ok(calls.every(call => call.size <= evidence.LOOKUP_BATCH_SIZE));
});

test('lookup failure leaves analytics evidence unchanged and does not infer identity', async () => {
  const row = { id: '33333333-3333-4333-8333-333333333333', seller_name: 'Observed only' };
  const client = mockClient({}, [], { dealer_listing_links: new Error('temporary lookup failure') });
  const result = await evidence.enrichRowsWithExactDealerEvidence(client, [row]);
  assert.deepEqual(result, [row]);
});

test('Price Research API and UI use bounded exact-ledger evidence with explicit unlinked state', () => {
  const api = read('api/price-research.js');
  const page = read('src/pages/PriceResearch.tsx');
  assert.match(api, /enrichRowsWithExactDealerEvidence/);
  assert.match(api, /comparableRowsWithDealerEvidence/);
  assert.match(api, /retainedRowsWithDealerEvidence/);
  assert.match(api, /outlierRowsWithDealerEvidence/);
  assert.match(page, /<DealerRatingBadge/);
  assert.match(page, /Reference Check linked/);
  assert.match(page, /Reference Check unlinked/);
  assert.match(page, /<ListingDealerEvidence/);
});
