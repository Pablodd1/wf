'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const {
  LISTING_DISPLAY_CONTRACT_VERSION,
  NULLABLE_KEYS,
  enforceListingDisplayContract,
} = require('../shared/listing-display-contract.cjs');
const health = require('../api/release-health.js');

test('listing display contract emits explicit null keys and stable lineage', () => {
  const listing = enforceListingDisplayContract({
    id: 'cn_030268',
    parent_id: 'parent-1',
    seller_phone: '+1 555 0100',
  });
  assert.equal(listing.listing_display_contract_version, LISTING_DISPLAY_CONTRACT_VERSION);
  for (const key of NULLABLE_KEYS) assert.notEqual(listing[key], undefined, key);
  assert.equal(listing.source_listing_id, 'cn_030268');
  assert.equal(listing.parent_listing_id, 'parent-1');
  assert.equal(listing.child_listing_id, 'cn_030268');
  assert.equal(listing.seller_phone, null);
});

test('images fail closed without declared listing lineage and omit the frame data', () => {
  const unknown = enforceListingDisplayContract({
    id: 'one', has_images: true,
    thumbnail_url: 'https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/one.jpg',
  });
  assert.equal(unknown.has_images, false);
  assert.equal(unknown.image_evidence_type, 'NO_IMAGE');
  assert.equal(unknown.thumbnail_url, null);
  assert.deepEqual(unknown.image_urls, []);

  const sourceLinked = enforceListingDisplayContract({
    id: 'two', has_images: true,
    thumbnail_url: 'https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/two.jpg',
    image_evidence_type: 'SOURCE_LISTING_IMAGE',
  });
  assert.equal(sourceLinked.has_images, true);
  assert.equal(sourceLinked.image_evidence_type, 'SOURCE_LISTING_IMAGE');
  assert.match(sourceLinked.thumbnail_url, /two\.jpg$/);
});

test('bundle children never inherit a parent image through the public contract', () => {
  const child = enforceListingDisplayContract({
    id: 'child', parent_listing_id: 'parent', is_unbundled_child: true,
    thumbnail_url: 'https://example.test/bundle.jpg',
    image_evidence_type: 'SOURCE_LISTING_IMAGE',
  });
  assert.equal(child.has_images, false);
  assert.equal(child.image_evidence_type, 'NO_IMAGE');
  assert.equal(child.thumbnail_url, null);
});

test('frontend API references and release health manifest are complete', () => {
  const result = spawnSync(process.execPath, ['tools/verify-frontend-api-routes.cjs'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(health.REQUIRED_CUSTOMER_ROUTES.includes('/api/price-research-batch-summary'));
  assert.ok(health.REQUIRED_CUSTOMER_ROUTES.includes('/api/catalog-suggestions'));
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(packageJson.scripts.build, /verify-frontend-api-routes/);
});

