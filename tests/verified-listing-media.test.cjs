'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  imageReviewMatchesListing,
  loadVerifiedListingRows,
  mergeVerifiedImages,
} = require('../api/_lib/verified-listing-media.cjs');

function queryResult(data, error = null) {
  const chain = {
    select() { return chain; },
    in() { return chain; },
    eq() { return chain; },
    order() { return Promise.resolve({ data, error }); },
    then(resolve, reject) { return Promise.resolve({ data, error }).then(resolve, reject); },
  };
  return chain;
}

test('accepts only a visual review snapshot matching the published canonical identity', () => {
  const listing = { id: 'watch-1', brand: 'Rolex', model: 'Daytona', reference: '116500LN', dial_color: 'White' };
  assert.equal(imageReviewMatchesListing({ identity_snapshot: {
    brand: ' rolex ', model: 'DAYTONA', reference: '116500ln', dial_color: 'white',
  } }, listing), true);
  assert.equal(imageReviewMatchesListing({ identity_snapshot: {
    brand: 'Rolex', model: 'Daytona', reference: '116500LN', dial_color: 'Black',
  } }, listing), false);
});

test('merges all exact reviewed images without cross-listing, invalid URL, or identity leakage', () => {
  const listing = {
    id: 'watch-1', brand: 'Rolex', model: 'Daytona', reference: '116500LN', dial_color: 'White',
    has_images: true, thumbnail_url: 'https://cdn.example/first.jpg', image_urls: ['https://cdn.example/first.jpg'],
  };
  const matching = { source_object_key: 'media-2', record_id: 'watch-1', identity_snapshot: {
    brand: 'Rolex', model: 'Daytona', reference: '116500LN', dial_color: 'White',
  } };
  const wrongIdentity = { ...matching, source_object_key: 'media-3', identity_snapshot: { ...matching.identity_snapshot, reference: '126500LN' } };
  const otherListing = { ...matching, source_object_key: 'media-4', record_id: 'watch-2' };
  const result = mergeVerifiedImages(listing, [matching, wrongIdentity, otherListing], [
    { source_object_key: 'media-2', matched_record_id: 'watch-1', public_url: 'https://cdn.example/second.jpg' },
    { source_object_key: 'media-3', matched_record_id: 'watch-1', public_url: 'https://cdn.example/wrong-identity.jpg' },
    { source_object_key: 'media-4', matched_record_id: 'watch-2', public_url: 'https://cdn.example/other-listing.jpg' },
    { source_object_key: 'media-5', matched_record_id: 'watch-1', public_url: 'javascript:alert(1)' },
  ]);

  assert.equal(result.thumbnail_url, 'https://cdn.example/first.jpg');
  assert.deepEqual(result.image_urls, [
    'https://cdn.example/first.jpg',
    'https://cdn.example/second.jpg',
  ]);
});

test('loads multiple exact images from the private review ledger and fails closed to the verified thumbnail', async () => {
  const base = [{
    id: 'watch-1', brand: 'Rolex', model: 'Daytona', reference: '116500LN', dial_color: 'White',
    has_images: true, thumbnail_url: 'https://cdn.example/first.jpg', image_urls: ['https://cdn.example/first.jpg'],
  }];
  const reviews = [{
    source_object_key: 'media-2', record_id: 'watch-1', reviewed_at: '2026-08-15T12:00:00Z', identity_snapshot: {
      brand: 'Rolex', model: 'Daytona', reference: '116500LN', dial_color: 'White',
    },
  }];
  const manifest = [{ source_object_key: 'media-2', matched_record_id: 'watch-1', public_url: 'https://cdn.example/second.jpg' }];
  const client = {
    from(table) {
      if (table === 'trading_floor_verified_listings') return queryResult(base);
      if (table === 'listing_image_reviews') return queryResult(reviews);
      if (table === 'media_manifest') return queryResult(manifest);
      throw new Error(`Unexpected table ${table}`);
    },
  };
  const loaded = await loadVerifiedListingRows(client, ['watch-1']);
  assert.deepEqual(loaded.get('watch-1').image_urls, [
    'https://cdn.example/first.jpg',
    'https://cdn.example/second.jpg',
  ]);

  const failedClient = {
    from(table) {
      if (table === 'trading_floor_verified_listings') return queryResult(base);
      return queryResult([], new Error('private ledger unavailable'));
    },
  };
  const fallback = await loadVerifiedListingRows(failedClient, ['watch-1']);
  assert.deepEqual(fallback.get('watch-1').image_urls, ['https://cdn.example/first.jpg']);
});
