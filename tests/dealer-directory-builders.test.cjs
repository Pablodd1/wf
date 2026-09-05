'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCanonicalDirectory } = require('../tools/dealer-directory/build-canonical-directory.cjs');
const { buildLiveListingLinks } = require('../tools/dealer-directory/build-live-listing-links.cjs');

test('snapshot builder preserves evidence without external URLs or fabricated ratings', () => {
  const built = buildCanonicalDirectory();
  assert.equal(built.report.records, 78);
  assert.equal(built.report.reviews, 268);
  assert.equal(built.report.contains_external_profile_urls, false);
  assert.ok(built.records.every(row => row.rating === null));
  assert.doesNotMatch(JSON.stringify(built), /watchfacts\.com\/user/i);
});

test('listing-link builder deduplicates public listings and exports no raw messages', async () => {
  const pages = [
    { publicationBrands: ['Rolex'], records: [] },
    { records: [{ id: '11111111-1111-4111-8111-111111111111', seller_phone: '+1 305 555 0101', seller_name: 'Dealer A', raw_message: 'private evidence' }], hasMore: true, nextCursor: 'next' },
    { records: [{ id: '11111111-1111-4111-8111-111111111111', seller_phone: '+1 305 555 0101', seller_name: 'Dealer A' }], hasMore: false },
  ];
  const fetchImpl = async () => ({ ok: true, json: async () => pages.shift() });
  const built = await buildLiveListingLinks({ baseUrl: 'https://example.test', fetchImpl });
  assert.equal(built.records.length, 1);
  assert.equal(built.report.raw_messages_exported, 0);
  assert.equal('raw_message' in built.records[0], false);
});

