'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  exactReferenceVariants,
  loadVerifiedDemandIdentityRows,
} = require('../api/_lib/verified-demand-identity.cjs');

function query(result) {
  const chain = {
    select() { return chain; },
    eq() { return chain; },
    in() { return chain; },
    or() { return chain; },
    order() { return chain; },
    limit() { return chain; },
    range() { return chain; },
    then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
  };
  return chain;
}

test('review-first WTB loader returns only signed exact-reference identities', async () => {
  const calls = [];
  const client = {
    from(table) {
      calls.push(table);
      if (table === 'watch_records') {
        return query({
          data: [
            {
              id: 'reviewed-1',
              brand: 'Rolex',
              reference: '116500ln',
              listing_type: 'WTB',
              verdict: 'APPROVED',
              confidence: 95,
            },
            {
              id: 'unreviewed-1',
              brand: 'Rolex',
              reference: '116500LN',
              listing_type: 'WTB',
              verdict: 'APPROVED',
              confidence: 95,
            },
          ],
          error: null,
        });
      }
      return query({
        data: [{
          record_id: 'reviewed-1',
          canonical_brand: 'Rolex',
          canonical_model: 'Cosmograph Daytona',
          canonical_reference: '116500LN',
          canonical_dial_color: 'White',
          status: 'HUMAN_APPROVED',
        }],
        error: null,
      });
    },
  };

  const result = await loadVerifiedDemandIdentityRows(client, {
    brand: 'Rolex',
    referenceVariants: ['116500LN'],
    limit: 500,
    watchColumns: 'id,brand,reference,listing_type,verdict,confidence',
  });

  assert.deepEqual(calls, ['watch_records', 'listing_identity_reviews']);
  assert.equal(result.sampleCapped, false);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].owner_reviewed_identity, true);
  assert.equal(result.rows[0].identity_review_status, 'HUMAN_APPROVED');
  assert.equal(result.rows[0].reference, '116500LN');
  assert.equal(result.rows[0].dial_color, 'White');
});

test('exact reference variants never introduce a prefix or family expansion', () => {
  assert.deepEqual(
    new Set(exactReferenceVariants(['5712/1A'])),
    new Set(['5712/1A', '5712/1a']),
  );
  assert.equal(exactReferenceVariants(['5712']).includes('571'), false);
});
