'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  exactImageUrl,
  sourceAuctionId,
  summarizeBrand,
} = require('../tools/audit/audit-four-brand-source-completeness.cjs');

test('source auction IDs require the exact MariaDB lineage prefix and UUID', () => {
  assert.equal(sourceAuctionId('mysql_auctions_8fbf120b-9dcc-4349-9d73-4de0d40fb81b'),
    '8fbf120b-9dcc-4349-9d73-4de0d40fb81b');
  assert.equal(sourceAuctionId('8fbf120b-9dcc-4349-9d73-4de0d40fb81b'), null);
  assert.equal(sourceAuctionId('mysql_auctions_not-a-uuid'), null);
});

test('source image filenames map only to the exact production listings/full path', () => {
  assert.equal(exactImageUrl('677ec903f2c9b_front_image.jpg'),
    'https://thecollective-prod.nyc3.digitaloceanspaces.com/listings/full/677ec903f2c9b_front_image.jpg');
  assert.equal(exactImageUrl('../other.jpg'), null);
  assert.equal(exactImageUrl('not a path.jpg'), null);
});

test('audit distinguishes exact image, source price, rating, and repost evidence', () => {
  const id = '8fbf120b-9dcc-4349-9d73-4de0d40fb81b';
  const listing = {
    id: 'public-1',
    source_record_id: `mysql_auctions_${id}`,
    brand: 'Omega',
    reference: '311.30.42.30.01.005',
    listing_type: 'WTS',
    price_usd: null,
    price_raw: null,
    seller_rating: null,
    seller_name: 'Dealer',
    listing_date: '2026-08-11',
    raw_message: 'Omega 311.30.42.30.01.005 USD 5000',
    has_images: false,
  };
  const source = {
    id,
    type: 'sale',
    is_bundle: 0,
    price: 5000,
    dealer_rating: 4,
    front_image: '677ec903f2c9b_front_image.jpg',
    title_hash: 'hash',
    from_number: 'private',
    company_id: null,
    times_posted: 2,
  };
  const imageUrl = exactImageUrl(source.front_image);
  const result = summarizeBrand([listing], new Map([[id, source]]),
    new Map([[imageUrl, { reachable: true, content_type: 'image/jpeg' }]]));
  assert.equal(result.summary.source_exact_image_reachable, 1);
  assert.equal(result.summary.unpriced_wts_with_source_price, 1);
  assert.equal(result.summary.missing_public_rating_with_source_rating, 1);
  assert.equal(result.summary.source_times_posted_gt_one, 1);
  assert.equal(result.exact_image_candidates.length, 1);
});
