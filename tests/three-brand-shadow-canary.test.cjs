'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  baseDisposition,
  imageEvidence,
  normalizeIntent,
} = require('../tools/intake/build-three-brand-shadow-canary.cjs');

test('three-brand canary preserves WTB and normalizes NTQ to demand', () => {
  assert.equal(normalizeIntent('WTS'), 'WTS');
  assert.equal(normalizeIntent('WTB'), 'WTB');
  assert.equal(normalizeIntent('NTQ'), 'WTB');
  assert.equal(normalizeIntent('other'), null);
});

test('image evidence distinguishes seller, reference, and text-only rows', () => {
  assert.equal(imageEvidence({ 'User Image URL': 'https://example.com/user.jpg' }).status, 'USER_IMAGE_CANDIDATE');
  assert.equal(imageEvidence({ 'Catalog Image URL': 'https://example.com/catalog' }).status, 'REFERENCE_IMAGE_CANDIDATE');
  assert.equal(imageEvidence({}).status, 'TEXT_ONLY');
});

test('dispositions keep Price Research separate from Trading Floor', () => {
  const base = {
    technical_errors: [],
    review_reasons: [],
    duplicate_copy: false,
    listing_type: 'WTS',
    price_research_eligible: false,
  };
  assert.equal(baseDisposition(base), 'TRADING_FLOOR_READY_PRICE_RESEARCH_HELD');
  assert.equal(
    baseDisposition({ ...base, price_research_eligible: true }),
    'TRADING_FLOOR_AND_PRICE_RESEARCH_READY',
  );
  assert.equal(
    baseDisposition({ ...base, listing_type: 'WTB' }),
    'TRADING_FLOOR_READY_WTB',
  );
  assert.equal(
    baseDisposition({ ...base, duplicate_copy: true }),
    'DUPLICATE_COPY_HELD',
  );
  assert.equal(
    baseDisposition({ ...base, review_reasons: ['BUNDLE_SPLIT_REQUIRED'] }),
    'HUMAN_REVIEW_REQUIRED',
  );
});
