'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizedFields } = require('../api/dealer-submission-review.js');

test('review normalization accepts exact source values and a reviewer catalog decision', () => {
  const result = normalizedFields({ normalized_fields: {
    brand: 'Rolex', model: 'Daytona', reference: '116500LN', dial_color: 'White',
    price_amount: '30000', currency: 'usd', catalog_confirmed: true,
  } });
  assert.equal(result.error, undefined);
  assert.equal(result.fields.currency, 'USD');
  assert.equal(result.fields.price_amount, 30000);
  assert.equal(result.fields.catalog_confirmed, true);
});

test('review normalization rejects invalid prices', () => {
  assert.match(normalizedFields({ normalized_fields: { price_amount: '-1' } }).error, /positive amount/);
});

test('review API is reviewer-only and holds approval until shared publication gates are proven', () => {
  const route = fs.readFileSync(path.join(__dirname, '..', 'api', 'dealer-submission-review.js'), 'utf8');
  assert.match(route, /new Set\(\['reviewer', 'admin'\]\)/);
  assert.match(route, /authorizeDealer\(req, res, REVIEW_ROLES\)/);
  assert.match(route, /DEALER_SUBMISSION_PUBLICATION_HELD/);
  assert.match(route, /review_dealer_submission/);
  assert.doesNotMatch(route, /schema\('staging'\)\.from\('listings'\)\.insert/);
});

test('database safety hold preserves rejection but cannot materialize an approval', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260815180000_hold_direct_submission_publication.sql'), 'utf8');
  assert.match(migration, /DEALER_SUBMISSION_PUBLICATION_HELD/);
  assert.match(migration, /review_status = 'REJECTED'/);
  assert.doesNotMatch(migration, /INSERT INTO staging\.listings/i);
  assert.doesNotMatch(migration, /publication_status = 'PUBLISHED'/i);
});

test('review UI shows raw evidence, seller demographics, images, normalization, and approval controls', () => {
  const lane = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'DealerSubmissionReviewLane.tsx'), 'utf8');
  const queue = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'ReviewQueue.tsx'), 'utf8');
  assert.match(lane, /item\.raw_message/);
  assert.match(lane, /poster_name/);
  assert.match(lane, /item\.image_urls/);
  assert.match(lane, /catalog_confirmed/);
  assert.match(lane, /Approval held for validation/);
  assert.match(queue, /Post an Item/);
  assert.match(queue, /DealerSubmissionReviewLane/);
});
