'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  composeIdentityRow,
  passesStaticReleaseGates,
  unresolvedIdentity,
} = require('../api/_lib/identity-review-source.cjs');

test('composes unresolved identity evidence from one source row and its exact private ledger row', () => {
  const row = composeIdentityRow({
    id: 'record-1',
    brand: 'rolex',
    model: null,
    reference: '126613LN',
    dial_color: 'Black',
    raw_message: 'Rolex 126613LN Black',
    verdict: 'APPROVED',
    confidence: 90,
    listing_type: 'WTS',
    flags: [],
  }, {
    record_id: 'record-1',
    status: 'CONFLICT',
    canonical_brand: 'Rolex',
    canonical_model: 'Submariner',
    canonical_reference: '126613LN',
    canonical_dial_color: 'Black',
    evidence: { source: 'exact-review' },
  });
  assert.equal(row.record_id, 'record-1');
  assert.equal(row.identity_status, 'CONFLICT');
  assert.equal(row.brand, 'Rolex');
  assert.equal(row.model, 'Submariner');
  assert.deepEqual(row.prior_identity_evidence, { source: 'exact-review' });
  assert.equal(unresolvedIdentity(row), true);
  assert.equal(passesStaticReleaseGates(row), true);
});

test('keeps approved identity rows and non-target brands out of the unresolved queue', () => {
  const approved = composeIdentityRow({ id: 'record-2', brand: 'Rolex' }, {
    status: 'HUMAN_APPROVED',
    canonical_brand: 'Rolex',
  });
  const otherBrand = composeIdentityRow({ id: 'record-3', brand: 'Omega' }, null);
  assert.equal(unresolvedIdentity(approved), false);
  assert.equal(unresolvedIdentity(otherBrand), false);
});

test('queue and decision avoid the timeout-prone global review view', () => {
  const queue = fs.readFileSync(path.join(__dirname, '..', 'api', 'identity-review-queue.js'), 'utf8');
  const decision = fs.readFileSync(path.join(__dirname, '..', 'api', 'identity-review-decision.js'), 'utf8');
  const helper = fs.readFileSync(path.join(__dirname, '..', 'api', '_lib', 'identity-review-source.cjs'), 'utf8');
  assert.doesNotMatch(queue, /\.from\('two_brand_identity_review_queue'\)/);
  assert.doesNotMatch(decision, /\.from\('two_brand_identity_review_queue'\)/);
  assert.match(queue, /\.from\('watch_records'\)[\s\S]*\.order\('id'/);
  assert.match(helper, /\.from\('listing_identity_reviews'\)[\s\S]*\.in\('record_id', ids\)/);
  assert.match(helper, /\.from\('normalization_shadow_v4'\)/);
  assert.match(helper, /\.from\('duplicate_review_candidates'\)/);
});
