'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { classifyParent, recordId } = require('../tools/mission-images/audit-child-image-lineage.cjs');

const parent = { raw_data: { brand: 'Patek Philippe', reference: '5712/1A' } };

test('allows only an exact single-child image candidate', () => {
  assert.equal(classifyParent(parent, [
    { listing_id: 'child-1', brand: 'Patek Philippe', reference: '5712/1A' },
  ]).decision, 'SAFE_SINGLE_LISTING_CANDIDATE');
});

test('routes a shared parent image to review', () => {
  assert.equal(classifyParent(parent, [
    { listing_id: 'child-1', brand: 'Patek Philippe', reference: '5712/1A' },
    { listing_id: 'child-2', brand: 'Patek Philippe', reference: '5167A' },
  ]).decision, 'REVIEW_MULTI_LISTING_PARENT');
});

test('blocks a parent-child reference conflict', () => {
  assert.equal(classifyParent(parent, [
    { listing_id: 'child-1', brand: 'Patek Philippe', reference: '5167A' },
  ]).decision, 'REVIEW_PARENT_CHILD_CONFLICT');
});

test('uses the same parent identifier as the unbundled mappings', () => {
  assert.equal(
    recordId('auction_watches', '00580a3c-bc8d-4472-b0f9-7584dc50f494'),
    'mysql_auction_watches_00580a3c-bc8d-4472-b0f9-7584dc50f494',
  );
});
