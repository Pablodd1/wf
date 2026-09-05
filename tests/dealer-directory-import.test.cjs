'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRow } = require('../tools/dealer-lineage/stage-rated-dealers-export.cjs');

test('normalizes an authenticated directory row without verifying or matching it', () => {
  const result = normalizeRow({
    profile_id: 'profile-916',
    name: 'Example Dealer',
    company: 'Example LLC',
    phone: '+1 (212) 555-0100',
    country: 'US',
    city: 'New York',
    feedback_count: '22',
    rating: '4.8',
    common_groups: 'WhatsApp groups in common',
    profile_url: 'https://watchfacts.com/user/example/public-profile',
  }, 2);

  assert.equal(result.source_system, 'WATCHFACTS_RATED_DEALERS_AUTHENTICATED');
  assert.equal(result.source_id, 'profile-916');
  assert.equal(result.phone_normalized, '+12125550100');
  assert.equal(result.review_count, 22);
  assert.equal(result.rating, 4.8);
  assert.equal(result.whatsapp_group_count, null);
  assert.equal(result.comparison_status, 'PENDING');
  assert.equal(result.matched_dealer_id, null);
});

test('rejects a directory row with no stable source identity', () => {
  assert.throws(() => normalizeRow({ name: 'No ID' }, 7), /source_id or directory_url is required/);
});

test('does not invent a country code for a local phone', () => {
  const result = normalizeRow({ profile_url: '/profile/1', phone: '212-555-0100' }, 3);
  assert.equal(result.phone_normalized, '2125550100');
  assert.equal(result.country_code, null);
});
