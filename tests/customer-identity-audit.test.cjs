'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { classify } = require('../tools/data-quality/audit-customer-identity.cjs');

test('separates catalog conflicts from verified customer identities', () => {
  const result = classify([
    { brand: 'Audemars Piguet', reference: 'RM 17-01', dial_color: 'Skeleton', has_images: true },
    { brand: 'Richard Mille', reference: 'RM 17-01', dial_color: 'Skeleton' },
    { brand: 'Patek Philippe', reference: '5712/1A', dial_color: 'Blue' },
  ]);
  assert.deepEqual(result.counts, {
    scanned: 3,
    catalog_confirmed: 2,
    catalog_brand_conflict: 1,
    catalog_dial_conflict: 0,
    catalog_unverified: 0,
    image_backed: 1,
    image_backed_identity_conflict: 1,
  });
  assert.equal(result.examples[0].issue, 'CATALOG_BRAND_CONFLICT');
});
